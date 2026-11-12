/**
 * CFB Pickems - js/insight-view.js (D2 lane 4 batch 2; DI-964, DI-1085, DI-1086; UN-519/520/543; mockup docs/mockups/d2-analytics.html frames 1, 2, 4, 9; 2026-10-21)
 * =====================================================================================================================================================
 * THE INSIGHT SURFACES, AS PURE STRING BUILDERS. No DOM, no storage, no network, no clock (`now` and every lookup are parameters). Three things live here:
 *
 *   feedCardFromInsight(c)            an engine candidate as the FEED CARD object Home draws (type insight.*, facts.headline / facts.line, the reason chip, the quality flags)
 *   insightDetailModel(c, ctx)        the model behind the pushed detail screen (frame 2): the headline and sample, up to three figures, the games behind it, the definition, the actions
 *   insightDetailHTML(model, deps)    its markup, in the card-detail vocabulary (.cd-card, .cd-items, .cd-action) plus a few .ins-* additions
 *   yourNumbersModel / yourNumbersHTML  the Profile "Your numbers" screen (frame 4) with the "Your teams" section (frame 9)
 *
 * EVERY dynamic string crosses the injected `escHtml` AT THE SINK; a missing one throws (CONVENTIONS #12). Every button carries `data-ins-action` (an allow-list the dispatcher re-checks
 * against the CURRENT model: the DOM is only ever a request) and carries nothing a person typed. Nothing technical is ever shown: no id, no hash, no metric id. THE BLIND RULE holds
 * because the only inputs are engine candidates (computed from final weeks and public team data) and the lookups the wire passes; a pick appears only as a result mark on a FINAL game.
 */

export const INSIGHT_TYPES = Object.freeze(['insight.pick', 'insight.social', 'insight.history', 'insight.strategy', 'insight.label', 'insight.team']);

const ICON_BY_KIND = Object.freeze({ 'insight.pick': 'scribeSpark', 'insight.social': 'playersGroup', 'insight.history': 'calendarWeek', 'insight.strategy': 'scribeSpark', 'insight.label': 'trophy', 'insight.team': 'trophy' });
const TEAM_ICON = Object.freeze({ 'team.record': 'trophy', 'team.form': 'trophy', 'team.vs_ranked': 'trophy', 'team.scoring': 'rankUp', 'team.margins': 'rankUp', 'team.ats_in_league': 'rankUp', 'team.leaders_recent': 'scribeSpark', 'team.coach': 'scribeSpark' });
/** the icon (from the one icon family) for a candidate; performance cards use rankUp (DI-964) */
export function iconKeyFor(c) {
  const id = c && c.metricIds && c.metricIds[0] ? c.metricIds[0] : '';
  if (c && c.kind === 'insight.team') return TEAM_ICON[id] || 'trophy';
  if (id.startsWith('perf.')) return 'rankUp';
  return (c && ICON_BY_KIND[c.kind]) || 'scribeSpark';
}

/** the reason chip: a followed team says why (alma mater, home team, a team you pick); every other kind says whose it is */
export function reasonOf(c) {
  if (!c) return '';
  if (c.kind === 'insight.team') return c.reasonChip || 'A team you follow';
  if (c.kind === 'insight.history') return 'A year ago this week';
  if (c.kind === 'insight.label') return 'New label';
  if (c.kind === 'insight.strategy') return 'What if';
  if (c.kind === 'insight.social') return 'In your league';
  return c.involvesViewerPick || c.involvesViewerMember ? 'Your picks' : 'In your league';
}

/**
 * The FEED CARD for Home (the shape home.js's cardHTML reads: type, id, reason, facts for cardCopy, sport fields, prov, sortKey) plus the quality flags Home's contract requires
 * (`insight.sampleOk`, `insight.ledgerOk`). Nothing here is free text from a person: headline and line are copy.js's fixed templates.
 */
export function feedCardFromInsight(c, { competitionId = null } = {}) {
  if (!c || !INSIGHT_TYPES.includes(c.kind) || typeof c.id !== 'string') return null;
  return Object.freeze({
    id: c.id, type: c.kind, sortKey: c.eventTime,
    sport: c.prov && c.prov.sport ? c.prov.sport : '', sportCode: c.prov && c.prov.sport ? String(c.prov.sport).toUpperCase() : '', competitionId,
    prov: c.prov ? { leagueId: c.prov.leagueId, leagueName: c.prov.leagueName, sport: c.prov.sport } : null,
    reason: reasonOf(c), icon: iconKeyFor(c),
    facts: Object.freeze({ headline: c.headline, line: c.line, sample: c.sample }),
    insight: Object.freeze({ interestingness: c.interestingness, metricId: c.metricIds[0], sampleOk: c.sampleOk === true, ledgerOk: c.ledgerOk === true, reason: c.reason || null }),
  });
}

