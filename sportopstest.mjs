/**
 * CFB Pickems — sportopstest.mjs (D1 / v0.30.0: the commissioner's sport operations wired into the overview; coordinator notes of 2026-10-08)
 * ============================================================================================================================================
 * `registerSportOps()` is this branch's, and the openers it calls (the Add a sport sheet, the commissioner's sport LENS) are the server branch's (`feat/d1-sports-server`: js/sport-seam.js
 * `setLensSport`, app.js `openAddSportSheet`). The glue binds to those names at call time, so the tree works alone (no commissioner rows, "never a dead stub") and the same line registers them
 * the day the branches merge. This suite drives BOTH halves with injected stand-ins, and pins the seam's reads of this branch's API by name and shape.
 *
 * Run:  node sportopstest.mjs
 *
 *   [1]  THIS TREE ALONE - only weekInCount is registered; no commissioner row is offered; the overview model has none.
 *   [2]  WITH THE SERVER BRANCH'S OPENERS - all five ops; each does exactly its one thing through the lens; a lens that refuses opens nothing; all four commissioner ops or none.
 *   [3]  "{k} of {n} in" - the week's ENTRANTS with a complete slate, counts only, nothing when any state is unknown, never a non-entrant.
 *   [4]  THE OVERVIEW - the commissioner's group shows the rows the registered ops earn, a player's never does; a tap reaches the op; Add a sport's onDone repaints.
 *   [5]  A SHEET ABOVE THE OVERVIEW (Add a sport) can be swiped away; Esc closes the sheet on top first.
 *   [6]  THE SEAM'S READS (js/sport-seam.js on feat/d1-sports-server): the exports it looks up by name, with the shapes it relies on.
 *   [7]  MUTATION PROOFS on in-memory copies of js/app.js.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeEnv, withMutantApp, els, LEAGUE } from './sportenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const env = await makeEnv();
const { app, comp, st } = env;
function fresh(opts) {
  app._clearPickDraftForTest();
  for (const k of Object.keys(app._viewingBySportForTest)) delete app._viewingBySportForTest[k];
  try { app._closeLeagueOverviewForTest({ immediate: true }); } catch { /* none open */ }
  app._resetSportOpsForTest();
  return env.league(opts);
}
const BASE = { sports: ['cfb', 'nfl'], viewer: 'p1', isAdmin: true, plays: { nfl: ['p1', 'p3'] } };
const model = () => app._buildLeagueOverviewModelForTest();

