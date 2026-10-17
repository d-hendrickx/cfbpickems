/**
 * CFB Pickems — pick-chips.js (Deployment 1, Lane B, DI-591 / DI-612 / security C2, C3, C4, C7, S1, 2026-10-08)
 * ============================================================================================================
 * THE CHIP-HELPER MODULE. The ONE module that imports a raw pick reader (`getPicks`) for the Game Day / Game view / Dashboard By team surfaces, and so the ONE place that answers
 * "may this viewer see the members' picks on THIS game?". Two exports carry it:
 *
 *   pickVisibilityFor({ game, week, viewerId, entrants })    THE GATE. Returns exactly one of
 *        { state: 'public', picks: [{ playerId, side }] }        one entry per ENTRANT; side 'away' | 'home' | 'none'. Only when `arePicksPublic(week)` AND (supabase mode) that week's
 *                                                                server read has landed (S-C10 `picksReadConfirmed`) — never `canViewOtherPicks()` (its commissioner no-stake bypass is for a
 *                                                                deliberately-visited screen, not for a surface a member scrolls past), and for THAT GAME'S OWN week (C2), never "the current week".
 *        { state: 'hidden', own: { side }, submitted: [id] }     the viewer's OWN pick plus WHICH entrants have submitted — and NO side for anyone else. The structure carries no other member's
 *                                                                selection, so even a faulty renderer cannot print one (S1: gate-first is structural).
 *        { state: 'none' }                                       nothing to show: the viewer is signed in but is not an entrant of that game's sport (C7: a sport the viewer has not joined shows
 *                                                                plain scores only, before and after reveal), has not submitted yet (Open / Locked), or the week is not the game's own.
 *      `entrants` is the roster of THAT GAME'S sport for THAT week (Lane A's `playersForCompetition(competitionId, { weekId })`), supplied by the caller — never `players.filter(p => p.active)` (C4/A3):
 *      a non-entrant's pick changes no cluster, no count and no "No pick" member; a late joiner (joined at or after the lock) is absent from the roster for that week.
 *
 *   gamePickChipsHTML({ ... })                              the Dashboard compact row's member chips, EXTRACTED VERBATIM from renderDashboardCompact (the loop body is unchanged), so the
 *                                                            Dashboard, the Game view's By person panel and the blind form cannot disagree. The Dashboard passes the same inputs it always used
 *                                                            (its own canViewOtherPicks gate, its own player list), so its default output is byte-identical (picksviewtest golden).
 *
 * Who may hold another member's pick (security S1) is a list of exactly TWO modules: this one, and js/pick-groups.js — which receives other members' picks ONLY as the return value of
 * `pickVisibilityFor` and imports no raw reader. DI-540's whole-tree import scan (loadtest) asserts it. Nothing here writes, fetches or touches the DOM.
 *
 * `configurePickGate({ picksReadConfirmed, submissionStateFor })` is called once by js/app.js; unconfigured, the gate FAILS CLOSED: in supabase mode a week is never "confirmed" and no
 * other member's submission is known (the hidden state lists nobody). In local mode (no shared backend) every device holds every row, so a public week is confirmed.
 */
import { arePicksPublic, getPicks, getBackendMode, hasPlayerSubmitted } from './storage.js';
import { evaluatePick } from './scoring.js';
import { GAME_STATUS, PICK_RESULT } from './data-model.js';

let gateCfg = { picksReadConfirmed: null, submissionStateFor: null };

/** @param {{picksReadConfirmed?:(weekId:string)=>boolean, submissionStateFor?:(weekId:string, playerId:string)=>('yes'|'no'|'unknown')}} c */
export function configurePickGate(c = {}) {
  const d = (c && typeof c === 'object') ? c : {};
  gateCfg = {
    picksReadConfirmed: typeof d.picksReadConfirmed === 'function' ? d.picksReadConfirmed : null,
    submissionStateFor: typeof d.submissionStateFor === 'function' ? d.submissionStateFor : null,
  };
}
export function _resetPickGateForTest() { gateCfg = { picksReadConfirmed: null, submissionStateFor: null }; }

const isId = (v) => typeof v === 'string' && v !== '';

/** S-C10: the other members' rows have LANDED for this week. Local mode holds every row, so it is true there; supabase mode asks the adapter (injected) and fails closed. */
function rowsConfirmed(weekId) {
  let supabase = false;
  try { supabase = getBackendMode() === 'supabase'; } catch { supabase = true; }   // an unreadable mode is the strict one
  if (!supabase) return true;
  try { return !!gateCfg.picksReadConfirmed && gateCfg.picksReadConfirmed(weekId) === true; } catch { return false; }
}

