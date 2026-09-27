/**
 * js/admin-panel.js — UX Revamp, Group B (Build Wave 1). DI-320 (ADMIN-PANEL,
 * T-12/UN-290/UN-291), consuming DI-317's `js/roles.js` (isPlatformAdmin,
 * isCommissionerOf, isPilotLeague, canOperateCard, CARD_OPERABILITY — that
 * module is FINAL for this build wave except the one `scribe-model` row added
 * 2026-09-25 and re-scoped to 'commissioner' by reviewer round 2 the same day;
 * nothing here re-derives its logic).
 *
 * PURE RENDER FUNCTIONS. NO DOM, NO NETWORK, NO SUPABASE CLIENT — same
 * discipline as `js/roles.js`'s own header comment. Every function here
 * takes exactly the data it needs as parameters and returns an HTML string
 * (or, for `renderAdminPanel`, the whole panel's inner markup). Nothing is
 * read from module-level mutable state, nothing is cached, nothing calls
 * `document`. This is deliberate: the wiring pass that mounts this panel
 * into `#page-admin` (index.html, not built this pass — see
 * WIRING_CHECKLIST_B_092526.md) owns the DOM side (event binding, RPC calls,
 * `c.innerHTML = renderAdminPanel(...)`, `c.setAttribute('data-admin-active',
 * ...)` exactly mirroring `renderCommPage()`'s own `data-comm-active`
 * pattern, app.js:11277) — this file only has to be RIGHT, not WIRED.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * THE `viewer` BAG — REQUIRED, NOT `getSession()`'s RAW RETURN VALUE
 * ═══════════════════════════════════════════════════════════════════════
 * Reviewer fix round 1 (2026-09-25), finding 1: `getSession()`
 * (`js/storage.js:949` → `js/auth.js`'s synthesized session) returns ONLY
 * `{ playerId, isAdmin, playerVerified }` (`js/auth.js:~1671-1678`,
 * `_recomputeSynthesizedSession()`). `session.memberships` and
 * `session.activeLeagueId` — which `js/roles.js`'s `isCommissionerOf()` and
 * this module's own `isMemberOfLeague()` both need — exist NOWHERE on that
 * return value. Every function in this file that used to accept a `session`
 * parameter now accepts a `viewer` parameter instead, and `viewer` is a
 * COMPOSED bag the wiring pass builds, never `getSession()` passed straight
 * through:
 *
 *   const viewer = {
 *     ...getSession(),                 // { playerId, isAdmin, playerVerified }
 *     userId,                          // auth.uid() — REQUIRED (see below)
 *     isPlatformAdmin,                 // js/auth.js's new derivation (§6 of the checklist)
 *     isSuperAdmin,                    // T-35 hook input, false until that ships
 *     activeLeagueId: getActiveLeagueId(),   // js/auth.js, already exported
 *     memberships: getCachedMemberships(),   // js/auth.js, already exported
 *   };
 *
 * `viewer.userId` is REQUIRED for `renderUsersAcrossLeaguesBody()`'s
 * self-promotion-hidden-actions rule (DI-317 §2b point 6): when it is
 * `null`/`undefined` (an incompletely-composed bag, or a caller that forgot
 * it), EVERY role action (Make Commissioner/Make Player/Make Admin/Remove
 * Admin) is suppressed for EVERY row, not just the viewer's own — an unknown
 * viewer identity means this module cannot prove any given row ISN'T the
 * viewer, and the self-promotion rule's whole point is a structural
 * guarantee, not a best-effort one. See `adminpaneltest.mjs [6b]`.
 *
 * `renderAdminPanel()` therefore validates `viewer` is not the bare
 * three-field synthesized shape by requiring `escHtml` (unrelated,
 * pre-existing) and by `isPlatformAdmin(viewer)`/`canOperateCard()` (from
 * `js/roles.js`) simply returning `false`/absent for every gated surface
 * when the extra fields are missing — the ROUTE GUARD already fails closed
 * on a bare `{playerId,isAdmin,playerVerified}` object (no `isPlatformAdmin`
 * field at all → `false`), and even a caller that ONLY bolts
 * `isPlatformAdmin: true` onto that raw shape (skipping `activeLeagueId`/
 * `memberships`) gets PAST the route guard but sees ZERO commissioner-scoped
 * cards, because `isCommissionerOf()`'s legacy single-league fallback needs
 * `activeLeagueId` and finds `undefined`. Both failure shapes are pinned by
 * `adminpaneltest.mjs [9]`, which is the test that must exist so this
 * contract is enforced by the suite, not just asserted in this comment.
 *
 * ALLOW-LIST (DI-317 §2b.11/F13, `rolestest.mjs`'s whole-tree scan): this
 * file is explicitly on the allow-list for the identifier `isPlatformAdmin`
 * (imported from js/roles.js and used here to gate the whole panel and to
 * compute card visibility). N6 requires this file to carry ZERO references
 * — anywhere, including this comment, which is why the cross-league
 * contact-email RPC is deliberately never named by its literal identifier
 * below (`rolestest.mjs`'s and `adminpaneltest.mjs`'s own N6 scans are bare
 * substring tests over the whole file, comments included) — the "Users
 * Across Leagues" card is built from `league_members`-shaped columns only
 * (role, display name, active, linked-at), passed in via the `users` param,
 * never fetched by this module and never carrying pick/tiebreaker/Extra-
 * Point data, per DI-317 §Security point 3 / DI-320 §Players.
 *
 * BLIND RULE: this file never renders picks, tiebreaker guesses, or Extra
 * Point guesses for any league, for any viewer. There is no code path here
 * that could — `users` rows are membership rows, `leagues` rows are league
 * identity rows, and `bodies[cardId]` (the injection point for relocated
 * cards) is opaque HTML this module does not inspect or generate.
 *
 * CARD SHELL CONTRACT: `bodies[cardId]` is an OPTIONAL function,
 * `(ctx) => htmlString`, where `ctx` is `{ viewer, league, leagues, users }`
 * (plus `isMember` on the ONE call this module makes to `bodies['export-
 * data']` specifically — see `renderExportDataBody()`) — the same bag this
 * module already has, `session` renamed to `viewer` throughout (finding 1).
 * It returns the HTML that goes INSIDE this module's own
 * `<div class="card">…</div>` wrapper (this module supplies the surrounding
 * `.admin-section[data-admin-tab]` + `.admin-section-title` + `.card` shell
 * and the title text; the relocated app.js render function's OWN
 * wrapper/title must be adapted by the wiring pass to emit inner content
 * only — do NOT double-wrap). A card whose `bodies[cardId]` is not supplied
 * renders an honest placeholder, never fabricated content. Every
 * `bodies[cardId]` call happens AT MOST ONCE per `renderAdminPanel()` call,
 * and only when `canOperateCard()` says the card is visible at all
 * (§`adminpaneltest.mjs` "injected bodies render exactly once").
 */

