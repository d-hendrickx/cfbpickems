/**
 * CFB Pickems — Data Provider v9
 *
 * Changes (item 1, 2026-09-04 — ESPN-canonical alma-mater dropdown):
 *  - fetchEspnTeamsList() — fetches ESPN's full FBS/FCS team catalog
 *    (https://.../football/college-football/teams?limit=1000, verified
 *    760 teams) for js/app.js's showEditPlayerModal() dropdown. Reuses this
 *    file's existing attemptFetch()/CORS_FALLBACKS chain — no separate
 *    transport, same direct-then-proxy resilience as every other ESPN call
 *    here. Throws on total failure; does NOT know about or apply the
 *    ALMA_MATERS-catalog fallback itself — that's the caller's job (Drew's
 *    explicit requirement: a fetch failure must never block editing a
 *    player), kept there so this function stays a plain "get me the data or
 *    throw" primitive like the rest of this file.
 *
 * Changes (v9, 2026-09-03, roster model corrected 2026-09-04):
 *  - fetchByDateRange/fetchCurrentCFBGames/resilientFetch/finalise/
 *    parseAndReport all take an optional `almaMaters` list (defaults to the
 *    ALMA_MATERS catalog, so every existing caller/test keeps working
 *    unchanged) — parse-time `isAlmaMaterGame` flagging now honors the
 *    passed list rather than the hardcoded constant. The real caller
 *    (app.js) passes `claimedAlmaMaters()` — the derived, player-claimed
 *    roster — not a separately-editable setting.
 *
 * Changes (v9):
 *  - Extract school (location/shortDisplayName) and mascot (team.name) separately
 *  - homeTeam/awayTeam now stores school name (cleaner, matches alma mater patterns)
 *  - homeMascot/awayMascot stored for "School (Mascot)" display format
 *  - extractSpread resolves the favorite from ESPN's structured
 *    homeTeamOdds/awayTeamOdds flags, then an exact team.abbreviation match,
 *    then fails closed (spread:null) — never a school-name substring guess
 *    (that rung inverted the sign on ~5% of matchups and was deleted 2026-09-03)
 *
 * Carried over from v8:
 *  - Kickoff time validation (confirmed/date-only/TBD)
 *  - Venue parsing — city/state or city/country
 *  - Date-range filtering
 *  - Multi-day fetchByDateRange merging
 */

import { ALMA_MATERS, TIME_WINDOW, GAME_STATUS, DATA_QUALITY, DATA_SOURCE_MODE, createGame, getAlmaMaterMatch, ESPN_SPORT_ENDPOINTS, espnSportPath } from './data-model.js';

const ESPN_API_ROOT = 'https://site.api.espn.com/apis/site/v2/sports';
const ESPN_CFB = `${ESPN_API_ROOT}/football/college-football/scoreboard`;

const CORS_FALLBACKS = [
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  url => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

// ── SECURITY S1 (Step 6 Phase 6 gate, 2026-09-20) — THE PROXIES ARE A BROWSER
//    AFFORDANCE AND MUST NEVER BE REACHED FROM A SERVER. ──────────────────────
//
// The three entries above exist for ONE reason: a browser cannot read ESPN's
// scoreboard when ESPN's CORS headers say no, so the request is bounced off an
// anonymous third party. `supabase/functions/scores-refresh` calls the same
// `refreshScoresByEventIds()` server-to-server, where there is no CORS at all —
// so a proxy hop there buys nothing and costs everything: it would hand a
// third party the shape of this league's live-window traffic, and it would let
// an ATTACKER-CONTROLLED response body (allorigins' `{contents:"…"}` wrapper is
// parsed below, by us) decide what score the service-role client writes into
// `public.games`. There is no CORS failure that makes that trade worth making.
//
// So the option is threaded, with a DEFAULT THAT CHANGES NOTHING for the six
// browsers (CONVENTIONS #10's direction: absent ⇒ behaves exactly as before).
// The function passes `allowProxy:false` explicitly and it is the only caller
// that does. Pinned by supabase/tests/functions/scoresRefresh.twin.mjs:326
// [10-1] (the server reaches zero proxies) and refreshtest.mjs:517 [5h-1] /
// refreshtest.mjs:524 [5h-3] (…while the browser's fallback is unchanged).
const FETCH_TIMEOUT_MS = 12000;

/** SECURITY S1 — the server path's own ceilings, applied ONLY when a caller asks
 *  for them (`maxBytes: 0` is the browser default and takes the untouched
 *  `res.json()` branch below). A scoreboard page is ~1 MB at its largest; the
 *  cap is generous enough that a real payload can never trip it and small enough
 *  that a redirected/hostile endpoint cannot stream an Edge invocation to death. */
export const SERVER_FETCH_DEFAULTS = Object.freeze({ allowProxy: false, timeoutMs: 10000, maxBytes: 8 * 1024 * 1024 });

const _state = {
  lastFetchUrl:       null,
  lastFetchTimestamp: null,
  lastFetchSuccess:   false,
  lastFetchMethod:    null,
  lastRawEventCount:  0,
  lastParsedCount:    0,
  lastQualityReport:  null,
  lastRawEvents:      [],
  lastScoreRefresh:   null,
  lastRequestedRange: null,  // { startDate, endDate } of what Commissioner asked for
};

// ─── URL BUILDER ──────────────────────────────────────────────────────────────

/**
 * Build the raw ESPN scoreboard URL (no proxy).
 *
 * `params.sport` (optional) — one of the keys in ESPN_SPORT_ENDPOINTS
 *   ('college-football', 'nfl'). Defaults to college-football to preserve
 *   backward compatibility with the pre-multi-sport call sites.
 *
 * The `groups=80` parameter is CFB-specific (FBS division filter) so we only
 * pass it when the sport is college-football. NFL and other sports don't use
 * groups and would return unexpected results if we sent it.
 *
 * Shown in Commissioner panel for transparency.
 */
export function buildEspnUrl(params = {}) {
  const { sport = 'college-football', ...rest } = params;
  const path = espnSportPath(sport);
  const isCfb = sport === 'college-football';
  const p = { ...(isCfb ? { groups: '80' } : {}), limit: '200', ...rest };
  const qs = new URLSearchParams(p).toString();
  return `${ESPN_API_ROOT}/${path}/scoreboard${qs ? '?' + qs : ''}`;
}

// ─── PUBLIC: FETCH ENTRY POINTS ───────────────────────────────────────────────

/**
 * Fetch games for a Commissioner-selected date range.
 *
 * Key behaviour:
 *  - Uses ONLY the Commissioner-selected dates, never ESPN's week range.
 *  - If startDate === endDate (or no endDate): single-day fetch.
 *  - If multi-day: fetch each day separately and merge (ESPN's ?dates= is single-day).
 *  - Games outside the requested date range are filtered out.
 *  - season parameter is optional context only; dates are the source of truth.
 */
export async function fetchByDateRange({ startDate, endDate, season, almaMaters = ALMA_MATERS } = {}) {
  if (!startDate) {
    return { games: [], error: 'No start date specified.', usingDemo: false, espnUrl: null };
  }

  _state.lastRequestedRange = { startDate, endDate: endDate || startDate };

  // Collect all dates in the range
  const dates = getDatesInRange(startDate, endDate || startDate);

  let allEvents = [];
  let lastEspnUrl = null;
  let lastMethod  = null;

  for (const date of dates) {
    const params = { dates: toEspnDate(date) };
    if (season) params.season = season;
    const espnUrl = buildEspnUrl(params);
    lastEspnUrl   = espnUrl;
    _state.lastFetchUrl = espnUrl;

    const result = await resilientFetch(espnUrl, almaMaters);
    if (result._rawEvents) {
      allEvents.push(...result._rawEvents);
      lastMethod = result.fetchMethod;
    }
  }

  // Deduplicate by event ID
  const seen = new Set();
  const uniqueEvents = allEvents.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id); return true;
  });

  _state.lastFetchTimestamp = new Date().toISOString();
  _state.lastRawEventCount  = uniqueEvents.length;
  _state.lastRawEvents      = uniqueEvents.slice(0, 10).map(e => e.name || e.shortName || `ID:${e.id}`);

  if (!uniqueEvents.length) {
    const err = `ESPN returned 0 events for ${startDate}${endDate && endDate !== startDate ? ` to ${endDate}` : ''}. Schedule may not be published yet.`;
    _state.lastQualityReport = buildFailReport(lastEspnUrl||'', err);
    return { games: [], error: err, usingDemo: false, espnUrl: lastEspnUrl, qualityReport: _state.lastQualityReport };
  }

  // Parse and filter to requested date range
  const { games, report } = parseAndReport(uniqueEvents, lastEspnUrl, lastMethod, startDate, endDate, almaMaters);
  _state.lastParsedCount   = games.length;
  _state.lastQualityReport = report;
  _state.lastFetchSuccess  = true;
  _state.lastFetchMethod   = lastMethod;

  return {
    games, error: null, usingDemo: false, espnUrl: lastEspnUrl,
    rawEventCount: uniqueEvents.length,
    qualityReport: report,
    rawEvents: _state.lastRawEvents,
    fetchMethod: lastMethod,
  };
}

