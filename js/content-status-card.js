/**
 * js/content-status-card.js — THE CONTENT AND AI STATUS CARD FOR THE OPERATOR (D1 Lane C, DI-637 / UN-482 / PF-482).
 * ===========================================================================================================================================
 * Admin → Data (`ADMIN_CARD_TAB['content-ai-status'] = 'data'`), platform admins, READ-ONLY. PURE RENDER AND NORMALIZATION: no DOM, no network, no clock (the caller passes `nowMs`).
 * `js/app.js` fetches the one RPC `content_status()`, owns the cache, the bottom sheet, the pull-to-refresh leg and the retry; this module owns what is SHOWN.
 *
 * THE CONTRACT WITH `content_status()` (migration 0056 builds the function; this is the shape it must return, and `normalizeContentStatus` is the reader):
 *
 *   { v: 1, generatedAt: ISO,
 *     rows: [ { id, group, label, state, code?, lastGoodAt?, items24h?, spendUsd?, capUsd?, searches24h?, fallbackUsed24h?, posted?, suppressed?, runs?: [ { at, ok, code? } ] } ] }
 *
 *   group  news | sports | feed | routes | lookup | callouts | scan  (the six lines of DI-637, news one row per publisher)
 *   state  ok | unverified | auto_disabled | blocked | warning | error | off
 *   code   one of the FIXED codes below (the plain meaning is shown; an unrecognised code is shown as "An unrecognised status code", never as the raw text)
 *
 * AGGREGATES AND FIXED CODES ONLY. The RPC returns counts, times, dollar totals and the codes in `STATUS_CODE_MEANINGS`: never a secret, a prompt, a quote, a pick, or another
 * league's content (leagues are counted, not named). This module therefore renders no free text from the server at all: a label is the publisher's registry name or one of this
 * file's own group labels, escaped through `escHtml`; a code is looked up, never interpolated.
 *
 * FAILURE IS SHOWN, NOT SOFTENED. A red row sorts first and says what stopped. A feed that failed, a lookup that is unavailable and a cap that was reached are not "N/A".
 * Empty state (nothing has run): "Nothing has run yet. Switches are off until you turn them on."
 */

/** The fixed code list, with the plain meaning of each, from DI-637. Amended 2026-10-14 (the coordinator's ruling): each of 0053's seven further feed codes
 *  (identity_drift, timeout, too_large, doctype_refused, no_items, scan_budget, fetch_error) has its own line instead of reading as "The feed returned an error";
 *  each says what happened and, where it needs Drew, what to do. static.check fails if 0053 gains a code with no line here. */
export const STATUS_CODE_MEANINGS = Object.freeze({
  robots_disallowed: 'The publisher’s robots.txt doesn’t allow us.',
  robots_unknown: 'We couldn’t read the publisher’s robots.txt yet, so we haven’t fetched. We’ll try again.',
  http_status: 'The feed returned an error.',
  redirect_refused: 'The feed moved to another site. Disabled for safety.',
  not_feed: 'The address no longer returns a feed.',
  stale_feed: 'No new items for 90 days.',
  no_usable_items: 'Items arrived but none were usable.',
  rate_limited: 'The publisher asked us to slow down.',
  partner_key_required: 'The publisher needs a partner key we don’t have.',
  access_not_connected: 'No access has been set up for this service.',
  budget_cap_reached: 'The monthly cap was reached.',
  model_unavailable: 'The chosen model isn’t available.',
  provider_error: 'The AI service returned an error.',
  identity_drift: 'The feed now looks like a different site. Disabled until you check the source.',
  timeout: 'The feed took too long to answer. We’ll try again.',
  too_large: 'The feed was too large to read. If this keeps happening, check the source.',
  doctype_refused: 'The feed declares its own XML entities. Refused for safety; check the source.',
  no_items: 'The feed answered with no items.',
  scan_budget: 'Reading the feed ran past its time limit. If it shows Auto-disabled, check the source and re-enable it.',
  fetch_error: 'We couldn’t reach the feed. We’ll try again.',
});
export const UNKNOWN_CODE_MEANING = 'An unrecognised status code.';