/**
 * The card HOME draws for an engine candidate (D2 integration wiring; DI-1071(e), DI-1085, DI-1090): Home's own insight shell reads `headline` / `line` / `sample` at the top level, the
 * quality flags and the followed-team reason under `insight` (lane 3's adapter maps `insight.reason` to DI-1085's three chips), the league on BOTH `leagueId` and `prov.leagueId` (they always
 * agree), the subject team under `facts.team` (Home's relevance reads teams there) and the engine's `clusterKey` (a team card shares `team:{teamKey}|{weekId}` with a followed team's preview of
 * the same game, so Home shows the better one, never both) and the members it is about under `facts.members` (league data the card already names; Home's personal signal). Nothing else:
 * no pick, no metric value.
 */
export function homeCardFromInsight(c) {
  if (!c || !INSIGHT_TYPES.includes(c.kind) || typeof c.id !== 'string' || !c.prov || typeof c.prov.leagueId !== 'string' || !c.prov.leagueId || typeof c.headline !== 'string' || !c.headline) return null;
  const team = c.kind === 'insight.team' && Array.isArray(c.teamKeys) && c.teamKeys.length ? c.teamKeys[0] : null;
  return Object.freeze({
    // sortKey is an ISO string: Home orders and caps cards by comparing sortKey as STRINGS (newestFirst, capNewest), so a millisecond number would sort below every card (reviewer BLOCK on bc6e65d7)
    id: c.id, type: c.kind, sortKey: Number.isFinite(c.eventTime) ? new Date(c.eventTime).toISOString() : null, expiresAt: c.expiresAt ?? null, icon: iconKeyFor(c),
    leagueId: c.prov.leagueId, prov: Object.freeze({ leagueId: c.prov.leagueId, leagueName: c.prov.leagueName, sport: c.prov.sport }),
    sport: c.prov.sport || '', sportCode: c.prov.sport ? String(c.prov.sport).toUpperCase() : '', headline: c.headline, line: typeof c.line === 'string' ? c.line : '', sample: typeof c.sample === 'string' ? c.sample : '',
    clusterKey: c.clusterKey || null,
    facts: Object.freeze({ ...(team ? { team } : {}), members: Object.freeze((Array.isArray(c.memberIds) ? c.memberIds : []).filter((x) => typeof x === 'string' && x).map((x) => Object.freeze({ playerId: x }))) }),   // who it is about (Home's personal signal: the viewer's own insight ranks above another's)
    insight: Object.freeze({ interestingness: c.interestingness, noveltyKey: c.noveltyKey || null, metricId: c.metricIds[0], sampleOk: c.sampleOk === true, ledgerOk: c.ledgerOk === true, reason: c.reason || null }),
  });
}

// ---- the detail ---------------------------------------------------------------------------------------------------
const fig = (value, label) => ({ value: String(value), label: String(label) });
const rec = (w, l, t = 0, otl = 0, sport = '') => (sport === 'nhl' ? `${w}-${l}-${otl}` : t ? `${w}-${l}-${t}` : `${w}-${l}`);
const pctText = (x) => `${Math.round(x * 100)} percent`;