export async function fetchCurrentCFBGames(almaMaters = ALMA_MATERS) {
  const espnUrl = buildEspnUrl({});
  _state.lastFetchUrl = espnUrl;
  return resilientFetch(espnUrl, almaMaters);
}

/**
 * Refresh live scores for a set of stored games. Each game may point at a
 * different ESPN sport (CFB, NFL, etc.) via its `espnSport` field. We bucket
 * games by sport, fetch each sport's scoreboard once, and merge results.
 *
 * Games without an `espnSport` are treated as CFB (default) so the pre-manual
 * codebase keeps working unchanged.
 *
 * The signature is kept the same as before — `(espnEventIds, storedGames)` —
 * so all existing call sites work. `storedGames` is what we actually use to
 * bucket by sport; `espnEventIds` is retained for historical compatibility
 * but is not required.
 */
export async function refreshScoresByEventIds(espnEventIds = [], storedGames = [], fetchOptions = {}) {
  // SECURITY S1 — `fetchOptions` is forwarded to resilientFetch() UNCHANGED and
  // is empty for every browser call site (js/app.js's doRefreshScores()), so the
  // client behaviour is byte-identical. `scores-refresh/index.js` is the one
  // caller that fills it: { allowProxy:false, timeoutMs, maxBytes }.
  // Bucket games by sport (default cfb)
  const bySport = new Map();
  for (const g of storedGames) {
    if (!g?.espnEventId) continue;
    const sport = g.espnSport || 'college-football';
    if (!bySport.has(sport)) bySport.set(sport, []);
    bySport.get(sport).push(g);
  }
  // Fetch each sport's scoreboard in parallel
  const fetches = [...bySport.keys()].map(async sport => {
    const url = buildEspnUrl({ sport });
    const result = await resilientFetch(url, ALMA_MATERS, fetchOptions);
    return { sport, result };
  });
  const settled = await Promise.all(fetches);

  const updated = [];
  const errors = [];
  // Item 2 remediation — per-eventId live status, merged across every
  // sport's fetch this cycle. Returned as a SIBLING of `updated`, never
  // attached to an `updated` entry itself (that entry's shape is spread
  // toward saveGame()'s allow-list in app.js; see the comment there).
  const liveStatusByEventId = new Map();
  for (const { sport, result } of settled) {
    if (result.error) { errors.push(`${sport}: ${result.error}`); continue; }
    if (!result.games?.length) continue;
    if (result._liveStatusByEventId) {
      for (const [eventId, status] of result._liveStatusByEventId) {
        liveStatusByEventId.set(eventId, status);
      }
    }
    const gamesInSport = bySport.get(sport) || [];
    for (const liveGame of result.games) {
      const stored = gamesInSport.find(g =>
        String(g.espnEventId) === String(liveGame.espnEventId)
      );
      if (!stored) continue;
      // ── Kickoff self-heal (RG, 2026-09-03) ───────────────────────────────
      // Games imported BEFORE the timeValid parser fix carry stale kickoff
      // flags forever, and re-importing is not available as a remedy: re-adding
      // a game mints a new gameId and orphans every pick already made against
      // it. So the flags are re-derived from ESPN on the ordinary refresh and
      // carried through, letting an already-built week correct itself within
      // one poll cycle with no commissioner action.
      //
      // kickoff TRAVELS WITH ITS FLAGS, but only while the stored row is not
      // already confirmed — they are one fact, not three. An unconfirmed row
      // holds a midnight-EASTERN PLACEHOLDER rather than a real time, so
      // flipping its flag to "confirmed" while keeping that timestamp would
      // render a fabricated midnight kickoff: defect (c) of 27d2feb, recreated
      // on the refresh path. Measured, not assumed — see tbdtest [13].
      //
      // Once a row IS confirmed its kickoff is passed through untouched. That
      // is deliberate: game.kickoff drives per-game pick locking and the week's
      // auto-LOCK / auto-LIVE transitions, so rewriting it under a live week is
      // a much larger blast radius than the bug being fixed. A confirmed row is
      // therefore a strict no-op here, exactly as before this change.
      const storedConfirmed = stored.kickoffConfirmed === true && stored.kickoffDateOnly !== true;
      updated.push({
        gameId: stored.gameId, espnEventId: liveGame.espnEventId,
        homeScore: liveGame.homeScore, awayScore: liveGame.awayScore,
        status: liveGame.status, actualWinner: liveGame.actualWinner,
        kickoff:          storedConfirmed ? stored.kickoff          : (liveGame.kickoff ?? stored.kickoff),
        kickoffConfirmed: storedConfirmed ? stored.kickoffConfirmed : liveGame.kickoffConfirmed,
        kickoffDateOnly:  storedConfirmed ? stored.kickoffDateOnly  : liveGame.kickoffDateOnly,
        lastUpdated: new Date().toISOString(),
        // Item 2 remediation — live status is NOT attached here. It rides
        // the sibling `liveStatusByEventId` map returned below, keyed by
        // `espnEventId` (present on this very entry, two lines up) so
        // app.js can look it up without this object ever carrying it.
      });
    }
  }
  _state.lastScoreRefresh = new Date().toISOString();
  return { updated, errors, timestamp: _state.lastScoreRefresh, liveStatusByEventId };
}

export function getProviderState() { return { ..._state }; }
export function getLastFetchUrl()  { return _state.lastFetchUrl; }

// ─── RESILIENT FETCH ──────────────────────────────────────────────────────────

async function resilientFetch(espnUrl, almaMaters = ALMA_MATERS, { allowProxy = true, timeoutMs = FETCH_TIMEOUT_MS, maxBytes = 0 } = {}) {
  const directResult = await attemptFetch(espnUrl, 'direct', { timeoutMs, maxBytes });
  if (directResult.ok) return finalise(directResult, espnUrl, 'direct', almaMaters);

  // SECURITY S1 — the ONE early return. A server caller's direct fetch failing
  // is an honest error, not an invitation to ask a stranger. Nothing below this
  // line runs for `allowProxy:false`, so there is no path — not a retry, not a
  // catch, not a later branch — on which a proxy URL can be constructed.
  if (!allowProxy) {
    const directErr = `ESPN direct fetch failed: ${directResult.error || 'unknown error'}`;
    _state.lastQualityReport = buildFailReport(espnUrl, directErr);
    return { games: [], error: directErr, usingDemo: false, espnUrl };
  }

  for (let i = 0; i < CORS_FALLBACKS.length; i++) {
    const proxyUrl = CORS_FALLBACKS[i](espnUrl);
    const label    = ['allorigins', 'corsproxy.io', 'codetabs'][i];
    const result   = await attemptFetch(proxyUrl, label, { timeoutMs, maxBytes });
    if (result.ok) return finalise(result, espnUrl, `proxy:${label}`, almaMaters);
    console.warn(`[DataProvider] ${label} failed:`, result.error);
  }

  const errorMsg = 'ESPN API unreachable — direct fetch and all proxies failed.';
  _state.lastQualityReport = buildFailReport(espnUrl, errorMsg);
  return { games: [], error: errorMsg, usingDemo: false, espnUrl };
}

