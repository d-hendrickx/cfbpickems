/**
 * CFB Pickems — feedtimetest.mjs (W-92, release v0.30.1, 2026-10-17)
 * ===================================================================
 * The acceptance proof for "a time on every card" (UN/PF C in docs/DESIGN_W92_HOME_FEED_NEEDS.md, Drew "approve M-61"; design inputs
 * DI-W92-7 … DI-W92-10 and the time half of DI-W92-11 in docs/DESIGN_W92_HOME_FEED_INPUTS.md).
 *
 *   [1] DI-W92-7  js/feed-time.js: the written and spoken vocabulary at every boundary, future, empty, epoch, before 2000, another year,
 *                 the viewer's zone, the picks tally's "Opened" prefix; newsCard re-exports the one relativeTime
 *   [2] DI-W92-8  every event card carries exactly one <time> on its eyebrow's trailing edge, from the event's own time; the tappable
 *                 card's VoiceOver label is "{headline}. {supporting line}. {spoken time}. Opens details."; unknown beats wrong
 *   [3] DI-W92-8  the style: caption level, tabular figures, --text-secondary, nowrap, tokens only, in the feed block
 *   [4] DI-W92-9  news, storyline and content cards use the same vocabulary; the content card's "as of" caption is unchanged
 *   [5] DI-W92-10 the time stays honest while Home is open: one 60 s timer armed by a REAL paint rewrites the labels in place (no repaint,
 *                 same nodes, no live region), runs once on return to the foreground, does nothing while hidden, stops on tab leave;
 *                 a repaint whose only change is a time does not rewrite the feed either
 *   [6] DI-W92-11 guards: the modules that may emit a feed-card-time element are exactly home.js and content-card.js (P-11: the pinned
 *                 occurrences, any other fails, a vanished one fails); the exempt renderers produce no <time>
 *   [M] THE MUTATION KIT (S-3): scratch copies as data: URLs; each must turn a NAMED check RED. `node feedtimetest.mjs --kit` runs it alone.
 *
 * Run:  node feedtimetest.mjs   and   TZ=UTC node feedtimetest.mjs   (tz-tagged: dates are formatted in a zone)
 */
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installDom, mkHomeEnv, NOW, MIN, HOUR, DAY, iso, esc } from './d1homeenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const KIT_ONLY = process.argv.includes('--kit');

const doc = installDom();
const H = await import('./js/home.js');
const FT = await import('./js/feed-time.js');
const fc = await import('./js/feed-cards.js');
const NC = await import('./js/newsCard.js');
const CC = await import('./js/content-card.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');

const league = (w2, extra = {}) => fx.buildLeague({ w2, calculateWeeklyResults, ...extra });
function snapshotWith(L) {
  const view = fc.buildRevealedView({ weeks: L.weeks, games: L.games, picks: L.picks, weeklyResults: L.weeklyResults, confirmedStatusFor: (w) => w.status });
  return {
    leagueId: 'L1', players: L.players, weeks: L.weeks, games: L.games, picks: L.picks, ...view,
    confirmedStatusFor: (w) => w.status, picksReadConfirmed: Object.fromEntries(L.weeks.map(w => [w.weekId, true])),
    submissionCounts: { w2: { submittedCount: 4, totalPlayers: 6 } },
    chatCandidates: { scribe: [{ id: 'm_s1', ts: NOW - HOUR, author: 'scribe', authorName: 'SCRIBE', body: 'A quiet week. Somebody has to be quiet.' }], lockerRoom: [{ id: 'm_l1', ts: NOW - 2 * HOUR, author: 'p3', authorName: 'Kevin', body: 'mid take', reactionCount: 3 }] },
    currentWeekId: 'w2', todayKey: '2026-09-13',
  };
}
const derive = (L) => fc.deriveCards(snapshotWith(L), { viewerId: 'p1', now: NOW });
const UTC_FMT = FT.makeDateFormatter ? FT.makeDateFormatter('UTC') : null;
const timesIn = (html) => (html.match(/<time class="feed-card-time"/g) || []).length;
const labelOf = (html) => { const m = /^<article[^>]*\saria-label="([^"]*)"/.exec(html); return m ? m[1] : null; };
const SPOKEN_END = /(just now|\d+ minutes? ago|\d+ hours? ago|yesterday|\d+ days ago|(?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}(?:, \d{4})?)\. Opens details\.$/;

