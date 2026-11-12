/**
 * CFB Pickems — comm-league-tab.js (D2 lane 6, UN/PF-528, DI-758 / DI-759 / DI-761 / DI-763, approved mockup d2-admin-ia.html)
 * ==========================================================================================================================
 * The Commissioner panel's LEAGUE tab (internal key `rules`; DI-757 renamed the label, never the key). A single card of rows in the Control Center / League Settings row vocabulary,
 * each row 52 pt and each opening ONE page inside the tab with a back chevron ("‹ League"). PURE: strings and data only, no DOM, no storage, no network; every app effect arrives
 * as an argument. js/app.js composes the live data and binds the taps (renderCommPage / setLeaguePage); this module is what is TESTED without a browser.
 *
 *   Row           opens                                                          shown when
 *   ------------  -------------------------------------------------------------  -------------------------------------------------------------
 *   details       the existing League Settings page, unchanged (name, accepting  always
 *                 members, leave): ONE page, two doors
 *   invite        the ONE Invite sheet (DI-729; the same component "Invite      when the Invite card exists (a Supabase league: it is the join code)
 *                 Friends" opens: no second copy of the code, Copy, Rotate)
 *   sports        the league's sports, Active or Archived                        when the league has at least one sport
 *   rules         League Rules + the Randomize Picks Shortcut                    always
 *   alma          Alma maters & home teams                                       only in a league whose default competition has alma affinity
 *   notifications Weekly Summary Email + the Commissioner Contact Email         always (the contact email is always there)
 *   advanced      the creation facts (read-only), then the league's own tools    always
 *
 * DI-758: "A row whose content does not exist yet is omitted, never shown as a placeholder." `leagueRowsModel()` is the ONE place that decision is made.
 *
 * SLOTS (DI-758 reserved homes). A slot is never rendered EMPTY (release review F-1: an empty hidden anchor is how the Obligations switch went missing for a whole release):
 *   `data-league-slot="obligations"`  the league default's Obligations switch, on Competition & rules (app.js obtLeagueSlotHTML; absent for anyone who may not change it).
 *   `data-league-slot="sports"`       one line on the Sports page: "Sport settings are on the Week tab." (a sport's format, lines, obligations and archive stay on Comm > Week until the next release moves them here).
 *   The Invite & joining row opens the ONE Invite sheet (DI-729 / DI-506) directly; it needs no slot.
 */

/** The pages of the tab, in the mockup's order. `nav` rows push a page inside the tab; `overlay` rows open an existing overlay. */
export const LEAGUE_PAGES = Object.freeze([
  Object.freeze({ key: 'details', label: 'League details', kind: 'overlay' }),
  Object.freeze({ key: 'invite', label: 'Invite & joining', kind: 'door' }),
  Object.freeze({ key: 'sports', label: 'Sports', kind: 'page' }),
  Object.freeze({ key: 'rules', label: 'Competition & rules', kind: 'page' }),
  Object.freeze({ key: 'alma', label: 'Alma maters & home teams', kind: 'page' }),
  Object.freeze({ key: 'notifications', label: 'Notifications', kind: 'page' }),
  Object.freeze({ key: 'advanced', label: 'Advanced', kind: 'page' }),
]);

/** The page keys that hold cards inside the tab (everything with kind 'page'), plus the list itself. */
export const LEAGUE_PAGE_KEYS = Object.freeze(['list', ...LEAGUE_PAGES.filter((p) => p.kind === 'page').map((p) => p.key)]);

export const LEAGUE_TAB_COPY = Object.freeze({
  back: 'League',
  inviteOn: 'On',
  inviteOff: 'Off',
  sportActive: 'Active',
  sportArchived: 'Archived',
  advancedFactsTitle: 'Already on for your league',
  sportSettingsHint: 'Sport settings are on the Week tab.',
});

/**
 * The rows the list card shows, in order, with their secondary value. Pure and total: a missing argument claims nothing and drops the row that needed it.
 *  - `leagueName`    the active league's name ('' when unknown: the row still shows, valueless)
 *  - `accepting`     true | false | null  (null = not read yet: no value, never a guess)
 *  - `sportCodes`    the codes of the league's non-archived sports (["CFB","NFL"])
 *  - `sportCount`    how many sports the league has in all (archived included): 0 omits the Sports row
 *  - `hasAlma`       whether the league's default competition has alma affinity
 *  - `hasInvite`     whether the Invite card exists (false omits the Invite & joining row: a door to nothing is not shown)
 */
export function leagueRowsModel({ leagueName = '', accepting = null, sportCodes = [], sportCount = 0, hasAlma = false, hasInvite = false } = {}) {
  const codes = Array.isArray(sportCodes) ? sportCodes.filter((c) => typeof c === 'string' && c) : [];
  const rows = [];
  for (const p of LEAGUE_PAGES) {
    if (p.key === 'alma' && !hasAlma) continue;
    if (p.key === 'invite' && !hasInvite) continue;
    if (p.key === 'sports' && !(Number(sportCount) > 0)) continue;
    let value = '';
    if (p.key === 'details') value = String(leagueName || '');
    else if (p.key === 'invite') value = accepting === true ? LEAGUE_TAB_COPY.inviteOn : accepting === false ? LEAGUE_TAB_COPY.inviteOff : '';
    else if (p.key === 'sports') value = codes.join(', ');
    rows.push({ key: p.key, label: p.label, kind: p.kind, value });
  }
  return rows;
}