function submittedOf(weekId, playerId) {
  if (gateCfg.submissionStateFor) { try { return gateCfg.submissionStateFor(weekId, playerId) === 'yes'; } catch { return false; } }
  let supabase = false;
  try { supabase = getBackendMode() === 'supabase'; } catch { supabase = true; }
  if (supabase) return false;                       // unconfigured in supabase mode: nobody's submission is known
  try { return hasPlayerSubmitted(weekId, playerId) === true; } catch { return false; }
}

const sideOf = (pick, game) => (!pick ? 'none' : pick.selectedTeam === game.awayTeam ? 'away' : pick.selectedTeam === game.homeTeam ? 'home' : 'none');

/** THE GATE. See the file header. Never throws; every doubt is `{ state: 'none' }` or `hidden`, never `public`. */
export function pickVisibilityFor(args) {
  const NONE = { state: 'none' };
  const { game, week, viewerId, entrants } = (args && typeof args === 'object') ? args : {};   // a null / non-object argument is a refusal, never a throw
  if (!game || typeof game !== 'object' || !week || typeof week !== 'object' || !isId(game.gameId) || !isId(week.weekId)) return NONE;
  if (game.weekId !== week.weekId) return NONE;                         // C2: the gate is for THIS game's own week, never another's
  const roster = (Array.isArray(entrants) ? entrants : []).filter(p => p && isId(p.playerId));
  const ids = new Set(roster.map(p => p.playerId));
  const viewer = isId(viewerId) ? viewerId : null;
  if (viewer && !ids.has(viewer)) return NONE;                          // C7: signed in, but not in this sport: plain scores only, before and after reveal
  let isPublic = false;
  try { isPublic = arePicksPublic(week) === true; } catch { isPublic = false; }
  let all = [];
  try { all = getPicks(week.weekId); } catch { all = []; }
  const onGame = all.filter(p => p && p.gameId === game.gameId);
  if (isPublic && rowsConfirmed(week.weekId)) {
    return { state: 'public', picks: roster.map(p => ({ playerId: p.playerId, side: sideOf(onGame.find(x => x.playerId === p.playerId), game) })) };
  }
  if (!viewer) return NONE;                                             // signed out, and the week is not public: nothing
  if (isPublic) return NONE;                                            // public but the other rows have not landed: not the blind form either (a week that is live is not "hidden until kickoff")
  if (!submittedOf(week.weekId, viewer)) return NONE;                   // Open / Locked and the viewer has not submitted: the surface says "Submit your picks to see who's in"
  const mine = onGame.find(x => x.playerId === viewer);
  return {
    state: 'hidden',
    own: { side: sideOf(mine, game) },
    submitted: roster.filter(p => p.playerId !== viewer && submittedOf(week.weekId, p.playerId)).map(p => p.playerId),
  };
}

/**
 * Live ATS status for a pick in an in-progress game: 'covering' | 'trailing' | 'even' | null. Moved here VERBATIM from js/app.js (which now delegates to it, so
 * `window.livePickStatus` and every existing caller are unchanged) because pick-groups.js draws the same marks and must not own a second copy of the arithmetic.
 */
export function livePickStatus(pick, game) {
  if (!pick || !game) return null;
  if (game.status !== GAME_STATUS.LIVE) return null;
  if (game.homeScore === null || game.awayScore === null) return null;
  const sv = game.lockedSpread !== null ? game.lockedSpread : game.spread;
  if (sv === null || sv === undefined) return null;
  const adj = game.homeScore + sv;        // home-perspective adjusted score
  const margin = adj - game.awayScore;    // >0 home covering, <0 away covering
  if (Math.abs(margin) < 0.01) return 'even';
  const homeCovering = margin > 0;
  const pickedHome = pick.selectedTeam === game.homeTeam;
  const covering = pickedHome ? homeCovering : !homeCovering;
  return covering ? 'covering' : 'trailing';
}

const needFn = (f, name) => { if (typeof f !== 'function') throw new TypeError(`gamePickChipsHTML() requires an injected ${name} function (CONVENTIONS #12)`); return f; };

