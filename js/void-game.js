/**
 * CFB Pickems - void-game.js (D2 lane 2, DI-896 / DI-909; UN-513, UN-514 / PF-513, 514; RPF-C2, Drew round 5, 2026-10-19: "the void-game action by commissioner prompt: picks kept, counts for nobody,
 * prompted at 36 h after the slate, never automatic; reuse No Decision via status final, null scores, ats_winner no_decision; no scoring edit")
 * ===================================================================================================================================================================================================
 * A commissioner action that settles a game nobody played. Every pick on it is KEPT and scores nobody; the slate can finish. Removing a game (which DELETES its picks) stays; this is the other door.
 *
 * HOW IT REUSES THE SHIPPED PATH (no edit to js/scoring.js, no migration): a voided game is written `status 'final'`, scores null, `atsWinner 'no_decision'`, `actualWinner` null, with `voided true`,
 * `voidReason` and `voidedAt` riding `extra`. `evaluatePick` (scoring.js) already returns NO_DECISION for a final game whose `atsWinner` is `'no_decision'`, `calculateWeeklyResults` tallies it as
 * `noDecisions`, and the server's write gate never rewrites a stored final row. A PURE LEAF (it imports nothing): the writes are the caller's, over injected deps, so a Node suite proves every outcome.
 *
 *   isVoided(game)                               the one predicate every surface that prints a final score checks first
 *   voidPatch / undoVoidPatch                    the exact field patches
 *   canVoid({ week, game }) / canUndoVoid        which statuses allow it (Draft, Open, Locked, Live; undo until the slate is final)
 *   settlement(games)                            { settled, gradable, voided, noContest } : "ready to finalize" counts voided games as settled; none gradable is "No contest"
 *   voidPrompts({ week, games, nowMs, notes })   the prompts for the commissioner: ESPN says a game was postponed / cancelled / suspended, or a game has no result 36 hours after the slate's last start
 *   voidGame / undoVoidGame                      the operations over deps (re-reads the mirror; re-points the tiebreaker game; writes nothing when refused)
 *   VOID_COPY                                    the sentences (DI-896), fixed
 */

export const VOID_PROMPT_AFTER_MS = 36 * 3600000;

export const VOID_COPY = Object.freeze({
  rowAction: 'Void game',
  undoAction: 'Undo void',
  chip: 'Voided — no decision',
  pickChip: 'No decision',
  cell: 'VOID',
  postponedChip: 'Postponed',
  confirmTitle: (name) => `Void ${name}?`,
  confirmBody: 'Nobody wins or loses on this game and picks on it are kept. You can undo this until the slate is final.',
  confirmAction: 'Void game',
  cancel: 'Cancel',
  failed: "Couldn't void the game. Nothing was changed. Try again.",
  undoFailed: "Couldn't undo the void. Nothing was changed. Try again.",
  voided: (name) => `Voided ${name}.`,
  undone: (name) => `Restored ${name}.`,
  promptNote: (name, note) => `${name} is listed as ${note}. Void it?`,
  promptNoResult: (name) => `No result yet for ${name}. Void it?`,
  promptKeep: 'Not yet',
  noContest: 'No contest: every game on this slate was voided.',
  tiebreakerMoved: (name) => `Tiebreaker game is now ${name}.`,
});

/** A voided game: `final`, flagged, no score. The ONE test every surface that prints a final score makes first. */
export function isVoided(game) {
  return !!game && typeof game === 'object' && game.voided === true && game.status === 'final';
}

/** The fields a void writes (never mutates the game). `reason` is clipped to 80 characters. */
export function voidPatch({ reason = '', nowIso = new Date().toISOString() } = {}) {
  return {
    status: 'final', homeScore: null, awayScore: null, actualWinner: null, atsWinner: 'no_decision',
    voided: true, voidReason: typeof reason === 'string' ? reason.trim().slice(0, 80) : '', voidedAt: nowIso, lastUpdated: nowIso,
  };
}

/** The fields an undo writes: back to a scheduled game with no result and no flag. */
export function undoVoidPatch({ nowIso = new Date().toISOString() } = {}) {
  return { status: 'scheduled', homeScore: null, awayScore: null, actualWinner: null, atsWinner: null, voided: false, voidReason: null, voidedAt: null, lastUpdated: nowIso };
}

const ACTIVE = ['draft', 'open', 'locked', 'live'];

/** Review 3: should a game-edit SAVE keep the game's stored grade instead of re-grading it? True for a voided game still final (its null scores would grade to null and un-void it). The one decision the edit modal asks. */
export function keepsVoidGrade({ game, status } = {}) {
  return isVoided(game) && ['final'].includes(status);
}

/** Void is offered in Draft, Open, Locked and Live (a game nobody played), for a game that is not already voided and not a played final. */
export function canVoid({ week, game } = {}) {
  if (!week || !game || isVoided(game)) return false;
  if (!ACTIVE.includes(week.status)) return false;
  return game.status !== 'final';
}

/** Undo is offered until the slate is final: a voided game in a week that has not been finalized. */
export function canUndoVoid({ week, game } = {}) {
  return !!week && isVoided(game) && ACTIVE.includes(week.status);
}

/**
 * Where a slate stands for finishing: every game settled (final or voided) is "ready to finalize"; `gradable` is the count of PLAYED finals (a voided game is not one); a slate with games but none gradable
 * and at least one voided is a NO CONTEST (no winner, no loser, no obligation).
 */
