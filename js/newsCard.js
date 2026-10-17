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
 * Import allow-list (DI-382, asserted by newstest): ./haptics.js, ./platform.js, ./newsRules.js (the shared URL / picture validators) and, since W-92 (2026-10-17),
 * ./feed-time.js (the shared, pure time vocabulary). Nothing else.
 *
 * ── D1 (DI-671…673, C10, C18; 2026-10-08) ─────────────────────────────────────────────────────────────────────────────
 *   · An item from the SERVER carries its source's own `linkHosts` / `imageHosts` (news_sources_for): the article URL is re-validated against THOSE at render-adjacent
 *     tap time and the picture against those at render. An item with none (the ESPN contingency) keeps the ESPN lists below.
 *   · The byline is `{via} via {publisher}` or `{publisher}`; a publisher's later update shows as "Updated Oct 6" when it is at least 30 minutes after publication.
 *   · DI-672: a card whose duplicate coverage was grouped shows "Also from CBS Sports and Yahoo Sports" as a separate 44 pt button; it opens a bottom sheet whose rows
 *     are built HERE (`renderAlsoFromSheet`), never by the caller. C10: the via, every "Also from" headline and publisher go through THIS file's `esc()` only, in
 *     markup whose every attribute is double-quoted.
 *   · DI-663: a STORYLINE card is a news item with a deterministic game / team tag, drawn by `renderStorylineCard` (C18: the headline exactly as published, the
 *     publisher, the article's own date, the tag, the pinned picture). No model text, ever.
 * iOS 15.0 safe (no Object.hasOwn, no .at()).
 */

import { haptic } from './haptics.js';
import { openExternalUrl } from './platform.js';
import { parseArticleUrl as parseArticleUrlFor, isAllowedImageUrl } from './newsRules.js';
import { relativeTime } from './feed-time.js';   // W-92 (DI-W92-7/9): the ONE shared vocabulary; re-exported under its old name below (newstest imports it from here)

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
/** The ESPN article hosts (option A, the contingency, and any item that carries no host list of its own). */
export const ESPN_LINK_HOSTS = Object.freeze(['espn.com', '.espn.com']);
export function parseArticleUrl(raw, hosts = ESPN_LINK_HOSTS) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > URL_MAX) return null;
  return parseArticleUrlFor(raw, Array.isArray(hosts) && hosts.length ? hosts : ESPN_LINK_HOSTS);   // D1: ONE validator, newsRules.js (S-C1 vectors unchanged)
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
const ESPN_IMAGE_LIST = Object.freeze([...NEWS_IMAGE_HOSTS.exact, ...NEWS_IMAGE_HOSTS.suffixes]);
export function isAllowedNewsImageUrl(raw, hosts = null) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > IMAGE_URL_MAX) return null;
  return isAllowedImageUrl(raw, Array.isArray(hosts) ? hosts : ESPN_IMAGE_LIST);           // D1: ONE validator, newsRules.js; a server item passes its source's pinned hosts
}

// ─── relative time ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * "Just now" / "12m ago" / "2h ago" / "Yesterday" / "3d ago" / "Oct 9". W-92 (2026-10-17): this was a private helper; it is now js/feed-time.js's,
 * shared with every Home card, and re-exported here under the same name. Past a week it says the date instead of "8d ago".
 */
export { relativeTime };

// ─── the card ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * One NewsItem -> one card's HTML, or '' on bad input. See the contract in the header. The metadata row (publisher, time, sport chip) is
 * ALWAYS present: the publisher is never conditional (UN-344). No image -> no <img> and no placeholder box; the headline moves to the top.
 */
