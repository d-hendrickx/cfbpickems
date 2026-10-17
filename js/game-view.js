/**
 * CFB Pickems — game-view.js (Deployment 1, Lane B, DI-591 · DI-593 · DI-610, PF-452 rev 3, 2026-10-08)
 * =====================================================================================================
 * The GAME VIEW: the one-game pushed screen a row of the open Game Day card opens (and a card detail's "Open game"). Drew, D-63: "clicking into the game from gameday should [show] home feed cards relevant to
 * that game". Top to bottom, 16 pt apart:
 *   1 Score card         two team lockups, the score, the status chip, the freshness line, the line (Favorite + margin) and the cover line
 *   2 League picks       YOUR coverage, then the league's picks — drawn ONLY by `picksRowHTML` (js/pick-groups.js, form 'panel') behind the gate — and, when there is nothing to draw, the calm reason why
 *   3 Game thread        "Game thread · n", the last two messages as a read-only preview, Open thread and Locker Room
 *   4 Related            the Home feed cards about this game (DI-610) — rendered by the caller with the feed's own card markup
 *   5 What's next        a FINAL game only (DI-593 / DI-599): the next shared opportunity, its button, and "See week results" (or when the results post)
 * Not built here (a later wave, with its security review): Share to chat (DI-597).
 *
 * This module is PURE markup over a finished model. It holds NO pick: the model carries the viewer's OWN coverage and the finished `picksHtml` string. The escaper and `numHtml` are REQUIRED parameters
 * (a missing one throws); every attribute is double-quoted; no template says "won", "lost", "clinched" or "decided" for a game that is not final (`coverWord` language only).
 *
 * IN-PLACE REPAINTS (DI-572(a), fix round 2). Every section carries `data-gv` (its key) and every part a score tick or a finish can change carries `data-bind` — the score, the status chip, the freshness line,
 * the line, the cover line, your coverage, the league's pick chips (keyed by member, `data-player-id`), the note and the thread preview (keyed by message). The shape of a section is the SAME in every state
 * (an empty part renders empty and is hidden by CSS), so a tick is a text patch: the lockups and their <img>s, the buttons, the focus and the scroll offset are the same afterwards (js/home.js
 * patchGameView, js/gameday-dom.js patchNode). `data-bind` always comes BEFORE `class` in a tag (the class stays the last attribute, which the suites' markup probes rely on).
 */
import { teamLockupHTML } from './keyed-list.js';

const requireFn = (f, name, who) => { if (typeof f !== 'function') throw new TypeError(`${who}() requires an injected ${name} function (CONVENTIONS #12, security C5): there is no fallback`); return f; };
const asArray = (v) => (Array.isArray(v) ? v : []);
const isStr = (v) => typeof v === 'string' && v !== '';

/** "Texas -6.5" / "Oklahoma +6.5" / "Texas PK": the picked team's side of the line, as DISPLAYED (Favorite + margin world — never a raw signed input, AD-03). '' while the line is unset. */
export function pickLineLabel(game, team) {
  if (!game || !isStr(team)) return '';
  const sv = game.lockedSpread !== null && game.lockedSpread !== undefined ? game.lockedSpread : game.spread;
  if (sv === null || sv === undefined || !Number.isFinite(Number(sv))) return team;
  const n = Number(sv);
  if (n === 0) return `${team} PK`;
  const abs = Math.abs(n);
  const favorite = game.favorite || (n < 0 ? game.homeTeam : game.awayTeam);
  return `${team} ${favorite === team ? '-' : '+'}${abs}`;
}

function coverSentence(own, { escHtml }) {
  if (!own || !own.kind) return '';
  const by = own.margin ? ` by ${escHtml(own.margin)}` : '';
  switch (own.kind) {
    case 'covering': return `<b class="gv-cov gv-cov--covering">▲ You're covering${by}</b>`;
    case 'trailing': return `<b class="gv-cov gv-cov--trailing">▽ You're trailing${by}</b>`;
    case 'even': return '<b class="gv-cov">You\'re right on the number</b>';
    case 'covered': return `<b class="gv-cov gv-cov--covered">✓ You covered${by}</b>`;
    case 'missed': return `<b class="gv-cov gv-cov--missed">✗ You missed${by}</b>`;
    case 'push': return '<b class="gv-cov">Your pick was a push</b>';
    default: return '';
  }
}

function statusChip(m, { escHtml }) {
  const p = m.phase || {};
  if (p.phase === 'live') return `<span class="gd-st gd-st--live"><span class="gd-st-dot${p.pulse === false ? ' gd-st-dot--still' : ''}" aria-hidden="true"></span>${escHtml(p.label || 'Live')}</span>`;
  if (p.phase === 'live-stale') return '<span class="gd-st gd-st--stale">Score may be behind</span>';
  if (p.phase === 'final') return '<span class="gd-st gd-st--final">Final</span>';
  return `<span class="gd-st">${escHtml(p.label || '')}</span>`;
}