export function settlement(games) {
  const list = (Array.isArray(games) ? games : []).filter((g) => g && typeof g === 'object');
  const voided = list.filter(isVoided).length;
  const finals = list.filter((g) => g.status === 'final').length;
  const gradable = finals - voided;
  return { total: list.length, settled: list.length > 0 && finals === list.length, gradable, voided, noContest: list.length > 0 && voided > 0 && gradable === 0 && finals === list.length };
}

const nameOf = (g) => `${g.awayTeam} at ${g.homeTeam}`;

/**
 * The prompts the commissioner sees on Comm > Week (never automatic; the commissioner is one tap away):
 *   1. ESPN reports a game of the slate postponed / cancelled / suspended (the TRANSIENT note on the live-status map, `notes[gameId]`): "Rangers at Bruins is listed as postponed. Void it?"
 *   2. A game with no result 36 hours after the slate's last start: "No result yet for Rangers at Bruins. Void it?"
 * Only for a week that is Open, Locked or Live; a voided or final game raises none; at most one prompt per game (the ESPN note wins). `notes` maps gameId -> 'postponed' | 'cancelled' | 'suspended' | 'delayed' | 'unknown'.
 */
export function voidPrompts({ week, games = [], nowMs = Date.now(), notes = {} } = {}) {
  if (!week || !['open', 'locked', 'live'].includes(week.status)) return [];
  const list = (Array.isArray(games) ? games : []).filter((g) => g && typeof g === 'object' && g.gameId);
  const starts = list.map((g) => Date.parse(g.kickoff)).filter(Number.isFinite);
  const lastStart = starts.length ? Math.max(...starts) : null;
  const out = [];
  for (const g of list) {
    if (g.status === 'final' || isVoided(g)) continue;
    const note = notes && Object.prototype.hasOwnProperty.call(notes, g.gameId) ? notes[g.gameId] : null;
    if (note === 'postponed' || note === 'cancelled' || note === 'suspended') { out.push({ gameId: g.gameId, kind: 'note', note, text: VOID_COPY.promptNote(nameOf(g), note) }); continue; }
    if (lastStart !== null && nowMs - lastStart >= VOID_PROMPT_AFTER_MS) out.push({ gameId: g.gameId, kind: 'no_result', note: null, text: VOID_COPY.promptNoResult(nameOf(g)) });
  }
  return out;
}

/**
 * Void one game. Re-reads the week and the game from the mirror (never a render closure). Refuses, WRITING NOTHING, when the week or game is gone, the game is already voided or played, or the week
 * status does not allow it. Writes the game; if it was the slate's tiebreaker game the reference moves to the latest remaining UNVOIDED game (anyone who already guessed keeps the guess; the question
 * follows the new game) and the answer says so.
 * @returns {{ok:true, game, tiebreakerMovedTo:(object|null), settlement}|{ok:false, reason}}
 */
export function voidGame({ weekId, gameId, reason = '', deps } = {}) {
  const week = deps.getWeek(weekId);
  const games = deps.getGames(weekId);
  const game = games.find((g) => g.gameId === gameId);
  if (!week || !game) return { ok: false, reason: 'missing' };
  if (isVoided(game)) return { ok: false, reason: 'already_voided' };
  if (!canVoid({ week, game })) return { ok: false, reason: 'not_allowed' };
  const nowIso = deps.now ? deps.now() : new Date().toISOString();
  const next = { ...game, ...voidPatch({ reason, nowIso }), updatedAt: nowIso };
  try { deps.saveGame(next); } catch (err) { return { ok: false, reason: 'write_failed', error: err }; }
  let movedTo = null;
  try {
    const fresh = deps.getWeek(weekId);
    if (fresh && fresh.tiebreakerGameId === gameId) {
      const profile = deps.profileForWeek ? deps.profileForWeek(fresh) : null;
      const remaining = deps.getGames(weekId).filter((g) => !isVoided(g));
      const opts = deps.tiebreakerGameOptions ? deps.tiebreakerGameOptions(remaining, { nameOf }) : [];
      const to = opts.length ? remaining.find((g) => g.gameId === opts[0].gameId) : null;
      if (to && deps.tiebreakerFieldsFor) {
        const f = deps.tiebreakerFieldsFor({ week: fresh, game: to, profile, questionFor: deps.tiebreakerQuestionFor });
        if (f) { deps.saveWeek({ ...fresh, ...f, updatedAt: nowIso }); movedTo = to; }
      } else if (!to) {
        deps.saveWeek({ ...fresh, tiebreakerGameId: null, updatedAt: nowIso });
      }
    }
  } catch { movedTo = null; }
  return { ok: true, game: next, tiebreakerMovedTo: movedTo, settlement: settlement(deps.getGames(weekId)) };
}

/** Undo a void until the slate is final: the game is a scheduled game again, no flag, no result. */
export function undoVoidGame({ weekId, gameId, deps } = {}) {
  const week = deps.getWeek(weekId);
  const game = deps.getGames(weekId).find((g) => g.gameId === gameId);
  if (!week || !game) return { ok: false, reason: 'missing' };
  if (!canUndoVoid({ week, game })) return { ok: false, reason: 'not_allowed' };
  const nowIso = deps.now ? deps.now() : new Date().toISOString();
  const next = { ...game, ...undoVoidPatch({ nowIso }), updatedAt: nowIso };
  try { deps.saveGame(next); } catch (err) { return { ok: false, reason: 'write_failed', error: err }; }
  return { ok: true, game: next };
}
