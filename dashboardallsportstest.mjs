/**
 * CFB Pickems — dashboardallsportstest.mjs (D1 / v0.30.0, DI-525 rev 3 "All sports", Drew D-59; security C2, C4, C7, A5)
 * =======================================================================================================================
 * The Dashboard's ALL SPORTS view through the real js/app.js renderer: one combined "All Picks by Game" list of this week across the sports the member plays, every row labelled with its
 * sport, sorted across sports - and, above all, EVERY ROW GATED ON ITS OWN WEEK. A live CFB week next to a locked NFL week shows Kevin's pick on the CFB rows and `•••` on the NFL rows,
 * in one list; a live or final update in one sport can neither hide nor reveal another sport's picks.
 *
 * Run:  node dashboardallsportstest.mjs
 *
 *   [1]  WHO MAY HAVE IT - only a member who plays two or more sports; a forged scope, a one-sport league, a CFB-only member and a member who plays nothing get today's page.
 *   [2]  THE UNION - both sports' games, one list, sorted by kickoff across sports (ties: competition order), each row tagged with its sport; counts are of games.
 *   [3]  C2 - THE BLIND RULE IS PER ROW: the matrix of (CFB, NFL) week states x who sees whose pick, each blind row proven blind and each revealed row proven revealed.
 *   [4]  THE GATE IS PER SPORT - an unsubmitted sport shows its own gate and no games; the other sport's rows are unaffected.
 *   [5]  C4 - a pick row by a member who has not joined a sport names nobody in that sport's rows.
 *   [6]  HIDDEN WEEKS - a draft week for a member, a demo week for a non-commissioner (UN-71); the commissioner sees them.
 *   [7]  THE PAGE - "This week", no arrows, the calm per-sport note, no Alma Mater Watch / weekly summary, and the week swipe is inert.
 *   [8]  THE SCOPE - All sports never moves the sport pointer, a sport segment clears it, the page repaints from the scope.
 *   [9]  MUTATION PROOFS on in-memory copies of js/app.js - C2, the per-sport gate, hidden weeks and C4 each go RED.
 */
import { makeEnv, withMutantApp, els, LEAGUE } from './sportenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const env = await makeEnv();
const { app, comp, st } = env;

/** A clean slate for the module-level state that survives env.league(). */
function fresh(opts) {
  app._clearPickDraftForTest();
  for (const k of Object.keys(app._viewingBySportForTest)) delete app._viewingBySportForTest[k];
  app._sportScrollForTest.clear();
  return env.league(opts);
}
const BASE = { sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, submitted: ['p1', 'p3'] };
const allHtml = (opts) => { fresh(opts); comp.setDashboardScope('all'); return env.render('dashboard'); };

/** The game rows of the combined list, by game id. */
function rowsOf(html) {
  const out = {};
  for (const chunk of html.split('<div class="dc-game"').slice(1)) {
    const id = /data-game-id="([^"]+)"/.exec(chunk);
    if (id) out[id[1]] = chunk;
  }
  return out;
}
/** What a row says about player `pid`'s chip: { kind: 'picked' | 'blind' | 'none', title }. */
function chipOf(row, pid) {
  const m = new RegExp(`<div class="dc-chip([^"]*)" data-player-id="${pid}"[^>]*title="([^"]*)"`).exec(row || '');
  if (!m) return { kind: 'none', title: '' };
  return { kind: /dc-chip-blind/.test(m[1]) ? 'blind' : 'picked', title: m[2] };
}
const C = ['w_cfb_2_g1', 'w_cfb_2_g2'], N = ['w_nfl_2_g1', 'w_nfl_2_g2'];