async function attemptFetch(url, method, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = 0 } = {}) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status} from ${method}` };
    // SECURITY S1 — the size cap is OPT-IN (`maxBytes: 0` = off) so the browser
    // keeps the exact `res.json()` call it has always made. The capped branch
    // reads text first because that is the only point at which the body's size
    // is knowable without trusting a header the peer wrote.
    if (maxBytes > 0) {
      const declared = Number(res.headers?.get?.('content-length') || 0);
      if (declared > maxBytes) return { ok: false, error: `response too large from ${method}`, method };
      const text = await res.text();
      if (text.length > maxBytes) return { ok: false, error: `response too large from ${method}`, method };
      const rawCapped  = JSON.parse(text);
      const dataCapped = rawCapped?.contents ? JSON.parse(rawCapped.contents) : rawCapped;
      return { ok: true, data: dataCapped, method };
    }
    const raw  = await res.json();
    const data = raw?.contents ? JSON.parse(raw.contents) : raw;
    return { ok: true, data, method };
  } catch (err) {
    return { ok: false, error: err.message, method };
  }
}

const ESPN_TEAMS_URL = `${ESPN_API_ROOT}/football/college-football/teams?limit=1000`;

/**
 * ESPN's canonical FBS/FCS team catalog for the alma-mater dropdown (item 1,
 * 2026-09-04 — "Do the dropdown"). Reuses attemptFetch() + CORS_FALLBACKS
 * (the SAME direct-then-proxy chain resilientFetch() uses for the
 * scoreboard) rather than duplicating a second retry loop — this endpoint's
 * response shape (`sports[0].leagues[0].teams[].team`) is unrelated to the
 * scoreboard's `events[]`, so it can't share resilientFetch()/finalise()
 * themselves, only the low-level fetch primitive.
 *
 * Returns a flat array of { location, displayName } — and ONLY those two
 * fields (RG-55, 2026-09-04; it used to also emit `id`, `name` and
 * `abbreviation`, which nothing anywhere read). Sorted nowhere in particular
 * (the caller sorts for display) — `location` is the SAME field
 * parseAndReport() stores as game.homeTeam/awayTeam, and is what the
 * caller should persist as player.almaMater so
 * getAlmaMaterMatch()'s exact-equality-first path applies (data-model.js).
 * `displayName` exists for the dropdown LABEL only, to disambiguate the
 * handful of teams that share an identical `location` across the 760-team
 * catalog (verified 2026-09-04 against the live endpoint: Charlotte,
 * Roosevelt, Troy — exactly three) — selecting either still stores the same
 * `location` string; see the handoff report for why that collision isn't
 * resolved at the data level too. NOTE for whoever does resolve it: `id`
 * would be the natural disambiguator and is no longer returned. Re-add it
 * then, deliberately, and re-measure — see RG-55.
 *
 * Throws on total failure (every direct + proxied attempt exhausted). Does
 * NOT catch/fallback itself — js/app.js's showEditPlayerModal() is
 * responsible for that (Drew's explicit requirement: "the commissioner must
 * never be stuck because ESPN is down").
 */
export async function fetchEspnTeamsList() {
  const direct = await attemptFetch(ESPN_TEAMS_URL, 'direct');
  let result = direct;
  if (!result.ok) {
    for (let i = 0; i < CORS_FALLBACKS.length; i++) {
      const proxyUrl = CORS_FALLBACKS[i](ESPN_TEAMS_URL);
      const label    = ['allorigins', 'corsproxy.io', 'codetabs'][i];
      result = await attemptFetch(proxyUrl, label);
      if (result.ok) break;
      console.warn(`[DataProvider] fetchEspnTeamsList: ${label} failed:`, result.error);
    }
  }
  if (!result.ok) {
    throw new Error(result.error || 'ESPN teams endpoint unreachable — direct fetch and all proxies failed.');
  }
  const rawTeams = result.data?.sports?.[0]?.leagues?.[0]?.teams || [];
  return rawTeams
    .map(t => t?.team)
    .filter(Boolean)
    .map(t => ({
      // RG-55 (2026-09-04): `id`, `name` and `abbreviation` used to be emitted
      // here and had ZERO readers anywhere in the app — the sole caller is
      // showEditPlayerModal() → buildAlmaMaterOptions(), which reads
      // `location` (the <option> VALUE, and the same field parseAndReport()
      // stores as game.homeTeam/awayTeam) and `displayName` (the LABEL). They
      // are dropped rather than carried because this array is 760 entries: the
      // three unread fields were 39,005 of the 88,725 characters it
      // serializes to. `name` is still READ below to build the displayName
      // fallback; it just isn't emitted.
      location: (t.location || '').trim(),
      displayName: (t.displayName || `${t.location || ''} ${t.name || ''}`.trim()).trim(),
    }))
    .filter(t => t.location);
}

function finalise(result, espnUrl, method, almaMaters = ALMA_MATERS) {
  const events = result.data?.events || [];
  _state.lastFetchSuccess  = true;
  _state.lastFetchMethod   = method;
  _state.lastRawEventCount = events.length;
  _state.lastRawEvents     = events.slice(0, 10).map(e => e.name || e.shortName || `ID:${e.id}`);

  if (!events.length) {
    const err = 'ESPN returned 0 events for this request.';
    _state.lastQualityReport = buildFailReport(espnUrl, err);
    return { games: [], error: err, usingDemo: false, espnUrl, rawEventCount: 0, _rawEvents: [], fetchMethod: method };
  }

  // For multi-day fetches we return raw events for merging upstream
  const { games, report, liveStatusByEventId } = parseAndReport(events, espnUrl, method, null, null, almaMaters);
  _state.lastParsedCount   = games.length;
  _state.lastQualityReport = report;
  return { games, error: null, usingDemo: false, espnUrl, rawEventCount: events.length, _rawEvents: events, qualityReport: report, fetchMethod: method, _liveStatusByEventId: liveStatusByEventId };
}

// ─── PARSE + QUALITY REPORT ───────────────────────────────────────────────────

/**
 * Parse ESPN events into game objects.
 * startDate/endDate: filter games outside requested range.
 */
function parseAndReport(events, espnUrl, method, startDate, endDate, almaMaters = ALMA_MATERS) {
  let withValidKickoff=0, withConfirmedTime=0, withFinalScores=0;
  let withSpread=0, withoutSpread=0, withUnknownTeam=0, outsideRange=0;
  // Item 2 remediation — keyed by event.id, returned on the wrapper (never
  // attached to a game object; see the comment at the bottom of the
  // events.map() loop below for why).
  const liveStatusByEventId = new Map();

  const rangeStart = startDate ? new Date(startDate + 'T00:00:00') : null;
  const rangeEnd   = endDate   ? new Date(endDate   + 'T23:59:59') : (rangeStart ? new Date(startDate + 'T23:59:59') : null);

  const games = events.map(event => {
    const comp = event.competitions?.[0];
    if (!comp) return null;

    const home = comp.competitors?.find(c => c.homeAway === 'home');
    const away = comp.competitors?.find(c => c.homeAway === 'away');
    if (!home || !away) return null;

    // ── School + Mascot extraction ──────────────────────────────────────────
    // ESPN team object provides:
    //   team.location         = "Texas A&M"           (school name)
    //   team.name             = "Aggies"              (mascot)
    //   team.shortDisplayName = "Texas A&M"           (often same as location)
    //   team.displayName      = "Texas A&M Aggies"    (full name)
    // We store the school name as homeTeam/awayTeam (clean, matches alma mater patterns)
    // and mascot as homeMascot/awayMascot for "School (Mascot)" display.
    const homeSchool = home.team?.location || home.team?.shortDisplayName || home.team?.displayName || home.team?.name || '';
    const awaySchool = away.team?.location || away.team?.shortDisplayName || away.team?.displayName || away.team?.name || '';
    const homeMascot = home.team?.name || '';
    const awayMascot = away.team?.name || '';

    const homeTeam = homeSchool;
    const awayTeam = awaySchool;
    if (!homeTeam || !awayTeam) { withUnknownTeam++; return null; }

    // ── Kickoff time validation ──────────────────────────────────────────────
    // ESPN sends event.date for every event, but when the time is not yet
    // scheduled that timestamp is a PLACEHOLDER: midnight EASTERN of the game
    // date — 04:00Z in EDT season, 05:00Z in EST season. Never 00:00Z.
    //
    // Do NOT try to recognise that placeholder from the timestamp. It cannot be
    // done. 00:00Z is 8:00 PM EDT, one of the most common kickoff slots there
    // is, and a real 11:00 PM EST kickoff in Hawaii lands on exactly 04:00:00Z
    // — byte-identical to hundreds of genuine placeholders — while the
    // placeholder hour itself moves with daylight saving. The previous
    // implementation tested for midnight UTC and so reported real 8:00 PM ET
    // games as "Time TBD" while giving genuine TBDs a fabricated midnight-ET
    // time. See RG (2026-09-03) and tbdtest.mjs.
    //
    // ESPN answers the question directly, with a structured boolean:
    // competitions[].timeValid. Read that, exactly as extractSpread() was made
    // to read ESPN's structured odds fields instead of parsing display strings.
    //   kickoffConfirmed: true  = real scheduled time
    //   kickoffDateOnly:  true  = date known, time genuinely TBD
    //   kickoff: null           = truly unknown

    const rawDate   = event.date || null;
    const statusName = event.status?.type?.name || '';
    const timeValid  = comp.timeValid;  // ESPN's structured flag: false = time TBD
    const tbdText    = event.status?.type?.shortDetail ?? event.status?.type?.detail;

    let kickoff          = rawDate;
    let kickoffConfirmed = false;
    let kickoffDateOnly  = false;

    if (rawDate) {
      const d = new Date(rawDate);   // also used by the date-range filter below

      // If ESPN ever stops sending timeValid, fall back to ESPN's OWN rendered
      // "TBD" text — never to an inference from the clock, and never to
      // silently assuming the time is confirmed.
      const timeIsTBD = typeof timeValid === 'boolean'
        ? timeValid === false
        : /\bTBD\b/i.test(String(tbdText ?? ''));

      // if/else, not if/else-if: every dated game gets exactly ONE of the two
      // states. The previous else-if left a third, unintended state (neither
      // confirmed nor date-only) that also rendered as TBD.
      if (timeIsTBD) {
        kickoffDateOnly  = true;
        kickoffConfirmed = false;
      } else {
        kickoffConfirmed = true;
        withConfirmedTime++;
      }
      withValidKickoff++;

      // Filter: exclude games outside the requested date range
      if (rangeStart && rangeEnd) {
        if (d < rangeStart || d > rangeEnd) {
          // Allow ±1 day leeway for timezone edge cases
          const leeway = 24 * 60 * 60 * 1000;
          if (d < new Date(rangeStart.getTime() - leeway) || d > new Date(rangeEnd.getTime() + leeway)) {
            outsideRange++;
            return null;
          }
        }
      }
    }

    const status    = normalizeStatus(statusName);
    const homeScore = parseScore(home.score);
    const awayScore = parseScore(away.score);
    if (status === GAME_STATUS.FINAL && homeScore !== null) withFinalScores++;

    const homeRank = safeRank(home.curatedRank?.current);
    const awayRank = safeRank(away.curatedRank?.current);
    const homeConf = extractConf(home.team);
    const awayConf = extractConf(away.team);

    const { spread, favorite, spreadSource, oddsProvider } = extractSpread(comp, homeTeam, awayTeam);
    if (spread !== null) withSpread++; else withoutSpread++;

    const isAlmaMater = !!(getAlmaMaterMatch(homeTeam, almaMaters) || getAlmaMaterMatch(awayTeam, almaMaters));

    // DI-2/DI-7 (Commissioner Slate Builder) — national-TV + marquee-event
    // signals, derived alongside isAlmaMaterGame in this same block.
    const { nationalTV, broadcastNetwork } = detectNationalTV(comp);
    const marqueeEvent = hasMarqueeNotes(comp);

    let actualWinner = null;
    if (status === GAME_STATUS.FINAL && homeScore !== null && awayScore !== null) {
      if (homeScore > awayScore) actualWinner = homeTeam;
      else if (awayScore > homeScore) actualWinner = awayTeam;
      else actualWinner = 'tie';
    }

    // ── Venue: city/state or city/country, not stadium name ─────────────────
    const venueObj   = comp.venue;
    const venueName  = venueObj?.fullName || null;
    const venueCity  = venueObj?.address?.city || null;
    const venueState = venueObj?.address?.state || null;
    const venueCountry = venueObj?.address?.country || null;
    const neutral    = comp.neutralSite || false;

    // Build display location
    let venueDisplay = null;
    if (venueCity && venueState) {
      venueDisplay = `${venueCity}, ${venueState}`;
    } else if (venueCity && venueCountry && venueCountry !== 'USA' && venueCountry !== 'US') {
      venueDisplay = `${venueCity}, ${venueCountry}`;
    } else if (venueCity) {
      venueDisplay = venueCity;
    }

    const dq = spread !== null ? DATA_QUALITY.CONFIRMED : DATA_QUALITY.PARTIAL;

    // XSS-HARDEN round 2, C5 (2026-09-12) — SHAPE-CHECK THE EVENT ID.
    //
    // This value is not necessarily ESPN's. When the direct fetch fails we
    // retry through three third-party CORS proxies (CORS_FALLBACKS at the top
    // of this file), and whatever JSON comes back is parsed here as a
    // scoreboard. The id is then rendered as element content in three places,
    // put in an ESPN deep link, and compared as a String() all over app.js.
    //
    // THE RULE IS A CHARACTER ALLOW-LIST, NOT DIGITS-ONLY, AND THAT IS
    // DELIBERATE. Real ESPN ids are all digits, and digits-only was the first
    // implementation — but the id is also the JOIN KEY between a parsed game
    // and a stored one (refreshScoresByEventIds, the slate matcher, the
    // suggested-slate pool), so dropping an id that is merely unusual costs a
    // game its live scores rather than protecting anything the escaping at the
    // render sites does not already cover. So: reject every character that
    // could form markup, close an attribute, or escape a URL path
    // (< > " ' & / \ space, backtick, parens), keep anything inert, and WARN
    // when a kept id is not all digits so a genuine ESPN schema change is
    // still visible. Four sibling suites (livestatustest, slatetest, tbdtest,
    // oddstest) feed synthetic ids such as `espn_evt_401520000` through this
    // parser; they stay meaningful under this rule.
    const rawEventId = event.id == null ? '' : String(event.id);
    const espnEventId = /^[A-Za-z0-9_.:-]{1,64}$/.test(rawEventId) ? rawEventId : '';
    if (rawEventId && !espnEventId) {
      console.warn('[data-provider] dropped an unsafe espnEventId from the scoreboard payload:', rawEventId.slice(0, 80));
    } else if (espnEventId && !/^\d+$/.test(espnEventId)) {
      console.warn('[data-provider] non-numeric espnEventId kept (inert, but ESPN normally sends digits):', espnEventId);
    }

    const parsedGame = createGame('', {
      espnEventId,
      dataQuality:    dq,
      dataSource:     method === 'direct' ? 'espn_live' : 'espn_historical',
      homeTeam, awayTeam,
      homeMascot, awayMascot,
      homeConference: homeConf, awayConference: awayConf,
      homeRank, awayRank,
      kickoff,
      kickoffConfirmed,
      kickoffDateOnly,
      timeWindow: getTimeWindow(kickoff),
      spread, favorite, spreadSource, oddsProvider,
      lockedSpread: null,
      homeScore: status !== GAME_STATUS.SCHEDULED ? homeScore : null,
      awayScore: status !== GAME_STATUS.SCHEDULED ? awayScore : null,
      status, actualWinner, atsWinner: null,
      isAlmaMaterGame: isAlmaMater,
      nationalTV, broadcastNetwork, marqueeEvent,
      venue: venueName,
      venueDisplay,
      neutralSite: neutral,
      lastUpdated: new Date().toISOString(),
    });

    // Item 2 (in-game quarter+clock), Pass A/B remediation — ESPN's raw
    // status.type carries the human-readable in-game clock (`detail`/
    // `shortDetail`) and a deterministic period name (`name`, e.g.
    // STATUS_HALFTIME/STATUS_END_PERIOD) that normalizeStatus() collapses
    // into the single coarse GAME_STATUS.LIVE bucket above. This information
    // is now carried ONLY in the `liveStatusByEventId` map returned
    // alongside `games` (see bottom of this function) — NEVER attached to
    // the game object itself. A per-game-object property rides every future
    // `{...game}` spread (scoreCandidateGames → add-to-slate → createGame()
    // → saveGame(), and the AVAIL_GAMES pool save) all the way into the
    // shared/synced Sheet. The map, keyed by event.id, is the `_rawEvents`
    // pattern applied correctly: it lives on the result wrapper, never on an
    // object that can be spread into a persisted record.
    //
    // FEAT-7 / DI-174a (UN-174, 2026-09-12) — RED ZONE. Two more transient
    // fields on the SAME map entry, for the same reason and under the same
    // rule: they are perishable per-poll facts about a game in progress and
    // must never reach a persisted record.
    //
    //   isRedZone      ESPN's own boolean (competitions[0].situation.isRedZone).
    //                  null when `situation` is absent, which is every
    //                  scheduled and every final event.
    //   possessionSide 'home' | 'away' | null. ESPN gives possession as an
    //                  ESPN TEAM ID; our game records store team NAMES and no
    //                  ESPN team id anywhere (createGame()'s field list). The
    //                  id -> side mapping therefore happens HERE, the one
    //                  scope that already holds competitors[] with both `id`
    //                  and `homeAway`, and the raw id never leaves this file.
    //                  Do NOT "fix" this by adding an ESPN team id to the
    //                  game record.
    //
    // Getting this direction backwards is the worst failure this feature can
    // have — it would tell a player his pick is safe while the other team is
    // inside the 20 — so both directions are asserted in livestatustest.mjs.
    // DI-174a AMENDMENT (COORDINATOR RULING 2, 2026-09-12 09:21 PDT, after the
    // live capture in `weekly bug fixes and feedback/Feedback batch 091226/
    // live-cfb-fixture.json`). The original spec read `situation.possession`
    // and stopped. The real payload says that is not enough: FOUR of the eight
    // captured in-progress events carried NO `situation.possession` at all —
    // **including the one red-zone game in the capture** (WAKE @ PUR, Q1 5:51,
    // whose `situation` keys were exactly `lastPlay, down, yardLine, distance,
    // isRedZone, homeTimeouts, awayTimeouts`, because the last play was a
    // timeout). Under the original spec the ONE case this feature exists for
    // would have rendered the team-less "🔴 RZ" — technically correct, and a
    // failure of the need ("which team", UN-174).
    //
    // In every such event `lastPlay.end.team.id` named the team in possession
    // and matched a competitor id (WAKE = 154, consistent with that drive's
    // "10 plays, 57 yards" ending at the PUR 16). So the resolution order is:
    //
    //   situation.possession                  — ESPN's explicit answer, always preferred
    //   situation.lastPlay.end.team.id        — where the ball ENDED UP after the last snap
    //   situation.lastPlay.team.id            — the team that RAN the last snap
    //   null
    //
    // The order is not arbitrary. `end.team` is the post-play state and is the
    // one that survives a change of possession on the play itself; `team` is
    // the pre-play offense and is the fallback only when `end` is absent. Both
    // are still mapped through competitors[] below — an id that matches neither
    // side resolves to null rather than guessing, exactly as before, and the
    // raw ESPN id still never leaves this file.
    const situation    = comp.situation;
    const possessionId = [
      situation?.possession,
      situation?.lastPlay?.end?.team?.id,
      situation?.lastPlay?.team?.id,
    ].map(v => (v != null && v !== '' ? String(v) : null)).find(Boolean) || null;
    let possessionSide = null;
    if (possessionId) {
      if (home.id != null && String(home.id) === possessionId)      possessionSide = 'home';
      else if (away.id != null && String(away.id) === possessionId) possessionSide = 'away';
    }
    liveStatusByEventId.set(String(event.id), {
      name:        statusName || null,
      detail:      event.status?.type?.detail ?? null,
      shortDetail: event.status?.type?.shortDetail ?? null,
      isRedZone:   typeof situation?.isRedZone === 'boolean' ? situation.isRedZone : null,
      possessionSide,
    });
    return parsedGame;
  }).filter(Boolean);

  let dqStatus;
  if (!games.length)            dqStatus = outsideRange > 0 ? `All ${outsideRange} ESPN events were outside the requested date range` : 'ESPN returned no parseable games';
  else if (withSpread > 0)      dqStatus = `ESPN confirmed (${withSpread} with odds, ${withoutSpread} without)`;
  else if (withFinalScores > 0) dqStatus = 'ESPN historical — scores present, no odds';
  else if (withConfirmedTime > 0) dqStatus = 'ESPN partial — scheduled games, times confirmed, no odds yet';
  else                          dqStatus = 'ESPN partial — game dates returned, times TBD';

  const report = {
    espnUrl, fetchMethod: method,
    requestTimestamp: new Date().toISOString(),
    requestedDateRange: _state.lastRequestedRange,
    rawEventCount: events.length,
    parsedGameCount: games.length,
    outsideRange,
    withValidKickoff, withConfirmedTime,
    withFinalScores, withSpread, withoutSpread, withUnknownTeam,
    dqStatus,
    firstFiveEvents: events.slice(0, 5).map(e => ({
      id: e.id, name: e.name || e.shortName || '?',
      date: e.date, statusName: e.status?.type?.name,
    })),
  };

  return { games, report, liveStatusByEventId };
}

