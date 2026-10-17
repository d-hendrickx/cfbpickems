/**
 * CFB Pickems — slate-add.js (Deployment 1, thread 100726-D1, W-68 add-or-swap on a full slate; W-69 remove; DI-W68.1 – DI-W68.7, DI-W69.3, DI-W69.6)
 * ===================================================================================================================================================
 * Drew, 2026-10-14: "If the slate is built with 10 teams and I select add a new team, it should ask me to add an extra (make it 11) or swap with another
 * team currently on the slate, then let me pick whichteam to swap it with roght now nothing happens".
 *
 * The PURE half of the feature: the rule that decides whether an add asks, every word the sheets say, the sheets' markup, and the three operations the Games tab, the
 * wizard and the Player Requests card share (add, swap, remove). No DOM, no storage import: every read and write comes in through `deps`, so a Node suite proves each
 * outcome (the add-then-delete order, the picks cascade, the NFL tiebreaker reference) against fakes and app.js proves the wiring.
 *
 *   slateAddDecision({ count, profile })       the rule: below the profile's slate size an add is one tap; at or over it the commissioner is asked.
 *   choiceSheetHTML / removeSheetHTML / moreSheetHTML / clearSlateSheetHTML
 *                                              the action sheets (the ONE builder, league-create.js actionSheetHTML — never forked).
 *   swapPickerBodyHTML / swapPickerFooterHTML  the swap picker sheet's content (the brand-new surface, docs/mockups/d1/swap-picker.html).
 *   addGameToSlate / swapSlateGame / removeGameFromSlate
 *                                              the operations. A swap ADDS the new game first, then deletes the old: a throw between the two leaves the slate one game LONG,
 *                                              never one short. Both operations keep an NFL week's tiebreaker-game reference pointing at a game that is still on the slate.
 *   planBulkAdd                                the two bulk adds stop at the sport's slate size (R-3), except where the suggestion engine itself widened the slate for
 *                                              alma-mater games (Drew's standing ruling: "ALL is absolute").
 */

import { actionSheetHTML } from './league-create.js';
import { slateMatchFor } from './games-list.js';

// ── the copy: exact, from docs/DESIGN_D1_D.md DI-W68.2 / .3 / .4 / .6 and DI-W69.3 / .6 ──────────────────────────────────────────────────────────────────────────────
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

export const SLATE_COPY = Object.freeze({
  // the choice sheet (DI-W68.2)
  choiceTitle: (n) => `The slate has ${n} games`,
  choiceMessage: (name, next) => `Add ${name} as game ${next}, or swap it for a game that is already on the slate.`,
  extendLabel: (next) => `Add as game ${next}`,
  swapLabel: 'Swap with a game on the slate',
  cancel: 'Cancel',
  fullTitle: 'The slate is full',
  fullMessage: ({ sport, min, max, name }) => `${min ? `${sport ? `${sport} slates` : 'Slates'} run ${min} to ${max} games.` : `${sport ? `${sport} slates` : 'Slates'} are ${max} games.`} Swap ${name} for a game that is already on the slate.`,
  newGameName: 'the new game',
  // the swap picker (DI-W68.3)
  pickerTitle: 'Swap out which game?',
  pickerAdding: 'Adding',
  pickerSwapOut: 'Swap out',
  pickerGroupLabel: 'Games on the slate',
  manualIncoming: 'A game you’ll enter next',
  manualIncomingNote: 'You’ll enter it after you choose.',
  swapLabelBtn: 'Swap',
  continueLabel: 'Continue',
  swapAndDelete: (n) => `Swap and delete ${n} ${plural(n, 'pick', 'picks')}`,
  picksWarning: (n, name, manual) => `${n} submitted ${plural(n, 'pick', 'picks')} on ${name} will be deleted${manual ? ' when you save the new game' : ''}.`,
  picksChip: (n) => `${n} ${plural(n, 'pick', 'picks')}`,
  // outcomes (DI-W68.2 / .4)
  addedAs: (next) => `Added as game ${next}.`,
  added: (name) => `Added ${name}.`,
  alreadyOn: (name) => `${name} is already on the slate.`,
  swapped: (oldName, newName) => `Swapped ${oldName} for ${newName}.`,
  tiebreakerMoved: (name) => `Tiebreaker game is now ${name}.`,
  swapGone: 'Couldn’t find that game on the slate. Nothing was changed.',
  swapHalf: (oldName, newName) => `The swap didn’t finish. ${newName} was added and ${oldName} is still on the slate; remove it yourself.`,
  removedPlain: 'Game removed',
  removedPicks: (n) => `Removed — ${n} ${plural(n, 'pick', 'picks')} also deleted`,
  // the remove confirm (DI-W69.3)
  removeTitle: (name) => `Remove ${name}?`,
  removeWithPicks: (n) => `${n} submitted ${plural(n, 'pick', 'picks')} on this game will be deleted. This can’t be undone.`,
  removeToPool: 'It goes back to Not on slate.',
  removeByHand: 'You added this game by hand, so it will be gone. You can add it again with Add a game.',
  removeAction: 'Remove from Slate',
  // bulk adds (DI-W68.6)
  bulkHeld: (k, target) => `Added ${k} ${plural(k, 'game', 'games')}. The slate is at ${target}; add more one at a time.`,
  bulkHeldTail: (target) => ` The slate is at ${target}; add more one at a time.`,
  // the More… sheet and the clear-all confirm (DI-W69.6)
  moreTitle: 'More',
  clearSlateTitle: 'Remove all games from the slate?',
  clearSlateMessage: 'This does not affect picks already submitted.',
  clearSlateAction: 'Remove All Games',
});

