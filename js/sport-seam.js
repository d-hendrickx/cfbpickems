/**
 * CFB Pickems - the seam between Lane A's commissioner work and the client sport context (D1, v0.30.0, thread 100726-D1)
 * ========================================================================================================================
 * The sport context (js/competition.js) owns WHO IS IN A SPORT and THE SPORT POINTER: `playersForCompetition()`, `playersForWeek()`, `isMultiSport()`, `getActiveSportKey()`,
 * `setActiveSportKey()`, `competitionForSport()`, `leagueSports()`. Lane A's commissioner work must not re-implement what it owns, so every consumer in Lane A asks THIS module, and this module
 * asks competition.js by NAME at call time (a test can hand it a stand-in with `_clientApiForTest`; a name the stand-in omits falls through to the real module).
 *
 * MERGED 2026-10-08 (feat/d1-sports = the server work and the client work together): competition.js is present, `sportSeamBackedByClientBranch()` is true, and
 *   - WHO HAS TO PICK is one function: `entrantsForWeek(week)` is a thin call into competition.js's `playersForWeek(week)`; the seam's own roster fallback is deleted (a second implementation);
 *   - THE LENS is the commissioner's sport. It is the sport POINTER whenever the pointer accepts the sport (`setLensSport` moves the pointer, so the lens and the pointer agree), and the
 *     commissioner's own LOCAL choice only while the pointer REFUSES it (a sport he runs but has not joined, C7 - so he can still run it, reviewer B1);
 *   - the single-sport fallbacks that remain below (`liveCompetitions`, `isMultiSportLeague`, `getLensSport`'s default) are belts for a stand-in that omits a name, not a second opinion.
 * Nothing here writes except the pointer, through `setActiveSportKey`.
 */

import * as competitionApi from './competition.js';
import * as storageApi from './storage.js';

// A test seam: a test cannot patch a namespace import, so it can hand this module a stand-in for the client branch's API (`_clientApiForTest({ getActiveSportKey, ... })`, `null` to clear). A name the
// stand-in does not define falls through to the real module. Nothing in production sets it.
let _clientOverride = null;
export function _clientApiForTest(obj) { _clientOverride = obj && typeof obj === 'object' ? obj : null; }
const api = (name) => {
  if (_clientOverride && typeof _clientOverride[name] === 'function') return _clientOverride[name];
  return typeof competitionApi[name] === 'function' ? competitionApi[name] : undefined;
};
const has = (name) => typeof api(name) === 'function';

/** True when the client branch's participation + pointer API is present (after the merge). */
export function sportSeamBackedByClientBranch() {
  return has('playersForWeek') && has('isMultiSport') && has('getActiveSportKey') && has('setActiveSportKey');
}

/** The league's non-archived competitions, default first (competition.js's own ordering). */
export function liveCompetitions() {
  try { return api('getCompetitions')().filter((c) => c && !c.archivedAt); } catch { return []; }
}

/** Two or more non-archived competitions. */
export function isMultiSportLeague() {
  if (has('isMultiSport')) { try { return api('isMultiSport')() === true; } catch { return false; } }
  return liveCompetitions().length >= 2;
}

/**
 * WHO HAS TO PICK for a week: competition.js's `playersForWeek(week)` (entrants who joined before the lock, C1) - THE one roster function, called by name at call time so a test stand-in can replace
 * it (`_clientApiForTest`). Merge note 2026-10-08: this used to carry its own single-sport fallback ("every active player" when the client API was absent); competition.js is always present now, so
 * the fallback was a SECOND implementation of the roster and is gone. A missing answer is nobody, never a guess at everybody.
 */
export function entrantsForWeek(week) {
  const r = api('playersForWeek')(week);
  return Array.isArray(r) ? r : [];
}

/**
 * The sport the commissioner's lens is on, a dbCode. ONE source of "which sport" whenever there can be: the client's sport POINTER. Only when the pointer REFUSES a sport does the lens keep a
 * separate local choice (`_localLens`): the pointer is a PLAYED-sports pointer (a sport the commissioner is not entered in refuses the write, C7), so it can never carry a commissioner onto a sport
 * he runs but does not play, and Lock on the NFL row of a commissioner who does not play the NFL must still lock the NFL week, not the college one (reviewer B1). A local choice wins over the
 * pointer for exactly that reason; it exists only while the pointer cannot hold it.
 */
let _localLens = null;

/**
 * DI-534 REV 5 (third pass, item 3): is the signed-in viewer a VERIFIED commissioner of this league? `getSession().isAdmin` is the app's one answer: in Supabase mode it is
 * `league_members.role === 'commissioner'` for the active league and it reads false while a privilege hold is up (auth.js `_recomputeSynthesizedSession` / `getSupabaseSession`); in the PIN era it
 * is the password-verified session. Only such a viewer may hold a separate lens.
 */
function viewerIsCommissioner() {
  try { return typeof storageApi.getSession === 'function' && storageApi.getSession()?.isAdmin === true; } catch { return false; }
}
/** Would the pointer accept this sport NOW (the viewer plays it)? The pointer's own rule (`playedSports`, the list `setActiveSportKey` checks), asked without writing anything. */
function pointerCanHold(dbCode) {
  if (!has('playedSports')) return false;
  try { const list = api('playedSports')(); return Array.isArray(list) && list.some((s) => s && s.dbCode === dbCode); } catch { return false; }
}

