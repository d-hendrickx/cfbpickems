/**
 * CFB Pickems - js/game-insights-view.js (D2 lane 4 batch 2, third pass; DI-974, DI-976, DI-977, DI-1087; UN/PF-523, UN/PF-543; mockup docs/mockups/d2-analytics.html frames 6 and 9; 2026-10-21)
 * ==================================================================================================================================================================================
 * GAME DAY'S "few live consequences", AS PURE STRING BUILDERS: the Insights row on a live or final game's own screen, and the Game insights sheet behind it. No DOM, no storage, no network,
 * no clock. The facts are the engine's (js/analytics/m-gameday.js gameDayInsights: ranked, at most two visible and six in all per game); their sentences are copy.js's gdFactLine; the wire
 * (analytics-wire.js gameDay) builds them over the SAME server-confirmed gate as every other analytics surface (a week enters only when the server says live or final and, in Supabase mode,
 * its picks read has landed). This file only draws what it is handed.
 *
 *   gameInsightsRowHTML(row, { escHtml, icon })           the 56 pt row "Insights (n)" with the live or settled line, a keyed section of the Game view (data-gv="insights")
 *   withInsightsRow(gameViewHtml, rowHtml)               splices that row in right after the Game view's score card (the Game view itself is lane 3's markup and is never edited here)
 *   gameInsightsBodyHTML(model, { escHtml, icon })        the sheet's body: the live / settled line with its as-of time, two rows then "Show {n} more", each row opening in place to its
 *                                                        figures and two actions (Ask SCRIBE, Open details); a polite live region the sheet writes only when YOUR place changes
 *
 * NOTHING HERE IS SHAREABLE (DI-977: a projection goes stale in the chat). A live fact is tentative (no win / loss colour, never "won" or "lost"); a settled one uses the result marks.
 * EVERY dynamic string crosses the injected `escHtml` at the sink (a missing one throws); every button carries an allow-listed `data-gdi-action` the sheet re-checks against the CURRENT facts.
 */

/** 1st, 2nd, 3rd, 4th ... (the engine's own rule; this view imports nothing from js/analytics: only the wire and the server bridge may, analyticsstatictest [3]) */
const ordinal = (n) => { const v = Number(n) % 100, suf = ['th', 'st', 'nd', 'rd']; return `${n}${suf[(v - 20) % 10] || suf[v] || suf[0]}`; };

export const GDI_COPY = Object.freeze({
  title: 'Insights', row: (n) => `Insights (${n})`, live: 'Live · updates as the game goes', settled: 'Final · settled', asOf: (t) => `as of ${t}`,
  more: (n) => `Show ${n} more`, fewer: 'Show fewer', ask: 'Ask SCRIBE', details: 'Open details', rowLabel: (n, live) => `Insights about this game, ${n}. ${live ? 'Live, updates as the game goes.' : 'Final.'} Opens the list.`,
  unavailable: "These insights aren't available right now.",
});

const plural = (n, one, many) => (n === 1 ? one : many);