function buildFailReport(espnUrl, error) {
  return { espnUrl, requestTimestamp: new Date().toISOString(), rawEventCount: 0, parsedGameCount: 0, dqStatus: 'Fetch failed', error };
}

// ─── NORMALIZATION HELPERS ────────────────────────────────────────────────────

function parseScore(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = parseInt(raw, 10); return isNaN(n) ? null : n;
}

function safeRank(raw) {
  if (!raw) return null; const n = parseInt(raw, 10);
  return n >= 1 && n <= 25 ? n : null;
}

function normalizeStatus(name) {
  if (!name) return GAME_STATUS.SCHEDULED;
  if (name.includes('FINAL')) return GAME_STATUS.FINAL;
  if (name === 'STATUS_IN_PROGRESS' || name.includes('HALFTIME') || name.includes('END_PERIOD')) return GAME_STATUS.LIVE;
  return GAME_STATUS.SCHEDULED;
}

// ESPN conference ID → human name. The lightweight scoreboard payload doesn't
// include conference.name on team objects (only conferenceId), so we map them
// here. IDs are stable in the ESPN API. If a new conference appears, add it
// below; unmapped IDs fall through to the empty-string fallback in extractConf.
const ESPN_CONFERENCE_BY_ID = {
  1: 'AAC',                  // American (some payloads)
  4: 'Big 12',
  5: 'ACC',
  7: 'Big Ten',
  8: 'SEC',
  9: 'Pac-12',
  12: 'Conference USA',
  15: 'MAC',
  17: 'Mountain West',
  18: 'FBS Independents',
  37: 'Sun Belt',
  151: 'AAC',                // American Athletic (current id seen in recent payloads)
  // FCS / lower divisions get rendered as their abbreviation when present
};

