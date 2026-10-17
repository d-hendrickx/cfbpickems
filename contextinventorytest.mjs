/**
 * CFB Pickems — contextinventorytest.mjs (D1 / v0.30.0, DI-520 "the sport context", DI-524/525/526/527)
 * =========================================================================================================
 * The sport context is only as good as its weakest read: a Picks, Dashboard or Standings helper that still asks `getCurrentWeek()` or `getWeeks()` shows the DEFAULT sport's week under another
 * sport's switcher. This scans js/app.js for every such call, names the function it sits in, and holds the whole list to a classification with a reason. A new unscoped read in any function not
 * listed fails; a listed function that no longer makes the call fails (a dead entry is as loud as a new one); canaries prove the scanner sees both spellings and the function names.
 *
 * The surfaces that ARE sport-aware (Picks, Dashboard, Standings and their helpers) read getContextWeek() / getContextWeeks() / getWeeksForCompetition() / playersForWeek(); the only unscoped reads
 * left in them are the one-sport branches of `scoped ? ... : getWeeks()` (a one-sport league's answer is today's) and lookups BY ID or GROUP. Everything else is league-wide (timers, the header,
 * the League Page, backups), the commissioner's (the server branch's lens: DI-534), or another thread's, each named.
 *
 * Run:  node contextinventorytest.mjs
 */
import { readFile } from 'node:fs/promises';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"\\/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
/** { 'fn::getCurrentWeek' : n } for every `getCurrentWeek()` / `getWeeks()` call, keyed by the nearest enclosing top-level function. */
export function unscopedReads(src) {
  const lines = blank(src).split('\n');
  const out = {};
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/(?<![\w.$])(getCurrentWeek|getWeeks)\(\)/g)) {
      let fn = '(top level)';
      for (let j = i; j >= 0; j--) { const mm = lines[j].match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/); if (mm) { fn = mm[1]; break; } }
      const k = `${fn}::${m[1]}`;
      out[k] = (out[k] || 0) + 1;
    }
  });
  return out;
}