/** A Game Day fact's figures (the row opened in place, and its detail): numbers and closed words only, never a probability, never a signed number. `ctx` as copy.js gdFactLine's. */
export function gdFigures(f, ctx) {
  if (!f) return [];
  const you = (id) => id === ctx.viewerId;
  const fig = (value, label) => ({ value: String(value), label: String(label) });
  switch (f.kind) {
    case 'gd.consequence': return [fig(ordinal(f.fromRank), 'now'), fig(`${f.tied ? 'tied for ' : ''}${ordinal(f.toRank)}`, 'if the live games hold')];
    case 'gd.swing': return [fig(f.places, plural(f.places, 'place in play', 'places in play'))];
    case 'gd.only_backer': {
      const side = fig(f.team, you(f.memberId) ? 'your side, alone' : `${String(ctx.nameOf(f.memberId))}, alone`);
      if (f.state === 'final_win') return [side, fig('Covered', 'final')];
      if (f.state === 'final_loss') return [side, fig('Did not cover', 'final')];
      if ((f.state === 'covering' || f.state === 'trailing') && Number.isFinite(f.by)) return [side, fig(f.by, f.state === 'covering' ? 'covering by' : 'trailing by')];
      return [side];
    }
    case 'gd.disagreement': return [fig(String(ctx.nameOf(f.memberId)), 'on the other side')];
    case 'gd.path_to_win': {
      const left = fig(f.rem, plural(f.rem, 'pick left', 'picks left'));
      if (f.state === 'clinched') return [fig('Clinched', 'this week')];
      if (f.state === 'out') return [fig('Out', 'this week')];
      if (f.state === 'leading') return [fig(f.d, 'ahead'), left];
      if (f.state === 'level') return [fig('Level', 'at the top'), left];
      return [fig(f.d, 'behind the lead'), left];
    }
    case 'gd.milestone': return [fig(f.mark, 'correct picks')];
    case 'gd.followed_team': {
      const rec = f.sport === 'nhl' ? `${f.w}-${f.l}-${f.otl}` : f.t ? `${f.w}-${f.l}-${f.t}` : `${f.w}-${f.l}`;
      return [fig(rec, 'record'), f.streak ? fig(`${f.runKind === 'W' ? 'Won' : 'Lost'} ${f.run}`, 'straight') : fig((f.last || []).join(' '), `last ${(f.last || []).length}`)];
    }
    default: return [];
  }
}

/** "How this is counted" for a Game Day fact (its detail's disclosure). */
export function gdDefinition(f) {
  switch (f && f.kind) {
    case 'gd.consequence': return 'Every live game is counted as if it ended at its current score, against its locked line. Scheduled games count for nothing yet. A tie stays a tie: no tiebreaker is used.';
    case 'gd.swing': return 'The places this game moves you: every live game as it stands, against this one going the other way.';
    case 'gd.only_backer': return "This week's revealed picks. A live score can still change.";
    case 'gd.disagreement': return 'You and one other member took opposite sides, and this game alone changes who is ahead on the week.';
    case 'gd.path_to_win': return 'Correct picks this week so far, and the picks each member still has to play. No prediction.';
    case 'gd.milestone': return 'Season correct picks, counted once per mark.';
    case 'gd.followed_team': return 'Public team data from ESPN. No picks.';
    default: return '';
  }
}

const requireEsc = (e, who) => { if (typeof e !== 'function') throw new TypeError(`${who}() requires an injected escHtml function (CONVENTIONS #12) - it is never defaulted`); return e; };
const glyph = (iconFn, name, cls) => (typeof iconFn === 'function' && name ? `<span class="${cls}" aria-hidden="true">${iconFn(name)}</span>` : '');

/** The Insights row (DI-977 entry): only when at least one fact exists (no skeleton, no zero). `row` = { total, live } | null. */
export function gameInsightsRowHTML(row, { escHtml, icon } = {}) {
  const esc = requireEsc(escHtml, 'gameInsightsRowHTML');
  if (!row || !Number.isInteger(row.total) || row.total < 1) return '';
  return `<button type="button" class="card gdi-entry" data-gv="insights" data-gv-action="insights" data-restore-key="gdi:open" aria-haspopup="dialog" aria-label="${esc(GDI_COPY.rowLabel(row.total, row.live === true))}" data-haptic="light">`
    + `${glyph(icon, 'scribeSpark', 'gdi-entry-icon')}<span class="cd-item-main"><span class="cd-item-title">${esc(GDI_COPY.row(row.total))}</span><span class="cd-item-sub">${esc(row.live === true ? GDI_COPY.live : GDI_COPY.settled)}</span></span>${glyph(icon, 'chevronRight', 'ins-row-chev')}</button>`;
}

/**
 * Splices the row into the Game view's markup right after its score card (mockup frame 6: the score, then the row), as one more keyed section the Game view's in-place patcher reconciles
 * (it appears with the shipped gv-enter fade, and goes when the facts go). No row: the markup is returned untouched. A markup it does not recognise gets the row before its live region.
 */