// ═══ [1] DI-W92-7 ════════════════════════════════════════════════════════════════════════════════════════════════════
function vocabChecks(T) {
  const out = {};
  const safe = (fn) => { try { return fn(); } catch { return false; } };   // a mutant that THROWS on a check's input fails that check by name
  const now = Date.parse('2026-10-17T12:00:00.000Z');
  const fmt = T.makeDateFormatter('UTC');
  const at = (ms) => new Date(now - ms).toISOString();
  const ROWS = [
    ['59 s', 59e3, 'Just now', 'just now'], ['60 s', 60e3, '1m ago', '1 minute ago'], ['12 m', 12 * MIN, '12m ago', '12 minutes ago'], ['59 m', 59 * MIN, '59m ago', '59 minutes ago'],
    ['60 m', 60 * MIN, '1h ago', '1 hour ago'], ['2 h', 2 * HOUR, '2h ago', '2 hours ago'], ['23 h 59 m', 23 * HOUR + 59 * MIN, '23h ago', '23 hours ago'], ['24 h', 24 * HOUR, 'Yesterday', 'yesterday'],
    ['47 h 59 m', 47 * HOUR + 59 * MIN, 'Yesterday', 'yesterday'], ['48 h', 48 * HOUR, '2d ago', '2 days ago'], ['6 d 23 h', 6 * DAY + 23 * HOUR, '6d ago', '6 days ago'],
    ['7 d', 7 * DAY, 'Oct 10', 'October 10'], ['8 d', 8 * DAY, 'Oct 9', 'October 9'],
  ];
  const wrong = ROWS.filter(([, ms, w, s]) => T.relativeTime(at(ms), now, { formatDate: fmt }) !== w || T.spokenAgo(at(ms), now, { formatDate: fmt }) !== s).map(([n, ms]) => `${n}: "${T.relativeTime(at(ms), now, { formatDate: fmt })}" / "${T.spokenAgo(at(ms), now, { formatDate: fmt })}"`);
  out[`V1 the written and spoken forms at every boundary (59 s, 60 s, 59 m, 60 m, 23 h 59 m, 24 h, 47 h 59 m, 48 h, 6 d 23 h, 7 d…) — wrong: ${wrong.join('; ') || 'none'}`] = wrong.length === 0;
  out['V2 a FUTURE instant (clock skew) reads "Just now" / "just now", never a negative'] = T.relativeTime(new Date(now + 5 * MIN).toISOString(), now, { formatDate: fmt }) === 'Just now' && T.spokenAgo(new Date(now + 3 * DAY).toISOString(), now, { formatDate: fmt }) === 'just now';
  out['V3 UNKNOWN beats wrong: missing, empty, unparsable, the epoch sentinel isoAt() writes, and anything before 2000 are not known instants and render as ""'] = safe(() =>
    [undefined, null, '', 'garbage', '1970-01-01T00:00:00.000Z', '1999-12-31T23:59:59.000Z', 0, NaN].every(v => T.isKnownInstant(v) === false && T.relativeTime(v, now, { formatDate: fmt }) === '' && T.spokenAgo(v, now, { formatDate: fmt }) === '')
    && T.isKnownInstant('2000-01-01T00:00:00.000Z') === true && T.isKnownInstant(now) === true);
  out['V4 another year carries the year: "Oct 9, 2025" / "October 9, 2025"'] = T.relativeTime('2025-10-09T12:00:00.000Z', now, { formatDate: fmt }) === 'Oct 9, 2025' && T.spokenAgo('2025-10-09T12:00:00.000Z', now, { formatDate: fmt }) === 'October 9, 2025';
  const la = T.makeDateFormatter('America/Los_Angeles');
  out['V5 the date is the VIEWER\'s day: 03:00 UTC on Oct 10 is Oct 10 in UTC and Oct 9 in Los Angeles'] = T.relativeTime('2026-10-10T03:00:00.000Z', now, { formatDate: fmt }) === 'Oct 10' && T.relativeTime('2026-10-10T03:00:00.000Z', now, { formatDate: la }) === 'Oct 9';
  out['V6 …and so is the year: 03:00 UTC on Jan 1 2026 is "Dec 31, 2025" in Los Angeles'] = T.relativeTime('2026-01-01T03:00:00.000Z', now, { formatDate: la }) === 'Dec 31, 2025';
  const L = (ms, o = {}) => T.timeLabels(at(ms), now, { formatDate: fmt, ...o });
  out['V7 timeLabels gives {iso, written, spoken}, the ISO normalised; null for an unknown instant'] = safe(() => JSON.stringify(L(2 * HOUR)) === JSON.stringify({ iso: at(2 * HOUR), written: '2h ago', spoken: '2 hours ago' }) && T.timeLabels('1970-01-01T00:00:00.000Z', now, { formatDate: fmt }) === null);
  out['V8 the picks tally\'s prefix: "Opened 3d ago" / "opened 3 days ago", "Opened just now", "Opened yesterday", "Opened Oct 9"'] =
    L(3 * DAY, { opened: true }).written === 'Opened 3d ago' && L(3 * DAY, { opened: true }).spoken === 'opened 3 days ago' && L(10e3, { opened: true }).written === 'Opened just now' && L(30 * HOUR, { opened: true }).written === 'Opened yesterday' && L(8 * DAY, { opened: true }).written === 'Opened Oct 9' && L(8 * DAY, { opened: true }).spoken === 'opened October 9';
  out['V9 the tap label: "{prefix} {spoken}. Opens details." and, with no time, "{prefix} Opens details."'] = T.tapLabel('Week 2 is final.', '2 hours ago') === 'Week 2 is final. 2 hours ago. Opens details.' && T.tapLabel('Week 2 is final.', '') === 'Week 2 is final. Opens details.';
  return out;
}

