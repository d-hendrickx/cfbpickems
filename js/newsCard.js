/**
 * CFB Pickems — js/newsCard.js (Social Platform News, option A: ESPN headlines only; DI-377 / DI-378, 2026-10-01)
 * ===============================================================================================================
 * The news card's ONE render sink, the ONE article-URL validator and the card's tap handling. Home (js/home.js) never interpolates a
 * NewsItem field itself: it calls `renderNewsCard(item)` and splices the returned string as-is, so every field passes `esc()` here and
 * nowhere else (S-C3). Option B (all sources) keeps this file's names and signatures; only the hosts widen.
 *
 * ── THE SECURITY CONTRACT (Home security W9 — binding) ───────────────────────────────────────────────────────────────
 *   1. EVERY field is escaped with a QUOTE-COMPLETE `esc` (& < > " and the apostrophe). The app's `escHtml` is not used: it does not
 *      escape the apostrophe and is private to app.js (S-C3). There is no `typeof escHtml === 'function' ? escHtml : String` fallback shape.
 *   2. NO `href` is ever built from `item.url`. The card carries `data-news-id` only; a tap resolves the id against the in-memory items and
 *      opens `parseArticleUrl(item.url)`'s own WHATWG-serialized output — never the raw string, never a value read out of the DOM (S-C1).
 *   3. `<img>` is emitted only for an https ESPN-CDN host (`isAllowedNewsImageUrl`), with `referrerpolicy="no-referrer"`, `loading="lazy"`,
 *      `decoding="async"`, and NO `srcset`, `style`, `crossorigin` or `on*` attribute (S-C6). A load error is handled by a delegated capture
 *      listener (bindNewsCardEvents), never an inline handler.
 *   4. The card NEVER emits `data-home-action`, `data-tab`, `data-comm-target`, `data-comm-tab` or `data-haptic`: Home's delegated handler obeys
 *      those inside its container, so a headline that smuggled one in would drive the app. The reason pill is a CLOSED set of strings, so no
 *      free text can reach it.
 *   5. The output is balanced markup, or '' on bad input (a non-object, a missing id / headline / source, an unknown sport, an unparseable time).
 *
 * Import allow-list (DI-382, asserted by newstest): ./haptics.js and ./platform.js (this file needs no icon). Nothing else.
 * iOS 15.0 safe (no Object.hasOwn, no .at()).
 */

import { haptic } from './haptics.js';
import { openExternalUrl } from './platform.js';

// ─── escaping: ONE local, quote-complete escaper (S-C3) ───────────────────────────────────────────────────────────────

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
/** Test seam: the one escaper, exactly as the sink uses it. */
export const _escForTest = esc;

// ─── labels ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The sport chip's label per sport. newsRank.js carries the same map as SPORT_LABELS (it may not import this file); newstest pins the two equal. */
export const SPORT_CHIP_LABELS = Object.freeze({ cfb: 'CFB', nfl: 'NFL', nba: 'NBA', nhl: 'NHL', cbb: 'CBB' });
/** The reason pill is a CLOSED set (DI-377 #6): the four team / slate labels and the sport labels. Anything else renders no pill. */
export const NEWS_CARD_REASONS = Object.freeze(["In this week's slate", 'Your pick', 'Your alma mater', 'Your team', 'CFB', 'NFL', 'NBA', 'NHL', 'CBB']);

const HEADLINE_MAX = 300;
const SOURCE_MAX = 80;
const ID_MAX = 64;
const URL_MAX = 600;
const IMAGE_URL_MAX = 300;

/** A plain string, trimmed and capped; anything that is not a non-empty string reads as ''. */
const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** A parsed hostname may contain only these (punycode `xn--` labels included). The WHATWG parser accepts a quote and other odd characters in a host, and a host is later
 *  echoed into a data attribute's neighbourhood; one pattern refuses them for both the article validator and the picture validator. */
const HOST_CHARS = /^[a-z0-9.-]+$/;

