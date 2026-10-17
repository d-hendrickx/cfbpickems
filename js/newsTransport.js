/**
 * CFB Pickems — js/newsTransport.js (News: the transport — option A 2026-10-01; the D1 SERVER path 2026-10-08, DI-673 / DI-671)
 * ==============================================================================================================================
 * ── D1 (DI-673): THE DEFAULT PATH IS THE SERVER ─────────────────────────────────────────────────────────────────────────
 * `fetchNews()` reads the publisher headlines the collector (`news-ingest`) stored, through ONE typed RPC on our own backend:
 *   client.rpc('news_feed', { p_sports, p_limit, p_slate_keys })  — a POST (never `{ get: true }`), keyset-paged, clamped server-side, RLS-scoped to the
 *   caller (pilot-only sources reach pilot-league members only), with pictures nulled server-side unless `news_images` is exactly true (SC-N17).
 * NO ARGUMENT IS DERIVED FROM A PICK OR A TEAM THE VIEWER CHOSE (DI-673, S-C2-N): `p_sports` is the viewer's sports, `p_slate_keys` is the league's PUBLISHED
 * slate (every game of the current week, home and away, sorted, at most 60: identical for every member). The viewer's own picks only RANK on the device.
 * The link and picture hosts each item may use come from `news_sources_for` (cached 24 h per id); an item whose source is unknown, whose URL fails the source's
 * own host list, or whose source is not `cleared` in a NON-pilot league (the client mirror of the pilot rule, `isPilotOnlyAllowed('newsPilotSources')`) is
 * dropped — fail closed. The platform levers (`news_enabled`, `news_images`) are read in ONE two-key select, together with the articles, so the picture decision is
 * known before the first card paints (no pop-in). The client never reads `news_articles` directly and never contacts a publisher for a headline.
 * The Supabase client is INJECTED (`installNewsTransport({ getClient })`, called by app.js at boot).
 *
 * ── THE CONTINGENCY (DI-671, C20) ──────────────────────────────────────────────────────────────────────────────────────
 * The option-A phone-side ESPN fetch below (`fetchEspnNews`) survives ONLY behind `NEWS_CLIENT_ESPN_FALLBACK` (false). It may be turned on only after Drew checks
 * the privacy wording (the approved paragraph says OUR SERVERS collect the headlines). Until then, if the server path is unavailable, News shows its calm
 * "temporarily unavailable" state. Its code and its tests (newstest [5]) are kept so the contingency is a reviewed one-line flip, never a rewrite.
 *
 * ══ OPTION A (2026-10-01), NOW THE CONTINGENCY PATH ════════════════════════════════════════════════════════════════════
 * CFB Pickems — js/newsTransport.js (Social Platform News, option A: ESPN headlines only; DI-375 / DI-381, 2026-10-01)
 * ===================================================================================================================
 * The ONLY module that talks to ESPN for news: fetch, normalize, filter, dedupe, cache. CLIENT-SIDE, like the scoreboard — no table, no
 * Edge function, no migration, no cron (the coordinator's live probe and this build's own header check found `access-control-allow-origin: *`
 * on the news endpoint). Option B (all sources, a server collector) replaces THIS file's fetch and keeps `fetchNews`'s result shape,
 * `rankNews`, `renderNewsCard` and `bindNewsCardEvents` exactly as they are (the NewsItem shape is the seam).
 *
 * ── WHAT NEVER HAPPENS HERE ──────────────────────────────────────────────────────────────────────────────────────────
 *   · No `CORS_FALLBACKS` proxy, no `attemptFetch()`, no Capacitor HTTP plugin (it patches `fetch` globally, Supabase's included) — a blocked
 *     fetch surfaces as the calm "temporarily unavailable" state, never as a request bounced through a third party (S-C11).
 *   · No `load()` / `save()` / league mirror / localStorage (SD-16). The cache is a module-level Map: memory only, disposable by design.
 *   · No header, cookie or credential toward ESPN: `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, no custom headers (a custom header would turn
 *     a simple GET into a preflighted one, and the endpoint's preflight answers 403), and no query beyond `limit=20`. Nothing in a request is derived
 *     from the viewer, a pick, a team or a week.
 *   · No AI, no Anthropic, no Edge-function call (UN-341; the allow-list test in newstest.mjs is the guard).
 *
 * ── THE PIPELINE ─────────────────────────────────────────────────────────────────────────────────────────────────────
 * per sport, in parallel, from a frozen explicit sport->path map (an unknown key is REFUSED, never mapped to CFB — `espnSportPath()`'s silent
 * fallback is exactly what this avoids): fetch (timeout, byte cap declared AND enforced while the body streams, response host re-checked) -> JSON.parse -> normalize each
 * of at most 20 articles -> dedupe by canonical-URL id across sports -> cache (15 minutes). Normalize is FAIL-CLOSED per item: a non-string
 * headline, a link `parseArticleUrl` refuses and an unparseable or future-dated time each drop that item and are COUNTED (`stats`), never
 * silently kept. There is NO betting filter: Drew reversed SD-6 on 2026-10-01 ("I want betting news"), so ESPN's betting stories are kept and
 * ranked like any other headline (newstest [BET-KEEP] is the guard; a re-added drop must be a deliberate, reviewed change). Text is plain (control / bidi stripped, capped) and escaped again at render.
 *
 * ── IDENTITY (S-C9) ──────────────────────────────────────────────────────────────────────────────────────────────────
 * Each call captures `{ epoch: getIdentityEpoch(), leagueId: getActiveLeagueId() }` (the shape chatTransport.js uses). A result that resolves
 * after either moved is DISCARDED (a warn, never cached, never returned). Cache entries carry the token they were written under and a read
 * under a different token is a miss, so the cache is safe even if no one calls `clearNewsCache()` at the identity chokepoint (the wiring still
 * should: applyIdentityDeltaIfChanged()). Cached items are frozen, and rankNews returns copies, so nothing downstream can mutate them in place.
 *
 * Import allow-list (DI-382, asserted by newstest): ./data-provider.js (logoOk), ./auth.js (getIdentityEpoch, getActiveLeagueId), ./newsCard.js
 * (parseArticleUrl, isAllowedNewsImageUrl — the one shared validators) and ./newsRules.js (the shared pure rules: text hygiene).
 * iOS 15.0 safe: no Object.hasOwn, no AbortSignal.timeout, no .at().
 */