/** "Oct 6" in the viewer's zone — the "Updated" caption's date (DI-672). */
function shortDate(iso) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try { return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return ''; }
}
/** A publisher's later update counts only when it is at least this long after publication (DI-672). */
export const NEWS_UPDATED_MIN_MS = 30 * 60 * 1000;
/** "Also from CBS Sports and Yahoo Sports" (names from the registry, never feed text). */
export function alsoFromLabel(names) {
  const list = (Array.isArray(names) ? names : []).map((n) => cleanText(n, SOURCE_MAX)).filter(Boolean);
  const uniq = list.filter((n, i) => list.indexOf(n) === i).slice(0, 4);
  if (!uniq.length) return '';
  if (uniq.length === 1) return `Also from ${uniq[0]}`;
  return `Also from ${uniq.slice(0, -1).join(', ')} and ${uniq[uniq.length - 1]}`;
}
/** The byline: `{via} via {publisher}` or `{publisher}` (the via is the guarded Yahoo credit; it was checked server-side AND by the transport). */
export function bylineOf(item) {
  const publisher = cleanText(item && (item.publisher || item.source), SOURCE_MAX);
  const via = cleanText(item && item.via, 60);
  return via && publisher && via.toLowerCase() !== publisher.toLowerCase() ? `${via} via ${publisher}` : publisher;
}

/** The shared card body (one sink for the news card and the storyline card). `tag` is the DI-663 storyline tag or ''. */
function newsCardHTML(item, { tag = '' } = {}) {
  if (!item || typeof item !== 'object') return '';
  const id = cleanText(item.id, ID_MAX);
  const headline = cleanText(item.headline, HEADLINE_MAX);
  const byline = bylineOf(item);
  if (!id || !headline || !byline) return '';
  const sportLabel = Object.prototype.hasOwnProperty.call(SPORT_CHIP_LABELS, item.sport) ? SPORT_CHIP_LABELS[item.sport] : '';
  if (!sportLabel) return '';
  const pubMs = Date.parse(item.publishedAt);
  if (!Number.isFinite(pubMs)) return '';
  const reason = !tag && NEWS_CARD_REASONS.indexOf(item.reason) >= 0 ? item.reason : '';
  const allowedSrc = isAllowedNewsImageUrl(item.imageUrl, Array.isArray(item.imageHosts) ? item.imageHosts : null);
  const imageSrc = allowedSrc && !failedPictures.has(allowedSrc) ? allowedSrc : null;   // W-105 (DI-W105-4): a picture that already failed here is not drawn again (no box, no request, no jump on a repaint)
  const when = relativeTime(item.publishedAt);
  const updMs = Date.parse(item.updatedAt);
  const updated = Number.isFinite(updMs) && updMs - pubMs >= NEWS_UPDATED_MIN_MS ? shortDate(item.updatedAt) : '';
  const tagText = cleanText(tag, 120);
  const pill = reason ? `<span class="national-tv-badge news-card__reason">${esc(reason)}</span>` : '';
  const eyebrow = tagText ? `<p class="news-card__eyebrow"><span class="news-card__kind">Storyline</span><span aria-hidden="true">·</span><span class="news-card__tag">${esc(tagText)}</span></p>` : '';
  const image = imageSrc ? `<img class="news-card__image" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${esc(imageSrc)}">` : '';
  const upd = updated ? `<span aria-hidden="true">·</span><span class="news-card__updated">Updated ${esc(updated)}</span>` : '';
  const also = alsoFromLabel(Array.isArray(item.alsoFrom) ? item.alsoFrom.map((a) => a && a.publisher) : []);
  const label = `${tagText ? `Storyline, ${tagText}: ` : ''}${headline}, ${byline}`;
  const main = `${image}<div class="news-card__body">${eyebrow}${pill}<p class="news-card__headline">${esc(headline)}</p><div class="news-card__meta"><span class="news-card__pub">${esc(byline)}</span><span aria-hidden="true">·</span><span class="news-card__time" data-feed-time="${esc(new Date(pubMs).toISOString())}">${esc(when)}</span>${upd}<span class="national-tv-badge news-card__sport">${esc(sportLabel)}</span></div></div>`;
  const kindClass = tagText ? ' news-card--storyline' : '';
  if (!also) return `<div class="card news-card${kindClass}" data-news-id="${esc(id)}" role="link" tabindex="0" aria-label="${esc(label)}">${main}</div>`;
  // DI-672: the grouped card. The link role moves to the main block, so the "Also from" button is a SIBLING (never a control nested inside a link).
  return `<div class="card news-card news-card--grouped${kindClass}"><div class="news-card__main" data-news-id="${esc(id)}" role="link" tabindex="0" aria-label="${esc(label)}">${main}</div><div class="news-card__also-row"><button type="button" class="news-card__also" data-news-also="${esc(id)}">${esc(also)}</button></div></div>`;
}

