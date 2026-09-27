/**
 * CFB Pickems — adminpaneltest.mjs (UX Revamp Group B, Build Wave 1, 2026-09-25)
 * ================================================================================
 * Standalone coverage for THIS pass's two new files (plus the one js/roles.js
 * row reviewer fix round 1 authorized):
 *   - js/comm-panel-layout.js  (DI-319 — the Commissioner panel's card→tab map)
 *   - js/admin-panel.js        (DI-320 — the new Admin panel's render functions)
 *
 * Precedent for a focused standalone suite beside loadtest.mjs: grouptest.mjs
 * (UN-118), rolestest.mjs, iconstest.mjs.
 *
 * Run:  node adminpaneltest.mjs
 *
 * NOT run here (out of this file's job): loadtest.mjs (mandatory before any
 * commit — not run this pass per the task's explicit instruction, since
 * js/app.js/index.html/css/styles.css are not wired to either new module
 * yet); rolestest.mjs (js/roles.js's own suite — run separately, see the
 * fix-round reply, because it needed its OWN update for the new
 * 'scribe-model' row's count).
 *
 * REVIEWER FIX ROUND 1 (2026-09-25) — what changed in this file:
 *   - [1k]/[3]/[8]: 'scribe-model' moved from a documented gap (absent
 *     everywhere) to a real row in js/roles.js's CARD_OPERABILITY. It shipped
 *     that round as scope: 'admin' on the COORDINATOR's fix-round instruction;
 *     REVIEWER ROUND 2 (2026-09-25) corrected it to 'commissioner' — its write
 *     path (setScribeModel -> saveSetting -> save(KEYS.SETTINGS)) is the
 *     is_commissioner-gated `league_kv` blob, and 'account-linking' is the
 *     precedent for Admin-panel placement with a commissioner write. It now
 *     lives in COMMISSIONER_ONLY_ROWS: PRESENT for a viewer who commissions
 *     this league, ABSENT for an admin who does not ([3c-absent], [8g2], [9b]).
 *   - [2k] NEW: every COMM_TABS/ADMIN_TABS icon name resolves in js/icons.js's
 *     ICONS map (group E landed the remaining four this same day).
 *   - Every `session:`/`flags:` call-site key is now `viewer:` — the whole
 *     fixture set renamed SESSION_*→VIEWER_*, and `flags.viewerUserId`/
 *     `flags.isSuperAdmin` moved onto `viewer.userId`/`viewer.isSuperAdmin`
 *     directly, matching admin-panel.js's new composed-`viewer`-bag contract
 *     (finding 1).
 *   - [9] NEW section: the raw synthesized session shape ({playerId,isAdmin,
 *     playerVerified} only) and the "naive, half-composed" shape both pinned
 *     by test; the fully composed bag asserts Drew gets all 22 cards.
 *   - [10] NEW section: isMemberOfLeague()'s legacy single-league fallback
 *     (finding 2), via renderExportDataBody directly.
 *   - [B5]→[11]: viewerUserId-required now suppresses EVERY action for
 *     EVERY row when unknown, not just the self row (finding 6).
 *
 * Covers, per the task brief:
 *   [1] Card-map completeness/uniqueness (RG-10) — COMM_CARD_TAB and
 *       ADMIN_CARD_TAB.
 *   [2] Tab bar rendering with icons — renderCommTabBar / renderAdminTabBar,
 *       plus icon-name resolution against the real ICONS map.
 *   [3] Per-viewer rendering matrix (member / commissioner-only / admin-only
 *       non-member / admin+commissioner / super admin) asserting ABSENT
 *       cards.
 *   [4] get_member_contacts is never referenced anywhere in
 *       js/admin-panel.js (scans the source file directly).
 *   [5] No `<script>` leaks — both a literal-substring scan of rendered
 *       output and a real XSS fixture (a malicious displayName) proving
 *       escHtml actually neutralizes it, not merely that no test fixture
 *       happens to contain the substring.
 *   [6] The seed-row no-remove rule (F7d) — Platform Admins card.
 *   [7] The Super Admin hook renders ONLY with viewer.isSuperAdmin === true.
 *   [8] Injected bodies render exactly once — call-counting fixture.
 *   [9] The composed `viewer` bag contract (reviewer fix round 1, finding 1).
 *   [10] isMemberOfLeague()'s legacy fallback (finding 2).
 *   [11] viewerUserId-required suppresses every action when unknown (finding 6).
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, detail ? `— ${detail}` : ''); }
}

const commLayout = await import('./js/comm-panel-layout.js');
const adminPanel = await import('./js/admin-panel.js');
const { ICONS } = await import('./js/icons.js');

const {
  COMM_TABS, COMM_CARD_TAB, commTabFor, renderCommTabBar,
} = commLayout;

const {
  ADMIN_TABS, SUPER_ADMIN_TAB, ADMIN_CARD_TAB, adminTabFor,
  renderAdminTabBar, renderAdminPanel, renderAdminAccessDeniedCard,
  renderUsersAcrossLeaguesBody, renderPlatformAdminsBody,
  renderPilotLeagueFlagBody, renderScribeCapsLimitsBody, renderExportDataBody,
  renderSuperAdminPlaceholder,
} = adminPanel;

// Same escHtml boundary the real app uses (js/app.js:19417 — not exported
// from app.js, so every consumer defines its own, per CONVENTIONS #12 and
// per admin-panel.js's own explicit `escHtml` REQUIRED parameter).
function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const iconFn = (name) => `<svg data-icon="${name}"></svg>`;

// ════════════════════════════════════════════════════════════════════════════
// [1] Card-map completeness/uniqueness (RG-10)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Card-map completeness/uniqueness (RG-10) …');
{
  assert(COMM_TABS.map((t) => t.key).join(',') === 'week,games,players,rules,scribe',
    '[1a] COMM_TABS is exactly week/games/players/rules/scribe, in DI-319 order');
  assert(ADMIN_TABS.map((t) => t.key).join(',') === 'week,games,players,settings,data',
    '[1b] ADMIN_TABS is exactly week/games/players/settings/data, in DI-320 order');
  assert(SUPER_ADMIN_TAB.key === 'super-admin', '[1c] SUPER_ADMIN_TAB key is super-admin');

  // Full DI-319 (amended) card inventory — every card id COMM_CARD_TAB must
  // carry, mapped to exactly the tab named below (ground truth transcribed
  // from the DI's card-by-card tables + the binding 2026-09-25 amendment).
  const EXPECTED_COMM_CARD_TAB = {
    'week-manager': 'week', 'commissioner-announcement': 'week', 'week-settings': 'week',
    'weekly-summary-email': 'week', 'tiebreaker': 'week', 'extra-point': 'week',
    'demo-simulation': 'admin',
    'populate-games': 'games', 'player-requests': 'games', 'available-games-pool': 'games',
    'selected-slate': 'games', 'espn-source': 'admin', 'data-proof': 'admin',
    'weekly-nicknames': 'players', 'invite-to-league': 'players', 'league-members': 'players',
    'obligations': 'players', 'players-pins-contact': 'players', 'account-linking': 'admin',
    'league-rules': 'rules', 'alma-maters': 'rules',
    'scribe-participation': 'scribe', 'scribe-heat': 'scribe', 'scribe-learning-rate': 'scribe',
    'chat-scribe': 'scribe', 'scribe-model': 'admin',
    'auto-refresh': 'admin', 'randomize-picks-shortcut': 'admin', 'security-settings': 'admin',
    'export-data': 'admin', 'data-management': 'admin', 'chat-retention': 'admin',
    'chat-history': 'admin', 'recalculate-finalized-weeks': 'admin', 'obligation-corrections': 'admin',
    'scribe-training': 'admin', 'background-jobs': 'admin', 'feedback-bug-reports': 'admin',
  };
  const actualKeys = Object.keys(COMM_CARD_TAB).sort();
  const expectedKeys = Object.keys(EXPECTED_COMM_CARD_TAB).sort();
  assert(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
    '[1d] COMM_CARD_TAB carries exactly the DI-319 (amended) card inventory, no more, no less',
    `missing=${JSON.stringify(expectedKeys.filter(k => !actualKeys.includes(k)))} extra=${JSON.stringify(actualKeys.filter(k => !expectedKeys.includes(k)))}`);
  for (const [id, tab] of Object.entries(EXPECTED_COMM_CARD_TAB)) {
    assert(COMM_CARD_TAB[id] === tab, `[1e/${id}] maps to '${tab}'`, `got '${COMM_CARD_TAB[id]}'`);
  }
  // "No card maps to two" — structurally guaranteed by object-key uniqueness,
  // but proven directly rather than merely asserted: every value is a single
  // string, never an array/multi-value.
  assert(Object.values(COMM_CARD_TAB).every((v) => typeof v === 'string'),
    '[1f] every COMM_CARD_TAB value is a single string tab key (never two)');
  // Every non-'admin' value is a real COMM_TABS key.
  const commTabKeys = new Set(COMM_TABS.map((t) => t.key));
  assert(Object.values(COMM_CARD_TAB).every((v) => v === 'admin' || commTabKeys.has(v)),
    '[1g] every COMM_CARD_TAB value is either "admin" or a real COMM_TABS key');

  assert(commTabFor('tiebreaker') === 'week', '[1h] commTabFor(existing id) resolves');
  assert(commTabFor('account-linking') === 'admin', '[1i] commTabFor(relocated id) resolves to "admin"');
  assert(commTabFor('not-a-real-card') === null, '[1j] commTabFor(unmapped id) -> null, deny-by-default');

  // ADMIN_CARD_TAB — exactly js/roles.js's CARD_OPERABILITY keys, no more,
  // no less. 'scribe-model' is no longer a "documented gap" exception —
  // CARD_OPERABILITY gained the row (scope: 'commissioner', reviewer round 2),
  // so this is now a plain equality, not an equality-plus-gap. Note this
  // assertion is about PLACEMENT keys only and is scope-independent: it would
  // read identically whichever scope that row carried.
  const { CARD_OPERABILITY } = await import('./js/roles.js');
  const rolesKeys = Object.keys(CARD_OPERABILITY).sort();
  const adminKeys = Object.keys(ADMIN_CARD_TAB).sort();
  assert(JSON.stringify(adminKeys) === JSON.stringify(rolesKeys),
    '[1k] ADMIN_CARD_TAB is EXACTLY CARD_OPERABILITY\'s keys (22, no gap remaining)',
    `admin=${JSON.stringify(adminKeys)} roles=${JSON.stringify(rolesKeys)}`);
  assert(adminKeys.length === 22, '[1k2] fixture check — the table really has 22 rows now', `${adminKeys.length}`);
  const adminTabKeys = new Set(ADMIN_TABS.map((t) => t.key));
  assert(Object.values(ADMIN_CARD_TAB).every((v) => adminTabKeys.has(v)),
    '[1l] every ADMIN_CARD_TAB value is a real ADMIN_TABS key (never super-admin, never "admin")');
  assert(adminTabFor('data-source-mode') === 'week', '[1m] adminTabFor(existing id) resolves');
  assert(adminTabFor('nope') === null, '[1n] adminTabFor(unmapped id) -> null');
}

// ════════════════════════════════════════════════════════════════════════════
// [2] Tab bar rendering with icons
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Tab bar rendering …');
{
  const commBar = renderCommTabBar({ activeTab: 'players', icon: iconFn });
  assert(commBar.includes('role="tablist"'), '[2a] comm tab bar carries role="tablist"');
  for (const t of COMM_TABS) {
    assert(commBar.includes(`data-comm-tab-btn="${t.key}"`), `[2b/${t.key}] comm tab button present`);
    assert(commBar.includes(`data-icon="${t.icon}"`), `[2c/${t.key}] comm tab icon() called with '${t.icon}'`);
  }
  assert(commBar.includes('aria-selected="true"') && commBar.match(/aria-selected="true"/g).length === 1,
    '[2d] exactly one comm tab is aria-selected="true" (the active one)');
  assert(!/🏈|📅|👥|⚙️|☁️/.test(commBar), '[2e] comm tab bar carries ZERO emoji (D-1 — chrome uses icon(), not emoji)');

  const adminBarNoSuper = renderAdminTabBar({ activeTab: 'data', icon: iconFn, viewer: {} });
  for (const t of ADMIN_TABS) {
    assert(adminBarNoSuper.includes(`data-admin-tab-btn="${t.key}"`), `[2f/${t.key}] admin tab button present`);
  }
  assert(!adminBarNoSuper.includes('data-admin-tab-btn="super-admin"'),
    '[2g] Super Admin tab ABSENT when viewer.isSuperAdmin is not set');

  const adminBarSuper = renderAdminTabBar({ activeTab: 'week', icon: iconFn, viewer: { isSuperAdmin: true } });
  assert(adminBarSuper.includes('data-admin-tab-btn="super-admin"'),
    '[2h] Super Admin tab PRESENT when viewer.isSuperAdmin === true');
  assert(!/🛡|📅|🏈|👥|⚙️|☁️/.test(adminBarSuper), '[2i] admin tab bar carries ZERO emoji');

  // icon() not supplied at all — must not throw, degrades to empty icon slot.
  let threw = false;
  try { renderCommTabBar({ activeTab: 'week' }); } catch { threw = true; }
  assert(threw === false, '[2j] renderCommTabBar with no icon fn does not throw (graceful default)');

  // [2k] NEW (reviewer fix round 1, finding 5) — every icon name this module
  // references actually resolves in the shipped ICONS map. Fails loudly if
  // a name is ever removed/renamed in js/icons.js without updating here.
  const allIconNames = [
    ...COMM_TABS.map((t) => t.icon),
    ...ADMIN_TABS.map((t) => t.icon),
    SUPER_ADMIN_TAB.icon,
  ];
  assert(allIconNames.length === 11, '[2k] fixture check — really enumerated 5 comm + 5 admin + 1 super-admin icon names', `${allIconNames.length}`);
  for (const name of allIconNames) {
    assert(Object.prototype.hasOwnProperty.call(ICONS, name),
      `[2k/${name}] resolves in js/icons.js's ICONS map`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Fixtures shared by [3], [7], [8], [9], [11]
// ════════════════════════════════════════════════════════════════════════════
const LEAGUE_NONPILOT = { id: 'L1', name: 'Test League', pilot: false };
const LEAGUE_PILOT = { id: 'L1', name: 'IRB Football', pilot: true };
const LEAGUES = [LEAGUE_NONPILOT];

const USERS = [
  { userId: 'drew', displayName: 'Drew', leagueId: 'L1', leagueName: 'Test League', role: 'commissioner', active: true, linkedAt: '2026-01-01', isPlatformAdmin: true, platformAdminAddedAt: null, platformAdminAddedBy: null },
  { userId: 'sam', displayName: 'Sam', leagueId: 'L1', leagueName: 'Test League', role: 'player', active: true, linkedAt: null },
  { userId: 'kihoon', displayName: 'Kihoon', leagueId: 'L1', leagueName: 'Test League', role: 'commissioner', active: true, linkedAt: '2026-02-02', isPlatformAdmin: true, platformAdminAddedAt: '2026-03-01', platformAdminAddedBy: 'drew' },
];

// Reviewer fix round 1, finding 1 — every fixture below is the COMPOSED
// `viewer` bag admin-panel.js's header now documents, never a bare
// `{playerId,isAdmin,playerVerified}` object (that shape is deliberately
// tested SEPARATELY in [9], because it's the wrong shape and must PROVE
// itself wrong, not be silently used as if it were right everywhere else).
const VIEWER_MEMBER = { playerId: 'p-sam', isAdmin: false, playerVerified: true, userId: 'sam', isPlatformAdmin: false, activeLeagueId: 'L1', memberships: [{ leagueId: 'L1', role: 'player', active: true }] };
const VIEWER_COMMISSIONER_ONLY = { playerId: 'p-drew', isAdmin: true, playerVerified: true, userId: 'drew', isPlatformAdmin: false, activeLeagueId: 'L1', memberships: [{ leagueId: 'L1', role: 'commissioner', active: true }] };
const VIEWER_ADMIN_ONLY_NONMEMBER = { playerId: null, isAdmin: false, playerVerified: false, userId: 'someone-else', isPlatformAdmin: true, activeLeagueId: null, memberships: [] };
const VIEWER_ADMIN_AND_COMMISSIONER = { playerId: 'p-drew', isAdmin: true, playerVerified: true, userId: 'drew', isPlatformAdmin: true, isSuperAdmin: false, activeLeagueId: 'L1', memberships: [{ leagueId: 'L1', role: 'commissioner', active: true }] };

// 'scribe-model' is a real CARD_OPERABILITY row (no longer a "documented gap"
// tested as absent everywhere) and it belongs in COMMISSIONER_ONLY_ROWS, not
// ADMIN_ONLY_ROWS: setScribeModel() -> saveSetting('scribe', …) ->
// save(KEYS.SETTINGS) writes the `league_kv` settings blob, whose RLS write
// policies are is_commissioner-gated — the same path as 'scribe-caps-limits',
// 'auto-refresh' and 'security-settings'. The 2026-09-25 amendment moved the
// card's PLACEMENT into the Admin panel, which is ADMIN_CARD_TAB's business,
// not this list's; 'account-linking' is the standing precedent for exactly
// that combination. Fix round 1 put it in ADMIN_ONLY_ROWS on the COORDINATOR's
// fix-round instruction; reviewer round 2 (2026-09-25) corrected it, which is
// what makes [3c-absent/scribe-model], [8g2] and [9b-absent/scribe-model]
// guard DI-320 §3's named fail condition (card visible, write silently
// refused) instead of pinning it green.
const ADMIN_ONLY_ROWS = ['espn-source', 'data-proof', 'users-across-leagues', 'platform-admins', 'pilot-league-flag', 'export-data', 'background-jobs', 'feedback-bug-reports'];
const COMMISSIONER_ONLY_ROWS = ['data-source-mode', 'demo-simulation', 'account-linking', 'auto-refresh', 'randomize-picks-shortcut', 'security-settings', 'scribe-caps-limits', 'data-management', 'chat-retention', 'chat-history', 'recalculate-finalized-weeks', 'obligation-corrections', 'scribe-model'];
assert(ADMIN_ONLY_ROWS.length + COMMISSIONER_ONLY_ROWS.length + 1 /* scribe-training, pilot-gated */ === Object.keys(ADMIN_CARD_TAB).length,
  '[fixture] ADMIN_ONLY_ROWS + COMMISSIONER_ONLY_ROWS + scribe-training account for all 22 ADMIN_CARD_TAB rows',
  `${ADMIN_ONLY_ROWS.length + COMMISSIONER_ONLY_ROWS.length + 1} vs ${Object.keys(ADMIN_CARD_TAB).length}`);

