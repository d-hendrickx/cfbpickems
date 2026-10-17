/**
 * CFB Pickems — sportstatetest.mjs (D1 / v0.30.0, DI-527 "State isolation: switching sports never loses or mixes anything", DI-538)
 * ===================================================================================================================================
 * The T1..T10 matrix the DI names, run against the real js/app.js on sportenv.mjs's local store - plus the runtime proof persisttest [7] points here for: every draft bucket is gone after a
 * sign-out, and a SPORT switch is not an identity change.
 *
 * Run:  node sportstatetest.mjs
 *
 *   T1   partial CFB draft, switch to NFL, partial NFL draft, back                  both drafts intact (picks, tiebreaker, Extra Point), and the page shows the selection
 *   T2   submit NFL with a CFB draft open                                           the CFB draft and its completion are unchanged; only NFL picks are written
 *   T3   navigate NFL to Week 1, switch, return                                     NFL shows Week 1; CFB shows its own week
 *   T4   a CFB score update while viewing the NFL Dashboard                         the NFL Dashboard is byte-identical (positive control: the CFB Dashboard changes)
 *   T5   a Realtime event for NFL while on CFB Picks with a draft                   no repaint of the CFB form (the predicate, every branch of it, and the wiring)
 *   T6   scroll in the CFB Dashboard, switch and back                               position restored, per (tab, sport)
 *   T7   sign out (the REAL identity chokepoint)                                    every bucket, viewed week, scroll position and other account's pointer is gone
 *   T8   switch league                                                              the new league's pointer; back again restores the first
 *   T9   a deep link while a draft exists                                           draft preserved
 *   T10  reload                                                                     drafts gone (as today), pointer kept
 *   [X]  a sport switch is NOT an identity change; the bucket key is the week; mutation proofs.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeEnv, withMutantApp, loadMutant, LEAGUE, NOW } from './sportenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const env = await makeEnv();
const { app, comp, st, auth } = env;
const BOTH = { sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] } };
const C1 = 'w_cfb_2_g1', C2 = 'w_cfb_2_g2', N1 = 'w_nfl_2_g1', N2 = 'w_nfl_2_g2';
const gamesOf = (weekId) => st.getGames(weekId);
const cfbWeek = () => st.getWeeks().find((w) => w.weekId === 'w_cfb_2');
const nflWeek = () => st.getWeeks().find((w) => w.weekId === 'w_nfl_2');
const useSport = (code) => comp.setActiveSportKey(code);
const picksHtml = () => env.renderFull('picks');
/** A clean slate for the module-level session state the sport context adds (drafts, viewed weeks, scroll), which survives env.league() because it lives in app.js, not in the store. */
function fresh(opts) {
  app._clearPickDraftForTest();
  for (const k of Object.keys(app._viewingBySportForTest)) delete app._viewingBySportForTest[k];
  app._sportScrollForTest.clear();
  app.state.editingPicks = false;
  return env.league(opts);
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T1] a partial draft per sport survives the round trip…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BOTH);
  useSport('cfb');
  app.state.draftPicks = { [C1]: 'CFB-open-home' }; app.state.draftTiebreaker = 55; app.state.draftExtraPoint = 41;
  useSport('nfl');
  assert(eq(app.state.draftPicks, {}) && app.state.draftTiebreaker === null && app.state.draftExtraPoint === null, '[T1a] switching to NFL starts from an empty draft (the CFB draft is not NFL\'s)');
  app.state.draftPicks = { [N1]: 'NFL-open-away' }; app.state.draftTiebreaker = 40;
  useSport('cfb');
  assert(eq(app.state.draftPicks, { [C1]: 'CFB-open-home' }) && app.state.draftTiebreaker === 55 && app.state.draftExtraPoint === 41, '[T1b] back on CFB: picks, tiebreaker AND Extra Point are exactly as typed');
  useSport('nfl');
  assert(eq(app.state.draftPicks, { [N1]: 'NFL-open-away' }) && app.state.draftTiebreaker === 40 && app.state.draftExtraPoint === null, '[T1c] back on NFL: its draft is intact and its Extra Point is still unset (not CFB\'s 41)');
  useSport('cfb');
  const html = picksHtml();
  assert(/class="[^"]*\bselected\b[^"]*" data-team="CFB-open-home" data-game-id="w_cfb_2_g1"/.test(html) || /data-team="CFB-open-home" data-game-id="w_cfb_2_g1"[^>]*aria-pressed="true"/.test(html) || /selected[^>]*data-team="CFB-open-home"/.test(html),
    '[T1d] and the CFB Picks page PAINTS the draft selection after the switch');
  useSport('nfl');
  const nflHtml = picksHtml();
  assert(!/selected[^>]*data-team="CFB/.test(nflHtml) && /selected[^>]*data-team="NFL-open-away"/.test(nflHtml), '[T1e] ...and the NFL page paints ITS selection and none of CFB\'s');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T2] submitting one sport leaves the other\'s draft alone…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BOTH);
  useSport('cfb');
  app.state.draftPicks = { [C1]: 'CFB-open-home' }; app.state.draftTiebreaker = 55;
  useSport('nfl');
  app.state.draftPicks = { [N1]: 'NFL-open-home', [N2]: 'NFL-open-away2' }; app.state.draftTiebreaker = 40;
  app._submitPicksForTest(nflWeek(), gamesOf('w_nfl_2'));
  assert(st.getPicks('w_nfl_2', 'p1').length === 2 && st.getPicks('w_cfb_2', 'p1').length === 0, '[T2a] the NFL picks are written and no CFB pick is');
  assert(eq(app.state.draftPicks, {}) && app.state.draftTiebreaker === null, '[T2b] the submitted sport\'s draft is cleared');
  useSport('cfb');
  assert(eq(app.state.draftPicks, { [C1]: 'CFB-open-home' }) && app.state.draftTiebreaker === 55, '[T2c] the CFB draft - picks and tiebreaker - is untouched, still unsubmitted');
  assert(st.getTiebreakerGuess('w_nfl_2', 'p1') === 40 && st.getTiebreakerGuess('w_cfb_2', 'p1') !== 40, '[T2d] the tiebreaker guess was stored for NFL\'s week only');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T3] the week being viewed is remembered per sport…');
