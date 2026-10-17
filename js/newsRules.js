/**
 * CFB Pickems — js/newsRules.js (News: the SHARED PURE RULES — option A 2026-10-01, widened for the D1 multi-publisher collector 2026-10-08)
 * ==========================================================================================================================================
 * ZERO IMPORTS, ZERO side effects, no DOM, no fetch, no storage. The one place the text-hygiene and URL rules live, so the server collector
 * (`supabase/functions/_shared/news-rules.mjs` imports this file by relative path, the `scores-refresh` precedent) and the client read the SAME rules
 * (SP-58 DI-480 6.1; D1 Lane C DI-670…674).
 *
 * WHAT IS HERE (each used on BOTH sides unless marked):
 *   stripControlAndBidi             text hygiene (SC-N7)
 *   parseArticleUrl(raw, hosts)     S-C1, the ONE article-link validator, per-source host list; applied at ingest, at client normalize and at tap (DI-480 6.5, SC-N4)
 *   isHostAllowed / hostPatternOk   exact hosts by default; a leading-dot suffix pattern needs >= 2 labels and is never a multi-tenant platform (SC-N4)
 *   LINK_HOST_DENYLIST              redirectors and feed proxies: never an article host, checked BEFORE the allow list (SC-N4)
 *   IMAGE_HOST_DENYLIST             ad / tracking hosts: never a picture host, whatever a row pins (DI-477 3.5)
 *   SHARED_IMAGE_CDNS               EMPTY in D1: every picture host is pinned per source; the list may never hold a fetch-any-URL proxy (SC-N5)
 *   isAllowedImageUrl(raw, hosts)   S-C6: https, <= 300 chars, no port / userinfo / IP literal, not denylisted, host on the source's pinned list
 *   hasSecretShapedQueryKey(url)    SC-N3(d): a query KEY containing key|token|secret|auth|sig|pass|pwd|session|credential|hmac drops the link
 *   canonicalizeArticleUrl(url)     host lower-case, fragment and tracking parameters removed, trailing slash removed (DI-480 6.6)
 *   dedupeKeyOf(headline)           NFKD fold -> cyrb53, 14 hex chars, null under 20 normalized chars (DI-480 6.6)
 *   headlineTokens / jaccard        DI-672's cross-publisher grouping of duplicate coverage
 *   guardVia(text, publisher)       DI-481 7.5: the guarded Yahoo "via" credit, or null
 *
 * ── NO BETTING FILTER (Drew, 2026-10-01) ─────────────────────────────────────────────────────────────────────────────
 * SD-6 ("drop betting news") was reversed by Drew on 2026-10-01: "I want betting news" / "ok to remove betting filter". Betting headlines are kept and
 * ranked like any other (newstest [BET-KEEP]). DI-670 confirms it for D1 ("CBS and NBC items that are sportsbook promos are kept on purpose").
 *
 * REGEX DISCIPLINE (SC-N7(d)): every regular expression literal in this file is in REGEX_REGISTRY below with a reviewed id; none has a nested or overlapping
 * quantifier, a backreference or a lookaround, and none is ever built from data (newsrulestest pins all three).
 *
 * iOS 15.0 safe (no Object.hasOwn, no .at(), no replaceAll).
 */

// ─── text hygiene ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Headline / description hygiene (SP-58 6.3, SC-N7): line breaks and tabs become one space, then C0 and C1 controls, DEL, the
 * zero-width and bidi-override characters (U+200B-200F, U+202A-202E, U+2066-2069), the line / paragraph separators and the BOM are
 * REMOVED, then whitespace is collapsed and trimmed. Output is plain text that is escaped again at render. Never throws.
 */
// Code-point ranges stripped from text (hex, so no invisible character ever has to be typed into this source): C0 controls, DEL + C1 controls, the
// zero-width and direction marks U+200B-U+200F, the bidi embeddings / overrides U+202A-U+202E, the bidi isolates U+2066-U+2069 and the BOM U+FEFF.
const STRIP_RANGES = [[0x00, 0x1F], [0x7F, 0x9F], [0x200B, 0x200F], [0x202A, 0x202E], [0x2066, 0x2069], [0xFEFF, 0xFEFF]];
const isStripped = (code) => { for (let i = 0; i < STRIP_RANGES.length; i++) { if (code >= STRIP_RANGES[i][0] && code <= STRIP_RANGES[i][1]) return true; } return false; };