function extractConf(teamObj) {
  if (!teamObj) return '';
  // Prefer explicit name on the team object when present
  const direct = teamObj.conference?.abbreviation || teamObj.conference?.name || teamObj.conferenceShortName || teamObj.conferenceName;
  if (direct) return direct;
  // Fall back to mapped conferenceId (most scoreboard payloads only have this)
  const id = teamObj.conferenceId;
  if (id != null && ESPN_CONFERENCE_BY_ID[Number(id)]) return ESPN_CONFERENCE_BY_ID[Number(id)];
  return '';
}

// ─── NATIONAL TV / MARQUEE DETECTION (DI-2, DI-3, DI-7) ───────────────────────
// National broadcast tier is the accepted PROXY for "big weekend games" /
// "games everyone is talking about" (Drew's ruling — one signal, and the UI
// must label it as the proxy it is: "on national TV" or the network name,
// NEVER "trending" / "everyone's talking about").
const NATIONAL_TV_NETWORKS = new Set(['ABC', 'CBS', 'FOX', 'NBC', 'ESPN']);

/**
 * comp.broadcasts[] can co-list a cable simulcast FIRST (some games carry an
 * SEC/ACC/Big Ten Network entry ahead of the flagship one), so every entry's
 * `.names` is flattened — not just index 0 — and each name is tested for an
 * EXACT, case-insensitive match against the flagship allow-list above.
 * ESPN2/ESPNU/ESPN+/SEC Network/etc. all correctly miss (substring matching
 * would wrongly catch ESPN2/ESPNU against "ESPN" — this doesn't).
 * Never throws; missing/malformed `broadcasts` defaults to not-national.
 */
