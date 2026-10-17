/**
 * CFB Pickems - sportstalltest.mjs
 * =================================
 * D1 (v0.30.0, thread 100726-D1, Lane A), DI-557 + DI-535 #4 (DI-224 R3 / R10): THE STALL BANNER. UN-425 / PF-425 (the player line: UN-229).
 *
 * A sport whose scores stop moving is told to the people who need to know, in the app's own in-page notice (caution, never red), without ever outranking the red sync banner. The real js/app.js
 * runs against a REAL element tree built from index.html (minidom.mjs) on sportenv.mjs's local store, so a page's order of children, the identity of a node across a repaint and what a
 * second paint leaves untouched are all observed, not inferred. Every poll below is the REAL doRefreshScores() (or the real runAutoRefreshTick()) over a stubbed ESPN: nothing here calls the
 * paint directly to "arm" it (P-2).
 *
 *   [1]  THE PURE MODULE (js/sport-stall.js): the four sentences verbatim, the per-competition record (consecutive, neutral polls, a zero-event board is a success), the server's own window,
 *        the rows for each trigger / audience / page scope, the repaint key (ids and trigger numbers, never a code), the markup and its escaping, and that the module is a leaf.
 *   [2]  TRIGGER 2 THROUGH THE REAL POLL: two failures show nothing, the third shows the row (commissioner and player copy), a fourth leaves one row, one success removes it at once and resets the
 *        count, two failures after that show nothing. CFB failing never clears or is cleared by NFL. A zero-event scoreboard is a success.
 *   [3]  NEUTRAL POLLS: a demo or manual week, a game list with nothing to refresh, a held device, a tick skipped because the last round is still running: none counts, none clears.
 *   [4]  THE WINDOW: all FINAL, a kickoff 7 h ago, a Draft or Open week: no row; a LIVE game, a kickoff 5 h ago: a row.
 *   [5]  TRIGGERS 1 AND 3: a live competition that resolves to no week (stubbed, a tripwire): the commissioner's row and nothing for a player; an unrecognized game tag or sport key: the commissioner
 *        row naming it, the player line; a FINAL game and a demo week raise nothing.
 *   [6]  ESCAPING, PERSISTENCE, IDENTITY: a hostile sport code / label leaves no tag or attribute break; the record is never saved (no write, no stored key); an account or league change clears it.
 *   [7]  RED WINS: with the REAL red banner up no stall banner exists after a paint and the red node is byte-identical; hidden, the next paint shows the row.
 *   [8]  RENDER PATHS AND SCOPE: Home / Comm every sport; Picks / Standings the context sport; Dashboard its scope (All sports = the sports the viewer plays); Rules / Chat / Admin none; the order
 *        maintenance, paused-league, stall; one banner, the same node on an unchanged repaint, a new node (with the one fade) on a changed row set; before the hydrate nothing.
 *   [8b] NOTHING MOVES UNDER THE THUMB (the decision, in an element tree with no layout): a banner arriving or leaving IN PLACE on a page scrolled down offsets the scroller by exactly its block
 *        height (never above the top); at the top, and for a navigation or a same-rows rebuild, it does not. The offset is MEASURED frame by frame in sportstallbrowsertest.mjs [D].
 *   [9]  THE IN-PLACE PAINT IS ARMED BY A REAL POLL (P-2): Picks, Standings and Comm are never rebuilt by a poll, yet the banner appears on them when a real doRefreshScores / runAutoRefreshTick
 *        changes the record; and a repaint parked under a touch runs at release without blocking the next touch (P-3).
 *   [10] SOURCE SHAPE: each renderer ends with the call, below the two sibling notices; the stall code never writes the red node; the record's only writer is doRefreshScores, after the fetch;
 *        nothing in the stall code reaches the storage seam; the CSS contract (16 px, one fade on the arriving node only, Reduce Motion, tokens, no hex).
 *
 * Mutation proofs: tests/kits/d1-stall-mutants.mjs (the mutants, and the RED each one names, are in that one file).
 * NOT COVERED HERE (a real engine, then a device): computed style, the fade and the scroll offset are proven in sportstallbrowsertest.mjs; VoiceOver, WKWebView's scroll handling and the feel on
 * glass are Drew's on-device walk.
 *
 * Run: node sportstalltest.mjs      (TZ-independent)
 */
import { readFileSync } from 'node:fs';
import { makeEnv, withMutantApp, NOW, CID, LEAGUE, mkGame, mkWeek } from './sportenv.mjs';
import { MiniDocument } from './minidom.mjs';

let pass = 0, fail = 0;
const realLog = console.log.bind(console), realErr = console.error.bind(console);   // captured before quiet() can swap them: a failure must never be swallowed
function assert(cond, label) {
  if (cond) { pass++; realLog('  ✅', label); }
  else { fail++; realErr('  ❌', label); }
}
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')).join('\n');
const realWarn = console.warn, realInfo = console.info, realError = console.error;
const quiet = () => { console.warn = () => {}; console.info = () => {}; console.error = () => {}; };
const loud = () => { console.warn = realWarn; console.info = realInfo; console.error = realError; };

const SM = await import('./js/sport-stall.js');
const { icon: iconOf } = await import('./js/icons.js');
const env = await makeEnv();
const { app, st, comp, auth } = env;
const NG = await import('./js/nav-gestures.js');

// ── the copy, typed HERE again (not imported), so a drift in the module is a red assertion ───────────────────────────────────────────────────────
const C = {
  noWeek: (s) => `${s}'s week isn't being tracked — nothing will lock or update automatically. Open Comm → Week and check the slate.`,
  feedCommissioner: (s) => `${s} scores aren't updating — the live feed failed. Scores may be stale until this is fixed.`,
  feedPlayer: (s) => `${s} scores are delayed — picks and locks still work as normal.`,
  unknown: (code) => `A game is tagged with a sport this app doesn't recognize (${code}) — it won't fetch scores until this is corrected.`,
};