/**
 * The member chips of ONE game, in the Dashboard compact row's exact markup (the loop body of renderDashboardCompact, moved here unchanged).
 *   players      the chips to draw, already in display order (the Dashboard's `getOrderedPlayersForDashboard(submitted, viewer)`)
 *   lookup(id)   the member's pick on THIS game, or null/undefined (no pick). Only `selectedTeam` is read. A blind row's lookup may return any truthy object: the pick is never read past the gate.
 *   canSeeOthers the caller's gate answer (the Dashboard: canViewOtherPicks(week); pick-groups: the gate's `public` state)
 *   draggable    the Dashboard's chips are the column-reorder handles (default true, byte-identical); the Game view's are not
 * Injected (the app owns them): escHtml, initialsOf, logoOk, logoSrcAttr, teamSchool. `shortLabel(teamName)` is the week's unique abbreviation map.
 */
export function gamePickChipsHTML({ game, players, lookup, viewerId, canSeeOthers, shortLabel, logoViewOn, draggable = true, escHtml, initialsOf, logoOk, logoSrcAttr, teamSchool } = {}) {
  needFn(escHtml, 'escHtml'); needFn(initialsOf, 'initialsOf'); needFn(logoOk, 'logoOk'); needFn(logoSrcAttr, 'logoSrcAttr'); needFn(teamSchool, 'teamSchool'); needFn(lookup, 'lookup'); needFn(shortLabel, 'shortLabel');
  const drag = draggable ? ' draggable="true"' : '';
  return (Array.isArray(players) ? players : []).map(player => {
    const pick = lookup(player.playerId);
    const initials = escHtml(initialsOf(player));
    if (!pick) {
      return `<div class="dc-chip dc-chip-none" data-player-id="${escHtml(player.playerId)}"${drag} title="${escHtml(player.displayName)}: no pick"><span class="dc-chip-init">${initials}</span><span class="dc-chip-pick">—</span></div>`;
    }
    const isSelf = viewerId === player.playerId;
    // Blinding: if the viewer can't see others' picks yet AND this isn't their own pick, render an opaque "•••" chip. The chip still shows initials so they can see WHO has submitted, just not WHAT they picked.
    if (!isSelf && !canSeeOthers) {
      return `<div class="dc-chip dc-chip-blind" data-player-id="${escHtml(player.playerId)}"${drag} title="${escHtml(player.displayName)}: picks hidden until the games kick off"><span class="dc-chip-init">${initials}</span><span class="dc-chip-pick">•••</span></div>`;
    }
    const result = evaluatePick(pick, game);
    const pickedSide = pick.selectedTeam === game.homeTeam ? 'home' : pick.selectedTeam === game.awayTeam ? 'away' : null;
    const pickShort = pickedSide ? shortLabel(teamSchool(game, pickedSide)) : shortLabel(pick.selectedTeam);
    let cls = 'dc-chip-pending';
    let icon = '';
    if (result === PICK_RESULT.LIVE) {
      const ls = livePickStatus(pick, game);
      if (ls === 'covering') { cls = 'dc-chip-live-covering'; icon = '▲'; }
      else if (ls === 'trailing') { cls = 'dc-chip-live-trailing'; icon = '▽'; }
      else { cls = 'dc-chip-live'; }
    } else if (result === PICK_RESULT.WIN) { cls = 'dc-chip-win'; icon = '✓'; }
    else if (result === PICK_RESULT.LOSS) { cls = 'dc-chip-loss'; icon = '✗'; }
    else if (result === PICK_RESULT.NO_DECISION) { cls = 'dc-chip-nd'; icon = '—'; }
    // DI-331f — a logo in place of the abbreviation when Team logos is on; reached ONLY past the blind-rule branches above, so a hidden pick can never resolve a team here.
    const pickLogoUrl = (logoViewOn && pickedSide) ? logoOk(pickedSide === 'home' ? game.homeLogo : game.awayLogo) : null;
    const pickContent = pickLogoUrl
      ? `<span class="dc-chip-pick-logo"><img class="dc-chip-logo" ${logoSrcAttr(pickLogoUrl)} alt="${escHtml(pick.selectedTeam)}" loading="lazy" referrerpolicy="no-referrer"><span class="dc-chip-pick-fallback">${escHtml(pickShort)}</span></span>`
      : escHtml(pickShort);
    return `<div class="dc-chip ${cls}" data-player-id="${escHtml(player.playerId)}"${drag} title="${escHtml(player.displayName)} picked ${escHtml(pick.selectedTeam)}"><span class="dc-chip-init">${initials}</span><span class="dc-chip-pick">${pickContent}${icon?` ${icon}`:''}</span></div>`;
  }).join('');
}
