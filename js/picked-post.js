/**
 * CFB Pickems — js/picked-post.js (Deployment 2, thread 101826-D2, lane 3; DI-1046…1050 "picked-post embeds", Drew D-117, with the security pre-build read's R1–R10 and the coordinator's
 * option B, 2026-10-19)
 * ==========================================================================================================================================================================
 * A member pastes a public X or Reddit POST link into the Locker Room; the room bubble shows it as a card. A PURE LEAF: its one import is js/icons.js (the outbound arrow); no storage, no
 * network, no member data (embedtest pins all three).
 *
 *   matchPickedPost(token)     R3: the link token (as chat-ui's bodyHTML hands it: HTML-ESCAPED) unescaped, parsed with WHATWG URL, and accepted only when it is https, carries no
 *                              userinfo and no port, its hostname is EXACTLY one of X_HOSTS / REDDIT_HOSTS, and its path matches an ANCHORED post shape. The URL is then REBUILT on the
 *                              canonical host from the captured pieces only (query and fragment dropped by allow-list): the card shows, opens and loads ONLY the rebuilt URL.
 *   pickedPostCardHTML(...)    DI-1048: the static card (no image, no author text, no post text — nothing a fetch would be needed for), every field escaped here; it carries the message
 *                              id and the link's position, never a URL to follow (the tap resolves both against the stored message: newsCard's id-resolved pattern).
 *   embedSrcFor(match)         option B (coordinator, 2026-10-19): the iframe's `src` is the PLATFORM'S OWN embed page for the rebuilt post (no oEmbed, no srcdoc, nothing parsed here).
 *   buildEmbedFrame(doc, m)    R6: THE ONE place an iframe is created — by DOM calls, never an HTML string; `sandbox` is the pinned EMBED_SANDBOX ('allow-scripts' only: never
 *                              the same-origin token, never popups, top navigation, forms or modals) set BEFORE `src`, `referrerPolicy` 'no-referrer'.
 *   EMBED_WEB_ENABLED          R7: "Show post" is OFF in this release; a later delta security read turns it on. The native shell never shows it (chat-ui gates on isNativeShell()).
 */
import { ICONS } from './icons.js';

export const EMBED_WEB_ENABLED = false;
export const EMBED_SANDBOX = 'allow-scripts';
export const PICKED_POST_COPY = Object.freeze({
  x: Object.freeze({ kind: 'X post', caption: 'Opens on X.' }),
  reddit: Object.freeze({ kind: 'Reddit post', caption: 'Opens on Reddit.' }),
  show: 'Show post',
});
export const X_HOSTS = Object.freeze(['x.com', 'www.x.com', 'mobile.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
export const REDDIT_HOSTS = Object.freeze(['reddit.com', 'www.reddit.com', 'old.reddit.com', 'new.reddit.com']);
const X_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,20})\/?$/;
const REDDIT_PATH = /^\/r\/([A-Za-z0-9_]{2,21})\/comments\/([a-z0-9]{1,10})(\/[^/]*)?\/?$/;
const TOKEN_MAX = 2048;
// control characters, zero-width and bidi overrides, and a backslash (WHATWG reads it as a slash in an https URL): a token carrying any of them is never a card
const UNSAFE_RE = /[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩\\]/;

/** The reverse of chat-ui's esc() (the five entities it writes), so the matcher sees what the member typed. */
export function unescapeHtml(s) {
  return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
}

/**
 * @param {string} token  a link token from the message body, HTML-escaped (bodyHTML's split) unless `escaped` is false
 * @returns {null | { platform:'x'|'reddit', url:string, where:string, id:string, handle?:string, sub?:string }}
 */