// ═════════════════════════════════════════════════════════════════
{
  fresh({ ...BOTH, submitted: ['p1'] });
  useSport('nfl');
  app.state.viewingWeekId = 'w_nfl_1';
  useSport('cfb');
  assert(app.state.viewingWeekId === null, '[T3a] CFB has not been navigated: it still means "the current week" (null)');
  app.state.viewingWeekId = 'w_cfb_1';
  useSport('nfl');
  assert(app.state.viewingWeekId === 'w_nfl_1', '[T3b] back on NFL: Week 1 is still the week being viewed');
  const html = picksHtml();
  assert(/NFL-final-home/.test(html) && !/CFB-final/.test(html), '[T3c] the NFL Picks page shows NFL Week 1 (its history), no CFB game');
  useSport('cfb');
  assert(app.state.viewingWeekId === 'w_cfb_1' && /CFB-final-home/.test(picksHtml()) && !/NFL-final/.test(picksHtml()), '[T3d] and CFB shows ITS own Week 1, remembered separately');
  // one sport: the bucket is constant
  fresh({ sports: ['cfb'] });
  app.state.viewingWeekId = 'w_cfb_1';
  assert(app.state.viewingWeekId === 'w_cfb_1' && localStorage.getItem('cfbp_active_sport') === null, '[T3e] a one-sport league: the viewed week works as it always did and stores nothing');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T4] a CFB score update repaints nothing in NFL…');