function detectNationalTV(comp) {
  try {
    const broadcasts = comp?.broadcasts;
    if (!Array.isArray(broadcasts) || !broadcasts.length) return { nationalTV: false, broadcastNetwork: null };
    const names = broadcasts.flatMap(b => Array.isArray(b?.names) ? b.names : []);
    for (const n of names) {
      const upper = String(n || '').trim().toUpperCase();
      if (NATIONAL_TV_NETWORKS.has(upper)) return { nationalTV: true, broadcastNetwork: String(n).trim() };
    }
    return { nationalTV: false, broadcastNetwork: null };
  } catch {
    return { nationalTV: false, broadcastNetwork: null };
  }
}

/**
 * DI-2 "marquee event" scoring bonus — ESPN flags standalone showcase games
 * (bowl names, "Aflac Kickoff", conference-championship branding, etc.) with
 * a non-empty `notes[]` on the competition. Presence only; the note text
 * itself isn't persisted or surfaced anywhere — scoring signal only, no
 * render path. Never throws.
 */
function hasMarqueeNotes(comp) {
  try { return Array.isArray(comp?.notes) && comp.notes.length > 0; }
  catch { return false; }
}

function extractSpread(comp, homeTeam, awayTeam) {
  const odds        = comp.odds?.[0];
  const oddsProvider = odds?.provider?.name || null;
  if (!odds?.details || odds.details === 'Pick' || !odds.details.trim())
    return { spread: null, favorite: null, spreadSource: null, oddsProvider };

  const detail   = odds.details.trim();
  const numMatch = detail.match(/([-+]?\d+\.?\d*)$/);
  if (!numMatch) return { spread: null, favorite: null, spreadSource: 'espn_unparsed', oddsProvider };

  // MAGNITUDE ONLY — never the sign. ESPN writes `details` from the FAVORITE's
  // perspective ("MIA -24.5" means Miami is favored by 24.5, whichever side
  // Miami is on). AD-03 stores the spread from the HOME team's perspective, so
  // the sign is DERIVED below from who is favored. Copying the sign out of this
  // text is what inverted away-favored games.
  const magnitude = Math.abs(parseFloat(numMatch[1]));
  const teamPart  = detail.slice(0, detail.length - numMatch[0].length).trim();
  const partLow   = teamPart.toLowerCase();

  // DEFENSIVE ONLY — no live ESPN payload reaches this line, so oddstest.mjs
  // deliberately carries no fixture for it (a contrived one would assert
  // nothing but itself). ESPN's pick'em strings are "Pick" / "PK" / "EVEN";
  // none carries a trailing number, so all three exit at the two guards ABOVE
  // with spread:null — they never arrive here as a 0. Verified 2026-09-02 over
  // 345 competitions carrying odds (CFB Sep/Oct/Nov 2026 + NFL): smallest
  // magnitude published was 1.5, and no "<TEAM> 0" string occurred at all.
  // Kept only because IF a provider ever writes one, zero = PK is the correct
  // AD-03 state and returning it beats falling through to the favorite ladder.
  if (magnitude === 0) return { spread: 0, favorite: null, spreadSource: 'espn', oddsProvider };

  let favorite = null;

  // (1) ESPN's OWN structured flags — the authority. Present on 408/408
  //     odds-carrying competitions, re-measured 2026-09-03. Everything below
  //     is a fallback for payloads that omit them.
  if (odds.awayTeamOdds?.favorite === true)      favorite = awayTeam;
  else if (odds.homeTeamOdds?.favorite === true) favorite = homeTeam;

  // (2) Exact abbreviation match. ESPN writes `details` with the team
  //     ABBREVIATION ("MIA -24.5"), which is carried on the competitor and was
  //     never consulted here — the omission at the centre of this bug.
  if (!favorite) {
    const abbrOf = (side) =>
      (comp.competitors?.find(c => c.homeAway === side)?.team?.abbreviation || '').toLowerCase();
    const homeAbbr = abbrOf('home');
    const awayAbbr = abbrOf('away');
    if (homeAbbr && partLow === homeAbbr)      favorite = homeTeam;
    else if (awayAbbr && partLow === awayAbbr) favorite = awayTeam;
  }

  // (3) DELETED 2026-09-03 — the school-name heuristic ladder. It resolved the
  //     favorite by substring-matching `odds.details` against the school names,
  //     and it got SHARED-SUFFIX matchups backwards: for "Ball State -7" with
  //     Ohio State at home, its first test found the HOME team's last token
  //     "state" inside "ball state" and declared Ohio State favored — storing
  //     -7 where the truth is +7. That is a sign error at data entry, the exact
  //     class of defect AD-03 and the v0.13-v0.15 hunt exist to prevent, and it
  //     was fingerprinted `spreadSource: 'espn'`, i.e. TRUSTED.
  //
  //     It cost nothing to remove. Measured over live ESPN payloads with the
  //     structured flags stripped — the only scenario this rung existed to
  //     serve — 405 of 408 odds-carrying competitions resolve at rung 2 and the
  //     other 3 (BUF/BUFF, AF/AFA, JXST/JVST, where `details` uses a different
  //     abbreviation than `team.abbreviation`) are correctly caught by rung 4.
  //     This rung resolved ZERO in either scenario. Forced to run as the sole
  //     resolver across all 52,670 ordered pairings of the 230 CFB schools in
  //     that corpus, it answered backwards on 2,708 of them — 5.14%.
  //
  //     Rung numbering below is left as (4) on purpose: the ledger, the RG rows
  //     and oddstest.mjs all reference these rungs by number.

  // (4) FAIL CLOSED. An unresolved favorite previously kept the raw negative
  //     number, which silently asserts the HOME team is favored. That wrong
  //     sign gets frozen into `lockedSpread` at OPEN->LOCKED and graded by
  //     calculateAtsWinner(). No spread is honest and shows the commissioner
  //     a "No spread set" warning; a guessed sign is a 2x-magnitude error.
  if (!favorite)
    return { spread: null, favorite: null, spreadSource: 'espn_unresolved', oddsProvider };

  // AD-03: negative = home favored, positive = away favored.
  const homePerspective = favorite === awayTeam ? magnitude : -magnitude;

  return { spread: homePerspective, favorite, spreadSource: 'espn', oddsProvider };
}

