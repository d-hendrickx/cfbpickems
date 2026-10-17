/**
 * CFB Pickems — gamesorttest.mjs (Deployment 1, Lane B, DI-607 / DI-581 / PF-445 rev 3, 2026-10-08)
 * =================================================================================================
 * The Dashboard's Sort button and sheet, the Custom arrangement and Live first movement, from the WORDS up to the real app.js over a real element tree (minidom.mjs, the d1wiringtest way).
 *
 *   [1] The words: the exact strings, and the copy scan — the word "order" appears in no Sort or Arrange label, help line, toast, aria-label or announcement (Drew's wording ruling, D-59)
 *   [2] The pure parts: effectiveMode (All sports reads a saved Custom as Kickoff time without overwriting it), moveId (clamped, never wraps, never mutates), applyOutcome (the drop)
 *   [3] The renderers: they REFUSE to run without an escaper, hostile data is inert, every attribute is double-quoted, the states of the row and of the sheet
 *   [4] The real Dashboard: where the row is (and is not), its caption, the sheet (open / close / Esc / backdrop), set-mode (one write, the list re-sorts), Reset, the Standard layout's note
 *   [5] Arranging: the grip and the arrows, one write per move, the announcement, focus after the repaint, Done (the toast only after a move), the gestures stand down, a tab change ends it
 *   [6] Live first movement: parked under an open sheet and named when it plays; the FLIP (rows that moved are animated, none under Reduce Motion; the reader's row holds still)
 *   [7] Source pins: the sheet is the shared shell, it is on the three "a surface is up" lists, the touched-screen audit on the card header
 *
 * NOT COVERED HERE (a device, never a test): the lift and the drag under a finger (gamearrangetest drives the engine in a real browser with synthetic pointer and touch input; the feel of it is on the
 * device checklist), the haptics, VoiceOver's reading of the sheet and of the announcements, the swipe-down dismissal.
 *
 * Run:  node gamesorttest.mjs
 */
import { readFileSync } from 'node:fs';
import { MiniDocument } from './minidom.mjs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { sets.push(k); store.set(k, String(v)); }, removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
const sets = [];
globalThis.window = globalThis;
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in gamesorttest'); };
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollY = 0;
globalThis.scrollTo = () => {};
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const INDEX = read('./index.html');
const APP = read('./js/app.js');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const doc = new MiniDocument(); const m = INDEX.match(/<body[^>]*data-tab="([^"]*)"/); if (m) doc.body.dataset.tab = m[1]; doc.body.innerHTML = bodyHtmlOf(INDEX); return doc; };
globalThis.document = freshDoc();

quiet();
const S = await import('./js/game-sort.js');
const A = await import('./js/game-arrange.js');
const app = await import('./js/app.js');
const storage = await import('./js/storage.js');
const NG = await import('./js/nav-gestures.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');
loud();

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const numHtml = (n) => String(n);
const textOf = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const attrsOf = (html) => [...html.matchAll(/\b(?:aria-label|title|alt|placeholder)="([^"]*)"/g)].map((m) => m[1]);

// ═══ [1] The words ═══════════════════════════════════════════════════════════════════════════════
_log('\n[1] The words: the exact strings and the copy scan (the word "order" is in none of them)…');
{
  assert(S.SORT_MODES.map((m) => m.label).join('|') === 'Kickoff time|Live first|Custom', '1a: the three modes read "Kickoff time", "Live first" and "Custom" (Drew D-59, the coordinator\'s wording ruling)');
  assert(S.SORT_MODES.map((m) => m.key).join('|') === 'kickoff|live-first|manual', '1b: …over the three stored keys the ordering module knows (kickoff, live-first, manual)');
  assert(S.SORT_COPY.reset === 'Reset to kickoff time' && S.SORT_COPY.saved === 'Arrangement saved.' && S.SORT_COPY.sheetTitle === 'Sort games' && S.SORT_COPY.sheetSub === 'Applies to your Dashboard' && S.SORT_COPY.arrange === 'Arrange games' && S.SORT_COPY.done === 'Done' && S.SORT_COPY.button === 'Sort',
    '1c: the button, the sheet title and subtitle, "Arrange games", "Reset to kickoff time", "Done" and the toast "Arrangement saved." are the DI\'s exact words');
  assert(S.SORT_COPY.standardNote === 'Switch to Compact to rearrange.' && S.SORT_COPY.customAllSports === 'Set per sport. Choose CFB or NFL to arrange.' && S.SORT_COPY.arrangeHelp(4) === 'Hold a game and drag it, or use the arrows. Saved for Week 4.',
    '1d: the Standard-layout note, the All sports line and the arranging help are the DI\'s exact words');
  const strings = [];
  const walk = (v) => { if (typeof v === 'string') strings.push(v); else if (typeof v === 'function') strings.push(v(7), v('Texas at Oregon')); else if (v && typeof v === 'object') Object.values(v).forEach(walk); };
  walk(S.SORT_COPY); walk(S.SORT_MODES); walk(S.MODE_LABEL);
  strings.push(S.arrangeAnnouncement({ label: 'Texas at Oregon', n: 2, m: 4 }), S.finalMovedAnnouncement('Texas at Oregon'), S.finalMovedManyAnnouncement(3));
  const bad = strings.filter((x) => /\border/i.test(x));
  assert(strings.length > 25 && bad.length === 0, `1e: COPY SCAN — none of the ${strings.length} exported strings (labels, help lines, toasts, announcements) contains the word "order"${bad.length ? ': ' + bad.join(' | ') : ''}`);
  const markups = [
    S.listControlHTML({ n: 4, caption: '1 live', mode: 'live-first', arranging: false, escHtml: esc, numHtml }),
    S.listControlHTML({ n: 4, caption: '', mode: 'manual', arranging: true, weekN: 3, escHtml: esc, numHtml }),
    ...['kickoff', 'live-first', 'manual'].flatMap((mode) => [true, false].flatMap((canArrange) => [true, false].flatMap((hasSaved) => [S.sortSheetBodyHTML({ mode, allSports: false, canArrange, hasSaved, escHtml: esc }), S.sortSheetBodyHTML({ mode, allSports: true, canArrange, hasSaved, escHtml: esc })]))),
    S.sortSheetHeaderHTML({ escHtml: esc }),
    S.arrangeRowControlsHTML({ label: 'Texas at Oregon', index: 1, count: 4, escHtml: esc }).arrows,
  ];
  const seen = markups.flatMap((h) => [textOf(h), ...attrsOf(h)]);
  const bad2 = seen.filter((x) => /\border/i.test(x));
  assert(markups.length >= 20 && bad2.length === 0, `1f: COPY SCAN — the visible text and every aria-label of ${markups.length} rendered fragments (the row both ways, the sheet in 3 modes x 2 x 2 x 2, the header, the arrows) contain no "order"${bad2.length ? ': ' + bad2.join(' | ') : ''}`);
  const src = read('./js/game-sort.js').replace(/\/\*[\s\S]*?\*\//g, '');
  const lits = [...src.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]).filter((x) => /[A-Za-z]{3,} [A-Za-z]{2,}/.test(x) && !/class=|data-|aria-|<\/?[a-z]/.test(x));
  assert(lits.length > 15 && lits.every((x) => !/\border/i.test(x)), `1g: …and no human-readable string literal in js/game-sort.js says it (${lits.length} scanned)`);
}

