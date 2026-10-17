/**
 * CFB Pickems — sportsurfacetest.mjs (D1 / v0.30.0, DI-520, DI-521 rev 3, DI-523, DI-524, DI-526, DI-555)
 * =======================================================================================================
 * The multisport client's SURFACES, driven through the real js/app.js renderers on sportenv.mjs's local store: what Picks, Dashboard and Standings print for a member who plays
 * both sports, only the default one, or neither - and that a one-sport league's render is the unmodified v0.29.0 render, byte for byte.
 *
 * Run:  node sportsurfacetest.mjs         (TZ-independent: the goldens hold under UTC, Los Angeles and Tokyo)
 *
 *   [1]  GOLDEN - 21 renders of a one-sport league (drafting, submitted, one competition row, locked, live, signed out, commissioner x Picks / Dashboard / Standings) hash to what the
 *        UNMODIFIED code (commit 9e04434b, the tree this work started from) printed for the same fixture. The single-sport rule is not an argument; it is a hash.
 *   [2]  THE THREE-WAY MATRIX - plays both / plays only CFB / plays neither x Picks / Dashboard / Standings: the switcher exists for the first only; a CFB-only member sees no NFL word, no
 *        NFL button and nothing that leads to a Join (DI-555); a member who plays nothing sees the calm state and the way to the overview.
 *   [3]  EACH SPORT'S PAGE IS ITS OWN - the NFL Picks page has no CFB game, the NFL Standings list only NFL's entrants, and the reverse.
 *   [4]  FORGED STATE - a stored pointer or Dashboard scope that names a sport the member does not play, a sport the league does not have, or an object key like __proto__, changes nothing (A4, A5).
 *   [5]  HOME / PUSH / LINK ROUTING - a card, a push or a link about a sport reaches that sport's tab only if the member plays it; an unplayed sport opens the overview and moves nothing (DI-523, DI-555).
 *   [6]  MUTATION PROOFS on in-memory copies of js/app.js and js/competition.js - each must turn a NAMED check RED.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeEnv, withMutantApp, LEAGUE, CID } from './sportenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const env = await makeEnv();
const { app, comp, st } = env;

// THE ONE NAMED EXEMPTION from the "no NFL word" checks ([2g], [4a]): the platform's What's New card on Picks. It is release-note text, identical for every league (createdleaguetest's ALLOW-list treats it the same way),
// and it names NFL in the v0.30.0 entry because Drew kept that line in the approved notes (2026-10-14, M-47: "all 23 lines, NFL line kept"). It is cut out by its EXACT rendered text, so everything else on the page
// is still scanned; [2g2]/[2g3] prove the cut is real (the card is there and does say NFL) and bounded (an NFL word anywhere else still fails).
const platformNotesCard = () => app.renderWhatsNewCardHTML();
const withoutNotes = (html) => html.split(platformNotesCard()).join('');

// ═════════════════════════════════════════════════════════════════
console.log('\n[1] GOLDEN - a one-sport league renders exactly what v0.29.0 rendered…');
// ═════════════════════════════════════════════════════════════════
// Captured by running the SAME fixture (sportenv.mjs) against a scratch copy of commit 9e04434b's tree, before any sport-context code existed. If sportenv.mjs's fixture changes, these must be
// re-captured from that tree, never from the current one.
// RE-CAPTURED 2026-10-08 (feat/d1-sports = server + client merged). The 13 hashes that moved (Picks and Dashboard in six scenarios, the signed-out Dashboard) moved because the SERVER tree (17a9fa29, the
// tree the merge started from) draws the Who's-in strip (W-18 / DI-539) on one-sport Picks and Dashboard pages and the btn-row on the signed-out Dashboard - not because of any sport-context code: this
// fixture was run against a scratch copy of 17a9fa29 AND against the merged tree, and all 21 hashes are identical between them. The three Standings goldens and the signed-out/commissioner Picks
// that did not move are unchanged from 9e04434b. The int base (0ae9a21d) still prints the original 21; see the dated note on [1a].
// RE-PINNED 2026-10-14 (D1 Lane B history merged with Game Day, DI-595 / DI-596): the seven STANDINGS (leaderboard) hashes moved and ONLY those: a signed-in member's Season Summary names are 44 pt buttons (a chevron,
// a named description, "Tap a player to compare." in the footnote) and a REVEALED week's Weekly History cell is a 44 pt opener button. The fixture was rendered on the Game Day tree (6610fff6: it reproduces the
// previous seven hashes exactly) and on the merged tree and the pages line-diffed: the ONLY differences are that markup. The fourteen Picks and Dashboard hashes did not move.
// RE-PINNED 2026-10-08 (merge of int d6e8ac5a into feat/d1-gameday, Lane B Game Day): the six one-sport DASHBOARD hashes that render games moved, and ONLY because of Lane B's approved Dashboard chrome —
// the DI-607 Sort row ("{n} games", its caption, the Sort button) under the card header, and the D-1 icon family's glyphs for the card title (clipboard, was 📋) and the Refresh button (was ↻). The fixture was
// run against a scratch copy of int d6e8ac5a and against this tree and the rendered markup diffed line by line: every differing line is one of those three pieces, nothing from the sport-context code
// (reproduce: render SCENARIOS through sportenv.mjs on both trees and diff the markup). drafting/dashboard (no games, so no Sort row and no card) and every Picks and Standings golden are unchanged.
// RE-PINNED 2026-10-14 (v0.30.0 release stamps): the SEVEN one-sport PICKS hashes moved and ONLY those (Dashboard and Standings did not). The Picks page prints the What's New card, and the card now holds the v0.30.0 entry
// (14 added, 9 fixed) instead of v0.29.0's. The fixture was rendered on the int tip (80966448) and on the stamped tree (sportenv.mjs; evidence/stamps/dump-sport-renders.mjs) and the pages line-diffed: in each of
// the seven, the 41 differing lines are the card's <summary> and its <li> bullets, nothing else; the fourteen Dashboard and Standings pages are byte-identical. No sport-context code moved.
// RE-PINNED 2026-10-15 (deploy-day copy: the join-nudge and privacy What's New lines, Drew D-91, and the date): the SAME seven one-sport PICKS hashes moved and ONLY those (Dashboard and Standings did not).
// The Picks page prints the What's New card, and the v0.30.0 entry went from 14 added lines to 16. The fixture was rendered by dump-sport-renders.mjs on the int tip (e6627bca) and on this tree and the pages
// line-diffed (evidence/final-copy/renders-int vs renders-new): in each of the seven, the ONLY difference is the same two added <li> lines (the two new bullets), nothing else; the fourteen Dashboard and
// Standings pages are byte-identical. No sport-context code moved.
// RE-PINNED 2026-10-17 (v0.30.1 release stamps, W-92): the SAME seven one-sport PICKS hashes moved and ONLY those (Dashboard and Standings did not). The Picks page prints the What's New card, and it now holds
// the v0.30.1 entry (one line) instead of v0.30.0's. The fixture was rendered through sportenv.mjs on main (4e866058) and on this tree with the card's exact rendered text cut out: all seven Picks pages are
// byte-identical with the card cut, so the card is the only difference; the fourteen Dashboard and Standings pages are byte-identical. No sport-context code moved.
const GOLDEN = {
  'drafting/picks': 'a007a606cd185c93:5696', 'drafting/dashboard': '4054c60c93fee924:2906', 'drafting/leaderboard': '07c25cadde5c0738:22610',
  'submitted/picks': 'c0dcbe384ffb08eb:5573', 'submitted/dashboard': '34ea2d19294bb755:13324', 'submitted/leaderboard': '07c25cadde5c0738:22610',
  'one-row/picks': '34b56d6cfd1994d7:5593', 'one-row/dashboard': 'e4b6cafebce8eaa2:12278', 'one-row/leaderboard': '07c25cadde5c0738:22610',
  'locked/picks': '2229c1de28d9e82b:5378', 'locked/dashboard': '54d6960a63032f77:12384', 'locked/leaderboard': '07c25cadde5c0738:22610',
  'live/picks': '2506d772dd46daf4:1804', 'live/dashboard': '70013fb6baaf8db9:9812', 'live/leaderboard': '1e9c27d512d26eb2:22969',
  'signed-out/picks': 'd4d95d65dcf8443b:5039', 'signed-out/dashboard': '1f99658fac2fbab0:5636', 'signed-out/leaderboard': '145a625601f4d3f7:16871',
  'commissioner/picks': '271ee2980e95da5b:7319', 'commissioner/dashboard': 'd02f8dac28d130c9:10343', 'commissioner/leaderboard': '4c11eb4cf7757b20:23911',
};
const SCENARIOS = {
  'drafting': { sports: ['cfb'] },
  'submitted': { sports: ['cfb'], submitted: ['p1', 'p2', 'p3', 'p4'] },
  'one-row': { sports: ['cfb'], rows: true, submitted: ['p1'] },
  'locked': { sports: ['cfb'], weekStatus: { cfb: 'locked' }, submitted: ['p1'] },
  'live': { sports: ['cfb'], weekStatus: { cfb: 'live' }, submitted: ['p1', 'p2'] },
  'signed-out': { sports: ['cfb'], viewer: null },
  'commissioner': { sports: ['cfb'], isAdmin: true },
};
function renderAll(mod = env) {
  const out = {};
  for (const [name, opts] of Object.entries(SCENARIOS)) {
    mod.league(opts);
    for (const tab of ['picks', 'dashboard', 'leaderboard']) {
      let html;
      try { html = mod.render(tab); } catch (e) { html = 'THROW ' + e.message; }
      out[`${name}/${tab}`] = `${sha(html)}:${html.length}`;
    }
  }
  return out;
}
{
  const got = renderAll();
  const bad = Object.keys(GOLDEN).filter((k) => got[k] !== GOLDEN[k]);
  assert(Object.keys(GOLDEN).length === 21 && bad.length === 0, `[1a] all 21 one-sport renders are byte-identical to the unmodified code's (re-pinned 2026-10-08 to the server tree 17a9fa29, which carries the Who's-in strip; the sport-context code adds nothing) (differing: ${bad.join(', ') || 'none'})`);
    env.league({ sports: ['cfb'], submitted: ['p1'] });
  const pre = env.render('picks'); const dash = env.render('dashboard'); const stand = env.render('leaderboard');
  env.league({ sports: ['cfb'], rows: true, submitted: ['p1'] });
  assert(env.render('picks') === pre && env.render('dashboard') === dash && env.render('leaderboard') === stand, '[1b] one competition row (rows:true) renders IDENTICALLY to zero rows (pre-backfill) on all three tabs');
  env.league({ sports: ['cfb'], rows: true, submitted: ['p1'] });
  const html = env.render('picks') + env.render('dashboard') + env.render('leaderboard');
  assert(!/sport-seg|sport-chip|lo-card|league-overview|data-sport=|All sports/.test(html), '[1c] and carries no switcher, chip, overview card, sport attribute or "All sports" anywhere');
  const key = (k) => localStorage.getItem(k);
  assert(key('cfbp_active_sport') === null && key('cfbp_dashboard_scope') === null, '[1d] a one-sport league never writes either device-local pointer');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[2] THE THREE-WAY MATRIX - plays both / only CFB / neither…');
// ═════════════════════════════════════════════════════════════════
const SW = /class="sport-seg"/;
const BOTH = { sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, submitted: ['p1', 'p3'] };
const CFBONLY = { sports: ['cfb', 'nfl'], viewer: 'p2', plays: { nfl: ['p1', 'p3'] }, submitted: ['p1', 'p2', 'p3'] };
const NONE = { sports: ['cfb', 'nfl'], viewer: 'p1', plays: { cfb: ['p3'], nfl: ['p3'] } };
const TABS = ['picks', 'dashboard', 'leaderboard'];
const JOINISH = /data-lo-action="join"|Join (CFB|NFL)|Join picks|lo-join/;
{
  env.league(BOTH);
  const both = Object.fromEntries(TABS.map((t) => [t, env.render(t)]));
  assert(TABS.every((t) => SW.test(both[t])), '[2a] plays both: the switcher is the first thing on Picks, Dashboard and Standings');
  assert(!SW.test(both.picks.slice(both.picks.indexOf('</div></div>') + 12, both.picks.indexOf('</div></div>') + 400)) , '[2b] ...exactly once per page (not repeated under the first)');
  assert(/data-sport="all"/.test(both.dashboard) && !/data-sport="all"/.test(both.picks) && !/data-sport="all"/.test(both.leaderboard), '[2c] ...and "All sports" is a Dashboard-only segment (never on Picks or Standings)');
  assert(TABS.every((t) => !JOINISH.test(both[t])), '[2d] ...with no Join anywhere on the three tabs (joining is in the league overview and nowhere else)');
  assert(/aria-checked="true"[^>]*data-sport="cfb"/.test(both.picks), '[2e] ...and the default segment is the first sport the member plays');

  env.league(CFBONLY);
  const only = Object.fromEntries(TABS.map((t) => [t, env.render(t)]));
  assert(TABS.every((t) => !SW.test(only[t])), '[2f] plays only CFB: NO switcher on any tab (DI-555: a one-segment control is not drawn)');
  assert(TABS.every((t) => !/NFL/.test(withoutNotes(only[t]))), '[2g] ...and the word NFL appears nowhere on Picks, Dashboard or Standings (outside the platform What\'s New card, the one named exemption: release-note text, the same for every league)');
  // W-92 (v0.30.1, 2026-10-17): the card now holds the v0.30.1 entry, which names no sport, so the exemption is INERT today — the page holds no NFL word even WITH the card. Kept (bounded, on Picks only)
  // for the release that names a sport again.
  assert(only.picks.includes(platformNotesCard()) && !/NFL/.test(platformNotesCard()) && !/NFL/.test(only.picks) && withoutNotes(only.picks).length < only.picks.length && !only.dashboard.includes(platformNotesCard()) && !only.leaderboard.includes(platformNotesCard()), '[2g2] ...and the exemption is real and bounded: the card is on Picks only and cutting it shortens the page; with v0.30.1 it names no sport, so the Picks page holds no NFL word even uncut');
  assert(/NFL/.test(withoutNotes(only.picks + '<button class="btn">NFL</button>')) && /NFL/.test(withoutNotes(only.dashboard.replace('</div>', '<span>NFL</span></div>'))) && /NFL/.test(withoutNotes(only.picks.split(platformNotesCard()).join(platformNotesCard() + '<p>NFL picks are open</p>'))), '[2g3] ...and an NFL word anywhere else (after the card, on Dashboard, beside the card) still fails the check');
  assert(TABS.every((t) => !JOINISH.test(only[t])), '[2h] ...nor anything that leads to a Join');
  assert(/CFB-open-home/.test(env.renderFull('picks')) && /Drew|Brayden/.test(only.leaderboard), '[2i] ...and the CFB pages are the full CFB pages');
  assert(!/data-sport="all"/.test(only.dashboard), '[2j] ...with no "All sports"');

  env.league(NONE);
  const none = Object.fromEntries(TABS.map((t) => [t, env.render(t)]));
  assert(/id="picks-no-sport"/.test(none.picks) && /You're not in any sport's picks yet\./.test(none.picks) && /id="picks-open-overview-btn"/.test(none.picks), '[2k] plays neither: Picks says so, calmly, and offers the one way forward');
  assert(!/id="games-list"|class="pick-btn|submit-picks/.test(none.picks), '[2l] ...with no pick form at all');
  assert(TABS.every((t) => !SW.test(none[t]) && !JOINISH.test(none[t])), '[2m] ...and no switcher or Join on any of the three tabs');
  assert(!/NFL-open|CFB-open/.test(none.picks), '[2n] ...and no game of either sport is offered to be picked');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[3] EACH SPORT\'S PAGE IS ITS OWN…');
// ═════════════════════════════════════════════════════════════════
{
  env.league(BOTH);
  comp.setActiveSportKey('cfb');
  const cfbPicks = env.renderFull('picks');
  assert(/CFB-open-home/.test(cfbPicks) && !/NFL-open/.test(cfbPicks) && !/NFL-final/.test(cfbPicks), '[3a] CFB Picks lists CFB games and not one NFL game');
  comp.setActiveSportKey('nfl');
  const nflPicks = env.renderFull('picks');
  assert(/NFL-open-home/.test(nflPicks) && !/CFB-open/.test(nflPicks), '[3b] NFL Picks lists NFL games and not one CFB game');
  assert(/aria-checked="true"[^>]*data-sport="nfl"/.test(nflPicks), '[3c] ...with NFL the selected segment');
  const nflStand = env.render('leaderboard');
  assert(/Drew/.test(nflStand) && /Kevin/.test(nflStand) && !/Brayden/.test(nflStand) && !/Koby/.test(nflStand), '[3d] NFL Standings list only NFL\'s entrants (Drew, Kevin) - not the two who never joined');
  comp.setActiveSportKey('cfb');
  const cfbStand = env.render('leaderboard');
  assert(['Drew', 'Brayden', 'Kevin', 'Koby'].every((n) => cfbStand.includes(n)), '[3e] CFB Standings list all four');
  const nflDash = (comp.setActiveSportKey('nfl'), env.render('dashboard'));
  assert(/NFL-open-home/.test(nflDash) && !/CFB-open/.test(nflDash), '[3f] NFL Dashboard shows NFL games only');
  assert(/aria-checked="true"[^>]*data-sport="nfl"/.test(nflDash), '[3g] ...and the Dashboard\'s selected segment follows the sport');
  // the sport changes the page, not the other sport's pointer or the league's week
  comp.setActiveSportKey('cfb');
  assert(env.renderFull('picks') === cfbPicks, '[3h] going CFB -> NFL -> CFB leaves the CFB page exactly as it was');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4] FORGED STATE changes nothing…');
// ═════════════════════════════════════════════════════════════════
{
  const mapOf = (v) => JSON.stringify({ local: { [LEAGUE]: v } });
  env.league(CFBONLY);
  localStorage.setItem('cfbp_active_sport', mapOf('nfl'));
  const forged = env.renderFull('picks');
  assert(/CFB-open-home/.test(forged) && !/NFL/.test(withoutNotes(forged)), '[4a] a stored pointer at an UNPLAYED sport is ignored: the member sees CFB');
  assert(comp.getActiveSportKey() === 'cfb', '[4b] ...and the resolved sport is CFB');
  localStorage.setItem('cfbp_dashboard_scope', mapOf('all'));
  env.render('dashboard');
  assert(comp.getDashboardScope() === 'cfb' && !/data-sport="all"/.test(env.render('dashboard')), '[4c] a stored "all" scope for a member who plays one sport is ignored');

  env.league(BOTH);
  for (const v of ['nhl', '__proto__', 'constructor', '', 7, null, { a: 1 }]) {
    localStorage.setItem('cfbp_active_sport', mapOf(v));
    assert(comp.getActiveSportKey() === 'cfb', `[4d] a pointer of ${JSON.stringify(v)} resolves to the first played sport`);
  }
  localStorage.setItem('cfbp_active_sport', '{"__proto__":{"local":{}},"local":{"' + LEAGUE + '":"nfl"}}');
  assert(comp.getActiveSportKey() === 'nfl', '[4e] a poisoned sibling key in the stored map does not break the genuine entry');
  localStorage.setItem('cfbp_active_sport', 'not json');
  const realErr = console.error; console.error = () => {};
  const corrupt = comp.getActiveSportKey();
  console.error = realErr;
  assert(corrupt === 'cfb', '[4f] a corrupt pointer value resolves to the first played sport');
  // another account's pointer on the same handset
  localStorage.setItem('cfbp_active_sport', JSON.stringify({ 'someone-else': { [LEAGUE]: 'nfl' } }));
  assert(comp.getActiveSportKey() === 'cfb', '[4g] another account\'s stored pointer is not this account\'s (A5)');
  // the pointer for another league
  localStorage.setItem('cfbp_active_sport', JSON.stringify({ local: { 'L-other': 'nfl' } }));
  assert(comp.getActiveSportKey() === 'cfb', '[4h] another league\'s pointer is not this league\'s');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[5] HOME / PUSH / LINK ROUTING…');
// ═════════════════════════════════════════════════════════════════
{
  const closeOverview = () => { try { app._closeLeagueOverviewForTest({ immediate: true }); } catch { /* none open */ } };
  // a member who plays NFL: the action lands on the NFL tab
  env.league(BOTH);
  app.state.currentTab = 'home';
  app._onHomeActionForTest('go-tab', { tab: 'picks', sport: 'nfl' });
  assert(comp.getActiveSportKey() === 'nfl' && app.state.currentTab === 'picks' && /NFL-open-home/.test(env.page('picks').innerHTML + (env.els.get('games-list')?._html || '') + (env.els.get('submitted-games')?._html || '')), '[5a] go-tab {picks, nfl} for a member who plays NFL: the pointer is NFL and the NFL Picks page is up');
  // Part 2 item 6 (2026-10-08): with the pointer on the NFL, the COLLEGE Now card's "Make your picks" carries its sport (hometest I5) and lands on COLLEGE Picks - not on whatever sport the pointer was on
  comp.setActiveSportKey('nfl'); app.state.currentTab = 'home';
  app._onHomeActionForTest('go-tab', { tab: 'picks', sport: 'cfb' });
  assert(comp.getActiveSportKey() === 'cfb' && app.state.currentTab === 'picks' && /CFB-open-home/.test(env.page('picks').innerHTML + (env.els.get('games-list')?._html || '') + (env.els.get('submitted-games')?._html || '')) && !/NFL-open-home/.test(env.page('picks').innerHTML + (env.els.get('games-list')?._html || '')),
    '[5a2] with NFL current, a go-tab {picks, cfb} (the CFB Now card\'s button) opens CFB Picks, not NFL Picks');
  // dashboard with a week of THAT sport
  app._onHomeActionForTest('go-tab', { tab: 'dashboard', sport: 'cfb', weekId: 'w_cfb_1' });
  assert(comp.getActiveSportKey() === 'cfb' && app.state.viewingWeekId === 'w_cfb_1', '[5b] a week id of the sport is honoured (CFB Week 1 on the CFB Dashboard)');
  app._onHomeActionForTest('go-tab', { tab: 'dashboard', sport: 'cfb', weekId: 'w_nfl_1' });
  assert(app.state.viewingWeekId !== 'w_nfl_1', '[5c] ...but a week id of ANOTHER sport is never honoured across sports');
  // an unplayed sport: the overview opens, nothing else moves
  env.league(CFBONLY);
  app.state.currentTab = 'home';
  const before = localStorage.getItem('cfbp_active_sport');
  app._onHomeActionForTest('go-tab', { tab: 'picks', sport: 'nfl' });
  assert(localStorage.getItem('cfbp_active_sport') === before && comp.getActiveSportKey() === 'cfb', '[5d] go-tab for a sport the member does NOT play moves no pointer');
  assert(app._leagueOverviewStateForTest() !== null && app._leagueOverviewStateForTest().focusSport === 'nfl', '[5e] ...and opens the league overview with that sport\'s card in view (where Join lives)');
  assert(app.state.currentTab !== 'picks', '[5f] ...without navigating to the sport\'s tab');
  closeOverview();
  for (const bad of ['__proto__', 'nhl', 'NFL ', '../nfl', '']) {
    env.league(BOTH);
    const was = comp.getActiveSportKey();
    app._onHomeActionForTest('go-tab', { tab: 'picks', sport: bad });
    assert(comp.getActiveSportKey() === was, `[5g] a forged sport ${JSON.stringify(bad)} moves nothing`);
    closeOverview();
  }
  // ONE sport: a sport param is just the navigation
  env.league({ sports: ['cfb'], submitted: ['p1'] });
  app.state.currentTab = 'home';
  app._onHomeActionForTest('go-tab', { tab: 'picks', sport: 'cfb' });
  assert(app.state.currentTab === 'picks' && localStorage.getItem('cfbp_active_sport') === null, '[5h] a one-sport league: the action is just the navigation and nothing is stored');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[H] THE HEADER FOLLOWS THE SPORT (FB-001 class; coordinator Part 2 item 1, 2026-10-08)…');