import { logoOk } from './data-provider.js';
import { getIdentityEpoch, getActiveLeagueId } from './auth.js';
import { parseArticleUrl, isAllowedNewsImageUrl } from './newsCard.js';
import { stripControlAndBidi, parseArticleUrl as parseArticleUrlFor, isAllowedImageUrl } from './newsRules.js';
import { isPilotOnlyAllowed } from './pilot-only.js';

export const NEWS_FEATURE_ENABLED = true;                  // the code-level kill switch (DI-381): flip and ship to disable news app-wide
/** C20: the phone-side ESPN fetch (option A) is the CONTINGENCY only. Turning it on needs Drew's wording check of the privacy paragraph first (DI-671 / DI-683). */
export const NEWS_CLIENT_ESPN_FALLBACK = false;
/** The server path's request bounds (the RPC clamps them again: p_limit 1..100, at most 60 slate keys). */
export const NEWS_SERVER_LIMIT = 100;
export const NEWS_SLATE_KEYS_MAX = 60;
export const NEWS_LEVERS_TTL_MS = 10 * 60 * 1000;
export const NEWS_SOURCES_TTL_MS = 24 * 60 * 60 * 1000;
export const NEWS_CACHE_TTL_MS = 15 * 60 * 1000;
export const NEWS_MAX_RESPONSE_BYTES = 500000;             // generous for a 20-article payload (~100 KB live), refuses anything absurd
export const NEWS_ARTICLE_LIMIT = 20;
export const NEWS_HEADLINE_MAX = 300;
export const NEWS_DESCRIPTION_MAX = 500;
export const NEWS_FUTURE_SKEW_MS = 5 * 60 * 1000;
export const NEWS_API_HOST = 'site.api.espn.com';
export const NEWS_SPORT_PATHS = Object.freeze({
  cfb: 'football/college-football',
  nfl: 'football/nfl',
  nba: 'basketball/nba',
  nhl: 'hockey/nhl',
  cbb: 'basketball/mens-college-basketball',
});
const MAX_CATEGORIES = 20;
const SECRET_QUERY_KEY_PARTS = Object.freeze(['key', 'token', 'secret', 'auth', 'sig', 'pass', 'pwd', 'session', 'credential', 'hmac']);

// ─── errors: a fixed set of sentinel codes, never a platform error's text (SC-N3(b), applied to the client) ──────────────

const FETCH_CODES = Object.freeze(['timeout', 'http', 'bad_host', 'too_large', 'bad_json', 'bad_shape', 'unknown_sport', 'fetch_error', 'identity']);
function codeFromCause(cause) {
  if (typeof cause === 'string') return FETCH_CODES.indexOf(cause) >= 0 ? cause : 'fetch_error';
  if (cause && cause.name === 'AbortError') return 'timeout';
  if (cause && cause.name === 'SyntaxError') return 'bad_json';
  return 'fetch_error';
}
export class NewsFetchError extends Error {
  constructor(sport, cause) {
    super(`news fetch failed for ${String(sport === null || sport === undefined ? '' : sport).slice(0, 12)}`);
    this.name = 'NewsFetchError';
    this.sport = sport;
    this.code = codeFromCause(cause);
    this.cause = new Error(this.code);                      // a fixed sentinel: an ESPN URL, a status text or a stack never rides along
  }
}
export class NewsUnavailableError extends Error {
  constructor(sports, reason) {
    super('all requested sports failed');
    this.name = 'NewsUnavailableError';
    this.sports = sports;
    this.reason = reason || 'fetch';
  }
}

// ─── the kill switch (DI-381): code constant AND league setting AND player preference, all AND'd ─────────────────────────

export function isNewsAvailable({ leagueSettings, playerPrefs } = {}) {
  if (!NEWS_FEATURE_ENABLED) return false;
  if (leagueSettings && leagueSettings.newsEnabled === false) return false;     // an explicit false only; absent reads as on (CONVENTIONS #10)
  if (playerPrefs && playerPrefs.on === false) return false;
  return true;
}

// ─── identity token (the chatTransport.js shape, on the app's REAL identity primitives) ──────────────────────────────────

function newsToken() { return { epoch: getIdentityEpoch(), leagueId: getActiveLeagueId() }; }
function newsTokenMoved(token) {
  const now = newsToken();
  return now.leagueId !== token.leagueId || now.epoch !== token.epoch;
}

// ─── URL helpers (DI-375) ─────────────────────────────────────────────────────────────────────────────────────────────────

export function canonicalizeArticleUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    Array.from(u.searchParams.keys()).forEach((k) => { if (/^utm_/i.test(k)) u.searchParams.delete(k); });
    let s = u.toString();
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return String(rawUrl || '').trim().toLowerCase();
  }
}
/** Dependency-free djb2-xor: deterministic and sufficient for dedupe at this N (dozens of items), not a security boundary. */
export function hashCanonicalUrl(canonicalUrl) {
  let h = 5381;
  for (let i = 0; i < canonicalUrl.length; i++) h = ((h * 33) ^ canonicalUrl.charCodeAt(i)) >>> 0;
  return 'news_' + h.toString(16);
}

/**
 * http -> https for ESPN's own article hosts ONLY (coordinator ruling on DI-375 / DI-378, 2026-10-01). ESPN's NHL recap and preview items still ship
 * `http://www.espn.com/nhl/recap?gameId=...` (8 of 20 on the live feed); dropping them lost 40% of a sport for no safety gain, because the host is the same
 * allow-listed one. The scheme is rewritten as TEXT, only when the host is exactly espn.com or a subdomain, there is no port and no userinfo, and the string has no
 * backslash, whitespace, control character or excess length — and the result is then handed to the UNCHANGED validator (parseArticleUrl), which still refuses
 * anything that is not https afterwards and applies every other rule (so a laundering rewrite via URL.href, which would erase a backslash, is deliberately not used).
 * Anything else is returned untouched: `http://evil.example/x` stays http and the validator drops it. Never applied to picture URLs.
 */
