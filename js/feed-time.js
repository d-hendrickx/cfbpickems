/**
 * CFB Pickems — feed-time.js (W-92, DI-W92-7, release v0.30.1, 2026-10-17)
 * ========================================================================
 * The ONE vocabulary for "when did this happen" on Home: every event card, the content cards and the news / storyline cards say it the
 * same way (Drew, "approve M-61", decision 4: the news cards' wording). Pure text only: no DOM, no storage, no timer, no markup — the two
 * renderers that draw a time (js/home.js cardHTML and js/content-card.js renderContentCard) own their own <time> template, and the static
 * guard in feedtimetest pins that nothing else does.
 *
 *   written   "Just now" · "12m ago" · "2h ago" · "Yesterday" · "3d ago" · "Oct 9" (· "Oct 9, 2025" in another year)
 *   spoken    "just now" · "12 minutes ago" · "2 hours ago" · "yesterday" · "3 days ago" · "October 9" (singular "1 minute" / "1 hour")
 *   buckets   under 60 s · under 60 min · under 24 h · 24 to 48 h · 2 to 6 whole days · 7 days or more (a date in the VIEWER's zone)
 * A future instant (clock skew) reads "Just now". UNKNOWN BEATS WRONG: a missing, unparsable or epoch-sentinel instant (anything before
 * 2000-01-01, which includes the 1970 value feed-cards' isoAt() writes for an invalid time) is not a known instant: nothing is rendered,
 * and the card is not dropped.
 *
 * The date is formatted by an injected `formatDate(ms, { month: 'short'|'long', now })` so it is the viewer's day (the player's time-zone
 * preference, CONVENTIONS #19); `makeDateFormatter(iana)` builds one. With none injected the device's zone is used (newsCard's default).
 * iOS 15.0 safe (no Object.hasOwn, no .at()).
 */

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
/** Before this, an instant is a sentinel or a bug, never an event this league had (2000-01-01T00:00:00Z). */
export const EARLIEST_KNOWN_MS = Date.UTC(2000, 0, 1);

function toMs(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string' || !v) return NaN;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : NaN;
}

/** Is this a real, known event instant? False for a missing, unparsable or epoch-sentinel value (anything before 2000). */
export function isKnownInstant(v) {
  const ms = toMs(v);
  return Number.isFinite(ms) && ms >= EARLIEST_KNOWN_MS;
}

function yearIn(ms, timeZone) {
  try { return new Date(ms).toLocaleDateString('en-US', timeZone ? { year: 'numeric', timeZone } : { year: 'numeric' }); } catch { return String(new Date(ms).getFullYear()); }
}

/**
 * A date formatter in one zone (an IANA name, or null for the device's): "Oct 9" / "October 9", with ", 2025" only when the year (in that
 * zone) is not the current one.
 */
export function makeDateFormatter(timeZone = null) {
  return (ms, { month = 'short', now = Date.now() } = {}) => {
    const opts = { month: month === 'long' ? 'long' : 'short', day: 'numeric' };
    if (yearIn(ms, timeZone) !== yearIn(now, timeZone)) opts.year = 'numeric';
    try { return new Date(ms).toLocaleDateString('en-US', timeZone ? { ...opts, timeZone } : opts); }
    catch { try { return new Date(ms).toLocaleDateString('en-US', opts); } catch { return ''; } }
  };
}
const DEVICE_DATE = makeDateFormatter(null);

/** Both forms at once, or null for an unknown instant. `iso` is the normalised instant (what a <time datetime> carries). */
function parts(v, now, formatDate) {
  if (!isKnownInstant(v)) return null;
  const ms = toMs(v);
  const at = Number.isFinite(Number(now)) ? Number(now) : Date.now();
  const diff = Math.max(0, at - ms);                                         // a future instant (clock skew) is "just now", never a negative
  const fmt = typeof formatDate === 'function' ? formatDate : DEVICE_DATE;
  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  let written, spoken;
  if (diff < MIN) { written = 'Just now'; spoken = 'just now'; }
  else if (diff < HOUR) { const n = Math.floor(diff / MIN); written = `${n}m ago`; spoken = plural(n, 'minute'); }
  else if (diff < DAY) { const n = Math.floor(diff / HOUR); written = `${n}h ago`; spoken = plural(n, 'hour'); }
  else if (diff < 2 * DAY) { written = 'Yesterday'; spoken = 'yesterday'; }
  else if (diff < 7 * DAY) { const n = Math.floor(diff / DAY); written = `${n}d ago`; spoken = plural(n, 'day'); }
  else {
    let short = '', long = '';
    try { short = String(fmt(ms, { month: 'short', now: at }) || ''); long = String(fmt(ms, { month: 'long', now: at }) || ''); } catch { short = ''; long = ''; }
    if (!short) return null;                                                 // a formatter that cannot say the date says nothing (unknown beats wrong)
    written = short; spoken = long || short;
  }
  return { iso: new Date(ms).toISOString(), written, spoken };
}

/** "Just now" / "12m ago" / "2h ago" / "Yesterday" / "3d ago" / "Oct 9" — or '' for an unknown instant. */
export function relativeTime(v, now = Date.now(), { formatDate } = {}) {
  const p = parts(v, now, formatDate);
  return p ? p.written : '';
}

/** What VoiceOver says: "just now" / "12 minutes ago" / "2 hours ago" / "yesterday" / "3 days ago" / "October 9" — or ''. */
export function spokenAgo(v, now = Date.now(), { formatDate } = {}) {
  const p = parts(v, now, formatDate);
  return p ? p.spoken : '';
}

/**
 * Everything a renderer needs for one time: `{ iso, written, spoken }`, or null (render no time). `opened: true` is the picks tally's
 * prefix — the only prefixed card, so a living count is never read as "this count is 3 days old": "Opened 3d ago" / "opened 3 days ago".
 */
export function timeLabels(v, now = Date.now(), { formatDate, opened = false } = {}) {
  const p = parts(v, now, formatDate);
  if (!p) return null;
  if (!opened) return p;
  const lower = (s) => (s === 'Just now' || s === 'Yesterday' ? s.toLowerCase() : s);
  return { iso: p.iso, written: `Opened ${lower(p.written)}`, spoken: `opened ${p.spoken}` };
}

/** A tappable card's VoiceOver label: "{prefix} {spoken time}. Opens details." — the prefix (already a sentence) is trimmed by the caller. */
export function tapLabel(prefix, spoken) {
  const p = String(prefix ?? '').trim();
  return spoken ? `${p} ${spoken}. Opens details.` : `${p} Opens details.`;
}