export const STATUS_COPY = Object.freeze({
  TITLE: 'Content & AI status',
  EMPTY: 'Nothing has run yet. Switches are off until you turn them on.',
  UNREADABLE: 'Couldn’t load the status.',
  NOT_INSTALLED: 'The status service isn’t installed on this project yet.',
  RETRY: 'Retry',
  REFRESH: 'Refresh',
  NEAR_CAP: 'Nearing the monthly cap.',
  PICTURES_NONE: 'No story has had a picture in 24 hours.',   // D2 DI-1097 (W-111): the warning state's second sentence
  groups: Object.freeze({
    news: 'News publishers', sports: 'Sports data', feed: 'Home-card synthesis', routes: 'SCRIBE routes', lookup: 'Source lookup', callouts: 'Deadline callouts', scan: 'Moment scan',
  }),
  states: Object.freeze({
    ok: 'OK', unverified: 'Unverified', auto_disabled: 'Auto-disabled', blocked: 'Blocked', warning: 'Warning', error: 'Error', off: 'Off',
  }),
});

const GROUP_ORDER = Object.freeze(['news', 'sports', 'feed', 'routes', 'lookup', 'callouts', 'scan']);
const STATE_SEVERITY = Object.freeze({ error: 0, blocked: 1, auto_disabled: 2, warning: 3, unverified: 4, off: 5, ok: 6 });
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
// Markup is composed by joining parts (never by interpolating a finished fragment into a template), so the XSS sweep (xsstest [9c-1g]) can prove every `${}` left is escaped.
const join = (parts) => parts.join('');
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : null; };
const isoOrNull = (v) => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/**
 * Read `content_status()`'s answer defensively (CONVENTIONS #7). Returns `{ ok:false }` for anything that is not the documented object, else `{ ok:true, generatedAt, rows }` with every
 * row clamped: a state outside the closed set becomes `unverified`, a group outside it is dropped, a code outside the fixed list is kept only as the marker `'unknown'`, numbers are
 * finite and non-negative, `runs` keeps the last five. A server that adds a field changes nothing here.
 */
export function normalizeContentStatus(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.v !== 1 || !Array.isArray(raw.rows)) return { ok: false, generatedAt: null, rows: [] };
  const rows = [];
  for (const r of raw.rows) {
    if (!r || typeof r !== 'object' || !own(STATUS_COPY.groups, r.group)) continue;
    const state = own(STATE_SEVERITY, r.state) ? r.state : 'unverified';
    let code = null;
    if (r.code !== undefined && r.code !== null && r.code !== '') code = own(STATUS_CODE_MEANINGS, r.code) ? r.code : 'unknown';
    const spend = num(r.spendUsd), cap = num(r.capUsd);
    rows.push({
      id: typeof r.id === 'string' ? r.id.slice(0, 80) : `${r.group}:${rows.length}`,
      group: r.group, label: typeof r.label === 'string' && r.label ? r.label.slice(0, 60) : STATUS_COPY.groups[r.group], state, code,
      lastGoodAt: isoOrNull(r.lastGoodAt), items24h: num(r.items24h), spendUsd: spend, capUsd: cap, searches24h: num(r.searches24h),
      fallbackUsed24h: num(r.fallbackUsed24h), posted: num(r.posted), suppressed: num(r.suppressed),
      runs: (Array.isArray(r.runs) ? r.runs : []).slice(0, 5).map((x) => ({
        at: isoOrNull(x && x.at), ok: !!(x && x.ok === true), code: x && own(STATUS_CODE_MEANINGS, x.code) ? x.code : (x && x.code ? 'unknown' : null),
      })),
      // At 80% of a share the card warns (DI-636); at 100% the server already says `budget_cap_reached`.
      nearCap: spend !== null && cap !== null && cap > 0 && spend >= cap * 0.8 && spend < cap,
    });
  }
  rows.sort((a, b) => (STATE_SEVERITY[a.state] - STATE_SEVERITY[b.state]) || (GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group)) || a.label.localeCompare(b.label));
  return { ok: true, generatedAt: isoOrNull(raw.generatedAt), rows };
}