export function upgradeEspnHttpLink(raw) {
  if (typeof raw !== 'string' || raw.length > 600 || !/^http:\/\//i.test(raw)) return raw;
  if (/[\s\u0000-\u001F\u007F\\]/.test(raw)) return raw;
  let u;
  try { u = new URL(raw); } catch { return raw; }
  if (u.protocol !== 'http:' || u.port || u.username || u.password) return raw;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9.-]+$/.test(host)) return raw;                                                   // letters, digits, dots and hyphens only (security C3)
  if (host !== 'espn.com' && !host.endsWith('.espn.com')) return raw;
  return 'https://' + raw.slice(7);
}

/** True when a query KEY on the link looks secret-shaped (SC-N3(d)): such a link is dropped, never opened or stored. */
function linkHasSecretShapedKey(href) {
  try {
    for (const k of new URL(href).searchParams.keys()) {
      const key = k.toLowerCase();
      for (const part of SECRET_QUERY_KEY_PARTS) { if (key.indexOf(part) >= 0) return true; }
    }
  } catch { return true; }
  return false;
}

// ─── normalize ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function emptyStats() { return { refusedLinks: 0, droppedDate: 0, droppedShape: 0, upgradedLinks: 0 }; }
const addStats = (into, from) => { for (const k of Object.keys(from)) into[k] = (into[k] || 0) + from[k]; };

/**
 * One ESPN article -> one frozen NewsItem, or null (counted in `stats`). Reads fixed property names only: a feed that ships `__proto__`,
 * `constructor` or any other key cannot reach a computed assignment here.
 */
function normalizeArticle(entry, sport, nowMs, stats) {
  if (!entry || typeof entry !== 'object') { stats.droppedShape++; return null; }
  if (typeof entry.headline !== 'string') { stats.droppedShape++; return null; }                 // never `.slice()` a non-string (S-C5)
  const headline = stripControlAndBidi(entry.headline.slice(0, NEWS_HEADLINE_MAX * 2)).slice(0, NEWS_HEADLINE_MAX).trim();
  if (!headline) { stats.droppedShape++; return null; }
  const description = typeof entry.description === 'string' ? (stripControlAndBidi(entry.description.slice(0, NEWS_DESCRIPTION_MAX * 2)).slice(0, NEWS_DESCRIPTION_MAX) || null) : null;

  const links = entry.links && typeof entry.links === 'object' ? entry.links : null;
  const webLink = links && links.web && typeof links.web === 'object' ? links.web.href : null;
  const upgraded = upgradeEspnHttpLink(webLink);                                                 // http -> https for ESPN's own article hosts only; everything else untouched
  const url = parseArticleUrl(upgraded);                                                         // the validated, serialized href, or null (S-C1, checkpoint 1 of 2)
  if (!url || linkHasSecretShapedKey(url)) { stats.refusedLinks++; return null; }
  if (upgraded !== webLink) stats.upgradedLinks++;

  const publishedRaw = typeof entry.published === 'string' ? entry.published.slice(0, 100) : ''; // the raw date field is capped before Date.parse (SC-N7(f))
  const ms = Date.parse(publishedRaw);
  if (Number.isNaN(ms) || ms > nowMs + NEWS_FUTURE_SKEW_MS) { stats.droppedDate++; return null; }

  const cats = Array.isArray(entry.categories) ? entry.categories.slice(0, MAX_CATEGORIES) : [];
  const teamNames = [], teamShortNames = [], teamIds = [];
  for (const c of cats) {
    if (!c || typeof c !== 'object') continue;
    if (c.type !== 'team' || typeof c.description !== 'string') continue;
    const name = stripControlAndBidi(c.description).slice(0, 80);
    if (!name) continue;
    const short = c.team && typeof c.team === 'object' && typeof c.team.shortDisplayName === 'string' ? stripControlAndBidi(c.team.shortDisplayName).slice(0, 80) : '';
    teamNames.push(name);
    teamShortNames.push(short);
    // The real ESPN team id is `teamId` (verified live): the category's own `id` is a different namespace, so it is NEVER used as a team id.
    const rawId = c.teamId !== undefined && c.teamId !== null ? c.teamId : (c.team && typeof c.team === 'object' ? c.team.id : undefined);
    if (typeof rawId === 'number' || typeof rawId === 'string') {
      const id = String(rawId).slice(0, 20);
      if (id && teamIds.indexOf(id) < 0) teamIds.push(id);
    }
  }

  let imageUrl = null;
  const images = Array.isArray(entry.images) ? entry.images.slice(0, 3) : [];
  for (const img of images) {                                                                    // the first picture whose host is on the ESPN-CDN allow-list
    const candidate = img && typeof img === 'object' ? isAllowedNewsImageUrl(logoOk(img.url)) : null;
    if (candidate) { imageUrl = candidate; break; }
  }

  return Object.freeze({
    id: hashCanonicalUrl(canonicalizeArticleUrl(url)),
    url,
    source: 'ESPN',                                                                              // the literal: ESPN's own endpoint returns ESPN's own reporting
    headline,
    imageUrl,
    publishedAt: new Date(ms).toISOString(),
    sport,
    teamIds: Object.freeze(teamIds),
    reason: null,                                                                                // rankNews fills these on a COPY, never here (S-C9)
    relevanceTier: null,
    teamNames: Object.freeze(teamNames),
    teamShortNames: Object.freeze(teamShortNames),
    description,
  });
}

/** Normalizes one sport's parsed payload. Throws NewsFetchError('bad_shape') when there is no `articles` array at all. */
export function normalizeNewsPayload(json, sport, nowMs = Date.now()) {
  const stats = emptyStats();
  const arts = json && typeof json === 'object' && Array.isArray(json.articles) ? json.articles.slice(0, NEWS_ARTICLE_LIMIT) : null;
  if (!arts) throw new NewsFetchError(sport, 'bad_shape');
  const items = [];
  const seen = new Set();
  for (const entry of arts) {
    const item = normalizeArticle(entry, sport, nowMs, stats);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return { items, stats };
}

// ─── the fetch ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export function espnNewsPath(sportKey) {
  return Object.prototype.hasOwnProperty.call(NEWS_SPORT_PATHS, sportKey) ? NEWS_SPORT_PATHS[sportKey] : null;
}

/**
 * Reads the response body as UTF-8 text and ENFORCES the byte cap WHILE it streams (security C4): a running byte count over `res.body.getReader()` aborts the request and
 * cancels the reader the moment it passes NEWS_MAX_RESPONSE_BYTES, so an endpoint that streams forever (or a body far over a lying or absent content-length) is never buffered
 * whole. Environments with no readable `res.body` (and the test fakes) fall back to `res.text()` with the same cap checked after it. A decoder in streaming mode keeps a
 * multi-byte character that straddles two chunks intact.
 */