const ONE = 'the one-sport branch of `scoped ? getContext...() : getWeeks()`: a one-sport league\'s answer is today\'s';
const BYID = 'a lookup BY week id / group id (the week is handed in): no sport is chosen here';
const LEAGUE = 'league-wide: a timer, a backup, the header or the League Page - not one of the three sport tabs';
const COMM = 'the commissioner\'s panel and wizard: the sport LENS (DI-534; it moves the player\'s pointer when the pointer accepts the sport, else it is the commissioner\'s own choice) scopes these';
const DATA = 'league-wide data (alma-mater flags, the obligations ledger): not a per-sport view';
const OTHER = 'another thread\'s';
const A = {
  // the sport-aware surfaces: one-sport branches and by-id lookups only
  'seasonStandingsRows::getWeeks': [1, ONE], 'weeklyHistoryInputs::getWeeks': [1, ONE], 'renderExtraPointLedgerHTML::getWeeks': [1, ONE],
  'exportExtraPointCSV::getWeeks': [1, ONE], 'exportAllWeeklyResultsCSV::getWeeks': [1, ONE],
  'renderScoreSummaryRowsHTML::getWeeks': [1, BYID], 'renderDashboardCompact::getWeeks': [1, BYID], 'finalizeWeek::getWeeks': [1, BYID + ' (weeksInGroup)'],
  // league-wide
  // MERGE RE-DERIVATION 2026-10-08 (feat/d1-sports = server + client). REMOVED as dead (the server converted them, DI-534/DI-535, so each now reads a helper instead of getCurrentWeek()/getWeeks()):
  //   wireSupabaseAdapter, afterSupabaseHydrate, checkLifecyclePostDue, runAutoRefreshTick, tickAutoTransition (getCurrentWeek) -> tickWeeks() / currentWeeksToSweep(), every sport's current week;
  //   maybeNoticeUnfrozenSpreads, renderCommPage (x2), refreshCommTiebreakerCard, weekWizardTargetWeek, weekWizardContinuableDrafts (x2), openWeekWizardSheet -> commWeek() / commWeeks(), the lens' week.
  // ADDED, the helpers themselves (each holds the ONE-sport branch or a fallback, and is exactly the place those reads were collapsed into):
  'currentWeeksToSweep::getCurrentWeek': [1, ONE + ' (a one-sport league sweeps exactly [getCurrentWeek()]; a several-sport league sweeps each sport\'s own current week)'],
  'tickWeeks::getCurrentWeek': [1, 'the fallback when no competition resolves a current week (DI-535; sportticktest [5f]): today\'s answer'],
  'commWeek::getCurrentWeek': [1, ONE + ' - the commissioner\'s lens week (DI-534): a one-sport league\'s commWeek() IS getCurrentWeek()'],
  'commWeeks::getWeeks': [1, ONE + ' - the commissioner\'s lens weeks (DI-534): a one-sport league\'s commWeeks() IS getWeeks()'],
  'currentWeekOfSportFor::getCurrentWeek': [1, ONE + ' - the commissioner\'s per-sport current week (DI-533/534): one sport, today\'s'],
  // 'onCardDetailClick::getCurrentWeek' came OFF the list (Lane B Game Day round, 2026-10-08): "Open Dashboard" and "Make your picks" on a card detail go through openSportWeek(), which compares the week to ITS OWN sport's current week (enterSportContext in a several-sport league, getContextWeek in one).
  'makeRunManualSync::getCurrentWeek': [1, LEAGUE],
  // D1 Lane A (2026-10-08, G1 / DI-542): the Leave sentence counts the SPORTS of every week the leaver has OWN picks in, each week resolved through its competition (competitionForWeek), so it must see every week of the league; not a per-sport view.
  'lsEnteredSportCount::getWeeks': [1, LEAGUE + ' - DI-542: the sports a leaver has entered, across every week they hold picks in'],
  // RE-DERIVED 2026-10-08 (Part 2 item 1): the header no longer reads getCurrentWeek() on every tab. refreshHeader::getCurrentWeek is OFF this list (dead); its successor is headerWeekFor, whose ONLY remaining
  // read is the one-sport branch (a several-sport league reads getContextWeek() / commWeek()). OLD reason: "the header week block stays on the league's current week (a recorded decision)" - reversed by the coordinator.
  'headerWeekFor::getCurrentWeek': [1, ONE + ' - the header\'s week block and the lock-flip timer (a several-sport league reads the context sport\'s week, the lens\' in Comm, the pointer\'s elsewhere)'],
  'lockRefusalApplies::getCurrentWeek': [1, 'the fallback when the adapter reports no refused-row weeks (N3): today\'s rule'],
  '_leaguePillSportInfo::getCurrentWeek': [1, 'the one-sport branch (after the multi-sport return)'],
  'wagerSettleWeeks::getCurrentWeek': [1, LEAGUE + ' - wagers settle across the season'], 'wagerSettleWeeks::getWeeks': [1, LEAGUE + ' - wagers settle across the season'],
  'lockFlipWeek::getCurrentWeek': [1, 'the league\'s current week for every page that is not a sport tab (and for a one-sport league)'],
  'tickAutoTransition::getWeeks': [1, LEAGUE + ' - scans EVERY week'],
  'checkPickRevealDue::getWeeks': [1, LEAGUE + ' - scans every week'],
  'handleGameRequestSubmit::getCurrentWeek': [1, LEAGUE + ' - a request is tagged with the season'], 'handleGameRequestSubmit::getWeeks': [0, ''],
  'submitFeedback::getCurrentWeek': [1, LEAGUE + ' - feedback is tagged with the current week'],
  'recomputeAlmaMaterFlags::getWeeks': [1, DATA], 'almaMaterRankLookupGames::getWeeks': [1, DATA], 'currentSeasonObligations::getWeeks': [1, DATA + ' (the ledger shows a Sport column)'],
  // RE-DERIVED 2026-10-08 (Part 2 item 2): fireScribeWeekSignals::getWeeks is OFF (dead) - SCRIBE's inputs are signalInputsForWeek(), whose getWeeks() is the ONE-sport branch (a several-sport league reads the week's own sport's weeks).
  'signalInputsForWeek::getWeeks': [1, ONE + ' - SCRIBE\'s week signals (Lane C): streaks are read over the week\'s own sport\'s season, with that week\'s entrants as the players'],
  'exportObligationsCSV::getWeeks': [1, DATA], 'exportFeedbackCSV::getWeeks': [1, LEAGUE], 'exportFullCsvBundle::getWeeks': [1, LEAGUE + ' - the full backup'],
  'renderLeaguePageOverlayBody::getWeeks': [2, LEAGUE + ' - the League Page (its Sports region is the overview\'s own cards)'], 'lsWeeksForLeave::getWeeks': [1, LEAGUE], 'lsSportsLabel::getWeeks': [1, LEAGUE],
  'renderGameRequestsAdminSectionHTML::getWeeks': [1, COMM],
  // the commissioner's
  'renderAdminPage::getCurrentWeek': [1, COMM], 'renderAdminPage::getWeeks': [1, COMM],
  'bindCommEventListeners::getWeeks': [4, COMM],   // 2026-10-08 (merge): 5 -> 4, one read moved to commWeeks() with the lens
  'wizardSetActiveWeekId::getCurrentWeek': [1, COMM], 'renderWeekWizardStep1HTML::getWeeks': [1, COMM],
  'saveWizardTiming::getWeeks': [1, COMM], 'renderWeekWizardStep6HTML::getWeeks': [1, COMM], 'renderWeekWizardManageHTML::getWeeks': [1, COMM], 'weekWizardLiveWeekBehind::getWeeks': [1, COMM],
  'bindWeekWizardManage::getWeeks': [1, COMM], 'renderWeekWizardContinuePickerHTML::getWeeks': [1, COMM],
};
delete A['handleGameRequestSubmit::getWeeks'];

