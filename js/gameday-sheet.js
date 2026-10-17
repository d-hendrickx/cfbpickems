/**
 * CFB Pickems — gameday-sheet.js (Deployment 1, Lane B, DI-605 rev 3, PF-420 / 447 / 448 / 452, security C2 / C3 / C4 / C5 / C7 / S1, 2026-10-08)
 * ==================================================================================================================================================
 * The OPEN Game Day card's body. The file name is kept although it is no longer a sheet: Drew (D-58) asked for "the red card itself [to] open up and expand rather than having a window pop up
 * from the bottom", so this is the markup that grows INSIDE the card (js/gameday.js owns the header, the pills and the card shell; js/home.js owns the height animation and the focus).
 *
 *   gameDayBodyHTML(model, ctx)       sub-line and freshness, "Your numbers", up to five rows grouped Live / Upcoming / Final, and the footer (the Dashboard button + Collapse).
 *   gameDayBodyErrorHTML(ctx)         the calm error state ("Live games couldn't load." + Retry); the header, the counts and the Dashboard button still render.
 *
 * THE ROW's FOUR LINES:  1 the matchup with the score   2 the status chip, the sport tag (two sports only) and the line (Favorite + margin — never a signed number)
 *                        3 YOUR coverage (▲ covering / ▽ trailing on a live game, never red; ✓ / ✗ only on a final)   4 the league — drawn ONLY by `picksRowHTML`.
 *
 * LOGOS (fix round 2, DI-605 line 1 / DI-572, PF-446): with Team logos on a row brackets its matchup with the shared 24 pt lockup (js/keyed-list.js teamLockupHTML) — the caller hands in the vetted URL
 * (`ctx.logoFor`); the logo events are bound on #page-home (js/app.js ensureHomeRoot), which holds the card, so a lockup here shows on load, falls back to its abbreviation on error and is primed on repaint.
 *
 * SECURITY. This module imports `picksRowHTML` and NO pick reader (S1: it is dropped from the list of modules that may hold another member's pick). Line 4 — the clusters, the "•••" form and any
 * per-side figure — comes only from `picksRowHTML` (js/pick-groups.js), after its gate, evaluated PER ROW for that game's own week (C2): a card holding CFB Live and NFL Locked draws clusters for
 * the CFB rows and the blind form for the NFL rows. A game of a sport the viewer has not joined is a plain score row — no personal line, no line 4 (C7). The members of a row come from
 * `ctx.resolve(row)` — the caller's `playersForCompetition(the game's competition, { weekId })` (C4) — never from this module. The escaper and `numHtml` are REQUIRED parameters (C5).
 */
import { picksRowHTML } from './pick-groups.js';
import { teamLockupHTML } from './keyed-list.js';

const requireFn = (f, name, who) => { if (typeof f !== 'function') throw new TypeError(`${who}() requires an injected ${name} function (CONVENTIONS #12, security C5): there is no fallback`); return f; };
const asArray = (v) => (Array.isArray(v) ? v : []);
const joinHtml = (parts) => parts.join('');

function coverageLine(row, { escHtml }) {
  if (!row.entered) return `<span class="gd-mut">Following — you're not in ${escHtml(row.sportLabel || 'these')} picks</span>`;
  const by = row.coverMargin ? ` by ${escHtml(row.coverMargin)}` : '';
  const team = row.coverTeam ? ` <span class="gd-mut">(${escHtml(row.coverTeam)})</span>` : '';
  switch (row.coverage) {
    case 'covering': return `<b class="gd-cov gd-cov--covering">▲ You're covering${by}</b>${team}`;
    case 'trailing': return `<b class="gd-cov gd-cov--trailing">▽ You're trailing${by}</b>${team}`;
    case 'even': return '<b class="gd-cov">You\'re right on the number</b>';
    case 'covered': return `<b class="gd-cov gd-cov--covered">✓ You covered${by}</b>`;
    case 'missed': return `<b class="gd-cov gd-cov--missed">✗ You missed${by}</b>`;
    case 'push': return '<b class="gd-cov">Your pick was a push</b>';
    case 'pending': return row.coverTeam ? `Your pick: <b>${escHtml(row.coverTeam)}</b>` : '<span class="gd-mut">No pick</span>';
    case 'follow': return '';                                       // signed out: no personal line at all (S4)
    default: return '<span class="gd-mut">No pick</span>';
  }
}