// ═══ [2] DI-W92-8 ════════════════════════════════════════════════════════════════════════════════════════════════════
function renderChecks(Hm) {
  const out = {};
  const cards = [...derive(league('final')), ...derive(league('open')), ...derive(league('live'))];
  const html = (c, o = {}) => Hm.cardHTML(c, { escHtml: esc, now: NOW, ...o });
  const missing = [], badIso = [], badLabel = [];
  for (const c of cards) {
    const h = html(c);
    if (timesIn(h) !== 1) { missing.push(`${c.id}(${timesIn(h)})`); continue; }
    const m = /<time class="feed-card-time" datetime="([^"]*)" data-feed-time="([^"]*)"/.exec(h);
    if (!m || m[1] !== new Date(Date.parse(c.sortKey)).toISOString() || m[2] !== m[1]) badIso.push(c.id);
    const lab = labelOf(h);
    if (!lab || !SPOKEN_END.test(lab)) badLabel.push(`${c.id}: ${lab}`);
  }
  out[`T1 every event card (${cards.length}, ${new Set(cards.map(c => c.type)).size} types) carries EXACTLY ONE <time class="feed-card-time"> (missing / doubled: ${missing.slice(0, 3).join(' ') || 'none'})`] = missing.length === 0 && cards.length > 40;
  out['T2 …its datetime and data-feed-time are the card\'s own event time (sortKey, the time the feed already sorts by), never the render clock'] = badIso.length === 0;
  out[`T3 every tappable card's VoiceOver label ends "{spoken time}. Opens details." (${badLabel.slice(0, 2).join(' | ') || 'all'})`] = badLabel.length === 0;
  const g21 = cards.find(c => c.type === 'game.final' && c.gameId === 'g21' && c.facts.standout);
  out['T4 the label is "{headline}. {supporting line}. {spoken time}. Opens details." — the supporting line is no longer dropped (the touched-screen fix)'] = !!g21 && labelOf(html(g21)) === 'Washington 20, Oregon 17 (Final) — Washington covered by 10. Brayden, Koby, Jacob and 1 other called it: Washington +7 won outright. 20 hours ago. Opens details.';
  const wr = cards.find(c => c.type === 'week.result' && c.weekId === 'w2');
  out['T5 a card whose headline ends in a full stop is not doubled ("final.. Opens details" was the old label)'] = !!wr && !/\.\./.test(labelOf(html(wr)));
  const t = /<time class="feed-card-time" datetime="[^"]*" data-feed-time="[^"]*" aria-label="([^"]*)">([^<]*)<\/time>/.exec(html(g21));
  out['T6 the <time> itself reads "20h ago" and carries the spoken form ("20 hours ago") for a card VoiceOver reads child by child'] = !!t && t[2] === '20h ago' && t[1] === '20 hours ago';
  const longPost = { ...cards.find(c => c.type === 'scribe.post'), facts: { messageId: 'm_s9', body: 'x'.repeat(30) + ' ' + 'word '.repeat(80), timestamp: iso(NOW - HOUR) }, sortKey: iso(NOW - HOUR) };
  const lp = labelOf(html(longPost));
  out['T7 a long SCRIBE post\'s label is trimmed to 160 characters BEFORE the time is added, so the time is never cut'] = !!lp && lp.endsWith('… 1 hour ago. Opens details.') && Array.from(lp.slice(0, lp.indexOf('… 1 hour ago'))).length <= 160;
  const unknown = html({ ...wr, sortKey: '1970-01-01T00:00:00.000Z' });
  out['T8 UNKNOWN beats wrong: a card whose event time is the epoch sentinel renders with NO time (and is not dropped)'] = !!unknown && timesIn(unknown) === 0 && /<h3 class="feed-card-title">Week 2 is final\.<\/h3>/.test(unknown) && labelOf(unknown).endsWith('Opens details.') && !SPOKEN_END.test(labelOf(unknown));
  const pick = cards.find(c => c.type === 'picks.submitted');
  const ph = pick ? html(pick, { now: Date.parse(pick.sortKey) + 3 * DAY }) : '';
  out['T9 the picks tally is the ONE prefixed card: "Opened 3d ago" (a living count dated to when the week opened), spoken "opened 3 days ago"'] = /data-feed-time-prefix="opened" aria-label="opened 3 days ago">Opened 3d ago<\/time>/.test(ph) && labelOf(ph).endsWith('opened 3 days ago. Opens details.');
  out['T10 …and no other card type carries the prefix'] = cards.filter(c => c.type !== 'picks.submitted').every(c => !/data-feed-time-prefix/.test(html(c)));
  const nfl = html({ ...wr, sport: 'nfl', sportCode: 'NFL', competitionId: 'c2' });
  out['T11 the time sits on the eyebrow\'s trailing edge in the order [icon][reason][sport chip][time][chevron], the trailing three in one group'] =
    /<div class="feed-card-eyebrow"><span class="feed-card-icon"[\s\S]*?<\/span><span class="feed-card-reason">[^<]*<\/span><span class="feed-card-trail"><span class="sport-chip">NFL<\/span><time class="feed-card-time"[^>]*>[^<]*<\/time><span class="feed-card-chev"[\s\S]*?<\/span><\/span><\/div>/.test(nfl);
  const plainWr = html(wr);
  out['T12 …and without a sport chip the group is [time][chevron]'] = /<span class="feed-card-trail"><time class="feed-card-time"[^>]*>[^<]*<\/time><span class="feed-card-chev"/.test(plainWr);
  out['T13 the time is NOT a live region (no aria-live, no role=status: a label change is never announced)'] = cards.every(c => !/<time[^>]*(aria-live|role=)/.test(html(c)));
  out['T14 with an injected formatDate the date form is the viewer\'s ("Sep 5" in UTC for week 1\'s game, 8 days earlier)'] = (() => { const g11 = cards.find(c => c.type === 'game.final' && c.gameId === 'g11'); return !!g11 && />Sep 5<\/time>/.test(html(g11, { formatDate: UTC_FMT })) && /aria-label="September 5"/.test(html(g11, { formatDate: UTC_FMT })); })();
  return out;
}