// ─── the ONE article-URL validator (S-C1) ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the WHATWG-SERIALIZED, already-validated `href` of an ESPN article link, or null. Option A allows `espn.com` and `*.espn.com`
 * over https only. Shared by newsTransport.js (normalize time) and the tap handler below (tap time): defense in depth against any
 * future code path that builds a NewsItem without normalizing (a fixture, a refactor).
 *
 * The native Browser plugin (Capacitor's in-app Safari) parses its string with Foundation's `URL(string:)`, not WHATWG's `new URL()`; the two disagree about crafted
 * strings, so the raw string must never reach the native layer. Refused here: a non-string, anything over 600 characters, whitespace or
 * control characters, ANY backslash (WHATWG reads `https://www.espn.com\@evil.example/` as host www.espn.com with the path `/@evil.example/`;
 * Foundation reads it differently — the differential itself is the reason it is refused, not out-guessed), a non-https scheme, a port,
 * userinfo, and any host that is not espn.com or a subdomain of it (`espn.com.evil.example` and a trailing-dot `www.espn.com.` both fail).
 * What is returned is `u.href`, never `raw`.
 */
export function parseArticleUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > URL_MAX) return null;
  if (/[\s\u0000-\u001F\u007F\\]/.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.port) return null;                                  // an ESPN article never needs a non-default port
  if (u.username || u.password) return null;                // userinfo is refused outright, never out-guessed
  const host = u.hostname.toLowerCase();
  if (!HOST_CHARS.test(host)) return null;                  // after parsing, a hostname is letters, digits, dots and hyphens ONLY (security C3: WHATWG tolerates `a"b.espn.com`)
  if (host !== 'espn.com' && !host.endsWith('.espn.com')) return null;
  return u.href;
}

// ─── the image host allow-list (S-C6) ─────────────────────────────────────────────────────────────────────────────────

/**
 * Hosts a news picture may come from. Evidence (live ESPN site API, 2026-10-01, five sports x 20 articles): `a.espncdn.com` and
 * `s.espncdn.com` (photos) and `espnmedia-cdn.akamaized.net` (the video-clip stills on every `Media` item — ESPN's own media hostname on
 * Akamai's shared domain, so it is an EXACT host, never a `.akamaized.net` suffix). A suffix pattern is limited to ESPN's own domains.
 */
export const NEWS_IMAGE_HOSTS = Object.freeze({
  suffixes: Object.freeze(['.espncdn.com', '.espn.com']),
  exact: Object.freeze(['espncdn.com', 'espn.com', 'espnmedia-cdn.akamaized.net']),
});

/**
 * The validated https image URL (WHATWG-serialized) or null: https only, at most 300 characters, no port, no userinfo, not an IP literal,
 * and a host on NEWS_IMAGE_HOSTS. Shared by the transport (normalize) and the renderer (render), so a NewsItem built any other way is
 * still checked once more before it can become a request to a third party.
 */
export function isAllowedNewsImageUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > IMAGE_URL_MAX) return null;
  if (/[\s\u0000-\u001F\u007F\\]/.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!HOST_CHARS.test(host)) return null;                                                  // letters, digits, dots and hyphens only (security C3)
  if (host.charAt(0) === '[' || /^[0-9.]+$/.test(host)) return null;                       // an IP literal is never a CDN
  const ok = NEWS_IMAGE_HOSTS.exact.indexOf(host) >= 0 || NEWS_IMAGE_HOSTS.suffixes.some((s) => host.endsWith(s));
  return ok ? u.href : null;
}

// ─── relative time ────────────────────────────────────────────────────────────────────────────────────────────────────

/** "Just now" / "12m ago" / "2h ago" / "Yesterday" / "3d ago". No shared helper in the app has these buckets (app.js and chat-ui.js keep private ones), so this is local. */
export function relativeTime(iso, now = Date.now()) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const diff = now - ms;
  if (diff < 60e3) return 'Just now';
  if (diff < 3600e3) return `${Math.floor(diff / 60e3)}m ago`;
  if (diff < 86400e3) return `${Math.floor(diff / 3600e3)}h ago`;
  if (diff < 2 * 86400e3) return 'Yesterday';
  return `${Math.floor(diff / 86400e3)}d ago`;
}

// ─── the card ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One NewsItem -> one card's HTML, or '' on bad input. See the contract in the header. The metadata row (publisher, time, sport chip) is
 * ALWAYS present: the publisher is never conditional (UN-344). No image -> no <img> and no placeholder box; the headline moves to the top.
 */