export function stripControlAndBidi(s) {
  const input = String(s === null || s === undefined ? '' : s);
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0x09 || code === 0x0A || code === 0x0D || code === 0x2028 || code === 0x2029) { out += ' '; continue; }   // a line break or tab is a space, never a join
    if (isStripped(code)) continue;
    out += input.charAt(i);
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ─── hosts (SC-N4) ────────────────────────────────────────────────────────────────────────────────────────────────────

/** A parsed hostname may contain only these. The WHATWG parser accepts a quote and other odd characters in a host; one pattern refuses them everywhere. */
const HOST_CHARS = /^[a-z0-9.-]+$/;
/** Redirectors and feed proxies: an article link on one of these is never followed, stored or opened (SC-N4). Checked BEFORE any allow list. */
export const LINK_HOST_DENYLIST = Object.freeze(['feedproxy.google.com', 'feeds.feedburner.com', 'news.google.com', 'www.google.com', 'bit.ly', 't.co', 'trib.al',
  'ow.ly', 'buff.ly', 'dlvr.it', 'lnkd.in', 'l.facebook.com']);
/** Ad and tracking hosts: never a picture host, whatever a row pins (DI-477 3.5; tuned with evidence). */
export const IMAGE_HOST_DENYLIST = Object.freeze(['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com', 'pixel.quantserve.com',
  'sb.scorecardresearch.com', 'bat.bing.com', 'www.facebook.com', 'b.scorecardresearch.com', 'pagead2.googlesyndication.com']);
/**
 * Picture hosts shared by every source. EMPTY in D1 (SC-N5): every D1 picture host is pinned on its own source row after Drew's one-time union review, so nothing here
 * widens any source. The list may NEVER hold a fetch-any-URL image proxy (Photon i0/i1/i2.wp.com, images.weserv.nl, Cloudinary fetch, imgproxy, *.googleusercontent.com)
 * or a multi-tenant user-upload host; newsrulestest asserts that. An entry, if one is ever added, is `{ host, why, seenIn: [source ids] }`.
 */
export const SHARED_IMAGE_CDNS = Object.freeze([]);
/** Fetch-any-URL proxies and user-upload hosts that may never appear in SHARED_IMAGE_CDNS or as a pinned picture host (SC-N5). */
export const FORBIDDEN_IMAGE_PROXIES = Object.freeze(['i0.wp.com', 'i1.wp.com', 'i2.wp.com', 'images.weserv.nl', 'res.cloudinary.com', 'googleusercontent.com']);
/** Multi-tenant platforms on which a leading-dot SUFFIX PATTERN is refused (an exact host on one is still allowed, e.g. a school's own CloudFront host) (SC-N4). */
export const MULTI_TENANT_SUFFIXES = Object.freeze(['.cloudfront.net', '.amazonaws.com', '.brightspotcdn.com', '.wordpress.com', '.wp.com', '.blogspot.com',
  '.substack.com', '.github.io', '.netlify.app', '.vercel.app', '.herokuapp.com', '.appspot.com', '.azureedge.net', '.tumblr.com', '.wixsite.com', '.squarespace.com']);

const asArray = (v) => (Array.isArray(v) ? v : []);
const isIpLiteral = (host) => host.charAt(0) === '[' || /^[0-9.]+$/.test(host);

/**
 * Is a host-list element well formed? An exact lower-case hostname (letters, digits, dots, hyphens; not an IP literal), or a REVIEWED leading-dot suffix pattern with at
 * least two labels after the dot that is not a multi-tenant platform (SC-N4). The SQL helper `news_hosts_ok(text[])` (migration 0053) applies the same rule;
 * newsregistrytest pins the two lists equal.
 */
export function hostPatternOk(h) {
  if (typeof h !== 'string' || !h || h.length > 100 || h !== h.toLowerCase() || !HOST_CHARS.test(h)) return false;
  if (h.charAt(0) === '.') {
    const rest = h.slice(1);
    if (rest.split('.').filter(Boolean).length < 2 || rest.indexOf('..') >= 0) return false;
    return MULTI_TENANT_SUFFIXES.indexOf(h) < 0;
  }
  if (h.indexOf('..') >= 0 || h.charAt(h.length - 1) === '.' || isIpLiteral(h)) return false;
  return true;
}