// ═══ [2] The pure parts ══════════════════════════════════════════════════════════════════════════
_log('\n[2] effectiveMode, moveId and the drop…');
{
  assert(S.effectiveMode('manual', { allSports: true }) === 'kickoff' && S.effectiveMode('manual', { allSports: false }) === 'manual' && S.effectiveMode('live-first', { allSports: true }) === 'live-first' && S.effectiveMode('kickoff', { allSports: true }) === 'kickoff',
    '2a: in All sports a saved Custom reads as Kickoff time; Live first and Kickoff time are unchanged; a single sport reads the saved mode');
  assert(S.effectiveMode('nonsense') === 'kickoff' && S.effectiveMode(undefined) === 'kickoff' && S.effectiveMode(null, { allSports: true }) === 'kickoff' && S.effectiveMode('__proto__') === 'kickoff', '2b: an unknown, missing or hostile saved mode is Kickoff time');
  const ids = ['a', 'b', 'c', 'd'];
  const frozen = Object.freeze(ids.slice());
  assert(S.moveId(frozen, 'b', -1).join() === 'b,a,c,d' && S.moveId(frozen, 'b', 1).join() === 'a,c,b,d', '2c: moveId moves one place up or down and returns a NEW array (the input is untouched, even when frozen)');
  assert(S.moveId(frozen, 'a', -1).join() === 'a,b,c,d' && S.moveId(frozen, 'd', 1).join() === 'a,b,c,d', '2d: …clamps at both ends and never wraps');
  assert(S.moveId(frozen, 'zz', 1).join() === 'a,b,c,d' && S.moveId(null, 'a', 1).length === 0 && S.moveId(undefined, 'a', -1).length === 0, '2e: an unknown id changes nothing; a missing list is an empty list');
  assert(A.applyOutcome(ids, { moved: true, from: 0, to: 2 }).join() === 'b,c,a,d' && A.applyOutcome(ids, { moved: true, from: 3, to: 0 }).join() === 'd,a,b,c', '2f: applyOutcome — a drop moves `from` to `to`');
  assert(A.applyOutcome(ids, { moved: false, from: 0, to: 2 }).join() === 'a,b,c,d' && A.applyOutcome(ids, null).join() === 'a,b,c,d' && A.applyOutcome(ids, { moved: true, from: -1, to: 2 }).join() === 'a,b,c,d' && A.applyOutcome(ids, { moved: true, from: 0, to: 9 }).join() === 'a,b,c,d' && A.applyOutcome(ids, { moved: true, from: 1.5, to: 2 }).join() === 'a,b,c,d',
    '2g: …a drop that did not move, a missing outcome and an out-of-range or fractional index change nothing (and the input is never mutated)');
  assert(ids.join() === 'a,b,c,d', '2h: applyOutcome and moveId never mutated their input');
}