/** "3 min ago" / "2 h ago" / "4 d ago" / "never", from an ISO time and the caller's clock. */
export function agoWord(iso, nowMs) {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t) || !Number.isFinite(nowMs)) return 'never';
  const m = Math.max(0, Math.round((nowMs - t) / 60000));
  if (m < 1) return 'just now';
  if (m < 90) return `${m} min ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`;
  return `${Math.round(m / 1440)} d ago`;
}

// ─── D2 DI-1097 (W-111, RG-362's observability gap): "Pictures: 31 of 40 stories in the last 24 hours." ─────────────────────────────────────────────────────────────────────
// One quiet line under the news rows (platform admins' read-only card, Admin > Data; never Home). The count is made ON THE DEVICE from a read of `news_articles` (id, image_url,
// published_at, the newest 500; RLS already narrows it to stories that are not hidden and whose source is on the registry's enabled list): m = stories published in the last 24 hours, n = those
// with a picture address. content_status() is unchanged and there is no migration. A read that fails or returns nothing, or a window with no story, shows NO line: never an error, never a made-up count.
export const PICTURES_WINDOW_MS = 24 * 60 * 60 * 1000;
/** From this many stories in the window, none of them pictured is a warning rather than a number. */
export const PICTURES_WARN_MIN_STORIES = 10;
/** `{ n, m }` from the rows of the read, or null when there is nothing honest to say. Pure; `nowMs` is the caller's clock. A story from the future (clock skew) or older than 24 hours is not in the window. */
export function countNewsPictures(rows, nowMs) {
  if (!Array.isArray(rows) || !Number.isFinite(nowMs)) return null;
  let m = 0, n = 0;
  for (const r of rows) {
    if (!r || typeof r !== 'object') continue;
    const t = typeof r.published_at === 'string' ? Date.parse(r.published_at) : NaN;
    if (!Number.isFinite(t) || t > nowMs || nowMs - t > PICTURES_WINDOW_MS) continue;
    m++;
    if (typeof r.image_url === 'string' && r.image_url.indexOf('https://') === 0) n++;
  }
  return m > 0 ? { n, m } : null;
}
/** The line's HTML, or '' for nothing to say. Numbers cross `numHtml`, text crosses `escHtml`; nothing from a story is displayed. */
export function picturesLineHTML(counts, { escHtml, numHtml: numHtmlIn } = {}) {
  if (!counts || !Number.isFinite(counts.n) || !Number.isFinite(counts.m) || counts.m <= 0) return '';
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const numHtml = typeof numHtmlIn === 'function' ? numHtmlIn : (v) => String(Number(v));   // named numHtml so the XSS sweep reads every number as coerced (xsstest [9c-1g])
  const warn = counts.m >= PICTURES_WARN_MIN_STORIES && counts.n === 0;
  return join([
    `<p class="content-status-pictures${warn ? ' content-status-pictures--warn' : ''}" id="content-status-pictures" data-pictures-n="${numHtml(counts.n)}" data-pictures-m="${numHtml(counts.m)}">`,
    warn ? join(['Pictures: ', numHtml(counts.n), ' of ', numHtml(counts.m), '. ', esc(STATUS_COPY.PICTURES_NONE)]) : join(['Pictures: ', numHtml(counts.n), ' of ', numHtml(counts.m), counts.m === 1 ? ' story' : ' stories', ' in the last 24 hours.']),
    '</p>',
  ]);
}

/** The meaning shown for a code (never the raw string). */
export function codeMeaning(code) { return code ? (own(STATUS_CODE_MEANINGS, code) ? STATUS_CODE_MEANINGS[code] : UNKNOWN_CODE_MEANING) : ''; }