/** Is `host` (already lower-case) on `list`? An exact element matches itself; a leading-dot element matches the domain and its subdomains. A malformed element matches nothing. */
export function isHostAllowed(host, list) {
  if (typeof host !== 'string' || !host) return false;
  for (const h of asArray(list)) {
    if (!hostPatternOk(h)) continue;
    if (h.charAt(0) === '.') { if (host === h.slice(1) || host.endsWith(h)) return true; }
    else if (host === h) return true;
  }
  return false;
}

/** Is `host` on a deny list? Exact or as a subdomain of a listed domain. */
function hostDenied(host, deny) {
  for (const d of deny) { if (host === d || host.endsWith('.' + d)) return true; }
  return false;
}

// ─── the ONE article-link validator (S-C1, DI-480 6.5) ─────────────────────────────────────────────────────────────────

const SECRET_KEY_PARTS = Object.freeze(['key', 'token', 'secret', 'auth', 'sig', 'pass', 'pwd', 'session', 'credential', 'hmac']);

/** SC-N3(d): true when any query KEY contains a secret-shaped part (case-insensitive substring). An unparseable URL reads as true (fail closed). */
export function hasSecretShapedQueryKey(href) {
  let u;
  try { u = new URL(href); } catch { return true; }
  for (const k of u.searchParams.keys()) {
    const key = k.toLowerCase();
    for (const part of SECRET_KEY_PARTS) { if (key.indexOf(part) >= 0) return true; }
  }
  return false;
}

/**
 * Returns the WHATWG-SERIALIZED, already-validated `href` of an article link, or null. Refused: a non-string, anything over 600 characters, whitespace or control
 * characters, ANY backslash (the Foundation-versus-WHATWG differential behind S-C1 is refused, never out-guessed), a non-https scheme, a port, userinfo, a host with any
 * character outside [a-z0-9.-], an IP literal, a host on LINK_HOST_DENYLIST (checked FIRST), and any host not on `allowedHosts` (exact, or a reviewed suffix pattern).
 * What is returned is `u.href`, never `raw`. Applied at ingest (the source's `link_hosts`), at client normalize and at tap (the same list, carried on the item).
 */
export function parseArticleUrl(raw, allowedHosts) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 600) return null;
  if (/[\s\u0000-\u001F\u007F\\]/.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.port) return null;
  if (u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!HOST_CHARS.test(host) || isIpLiteral(host)) return null;
  if (hostDenied(host, LINK_HOST_DENYLIST)) return null;
  if (!isHostAllowed(host, allowedHosts)) return null;
  return u.href;
}

/** Tracking parameters removed from every article URL (DI-480 6.4). `utm_*` by prefix; the rest by exact name. Other query parameters are kept (some sites need `?id=`). */
export const TRACKING_PARAMS = Object.freeze(['fbclid', 'gclid', 'mc_cid', 'mc_eid', 'igshid', 'ref_src']);

/**
 * The canonical form of an already-validated article URL (DI-480 6.6): host lower-case, fragment removed, tracking parameters removed, trailing slash removed (except the
 * root). Returns null for anything that does not parse. The canonical URL is the article's identity (`news_articles.url` is unique on it).
 */
export function canonicalizeArticleUrl(href) {
  let u;
  try { u = new URL(href); } catch { return null; }
  u.hash = '';
  u.hostname = u.hostname.toLowerCase();
  const drop = [];
  u.searchParams.forEach((_, k) => { const lk = k.toLowerCase(); if (lk.indexOf('utm_') === 0 || TRACKING_PARAMS.indexOf(lk) >= 0) drop.push(k); });
  for (const k of drop) u.searchParams.delete(k);
  if (u.pathname.length > 1 && u.pathname.charAt(u.pathname.length - 1) === '/') u.pathname = u.pathname.slice(0, -1);
  let s = u.href;
  if (u.search === '' && s.charAt(s.length - 1) === '?') s = s.slice(0, -1);
  return s;
}

// ─── pictures (S-C6, SC-N5) ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The validated https picture URL (WHATWG-serialized) or null: https only, at most 300 characters, no port, no userinfo, not an IP literal, not on IMAGE_HOST_DENYLIST,
 * not a forbidden proxy, and a host on the SOURCE'S pinned `imageHosts` (or SHARED_IMAGE_CDNS, empty in D1). Applied at ingest, at client normalize and at render.
 */