function cardPresent(html, cardId) {
  return html.includes(`data-admin-card="${cardId}"`);
}

// ════════════════════════════════════════════════════════════════════════════
// [3] Per-viewer rendering matrix — ABSENT cards asserted per fixture
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Per-viewer rendering matrix …');
{
  const bodies = {}; // every relocated card falls back to the honest placeholder — fine for this matrix

  // (a) member — no admin access at all.
  const outMember = renderAdminPanel({ viewer: VIEWER_MEMBER, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies });
  assert(outMember.includes('Admin access only.'), '[3a] plain member — sees the "Admin access only" denial card');
  assert(!outMember.includes('data-admin-card='), '[3a2] plain member — ZERO admin-section cards render (not even absent-with-error)');

  // (b) commissioner-only (not a platform admin) — ALSO denied, per DI-320
  // §States: the whole route is gated on isPlatformAdmin, not on
  // commissionership of any particular league.
  const outCommOnly = renderAdminPanel({ viewer: VIEWER_COMMISSIONER_ONLY, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies });
  assert(outCommOnly.includes('Admin access only.'), '[3b] commissioner-only (not platform admin) — sees the denial card');
  assert(!outCommOnly.includes('data-admin-card='), '[3b2] commissioner-only — ZERO admin-section cards render');

  // (c) admin-only, viewing a league he does not commission — ONLY the
  // admin-operable rows render; every commissioner-operable row is ABSENT,
  // scribe-model among them (its write would be refused by RLS, so DI-320
  // §States says absent, not visible-and-broken).
  const outAdminOnly = renderAdminPanel({ viewer: VIEWER_ADMIN_ONLY_NONMEMBER, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies });
  for (const id of ADMIN_ONLY_ROWS) assert(cardPresent(outAdminOnly, id), `[3c/${id}] admin-only, non-commissioned league — admin-operable card PRESENT`);
  for (const id of COMMISSIONER_ONLY_ROWS) assert(!cardPresent(outAdminOnly, id), `[3c-absent/${id}] admin-only, non-commissioned league — commissioner-operable card ABSENT`);
  assert(!cardPresent(outAdminOnly, 'scribe-training'), '[3c-absent/scribe-training] admin-only, non-commissioned league — pilot+commissioner-gated card ABSENT');

  // (d) admin+commissioner, non-pilot league (Drew's own case, minus pilot) —
  // every row EXCEPT the pilot-gated one is present.
  const outBoth = renderAdminPanel({ viewer: VIEWER_ADMIN_AND_COMMISSIONER, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies });
  for (const id of [...ADMIN_ONLY_ROWS, ...COMMISSIONER_ONLY_ROWS]) assert(cardPresent(outBoth, id), `[3d/${id}] admin+commissioner, non-pilot league — card PRESENT`);
  assert(!cardPresent(outBoth, 'scribe-training'), '[3d-absent/scribe-training] admin+commissioner, NON-pilot league — pilot-gated card ABSENT');

  // (d2) same viewer, PILOT league — scribe-training now present too (all 22).
  const outBothPilot = renderAdminPanel({ viewer: VIEWER_ADMIN_AND_COMMISSIONER, league: LEAGUE_PILOT, leagues: [LEAGUE_PILOT], users: USERS, escHtml, icon: iconFn, bodies });
  assert(cardPresent(outBothPilot, 'scribe-training'), '[3d2] admin+commissioner, PILOT league — scribe-training PRESENT');
  for (const id of Object.keys(ADMIN_CARD_TAB)) assert(cardPresent(outBothPilot, id), `[3d2/${id}] admin+commissioner, PILOT league — every card PRESENT`);

  // (e) super admin — UX Revamp wiring pass 2 (2026-09-25): the Super Admin
  // section is now REAL (DI-345's three cards), not a placeholder — see
  // renderSuperAdminPlaceholder()'s own updated header comment.
  const outSuper = renderAdminPanel({ viewer: { ...VIEWER_ADMIN_AND_COMMISSIONER, isSuperAdmin: true }, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies });
  assert(outSuper.includes('data-admin-tab="super-admin"'), '[3e] super admin — the Super Admin section renders');
  assert(outSuper.includes('League Status') && outSuper.includes('Platform Settings') && outSuper.includes('Platform Admins (seed)'),
    '[3e2] super admin — all three DI-345 cards render (League Status, Platform Settings, Platform Admins seed), a real section, not a fabricated one');
  assert(outSuper.includes('SUPER ADMIN'), '[3e3] super admin — the SUPER ADMIN pill renders');

  // (f) SECURITY GATE FINDING 4 (2026-09-25) — a hostile maintenance-banner
  // string must never produce a live `onfocus=` attribute, and its quote
  // must come back entity-encoded. This is adminpaneltest's own copy of the
  // guarantee xsstest.mjs's SWEPT-file sweep now enforces structurally for
  // js/admin-panel.js as a whole (Finding 4's other half).
  const hostileBanner = 'x" onfocus="alert(1)';
  const outHostileBanner = renderAdminPanel({
    viewer: { ...VIEWER_ADMIN_AND_COMMISSIONER, isSuperAdmin: true }, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS,
    escHtml, icon: iconFn, bodies, platformKv: { maintenanceBanner: hostileBanner, signupsOpen: true, loading: false },
  });
  // The escaped text still legitimately CONTAINS the substring "onfocus=" as
  // inert text content (that's what escaping means) — the dangerous shape is
  // a LIVE attribute open, `onfocus="`, which only exists if a raw `"`
  // survived unescaped next to it.
  assert(!outHostileBanner.includes('onfocus="'), '[3f] a hostile maintenance-banner string never produces a live onfocus="..." attribute (the quote that would open it is entity-encoded)');
  assert(outHostileBanner.includes('&quot;'), '[3f2] …and its quote comes back entity-encoded (escHtml did its job)');
}

