/**
 * CFB Pickems — league-overview.js (D1 / v0.30.0, DI-554, DI-522, DI-556; security C3, C5)
 *
 * The markup of the LEAGUE OVERVIEW: the sheet the league name opens on every tab (DI-556), and the very same sport cards on the League Page (DI-522: "one function, so the two cannot
 * disagree"). Drew approved the layout as drawn (D-60, `docs/mockups/d1/league-overview-sheet.html`).
 *
 * A PURE LEAF. It imports NOTHING and reads nothing: it renders the MODEL it is handed, and the model is built (in app.js) from js/sport-status.js's views. That is the blind-rule
 * guarantee (C3): the overview takes only the viewer's OWN submit state, counts, and `{ liveCount }` — it receives no pick, no rival id, no name of anyone who has or has not picked,
 * and it has no way to ask for one. leagueoverviewtest proves it with a hostile fixture and a static scan, and DI-540's whole-tree import scan covers the file.
 *
 *   leagueOverviewHeaderHTML(model, deps)       the sheet's title, "{sports} · {n} members" subtitle and ✕
 *   leagueOverviewBodyHTML(model, deps)         glance chips · Your sports · Also in this league · Commissioner · League
 *   leaguePageSportsHTML(model, deps)           the League Page's "Sports" region: the SAME cards, no chips, no commissioner / league groups
 *   sportCardHTML(card, deps) / joinCardHTML(card, deps)
 *
 * C5 (XSS): `deps.escHtml` is REQUIRED and the renderers refuse to render without it (`requireEscHtml`, as js/home.js does) — never a `typeof escHtml` fallback. Every attribute value is
 * double-quoted and escaped; every standalone number goes through `deps.numHtml`; every string the model carries (a league name, a sport label, a week label) is escaped at the sink,
 * including every `aria-label` and `title`.
 *
 * MODEL (all strings are plain text; none is HTML):
 *   { leagueName, memberCount, sportsLine, isCommissioner, focusSport,
 *     glance:  [{ kind:'due'|'live', text, dbCode?, tab? }],
 *     played:  [{ dbCode, sportName, glyphKey, weekLabel, view }],            // view = sport-status.sportCardView()
 *     other:   [{ dbCode, code, sportName, glyphKey, weekLabel, view, busy, error }],   // view = sport-status.joinCardView()
 *     commissioner: [{ action, dbCode?, title, subtitle?, right? }],          // rows the caller has a REAL destination for (never a dead stub)
 *     leagueCount, showZoneNote }
 */

/** The injected escaper REQUIREMENT (js/leagues-home.js / js/feed-cards.js pattern): throw rather than quietly render unescaped. */
export function requireEscHtml(escHtml, fnName = 'league-overview') {
  if (typeof escHtml !== 'function') throw new TypeError(`${fnName}() requires an injected escHtml function (CONVENTIONS #12, C5)`);
  return escHtml;
}
function requireNumHtml(numHtml, fnName) {
  if (typeof numHtml !== 'function') throw new TypeError(`${fnName}() requires an injected numHtml function (C5: every number crosses the HTML boundary through it)`);
  return numHtml;
}

const noIcon = () => '';
const arr = (v) => (Array.isArray(v) ? v : []);
const TONE_CLASS = Object.freeze({
  open: 'badge-open', locked: 'badge-locked', live: 'badge-live', final: 'badge-final', draft: 'badge-draft',
  due: 'badge-due', ok: 'badge-open', nd: 'badge-draft',
});

function pillHTML(p, { escHtml, icon }) {
  const tone = Object.prototype.hasOwnProperty.call(TONE_CLASS, p && p.tone) ? p.tone : 'nd';
  const dot = p && p.dot ? '<span class="live-dot live-dot-static" aria-hidden="true"></span>' : '';
  const check = p && p.check ? `<span class="lo-pill-ic" aria-hidden="true">${icon('check')}</span>` : '';
  return `<span class="badge ${TONE_CLASS[tone]}">${dot}${check}${escHtml(p && p.text)}</span>`;
}

function cardHeadHTML(card, { escHtml, icon }, { chevron }) {
  const glyph = card.glyphKey ? icon(card.glyphKey) : '';
  return `<span class="lo-card-head">${glyph ? `<span class="lo-card-glyph" aria-hidden="true">${glyph}</span>` : ''}<span class="lo-card-name">${escHtml(card.sportName)}</span>${card.weekLabel ? `<span class="lo-card-week">${escHtml(card.weekLabel)}</span>` : ''}${chevron ? `<span class="lo-card-chev" aria-hidden="true">${icon('chevronRight')}</span>` : ''}</span>`;
}

/**
 * One played sport: a single button (>= 44 pt, the whole card is the target). Tap = enter the sport on `view.enterTab`. A commissioner's "Set up Week N" is a SEPARATE button beside the card,
 * never nested inside it (no interactive content inside a button). */