function detailLine(r, nowMs) {
  const parts = [];
  if (r.group === 'news' || r.group === 'sports') {
    parts.push(`Last good fetch ${agoWord(r.lastGoodAt, nowMs)}`);
    if (r.items24h !== null) parts.push(`${r.items24h} items kept in 24 h`);
  } else if (r.group === 'feed') {
    if (r.posted !== null) parts.push(`${r.posted} cards made`);
    if (r.suppressed !== null) parts.push(`${r.suppressed} plain-facts only`);
    if (r.spendUsd !== null && r.capUsd !== null) parts.push(`$${r.spendUsd.toFixed(2)} of $${r.capUsd.toFixed(2)}`);
    parts.push(`last run ${agoWord(r.lastGoodAt, nowMs)}`);
  } else if (r.group === 'routes') {
    if (r.fallbackUsed24h !== null) parts.push(`Fallback used ${r.fallbackUsed24h}× in 24 h`);
    if (r.spendUsd !== null && r.capUsd !== null) parts.push(`$${r.spendUsd.toFixed(2)} of $${r.capUsd.toFixed(2)} this month`);
  } else if (r.group === 'lookup') {
    if (r.searches24h !== null) parts.push(`${r.searches24h} searches in 24 h`);
    if (r.spendUsd !== null && r.capUsd !== null) parts.push(`$${r.spendUsd.toFixed(2)} of $${r.capUsd.toFixed(2)} this month`);
  } else {
    parts.push(`Last run ${agoWord(r.lastGoodAt, nowMs)}`);
    if (r.posted !== null) parts.push(`${r.posted} posted`);
    if (r.suppressed !== null) parts.push(`${r.suppressed} suppressed`);
  }
  return parts.join(' · ');
}

const PILL = Object.freeze({
  ok: 'badge-open', unverified: 'badge-draft', off: 'badge-draft',
});

/** One row's HTML (a 44 pt button; the tap opens the run sheet). */
export function renderStatusRow(r, { escHtml, nowMs, icon } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const ic = typeof icon === 'function' ? icon : () => '';
  const red = r.state === 'error' || r.state === 'blocked' || r.state === 'auto_disabled';
  const amber = r.state === 'warning' || r.nearCap;
  const pillCls = own(PILL, r.state) ? PILL[r.state] : '';
  const pillClass = red ? ' admin-ai-pill-loss' : (amber ? ' admin-ai-pill-amber' : '');
  const meaning = r.code ? codeMeaning(r.code) : (r.nearCap ? STATUS_COPY.NEAR_CAP : '');
  const aria = `${r.label}, ${STATUS_COPY.states[r.state]}${meaning ? `, ${meaning}` : ''}, double-tap for the last runs`;
  const chevron = join(['<span class="cc-row-chevron" aria-hidden="true">', ic('chevronRight'), '</span>']);
  return join([
    `<button type="button" class="control-center-row scribe-status-row${red ? ' is-red' : ''}" data-status-row="${esc(r.id)}" aria-label="${esc(aria)}">`,
    '<span class="cc-row-label scribe-route-main">',
    `<span>${esc(r.label)}</span>`,
    `<span class="cc-row-secondary">${esc(STATUS_COPY.groups[r.group])} · ${esc(detailLine(r, nowMs))}</span>`,
    meaning ? `<span class="cc-row-secondary${red ? ' admin-ai-loss' : ''}">${esc(meaning)}</span>` : '',
    '</span>',
    `<span class="badge ${pillCls}${pillClass}">${esc(STATUS_COPY.states[r.state])}</span>`,
    chevron,
    '</button>',
  ]);
}

/**
 * The card body. `state`: { data (the RAW rpc answer or null), loaded, loading, error ('unavailable' | 'failed' | null), attempted }, `nowMs` the caller's clock.
 * Loading with nothing cached is a skeleton (no spinner); a refresh keeps the cached rows and repaints when the answer lands.
 */