// ════════════════════════════════════════════════════════════════════════════
// [4] get_member_contacts never referenced in js/admin-panel.js
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[4] get_member_contacts scan (N6, own copy of the guarantee) …');
{
  const src = await readFile(join(__dirname, 'js', 'admin-panel.js'), 'utf8');
  assert(!src.includes('get_member_contacts'),
    '[4a] js/admin-panel.js never references get_member_contacts, anywhere in the file (code or prose)');
  // Teeth — the scan really does look at the real file, not an empty string.
  assert(src.length > 1000, '[4b] fixture check — the file really was read (not empty/truncated)');
}

// ════════════════════════════════════════════════════════════════════════════
// [5] No <script> leaks
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[5] No <script> leaks …');
{
  const evilName = '<script>alert(1)</script>';
  const evilUsers = [
    { userId: 'evil', displayName: evilName, leagueId: 'L1', leagueName: evilName, role: 'player', active: true, linkedAt: null },
  ];
  const evilLeagues = [{ id: 'L1', name: evilName, pilot: true }];
  const out = renderAdminPanel({
    viewer: VIEWER_ADMIN_AND_COMMISSIONER, league: evilLeagues[0], leagues: evilLeagues, users: evilUsers,
    escHtml, icon: iconFn, bodies: {},
  });
  assert(!out.includes('<script>'), '[5a] a malicious displayName/league name never reaches the output as a live <script> tag');
  assert(out.includes('&lt;script&gt;'), '[5b] the malicious string IS present, HTML-escaped (proves escHtml actually ran, not that the data was silently dropped)');

  // Static scan across everything this suite has rendered so far — belt to
  // [5a]'s brace: no fixture anywhere in this run produced a live tag.
  const allRendered = [outMemberGlobal(), out].join('\n');
  function outMemberGlobal() {
    return renderAdminPanel({ viewer: VIEWER_MEMBER, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies: {} });
  }
  assert(!/<script[\s>]/i.test(allRendered), '[5c] no rendered output anywhere in this run contains a literal <script> tag');
}