export function sportCardHTML(card, deps = {}) {
  const escHtml = requireEscHtml(deps.escHtml, 'sportCardHTML');
  const icon = deps.icon || noIcon;
  const v = (card && card.view) || { pills: [], line: '', windowLine: '', enterTab: 'dashboard', ariaLabel: '', setup: null };
  const focus = deps.focusSport && deps.focusSport === card.dbCode ? ' lo-card--focus' : '';
  const main = `<button type="button" class="card lo-card${focus}" data-lo-action="enter" data-sport="${escHtml(card.dbCode)}" data-tab="${escHtml(v.enterTab)}" aria-label="${escHtml(v.ariaLabel)}">`
    + cardHeadHTML(card, { escHtml, icon }, { chevron: true })
    + (arr(v.pills).length ? `<span class="lo-pills">${arr(v.pills).map((p) => pillHTML(p, { escHtml, icon })).join('')}</span>` : '')
    + (v.line ? `<span class="lo-line">${escHtml(v.line)}</span>` : '')
    + (v.windowLine ? `<span class="lo-games">${escHtml(v.windowLine)}</span>` : '')
    + '</button>';
  if (!v.setup) return main;
  return `<div class="lo-card-wrap">${main}<button type="button" class="btn btn-primary btn-block lo-setup" data-lo-action="setup" data-sport="${escHtml(card.dbCode)}">${escHtml(v.setup)}</button></div>`;
}

/**
 * A sport enabled for the league that the viewer has NOT joined (DI-554): "Also in this league". NOT a button into the sport (so its Join is not nested): sport, week label, pills
 * ("Optional" + the week's status), the lock or Games line, the sentence, and a centered Join button of its own (>= 44 pt, >= 16 pt from the card's edge). Nothing here is gold, late or
 * missing. A Join that cannot work yet is DISABLED with its reason beside it, in text (never colour alone); a failed Join says what happened and offers a Retry; a Join in flight reads
 * "Joining…" and cannot be tapped twice.
 */
export function joinCardHTML(card, deps = {}) {
  const escHtml = requireEscHtml(deps.escHtml, 'joinCardHTML');
  const icon = deps.icon || noIcon;
  const v = (card && card.view) || { pills: [], line: '', windowLine: '', joinEnabled: false, caption: '', body: '', ariaLabel: '' };
  const code = String(card.code || card.sportName || '');
  const focus = deps.focusSport && deps.focusSport === card.dbCode ? ' lo-card--focus' : '';
  const busy = card.busy === true;
  const enabled = v.joinEnabled === true && !busy;
  const label = busy ? 'Joining…' : `Join ${code} picks`;
  const disabledAttrs = enabled ? '' : ' disabled aria-disabled="true"';
  const error = card.error
    ? `<p class="lo-error" role="alert">${escHtml(`Couldn't join ${code} picks. Nothing was changed. Try again.`)}</p>`
    : '';
  return `<article class="card lo-card lo-card--join${focus}" data-sport="${escHtml(card.dbCode)}" aria-label="${escHtml(v.ariaLabel)}">`
    + cardHeadHTML(card, { escHtml, icon }, { chevron: false })
    + (arr(v.pills).length ? `<div class="lo-pills">${arr(v.pills).map((p) => pillHTML(p, { escHtml, icon })).join('')}</div>` : '')
    + (v.line ? `<p class="lo-line">${escHtml(v.line)}</p>` : '')
    + (v.windowLine ? `<p class="lo-games">${escHtml(v.windowLine)}</p>` : '')
    + (v.body ? `<p class="lo-body-text">${escHtml(v.body)}</p>` : '')
    + `<div class="lo-join-row"><button type="button" class="btn btn-primary lo-join" data-lo-action="join" data-sport="${escHtml(card.dbCode)}"${disabledAttrs}>${escHtml(label)}</button></div>`
    + (!v.joinEnabled && v.caption ? `<p class="lo-caption" role="status">${escHtml(v.caption)}</p>` : '')
    + error
    + (error ? `<div class="lo-join-row"><button type="button" class="btn lo-retry" data-lo-action="join" data-sport="${escHtml(card.dbCode)}">Retry</button></div>` : '')
    + '</article>';
}

function chipHTML(chip, { escHtml, icon }) {
  if (chip.kind === 'live') {
    return `<button type="button" class="lo-chip lo-chip--live" data-lo-action="live"><span class="live-dot" aria-hidden="true"></span>${escHtml(chip.text)}</button>`;
  }
  return `<button type="button" class="lo-chip lo-chip--due" data-lo-action="enter" data-sport="${escHtml(chip.dbCode || '')}" data-tab="${escHtml(chip.tab || 'picks')}">${escHtml(chip.text)}</button>`;
}