// ── the rule (DI-W68.1) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Does adding one more game to a slate of `count` ask the commissioner? PURE; reads no sport name, so a future sport inherits it from its profile's `slate` block.
 *   count < target                      { prompt: false }                                  an add is one tap (building the first ten stays one tap per game)
 *   count >= target                     { prompt: true, count, target, max, canExtend, nextNumber }
 * `target` is the profile's `slate.size` (default 10); `max` is its `slate.maxSize` when that is a finite number, else null = NO ceiling (college football's slate has none).
 * A non-finite or negative count is treated as 0.
 */
export function slateAddDecision({ count, profile } = {}) {
  const n = Number(count);
  const c = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  const slate = profile && typeof profile === 'object' && profile.slate && typeof profile.slate === 'object' ? profile.slate : null;
  const target = slate && Number.isFinite(slate.size) && slate.size > 0 ? Math.floor(slate.size) : 10;
  const max = slate && Number.isFinite(slate.maxSize) ? Math.floor(slate.maxSize) : null;
  const min = slate && Number.isFinite(slate.minSize) ? Math.floor(slate.minSize) : null;
  if (c < target) return { prompt: false };
  return { prompt: true, count: c, target, max, min, canExtend: max === null || c < max, nextNumber: c + 1 };
}

/** The slate size a bulk add stops at: the profile's own, default 10 (the same number slateAddDecision reads). */
export function slateTargetOf(profile) {
  const slate = profile && typeof profile === 'object' && profile.slate && typeof profile.slate === 'object' ? profile.slate : null;
  return slate && Number.isFinite(slate.size) && slate.size > 0 ? Math.floor(slate.size) : 10;
}

/**
 * Which of `candidates` a bulk add may add (DI-W68.6, R-3). It adds while the slate is below `limit`, which is the sport's slate size - or the suggestion engine's own length when
 * the engine widened the slate for alma-mater games ("ALL is absolute", Drew's standing ruling: the slate is never truncated to force a round 10). On an empty slate the whole suggestion
 * goes in, as it always has. `isOnSlate(game)` answers the join (games-list.js slateMatchFor). Returns { toAdd, held, limit }.
 */
export function planBulkAdd({ existingCount = 0, candidates = [], target = 10, suggestedLength = 0, isOnSlate = () => false } = {}) {
  const limit = Math.max(Number(target) || 10, Number(suggestedLength) || 0);
  let count = Number(existingCount) > 0 ? Math.floor(Number(existingCount)) : 0;
  const toAdd = [], held = [];
  for (const g of Array.isArray(candidates) ? candidates : []) {
    if (!g || isOnSlate(g)) continue;
    if (count >= limit) { held.push(g); continue; }
    toAdd.push(g); count += 1;
  }
  return { toAdd, held, limit };
}

// ── the action sheets (the ONE builder; `data-ls-action` is the layer's own attribute) ──────────────────────────────────────────────────────────────────────────
const ACTION_ATTR = 'data-ls-action';

