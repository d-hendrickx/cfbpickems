/**
 * js/source-chips.js — THE SOURCE CHIPS UNDER A SCRIBE ANSWER (D1 Lane C, DI-641, security C5 / F-1 / UN-466 / PF-466).
 * ===========================================================================================================================================
 * A current-sports answer from @SCRIBE carries `meta.sources = [{ label, url, publishedAt|null }]` (at most three), written by the `scribe-ask` Edge Function's service-role insert.
 * `meta` IS MEMBER-WRITABLE: `chat_append_system` lets any member post a row with `author:'scribe'` and free-form `meta` (it reserves only `meta.test` and one `meta.kind`), so
 * NOTHING on the row's `author` or `meta` says who minted it. THIS MODULE IS THE CLIENT HALF OF THE BOUNDARY, and it trusts nothing the row says about itself:
 *
 *   1. THE GATE (security F-1): chips are drawn ONLY for a row the SERVER minted, i.e. the TOP-LEVEL `relayed === false`: migration 0045's member-unwritable column
 *      (`relayed = emitted_by is not null`), the same rule Home applies to a SCRIBE post (hometest C15). Anything else draws NOTHING: `true` (a member relayed it), absent
 *      (0045 has not landed: fail CLOSED, so until it does no chip is drawn), null, the string "false", 0, and a forged `meta.relayed` (meta is not the column). `author === 'scribe'`
 *      and "not withdrawn" are still required on top of it, never instead of it;
 *   2. every source is RE-PARSED: a string url of at most 500 characters, `https:`, no userinfo, no port, a dotted host of letters, digits, dots and hyphens, no control character, no
 *      backslash; a source that fails is dropped, not repaired. THE LABEL IS NEVER THE ROW'S: it is derived from the validated host (`js/source-labels.js`: a known publisher's name,
 *      else the host without `www.`), so a chip cannot say "ESPN" over a page that is not on espn.com;
 *   3. the label and the date are escaped by the ONE quote-complete `esc()` the caller passes, in double-quoted attributes, and NO `href` is ever built from `meta`: a chip is a `<button>`
 *      carrying the message id and an INDEX; a tap resolves that index against the in-memory message and opens the WHATWG-serialized url through `openExternalUrl` (the `newsCard.js` pattern);
 *   4. a date the source did not give reads "date unknown"; a malformed date does the same. Dates are fixed month names ("Oct 3"), never a locale call.
 *
 * PURE except for the one function that opens a page. No DOM, no network, no clock.
 */

import { openExternalUrl } from './platform.js';
import { sourceLabelForUrl } from './source-labels.js';

export const SOURCE_CHIPS_MAX = 3;
const URL_MAX = 500;
const HOST_CHARS = /^[a-z0-9.-]+$/;
const MONTHS = Object.freeze(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
const MONTHS_LONG = Object.freeze(['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']);

/** The WHATWG-serialized https url, or null. Same floor as `parseArticleUrl` (js/newsCard.js) without its ESPN-only host rule: a source may be any publisher. */
export function parseSourceUrl(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > URL_MAX) return null;
  if (/[\s\u0000-\u001F\u007F\\]/.test(raw)) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (!HOST_CHARS.test(host) || !host.includes('.') || /^[0-9.]+$/.test(host)) return null;
  return u.href;
}

/** "Oct 3" for a `YYYY-MM-DD` (or full ISO) date, or null. */
export function chipDate(iso, { long = false } = {}) {
  const m = typeof iso === 'string' ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  const mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${(long ? MONTHS_LONG : MONTHS)[mo - 1]} ${d}`;
}

/**
 * The chips a message may draw: `[{ label, href, date, longDate }]`, at most three, every one re-validated. `m` is the client message (`rowToMessage()`'s shape: `author`, `meta`, `deleted`).
 */
export function validChipSources(m) {
  // the gate (F-1): author scribe AND server-minted (`relayed` is exactly the boolean false, top level) AND not withdrawn. `=== false`, so absent / null / "false" / 0 all fail closed.
  if (!m || m.author !== 'scribe' || m.relayed !== false || m.deleted) return [];
  const raw = m.meta && typeof m.meta === 'object' ? m.meta.sources : null;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const s of raw) {
    if (out.length >= SOURCE_CHIPS_MAX) break;
    if (!s || typeof s !== 'object') continue;
    const href = parseSourceUrl(s.url);
    if (!href) continue;
    // the label comes from the validated host, never from `s.label`
    out.push({ label: sourceLabelForUrl(href) || new URL(href).hostname.replace(/^www\./, ''), href, date: chipDate(s.publishedAt), longDate: chipDate(s.publishedAt, { long: true }) });
  }
  return out;
}

/** The validated href for chip `index` of message `m`, or null: what a tap opens. Re-validates from scratch. */
export function sourceHrefAt(m, index) {
  const list = validChipSources(m);
  // only a whole number, or the decimal digits of one (a dataset value): Number('') and Number(null) are 0 and Number([1]) is 1, and none of those is a chip index
  const i = typeof index === 'number' ? index : (typeof index === 'string' && /^[0-9]{1,2}$/.test(index) ? Number(index) : NaN);
  return Number.isInteger(i) && i >= 0 && i < list.length ? list[i].href : null;
}

const join = (parts) => parts.join('');

/** Quote-complete escape, used only when a caller passes no escaper (the app always does: chat-ui passes its own `esc`). Never a bare String(): an unescaped fallback would be a hole. */
function escapeText(v) {
  return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The chip row HTML, or '' when the message draws none. `esc` is the caller's quote-complete escaper (js/chat-ui.js `esc`). 44 pt tall (CSS), wraps with an 8 pt gap, and names itself for
 * VoiceOver: "Source: ESPN, October 3. Opens in browser."
 */
export function sourceChipsHTML(m, escIn) {
  const list = validChipSources(m);
  if (!list.length) return '';
  const esc = typeof escIn === 'function' ? escIn : escapeText;
  const chips = list.map((s, i) => {
    const date = s.date || 'date unknown';
    const aria = `Source: ${s.label}, ${s.longDate || 'date unknown'}. Opens in browser.`;
    return `<button type="button" class="chat-source-chip" data-source-msg="${esc(m.id)}" data-source-idx="${Number(i)}" aria-label="${esc(aria)}">${esc(s.label)} · ${esc(date)}</button>`;
  });
  return join(['<div class="chat-source-row" role="group" aria-label="Sources">', join(chips), '</div>']);
}

/** A tap: open the validated href for chip `index` of `m`. Returns true when an open was attempted. */
export function openSourceChip(m, index) {
  const href = sourceHrefAt(m, index);
  return href ? openExternalUrl(href) : false;
}