// ═════════════════════════════════════════════════════════════════
console.log('\n[1] THE PURE MODULE - copy, record, window, rows, key, markup, leaf…');
// ═════════════════════════════════════════════════════════════════
{
  assert(SM.STALL_COPY.noWeek('NFL') === C.noWeek('NFL') && SM.STALL_COPY.feedCommissioner('NFL') === C.feedCommissioner('NFL')
    && SM.STALL_COPY.feedPlayer('NFL') === C.feedPlayer('NFL') && SM.STALL_COPY.unknownTag('xyz') === C.unknown('xyz'),
    '[1a] the four sentences are DI-535 #4 verbatim (straight apostrophes, em dashes, the arrow)');
  assert(SM.STALL_FAILURE_THRESHOLD === 3 && SM.STALL_WINDOW_HOURS === 6 && JSON.stringify(SM.STALL_PAGES) === '["home","picks","dashboard","leaderboard","commissioner"]',
    '[1b] three consecutive failures; the server\'s own 6 h window; the five pages and no other');

  // the record
  const h = SM.createPollHealth();
  assert(h instanceof Map && SM.pollFailures(h, 'a') === 0, '[1c] a fresh record is an empty Map');
  assert(SM.notePoll(h, 'a', 'failed', 1) === true && SM.notePoll(h, 'a', 'failed', 2) === true && SM.pollFailures(h, 'a') === 2, '[1d] failed polls count and report a change');
  assert(SM.notePoll(h, 'a', undefined, 3) === false && SM.notePoll(h, 'a', null, 3) === false && SM.notePoll(h, 'a', '', 3) === false && SM.notePoll(h, 'a', 'nonsense', 3) === false && SM.pollFailures(h, 'a') === 2,
    '[1e] a poll that never reached ESPN (no outcome) neither counts nor clears');
  assert(SM.notePoll(h, 'b', 'failed', 3) === true && SM.pollFailures(h, 'a') === 2 && SM.pollFailures(h, 'b') === 1, '[1f] the record is per competition: b\'s failure is not a\'s');
  assert(SM.notePoll(h, 'a', 'failed', 4) && SM.pollFailures(h, 'a') === 3, '[1g] the third consecutive failure is a count of three');
  assert(SM.notePoll(h, 'a', 'ok', 5) === true && SM.pollFailures(h, 'a') === 0 && SM.notePoll(h, 'a', 'ok', 6) === false, '[1h] one success resets to zero and reports a change; a success with nothing to clear reports none (no pointless repaint)');
  SM.notePoll(h, 'a', 'failed', 7); SM.notePoll(h, 'a', 'failed', 8);
  assert(SM.notePoll(h, 'a', 'empty', 9) === true && SM.pollFailures(h, 'a') === 0, '[1i] a scoreboard with ZERO events is a success: it resets the count');
  SM.notePoll(h, '__proto__', 'failed', 1);
  assert(SM.pollFailures(h, '__proto__') === 1 && ({}).failures === undefined, '[1j] an id of __proto__ is just a key (a Map, never an object)');
  assert(SM.notePoll({}, 'a', 'failed', 1) === false && SM.notePoll(h, '', 'failed', 1) === false, '[1k] a non-Map store or an empty id is refused, not thrown');
  SM.clearPollHealth(h);
  assert(h.size === 0, '[1l] clearPollHealth empties the record');

  // the window
  const H = 3600e3, now = NOW;
  const wk = (status, extra = {}) => ({ status, dataSourceMode: 'live', ...extra });
  const g = (status, hoursAgo, extra = {}) => ({ status, kickoff: new Date(now - hoursAgo * H).toISOString(), ...extra });
  const W = SM.inActiveWindow;
  assert(W(wk('locked'), [g('scheduled', 1)], now) && W(wk('live'), [g('live', 2), g('scheduled', -3)], now), '[1m] locked or live, a game kicked off in the last 6 h: IN the window');
  assert(!W(wk('draft'), [g('scheduled', 1)], now) && !W(wk('open'), [g('scheduled', 1)], now) && !W(wk('final'), [g('scheduled', 1)], now), '[1n] Draft, Open and Final weeks are never in the window');
  assert(!W(wk('locked', { dataSourceMode: 'demo' }), [g('scheduled', 1)], now) && !W(wk('locked', { dataSourceMode: 'manual' }), [g('scheduled', 1)], now), '[1o] a demo or manual week is never in the window');
  assert(!W(wk('locked'), [g('scheduled', -2), g('scheduled', -5)], now), '[1p] locked BEFORE the first kickoff: not in the window yet');
  assert(!W(wk('locked'), [g('final', 1), g('final', 3)], now), '[1q] every game FINAL: out of the window');
  assert(!W(wk('locked'), [g('scheduled', 7), g('final', 8)], now) && W(wk('locked'), [g('scheduled', 5.9)], now), '[1r] a kickoff 7 h ago (the 6 h tail passed) is out; 5.9 h ago is in');
  assert(W(wk('live'), [g('live', 9)], now), '[1s] a LIVE game keeps the window open however old its kickoff');
  assert(W(wk('locked'), [g('final', 1), g('scheduled', 1)], now), '[1t] one FINAL and one still to play: in the window');
  assert(!W(null, [], now) && !W(wk('locked'), [], now) && !W(wk('locked'), [g('scheduled', 1)], NaN), '[1u] no week / no games / no clock: out, never thrown');

  // the rows
  const facts = (over = {}) => ({ competitionId: 'c-cfb', dbCode: 'cfb', label: 'College Football', live: true, week: wk('locked'), games: [g('scheduled', 1, { espnSport: null })], unknownCode: null, ...over });
  const nfl = (over = {}) => facts({ competitionId: 'c-nfl', dbCode: 'nfl', label: 'NFL', games: [g('scheduled', 1, { espnSport: 'nfl' })], ...over });
  const known = (t) => t === 'nfl' || t === 'college-football';
  const stalled = SM.createPollHealth();
  for (let i = 0; i < 3; i++) { SM.notePoll(stalled, 'c-nfl', 'failed', i); }
  const rowsFor = (o) => SM.stallRows({ facts: [facts(), nfl()], health: stalled, isCommissioner: true, nowMs: now, isKnownSport: known, ...o });
  let r = rowsFor({});
  assert(r.length === 1 && r[0].trigger === 2 && r[0].competitionId === 'c-nfl' && r[0].text === C.feedCommissioner('NFL'), '[1v] trigger 2 (commissioner): one row, only the stalled sport, the diagnostic copy');
  r = rowsFor({ isCommissioner: false });
  assert(r.length === 1 && r[0].text === C.feedPlayer('NFL'), '[1w] trigger 2 (player): the plain line');
  const two = SM.createPollHealth(); SM.notePoll(two, 'c-nfl', 'failed', 1); SM.notePoll(two, 'c-nfl', 'failed', 2);
  assert(rowsFor({ health: two }).length === 0 && rowsFor({ health: null }).length === 0, '[1x] two failures: nothing; no record at all: nothing');
  assert(rowsFor({ sports: ['cfb'] }).length === 0 && rowsFor({ sports: ['nfl'] }).length === 1 && rowsFor({ sports: [] }).length === 0 && rowsFor({ sports: null }).length === 1,
    '[1y] a page scoped to the CFB shows no NFL row; scoped to NFL shows it; an empty scope shows none; null means every sport');
  const both = SM.createPollHealth(); for (let i = 0; i < 3; i++) { SM.notePoll(both, 'c-cfb', 'failed', i); SM.notePoll(both, 'c-nfl', 'failed', i); }
  r = rowsFor({ health: both });
  assert(r.length === 2 && r[0].competitionId === 'c-cfb' && r[1].competitionId === 'c-nfl', '[1z] two stalled sports: two rows, in competition order');
  // trigger 1
  r = SM.stallRows({ facts: [facts({ week: null })], health: null, isCommissioner: true, nowMs: now, isKnownSport: known });
  assert(r.length === 1 && r[0].trigger === 1 && r[0].text === C.noWeek('College Football'), '[1aa] trigger 1: a live competition with no week - the commissioner gets the diagnostic');
  assert(SM.stallRows({ facts: [facts({ week: null })], health: null, isCommissioner: false, nowMs: now, isKnownSport: known }).length === 0, '[1ab] ...and a PLAYER gets nothing (the player line would be false here)');
  assert(SM.stallRows({ facts: [facts({ week: null, live: false })], health: null, isCommissioner: true, nowMs: now, isKnownSport: known }).length === 0, '[1ac] a competition that is NOT live and has no week raises nothing');
  // trigger 3
  const xyz = nfl({ games: [g('scheduled', 1, { espnSport: 'xyz' }), g('final', 2, { espnSport: 'nfl' })] });
  r = SM.stallRows({ facts: [xyz], health: null, isCommissioner: true, nowMs: now, isKnownSport: known });
  assert(r.length === 1 && r[0].trigger === 3 && r[0].text === C.unknown('xyz'), '[1ad] trigger 3 (commissioner): the diagnostic names the code');
  r = SM.stallRows({ facts: [xyz], health: null, isCommissioner: false, nowMs: now, isKnownSport: known });
  assert(r.length === 1 && r[0].text === C.feedPlayer('NFL'), '[1ae] trigger 3 (player): the same plain line as trigger 2, for that sport');
  const xyzFinal = nfl({ games: [g('final', 1, { espnSport: 'xyz' })] });
  assert(SM.stallRows({ facts: [xyzFinal], health: null, isCommissioner: true, nowMs: now, isKnownSport: known }).length === 0, '[1af] a FINAL game with the unknown tag is cleared');
  r = SM.stallRows({ facts: [nfl({ week: wk('draft'), games: [g('scheduled', -30, { espnSport: 'xyz' })] })], health: null, isCommissioner: true, nowMs: now, isKnownSport: known });
  assert(r.length === 1 && r[0].trigger === 3, '[1ag] trigger 3 shows in a Draft week too: the tag is wrong whether or not the window is open');
  assert(SM.stallRows({ facts: [nfl({ week: wk('locked', { dataSourceMode: 'demo' }), games: [g('scheduled', 1, { espnSport: 'xyz' })] })], health: null, isCommissioner: true, nowMs: now, isKnownSport: known }).length === 0, '[1ah] a demo week never raises a row');
  r = SM.stallRows({ facts: [nfl({ unknownCode: 'zzz' })], health: null, isCommissioner: true, nowMs: now, isKnownSport: known });
  assert(r.length === 1 && r[0].text === C.unknown('zzz'), '[1ai] a caught UnknownSportError on the competition\'s own sport key is trigger 3 too');
  // ordering, dedupe, clipping
  const many = [facts({ games: [g('scheduled', 1, { espnSport: 'bbb' })] }), nfl({ games: [g('scheduled', 1, { espnSport: 'aaa' }), g('scheduled', 1, { espnSport: 'bbb' })] })];
  r = SM.stallRows({ facts: many, health: both, isCommissioner: true, nowMs: now, isKnownSport: known });
  assert(r.map((x) => x.trigger).join('') === '22' + '33' && r.slice(2).map((x) => x.text).join('|') === `${C.unknown('aaa')}|${C.unknown('bbb')}`, '[1aj] competition rows first (in order), then the unknown-code rows BY CODE, one row per distinct code for the commissioner');
  r = SM.stallRows({ facts: many, health: both, isCommissioner: false, nowMs: now, isKnownSport: known });
  assert(r.length === 2 && new Set(r.map((x) => x.text)).size === 2, '[1ak] a player never sees the same sentence twice (trigger 3 for a sport already speaking is folded in)');
  const longCode = 'x'.repeat(80);
  r = SM.stallRows({ facts: [nfl({ games: [g('scheduled', 1, { espnSport: longCode })] })], health: null, isCommissioner: true, nowMs: now, isKnownSport: known });
  assert(r.length === 1 && r[0].text === C.unknown('x'.repeat(40)), '[1al] a code is clipped to 40 characters, as the thrown error carries it');
  assert(Array.isArray(SM.stallRows({ facts: [null, {}, { competitionId: 'z' }, undefined], health: 5, nowMs: 'x', isKnownSport: 7 })), '[1am] garbage in, an array out, never thrown');

  // the key and the markup
  r = rowsFor({ health: both });
  assert(SM.stallRowsKey(r) === 'c-cfb:2|c-nfl:2' && SM.stallRowsKey([]) === '' && SM.stallRowsKey(null) === '', '[1an] the key is competition ids and trigger numbers, joined');
  r = SM.stallRows({ facts: [nfl({ games: [g('scheduled', 1, { espnSport: 'SECRET-CODE' })] })], health: null, isCommissioner: true, nowMs: now, isKnownSport: known });
  assert(!SM.stallRowsKey(r).includes('SECRET') && !SM.stallRowsKey(r).includes('NFL'), '[1ao] a sport code or label NEVER enters the key');
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const html = SM.sportStallBannerHTML(rowsFor({ health: both }), { escHtml: esc, animate: false });
  assert(/^<div class="warning-box sport-stall-banner" id="sport-stall-banner" role="status" data-rows="c-cfb:2\|c-nfl:2">/.test(html) && !/role="alert"/.test(html), '[1ap] the markup: the existing .warning-box, its own id, role="status" (polite), the key');
  assert((html.match(/<p>/g) || []).length === 2 && html.includes(iconOf('warning')) && iconOf('warning').includes('aria-hidden="true"'), '[1aq] one <p> per row, and the icon family\'s own warning glyph (aria-hidden): the red banner\'s icon');
  assert(!/sport-stall-in/.test(html) && /sport-stall-in/.test(SM.sportStallBannerHTML(rowsFor({ health: both }), { escHtml: esc, animate: true })), '[1ar] the fade class is added only when asked (a changed row set)');
  assert(SM.sportStallBannerHTML([], { escHtml: esc }) === '' && SM.sportStallBannerHTML(null, { escHtml: esc }) === '', '[1as] no rows, no markup');
  let threw = false; try { SM.sportStallBannerHTML(rowsFor({ health: both }), {}); } catch (e) { threw = e instanceof TypeError; }
  assert(threw, '[1at] the module refuses to run without an injected escHtml (CONVENTIONS #12)');
  const evil = '"><img src=x onerror=alert(1)>';
  const evilHtml = SM.sportStallBannerHTML([{ trigger: 3, competitionId: evil, text: C.unknown(evil) }, { trigger: 2, competitionId: 'ok', text: C.feedPlayer(evil) }], { escHtml: esc });
  assert(!/<img/i.test(evilHtml) && !/onerror="/.test(evilHtml) && (evilHtml.match(/data-rows="[^"]*"/g) || []).length === 1 && evilHtml.includes('&lt;img'), '[1au] a hostile code, label AND competition id leave no live tag or attribute break (data-rows included)');

  // the leaf scan, with a canary
  const modSrc = stripComments(read('./js/sport-stall.js')).replace("import { icon } from './icons.js';", '');   // the ONE allowed import: the icon family (a leaf)
  const leaky = (src) => /\bimport\b[^;]*\bfrom\b|\bimport\s*\(|\brequire\s*\(|\blocalStorage\b|\bdocument\b|\bwindow\b|\bsave\w*\(|\bload\w*\(|\bfetch\s*\(|\bDate\.now\b|\bnew Date\(\)/.test(src);
  assert(!leaky(modSrc), '[1av] js/sport-stall.js is a LEAF: its only import is the icon family; no storage, no DOM, no clock, no network');
  assert(leaky(modSrc + "\nimport { x } from './storage.js';") && leaky(modSrc + '\nlocalStorage.setItem("a","b");') && leaky(modSrc + '\nconst t = Date.now();'), '[1aw] canary: an added import, a storage touch or a clock read is caught by the same scan');
}

// ═════════════════════════════════════════════════════════════════
//  THE APP-LEVEL HARNESS - the real app.js over a real element tree, a stubbed ESPN
// ═════════════════════════════════════════════════════════════════
const INDEX = read('./index.html');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
const freshDoc = () => { const doc = new MiniDocument(); doc.body.innerHTML = bodyHtmlOf(INDEX); return doc; };

// ESPN, by sport: 'ok' (an event per stored game of that sport), 'empty' (a scoreboard with zero events), 'fail' (HTTP 503 everywhere, proxies included)
const net = { cfb: 'ok', nfl: 'ok' };
let fetchCalls = [];
let gate = null;   // a promise every fetch awaits while set (the in-flight-round case)
function espnEvent(id) {
  return {
    id, date: '2026-10-08T18:00Z', status: { type: { name: 'STATUS_SCHEDULED', detail: '', shortDetail: '' } },
    competitions: [{ timeValid: true, neutralSite: false,
      competitors: [
        { homeAway: 'home', id: '1', score: '0', curatedRank: { current: 99 }, team: { id: '1', location: 'Home', name: 'Hosts', shortDisplayName: 'Home' } },
        { homeAway: 'away', id: '2', score: '0', curatedRank: { current: 99 }, team: { id: '2', location: 'Away', name: 'Visitors', shortDisplayName: 'Away' } },
      ], odds: [], broadcasts: [], notes: [], venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'TS' } } }],
  };
}
globalThis.fetch = async (url) => {
  const u = decodeURIComponent(String(url));
  fetchCalls.push(u);
  if (gate) await gate;
  const sport = /\/football\/nfl\//.test(u) ? 'nfl' : 'cfb';
  const mode = net[sport];
  if (mode === 'fail') return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({}), text: async () => '' };
  const events = mode === 'empty' ? [] : (st.getGames(`w_${sport}_2`) || []).filter((x) => x.espnEventId).map((x) => espnEvent(x.espnEventId));
  const body = JSON.stringify({ events });
  return { ok: true, status: 200, headers: { get: () => String(body.length) }, json: async () => JSON.parse(body), text: async () => body };
};

/** One scenario: both sports locked, a game of each kicked off an hour ago with an ESPN id, the viewer a commissioner (or a player) who plays both. */
function setup({ admin = true, viewer = 'p1', sports = ['cfb', 'nfl'], status = {}, kick = {}, plays = {}, tab = 'home' } = {}) {
  env.league({ sports, viewer, isAdmin: admin, weekStatus: { cfb: 'locked', nfl: 'locked', ...status }, plays });
  env.put('cfbp_games', env.lsGet('cfbp_games').map((g) => {
    const m = /^w_(\w+)_2$/.exec(g.weekId);
    if (!m) return g;
    const sp = m[1], first = g.gameId.endsWith('_g1');
    const at = first ? (kick[sp] ?? -1) : 1;
    return { ...g, kickoff: new Date(NOW + at * 3600e3).toISOString(), espnEventId: `E-${g.gameId}`, espnSport: sp === 'nfl' ? 'nfl' : null };
  }));
  globalThis.document = freshDoc();
  app._resetHomeWiringForTest();
  app._onContextSwitchForTest({ keepAccountId: null });   // the record, the painted-state map and the sport pointers: a clean device
  net.cfb = 'ok'; net.nfl = 'ok'; fetchCalls = []; gate = null;
  app.state.currentTab = tab; app.state.viewingWeekId = null;
}
const weekOf = (sp) => comp.getCurrentWeekFor(CID[sp]);
/** ONE real poll of a sport's current week (the same call the tick and the Refresh button make). */
async function pollOnce(sp) { const wk = weekOf(sp); quiet(); try { await app.doRefreshScores(wk, st.getGames(wk.weekId)); } finally { loud(); } }
async function poll(sp, n = 1) { for (let i = 0; i < n; i++) await pollOnce(sp); }
function show(tab) { quiet(); try { window.navigateTo(tab); } finally { loud(); } return banners(); }
const banners = () => [...document.querySelectorAll('#sport-stall-banner')];
const rowsOf = (b) => (b ? [...b.querySelectorAll('p')].map((p) => p.textContent) : []);
const failures = (sp) => app._sportPollHealthForTest.get(CID[sp])?.failures ?? 0;

// ═════════════════════════════════════════════════════════════════
console.log('\n[2] TRIGGER 2 THROUGH THE REAL POLL - three in a row, one success clears, per competition…');
// ═════════════════════════════════════════════════════════════════
{
  setup({ admin: true });
  net.nfl = 'fail';
  await poll('nfl', 1);
  assert(show('home').length === 0 && failures('nfl') === 1, '[2a] one failed poll: no banner');
  await poll('nfl', 1);
  assert(show('home').length === 0 && failures('nfl') === 2, '[2b] two failed polls: no banner');
  await poll('nfl', 1);
  let b = show('home');
  assert(b.length === 1 && JSON.stringify(rowsOf(b[0])) === JSON.stringify([C.feedCommissioner('NFL')]), `[2c] the THIRD failed poll shows ONE row, the commissioner copy, exact (got ${JSON.stringify(rowsOf(b[0]))})`);
  await poll('nfl', 1);
  b = show('home');
  assert(b.length === 1 && rowsOf(b[0]).length === 1 && failures('nfl') === 4, '[2d] a fourth failed poll leaves ONE row (never a second one)');
  net.nfl = 'ok';
  app.state.currentTab = 'home';
  await poll('nfl', 1);
  assert(banners().length === 0 && failures('nfl') === 0, '[2e] one SUCCESSFUL poll removes the row at once (the in-place repaint) and resets the count');
  net.nfl = 'fail';
  await poll('nfl', 2);
  assert(show('home').length === 0 && failures('nfl') === 2, '[2f] two failures AFTER a success show nothing: the count is consecutive, never cumulative');
  await poll('nfl', 1);
  assert(show('home').length === 1, '[2g] ...and the third (consecutive) one does');

  setup({ admin: false, viewer: 'p2' });
  net.nfl = 'fail';
  await poll('nfl', 3);
  b = show('home');
  assert(b.length === 1 && JSON.stringify(rowsOf(b[0])) === JSON.stringify([C.feedPlayer('NFL')]), `[2h] a PLAYER gets the plain line, exact, on the same trigger (got ${JSON.stringify(rowsOf(b[0]))})`);
  assert(!/live feed failed|Comm|stale until/.test(b[0].textContent), '[2i] ...and none of the commissioner\'s diagnostic words');

  // per competition
  setup({ admin: true });
  net.cfb = 'fail'; net.nfl = 'ok';
  for (let i = 0; i < 3; i++) { await poll('cfb', 1); await poll('nfl', 1); }
  b = show('home');
  assert(b.length === 1 && JSON.stringify(rowsOf(b[0])) === JSON.stringify([C.feedCommissioner('College Football')]) && failures('cfb') === 3 && failures('nfl') === 0,
    `[2j] CFB fails three times while NFL succeeds each time: ONE row, for CFB (got ${JSON.stringify(rowsOf(b[0]))}); NFL's polls never cleared CFB's count`);
  net.nfl = 'fail';
  await poll('nfl', 3);
  b = show('home');
  assert(b.length === 1 && rowsOf(b[0]).length === 2 && rowsOf(b[0])[0].startsWith('College Football') && rowsOf(b[0])[1].startsWith('NFL'), '[2k] both sports stalled: one banner, two rows, competition order');
  net.cfb = 'ok';
  await poll('cfb', 1);
  b = show('home');
  assert(b.length === 1 && rowsOf(b[0]).length === 1 && rowsOf(b[0])[0].startsWith('NFL') && failures('nfl') === 3, '[2l] CFB recovering removes ITS row and leaves the NFL row (and NFL\'s count)');

  // a zero-event board is a success
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 2);
  net.nfl = 'empty'; await poll('nfl', 1);
  assert(failures('nfl') === 0, '[2m] a scoreboard with ZERO events (ESPN answered; `errors` lists it) is a SUCCESS: it resets the count');
  await poll('nfl', 5);
  assert(show('home').length === 0 && failures('nfl') === 0, '[2n] five empty boards in a row never raise a row');
  net.nfl = 'fail'; await poll('nfl', 2);
  net.nfl = 'empty'; await poll('nfl', 1); net.nfl = 'fail'; await poll('nfl', 2);
  assert(show('home').length === 0, '[2o] fail, fail, empty, fail, fail: still nothing (the empty board broke the run)');

  // the unreachable-ESPN shape is "failed", never "empty"
  const dp = await import('./js/data-provider.js');
  net.nfl = 'fail';
  const fres = await dp.refreshScoresByEventIds([], st.getGames('w_nfl_2'));
  net.nfl = 'empty';
  const eres = await dp.refreshScoresByEventIds([], st.getGames('w_nfl_2'));
  net.nfl = 'ok';
  const ores = await dp.refreshScoresByEventIds([], st.getGames('w_nfl_2'));
  assert(fres.bucketOutcomes.get('nfl') === 'failed' && eres.bucketOutcomes.get('nfl') === 'empty' && ores.bucketOutcomes.get('nfl') === 'ok', '[2p] refreshScoresByEventIds reports each bucket: failed / empty / ok, from structure (rawEventCount), not from reading a message');
  assert(fres.errors.length === 1 && eres.errors.length === 1 && ores.errors.length === 0 && Array.isArray(ores.updated), '[2q] `errors` and `updated` are exactly what they were (the outcomes are a sibling, nothing about them changed)');
  assert(!fres.bucketOutcomes.has('college-football'), '[2r] a bucket the call never fetched has no entry (so it is neutral)');

  // the display-only pass (every device's tick while the server job owns the scores) and the manual Refresh Scores button are the SAME function: they feed the same record
  setup({ admin: true });
  net.nfl = 'fail';
  const nflWeek = weekOf('nfl');
  quiet(); try { for (let i = 0; i < 3; i++) await app.doRefreshScores(nflWeek, st.getGames(nflWeek.weekId), { displayOnly: true }); } finally { loud(); }
  assert(failures('nfl') === 3 && show('home').length === 1, '[2s] three failed DISPLAY-ONLY polls (the server-job tick) raise the banner: one path, one record');
  net.nfl = 'ok';
  quiet(); try { await app.doRefreshScores(nflWeek, st.getGames(nflWeek.weekId)); } finally { loud(); }
  assert(failures('nfl') === 0 && banners().length === 0, '[2t] ...and one successful full poll (the manual Refresh Scores button\'s call) clears it');

  // N3 (review): a week whose refreshable games all sit in ANOTHER sport's bucket never reaches its own sport's feed. An NFL week whose games carry no espnSport is polled under the CFB bucket, so the
  // poll is neutral for NFL: it neither counts (the CFB board failing is not the NFL feed failing) nor clears.
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 2);
  env.put('cfbp_games', env.lsGet('cfbp_games').map((g) => (g.weekId === 'w_nfl_2' ? { ...g, espnSport: null } : g)));
  net.cfb = 'fail'; net.nfl = 'fail'; fetchCalls = [];
  await poll('nfl', 3);
  assert(fetchCalls.length > 0 && !fetchCalls.some((u) => /\/football\/nfl\//.test(u)), '[2u] (fixture) the NFL week\'s games are polled under the CFB bucket: ESPN\'s NFL scoreboard is never asked');
  assert(failures('nfl') === 2 && failures('cfb') === 0 && show('home').length === 0, `[2v] three failed polls of such a week leave NFL's count at 2 (got ${failures('nfl')}) and raise nothing: the bucket it never fetched is neutral, not a failure`);
  net.cfb = 'ok'; await poll('nfl', 1);
  assert(failures('nfl') === 2, '[2w] ...and a poll that answers for the CFB bucket does not clear it either');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[3] NEUTRAL POLLS - a poll that never reached ESPN neither counts nor clears…');
// ═════════════════════════════════════════════════════════════════
{
  const settle = async () => { for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 0)); };
  // a demo week, a manual week
  for (const mode of ['demo', 'manual']) {
    setup({ admin: true });
    net.nfl = 'fail'; await poll('nfl', 2);
    env.put('cfbp_weeks', env.lsGet('cfbp_weeks').map((w) => (w.weekId === 'w_nfl_2' ? { ...w, dataSourceMode: mode } : w)));
    net.cfb = 'ok';
    quiet(); try { for (let i = 0; i < 4; i++) await app.runAutoRefreshTick(); } finally { loud(); }
    assert(failures('nfl') === 2, `[3a-${mode}] five ticks over a ${mode} NFL week change nothing: the count stays 2 (the tick never reached ESPN for it)`);
    env.put('cfbp_weeks', env.lsGet('cfbp_weeks').map((w) => (w.weekId === 'w_nfl_2' ? { ...w, dataSourceMode: 'live' } : w)));
    await poll('nfl', 1);
    assert(show('home').length === 1 && failures('nfl') === 3, `[3b-${mode}] ...so ONE more real failure is the third: the neutral ticks neither cleared nor counted`);
  }
  // nothing to refresh
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 2);
  env.put('cfbp_games', env.lsGet('cfbp_games').map((g) => (g.weekId === 'w_nfl_2' ? { ...g, espnEventId: null } : g)));
  const before = fetchCalls.length;
  await poll('nfl', 3);
  assert(fetchCalls.length === before && failures('nfl') === 2, '[3c] a week with no game to refresh makes no request and leaves the count at 2');
  // a held device
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 2);
  fetchCalls = [];
  quiet(); try { app.showAuthHoldGate('config-unreadable'); await app.runAutoRefreshTick(); await settle(); } finally { loud(); }
  assert(fetchCalls.length === 0 && failures('nfl') === 2, '[3d] a HELD device does not tick: no request, the count unchanged');
  app._resetAuthHoldForTest();
  // a round still running
  setup({ admin: true });
  net.nfl = 'fail'; net.cfb = 'ok';
  let release; gate = new Promise((r) => { release = r; });
  let callsMid = -1, callsAfterSkip = -2;
  quiet();
  try {
    const first = app.runAutoRefreshTick();
    await settle();
    callsMid = fetchCalls.length;
    const second = app.runAutoRefreshTick();    // the previous round is in flight: this one is skipped, so it makes no request of its own
    await settle();
    callsAfterSkip = fetchCalls.length;
    release(); gate = null;
    await Promise.all([first, second]);          // (a tick that was NOT skipped would be waiting on the gate too: released first, so a regression fails an assertion instead of hanging)
  } finally { loud(); gate = null; }
  assert(callsMid > 0 && callsAfterSkip === callsMid, '[3e] a tick that arrives while the last round is still running is skipped: it makes no request');
  assert(failures('nfl') === 1, `[3f] ...and only the round that ran was counted (got ${failures('nfl')})`);
  // a withheld device never paints
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('dashboard');
  assert(banners().length === 1, '[3g] (fixture) the NFL row is on the Dashboard');
  quiet(); try { app.showAuthHoldGate('config-unreadable'); } finally { loud(); }
  document.getElementById('page-dashboard').innerHTML = '<div class="card">emptied by the hold teardown</div>';
  app.state.currentTab = 'dashboard';
  app._renderSportStallBannerIfNeededForTest('dashboard');
  assert(banners().length === 0, '[3h] while content is withheld (a hold gate is up) nothing is painted into the page, even with the record at 3');
  app._resetAuthHoldForTest();
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4] THE WINDOW - only while something is expected to move…');
// ═════════════════════════════════════════════════════════════════
{
  const rowCount = async (cfg, mut) => {
    setup({ admin: true, ...cfg });
    if (mut) mut();
    net.nfl = 'fail'; await poll('nfl', 3);
    return show('home').length;
  };
  const patchGames = (f) => env.put('cfbp_games', env.lsGet('cfbp_games').map((g) => (g.weekId === 'w_nfl_2' ? f(g) : g)));
  assert(await rowCount({}) === 1, '[4a] baseline: locked, a game kicked off an hour ago, three failures: a row');
  assert(await rowCount({}, () => patchGames((g) => ({ ...g, status: 'final' }))) === 0, '[4b] every game FINAL: no row, even with the last poll failed');
  assert(await rowCount({ kick: { nfl: -7 } }, () => patchGames((g) => (g.gameId.endsWith('_g1') ? g : { ...g, kickoff: new Date(NOW + 3 * 3600e3).toISOString() }))) === 0, '[4c] the first kickoff 7 h ago and the next still ahead: the 6 h tail has passed, out of the window');
  assert(await rowCount({ kick: { nfl: -5 } }) === 1, '[4d] a kickoff 5 h ago: still in the window');
  assert(await rowCount({ status: { nfl: 'open' } }) === 0, '[4e] an OPEN week: nothing is expected to move');
  assert(await rowCount({ status: { nfl: 'draft' } }) === 0, '[4f] a DRAFT week: no row');
  assert(await rowCount({ kick: { nfl: -9 } }, () => patchGames((g) => (g.gameId.endsWith('_g1') ? { ...g, status: 'live' } : g))) === 1, '[4g] a LIVE game keeps the window open however old its kickoff');
  assert(await rowCount({ kick: { nfl: 2 } }) === 0, '[4h] locked BEFORE the first kickoff: the window has not opened');
  // the window ending clears an existing banner at the next paint, even if the last poll failed
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  assert(show('home').length === 1, '[4i] (fixture) the row is up');
  patchGames((g) => ({ ...g, status: 'final' }));
  assert(show('home').length === 0 && failures('nfl') === 3, '[4j] the games go FINAL (a Realtime write from the server job): the next paint clears the row although this device\'s last poll failed');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[5] TRIGGERS 1 AND 3 - no week to track, and a sport the app does not recognize…');
// ═════════════════════════════════════════════════════════════════
{
  // trigger 1 cannot fire under today's getLiveSports + getCurrentWeekFor (a live competition always resolves to a week); this is the stub-tested tripwire the DI keeps
  const stubEdit = [['week = getCurrentWeekFor(c.id);', 'week = null;   /* STUB: getCurrentWeekFor() resolves to nothing */']];
  setup({ admin: true });
  await withMutantApp(stubEdit, async (m) => {
    quiet(); try { window.navigateTo('home'); } finally { loud(); }
    const b = banners();
    assert(b.length === 1 && JSON.stringify(rowsOf(b[0])) === JSON.stringify([C.noWeek('College Football'), C.noWeek('NFL')]), `[5a] STUBBED getCurrentWeekFor -> null for the live competitions: the commissioner gets the trigger-1 row for each (got ${JSON.stringify(rowsOf(b[0]))})`);
    assert(/data-rows="[^"]*:1\|[^"]*:1"/.test(b[0].outerHTML), '[5b] ...keyed by competition id and trigger 1');
  });
  setup({ admin: false, viewer: 'p2' });
  await withMutantApp(stubEdit, async () => {
    quiet(); try { window.navigateTo('home'); } finally { loud(); }
    assert(banners().length === 0, '[5c] the same stub for a PLAYER: nothing at all (the player line would be false: locks may not work)');
  });
  setup({ admin: true });
  show('home');
  assert(banners().length === 0, '[5d] un-stubbed, a live competition always resolves to a week: no trigger-1 row (the tripwire is silent)');

  // trigger 3: a game carries a tag the app cannot fetch
  const tagGames = (code, status = 'scheduled', weekId = 'w_nfl_2') => env.put('cfbp_games', env.lsGet('cfbp_games').map((g) => (g.weekId === weekId && g.gameId.endsWith('_g1') ? { ...g, espnSport: code, status } : g)));
  setup({ admin: true });
  tagGames('xyz');
  let b = show('home');
  assert(b.length === 1 && JSON.stringify(rowsOf(b[0])) === JSON.stringify([C.unknown('xyz')]), `[5e] a non-final game tagged 'xyz': the commissioner row names the code (got ${JSON.stringify(rowsOf(b[0]))})`);
  setup({ admin: false, viewer: 'p2' });
  tagGames('xyz');
  b = show('home');
  assert(b.length === 1 && JSON.stringify(rowsOf(b[0])) === JSON.stringify([C.feedPlayer('NFL')]), `[5f] the PLAYER gets the plain line for that sport (got ${JSON.stringify(rowsOf(b[0]))})`);
  setup({ admin: true });
  tagGames('xyz', 'final');
  assert(show('home').length === 0, '[5g] the same tag on a FINAL game: cleared');
  setup({ admin: true });
  tagGames('xyz');
  env.put('cfbp_weeks', env.lsGet('cfbp_weeks').map((w) => (w.weekId === 'w_nfl_2' ? { ...w, dataSourceMode: 'manual' } : w)));
  assert(show('home').length === 0, '[5h] a manual week raises nothing');
  setup({ admin: true });
  tagGames('college-football', 'scheduled', 'w_nfl_2'); tagGames('nfl');
  assert(show('home').length === 0, '[5i] a recognized ESPN key (college-football, nfl) is not an unknown tag');
  // a competition whose own sport key is unrecognized (a caught UnknownSportError, tested by NAME)
  setup({ admin: true });
  env.put('cfbp_competitions', [...env.lsGet('cfbp_competitions'), { id: CID.nhl, sport: 'qqq', kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-03-01T00:00:00.000Z' }]);
  env.put('cfbp_weeks', [...env.lsGet('cfbp_weeks'), { ...mkWeek('w_qqq_1', 1, 'open'), competitionId: CID.nhl }]);
  env.put('cfbp_games', [...env.lsGet('cfbp_games'), mkGame('w_qqq_1', 'g1', 'Q-home', 'Q-away', 30)]);
  b = show('home');
  assert(b.length === 1 && rowsOf(b[0]).includes(C.unknown('qqq')), `[5j] a competition whose sport key is unrecognized (getProfile throws UnknownSportError): the commissioner row names it (got ${JSON.stringify(rowsOf(b[0]))})`);
  const facts = app._sportStallFactsForTest(NOW);
  assert(facts.find((f) => f.dbCode === 'qqq')?.unknownCode === 'qqq' && facts.filter((f) => f.unknownCode).length === 1, '[5k] ...and only that competition carries an unknownCode in the facts');
  // a competition whose current week cannot be READ (the lookup throws) is left out: never a false "no week" alarm for the commissioner
  setup({ admin: true });
  await withMutantApp([['week = getCurrentWeekFor(c.id);', 'week = (() => { throw new Error("boom"); })();']], async (m) => {
    quiet(); try { window.navigateTo('home'); } finally { loud(); }
    assert(banners().length === 0 && m._sportStallFactsForTest(NOW).length === 0, '[5n] getCurrentWeekFor THROWING for every competition raises no trigger-1 row (the facts are empty: unreadable is not "no week")');
  });
  // a competition with NO week at all is not live (nothing is open, locked or live, nothing starts soon): trigger 1 is for LIVE competitions
  setup({ admin: true });
  env.put('cfbp_weeks', env.lsGet('cfbp_weeks').filter((w) => !/^w_nfl_/.test(w.weekId)));
  const idle = app._sportStallFactsForTest(NOW).find((f) => f.dbCode === 'nfl');
  assert(!!idle && idle.week === null && idle.live === false, '[5l] (fixture) the NFL competition has no week and is not live');
  await withMutantApp(stubEdit, async () => {
    quiet(); try { window.navigateTo('home'); } finally { loud(); }
    assert(!banners().some((b) => rowsOf(b).some((t) => t.startsWith('NFL'))), '[5m] a competition that is NOT live and has no week raises no trigger-1 row, even with getCurrentWeekFor stubbed to nothing (the commissioner is not nagged about a sport that is simply idle)');
  });
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[6] ESCAPING, PERSISTENCE, IDENTITY…');
// ═════════════════════════════════════════════════════════════════
{
  const evil = '"><img src=x onerror=alert(1)>';
  setup({ admin: true });
  env.put('cfbp_competitions', [...env.lsGet('cfbp_competitions'), { id: CID.nhl, sport: evil, kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-03-01T00:00:00.000Z' }]);
  env.put('cfbp_weeks', [...env.lsGet('cfbp_weeks'), { ...mkWeek('w_evil_1', 1, 'open'), competitionId: CID.nhl }]);
  env.put('cfbp_games', [...env.lsGet('cfbp_games'), mkGame('w_evil_1', 'g1', 'E-home', 'E-away', 30, { espnSport: evil })]);
  const bs = show('home');
  const html = bs.length ? bs[0].outerHTML : '';
  assert(bs.length === 1 && html.includes('&lt;img') && !/<img/i.test(html) && bs[0].querySelectorAll('img').length === 0, '[6a] a hostile sport code AND label (on the competition and on a game) reach the page as text: no live <img anywhere in the banner');
  assert(bs[0].querySelectorAll('[onerror]').length === 0 && !bs[0].getAttributeNames().some((n) => /^on/i.test(n)), '[6b] ...and no element in it carries an event-handler attribute');
  assert(!(bs[0].getAttribute('data-rows') || '').includes('img') && !/id="[^"]*img/.test(html), '[6c] ...the code is in neither data-rows nor any id (an id is never built from a sport code)');
  assert(JSON.stringify(rowsOf(bs[0]).filter((t) => t.includes('img'))).includes(evil), '[6d] ...and the text reads back as the code, character for character (escaped once, not twice)');

  // an unrecognized sport key as long as a paragraph is clipped to 40 characters in the sentence, as the thrown error carries it
  setup({ admin: true });
  const longSport = 'z'.repeat(100);
  env.put('cfbp_competitions', [...env.lsGet('cfbp_competitions'), { id: CID.nhl, sport: longSport, kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-03-01T00:00:00.000Z' }]);
  env.put('cfbp_weeks', [...env.lsGet('cfbp_weeks'), { ...mkWeek('w_long_1', 1, 'open'), competitionId: CID.nhl }]);
  env.put('cfbp_games', [...env.lsGet('cfbp_games'), mkGame('w_long_1', 'g1', 'L-home', 'L-away', 30)]);
  const lb = show('home');
  assert(lb.length === 1 && rowsOf(lb[0]).includes(C.unknown('z'.repeat(40))) && !rowsOf(lb[0]).some((t) => t.includes('z'.repeat(41))), '[6a2] a 100-character sport key reaches the sentence as 40 characters (the code and the label are both clipped)');
  setup({ admin: false, viewer: 'p2' });
  env.put('cfbp_competitions', [...env.lsGet('cfbp_competitions'), { id: CID.nhl, sport: longSport, kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-03-01T00:00:00.000Z' }]);
  env.put('cfbp_weeks', [...env.lsGet('cfbp_weeks'), { ...mkWeek('w_long_1', 1, 'open'), competitionId: CID.nhl }]);
  env.put('cfbp_games', [...env.lsGet('cfbp_games'), mkGame('w_long_1', 'g1', 'L-home', 'L-away', 30)]);
  const lp = show('home');
  assert(lp.length === 1 && rowsOf(lp[0]).includes(C.feedPlayer('z'.repeat(40))), '[6a3] ...and the label in the PLAYER line is clipped the same way');

  // never persisted
  setup({ admin: true });
  const writes = [];
  const realSet = localStorage.setItem;
  localStorage.setItem = (k, v) => { writes.push(String(k)); return realSet(k, v); };
  net.nfl = 'fail';
  app.state.currentTab = 'home';
  try { await poll('nfl', 3); app._renderSportStallBannerIfNeededForTest('home'); } finally { localStorage.setItem = realSet; }
  assert(writes.length === 0 && banners().length === 1, `[6e] three failed polls, the in-place paint and a repaint wrote NOTHING to storage (got ${JSON.stringify(writes)}) and the banner is up`);
  const all = [...env.store.keys()];
  assert(all.length > 5 && !JSON.stringify(env.lsGet('cfbp_games')).includes('lastFailureAt') && !['cfbp_settings', 'cfbp_weeks', 'cfbp_competitions'].some((k) => (localStorage.getItem(k) || '').includes('lastFailureAt')) && !all.some((k) => /stall|poll/i.test(k)),
    '[6f] no stored value carries the record and no key is named for it');
  const rec = app._sportPollHealthForTest.get(CID.nfl);
  assert(rec && rec.failures === 3 && typeof rec.lastFailureAt === 'number' && rec.lastSuccessAt === null, '[6g] the record is in memory: { failures, lastFailureAt, lastSuccessAt }');

  // identity
  assert(banners().length === 1, '[6h] (fixture) the row is up');
  app._onContextSwitchForTest({ keepAccountId: null });
  assert(app._sportPollHealthForTest.size === 0 && app._stallPaintedForTest.size === 0, '[6i] an account or league change (onContextSwitch, the identity chokepoint\'s hook) clears the record and the painted-state map');
  await poll('nfl', 2);
  assert(show('home').length === 0, '[6j] ...and the next account starts at zero: two failures show nothing');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[7] RED WINS - loud-fail first, one alarm at a time…');
// ═════════════════════════════════════════════════════════════════
{
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  assert(show('home').length === 1, '[7a] (fixture) the stall row is up');
  quiet(); try { app._showBackendErrorBannerForTest('Could not reach the league. Tell the commissioner.', { title: 'Sync is OFF' }); } finally { loud(); }
  const red = () => document.getElementById('backend-error-banner');
  const redBefore = red().outerHTML;
  assert(!!red() && red().style.display === 'block', '[7b] (fixture) the REAL red banner is up (display:block)');
  const after = show('home');
  assert(after.length === 0, '[7c] a paint with the red banner visible leaves NO stall banner (withheld, not stacked)');
  show('home'); app._renderSportStallBannerIfNeededForTest('home');
  assert(red().outerHTML === redBefore && red().id === 'backend-error-banner' && red().getAttribute('data-owner') === 'app' && red().style.display === 'block', '[7d] the red node\'s markup, id, data-owner and display are byte-identical after every paint');
  assert(banners().length === 0 && !(red().style.display !== 'none' && banners().length), '[7e] a paint never leaves both visible');
  quiet(); try { app._hideBackendErrorBannerForTest(); } finally { loud(); }
  assert(red().style.display === 'none', '[7f] (fixture) the red banner is hidden (dismissed or cleared)');
  const back = show('home');
  assert(back.length === 1 && rowsOf(back[0]).length === 1, '[7g] the next paint after the red one clears shows the stall row again');
  assert(/sport-stall-in/.test(back[0].className), '[7h] ...as a row set that has just arrived (it fades in once), because it was absent while the red one showed');
  // the poll that changes the record while red is up must not paint over it either
  quiet(); try { app._showBackendErrorBannerForTest('again'); } finally { loud(); }
  await poll('nfl', 1);
  assert(banners().length === 0, '[7i] a failed poll WHILE the red banner is up repaints in place and still leaves no stall banner');
  quiet(); try { app._hideBackendErrorBannerForTest(); } finally { loud(); }
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[8] RENDER PATHS AND SCOPE - which page shows which rows, in what order…');
// ═════════════════════════════════════════════════════════════════
{
  const pageIds = { home: 'page-home', picks: 'page-picks', dashboard: 'page-dashboard', leaderboard: 'page-leaderboard', commissioner: 'page-commissioner', rules: 'page-rules', admin: 'page-admin', chat: 'page-chat' };
  const inPage = (tab) => [...document.querySelectorAll(`#${pageIds[tab]} #sport-stall-banner`)];

  // the commissioner who plays both sports, NFL stalled
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  const ids = {};
  for (const tab of ['home', 'commissioner', 'picks', 'dashboard', 'leaderboard']) { show(tab); ids[tab] = inPage(tab).map((b) => rowsOf(b).join('|')); }
  assert(ids.home.length === 1 && ids.home[0] === C.feedCommissioner('NFL'), '[8a] HOME shows the NFL row (every non-archived sport)');
  assert(ids.commissioner.length === 1 && ids.commissioner[0] === C.feedCommissioner('NFL'), '[8b] COMM shows it too, whatever the lens or the pointer says (the pointer is CFB)');
  assert(ids.picks.length === 0 && ids.dashboard.length === 0 && ids.leaderboard.length === 0, '[8c] Picks, Dashboard and Standings on CFB show NO NFL row: the context sport only');
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  for (const tab of ['picks', 'dashboard', 'leaderboard']) { show(tab); ids[tab] = inPage(tab).map((b) => rowsOf(b).join('|')); }
  assert(ids.picks.length === 1 && ids.dashboard.length === 1 && ids.leaderboard.length === 1 && ids.picks[0] === C.feedCommissioner('NFL'), '[8d] with the pointer on NFL, Picks, Dashboard and Standings each show the row once');
  assert(banners().length === 1, '[8e] and the document holds exactly ONE banner (the other pages\' copies were removed)');
  quiet(); try { comp.setActiveSportKey('cfb'); } finally { loud(); }
  for (const tab of ['rules', 'chat', 'admin']) { try { show(tab); } catch (e) { /* these pages need more of the browser than the element tree gives; what matters is that none carries the banner */ } }
  assert(['rules', 'chat', 'admin'].every((t) => inPage(t).length === 0), '[8f] Rules, Locker Room and the Admin panel never carry the banner');
  show('home'); show('rules');
  assert(inPage('rules').length === 0 && banners().length <= 1, '[8g] after Home then Rules: none on Rules, never more than one in the document');

  // Dashboard under All sports: the sports the viewer plays
  setup({ admin: false, viewer: 'p2', sports: ['cfb', 'nfl', 'nhl'], plays: { nhl: ['p3'] } });
  net.cfb = 'fail'; net.nfl = 'fail';
  await poll('cfb', 3); await poll('nfl', 3);
  quiet(); try { comp.setDashboardScope('all'); } finally { loud(); }
  show('dashboard');
  let d = inPage('dashboard');
  assert(d.length === 1 && JSON.stringify(rowsOf(d[0])) === JSON.stringify([C.feedPlayer('College Football'), C.feedPlayer('NFL')]) && comp.getDashboardScope() === 'all',
    `[8h] the Dashboard under All sports shows a row for each sport the viewer PLAYS (got ${JSON.stringify(rowsOf(d[0]))})`);
  quiet(); try { comp.setDashboardScope(null); comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('dashboard'); d = inPage('dashboard');
  assert(d.length === 1 && JSON.stringify(rowsOf(d[0])) === JSON.stringify([C.feedPlayer('NFL')]), '[8i] switching the Dashboard to NFL shows only the NFL row');
  quiet(); try { comp.setActiveSportKey('cfb'); } finally { loud(); }
  show('dashboard'); d = inPage('dashboard');
  assert(d.length === 1 && rowsOf(d[0]).length === 1 && rowsOf(d[0])[0].startsWith('College Football'), '[8j] ...and to CFB shows only the CFB row (no NFL row on a CFB Dashboard)');
  show('home');
  const homeRows = rowsOf(inPage('home')[0]);
  assert(homeRows.length >= 3 && homeRows.some((t) => t.startsWith('College Football')) && homeRows.some((t) => t.startsWith('NFL')) && homeRows.some((t) => t.startsWith('nhl')),
    `[8k] Home, for the same player, lists every non-archived sport (got ${JSON.stringify(homeRows)}): Game Day is league-wide`);
  show('dashboard');
  quiet(); try { comp.setDashboardScope('all'); } finally { loud(); }
  show('dashboard');
  assert(!rowsOf(inPage('dashboard')[0]).some((t) => /nhl/.test(t)), '[8l] ...but the All sports Dashboard has no row for the sport the viewer does not play');

  // Picks has TWO render exits: the current week's page and a past week read-only (the historical view). Both end with the banner.
  setup({ admin: true });
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  net.nfl = 'fail'; await poll('nfl', 3);
  app.state.viewingWeekId = 'w_nfl_1';
  show('picks');
  const histHtml = document.getElementById('page-picks').innerHTML;
  assert(/past week|read-only|Final/i.test(histHtml) && inPage('picks').length === 1, '[8t2] Picks on a PAST week (the historical, read-only view: the other render exit) carries the banner too');
  app.state.viewingWeekId = null;

  // a league-flow screen that owns the Home section, a player on the Comm tab, a repaint of a page that is not on screen, an archived sport
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  show('home');
  document.getElementById('page-home').innerHTML = '<div class="card" id="league-flow-landing">Join or create a league</div>';
  app.state.currentTab = 'home';
  app._renderSportStallBannerIfNeededForTest('home');
  assert(!document.querySelector('#league-flow-landing #sport-stall-banner') && banners().length === 0 && !document.getElementById('page-home').innerHTML.includes('sport-stall'), '[8u2] a league-flow screen that owns the Home section is never painted over: no #home-root, no banner');
  setup({ admin: false, viewer: 'p2' });
  net.nfl = 'fail'; await poll('nfl', 3);
  show('commissioner');
  assert(banners().length === 0 && !document.getElementById('page-commissioner').innerHTML.includes('sport-stall'), '[8u3] a PLAYER who lands on the Comm tab (the sign-in or Commissioner Only card, whichever mode) gets no banner: the panel is not reachable for them, and the commissioner\'s diagnostic is not theirs');
  app.state.currentTab = 'commissioner';
  app._renderSportStallBannerIfNeededForTest('commissioner');
  assert(banners().length === 0, '[8u3b] ...and a direct paint for Comm with a player session adds none either');
  setup({ admin: true });
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  net.nfl = 'fail'; await poll('nfl', 3);
  show('dashboard');
  const dashBanner = inPage('dashboard')[0];
  app.state.currentTab = 'dashboard';
  app._renderSportStallBannerIfNeededForTest('picks');     // a repaint of a page that is NOT on screen
  assert(!!dashBanner && inPage('dashboard')[0] === dashBanner && !inPage('picks').length, '[8u4] a repaint of a page that is not the one on screen paints nothing there and takes nothing away from the visible page');
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  env.put('cfbp_competitions', env.lsGet('cfbp_competitions').map((c) => (c.id === CID.nfl ? { ...c, archivedAt: '2026-10-01T00:00:00.000Z' } : c)));
  assert(show('home').length === 0, '[8u5] an ARCHIVED sport is gone from every surface (DI-520): its stalled feed raises no row');

  // the order among the notices: maintenance, paused-league, stall
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  auth._setMembershipsForTest([{ leagueId: LEAGUE, memberId: 'm1', role: 'commissioner', displayName: 'Drew', leagueName: 'Paused Crew', status: 'paused', pilot: false, sportDefault: 'cfb' }]);
  auth.setActiveLeagueId(LEAGUE);
  auth.setCachedMaintenanceBannerLocally('Scheduled maintenance tonight');
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  const orderOf = (tab) => [...document.getElementById(pageIds[tab]).children].map((c) => c.id).filter((id) => ['maintenance-banner', 'paused-league-banner', 'sport-stall-banner'].includes(id)).join(' > ');
  for (const tab of ['home', 'picks', 'dashboard', 'leaderboard', 'commissioner']) {
    show(tab);
    assert(orderOf(tab) === 'maintenance-banner > paused-league-banner > sport-stall-banner', `[8m-${tab}] ${tab}: top to bottom maintenance, paused-league, stall (got "${orderOf(tab)}")`);
  }
  show('picks'); app._renderSportStallBannerIfNeededForTest('picks'); app._renderSportStallBannerIfNeededForTest('picks');
  assert(orderOf('picks') === 'maintenance-banner > paused-league-banner > sport-stall-banner' && inPage('picks').length === 1, '[8n] ...and a repaint of the stall alone does not change that order or duplicate it');
  // the order when the banner ARRIVES in place (a poll, no navigation: nothing re-seats the other two above it)
  for (const tab of ['picks', 'leaderboard']) {
    setup({ admin: true, tab });
    auth._setMembershipsForTest([{ leagueId: LEAGUE, memberId: 'm1', role: 'commissioner', displayName: 'Drew', leagueName: 'Paused Crew', status: 'paused', pilot: false, sportDefault: 'cfb' }]);
    auth.setActiveLeagueId(LEAGUE);
    auth.setCachedMaintenanceBannerLocally('Scheduled maintenance tonight');
    quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
    show(tab);
    assert(orderOf(tab) === 'maintenance-banner > paused-league-banner' && inPage(tab).length === 0, `[8n2-${tab}] (fixture) ${tab} has the maintenance and paused-league notices and no stall banner yet`);
    net.nfl = 'fail'; await poll('nfl', 3);
    assert(orderOf(tab) === 'maintenance-banner > paused-league-banner > sport-stall-banner', `[8n3-${tab}] a banner that ARRIVES in place seats itself BELOW the two notices (got "${orderOf(tab)}")`);
  }
  auth._setMembershipsForTest([]); auth.setActiveLeagueId(null); auth.setCachedMaintenanceBannerLocally('');
  setup({ admin: true });

  // node identity, the one fade, and a changed row set
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  app.state.currentTab = 'dashboard';
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('dashboard');
  const n1 = inPage('dashboard')[0];
  assert(!!n1 && /sport-stall-in/.test(n1.className), '[8o] a row set that has just arrived carries the one-time fade class');
  app._renderSportStallBannerIfNeededForTest('dashboard'); app._renderSportStallBannerIfNeededForTest('dashboard');
  const n2 = inPage('dashboard')[0];
  assert(n2 === n1 && /sport-stall-in/.test(n2.className), '[8p] an UNCHANGED repaint leaves the very same node in the document, untouched');
  show('dashboard');
  const n3 = inPage('dashboard')[0];
  assert(n3 !== n1 && !/sport-stall-in/.test(n3.className) && n3.getAttribute('data-rows') === n1.getAttribute('data-rows'), '[8q] the page rebuilt (a tick, a Realtime repaint): the same row set comes back as a new node already visible - NO fade class');
  net.cfb = 'fail'; await poll('cfb', 3);
  quiet(); try { comp.setDashboardScope('all'); } finally { loud(); }
  show('dashboard');
  const n4 = inPage('dashboard')[0];
  assert(n4 && n4 !== n3 && /sport-stall-in/.test(n4.className) && rowsOf(n4).length === 2, '[8r] a CHANGED row set (a second sport joins it) is a new node with the one fade, and one banner');
  show('dashboard');
  assert(!/sport-stall-in/.test(inPage('dashboard')[0].className), '[8s] ...and the next rebuild of that same set is quiet again (the fade plays once per change)');

  // before the hydrate / pre-backfill
  setup({ admin: true });
  net.nfl = 'fail'; await poll('nfl', 3);
  env.put('cfbp_competitions', []);
  assert(show('home').length === 0 && app._sportStallFactsForTest(NOW).length === 0, '[8t] no competition rows (before the hydrate, before the backfill): no facts, no banner - an unhydrated mirror never reads as a stalled sport');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[8b] NOTHING MOVES UNDER THE THUMB - the scroller is offset by the banner\'s height, only for a change on the page already on screen…');
// ═════════════════════════════════════════════════════════════════
{
  // The element tree has no layout (minidom answers every rect with a fixed 800 px height), so what is proven here is the DECISION: when the scroller is offset, by how much, and in which direction.
  // The same offset is MEASURED, frame by frame, in a real engine in sportstallbrowsertest.mjs [D].
  const scrolls = [];
  const realScrollTo = globalThis.scrollTo;
  globalThis.scrollTo = (o) => { scrolls.push(o && typeof o === 'object' ? o.top : o); };
  try {
    const heightOf = (tab) => app._stallPaintedForTest.get(tab)?.h || 0;
    // an arrival IN PLACE on a page the reader is scrolled down in
    setup({ admin: true, tab: 'dashboard' });
    quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
    show('dashboard');
    globalThis.scrollY = 300; scrolls.length = 0;
    net.nfl = 'fail'; await poll('nfl', 3);
    const h = heightOf('dashboard');
    assert(banners().length === 1 && h > 0 && scrolls.length === 1 && scrolls[0] === 300 + h, `[8u] a banner arriving in place while the page is scrolled (scrollY 300) offsets the scroller by exactly its block height (${h}): scrollTo(${JSON.stringify(scrolls)})`);
    // ...and its removal gives the space back, never past the top
    globalThis.scrollY = 1000; scrolls.length = 0;
    net.nfl = 'ok'; await poll('nfl', 1);
    assert(banners().length === 0 && scrolls.length === 1 && scrolls[0] === Math.max(0, 1000 - h), `[8v] its removal offsets the other way by the same height (scrollTo ${JSON.stringify(scrolls)} from 1000)`);
    setup({ admin: true, tab: 'dashboard' });
    quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
    globalThis.scrollY = 0; net.nfl = 'fail'; await poll('nfl', 3);
    const hh = heightOf('dashboard');
    globalThis.scrollY = 300; scrolls.length = 0; net.nfl = 'ok'; await poll('nfl', 1);
    assert(hh > 300 && scrolls.length === 1 && scrolls[0] === 0, `[8w] the offset never scrolls above the top of the page (a ${hh} px banner removed at scrollY 300 lands on 0)`);
    // at the top it simply pushes the page down: no offset
    setup({ admin: true, tab: 'dashboard' });
    quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
    show('dashboard');
    globalThis.scrollY = 0; scrolls.length = 0;
    net.nfl = 'fail'; await poll('nfl', 3);
    assert(banners().length === 1 && scrolls.length === 0, '[8x] at the top of the page (scrollY 0) the banner just pushes the page down: the scroller is not touched');
    globalThis.scrollY = 8; scrolls.length = 0;
    net.nfl = 'ok'; await poll('nfl', 1); net.nfl = 'fail'; await poll('nfl', 3);
    assert(scrolls.length === 0, '[8y] ...and eight points down is still "at the top" (the DI\'s threshold is more than 8)');
    // a NAVIGATION is not a change on the page the reader is on: its scroll is restored by the tab memory, never offset by a banner
    setup({ admin: true, tab: 'home' });
    quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
    net.nfl = 'fail'; await poll('nfl', 3);
    globalThis.scrollY = 300; scrolls.length = 0;
    show('dashboard');
    assert(banners().length === 1 && inPageOf('dashboard') && !scrolls.some((t) => t === 300 + heightOf('dashboard')), `[8z] navigating to a page that opens WITH the banner does not offset the scroller (scrollTo ${JSON.stringify(scrolls)})`);
    // a visit that passes THROUGH a page with no banner (Rules) must not leave the "already on this page" memory behind: coming back to a page that opens with the banner is a navigation
    setup({ admin: true, tab: 'dashboard' });
    quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
    show('dashboard');
    show('rules');
    net.nfl = 'fail'; await poll('nfl', 3);
    globalThis.scrollY = 300; scrolls.length = 0;
    show('dashboard');
    assert(banners().length === 1 && scrolls.every((t) => t !== 300 + heightOf('dashboard')), `[8zb] Dashboard -> Rules -> (the feed fails meanwhile) -> Dashboard: the banner is there on arrival and the scroller is left alone, because the tab change ended that visit (scrollTo ${JSON.stringify(scrolls)})`);
    // a rebuild with the SAME rows is no change at all
    globalThis.scrollY = 300; scrolls.length = 0;
    show('dashboard'); show('dashboard');
    assert(scrolls.every((t) => t !== 300 + heightOf('dashboard')), '[8za] a rebuild that puts the same rows back offsets nothing');
  } finally { globalThis.scrollTo = realScrollTo; globalThis.scrollY = 0; }
}
function inPageOf(tab) { return !!document.querySelector(`#${pageIds0(tab)} #sport-stall-banner`); }

// ═════════════════════════════════════════════════════════════════
console.log('\n[9] THE IN-PLACE PAINT IS ARMED BY A REAL POLL - and a parked repaint never blocks a touch…');
// ═════════════════════════════════════════════════════════════════
{
  // Picks is patched in place on a tick and never rebuilt: the banner must still arrive
  setup({ admin: true, tab: 'picks' });
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('picks');
  assert(banners().length === 0, '[9a] (fixture) Picks on NFL, no banner yet');
  const picksNode = document.getElementById('page-picks').firstElementChild;
  net.nfl = 'fail';
  await poll('nfl', 2);
  assert(banners().length === 0, '[9b] two failed polls: still nothing on Picks');
  await poll('nfl', 1);
  const pb = [...document.querySelectorAll('#page-picks #sport-stall-banner')];
  assert(pb.length === 1 && rowsOf(pb[0])[0] === C.feedCommissioner('NFL'), '[9c] the THIRD real failed poll puts the banner on the Picks page IN PLACE, with no navigation and no rebuild');
  assert(document.getElementById('page-picks').children.includes(picksNode), '[9d] ...and the page was not rebuilt to do it: the node that was first before is still there');
  net.nfl = 'ok'; await poll('nfl', 1);
  assert(banners().length === 0, '[9e] a real successful poll removes it from Picks in place');

  // Standings and Comm are never rebuilt by a tick either
  for (const tab of ['leaderboard', 'commissioner']) {
    setup({ admin: true, tab });
    quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
    show(tab);
    net.nfl = 'fail'; await poll('nfl', 3);
    assert([...document.querySelectorAll(`#${pageIds0(tab)} #sport-stall-banner`)].length === 1, `[9f-${tab}] a real poll paints the banner onto ${tab} in place`);
  }

  // through the real tick, three rounds
  setup({ admin: true, tab: 'leaderboard' });
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('leaderboard');
  net.nfl = 'fail'; net.cfb = 'ok';
  quiet(); try { for (let i = 0; i < 3; i++) await app.runAutoRefreshTick(); } finally { loud(); }
  assert(failures('nfl') === 3 && [...document.querySelectorAll('#page-leaderboard #sport-stall-banner')].length === 1, '[9g] three REAL ticks (the interval\'s own function) raise it on Standings; CFB, which kept answering, has none');
  assert(failures('cfb') === 0, '[9h] ...and each tick scored each sport on its own');

  // P-3: a repaint parked under a touch runs at its end and never blocks the next touch
  setup({ admin: true, tab: 'picks' });
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('picks');
  net.nfl = 'fail';
  assert(NG.claimTouch('week-swipe') === true, '[9i] (fixture) a week swipe owns the touch');
  await poll('nfl', 3);
  assert(banners().length === 0 && failures('nfl') === 3, '[9j] while the swipe owns the touch the in-place paint is PARKED (the record is already at 3, nothing is painted under the finger)');
  quiet(); try { NG.releaseTouchAndFlush('week-swipe'); } finally { loud(); }
  assert([...document.querySelectorAll('#page-picks #sport-stall-banner')].length === 1, '[9k] at the release the parked paint runs: the banner is there');
  assert(NG.claimTouch('week-swipe') === true && NG.touchClaimedBy() === 'week-swipe', '[9l] P-3: a NEW touch right after still gets the touch (the parked paint held nothing)');
  net.nfl = 'ok';
  await poll('nfl', 1);
  assert([...document.querySelectorAll('#page-picks #sport-stall-banner')].length === 1, '[9m] a second poll during that NEW touch parks too (the banner is still up: the clear has not run)');
  quiet(); try { NG.releaseTouchAndFlush('week-swipe'); } finally { loud(); }
  assert(banners().length === 0, '[9n] ...and runs at ITS release: the banner is gone');
  NG.releaseTouch('week-swipe');

  // N6 (review): a repaint that lands during a week-swipe SPRING-BACK waits for it, like the W-22 page repaints. The spring is held per PAGE (springingPages, keyed 'picks'), so the in-place paint
  // parks under the page key; under its own key it was never held. The hook puts the page in exactly the state springBack() does.
  setup({ admin: true, tab: 'picks' });
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('picks');
  net.nfl = 'fail';
  const endSpring = NG._holdSpringForTest('picks');
  await poll('nfl', 3);
  assert(failures('nfl') === 3 && banners().length === 0 && NG._deferredRenderCount() === 1, `[9o] while Picks' spring-back is still sliding the in-place paint is PARKED (the record is at 3, nothing painted, ${NG._deferredRenderCount()} repaint held)`);
  assert(NG.claimTouch('week-swipe') === true, '[9p] P-3: a NEW touch landing during the spring still gets the touch (the parked paint held nothing)');
  NG.releaseTouch('week-swipe');
  quiet(); try { endSpring(); } finally { loud(); }
  assert([...document.querySelectorAll('#page-picks #sport-stall-banner')].length === 1 && NG._deferredRenderCount() === 0, '[9q] when the spring ends the held paint runs: the banner is there and nothing is left parked');
  // another page's spring holds nothing of this page's
  setup({ admin: true, tab: 'picks' });
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('picks');
  net.nfl = 'fail';
  const endOther = NG._holdSpringForTest('dashboard');
  await poll('nfl', 3);
  assert([...document.querySelectorAll('#page-picks #sport-stall-banner')].length === 1, '[9r] a spring-back on ANOTHER page (the Dashboard) does not hold Picks\' paint');
  endOther();
  // a full repaint already parked for the page is never replaced by the in-place one (it paints the banner itself)
  setup({ admin: true, tab: 'picks' });
  quiet(); try { comp.setActiveSportKey('nfl'); } finally { loud(); }
  show('picks');
  net.nfl = 'fail';
  const endSpring2 = NG._holdSpringForTest('picks');
  let fullRan = 0;
  NG.deferRenderWhileWeekSwiping('picks', () => { fullRan++; });
  await poll('nfl', 3);
  assert(NG._deferredRenderCount() === 1 && fullRan === 0 && banners().length === 0, '[9s] a full repaint already parked for the page stays the ONE parked repaint: the in-place paint does not replace it');
  quiet(); try { endSpring2(); } finally { loud(); }
  assert(fullRan === 1, '[9t] ...and that full repaint is what runs when the spring ends (not the banner paint that would have dropped it)');
}
function pageIds0(tab) { return { home: 'page-home', picks: 'page-picks', dashboard: 'page-dashboard', leaderboard: 'page-leaderboard', commissioner: 'page-commissioner' }[tab]; }

// ═════════════════════════════════════════════════════════════════
console.log('\n[10] SOURCE SHAPE - where it is called from, what it never touches, the CSS contract…');
// ═════════════════════════════════════════════════════════════════
{
  const raw = read('./js/app.js');
  const src = stripComments(raw);
  const bodyOf = (header, from = 0) => {
    const at = src.indexOf(header, from); if (at < 0) return '';
    const open = src.indexOf(') {', at) + 2; let d = 0;
    for (let i = open; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(open, i + 1); } }
    return '';
  };
  // each renderer ENDS with the call, after the two siblings, and writes nothing to the page after it
  const lastCall = (body, tab) => {
    const at = body.lastIndexOf(`renderSportStallBannerIfNeeded('${tab}')`);
    if (at < 0) return false;
    const after = body.slice(at);
    return !/\.innerHTML\s*=(?!=)/.test(after) && !/insertAdjacentHTML\(/.test(after);
  };
  const below = (body, tab) => body.indexOf(`renderMaintenanceBannerIfNeeded('${tab}')`) > -1 && body.lastIndexOf(`renderSportStallBannerIfNeeded('${tab}')`) > body.lastIndexOf(`renderMaintenanceBannerIfNeeded('${tab}')`);
  for (const [hdr, tab] of [['function renderDashboard(', 'dashboard'], ['export function renderLeaderboard(', 'leaderboard'], ['export function renderCommPage(', 'commissioner']]) {
    const body = bodyOf(hdr);
    assert(!!body && lastCall(body, tab) && below(body, tab), `[10a-${tab}] ${hdr.replace('export ', '').replace('function ', '')}) ends with renderSportStallBannerIfNeeded('${tab}'), BELOW the maintenance call, writing nothing after it`);
  }
  const picks = bodyOf('function renderPicksPage(');
  assert((picks.match(/renderSportStallBannerIfNeeded\('picks'\)/g) || []).length === 2 && (picks.match(/renderMaintenanceBannerIfNeeded\('picks'\)/g) || []).length === 2, '[10b] Picks calls it on BOTH of its render exits, each after its maintenance call');
  const home = bodyOf('function renderHomePage(');
  assert(/renderPausedLeagueBannerIfNeeded\('home'\);\s*renderSportStallBannerIfNeeded\('home'\)/.test(home), '[10c] Home paints it right after the paused-league notice, outside #home-root');
  const nav = bodyOf('function navigateTo(');
  assert(/renderMaintenanceBannerIfNeeded\(tab\)[^]*renderSportStallBannerIfNeeded\(tab\)/.test(nav) && /if \(!linkFlow && !leagueFlow\) renderSportStallBannerIfNeeded\(tab\)/.test(nav), '[10d] navigateTo() is the catch-all, after the siblings, and not over a link-flow or league-flow screen');
  assert(!/renderSportStallBannerIfNeeded/.test(bodyOf('export function renderRulesPage(')) && !/renderSportStallBannerIfNeeded/.test(bodyOf('export function renderAdminPage(')) && !/sport-stall|SportStall/.test(read('./js/chat-ui.js')),
    '[10e] the Rules page, the Admin panel and the Locker Room (chat-ui.js) never reference it');
  // the stall block never writes the red node
  const blockStart = src.indexOf('const STALL_PAGE_IDS'), blockEnd = src.indexOf('export const _recordSportPollForTest');
  const block = src.slice(blockStart, blockEnd);
  const touchesRed = (t) => /backend-error-banner[\s\S]{0,120}?(\.remove\(|\.style\.\w+\s*=|\.setAttribute\(|\.innerHTML\s*=|\.id\s*=|\.className\s*=|\.classList\.|\.textContent\s*=)|showBackendErrorBanner\(|hideBackendErrorBanner\(/.test(t);
  assert(blockStart > 0 && blockEnd > blockStart && !touchesRed(block), '[10f] the stall code READS #backend-error-banner (exists and not display:none) and never removes, restyles, re-ids or re-writes it');
  assert(touchesRed(block + "\nconst r = document.getElementById('backend-error-banner'); r.style.display = 'none';") && touchesRed(block + "\nhideBackendErrorBanner();"), '[10g] canary: a stall block that hid the red node, or called its show/hide, is caught by the same scan');
  assert(/red\.style\?\.display !== 'none'/.test(block), '[10h] the visibility test is the DI\'s: the node exists and style.display !== "none"');
  assert(!/\bsave\w*\(|\bload\w*\(|localStorage|setItem|KEYS\./.test(block), '[10i] nothing in the stall code reaches the storage seam (no save/load, no localStorage, no key)');
  assert(!/\bsave\w*\(|\blocalStorage\b/.test(src.slice(src.indexOf('const _sportPollHealth'), src.indexOf('const _sportPollHealth') + 900)), '[10j] the poll-health record is a plain in-memory Map (createPollHealth), declared beside liveStatusById');
  assert(/const _sportPollHealth = createPollHealth\(\)/.test(src) && src.indexOf('const _sportPollHealth') > src.indexOf('export const liveStatusById') && src.indexOf('const _sportPollHealth') - src.indexOf('export const liveStatusById') < 900, '[10k] ...declared right beside liveStatusById, the precedent');
  // the record's only writer is doRefreshScores, after the fetch
  const dr = bodyOf('export async function doRefreshScores(');
  assert((src.match(/recordSportPoll\(/g) || []).length === 2 && dr.indexOf('recordSportPoll(week, bucketOutcomes)') > dr.indexOf('await refreshScoresByEventIds('), '[10l] recordSportPoll is DEFINED once and CALLED once: in doRefreshScores, after the fetch it scores (so a tick that never got there cannot count)');
  assert(dr.indexOf('recordSportPoll(') < dr.indexOf('for(const upd of updated)'), '[10m] ...and BEFORE the merge loop, so a throw in the loop cannot lose the observation');
  const ctx = bodyOf('function onContextSwitch(');
  assert(/clearPollHealth\(_sportPollHealth\)/.test(ctx) && /_stallPainted\.clear\(\)/.test(ctx), '[10n] onContextSwitch (the identity chokepoint\'s hook) clears the record and the painted map');
  assert(/function paintSportStallBanner\(tab\)[\s\S]*?isContentWithheld\(\)[\s\S]*?backendErrorBannerShowing\(\)/.test(src), '[10o] the paint asks isContentWithheld() and the red banner before it computes a single row');
  const dpSrc = stripComments(read('./js/data-provider.js'));
  assert(/bucketOutcomes\.set\(sport, result\.error \? \(result\.rawEventCount === 0 \? 'empty' : 'failed'\) : 'ok'\)/.test(dpSrc), '[10p] the per-bucket outcome is told from rawEventCount (an answered, empty board) and not from a message string');

  // the CSS contract
  const css = read('./css/styles.css');
  const rule = (sel) => (css.match(new RegExp(`(?:^|\\n)\\s*${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`)) || [])[1] || '';
  assert(/margin-bottom:16px/.test(rule('.paused-league-banner')) && /margin-bottom:16px/.test(rule('.maintenance-banner')) && /margin-bottom:16px/.test(rule('.sport-stall-banner')), '[10q] the three in-page notices take 16px below them (the paused and maintenance banners were 12px, off the 8-pt grid)');
  const stallRules = css.slice(css.indexOf('.sport-stall-banner{display:flex'), css.indexOf('@media (prefers-reduced-motion:reduce){.sport-stall-banner.sport-stall-in{animation:none}}') + 120);
  assert(!/\banimation\b/.test(rule('.sport-stall-banner')) && /\.sport-stall-banner\.sport-stall-in\{animation:paused-banner-fade-in var\(--motion-fast\) var\(--ease-native\)\}/.test(stallRules), '[10r] the fade is on the ARRIVING node only (.sport-stall-in), on --motion-fast and --ease-native: a node without the class never animates');
  assert(/@media \(prefers-reduced-motion:reduce\)\{\.sport-stall-banner\.sport-stall-in\{animation:none\}\}/.test(css), '[10s] Reduce Motion: no animation');
  assert(!/#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(/.test(stallRules), '[10t] no hex and no rgb in the new rules: tokens only (--push-bg and --warning-text come from .warning-box)');
  assert(/gap:8px/.test(rule('.sport-stall-banner')) && /gap:8px/.test(rule('.sport-stall-rows')), '[10u] 8px between the glyph and the text and between rows');
  assert(read('./service-worker.js').includes("'./js/sport-stall.js'"), '[10v] service-worker.js precaches js/sport-stall.js (app.js imports it statically)');
  assert(read('./loadtest.mjs').includes("'sport-stall'"), '[10w] loadtest.mjs section [1] imports js/sport-stall.js (RG-03)');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
await new Promise((r) => setTimeout(r, 20));
process.exit(fail ? 1 : 0);
