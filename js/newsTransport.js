/**
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
import { stripControlAndBidi } from './newsRules.js';

export const NEWS_FEATURE_ENABLED = true;                  // the code-level kill switch (DI-381): flip and ship to disable news app-wide
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

const _cache = new Map();       // sport -> { items, fetchedAt, epoch, leagueId }
const _inFlight = new Map();    // `${epoch}|${leagueId}|${sport}` -> Promise<{ items, stats }>

/** Clears the cache (and forgets in-flight requests). Wired into applyIdentityDeltaIfChanged() by the Home wiring window; also called by tests. */
export function clearNewsCache() { _cache.clear(); _inFlight.clear(); }
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
export async function fetchNews({ sports = [], force = false, timeoutMs = 6000, now = Date.now() } = {}) {
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
