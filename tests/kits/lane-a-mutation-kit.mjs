/**
 * lane-a-mutation-kit.mjs - the Deployment 1 Lane A (creation + integrity) mutation kit, committed and re-runnable (S-3, Drew D-69).
 * =====================================================================================================================================
 * WHAT IT IS. Every mutant below is one exact text edit to ONE file, run against the suite that must catch it, in a THROWAWAY COPY of the tree (os.tmpdir(); the real files are never opened for
 * writing). A mutant is KILLED when the suite exits non-zero AND an assertion line whose text matches the named RED pattern is among the failures. A mutant that survives, or that dies on some
 * OTHER assertion, fails the kit. Before any mutant runs, every distinct suite is run UNMUTATED in the copy and must be green (so a red later is the edit, not the environment).
 *
 * WHAT IT COVERS (the rest of the lane's mutants are already committed INSIDE their suites and need no kit file):
 *   - in xsstest.mjs [9a-2] (W-22): 8 classifier mutants + 4 clean controls (SB24_MUTANTS / SB24_CLEAN);   - in xsstest.mjs [18]: the census canaries;
 *   - in supabase/tests/pglite*.check.mjs: `--mutate=<name>` / `--noproof` matrices (0047: 7, 0048: 26 incl. G5 and F3, 0049/0050: 12, 0057: 12 incl. the RLS-flag and write-policy ones, repair: 8), run by hand with PGLITE_DIR set;
 *   - on feat/d1-nfl-main, in createdleaguetest.mjs [6]: 5 in-memory mutants of js/app.js.
 *   THIS FILE carries the ones that edit the real source files from outside the suite: cssId() and the selector census (xsstest [18]), the two W-22 classifier fixes, the DI-550 door and copy,
 *   the DI-542 sentence, the "0047...0057 /" static.check pins, and (2026-10-08, the security round) the account-delete / 0048 / 0057 / repair-file pins. The `--mutate=<name>` matrices of pglite0048 / pglite0057 / pglite_repair need PGLITE_DIR and are run by hand.
 *
 * RUN:  node tests/kits/lane-a-mutation-kit.mjs            all groups (about 15 minutes)
 *       node tests/kits/lane-a-mutation-kit.mjs css        one group: css | w22 | door | leave | static
 *       node tests/kits/lane-a-mutation-kit.mjs --list     print the table
 *       The tree under test is COMMITTED HEAD (git archive), never the working tree; --worktree opts into the working tree for developing a new row and says so.
 *       node tests/kits/lane-a-mutation-kit.mjs --only=<id>[,<id>]   re-run single rows by id (e.g. --only=deadline-alias-read-ignored)
 * Run from cfb-pickems/ (or anywhere). Exit 0 only if every selected mutant was killed by its NAMED assertion and every baseline was green.
 *
 * THE RED OUTPUT, NAMED: each row's `red` is a fragment of the assertion text that goes red; it is printed beside the observed failing line, so the log is the evidence.
 */