// ════════════════════════════════════════════════════════════════════════════
// [6] Seed-row no-remove rule (F7d)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Seed-row no-remove rule (F7d) …');
{
  const seedAndOne = [
    { userId: 'drew', displayName: 'Drew', isPlatformAdmin: true, platformAdminAddedAt: null, platformAdminAddedBy: null },
    { userId: 'kihoon', displayName: 'Kihoon', isPlatformAdmin: true, platformAdminAddedAt: '2026-03-01', platformAdminAddedBy: 'drew' },
  ];
  const body = renderPlatformAdminsBody({ users: seedAndOne, escHtml });
  assert(!body.includes(`admin-remove-admin-btn" data-user-id="drew"`),
    '[6a] the seed row (addedBy: null) carries NO remove-admin button');
  assert(body.includes('Irrevocable'), '[6b] the seed row shows the irrevocable copy instead');
  assert(body.includes(`admin-remove-admin-btn" data-user-id="kihoon"`),
    '[6c] a NON-seed admin, with another admin present, DOES get a remove-admin button');

  // Last-admin guard (courtesy client pre-check) — a solitary admin, even if
  // NOT the seed row, still gets no live remove button.
  const soleNonSeed = [{ userId: 'kihoon', displayName: 'Kihoon', isPlatformAdmin: true, platformAdminAddedAt: '2026-03-01', platformAdminAddedBy: 'drew' }];
  const soleBody = renderPlatformAdminsBody({ users: soleNonSeed, escHtml });
  assert(!soleBody.includes('admin-remove-admin-btn'), '[6d] the sole remaining admin (non-seed) has Remove disabled, not a live button');
  assert(soleBody.includes('disabled'), '[6e] the sole-admin case renders a disabled control, not simply omitting the row');

  const empty = renderPlatformAdminsBody({ users: [], escHtml });
  assert(empty.includes('No other platform admins yet.'), '[6f] empty roster — exact DI-320 copy');

  // REVIEWER BLOCK 5 (pass-2, 2026-09-25) — the standalone "Add Admin"
  // button (id="admin-add-admin-btn", data-action="add-admin-open") is
  // REMOVED: it had no handler (a dead enabled control), and the same
  // capability already exists per-row on the Users Across Leagues card
  // ("Make Admin"). Asserted as an ABSENCE on every branch of this function.
  assert(!body.includes('admin-add-admin-btn') && !body.includes('add-admin-open'),
    '[6g] no standalone Add Admin button on the populated-roster branch');
  assert(!soleBody.includes('admin-add-admin-btn') && !soleBody.includes('add-admin-open'),
    '[6h] …nor on the sole-admin branch');
}