/** The add-or-swap choice (DI-W68.2). `incomingName` is "Away @ Home", or null for a game the commissioner has not entered yet ("the new game"). */
export function choiceSheetHTML({ escHtml, decision, incomingName = null, profile = null } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('choiceSheetHTML() requires the real escHtml');
  const d = decision && decision.prompt ? decision : { prompt: true, count: 0, nextNumber: 1, canExtend: true, max: null, min: null };
  const name = incomingName || SLATE_COPY.newGameName;
  const swap = { label: SLATE_COPY.swapLabel, action: 'slate-swap' };
  if (d.canExtend) {
    return actionSheetHTML({
      escHtml, titleId: 'slate-add-title', title: SLATE_COPY.choiceTitle(d.count), message: SLATE_COPY.choiceMessage(name, d.nextNumber),
      actions: [{ label: SLATE_COPY.extendLabel(d.nextNumber), action: 'slate-extend' }, swap],
      cancel: { label: SLATE_COPY.cancel, action: 'cancel' }, scrimAction: 'cancel', actionAttr: ACTION_ATTR,
    });
  }
  const sport = (profile && profile.label) || '';
  return actionSheetHTML({
    escHtml, titleId: 'slate-add-title', title: SLATE_COPY.fullTitle,
    message: SLATE_COPY.fullMessage({ sport, min: d.min, max: d.max, name }),
    actions: [swap], cancel: { label: SLATE_COPY.cancel, action: 'cancel' }, scrimAction: 'cancel', actionAttr: ACTION_ATTR,
  });
}

/** What the remove confirm says (DI-W69.3). `hasCounterpart` = the game also sits in the pool, so removing it sends it back to Not on slate. */
export function removeSheetCopy({ name, pickCount = 0, hasCounterpart = false } = {}) {
  const n = Number(pickCount) > 0 ? Math.floor(Number(pickCount)) : 0;
  return {
    title: SLATE_COPY.removeTitle(name),
    message: n > 0 ? SLATE_COPY.removeWithPicks(n) : (hasCounterpart ? SLATE_COPY.removeToPool : SLATE_COPY.removeByHand),
    action: SLATE_COPY.removeAction,
  };
}
export function removeSheetHTML({ escHtml, name, pickCount = 0, hasCounterpart = false } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('removeSheetHTML() requires the real escHtml');
  const c = removeSheetCopy({ name, pickCount, hasCounterpart });
  return actionSheetHTML({
    escHtml, titleId: 'slate-remove-title', title: c.title, message: c.message,
    danger: { label: c.action, action: 'slate-remove-confirm' }, cancel: { label: SLATE_COPY.cancel, action: 'cancel' }, scrimAction: 'cancel', actionAttr: ACTION_ATTR,
  });
}

/** The More… sheet (DI-W69.6): the rare and destructive slate controls. Each entry exists only when it can do something. */
export function moreSheetItems({ pastDraft = false, hasPool = false, hasSlate = false, rejectedCount = 0 } = {}) {
  const items = [];
  if (pastDraft) {
    items.push({ label: 'Unlock All', action: 'slate-more-unlock-all' });
    if (hasSlate) items.push({ label: 'Calculate ATS', action: 'slate-more-calc-ats' });
  }
  if (hasPool) items.push({ label: 'Clear pool', action: 'slate-more-clear-pool' });
  if (Number(rejectedCount) > 0) items.push({ label: `Restore ${Math.floor(Number(rejectedCount))} dismissed`, action: 'slate-more-restore' });
  if (hasSlate) items.push({ label: 'Clear all slate games', action: 'slate-more-clear-slate', danger: true });
  return items;
}
export function moreSheetHTML({ escHtml, items } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('moreSheetHTML() requires the real escHtml');
  return actionSheetHTML({
    escHtml, titleId: 'slate-more-title', title: SLATE_COPY.moreTitle, actions: items,
    cancel: { label: SLATE_COPY.cancel, action: 'cancel' }, scrimAction: 'cancel', actionAttr: ACTION_ATTR,
  });
}
/** Clear all slate games keeps its own confirm, its copy unchanged (DI-W69.6) - now the app's action sheet, not a browser dialog. */
export function clearSlateSheetHTML({ escHtml } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('clearSlateSheetHTML() requires the real escHtml');
  return actionSheetHTML({
    escHtml, titleId: 'slate-clear-title', title: SLATE_COPY.clearSlateTitle, message: SLATE_COPY.clearSlateMessage,
    danger: { label: SLATE_COPY.clearSlateAction, action: 'slate-clear-confirm' }, cancel: { label: SLATE_COPY.cancel, action: 'cancel' }, scrimAction: 'cancel', actionAttr: ACTION_ATTR,
  });
}

