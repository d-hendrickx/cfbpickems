/**
 * js/comm-panel-layout.js — UX Revamp, Group B (Build Wave 1). DI-319
 * (COMM-PANEL-REORG, T-11/UN-289/UN-294) as DATA, not DOM.
 *
 * Pure data + string-render helpers, NO DOM, NO NETWORK, NO SUPABASE CLIENT —
 * same discipline as `js/roles.js`. This module exists so the wiring pass
 * that re-points `renderCommPage()` (js/app.js) at the DI-319 tab rename does
 * not have to re-derive the card→tab map by re-reading the DI a second time:
 * `COMM_CARD_TAB` and `commTabFor()` ARE the map, and `renderCommTabBar()` IS
 * the tab strip's markup, both already reviewed here.
 *
 * SCOPE: this file does not touch `js/app.js`, `index.html`, or
 * `css/styles.css` — none of those are in this pass's file claims. It is
 * safe to import from anywhere without side effects.
 *
 * BINDING SOURCE: the 2026-09-25 amendment block at the top of
 * `weekly bug fixes and feedback/UX Revamp 092426/DESIGN_INPUTS_B_ROLES_PANELS_092426.md`
 * overrides DI-319's own original card table on two points, both applied
 * below:
 *   1. Account Linking is ADMIN-ONLY — removed from the Commissioner →
 *      Players tab entirely (not merely relocated to a Commissioner card;
 *      `COMM_CARD_TAB['account-linking'] = 'admin'` and it never renders
 *      inside `renderCommPage()` again).
 *   2. SCRIBE Model (opus/sonnet) is ADMIN-ONLY — leaves the Commissioner →
 *      SCRIBE tab for Admin → Settings, beside SCRIBE Caps & Limits.
 *      Commissioner → SCRIBE keeps Participation, Heat, Learning Rate, and
 *      Chat & S.C.R.I.B.E. only.
 * The "Alma Maters" card is renamed "Alma maters & home teams" (copy only —
 * same card id, same tab, unchanged placement).
 *
 * CARD IDS: kebab-case, and — for every card that ALSO appears in
 * `js/roles.js`'s `CARD_OPERABILITY` table (i.e. every card that moves to
 * the Admin panel and is therefore subject to a per-card operability check
 * there) — the SAME id `roles.js` uses. `js/roles.js` is authored and
 * frozen for this build wave; this file does not invent a second id for
 * anything `roles.js` already names. Two ids used below do NOT appear in
 * `CARD_OPERABILITY` because they are new Admin-only surfaces that never
 * existed as a Commissioner-panel card in the first place (so they have no
 * row here at all — 'pilot-league-flag', 'users-across-leagues',
 * 'platform-admins' — see js/admin-panel.js). `'scribe-model'` WAS a known
 * gap against `CARD_OPERABILITY` as of this file's first draft. Fix round 1
 * (2026-09-25) added the row as `{ scope: 'admin' }` on the COORDINATOR's
 * instruction; reviewer round 2 corrected it to `{ scope: 'commissioner' }`
 * because the card's write path (setScribeModel → saveSetting → league_kv)
 * is is_commissioner-gated, exactly like 'account-linking'. PLACEMENT (this
 * file: relocated to the Admin panel) and OPERABILITY (roles.js) are
 * different facts.
 *
 * ICON NAMES: `COMM_TABS[].icon` names an entry `icon()` (js/icons.js)
 * resolves. All five — `calendarWeek`, `sportFootball`, `playersGroup`,
 * `rulebook`, `scribeSpark` — are LIVE in the shipped `ICONS` map as of
 * 2026-09-25 (group E landed the remaining four in the same worktree after
 * this file's first draft, which had flagged four as pending). Confirmed by
 * `adminpaneltest.mjs`'s icon-resolution scan, which fails loudly if a
 * `COMM_TABS`/`ADMIN_TABS` icon name is ever missing from `ICONS` again.
 */

// ── COMM_TABS — the five renamed/re-scoped tabs (DI-319 §Placement) ────────

export const COMM_TABS = Object.freeze([
  { key: 'week', label: 'Week', icon: 'calendarWeek' },
  { key: 'games', label: 'Games', icon: 'sportFootball' },
  { key: 'players', label: 'Players', icon: 'playersGroup' },
  { key: 'rules', label: 'Rules', icon: 'rulebook' },
  { key: 'scribe', label: 'SCRIBE', icon: 'scribeSpark' },
]);