function scoreCard(m, { escHtml, numHtml }) {
  const g = m.game;
  const hasScore = g.awayScore !== null && g.homeScore !== null && !['upcoming', 'awaiting'].includes((m.phase || {}).phase);
  const big = hasScore ? `${numHtml(g.awayScore)}<span class="gv-dash" aria-hidden="true">–</span>${numHtml(g.homeScore)}` : '<span aria-hidden="true">—</span>';
  const team = (name, abbr, rank, logo) => `<div class="gv-team">${teamLockupHTML({ name, abbr, rank, logoUrl: logo || null, escHtml })}<span class="gv-team-name">${escHtml(name)}</span></div>`;
  return `<article class="card gv-card gv-score" data-gv="score">`
    + `<div class="gv-teams">${team(g.away, g.awayAbbr, g.awayRank, g.awayLogo)}<div data-bind="score" class="gv-big" aria-label="${hasScore ? `${escHtml(g.away)} ${numHtml(g.awayScore)}, ${escHtml(g.home)} ${numHtml(g.homeScore)}` : 'No score yet'}">${big}</div>${team(g.home, g.homeAbbr, g.homeRank, g.homeLogo)}</div>`
    + `<div data-bind="status" class="gv-status">${statusChip(m, { escHtml })}</div>`
    + `<p data-bind="fresh" class="gv-fresh${(m.phase || {}).phase === 'live-stale' ? ' gv-fresh--stale' : ''}">${m.freshness ? escHtml(m.freshness) : ''}</p>`
    + `<p data-bind="line" class="gv-line">${m.line ? `Line: ${escHtml(m.line)}` : ''}</p>`
    + `<p data-bind="cover" class="gv-neutral">${m.coverLine ? escHtml(m.coverLine) : ''}</p>`
    + '</article>';
}

function picksCard(m, ctx) {
  const { escHtml } = ctx;
  const own = m.own && m.own.kind && m.own.kind !== 'pending' && m.own.kind !== 'none' ? coverSentence(m.own, ctx) : '';
  // the viewer's OWN pick is always theirs to see (Std-8): before kickoff (also when they picked only part of a locked slate — coordinator decision, fix round 2) and in a hidden week
  const pick = m.own && m.own.team && (m.own.kind === 'pending' || m.picksState === 'hidden') ? `<p class="gv-yours">Your pick: <b>${escHtml(pickLineLabel(m.game.raw, m.own.team))}</b></p>` : '';
  const yours = `<div data-bind="yours" class="gv-yours-box">${own ? `<p class="gv-yours">${own}</p>` : ''}${pick}</div>`;
  const picks = `<div data-bind="picks" class="gv-picks">${isStr(m.picksHtml) ? m.picksHtml : ''}</div>`;
  const note = isStr(m.picksHtml) ? '' : `<p class="gv-note">${escHtml(m.picksNote || '')}</p>`;
  const action = !isStr(m.picksHtml) && m.picksAction ? `<div class="gv-actions"><button type="button" class="btn btn-primary gv-btn" data-gv-action="make-picks" data-haptic="medium">${escHtml(m.picksAction)}</button></div>` : '';
  return `<article class="card gv-card gv-picks-card" data-gv="picks"><h3 class="gv-h">League picks</h3>${yours}${picks}<div data-bind="note" class="gv-note-box">${note}${action}</div></article>`;
}

function threadCard(m, { escHtml, numHtml }) {
  const t = m.thread;
  if (!t || t.enabled === false) return '';
  // keyed by message (the preview's own id, else its position), so a new message arriving is ONE inserted row and the rest stay
  const preview = asArray(t.preview).map((x, i) => `<li data-key="${escHtml(isStr(x.id) ? `m:${x.id}` : `i:${i}`)}" class="gv-msg"><span class="gv-msg-who">${escHtml(x.who)}</span><span class="gv-msg-text">${escHtml(x.text)}</span><span class="gv-msg-when">${escHtml(x.when)}</span></li>`).join('');
  const empty = escHtml(m.phase && m.phase.phase === 'final' ? 'No one talked about this game.' : 'No messages about this game yet.');
  return `<article class="card gv-card gv-thread" data-gv="thread"><div class="gv-thread-head"><h3 data-bind="thread-count" class="gv-h">Game thread · ${numHtml(t.count)}</h3><span class="gv-cap">Also in the Locker Room</span></div>`
    + `<div data-bind="thread" class="gv-thread-box">${preview ? `<ul class="gv-msgs">${preview}</ul>` : `<p class="gv-note">${empty}</p>`}</div>`
    + `<div class="gv-actions"><button type="button" class="btn btn-primary gv-btn" data-gv-action="open-thread" data-haptic="light">Open thread</button><button type="button" class="btn btn-secondary gv-btn" data-gv-action="locker-room" data-haptic="light">Locker Room</button></div></article>`;
}

/**
 * DI-599 / DI-593 — "What's next" (a FINAL game only; the model carries it only then): the next shared opportunity as one sentence, its one button, then the week's results — "See week results" once the
 * week is server-confirmed final, otherwise the line that says when they post. One centred group of buttons, 8 pt apart (Breathing Room); the next action is primary only when picks are due.
 */
