/**
 * CFB Pickems — full-gameday.js (Deployment 2, thread 101826-D2, lane 3 "Personal Home"; DI-822, UN/PF-509, the approved mockup's "Full Game Day" frame)
 * ====================================================================================================================================================
 * THE FULL GAME DAY SCREEN for a member of two or more leagues: everything Game Day knows, grouped so it reads at a glance. A pushed screen (js/pushed-screen.js: swipe-back, the 260 ms
 * slide, the 44 pt back chevron); this module is its PURE model and its markup.
 *
 *   fullGameDayModel(gd, { now, dayKeyOf, showAllUpcoming, showAllFinal })   the sections, in order: Picks due · Live now · Starting soon · Later today · Upcoming · Final today
 *   fullGameDayHTML(model, { escHtml, numHtml, chevHtml })                   the markup: a heading per section (the VoiceOver rotor), rows as 56 pt buttons
 *
 * THE RULES (DI-822): a game appears in exactly ONE section; "Later today" and "Upcoming" use the MEMBER's calendar day (`dayKeyOf`, the caller's time zone preference), never the
 * device's; Upcoming = the next three calendar days, at most UPCOMING_CAP rows then a "Show more" row; Final today folds when it holds more than FINAL_FOLD; at most OVERALL_CAP rows
 * in all, then "Showing 120 of {n}."; the viewer's OWN coverage only (▲ / ▽ while live, never red; ✓ / ✗ only when final); a row's league is its chip. Pure: no import, no storage,
 * no DOM, no clock.
 */
export const STARTING_SOON_MS = 3 * 60 * 60 * 1000;
export const UPCOMING_DAYS = 3;
export const UPCOMING_CAP = 20;
export const FINAL_FOLD = 3;
export const OVERALL_CAP = 120;
export const DUE_CAP = 5;
const DAY = 24 * 60 * 60 * 1000;
const LIVE = new Set(['live', 'live-stale']);
const arr = (v) => (Array.isArray(v) ? v : []);
const isStr = (v) => typeof v === 'string' && v !== '';
const requireFn = (f, name, who) => { if (typeof f !== 'function') throw new TypeError(`${who}() requires an injected ${name} function (CONVENTIONS #12)`); return f; };

/**
 * @param {object} gd   js/gameday-leagues.js crossLeagueGameDay's model (its `items` and `due`)
 * @param {object} o    { now, dayKeyOf(ms) -> 'YYYY-MM-DD' in the member's zone, fmt: { time(ms), countdown(ms) }, showAllUpcoming, showAllFinal }
 */
