/**
 * js/roles.js — UX Revamp, Group B (Build Wave 1) + Group G (T-35 SUPER ADMIN, DI-344/345,
 * 2026-09-25). Pure role/permission helpers for DI-317 (ADMIN-ROLE, T-10/UN-288/UN-291),
 * DI-318 (PILOT-LEAGUE-FLAG, T-23/UN-293), DI-320 (ADMIN-PANEL, T-12/UN-290/UN-291) and
 * DI-344/345 (SUPER-ADMIN-ROLE/PANEL, T-35/UN-303).
 *
 * NO DOM, NO NETWORK, NO SUPABASE CLIENT. Every function here takes the session/league
 * data it needs as a PARAMETER and returns a plain boolean — this module does not read
 * `js/auth.js`'s in-memory caches and does not call `getSession()`. That is deliberate,
 * not an oversight: `session.isPlatformAdmin`'s own derivation (beside the existing
 * `session.isAdmin` derivation, at `_recomputeSynthesizedSession()`) is a LATER, serialized
 * wiring item on `js/auth.js` (group F's file this wave) — see DI-317 §2b.10. Landing the
 * derivation and the render-path consumers in the SAME file this pass would require an
 * `auth.js` window this build does not have, so the helpers below are written to be
 * trivially correct once that wiring exists: pass `getSession()`'s eventual shape in, get
 * a boolean out, no import required in either direction. `isSuperAdmin`/`isLeaguePaused`
 * (below) are additive to that same discipline — `session.isSuperAdmin` is the same later,
 * serialized `js/auth.js` wiring item, landed at the SAME `_recomputeSynthesizedSession()`
 * chokepoint in the SAME edit as `isPlatformAdmin` (DI-344 §Render paths / §8).
 *
 * ALLOW-LIST (DI-317 §2b.11, enforced by rolestest.mjs's whole-tree scan): the identifier
 * `isPlatformAdmin` may appear, client-side, ONLY in this file, inside
 * `_recomputeSynthesizedSession()` in `js/auth.js`, inside `js/admin-panel.js`, and at the
 * enumerated chrome-gating call sites (bottom-nav Comm icon render, control-center section
 * gates, admin-panel route guard) once those exist. It must NEVER appear inside
 * `canViewOtherPicks()`, `arePicksPublic()`, any `canSeeOthers` local, or either default-param
 * injection site in `js/extra-point.js` (`isCountedExtraPointWeek`, `seasonExtraPointTally`) —
 * every one of those is a picks-visibility surface, and AD-29's "no remaining stake" condition
 * is the only legitimate gate on any of them (DI-317 §Security point 1). This file does not
 * import from or export to any of those functions, and never will.
 *
 * ALLOW-LIST, EXTENDED ONE IDENTIFIER FURTHER (DI-344 §Render paths, "mirrors DI-317
 * §2b.11/F13 exactly"): `isSuperAdmin` may appear, client-side, ONLY in this file, inside
 * `_recomputeSynthesizedSession()` in `js/auth.js`, inside `js/admin-panel.js`, and at the
 * enumerated control-center gating call site. It must NEVER appear inside the same
 * picks-visibility fence named above — `canViewOtherPicks()`, `arePicksPublic()`, any
 * `canSeeOthers` local, or either `js/extra-point.js` injection site — the identical negative
 * constraint DI-317 states for `isPlatformAdmin`, extended one identifier further.
 *
 * REV F19 (preserved): a platform admin is a READ-and-support role, never a client write
 * bypass. Nothing in this file authorizes a write — `isPlatformAdmin()`/`isCommissionerOf()`
 * only answer "should this piece of chrome be visible," the same class of question RG-10's
 * `data-comm-tab` gating already answers for the commissioner panel. The actual write
 * authority for a role change lives entirely server-side, in the two SECURITY DEFINER RPCs
 * this input's SQL draft proposes (`admin_set_member_role`, `admin_set_platform_admin`) —
 * see `weekly bug fixes and feedback/UX Revamp 092426/sql-drafts/B_roles_pilot.sql`.
 *
 * REV F19, ONE TIER UP (DI-344 §Security boundaries point 1): the same discipline governs
 * `isSuperAdmin`. Nothing in this file authorizes a pause/resume or a platform-settings write —
 * `isSuperAdmin()` only answers "should the Super Admin tab/row render." The actual write
 * authority lives entirely server-side, in `super_set_league_status()`/`super_set_platform_kv()`
 * (both SECURITY DEFINER, both first-statement-gated on `is_super_admin()`) — see the same SQL
 * draft, sections 15/16.
 */