// ═════════════════════════════════════════════════════════════════
console.log('\n[1] who may have All sports…');
// ═════════════════════════════════════════════════════════════════
{
  const html = allHtml(BASE);
  assert(comp.getDashboardScope() === 'all' && /class="picks-week-nav all-sports-weeknav"/.test(html) && /id="all-sports-rows"/.test(html), '[1a] a member who plays both sports and chooses All sports gets the combined page');
  assert(/data-sport="all"[^>]*>All sports<\/button>/.test(html) && /aria-checked="true"[^>]*data-sport="all"/.test(html), '[1b] ...with "All sports" the selected last segment');
  fresh({ ...BASE, viewer: 'p2', submitted: ['p1', 'p2', 'p3'] });
  localStorage.setItem('cfbp_dashboard_scope', JSON.stringify({ local: { [LEAGUE]: 'all' } }));
  const only = env.render('dashboard');
  assert(comp.getDashboardScope() === 'cfb' && !/all-sports-weeknav|id="all-sports-rows"/.test(only) && !/NFL/.test(only), '[1c] a CFB-only member with a FORGED "all" scope gets the ordinary CFB Dashboard and no NFL word');
  fresh({ sports: ['cfb'], submitted: ['p1'] });
  localStorage.setItem('cfbp_dashboard_scope', JSON.stringify({ local: { [LEAGUE]: 'all' } }));
  assert(!/all-sports-weeknav/.test(env.render('dashboard')), '[1d] a one-sport league ignores a stored "all" scope');
  fresh({ ...BASE, plays: { cfb: ['p3'], nfl: ['p3'] } });
  localStorage.setItem('cfbp_dashboard_scope', JSON.stringify({ local: { [LEAGUE]: 'all' } }));
  assert(!/all-sports-weeknav|id="all-sports-rows"/.test(env.render('dashboard')), '[1e] a member who plays nothing never gets it either');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[2] the union, the order, the labels…');
// ═════════════════════════════════════════════════════════════════
{
  const html = allHtml(BASE);
  const rows = rowsOf(html);
  assert(eq(Object.keys(rows), [C[0], N[0], C[1], N[1]]), `[2a] four rows - both sports' games, interleaved by kickoff and, at one kickoff, CFB before NFL (competition order): ${Object.keys(rows).join(', ')}`);
  assert(/data-sport="cfb"/.test(rows[C[0]]) && /data-sport="nfl"/.test(rows[N[0]]) && Object.values(rows).every((r) => /data-sport="(cfb|nfl)"/.test(r)), '[2b] every row carries its sport');
  assert(/class="[^"]*sport[^"]*">\s*CFB\s*</.test(rows[C[0]]) || />\s*CFB\s*</.test(rows[C[0]]), '[2c] ...and prints its sport\'s code');
  assert(/4 games/.test(html) && !/live/.test((/class="all-sports-count[^>]*>([^<]*)</.exec(html) || [])[1] || ''), '[2d] the count is of GAMES ("4 games"), never of picks');
  // a later NFL game sorts after an earlier CFB one even though NFL is second in competition order, and an earlier NFL one before a later CFB one
  fresh(BASE);
  const g = st.getGames('w_nfl_2').find((x) => x.gameId === N[1]);
  st.saveGame({ ...g, kickoff: new Date(env.NOW + 2 * 3600_000).toISOString() });
  comp.setDashboardScope('all');
  assert(eq(Object.keys(rowsOf(env.render('dashboard'))), [N[1], C[0], N[0], C[1]]), '[2e] an NFL game that kicks off first sorts first: the order is by kickoff, not by sport');
  fresh({ ...BASE, weekStatus: { cfb: 'live', nfl: 'live' } });
  const g2 = st.getGames('w_nfl_2')[0];
  st.saveGame({ ...g2, status: 'live', homeScore: 3, awayScore: 0, lastUpdated: new Date(env.NOW).toISOString() });
  comp.setDashboardScope('all');
  const live = env.render('dashboard');
  assert(/1 live/.test(live), '[2f] a live game in either sport is counted ("1 live")');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[3] C2 - every row follows ITS OWN week…');
// ═════════════════════════════════════════════════════════════════
const MATRIX = [
  // [cfb status, nfl status, cfb rows reveal Kevin's pick, nfl rows reveal]
  ['live', 'locked', true, false],
  ['locked', 'live', false, true],
  ['live', 'live', true, true],
  ['open', 'open', false, false],
  ['locked', 'locked', false, false],
  ['final', 'open', true, false],
  ['open', 'final', false, true],
];
{
  for (const [cs, ns, cfbShows, nflShows] of MATRIX) {
    const html = allHtml({ ...BASE, weekStatus: { cfb: cs, nfl: ns } });
    const rows = rowsOf(html);
    const check = (ids, shows, tag) => ids.every((id) => {
      const chip = chipOf(rows[id], 'p3');
      return shows ? (chip.kind === 'picked' && /Kevin picked/.test(chip.title)) : (chip.kind === 'blind' && !/Kevin picked/.test(chip.title) && /hidden/.test(chip.title));
    });
    assert(check(C, cfbShows) && check(N, nflShows),
      `[3a] CFB ${cs} / NFL ${ns}: CFB rows ${cfbShows ? 'REVEAL' : 'hide'} Kevin's pick, NFL rows ${nflShows ? 'REVEAL' : 'hide'} it`);
    const mine = (ids) => ids.every((id) => chipOf(rows[id], 'p1').kind === 'picked');
    assert(mine(C) && mine(N), `[3b] CFB ${cs} / NFL ${ns}: the viewer's OWN pick is shown on every row, hidden week or not`);
    // nothing of a blind sport leaks anywhere in the page: Kevin's chosen team never appears in a title or text outside the viewer's own chip
    const leaks = (tag, ids, shows) => shows ? false : ids.some((id) => new RegExp(`Kevin picked ${tag}`).test(rows[id] || ''));
    assert(!leaks('CFB', C, cfbShows) && !leaks('NFL', N, nflShows), `[3c] CFB ${cs} / NFL ${ns}: no blind row says "Kevin picked …" anywhere in its markup`);
    const banner = /Other players' picks stay hidden/.test(html);
    assert(banner === (!cfbShows || !nflShows), `[3d] CFB ${cs} / NFL ${ns}: the blind note appears exactly when some row is blind (${banner})`);
  }
  // a state flip in ONE sport does not move the other: re-render after the NFL week goes live
  fresh({ ...BASE, weekStatus: { cfb: 'locked', nfl: 'locked' } });
  comp.setDashboardScope('all');
  const before = rowsOf(env.render('dashboard'));
  st.saveWeek({ ...st.getWeeks().find((w) => w.weekId === 'w_nfl_2'), status: 'live' });
  const after = rowsOf(env.render('dashboard'));
  assert(eq(after[C[0]], before[C[0]]) && eq(after[C[1]], before[C[1]]) && chipOf(after[N[0]], 'p3').kind === 'picked' && chipOf(before[N[0]], 'p3').kind === 'blind',
    '[3e] the NFL week going live reveals the NFL rows and leaves the CFB rows BYTE-IDENTICAL (still blind)');
  fresh({ ...BASE, weekStatus: { cfb: 'live', nfl: 'live' } });
  comp.setDashboardScope('all');
  const b2 = rowsOf(env.render('dashboard'));
  st.saveWeek({ ...st.getWeeks().find((w) => w.weekId === 'w_cfb_2'), status: 'final' });
  const a2 = rowsOf(env.render('dashboard'));
  assert(eq(a2[N[0]], b2[N[0]]) && eq(a2[N[1]], b2[N[1]]), '[3f] a CFB week finalizing leaves the NFL rows byte-identical');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[3g] C6 / F1b (security, 2026-10-08) - the commissioner joins the sweep, and derived-locked is a state…');
// ═════════════════════════════════════════════════════════════════
// The All sports rows used to ask canViewOtherPicks(): a commissioner who is "out of the game" (derived-locked, locked) saw the field on those rows although arePicksPublic() is false. Drew's coordinator
// ruling: the rows gate on arePicksPublic(week) PLUS that week's picksReadConfirmed (DI-525 rev 3, Std-8), never on the viewer's role or stake. The commissioner seeing LESS than on the single-sport Dashboard is accepted.
// The "can this viewer still act" oracle is INDEPENDENT of canPlayerSubmitPicks (the predicate that widened and blinded the old sweeps): it reads the week's stored status and its lock instant only.
{
  const STATES = [['open', 'open', 24], ['derived-locked', 'open', -2], ['locked', 'locked', 24], ['live', 'live', -2]];
  const bad = [];
  let actingCommissionerRows = 0, revealedRows = 0;
  for (const isAdmin of [false, true]) {
    for (const [label, status, off] of STATES) {
      fresh({ ...BASE, isAdmin, weekStatus: { cfb: 'live', nfl: status }, lockOffsetHours: off });
      comp.setDashboardScope('all');
      const rows = rowsOf(env.render('dashboard'));
      const couldAct = status === 'open' && off > 0;                    // ORACLE: stored open and the lock instant still ahead
      const isPublic = status === 'live';
      for (const id of N) {
        const chip = chipOf(rows[id], 'p3');
        if (!rows[id]) { bad.push(`${isAdmin ? 'commissioner' : 'player'}/NFL ${label}: row ${id} missing`); continue; }
        const shows = chip.kind === 'picked';
        if (shows !== isPublic) bad.push(`${isAdmin ? 'commissioner' : 'player'}/NFL ${label}: rival chip ${chip.kind} (expected ${isPublic ? 'picked' : 'blind'})`);
        if (couldAct && shows) bad.push(`${isAdmin ? 'commissioner' : 'player'}/NFL ${label}: THE INVARIANT - he can still act AND sees the rival`);
        if (couldAct && isAdmin) actingCommissionerRows++;
        if (shows) revealedRows++;
        if (/Kevin picked/.test(rows[id]) !== isPublic) bad.push(`${isAdmin ? 'commissioner' : 'player'}/NFL ${label}: "Kevin picked" in the markup does not match public=${isPublic}`);
      }
      // the viewer's OWN chip survives every state (a fix that blinded everything would pass the checks above and destroy the row)
      if (!N.every((id) => chipOf(rows[id], 'p1').kind === 'picked')) bad.push(`${isAdmin ? 'commissioner' : 'player'}/NFL ${label}: own chip lost`);
    }
  }
  assert(bad.length === 0, `[3g-a] 2 roles x 4 NFL states (open, DERIVED-locked, locked, live): the NFL rows reveal a rival exactly when the week is public - the commissioner is no exception (${bad.join(' | ') || 'no mismatch'})`);
  assert(actingCommissionerRows === 2 && revealedRows === 4, `[3g-b] the sweep is not vacuous: the acting commissioner's rows were swept (${actingCommissionerRows}) and the live rows did reveal (${revealedRows} = 2 roles x 2 rows)`);
}
{
  // The two halves of the gate, as a pure matrix: public AND (not supabase data mode OR a landed hydrate read the week as public).
  const R = app._otherPicksReadableWithForTest;
  const wk = (status) => ({ weekId: 'w', status, dataSourceMode: 'live' });
  assert(typeof R === 'function', '[3g-c] the gate has a pure form the matrix can drive');
  const cases = [
    [wk('live'), false, false, true], [wk('live'), true, false, false], [wk('live'), true, true, true], [wk('final'), true, false, false], [wk('final'), true, true, true],
    [wk('open'), true, true, false], [wk('open'), false, true, false], [wk('locked'), true, true, false], [wk('draft'), false, false, false], [null, false, false, false],
  ];
  const wrong = cases.filter(([w, supabase, confirmed, want]) => R(w, supabase, () => confirmed) !== want).map(([w, sup, conf, want]) => `${w && w.status}/supabase=${sup}/confirmed=${conf} -> want ${want}`);
  assert(wrong.length === 0, `[3g-d] public && (local mode || the server read landed): a live week whose picks have not been read in supabase mode reveals NOTHING (${wrong.join(' | ') || 'matrix holds'})`);
  const src = await (await import('node:fs/promises')).readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('function renderDashboardAllSports('), src.indexOf('function allSportsDateSpan('));
  assert(/otherPicksReadable\(week\)/.test(body) && !/canViewOtherPicks/.test(body.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n')),
    '[3g-e] renderDashboardAllSports() gates each row on otherPicksReadable(week) and never calls canViewOtherPicks (the role- and stake-based predicate)');
  assert(/function otherPicksReadable\(week\) \{\s*return otherPicksReadableWith\(week, isSupabaseDataMode\(\), picksReadConfirmedFor\);/.test(src) && /sb\.picksReadWhilePublic\(weekId\) === true/.test(src.slice(src.indexOf('function picksReadConfirmedFor('), src.indexOf('function picksReadConfirmedFor(') + 300)),
    '[3g-f] the production wrapper passes the real data mode and the real hydrate flag (S-C10 / RG-255)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4] the gate is per sport…');
// ═════════════════════════════════════════════════════════════════
{
  // the viewer has submitted CFB but not NFL; CFB is live (public), NFL is open (not public)
  fresh({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'live', nfl: 'open' }, submitted: ['p3'] });
  // p1 submitted nothing in either; make p1 submit CFB only
  const cg = st.getGames('w_cfb_2');
  st.saveAllPicks(cg.map((g) => ({ pickId: `own_${g.gameId}`, weekId: 'w_cfb_2', gameId: g.gameId, playerId: 'p1', selectedTeam: g.homeTeam, submittedAt: '2026-10-07T00:00:00.000Z' })));
  comp.setDashboardScope('all');
  const html = env.render('dashboard');
  const rows = rowsOf(html);
  assert(/data-all-gate="nfl"/.test(html) && !/data-all-gate="cfb"/.test(html), '[4a] the unsubmitted open NFL week shows ITS gate; the submitted CFB week has none');
  assert(/Submit your NFL picks to see who's in\./.test(html) && /Make your NFL picks/.test(html), '[4b] ...with the calm copy and one button');
  assert(Object.keys(rows).every((id) => C.includes(id)) && C.every((id) => rows[id]), '[4c] the NFL games are NOT listed behind the gate; the CFB rows are all there');
  assert(C.every((id) => chipOf(rows[id], 'p3').kind === 'picked'), '[4d] ...and the CFB rows (live, public) still reveal Kevin\'s pick');
  assert(!/NFL-open-home/.test(html), '[4e] and not one NFL team name leaks through the gate');
  // neither submitted, both open
  fresh({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] } });
  comp.setDashboardScope('all');
  const both = env.render('dashboard');
  assert(/data-all-gate="cfb"/.test(both) && /data-all-gate="nfl"/.test(both) && Object.keys(rowsOf(both)).length === 0, '[4f] neither submitted, nothing public: two gates and no rows');
  // the commissioner (isAdmin) is never gated, as on the one-sport Dashboard
  fresh({ sports: ['cfb', 'nfl'], viewer: 'p1', isAdmin: true, plays: { nfl: ['p1', 'p3'] } });
  comp.setDashboardScope('all');
  assert(!/data-all-gate/.test(env.render('dashboard')), '[4g] a commissioner session has no gate (the one-sport page\'s own rule)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[5] C4 - a pick row by a member who has not joined names nobody…');
// ═════════════════════════════════════════════════════════════════
{
  fresh({ ...BASE, weekStatus: { cfb: 'live', nfl: 'live' } });
  // p2 never joined the NFL; a stray row of theirs sits in an NFL game
  const g = st.getGames('w_nfl_2')[0];
  st.saveAllPicks([{ pickId: 'stray', weekId: 'w_nfl_2', gameId: g.gameId, playerId: 'p2', selectedTeam: g.awayTeam, submittedAt: '2026-10-07T00:00:00.000Z' }]);
  comp.setDashboardScope('all');
  const rows = rowsOf(env.render('dashboard'));
  assert(chipOf(rows[N[0]], 'p2').kind === 'none' && !/Brayden/.test(rows[N[0]]), '[5a] the NFL row has no chip and no name for the member who is not in the NFL');
  assert(chipOf(rows[N[0]], 'p3').kind === 'picked' && chipOf(rows[N[0]], 'p1').kind === 'picked', '[5b] ...and the two entrants are there');
  assert(chipOf(rows[C[0]], 'p2').kind === 'none' || chipOf(rows[C[0]], 'p2').kind === 'picked', '[5c] (CFB enrolls everyone, so Brayden is a CFB entrant: his CFB chip, if he picked, is allowed)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[6] hidden weeks…');
// ═════════════════════════════════════════════════════════════════
{
  fresh({ ...BASE, weekStatus: { nfl: 'draft' } });
  comp.setDashboardScope('all');
  const html = env.render('dashboard');
  assert(Object.keys(rowsOf(html)).every((id) => C.includes(id)) && !/NFL-open/.test(html) && !/data-all-gate="nfl"/.test(html), '[6a] a DRAFT NFL week does not exist for a member: no row, no gate, no team name');
  fresh({ ...BASE, weekStatus: { nfl: 'draft' }, isAdmin: true });
  comp.setDashboardScope('all');
  assert(Object.keys(rowsOf(env.render('dashboard'))).some((id) => N.includes(id)), '[6b] ...but the commissioner sees it');
  fresh({ ...BASE, extraWeeks: [], weekStatus: {} });
  const w = st.getWeeks().find((x) => x.weekId === 'w_nfl_2');
  st.saveWeek({ ...w, dataSourceMode: 'demo' });
  comp.setDashboardScope('all');
  assert(!Object.keys(rowsOf(env.render('dashboard'))).some((id) => N.includes(id)), '[6c] a DEMO NFL week is invisible to a non-commissioner (UN-71)');
  fresh({ ...BASE, isAdmin: true });
  st.saveWeek({ ...st.getWeeks().find((x) => x.weekId === 'w_nfl_2'), dataSourceMode: 'demo' });
  comp.setDashboardScope('all');
  assert(Object.keys(rowsOf(env.render('dashboard'))).some((id) => N.includes(id)), '[6d] ...and visible to the commissioner');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[7] the page…');
// ═════════════════════════════════════════════════════════════════
{
  const html = allHtml(BASE);
  assert(/<span class="picks-week-nav-label">This week<\/span>/.test(html) && /CFB Week 2 · NFL Week 2/.test(html), '[7a] a static "This week" block names each sport\'s own week');
  assert(!/data-dashboard-week=|aria-label="(Previous|Next) week"/.test(html), '[7b] there are NO week arrows (each sport\'s week has its own number, lock and finalization)');
  assert(/Alma Mater Watch and the weekly summary are per sport\. Choose CFB or NFL above\./.test(html) && !/Alma Mater Watch<\/|This Week Score Summary/.test(html.replace(/Alma Mater Watch and the weekly summary are per sport[^<]*/, '')), '[7c] Alma Mater Watch and the weekly summary are replaced by the one calm line');
  assert(!/no-pick|Standard<\/button>|Compact<\/button>/.test(html), '[7d] (the layout toggle and the per-section move controls are not drawn on the combined page)');
  // the in-tab swipe is inert: a real touch sequence on the bound page moves nothing and writes no drag offset
  fresh(BASE);
  comp.setDashboardScope('all');
  env.render('dashboard');
  const page = els.get('page-dashboard');
  const writes = [];
  page.style.setProperty = (k, v) => writes.push([k, v]);
  const viewing = app.state.viewingWeekId;
  const touch = (x) => ({ touches: [{ clientX: x, clientY: 300 }], preventDefault() {}, cancelable: true });
  page._fire('touchstart', touch(260)); page._fire('touchmove', touch(210)); page._fire('touchmove', touch(120)); page._fire('touchend', {});
  assert(app.state.viewingWeekId === viewing && writes.every(([, v]) => v === '0px'), `[7e] a swipe on All sports changes no week and drags nothing (writes ${JSON.stringify(writes)})`);
  assert((page._listeners?.touchstart || []).length >= 1, '[7f] (the week-swipe binder IS bound on this page: the silence above is the inert flag, not a missing binder)');
  // control: with a sport selected the same gesture does move (it navigates or drags)
  comp.setDashboardScope(null);
  env.render('dashboard');
  const w2 = [];
  page.style.setProperty = (k, v) => w2.push([k, v]);
  page._fire('touchstart', touch(260)); page._fire('touchmove', touch(210)); page._fire('touchmove', touch(120));
  page._fire('touchend', {});   // end the gesture: a repaint under a live swipe is deferred by design, and the next section needs the page to paint
  assert(w2.some(([, v]) => v !== '0px'), '[7g] CONTROL: on a single sport\'s Dashboard the same gesture drags the page');
  // D1 integration 18 (2026-10-08): since W-22 (fix/d1-loadflake) a page's repaints also wait for its spring-back to finish sliding, as they wait for the finger. The browser ends that
  // slide with a `transitionend` on the page root; this stub never fires one by itself, so it is fired here (what the browser does) and the next section's paints are not parked behind it.
  page._fire('transitionend', { target: page });
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[8] the scope…');
// ═════════════════════════════════════════════════════════════════
{
  fresh(BASE);
  comp.setActiveSportKey('nfl');
  env.render('dashboard');
  const ptrBefore = localStorage.getItem('cfbp_active_sport');
  assert(app._selectSportSegmentForTest('dashboard', 'all') === true && comp.getDashboardScope() === 'all', '[8a] choosing "All sports" selects it');
  assert(localStorage.getItem('cfbp_active_sport') === ptrBefore && comp.getActiveSportKey() === 'nfl', '[8b] ...and does NOT move the sport pointer (Picks and Standings stay on NFL)');
  assert(/all-sports-weeknav/.test(env.page('dashboard').innerHTML), '[8c] the page repainted into the combined view');
  assert(app._selectSportSegmentForTest('dashboard', 'cfb') === true && comp.getDashboardScope() === 'cfb' && comp.getActiveSportKey() === 'cfb', '[8d] choosing a sport clears the scope and sets the pointer');
  assert(!/all-sports-weeknav/.test(env.page('dashboard').innerHTML) && /CFB-open/.test(env.page('dashboard').innerHTML), '[8e] ...and the page is that sport\'s Dashboard');
  assert(app._selectSportSegmentForTest('picks', 'all') === false && app._selectSportSegmentForTest('leaderboard', 'all') === false, '[8f] "All sports" is refused on Picks and Standings');
  // the scope is per user and league, validated on read, and a different account sees none of it
  comp.setDashboardScope('all');
  localStorage.setItem('cfbp_supabase_active_league', 'L-other-0002');
  assert(comp.getDashboardScope() !== 'all', '[8g] another league does not inherit the scope');
  localStorage.setItem('cfbp_supabase_active_league', LEAGUE);
  assert(comp.getDashboardScope() === 'all', '[8h] ...and this league gets it back');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[9] MUTATION PROOFS on in-memory copies of js/app.js…');
// ═════════════════════════════════════════════════════════════════
{
  const run = async (edits) => withMutantApp(edits, async (m) => {
    const out = {};
    for (const [cs, ns, cfbShows, nflShows] of MATRIX.slice(0, 2)) {
      const rows = rowsOf(allHtml({ ...BASE, weekStatus: { cfb: cs, nfl: ns } }));
      const ok = (ids, shows) => ids.every((id) => { const c = chipOf(rows[id], 'p3'); return shows ? c.kind === 'picked' : c.kind === 'blind'; });
      out[`3a ${cs}/${ns}`] = ok(C, cfbShows) && ok(N, nflShows);
    }
    fresh({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'live', nfl: 'open' }, submitted: ['p3'] });
    st.saveAllPicks(st.getGames('w_cfb_2').map((g) => ({ pickId: `o_${g.gameId}`, weekId: 'w_cfb_2', gameId: g.gameId, playerId: 'p1', selectedTeam: g.homeTeam, submittedAt: 'x' })));
    comp.setDashboardScope('all');
    const gated = env.render('dashboard');
    out['4a the NFL gate'] = /data-all-gate="nfl"/.test(gated) && !/NFL-open-home/.test(gated);
    fresh({ ...BASE, weekStatus: { nfl: 'draft' } });
    comp.setDashboardScope('all');
    out['6a a draft week is hidden'] = !/NFL-open/.test(env.render('dashboard'));
    fresh({ ...BASE, weekStatus: { cfb: 'live', nfl: 'live' } });
    const g = st.getGames('w_nfl_2')[0];
    st.saveAllPicks([{ pickId: 'stray', weekId: 'w_nfl_2', gameId: g.gameId, playerId: 'p2', selectedTeam: g.awayTeam, submittedAt: 'x' }]);
    comp.setDashboardScope('all');
    out['5a a non-entrant is not named'] = chipOf(rowsOf(env.render('dashboard'))[N[0]], 'p2').kind === 'none';
    // F1b / C6 (2026-10-08): a commissioner on a DERIVED-locked NFL week (stored open, lock instant passed) sees the NFL rows blind; the pure gate refuses a public-but-unread week in supabase mode
    fresh({ ...BASE, isAdmin: true, weekStatus: { cfb: 'live', nfl: 'open' }, lockOffsetHours: -2 });
    comp.setDashboardScope('all');
    const dl = rowsOf(env.render('dashboard'));
    out['3g commissioner, NFL derived-locked: rows blind'] = N.every((id) => chipOf(dl[id], 'p3').kind === 'blind');
    out['3g the supabase hydrate clause'] = m._otherPicksReadableWithForTest({ weekId: 'w', status: 'live', dataSourceMode: 'live' }, true, () => false) === false;
    return out;
  });
  const ctl = await run([]);
  assert(Object.values(ctl).every(Boolean), `[9-0] POSITIVE CONTROL: an unmutated second copy of app.js passes every named check (${Object.entries(ctl).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all green'})`);
  const redOn = async (label, edits, must) => {
    let res;
    try { res = await run(edits); } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 90)]: false }; }
    const failed = Object.entries(res).filter(([, ok]) => !ok).map(([n]) => n);
    assert(failed.length > 0 && must.every((m) => failed.some((f) => f.startsWith(m))), `${label} -> RED on: ${failed.join(' | ') || '(nothing - the mutant SURVIVED)'}`);
  };
  await redOn('[9-1] C2: every row follows the FIRST sport\'s week (one reveal answer for the whole card)',
    [['    const canSeeOthers = !hidden && !gate && otherPicksReadable(week);\n    return { sp, order, week, games, hidden, gate, canSeeOthers };', '    const canSeeOthers = !hidden && !gate && otherPicksReadable(getCurrentWeekFor(playedSports()[0].competitionId));\n    return { sp, order, week, games, hidden, gate, canSeeOthers };']], ['3a live/locked', '3a locked/live']);
  await redOn('[9-2] C2: every row is revealed whenever ANY sport is public', [['    const canSeeOthers = !hidden && !gate && otherPicksReadable(week);\n    return { sp, order, week, games, hidden, gate, canSeeOthers };', '    const canSeeOthers = !hidden && !gate && playedSports().some((s) => { try { return otherPicksReadable(getCurrentWeekFor(s.competitionId)); } catch { return false; } });\n    return { sp, order, week, games, hidden, gate, canSeeOthers };']], ['3a live/locked']);
  await redOn('[9-3] the "submit first" gate is never raised (an unsubmitted open week lists its games)', [['    const gate = !hidden && !isPublic && !!session.playerId && !!session.playerVerified && !session.isAdmin && !hasPlayerSubmitted(week.weekId, session.playerId);', '    const gate = false;']], ['4a']);
  await redOn('[9-4] a draft week is shown to a member', [["    const hidden = !week || !sportWeekVisible(week, isCommissioner) || (week.status === WEEK_STATUS.DRAFT && !isCommissioner);", '    const hidden = !week;']], ['6a']);
  await redOn('[9-6] F1b: the rows ask canViewOtherPicks() again - a commissioner "out of the game" (derived-locked, locked) reads the NFL field', [['    const canSeeOthers = !hidden && !gate && otherPicksReadable(week);\n    return { sp, order, week, games, hidden, gate, canSeeOthers };', '    const canSeeOthers = !hidden && !gate && canViewOtherPicks(week);\n    return { sp, order, week, games, hidden, gate, canSeeOthers };']], ['3g commissioner, NFL derived-locked']);
  await redOn('[9-7] F1b: the hydrate clause is gone - a week public on this device but not yet read from the server reveals picks (S-C10 / RG-255)', [['  if (!supabaseMode) return true;\n  try { return confirmedFor(week.weekId) === true; } catch { return false; }', '  return true;']], ['3g the supabase hydrate clause']);
  await redOn('[9-5] C4: the rows are rendered for the ACTIVE ROSTER instead of the week\'s entrants', [['    const players = playersForWeek(i.week);\n    players.forEach((p) => allPlayers.set(p.playerId, p));', '    const players = getPlayers().filter((p) => p && p.active);\n    players.forEach((p) => allPlayers.set(p.playerId, p));']], ['5a']);
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