import {
  isPlatformAdmin,
  isPilotLeague,
  canOperateCard,
} from './roles.js';

// ── ADMIN_TABS — the five-tab shell, DI-320 §Layout ─────────────────────────
// Deliberately the SAME five tab keys the Commissioner panel just vacated
// (week/games/players/settings/data) — DI-320's own stated reason: "an admin
// who was a commissioner yesterday recognizes the shape immediately"
// (Design Philosophy §Familiar > Novel). Different CONTENT, same shell.
// Icon names below (calendarWeek/playersGroup/rulebook/scribeSpark/
// cloudData/shieldAdmin) are now LIVE in js/icons.js's ICONS map (group E,
// landed 2026-09-25, same worktree) — `sportFootball`/`settings` shipped
// earlier. `adminpaneltest.mjs [2k]` asserts every name used below actually
// resolves.

export const ADMIN_TABS = Object.freeze([
  { key: 'week', label: 'Week', icon: 'calendarWeek' },
  { key: 'games', label: 'Games', icon: 'sportFootball' },
  { key: 'players', label: 'Players', icon: 'playersGroup' },
  { key: 'settings', label: 'Settings', icon: 'settings' },
  { key: 'data', label: 'Data', icon: 'cloudData' },
]);

// T-35 (2026-09-25 amendment, item 5): a HOOK ONLY. Its body is the fixed
// placeholder `renderSuperAdminPlaceholder()` below, not a real section, per
// the amendment's explicit "do not build it in the B pass; leave a hook."
export const SUPER_ADMIN_TAB = Object.freeze({
  key: 'super-admin', label: 'Super Admin', icon: 'shieldAdmin',
});

const ADMIN_TAB_KEYS = new Set(ADMIN_TABS.map((t) => t.key).concat(SUPER_ADMIN_TAB.key));

// ── ADMIN_CARD_TAB — every Admin-panel card id → its tab (DI-320 §Card-by-
// card placement). PLACEMENT ONLY — who may OPERATE each card is js/roles.js's
// CARD_OPERABILITY, a separate question this map never answers. Every id below
// now has a matching row there; 'scribe-model' was the one gap, closed
// 2026-09-25 as `{ scope: 'commissioner' }` — this module's own original guess,
// by analogy with 'scribe-caps-limits', was right, and for the right reason:
// both write the `league_kv` settings blob, which RLS gates on
// `is_commissioner`. (Fix round 1 briefly scoped it 'admin' on the
// COORDINATOR's fix-round instruction, 2026-09-25; corrected by reviewer
// round 2 the same day. The round-1 comments here credited that to the
// reviewer, which was wrong.) ─────────────────────────────────────────────

export const ADMIN_CARD_TAB = Object.freeze({
  // Week (league-scoped, selector at top)
  'data-source-mode': 'week',
  'demo-simulation': 'week',
  // Games (league-scoped)
  'espn-source': 'games',
  'data-proof': 'games',
  // Players (cross-league)
  'account-linking': 'players',
  'users-across-leagues': 'players',
  'platform-admins': 'players',
  // Settings (league-scoped where noted)
  'auto-refresh': 'settings',
  'randomize-picks-shortcut': 'settings',
  'security-settings': 'settings',
  'scribe-caps-limits': 'settings',
  // AMENDMENT 2026-09-25, item 2: SCRIBE Model moves here from Commissioner
  // → SCRIBE. That amendment moved PLACEMENT only —
  // `CARD_OPERABILITY['scribe-model']` stays { scope: 'commissioner' },
  // exactly like 'account-linking' (Admin-panel placement, commissioner
  // write path). Same precedent, same reason: the `league_kv` settings blob.
  'scribe-model': 'settings',
  'pilot-league-flag': 'settings',
  // Data (league-scoped where noted, all relocated whole)
  'export-data': 'data',
  'data-management': 'data',
  'chat-retention': 'data',
  'chat-history': 'data',
  'recalculate-finalized-weeks': 'data',
  'obligation-corrections': 'data',
  'scribe-training': 'data',
  'background-jobs': 'data',
  'feedback-bug-reports': 'data',
});

/**
 * @param {string} cardId
 * @returns {'week'|'games'|'players'|'settings'|'data'|null}
 */
export function adminTabFor(cardId) {
  return Object.prototype.hasOwnProperty.call(ADMIN_CARD_TAB, cardId)
    ? ADMIN_CARD_TAB[cardId]
    : null;
}

// ── Card titles (this module's own chrome — D-1: no emoji here; the emoji
// living INSIDE an injected `bodies[cardId]()` string, if any, is unchanged
// existing app.js output and out of this pass's scope). ────────────────────

const ADMIN_CARD_TITLE = Object.freeze({
  'data-source-mode': 'Data Source Mode',
  'demo-simulation': 'Demo Simulation',
  'espn-source': 'ESPN Source',
  'data-proof': 'Data Proof',
  'account-linking': 'Account Linking',
  'users-across-leagues': 'Users Across Leagues',
  'platform-admins': 'Platform Admins',
  'auto-refresh': 'Auto-Refresh',
  'randomize-picks-shortcut': 'Randomize Picks Shortcut',
  'security-settings': 'Security & Settings',
  'scribe-caps-limits': 'SCRIBE Caps & Limits',
  'scribe-model': 'SCRIBE Model',
  'pilot-league-flag': 'Pilot League Flag',
  'export-data': 'Export Data',
  'data-management': 'Data Management',
  'chat-retention': 'Chat Retention',
  'chat-history': 'Chat History',
  'recalculate-finalized-weeks': 'Recalculate Finalized Weeks',
  'obligation-corrections': 'Obligation Corrections',
  'scribe-training': 'SCRIBE Training',
  'background-jobs': 'Background Jobs',
  'feedback-bug-reports': 'Feedback & Bug Reports',
});