// ── isPlatformAdmin ─────────────────────────────────────────────────────────────────────

/**
 * True only when the session carries a confirmed platform-admin flag. Deliberately a STRICT
 * `=== true` comparison, not a truthy check — a session object that has not finished loading
 * (e.g. `{}` mid-hydrate) must read as `false`, never `undefined`-is-truthy-adjacent, because
 * every caller of this function uses it to decide whether to RENDER admin-only chrome at all
 * (DI-317 §States: "Not an admin: every admin-only surface is absent from the DOM, not
 * disabled"). `isAdmin` (commissioner-of-active-league) and `isPlatformAdmin` are two
 * different flags on the same session object and are never merged into one check here or
 * anywhere else (DI-317 §2b.10).
 *
 * @param {{ isPlatformAdmin?: boolean } | null | undefined} session
 * @returns {boolean}
 */
export function isPlatformAdmin(session) {
  return !!(session && session.isPlatformAdmin === true);
}

// ── isSuperAdmin ────────────────────────────────────────────────────────────────────────

/**
 * True only when the session carries a confirmed super-admin flag (DI-344 §3.2/§Every state —
 * "isSuperAdmin strictly checks is_super, isPlatformAdmin alone is not sufficient"). Same
 * strict `=== true` comparison as `isPlatformAdmin` above, and the same reason: a session
 * object that has not finished loading must read as `false`, never truthy-by-accident, because
 * every caller uses this to decide whether to RENDER super-admin-only chrome at all (DI-345
 * §Every state: "the tab does not exist in the rendered tab list at all — same 'absent, not
 * disabled' rule DI-320 itself established").
 *
 * Deliberately does NOT fall back to `isPlatformAdmin(session)` — a regular platform admin
 * (DI-317's tier) must never see Super Admin chrome. `isPlatformAdmin` and `isSuperAdmin` are
 * two different flags on the same session object, exactly as `isAdmin`/`isPlatformAdmin` are
 * (DI-317 §2b.10), even though every super admin is ALSO a platform admin server-side
 * (`is_super_admin()`'s own construction, B_roles_pilot.sql section 14) — that implication is
 * enforced by the seed data (one row, both flags true), not by this function merging the two
 * checks. A session that somehow carried `isSuperAdmin: true` without `isPlatformAdmin: true`
 * would be a `_recomputeSynthesizedSession()` bug elsewhere, not something this function should
 * paper over by inferring one flag from the other.
 *
 * @param {{ isSuperAdmin?: boolean } | null | undefined} session
 * @returns {boolean}
 */
export function isSuperAdmin(session) {
  return !!(session && session.isSuperAdmin === true);
}

// ── isCommissionerOf ────────────────────────────────────────────────────────────────────