/** up to three large figures with labels, per metric (DI-964 "The numbers"); a metric with no entry shows just the count it rests on */
export function figuresFor(m) {
  const v = m.value || {};
  const sport = m.scope ? m.scope.sport : '';
  switch (m.id) {
    case 'team.record': return [fig(rec(v.w, v.l, v.t, v.otl, sport), 'record'), ...(v.home ? [fig(rec(v.home.w, v.home.l, v.home.t, v.home.otl, sport), 'at home')] : []), ...(v.away ? [fig(rec(v.away.w, v.away.l, v.away.t, v.away.otl, sport), 'on the road')] : [])].slice(0, 3);
    case 'team.form': return [fig(v.last.join(' '), `last ${v.k}`), ...(v.run.kind ? [fig(`${v.run.kind === 'W' ? 'W' : 'L'}${v.run.n}`, v.run.streak ? 'current streak' : 'current run')] : [])];
    case 'team.scoring': return [fig(v.season.pf, 'points per game'), fig(v.season.pa, 'allowed per game'), fig(`${v.season.margin > 0 ? '+' : ''}${v.season.margin}`, 'average margin')];
    case 'team.margins': return [...(v.win ? [fig(`${v.win.pf}-${v.win.pa}`, 'biggest win')] : []), ...(v.loss ? [fig(`${v.loss.pf}-${v.loss.pa}`, 'worst loss')] : [])];
    case 'team.vs_ranked': return [fig(rec(v.w, v.l, v.t, v.otl, sport), 'against ranked teams'), fig(`${v.games} of ${v.of}`, 'games')];
    case 'team.ats_in_league': return [fig(`${v.covered} of ${v.games}`, 'covered'), fig(`${v.lost}`, 'did not cover'), ...(v.pushed ? [fig(`${v.pushed}`, 'pushed')] : [])];
    case 'team.leaders_recent': return v.items.map((i) => fig(i.line, i.who)).slice(0, 2);
    case 'team.coach': return [fig(rec(v.w, v.l, v.t, v.otl, sport), 'season record'), fig(`${v.games}`, 'games')];
    case 'ident.team_most_backed': return [fig(`${v.count} of ${v.appearances}`, 'games backed'), fig(`${v.w}-${v.l}`, 'on those picks')];
    case 'ident.team_most_faded': return [fig(`${v.count}`, 'times faded'), fig(`${v.w}-${v.l}`, 'on those picks')];
    case 'ident.team_loyalty': return [fig(`${v.backed} of ${v.appearances}`, 'games backed'), fig(pctText(v.share), 'of its games')];
    case 'ident.fav_dog': return [fig(pctText(v.share), 'on favorites'), fig(`${v.onFavorite.w}-${v.onFavorite.l}`, 'on favorites'), fig(`${v.onUnderdog.w}-${v.onUnderdog.l}`, 'on underdogs')];
    case 'ident.home_away': return [fig(pctText(v.homeShare), 'on the home team'), fig(`${v.home.w}-${v.home.l}`, 'at home'), fig(`${v.away.w}-${v.away.l}`, 'on the road')];
    case 'cons.rate': return [fig(pctText(v.rate), 'with the room'), fig(`${m.n}`, 'games')];
    case 'pair.agreement': return [fig(pctText(v.rate), 'agreement'), fig(`${m.n}`, 'games')];
    default: return [fig(m.n, m.family === 'performance' || m.family === 'label' ? 'weeks or picks counted' : 'counted')];
  }
}

const DEFN = 'Final weeks only. Pushes are not counted.';
export const DETAIL_COPY = Object.freeze({
  numbers: 'The numbers', read: "SCRIBE's read", readBy: 'Written by SCRIBE from the league record', games: 'Games behind this', recent: 'Latest games', how: 'How this is counted', ask: 'Ask SCRIBE', share: 'Share to Locker Room', yours: 'Open Your numbers', whatIf: 'Open What if',
  showAll: (n) => `Show all ${n}`, showFewer: 'Show fewer', unavailableTitle: "This insight isn't available right now.", unavailableBody: 'It may have been updated. Open it again from Home.', unavailableBack: 'Back',
});
const PREVIEW = 5;
const definitionOf = (m) => (m.id.startsWith('team.') ? (m.id === 'team.ats_in_league' ? "Your league's games only, graded exactly as a pick on the team would be. Definition v" + m.v + '.' : 'From ESPN’s finished games this season; a game still being played is never counted. Definition v' + m.v + '.')
  : m.id.startsWith('cb.') ? 'A quoted memory is shown exactly as it was approved. Definition v' + m.v + '.' : `${DEFN} Definition v${m.v}.`);

/**
 * The detail model for a candidate. ctx: { nameOf, sampleLine(c) -> string, gameRows(c) -> [{key, primary, secondary, mark, markWord, tone}], teamRows(c) -> same shape, shareOffered, updatedText }.
 * Returns null for anything that is not an insight (the screen then shows the calm unavailable state).
 */
