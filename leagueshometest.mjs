/**
 * CFB Pickems — leagueshometest.mjs (UX Revamp, Group D — DI-312…316)
 * ================================================================================
 * Unit tests for js/leagues-home.js — the Leagues Journey's pure render +
 * routing module (T-03…T-07, UN-298/299/300/284). Precedent: brandtest.mjs /
 * grouptest.mjs — a focused standalone suite beside loadtest.mjs, run
 * directly (`node leagueshometest.mjs`) and (once wired) as part of the
 * mandatory `loadtest.mjs` import list per CONVENTIONS #26.
 *
 * Covers:
 *   [1] resolveLeagueEntryPath() against the full §0 table — all four rows,
 *       including its `singleLeagueRoute`/`warmRelaunch` parameters.
 *   [1b] REVIEWER GATE 3 (2026-09-25) — "one router": resolveLeagueEntryPath()
 *        and resolvePostSignInRoute() are swept across every
 *        membership-count × singleLeagueRoute × warm/cold cell and asserted
 *        to NEVER disagree (resolvePostSignInRoute() delegates rather than
 *        re-deriving, so this is a structural guarantee, not a coincidence).
 *   [2] resolvePostSignInRoute() × SINGLE_LEAGUE_ROUTE ('home'/'skip') ×
 *       warm/cold × membership count (0 / 1 / >1), including the future
 *       liveSportCount>1 cell.
 *   [2b] The module constant SINGLE_LEAGUE_ROUTE is locked at 'home' — the
 *        coordinator's held default — so a future silent edit shows in a
 *        diff instead of drifting quietly.
 *   [3] leagueCardHTML() — role badge is the CALLER's injected function
 *       (never a second implementation), Pilot badge present/absent
 *       (degrades gracefully when isPilotLeague omitted), required deps
 *       throw when missing, and a <script> league name is escaped.
 *   [4] renderLeaguesHome() — loading skeleton count/aria-busy, populated
 *       card count, the Create-League stub card is always last and carries
 *       the exact DI-313 copy.
 *   [5] comingSoonCopy()/COMING_SOON_COPY — exact DI-313/DI-316 strings,
 *       built from the one shared template.
 *   [6] renderComingSoonCard()/renderCreateLeagueStubCard()/
 *       renderAddSportStubCard() — every stub's data-coming-soon-copy
 *       attribute is EXACTLY the shared constant (never a bespoke inline
 *       string), structural check in the `_LEAGUE_RPC_ERROR_COPY_FOR_TEST`
 *       style already used elsewhere in this codebase.
 *   [7] makeShowComingSoonToast() — dispatches (copy, 'info') to the
 *       injected real showToast; throws without one.
 *   [8] deriveLeagueSports() — dedupe, label lookup via ESPN_SPORT_ENDPOINTS,
 *       safe default when nothing is supplied.
 *   [9] leaguePageBackAffordances() — native gets both controls, web gets
 *       only the visible back button (PARITY-BY-DESIGN).
 *   [10] renderLeaguePage() — sport cards per `sports`, "Add new sport"
 *        present only for a commissioner (absent, not disabled, otherwise),
 *        routing data-attributes present for the caller to read on tap.
 *        REVIEWER GATE 1 (2026-09-25): the sport glyph is NEVER an emoji —
 *        text-only fallback when `icon` is not injected, the injected
 *        `icon('sportFootball')` glyph when it is — and a <script> sport
 *        label is escaped.
 *   [11] leagueStandingsScopeLabel() — single-sport → 'Across College
 *        Football'; empty weeks → same safe default; >1 distinct sport →
 *        the named (not yet reachable) 'Across all sports' seam.
 *   [12] renderLeagueStandingsView() — empty state text when no weeks (even
 *        when `standingsRows` is non-empty — REVIEWER GATE 4's filtered-
 *        `weeks` contract); populated rows preserve input order (no re-sort,
 *        no re-filter); rows are read-only (no data-action on a row item);
 *        REVIEWER GATE 5: winPct is formatted EXACTLY as the Standings tab
 *        (`${winPct}%`, no forced decimal) and the record/win% cells carry
 *        explicit "weighted vs. raw" labels (CLAUDE.md Architecture bullet 5).
 *   [13] XSS sweep — a <script> name fed through every render function in
 *        this module never appears unescaped in the output, including
 *        `data-coming-soon-copy` and a sport `label` specifically.
 */