// ════════════════════════════════════════════════════════════════════════════
// [7] Super Admin hook — flag-gated only
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Super Admin hook — flag-gated only …');
{
  const noFlag = renderAdminPanel({ viewer: VIEWER_ADMIN_AND_COMMISSIONER, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies: {} });
  assert(!noFlag.includes('data-admin-tab="super-admin"'), '[7a] no viewer.isSuperAdmin — hook absent from a real render, not just the tab bar');
  const withFlag = renderAdminPanel({ viewer: { ...VIEWER_ADMIN_AND_COMMISSIONER, isSuperAdmin: true }, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies: {} });
  assert(withFlag.includes('data-admin-tab="super-admin"'), '[7b] viewer.isSuperAdmin === true — hook present');
  // A player/commissioner-only viewer with the flag set (nonsensical, but
  // the route guard must win regardless — isPlatformAdmin fails first).
  const memberWithFlag = renderAdminPanel({ viewer: { ...VIEWER_MEMBER, isSuperAdmin: true }, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies: {} });
  assert(memberWithFlag.includes('Admin access only.') && !memberWithFlag.includes('super-admin'),
    '[7c] isSuperAdmin never bypasses the isPlatformAdmin route guard');
}

// ════════════════════════════════════════════════════════════════════════════
// [8] Injected bodies render exactly once
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[8] Injected bodies render exactly once …');
{
  const calls = {};
  function counted(cardId, text) {
    return (ctx) => { calls[cardId] = (calls[cardId] || 0) + 1; return `<p data-body="${cardId}">${text}</p>`; };
  }
  const bodies = {
    'auto-refresh': counted('auto-refresh', 'auto refresh body'),
    'data-management': counted('data-management', 'data mgmt body'),
    'scribe-training': counted('scribe-training', 'scribe training body'),
    'export-data': counted('export-data', 'export body'),
    'espn-source': counted('espn-source', 'espn source body'),
    'scribe-model': counted('scribe-model', 'scribe model body'),
  };

  // Non-pilot league, admin+commissioner — scribe-training must NOT be
  // called (card absent), every other injected id called exactly once.
  renderAdminPanel({ viewer: VIEWER_ADMIN_AND_COMMISSIONER, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies });
  assert(calls['auto-refresh'] === 1, '[8a] auto-refresh body called exactly once', `${calls['auto-refresh']}`);
  assert(calls['data-management'] === 1, '[8b] data-management body called exactly once', `${calls['data-management']}`);
  assert(calls['export-data'] === 1, '[8c] export-data body called exactly once (via the native wrapper)', `${calls['export-data']}`);
  assert(calls['espn-source'] === 1, '[8d] espn-source body called exactly once', `${calls['espn-source']}`);
  assert(calls['scribe-model'] === 1, '[8d2] scribe-model body called exactly once — this viewer COMMISSIONS L1, so the commissioner-scoped card is present', `${calls['scribe-model']}`);
  assert(!calls['scribe-training'], '[8e] scribe-training body NOT called at all — non-pilot league, card absent (lazy: absence means never invoked, not invoked-and-discarded)');

  // Admin-only, non-commissioning viewer — commissioner-scoped bodies
  // (auto-refresh, AND scribe-model) must NOT be called; admin-scoped ones
  // (export-data, espn-source) still are.
  const calls2 = {};
  const bodies2 = {
    'auto-refresh': (ctx) => { calls2['auto-refresh'] = (calls2['auto-refresh'] || 0) + 1; return 'x'; },
    'export-data': (ctx) => { calls2['export-data'] = (calls2['export-data'] || 0) + 1; return 'x'; },
    'scribe-model': (ctx) => { calls2['scribe-model'] = (calls2['scribe-model'] || 0) + 1; return 'x'; },
  };
  renderAdminPanel({ viewer: VIEWER_ADMIN_ONLY_NONMEMBER, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies: bodies2 });
  assert(!calls2['auto-refresh'], '[8f] admin-only non-commissioning viewer — commissioner-scoped injected body never called');
  assert(calls2['export-data'] === 1, '[8g] admin-only non-commissioning viewer — admin-scoped injected body still called exactly once');
  assert(!calls2['scribe-model'], '[8g2] admin-only non-commissioning viewer — scribe-model (commissioner-scoped: is_commissioner-gated league_kv write) body NEVER called; the card is absent, not visible-with-a-silently-refused-write');

  // A card with NO injected body supplied at all renders the honest
  // placeholder, never throws, never fabricates content.
  const outNoBodies = renderAdminPanel({ viewer: VIEWER_ADMIN_AND_COMMISSIONER, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies: {} });
  assert(outNoBodies.includes("existing renderer once the wiring pass connects it here"),
    '[8h] a relocated card with no injected body renders the honest placeholder copy');
}