function nextCard(m, { escHtml }) {
  const w = m.whatsNext;
  if (!w) return '';
  const btn = (action, label, tone) => `<button type="button" class="btn ${tone === 'primary' ? 'btn-primary' : 'btn-secondary'} gv-btn" data-gv-action="${escHtml(action)}" data-haptic="${tone === 'primary' ? 'medium' : 'light'}">${escHtml(label)}</button>`;
  const buttons = [w.action ? btn(w.action.action, w.action.label, w.action.tone) : '', w.results && w.results.final ? btn('week-results', 'See week results', 'secondary') : ''].filter(Boolean).join('');
  const wait = w.results && !w.results.final ? `<p data-bind="next-results" class="gv-cap">${escHtml(`Week ${w.results.weekN} results post when the last game is final.`)}</p>` : '';
  return `<article class="card gv-card gv-next" data-gv="next"><h3 class="gv-h">What's next</h3><p data-bind="next-line" class="gv-note">${escHtml(w.line || '')}</p>${buttons ? `<div class="gv-actions">${buttons}</div>` : ''}${wait}</article>`;
}

/**
 * @param {object} m   the model home.js's resolveGameView() builds (see that function)
 * @param {{escHtml:Function, numHtml:Function}} ctx
 * @returns {string} the BODY markup of the pushed level
 */
export function gameViewHTML(m, ctx = {}) {
  const { escHtml, numHtml } = ctx;
  requireFn(escHtml, 'escHtml', 'gameViewHTML');
  requireFn(numHtml, 'numHtml', 'gameViewHTML');
  const c = { escHtml, numHtml };
  const related = isStr(m.relatedHtml)
    ? `<section class="gv-related" aria-label="Related" data-gv="related"><p class="gv-sect">Related</p><div data-bind="related" class="gv-related-list">${m.relatedHtml}</div>${m.relatedMore ? '<div class="gv-actions"><button type="button" class="btn btn-secondary gv-btn" data-gv-action="see-all-home" data-haptic="light">See all on Home</button></div>' : ''}</section>`
    : '';
  // the polite live region (DI-591 / DI-593): a keyed part of the screen like the sections, EMPTY in the markup — js/home.js writes a sentence into it only while focus is inside this screen
  const live = '<p data-gv="live" class="sr-only" data-gv-live role="status" aria-live="polite" aria-atomic="true"></p>';
  // DI-597 — "Share to chat", its own centred group at the end of the screen (the approved Game view frame, D-63): only when home.js offers it (a signed-in member, chat on). The icon is the caller's own markup.
  const share = m.share ? `<div class="gv-actions gv-share" data-gv="share"><button type="button" class="btn btn-secondary gv-btn" data-gv-action="share" data-haptic="light">${isStr(ctx.shareIconHtml) ? ctx.shareIconHtml : ''}${escHtml('Share to chat')}</button></div>` : '';
  return `<div class="gv" data-game-id="${escHtml(m.game.gameId)}">${scoreCard(m, c)}${picksCard(m, c)}${threadCard(m, c)}${related}${nextCard(m, c)}${share}${live}</div>`;
}

/** The nav bar's right slot: a prev / next pair when two or more games are live (44 × 44 pt each, disabled at the ends, never wrapping). `index` is 0-based within `n` live games. */
export function gameStepperHTML({ index, n }, { escHtml, prevHtml = '', nextHtml = '' }) {
  requireFn(escHtml, 'escHtml', 'gameStepperHTML');
  if (!Number.isInteger(index) || !Number.isInteger(n) || n < 2 || index < 0 || index >= n) return '';
  const label = `${index + 1} of ${n} live`;
  return `<span class="gv-step" role="group" aria-label="${escHtml(label)}"><button type="button" class="gv-step-btn gv-step-btn--prev" data-gv-action="prev" data-haptic="selection" aria-label="Previous live game, ${escHtml(label)}"${index === 0 ? ' disabled aria-disabled="true"' : ''}><span class="gv-step-glyph gv-step-glyph--prev" aria-hidden="true">${prevHtml}</span></button><button type="button" class="gv-step-btn gv-step-btn--next" data-gv-action="next" data-haptic="selection" aria-label="Next live game, ${escHtml(label)}"${index === n - 1 ? ' disabled aria-disabled="true"' : ''}><span class="gv-step-glyph gv-step-glyph--next" aria-hidden="true">${nextHtml}</span></button></span>`;
}

/** The calm "this screen can't be shown" state: a game that no longer exists or whose week this viewer may not see. */
export function gameUnavailableHTML({ escHtml }) {
  requireFn(escHtml, 'escHtml', 'gameUnavailableHTML');
  return `<div class="card gv-card gv-unavailable"><h3 class="gv-h">${escHtml("This game isn't available right now.")}</h3><p class="gv-note">${escHtml('It may have been removed or its week may not be open yet.')}</p><div class="gv-actions"><button type="button" class="btn btn-primary gv-btn" data-gv-action="back-home">Back to Home</button></div></div>`;
}
