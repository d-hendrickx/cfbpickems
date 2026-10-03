/**
 * CFB Pickems — js/newsSettings.js (Social Platform News, option A: the News settings PANE's markup and its pure reducer; DI-379 / DI-380, 2026-10-01)
 * =====================================================================================================================================================
 * The control-center drawer's third pane (Main / Profile / News), the same pushed-pane shape Profile already uses (`push-news` / `pop-news` in
 * js/control-center.js mirror `push-profile` / `pop-profile`). This module is PURE: data in, an HTML string out, plus the reducer that turns a tap
 * into a preference PATCH. It reads no storage, makes no request and holds no state; js/newsFeed.js builds `ctx.news` and the callbacks, and
 * control-center.js only dispatches. Every dynamic string — a team's location or display name above all, which comes from ESPN's catalog or a
 * stored (and so untrusted, S-C7) preference — passes this file's own QUOTE-COMPLETE `esc()` at the sink; control-center.js's `ctx.escHtml` is
 * not used for any of them (it does not escape the apostrophe: "Hawai'i", "St. John's"). Markup is composed by array join, and the one icon
 * helper splices a constant glyph beside its class, so the xsstest sweep of this file is a real zero.
 *
 * SHAPE (mockups/news-settings.html, in the drawer's own row vocabulary): the back row, the "News" title, the master switch, the five sport
 * switches, the CFB team chips and their picker (a native <select>: iOS draws its own wheel — Native First), the hint, and the footer note.
 * Breathing room (Design Philosophy, 2026-09-30): the pane's `gap` (16) separates groups; a chip is a 44 pt button and the chip row's `gap` is 8;
 * nothing carries a one-sided margin. No betting row (betting headlines are simply kept since Drew's 2026-10-01 reversal of SD-6; a toggle
 * was not asked for) and no "specific leagues" row (deferred).
 *
 * DISABLED STATE (the league layer is off, DI-380): the screen stays reachable, an inline note says why, every control is shown disabled — reduced
 * emphasis, no press animation — and the player's own choices stay saved.
 *
 * Import allow-list (asserted by newstest): ./icons.js only. iOS 15.0 safe.
 */

import { icon } from './icons.js';

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
const join = (parts) => parts.join('');
/** A constant glyph from the one icon family, spliced beside its class. The only place icon() is called in this file. */
const glyph = (className, name) => join(['<span class="', className, '" aria-hidden="true">', icon(name), '</span>']);

export const NEWS_SPORT_ROWS = Object.freeze([['cfb', 'CFB'], ['nfl', 'NFL'], ['nba', 'NBA'], ['nhl', 'NHL'], ['cbb', 'CBB']]);
export const NEWS_SPORT_KEYS = Object.freeze(NEWS_SPORT_ROWS.map((r) => r[0]));
/** The default cap, mirrored from storage.js (NEWS_TEAMS_MAX_COUNT); the live value arrives in the model so there is one source of truth. */
export const NEWS_SETTINGS_DEFAULT_MAX_TEAMS = 20;

export const NEWS_SETTINGS_COPY = Object.freeze({
  back: 'Control Center',
  title: 'News',
  masterLabel: 'Show news in Home',
  masterSub: 'Off hides the news slot entirely — no message, nothing to see.',
  sportsLabel: 'Sports',
  teamsLabel: 'Teams',
  addLabel: 'Add a CFB team',
  addPlaceholder: 'Choose a team…',
  maxTeams: 'You are following the most teams News allows. Remove one to add another.',
  teamsHint: "NFL / NBA / NHL / CBB teams aren't selectable yet — those sports are followed at the sport level only until the shared team catalog work lands.",
  leagueOff: "The commissioner has turned off league news. Your own settings are saved for when it's back on.",
  footer: "News never uses AI-generated text and never costs anything extra to run — it's headlines, images, and links, fetched directly from ESPN, the same way Google News works.",
});

/** The row for the drawer's "My Preferences" list: a nav row (label + chevron) that pushes the News pane. */
export function renderNewsNavRow() {
  return join(['<button type="button" class="control-center-row control-center-row--nav" data-action="cc-push-news"><span class="cc-row-label">News</span>', glyph('cc-row-chevron', 'chevronRight'), '</button>']);
}