// ════════════════════════════════════════════════════════════════════════════
// [9] The composed `viewer` bag contract (reviewer fix round 1, finding 1)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[9] Composed viewer-bag contract …');
{
  // (a) The REAL raw synthesized session shape, exactly as js/auth.js's
  // _recomputeSynthesizedSession() returns it — {playerId, isAdmin,
  // playerVerified}, NOTHING else. Passed straight through with no
  // composition at all. Must be denied outright (isPlatformAdmin undefined).
  const rawSynthesized = { playerId: 'p-drew', isAdmin: true, playerVerified: true };
  const outRaw = renderAdminPanel({ viewer: rawSynthesized, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies: {} });
  assert(outRaw.includes('Admin access only.'), '[9a] the RAW synthesized session shape (no isPlatformAdmin field at all) is denied outright');
  assert(!outRaw.includes('data-admin-card='), '[9a2] …and renders zero cards of any kind');

  // (b) The "naive, half-composed" shape — someone bolted isPlatformAdmin
  // onto the raw shape without adding activeLeagueId/memberships/userId.
  // Gets PAST the route guard (isPlatformAdmin is true) but must yield ZERO
  // commissioner-scoped cards, because isCommissionerOf()'s single-league
  // fallback needs activeLeagueId and finds undefined. This is the exact
  // requirement reviewer fix round 1 asked to be "pinned by a test."
  const naiveHalfComposed = { playerId: 'p-drew', isAdmin: true, playerVerified: true, isPlatformAdmin: true };
  const outNaive = renderAdminPanel({ viewer: naiveHalfComposed, league: LEAGUE_NONPILOT, leagues: LEAGUES, users: USERS, escHtml, icon: iconFn, bodies: {} });
  assert(!outNaive.includes('Admin access only.'), '[9b] the naive half-composed shape (isPlatformAdmin bolted on) gets PAST the route guard');
  for (const id of ADMIN_ONLY_ROWS) assert(cardPresent(outNaive, id), `[9b-present/${id}] naive half-composed shape — admin-operable card still PRESENT (doesn't need activeLeagueId/memberships)`);
  for (const id of COMMISSIONER_ONLY_ROWS) assert(!cardPresent(outNaive, id), `[9b-absent/${id}] naive half-composed shape — commissioner-scoped card ABSENT (no activeLeagueId/memberships to resolve commissionership)`);
  assert(!cardPresent(outNaive, 'scribe-training'), '[9b-absent/scribe-training] naive half-composed shape — pilot+commissioner-gated card ABSENT too');

  // (c) The FULLY composed bag, exactly per admin-panel.js's header contract
  // — Drew, on the pilot league he commissions, gets all 22 cards.
  const composedBag = {
    ...rawSynthesized, // {playerId, isAdmin, playerVerified} spread first, same as the real recipe
    userId: 'drew',
    isPlatformAdmin: true,
    isSuperAdmin: false,
    activeLeagueId: 'L1',
    memberships: [{ leagueId: 'L1', role: 'commissioner', active: true }],
  };
  const outComposed = renderAdminPanel({ viewer: composedBag, league: LEAGUE_PILOT, leagues: [LEAGUE_PILOT], users: USERS, escHtml, icon: iconFn, bodies: {} });
  const all22 = Object.keys(ADMIN_CARD_TAB);
  assert(all22.length === 22, '[9c] fixture check — ADMIN_CARD_TAB really has 22 keys', `${all22.length}`);
  for (const id of all22) assert(cardPresent(outComposed, id), `[9c/${id}] fully composed bag, pilot league — card PRESENT (Drew gets all 22)`);
}

