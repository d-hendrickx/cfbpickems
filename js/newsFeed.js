/**
 * CFB Pickems — js/newsFeed.js (Social Platform News, option A: ESPN headlines only — the ADAPTER, 2026-10-01)
 * ============================================================================================================
 * Glue between the news modules and the two surfaces that use them. It owns no rule of its own: the fetch is newsTransport.js, the ordering is
 * newsRank.js, the card and the tap are newsCard.js, text hygiene is newsRules.js. There is no betting filter (Drew reversed SD-6 on
 * 2026-10-01: "I want betting news"). What lives here is the one place the VIEWER'S data is read,
 * synchronously, from the storage seam, and handed to those pure modules as plain arguments.
 *
 * ── HOME (createHomeNews) — the typed optional slot js/home.js already defines ──────────────────────────────────────
 * `createHome({ ..., fetchNews: homeNews.fetchNews, renderNewsCard: homeNews.renderNewsCard })`, then `homeNews.bindEvents(container)`.
 *   fetchNews({force}) resolves:
 *     · `null`        news is OFF for this viewer (the kill switch's three layers, DI-381): NO fetch, NO image request, and Home renders NOTHING
 *                     for the slot — not a message, not a ghost card (DI-380 "News off"). Home treats `null` as "the slot does not exist".
 *     · `NewsItem[]`  fresh, filtered, ranked for THIS viewer (possibly empty -> Home's calm "No headlines yet" line)
 *     · rejects       NewsUnavailableError -> Home's calm "News is temporarily unavailable." + Retry (never the red league banner)
 *   The viewer's own picks are computed by newsRank.ownPickTeamNames() from the FULL week's picks plus the viewer's id — never by
 *   getPicks(weekId, viewerId), whose player filter is skipped when the id is falsy (S-C2). No pick-derived value is ever a request input: a
 *   request is `GET <fixed per-sport url>?limit=20`, and the sports come from the player's own preferences alone (the S-C2-N property B keeps).
 *
 * THE SLATE (SC-N13(b)): every game of the CURRENT, PUBLISHED week (open / locked / live), home and away, whatever the GAME's status — never a
 * picks-filtered or visibility-filtered subset. A draft week's slate is not published (it must not leak through a headline label) and a final
 * week is not "this week's slate", so both yield no slate and no pick tier (tier 4 still works: news renders any time, decision #7).
 *
 * ── SETTINGS (buildNewsSettingsCtx / makeNewsSettingsCallbacks) — what the control-center drawer's News pane is handed ──
 * Pure data in, plain callbacks out; control-center.js renders and app.js only supplies the team catalog and a refresh function.
 *
 * Import allow-list (asserted by newstest, UN-341 / S-C10): storage, auth, and exactly three of the news modules (newsTransport, newsRank, newsCard). newsRules and newsSettings are not
 * imported here (newsRules is the transport's and the card's, newsSettings is control-center's). No AI, no Edge function, no second host.
 * iOS 15.0 safe.
 */

import { getNewsPrefs, setNewsPrefs, seedNewsTeamsOnce, getSettings, getSession, getPlayer, getCurrentWeek, getGames, getPicks, ALLOWED_NEWS_SPORTS, NEWS_TEAMS_MAX_COUNT } from './storage.js';
import { getIdentityEpoch, getActiveLeagueId } from './auth.js';
import { fetchNews as transportFetchNews, isNewsAvailable, clearNewsCache, NEWS_FEATURE_ENABLED } from './newsTransport.js';
import { rankNews, ownPickTeamNames } from './newsRank.js';
import { renderNewsCard, bindNewsCardEvents } from './newsCard.js';

/** The empty line when News is on but the player unchecked every sport (reviewer F5): say what to do, calmly, instead of "check back later". */
export const NEWS_EMPTY_NO_SPORTS_COPY = 'Pick at least one sport in News settings.';

/** Week statuses whose slate is published and still "this week" (draft is unpublished; final is over). */
export const NEWS_SLATE_STATUSES = Object.freeze(['open', 'locked', 'live']);

// ─── prefs-changed notification (settings -> whoever shows news) ──────────────────────────────────────────────────────