// ═════════════════════════════════════════════════════════════════
{
  fresh({ ...BOTH, weekStatus: { cfb: 'live', nfl: 'live' }, submitted: ['p1', 'p3'] });
  useSport('nfl');
  const before = env.render('dashboard');
  const g = st.getGames('w_cfb_2')[0];
  st.saveGame({ ...g, status: 'live', homeScore: 7, awayScore: 3, lastUpdated: new Date(NOW).toISOString() });
  const afterNfl = env.render('dashboard');
  assert(afterNfl === before, '[T4a] the NFL Dashboard is BYTE-IDENTICAL after a CFB game goes live');
  useSport('cfb');
  const cfbNow = env.render('dashboard');
  st.saveGame({ ...g, status: 'live', homeScore: 14, awayScore: 3, lastUpdated: new Date(NOW + 60000).toISOString() });
  assert(env.render('dashboard') !== cfbNow, '[T4b] POSITIVE CONTROL: the same update DOES change the CFB Dashboard (so the identity above is not an inert harness)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T5] a Realtime event for the other sport does not repaint the form being filled…');
// ═════════════════════════════════════════════════════════════════
{
  const other = app._realtimeEventForOtherSportForTest;
  fresh(BOTH);
  useSport('cfb');
  app.state.currentTab = 'picks';
  app.state.draftPicks = { [C1]: 'CFB-open-home' };
  const ev = (table, row, key = 'new') => other(table, { [key]: row });
  assert(ev('games', { week_id: 'w_nfl_2' }) === true && ev('picks', { week_id: 'w_nfl_2' }) === true && ev('weekly_results', { week_id: 'w_nfl_2' }) === true, '[T5a] a games / picks / results row of an NFL week, while on CFB Picks: "other sport" (skip the repaint)');
  assert(ev('weeks', { id: 'w_nfl_2' }) === true, '[T5b] ...and a weeks row, whose own id is the week');
  assert(ev('games', { week_id: 'w_nfl_2' }, 'old') === true, '[T5c] ...a delete (payload.old only) as well');
  assert(ev('games', { week_id: 'w_cfb_2' }) === false && ev('weeks', { id: 'w_cfb_2' }) === false, '[T5d] an event for the CFB week being edited DOES repaint');
  assert(ev('players', { id: 'p1' }) === false && ev('settings', {}) === false && ev('competitions', { id: 'x' }) === false && ev('competition_members', { week_id: 'w_nfl_2' }) === false, '[T5e] a table that is not about a week repaints as before');
  assert(ev('games', { week_id: 'w_ghost' }) === false && ev('games', {}) === false && other('games', null) === false && other('games', undefined) === false && ev('games', { week_id: 7 }) === false, '[T5f] an unknown week, a row with no week, a missing payload and a non-string id all repaint (every doubt is a repaint)');
  app.state.currentTab = 'home';
  assert(ev('games', { week_id: 'w_nfl_2' }) === false, '[T5g] on Home (a league-wide tab) the NFL event repaints: Home spans every sport');
  for (const tab of ['chat', 'rules', 'commissioner']) { app.state.currentTab = tab; assert(ev('games', { week_id: 'w_nfl_2' }) === false, `[T5g] ...and on ${tab}`); }
  app.state.currentTab = 'dashboard';
  comp.setDashboardScope('all');
  assert(ev('games', { week_id: 'w_nfl_2' }) === false && ev('games', { week_id: 'w_cfb_2' }) === false, '[T5h] on the Dashboard with All sports selected nothing is "other": both sports are on screen');
  comp.setDashboardScope(null);
  assert(ev('games', { week_id: 'w_nfl_2' }) === true, '[T5i] ...and with a sport selected again it is');
  app.state.currentTab = 'leaderboard';
  assert(ev('weekly_results', { week_id: 'w_nfl_2' }) === true, '[T5j] Standings is a sport tab too');
  fresh({ sports: ['cfb'] });
  app.state.currentTab = 'picks';
  assert(ev('games', { week_id: 'w_cfb_2' }) === false && ev('games', { week_id: 'w_nfl_2' }) === false, '[T5k] a one-sport league: no event is ever "another sport\'s"');
  // the wiring: the Realtime callback consults the predicate before it repaints, and still reconciles every sport's system posts
  const src = (await read('./js/app.js')).replace(/\/\*[\s\S]*?\*\//g, '');
  const cb = (src.match(/onRealtimeEvent: \(table, payload\) => \{[\s\S]*?\n    \},/) || [''])[0];
  // RE-DERIVED 2026-10-08 (merge, coordinator). OLD: the callback skipped the WHOLE repaint for an other-sport row (`if (!realtimeEventForOtherSport(...)) _repaintForSupabaseData('realtime');`) and reconciled with
  // `getAllCurrentWeeks()` / `else reconcileGameEvents(getCurrentWeek())`. NEW: the predicate decides ONLY `skipTab` (the tab rebuild; the header, pill, switcher dots, unfrozen-spread notice and held deep link
  // still run - drafttest [8]) and the system posts are reconciled with the server's tickWeeks() (every sport's current week; a one-sport league is exactly [getCurrentWeek()], sportticktest [5f]).
  assert(/const otherSport = realtimeEventForOtherSport\(table, payload\);/.test(cb) && /_repaintForSupabaseData\('realtime', \{ skipTab: otherSport \}\);/.test(cb) && /for \(const w of tickWeeks\(\)\) reconcileGameEvents\(w\)/.test(cb) && !/getCurrentWeek\(\)/.test(cb),
    '[T5l] the wired Realtime callback gates ONLY the tab rebuild on the predicate, and reconciles kickoff / FINAL posts for every sport\'s current week through tickWeeks() (one sport: exactly the old call)');
  assert(/onRealtimeEvent: \(\) => \{ _repaintForSupabaseData\('realtime'\);/.test(`onRealtimeEvent: () => { _repaintForSupabaseData('realtime'); reconcileGameEvents(getCurrentWeek()); },`) && !/onRealtimeEvent: \(\) =>/.test(src),
    '[T5m] canary: the OLD unconditional callback shape is no longer in app.js (and the pattern that would find it works)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T6] scroll is remembered per (tab, sport)…');
// ═════════════════════════════════════════════════════════════════
{
  fresh({ ...BOTH, submitted: ['p1', 'p3'] });
  const calls = [];
  globalThis.scrollTo = (a, b) => calls.push(typeof a === 'object' ? a : { top: b, left: a });
  useSport('cfb');
  app._resetSportScrollForTest?.();
  app._sportScrollForTest.clear();
  env.render('dashboard');
  globalThis.scrollY = 300;
  assert(app._selectSportSegmentForTest('dashboard', 'nfl') === true, '[T6a] switching the Dashboard from CFB to NFL succeeds');
  assert(app._sportScrollForTest.get('dashboard|cfb') === 300, '[T6b] the CFB Dashboard\'s position (300) was saved against (dashboard, cfb)');
  assert(calls.length > 0 && calls[calls.length - 1].top === 0, '[T6c] NFL opens at ITS remembered position (never visited: the top), not at CFB\'s 300');
  globalThis.scrollY = 120;
  assert(app._selectSportSegmentForTest('dashboard', 'cfb') === true && app._sportScrollForTest.get('dashboard|nfl') === 120, '[T6d] and NFL\'s 120 is saved on the way back');
  assert(calls[calls.length - 1].top === 300, `[T6e] back on CFB the page is scrolled to 300 (the last call asked for ${calls[calls.length - 1].top})`);
  app._selectSportSegmentForTest('dashboard', 'nfl');
  assert(calls[calls.length - 1].top === 120, '[T6f] and NFL returns to 120');
  assert(app._selectSportSegmentForTest('dashboard', 'nfl') === false, '[T6g] choosing the segment you are on does nothing (no scroll, no repaint)');
  globalThis.scrollY = 0;
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T7] sign-out through the REAL identity chokepoint clears everything…');
// ═════════════════════════════════════════════════════════════════
{
  // Supabase auth mode: the session's identity is the membership; the chokepoint compares (account, league, member) on every auth event.
  fresh(BOTH);
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
  auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  auth._setMembershipsForTest([{ leagueId: LEAGUE, memberId: 'p1', role: 'player', displayName: 'Drew', leagueName: 'IRB' }]);
  auth.setActiveLeagueId(LEAGUE);
  app._resetAuthUIWiringForTest();
  app.wireAuthUIEvents();
  const quiet = async (fn) => { const l = console.log, i = console.info, w = console.warn; console.log = () => {}; console.info = () => {}; console.warn = () => {}; try { return await fn(); } finally { console.log = l; console.info = i; console.warn = w; } };
  await quiet(async () => app.refreshAuthUI('MEMBERSHIPS_REFRESHED', {}));
  assert(app._lastIdentityKeyForTest() === app._currentIdentityKeyForTest(), '[T7a] fixture: the identity latch holds this member');
  useSport('cfb'); app.state.draftPicks = { [C1]: 'CFB-open-home' }; app.state.draftTiebreaker = 50;
  useSport('nfl'); app.state.draftPicks = { [N1]: 'NFL-open-home' }; app.state.viewingWeekId = 'w_nfl_1';
  const overviewUp = app._openLeagueOverviewForTest();
  assert(overviewUp === true && app._leagueOverviewStateForTest() !== null, '[T7a2] fixture: the league overview is open when the member signs out');
  app._sportScrollForTest.set('dashboard|nfl', 77);
  localStorage.setItem('cfbp_active_sport', JSON.stringify({ 'acct-me': { [LEAGUE]: 'nfl' }, 'acct-other': { [LEAGUE]: 'nfl' } }));
  // sign out: the membership and token go
  await quiet(async () => { auth._setMembershipsForTest([]); auth._setStoredSessionForTest(null); });
  assert(app._lastIdentityKeyForTest() !== null && app._currentIdentityKeyForTest() !== undefined, '[T7b] fixture: the sign-out reached the chokepoint');
  const buckets = app._draftBucketsForTest ? Object.keys(app._draftBucketsForTest) : null;
  const stillCfb = (useSport('cfb'), app.state.draftPicks);
  const stillNfl = (useSport('nfl'), app.state.draftPicks);
  assert(eq(stillCfb, {}) && eq(stillNfl, {}) && app.state.draftTiebreaker === null, '[T7c] BOTH sports\' drafts are gone after the sign-out (picks, tiebreaker)');
  assert(app._leagueOverviewStateForTest() === null && !document.getElementById('league-overview-sheet-wrap'), '[T7c2] the open overview is CLOSED by the identity change: its state, its timer and its node are gone (DI-538)');
  assert(app._viewingBySportForTest && Object.keys(app._viewingBySportForTest).length === 0, '[T7d] the per-sport viewed weeks are gone');
  assert(app._sportScrollForTest.size === 0, '[T7e] the scroll memory is gone');
  // The device-local pointers are pruned BEST-EFFORT: the storage write interlock refuses ANY write while the adapter is not serving (the state at a sign-out), and the hygiene call never throws.
  // Correctness never depends on the prune - every read is keyed by account and league and validated (A5) - so the checks are: no throw, no cross-account read, and the prune itself works.
  const ptrAfter = JSON.parse(localStorage.getItem('cfbp_active_sport') || '{}');
  assert(comp.getActiveSportKey() === 'cfb', '[T7f] a signed-out device resolves the safe default, whatever pointers are still stored (A5: reads are keyed)');
  assert(JSON.stringify(ptrAfter) === JSON.stringify({ 'acct-me': { [LEAGUE]: 'nfl' }, 'acct-other': { [LEAGUE]: 'nfl' } }) || !('acct-other' in ptrAfter), '[T7f2] the interlock-refused prune left the stored map as it was (best effort) - or pruned it; it never half-wrote it');
  assert(buckets === null || buckets.length === 0, '[T7g] no draft bucket exists');
  auth.configureAuth({ authMode: 'pins' });
  auth._setMembershipsForTest([]);
  // the prune itself, where the interlock allows the write (PIN mode: a local-only device)
  fresh(BOTH);
  localStorage.setItem('cfbp_active_sport', JSON.stringify({ 'acct-me': { [LEAGUE]: 'nfl' }, 'acct-other': { [LEAGUE]: 'nfl' } }));
  localStorage.setItem('cfbp_dashboard_scope', JSON.stringify({ 'acct-me': { [LEAGUE]: 'all' }, 'acct-other': { [LEAGUE]: 'all' } }));
  app._onContextSwitchForTest({ keepAccountId: 'acct-me' });
  assert(eq(JSON.parse(localStorage.getItem('cfbp_active_sport')), { 'acct-me': { [LEAGUE]: 'nfl' } }) && eq(JSON.parse(localStorage.getItem('cfbp_dashboard_scope')), { 'acct-me': { [LEAGUE]: 'all' } }),
    '[T7h] the context-switch hook keeps the account that is here and prunes every other account\'s pointer AND Dashboard scope');
  app._onContextSwitchForTest({ keepAccountId: null });
  assert(eq(JSON.parse(localStorage.getItem('cfbp_active_sport')), {}) && eq(JSON.parse(localStorage.getItem('cfbp_dashboard_scope')), {}), '[T7i] with nobody signed in it prunes them all');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T8] switching league restores THAT league\'s pointer…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BOTH);
  useSport('nfl');
  assert(comp.getActiveSportKey() === 'nfl', '[T8a] league A: the member is on NFL');
  localStorage.setItem('cfbp_supabase_active_league', 'L-other-0002');
  assert(comp.getActiveSportKey() === 'cfb', '[T8b] league B (never visited): the first sport the member plays, not A\'s NFL');
  useSport('cfb'); // an explicit choice in B... a one-pointer-per-league map keeps A's entry
  localStorage.setItem('cfbp_supabase_active_league', LEAGUE);
  assert(comp.getActiveSportKey() === 'nfl', '[T8c] back in league A: NFL again - the pointer is per league, per user');
  const map = JSON.parse(localStorage.getItem('cfbp_active_sport'));
  assert(map.local && map.local[LEAGUE] === 'nfl' && map.local['L-other-0002'] === 'cfb', '[T8d] the stored map is { user: { league: sport } }: both leagues\' choices live side by side');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T9] a deep link keeps the draft…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BOTH);
  useSport('cfb');
  app.state.draftPicks = { [C1]: 'CFB-open-away' }; app.state.draftTiebreaker = 61;
  const landed = app.enterSportContext('nfl', { tab: 'picks', source: 'link' });
  assert(landed === true && comp.getActiveSportKey() === 'nfl', '[T9a] the link to NFL lands on NFL Picks');
  assert(eq(app.state.draftPicks, {}), '[T9b] NFL\'s own draft is empty');
  useSport('cfb');
  assert(eq(app.state.draftPicks, { [C1]: 'CFB-open-away' }) && app.state.draftTiebreaker === 61, '[T9c] the CFB draft - picks and tiebreaker - is exactly what it was before the link');
  // a link to a sport the member does not play changes nothing, draft included
  fresh({ ...BOTH, viewer: 'p2' });
  useSport('cfb');
  app.state.draftPicks = { [C1]: 'CFB-open-away' };
  const before = localStorage.getItem('cfbp_active_sport');
  const r = app.enterSportContext('nfl', { tab: 'picks', source: 'link' });
  assert(r === false && eq(app.state.draftPicks, { [C1]: 'CFB-open-away' }) && localStorage.getItem('cfbp_active_sport') === before, '[T9d] a link to an UNPLAYED sport changes nothing (pointer, draft)');
  try { app._closeLeagueOverviewForTest({ immediate: true }); } catch { /* none */ }
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[T10] a reload clears drafts and keeps the pointer…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BOTH);
  useSport('nfl');
  app.state.draftPicks = { [N1]: 'NFL-open-home' }; app.state.draftTiebreaker = 44;
  const keys = Object.keys(JSON.parse(JSON.stringify([...env.store.keys()])));
  assert(![...env.store.keys()].some((k) => /draft/i.test(k)) && ![...env.store.values()].some((v) => /NFL-open-home.*draft|draftPicks/.test(v)), '[T10a] a draft is never written to the device store (in-memory only, as today)');
  const reloaded = await loadMutant('./js/app.js', []);   // a second, pristine copy of app.js = the page after a reload
  globalThis.navigateTo = app._navigateToForTest; globalThis.window.navigateTo = app._navigateToForTest;
  assert(eq(reloaded.state.draftPicks, {}) && reloaded.state.draftTiebreaker === null && reloaded.state.viewingWeekId === null, '[T10b] after the reload the draft, tiebreaker and viewed week are empty');
  assert(comp.getActiveSportKey() === 'nfl', '[T10c] ...and the sport pointer is still NFL (device-local, per user and league)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[X] a sport switch is not an identity change; the bucket is the week…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BOTH);
  const key0 = app._currentIdentityKeyForTest();
  useSport('nfl');
  assert(app._currentIdentityKeyForTest() === key0, '[X1] the identity key (account, league, member) is the same on every sport');
  useSport('cfb');
  app.state.draftPicks = { [C1]: 'A' };
  useSport('nfl'); useSport('cfb'); useSport('nfl'); useSport('cfb');
  assert(eq(app.state.draftPicks, { [C1]: 'A' }), '[X2] four switches later the draft is untouched: switching never clears anything');
  // one sport: the key is the current week, as before
  fresh({ sports: ['cfb'] });
  app.state.draftPicks = { g: 'T' };
  assert(eq(app.state.draftPicks, { g: 'T' }) && app.state.editingPicks === false, '[X3] a one-sport league: the draft accessors behave as the plain fields they replaced');
  app.state.editingPicks = true;
  app.state.draftPicks = {};
  assert(app.state.editingPicks === true, '[X4] editingPicks is its own flag (per week) and is not cleared by touching the draft');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[M] MUTATION PROOFS on in-memory copies of app.js - each must turn a NAMED check RED…');
// ═════════════════════════════════════════════════════════════════
{
  const run = async (edits) => withMutantApp(edits, async (m) => {
    const out = {};
    env.league(BOTH);
    comp.setActiveSportKey('cfb'); m.state.draftPicks = { [C1]: 'X' }; m.state.draftTiebreaker = 5;
    comp.setActiveSportKey('nfl'); m.state.draftPicks = { [N1]: 'Y' }; m.state.draftTiebreaker = 9;
    comp.setActiveSportKey('cfb');
    out['T1b'] = eq(m.state.draftPicks, { [C1]: 'X' }) && m.state.draftTiebreaker === 5;
    comp.setActiveSportKey('nfl'); m.state.viewingWeekId = 'w_nfl_1'; comp.setActiveSportKey('cfb');
    out['T3a'] = m.state.viewingWeekId === null;
    env.league(BOTH);
    comp.setActiveSportKey('cfb'); m.state.draftPicks = { [C1]: 'X' };
    comp.setActiveSportKey('nfl'); m.state.draftPicks = { [N1]: 'Y', [N2]: 'Z' };
    m._submitPicksForTest(st.getWeeks().find((w) => w.weekId === 'w_nfl_2'), st.getGames('w_nfl_2'));
    comp.setActiveSportKey('cfb');
    out['T2c'] = eq(m.state.draftPicks, { [C1]: 'X' });
    env.league(BOTH);
    comp.setActiveSportKey('cfb'); m.state.currentTab = 'picks';
    out['T5a'] = m._realtimeEventForOtherSportForTest('games', { new: { week_id: 'w_nfl_2' } }) === true;
    return out;
  });
  const ctl = await run([]);
  assert(Object.values(ctl).every(Boolean), '[M-0] POSITIVE CONTROL: an unmutated second copy of app.js passes the named checks');
  const redOn = async (label, edits, must) => {
    let res;
    try { res = await run(edits); } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 90)]: false }; }
    const failed = Object.entries(res).filter(([, ok]) => !ok).map(([n]) => n);
    assert(failed.length > 0 && must.every((m) => failed.some((f) => f.startsWith(m))), `${label} -> RED on: ${failed.join(' | ') || '(nothing - the mutant SURVIVED)'}`);
  };
  await redOn('[M-1] ONE draft bucket for every week (the old single field): CFB\'s draft is overwritten by NFL\'s', [["function _draftKey() {\n  let w = null;\n  try { w = getContextWeek(); } catch { w = null; }\n  return (w && w.weekId) ? String(w.weekId) : '_none';\n}", "function _draftKey() {\n  return '_none';\n}"]], ['T1b']);
  await redOn('[M-2] the viewed week is one shared field for every sport', [["function _viewingKey() {\n  try { return isMultiSport() ? getActiveSportKey() : '_one'; } catch { return '_one'; }\n}", "function _viewingKey() {\n  return '_one';\n}"]], ['T3a']);
  // anchor re-pinned 2026-10-08 (N3), and again on the third pass (item 1 reworded the comment that followed it): the CODE line alone, which is unique in app.js, so a comment edit cannot unseat it.
  await redOn('[M-3] a submit clears EVERY draft, not just its own week\'s', [["  clearPickDraft({ weekId: week.weekId }); state.editingPicks=false;", "  clearPickDraft(); state.editingPicks=false;"]], ['T2c']);
  await redOn('[M-4] a Realtime row for the other sport counts as this sport\'s (the predicate answers false)', [["    return !!comp && !!here && comp.id !== here.id;\n  } catch { return false; }", "    return false;\n  } catch { return false; }"]], ['T5a']);
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