// ══════════════════════════════════════════════════════════════════════════
// Small local helpers (pure, no DOM)
// ══════════════════════════════════════════════════════════════════════════

function initialsFor(name) {
  return String(name || '??').trim().slice(0, 2).toUpperCase() || '??';
}

/** Defensive date formatting — an unparsable/missing value never throws and
 * never renders "Invalid Date" (CONVENTIONS #7, defensive coercion). */
function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/**
 * Local to this module (NOT exported from js/roles.js, which is frozen this
 * wave except the one row reviewer fix round 1 added) — mirrors
 * `isCommissionerOf()`'s own two-tier read pattern exactly (reviewer fix
 * round 1, finding 2): a richer multi-league `viewer.memberships` array is
 * consulted first; when it has no opinion about this league, fall back to
 * the legacy single-league shape (`viewer.isAdmin === true &&
 * viewer.activeLeagueId === leagueId`) — the SAME fallback
 * `isCommissionerOf()` uses, not a new one, so Export Data on IRB offers
 * every scope for Drew (a commissioner IS a member; DI-320 verification step
 * 8) even before `viewer.memberships` is wired to a real membership read. A
 * future `js/roles.js` window should promote this into an exported
 * `isMemberOf()` alongside `isCommissionerOf` — flagged in
 * WIRING_CHECKLIST_B_092526.md rather than duplicated silently forever.
 *
 * @param {{ isAdmin?: boolean, activeLeagueId?: string|null,
 *           memberships?: Array<{leagueId:string, active?:boolean}> }|null|undefined} viewer
 * @param {string|null|undefined} leagueId
 */
function isMemberOfLeague(viewer, leagueId) {
  if (!viewer || !leagueId) return false;
  if (Array.isArray(viewer.memberships)) {
    const row = viewer.memberships.find((m) => m && m.leagueId === leagueId);
    if (row) return row.active !== false;
  }
  return viewer.isAdmin === true && viewer.activeLeagueId === leagueId;
}

function countActiveCommissioners(users, leagueId) {
  return (users || []).filter((u) => u && u.leagueId === leagueId && u.role === 'commissioner' && u.active !== false).length;
}

/** Dedupes `users` (one row per user PER LEAGUE) down to the distinct set of
 * platform admins it carries, keyed by userId — platform-admin status is
 * not per-league, so counting raw rows would over-count a cross-league
 * admin. Returns rows sorted by displayName for a stable render. */
function derivePlatformAdmins(users) {
  const byId = new Map();
  for (const u of users || []) {
    if (!u || !u.isPlatformAdmin || byId.has(u.userId)) continue;
    byId.set(u.userId, {
      userId: u.userId,
      displayName: u.displayName || u.userId,
      addedAt: u.platformAdminAddedAt || null,
      addedBy: u.platformAdminAddedBy != null ? u.platformAdminAddedBy : null,
    });
  }
  return [...byId.values()].sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
}

function groupUsersByLeague(users) {
  const byLeague = new Map();
  for (const u of users || []) {
    if (!u || !u.leagueId) continue;
    if (!byLeague.has(u.leagueId)) byLeague.set(u.leagueId, { leagueId: u.leagueId, leagueName: u.leagueName || u.leagueId, rows: [] });
    byLeague.get(u.leagueId).rows.push(u);
  }
  return [...byLeague.values()].sort((a, b) => String(a.leagueName).localeCompare(String(b.leagueName)));
}

// ══════════════════════════════════════════════════════════════════════════
// Tab bar (DI-320 §Layout) + ADMIN pill/header (DI-320 §Layout "one visual
// distinction")
// ══════════════════════════════════════════════════════════════════════════

/**
 * @param {{ activeTab?: string, icon?: (name:string, opts?:object)=>string, viewer?: {isSuperAdmin?: boolean} }} [opts]
 */
export function renderAdminTabBar({ activeTab = 'week', icon, viewer } = {}) {
  const iconFn = typeof icon === 'function' ? icon : () => '';
  const tabs = ADMIN_TABS.concat(viewer && viewer.isSuperAdmin ? [SUPER_ADMIN_TAB] : []);
  const active = ADMIN_TAB_KEYS.has(activeTab) ? activeTab : 'week';
  return `
    <div class="comm-tabbar admin-tabbar" role="tablist">
      ${tabs.map((t) => `
        <button type="button" class="comm-tab${active === t.key ? ' active' : ''}"
          data-admin-tab-btn="${t.key}" role="tab" aria-selected="${active === t.key}">
          <span class="comm-tab-icon">${iconFn(t.icon)}</span>
          <span class="comm-tab-label">${t.label}</span>
        </button>
      `).join('')}
    </div>`;
}

/**
 * DI-320 §Layout: "a small Oxblood `var(--oxblood)` accent line under the
 * header and an ADMIN pill next to the page title… the one deliberate
 * departure from 'identical to commissioner panel'."
 *
 * TOKEN GAP RESOLVED (wiring pass 2, 2026-09-25) — Group E's DI-328 landed
 * `--oxblood`/`--oxblood-on` in `css/styles.css` (repeated byte-identical in
 * `:root` and every `.theme-*` block, held CONSTANT unlike `--maroon`) in
 * the same worktree window this pass reads from. This function now uses
 * `var(--oxblood)`/`var(--oxblood-on)` directly — the interim `var(--maroon)`/
 * `var(--bg)` substitution this comment used to document is gone.
 */
