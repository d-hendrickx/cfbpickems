/**
 * CFB Pickems - js/what-if-view.js (D2 lane 4 batch 2, third pass; DI-978 to 982; UN/PF-524; mockup docs/mockups/d2-analytics.html frame 5; 2026-10-21)
 * =================================================================================================================================================
 * THE WHAT-IF SCREEN, AS PURE STRING BUILDERS: the only visible surface of PF-524 ("What if I always took the favorite? ... the underdog? ... followed consensus? ... faded it? ... copied
 * another member? ... a team every time? ... week by week ... perfect cards and one miss away"). No DOM, no storage, no network, no clock. The data is js/analytics/what-if.js (the engine's
 * own strategy metrics); this file only words and draws it.
 *
 *   whatIfModel(parts, { open, table, picker })   the screen's model (rows, the pickers, perfect cards, the thin / none states, the in-place disclosure state)
 *   whatIfHTML(model, { escHtml, icon })           its markup, in the card-detail vocabulary plus a few .wi-* additions
 *
 * RETROSPECTIVE ONLY (RPF-D2): the caption "Looking back only. This replays your past picks and isn't a prediction or advice." is the screen's first element in every state that shows a
 * strategy and has no control that dismisses it. NO MONEY: no currency symbol, no price, none of the words DI-982 bans (`WHAT_IF_COPY` is linted by counterfactualtest V). Counts are pick
 * counts, never league points. The bars are DECORATION (`aria-hidden`), drawn in the brand accent and the secondary text colour, never the win / loss colours (they are not game results);
 * each strategy row's accessible name says the whole result in words and a real table twin carries every number.
 *
 * EVERY dynamic string crosses the injected `escHtml` at the sink (a missing one throws); every button carries an allow-listed `data-ins-action` the dispatcher re-checks against the CURRENT model.
 */