// ═════════════════════════════════════════════════════════════════
// The header's week block (#header-meta-week) and the lock-flip timer used to read getCurrentWeek() - the DEFAULT sport's week - on every tab. Under the NFL switcher the header said "Week 2 OPEN" about the
// college week. Now: Picks / Dashboard / Standings show the CONTEXT sport's week with its code ("NFL Week 2"); All sports shows NO single week; Comm shows the LENS week; Home and Chat show the week of the
// member's current sport pointer (which only ever lands on a sport they play); a one-sport league is byte-for-byte what it was, with no code.
{
  const { els } = await import('./sportenv.mjs');
  const hdr = () => (els.get('header-meta-week') || {})._html || '';
  const strong = (h) => { const m = /<strong>([^<]*)<\/strong>/.exec(h); return m ? m[1] : null; };
  const reset = (o) => { app._clearPickDraftForTest(); for (const k of Object.keys(app._viewingBySportForTest)) delete app._viewingBySportForTest[k]; app._sportScrollForTest.clear(); const e = env.league(o); (els.get('header-meta-week') || {})._html = ''; return e; };
  const MULTI = { sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, submitted: ['p1', 'p3'] };
  const go = (tab) => { env.render(tab); return hdr(); };

  reset(MULTI);
  assert(strong(go('picks')) === 'CFB Week 2' && /badge-open/.test(hdr()), '[H-a] Picks on the default sport: "CFB Week 2" with the week\'s own badge');
  comp.setActiveSportKey('nfl');
  assert(strong(go('picks')) === 'NFL Week 2', '[H-b] ...and with the pointer on the NFL the header says "NFL Week 2" (it used to keep saying the college week)');
  assert(strong(go('dashboard')) === 'NFL Week 2' && strong(go('leaderboard')) === 'NFL Week 2', '[H-c] Dashboard and Standings follow the same context sport');
  comp.setDashboardScope('all');
  go('dashboard');
  assert(!/week-heading|badge/.test(hdr()) && hdr() === '', '[H-d] All sports: NO single week badge (the header week block is empty)');
  comp.setDashboardScope(null);
  assert(strong(go('home')) === 'NFL Week 2' && strong(go('chat')) === 'NFL Week 2', '[H-e] Home and Chat in a several-sport league show the week of the member\'s sport pointer, with its code');
  comp.setActiveSportKey('cfb');
  assert(strong(go('home')) === 'CFB Week 2' && strong(go('chat')) === 'CFB Week 2', '[H-f] ...and move with the pointer');

  // a member who plays ONLY the NFL never sees the college week in the header (the pointer only ever lands on a played sport)
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { cfb: ['p3'], nfl: ['p1', 'p3'] }, submitted: ['p1', 'p3'] });
  const onlyNfl = [go('home'), go('chat'), go('picks'), go('dashboard'), go('leaderboard')];
  assert(onlyNfl.every((h) => strong(h) === 'NFL Week 2') && !onlyNfl.some((h) => /CFB/.test(h)), '[H-g] a member who plays only the NFL: every tab says "NFL Week 2" and never names the college week');

  // the commissioner's lens: Comm shows the LENS week (a lens the pointer refuses - he has not joined the NFL - is still the week Comm acts on)
  reset({ sports: ['cfb', 'nfl'], viewer: 'p2', isAdmin: true, plays: { nfl: ['p1', 'p3'] }, submitted: ['p1', 'p3'] });
  const seam = await import('./js/sport-seam.js');
  seam.resetLensSport(); seam.setLensSport('nfl');
  assert(comp.getActiveSportKey() === 'cfb' && strong(go('commissioner')) === 'NFL Week 2', '[H-h] Comm: the header is the LENS week ("NFL Week 2") although the player\'s own pointer stays on CFB');
  seam.setLensSport('cfb');
  assert(strong(go('commissioner')) === 'CFB Week 2', '[H-i] ...and follows the lens back');
  seam.resetLensSport();

  // repaint on every sport switch and tab change - no full navigation needed
  reset(MULTI);
  go('picks');
  const before = strong(hdr());
  app._selectSportSegmentForTest('picks', 'nfl');
  assert(before === 'CFB Week 2' && strong(hdr()) === 'NFL Week 2', '[H-j] a sport switch repaints the header at once (CFB Week 2 -> NFL Week 2)');
  go('dashboard'); assert(strong(hdr()) === 'NFL Week 2', '[H-k0] fixture: the Dashboard is on the NFL before the switch');
  app._selectSportSegmentForTest('dashboard', 'all');
  assert(hdr() === '', '[H-k] switching to All sports clears the single-week badge');
  go('picks');
  assert(strong(hdr()) === 'NFL Week 2', '[H-l] a tab change back to a sport tab repaints it');

  // The lock-flip timer (it flips the badge at the lock instant) watches the SAME week the header shows.
  // RE-DERIVED 2026-10-08 (third pass, item 4; P-2 / D-66 "timers and gates are armed for real in their test"): [H-m]..[H-o] used to ask lockFlipWeek() which week the timer WOULD pick. They now
  // assert what a REAL paint, a REAL sport switch and a REAL press ARMED (_lockFlipStateForTest), each from a DISARMED timer, so nothing left over from an earlier paint can pass for it.
  const armed = () => app._lockFlipStateForTest();
  const armedOn = (id) => { const s = armed(); return s.armed === true && s.weekId === id; };
  reset(MULTI); comp.setActiveSportKey('nfl');
  app.disarmLockFlip(); env.render('picks');
  assert(armedOn('w_nfl_2'), `[H-m] a real Picks paint under the NFL pointer ARMS the one timer on the NFL week (${JSON.stringify(armed())})`);
  app.disarmLockFlip(); app._selectSportSegmentForTest('picks', 'cfb');
  assert(armedOn('w_cfb_2'), `[H-m2] ...and a real switch to CFB re-arms it on the CFB week (${JSON.stringify(armed())})`);
  app._selectSportSegmentForTest('picks', 'nfl');
  app.disarmLockFlip(); env.render('home');
  assert(armedOn('w_nfl_2'), `[H-n] ...a real Home paint arms it on the pointer's week, not the default sport's (${JSON.stringify(armed())})`);
  const { enableDocumentActions } = await import('./sportenv.mjs');
  const press = (action, sport) => { const b = env.page('commissioner').buttons().find((x) => x.dataset.action === action && x.dataset.sport === sport); if (b) b.click(); return !!b; };
  reset({ sports: ['cfb', 'nfl'], viewer: 'p2', isAdmin: true, plays: { nfl: ['p1', 'p3'] } });
  seam.resetLensSport(); seam.setLensSport('nfl');
  enableDocumentActions(true);
  try {
    app.disarmLockFlip(); env.render('commissioner');
    assert(armedOn('w_nfl_2'), `[H-o] a real Comm paint under the separate NFL lens arms it on the LENS week (${JSON.stringify(armed())})`);
    const pressed = press('comm-lens', 'cfb');
    assert(pressed && seam.getLensSport() === 'cfb' && strong(hdr()) === 'CFB Week 2' && armedOn('w_cfb_2'), `[H-o2] a real PRESS of the lens to CFB (no navigation): the header names CFB and the timer is re-armed on the CFB week it names (pressed ${pressed}, header ${strong(hdr())}, ${JSON.stringify(armed())})`);
  } finally { enableDocumentActions(false); }
  reset({ sports: ['cfb', 'nfl'], viewer: 'p2', isAdmin: true, plays: { nfl: ['p1', 'p3'] }, weekStatus: { nfl: 'draft' } });
  seam.resetLensSport();
  enableDocumentActions(true);
  try {
    app.disarmLockFlip(); env.render('commissioner');
    assert(armedOn('w_cfb_2'), `[H-o3] fixture: Comm on the CFB lens arms the CFB week (${JSON.stringify(armed())})`);
    const opened = press('comm-sport-action', 'nfl');
    assert(opened && env.st.getWeek('w_nfl_2').status === 'open' && seam.getLensSport() === 'nfl' && armedOn('w_nfl_2'), `[H-o4] a real PRESS of the NFL row's "Open for picks" (no navigation): the NFL week opens, the lens moves to it, and the timer now watches ITS lock instant (pressed ${opened}, status ${env.st.getWeek('w_nfl_2').status}, ${JSON.stringify(armed())})`);
  } finally { enableDocumentActions(false); }
  seam.resetLensSport();

  // a one-sport league is byte-identical to the unmodified header (captured from the server tree 17a9fa29; the merged tree prints the same) and never carries a sport code
  const TPL = (name, phase, label) => `<span class="week-heading week-heading-inline">\n      <span class="week-heading-name"><strong>${name}</strong><span class="badge badge-${phase} ml-sm">${label}</span></span>\n    </span>`;
  const STATES = [['draft', 'draft', 'DRAFT'], ['open', 'open', 'OPEN'], ['locked', 'locked', 'LOCKED'], ['live', 'live', 'LIVE']];
  const bad = [];
  for (const [status, phase, label] of STATES) {
    for (const rows of [false, true]) {
      reset({ sports: ['cfb'], rows, weekStatus: { cfb: status } });
      for (const tab of ['picks', 'dashboard', 'leaderboard', 'home', 'commissioner', 'chat']) {
        app.state.currentTab = tab; (els.get('header-meta-week') || {})._html = ''; app._refreshHeaderForTest();
        if (hdr() !== TPL('Week 2', phase, label)) bad.push(`${status}/rows=${rows}/${tab}`);
      }
    }
  }
  assert(bad.length === 0, `[H-p] a ONE-sport league: the header is byte-identical to the unmodified one on every tab and state, with no sport code (differing: ${bad.join(', ') || 'none'})`);
  reset({ sports: ['cfb'], weekStatus: { cfb: 'open' } });
  go('picks'); const afterNav = hdr();
  assert(afterNav === '', '[H-q] ...and navigating in a one-sport league does not touch the header at all (no extra paint)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[S] SMALL ITEMS (Part 2 item 10, 2026-10-08): profile stats, the week navigator, the no-week state, the segment easing, the harness header…');