export function renderAdminHeader({ viewer, league, leagues = [], escHtml } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const leagueCount = new Set((leagues || []).map((l) => l && l.id).filter(Boolean)).size
    || (league ? 1 : 0);
  const scopeLine = league
    ? `across ${leagueCount || 1} league${(leagueCount || 1) === 1 ? '' : 's'} (${esc(league.name || '')})`
    : `across ${leagueCount} league${leagueCount === 1 ? '' : 's'}`;
  return `
    <div class="section-header admin-section-header" style="border-bottom:2px solid var(--oxblood)">
      <h2>Admin <span class="badge" style="background:var(--oxblood);color:var(--oxblood-on);border-color:var(--oxblood)">ADMIN</span></h2>
      <p class="text-muted text-xs mt-sm">${esc(scopeLine)}</p>
    </div>`;
}

/**
 * DI-320 §States: route guard for a non-admin (commissioner, player, or a
 * stale bookmark/deep link) hitting this panel. Full-page, not blank, not a
 * console error — exactly the copy DI-320 §Copy specifies.
 */
export function renderAdminAccessDeniedCard({ escHtml } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  return `
    <div class="card text-center" id="admin-denied-card">
      <h3>${esc('Admin access only.')}</h3>
      <p class="text-muted text-sm mt-sm">${esc('This area is limited to platform admins.')}</p>
    </div>`;
}

/**
 * T-35 hook only (2026-09-25 amendment, item 5) — a fixed placeholder, not a
 * real section. Rendered whenever `viewer.isSuperAdmin === true` (same input
 * `renderAdminTabBar()` uses to decide whether to show the sixth tab
 * button), tagged `data-admin-tab="super-admin"`. Reviewer fix round 1: this
 * doc previously claimed the placeholder ALSO gates on "the active tab is
 * 'super-admin'" — false; like every other card in this module, it renders
 * unconditionally into the output whenever its flag/operability check
 * passes, and VISIBILITY per active tab is a CSS concern, not a render
 * concern — the exact same `data-admin-tab`/`data-admin-active` pattern
 * every other `.admin-section` in this file already uses (see
 * WIRING_CHECKLIST_B_092526.md §2's `#page-admin[data-admin-active="super-
 * admin"] .admin-section[data-admin-tab="super-admin"] { display: block; }`
 * rule). Rendering all tabs' content and letting CSS hide the inactive ones
 * is deliberate — Interaction Principles §"Tab Bar": "preserve state…
 * avoid unnecessary reloads."
 */
export function renderSuperAdminPlaceholder({ escHtml, leagues = [], allLeaguesLoading = false, platformKv, users = [], allLeaguesError = null } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const kv = platformKv || { maintenanceBanner: '', signupsOpen: true, loading: false, loaded: false, error: null };

  // REVIEWER FINDING 7 (2026-09-25) — a failed platform_kv read used to
  // degrade SILENTLY into the guessed defaults above, with the Save button
  // and the signups-open toggle both still live: a commissioner acting on
  // what LOOKED like real data could write one of those guesses back,
  // permanently overwriting a value the read never actually saw. When the
  // read has an `error` AND has never actually landed (`loaded` still
  // false), the write controls are disabled and an inline Retry replaces
  // them — loud-fail (AD-06), and "never write a value that was never
  // read."
  const kvUnreadable = !!(kv.error && !kv.loaded);
  const kvErrorNote = kvUnreadable
    ? `<p class="text-xs mb-sm" style="color:var(--loss)">${esc('Couldn\'t load platform settings — showing nothing, not a guess.')}</p>
       <button type="button" class="btn btn-ghost btn-sm" id="super-kv-retry-btn">${esc('Retry')}</button>
       <div class="divider"></div>`
    : '';

  // Same discipline for the cross-league leagues read: if it failed, the
  // League Status card falls back to the viewer's OWN memberships-derived
  // list (renderAdminPage()'s existing fallback) — that fallback is real
  // data, not a guess, but it is INCOMPLETE for a super admin who expects
  // every league, so it is named here rather than presented as complete.
  const allLeaguesErrorNote = allLeaguesError
    ? `<p class="text-xs mb-sm" style="color:var(--loss)">${esc("Couldn't load every league — showing only yours.")}</p>
       <button type="button" class="btn btn-ghost btn-sm mb-sm" id="super-leagues-retry-btn">${esc('Retry')}</button>`
    : '';

  // ── League Status (DI-345 §Layout, card 1) ────────────────────────────
  const leagueRows = (leagues || []).map((l) => {
    const paused = l && l.status === 'paused';
    const pilotBadge = l && l.pilot ? ' <span class="badge badge-pilot">Pilot</span>' : '';
    const statusPill = paused
      ? '<span class="badge" style="background:var(--gold-pale);color:var(--gold-text);border-color:var(--gold)">Paused</span>'
      : '<span class="badge badge-open">Active</span>';
    return `
      <div class="player-admin-row" data-league-status-row="${esc(l.id)}">
        <div class="player-admin-info">
          <div>
            <div class="font-display" style="font-size:.9rem">${esc(l.name || l.id)}${pilotBadge}</div>
            <div class="text-xs mt-xs">${statusPill}</div>
          </div>
        </div>
        <div class="player-admin-controls">
          <button type="button" class="btn btn-ghost btn-sm super-league-pause-btn"
            data-league-id="${esc(l.id)}" data-next-status="${paused ? 'active' : 'paused'}">
            ${esc(paused ? 'Resume' : 'Pause')}
          </button>
        </div>
      </div>`;
  }).join('');

  // ── Platform Admins (seed) — DI-345 §Layout, card 3 ───────────────────
  const seed = (users || []).find((u) => u && u.isPlatformAdmin && u.platformAdminAddedBy === null);
  const seedLine = seed
    ? `${esc('Seed admin:')} <strong>${esc(seed.displayName || seed.userId)}</strong> — ${esc('set by database migration, cannot be revoked or duplicated through the app.')}`
    : esc('Seed admin: not found in the current Platform Admins read.');

  return `
    <div class="admin-section" data-admin-tab="super-admin">
      <div class="admin-section-title" style="border-bottom-color:var(--oxblood)">${esc('Super Admin')}
        <span class="badge" style="background:var(--oxblood);color:var(--oxblood-on);border-color:var(--oxblood);margin-left:6px">${esc('SUPER ADMIN')}</span>
      </div>
      <div class="card mb-md" id="super-league-status-card">
        <div class="card-title mb-sm">${esc('League Status')}</div>
        ${allLeaguesErrorNote}
        ${leagueRows || (allLeaguesLoading && !leagues.length ? crossLeagueSkeletonRowsHTML() : `<p class="text-muted text-sm">${esc('No leagues found.')}</p>`)}
      </div>
      <div class="card mb-md">
        <div class="card-title mb-sm">${esc('Platform Settings')}</div>
        ${kvErrorNote}
        <div class="form-group">
          <label class="form-label" for="super-maintenance-banner">${esc('Maintenance Banner')}</label>
          <input class="form-input" id="super-maintenance-banner" type="text" maxlength="200"
            placeholder="${esc('Empty = no banner shown anywhere')}" value="${esc(kv.maintenanceBanner || '')}" ${kvUnreadable ? 'disabled' : ''} />
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="super-save-banner-btn" ${kvUnreadable ? 'disabled' : ''}>${esc('Save')}</button>
        <div class="divider"></div>
        <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:11px 0;min-height:44px">
          <input type="checkbox" id="super-signups-open-toggle" ${kv.signupsOpen !== false ? 'checked' : ''} ${kvUnreadable ? 'disabled' : ''} />
          <span class="form-label" style="margin:0">${esc('New signups open')}</span>
        </label>
      </div>
      <div class="card">
        <div class="card-title mb-sm">${esc('Platform Admins (seed)')}</div>
        <p class="text-muted text-xs">${seedLine}</p>
      </div>
    </div>`;
}

