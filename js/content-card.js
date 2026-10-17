/**
 * CFB Pickems — js/content-card.js (D1 Lane C, DI-660…662, DI-664…666, DI-669; UN-471, 472, 474, 478; 2026-10-08)
 * ==================================================================================================================
 * THE HOME CONTENT CARDS (matchup preview, player to watch, spotlight), their DETAIL (a pushed screen, DI-669), the "Talk about it" one-liner (DI-666) and the Spotlight
 * share text (DI-665). Everything a player reads here passes through ONE local, quote-complete escaper at the sink, in markup whose every attribute is double-quoted.
 *
 * THE SHELL IS THE FEED'S. A content card is `<article class="card feed-card feed-card--tap content-card ...">` with the feed card's eyebrow (one icon from the family:
 * sportFootball / playersGroup / trophy, the private reason pill, the chevron), title, body and caption: nothing new in colour or weight. The detail reuses the card
 * detail's `cd-*` sections (Lane B's look) without importing its builders.
 *
 * WHAT A CARD SAYS, honestly (DI-660):
 *   ok          the model's summary, up to two "What to watch" lines and one "Talk about it" line, captioned "SCRIBE · from public sources · as of Oct 8" (SCRIBE is named
 *               only when a model wrote it);
 *   structured  the card-level facts, captioned "From ESPN · as of Oct 8";
 *   stale       when the facts are older than the kind's window the caption reads "Last updated Oct 6" in the muted tone, and the card still shows.
 * WHAT A CARD NEVER SAYS: a reason, a pick, a member or a league in anything that leaves the device (the one-liner and the share text are built from the PUBLIC payload
 * only; contentcardtest builds them from an item carrying `reason: 'Your pick'` and asserts the word is absent).
 *
 * Pure apart from the tap binding (bindContentCardEvents), which only reads `data-content-id` and resolves it against the CURRENT items: an id the DOM offers is a request.
 */

import { icon } from './icons.js';
import { timeLabels, tapLabel, makeDateFormatter } from './feed-time.js';   // W-92 (DI-W92-9): the one "when did this happen" vocabulary (a pure leaf)

const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
export const _escForTest = esc;
const asArray = (v) => (Array.isArray(v) ? v : []);
const str = (v, max = 400) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');

export const CONTENT_KIND_META = Object.freeze({
  'matchup.preview': Object.freeze({ label: 'Matchup', icon: 'sportFootball' }),
  'player.preview': Object.freeze({ label: 'Player to watch', icon: 'playersGroup' }),
  spotlight: Object.freeze({ label: 'Spotlight', icon: 'trophy' }),
});
/** The reason pill is the closed set (newsCard's NEWS_CARD_REASONS, restated here as the subset this lane can produce; contentcardtest pins the two agree). */
export const CONTENT_REASONS = Object.freeze(["In this week's slate", 'Your pick', 'Your alma mater', 'Your team', 'CFB', 'NFL']);
/** A preview's facts are "as of" their fetch; older than this, the caption says "Last updated" (DI-660). Spotlights do not go stale. Review N1 (2026-10-14): ABOVE the builder's
 *  6-hour refresh (DI-657's shortest preview TTL), so a card refreshed on time never reads stale between two runs; 7 hours = one missed run. */
export const CONTENT_STALE_MS = 7 * 60 * 60 * 1000;
export const CONTENT_ERROR_COPY = "Some cards couldn't load.";
export const SECTION_UNAVAILABLE = (section) => `${section} isn't available right now.`;

/**
 * Review N2 (2026-10-14): every time is shown in the PLAYER'S zone. Callers pass `timeZone` (the IANA zone of the player's preference, data-model TIME_ZONES) and `formatTime`
 * (the house formatter, `formatGameTime(iso, tzKey)`, exactly what Home's other cards use for a kickoff). Without them (a test, an old caller) the device's zone is used.
 * A fact's SOURCE date ("2026-10-08") and a spotlight's game date are calendar days, not instants: they are never shifted.
 */