export function insightDetailModel(c, ctx = {}) {
  if (!c || !INSIGHT_TYPES.includes(c.kind) || !c.metrics || !c.metrics[0]) return null;
  const m = c.metrics[0];
  const isTeam = c.kind === 'insight.team';
  const rows = (isTeam ? (typeof ctx.teamRows === 'function' ? ctx.teamRows(c) : []) : (typeof ctx.gameRows === 'function' ? ctx.gameRows(c) : [])) || [];
  const actions = [{ id: 'ask', label: DETAIL_COPY.ask, tone: 'primary', icon: 'scribeSpark' }];
  if (c.shareable === true && ctx.shareOffered === true) actions.push({ id: 'share', label: DETAIL_COPY.share, tone: 'secondary', icon: 'share' });
  // DI-982: the viewer's OWN what-if card links to the What-if screen (which lives under Your numbers); every other personal kind adds "Open Your numbers" (DI-964)
  if (c.kind === 'insight.strategy' && typeof ctx.viewerId === 'string' && ctx.viewerId && c.subject && c.subject.id === ctx.viewerId) actions.push({ id: 'what-if', label: DETAIL_COPY.whatIf, tone: 'secondary', icon: 'chevronRight' });
  else if (isTeam || c.involvesViewerPick || c.involvesViewerMember) actions.push({ id: 'your-numbers', label: DETAIL_COPY.yours, tone: 'secondary', icon: 'chevronRight' });
  return {
    id: c.id, kind: c.kind, icon: iconKeyFor(c),
    eyebrow: { reason: reasonOf(c), sport: c.prov && c.prov.sport ? String(c.prov.sport).toUpperCase() : '', league: ctx.provText || '' },
    title: c.headline, sample: typeof ctx.sampleLine === 'function' ? ctx.sampleLine(c) : (c.sample || ''),
    figures: figuresFor(m).slice(0, 3),
    listTitle: isTeam ? DETAIL_COPY.recent : DETAIL_COPY.games, rows: rows.slice(0, 24),
    definition: definitionOf(m), actions, updated: ctx.updatedText || '',
  };
}

const requireEsc = (e, who) => { if (typeof e !== 'function') throw new TypeError(`${who}() requires an injected escHtml function (CONVENTIONS #12) - it is never defaulted`); return e; };
const glyph = (iconFn, name, cls) => (typeof iconFn === 'function' && name ? `<span class="${cls}" aria-hidden="true">${iconFn(name)}</span>` : '');

/** the detail screen body for a model. Pure string building; `escHtml` REQUIRED; `icon` optional (the one icon family's renderer) */
export function insightDetailHTML(model, { escHtml, icon } = {}) {
  const esc = requireEsc(escHtml, 'insightDetailHTML');
  if (!model) return insightUnavailableHTML({ escHtml });
  const m = model;
  const reason = m.eyebrow.reason ? `<span class="cd-reason">${esc(m.eyebrow.reason)}</span>` : '';
  const sport = m.eyebrow.sport ? `<span class="cd-sport">${esc(m.eyebrow.sport)}</span>` : '';
  const head = `<section class="card cd-card cd-head" aria-label="Summary"><div class="cd-eyebrow">${glyph(icon, m.icon, 'cd-eyebrow-icon')}${m.eyebrow.league ? `<span class="cd-sport">${esc(m.eyebrow.league)}</span>` : sport}${reason}</div><h3 class="cd-title">${esc(m.title)}</h3>${m.sample ? `<p class="cd-fresh">${esc(m.sample)}</p>` : ''}</section>`;
  const figs = m.figures.length ? `<section class="card cd-card ins-numbers" aria-labelledby="ins-h-numbers"><h4 class="cd-h" id="ins-h-numbers">${esc(DETAIL_COPY.numbers)}</h4><div class="ins-figs">${m.figures.map((f) => `<div class="ins-fig"><b class="ins-fig-v">${esc(f.value)}</b><span class="ins-fig-l">${esc(f.label)}</span></div>`).join('')}</div></section>` : '';
  // DI-1107: "SCRIBE's read", under the numbers and above Ask SCRIBE, in the shipped scribe-read vocabulary. `m.read` = { state: 'loading' | 'ok', text, fresh } or absent: loading is a two-line
  // static skeleton in a body reserved at the read's height (the detail does not jump when the text arrives); a failed, switched-off or over-cap read has NO section (never an error)
  const read = insightReadHTML(m.read, { escHtml: esc });
  const extra = m.rows.length > PREVIEW;
  // DI-964 item 3: a row that is one of the LEAGUE's games is a button that opens that game (the shipped Game view, pushed above this detail; Back returns here and focus to the row).
  // A row with no league game (a followed team's ESPN result) stays a plain row: there is no screen to open.
  const rowInner = (r) => `<span class="cd-item-main"><span class="cd-item-title">${esc(r.primary)}</span>${r.secondary ? `<span class="cd-item-sub">${esc(r.secondary)}</span>` : ''}</span>${r.mark ? `<span class="cd-mark cd-mark--${r.tone === 'win' ? 'win' : r.tone === 'loss' ? 'loss' : 'push'}" aria-hidden="true">${esc(r.mark)}</span><span class="sr-only">${esc(r.markWord || '')}</span>` : ''}`;
  const lis = m.rows.map((r, i) => (typeof r.gameId === 'string' && r.gameId
    ? `<li class="cd-item ins-gitem${i >= PREVIEW ? ' cd-item--extra' : ''}"><button type="button" class="ins-grow" data-ins-action="open-game" data-ins-game="${esc(r.gameId)}" data-restore-key="${esc('gd:' + r.gameId)}" data-haptic="medium">${rowInner(r)}${glyph(icon, 'chevronRight', 'ins-row-chev')}</button></li>`
    : `<li class="cd-item${i >= PREVIEW ? ' cd-item--extra' : ''}">${rowInner(r)}</li>`)).join('');
  const list = m.rows.length ? `<section class="card cd-card cd-list" data-cd-list="games" data-expanded="false" aria-labelledby="ins-h-games"><h4 class="cd-h" id="ins-h-games">${esc(m.listTitle)}</h4><ul class="cd-items">${lis}</ul>${extra ? `<button type="button" class="btn cd-more" data-ins-action="show-all" aria-expanded="false">${esc(DETAIL_COPY.showAll(m.rows.length))}</button>` : ''}</section>` : '';
  const defn = `<section class="card cd-card ins-defn"><button type="button" class="ins-disc" data-ins-action="defn" aria-expanded="false" aria-controls="ins-defn-body"><span>${esc(DETAIL_COPY.how)}</span>${glyph(icon, 'chevronRight', 'ins-disc-chev')}</button><p class="cd-body" id="ins-defn-body" hidden>${esc(m.definition)}</p></section>`;
  const acts = m.actions.length ? `<div class="cd-actions">${m.actions.map((a) => `<button type="button" class="btn cd-action cd-action--${a.tone === 'primary' ? 'primary' : 'secondary'}" data-ins-action="${esc(a.id)}" data-haptic="${a.tone === 'primary' ? 'medium' : 'light'}">${glyph(icon, a.icon, 'cd-action-icon')}${esc(a.label)}</button>`).join('')}</div>` : '';
  const upd = m.updated ? `<p class="cd-note">${esc(m.updated)}</p>` : '';
  return `<div class="cd ins-detail" data-cd-type="${esc(m.kind)}" data-ins-id="${esc(m.id)}">${head}${figs}${read}${list}${defn}${acts}${upd}</div>`;
}