// ════════════════════════════════════════════════════════════════════════════
// [10] isMemberOfLeague()'s legacy single-league fallback (finding 2)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[10] isMemberOfLeague() legacy fallback (DI-320 verification step 8) …');
{
  // No `memberships` array at all — the legacy single-league shape,
  // mirroring isCommissionerOf()'s own fallback exactly: isAdmin===true AND
  // activeLeagueId matches. Export Data must offer every scope (no
  // non-member note) for Drew on his own league.
  const legacyCommissionerOfL1 = { isAdmin: true, activeLeagueId: 'L1' };
  const bodyMember = renderExportDataBody({ viewer: legacyCommissionerOfL1, league: LEAGUE_NONPILOT, escHtml, bodies: {}, ctx: {} });
  assert(!bodyMember.includes("You are not a member of this league"),
    '[10a] legacy single-league shape (isAdmin+activeLeagueId match) — Export Data offers every scope, no membership note (DI-320 verification step 8)');

  // Same shape, WRONG league — the note appears.
  const legacyCommissionerOfL2 = { isAdmin: true, activeLeagueId: 'L2' };
  const bodyNonMember = renderExportDataBody({ viewer: legacyCommissionerOfL2, league: LEAGUE_NONPILOT, escHtml, bodies: {}, ctx: {} });
  assert(bodyNonMember.includes("You are not a member of this league"),
    '[10b] legacy single-league shape, DIFFERENT activeLeagueId — the membership note DOES appear');

  // isAdmin: false with a matching activeLeagueId — the fallback requires
  // BOTH, mirroring isCommissionerOf()'s own conjunction exactly.
  const legacyPlayerOfL1 = { isAdmin: false, activeLeagueId: 'L1' };
  const bodyPlayerNotMember = renderExportDataBody({ viewer: legacyPlayerOfL1, league: LEAGUE_NONPILOT, escHtml, bodies: {}, ctx: {} });
  assert(bodyPlayerNotMember.includes("You are not a member of this league"),
    '[10c] legacy shape, isAdmin: false — the fallback requires isAdmin===true, not merely a matching activeLeagueId');

  // The richer memberships-array shape still wins when present (unchanged
  // from before this fix round — the fallback is a FALLBACK, only consulted
  // when memberships has no opinion).
  const richMember = { activeLeagueId: 'L9', memberships: [{ leagueId: 'L1', active: true }] };
  const bodyRich = renderExportDataBody({ viewer: richMember, league: LEAGUE_NONPILOT, escHtml, bodies: {}, ctx: {} });
  assert(!bodyRich.includes("You are not a member of this league"),
    '[10d] richer memberships-array shape (no isAdmin/activeLeagueId match needed) still resolves membership correctly');
}

// ════════════════════════════════════════════════════════════════════════════
// [11] viewerUserId-required — unknown viewer suppresses EVERY action for
// EVERY row (finding 6, supersedes the narrower "self row only" bonus test)
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[11] Unknown viewer identity suppresses every role action …');
{
  const rows = [
    { userId: 'drew', displayName: 'Drew', leagueId: 'L1', leagueName: 'Test League', role: 'commissioner', active: true, isPlatformAdmin: true, platformAdminAddedAt: null, platformAdminAddedBy: null },
    { userId: 'sam', displayName: 'Sam', leagueId: 'L1', leagueName: 'Test League', role: 'player', active: true, isPlatformAdmin: false },
  ];

  // (a) viewer with NO userId at all — every action suppressed, for every
  // row, not just a self row (there IS no self row when identity is unknown).
  const unknownViewer = { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'L1' }; // no userId field
  const bodyUnknown = renderUsersAcrossLeaguesBody({ viewer: unknownViewer, users: rows, escHtml });
  assert(!bodyUnknown.includes('admin-make-commissioner-btn') && !bodyUnknown.includes('admin-make-player-btn')
    && !bodyUnknown.includes('admin-make-admin-btn') && !bodyUnknown.includes('admin-remove-admin-btn'),
    '[11a] viewer.userId undefined — NO role action of any kind renders, for ANY row');

  // (b) viewer.userId explicitly null — same suppression.
  const nullViewer = { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'L1', userId: null };
  const bodyNull = renderUsersAcrossLeaguesBody({ viewer: nullViewer, users: rows, escHtml });
  assert(!bodyNull.includes('admin-make-commissioner-btn') && !bodyNull.includes('admin-make-player-btn')
    && !bodyNull.includes('admin-make-admin-btn') && !bodyNull.includes('admin-remove-admin-btn'),
    '[11b] viewer.userId === null — same suppression as undefined');

  // (c) KNOWN viewer — actions render for every OTHER row, none for the
  // viewer's own row (the original self-promotion-hidden-actions rule,
  // still true, now expressed alongside the broader unknown-viewer rule).
  const knownViewer = { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'L1', userId: 'drew' };
  const bodyKnown = renderUsersAcrossLeaguesBody({ viewer: knownViewer, users: rows, escHtml });
  assert(bodyKnown.includes('admin-make-admin-btn" data-user-id="sam"'),
    '[11c] known viewer — an action DOES render for a row that is NOT the viewer');
  // Direct, unambiguous check: no action button anywhere carries the
  // viewer's OWN data-user-id (self row suppressed, others are not).
  assert(!new RegExp('admin-[a-z-]+-btn" data-user-id="drew"').test(bodyKnown),
    "[11c2] known viewer — NO action button anywhere carries the viewer's OWN data-user-id (self row suppressed, others are not)");
}

// ════════════════════════════════════════════════════════════════════════════
// [11d] REVIEWER BLOCK 1 / SECURITY F1 (pass-2, 2026-09-25) — the role-change
// buttons carry `data-member-id` (league_members.id, what
// admin_set_member_role's p_member matches — 0026:644), and the admin-grant
// buttons carry `data-user-id` (the auth user id, what admin_set_platform_admin's
// p_user matches) — two DIFFERENT attribute names, and for the same row two
// DIFFERENT values, so a future edit cannot wire the wrong id into the wrong
// RPC by accidentally reusing one generic attribute.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[11d] BLOCK 1 / F1 — role buttons carry data-member-id, admin buttons carry data-user-id, distinct values…');
{
  const rows = [
    // memberId and userId DELIBERATELY DIFFERENT strings — a test that used
    // the same string for both could not catch a swap.
    { memberId: 'm-sam-L1', userId: 'u-sam', displayName: 'Sam', leagueId: 'L1', leagueName: 'Test League', role: 'player', active: true, isPlatformAdmin: false },
  ];
  const viewer = { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'L1', userId: 'u-drew' };
  const body = renderUsersAcrossLeaguesBody({ viewer, users: rows, escHtml });

  assert(body.includes('admin-make-commissioner-btn" data-member-id="m-sam-L1"'),
    '[11d-1] "Make Commissioner" carries data-member-id, the member row id — NOT data-user-id');
  assert(!/admin-make-commissioner-btn"[^>]*data-user-id/.test(body),
    '[11d-2] "Make Commissioner" carries NO data-user-id attribute at all');
  assert(!body.includes('data-member-id="u-sam"') && !body.includes('data-user-id="m-sam-L1"'),
    '[11d-3] the two ids are never cross-wired — neither attribute carries the OTHER field\'s value');

  // Same row, promoted to commissioner — "Make Player" is the same shape.
  // A SECOND commissioner row is required or activeCommCount<=1 disables the
  // button entirely (the "only active commissioner" guard) — not the branch
  // this assertion is about.
  const rowsComm = [{ ...rows[0], role: 'commissioner' }, { memberId: 'm-other', userId: 'u-other', displayName: 'Other', leagueId: 'L1', leagueName: 'Test League', role: 'commissioner', active: true, isPlatformAdmin: false }];
  const bodyComm = renderUsersAcrossLeaguesBody({ viewer, users: rowsComm, escHtml });
  assert(bodyComm.includes('admin-make-player-btn" data-member-id="m-sam-L1"'),
    '[11d-4] "Make Player" (the demote branch) also carries data-member-id, not data-user-id');

  // Make Admin / Remove Admin — the OTHER family, still data-user-id, unchanged.
  assert(body.includes('admin-make-admin-btn" data-user-id="u-sam" data-name="Sam"'),
    '[11d-5] "Make Admin" still carries data-user-id (the auth user id admin_set_platform_admin expects)');
  assert(!/admin-make-admin-btn"[^>]*data-member-id/.test(body),
    '[11d-6] "Make Admin" carries NO data-member-id attribute at all');
}

