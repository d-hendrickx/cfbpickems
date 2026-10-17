#!/usr/bin/env node
/**
 * CFB Pickems - tests/kits/w70-w71-mutants.mjs (D1 / v0.30.0, thread 100726-D1; the S-3 mutation kit of W-70 and W-71, feature-builder, 2026-10-14)
 * ====================================================================================================================================================
 * THE ITEM'S KIT (S-3, D-69): every mutant the builder used to prove the W-70 and W-71 tests are not vacuous, encoded so the reviewer re-runs them and adds only gap mutants.
 * Each mutant is applied to a COPY of this cfb-pickems tree (never the checkout: no git restore, no stash, no in-place edit), the named suite is run IN THE COPY, and the mutant is
 * CAUGHT only if the suite exits non-zero AND every check named in `red` prints a cross. The copy's file goes back to the checkout's own text before the next mutant.
 *
 * W-70 (native navigation in Comm)         ids W70-xx    suites commpagertest.mjs (node), commnavbrowsertest.mjs (real Chromium, about 100 s each)
 * W-71 (Find spreads)                      ids W71-xx    suites oddsfallbacktest.mjs, supabase/tests/functions/oddsLookup.twin.mjs, supabase/tests/functions.check.mjs
 *
 * Run:  node tests/kits/w70-w71-mutants.mjs                      every mutant (the Chromium ones dominate: allow about 15 minutes)
 *       node tests/kits/w70-w71-mutants.mjs W70-01 W71-03        just those
 *       node tests/kits/w70-w71-mutants.mjs --node               every mutant whose suite is not the browser one (about 2 minutes)
 *       node tests/kits/w70-w71-mutants.mjs --discover W70-01    print the red lines instead of judging (how `red` was recorded)
 *       node tests/kits/w70-w71-mutants.mjs --anchors            only check every mutant's anchor text still matches exactly once (instant)
 * Exit 0 only when every mutant is CAUGHT. It is NOT registered with the runner: it copies the tree and takes minutes.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NG = 'js/nav-gestures.js', WN = 'js/wizard-nav.js', APP = 'js/app.js', CSS = 'css/styles.css', SFB = 'js/spread-fallback.js', SFU = 'js/spread-find-ui.js';
const VEN = 'supabase/functions/odds-lookup/vendor.mjs', MAT = 'supabase/functions/odds-lookup/match.mjs', IDX = 'supabase/functions/odds-lookup/index.js';
const CP = 'commpagertest.mjs', CB = 'commnavbrowsertest.mjs', OF = 'oddsfallbacktest.mjs', TW = 'supabase/tests/functions/oddsLookup.twin.mjs', FC = 'supabase/tests/functions.check.mjs';

// { id, what, file, find, replace, suite, red: [labels that must print a cross] } - `find` must match EXACTLY once.
const MUTANTS = [
  // -- W-70: the engine (js/nav-gestures.js) --
  { id: 'W70-01', what: 'Comm is not in the drawer-zone set (any swipe anywhere on Comm opens the drawer)', file: NG, find: "export const DRAWER_ZONE_TABS = Object.freeze(['picks', 'dashboard', 'commissioner']);", replace: "export const DRAWER_ZONE_TABS = Object.freeze(['picks', 'dashboard']);", suite: CP, red: ['A-1:', 'A-2:', 'A-3:'] },
  { id: 'W70-02', what: 'the Comm tab strip no longer keeps its touch from the drawer', file: NG, find: "  if (tab === 'commissioner' && _isCommTabStrip(target)) return false;\n", replace: '', suite: CP, red: ['A-6:', 'B2-7:'] },
  { id: 'W70-03', what: 'the pager-side yield (a field, the strip, a sideways scroller) is never asked', file: NG, find: "if (axis === 'x' && typeof opts.shouldYield === 'function') {", replace: 'if (false) {', suite: CP, red: ['B-4a:', 'B-4b:', 'B2-5:'] },
  { id: 'W70-04', what: 'canCommit is never asked: a refused step change slides anyway', file: NG, find: "if (target != null && typeof opts.canCommit === 'function') {", replace: 'if (false) {', suite: CP, red: ['B-5b:', 'B-5c:', 'B-5g:'] },
  { id: 'W70-05', what: 'opts.isSuspended is ignored: the wizard pager blocks itself behind its own sheet', file: NG, find: "if (busy || (typeof opts.isSuspended === 'function' ? opts.isSuspended() : gesturesSuspended())) { start = null; return; }", replace: 'if (busy || gesturesSuspended()) { start = null; return; }', suite: CP, red: ['B-2b:', 'F-9c-6:'] },
  { id: 'W70-06', what: 'opts.yieldToDrawer is ignored: the wizard\'s back swipe is stranded by a drawer that is not there', file: NG, find: "if (axis === 'x' && dx > 0 && opts.yieldToDrawer !== false && (", replace: "if (axis === 'x' && dx > 0 && (", suite: CP, red: ['B-3b:', 'F-9c-6:'] },
  { id: 'W70-07', what: 'pane mode places the exit layer viewport-fixed again (wrong inside the transformed sheet)', file: NG, find: "        cs.position = 'absolute';\n        cs.top = ", replace: "        cs.position = 'fixed';\n        cs.top = ", suite: CP, red: ['B-6c:'] },
  { id: 'W70-08', what: 'decorateOutgoing is never called: the Comm exit layer carries all five tabs', file: NG, find: "if (typeof opts.decorateOutgoing === 'function') { try {", replace: 'if (false) { try {', suite: CP, red: ['B-7a:', 'F-5f:'] },
  { id: 'W70-09', what: 'navigateRepaints:false is ignored: a repaint parked under a Comm swipe is dropped at the commit', file: NG, find: 'flushDeferredRenders(opts.navigateRepaints === false ? undefined : swipedPage)', replace: 'flushDeferredRenders(swipedPage)', suite: CP, red: ['B-8b:', 'F-6c:'] },
  { id: 'W70-10', what: 'allowWeb is ignored: no swipe-down on the web app', file: NG, find: 'if (!isNativeShell() && opts.allowWeb !== true) return () => {};', replace: 'if (!isNativeShell()) return () => {};', suite: CP, red: ['C-1b:', 'C-1c:', 'F-10d:'] },
  { id: 'W70-11', what: 'claimForwardOnly is ignored: an upward-first body drag is claimed (the body cannot scroll)', file: NG, find: 'if (claimForwardOnly && (axis === \'x\' ? dx : dy) <= 0) { start = null; return; }', replace: '', suite: CP, red: ['C-3a:', 'C-3b:', 'F-11g:'] },
  { id: 'W70-12', what: 'canStart is never asked: every touch on the sheet starts the swipe-down', file: NG, find: 'if (canStart) {\n      let ok = false;', replace: 'if (false) {\n      let ok = false;', suite: CP, red: ['C-2a:', 'C-2b:', 'F-11d:'] },
  { id: 'W70-13', what: 'the swap picker sheet no longer suspends the shared gestures', file: NG, find: "  if (document.getElementById?.('swap-picker-sheet-wrap')) return true;\n", replace: '', suite: CP, red: ['A-19:', 'E-4:', 'F-9d-2:'] },
  { id: 'W70-14', what: 'a refused swipe never calls onRefused: the button\'s own message and the discard ask never appear', file: NG, find: "if (refusedDir !== 0 && typeof opts.onRefused === 'function') {", replace: 'if (false) {', suite: CP, red: ['B-5b:', 'B-5g:', 'F-9c-6:'] },
  // -- W-70: the pure decisions (js/wizard-nav.js) --
  { id: 'W70-15', what: 'controls that save on change count as unsaved edits', file: WN, find: '    if (isAutosaveControl(el)) continue;\n', replace: '', suite: CP, red: ['D-22:', 'D-29:', 'F-9:'] },
  { id: 'W70-16', what: 'Step 4 forward is always Step 5 (ignores a valid blurb)', file: WN, find: "4: ['3', blurbValid ? '6' : '5']", replace: "4: ['3', '5']", suite: CP, red: ['D-4:', 'F-13i:'] },
  { id: 'W70-17', what: 'a body scrolled down still starts the swipe-down', file: WN, find: '  if ((bodyEl.scrollTop || 0) > 0) return false;\n', replace: '', suite: CP, red: ['D-16:', 'F-11d:', 'F-11e:'] },
  { id: 'W70-18', what: 'the side panel (>= 700 px) arms the swipe-down', file: WN, find: 'return typeof viewportWidthPx === \'number\' && viewportWidthPx > 0 && viewportWidthPx < WIZARD_SHEET_FORM_MAX_PX;', replace: 'return typeof viewportWidthPx === \'number\' && viewportWidthPx > 0 && viewportWidthPx < 100000;', suite: CP, red: ['D-20:', 'F-11g:'] },
  { id: 'W70-19', what: 'Step 5 forward ignores the blurb check', file: WN, find: 'case 5: return !blurbRequired || !!blurbTypedOk;', replace: 'case 5: return true;', suite: CP, red: ['D-11:', 'F-13c:', 'F-17e:'] },
  { id: 'W70-20', what: 'the unsaved-edits comparison never reports a difference', file: WN, find: 'if (was.has(key) && was.get(key) !== value) return true;', replace: 'if (false) return true;', suite: CP, red: ['D-24:', 'D-25:', 'D-26:'] },
  // -- W-70: the wiring (js/app.js) --
  { id: 'W70-21', what: 'the backdrop closes the wizard without asking', file: APP, find: '    onBackdrop: requestCloseWeekWizardSheet,', replace: '    onBackdrop: closeWeekWizardSheet,', suite: CP, red: ['E-2a:', 'F-8c:'] },
  { id: 'W70-22', what: 'a dismissing swipe slides away without asking when there are edits', file: APP, find: "  if (_finalizeInFlight || wizardHasUnsavedEdits()) {\n    wrap.style.setProperty('--wizard-drag-y', '0');", replace: "  if (false) {\n    wrap.style.setProperty('--wizard-drag-y', '0');", suite: CP, red: ['E-2b:', 'F-10d:', 'F-11i:'] },
  { id: 'W70-23', what: 'a finalize in flight no longer refuses the close', file: APP, find: "  if (_finalizeInFlight) { showToast(WIZ_NAV_COPY.FINALIZING, 'info'); return false; }\n", replace: '', suite: CP, red: ['F-10b:'] },
  { id: 'W70-24', what: 'the baseline is never captured (nothing is ever dirty)', file: APP, find: '  paintWeekWizardSheetBody();\n  captureWizardBaseline();', replace: '  paintWeekWizardSheetBody();', suite: CP, red: ['F-8b:', 'F-8c:'] },
  { id: 'W70-25', what: 'a wizard repaint is not parked while the step pager owns the touch', file: APP, find: "  if (deferRenderWhileWeekSwiping('week-wizard', renderWeekWizardSheetBody)) return;\n", replace: '', suite: CP, red: ['F-17b:', 'F-17c:', 'F-17d:'] },
  { id: 'W70-26', what: 'a Comm repaint is not parked while the tab pager owns the touch', file: APP, find: "if (deferRenderWhileWeekSwiping('commissioner', () => {", replace: "if (false && deferRenderWhileWeekSwiping('commissioner', () => {", suite: CP, red: ['F-6b:'] },
  { id: 'W70-27', what: 'the tab tap no longer goes through setCommTab (two paths again)', file: APP, find: "btn.addEventListener('click', () => setCommTab(btn.dataset.commTabBtn, { source: 'tap' }));", replace: "btn.addEventListener('click', () => { state.commTab = btn.dataset.commTabBtn; });", suite: CP, red: ['F-3a:', 'F-3b:', 'F-3c:'] },
  { id: 'W70-28', what: 'a refused Next swipe does not click the button (no inline message)', file: APP, find: '    return;\n  }\n  btn.click();\n}\n\n/** The commit:', replace: '    return;\n  }\n}\n\n/** The commit:', suite: CP, red: ['F-13b:'] },
  { id: 'W70-29', what: 'the Comm exit layer is not trimmed to the outgoing tab', file: APP, find: 'if (own !== null && own !== undefined && own !== key) sec.remove();', replace: '', suite: CP, red: ['F-5f:'] },
  { id: 'W70-30', what: 'the wizard pager uses the shared gate and blocks itself', file: APP, find: '    isSuspended: isWizardDismissGestureBlocked,\n', replace: '', suite: CP, red: ['F-9c-6:'] },
  { id: 'W70-31', what: 'the Comm pager has no field/strip yield', file: APP, find: '        shouldYield: (target) => isPagerYieldTarget(target, commRoot),\n', replace: '', suite: CP, red: ['F-4e:', 'F-4f:', 'F-5a:'] },
  { id: 'W70-49', what: 'the drawer\'s sideways-scroller list loses the Comm tab strip (the strip would open the Control Center / page tabs under a finger scrolling it)', file: NG, find: "'.chat-pills-scroll, .dashboard-scroll, .comm-tabbar, .batch-grid-scroll,", replace: "'.chat-pills-scroll, .dashboard-scroll, .batch-grid-scroll,", suite: CP, red: ['E-5:'] },
  // -- W-70: the other surfaces the shared gestures must stand down for, and the controls that save on change --
  { id: 'W70-32', what: 'the control center\'s edge swipe still arms under the swap picker sheet', file: 'js/control-center.js', find: "  if (document.getElementById?.('swap-picker-sheet-wrap')) return true;\n", replace: '', suite: CP, red: ['E-4:'] },
  { id: 'W70-33', what: 'the swap picker sheet is not among the surfaces _dismissBlockingSurfaceUp() sees (after the W-69 merge the line is W-69\'s carve-out form)', file: APP, find: "  if (!excludeSwap && document.getElementById('swap-picker-sheet-wrap')) return true;\n", replace: '', suite: CP, red: ['E-4:', 'F-16b:'] },
  { id: 'W70-34', what: 'Step 6\'s tiebreaker question counts as an unsaved edit (its autosave mark is gone)', file: APP, find: 'id="wiz-tb-question" data-wiz-autosave value=', replace: 'id="wiz-tb-question" value=', suite: CP, red: ['E-6:', 'F-9:'] },
  { id: 'W70-35', what: 'Step 3\'s tiebreaker game select counts as an unsaved edit (its autosave mark is gone)', file: APP, find: 'aria-label="Tiebreaker game" data-wiz-autosave>', replace: 'aria-label="Tiebreaker game">', suite: CP, red: ['E-6:'] },
  { id: 'W70-36', what: 'the reminder cadence select counts as an unsaved edit (its autosave mark is gone)', file: APP, find: '<select class="form-select" id="wiz-reminder-cadence" data-wiz-autosave>', replace: '<select class="form-select" id="wiz-reminder-cadence">', suite: CP, red: ['E-6:'] },
  { id: 'W70-37', what: 'the extra-point switch row counts as an unsaved edit (its autosave mark is gone)', file: APP, find: '<div class="form-group" data-wiz-autosave>${switchRowHTML({ id: \'wiz-ep-enabled\'', replace: '<div class="form-group">${switchRowHTML({ id: \'wiz-ep-enabled\'', suite: CP, red: ['E-6:'] },
  { id: 'W70-38', what: 'the reminder cooldown counts as an unsaved edit (its autosave mark is gone)', file: APP, find: 'id="wiz-reminder-cooldown" data-wiz-autosave value=', replace: 'id="wiz-reminder-cooldown" value=', suite: CP, red: ['E-6:'] },
  // -- W-70: in the real engine --
  { id: 'W70-40', what: 'the stylesheet leaves #page-commissioner out of the pager transform (a Comm swipe never moves the page)', file: CSS, find: '#page-picks,#page-dashboard,#page-commissioner,#week-wizard-pager{transform:translateX(var(--week-swipe-x,0px))}', replace: '#page-picks,#page-dashboard,#week-wizard-pager{transform:translateX(var(--week-swipe-x,0px))}', suite: CP, red: ['E-1b:'] },
  { id: 'W70-41', what: 'the body stays scrollable under a claimed swipe-down', file: CSS, find: '#week-wizard-sheet[data-dragging="true"] #week-wizard-body{overflow-y:hidden;overscroll-behavior-y:none}', replace: '#week-wizard-sheet[data-dragging="true"] #week-wizard-body{}', suite: CB, red: ['D-1b:'] },
  { id: 'W70-42', what: 'an incoming Comm layer shows the live panel\'s tab, not its own', file: CSS, find: '#page-commissioner .comm-pane[data-comm-pane] .admin-section[data-comm-tab],\n.week-swipe-exit-layer', replace: '.week-swipe-exit-layer', suite: CB, red: ['A-14:'] },
  { id: 'W70-43', what: 'the wizard exit layer is viewport-fixed again (misplaced inside the transformed sheet)', file: NG, find: "        cs.position = 'absolute';\n        cs.top = ", replace: "        cs.position = 'fixed';\n        cs.top = ", suite: CB, red: ['E-1e:', 'E-1f:'] },
  { id: 'W70-44', what: 'a Comm tab swipe plays the tab-tap haptic too (two haptics)', file: APP, find: "  if (source === 'swipe') scrollWindow(window, { top: 0, left: 0, behavior: 'instant' }, 'scrollTo');", replace: "  if (source === 'swipe') { scrollWindow(window, { top: 0, left: 0, behavior: 'instant' }, 'scrollTo'); haptic('selection'); }", suite: CB, red: ['G-1:'] },
  { id: 'W70-45', what: 'the swipe-down is native-only again (no allowWeb)', file: APP, find: "scope: 'sheet', allowWeb: true, canStart: wizardSheetDragCanStart", replace: "scope: 'sheet', canStart: wizardSheetDragCanStart", suite: CB, red: ['D-1a:', 'D-1b:', 'D-2:'] },
  // -- W-71: the client --
  { id: 'W71-01', what: 'Include also writes lockedSpread', file: SFB, find: 'return { spread: signed.spread, favorite: signed.favorite, spreadSource: ODDS_API_SOURCE, oddsProvider: card.provider };', replace: 'return { spread: signed.spread, favorite: signed.favorite, spreadSource: ODDS_API_SOURCE, oddsProvider: card.provider, lockedSpread: signed.spread };', suite: OF, red: ['D-6:', 'F-11:', 'H-10:'] },
  { id: 'W71-02', what: 'the home sign is flipped', file: SFB, find: 'if (favoriteTeam === homeTeam) return { spread: -m, favorite: homeTeam };', replace: 'if (favoriteTeam === homeTeam) return { spread: m, favorite: homeTeam };', suite: OF, red: ['B-1:', 'B-5:', 'B-6:'] },
  { id: 'W71-03', what: 'lines from the other source are applied without Include', file: SFB, find: '  out.other.cards = cards;', replace: '  out.other.cards = cards;\n  for (const c of cards) { const cur = liveGames().find((g) => g.gameId === c.gameId); const p = includePatch(cur, c); if (p) deps.saveGame({ ...cur, ...p }); }', suite: OF, red: ['E-2:', 'E-4:', 'F-6:'] },
  { id: 'W71-04', what: 'a card is built for any book', file: SFB, find: '  if (!KNOWN_PROVIDERS.includes(result.provider)) return null;\n', replace: '', suite: OF, red: ['D-3:'] },
  { id: 'W71-05', what: 'a pick\'em (0) counts as a missing spread', file: SFB, find: "  return !!game && !(typeof game.spread === 'number' && Number.isFinite(game.spread));", replace: '  return !!game && !game.spread;', suite: OF, red: ['A-1:', 'A-2:', 'A-3:'] },
  { id: 'W71-06', what: 'a forged book name reaches the label', file: SFB, find: 'if (src === ODDS_API_SOURCE && KNOWN_PROVIDERS.includes(game.oddsProvider)) return game.oddsProvider;', replace: 'if (src === ODDS_API_SOURCE) return game.oddsProvider;', suite: OF, red: ['C-4:', 'C-5:'] },
  { id: 'W71-07', what: 'ESPN\'s re-read overwrites a spread typed while it was being read (the missing list is taken BEFORE the await and the in-loop guard is gone; the guard alone is redundant defence in depth, the list taken AFTER the await is the protection)', file: SFB, find: "    let fresh = null;\n    try { fresh = await deps.fetchEspn(week); } catch { fresh = null; }\n    if (!fresh || fresh.error || !Array.isArray(fresh.games)) { out.stage1.error = true; return out; }\n    for (const p of espnSpreadPatches({ missing: findMissingSpreads(liveGames()), fresh: fresh.games })) {\n      const current = liveGames().find((g) => g.gameId === p.gameId);\n      if (!current || !isSpreadMissing(current)) continue;          // a manual entry in the meantime wins\n", replace: "    let fresh = null;\n    const before = findMissingSpreads(liveGames());\n    try { fresh = await deps.fetchEspn(week); } catch { fresh = null; }\n    if (!fresh || fresh.error || !Array.isArray(fresh.games)) { out.stage1.error = true; return out; }\n    for (const p of espnSpreadPatches({ missing: before, fresh: fresh.games })) {\n      const current = liveGames().find((g) => g.gameId === p.gameId);\n      if (!current) continue;\n", suite: OF, red: ['E-9:'] },
  { id: 'W71-08', what: 'a margin given as a string is accepted', file: SFB, find: "if (typeof margin !== 'number' || !Number.isFinite(margin) ||", replace: 'if (!Number.isFinite(Number(margin)) ||', suite: OF, red: ['D-3:'] },
  { id: 'W71-09', what: 'only the first host\'s card collapses (the visible one stays)', file: SFU, find: "for (const el of els) el.classList.add('is-leaving');", replace: "els[0].classList.add('is-leaving');", suite: CB, red: ['H-18:'] },
  { id: 'W71-10', what: 'a double tap on Include writes twice', file: SFU, find: '    if (st.busy.has(gameId)) return false;\n    const card = st.cards.find((c) => c.gameId === gameId);', replace: '    const card = st.cards.find((c) => c.gameId === gameId);', suite: OF, red: ['F-15:'] },
  { id: 'W71-11', what: 'the automatic check runs every time', file: SFU, find: 'if (st.autoRan || SF.findMissingSpreads(deps.getGames(weekId)).length === 0) return null;', replace: 'if (SF.findMissingSpreads(deps.getGames(weekId)).length === 0) return null;', suite: OF, red: ['F-18:'] },
  { id: 'W71-12', what: 'a demo week runs the check', file: SFU, find: "const canRun = (week) => !!week && week.dataSourceMode !== 'demo' && (week.status === 'draft' || week.status === 'open');", replace: "const canRun = (week) => !!week && (week.status === 'draft' || week.status === 'open');", suite: OF, red: ['F-27:', 'F-28:', 'H-25:'] },
  { id: 'W71-13', what: 'the error note\'s Try again button does nothing (it is not the find action)', file: SFB, find: 'data-spread-action="find">${escHtml(SPREAD_COPY.TRY_AGAIN)}', replace: 'data-spread-action="none">${escHtml(SPREAD_COPY.TRY_AGAIN)}', suite: OF, red: ['F-22b:', 'F-22c:'] },
  // -- review round 1 (2026-10-14): N-1, N-3, N-5, N-7 --
  { id: 'W71-14', what: 'the AUTOMATIC check shows the error note when the lookup fails (N-1)', file: SFU, find: "else if (o.status === 'error') { if (!auto) { st.note = SF.SPREAD_COPY.ERROR; st.noteKind = 'error'; } }", replace: "else if (o.status === 'error') { st.note = SF.SPREAD_COPY.ERROR; st.noteKind = 'error'; }", suite: OF, red: ['F-19b:'] },
  { id: 'W71-15', what: 'the AUTOMATIC check shows the error note when its whole run throws (N-1)', file: SFU, find: "if (!out) { if (!auto) { st.note = SF.SPREAD_COPY.ERROR; st.noteKind = 'error'; } paint(weekId); return null; }", replace: "if (!out) { st.note = SF.SPREAD_COPY.ERROR; st.noteKind = 'error'; paint(weekId); return null; }", suite: OF, red: ['F-19d:'] },
  { id: 'W71-16', what: 'Try again is a small button again (N-3)', file: SFB, find: 'class="btn btn-ghost spread-try-btn" data-spread-action="find"', replace: 'class="btn btn-ghost btn-sm" data-spread-action="find"', suite: CB, red: ['H-28:'] },
  { id: 'W71-17', what: 'the Find spreads block\'s bottom margin is doubled (a second 16 pt stacked on the first) (N-5)', file: CSS, find: '.spread-find{display:flex;flex-direction:column;gap:8px;margin-bottom:16px}', replace: '.spread-find{display:flex;flex-direction:column;gap:8px;margin-bottom:32px}', suite: CB, red: ['H-26:'] },
  { id: 'W70-46', what: 'the instant-switch flag is the old animation:none (clearing it would replay the fade over the landed tab) (N-7)', file: CSS, find: '#page-commissioner[data-comm-instant="true"] .admin-section[data-comm-tab]{animation-duration:0s}', replace: '#page-commissioner[data-comm-instant="true"] .admin-section[data-comm-tab]{animation:none}', suite: CB, red: ['A-20b:'] },
  { id: 'W70-47', what: 'the Comm binder never clears the instant-switch flag (N-7)', file: APP, find: "        onSettled: () => commRoot.removeAttribute('data-comm-instant'),\n", replace: '', suite: CP, red: ['F-2e:'] },
  { id: 'W70-48', what: 'the engine never calls onSettled (N-7)', file: NG, find: "    if (typeof opts.onSettled !== 'function') return;\n", replace: '    return;\n', suite: CP, red: ['B-10b:', 'F-2e:'] },
  // -- review round 1: security F-2, F-3, notes --
  { id: 'W71-32', what: 'the key is read BEFORE the commissioner gate (F-3a)', file: IDX, find: "  let caller;\n  try {\n    caller = await requireCommissioner(req, leagueId);\n  } catch (err) {\n    return refusalResponse(err);\n  }\n", replace: "  const earlyKey = Deno.env.get('ODDS_API_KEY'); void earlyKey;\n  let caller;\n  try {\n    caller = await requireCommissioner(req, leagueId);\n  } catch (err) {\n    return refusalResponse(err);\n  }\n", suite: TW, red: ['1-2:', '1-4:'] },
  { id: 'W71-33', what: 'the service client is built BEFORE the commissioner gate (F-3a)', file: IDX, find: "  let caller;\n  try {\n    caller = await requireCommissioner(req, leagueId);\n  } catch (err) {\n    return refusalResponse(err);\n  }\n", replace: "  try { serviceClient(); } catch { /* mutant */ }\n  let caller;\n  try {\n    caller = await requireCommissioner(req, leagueId);\n  } catch (err) {\n    return refusalResponse(err);\n  }\n", suite: TW, red: ['1-2:', '1-4:'] },
  { id: 'W71-34', what: 'the sport key is looked up through the prototype again (F-2)', file: IDX, find: "  const weekSport = typeof weekRow.sport === 'string' ? weekRow.sport : '';\n  const sportKey = Object.hasOwn(SPORT_KEYS, weekSport) ? SPORT_KEYS[weekSport] : undefined;\n", replace: "  const sportKey = SPORT_KEYS[String(weekRow.sport || '')];\n", suite: TW, red: ['3-14:'] },
  { id: 'W71-35', what: 'a vendor timestamp outside the Date range is not bounded and not caught (both guards gone)', file: MAT, edits: [{ find: 'return Number.isFinite(t) && Math.abs(t) <= MAX_DATE_MS ? t : null;', replace: 'return Number.isFinite(t) ? t : null;' }, { find: '  try { return new Date(t).toISOString(); } catch { return null; }', replace: '  return new Date(t).toISOString();' }], suite: TW, red: ['8-40:'] },
  { id: 'W71-36', what: 'the response carries the shared credits figure again', file: IDX, find: '  return finish(envelopeOk(runId, { results: built.results, unmatched: built.unmatched }));', replace: '  return finish(envelopeOk(runId, { results: built.results, unmatched: built.unmatched, creditsLeft: first.creditsLeft }));', suite: TW, red: ['5-1:', '5-8:'] },
  { id: 'W71-37', what: 'an answer is cached across leagues (the second league is handed the first league\'s lines) (F-3b)', file: IDX, edits: [{ find: '  if (!first.ok) return finish(unavailable(runId, first.reason));', replace: '  if (!first.ok) return finish(unavailable(runId, first.reason));\n  if (first.cached && globalThis.__lastBuilt) return finish(envelopeOk(runId, globalThis.__lastBuilt));' }, { find: '  return finish(envelopeOk(runId, { results: built.results, unmatched: built.unmatched }));', replace: '  globalThis.__lastBuilt = { results: built.results, unmatched: built.unmatched };\n  return finish(envelopeOk(runId, { results: built.results, unmatched: built.unmatched }));' }], suite: TW, red: ['7-5c:', '7-5d:'] },
  { id: 'W71-38', what: 'the adapter takes any sport key a caller hands it (defence in depth gone)', file: VEN, find: "  if (typeof sportKey !== 'string' || !KNOWN_SPORT_KEYS.has(sportKey)) return { ok: false, reason: 'vendor_error' };\n", replace: '', suite: TW, red: ['3-14c:'] },
  { id: 'W71-50', what: 'a PAUSED answer is hidden after an automatic check (the reviewer\'s GAP-D2; the coordinator ruled paused is shown: it explains why no card appears)', file: SFU, find: "else if (o.status === 'paused') st.note = SF.SPREAD_COPY.PAUSED;", replace: "else if (o.status === 'paused') st.note = auto ? '' : SF.SPREAD_COPY.PAUSED;", suite: OF, red: ['F-19e:'] },
  // -- M-45 option a (Drew D-77): RETIRED 2026-10-14 with the pilot gate (DI-W71.10, Drew D-80: "M45 b"; "(b) replaces (a)"). W71-51..55 mutated a gate that no longer exists; the per-league daily
  //    limit that replaced it has its own kit, tests/kits/w71-oddscap-mutants.mjs (OC-xx: the function, the adapter, the client; PG-xx: migration 0060 in PGlite). W71-56 stays (re-pointed at 4-1). --
  { id: 'W71-56', what: 'the league row is read with the service role again (the service client exists before the key is read)', file: IDX, find: "await caller.userSb.from('leagues')", replace: "await serviceClient().from('leagues')", suite: TW, red: ['4-1:'] },
  // -- Part 2 (2026-10-14): the merge with W-69, DI-W71.2's per-row Find spread and the Games-list summary entry, N-4, I-2..I-4 --
  { id: 'W71-40', what: 'Include repaints the whole Comm page again (navigateTo) instead of patching the Games section in place', file: APP, find: '    repaintHost: () => afterSlateChange(),', replace: "    repaintHost: () => { if (document.getElementById('week-wizard-sheet-wrap')) renderWeekWizardSheetBody(); if (state.currentTab === 'commissioner') navigateTo('commissioner'); },", suite: OF, red: ['H-43:'] },
  { id: 'W71-41', what: 'no row ever offers Find spread', file: APP, find: '    findSpread: (g) => canFindSpread && SF.isSpreadMissing(g),', replace: '    findSpread: () => false,', suite: OF, red: ['H-36:'] },
  { id: 'W71-42', what: 'a week that cannot take a spread (demo, locked) still offers the row button', file: APP, find: 'const canFindSpread = !!model.week && spreadFindUI().canRun(model.week);', replace: 'const canFindSpread = !!model.week;', suite: OF, red: ['H-47:'] },
  { id: 'W71-43', what: 'the summary entry never goes away once every spread is set', file: APP, find: "  if (!html) { if (slot.innerHTML !== '') slot.innerHTML = ''; return; }", replace: '  if (!html) return;', suite: OF, red: ['H-46:'] },
  { id: 'W71-44', what: 'Step 3\'s rows drop the source label (N-4)', file: APP, find: ' <em class="games-row-src">${escHtml(SF.spreadSourceLabel(g))}</em>`', replace: '`', suite: OF, red: ['H-48:'] },
  { id: 'W71-45', what: 'the Games row prints an unknown source raw again (I-3)', file: 'js/games-list.js', find: '<em class="games-row-src">${escHtml(spreadSourceLabel(g))}</em>', replace: '<em class="games-row-src">${escHtml(String(g.spreadSource || "Manual"))}</em>', suite: OF, red: ['H-49:', 'H-31:'] },
  { id: 'W71-46', what: 'the swap picker\'s incoming caption prints the source through a private rule again (I-3)', file: APP, find: '`${fmtSpread(sv, d.favorite, d)} (${SF.spreadSourceLabel(d)})`', replace: '`${fmtSpread(sv, d.favorite, d)} (${d.spreadSource === "espn" ? "ESPN" : "Manual"})`', suite: OF, red: ['H-31:'] },
  { id: 'W71-47', what: '"find-spread" comes last in the row\'s actions instead of first', file: 'js/games-list.js', find: "  return findSpread ? ['find-spread', ...names] : names;", replace: "  return findSpread ? [...names, 'find-spread'] : names;", suite: OF, red: ['H-34b:', 'H-37:'] },
  { id: 'W71-48', what: 'the tapped row\'s change signature moves while the lookup runs (the busy state is in the row\'s markup, so the reconciler would flip it)', file: APP, find: "if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = SF.SPREAD_COPY.CHECKING_ESPN; }", replace: "if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = SF.SPREAD_COPY.CHECKING_ESPN; btn.closest('.games-row')?.setAttribute('data-sig', 'busy'); }", suite: OF, red: ['H-40:'] },
  { id: 'W71-49', what: 'a tapped row button never returns from its busy state', file: APP, find: "    if (btn && btn.isConnected !== false) { btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = was; }", replace: '', suite: OF, red: ['H-41:'] },
  // -- W-71: the function --
  { id: 'W71-20', what: 'a MEMBER passes the gate', file: IDX, find: "import { requireCommissioner, AuthRefusedError } from '../_shared/auth.js';", replace: "import { requireMember as requireCommissioner, AuthRefusedError } from '../_shared/auth.js';", suite: TW, red: ['1-3:', '1-4:'] },
  { id: 'W71-21', what: 'the vendor host is steerable', file: VEN, find: "export const VENDOR_HOST = 'api.the-odds-api.com';", replace: "export const VENDOR_HOST = 'evil.test';", suite: TW, red: ['3-1:'] },
  { id: 'W71-22', what: 'the sport key can come from the body', file: IDX, find: "const sportKey = Object.hasOwn(SPORT_KEYS, weekSport) ? SPORT_KEYS[weekSport] : undefined;", replace: "const sportKey = SPORT_KEYS[String(body.sport || weekRow.sport || '')] || (typeof body.sport_key === 'string' ? body.sport_key : undefined);", suite: TW, red: ['3-1:'] },
  { id: 'W71-23', what: 'the credits floor is not honoured', file: VEN, find: "  if (lastCredits !== null && lastCredits < CREDITS_FLOOR) return { ok: false, reason: 'paused' };\n", replace: '', suite: TW, red: ['7-2:'] },
  { id: 'W71-24', what: 'the isolate memo is ignored (a double tap spends two credits)', file: VEN, find: 'if (hit && now - hit.at < MEMO_MS)', replace: 'if (false)', suite: TW, red: ['7-3:'] },
  { id: 'W71-25', what: 'a team matches by prefix ("Ohio" is "Ohio State")', file: MAT, find: "return v === s || (!!m && v === `${s} ${m}`);", replace: "return v === s || v.startsWith(`${s} `);", suite: TW, red: ['3-8:', '5-5:', '5-6:'] },
  { id: 'W71-26', what: 'the kickoff window is open at exactly 3 hours', file: MAT, find: 'Math.abs(t - k) > MATCH_WINDOW_MS', replace: 'Math.abs(t - k) >= MATCH_WINDOW_MS', suite: TW, red: ['8-13:'] },
  { id: 'W71-27', what: 'a line whose points are not exact opposites is accepted', file: MAT, find: '  if (a.point !== -b.point) return null;                         // same sign, or not exact opposites: rejected, never "repaired"\n', replace: '', suite: TW, red: ['8-21:', '8-22:', '8-30:'] },
  { id: 'W71-28', what: 'the function writes to the games table', file: IDX, find: '  const first = await fetchEvents({ sportKey, apiKey, reserve });', replace: "  await sb.from('games').update({ spread_source: 'x' }).eq('league_id', leagueId);\n  const first = await fetchEvents({ sportKey, apiKey, reserve });", suite: TW, red: ['4-3:'] },
  { id: 'W71-29', what: 'the catch hands the thrown message back to the caller (the key rides in the URL)', file: VEN, find: "return { ok: false, reason: err && err.name === 'AbortError' ? 'timeout' : 'vendor_error' };", replace: "return { ok: false, reason: err && err.name === 'AbortError' ? 'timeout' : 'vendor_error', detail: String(err && err.message) };", suite: FC, red: ['W-71 C2'] },
  { id: 'W71-30', what: 'a client file names the vendor (the key\'s home is the function only)', file: 'js/odds-lookup-client.js', find: "const REASONS = ['not_configured',", replace: "const VENDOR_NOTE = 'the-odds-api';\nconst REASONS = ['not_configured',", suite: FC, red: ['W-71 C1'] },
  { id: 'W71-31', what: 'the secret falls back to a literal', file: IDX, find: "const apiKey = typeof rawKey === 'string' ? rawKey.trim() : '';", replace: "const apiKey = (typeof rawKey === 'string' ? rawKey.trim() : '') || 'dev-key';", suite: TW, red: ['2-1:', '2-2:'] },
];