function dayLabel(iso, opts = { month: 'short', day: 'numeric' }, timeZone = null) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  try { return new Date(ms).toLocaleDateString('en-US', timeZone ? { ...opts, timeZone } : opts); } catch { try { return new Date(ms).toLocaleDateString('en-US', opts); } catch { return ''; } }
}
/** A calendar date ("2026-10-03") as "Oct 3", never shifted by a zone. */
function calendarLabel(ymd) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(ymd || '')) ? dayLabel(`${ymd}T12:00:00Z`, { month: 'short', day: 'numeric' }, 'UTC') : '';
}
function timeLabel(iso, { timeZone = null, formatTime = null } = {}) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  if (typeof formatTime === 'function') { try { const t = formatTime(new Date(ms).toISOString()); if (typeof t === 'string' && t && t !== 'TBD') return t; } catch { /* the fallback below */ } }
  const o = { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  try { return new Date(ms).toLocaleString('en-US', timeZone ? { ...o, timeZone } : o); } catch { try { return new Date(ms).toLocaleString('en-US', o); } catch { return ''; } }
}

/** The caption: honest about who wrote it and when its facts were true. Returns `{ text, stale }`. Review N1: a STALE caption still says who wrote the text ("SCRIBE · from
 *  public sources · Last updated Oct 8"), so a model-written card never loses its label by going stale. */
export function contentCaption(item, now = Date.now(), { timeZone = null } = {}) {
  const fresh = Date.parse(item && item.freshAsOf);
  const stale = item && item.cardKind !== 'spotlight' && Number.isFinite(fresh) && now - fresh > CONTENT_STALE_MS;
  const day = dayLabel(item && item.freshAsOf, undefined, timeZone);
  const by = item && item.synthesisStatus === 'ok' ? 'SCRIBE · from public sources' : 'From ESPN';
  if (stale) return { text: day ? `${by} · Last updated ${day}` : `${by} · Last updated`, stale: true };
  return { text: day ? `${by} · as of ${day}` : by, stale: false };
}

/** The spoken name (DI-660): "Matchup: Oregon at Penn State, as of October 8". */
export function contentSpokenLabel(item, { timeZone = null } = {}) {
  const meta = CONTENT_KIND_META[item && item.cardKind];
  const head = str(item && item.card && item.card.headline, 120);
  const day = dayLabel(item && item.freshAsOf, { month: 'long', day: 'numeric' }, timeZone);
  return `${meta ? meta.label : 'Card'}: ${head}${day ? `, as of ${day}` : ''}`;
}