// ════════════════════════════════════════════════════════════════════════════
// [11e] REVIEWER FINDING 10 (pass-2, 2026-09-25) — an UNLINKED member
// (userId null/undefined, linkedAt null — a commissioner-created slot nobody
// has claimed yet) still renders as a row, with "Not linked" and its role
// actions still available (memberId is always present); the admin-grant
// actions are suppressed for that row specifically, since there is no auth
// user for admin_set_platform_admin to act on.
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[11e] FINDING 10 — an unlinked member still renders, role actions present, admin actions suppressed…');
{
  const rows = [
    { memberId: 'm-unclaimed', userId: null, displayName: 'Koby', leagueId: 'L1', leagueName: 'Test League', role: 'player', active: true, linkedAt: null, isPlatformAdmin: false },
  ];
  const viewer = { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'L1', userId: 'u-drew' };
  const body = renderUsersAcrossLeaguesBody({ viewer, users: rows, escHtml });

  assert(body.includes('Koby') && body.includes('Not linked'),
    '[11e-1] the unlinked row renders (not filtered out) with "Not linked"');
  assert(body.includes('admin-make-commissioner-btn" data-member-id="m-unclaimed"'),
    '[11e-2] the role action (Make Commissioner) is still available — it only needs memberId, which every row has');
  assert(!body.includes('admin-make-admin-btn') && !body.includes('admin-remove-admin-btn'),
    '[11e-3] the admin-grant actions are suppressed — there is no auth user id to act on');
}

// ════════════════════════════════════════════════════════════════════════════
// [11f] ITEM 6 (pass-2 reviewer, 2026-09-25) — the skeleton variant for the
// two cross-league cards while their fetch is pending, honest empty states
// otherwise (Interaction Principles → Loading states).
// ════════════════════════════════════════════════════════════════════════════
console.log('\n[11f] ITEM 6 — cross-league cards show a skeleton while loading, honest empty otherwise…');
{
  // Users Across Leagues — loading, zero rows so far.
  const loadingBody = renderUsersAcrossLeaguesBody({ viewer: { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'L1', userId: 'u-drew' }, users: [], usersLoading: true, escHtml });
  assert(loadingBody.includes('league-card-skeleton-line') && loadingBody.includes('aria-hidden="true"'),
    '[11f-1] loading + zero rows shows the skeleton (not "No members found.")');
  assert(!loadingBody.includes('No members found.'),
    '[11f-2] the skeleton branch does NOT also claim "No members found." — a loading state is not an empty state');

  // Not loading, genuinely zero rows — the honest empty state, unchanged.
  const emptyBody = renderUsersAcrossLeaguesBody({ viewer: { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'L1', userId: 'u-drew' }, users: [], usersLoading: false, escHtml });
  assert(emptyBody.includes('No members found.') && !emptyBody.includes('league-card-skeleton-line'),
    '[11f-3] not loading + zero rows shows the honest empty state, no skeleton');

  // Loading, but rows ALREADY landed (a repaint mid-refetch of something
  // else) — real data wins, never regress a populated card back to a skeleton.
  const rows = [{ memberId: 'm1', userId: 'u1', displayName: 'Sam', leagueId: 'L1', leagueName: 'Test League', role: 'player', active: true, isPlatformAdmin: false }];
  const populatedWhileLoading = renderUsersAcrossLeaguesBody({ viewer: { isPlatformAdmin: true, isAdmin: true, activeLeagueId: 'L1', userId: 'u-drew' }, users: rows, usersLoading: true, escHtml });
  assert(populatedWhileLoading.includes('Sam') && !populatedWhileLoading.includes('league-card-skeleton-line'),
    '[11f-4] real rows always win over the loading flag — never a skeleton on top of real data');

  // League Status card (renderSuperAdminPlaceholder) — same three cases.
  const superLoading = renderSuperAdminPlaceholder({ escHtml, leagues: [], allLeaguesLoading: true, platformKv: { maintenanceBanner: '', signupsOpen: true, loading: false, loaded: true, error: null }, users: [] });
  assert(superLoading.includes('league-card-skeleton-line') && !superLoading.includes('No leagues found.'),
    '[11f-5] League Status: loading + zero leagues shows the skeleton, not "No leagues found."');
  const superEmpty = renderSuperAdminPlaceholder({ escHtml, leagues: [], allLeaguesLoading: false, platformKv: { maintenanceBanner: '', signupsOpen: true, loading: false, loaded: true, error: null }, users: [] });
  assert(superEmpty.includes('No leagues found.') && !superEmpty.includes('league-card-skeleton-line'),
    '[11f-6] League Status: not loading + zero leagues shows the honest empty state');
}

// ── Bonus: renderAdminAccessDeniedCard / renderPilotLeagueFlagBody /
// renderScribeCapsLimitsBody direct unit coverage (small, cheap, and these
// are exported specifically to allow it).
console.log('\n[Bonus] Direct unit coverage of native card bodies …');
{
  const denied = renderAdminAccessDeniedCard({ escHtml });
  assert(denied.includes('This area is limited to platform admins.'), '[B1] exact DI-320 copy, second line');

  const noPilot = renderPilotLeagueFlagBody({ leagues: [{ id: 'L1', name: 'Test League', pilot: false }], escHtml });
  assert(noPilot.includes('No league is currently marked as the pilot league.'), '[B2] empty-state copy, exact');
  const withPilot = renderPilotLeagueFlagBody({ leagues: [{ id: 'L1', name: 'IRB Football', pilot: true }], escHtml });
  assert(withPilot.includes('Pilot: IRB Football'), '[B3] populated row, exact "Pilot: [League Name]" format');

  const caps = renderScribeCapsLimitsBody({ escHtml });
  assert(caps.includes('scribe-caps-remove-toggle'), '[B4] SCRIBE Caps & Limits carries a real control id, not just prose');
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