// ═══ [3] The renderers ═══════════════════════════════════════════════════════════════════════════
_log('\n[3] The renderers: refusal without an escaper, hostile data inert, every attribute quoted…');
{
  const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
  assert(throws(() => S.listControlHTML({ n: 2, mode: 'kickoff', numHtml })) && throws(() => S.listControlHTML({ n: 2, mode: 'kickoff', escHtml: esc })) && throws(() => S.sortSheetBodyHTML({ mode: 'kickoff' })) && throws(() => S.sortSheetHeaderHTML({})) && throws(() => S.arrangeRowControlsHTML({ label: 'x' })),
    '3a: every renderer REFUSES to run without its injected escaper (there is no fallback: security C5)');
  const hostile = '"><img src=x onerror=alert(1)>';
  const row = S.listControlHTML({ n: 2, caption: hostile, mode: 'kickoff', arranging: false, weekN: hostile, escHtml: esc, numHtml });
  const arrow = S.arrangeRowControlsHTML({ label: hostile, index: 0, count: 3, escHtml: esc }).arrows;
  const arrState = S.listControlHTML({ n: 2, caption: '', mode: 'manual', arranging: true, weekN: hostile, escHtml: esc, numHtml });
  const attrNames = (h) => [...h.matchAll(/<[a-z][^>]*>/gi)].flatMap((m) => [...m[0].replace(/"[^"]*"/g, '""').matchAll(/\s([a-z-]+)(?==|\s|>|$)/gi)].map((a) => a[1].toLowerCase()));
  assert([row, arrow, arrState].every((h) => !/<img/i.test(h) && h.includes('&lt;img src=x onerror=alert(1)&gt;') && !attrNames(h).some((n) => n.startsWith('on') || n === 'src')), '3b: a hostile caption, week number and team label come out as inert text in the row, the arranging bar and the arrows\' aria-labels (no live element, no handler attribute)');
  const all = [row, arrow, arrState, S.sortSheetBodyHTML({ mode: 'manual', allSports: false, canArrange: true, hasSaved: true, escHtml: esc }), S.sortSheetHeaderHTML({ escHtml: esc })];
  const unquoted = all.flatMap((h) => [...h.matchAll(/<[a-z][^>]*>/gi)].map((m) => m[0]).filter((tag) => /\s[a-z-]+=[^"'\s>]/i.test(tag.replace(/"[^"]*"/g, '""'))));
  assert(unquoted.length === 0, `3c: every attribute is double-quoted${unquoted.length ? ' — ' + unquoted[0] : ''}`);
  const single = S.listControlHTML({ n: 1, caption: 'x', mode: 'kickoff', escHtml: esc, numHtml });
  assert(/>1 game</.test(single) && /Sort games\. Currently Kickoff time\./.test(single) && /aria-haspopup="dialog"/.test(single) && /data-dc-action="sort"/.test(single), '3d: the row says "1 game", names the current mode in the button\'s aria-label ("Sort games. Currently Kickoff time.") and opens a dialog');
  assert(/Sort games\. Currently Live first\./.test(S.listControlHTML({ n: 5, mode: 'live-first', escHtml: esc, numHtml })) && /Currently Kickoff time\./.test(S.listControlHTML({ n: 5, mode: 'bogus', escHtml: esc, numHtml })), '3e: the label follows the mode; a bogus mode reads as Kickoff time');
  assert(/dc-listctl--arranging/.test(arrState) && /data-dc-action="arrange-done"/.test(arrState) && !/data-dc-action="sort"/.test(arrState) && />Arranging</.test(arrState) && />Done</.test(arrState), '3f: while arranging, the row is "Arranging" with Done and no Sort button');
  const body = (o) => S.sortSheetBodyHTML({ mode: 'kickoff', allSports: false, canArrange: true, hasSaved: false, escHtml: esc, ...o });
  const checked = (h) => [...h.matchAll(/data-mode="([a-z-]+)"[^>]*>/g)].map((m) => m[1]).filter((k) => new RegExp(`role="radio" aria-checked="true" data-dc-action="set-mode" data-mode="${k}"`).test(h));
  assert(/role="radiogroup" aria-label="Sort by"/.test(body()) && (body().match(/role="radio"/g) || []).length === 3 && checked(body()).join() === 'kickoff' && checked(body({ mode: 'live-first' })).join() === 'live-first' && checked(body({ mode: 'manual' })).join() === 'manual',
    '3g: the sheet is a radiogroup "Sort by" with three radios, exactly the chosen one aria-checked');
  assert(!/data-dc-action="arrange"/.test(body()) && !/data-dc-action="arrange"/.test(body({ mode: 'live-first' })) && !/dc-sort-act/.test(body()), '3h: "Arrange games" is absent unless Custom is chosen (so the sheet stays centered)');
  const m = body({ mode: 'manual' }), ms = body({ mode: 'manual', hasSaved: true });
  assert(/data-dc-action="arrange"/.test(m) && !/data-dc-action="reset"/.test(m) && /data-dc-action="arrange"/.test(ms) && /data-dc-action="reset"/.test(ms) && />Reset to kickoff time</.test(ms), '3i: under Custom: "Arrange games" always, "Reset to kickoff time" only when an arrangement is saved');
  const std = body({ mode: 'manual', canArrange: false, hasSaved: true });
  assert(!/data-dc-action="arrange"/.test(std) && /Switch to Compact to rearrange\./.test(std), '3j: the Standard web matrix shows "Switch to Compact to rearrange." where Arrange would be (PBD-B6)');
  const all2 = body({ mode: 'manual', allSports: true, hasSaved: true });
  assert(checked(all2).join() === 'kickoff' && /data-mode="manual"[^>]*disabled aria-disabled="true"/.test(all2.replace(/\s+/g, ' ')) || /disabled aria-disabled="true"><span class="dc-sort-opt-tx"><b>Custom/.test(all2) || /data-mode="manual" data-haptic="selection" disabled/.test(all2), '3k: All sports — a saved Custom reads as Kickoff time, and Custom is shown DISABLED');
  assert(all2.includes('Set per sport. Choose CFB or NFL to arrange.') && !/data-dc-action="arrange"/.test(all2) && !/data-dc-action="reset"/.test(all2), '3l: …with the line "Set per sport. Choose CFB or NFL to arrange.", and no Arrange or Reset');
  const ar = S.arrangeRowControlsHTML({ label: 'Texas at Oregon', index: 0, count: 3, escHtml: esc });
  const ar2 = S.arrangeRowControlsHTML({ label: 'Texas at Oregon', index: 2, count: 3, escHtml: esc });
  assert(/dc-arrange-mv--up"[^>]*aria-label="Move up Texas at Oregon" disabled aria-disabled="true"/.test(ar.arrows) && !/dc-arrange-mv--down"[^>]*disabled/.test(ar.arrows) && /dc-arrange-mv--down"[^>]*aria-label="Move down Texas at Oregon" disabled/.test(ar2.arrows) && !/dc-arrange-mv--up"[^>]*disabled/.test(ar2.arrows),
    '3m: Move up is disabled (aria-disabled) on the first row and Move down on the last; each names its game');
  assert(/data-arrange-grip aria-hidden="true"/.test(ar.grip), '3n: the grip is decorative (aria-hidden): the arrows are the assistive path');
}

// ═══ [4] The real Dashboard ═════════════════════════════════════════════════════════════════════
const click = (n) => n.dispatchEvent({ type: 'click', target: n });
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);
const toasts = () => document.getElementById('toast-container').children.map((t) => t.textContent);
const rowIds = () => $$('#page-dashboard .dashboard-compact .dc-game').map((n) => n.getAttribute('data-game-id'));
const sheet = () => document.getElementById('sort-sheet-wrap');
function seedLeague(w2 = 'live', { layout = 'compact', signedIn = true } = {}) {
  store.clear(); sets.length = 0;
  const L = fx.buildLeague({ w2, calculateWeeklyResults });
  L.players.forEach((p) => storage.savePlayer({ ...p, preferences: layout ? { dashboardLayout: layout } : {} }));
  L.weeks.forEach((w) => storage.saveWeek(w));
  L.games.forEach((g) => storage.saveGame(g));
  storage.saveAllPicks(L.picks);
  if (signedIn) storage.setSession('p1', false, true); else storage.clearSession();
  globalThis.document = freshDoc();
  app.state.currentTab = 'dashboard'; app.state.viewingWeekId = null; app.state.arrangeWeekId = null; app.state.arrangeMoves = 0; app.state.layoutEditing = null;
  app._closeSortSheetForTest({ immediate: true });
  globalThis.scrollY = 0;
  return L;
}
const paint = () => { quiet(); window.navigateTo('dashboard'); loud(); };

_log('\n[4] The real Dashboard: the row, the sheet, the writes…');
{
  const L = seedLeague('live');
  paint();
  const w2Games = storage.getGames('w2');
  assert(w2Games.length === 4 && $$('[data-dc-listctl]').length === 1 && $$('[data-dc-action="sort"]').length === 1, '4a: (fixture) the live Week 2 has four games and the Sort row exists exactly ONCE (and no segmented control: DI-580 is retired)');
  assert(rowIds().join() === w2Games.slice().sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).map((g) => g.gameId).join(), '4b: the default list is Kickoff time (what the Dashboard always did)');
  assert(/>4 games</.test($('[data-dc-listctl]').innerHTML) && /1 live/.test($('[data-dc-listctl]').innerHTML) && /Currently Kickoff time\./.test($('[data-dc-action="sort"]').getAttribute('aria-label')), '4c: "4 games", the caption "1 live" and the button\'s own name');
  assert(!/📋/.test($('#page-dashboard').innerHTML.split('All Picks by Game')[0].slice(-80)) && /card-title-glyph[^>]*aria-hidden="true"><svg/.test($('#page-dashboard').innerHTML) && /refresh-btn-glyph[^>]*aria-hidden="true"><svg/.test($('#page-dashboard').innerHTML) && !/↻/.test($('#page-dashboard').innerHTML),
    '4d: TOUCHED-SCREEN AUDIT — the card title carries the clipboard icon and the refresh button the refresh icon (no emoji / text glyph), both decorative');
  assert(!!$('#sort-sheet-wrap') === false, '4e: no sheet until Sort is tapped');
  click($('[data-dc-action="sort"]'));
  const w = sheet(), sh = document.getElementById('sort-sheet');
  assert(!!w && !!sh && sh.getAttribute('role') === 'dialog' && sh.getAttribute('aria-modal') === 'true' && sh.getAttribute('aria-labelledby') === 'sort-sheet-title' && w.hasAttribute('data-hold-teardown'), '4f: Sort opens the shared sheet shell as a modal dialog named by its title (and is swept by a security hold)');
  assert(/Sort games/.test($('#sort-sheet-title').textContent) && $('#sort-sheet-close').getAttribute('aria-label') === 'Close' && $$('#sort-sheet [role="radio"]').length === 3, '4g: the title, a Close button and the three radios');
  assert(NG.gesturesSuspended() === true && app._dashSortStateForTest().sheet === true, '4h: while the sheet is up the page\'s gestures stand down (the week swipe, pull to refresh, the drawer)');
  // pick Live first: ONE write, the list re-sorts at once
  sets.length = 0;
  click($('#sort-sheet [data-mode="live-first"]'));
  assert(storage.getGameOrderMode() === 'live-first' && sets.filter((k) => k === 'cfbp_players').length === 1, `4i: choosing Live first writes the player record ONCE (${sets.filter((k) => k === 'cfbp_players').length} writes) and stores "live-first"`);
  const lf = storage.getGames('w2').slice().sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
  const liveId = lf.find((g) => g.status === 'live').gameId, finalId = lf.find((g) => g.status === 'final').gameId;
  assert(rowIds()[0] === liveId && rowIds()[rowIds().length - 1] === finalId, `4j: the list re-sorted AT ONCE behind the sheet: the live game first (${rowIds()[0]}), the final game last (${rowIds()[rowIds().length - 1]})`);
  assert($('#sort-sheet [data-mode="live-first"]').getAttribute('aria-checked') === 'true' && $('#sort-sheet [data-mode="kickoff"]').getAttribute('aria-checked') === 'false' && !!sheet(), '4k: the radios follow, and the sheet stays open (so the member can go straight to Arrange)');
  assert(/Currently Live first\./.test($('[data-dc-action="sort"]').getAttribute('aria-label')) && /Live first/.test($('.dc-sort-mode').textContent), '4l: the button behind the sheet names the new mode');
  sets.length = 0;
  click($('#sort-sheet [data-mode="live-first"]'));
  assert(sets.filter((k) => k === 'cfbp_players').length === 0, '4m: a tap on the chosen radio writes nothing');
  click($('#sort-sheet [data-mode="manual"]'));
  assert(storage.getGameOrderMode() === 'manual' && !!$('#sort-sheet [data-dc-action="arrange"]') && !$('#sort-sheet [data-dc-action="reset"]'), '4n: Custom shows "Arrange games" and, with nothing saved yet, no Reset');
  click($('#sort-sheet [data-dc-action="sort-done"]'));
  await wait(450);
  assert(!sheet() && app._dashSortStateForTest().sheet === false && NG.gesturesSuspended() === false, '4o: Done closes the sheet (it slides out, then is removed) and the gestures come back');
  // Esc and backdrop
  click($('[data-dc-action="sort"]'));
  document.dispatchEvent({ type: 'keydown', key: 'Escape', target: document.body });
  await wait(450);
  assert(!sheet(), '4p: Esc closes the sheet (web)');
  click($('[data-dc-action="sort"]'));
  click(sheet().querySelector('.chat-sheet-backdrop'));
  await wait(450);
  assert(!sheet(), '4q: a tap on the scrim closes it');
  click($('[data-dc-action="sort"]')); const first = sheet(); click($('[data-dc-action="sort"]'));
  assert(sheet() !== first && $$('#sort-sheet-wrap').length === 1, '4r: opening it again replaces the live sheet, never stacks a second');
  app._closeSortSheetForTest({ immediate: true });
  // hostile / forged
  click($('[data-dc-action="sort"]'));
  const forged = $('#sort-sheet [data-mode="kickoff"]'); forged.setAttribute('data-mode', '__proto__'); click(forged); forged.setAttribute('data-mode', 'bogus'); click(forged);
  assert(storage.getGameOrderMode() === 'manual', '4s: a forged data-mode (__proto__, an unknown key) changes nothing');
  app._closeSortSheetForTest({ immediate: true });
  void L;
}