/**
 * True when the session is a COMMISSIONER of the named league specifically — not merely "is
 * a commissioner of the currently active league," because DI-320's Admin panel lets a
 * platform admin switch a league selector to view/operate a league that is NOT their active
 * one (§Layout, "League selector at the top of Week/Games tabs"), and a card must render
 * present/absent based on commissionership of THAT league, not whichever league happens to
 * be active on the device.
 *
 * Two session shapes are accepted, in order of preference:
 *   1. A richer, multi-league shape carrying `session.memberships` — an array of
 *      `{ leagueId, role, active }` rows (the shape a cross-league surface like the Admin
 *      panel needs). If the named league has a membership row here, ITS role/active decide
 *      the answer and nothing else is consulted.
 *   2. Today's single-league `js/auth.js` session shape — `{ isAdmin, activeLeagueId }` —
 *      used as a fallback only when shape 1 has no opinion about this league (either
 *      `memberships` was not supplied at all, or it was supplied but has no row for this
 *      league — e.g., an admin who is not a member of the league they are viewing). This is
 *      what lets `admin_set_member_role`'s client-side pre-check (DI-317 §States,
 *      "courtesy only") work unmodified once `js/auth.js` starts passing its existing
 *      session straight through.
 *
 * A missing/false `active` on a matched membership row reads as NOT commissioner — a
 * deactivated commissioner row must not grant this chrome, mirroring `is_commissioner()`'s
 * own `and m.active` conjunct server-side (`0002_rls.sql:57-61`).
 *
 * @param {{ isAdmin?: boolean, activeLeagueId?: string|null,
 *           memberships?: Array<{ leagueId: string, role: string, active?: boolean }> } | null | undefined} session
 * @param {string | null | undefined} leagueId
 * @returns {boolean}
 */
export function isCommissionerOf(session, leagueId) {
  if (!session || !leagueId) return false;

  if (Array.isArray(session.memberships)) {
    const row = session.memberships.find((m) => m && m.leagueId === leagueId);
    if (row) return row.role === 'commissioner' && row.active !== false;
  }

  return session.isAdmin === true && session.activeLeagueId === leagueId;
}

// ── isPilotLeague ───────────────────────────────────────────────────────────────────────

/**
 * Reads `leagues.pilot` off an already-fetched league record — no extra round trip
 * (DI-318 §Client gate). Pure and defensive: a league record that hasn't loaded yet, or an
 * old cached record from before the column existed (default-when-missing story, CONVENTIONS
 * #10), both read as `false` — the same "absent, not a dimmed/empty variant" rule DI-318
 * gives the badge itself.
 *
 * @param {{ pilot?: boolean } | null | undefined} league
 * @returns {boolean}
 */
export function isPilotLeague(league) {
  return !!(league && league.pilot === true);
}

// ── isLeaguePaused ──────────────────────────────────────────────────────────────────────

/**
 * Reads `leagues.status` off an already-fetched league record — no extra round trip, same
 * pattern as `isPilotLeague` above (DI-344 §Render paths: "the ONE function every paused-state
 * render checks — the banner on each of the six nav destinations, and the disabled state on
 * the pick buttons/submit controls/message composer — never independently re-reading
 * `league.status` in more than one place," CONVENTIONS #21). Pure and defensive: a league
 * record that hasn't loaded yet, or an old cached record from before the column existed
 * (default-when-missing story, CONVENTIONS #10 — `gameMultiplier(game)`'s own pattern), both
 * read as `false` (not paused) — an absent `status` column defaults to `'active'` server-side
 * (`alter table ... add column ... default 'active'`), and a client that has not hydrated the
 * new field yet must agree with that default, never guess the more alarming state.
 *
 * This is a COURTESY check only, never the authority — every write surface it gates is ALSO
 * refused server-side (RLS conjuncts on nine tables + `auto_go_live()`'s own status read,
 * B_roles_pilot.sql sections 19/20). A stale client that has not yet learned a league was
 * paused must fail LOUD at the server, not silently succeed because this function said "false"
 * a moment too early — that is why every gated write path also needs the server-side row-count
 * check named in DI-344 §R-4, which this function does not and cannot perform.
 *
 * @param {{ status?: string } | null | undefined} league
 * @returns {boolean}
 */
export function isLeaguePaused(league) {
  return !!(league && league.status === 'paused');
}