/** DI-1107: the "SCRIBE's read" section alone (the detail draws it, and the sheet patches it in place when the read arrives, so the detail never waits on a repaint). '' when there is none. */
export function insightReadHTML(read, { escHtml } = {}) {
  const esc = requireEsc(escHtml, 'insightReadHTML');
  const rd = read && (read.state === 'loading' || (read.state === 'ok' && typeof read.text === 'string' && read.text)) ? read : null;
  return rd ? `<section class="card cd-card ins-read${rd.state === 'ok' && rd.fresh ? ' ins-read--new' : ''}" data-ins-read="${rd.state === 'ok' ? 'ok' : 'loading'}" aria-labelledby="ins-h-read"><h4 class="cd-h" id="ins-h-read">${esc(DETAIL_COPY.read)}</h4><p class="cd-item-sub">${esc(DETAIL_COPY.readBy)}</p><div class="ins-read-body" aria-live="polite">${rd.state === 'ok' ? `<p class="cd-body">${esc(rd.text)}</p>` : '<span class="feed-skel-line feed-skel-line--wide"></span><span class="feed-skel-line feed-skel-line--narrow"></span>'}</div></section>` : '';
}

export function insightUnavailableHTML({ escHtml } = {}) {
  const esc = requireEsc(escHtml, 'insightUnavailableHTML');
  return `<div class="cd cd--unavailable"><section class="card cd-card cd-unavail" role="status"><h3 class="cd-title">${esc(DETAIL_COPY.unavailableTitle)}</h3><p class="cd-body">${esc(DETAIL_COPY.unavailableBody)}</p><div class="cd-actions"><button type="button" class="btn cd-action cd-action--primary" data-ins-action="back">${esc(DETAIL_COPY.unavailableBack)}</button></div></section></div>`;
}