export function fullGameDayModel(gd, o = {}) {
  const now = Number.isFinite(o.now) ? o.now : 0;
  const dayKeyOf = typeof o.dayKeyOf === 'function' ? o.dayKeyOf : (ms) => new Date(ms).toISOString().slice(0, 10);
  const fmt = { time: (v) => String(v ?? ''), countdown: (ms) => String(ms ?? ''), ...(o.fmt || {}) };
  const items = arr(gd && gd.items);
  const today = dayKeyOf(now);
  const nextDays = new Set(Array.from({ length: UPCOMING_DAYS }, (_, k) => dayKeyOf(now + (k + 1) * DAY)));
  const placed = new Set();
  const take = (pred) => items.filter((it) => !placed.has(it.itemId) && pred(it)).map((it) => { placed.add(it.itemId); return it; });
  const byKick = (a, b) => ((a.kickoffMs ?? Infinity) - (b.kickoffMs ?? Infinity)) || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0);
  const live = take((it) => LIVE.has(it.phase));                                                     // already in score order (DI-818)
  const soon = take((it) => it.phase !== 'final' && it.kickoffMs !== null && it.kickoffMs > now && it.kickoffMs - now <= STARTING_SOON_MS).sort(byKick);
  const later = take((it) => it.phase !== 'final' && it.kickoffMs !== null && it.kickoffMs > now && dayKeyOf(it.kickoffMs) === today).sort(byKick);
  const upcomingAll = take((it) => it.phase !== 'final' && it.kickoffMs !== null && it.kickoffMs > now && nextDays.has(dayKeyOf(it.kickoffMs))).sort(byKick);
  const finalAll = take((it) => it.phase === 'final' && dayKeyOf(it.kickoffMs ?? it.finalMs ?? 0) === today).sort((a, b) => (b.finalMs ?? b.kickoffMs ?? 0) - (a.finalMs ?? a.kickoffMs ?? 0));
  const upcoming = o.showAllUpcoming === true ? upcomingAll : upcomingAll.slice(0, UPCOMING_CAP);
  const finalsFolded = finalAll.length > FINAL_FOLD && o.showAllFinal !== true;
  const due = arr(gd && gd.due).filter((d) => d && Number.isFinite(d.lockMs) && d.lockMs > now).slice(0, DUE_CAP);
  const rowOf = (it) => ({ ...it });
  let sections = [
    { key: 'due', label: 'Picks due', rows: due.map((d) => ({ due: true, id: d.id, chip: d.chip, leagueName: d.leagueName, title: `${d.chip} picks lock ${d.lockMs - now <= STARTING_SOON_MS ? `in ${fmt.countdown(d.lockMs - now)}` : fmt.time(d.lockMs)}`, sub: d.done ? "You're in. Tap to edit." : (Number.isFinite(d.remaining) && Number.isFinite(d.total) ? `${d.remaining} left of ${d.total}` : 'Picks are open') })) },
    { key: 'live', label: 'Live now', rows: live.map(rowOf) },
    { key: 'soon', label: 'Starting soon', rows: soon.map(rowOf) },
    { key: 'later', label: 'Later today', rows: later.map(rowOf) },
    { key: 'upcoming', label: 'Upcoming', rows: upcoming.map(rowOf), more: upcomingAll.length > upcoming.length ? upcomingAll.length - upcoming.length : 0 },
    { key: 'final', label: 'Final today', rows: finalsFolded ? [] : finalAll.map(rowOf), folded: finalsFolded ? finalAll.length : 0, count: finalAll.length },
  ].filter((s) => s.rows.length || s.folded);
  // the overall cap: 120 game rows, then a sentence (a due row is not a game)
  let budget = OVERALL_CAP, shownGames = 0;
  const totalGames = live.length + soon.length + later.length + upcoming.length + (finalsFolded ? 0 : finalAll.length);
  sections = sections.map((s) => {
    if (s.key === 'due') return s;
    const rows = s.rows.slice(0, Math.max(0, budget));
    budget -= rows.length; shownGames += rows.length;
    return { ...s, rows };
  }).filter((s) => s.rows.length || s.folded);
  const next = items.filter((it) => it.phase !== 'final' && it.kickoffMs !== null && it.kickoffMs > now).sort(byKick)[0] || null;
  return {
    sections, capped: totalGames > shownGames ? { shown: shownGames, total: totalGames } : null,
    empty: sections.length === 0 ? (next && next.kickoffMs - now <= UPCOMING_DAYS * DAY ? { title: 'No games in your leagues right now.', line: `Next kickoff ${fmt.time(next.kickoffMs)} · ${next.chip}.` } : { title: 'No games in your leagues right now.', line: 'Nothing scheduled in the next 3 days.' }) : null,
  };
}

const coverHTML = (r, escHtml) => {
  const by = r.coverMargin ? ` by ${escHtml(r.coverMargin)}` : '';
  switch (r.coverage) {
    case 'covering': return `<span class="fgd-cov fgd-cov--covering">▲ You're covering${by}</span>`;
    case 'trailing': return `<span class="fgd-cov fgd-cov--trailing">▽ You're trailing${by}</span>`;
    case 'even': return '<span class="fgd-cov">You\'re right on the number</span>';
    case 'covered': return `<span class="fgd-cov fgd-cov--covered">✓ You covered${by}</span>`;
    case 'missed': return `<span class="fgd-cov fgd-cov--missed">✗ You missed${by}</span>`;
    case 'push': return '<span class="fgd-cov">Your pick was a push</span>';
    case 'pending': return r.coverTeam ? `<span class="fgd-cov">Your pick: ${escHtml(r.coverTeam)}</span>` : '';
    case 'none': return '<span class="fgd-cov fgd-mut">No pick</span>';
    default: return '';
  }
};
const spokenCover = (r) => ({ covering: "You're covering", trailing: "You're trailing", even: "You're right on the number", covered: 'You covered', missed: 'You missed', push: 'Your pick was a push', none: 'No pick' }[r.coverage] || '');