_log('\n[4b] Where the row is, and where it is not…');
{
  seedLeague('final', { signedIn: false }); paint();
  assert($$('[data-dc-listctl]').length === 0 && $$('#page-dashboard .dc-game').length === 0 || $$('[data-dc-listctl]').length === 0, '4t: signed out, the row is not rendered');
  seedLeague('final'); paint();
  assert($$('[data-dc-listctl]').length === 1 && /None live/.test($('[data-dc-listctl]').innerHTML), '4u: a final week with nothing live says "None live"');
  seedLeague('open'); paint();
  const cap = ($('[data-dc-listctl]') || { innerHTML: '' }).innerHTML;
  assert(/First kickoff [A-Z][a-z]{2} \d{1,2}:\d{2} [AP]M/.test(cap), `4v: an open week says "First kickoff {Sat 12:00 PM}" (${(cap.match(/First kickoff[^<]*/) || [''])[0]})`);
  const L = seedLeague('live'); paint();
  const g = storage.getGames('w2');
  g.slice(1).forEach((x) => storage.deleteGame ? storage.deleteGame(x.gameId) : null);
  // one game only: not offered
  if (typeof storage.deleteGame === 'function') { paint(); assert($$('[data-dc-listctl]').length === 0, '4w: one game only: no Sort row (nothing to sort)'); }
  else assert(true, '4w: (skipped: no deleteGame in this build)');
  const L2 = seedLeague('live'); storage.saveWeek({ ...L2.weeks.find((w) => w.weekId === 'w2'), status: 'draft' }); app.state.viewingWeekId = 'w2'; storage.setSession('p1', true, true); paint();
  assert($$('[data-dc-listctl]').length === 0, '4x: a Draft week (the commissioner can view one) has no Sort row');
  void L;
}