export const WHAT_IF_COPY = Object.freeze({
  title: 'What if',
  caption: "Looking back only. This replays your past picks and isn't a prediction or advice.",
  scope: (sportCode, season, games) => `${sportCode} ${season} · ${games} ${games === 1 ? 'game' : 'games'} · pick counts, not league points`,
  thin: 'What if needs about 12 graded picks.', thinCount: (n) => `You have ${n}.`,
  none: 'Nothing to show yet.', noneBody: 'Insights start after your first final week.',
  yours: (r) => `Yours ${r}`, would: (r) => `Would have been ${r}`,
  leftOut: (games, n) => `On the same ${games} games; ${n} ${n === 1 ? 'game' : 'games'} left out where the others split.`,
  legend: 'Accent: the strategy. Gray: yours. Right of the line is more wins than losses so far.',
  showGames: 'Show the games', table: 'Show as a table', tableHide: 'Hide the table', week: 'Week', yoursCol: 'Yours', wouldCol: 'Would have been',
  copy: 'What if I copied…', copyPick: 'Pick a member', copying: (name) => `Copying ${name}`, copyNone: 'No one shares 15 graded games with you yet.', copyGames: (n) => `${n} graded ${n === 1 ? 'game' : 'games'} you both picked`,
  team: 'Choose another team…', teamGames: (n) => `${n} ${n === 1 ? 'game' : 'games'} on your picks`, teamPick: 'Pick a team',
  perfect: 'Perfect cards', perfectLine: (p, o) => `Perfect cards: ${p}. One miss away: ${o}.`,
  perfectWeeks: (ws) => `${ws.length === 1 ? 'Week' : 'Weeks'} ${listWords(ws)} ${ws.length === 1 ? 'was' : 'were'} one miss away.`,
  perfectList: (ws) => `${ws.length === 1 ? 'Week' : 'Weeks'} ${listWords(ws)}: no misses.`,
  perfectBasis: (n) => `Across ${n} ${n === 1 ? 'week' : 'weeks'} with at least five graded picks.`,
  strategies: 'Strategies', unavailable: "This isn't available right now.",
});
const listWords = (xs) => (xs.length <= 1 ? String(xs[0] ?? '') : xs.length === 2 ? `${xs[0]} and ${xs[1]}` : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const wl = (r) => `${r.w}-${r.l}${r.p ? `-${r.p}` : ''}`;
const diffText = (d) => (d === 0 ? 'Same record' : `${d > 0 ? '+' : '−'}${Math.abs(d)} ${Math.abs(d) === 1 ? 'win' : 'wins'}`);
const diffWords = (d) => (d === 0 ? 'The same number of wins.' : `${d > 0 ? 'Plus' : 'Minus'} ${Math.abs(d)} ${Math.abs(d) === 1 ? 'win' : 'wins'}.`);
const spoken = (r) => `${r.w} and ${r.l}${r.p ? `, with ${r.p} ${r.p === 1 ? 'push' : 'pushes'}` : ''}`;
/** DI-982's accessible sentence: "Always take the favorite. You went 20 and 18. This would have been 24 and 14. Plus 4 wins." */
export const rowLabel = (row) => `${row.name}. You went ${spoken(row.yours)}. This would have been ${spoken(row.would)}. ${diffWords(row.diff)}`;

/**
 * @param {object} parts  whatIfParts(...)'s answer (or null)
 * @param {{ open?: string|null, table?: boolean, picker?: 'copy'|'team'|null }} state  which row is expanded, the table twin shown, which picker is open
 */
export function whatIfModel(parts, state = {}) {
  const p = parts || null;
  if (!p) return null;
  const rowOf = (r, kind) => ({ key: kind === 'strategy' ? r.key : kind, kind, name: r.name, id: typeof r.id === 'string' ? r.id : null, yours: r.yours, would: r.would, diff: r.diff, games: r.games, leftOut: r.leftOut || 0, weeks: Array.isArray(r.weeks) ? r.weeks : null });
  const rows = (p.rows || []).map((r) => rowOf(r, 'strategy'));
  if (p.copy && p.copy.chosen) rows.push(rowOf(p.copy.chosen, 'copy'));
  if (p.team && p.team.chosen) rows.push(rowOf(p.team.chosen, 'team'));
  if (p.never) rows.push(rowOf(p.never, 'never'));        // pick history (the platform setting on): about the viewer only, never shareable
  const keys = new Set(rows.map((r) => r.key));
  return {
    sport: p.sport || '', season: p.season || '', none: p.none === true, thin: p.thin || null, games: p.games || 0,
    scope: WHAT_IF_COPY.scope(String(p.sport || '').toUpperCase(), p.season || '', p.games || 0),
    rows,
    copy: { choices: (p.copy && p.copy.choices) || [], chosenId: p.copy && p.copy.chosen ? p.copy.chosen.memberId : null },
    team: { choices: (p.team && p.team.choices) || [], chosenKey: p.team && p.team.chosen ? p.team.chosen.teamKey : null },
    perfect: p.perfect || null,
    open: keys.has(state.open) ? state.open : null, table: state.table === true, picker: state.picker === 'copy' || state.picker === 'team' ? state.picker : null,
  };
}

const requireEsc = (e, who) => { if (typeof e !== 'function') throw new TypeError(`${who}() requires an injected escHtml function (CONVENTIONS #12) - it is never defaulted`); return e; };
const glyph = (iconFn, name, cls) => (typeof iconFn === 'function' && name ? `<span class="${cls}" aria-hidden="true">${iconFn(name)}</span>` : '');
const safeKey = (k) => String(k).replace(/[^a-z0-9_-]/gi, '');

/** one week's two bars on a zero line: the accent bar is the strategy, the secondary one the actual; each a share of the largest absolute value on screen (numbers this file computes) */
function barsHTML(row, esc) {
  const max = Math.max(1, ...row.weeks.map((w) => Math.max(Math.abs(w.yours), Math.abs(w.would))));
  // a bar runs right of the zero line when the running record is ahead, left when behind; a zero is an 8 pt stub on the line. `f` is a number this file computes (at most 0.5: half the track)
  const bar = (v, would) => `<i class="wi-b ${would ? 'wi-b--would' : 'wi-b--yours'}${v < 0 ? ' wi-b--neg' : v === 0 ? ' wi-b--zero' : ''}" style="--f:${Math.round((Math.abs(v) / max) * 500) / 1000}"></i>`;
  return `<div class="wi-bars" aria-hidden="true">${row.weeks.map((w) => `<div class="wi-bar"><span class="wi-bar-wk">${esc('W' + w.n)}</span><span class="wi-track">${bar(w.would, true)}${bar(w.yours, false)}</span></div>`).join('')}</div>`;
}
function tableHTML(row, esc, visible) {
  return `<div class="wi-table${visible ? '' : ' sr-only'}"><table class="ins-table"><caption class="sr-only">${esc(row.name)}, week by week</caption><thead><tr><th scope="col">${esc(WHAT_IF_COPY.week)}</th><th scope="col">${esc(WHAT_IF_COPY.yoursCol)}</th><th scope="col">${esc(WHAT_IF_COPY.wouldCol)}</th></tr></thead><tbody>${row.weeks.map((w) => `<tr><th scope="row">${esc(String(w.n))}</th><td>${esc(wl(w.yoursRec))}</td><td>${esc(wl(w.wouldRec))}</td></tr>`).join('')}</tbody></table></div>`;
}

function rowHTML(m, row, esc, icon) {
  const open = m.open === row.key;
  const k = safeKey(row.key);
  const inner = [];
  if (row.leftOut) inner.push(`<p class="cd-fresh">${esc(WHAT_IF_COPY.leftOut(row.games, row.leftOut))}</p>`);
  if (row.weeks && row.weeks.length) {
    if (!m.table) inner.push(barsHTML(row, esc), `<p class="cd-fresh">${esc(WHAT_IF_COPY.legend)}</p>`);
    inner.push(tableHTML(row, esc, m.table));
  }
  if (row.id) inner.push(`<button type="button" class="btn cd-more" data-ins-action="wi-games" data-ins-key="${esc(row.key)}" data-restore-key="${esc('wi:' + row.key)}">${esc(WHAT_IF_COPY.showGames)}</button>`);
  return `<div class="ins-xp wi-row" data-xp="${esc(row.key)}" data-open="${open ? 'true' : 'false'}">`
    + `<button type="button" class="cd-item ins-row" data-ins-action="wi-row" data-ins-key="${esc(row.key)}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="wi-xp-${esc(k)}" aria-label="${esc(rowLabel(row))}">`
    + `<span class="cd-item-main"><span class="cd-item-title">${esc(row.name)}</span><span class="cd-item-sub">${esc(WHAT_IF_COPY.yours(wl(row.yours)))} · ${esc(WHAT_IF_COPY.would(wl(row.would)))}</span></span><span class="wi-diff">${esc(diffText(row.diff))}</span>${glyph(icon, 'chevronRight', 'ins-row-chev ins-xp-chev')}</button>`
    + `<div class="ins-xp-body" id="wi-xp-${esc(k)}"><div class="ins-xp-in">${inner.join('')}</div></div></div>`;
}

function pickerHTML(m, which, esc, icon) {
  const isCopy = which === 'copy';
  const choices = isCopy ? m.copy.choices : m.team.choices.filter((c) => c.key !== m.team.chosenKey);
  const title = isCopy ? WHAT_IF_COPY.copy : WHAT_IF_COPY.team;
  if (!choices.length) return isCopy ? `<div class="cd-item ins-row ins-row--static"><span class="cd-item-main"><span class="cd-item-title">${esc(title)}</span><span class="cd-item-sub">${esc(WHAT_IF_COPY.copyNone)}</span></span></div>` : '';
  const open = m.picker === which;
  const chosenName = isCopy && m.copy.chosenId ? (m.copy.choices.find((c) => c.id === m.copy.chosenId) || {}).name : '';
  const items = choices.map((c) => (isCopy
    ? `<button type="button" class="cd-item ins-row" data-ins-action="wi-copy" data-ins-member="${esc(c.id)}"${c.id === m.copy.chosenId ? ' aria-current="true"' : ''}><span class="cd-item-main"><span class="cd-item-title">${esc(c.name)}</span><span class="cd-item-sub">${esc(WHAT_IF_COPY.copyGames(c.games))}</span></span></button>`
    : `<button type="button" class="cd-item ins-row" data-ins-action="wi-team" data-ins-team="${esc(c.key)}"><span class="cd-item-main"><span class="cd-item-title">${esc(c.name)}</span><span class="cd-item-sub">${esc(WHAT_IF_COPY.teamGames(c.games))}</span></span></button>`)).join('');
  return `<div class="ins-xp wi-picker" data-xp="${esc(which)}" data-open="${open ? 'true' : 'false'}"><button type="button" class="cd-item ins-row" data-ins-action="wi-picker" data-ins-picker="${esc(which)}" aria-expanded="${open ? 'true' : 'false'}" aria-controls="wi-pick-${esc(which)}"><span class="cd-item-main"><span class="cd-item-title">${esc(title)}</span><span class="cd-item-sub">${esc(isCopy ? (chosenName ? WHAT_IF_COPY.copying(chosenName) : WHAT_IF_COPY.copyPick) : WHAT_IF_COPY.teamPick)}</span></span>${glyph(icon, 'chevronRight', 'ins-row-chev ins-xp-chev')}</button>`
    + `<div class="ins-xp-body" id="wi-pick-${esc(which)}"><div class="ins-xp-in ins-xp-in--rows">${items}</div></div></div>`;
}

/** The screen body. A null model is the calm unavailable state. */
export function whatIfHTML(model, { escHtml, icon } = {}) {
  const esc = requireEsc(escHtml, 'whatIfHTML');
  const m = model;
  if (!m) return `<div class="cd wi"><section class="card cd-card" role="status"><h3 class="cd-title">${esc(WHAT_IF_COPY.unavailable)}</h3></section></div>`;
  const caption = `<p class="wi-pin" role="note">${esc(WHAT_IF_COPY.caption)}</p>`;
  if (m.none) return `<div class="cd wi">${caption}<section class="card cd-card" role="status"><h3 class="cd-title">${esc(WHAT_IF_COPY.none)}</h3><p class="cd-body">${esc(WHAT_IF_COPY.noneBody)}</p></section></div>`;
  if (m.thin) return `<div class="cd wi">${caption}<section class="card cd-card" role="status"><h3 class="cd-title">${esc(WHAT_IF_COPY.thin)}</h3><p class="cd-body">${esc(WHAT_IF_COPY.thinCount(m.thin.n))}</p></section></div>`;
  const strategies = m.rows.filter((r) => r.kind === 'strategy').map((r) => rowHTML(m, r, esc, icon)).join('');
  const copyRow = m.rows.find((r) => r.kind === 'copy');
  const teamRow = m.rows.find((r) => r.kind === 'team');
  const neverRow = m.rows.find((r) => r.kind === 'never');
  const group = `<section class="card cd-card wi-group" aria-label="${esc(WHAT_IF_COPY.strategies)}">${strategies}${pickerHTML(m, 'copy', esc, icon)}${copyRow ? rowHTML(m, copyRow, esc, icon) : ''}${teamRow ? rowHTML(m, teamRow, esc, icon) : ''}${teamRow ? pickerHTML(m, 'team', esc, icon) : ''}${neverRow ? rowHTML(m, neverRow, esc, icon) : ''}</section>`;
  const anyWeeks = m.rows.some((r) => r.weeks && r.weeks.length);
  const table = anyWeeks ? `<section class="card cd-card wi-table-card"><button type="button" class="ins-disc" data-ins-action="wi-table" aria-pressed="${m.table ? 'true' : 'false'}"><span>${esc(m.table ? WHAT_IF_COPY.tableHide : WHAT_IF_COPY.table)}</span>${glyph(icon, 'chevronRight', 'ins-disc-chev')}</button></section>` : '';
  const pc = m.perfect;
  const perfect = pc ? `<section class="card cd-card wi-perfect" aria-labelledby="wi-h-perfect"><h4 class="cd-h" id="wi-h-perfect">${esc(WHAT_IF_COPY.perfect)}</h4><p class="cd-body">${esc(WHAT_IF_COPY.perfectLine(pc.perfect, pc.oneMissAway))}</p>${pc.perfectWeeks.length ? `<p class="cd-fresh">${esc(WHAT_IF_COPY.perfectList(pc.perfectWeeks))}</p>` : ''}${pc.oneMissWeeks.length ? `<p class="cd-fresh">${esc(WHAT_IF_COPY.perfectWeeks(pc.oneMissWeeks))}</p>` : ''}<p class="cd-fresh">${esc(WHAT_IF_COPY.perfectBasis(pc.weeksCounted))}</p></section>` : '';
  return `<div class="cd wi">${caption}<p class="ask-scope wi-scope">${esc(m.scope)}</p>${group}${table}${perfect}</div>`;
}
