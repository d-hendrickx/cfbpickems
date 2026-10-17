/**
 * CFB Pickems — sportstatustest.mjs
 * ==================================
 * D1 (v0.30.0) Lane A — DI-522 / DI-554 / DI-237's pure module js/sport-status.js: the ONE derivation of a sport's card (state, pills, lock line, Games line, tap target, VoiceOver
 * sentence), the Join card for a sport the viewer has not joined, the due list the pill dot / switcher dots / glance chips all read, and the time formatters.
 *
 * Run:  node sportstatustest.mjs
 *
 *   [1]  structure — imports NOTHING (with a canary that proves the scan can fail), exports exactly the documented API.
 *   [2]  formatTimeLeft — a frozen table (the arithmetic app.js's timeUntil() always had).
 *   [3]  formatGameWindow — one day, two days, across the zone's midnight, no games, an unusable zone.
 *   [4]  deriveSportCardStatus — every state of DI-522's table, the derived-lock phase, the submit rules, a garbage input.
 *   [5]  sportCardView — the exact copy of every row of the table, 1 game vs N games, re-opened, the in-count suffix (counts only), the VoiceOver sentence.
 *   [6]  joinCardView — DI-554's table: Open → Join enabled; no week → enabled, "publishes Week N"; Locked / Live / Final → DISABLED with the stated caption; never gold, never "missing".
 *   [7]  sportsNeedingPicks / glanceChips — earliest lock first, excludes everything that is not "open, due, lock ahead".
 *   [8]  the blind rule — no output of this module ever contains a hidden-pick mark or an id; HTML-significant text passes through untouched (the renderer escapes at the sink).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SS = await import('./js/sport-status.js');
const { formatTimeLeft, formatGameWindow, deriveSportCardStatus, sportCardView, joinCardView, sportsNeedingPicks, glanceChips } = SS;

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] structure — a pure leaf…');
{
  const src = await readFile(join(HERE, 'js', 'sport-status.js'), 'utf8');
  const scan = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const hasImport = (text) => /^\s*import\b|\bimport\s*\(|\brequire\s*\(/m.test(scan(text));
  assert(!hasImport(src), '[1a] js/sport-status.js has no import, dynamic import or require');
  assert(hasImport(`import { x } from './storage.js';\n${src}`) && hasImport(`${src}\nconst m = await import('./app.js');`), '[1a] …and the scan is not vacuous: an injected static import and an injected dynamic import both fail it (canary)');
  assert(!/\b(localStorage|document|window|Date\.now|new Date\(\))\b/.test(scan(src).replace(/new Date\(ms\)/g, '')), '[1b] it touches no storage, no DOM and no clock (the caller hands it `now`)');
  assert(eq(Object.keys(SS).sort(), ['SPORT_STATES', 'deriveSportCardStatus', 'formatGameWindow', 'formatTimeLeft', 'glanceChips', 'joinCardView', 'joinClosedCaption', 'sportCardView', 'sportsNeedingPicks']),
    `[1c] the exported API is exactly the documented nine (the eighth + joinClosedCaption, DESIGN_D1_E: the closed Join's one sentence) (${Object.keys(SS).sort().join(', ')})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] formatTimeLeft — the frozen table…');
{
  const M = 60000, H = 60 * M, D = 24 * H;
  const table = [[0, ''], [-1, ''], [NaN, ''], [undefined, ''], ['x', ''], [1, '0m'], [59999, '0m'], [M, '1m'], [59 * M, '59m'], [H, '1h 0m'], [H + M, '1h 1m'], [23 * H + 59 * M, '23h 59m'],
    [D, '1d 0h'], [D + H, '1d 1h'], [2 * D + 5 * H + M, '2d 5h'], [10 * D + 23 * H + 59 * M, '10d 23h']];
  const bad = table.filter(([ms, want]) => formatTimeLeft(ms) !== want).map(([ms, want]) => `${ms} -> ${formatTimeLeft(ms)} (want ${want})`);
  assert(bad.length === 0, `[2a] ${table.length} frozen cases${bad.length ? ': ' + bad.join('; ') : ''}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] formatGameWindow — the days the games are played, in the viewer\'s zone…');
{
  const LA = 'America/Los_Angeles', UTC = 'UTC';
  const at = (iso) => Date.parse(iso);
  assert(formatGameWindow(at('2026-10-10T16:00:00Z'), at('2026-10-11T03:30:00Z'), LA) === 'Sat Oct 10', `[3a] same local day: "${formatGameWindow(at('2026-10-10T16:00:00Z'), at('2026-10-11T03:30:00Z'), LA)}"`);
  assert(formatGameWindow(at('2026-10-11T17:00:00Z'), at('2026-10-13T01:00:00Z'), UTC) === 'Sun Oct 11 – Tue Oct 13', `[3b] two days apart: an en dash between them ("${formatGameWindow(at('2026-10-11T17:00:00Z'), at('2026-10-13T01:00:00Z'), UTC)}")`);
  // the SAME instants fall on one day in LA and two in UTC: the zone is the viewer's, not the server's
  const f = at('2026-10-11T20:00:00Z'), l = at('2026-10-12T02:00:00Z');
  assert(formatGameWindow(f, l, LA) === 'Sun Oct 11' && formatGameWindow(f, l, UTC) === 'Sun Oct 11 – Mon Oct 12', `[3c] the window follows the zone (LA "${formatGameWindow(f, l, LA)}", UTC "${formatGameWindow(f, l, UTC)}")`);
  assert(formatGameWindow(f, undefined, UTC) === 'Sun Oct 11' && formatGameWindow(f, NaN, UTC) === 'Sun Oct 11', '[3d] a missing last kickoff is a one-day window');
  assert(formatGameWindow(l, f, UTC) === 'Mon Oct 12', '[3e] a last kickoff BEFORE the first is ignored (one day, the first)');
  assert(formatGameWindow(null, null, UTC) === '' && formatGameWindow(undefined, f, UTC) === '' && formatGameWindow(NaN, f, UTC) === '', '[3f] no first kickoff means "" — never a guessed date');
  assert(formatGameWindow(f, l, 'Not/AZone') === '', '[3g] an unusable zone reads as "" (no row), never a throw or a wrong zone');
  assert(formatGameWindow(at('2026-12-31T23:00:00Z'), at('2027-01-01T20:00:00Z'), UTC) === 'Thu Dec 31 – Fri Jan 1', '[3h] across a year boundary the two labels are distinct days');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] deriveSportCardStatus — DI-522\'s state table…');
{
  const base = { hasWeek: true, totalGames: 10, liveGames: 0, finalGames: 0, lockAtMs: 5000, firstKickoffMs: 6000, lastKickoffMs: 9000 };
  const d = (o) => deriveSportCardStatus({ ...base, ...o });
  assert(d({ hasWeek: false }).state === 'none' && d({ hasWeek: false }).submit === null, '[4a] no current week: none');
  assert(d({ phase: 'draft' }).state === 'upcoming' && d({ phase: 'draft', isCommissioner: true }).state === 'draft', '[4b] a draft week is Upcoming for a member and Draft for the commissioner');
  const open = d({ phase: 'open', submitted: false });
  assert(open.state === 'open' && open.submit === 'due' && open.enterTab === 'picks', '[4c] open, not submitted: submit due, a tap goes to Picks');
  const done = d({ phase: 'open', submitted: true });
  assert(done.submit === 'submitted' && done.enterTab === 'dashboard', '[4d] open, submitted: submitted, a tap goes to the Dashboard');
  assert(d({ phase: 'open', canSubmit: false }).submit === null, '[4e] open and not eligible to submit (a demo week, a non-entrant): no submit pill at all');
  assert(d({ phase: 'open', reopened: true }).reopened === true && d({ phase: 'open' }).reopened === false, '[4f] a re-opened week says so');
  const lockedNo = d({ phase: 'locked', submitted: false });
  assert(lockedNo.state === 'locked' && lockedNo.submit === 'not_submitted' && lockedNo.enterTab === 'dashboard', '[4g] locked, not submitted: Not submitted, Dashboard');
  assert(d({ phase: 'locked', submitted: true }).submit === 'submitted', '[4g] locked and submitted: Submitted');
  assert(d({ phase: 'live', liveGames: 3, finalGames: 1 }).state === 'live' && d({ phase: 'live' }).submit === 'not_submitted', '[4h] live: the same submit rule as locked');
  assert(d({ phase: 'final' }).state === 'final' && d({ phase: 'final' }).submit === null, '[4i] final: no submit pill');
  assert(d({ phase: 'banana' }).state === 'error' && d({ phase: undefined }).state === 'error', '[4j] an unknown phase is the error state, never open');
  assert(deriveSportCardStatus(null).state === 'none' && deriveSportCardStatus(undefined).state === 'none' && deriveSportCardStatus('x').state === 'none', '[4k] garbage input never throws (and with no week reads as none)');
  assert(deriveSportCardStatus({ hasWeek: true, phase: 'open', failed: true }).state === 'error', '[4k] …and `failed: true` (the caller could not read its inputs) is the error state — "Status unavailable", never a guess');
  const weird = d({ phase: 'open', totalGames: '12', liveGames: -4, lockAtMs: 'soon', firstKickoffMs: NaN });
  assert(weird.totalGames === 12 && weird.liveGames === 0 && weird.lockAtMs === null && weird.firstKickoffMs === null, '[4l] counts are coerced, a non-finite time is null');
  assert(d({ phase: 'final', nextWeekPublished: false }).nextWeekPublished === false && d({ phase: 'final' }).nextWeekPublished === null, '[4m] nextWeekPublished is true | false | null (unknown says nothing)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] sportCardView — every row of the table, the exact copy…');
{
  const T = { sportName: 'NFL', code: 'NFL', weekLabel: 'Week 6', windowText: 'Sun Oct 11 – Mon Oct 12', leftText: '1d 3h', lockWhenText: 'Sun 10/11 12:30 PT', kickoffWhenText: 'Sun 10/11 1:00 PT' };
  const st = (o) => deriveSportCardStatus({ hasWeek: true, totalGames: 10, liveGames: 0, finalGames: 0, lockAtMs: 1, firstKickoffMs: 2, lastKickoffMs: 3, ...o });
  const v = (o, t = {}) => sportCardView(st(o), { ...T, ...t });
  const texts = (view) => view.pills.map((p) => p.text);

  let x = v({ phase: 'open', submitted: false });
  assert(eq(texts(x), ['Open · 10 games', 'Picks due in 1d 3h']) && x.pills[1].tone === 'due' && x.line === 'Locks Sun 10/11 12:30 PT' && x.windowLine === 'Games Sun Oct 11 – Mon Oct 12' && x.enterTab === 'picks',
    `[5a] open, due: ${JSON.stringify(texts(x))} / "${x.line}" / "${x.windowLine}"`);
  x = v({ phase: 'open', submitted: true });
  assert(eq(texts(x), ['Open · 10 games', 'Submitted']) && x.pills[1].tone === 'ok' && x.pills[1].check === true && x.enterTab === 'dashboard', '[5b] open, submitted: the green Submitted pill with a check');
  x = v({ phase: 'open', totalGames: 1 }, {});
  assert(texts(x)[0] === 'Open · 1 game', '[5c] one game reads "1 game", never "1 games"');
  x = v({ phase: 'open', totalGames: 0 });
  assert(texts(x)[0] === 'Open' && x.line === 'No games on the slate yet' && x.windowLine === '', '[5d] open with no games: "Open", "No games on the slate yet", no Games row');
  x = v({ phase: 'open', reopened: true });
  assert(x.line === 'Re-opened · locks Sun 10/11 12:30 PT', `[5e] re-opened: "${x.line}"`);
  x = v({ phase: 'open', submitted: false }, { inCountText: '4 of 6 in' });
  assert(x.line === 'Locks Sun 10/11 12:30 PT · 4 of 6 in', `[5f] the in-count is appended, counts only: "${x.line}"`);
  x = v({ phase: 'open', submitted: false }, { inCountText: '' });
  assert(x.line === 'Locks Sun 10/11 12:30 PT', '[5f] …and absent when there is no count (nothing invented)');
  x = v({ phase: 'locked', submitted: true });
  assert(eq(texts(x), ['Locked', 'Submitted']) && x.line === 'Kicks off Sun 10/11 1:00 PT' && x.windowLine !== '', `[5g] locked + submitted: "${x.line}"`);
  x = v({ phase: 'locked', submitted: false }, { kickoffWhenText: '' });
  assert(eq(texts(x), ['Locked', 'Not submitted']) && x.line === '', '[5h] locked, kickoff already behind us: no "Kicks off" line, and Not submitted is neutral');
  assert(x.pills[1].tone === 'nd', '[5h] …never red or gold (a late member is not shamed)');
  x = v({ phase: 'live', liveGames: 3, finalGames: 1, submitted: true });
  assert(eq(texts(x), ['Live', 'Submitted']) && x.pills[0].dot === true && x.line === '3 live · 1 of 10 final', `[5i] live: "${x.line}"`);
  x = v({ phase: 'final' });
  assert(eq(texts(x), ['Final']) && x.line === 'All games final' && x.windowLine === '', '[5j] final: "All games final", no Games row');
  x = v({ phase: 'final', nextWeekPublished: false });
  assert(x.line === "All games final · Next week isn't published yet", `[5k] final with no next week: "${x.line}"`);
  x = v({ hasWeek: false }, { isCommissioner: false });
  assert(eq(texts(x), ['No week yet']) && x.line === "Picks aren't open yet" && x.setup === null && x.windowLine === '', '[5l] no week, member: "Picks aren\'t open yet", nothing to set up');
  x = v({ hasWeek: false }, { isCommissioner: true, canSetupWeek: true, nextWeekN: 7 });
  assert(x.line === 'Set up the first week to open picks' && x.setup === 'Set up Week 7', '[5m] no week, commissioner with the means: the line and a separate "Set up Week 7"');
  x = v({ hasWeek: false }, { isCommissioner: true, canSetupWeek: false });
  assert(x.line === 'Set up the first week to open picks' && x.setup === null, '[5m] …and without the means the line stays but no dead button is offered');
  x = v({ phase: 'draft' });
  assert(eq(texts(x), ['Upcoming']) && x.line === "Picks aren't open yet" && x.windowLine === '', '[5n] a draft week, member view: Upcoming, no window (a draft slate is private)');
  x = v({ phase: 'draft', isCommissioner: true });
  assert(eq(texts(x), ['Draft · 10 games']) && x.line === 'Not published yet' && x.windowLine !== '', '[5o] a draft week, commissioner: "Draft · 10 games" / "Not published yet" / the Games row');
  x = sportCardView({ state: 'error' }, T);
  assert(x.pills.length === 0 && x.line === 'Status unavailable', '[5p] the error state: "Status unavailable", no pills');
  x = sportCardView(undefined, undefined);
  assert(x.line === 'Status unavailable', '[5p] …and an undefined status is the same, never a throw');
  x = v({ phase: 'open', submitted: false });
  assert(x.ariaLabel === 'NFL, Week 6, Open · 10 games, Picks due in 1d 3h, Locks Sun 10/11 12:30 PT, games Sun Oct 11 – Mon Oct 12. Opens Picks. Double tap to open.', `[5q] the VoiceOver sentence: ${x.ariaLabel}`);
  x = v({ phase: 'live', liveGames: 2 });
  assert(/Opens the Dashboard\. Double tap to open\.$/.test(x.ariaLabel), '[5r] …and names the Dashboard when that is where a tap goes');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] joinCardView — a sport the viewer has not joined…');
{
  const T = { sportName: 'NFL', code: 'NFL', weekLabel: 'Week 6', windowText: 'Sun Oct 11 – Mon Oct 12', lockWhenText: 'Sun 10/11 12:30 PT', nextWeekN: 7 };
  const st = (o) => deriveSportCardStatus({ hasWeek: true, totalGames: 10, liveGames: 2, finalGames: 0, ...o, submitted: true, canSubmit: false });
  const j = (o, t = {}) => joinCardView(st(o), { ...T, ...t });
  const texts = (view) => view.pills.map((p) => p.text);
  let x = j({ phase: 'open' });
  assert(eq(texts(x), ['Optional', 'Open · 10 games']) && x.line === 'Picks lock Sun 10/11 12:30 PT' && x.windowLine === 'Games Sun Oct 11 – Mon Oct 12' && x.joinEnabled === true && x.caption === '',
    `[6a] open before the lock: ${JSON.stringify(texts(x))} / "${x.line}" / Join enabled`);
  x = j({ hasWeek: false });
  assert(eq(texts(x), ['Optional', 'No week yet']) && x.line === 'Picks open when the commissioner publishes Week 7.' && x.joinEnabled === true && x.windowLine === '', `[6b] no week: "${x.line}", Join enabled (joining between weeks is allowed)`);
  x = j({ phase: 'draft' });
  assert(x.joinEnabled === true && x.line === 'Picks open when the commissioner publishes Week 7.', '[6c] a draft week (private to members) reads as "not published yet" and Join stays enabled');
  x = j({ phase: 'locked' });
  assert(eq(texts(x), ['Optional', 'Locked']) && x.joinEnabled === false && x.caption === 'You can join when the next NFL week opens.' && x.line === 'Games Sun Oct 11 – Mon Oct 12',
    `[6d] locked: Join DISABLED with the caption "${x.caption}"`);
  x = j({ phase: 'live' });
  assert(x.pills[1].text === 'Live · 2 games' && x.pills[1].dot === true && x.joinEnabled === false, `[6e] live: "${x.pills[1] && x.pills[1].text}", Join disabled`);
  x = j({ phase: 'final' });
  assert(eq(texts(x), ['Optional', 'Final']) && x.joinEnabled === false, '[6f] final: Join disabled (the week is over; the next one opens it)');
  assert(!x.pills.some((p) => p.tone === 'due') && !/due|late|missing|behind/i.test(`${x.line} ${x.caption} ${x.ariaLabel}`.replace(/Double tap/g, '')), '[6g] a non-entrant is never shown as due, late, missing or behind');
  x = j({ phase: 'open' });
  assert(x.body === "NFL picks are optional in this league. Join to make weekly picks and appear in NFL standings. Nothing counts against you if you don't.", '[6h] the explanatory sentence is DI-554\'s, with the sport\'s code');
  assert(j({ phase: 'banana' }).joinEnabled === false, '[6i] an unknown state never enables Join (fail closed)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] sportsNeedingPicks / glanceChips…');
{
  const mk = (dbCode, code, o) => ({ dbCode, code, status: deriveSportCardStatus({ hasWeek: true, totalGames: 5, ...o }) });
  const NOW = 1000000;
  const items = [
    mk('nfl', 'NFL', { phase: 'open', lockAtMs: NOW + 3 * 3600000 + 5 * 60000 }),
    mk('cfb', 'CFB', { phase: 'open', lockAtMs: NOW + 2 * 3600000 }),
    mk('nhl', 'NHL', { phase: 'open', lockAtMs: NOW + 3600000, submitted: true }),     // submitted: not due
    mk('nba', 'NBA', { phase: 'locked', lockAtMs: NOW - 1 }),                          // locked
    mk('cbb', 'CBB', { phase: 'open', lockAtMs: NOW - 5 }),                            // lock already behind (stale open)
    mk('mm', 'MM', { phase: 'open', lockAtMs: null }),                                 // no lock instant
    mk('wjc', 'WJC', { phase: 'open', canSubmit: false, lockAtMs: NOW + 99 }),         // cannot submit
  ];
  const due = sportsNeedingPicks(items, NOW);
  assert(eq(due.map((x) => x.dbCode), ['cfb', 'nfl']), `[7a] only open + due + lock ahead, earliest lock first (${due.map((x) => x.dbCode)})`);
  assert(due[0].left === '2h 0m' && due[1].left === '3h 5m', `[7b] each carries its time left (${due.map((x) => x.left)})`);
  assert(eq(sportsNeedingPicks([], NOW), []) && eq(sportsNeedingPicks(null, NOW), []) && eq(sportsNeedingPicks([null, {}, { status: null }], NOW), []), '[7c] empty, null and junk give []');
  let chips = glanceChips({ due, liveCount: 3 });
  // RE-DERIVED 2026-10-08 (Part 2 item 7, Drew's D-60 mockup). OLD [7d]: "two chips: the NEXT deadline only, then the live count" - ['Picks due · CFB · in 2h 0m', '3 live now']. NEW: ONE chip per sport whose
  // picks are due (earliest lock first), then the live count - the member sees every deadline, not only the nearest.
  assert(eq(chips.map((c) => c.text), ['Picks due · CFB · in 2h 0m', 'Picks due · NFL · in 3h 5m', '3 live now']) && chips[0].dbCode === 'cfb' && chips[1].dbCode === 'nfl' && chips.slice(0, 2).every((c) => c.kind === 'due' && c.tab === 'picks'), `[7d] one chip per due sport, earliest lock first, then the live count (${chips.map((c) => c.text)})`);
  assert(eq(glanceChips({ due: due.slice(0, 1), liveCount: 0 }).map((c) => c.text), ['Picks due · CFB · in 2h 0m']) && glanceChips({ due: [null, undefined, { code: 'X' }], liveCount: 0 }).every((c) => c.kind === 'due') , '[7d2] one due sport: one chip; junk entries in the list never throw');
  assert(eq(glanceChips({ due: [], liveCount: 0 }), []) && eq(glanceChips({}), []) && eq(glanceChips(), []), '[7e] nothing due and nothing live: no chips');
  chips = glanceChips({ due: [], liveCount: 1 });
  assert(eq(chips.map((c) => c.text), ['1 live now']), '[7f] one live game: "1 live now"');
  assert(glanceChips({ due: [], liveCount: -2 }).length === 0 && glanceChips({ due: [], liveCount: 'x' }).length === 0 && glanceChips({ due: [], liveCount: 2.9 })[0].text === '2 live now', '[7g] a chip never shows a number that is not a fact (negative / non-numeric → none; a fraction floors)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] the blind rule, and text passes through untouched…');
{
  const everything = [];
  for (const phase of ['draft', 'open', 'locked', 'live', 'final']) {
    for (const submitted of [true, false]) {
      const s = deriveSportCardStatus({ hasWeek: true, phase, submitted, totalGames: 3, liveGames: 1, finalGames: 1, lockAtMs: 5, firstKickoffMs: 9, lastKickoffMs: 10, isCommissioner: submitted });
      everything.push(JSON.stringify(sportCardView(s, { sportName: 'NFL', code: 'NFL', weekLabel: 'Week 6', windowText: 'Sun Oct 11', leftText: '1h 0m', lockWhenText: 'x', kickoffWhenText: 'y', inCountText: '4 of 6 in' })));
      everything.push(JSON.stringify(joinCardView(s, { sportName: 'NFL', code: 'NFL', windowText: 'Sun Oct 11', lockWhenText: 'x' })));
    }
  }
  const blob = everything.join('\n');
  assert(!/•••|playerId|memberId|"p\d"|picked|selectedTeam/.test(blob), `[8a] across ${everything.length} outputs there is no hidden-pick mark, no id and no pick (the module admits only the viewer's own boolean and counts)`);
  const hostile = '"><img src=x onerror=alert(1)>';
  const view = sportCardView(deriveSportCardStatus({ hasWeek: true, phase: 'open', totalGames: 2 }), { sportName: hostile, code: hostile, weekLabel: hostile, windowText: hostile, leftText: hostile, lockWhenText: hostile });
  assert(view.ariaLabel.includes(hostile) && view.line.includes(hostile), '[8b] hostile text is returned verbatim as DATA (this module builds no HTML); escaping is the renderer\'s job at the sink and leagueoverviewtest proves it there');
}

// ═════════════════════════════════════════════════
console.log('\n[9] one time-left formatter: the app\'s timeUntil() IS formatTimeLeft()…');
{
  // The body app.js's timeUntil() carried before D1 (the reference), copied verbatim.
  const former = (target, now) => {
    if (!target) return '';
    const ms = target.getTime() - now;
    if (ms <= 0) return '';
    const mins = Math.floor(ms / 60000);
    const d = Math.floor(mins / 1440);
    const h = Math.floor((mins % 1440) / 60);
    const m = mins % 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };
  const now = Date.parse('2026-10-08T15:00:00.000Z');
  const probes = [-1000, 0, 1, 59_999, 60_000, 61_000, 3_599_999, 3_600_000, 3_660_000, 7_325_000, 86_399_999, 86_400_000, 90_061_000, 172_800_000, 604_800_000, 3_000_000_000];
  const diffs = probes.filter((ms) => formatTimeLeft(ms) !== former(new Date(now + ms), now));
  assert(diffs.length === 0, `[9a] formatTimeLeft(ms) equals the former timeUntil() body on ${probes.length} probes, either side of every unit boundary (differing: ${diffs.join(', ') || 'none'})`);
  assert(formatTimeLeft(NaN) === '' && formatTimeLeft(undefined) === '' && formatTimeLeft('x') === '' && formatTimeLeft(null) === '', '[9b] a non-number says nothing (timeUntil never passed one)');
  const app = (await import('node:fs/promises')).readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const src = (await app).replace(/\/\*[\s\S]*?\*\//g, '');
  const body = (src.match(/function timeUntil\(target\) \{[\s\S]*?\n\}/) || [''])[0];
  assert(/return formatTimeLeft\(target\.getTime\(\) - Date\.now\(\)\);/.test(body) && !/Math\.floor/.test(body), '[9c] [structural] app.js timeUntil() delegates to formatTimeLeft() and keeps no copy of the arithmetic (two formatters would drift)');
}

console.log('\n' + (fail ? '❌ FAILURES' : '✅ ALL PASS') + ` — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