import {
  SINGLE_LEAGUE_ROUTE,
  resolveLeagueEntryPath,
  resolvePostSignInRoute,
  leagueCardHTML,
  renderLeaguesHome,
  LEAGUES_HOME_SKELETON_COUNT,
  comingSoonCopy,
  COMING_SOON_COPY,
  renderComingSoonCard,
  renderCreateLeagueStubCard,
  renderAddSportStubCard,
  makeShowComingSoonToast,
  deriveLeagueSports,
  leaguePageBackAffordances,
  renderLeaguePage,
  leagueStandingsScopeLabel,
  renderLeagueStandingsView,
} from './js/leagues-home.js';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// Mirrors app.js's real escHtml() exactly (js/app.js:19417) — a separate,
// deliberately identical fixture so this suite proves the CONTRACT (every
// injected escHtml is actually called at every sink), not a shared import
// that would hide a broken call site behind a shared implementation.
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Mirrors app.js's leagueRoleBadgeHTML()'s base two-variant output (js/app.js
// :21700) — the SECURITY F-6 privilege-hold override lives in app.js only
// (see leagues-home.js's file header); this fixture proves leagueCardHTML()
// renders whatever the injected function returns, not a second opinion.
function roleBadgeHTML(role) {
  return role === 'commissioner'
    ? `<span class="badge badge-open">Commissioner</span>`
    : `<span class="badge badge-draft">Player</span>`;
}

const XSS_NAME = '<script>evil()</script>';

console.log('\n[1] resolveLeagueEntryPath() — the full §0 table, including singleLeagueRoute/warmRelaunch');
{
  assert(resolveLeagueEntryPath({ membershipCount: 0, liveSportCount: 1 }) === 'landing', '0 memberships → landing');
  assert(resolveLeagueEntryPath({ membershipCount: 1, liveSportCount: 2 }) === 'league-page', '1 membership, >1 live sport → league-page (route/warm irrelevant)');
  assert(resolveLeagueEntryPath({ membershipCount: 1, liveSportCount: 2, singleLeagueRoute: 'skip', warmRelaunch: true }) === 'league-page', '…still league-page even with route=skip/warm=true — never skipped');
  assert(resolveLeagueEntryPath({ membershipCount: 2, liveSportCount: 1 }) === 'leagues-home', '>1 memberships → leagues-home');
  assert(resolveLeagueEntryPath({ membershipCount: 5, liveSportCount: 3 }) === 'leagues-home', '>1 memberships, >1 sports — still leagues-home (memberships tier wins)');
  assert(resolveLeagueEntryPath({}) === 'landing', 'defaults (no args) fail safe to landing, not a throw');

  // The held cell (1 membership, 1 live sport) — now route/warm-dependent,
  // this function's own default matches SINGLE_LEAGUE_ROUTE ('home') and
  // warmRelaunch:false, so its bare default is 'leagues-home', NOT 'six-tab'
  // (that was true before this function took the route/warm parameters).
  assert(resolveLeagueEntryPath({ membershipCount: 1, liveSportCount: 1 }) === 'six-tab', "1/1 cell, no overrides → module defaults (route='skip' per Drew's 2026-09-25 ruling, warm=false) → six-tab");
  assert(resolveLeagueEntryPath({ membershipCount: 1, liveSportCount: 1, singleLeagueRoute: 'skip', warmRelaunch: false }) === 'six-tab', "1/1 cell, route='skip', cold → six-tab (the DI's own §0 recommendation)");
  assert(resolveLeagueEntryPath({ membershipCount: 1, liveSportCount: 1, singleLeagueRoute: 'skip', warmRelaunch: true }) === 'six-tab', "1/1 cell, route='skip', warm → six-tab");
  assert(resolveLeagueEntryPath({ membershipCount: 1, liveSportCount: 1, singleLeagueRoute: 'home', warmRelaunch: false }) === 'leagues-home', "1/1 cell, route='home', cold → leagues-home");
  assert(resolveLeagueEntryPath({ membershipCount: 1, liveSportCount: 1, singleLeagueRoute: 'home', warmRelaunch: true }) === 'six-tab', "1/1 cell, route='home', warm → six-tab fast path");
}

console.log('\n[1b] ONE ROUTER — resolveLeagueEntryPath() and resolvePostSignInRoute() never disagree (reviewer gate 3)');
{
  let cells = 0;
  for (const membershipCount of [0, 1, 2]) {
    for (const liveSportCount of membershipCount === 1 ? [1, 2] : [1]) {
      for (const route of ['home', 'skip']) {
        for (const warmRelaunch of [false, true]) {
          const memberships = membershipCount === 0
            ? []
            : membershipCount === 1
              ? [{ leagueId: 'irb', liveSportCount }]
              : [{ leagueId: 'a' }, { leagueId: 'b' }];
          const direct = resolveLeagueEntryPath({ membershipCount, liveSportCount, singleLeagueRoute: route, warmRelaunch });
          const viaPostSignIn = resolvePostSignInRoute({ memberships, lastLeagueId: 'irb', warmRelaunch, singleLeagueRoute: route }).screen;
          cells++;
          assert(direct === viaPostSignIn, `agree: count=${membershipCount}, sports=${liveSportCount}, route=${route}, warm=${warmRelaunch} → both say "${direct}"`);
        }
      }
    }
  }
  assert(cells === 16, `swept all 16 cells of the count×route×warm table (0 and >1 memberships collapse liveSportCount to one value each) (got ${cells})`);
}

console.log('\n[2] resolvePostSignInRoute() — SINGLE_LEAGUE_ROUTE × warm/cold × membership count');
{
  // 0 memberships — always landing, regardless of route/warm.
  for (const route of ['home', 'skip']) {
    for (const warmRelaunch of [false, true]) {
      const r = resolvePostSignInRoute({ memberships: [], warmRelaunch, singleLeagueRoute: route });
      assert(r.screen === 'landing', `0 memberships, route=${route}, warm=${warmRelaunch} → landing`);
    }
  }
  // >1 memberships — always leagues-home, regardless of route/warm.
  const many = [{ leagueId: 'a' }, { leagueId: 'b' }];
  for (const route of ['home', 'skip']) {
    for (const warmRelaunch of [false, true]) {
      const r = resolvePostSignInRoute({ memberships: many, warmRelaunch, singleLeagueRoute: route });
      assert(r.screen === 'leagues-home', `2 memberships, route=${route}, warm=${warmRelaunch} → leagues-home`);
    }
  }
  // 1 membership, >1 live sport (future) — always league-page, regardless of route/warm.
  const futureOne = [{ leagueId: 'irb', liveSportCount: 2 }];
  for (const route of ['home', 'skip']) {
    for (const warmRelaunch of [false, true]) {
      const r = resolvePostSignInRoute({ memberships: futureOne, warmRelaunch, singleLeagueRoute: route });
      assert(r.screen === 'league-page' && r.leagueId === 'irb', `1 membership/>1 sport, route=${route}, warm=${warmRelaunch} → league-page`);
    }
  }
  // 1 membership, 1 live sport — the held cell.
  const oneOnly = [{ leagueId: 'irb', liveSportCount: 1 }];
  assert(resolvePostSignInRoute({ memberships: oneOnly, warmRelaunch: false, singleLeagueRoute: 'skip' }).screen === 'six-tab', "route='skip', cold → six-tab");
  assert(resolvePostSignInRoute({ memberships: oneOnly, warmRelaunch: true, singleLeagueRoute: 'skip' }).screen === 'six-tab', "route='skip', warm → six-tab");
  assert(resolvePostSignInRoute({ memberships: oneOnly, warmRelaunch: false, singleLeagueRoute: 'home' }).screen === 'leagues-home', "route='home', cold → leagues-home");
  const warmHome = resolvePostSignInRoute({ memberships: oneOnly, warmRelaunch: true, singleLeagueRoute: 'home', lastLeagueId: 'irb' });
  assert(warmHome.screen === 'six-tab' && warmHome.leagueId === 'irb', "route='home', warm → six-tab fast path, carries lastLeagueId");
  const warmHomeNoLast = resolvePostSignInRoute({ memberships: oneOnly, warmRelaunch: true, singleLeagueRoute: 'home' });
  assert(warmHomeNoLast.screen === 'six-tab' && warmHomeNoLast.leagueId === 'irb', "route='home', warm, no lastLeagueId → falls back to the only membership");
  // liveSportCount defaults to 1 when a real membership omits it (every league today).
  const noSportCountField = [{ leagueId: 'irb' }];
  assert(resolvePostSignInRoute({ memberships: noSportCountField, warmRelaunch: false, singleLeagueRoute: 'skip' }).screen === 'six-tab', 'missing liveSportCount defaults to 1, not a throw');
}

console.log('\n[2b] SINGLE_LEAGUE_ROUTE is locked at the coordinator\'s held default');
{
  assert(SINGLE_LEAGUE_ROUTE === 'skip', "SINGLE_LEAGUE_ROUTE === 'skip' — Drew ruled §0 option (b) on 2026-09-25: a single-league player skips Leagues Home and the league page");
}

console.log('\n[3] leagueCardHTML()');
{
  const commish = { leagueId: 'irb', leagueName: 'IRB Football', role: 'commissioner' };
  const html = leagueCardHTML(commish, { escHtml, roleBadgeHTML, isPilotLeague: () => true });
  assert(html.includes('IRB Football'), 'league name renders');
  assert(html.includes('badge-pilot') && html.includes('>Pilot<'), 'Pilot badge renders when isPilotLeague() is true');
  assert(html.includes('badge-open') && html.includes('Commissioner'), 'role badge is the CALLER\'s injected roleBadgeHTML output');
  assert(html.includes('data-action="switch-league"') && html.includes('data-league-id="irb"'), 'card carries routing data-attributes, not a bound listener');

  const noPilot = leagueCardHTML({ leagueId: 'x', leagueName: 'Test League', role: 'player' }, { escHtml, roleBadgeHTML });
  assert(!noPilot.includes('badge-pilot') && !noPilot.includes('>Pilot<'), 'Pilot badge is ABSENT (not a placeholder) when isPilotLeague is omitted — degrades gracefully');

  let threw = false;
  try { leagueCardHTML(commish, { roleBadgeHTML }); } catch { threw = true; }
  assert(threw, 'leagueCardHTML() throws without escHtml (CONVENTIONS #12 enforced structurally)');

  let threw2 = false;
  try { leagueCardHTML(commish, { escHtml }); } catch { threw2 = true; }
  assert(threw2, 'leagueCardHTML() throws without roleBadgeHTML — never falls back to a second implementation');

  const xss = leagueCardHTML({ leagueId: 'y', leagueName: XSS_NAME, role: 'player' }, { escHtml, roleBadgeHTML });
  assert(!xss.includes('<script>'), 'league name is escaped — a <script> name never appears raw');
}

console.log('\n[4] renderLeaguesHome()');
{
  const loadingHtml = renderLeaguesHome({ loading: true, escHtml });
  const skeletonCount = (loadingHtml.match(/league-card-skeleton"/g) || []).length;
  assert(loadingHtml.includes('aria-busy="true"'), 'loading state is marked aria-busy, never a blank screen');
  assert(skeletonCount === LEAGUES_HOME_SKELETON_COUNT, `loading state renders exactly LEAGUES_HOME_SKELETON_COUNT (${LEAGUES_HOME_SKELETON_COUNT}) placeholders`);

  const two = [
    { leagueId: 'irb', leagueName: 'IRB Football', role: 'commissioner' },
    { leagueId: 'test', leagueName: 'Test League', role: 'player' },
  ];
  const html = renderLeaguesHome({ memberships: two, escHtml, roleBadgeHTML });
  assert(html.includes('IRB Football') && html.includes('Test League'), 'both league cards render');
  assert(html.indexOf('data-action="coming-soon"') > html.lastIndexOf('data-action="switch-league"'), 'the Create-League stub card is the LAST card in the list');
  assert(html.includes(escHtml(COMING_SOON_COPY.createLeague)), 'the stub card carries the exact DI-313 toast copy');
}

console.log('\n[5] comingSoonCopy() / COMING_SOON_COPY — exact DI-313/DI-316 strings');
{
  assert(
    COMING_SOON_COPY.createLeague === "Creating additional leagues isn't available yet — it's coming in a future update.",
    'DI-313 exact copy'
  );
  assert(
    COMING_SOON_COPY.addSport === "Adding additional sports isn't available yet — it's coming in a future update.",
    'DI-316 exact copy'
  );
  assert(comingSoonCopy('Foo') === "Foo isn't available yet — it's coming in a future update.", 'the shared template composes correctly for a future stub (e.g. T-13k Help Center)');
}

console.log('\n[6] Every stub card routes through the shared pattern, never a bespoke string');
{
  const createHtml = renderCreateLeagueStubCard({ escHtml });
  assert(createHtml.includes(`data-coming-soon-copy="${escHtml(COMING_SOON_COPY.createLeague)}"`), 'Create-League stub carries the exact shared copy as a data attribute');
  assert(createHtml.includes('data-action="coming-soon"'), 'Create-League stub is tagged for the one delegated handler');

  const addSportHtml = renderAddSportStubCard({ escHtml });
  assert(addSportHtml.includes(`data-coming-soon-copy="${escHtml(COMING_SOON_COPY.addSport)}"`), 'Add-Sport stub carries the exact shared copy as a data attribute');

  let threwNoCopy = false;
  try { renderComingSoonCard({ title: 'x', escHtml }); } catch { threwNoCopy = true; }
  assert(threwNoCopy, 'renderComingSoonCard() refuses to render without copy — no silent no-op stub');

  const xssCard = renderComingSoonCard({ title: XSS_NAME, subtitle: XSS_NAME, copy: 'safe copy', escHtml });
  assert(!xssCard.includes('<script>'), 'a <script> title/subtitle is escaped in a coming-soon card');

  // Plus assertion (reviewer) — the `data-coming-soon-copy` ATTRIBUTE ITSELF
  // is escaped, defense in depth even though today's two callers only ever
  // pass the fixed COMING_SOON_COPY constants.
  const xssCopyCard = renderComingSoonCard({ title: 'x', copy: XSS_NAME, escHtml });
  assert(!xssCopyCard.includes('<script>'), 'a <script> in `copy` never appears raw in the data-coming-soon-copy attribute');
  assert(xssCopyCard.includes(`data-coming-soon-copy="${escHtml(XSS_NAME)}"`), '…the attribute carries the ESCAPED copy exactly');
}

console.log('\n[7] makeShowComingSoonToast()');
{
  let called = null;
  const showComingSoonToast = makeShowComingSoonToast((msg, type) => { called = { msg, type }; });
  showComingSoonToast(COMING_SOON_COPY.addSport);
  assert(called && called.msg === COMING_SOON_COPY.addSport && called.type === 'info', 'dispatches to the injected real showToast with type "info"');

  let threw = false;
  try { makeShowComingSoonToast(null); } catch { threw = true; }
  assert(threw, 'makeShowComingSoonToast() throws without a real showToast function');
}

console.log('\n[8] deriveLeagueSports()');
{
  const one = deriveLeagueSports({ sportDefault: 'college-football', weekSports: ['college-football', 'college-football'] });
  assert(one.length === 1 && one[0].key === 'college-football' && one[0].label === 'College Football', 'dedupes and labels from ESPN_SPORT_ENDPOINTS');

  const two = deriveLeagueSports({ sportDefault: 'college-football', weekSports: ['nfl'] });
  assert(two.length === 2 && two.some(s => s.key === 'nfl' && s.label === 'NFL'), 'unions sport_default with weeks.sport, both labeled from the one source of truth');

  const empty = deriveLeagueSports({});
  assert(empty.length === 1 && empty[0].key === 'college-football', 'safe default (college-football) when nothing is supplied — matches migration 0001\'s not-null default');
}

console.log('\n[9] leaguePageBackAffordances() — PARITY-BY-DESIGN');
{
  const native = leaguePageBackAffordances({ isNativeShell: true });
  assert(native.backButton === true && native.swipeBack === true, 'native: both the visible control and swipe-back');
  const web = leaguePageBackAffordances({ isNativeShell: false });
  assert(web.backButton === true && web.swipeBack === false, 'web: only the visible control, no competing gesture');
}

console.log('\n[10] renderLeaguePage()');
{
  const league = { leagueId: 'irb', leagueName: 'IRB Football' };
  const sports = deriveLeagueSports({ sportDefault: 'college-football', weekSports: [] });
  // No football emoji anywhere in the module — grep the source itself as a
  // structural guard, not just this one rendered output.
  const EMOJI_RE = /🏈/;

  const asCommish = renderLeaguePage(league, { isCommissioner: true, sports, escHtml });
  assert(asCommish.includes('College Football'), 'sport card renders the label');
  assert(!EMOJI_RE.test(asCommish), 'REVIEWER GATE 1: no emoji glyph when icon is not injected — text-only fallback');
  assert(asCommish.includes('data-action="open-sport"') && asCommish.includes('data-sport="college-football"') && asCommish.includes('data-league-id="irb"'), 'sport tap carries {leagueId, sport} as data-attributes for the caller to route on');
  assert(asCommish.includes('League Standings') && asCommish.includes('data-action="open-league-standings"'), 'League Standings entry row renders');
  assert(asCommish.includes('add-sport-card'), 'commissioner sees the Add-Sport stub');

  // With a real (fixture) icon family injected, the glyph comes from it —
  // never a hard-coded map — using group E's exact camelCase key.
  const fixtureIcon = name => (name === 'sportFootball' ? '<svg data-icon="sportFootball"></svg>' : name === 'chevronRight' ? '<svg data-icon="chevronRight"></svg>' : '');
  const withIcon = renderLeaguePage(league, { isCommissioner: true, sports, escHtml, icon: fixtureIcon });
  assert(withIcon.includes('data-icon="sportFootball"'), 'the sport glyph is whatever the injected icon(\'sportFootball\') returns');
  assert(!EMOJI_RE.test(withIcon), 'still no emoji, even with a real icon injected');

  const asPlayer = renderLeaguePage(league, { isCommissioner: false, sports, escHtml });
  assert(!asPlayer.includes('add-sport-card'), 'non-commissioner: Add-Sport stub is ABSENT entirely, not disabled');

  const xssLeague = renderLeaguePage({ leagueId: 'z', leagueName: XSS_NAME }, { sports, escHtml });
  assert(!xssLeague.includes('<script>'), 'league name in the League Page header is escaped');

  const xssSports = [{ key: 'college-football', label: XSS_NAME }];
  const xssSportLabel = renderLeaguePage(league, { sports: xssSports, escHtml });
  assert(!xssSportLabel.includes('<script>'), 'REVIEWER GATE (plus assertion): a <script> sport LABEL is escaped');
}

console.log('\n[11] leagueStandingsScopeLabel()');
{
  assert(leagueStandingsScopeLabel([{ sport: 'college-football' }, { sport: 'college-football' }]) === 'Across College Football', 'single-sport weeks → "Across College Football"');
  assert(leagueStandingsScopeLabel([]) === 'Across College Football', 'no weeks → same safe default, never a crash');
  assert(leagueStandingsScopeLabel([{ sport: 'college-football' }, { sport: 'nfl' }]) === 'Across all sports', '>1 distinct sport → the named (not yet reachable in prod) roll-up seam');
}

console.log('\n[12] renderLeagueStandingsView()');
{
  const empty = renderLeagueStandingsView({ standingsRows: [], weeks: [], escHtml });
  assert(empty.includes('No results yet. Standings will appear once'), 'empty state explains what/why/what-next, never a blank page');

  const rows = [
    { currentRank: 1, displayName: 'Kihoon', totalCorrect: 12, totalIncorrect: 3, winPct: 80 },
    { currentRank: 2, displayName: 'Drew', totalCorrect: 9, totalIncorrect: 6, winPct: 53.3 },
  ];
  const weeks = [{ sport: 'college-football' }];

  // REVIEWER GATE 4 — `weeks` MUST be the caller's already-filtered list
  // (same filter renderLeaderboard() uses); an EMPTY filtered list yields
  // the empty state even when `standingsRows` is non-empty (e.g. every
  // scored week was a demo week and got filtered out upstream, but a stale
  // standingsRows array is still lying around) — this module trusts
  // `weeks.length` alone, never `standingsRows.length`, for that gate.
  const emptyWeeksNonEmptyRows = renderLeagueStandingsView({ standingsRows: rows, weeks: [], escHtml });
  assert(emptyWeeksNonEmptyRows.includes('No results yet. Standings will appear once'), 'REVIEWER GATE 4: empty FILTERED weeks list → empty state, even with non-empty standingsRows');
  assert(!emptyWeeksNonEmptyRows.includes('Kihoon'), '…and the (would-be-stale) rows are not rendered in that case');

  const populated = renderLeagueStandingsView({ standingsRows: rows, weeks, escHtml });
  assert(populated.includes('Across College Football'), 'scope label renders');
  assert(populated.indexOf('Kihoon') < populated.indexOf('Drew'), 'row order is preserved exactly as the caller supplied it — no re-sort in this module');
  // REVIEWER GATE 5 — formatted EXACTLY like the Standings tab (js/app.js:9836
  // `${s.winPct}%`): "80%" not "80.0%", and "53.3%" preserved as-is (no
  // re-rounding), because winPct already carries calculateSeasonStandings()'s
  // own precision.
  assert(populated.includes('12-3') && populated.includes('>80%<'), 'record renders unchanged; win% renders as the Standings tab does — "80%", never "80.0%"');
  assert(populated.includes('>53.3%<'), 'a non-round winPct (53.3) is not re-formatted to a different decimal count');
  assert(!populated.includes('80.0%') && !populated.includes('53.3%%'), 'no forced-decimal or double-percent formatting anywhere');
  // Weighted-record vs raw-win% must be labeled, not just adjacent (CLAUDE.md
  // Architecture bullet 5 — the two tallies are never interchangeable).
  assert(populated.includes('W-L (wtd)') && populated.includes('Win % (raw)'), 'the record and win% cells carry an explicit weighted-vs-raw label (header row)');
  assert((populated.match(/W-L \(wtd\)/g) || []).length === 1, 'the label header renders exactly once, not once per row');
  assert(!/league-standings-row-item"[^>]*data-action/.test(populated), 'standings rows carry no data-action — read-only, no per-player drill-down');

  const xssRows = [{ currentRank: 1, displayName: XSS_NAME, totalCorrect: 1, totalIncorrect: 0, winPct: 100 }];
  const xssPopulated = renderLeagueStandingsView({ standingsRows: xssRows, weeks, escHtml });
  assert(!xssPopulated.includes('<script>'), 'a <script> player name in a standings row is escaped');
}

console.log('\n[13] XSS sweep — required escHtml enforced at every render function');
{
  let allThrow = true;
  const fns = [
    () => leagueCardHTML({ leagueId: 'a', leagueName: 'x' }, { roleBadgeHTML }),
    () => renderLeaguesHome({ memberships: [{ leagueId: 'a' }], roleBadgeHTML }),
    () => renderComingSoonCard({ title: 'x', copy: 'y' }),
    () => renderLeaguePage({ leagueId: 'a' }, {}),
    () => renderLeagueStandingsView({}),
  ];
  for (const fn of fns) {
    try { fn(); allThrow = false; } catch { /* expected */ }
  }
  assert(allThrow, 'every render function in this module refuses to run without an injected escHtml');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