export function renderNewsCard(item) {
  try { return newsCardHTML(item); } catch { return ''; }
}

/** DI-663 / C18: a storyline card (a news item with its deterministic tag). '' when the tag is missing — the item is then an ordinary News card, drawn by renderNewsCard. */
export function renderStorylineCard(item) {
  try {
    const tag = item && item.storyline && typeof item.storyline.tag === 'string' ? item.storyline.tag : '';
    return tag ? newsCardHTML(item, { tag }) : '';
  } catch { return ''; }
}

/**
 * DI-672 / C10: the "Also from" sheet's body — one 44 pt row per OTHER source in the group: its headline, publisher, time and "Open". Built HERE through `esc()` so
 * the caller never interpolates a publisher or headline. Each row carries only the alternate's id; a tap resolves it against the group the sheet was opened for.
 */
export function renderAlsoFromSheet(item) {
  try {
    const rows = (item && Array.isArray(item.alsoFrom) ? item.alsoFrom : []).slice(0, 8).map((a) => {
      if (!a || typeof a !== 'object') return '';
      const aid = cleanText(a.id, ID_MAX), h = cleanText(a.headline, HEADLINE_MAX), pub = bylineOf(a);
      if (!aid || !h || !pub || !Number.isFinite(Date.parse(a.publishedAt))) return '';
      return `<li class="news-also-item"><button type="button" class="news-also-open" data-news-also-open="${esc(aid)}" aria-label="${esc(h)}, ${esc(pub)}, open"><span class="news-also-text"><span class="news-also-headline">${esc(h)}</span><span class="news-also-meta">${esc(pub)} · ${esc(relativeTime(a.publishedAt))}</span></span><span class="news-also-go">Open</span></button></li>`;
    }).filter(Boolean);
    if (!rows.length) return '';
    return '<ul class="news-also-list">' + rows.join('') + '</ul>';   // every row was built above through esc(); joined, never re-interpolated
  } catch { return ''; }
}

/**
 * DI-672: the "Also from" sheet's ONE dispatcher. A tap on a row resolves the row's alternate id against `item.alsoFrom` (the group the sheet was opened for), re-validates
 * that alternate's url against ITS OWN source's link hosts (an ESPN-contingency alternate, which carries none, against ESPN's), and hands `onOpen` only the validated
 * href. An unknown id or a refused url opens nothing. Returns an unbind. app.js mounts the sheet shell and calls this; tests call it with a real DOM.
 */
export function bindAlsoFromSheetEvents(rootEl, item, { onOpen } = {}) {
  if (!rootEl || typeof rootEl.addEventListener !== 'function') return () => {};
  const open = typeof onOpen === 'function' ? onOpen : openNewsArticle;
  const onClick = (e) => {
    const t = e && e.target;
    const row = t && typeof t.closest === 'function' ? t.closest('[data-news-also-open]') : null;
    if (!row || typeof row.getAttribute !== 'function') return;
    const id = row.getAttribute('data-news-also-open');
    const alt = item && Array.isArray(item.alsoFrom) ? item.alsoFrom.find((a) => a && a.id === id) : null;
    if (!alt) return;
    const href = parseArticleUrl(alt.url, Array.isArray(alt.linkHosts) ? alt.linkHosts : ESPN_LINK_HOSTS);
    if (!href) return;                                        // fails closed
    try { open(href, alt); } catch (err) { console.warn('[news] opening an article failed', err && err.name); }
  };
  rootEl.addEventListener('click', onClick);
  return () => { try { rootEl.removeEventListener('click', onClick); } catch { /* detached */ } };
}

