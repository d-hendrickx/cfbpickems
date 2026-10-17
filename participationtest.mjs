/**
 * CFB Pickems — participationtest.mjs (D1 / v0.30.0, DI-531 client half; security A3 "a non-entrant counts for nothing", C4 "entrants only via playersForWeek / playersForCompetition", C1 "a late joiner")
 * ================================================================================================================================================================================================
 * Who is in a sport is decided in ONE place (js/competition.js playersForCompetition / playersForWeek). This suite proves every consumer asks it:
 *
 *   [1]  THE SCAN - every `.filter(p => p.active)` / `p && p.active` over a roster in js/*.js is either the definition, a one-sport branch, a league-wide list (with the reason), or another branch's
 *        named piece (with the owner). A NEW one fails until it is classified; a removed one fails (a dead entry is as loud as a new gate). Canaries prove the scanner sees each spelling.
 *   [2]  A3 TWIN - a pick row by a member who never joined a sport changes NO total, rank, result, obligation, summary, reveal post or count of that sport: runtime, through the real finalize.
 *   [3]  THE LATE JOINER (C1) - a member who joined AT or AFTER the lock is not required, not in the results, not "missing", not able to pick that week - and counts from the next.
 *   [4]  THE SURFACES - the digest, the "N of M" lock notice, the reveal post, the tiebreaker list, the finalize steps name the week's own sport's entrants only.
 *   [5]  MUTATION PROOFS on in-memory copies of js/app.js and js/chat-ui.js.
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeEnv, withMutantApp, loadMutant, els } from './sportenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const readJs = (name) => readFile(new URL(`./js/${name}`, import.meta.url), 'utf8');

// ═════════════════════════════════════════════════════════════════
console.log('\n[1] THE SCAN - nothing outside competition.js decides who is in a sport…');
// ═════════════════════════════════════════════════════════════════
const blank = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"\\/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
const PAT = /\.filter\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\1\s*(?:&&\s*\1\.active\b|\.active\b)/g;
/** [{ fn }] for every active-roster filter in the source, with the nearest enclosing top-level function name. */
export function rosterFilters(src) {
  const code = blank(src);
  const lines = code.split('\n');
  const out = [];
  let m;
  PAT.lastIndex = 0;
  while ((m = PAT.exec(code))) {
    const line = code.slice(0, m.index).split('\n').length;
    let fn = '(top level)';
    for (let i = line - 1; i >= 0; i--) { const mm = lines[i].match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/); if (mm) { fn = mm[1]; break; } }
    out.push({ fn });
  }
  return out;
}
const LW = 'league-wide: a list of the league\'s MEMBERS (not a sport\'s players)';
const ONE = 'the one-sport branch of `scoped ? playersForCompetition(...) : ...` (a one-sport league: every active player, as today)';
// file -> function -> [count, reason]
const ALLOWED = {
  'app.js': {
    seasonStandingsRows: [1, ONE], weeklyHistoryInputs: [1, ONE], exportExtraPointCSV: [1, ONE],
    renderExtraPointLedgerHTML: [1, 'the Dashboard players line (scanner attributes it to the preceding function): ' + ONE],
    renderWagerModalBodyHTML: [1, LW + ' - wagers are between members'], renderLoginScreen: [1, LW + ' - the identity picker'],
    claimedAlmaMaters: [1, LW + ' - alma-mater claims are member data'], almaByPlayerNow: [1, LW + ' - alma-mater claims are member data'], almaMaterClaimants: [1, LW + ' - alma-mater claims are member data'],
    reorderPlayerColumn: [1, 'the viewer\'s own saved column order, one list across sports'],
    renderCommPage: [3, LW + ' - the commissioner\'s member counts, e-mail recipients and Players table'], bindAdminScribeToolsControls: [1, LW + ' - the SCRIBE tools picker'],
    bindCommEventListeners: [2, LW + ' - e-mail recipients'], linkStatusCardHTML: [1, LW], leagueMembersCardHTML: [1, LW], buildLeagueOverviewModel: [1, LW + ' - "{n} members" in the overview header'],
    renderTiebreakerGuessesAdmin: [1, 'a caller-supplied list INTERSECTED with playersForWeek(week) in the same expression'],
    // 2026-10-08 (merge): `finalizeTiebreakerGuessCount` is OFF this list - it was a `playersForWeek(week).filter(p => p.active && ...)` (the client's belt); the surviving server form filters
    // playersForWeek(week) on the guess alone (already the week's active entrants), so it holds no roster filter for the scanner to find. Its wiring is pinned by finalizeentrantstest [4b]/[3].
    finalizeReviewFor: [1, LW + ' - the review card\'s "of {n}" denominator is the league\'s active MEMBERS (entrants come from playersForWeek in the line above; finalizeentrantstest [3a])'],
    bindCommSportEntries: [1, LW + ' - "Enter everyone" enrolls each active member of the league (member data; the entry rows then decide who is in the sport)'],
    renderScribeReminderControlsHTML: [1, 'reminders: DI-537, the server branch\'s (feat/d1-sports-server counts the week\'s entrants there)'],
  },
  // 2026-10-08 (merge of the sports client with the server work and the int Home/card-detail work). Classified, with the reason and the owner:
  'card-detail.js': { viewThrough: [1, 'the one-sport default; in a several-sport league the result is narrowed in the same function to the week\'s competition entrants (the contexts\' playerIds, playersForCompetition), and its weeks and picks to that competition (Lane B Game Day round, 2026-10-08; pinned in gamedaytest [18])'] },
  'multisport-admin.js': { sportEntriesModel: [1, LW + ' - the Sport entries card lists every member with In / Not in'] },
  'scribe-profile-rules.js': { buildProfileView: [1, LW + ' - the SCRIBE profile view summarizes league members, not a sport\'s roster'] },
  'chat-ui.js': { mentionCandidates: [1, LW + ' - @mentions'], standingsCtx: [1, 'returns null (dead read): no standings are derived here'] },
  'competition.js': { playersForCompetition: [1, 'THE DEFINITION of who is in a sport'], playersForWeek: [1, 'THE DEFINITION (a missing week: every active player)'] },
  'data-model.js': { almaMaterPlayersForTeam: [1, 'filters a caller-supplied list'] },
  'extra-point.js': { seasonExtraPointTally: [1, 'filters a caller-supplied list (the caller scopes it)'] },
  'feed-cards.js': { deriveCards: [1, 'filters the snapshot\'s players, which home-sports.js hands in as the sport\'s ENTRANTS'] },
  'home.js': {
    submissionCountsFor: [2, 'the one-sport default (`activeAll`) and the rosterFor() result, a week\'s entrants'], assembleHomeSnapshot: [1, 'the alma-claim roster for tie contexts (league-wide member data)'],
    viewerStatsFor: [1, 'the one-sport default; in a several-sport league "Season Nth of N" ranks among each competition\'s entrants (the contexts\' playerIds, playersForCompetition), narrowed in the same function (Lane B Game Day round, 2026-10-08; gamedaytest [18])'],
  },
  'notifications.js': { _activePlayers: [1, 'reminders: DI-537, the server branch\'s'] },
  'recap.js': { buildWeekStorylines: [1, 'display names of players in a stored result set'], renderSeasonSummaryHTML: [1, 'display names for the prior-season standings, whose weeks are now the viewed week\'s own sport\'s'] },
  'reminder-rules.js': { computeReminderPlan: [1, 'reminders: DI-537, the server branch\'s'] },
  'scribeLines.js': { detectWeekSignals: [1, 'SCRIBE\'s missing-picks callout: W-34, Lane C'] },
};
{
  const files = (await readdir(new URL('./js/', import.meta.url))).filter((f) => f.endsWith('.js')).sort();
  const found = {};
  for (const f of files) {
    const hits = rosterFilters(await readJs(f));
    for (const h of hits) { found[f] = found[f] || {}; found[f][h.fn] = (found[f][h.fn] || 0) + 1; }
  }
  const unclassified = [], wrongCount = [];
  for (const [f, fns] of Object.entries(found)) for (const [fn, n] of Object.entries(fns)) {
    const a = ALLOWED[f] && ALLOWED[f][fn];
    if (!a) unclassified.push(`${f}::${fn} x${n}`); else if (a[0] !== n) wrongCount.push(`${f}::${fn} found ${n}, listed ${a[0]}`);
  }
  assert(unclassified.length === 0, `[1a] every active-roster filter in js/*.js is classified (unclassified: ${unclassified.join(' | ') || 'none'}) - a new one must use playersForWeek / playersForCompetition, or be added with its reason`);
  assert(wrongCount.length === 0, `[1b] ...and the counts match (${wrongCount.join(' | ') || 'none'})`);
  const dead = [];
  for (const [f, fns] of Object.entries(ALLOWED)) for (const fn of Object.keys(fns)) if (!(found[f] && found[f][fn])) dead.push(`${f}::${fn}`);
  assert(dead.length === 0, `[1c] ...and no entry is dead (${dead.join(' | ') || 'none'}): a converted consumer comes off the list`);
  assert(Object.values(ALLOWED).every((fns) => Object.values(fns).every(([, why]) => typeof why === 'string' && why.length > 15)), '[1d] ...each entry says why it is not a sport\'s roster');
  // the consumers DI-531 names are NOT on the list: they call the one function
  const app = await readJs('app.js');
  // RE-DERIVED 2026-10-08 (Part 2 item 2): 'fireScribeWeekSignals' becomes 'signalInputsForWeek' - the entrants moved into the helper that also scopes the games, picks and weeks to the week's sport; fireScribeWeekSignals must CALL it (below).
  const NAMED = ['finalizeWeek', 'exportWeekPicksCSV', 'exportWeekResultsCSV', 'exportWeekDashboardCSV', 'buildWeeklySummary', 'postPicksLockedNotice', 'signalInputsForWeek', 'renderFinalizeStep3HTML', 'renderFinalizeStep4HTML', 'finalizeReviewFor', 'supabaseProgressUnknownNoteHTML'];
  const body = (name) => { const a = app.indexOf(`function ${name}(`); return a < 0 ? '' : app.slice(a, app.indexOf('\n}\n', a)); };
  const missing = NAMED.filter((n) => !/\bplayersForWeek\(week\)/.test(body(n)));
  assert(missing.length === 0 && /\.\.\.signalInputsForWeek\(week\)/.test(body('fireScribeWeekSignals')), `[1e] each named week-scoped consumer reads playersForWeek(week), and fireScribeWeekSignals reads its inputs through signalInputsForWeek(week) (missing: ${missing.join(', ') || 'none'})`);
  assert(/playersForWeek\(week\)/.test(body('emitPickRevealEvent') || (await readJs('chat-ui.js')).slice((await readJs('chat-ui.js')).indexOf('function emitPickRevealEvent('), (await readJs('chat-ui.js')).indexOf('function emitPickRevealEvent(') + 1500)), '[1f] the reveal post (chat-ui.js emitPickRevealEvent) reads playersForWeek(week)');
  assert(/scoreSummaryRowsHTML: \(week\) => \{[\s\S]{0,900}const players = playersForWeek\(week\), picks = picksOfRoster\(getPicks\(week\.weekId\), players\)/.test(app) && !/scoreSummaryRowsHTML: \(week\) => \{[\s\S]{0,900}getPlayers\(\)\.filter/.test(app),
    '[1j] ADDED 2026-10-08 (merge): the card detail\'s score-summary rows (app.js detailContext.scoreSummaryRowsHTML, Lane B\'s int code) rank the week\'s ENTRANTS and their rows only - it used to filter the league\'s active roster, which would have ranked a non-entrant on an NFL week\'s detail');
  // canaries
  assert(rosterFilters('function f(){ return getPlayers().filter(p => p.active); }').length === 1 && rosterFilters('function f(){ return players.filter(p=>p&&p.active); }').length === 1 && rosterFilters('function f(){ return getPlayers().filter((p) => p && p.active).length; }').length === 1 && rosterFilters('function f(){ return xs.filter(q=>q.active&&q.email); }').length === 1,
    '[1g] canary: the scanner sees `p => p.active`, `p=>p&&p.active`, `(p) => p && p.active` and `q=>q.active&&q.email`');
  assert(rosterFilters('function f(){ return getPlayers().filter(p => p.display); }').length === 0 && rosterFilters('// getPlayers().filter(p => p.active)\nfunction f(){}').length === 0 && rosterFilters('function f(){ return playersForWeek(w).filter(Boolean); }').length === 0,
    '[1h] canary: it does not flag an unrelated filter or a spelling that appears only in a comment');
  assert(rosterFilters('function renderNewThing(week){ const players = getPlayers().filter(p => p.active); }')[0].fn === 'renderNewThing', '[1i] canary: a NEW consumer is reported under its own function name');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[2] A3 TWIN - a non-entrant\'s pick row counts for nothing…');
// ═════════════════════════════════════════════════════════════════
const env = await makeEnv();
const { app, comp, st } = env;
function fresh(opts) {
  app._clearPickDraftForTest();
  for (const k of Object.keys(app._viewingBySportForTest)) delete app._viewingBySportForTest[k];
  return env.league(opts);
}
const BASE = { sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, submitted: ['p1', 'p3'], weekStatus: { nfl: 'live' } };
const nflWeek = () => st.getWeeks().find((w) => w.weekId === 'w_nfl_2');
/** p2 (Brayden) never joined the NFL; a stray COMPLETE slate of theirs sits in the NFL week, agreeing with p1 on one game and disagreeing on another so any scoring of it would show. */
function addStray() {
  const gs = st.getGames('w_nfl_2');
  st.saveAllPicks(gs.map((g, i) => ({ pickId: `stray_${g.gameId}`, weekId: 'w_nfl_2', gameId: g.gameId, playerId: 'p2', selectedTeam: i === 0 ? g.homeTeam : g.awayTeam, submittedAt: 'x', selectedAt: 'x', updatedAt: 'x' })));
}
function finalizeNfl() {
  // two NFL games, both final, the home side covers: p1 and p3 (home picks) win, a stray p2 (home, away) would split
  for (const g of st.getGames('w_nfl_2')) st.saveGame({ ...g, status: 'final', homeScore: 31, awayScore: 10, lastUpdated: new Date(env.NOW + 1000).toISOString() });
  const w = nflWeek();
  st.saveWeek({ ...w, status: 'live' });
  return app.finalizeWeek(st.getWeeks().find((x) => x.weekId === 'w_nfl_2'));
}
{
  fresh(BASE);
  finalizeNfl();
  const clean = JSON.stringify(st.getWeeklyResults('w_nfl_2'));
  const cleanPlayers = st.getWeeklyResults('w_nfl_2').map((r) => r.playerId).sort();
  const cleanObs = JSON.stringify(st.getObligations().map((o) => [o.type, o.payerPlayerId, o.recipientPlayerId, o.weekId]));
  const cleanStand = JSON.stringify(app.seasonStandingsRows({ competitionId: comp.getCompetitions().find((c) => c.sport === 'nfl').id }));
  assert(eq(cleanPlayers, ['p1', 'p3']), `[2a] fixture: finalizing the NFL week produces results for its two entrants only (${cleanPlayers.join(', ')})`);

  fresh(BASE);
  addStray();
  finalizeNfl();
  const dirty = JSON.stringify(st.getWeeklyResults('w_nfl_2'));
  assert(dirty === clean, '[2b] with a stray complete slate by a non-entrant, the NFL week\'s stored results are BYTE-IDENTICAL (no row, no rank shift, no win, no loss)');
  assert(!st.getWeeklyResults('w_nfl_2').some((r) => r.playerId === 'p2'), '[2c] ...and the non-entrant has no result row at all (not "0 of 2", not a loser)');
  assert(JSON.stringify(st.getObligations().map((o) => [o.type, o.payerPlayerId, o.recipientPlayerId, o.weekId])) === cleanObs && !st.getObligations().some((o) => o.payerPlayerId === 'p2' || o.recipientPlayerId === 'p2'), '[2d] ...and no obligation names them (nobody owes, nobody is owed)');
  assert(JSON.stringify(app.seasonStandingsRows({ competitionId: comp.getCompetitions().find((c) => c.sport === 'nfl').id })) === cleanStand, '[2e] ...and the NFL standings are byte-identical');
  // a member who is NOT in the NFL and has NO picks is not a "missing" loser either
  fresh({ ...BASE, submitted: ['p1', 'p3'] });
  finalizeNfl();
  assert(!st.getWeeklyResults('w_nfl_2').some((r) => r.playerId === 'p2' || r.playerId === 'p4'), '[2f] the two members who never joined the NFL have no row although they made no NFL picks (never "missing")');
  // CFB (enrollment all) is unaffected: every member is in
  fresh({ ...BASE, weekStatus: { cfb: 'live' }, submitted: ['p1', 'p3'] });
  for (const g of st.getGames('w_cfb_2')) st.saveGame({ ...g, status: 'final', homeScore: 31, awayScore: 10, lastUpdated: new Date(env.NOW + 1000).toISOString() });
  app.finalizeWeek(st.getWeeks().find((x) => x.weekId === 'w_cfb_2'));
  assert(eq(st.getWeeklyResults('w_cfb_2').map((r) => r.playerId).sort(), ['p1', 'p2', 'p3', 'p4']), '[2g] a CFB week (enrolls everyone) still has a row for all four members: "missing" is real for people who are in the sport');
  // a one-sport league finalizes over every active player exactly as before
  fresh({ sports: ['cfb'], weekStatus: { cfb: 'live' }, submitted: ['p1', 'p3'] });
  for (const g of st.getGames('w_cfb_2')) st.saveGame({ ...g, status: 'final', homeScore: 31, awayScore: 10, lastUpdated: new Date(env.NOW + 1000).toISOString() });
  app.finalizeWeek(st.getWeeks().find((x) => x.weekId === 'w_cfb_2'));
  assert(eq(st.getWeeklyResults('w_cfb_2').map((r) => r.playerId).sort(), ['p1', 'p2', 'p3', 'p4']), '[2h] a one-sport league: all four active players, as before');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[3] the late joiner (C1)…');
// ═════════════════════════════════════════════════════════════════
{
  const BEFORE = new Date(env.NOW).toISOString();                    // well before the NFL week's lock instant (kickoff - offset, a day out)
  fresh({ ...BASE, plays: { nfl: ['p1', 'p3'] }, joinedAt: BEFORE });
  const w = nflWeek();
  assert(eq(comp.playersForWeek(w).map((p) => p.playerId), ['p1', 'p3']), '[3a] fixture: two entrants joined before the lock');
  // p2 joins AFTER the lock instant (the week's first kickoff is ~25 h out; the instant is ~24.5 h out)
  const AFTER = new Date(env.NOW + 40 * 3600_000).toISOString();
  const nflId = comp.getCompetitions().find((c) => c.sport === 'nfl').id;
  localStorage.setItem('cfbp_competition_members', JSON.stringify([...st.getCompetitionMembers(), { id: `${nflId}:p2`, competitionId: nflId, memberId: 'p2', enrolledBy: 'self', joinedAt: AFTER }]));
  assert(eq(comp.playersForWeek(w).map((p) => p.playerId), ['p1', 'p3']) && eq(comp.playersForCompetition(nflId).map((p) => p.playerId), ['p1', 'p2', 'p3']), '[3b] a row stamped AFTER the lock: in the sport (for next week) but not in THIS week');
  st.saveWeek({ ...nflWeek(), status: 'live' });
  for (const g of st.getGames('w_nfl_2')) st.saveGame({ ...g, status: 'final', homeScore: 31, awayScore: 10, lastUpdated: new Date(env.NOW + 1000).toISOString() });
  app.finalizeWeek(st.getWeeks().find((x) => x.weekId === 'w_nfl_2'));
  assert(eq(st.getWeeklyResults('w_nfl_2').map((r) => r.playerId).sort(), ['p1', 'p3']), '[3c] the late joiner is not in that week\'s results - never "missing"');
  // and cannot pick it (the week is locked for them anyway; the clause is the belt)
  fresh({ ...BASE, viewer: 'p2', plays: { nfl: ['p1', 'p3'] }, weekStatus: { nfl: 'open' }, submitted: [] });
  const open = nflWeek();
  assert(app.canPlayerSubmitPicks(open, 'p2').allowed === false && /haven't joined/.test(app.canPlayerSubmitPicks(open, 'p2').reason), '[3d] a member who is not an entrant cannot submit that sport\'s picks: "You haven\'t joined this sport\'s picks."');
  assert(app.canPlayerSubmitPicks(open, 'p1').allowed === true, '[3e] ...an entrant can (control)');
  assert(app.canPlayerSubmitPicks(st.getWeeks().find((x) => x.weekId === 'w_cfb_2'), 'p2').allowed === true, '[3f] ...and p2 can still pick CFB, where they are in');
  fresh({ sports: ['cfb'], viewer: 'p2' });
  assert(app.canPlayerSubmitPicks(st.getWeeks().find((x) => x.weekId === 'w_cfb_2'), 'p2').allowed === true, '[3g] a one-sport league never reaches the clause');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4] the surfaces name the week\'s own sport\'s entrants…');
// ═════════════════════════════════════════════════════════════════
{
  fresh({ ...BASE, weekStatus: { nfl: 'final' }, submitted: ['p1', 'p3'] });
  addStray();
  const summary = app.buildWeeklySummary(nflWeek());
  assert(typeof summary === 'string', '[4a] fixture: the digest builds');
  assert(!/Brayden|Koby/.test(summary), '[4b] the weekly digest names neither the member who never joined (with a stray slate) nor the one who made no pick');
  // (postPicksLockedNotice's count goes out through the chat transport, which this harness does not bind; it is held by the scan [1e] and by sportopstest's count, which shares its source.)
  const note = (() => { fresh({ ...BASE, weekStatus: { nfl: 'open' }, submitted: ['p1'] }); return app.sportWeekInCountText(nflWeek()); })();
  assert(note === '1 of 2 in', '[4c] the overview\'s count is over the same entrants: "1 of 2 in"');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4e] the digest and SCRIBE use the WEEK\'S OWN sport (Part 2 item 2, 2026-10-08)…');
// ═════════════════════════════════════════════════════════════════
// seasonStandingsRows() answers for the CONTEXT sport (the player's pointer) unless handed a competition. The weekly digest and finalizeWeek's SCRIBE before/after passed none, so finalizing the NFL week
// while the pointer was on CFB printed the COLLEGE standings under the NFL recap ("2. (unknown)") and told SCRIBE about the wrong sport's ranks. considerWeekSignals read the season-wide games, picks and
// weeks of EVERY sport, so a streak could blend a CFB run into an NFL one.
{
  const nflCid = () => comp.getCompetitions().find((c) => c.sport === 'nfl').id;
  fresh({ ...BASE, weekStatus: { nfl: 'final' }, submitted: ['p1', 'p3'] });
  assert(comp.getActiveSportKey() === 'cfb', '[4e-0] fixture: the pointer is on CFB while the NFL recap is built');
  const dig = app.buildWeeklySummary(nflWeek());
  const block = dig.slice(dig.indexOf('━━━ Season standings ━━━'));
  const rows = block.split('\n').filter((l) => /^\s*\d+\.\s/.test(l));
  assert(rows.length === 2 && !/\(unknown\)/.test(block) && /Drew/.test(block) && /Kevin/.test(block) && !/Brayden|Koby/.test(block),
    `[4e-a] the NFL digest's Season standings block is the NFL's: its two entrants, by name (got ${rows.length} rows: ${rows.map((r) => r.trim().slice(0, 24)).join(' | ')})`);
  fresh({ ...BASE, weekStatus: { cfb: 'final' }, submitted: ['p1', 'p2', 'p3', 'p4'] });
  comp.setActiveSportKey('nfl');
  const cfbWeek = st.getWeeks().find((w) => w.weekId === 'w_cfb_2');
  const dig2 = app.buildWeeklySummary(cfbWeek);
  const rows2 = dig2.slice(dig2.indexOf('━━━ Season standings ━━━')).split('\n').filter((l) => /^\s*\d+\.\s/.test(l));
  assert(rows2.length === 4 && !/\(unknown\)/.test(dig2), `[4e-b] ...and the CFB digest, built while the pointer is on the NFL, lists all four CFB members, none unnamed (got ${rows2.length})`);
  fresh({ sports: ['cfb'], weekStatus: { cfb: 'final' }, submitted: ['p1', 'p2', 'p3', 'p4'] });
  const one = app.buildWeeklySummary(st.getWeeks().find((w) => w.weekId === 'w_cfb_2'));
  assert(one.slice(one.indexOf('━━━ Season standings ━━━')).split('\n').filter((l) => /^\s*\d+\.\s/.test(l)).length === 4, '[4e-c] a one-sport league: the standings block is every active member, as before');

  // finalizeWeek hands SCRIBE the standings of the WEEK'S sport, before and after - observed with a probe copy of app.js that records the call's arguments (a probe, not a failure mutant)
  const probe = [["      fireScribeWeekSignals(week, { phase: 'final', standingsBefore: scribeStandingsBefore, standingsAfter: seasonStandingsRows({ competitionId: scribeCid }) });",
    "      (globalThis.__scribeProbe = globalThis.__scribeProbe || []).push({ weekId: week.weekId, before: scribeStandingsBefore.map((r) => r.playerId), after: seasonStandingsRows({ competitionId: scribeCid }).map((r) => r.playerId) });"]];
  const probeMiss = [["      fireScribeWeekSignals(week, { phase: 'final', standingsBefore: scribeStandingsBefore, standingsAfter: seasonStandingsRows() });",
    "      (globalThis.__scribeProbe = globalThis.__scribeProbe || []).push({ weekId: week.weekId, before: scribeStandingsBefore.map((r) => r.playerId), after: seasonStandingsRows().map((r) => r.playerId) });"]];
  const finalizeProbe = async (edits) => withMutantApp(edits, async (m) => {
    fresh({ ...BASE, weekStatus: { nfl: 'live' }, submitted: ['p1', 'p3'] });
    for (const g of st.getGames('w_nfl_2')) st.saveGame({ ...g, status: 'final', homeScore: 31, awayScore: 10, lastUpdated: new Date(env.NOW + 1000).toISOString() });
    globalThis.__scribeProbe = [];
    // D1 integration 18 (2026-10-08): PF-416 sends the week-final announcements (SCRIBE's signals among them) only once the week is HELD final; in local mode that is the
    // stored week. So the week is stored final first and then finalized, the order production uses (week-wizard.js confirmFinalizeWeek(): saveWeek, then finalizeWeek).
    st.saveWeek({ ...nflWeek(), status: 'final', finalizedAt: new Date(env.NOW).toISOString() });
    m.finalizeWeek(st.getWeeks().find((w) => w.weekId === 'w_nfl_2'));
    return globalThis.__scribeProbe[0] || null;
  });
  const got = await finalizeProbe(probe);
  assert(got && got.weekId === 'w_nfl_2' && got.before.slice().sort().join() === 'p1,p3' && got.after.slice().sort().join() === 'p1,p3',
    `[4e-d] finalizing the NFL week with the pointer on CFB: SCRIBE's standingsBefore AND standingsAfter are the NFL's two entrants (got ${JSON.stringify(got)})`);

  // considerWeekSignals' inputs: only the week's own sport's weeks, their games, and their entrants' pick rows
  fresh({ ...BASE, weekStatus: { nfl: 'final' }, submitted: ['p1', 'p3'] });
  addStray();
  const inp = app._signalInputsForWeekForTest(nflWeek());
  const wk = new Set(inp.weeks.map((w) => w.weekId));
  assert([...wk].sort().join() === 'w_nfl_1,w_nfl_2' && inp.games.every((g) => wk.has(g.weekId)) && inp.picks.every((p) => wk.has(p.weekId) && ['p1', 'p3'].includes(p.playerId)) && inp.players.map((p) => p.playerId).join() === 'p1,p3',
    `[4e-e] the signal inputs for an NFL week hold NFL weeks (${[...wk].join(',')}), their games, and only entrants' rows (a stray non-entrant slate is out) - nothing of the college season`);
  assert(inp.games.length > 0 && inp.picks.length > 0, '[4e-f] ...and they are not empty (the filter is not "drop everything")');
  fresh({ sports: ['cfb'], weekStatus: { cfb: 'final' }, submitted: ['p1', 'p3'] });
  const inp1 = app._signalInputsForWeekForTest(st.getWeeks().find((w) => w.weekId === 'w_cfb_2'));
  assert(inp1.weeks.length === st.getWeeks().length && inp1.games.length === st.getGames().length && inp1.picks.length === st.getPicks().length,
    '[4e-g] a one-sport league: the inputs are the season-wide games, picks and weeks exactly as before');
  // the blind rule at the source of the read: a week whose picks are not public yields NO pick rows from either helper, whoever the caller is
  fresh({ ...BASE, weekStatus: { nfl: 'open' }, submitted: ['p1', 'p3'] });
  const blindIn = app._signalInputsForWeekForTest(nflWeek());
  assert(blindIn.picks.length === 0 && blindIn.weeks.length > 0 && blindIn.players.length === 2, `[4e-j] an OPEN (blind) NFL week: signalInputsForWeek carries NO pick rows (got ${blindIn.picks.length}) and still names the week's entrants`);
  const chatUi2 = await import('./js/chat-ui.js');
  assert(chatUi2.scribeLivePicksFor(nflWeek(), st.getGames('w_nfl_2')[0].gameId).length === 0, '[4e-k] ...and scribeLivePicksFor returns nothing for a blind week');
  fresh({ sports: ['cfb'], weekStatus: { cfb: 'open' }, submitted: ['p1', 'p3'] });
  assert(app._signalInputsForWeekForTest(st.getWeeks().find((w) => w.weekId === 'w_cfb_2')).picks.length === 0, '[4e-l] ...in a one-sport league too');
  // a blended streak: p1's graded run across BOTH sports would read as one run; scoped to the NFL it is the NFL's alone
  fresh({ ...BASE, weekStatus: { nfl: 'final' }, submitted: ['p1', 'p3'] });
  const cfbW1Games = st.getGames('w_cfb_1');
  assert(cfbW1Games.length > 0, '[4e-h] fixture: the college season has graded history of its own');
  assert(inp.weeks.every((w) => w.competitionId === nflCid()), '[4e-i] every week handed to SCRIBE belongs to the NFL competition');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4f] security N2 (Part 2 item 10, 2026-10-08): a live call-out counts ENTRANTS\' picks only…');
