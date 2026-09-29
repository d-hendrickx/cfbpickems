/**
 * CFB Pickems — rolestest.mjs (UX Revamp Group B, DI-317/318/320, 2026-09-25)
 * ============================================================================
 * Static/pure coverage for `js/roles.js` and for the security-critical structural
 * guarantees DI-317/DI-318's §5 asks this suite to make testable rather than merely
 * stated:
 *
 *   1. Pure unit tests of isPlatformAdmin() / isCommissionerOf() / isPilotLeague() /
 *      canOperateCard() against DI-320's per-card operability table.
 *   2. Whole-tree allow-list scan (§2b.11/F13) — `isPlatformAdmin` may appear, client-side,
 *      ONLY in js/roles.js, inside `_recomputeSynthesizedSession()` in js/auth.js, inside
 *      js/admin-panel.js, or at an enumerated chrome-gating call-site list. A hit anywhere
 *      else fails the suite by name.
 *   3. The picks-visibility fence — `canViewOtherPicks()`, `arePicksPublic()`, the
 *      `canSeeOthers` locals, and the two js/extra-point.js injection sites never
 *      reference `isPlatformAdmin` (DI-317 §Security point 1, AD-29's failure mode).
 *   4. The claim-code trio (`issue_claim_code`, `get_claim_codes`, `unlink_member`) never
 *      mentions `is_platform_admin` in any migration (F12).
 *   5. `get_member_contacts` is never referenced from an admin cross-league render path
 *      (N6) — today that is "never referenced at all," honestly, because js/admin-panel.js
 *      does not exist yet in this build wave.
 *   6. The SQL draft's `admin_set_member_role` SET-list scan (F3/F8): contains
 *      `set role = ` / `set active = `, never `set email` / `set phone_verified` /
 *      `set created_at`.
 *   7. The SQL draft's `league_members_guard()` privileged branch mentions
 *      `app.role_change` and never `is_platform_admin` (N1/N4).
 *   8. (R-c, Group F fix round 2) BOTH GUC escapes are bounded by their SET lists, scanned
 *      under one heading: `admin_set_member_role()` (arms `app.role_change`, B_roles_pilot.sql)
 *      and `anonymize_own_account()` (arms `app.account_anonymize`, F_accounts.sql) — the
 *      second must never assign `role` or `phone_verified`. Neither escape is a per-column
 *      grant, so each function's own SET list is the real boundary.
 *
 * Run:  node rolestest.mjs
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, detail ? `— ${detail}` : ''); }
}

const { isPlatformAdmin, isCommissionerOf, isPilotLeague, canOperateCard, CARD_OPERABILITY,
  isSuperAdmin, isLeaguePaused } = await import('./js/roles.js');

// ════════════════════════════════════════════════════════════════════════════════════════
// 1. isPlatformAdmin()
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── isPlatformAdmin() ──');
{
  assert(isPlatformAdmin(undefined) === false, 'undefined session -> false');
  assert(isPlatformAdmin(null) === false, 'null session -> false');
  assert(isPlatformAdmin({}) === false, 'empty session (mid-hydrate shape) -> false, not undefined-is-truthy');
  assert(isPlatformAdmin({ isPlatformAdmin: false }) === false, 'explicit false -> false');
  assert(isPlatformAdmin({ isPlatformAdmin: true }) === true, 'explicit true -> true');
  assert(isPlatformAdmin({ isPlatformAdmin: 1 }) === false, 'truthy-but-not-boolean-true (1) -> false — strict === true only');
  assert(isPlatformAdmin({ isAdmin: true }) === false, 'commissioner flag (isAdmin) alone never implies platform admin — the two flags are never merged');
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 2. isCommissionerOf()
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── isCommissionerOf() ──');
{
  assert(isCommissionerOf(undefined, 'L1') === false, 'undefined session -> false');
  assert(isCommissionerOf({}, undefined) === false, 'undefined leagueId -> false');

  // Legacy single-league auth.js session shape.
  assert(isCommissionerOf({ isAdmin: true, activeLeagueId: 'L1' }, 'L1') === true,
    'single-league shape: isAdmin true + matching activeLeagueId -> true');
  assert(isCommissionerOf({ isAdmin: true, activeLeagueId: 'L1' }, 'L2') === false,
    'single-league shape: isAdmin true but a DIFFERENT league -> false (never broadens to "commissioner of anything")');
  assert(isCommissionerOf({ isAdmin: false, activeLeagueId: 'L1' }, 'L1') === false,
    'single-league shape: isAdmin false -> false even for the active league');

  // Richer multi-league (memberships) shape, for the Admin panel's league selector.
  const multi = {
    isAdmin: false, activeLeagueId: 'L1',
    memberships: [
      { leagueId: 'L1', role: 'player', active: true },
      { leagueId: 'L2', role: 'commissioner', active: true },
      { leagueId: 'L3', role: 'commissioner', active: false },
    ],
  };
  assert(isCommissionerOf(multi, 'L2') === true,
    'memberships shape: commissioner of a NON-active league -> true (the admin-panel league-selector case)');
  assert(isCommissionerOf(multi, 'L1') === false,
    'memberships shape: a player row for this league -> false, even though it is the active league');
  assert(isCommissionerOf(multi, 'L3') === false,
    'memberships shape: role=commissioner but active=false -> false (mirrors is_commissioner()\'s own `and m.active` conjunct)');
  assert(isCommissionerOf(multi, 'L4') === false,
    'memberships shape: no row at all for this league, and the legacy fallback (isAdmin/activeLeagueId) does not match either -> false');
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 3. isPilotLeague()
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── isPilotLeague() ──');
{
  assert(isPilotLeague(undefined) === false, 'undefined league -> false');
  assert(isPilotLeague(null) === false, 'null league -> false');
  assert(isPilotLeague({}) === false, 'old cached record with no pilot field at all (default-when-missing) -> false');
  assert(isPilotLeague({ pilot: false }) === false, 'pilot: false -> false');
  assert(isPilotLeague({ pilot: true }) === true, 'pilot: true -> true');
  assert(isPilotLeague({ pilot: 'true' }) === false, 'pilot as a non-boolean truthy string -> false — strict === true only');
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 4. canOperateCard() — DI-320 §Per-card operability, encoded
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── canOperateCard() — DI-320 per-card operability table ──');
{
  const ADMIN_ONLY_ROWS = [
    'espn-source', 'data-proof', 'users-across-leagues', 'platform-admins',
    'pilot-league-flag', 'export-data', 'background-jobs', 'feedback-bug-reports',
    // DI-425 (UN-380, coordinator addendum, 2026-09-28) — moved from
    // Comm→SCRIBE, all three 'admin' scope (see this file's own
    // CARD_OPERABILITY comment for why none is commissioner-RLS-gated).
    'scribe-digest-export', 'scribe-post-queue', 'chat-diagnostics',
  ];
  const COMMISSIONER_ROWS = [
    'data-source-mode', 'demo-simulation', 'account-linking', 'auto-refresh',
    'randomize-picks-shortcut', 'security-settings', 'scribe-caps-limits',
    'data-management', 'chat-retention', 'chat-history', 'recalculate-finalized-weeks',
    'obligation-corrections',
    // 'scribe-model' — COMMISSIONER, not admin. Its write path is
    // setScribeModel() -> saveSetting('scribe', …) -> save(KEYS.SETTINGS) -> the
    // `league_kv` settings blob, whose RLS write policies are is_commissioner-gated
    // — the identical path as 'scribe-caps-limits'/'auto-refresh'/'security-settings'
    // above. The 2026-09-25 amendment moved the card's PLACEMENT to the Admin panel
    // (ADMIN_CARD_TAB), not its operability; 'account-linking' above is the same
    // shape. Scoped 'admin' in fix round 1 on the COORDINATOR's fix-round
    // instruction (2026-09-25) — corrected by reviewer round 2 the same day.
    'scribe-model',
  ];

  assert(ADMIN_ONLY_ROWS.length + COMMISSIONER_ROWS.length + 1 /* scribe-training, pilot-gated */
    === Object.keys(CARD_OPERABILITY).length,
    'fixture check — the two lists above (24 total: 11 admin-operable [8 + DI-425\'s 3] + 13 commissioner-operable, scribe-model among the latter since reviewer round 2, 2026-09-25) plus the one pilot-gated card account for every row in CARD_OPERABILITY',
    `table has ${Object.keys(CARD_OPERABILITY).length} rows, fixture covers ${ADMIN_ONLY_ROWS.length + COMMISSIONER_ROWS.length + 1}`);

  const leagueA = { id: 'LA', pilot: false };
  const adminOnlySession = { isPlatformAdmin: true, isAdmin: false, activeLeagueId: null, memberships: [] };
  const commissionerOfA = { isPlatformAdmin: false, isAdmin: true, activeLeagueId: 'LA' };
  const bothRoles = { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'LA' };
  const plainPlayer = { isPlatformAdmin: false, isAdmin: false, activeLeagueId: 'LA' };

  // §Verification 6's exact scenario: an admin who commissions NO league, viewing a league he
  // does not commission — only the admin-operable rows render.
  for (const id of ADMIN_ONLY_ROWS) {
    assert(canOperateCard(id, adminOnlySession, leagueA) === true,
      `admin-only session, non-commissioned league — '${id}' (admin-operable) IS operable`);
  }
  for (const id of COMMISSIONER_ROWS) {
    assert(canOperateCard(id, adminOnlySession, leagueA) === false,
      `admin-only session, non-commissioned league — '${id}' (commissioner-operable) is ABSENT, not merely disabled`);
  }
  assert(canOperateCard('scribe-training', adminOnlySession, leagueA) === false,
    'admin-only session, non-commissioned league — scribe-training is absent (not commissioner)');

  // A plain commissioner (not a platform admin) viewing the ADMIN PANEL should never happen in
  // practice (route-gated), but the helper itself still answers correctly if asked: admin-only
  // rows are false, commissioner rows are true for HIS OWN league.
  for (const id of ADMIN_ONLY_ROWS) {
    assert(canOperateCard(id, commissionerOfA, leagueA) === false,
      `commissioner-only session (not platform admin) — '${id}' (admin-operable) is false`);
  }
  for (const id of COMMISSIONER_ROWS) {
    assert(canOperateCard(id, commissionerOfA, leagueA) === true,
      `commissioner-only session, own league — '${id}' (commissioner-operable) is true`);
  }

  // Drew's own case today: both roles, on IRB (not yet pilot in this fixture) — every
  // commissioner-operable and admin-operable card is true; the pilot-gated card is still false
  // because the league fixture is not pilot.
  for (const id of [...ADMIN_ONLY_ROWS, ...COMMISSIONER_ROWS]) {
    assert(canOperateCard(id, bothRoles, leagueA) === true,
      `both roles, own+non-pilot league — '${id}' is operable`);
  }
  assert(canOperateCard('scribe-training', bothRoles, leagueA) === false,
    'both roles, non-pilot league — scribe-training is absent (pilotGated, and this league is not pilot)');
  assert(canOperateCard('scribe-training', bothRoles, { id: 'LA', pilot: true }) === true,
    'both roles, PILOT league — scribe-training is operable (commissioner AND pilot both satisfied)');
  assert(canOperateCard('scribe-training', adminOnlySession, { id: 'LA', pilot: true }) === false,
    'admin-only session (not commissioner of this league), pilot league — scribe-training still absent (pilot alone is not enough; DI-320 marks it Commissioner-operable AND pilot-gated)');

  // A plain player gets nothing.
  for (const id of Object.keys(CARD_OPERABILITY)) {
    assert(canOperateCard(id, plainPlayer, leagueA) === false,
      `plain player session — '${id}' is never operable`);
  }

  // Deny-by-default for an unmapped card id.
  assert(canOperateCard('some-future-card-nobody-has-named-yet', bothRoles, leagueA) === false,
    'unmapped cardId — deny-by-default, "nothing here" (RG-10\'s rule extended to this panel from day one)');
  assert(canOperateCard('', bothRoles, leagueA) === false, 'empty-string cardId — deny-by-default');
  assert(canOperateCard(undefined, bothRoles, leagueA) === false, 'undefined cardId — deny-by-default');
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 5. Whole-tree isPlatformAdmin allow-list scan (§2b.11 / F13)
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── whole-tree isPlatformAdmin allow-list scan (F13) ──');
{
  const jsDir = join(__dirname, 'js');
  const jsFiles = (await readdir(jsDir)).filter((f) => f.endsWith('.js')).sort();
  assert(jsFiles.length >= 20,
    `fixture check — the app-wide scan really enumerated js/*.js (found ${jsFiles.length} files); a broken/empty readdir would make every assertion below pass vacuously`);

  // The enumerated chrome-gating call-site allow-list, §2b.11's own words: "an explicitly
  // enumerated array of chrome-gating call sites (bottom-nav icon render, control-center
  // section gates, admin route guard) maintained in the test itself." UX Revamp wiring pass 1
  // (2026-09-25) lands the FIRST of these — js/app.js's buildControlCenterCtx() composes
  // ctx.flags.isPlatformAdmin from the new js/auth.js getter, feeding EXACTLY the
  // "control-center section gates" input js/control-center.js's starredPanels(flags) reads —
  // named by the DI's own text as a legitimate call site, added here BY LINE rather than by
  // file name (unlike admin-panel.js/control-center.js above) because this is a single
  // composition site inside a much larger file, not a file dedicated to the concern. The
  // bottom-nav icon render and the admin route guard are still not wired this pass (index.html
  // is HELD — see the wiring pass's own task scope) and stay absent from this list.
  // Security fix round (2026-09-25), NOTE 3 — pinned by LINE AND TEXT, not
  // line number alone, so a coincidental future hit landing on the same line
  // number (this is a heavily-edited shared file) is not silently accepted.
  // Re-derived after the wiring pass 2 edits to buildControlCenterCtx()
  // (pilot/status threading) shifted this block by 8 lines.
  // Wiring pass 2 (2026-09-25) — a SECOND legitimate call site,
  // composeAdminViewer() (js/app.js), the admin route's own composed-viewer
  // chokepoint (DI-320 §6 / DI-344 §8) — the identical text/shape
  // buildControlCenterCtx() already uses, one line above its own
  // isSuperAdmin sibling.
  // Re-derived, wiring pass 3a-bis (2026-09-25) — the paused-league-banner
  // structural fix (BLOCK 3) and the maintenance-banner NOTE 6/BLOCK 4 build
  // added code ahead of every one of these three sites; same three sites,
  // no new ones, only their line numbers moved.
  // Re-derived, UX Revamp wiring pass 3b (2026-09-25) — Group D's wiring
  // added one net import line (`deriveLeagueSports,`) ahead of this block;
  // same three sites, no new ones, only their line numbers moved by +1.
  // Re-derived, UX Revamp wiring pass 3c (2026-09-25) — the security-gate
  // fix round (Findings 1-3 + NOTE A/B/C/D) and Group F's accounts-UI
  // wiring (DI-332…340) both added code ahead of every one of these three
  // sites (new imports, the boot-tail recovery-link check, the
  // reminderSkipToastCopy()/pickButtonContentHTML() helpers, the whole new
  // password-gate/recovery/change/delete-account UI block, ~500+ net new
  // lines total); same three sites, no new ones, only their line numbers
  // moved (rolestest.mjs is explicitly in this wiring window's file list
  // for enumerated-line edits only — no OTHER line in this file is touched
  // by this pass).
  // Re-derived, 3c FIX WINDOW (2026-09-25) — the security-gate fix round
  // (B1-B8/F1-F5: the recovery-gate rewrite, verifyPasswordRecovery's
  // boot-order move, the delete/change-sheet identity sweep, the wizard
  // banner owner-tagging, ~150+ net new lines ahead of these sites) shifted
  // this block again; same three sites, no new ones, only their line
  // numbers moved.
  // Re-derived, 3c fix window THIRD PASS (2026-09-26) — same sites, no new
  // ones, only their line numbers moved (isSignedInForApp(), the recovery
  // branches and the Step B helpers landed ahead of them).
  // Re-derived, reviewer round 3 items 1-7 / security N-1/N-2 (2026-09-26) —
  // same sites, no new ones, only their line numbers moved (the provider
  // cache in auth.js does not touch app.js; the app.js-side fixes for items
  // 2/4/5/6 and the N-2 recovery guard landed ahead of these two sites).
  // Re-derived 2026-09-26 (v0.26.0 stamp + full-app review fix window): line numbers only, same sites, same texts, matched by exact text.
  // Re-derived 2026-09-27 (v0.27.0 bugfix pass: the #control-center-trigger fill + week-swipe chronology + stamp): line numbers only, same sites, same texts, matched by exact text.
  // Re-derived 2026-09-27 (UX Revamp post-deploy pass, APP-SHELL slice: DI-348's
  // warm-relaunch snapshot + needsLeagueFlowScreen() rewrite, DI-358's scheduled-open
  // tick leg, header trigger/week-swipe reviewer fixes — all land ahead of these three
  // sites): line numbers only, same sites, same texts, matched by exact text.
  // Re-derived 2026-09-27 (this pass, DI-360/wizard reconciliation edits
  // above these sites) — line numbers only, same three sites, matched by
  // exact text.
  // Re-derived 2026-09-27 (app-shell part 3A review pass: Finding 4's
  // _buildControlCenterCtxForTest export ahead of buildControlCenterCtx(),
  // plus a pre-existing drift this pass also found and closed rather than
  // compounding — same sites, only the line numbers moved, matched by text).
  // Re-derived 2026-09-28 (fix-final-v0270: logo-merge gate, league-pill fit, sync-glyph span ahead of these sites) — line numbers only, same sites, same texts, matched by exact text.
  // Re-derived 2026-09-28 (DI-406/407/408: New Week button, Build Slate
  // resizing, and the "Collapse all / Expand all" heading-row pair
  // (wireCollapsibleSections()'s rewrite + wirePanelCollapseAllControls()),
  // all land ahead of these sites) — line numbers only, same three sites,
  // matched by exact text.
  // Re-derived 2026-09-28 (REVIEWER ROUND 2 B1 — renderAdminPage() now calls
  // wireCollapsibleSections(c) for real, plus the DI-405/DI-408 stale-
  // comment fixes above these sites) — line numbers only, same three
  // sites, matched by exact text.
  // Re-derived AGAIN 2026-09-28 (UX Revamp v0.27.2, DI-418/421/422/423 —
  // buildControlCenterCtx()'s new almaMaterOptionsHTML body + onOpenLeaguesHome
  // callback, above the SECOND 'app.js' pin here and everything below it) —
  // line numbers only, same sites, matched by exact text.
  // Re-derived 2026-09-29 (MERGE — feat/gestures-v0272 rounds 2–3 (Opus) and
  // feat/control-center-v0272 rounds 2–5 (Opus) merged into release/v0.27.2:
  // picksShowingWeek(), the Picks swipe getState() rewrite, showJoinLeagueSheet(),
  // leagueJoinFormHTML()/bindLeagueJoinForm(), patchProfileAlmaMaterOptionsInPlace()
  // and doSwitchActiveLeague()'s boolean return all sit above one or more of
  // these sites) — line numbers only, same sites, matched by exact text against
  // the MERGED tree.

  const ENUMERATED_CALL_SITES = [
    // Re-derived 2026-09-27 (app-shell part 3B: header/nav/viewing-week-card
    // pass — code added above both sites shifted their line numbers only;
    // same two sites, matched by exact text).
    // Re-derived 2026-09-28 (merge round 2 — feat/wizard-admin-v0272's
    // reviewer round 2 fixes merged with release/v0.27.2 (feat/logos-
    // surfaces-v0272, hotfix/composer-focus-sweep, hotfix/cc-alma-admin,
    // hotfix/scribe-autonomous-rpc-catch) — line numbers only, same two
    // sites, matched by exact text against the merged tree.
  // Re-derived 2026-09-29 (MERGE — feat/gestures-v0272 rounds 2–3 (Opus) and
  // feat/control-center-v0272 rounds 2–5 (Opus) merged into release/v0.27.2:
  // picksShowingWeek(), the Picks swipe getState() rewrite, showJoinLeagueSheet(),
  // leagueJoinFormHTML()/bindLeagueJoinForm(), patchProfileAlmaMaterOptionsInPlace()
  // and doSwitchActiveLeague()'s boolean return all sit above one or more of
  // these sites) — line numbers only, same sites, matched by exact text against
  // the MERGED tree.
    { file: 'app.js', line: 3840, text: 'isPlatformAdmin: getIsPlatformAdmin(),' },
    { file: 'app.js', line: 13586, text: 'isPlatformAdmin: getIsPlatformAdmin(),' },
    // UX Revamp wiring pass 3a (2026-09-25) — renderAdminPage()'s own
    // cross-league users-read gate (WIRING_CHECKLIST_B_092526.md
    // §Window(b)): only fetch listUsersAcrossLeagues() when the composed
    // viewer bag says isPlatformAdmin, the same chrome-gating shape every
    // other enumerated site here already uses. Text updated, wiring pass
    // 3a-bis (BLOCK 2's `attempted` guard replaces `rows == null`).
  // Re-derived 2026-09-29 (MERGE — feat/gestures-v0272 rounds 2–3 (Opus) and
  // feat/control-center-v0272 rounds 2–5 (Opus) merged into release/v0.27.2:
  // picksShowingWeek(), the Picks swipe getState() rewrite, showJoinLeagueSheet(),
  // leagueJoinFormHTML()/bindLeagueJoinForm(), patchProfileAlmaMaterOptionsInPlace()
  // and doSwitchActiveLeague()'s boolean return all sit above one or more of
  // these sites) — line numbers only, same sites, matched by exact text against
  // the MERGED tree.
    { file: 'app.js', line: 14084, text: 'if (viewer.isPlatformAdmin && !_usersAcrossLeaguesCache.attempted && !_usersAcrossLeaguesCache.loading) {' },
  ];

  function findIdentifierHits(src, ident) {
    const hits = [];
    const re = new RegExp(`\\b${ident}\\b`); // no 'g' — a sticky lastIndex across lines would skip hits (reviewer note, 2026-09-25)
    src.split('\n').forEach((rawLine, i) => {
      const t = rawLine.trimStart();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('<!--')) return; // prose, not code — jsdoc/comments/HTML comments may name the identifier while documenting the fence
      if (re.test(rawLine)) hits.push({ line: i + 1, text: rawLine.trim() });
    });
    return hits;
  }

  // REVIEW ROUND 1, SHOULD-FIX (5) — the scan also covers `index.html` at the repo root: DI-320
  // §Entry point 2 puts the bottom-nav Comm icon's `isPlatformAdmin`-only conditional render
  // THERE, not in a js/ file, so a scan scoped to js/*.js alone would have missed the exact
  // call site the DI itself names. Read separately from the jsFiles loop (a different directory,
  // a single file, no readdir needed) and folded into the SAME allow-list/offender logic below —
  // 'index.html' becomes a legal `file` value in ENUMERATED_CALL_SITES the day that nav-icon
  // gate actually lands, exactly like any js/ call site would.
  const indexHtmlPath = join(__dirname, 'index.html');
  const indexHtmlSrc = await readFile(indexHtmlPath, 'utf8');

  const allHits = [];
  for (const f of jsFiles) {
    const src = await readFile(join(jsDir, f), 'utf8');
    findIdentifierHits(src, 'isPlatformAdmin').forEach((h) => allHits.push({ file: f, ...h }));
  }
  findIdentifierHits(indexHtmlSrc, 'isPlatformAdmin').forEach((h) => allHits.push({ file: 'index.html', ...h }));

  const offenders = allHits.filter((h) => {
    if (h.file === 'roles.js') return false; // the module itself
    if (h.file === 'auth.js') return false;  // ALLOWED, but see the targeted assertion below —
                                              // there is no `_recomputeSynthesizedSession()` wiring
                                              // yet this wave, so today this branch should find zero
                                              // hits; it is here so the allow-list is correct the day
                                              // that wiring lands, not the day after.
    if (h.file === 'admin-panel.js') return false; // does not exist yet this wave
    // ADDED during T-35's build (group G, 2026-09-25) — DISCOVERED, not authored here: a
    // concurrent thread (group A1) landed js/control-center.js's admin-badge gate
    // (`flags.isPlatformAdmin`, starredPanels' Admin Panel row) ahead of this scan, which is
    // exactly the "control-center section gates" call site §2b.11's own words already named as
    // legitimate. Excluded by file name, the same shape admin-panel.js already gets above,
    // rather than pinning exact lines a sibling thread may still move.
    if (h.file === 'control-center.js') return false;
    return !ENUMERATED_CALL_SITES.some((c) => c.file === h.file && c.line === h.line && c.text === h.text);
  });
  assert(offenders.length === 0,
    `F13 — every 'isPlatformAdmin' hit in js/*.js AND index.html is inside the allow-list (roles.js, auth.js's _recomputeSynthesizedSession, admin-panel.js, or an enumerated call site)`,
    JSON.stringify(offenders));

  // Teeth: prove the scan finds something when there IS something to find, so "zero offenders"
  // above is a real finding and not a broken/vacuous scan.
  const roleHits = allHits.filter((h) => h.file === 'roles.js');
  assert(roleHits.length > 0, 'canary — the scan DOES find isPlatformAdmin inside roles.js itself (a broken scan would report zero everywhere)');

  // RE-CONFIRMED 2026-09-25 (UX Revamp WIRING PASS 1) — js/auth.js's session.isPlatformAdmin
  // derivation DID land this window (`_recomputeSynthesizedSession()` fetches it, via the new
  // `_refreshPlatformAdminFlags()`, alongside every membership read) — but the exposed getter is
  // deliberately named `getIsPlatformAdmin()`, not a bare `isPlatformAdmin` identifier, and the
  // cache variable is `_isPlatformAdminCache` (no word-boundary match either — see that file's
  // own header note by the cache declaration): `getSession()`/`getSupabaseSession()` must stay
  // EXACTLY `{playerId, isAdmin, playerVerified}` (authtest.mjs [2]'s own structural pin), so
  // this value is never merged into an object literal keyed `isPlatformAdmin` anywhere outside
  // `js/roles.js` itself. So the assertion below is STILL correct today, for a different reason
  // than the prior draft of this comment predicted — auth.js's wiring is real, but it was built
  // to stay off this exact allow-list fence on purpose, not because the wiring is missing.
  // UX Revamp wiring pass 3a (2026-09-25) — ONE enumerated exception,
  // listUsersAcrossLeagues() (WIRING_CHECKLIST_B_092526.md §Window(b)). Its
  // returned row shape carries `isPlatformAdmin: !!admin` PER MEMBERSHIP
  // ROW — a data field mirroring the `platform_admins` table's own meaning
  // for js/admin-panel.js's already-tested `AdminUserRow.isPlatformAdmin`
  // contract, never a session/viewer-shaped value and never merged into
  // `getSession()`'s return. Textually identical to the fenced identifier,
  // semantically a different thing — named explicitly here, the same way
  // `control-center.js`/`admin-panel.js` are excluded by file above, rather
  // than silently widening the "zero" claim.
  // Re-derived, UX Revamp wiring pass 3b (2026-09-25) — S-4's maintenance-
  // banner fix added code ahead of this line in auth.js; same one site,
  // only its line number moved.
  // Re-derived, UX Revamp wiring pass 3c (2026-09-25) — Group F's whole
  // password-auth logic layer (signUp/signIn/reset/recovery/change/delete,
  // ~600 lines, already shipped in 3df7d49 but this is the first pass whose
  // OWN edits landed ahead of this line) shifted it further; same one site,
  // only its line number moved.
  // Re-derived, 3c FIX WINDOW (2026-09-25) — same one site, only its line
  // number moved (the B1 recovery-gate rewrite added code ahead of it).
  // Re-derived, Step 3/N8 (2026-09-26) — same one site, only its line number
  // moved (a 6-line comment added ahead of it, RECOVERY_PENDING_KEY's own
  // "REPORTED, NOT EDITED" note).
  // Re-derived, reviewer round 3 item 1 / N4 fix (2026-09-26) — same one
  // site, only its line number moved (getAccountHasPasswordIdentity()'s
  // in-memory provider cache added code ahead of it, at several points
  // throughout this file).
  // Re-derived 2026-09-26 (v0.26.0 stamp + full-app review fix window): line numbers only, same sites, same texts, matched by exact text.
  // FOUND ON release/v0.27.2's OWN tip, independent of any feat-branch merge
  // (confirmed: `node rolestest.mjs` is red on release/v0.27.2 by itself) —
  // NOT introduced by this merge, fixed here because it blocks a green run
  // of this suite post-merge either way, and flagged to design-matrix-pm so
  // release/v0.27.2's own thread patches it too. hotfix/cc-alma-admin's RG-293
  // fix (`refreshPlatformAdminFlags()`, js/auth.js:1882) added a SECOND
  // early-return branch inside the SAME canonical derivation function this
  // list's own reasoning already names as allowed ("the real derivation lives
  // in _recomputeSynthesizedSession()/_refreshPlatformAdminFlags()") — a
  // no-session fail-closed return, `{ isPlatformAdmin: false, isSuperAdmin:
  // false }`, sibling to the existing `isPlatformAdmin: !!admin,` return a few
  // lines later in the same function. Re-derived 2026-09-28 (merge round 2).
  const AUTH_JS_ENUMERATED_HITS = [
    { line: 1892, text: 'return { isPlatformAdmin: false, isSuperAdmin: false };' },
    { line: 3261, text: 'isPlatformAdmin: !!admin,' },
  ];
  const authHits = allHits.filter((h) => h.file === 'auth.js'
    && !AUTH_JS_ENUMERATED_HITS.some((c) => c.line === h.line && c.text === h.text));
  assert(authHits.length === 0,
    'auth.js carries ZERO literal isPlatformAdmin hits beyond the one enumerated data-field exception — the real derivation lives in _recomputeSynthesizedSession()/_refreshPlatformAdminFlags(), exposed via getIsPlatformAdmin() (a differently-spelled identifier, by design, so it never has to be on this allow-list)',
    JSON.stringify(authHits));

  // Today's specific expectation for index.html, named the same way: the bottom-nav Comm icon's
  // admin-only branch (DI-320 §Entry point 2) is not wired yet this wave, so this should be
  // zero right now — expected to need rewriting into a positive check once that render lands.
  const indexHits = allHits.filter((h) => h.file === 'index.html');
  assert(indexHits.length === 0,
    'index.html carries ZERO isPlatformAdmin hits today — the bottom-nav Comm icon admin-only branch (DI-320 §Entry point 2) is not wired this pass',
    JSON.stringify(indexHits));
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 6. The picks-visibility fence — canViewOtherPicks / arePicksPublic / canSeeOthers /
//    extra-point.js injection sites (AD-29's exact failure mode)
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── picks-visibility fence (AD-29 / DI-317 §Security point 1) ──');
{
  function extractFunctionBody(src, signatureRe) {
    const m = signatureRe.exec(src);
    if (!m) return null;
    let i = m.index + m[0].length;
    let depth = 1;
    // signatureRe is expected to match up to and including the opening brace.
    const start = i;
    while (i < src.length && depth > 0) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') depth--;
      i++;
    }
    return src.slice(start, i - 1);
  }

  const appSrc = await readFile(join(__dirname, 'js', 'app.js'), 'utf8');
  const storageSrc = await readFile(join(__dirname, 'js', 'storage.js'), 'utf8');
  const extraPointSrc = await readFile(join(__dirname, 'js', 'extra-point.js'), 'utf8');
  const chatUiSrc = await readFile(join(__dirname, 'js', 'chat-ui.js'), 'utf8');

  const canViewBody = extractFunctionBody(appSrc, /export function canViewOtherPicks\([^)]*\)\s*\{/);
  assert(!!canViewBody, 'canViewOtherPicks() found in js/app.js (fixture check — a missing function must fail loudly, not pass vacuously)');
  assert(canViewBody != null && !/isPlatformAdmin/.test(canViewBody),
    'canViewOtherPicks() body never references isPlatformAdmin — its ONLY legitimate admin-shaped input remains sess.isAdmin (this-league commissioner), unchanged');

  const arePublicBody = extractFunctionBody(storageSrc, /export function arePicksPublic\([^)]*\)\s*\{/);
  assert(!!arePublicBody, 'arePicksPublic() found in js/storage.js (fixture check)');
  assert(arePublicBody != null && !/isPlatformAdmin/.test(arePublicBody),
    'arePicksPublic() body never references isPlatformAdmin');

  // The `canSeeOthers` locals — every assignment site across app.js and chat-ui.js. None of them
  // may be defined in terms of isPlatformAdmin.
  function canSeeOthersAssignmentLinesAreClean(src, label) {
    const hits = [];
    src.split('\n').forEach((line, i) => {
      if (/\bcanSeeOthers\s*=/.test(line) && /isPlatformAdmin/.test(line)) {
        hits.push({ line: i + 1, text: line.trim() });
      }
    });
    assert(hits.length === 0, `${label} — no 'canSeeOthers' local is assigned from isPlatformAdmin`, JSON.stringify(hits));
    return hits;
  }
  canSeeOthersAssignmentLinesAreClean(appSrc, 'js/app.js');
  canSeeOthersAssignmentLinesAreClean(chatUiSrc, 'js/chat-ui.js');

  const canSeeOthersCount = (appSrc.match(/\bcanSeeOthers\s*=/g) || []).length;
  assert(canSeeOthersCount >= 3, 'fixture check — js/app.js really does define multiple canSeeOthers locals (a broken scan would find none)', `${canSeeOthersCount}`);

  // js/extra-point.js's two named default-param injection sites.
  assert(/export function isCountedExtraPointWeek\(week, \{ canViewOtherPicks = \(\) => false \} = \{\}\)/.test(extraPointSrc),
    'js/extra-point.js — isCountedExtraPointWeek\'s default param is exactly canViewOtherPicks (unmodified), not isPlatformAdmin');
  assert(/export function seasonExtraPointTally\(weeks, players, \{ canViewOtherPicks = \(\) => false \} = \{\}\)/.test(extraPointSrc),
    'js/extra-point.js — seasonExtraPointTally\'s default param is exactly canViewOtherPicks (unmodified), not isPlatformAdmin');
  assert(!/isPlatformAdmin/.test(extraPointSrc), 'js/extra-point.js carries zero isPlatformAdmin references anywhere in the file');
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 7. Claim-code trio never mentions is_platform_admin (F12)
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── claim-code trio (F12) ──');
{
  const migDir = join(__dirname, 'supabase', 'migrations');
  const migFiles = (await readdir(migDir)).filter((f) => f.endsWith('.sql')).sort();
  assert(migFiles.length >= 20, `fixture check — supabase/migrations really has migration files (found ${migFiles.length})`);

  const allMigSql = (await Promise.all(migFiles.map((f) => readFile(join(migDir, f), 'utf8')))).join('\n');

  function allFunctionBodies(sql, name) {
    const bodies = [];
    const re = new RegExp(`create or replace function public\\.${name}\\([^)]*\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, 'g');
    let m;
    while ((m = re.exec(sql))) bodies.push(m[1]);
    return bodies;
  }

  for (const name of ['issue_claim_code', 'get_claim_codes', 'unlink_member']) {
    const bodies = allFunctionBodies(allMigSql, name);
    assert(bodies.length > 0, `${name}() found at least once across supabase/migrations/*.sql (fixture check)`, `found ${bodies.length}`);
    const offenders = bodies.filter((b) => /is_platform_admin/.test(b));
    assert(offenders.length === 0, `F12 — no definition of ${name}() anywhere in the migrations mentions is_platform_admin`, `${offenders.length} of ${bodies.length} bodies`);
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 8. get_member_contacts never referenced from an admin cross-league render path (N6)
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── get_member_contacts cross-league render-path scan (N6) ──');
{
  const jsDir = join(__dirname, 'js');
  const jsFiles = (await readdir(jsDir)).filter((f) => f.endsWith('.js')).sort();
  const hits = [];
  for (const f of jsFiles) {
    const src = await readFile(join(jsDir, f), 'utf8');
    if (/get_member_contacts/.test(src)) hits.push(f);
  }
  // `js/admin-panel.js` (the Users Across Leagues card N6 is actually about) does not exist yet
  // this build wave, so the only thing this suite can assert about IT today is that it is not in
  // the hit list at all — trivially true, and named explicitly so the assertion fails loudly the
  // day admin-panel.js exists and calls this RPC without having been reviewed for N6.
  assert(!hits.includes('admin-panel.js'),
    'N6 — js/admin-panel.js does not reference get_member_contacts (file does not exist yet this wave; this assertion is the one that must catch a future violation)',
    JSON.stringify(hits));

  // The hits that DO exist today (js/auth.js, js/supabase-backend.js, js/supabase-projection.js)
  // predate this DI entirely — DI-T7.3's contact-privacy feature (0007_contact_privacy.sql).
  // Named here, not silently ignored, and checked for the ONE property that matters for N6: the
  // live call site passes the CALLER'S OWN active league, never a loop or a list of OTHER
  // leagues — i.e. it is a normal same-league contact read, not a cross-league admin render.
  const KNOWN_PRE_EXISTING_CALLERS = ['auth.js', 'supabase-backend.js', 'supabase-projection.js'];
  const unexpected = hits.filter((f) => f !== 'admin-panel.js' && !KNOWN_PRE_EXISTING_CALLERS.includes(f));
  assert(unexpected.length === 0,
    'N6 — no NEW file outside the known pre-existing DI-T7.3 callers references get_member_contacts (a new caller here needs the same N6 review admin-panel.js will need)',
    JSON.stringify(unexpected));

  const rpcCallSrc = await readFile(join(jsDir, 'supabase-backend.js'), 'utf8');
  assert(/client\.rpc\('get_member_contacts',\s*\{\s*p_league:\s*leagueId\s*\}\)/.test(rpcCallSrc),
    "N6 — supabase-backend.js's existing call site passes a single leagueId (the hydrate's own active league), not a cross-league loop — confirms today's only live caller is a same-league contact read, not an admin cross-league render");
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 9 + 10. The SQL draft — SET-list scan (F3/F8) and guard privileged-branch scan (N1/N4)
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── SQL drafts: both GUC escapes are bounded by their SET lists (B app.role_change · F app.account_anonymize), and the guard privileged-branch scan (N1/N4) ──');
{
  // RE-POINTED 2026-09-25 — B_roles_pilot.sql was merged into supabase/migrations/0026_b_roles_
  // pilot.sql (byte-identical below its own header block); every regex below still resolves the
  // same content, since every match in this block is line-anchored (`m` flag) or scoped to a
  // captured function/policy body, neither of which is affected by the header lines above them.
  const draftPath = join(__dirname, 'supabase', 'migrations', '0026_b_roles_pilot.sql');
  let draftSql = '';
  try {
    draftSql = await readFile(draftPath, 'utf8');
  } catch (e) {
    fail++;
    console.error('  ❌ Migration 0026 not found at', draftPath, '—', e.message);
  }

  if (draftSql) {
    // Anchored to the START OF A LINE (`^`, `m` flag) — REVIEW ROUND 1 REGRESSION FOUND WHILE
    // FIXING THIS ROUND: the file's own "GUARD AUTHORITY" header comment quotes the literal
    // text "create or replace function public.league_members_guard()" (naming the collision it
    // warns against), and an UNANCHORED regex matched THAT occurrence first, then captured
    // forward to the next `$$` — which belonged to the UNRELATED `leagues_guard()` function
    // sitting between the comment and the real declaration — so every assertion below silently
    // tested the wrong function's body. Every function-matching regex in this block is anchored
    // the same way now, whether or not each one happened to hit the same trap today, so a future
    // header comment that names another function literally cannot reintroduce it quietly.
    const rpcMatch = /^create or replace function public\.admin_set_member_role\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!rpcMatch, 'admin_set_member_role() found in the SQL draft (fixture check)');
    const rpcBody = rpcMatch ? rpcMatch[1] : '';
    assert(/set\s+role\s*=/.test(rpcBody), "F8 — admin_set_member_role's UPDATE contains `set role = `");
    assert(/set\s+active\s*=/.test(rpcBody), "F8 — admin_set_member_role's UPDATE contains `set active = `");
    assert(!/set\s+email\s*=/.test(rpcBody), 'F3 — admin_set_member_role never contains `set email`');
    assert(!/set\s+phone_verified\s*=/.test(rpcBody), 'F3 — admin_set_member_role never contains `set phone_verified`');
    assert(!/set\s+created_at\s*=/.test(rpcBody), 'F3 — admin_set_member_role never contains `set created_at`');

    // First-executable-statement gate, the same shape issue_claim_code uses.
    assert(/is_platform_admin\(\)\s+or\s+public\.is_commissioner\(p_league\)/.test(rpcBody)
      || /is_commissioner\(p_league\)\s+or\s+public\.is_platform_admin\(\)/.test(rpcBody),
      'admin_set_member_role checks (is_platform_admin() or is_commissioner(p_league)) — covers both actors');

    // REVIEW ROUND 1, MUST-FIX (1) — `found`, never a hand-rolled `v_found`. The exact defect
    // (SECURITY F-3 / 0009's own postmortem): `select ... into v_found` leaves v_found NULL on a
    // miss, so `if not v_found` silently never raises. Both a positive (the fixed idiom is
    // present) and a negative (the broken idiom is nowhere in the file) — a fix that added
    // `if not found` WITHOUT deleting the old `v_found` declaration/branch would still be wrong.
    assert(/if not found then raise exception 'not_found'; end if;/.test(rpcBody),
      "MUST-FIX (1) — admin_set_member_role uses the runtime `found` boolean (`if not found then raise exception 'not_found'`), the 0007/0009 idiom");
    // Comment lines are excluded (`-- ` prefix) — this file's own explanatory comment
    // legitimately quotes the RETIRED `v_found` pattern by name to explain why it was removed
    // (the same prose-exclusion loadtest.mjs's RETIRED_TICS scan uses); what must be absent is a
    // LIVE `v_found` declaration or reference in actual SQL, not the word appearing in prose
    // describing the fix.
    const nonCommentDraftSql = draftSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    assert(!/v_found/.test(nonCommentDraftSql),
      "MUST-FIX (1) — the SQL draft contains NO LIVE `v_found` identifier (the hand-rolled boolean that could read NULL-on-miss is fully removed from actual code, not merely bypassed — comment lines quoting the retired pattern by name are excluded)");

    // REVIEW ROUND 1, MUST-FIX (2) — the self-promotion refusal is conditioned on
    // `p_role = 'commissioner'`, so a commissioner (or admin) demoting HIMSELF to player
    // (DI-182i, js/app.js's "Make Player" on your own row) still works. A regex proving the
    // conjunct is present, not merely that the refusal exists somewhere in the body.
    assert(/if p_role = 'commissioner' and v_user_id is not null and v_user_id = auth\.uid\(\) then/.test(rpcBody),
      "MUST-FIX (2) — the LINKED-row self-promotion refusal is conditioned on p_role = 'commissioner' (a self-demotion to player is not refused)");

    // Self-promotion refusal (F6), linked-row case.
    assert(/v_user_id\s*=\s*auth\.uid\(\)/.test(rpcBody) && /self_promotion_refused/.test(rpcBody),
      'F6 — admin_set_member_role refuses a call where the target user_id = auth.uid()');

    // Security round-1 finding B-3 — the UNLINKED-row self-promotion refusal (matching on
    // auth.users.email, the verified side, never the self-editable league_members.email), also
    // conditioned on p_role = 'commissioner' per the same MUST-FIX (2) principle.
    assert(/v_user_id is null and p_role = 'commissioner' and exists \(/.test(rpcBody)
      && /lower\(u\.email\) = lower\(v_email\)/.test(rpcBody),
      "B-3 — an UNLINKED target row whose league_members.email matches the caller's own auth.users.email is also refused a commissioner self-promotion, conditioned on p_role = 'commissioner' the same way as the linked case");

    // N4 — "assert directly that both admin RPC bodies insert into platform_audit_log" (SEC F9's
    // own derivation keys on is_commissioner() and cannot see this — a DEFINER RPC's audit
    // insert is not a trigger, so the policy-derived scan in static.check.mjs has no way to know
    // this table is written at all; this is the direct check N4 asks for).
    assert(/insert into public\.platform_audit_log/.test(rpcBody) && /'role_change'/.test(rpcBody),
      "N4 — admin_set_member_role's body inserts into platform_audit_log with action 'role_change'");

    // Security round-1 finding B-5 — target_member_id is populated alongside target_user_id.
    assert(/insert into public\.platform_audit_log \(actor_user_id, target_user_id, target_member_id, action, before_role, after_role, league_id\)/.test(rpcBody)
      && /values \(auth\.uid\(\), v_user_id, p_member, 'role_change', v_before_role, p_role, p_league\)/.test(rpcBody),
      "B-5 — admin_set_member_role's platform_audit_log insert populates target_member_id with p_member alongside target_user_id");

    const platformAdminRpcMatch = /^create or replace function public\.admin_set_platform_admin\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!platformAdminRpcMatch, 'admin_set_platform_admin() found in the SQL draft (fixture check)');
    const platformAdminRpcBody = platformAdminRpcMatch ? platformAdminRpcMatch[1] : '';
    assert(/insert into public\.platform_audit_log/.test(platformAdminRpcBody)
      && /'admin_grant'/.test(platformAdminRpcBody) && /'admin_revoke'/.test(platformAdminRpcBody),
      "N4 — admin_set_platform_admin's body inserts into platform_audit_log with actions 'admin_grant' and 'admin_revoke'");
    assert(/if not public\.is_platform_admin\(\) then/.test(platformAdminRpcBody),
      'admin_set_platform_admin checks is_platform_admin() as its first executable statement');

    // N1 — league_members_guard()'s privileged branch.
    const guardMatch = /^create or replace function public\.league_members_guard\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!guardMatch, 'league_members_guard() found in the SQL draft (fixture check)');
    const guardBody = guardMatch ? guardMatch[1] : '';

    // Security round-1, CRITICAL finding B-1 — the guard must be rebuilt from 0009's live body
    // (which added link_disputed_at to the identity/link fence), not 0002's stale one.
    assert(/link_disputed_at/.test(guardBody),
      "B-1 — league_members_guard()'s identity/link fence names link_disputed_at (rebuilt from 0009_unlink_self.sql:172-239, the LIVE body, not the stale 0002 one)");

    // Security round-1 merge finding — the third GUC (group F's account-deletion escape) is
    // folded into this ONE guard body, per the file's own "GUARD AUTHORITY" note.
    assert(/app\.account_anonymize/.test(guardBody),
      "merge ruling — league_members_guard()'s privileged branch also admits group F's app.account_anonymize escape (ONE guard body for both threads)");
    // Isolate the privileged-branch `if not (...)` condition specifically, not the whole 60-line
    // function — a bare file-wide scan for is_platform_admin would find it legitimately absent
    // everywhere in this function, which proves nothing about whether the RIGHT clause was fixed.
    const privBranchMatch = /if not \(public\.is_commissioner\(OLD\.league_id\)[\s\S]*?\) then/.exec(guardBody);
    assert(!!privBranchMatch, "N1 — the guard's privileged branch (`if not (public.is_commissioner(OLD.league_id) ...) then`) is present");
    const privBranch = privBranchMatch ? privBranchMatch[0] : '';
    assert(/app\.role_change/.test(privBranch), "N1 — the guard's privileged branch mentions app.role_change");
    assert(/app\.account_anonymize/.test(privBranch), "merge ruling — the guard's privileged branch (not just somewhere in the function) mentions app.account_anonymize");
    assert(!/is_platform_admin/.test(privBranch), "N1/N4 — the guard's privileged branch never mentions is_platform_admin (must not be fixed with `or is_platform_admin()` — that re-opens F3's email/phone_verified/created_at reach)");
    assert(/coalesce\(current_setting\('app\.role_change', true\), ''\) = '1'/.test(privBranch),
      "N1 — the app.role_change read is COALESCED (three-valued-logic rule, 0002_rls.sql:352-364) — a bare comparison would silently never fire for an ordinary client UPDATE");
    assert(/coalesce\(current_setting\('app\.account_anonymize', true\), ''\) = '1'/.test(privBranch),
      "merge ruling — the app.account_anonymize read is ALSO coalesced, the same three-valued-logic rule applied to the second GUC");

    // F4 — the last-commissioner check no longer conjoins my_member_id(OLD.league_id) = OLD.id.
    const lastCommMatch = /if OLD\.role = 'commissioner' and OLD\.active[\s\S]*?then\s*\n\s*if not exists/.exec(guardBody);
    assert(!!lastCommMatch, 'F4 — the last-commissioner check condition is present in the guard');
    assert(lastCommMatch && !/my_member_id\(OLD\.league_id\)\s*=\s*OLD\.id/.test(lastCommMatch[0]),
      'F4 — the last-commissioner check no longer conjoins my_member_id(OLD.league_id) = OLD.id (the three-valued-logic gap that let it silently never fire for a non-member actor)');

    // Group-F security gate finding F-5 — leagues_guard() permits ONLY the null transition on
    // created_by (ON DELETE SET NULL fires this trigger like any other UPDATE), never a
    // reassignment to a different user.
    const leaguesGuardMatch = /^create or replace function public\.leagues_guard\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!leaguesGuardMatch, 'leagues_guard() found in the SQL draft (fixture check)');
    const leaguesGuardBody = leaguesGuardMatch ? leaguesGuardMatch[1] : '';
    assert(/if NEW\.created_by is distinct from OLD\.created_by and NEW\.created_by is not null then/.test(leaguesGuardBody),
      "F-5 — leagues_guard() refuses created_by changes ONLY when the new value is NOT null (the ON DELETE SET NULL transition is permitted, a reassignment is not)");
    assert(!/created_by: is immutable|created_by is immutable/.test(leaguesGuardBody),
      'F-5 — leagues_guard() no longer treats created_by as unconditionally immutable');

    // Security round-1 finding B-4 — AMENDED 2026-09-26 after the live cfbp-test rehearsal
    // failed with `ERROR: 0A000: transition tables cannot be specified for triggers with column
    // lists`. This pin USED TO require `after update OF role, active` — the exact shape Postgres
    // refuses alongside REFERENCING. The trigger is now a bare `after update` statement trigger
    // WITH its transition tables, and the B-4 scoping lives entirely in the function body's
    // per-row value-diff join (pinned below), so a statement that changes no role/active value
    // re-counts nothing. (static.check.mjs "PG-DDL 0A000" lints the whole tree for the pairing.)
    {
      const trgMatch = /create trigger league_members_last_commissioner_stmt\b[\s\S]*?;/.exec(draftSql);
      assert(!!trgMatch, 'B-4 — the last-commissioner statement trigger is declared (fixture check)');
      const trg = trgMatch ? trgMatch[0].replace(/\s+/g, ' ') : '';
      assert(/^create trigger league_members_last_commissioner_stmt after update on public\.league_members referencing old table as old_rows new table as new_rows for each statement execute function public\.league_members_last_commissioner_stmt\(\);$/.test(trg),
        'B-4 (0A000 fix) — the trigger is `after update on public.league_members referencing old table as old_rows new table as new_rows for each statement`');
      assert(!/\bupdate of\b/i.test(trg),
        'B-4 (0A000 fix) — the trigger carries NO `update OF <columns>` list (Postgres refuses a column list on a trigger with transition tables)');
      const lcFn = /^create or replace function public\.league_members_last_commissioner_stmt\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
      const lcBody = lcFn ? lcFn[1] : '';
      assert(/from new_rows n\s+join old_rows o on o\.league_id = n\.league_id and o\.id = n\.id\s+where n\.role is distinct from o\.role or n\.active is distinct from o\.active/.test(lcBody),
        'B-4 (0A000 fix) — the function body keeps the per-row value-diff join (new_rows vs old_rows on the key, role/active IS DISTINCT FROM) — now the WHOLE scoping mechanism, so a preference save re-counts nothing');
    }

    // Security round-1 finding B-4 — the pre-paste verification query for Drew is present.
    assert(/where not exists \(\s*\n\s*select 1 from public\.league_members m\s*\n\s*where m\.league_id = l\.id and m\.role='commissioner' and m\.active/.test(draftSql)
      || /where m\.league_id\s*=\s*l\.id\s+and\s+m\.role\s*=\s*'commissioner'\s+and\s+m\.active/.test(draftSql),
      'B-4 — a pre-paste verification query (leagues with zero active commissioners) is present for Drew to run before pasting');

    // ════════════════════════════════════════════════════════════════════════════════════════
    // ROUND 2 (Drew rulings, 2026-09-25) — F7d seed-row irrevocability, F10 contact-branch
    // narrowing, "6b yes" chat-read narrowing, and the admin-only-writer scan for item (3).
    // ════════════════════════════════════════════════════════════════════════════════════════

    // Round 2, item (1) — F7d BUILT. `found`, not a bare NULL check (the same idiom MUST-FIX (1)
    // required for admin_set_member_role — the same class of bug, closed at a second call site).
    assert(/select added_by into v_seed_added_by from public\.platform_admins where user_id = p_user;/.test(platformAdminRpcBody),
      'F7d — admin_set_platform_admin reads added_by for the target row before deciding whether to refuse');
    assert(/if found and v_seed_added_by is null then/.test(platformAdminRpcBody),
      'F7d — the seed-row check is gated on `found` (never raises for a p_user with no platform_admins row at all, only for a MATCHED row whose added_by is null)');
    assert(/message = 'seed_admin_irrevocable'/.test(platformAdminRpcBody),
      "F7d — the refusal raises exactly 'seed_admin_irrevocable'");
    assert(!/-- select added_by into v_seed_added_by/.test(draftSql),
      'F7d — the seed-protection block is LIVE code, not a commented-out placeholder (round 1\'s "pending Drew" block is gone, not merely uncommented alongside a duplicate)');

    // Round 2, item (3) — admin promotion is admin-only. The first executable statement of
    // admin_set_platform_admin is is_platform_admin(), and it never mentions is_commissioner
    // anywhere in its own body (unlike admin_set_member_role, which legitimately allows either).
    assert(/^\s*if not public\.is_platform_admin\(\) then raise exception 'not_platform_admin'; end if;/m.test(platformAdminRpcBody),
      "item (3) — admin_set_platform_admin's first executable statement checks is_platform_admin() only");
    assert(!/is_commissioner/.test(platformAdminRpcBody),
      'item (3) — admin_set_platform_admin never mentions is_commissioner anywhere in its body (promoting/demoting a PLATFORM admin is never reachable via league commissionership)');

    // Round 2, item (3) — no OTHER function in the draft writes to platform_admins. Scans every
    // function body in the file for `into public.platform_admins` / `from public.platform_admins`
    // on an insert/delete/update statement, and asserts the only function name attached to any
    // such hit is admin_set_platform_admin.
    {
      const allFnBlocks = [];
      const fnRe = /^create or replace function public\.(\w+)\([\s\S]*?\$\$([\s\S]*?)\$\$;/mg;
      let fm;
      while ((fm = fnRe.exec(draftSql))) allFnBlocks.push({ name: fm[1], body: fm[2] });
      assert(allFnBlocks.length >= 8, `fixture check — the draft's own function scan found a plausible number of functions (found ${allFnBlocks.length})`);
      const writers = allFnBlocks.filter((f) =>
        /(insert into|delete from|update)\s+public\.platform_admins\b/.test(f.body));
      assert(writers.length === 1 && writers[0].name === 'admin_set_platform_admin',
        'item (3) — admin_set_platform_admin is the ONLY function in the draft that writes to platform_admins',
        JSON.stringify(writers.map((f) => f.name)));
    }

    // Round 2, item (2) — F10: get_member_contacts's admin branch narrowed to member leagues.
    const gmcMatch = /^create or replace function public\.get_member_contacts\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!gmcMatch, 'get_member_contacts() found in the SQL draft (fixture check)');
    const gmcBody = gmcMatch ? gmcMatch[1] : '';
    assert(/if \(public\.is_platform_admin\(\) and public\.is_member\(p_league\)\) or public\.is_commissioner\(p_league\) then/.test(gmcBody),
      'F10 — get_member_contacts narrows the admin branch to `is_platform_admin() AND is_member(p_league)`, ORed with the unaffected commissioner branch');
    assert(/raise exception 'not_member'/.test(gmcBody) && /m\.user_id = auth\.uid\(\)/.test(gmcBody),
      'F10 — the plain-member own-row branch and not_member fallback are unchanged (rebuild preserves 0007\'s other branches byte-for-byte)');

    // Round 2, item (2) — "6b yes": messages_select's admin platform-wide read is removed.
    const msgSelectMatch = /^create policy messages_select on public\.messages for select to authenticated\s+using \(([\s\S]*?)\);/m.exec(draftSql);
    assert(!!msgSelectMatch, 'messages_select policy found in the SQL draft (fixture check)');
    const msgSelectBody = msgSelectMatch ? msgSelectMatch[1] : '';
    assert(!/is_platform_admin/.test(msgSelectBody),
      "6b — messages_select's redefined body never mentions is_platform_admin (the admin platform-wide chat read is removed entirely)");
    assert(/visible_to is null or visible_to = public\.my_member_id\(league_id\)/.test(msgSelectBody),
      "6b — the 0018 visible_to narrowing is preserved untouched (only the admin disjunct was removed, not 0018's own fix)");

    // Round 2, item (4)/(5) — the header notes exist (documentation-only items, cheaply proven).
    assert(/CLARIFICATION, NO SQL CHANGE \(round 2, item 4\)/.test(draftSql) && /remain commissioner-gated/.test(draftSql),
      'item (4) — the header names issue_claim_code/get_claim_codes/unlink_member as unchanged, commissioner-gated RPCs');
    assert(/RESERVED, NOT BUILT \(round 2, item 5\)/.test(draftSql) && /platform_admins\.is_super boolean not null default false/.test(draftSql),
      'item (5) — the header reserves platform_admins.is_super for the separate T-35 design input');
  }

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // R-c (Group F fix round 2) — THE SECOND GUC ESCAPE, SCANNED THE SAME WAY AS THE FIRST.
  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Both escapes above are ONE boolean OR-ed into ONE `if not (...)` test in the guard, so
  // neither is a per-column grant: arming either opens the WHOLE commissioner-only column set
  // (role / active / email / phone_verified / created_at). What actually stays narrow is the
  // SET LIST of the function that arms it — which makes the two scans the same assertion made
  // twice, and belongs under one heading:
  //
  //   app.role_change        armed by admin_set_member_role()   (B_roles_pilot.sql) — scanned above
  //   app.account_anonymize  armed by anonymize_own_account()   (F_accounts.sql)    — scanned here
  //
  // `role` in the SECOND one would be self-promotion through an anonymization RPC (a caller
  // handing themselves 'commissioner' on the way out); `phone_verified` would be a second
  // writer of a fact the guard already forces to false as a side effect of the `phone` change
  // (Amendment 2 R-4, SEC F14). F_accounts.sql's own boundary comment named this assertion as
  // OWED and not built; this is it.
  // RE-POINTED 2026-09-25 — F_accounts.sql was merged into supabase/migrations/0029_f_accounts.sql
  // (byte-identical below its own header block); same line-anchoring reasoning as draftPath above.
  const fDraftPath = join(__dirname, 'supabase', 'migrations', '0029_f_accounts.sql');
  let fDraftSql = '';
  try {
    fDraftSql = await readFile(fDraftPath, 'utf8');
  } catch (e) {
    fail++;
    console.error('  ❌ Migration 0029 not found at', fDraftPath, '—', e.message);
  }

  if (fDraftSql) {
    // Anchored at the start of a line, for the same reason every regex above is: this file's
    // own header comments quote function names literally, and an unanchored match would capture
    // forward from a COMMENT to the next `$$`.
    const anonMatch = /^create or replace function public\.anonymize_own_account\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(fDraftSql);
    assert(!!anonMatch, 'anonymize_own_account() found in the Group F SQL draft (fixture check)');
    // Comments stripped BEFORE the SET clause is isolated: this function's body carries a long
    // boundary comment that legitimately uses the words `role` and `phone_verified` to explain
    // why neither may be written. Prose naming the hazard must not be what fails the scan (the
    // same prose-exclusion rule the v_found scan above uses); LIVE SQL is.
    const anonSql = (anonMatch ? anonMatch[1] : '').split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
    const setMatch = /update\s+public\.league_members\s+set\s+([\s\S]*?)\s+where\s/i.exec(anonSql);
    assert(!!setMatch, "R-c — anonymize_own_account()'s `update public.league_members set … where …` clause is isolatable (fixture check)");
    const anonSetList = setMatch ? setMatch[1] : '';
    // Positive first, so the scan cannot pass by matching an empty string.
    assert(/\buser_id\s*=\s*null/.test(anonSetList) && /\bemail\s*=\s*null/.test(anonSetList)
      && /\bactive\s*=\s*false/.test(anonSetList) && /\blink_disputed_at\s*=\s*now\(\)/.test(anonSetList),
      'R-c — the SET list really is the anonymization one (user_id/email nulled, active false, link_disputed_at stamped) — a non-vacuity check on the capture itself');
    assert(!/\brole\b/.test(anonSetList),
      "R-c — anonymize_own_account()'s SET list never assigns `role`: app.account_anonymize opens the whole commissioner-only column set, so this list is the real boundary, and a caller must never be able to self-promote on the way out");
    assert(!/\bphone_verified\b/.test(anonSetList),
      "R-c — …and never assigns `phone_verified` either (Amendment 2 R-4: the guard's own SEC F14 clause clears it as a side effect of the `phone` change — a second writer of the same fact is what R-4 forbids)");
    // The pairing itself, stated as an assertion rather than only in prose: each escape is armed
    // by exactly one function in these two drafts, and each of those functions has been scanned.
    assert(/perform set_config\('app\.account_anonymize', '1', true\)/.test(anonSql),
      'R-c — anonymize_own_account() is the function that arms app.account_anonymize, transaction-locally (`true`), so the SET list scanned above is the one that bounds this escape');
    assert(!/league_members_guard/.test(fDraftSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')),
      'R-c — the Group F draft defines no version of league_members_guard() in live SQL (guard authority stays with B_roles_pilot.sql, whose privileged branch is scanned above) — comment lines naming it are excluded');
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 11. T-35 SUPER ADMIN (DI-344/345, 2026-09-25) — isSuperAdmin() / isLeaguePaused() truth
//     tables, the extended allow-list scan, and the SQL draft's T-35 sections (10-20).
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── isSuperAdmin() ──');
{
  assert(isSuperAdmin(undefined) === false, 'undefined session -> false');
  assert(isSuperAdmin(null) === false, 'null session -> false');
  assert(isSuperAdmin({}) === false, 'empty session (mid-hydrate shape) -> false, not undefined-is-truthy');
  assert(isSuperAdmin({ isSuperAdmin: false }) === false, 'explicit false -> false');
  assert(isSuperAdmin({ isSuperAdmin: true }) === true, 'explicit true -> true');
  assert(isSuperAdmin({ isSuperAdmin: 1 }) === false, 'truthy-but-not-boolean-true (1) -> false — strict === true only');
  assert(isSuperAdmin({ isPlatformAdmin: true }) === false,
    'a regular platform admin (isPlatformAdmin true, isSuperAdmin absent) -> false — no fallback from one flag to the other');
  assert(isSuperAdmin({ isPlatformAdmin: true, isSuperAdmin: true }) === true,
    "Drew's real shape — both flags true -> true (the two flags are independent booleans on the same session, not merged by this function)");
}

console.log('\n── isLeaguePaused() ──');
{
  assert(isLeaguePaused(undefined) === false, 'undefined league -> false');
  assert(isLeaguePaused(null) === false, 'null league -> false');
  assert(isLeaguePaused({}) === false, 'old cached record with no status field at all (default-when-missing) -> false, matching the column default');
  assert(isLeaguePaused({ status: 'active' }) === false, 'status: "active" -> false');
  assert(isLeaguePaused({ status: 'paused' }) === true, 'status: "paused" -> true');
  assert(isLeaguePaused({ status: 'Paused' }) === false, 'case-sensitive — "Paused" is not the literal enum value -> false');
}

console.log('\n── whole-tree isSuperAdmin allow-list scan (DI-344 §Render paths) ──');
{
  const jsDir = join(__dirname, 'js');
  const jsFiles = (await readdir(jsDir)).filter((f) => f.endsWith('.js')).sort();
  assert(jsFiles.length >= 20,
    `fixture check — the app-wide scan really enumerated js/*.js (found ${jsFiles.length} files)`);

  // DISCOVERED DURING BUILD (2026-09-25) — a concurrent thread (group A1, js/control-center.js)
  // has ALREADY landed the "enumerated control-center gating call site" DI-344 §Render paths
  // names (`starredPanels()`'s `flags.isSuperAdmin === true` branch, explicitly commented there
  // as a placeholder that "can never be true in production today"), and js/admin-panel.js
  // already carries its own Super Admin tab gate (also placeholder-shaped, per that file's own
  // comments). Both are on DI-344's OWN allow-list by file name — "ONLY in this file, inside
  // _recomputeSynthesizedSession() in js/auth.js, inside js/admin-panel.js, and at the
  // enumerated control-center gating call site" — so both are excluded BY FILE NAME below,
  // exactly like the isPlatformAdmin scan (section 5) excludes admin-panel.js unconditionally
  // rather than pinning it to a wave-specific line count. This task's own scope explicitly
  // excludes editing either file this pass (WIRING_CHECKLIST_G_092526.md), so this scan proves
  // only that neither file has drifted OUTSIDE the allow-list shape, not that this pass built
  // either placeholder.
  // UX Revamp wiring pass 1 (2026-09-25) — js/app.js's buildControlCenterCtx()
  // composes ctx.flags.isSuperAdmin from the new js/auth.js getter, the SAME
  // "enumerated control-center gating call site" this file's own text names,
  // one line below its isPlatformAdmin sibling.
  // Security fix round (2026-09-25), NOTE 3 — pinned by LINE AND TEXT, same
  // reasoning as the isPlatformAdmin scan above. Re-derived after the wiring
  // pass 2 edits shifted this block by 8 lines. A SECOND site,
  // composeAdminViewer() (11813), added the same day (wiring pass 2) —
  // identical reasoning to the isPlatformAdmin scan's own second entry.
  // Three more sites, all inside renderAdminPage()/its own helpers (the
  // admin route's DOM-wiring layer, wiring pass 2) — each is a PROPERTY
  // READ of the ALREADY-COMPOSED `viewer.isSuperAdmin` (line 11813 above),
  // never a fourth independent derivation (no second getIsSuperAdmin()
  // call): 11933/11942 decide whether to fetch the cross-league
  // leagues/platform_kv reads the Super Admin panel needs; 12016 decides
  // whether to bind the Super Admin tab's own controls. All three are
  // chrome/wiring decisions, structurally unreachable from any picks-
  // visibility path (nothing here touches canViewOtherPicks()/
  // arePicksPublic()/extra-point.js).
  // Re-derived against the live worktree, UX Revamp wiring pass 3a
  // (2026-09-25) — earlier edits to composeAdminViewer()/renderAdminPage()
  // shifted this block; same five sites, no new ones (the users/leagues
  // cross-league read added this pass gates on `viewer.isPlatformAdmin`,
  // a separate flag, already covered by ENUMERATED_CALL_SITES above).
  // Re-derived, wiring pass 3a-bis (2026-09-25) — same five sites, only
  // their line numbers moved (see the ENUMERATED_CALL_SITES note above).
  // Re-derived, UX Revamp wiring pass 3b (2026-09-25) — same +1 shift as
  // ENUMERATED_CALL_SITES above (one net import line ahead of this block);
  // same five sites, no new ones.
  // Re-derived, UX Revamp wiring pass 3c (2026-09-25) — same reasoning/same
  // shift as ENUMERATED_CALL_SITES's own wiring-pass-3c note above; same
  // five sites, no new ones, only their line numbers moved.
  // Re-derived, 3c FIX WINDOW (2026-09-25) — same shift/same reasoning as
  // ENUMERATED_CALL_SITES's own note above; same five sites, no new ones.
  // Re-derived, reviewer round 3 items 1-7 / security N-1/N-2 (2026-09-26) —
  // same shift/same reasoning as ENUMERATED_CALL_SITES's own note above;
  // same five sites, no new ones.
  // Re-derived 2026-09-26 (v0.26.0 stamp + full-app review fix window): line numbers only, same sites, same texts, matched by exact text.
  // Re-derived 2026-09-27 (v0.27.0 bugfix pass: the #control-center-trigger fill + week-swipe chronology + stamp): line numbers only, same sites, same texts, matched by exact text.
  // Re-derived 2026-09-27 (UX Revamp post-deploy pass, APP-SHELL slice) — same
  // reasoning/same shift as ENUMERATED_CALL_SITES's own note above; same five
  // sites, no new ones, only their line numbers moved.
  // Re-derived 2026-09-27 (this pass, DI-360/wizard reconciliation edits
  // above these sites) — line numbers only, same five sites, matched by
  // exact text.
  // Re-derived 2026-09-27 (app-shell part 3A review pass: Finding 4's
  // _buildControlCenterCtxForTest export ahead of buildControlCenterCtx(),
  // plus a pre-existing drift this pass also found and closed rather than
  // compounding — same five sites, only the line numbers moved, matched by
  // text).
  // Re-derived 2026-09-27 (app-shell part 3B: header/nav/viewing-week-card
  // pass — code added above every one of these five sites shifted their
  // line numbers only; same five sites, matched by exact text).
  // Re-derived 2026-09-28 (DI-406/407/408: New Week button, Build Slate
  // resizing, and the "Collapse all / Expand all" heading-row pair, all
  // land ahead of these sites) — line numbers only, same five sites,
  // matched by exact text.
  // Re-derived 2026-09-28 (REVIEWER ROUND 2 B1 — renderAdminPage() now calls
  // wireCollapsibleSections(c) for real, plus the DI-405/DI-408 stale-
  // comment fixes above these sites) — line numbers only, same five sites,
  // matched by exact text.
  // Re-derived AGAIN 2026-09-28 (UX Revamp v0.27.2, DI-418/421/422/423 —
  // same additions as the isPlatformAdmin allow-list above, above every
  // 'app.js' pin here except the first) — line numbers only, same five
  // sites, matched by exact text.
  // Re-derived 2026-09-29 (MERGE — feat/gestures-v0272 rounds 2–3 (Opus) and
  // feat/control-center-v0272 rounds 2–5 (Opus) merged into release/v0.27.2:
  // picksShowingWeek(), the Picks swipe getState() rewrite, showJoinLeagueSheet(),
  // leagueJoinFormHTML()/bindLeagueJoinForm(), patchProfileAlmaMaterOptionsInPlace()
  // and doSwitchActiveLeague()'s boolean return all sit above one or more of
  // these sites) — line numbers only, same sites, matched by exact text against
  // the MERGED tree.

  // Re-derived 2026-09-28 (DI-424/425/428(b) — the Weekly Blurb wizard step,
  // the Extra Point "Extra Games" collapsible wrapper, the three Admin→Data
  // card bodies, and the Games-tab slate-row logo helpers all land ahead of
  // some or all of these sites) — line numbers only, same five sites,
  // matched by exact text.
  // Re-derived AGAIN 2026-09-28 (REVIEWER ROUND 2 merge — feat/control-center-v0272's
  // round 2 (B1-B4/D1-D2, RG-298) merged with release/v0.27.2's own reviewer
  // round 2 B1/B2/B3/N1 fixes — line numbers only, same five sites, matched
  // by exact text against the merged tree.
  // Re-derived 2026-09-29 (MERGE — feat/gestures-v0272 rounds 2–3 (Opus) and
  // feat/control-center-v0272 rounds 2–5 (Opus) merged into release/v0.27.2:
  // picksShowingWeek(), the Picks swipe getState() rewrite, showJoinLeagueSheet(),
  // leagueJoinFormHTML()/bindLeagueJoinForm(), patchProfileAlmaMaterOptionsInPlace()
  // and doSwitchActiveLeague()'s boolean return all sit above one or more of
  // these sites) — line numbers only, same sites, matched by exact text against
  // the MERGED tree.
  // Re-derived 2026-09-29 (v0.27.2 STAMP — the WHATS_NEW v0.27.2 entry at app.js:102 sits above every site) — line numbers only, matched by exact text.
  const ENUMERATED_SUPER_CALL_SITES = [
    { file: 'app.js', line: 3841, text: 'isSuperAdmin: getIsSuperAdmin(),' },
    { file: 'app.js', line: 13587, text: 'isSuperAdmin: getIsSuperAdmin(),' },
    { file: 'app.js', line: 14061, text: 'if (viewer.isSuperAdmin) {' },
    // Text updated, wiring pass 3a-bis (BLOCK 2's `attempted` guard replaces
    // `loaded`/`loading`-only).
    { file: 'app.js', line: 14076, text: 'if (viewer.isSuperAdmin && !_platformKvCache.attempted && !_platformKvCache.loading) refreshPlatformKvCache();' },
    { file: 'app.js', line: 14277, text: 'if (viewer.isSuperAdmin) bindSuperAdminControls();' },
  ];

  function findIdentifierHitsLocal(src, ident) {
    const hits = [];
    const re = new RegExp(`\\b${ident}\\b`);
    src.split('\n').forEach((rawLine, i) => {
      const t = rawLine.trimStart();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*') || t.startsWith('<!--')) return;
      if (re.test(rawLine)) hits.push({ line: i + 1, text: rawLine.trim() });
    });
    return hits;
  }

  const indexHtmlSrc2 = await readFile(join(__dirname, 'index.html'), 'utf8');
  const allSuperHits = [];
  for (const f of jsFiles) {
    const src = await readFile(join(jsDir, f), 'utf8');
    findIdentifierHitsLocal(src, 'isSuperAdmin').forEach((h) => allSuperHits.push({ file: f, ...h }));
  }
  findIdentifierHitsLocal(indexHtmlSrc2, 'isSuperAdmin').forEach((h) => allSuperHits.push({ file: 'index.html', ...h }));

  const SUPER_ALLOWED_FILES = ['roles.js', 'auth.js', 'admin-panel.js', 'control-center.js'];
  const superOffenders = allSuperHits.filter((h) => {
    if (SUPER_ALLOWED_FILES.includes(h.file)) return false;
    return !ENUMERATED_SUPER_CALL_SITES.some((c) => c.file === h.file && c.line === h.line && c.text === h.text);
  });
  assert(superOffenders.length === 0,
    "DI-344 §Render paths — every 'isSuperAdmin' hit in js/*.js AND index.html is inside the allow-list (roles.js, auth.js's _recomputeSynthesizedSession, admin-panel.js, the control-center gating call site, or an enumerated call site)",
    JSON.stringify(superOffenders));

  const superRoleHits = allSuperHits.filter((h) => h.file === 'roles.js');
  assert(superRoleHits.length > 0, 'canary — the scan DOES find isSuperAdmin inside roles.js itself (a broken scan would report zero everywhere)');

  // RE-CONFIRMED 2026-09-25 (UX Revamp WIRING PASS 1) — same shape as the isPlatformAdmin note
  // above: js/auth.js's session.isSuperAdmin derivation DID land, at the SAME
  // `_recomputeSynthesizedSession()` chokepoint, in the SAME edit as isPlatformAdmin (DI-344 §8's
  // own instruction — "not a second window"), fed by the same `_refreshPlatformAdminFlags()` —
  // but exposed as `getIsSuperAdmin()`, a differently-spelled identifier, for the identical
  // "getSession() stays exactly three keys, and never joins this allow-list fence" reason.
  //
  // ONE enumerated exception added, merge round 2 (2026-09-28) — SAME finding
  // and SAME reasoning as AUTH_JS_ENUMERATED_HITS's own dated note above:
  // found already-red on release/v0.27.2's own tip, not introduced by this
  // merge. hotfix/cc-alma-admin's RG-293 no-session fail-closed return
  // (`refreshPlatformAdminFlags()`, js/auth.js:1892) is `{ isPlatformAdmin:
  // false, isSuperAdmin: false }` — ONE object literal that legitimately
  // trips BOTH scans, since it is the canonical derivation function's own
  // fail-closed branch, not a second, independent re-derivation of the flag
  // anywhere else. This was a hard zero-tolerance check with no exception
  // mechanism at all (unlike the isPlatformAdmin scan just above) because no
  // auth.js line had ever legitimately carried the literal `isSuperAdmin`
  // text before; it now needs the identical one-line allow-list shape.
  const AUTH_JS_ENUMERATED_SUPER_HITS = [
    { line: 1892, text: 'return { isPlatformAdmin: false, isSuperAdmin: false };' },
  ];
  const superAuthHits = allSuperHits.filter((h) => h.file === 'auth.js'
    && !AUTH_JS_ENUMERATED_SUPER_HITS.some((c) => c.line === h.line && c.text === h.text));
  assert(superAuthHits.length === 0,
    'auth.js carries ZERO literal isSuperAdmin hits beyond the one enumerated fail-closed-return exception — the real derivation lives in _recomputeSynthesizedSession()/_refreshPlatformAdminFlags(), exposed via getIsSuperAdmin() (by design, never on this allow-list)',
    JSON.stringify(superAuthHits));

  // admin-panel.js and control-center.js — DISCOVERED DURING BUILD, NOT built by this pass: a
  // concurrent thread already landed placeholder-shaped isSuperAdmin gates in both files (both
  // explicitly commented there as unreachable in production today, pending DI-344/345's server
  // side). Both are legitimately on DI-344's own allow-list by file name, so this suite does not
  // assert a specific count for either — only that every hit anywhere else in the tree is zero
  // (proven above by superOffenders.length === 0). A non-vacuity canary confirms the scan is
  // actually seeing them, so "allowed" is not silently "never checked."
  const superAdminPanelHits = allSuperHits.filter((h) => h.file === 'admin-panel.js');
  const superControlCenterHits = allSuperHits.filter((h) => h.file === 'control-center.js');
  assert(superAdminPanelHits.length > 0 || superControlCenterHits.length > 0,
    'canary — at least one of admin-panel.js / control-center.js already carries an isSuperAdmin hit today (both are legitimately allow-listed by file name; a broken scan would silently show neither)',
    JSON.stringify({ adminPanel: superAdminPanelHits, controlCenter: superControlCenterHits }));
}

console.log('\n── SQL draft: T-35 sections 10-20 (super admin, league pause) ──');
{
  // RE-POINTED 2026-09-25 — see the identical note on the section-9/10 block above.
  const draftPath = join(__dirname, 'supabase', 'migrations', '0026_b_roles_pilot.sql');
  const draftSql = await readFile(draftPath, 'utf8');
  const nonCommentSql = draftSql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

  // ── Section 10 — platform_admins.is_super ──
  assert(/alter table public\.platform_admins add column if not exists is_super boolean not null default false;/.test(draftSql),
    'Section 10 — platform_admins.is_super added, default false');
  assert(/create unique index if not exists platform_admins_is_super_uidx on public\.platform_admins \(is_super\) where is_super;/.test(draftSql),
    'Section 10 — the partial unique index on is_super is present');
  {
    // No function in the WHOLE draft (sections 1-20) ever WRITES is_super — scanned narrowly
    // (an INSERT column list or an UPDATE SET clause naming it), never a bare substring scan:
    // is_super_admin()'s own SELECT body legitimately READS `a.is_super` (section 14), and a
    // naive `/is_super\s*[,)]/` scan over whole function bodies flagged that read as a false
    // "writer" on first pass (`a.is_super)` matches the same shape an INSERT column list's
    // trailing `is_super)` would) — narrowed to the two real write shapes instead.
    const platformAdminsInserts = [...draftSql.matchAll(/insert into public\.platform_admins\s*\(([^)]*)\)/g)];
    const platformAdminsUpdates = [...draftSql.matchAll(/update public\.platform_admins\b[\s\S]*?\bset\s+([^;]*);/g)];
    const writeClauses = [...platformAdminsInserts, ...platformAdminsUpdates].map((m) => m[1]);
    assert(writeClauses.length > 0,
      'fixture check — platform_admins really is written somewhere in the draft (admin_set_platform_admin, section 7) — a broken scan would pass vacuously');
    const isSuperInWriteClause = writeClauses.some((c) => /\bis_super\b/.test(c));
    assert(!isSuperInWriteClause,
      'Section 10 — is_super never appears in an INSERT column list or an UPDATE SET clause against platform_admins anywhere in the draft (the only writer is a migration Drew runs himself, not built here)',
      JSON.stringify(writeClauses));
  }

  // ── Section 11 — leagues.status + leagues_guard() ──
  assert(/alter table public\.leagues add column if not exists status text not null default 'active' check \(status in \('active','paused'\)\);/.test(draftSql),
    'Section 11 — leagues.status added, default active, checked in (active,paused)');
  {
    // leagues_guard() is defined TWICE in this draft — section 1's original body, then section
    // 11's redefinition — and `create or replace function` means the LAST one is what actually
    // ships. A non-global `.exec()` returns the FIRST match, which silently tested the ORIGINAL
    // (pre-T-35) body and passed the F-5/N7 comment assertions only because section 11
    // reproduces those verbatim too — the NEW (T-35)-specific assertions caught the mismatch.
    // Fixed the same way the file's own header describes resolving last-wins elsewhere: take
    // the LAST match, not the first.
    const guardMatches = [...draftSql.matchAll(/^create or replace function public\.leagues_guard\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/gm)];
    assert(guardMatches.length === 2, 'fixture check — leagues_guard() is defined exactly twice (section 1 original, section 11 T-35 redefinition)', `found ${guardMatches.length}`);
    const guardMatch = guardMatches[guardMatches.length - 1];
    assert(!!guardMatch, 'leagues_guard() found in the SQL draft (fixture check)');
    const guardBody = guardMatch ? guardMatch[1] : '';
    assert(/-- NEW \(T-35\)/.test(guardBody), "R-1 — leagues_guard()'s NEW (T-35) branch is present and marked");
    assert(/if NEW\.status is distinct from OLD\.status/.test(guardBody) && /app\.league_status_change/.test(guardBody),
      "Section 11 — the status conjunct checks NEW.status is distinct from OLD.status against the coalesced app.league_status_change GUC");
    assert(/coalesce\(current_setting\('app\.league_status_change', true\), ''\) <> '1'/.test(guardBody),
      'Section 11 — the app.league_status_change read is COALESCED, the same three-valued-logic rule every other GUC check in this file uses');
    // R-1 — the F-5 paragraph (created_by null-transition-only comment) must be RETAINED, not
    // dropped when the function was reproduced for this section's NEW branch.
    assert(/CHANGED \(F-5, group-F security gate, 2026-09-25\)/.test(guardBody) && /ON DELETE SET NULL/.test(guardBody),
      "R-1 — leagues_guard()'s F-5 paragraph (the created_by null-transition explanation) is retained verbatim, not dropped when the function was reproduced for T-35's NEW branch");
    assert(/N7 — the importer/.test(guardBody), "R-1 — the N7 importer comment is also retained verbatim");
    assert(/join_code has ONE legitimate escape hatch/.test(guardBody), 'Section 11 — the join_code branch and its comment are untouched, after the new status branch');
  }

  // ── Section 12 — platform_kv ──
  assert(/create table if not exists public\.platform_kv \(/.test(draftSql), 'Section 12 — platform_kv table declared');
  assert(/key\s+text primary key check \(key in \('maintenance_banner','signups_open'\)\)/.test(draftSql),
    'Section 12 — platform_kv.key is a primary key CHECKed to exactly the two named keys');
  assert(/updated_by\s+uuid references auth\.users\(id\) on delete set null/.test(draftSql),
    'Section 12 — platform_kv.updated_by states its on delete action explicitly (set null)');
  assert(/check \(key <> 'maintenance_banner' or length\(value::text\) <= 280\)/.test(draftSql),
    'Section 12 — the maintenance_banner length CHECK is present');
  assert(/alter table public\.platform_kv enable row level security;/.test(draftSql)
    && /alter table public\.platform_kv force row level security;/.test(draftSql),
    'Section 12 — platform_kv carries both ENABLE and FORCE row level security');
  assert(/revoke all on table public\.platform_kv from anon, authenticated;/.test(draftSql),
    'Section 12 — the revoke precedes the select grant (security-fix point 10 pattern)');
  const revokeIdx = draftSql.indexOf('revoke all on table public.platform_kv from anon, authenticated;');
  const grantIdx = draftSql.indexOf('grant select on public.platform_kv to authenticated;');
  assert(revokeIdx >= 0 && grantIdx > revokeIdx, 'Section 12 — the revoke textually precedes the grant');
  assert(/create policy platform_kv_select on public\.platform_kv for select to authenticated using \(true\);/.test(draftSql),
    "Section 12 — the SELECT policy is `using (true)`, deliberately not is_member(...), because the table has no league_id");
  assert(/insert into public\.platform_kv \(key, value\) values/.test(draftSql) && /'signups_open', 'true'::jsonb/.test(draftSql),
    'Section 12 — both rows are seeded by the migration itself');

  // ── Section 13 — platform_audit_log action CHECK ──
  assert(/alter table public\.platform_audit_log drop constraint if exists platform_audit_log_action_check;/.test(draftSql),
    'Section 13 — the action CHECK is dropped BY EXPLICIT NAME');
  assert(/check \(action in \('admin_grant','admin_revoke','role_change','league_status_change','platform_kv_change'\)\)/.test(draftSql),
    'Section 13 — the re-added CHECK lists all five legal actions together, not just the two new ones');

  // ── Section 14 — is_super_admin() ──
  {
    const m = /^create or replace function public\.is_super_admin\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'is_super_admin() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    assert(/select exists \(select 1 from public\.platform_admins a where a\.user_id = auth\.uid\(\) and a\.is_super\)/.test(body),
      'Section 14 — is_super_admin() mirrors is_platform_admin() byte-for-byte in shape');
  }
  assert(/revoke all on function public\.is_super_admin\(\) from public, anon;/.test(draftSql)
    && /grant execute on function public\.is_super_admin\(\) to authenticated;/.test(draftSql),
    'Section 14 — is_super_admin() is revoked from public/anon and granted to authenticated');

  // ── Section 15 — super_set_league_status() ──
  {
    const m = /^create or replace function public\.super_set_league_status\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'super_set_league_status() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    assert(/^\s*if not public\.is_super_admin\(\) then raise exception 'not_super_admin'; end if;/m.test(body),
      "Section 15 — super_set_league_status's first executable statement checks is_super_admin() only");
    assert(/if p_status not in \('active','paused'\) then raise exception 'bad_status'; end if;/.test(body),
      'Section 15 — p_status is validated against the two legal values');
    assert(/if not found then raise exception 'not_found'; end if;/.test(body),
      "Section 15 — uses the runtime `found` boolean, the same MUST-FIX (1) idiom as admin_set_member_role");
    assert(/perform set_config\('app\.league_status_change', '1', true\);/.test(body),
      'Section 15 — arms the leagues_guard() escape hatch transaction-locally, before its own UPDATE');
    assert(/insert into public\.platform_audit_log \(actor_user_id, action, before_role, after_role, league_id\)/.test(body)
      && /'league_status_change'/.test(body),
      'Section 15 — inserts into platform_audit_log with action league_status_change');
  }
  assert(/revoke all on function public\.super_set_league_status\(uuid, text\) from public, anon;/.test(draftSql)
    && /grant execute on function public\.super_set_league_status\(uuid, text\) to authenticated;/.test(draftSql),
    'Section 15 — super_set_league_status is revoked from public/anon and granted to authenticated');

  // ── Section 16 — super_set_platform_kv() ──
  {
    const m = /^create or replace function public\.super_set_platform_kv\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'super_set_platform_kv() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    assert(/^\s*if not public\.is_super_admin\(\) then raise exception 'not_super_admin'; end if;/m.test(body),
      "Section 16 — super_set_platform_kv's first executable statement checks is_super_admin() only");
    assert(/if p_key not in \('maintenance_banner','signups_open'\) then raise exception 'bad_key'; end if;/.test(body),
      'Section 16 — p_key is validated server-side, not only via the table CHECK');
    assert(/select value into v_old from public\.platform_kv where key = p_key;/.test(body),
      'Section 16 — the before-value is captured (security-fix point 7)');
    assert(/insert into public\.platform_audit_log \(actor_user_id, target_member_id, action, before_role, after_role\)/.test(body)
      && /'platform_kv_change'/.test(body) && /values \(auth\.uid\(\), p_key, 'platform_kv_change', v_old::text, p_value::text\)/.test(body),
      'Section 16 — inserts into platform_audit_log with target_member_id carrying the key name');
  }
  assert(/revoke all on function public\.super_set_platform_kv\(text, jsonb\) from public, anon;/.test(draftSql)
    && /grant execute on function public\.super_set_platform_kv\(text, jsonb\) to authenticated;/.test(draftSql),
    'Section 16 — super_set_platform_kv is revoked from public/anon and granted to authenticated');

  // ── Section 17 — league_active() ──
  {
    const m = /^create or replace function public\.league_active\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'league_active() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    assert(/select coalesce\(\(select status from public\.leagues l where l\.id = p_league\) = 'active', false\);/.test(body),
      "Section 17 — league_active() coalesces to FALSE (fail-closed), never to true");
  }
  assert(/revoke all on function public\.league_active\(uuid\) from public, anon;/.test(draftSql)
    && /grant execute on function public\.league_active\(uuid\) to authenticated;/.test(draftSql),
    'Section 17 — league_active is revoked from public/anon and granted to authenticated');

  // ── Section 18 — create_league / join_league signups_open gate ──
  {
    const m = /^create or replace function public\.create_league\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'create_league() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    const gateIdx = body.search(/if not coalesce\(\(select \(l\.value = 'true'::jsonb\) from public\.platform_kv l where l\.key = 'signups_open'\), false\) then/);
    const authIdx = body.search(/if auth\.uid\(\) is null then raise exception 'not_authenticated'/);
    assert(gateIdx >= 0 && authIdx >= 0 && gateIdx < authIdx,
      "Section 18 — create_league's signups_open gate is its FIRST statement, ahead of the auth.uid() check");
    assert(!/v_open\b/.test(body.replace(/--.*$/mg, '')),
      'Section 18 — no intermediate INTO variable is used for the signups_open read (the literal coalesced expression only)');
  }
  {
    const m = /^create or replace function public\.join_league\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'join_league() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    const idempotentIdx = body.search(/if v_existing is not null then\s*\n\s*return v_existing;/);
    const gateIdx = body.search(/if not coalesce\(\(select \(l\.value = 'true'::jsonb\) from public\.platform_kv l where l\.key = 'signups_open'\), false\) then/);
    const insertIdx = body.search(/insert into public\.league_members \(league_id, id, user_id, role, display_name, email, linked_at\)/);
    assert(idempotentIdx >= 0 && gateIdx >= 0 && insertIdx >= 0 && idempotentIdx < gateIdx && gateIdx < insertIdx,
      "Section 18 — join_league's signups_open gate sits AFTER the idempotent existing-member return and BEFORE the new-member INSERT — load-bearing ordering, not cosmetic");
  }
  assert(/link_member_by_email\(\) is deliberately NOT gated/.test(draftSql),
    'Section 18 — the header names link_member_by_email() as deliberately ungated, not a silent omission');

  // ── Section 19 — RLS write-gate, nine tables ──
  {
    const TABLE_POLICY_NAMES = [
      'picks_insert', 'picks_update', 'picks_delete',
      'tiebreaker_guesses_insert', 'tiebreaker_guesses_update', 'tiebreaker_guesses_delete',
      'extra_point_guesses_insert', 'extra_point_guesses_update', 'extra_point_guesses_delete',
      'games_insert', 'games_update', 'games_delete',
      'weeks_insert', 'weeks_update', 'weeks_delete',
      'messages_insert', 'reactions_insert', 'game_requests_insert',
      'league_kv_insert', 'league_kv_update',
    ];
    // REVIEWER FIX ROUND 1, MUST-FIX (1) — bounded to the ONE statement. The prior regex used
    // `[\s\S]*?` with NO upper bound, which is non-greedy but still happily runs PAST the named
    // policy's own terminating `;` and into a LATER policy's conjunct — so 19 of these 20
    // assertions were vacuous: deleting the conjunct from `messages_insert` or `picks_insert`
    // alone left the whole file 292/0, because the regex just matched forward into
    // `reactions_insert`'s or `picks_update`'s own `public.league_active(league_id)` instead.
    // `[^;]*;` stops at the first semicolon, which is this draft's own statement terminator
    // (none of these policy bodies contain an embedded `;` — every subquery here is a single
    // SELECT expression in parens) — so the match cannot cross a statement boundary.
    for (const name of TABLE_POLICY_NAMES) {
      const stmtMatch = new RegExp(`create policy ${name} on public\\.\\w+ for (?:insert|update|delete) to authenticated[^;]*;`).exec(draftSql);
      const stmt = stmtMatch ? stmtMatch[0] : '';
      assert(stmt.length > 0,
        `Section 19 — ${name}: fixture check — the policy's OWN statement (bounded to its terminating ';') was found at all`);
      assert(stmt.includes('public.league_active(league_id)'),
        `Section 19 — ${name} gains the public.league_active(league_id) conjunct, WITHIN ITS OWN STATEMENT (not a match that ran forward into a later policy)`);
    }

    // TEETH (reviewer fix round 1) — a positive-control fixture proving the bound above is
    // load-bearing, not decorative. Reproduces the EXACT false-negative shape fix round 1 found:
    // two policies back to back, the FIRST one's conjunct stripped, the SECOND's intact. The old,
    // unbounded regex would read straight through the first statement's `;` and report the
    // SECOND policy's conjunct as if it belonged to the first.
    {
      const mutatedFixtureSql = `
create policy picks_insert on public.picks for insert to authenticated
  with check (member_id = my_member_id(league_id) and pick_window_open(league_id, week_id) and game_pickable(league_id, game_id));
create policy picks_update on public.picks for update to authenticated
  using      (member_id = my_member_id(league_id) and pick_window_open(league_id, week_id) and game_pickable(league_id, game_id)
              and public.league_active(league_id))
  with check (member_id = my_member_id(league_id) and pick_window_open(league_id, week_id) and game_pickable(league_id, game_id)
              and public.league_active(league_id));
`;
      const mutStmtMatch = /create policy picks_insert on public\.\w+ for (?:insert|update|delete) to authenticated[^;]*;/.exec(mutatedFixtureSql);
      const mutStmt = mutStmtMatch ? mutStmtMatch[0] : '';
      assert(mutStmt.length > 0, 'Section 19 teeth — fixture check: the mutated picks_insert statement was found');
      assert(!mutStmt.includes('public.league_active(league_id)'),
        "Section 19 teeth — the BOUNDED scan correctly reports picks_insert's conjunct MISSING even though picks_update (the very next statement) has it — proves the regex cannot run past its own terminating ';' into a later policy (reviewer fix round 1's exact false-negative shape, reproduced and caught)");
      const oldUnboundedRe = /create policy picks_insert on public\.\w+ for (?:insert|update|delete) to authenticated[\s\S]*?public\.league_active\(league_id\)/;
      assert(oldUnboundedRe.test(mutatedFixtureSql),
        'Section 19 teeth — the OLD, unbounded [\\s\\S]*? regex WOULD have (wrongly) matched forward into picks_update\'s conjunct — confirms the bound fixed a real defect, not a stylistic one');
    }
    // reactions_delete is explicitly NOT gated — the judgment call named in §3.3.
    assert(!/create policy reactions_delete[\s\S]{0,10}public\.league_active/.test(draftSql),
      'Section 19 — reactions_delete does NOT gain the conjunct (named judgment call: removing your own reaction is not new content)');
    // messages_select / picks_select / etc. — no SELECT policy anywhere in the draft gains the
    // conjunct; this section only ever touches for-insert/update/delete policies.
    assert(!/create policy messages_select[\s\S]{0,300}public\.league_active/.test(draftSql),
      'Section 19 — messages_select is untouched (no new conjunct on any SELECT policy)');

    // REVIEWER FIX ROUND 1, item (7) — mirrors the messages_select narrowing check above
    // (round-2 item (2)/"6b", the assertion this file already makes for messages_select's OWN
    // redeclaration): messages_insert's Section 19 redeclaration must retain 0018's
    // `visible_to is null` narrowing AND `message_rate_ok(league_id)` — the two properties that
    // matter about the body BESIDES the new conjunct. A scan that only checked for the conjunct's
    // presence (the generic loop above) could not tell "the conjunct was added correctly" apart
    // from "the whole body was replaced with something narrower/wrong that also happens to
    // contain the conjunct string somewhere".
    const msgInsertMatch = new RegExp(`create policy messages_insert on public\\.\\w+ for insert to authenticated[^;]*;`).exec(draftSql);
    assert(!!msgInsertMatch, 'Section 19 — messages_insert: fixture check — the policy statement was found');
    const msgInsertStmt = msgInsertMatch ? msgInsertMatch[0] : '';
    assert(msgInsertStmt.includes('visible_to is null'),
      "Section 19 — messages_insert's redeclaration retains 0018's `visible_to is null` narrowing (SEC F1, 2026-09-20) — not silently dropped when the league_active conjunct was added");
    assert(msgInsertStmt.includes('message_rate_ok(league_id)'),
      "Section 19 — messages_insert's redeclaration retains `message_rate_ok(league_id)` — the rate ceiling is not silently dropped either");
    assert(msgInsertStmt.includes('public.league_active(league_id)'),
      'Section 19 — …and the NEW league_active(league_id) conjunct is present alongside both, in the SAME statement');
  }

  // ── Section 20 — auto_go_live() ──
  {
    const m = /^create or replace function public\.auto_go_live\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'auto_go_live() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    assert(/join public\.leagues l on l\.id = w\.league_id\s+-- NEW \(T-35\)/.test(body),
      "Section 20 — auto_go_live()'s eligible CTE gains the leagues join, marked NEW (T-35)");
    assert(/coalesce\(l\.status, 'active'\) = 'active'\s+-- NEW \(T-35\)/.test(body),
      "Section 20 — the eligible CTE's WHERE clause gains the coalesced active-status conjunct, marked NEW (T-35)");
    assert(/RESIDUAL 1 \(security review of 21718f4\)/.test(body),
      'Section 20 — the pre-existing deny-list residual note is retained verbatim (reproduced from the real file, not a rewrite from prose)');
    assert(/w\.status = 'locked'/.test(body) && /coalesce\(w\.auto_live_enabled, true\)/.test(body),
      "Section 20 — the pre-existing eligibility terms (locked status, auto_live_enabled) are untouched");
  }
  assert(!/comment on function public\.auto_go_live\(\) is/.test(nonCommentSql.slice(nonCommentSql.indexOf('SECTION 20'))),
    'Section 20 — no `comment on function` statement is re-run for auto_go_live() (COMMENT ON persists independently of create or replace function)');

  // ── Sections 21-23 — the three RLS-bypassing RPCs security-reviewer F1 found missing ──
  {
    const m = /^create or replace function public\.chat_append_system\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'Section 21 — chat_append_system() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    assert(/NEW \(T-35, security-reviewer F1\)/.test(body), 'Section 21 — the NEW (T-35, security-reviewer F1) marker is present');
    // Bounded to the non-platform branch specifically — the check must sit AFTER the
    // is_member() gate and BEFORE the platform branch's own `if v_is_platform then` closes,
    // never inside the `if v_is_platform then ... v_me := null; ...` half.
    const nonPlatformBranch = (/else\s*\n\s*if auth\.uid\(\) is null[\s\S]*?end if;\s*\n\s*v_me := public\.my_member_id\(p_league\);\s*\n\s*end if;/.exec(body) || [''])[0];
    assert(nonPlatformBranch.length > 0, 'Section 21 — fixture check: the non-platform (else) branch was isolated');
    assert(nonPlatformBranch.includes("if not public.league_active(p_league) then raise exception 'league_paused'; end if;"),
      'Section 21 — the league_active() check is inside the non-platform (member) branch specifically');
    const platformBranch = (/if v_is_platform then[\s\S]*?else/.exec(body) || [''])[0];
    assert(!platformBranch.includes('league_active'),
      'Section 21 — the platform/system branch (v_is_platform true) does NOT gain the check — cron/service-role posts for an unpaused league are unaffected');
    assert(/reserved_meta2/.test(body) && /pin_wk_/.test(body) && /sys_scribe_changelog_/.test(body),
      'Section 21 — reproduced from the REAL, LATEST (0025) body — later reservations (reserved_meta2, pin_wk_, sys_scribe_changelog_) are present, proving this is not a stale 0010/0013/0019 copy');
  }
  {
    const m = /^create or replace function public\.finalize_week\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'Section 22 — finalize_week() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    const gateIdx = body.search(/if not public\.is_commissioner\(p_league\) then raise exception 'not_commissioner'; end if;/);
    const checkIdx = body.search(/if not public\.league_active\(p_league\) then raise exception 'league_paused'; end if;/);
    const selectIdx = body.search(/select status into v_status from public\.weeks where league_id = p_league and id = p_week for update;/);
    assert(gateIdx >= 0 && checkIdx >= 0 && selectIdx >= 0 && gateIdx < checkIdx && checkIdx < selectIdx,
      'Section 22 — the league_active() check sits immediately after the is_commissioner() gate and before any read/write');
  }
  {
    const m = /^create or replace function public\.send_test_push\([\s\S]*?\$\$([\s\S]*?)\$\$;/m.exec(draftSql);
    assert(!!m, 'Section 23 — send_test_push() found in the SQL draft (fixture check)');
    const body = m ? m[1] : '';
    const gateIdx = body.search(/if not public\.is_commissioner\(p_league\) then raise exception 'not_commissioner'; end if;/);
    const checkIdx = body.search(/if not public\.league_active\(p_league\) then raise exception 'league_paused'; end if;/);
    const meIdx = body.search(/v_me := public\.my_member_id\(p_league\);/);
    assert(gateIdx >= 0 && checkIdx >= 0 && meIdx >= 0 && gateIdx < checkIdx && checkIdx < meIdx,
      'Section 23 — the league_active() check sits immediately after the is_commissioner() gate and before any read/write');
  }
  assert(/SECTION 24 — create_league\(\)'s league_kv insert/.test(draftSql) && /a league that has no\s*\n-- id yet/.test(draftSql),
    'Section 24 — the create_league() league_kv exception is documented explicitly, not a silent omission');
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 13. T-35 SECURITY-REVIEWER F1 (fix round 1, CRITICAL) — DERIVED SCAN: every SECURITY
//     DEFINER function reachable by `authenticated`/`PUBLIC` (by an explicit grant, OR by
//     carrying no revoke at all — Postgres's own default) that writes (INSERT/UPDATE/DELETE)
//     to one of section 19's nine tables MUST contain `league_active(` in its body. This is
//     the THIRD class of RLS-bypassing writer sections 19/20 missed: a client-callable RPC,
//     neither a policy (section 19) nor a cron/service-role job (section 20). Deny-by-default:
//     a function meeting the two structural criteria without the call is an offender UNLESS
//     explicitly named on the narrow, documented exception list below.
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── SQL corpus: derived SECURITY DEFINER write-path scan (security-reviewer F1) ──');
{
  const NINE_TABLES = ['picks', 'tiebreaker_guesses', 'extra_point_guesses', 'games', 'weeks',
    'messages', 'reactions', 'game_requests', 'league_kv'];
  const migDir2 = join(__dirname, 'supabase', 'migrations');
  const migFiles2 = (await readdir(migDir2)).filter((f) => f.endsWith('.sql')).sort();
  assert(migFiles2.length >= 20, `fixture check — supabase/migrations really has migration files (found ${migFiles2.length})`);
  // RE-POINTED 2026-09-25 — B_roles_pilot.sql was merged into supabase/migrations/0026_b_roles_
  // pilot.sql, so migFiles2 above ALREADY includes it (readdir + .sort() on the numeric
  // filenames puts 0026 immediately after 0025, the same relative position the draft used to be
  // appended at by hand). Reading and appending the draft separately here, as this block used to,
  // would now DOUBLE-COUNT every function 0026 redefines against itself — the exact hazard this
  // corpus's own "last-wins" comment below warns about, just self-inflicted instead of
  // cross-file. Concatenated in numeric filename order ONLY: "last-wins" over this whole string
  // means 0026's own redefinitions (chat_append_system, finalize_week, send_test_push, and the
  // new create_league/join_league bodies) correctly supersede their earlier-migration ancestors,
  // the same principle static.check.mjs's own MIGRATIONS array uses.
  const corpusParts = [];
  for (const f of migFiles2) corpusParts.push(await readFile(join(migDir2, f), 'utf8'));
  const corpus = corpusParts.join('\n');

  // ── Every function NAME defined anywhere, deduped. ──
  const allNames = new Set();
  {
    const nameRe = /^create or replace function public\.(\w+)\(/gm;
    let nm;
    while ((nm = nameRe.exec(corpus))) allNames.add(nm[1]);
  }
  assert(allNames.size >= 30, `fixture check — the name scan found a plausible number of distinct functions (found ${allNames.size})`);

  // ── For each name, the LAST definition in the corpus (last-wins). Returns { full, body } —
  //    `full` is the WHOLE match (signature + language/security line + body), needed because
  //    `security definer` sits in the HEADER, BEFORE the opening `$$`, and is therefore NOT
  //    inside the captured body group. A check that tested the body alone for `security
  //    definer` would silently find NOTHING for every real function (bug found while writing
  //    this scan: it under-reported finalize_week/send_test_push/create_league as
  //    non-DEFINER, which would have made this whole rule pass vacuously against exactly the
  //    functions security-reviewer F1 named).
  function lastDefOf(name) {
    const re = new RegExp(`^create or replace function public\\.${name}\\([^\\)]*\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, 'gm');
    let m; let last = null;
    while ((m = re.exec(corpus))) last = { full: m[0], body: m[1] };
    return last;
  }

  // ── Reachability: an explicit grant to authenticated/public mentioning this function
  //    ANYWHERE (this codebase's own convention never revokes `authenticated` once granted —
  //    every revoke statement here targets `public, anon` only, confirmed by grep across the
  //    whole corpus), OR no revoke statement mentions this function at all (Postgres's own
  //    default: EXECUTE is granted to PUBLIC unless revoked).
  // STRIP FROM `--` TO END OF LINE, not merely whole comment lines (security-reviewer N2,
  // 2026-09-25). The previous helper dropped a line only when it STARTED with `--`, so a TRAILING
  // comment survived intact and could satisfy either half of this scan by itself:
  //   insert into public.picks ...;  -- league_active( is checked by the caller
  // would have read as a compliant function. The two fixtures at the bottom of this block prove
  // both halves now fail closed.
  //
  // `--` INSIDE A STRING LITERAL: grepped the whole corpus before writing this — there is exactly
  // ONE line where a `--` follows an odd number of single quotes, `comment on function
  // public.trainer_advance_cursor(...)`'s prose ("...already moved it -- the caller treats..."),
  // which is a COMMENT ON statement, not a function body, and contains no write and no
  // `league_active(`. Truncating it can only REMOVE text, and removing text from this scan can
  // only move a function from compliant to offender — loud, never silent. So the simple rule is
  // safe here and stays readable; a quote-aware lexer would be more machinery than the one known
  // case justifies.
  const stripComments = (s) => s.split('\n').map((l) => {
    const i = l.indexOf('--');
    return i === -1 ? l : l.slice(0, i);
  }).join('\n');

  // REACHABILITY RUNS OVER THE STRIPPED CORPUS (security-reviewer N1, 2026-09-25). The two
  // matchers below are NOT line-anchored (unlike the `^create or replace function` name scan,
  // which is, and is therefore already immune), so before this they matched grant/revoke
  // statements sitting inside comments. A real example is in the tree: `0010_step5_chat.sql:771`
  // carries a commented-out `--   revoke all on function public.chat_append(uuid, jsonb) from
  // public, anon;` as paste-back instructions. A function whose only revoke is commented out was
  // read as UNREACHABLE and silently dropped from the scan entirely — a FAIL-OPEN, the one
  // direction this deny-by-default rule must never fail in.
  const strippedCorpus = stripComments(corpus);
  const grantStmts = [...strippedCorpus.matchAll(/grant execute on function\s+([\s\S]*?)\s+to\s+([^;]+);/g)];
  const revokeStmts = [...strippedCorpus.matchAll(/revoke all on function\s+([\s\S]*?)\s+from\s+([^;]+);/g)];
  function isReachable(name) {
    const fnToken = `public.${name}(`;
    const granted = grantStmts.some((m) => m[1].includes(fnToken)
      && /\b(authenticated|public)\b/i.test(m[2]));
    if (granted) return true;
    const everRevoked = revokeStmts.some((m) => m[1].includes(fnToken));
    return !everRevoked;
  }

  // THE SCHEMA QUALIFIER IS OPTIONAL (reviewer round-2, note 2 — 2026-09-25). `search_path` is
  // pinned to `public, extensions, pg_temp` on every one of these definer functions, so a bare
  // `insert into picks` resolves to `public.picks` and writes the same rows a qualified one does.
  // Requiring `public.` meant an unqualified write was invisible to this scan — the same
  // fail-open shape as N1, reached by a different spelling. The trailing `\b` is load-bearing and
  // is kept: the corpus really does contain `picks_insert`, `games_update`, `messages_head` and
  // friends, and `picks\b` must not match `picks_history`. Fixture at the bottom proves both.
  const WRITE_RE = new RegExp(
    `\\b(?:insert into|update|delete from)\\s+(?:public\\.)?(${NINE_TABLES.join('|')})\\b`, 'i');

  // NAMED EXCEPTION, per Section 24's own header comment: create_league inserts into league_kv
  // for the league it JUST created in the same transaction — that row cannot have been paused
  // by anyone before it existed. No other function is exempted silently.
  const NAMED_EXCEPTIONS = {
    create_league: 'inserts league_kv rows for a league created in the SAME transaction — cannot pre-exist paused (Section 24)',
  };

  const scanned13 = [];
  const offenders13 = [];
  for (const name of allNames) {
    const def = lastDefOf(name);
    if (!def) continue;
    if (!/security\s+definer/i.test(def.full)) continue;
    if (!isReachable(name)) continue;
    const clean = stripComments(def.body);
    if (!WRITE_RE.test(clean)) continue;
    scanned13.push(name);
    if (Object.prototype.hasOwnProperty.call(NAMED_EXCEPTIONS, name)) continue;
    if (!/league_active\(/.test(clean)) offenders13.push(name);
  }
  assert(scanned13.length >= 4,
    `fixture check — the derived scan found DEFINER+reachable+nine-table-writing functions to check (found ${scanned13.length}: ${JSON.stringify(scanned13)})`);
  assert(scanned13.includes('chat_append_system') && scanned13.includes('finalize_week')
    && scanned13.includes('send_test_push') && scanned13.includes('create_league'),
    `fixture check — the scan specifically found the three security-reviewer F1 functions AND create_league (the named exception) — proves the scan is exercising its exception list, not merely finding zero candidates (got ${JSON.stringify(scanned13)})`);
  assert(offenders13.length === 0,
    'F1 — every SECURITY DEFINER function reachable by authenticated/PUBLIC that writes to one of the nine section-19 tables contains league_active(), except the named, documented exceptions',
    JSON.stringify(offenders13));

  // ════════════════════════════════════════════════════════════════════════════════════════
  // TEETH — FOUR positive-control fixtures. Each one runs THE SAME machinery the real scan
  // above runs (one helper, below), against a synthetic corpus that must be reported. A
  // deny-by-default rule nobody has watched fail is not known to be a rule at all.
  //
  // `scanCorpus()` is deliberately a re-implementation of NOTHING: it closes over the very
  // `stripComments`, `WRITE_RE` and `NAMED_EXCEPTIONS` the live scan uses, so a future edit that
  // loosens any of the three loosens these fixtures too and they stop passing. The previous
  // version of this block copied the grant/revoke/def machinery inline, which meant the fixture
  // could keep passing against its own private copy while the real scan drifted.
  // ════════════════════════════════════════════════════════════════════════════════════════
  function scanCorpus(text) {
    const stripped = stripComments(text);
    const grants = [...stripped.matchAll(/grant execute on function\s+([\s\S]*?)\s+to\s+([^;]+);/g)];
    const revokes = [...stripped.matchAll(/revoke all on function\s+([\s\S]*?)\s+from\s+([^;]+);/g)];
    const reachable = (name) => {
      const fnToken = `public.${name}(`;
      if (grants.some((m) => m[1].includes(fnToken) && /\b(authenticated|public)\b/i.test(m[2]))) return true;
      return !revokes.some((m) => m[1].includes(fnToken));
    };
    const names = [];
    const nameRe = /^create or replace function public\.(\w+)\(/gm;
    let nm;
    while ((nm = nameRe.exec(text))) names.push(nm[1]);
    const defOf = (name) => {
      const re = new RegExp(`^create or replace function public\\.${name}\\([^\\)]*\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`, 'gm');
      let m2; let last = null;
      while ((m2 = re.exec(text))) last = { full: m2[0], body: m2[1] };
      return last;
    };
    const scanned = []; const offenders = [];
    for (const name of names) {
      const def = defOf(name);
      if (!def || !/security\s+definer/i.test(def.full) || !reachable(name)) continue;
      const clean = stripComments(def.body);
      if (!WRITE_RE.test(clean)) continue;
      scanned.push(name);
      if (Object.prototype.hasOwnProperty.call(NAMED_EXCEPTIONS, name)) continue;
      if (!/league_active\(/.test(clean)) offenders.push(name);
    }
    return { scanned, offenders };
  }

  // Body shared by fixtures 1-3; only the grant/revoke tail and the write line change.
  const poisonedTail = `
revoke all on function public.poisoned_rpc(uuid) from public, anon;
grant execute on function public.poisoned_rpc(uuid) to authenticated;
`;
  const poisonedFn = (writeLine) => `
create or replace function public.poisoned_rpc(p_league uuid) returns void
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
begin
  if not public.is_commissioner(p_league) then raise exception 'not_commissioner'; end if;
  ${writeLine}
end $$;`;

  // ── 1. The original: a QUALIFIED write with no league_active() at all. ──
  {
    const { offenders } = scanCorpus(
      `${poisonedFn("insert into public.picks (league_id, week_id, game_id, member_id, selection) values (p_league, 'w', 'g', 'm', 'home');")}${poisonedTail}`);
    assert(offenders.length === 1 && offenders[0] === 'poisoned_rpc',
      'F1 teeth 1/4 — the derived scan DOES flag a synthetic DEFINER RPC, granted to authenticated, that writes public.picks without league_active()',
      JSON.stringify(offenders));
  }

  // ── 2. UNQUALIFIED write (reviewer round-2, note 2). `search_path` is pinned to `public,…`,
  //    so `insert into picks` writes the very same rows. Before the `(?:public\.)?` change this
  //    function was not even SCANNED — WRITE_RE never matched it, so it slipped past the rule
  //    entirely rather than being flagged. ──
  {
    const { scanned, offenders } = scanCorpus(
      `${poisonedFn("insert into picks (league_id, week_id, game_id, member_id, selection) values (p_league, 'w', 'g', 'm', 'home');")}${poisonedTail}`);
    assert(scanned.includes('poisoned_rpc'),
      'F1 teeth 2/4 — an UNQUALIFIED `insert into picks` is SEEN by the scan at all (the schema qualifier is optional under a pinned search_path)',
      JSON.stringify(scanned));
    assert(offenders.length === 1 && offenders[0] === 'poisoned_rpc',
      'F1 teeth 2/4 — …and is FLAGGED for lacking league_active()',
      JSON.stringify(offenders));
  }

  // ── 3. `league_active(` present ONLY in a TRAILING COMMENT (security-reviewer N2). The old
  //    stripComments dropped whole comment LINES only, so this text survived into `clean` and
  //    satisfied the compliance check without a single line of enforcement running. ──
  {
    const { scanned, offenders } = scanCorpus(
      `${poisonedFn("insert into public.picks (league_id, week_id, game_id, member_id, selection) values (p_league, 'w', 'g', 'm', 'home');  -- league_active( is handled by the caller")}${poisonedTail}`);
    assert(scanned.includes('poisoned_rpc'),
      'F1 teeth 3/4 — a function whose only `league_active(` is in a trailing comment is still scanned',
      JSON.stringify(scanned));
    assert(offenders.length === 1 && offenders[0] === 'poisoned_rpc',
      'F1 teeth 3/4 — …and is FLAGGED: a trailing comment is stripped, so commented-out enforcement no longer reads as enforcement',
      JSON.stringify(offenders));
  }

  // ── 4. NO grant and NO revoke at all (security-reviewer N3) — Postgres's own default is
  //    EXECUTE granted to PUBLIC, so this function is reachable by every authenticated caller
  //    precisely BECAUSE nobody wrote a line about it. That is `isReachable()`'s second branch
  //    (`return !everRevoked`), and until now no fixture exercised it: the branch that fires on
  //    an AUTHOR'S OMISSION was itself unwatched. Same body as fixture 1, tail deleted. ──
  {
    const { scanned, offenders } = scanCorpus(
      poisonedFn("insert into public.picks (league_id, week_id, game_id, member_id, selection) values (p_league, 'w', 'g', 'm', 'home');"));
    assert(scanned.includes('poisoned_rpc'),
      'F1 teeth 4/4 — a DEFINER function with NO grant and NO revoke is treated as reachable (Postgres grants EXECUTE to PUBLIC by default), so it is scanned',
      JSON.stringify(scanned));
    assert(offenders.length === 1 && offenders[0] === 'poisoned_rpc',
      'F1 teeth 4/4 — …and is FLAGGED — the default-PUBLIC branch has teeth, not just the explicit-grant branch',
      JSON.stringify(offenders));
  }

  // ── NON-VACUITY, both directions. A rule that flags everything is not a rule either. ──
  {
    const { scanned, offenders } = scanCorpus(
      `${poisonedFn("if not public.league_active(p_league) then raise exception 'league_paused'; end if;\n  insert into public.picks (league_id, week_id, game_id, member_id, selection) values (p_league, 'w', 'g', 'm', 'home');")}${poisonedTail}`);
    assert(scanned.includes('poisoned_rpc') && offenders.length === 0,
      'F1 teeth — the COMPLIANT twin (same function, real league_active() call in the body) is scanned and NOT flagged',
      JSON.stringify({ scanned, offenders }));
  }
  {
    // `picks_history` is not `picks`. The corpus really does contain `picks_insert`,
    // `games_update` and `messages_head`; the trailing \b is what keeps them out.
    const { scanned } = scanCorpus(
      `${poisonedFn("insert into picks_history (league_id) values (p_league);")}${poisonedTail}`);
    assert(scanned.length === 0,
      'F1 teeth — word boundary holds: `insert into picks_history` does NOT match the `picks` table token, so the optional-qualifier change did not turn the scan into a prefix match',
      JSON.stringify(scanned));
  }
}

// ════════════════════════════════════════════════════════════════════════════════════════
// 14. THE VERIFY SCRIPTS ARE VALID psql, AND EVERY TOP-LEVEL RPC CALL CARRIES AN IDENTITY
//     (reviewer round-3, 2026-09-25)
//
// WHY THIS EXISTS. `supabase/tests/verify/*.sql` are run by Drew, by hand, against a throwaway
// project. Nothing in this repository executes them, so for two review rounds they were the only
// artifacts here with NO automated reader at all — and both rounds found the same class of defect
// in them, by eye, one spelling apart:
//
//   round 2  `perform public.super_set_league_status(...)` at psql TOP LEVEL. `perform` is
//            PL/pgSQL-only; psql raises a syntax error, and `\set ON_ERROR_STOP on` then aborts
//            block [5] BEFORE the league is ever paused, so [5a]-[5j] and block [6] never run.
//   round 3  the fix for round 2 DELETED the `set local request.jwt.claims` line that sat under
//            `set local role authenticated;`. The call then runs with `auth.uid()` NULL, so
//            `is_super_admin()` is false, so the RPC raises `not_super_admin` — and ON_ERROR_STOP
//            aborts block [5] again, at the same statement, for a completely different reason.
//
// Both failures are INVISIBLE to every other check in this tree and both look identical from the
// outside: the script stops early and the pause is never proven. The rule below is deliberately
// textual and deliberately dumb, because that is all it needs to be — it reads what psql reads.
//
// THE `reset role;` SEMANTICS THAT MAKE (b) CONSERVATIVE. `reset role;` restores the session's
// original (superuser) role while LEAVING `request.jwt.claims` set. A call after a bare
// `reset role;` therefore runs as the superuser with stale claims still in the GUC — not what any
// of these blocks intend. So the tracker clears BOTH flags at `reset role;`, `begin;` and
// `rollback;` (a new transaction also discards every `set local`), and requires a fresh, explicit
// role+claims pair before the next call. Requiring the pair to be re-stated is the point.
// ════════════════════════════════════════════════════════════════════════════════════════
console.log('\n── verify scripts: zero top-level `perform`, and every top-level RPC call is preceded by BOTH `set local role` and `set local request.jwt.claims` (reviewer round-3) ──');
{
  // CALLS MADE DELIBERATELY AS `postgres` / WITH NO ROLE. Enumerated by `file:line` with a
  // reason, never waved through as a class. THIS LIST IS EMPTY, and that was checked rather than
  // assumed: the only `set local role postgres;` in either script is
  // `anonymize_own_account_verify.sql:155`, and the statement it covers is a
  // `delete from auth.users ...` (the BYPASSRLS teardown the file's own header documents) — a
  // DELETE, not a `select public.<rpc>(`, so it is outside rule (b) by construction rather than
  // by exemption. There is no select-as-postgres anywhere in either file. If one is ever added,
  // this object is where it has to be justified, and the assertion below fails until it is.
  const AS_POSTGRES_EXCEPTIONS = Object.freeze({});

  // The scanner, shared by the real files and by the teeth fixture so neither can drift from the
  // other. Returns everything the assertions need, including the depth-tracker's own health.
  function scanVerifySql(text) {
    const lines = text.split('\n');
    let depth = 0;
    let minDepth = 0;
    let doBlocks = 0;
    let haveRole = false;
    let haveClaims = false;
    const topLevelPerforms = [];
    const calls = [];          // every depth-0 `select public.<rpc>(`
    const unpaired = [];       // …those missing role and/or claims
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '' || t.startsWith('--')) continue;          // psql ignores these too
      if (depth === 0 && /^do\s+\$\$/i.test(t)) { depth = 1; doBlocks++; continue; }
      if (depth > 0) { if (/^end\s+\$\$\s*;/i.test(t)) { depth = 0; if (depth < minDepth) minDepth = depth; } continue; }
      // ── depth 0 only, from here. ──
      if (/^perform\b/i.test(t)) { topLevelPerforms.push(i + 1); continue; }
      if (/^(reset\s+role\s*;|begin\s*;|rollback\s*;|commit\s*;|savepoint\s+\w+\s*;|rollback\s+to\s+savepoint\s+\w+\s*;)/i.test(t)) { haveRole = false; haveClaims = false; continue; }
      if (/^set\s+local\s+role\b/i.test(t)) { haveRole = true; continue; }
      if (/^set\s+local\s+request\.jwt\.claims\b/i.test(t)) { haveClaims = true; continue; }
      const m = /^select\s+public\.(\w+)\s*\(/i.exec(t);
      if (m) {
        const rec = { line: i + 1, rpc: m[1], haveRole, haveClaims };
        calls.push(rec);
        if (!haveRole || !haveClaims) unpaired.push(rec);
      }
    }
    return { depth, minDepth, doBlocks, topLevelPerforms, calls, unpaired };
  }

  const VERIFY_FILES = ['super_admin_verify.sql', 'anonymize_own_account_verify.sql', 'pilot_league_verify.sql',
    'paused_league_rpc_verify.sql'];
  // SECURITY F-1 (2026-09-25) — `pilot_league_verify.sql` deliberately calls ZERO RPCs: the hole
  // it proves closed is a raw PostgREST INSERT/UPDATE bypassing `scribe_memory_upsert()`'s
  // RPC-level pilot gate entirely, so using the RPC to prove it would defeat the point. Rules
  // (a) (no top-level `perform`) and the DO-block tracker health checks still apply to it in
  // full — only the "found top-level RPC calls" non-vacuity fixture below is scoped away from
  // it, since that fixture exists to catch rule (b) passing vacuously on a file that SHOULD have
  // calls to check, which is not this file's shape.
  // `paused_league_rpc_verify.sql` (2026-09-26) is on the list for a different reason: it
  // makes EIGHT RPC calls, every one inside its own `do $$ … exception when others … end $$;`
  // block so that a refusal is RECORDED rather than aborting the single editor run before the
  // results select. Zero calls are therefore at depth 0, and rule (b) cannot see them. R3(d)
  // below applies rule (b)'s role+claims requirement to those DO-embedded calls instead.
  const NO_RPC_CALLS_BY_DESIGN = new Set(['pilot_league_verify.sql', 'paused_league_rpc_verify.sql']);
  let totalCalls = 0;
  for (const fname of VERIFY_FILES) {
    const text = await readFile(join(__dirname, 'supabase', 'tests', 'verify', fname), 'utf8');
    const r = scanVerifySql(text);

    // ── Tracker health first. Every assertion below is meaningless if the DO-block tracker
    //    mis-parsed the file, and a mis-parse would make the scan pass VACUOUSLY (everything
    //    swallowed as "inside a DO block"). Three independent ways to notice.
    assert(r.depth === 0,
      `R3 fixture — ${fname}: the DO-block tracker ends at depth 0 (every \`do $$\` has its \`end $$;\`)`, `ended at depth ${r.depth}`);
    assert(r.minDepth === 0,
      `R3 fixture — ${fname}: the tracker never went negative (no stray \`end $$;\`)`, `min depth ${r.minDepth}`);
    assert(r.doBlocks >= 5,
      `R3 fixture — ${fname}: the tracker actually FOUND DO blocks (${r.doBlocks}) — a scan that found none would report "no top-level perform" about a file it never parsed`, String(r.doBlocks));

    // ── (a) zero depth-0 `perform` — the round-2 defect. ──
    assert(r.topLevelPerforms.length === 0,
      `R3(a) — ${fname}: ZERO \`perform\` at psql top level. \`perform\` is PL/pgSQL-only; at SQL level psql raises a syntax error and \`ON_ERROR_STOP\` aborts the rest of the file`, `top-level perform at line(s) ${JSON.stringify(r.topLevelPerforms)}`);

    // ── (b) every depth-0 RPC call carries BOTH role and claims — the round-3 defect. ──
    const unexplained = r.unpaired.filter((c) => !Object.prototype.hasOwnProperty.call(AS_POSTGRES_EXCEPTIONS, `${fname}:${c.line}`));
    assert(unexplained.length === 0,
      `R3(b) — ${fname}: every top-level \`select public.<rpc>(\` is preceded, since the last \`reset role;\`/\`begin;\`/\`rollback;\`, by BOTH \`set local role\` AND \`set local request.jwt.claims\`. Role without claims means \`auth.uid()\` is NULL, so an is_super_admin()/is_commissioner() gate refuses and the block aborts — the same visible symptom as a syntax error, from the opposite cause`, JSON.stringify(unexplained));

    if (NO_RPC_CALLS_BY_DESIGN.has(fname)) {
      assert(r.calls.length === 0,
        `R3 fixture — ${fname}: on the NO_RPC_CALLS_BY_DESIGN list, and the scan confirms zero top-level RPC calls (found ${r.calls.length}) — if this ever gains an RPC call, reconsider whether it still belongs on that list`, JSON.stringify(r.calls));
    } else {
      assert(r.calls.length >= 2,
        `R3 fixture — ${fname}: the scan FOUND top-level RPC calls to check (${r.calls.length}); zero would make (b) vacuous`, JSON.stringify(r.calls));
    }
    totalCalls += r.calls.length;
  }

  // Every enumerated exception must correspond to a real unpaired call, or it is pre-approving a
  // line nobody wrote yet — the same dead-entry rule §13's allow-lists carry.
  assert(Object.keys(AS_POSTGRES_EXCEPTIONS).length === 0,
    'R3 — the as-postgres exception list is EMPTY, matching the enumeration in the comment above (the one `set local role postgres;` covers a DELETE, not an RPC select)', JSON.stringify(Object.keys(AS_POSTGRES_EXCEPTIONS)));
  assert(totalCalls === 4,
    `R3 fixture — across all four files the scan found ${totalCalls} top-level RPC calls (expected the 4 known: 2 super_set_league_status + 2 anonymize_own_account; pilot_league_verify.sql and paused_league_rpc_verify.sql contribute 0, by design)`, String(totalCalls));

  // ── (c) TEETH. Three synthetic scripts, each a real defect, run through the SAME scanner. ──
  {
    const paired = `
\\set ON_ERROR_STOP on
do $$
begin
  raise notice 'guard';
end $$;
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"c0000000-0000-0000-0000-000000000007","role":"authenticated"}';
  select public.super_set_league_status('d1', 'paused');
  reset role;
rollback;
`;
    const r = scanVerifySql(paired);
    assert(r.unpaired.length === 0 && r.calls.length === 1 && r.topLevelPerforms.length === 0,
      'R3(c) teeth 1/4 — NON-VACUITY: a correctly paired role+claims+select is NOT flagged (a rule that flags everything is not a rule)',
      JSON.stringify(r));

    // Role WITHOUT claims — the exact round-3 defect, byte for byte.
    const roleOnly = paired.replace(/^\s*set local request\.jwt\.claims.*\n/m, '');
    const r2 = scanVerifySql(roleOnly);
    assert(r2.unpaired.length === 1 && r2.unpaired[0].haveRole === true && r2.unpaired[0].haveClaims === false,
      'R3(c) teeth 2/4 — a `set local role` with NO `set local request.jwt.claims` before the call IS flagged — this is the round-3 defect reproduced exactly',
      JSON.stringify(r2.unpaired));

    // Claims set, but in a PREVIOUS transaction — `reset role;` must clear both flags.
    const staleClaims = `
begin;
  set local role authenticated;
  set local request.jwt.claims to '{"sub":"x","role":"authenticated"}';
  reset role;
  set local role authenticated;
  select public.super_set_league_status('d1', 'active');
  reset role;
rollback;
`;
    const r3 = scanVerifySql(staleClaims);
    assert(r3.unpaired.length === 1 && r3.unpaired[0].haveClaims === false,
      'R3(c) teeth 3/4 — claims set BEFORE a `reset role;` do not count for a call after it: `reset role;` restores the superuser role and the pair must be re-stated, so this IS flagged', JSON.stringify(r3.unpaired));

    // And (a) still has teeth on a synthetic corpus.
    const withPerform = paired.replace('  select public.super_set_league_status', '  perform public.super_set_league_status');
    const r4 = scanVerifySql(withPerform);
    assert(r4.topLevelPerforms.length === 1 && r4.calls.length === 0,
      'R3(c) teeth 4/4 — a top-level `perform` IS flagged, and is not miscounted as an RPC call', JSON.stringify(r4));

    // A `perform` INSIDE a DO block is correct PL/pgSQL and must NOT be flagged.
    const performInDo = `
do $$
begin
  perform public.super_set_league_status('d1', 'paused');
end $$;
`;
    const r5 = scanVerifySql(performInDo);
    assert(r5.topLevelPerforms.length === 0 && r5.doBlocks === 1 && r5.depth === 0,
      'R3(c) teeth — NON-VACUITY the other way: a `perform` INSIDE a `do $$ … end $$;` block is correct PL/pgSQL and is NOT flagged', JSON.stringify(r5));
  }

  // ── (d) DO-EMBEDDED RPC CALLS carry role + claims too (paused_league_rpc_verify.sql, 2026-09-26).
  //    That file puts every RPC call inside a DO block (so a refusal is recorded, not raised).
  //    Rule (b) reads depth 0 only, so the round-3 defect (role WITHOUT claims → auth.uid() NULL →
  //    every gate refuses, and the file "proves" a pause that was never exercised) would pass
  //    unseen there. Same tracker semantics as (b): `reset role;`/`begin;`/`rollback;` clear both
  //    flags; a DO block that names `public.<rpc>(` must be preceded by a fresh pair.
  function scanDoEmbeddedCalls(text) {
    const lines = text.split('\n');
    let haveRole = false, haveClaims = false, inDo = false, start = 0, body = [];
    const calls = [];
    for (let i = 0; i < lines.length; i++) {
      const t = lines[i].trim();
      if (t === '' || t.startsWith('--')) continue;
      if (!inDo && /^do\s+\$\$/i.test(t)) { inDo = true; start = i + 1; body = []; continue; }
      if (inDo) {
        if (/^end\s+\$\$\s*;/i.test(t)) {
          inDo = false;
          const rpcs = [...body.join('\n').matchAll(/\bpublic\.(\w+)\s*\(/g)].map((m) => m[1]);
          if (rpcs.length) calls.push({ line: start, rpcs, haveRole, haveClaims });
        } else body.push(t);
        continue;
      }
      if (/^(reset\s+role\s*;|begin\s*;|rollback\s*;|commit\s*;|savepoint\s+\w+\s*;|rollback\s+to\s+savepoint\s+\w+\s*;)/i.test(t)) { haveRole = false; haveClaims = false; continue; }
      if (/^set\s+local\s+role\b/i.test(t)) { haveRole = true; continue; }
      if (/^set\s+local\s+request\.jwt\.claims\b/i.test(t)) { haveClaims = true; continue; }
    }
    return calls;
  }
  {
    const text = await readFile(join(__dirname, 'supabase', 'tests', 'verify', 'paused_league_rpc_verify.sql'), 'utf8');
    const calls = scanDoEmbeddedCalls(text);
    const names = calls.map((c) => c.rpcs.join('+')).join(',');
    assert(names === 'super_set_league_status,transition_week,lock_week,patch_kv,patch_kv,chat_append,super_set_league_status,lock_week',
      'R3(d) fixture — paused_league_rpc_verify.sql: the scan found the eight DO-embedded RPC calls, in order (pause, transition_week, lock_week, patch_kv ×2, chat_append, resume, lock_week)', names);
    const unpaired = calls.filter((c) => !c.haveRole || !c.haveClaims);
    assert(unpaired.length === 0,
      'R3(d) — paused_league_rpc_verify.sql: every DO block that calls a public RPC is preceded, since the last `reset role;`/`begin;`, by BOTH `set local role` AND `set local request.jwt.claims`', JSON.stringify(unpaired));
    assert(!/^\s*\\/m.test(text.replace(/^\s*--.*$/mg, '')),
      'R3(d) — paused_league_rpc_verify.sql carries NO psql meta-command (it must paste into the Supabase SQL editor as one run)');
    assert(/^select \* from pg_temp\.verify_results order by 1;\s*\n\s*rollback;\s*$/m.test(text) && !/\bcommit\s*;/i.test(text.replace(/^\s*--.*$/mg, '')),
      'R3(d) — paused_league_rpc_verify.sql ends with the results select immediately followed by `rollback;`, and contains no COMMIT');
    // Teeth: the round-3 defect, inside a DO block, is flagged.
    const roleOnly = "begin;\n  set local role authenticated;\n  do $$\n  begin\n    perform public.lock_week('d1'::uuid, 'w');\n  end $$;\nrollback;\n";
    const t = scanDoEmbeddedCalls(roleOnly);
    assert(t.length === 1 && t[0].haveRole === true && t[0].haveClaims === false,
      'R3(d) teeth — a DO-embedded RPC call after `set local role` with NO claims IS flagged', JSON.stringify(t));
  }

  // ── (e) FIXTURE ↔ SCHEMA AND SINGLE-RUN SHAPE, all verify files (2026-09-26 rehearsal audit).
  //    The first cfbp-test rehearsal found these scripts could not pass their own SETUP: a weeks
  //    insert without the NOT NULL `season`, join codes outside the CHECK `^[A-Z2-9]{8}$`, a second
  //    is_super row against the partial unique index, `picks.selection`/`game_requests.body` (no
  //    such columns — the probes "passed" on 42703), `messages.seq` (outside the 0018 column
  //    grant — "passed" on permission denied), no seq-counter row (the BEFORE trigger refused
  //    first), psql meta-commands the SQL editor sends to Postgres as SQL, and per-block
  //    begin/rollback that undid the line-1 `set` after block 1. Every rule below reads text the
  //    way the server would, against the schema DERIVED FROM THE MIGRATIONS, not a copied list.
  const stripSqlComments = (t) => t.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
  function splitTopLevel(body) {
    const parts = []; let depth = 0, cur = '';
    for (const ch of body) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
    }
    if (cur.trim()) parts.push(cur);
    return parts.map((x) => x.trim()).filter(Boolean);
  }
  async function schemaFromMigrations() {
    const dir = join(__dirname, 'supabase', 'migrations');
    const files = (await readdir(dir)).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
    const tables = new Map();
    const colInfo = (def) => ({ required: /\b(not null|primary key)\b/i.test(def) && !/\b(default|generated|serial|bigserial)\b/i.test(def) });
    for (const f of files) {
      const code = stripSqlComments(await readFile(join(dir, f), 'utf8'));
      for (const raw of code.split(';')) {
        const stmt = raw.trim();
        const ct = /^create table (if not exists )?public\.(\w+)\s*\(([\s\S]*)\)\s*$/i.exec(stmt);
        if (ct) {
          if (tables.has(ct[2])) continue;
          const cols = new Map();
          for (const item of splitTopLevel(ct[3])) {
            if (/^(primary key|foreign key|unique|check|constraint|exclude)\b/i.test(item)) continue;
            const m = /^(\w+)\s+([\s\S]*)$/.exec(item);
            if (m) cols.set(m[1], colInfo(m[2]));
          }
          tables.set(ct[2], cols);
          continue;
        }
        const at = /^alter table (?:only )?(?:if exists )?public\.(\w+)\s+([\s\S]*)$/i.exec(stmt);
        if (at && tables.has(at[1])) {
          const cols = tables.get(at[1]);
          for (const action of splitTopLevel(at[2])) {
            let m;
            if ((m = /^add column (?:if not exists )?(\w+)\s+([\s\S]*)$/i.exec(action))) cols.set(m[1], colInfo(m[2]));
            else if ((m = /^alter column (\w+)\s+(drop not null|set default\b)/i.exec(action)) && cols.has(m[1])) cols.get(m[1]).required = false;
            else if ((m = /^drop column (?:if exists )?(\w+)/i.exec(action))) cols.delete(m[1]);
          }
        }
      }
    }
    return tables;
  }
  // Columns a BEFORE INSERT trigger fills, so a verify insert must NOT name them (and need not).
  const TRIGGER_FILLED = new Set(['messages.seq']);
  function insertFindings(text, schema) {
    const code = stripSqlComments(text);
    const out = []; let scanned = 0;
    for (const m of code.matchAll(/insert into public\.(\w+)\s*\(([^)]*)\)/gi)) {
      scanned++;
      const table = m[1]; const cols = m[2].split(',').map((c) => c.trim()).filter(Boolean);
      const t = schema.get(table);
      if (!t) { out.push(`${table}: no such table in the migrations`); continue; }
      for (const c of cols) if (!t.has(c)) out.push(`${table}.${c}: no such column`);
      for (const c of cols) if (TRIGGER_FILLED.has(`${table}.${c}`)) out.push(`${table}.${c}: trigger-filled, must not be named`);
      for (const [c, info] of t) if (info.required && !cols.includes(c) && !TRIGGER_FILLED.has(`${table}.${c}`)) out.push(`${table}: required column ${c} not supplied`);
    }
    return { out, scanned };
  }
  function joinCodeFindings(text) {
    const code = stripSqlComments(text);
    const out = []; let codes = 0;
    for (const m of code.matchAll(/insert into public\.leagues\b[^;]*;/gi)) {
      const lits = [...m[0].matchAll(/'([A-Z0-9]{8})'/g)].map((x) => x[1]);
      if (lits.length === 0) out.push(`no 8-char join code literal in: ${m[0].slice(0, 80)}`);
      for (const l of lits) { codes++; if (!/^[A-Z2-9]{8}$/.test(l)) out.push(`join code '${l}' violates ^[A-Z2-9]{8}$`); }
    }
    return { out, codes };
  }
  function superDemoteFindings(text) {
    const code = stripSqlComments(text);
    const blocks = code.split(/^\s*savepoint\s+\w+\s*;\s*$/mi);
    const out = []; let supers = 0;
    for (const b of blocks) {
      for (const m of b.matchAll(/insert into public\.platform_admins\b[^;]*;/gi)) {
        if (!/\btrue\b/i.test(m[0])) continue;
        supers++;
        const demote = b.search(/update public\.platform_admins set is_super = false where is_super\s*;/i);
        if (demote < 0 || demote > m.index) out.push(`is_super insert without a prior in-block demote: ${m[0].replace(/\s+/g, ' ').slice(0, 100)}`);
      }
    }
    return { out, supers };
  }
  function shapeFindings(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('--'));
    const out = [];
    if (lines.some((l) => l.startsWith('\\'))) out.push('psql meta-command line present');
    if (lines[0] !== 'begin;') out.push(`first statement is not begin; (got ${JSON.stringify(lines[0])})`);
    if (lines[lines.length - 1] !== 'rollback;') out.push(`last statement is not rollback; (got ${JSON.stringify(lines[lines.length - 1])})`);
    if (lines.filter((l) => /^begin\s*;$/i.test(l)).length !== 1) out.push('not exactly one begin;');
    if (lines.filter((l) => /^rollback\s*;$/i.test(l)).length !== 1) out.push('not exactly one bare rollback;');
    if (lines.some((l) => /^commit\b/i.test(l))) out.push('contains COMMIT');
    const guardEnd = lines.findIndex((l, i) => i > 1 && /^end\s+\$\$\s*;/i.test(l));
    const guard = /^do\s+\$\$/i.test(lines[1] || '') && guardEnd > 1 ? lines.slice(1, guardEnd + 1).join('\n') : '';
    if (!/current_setting\('cfbp\.allow_destructive', true\) is distinct from '1'/.test(guard)) out.push('second statement is not the guard DO with the cfbp.allow_destructive check');
    if (!/if exists \(select 1 from public\.leagues where name ilike '%IRB%'\) then/.test(guard)) out.push('guard lacks the live-project identity check (a league named like %IRB%)');
    // AMENDED 2026-09-26: a league-COUNT clause refuses cfbp-test itself (it holds several fixture
    // leagues from earlier RLS runs). The live-project check is identity only.
    if (/count\(\*\)\s*from public\.leagues/i.test(guard)) out.push('guard carries a league-count clause, which refuses cfbp-test itself');
    let open = null;
    for (const l of lines) {
      let m;
      if ((m = /^savepoint\s+(\w+)\s*;$/i.exec(l))) { if (open) out.push(`savepoint ${m[1]} opened while ${open} still open`); open = m[1]; }
      else if ((m = /^rollback\s+to\s+savepoint\s+(\w+)\s*;$/i.exec(l))) { if (open !== m[1]) out.push(`rollback to ${m[1]} does not close ${open}`); open = null; }
    }
    if (open) out.push(`savepoint ${open} never rolled back`);
    const code = stripSqlComments(text);
    if ((/insert into public\.messages\b/i.test(code) || /public\.chat_append\s*\(/i.test(code)) && !/insert into public\.league_seq_counters\b/i.test(code))
      out.push('writes messages but seeds no league_seq_counters row (messages_assign_seq raises no_seq_counter first)');
    return out;
  }
  {
    const schema = await schemaFromMigrations();
    const w = schema.get('weeks'), pk = schema.get('picks'), lg = schema.get('leagues');
    assert(schema.size >= 25 && w?.get('season')?.required === true && pk?.has('selected_team') && !pk?.has('selection')
      && lg?.get('created_by')?.required === false && lg?.get('join_code')?.required === true && schema.get('messages')?.get('seq')?.required === true,
      `R3(e) fixture — the schema derived from the migrations is plausible (${schema.size} tables; weeks.season required; picks.selected_team exists and picks.selection does not; leagues.created_by optional after 0029's drop not null; messages.seq required)`);
    let totalInserts = 0, totalCodes = 0, totalSupers = 0;
    for (const fname of VERIFY_FILES) {
      const text = await readFile(join(__dirname, 'supabase', 'tests', 'verify', fname), 'utf8');
      const ins = insertFindings(text, schema); totalInserts += ins.scanned;
      assert(ins.out.length === 0, `R3(e) — ${fname}: every \`insert into public.<t> (cols)\` names only real columns, supplies every NOT NULL column without a default, and names no trigger-filled column (${ins.scanned} inserts)`, JSON.stringify(ins.out));
      const jc = joinCodeFindings(text); totalCodes += jc.codes;
      assert(jc.out.length === 0, `R3(e) — ${fname}: every leagues fixture join code matches the CHECK ^[A-Z2-9]{8}$`, JSON.stringify(jc.out));
      const sd = superDemoteFindings(text); totalSupers += sd.supers;
      assert(sd.out.length === 0, `R3(e) — ${fname}: every is_super=true fixture is preceded, in its own block, by the demote of any existing super row (platform_admins_is_super_uidx, 23505)`, JSON.stringify(sd.out));
      const sh = shapeFindings(text);
      assert(sh.length === 0, `R3(e) — ${fname}: ONE editor run — begin; first, the guard DO second (opt-in flag AND the IRB-name live-project check, no league count), balanced savepoints, one closing rollback;, no COMMIT, no psql meta-command, and a seq-counter row wherever messages are written`, JSON.stringify(sh));
    }
    assert(totalInserts >= 40 && totalCodes >= 9 && totalSupers >= 5,
      `R3(e) fixture — the scans found work to check across the ${VERIFY_FILES.length} files (${totalInserts} inserts, ${totalCodes} join codes, ${totalSupers} is_super fixtures)`, `${totalInserts}/${totalCodes}/${totalSupers}`);

    // Teeth — each 2026-09-26 rehearsal defect, reproduced, is flagged by the same scanners.
    const good = `begin;
do $$
begin
  if current_setting('cfbp.allow_destructive', true) is distinct from '1' then raise exception 'x'; end if;
  if exists (select 1 from public.leagues where name ilike '%IRB%') then raise exception 'y'; end if;
end $$;
savepoint v1;
  update public.platform_admins set is_super = false where is_super;
  insert into public.platform_admins (user_id, is_super, added_by) values ('u', true, null);
  insert into public.leagues (id, name, join_code, created_by) values ('l', 'n', 'VERIFYTA', 'u');
  insert into public.weeks (id, league_id, season, week_number, status) values ('w', 'l', '2026', 1, 'open');
  insert into public.league_seq_counters (league_id, next_seq) values ('l', 1);
  insert into public.messages (league_id, id, author, author_kind, author_member_id, type, body) values ('l','m','p','player','p','message','x');
rollback to savepoint v1;
select 'ok' as result;
rollback;
`;
    assert(insertFindings(good, schema).out.length === 0 && joinCodeFindings(good).out.length === 0
      && superDemoteFindings(good).out.length === 0 && shapeFindings(good).length === 0,
      'R3(e) teeth — NON-VACUITY: a correct single-run fixture is flagged by none of the scanners',
      JSON.stringify([insertFindings(good, schema).out, joinCodeFindings(good).out, superDemoteFindings(good).out, shapeFindings(good)]));
    const bad = (name, mutated, scan) => assert(scan(mutated).length > 0, `R3(e) teeth — ${name} IS flagged`, JSON.stringify(scan(mutated)));
    const ins = (t) => insertFindings(t, schema).out;
    bad('a weeks insert without season (23502)', good.replace("(id, league_id, season, week_number, status) values ('w', 'l', '2026', 1, 'open')", "(id, league_id, week_number, status) values ('w', 'l', 1, 'open')"), ins);
    bad('a picks insert naming `selection` (42703)', good + "insert into public.picks (league_id, id, week_id, game_id, member_id, selection) values ('l','k','w','g','p','home');\n", ins);
    bad('a messages insert naming seq (outside the 0018 column grant)', good.replace('(league_id, id, author,', '(league_id, id, seq, author,'), ins);
    bad("join code 'VERIFY01' (23514)", good.replace("'VERIFYTA'", "'VERIFY01'"), (t) => joinCodeFindings(t).out);
    bad('an is_super insert with no demote (23505)', good.replace('  update public.platform_admins set is_super = false where is_super;\n', ''), (t) => superDemoteFindings(t).out);
    bad('a psql meta-command line', '\\set ON_ERROR_STOP on\n' + good, shapeFindings);
    bad('a guard without the live-project check', good.replace(/  if exists \(select 1 from public\.leagues where name ilike[\s\S]*?raise exception 'y'; end if;\n/, ''), shapeFindings);
    bad('a guard that also counts leagues (refuses cfbp-test itself)', good.replace("  if exists (select 1 from public.leagues where name ilike '%IRB%') then", "  if (select count(*) from public.leagues) > 3\n     or exists (select 1 from public.leagues where name ilike '%IRB%') then"), shapeFindings);
    bad('per-block begin/rollback (the flag is undone after block 1)', good.replace('savepoint v1;', 'begin;').replace('rollback to savepoint v1;', 'rollback;'), shapeFindings);
    bad('messages written with no seq-counter row', good.replace("  insert into public.league_seq_counters (league_id, next_seq) values ('l', 1);\n", ''), shapeFindings);
  }

  // ── (f) Two probe-level rehearsal defects the schema scan cannot see (2026-09-26).
  {
    const sa = stripSqlComments(await readFile(join(__dirname, 'supabase', 'tests', 'verify', 'super_admin_verify.sql'), 'utf8'));
    // [5a]/[5b]/[5e] each caught ANY error as PASS; with the old column lists that meant 42703 /
    // permission denied / no_seq_counter — refusals that never reached the paused-league conjunct.
    const rlsReq = (sa.match(/sqlerrm not like 'new row violates row-level security policy%'/g) || []).length;
    assert(rlsReq === 3,
      `R3(f) — super_admin_verify.sql [5a]/[5b]/[5e] each require the refusal to be the RLS policy ("new row violates row-level security policy"), not any error (found ${rlsReq} of 3)`);
    // pilot [P-1b] proves the SILENT zero-row UPDATE shape. scribe_memory_update's USING has a
    // `subject_member_id = my_member_id(league_id)` arm, so a seed row whose subject is the
    // non-pilot commissioner himself is MATCHED and the UPDATE raises 42501 from WITH CHECK.
    const pl = stripSqlComments(await readFile(join(__dirname, 'supabase', 'tests', 'verify', 'pilot_league_verify.sql'), 'utf8'));
    const seed = /\('f0000000-0000-0000-0000-000000000001',\s*'mem_verify_np_seed',\s*([^,]+),/.exec(pl);
    assert(!!seed && seed[1].trim().toLowerCase() === 'null',
      "R3(f) — pilot_league_verify.sql: the non-pilot seed row's subject_member_id is NULL (not the non-pilot commissioner), so [P-1b] tests a row he does not own and gets the silent zero-row shape", seed ? seed[1] : 'seed tuple not found');
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