export function isAllowedImageUrl(raw, imageHosts) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 300) return null;
  if (/[\s\u0000-\u001F\u007F\\]/.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!HOST_CHARS.test(host) || isIpLiteral(host)) return null;
  if (hostDenied(host, IMAGE_HOST_DENYLIST) || hostDenied(host, FORBIDDEN_IMAGE_PROXIES)) return null;
  const shared = SHARED_IMAGE_CDNS.map((e) => e && e.host).filter(Boolean);
  if (!isHostAllowed(host, imageHosts) && !isHostAllowed(host, shared)) return null;
  return u.href;
}

// ─── dedupe identity (DI-480 6.6) and duplicate grouping (DI-672) ────────────────────────────────────────────────────────

/** NFKD, combining marks stripped, lower-case, `&` as "and", every non-alphanumeric run one space, trimmed. */
function foldHeadline(s) {
  return String(s === null || s === undefined ? '' : s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** cyrb53: a small synchronous non-cryptographic 53-bit hash (this file has no imports and the key is not a security boundary). */
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The duplicate-title key: cyrb53 of the folded headline as 14 hex characters, or null when the fold is under 20 characters (too generic: "Game recap"). */
export function dedupeKeyOf(headline) {
  const f = foldHeadline(headline);
  if (f.length < 20) return null;
  return cyrb53(f).toString(16).padStart(14, '0').slice(-14);
}

/**
 * DI-672's grouping tokens: the folded headline with a trailing outlet credit removed (" - ESPN", " | CBS Sports", "(via Yahoo Sports)"), as a SET of words. The outlet
 * names come from the caller (the registry's publisher names), never from feed text.
 */
export function headlineTokens(headline, outletNames = []) {
  let f = foldHeadline(headline);
  for (const name of asArray(outletNames)) {
    const n = foldHeadline(name);
    if (n && f.length > n.length && f.slice(-n.length) === n && f.charAt(f.length - n.length - 1) === ' ') f = f.slice(0, -n.length).trim();
  }
  const set = new Set();
  for (const w of f.split(' ')) { if (w) set.add(w); }
  return set;
}

/** |A ∩ B| / |A ∪ B| over two token sets; 0 when either is empty. */
export function jaccard(a, b) {
  if (!a || !b || !a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) { if (b.has(t)) inter++; }
  return inter / (a.size + b.size - inter);
}

// ─── the guarded "via" (DI-481 7.5) ───────────────────────────────────────────────────────────────────────────────────

/** Voices a credit may never claim (case-insensitive containment). */
export const VIA_BANNED_VOICES = Object.freeze(['scribe', 'munera', 'irb', "pick'em", 'pickem', 'commissioner', 'admin', 'official']);

/**
 * Yahoo's `<source>` text (the original outlet) kept as `via` only if it is ASCII letters, digits, spaces and `. , ' & -`, 2 to 60 characters, contains none of the
 * banned voices, and is not the source's own publisher (case-insensitive); otherwise null (the card then says only the publisher). Non-ASCII is refused (homoglyphs, Q9).
 */
export function guardVia(text, publisher) {
  const v = stripControlAndBidi(text);
  if (v.length < 2 || v.length > 60) return null;
  if (!/^[A-Za-z0-9 .,'&-]+$/.test(v)) return null;
  const low = v.toLowerCase();
  for (const b of VIA_BANNED_VOICES) { if (low.indexOf(b) >= 0) return null; }
  if (typeof publisher === 'string' && low === publisher.trim().toLowerCase()) return null;
  return v;
}

/**
 * SC-N7(d): EVERY regular-expression literal in this file, by reviewed id. newsrulestest extracts the literals from the source and fails on one that is not
 * listed here, or on a forbidden construct (nested / overlapping quantifier, backreference, lookaround).
 */
export const REGEX_REGISTRY = Object.freeze({
  'whitespace-run': /\s+/g,
  'host-chars': /^[a-z0-9.-]+$/,
  'ip-literal': /^[0-9.]+$/,
  'url-forbidden-chars': /[\s\u0000-\u001F\u007F\\]/,
  'combining-marks': /[\u0300-\u036f]/g,
  'ampersand': /&/g,
  'fold-non-alnum': /[^a-z0-9]+/g,
  'via-charset': /^[A-Za-z0-9 .,'&-]+$/,
});
