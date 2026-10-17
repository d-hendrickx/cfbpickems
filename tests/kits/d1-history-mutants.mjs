/**
 * CFB Pickems — tests/kits/d1-history-mutants.mjs (D1 / v0.30.0, thread 100726-D1, Lane B history; the S-3 mutation kit of DI-594 / 595 / 596 / 598, feature-builder, 2026-10-08)
 * ===========================================================================================================================================================================
 * THE ITEM'S KIT (S-3, D-69): every mutant used to prove the history tests are not vacuous, encoded so the reviewer re-runs them and adds only gap mutants. Each mutant is applied to a COPY of this
 * cfb-pickems tree (never the checkout: no git restore, no stash, no in-place edit), the named suite is run IN THE COPY, and the mutant is CAUGHT only if every named check prints ❌. The mutated
 * file(s) go back to the checkout's own text before the next mutant. `edits` may name several files (a rule enforced in two layers needs both layers broken to be seen from outside).
 *
 * ROUND 2 (2026-10-14): M39-M55 prove the BLOCK fixes (C-1, G14/G15/G11, N3, B1, B3, the footnote). M39/M40/M41/M42 are the real-adapter proofs of historywiringtest [10] and [4]; M43 the entrants-only picker.
 * PASS 3 (2026-10-14, feature-builder-opus after the second BLOCK): M72-M91 prove R1 (M72-M74, M76), R2 / D1 (M77-M82), N1 (M83-M86), N2 (M87; M39 / M41 re-anchored), N4 (M88, M89), N7 (M90, M91), the empty-column polish (M92) and the unavailable state's true reason (M93-M95).
 *
 * In-suite kit that runs with its suite (no copy needed): historywiringtest [9] — seven mutants of js/app.js loaded as data: URLs (a forged name id, an Open week forged into an opener, a demo
 * week opened, a tab change that leaves the stack, a same-tab repaint that closes it, a forged game and a forged rival id).
 *
 * BLIND-RULE MUTANTS (Fix-verification rule; the suite must go red against a visibility bypass): M01 (the head-to-head reveal gate always open), M02 (the S-C10 "rows have landed" flag ignored),
 * M12 (headToHeadRecord's own reveal check always open), M13 (a truthy-but-not-true answer opens a week), M07 (the week detail shows an unrevealed part), M08 (the league split shown before the
 * rows land), M09 / M10 (a live game called covered / ✓ ✗), M15 (the pooled-group read without its all-final gate), M16 (an Open week gets an opener).
 *
 * Run:  node tests/kits/d1-history-mutants.mjs                 every mutant (about 7 minutes: seven of them drive Chromium)
 *       node tests/kits/d1-history-mutants.mjs M01 M07         just those
 * Exit 0 only when every mutant is CAUGHT.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// { id, what, edits: [{ file, find, replace }], suite, env?, red: [substrings of the check labels that must print ❌] }  —  every `find` must match EXACTLY once.
const MUTANTS = [
  // ── the head-to-head reveal (DI-595, Std-8) ──
  { id: 'M01', what: 'the comparison hands headToHeadRecord a gate that is always open (Open and Locked weeks are compared)', suite: 'comparetest.mjs',
    edits: [{ file: 'js/compare.js', find: 'const gate = (w) => pack.isPublic(w) === true && pack.picksRead(w.weekId) === true;', replace: 'const gate = (w) => true;' }],
    red: ['5a (open)', '5a (locked)', '5b (open)', '5g', '5h'] },
  { id: 'M02', what: 'the S-C10 "their rows have landed" flag is ignored', suite: 'comparetest.mjs',
    edits: [{ file: 'js/compare.js', find: ' && pack.picksRead(w.weekId) === true;', replace: ';' }],
    red: ['5g', '5h'] },
  { id: 'M12', what: "headToHeadRecord's own reveal check is always open", suite: 'comparetest.mjs',
    edits: [{ file: 'js/stats.js', find: 'try { open = isPublic(w) === true; } catch { open = false; }', replace: 'open = true;' }],
    red: ['1h', '1i', '2a', '3c'] },
  { id: 'M13', what: 'a truthy-but-not-true answer opens a week', suite: 'comparetest.mjs',
    edits: [{ file: 'js/stats.js', find: 'try { open = isPublic(w) === true; } catch { open = false; }', replace: 'try { open = !!isPublic(w); } catch { open = false; }' }],
    red: ['3d'] },
  // ── the denominators (DI-594) ──
  { id: 'M03', what: 'a week the pair was not both entered in is compared anyway', suite: 'comparetest.mjs',
    edits: [{ file: 'js/compare.js', find: 'const bothIn = weeks.filter(w => entered(w, viewerId) && entered(w, rivalId));', replace: 'const bothIn = weeks;' }],
    red: ['6a', '6d'] },
  { id: 'M04', what: 'the Season card shows the RAW pair as Picks (the weighted pair drives rank)', suite: 'comparetest.mjs',
    edits: [{ file: 'js/compare.js', find: "const picks = (r) => (r ? `${nz(r.totalCorrect)}–${nz(r.totalIncorrect)}` : '—');", replace: "const picks = (r) => (r ? `${nz(r.totalCorrectCount)}–${nz(r.totalIncorrectCount)}` : '—');" }],
    red: ['4w'] },
  { id: 'M05', what: 'the Season card shows the WEIGHTED ratio as Win % (Win % counts every pick once)', suite: 'comparetest.mjs',
    edits: [{ file: 'js/compare.js', find: "const pct = (r) => (r ? `${nz(r.winPct)}%` : '—');", replace: "const pct = (r) => (r ? `${Math.round(1000 * nz(r.totalCorrect) / Math.max(1, nz(r.totalCorrect) + nz(r.totalIncorrect))) / 10}%` : '—');" }],
    red: ['4w'] },
  // ── the escaper (Std-9) ──
  { id: 'M06', what: "a rival's name is written raw under the split bar", suite: 'comparetest.mjs',
    edits: [{ file: 'js/compare.js', find: '<span>${esc(rivalName)}</span></div>', replace: '<span>${rivalName}</span></div>' }],
    red: ['7r', '7s'] },
  { id: 'M06x', what: "…and the xss sweep (a swept file at zero) sees it as an unclassified interpolation", suite: 'xsstest.mjs',
    edits: [{ file: 'js/compare.js', find: '<span>${esc(rivalName)}</span></div>', replace: '<span>${rivalName}</span></div>' }],
    red: ['[9c-1c-b] js/compare.js: NO NEW unclassified interpolation'] },
  { id: 'M11', what: "a matchup is written raw on a week-detail game row", suite: 'comparetest.mjs',
    edits: [{ file: 'js/week-detail.js', find: '<span class="hx-title">${esc(g.matchup)}</span>', replace: '<span class="hx-title">${g.matchup}</span>' }],
    red: ['10l'] },
  // ── the week detail (DI-596) ──
  { id: 'M07', what: 'a week-detail part that is not public contributes its games anyway', suite: 'comparetest.mjs',
    edits: [{ file: 'js/week-detail.js', find: 'const shown = members.filter(open);', replace: 'const shown = members;' }],
    red: ['9l (open)', '9l (locked)', '9l (draft)', '9t'] },
  { id: 'M08', what: "the league's split on a game is shown before the other members' rows have landed", suite: 'comparetest.mjs',
    edits: [{ file: 'js/week-detail.js', find: '      if (picksRead && (viewerId === null || mineOn)) {', replace: '      if (true) {' }],
    red: ['9k'] },
  { id: 'M09', what: 'a LIVE game is given a "covered by" line', suite: 'comparetest.mjs',
    edits: [{ file: 'js/week-detail.js', find: "      if (st.phase === 'final') {\n        let who = null;\n        try { who = g.atsWinner ?? calculateAtsWinner(g); } catch { who = null; }", replace: "      {\n        let who = null;\n        try { who = g.atsWinner ?? calculateAtsWinner({ ...g, status: 'final' }); } catch { who = null; }" }],
    red: ['9n'] },
  { id: 'M10', what: "a live pick gets the settled ✓ / ✗ marks", suite: 'comparetest.mjs',
    edits: [{ file: 'js/week-detail.js', find: "  if (phase === 'final') {\n    const r = evaluatePick(pick, game);", replace: "  if (phase === 'final' || isLivePhase(phase)) {\n    const r = evaluatePick(pick, game);" }],
    red: ['9n'] },
  // ── the app wiring (the structural guard, the entries, the scoping) ──
  { id: 'M15', what: "the pooled-group read loses its all-final gate (the blind rule's structural guard)", suite: 'loadtest.mjs', env: { CFBP_CORE: 'full' },
    edits: [{ file: 'js/app.js', find: "  if (!memberWeeks.every(m=>m.status==='final')) return [];", replace: '' }],
    red: ["pooledGroupResults's exemption still holds"] },
  { id: 'M16', what: 'an Open or Locked week gets a Weekly History opener', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/app.js', find: 'const openMember=members.find(m=>arePicksPublic(m));', replace: 'const openMember=members[0];' }],
    red: ['1k'] },
  { id: 'M16b', what: '…and the layout suite sees the Open week\'s cell change', suite: 'layouttest.mjs',
    edits: [{ file: 'js/app.js', find: 'const openMember=members.find(m=>arePicksPublic(m));', replace: 'const openMember=members[0];' }],
    red: ['SF6a'] },
  { id: 'M17', what: 'a signed-out visitor gets the comparison buttons', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/app.js', find: "  if (!viewerId) return `<div class=\"stand-name-wrap\">", replace: "  if (false) return `<div class=\"stand-name-wrap\">" }],
    red: ['1h'] },
  { id: 'M18', what: 'the rival picker leaves the gesture-suspension list (nav-gestures)', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/nav-gestures.js', find: "  if (document.getElementById?.('rival-picker-sheet-wrap')) return true;", replace: '' }],
    red: ['8b'] },
  { id: 'M19', what: 'the rival picker leaves the dismiss-blocking list (a swipe or Esc beneath it arms)', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/app.js', find: "  if (!_rivalOwnSwipe && document.getElementById('rival-picker-sheet-wrap')) return true;", replace: '' }],
    red: ['2j', '8b'] },
  { id: 'M20', what: 'the comparison reads the league\'s active players instead of the competition\'s', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/app.js', find: '    players: roster, weeks, allWeeks: weeks,', replace: '    players: getPlayers().filter((p) => p && p.active), weeks, allWeeks: weeks,' }],
    red: ['6b-h', '8c'] },
  { id: 'M21', what: "the week detail counts a non-entrant's stray pick row in the league split", suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/app.js', find: '    picks: members.flatMap((m) => picksOfRoster(getPicks(m.weekId), playersForWeek(m))),', replace: '    picks: members.flatMap((m) => getPicks(m.weekId)),' }],
    red: ['6b-k'] },
  { id: 'M22', what: "a week from another sport is detailed from the context sport's history", suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/app.js', find: '  const inputs = weeklyHistoryInputs(cid);', replace: '  const inputs = weeklyHistoryInputs();' }],
    red: ['6b-j', '8f'] },
  { id: 'M23', what: "the card detail offers Compare with yourself (both layers broken)", suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/card-detail.js', find: "!isId(memberId) || memberId === s.viewerId || !isId(name)", replace: "!isId(memberId) || !isId(name)" },
      { file: 'js/app.js', find: "if (!me || !week || !memberId || memberId === me) return false;", replace: "if (!me || !week || !memberId) return false;" }],
    red: ['5j'] },
  { id: 'M27', what: 'the picker\'s slide-out removes "whatever has the id now" (a Change tapped during the slide loses its new sheet - P-3)', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/app.js', find: "    if (wrap) { try { wrap.remove(); } catch { /* already gone */ } } else document.getElementById(RIVAL_WRAP_ID)?.remove();", replace: "    document.getElementById(RIVAL_WRAP_ID)?.remove();" }],
    red: ['3d-p3c'] },
  // ── DI-598: the thread ──
  { id: 'M24', what: 'a past game with no pill gets no label and no way back', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/chat-ui.js', find: 'const offPill = !activeGameTags().includes(U.filter);', replace: 'const offPill = false;' }],
    red: ['6k', '6l'] },
  { id: 'M25', what: 'a withdrawn message is counted in "Thread · n"', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/app.js', find: ".filter((m) => m && !m.deleted && !isPrivateRow(m)).length; } catch { return null; }", replace: ".filter((m) => m).length; } catch { return null; }" }],
    red: ['6a'] },
  { id: 'M26', what: 'a finished game that kicked off before the retention cutoff says "No one talked" (the GAME-TIME rule, review B1, is gone)', suite: 'historywiringtest.mjs',
    edits: [{ file: 'js/chat-ui.js', find: "if (final && cutoff && Number.isFinite(ko) && ko < cutoff) return", replace: "if (false) return" }],
    red: ['6r', '6s', '6c-p'] },
  // ── the real-browser proof (P-8): the styles that turn red when the surface is broken ──
  { id: 'M30', what: 'the Standings name button is no longer a 44 pt target', suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: 'box-sizing:border-box;min-height:47px;', replace: 'box-sizing:border-box;min-height:30px;' }],
    red: ['1-390-a', '1-390-f'] },
  { id: 'M31', what: 'the week opener makes its row taller', suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: '.stand-wk-btn{position:relative;display:block;width:calc(100% + 8px);margin:-4px 0 -4px -8px;', replace: '.stand-wk-btn{position:relative;display:block;width:calc(100% + 8px);margin:0;' }],
    red: ['1-390-c'] },
  { id: 'M32', what: 'the Standings buttons lose the 97% press', suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: '.stand-cmp:active,.stand-wk-btn:active{transform:scale(.97)}', replace: '.stand-cmp:active,.stand-wk-btn:active{transform:none}' }],
    red: ['1-5', '1-6'] },
  { id: 'M33', what: 'the Standings buttons keep their transition under Reduce Motion', suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: '@media (prefers-reduced-motion:reduce){.stand-cmp,.stand-wk-btn{transition:none}.stand-cmp:active,.stand-wk-btn:active{transform:none}}', replace: '' }],
    red: ['1-11', '1-12'] },
  { id: 'M34', what: 'the Thread button shrinks below 44 pt', suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: '.hx-thread{flex:0 0 auto;align-self:center;min-width:44px;min-height:44px;', replace: '.hx-thread{flex:0 0 auto;align-self:center;min-width:44px;min-height:28px;' }],
    red: ['2-18'] },
  { id: 'M35', what: 'the rival picker rows shrink below 56 pt', suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: 'width:100%;min-height:56px;padding:12px 16px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);', replace: 'width:100%;min-height:30px;padding:2px 16px;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);' }],
    red: ['3-3'] },
  { id: 'M36', what: 'the split bar colours leave the token palette', suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: '.cmp-bar-a{background:var(--maroon-text)}', replace: '.cmp-bar-a{background:#123456}' }],
    red: ['2-15'] },
  { id: 'M37', what: "the Season rows can no longer wrap (the DI's reflow at large text)", suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: '.cmp-gridrow{display:flex;flex-wrap:wrap;', replace: '.cmp-gridrow{display:flex;flex-wrap:nowrap;' }],
    red: ['2-16', '2-23'] },
  { id: 'M38', what: "a game row can no longer drop its Thread button under the game at large text (the game is squeezed to a sliver)", suite: 'historybrowsertest.mjs',
    edits: [{ file: 'css/styles.css', find: '.hx-item{display:flex;flex-wrap:wrap;', replace: '.hx-item{display:flex;flex-wrap:nowrap;' }],
    red: ['2-23b'] },
  // ── ROUND 2 (reviewer BLOCK + security C-1, 2026-10-14): the fixes' own mutants. M39-M43 are the reviewer's gap mutants G14 / G15 / G11 made permanent. ──
  { id: "M39", what: "C-1 as it shipped in c669e459: the group is READABLE if a part is merely not public AND a non-public part counts as final (both layers reverted) - a part the SERVER holds Open is folded into the standings and a winner is named", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "const readable = members.every((m) => arePicksPublic(m) && historyPicksRead(m.weekId));", replace: "const readable = members.every((m) => !arePicksPublic(m) || historyPicksRead(m.weekId));" },
      { file: "js/app.js", find: "finalParts: members.filter((m) => confirmedWeekStatus(m) === 'final' && arePicksPublic(m)).length", replace: "finalParts: members.filter((m) => m.status === WEEK_STATUS.FINAL).length" }],
    red: ["10b", "10c", "8l"] },
  { id: "M39b", what: "C-1, the flagged line alone reverted: held behind the finalParts layer (the table is only drawn for an all-final group), so the BEHAVIOUR is unchanged and only the source pin 8l sees it - recorded so the two layers are not mistaken for one", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "const readable = members.every((m) => arePicksPublic(m) && historyPicksRead(m.weekId));", replace: "const readable = members.every((m) => !arePicksPublic(m) || historyPicksRead(m.weekId));" }],
    red: ["8l"] },
  { id: "M40", what: "G14 as the reviewer ran it: `readable = true` (the S-C10 rows-have-landed flag is ignored for a group)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "const readable = members.every((m) => arePicksPublic(m) && historyPicksRead(m.weekId));", replace: "const readable = true;" }],
    red: ["10e", "8l"] },
  { id: "M41", what: "a part the server has not made public is COUNTED as final (the group shows a winner and the \"standings wait\" sentence) - pass 3: the line's two layers (N2's server-confirmed status and C-1's reveal) are both reverted, since N2 alone now covers the open-on-the-server part", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "finalParts: members.filter((m) => confirmedWeekStatus(m) === 'final' && arePicksPublic(m)).length", replace: "finalParts: members.filter((m) => m.status === WEEK_STATUS.FINAL).length" }],
    red: ["10b", "10c", "8l"] },
  { id: "M42", what: "G15: the week detail's reveal gate is always open (an Open or Locked second part of a pooled group is drawn)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "viewerId, isPublic: (w) => arePicksPublic(w), picksRead: historyPicksRead,", replace: "viewerId, isPublic: (w) => true, picksRead: historyPicksRead," }],
    red: ["4w-open", "4w-locked", "10c"] },
  { id: "M43", what: "G11: the rival picker lists the league's ACTIVE players, not the sport's entrants", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "function rivalPickerChoices(rp) { return rivalChoices({ players: playersForCompetition(rp.competitionId),", replace: "function rivalPickerChoices(rp) { return rivalChoices({ players: getPlayers().filter((p) => p && p.active)," }],
    red: ["6b-a2", "6b-f2"] },
  { id: "M44", what: "N3: a signed-in member who is not a Standings row still gets the name buttons and the hint", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "const cmpViewer=(()=>{ const me=viewerMemberId(); return me&&standings.some(r=>r.playerId===me)?me:null; })();", replace: "const cmpViewer=viewerMemberId();" }],
    red: ["1m", "6b-m", "8n"] },
  { id: "M45", what: "B1: every game counts as fully loaded (the row shows a count for a thread the device does not hold)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "return (gameId) => { const ko = Date.parse((getGame(gameId) || {}).kickoff); return !Number.isFinite(ko) || ko >= from; };", replace: "return () => true;" }],
    red: ["6c-b", "6c-e", "6c-i"] },
  { id: "M46", what: "B1: the thread sheet claims \"No one talked\" for a game older than the loaded log", suite: "historywiringtest.mjs",
    edits: [{ file: "js/chat-ui.js", find: "if (Number.isFinite(ko) && ko < from) return \"Older messages aren't loaded on this device.\";", replace: "" }],
    red: ["6c-c", "6c-o"] },
  { id: "M47", what: "B1: the loaded-back point ignores seq 1 (a device holding the WHOLE log still says \"not loaded\")", suite: "historywiringtest.mjs",
    edits: [{ file: "js/chat.js", find: "  if (S.backfillLow <= 1) return -Infinity;\n  let oldest = Infinity;", replace: "  let oldest = Infinity;" }],
    red: ["6c-j", "6c-k"] },
  { id: "M48", what: "B1: a store that holds nothing and has not caught up claims to be complete", suite: "historywiringtest.mjs",
    edits: [{ file: "js/chat.js", find: "if (S.backfillLow === null) return S.caughtUp === true && S.head === 0 ? -Infinity : Infinity;", replace: "if (S.backfillLow === null) return -Infinity;" }],
    red: ["6c-m"] },
  { id: "M49", what: "B1: with no server log the device still claims older messages are missing (the local-mode guard is gone)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/chat.js", find: "  if (!isBackendConfigured()) return -Infinity;\n  if (S.backfillLow === null) return S.caughtUp", replace: "  if (S.backfillLow === null) return S.caughtUp" }],
    red: ["6a", "4f"] },
  { id: "M50", what: "B3: the week detail drops the raw-versus-weighted sentence", suite: "comparetest.mjs",
    edits: [{ file: "js/week-detail.js", find: "footnote: state === 'final' && typeof pack.standingsHtml === 'string' && pack.standingsHtml ? WEEK_DETAIL_COPY.footnote : '',", replace: "footnote: ''," }],
    red: ["9g2"] },
  { id: "M51", what: "B3: the sentence is drawn OUTSIDE the standings card (browser)", suite: "historybrowsertest.mjs",
    edits: [{ file: "js/week-detail.js", find: "    '</tbody></table>',\n    m.footnote ? `<p class=\"cd-fresh wd-foot\">${esc(m.footnote)}</p>` : '',\n    '</section>',", replace: "    '</tbody></table>',\n    '</section>',\n    m.footnote ? `<p class=\"cd-fresh wd-foot\">${esc(m.footnote)}</p>` : ''," }],
    red: ["4-2b"] },
  { id: "M52", what: "B3 / footnote decision: the comparison's sentence is not Standings' own words", suite: "comparetest.mjs",
    edits: [{ file: "js/compare.js", find: "footnote: 'Picks count each game\u2019s multiplier. Win % counts every pick once.',", replace: "footnote: 'Rank counts each game by its multiplier. Win % counts every pick once.'," }],
    red: ["4j", "7f"] },
  { id: "M53", what: "B1: the comparison's split row has no bare-Thread branch (it prints a number it cannot know)", suite: "comparetest.mjs",
    edits: [{ file: "js/compare.js", find: "const thread = s.threadBare ? `<button type=\"button\" class=\"hx-thread\" data-cmp-action=\"open-thread\" data-cmp-game=\"${esc(s.gameId)}\" aria-label=\"${esc(`Thread, ${s.matchup}`)}\">Thread</button>`\n      : s.threads === null", replace: "const thread = s.threads === null" }],
    red: ["7j2"] },
  { id: "M54", what: "B1: the week detail's game row has no bare-Thread branch", suite: "comparetest.mjs",
    edits: [{ file: "js/week-detail.js", find: "const thread = g.threadBare ? `<button type=\"button\" class=\"hx-thread\" data-wd-action=\"open-thread\" data-wd-game=\"${esc(g.gameId)}\" aria-label=\"${esc(`Thread, ${g.matchup}`)}\">Thread</button>`\n      : g.threads === null", replace: "const thread = g.threads === null" }],
    red: ["9f3"] },
  { id: "M55", what: "B1: a bare Thread loses its 44 pt target (browser)", suite: "historybrowsertest.mjs",
    edits: [{ file: "css/styles.css", find: ".hx-thread{flex:0 0 auto;align-self:center;min-width:44px;min-height:44px;", replace: ".hx-thread{flex:0 0 auto;align-self:center;min-width:44px;min-height:28px;" }],
    red: ["4-3b"] },
  // ── PART B (the merge with Game Day, 2026-10-14): Share to chat, the reader's resolver, the Back chip's restore, Results, the card detail's count ──
  { id: "M56", what: "a shared week resolves for a reader even when the week is NOT revealed (the history lane's own gate is dropped from the resolver)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "if (r.type === 'week') return t.weekIds.has(r.id) && historyWeekReachable(getWeek(r.id));", replace: "if (r.type === 'week') return t.weekIds.has(r.id);" }],
    red: ["11m"] },
  { id: "M57", what: "a shared comparison resolves for ANY well-formed id (no member / sport check)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "        allowed = !!getPlayer(p.aId) && !!getPlayer(p.bId) && ids.includes(p.aId) && ids.includes(p.bId);", replace: "        allowed = true;" }],
    red: ["11m", "6b-u"] },
  { id: "M58", what: "the reader who IS one side of a shared comparison gets the neutral screen (the \"you\" side is lost: both the resolver's own branch and the screen's guard are gone - either alone is covered by the other)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "  if (me === p.aId) return openComparison({ ...base, rivalId: p.bId });\n", replace: "" },
      { file: "js/app.js", find: "const neutral = typeof firstId === 'string' && !!firstId && firstId !== readerId && firstId !== rivalId;", replace: "const neutral = typeof firstId === 'string' && !!firstId && firstId !== rivalId;" }],
    red: ["11p"] },
  { id: "M59", what: "a third member opening a shared comparison gets \"You vs {name}\" (the neutral wording is dropped)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "const neutral = typeof firstId === 'string' && !!firstId && firstId !== readerId && firstId !== rivalId;", replace: "const neutral = false;" }],
    red: ["11q", "11r"] },
  { id: "M60", what: "the Back chip does not restore the history screens", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "    else if (m.kind === 'week' && typeof m.ref === 'string') openWeekDetail(m.ref, { backLabel: lv.backLabel, restore });\n", replace: "" }],
    red: ["11v"] },
  { id: "M61", what: "\"See week results\" on a Final game no longer opens the week detail", suite: "d1wiringtest.mjs",
    edits: [{ file: "js/app.js", find: "    if (typeof gameWeekId === 'string' && gameWeekId && openWeekDetail(gameWeekId, { backLabel: r.matchup })) return;", replace: "" }],
    red: ["9n"] },
  { id: "M62", what: "Game Day's Final card \"Results\" no longer opens the week detail", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "if (tab === 'leaderboard' && typeof params.weekId === 'string' && params.weekId && !isContentWithheld() && openWeekDetail(params.weekId, { backLabel: 'Home' })) return;", replace: "" }],
    red: ["11z"] },
  { id: "M63", what: "a history row opens the game THREAD again instead of the Game view", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "function openHistoricalGame(gameId, backLabel) { openGameView(gameId, { from: 'card', backLabel: backLabel || 'Details' }); }", replace: "function openHistoricalGame(gameId) { openHistoryThread(gameId); }" }],
    red: ["3p", "4h"] },
  { id: "M64", what: "N4: the card detail counts a withdrawn message (the old count)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "threadCount: (gameId) => (historyThreadLoadedFor()(gameId) ? historyThreadCount(gameId) : null),", replace: "threadCount: (gameId) => getMessages({ tag: gameId, respectRetention: true, types: ['message'] }).length," }],
    red: ["11aa", "11ab"] },
  { id: "M65", what: "Share is offered to everyone (chat off, signed out)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "    canShare: shareOffered(),                                   // DI-597: Share to chat is offered to a signed-in, verified member while chat is on", replace: "    canShare: true," }],
    red: ["11f"] },
  { id: "M65b", what: "Share is offered to everyone on the WEEK DETAIL (chat off, signed out)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "    canShare: shareOffered(),                                   // DI-597\n", replace: "    canShare: true,\n" }],
    red: ["11f"] },
  { id: "M70", what: "Game Day's T8 re-anchored on the MERGED threadEmptyCopy (every empty thread says \"No messages about this game yet.\"): d1wiringtest 10l goes red", suite: "d1wiringtest.mjs",
    edits: [{ file: "js/chat-ui.js", find: "  return final ? 'No one talked about this game.' : 'No messages about this game yet.';", replace: "  return 'No messages about this game yet.';" }],
    red: ["10l"] },
  { id: "M71", what: "the loaded-log rule is gone from the MERGED threadEmptyCopy (a game older than the loaded log reads \"No one talked\")", suite: "historywiringtest.mjs",
    edits: [{ file: "js/chat-ui.js", find: "  if (Number.isFinite(ko) && ko < from) return \"Older messages aren't loaded on this device.\";\n", replace: "" }],
    red: ["6c-c", "6c-o"] },
  { id: "M66", what: "a shared comparison in a several-sport league forgets its sport", suite: "historywiringtest.mjs",
    edits: [{ file: "js/compare.js", find: "competitionId: sport ? (pack.competitionId ?? null) : null });", replace: "competitionId: null });" }],
    red: ["6b-s", "6b-t"] },
  { id: "M67", what: "a third member's comparison keeps a Change button", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "right: neutral ? '' : '<button type=\"button\" class=\"ps-action\" data-cmp-action=\"change\">Change</button>' }", replace: "right: '<button type=\"button\" class=\"ps-action\" data-cmp-action=\"change\">Change</button>' }" }],
    red: ["11r"] },
  { id: "M68", what: "the Share button's label can no longer wrap (it overflows the gutters at the largest text size)", suite: "historybrowsertest.mjs",
    edits: [{ file: "css/styles.css", find: ".cmp .cd-action,.wd .cd-action{white-space:normal;min-width:0;text-align:center}", replace: "" }],
    red: ["2-23"] },
  { id: "M69", what: "a forged compare id carries markup through to the page (the id is not parsed to plain tokens)", suite: "comparetest.mjs",
    edits: [{ file: "js/compare.js", find: "if ((t.length !== 2 && t.length !== 3) || !t.every((x) => SHARE_TOKEN.test(x)) || t[0] === t[1]) return null;", replace: "if (t.length < 2) return null;" }],
    red: ["12d"] },
  // ── PASS 3 (third pass on Opus 5.5, 2026-10-14: review round 2's R1, R2, D1, N1, N2, N4, N7). Each re-introduces one defect into the fixed tree; every named check was RED on e6526cc0 first. ──
  // R1 - a shared comparison opens only for a reader entered in the competition it names (several sports)
  { id: "M72", what: "R1: the resolver forgets the READER - a CFB-only member gets \"Open details\" on an NFL comparison (the review's probe P1)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "        if (multi && !viewerPlaysCompetition(p.competitionId)) allowed = false;", replace: "" }],
    red: ["6b-v"] },
  { id: "M73", what: "R1: the neutral screen's own build forgets the reader - the Back chip's restore and a reader who leaves the sport mid-screen both keep the other sport's picks", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "  if (st.neutral && isMultiSport() && !viewerPlaysCompetition(st.competitionId)) return null;", replace: "" }],
    red: ["6b-z3", "6b-z4", "6b-z7"] },
  { id: "M74", what: "R1: a third member's sport control lists every sport the PAIR plays (the NFL one tap away from a CFB-only reader)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "  return st.neutral ? shared.filter((c) => viewerPlaysCompetition(c.id)) : shared;", replace: "  return shared;" }],
    red: ["6b-x", "6b-y"] },
  { id: "M76", what: "R1 over-applied: the reader's OWN comparison is also refused outside their sport (\"You aren't entered in NFL\" becomes the unavailable state)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "  if (st.neutral && isMultiSport() && !viewerPlaysCompetition(st.competitionId)) return null;", replace: "  if (isMultiSport() && !viewerPlaysCompetition(st.competitionId)) return null;" }],
    red: ["6b-i"] },
  // R2 / D1 - the week detail is personal, and shows the split, only on parts the viewer was an entrant of
  { id: "M77", what: "R2: weekDetailPack hands the viewer EVERY part - a non-entrant is told \"No pick\" and sees \"Split 1–2\" on every route (the review's probes P3 / P4)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "  const viewerParts = viewerId ? members.filter((m) => playersForWeek(m).some((p) => p && p.playerId === viewerId)).map((m) => m.weekId) : [];", replace: "  const viewerParts = viewerId ? members.map((m) => m.weekId) : [];" }],
    red: ["12a", "12b", "12c", "12d", "12f", "12g"] },
  { id: "M78", what: "R2 per part: entered in ANY part counts as entered in all (a late joiner sees Part 1 as his)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "  const viewerParts = viewerId ? members.filter((m) => playersForWeek(m).some((p) => p && p.playerId === viewerId)).map((m) => m.weekId) : [];", replace: "  const viewerParts = viewerId && members.some((m) => playersForWeek(m).some((p) => p && p.playerId === viewerId)) ? members.map((m) => m.weekId) : [];" }],
    red: ["12g"] },
  { id: "M79", what: "R2 in the module: the personal chip ignores which parts are the viewer's (any signed-in viewer is personal everywhere)", suite: "comparetest.mjs",
    edits: [{ file: "js/week-detail.js", find: "  const personalOn = (w) => viewerId !== null && viewerParts.has(w.weekId);", replace: "  const personalOn = (w) => viewerId !== null;" }],
    red: ["9ac", "9ad", "9ae", "9ag"] },
  { id: "M80", what: "D1: the per-side split is shown to a non-entrant again (the old gate, rows-have-landed only)", suite: "comparetest.mjs",
    edits: [{ file: "js/week-detail.js", find: "      if (picksRead && (viewerId === null || mineOn)) {", replace: "      if (picksRead) {" }],
    red: ["9ac", "9ad", "9ag"] },
  { id: "M81", what: "R2: a pack that does not name the viewer's parts fails OPEN (every part is theirs)", suite: "comparetest.mjs",
    edits: [{ file: "js/week-detail.js", find: "  const viewerParts = new Set(asArray(pack.viewerParts).filter(isId));", replace: "  const viewerParts = pack.viewerParts === undefined ? { has: () => true } : new Set(asArray(pack.viewerParts).filter(isId));" }],
    red: ["9ae"] },
  { id: "M82", what: "D1 over-applied: a signed-OUT viewer (S4) loses the league split too", suite: "comparetest.mjs",
    edits: [{ file: "js/week-detail.js", find: "      if (picksRead && (viewerId === null || mineOn)) {", replace: "      if (picksRead && mineOn) {" }],
    red: ["9af"] },
  // N1 - the unavailable states name the screen Back returns to
  { id: "M83", what: "N1: the comparison's unavailable button ignores where it returns (back to a fixed label)", suite: "comparetest.mjs",
    edits: [{ file: "js/compare.js", find: "data-cmp-action=\"back\">${esc(unavailableBackText(backLabel))}</button>", replace: "data-cmp-action=\"back\">${esc('Back to Standings')}</button>" }],
    red: ["7t", "7t2"] },
  { id: "M84", what: "N1: the app does not tell the comparison's unavailable state its Back label", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "unavailableComparisonHTML({ escHtml, backLabel, notEnteredIn: comparisonNotEnteredIn(st) })", replace: "unavailableComparisonHTML({ escHtml, notEnteredIn: comparisonNotEnteredIn(st) })" }],
    red: ["6b-z4"] },
  { id: "M85", what: "N1: the week detail's unavailable button ignores where it returns", suite: "comparetest.mjs",
    edits: [{ file: "js/week-detail.js", find: "data-wd-action=\"back\">${esc(unavailableBackText(backLabel))}</button>", replace: "data-wd-action=\"back\">${esc('Back to Standings')}</button>" }],
    red: ["10k", "10k2"] },
  { id: "M86", what: "N1: the app does not tell the week detail's unavailable state its Back label", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "{ html: unavailableWeekDetailHTML({ escHtml, backLabel }), right: '' }; },", replace: "{ html: unavailableWeekDetailHTML({ escHtml }), right: '' }; }," }],
    red: ["12i"] },
  // N2 - a part counts as final only when the server has confirmed it final
  { id: "M87", what: "N2: finalParts reads the LOCAL status again (a part the server holds live is counted final: a winner and a table)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "finalParts: members.filter((m) => confirmedWeekStatus(m) === 'final' && arePicksPublic(m)).length", replace: "finalParts: members.filter((m) => m.status === WEEK_STATUS.FINAL && arePicksPublic(m)).length" }],
    red: ["10g", "8l"] },
  // N4 - twenty comparisons, half forged, still ONE read per paint
  { id: "M88", what: "N4: the comparison branch drops the pass's targets and re-reads (one fresh read per comparison - the F-1 class)", suite: "sharetest.mjs",
    edits: [{ file: "js/app.js", find: "  if (r.type === 'compare') return compareRefOk(r.id, t.compare);", replace: "  if (r.type === 'compare') { _shareTargets = null; return compareRefOk(r.id, null); }" }],
    red: ["5b-1:"] },
  { id: "M89", what: "N4: the resolver refuses every comparison (the real pairs no longer open)", suite: "sharetest.mjs",
    edits: [{ file: "js/app.js", find: "  if (r.type === 'compare') return compareRefOk(r.id, t.compare);", replace: "  if (r.type === 'compare') return false;" }],
    red: ["5b-1b"] },
  // N7 - the Game view names the sport the game is in
  { id: "M90", what: "N7: the Game view falls back to \"CFB\" for a sport that is not one of Home's (\"You're not entered in CFB picks\" on an NFL game)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/home.js", find: "    const label = comp ? comp.label : (leagueLabel || 'CFB');", replace: "    const label = comp ? comp.label : 'CFB';" }],
    red: ["12k"] },
  { id: "M91", what: "N7: the app does not wire the league's sport label into Home", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "    weekSportLabel: (week) => { if (!week || !isMultiSport()) return null; const c = competitionForWeek(week); const e = c ? leagueSports().find((x) => x.competitionId === c.id) : null; return e ? e.code : null; },\n", replace: "" }],
    red: ["12k"] },
  // polish that came with R2 / D1: a row with nothing in its picks column draws no column
  { id: "M92", what: "(polish) the week detail draws an EMPTY picks column on a non-entrant's rows (the 8 pt row gap hangs under the cover line; browser)", suite: "historybrowsertest.mjs",
    edits: [{ file: "js/week-detail.js", find: "      (g.split || mine) ? joined([", replace: "      true ? joined([" }],
    red: ["5-9"] },
  // pass 3, the coordinator's copy ruling: the unavailable comparison says the TRUE reason to a signed-in reader who is not in the sport, and keeps the signed-out wording for a signed-out reader
  { id: "M93", what: "the app does not tell the unavailable state WHY (a signed-in non-entrant is told \"you may not be signed in\" again)", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "unavailableComparisonHTML({ escHtml, backLabel, notEnteredIn: comparisonNotEnteredIn(st) })", replace: "unavailableComparisonHTML({ escHtml, backLabel })" }],
    red: ["6b-z4b", "6b-z7b"] },
  { id: "M94", what: "the comparison module ignores the reason it is given (the general body for everyone)", suite: "comparetest.mjs",
    edits: [{ file: "js/compare.js", find: "  const sport = typeof notEnteredIn === 'string' ? notEnteredIn.trim() : null;", replace: "  const sport = null;" }],
    red: ["7t3"] },
  { id: "M95", what: "the reason is computed without asking who is signed in (a SIGNED-OUT reader is told \"you're not entered\")", suite: "historywiringtest.mjs",
    edits: [{ file: "js/app.js", find: "  if (!st.neutral || viewerMemberId() !== st.readerId || !isMultiSport() || viewerPlaysCompetition(st.competitionId)) return null;", replace: "  if (!st.neutral || !isMultiSport() || viewerPlaysCompetition(st.competitionId)) return null;" }],
    red: ["6b-z8"] },
];