const COMM_TAB_KEYS = new Set(COMM_TABS.map((t) => t.key));

// ── COMM_CARD_TAB — every existing Commissioner-panel card id → its new tab,
// or 'admin' meaning it leaves the Commissioner panel entirely (DI-319/DI-320
// card-by-card tables, amended 2026-09-25). Source line references are to
// `cfb-pickems/js/app.js` — RE-DERIVED against the live worktree 2026-09-25
// (reviewer fix round 1, finding 7: the first draft's numbers had drifted
// ~114 lines low from other groups' concurrent commits to this shared file).
// `app.js` is SERIALIZED shared territory other threads actively edit — the
// wiring pass re-tagging `data-comm-tab` values should treat these as a
// starting point confirmed at this timestamp, and re-grep before editing if
// meaningful time has passed. ──────────────────────────────────────────────

export const COMM_CARD_TAB = Object.freeze({
  // ── Week (stays) ──
  'week-manager': 'week',                     // app.js:10546
  'commissioner-announcement': 'week',        // app.js:10571
  'week-settings': 'week',                    // app.js:10585 — MINUS the Data Source Mode
                                               // FIELD, extracted to Admin → Week
                                               // ('data-source-mode', a roles.js id).
                                               // The card itself is not removed.
  'weekly-summary-email': 'week',             // app.js:10769
  'tiebreaker': 'week',                       // app.js:10895
  'extra-point': 'week',                      // app.js:17294 (Ischemic Extra Point wrapper;
                                               // title at :17296)
  // ── Week (leaves) ──
  'demo-simulation': 'admin',                 // app.js:10915 — roles.js id, scope:'commissioner'

  // ── Games (stays) ──
  // 'ESPN Data Fetch' (app.js:10733) SPLITS: the one-button fetch action
  // consolidates into a NEW card, 'populate-games' (no prior id — this is
  // DI-319's "simplified" card, not a relocation of an existing id).
  'populate-games': 'games',
  'player-requests': 'games',                 // app.js:15081
  'available-games-pool': 'games',            // app.js:10796 ("Available Games (N from ESPN)")
  'selected-slate': 'games',                  // app.js:10814
  // ── Games (leaves) ──
  'espn-source': 'admin',                     // the URL preview/Copy/Open half of the OLD
                                               // "ESPN Data Fetch" card (app.js:10733) —
                                               // roles.js id, scope:'admin' (read-only display)
  'data-proof': 'admin',                      // app.js:10756 — roles.js id, scope:'admin'

  // ── Players (stays) ──
  'weekly-nicknames': 'players',              // app.js:10968
  'invite-to-league': 'players',              // NEW card (DI-319 §Copy) — no prior id
  'league-members': 'players',                // app.js:11002
  'obligations': 'players',                   // app.js:11073
  // Legacy PIN-mode-only card (`getAuthMode() !== 'supabase'`, app.js:11010)
  // — never renders in production (supabase mode), but IS an existing card
  // id and stays mapped so it is never an untagged/unmapped card (RG-10
  // discipline extended to the legacy path too).
  'players-pins-contact': 'players',
  // ── Players (leaves) ──
  // AMENDMENT 2026-09-25: Account Linking is ADMIN-ONLY. DI-319's ORIGINAL
  // card table listed this on Commissioner → Players ("this league's own
  // status card, unchanged"); the binding amendment supersedes that and
  // removes it from the Commissioner panel entirely.
  'account-linking': 'admin',                 // app.js:10997 — roles.js id, scope:'commissioner'

  // ── Rules (stays, renamed from 'settings') ──
  'league-rules': 'rules',                    // app.js:11138
  // AMENDMENT 2026-09-25: copy renamed "Alma maters & home teams" — same
  // card id, same tab, no placement change.
  'alma-maters': 'rules',                     // app.js:10272

  // ── SCRIBE (stays, renamed/consolidated from 'settings'/'data') ──
  'scribe-participation': 'scribe',           // app.js:15811
  'scribe-heat': 'scribe',                    // app.js:15881
  'scribe-learning-rate': 'scribe',           // app.js:16054
  'chat-scribe': 'scribe',                    // app.js:17367 ("Chat & S.C.R.I.B.E.")
  // ── SCRIBE (leaves) ──
  // AMENDMENT 2026-09-25: SCRIBE Model is placed on the Admin panel (Admin →
  // Settings beside SCRIBE Caps & Limits). The 'admin' below is a TAB value
  // ("relocated to the Admin panel"), NOT a scope. `CARD_OPERABILITY[
  // 'scribe-model']` = { scope: 'commissioner' } (its league_kv write path is
  // commissioner-gated; corrected by reviewer round 2 — see the header).
  'scribe-model': 'admin',                    // app.js:15994

  // ── Old 'settings' tab cards that leave entirely (not Rules, not SCRIBE) ──
  'auto-refresh': 'admin',                    // app.js:11098 — roles.js id, scope:'commissioner'
  'randomize-picks-shortcut': 'admin',        // app.js:11124 — roles.js id, scope:'commissioner'
  'security-settings': 'admin',               // app.js:11189 — roles.js id, scope:'commissioner'

  // ── Old 'data' tab cards, all relocated whole ──
  'export-data': 'admin',                     // app.js:10830 — roles.js id, scope:'admin' (see note)
  'data-management': 'admin',                 // app.js:11234 — roles.js id, scope:'commissioner'
  'chat-retention': 'admin',                  // app.js:11251 — roles.js id, scope:'commissioner'
  'chat-history': 'admin',                    // app.js:11262 — roles.js id, scope:'commissioner'
  'recalculate-finalized-weeks': 'admin',     // app.js:13943 — roles.js id, scope:'commissioner'
  'obligation-corrections': 'admin',          // app.js:13967 — roles.js id, scope:'commissioner'
  'scribe-training': 'admin',                 // app.js:16310 — roles.js id, scope:'commissioner', pilotGated
  'background-jobs': 'admin',                 // app.js:16944 — roles.js id, scope:'admin' (read-only)
  'feedback-bug-reports': 'admin',            // app.js:17222 — roles.js id, scope:'admin' (read half)
});