// ═════════════════════════════════════════════════════════════════
console.log('\n[1] the built-in registration (re-derived 2026-10-08: the merged tree has the openers)…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BASE);
  const ops = app._registerBuiltInSportOpsForTest();
  assert(typeof ops.weekInCount === 'function', '[1a] weekInCount is registered');
  // RE-DERIVED 2026-10-08 (feat/d1-sports = client + server). OLD [1b]: "with no server-branch opener there is no Add a sport, Manage, Sport entries, Set up week row to offer" - every one null. The openers
  // (openAddSportSheet, the lens' setLensSport) exist in the merged tree, so the built-in registration now installs the four commissioner ops; only Game Day stays null (Lane B's, merges after).
  // (2026-10-08, D1 Lane B Game Day consolidated round: Lane B's Game Day landed — openGameDay is registered by buildSportOps itself, so the overview's "{n} live now" chip opens it.)
  assert(['addSport', 'manageSport', 'sportEntries', 'setupWeek', 'openGameDay'].every((k) => typeof ops[k] === 'function'), '[1b] the openers exist in the merged tree: Add a sport, Manage, Sport entries, Set up week AND Game Day are registered');
  const m = model();
  // OLD [1c]: "the commissioner's overview group is EMPTY, not a set of dead rows". NEW: it holds the rows the registered ops earn - one Manage row per live sport and Sport entries - and every row is a real op.
  assert(m.isCommissioner === true && m.commissioner.some((r) => r.action === 'comm-manage' && r.dbCode === 'nfl') && m.commissioner.some((r) => r.action === 'comm-manage' && r.dbCode === 'cfb') && m.commissioner.some((r) => r.action === 'comm-entries'), '[1c] the commissioner\'s overview group holds a Manage row per live sport and Sport entries (the rows the registered ops earn), not an empty group');
  const built = app.buildSportOps({});
  assert(Object.keys(built).join() === 'weekInCount,openGameDay', '[1d] buildSportOps() with no openers returns weekInCount and Game Day\'s opener (no commissioner op)');
  assert(Object.keys(app.buildSportOps({ openAddSportSheet: () => {} })).join() === 'weekInCount,openGameDay' && Object.keys(app.buildSportOps({ setLensSport: () => true })).join() === 'weekInCount,openGameDay', '[1e] ...and with only ONE of the two server pieces too (the four commissioner ops are registered together or not at all)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[2] with the server branch\'s openers…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BASE);
  const calls = [];
  const lensCalls = [];
  const ops = app.buildSportOps({ openAddSportSheet: (o) => calls.push(['add', typeof o.onDone]), setLensSport: (code) => { lensCalls.push(code); return true; } });
  assert(['weekInCount', 'addSport', 'manageSport', 'sportEntries', 'setupWeek'].every((k) => typeof ops[k] === 'function'), '[2a] all five ops exist');
  ops.addSport({ source: 'overview' });
  assert(eq(calls, [['add', 'function']]), '[2b] addSport opens the server branch\'s sheet and hands it an onDone');
  app.state.currentTab = 'home';
  ops.manageSport('nfl');
  assert(eq(lensCalls, ['nfl']) && app.state.commTab === 'week' && app.state.currentTab === 'commissioner', `[2c] manageSport moves the LENS to that sport and opens Comm -> Week (lens ${JSON.stringify(lensCalls)}, tab ${app.state.currentTab}/${app.state.commTab})`);
  // RE-DERIVED 2026-10-08 (merge). OLD label: "...and does NOT touch the player's sport pointer (the lens is the commissioner's own state)". With the lens stand-in injected here that is still all that
  // can be said of manageSport ITSELF - it asks the lens to move and never writes the pointer; moving the pointer is the REAL lens' job, whose rule (the pointer moves whenever it accepts) is [6i]-[6l].
  assert(comp.getActiveSportKey() === 'cfb', '[2d] ...and manageSport itself never writes the player\'s pointer (only the lens it asks may, [6i]-[6l])');
  lensCalls.length = 0; app.state.currentTab = 'home';
  ops.sportEntries();
  assert(eq(lensCalls, ['nfl']) && app.state.commTab === 'players' && app.state.currentTab === 'commissioner', '[2e] sportEntries moves the lens to the sport members opt in to (NFL) and opens Comm -> Players');
  fresh({ ...BASE, plays: {} });
  lensCalls.length = 0; app.state.currentTab = 'home';
  app.buildSportOps({ openAddSportSheet: () => {}, setLensSport: (c) => { lensCalls.push(c); return true; } }).sportEntries();
  assert(lensCalls.length === 0 && app.state.commTab === 'players', '[2f] with no opt-in sport the lens stays where it is and Players still opens');
  fresh(BASE);
  const wrapsBefore = env.bodyChildren.length;
  lensCalls.length = 0;
  app.buildSportOps({ openAddSportSheet: () => {}, setLensSport: (c) => { lensCalls.push(c); return true; } }).setupWeek('nfl');
  assert(eq(lensCalls, ['nfl']) && env.bodyChildren.length > wrapsBefore && env.bodyChildren.some((el) => el.id === 'week-wizard-sheet-wrap'), '[2g] setupWeek moves the lens to that sport and opens the week wizard in create mode');
  try { document.getElementById('week-wizard-sheet-wrap')?.remove(); els.delete('week-wizard-sheet-wrap'); } catch { /* fixture hygiene */ }
  // a lens that refuses, or throws, opens nothing
  fresh(BASE);
  app.state.currentTab = 'home';
  const refusing = app.buildSportOps({ openAddSportSheet: () => {}, setLensSport: () => false });
  refusing.manageSport('nhl'); refusing.setupWeek('nhl');
  assert(app.state.currentTab === 'home' && !env.bodyChildren.some((el) => el.id === 'week-wizard-sheet-wrap'), '[2h] a lens that REFUSES the sport (returns false) opens nothing - no Comm tab, no wizard');
  const throwing = app.buildSportOps({ openAddSportSheet: () => {}, setLensSport: () => { throw new Error('boom'); } });
  let threw = false;
  const realWarn = console.warn; console.warn = () => {};
  try { throwing.manageSport('nfl'); throwing.sportEntries(); throwing.setupWeek('nfl'); } catch { threw = true; }
  console.warn = realWarn;
  assert(!threw && app.state.currentTab === 'home', '[2i] a lens that THROWS is caught, said in the console, and opens nothing');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[3] "{k} of {n} in"…');
// ═════════════════════════════════════════════════════════════════
{
  const nflWeek = () => st.getWeeks().find((w) => w.weekId === 'w_nfl_2');
  const cfbWeek = () => st.getWeeks().find((w) => w.weekId === 'w_cfb_2');
  fresh({ ...BASE, submitted: ['p1'] });
  assert(app.sportWeekInCountText(nflWeek()) === '1 of 2 in', '[3a] NFL (entrants p1, p3), p1 submitted: "1 of 2 in"');
  assert(app.sportWeekInCountText(cfbWeek()) === '1 of 4 in', '[3b] CFB (enrolls everyone): "1 of 4 in" - each sport counts its own entrants');
  fresh({ ...BASE, submitted: ['p1', 'p3'] });
  assert(app.sportWeekInCountText(nflWeek()) === '2 of 2 in', '[3c] both entrants in: "2 of 2 in"');
  fresh({ ...BASE, submitted: [] });
  assert(app.sportWeekInCountText(nflWeek()) === '0 of 2 in', '[3d] nobody yet: "0 of 2 in" (a true zero, not a blank)');
  // a stray pick row by a non-entrant does not count
  fresh({ ...BASE, submitted: ['p1'] });
  st.saveAllPicks(st.getGames('w_nfl_2').map((g) => ({ pickId: `stray_${g.gameId}`, weekId: 'w_nfl_2', gameId: g.gameId, playerId: 'p2', selectedTeam: g.homeTeam, submittedAt: 'x' })));
  assert(app.sportWeekInCountText(nflWeek()) === '1 of 2 in', '[3e] a stray complete slate by a member who is not in the NFL changes neither k nor n');
  assert(app.sportWeekInCountText(null) === '' && app.sportWeekInCountText({}) === '' && app.sportWeekInCountText({ weekId: 'w_ghost' }) === '', '[3f] no week, an empty week and an unknown week say nothing');
  const out = app.sportWeekInCountText(nflWeek());
  assert(!/Drew|Kevin|Brayden|Koby|p1|p3/.test(out) && /^\d+ of \d+ in$/.test(out), '[3g] it is counts only: no name, no id');
  // the overview card carries it for a sport the viewer plays
  fresh({ ...BASE, submitted: ['p1'] });
  app._registerBuiltInSportOpsForTest();
  const m = model();
  const nfl = m.played.find((c) => c.dbCode === 'nfl');
  assert(nfl && JSON.stringify(nfl.view).includes('1 of 2 in'), '[3h] the NFL card in the overview says "1 of 2 in"');
  fresh({ ...BASE, viewer: 'p2', submitted: ['p1'] });
  app._registerBuiltInSportOpsForTest();
  const other = model().other.find((c) => c.dbCode === 'nfl');
  assert(other && !JSON.stringify(other.view).includes(' of 2 in'), '[3i] a sport the viewer has NOT joined shows no count (it owes nothing, DI-555)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4] the overview…');
// ═════════════════════════════════════════════════════════════════
{
  const authMod = await import('./js/auth.js');
  authMod._setOfferedSportsForTest(['cfb', 'nfl']);
  fresh(BASE);
  const added = [];
  app.registerSportOps(app.buildSportOps({ openAddSportSheet: (o) => added.push(o), setLensSport: () => true }));
  const m = model();
  const actions = m.commissioner.map((r) => r.action);
  // RE-DERIVED 2026-10-08 (Part 2 item 4, DI-554). OLD [4a]: "the commissioner's group offers Add a sport, Manage per sport (2) and Sport entries" in a league that ALREADY runs both offered sports - a row whose sheet
  // would open nothing ("nothing left to add: no sheet, never a dead one"). NEW: it offers Manage per sport (2) and Sport entries, and NO Add a sport while nothing is left to add.
  assert(!actions.includes('comm-add-sport') && actions.filter((a) => a === 'comm-manage').length === 2 && actions.includes('comm-entries'), `[4a] a league that runs every offered sport: Manage per sport (2) and Sport entries, and NO dead Add a sport row (${actions.join(', ')})`);
  fresh({ ...BASE, sports: ['cfb'] });
  app.registerSportOps(app.buildSportOps({ openAddSportSheet: (o) => added.push(o), setLensSport: () => true }));
  const rowOne = model().commissioner.find((r) => r.action === 'comm-add-sport');
  assert(rowOne && rowOne.title === 'Add a sport' && rowOne.subtitle === 'NFL is available for this league', `[4a2] a one-sport league with the NFL offered: the Add a sport row is real and its subtitle comes from the options ("${rowOne && rowOne.subtitle}")`);
  authMod._setOfferedSportsForTest([]);
  fresh({ ...BASE, sports: ['cfb'] });
  app.registerSportOps(app.buildSportOps({ openAddSportSheet: (o) => added.push(o), setLensSport: () => true }));
  assert(!model().commissioner.some((r) => r.action === 'comm-add-sport'), '[4a3] ...and with nothing offered by the platform the row is absent (a registered opener alone is not enough)');
  authMod._setOfferedSportsForTest(['cfb', 'nfl']);
  fresh(BASE);
  app.registerSportOps(app.buildSportOps({ openAddSportSheet: (o) => added.push(o), setLensSport: () => true }));
  fresh({ ...BASE, isAdmin: false });
  app.registerSportOps(app.buildSportOps({ openAddSportSheet: () => {}, setLensSport: () => true }));
  assert(eq(model().commissioner, []), '[4b] a PLAYER\'s overview never has a commissioner row, whatever is registered');
  // a tap
  fresh(BASE);
  app.registerSportOps(app.buildSportOps({ openAddSportSheet: (o) => added.push(o), setLensSport: () => true }));
  added.length = 0;
  app._openLeagueOverviewForTest();
  const wrap = els.get('league-overview-sheet-wrap');
  const row = { disabled: false, getAttribute: (k) => ({ 'data-lo-action': 'comm-add-sport', 'data-sport': '' })[k] ?? null };
  wrap._fire('click', { target: { closest: () => row } });
  assert(added.length === 1 && typeof added[0].onDone === 'function', '[4c] tapping Add a sport reaches the opener, with an onDone');
  assert(app._leagueOverviewStateForTest() !== null, '[4d] ...and the overview STAYS (the sheet opens above it)');
  // onDone repaints: add a competition behind the opener's back, then call onDone
  const before = JSON.stringify(model().played.map((c) => c.dbCode));
  const comps = st.getCompetitions();
  const hockey = { id: '33333333-3333-4333-8333-333333333333', sport: 'nhl', kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-10-01T00:00:00.000Z' };
  localStorage.setItem('cfbp_competitions', JSON.stringify([...comps, hockey]));
  let threw = false;
  try { added[0].onDone(); } catch { threw = true; }
  assert(!threw && JSON.stringify(model().played.map((c) => c.dbCode)) !== before, '[4e] onDone runs without throwing while the league has just gained a third sport (the overview model sees it)');
  try { app._closeLeagueOverviewForTest({ immediate: true }); } catch { /* none */ }
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4x] the DRAFT week keeps its own number (Part 2 item 3, 2026-10-08)…');
// ═════════════════════════════════════════════════════════════════
// `nextWeekN` was always "the highest week number + 1". When the sport's CURRENT week is a draft (Week 2 exists, not published) that read "publishes Week 3" in the member's copy and "Set up Week 3" on the
// commissioner's Manage row - one more than the draft the commissioner is about to publish, while the card's own aria-label said "NFL, Week 2".
{
  const m1 = (() => { fresh({ ...BASE, viewer: 'p2', isAdmin: false, plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'open', nfl: 'draft' } }); return model(); })();
  const joinCard = m1.other.find((c) => c.dbCode === 'nfl');
  assert(joinCard && joinCard.view.line === 'Picks open when the commissioner publishes Week 2.' && /Week 2,/.test(joinCard.view.ariaLabel), `[4x-a] a member who has not joined the NFL, NFL Week 2 in draft: "...publishes Week 2." - the draft's own number, matching the card's name (got "${joinCard && joinCard.view.line}")`);
  app._registerBuiltInSportOpsForTest();
  const m2 = (() => { fresh({ ...BASE, weekStatus: { cfb: 'open', nfl: 'draft' } }); app._registerBuiltInSportOpsForTest(); return model(); })();
  const manageNfl = m2.commissioner.find((r) => r.action === 'comm-manage' && r.dbCode === 'nfl');
  assert(manageNfl && /^Set up Week 2 /.test(manageNfl.subtitle), `[4x-b] the commissioner's Manage row for an NFL week in draft: "Set up Week 2" (got "${manageNfl && manageNfl.subtitle}")`);
  const m3 = (() => { fresh({ ...BASE, weekStatus: { cfb: 'open', nfl: 'final' } }); app._registerBuiltInSportOpsForTest(); return model(); })();
  const manageFinal = m3.commissioner.find((r) => r.action === 'comm-manage' && r.dbCode === 'nfl');
  assert(manageFinal && /^Set up Week 3 /.test(manageFinal.subtitle), `[4x-c] ...and when the current week is FINAL the next week really is the next number: "Set up Week 3" (got "${manageFinal && manageFinal.subtitle}")`);
  const m4 = (() => { fresh({ ...BASE, viewer: 'p2', isAdmin: false, plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'open', nfl: 'final' } }); return model(); })();
  const joinFinal = m4.other.find((c) => c.dbCode === 'nfl');
  assert(joinFinal && !/Week 2\./.test(joinFinal.view.line), '[4x-d] ...and the member copy on a FINAL week does not borrow the finished week\'s number as the next one');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4y] At a glance: one chip per due sport, in a one-sport league too (Part 2 item 7, D-60 mockup)…');
// ═════════════════════════════════════════════════════════════════
{
  const m1 = (() => { fresh({ sports: ['cfb'], viewer: 'p1', submitted: [] }); return model(); })();
  assert(m1.glance.filter((c) => c.kind === 'due').length === 1 && /^Picks due · CFB · in /.test(m1.glance.find((c) => c.kind === 'due').text), `[4y-a] a ONE-sport league with picks due: the At a glance chip is there ("${(m1.glance[0] || {}).text}")`);
  const m2 = (() => { fresh({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, submitted: [] }); return model(); })();
  const due2 = m2.glance.filter((c) => c.kind === 'due');
  assert(due2.length === 2 && new Set(due2.map((c) => c.dbCode)).size === 2, `[4y-b] two sports, picks due in both: ONE chip per sport (${due2.map((c) => c.text).join(' | ')})`);
  const m3 = (() => { fresh({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, submitted: ['p1'] }); return model(); })();
  assert(m3.glance.filter((c) => c.kind === 'due').length === 0, '[4y-c] ...and a submitted sport earns none');
  const m4 = (() => { fresh({ sports: ['cfb'], viewer: 'p1', submitted: ['p1'] }); return model(); })();
  assert(m4.glance.filter((c) => c.kind === 'due').length === 0, '[4y-d] a one-sport league whose picks are in: no chip');
  // the pill's dot and the switcher stay multi-sport features: a one-sport league's pill is unchanged
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/const due = isMultiSport\(\) \? sportDueItems\(\) : \[\];/.test(src), '[4y-e] the league pill still computes its due dot only in a several-sport league (a one-sport pill is exactly what it was)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[5] a sheet above the overview…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BASE);
  app._openLeagueOverviewForTest();
  assert(app._dismissBlockingSurfaceUpForTest() === true, '[5a] the overview blocks the swipe of anything else that asks');
  assert(app._isLeagueOverviewDismissGestureBlockedForTest() === false && app._dismissBlockingSurfaceUpForTest() === true, '[5b] ...but not its own swipe-down (and the flag does not stick: the next outside ask is blocked again)');
  els.set('add-sport-sheet-wrap', { id: 'add-sport-sheet-wrap' });
  assert(app._dismissBlockingSurfaceUpForTest() === false, '[5c] with Add a sport open ABOVE it, the overview no longer blocks Add a sport\'s own swipe-down (the server branch asks with no exclusion)');
  els.delete('add-sport-sheet-wrap');
  assert(app._dismissBlockingSurfaceUpForTest() === true, '[5d] and the moment that sheet is gone the overview blocks again');
  const src = (await read('./js/app.js')).replace(/\/\*[\s\S]*?\*\//g, '');
  assert(/lo\.onKey = \(e\) => \{ if \(e\.key === 'Escape' && !overviewChildSheetUp\(\)\) closeLeagueOverview\(\); \};/.test(src), '[5e] [structural] Esc closes the overview only when no child sheet is above it (the sheet on top takes Esc first)');
  try { app._closeLeagueOverviewForTest({ immediate: true }); } catch { /* none */ }
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[6] the seam\'s reads…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BASE);
  const week = st.getWeeks().find((w) => w.weekId === 'w_nfl_2');
  assert(['playersForWeek', 'isMultiSport', 'getActiveSportKey', 'setActiveSportKey', 'getCompetitions', 'getCurrentWeekFor'].every((n) => typeof comp[n] === 'function'), '[6a] competition.js exports every name sport-seam.js looks up');
  const roster = comp.playersForWeek(week);
  assert(Array.isArray(roster) && eq(roster.map((p) => p.playerId), ['p1', 'p3']), '[6b] playersForWeek(week) is an ARRAY of the stored player objects (the NFL week\'s entrants)');
  assert(comp.isMultiSport() === true && typeof comp.getActiveSportKey() === 'string' && comp.setActiveSportKey('nfl') === true && comp.getActiveSportKey() === 'nfl', '[6c] isMultiSport() is a boolean; getActiveSportKey() a dbCode string; setActiveSportKey(dbCode) true when it moved the pointer');
  comp.setActiveSportKey('cfb');
  fresh({ ...BASE, viewer: 'p2' });
  assert(comp.setActiveSportKey('nfl') === false && comp.getActiveSportKey() === 'cfb', '[6d] a sport the viewer does not play is REFUSED (false) and the pointer does not move - the seam keeps its own lens for that (the commissioner\'s)');
  fresh(BASE);
  const cm = st.getCompetitionMembers();
  assert(Array.isArray(cm) && cm.length === 2 && cm.every((r) => r.competitionId && r.memberId && 'enrolledBy' in r && 'joinedAt' in r), '[6e] getCompetitionMembers() is an array of { competitionId, memberId, enrolledBy, joinedAt, ... } rows');
  const nflId = comp.getCompetitions().find((c) => c.sport === 'nfl').id;
  assert(st.addCompetitionMember({ competitionId: nflId, memberId: 'p2', enrolledBy: 'commissioner' }) !== false && st.getCompetitionMembers().length === 3, '[6f] addCompetitionMember({competitionId, memberId, enrolledBy}) adds a row (not false)');
  assert(st.addCompetitionMember({ competitionId: nflId, memberId: 'p2', enrolledBy: 'commissioner' }) === false, '[6g] ...and answers false for a row that already exists (the seam\'s addEntry reports that)');
  assert(st.removeCompetitionMember({ competitionId: nflId, memberId: 'p2' }) === true && st.getCompetitionMembers().length === 2 && st.removeCompetitionMember({ competitionId: nflId, memberId: 'p2' }) === false, '[6h] removeCompetitionMember({competitionId, memberId}) is true when a row went, false otherwise');
  // ── THE LENS AND THE POINTER, through the REAL competition.js (DI-534; coordinator ruling 2026-10-08) ──
  // The pointer moves with the lens whenever setActiveSportKey ACCEPTS the sport; the lens keeps a separate local choice ONLY when it refuses (the commissioner has not joined that sport, C7).
  const seam = await import('./js/sport-seam.js');
  fresh(BASE); seam.resetLensSport();   // the commissioner (p1) is entered in the NFL
  assert(seam.setLensSport('nfl') === true && comp.getActiveSportKey() === 'nfl' && seam.getLensSport() === 'nfl', '[6i] DI-534: the commissioner plays the NFL - setLensSport(\'nfl\') moves the POINTER too, and the lens reads it back: they agree');
  comp.setActiveSportKey('cfb');
  assert(seam.getLensSport() === 'cfb', '[6j] ...and because no separate local lens was kept, the lens FOLLOWS the pointer when something else moves it: they agree whenever they can');
  fresh({ ...BASE, plays: { nfl: ['p3'] } }); seam.resetLensSport();   // the commissioner is NOT entered in the NFL (p3 is)
  assert(seam.setLensSport('nfl') === true && comp.getActiveSportKey() === 'cfb' && seam.getLensSport() === 'nfl', '[6k] DI-534 / B1: the commissioner has NOT joined the NFL - the pointer refuses and stays on CFB, and the lens keeps its OWN choice (NFL), so he can still run it from Comm');
  comp.setActiveSportKey('cfb');
  assert(seam.getLensSport() === 'nfl' && seam.lensCompetition().sport === 'nfl', '[6l] ...and that local choice survives the pointer being set again (C7: the pointer can never carry him onto a sport he has not joined)');
  seam.resetLensSport();
  assert(seam.getLensSport() === 'cfb', '[6m] resetLensSport() (an account or league switch, DI-538) forgets the local choice');
  seam.resetLensSport();
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[7] MUTATION PROOFS on in-memory copies of js/app.js…');
// ═════════════════════════════════════════════════════════════════
{
  const run = async (edits) => withMutantApp(edits, async (m) => {
    const out = {};
    fresh({ ...BASE, submitted: ['p1'] });
    out['3a a count over the ENTRANTS'] = m.sportWeekInCountText(st.getWeeks().find((w) => w.weekId === 'w_nfl_2')) === '1 of 2 in';
    out['3e a non-entrant does not count'] = (() => {
      st.saveAllPicks(st.getGames('w_nfl_2').map((g) => ({ pickId: `s_${g.gameId}`, weekId: 'w_nfl_2', gameId: g.gameId, playerId: 'p2', selectedTeam: g.homeTeam, submittedAt: 'x' })));
      return m.sportWeekInCountText(st.getWeeks().find((w) => w.weekId === 'w_nfl_2')) === '1 of 2 in';
    })();
    fresh(BASE);
    m._openLeagueOverviewForTest();
    els.set('add-sport-sheet-wrap', { id: 'add-sport-sheet-wrap' });
    out['5c the sheet above is swipeable'] = m._dismissBlockingSurfaceUpForTest() === false;
    els.delete('add-sport-sheet-wrap');
    try { m._closeLeagueOverviewForTest({ immediate: true }); } catch { /* none */ }
    const alone = m.buildSportOps({ openAddSportSheet: () => {} });
    out['1e the commissioner ops are all-or-none'] = Object.keys(alone).join() === 'weekInCount,openGameDay';   // (Game Day's opener is not a commissioner op: always there since the Lane B merge)
    return out;
  });
  const ctl = await run([]);
  assert(Object.values(ctl).every(Boolean), `[7-0] POSITIVE CONTROL: an unmutated second copy passes every named check (${Object.entries(ctl).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all green'})`);
  const redOn = async (label, edits, must) => {
    let res;
    try { res = await run(edits); } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 90)]: false }; }
    const failed = Object.entries(res).filter(([, ok]) => !ok).map(([n]) => n);
    assert(failed.length > 0 && must.every((m) => failed.some((f) => f.startsWith(m))), `${label} -> RED on: ${failed.join(' | ') || '(nothing - the mutant SURVIVED)'}`);
  };
  await redOn('[7-1] the sheet above the overview is NOT exempt (the integration risk the server review named)', [["document.getElementById('league-overview-sheet-wrap') && !overviewChildSheetUp()) return true;", "document.getElementById('league-overview-sheet-wrap')) return true;"]], ['5c']);
  await redOn('[7-2] the count is over the ACTIVE ROSTER, not the week\'s entrants (anchor re-pinned 2026-10-08: the count now goes through the one inCountOf rule)', [['    return inCountText(inCountOf(playersForWeek(week), ', '    return inCountText(inCountOf(getPlayers().filter((p) => p && p.active), ']], ['3a', '3e']);
  await redOn('[7-3] Add a sport is registered with only one of the two server pieces', [["  if (typeof openAdd !== 'function' || typeof setLens !== 'function') return ops;", "  if (typeof openAdd !== 'function') return ops;"]], ['1e']);
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