/**
 * DI-320 §Layout: "A league selector at the top of Week/Games tabs." This
 * module does not own `showLeagueSelectorSheet()` (a DOM-side function in
 * js/app.js) — it renders a button carrying the data the wiring pass binds
 * a click handler to, per the "reuses the existing league-selector sheet"
 * reuse call.
 */
function renderLeagueSelectorButton({ tab, league, escHtml }) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const label = league && league.name ? esc(league.name) : 'Choose a league…';
  return `
    <div class="admin-section" data-admin-tab="${tab}">
      <button type="button" class="btn btn-secondary btn-sm" id="admin-league-selector-btn" data-action="open-league-selector">
        ${esc('Viewing:')} <strong>${label}</strong>
      </button>
    </div>`;
}

// ══════════════════════════════════════════════════════════════════════════
// Card shell + dispatcher
// ══════════════════════════════════════════════════════════════════════════

function cardShell({ tab, title, bodyHtml, escHtml, cardId }) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  return `
    <div class="admin-section" data-admin-tab="${tab}" data-admin-card="${cardId}">
      <div class="admin-section-title">${esc(title)}</div>
      <div class="card">${bodyHtml}</div>
    </div>`;
}

function placeholderBody(escHtml) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  return `<p class="text-muted text-xs">${esc("This card's content is provided by the Commissioner panel's existing renderer once the wiring pass connects it here.")}</p>`;
}

// Cards THIS module builds directly (real DI-320 UI, not an injected
// relocation) — DI-320's own "new cards" list. Reviewer fix round 1,
// hygiene: this map is the ACTUAL dispatch table (`renderAdminCard()` below
// keys off it directly via `NATIVE_CARD_IDS.has(cardId)`), not a decorative
// Set nobody reads. Export Data is intentionally NOT here — it wraps an
// INJECTED body rather than replacing it (§Per-card operability's
// "loud-refusal requirement"), so it stays its own branch in
// `renderAdminCard()`.
const NATIVE_CARD_RENDERERS = Object.freeze({
  'users-across-leagues': ({ viewer, users, usersLoading, escHtml }) =>
    renderUsersAcrossLeaguesBody({ viewer, users, usersLoading, escHtml }),
  'platform-admins': ({ users, escHtml }) =>
    renderPlatformAdminsBody({ users, escHtml }),
  'pilot-league-flag': ({ leagues, escHtml }) =>
    renderPilotLeagueFlagBody({ leagues, escHtml }),
  'scribe-caps-limits': ({ escHtml }) =>
    renderScribeCapsLimitsBody({ escHtml }),
});
const NATIVE_CARD_IDS = new Set(Object.keys(NATIVE_CARD_RENDERERS));

/**
 * Dispatches one card id to its body content — either a NATIVE renderer
 * (DI-320's genuinely new admin-only surfaces, via `NATIVE_CARD_RENDERERS`),
 * the Export Data special case (native wrapper + injected body), or the
 * injected `bodies[cardId]` function (a relocated app.js card, called AT
 * MOST ONCE, only when reached — i.e. only when `canOperateCard()` already
 * returned true for it, checked by the caller before this function runs).
 */
function renderAdminCard({ cardId, tab, viewer, league, leagues, users, usersLoading, escHtml, icon, bodies }) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const title = ADMIN_CARD_TITLE[cardId] || cardId;
  const ctx = { viewer, league, leagues, users };

  let bodyHtml;
  if (NATIVE_CARD_IDS.has(cardId)) {
    bodyHtml = NATIVE_CARD_RENDERERS[cardId]({ viewer, league, leagues, users, usersLoading, escHtml: esc });
  } else if (cardId === 'export-data') {
    bodyHtml = renderExportDataBody({ viewer, league, escHtml: esc, bodies, ctx });
  } else {
    const injected = typeof bodies?.[cardId] === 'function' ? bodies[cardId](ctx) : null;
    bodyHtml = injected != null ? injected : placeholderBody(esc);
  }

  return cardShell({ tab, title, bodyHtml, escHtml: esc, cardId });
}

// ══════════════════════════════════════════════════════════════════════════
// Native card bodies — DI-320's genuinely new admin-only surfaces
// ══════════════════════════════════════════════════════════════════════════