function switchRow({ action, sport = '', label, sub = '', on, disabled }) {
  const subHtml = sub ? `<span class="cc-row-secondary">${esc(sub)}</span>` : '';
  const sportAttr = sport ? ` data-sport="${esc(sport)}"` : '';
  const disabledAttr = disabled ? ' disabled aria-disabled="true"' : '';
  return join([
    `<button type="button" class="control-center-row control-center-row--toggle" data-action="${esc(action)}"${sportAttr} role="switch" aria-checked="${on ? 'true' : 'false'}"${disabledAttr}>`,
    `<span class="cc-row-label">${esc(label)}${subHtml}</span>`,
    `<span class="cc-row-switch" data-on="${on ? 'true' : 'false'}" aria-hidden="true"></span>`,
    '</button>',
  ]);
}

/** The chip label for a stored team (a game / ESPN `location`): the catalog's display name when it differs, else the stored text. */
function chipLabel(team, catalog) {
  const t = String(team).toLowerCase();
  for (const c of Array.isArray(catalog) ? catalog : []) {
    if (c && typeof c.location === 'string' && c.location.toLowerCase() === t) return (typeof c.displayName === 'string' && c.displayName) || c.location;
  }
  return team;
}

function teamChip({ team, catalog, isAlma, disabled }) {
  const label = chipLabel(team, catalog);
  const cls = isAlma ? 'news-chip news-chip--alma' : 'news-chip';
  const disabledAttr = disabled ? ' disabled aria-disabled="true"' : '';
  return join([
    `<button type="button" class="${cls}" data-action="cc-news-remove-team" data-team="${esc(team)}" aria-label="${esc('Remove ' + label)}"${disabledAttr}>`,
    `<span class="news-chip__label">${esc(label)}</span>`,
    glyph('news-chip__x', 'close'),
    '</button>',
  ]);
}