// ── the swap picker sheet's content (DI-W68.3; docs/mockups/d1/swap-picker.html) ───────────────────────────────────────────────────────────────────────────────────
/**
 * The scrolling body: the "Adding" card, then the slate's games as one radio group. `incoming` = { manual, name, caption }. `rows` = [{ gameId, name, caption, picks, aria }] in kickoff order.
 * Nothing is preselected (`selectedId` is null on open). The pick count is a COUNT only: no selection is shown, so the blind rule is untouched.
 */
export function swapPickerBodyHTML({ escHtml, incoming, rows = [], selectedId = null } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('swapPickerBodyHTML() requires the real escHtml');
  const adding = incoming && incoming.manual
    ? `<b>${escHtml(SLATE_COPY.manualIncoming)}</b><span class="swap-pk-sub">${escHtml(SLATE_COPY.manualIncomingNote)}</span>`
    : `<b>${escHtml(incoming && incoming.name || '')}</b><span class="swap-pk-sub">${escHtml(incoming && incoming.caption || '')}</span>`;
  const list = (Array.isArray(rows) ? rows : []).map((r) => {
    const on = r.gameId === selectedId;
    return `<button type="button" class="swap-pk-opt" role="radio" aria-checked="${on ? 'true' : 'false'}" data-swap-game="${escHtml(r.gameId)}" aria-label="${escHtml(r.aria || r.name)}">`
      + `<span class="swap-pk-l"><b>${escHtml(r.name)}</b><span class="swap-pk-sub">${escHtml(r.caption)}</span></span>`
      + `<span class="swap-pk-r">${Number(r.picks) > 0 ? `<span class="swap-pk-picks">${escHtml(SLATE_COPY.picksChip(Number(r.picks)))}</span>` : ''}<span class="swap-pk-dot" aria-hidden="true"></span></span></button>`;
  }).join('');
  return `<div class="swap-pk-adding"><p class="swap-pk-grp">${escHtml(SLATE_COPY.pickerAdding)}</p>${adding}</div>`
    + `<div class="swap-pk-out"><p class="swap-pk-grp">${escHtml(SLATE_COPY.pickerSwapOut)}</p><div class="swap-pk-list" role="radiogroup" aria-label="${escHtml(SLATE_COPY.pickerGroupLabel)}">${list}</div></div>`;
}

/** The footer, fixed above the safe area: the picks warning (only when the chosen game has picks) and the one primary button. `selected` = { name, picks } or null. */
export function swapPickerFooterHTML({ escHtml, icon = () => '', selected = null, manual = false } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('swapPickerFooterHTML() requires the real escHtml');
  const n = selected && Number(selected.picks) > 0 ? Math.floor(Number(selected.picks)) : 0;
  const label = manual ? SLATE_COPY.continueLabel : (n ? SLATE_COPY.swapAndDelete(n) : SLATE_COPY.swapLabelBtn);
  const warn = n ? `<div class="warning-box swap-pk-warn" role="status">${icon('warning')}<span>${escHtml(SLATE_COPY.picksWarning(n, selected.name, manual))}</span></div>` : '';
  return `${warn}<button type="button" class="btn btn-primary btn-block swap-pk-go" id="swap-picker-go"${selected ? '' : ' disabled'}>${escHtml(label)}</button>`;
}

// ── the operations (DI-W68.4), over injected deps ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
function nameOf(g) { return g ? `${g.awayTeam} @ ${g.homeTeam}` : ''; }

/**
 * Keeps an NFL-style week's tiebreaker-game reference valid after `goneGameId` left the slate. A profile with an alma-mater affinity (college) derives its tiebreaker from the
 * slate and needs nothing. When the week's `tiebreakerGameId` was the departed game, it is repointed to the latest-kickoff game that remains (the existing option/fields helpers; the
 * tiebreaker MATH is untouched, only the reference is kept valid), or cleared when no game remains. Returns the game it moved to, or null.
 */