// ═════════════════════════════════════════════════════════════════
{
  const { els } = await import('./sportenv.mjs');
  const reset = (o) => { app._clearPickDraftForTest(); for (const k of Object.keys(app._viewingBySportForTest)) delete app._viewingBySportForTest[k]; app._sportScrollForTest.clear(); return env.league(o); };
  const page = (tab) => { env.render(tab); return env.page(tab).innerHTML + (tab === 'picks' ? (els.get('games-list')?._html || '') + (els.get('submitted-games')?._html || '') : ''); };
  const MULTI = { sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, submitted: ['p1', 'p3'] };
  // [S-a] the profile's season stats are one sport's standings row: they say which
  reset(MULTI);
  assert(app.getPlayerProfile('p1', { withStats: true }).statsSport?.code === 'CFB', '[S-a1] the stats on a profile built while the pointer is on CFB are labelled CFB');
  comp.setActiveSportKey('nfl');
  const pf = app.getPlayerProfile('p1', { withStats: true });
  assert(pf.statsSport?.code === 'NFL' && pf.statsSport.dbCode === 'nfl' && pf.stats && pf.stats.playerId === 'p1', '[S-a2] ...and NFL while the pointer is on the NFL (the stats row is that sport\'s, and the label says so)');
  assert(!('statsSport' in app.getPlayerProfile('p1', { withStats: false })) || app.getPlayerProfile('p1', { withStats: false }).statsSport === null, '[S-a3] no stats requested: no label');
  reset({ sports: ['cfb'], rows: true });
  assert(!('statsSport' in app.getPlayerProfile('p1', { withStats: true })), '[S-a4] a ONE-sport league: the profile has no sport label at all (the object is the unmodified one)');

  // [S-b] the week navigator names the sport. RE-DERIVED 2026-10-08 (third pass, item 3e; DI-524 REV 5): every IN-PAGE label keeps the "{CODE} · Week N" form; only the HEADER badge is the
  // compact "{CODE} Week N" (its one-line row truncates the league pill first, DI-393). Part 2 had printed the header's form in the navigator too.
  const hdrStrong = () => { const m = /<strong>([^<]*)<\/strong>/.exec((els.get('header-meta-week') || {})._html || ''); return m ? m[1] : null; };
  reset(MULTI); comp.setActiveSportKey('nfl');
  const pkB = page('picks'); const pkHdr = hdrStrong(); const dbB = page('dashboard');
  assert(/<span class="picks-week-nav-label">NFL · Week 2<\/span>/.test(pkB) && /<span class="picks-week-nav-label">NFL · Week 2<\/span>/.test(dbB) && !/picks-week-nav-label">NFL Week/.test(pkB + dbB), '[S-b1] in a several-sport league the week navigator on Picks and Dashboard reads "NFL · Week 2" (the in-page form)');
  assert(pkHdr === 'NFL Week 2', `[S-b1h] ...while the HEADER badge on the same page keeps the compact "NFL Week 2" (got ${pkHdr})`);
  comp.setActiveSportKey('cfb');
  assert(/<span class="picks-week-nav-label">CFB · Week 2<\/span>/.test(page('picks')), '[S-b2] ...and "CFB · Week 2" on the college side');
  reset({ sports: ['cfb'], rows: true });
  assert(/<span class="picks-week-nav-label">Week 2<\/span>/.test(page('picks')) && !/picks-week-nav-label">CFB/.test(page('picks')), '[S-b3] a ONE-sport league: "Week 2", no code');

  // [S-c] the no-week state is named for its sport (NFL has no week at all; CFB does)
  const dropNfl = () => { const ws = JSON.parse(localStorage.getItem('cfbp_weeks')).filter((w) => w.competitionId !== CID.nfl); localStorage.setItem('cfbp_weeks', JSON.stringify(ws)); };
  reset(MULTI); dropNfl(); comp.setActiveSportKey('nfl');
  const pk = page('picks'), db = page('dashboard');
  assert(/No NFL picks to make yet/.test(pk) && /hasn&quot;t|hasn't|hasn&#39;t/.test(pk) && /in NFL yet/.test(pk), '[S-c1] Picks with no NFL week: "No NFL picks to make yet" and a sentence naming the NFL (not a bare "No picks to make yet")');
  assert(/No NFL picks to make yet/.test(db), '[S-c2] ...and the Dashboard says the same');
  app.state.currentTab = 'picks'; app._refreshHeaderForTest();
  assert(/No NFL week yet/.test((els.get('header-meta-week') || {})._html || ''), '[S-c3] ...and the header says "No NFL week yet"');
  reset({ ...MULTI, isAdmin: true }); dropNfl(); comp.setActiveSportKey('nfl');
  assert(/Set up first NFL week/.test(page('dashboard')) && /data-sport="nfl"/.test(page('dashboard')), '[S-c4] the commissioner\'s button names the sport and carries it ("Set up first NFL week")');
  const seam = await import('./js/sport-seam.js');
  seam.resetLensSport(); comp.setActiveSportKey('cfb');
  app._zeroWeekSetupForTest('nfl');
  assert(seam.getLensSport() === 'nfl' && env.bodyChildren.some((el) => el.id === 'week-wizard-sheet-wrap'), '[S-c5] ...and pressing it moves the lens to THAT sport before the wizard opens (so it builds an NFL week, not a college one)');
  try { document.getElementById('week-wizard-sheet-wrap')?.remove(); els.delete('week-wizard-sheet-wrap'); } catch { /* fixture hygiene */ }
  seam.resetLensSport();
  reset({ sports: ['cfb'], rows: true, isAdmin: true }); localStorage.setItem('cfbp_weeks', '[]');
  const one = page('dashboard');
  assert(/<h3>No picks to make yet<\/h3>/.test(one) && /Set up first week<\/button>/.test(one) && !/data-sport=/.test(one), '[S-c6] a ONE-sport league with no weeks: the unmodified words and button, no sport anywhere');

  // [S-d] the segmented control's easing is the app's token, not the CSS keyword
  const css = await read('./css/styles.css');
  const segRule = (css.match(/\.sport-seg-btn\{[^}]*\}/) || [''])[0];
  assert(/transition:transform var\(--motion-fast\) var\(--ease-native\),color var\(--motion-fast\) var\(--ease-native\)/.test(segRule) && !/ease-out/.test(segRule), '[S-d] .sport-seg-btn transitions use var(--ease-native) (one animation language), not `ease-out`');

  // [S-e] the shared harness names only suites that exist
  const envSrc = await read('./sportenv.mjs');
  const named = [...new Set((envSrc.slice(0, envSrc.indexOf('*/')).match(/\b[a-z][a-z0-9]*test\b/g) || []))];
  const { existsSync } = await import('node:fs');
  const missingSuites = named.filter((n) => !existsSync(fileURLToPath(new URL(`./${n}.mjs`, import.meta.url))));
  assert(named.length >= 5 && missingSuites.length === 0, `[S-e] sportenv.mjs's header names only suites that exist (${named.length} named; missing: ${missingSuites.join(', ') || 'none'})`);
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[L] DI-534 REV 5 - the Comm lens and the player pointer: one thing whenever they can be, two only when they cannot (third pass, item 3)…');
// ═════════════════════════════════════════════════════════════════
// The rule: setLensSport moves the pointer whenever the pointer accepts (the lens IS the pointer). Only a VERIFIED COMMISSIONER whom the pointer refuses (he has not joined that sport, C7) gets a
// separate, commissioner-only lens, read by Comm alone. It ENDS when he joins the sport (the pointer follows, they agree), the sport is archived, the role is lost, or the league / account changes.
// The caption "These controls change {CODE} only." exists only while the lens is separate, once under each lens control (Week tab, Games tab), never on a card.
{
  const { els, withMutantApp: withMutant, loadMutant } = await import('./sportenv.mjs');
  const seam = await import('./js/sport-seam.js');
  const separate = () => (typeof seam.lensIsSeparate === 'function' ? seam.lensIsSeparate() : null);
  const reset = (o) => { seam.resetLensSport(); app._clearPickDraftForTest(); for (const k of Object.keys(app._viewingBySportForTest)) delete app._viewingBySportForTest[k]; app._sportScrollForTest.clear(); return env.league(o); };
  const captions = (h) => [...h.matchAll(/These controls change ([A-Z]+) only\./g)].map((m) => m[1]);
  // every caption must sit INSIDE a lens block (`<div class="admin-section comm-lens" ...>` up to the next admin-section), never on a card
  const captionsOutsideLens = (h) => {
    let n = 0;
    for (const m of h.matchAll(/These controls change [A-Z]+ only\./g)) {
      const open = h.lastIndexOf('class="admin-section', m.index);
      if (open < 0 || !h.startsWith('class="admin-section comm-lens"', open)) n++;
    }
    return n;
  };
  const playerPages = () => ['picks', 'dashboard', 'leaderboard'].map((t) => env.renderFull(t) + '\n§hdr§' + ((els.get('header-meta-week') || {})._html || '')).join('\n§§\n');
  const comm = () => env.render('commissioner');
  const entryCard = (h) => { const i = h.indexOf('id="week-wizard-entry-card"'); return i < 0 ? '' : h.slice(i, h.indexOf('</div>\n  </div>', i)); };
  const COMM_CFB_ONLY = { sports: ['cfb', 'nfl'], viewer: 'p2', isAdmin: true, plays: { nfl: ['p1', 'p3'] } };   // p2 runs the league and plays only CFB

  // ordinary state first: the lens IS the pointer -> no caption on the Week tab, the Games tab (commSportLensHTML) or the week card (weekWizardEntryCardHTML)
  reset(COMM_CFB_ONLY);
  const c0 = comm();
  assert(separate() === false && captions(c0).length === 0 && /id="week-wizard-entry-title">CFB · Week 2</.test(c0), `[L-a1] ordinary state (lens = pointer = CFB): NO "These controls change" caption anywhere - Week tab, Games tab, week card - and the card still names its sport (captions: ${captions(c0).join(',') || 'none'})`);
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', isAdmin: true, plays: { nfl: ['p1', 'p3'] } });
  assert(seam.setLensSport('nfl') === true && comp.getActiveSportKey() === 'nfl' && separate() === false, '[L-a2] (a) a commissioner who plays both: setLensSport(\'nfl\') moves the POINTER and keeps no separate lens');
  const c0b = comm();
  assert(captions(c0b).length === 0 && /id="week-wizard-entry-title">NFL · Week 2</.test(c0b), `[L-a3] ...so it is still the ordinary state: no caption, the card reads "NFL · Week 2" (captions: ${captions(c0b).join(',') || 'none'})`);

  // (b) a CFB-only commissioner: the pointer refuses the NFL, so Comm holds a SEPARATE lens - and no player screen reads it
  reset(COMM_CFB_ONLY);
  const before = playerPages();
  const okB = seam.setLensSport('nfl');
  assert(okB === true && comp.getActiveSportKey() === 'cfb' && seam.getLensSport() === 'nfl' && separate() === true, `[L-b1] (b) a CFB-only commissioner: setLensSport('nfl') leaves the pointer on CFB and holds a separate NFL lens (pointer ${comp.getActiveSportKey()}, lens ${seam.getLensSport()}, separate ${separate()})`);
  const c1 = comm();
  assert(/id="week-wizard-entry-title">NFL · Week 2</.test(c1), '[L-b2] ...the Comm week card names its sport: "NFL · Week 2"');
  assert(JSON.stringify(captions(c1)) === '["NFL","NFL"]' && captionsOutsideLens(c1) === 0 && !/These controls change/.test(entryCard(c1)), `[L-b3] ...the caption "These controls change NFL only." appears ONCE under each lens control (Week tab, Games tab) and on no card (captions: ${captions(c1).join(',')}; outside a lens: ${captionsOutsideLens(c1)})`);
  const after = playerPages();
  assert(after === before, '[L-b4] ...and Picks, Dashboard and Standings (page and header) are BYTE-IDENTICAL to their markup before the call: no player screen reads the separate lens');

  // (c) that commissioner then JOINS the NFL: the separate lens ends, the pointer follows, the caption goes
  assert(seam.addEntry(CID.nfl, 'p2', 'self') === true, '[L-c0] fixture: the commissioner is now an NFL entrant');
  const lensAfterJoin = seam.getLensSport();
  assert(separate() === false && lensAfterJoin === 'nfl' && comp.getActiveSportKey() === 'nfl', `[L-c1] (c) he joins the NFL: the separate lens ENDS and the pointer FOLLOWS it - lens and pointer agree on NFL (lens ${lensAfterJoin}, pointer ${comp.getActiveSportKey()}, separate ${separate()})`);
  const c2 = comm();
  assert(captions(c2).length === 0 && /id="week-wizard-entry-title">NFL · Week 2</.test(c2), `[L-c2] ...the caption is gone, and the card still names NFL (captions: ${captions(c2).join(',') || 'none'})`);
  // (c) the edge: he PLAYS the sport but the pointer cannot STORE it (no league to key it by, a write the storage seam refuses while the adapter is not serving). The separate lens ends only when the
  // pointer really holds the sport - written and read back - never on "he plays it" alone; otherwise Comm would drop onto the other sport under his finger (found by wizardfinalizetest, third pass).
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', isAdmin: true, plays: { nfl: ['p1', 'p3'] } });
  seam._clientApiForTest({ setActiveSportKey: () => false });          // the pointer accepts nothing it is asked to store
  const okC3 = seam.setLensSport('nfl');
  const keptC3 = { lens: seam.getLensSport(), separate: separate(), again: seam.getLensSport() };
  seam._clientApiForTest(null);                                           // the pointer can store again: the next read ends the separate lens and the pointer follows
  const endedC3 = { lens: seam.getLensSport(), separate: separate(), pointer: comp.getActiveSportKey() };
  assert(okC3 === true && keptC3.lens === 'nfl' && keptC3.separate === true && keptC3.again === 'nfl', `[L-c3] a commissioner who plays NFL but whose pointer cannot store it KEEPS the NFL lens (Comm does not drop onto CFB) (${JSON.stringify(keptC3)})`);
  assert(endedC3.lens === 'nfl' && endedC3.separate === false && endedC3.pointer === 'nfl', `[L-c4] ...and once the pointer can store it, the separate lens ends and the pointer follows: lens and pointer agree on NFL (${JSON.stringify(endedC3)})`);
  seam.resetLensSport();

  // (d) a PLAYER (not a commissioner) calling setLensSport for a sport he has not joined
  reset({ sports: ['cfb', 'nfl'], viewer: 'p4', isAdmin: false, plays: { nfl: ['p1', 'p3'] } });
  const p0 = comp.getActiveSportKey();
  const okD = seam.setLensSport('nfl');
  assert(okD === false && separate() === false && seam.getLensSport() === p0 && comp.getActiveSportKey() === p0, `[L-d] (d) a player who is not a commissioner: setLensSport('nfl') is refused - no separate lens, the pointer unchanged (returned ${okD}, lens ${seam.getLensSport()}, pointer ${comp.getActiveSportKey()})`);

  // "It ends" - the role is lost, the sport is archived
  reset(COMM_CFB_ONLY); seam.setLensSport('nfl');
  assert(separate() === true, '[L-e0] fixture: a separate NFL lens');
  env.st.setSession('p2', false, true);
  assert(separate() === false && seam.getLensSport() === 'cfb', `[L-e1] the commissioner role is LOST: the separate lens ends and the lens is the pointer again (lens ${seam.getLensSport()})`);
  reset(COMM_CFB_ONLY); seam.setLensSport('nfl');
  const nflComp = env.comp.getCompetitions().find((c) => c.sport === 'nfl');
  env.comp.saveCompetition({ ...nflComp, archivedAt: '2026-10-08T00:00:00.000Z' });
  assert(separate() === false && seam.getLensSport() === 'cfb', `[L-e2] (e) the NFL is ARCHIVED: the separate lens is dropped and falls back to the pointer (lens ${seam.getLensSport()})`);
  seam.resetLensSport();

  // MUTATION PROOFS. (1) REV 5's own: let a player screen read the separate lens -> [L-b4] must go RED.
  const ctxAnchor = "  getActiveSportKey, setActiveSportKey, getContextCompetition, getContextWeek, getContextWeeks, getDashboardScope, setDashboardScope, clearSportContextExcept,\n  DASHBOARD_ALL,\n} from './competition.js';";
  const ctxLeak = "  getActiveSportKey, setActiveSportKey, getContextCompetition, getContextWeek as _realCtxWeek, getContextWeeks as _realCtxWeeks, getDashboardScope, setDashboardScope, clearSportContextExcept,\n  DASHBOARD_ALL,\n} from './competition.js';\nconst getContextWeek = () => lensWeek(null) || _realCtxWeek();\nconst getContextWeeks = () => { const c = lensCompetition(); return c ? getWeeksForCompetition(c.id) : _realCtxWeeks(); };";
  const leaked = await withMutant([[ctxAnchor, ctxLeak]], async () => { reset(COMM_CFB_ONLY); const b = playerPages(); seam.setLensSport('nfl'); const a = playerPages(); seam.resetLensSport(); return { same: a === b, nflOnPlayer: /picks-week-nav-label">NFL · Week 2</.test(a) && !/picks-week-nav-label">NFL · Week 2</.test(b) }; });
  assert(leaked.same === false && leaked.nflOnPlayer === true, `[L-m1] MUTANT: the player screens' week reads the separate lens -> the CFB-only commissioner's Picks / Dashboard move to "NFL · Week 2" and [L-b4]'s byte-identity goes RED (identical: ${leaked.same}, NFL on a player screen: ${leaked.nflOnPlayer})`);
  reset(COMM_CFB_ONLY); const b2 = playerPages(); seam.setLensSport('nfl');
  assert(playerPages() === b2, '[L-m1b] ...and with the real app back, the same sequence is byte-identical again');
  seam.resetLensSport();
  // (2) the seam's own rules, on in-memory copies of js/sport-seam.js
  const SEAM_SRC = await read('./js/sport-seam.js');
  const fnBody = (name) => (SEAM_SRC.match(new RegExp(`export function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`)) || [''])[0];
  const seamRed = async (label, name, replacement, check) => {
    const body = fnBody(name);
    if (!body) { assert(false, `${label} (anchor: export function ${name} not found)`); return; }
    const m = await loadMutant('./js/sport-seam.js', [[body, replacement]]);
    m.resetLensSport();
    let red;
    try { red = await check(m); } finally { m.resetLensSport(); }
    assert(red === true, `${label} -> RED`);
  };
  await seamRed('[L-m2] MUTANT: setLensSport keeps a separate lens for anyone the pointer refuses (no commissioner check) -> (d) fails', 'setLensSport',
    "export function setLensSport(dbCode) { const live = liveCompetitions(); if (!live.some((c) => c.sport === dbCode)) return false; let moved = false; try { moved = api('setActiveSportKey')(dbCode) !== false && api('getActiveSportKey')() === dbCode; } catch { moved = false; } _localLens = moved ? null : dbCode; return true; }",
    // the same four facts [L-d] asserts, read off the mutant: the RETURN value is the one the getter's own role check cannot repair (it drops the lens on the next read - a second layer)
    async (m) => { reset({ sports: ['cfb', 'nfl'], viewer: 'p4', isAdmin: false, plays: { nfl: ['p1', 'p3'] } }); const p = comp.getActiveSportKey(); const r = m.setLensSport('nfl'); return !(r === false && m.lensIsSeparate() === false && m.getLensSport() === p && comp.getActiveSportKey() === p); });
  await seamRed('[L-m3] MUTANT: getLensSport keeps the separate lens after the commissioner joins -> (c) fails', 'getLensSport',
    "export function getLensSport() { const live = liveCompetitions(); const valid = (k) => typeof k === 'string' && live.some((c) => c.sport === k); if (valid(_localLens)) return _localLens; _localLens = null; const k = api('getActiveSportKey')(); return valid(k) ? k : 'cfb'; }",
    async (m) => { reset(COMM_CFB_ONLY); m.setLensSport('nfl'); m.addEntry(CID.nfl, 'p2', 'self'); return m.getLensSport() === 'nfl' && comp.getActiveSportKey() === 'cfb'; });
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[6] MUTATION PROOFS on in-memory copies - each must turn a NAMED check RED…');
// ═════════════════════════════════════════════════════════════════
{
  const COMP_SRC = await read('./js/competition.js');
  const URL_OF = (rel) => new URL(rel, import.meta.url).href;
  const mutateCompetition = async (edits) => {
    let src = COMP_SRC;
    for (const [a, b] of edits) {
      const n = src.split(a).length - 1;
      if (n !== 1) throw new Error(`anchor must match exactly once (matched ${n}): ${a.slice(0, 70)}`);
      src = src.split(a).join(b);
    }
    src = src.replace(/from '\.\/([\w.\/-]+)'/g, (_m, f) => `from '${URL_OF('./js/' + f)}'`);
    return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  };
  // The surface checks above read the pointer through js/competition.js. A copy that trusts the stored pointer (A4/A5 broken) must fail the forged-state checks.
  const forgedChecks = async (c) => {
    env.league(CFBONLY);
    localStorage.setItem('cfbp_active_sport', JSON.stringify({ local: { [LEAGUE]: 'nfl' } }));
    const a = c.getActiveSportKey() === 'cfb';
    env.league(BOTH);
    localStorage.setItem('cfbp_active_sport', JSON.stringify({ local: { [LEAGUE]: 'nhl' } }));
    const b = c.getActiveSportKey() === 'cfb';
    env.league(CFBONLY);
    localStorage.setItem('cfbp_dashboard_scope', JSON.stringify({ local: { [LEAGUE]: 'all' } }));
    const d = c.getDashboardScope() === 'cfb';
    return { '4a/4b an unplayed pointer is ignored': a, '4d an unknown pointer is ignored': b, '4c a forged "all" scope is ignored': d };
  };
  const ctl = await forgedChecks(comp);
  assert(Object.values(ctl).every(Boolean), '[6-0] POSITIVE CONTROL: the real competition.js passes the forged-state checks');
  const redOn = async (label, edits, must) => {
    let res;
    try { res = await forgedChecks(await mutateCompetition(edits)); } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 80)]: false }; }
    const failed = Object.entries(res).filter(([, ok]) => !ok).map(([n]) => n);
    assert(failed.length > 0 && must.every((m) => failed.some((f) => f.startsWith(m))), `${label} -> RED on: ${failed.join(' | ') || '(nothing - the mutant SURVIVED)'}`);
  };
  const pointerLine = COMP_SRC.match(/export function getActiveSportKey\(\) \{[\s\S]*?\n\}/)[0];
  assert(/viewerPlaysCompetition|playedSports|played/.test(pointerLine), '[6-1] (anchor) getActiveSportKey() consults what the viewer plays');
  await redOn('[6-2] the stored pointer is trusted without asking whether the viewer plays it', [[pointerLine, `export function getActiveSportKey() { const v = readEntry(() => getActiveSportMap()); return typeof v === 'string' && v ? v : 'cfb'; }`]], ['4a/4b', '4d']);
  const scopeFn = COMP_SRC.match(/export function getDashboardScope\(\) \{[\s\S]*?\n\}/)[0];
  await redOn('[6-3] a stored "all" scope is honoured for a member who plays one sport', [[scopeFn, `export function getDashboardScope() { const v = readEntry(() => getDashboardScopeMap()); return v === DASHBOARD_ALL ? DASHBOARD_ALL : getActiveSportKey(); }`]], ['4c']);
}