/** A mutant is one `find`/`replace`, or an `edits: [{ find, replace }, ...]` list when one weakening needs two places in the same file (each anchor must match exactly once). */
const editsOf = (m) => m.edits || [{ find: m.find, replace: m.replace }];

const args = process.argv.slice(2);
const discover = args.includes('--discover');
const anchorsOnly = args.includes('--anchors');
const nodeOnly = args.includes('--node');
const ids = args.filter((a) => !a.startsWith('--'));
const run = MUTANTS.filter((m) => (!ids.length || ids.includes(m.id)) && (!nodeOnly || m.suite !== CB));
if (anchorsOnly) {                                                                  // does every `find` still match exactly once in the checkout? (no copy, no suite run)
  let bad = 0;
  for (const m of run) for (const e of editsOf(m)) { const n = readFileSync(join(CFB, m.file), 'utf8').split(e.find).length - 1; if (n !== 1) { bad++; console.log(`  \u26A0\uFE0F  ${m.id} anchor matches ${n}x in ${m.file}`); } }
  console.log(bad ? `\n\u274C ${bad} stale anchor(s) of ${run.length}` : `\n\u2705 all ${run.length} anchors match exactly once`);
  process.exit(bad ? 1 : 0);
}
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-w70w71kit-'));
const COPY = join(tmp, 'cfb-pickems');
console.log(`\nw70-w71 kit - ${run.length} mutant(s); copying ${CFB} -> ${COPY} (node_modules and .git left out)\n`);
cpSync(CFB, COPY, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });
if (existsSync(join(CFB, '..', 'docs'))) cpSync(join(CFB, '..', 'docs'), join(tmp, 'docs'), { recursive: true });   // functions.check reads ../docs/SUPABASE_LIVE_RUNBOOK.md: without it the suite dies for the wrong reason