function keepTiebreakerValid({ weekId, goneGameId, deps }) {
  const fresh = deps.getWeek(weekId);
  if (!fresh || fresh.tiebreakerGameId !== goneGameId) return { moved: false, to: null };
  const profile = deps.profileForWeek ? deps.profileForWeek(fresh) : null;
  if (profile && profile.affinity) return { moved: false, to: null };
  const remaining = deps.getGames(weekId);
  const opts = deps.tiebreakerGameOptions ? deps.tiebreakerGameOptions(remaining, { nameOf }) : [];
  const next = opts.length ? remaining.find((g) => g.gameId === opts[0].gameId) : null;
  const stamp = deps.now ? deps.now() : new Date().toISOString();
  if (!next) { deps.saveWeek({ ...fresh, tiebreakerGameId: null, updatedAt: stamp }); return { moved: true, to: null }; }
  const fields = deps.tiebreakerFieldsFor ? deps.tiebreakerFieldsFor({ week: fresh, game: next, profile, questionFor: deps.tiebreakerQuestionFor }) : null;
  if (!fields) return { moved: false, to: null };
  deps.saveWeek({ ...fresh, ...fields, updatedAt: stamp });
  return { moved: true, to: next };
}

/** The one plain add: a new slate game from `data`. Every add path ends here (the list, Player Requests, Add a game, the wizard's manual add). */
export function addGameToSlate({ weekId, data, deps } = {}) {
  const game = deps.createGame(weekId, { ...data, weekId });
  deps.saveGame(game);
  return game;
}

/**
 * Swap `outGameId` off the slate for the game described by `inData` (DI-W68.4). Re-reads the week and the slate from the mirror (never a render closure). Refuses, writing NOTHING, when the
 * out-game is gone or the incoming game is already on the slate. ADDS the new game first, then deletes the old (deleteGame cascades its picks and lock override): a throw between the two
 * leaves the slate one game long, never one short, and says so (`slateLong`). Then keeps the tiebreaker reference valid.
 * @returns {{ ok: true, added: object, removed: object, pickCount: number, tiebreakerMovedTo: object|null }
 *          | { ok: false, reason: 'missing_out'|'duplicate'|'no_incoming'|'write_failed', slateLong?: boolean, added?: object }}
 */
export function swapSlateGame({ weekId, outGameId, inData, deps } = {}) {
  const week = deps.getWeek(weekId);
  const games = deps.getGames(weekId);
  const out = games.find((g) => g.gameId === outGameId);
  if (!week || !out) return { ok: false, reason: 'missing_out' };
  if (!inData || typeof inData !== 'object') return { ok: false, reason: 'no_incoming' };
  if (slateMatchFor(inData, games)) return { ok: false, reason: 'duplicate' };
  const pickCount = deps.countPicksForGame(outGameId);
  let added = null;
  try {
    added = addGameToSlate({ weekId, data: inData, deps });
    deps.deleteGame(outGameId);
  } catch (err) {
    return { ok: false, reason: 'write_failed', slateLong: !!added, added: added || undefined, error: err };
  }
  let tb = { moved: false, to: null };
  try { tb = keepTiebreakerValid({ weekId, goneGameId: outGameId, deps }); } catch { tb = { moved: false, to: null }; }
  return { ok: true, added, removed: out, pickCount, tiebreakerMovedTo: tb.moved ? tb.to : null, tiebreakerMoved: tb.moved };
}

/** Remove one game from the slate (DI-W68.4 / DI-W69.3): deleteGame cascades the picks and the lock override; the tiebreaker reference is kept valid. */
export function removeGameFromSlate({ weekId, gameId, deps } = {}) {
  const games = deps.getGames(weekId);
  const out = games.find((g) => g.gameId === gameId);
  if (!out) return { ok: false, reason: 'missing_out' };
  const pickCount = deps.countPicksForGame(gameId);
  try { deps.deleteGame(gameId); } catch (err) { return { ok: false, reason: 'write_failed', error: err }; }
  let tb = { moved: false, to: null };
  try { tb = keepTiebreakerValid({ weekId, goneGameId: gameId, deps }); } catch { tb = { moved: false, to: null }; }
  return { ok: true, removed: out, pickCount, tiebreakerMovedTo: tb.moved ? tb.to : null, tiebreakerMoved: tb.moved };
}

/** The toast a finished remove shows (existing copy). */
export function removedToastText(pickCount) {
  return Number(pickCount) > 0 ? SLATE_COPY.removedPicks(Math.floor(Number(pickCount))) : SLATE_COPY.removedPlain;
}