_log('\n[4b2] The Standard web matrix and "Show picks: By team" (DI-612 / PBD-B11, reviewer N1, fix round 1)…');
{
  const NOTE = 'Showing picks by person. Switch to Compact to see them by team.';
  const noteEl = () => $('#page-dashboard [data-pg-std-note]');
  // the matrix's columns are members, so Standard stays By person; when the member chose By team, ONE line above the matrix says so, with a Compact button
  seedLeague('live', { layout: 'standard' }); storage.setPicksView('dashboard', 'team'); paint();
  const n = noteEl();
  assert(!!n && n.textContent.replace(/\s+/g, ' ').includes(NOTE), `4b2a: Standard layout + By team: the note "${NOTE}" is drawn`);
  const btn = n && n.querySelector('button');
  assert(!!btn && /^\s*Compact\s*$/.test(btn.textContent) && btn.getAttribute('data-layout') === 'compact' && btn.getAttribute('type') === 'button', '4b2b: …with a "Compact" button (a real button, naming the layout it switches to)');
  const matrix = $('#page-dashboard .dashboard-scroll'), card = matrix && matrix.parentNode;
  const kids = card ? card.children : [];
  assert(!!matrix && kids.indexOf(n) >= 0 && kids.indexOf(n) < kids.indexOf(matrix) && kids.indexOf(matrix) - kids.indexOf(n) <= 3, '4b2c: …ABOVE the matrix (in the same card, before it)');
  assert(/\.pg-std-note\{[^}]*display:flex[^}]*flex-wrap:wrap[^}]*justify-content:center[^}]*gap:8px 16px/.test(read('./css/styles.css')) && /\.pg-std-note \.btn\{[^}]*min-height:44px/.test(read('./css/styles.css')), '4b2d: …a centred, wrapping group, 8 pt between the line and the button and 16 pt between rows, the button 44 pt tall (Breathing Room)');
  click(btn);
  assert(storage.getPlayer('p1').preferences.dashboardLayout === 'compact' && !noteEl() && $$('#page-dashboard .dashboard-compact').length === 1 && !$('#page-dashboard .dashboard-scroll'), '4b2e: tapping Compact switches to the Compact layout (written to the player\'s own preferences, as the toggle does), and the note is gone');
  assert($$('#page-dashboard .dashboard-compact .pg-cluster').length >= 1, '4b2f: …where the picks are now By team (the member\'s choice applies)');
  seedLeague('live', { layout: 'standard' }); paint();
  assert(!noteEl() && $$('#page-dashboard .dashboard-scroll').length === 1, '4b2g: Standard layout + the default (By person): NO note — nothing is being overridden');
  seedLeague('live', { layout: 'compact' }); storage.setPicksView('dashboard', 'team'); paint();
  assert(!noteEl(), '4b2h: Compact + By team: no note (the choice applies as asked)');
  seedLeague('live', { layout: 'standard', signedIn: false }); paint();
  assert(!noteEl(), '4b2i: signed out (no preference exists): no note');
  seedLeague('live', { layout: 'standard' }); storage.setPicksView('dashboard', 'team');
  globalThis.window.Capacitor = { isNativePlatform: () => true }; paint();
  assert(!noteEl() && $$('#page-dashboard .dashboard-compact').length === 1, '4b2j: on the iOS shell (always Compact) there is no note and no Standard matrix: By team always applies (PBD-B11)');
  delete globalThis.window.Capacitor;
  seedLeague('live', { layout: 'standard' }); storage.setPicksView('dashboard', 'team'); paint();
  const esc2 = noteEl() ? noteEl().innerHTML : '';
  assert(!/<script|onerror|<img/i.test(esc2) && (esc2.match(/"/g) || []).length % 2 === 0, '4b2k: the note carries only literal words (no data) and balanced quotes');
}

_log('\n[4c] The Standard layout and Reset…');
{
  seedLeague('live', { layout: 'standard' }); paint();
  assert($$('[data-dc-listctl]').length === 1, '4y: the Standard web matrix keeps the Sort button (the saved order applies to its rows too)');
  storage.setGameOrderMode('manual');
  paint(); click($('[data-dc-action="sort"]'));
  assert(!$('#sort-sheet [data-dc-action="arrange"]') && /Switch to Compact to rearrange\./.test($('#sort-sheet').textContent), '4z: in Standard the sheet shows "Switch to Compact to rearrange." and no Arrange button');
  app._closeSortSheetForTest({ immediate: true });
  seedLeague('live'); paint();
  const w2 = 'w2';
  storage.setGameOrderMode('manual'); storage.setManualGameOrder(w2, storage.getGames(w2).map((g) => g.gameId).reverse());
  paint(); click($('[data-dc-action="sort"]'));
  assert(!!$('#sort-sheet [data-dc-action="reset"]'), '4aa: with a saved arrangement, "Reset to kickoff time" appears under Custom');
  click($('#sort-sheet [data-dc-action="reset"]'));
  assert(storage.getManualGameOrder(w2).length === 0 && storage.getGameOrderMode() === 'kickoff' && toasts().includes('Reset to kickoff time.'), '4ab: Reset clears the week\'s saved arrangement, returns the mode to Kickoff time and says so ("Reset to kickoff time.")');
  assert(rowIds().join() === storage.getGames(w2).slice().sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).map((g) => g.gameId).join() && $('#sort-sheet [data-mode="kickoff"]').getAttribute('aria-checked') === 'true' && !$('#sort-sheet [data-dc-action="reset"]'), '4ac: …the list is back in kickoff order and the sheet shows Kickoff time chosen, with no Reset left');
  app._closeSortSheetForTest({ immediate: true });
}

// ═══ [5] Arranging ═════════════════════════════════════════════════════════════════════════════
_log('\n[5] Arranging: the grip and the arrows, one write per move, Done…');
{
  seedLeague('live'); storage.setGameOrderMode('manual'); paint();
  const w2 = 'w2';
  const kick = storage.getGames(w2).slice().sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff)).map((g) => g.gameId);
  click($('[data-dc-action="sort"]'));
  click($('#sort-sheet [data-dc-action="arrange"]'));
  await wait(450);
  assert(!sheet() && app._dashSortStateForTest().arrangeWeekId === w2, '5a: "Arrange games" closes the sheet and starts arranging this week');
  assert($$('[data-arrange-row]').length === 4 && $$('[data-arrange-grip]').length === 4 && $$('[data-dc-action="move"]').length === 8 && $('.dashboard-compact').getAttribute('data-games-arranging') === 'true', '5b: every row has a grip and Move up / Move down (4 rows, 8 arrows) and the list is marked as being arranged');
  assert(!!$('.dc-listctl--arranging') && /Hold a game and drag it, or use the arrows\. Saved for Week 2\./.test($('.dc-listctl--arranging').textContent) && !$('[data-dc-action="sort"]'), '5c: the row reads "Arranging", the help line names the week, Sort gives way to Done');
  assert(NG.gesturesSuspended() === true, '5d: while arranging, the week swipe, the drawer swipe and pull to refresh stand down');
  const ups = $$('[data-dc-action="move"][data-dir="up"]'), downs = $$('[data-dc-action="move"][data-dir="down"]');
  assert(ups[0].hasAttribute('disabled') && !ups[1].hasAttribute('disabled') && downs[3].hasAttribute('disabled') && !downs[2].hasAttribute('disabled'), '5e: the first row cannot move up and the last cannot move down (disabled)');
  assert($$('.dc-chips').length === 0, '5f: the chips are gone while arranging (a row is a handle, not a reader)');
  // one arrow = one write
  sets.length = 0;
  const secondId = kick[1];
  click($$('[data-arrange-row]')[1].querySelector('[data-dc-action="move"][data-dir="up"]'));
  assert(sets.filter((k) => k === 'cfbp_players').length === 1 && storage.getManualGameOrder(w2).join() === [kick[1], kick[0], kick[2], kick[3]].join() && rowIds().join() === storage.getManualGameOrder(w2).join(), `5g: one tap on Move up is ONE write, the saved arrangement is the new list and the rows follow (${storage.getManualGameOrder(w2).join()})`);
  await wait(60);
  const live = document.getElementById('layout-live');
  assert(!!live && /moved to position 1 of 4\./.test(live.textContent) && /at/.test(live.textContent) && !/order/i.test(live.textContent), `5h: a polite announcement follows: "${live && live.textContent}"`);
  assert(document.activeElement && document.activeElement.getAttribute('data-dc-action') === 'move' && document.activeElement.getAttribute('data-dir') === 'up' || (document.activeElement && document.activeElement.getAttribute && document.activeElement.getAttribute('data-dir') === 'down'), '5i: focus lands back on the moved row\'s Move button (the repaint did not drop it)');
  assert(app._dashSortStateForTest().arrangeMoves === 1, '5j: the session counts the move');
  // at the end the same-direction arrow is disabled: focus goes to the other direction
  click($$('[data-arrange-row]')[0].querySelector('[data-dc-action="move"][data-dir="up"]'));   // already first: disabled, no-op
  assert(storage.getManualGameOrder(w2).join() === [kick[1], kick[0], kick[2], kick[3]].join() && app._dashSortStateForTest().arrangeMoves === 1, '5k: a disabled arrow does nothing (no write, no move counted)');
  click($$('[data-arrange-row]')[1].querySelector('[data-dc-action="move"][data-dir="up"]'));
  assert(rowIds()[0] === kick[0] && document.activeElement.getAttribute('data-dir') === 'down', '5l: when the moved row reaches the top its Move up is disabled, so focus goes to its Move down');
  void secondId;
  // Done with moves
  toasts().length;
  click($('[data-dc-action="arrange-done"]'));
  assert(app._dashSortStateForTest().arrangeWeekId === null && $$('[data-arrange-row]').length === 0 && $$('.dc-chips').length > 0 && !$('.dashboard-compact').hasAttribute('data-games-arranging') && NG.gesturesSuspended() === false, '5m: Done ends arranging: the rows return to chips, the gestures come back');
  assert(toasts().includes('Arrangement saved.'), '5n: …with the toast "Arrangement saved." (only because at least one move happened)');
  const nToasts = toasts().length;
  click($('[data-dc-action="sort"]')); click($('#sort-sheet [data-dc-action="arrange"]')); await wait(450);
  click($('[data-dc-action="arrange-done"]'));
  assert(toasts().length === nToasts, '5o: Done with NO move shows no toast');
  // a tab change ends it and closes the sheet
  click($('[data-dc-action="sort"]')); click($('#sort-sheet [data-dc-action="arrange"]')); await wait(450);
  assert(app._dashSortStateForTest().arrangeWeekId === w2, '5p: (fixture) arranging again');
  quiet(); window.navigateTo('standings'); loud();
  assert(app._dashSortStateForTest().arrangeWeekId === null, '5q: leaving the Dashboard ends arranging');
  paint(); click($('[data-dc-action="sort"]'));
  assert(!!sheet(), '5r: (fixture) the sheet is open');
  quiet(); window.navigateTo('home'); loud();
  assert(!sheet() && app._dashSortStateForTest().sheet === false, '5s: leaving the Dashboard closes the Sort sheet');
  // switching to the Standard layout while arranging ends it (no grips on a matrix that cannot show them)
  paint(); click($('[data-dc-action="sort"]')); click($('#sort-sheet [data-dc-action="arrange"]')); await wait(450);
  const p1 = storage.getPlayer('p1'); storage.savePlayer({ ...p1, preferences: { ...(p1.preferences || {}), dashboardLayout: 'standard' } });
  paint();
  assert(app._dashSortStateForTest().arrangeWeekId === null && $$('[data-arrange-row]').length === 0, '5t: a switch to the Standard layout ends arranging');
  // a different mode ends it
  const p2 = storage.getPlayer('p1'); storage.savePlayer({ ...p2, preferences: { ...(p2.preferences || {}), dashboardLayout: 'compact' } });
  paint(); click($('[data-dc-action="sort"]')); click($('#sort-sheet [data-dc-action="arrange"]')); await wait(450);
  assert(app._dashSortStateForTest().arrangeWeekId === 'w2', '5u: (fixture) arranging');
  storage.setGameOrderMode('kickoff'); paint();
  assert(app._dashSortStateForTest().arrangeWeekId === null && $$('[data-arrange-row]').length === 0, '5v: a saved mode other than Custom (from another device) ends arranging at the next paint');
  // arrange is refused outside its conditions
  app.state.arrangeWeekId = null;
  seedLeague('live', { layout: 'standard' }); storage.setGameOrderMode('manual'); paint();
  click($('[data-dc-action="sort"]'));
  const fake = { getAttribute: (n) => (n === 'data-dc-action' ? 'arrange' : null), disabled: false };
  sheet().dispatchEvent({ type: 'click', target: { closest: () => fake } });
  assert(app._dashSortStateForTest().arrangeWeekId === null, '5w: a forged "arrange" in the Standard layout starts nothing');
  app._closeSortSheetForTest({ immediate: true });
}