export function matchPickedPost(token, { escaped = true } = {}) {
  if (typeof token !== 'string' || !token) return null;
  const raw = escaped ? unescapeHtml(token) : token;
  if (raw.length > TOKEN_MAX || UNSAFE_RE.test(raw)) return null;
  let u = null;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username !== '' || u.password !== '' || u.port !== '') return null;
  const host = u.hostname;
  if (X_HOSTS.includes(host)) {
    const m = X_PATH.exec(u.pathname);
    if (!m) return null;
    return Object.freeze({ platform: 'x', handle: m[1], id: m[2], url: `https://x.com/${m[1]}/status/${m[2]}`, where: `x.com/${m[1]}` });
  }
  if (REDDIT_HOSTS.includes(host)) {
    const m = REDDIT_PATH.exec(u.pathname);
    if (!m) return null;
    return Object.freeze({ platform: 'reddit', sub: m[1], id: m[2], url: `https://www.reddit.com/r/${m[1]}/comments/${m[2]}/`, where: `r/${m[1]}` });
  }
  return null;
}

/** Option B: the platform's own embed page for the rebuilt post (fixed templates over the captured, already-validated pieces; X with dnt=true). null for anything else. */
export function embedSrcFor(match) {
  if (!match || typeof match !== 'object') return null;
  if (match.platform === 'x' && /^\d{1,20}$/.test(String(match.id))) {
    const u = new URL('https://platform.twitter.com/embed/Tweet.html');
    u.searchParams.set('id', String(match.id));
    u.searchParams.set('dnt', 'true');
    return u.toString();
  }
  if (match.platform === 'reddit' && /^[A-Za-z0-9_]{2,21}$/.test(String(match.sub)) && /^[a-z0-9]{1,10}$/.test(String(match.id))) {
    return `https://embed.reddit.com/r/${match.sub}/comments/${match.id}/`;
  }
  return null;
}

/**
 * DI-1048: the static card. `esc` is the caller's (chat-ui's) quote-complete escaper — required; `mid` the message id and `n` the link's position in it (the tap resolves both against the
 * stored message); `showButton` adds "Show post" and the empty frame host (web, and only while EMBED_WEB_ENABLED: the caller decides). The arrow is the icon family's constant.
 */
export function pickedPostCardHTML(match, { esc, mid = '', n = 0, showButton = false } = {}) {
  if (typeof esc !== 'function') throw new TypeError('pickedPostCardHTML() requires the real esc');
  if (!match || (match.platform !== 'x' && match.platform !== 'reddit')) return '';
  const c = PICKED_POST_COPY[match.platform];
  const pos = String(Math.max(0, Math.floor(Number(n) || 0)));
  const label = `${c.kind}, ${match.where}. ${c.caption}`;
  const open = `<button type="button" class="chat-post-open" data-post-open="${esc(mid)}" data-post-n="${esc(pos)}" aria-label="${esc(label)}">`
    + `<span class="chat-post-tx"><span class="chat-post-kind">${esc(c.kind)}</span><span class="chat-post-where">${esc(match.where)}</span><span class="chat-post-cap">${esc(c.caption)}</span></span>`
    + `<span class="chat-post-out" aria-hidden="true">${ICONS.arrowUpRight}</span></button>`;
  const show = showButton
    ? `<button type="button" class="chat-post-show" data-post-show="${esc(mid)}" data-post-n="${esc(pos)}">${esc(PICKED_POST_COPY.show)}</button><span class="chat-post-frame" data-post-frame hidden></span>`
    : '';
  return `<span class="chat-post-card" data-post-card>${open}${show}</span>`;
}

/** R6: THE ONE iframe of the feature — DOM calls only; the sandbox (the pinned constant) is set before the source, so the very first navigation is sandboxed. null when there is no source. */
export function buildEmbedFrame(doc, match) {
  const src = embedSrcFor(match);
  if (!src || !doc || typeof doc.createElement !== 'function') return null;
  const frame = doc.createElement('iframe');
  frame.setAttribute('sandbox', EMBED_SANDBOX);
  frame.referrerPolicy = 'no-referrer';
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('loading', 'lazy');
  frame.setAttribute('title', match.platform === 'x' ? PICKED_POST_COPY.x.kind : PICKED_POST_COPY.reddit.kind);
  frame.className = 'chat-post-iframe';
  frame.src = src;
  return frame;
}