// DI-555 has teeth: a switcher fed the league's sports instead of the sports the MEMBER plays draws an NFL button for a CFB-only member - and [2f]/[2g] go RED.
{
  const anchor = "  const sports = playedSports();\n  if (sports.length < 2) return;\n  const due = sportDueItems();";
  const seen = await withMutantApp([[anchor, "  const sports = leagueSports();\n  if (sports.length < 2) return;\n  const due = sportDueItems();"]], async () => { env.league(CFBONLY); return TABS.map((t) => env.render(t)); });
  assert(seen.some((h) => SW.test(h)) && seen.some((h) => /NFL/.test(withoutNotes(h))), '[6-6] MUTANT: the switcher lists the league\'s sports -> a CFB-only member gets a switcher and an NFL button ([2f] and [2g] would fail)');
  env.league(CFBONLY);
  assert(TABS.every((t) => !SW.test(env.render(t)) && !/NFL/.test(withoutNotes(env.render(t)))), '[6-7] ...and with the real app restored the same member sees neither a switcher nor an NFL word outside the platform card (so [6-6]\'s NFL clause is not vacuous: the card alone would have satisfied it)');
}

// The goldens must be able to FAIL: a one-line change to what the one-sport Picks nav lists turns them red (so [1a] is a real comparison, not a hash of nothing).
{
  const got = await withMutantApp([["const weeks = getContextWeeks().filter(w => w.showInHistory !== false && w.status !== WEEK_STATUS.DRAFT &&", "const weeks = getContextWeeks().slice(1).filter(w => w.showInHistory !== false && w.status !== WEEK_STATUS.DRAFT &&"]], async () => renderAll());
  const bad = Object.keys(GOLDEN).filter((k) => got[k] !== GOLDEN[k]);
  assert(bad.length > 0 && bad.some((k) => k.endsWith('/picks')), `[6-4] MUTANT: the one-sport Picks nav drops a week -> the golden goes RED on ${bad.slice(0, 3).join(', ') || '(nothing - the golden SURVIVED)'}`);
  const again = renderAll();
  assert(Object.keys(GOLDEN).every((k) => again[k] === GOLDEN[k]), '[6-5] ...and after the mutant the real app\'s goldens hold again');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