// ---- Your numbers (Profile) --------------------------------------------------------------------------------------
export const YN_COPY = Object.freeze({
  title: 'Your numbers', none: 'Nothing to show yet.', noneBody: 'Insights start after your first final week.', nextKickoff: (t) => `Next kickoff ${t}.`,
  labelsNone: 'Labels need about four weeks of picks.', thin: (n, min) => `So far: ${n}. Rates appear at ${min}.`, unlocks: 'What unlocks next',
  teams: 'Your teams', teamsNone: 'Follow a team by setting your alma mater or home team in Profile, or pick a team a few times.', teamsOpen: 'Open Profile', moreSoon: 'More soon.', stale: (d) => `Updated ${d}`,
  failed: "Couldn't load your numbers.", retry: 'Retry', hiddenLabel: 'Hidden from the league', noGames: 'Nothing to show for this team yet.',
  rankCap: (n) => `Rank by week, out of ${n}. A taller bar is a higher place.`, rankTable: 'Show as a table', rankHide: 'Hide the table', week: 'Week', rank: 'Rank',
  rankLabel: (path) => `Rank by week: ${path.map((x) => `Week ${x.weekNumber}, ${ordinalOf(x.rank)}`).join('; ')}.`,
  compare: 'Compare with…', whatIf: 'What if', whatIfSub: 'Replay your picks with simple strategies', seasons: 'Seasons', thisSeason: 'Shown above', weeklyOnly: 'weekly totals only',
  seasonsSub: (list) => list.map((x) => (x.kind === 'archive' ? `${x.season} (weekly totals only)` : x.season)).join(' · '), oneSeason: (s0) => `${s0}, this season`,
  archiveRow: 'Weekly totals only. Opens the season record in Standings.', otherRow: 'Show this season', refreshing: 'Refreshing…', pull: 'Pull to refresh', release: 'Release to refresh', refreshFailed: "Couldn't refresh your numbers.",
});
const ordinalOf = (n) => { const v = Math.abs(Math.trunc(Number(n) || 0)) % 100, suf = ['th', 'st', 'nd', 'rd']; return `${Math.trunc(Number(n) || 0)}${suf[(v - 20) % 10] || suf[v] || suf[0]}`; };
export const YN_SECTIONS = Object.freeze([['labels', 'Labels'], ['identity', 'Pick identity'], ['performance', 'Performance'], ['social', 'Social']]);

/**
 * The Your numbers model. `parts` is what the wire computed from the engine for ONE sport: { sport, sports[], labels: [candidate], identity: [candidate], performance: [candidate], social: [candidate],
 * teams: [{ teamKey, name, reason, rows:[{label,value,id?}], stale, empty, link }], unlocks: [{text}], none: boolean, nextKickoff }.
 */
export function yourNumbersModel(parts) {
  const p = parts || {};
  const row = (c) => ({ id: c.id, primary: c.headline, secondary: c.sample || '' });
  const rp = p.rankPath && Array.isArray(p.rankPath.path) && p.rankPath.path.length && Number.isInteger(p.rankPath.entrants) && p.rankPath.entrants > 0 ? p.rankPath : null;
  return {
    sport: p.sport || '', sports: Array.isArray(p.sports) ? p.sports : [], none: p.none === true, nextKickoff: p.nextKickoff || '',
    sections: YN_SECTIONS.map(([id, title]) => ({ id, title, rows: (p[id] || []).map(row), empty: id === 'labels' ? YN_COPY.labelsNone : '' })),
    teams: (p.teams || []).slice(0, 6), unlocks: (p.unlocks || []).slice(0, 3), failed: p.failed === true,
    // the rank by week (a spark with its table twin), the "Compare with" entry, the What-if row and the Seasons rows (DI-964); `open` is the screen's in-place disclosure state
    rankPath: rp ? { entrants: rp.entrants, path: rp.path.map((x) => ({ weekNumber: Number(x.weekNumber) || 0, rank: Number(x.rank) || 0 })) } : null,
    compare: p.compareOffered === true, whatIf: p.none !== true,
    seasons: Array.isArray(p.seasons) ? p.seasons.filter((x) => x && typeof x.season === 'string').map((x) => ({ season: x.season, kind: x.kind === 'archive' ? 'archive' : 'record', current: x.current === true })) : [],
    open: { rank: !!(p.open && p.open.rank), seasons: !!(p.open && p.open.seasons) },
  };
}