// ═════════════════════════════════════════════════════════════════
// scribeLiveGameCheck() counted every pick row on the game (`nPicks = picksForGame.length`) before it asked whether a "crowd" existed (`nPicks >= 3`): two NFL entrants plus one stray row by a member who never
// joined made three, and the crowd and upset-watch paths ran on a crowd that was not one. The rows now come through scribeLivePicksFor(): the week's entrants only.
{
  const chatUi = await import('./js/chat-ui.js');
  fresh({ ...BASE, weekStatus: { nfl: 'live' }, submitted: ['p1', 'p3'] });
  const g0 = st.getGames('w_nfl_2')[0];
  const base = chatUi.scribeLivePicksFor(nflWeek(), g0.gameId);
  assert(base.length === 2 && base.every((p) => ['p1', 'p3'].includes(p.playerId)), `[4f-a] two NFL entrants picked the game: two rows (got ${base.length})`);
  addStray();
  const withStray = chatUi.scribeLivePicksFor(nflWeek(), g0.gameId);
  assert(st.getPicks('w_nfl_2').filter((p) => p.gameId === g0.gameId).length === 3 && withStray.length === 2 && !withStray.some((p) => p.playerId === 'p2'),
    `[4f-b] a stray row by a member who never joined makes THREE rows on the game but still TWO counted rows - the "nPicks >= 3" crowd gate stays shut (got ${withStray.length})`);
  const src = await readJs('chat-ui.js');
  const chk = src.slice(src.indexOf('export function scribeLiveGameCheck('), src.indexOf('export function scribeLiveGameCheck(') + 3600);
  assert(/const picksForGame = scribeLivePicksFor\(week, gameId\);/.test(chk) && !/getPicks\(week\.weekId\)\.filter\(p => p\.gameId === gameId\)/.test(chk), '[4f-c] scribeLiveGameCheck() reads its rows through scribeLivePicksFor (no second, unfiltered read of the game\'s picks)');
  fresh({ sports: ['cfb'], weekStatus: { cfb: 'live' }, submitted: ['p1', 'p2', 'p3'] });
  const cfbG = st.getGames('w_cfb_2')[0];
  assert(chatUi.scribeLivePicksFor(st.getWeeks().find((w) => w.weekId === 'w_cfb_2'), cfbG.gameId).length === 3, '[4f-d] a one-sport league: every active member\'s row counts, as before');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4d] F1 (security, 2026-10-08): a commissioner who has NOT joined a sport is judged by the stake he would have if he joined…');