/**
 * DI-320 §Players "Users Across Leagues" / DI-317 — every `league_members`
 * row the viewing admin can see (server: `is_platform_admin()` read-
 * everywhere), grouped by league, columns role/display_name/active/
 * linked_at ONLY (F10/N6 — never contacts, never picks). Promote/Demote
 * Commissioner and Promote/Demote Admin actions reuse the EXACT row/button
 * pattern already shipped for League Members (app.js:22856-22876, DI-182e)
 * — `.player-admin-row` / `.player-admin-info` / `.player-admin-avatar` /
 * `.player-admin-controls`, `.btn.btn-ghost.btn-sm` buttons with
 * `data-*` attributes the wiring pass's event delegation binds to RPC calls,
 * never an inline handler.
 *
 * `viewer.userId` REQUIRED (reviewer fix round 1, finding 6 — see this
 * file's header "THE `viewer` BAG"): when it is `null`/`undefined`, EVERY
 * role action is suppressed for EVERY row, not just a self-row — an unknown
 * viewer identity cannot prove any row isn't the viewer's own.
 */
/**
 * Item 6 (pass-2 reviewer, 2026-09-25) — shared skeleton-row shape for the
 * two cross-league cards while their own fetch is in flight. Reuses the
 * EXISTING `.league-card-skeleton-line-wide`/`-narrow` shimmer classes
 * (js/leagues-home.js's own precedent) inside `.player-admin-row`'s real
 * layout, rather than inventing a second skeleton visual language —
 * Interaction Principles' "Loading" hierarchy (cached -> skeleton ->
 * progressive -> spinner-last): this is the skeleton rung, replacing what
 * would otherwise be the FIRST-LOAD empty state ("No members found." read
 * while still fetching is a false claim, not an honest loading state).
 */
function crossLeagueSkeletonRowsHTML(count = 2) {
  return Array.from({ length: count }, () => `
    <div class="player-admin-row" aria-hidden="true">
      <div class="player-admin-info" style="flex:1;display:block">
        <div class="league-card-skeleton-line league-card-skeleton-line-wide"></div>
        <div class="league-card-skeleton-line league-card-skeleton-line-narrow"></div>
      </div>
    </div>`).join('');
}

export function renderUsersAcrossLeaguesBody({ viewer, users = [], usersLoading = false, escHtml } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  if (!users.length && usersLoading) return crossLeagueSkeletonRowsHTML();
  if (!users.length) return `<p class="text-muted">${esc('No members found.')}</p>`;

  const viewerUserId = viewer && viewer.userId != null ? viewer.userId : null;
  const knowsViewer = viewerUserId != null;
  const totalActiveAdmins = derivePlatformAdmins(users).length;
  const groups = groupUsersByLeague(users);

  return groups.map((g) => {
    const activeCommCount = countActiveCommissioners(users, g.leagueId);
    const rows = g.rows.map((u) => {
      const isSelf = knowsViewer && u.userId === viewerUserId;
      const showActions = knowsViewer && !isSelf;
      const roleBadge = u.role === 'commissioner'
        ? '<span class="badge badge-open">Commissioner</span>'
        : '<span class="badge badge-draft">Player</span>';
      // Escaped ONCE, at the point the date text is captured — the string
      // interpolated into the row below is used AS-IS, never re-escaped
      // (reviewer fix round 1, finding 8: double-escaping harmless-looking
      // text is still a defect — a literal `&` in a locale's date format
      // would otherwise come out `&amp;amp;`).
      const linkedLine = u.linkedAt ? `Linked ${esc(shortDate(u.linkedAt))}` : 'Not linked';

      let commissionerBtn = '';
      let commissionerCaption = '';
      if (showActions) {
        if (u.role === 'commissioner') {
          if (activeCommCount <= 1) {
            commissionerCaption = `<div class="text-xs" style="color:var(--text-muted)">${esc(`${u.displayName} is the only active commissioner in this league — promote someone else first.`)}</div>`;
            commissionerBtn = `<button class="btn btn-ghost btn-sm" disabled title="${esc('Only active commissioner')}">Make Player</button>`;
          } else {
            // REVIEWER BLOCK 1 / SECURITY F1 (pass-2, 2026-09-25) — `data-member-id`,
            // NOT `data-user-id`. `admin_set_member_role(p_league, p_member, p_role)`
            // matches `id = p_member` (`league_members.id`, `0026:644`), a DIFFERENT
            // value from the auth user id `data-user-id` carries below on the admin
            // buttons. The two attribute names are deliberately distinct so a
            // future edit can never wire the wrong id into the wrong RPC by reusing
            // one generic attribute (adminpaneltest asserts the two families differ).
            commissionerBtn = `<button class="btn btn-ghost btn-sm admin-make-player-btn" data-member-id="${esc(u.memberId)}" data-league-id="${esc(g.leagueId)}" data-name="${esc(u.displayName)}">Make Player</button>`;
          }
        } else {
          commissionerBtn = `<button class="btn btn-ghost btn-sm admin-make-commissioner-btn" data-member-id="${esc(u.memberId)}" data-league-id="${esc(g.leagueId)}" data-name="${esc(u.displayName)}">Make Commissioner</button>`;
        }
      }

      let adminBtn = '';
      let adminCaption = '';
      // REVIEWER FINDING 10 (pass-2, 2026-09-25) — an unlinked member (no
      // `user_id` yet — a commissioner-created slot nobody has claimed) has
      // no auth user for `admin_set_platform_admin(p_user, …)` to act on.
      // Suppress the admin actions for that row specifically (the role
      // actions above are unaffected — they operate on `memberId`, which
      // every row has); the row itself still appears, with its "Not linked"
      // caption, rather than being filtered out entirely.
      if (showActions && u.userId != null) {
        if (u.isPlatformAdmin) {
          if (totalActiveAdmins <= 1) {
            adminCaption = `<div class="text-xs" style="color:var(--text-muted)">${esc(`${u.displayName} is the only platform admin — add another before removing this one.`)}</div>`;
            adminBtn = `<button class="btn btn-ghost btn-sm" disabled title="${esc('Only platform admin')}">Remove Admin</button>`;
          } else {
            adminBtn = `<button class="btn btn-ghost btn-sm admin-remove-admin-btn" data-user-id="${esc(u.userId)}" data-name="${esc(u.displayName)}">Remove Admin</button>`;
          }
        } else {
          adminBtn = `<button class="btn btn-ghost btn-sm admin-make-admin-btn" data-user-id="${esc(u.userId)}" data-name="${esc(u.displayName)}">Make Admin</button>`;
        }
      }

      return `
        <div class="player-admin-row" data-member-row="${esc(u.memberId)}" data-league-row="${esc(g.leagueId)}">
          <div class="player-admin-info">
            <span class="player-admin-avatar${u.active === false ? ' inactive' : ''}">${esc(initialsFor(u.displayName))}</span>
            <div>
              <div class="font-display" style="font-size:.9rem">${esc(u.displayName || u.userId || 'Unnamed')}${u.active === false ? ' <em class="text-muted">(removed)</em>' : ''} ${roleBadge}</div>
              <div class="text-xs text-muted">${linkedLine}</div>
            </div>
          </div>
          <div class="player-admin-controls">
            ${commissionerBtn}${adminBtn}
          </div>
          ${commissionerCaption}${adminCaption}
        </div>`;
    }).join('');

    return `
      <div class="font-display mb-sm" style="font-size:.9rem">${esc(g.leagueName)}</div>
      <div class="mb-md">${rows}</div>`;
  }).join('');
}