import { cpSync, mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');   // the repo root (cfb-pickems/tests/kits -> root)
const M = 'cfb-pickems/supabase/migrations/';
const SD = 'weekly bug fixes and feedback/UX Revamp 092426/sql-drafts/';

// [group, id, file (repo-root relative), from, to, [[suite, red-fragment], ...]]   `to === null` drops the file's first line.
// A mutant that needs edits in SEVERAL files (a property guarded by two layers) gives `file` as an array of [file, from, to] triples and `from`/`to` as null.
const SUITES = { x: 'xsstest.mjs', lc: 'leaguecreatetest.mjs', au: 'authtest.mjs', ls: 'leaguesettingstest.mjs', lu: 'leaguesettingsuitest.mjs', st: 'supabase/tests/static.check.mjs',
  fc: 'supabase/tests/functions.check.mjs', ad: 'supabase/tests/functions/accountDelete.twin.mjs' };
const MUTANTS = [
  // ── css: cssId() and the selector census (DI-541 / DI-548 #1; xsstest [18]) ──
  ['css', 'site1-live-status', 'cfb-pickems/js/app.js', 'cssId(game.gameId)', 'game.gameId', [['x', '[18b] site 1']]],
  ['css', 'site2-pick-buttons', 'cfb-pickems/js/app.js', '.pick-btn[data-game-id="${cssId(gid)}"]', '.pick-btn[data-game-id="${gid}"]', [['x', '[18b] site 2']]],
  ['css', 'site3-comment-bubbles', 'cfb-pickems/js/app.js', '[data-comment-game="${cssId(gameId)}"]', '[data-comment-game="${gameId}"]', [['x', '[18b] site 3']]],
  ['css', 'site4-reaction-strip', 'cfb-pickems/js/app.js', '[data-reaction-strip="${cssId(stripKey)}"]', '[data-reaction-strip="${stripKey}"]', [['x', '[18b] site 4']]],
  ['css', 'chat-closest', 'cfb-pickems/js/chat-ui.js', '.chat-msg[data-mid="${cssId(_revealedMsgId)}"]`)) return', '.chat-msg[data-mid="${_revealedMsgId}"]`)) return', [['x', '[18c] CENSUS']]],
  ['css', 'chat-jump', 'cfb-pickems/js/chat-ui.js', 'c.querySelector(`[data-mid="${cssId(b.dataset.jump)}"]`)', 'c.querySelector(`[data-mid="${b.dataset.jump}"]`)', [['x', '[18c] CENSUS']]],
  ['css', 'twin-drift', 'cfb-pickems/js/chat-ui.js', 'return s.replace(/[\\u0000-\\u001f\\u007f"\\\\]/g', 'return s.replace(/[\\u0000-\\u001f"\\\\]/g', [['x', '[18a] chat-ui.js carries a byte-identical twin']]],
  ['css', 'fallback-keeps-quote', 'cfb-pickems/js/app.js', "/[\\u0000-\\u001f\\u007f\"\\\\]/g, c => (c === '\"' || c === '\\\\')", "/[\\u0000-\\u001f\\u007f\\\\]/g, c => (c === '\"' || c === '\\\\')", [['x', '[18a] without CSS.escape']]],
  // ── w22: the two classifier fixes themselves (the mutated file is xsstest.mjs; its OWN canaries must go red) ──
  ['w22', 'plus-equals-regex-reverted', 'cfb-pickems/xsstest.mjs', '${name}\\\\s*(?:\\\\|\\\\||&&|\\\\?\\\\?|\\\\+)?=(?![=>])', '${name}\\\\s*=(?![=>])', [['x', 'W-22 `+=` gap']]],
  ['w22', 'block-scope-gate-reverted', 'cfb-pickems/xsstest.mjs', 'if (a.length && declaresHere(mod, name, sc)) return', 'if (a.length) return', [['x', 'W-22 block-scope gap']]],
  // ── door: DI-550 (who may create) ──
  ['door', 'door-ignores-scope', 'cfb-pickems/js/app.js', "return getCachedLeagueCreationScope() === 'everyone' || getIsSuperAdmin() === true;", 'return true;', [['lc', '[10ah]'], ['au', '[80ab3]']]],
  ['door', 'door-uses-platform-admin', 'cfb-pickems/js/app.js', "return getCachedLeagueCreationScope() === 'everyone' || getIsSuperAdmin() === true;", "return getCachedLeagueCreationScope() === 'everyone' || getIsPlatformAdmin() === true;", [['lc', '[10ah]'], ['au', '[80ab4]']]],
  ['door', 'scope-missing-reads-everyone', 'cfb-pickems/js/auth.js', "leagueCreationScope: scopeRaw === 'everyone' ? 'everyone' : 'admins',", "leagueCreationScope: scopeRaw === 'admins' ? 'admins' : 'everyone',", [['au', '[80ab2]']]],
  ['door', 'claim-table-no-rejoin-limit', 'cfb-pickems/js/app.js', "  // D1 Lane A (2026-10-08, DI-548 #10) - link_member counts toward the same re-entry bound as join_league; the same line, no number.\n  ['rejoin_limit',      LC.LC_COPY.rejoinLimit],\n", '', [['lc', '[10ak]'], ['au', '[80bb12]']]],
  // G2a / G2c (2026-10-08): the entry pressed through the REAL dispatcher, and rejoin_limit pressed through the join button (authtest [80bb4]-[80bb14]).
  ['door', 'stale-entry-guard-removed', 'cfb-pickems/js/app.js', "    if (!leagueCreationAvailable()) { showComingSoonToast(LC.LC_COPY.landingClosed); return; }\n", '', [['au', '[80bb6]']]],
  // (the suite stops at [80ac] for this one: a null sheet there is a TypeError, so [80ac] is the only RED line the run can name)
  ['door', 'dispatcher-never-opens-the-sheet', 'cfb-pickems/js/app.js', "try { el.closest?.('.modal-overlay')?.remove(); } catch { /* courtesy */ }\n    openLeagueCreateSheet();", "try { el.closest?.('.modal-overlay')?.remove(); } catch { /* courtesy */ }", [['au', '[80ac]']]],
  // the property [80bb5] adds over [80ac]: the SUPER admin under scope "admins" gets the sheet (a guard that only knew scope "everyone" passes [80ac] and fails here)
  ['door', 'sheet-guard-ignores-super-admin', 'cfb-pickems/js/app.js', "    if (!leagueCreationAvailable()) { showComingSoonToast(LC.LC_COPY.landingClosed); return; }\n", "    if (getCachedLeagueCreationScope() !== 'everyone') { showComingSoonToast(LC.LC_COPY.landingClosed); return; }\n", [['au', '[80bb5]']]],
  // G3 (2026-10-08): the flag-landing repaint, armed by a real identity change (authtest [80bb15]-[80bb18])
  ['door', 'flag-landing-repaint-removed', 'cfb-pickems/js/app.js', "        if (getIsSuperAdmin() === true && leagueCreationAvailable() && needsLeagueFlowScreen()) _repaintMaintenanceBannerSurface();\n", '', [['au', '[80bb17]'], ['lc', '[10aj]']]],
  ['door', 'join-table-no-rejoin-limit', 'cfb-pickems/js/app.js', "  ['rejoin_limit',      LC.LC_COPY.rejoinLimit],\n];\nconst LEAGUE_CONNECTIVITY_COPY", "];\nconst LEAGUE_CONNECTIVITY_COPY", [['au', '[80bb9]'], ['lc', '[10ak]']]],
  // F-1 (reviewer BLOCK, 2026-10-08): joining is untouched by who may create - the invite surface is behind the release gate ONLY; Create is behind the door (authtest [80a2i]-[80a2r], leaguecreatetest [10af]/[10ag]/[10ai])
  ['door', 'invite-surface-behind-the-door', 'cfb-pickems/js/app.js', "if (!getCachedLeagueCreationOpen()) return claimCodeScreenHTML();", "if (!leagueCreationAvailable()) return claimCodeScreenHTML();", [['au', '[80a2l]'], ['lc', '[10af]']]],
  ['door', 'create-choice-for-everyone', 'cfb-pickems/js/app.js', "const createChoice = (_linkFlow.state === 'unmatched' && leagueCreationAvailable())", "const createChoice = (_linkFlow.state === 'unmatched')", [['au', '[80a2m]'], ['lc', '[10ag]']]],
  ['door', 'invite-surface-ignores-the-release-gate', 'cfb-pickems/js/app.js', "if (!getCachedLeagueCreationOpen()) return claimCodeScreenHTML();", "if (false) return claimCodeScreenHTML();", [['au', '[80a2c]']]],
  // review (2026-10-08): the Super Admin card recognises BOTH 0049 markers (authtest [80bx4b]-[80bx4d])
  ['door', 'card-ignores-nonpilot-marker', 'cfb-pickems/js/admin-panel.js', "kv.pushAliasModeLive === true || kv.pushNonpilotAliasOnly === true", "kv.pushAliasModeLive === true", [['au', '[80bx4b]']]],
  ['door', 'kv-read-drops-nonpilot', 'cfb-pickems/js/auth.js', "pushNonpilotAliasOnly: nonpilotRaw === true,", "pushNonpilotAliasOnly: false,", [['au', '[80bx4d]']]],
  ['door', 'kv-nonpilot-truthy', 'cfb-pickems/js/auth.js', "pushNonpilotAliasOnly: nonpilotRaw === true,", "pushNonpilotAliasOnly: !!nonpilotRaw,", [['au', '[80bx4d]']]],
  // review follow-up (2026-10-08): the claim screen repaints when the gate / the super-admin flag lands after its first paint, carrying the typed code and the focus (authtest [80a4a]-[80a4m])
  ['door', 'claim-repaint-removed', 'cfb-pickems/js/app.js', "  if (flow === 'claim') { repaintClaimScreen(tab); return; }", "  if (flow === 'claim') return;", [['au', '[80a4b]']]],
  ['door', 'claim-repaint-drops-typed-code', 'cfb-pickems/js/app.js', "  restoreDirtyFields(snap, c, currentIdentityKey());\n  if (focusId) {", "  if (focusId) {", [['au', '[80a4c]']]],
  ['door', 'claim-repaint-drops-focus', 'cfb-pickems/js/app.js', "    if (f && !f.disabled && document.activeElement !== f) { try { f.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ } }\n", "", [['au', '[80a4e]']]],
  ['door', 'claim-repaint-grants-focus', 'cfb-pickems/js/app.js', "  if (focusId) {\n    const f = c.querySelector(focusId === 'link-claim-code' ? '#link-claim-code' : '#league-join-code');", "  {\n    const f = c.querySelector('#link-claim-code');", [['au', '[80a4f]']]],
  ['door', 'claim-repaint-snatches-the-typist', 'cfb-pickems/js/app.js', "if (typingClaim && !_claimScreenTouched) {", "if (false) {", [['au', '[80a4g]']]],
  ['door', 'claim-repaint-always-rewrites', 'cfb-pickems/js/app.js', "  if (fresh === _claimPaintedHTML) return;\n", "", [['au', '[80a4k]']]],
  // P-2 (coordinator 2026-10-08): the BOOT CHAIN that repaints the claim screen when the platform_kv answer lands after first paint. authtest [56b] drives a real cold load (applyAuthModeDecision, SDK injected) and
  // never calls the test hook, so this row (app.js: the .then after refreshMaintenanceBannerCache() in applyAuthModeDecision) must turn 56b-3 red.
  ['door', 'boot-chain-does-not-repaint', 'cfb-pickems/js/app.js', ".then(() => _repaintMaintenanceBannerSurface())", ".then(() => {})", [['au', '56b-3']]],
  ['door', 'confirm-card-repainted', 'cfb-pickems/js/app.js', "  if (flow === 'confirm') return;   // DI-183b's confirmation card carries no banner slot (and is a one-time card: never repainted from here)\n", "", [['au', '[80a4m]']]],
  ['door', 'reducer-drops-reason', 'cfb-pickems/js/league-create.js', "pausedReason: a.reason === 'admins_only' ? 'admins_only' : null", 'pausedReason: null', [['lc', '[4e4]'], ['au', '[80bb3]']]],
  // G2b (2026-10-08): the two refusals added by 0049/0050, through the real sheet (authtest [80bb]).
  ['door', 'classifier-drops-admins-only', 'cfb-pickems/js/league-create.js', "if (/creation_admins_only/.test(raw)) return 'admins_only';", "if (/creation_admins_onlyX/.test(raw)) return 'admins_only';", [['au', '[80bb2] an admins-only refusal']]],
  ['door', 'classifier-drops-push-not-ready', 'cfb-pickems/js/league-create.js', '/creation_closed|signups_closed|push_not_ready/.test(raw)', '/creation_closed|signups_closed/.test(raw)', [['au', '[80bb] the release gate not yet ready']]],
  ['door', 'banner-ignores-admins-reason', 'cfb-pickems/js/league-create.js', "state.pausedReason === 'admins_only' ? LC_COPY.adminsOnly : LC_COPY.paused", 'LC_COPY.paused', [['au', '[80bb2] an admins-only refusal']]],
  // ── leave: DI-542 (the two-sport Leave sentence) ──
  ['leave', 'sentence-ignores-sports', 'cfb-pickems/js/league-settings.js', '(Number(sports) >= 2 ? LS_COPY.weekWaitSports : (Number(n) > 1', '(false ? LS_COPY.weekWaitSports : (Number(n) > 1', [['ls', '[8m2]'], ['lu', '[1w2]']]],
  ['leave', 'count-reads-every-picker', 'cfb-pickems/js/league-settings.js', "for (const p of picks) if (p && p.playerId === memberId && p.weekId != null) own.add(p.weekId);\n  const out = new Set();", "for (const p of picks) if (p && p.weekId != null) own.add(p.weekId);\n  const out = new Set();", [['ls', '[8m5]']]],
  // G1 (2026-10-08, the coordinator's gap list): the app-level case - two sports, own picks, #ls-leave-reason, tap the dimmed row. Found that a client week carries no .sport, so DI-542 never rendered.
  ['leave', 'app-forgets-sportof', 'cfb-pickems/js/app.js', 'memberId: me, sportOf: (w) => competitionForWeek(w)?.sport })', 'memberId: me })', [['lu', '[4e-6]']]],
  // G1, [4e-8]: the blind rule has TWO layers (app.js asks getPicks for the leaver's own picks; enteredSportCount filters on playerId again), so a single-layer edit survives by design. Both removed -> red.
  ['leave', 'both-layers-count-every-picker', [['cfb-pickems/js/app.js', 'weeks: getWeeks(), picks: getPicks(null, me), memberId: me, sportOf', 'weeks: getWeeks(), picks: getPicks(null), memberId: me, sportOf'], ['cfb-pickems/js/league-settings.js', "for (const p of picks) if (p && p.playerId === memberId && p.weekId != null) own.add(p.weekId);\n  const out = new Set();", "for (const p of picks) if (p && p.weekId != null) own.add(p.weekId);\n  const out = new Set();"]], null, null, [['lu', '[4e-8]']]],
  // ── static: the "0047…0057 /" pins (DI-545 / 546 / 548) ──
  ['static', '0047-slash-in-one-check', M + '0047_id_shape_checks.sql', "alter table public.games add constraint games_id_shape_check check (id ~ '^[A-Za-z0-9_.:-]{1,80}$') not valid;", "alter table public.games add constraint games_id_shape_check check (id ~ '^[A-Za-z0-9_.:/-]{1,80}$') not valid;", [['st', '0047 — both id CHECKs carry the ONE pattern']]],
  ['static', '0048-scrub-two-keys', M + '0048_join_bound_and_scrub.sql', "after  = after  - array['email', 'phone', 'user_id']", "after  = after  - array['email', 'phone']", [['st', 'audit_scrub_member (A12 + security F1)']]],
  ['static', '0048-join-forgets-ledger', M + '0048_join_bound_and_scrub.sql', "  perform public.reentry_register(v_league.id, 'join');\n", '', [['st', 'the four callers each register or scrub exactly once'], ['st', 'CENSUS (DI-548 row 10)']]],
  ['static', '0048-bound-four', M + '0048_join_bound_and_scrub.sql', 'c_max constant integer := 3;', 'c_max constant integer := 4;', [['st', 'reentry_register: definer']]],
  ['static', '0048-ledger-policy', M + '0048_join_bound_and_scrub.sql', 'alter table public.league_reentry_ledger force row level security;', 'alter table public.league_reentry_ledger force row level security;\ncreate policy lr_all on public.league_reentry_ledger for all to authenticated using (true);', [['st', 'the re-entry LEDGER is append-only']]],
  ['static', '0049-marker-settable', M + '0049_push_readiness_marker.sql', "'scribe_class_caps_usd','scribe_search') then raise exception 'bad_key'; end if;", "'scribe_class_caps_usd','scribe_search','push_alias_mode_live') then raise exception 'bad_key'; end if;", [['st', 'SB-11 / 0036']]],
  ['static', '0049-push-not-ready-renamed', M + '0049_push_readiness_marker.sql', "raise exception 'push_not_ready';", "raise exception 'push_not_ready_x';", [['st', 'R13 — every redefinition']]],
  ['static', '0050-platform-admin', M + '0050_creation_scope.sql', 'and not coalesce(public.is_super_admin(), false) then', 'and not coalesce(public.is_platform_admin(), false) then', [['st', 'R13 — every redefinition']]],
  ['static', '0050-missing-reads-everyone', M + '0050_creation_scope.sql', "'admins') <> 'everyone'", "'everyone') <> 'everyone'", [['st', 'R13 — every redefinition']]],
  ['static', '0057-canary-writes', M + '0057_drift_canary.sql', "  select string_agg(s.object, ', ' order by s.object) into v_drift", "  update public.job_runs set ok = true where false;\n  select string_agg(s.object, ', ' order by s.object) into v_drift", [['st', '0057 — THE ONLY WRITES']]],
  ['static', '0057-service-role-can-execute', M + '0057_drift_canary.sql', 'revoke all on function public.drift_canary() from public, anon, authenticated, service_role;', 'revoke all on function public.drift_canary() from public, anon, authenticated;', [['st', '0057 — both functions are definers']]],
  ['static', '0057-wrong-literal', M + '0057_drift_canary.sql', "('fn:pick_window_open',              '1ea506dafa44b06a3fc5de6adcd86f85')", "('fn:pick_window_open',              '2ea506dafa44b06a3fc5de6adcd86f85')", [['st', 'the two FUNCTION literals'], ['st', 'THE CENSUS (DI-545)']]],
  ['static', '0057-stale-census', M + '0057_drift_canary.sql', '0002:create:picks_select:082e6767ced015f49cd8dc7f7928ef66', '0002:create:picks_select:182e6767ced015f49cd8dc7f7928ef66', [['st', 'THE CENSUS (DI-545)']]],
  ['static', 'runbook-psql-without-1', 'docs/SUPABASE_LIVE_RUNBOOK.md', 'psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -1 -f mutations/blind_rule_drop.sql', 'psql "$DEV_DATABASE_URL" -v ON_ERROR_STOP=1 -f mutations/blind_rule_drop.sql', [['st', 'DI-545 F2 — EVERY documented psql invocation']]],
  ['static', 'repair-policy-text', 'cfb-pickems/supabase/repair/live_repair_blind_rule_and_lock.sql', 'create policy picks_select on public.picks for select to authenticated\n  using (is_member(league_id)', 'create policy picks_select on public.picks for select to authenticated\n  using (true or is_member(league_id)', [['st', 'DI-545 F3 + security F1 — the TWELVE canonical policies']]],
  // the repair as it was before security F1: it dropped only SELECT-applicable policies, so a loosened WRITE policy survived it
  ['static', 'repair-misses-all', 'cfb-pickems/supabase/repair/live_repair_blind_rule_and_lock.sql', "where p.schemaname = 'public' and p.tablename in ('picks', 'tiebreaker_guesses', 'extra_point_guesses') loop", "where p.schemaname = 'public' and p.tablename in ('picks', 'tiebreaker_guesses', 'extra_point_guesses') and p.cmd in ('SELECT', 'ALL') loop", [['st', 'DI-545 F3 + security F1 — the TWELVE canonical policies']]],
  ['static', 'repair-no-proof', 'cfb-pickems/supabase/repair/live_repair_blind_rule_and_lock.sql', 'where s.live_md5 is distinct from s.expected_md5;', 'where false;', [['st', 'DI-545 F3 + security F1 — PART 0 refuses by name']]],
  // ── security F1 / F1b / F2 / F3 / G5 and the rollback note (2026-10-08, the coordinator's security round on da03f6c7). The PGlite matrices for these (pglite0048 / 0057 / _repair, --mutate=<name> with and without --noproof) need PGLITE_DIR and run by hand; these are the ones the offline static + twin suites must catch.
  ['static', 'repair-no-rls-step', 'cfb-pickems/supabase/repair/live_repair_blind_rule_and_lock.sql', "alter table public.tiebreaker_guesses force row level security;\n", '', [['st', 'security F1 — STEP 3 switches row-level security back ON and FORCED']]],
  ['static', 'repair-write-policy-loosened', 'cfb-pickems/supabase/repair/live_repair_blind_rule_and_lock.sql', "create policy picks_insert on public.picks for insert to authenticated\n  with check (member_id = my_member_id(league_id) and pick_window_open(league_id, week_id) and game_pickable(league_id, game_id)\n              and public.league_active(league_id));", "create policy picks_insert on public.picks for insert to authenticated\n  with check (true);", [['st', 'DI-545 F3 + security F1 — the TWELVE canonical policies']]],
  ['static', 'repair-psql-without-1', 'cfb-pickems/supabase/repair/live_repair_blind_rule_and_lock.sql', "psql -v ON_ERROR_STOP=1 -1 -f supabase/repair/live_repair_blind_rule_and_lock.sql", "psql -v ON_ERROR_STOP=1 -f supabase/repair/live_repair_blind_rule_and_lock.sql", [['st', "the repair file's header carries the psql line with BOTH flags"], ['st', 'DI-545 F2 — EVERY documented psql invocation']]],
  ['static', '0057-canary-drops-rls-flags', M + '0057_drift_canary.sql', "\n                 || E'\\nrls=' || coalesce((select c.relrowsecurity::text || '/' || c.relforcerowsecurity::text from pg_class c where c.oid = to_regclass('public.' || t.tbl)), '(absent)'))", ")", [['st', '0057 — security F1: each policies:<table> hash covers']]],
  ['static', '0057-print-drifts-from-function', M + '0057_drift_canary.sql', "--             md5(coalesce((select string_agg(p.policyname || '|'", "--             md5(coalesce((select string_agg(p.policyname || '#'", [['st', '0057 — security F1: each policies:<table> hash covers']]],
  ['static', '0057-canary-filters-commands', M + '0057_drift_canary.sql', "\n             md5(coalesce((select string_agg(p.policyname || '|' || p.cmd || '|' || p.permissive || '|' || p.roles::text || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''), E'\\n' order by p.policyname) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tbl), '')", "\n             md5(coalesce((select string_agg(p.policyname || '|' || p.cmd || '|' || p.permissive || '|' || p.roles::text || '|' || coalesce(p.qual, '') || '|' || coalesce(p.with_check, ''), E'\\n' order by p.policyname) from pg_policies p where p.schemaname = 'public' and p.tablename = t.tbl and p.cmd in ('SELECT', 'ALL')), '')", [['st', '0057 — security F1: each policies:<table> hash covers']]],
  ['static', '0057-write-policy-added-in-a-migration', M + '0047_id_shape_checks.sql', "alter table public.games add constraint games_id_shape_check check (id ~ '^[A-Za-z0-9_.:-]{1,80}$') not valid;", "alter table public.games add constraint games_id_shape_check check (id ~ '^[A-Za-z0-9_.:-]{1,80}$') not valid;\nalter table public.picks disable row level security;", [['st', '0057 — security F1 RLS census']]],
  ['static', '0057-runbook-drops-f1b', 'docs/runbook/0057_DRIFT_CANARY.md', "**Only after A1.2 is green** (security F1b).\n", "", [['st', '0057 — security F1b']]],
  ['static', '0048-alias-needs-a-seat', M + '0048_join_bound_and_scrub.sql', "  select pi.external_id from public.push_identities pi where pi.user_id = p_user;", "  select pi.external_id from public.push_identities pi where pi.user_id = p_user and exists (select 1 from public.league_members m where m.user_id = p_user and m.active);", [['st', '0048 — push_identity_alias_of (security F3)']]],
  ['static', '0048-alias-granted-to-members', M + '0048_join_bound_and_scrub.sql', "grant execute on function public.push_identity_alias_of(uuid) to service_role;", "grant execute on function public.push_identity_alias_of(uuid) to service_role, authenticated;", [['st', '0048 — push_identity_alias_of (security F3)']]],
  ['static', '0048-helper-keeps-service-role', M + '0048_join_bound_and_scrub.sql', "revoke all on function public.reentry_register(uuid, text) from public, anon, authenticated, service_role;", "revoke all on function public.reentry_register(uuid, text) from public, anon, authenticated;", [['st', '0048 — security G5'], ['st', 'reentry_register: definer']]],
  ['static', '0048-residual-sentence-reverted', M + '0048_join_bound_and_scrub.sql', "SURVIVES on every audited row the leaver wrote in that league (joins, self-edits, comments, feedback), not only on the leave's own row;", "survives on the leave's own row;", [['st', '0048 — security F2']]],
  ['static', '0048-rollback-deletes-trace-rows', M + '0048_join_bound_and_scrub.sql', "-- the trace rows are KEPT (security): they are history,", "delete from public.platform_audit_log where action = 'audit_scrub'; -- the trace rows (security): they are history,", [['st', '0048 — security rollback note']]],
  ['static', 'account-delete-reverts-to-the-mint-path', 'cfb-pickems/supabase/functions/account-delete/index.js', "sb.rpc('push_identity_alias_of', { p_user: caller.uid })", "sb.rpc('push_identity_ensure', { p_user: caller.uid })", [['fc', 'security F3 — push_identity_alias_of is called by account-delete ONLY'], ['ad', 'PUSH-19'], ['ad', 'PUSH-20']]],
  ['static', 'account-delete-calls-a-helper', 'cfb-pickems/supabase/functions/account-delete/index.js', "  const pushIds = [];\n", "  const pushIds = [];\n  void serviceClient().rpc('reentry_register', {});\n", [['fc', 'security G5 — NO Edge Function or shared module calls reentry_register']]],
  // G4 (2026-10-08): every deadline of account-delete driven through handle() (accountDelete.twin G4-1..G4-9)
  ['static', 'deadline-alias-read-ignored', 'cfb-pickems/supabase/functions/account-delete/index.js', "if (aliasRead.timedOut || (aliasRead.value && aliasRead.value.error)) pushPreread = false;", "if (aliasRead.value && aliasRead.value.error) pushPreread = false;", [['ad', 'G4-1']]],   // (G4-4 hangs BOTH reads, so the seat read's own deadline still says failed: only G4-1 isolates the alias read)
  ['static', 'deadline-seat-read-ignored', 'cfb-pickems/supabase/functions/account-delete/index.js', "if (seatRead.timedOut || (seatRead.value && seatRead.value.error)) pushPreread = false;", "if (seatRead.value && seatRead.value.error) pushPreread = false;", [['ad', 'G4-3']]],
  ['static', 'deadline-removal-ignored', 'cfb-pickems/supabase/functions/account-delete/index.js', "pushOutcome = removed.timedOut ? 'failed' : removed.value;", "pushOutcome = removed.value;", [['ad', 'G4-5']]],
  ['static', 'unread-ids-answer-none', 'cfb-pickems/supabase/functions/account-delete/index.js', "if (!pushPreread && pushOutcome !== 'not_configured') pushOutcome = 'failed';", "", [['ad', 'G4-4'], ['ad', 'G4-1']]],
  ['static', 'deadline-rpc-ignored', 'cfb-pickems/supabase/functions/account-delete/index.js', "if (rpcResult.timedOut) {", "if (false) {", [['ad', 'G4-7']]],
  ['static', 'deadline-admin-ignored', 'cfb-pickems/supabase/functions/account-delete/index.js', "if (adminResult.timedOut) {", "if (false) {", [['ad', 'G4-8']]],
  // F-3 (reviewer, DI-548 row 15; 2026-10-08): the three flakes hardened. The rls.test groups are Drew's to run on DEV; these rows keep the hardening from being quietly reverted.
  ['static', 'rt1-over-no-topup', 'cfb-pickems/supabase/tests/rls.test.mjs', "for (let i = 0; i < 30 && (await freshInWindow()) < 30; i++) {", "for (let i = 0; i < 0; i++) {", [['st', 'DI-548 row 15 (RT1.over)']]],
  ['static', 's11-wpast-built-eligible', 'cfb-pickems/supabase/tests/rls.test.mjs', "kickoff: (id === wFuture || id === wPast) ? futureKick : pastKick,", "kickoff: id === wFuture ? futureKick : pastKick,", [['st', 'DI-548 row 15 (S11.setup / S11.locked-live)']]],
  ['static', 's11-no-race-retry', 'cfb-pickems/supabase/tests/rls.test.mjs', "racedByCron = true;", "racedByCron = false;", [['st', 'DI-548 row 15 (S11.setup / S11.locked-live)']]],
  // review (2026-10-08): the OneSignal removal covers every nameable id or says partial (accountDelete.twin PUSH-13..13d)
  ['static', 'push-cap-back-to-12', 'cfb-pickems/supabase/functions/_shared/onesignal-delete.mjs', "export const MAX_DELETE_IDS = MAX_SEAT_IDS + 1;", "export const MAX_DELETE_IDS = 12;", [['ad', 'PUSH-13b'], ['fc', 'account-delete never reports a truncated removal as deleted']]],
  ['static', 'truncated-answers-deleted', 'cfb-pickems/supabase/functions/account-delete/index.js', "if (pushOutcome === 'deleted' && pushTruncated) pushOutcome = 'partial';", "", [['ad', 'PUSH-13:'], ['fc', 'account-delete never reports a truncated removal as deleted']]],
  ['static', 'seat-read-cannot-see-truncation', 'cfb-pickems/supabase/functions/account-delete/index.js', ".limit(MAX_SEAT_IDS + 1)", ".limit(MAX_SEAT_IDS)", [['fc', 'DI-548 #9 — account-delete: the OneSignal removal runs AFTER']]],
  ['static', 'helper-never-says-partial', 'cfb-pickems/supabase/functions/_shared/onesignal-delete.mjs', "return capped ? 'partial' : 'deleted';", "return 'deleted';", [['ad', 'PUSH-13d']]],
  // review (2026-10-08): league_kind other than pilot is a STOP in the 0049 runbook, Part C and Part D
  ['static', 'runbook-0049-league-kind-not-a-stop', 'docs/runbook/0049_PUSH_MARKER.md', "or `league_kind` does not read `pilot`, STOP", "STOP", [['st', 'CREATION_FLIP.md carries DI-547']]],
  ['static', 'draft-loses-refusal', SD + 'E_logos.sql', null, null, [['st', 'DI-545 F5 — the FIRST LINE']]],
  ['static', 'pair-restore-forgets-anon', 'cfb-pickems/supabase/tests/mutations/push_identities_restore.sql', 'from public, anon, authenticated;', 'from public, authenticated;', [['st', 'DI-548 #6 — push_identities_open.sql is exactly ONE statement']]],
  ['static', 'flip-runbook-reordered', 'docs/runbook/0049_PUSH_MARKER.md', '# Part C. Gate 1', '# Part Z. Gate 1', [['st', "CREATION_FLIP.md carries DI-547's eleven gates"]]],
];

const args = process.argv.slice(2);
if (args.includes('--list')) { for (const [g, id, f, , , reds] of MUTANTS) console.log(`${g.padEnd(7)} ${id.padEnd(32)} ${Array.isArray(f) ? f.map((e) => e[0]).join(' + ') : f}  ->  ${reds.map(([s, r]) => `${SUITES[s]} :: ${r}`).join('  |  ')}`); process.exit(0); }
const groups = new Set(args.filter((a) => !a.startsWith('--')));
const only = new Set(((args.find((a) => a.startsWith('--only=')) || '').slice(7)).split(',').filter(Boolean));   // --only=<id>[,<id>]: re-run single rows by id (a row you just changed)
const pick = MUTANTS.filter((m) => (groups.size === 0 || groups.has(m[0])) && (only.size === 0 || only.has(m[1])));

console.log(`lane-a-mutation-kit: ${pick.length} mutant(s); copying the tree to a throwaway directory...`);
const TMP = mkdtempSync(join(tmpdir(), 'lane-a-kit-'));
const keep = (src) => !/(^|\/)(node_modules|\.git|\.deploy|\.claude)(\/|$)/.test(src.replace(ROOT, ''));
// THE TREE UNDER TEST IS COMMITTED HEAD, not whatever the working tree holds (reviewer's hardening, 2026-10-08): a kit run while a file is half-edited, or while a suite run is rewriting one, would test a tree nobody committed
// and a "KIT GREEN" would describe neither. `git archive HEAD` copies exactly what is committed. --worktree copies the working tree instead (development of a new row), and says so on the first line.
const WORKTREE = args.includes('--worktree');
if (WORKTREE) {
  console.log('NOTE: --worktree - the kit is testing the WORKING TREE, which may hold uncommitted changes. A result from this run is not a statement about any commit.');
  cpSync(join(ROOT, 'cfb-pickems'), join(TMP, 'cfb-pickems'), { recursive: true, filter: keep });
  cpSync(join(ROOT, 'docs'), join(TMP, 'docs'), { recursive: true, filter: keep });
  if (existsSync(join(ROOT, SD))) cpSync(join(ROOT, SD), join(TMP, SD), { recursive: true });
} else {
  const git = (...a) => execFileSync('git', a, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  const head = git('rev-parse', 'HEAD').trim();
  const dirty = git('status', '--porcelain', '--untracked-files=no', '--', 'cfb-pickems', 'docs').trim();
  console.log(`tree under test: committed HEAD ${head.slice(0, 8)}${dirty ? ' (the working tree has UNCOMMITTED changes under cfb-pickems/ or docs/: they are NOT part of this run; commit them or pass --worktree)' : ' (the working tree is clean)'}`);
  for (const paths of [['cfb-pickems', 'docs'], [SD.replace(/\/$/, '')]]) {
    try {
      const tar = execFileSync('git', ['archive', 'HEAD', '--', ...paths], { cwd: ROOT, maxBuffer: 1024 * 1024 * 1024 });
      const r = spawnSync('tar', ['-x', '-C', TMP], { input: tar });
      if (r.status !== 0) throw new Error('tar failed');
    } catch (e) { if (paths[0] === 'cfb-pickems') { console.log('could not archive HEAD:', String(e.message || e).slice(0, 200)); process.exit(2); } }
  }
}

const run = (suiteKey) => {
  const r = spawnSync(process.execPath, [SUITES[suiteKey]], { cwd: join(TMP, 'cfb-pickems'), encoding: 'utf8', timeout: 600000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env } });
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  return { code: r.status, fails: out.split('\n').filter((l) => /^\s*(❌|FAIL)/.test(l)), tail: out.trim().split('\n').slice(-2).join(' | ') };
};

let bad = 0;
const finish = () => { rmSync(TMP, { recursive: true, force: true }); console.log(bad === 0 ? '\nKIT GREEN - every mutant was killed by its named assertion.' : `\nKIT RED - ${bad} problem(s) above.`); process.exit(bad === 0 ? 0 : 1); };

const needed = [...new Set(pick.flatMap((m) => m[5].map(([s]) => s)))];
for (const s of needed) {
  const b = run(s);
  const ok = b.code === 0;
  console.log(`${ok ? 'BASELINE GREEN' : 'BASELINE RED  '}  ${SUITES[s]}  (${b.tail.slice(0, 90)})`);
  if (!ok) bad++;
}
if (bad) { console.log('\nA baseline is red: no mutant result below would mean anything. Fix the tree first.'); finish(); }

for (const [g, id, fileSpec, from, to, reds] of pick) {
  const edits = Array.isArray(fileSpec) ? fileSpec : [[fileSpec, from, to]];
  const originals = [];
  let missing = false;
  for (const [file, efrom, eto] of edits) {
    const copy = join(TMP, file);
    const text = readFileSync(copy, 'utf8');   // the copy holds the pristine text (HEAD by default); it is restored after every mutant
    let mutated;
    if (efrom === null) mutated = text.split('\n').slice(1).join('\n');
    else {
      const n = text.split(efrom).length - 1;
      if (n !== 1) { console.log(`TARGET ${n === 0 ? 'MISSING' : 'AMBIGUOUS'}  ${g}/${id}  (${n} matches in ${file})`); bad++; missing = true; break; }
      mutated = text.replace(efrom, () => eto);
    }
    mkdirSync(dirname(copy), { recursive: true });
    writeFileSync(copy, mutated);
    originals.push([copy, text]);
  }
  if (missing) { for (const [copy, text] of originals) writeFileSync(copy, text); continue; }
  for (const [s, red] of reds) {
    const r = run(s);
    const named = r.fails.find((l) => l.includes(red));
    const killed = r.code !== 0 && !!named;
    if (!killed) bad++;
    console.log(`${killed ? 'KILLED  ' : 'SURVIVED'}  ${g}/${id}  ${SUITES[s]}  RED: ${named ? named.trim().slice(0, 150) : `(no failing line contains "${red}"; exit ${r.code}; ${r.fails.length} other failure(s): ${(r.fails[0] || '').trim().slice(0, 100)})`}`);
  }
  for (const [copy, text] of originals) writeFileSync(copy, text);   // restore each copy from the real file's text
}
finish();