function gameRow(r, { escHtml, numHtml, chevHtml }) {
  const score = r.awayScore !== null && r.homeScore !== null && (LIVE.has(r.phase) || r.phase === 'final');
  const head = score ? `${escHtml(r.awayName)} at ${escHtml(r.homeName)} · ${numHtml(r.awayScore)}–${numHtml(r.homeScore)}` : `${escHtml(r.awayName)} at ${escHtml(r.homeName)}`;
  const status = r.phase === 'live' ? (r.liveLabel || 'Live') : r.phase === 'live-stale' ? 'Score may be behind' : r.phase === 'final' ? 'Final' : (r.upcomingLabel || '');
  const sub = [escHtml(status), r.line ? escHtml(r.line) : ''].filter(Boolean).join(' · ');
  const cov = coverHTML(r, escHtml);
  const aria = `${r.lead}. ${r.awayName} at ${r.homeName}. ${score ? `${r.awayScore} to ${r.homeScore}, ` : ''}${status}.${spokenCover(r) ? ` ${spokenCover(r)}.` : ''} Opens ${r.leagueName || 'the league'}.`;
  return `<button type="button" class="fgd-row" data-fgd-item="${escHtml(r.itemId)}" data-haptic="light" aria-label="${escHtml(aria)}"><span class="fgd-tx"><b>${head}</b><span>${sub}</span>${cov}</span><span class="fgd-prov">${escHtml(r.chip)}</span><span class="fgd-chev" aria-hidden="true">${chevHtml || ''}</span></button>`;
}
function dueRow(r, { escHtml, chevHtml }) {
  return `<button type="button" class="fgd-row" data-fgd-due="${escHtml(r.id)}" data-haptic="light" aria-label="${escHtml(`${r.title}. ${r.sub} Opens ${r.leagueName || 'the league'}.`)}"><span class="fgd-tx"><b>${escHtml(r.title)}</b><span>${escHtml(r.sub)}</span></span><span class="fgd-chev" aria-hidden="true">${chevHtml || ''}</span></button>`;
}

/** The screen's body (the pushed-screen shell draws the navigation bar with "Game Day" and Back). */
export function fullGameDayHTML(model, { escHtml, numHtml, chevHtml = '' } = {}) {
  requireFn(escHtml, 'escHtml', 'fullGameDayHTML');
  requireFn(numHtml, 'numHtml', 'fullGameDayHTML');
  const m = model && typeof model === 'object' ? model : {};
  if (m.empty) return `<div class="fgd"><div class="ps-empty"><p class="ps-empty-title">${escHtml(m.empty.title)}</p><p class="ps-empty-body">${escHtml(m.empty.line)}</p></div></div>`;
  const parts = ['<div class="fgd">'];
  for (const s of arr(m.sections)) {
    const n = s.key === 'final' ? s.count : s.rows.length + (s.more || 0);
    parts.push(`<section class="fgd-sec" aria-labelledby="fgd-h-${escHtml(s.key)}"><h2 class="fgd-sect" id="fgd-h-${escHtml(s.key)}">${escHtml(s.label)} · ${numHtml(n)}</h2><div class="fgd-group">`);
    for (const r of s.rows) parts.push(r.due ? dueRow(r, { escHtml, chevHtml }) : gameRow(r, { escHtml, numHtml, chevHtml }));
    if (s.more) parts.push(`<button type="button" class="fgd-row fgd-row--more" data-fgd-more="upcoming" data-haptic="light"><span class="fgd-tx"><b>Show ${numHtml(s.more)} more</b></span></button>`);
    if (s.folded) parts.push(`<button type="button" class="fgd-row fgd-row--more" data-fgd-more="final" data-haptic="light" aria-expanded="false"><span class="fgd-tx"><b>Show ${numHtml(s.folded)} final ${s.folded === 1 ? 'game' : 'games'}</b></span></button>`);
    parts.push('</div></section>');
  }
  if (m.capped) parts.push(`<p class="fgd-cap">Showing ${numHtml(m.capped.shown)} of ${numHtml(m.capped.total)}.</p>`);
  parts.push('</div>');
  return parts.join('');
}