console.log('\n[1] every unscoped getCurrentWeek() / getWeeks() in js/app.js is classified…');
{
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const found = unscopedReads(src);
  const unclassified = Object.keys(found).filter((k) => !A[k]);
  const wrong = Object.keys(found).filter((k) => A[k] && A[k][0] !== found[k]).map((k) => `${k} found ${found[k]}, listed ${A[k][0]}`);
  const dead = Object.keys(A).filter((k) => !found[k]);
  assert(unclassified.length === 0, `[1a] no unclassified read (a new one must use getContextWeek / getContextWeeks / playersForWeek, or be added with its reason): ${unclassified.join(' | ') || 'none'}`);
  assert(wrong.length === 0, `[1b] ...and every count matches (${wrong.join(' | ') || 'none'})`);
  assert(dead.length === 0, `[1c] ...and no entry is dead (${dead.join(' | ') || 'none'}): a converted function comes off the list`);
  assert(Object.values(A).every(([, why]) => typeof why === 'string' && why.length > 25), '[1d] each entry says why it is allowed');
  // the three sport tabs and their helpers carry NO unscoped read beyond the one-sport branches and by-id lookups
  const SPORT_AWARE = ['renderPicksPage', 'renderSubmittedView', 'renderDashboard', 'renderDashboardInner', 'renderDashboardAllSports', 'renderDashboardCompact', 'renderDashboardTable', 'renderLeaderboard', 'picksNavWeeks', 'picksShowingWeek', 'selectableDashboardWeeks', 'renderDashboardWeekNav', 'renderPicksWeekNav', 'bindPicksWeekNav', 'bindDashboardWeekNav', 'weeklyHistoryInputs', 'seasonStandingsRows'];
  const leaks = Object.keys(found).filter((k) => SPORT_AWARE.includes(k.split('::')[0]) && !/^(seasonStandingsRows|weeklyHistoryInputs|renderDashboardCompact)::/.test(k));
  assert(leaks.length === 0, `[1e] the sport-aware surfaces make no unscoped read at all (beyond the three listed one-sport / by-id spots): ${leaks.join(' | ') || 'none'}`);
  const scoped = (src.match(/\bgetContextWeek\(\)/g) || []).length + (src.match(/\bgetContextWeeks\(\)/g) || []).length;
  assert(scoped >= 10, `[1f] the context readers are in use (${scoped} reads of getContextWeek / getContextWeeks)`);
}

console.log('\n[2] canaries…');
{
  assert(unscopedReads('function renderPicksPage(){ const w = getCurrentWeek(); }')['renderPicksPage::getCurrentWeek'] === 1 && unscopedReads('function renderLeaderboard(){ return getWeeks().length; }')['renderLeaderboard::getWeeks'] === 1,
    '[2a] a NEW unscoped read in a sport surface is found, under its function\'s name, in both spellings');
  assert(Object.keys(unscopedReads('function f(){ return getContextWeek() || getContextWeeks(); }')).length === 0 && Object.keys(unscopedReads('function f(){ return getWeeksForCompetition(x) || state.getWeeks; }')).length === 0 && Object.keys(unscopedReads('// getCurrentWeek()\n/* getWeeks() */ function f(){}')).length === 0,
    '[2b] the context readers, a similarly named function and a read named only in a comment are not flagged');
  assert(unscopedReads('export async function g(){ const a = getWeeks(); const b = getWeeks(); }')['g::getWeeks'] === 2, '[2c] two reads in one function are two (counts matter)');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