function rowHTML(r, { escHtml, icon }) {
  return `<button type="button" class="lo-row" data-lo-action="${escHtml(r.action)}"${r.dbCode ? ` data-sport="${escHtml(r.dbCode)}"` : ''}>`
    + `<span class="lo-row-tx"><b>${escHtml(r.title)}</b>${r.subtitle ? `<span>${escHtml(r.subtitle)}</span>` : ''}</span>`
    + (r.right ? `<span class="lo-row-right">${escHtml(r.right)}</span>` : '')
    + `<span class="lo-row-chev" aria-hidden="true">${icon('chevronRight')}</span></button>`;
}

function groupHTML(groupId, groupLabelHTML, groupInnerHTML) {
  return `<section class="lo-group" aria-labelledby="${groupId}"><h3 class="lo-lbl" id="${groupId}">${groupLabelHTML}</h3>${groupInnerHTML}</section>`;
}

/** The two card groups, shared verbatim by the overview body and the League Page's Sports region. */
function cardGroupsHTML(m, deps) {
  const escHtml = deps.escHtml;
  const played = arr(m.played);
  const other = arr(m.other);
  const withFocus = { ...deps, focusSport: m.focusSport || null };
  let html = '';
  if (played.length) {
    html += groupHTML('lo-lbl-your', escHtml(played.length > 1 || other.length ? 'Your sports' : 'Your sport'), played.map((c) => sportCardHTML(c, withFocus)).join(''));
  }
  if (other.length) {
    html += groupHTML('lo-lbl-also', 'Also in this league', other.map((c) => joinCardHTML(c, withFocus)).join(''));
  }
  if (m.showZoneNote) html += `<p class="lo-note">${escHtml('Times are shown in your time zone.')}</p>`;
  return html;
}

export function leagueOverviewHeaderHTML(m, deps = {}) {
  const escHtml = requireEscHtml(deps.escHtml, 'leagueOverviewHeaderHTML');
  const numHtml = requireNumHtml(deps.numHtml, 'leagueOverviewHeaderHTML');
  const icon = deps.icon || noIcon;
  const model = m || {};
  const n = Number(model.memberCount);
  const members = Number.isFinite(n) && n >= 0 ? `${numHtml(n)} ${n === 1 ? 'member' : 'members'}` : '';
  const sub = [escHtml(model.sportsLine || ''), members, model.isCommissioner ? 'Commissioner' : ''].filter(Boolean).join(' · ');
  return `<div class="lo-head"><div class="lo-head-text"><h2 class="lo-title" id="league-overview-title" tabindex="-1">${escHtml(model.leagueName || '')}</h2>`
    + `${sub ? `<p class="lo-sub">${sub}</p>` : ''}</div>`
    + `<button type="button" class="chat-sheet-close lo-close" id="league-overview-close" aria-label="Close">${icon('close')}</button></div>`;
}

export function leagueOverviewBodyHTML(m, deps = {}) {
  const escHtml = requireEscHtml(deps.escHtml, 'leagueOverviewBodyHTML');
  requireNumHtml(deps.numHtml, 'leagueOverviewBodyHTML');
  const icon = deps.icon || noIcon;
  const model = m || {};
  const d = { ...deps, escHtml, icon };
  let html = '';
  const chips = arr(model.glance);
  if (chips.length) html += `<div class="lo-glance" role="group" aria-label="At a glance">${chips.map((c) => chipHTML(c, d)).join('')}</div>`;
  html += cardGroupsHTML(model, d);
  const comm = arr(model.commissioner);
  if (model.isCommissioner && comm.length) html += groupHTML('lo-lbl-comm', 'Commissioner', `<div class="lo-list">${comm.map((r) => rowHTML(r, d)).join('')}</div>`);
  const leagueRows = [
    { action: 'league-page', title: 'League page', subtitle: 'Settings, standings and members' },
    { action: 'switch-league', title: 'Switch or join a league', right: Number(model.leagueCount) > 0 ? `${Math.floor(Number(model.leagueCount))} ${Number(model.leagueCount) === 1 ? 'league' : 'leagues'}` : '' },
  ];
  html += groupHTML('lo-lbl-league', 'League', `<div class="lo-list">${leagueRows.map((r) => rowHTML(r, d)).join('')}</div>`);
  return `<div class="lo-body">${html}</div>`;
}

/** The League Page's "Sports" region (DI-522): the same two card groups, from the same functions as the sheet. */
export function leaguePageSportsHTML(m, deps = {}) {
  const escHtml = requireEscHtml(deps.escHtml, 'leaguePageSportsHTML');
  requireNumHtml(deps.numHtml, 'leaguePageSportsHTML');
  return `<div class="lo-body lo-body--page">${cardGroupsHTML(m || {}, { ...deps, escHtml, icon: deps.icon || noIcon })}</div>`;
}