// ─── the tap ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The default opener: a light haptic (native only — haptic() is a no-op on web), then the in-app browser / a new tab, given ONLY a validated href. */
export function openNewsArticle(href) {
  haptic('light');
  return openExternalUrl(href);
}

// ─── the picture's life on the card (W-105, DI-W105-4, 2026-10-17) ─────────────────────────────────────────────────────────────────────
// Design Philosophy, Loading States: "Avoid sudden layout jumps. Content popping into existence." The 16:9 box is reserved in the markup (no jump when the picture
// arrives). Inside a root the binder has bound (`.news-images-bound`, set below; css/styles.css keys the hidden-until-loaded rule on it, so a root WITHOUT the binder shows
// the picture exactly as before), a picture is hidden until it loads and then fades in over --motion-fast; one that was already loaded when its node arrived (a cached
// file, a Home repaint: Home rewrites its root on most paints) is shown at once with no transition, so a repaint never re-fades it. A picture that FAILS leaves a clean
// text card: where it sits decides how (the picture's own box against the viewport, measured before anything changes) — wholly below the viewport: removed at once (no
// one sees it); on screen: its space collapses over --motion-large while it fades (instant under Reduce Motion); wholly above the viewport: removed at once and the
// optional `onPictureRemoved({ removedPx, aboveViewport })` hook lets Home scroll by the removed height so the reader's place holds (Home's #page-home has
// overflow-anchor:none: nothing else does it). A card that is partly on screen with its picture already scrolled above the top counts as ABOVE: removing that picture by
// collapsing it would slide the text the reader is looking at (the DI's "Fails if: the visible content jumps when a picture above the reader fails").
// A picture that failed is remembered for this page's life (URLs only, in memory, capped, never persisted; nothing is remembered while the device is offline), and the
// card is drawn without it from then on, so Home's next repaint does not bring the empty box back. No timer, no new import, no inline handler, no style attribute in markup.
const PICTURE_CLASS = 'news-card__image';
const PICTURES_BOUND_CLASS = 'news-images-bound';
const PICTURE_LOADED = 'is-loaded';
const PICTURE_INSTANT = 'news-card__image--instant';
const PICTURE_COLLAPSING = 'news-card__image--collapsing';
const PICTURE_FAILED = 'news-card__image--failed';
export const FAILED_PICTURES_CAP = 200;
const failedPictures = new Set();
/** Test seam: the remembered failures (read-only use in tests; `clear()` between cases). */
export const _failedPicturesForTest = failedPictures;

const hasClass = (el, c) => !!el && !!el.classList && typeof el.classList.contains === 'function' && el.classList.contains(c);
const isPicture = (el) => hasClass(el, PICTURE_CLASS);
function addClass(el, ...names) { try { names.forEach((n) => el.classList.add(n)); } catch { /* a detached or fake node */ } }
function removeClass(el, ...names) { try { names.forEach((n) => el.classList.remove(n)); } catch { /* a detached or fake node */ } }