const _listeners = new Set();
/** Subscribe to "the player changed a News preference". Returns an unsubscribe. The Home wiring registers `homeView.resetNews` + a repaint here. */
export function subscribeNewsPrefsChanged(fn) {
  if (typeof fn !== 'function') return () => {};
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
export function notifyNewsPrefsChanged() {
  for (const fn of Array.from(_listeners)) {
    try { fn(); } catch (e) { console.warn('[news] a prefs-changed listener threw', e && e.name); }
  }
}

// ─── readers (every one overridable, so the whole adapter is tested with fakes) ───────────────────────────────────────

function defaultReaders() {
  return {
    prefs: getNewsPrefs,
    settings: getSettings,
    viewerId: () => { const s = getSession(); return s && typeof s.playerId === 'string' ? s.playerId : null; },
    almaMater: (playerId) => { const p = playerId ? getPlayer(playerId) : null; return p && typeof p.almaMater === 'string' ? p.almaMater : ''; },
    week: getCurrentWeek,
    games: (weekId) => getGames(weekId),
    picks: (weekId) => getPicks(weekId),               // deliberately NO second argument: ownPickTeamNames() does the viewer filtering itself
    identity: () => ({ epoch: getIdentityEpoch(), leagueId: getActiveLeagueId() }),
  };
}

/** The sport a game belongs to for news purposes: a manual NFL game says so; everything else is the league's CFB. */
const gameSport = (g) => (g && g.espnSport === 'nfl' ? 'nfl' : 'cfb');

/** The league's sport for news: settings.sport when it is one of the five, else CFB (the DI's fallback; `settings.sport` does not exist today). */
export function leagueSportOf(settings) {
  const s = settings && typeof settings === 'object' ? settings.sport : null;
  return ALLOWED_NEWS_SPORTS.indexOf(s) >= 0 ? s : 'cfb';
}

/** The rank inputs for one viewer, read synchronously. Pure of everything but the readers. */
export function buildRankInputs(read) {
  const prefs = read.prefs();
  const settings = read.settings();
  const leagueSport = leagueSportOf(settings);
  const viewerId = read.viewerId();
  const week = read.week();
  let slateGames = [];
  let allPicks = [];
  if (week && NEWS_SLATE_STATUSES.indexOf(week.status) >= 0) {
    const games = read.games(week.weekId);
    slateGames = (Array.isArray(games) ? games : []).filter((g) => g && typeof g === 'object' && gameSport(g) === leagueSport);
    const picks = read.picks(week.weekId);
    allPicks = Array.isArray(picks) ? picks : [];
  }
  const slateTeams = [];
  for (const g of slateGames) {
    for (const name of [g.homeTeam, g.awayTeam]) { if (typeof name === 'string' && name.trim() && slateTeams.indexOf(name) < 0) slateTeams.push(name); }
  }
  const alma = viewerId ? String(read.almaMater(viewerId) || '').trim() : '';
  return {
    slateTeams,
    ownPickTeams: ownPickTeamNames(allPicks, slateGames, viewerId),
    almaMaterTeams: alma ? [alma] : [],
    homeTeams: prefs.teams.filter((t) => !alma || t.toLowerCase() !== alma.toLowerCase()),
    enabledSports: prefs.sports,
    teamSports: { slate: [leagueSport], pick: [leagueSport], alma: ['cfb', 'cbb'], home: ['cfb', 'cbb'] },
  };
}

// ─── Home ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ read?: object, transport?: { fetchNews: Function }, now?: Function }} [deps]
 * @returns {{ fetchNews: Function, renderNewsCard: Function, bindEvents: Function, reset: Function, isOn: Function, currentItems: Function, emptyCopy: Function }}
 */
export function createHomeNews(deps = {}) {
  const read = { ...defaultReaders(), ...(deps.read && typeof deps.read === 'object' ? deps.read : {}) };
  const transport = deps.transport && typeof deps.transport.fetchNews === 'function' ? deps.transport : { fetchNews: transportFetchNews };
  const now = typeof deps.now === 'function' ? deps.now : () => Date.now();
  let held = null;                                      // { items, token } — what the cards on screen were rendered from (the tap resolves ids against it)

  const available = () => isNewsAvailable({ leagueSettings: read.settings(), playerPrefs: read.prefs() });
  const sameToken = (a, b) => !!a && !!b && a.epoch === b.epoch && a.leagueId === b.leagueId;

  /** The items a tap may resolve: only while they belong to the CURRENT identity (the memo tears itself down; reset() also clears it). */
  function currentItems() {
    if (!held) return [];
    if (!sameToken(held.token, read.identity())) { held = null; return []; }
    return held.items;
  }

  async function fetchNews({ force = false } = {}) {
    if (!available()) { held = null; return null; }     // OFF: no request of any kind, and Home renders nothing for the slot
    const token = read.identity();
    const { items } = await transport.fetchNews({ sports: read.prefs().sports, force: !!force, now: now() });
    if (!available()) { held = null; return null; }     // turned off while it loaded: drop the result, paint nothing
    if (!sameToken(token, read.identity())) { held = null; throw new Error('news identity moved'); }
    const ranked = rankNews(items, { ...buildRankInputs(read), now: now() });
    held = { items: ranked, token };
    return ranked;
  }

  return {
    fetchNews,
    renderNewsCard: (item) => renderNewsCard(item),
    /** One delegated binding on Home's container (the same element Home paints into). Re-binding replaces the earlier one. */
    bindEvents: (rootEl, opts = {}) => bindNewsCardEvents(rootEl, { items: currentItems, onOpen: opts.onOpen }),
    /** The identity chokepoint's hook (applyIdentityDeltaIfChanged): forget everything that was ranked for the previous viewer. */
    reset: () => { held = null; clearNewsCache(); },
    isOn: available,
    currentItems,
    /** Home's optional `newsEmptyCopy` dep: a more specific reason for an empty slot, or null (Home then uses its own "No headlines yet" line). */
    emptyCopy: () => (available() && read.prefs().sports.length === 0 ? NEWS_EMPTY_NO_SPORTS_COPY : null),
  };
}

// ─── the News settings pane's inputs ──────────────────────────────────────────────────────────────────────────────────

/**
 * `ctx.news` for control-center.js, or null when the feature is off app-wide (the row then does not exist at all).
 * @param {{ teamCatalog?: Array<{location:string, displayName?:string}>, read?: object }} [opts]
 */
export function buildNewsSettingsCtx({ teamCatalog = [], read } = {}) {
  if (!NEWS_FEATURE_ENABLED) return null;
  const r = { ...defaultReaders(), ...(read && typeof read === 'object' ? read : {}) };
  const prefs = r.prefs();
  const settings = r.settings();
  const viewerId = r.viewerId();
  return {
    on: prefs.on,
    sports: prefs.sports,
    teams: prefs.teams,
    leagueOff: !!settings && settings.newsEnabled === false,
    maxTeams: NEWS_TEAMS_MAX_COUNT,
    catalog: (Array.isArray(teamCatalog) ? teamCatalog : []).filter((t) => t && typeof t.location === 'string' && t.location).map((t) => ({ location: t.location, displayName: typeof t.displayName === 'string' && t.displayName ? t.displayName : t.location })),
    almaMater: viewerId ? String(r.almaMater(viewerId) || '') : '',
  };
}

/**
 * The two callbacks the drawer's News pane drives. `refresh` repaints the drawer; `ensureCatalog` kicks the existing ESPN school-list fetch
 * (app.js's maybeRefreshAlmaMaterCatalog — one catalog, one fetch, never a second).
 */
export function makeNewsSettingsCallbacks({ refresh, ensureCatalog } = {}) {
  const safe = (fn, label) => { try { if (typeof fn === 'function') return fn(); } catch (e) { console.warn(`[news] ${label} failed`, e && e.name); } return undefined; };
  return {
    onOpenNews: () => {
      safe(() => seedNewsTeamsOnce(), 'the one-time team seed');
      safe(refresh, 'refresh');
      safe(ensureCatalog, 'the catalog fetch');
    },
    // No refresh here, deliberately: the drawer already applied the patch to its own ctx.news (a switch flipped in place so its 150 ms transition plays,
    // a team change repainted the pane), and a full repaint would only replace the node under the finger. The next update() rebuilds ctx from storage.
    onSetNewsPrefs: (patch) => {
      setNewsPrefs(patch);
      notifyNewsPrefsChanged();
    },
  };
}