export function yourNumbersHTML(model, { escHtml, icon } = {}) {
  const esc = requireEsc(escHtml, 'yourNumbersHTML');
  const m = model;
  if (!m) return '';
  if (m.failed) return `<div class="cd yn"><section class="card cd-card" role="status"><h3 class="cd-title">${esc(YN_COPY.failed)}</h3><div class="cd-actions"><button type="button" class="btn cd-action cd-action--primary" data-ins-action="yn-retry">${esc(YN_COPY.retry)}</button></div></section></div>`;
  const seg = m.sports.length >= 2 ? `<div class="ins-seg" role="radiogroup" aria-label="Sport">${m.sports.map((s) => `<button type="button" role="radio" class="ins-seg-btn" aria-checked="${s === m.sport}" data-ins-action="yn-sport" data-ins-sport="${esc(s)}">${esc(String(s).toUpperCase())}</button>`).join('')}</div>` : '';
  if (m.none) return `<div class="cd yn">${seg}<section class="card cd-card" role="status"><h3 class="cd-title">${esc(YN_COPY.none)}</h3><p class="cd-body">${esc(YN_COPY.noneBody)}${m.nextKickoff ? ' ' + esc(YN_COPY.nextKickoff(m.nextKickoff)) : ''}</p></section>${m.unlocks.length ? unlocksHTML(m, esc) : ''}</div>`;
  const rowBtn = (r) => `<button type="button" class="cd-item ins-row" data-ins-action="yn-open" data-ins-id="${esc(r.id)}"><span class="cd-item-main"><span class="cd-item-title">${esc(r.primary)}</span>${r.secondary ? `<span class="cd-item-sub">${esc(r.secondary)}</span>` : ''}</span>${glyph(icon, 'chevronRight', 'ins-row-chev')}</button>`;
  const extraOf = (id) => (id === 'performance' && m.rankPath ? rankPathHTML(m, esc, icon) : id === 'social' && m.compare ? `<button type="button" class="btn cd-more yn-compare" data-ins-action="yn-compare" data-haptic="light">${esc(YN_COPY.compare)}</button>` : '');
  const sections = m.sections.map((s) => {
    const extra = extraOf(s.id);
    if (!s.rows.length && !s.empty && !extra) return '';
    return `<section class="card cd-card yn-section" aria-labelledby="yn-h-${esc(s.id)}"><h4 class="cd-h" id="yn-h-${esc(s.id)}">${esc(s.title)}</h4>${s.rows.length ? s.rows.map(rowBtn).join('') : s.empty ? `<p class="cd-body">${esc(s.empty)}</p>` : ''}${extra}</section>`;
  }).join('');
  const teams = `<section class="yn-teams" aria-labelledby="yn-h-teams"><h4 class="cd-h yn-teams-h" id="yn-h-teams">${esc(YN_COPY.teams)}</h4>${m.teams.length ? `<div class="yn-team-list">${m.teams.map((t) => teamCardHTML(t, esc, icon)).join('')}</div>` : `<section class="card cd-card" role="status"><p class="cd-body">${esc(YN_COPY.teamsNone)}</p><div class="cd-actions"><button type="button" class="btn cd-action cd-action--secondary" data-ins-action="open-profile">${esc(YN_COPY.teamsOpen)}</button></div></section>`}</section>`;
  return `<div class="cd yn">${seg}${sections}${teams}${linksHTML(m, esc, icon)}${m.unlocks.length ? unlocksHTML(m, esc) : ''}</div>`;
}

/**
 * The rank by week (DI-964): a small bar line (a taller bar is a higher place), DECORATION with its own spoken summary, and a "Show as a table" disclosure that opens the table twin in place (150 ms).
 * Bar heights are numbers this file computes (0.125 .. 1), never a string from data.
 */
function rankPathHTML(m, esc, icon) {
  const rp = m.rankPath;
  const n = rp.entrants;
  const h = (rank) => Math.max(0.125, Math.min(1, Math.round(((n - rank + 1) / n) * 1000) / 1000));
  const bars = rp.path.map((x) => `<span class="yn-spark-bar" style="--h:${h(x.rank)}"></span>`).join('');
  const rows = rp.path.map((x) => `<tr><th scope="row">${esc(String(x.weekNumber))}</th><td>${esc(ordinalOf(x.rank))}</td></tr>`).join('');
  const open = m.open.rank;
  return `<div class="yn-rank"><div class="yn-spark" role="img" aria-label="${esc(YN_COPY.rankLabel(rp.path))}">${bars}</div><p class="cd-fresh">${esc(YN_COPY.rankCap(n))}</p>`
    + `<div class="ins-xp" data-xp="rank" data-open="${open ? 'true' : 'false'}"><button type="button" class="ins-disc" data-ins-action="yn-xp" data-ins-xp="rank" aria-expanded="${open ? 'true' : 'false'}" aria-controls="yn-rank-table"><span>${esc(open ? YN_COPY.rankHide : YN_COPY.rankTable)}</span>${glyph(icon, 'chevronRight', 'ins-disc-chev')}</button>`
    + `<div class="ins-xp-body" id="yn-rank-table"><div class="ins-xp-in"><div class="yn-table"><table class="ins-table"><thead><tr><th scope="col">${esc(YN_COPY.week)}</th><th scope="col">${esc(YN_COPY.rank)}</th></tr></thead><tbody>${rows}</tbody></table></div></div></div></div></div>`;
}