/** The picker's <option> list: every catalog team NOT already followed, by display name. Value = `location` (what games store, the alma-mater convention). */
export function newsTeamOptionsHTML(catalog, chosenTeams) {
  const chosen = new Set((Array.isArray(chosenTeams) ? chosenTeams : []).map((t) => String(t).toLowerCase()));
  const rows = (Array.isArray(catalog) ? catalog : [])
    .filter((c) => c && typeof c.location === 'string' && c.location && !chosen.has(c.location.toLowerCase()))
    .map((c) => ({ location: c.location, label: (typeof c.displayName === 'string' && c.displayName) || c.location }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return join(rows.map((r) => `<option value="${esc(r.location)}">${esc(r.label)}</option>`));
}

const PLACEHOLDER_OPTION = () => `<option value="">${esc(NEWS_SETTINGS_COPY.addPlaceholder)}</option>`;

/** The pane body. `model` = { on, sports, teams, leagueOff, catalog, almaMater, maxTeams, catalogNote }. */
export function renderNewsSettingsBody(model) {
  const m = model && typeof model === 'object' ? model : {};
  const on = m.on !== false;
  const sports = Array.isArray(m.sports) ? m.sports : [];
  const teams = Array.isArray(m.teams) ? m.teams : [];
  const catalog = Array.isArray(m.catalog) ? m.catalog : [];
  const disabled = m.leagueOff === true;
  const maxTeams = Number.isInteger(m.maxTeams) && m.maxTeams > 0 ? m.maxTeams : NEWS_SETTINGS_DEFAULT_MAX_TEAMS;
  const alma = typeof m.almaMater === 'string' ? m.almaMater.trim().toLowerCase() : '';
  const full = teams.length >= maxTeams;

  const note = disabled ? `<div class="news-settings-note" role="note">${esc(NEWS_SETTINGS_COPY.leagueOff)}</div>` : '';
  const master = switchRow({ action: 'cc-news-toggle-on', label: NEWS_SETTINGS_COPY.masterLabel, sub: NEWS_SETTINGS_COPY.masterSub, on, disabled });
  const sportRows = NEWS_SPORT_ROWS.map(([key, label]) => switchRow({ action: 'cc-news-toggle-sport', sport: key, label, on: sports.indexOf(key) >= 0, disabled }));
  const chips = teams.map((team) => teamChip({ team, catalog, isAlma: !!alma && String(team).toLowerCase() === alma, disabled }));
  const chipRow = chips.length ? join(['<div class="news-chip-row">', join(chips), '</div>']) : '';
  const selectDisabled = disabled || full ? ' disabled aria-disabled="true"' : '';
  const picker = join([
    '<div class="form-group">',
    `<label class="form-label" for="cc-news-team-add">${esc(NEWS_SETTINGS_COPY.addLabel)}</label>`,
    `<select class="form-input" id="cc-news-team-add" data-field="news-add-team"${selectDisabled}>`,
    PLACEHOLDER_OPTION(),
    newsTeamOptionsHTML(catalog, teams),
    '</select>',
    `<p class="text-muted text-xs mt-sm alma-catalog-note" id="cc-news-team-note" role="status">${esc(full ? NEWS_SETTINGS_COPY.maxTeams : (m.catalogNote || ''))}</p>`,
    '</div>',
  ]);

  return join([
    note,
    join(['<div class="control-center-group">', master, '</div>']),
    join(['<div class="control-center-group">', `<div class="control-center-group-label">${esc(NEWS_SETTINGS_COPY.sportsLabel)}</div>`, join(sportRows), '</div>']),
    join(['<div class="control-center-group">', `<div class="control-center-group-label">${esc(NEWS_SETTINGS_COPY.teamsLabel)}</div>`, chipRow, picker, `<p class="text-muted text-xs news-settings-hint">${esc(NEWS_SETTINGS_COPY.teamsHint)}</p>`, '</div>']),
    `<p class="text-muted text-xs news-settings-footer">${esc(NEWS_SETTINGS_COPY.footer)}</p>`,
  ]);
}

/** The whole pushed pane: the back row (the same `.control-center-back` Profile uses), the title, then the body. */
export function renderNewsSettingsPane(model) {
  return join([
    '<div class="control-center-profile control-center-news">',
    join(['<button type="button" class="control-center-back" data-action="cc-pop-news">', glyph('cc-row-icon', 'chevronLeft'), ' ', esc(NEWS_SETTINGS_COPY.back), '</button>']),
    `<div class="admin-section-title">${esc(NEWS_SETTINGS_COPY.title)}</div>`,
    renderNewsSettingsBody(model),
    '</div>',
  ]);
}

/**
 * A tap -> the preference PATCH it means, or null (nothing to write). Pure. `news` is ctx.news; `data` is the control's dataset (`sport`, `team`,
 * `value`). Writes go through storage.setNewsPrefs, which validates again; this keeps the control-center handlers one line each and is unit-tested.
 */
export function newsPatchFor(action, news, data = {}) {
  const n = news && typeof news === 'object' ? news : {};
  const sports = Array.isArray(n.sports) ? n.sports : [];
  const teams = Array.isArray(n.teams) ? n.teams : [];
  if (n.leagueOff === true) return null;                                   // the league layer is off: every control is disabled, so a stray event writes nothing
  switch (action) {
    case 'cc-news-toggle-on': return { on: n.on === false };
    case 'cc-news-toggle-sport': {
      const sport = data && typeof data.sport === 'string' ? data.sport : '';
      if (NEWS_SPORT_KEYS.indexOf(sport) < 0) return null;
      const has = sports.indexOf(sport) >= 0;
      return { sports: NEWS_SPORT_KEYS.filter((k) => (k === sport ? !has : sports.indexOf(k) >= 0)) };
    }
    case 'cc-news-remove-team': {
      const team = data && typeof data.team === 'string' ? data.team.toLowerCase() : '';
      if (!team) return null;
      return { teams: teams.filter((t) => String(t).toLowerCase() !== team) };
    }
    case 'cc-news-add-team': {
      const value = data && typeof data.value === 'string' ? data.value.trim() : '';
      const max = Number.isInteger(n.maxTeams) && n.maxTeams > 0 ? n.maxTeams : NEWS_SETTINGS_DEFAULT_MAX_TEAMS;
      if (!value || teams.length >= max || teams.some((t) => String(t).toLowerCase() === value.toLowerCase())) return null;
      return { teams: [...teams, value] };
    }
    default: return null;
  }
}

/**
 * Replaces the picker's options IN PLACE when ESPN's full school list lands (the alma-mater picker's own landing, js/app.js
 * patchProfileAlmaMaterOptionsInPlace): the select node itself survives, so a picker the player already has open is not detached.
 * `doc` is the document (injected for tests). Returns true when a select was patched.
 */
export function patchNewsTeamOptionsInPlace(doc, catalog, chosenTeams) {
  const sel = doc && typeof doc.getElementById === 'function' ? doc.getElementById('cc-news-team-add') : null;
  if (!sel) return false;
  const current = typeof sel.value === 'string' ? sel.value : '';
  sel.innerHTML = PLACEHOLDER_OPTION() + newsTeamOptionsHTML(catalog, chosenTeams);
  sel.value = current;
  return true;
}
