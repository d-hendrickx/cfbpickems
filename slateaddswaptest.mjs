/**
 * CFB Pickems — slateaddswaptest.mjs (D1 W-68, "add or swap on a full slate", 2026-10-14; DI-W68.1 – DI-W68.7, docs/DESIGN_D1_D.md section 3)
 * =============================================================================================================================================
 * Drew (verbatim, typos included): "If the slate is built with 10 teams and I select add a new team, it should ask me to add an extra (make it 11) or swap with another team currently on the
 * slate, then let me pick whichteam to swap it with roght now nothing happens".
 *
 * THE REPRODUCTION, made permanent ([R], RED FIRST: it fails on int/v0.30.0 643e12fe, where every add path appends unconditionally, the wizard's manual add repaints a step with no slate list and no
 * count, and Add on a full slate just makes an eleventh game). Driven through the REAL js/app.js against a real element tree built from the real index.html (slateenv.mjs / minidom.mjs): every tap is
 * a click on a real button that bubbles to the app's delegated handler; the sheets are the app's own action-sheet layer and swap picker; the game form is the app's own showGameModal.
 *
 *   [R]  the report: 10 on a draft week - a list Add asks (and saves nothing first); the wizard's Step 2 manual add asks, then says what it did and shows the count.
 *   [1]  slateAddDecision: college 9 / 10 / 11, NFL 9 / 10, a profile with no slate block, NaN / negative / string counts, and it reads no sport name.
 *   [2]  actionSheetHTML({ actions }): the golden, the unchanged `danger` form, hostile names escaped, "exactly one of danger / actions".
 *   [3]  swapSlateGame / removeGameFromSlate over fakes: add-then-delete order, refusals write nothing, a throw after the add leaves the slate LONG - and over the real storage the picks cascade.
 *   [4]  the NFL tiebreaker-game reference: repointed on a swap and on a remove, cleared when nothing remains, untouched for college and for a game that was not the tiebreaker.
 *   [5]  the entry-point matrix: each of four add paths at 9 and at 10 games - direct add or form vs the sheet; Cancel writes nothing; the count is read when the tap LANDS.
 *   [6]  the choice sheet's exact copy, the extend flow, haptics, the live count.
 *   [7]  bulk adds stop at the sport's slate size (an empty slate still takes the whole suggestion, alma-mater expansion included).
 *   [8]  DI-W68.7: a filter change, then ONE Player Requests Add saves exactly one game.
 *   [9]  the swap picker sheet: radio rows, nothing preselected, Swap disabled until a row is chosen, the picks named on the button, keyboard and focus, the manual-origin path, the suspension lists.
 *   [10] the NFL at its maximum: Swap only, and it says why.
 *   [11] static: no slate-creating `saveGame(createGame(` outside the one door, the bulk adds and the wizard's fetch; every kit mutant still applies to the live tree.
 *
 * NOT COVERED HERE (a device, never a test): the sheet-over-sheet stacking as laid out, the picker's slide and drag physics, haptic feel, 375 pt / largest-text geometry (gameslistbrowsertest.mjs
 * measures the geometry in a real Chromium; the feel is on Drew's device checklist).
 *
 * MUTATION KIT: tests/kits/w68-w69-mutate.mjs + w68-w69-mutants.json (S-3) - run by the reviewer; section [11] here keeps its `old` strings honest.
 *
 * Run: node slateaddswaptest.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from './slateenv.mjs';
import { actionSheetHTML } from './js/league-create.js';
import * as SA from './js/slate-add.js';
import * as GL from './js/games-list.js';
import { profileForWeek } from './js/competition.js';
import { tiebreakerGameOptions, tiebreakerFieldsFor } from './js/multisport-admin.js';

const { app, storage, dm, NFL_PROFILE, CFB_PROFILE, norm, sleep, haptics } = E;
const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const section = (t) => _log(`\n${t}`);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const tap = (el) => { if (!el) throw new Error('tap(): no such control'); el.click(); };
/** [R] only: a missing control is a RED assertion on the next line, not a crash that hides every later one. */
const softTap = (el) => { if (el) el.click(); return !!el; };
const native = E.native;