export function getLensSport() {
  const live = liveCompetitions();
  const valid = (k) => typeof k === 'string' && live.some((c) => c.sport === k);
  // DI-534 REV 5 - "IT ENDS". A separate lens lives only while all three hold: its sport is a live sport of this league, the viewer is a verified commissioner, and the pointer still cannot
  // hold the sport. Archived or role lost: it is FORGOTTEN (restoring the sport later cannot put Comm back on it). Joined: the pointer FOLLOWS it, so the lens is the pointer again and they
  // agree (DI-534 Verification: "join that account to NFL and see the pointer follow and the caption disappear"). "Follows" is a fact, not a hope: the separate lens ends only when the
  // pointer ACCEPTS the sport and READS IT BACK (setLensSport's own test). A viewer who plays the sport but whose pointer cannot store it (no league to key it by, a write the storage seam
  // refuses while the adapter is not serving) keeps the separate lens, so Comm never drops onto the other sport under his finger (sportsurfacetest [L-c3]/[L-c4]).
  if (_localLens !== null) {
    if (!valid(_localLens) || !viewerIsCommissioner()) _localLens = null;
    else if (pointerCanHold(_localLens)) {
      const k = _localLens;
      let moved = false;
      if (has('setActiveSportKey')) {
        try { moved = api('setActiveSportKey')(k) !== false && (!has('getActiveSportKey') || api('getActiveSportKey')() === k); } catch { moved = false; }
      }
      if (moved) _localLens = null;
      else return _localLens;
    } else return _localLens;
  }

  if (has('getActiveSportKey')) { try { const k = api('getActiveSportKey')(); if (valid(k)) return k; } catch { /* fall through */ } }
  const dflt = live.find((c) => c.isDefault) || live[0] || null;
  return dflt ? dflt.sport : 'cfb';
}

/** DI-534 REV 5: is Comm on a SEPARATE commissioner-only lens right now (the lens differs from the pointer)? Reads through getLensSport(), so a lens that has ended is never reported. Comm only. */
export function lensIsSeparate() {
  getLensSport();
  return _localLens !== null;
}

/**
 * Move the lens. A sport the league does not run is refused (returns false). DI-534 (coordinator ruling, 2026-10-08): the client POINTER is moved first; when it accepts and reads back the same sport,
 * the lens and the pointer are one and the same (no local lens is kept, so they agree for as long as nothing else moves the pointer). Only when the pointer refuses - the commissioner has not joined
 * that sport (C7) - is the lens kept locally, so he can still run a sport he does not play (B1) and the row resolves its own competition. REV 5: only a VERIFIED COMMISSIONER is kept locally; for
 * anyone else a refused move returns false and changes nothing. The separate lens ends on its own when he joins the sport, it is archived or the role is lost (getLensSport above).
 */
export function setLensSport(dbCode) {
  const live = liveCompetitions();
  if (!live.some((c) => c.sport === dbCode)) return false;
  let moved = false;
  if (has('setActiveSportKey')) {
    try {
      moved = api('setActiveSportKey')(dbCode) !== false;                                     // the pointer answers false (nothing stored) for a sport the viewer does not play
      if (moved && has('getActiveSportKey')) moved = api('getActiveSportKey')() === dbCode;   // trust the pointer only if it reads back what was written
    } catch { moved = false; }                                                                // refused (or threw): keep the lens local
  }
  if (moved) { _localLens = null; return true; }
  // DI-534 REV 5 (b): a separate lens is for a verified commissioner only. Anyone else whose pointer refuses the sport gets NOTHING: no separate lens, the pointer unchanged, and false.
  if (!viewerIsCommissioner()) { _localLens = null; return false; }
  _localLens = dbCode;
  return true;
}

/** Forget the local lens (an account / league / context switch: DI-538). */
export function resetLensSport() { _localLens = null; }

/** The competition the lens is on, or null. */
export function lensCompetition() {
  const k = getLensSport();
  return liveCompetitions().find((c) => c.sport === k) || null;
}

/** The current week of the lens sport (the default competition's through `getCurrentWeekFor`, the same resolver every other surface uses). */
export function lensWeek(fallback = null) {
  const c = lensCompetition();
  if (!c) return fallback;
  try { return api('getCurrentWeekFor')(c.id) || null; } catch { return fallback; }
}

// ── the competition_members data path (the client branch's, DI-531) ──────────────────────────────────────────────────────────────────────────────
// `getCompetitionMembers()`, `addCompetitionMember()` and `removeCompetitionMember()` are storage.js exports of the CLIENT branch. This branch alone does not have them, and a named
// import of a missing export would stop the whole app from loading, so they are looked up on the namespace at call time. Until that branch merges `entriesSupported()` is false, the
// Sport entries card is not drawn, and Add a sport creates the competition without the commissioner's own entry row (reported by addSportAction as entryAdded:false).
export function entriesSupported() {
  return typeof storageApi.getCompetitionMembers === 'function' && typeof storageApi.addCompetitionMember === 'function' && typeof storageApi.removeCompetitionMember === 'function';
}
/** The entry rows `[{ memberId, joinedAt, enrolledBy }]` of ONE competition (a NEW array), or [] when the data path is absent. */
export function entryRows(competitionId) {
  if (!entriesSupported()) return [];
  try { return storageApi.getCompetitionMembers().filter((r) => r && r.competitionId === competitionId); } catch { return []; }
}
/** Add one entry; returns false when it already existed or the data path is absent. */
export function addEntry(competitionId, memberId, enrolledBy = 'commissioner') {
  if (!entriesSupported()) return false;
  return storageApi.addCompetitionMember({ competitionId, memberId, enrolledBy }) !== false;
}
/** Remove one entry; returns whether a row went. */
export function removeEntry(competitionId, memberId) {
  if (!entriesSupported()) return false;
  return storageApi.removeCompetitionMember({ competitionId, memberId }) === true;
}