// ═══ [5] DI-W92-10 ═══════════════════════════════════════════════════════════════════════════════════════════════════
function freshLeague() {
  const L = league('final');
  L.games = L.games.map(g => (g.gameId === 'g24' ? { ...g, lastUpdated: iso(NOW) } : g));
  return L;
}
const KEY = 'game.final:L1:w2:-:g24';
function tickChecks(Hm) {
  const out = {};
  doc.hidden = false;
  const L = freshLeague();
  const e = mkHomeEnv({ home: Hm }, doc, L, { read: { currentWeek: () => L.weeks[1] } });
  const item = () => e.container.querySelector(`[data-card-key="${KEY}"]`);
  const timeEl = () => { const i = item(); return i ? i.querySelector('time') : null; };
  const card = () => { const i = item(); return i ? i.querySelector('article') : null; };
  const ticking = () => { try { return e.home._sessionForTest().timeTick === true; } catch { return false; } };
  e.home.renderHome();
  const t0 = timeEl(), a0 = card(), w0 = e.container.writes;
  out['R1 a real paint puts "Just now" on the card whose game just ended, and the card\'s label ends "just now. Opens details."'] = !!t0 && t0.textContent === 'Just now' && !!a0 && /just now\. Opens details\.$/.test(a0.getAttribute('aria-label') || '');
  out['R2 the paint ARMED the one 60-second timer (P-2: armed by a real paint, not by calling the arming function)'] = ticking();
  e.state.now = NOW + 61 * MIN;
  e.advance(60000);
  out['R3 61 minutes later the timer fires and "Just now" becomes "1h ago" (spoken "1 hour ago")'] = !!timeEl() && timeEl().textContent === '1h ago' && timeEl().getAttribute('aria-label') === '1 hour ago';
  out['R4 …and the card\'s own VoiceOver label is brought up to date too ("… 1 hour ago. Opens details.")'] = !!card() && /\. 1 hour ago\. Opens details\.$/.test(card().getAttribute('aria-label') || '');
  out['R5 …IN PLACE: no feed write, and the same nodes (the <time> and its card are the very objects painted before)'] = e.container.writes === w0 && timeEl() === t0 && card() === a0;
  out['R6 …and it re-arms itself (one timer, chained)'] = ticking();
  out['R7 the time is not a live region (no announcement on a label change)'] = !!timeEl() && !timeEl().hasAttribute('aria-live') && !timeEl().hasAttribute('role');
  // a hidden page does nothing
  doc.hidden = true;
  e.state.now += 2 * HOUR;
  e.advance(60000);
  out['R8 a HIDDEN page does nothing: the label stays "1h ago" and the timer is not re-armed'] = !!timeEl() && timeEl().textContent === '1h ago' && !ticking();
  // back to the foreground: once, at once
  doc.hidden = false;
  doc.dispatchEvent({ type: 'visibilitychange' });
  out['R9 returning to the foreground (visibilitychange to visible) updates the labels ONCE at once ("3h ago") and re-arms the timer'] = !!timeEl() && timeEl().textContent === '3h ago' && ticking() && e.container.writes === w0 && timeEl() === t0;
  // a repaint whose only change is a time does not rewrite the feed
  e.state.now += HOUR;
  e.home.renderHome();
  out['R10 a repaint whose ONLY change is a time label does not rewrite the feed: no write, same nodes, "4h ago"'] = e.container.writes === w0 && timeEl() === t0 && timeEl().textContent === '4h ago' && /\. 4 hours ago\. Opens details\.$/.test(card().getAttribute('aria-label') || '');
  // one timer, however many paints
  for (let i = 0; i < 5; i++) e.home.renderHome();
  out['R11 five more paints leave exactly ONE pending timer (each arming replaces the last)'] = e.pendingTimers() === 1 && ticking();
  // tab leave
  e.state.tab = 'dashboard';
  e.home.noteLeft();
  out['R12 leaving the tab clears the timer'] = !ticking() && e.pendingTimers() === 0;
  e.state.now += HOUR;
  e.advance(120000);
  out['R13 …so nothing is rewritten while Home is not the tab ("4h ago" stays)'] = !!timeEl() && timeEl().textContent === '4h ago';
  // withheld
  e.state.tab = 'home';
  e.home.renderHome();
  e.state.withheld = true;
  e.state.now += HOUR;
  e.advance(60000);
  out['R14 content withheld (S-C7): the tick writes nothing and stops'] = !ticking() && !!timeEl() && timeEl().textContent !== '6h ago';
  e.state.withheld = false;
  // a new reader (identity change) starts clean: the old timer is cleared with the session
  e.home.renderHome();
  e.state.identity = 'acct|L1|p2';
  e.home.renderHome();
  out['R15 an identity change clears the old session\'s timer with the rest of it (resetSession) — exactly one timer afterwards'] = ticking() && e.pendingTimers() === 1;
  return out;
}