function statusChip(row, { escHtml }) {
  if (row.phase === 'live') return `<span class="gd-st gd-st--live"><span class="gd-st-dot" aria-hidden="true"></span>${escHtml(row.status)}</span>`;
  if (row.phase === 'live-stale') return '<span class="gd-st gd-st--stale">Score may be behind</span>';
  if (row.phase === 'final') return '<span class="gd-st gd-st--final">Final</span>';
  return `<span class="gd-st">${escHtml(row.kickoff || row.status || '')}</span>`;
}

/** One row. `resolve(row)` -> { game, week, entrants } | null (the caller's own data, by game id, never from the DOM). */
export function gameRowHTML(row, ctx) {
  const { escHtml, numHtml } = ctx;
  const CHEV = `<span class="gd-row-chev" aria-hidden="true">${ctx.rowChevHtml || ''}</span>`;   // the caller's constant glyph (chevronRight), spliced
  const hasScore = row.awayScore !== null && row.homeScore !== null && row.phase !== 'upcoming' && row.phase !== 'awaiting';
  const head = hasScore
    ? `${escHtml(row.away)} ${numHtml(row.awayScore)} – ${numHtml(row.homeScore)} ${escHtml(row.home)}`
    : `${escHtml(row.away)} at ${escHtml(row.home)}`;
  const tag = row.sportLabel && ctx.showSport ? `<span class="gd-st gd-st--sp">${escHtml(row.sportLabel)}</span>` : '';
  const line = row.line ? `<span>${escHtml(row.line)}</span>` : '';
  let league = '';
  if (row.entered) {
    let r = null;
    try { r = ctx.resolve ? ctx.resolve(row) : null; } catch { r = null; }
    if (r && r.game && r.week) {
      try { league = picksRowHTML({ game: r.game, week: r.week, entrants: r.entrants, viewerId: ctx.viewerId, view: ctx.view, form: 'card', escHtml, numHtml }); } catch (e) { league = ''; }
    }
  }
  const cov = coverageLine(row, { escHtml });
  // DI-605 line 1 / DI-572 (PF-446): with Team logos on, the shared lockup (24 pt) brackets the matchup — the away team's before it, the home team's after — the abbreviation always inside it. `ctx.logoFor(row, side)`
  // is the caller's vetted URL (Team logos on AND logoOk) or null; with both null (the switch off: the shipped default) the row is text only, as it was.
  let la = null, lh = null;
  try { la = ctx.logoFor ? ctx.logoFor(row, 'away') : null; lh = ctx.logoFor ? ctx.logoFor(row, 'home') : null; } catch { la = null; lh = null; }
  const logos = !!(la || lh);
  const lockup = (name, abbr, url) => `<span class="gd-tm">${teamLockupHTML({ name, abbr, logoUrl: url, escHtml, size: 'sm' })}</span>`;
  const r1 = logos
    ? `<span class="gd-r1-m">${lockup(row.away, row.awayAbbr, la)}<span class="gd-r1-t" data-bind="score">${head}</span>${lockup(row.home, row.homeAbbr, lh)}</span>`
    : `<span class="gd-r1-t" data-bind="score">${head}</span>`;
  return `<button type="button" class="gd-row" data-key="r:${escHtml(row.gameId)}" data-home-action="gd-row" data-game-id="${escHtml(row.gameId)}" data-restore-key="gd:${escHtml(row.gameId)}" data-haptic="medium">`
    + `<span class="gd-r1">${r1}${CHEV}</span>`
    + `<span class="gd-r2">${statusChip(row, { escHtml })}${tag}${line}</span>`
    + (cov ? `<span class="gd-r3">${cov}</span>` : '')
    + (league ? `<span class="gd-r4">${league}</span>` : '')
    + '<span class="sr-only">. Opens game.</span></button>';
}

function groupLabel(text, n, { escHtml, numHtml }) { return `<p class="gd-lbl" data-key="lbl:${escHtml(text)}">${escHtml(text)} · ${numHtml(n)}</p>`; }

/**
 * @param {object} model  gameDayModel's result
 * @param {{escHtml:Function, numHtml:Function, resolve:Function, viewerId:string, view:string}} ctx
 */