/**
 * DI-320 §Players "Platform Admins" — DI-317's F7d seed-row rule: a row
 * whose `addedBy` is `null` (the seed row Drew inserts by his own SQL) shows
 * NO remove action, ever, from this UI — "Drew's own seed grant can only
 * ever be revoked by him running SQL directly, never through the app."
 * The last-admin guard (client pre-check, courtesy only — the server
 * statement-level trigger is the real authority, DI-317 §2b point 7) also
 * disables Remove on the sole remaining admin regardless of seed status.
 */
export function renderPlatformAdminsBody({ users = [], escHtml } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const admins = derivePlatformAdmins(users);
  if (!admins.length) return `<p class="text-muted">${esc('No other platform admins yet.')}</p>`;

  const rows = admins.map((a) => {
    const isSeed = a.addedBy === null;
    // Escaped once, used as-is below (see the identical note on
    // `linkedLine` above — same fix, same reason).
    const addedLine = a.addedAt ? `Added ${esc(shortDate(a.addedAt))}` : 'Added date unknown';
    let action;
    if (isSeed) {
      action = `<span class="text-xs text-muted">${esc('Irrevocable — set by direct SQL')}</span>`;
    } else if (admins.length <= 1) {
      action = `<button class="btn btn-ghost btn-sm" disabled title="${esc('Only platform admin')}">Remove Admin</button>`;
    } else {
      action = `<button class="btn btn-ghost btn-sm admin-remove-admin-btn" data-user-id="${esc(a.userId)}" data-name="${esc(a.displayName)}">Remove Admin</button>`;
    }
    return `
      <div class="player-admin-row" data-user-row="${esc(a.userId)}">
        <div class="player-admin-info">
          <span class="player-admin-avatar">${esc(initialsFor(a.displayName))}</span>
          <div>
            <div class="font-display" style="font-size:.9rem">${esc(a.displayName)}</div>
            <div class="text-xs text-muted">${addedLine}</div>
          </div>
        </div>
        <div class="player-admin-controls">${action}</div>
      </div>`;
  }).join('');

  // REVIEWER BLOCK 5 (pass-2, 2026-09-25) — this card's own standalone "Add
  // Admin" button had no handler (a dead enabled control). Removed rather
  // than stubbed: granting platform admin to an arbitrary user needs a
  // picker UI this window doesn't have budget for, and the SAME capability
  // already exists per-row on the Users Across Leagues card immediately
  // above ("Make Admin" on any linked member) — not a lost capability, a
  // redundant entry point removed.
  return rows;
}

/**
 * DI-318 §Placement 1 / DI-320 §Settings — read-only, D-10: no write path
 * this release. Empty state per DI-318 §Copy exactly.
 */
export function renderPilotLeagueFlagBody({ leagues = [], escHtml } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const pilots = (leagues || []).filter((l) => isPilotLeague(l));
  if (!pilots.length) return `<p class="text-muted">${esc('No league is currently marked as the pilot league.')}</p>`;
  return pilots.map((l) => `<div class="text-sm mb-sm">${esc(`Pilot: ${l.name || l.id}`)}</div>`).join('');
}

/**
 * DI-320 §Settings "SCRIBE Caps & Limits" — the admin-only extension of the
 * Participation dial's ceiling; the dial itself is unchanged and stays on
 * Commissioner → SCRIBE (this card does not touch it). §Per-card
 * operability's own "named limitation" applies: no admin-scoped write RPC
 * exists for this control in this release's approved migration batch, so
 * this body is a minimal, honest control surface — not a fabricated set of
 * options this input never specified numerically.
 */
export function renderScribeCapsLimitsBody({ escHtml } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  return `
    <p class="text-muted text-xs mb-sm">${esc('Raises the per-week cap the Participation dial (Commissioner → SCRIBE) otherwise enforces. The dial itself is unchanged.')}</p>
    <label style="display:flex;align-items:center;gap:8px;cursor:pointer;min-height:44px">
      <input type="checkbox" id="scribe-caps-remove-toggle" />
      <span class="form-label" style="margin:0">${esc('Remove the participation cap for this league')}</span>
    </label>`;
}

/**
 * DI-320 §Per-card operability "Export Data — the loud-refusal requirement
 * (F5)": before rendering the picks/tiebreaker/Extra-Point export scope,
 * check membership of the currently-selected league. This module cannot
 * reach inside an injected `bodies['export-data']` string to remove
 * specific checkboxes from it — it can only decide whether to show the
 * explanatory note ABOVE that injected content. The wiring pass MUST
 * additionally adapt the real export-data renderer to accept `ctx.isMember`
 * and suppress its own picks-scope checkboxes when false — named explicitly
 * in WIRING_CHECKLIST_B_092526.md, not silently assumed solved by this note
 * alone.
 */