const noEsc = () => { throw new TypeError('comm-league-tab.js: an escHtml function must be injected (CONVENTIONS #12), never defaulted'); };

/** The list card: ONE `.card` of 52 pt rows (a button each, label + value + chevron). Every row is a real <button> with a role-appropriate name. */
export function renderLeagueListCard(rows, { escHtml = noEsc, icon = () => '' } = {}) {
  const chevron = icon('chevronRight');
  const body = (rows || []).map((r) => `
      <button type="button" class="cl-row" data-league-nav="${escHtml(r.key)}" aria-label="${escHtml(r.label + (r.value ? ', ' + r.value : ''))}">
        <span class="cl-row-label">${escHtml(r.label)}</span>
        ${r.value ? `<span class="cl-row-value">${escHtml(r.value)}</span>` : ''}
        <span class="cl-row-chevron" aria-hidden="true">${chevron}</span>
      </button>`).join('');
  return `
    <div class="admin-section" data-comm-tab="rules" data-league-page="list" data-comm-card="league-list">
      <div class="card ls-card">${body}
      </div>
    </div>`;
}

/**
 * The back bar shown above every page (hidden on the list by CSS): "‹ League" and the page's own title. One bar for the whole tab; app.js sets `[data-league-bar-title]`
 * when it opens a page, so the cards underneath carry no second header of their own.
 */
export function renderLeagueBackBar({ escHtml = noEsc, icon = () => '' } = {}) {
  return `
    <div class="admin-section comm-league-bar" data-comm-tab="rules" data-league-bar>
      <div class="comm-league-bar-row">
        <button type="button" class="comm-league-back" data-league-back aria-label="Back to ${escHtml(LEAGUE_TAB_COPY.back)}">
          <span class="comm-league-back-glyph" aria-hidden="true">${icon('chevronLeft')}</span><span class="comm-league-back-label">${escHtml(LEAGUE_TAB_COPY.back)}</span>
        </button>
        <h3 class="comm-league-bar-title" data-league-bar-title tabindex="-1"></h3>
      </div>
    </div>`;
}

/** Wraps already-built card markup as ONE page card of the tab: `.admin-section[data-comm-tab="rules"][data-league-page="<page>"]` (RG-10: every section carries its tab attribute). */
export function leaguePageCard({ page, cardId, title = '', bodyHTML = '', flush = false, escHtml = noEsc } = {}) {
  return `
    <div class="admin-section" data-comm-tab="rules" data-league-page="${escHtml(page)}" data-comm-card="${escHtml(cardId)}">
      ${title ? `<div class="admin-section-title">${escHtml(title)}</div>` : ''}
      <div class="card${flush ? ' ls-card' : ''}">${bodyHTML}</div>
    </div>`;
}

/** Sports page: one read-only row per sport with Active or Archived. A sport's own content (format, odds, archive and restore) is lane 2's and lands at the slot. */
export function sportsPageBody(sports, { escHtml = noEsc } = {}) {
  const rows = (sports || []).filter((s) => s && s.label);
  const list = rows.map((s) => `
      <div class="cl-static-row"><span class="cl-row-label">${escHtml(s.label)}</span><span class="cl-row-value">${escHtml(s.archived ? LEAGUE_TAB_COPY.sportArchived : LEAGUE_TAB_COPY.sportActive)}</span></div>`).join('');
  return `${list}\n      <div class="cl-static-row" data-league-slot="sports"><span class="cl-row-label text-muted" style="font-weight:400">${escHtml(LEAGUE_TAB_COPY.sportSettingsHint)}</span></div>`;
}

/** Advanced page, the read-only facts card body: the creation facts that are actually on, as check rows. Empty rows list = no card at all (returns ''). */
export function advancedFactsBody(rows, { escHtml = noEsc, icon = () => '' } = {}) {
  const list = (rows || []).filter((r) => r && r.text);
  if (!list.length) return '';
  return list.map((r) => `
      <div class="cl-fact-row"><span class="cl-fact-icon" aria-hidden="true">${icon('check')}</span><span>${escHtml(r.text)}</span></div>`).join('');
}

/** What a page's bar title says (null for an unknown page: the caller keeps the list). */
export function leaguePageTitle(page) {
  const p = LEAGUE_PAGES.find((x) => x.key === page && x.kind === 'page');
  return p ? p.label : null;
}

/** A requested page is honoured only when it is a real in-tab page that is currently offered (an omitted row's page is the list); never an unknown string. */
export function resolveLeaguePage(requested, rows) {
  if (requested === 'list') return 'list';
  const offered = new Set((rows || []).filter((r) => r.kind === 'page').map((r) => r.key));
  return offered.has(requested) ? requested : 'list';
}