/**
 * DI-344/345 §Copy — the ONE paused-league sentence, reused verbatim
 * everywhere it appears (the six nav-destination banners, the disabled
 * pick-submit/composer captions). REVIEWER NOTE 8 (2026-09-25): this used
 * to be declared twice — once here-equivalent in `js/app.js`, and again as
 * a second literal inside `js/chat-ui.js`'s `renderChatPage()` — the exact
 * CONVENTIONS #21 failure mode this module exists to prevent. One source
 * now; both call sites import it.
 */
export const PAUSED_LEAGUE_BANNER_TEXT =
  'This league is paused by the platform. Picks and chat are read-only until it resumes.';

// ── canOperateCard ──────────────────────────────────────────────────────────────────────

/**
 * DI-320 §Per-card operability — one row per Admin-panel card, encoded exactly as that
 * table states it. `scope`:
 *   - 'commissioner' — visible only to a session that commissions THIS league
 *     (`isCommissionerOf`). Absent, not disabled, for an admin viewing a league he does not
 *     commission (DI-320 §States).
 *   - 'admin'         — visible to ANY platform admin, regardless of commissionership of
 *     this league (the admin-operable rows: read-only display cards, and the two genuinely
 *     cross-league write cards whose own RPCs re-check `is_platform_admin()` server-side).
 * `pilotGated: true` additionally requires `isPilotLeague(league)` — today only SCRIBE
 * Training (DI-320's card-by-card table: "Commissioner-operable, AND pilot-gated").
 *
 * Two rows carry a NOTE, not a behavior change, because `canOperateCard` only answers
 * "does this card render at all" — the finer split some rows have between "which of this
 * card's own controls a session may use" is a different, per-action question the DI leaves
 * to the card's own render function, not to this helper:
 *   - 'export-data' is 'admin'-scoped (the card itself always renders for any admin); the
 *     picks/tiebreaker/Extra-Point EXPORT SCOPE inside it additionally needs a membership
 *     check DI-320 §Per-card operability states separately ("Export Data — the loud-refusal
 *     requirement") and this helper does not perform.
 *   - 'feedback-bug-reports' is 'admin'-scoped (read renders for any admin); STATUS CHANGES
 *     inside it are commissioner-operable only, per that same table row — a distinction the
 *     card's own action buttons must apply, not this helper.
 *
 * An unmapped `cardId` returns `false` — deny-by-default (RG-10's own rule extended to this
 * new panel from day one): there is nothing here for a card this table does not name, and a
 * future card must be added to `CARD_OPERABILITY` explicitly before it can render, never by
 * falling through to "true."
 *
 * @param {string} cardId
 * @param {Parameters<typeof isCommissionerOf>[0]} session
 * @param {{ id?: string, pilot?: boolean } | null | undefined} league
 * @returns {boolean}
 */