async function readBodyCapped(res, sport, ctl) {
  const body = res.body;
  if (body && typeof body.getReader === 'function' && typeof TextDecoder === 'function') {
    const reader = body.getReader();
    const decoder = new TextDecoder('utf-8');
    let text = '';
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const n = value && typeof value.byteLength === 'number' ? value.byteLength : -1;
        if (n < 0) throw new NewsFetchError(sport, 'fetch_error');                               // a chunk that is not bytes
        total += n;
        if (total > NEWS_MAX_RESPONSE_BYTES) throw new NewsFetchError(sport, 'too_large');      // stop READING at the cap, not after the whole body is in memory
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } catch (e) {
      try { if (ctl) ctl.abort(); } catch { /* already settled */ }
      try { await reader.cancel(); } catch { /* the stream is already closed or errored */ }
      throw e instanceof NewsFetchError ? e : new NewsFetchError(sport, e);
    }
    return text;
  }
  let text;
  try { text = await res.text(); } catch (e) { throw new NewsFetchError(sport, e); }
  if (text.length > NEWS_MAX_RESPONSE_BYTES) throw new NewsFetchError(sport, 'too_large');
  return text;
}

async function fetchEspnNewsJson(sport, timeoutMs) {
  const path = espnNewsPath(sport);
  if (!path) throw new NewsFetchError(sport, 'unknown_sport');
  const url = `https://${NEWS_API_HOST}/apis/site/v2/sports/${path}/news?limit=${NEWS_ARTICLE_LIMIT}`;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    let res;
    try {
      res = await fetch(url, { credentials: 'omit', referrerPolicy: 'no-referrer', ...(ctl ? { signal: ctl.signal } : {}) });
    } catch (e) { throw new NewsFetchError(sport, e); }
    if (!res || !res.ok) throw new NewsFetchError(sport, 'http');
    let resHost = '';
    try { resHost = new URL(res.url).hostname.toLowerCase(); } catch { /* falls through to the check below */ }
    if (resHost !== NEWS_API_HOST) throw new NewsFetchError(sport, 'bad_host');                  // a redirect to another host cannot slip a payload past the cap
    const declared = Number(res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : 0) || 0;
    if (declared > NEWS_MAX_RESPONSE_BYTES) throw new NewsFetchError(sport, 'too_large');
    const text = await readBodyCapped(res, sport, ctl);
    try { return JSON.parse(text); } catch { throw new NewsFetchError(sport, 'bad_json'); }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ─── cache + in-flight ──────────────────────────────────────────────────────────────────────────────────────────────────

const _serverCache = new Map(); // query signature -> { items, fetchedAt, epoch, leagueId, off }   (the D1 server path)
const _serverInFlight = new Map();
const _sourceCache = new Map(); // source id -> { row, at }   (news_sources_for, 24 h)
let _levers = null;             // { newsEnabled, newsImages, at, epoch, leagueId }
const _cache = new Map();       // sport -> { items, fetchedAt, epoch, leagueId }
const _inFlight = new Map();    // `${epoch}|${leagueId}|${sport}` -> Promise<{ items, stats }>

/** Clears every cache (and forgets in-flight requests): the ESPN contingency's AND the server path's. Wired into applyIdentityDeltaIfChanged() by the Home wiring; also called by tests. */
export function clearNewsCache() { _cache.clear(); _inFlight.clear(); _serverCache.clear(); _serverInFlight.clear(); _sourceCache.clear(); _levers = null; _contentCache.clear(); _contentInFlight.clear(); }
export const _resetNewsTransportForTest = clearNewsCache;
export function _newsCacheSizeForTest() { return _cache.size; }

const sameIdentity = (entry, token) => entry.epoch === token.epoch && entry.leagueId === token.leagueId;
const isFresh = (entry, nowMs) => nowMs - entry.fetchedAt < NEWS_CACHE_TTL_MS && nowMs - entry.fetchedAt >= -NEWS_CACHE_TTL_MS;

async function loadSport(sport, { force, timeoutMs, nowMs, token }) {
  const hit = _cache.get(sport);
  const hitUsable = !!hit && sameIdentity(hit, token) && isFresh(hit, nowMs);
  if (hitUsable && !force) return { items: hit.items, stats: emptyStats(), cached: true };      // a cache hit inside the TTL is ZERO network
  const key = `${token.epoch}|${token.leagueId}|${sport}`;
  let job = _inFlight.get(key);
  if (!job) {
    job = (async () => {
      try {
        const json = await fetchEspnNewsJson(sport, timeoutMs);
        return normalizeNewsPayload(json, sport, nowMs);
      } finally {
        if (_inFlight.get(key) === job) _inFlight.delete(key);                                   // settled either way: the next call starts fresh
      }
    })();
    _inFlight.set(key, job);
  }
  let result;
  try { result = await job; }
  catch (e) {
    if (hitUsable) return { items: hit.items, stats: emptyStats(), cached: true };               // the fetch failed but a still-fresh entry can stand in
    throw e instanceof NewsFetchError ? e : new NewsFetchError(sport, e);
  }
  if (newsTokenMoved(token)) {                                                                   // a sign-out, a different player or a league switch mid-flight (S-C9)
    console.warn('[news] discarding a result that resolved after the identity moved');
    throw new NewsFetchError(sport, 'identity');
  }
  _cache.set(sport, { items: result.items, fetchedAt: nowMs, epoch: token.epoch, leagueId: token.leagueId });
  return { items: result.items, stats: result.stats, cached: false };
}

/**
 * @returns {Promise<{ items: object[], errors: Object<string, NewsFetchError>, stats: object }>}
 * THROWS NewsUnavailableError only when sports.length > 0 AND every requested sport errored on this call AND none had a still-fresh cache entry to
 * serve instead (or the identity moved). ZERO fetch calls when the code kill switch is off or no sport is requested (S-C8). A partial failure
 * returns the sports that succeeded and records the failed one in `errors` (the player still sees news; a 1-of-5 hiccup is not a message).
 */
export async function fetchEspnNews({ sports = [], force = false, timeoutMs = 6000, now = Date.now() } = {}) {
  const list = [];
  for (const s of Array.isArray(sports) ? sports : []) { if (typeof s === 'string' && list.indexOf(s) < 0 && list.length < 10) list.push(s); }
  const stats = emptyStats();
  if (!NEWS_FEATURE_ENABLED || list.length === 0) return { items: [], errors: {}, stats };
  const token = newsToken();
  const errors = Object.create(null);                                                          // no prototype: a hostile sport key such as "__proto__" is just a key, never a prototype assignment
  const perSport = new Array(list.length).fill(null);
  await Promise.all(list.map(async (sport, i) => {
    try { perSport[i] = await loadSport(sport, { force: !!force, timeoutMs, nowMs: now, token }); }
    catch (e) { errors[sport] = e instanceof NewsFetchError ? e : new NewsFetchError(sport, e); }
  }));
  if (newsTokenMoved(token)) {
    console.warn('[news] the identity moved while headlines were loading — nothing is returned');
    throw new NewsUnavailableError(list, 'identity');
  }
  const items = [];
  const seen = new Set();
  for (const r of perSport) {
    if (!r) continue;
    addStats(stats, r.stats);
    for (const it of r.items) { if (!seen.has(it.id)) { seen.add(it.id); items.push(it); } }    // an article tagged in two sports' feeds renders once
  }
  if (perSport.every((r) => !r)) throw new NewsUnavailableError(list, 'fetch');
  return { items, errors, stats };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D1 (DI-673): THE SERVER PATH — the default.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

const _deps = { getClient: null };
/** Called once by app.js at boot with the app's Supabase client getter (auth.js getSupabaseClient). Tests install a fake. Nothing else is injected. */
export function installNewsTransport({ getClient } = {}) { _deps.getClient = typeof getClient === 'function' ? getClient : null; }

const SOURCE_ID_RE = /^[a-z0-9][a-z0-9_-]{2,63}$/;
const KEY_RE = /^[a-z0-9 ]{2,80}$/;
const asList = (v) => (Array.isArray(v) ? v : []);

/**
 * The slate keys sent to the server: the normalized names of every team in the league's PUBLISHED slate (SC-N13(b): every game of the active week, whatever its
 * status), unique, SORTED, then truncated at 60 — so the truncation can never depend on who picked what (SC-N13(a)). Pure.
 */
export function slateKeysFor(teamNames, norm) {
  const out = new Set();
  for (const n of asList(teamNames)) { if (typeof n !== 'string') continue; const k = norm(n); if (KEY_RE.test(k)) out.add(k); }
  return Array.from(out).sort().slice(0, NEWS_SLATE_KEYS_MAX);
}

/** The two platform levers, in ONE select, cached 10 minutes per identity. A row that is unread or not exactly a boolean reads: newsEnabled ON (missing = on), newsImages OFF. */
async function readLevers(client, token, nowMs) {
  if (_levers && _levers.epoch === token.epoch && _levers.leagueId === token.leagueId && nowMs - _levers.at < NEWS_LEVERS_TTL_MS && nowMs >= _levers.at) return _levers;
  let newsEnabled = true, newsImages = false;
  try {
    const { data, error } = await client.from('platform_kv').select('key,value').in('key', ['news_enabled', 'news_images']);
    if (!error && Array.isArray(data)) {
      for (const row of data) {
        if (!row || typeof row !== 'object') continue;
        if (row.key === 'news_enabled') newsEnabled = row.value !== false;           // only an exact false turns News off (a missing row is on)
        if (row.key === 'news_images') newsImages = row.value === true;              // only an exact true shows pictures (fail closed)
      }
    }
  } catch { newsImages = false; }
  _levers = { newsEnabled, newsImages, at: nowMs, epoch: token.epoch, leagueId: token.leagueId };
  return _levers;
}

/** The registry rows for these source ids (news_sources_for: visible sources only), cached 24 h per id. A failure for NEW ids leaves them unknown (their items drop). */
async function sourcesFor(client, ids, nowMs) {
  const need = ids.filter((id) => { const c = _sourceCache.get(id); return !c || nowMs - c.at > NEWS_SOURCES_TTL_MS || nowMs < c.at; }).slice(0, 100);
  if (need.length) {
    try {
      const { data, error } = await client.rpc('news_sources_for', { p_ids: need });
      if (!error && Array.isArray(data)) {
        for (const r of data) {
          if (!r || typeof r !== 'object' || typeof r.id !== 'string' || !SOURCE_ID_RE.test(r.id)) continue;
          _sourceCache.set(r.id, { at: nowMs, row: Object.freeze({
            id: r.id, publisher: typeof r.publisher === 'string' ? stripControlAndBidi(r.publisher).slice(0, 80) : '',
            paywall: ['none', 'metered', 'hard'].indexOf(r.paywall) >= 0 ? r.paywall : 'none',
            rank: Number.isFinite(Number(r.rank)) ? Number(r.rank) : 50,
            legalStatus: r.legal_status === 'cleared' ? 'cleared' : r.legal_status === 'blocked' ? 'blocked' : 'pilot',
            linkHosts: Object.freeze(asList(r.link_hosts).filter((h) => typeof h === 'string').slice(0, 12)),
            imageHosts: Object.freeze(asList(r.image_hosts).filter((h) => typeof h === 'string').slice(0, 12)),
          }) });
        }
      }
    } catch { /* unknown ids stay unknown: their items drop (fail closed) */ }
  }
  const out = new Map();
  for (const id of ids) { const c = _sourceCache.get(id); if (c && c.row.publisher) out.set(id, c.row); }
  return out;
}

/**
 * One `news_feed` row -> one frozen NewsItem, or null. Rows are "untrusted-ish" (the collector could have a bug): every field is type-checked and capped; the URL
 * is re-validated against THE SOURCE'S OWN link hosts; a picture is kept only when the lever is on and its host is pinned on that source.
 */
export function normalizeServerRow(row, source, { picturesOn = false } = {}) {
  if (!row || typeof row !== 'object' || !source) return null;
  const idNum = typeof row.id === 'number' ? row.id : Number(row.id);
  if (!Number.isSafeInteger(idNum) || idNum < 1) return null;
  if (typeof row.headline !== 'string') return null;
  const headline = stripControlAndBidi(row.headline.slice(0, 600)).slice(0, NEWS_HEADLINE_MAX).trim();
  if (!headline) return null;
  const url = parseArticleUrlFor(row.url, source.linkHosts);
  if (!url) return null;
  const ms = Date.parse(row.published_at);
  if (!Number.isFinite(ms)) return null;
  const upd = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : NaN;
  const sport = typeof row.sport === 'string' && Object.prototype.hasOwnProperty.call(NEWS_SPORT_PATHS, row.sport) ? row.sport : null;
  if (!sport) return null;
  const via = typeof row.via === 'string' && /^[A-Za-z0-9 .,'&-]{2,60}$/.test(row.via) ? row.via : null;
  const imageUrl = picturesOn && typeof row.image_url === 'string' ? isAllowedImageUrl(row.image_url, source.imageHosts) : null;
  const teamKeys = asList(row.team_keys).filter((k) => typeof k === 'string' && KEY_RE.test(k)).slice(0, 40);
  const teamNames = asList(row.team_names).filter((n) => typeof n === 'string').map((n) => stripControlAndBidi(n).slice(0, 80)).filter(Boolean).slice(0, 4);
  return Object.freeze({
    id: 'news_' + String(idNum),
    url,
    source: source.publisher,                                                                    // the REGISTRY's publisher (never feed text)
    publisher: source.publisher,
    via,
    sourceId: source.id,
    paywall: source.paywall,
    rank: source.rank,
    headline,
    imageUrl,
    publishedAt: new Date(ms).toISOString(),
    updatedAt: Number.isFinite(upd) ? new Date(upd).toISOString() : null,
    sport,
    teamIds: Object.freeze(teamKeys.slice()),
    teamKeys: Object.freeze(teamKeys),
    teamNames: Object.freeze(teamNames),
    teamShortNames: Object.freeze([]),
    dedupeKey: typeof row.dedupe_key === 'string' && /^[0-9a-f]{1,40}$/.test(row.dedupe_key) ? row.dedupe_key : null,
    linkHosts: source.linkHosts,
    imageHosts: source.imageHosts,
    reason: null,
    relevanceTier: null,
    description: null,
  });
}

/**
 * THE SERVER PATH. Resolves `{ items, errors:{}, stats, off }`; `off: 'platform'` when news_enabled is exactly false (no article is returned). ZERO network when
 * the code switch is off or no sport is asked for (S-C8). Throws NewsUnavailableError when the feed read failed and nothing fresh is cached, or the identity moved.
 */
export async function fetchServerNews({ sports = [], slateKeys = [], force = false, now = Date.now(), league = null } = {}) {
  const list = [];
  for (const s0 of Array.isArray(sports) ? sports : []) { if (typeof s0 === 'string' && Object.prototype.hasOwnProperty.call(NEWS_SPORT_PATHS, s0) && list.indexOf(s0) < 0) list.push(s0); }
  const stats = { droppedSource: 0, droppedShape: 0, droppedPilot: 0 };
  if (!NEWS_FEATURE_ENABLED || list.length === 0) return { items: [], errors: {}, stats, off: false };
  const client = _deps.getClient ? (() => { try { return _deps.getClient(); } catch { return null; } })() : null;
  if (!client || typeof client.rpc !== 'function') throw new NewsUnavailableError(list, 'no_client');
  const keys = asList(slateKeys).filter((k) => typeof k === 'string' && KEY_RE.test(k)).slice(0, NEWS_SLATE_KEYS_MAX);
  const token = newsToken();
  const sig = `${list.slice().sort().join(',')}|${keys.join(',')}`;
  const hit = _serverCache.get(sig);
  const hitUsable = !!hit && sameIdentity(hit, token) && isFresh(hit, now);
  if (hitUsable && !force) return { items: hit.items, errors: {}, stats, off: hit.off };
  const jobKey = `${token.epoch}|${token.leagueId}|${sig}`;
  let job = _serverInFlight.get(jobKey);
  if (!job) {
    job = (async () => {
      try {
        // the levers and the feed TOGETHER: the picture decision is known before the first card paints
        const [levers, feed] = await Promise.all([
          readLevers(client, token, now),
          (async () => { try { return await client.rpc('news_feed', { p_sports: list, p_limit: NEWS_SERVER_LIMIT, p_slate_keys: keys }); } catch { return { data: null, error: { code: 'thrown' } }; } })(),
        ]);
        if (levers.newsEnabled === false) return { items: [], off: 'platform' };
        if (!feed || feed.error || !Array.isArray(feed.data)) throw new NewsUnavailableError(list, 'fetch');
        const rows = feed.data.filter((r) => r && typeof r === 'object' && typeof r.source_id === 'string' && SOURCE_ID_RE.test(r.source_id));
        const srcMap = await sourcesFor(client, Array.from(new Set(rows.map((r) => r.source_id))), now);
        // the client MIRROR of the server's pilot-only rule (belt and braces over RLS). No league passed = the installed resolver answers for the ACTIVE league
        // (app.js installs it at boot); passing `null` explicitly would read as "no league" and hide every pilot source from the pilot league itself.
        const pilot = league ? isPilotOnlyAllowed('newsPilotSources', league) : isPilotOnlyAllowed('newsPilotSources');
        const items = [];
        const seen = new Set();
        for (const r of rows) {
          const src = srcMap.get(r.source_id);
          if (!src) { stats.droppedSource++; continue; }
          if (src.legalStatus === 'blocked' || (!pilot && src.legalStatus !== 'cleared')) { stats.droppedPilot++; continue; }
          const it = normalizeServerRow(r, src, { picturesOn: levers.newsImages === true });
          if (!it) { stats.droppedShape++; continue; }
          if (seen.has(it.id)) continue;
          seen.add(it.id);
          items.push(it);
        }
        return { items, off: false };
      } finally {
        if (_serverInFlight.get(jobKey) === job) _serverInFlight.delete(jobKey);
      }
    })();
    _serverInFlight.set(jobKey, job);
  }
  let result;
  try { result = await job; }
  catch (e) {
    if (hitUsable) return { items: hit.items, errors: {}, stats, off: hit.off };
    throw e instanceof NewsUnavailableError ? e : new NewsUnavailableError(list, 'fetch');
  }
  if (newsTokenMoved(token)) {
    console.warn('[news] discarding a result that resolved after the identity moved');
    throw new NewsUnavailableError(list, 'identity');
  }
  _serverCache.set(sig, { items: result.items, off: result.off, fetchedAt: now, epoch: token.epoch, leagueId: token.leagueId });
  return { items: result.items, errors: {}, stats, off: result.off };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// D1 Lane C (DI-660 / DI-668): THE HOME CONTENT LEG — matchup, player and spotlight cards from 0055's feed_content_list.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
/** Review B4 (2026-10-14): ask for the RPC's maximum (60) and let the device keep 40 by tier, then unseen, then newest (feed-relevance.js); asking for 40 would make the
 *  server's newest 40 the cut, and relevance could never reach an older "Your pick" card. */
export const CONTENT_LIMIT = 60;
export const CONTENT_TTL_MS = 5 * 60 * 1000;
export const CONTENT_SPOTLIGHT_MS = 72 * 60 * 60 * 1000;
const CONTENT_KIND_SET = Object.freeze(['matchup.preview', 'player.preview', 'spotlight']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const _contentCache = new Map();     // sports signature -> { items, fetchedAt, epoch, leagueId }
const _contentInFlight = new Map();

export class ContentUnavailableError extends Error {
  constructor(reason) { super('content unavailable'); this.name = 'ContentUnavailableError'; this.reason = reason || 'fetch'; }
}

const cleanStr = (v, max) => (typeof v === 'string' ? stripControlAndBidi(v).replace(/\s+/g, ' ').trim().slice(0, max) : '');
const cleanList = (v, max, n) => asList(v).map((x) => cleanStr(x, max)).filter(Boolean).slice(0, n);
function cleanCard(card, kind) {
  const c = card && typeof card === 'object' && !Array.isArray(card) ? card : {};
  const team = (t) => (t && typeof t === 'object' ? { name: cleanStr(t.name, 60), record: /^\d{1,2}-\d{1,2}(-\d{1,2})?$/.test(String(t.record || '')) ? String(t.record) : null, rank: Number.isInteger(t.rank) && t.rank >= 1 && t.rank <= 25 ? t.rank : null } : null);
  const out = { headline: cleanStr(c.headline, 120) };
  if (kind === 'matchup.preview') Object.assign(out, { away: team(c.away), home: team(c.home), kickoff: Number.isFinite(Date.parse(c.kickoff)) ? new Date(Date.parse(c.kickoff)).toISOString() : null, venue: cleanStr(c.venue, 80) || null, tv: cleanList(c.tv, 30, 3) });
  if (kind === 'player.preview') Object.assign(out, { name: cleanStr(c.name, 60), team: cleanStr(c.team, 60), opponent: cleanStr(c.opponent, 60), position: c.position === 'QB' ? 'QB' : 'WR/TE', label: cleanStr(c.label, 80), seasonLine: cleanStr(c.seasonLine, 200) || null, last3Line: cleanStr(c.last3Line, 200) || null, trend: ['up', 'down', 'steady'].indexOf(c.trend) >= 0 ? c.trend : null, injury: cleanStr(c.injury, 120) || null, kickoff: Number.isFinite(Date.parse(c.kickoff)) ? new Date(Date.parse(c.kickoff)).toISOString() : null });
  if (kind === 'spotlight') {
    const r = c.rationale && typeof c.rationale === 'object' ? c.rationale : {};
    Object.assign(out, { name: cleanStr(c.name, 60), team: cleanStr(c.team, 60), opponent: cleanStr(c.opponent, 60), score: /^\d{1,3}-\d{1,3}$/.test(String(c.score || '')) ? String(c.score) : null, result: ['won', 'lost', 'tied'].indexOf(c.result) >= 0 ? c.result : null,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || '')) ? String(c.date) : null, lines: cleanList(c.lines, 160, 3), why: cleanStr(c.why, 300),
      rationale: Object.freeze({ standardVersion: cleanStr(String(r.standardVersion || ''), 4), rule: cleanStr(r.rule, 80), rank: Number.isInteger(r.rank) ? r.rank : null, ofCandidates: Number.isInteger(r.ofCandidates) ? r.ofCandidates : null }) });
  }
  return Object.freeze(out);
}

/** One feed_content_list / feed_content_get row -> one frozen content item, or null. Untrusted-ish: every field is typed and capped; no reason is read from the server. */
export function normalizeContentRow(row) {
  if (!row || typeof row !== 'object') return null;
  const id = typeof row.id === 'string' && UUID_RE.test(row.id) ? row.id : null;
  const kind = CONTENT_KIND_SET.indexOf(row.kind) >= 0 ? row.kind : null;
  const sport = row.sport === 'cfb' || row.sport === 'nfl' ? row.sport : null;
  const pub = Date.parse(row.published_at), fresh = Date.parse(row.fresh_as_of), exp = Date.parse(row.expires_at);
  if (!id || !kind || !sport || !Number.isFinite(pub) || !Number.isFinite(fresh) || !Number.isFinite(exp)) return null;
  const card = cleanCard(row.card, kind);
  if (!card.headline) return null;
  const status = row.synthesis_status === 'ok' ? 'ok' : 'structured';
  const facts = asList(row.facts).filter((f) => f && typeof f === 'object' && typeof f.id === 'string').slice(0, 30).map((f) => Object.freeze({
    id: cleanStr(f.id, 120), text: cleanStr(f.text, 400), window: cleanStr(f.window, 80) || null,
    source: f.source && typeof f.source === 'object' ? Object.freeze({ label: cleanStr(f.source.label, 60), publishedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(f.source.publishedAt || '')) ? String(f.source.publishedAt) : null }) : null,
  })).filter((f) => f.text);
  const eligibleUntil = kind === 'spotlight' ? Math.min(exp, pub + CONTENT_SPOTLIGHT_MS) : exp;
  return Object.freeze({
    id: 'content_' + id, contentId: id, cardKind: kind, sport,
    eventRef: typeof row.event_ref === 'string' && /^espn:event:\d{1,20}$/.test(row.event_ref) ? row.event_ref : null,
    teamKeys: Object.freeze(asList(row.team_keys).filter((k) => typeof k === 'string' && KEY_RE.test(k)).slice(0, 40)),
    publishedAt: new Date(pub).toISOString(), freshAsOf: new Date(fresh).toISOString(), eligibleUntil: new Date(eligibleUntil).toISOString(),
    card,
    summary: status === 'ok' ? cleanStr(row.summary, 220) || null : null,
    watch: Object.freeze(status === 'ok' ? asList(row.watch).map((w) => Object.freeze({ text: cleanStr(w && w.text, 140) })).filter((w) => w.text).slice(0, 2) : []),
    talk: status === 'ok' && row.talk && typeof row.talk === 'object' && cleanStr(row.talk.text, 140) ? Object.freeze({ text: cleanStr(row.talk.text, 140) }) : null,
    facts: Object.freeze(facts),
    gaps: Object.freeze(asList(row.gaps).map((g) => cleanStr(g, 200)).filter(Boolean).slice(0, 20)),
    sources: Object.freeze(asList(row.sources).map((x) => Object.freeze({ label: cleanStr(x && x.label, 60), publishedAt: /^\d{4}-\d{2}-\d{2}$/.test(String(x && x.publishedAt || '')) ? String(x.publishedAt) : null })).filter((x) => x.label).slice(0, 8)),
    synthesisStatus: status,
    version: Number.isInteger(row.version) ? row.version : 1,
    reason: null, relevanceTier: null,
  });
}

/**
 * The content leg: `{ items }` from feed_content_list (the caller's followed sports; no pick, team or league argument, DI-668). Cached 5 minutes per identity.
 * Throws ContentUnavailableError('no_client' | 'fetch' | 'identity'). Zero network when the code switch is off or no sport is asked for.
 */
export async function fetchContent({ sports = [], force = false, now = Date.now() } = {}) {
  const list = (Array.isArray(sports) ? sports : []).filter((s, i, a) => (s === 'cfb' || s === 'nfl') && a.indexOf(s) === i).sort();
  if (!NEWS_FEATURE_ENABLED || !list.length) return { items: [] };
  const client = _deps.getClient ? (() => { try { return _deps.getClient(); } catch { return null; } })() : null;
  if (!client || typeof client.rpc !== 'function') throw new ContentUnavailableError('no_client');
  const token = newsToken();
  const sig = list.join(',');
  const hit = _contentCache.get(sig);
  if (hit && !force && sameIdentity(hit, token) && now - hit.fetchedAt < CONTENT_TTL_MS && now >= hit.fetchedAt) return { items: hit.items };
  const key = `${token.epoch}|${token.leagueId}|${sig}`;
  let job = _contentInFlight.get(key);
  if (!job) {
    job = (async () => {
      try {
        let res;
        try { res = await client.rpc('feed_content_list', { p_sports: list, p_limit: CONTENT_LIMIT }); } catch { res = { data: null, error: { code: 'thrown' } }; }
        if (!res || res.error || !Array.isArray(res.data)) throw new ContentUnavailableError('fetch');
        const seen = new Set();
        const items = [];
        for (const r of res.data) { const it = normalizeContentRow(r); if (it && !seen.has(it.id)) { seen.add(it.id); items.push(it); } }
        return items;
      } finally { if (_contentInFlight.get(key) === job) _contentInFlight.delete(key); }
    })();
    _contentInFlight.set(key, job);
  }
  let items;
  try { items = await job; }
  catch (e) {
    if (hit && sameIdentity(hit, token)) return { items: hit.items, stale: true };
    throw e instanceof ContentUnavailableError ? e : new ContentUnavailableError('fetch');
  }
  if (newsTokenMoved(token)) throw new ContentUnavailableError('identity');
  _contentCache.set(sig, { items, fetchedAt: now, epoch: token.epoch, leagueId: token.leagueId });
  return { items };
}

/** One card's detail (feed_content_get). Resolves the normalized item or null (gone / not visible); throws ContentUnavailableError on a failed read. */
export async function fetchContentDetail(contentId) {
  if (typeof contentId !== 'string' || !UUID_RE.test(contentId)) return null;
  const client = _deps.getClient ? (() => { try { return _deps.getClient(); } catch { return null; } })() : null;
  if (!client || typeof client.rpc !== 'function') throw new ContentUnavailableError('no_client');
  const token = newsToken();
  let res;
  try { res = await client.rpc('feed_content_get', { p_id: contentId }); } catch { res = { data: null, error: { code: 'thrown' } }; }
  if (!res || res.error) throw new ContentUnavailableError('fetch');
  if (newsTokenMoved(token)) throw new ContentUnavailableError('identity');
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  return row ? normalizeContentRow(row) : null;
}

/**
 * DI-667: the league's callback analysis for one week (league_insight_get: membership is checked FIRST, server-side). Resolves `{ status: 'ok'|'none', read, createdAt }`;
 * 'none' = no analysis row, or one without model text (the detail then says "Analysis isn't available right now."). Throws ContentUnavailableError on a failed read.
 */
export async function fetchLeagueInsight({ leagueId, weekRef } = {}) {
  if (typeof leagueId !== 'string' || !UUID_RE.test(leagueId) || typeof weekRef !== 'string' || !/^[0-9]{4}:(cfb|nfl):[0-9]{1,2}$/.test(weekRef)) return { status: 'none', read: null, createdAt: null };
  const client = _deps.getClient ? (() => { try { return _deps.getClient(); } catch { return null; } })() : null;
  if (!client || typeof client.rpc !== 'function') throw new ContentUnavailableError('no_client');
  const token = newsToken();
  let res;
  try { res = await client.rpc('league_insight_get', { p_league: leagueId, p_week_ref: weekRef }); } catch { res = { data: null, error: { code: 'thrown' } }; }
  if (!res || res.error) throw new ContentUnavailableError('fetch');
  if (newsTokenMoved(token)) throw new ContentUnavailableError('identity');
  const row = Array.isArray(res.data) ? res.data[0] : res.data;
  const read = row && row.synthesis_status === 'ok' && row.synthesis && typeof row.synthesis.read === 'string' ? cleanStr(row.synthesis.read, 700) : '';
  const created = row ? Date.parse(row.created_at) : NaN;
  return read ? { status: 'ok', read, createdAt: Number.isFinite(created) ? new Date(created).toISOString() : null } : { status: 'none', read: null, createdAt: null };
}

/**
 * THE ONE ENTRY POINT Home and the adapter call: the server path, unless the C20-gated contingency is on.
 * @returns {Promise<{ items: object[], errors: object, stats: object, off?: false|'platform' }>}
 */
export async function fetchNews(opts = {}) {
  if (NEWS_CLIENT_ESPN_FALLBACK) return fetchEspnNews(opts);
  return fetchServerNews(opts);
}
export const fetchLatest = fetchNews;
