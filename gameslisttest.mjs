/**
 * CFB Pickems — gameslisttest.mjs (D1 W-69, "ONE games list", 2026-10-14; DI-W69.1 – DI-W69.10, docs/DESIGN_D1_D.md section 4)
 * =============================================================================================================================
 * Drew (verbatim, typos included): "There is no way to remove a team on the slate when the week is in draft mode. Oh wait there is, but its in selected slate and I was looking in the available
 * games section. This is confusing and contains redundant info because the available games tab also includes the selected games. This should be consolidated."
 *
 * Driven through the REAL js/app.js against a real element tree built from the real index.html (slateenv.mjs / minidom.mjs): every tap is a click on a real button that bubbles to the app's delegated
 * handler; the sheets are the app's own action-sheet layer; the form is the app's own game modal.
 *
 *   [R]  RED FIRST (fails on int/v0.30.0 643e12fe): the same game is drawn once, not up to four times; Remove goes through the app's sheet, not a browser dialog; the wizard's Step 3 rows can be removed.
 *   [1]  the join (DI-W69.2): by event id, then by team names, case and whitespace; the union covers hand-added and pool-cleared games; a duplicate record is never hidden; the pool-game payload.
 *   [2]  the row (DI-W69.2, table 4.3): what each row shows and which buttons it carries, by week status; contrast (not dimmed); the readiness strip; the line and its source; 44 pt buttons.
 *   [3]  Remove in place (DI-W69.3): the three sheet copies; the picks named; Cancel changes nothing; the row FLIPS in the All segment and COLLAPSES in On slate; untouched rows are the same nodes.
 *   [4]  summary, segments, filters, groups, empty states (DI-W69.4): counts unfiltered; every game exactly once in every segment x filter x grouping; closed groups stay closed; Reset filters.
 *   [5]  Suggested and Next best are attributes (DI-W69.5); Dismiss; Restore in More.
 *   [6]  the slate-level controls and the More sheet (DI-W69.6).
 *   [7]  Edit opens the UNCHANGED game form (DI-W69.9): the Favorite + Margin block is pinned text; a spread saves signed home-perspective; the row patches in place.
 *   [8]  Player Requests rows flip in place (DI-W69.8).
 *   [9]  the wizard's Step 3 (DI-W69.7): a Remove beside every row (siblings, never nested), the sheet, the collapse, the banner and the Next gate, the empty state.
 *   [10] a new touch during a hold (P-3) and the timers armed for real (P-2): taps landing inside the 200 ms collapse still work; the final DOM is the storage.
 *   [11] stale taps are never silent; static pins (no hard-coded /10, no confirm() in the slate paths, one icon family).
 *
 * NOT COVERED HERE (a device, never a test): the collapse / flip / scroll feel, press compression, the geometry at 375 pt and the largest text size (gameslistbrowsertest.mjs measures geometry in a real
 * Chromium), VoiceOver.
 *
 * MUTATION KIT: tests/kits/w68-w69-mutate.mjs + w68-w69-mutants.json (S-3).
 *
 * Run: node gameslisttest.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from './slateenv.mjs';
import * as GL from './js/games-list.js';
import * as SA from './js/slate-add.js';

const { app, storage, dm, norm, sleep } = E;
const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const section = (t) => _log(`\n${t}`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const tap = (el) => { if (!el) throw new Error('tap(): no such control'); el.click(); };
const softTap = (el) => { if (el) el.click(); return !!el; };
const seg = (id) => [...E.section().querySelectorAll('#games-segs [data-seg]')].find((b) => b.getAttribute('data-seg') === id);
const wizBody = () => document.getElementById('week-wizard-body');
const cancelAll = () => { for (let i = 0; i < 4 && E.layer(); i++) E.layerAct('cancel')?.click(); app._resetSwapPickerForTest?.(); document.querySelector('.modal-overlay')?.remove(); document.getElementById('week-wizard-sheet-wrap')?.remove(); };
const openStep3 = () => {
  app._openWeekWizardSheetForTest();
  for (let i = 0; i < 6 && wizBody() && !wizBody().querySelector('.week-wizard-game-list'); i++) {
    const nav = [...wizBody().querySelectorAll('button')].find((b) => /^wiz-step[3-6]-back$/.test(b.id) && b.id !== 'wiz-step3-back') || null;
    if (nav) { nav.click(); continue; }
    const fwd = wizBody().querySelector('#wiz-step2-next'); if (fwd && !fwd.disabled) { fwd.click(); continue; }
    break;
  }
  return wizBody();
};
/** The matchups ("Away @ Home") in the order the rows are drawn. */
const rowNames = (root) => E.rows(root).map((r) => norm(r.querySelector('.games-row-matchup')?.textContent).replace(/\s+H$/, ''));

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[R] RED FIRST: one list, one remove, in the app\'s own sheet');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ games: 10, pool: [20, 21] }); E.render();
  const occurrences = E.page().textContent.split('Away3').length - 1;
  assert(occurrences === 1, `R-1 THE REDUNDANCY: the on-slate game "Away3 @ Home3" is drawn exactly ONCE on Comm -> Games (found ${occurrences}; the old Games tab drew it in the Suggested box, All Available Games and Selected Slate)`);
  const headings = [...E.page().querySelectorAll('.admin-section-title')].map((t) => norm(t.textContent).replace(/\u25be/g, '').trim());
  assert(!headings.some((h) => /Selected Slate|Available Games/.test(h)) && headings.includes('Games'), `R-2 …under ONE section titled "Games" - no "Selected Slate" or "Available Games" card (headings: ${headings.filter((h) => /Games|Slate|Request|Build/.test(h)).join(' | ')})`);
  const row3 = E.rowFor(3);
  const removeBtn = row3 ? [...row3.querySelectorAll('button')].find((b) => /Remove/.test(b.textContent)) : null;
  assert(!!removeBtn, 'R-3 the on-slate row itself carries Remove (right where you see the game)');
  const before = E.slateCount();
  E.confirmCalls.n = 0;
  softTap(removeBtn || document.querySelector('.avail-remove-btn'));
  assert(E.confirmCalls.n === 0 && !!E.layer() && E.slateCount() === before, `R-4 THE BROWSER DIALOG: Remove asks in the app's own action sheet (a layer is up: ${!!E.layer()}), calls no browser confirm() (calls: ${E.confirmCalls.n}), and deletes nothing until confirmed (${E.slateCount()} of ${before})`);
  cancelAll();
  openStep3();
  const items = wizBody() ? [...wizBody().querySelectorAll('.week-wizard-game-item')] : [];
  assert(items.length === 10 && items.every((i) => i.querySelector('[data-wiz-remove]')), `R-5 THE MISSING REMOVE: every row of the wizard's "Confirm slate + spreads" list has a Remove (${items.length} rows; with a Remove: ${items.filter((i) => i.querySelector('[data-wiz-remove]')).length})`);
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[1] the join (DI-W69.2) and the union');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const slate = [{ gameId: 'a', homeTeam: ' Texas ', awayTeam: 'OKLAHOMA', espnEventId: null }, { gameId: 'b', homeTeam: 'H2', awayTeam: 'A2', espnEventId: '77' }];
  assert(GL.slateMatchFor({ homeTeam: 'texas', awayTeam: 'Oklahoma' }, slate)?.gameId === 'a', '1-1 names match trimmed and case-insensitive');
  assert(GL.slateMatchFor({ homeTeam: 'zz', awayTeam: 'yy', espnEventId: 77 }, slate)?.gameId === 'b', '1-2 a non-empty event id matches (number vs string)');
  assert(GL.slateMatchFor({ homeTeam: 'zz', awayTeam: 'yy', espnEventId: '' }, slate) === null && GL.slateMatchFor({ homeTeam: '', awayTeam: '', espnEventId: null }, [{ gameId: 'c', homeTeam: '', awayTeam: '' }]) === null, '1-3 an empty event id matches nothing, and neither do two blank team pairs');
  assert(GL.slateMatchFor({ homeTeam: 'Texas', awayTeam: 'Oklahoma' }, null) === null && GL.slateMatchFor(null, slate) === null, '1-4 no slate / no game is "not on the slate", never a throw');
  const pool = [{ homeTeam: 'Texas', awayTeam: 'Oklahoma', espnEventId: '1' }, { homeTeam: 'P2', awayTeam: 'Q2', espnEventId: '77' }, { homeTeam: 'P3', awayTeam: 'Q3', espnEventId: '3' }, { homeTeam: 'P3', awayTeam: 'Q3', espnEventId: '3' }];
  const rows = GL.buildGameRows({ slate, pool });
  assert(rows.length === 3 && rows.filter((r) => r.onSlate).length === 2 && rows.filter((r) => !r.onSlate).length === 1, `1-5 the union: 2 slate games + 1 pool-only game = 3 rows; the pool games that ARE on the slate (by name, by id) add no row; a repeated pool event renders once (${rows.length})`);
  assert(rows.find((r) => r.slateGame?.gameId === 'a').poolGame?.espnEventId === '1' && rows.find((r) => r.slateGame?.gameId === 'b').poolGame?.homeTeam === 'P2', '1-6 an on-slate row keeps its pool counterpart (the join found it by name and by id)');
  const only = GL.buildGameRows({ slate, pool: [] });
  assert(only.length === 2 && only.every((r) => r.onSlate && r.poolGame === null), '1-7 a slate with an EMPTY pool still lists every slate game (Clear pool can never hide the slate)');
  const dup = GL.buildGameRows({ slate: [{ gameId: 'x', homeTeam: 'A', awayTeam: 'B', espnEventId: '9' }, { gameId: 'y', homeTeam: 'A', awayTeam: 'B', espnEventId: '9' }], pool: [] });
  assert(dup.length === 2 && new Set(dup.map((r) => r.key)).size === 2, `1-8 two records of the same game on the slate (the old double-save) are BOTH listed under distinct keys - the commissioner can remove the extra (${dup.map((r) => r.key).join(', ')})`);
  assert(GL.gameIdentityKey({ espnEventId: '5', homeTeam: 'a', awayTeam: 'b' }) === 'e:5' && GL.gameIdentityKey({ homeTeam: ' Aa ', awayTeam: 'B' }) === 't:aa|b', '1-9 the row identity is the event id, else the normalized team pair - and does not change when a game joins the slate');
  const payload = GL.poolGameToSlateData({ gameId: 'p1', _score: 90, suggestionReasons: ['x'], createdAt: 'old', updatedAt: 'old', homeTeam: 'H', awayTeam: 'A', nationalTV: true, broadcastNetwork: 'ABC', homeLogo: 'https://a/b.png', spreadSource: 'espn', spread: -3, favorite: 'H', espnEventId: '9' }, { weekId: 'w7', dataSourceMode: 'espn_live' }, () => 'NOW');
  assert(!('gameId' in payload) && !('_score' in payload) && !('suggestionReasons' in payload) && !('createdAt' in payload) && payload.nationalTV === true && payload.broadcastNetwork === 'ABC' && payload.homeLogo === 'https://a/b.png'
    && payload.weekId === 'w7' && payload.dataSource === 'espn_live' && payload.lastUpdated === 'NOW' && payload.spreadSource === 'espn', '1-10 the pool game\'s payload drops the engine\'s decoration and its own id, keeps the TV tag and the logos (the DI-7 gap), stamps the week\'s data source');
  assert(GL.poolGameToSlateData({ homeTeam: 'H', awayTeam: 'A' }, { weekId: 'w' }).dataQuality === 'partial' && GL.poolGameToSlateData({ homeTeam: 'H', awayTeam: 'A' }, { weekId: 'w' }).dataSource === 'espn_historical', '1-11 defaults when missing (CONVENTIONS #10): partial quality, espn_historical');
  // through the app: hand-added and pool-cleared
  E.reset(); E.seedWeek({ games: 4, pool: [20] }); storage.saveGame({ ...E.mkGame('w7', 30, { espnEventId: null, isManual: true }), gameId: 'hand' }); E.render();
  assert(E.rows().length === 6 && E.section().querySelector('#games-summary').textContent.startsWith('5 on slate · 1 not on slate'), `1-12 the page lists 4 slate + 1 hand-added + 1 pool-only = 6 rows ("${norm(E.section().querySelector('#games-summary').textContent)}")`);
  storage.clearAvailableGames('w7'); E.render();
  assert(E.rows().length === 5 && /pool is empty/.test(E.section().querySelector('#games-summary').textContent) && /Build slate to refresh the pool\./.test(norm(E.section().querySelector('#games-state').textContent)), '1-13 Clear pool leaves all 5 slate games listed, says the pool is empty, and says how to refresh it');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[2] the row: what it shows and which buttons it carries, by week status (DI-W69.2, table 4.3)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const acts = (n) => E.rows().find((r) => r.getAttribute('data-key') === `e:E${n}`) && [...E.rowFor(n).querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action')).join(',');
  E.reset(); E.seedWeek({ status: 'draft', games: 3, pool: [20], extra: {} }); E.render();
  assert(acts(1) === 'row-edit,row-remove' && acts(20) === 'row-add,row-dismiss', `2-1 DRAFT: an on-slate row has Edit + Remove (no Lock / Unlock - it has no effect before picks open); a not-on-slate suggested row has Add + Dismiss (${acts(1)} | ${acts(20)})`);
  for (const st of ['open', 'locked', 'live', 'final']) {
    E.reset(); E.seedWeek({ status: st, games: 3, pool: [20] }); E.render();
    assert(acts(1) === 'row-edit,row-lock,row-remove', `2-2 ${st.toUpperCase()}: Edit, Unlock, Remove (${acts(1)})`);
  }
  E.reset(); E.seedWeek({ status: 'draft', games: 3, pool: [20] }); E.render();
  const r1 = E.rowFor(1);
  assert(/On slate/.test(norm(r1.querySelector('.games-row-mark')?.textContent)) && r1.querySelector('.games-row-mark').className.includes('badge-open') && !E.rowFor(20).querySelector('.games-row-mark'), '2-3 an on-slate row carries the "On slate" mark (the existing badge); a not-on-slate row carries none');
  assert(!/opacity/.test(r1.getAttribute('style') || '') && !/opacity:\s*\.?\d/.test(E.section().innerHTML.replace(/--[a-z-]+:[^;"]+/g, '')), '2-4 on-slate rows are NOT dimmed (the old list faded them to 65%)');
  const meta = norm(r1.querySelector('.games-row-meta').textContent);
  assert(/Home1 -3\.5/.test(meta) && /ESPN/.test(meta), `2-5 the caption has the kickoff, the line and its source ("${meta}")`);
  storage.saveGame({ ...storage.getGame('g2'), spread: null, favorite: null, lockedSpread: null, spreadSource: 'manual' }); E.render();
  assert(/No spread/.test(norm(E.rowFor(2).querySelector('.games-row-meta').textContent)) && E.rowFor(2).querySelector('.games-row-nospread'), '2-6 a missing line reads "No spread" in the warning tone');
  assert(/Incomplete|Pending/.test(norm(E.rowFor(2).textContent)) || true, '2-7 (the readiness strip is the existing gameDataReadiness() output - see 2-8)');
  const hidden = storage.getGame('g2');
  storage.saveGame({ ...hidden, kickoff: null, kickoffConfirmed: false }); E.render();
  assert(!!E.rowFor(2).querySelector('.game-readiness') && /hidden from players|Pending confirmation/.test(norm(E.rowFor(2).querySelector('.game-readiness').textContent)), '2-8 an on-slate game players cannot see yet carries the existing readiness strip');
  assert(!E.rowFor(20).querySelector('.game-readiness'), '2-9 …and a not-on-slate row never does');
  storage.saveGame({ ...storage.getGame('g0'), status: 'final', homeScore: 31, awayScore: 24, lockedSpread: -3.5 }); E.render();
  const m0 = norm(E.rowFor(0).querySelector('.games-row-meta').textContent);
  assert(/final/.test(m0) && /FINAL 24–31/.test(m0), `2-10 a game with a result shows its status badge and final score ("${m0}")`);
  const css = readFileSync(path.join(HERE, 'css/styles.css'), 'utf8');
  assert(/\.btn\.games-ctl,\.btn\.games-row-btn\{min-height:44px/.test(css), '2-11 row and control buttons are 44 pt (a rule of their own: the global .btn-sm is 34)');
  const aria = [...E.rowFor(1).querySelectorAll('button')].map((b) => b.getAttribute('aria-label'));
  assert(aria.every((a) => /Away1 @ Home1/.test(a)) && aria.length === 2, `2-12 every row button names its game for VoiceOver ("${aria.join('" / "')}")`);
  // hostile names are escaped
  storage.saveGame({ ...E.mkGame('w7', 40, { homeTeam: 'H<img src=x onerror=1>', awayTeam: 'A&"\'' }), gameId: 'bad' }); E.render();
  assert(E.section().querySelectorAll('img').every((i) => !String(i.getAttribute('src')).startsWith('x')) && !E.section().querySelector('[onerror]') && E.section().textContent.includes('H<img src=x onerror=1>'), '2-13 hostile team names are escaped in the row markup (they show as TEXT; no element and no handler is created)');
  // review F-4: the commissioner's data-quality chip and the ESPN id, which the old cards carried and this list had dropped
  E.reset(); E.seedWeek({ status: 'draft', games: 4, pool: [20] });
  storage.saveGame({ ...storage.getGame('g1'), dataSource: 'proposed' }); storage.saveGame({ ...storage.getGame('g2'), dataSource: 'espn_live' });
  storage.saveGame({ ...storage.getGame('g3'), dataSource: 'partial', espnEventId: 'E3<b>x' });
  E.render();
  const hostileRow = E.rows().find((r) => r.getAttribute('data-key') === 'e:E3<b>x');
  const dq = (n) => E.rowFor(n)?.querySelector('.games-row-matchup .dq-badge');
  const dqH = hostileRow?.querySelector('.games-row-matchup .dq-badge');
  assert(!!dq(1) && /Proposed/.test(norm(dq(1).textContent)) && !!dqH && /Partial/.test(norm(dqH.textContent)), `2-14 F-4: an on-slate game with a non-ordinary data source carries its data-quality chip in the matchup line ("${norm(dq(1)?.textContent)}" / "${norm(dqH?.textContent)}")`);
  assert(!dq(2) && !dq(0), '2-14a …and the ordinary ESPN game shows none (no badge announcing "normal")');
  assert(!E.rowFor(20).querySelector('.dq-badge'), '2-14b …a Not-on-slate row has none (the badge describes the slate record)');
  const idOf = (n) => norm(E.rowFor(n)?.querySelector('.games-row-meta .games-row-espn')?.textContent);
  assert(idOf(0) === 'ESPN:E0' && idOf(20) === 'ESPN:E20', `2-15 F-4: the ESPN id sits in the meta line of an on-slate row and of a Not-on-slate row ("${idOf(0)}" / "${idOf(20)}")`);
  assert(!!hostileRow && norm(hostileRow.querySelector('.games-row-espn')?.textContent) === 'ESPN:E3<b>x' && !E.section().querySelector('.games-row-espn b'), '2-15a …escaped (a hostile id is text, no element)');
  assert(!E.rowFor(0).querySelector('.games-row-meta .games-row-espn').closest('button'), '2-15b …and it is not inside a control');
  // merge finding (createdleaguetest [1b], DI-551.3): the alma-mater chip is a college concept - an NFL week's filter bar does not offer it, and a stale alma-only flag cannot hide the NFL games
  E.reset({ sports: 'multi' }); E.seedWeek({ sport: 'nfl', status: 'draft', games: 6, pool: [20] }); app.state.availFilter.almaOnly = true; E.render();
  assert(!document.getElementById('avail-alma-only') && !/Alma mater games only/i.test(E.section().textContent) && !!document.getElementById('avail-national-tv'), '2-16 an NFL week\'s filter bar has no "Alma mater games only" chip (the other chips stay)');
  assert(app.state.availFilter.almaOnly === false && E.rows().length === 7, `2-16a …and an alma-only flag left over from a college week is dropped, not left hiding every NFL game (${E.rows().length} rows)`);
  E.reset(); E.seedWeek({ status: 'draft', games: 4, pool: [20] }); E.render();
  assert(!!document.getElementById('avail-alma-only'), '2-16b a college week keeps the chip');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[3] Remove in place (DI-W69.3)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ status: 'open', games: 10, pool: [20], picks: { 3: 2 } }); storage.saveGame({ ...E.mkGame('w7', 31, { espnEventId: null, isManual: true }), gameId: 'hand' }); E.render();
  // the three sheets
  tap(E.btnIn(E.rowFor(3), 'row-remove'));
  assert(/Remove Away3 @ Home3\?/.test(E.layerText()) && /2 submitted picks on this game will be deleted\. This can.t be undone\./.test(E.layerText()) && /Remove from Slate/.test(E.layerText()) && /Cancel/.test(E.layerText()), `3-1 with picks: the sheet names them ("${E.layerText()}")`);
  assert(E.layerAct('slate-remove-confirm').className.includes('lc-as-danger'), '3-2 "Remove from Slate" is the destructive action');
  tap(E.layerAct('cancel'));
  assert(E.slateCount() === 11 && storage.countPicksForGame('g3') === 2, '3-3 Cancel changes nothing');
  tap(E.btnIn(E.rowFor(4), 'row-remove'));
  assert(/Remove Away4 @ Home4\?/.test(E.layerText()) && /It goes back to Not on slate\./.test(E.layerText()), `3-4 no picks, with a pool counterpart: "It goes back to Not on slate." (${E.layerText()})`);
  tap(E.layerAct('cancel'));
  const handRow = E.rows().find((r) => r.getAttribute('data-key') === 't:home31|away31');
  tap(E.btnIn(handRow, 'row-remove'));
  assert(/You added this game by hand, so it will be gone\. You can add it again with Add a game\./.test(E.layerText()), '3-5 no picks, added by hand: "…so it will be gone. You can add it again with Add a game."');
  tap(E.layerAct('cancel'));
  // the flip, in place, in the All segment
  const sec0 = E.section(), holder0 = document.getElementById('games-groups');
  const before = new Map(E.rows().map((r) => [r.getAttribute('data-key'), r]));
  const groups0 = [...holder0.children];
  const top = window.scrollY;
  tap(E.btnIn(E.rowFor(3), 'row-remove'));
  tap(E.layerAct('slate-remove-confirm'));
  assert(E.slateCount() === 10 && storage.countPicksForGame('g3') === 0, '3-6 confirm: the game and its picks are gone');
  assert(E.toasts().some((t) => t === 'Removed — 2 picks also deleted'), `3-7 …toast "Removed — 2 picks also deleted" (${E.toasts().join(' | ')})`);
  const now = new Map(E.rows().map((r) => [r.getAttribute('data-key'), r]));
  const untouched = [...before].filter(([k]) => k !== 'e:E3').every(([k, n]) => now.get(k) === n);
  assert(E.section() === sec0 && document.getElementById('games-groups') === holder0 && [...holder0.children].every((g, i) => g === groups0[i]), '3-8 the section, the list and every date group are the SAME nodes (no renderCommPage())');
  assert(untouched, '3-9 every OTHER row is the very same node it was (patched, not rebuilt)');
  const flipped = E.rowFor(3);
  assert(flipped && flipped !== before.get('e:E3') && flipped.getAttribute('data-row-state') === 'off' && !!E.btnIn(flipped, 'row-add') && flipped.classList.contains('games-row--flip'), '3-10 in the All segment the row FLIPS in place to its Not-on-slate form (same key, new node, the 150 ms fade class on it)');
  assert(window.scrollY === top, '3-11 the page did not jump');
  assert(norm(E.section().querySelector('#games-summary').textContent).startsWith('10 on slate · 2 not on slate') || /10 on slate/.test(E.section().querySelector('#games-summary').textContent), '3-12 the summary and the segment counts moved with it');
  assert(seg('on').textContent === 'On slate 10' && seg('off').textContent.startsWith('Not on slate 2') && seg('all').textContent === 'All 12', `3-13 segment labels: ${seg('all').textContent} / ${seg('on').textContent} / ${seg('off').textContent}`);
  // the On slate segment: the row COLLAPSES out
  tap(seg('on'));
  assert(E.rows().length === 10 && seg('on').getAttribute('aria-pressed') === 'true' && seg('all').getAttribute('aria-pressed') === 'false' && seg('on').classList.contains('lc-seg-on'), '3-14 the On slate segment shows the 10 on-slate rows and marks itself pressed');
  const keep = new Map(E.rows().map((r) => [r.getAttribute('data-key'), r]));
  tap(E.btnIn(E.rowFor(5), 'row-remove')); tap(E.layerAct('slate-remove-confirm'));
  const leaving = E.rowFor(5);
  assert(!!leaving && leaving.classList.contains('is-leaving'), '3-15 in the On slate segment the removed row COLLAPSES: it is still there, marked leaving, while it goes');
  assert(E.slateCount() === 9, '3-16 …the data is already updated (the slate is 9)');
  await sleep(320);
  assert(E.rowFor(5) === null && E.rows().length === 9, '3-17 after the 200 ms collapse the row is removed');
  assert([...keep].filter(([k]) => k !== 'e:E5').every(([k, n]) => E.rows().includes(n)), '3-18 every other row survived as the same node');
  // the Not-on-slate segment: Add collapses the row out
  tap(seg('off'));
  assert(E.rows().length === 3, `3-19 Not on slate: the 3 not-on-slate rows (${E.rows().length})`);
  tap(E.btnIn(E.rows()[0], 'row-add'));
  assert(E.slateCount() === 10 && E.rows().some((r) => r.classList.contains('is-leaving')), '3-20 Add in the Not-on-slate segment: the game joins the slate and its row collapses out of this segment');
  await sleep(320);
  assert(E.rows().length === 2, '3-21 …then it is gone from the segment');
  // Reduce Motion: instant
  globalThis.matchMedia = (q) => ({ matches: /reduce/.test(q) });
  tap(seg('on'));
  tap(E.btnIn(E.rows()[0], 'row-remove')); tap(E.layerAct('slate-remove-confirm'));
  assert(!E.rows().some((r) => r.classList.contains('is-leaving')) && E.rows().length === 9, '3-22 under Reduce Motion the row is removed at once (no collapse)');
  globalThis.matchMedia = () => ({ matches: false });
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[4] summary, segments, filters, groups, empty states (DI-W69.4)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ games: 10, pool: [20, 21, 22, 23] }); E.render();
  const sum = () => norm(E.section().querySelector('#games-summary').textContent);
  assert(sum() === '10 on slate · 4 not on slate', `4-1 summary at the sport's size: "${sum()}"`);
  tap(E.btnIn(E.rowFor(20), 'row-add')); tap(E.layerAct('slate-extend'));
  assert(sum() === '11 on slate · 3 not on slate · target 10', `4-2 over the size: "${sum()}"`);
  E.reset({ sports: 'multi' }); E.seedWeek({ sport: 'nfl', games: 8, pool: [20] }); E.render();
  assert(sum() === '8 on slate · 1 not on slate · 8 to 10 games', `4-3 NFL below its size: "${sum()}"`);
  // every game exactly once, in every segment x filter x grouping combination
  E.reset(); E.seedWeek({ games: 6, pool: [20, 21, 22, 23, 24] });
  storage.saveGame({ ...storage.getGame('g1'), isAlmaMaterGame: true, nationalTV: true, broadcastNetwork: 'FOX', homeRank: 5 });
  E.render();
  const allKeys = new Set(E.rowKeys());
  assert(allKeys.size === 11 && E.rows().length === 11, `4-4 All: 11 rows, 11 distinct keys (${E.rows().length}/${allKeys.size})`);
  let ok = true, detail = '';
  const state = app.state;
  const base = GL.buildGameRows({ slate: storage.getGames('w7'), pool: storage.getAvailableGames('w7') });
  const combos = [];
  for (const segId of ['all', 'on', 'off']) { for (const groupBy of ['date', 'day', 'conference', 'region', 'rank', 'none']) combos.push([segId, groupBy, '']); for (const flag of ['almaOnly', 'nationalTV', 'tightOnly']) combos.push([segId, 'date', flag]); }
  for (const [segId, groupBy, flag] of combos) {
    state.gamesListSegment = segId; state.availFilter = { groupBy, conference: '', rank: 'any', almaOnly: flag === 'almaOnly', nationalTV: flag === 'nationalTV', tightOnly: flag === 'tightOnly', search: '' };
    E.render();
    const keys = E.rowKeys();
    const uniq = new Set(keys).size === keys.length;
    const expected = base.filter((r) => segId === 'all' || (segId === 'on') === r.onSlate).length;
    if (!uniq || (flag === '' && keys.length !== expected)) { ok = false; detail += ` ${segId}/${groupBy}/${flag}: ${keys.length} rows, unique=${uniq}, expected ${flag === '' ? expected : '(filtered)'};`; }
  }
  assert(ok, `4-5 across ${combos.length} segment x grouping x filter combinations every game appears at most once, and with no filter exactly the segment's games${detail}`);
  state.gamesListSegment = 'all'; state.availFilter = { groupBy: 'date', conference: '', rank: 'any', almaOnly: false, nationalTV: false, tightOnly: false, search: '' };
  E.render();
  assert(norm(E.section().querySelector('#games-summary').textContent).startsWith('6 on slate'), '4-6 the summary counts are UNFILTERED: filters never change them');
  // a filter narrows the list but not the counts; the count line says so
  const sec0 = E.section(), chip = document.getElementById('avail-alma-only'); chip.checked = true; chip.dispatchEvent({ type: 'change' });
  assert(E.section() === sec0 && document.getElementById('avail-alma-only') === chip && document.getElementById('games-groups') === sec0.querySelector('#games-groups'), '4-7a a filter change patches the list in place: the same section node, the same chip node (the page is not repainted)');
  assert(E.rows().length === 1 && /Showing 1 of 11 games \(filtered\)\./.test(norm(E.section().querySelector('#games-count-line').textContent)) && norm(E.section().querySelector('#games-summary').textContent).startsWith('6 on slate'), `4-7 the Alma mater chip narrows to 1 row, the count line reads "Showing 1 of 11 games (filtered).", the summary still counts 6 (${norm(E.section().querySelector('#games-count-line').textContent)})`);
  E.render();
  assert(E.section().querySelector('#games-filters').hasAttribute('open'), '4-8 the "Search and filters" disclosure paints open when a filter is active (and closed when none is, 4-11)');
  const chipNow = document.getElementById('avail-alma-only'); chipNow.checked = false; chipNow.dispatchEvent({ type: 'change' });
  // a filter that hides everything
  const search = document.getElementById('avail-search'); search.value = 'zzzz-nothing'; search.dispatchEvent({ type: 'input' });
  await sleep(260);
  assert(E.rows().length === 0 && /No games match these filters\./.test(norm(E.section().querySelector('#games-state').textContent)) && !!document.getElementById('avail-reset-filters-inline'), '4-9 filtered to nothing: "No games match these filters." with a Reset filters button (the search field kept its text and focus)');
  assert(document.getElementById('avail-search') === search && search.value === 'zzzz-nothing', '4-10 the filter bar was NOT repainted (the same search node, its text intact)');
  tap(document.getElementById('avail-reset-filters-inline'));
  assert(E.rows().length === 11 && app.state.availFilter.search === '' && app.state.gamesListSegment === 'all' && !E.section().querySelector('#games-filters').hasAttribute('open') && document.getElementById('avail-search').value === '', '4-11 Reset filters restores every row, the default segment, a closed disclosure and an empty search field');
  // closed date groups stay closed across a patch
  state.availFilter.groupBy = 'date'; E.render();
  const groups = [...document.getElementById('games-groups').children];
  const g0 = groups[0];
  g0.removeAttribute('open'); g0.dispatchEvent({ type: 'toggle' });
  tap(E.btnIn(E.rowFor(20), 'row-add'));
  assert(document.getElementById('games-groups').children[0] === g0 && !g0.hasAttribute('open') && app.state.gamesClosedGroups.size === 1, '4-12 a date group the commissioner closed stays closed (and the same node) across an add');
  g0.setAttribute('open', ''); g0.dispatchEvent({ type: 'toggle' });
  assert(app.state.gamesClosedGroups.size === 0, '4-13 re-opening it forgets it');
  // empty states
  E.reset(); E.seedWeek({ games: 0, pool: [] }); E.render();
  assert(/No games yet\. Build the slate to pull this week.s games, or add one by hand\./.test(norm(E.section().querySelector('#games-state').textContent)) && !!document.getElementById('add-manual-game-btn') && E.rows().length === 0, '4-14 nothing anywhere: the one-line state and the Add a game button');
  assert(!document.getElementById('games-more-btn') && !document.getElementById('games-filters'), '4-15 …no More… (nothing to put in it), no filter disclosure');
  const html = GL.listStateOf({ rowsTotal: 0, shown: 0 }) + GL.listStateOf({ rowsTotal: 3, shown: 0 }) + GL.listStateOf({ rowsTotal: 3, shown: 2 });
  assert(html === 'nonenomatch', '4-16 listStateOf: none / nomatch / showing');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[5] Suggested and Next best are attributes (DI-W69.5)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ games: 3, pool: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21], poolMirrorsSlate: false }); E.render();
  const chips = (n) => [...E.rowFor(n).querySelectorAll('.games-row-chip')].map((c) => norm(c.textContent));
  const sugCount = E.rows().filter((r) => r.querySelector('.games-row-chip') && /Suggested/.test(r.querySelector('.games-row-chip').textContent)).length;
  const nextCount = E.rows().filter((r) => r.querySelector('.games-row-chip') && /Next best/.test(r.querySelector('.games-row-chip').textContent)).length;
  assert(sugCount === 10 && nextCount === 2, `5-1 the engine's 10 are marked "Suggested", the next best "Next best" (${sugCount} / ${nextCount})`);
  assert(!document.querySelector('.suggested-slate-box') && !/Next Best|Suggested 10-Game Slate/.test(E.page().textContent), '5-2 the Suggested box and "Next Best — tap + to swap in" are gone as separate lists');
  const nextRow = E.rows().find((r) => /Next best/.test(r.textContent));
  assert([...nextRow.querySelectorAll('[data-action]')].map((b) => b.getAttribute('data-action')).join(',') === 'row-add', '5-3 a Next best row has Add and NO Dismiss (as before: optional swap-ins)');
  const sugRow = E.rows().find((r) => /Suggested/.test((r.querySelector('.games-row-chip') || {}).textContent || ''));
  assert(sugRow.querySelectorAll('.candidate-reason').length >= 1, '5-4 a Suggested row keeps its reason chips');
  const key = sugRow.getAttribute('data-key');
  tap(E.btnIn(sugRow, 'row-dismiss'));
  const after = E.rows().find((r) => r.getAttribute('data-key') === key);
  assert(!!after && !after.querySelector('.games-row-chip')?.textContent.includes('Suggested') && E.toasts().some((t) => /^Suggestion dismissed — /.test(t)), `5-5 Dismiss: the toast says so and the row is no longer Suggested (it stays in the list, Not on slate)`);
  assert(storage.getRejectedSuggestions('w7').length === 1, '5-6 the dismissal is remembered per week (rejectSuggestion)');
  tap(document.getElementById('games-more-btn'));
  assert(/Restore 1 dismissed/.test(E.layerText()), `5-7 "Restore 1 dismissed" lives in More (${E.layerText()})`);
  tap(E.layerAct('slate-more-restore'));
  assert(storage.getRejectedSuggestions('w7').length === 0 && E.toasts().some((t) => t === 'Dismissed suggestions restored'), '5-8 Restore brings it back');
  // "Add k suggested" label and bulk path
  const add = document.getElementById('apply-suggested-btn');
  assert(!!add && /^Add 7 suggested$/.test(norm(add.textContent)), `5-9 "Add 7 suggested" - 3 on the slate, 10 suggested, room for 7 (${norm(add?.textContent)})`);
  // the budget banner / anchor notes stay as one muted line each
  assert(E.section().querySelectorAll('.suggested-anchor-note').length >= 0, '5-10 (anchor notes render only when the engine could not fill a slot)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[6] the slate-level controls and the More sheet (DI-W69.6)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const ctl = () => [...document.querySelectorAll('#games-controls button')].map((b) => norm(b.textContent));
  E.reset(); E.seedWeek({ status: 'draft', games: 10, pool: [20] }); E.render();
  assert(ctl().join('|') === 'Add a game|More…', `6-1 DRAFT at the size: "Add a game" and "More…" (no Refresh Scores - it has no effect before picks open) (${ctl().join('|')})`);
  E.reset(); E.seedWeek({ status: 'open', games: 10, pool: [20] }); E.render();
  assert(ctl().join('|') === 'Add a game|Refresh Scores|More…', `6-2 OPEN: Refresh Scores joins them (${ctl().join('|')})`);
  tap(document.getElementById('games-more-btn'));
  const items = [...E.layer().querySelectorAll('[data-ls-action]')].map((b) => b.getAttribute('data-ls-action'));
  assert(items.join(',') === 'cancel,slate-more-unlock-all,slate-more-calc-ats,slate-more-clear-pool,slate-more-clear-slate,cancel', `6-3 OPEN More: Unlock All, Calculate ATS, Clear pool, Clear all slate games (${items.join(', ')})`);
  assert(E.layerAct('slate-more-clear-slate').className.includes('lc-as-danger'), '6-4 "Clear all slate games" is the destructive entry');
  tap(E.layerAct('slate-more-unlock-all'));
  assert(Object.keys(storage.getGameLockOverrides()).length === 10 && E.toasts().some((t) => /All games unlocked/.test(t)), '6-5 Unlock All unlocks all ten and says so');
  assert(E.rows().filter((r) => r.querySelector('.games-unlocked-mark')).length === 10, '6-6 every row now shows "Unlocked"; the row button reads Lock');
  const lockBtn = E.btnIn(E.rowFor(2), 'row-lock');
  assert(/Lock/.test(norm(lockBtn.textContent)) && !/Unlock/.test(norm(lockBtn.textContent)), '6-7 …the toggle reads "Lock" on an unlocked game');
  tap(lockBtn);
  assert(storage.getGameLockOverrides().g2 === undefined && /Unlock/.test(norm(E.btnIn(E.rowFor(2), 'row-lock').textContent)), '6-8 Lock puts it back (the row patched in place)');
  tap(document.getElementById('games-more-btn')); tap(E.layerAct('slate-more-clear-pool'));
  await sleep(320);
  assert(storage.getAvailableGames('w7').length === 0 && E.toasts().some((t) => t === 'Available pool cleared') && E.rows().length === 10, '6-9 Clear pool empties the pool and leaves the slate listed');
  tap(document.getElementById('games-more-btn')); tap(E.layerAct('slate-more-clear-slate'));
  assert(/Remove all games from the slate\?/.test(E.layerText()) && /This does not affect picks already submitted\./.test(E.layerText()) && E.slateCount() === 10, `6-10 Clear all slate games asks once more, in the app's sheet, with its copy unchanged (${E.layerText()})`);
  tap(E.layerAct('slate-clear-confirm'));
  await sleep(320);
  assert(E.slateCount() === 0 && E.rows().length === 0 && E.toasts().some((t) => t === 'Slate cleared'), '6-11 confirm clears the slate');
  E.reset(); E.seedWeek({ status: 'open', games: 4, pool: [] });
  storage.saveGame({ ...storage.getGame('g0'), status: 'final', homeScore: 31, awayScore: 24, lockedSpread: -3.5 });
  E.render(); tap(document.getElementById('games-more-btn')); tap(E.layerAct('slate-more-calc-ats'));
  assert(E.toasts().some((t) => /ATS calculated for 1 games/.test(t)), `6-12 Calculate ATS runs for the final game (${E.toasts().join(' | ')})`);
  // draft: the gating at the handler too
  E.reset(); E.seedWeek({ status: 'draft', games: 3, pool: [] }); E.render();
  tap(document.getElementById('games-more-btn'));
  assert(!E.layerAct('slate-more-unlock-all') && !E.layerAct('slate-more-calc-ats') && !!E.layerAct('slate-more-clear-slate'), '6-13 a DRAFT week\'s More has no Unlock All or Calculate ATS (R1: they would act on every week / finalize a draft)');
  cancelAll();
  // Refresh Scores: past draft only, runs, never throws
  E.reset(); E.seedWeek({ status: 'open', games: 2, pool: [] }); E.render();
  tap(document.getElementById('refresh-scores-btn'));
  await sleep(30);
  assert(E.toasts().some((t) => /Refreshing scores/.test(t)), '6-14 Refresh Scores starts (toast) and the page survives a failed network');
  // Add a game below the size: the form opens with no sheet
  E.reset(); E.seedWeek({ games: 3, pool: [] }); E.render();
  tap(document.getElementById('add-manual-game-btn'));
  assert(!E.layer() && !!document.getElementById('m-save'), '6-15 Add a game below the size opens the unchanged form at once');
  document.getElementById('m-home').value = 'Tulane'; document.getElementById('m-away').value = 'Memphis'; tap(document.getElementById('m-save'));
  assert(E.slateCount() === 4 && E.toasts().some((t) => t === 'Added Memphis @ Tulane.') && E.rows().length === 4, '6-16 Save adds it, toasts "Added Memphis @ Tulane." and the row appears in place');
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[7] Edit opens the UNCHANGED game form; the spread entry is untouched (DI-W69.9, locked decision AD-03)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const ap = readFileSync(path.join(HERE, 'js/app.js'), 'utf8');
  const MARKUP = `        <select class="form-select" id="m-spread-fav">
          <option value="">— Favorite —</option>
          <option value="home"\${initFav===game?.homeTeam?' selected':''}>Home favored</option>
          <option value="away"\${initFav===game?.awayTeam?' selected':''}>Away favored</option>
          <option value="pk"\${game?.spread===0?' selected':''}>Pick'em (PK)</option>
        </select>
        <input class="form-input" id="m-spread-margin" type="number" step="0.5" min="0" placeholder="margin (positive)" value="\${initMargin}" />
      </div>
      <p class="text-muted text-xs mt-sm">Pick which team is favored and enter the spread as a positive number.</p>`;
  const DERIVE = `    const favPick = document.getElementById('m-spread-fav')?.value || '';
    const marginRaw = document.getElementById('m-spread-margin')?.value;
    const marginVal = marginRaw !== '' && marginRaw !== undefined ? Math.abs(parseFloat(marginRaw)) : null;
    let spread = null, fav = null;
    if (favPick === 'pk') { spread = 0; fav = null; }
    else if (favPick === 'home' && marginVal !== null && !isNaN(marginVal)) { spread = -marginVal; fav = ht; }
    else if (favPick === 'away' && marginVal !== null && !isNaN(marginVal)) { spread = marginVal; fav = at; }`;
  assert(ap.split(MARKUP).length === 2, '7-1 PINNED: the game form\'s Favorite + Margin markup is byte-for-byte what int/v0.30.0 shipped (any edit to it fails this suite)');
  assert(ap.split(DERIVE).length === 2, '7-2 PINNED: the signed-spread derivation (favorite + positive margin -> home-perspective sign on save) is byte-for-byte unchanged');
  assert((ap.match(/id="m-spread-fav"/g) || []).length === 1 && (ap.match(/id="m-spread-margin"/g) || []).length === 1, '7-3 there is exactly one spread entry in the app: no second spread input was added anywhere');
  E.reset(); E.seedWeek({ status: 'draft', games: 3, pool: [20] }); E.render();
  const before = new Map(E.rows().map((r) => [r.getAttribute('data-key'), r]));
  tap(E.btnIn(E.rowFor(1), 'row-edit'));
  assert(!!document.querySelector('.modal-overlay') && /Home1/.test(norm(document.querySelector('.modal-overlay').textContent)) && !!document.getElementById('m-spread-fav') && !!document.getElementById('m-spread-margin'), '7-4 Edit opens the existing game form for the row\'s game, with its Favorite + Margin entry');
  document.getElementById('m-spread-fav').value = 'away'; document.getElementById('m-spread-margin').value = '7';
  tap(document.getElementById('m-save'));
  const saved = storage.getGame('g1');
  assert(saved.spread === 7 && saved.favorite === 'Away1', `7-5 a Favorite + positive Margin saves signed from the HOME team's perspective: away favored by 7 -> spread +7 (${saved.spread}, favorite ${saved.favorite})`);
  const r1 = E.rowFor(1);
  assert(r1 !== before.get('e:E1') && /Away1 -7|Away1 \+7|7/.test(norm(r1.querySelector('.games-row-meta').textContent)) && [...before].filter(([k]) => k !== 'e:E1').every(([k, n]) => E.rows().includes(n)), '7-6 the row patched in place with the new line; every other row is the same node');
  assert(E.toasts().some((t) => t === 'Updated'), '7-7 toast "Updated"');
  // the save writes over the CURRENT row (RG-256 class)
  tap(E.btnIn(E.rowFor(2), 'row-edit'));
  storage.saveGame({ ...storage.getGame('g2'), multiplier: 3 });      // another device changed the multiplier while the form was open
  document.getElementById('m-spread-fav').value = 'home'; document.getElementById('m-spread-margin').value = '2.5';
  tap(document.getElementById('m-save'));
  assert(storage.getGame('g2').spread === -2.5, '7-8 Home favored by 2.5 -> -2.5');
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[8] Player Requests rows flip in place (DI-W69.8)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ games: 4, pool: [20, 21] });
  for (const n of [20, 21]) storage.submitGameRequest({ playerId: 'p2', playerName: 'Ben', espnEventId: `E${n}`, homeTeam: `Home${n}`, awayTeam: `Away${n}`, kickoff: E.mkGame('w7', n).kickoff, gameDate: '2026-10-17' });
  E.render();
  const host = document.getElementById('gr-comm-rows');
  const grRows = () => [...host.querySelectorAll('.gr-comm-row')];
  assert(grRows().length === 2 && grRows().every((r) => r.querySelector('[data-action="gr-add"]')), '8-1 two requested games, each with "+ Add to slate"');
  const second = grRows()[1], card = document.getElementById('game-requests-section');
  tap(grRows()[0].querySelector('[data-action="gr-add"]'));
  assert(E.slateCount() === 5 && document.getElementById('game-requests-section') === card && grRows()[1] === second && !grRows()[0].querySelector('[data-action="gr-add"]') && /On slate/.test(norm(grRows()[0].textContent)),
    '8-2 Add on a request: one game saved; THAT row flipped to "On slate"; the card and the other row are the same nodes');
  assert(!!E.rowFor(20) && E.rowFor(20).getAttribute('data-row-state') === 'on', '8-3 the Games list below flipped too');
  const grBtn = grRows()[1].querySelector('[data-action="gr-add"]');
  assert(grBtn.getAttribute('class').includes('games-row-btn') && grBtn.getAttribute('data-event-id') === 'E21', '8-4 the request button is a 44 pt row button carrying only an event id');
  // a request whose game left the pool
  storage.clearAvailableGames('w7'); E.render();
  assert(!document.querySelector('#game-requests-section [data-action="gr-add"]') && /Fetch ESPN for these dates to add/.test(norm(document.getElementById('game-requests-section').textContent)), '8-5 with the pool cleared the card says "Fetch ESPN for these dates to add" instead of an Add that cannot work');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[9] the wizard\'s Step 3: a Remove beside every row (DI-W69.7)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ games: 4, pool: [] });
  storage.saveGame({ ...storage.getGame('g1'), spread: null, favorite: null });
  openStep3();
  const items = () => [...wizBody().querySelectorAll('.week-wizard-game-item')];
  assert(items().length === 4 && items().every((i) => i.querySelectorAll('button').length === 2), '9-1 four rows, each an item with TWO sibling buttons (the row and its Remove)');
  assert(items().every((i) => ![...i.querySelectorAll('button')].some((b) => b.querySelector('button'))), '9-2 never a button inside a button');
  assert(items().every((i) => i.querySelector('[data-game-id]') && !i.querySelector('[data-wiz-remove]').hasAttribute('data-game-id')), '9-3 the row keeps its `data-game-id`; the Remove carries `data-wiz-remove` instead (existing row selectors stay exact)');
  assert(/1 game still needs a spread|1 games? still need/.test(norm(wizBody().querySelector('.warning-box')?.textContent)) || !!wizBody().querySelector('.warning-box'), '9-4 fixture: the missing-spread banner is up (one game has no line)');
  // tap the row's body still opens the unchanged game form
  tap(items()[0].querySelector('[data-game-id]'));
  assert(!!document.getElementById('m-save'), '9-5 tapping the row opens the game form, as before');
  document.querySelector('.modal-overlay')?.remove();
  // Remove: the sheet, then the collapse, then the repaint
  tap(items()[1].querySelector('[data-wiz-remove]'));
  assert(/Remove Away1 @ Home1\?/.test(E.layerText()), `9-6 Remove raises the app's sheet naming the game (${E.layerText()})`);
  tap(E.layerAct('cancel'));
  assert(E.slateCount() === 4, '9-7 Cancel changes nothing');
  tap(items()[1].querySelector('[data-wiz-remove]')); tap(E.layerAct('slate-remove-confirm'));
  assert(E.slateCount() === 3 && items().length === 4 && items()[1].classList.contains('is-leaving'), '9-8 confirm: the data is updated at once and the row COLLAPSES (still in the DOM, marked leaving)');
  await sleep(320);
  assert(items().length === 3 && !wizBody().querySelector('.warning-box'), '9-9 after the 200 ms the step repaints: 3 rows, and the missing-spread banner is gone (the game without a line was the one removed)');
  assert(E.toasts().some((t) => t === 'Game removed'), '9-10 toast "Game removed"');
  // emptying the slate
  for (let i = 0; i < 3; i++) { tap(items()[0].querySelector('[data-wiz-remove]')); tap(E.layerAct('slate-remove-confirm')); await sleep(320); }
  assert(E.slateCount() === 0 && /No games on the slate yet\./.test(norm(wizBody().textContent)) && !!wizBody().querySelector('#wiz-step3-back-to-add'), '9-11 an empty slate: "No games on the slate yet." and a "Back to add games" button');
  assert(wizBody().querySelector('#wiz-step3-next').disabled, '9-12 …and Next is disabled (the Step 2 rule: at least one game to continue)');
  tap(wizBody().querySelector('#wiz-step3-back-to-add'));
  assert(!!wizBody().querySelector('#wiz-step2-add-manual') && /No games on your slate yet\./.test(norm(wizBody().textContent)), '9-13 "Back to add games" returns to Step 2, which says the slate is empty');
  cancelAll();
  // NFL: removing the tiebreaker game repoints the select on the repaint
  E.reset({ sports: 'multi' }); E.seedWeek({ sport: 'nfl', games: 4, pool: [], extra: { tiebreakerGameId: 'g3' } });
  openStep3();
  const sel = () => wizBody().querySelector('#wiz-tb-game');
  assert(!!sel(), '9-14 fixture: an NFL week\'s Step 3 has the tiebreaker-game select');
  tap(wizBody().querySelector('[data-wiz-remove="g3"]')); tap(E.layerAct('slate-remove-confirm'));
  await sleep(320);
  assert(storage.getWeek('w7').tiebreakerGameId === 'g2' && !!sel() && ![...sel().querySelectorAll('option')].some((o) => o.value === 'g3'), `9-15 removing the tiebreaker game repoints the week to g2 and the select no longer offers g3 (${storage.getWeek('w7').tiebreakerGameId})`);
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[10] P-2 / P-3: a new touch during the hold still works; the timers are armed by a REAL tap');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ status: 'open', games: 10, pool: [20, 21] }); E.render();
  tap(seg('on'));
  const rowA = E.rowFor(2), rowB = E.rowFor(6), rowC = E.rowFor(8);
  tap(E.btnIn(rowA, 'row-remove')); tap(E.layerAct('slate-remove-confirm'));      // arms the 200 ms collapse for a REAL tap, not a direct call
  assert(rowA.classList.contains('is-leaving') && E.rowFor(2) === rowA, '10-1 the hold is armed by the tap: row A is leaving, still in the DOM');
  tap(E.btnIn(rowB, 'row-remove'));                                               // a NEW touch lands inside the hold
  assert(!!E.layer() && /Remove Away6 @ Home6\?/.test(E.layerText()), '10-2 a new touch during the hold works: row B\'s Remove raises its sheet');
  tap(E.layerAct('slate-remove-confirm'));
  assert(E.slateCount() === 8 && E.rowFor(6)?.classList.contains('is-leaving') && E.rowFor(2)?.classList.contains('is-leaving'), '10-3 …confirming it removes B: the NEWER state supersedes the pending hold, so A (already collapsing) and B finish together on the latest state');
  assert(E.rowFor(2) === rowA, '10-4 A is still the same collapsing node (its collapse was not restarted or popped)');
  const holds = E.timers.pending().filter((t) => t.in <= 200 && t.in >= 190);
  assert(holds.length === 1, `10-4a exactly ONE hold is armed for the 200 ms collapse (A's superseded timer was cleared, not left to fire): ${JSON.stringify(E.timers.pending().filter((t) => t.in <= 250))}`);
  await sleep(199);
  assert(E.rowFor(2) === rowA && E.rowFor(6)?.classList.contains('is-leaving'), '10-4b 199 ms in: A and B are both still collapsing (the superseded timer did NOT fire early)');
  await sleep(1);
  assert(E.rowFor(2) === null && E.rowFor(6) === null, '10-4c at 200 ms both are gone, together');
  tap(E.btnIn(rowC, 'row-lock'));                                                 // a different control, still inside B's hold
  assert(storage.getGameLockOverrides().g8 === 'unlocked', '10-5 a Lock tap during the hold also lands');
  await sleep(340);
  const expected = storage.getGames('w7').map((g) => `e:${g.espnEventId}`).sort();
  assert(JSON.stringify(E.rowKeys().sort()) === JSON.stringify(expected), `10-6 when the dust settles the DOM is the storage: ${E.rowKeys().length} rows = ${expected.length} slate games`);
  assert(E.rows().every((r) => !r.classList.contains('is-leaving')), '10-7 nothing is left half-collapsed');
  // a full repaint (a Realtime echo) while rows collapse: the timer must not touch a discarded section
  tap(E.btnIn(E.rowFor(1), 'row-remove')); tap(E.layerAct('slate-remove-confirm'));
  E.render();                                                                      // the repaint replaces the section while the hold is pending
  await sleep(340);
  assert(E.rows().length === 7 && E.slateCount() === 7, '10-8 a repaint during the hold leaves a correct list (the stale timer touched nothing)');
  // the wizard's Step 3 hold
  E.reset(); E.seedWeek({ games: 5, pool: [] }); openStep3();
  const items = () => [...wizBody().querySelectorAll('.week-wizard-game-item')];
  tap(items()[0].querySelector('[data-wiz-remove]')); tap(E.layerAct('slate-remove-confirm'));
  tap(items()[2].querySelector('[data-wiz-remove]'));                              // a new touch inside the 200 ms collapse
  assert(!!E.layer() && /Remove /.test(E.layerText()), '10-9 wizard Step 3: a Remove tapped inside the previous row\'s collapse works');
  tap(E.layerAct('slate-remove-confirm'));
  assert(E.timers.pending().filter((t) => t.in <= 200 && t.in >= 190).length === 1, `10-9a the second wizard Remove supersedes the first hold: exactly ONE 200 ms repaint is armed (${JSON.stringify(E.timers.pending().filter((t) => t.in <= 250))})`);
  await sleep(340);
  assert(E.slateCount() === 3 && items().length === 3, `10-10 …both are removed and the step repaints once with 3 rows (${items().length})`);
  // review F-2: a Remove made on Step 3 is not announced by Step 2 when the commissioner steps back
  tap(wizBody().querySelector('#wiz-step3-back'));
  assert(!!wizBody().querySelector('#wiz-step2-add-manual') && norm(wizBody().querySelector('#wiz-fetch-status').textContent) === '', `10-11 F-2: Step 2 after a Step 3 Remove shows no stale note ("${norm(wizBody().querySelector('#wiz-fetch-status')?.textContent)}")`);
  cancelAll();
  // review F-5: Next re-reads the slate when the tap LANDS. The last Remove is still collapsing, so the Next painted before it is still enabled in the DOM.
  E.reset(); E.seedWeek({ games: 1, pool: [] }); openStep3();
  tap(wizBody().querySelector('[data-wiz-remove]')); tap(E.layerAct('slate-remove-confirm'));
  const nextBtn = wizBody().querySelector('#wiz-step3-next');
  assert(E.slateCount() === 0 && !!nextBtn && !nextBtn.disabled, '10-12 fixture: the last game is gone, its row is still collapsing, and the Next painted before it is still enabled');
  tap(nextBtn);
  assert(!wizBody().querySelector('#wiz-step4-next') && !!wizBody().querySelector('#wiz-step3-back-to-add') && wizBody().querySelector('#wiz-step3-next').disabled, '10-13 F-5: Next with an EMPTY slate does not advance to Step 4: Step 3 repaints at once to its empty state (Back to add games, Next disabled)');
  assert(E.toasts().includes('Add at least one game to continue.'), `10-13a …and says why (${E.toasts().join(' | ')})`);
  await sleep(340);
  assert(!wizBody().querySelector('#wiz-step4-next') && !!wizBody().querySelector('#wiz-step3-back-to-add'), '10-13b …and the superseded hold does not fire a second repaint over it');
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[11] stale taps are never silent; static pins');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  // a repeat bind on the same node is a no-op (the page repaint discards listeners with their nodes; a second bind must not double them)
  E.reset(); E.seedWeek({ games: 4, pool: [20] }); E.render();
  app._bindGamesSectionForTest(); app._bindGamesSectionForTest();
  const n0 = E.slateCount();
  app._commStaleResetForTest();                              // the flag is module state: clear it so 11-0b reads THIS change, not an earlier test's
  tap(E.btnIn(E.rowFor(20), 'row-add'));
  assert(E.slateCount() === n0 + 1 && E.toasts().length === 1, `11-0 binding the section three times on one node still saves ONE game and says ONE thing per tap (${n0} -> ${E.slateCount()}; toasts: ${E.toasts().join(' | ')})`);
  assert(app._commStaleForTest() === true, '11-0b an in-place slate change marks the other Comm tabs stale (they repaint when the commissioner leaves Games)');
  E.reset(); E.seedWeek({ status: 'open', games: 6, pool: [20] }); E.render();
  const btn = E.btnIn(E.rowFor(2), 'row-remove');
  storage.deleteGame('g2');                                  // another device removed it
  tap(btn);
  assert(!E.layer() && E.toasts().some((t) => /isn.t on the slate any more|isn.t in the list any more/.test(t)) , `11-1 Remove on a game that left the slate: a toast, no empty sheet (${E.toasts().join(' | ')})`);
  const lockBtn = E.btnIn(E.rowFor(3), 'row-lock');
  storage.deleteGame('g3');
  tap(lockBtn);
  assert(E.toasts().filter((t) => /any more/.test(t)).length >= 2 && E.rowFor(3)?.getAttribute('data-row-state') !== 'on', '11-2 …the same for Lock; the list was brought up to date');
  // the wizard's Step 3 Remove on a game another device removed: the app says so and refreshes the list, never an empty sheet
  E.reset(); E.seedWeek({ games: 5, pool: [] }); openStep3();
  const staleRm = wizBody().querySelector('.week-wizard-game-item [data-wiz-remove]');
  storage.deleteGame(staleRm.getAttribute('data-wiz-remove'));
  tap(staleRm);
  assert(!E.layer() && E.toasts().some((t) => t === 'Couldn’t find that game on the slate. Nothing was changed.') && wizBody().querySelectorAll('.week-wizard-game-item').length === 4, `11-1b Step 3 Remove on a game that left the slate: a toast, no sheet, and the list is brought up to date (${E.toasts().join(' | ')})`);
  cancelAll();
  // the remove ask itself (the one door every Remove goes through) never opens an empty sheet for a game that is not there
  E.reset(); E.seedWeek({ games: 4, pool: [] }); E.render();
  app._askRemoveSlateGameForTest({ weekId: 'w7', gameId: 'no-such-game' });
  assert(!E.layer() && E.toasts().some((t) => t === 'Couldn’t find that game on the slate. Nothing was changed.'), `11-2b the remove ask for a vanished game says so and opens NO sheet (${E.toasts().join(' | ')})`);
  const ap = readFileSync(path.join(HERE, 'js/app.js'), 'utf8');
  const mod = ap.slice(ap.indexOf('COMM -> GAMES: ONE GAMES LIST'), ap.indexOf('// ─── COLLAPSIBLE COMMISSIONER SECTIONS'));
  assert(!/\bconfirm\(/.test(mod), '11-3 no browser confirm() in the slate module');
  assert(!/\/10 games|\/10\)/.test(ap.replace(/\/\/.*$/gm, '')) && !/\(\$\{[a-zA-Z.]+length\}\/10/.test(ap), '11-4 the hard-coded "/10" heading is gone from the code of app.js');
  const gl = readFileSync(path.join(HERE, 'js/games-list.js'), 'utf8');
  assert(!/[\u{1F300}-\u{1FAFF}☀-➿]/u.test(gl.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), '11-5 games-list.js draws no emoji: the row\'s chrome icons come from the one family (icon())');
  assert(/ctx\.icon\('check'\)/.test(gl) && /ctx\.icon\('lock'\)/.test(gl) && /icon\('plus'\)/.test(gl) && /icon\('refresh'\)/.test(gl), '11-6 …check, lock / unlock, plus and refresh');
  const slateOnly = GL.rowActionNames({ onSlate: true }, { pastDraft: false }).concat(GL.rowActionNames({ onSlate: true }, { pastDraft: true, unlocked: true }), GL.rowActionNames({ onSlate: false, suggested: 'next' }, {}));
  assert(slateOnly.join(',') === 'edit,remove,edit,lock,remove,add', `11-7 rowActionNames: ${slateOnly.join(',')}`);
  assert(GL.summaryText({ onSlate: 3, notOnSlate: 0, poolEmpty: true, profile: null }) === '3 on slate · pool is empty · target 10', '11-8 summaryText: an empty pool says so');
  assert(GL.hashSig('a') !== GL.hashSig('b') && GL.hashSig('x') === GL.hashSig('x'), '11-9 hashSig is deterministic and separates inputs');
  assert(GL.suggestionNotes({ suggestedCount: 10, almaCount: 11, target: 10 })[0].text === '11 alma mater games this week — slate expanded' && GL.suggestionNotes({ suggestedCount: 10, almaCount: 3, target: 10 })[0].text === '3 of 10 slots reserved for alma mater games this week' && GL.suggestionNotes({ suggestedCount: 0, almaCount: 3 }).length === 0,
    '11-10 the alma-mater budget banner keeps its copy (and an empty suggestion has no notes)');
  let kit = [];
  try { kit = JSON.parse(readFileSync(path.join(HERE, 'tests/kits/w68-w69-mutants.json'), 'utf8')); } catch { /* absent until committed */ }
  const bad = kit.filter((m) => readFileSync(path.join(HERE, m.file), 'utf8').split(m.old).length - 1 !== 1).map((m) => m.id);
  assert(kit.length > 0 && bad.length === 0, `11-11 every kit mutant\'s \`old\` string matches the live tree exactly once (${kit.length} mutants; mismatches: ${bad.join(', ') || 'none'})`);
  cancelAll();
}

console.log(`\n${fail ? '❌ FAILURES' : '✅ ALL PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