function rememberFailedPicture(img) {
  try {
    if (typeof navigator !== 'undefined' && navigator && navigator.onLine === false) return;   // offline: every picture fails; none of them is broken
    const src = typeof img.getAttribute === 'function' ? img.getAttribute('src') : null;
    if (typeof src === 'string' && src && failedPictures.size < FAILED_PICTURES_CAP) failedPictures.add(src);
  } catch { /* nothing to remember */ }
}
function prefersLessMotion() {
  try { return typeof window !== 'undefined' && !!window && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}
/** The picture's box against the viewport, measured BEFORE anything changes: its height, and whether it lies wholly above or wholly below what the reader can see. */
function pictureGeometry(img) {
  let r = null;
  try { r = typeof img.getBoundingClientRect === 'function' ? img.getBoundingClientRect() : null; } catch { r = null; }
  const height = r && Number.isFinite(r.height) && r.height > 0 ? r.height : 0;
  let viewH = NaN;
  try { const doc = img.ownerDocument; const win = doc && doc.defaultView ? doc.defaultView : (typeof window !== 'undefined' ? window : null); viewH = win ? Number(win.innerHeight) : NaN; } catch { viewH = NaN; }
  const above = !!r && height > 0 && r.bottom <= 0;
  const below = !!r && height > 0 && Number.isFinite(viewH) && r.top >= viewH;
  return { height, above, below };
}
/** A picture that was already loaded when its node arrived shows at once, with no fade (a repaint never re-fades a loaded picture). */
function showLoadedPictures(node) {
  if (!node || typeof node.querySelectorAll !== 'function') return;
  let list = [];
  try { list = Array.from(node.querySelectorAll('img.news-card__image')); if (isPicture(node)) list.push(node); } catch { list = []; }
  for (const img of list) {
    if (hasClass(img, PICTURE_LOADED) || hasClass(img, PICTURE_FAILED) || hasClass(img, PICTURE_COLLAPSING)) continue;
    if (img.complete === true && Number(img.naturalWidth) > 0) addClass(img, PICTURE_INSTANT, PICTURE_LOADED);
  }
}

const bound = new WeakMap();

/**
 * Delegated click / keyboard handling for every news card under `rootEl` (Home's container). A tap resolves the card's `data-news-id`
 * against the CURRENT items (`items` is an array or a function returning one, so a refresh needs no rebind), re-validates that item's url
 * with parseArticleUrl, and hands `onOpen` the validated href — never a URL read from the DOM, never `item.url` itself. A card whose id is
 * unknown, or whose url fails, opens nothing. Binding the same root twice REPLACES the earlier binding (no double open). Returns an unbind.
 * W-105 (DI-W105-4): the binder also owns the picture's life (see above) — `load` / `error` capture listeners, `.news-images-bound` on the root, an observer that shows an
 * already-loaded picture at once after a repaint — and the optional `onPictureRemoved({ removedPx, aboveViewport })` hook, called once per removed picture (a throw is logged,
 * never thrown into the binder). Unbinding removes all of it, the root class included.
 */
export function bindNewsCardEvents(rootEl, { items, onOpen, onAlsoFrom, onPictureRemoved } = {}) {
  if (!rootEl || typeof rootEl.addEventListener !== 'function') return () => {};
  if (bound.has(rootEl)) { try { bound.get(rootEl)(); } catch { /* detached */ } }
  const getItems = typeof items === 'function' ? items : () => items;
  const open = typeof onOpen === 'function' ? onOpen : openNewsArticle;
  const alsoFrom = typeof onAlsoFrom === 'function' ? onAlsoFrom : null;
  const cardOf = (e) => {
    const t = e && e.target;
    if (!t || typeof t.closest !== 'function') return null;
    return t.closest('[data-news-id]') || t.closest('.news-card');                        // the card itself, or a grouped card's main block (DI-672)
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
    const href = parseArticleUrl(item.url, Array.isArray(item.linkHosts) ? item.linkHosts : ESPN_LINK_HOSTS);   // re-validated at tap time against the item's OWN source hosts (S-C1)
    if (!href) return;                                        // fails closed: nothing opens
    try { open(href); } catch (err) { console.warn('[news] opening an article failed', err && err.name); }
  }
  const onClick = (e) => {
    const t = e && e.target;
    const btn = t && typeof t.closest === 'function' ? t.closest('[data-news-also]') : null;
    const alsoId = btn && btn.dataset && typeof btn.dataset.newsAlso === 'string' ? btn.dataset.newsAlso
      : btn && typeof btn.getAttribute === 'function' ? btn.getAttribute('data-news-also') : null;
    if (alsoId) {                                                  // DI-672: the "Also from" row opens its sheet, never the article
      if (!alsoFrom) return;
      const id = alsoId;
      let list = [];
      try { list = getItems(); } catch { return; }
      const item = (Array.isArray(list) ? list : []).find((i) => i && i.id === id);
      if (item && Array.isArray(item.alsoFrom) && item.alsoFrom.length) { try { haptic('light'); alsoFrom(item); } catch (err) { console.warn('[news] the also-from sheet failed', err && err.name); } }
      return;
    }
    activate(cardOf(e));
  };
  const onKeydown = (e) => {
    if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
    const card = cardOf(e);
    if (!card) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    activate(card);
  };
  // W-105 (DI-W105-4): the picture's life. Load and error events do not bubble, so both are delegated CAPTURE listeners (an inline onload / onerror is forbidden).
  const pictureRemoved = (removedPx, aboveViewport) => {
    if (typeof onPictureRemoved !== 'function') return;
    try { onPictureRemoved({ removedPx, aboveViewport }); } catch (err) { console.warn('[news] the picture-removed hook failed', err && err.name); }
  };
  const onImageLoad = (e) => {
    const img = e && e.target;
    if (isPicture(img) && !hasClass(img, PICTURE_FAILED) && !hasClass(img, PICTURE_COLLAPSING)) addClass(img, PICTURE_LOADED);   // the 150 ms fade (css), or nothing to do for an instant one
  };
  // A picture that fails to load is REMOVED, never left as a grey box or a broken-image glyph, and never with a visible jump.
  const onImageError = (e) => {
    const img = e && e.target;
    if (!isPicture(img) || hasClass(img, PICTURE_FAILED) || hasClass(img, PICTURE_COLLAPSING)) return;
    rememberFailedPicture(img);
    const { height, above, below } = pictureGeometry(img);
    if (above || below || height === 0 || prefersLessMotion()) {
      addClass(img, PICTURE_FAILED);                                         // at once: nobody sees it go (below / above), or Reduce Motion
      pictureRemoved(height, above);                                         // above the viewport: Home scrolls up by exactly this, so the reader's place holds
      return;
    }
    // on screen: the space collapses over --motion-large while it fades, then the picture is gone (a clean text card)
    const done = (ev) => {
      if (ev && ev.target !== img) return;
      try { img.removeEventListener('transitionend', done); } catch { /* detached */ }
      removeClass(img, PICTURE_COLLAPSING);
      addClass(img, PICTURE_FAILED);
      try { img.style.height = ''; } catch { /* detached */ }
    };
    try {
      img.style.height = `${height}px`;                                      // the measured start, so the height can animate (the box is otherwise aspect-ratio sized)
      void img.offsetHeight;                                                 // commit the start before the change
      addClass(img, PICTURE_COLLAPSING);
      img.style.height = '0px';
      img.addEventListener('transitionend', done);
    } catch { done(); }
    pictureRemoved(height, false);
  };
  addClass(rootEl, PICTURES_BOUND_CLASS);
  showLoadedPictures(rootEl);
  let observer = null;
  try {
    if (typeof MutationObserver === 'function') {
      observer = new MutationObserver((records) => { for (const r of records) for (const n of Array.from(r.addedNodes || [])) { if (n && n.nodeType === 1) showLoadedPictures(n); } });
      observer.observe(rootEl, { childList: true, subtree: true });            // a microtask after the repaint's write, before the next frame
    }
  } catch { observer = null; }                                               // not a Node (the unit-test fakes): the load listener alone
  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('keydown', onKeydown);
  rootEl.addEventListener('load', onImageLoad, true);
  rootEl.addEventListener('error', onImageError, true);
  const unbind = () => {
    try { rootEl.removeEventListener('click', onClick); rootEl.removeEventListener('keydown', onKeydown); rootEl.removeEventListener('load', onImageLoad, true); rootEl.removeEventListener('error', onImageError, true); } catch { /* detached */ }
    try { if (observer) observer.disconnect(); } catch { /* detached */ }
    removeClass(rootEl, PICTURES_BOUND_CLASS);                               // a root without the binder shows its pictures as before (progressive enhancement)
    bound.delete(rootEl);
  };
  bound.set(rootEl, unbind);
  return unbind;
}