// ─── DATE UTILITIES ───────────────────────────────────────────────────────────

/** Convert 'YYYY-MM-DD' to ESPN's '20250913' format */
function toEspnDate(dateStr) { return dateStr ? dateStr.replace(/-/g, '') : ''; }

/** Get all dates in a range as 'YYYY-MM-DD' strings */
function getDatesInRange(startDate, endDate) {
  const dates = [];
  const current = new Date(startDate + 'T12:00:00');
  const end     = new Date((endDate || startDate) + 'T12:00:00');
  while (current <= end) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// ─── GAME SCORING / SLATE SELECTION ──────────────────────────────────────────

/**
 * Score + tag every valid candidate game. Deliberately does NOT truncate or
 * sort to a fixed count — that was the root of the truncation defect (see
 * buildSuggestedSlate() below). This function's only job is scoring + reason
 * tagging; buildSuggestedSlate() owns every selection/ordering decision.
 */
export function scoreCandidateGames(games, weekId) {
  const valid = games.filter(g => g.homeTeam && g.awayTeam);
  return valid.map(g => ({
    ...g, weekId,
    _score:            computeScore(g),
    suggestionReasons: getSuggestionReasons(g),
  }));
}

// DI-2 (2026-09-03) — spread-tightness bonuses HALVED (a tight game still
// counts, it just no longer beats a real marquee game on its own) and two
// new signals added: national TV (+15) and marquee event (+10). Exported so
// the exact point values are directly unit-provable (slatetest.mjs) rather
// than only checkable by proxy through selection order.
export function computeScore(game) {
  let s = 0;
  if (game.isAlmaMaterGame) s += 100;
  if (game.homeRank && game.homeRank <= 25) s += (26 - game.homeRank) * 2;
  if (game.awayRank && game.awayRank <= 25) s += (26 - game.awayRank) * 2;
  if (game.homeRank && game.awayRank) s += 30;
  if (game.spread !== null) { const a = Math.abs(game.spread); if (a <= 7) s += 10; else if (a <= 14) s += 5; }
  if (game.kickoffConfirmed) s += 5;   // prefer games with real times
  if (game.nationalTV) s += 15;
  if (game.marqueeEvent) s += 10;
  return s;
}

function getSuggestionReasons(game) {
  const r = [];
  if (game.isAlmaMaterGame) r.push('⭐ Alma mater');
  if (game.homeRank && game.awayRank) r.push('🏆 Ranked vs ranked');
  else if (game.homeRank || game.awayRank) r.push('📊 Ranked matchup');
  if (game.spread !== null && Math.abs(game.spread) <= 7) r.push('🎯 Tight spread');
  // Drew's ruling — label the PROXY, never dress it up as "trending"/"everyone's talking about".
  if (game.nationalTV) r.push(`📺 ${game.broadcastNetwork || 'National TV'}`);
  if (game.neutralSite) r.push('🌍 Neutral site');
  if (!game.kickoffConfirmed) r.push('⏰ Time TBD');
  if (!r.length) r.push('🏈 Quality matchup');
  return r;
}

// ─── SUGGESTED SLATE SELECTION (DI-1) — replaces balanceByTimeWindow() ───────
//
// balanceByTimeWindow() filled time windows IN WINDOW ORDER (Morning ->
// Afternoon -> Evening -> Late) and only THEN truncated to the target count —
// first to 20 at the scoreCandidateGames() call site, then to 10 in app.js.
// When the best games clustered in one window, that window was never reached
// before the ceiling. Measured against the real Sep 3-7 pool: the six
// highest-scoring games sat past the truncation point, five of them
// alma-mater games — the exact games the alma-mater bonus exists to
// guarantee. This function decides WHO gets in by tier/score FIRST tier
// precedence below, then decides the LISTED order (chronological — see the
// bottom of this function) as a wholly separate, later step. Do not
// re-collapse those two decisions back together; that collapse is the bug.
//
// Strict tier precedence — each tier competes only for what the previous left:
//   Tier 1 — every alma-mater game, unconditional. No cap (Drew's ruling) —
//            NOT bounded by a hardcoded number. The alma-mater roster
//            (app.js `claimedAlmaMaters()` — the schools active players
//            have claimed, not a stored setting) can grow or shrink as
//            players change their claims — this tier was already written
//            against `game.isAlmaMaterGame`, never against ALMA_MATERS.length,
//            so it needs no change for that, but the OLD comment here
//            claimed a fixed "structurally bounded at 6" floor guarantee
//            that is no longer true and must not be reintroduced. Whatever
//            the claimed roster's length, EVERY alma-mater game is
//            included — even past targetCount. A slate that ends up with
//            more than targetCount games because of Tier 1
//            is correct, not a bug; it is never truncated back down.
//   Tier 2 — two anchors, added ONLY if budget remains after Tier 1
//            (slate.length < targetCount). A week where Tier 1 alone already
//            reaches or exceeds targetCount adds neither anchor — there is
//            nothing left to spend.
//   Tier 3 — best-scored fill, soft time-window/conference caps applied ONLY
//            to this free-fill portion, relaxed rather than leaving a slot
//            empty. Also budget-gated the same way as Tier 2.
//
// NO FIXED FLOOR. While ALMA_MATERS held exactly 6 entries, 6 (alma) + 2
// (anchors) = 8 <= targetCount(10) guaranteed >= 2 free-fill slots always.
// That was a fact about the list's length at the time, not a property of
// this algorithm, and it stopped holding the moment the list became
// configurable. With a short list (e.g. 3 schools) the old arithmetic still
// happens to hold; with a long one (more entries than targetCount) Tier 1
// alone can consume the whole budget and free-fill can legitimately be
// zero. Both are correct outcomes of the same tier precedence — do not
// re-derive or assert a specific floor number here or in tests.

const CONF_CAP   = 2; // proposed default, not tuned against a full season
const WINDOW_CAP = 3; // proposed default, not tuned against a full season

/**
 * Saturday-morning anchor's day check — Central-pinned, the SAME convention
 * getTimeWindow() already uses for hour-of-day bucketing. This anchor is
 * UNCHANGED / score-based per Drew's ruling: morning kickoffs cluster in a
 * narrow real-world band, so any of them satisfies "there's football on when
 * you wake up" — picking the best-scored one costs nothing. Do not swap this
 * for the closing anchor's Pacific check below; they are deliberately
 * different zones for deliberately different reasons (see that function).
 */
function isSaturdayCentral(isoTime) {
  if (!isoTime) return false;
  try {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' }).format(new Date(isoTime));
    return wd === 'Sat';
  } catch { return false; }
}

/**
 * Closing-anchor day boundary is deliberately Pacific, not Central — Drew's
 * ruling, 2026-09-03: the latest Saturday-night kickoff (Hawai'i, West Coast
 * late games) reads as Sunday in Central time and would otherwise never be a
 * candidate. Scoped to this one selection; the rest of the app stays
 * Central-pinned. Do NOT route this through app.js's dayOfWeekOf() — that
 * helper has no pinned zone at all and inherits the browser/server's local
 * time, which would make this non-deterministic across devices. Do NOT let
 * this zone leak into getTimeWindow(), the morning anchor, the free-fill
 * tiers, or Available Games date grouping — all of those stay Central.
 */
function isSaturdayPacific(isoTime) {
  if (!isoTime) return false;
  try {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', weekday: 'short' }).format(new Date(isoTime));
    return wd === 'Sat';
  } catch { return false; }
}

/**
 * buildSuggestedSlate(scoredGames, targetCount) — called ONCE. `scoredGames`
 * must already carry `_score` (scoreCandidateGames() above). Returns
 * `{ slate, shortlist, almaCount, morningAnchorFilled, closingAnchorFilled }`.
 */
export function buildSuggestedSlate(scoredGames, targetCount = 10) {
  const pool = scoredGames.slice();
  const slate = [];
  const selected = new Set(); // object-identity — same references as `pool`

  // ── Tier 1 — alma maters, unconditional ──────────────────────────────────
  const tier1 = pool.filter(g => g.isAlmaMaterGame === true);
  for (const g of tier1) { slate.push(g); selected.add(g); }
  const almaCount = tier1.length;

  // ── Tier 2a — Saturday-morning anchor (Central; score-based, unchanged) ──
  const tier1HasMorning = tier1.some(g => g.timeWindow === TIME_WINDOW.MORNING && isSaturdayCentral(g.kickoff));
  const morningCandidates = tier1HasMorning
    ? []
    : pool.filter(g => !selected.has(g) && g.timeWindow === TIME_WINDOW.MORNING && isSaturdayCentral(g.kickoff));
  // morningAnchorFilled answers "does a morning-window Saturday game exist
  // this week at all" — independent of whether Tier 1 already left room to
  // ADD it. That's deliberate: it drives DI-6's "No Saturday morning games
  // this week" note, which should stay accurate even in an alma-heavy
  // over-budget week where a morning game genuinely exists but there was no
  // budget left to add it.
  const morningAnchorFilled = tier1HasMorning || morningCandidates.length > 0;
  // "only if budget remains after Tier 1" (DI-1) — an alma-heavy week can
  // legitimately consume the whole targetCount on its own now that the list
  // is no longer fixed at 6; this anchor simply isn't added when that happens.
  if (morningCandidates.length && slate.length < targetCount) {
    const best = morningCandidates.reduce((a, b) => ((b._score || 0) > (a._score || 0) ? b : a));
    slate.push(best); selected.add(best);
  }

  // ── Tier 2b — Saturday-closing anchor (Pacific; DI-5 amended) ────────────
  // NOT a score-based pick within a time band — it is literally the last
  // game of the night. The closing anchor exists so there is still a game on
  // at the end of Saturday night; WHICH game is deliberately not a quality
  // judgment (Drew's ruling) — no quality floor, no "fall back to a better
  // game" behavior. If the latest Pacific-Saturday kickoff happens to be an
  // early-evening game because nothing later exists that week, that game
  // STILL fills the anchor — "latest that exists" always wins, never
  // "unfilled because it wasn't late enough."
  const satPacific = pool.filter(g => isSaturdayPacific(g.kickoff));
  const closingAnchorFilled = satPacific.length > 0;
  if (satPacific.length) {
    // TIE-BREAK: this week's real pool has two games sharing the identical
    // latest kickoff instant. Score enters ONLY here, as a last resort —
    // never the primary axis — then home team name alphabetically, so the
    // pick is deterministic across reloads/fetches rather than depending on
    // ESPN's raw event-array order.
    const closingCandidate = satPacific.reduce((best, g) => {
      const gt = new Date(g.kickoff).getTime();
      const bt = new Date(best.kickoff).getTime();
      if (gt !== bt) return gt > bt ? g : best;
      const gs = g._score || 0, bs = best._score || 0;
      if (gs !== bs) return gs > bs ? g : best;
      return (g.homeTeam || '').localeCompare(best.homeTeam || '') < 0 ? g : best;
    });
    // Skip if this exact game is already on the slate (Tier 1, or —
    // vanishingly unlikely — the just-picked morning anchor); otherwise add
    // it regardless of score, budget permitting (same "only if budget
    // remains" gate as the morning anchor above).
    if (!selected.has(closingCandidate) && slate.length < targetCount) { slate.push(closingCandidate); selected.add(closingCandidate); }
  }

  // ── Tier 3 — best-scored fill, soft caps on the FREE-FILL PORTION ONLY ──
  // Caps do not apply to Tiers 1-2 — neither restricted by them nor counted
  // toward them. A candidate that would push a 3rd game from the same time
  // window, or a 3rd from the same home conference, into the FREE-FILL
  // portion is deferred (not dropped); deferred candidates are used to fill
  // any slots still open once the cap-compliant pool is exhausted, because a
  // slot is NEVER left blank to satisfy diversity. Games with no listed home
  // conference never trip the conference cap (nothing to group them by).
  const remaining = pool.filter(g => !selected.has(g)).sort((a, b) => (b._score || 0) - (a._score || 0));
  const windowCounts = {}; const confCounts = {};
  const deferred = [];
  for (const g of remaining) {
    if (slate.length >= targetCount) break;
    const w = g.timeWindow || TIME_WINDOW.AFTERNOON;
    const c = g.homeConference || '';
    const wCount = windowCounts[w] || 0;
    const cCount = c ? (confCounts[c] || 0) : 0;
    if (wCount >= WINDOW_CAP || (c && cCount >= CONF_CAP)) { deferred.push(g); continue; }
    slate.push(g); selected.add(g);
    windowCounts[w] = wCount + 1;
    if (c) confCounts[c] = cCount + 1;
  }
  for (const g of deferred) {
    if (slate.length >= targetCount) break;
    slate.push(g); selected.add(g);
  }

  // Shortlist (DI-4) — positions 11-20: the next-highest-scoring games that
  // did NOT make the primary slate. Score order (a ranked "next best" list),
  // not chronological.
  const shortlist = pool.filter(g => !selected.has(g)).sort((a, b) => (b._score || 0) - (a._score || 0)).slice(0, 10);

  // DISPLAY ORDER IS CHRONOLOGICAL BY KICKOFF, not tier/score order.
  // Tier/score decided WHICH games got in (above); this is a SEPARATE,
  // deliberate decision about how they're LISTED — matches the existing
  // Available Games convention. Do not misread this sort as reintroducing
  // chronological SELECTION; that is precisely the bug this function
  // replaces.
  const orderedSlate = slate.slice().sort((a, b) => new Date(a.kickoff || 0) - new Date(b.kickoff || 0));

  return { slate: orderedSlate, shortlist, almaCount, morningAnchorFilled, closingAnchorFilled };
}

// ─── TIME HELPERS ─────────────────────────────────────────────────────────────

export function getTimeWindow(isoTime) {
  // v0.17.0 — buckets are CENTRAL TIME by league convention (was hardcoded
  // ET−4, which mislabeled e.g. a 9:00 AM PT kickoff as "afternoon"). Intl
  // handles DST correctly; the manual fallback only runs if Intl is missing.
  if (!isoTime) return TIME_WINDOW.AFTERNOON;
  const d = new Date(isoTime);
  let ct;
  try {
    ct = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: 'numeric', hour12: false }).format(d));
    if (ct === 24) ct = 0;
  } catch {
    ct = (d.getUTCHours() - 5 + 24) % 24;
  }
  if (ct < 12) return TIME_WINDOW.MORNING;
  if (ct < 17) return TIME_WINDOW.AFTERNOON;
  if (ct < 21) return TIME_WINDOW.EVENING;
  return TIME_WINDOW.LATE;
}

// formatKickoff / formatKickoffFull are no longer exported — app uses
// formatGameTime from data-model.js instead. Kept for internal use only.
function _formatKickoff(isoTime) {
  if (!isoTime) return 'TBD';
  try { return new Date(isoTime).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZoneName:'short',timeZone:'America/New_York'}); }
  catch { return 'TBD'; }
}