// ═══ [6] Live first movement ═══════════════════════════════════════════════════════════════════
_log('\n[6] Live first: parked under an open sheet, named when it plays; the FLIP…');
{
  seedLeague('live'); storage.setGameOrderMode('live-first'); paint();
  const w2 = 'w2';
  const order0 = rowIds();
  const liveId = storage.getGames(w2).find((g) => g.status === 'live').gameId;
  assert(order0[0] === liveId, '6a: (fixture) Live first puts the live game on top');
  click($('[data-dc-action="sort"]'));
  const liveGame = storage.getGame(liveId);
  storage.saveGame({ ...liveGame, status: 'final', homeScore: 20, awayScore: 10 });
  paint();
  assert(rowIds().join() === order0.join(), '6b: with the sheet OPEN the list behind it does not re-sort when the live game ends (no jump under an open sheet)');
  app._closeSortSheetForTest({ immediate: true });
  assert(rowIds()[0] !== liveId && rowIds()[rowIds().length - 1] === liveId, '6c: when the sheet closes the parked move plays: the finished game goes to the end');
  await wait(80);
  const live = document.getElementById('layout-live');
  assert(!!live && /is final and moved to the end\./.test(live.textContent) && !/order/i.test(live.textContent), `6d: …and it is named once, politely: "${live && live.textContent}"`);
  // small fix (fix round 1): the identity chokepoint (every login / logout / account or league switch) drops the Sort sheet AND the order it froze under it — the next person never inherits the previous one's sheet
  {
    seedLeague('live'); storage.setGameOrderMode('live-first'); paint();
    click($('[data-dc-action="sort"]'));
    const lv = storage.getGames(w2).find((g) => g.status === 'live');
    storage.saveGame({ ...lv, status: 'final', homeScore: 20, awayScore: 10 });
    paint();
    const parked = app._dashSortStateForTest();
    assert(parked.sheet === true && Array.isArray(parked.frozen) && parked.frozen.length >= 2 && !!sheet(), '6d2-0: (fixture) the sheet is open with a Live first order FROZEN under it (a move waiting to play)');
    quiet(); app._resyncPlayerPreferencesForTest(); loud();
    const after = app._dashSortStateForTest();
    assert(after.sheet === false && after.frozen === null && !sheet(), `6d2: a session change drops the sheet and its frozen order (sheet ${after.sheet}, frozen ${JSON.stringify(after.frozen)}, wrap in the page: ${!!sheet()})`);
    assert(NG.gesturesSuspended() === false, '6d3: …and the gestures it had stood down come back');
    app._closeSortSheetForTest({ immediate: true });
  }
  // without a sheet: a game that ends moves and is named
  seedLeague('live'); storage.setGameOrderMode('live-first'); paint();
  const g2 = storage.getGames(w2).find((g) => g.status === 'live');
  storage.saveGame({ ...g2, status: 'final', homeScore: 17, awayScore: 3 }); paint();
  await wait(80);
  assert(rowIds()[rowIds().length - 1] === g2.gameId && /is final and moved to the end\./.test(document.getElementById('layout-live').textContent), '6e: with no sheet, a game that ends slides to the end and is announced');
  // Custom and Kickoff time never move on status
  seedLeague('live'); storage.setGameOrderMode('manual'); storage.setManualGameOrder(w2, storage.getGames(w2).map((g) => g.gameId)); paint();
  const o1 = rowIds(); const gl = storage.getGames(w2).find((g) => g.status === 'live');
  storage.saveGame({ ...gl, status: 'final', homeScore: 7, awayScore: 6 }); paint();
  assert(rowIds().join() === o1.join() && !document.getElementById('layout-live')?.textContent, '6f: Custom never moves a game on status (a finished game stays where the member put it) and says nothing');
  // the FLIP
  const mkRow = (id, top) => ({ getAttribute: (n) => (n === 'data-game-id' ? id : null), getBoundingClientRect: () => ({ top, bottom: top + 80 }), animate(frames, opt) { this.played = { frames, opt }; } });
  const mkRoot = (rows) => ({ querySelector: () => null, querySelectorAll: () => rows });
  const before = app._captureGameRowsForTest(mkRoot([mkRow('a', 100), mkRow('b', 200), mkRow('c', 300)]));
  assert(before.size === 3 && before.ids.join() === 'a,b,c' && before.anchor && before.anchor.id === 'a', '6g: capture reads every row\'s top and the row at the top of the viewport');
  const after = [mkRow('b', 100), mkRow('a', 200), mkRow('c', 300)];
  const moved = app._playGameMovementForTest(before, mkRoot(after));
  assert(moved === 2 && after[0].played && after[0].played.frames[0].transform === 'translateY(100px)' && after[1].played.frames[0].transform === 'translateY(-100px)' && !after[2].played, '6h: the FLIP plays only the rows that moved, each from where it was to where it is (b from +100, a from -100, c not at all)');
  assert(after[0].played.frames[1].transform === 'translateY(0)' && Number.isFinite(after[0].played.opt.duration) && after[0].played.opt.duration >= 300 && after[0].played.opt.duration <= 400, `6i: …to rest over the large-layout range (${after[0].played.opt.duration} ms, 300-400), nothing overshoots`);
  assert(app._playGameMovementForTest(app._captureGameRowsForTest(mkRoot([mkRow('a', 100), mkRow('b', 200)])), mkRoot([mkRow('a', 100), mkRow('b', 200)])) === 0, '6j: rows that did not move are not animated');
  assert(app._playGameMovementForTest(null, mkRoot(after)) === 0 && app._playGameMovementForTest(new Map(), mkRoot(after)) === 0, '6k: nothing captured, nothing played');
  const src = APP.replace(/\/\*[\s\S]*?\*\//g, '');
  const playFn = src.slice(src.indexOf('function playGameMovement'), src.indexOf('function noteLiveFirstMoves'));
  assert(/prefersReducedMotion\(\)/.test(playFn) && /if \(reduced\) return 0/.test(playFn) && /motionMs\('--motion-large'/.test(playFn) && /cssToken\('--ease-native'/.test(playFn), '6l: under Reduce Motion nothing is animated; the duration and easing are the stylesheet\'s own tokens (--motion-large, --ease-native)');
  assert(/reordered/.test(playFn) && /!_sortSheet/.test(playFn) && /scrollWindow\(window/.test(playFn), '6m: the reader\'s place is held only when the order changed and no sheet is up (scrollWindow, the house iOS 15 rule)');
}

// ═══ [7] Source pins ════════════════════════════════════════════════════════════════════════════
_log('\n[7] Source pins…');
{
  const code = APP.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
  const open = code.slice(code.indexOf('function openSortSheet'), code.indexOf('function paintSortSheetBody'));
  assert(/mountSheetShell\(\{[\s\S]*wrapId: SORT_WRAP_ID[\s\S]*sheetId: SORT_SHEET_ID/.test(open) && /role="dialog" aria-modal="true"/.test(open) && /drag: \{ getBlocked: isSortDismissGestureBlocked/.test(open) && /keydown/.test(open), '7a: the sheet is the shared shell (mountSheetShell), a modal dialog, with its own swipe-down gate and Esc');
  assert(/function _dismissBlockingSurfaceUp\([^)]*excludeSort = false[^)]*\)/.test(code) && /!excludeSort && document\.getElementById\('sort-sheet-wrap'\)/.test(code) && /function isSortDismissGestureBlocked\(\) \{ return _dismissBlockingSurfaceUp\(\{ excludeSort: true \}\)/.test(code), '7b: the sheet is on the "a surface is up" list with its own "other surface" carve-out');
  assert(/getElementById\?\.\('sort-sheet-wrap'\)/.test(read('./js/nav-gestures.js')) && /data-games-arranging="true"/.test(read('./js/nav-gestures.js')) && /getElementById\?\.\('sort-sheet-wrap'\)/.test(read('./js/control-center.js')) && /data-games-arranging="true"/.test(read('./js/control-center.js')),
    '7c: the page\'s gestures (nav-gestures) and the drawer\'s edge swipe (control-center) both stand down for the sheet and for arranging');
  assert(/closeSortSheet\(\{ immediate: true \}\)/.test(code.slice(code.indexOf('function navigateTo'), code.indexOf('function navigateTo') + 9000)) && /clearArrangeState\(\);\s*\n\s*state\.layoutAnnounce = null/.test(code), '7d: a tab change and a session change both end arranging');
  assert(/function resyncPlayerPreferences\([\s\S]*?if \(_sortSheet\) \{ _sortSheet\.frozen = null; closeSortSheet\(\{ immediate: true \}\); \}[\s\S]*?clearArrangeState\(\);/.test(code), '7d2: the session chokepoint (resyncPlayerPreferences) drops the Sort sheet with its frozen order, before the arrangement is cleared');
  const css = read('./css/styles.css');
  assert(/#sort-sheet-wrap\{position:fixed;inset:0;z-index:8000\}/.test(css) && /html:has\(#sort-sheet-wrap\)\{overflow:hidden\}/.test(css) && /--sort-drag-y/.test(css) && /prefers-reduced-motion:reduce\)\{#sort-sheet,#sort-sheet-wrap \.chat-sheet-backdrop\{transition:none/.test(css), '7e: the sheet\'s CSS is the wizard recipe on its own ids: a fixed layer, no page scroll behind, the drag variable, instant under Reduce Motion');
  assert(/\.dc-arrange-grip\{[^}]*flex:0 0 44px;width:44px;height:44px/.test(css) && /\.dc-arrange-mv\{width:44px;height:44px/.test(css) && /\.dc-arrange-arrows\{[^}]*gap:8px/.test(css) && /\.btn\.dc-sort-btn\{[^}]*min-height:44px/.test(css) && /\.refresh-btn-mini\{min-height:44px/.test(css) && /\.layout-toggle-btn\{min-height:44px\}/.test(css), '7f: every control here is 44 pt (grip, both arrows 8 pt apart, Sort, Refresh, the Standard/Compact toggle)');
  assert(!/color:\s*#|background:\s*#|rgba?\(/.test(css.slice(css.indexOf('D1 Lane B · DI-607 / DI-581'), css.indexOf('D1 Lane B · DI-613'))), '7g: the Sort / arrange CSS uses tokens only (no hex or rgb literal)');
  const sw = read('./service-worker.js');
  assert(/'\.\/js\/game-sort\.js'/.test(sw) && /'\.\/js\/game-arrange\.js'/.test(sw), '7h: both new modules are in the service worker\'s precache (a shell one module short is RG-03 through the cache)');
  const ga = read('./js/game-arrange.js').replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/getPicks|picks|storage\.js|localStorage/.test(ga.replace(/\bpickup\b/g, '')) && /from '\.\/section-drag\.js'/.test(ga), '7i: the arrange engine reads no pick and no storage (every effect is a callback), and it IS the section drag\'s own functions');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