export const CARD_OPERABILITY = Object.freeze({
  // Week
  'data-source-mode':           { scope: 'commissioner' },
  'demo-simulation':             { scope: 'commissioner' },
  // Games
  'espn-source':                  { scope: 'admin' },        // read-only display
  'data-proof':                    { scope: 'admin' },        // read-only display
  // Players
  'account-linking':                { scope: 'commissioner' },
  'users-across-leagues':            { scope: 'admin' },
  'platform-admins':                  { scope: 'admin' },
  // Settings
  'auto-refresh':                       { scope: 'commissioner' },
  'randomize-picks-shortcut':            { scope: 'commissioner' },
  'security-settings':                    { scope: 'commissioner' },
  // SCRIBE Caps & Limits — named limitation (DI-320): no admin-scoped write RPC exists this
  // release; it only works today because Drew is also IRB's commissioner. Encoded as
  // 'commissioner', matching the table's own text, not silently upgraded to 'admin'.
  'scribe-caps-limits':                     { scope: 'commissioner' },
  // SCRIBE Model — 'commissioner', because that is what the WRITE PATH is.
  // `setScribeModel()` (js/app.js) calls `saveSetting('scribe', …)`
  // → js/storage.js `saveSetting` → `save(KEYS.SETTINGS, …)` → the `league_kv`
  // settings blob, whose RLS write policies are `is_commissioner(league_id)`-gated
  // (supabase/migrations/0002_rls.sql, `league_kv_insert` / `league_kv_update`).
  // That is the IDENTICAL path DI-320's operability table marks
  // COMMISSIONER-operable for Auto-Refresh, Randomize Picks, Security & Settings
  // and SCRIBE Caps & Limits — so this row reads the same way they do.
  //
  // PLACEMENT ≠ OPERABILITY. The 2026-09-25 amendment (item 2) moved this card
  // OUT of Comm → SCRIBE and INTO the Admin panel; that is `ADMIN_CARD_TAB`
  // ('scribe-model': 'settings', js/admin-panel.js), and it is correct. It did
  // not change who may WRITE it. 'account-linking' above is the exact precedent
  // in this very table: Admin-panel placement, `{ scope: 'commissioner' }`.
  //
  // Scoped 'admin' here, an admin who does not commission this league would SEE
  // the card and have his write silently refused by RLS — DI-320 §3's named fail
  // condition. Making this genuinely admin-operable needs a SECURITY DEFINER RPC
  // that re-checks `is_platform_admin()` server-side; none exists this release
  // (roadmap item, beside SCRIBE Caps & Limits' identical named limitation).
  //
  // Record: the 'admin' scope shipped in fix round 1 came from the COORDINATOR's
  // fix-round instruction ("admin-operable"), 2026-09-25 — not from the reviewer,
  // which the round-1 comments here and in js/admin-panel.js misattributed.
  // Corrected by reviewer round 2, 2026-09-25.
  'scribe-model':                            { scope: 'commissioner' },
  'pilot-league-flag':                       { scope: 'admin' },        // read-only display
  // Data
  'export-data':                               { scope: 'admin' },     // see note above
  'data-management':                             { scope: 'commissioner' },
  'chat-retention':                                { scope: 'commissioner' },
  'chat-history':                                    { scope: 'commissioner' },
  'recalculate-finalized-weeks':                       { scope: 'commissioner' },
  'obligation-corrections':                              { scope: 'commissioner' },
  'scribe-training':                                       { scope: 'commissioner', pilotGated: true },
  'background-jobs':                                         { scope: 'admin' },     // read-only display
  'feedback-bug-reports':                                      { scope: 'admin' },   // see note above
});

export function canOperateCard(cardId, session, league) {
  const rule = CARD_OPERABILITY[cardId];
  if (!rule) return false;

  // REVIEW ROUND 1, SHOULD-FIX (6) — `pilotGated` is checked BEFORE the scope branch, not
  // inside the 'commissioner' branch only. The prior order checked it only after
  // `rule.scope === 'commissioner'` had already been handled, which meant a hypothetical
  // FUTURE 'admin'-scoped row with `pilotGated: true` would hit the early `if (rule.scope ===
  // 'admin') return isPlatformAdmin(session);` line above and return true for ANY admin,
  // regardless of the league's pilot status — the check would never run at all for that scope.
  // No row in CARD_OPERABILITY is admin-scoped-and-pilot-gated today (the one pilot-gated row,
  // scribe-training, is 'commissioner'), so this was not yet reachable in practice — but the
  // ordering was a fail-OPEN trap for the next card added to the table, not a fail-closed one,
  // and a permission function's failure direction is not something to leave to which scope
  // happens to be checked first. Hoisted here so it applies uniformly regardless of `scope`.
  if (rule.pilotGated && !isPilotLeague(league)) return false;

  if (rule.scope === 'admin') return isPlatformAdmin(session);

  if (rule.scope === 'commissioner') {
    const leagueId = league && league.id != null ? league.id : null;
    return isCommissionerOf(session, leagueId);
  }

  // Deny-by-default for any `scope` value this module does not recognize — a typo in a
  // future CARD_OPERABILITY entry fails closed, not open.
  return false;
}