export function renderExportDataBody({ viewer, league, escHtml, bodies, ctx } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const leagueId = league && league.id != null ? league.id : null;
  const member = isMemberOfLeague(viewer, leagueId);
  const note = member ? '' : `<p class="text-xs mb-sm" style="color:var(--text-muted)">${esc("You are not a member of this league, so pick-level data can't be exported from here — ask the league's commissioner.")}</p>`;
  const injected = typeof bodies?.['export-data'] === 'function'
    ? bodies['export-data']({ ...ctx, isMember: member })
    : null;
  return `${note}${injected != null ? injected : placeholderBody(esc)}`;
}

// ══════════════════════════════════════════════════════════════════════════
// renderAdminPanel — the whole panel's inner markup
// ══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} AdminUserRow
 * @property {string} userId
 * @property {string} displayName
 * @property {string} leagueId
 * @property {string} leagueName
 * @property {'commissioner'|'player'} role
 * @property {boolean} [active]
 * @property {string|null} [linkedAt]        ISO string or null
 * @property {boolean} [isPlatformAdmin]
 * @property {string|null} [platformAdminAddedAt]
 * @property {string|null} [platformAdminAddedBy]  null = seed row (irrevocable, F7d)
 *
 * ASSUMED SHAPE, NOT YET CONFIRMED AGAINST A REAL BACKEND READ THIS WAVE —
 * see WIRING_CHECKLIST_B_092526.md. The columns are exactly DI-320 §Players'
 * own list ("role, display_name, active, linked_at only — never contacts");
 * `isPlatformAdmin`/`platformAdminAddedAt`/`platformAdminAddedBy` are this
 * module's own minimal addition to let ONE `users` array serve both the
 * "Users Across Leagues" and "Platform Admins" cards without a second param.
 */

/**
 * @param {Object} opts
 * @param {{playerId?:string|null, isAdmin?:boolean, playerVerified?:boolean, userId?:string|null,
 *          isPlatformAdmin?:boolean, isSuperAdmin?:boolean, activeLeagueId?:string|null,
 *          memberships?: Array<{leagueId:string, role:string, active?:boolean}>}} opts.viewer
 *   The COMPOSED bag — see this file's header "THE `viewer` BAG". NEVER
 *   `getSession()`'s raw return value passed straight through.
 * @param {{id?:string, name?:string, pilot?:boolean}|null} [opts.league] the currently
 *   selected/active league for league-scoped tabs (Week/Games/Settings/Data)
 * @param {Array<{id:string, name:string, pilot?:boolean}>} [opts.leagues] every league
 *   this admin can see (Pilot League Flag card, header league count)
 * @param {AdminUserRow[]} [opts.users] cross-league membership rows (Users Across
 *   Leagues + Platform Admins cards)
 * @param {(s: any) => string} opts.escHtml REQUIRED — this module never assumes a
 *   global escHtml (js/app.js's is not exported; CONVENTIONS #12 applies here too)
 * @param {(name:string, o?:object)=>string} [opts.icon] falls back to a no-op ('')
 *   if not supplied, per icon()'s own documented graceful-degrade contract
 * @param {Object<string, (ctx:object)=>string>} [opts.bodies] injection point for
 *   relocated app.js cards — see this file's header "CARD SHELL CONTRACT"
 * @param {string} [opts.activeTab]
 * @returns {string}
 */
export function renderAdminPanel({
  viewer, league = null, leagues = [], users = [], usersLoading = false, allLeaguesLoading = false,
  escHtml, icon, bodies = {}, activeTab = 'week', platformKv, allLeaguesError = null,
} = {}) {
  if (typeof escHtml !== 'function') {
    throw new TypeError('renderAdminPanel requires an escHtml function (CONVENTIONS #12)');
  }
  const esc = escHtml;
  const iconFn = typeof icon === 'function' ? icon : () => '';

  if (!isPlatformAdmin(viewer)) {
    return renderAdminAccessDeniedCard({ escHtml: esc });
  }

  // REVIEWER FINDING 6 (2026-09-25) — defense in depth, independent of the
  // app.js navigateTo() clamp: `ADMIN_TAB_KEYS` includes 'super-admin'
  // unconditionally (it has to, so a real super admin's own tab click
  // resolves), so a non-super-admin viewer whose `activeTab` is somehow
  // 'super-admin' (stale persisted state, identity handover mid-session)
  // would otherwise land on a tab key no card or tab button matches —
  // every `.admin-section[data-admin-tab]` hidden by css/styles.css's
  // tab-visibility rule, a blank page instead of a stated denial. Clamped
  // to 'week' here so this function alone (not just its caller) guarantees
  // a non-super-admin viewer never resolves to that tab.
  const requestedKey = ADMIN_TAB_KEYS.has(activeTab) ? activeTab : 'week';
  const activeKey = (requestedKey === 'super-admin' && !(viewer && viewer.isSuperAdmin)) ? 'week' : requestedKey;

  const headerHtml = renderAdminHeader({ viewer, league, leagues, escHtml: esc });
  const tabBarHtml = renderAdminTabBar({ activeTab: activeKey, icon: iconFn, viewer });

  const leagueSelectorsHtml =
    renderLeagueSelectorButton({ tab: 'week', league, escHtml: esc }) +
    renderLeagueSelectorButton({ tab: 'games', league, escHtml: esc });

  const cardsHtml = Object.keys(ADMIN_CARD_TAB)
    .filter((id) => canOperateCard(id, viewer, league))
    .map((id) => renderAdminCard({
      cardId: id, tab: ADMIN_CARD_TAB[id], viewer, league, leagues, users, usersLoading,
      escHtml: esc, icon: iconFn, bodies,
    }))
    .join('');

  const superAdminHtml = (viewer && viewer.isSuperAdmin)
    ? renderSuperAdminPlaceholder({ escHtml: esc, leagues, allLeaguesLoading, platformKv, users, allLeaguesError })
    : '';

  return `${headerHtml}${tabBarHtml}${leagueSelectorsHtml}${cardsHtml}${superAdminHtml}`;
}