// ═══ [6] DI-W92-11 static guards (the time half) ════════════════════════════════════════════════════════════════════
const TIME_CLASS_PINS = Object.freeze({ 'home.js': 1, 'content-card.js': 1 });
// chat-ui.js's one <time> is the chat message time footer (DI-573, not a feed card) — pinned, so a second one anywhere still fails.
const TIME_TAG_PINS = Object.freeze({ 'home.js': 1, 'content-card.js': 1, 'chat-ui.js': 1 });
function scanTimeEmitters(sources) {
  const v = [];
  const count = (src, re) => (stripComments(src).match(re) || []).length;
  for (const [f, src] of Object.entries(sources)) {
    const nc = count(src, /feed-card-time/g), nt = count(src, /<time\b/g);
    if (nc !== (TIME_CLASS_PINS[f] || 0)) v.push(`${f} names feed-card-time ${nc}x (pinned ${TIME_CLASS_PINS[f] || 0})`);
    if (nt !== (TIME_TAG_PINS[f] || 0)) v.push(`${f} writes <time ${nt}x (pinned ${TIME_TAG_PINS[f] || 0})`);
  }
  for (const f of new Set([...Object.keys(TIME_CLASS_PINS), ...Object.keys(TIME_TAG_PINS)])) if (!(f in sources)) v.push(`${f} is missing`);
  return v;
}
/** The exempt renderers (DI-W92-11's pinned list), by name, in the file that owns each: their bodies may not emit a time. */
const EXEMPT = Object.freeze([
  ['home.js', 'export function nowCardHTML('], ['home.js', 'export function renderNowCard('], ['home.js', 'function nudgeHTML('], ['home.js', 'export function joinNudgeHTML('],
  ['home.js', 'function newsNoteHTML('], ['home.js', 'function errorCardHTML('], ['home.js', 'function caughtUpHTML('], ['home.js', 'function dividerHTML('],
  ['home.js', 'function skeletonCardHTML('], ['home.js', 'function pillHTML('], ['content-card.js', 'export function renderContentErrorNote('],
  ['gameday.js', 'export function gameDayCardHTML('], ['gameday.js', 'export function gameDaySkeletonHTML('],
]);
function bodyOf(src, head) {
  const at = src.indexOf(head);
  if (at < 0) return null;
  let p = at + head.length - 1, pd = 0;                                      // skip the parameter list (it can hold a destructuring "{ escHtml }")
  for (; p < src.length; p++) { if (src[p] === '(') pd++; else if (src[p] === ')') { pd--; if (pd === 0) break; } }
  let i = src.indexOf('{', p), depth = 0;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); } }
  return null;
}
function exemptChecks(sources) {
  const bad = [];
  for (const [f, head] of EXEMPT) {
    const b = bodyOf(sources[f] || '', head);
    if (b === null) bad.push(`${f} ${head} not found`);
    else if (/feed-card-time|<time\b|timeLabels\(|relativeTime\(|spokenAgo\(|feedTimeHTML\(/.test(stripComments(b))) bad.push(`${f} ${head} emits a time`);
  }
  return bad;
}

// ═══ run ════════════════════════════════════════════════════════════════════════════════════════════════════════════
const jsDir = new URL('./js/', import.meta.url);
const jsFiles = (await readdir(jsDir)).filter(f => f.endsWith('.js'));
const SOURCES = Object.fromEntries(await Promise.all(jsFiles.map(async f => [f, await readFile(fileURLToPath(new URL(f, jsDir)), 'utf8')])));

if (!KIT_ONLY) {
  console.log('\n[1] DI-W92-7 — one shared time vocabulary…');
  for (const [l, ok] of Object.entries(vocabChecks(FT))) assert(ok === true, l);
  assert(NC.relativeTime === FT.relativeTime, 'V10 js/newsCard.js re-exports THE shared relativeTime (one function, its old export name kept for newstest)');

  console.log('\n[2] DI-W92-8 — every event card shows when it happened…');
  for (const [l, ok] of Object.entries(renderChecks(H))) assert(ok === true, l);
  {
    const L = league('final');
    const e = mkHomeEnv({ home: H }, doc, L, { read: { currentWeek: () => L.weeks[1] }, deps: { entrantsFor: () => L.players } });   // the viewer is an entrant (absent = nobody, fail closed)
    const v = e.home.resolveGameView('g21');
    assert(!!v && /<div class="gv-rel" data-card-key="game\.final:L1:w2:-:g21"><article[\s\S]*?<time class="feed-card-time"/.test(v.html), 'T15 the Game view\'s Related list carries the same card with its time (cardHTML is handed `now` there too)');
    e.home.renderHome();
    const all = e.container.querySelectorAll('.feed-item article.feed-card');
    const events = all.filter(a => !/feed-now|feed-note|feed-nudge|feed-join|feed-skel|news-card/.test(a.getAttribute('class') || '') && a.getAttribute('data-card-type'));
    assert(events.length > 10 && events.every(a => a.querySelectorAll('time').length === 1), `T16 painted through the real renderer, every one of the ${events.length} event cards on screen has one <time>`);
  }

  console.log('\n[3] DI-W92-8 — the style…');
  {
    const css = await read('./css/styles.css');
    const rule = (sel) => { const m = new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`).exec(css); return m ? m[2] : null; };
    const t = rule('.feed-card-time');
    assert(!!t && /font-size:\.75rem/.test(t) && /line-height:1\.35/.test(t) && /font-variant-numeric:tabular-nums/.test(t) && /color:var\(--text-secondary\)/.test(t) && /white-space:nowrap/.test(t),
      `S1 .feed-card-time is caption level: .75rem / 1.35, tabular figures, var(--text-secondary), nowrap (${t})`);
    assert(!!t && !/--text-muted|#[0-9a-fA-F]{3,8}|font-weight/.test(t), 'S2 …no --text-muted (it fails AA on a card), no colour literal, no new weight');
    const trail = rule('.feed-card-trail');
    assert(!!trail && /margin-left:auto/.test(trail) && /gap:8px/.test(trail) && /display:inline-flex/.test(trail) && /flex-wrap:wrap/.test(trail) && /justify-content:flex-end/.test(trail),
      `S3 the trailing group [chip][time][chevron] is pushed to the trailing edge as ONE (margin-left:auto), 8 pt apart, and wraps to its own right-aligned line at the largest text size (${trail})`);
    assert(/\.feed-card-trail > \*\{margin-left:0\}/.test(css), 'S4 …inside it the chip\'s and the chevron\'s own auto margins are neutralised, so the group never splits the row');
    const start = css.indexOf('SOCIAL PLATFORM v1 HOME'), end = css.indexOf('SOCIAL PLATFORM v1 HOME — END'), at = css.indexOf('\n.feed-card-time{');
    assert(start > 0 && end > start && at > start && at < end, 'S5 both rules live in the Home feed block (mobile-first, no new media query)');
  }

  console.log('\n[4] DI-W92-9 — news, storyline and content cards use the same vocabulary…');
  {
    const real = Date.now();
    const item = (ms) => ({ id: `n${ms}`, headline: 'Oregon rolls', source: 'ESPN', publisher: 'ESPN', sport: 'cfb', publishedAt: new Date(real - ms).toISOString(), reason: 'CFB' });
    const n2 = NC.renderNewsCard(item(2 * HOUR + 5 * MIN)), n8 = NC.renderNewsCard(item(8 * DAY));
    assert(/>2h ago</.test(n2), 'N1 a news card two hours old reads "2h ago" (the shared helper)');
    assert(!/8d ago/.test(n8) && /<span class="news-card__time" data-feed-time="[^"]+">[A-Z][a-z]{2} \d{1,2}(?:, \d{4})?<\/span>/.test(n8), 'N2 an eight-day-old item reads as a date, not "8d ago" (consistency with every other card), and carries data-feed-time so an open Home keeps it honest');
    const st = NC.renderStorylineCard({ ...item(30 * HOUR), storyline: { tag: 'Washington at Oregon' } });
    assert(/>Yesterday</.test(st), 'N3 a storyline card uses the same vocabulary ("Yesterday")');
    const CNOW = Date.parse('2026-10-08T17:00:00.000Z');
    const content = { id: 'content_00000000-0000-4000-8000-000000000001', cardKind: 'matchup.preview', sport: 'cfb', publishedAt: iso(CNOW - HOUR), freshAsOf: iso(CNOW - HOUR), eligibleUntil: iso(CNOW + DAY),
      card: { headline: 'Texas A&M at Missouri', away: { name: 'Texas A&M' }, home: { name: 'Missouri' }, kickoff: '2026-10-10T16:00:00.000Z', venue: 'Memorial Stadium', tv: ['ABC'] }, facts: [], sources: [], synthesisStatus: 'structured', reason: null };
    const cc = CC.renderContentCard(content, { now: CNOW, timeZone: 'UTC' });
    assert(timesIn(cc) === 1 && new RegExp(`<time class="feed-card-time" datetime="${iso(CNOW - HOUR).replace(/[.]/g, '\\.')}" data-feed-time="[^"]*" aria-label="1 hour ago">1h ago</time>`).test(cc), 'C1 a content card carries ONE <time> from its publishedAt (the time the feed sorts it by): "1h ago"');
    assert(labelOf(cc) === 'Matchup: Texas A&amp;M at Missouri, as of October 8. 1 hour ago. Opens details.', `C2 …and its VoiceOver label is the same form: "{label}. {spoken time}. Opens details." (${labelOf(cc)})`);
    assert(/as of Oct 8<\/p>/.test(cc) && CC.contentCaption(content, CNOW, { timeZone: 'UTC' }).text === 'From ESPN · as of Oct 8', 'C3 the "as of" caption is unchanged (it says when the facts were true, a different thing)');
    assert(/<span class="feed-card-trail"><time class="feed-card-time"[^>]*>1h ago<\/time><span class="feed-card-chev"/.test(cc), 'C4 the content card\'s time sits in the same trailing group, before the chevron');
    assert(timesIn(CC.renderContentCard({ ...content, publishedAt: 'nope' }, { now: CNOW })) === 0 && CC.renderContentCard({ ...content, publishedAt: 'nope' }, { now: CNOW }).length > 0, 'C5 a content card with no known publish time renders with no time (unknown beats wrong) and is not dropped');
  }

  console.log('\n[5] DI-W92-10 — the time stays honest while Home is open…');
  for (const [l, ok] of Object.entries(tickChecks(H))) assert(ok === true, l);

  console.log('\n[6] DI-W92-11 — who emits a time, and who never does…');
  {
    const v = scanTimeEmitters(SOURCES);
    assert(v.length === 0, `G1 P-11: across all ${jsFiles.length} js/*.js files, only home.js (cardHTML) and content-card.js (renderContentCard) name feed-card-time or write a <time>, exactly the pinned number of times (${v.join('; ') || 'clean'})`);
    const sw = await read('./service-worker.js'), lt = await read('./loadtest.mjs');
    assert(sw.includes("'./js/feed-time.js'") && /'feed-caption-lines', 'feed-time', 'home'/.test(lt), 'G0 the new module is precached by the service worker (a shell one module short is RG-236) and in loadtest [1]\'s import list (RG-03)');
    const b = exemptChecks(SOURCES);
    assert(b.length === 0, `G2 the ${EXEMPT.length} exempt renderers (Game Day / the Now card, the commissioner and join nudges, the news notes, the feed error card, "caught up", the dividers, the skeletons, the pill, the content error note) emit no time (${b.join('; ') || 'clean'})`);
    const L = league('final');
    const e = mkHomeEnv({ home: H }, doc, L, { read: { currentWeek: () => L.weeks[1] }, deps: { isDataReady: () => false } });
    e.home.renderHome();
    assert(e.container.querySelectorAll('.feed-skel').length > 0 && e.container.querySelectorAll('time').length === 0, 'G3 painted for real: the skeleton feed has no <time>');
    const e2 = mkHomeEnv({ home: H }, doc, L, { read: { currentWeek: () => L.weeks[1] } });
    e2.home.renderHome();
    const now = e2.container.querySelector('[data-card-key="now"]'), end = e2.container.querySelector('.feed-caught-up');
    assert(!!now && now.querySelectorAll('time').length === 0 && !!end && !/<time/.test(String(end.innerHTML || '')), 'G4 …and on a real content paint the pinned Game Day / Now card and the "caught up" line carry none (Game Day keeps its own "Updated 12s ago")');
  }
}

// ═══ [M] THE MUTATION KIT (S-3) ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n[M] MUTATION KIT — scratch copies loaded as data: URLs; each must turn a NAMED check RED…');
const URL_OF = (rel) => new URL(rel, import.meta.url).href;
async function loadMutant(rel, edits) {
  let src = await read(rel);
  for (const [a, b] of edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${a.slice(0, 120)}`);
    src = src.split(a).join(b);
  }
  src = src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${URL_OF('./js/' + f)}'`);
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}
async function kill(label, rel, edits, runner, mustFail) {
  let res = null, err = null;
  try { const mod = await loadMutant(rel, edits); res = await runner(mod); } catch (e) { err = e; }
  if (err) { assert(false, `${label} — the mutant could not be built: ${err.message}`); return; }
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every(m => failed.some(f => f.startsWith(m)));
  assert(failed.length > 0 && hit, `${label} → RED on: ${failed.slice(0, 4).map(f => f.slice(0, 80)).join(' | ') || '(nothing — the mutant SURVIVED)'}`);
}
{
  const ctl = { ...vocabChecks(FT), ...renderChecks(H), ...tickChecks(H) };
  assert(Object.values(ctl).every(Boolean), `K0: POSITIVE CONTROL — the real modules pass all ${Object.keys(ctl).length} named checks the kit re-runs`);
  const FTF = './js/feed-time.js', HF = './js/home.js';
  await kill('K1: the isKnownInstant check is removed (the epoch sentinel prints as a date)', FTF,
    [['  if (!isKnownInstant(v)) return null;\n', '']], vocabChecks, ['V3']);
  // A future instant is held to "just now" twice: the clamp (Math.max(0, …)) and the first bucket (`diff < MIN` also catches a negative). Each alone holds.
  {
    const noClamp = await loadMutant(FTF, [['const diff = Math.max(0, at - ms);', 'const diff = at - ms;']]);
    assert(vocabChecks(noClamp)['V2 a FUTURE instant (clock skew) reads "Just now" / "just now", never a negative'] === true, 'K2a: the clamp removed ALONE holds (the first bucket still catches a negative age)');
  }
  await kill('K2b: a future instant prints a negative ("-5m ago"): the clamp removed AND the first bucket limited to a non-negative age', FTF,
    [['const diff = Math.max(0, at - ms);', 'const diff = at - ms;'], ['if (diff < MIN) {', 'if (diff >= 0 && diff < MIN) {']], vocabChecks, ['V2']);
  await kill('K3: the time is omitted from the tappable card\'s aria-label', HF,
    [['aria-label="${escHtml(tapLabel(prefix, timeParts ? timeParts.spoken : \'\'))}"', 'aria-label="${escHtml(tapLabel(prefix, \'\'))}"']], renderChecks, ['T3', 'T4']);
  // The tick is in place twice over: it rewrites labels itself, and even a full repaint would be absorbed (absorbTimeOnly). Each alone holds.
  {
    const repaints = await loadMutant(HF, [['    refreshTimes(el, d.now(), { formatDate: tickFormat || undefined });\n    armTimeTick();\n  }', '    renderHome();\n    armTimeTick();\n  }']]);
    const r = tickChecks(repaints);
    assert(['R3', 'R5'].every(k => Object.entries(r).find(([l]) => l.startsWith(k))[1] === true), 'K4a: a tick that REPAINTS (renderHome) alone still holds R3/R5 — the paint path absorbs a time-only change in place');
  }
  await kill('K4b: the timer REBUILDS the feed AND the paint no longer absorbs time-only changes → the feed is rewritten every minute', HF,
    [['    refreshTimes(el, d.now(), { formatDate: tickFormat || undefined });\n    armTimeTick();\n  }', '    renderHome();\n    armTimeTick();\n  }'], ['const prev = absorbTimeOnly(el, items, prev0,', 'const prev = ((...a) => a[2])(el, items, prev0,']], tickChecks, ['R5']);
  await kill('K5: the tick also runs while the page is hidden', HF,
    [["if (typeof document !== 'undefined' && document && document.hidden === true) { stopTimeTick(); return; }", '']], tickChecks, ['R8']);
  await kill('K6: a repaint whose only change is a time rewrites the feed (the in-place absorb is removed)', HF,
    [['const prev = absorbTimeOnly(el, items, prev0,', 'const prev = ((...a) => a[2])(el, items, prev0,']], tickChecks, ['R10']);
  await kill('K7: leaving the tab no longer clears the timer', HF,
    [['    stopTimeTick();\n    if (seen.visibleSince === null) return false;', '    if (seen.visibleSince === null) return false;']], tickChecks, ['R12']);
  await kill('K8: the time is stamped with the RENDER clock, not the event', HF,
    [['const timeParts = timeLabels(card.sortKey, now,', 'const timeParts = timeLabels(now, now,']], renderChecks, ['T2']);
  // the static guards have teeth (in memory; the files are never touched)
  {
    const planted = { ...SOURCES, 'gameday.js': SOURCES['gameday.js'] + '\nconst x = `<time class="feed-card-time">now</time>`;' };
    const v1 = scanTimeEmitters(planted);
    assert(v1.some(x => x.startsWith('gameday.js names feed-card-time')) && v1.some(x => x.startsWith('gameday.js writes <time')), 'K9: G1 has teeth — a time planted in another module (gameday.js) is caught by name and by tag');
    const gone = { ...SOURCES, 'content-card.js': SOURCES['content-card.js'].split('feed-card-time').join('fct') };
    assert(scanTimeEmitters(gone).some(x => x.startsWith('content-card.js names feed-card-time 0x')), 'K10: …and a pinned occurrence that DISAPPEARS is caught too (content-card.js stopped emitting its time)');
    const exempt = { ...SOURCES, 'home.js': SOURCES['home.js'].replace('function dividerHTML(variant, { escHtml }) {', 'function dividerHTML(variant, { escHtml }) {\n  const t = timeLabels(Date.now(), Date.now());') };
    assert(exemptChecks(exempt).some(x => x.includes('dividerHTML')), 'K11: G2 has teeth — an exempt renderer (the NEW / EARLIER divider) that starts emitting a time is caught');
  }
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