export function renderContentStatusBody({ state = {}, escHtml, icon, nowMs = Date.now(), numHtml } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const norm = state.loaded ? normalizeContentStatus(state.data) : { ok: false, rows: [] };
  if (state.error && !state.loaded) {
    const msg = state.error === 'unavailable' ? STATUS_COPY.NOT_INSTALLED : STATUS_COPY.UNREADABLE;
    return `<p class="text-xs mb-sm admin-ai-loss" role="alert">${esc(msg)}</p>
      <button type="button" class="btn btn-ghost btn-sm" id="content-status-retry-btn">${esc(STATUS_COPY.RETRY)}</button>`;
  }
  if (!state.loaded) {
    const skel = [0, 1, 2].map(() => `
      <div class="scribe-route-row scribe-route-row--skeleton" aria-hidden="true">
        <div class="scribe-route-main"><div class="league-card-skeleton-line league-card-skeleton-line-wide"></div><div class="league-card-skeleton-line league-card-skeleton-line-narrow"></div></div>
      </div>`).join('');
    return `<div class="scribe-route-list" aria-busy="true">${skel}</div>`;
  }
  if (!norm.ok) {
    return `<p class="text-xs mb-sm admin-ai-loss" role="alert">${esc(STATUS_COPY.UNREADABLE)}</p>
      <button type="button" class="btn btn-ghost btn-sm" id="content-status-retry-btn">${esc(STATUS_COPY.RETRY)}</button>`;
  }
  if (!norm.rows.length) return `<p class="text-muted text-sm">${esc(STATUS_COPY.EMPTY)}</p>`;
  const stale = state.error ? `<p class="text-xs mb-sm admin-ai-loss" role="alert">${esc(STATUS_COPY.UNREADABLE)}</p>` : '';
  // D2 DI-1097: the pictures line sits straight under the LAST news row (rows are sorted by severity, so the news rows are not always together); no news row, or nothing honest to say, no line
  const pics = picturesLineHTML(countNewsPictures(state.pictureRows, nowMs), { escHtml: esc, numHtml });
  let lastNews = -1;
  norm.rows.forEach((r, i) => { if (r.group === 'news') lastNews = i; });
  const rowsHtml = norm.rows.map((r, i) => renderStatusRow(r, { escHtml: esc, nowMs, icon }) + (pics && i === lastNews ? pics : '')).join('');
  return `${stale}<div class="scribe-route-list" id="content-status-list">${rowsHtml}</div>
    <div class="scribe-route-actions"><button type="button" class="btn btn-ghost btn-sm" id="content-status-refresh-btn">${esc(STATUS_COPY.REFRESH)}</button></div>`;
}

/** The sheet body for one row: its last five runs and the plain meaning of its error code. */
export function renderStatusSheetBody(row, { escHtml, nowMs = Date.now() } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  if (!row) return '';
  const meaning = row.code ? `<p class="text-sm mb-sm${row.state === 'error' || row.state === 'blocked' ? ' admin-ai-loss' : ''}">${esc(codeMeaning(row.code))}</p>` : '';
  const runs = row.runs.length
    ? row.runs.map((x) => `<li class="text-sm">${esc(agoWord(x.at, nowMs))} · ${esc(x.ok ? 'OK' : (x.code ? codeMeaning(x.code) : 'Failed'))}</li>`).join('')
    : `<li class="text-sm text-muted">${esc('No runs recorded yet.')}</li>`;
  return `<div class="scribe-status-sheet">${meaning}<div class="form-label">${esc('Last runs')}</div><ul class="scribe-status-runs">${runs}</ul></div>`;
}

/**
 * The month's spend per class for the routing card's second line ("$0.84 this month"), read from the same `content_status()` answer: a `routes`-group row with the id `route:<class>`
 * and a `spendUsd`. Returns `null` when the status has not loaded or carries no such row: the routing card then shows no figure rather than a zero.
 * @returns {Record<string, number>|null}
 */
export function spendByClassFromStatus(raw) {
  const norm = normalizeContentStatus(raw);
  if (!norm.ok) return null;
  const out = {};
  for (const r of norm.rows) {
    if (r.group !== 'routes' || !/^route:[a-z]+$/.test(r.id) || r.spendUsd === null) continue;
    out[r.id.slice(6)] = r.spendUsd;
  }
  return Object.keys(out).length ? out : null;
}