/** The Add button of the (pool-only) game with event number `n`: the new list's row button - or, on the OLD tree (the red proof), the old Available Games button. */
function addButton(n) {
  const b = E.btnIn(E.rowFor(n), 'row-add');
  if (b) return b;
  return [...document.querySelectorAll('.add-avail-game-btn')].find((x) => String(x.getAttribute('data-game')).includes(`"espnEventId":"E${n}"`)) || null;
}
const pickerRadios = () => [...document.querySelectorAll('#swap-picker-body [role="radio"]')];
const pickerWrap = () => document.getElementById('swap-picker-sheet-wrap');
const goBtn = () => document.getElementById('swap-picker-go');
const wizBody = () => document.getElementById('week-wizard-body');
/** Open the wizard sheet on Step 2 (Populate games) for the active week. */
function openStep2() {
  app._openWeekWizardSheetForTest();
  for (let i = 0; i < 6 && wizBody() && !wizBody().querySelector('#wiz-step2-add-manual'); i++) {
    const back = [...wizBody().querySelectorAll('button')].find((b) => /^wiz-step\d-back$/.test(b.id));
    if (!back) break;
    back.click();
  }
  return wizBody();
}
const cancelAll = () => { for (let i = 0; i < 4 && E.layer(); i++) E.layerAct('cancel')?.click(); app._resetSwapPickerForTest?.(); document.querySelector('.modal-overlay')?.remove(); document.getElementById('week-wizard-sheet-wrap')?.remove(); };
const requestFor = (n, weekDate = '2026-10-17') => storage.submitGameRequest({ playerId: 'p2', playerName: 'Ben', espnEventId: `E${n}`, homeTeam: `Home${n}`, awayTeam: `Away${n}`, kickoff: E.mkGame('w7', n).kickoff, gameDate: weekDate });

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[R] the report: 10 games on a draft slate, then Add - nothing may happen silently');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ games: 10, pool: [20, 21] }); E.render();
  const before = E.slateCount();
  const b = addButton(20);
  assert(!!b, 'R-0 fixture: the pool game "Away20 @ Home20" has an Add button on the Comm -> Games list');
  softTap(b);
  assert(!!E.layer() && /The slate has 10 games/.test(E.layerText()) && /Add as game 11/.test(E.layerText()) && /Swap with a game on the slate/.test(E.layerText()),
    `R-1 THE BUG: Add on a full slate ASKS - "The slate has 10 games", "Add as game 11", "Swap with a game on the slate" (sheet: ${E.layer() ? E.layerText() : 'none'})`);
  assert(E.slateCount() === before, `R-2 …and nothing was saved before the commissioner chose (still ${E.slateCount()} games, was ${before})`);
  cancelAll();
  // the wizard, Step 2 - the manual add that "did nothing" visible
  E.reset(); E.seedWeek({ games: 10, pool: [] });
  openStep2();
  assert(!!wizBody() && /Populate games/.test(norm(wizBody().textContent)), 'R-3 fixture: the week wizard is on Step 2 (Populate games) with 10 games on the slate');
  assert(!!wizBody().querySelector('#wiz-step2-count') && /10 games on your slate/.test(norm(wizBody().querySelector('#wiz-step2-count').textContent)),
    `R-4 THE BUG: Step 2 SHOWS the slate's count - "10 games on your slate" (got "${norm(wizBody().querySelector('#wiz-step2-count')?.textContent)}")`);
  softTap(wizBody().querySelector('#wiz-step2-add-manual'));
  assert(!!E.layer() && /The slate has 10 games/.test(E.layerText()), 'R-5 THE BUG: the wizard\'s manual add at 10 ASKS (the choice sheet is up, above the wizard sheet) before any form');
  assert(!document.getElementById('m-save'), 'R-6 …and no game form is open yet (the choice comes first, so nothing typed is lost on Cancel)');
  softTap(E.layerAct('slate-extend'));
  assert(!!document.getElementById('m-save'), 'R-7 "Add as game 11" opens the (unchanged) game form');
  document.getElementById('m-home').value = 'Tulane'; document.getElementById('m-away').value = 'Memphis';
  softTap(document.getElementById('m-save'));
  assert(E.slateCount() === 11, `R-8 saving it puts the game on the slate (11 games, got ${E.slateCount()})`);
  const st = norm(wizBody().querySelector('#wiz-fetch-status')?.textContent);
  assert(st === 'Added Memphis @ Tulane. 11 games on your slate.', `R-9 THE BUG: the step SAYS what happened - "Added Memphis @ Tulane. 11 games on your slate." (got "${st}")`);
  assert(/11 games on your slate/.test(norm(wizBody().querySelector('#wiz-step2-count')?.textContent)) && !!wizBody().querySelector('#wiz-step2-review'), 'R-10 …the standing count line reads 11 and offers "Review slate"');
  const live = wizBody().querySelector('#wiz-fetch-status');
  assert(live.getAttribute('aria-live') === 'polite' && live.getAttribute('role') === 'status', 'R-11 the status line is a polite live region (VoiceOver hears it)');
  softTap(wizBody().querySelector('#wiz-step2-review'));
  assert(/Confirm slate/.test(norm(wizBody().textContent)), 'R-12 "Review slate" goes to Step 3');
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[1] slateAddDecision (DI-W68.1): the rule');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const d = SA.slateAddDecision;
  assert(d({ count: 9, profile: CFB_PROFILE }).prompt === false, '1-1 college: 9 on the slate -> add at once');
  const c10 = d({ count: 10, profile: CFB_PROFILE });
  assert(c10.prompt === true && c10.canExtend === true && c10.nextNumber === 11 && c10.max === null && c10.target === 10, `1-2 college: 10 -> asks, can extend, "game 11", no ceiling (${JSON.stringify(c10)})`);
  const c11 = d({ count: 11, profile: CFB_PROFILE });
  assert(c11.prompt === true && c11.canExtend === true && c11.nextNumber === 12, '1-3 college: 11 -> asks, "game 12" (a slate over its size keeps asking)');
  assert(d({ count: 9, profile: NFL_PROFILE }).prompt === false, '1-4 NFL: 9 -> add at once');
  const n10 = d({ count: 10, profile: NFL_PROFILE });
  assert(n10.prompt === true && n10.canExtend === false && n10.max === 10 && n10.min === 8, `1-5 NFL: 10 -> asks and CANNOT extend (maxSize 10) (${JSON.stringify(n10)})`);
  assert(d({ count: 7, profile: NFL_PROFILE }).prompt === false, '1-6 NFL: 7 -> add at once (below the size, even below minSize)');
  assert(d({ count: 10, profile: {} }).prompt === true && d({ count: 9, profile: {} }).prompt === false && d({ count: 10, profile: null }).canExtend === true, '1-7 a profile with no slate block: target 10, no ceiling');
  assert(d({ count: NaN, profile: CFB_PROFILE }).prompt === false && d({ count: -4, profile: CFB_PROFILE }).prompt === false && d({ count: undefined, profile: CFB_PROFILE }).prompt === false && d({ count: '12', profile: CFB_PROFILE }).count === 12,
    '1-8 a non-finite or negative count is treated as 0; a numeric string is a number');
  assert(d({ count: 12, profile: { slate: { size: 12 } } }).prompt === true && d({ count: 11, profile: { slate: { size: 12 } } }).prompt === false, '1-9 the target is the PROFILE\'s size, not a constant 10');
  assert(d({ count: 10, profile: { slate: { size: 10, maxSize: null } } }).canExtend === true, '1-10 maxSize null is "no ceiling", not zero');
  const src = readFileSync(path.join(HERE, 'js/slate-add.js'), 'utf8');
  const fn = src.slice(src.indexOf('export function slateAddDecision'), src.indexOf('/** The slate size a bulk add stops at'));
  assert(fn.length > 200 && !/'(cfb|nfl|college|football)'|"(cfb|nfl)"/i.test(fn), '1-11 the rule reads no sport name (a future sport inherits it from its profile\'s slate block)');
  assert(SA.slateTargetOf(CFB_PROFILE) === 10 && SA.slateTargetOf(NFL_PROFILE) === 10 && SA.slateTargetOf(null) === 10 && CFB_PROFILE.slate.size === SA.slateTargetOf(CFB_PROFILE), '1-12 slateTargetOf is the profile\'s slate.size (the old hard-coded app.js TARGET_SLATE_SIZE is now the profile itself)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[2] actionSheetHTML({ actions }): the shared builder, extended additively (DI-W68.2)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const base = { escHtml: esc, titleId: 't1', title: 'Ti<tle>', message: 'M&m', cancel: { label: 'Cancel', action: 'cancel' }, scrimAction: 'cancel', actionAttr: 'data-ls-action' };
  const list = actionSheetHTML({ ...base, actions: [{ label: 'One', action: 'a1' }, { label: 'Two "2"', action: 'a2' }] });
  const expected = `<div class="lc-scrim" data-ls-action="cancel"></div>
    <div class="lc-actionsheet" role="alertdialog" aria-modal="true" aria-labelledby="t1">
      <div class="lc-as-grp"><div class="lc-as-ttl lc-as-ttl-has-msg" id="t1">Ti&lt;tle&gt;</div><div class="lc-as-msg">M&amp;m</div>
        <button type="button" class="lc-as-act" data-ls-action="a1">One</button>
        <button type="button" class="lc-as-act" data-ls-action="a2">Two &quot;2&quot;</button></div>
      <div class="lc-as-grp"><button type="button" class="lc-as-act lc-as-bold" data-ls-action="cancel">Cancel</button></div>
    </div>`;
  assert(list === expected, '2-1 the actions[] golden: N ordinary actions in the first group, the bold Cancel group second, every string escaped', list);
  const dang = actionSheetHTML({ ...base, message: '', danger: { label: 'Delete', action: 'del' } });
  assert(dang.includes('<button type="button" class="lc-as-act lc-as-danger" data-ls-action="del">Delete</button></div>') && !dang.includes('lc-as-ttl-has-msg'), '2-2 with `danger` the output is the one destructive button, as it always was (accountexittest holds the byte golden)');
  assert(actionSheetHTML({ ...base, actions: [{ label: 'Clear', action: 'c', danger: true }] }).includes('class="lc-as-act lc-as-danger" data-ls-action="c"'), '2-3 an action entry with danger:true takes the destructive colour');
  let both = false, neither = false;
  try { actionSheetHTML({ ...base, danger: { label: 'x', action: 'x' }, actions: [{ label: 'y', action: 'y' }] }); } catch (e) { both = e instanceof TypeError; }
  try { actionSheetHTML({ ...base }); } catch (e) { neither = e instanceof TypeError; }
  assert(both && neither, '2-4 `danger` and `actions` are mutually exclusive: both, or neither, throws');
  const hostile = 'A<img src=x onerror=1>&"\'';
  const h = SA.choiceSheetHTML({ escHtml: esc, decision: SA.slateAddDecision({ count: 10, profile: CFB_PROFILE }), incomingName: hostile, profile: CFB_PROFILE });
  assert(!h.includes('<img') && h.includes('A&lt;img src=x onerror=1&gt;&amp;&quot;&#39;'), '2-5 hostile team names (< & " \') are escaped in the choice sheet');
  const r = SA.removeSheetHTML({ escHtml: esc, name: hostile, pickCount: 2 });
  assert(!r.includes('<img') && r.includes('&lt;img'), '2-6 …and in the remove sheet');
  let threw = false; try { SA.choiceSheetHTML({ decision: SA.slateAddDecision({ count: 10 }) }); } catch (e) { threw = e instanceof TypeError; }
  assert(threw, '2-7 a builder with no injected escHtml throws (CONVENTIONS #12), never falls back to String()');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[3] swapSlateGame / removeGameFromSlate: the operations (DI-W68.4)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const fakeDeps = (init, { failOn = null, week = { weekId: 'w', tiebreakerGameId: null } } = {}) => {
  const log = []; let games = init.map((g) => ({ ...g })); let wk = { ...week };
  return {
    log, get games() { return games; }, get week() { return wk; },
    deps: {
      getWeek: () => wk, getGames: () => games.map((g) => ({ ...g })), countPicksForGame: () => 0,
      createGame: (weekId, data) => ({ gameId: `new_${data.homeTeam}`, weekId, ...data }),
      saveGame: (g) => { if (failOn === 'save') throw new Error('save refused'); log.push(`save:${g.homeTeam}`); games = [...games.filter((x) => x.gameId !== g.gameId), g]; },
      deleteGame: (id) => { if (failOn === 'delete') throw new Error('delete refused'); log.push(`delete:${id}`); games = games.filter((g) => g.gameId !== id); },
      saveWeek: (w) => { log.push('saveWeek'); wk = w; },
      profileForWeek: () => NFL_PROFILE, tiebreakerGameOptions: (list, o) => [...list].sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)).map((g) => ({ gameId: g.gameId, label: o.nameOf(g) })),
      tiebreakerFieldsFor: ({ game }) => ({ tiebreakerGameId: game.gameId }), tiebreakerQuestionFor: () => 'q',
    },
  };
};
const G = (id, home, t = 0) => ({ gameId: id, weekId: 'w', homeTeam: home, awayTeam: `A${home}`, espnEventId: `E${home}`, kickoff: new Date(Date.UTC(2026, 9, 17, 16 + t)).toISOString() });
{
  const f = fakeDeps([G('g1', 'One', 0), G('g2', 'Two', 1)]);
  const r = SA.swapSlateGame({ weekId: 'w', outGameId: 'g1', inData: { homeTeam: 'Three', awayTeam: 'AThree', espnEventId: 'EThree' }, deps: f.deps });
  assert(r.ok && f.log[0] === 'save:Three' && f.log[1] === 'delete:g1', `3-1 the new game is ADDED first, then the old is deleted (${f.log.join(' -> ')})`);
  assert(f.games.length === 2 && f.games.some((g) => g.homeTeam === 'Three') && !f.games.some((g) => g.gameId === 'g1'), '3-2 the slate is the same size afterwards, with the new game and without the old');
  const r2 = SA.swapSlateGame({ weekId: 'w', outGameId: 'gone', inData: { homeTeam: 'X', awayTeam: 'Y' }, deps: f.deps });
  assert(!r2.ok && r2.reason === 'missing_out', '3-3 an out-game that is no longer on the slate is refused');
  const n = f.log.length;
  const r3 = SA.swapSlateGame({ weekId: 'w', outGameId: 'g2', inData: { homeTeam: 'Three', awayTeam: 'AThree', espnEventId: 'EThree' }, deps: f.deps });
  assert(!r3.ok && r3.reason === 'duplicate' && f.log.length === n, '3-4 a duplicate incoming game (the join rule) is refused, with NOTHING written');
  const r4 = SA.swapSlateGame({ weekId: 'w', outGameId: 'g2', inData: null, deps: f.deps });
  assert(!r4.ok && r4.reason === 'no_incoming' && f.log.length === n, '3-5 no incoming data is refused, nothing written');
  const fd = fakeDeps([G('g1', 'One'), G('g2', 'Two', 1)], { failOn: 'delete' });
  const r5 = SA.swapSlateGame({ weekId: 'w', outGameId: 'g1', inData: { homeTeam: 'Three', awayTeam: 'AThree' }, deps: fd.deps });
  assert(!r5.ok && r5.reason === 'write_failed' && r5.slateLong === true && fd.games.length === 3, `3-6 a throw AFTER the add leaves the slate one game LONG (${fd.games.length}), never one short, and says so`);
  const fs = fakeDeps([G('g1', 'One'), G('g2', 'Two', 1)], { failOn: 'save' });
  const r6 = SA.swapSlateGame({ weekId: 'w', outGameId: 'g1', inData: { homeTeam: 'Three', awayTeam: 'AThree' }, deps: fs.deps });
  assert(!r6.ok && r6.slateLong === false && fs.games.length === 2 && !fs.log.some((l) => l.startsWith('delete')), '3-7 a throw on the ADD deletes nothing - the slate is exactly as it was');
  const fr = fakeDeps([G('g1', 'One'), G('g2', 'Two', 1)]);
  const rr = SA.removeGameFromSlate({ weekId: 'w', gameId: 'g1', deps: fr.deps });
  assert(rr.ok && fr.games.length === 1 && SA.removeGameFromSlate({ weekId: 'w', gameId: 'g1', deps: fr.deps }).reason === 'missing_out', '3-8 remove deletes one game; removing it again is refused (missing_out)');
  assert(SA.removedToastText(0) === 'Game removed' && SA.removedToastText(1) === 'Removed — 1 pick also deleted' && SA.removedToastText(3) === 'Removed — 3 picks also deleted', '3-9 the removal toast keeps its existing copy');
}
section('[3b] …over the REAL storage: the picks and the lock override cascade');
{
  E.reset(); E.seedWeek({ games: 10, pool: [20], picks: { 3: 2 } });
  storage.setGameLockOverride('g3', true);
  assert(storage.countPicksForGame('g3') === 2 && storage.getGameLockOverrides().g3 === 'unlocked', '3b-0 fixture: g3 has 2 submitted picks and a lock override');
  const live = { getWeek: storage.getWeek, getGames: storage.getGames, saveGame: storage.saveGame, createGame: dm.createGame, deleteGame: storage.deleteGame, countPicksForGame: storage.countPicksForGame, saveWeek: storage.saveWeek,
    profileForWeek, tiebreakerGameOptions, tiebreakerFieldsFor, tiebreakerQuestionFor: dm.tiebreakerQuestionFor };
  const r = SA.swapSlateGame({ weekId: 'w7', outGameId: 'g3', inData: GL.poolGameToSlateData(E.mkGame('w7', 20), storage.getWeek('w7')), deps: live });
  assert(r.ok && r.pickCount === 2 && E.slateCount() === 10 && storage.countPicksForGame('g3') === 0 && !storage.getGameLockOverrides().g3, '3b-1 the swap deletes the out-game\'s picks and lock override (deleteGame cascades) and the slate stays 10');
  assert(E.names().includes('Away20 @ Home20') && !E.names().includes('Away3 @ Home3'), '3b-2 the incoming game is on the slate, the outgoing one is not');
  const added = storage.getGames('w7').find((g) => g.homeTeam === 'Home20');
  assert(added.gameId !== 'g3' && /^g_/.test(added.gameId) && added.nationalTV === false && added.weekId === 'w7' && added.espnEventId === 'E20', '3b-3 the new slate game minted its own id and kept the pool game\'s fields (the one payload builder)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[4] the NFL tiebreaker-game reference stays valid (DI-W68.4 step 4)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const mk = (tb) => fakeDeps([G('g1', 'One', 0), G('g2', 'Two', 1), G('g3', 'Three', 2)], { week: { weekId: 'w', tiebreakerGameId: tb } });
  let f = mk('g3');
  let r = SA.swapSlateGame({ weekId: 'w', outGameId: 'g3', inData: { homeTeam: 'Four', awayTeam: 'AFour', kickoff: new Date(Date.UTC(2026, 9, 18, 4)).toISOString() }, deps: f.deps });
  assert(r.ok && r.tiebreakerMoved && f.week.tiebreakerGameId === 'new_Four' && r.tiebreakerMovedTo.homeTeam === 'Four', `4-1 swapping out the tiebreaker game repoints it to the latest-kickoff game (the incoming one has a later kickoff): ${f.week.tiebreakerGameId}`);
  f = mk('g3');
  r = SA.removeGameFromSlate({ weekId: 'w', gameId: 'g3', deps: f.deps });
  assert(r.ok && r.tiebreakerMoved && f.week.tiebreakerGameId === 'g2' && r.tiebreakerMovedTo.gameId === 'g2', `4-2 removing it repoints to the latest remaining kickoff (${f.week.tiebreakerGameId})`);
  f = mk('g1');
  r = SA.removeGameFromSlate({ weekId: 'w', gameId: 'g2', deps: f.deps });
  assert(r.ok && !r.tiebreakerMoved && f.week.tiebreakerGameId === 'g1' && !f.log.includes('saveWeek'), '4-3 removing a game that is NOT the tiebreaker game leaves the week untouched (no write)');
  f = fakeDeps([G('g1', 'One', 0)], { week: { weekId: 'w', tiebreakerGameId: 'g1' } });
  r = SA.removeGameFromSlate({ weekId: 'w', gameId: 'g1', deps: f.deps });
  assert(r.ok && f.week.tiebreakerGameId === null && r.tiebreakerMovedTo === null, '4-4 removing the LAST game clears the reference (nothing valid remains to point at)');
  f = mk('g3'); f.deps.profileForWeek = () => CFB_PROFILE;
  r = SA.removeGameFromSlate({ weekId: 'w', gameId: 'g3', deps: f.deps });
  assert(r.ok && !r.tiebreakerMoved && f.week.tiebreakerGameId === 'g3' && !f.log.includes('saveWeek'), '4-5 college (alma-mater affinity) derives its tiebreaker from the slate: the week row is not touched');
  // through the app, on a real NFL week at 10: the reference follows a swap
  E.reset({ sports: 'multi' });
  E.seedWeek({ sport: 'nfl', games: 10, pool: [20], extra: { tiebreakerGameId: 'g9' } });
  assert(storage.getWeek('w7').tiebreakerGameId === 'g9', '4-6 fixture: the NFL week\'s tiebreaker game is g9 (the last kickoff)');
  E.render();
  tap(addButton(20));
  tap(E.layerAct('slate-swap'));
  tap(pickerRadios().find((b) => b.getAttribute('data-swap-game') === 'g9'));
  tap(goBtn());
  const wk1 = storage.getWeek('w7');
  assert(E.slateCount() === 10 && wk1.tiebreakerGameId && wk1.tiebreakerGameId !== 'g9' && storage.getGames('w7').some((g) => g.gameId === wk1.tiebreakerGameId), `4-7 through the picker on an NFL week: the tiebreaker game moved off the swapped-out g9 to a game still on the slate (${wk1.tiebreakerGameId})`);
  await sleep(450);
  assert(E.toasts().some((t) => /^Swapped Away9 @ Home9 for Away20 @ Home20\. Tiebreaker game is now Away20 @ Home20\.$/.test(t)), `4-8 the toast names the swap AND the new tiebreaker game: ${E.toasts().join(' | ')}`);
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[5] the entry-point matrix: each add path at 9 and at 10 games, and the count is read when the tap LANDS');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const paths = {
    list: () => { E.render(); tap(addButton(20)); },
    requests: () => { requestFor(20); E.render(); tap(document.querySelector('#game-requests-section [data-action="gr-add"]')); },
    manual: () => { E.render(); tap(document.getElementById('add-manual-game-btn')); },
    wizard: () => { openStep2(); tap(document.getElementById('wiz-step2-add-manual')); },
  };
  for (const n of [9, 10]) {
    for (const [name, go] of Object.entries(paths)) {
      E.reset(); E.seedWeek({ games: n, pool: [20] });
      const before = E.slateCount();
      let setup = true;
      try { go(); } catch (e) { setup = false; assert(false, `5-${name}-${n}-setup: ${e.message}`); }
      if (!setup) { cancelAll(); continue; }
      const asked = !!E.layer(), formOpen = !!document.getElementById('m-save');
      const direct = name === 'list' || name === 'requests';
      if (n === 9 && direct) assert(!asked && E.slateCount() === before + 1 && E.names().includes('Away20 @ Home20'), `5-${name}-9: at 9 the ${name} Add is ONE tap - added at once, no sheet (${before} -> ${E.slateCount()})`);
      else if (n === 9) assert(!asked && formOpen && E.slateCount() === before, `5-${name}-9: at 9 the manual add opens the form directly (no sheet) and nothing is saved until Save`);
      else {
        assert(asked && /The slate has 10 games/.test(E.layerText()) && E.slateCount() === before && !formOpen, `5-${name}-10: at 10 the ${name} add ASKS - the sheet is up, nothing saved, no form yet`);
        if (asked) {
          tap(E.layerAct('cancel'));
          assert(!E.layer() && E.slateCount() === before && !document.getElementById('m-save') && !pickerWrap(), `5-${name}-10: Cancel changes nothing`);
        }
      }
      cancelAll();
    }
  }
  // RG-256 class: the count is read when the tap LANDS, never from the render's closure
  E.reset(); E.seedWeek({ games: 10, pool: [20] }); E.render();
  tap(addButton(20));                                  // asked at 10
  storage.deleteGame('g9');                            // another device removed a game while the sheet was up
  tap(E.layerAct('slate-extend'));
  assert(E.slateCount() === 10 && E.toasts().some((t) => t === 'Added as game 10.'), `5-late-1 Extend re-reads the slate when it lands: 9 on the slate now, so it is "Added as game 10." (${E.toasts().join(' | ')})`);
  E.reset(); E.seedWeek({ games: 9, pool: [20] }); E.render();
  const staleBtn = addButton(20);                      // the list as painted: Away20 is Not on slate
  storage.saveGame({ ...E.mkGame('w7', 20), gameId: 'late' });   // another device added it meanwhile
  tap(staleBtn);
  assert(E.slateCount() === 10 && E.toasts().some((t) => /Away20 @ Home20 is already on the slate\./.test(t)) && !E.layer(), `5-late-2 a stale Add on a game that is on the slate now adds NOTHING, shows no sheet, and says so (${E.toasts().join(' | ')})`);
  // the door itself refuses a duplicate even BELOW the size (the Player Requests path hands it a stored snapshot, never the row's own guard)
  E.reset(); E.seedWeek({ games: 8, pool: [20] }); storage.saveGame({ ...E.mkGame('w7', 20), gameId: 'dup' });
  const dupRes = app._requestAddToSlateForTest({ weekId: 'w7', data: E.mkGame('w7', 20), origin: 'pool' });
  assert(dupRes.status === 'duplicate' && E.slateCount() === 9 && E.toasts().some((t) => /Away20 @ Home20 is already on the slate\./.test(t)) && !E.layer(), `5-late-5 the add door refuses a game already on the slate even at 9 (status ${dupRes.status}, ${E.slateCount()} on the slate)`);
  // at 9 on the paint, 10 when the tap lands: it asks
  E.reset(); E.seedWeek({ games: 9, pool: [20, 21] }); E.render();
  const b21 = addButton(21);
  storage.saveGame({ ...E.mkGame('w7', 20), gameId: 'late2' });
  tap(b21);
  assert(!!E.layer() && /The slate has 10 games/.test(E.layerText()) && E.slateCount() === 10, '5-late-3 painted at 9, tapped at 10: the live count decides, so it ASKS and saves nothing');
  cancelAll();
  // the swap picker validates on Swap: the out-game vanished
  E.reset(); E.seedWeek({ games: 10, pool: [20] }); E.render();
  tap(addButton(20)); tap(E.layerAct('slate-swap')); tap(pickerRadios()[4]);
  storage.deleteGame('g4');
  tap(goBtn());
  assert(E.slateCount() === 9 && !E.names().includes('Away20 @ Home20') && E.toasts().some((t) => t === 'Couldn’t find that game on the slate. Nothing was changed.'), `5-late-4 Swap re-validates: the out-game is gone, so NOTHING is added and the toast says so (${E.toasts().join(' | ')})`);
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[6] the choice sheet\'s copy, the extend flow, haptics');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ games: 10, pool: [20, 21] }); E.render(); tap(addButton(20));
  const t = E.layerText();
  const parts = ['The slate has 10 games', 'Add Away20 @ Home20 as game 11, or swap it for a game that is already on the slate.', 'Add as game 11', 'Swap with a game on the slate', 'Cancel'];
  assert(parts.every((p) => t.includes(p)) && parts.map((p) => t.indexOf(p)).every((x, i, a) => i === 0 || x > a[i - 1]), `6-1 college copy is exact and in order (got "${t}")`);
  const acts = [...E.layer().querySelectorAll('[data-ls-action]')].map((b) => b.getAttribute('data-ls-action'));
  assert(acts.join(',') === 'cancel,slate-extend,slate-swap,cancel', `6-2 the scrim is Cancel; then extend, swap, Cancel (${acts.join(', ')})`);
  assert(E.layer().querySelector('.lc-as-bold')?.textContent === 'Cancel', '6-3 Cancel is the bold last group');
  tap(E.layer().querySelector('.lc-scrim'));
  assert(!E.layer() && E.slateCount() === 10, '6-4 a scrim tap is Cancel');
  native(true);
  tap(addButton(20));
  assert(haptics.length === 0, `6-5 native: NOTHING plays when the choice sheet opens (a choice is not a warning) (${haptics.join(',')})`);
  tap(E.layerAct('slate-extend'));
  assert(E.slateCount() === 11 && E.names().includes('Away20 @ Home20'), `6-6 "Add as game 11" adds the game (${E.slateCount()} games)`);
  assert(E.toasts().some((x) => x === 'Added as game 11.'), `6-7 …toast "Added as game 11." (${E.toasts().join(' | ')})`);
  assert(haptics.join(',') === 'impact:LIGHT', `6-8 native haptics for an extend: ONE light impact (${haptics.join(',')})`);
  native(false);
  tap(addButton(21)); assert(/The slate has 11 games/.test(E.layerText()) && /Add as game 12/.test(E.layerText()), '6-9 at 11 the sheet reads "The slate has 11 games" / "Add as game 12"');
  tap(E.layerAct('cancel'));
  const summary = norm(E.section().querySelector('#games-summary').textContent);
  assert(!/\/10 games/.test(E.page().innerHTML) && summary === '11 on slate · 1 not on slate · target 10', `6-10 the summary reads the live count and the sport's size, with no hard-coded "/10": "${summary}"`);
  // a direct add at 9 toasts the game's name
  E.reset(); E.seedWeek({ games: 9, pool: [20] }); E.render(); native(true); tap(addButton(20));
  assert(E.toasts().some((x) => x === 'Added Away20 @ Home20.') && E.slateCount() === 10 && haptics.length === 0, `6-11 below the size Add is one tap with the toast "Added Away20 @ Home20." (${E.toasts().join(' | ')})`);
  native(false);
  // the Remove sheet and the More sheet pass the right haptics
  E.reset(); E.seedWeek({ status: 'open', games: 10, pool: [20] }); E.render(); native(true);
  tap(E.btnIn(E.rowFor(3), 'row-remove'));
  assert(haptics.join(',') === 'notification:WARNING', `6-12 the destructive Remove sheet keeps the warning haptic on show (${haptics.join(',')})`);
  cancelAll(); haptics.length = 0;
  tap(document.getElementById('games-more-btn'));
  assert(!!E.layer() && haptics.length === 0, `6-13 the More list is a choice, not a warning: no haptic (${haptics.join(',')})`);
  native(false); cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[7] bulk adds stop at the sport\'s slate size (DI-W68.6, R-3)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const mkC = (n) => Array.from({ length: n }, (_, i) => ({ homeTeam: `H${i}`, awayTeam: `A${i}` }));
  const p = SA.planBulkAdd({ existingCount: 0, candidates: mkC(10), target: 10, suggestedLength: 10 });
  assert(p.toAdd.length === 10 && p.held.length === 0, '7-1 an empty slate takes the whole suggestion (unchanged)');
  const p2 = SA.planBulkAdd({ existingCount: 7, candidates: mkC(10), target: 10, suggestedLength: 10 });
  assert(p2.toAdd.length === 3 && p2.held.length === 7, `7-2 7 already on the slate: only 3 more fit under 10 (added ${p2.toAdd.length}, held ${p2.held.length})`);
  const p3 = SA.planBulkAdd({ existingCount: 0, candidates: mkC(11), target: 10, suggestedLength: 11 });
  assert(p3.toAdd.length === 11, '7-3 the engine widened the slate for 11 alma-mater games ("ALL is absolute"): an empty slate still takes all 11');
  const p4 = SA.planBulkAdd({ existingCount: 10, candidates: mkC(3), target: 10, suggestedLength: 3 });
  assert(p4.toAdd.length === 0 && p4.held.length === 3, '7-4 a slate already at its size takes none');
  const p5 = SA.planBulkAdd({ existingCount: 0, candidates: mkC(4), target: 10, suggestedLength: 4, isOnSlate: (g) => g.homeTeam === 'H1' });
  assert(p5.toAdd.length === 3 && p5.held.length === 0, '7-5 a game already on the slate is neither added nor "held"');
  assert(SA.SLATE_COPY.bulkHeld(3, 10) === 'Added 3 games. The slate is at 10; add more one at a time.' && SA.SLATE_COPY.bulkHeld(1, 10).startsWith('Added 1 game.'), '7-6 the Games-tab copy');
  assert(SA.SLATE_COPY.bulkHeldTail(10) === ' The slate is at 10; add more one at a time.', '7-7 the wizard status tail');
  E.reset(); E.seedWeek({ games: 7, pool: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], poolMirrorsSlate: false }); E.render();
  const sug = document.getElementById('apply-suggested-btn');
  assert(!!sug && norm(sug.textContent) === 'Add 3 suggested', `7-8 the button says what it will do: "Add 3 suggested" (got "${norm(sug?.textContent)}")`);
  tap(sug);
  assert(E.slateCount() === 10 && E.toasts().some((x) => x === 'Added 3 games. The slate is at 10; add more one at a time.'), `7-9 it adds 3, stops at 10 and says so (${E.slateCount()} on the slate; ${E.toasts().join(' | ')})`);
  assert(!document.getElementById('apply-suggested-btn'), '7-10 at the slate size the button is gone (nothing to bulk add)');
  const W = await import('./js/week-wizard.js');
  const baseDeps = (existing, extra = {}) => {
    const have = [...existing];
    return {
      fetchByDateRange: async () => ({ games: mkC(10).map((g) => ({ ...g, kickoff: '2026-10-17T16:00:00Z' })) }), saveAvailableGames() {}, clearAvailableGames() {}, getAvailableGames: () => mkC(10), isSuggestionRejected: () => false,
      scoreCandidateGames: (g) => g, buildSuggestedSlate: (g) => ({ slate: g.slice(0, 10), shortlist: [] }), getGames: () => have, saveGame: (g) => have.push(g), createGame: (w, d) => ({ ...d }), claimedAlmaMaters: () => [], profileForWeek: () => CFB_PROFILE, ...extra,
    };
  };
  const wkp = { weekId: 'w', startDate: '2026-10-17', endDate: '2026-10-18' };
  const seven = () => mkC(7).map((g) => ({ ...g, homeTeam: `X${g.homeTeam}` }));
  let res = await W.fetchAndApplySuggestedSlate({ week: wkp, deps: baseDeps(seven()) });
  assert(res.ok && res.added === 10 && res.held === 0 && res.target === null, `7-11 with NO slateTargetFor dep the fetch is exactly as before (adds all 10 on top of 7: ${res.added})`);
  res = await W.fetchAndApplySuggestedSlate({ week: wkp, deps: baseDeps(seven(), { slateTargetFor: () => 10 }) });
  assert(res.ok && res.added === 3 && res.held === 7 && res.target === 10, `7-12 with the dep it stops at 10: added ${res.added}, held ${res.held}, target ${res.target}`);
  res = await W.fetchAndApplySuggestedSlate({ week: wkp, deps: baseDeps([], { slateTargetFor: () => 10 }) });
  assert(res.ok && res.added === 10 && res.held === 0, `7-13 an empty slate with the dep still takes all 10 (${res.added})`);
  // the engine widened the slate (11 alma-mater games against a size of 10): "ALL is absolute", so Build slate takes all 11 and holds nothing
  const wide = () => mkC(11).map((g, i) => ({ ...g, kickoff: '2026-10-17T16:00:00Z', espnEventId: `W${i}` }));
  res = await W.fetchAndApplySuggestedSlate({ week: wkp, deps: baseDeps([], { slateTargetFor: () => 10, fetchByDateRange: async () => ({ games: wide() }), getAvailableGames: () => wide(), buildSuggestedSlate: (g) => ({ slate: g.slice(0, 11), shortlist: [] }) }) });
  assert(res.ok && res.added === 11 && res.held === 0, `7-14 Build slate with an engine-widened slate of 11 (size 10) adds all 11 and holds none (added ${res.added}, held ${res.held})`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[8] DI-W68.7: a filter change, then ONE Player Requests Add saves exactly one game');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ games: 4, pool: [20, 21] });
  requestFor(20);
  E.render();
  const grBtn = () => document.querySelector('#game-requests-section [data-action="gr-add"]');
  assert(!!grBtn() && grBtn().getAttribute('data-event-id') === 'E20' && !grBtn().getAttribute('data-game'), '8-0 fixture: the Player Requests card offers "+ Add to slate" for the requested game (event id only; no game JSON in the page)');
  // change a filter the way a commissioner does: a real `change` on the real control
  const chip = document.getElementById('avail-tight-only');
  chip.checked = true; chip.dispatchEvent({ type: 'change' });
  const chip2 = document.getElementById('avail-alma-only');
  chip2.checked = true; chip2.dispatchEvent({ type: 'change' });
  chip2.checked = false; chip2.dispatchEvent({ type: 'change' });
  chip.checked = false; chip.dispatchEvent({ type: 'change' });
  const before = E.slateCount();
  tap(grBtn());
  assert(E.slateCount() === before + 1 && storage.getGames('w7').filter((g) => g.espnEventId === 'E20').length === 1, `8-1 after FOUR filter changes, ONE tap on the requests card's Add saves exactly one game (slate ${before} -> ${E.slateCount()}; E20 copies: ${storage.getGames('w7').filter((g) => g.espnEventId === 'E20').length})`);
  assert(E.toasts().filter((x) => x === 'Added Away20 @ Home20.').length === 1, '8-2 …and ONE toast');
  assert(!grBtn() && /On slate/.test(norm(document.querySelector('#gr-comm-rows')?.textContent)), '8-3 the card\'s row flipped in place to "On slate" (no page repaint)');
  // the same, through the list's own Add after filter changes
  const b21 = addButton(21);
  chip.checked = true; chip.dispatchEvent({ type: 'change' }); chip.checked = false; chip.dispatchEvent({ type: 'change' });
  const n2 = E.slateCount();
  tap(addButton(21));
  assert(E.slateCount() === n2 + 1 && b21, '8-4 and the list\'s own Add, after more filter changes, also saves exactly one');
  // structural: nothing in the app binds Add buttons with a document-wide querySelectorAll any more
  const ap = readFileSync(path.join(HERE, 'js/app.js'), 'utf8');
  const code = ap.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');
  assert(!/querySelectorAll\('\.add-avail-game-btn'\)|bindAvailGroupHandlers|reRenderAvail/.test(code), '8-5 static: no document-wide `.add-avail-game-btn` binder, bindAvailGroupHandlers() or reRenderAvail() remains in the code of app.js');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[9] the swap picker sheet (DI-W68.3; docs/mockups/d1/swap-picker.html)');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset(); E.seedWeek({ status: 'open', games: 10, pool: [20], picks: { 2: 3, 5: 1 } }); E.render();
  const btn = addButton(20); btn.focus();
  tap(btn); tap(E.layerAct('slate-swap'));
  assert(!E.layer() && !!pickerWrap() && pickerWrap().getAttribute('data-hold-teardown') !== null, '9-1 "Swap with a game on the slate" closes the choice sheet and opens the picker (swept by a hold like every body-appended sheet)');
  assert(norm(document.getElementById('swap-picker-title').textContent) === 'Swap out which game?', '9-2 the title reads "Swap out which game?"');
  const adding = norm(document.querySelector('.swap-pk-adding')?.textContent);
  assert(/^AddingAway20 @ Home20/.test(adding) && /\(ESPN\)$/.test(adding), `9-3 the "Adding" card names the incoming game with its line and source ("${adding}")`);
  const radios = pickerRadios();
  assert(radios.length === 10 && document.querySelector('#swap-picker-body [role="radiogroup"]')?.getAttribute('aria-label') === 'Games on the slate', '9-4 ten radio rows in a radiogroup labelled "Games on the slate"');
  assert(radios.every((r) => r.getAttribute('aria-checked') === 'false'), '9-5 nothing is preselected');
  assert(goBtn().disabled && norm(goBtn().textContent) === 'Swap', '9-6 the primary button reads "Swap" and is DISABLED until a row is chosen');
  const chips = [...document.querySelectorAll('.swap-pk-picks')].map((c) => norm(c.textContent));
  assert(chips.length === 2 && chips.includes('3 picks') && chips.includes('1 pick'), `9-7 a pick-count chip only on games that have picks, count only: ${chips.join(', ')}`);
  assert(storage.getPicks('w7').length === 4 && storage.getPicks('w7').every((p) => p.selectedTeam === E.PICKED), '9-8a fixture: four submitted picks, each choosing a team that is NO game\'s name (so any appearance of it is a leak)');
  assert(!document.getElementById('swap-picker-sheet-wrap').textContent.includes(E.PICKED) && !E.page().textContent.includes(E.PICKED) && !E.page().innerHTML.includes(E.PICKED), '9-8 THE BLIND RULE: the picker and the list show matchups, times, lines and COUNTS only - nobody\'s selection appears anywhere (an OPEN week)');
  native(true);
  tap(radios[2]);
  assert(radios[2].getAttribute('aria-checked') === 'true' && radios.filter((r) => r.getAttribute('aria-checked') === 'true').length === 1, '9-9 choosing a row selects exactly that row (a radio group)');
  assert(!goBtn().disabled && norm(goBtn().textContent) === 'Swap and delete 3 picks', `9-10 the button names the picks that will be deleted: "${norm(goBtn().textContent)}"`);
  const warn = norm(document.querySelector('.swap-pk-warn')?.textContent);
  assert(warn === '3 submitted picks on Away2 @ Home2 will be deleted.', `9-11 the inline warning says the same ("${warn}")`);
  assert(/3 picks, selected/.test(radios[2].getAttribute('aria-label')) && /not selected/.test(radios[1].getAttribute('aria-label')), '9-12 VoiceOver labels: "Away2 at Home2, …, 3 picks, selected" / "…not selected"');
  tap(radios[5]);
  assert(norm(goBtn().textContent) === 'Swap and delete 1 pick' && /^1 submitted pick on /.test(norm(document.querySelector('.swap-pk-warn').textContent)), '9-13 a single pick is singular: "Swap and delete 1 pick"');
  tap(radios[0]);
  assert(norm(goBtn().textContent) === 'Swap' && !document.querySelector('.swap-pk-warn'), '9-14 a game with no picks: plain "Swap", no warning');
  assert(haptics.filter((h) => h === 'selection').length === 3 && haptics.length === 3, `9-15 native haptics: one selection tick per row chosen, none on open (${haptics.join(',')})`);
  haptics.length = 0;
  tap(radios[2]);
  haptics.length = 0;
  tap(goBtn());
  assert(E.slateCount() === 10 && E.names().includes('Away20 @ Home20') && !E.names().includes('Away2 @ Home2') && storage.countPicksForGame('g2') === 0, '9-16 Swap: the chosen game left (with its picks), the incoming one is on the slate, the count is still 10');
  assert(haptics.join(',') === 'notification:SUCCESS', `9-17 native haptic on commit: success, once (${haptics.join(',')})`);
  assert(!E.toasts().some((x) => /^Swapped /.test(x)), '9-18 the toast waits for the sheet\'s slide-out (not shown while the picker is still on screen)');
  await sleep(450);
  assert(!pickerWrap(), '9-19 the picker is gone after its slide');
  assert(E.toasts().some((x) => x === 'Swapped Away2 @ Home2 for Away20 @ Home20.'), `9-20 then the toast: "Swapped Away2 @ Home2 for Away20 @ Home20." (${E.toasts().join(' | ')})`);
  native(false);
  assert(E.rowFor(20)?.getAttribute('data-row-state') === 'on' && E.rowFor(2)?.getAttribute('data-row-state') !== 'on', '9-21 the list behind the sheet already shows the swap (Away20 is On slate, Away2 is not)');
  // Cancel paths change nothing
  E.reset(); E.seedWeek({ status: 'open', games: 10, pool: [20], picks: { 2: 3 } }); E.render();
  const b2 = addButton(20); b2.focus();
  tap(b2); tap(E.layerAct('slate-swap')); tap(pickerRadios()[2]);
  tap(document.querySelector('#swap-picker-sheet-wrap .chat-sheet-backdrop'));
  await sleep(450);
  assert(!pickerWrap() && E.slateCount() === 10 && storage.countPicksForGame('g2') === 3 && !E.names().includes('Away20 @ Home20'), '9-22 a backdrop tap closes the picker and changes NOTHING (the picks are still there)');
  assert(document.activeElement === b2, '9-23 …and focus returns to the control that raised the sheet');
  tap(b2); tap(E.layerAct('slate-swap'));
  tap(document.getElementById('swap-picker-close'));
  await sleep(450);
  assert(!pickerWrap() && E.slateCount() === 10, '9-24 the web ✕ closes it, nothing changed');
  tap(b2); tap(E.layerAct('slate-swap'));
  document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  await sleep(450);
  assert(!pickerWrap() && document.activeElement === b2, '9-25 Escape closes it, focus back on the Add button');
  native(true); E.render();
  tap(addButton(20)); tap(E.layerAct('slate-swap'));
  assert(!document.getElementById('swap-picker-close') && !!document.querySelector('#swap-picker-sheet .sheet-grabber'), '9-26 native shows the grabber and no ✕ (web shows ✕ and no grabber)');
  native(false); cancelAll();
  // the suspension lists
  const nav = readFileSync(path.join(HERE, 'js/nav-gestures.js'), 'utf8'), cc = readFileSync(path.join(HERE, 'js/control-center.js'), 'utf8'), ap = readFileSync(path.join(HERE, 'js/app.js'), 'utf8');
  assert(/getElementById\?\.\('swap-picker-sheet-wrap'\)/.test(nav.slice(nav.indexOf('export function gesturesSuspended'))), '9-27 gesturesSuspended() lists swap-picker-sheet-wrap');
  assert(/getElementById\?\.\('swap-picker-sheet-wrap'\)/.test(cc.slice(cc.indexOf('function isBlockedByOtherSurface'))), '9-28 the drawer\'s isBlockedByOtherSurface() lists it');
  assert(/excludeSwap && document\.getElementById\('swap-picker-sheet-wrap'\)/.test(ap), '9-29 _dismissBlockingSurfaceUp() lists it, with its own carve-out for its own swipe-down');
  const { gesturesSuspended } = await import('./js/nav-gestures.js');
  E.reset(); E.seedWeek({ games: 10, pool: [20] }); E.render();
  const sBefore = gesturesSuspended();
  tap(addButton(20)); tap(E.layerAct('slate-swap'));
  assert(sBefore === false && gesturesSuspended() === true, '9-30 gesturesSuspended() is true for exactly the life of the picker (no page swipe, pull-to-refresh or drawer drag arms under it)');
  assert(app._dismissBlockingSurfaceUpForTest({}) === true && app._dismissBlockingSurfaceUpForTest({ excludeSwap: true }) === false, '9-31 …and the picker\'s own swipe-down is not blocked by itself, while every other surface is');
  app._resetSwapPickerForTest();
  // the manual origin: the choice, then the picker, then the form; the swap happens only on Save
  E.reset(); E.seedWeek({ status: 'open', games: 10, pool: [], picks: { 4: 2 } }); E.render();
  tap(document.getElementById('add-manual-game-btn'));
  assert(/The slate has 10 games/.test(E.layerText()) && /Add the new game as game 11/.test(E.layerText()), `9-32 Add a game at 10 asks FIRST, naming "the new game" (${E.layerText()})`);
  tap(E.layerAct('slate-swap'));
  const addingM = norm(document.querySelector('.swap-pk-adding').textContent);
  assert(/A game you.ll enter next/.test(addingM) && !/ESPN|No spread/.test(addingM), `9-33 the Adding card reads "A game you'll enter next" and shows no spread ("${addingM}")`);
  tap(pickerRadios()[4]);
  assert(norm(goBtn().textContent) === 'Continue' && /2 submitted picks on Away4 @ Home4 will be deleted when you save the new game\./.test(norm(document.querySelector('.swap-pk-warn').textContent)),
    `9-34 manual origin: the button reads "Continue" and the warning says the picks go when the game is SAVED ("${norm(document.querySelector('.swap-pk-warn').textContent)}")`);
  tap(goBtn());
  assert(!pickerWrap() && !!document.getElementById('m-save') && E.slateCount() === 10 && storage.countPicksForGame('g4') === 2, '9-35 Continue closes the picker and opens the form - NOTHING has been swapped yet');
  document.querySelector('.modal-overlay')?.remove();   // abandon the form (its Cancel / scrim): everything as it was
  assert(E.slateCount() === 10 && storage.countPicksForGame('g4') === 2 && E.names().includes('Away4 @ Home4'), '9-36 abandoning the form leaves the slate and the picks exactly as they were');
  tap(document.getElementById('add-manual-game-btn')); tap(E.layerAct('slate-swap')); tap(pickerRadios()[4]); tap(goBtn());
  document.getElementById('m-home').value = 'Tulane'; document.getElementById('m-away').value = 'Memphis';
  tap(document.getElementById('m-save'));
  assert(E.slateCount() === 10 && E.names().includes('Memphis @ Tulane') && !E.names().includes('Away4 @ Home4') && storage.countPicksForGame('g4') === 0, '9-37 Save on the form performs the swap: the new game in, Away4 @ Home4 and its 2 picks out');
  // extend on the manual path adds on Save only
  E.reset(); E.seedWeek({ games: 10, pool: [] }); E.render();
  tap(document.getElementById('add-manual-game-btn')); tap(E.layerAct('slate-extend'));
  assert(!!document.getElementById('m-save') && E.slateCount() === 10, '9-38 manual Extend opens the form and adds nothing yet');
  document.getElementById('m-home').value = 'Tulane'; document.getElementById('m-away').value = 'Memphis';
  tap(document.getElementById('m-save'));
  assert(E.slateCount() === 11 && E.toasts().some((x) => x === 'Added as game 11.'), '9-39 Save adds it as game 11');
  // a duplicate typed by hand is refused by the join rule
  tap(document.getElementById('add-manual-game-btn')); tap(E.layerAct('slate-extend'));
  document.getElementById('m-home').value = ' TULANE '; document.getElementById('m-away').value = 'memphis';
  tap(document.getElementById('m-save'));
  assert(E.slateCount() === 11 && E.toasts().some((x) => /already on the slate/.test(x)), '9-40 the same game typed again (case and spaces differ) is refused as already on the slate');
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[10] the NFL at its maximum: Swap only, and it says why');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  E.reset({ sports: 'multi' }); E.seedWeek({ sport: 'nfl', games: 10, pool: [20], extra: { tiebreakerGameId: 'g9' } }); E.render();
  tap(addButton(20));
  const acts = [...E.layer().querySelectorAll('[data-ls-action]')].map((b) => b.getAttribute('data-ls-action'));
  assert(/The slate is full/.test(E.layerText()) && /NFL slates run 8 to 10 games\. Swap Away20 @ Home20 for a game that is already on the slate\./.test(E.layerText()), `10-1 NFL at 10: "The slate is full" and the reason (${E.layerText()})`);
  assert(!acts.includes('slate-extend') && acts.includes('slate-swap') && acts.includes('cancel'), `10-2 …and offers Swap only (no "Add as game 11"): ${acts.join(', ')}`);
  tap(E.layerAct('cancel'));
  E.reset({ sports: 'multi' }); E.seedWeek({ sport: 'nfl', games: 9, pool: [20] }); E.render(); tap(addButton(20));
  assert(!E.layer() && E.slateCount() === 10, '10-3 NFL at 9: Add is one tap');
  assert(SA.slateAddDecision({ count: 12, profile: { slate: { size: 10, maxSize: 10 } } }).canExtend === false, '10-4 a slate already over a ceiling can only swap');
  E.reset({ sports: 'multi' }); E.seedWeek({ sport: 'nfl', games: 10, pool: [] }); E.render();
  tap(document.getElementById('add-manual-game-btn'));
  assert(/The slate is full/.test(E.layerText()) && /Swap the new game for a game that is already on the slate\./.test(E.layerText()), '10-5 NFL manual add at 10: the same Swap-only sheet, naming "the new game"');
  cancelAll();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[10b] review round 1: F-1 the picker swiped down OVER the wizard; F-2 Step 2 announces only a change made while it is open');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const swipeDown = (header) => {                       // a real touch sequence on the header: the binder's own listeners (native only), its own getBlocked() at touchstart and at settle
    const t = (type, y) => header.dispatchEvent({ type, touches: type === 'touchend' ? [] : [{ clientX: 120, clientY: y }] });
    t('touchstart', 40); t('touchmove', 90); t('touchmove', 500); t('touchend');   // 460 of the sheet's 800 pt: past the settle ratio
  };
  // control: the picker raised from the Games list (no wizard under it) is dismissed by a swipe-down
  E.reset(); E.seedWeek({ status: 'draft', games: 10, pool: [20] }); native(true); E.render();
  tap(addButton(20)); tap(E.layerAct('slate-swap'));
  swipeDown(document.querySelector('#swap-picker-sheet .chat-sheet-header')); await sleep(600);   // the slide-out fallback is 420 ms
  assert(!pickerWrap() && E.slateCount() === 10, '10b-1 control: a swipe-down on the picker header dismisses it (native shell), and changes nothing');
  // F-1: the same picker raised from the wizard's Step 2 manual add
  E.reset(); E.seedWeek({ status: 'draft', games: 10, pool: [20] }); native(true);
  openStep2();
  tap(document.getElementById('wiz-step2-add-manual')); tap(E.layerAct('slate-swap'));
  assert(!!pickerWrap() && !!document.getElementById('week-wizard-sheet-wrap'), '10b-2 fixture: the picker is up OVER the open wizard sheet');
  assert(app._dismissBlockingSurfaceUpForTest({ excludeWizard: true }) === true, '10b-2a …and the picker still blocks the WIZARD\'s own swipe (nothing is swiped away from under it)');
  swipeDown(document.querySelector('#swap-picker-sheet .chat-sheet-header')); await sleep(600);   // the slide-out fallback is 420 ms
  assert(!pickerWrap() && !!document.getElementById('week-wizard-sheet-wrap') && E.slateCount() === 10, '10b-3 F-1: a swipe-down on the picker header OVER the wizard dismisses the picker (the wizard is not an "other surface" to it), leaves the wizard up and changes nothing');
  assert(!E.layer(), '10b-3a …with no sheet left behind');
  native(false); cancelAll();
  // F-2: an add made on the Games list with the wizard CLOSED is not announced by Step 2 the next time it opens
  E.reset(); E.seedWeek({ games: 9, pool: [20, 21] }); E.render();
  tap(addButton(20));
  assert(E.slateCount() === 10 && E.toasts().includes('Added Away20 @ Home20.'), '10b-4 fixture: the Games-list add (wizard closed) saved the game and toasted');
  const b4 = openStep2();
  assert(norm(b4.querySelector('#wiz-fetch-status').textContent) === '', `10b-5 F-2: Step 2's first paint carries no stale note ("${norm(b4.querySelector('#wiz-fetch-status').textContent)}")`);
  assert(/10 games on your slate/.test(norm(b4.querySelector('#wiz-step2-count').textContent)), '10b-5a …but the standing count line is right');
  cancelAll();   // (a change made while Step 2 IS up is announced: R-9 / P18)
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
section('[11] static: one door; and every encoded mutant still applies to the live tree');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const jsDir = path.join(HERE, 'js');
  const hits = [];
  for (const f of readdirSync(jsDir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(path.join(jsDir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    const n = (src.match(/saveGame\(\s*createGame\(/g) || []).length;
    if (n) hits.push(`${f}:${n}`);
  }
  assert(hits.join(',') === 'week-wizard.js:1', `11-1 the only \`saveGame(createGame(\` left in js/ is the wizard's own bulk fetch (found: ${hits.join(', ') || 'none'}); every other slate add is addGameToSlate()`);
  const ap = readFileSync(path.join(HERE, 'js/app.js'), 'utf8');
  assert(!/\bconfirm\(/.test(ap.slice(ap.indexOf('COMM -> GAMES: ONE GAMES LIST'), ap.indexOf('// ─── COLLAPSIBLE COMMISSIONER SECTIONS'))), '11-2 no browser confirm() remains in the slate paths (the sheets are the app\'s own)');
  let kit = [];
  try { kit = JSON.parse(readFileSync(path.join(HERE, 'tests/kits/w68-w69-mutants.json'), 'utf8')); } catch { /* absent until the kit is committed */ }
  let bad = [];
  for (const m of kit) {
    const src = readFileSync(path.join(HERE, m.file), 'utf8');
    const n = src.split(m.old).length - 1;
    if (n !== 1) bad.push(`${m.id} (${n})`);
  }
  assert(kit.length > 0 && bad.length === 0, `11-3 every kit mutant's \`old\` string matches the live tree exactly once (${kit.length} mutants; mismatches: ${bad.join(', ') || 'none'})`);
}

console.log(`\n${fail ? '❌ FAILURES' : '✅ ALL PASS'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