/** What if and Seasons: one group of rows (mockup frame 4). Seasons is a row per season once there are two or more (DI-964), behind one row that opens them in place. */
function linksHTML(m, esc, icon) {
  if (!m.whatIf && !m.seasons.length) return '';
  const chev = glyph(icon, 'chevronRight', 'ins-row-chev');
  const main = (title, sub) => `<span class="cd-item-main"><span class="cd-item-title">${esc(title)}</span>${sub ? `<span class="cd-item-sub">${esc(sub)}</span>` : ''}</span>`;
  const whatIf = m.whatIf ? `<button type="button" class="cd-item ins-row" data-ins-action="yn-what-if" data-restore-key="yn:what-if">${main(YN_COPY.whatIf, YN_COPY.whatIfSub)}${chev}</button>` : '';
  let seasons = '';
  if (m.seasons.length === 1 && m.seasons[0].kind === 'record') seasons = `<div class="cd-item ins-row ins-row--static">${main(YN_COPY.seasons, YN_COPY.oneSeason(m.seasons[0].season))}</div>`;
  else if (m.seasons.length) {
    const open = m.open.seasons;
    const rows = m.seasons.map((x) => (x.current
      ? `<div class="cd-item ins-row ins-row--static" aria-current="true">${main(x.season, YN_COPY.thisSeason)}</div>`
      : `<button type="button" class="cd-item ins-row" data-ins-action="${x.kind === 'archive' ? 'yn-season-archive' : 'yn-season'}" data-ins-season="${esc(x.season)}">${main(x.season, x.kind === 'archive' ? YN_COPY.archiveRow : YN_COPY.otherRow)}${chev}</button>`)).join('');
    seasons = `<div class="ins-xp" data-xp="seasons" data-open="${open ? 'true' : 'false'}"><button type="button" class="cd-item ins-row" data-ins-action="yn-xp" data-ins-xp="seasons" aria-expanded="${open ? 'true' : 'false'}" aria-controls="yn-seasons-list">${main(YN_COPY.seasons, YN_COPY.seasonsSub(m.seasons))}${glyph(icon, 'chevronRight', 'ins-row-chev ins-xp-chev')}</button>`
      + `<div class="ins-xp-body" id="yn-seasons-list"><div class="ins-xp-in ins-xp-in--rows">${rows}</div></div></div>`;
  }
  return `<section class="card cd-card yn-links" aria-label="${esc(YN_COPY.whatIf + ' and ' + YN_COPY.seasons)}">${whatIf}${seasons}</section>`;
}

function teamCardHTML(t, esc, icon) {
  const rows = t.rows.map((r) => (r.id
    ? `<button type="button" class="cd-item ins-row" data-ins-action="yn-open" data-ins-id="${esc(r.id)}"><span class="cd-item-main"><span class="cd-item-title">${esc(r.label)}</span><span class="cd-item-sub">${esc(r.value)}</span></span>${glyph(icon, 'chevronRight', 'ins-row-chev')}</button>`
    : `<div class="cd-item"><span class="cd-item-main"><span class="cd-item-title">${esc(r.label)}</span><span class="cd-item-sub">${esc(r.value)}</span></span></div>`)).join('');
  return `<section class="card cd-card yn-team" data-team="${esc(t.teamKey)}"><div class="cd-eyebrow"><span class="cd-reason">${esc(t.reasonChip || '')}</span></div><h5 class="cd-title">${esc(t.name)}</h5>${t.empty ? `<p class="cd-body">${esc(YN_COPY.noGames)}</p>` : rows || `<p class="cd-body">${esc(YN_COPY.moreSoon)}</p>`}${t.link ? `<p class="cd-fresh">${esc(t.link)}</p>` : ''}${t.stale ? `<p class="cd-note">${esc(t.stale)}</p>` : ''}</section>`;
}
function unlocksHTML(m, esc) {
  return `<section class="card cd-card yn-section" aria-labelledby="yn-h-unlocks"><h4 class="cd-h" id="yn-h-unlocks">${esc(YN_COPY.unlocks)}</h4>${m.unlocks.map((u) => `<p class="cd-body">${esc(u.text)}</p>`).join('')}</section>`;
}