function subLine(item, tzOpts = {}) {
  const c = item.card || {};
  if (item.cardKind === 'matchup.preview') return [timeLabel(c.kickoff, tzOpts), str(c.venue, 80), asArray(c.tv).map((t) => str(t, 30)).filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  if (item.cardKind === 'player.preview') return [str(c.team, 60), str(c.label, 80)].filter(Boolean).join(' · ');
  if (item.cardKind === 'spotlight') {
    const res = c.result === 'won' ? 'win' : c.result === 'lost' ? 'loss' : c.result === 'tied' ? 'tie' : '';
    return [str(c.team, 60) && str(c.opponent, 60) ? `${str(c.team, 60)} vs ${str(c.opponent, 60)}` : '', c.score && res ? `${str(c.score, 9)} ${res}` : '', calendarLabel(c.date)].filter(Boolean).join(' · ');
  }
  return '';
}

/** One content card's markup, or '' on bad input. */
export function renderContentCard(item, { now = Date.now(), timeZone = null, formatTime = null } = {}) {
  try {
    if (!item || typeof item !== 'object') return '';
    const meta = CONTENT_KIND_META[item.cardKind];
    const id = str(item.id, 80);
    const head = str(item.card && item.card.headline, 120);
    if (!meta || !id || !/^content_[0-9a-f-]{36}$/.test(id) || !head) return '';
    const reason = CONTENT_REASONS.indexOf(item.reason) >= 0 ? `<span class="feed-card-reason">${esc(item.reason)}</span>` : '';
    // W-92 (DI-W92-9): the card's time, from the `publishedAt` the feed sorts it by, in the player's zone — the feed card's own <time> and trailing group.
    // Unknown beats wrong: no known instant, no time. The "as of" caption below stays: it says when the FACTS were true, a different thing.
    const when = timeLabels(item.publishedAt, now, { formatDate: makeDateFormatter(timeZone || null) });
    const timeHtml = when ? `<time class="feed-card-time" datetime="${esc(when.iso)}" data-feed-time="${esc(when.iso)}" aria-label="${esc(when.spoken)}">${esc(when.written)}</time>` : '';
    const eyebrow = `<div class="feed-card-eyebrow"><span class="feed-card-icon" aria-hidden="true">${icon(meta.icon)}</span><span class="content-card-kind">${esc(meta.label)}</span>${reason}<span class="feed-card-trail">${timeHtml}<span class="feed-card-chev" aria-hidden="true">${icon('chevronRight')}</span></span></div>`;
    const sub = subLine(item, { timeZone, formatTime });
    const parts = [eyebrow, `<h3 class="feed-card-title">${esc(head)}</h3>`, sub ? `<p class="content-card-sub">${esc(sub)}</p>` : ''];
    const ok = item.synthesisStatus === 'ok' && str(item.summary);
    if (item.cardKind === 'player.preview') {
      const c = item.card || {};
      const lines = [str(c.seasonLine, 200), str(c.last3Line, 200), str(c.injury, 120)].filter(Boolean);
      if (lines.length) parts.push(`<ul class="content-card-lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
    }
    if (item.cardKind === 'spotlight') {
      const c = item.card || {};
      const lines = asArray(c.lines).map((l) => str(l, 160)).filter(Boolean).slice(0, 3);
      if (lines.length) parts.push(`<ul class="content-card-lines">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
      if (str(c.why, 300)) parts.push(`<p class="feed-card-body content-card-why">${esc(str(c.why, 300))}</p>`);
    }
    if (ok) {
      parts.push(`<p class="feed-card-body">${esc(str(item.summary, 220))}</p>`);
      const watch = asArray(item.watch).map((w) => str(w && w.text, 140)).filter(Boolean).slice(0, 2);
      if (watch.length) parts.push(`<div class="content-card-watch"><p class="content-card-label">What to watch</p><ul class="content-card-lines">${watch.map((w) => `<li>${esc(w)}</li>`).join('')}</ul></div>`);
      const talk = str(item.talk && item.talk.text, 140);
      if (talk) parts.push(`<p class="content-card-talk"><span class="content-card-label">Talk about it</span> ${esc(talk)}</p>`);
    } else if (item.cardKind === 'matchup.preview') {
      const facts = asArray(item.facts).map((f) => str(f && f.text, 200)).filter(Boolean).slice(0, 4);
      if (facts.length) parts.push(`<ul class="content-card-lines">${facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>`);
    }
    const cap = contentCaption(item, now, { timeZone });
    parts.push(`<p class="feed-card-caption content-card-caption${cap.stale ? ' content-card-caption--stale' : ''}">${esc(cap.text)}</p>`);
    const kindClass = item.cardKind === 'matchup.preview' ? 'matchup' : item.cardKind === 'player.preview' ? 'player' : 'spotlight';
    const label = `${contentSpokenLabel(item, { timeZone })}.`;           // W-92 (DI-W92-8's form): "{label}. {spoken time}. Opens details."; data-feed-label lets Home refresh it in place
    return `<article class="card feed-card feed-card--tap content-card content-card--${kindClass}" role="button" tabindex="0" data-content-id="${esc(id)}" data-feed-label="${esc(label)}" aria-label="${esc(tapLabel(label, when ? when.spoken : ''))}">${parts.join('')}</article>`;
  } catch { return ''; }
}

/** DI-660's error state for the content leg: one calm note with Retry (the other sources' cards still render). */
export function renderContentErrorNote() {
  return `<div class="card feed-card content-error" role="status"><p class="feed-card-body">${esc(CONTENT_ERROR_COPY)}</p><div class="feed-actions"><button type="button" class="btn feed-action feed-action--neutral" data-content-retry="1">Retry</button></div></div>`;
}

// ═══ the detail (DI-669) ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const section = (id, title, inner) => `<section class="card cd-card" aria-labelledby="cd-h-${esc(id)}"><h4 class="cd-h" id="cd-h-${esc(id)}">${esc(title)}</h4>${inner}</section>`;
const para = (t) => `<p class="cd-sentence">${esc(t)}</p>`;
const unavailable = (title) => para(SECTION_UNAVAILABLE(title));
const listOf = (items) => `<ul class="cd-items">${items.map((t, i) => `<li class="cd-item" data-key="${i}"><span class="cd-item-main"><span class="cd-item-title">${esc(t.primary)}</span>${t.secondary ? `<span class="cd-item-sub">${esc(t.secondary)}</span>` : ''}</span></li>`).join('')}</ul>`;
const factsWith = (row, re) => asArray(row.facts).filter((f) => f && typeof f.id === 'string' && re.test(f.id)).map((f) => ({ primary: str(f.text, 300), secondary: f.source ? [str(f.source.label, 60), str(f.source.publishedAt, 10)].filter(Boolean).join(' · ') : '' }));

/**
 * The actions a detail offers, by kind (DI-669): matchup — Talk about it, Open game; player — Open game; spotlight — Share…, Talk about it.
 * Review N4 (2026-10-14): with league chat turned OFF by the commissioner, the chat-bound actions are not offered at all — "Talk about it" (it opens the composer) and
 * "Open game" (it opens the game's chat thread) — the same capability rule Lane B's card detail follows (`capabilities: { thread, chat }`), never a dead button.
 */
export function contentDetailActions(row, { gameAvailable = false, chatAvailable = true } = {}) {
  const k = row && row.cardKind;
  const out = [];
  if (k === 'spotlight') out.push({ id: 'share', label: 'Share…', tone: 'primary' });
  if ((k === 'matchup.preview' || k === 'spotlight') && chatAvailable) out.push({ id: 'talk', label: 'Talk about it', tone: k === 'spotlight' ? 'secondary' : 'primary' });
  if ((k === 'matchup.preview' || k === 'player.preview') && gameAvailable && chatAvailable) out.push({ id: 'open-game', label: 'Open game', tone: 'secondary' });
  return out;
}

/** The detail screen body for one card (the feed_content_get row, normalized). `gameAvailable` = the league has this game (so "Open game" can go somewhere). */
export function contentDetailHTML(row, { now = Date.now(), gameAvailable = false, chatAvailable = true, timeZone = null, formatTime = null } = {}) {
  try {
    const meta = row && CONTENT_KIND_META[row.cardKind];
    const head = str(row && row.card && row.card.headline, 120);
    if (!meta || !head) return contentDetailUnavailableHTML();
    const c = row.card || {};
    const cap = contentCaption(row, now, { timeZone });
    const reason = CONTENT_REASONS.indexOf(row.reason) >= 0 ? `<span class="cd-reason">${esc(row.reason)}</span>` : '';
    const sub = subLine(row, { timeZone, formatTime });
    const blocks = [`<section class="card cd-card cd-head" aria-label="Summary"><div class="cd-eyebrow"><span class="feed-card-icon" aria-hidden="true">${icon(meta.icon)}</span><span class="content-card-kind">${esc(meta.label)}</span>${reason}</div><h3 class="cd-title">${esc(head)}</h3>${sub ? `<p class="cd-body">${esc(sub)}</p>` : ''}${row.synthesisStatus === 'ok' && str(row.summary) ? `<p class="cd-body">${esc(str(row.summary, 220))}</p>` : ''}<p class="cd-fresh">${esc(cap.text)}</p></section>`];
    if (row.cardKind === 'matchup.preview') {
      const teams = [c.away, c.home].filter((t) => t && str(t.name, 60)).map((t) => ({ primary: str(t.name, 60), secondary: [t.rank ? `No. ${t.rank}` : '', str(t.record, 9)].filter(Boolean).join(' · ') }));
      const last = factsWith(row, /:last:/);
      blocks.push(section('matchup', 'The matchup', teams.length || last.length ? listOf([...teams, ...last]) : unavailable('The matchup')));
      const watch = row.synthesisStatus === 'ok' ? asArray(row.watch).map((w) => str(w && w.text, 140)).filter(Boolean).slice(0, 2) : [];
      blocks.push(section('watch', 'What to watch', watch.length ? listOf(watch.map((w) => ({ primary: w }))) : unavailable('What to watch')));
      const talk = row.synthesisStatus === 'ok' ? str(row.talk && row.talk.text, 140) : '';
      blocks.push(section('talk', 'Talk about it', talk ? para(talk) : unavailable('Talk about it')));
    } else if (row.cardKind === 'player.preview') {
      blocks.push(section('season', 'Season', str(c.seasonLine) ? para(str(c.seasonLine, 200)) : para("Season stats aren't available yet.")));
      blocks.push(section('last3', 'Last 3 games', str(c.last3Line) ? para(str(c.last3Line, 200)) : unavailable('Last 3 games')));
      const starter = factsWith(row, /:(depth|role|inj)$/);
      blocks.push(section('starter', c.position === 'QB' ? 'Starter status' : 'Role', starter.length ? listOf([{ primary: str(c.label, 80) }, ...starter]) : unavailable(c.position === 'QB' ? 'Starter status' : 'Role')));
      const why = factsWith(row, /:why$/);
      blocks.push(section('why', 'Why he matters', why.length ? listOf(why) : unavailable('Why he matters')));
      if (row.synthesisStatus === 'ok') {
        const watch = asArray(row.watch).map((w) => str(w && w.text, 140)).filter(Boolean).slice(0, 2);
        if (watch.length) blocks.push(section('watch', 'What to watch', listOf(watch.map((w) => ({ primary: w })))));
      }
    } else {
      const lines = asArray(c.lines).map((l) => str(l, 160)).filter(Boolean).slice(0, 3);
      blocks.push(section('lines', 'Stat lines', lines.length ? listOf(lines.map((l) => ({ primary: l }))) : unavailable('Stat lines')));
      blocks.push(section('game', 'The game', sub ? para(sub) : unavailable('The game')));
      const r = c.rationale || {};
      const rank = Number.isInteger(r.rank) && Number.isInteger(r.ofCandidates) ? `Ranked ${r.rank} of ${r.ofCandidates} that day under the standard.` : '';
      blocks.push(section('why', 'Why featured', str(c.why) ? para(str(c.why, 300)) + (rank ? para(rank) : '') : unavailable('Why featured')));
    }
    const sources = asArray(row.sources).map((s) => ({ primary: str(s && s.label, 60), secondary: str(s && s.publishedAt, 10) })).filter((s) => s.primary);
    blocks.push(section('sources', 'Sources', sources.length ? listOf(sources) : unavailable('Sources')));
    const updated = timeLabel(row.freshAsOf, { timeZone, formatTime });
    if (updated) blocks.push(`<p class="cd-note">Updated ${esc(updated)}</p>`);
    const actions = contentDetailActions(row, { gameAvailable, chatAvailable });
    if (actions.length) blocks.push(`<div class="cd-actions">${actions.map((a) => `<button type="button" class="btn cd-action cd-action--${a.tone === 'primary' ? 'primary' : 'secondary'}" data-content-action="${esc(a.id)}">${esc(a.label)}</button>`).join('')}</div>`);
    return `<div class="cd" data-cd-type="${esc(row.cardKind)}">${blocks.join('')}</div>`;
  } catch { return contentDetailUnavailableHTML(); }
}

export function contentDetailUnavailableHTML() {
  return `<div class="cd cd--unavailable"><section class="card cd-card cd-unavail" role="status"><h3 class="cd-title">${esc("This card isn't available right now.")}</h3><p class="cd-body">${esc('It may have been updated or removed.')}</p><div class="cd-actions"><button type="button" class="btn cd-action cd-action--primary" data-content-action="back">Back to Home</button></div></section></div>`;
}

/**
 * DI-667 — "SCRIBE's read" for the "A year ago" card's detail, AFTER the record and what changed (Lane B's sections): the analysis labelled "Written by SCRIBE from the league
 * record" and its source line, or "Analysis isn't available right now." `state` = fetchLeagueInsight()'s answer, or { status: 'error' }. '' while it is still loading.
 */
export function insightSectionHTML(state, { seasonLabel = 'CFP 2K25', timeZone = null } = {}) {
  if (!state || state.status === 'loading') return '';
  if (state.status !== 'ok' || !str(state.read)) return section('scribe-read', "SCRIBE's read", para("Analysis isn't available right now."));
  const paras = String(state.read).split(/\n\s*\n/).map((p) => str(p, 600)).filter(Boolean).slice(0, 3);
  const day = dayLabel(state.createdAt, undefined, timeZone);
  return section('scribe-read', "SCRIBE's read", `<p class="cd-item-sub">Written by SCRIBE from the league record</p>${paras.map(para).join('')}<p class="cd-item-sub">${esc(`Source: ${str(seasonLabel, 40)} league record${day ? ` · last updated ${day}` : ''}`)}</p>`);
}

// ═══ what may LEAVE the device: built from the public payload only (DI-665, DI-666) ════════════════════════════════════════════════════════════
/** "Talk about it" (DI-666): a deterministic one-liner from the PUBLIC payload. Never a reason, a pick, a member or a league. */
export function talkLine(item, { timeZone = null } = {}) {
  const c = (item && item.card) || {};
  const day = item && item.cardKind === 'spotlight' ? calendarLabel(c.date) : dayLabel(item && item.freshAsOf, undefined, timeZone);
  if (item && item.cardKind === 'spotlight') {
    const line = asArray(c.lines).map((l) => str(l, 120)).filter(Boolean)[0] || '';
    return `Spotlight: ${str(c.name, 60)}, ${str(c.team, 60)}${line ? `, ${line}` : ''} vs ${str(c.opponent, 60)} (ESPN${day ? `, ${day}` : ''})`;
  }
  if (item && item.cardKind === 'player.preview') return `Player to watch: ${str(c.name, 60)}, ${str(c.team, 60)}${str(c.seasonLine) ? `, ${str(c.seasonLine, 140)}` : ''} (ESPN${day ? `, ${day}` : ''})`;
  if (item && item.cardKind === 'matchup.preview') return `Matchup: ${str(c.headline, 120)}${c.kickoff ? `, ${dayLabel(c.kickoff, undefined, timeZone)}` : ''} (ESPN)`;
  return '';
}

/** The Spotlight share text (DI-665): public sports data only, text only, no link into the app, no league, no member. */
export function spotlightShareText(item) {
  if (!item || item.cardKind !== 'spotlight') return '';
  const c = item.card || {};
  const lines = asArray(c.lines).map((l) => str(l, 120)).filter(Boolean).slice(0, 2).join('; ');
  const day = calendarLabel(c.date);
  const v = c.rationale && c.rationale.standardVersion ? String(c.rationale.standardVersion).replace(/[^0-9]/g, '') : '2';
  return `${str(c.name, 60)}, ${str(c.team, 60)}: ${lines} vs ${str(c.opponent, 60)} (${str(c.score, 9)})${day ? `, ${day}` : ''}. Source: ESPN box score. Munera Spotlight standard v${v}.`;
}

// ═══ the tap ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const bound = new WeakMap();
/**
 * Delegated tap / keyboard handling for content cards under `rootEl`: a tap resolves `data-content-id` against the CURRENT items and hands `onOpen` that item; a Retry on the
 * error note calls `onRetry`. Binding the same root twice replaces the earlier binding. Returns an unbind.
 */
export function bindContentCardEvents(rootEl, { items, onOpen, onRetry } = {}) {
  if (!rootEl || typeof rootEl.addEventListener !== 'function') return () => {};
  if (bound.has(rootEl)) { try { bound.get(rootEl)(); } catch { /* detached */ } }
  const getItems = typeof items === 'function' ? items : () => items;
  const resolve = (el) => {
    const id = el && typeof el.getAttribute === 'function' ? el.getAttribute('data-content-id') : null;
    if (!id) return null;
    let list = [];
    try { list = getItems(); } catch { return null; }
    return asArray(list).find((i) => i && i.id === id) || null;
  };
  const onClick = (e) => {
    const t = e && e.target;
    if (!t || typeof t.closest !== 'function') return;
    if (t.closest('[data-content-retry]')) { if (typeof onRetry === 'function') { try { onRetry(); } catch { /* the note stays */ } } return; }
    const card = t.closest('[data-content-id]');
    const item = card ? resolve(card) : null;
    if (item && typeof onOpen === 'function') { try { onOpen(item); } catch (err) { console.warn('[content] opening a card failed', err && err.name); } }
  };
  const onKeydown = (e) => {
    if (!e || (e.key !== 'Enter' && e.key !== ' ')) return;
    const t = e.target;
    const card = t && typeof t.closest === 'function' ? t.closest('[data-content-id]') : null;
    const item = card ? resolve(card) : null;
    if (!item) return;
    if (typeof e.preventDefault === 'function') e.preventDefault();
    if (typeof onOpen === 'function') { try { onOpen(item); } catch { /* courtesy */ } }
  };
  rootEl.addEventListener('click', onClick);
  rootEl.addEventListener('keydown', onKeydown);
  const unbind = () => { try { rootEl.removeEventListener('click', onClick); rootEl.removeEventListener('keydown', onKeydown); } catch { /* detached */ } bound.delete(rootEl); };
  bound.set(rootEl, unbind);
  return unbind;
}