export function renderNewsCard(item) {
  try {
    if (!item || typeof item !== 'object') return '';
    const id = cleanText(item.id, ID_MAX);
    const headline = cleanText(item.headline, HEADLINE_MAX);
    const source = cleanText(item.source, SOURCE_MAX);
    if (!id || !headline || !source) return '';
    const sportLabel = Object.prototype.hasOwnProperty.call(SPORT_CHIP_LABELS, item.sport) ? SPORT_CHIP_LABELS[item.sport] : '';
    if (!sportLabel) return '';
    if (!Number.isFinite(Date.parse(item.publishedAt))) return '';
    const reason = NEWS_CARD_REASONS.indexOf(item.reason) >= 0 ? item.reason : '';
    const imageSrc = isAllowedNewsImageUrl(item.imageUrl);
    const when = relativeTime(item.publishedAt);
    const pill = reason ? `<span class="national-tv-badge news-card__reason">${esc(reason)}</span>` : '';
    const image = imageSrc ? `<img class="news-card__image" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(imageSrc)}">` : '';
    return `<div class="card news-card" data-news-id="${esc(id)}" role="link" tabindex="0" aria-label="${esc(headline)}, ${esc(source)}">${image}<div class="news-card__body">${pill}<p class="news-card__headline">${esc(headline)}</p><div class="news-card__meta"><span class="news-card__pub">${esc(source)}</span><span aria-hidden="true">·</span><span>${esc(when)}</span><span class="national-tv-badge news-card__sport">${esc(sportLabel)}</span></div></div></div>`;
  } catch {
    return '';
  }
}

// ─── the tap ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The default opener: a light haptic (native only — haptic() is a no-op on web), then the in-app browser / a new tab, given ONLY a validated href. */
export function openNewsArticle(href) {
  haptic('light');
  return openExternalUrl(href);
}

const bound = new WeakMap();

/**
 * Delegated click / keyboard handling for every news card under `rootEl` (Home's container). A tap resolves the card's `data-news-id`
 * against the CURRENT items (`items` is an array or a function returning one, so a refresh needs no rebind), re-validates that item's url
 * with parseArticleUrl, and hands `onOpen` the validated href — never a URL read from the DOM, never `item.url` itself. A card whose id is
 * unknown, or whose url fails, opens nothing. Binding the same root twice REPLACES the earlier binding (no double open). Returns an unbind.
 */
export function bindNewsCardEvents(rootEl, { items, onOpen } = {}) {
  if (!rootEl || typeof rootEl.addEventListener !== 'function') return () => {};
  if (bound.has(rootEl)) { try { bound.get(rootEl)(); } catch { /* detached */ } }
  const getItems = typeof items === 'function' ? items : () => items;
  const open = typeof onOpen === 'function' ? onOpen : openNewsArticle;
  const cardOf = (e) => {
    const t = e && e.target;
    return t && typeof t.closest === 'function' ? t.closest('.news-card') : null;
  };
  const idOf = (card) => {
    if (card.dataset && typeof card.dataset.newsId === 'string') return card.dataset.newsId;
    return typeof card.getAttribute === 'function' ? card.getAttribute('data-news-id') : null;
  };
  function activate(card) {
    if (!card) return;
    const id = idOf(card);
    if (!id) return;
    let list = [];
    try { list = getItems(); } catch { return; }
    const item = (Array.isArray(list) ? list : []).find((i) => i && i.id === id);
    if (!item) return;
    const href = parseArticleUrl(item.url);                   // re-validated at tap time (S-C1)
    if (!href) return;                                        // fails closed: nothing opens
    try { open(href); } catch (err) { console.warn('[news] opening an article failed', err && err.name); }
  }
  const onClick = (e) => activate(cardOf(e));
  const onKeydown = (e) => {
    if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
    const card = cardOf(e);
    if (!card) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    activate(card);
  };
  // A picture that fails to load is REMOVED, not left as a broken-image glyph (an inline onerror is forbidden, so this is a delegated
  // capture listener: error events do not bubble).
  const onImageError = (e) => {
    const t = e && e.target;
    if (t && t.classList && typeof t.classList.contains === 'function' && t.classList.contains('news-card__image')) t.classList.add('news-card__image--failed');
  };
  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('keydown', onKeydown);
  rootEl.addEventListener('error', onImageError, true);
  const unbind = () => {
    try { rootEl.removeEventListener('click', onClick); rootEl.removeEventListener('keydown', onKeydown); rootEl.removeEventListener('error', onImageError, true); } catch { /* detached */ }
    bound.delete(rootEl);
  };
  bound.set(rootEl, unbind);
  return unbind;
}