// ═════════════════════════════════════════════════════════════════
// RG-37's rule: "you may never be able to submit your own picks and see someone else's at the same time". canViewOtherPicks() lets a commissioner see the field only when he has NO stake, and it
// asked canPlayerSubmitPicks() - which D1's entrant clause widened ("You haven't joined this sport's picks"). A commissioner who plays CFB but not the NFL "could not act" on an OPEN NFL week, so the bypass
// opened: he read the NFL field, then JOINED (allowed until the lock) and picked with it. The sweep below uses an INDEPENDENT can-act oracle (the week's stored status and its lock instant - the facts the
// fixture was built from - never canPlayerSubmitPicks, the predicate that widened and so blinded the old sweeps).
{
  const ROLES = [['player in the NFL', 'p1', false], ['commissioner in the NFL', 'p1', true], ['commissioner NOT in the NFL', 'p2', true], ['player NOT in the NFL', 'p2', false]];
  const STATES = [['draft', 'draft', 24], ['open', 'open', 24], ['derived-locked', 'open', -2], ['locked', 'locked', 24], ['live', 'live', -2], ['final', 'final', -48]];
  const bad = [], nonVacuous = { actingNonEntrantAdmin: 0, seesWhenNoStake: 0 };
  for (const [rl, viewer, isAdmin] of ROLES) {
    for (const [sl, status, off] of STATES) {
      fresh({ sports: ['cfb', 'nfl'], viewer, isAdmin, plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'open', nfl: status }, submitted: ['p1', 'p3'], lockOffsetHours: off });
      const w = nflWeek();
      const couldAct = status === 'open' && off > 0;                      // ORACLE: stored open, lock instant still ahead. (A viewer who has not joined could JOIN and then act.)
      const isPublic = status === 'live' || status === 'final';
      const expected = isPublic || (isAdmin && !couldAct);                // RG-37: a commissioner with no stake still verifies the field
      const got = app.canViewOtherPicks(w);
      if (got !== expected) bad.push(`${rl}/${sl}: got ${got}, expected ${expected}`);
      if (couldAct && got) bad.push(`${rl}/${sl}: THE INVARIANT - he can still act (or join) AND sees the field`);
      if (couldAct && isAdmin && viewer === 'p2') nonVacuous.actingNonEntrantAdmin++;
      if (!couldAct && isAdmin && !isPublic && got) nonVacuous.seesWhenNoStake++;
    }
  }
  assert(bad.length === 0, `[4d-a] over 4 roles x 6 NFL week states, canViewOtherPicks() = public || (commissioner && cannot still act or join), judged by an independent oracle (${bad.join(' | ') || 'no mismatch'})`);
  assert(nonVacuous.actingNonEntrantAdmin === 1 && nonVacuous.seesWhenNoStake >= 3, `[4d-b] the sweep reached the F1 case (a commissioner outside the NFL on an OPEN NFL week: ${nonVacuous.actingNonEntrantAdmin}) AND kept the bypass where he has no stake (${nonVacuous.seesWhenNoStake} states)`);
  fresh({ sports: ['cfb', 'nfl'], viewer: 'p2', isAdmin: true, plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'open', nfl: 'open' }, submitted: ['p1', 'p3'] });
  const w2 = nflWeek();
  assert(app.canPlayerSubmitPicks(w2, 'p2').allowed === false && app.canPlayerSubmitPicks(w2, 'p2', { asIfEntrant: true }).allowed === true && app.canViewOtherPicks(w2) === false,
    '[4d-c] the public submit predicate is UNCHANGED (he "has not joined": refused), the as-if-entrant form says he could act, and the viewer predicate follows the second');
  assert(app.canPlayerSubmitPicks(w2, 'p2', { asIfEntrant: true }).reason === '' && app.canPlayerSubmitPicks({ ...w2, status: 'locked' }, 'p2', { asIfEntrant: true }).allowed === false,
    '[4d-d] asIfEntrant skips ONLY the entrant clause: a locked week still refuses him');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[5] MUTATION PROOFS on in-memory copies…');