/**
 * Returns the tab a given Commissioner-panel card id belongs to today
 * ('week'|'games'|'players'|'rules'|'scribe'), or the string 'admin' if the
 * card has left the Commissioner panel for the Admin panel (js/admin-panel.js
 * owns it from there), or `null` for an id this map does not recognize.
 * Deny-by-default in spirit (RG-10): an unmapped id is `null`, never a
 * guessed tab.
 *
 * @param {string} cardId
 * @returns {'week'|'games'|'players'|'rules'|'scribe'|'admin'|null}
 */
export function commTabFor(cardId) {
  return Object.prototype.hasOwnProperty.call(COMM_CARD_TAB, cardId)
    ? COMM_CARD_TAB[cardId]
    : null;
}

// ── renderCommTabBar — string-render, matches the shipped markup shape ─────

/**
 * Renders the five-tab strip exactly matching the markup shape already
 * shipped in `renderCommPage()` (`.comm-tabbar[role=tablist]` >
 * `.comm-tab[data-comm-tab-btn][role=tab][aria-selected]` >
 * `.comm-tab-icon` + `.comm-tab-label`) so the wiring pass can swap the
 * inline `tabs.map(...)` block for a single call to this function without
 * touching the surrounding CSS selectors (`.comm-tabbar`, `.comm-tab`,
 * `.comm-tab.active`, `.comm-tab-icon`, `.comm-tab-label` — all already
 * defined in css/styles.css, none touched by this pass).
 *
 * D-1 (chrome moves to the Munera icon family): each tab's icon is rendered
 * via `icon()`, never emoji — a deliberate change from the emoji this strip
 * used before this input (📅🏈👥⚙️☁️). All five icon names resolve in the
 * shipped `ICONS` map (see this file's header, "ICON NAMES").
 *
 * @param {{ activeTab?: string, icon?: (name: string, opts?: object) => string }} [opts]
 * @returns {string}
 */
export function renderCommTabBar({ activeTab = 'week', icon } = {}) {
  const iconFn = typeof icon === 'function' ? icon : () => '';
  const active = COMM_TAB_KEYS.has(activeTab) ? activeTab : 'week';
  return `
    <div class="comm-tabbar" role="tablist">
      ${COMM_TABS.map((t) => `
        <button type="button" class="comm-tab${active === t.key ? ' active' : ''}"
          data-comm-tab-btn="${t.key}" role="tab" aria-selected="${active === t.key}">
          <span class="comm-tab-icon">${iconFn(t.icon)}</span>
          <span class="comm-tab-label">${t.label}</span>
        </button>
      `).join('')}
    </div>`;
}