export function gameDayBodyHTML(model, ctx = {}) {
  const { escHtml, numHtml } = ctx;
  requireFn(escHtml, 'escHtml', 'gameDayBodyHTML');
  requireFn(numHtml, 'numHtml', 'gameDayBodyHTML');
  const m = model && typeof model === 'object' ? model : {};
  const c = { ...ctx, showSport: m.showSport === true };
  const rows = asArray(m.rows);
  const sub = `<p class="gd-sub">${escHtml(m.sub || '')}${m.freshness && m.freshness.text ? `<br><span class="${m.freshness.stale ? 'gd-st gd-st--stale' : 'gd-cap'}">${escHtml(m.freshness.text)}</span>` : ''}</p>`;
  // DI-603 (fix round 1): under accessibility-size text the header no longer carries "You: 3–1 · 2nd" (gameday.js drops it); it is the first line of "Your numbers" here, with the header's own spoken label.
  const me = ctx.railHidden === true && m.expandable === true && m.header && m.header.me
    ? `<p class="gd-stat gd-stat--me"${m.header.meAria ? ` aria-label="${escHtml(m.header.meAria)}"` : ''}>${escHtml(m.header.me)}</p>` : '';
  const lines = m.stats ? m.stats.lines : [], notes = m.stats ? m.stats.notes : [];
  const stats = me || lines.length || notes.length
    ? `<div class="gd-stats">${me}${lines.map(l => `<p class="gd-stat">${escHtml(l)}</p>`).join('')}${notes.map(n => `<p class="gd-stat gd-stat--note">${escHtml(n)}</p>`).join('')}</div>`
    : '';
  let list;
  if (rows.length >= 5) {
    const sec = (label, g) => { const x = rows.filter(r => r.group === g); return x.length ? groupLabel(label, x.length, c) + x.map(r => gameRowHTML(r, c)).join('') : ''; };
    list = sec('Live', 'live') + sec('Upcoming', 'upcoming') + sec('Final', 'final');
  } else list = rows.map(r => gameRowHTML(r, c)).join('');
  const scope = m.footer && m.footer.scope ? ` data-scope="${escHtml(m.footer.scope)}"` : '';
  const foot = `<div class="gd-foot"><button type="button" class="btn feed-action feed-action--solid gd-btn" data-home-action="gd-dashboard"${scope} data-haptic="light">${escHtml(m.footer ? m.footer.label : 'Open Dashboard')}</button><button type="button" class="btn feed-action feed-action--outline gd-btn" data-home-action="gd-collapse" data-haptic="light">Collapse</button></div>`;
  return joinHtml(['<div class="gd-x" id="gd-x" role="region" aria-labelledby="gd-h"><h3 class="gd-h" id="gd-h" tabindex="-1">Game Day</h3>', sub, stats, `<div class="gd-list" data-gd-list>${list}</div>`, foot, '</div>']);
}

/** The calm error state of the open card's rows. The header, the counts and the Dashboard button still render around it. */
export function gameDayBodyErrorHTML(model, { escHtml, numHtml } = {}) {
  requireFn(escHtml, 'escHtml', 'gameDayBodyErrorHTML');
  requireFn(numHtml, 'numHtml', 'gameDayBodyErrorHTML');
  const m = model && typeof model === 'object' ? model : {};
  return joinHtml(['<div class="gd-x" id="gd-x" role="region" aria-labelledby="gd-h"><h3 class="gd-h" id="gd-h" tabindex="-1">Game Day</h3>',
    `<p class="gd-sub">${escHtml(m.sub || '')}</p>`,
    '<div class="gd-error" role="status"><b>Live games couldn\'t load.</b><button type="button" class="btn feed-action feed-action--outline gd-btn" data-home-action="retry-load" data-haptic="light">Retry</button></div>',
    `<div class="gd-foot"><button type="button" class="btn feed-action feed-action--solid gd-btn" data-home-action="gd-dashboard" data-haptic="light">${escHtml(m.footer ? m.footer.label : 'Open Dashboard')}</button><button type="button" class="btn feed-action feed-action--outline gd-btn" data-home-action="gd-collapse" data-haptic="light">Collapse</button></div>`,
    '</div>']);
}