// ═════════════════════════════════════════════════════════════════
{
  const run = async (appEdits, chatEdits = null) => withMutantApp(appEdits, async (m) => {
    const out = {};
    fresh(BASE); addStray();
    for (const g of st.getGames('w_nfl_2')) st.saveGame({ ...g, status: 'final', homeScore: 31, awayScore: 10, lastUpdated: new Date(env.NOW + 1000).toISOString() });
    st.saveWeek({ ...nflWeek(), status: 'live' });
    m.finalizeWeek(st.getWeeks().find((x) => x.weekId === 'w_nfl_2'));
    out['2c a non-entrant has no result row'] = !st.getWeeklyResults('w_nfl_2').some((r) => r.playerId === 'p2');
    out['2d no obligation names them'] = !st.getObligations().some((o) => o.payerPlayerId === 'p2' || o.recipientPlayerId === 'p2');
    fresh({ ...BASE, weekStatus: { nfl: 'final' }, submitted: ['p1', 'p3'] });
    out['4b the digest names only entrants'] = !/Brayden|Koby/.test(m.buildWeeklySummary(st.getWeeks().find((x) => x.weekId === 'w_nfl_2')));
    fresh({ ...BASE, viewer: 'p2', weekStatus: { nfl: 'open' } });
    out['3d a non-entrant cannot submit'] = m.canPlayerSubmitPicks(st.getWeeks().find((x) => x.weekId === 'w_nfl_2'), 'p2').allowed === false;
    fresh({ sports: ['cfb', 'nfl'], viewer: 'p2', isAdmin: true, plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'open', nfl: 'open' }, submitted: ['p1', 'p3'] });
    out['4d F1 a commissioner outside the NFL is blind on an open NFL week'] = m.canViewOtherPicks(st.getWeeks().find((x) => x.weekId === 'w_nfl_2')) === false;
    return out;
  });
  const ctl = await run([]);
  assert(Object.values(ctl).every(Boolean), `[5-0] POSITIVE CONTROL: an unmutated second copy passes every named check (${Object.entries(ctl).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all green'})`);
  const redOn = async (label, edits, must) => {
    let res;
    try { res = await run(edits); } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 90)]: false }; }
    const failed = Object.entries(res).filter(([, ok]) => !ok).map(([n]) => n);
    assert(failed.length > 0 && must.every((m) => failed.some((f) => f.startsWith(m))), `${label} -> RED on: ${failed.join(' | ') || '(nothing - the mutant SURVIVED)'}`);
  };
  await redOn('[5-1] finalize scores the ACTIVE ROSTER (the pre-D1 line): a non-entrant gets a row (anchor re-pinned 2026-10-08: the merged line carries the B2 tag too)', [["const players=playersForWeek(week);   // D1 (B2) + DI-531 (C4, A3):", "const players=getPlayers().filter(p=>p.active);   // MUTANT D1 (B2) + DI-531 (C4, A3):"]], ['2c']);
  await redOn('[5-2] the weekly digest ranks the active roster', [["export function buildWeeklySummary(week) {\n  if (!week) return '';\n  const players = playersForWeek(week);", "export function buildWeeklySummary(week) {\n  if (!week) return '';\n  const players = getPlayers().filter(p => p.active);"]], ['4b']);
  await redOn('[5-4] F1: canViewOtherPicks() judges the commissioner by the PUBLIC submit predicate again (asIfEntrant dropped): a commissioner outside the NFL reads the open NFL field', [["if (sess.isAdmin && !canPlayerSubmitPicks(week, sess.playerId, { asIfEntrant: true }).allowed) return true;", "if (sess.isAdmin && !canPlayerSubmitPicks(week, sess.playerId).allowed) return true;"]], ['4d F1']);
  await redOn('[5-3] a non-entrant may submit (the C4 clause is gone; anchor re-pinned 2026-10-08 for the asIfEntrant guard)', [["  if (!asIfEntrant && isMultiSport() && !playersForWeek(week).some((p) => p && String(p.playerId) === String(playerId))) return", "  if (false) return"]], ['3d']);
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