const only = new Set(process.argv.slice(2));
const run = MUTANTS.filter((m) => !only.size || only.has(m.id));
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-d1hist-kit-'));
const COPY = join(tmp, 'cfb-pickems');
console.log(`\nd1-history kit — ${run.length} mutant(s); copying ${CFB} -> ${COPY} (node_modules and dot-directories left out)\n`);
cpSync(CFB, COPY, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });

let caught = 0, survived = 0, broken = 0;
for (const m of run) {
  // edits apply in order to ONE running text per file (several edits may touch the same file); every anchor must match exactly once in the text it meets
  const files = new Map();
  let stale = '';
  for (const e of m.edits) {
    if (!files.has(e.file)) { const real = readFileSync(join(CFB, e.file), 'utf8'); files.set(e.file, { real, text: real, copy: join(COPY, e.file) }); }
    const f = files.get(e.file);
    if (f.text.split(e.find).length - 1 !== 1) { stale = e.file; break; }
    f.text = f.text.split(e.find).join(e.replace);
  }
  if (stale) { broken++; console.log(`  ⚠️  ${m.id} ANCHOR does not match exactly once in ${stale} — the kit is stale for this mutant`); continue; }
  for (const f of files.values()) writeFileSync(f.copy, f.text);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [m.suite], { cwd: COPY, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000, env: { ...process.env, ...(m.env || {}) } });
  for (const f of files.values()) writeFileSync(f.copy, f.real);                    // the COPY's files go back to the checkout's text
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const redLines = out.split('\n').filter((l) => l.includes('❌'));
  const missing = m.red.filter((label) => !redLines.some((l) => l.includes(label)));
  const ok = r.status !== 0 && missing.length === 0;
  if (ok) caught++; else survived++;
  console.log(`  ${ok ? '✅ CAUGHT  ' : '❌ SURVIVED'} ${m.id} (${m.suite}, ${Math.round((Date.now() - t0) / 1000)}s) — ${m.what}`);
  console.log(`        RED on: ${m.red.filter((l) => !missing.includes(l)).join(' | ') || '(none)'}${missing.length ? `   NOT red: ${missing.join(' | ')}` : ''}   [exit ${r.status}, ${redLines.length} ❌ line(s)]`);
  if (!ok) for (const l of redLines.slice(0, 5)) console.log(`          ${l.trim().slice(0, 170)}`);          // what DID go red, so a survivor's expectation can be corrected
}
try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
console.log(`\n${survived === 0 && broken === 0 ? '✅ ALL CAUGHT' : '❌ NOT ALL CAUGHT'} — ${caught} caught, ${survived} survived, ${broken} stale anchor(s)`);
process.exit(survived === 0 && broken === 0 ? 0 : 1);