export function withInsightsRow(html, rowHtml) {
  if (typeof html !== 'string' || !rowHtml) return html;
  const at = html.indexOf('data-gv="score"');
  const end = at >= 0 ? html.indexOf('</article>', at) : -1;
  if (end >= 0) return html.slice(0, end + 10) + rowHtml + html.slice(end + 10);
  const live = html.indexOf('<p data-gv="live"');
  if (live >= 0) return html.slice(0, live) + rowHtml + html.slice(live);
  return html;
}

/**
 * The sheet body. model = { facts: [{ fid, line, figures: [{ value, label }], mark?, tone? }], visibleN, live, asOfText, more (bool: "Show more" opened), open (fid | null) } | null.
 */
export function gameInsightsBodyHTML(model, { escHtml, icon } = {}) {
  const esc = requireEsc(escHtml, 'gameInsightsBodyHTML');
  const m = model;
  if (!m || !Array.isArray(m.facts) || !m.facts.length) return `<div class="gdi" data-gdi><p class="cd-body" role="status">${esc(GDI_COPY.unavailable)}</p></div>`;
  const visibleN = Math.max(1, Math.min(m.facts.length, Number.isInteger(m.visibleN) ? m.visibleN : 2));
  const head = `<p class="cd-fresh gdi-live">${esc(m.live ? GDI_COPY.live : GDI_COPY.settled)}${m.asOfText ? ` · ${esc(GDI_COPY.asOf(m.asOfText))}` : ''}</p>`;
  const rows = m.facts.map((f, i) => {
    const open = m.open === f.fid;
    const figs = Array.isArray(f.figures) && f.figures.length ? `<div class="ins-figs">${f.figures.map((x) => `<div class="ins-fig"><b class="ins-fig-v">${esc(x.value)}</b><span class="ins-fig-l">${esc(x.label)}</span></div>`).join('')}</div>` : '';
    const mark = f.mark ? `<span class="cd-mark cd-mark--${f.tone === 'win' ? 'win' : f.tone === 'loss' ? 'loss' : f.tone === 'covering' ? 'covering' : f.tone === 'trailing' ? 'trailing' : 'push'}" aria-hidden="true">${esc(f.mark)}</span>` : '';
    return `<div class="ins-xp gdi-fact${i >= visibleN ? ' gdi-fact--extra' : ''}" data-xp="${esc(f.fid)}" data-open="${open ? 'true' : 'false'}">`
      + `<button type="button" class="cd-item ins-row" data-gdi-action="fact" data-gdi-fact="${esc(f.fid)}" aria-expanded="${open ? 'true' : 'false'}">${mark}<span class="cd-item-main"><span class="cd-item-title gdi-line">${esc(f.line)}</span></span>${glyph(icon, 'chevronRight', 'ins-row-chev ins-xp-chev')}</button>`
      + `<div class="ins-xp-body"><div class="ins-xp-in">${figs}<div class="cd-actions"><button type="button" class="btn cd-action cd-action--primary" data-gdi-action="ask" data-gdi-fact="${esc(f.fid)}" data-haptic="medium">${glyph(icon, 'scribeSpark', 'cd-action-icon')}${esc(GDI_COPY.ask)}</button><button type="button" class="btn cd-action cd-action--secondary" data-gdi-action="details" data-gdi-fact="${esc(f.fid)}" data-haptic="light">${esc(GDI_COPY.details)}</button></div></div></div></div>`;
  }).join('');
  const extra = m.facts.length - visibleN;
  const more = extra > 0 ? `<button type="button" class="btn cd-more" data-gdi-action="more" aria-expanded="${m.more ? 'true' : 'false'}">${esc(m.more ? GDI_COPY.fewer : GDI_COPY.more(extra))}</button>` : '';
  return `<div class="gdi" data-gdi>${head}<div class="card cd-card gdi-list" data-expanded="${m.more ? 'true' : 'false'}">${rows}</div>${more}<p class="sr-only" data-gdi-live role="status" aria-live="polite"></p></div>`;
}