let caught = 0, survived = 0, broken = 0;
for (const m of run) {
  const real = join(CFB, m.file), copy = join(COPY, m.file);
  const original = readFileSync(real, 'utf8');
  const stale = editsOf(m).map((e) => original.split(e.find).length - 1).find((n) => n !== 1);
  if (stale !== undefined) { broken++; console.log(`  \u26A0\uFE0F  ${m.id} ANCHOR matches ${stale} times in ${m.file} - the kit is stale for this mutant`); continue; }
  writeFileSync(copy, editsOf(m).reduce((text, e) => text.split(e.find).join(e.replace), original));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [m.suite], { cwd: COPY, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900000 });
  writeFileSync(copy, original);                                                   // the COPY's file goes back to the checkout's text
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const redLines = out.split('\n').filter((l) => l.includes('❌'));
  if (discover) { console.log(`\n${m.id} (${m.suite}) exit ${r.status}: ${m.what}`); redLines.slice(0, 12).forEach((l) => console.log('   ' + l.trim().slice(0, 140)));
    if (!redLines.length) out.split('\n').filter((l) => l.trim()).slice(-8).forEach((l) => console.log('   | ' + l.trim().slice(0, 160)));
    continue; }
  if (r.status === null) { broken++; console.log(`  \u26A0\uFE0F  ${m.id} TIMED OUT after ${Math.round((Date.now() - t0) / 1000)}s (killed: exit null) - NOT counted as caught; re-run it alone`); continue; }
  const missing = m.red.filter((label) => !redLines.some((l) => l.includes(label)));
  const ok = r.status !== 0 && missing.length === 0;
  if (ok) caught++; else survived++;
  console.log(`  ${ok ? '✅ CAUGHT  ' : '❌ SURVIVED'} ${m.id} (${m.suite.replace(/^.*\//, '')}, ${Math.round((Date.now() - t0) / 1000)}s) - ${m.what}`);
  console.log(`        RED on: ${m.red.filter((l) => !missing.includes(l)).join(' | ') || '(none)'}${missing.length ? `   NOT red: ${missing.join(' | ')}` : ''}   [exit ${r.status}, ${redLines.length} red line(s)]`);
}
try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
if (discover) process.exit(0);
console.log(`\n${survived === 0 && broken === 0 ? '✅ ALL CAUGHT' : '❌ NOT ALL CAUGHT'} - ${caught} caught, ${survived} survived, ${broken} stale anchor(s)`);
process.exit(survived === 0 && broken === 0 ? 0 : 1);
