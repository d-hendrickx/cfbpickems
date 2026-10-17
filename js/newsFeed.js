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
 *   request is `GET <fixed per-sport url>?limit=20`, and the sports come from the player's own preferences plus the league's published slate sports (S-C2-N as amended
 *   by the coordinator's ruling of 2026-10-14 for PF-480: league-level only, never a pick).
 *
 * THE SLATE (SC-N13(b)): every game of the CURRENT, PUBLISHED week (open / locked / live), home and away, whatever the GAME's status — never a
 * picks-filtered or visibility-filtered subset. A draft week's slate is not published (it must not leak through a headline label) and a final
 * week is not "this week's slate", so both yield no slate and no pick tier (tier 4 still works: news renders any time, decision #7).
 *
 * ── SETTINGS (buildNewsSettingsCtx / makeNewsSettingsCallbacks) — what the control-center drawer's News pane is handed ──
 * Pure data in, plain callbacks out; control-center.js renders and app.js only supplies the team catalog and a refresh function.
 *
 * Import allow-list (asserted by newstest, UN-341 / S-C10): storage, auth, data-model (TIME_ZONES only), team-match, and exactly three of the news modules (newsTransport,
 * newsRank, newsCard). newsRules and newsSettings are not imported here (newsRules is the transport's and the card's, newsSettings is control-center's). No AI, no Edge
 * function, no second host.
 *
 * ── D1 (DI-673, DI-663, 2026-10-08) ───────────────────────────────────────────────────────────────────────────────────
 *   · The request now carries `slateKeys`: normTeam of every team in the league's PUBLISHED slate (every game of the current week, whatever its status — SC-N13(b)),
 *     sorted and truncated (slateKeysFor). Never a pick: two viewers who differ only in their picks send byte-identical requests (S-C2-N, newstest [11]).
 *   · STORYLINES (DI-663): an article whose server-built team keys match a team in the published slate becomes a STORYLINE card: the publisher's headline and photo with
 *     a deterministic tag — "Oregon at Penn State · Sat" when the team's game is live or kicks off within 72 hours, else the team name alone. Published within 7 days; at
 *     most 3 per game and 8 on Home; the rest stay ordinary News. An article appears ONCE on Home. Newest first. No model text, ever (D-49). The viewer's picks play no part.
 *   · Taps: a storyline opens the publisher's page exactly as a News card does (DI-663: "a tap opens the publisher's page"); the "Also from" row (DI-672) opens the sheet
 *     the app registered (registerHomeNewsOpeners).
 * iOS 15.0 safe.
 */

import { getNewsPrefs, setNewsPrefs, seedNewsTeamsOnce, getSettings, getSession, getPlayer, getCurrentWeek, getGames, getPicks, getTimezone, ALLOWED_NEWS_SPORTS, NEWS_TEAMS_MAX_COUNT } from './storage.js';
import { getIdentityEpoch, getActiveLeagueId } from './auth.js';
import { fetchNews as transportFetchNews, fetchContent as transportFetchContent, isNewsAvailable, clearNewsCache, NEWS_FEATURE_ENABLED, slateKeysFor } from './newsTransport.js';
import { rankNews, ownPickTeamNames } from './newsRank.js';
import { renderNewsCard, renderStorylineCard, bindNewsCardEvents } from './newsCard.js';
import { normTeam } from './team-match.js';
import { TIME_ZONES, formatGameTime } from './data-model.js';
import { eligibleCards, CONTENT_KINDS } from './feed-relevance.js';                                     // D1 Lane C (DI-668): the content cards' private relevance
import { renderContentCard, renderContentErrorNote, bindContentCardEvents } from './content-card.js';   // D1 Lane C (DI-660): the content cards' one sink

/** The empty line when News is on but the player unchecked every sport (reviewer F5): say what to do, calmly, instead of "check back later". */
export const NEWS_EMPTY_NO_SPORTS_COPY = 'Pick at least one sport in News settings.';

/** Review B3: the item the adapter appends when the NEWS read failed but content cards stand; Home turns it into its "News is temporarily unavailable." note with Retry. */
export const NEWS_ERROR_MARKER = Object.freeze({ id: 'news-error', cardKind: 'news-error' });
const asSportList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

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

/**
 * Review B2 (2026-10-14): EVERY current week, one per sport the league plays (a CFB + NFL league has two). app.js registers its `currentWeeksToSweep()` (DI-535: the multi-sport
 * sweep) at boot; without a registration it is the single current week. An injected `read.week` (the tests' single-week fakes) is honoured as a one-week list.
 */
let _weeksReader = null;
export function registerHomeNewsWeeks(fn) { _weeksReader = typeof fn === 'function' ? fn : null; }
function defaultWeeks() {
  if (_weeksReader) { try { const w = _weeksReader(); if (Array.isArray(w)) return w.filter(Boolean); } catch { /* the single week below */ } }
  const one = getCurrentWeek();
  return one ? [one] : [];
}

function defaultReaders() {
  return {
    prefs: getNewsPrefs,
    settings: getSettings,
    viewerId: () => { const s = getSession(); return s && typeof s.playerId === 'string' ? s.playerId : null; },
    almaMater: (playerId) => { const p = playerId ? getPlayer(playerId) : null; return p && typeof p.almaMater === 'string' ? p.almaMater : ''; },
    week: getCurrentWeek,
    weeks: defaultWeeks,
    games: (weekId) => getGames(weekId),
    picks: (weekId) => getPicks(weekId),               // deliberately NO second argument: ownPickTeamNames() does the viewer filtering itself
    identity: () => ({ epoch: getIdentityEpoch(), leagueId: getActiveLeagueId() }),
    timezone: () => { try { return getTimezone(); } catch { return 'PT'; } },
  };
}

// ─── the app's openers (registered once at boot by app.js; nothing here opens a sheet or a screen itself) ─────────────────

const _openers = { alsoFrom: null, content: null, retryContent: null };
/** app.js registers the "Also from" sheet opener (DI-672), the content detail opener (DI-669) and the content Retry (DI-660). Absent = the control renders but does nothing
 *  (fail quiet, never a crash). */
export function registerHomeNewsOpeners({ openAlsoFrom, openContent, retryContent } = {}) {
  _openers.alsoFrom = typeof openAlsoFrom === 'function' ? openAlsoFrom : null;
  _openers.content = typeof openContent === 'function' ? openContent : null;
  _openers.retryContent = typeof retryContent === 'function' ? retryContent : null;
}

// ─── storylines (DI-663) ──────────────────────────────────────────────────────────────────────────────────────────────────

export const STORYLINE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const STORYLINE_GAME_RANGE_MS = 72 * 60 * 60 * 1000;
export const STORYLINE_PER_GAME = 3;
export const STORYLINE_MAX = 8;

/** "Sat" — the weekday of an instant in the viewer's zone (render-time, CONVENTIONS #19). */
function weekdayIn(ms, tzKey) {
  const iana = (TIME_ZONES.find((z) => z.key === tzKey) || TIME_ZONES[0]).iana;
  try { return new Date(ms).toLocaleDateString('en-US', { weekday: 'short', timeZone: iana }); } catch { return ''; }
}

/**
 * Pick the storylines from the transport's items (BEFORE News's 48-hour ranking window: a storyline may be up to 7 days old). Pure of everything but its arguments.
 * @returns {{ storylines: object[], rest: object[] }} storylines are NEW objects with `cardKind: 'storyline'` and `storyline: { tag, gameId }`; `rest` is untouched.
 */
export function selectStorylines(items, { slateGames = [], now = Date.now(), tzKey = 'PT' } = {}) {
  const games = (Array.isArray(slateGames) ? slateGames : []).filter((g) => g && typeof g === 'object' && typeof g.homeTeam === 'string' && typeof g.awayTeam === 'string');
  const teamToGame = new Map();                        // norm -> games (review B2: a team name may sit in two sports' slates; an item links only to a game of its own sport)
  for (const g of games) for (const t of [g.homeTeam, g.awayTeam]) { const k = normTeam(t); if (k) { const l = teamToGame.get(k) || []; if (l.indexOf(g) < 0) l.push(g); teamToGame.set(k, l); } }
  const gameFor = (k, sport) => {
    const l = teamToGame.get(k);
    if (!l) return null;
    return l.find((g) => !g._sport || !sport || g._sport === sport) || null;
  };
  const inRange = (g) => {
    const k = Date.parse(g.kickoffTime || g.kickoff || g.startTime || '');
    const live = g.status === 'in' || g.status === 'live' || g.state === 'in';
    return live || (Number.isFinite(k) && k >= now - 4 * 60 * 60 * 1000 && k <= now + STORYLINE_GAME_RANGE_MS);
  };
  const cands = (Array.isArray(items) ? items : []).filter((it) => {
    const ms = Date.parse(it && it.publishedAt);
    return it && Number.isFinite(ms) && ms <= now + 5 * 60 * 1000 && now - ms <= STORYLINE_WINDOW_MS && Array.isArray(it.teamKeys) && it.teamKeys.length;
  }).sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (a.id < b.id ? -1 : 1));
  const perGame = new Map();
  const chosen = new Map();
  for (const it of cands) {
    if (chosen.size >= STORYLINE_MAX) break;
    let game = null, team = null;
    for (const k of it.teamKeys) { const g = gameFor(normTeam(k), it.sport === 'cfb' || it.sport === 'nfl' ? it.sport : null); if (g) { game = g; team = [g.homeTeam, g.awayTeam].find((t) => normTeam(t) === normTeam(k)) || null; break; } }
    if (!game) continue;
    const gid = String(game.gameId || `${game.awayTeam}@${game.homeTeam}`);
    if ((perGame.get(gid) || 0) >= STORYLINE_PER_GAME) continue;
    let tag;
    if (inRange(game)) {
      const k = Date.parse(game.kickoffTime || game.kickoff || game.startTime || '');
      const day = Number.isFinite(k) ? weekdayIn(k, tzKey) : '';
      tag = `${game.awayTeam} at ${game.homeTeam}${day ? ` · ${day}` : ''}`;
    } else {
      tag = team || game.homeTeam;
    }
    perGame.set(gid, (perGame.get(gid) || 0) + 1);
    chosen.set(it.id, { ...it, cardKind: 'storyline', storyline: Object.freeze({ tag, gameId: gid }) });
  }
  return { storylines: Array.from(chosen.values()), rest: (Array.isArray(items) ? items : []).filter((it) => it && !chosen.has(it.id)) };
}

/**
 * The sport a game belongs to for news purposes (review B2): the game's own ESPN sport ('nfl'; 'college-football' is CFB), else its WEEK's sport (app.js registers the weeks
 * with their competition's sport — competitionForWeek, never a stored week.sport), else CFB (the original rule: everything unmarked is the league's college football).
 */
const gameSport = (g, week = null) => {
  if (g && g.espnSport === 'nfl') return 'nfl';
  if (g && (g.espnSport === 'college-football' || g.espnSport === 'cfb')) return 'cfb';
  if (week && (week.sport === 'nfl' || week.sport === 'cfb')) return week.sport;
  return 'cfb';
};

/** The league's sport for news: settings.sport when it is one of the five, else CFB (the DI's fallback; `settings.sport` does not exist today). */
export function leagueSportOf(settings) {
  const s = settings && typeof settings === 'object' ? settings.sport : null;
  return ALLOWED_NEWS_SPORTS.indexOf(s) >= 0 ? s : 'cfb';
}

/**
 * The league's PUBLISHED slates: every game of every current week (one per sport, review B2) whose status is open / locked / live, each game tagged with its sport.
 * Pure of everything but the readers. `[{ week, games: [{ ...game, _sport }] }]`.
 */
export function publishedSlates(read) {
  let weeks = [];
  try { weeks = typeof read.weeks === 'function' ? read.weeks() : (read.week() ? [read.week()] : []); } catch { weeks = []; }
  const out = [];
  const seenWeek = new Set();
  for (const week of Array.isArray(weeks) ? weeks : []) {
    if (!week || NEWS_SLATE_STATUSES.indexOf(week.status) < 0 || seenWeek.has(week.weekId)) continue;
    seenWeek.add(week.weekId);
    const games = read.games(week.weekId);
    out.push({ week, games: (Array.isArray(games) ? games : []).filter((g) => g && typeof g === 'object').map((g) => ({ ...g, _sport: gameSport(g, week) })) });
  }
  return out;
}

/** The rank inputs for one viewer, read synchronously. Pure of everything but the readers. Review B2: the slate, the viewer's own picks and the slate sports cover EVERY current
 *  week; the team groups are also given BY SPORT so a CFB slate team never tags an NFL item (and the reverse). */
export function buildRankInputs(read) {
  const prefs = read.prefs();
  const settings = read.settings();
  const leagueSport = leagueSportOf(settings);
  const viewerId = read.viewerId();
  const slates = publishedSlates(read);
  const slateGames = [];
  let allPicks = [];
  for (const { week, games } of slates) {
    slateGames.push(...games);
    const picks = read.picks(week.weekId);
    if (Array.isArray(picks)) allPicks = allPicks.concat(picks);
  }
  const slateTeams = [];
  const slateTeamsBySport = {};
  for (const g of slateGames) {
    for (const name of [g.homeTeam, g.awayTeam]) {
      if (typeof name !== 'string' || !name.trim()) continue;
      if (slateTeams.indexOf(name) < 0) slateTeams.push(name);
      const bucket = slateTeamsBySport[g._sport] || (slateTeamsBySport[g._sport] = []);
      if (bucket.indexOf(name) < 0) bucket.push(name);
    }
  }
  const slateSports = Object.keys(slateTeamsBySport).sort();
  const ownPickTeamsBySport = {};
  for (const sp of slateSports) ownPickTeamsBySport[sp] = ownPickTeamNames(allPicks, slateGames.filter((g) => g._sport === sp), viewerId);
  const alma = viewerId ? String(read.almaMater(viewerId) || '').trim() : '';
  const groupSports = slateSports.length ? slateSports : [leagueSport];
  return {
    slateTeams,
    ownPickTeams: ownPickTeamNames(allPicks, slateGames, viewerId),
    slateTeamsBySport,
    ownPickTeamsBySport,
    slateSports,
    almaMaterTeams: alma ? [alma] : [],
    homeTeams: prefs.teams.filter((t) => !alma || t.toLowerCase() !== alma.toLowerCase()),
    enabledSports: prefs.sports,
    teamSports: { slate: groupSports, pick: groupSports, alma: ['cfb', 'cbb'], home: ['cfb', 'cbb'] },
  };
}

// ─── Home ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * @param {{ read?: object, transport?: { fetchNews: Function }, now?: Function }} [deps]
 * @returns {{ fetchNews: Function, renderNewsCard: Function, bindEvents: Function, reset: Function, isOn: Function, currentItems: Function, emptyCopy: Function }}
 */
export function createHomeNews(deps = {}) {
  const injected = deps.read && typeof deps.read === 'object' ? deps.read : {};
  const read = { ...defaultReaders(), ...injected };
  if (typeof injected.week === 'function' && typeof injected.weeks !== 'function') read.weeks = () => { const w = injected.week(); return w ? [w] : []; };   // a one-week fake stays one week
  const transport = deps.transport && typeof deps.transport.fetchNews === 'function' ? deps.transport : { fetchNews: transportFetchNews, fetchContent: transportFetchContent };
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

  /** The PUBLISHED slates' games (every game of every current open / locked / live week, every sport the league plays — review B2) — the same set buildRankInputs reads. */
  function publishedSlate() {
    return publishedSlates(read).flatMap((s) => s.games);
  }
  const tzKey = () => { try { return read.timezone(); } catch { return 'PT'; } };
  const ianaOf = (key) => (TIME_ZONES.find((z) => z.key === key) || TIME_ZONES[0]).iana;

  /**
   * D1 Lane C (DI-660 / DI-668): the CONTENT leg, beside the news. It asks the server for public cards with NO pick, team or league argument, and applies the viewer's
   * private relevance HERE (feed-relevance.js). A failed read is ONE calm 'content-error' note; it never costs the news, and the news never costs it (review B3).
   * Review B2: the sports asked for are the league's CURRENT SLATE sports (every current week; the league's sport when nothing is published) PLUS the followed sports
   * (News on). Followed sports only widen the "sport" tier; the slate and pick tiers are per sport. Review B4: unseen-first uses Home's visit baseline (`seenBaseline`).
   */
  async function loadContent({ force, newsOn, seenBaseline }) {
    const fetchContent = transport.fetchContent;                                         // an injected transport without one (the older tests) has no content leg
    if (typeof fetchContent !== 'function') return [];
    const known = (sp) => sp === 'cfb' || sp === 'nfl';
    const pre = buildRankInputs(read);
    const slateSports = pre.slateSports.length ? pre.slateSports : [leagueSportOf(read.settings())];
    const followed = newsOn ? asSportList(read.prefs().sports) : [];
    const sports = Array.from(new Set([...slateSports, ...followed])).filter(known).sort();
    if (!sports.length) return [];
    try {
      const res = await fetchContent({ sports, force: !!force, now: now() });
      const inputs = buildRankInputs(read);                                              // re-read after the await: the slate or the picks may have moved
      let seenBefore = null;
      try { const b = typeof seenBaseline === 'function' ? seenBaseline() : seenBaseline; seenBefore = Number.isFinite(b) ? b : null; } catch { seenBefore = null; }
      return eligibleCards(res && Array.isArray(res.items) ? res.items : [], { slateTeams: inputs.slateTeams, ownPickTeams: inputs.ownPickTeams,
        slateTeamsBySport: inputs.slateTeamsBySport, ownPickTeamsBySport: inputs.ownPickTeamsBySport, almaMaterTeams: inputs.almaMaterTeams,
        homeTeams: inputs.homeTeams, enabledSports: sports, seenBefore, now: now() });
    } catch {
      return [Object.freeze({ id: 'content-error', cardKind: 'content-error', publishedAt: new Date(now()).toISOString() })];
    }
  }

  async function fetchNews({ force = false, seenBaseline = null } = {}) {
    const token = read.identity();
    const newsOn = available();
    const contentP = loadContent({ force, newsOn, seenBaseline });
    if (!newsOn) {                                       // News OFF: no news request of any kind; the content cards alone, or no slot at all
      const content = await contentP;
      if (!sameToken(token, read.identity())) { held = null; throw new Error('news identity moved'); }
      const shown = content.filter((c) => c.cardKind !== 'content-error');
      held = shown.length ? { items: shown, token } : null;
      return shown.length ? shown : null;
    }
    const slate = publishedSlate();
    /** Coordinator ruling (2026-10-14, amends S-C2-N for PF-480): the request carries the viewer's FOLLOWED sports plus the sports of the league's current PUBLISHED slates —
     *  the same rule as the content leg — so an NFL pick in a CFB + NFL league gets its NFL storylines with default preferences. League-level only: two viewers who differ
     *  only in their picks still send byte-identical requests. A viewer who unchecked EVERY sport still asks for nothing ("Pick at least one sport", reviewer F5). Followed
     *  sports alone still decide the ordinary "sport" tier (rankNews's enabledSports); a slate sport adds storylines and slate / pick matches only. */
    const newsRequestSports = () => {
      const followed = asSportList(read.prefs().sports);
      if (!followed.length) return followed;
      const extra = Array.from(new Set(slate.map((g) => g._sport))).filter((sp) => ALLOWED_NEWS_SPORTS.indexOf(sp) >= 0 && followed.indexOf(sp) < 0).sort();
      return [...followed, ...extra];
    };
    const slateKeys = slateKeysFor(slate.flatMap((g) => [g.homeTeam, g.awayTeam]), normTeam);   // the league's PUBLISHED slate, never a pick (S-C2-N)
    let res, newsErr = null;
    try { res = await transport.fetchNews({ sports: newsRequestSports(), slateKeys, force: !!force, now: now() }); } catch (e) { newsErr = e; }
    const content = await contentP;
    if (newsErr) {                                       // review B3: a failed NEWS read keeps the content cards and adds Home's news-error note (DI-660); with no content it is the error it was
      const shown = content.filter((c) => c.cardKind !== 'content-error');
      if (!shown.length || !available() || !sameToken(token, read.identity())) { held = null; throw newsErr; }
      const all = [...shown, NEWS_ERROR_MARKER];
      held = { items: shown, token };
      return all;
    }
    if (!available()) { held = null; return null; }     // turned off while it loaded: drop the result, paint nothing
    if (!sameToken(token, read.identity())) { held = null; throw new Error('news identity moved'); }
    if (res && res.off === 'platform') {                 // News is paused platform-wide (news_enabled false): no headline slot; the content cards still stand
      const shown = content.filter((c) => c.cardKind !== 'content-error');
      held = shown.length ? { items: shown, token } : null;
      return shown.length ? shown : null;
    }
    const items = res && Array.isArray(res.items) ? res.items : [];
    const { storylines, rest } = selectStorylines(items, { slateGames: slate, now: now(), tzKey: read.timezone() });
    const ranked = rankNews(rest, { ...buildRankInputs(read), now: now() });
    const all = [...storylines, ...ranked, ...content];
    held = { items: all, token };
    return all;
  }

  return {
    fetchNews,
    renderNewsCard: (item) => {
      if (item && item.cardKind === 'storyline') return renderStorylineCard(item);
      if (item && item.cardKind === 'content-error') return renderContentErrorNote();
      if (item && item.cardKind === 'news-error') return '';                          // Home paints its own news-error note for the marker (review B3)
      if (item && CONTENT_KINDS.indexOf(item.cardKind) >= 0) {
        const key = tzKey();
        return renderContentCard(item, { now: now(), timeZone: ianaOf(key), formatTime: (iso) => formatGameTime(iso, key) });   // review N2: the player's zone
      }
      return renderNewsCard(item);
    },
    /** One delegated binding on Home's container (the same element Home paints into). Re-binding replaces the earlier one. The news and the content cards each have their
     *  own dispatcher (a news card is a link to the publisher; a content card opens its detail): neither reacts to the other's markup. */
    bindEvents: (rootEl, opts = {}) => {
      const unNews = bindNewsCardEvents(rootEl, { items: currentItems, onOpen: opts.onOpen, onAlsoFrom: (item) => { if (_openers.alsoFrom) _openers.alsoFrom(item); } });
      const unContent = bindContentCardEvents(rootEl, { items: currentItems, onOpen: (item) => { if (_openers.content) _openers.content(item); }, onRetry: () => { if (_openers.retryContent) _openers.retryContent(); } });
      return () => { try { unNews(); } finally { unContent(); } };
    },
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
