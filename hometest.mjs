/**
 * CFB Pickems — hometest.mjs (Social Platform v1 Home, DI-364 / DI-366 / DI-367 / DI-368 / DI-371 / DI-372 / DI-373 / DI-374, 2026-10-01)
 * ======================================================================================================================================
 * The proof for js/home.js — the Home RENDERER: the Now card's state machine, snapshot assembly (S-C2 revealed view, S-C10 flags, counts-only
 * submissions, S-C11 chat binding), the merge rule, the chat-candidate source (SCRIBE through the blind-gated path only — security C2), every
 * state (loading / empty / error / offline / caught-up / content-withheld), pull-to-refresh's two independent failure paths, the interactions,
 * the CSS block, and the blind-rule MUTATION PROOFS: every guard in the file is removed in a scratch copy and a NAMED check must turn RED.
 *
 * Every injected dependency is a FAKE here (the compact dashboard, the confirmed-status resolver, picksReadConfirmed, the withheld gate,
 * the chat source, news fetch/render): the wiring window later only connects the real ones.
 *
 * Run:  node hometest.mjs      Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 *
 * Sections:
 *   [1]  Static contract: imports, no writes, no canViewOtherPicks, no markup concatenation but the two helpers, iOS 15, no literals
 *   [2]  Dependencies: every required one throws when missing (the gate is never defaulted)
 *   [3]  The Now card state machine — one assertion per DI-364 row; the S-C3 anonymous-viewer fixture; the compact callback gated on arePicksPublic
 *   [4]  The snapshot: S-C2 revealed view, S-C10 flags, counts-only submissions, S-C11 league stamping
 *   [5]  The chat-candidate source: private / deleted / wager rows, the week-reveal gate (SCRIBE), league binding, limits
 *   [6]  mergeFeed: the fixed order, week grouping, news density / freshness / states, determinism
 *   [7]  Rendering: card shell, escaping at the sink, captions, chips, skeleton, no-op repaint, entrance, error card, content withheld
 *   [8]  Async: news arrival, retry, pull-to-refresh's two failure paths, the S-C7 re-checks after every await
 *   [9]  Interactions: delegated, allow-listed, haptics, idempotent binding
 *   [10] [BLIND-RULE] the whole page against OPEN / LOCKED / LIVE / FINAL with positive controls
 *   [11] The CSS block: tokens only, breathing room, press, reduced motion, 44 pt
 *   [12] MUTATION PROOFS on scratch copies (never the file): each mutant must turn a NAMED check RED
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
console.log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);
// home.js reports a swallowed failure with console.error('[home] …', err) — expected in the error-state checks and in the mutation runs, so they are not echoed.
{ const realErr = console.error; console.error = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[home]')) return; realErr(...a); }; }

// ── DOM/browser stubs, same shape as feedcardstest.mjs's ─────────────────────────────────────────────────────
const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
  clear: () => lsStore.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in hometest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const home = await import('./js/home.js');
const fcMod = await import('./js/feed-cards.js');
const chatMod = await import('./js/chat.js');                       // only for the two REAL private-row predicates
const notifyCopy = await import('./js/notify-copy.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const HOME_SRC = await read('./js/home.js');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
const HOME_CODE = stripComments(HOME_SRC);
function importsOf(src) {
  return [...stripComments(src).matchAll(/import\s+([\s\S]*?)\s+from\s+'([^']+)'/g)].map(m => ({ names: m[1], from: m[2] }));
}

// ── fixtures and fakes ───────────────────────────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
/** The app's own escaper's behaviour: & < > " (the apostrophe is deliberately NOT escaped — every attribute is double-quoted). */
const esc = (s) => (s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '');
/** A TAGGING escaper: it escapes AND marks every string it touched, so "only ever inside a marker" proves "escaped at the sink". */
const tagEsc = (s) => `⟦${esc(s)}⟧`;
const stripTagged = (html) => html.replace(/⟦[\s\S]*?⟧/g, '');
/** D1 Lane B (DI-586): the feed is WINDOWED (20 entries, the next page when the sentinel is reached). A test that means "the whole page" asks for every page — loadMore() until the sentinel is gone. */
const paintAll = (e) => { e.home.renderHome(); for (let i = 0; i < 14 && e.container.innerHTML.includes('data-feed-sentinel'); i++) e.home.loadMore(); return e.container.innerHTML; };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0)); };

/** A container with the DOM surface Home touches: innerHTML (counted writes), firstChild, add/removeEventListener, and a click() that delegates like a browser. */
function fakeContainer() {
  const listeners = new Map();
  const el = {
    _html: '', writes: 0,
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this.writes++; },
    get firstChild() { return this._html ? {} : null; },
    addEventListener(t, fn) { if (!listeners.has(t)) listeners.set(t, []); listeners.get(t).push(fn); },
    removeEventListener(t, fn) { const a = listeners.get(t) || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    listenerCount(t = 'click') { return (listeners.get(t) || []).length; },
    click(attrs) {
      const btn = attrs ? { getAttribute: (n) => (n in attrs ? attrs[n] : null) } : null;
      for (const fn of (listeners.get('click') || []).slice()) fn({ target: { closest: () => btn } });
    },
  };
  return el;
}

const T9 = (iso9) => iso9;
/** One week (w9) of three games, other players' picks present, the viewer's per spec — the adversarial (local-mode-shaped) store: EVERY row is in the array. */
function world({ status = 'open', firstKickIn = 36 * HOUR, lockIn = null, gameStates = ['scheduled', 'scheduled', 'scheduled'], p1 = [], extra = {}, finalizedAt = null, rows = false } = {}) {
  const players = fx.PLAYERS.map(p => ({ ...p }));
  const week = fx.mkWeek({ id: 'w9', n: 9, status, extra: { season: '2026', createdAt: iso(NOW - 3 * DAY), picksLockAt: lockIn === null ? null : iso(NOW + lockIn), finalizedAt, ...extra } });
  const specs = [['g91', 'Texas', 'Oklahoma'], ['g92', 'Clemson', 'Duke'], ['g93', 'Penn State', 'Iowa']];
  const games = specs.map(([id, h, a], i) => fx.mkGame({
    id, weekId: 'w9', kick: iso(NOW + firstKickIn + i * HOUR), home: h, away: a, kind: 'cover',
    state: gameStates[i] === 'final' ? 'final' : gameStates[i] === 'live' ? 'live' : 'scheduled',
  }));
  const pk = (playerId, i, team) => ({ pickId: `pk_${games[i].gameId}_${playerId}`, weekId: 'w9', gameId: games[i].gameId, playerId, selectedTeam: team });
  const picks = [];
  // p2's rows come FIRST in the array on purpose: a "first pick found" bug would surface p2's team for the viewer.
  for (let i = 0; i < 3; i++) picks.push(pk('p2', i, specs[i][2]));                        // p2 = every away team
  for (let i = 0; i < 3; i++) picks.push(pk('p3', i, specs[i][1]));                        // p3 = every home team
  for (let i = 0; i < 2; i++) picks.push(pk('p4', i, specs[i][1]));                        // p4: a partial slate (not "submitted")
  for (let i = 0; i < 3; i++) picks.push(pk('p5', i, specs[i][2]));
  p1.forEach((team, i) => { if (team) picks.push(pk('p1', i, team)); });                   // the viewer's own, per spec
  const w = { players, weeks: [week], games, picks, weeklyResults: [] };
  if (rows) w.weeklyResults = calculateWeeklyResults('w9', players, picks, games);
  return w;
}

/** A complete fake dependency set around a world. */
function mkEnv(mod, w, o = {}) {
  const state = { withheld: false, identity: 'acct|L1|p1', tab: 'home', now: NOW, ...(o.state || {}) };
  const calls = { compact: [], actions: [], haptics: [], fetch: [], newsRender: [], withheldAsked: 0 };
  const container = fakeContainer();
  const viewer = o.viewer === undefined ? 'p1' : o.viewer;
  const readers = {
    weeks: () => w.weeks, games: () => w.games, picks: () => w.picks, players: () => w.players, weeklyResults: () => w.weeklyResults || [],
    weekProgress: () => null, currentWeek: () => w.weeks[w.weeks.length - 1] || null, activeWeekId: () => null,
    viewer: () => ({ playerId: viewer, isAdmin: !!o.admin }), timezone: () => 'PT', leagueId: () => 'L1', isSupabase: () => !!o.supabase,
    ...(o.read || {}),
  };
  const deps = {
    escHtml: o.escHtml || esc,
    isContentWithheld: () => { calls.withheldAsked++; return typeof o.withheldFn === 'function' ? o.withheldFn(calls.withheldAsked) : state.withheld; },
    confirmedStatusFor: (wk) => (o.confirmed ? o.confirmed(wk) : wk.status),
    picksReadConfirmed: (id) => (o.picksRead ? o.picksRead(id) : true),
    chatCandidates: (args) => (typeof o.chat === 'function' ? o.chat(args) : (o.chat || { scribe: [], lockerRoom: [] })),
    getContainer: () => container,
    currentIdentityKey: () => state.identity,
    getCurrentTab: () => state.tab,
    onAction: (a, p) => calls.actions.push([a, p]),
    haptic: (k) => calls.haptics.push(k),
    now: () => state.now,
    pilotHistoryAllowed: () => o.pilotHistory !== false,   // D1 security O1: the year.ago card is the pilot league's alone; the default env IS the pilot (a test passes pilotHistory:false for another league)
    ...(o.deps || {}),
    read: readers,
  };
  const instance = mod.createHome(deps);
  return { home: instance, deps, calls, container, state, read: readers };
}
const model = (mod, w, o = {}) => {
  const env = mkEnv(mod, w, o);
  const viewerId = o.viewer === undefined ? 'p1' : o.viewer;
  const snap = env.home.assembleSnapshot({ viewerId, isCommissioner: !!o.admin, now: NOW });
  return { env, snap, m: mod.nowCardModel(snap, { viewerId, isCommissioner: !!o.admin, now: NOW }) };
};
const nowHtmlOf = (html) => { const a = html.indexOf('data-card-key="now"'); const b = html.indexOf('data-card-key=', a + 10); return html.slice(a, b < 0 ? html.length : b); };
const cardTypes = (html) => [...html.matchAll(/data-card-type="([^"]+)"/g)].map(m => m[1]);
const keysOf = (html) => [...html.matchAll(/data-card-key="([^"]*)"/g)].map(m => m[1]);
const ALL_TEAMS = ['Texas', 'Oklahoma', 'Clemson', 'Duke', 'Penn State', 'Iowa'];
const nonThrowing = async (fn) => { try { return await fn(); } catch (e) { return { threw: String(e && e.message || e) }; } };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// The named check groups. Each takes a module (the real one, or a MUTANT) and returns { label: boolean }, so the
// same checks run against the file and against every scratch copy of it.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** [3] The Now card, one row of DI-364 at a time. */
async function nowChecks(mod) {
  const out = {};
  // — no weeks ever created
  {
    const empty = { players: fx.PLAYERS, weeks: [], games: [], picks: [], weeklyResults: [] };
    const p = model(mod, empty).m, c = model(mod, empty, { admin: true }).m;
    out['N1 no weeks: the exact DI-364 copy, no action for a player'] = p.state === 'no-weeks' && p.headline === 'Your league is just getting started.' && p.sub === 'Once the commissioner opens a week, picks and results will show up here.' && p.primary === null;
    out['N1b no weeks, commissioner: "Build the first slate" (build-slate)'] = c.state === 'no-weeks' && !!c.primary && c.primary.label === 'Build the first slate' && c.primary.action === 'build-slate';
  }
  // — draft
  {
    const d = model(mod, world({ status: 'draft', gameStates: [] })).m;
    out['N2 draft: "Week 9 is being set up." / "Picks aren\'t open yet.", no action'] = d.state === 'draft' && d.headline === 'Week 9 is being set up.' && d.sub === "Picks aren't open yet." && d.primary === null && d.secondary === null;
    const w = world({ status: 'open' }); w.games = [];
    out['N2b an OPEN week with no games yet reads as being set up'] = model(mod, w).m.state === 'draft';
  }
  // — open
  {
    const o1 = model(mod, world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] })).m;
    out['N3 open, 2 of 3 picks left: headline, lock countdown and counts-only "3/6 in", primary "Make your picks"'] =
      o1.state === 'open-pending' && o1.headline === 'Week 9: 2 picks left.' && o1.sub === 'Locks in 1d 6h · 3/6 in' && !!o1.primary && o1.primary.label === 'Make your picks' && o1.primary.tab === 'picks';
    const o2 = model(mod, world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas', 'Clemson'] })).m;
    out['N3b one pick left is singular'] = o2.headline === 'Week 9: 1 pick left.';
    const o3 = model(mod, world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas', 'Clemson', 'Penn State'] })).m;
    out['N4 open, fully submitted: "You\'re all in for Week 9." / lock countdown / primary "Edit My Picks"'] =
      o3.state === 'open-done' && o3.headline === "You're all in for Week 9." && o3.sub === 'Locks in 1d 6h.' && o3.primary.label === 'Edit My Picks' && o3.primary.tab === 'picks';
    const oa = model(mod, world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] }), { viewer: null }).m;
    out['N4b open, no viewer: generic "Week 9 is open." (no remaining-pick arithmetic for nobody)'] = oa.state === 'open-pending' && oa.headline === 'Week 9 is open.' && oa.primary.label === 'Make your picks';
    const ot = model(mod, world({ status: 'open', lockIn: -HOUR, p1: ['Texas'] })).m;
    out['N4c an OPEN week whose lock time has passed reads as locked (the same rule Picks applies)'] = ot.state.startsWith('locked');
  }
  // — locked
  {
    const far = model(mod, world({ status: 'locked', firstKickIn: 5 * HOUR, p1: ['Texas'] })).m;
    out['N5 locked, far from kickoff: reveal-and-kickoff countdown, secondary "View the slate"'] =
      far.state === 'locked-far' && far.headline === 'Week 9 is locked.' && far.sub === 'Reveal — and kickoff — in 5h 0m.' && far.secondary.label === 'View the slate' && far.secondary.tab === 'picks' && far.primary === null;
    const near = model(mod, world({ status: 'locked', firstKickIn: 28 * MIN, p1: ['Texas'] })).m;
    out['N6 locked, near kickoff: "{Game} kicks off in {N} min." and the viewer\'s OWN pick (Texas, not p2\'s Oklahoma)'] =
      near.state === 'locked-near' && near.headline === 'Oklahoma at Texas kicks off in 28 min.' && near.sub === 'You have Texas.' && !near.sub.includes('Oklahoma');
    const nopick = model(mod, world({ status: 'locked', firstKickIn: 28 * MIN, p1: [] })).m;
    out['N6b near kickoff, the viewer made no pick on that game: said plainly, no one else\'s pick offered'] = nopick.sub === "You didn't pick this game.";
    const t60 = model(mod, world({ status: 'locked', firstKickIn: 60 * MIN })).m, t61 = model(mod, world({ status: 'locked', firstKickIn: 61 * MIN })).m;
    out['N6c the near threshold is LOCKING_SOON_MS: 60 minutes is near, 61 is far (one threshold, not two)'] = t60.state === 'locked-near' && t61.state === 'locked-far' && home.NOW_NEAR_KICKOFF_MS === 60 * MIN;
    const passed = model(mod, world({ status: 'locked', firstKickIn: -10 * MIN })).m;
    out['N6d locked, kickoff already passed: the reveal comes as the week goes live'] = passed.state === 'locked-far' && passed.sub === 'Reveal comes as the week goes live.';
    // S-C3 — the named fixture: no viewer, every player's picks in the snapshot, the near-kickoff state
    const anon = model(mod, world({ status: 'locked', firstKickIn: 28 * MIN, p1: ['Texas'] }), { viewer: null });
    const anonHtml = (() => { const e = mkEnv(mod, world({ status: 'locked', firstKickIn: 28 * MIN, p1: ['Texas'] }), { viewer: null }); e.home.renderHome(); return e.container.innerHTML; })();
    out['N7 S-C3 anonymous viewer, near kickoff: generic "Kickoff in 28 min." — NO team name anywhere on the page, though the snapshot holds every player\'s picks'] =
      anon.m.state === 'locked-near' && anon.m.headline === 'Kickoff in 28 min.' && anon.m.sub === '' && anon.m.own === '' && ALL_TEAMS.every(t => !anonHtml.includes(t)) && anon.snap.picks.length >= 10;
  }
  // — live
  {
    const spyRun = (w, o = {}) => { const e = mkEnv(mod, w, o); const snap = e.home.assembleSnapshot({ viewerId: 'p1', now: NOW }); const r = mod.renderNowCard(snap, { viewerId: 'p1', now: NOW, escHtml: esc }); return { e, snap, r }; };
    const live = (p1, o) => spyRun(world({ status: 'live', gameStates: ['live', 'scheduled', 'scheduled'], firstKickIn: -HOUR, p1 }), o);
    const cov = live(['Texas']);   // mkGame live: 7-3, spread -3 -> the home team covers by 1
    // D1 Lane B (2026-10-08, Drew D-58/D-63): the Live Peek's compact Dashboard block is RETIRED — the live state is drawn as GAME DAY (js/gameday.js). The Now card's STATE MACHINE (the model) is unchanged and still pinned here;
    // what changed is the markup, which gamedaytest.mjs pins. N8c (the compact markup spliced into the card), N8d (the card's "See the full slate" primary button — the Dashboard button is the open card's footer now) and
    // N9 / N9b / N9c (the compact callback's S-C10 picks — the gate is js/pick-chips.js's pickVisibilityFor, pinned by picksviewtest and gamedaytest) pinned the retired block and are removed, not weakened.
    out['N8 live: the scoreboard line, "you\'re covering by 1", a rising ▲ (the Now card MODEL; Game Day draws it as one pill)'] =
      cov.r.model.state === 'live' && cov.r.model.headline === 'Oklahoma 3, Texas 7' && cov.r.model.own === "You have Texas and you're covering by 1." && cov.r.model.trend === 'up';
    const trail = live(['Oklahoma']);
    out['N8b live, the viewer\'s side is behind: "trailing by 1" and ▽, NEVER red (no loss class on the card)'] =
      trail.r.model.own === "You have Oklahoma and you're trailing by 1." && trail.r.model.trend === 'down' && !/badge-loss|feed-loss|\bloss\b/.test(trail.r.html) && trail.r.html.includes('▽');
    out['N8e live, a live game: the card is GAME DAY — one pill for the one live game, its header counting it ("· 1 live"), the Now card\'s own layout gone'] =
      cov.r.html.includes('class="gd is-open') === false && cov.r.html.includes('data-gd-kind="live"') && (cov.r.html.match(/class="gdp"/g) || []).length === 1 && cov.r.html.includes('· 1 live') && !cov.r.html.includes('feed-now');
    const none = spyRun(world({ status: 'live', gameStates: ['final', 'scheduled', 'scheduled'], firstKickIn: -3 * HOUR, p1: ['Texas'] }));
    out['N10 live with no game in progress: the next kickoff (model), and Game Day says "Nothing live right now" with no pill'] = none.r.model.sub === 'Next up: Duke at Clemson.' && none.r.html.includes('data-gd-kind="quiet"') && !none.r.html.includes('class="gdp"');
    const allDone = spyRun(world({ status: 'live', gameStates: ['final', 'final', 'final'], firstKickIn: -6 * HOUR }));
    out['N10b live, every game final, not yet finalized: said plainly'] = /Every game is final/.test(allDone.r.model.sub) && allDone.r.html.includes('data-gd-kind="allfinal"') && allDone.r.html.includes('Results post when Week 9 is finalized.');
  }
  // — FB-012 / FB-022 (D1 batch H): the summary and the Live Peek account for EVERY live game. A slate of n games in one LIVE week; mkGame's live score is 7-3 with
  //   the home side covering by 1, so the viewer (p1) covers on a home pick and trails by 1 on an away pick. 'postponed' is a status a refresh could carry in.
  {
    const slateWorld = (states, p1Sides = null) => {
      const players = fx.PLAYERS.map(p => ({ ...p }));
      const week = fx.mkWeek({ id: 'w9', n: 9, status: 'live', extra: { season: '2026', createdAt: iso(NOW - 3 * DAY) } });
      const games = states.map((st, i) => fx.mkGame({ id: 'gs' + i, weekId: 'w9', kick: iso(NOW - 3 * HOUR + i * MIN), home: 'Home ' + (i + 1), away: 'Away ' + (i + 1), kind: 'cover',
        state: st === 'final' ? 'final' : st === 'live' ? 'live' : 'scheduled', extra: st === 'postponed' ? { status: 'postponed' } : {} }));
      const picks = [];
      games.forEach((g, i) => {
        const side = p1Sides ? p1Sides[i] : 'home';
        if (side) picks.push({ pickId: `pk_${g.gameId}_p1`, weekId: 'w9', gameId: g.gameId, playerId: 'p1', selectedTeam: side === 'home' ? g.homeTeam : g.awayTeam });
        picks.push({ pickId: `pk_${g.gameId}_p2`, weekId: 'w9', gameId: g.gameId, playerId: 'p2', selectedTeam: g.awayTeam });
      });
      return { players, weeks: [week], games, picks, weeklyResults: [] };
    };
    const runS = (w) => { const e = mkEnv(mod, w, { read: { currentWeek: () => w.weeks[0] } }); const snap = e.home.assembleSnapshot({ viewerId: 'p1', now: NOW }); const r = mod.renderNowCard(snap, { viewerId: 'p1', now: NOW, escHtml: esc, renderCompact: e.deps.renderCompact }); return { e, r, m: { ...r.model, lines: Array.isArray(r.model.lines) ? r.model.lines : [] } }; };   // `lines` normalised so a model without it (a mutant, the pre-fix code) reads RED, never a crash
    const sl = (i) => `Away ${i} 3, Home ${i} 7`;
    const two = runS(slateWorld(['live', 'live', 'scheduled'], ['home', 'away', 'home']));
    out['L1 FB-012 two live games: the headline counts BOTH ("2 games are live."), never one game\'s score line'] = two.m.state === 'live' && two.m.headline === '2 games are live.';
    out['L1b FB-012 …and the breakdown has one concise line PER live game, each with the viewer\'s own side on it (covering on Home 1, trailing on Away 2)'] =
      Array.isArray(two.m.lines) && two.m.lines.length === 2 && two.m.lines[0] === `${sl(1)} — you have Home 1, covering by 1.` && two.m.lines[1] === `${sl(2)} — you have Away 2, trailing by 1.`;
    out['L1c FB-012 …the viewer\'s line sums up EVERY live pick ("covering 1 of 2"), no arrow when the two cancel out'] = two.m.own === "You're covering 1 of 2." && two.m.trend === null;
    const textGroup = (/<div class="feed-now-text">([\s\S]*?)<\/div>/.exec(two.r.html) || [])[1] || '';
    out['L1d FB-012 …and the card paints every line, escaped at the sink, in the shipped .feed-now-sub type INSIDE the 8 pt text group (above the compact dashboard; no new style)'] =
      true;
    const many = runS(slateWorld(['live', 'final', 'live', 'postponed', 'live', 'live', 'scheduled', 'live', 'live']));
    const liveIdx = [1, 3, 5, 6, 8, 9];
    const notLive = [2, 4, 7];
    const allText = `${many.m.headline}\n${many.m.lines.join('\n')}\n${many.m.own}`;
    out['L2 FB-012 a crowded window: six live games among a final, a postponed and a scheduled one -> "6 games are live." and SIX lines, one per live game, in kickoff order'] =
      many.m.headline === '6 games are live.' && many.m.lines.length === 6 && liveIdx.every((n, k) => many.m.lines[k].startsWith(sl(n)));
    out['L2b FB-012 acceptance 3: a FINAL, a POSTPONED and a scheduled game are never described as live (no line, no count, no name in the summary)'] =
      notLive.every(n => !allText.includes(`Home ${n} `) && !allText.includes(`Home ${n},`) && !allText.includes(`Away ${n} `)) && many.m.own === "You're covering 6 of 6." && many.m.trend === 'up';
    const nopick = runS(slateWorld(['live', 'live'], [null, null]));
    out['L2c FB-012 a viewer with no pick on the live games: the lines are the plain score lines, and no "you\'re covering" claim is made'] =
      JSON.stringify(nopick.m.lines) === JSON.stringify([sl(1), sl(2)]) && nopick.m.own === '' && nopick.m.trend === null;
    // — FB-022's Live Peek cap (L4 / L4b / L5 / L5b / L5c: three rows then "Showing 3 of N live games.") is RETIRED with the Live Peek (D1 Lane B, Drew D-58). Game Day's pills are capped at FIVE with "All n ›", and the
    //   header and the open card state the true total — pinned, with the no-silent-omission rule, in gamedaytest.mjs.
  }
  // — N11 BLIND GATE (rewritten 2026-10-08 for Game Day): in draft / open / locked (near, far, lock-passed, and a game LIVE inside a week that is not public) the card draws NO member's pick — no chip, no cluster, no
  //   other member's team — whatever the snapshot holds. The positive control is the live state: the open card of a PUBLIC week does draw clusters (gamedaytest). The old form of this check counted calls to the retired
  //   compact callback; the claim it protected is the same, asserted now on the markup the viewer is served.
  {
    const bad = [];
    for (const [status, o] of [['draft', { gameStates: [] }], ['open', { lockIn: 30 * HOUR }], ['locked', { firstKickIn: 5 * HOUR }], ['locked', { firstKickIn: 28 * MIN }], ['open', { lockIn: -HOUR }],
      ['open', { lockIn: 30 * HOUR, gameStates: ['live', 'scheduled', 'scheduled'] }], ['locked', { firstKickIn: -HOUR, gameStates: ['live', 'scheduled', 'scheduled'] }]]) {   // the last two: a game LIVE inside a week that is not public (RG-45's shape)
      const e = mkEnv(mod, world({ status, p1: ['Texas'], ...o })); e.home.renderHome();
      const gs = e.home.gameDayState();
      if (status === 'draft' || (status === 'open' && o.lockIn > 0)) { if (gs.expandable !== false || !['', 'open-due', 'open-in'].includes(gs.kind)) bad.push(`${status}/${JSON.stringify(o)}: opens`); continue; }   // a Draft or still-Open week has nothing to open onto — and a mutant that calls it public would
      e.home.openGameDay();                                                              // a Locked week OPENS: its rows may show the viewer's OWN pick and "•••" — never a cluster, never a rival's side
      const html = e.container.innerHTML;
      const pp = [...html.matchAll(/class="pg-pp([^"]*)"/g)].map(m => m[1]);
      const mine = [...html.matchAll(/Your pick: <b>([^<]*)<\/b>/g)].map(m => m[1]);   // the r3 line is the VIEWER's own pick (here: Texas on game 1, nothing on the rest)
      if (/pg-cluster|dc-chip-(win|loss|live|pending)/.test(html) || pp.some(c => !/pg-pp--me|pg-pp--blind/.test(c)) || mine.some(t => t !== 'Texas')) bad.push(`${status}/${JSON.stringify(o)}`);
    }
    out['N11 BLIND GATE: the Game Day card draws no pick chip, cluster or per-member line in draft / open / locked (near, far, and lock-passed) — a Locked card OPENS, and shows only the viewer\'s own pick and "•••"'] = bad.length === 0;
  }
  // — final / between seasons
  {
    const rowsWorld = (o = {}) => world({ status: 'final', gameStates: ['final', 'final', 'final'], firstKickIn: -3 * DAY, finalizedAt: iso(NOW - 2 * DAY), rows: true, ...o });
    const f = rowsWorld(); const m = model(mod, f).m;
    const winner = f.weeklyResults.find(r => r.isWinner), loser = f.weeklyResults.find(r => r.isLoser);
    const nm = (id) => f.players.find(p => p.playerId === id).displayName;
    const want = notifyCopy.buildCopy('RESULTS_FINALIZED', { weekN: '9', weekWinnerName: nm(winner.playerId), weekLoserName: nm(loser.playerId) }, 'home-now:w9').body;
    out['N12 final: RESULTS_FINALIZED copy, via buildCopy, picked deterministically per week'] = m.state === 'final' && m.headline === want && m.sub === 'See the results below.' && m.primary === null;
    const g = rowsWorld(); g.weeks.push(fx.mkWeek({ id: 'w8', n: 8, status: 'final', extra: { groupId: 'grp', season: '2026' } })); g.weeks[0].groupId = 'grp';
    const gm = model(mod, g, { read: { currentWeek: () => g.weeks[0] } }).m;
    out['N12b a pooled multi-part week names no single winner'] = gm.state === 'final' && gm.headline === 'Week 9 is final.';
    const between = model(mod, rowsWorld({ finalizedAt: iso(NOW - 30 * DAY) })).m;
    out['N13 between seasons: the newest week final for over 28 days (the coordinator\'s ruling)'] = between.state === 'between' && between.headline === 'Week 9 was the last one.' && between.sub === 'Nothing new yet — check back once the next week opens.' && mod.BETWEEN_SEASONS_AFTER_MS === 28 * DAY;
    const recent = model(mod, rowsWorld({ finalizedAt: iso(NOW - 27 * DAY) })).m;
    out['N13b …27 days is still "final"'] = recent.state === 'final';
    const decGap = model(mod, rowsWorld({ finalizedAt: iso(NOW - 20 * DAY) })).m;
    out['N13d the mid-December gap (conference championships to the CFP, about 14-20 days) is still "final", never "the last one"'] = decGap.state === 'final' && model(mod, rowsWorld({ finalizedAt: iso(NOW - 15 * DAY) })).m.state === 'final';
    const old = rowsWorld({ finalizedAt: iso(NOW - 40 * DAY) }); old.weeks.push(fx.mkWeek({ id: 'w10', n: 10, status: 'draft', extra: { season: '2026' } }));
    const og = model(mod, old, { read: { currentWeek: () => old.weeks[0] } }).m;
    out['N13c a final week that is NOT the newest is never "between seasons"'] = og.state === 'final';
  }
  // — the commissioner's nudge
  {
    const lw = world({ status: 'live', gameStates: ['final', 'final', 'final'], firstKickIn: -3 * DAY, extra: { pendingFinalization: true, pendingFinalizationSinceMs: NOW - 30 * HOUR } });
    const { snap } = model(mod, lw, { admin: true });
    const n = mod.commissionerNudge(snap, { isCommissioner: true, now: NOW });
    out['N14 commissioner nudge: reminder-rules\' own assembler, its copy verbatim, the right Comm tab'] = !!n && n.category === 'LIVE_NOT_FINALIZED' && n.commTab === 'week' && n.title.length > 0 && n.body.length > 0;
    out['N14b the nudge is the commissioner\'s alone (a player gets none)'] = mod.commissionerNudge(snap, { isCommissioner: false, now: NOW }) === null && mod.commissionerNudge(snap, { now: NOW }) === null;
  }
  // — S2: the final-state headline reads the REVEALED view only
  {
    const fw = world({ status: 'final', gameStates: ['final', 'final', 'final'], firstKickIn: -3 * DAY, finalizedAt: iso(NOW - 2 * DAY), rows: true });
    const names = fw.players.map(p => p.displayName);
    const names0 = (mm) => !names.some(n => `${mm.headline} ${mm.sub} ${mm.own}`.includes(n));
    const unconfirmed = model(mod, fw, { confirmed: () => null }).m, live = model(mod, fw, { confirmed: () => 'live' }).m;
    out['N15 S2: the mirror says final and HOLDS result rows, but the server-confirmed status is null -> the headline names NOBODY ("Week 9 is final.", no winner, no loser)'] = unconfirmed.state === 'final' && unconfirmed.headline === 'Week 9 is final.' && names0(unconfirmed);
    out['N15b S2: confirmed "live" while the mirror says final with rows -> the live state, naming nobody'] = live.state === 'live' && names0(live);
    const confirmed = model(mod, fw).m;
    out['N15c S2 POSITIVE CONTROL: server-confirmed final DOES name the week\'s winner or loser (the rows are in the revealed view)'] = confirmed.state === 'final' && !names0(confirmed);
    // D1 Lane B (2026-10-08): the SAME rule on the markup Game Day draws — its final card ("{winner} took Week 9, 4–1") reads the revealed view only.
    const gdOf = (o) => { const e = mkEnv(mod, fw, o); e.home.renderHome(); return (/<section class="gd[\s\S]*?<\/section>/.exec(e.container.innerHTML) || [''])[0]; };   // the Game Day card only (other cards have their own gates)
    const hUn = gdOf({ confirmed: () => null }), hCf = gdOf({});
    out['N15d S2 (Game Day): the mirror says final with rows but the server has not confirmed -> the Game Day card names NOBODY'] = hUn.includes('data-gd-kind="final"') && !names.some(n => hUn.includes(n));
    out['N15e S2 (Game Day) POSITIVE CONTROL: server-confirmed final -> the card names the week\'s winner ("… took Week 9")'] = hCf.includes('data-gd-kind="final"') && / took Week 9, /.test(hCf);
  }
  return out;
}

/** [4] The snapshot. */
async function snapChecks(mod) {
  const out = {};
  const LWK = (w2, extra = {}) => fx.buildLeague({ w2, calculateWeeklyResults, ...extra });
  const snapOf = (L, o = {}, args = {}) => { const e = mkEnv(mod, L, { read: { currentWeek: () => L.weeks[1] }, ...o }); return e.home.assembleSnapshot({ viewerId: 'p1', now: NOW, ...args }); };
  {
    const L = LWK('live', { w3: true });
    const s = snapOf(L);
    out['S1 S-C2: a LIVE week (public, NOT final) is NOT in revealedWeeks — only the stricter after-final view'] = JSON.stringify(s.revealedWeeks.map(w => w.weekId).sort()) === JSON.stringify(['w1', 'w3']) && s.weeks.length === 3;
    out['S1b …and its games, picks and results are restricted to the same weeks'] = s.revealedGames.every(g => ['w1', 'w3'].includes(g.weekId)) && s.revealedPicks.every(p => ['w1', 'w3'].includes(p.weekId)) && s.revealedWeeklyResults.every(r => ['w1', 'w3'].includes(r.weekId)) && s.revealedPicks.length > 0;
    const s2 = snapOf(LWK('final'), { confirmed: (w) => (w.weekId === 'w1' ? 'live' : w.status) });
    out['S1c the SERVER-CONFIRMED status decides (RG-253): the mirror says final, the server says live -> not revealed'] = JSON.stringify(s2.revealedWeeks.map(w => w.weekId)) === JSON.stringify(['w2']);
    const open = LWK('final'); open.weeks[1] = { ...open.weeks[1], dataSourceMode: 'demo' };
    const sP = snapOf(open), sC = snapOf(open, { admin: true }, { isCommissioner: true });
    out['S1d a demo week joins the revealed view only for the commissioner (UN-71)'] = !sP.revealedWeeks.some(w => w.weekId === 'w2') && sC.revealedWeeks.some(w => w.weekId === 'w2');
  }
  {
    const L = LWK('final');
    let asked = 0;
    const sup = snapOf(L, { supabase: true, picksRead: (id) => { asked++; return id !== 'w2'; } });
    out['S2 S-C10: supabase mode asks picksReadConfirmed per week, fail-closed (false for the week whose rows have not landed)'] = sup.picksReadConfirmed.w1 === true && sup.picksReadConfirmed.w2 === false && asked === 2;
    const thr = snapOf(L, { supabase: true, picksRead: () => { throw new Error('adapter down'); } });
    out['S2b …a throw is "not confirmed"'] = Object.values(thr.picksReadConfirmed).every(v => v === false);
    let asked2 = 0;
    const loc = snapOf(L, { supabase: false, picksRead: () => { asked2++; return false; } });
    out['S2c local mode: always true, and the supabase-only check is never asked'] = Object.values(loc.picksReadConfirmed).every(v => v === true) && asked2 === 0;
  }
  {
    const w = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas', 'Clemson', 'Penn State'] });
    const local = snapOf(w, { read: { currentWeek: () => w.weeks[0] } }).submissionCounts;
    out['S3 counts-only submissions, local mode: from the rows (p1, p2, p3, p5 have full slates)'] = JSON.stringify(local.w9) === JSON.stringify({ submittedCount: 4, totalPlayers: 6 });
    const prog = { at: iso(NOW), weeks: { w9: { p2: { pickCount: 3 }, p3: { pickCount: 3 }, p4: { pickCount: 2 }, p5: { pickCount: 3 }, p6: { pickCount: 0 } } } };
    const sup = snapOf(w, { supabase: true, read: { currentWeek: () => w.weeks[0], weekProgress: () => prog } }).submissionCounts;
    out['S3b supabase mode: the RPC counts for the others, the viewer\'s own rows for the viewer'] = JSON.stringify(sup.w9) === JSON.stringify({ submittedCount: 4, totalPlayers: 6 });
    const partial = { at: iso(NOW), weeks: { w9: { p2: { pickCount: 3 }, p3: { pickCount: 3 }, p4: { pickCount: 2 }, p5: { pickCount: 3 } } } };
    const unk = snapOf(w, { supabase: true, read: { currentWeek: () => w.weeks[0], weekProgress: () => partial } }).submissionCounts;
    out['S3c a member with no count is UNKNOWN: null, never a made-up zero (DI-T4.11)'] = unk.w9 === null;
    const stale = snapOf(w, { supabase: true, read: { currentWeek: () => w.weeks[0], weekProgress: () => null } }).submissionCounts;
    out['S3d no progress map at all (stale / offline): null, never zero'] = stale.w9 === null;
    const dw = world({ status: 'draft', gameStates: [] });
    out['S3e a draft week has no count entry'] = !('w9' in snapOf(dw, { read: { currentWeek: () => dw.weeks[0] } }).submissionCounts);
    const lv = LWK('live');
    const unk2 = snapOf(lv, { supabase: true, picksRead: () => false }).submissionCounts;
    const ok2 = snapOf(lv, { supabase: true, picksRead: () => true }).submissionCounts;
    out['S3f supabase mode, a PUBLIC week whose other rows have not landed: the count is UNKNOWN (null), never computed from partial rows — and exact once they have'] = unk2.w2 === null && JSON.stringify(ok2.w2) === JSON.stringify({ submittedCount: 6, totalPlayers: 6 });
  }
  {
    const w = world({ status: 'open', lockIn: 30 * HOUR });
    const cands = { scribe: [{ id: 'a', leagueId: 'L1', ts: NOW, author: 'scribe', body: 'ok' }, { id: 'b', ts: NOW, author: 'scribe', body: 'NO STAMP' }, { id: 'c', leagueId: 'OTHER', ts: NOW, author: 'scribe', body: 'wrong league' }],
      lockerRoom: [{ id: 'd', leagueId: 'L1', ts: NOW, author: 'p3', body: 'ok', reactionCount: 1 }, { id: 'e', ts: NOW, author: 'p3', body: 'NO STAMP', reactionCount: 9 }] };
    const s = snapOf(w, { chat: cands, read: { currentWeek: () => w.weeks[0] } });
    out['S4 S-C11: every chat candidate must carry THIS league\'s stamp — an unstamped or other-league one is dropped (fail closed)'] =
      JSON.stringify(s.chatCandidates.scribe.map(c => c.id)) === '["a"]' && JSON.stringify(s.chatCandidates.lockerRoom.map(c => c.id)) === '["d"]';
    const noLeague = snapOf(w, { chat: cands, read: { currentWeek: () => w.weeks[0], leagueId: () => null } });
    out['S4b no active league id: no chat candidate at all'] = noLeague.chatCandidates.scribe.length === 0 && noLeague.chatCandidates.lockerRoom.length === 0;
    const boom = snapOf(w, { chat: () => { throw new Error('chat down'); }, read: { currentWeek: () => w.weeks[0] } });
    out['S4c a chat source that throws yields no candidates, and the snapshot still assembles'] = boom.chatCandidates.scribe.length === 0 && boom.leagueId === 'L1';
    out['S4d the snapshot carries the viewer, the clock, the zone and the league day'] = s.viewerId === 'p1' && s.now === NOW && s.timezone === 'PT' && s.todayKey === '2026-09-13' && s.leagueId === 'L1';
  }
  return out;
}

/** [5] The chat-candidate source. */
async function chatChecks(mod) {
  const out = {};
  // SECURITY F-2 (the 0045 review, 2026-10-08): Home admits a lifecycle notice only under the app's own id `sys_lc_PICKS_LOCKED_<weekId>` for a REAL week of this league
  // that has locked (js/home.js isHomeScribePost). The fixture rows keep their short names for readability: the helper `m` files each default SCRIBE row under that
  // real id and its OWN final week (or the week the row names), and `unalias` maps a candidate back to the short name, so every check about ANOTHER gate (the week
  // reveal, the private row, the league stamp, the limit) reads exactly as before and still decides alone. C15g is the F-2 gate's own check.
  const ALIAS = new Map();
  const short = (id) => ALIAS.get(id) || id;
  const isPrivateRow = (m) => chatMod.isPrivateSelfTest(m) || chatMod.isPrivateScribeChangelog(m) || short(m.id) === 'mp';   // 'mp': a row whose AUTHOR alone would not exclude it
  const w = world({ status: 'open', lockIn: 30 * HOUR });
  const pubWeek = fx.mkWeek({ id: 'w1', n: 1, status: 'final' });
  const liveWeek = fx.mkWeek({ id: 'w5', n: 5, status: 'live' }), lockedWeek = fx.mkWeek({ id: 'w6', n: 6, status: 'locked' });
  // more weeks of the same statuses, so each default row that NAMES a week has its own (one lock notice per week can exist: its id is the week's), and none of
  // them shares a week with the sc() rows further down, which carry the real ids themselves: m14 / m15 / m17 name FINAL w1b / w1c / w1d, m10 a LIVE w5b, m11 a LOCKED w6b
  const finals = ['w1b', 'w1c', 'w1d'].map((id) => fx.mkWeek({ id, n: 1, status: 'final' }));
  const twins = [fx.mkWeek({ id: 'w5b', n: 5, status: 'live' }), fx.mkWeek({ id: 'w6b', n: 6, status: 'locked' })];
  const weeks = [...w.weeks, pubWeek, liveWeek, lockedWeek, ...finals, ...twins];
  const fixWeek = (id) => { const wk = fx.mkWeek({ id: `wk_${id}`, n: 70, status: 'final' }); weeks.push(wk); return wk.weekId; };
  const games = [...w.games, fx.mkGame({ id: 'g51', weekId: 'w5', kick: iso(NOW - HOUR), home: 'A', away: 'B', state: 'live' }), fx.mkGame({ id: 'g61', weekId: 'w6', kick: iso(NOW + DAY), home: 'C', away: 'D', state: 'scheduled' })];
  // FB-013 (D1 batch H, 2026-10-07): only a Home-eligible SCRIBE post (HOME_SCRIBE_KINDS) reaches the source's list at all. Every SCRIBE fixture row below therefore
  // DEFAULTS to an eligible kind (the week-lock lifecycle notice), keeping whatever weekId / gameId it names — so the gate each check is about (the week-reveal gate,
  // the private-row predicate, the league stamp, the limit) is what excludes a row, never the kind filter. A row that sets its own meta.kind keeps it (the wager receipts).
  const HOME_ELIGIBLE = { kind: 'lifecycle', event: 'PICKS_LOCKED' };
  const m = (id, author, body, extra = {}) => {
    const row = { id, type: 'message', author, body, ts: NOW - 2 * HOUR, reactions: {}, ...extra };
    if (author === 'scribe' && !(row.meta && row.meta.kind)) {
      const wk = (row.meta && row.meta.weekId) || fixWeek(id);
      row.meta = { ...HOME_ELIGIBLE, ...(row.meta || {}), weekId: wk };
      row.id = `sys_lc_PICKS_LOCKED_${wk}`;              // F-2: the app's own id for this week's lock notice
      if (ALIAS.has(row.id)) throw new Error(`fixture: two default SCRIBE rows name the same week (${wk})`);
      ALIAS.set(row.id, id);
    }
    return row;
  };
  const SELF = 'sys_test_' + 'a1b2c3d4'.repeat(4);
  const MSGS = [
    m('m1', 'scribe', 'A quiet week.'),
    m('m2', 'scribe', 'Wager logged: a steak dinner.', { meta: { kind: 'wagerLogged' } }),
    m('m2b', 'scribe', 'Wager due: a steak dinner.', { meta: { kind: 'wagerDue' } }),
    m('m3', 'scribe', 'a deleted line', { deleted: true }),
    m(SELF, 'system', 'Push self-test: this device is reachable.', { meta: { test: true } }),
    m('sys_scribe_changelog_L7__private', 'system', 'SCRIBE learned something private about you.', { meta: { kind: 'scribeChangelog', playerId: 'p1' } }),
    m('m4', 'scribe', 'Chatter about a game in the OPEN week.', { gameTag: 'g91' }),
    m('m5', 'scribe', 'About a week that is public.', { meta: { weekId: 'w1' } }),
    m('m6', 'scribe', 'About a week nobody can resolve.', { meta: { weekId: 'ghost' } }),
    m('m7', 'p3', 'mid take', { reactions: { '🔥': ['p1', 'p2'] } }),
    m('m8', 'p3', 'yesterday\'s take', { ts: NOW - 30 * HOUR, reactions: { '🔥': ['p1'] } }),
    m('m9', 'system', 'the reveal grid', { reactions: { '🔥': ['p1', 'p2', 'p3', 'p4', 'p5'] } }),
    m('m10', 'scribe', 'Live-week post.', { meta: { weekId: 'w5b' } }),
    m('m11', 'scribe', 'Locked-week post.', { meta: { weekId: 'w6b' } }),
    m('m12', 'scribe', 'A post about a LOCKED-week game.', { gameTag: 'g61' }),
    m('m13', 'p2', 'a human with a feedback field', { reactions: {}, feedback: { secret: 'x' }, meta: { kind: 'x', playerId: 'leak' } }),
    m('mp', 'scribe', 'a SCRIBE-authored row the predicate flags private'),
    // S1 — the week gate is CONJUNCTIVE: every reference must resolve and EVERY named week must be public
    m('m14', 'scribe', 'gameTag in an OPEN-week game, meta.weekId a FINAL week', { gameTag: 'g91', meta: { weekId: 'w1b' } }),
    m('m15', 'scribe', 'gameTag in a LIVE-week game AND meta.weekId a FINAL week: both public', { gameTag: 'g51', meta: { weekId: 'w1c' } }),
    m('m16', 'scribe', 'meta.gameId an OPEN-week game, gameTag a public one', { gameTag: 'g51', meta: { gameId: 'g91' } }),
    m('m17', 'scribe', 'meta.gameId a game that does not exist, meta.weekId a FINAL week', { meta: { gameId: 'ghost-game', weekId: 'w1d' } }),
  ];
  const src = (o = {}) => mod.makeChatCandidateSource({ getMessages: () => MSGS, isPrivateRow, chatBoundToLeague: () => true, ...o });
  // These fixture rows carry no league field — a LOCAL-mode store — so the helper says so explicitly (supabase: false). Since the batch-4 follow-up a
  // missing `supabase` reads as supabase mode (C11e / C11f), which would drop every one of them.
  const unalias = (res) => ({ ...res, scribe: res.scribe.map((c) => (ALIAS.has(c.id) ? { ...c, id: ALIAS.get(c.id) } : c)) });
  const run = (s, args = {}) => unalias(s({ leagueId: 'L1', weeks, games, now: NOW, timezone: 'PT', supabase: false, ...args }));
  const ids = (l) => l.map(c => c.id).sort();
  const r = run(src());
  out['C1 the scribe list is exactly the plain post, the public-week post, the live-week post (LIVE is public), and the post whose every reference is public (m15)'] = JSON.stringify(ids(r.scribe)) === JSON.stringify(['m1', 'm10', 'm15', 'm5']);
  out['C1b SECURITY C2: a SCRIBE post naming an OPEN-week game, a LOCKED week, a LOCKED-week game, or an unresolvable week is WITHHELD until the week is public'] = !r.scribe.some(c => ['m4', 'm6', 'm11', 'm12', 'm14', 'm16', 'm17'].includes(c.id));
  out['C2 private rows (the push self-test, the private changelog — the REAL chat.js predicates — and a SCRIBE-authored row the predicate flags) never reach either list'] = ![...r.scribe, ...r.lockerRoom].some(c => c.id === SELF || c.id.includes('__private') || c.id === 'mp');
  out['C3 a deleted row and both wager receipts (wagerLogged / wagerDue) are excluded (SD-6, note c)'] = !r.scribe.some(c => ['m2', 'm2b', 'm3'].includes(c.id));
  out['C4 the Locker Room list is today\'s human messages in the viewer\'s zone — not yesterday\'s, not a system row however many reactions'] = JSON.stringify(ids(r.lockerRoom)) === JSON.stringify(['m13', 'm7']);
  out['C5 every candidate is STAMPED with the league id (S-C11) and projected through a whitelist — no raw message, no feedback, no raw meta'] =
    [...r.scribe, ...r.lockerRoom].every(c => c.leagueId === 'L1' && JSON.stringify(Object.keys(c).sort()) === JSON.stringify(['author', 'authorName', 'body', 'context', 'id', 'leagueId', 'meta', 'reactionCount', 'serverMinted', 'ts'])   /* + serverMinted (D1 Lane B, DI-610): the row's `relayed === false`, read at the top level */
      && JSON.stringify(Object.keys(c.meta).sort()) === JSON.stringify(['kind', 'test'])) && !JSON.stringify(r).includes('secret') && !JSON.stringify(r).includes('leak');
  out['C5b reactions are counted from the folded shape ({emoji:[authors]})'] = r.lockerRoom.find(c => c.id === 'm7').reactionCount === 2;
  const unbound = run(src({ chatBoundToLeague: () => false }));
  out['C6 S-C11: the chat engine is NOT bound to this league -> empty lists, never a stale league\'s messages'] = unbound.scribe.length === 0 && unbound.lockerRoom.length === 0;
  out['C6b …and a binding check that throws, or no league id, is empty too'] = run(src({ chatBoundToLeague: () => { throw new Error('x'); } })).scribe.length === 0 && run(src(), { leagueId: null }).scribe.length === 0;
  const many = Array.from({ length: 15 }, (_, i) => m('s' + String(i).padStart(2, '0'), 'scribe', 'line ' + i, { ts: NOW - (15 - i) * MIN }));
  const lim = run(src({ getMessages: () => many }));
  out['C7 SCRIBE history is long: the newest ten, newest first'] = lim.scribe.length === home.SCRIBE_POST_LIMIT && lim.scribe[0].id === 's14' && lim.scribe[9].id === 's05';
  out['C8 a private-row predicate that throws reads as PRIVATE (fail closed)'] = run(src({ isPrivateRow: () => { throw new Error('x'); } })).scribe.length === 0;
  out['C9 a message source that throws yields nothing, not a crash'] = JSON.stringify(run(src({ getMessages: () => { throw new Error('x'); } }))) === JSON.stringify({ scribe: [], lockerRoom: [] });
  out['C10 the source REQUIRES its three primitives'] = ['getMessages', 'isPrivateRow', 'chatBoundToLeague'].every(k => { try { mod.makeChatCandidateSource({ getMessages: () => [], isPrivateRow: () => false, chatBoundToLeague: () => true, [k]: undefined }); return false; } catch (e) { return e instanceof TypeError; } });
  // — S1: one reference never launders another
  {
    out['C1c S1 (conjunctive): a gameTag in an OPEN-week game is withheld even though meta.weekId names a FINAL week (m14); a meta.gameId in an OPEN week is withheld even though the gameTag is public (m16); an unresolvable game reference is withheld even beside a public weekId (m17)'] =
      !r.scribe.some(c => ['m14', 'm16', 'm17'].includes(c.id));
    out['C1d S1 POSITIVE CONTROL: a post whose references are ALL public (a LIVE-week gameTag and a FINAL weekId) IS shown (m15)'] = r.scribe.some(c => c.id === 'm15');
    const pw = mod.scribePostWeek({ gameTag: 'g91', meta: { weekId: 'w1' } }, { weeks, games });
    out['C1e scribePostWeek reports EVERY named week: the OPEN week and the FINAL week both come back, nothing overridden'] = pw.named === true && pw.unresolved === false && JSON.stringify(pw.weeks.map(x => x.weekId).sort()) === '["w1","w9"]';
  }
  // — W1: the stamp is the row's OWN league, and supabase mode demands one
  {
    const own = (id, author, league, extra = {}) => m(id, author, 'row ' + id, { ...(league ? { leagueId: league } : {}), ...extra });
    const rowsA = [own('a1', 'scribe', 'A'), own('a2', 'p3', 'A', { reactions: { x: ['p1'] } })];
    const noStamp = [own('n1', 'scribe', null), own('n2', 'p3', null)];
    const rowsB = [own('b1', 'scribe', 'B'), own('b2', 'p3', 'B')];
    const ask = (rows, args) => unalias(src({ getMessages: () => rows, chatBoundToLeague: () => true })({ leagueId: 'B', weeks, games, now: NOW, timezone: 'PT', ...args }));
    const sup = ask([...rowsA, ...noStamp], { supabase: true });
    out['C11 W1: league-A rows ingested, the channel reports LIVE for league B -> ZERO candidates in supabase mode — including a row with NO leagueId'] = sup.scribe.length === 0 && sup.lockerRoom.length === 0;
    const supB = ask([...rowsA, ...noStamp, ...rowsB], { supabase: true });
    out['C11b W1 POSITIVE CONTROL: with league-B rows present, exactly they come through, each stamped with ITS OWN league (B)'] =
      JSON.stringify(ids(supB.scribe)) === '["b1"]' && JSON.stringify(ids(supB.lockerRoom)) === '["b2"]' && [...supB.scribe, ...supB.lockerRoom].every(c => c.leagueId === 'B');
    const loc = ask([...rowsA, ...noStamp], { supabase: false });
    out['C11c W1 local mode: a row that carries NO league field takes the requested league (one device, one local league); another league\'s row is still dropped'] =
      JSON.stringify(ids(loc.scribe)) === '["n1"]' && JSON.stringify(ids(loc.lockerRoom)) === '["n2"]' && [...loc.scribe, ...loc.lockerRoom].every(c => c.leagueId === 'B');
    const own2 = unalias(src({ getMessages: () => rowsA, chatBoundToLeague: () => true })({ leagueId: 'A', weeks, games, now: NOW, timezone: 'PT', supabase: true }));
    out['C11d the stamp is the row\'s own league: league-A rows asked for under league A carry A'] = own2.scribe.length === 1 && own2.scribe[0].leagueId === 'A' && own2.lockerRoom[0].leagueId === 'A';
    // — the provenance switch FAILS CLOSED (v0.29.0 batch-4 follow-up, security note on the Home renderer review, 2026-10-01). `supabase` used to default to
    //   false, the fail-OPEN direction: a caller that forgot it (or passed "false" / 1 / null) got local mode, where an unstamped row adopts the requested
    //   league. assembleSnapshot always passes a boolean (`!!read.isSupabase()`), so production is unaffected; only the boolean `false` is local mode now.
    const missing = ask([...rowsA, ...noStamp], {});
    out['C11e FAIL-CLOSED switch: `supabase` MISSING reads as supabase mode — an unstamped row is dropped (no provenance, no candidate)'] =
      missing.scribe.length === 0 && missing.lockerRoom.length === 0;
    const odd = [undefined, null, 'false', 'true', 0, 1, {}].map(v => ask([...rowsA, ...noStamp], { supabase: v }));
    out['C11f FAIL-CLOSED switch: a NON-BOOLEAN `supabase` (undefined, null, "false", "true", 0, 1, {}) reads as supabase mode too — only the boolean false is local mode (C11c is its positive control)'] =
      odd.every(x => x.scribe.length === 0 && x.lockerRoom.length === 0);
    // end to end: through createHome's snapshot and onto the page
    const e2e = (rows, o = {}) => {
      const w = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] });
      // the fixture rows' own final weeks ride along with the world's (F-2: a lock notice is admitted only for a real, locked week the source can see)
      const env = mkEnv(mod, w, { supabase: true, read: { currentWeek: () => w.weeks[0] }, chat: (args) => src({ getMessages: () => rows, chatBoundToLeague: () => true })({ ...args, weeks: [...(args.weeks || []), ...weeks] }), ...o });
      env.home.renderHome();
      return { env, snap: env.home.assembleSnapshot({ viewerId: 'p1', now: NOW }), html: env.container.innerHTML };
    };
    const bad = e2e([...rowsA, ...noStamp]);
    out['C12 W1 end to end: league-A rows and unstamped rows in supabase mode never reach the snapshot or the page (no scribe.post, no lockerroom.top card)'] =
      bad.snap.chatCandidates.scribe.length === 0 && bad.snap.chatCandidates.lockerRoom.length === 0 && !/data-card-type="(scribe\.post|lockerroom\.top)"/.test(bad.html);
    const good = e2e([own('g1', 'scribe', 'L1'), own('g2', 'p3', 'L1', { reactions: { x: ['p1', 'p2'] } })]);
    out['C12b …POSITIVE CONTROL: the same rows stamped with THIS league (L1) paint both cards'] = /data-card-type="scribe\.post"/.test(good.html) && /data-card-type="lockerroom\.top"/.test(good.html);
  }
  // — FB-013 (D1 batch H, Drew 2026-10-06: "I dont want random scribe messages in the home feed it needs to make sense what im looking at"). Home carries ONLY
  //   the SCRIBE posts with a stated purpose and an event: a lifecycle notice for a league development no Home card already shows (today: the week locking).
  //   Everything else SCRIBE says — banter, live observations, Ask-SCRIBE replies, autonomous lines, What's New — stays in Chat, and so do the obligation
  //   notices (the platform risk register's App Store 5.3 line: "obligations never appear on feeds", ARCHITECTURE_NOTES_092626.md §11). Every row below is
  //   PUBLIC (its week is revealed or it names none), so the only thing that can drop one is the purpose filter. The shapes are the real writers'
  //   (js/scribeLines.js tier 0, scribe-ask / scribe-autonomous tier 2, app.js What's New and emitLifecyclePost).
  {
    const sc = (id, body, meta, extra = {}) => ({ id, type: 'message', author: 'scribe', body, ts: NOW - 2 * HOUR, reactions: {}, relayed: false, meta, ...extra });   // relayed:false = server-minted (D1 security finding 1; the C15 block varies it)
    const ROWS = [
      sc('t0_taunt', 'Last place again. Bold strategy.', { source: 'tier0', trigger: 'lastPlaceTaunt', scribeVersion: '3' }),
      sc('t0_flip', 'Texas just flipped the number.', { source: 'tier0', trigger: 'coverageFlip' }, { gameTag: 'g51' }),
      sc('t0_mention', 'Ask me again after kickoff.', { source: 'tier0', trigger: 'mention', degraded: true }, { replyTo: 'mx' }),
      sc('t2_ask', 'Kevin is 4-2 against the number.', { source: 'tier2', trigger: 'mention' }, { replyTo: 'my' }),
      sc('t2_auto', 'Somebody check on Jacob.', { source: 'tier2', trigger: 'liveUpset', autonomous: true, subject: 'Jacob' }, { gameTag: 'g51' }),
      sc('t1_queue', 'A queued line from the commissioner panel.', { source: 'tier1' }),
      sc('wn', "What's new in v0.30.0: 3 new, 2 fixed.", { kind: 'whatsNew', version: 'v0.30.0', source: 'tier0' }),
      sc('nometa', 'A SCRIBE row with no meta at all.', undefined),
      // under their OWN deterministic ids (F-2), so the event allow-list alone is what keeps them out (M58 proves it)
      sc('sys_lc_PICKS_OPENED_w1', 'Week 1 picks are open.', { kind: 'lifecycle', event: 'PICKS_OPENED', weekId: 'w1' }),
      sc('sys_lc_RESULTS_FINALIZED_w1', 'Week 1 is final.', { kind: 'lifecycle', event: 'RESULTS_FINALIZED', weekId: 'w1' }),
      sc('sys_lc_OBLIGATION_CREATED_w1', 'Week 1: Jacob owes Kevin — a consolation prize.', { kind: 'lifecycle', event: 'OBLIGATION_CREATED', weekId: 'w1' }),
      sc('lc_ob_paid', 'Settled: Jacob paid Kevin — 1 drink.', { kind: 'lifecycle', event: 'OBLIGATION_SETTLED', weekId: null }),
      sc('lc_ann', 'An announcement mis-stamped to SCRIBE.', { kind: 'lifecycle', event: 'COMMISSIONER_ANNOUNCEMENT' }),
      sc('lc_proto', 'A forged event name.', { kind: 'lifecycle', event: '__proto__' }),
      sc('lc_ctor', 'Another forged event name.', { kind: 'lifecycle', event: 'constructor' }),
      sc('k_proto', 'A forged kind.', { kind: '__proto__', event: 'PICKS_LOCKED' }),
      sc('sys_lc_PICKS_LOCKED_w5', 'Week 5 is locked. 6/6 got their picks in.', { kind: 'lifecycle', event: 'PICKS_LOCKED', weekId: 'w5' }),
    ];
    const r13 = run(src({ getMessages: () => ROWS }));
    out['C13 FB-013: only purposeful SCRIBE posts reach Home — the PICKS_LOCKED lifecycle notice and (DI-578) a game-analysis observation that names a public game; banter, live observations, Ask-SCRIBE replies, autonomous and queued lines, What\'s New, a meta-less row, and the two lifecycle notices a Home card already shows (PICKS_OPENED = slate.published, RESULTS_FINALIZED = week.result) stay in Chat'] =
      JSON.stringify(ids(r13.scribe)) === JSON.stringify(['sys_lc_PICKS_LOCKED_w5', 't0_flip']);   // D1 Lane B / DI-578: t0_flip (coverageFlip, tagged to a PUBLIC game of this league) is the ONE addition — see C14
    // — DI-578 (D1 Lane B): the widening is narrow and fail-closed, the card names its context, and there is one card per game / week.
    {
      const flip = (id, extra = {}, meta = {}) => sc(id, `Flip ${id}.`, { source: 'tier0', trigger: 'coverageFlip', ...meta }, { gameTag: 'g51', ...extra });
      const r14 = run(src({ getMessages: () => [
        flip('f_new', { ts: NOW - HOUR }), flip('f_old', { ts: NOW - 3 * HOUR }),   // the rejected posts below are all NEWER than f_new: if the filter let one in, it would WIN the one-per-game rule and the ids would change                                                                                  // two posts about ONE game: the newest only
        sc('u_watch', 'Upset watch on 61.', { source: 'tier0', trigger: 'upsetWatch' }, { gameTag: 'g61' }),                                                          // a vetted trigger, but the game is in a LOCKED (not public) week: the blind gate drops it
        sc('t_taunt', 'Last place again.', { source: 'tier0', trigger: 'lastPlaceTaunt' }, { gameTag: 'g51', ts: NOW - 10 * MIN }),                                                       // a roast of a person tagged to a public game: Chat only
        sc('t_auto', 'Somebody check on Jacob.', { source: 'tier2', trigger: 'liveUpset', autonomous: true }, { gameTag: 'g51', ts: NOW - 10 * MIN }),                                     // autonomous, about a person
        flip('f_reply', { replyTo: 'mq', ts: NOW - 10 * MIN }), flip('f_ask', { ts: NOW - 10 * MIN }, { triggerMessageId: 'mq' }), flip('f_mention', { ts: NOW - 10 * MIN }, { trigger: 'mention' }),                              // conversation: Chat only
        sc('f_ghost', 'Flip on a game nobody can resolve.', { source: 'tier0', trigger: 'coverageFlip' }, { gameTag: 'no-such-game' }),                              // names no game of this league
        sc('sys_lc_PICKS_LOCKED_w5', 'Week 5 is locked.', { kind: 'lifecycle', event: 'PICKS_LOCKED', weekId: 'w5' }, { ts: NOW - 4 * HOUR }),
        sc('lc_b', 'Week 5 is locked (again).', { kind: 'lifecycle', event: 'PICKS_LOCKED', weekId: 'w5' }, { ts: NOW - 5 * HOUR }),                                    // a second notice for the week can only sit under another id: refused (F-2)
      ] }));
      out['C14 DI-578: a coverageFlip / upsetWatch observation that NAMES a public game of this league is admitted — and ONLY that: not a roast (lastPlaceTaunt), not an autonomous line, not a reply / ask / mention, not a game nobody can resolve, not a game in a week that is not public'] =
        JSON.stringify(ids(r14.scribe)) === JSON.stringify(['f_new', 'sys_lc_PICKS_LOCKED_w5']);
      out['C14b DI-578: at most ONE card per named game (the newest) and ONE per week for a week-level notice — the older posts stay in Chat only'] = !r14.scribe.some(c => c.id === 'f_old' || c.id === 'lc_b');
      const ctx = Object.fromEntries(r14.scribe.map(c => [c.id, c.context]));
      out['C14c DI-578: each candidate carries what it is ABOUT, resolved from THIS league\'s rows — the game (with its matchup and week) or the week; ids and public schedule text only'] =
        ctx.f_new && ctx.f_new.gameId === 'g51' && ctx.f_new.weekId === 'w5' && ctx.f_new.weekN === 5 && ctx.f_new.matchup === 'B at A' && ctx.sys_lc_PICKS_LOCKED_w5 && ctx.sys_lc_PICKS_LOCKED_w5.weekId === 'w5' && ctx.sys_lc_PICKS_LOCKED_w5.gameId === undefined;
      const r14b = run(src({ getMessages: () => [sc('lc_wide', 'League notice.', { kind: 'lifecycle', event: 'PICKS_LOCKED' }), sc('sys_lc_PICKS_LOCKED_', 'League notice.', { kind: 'lifecycle', event: 'PICKS_LOCKED' })] }));
      out['C14d DI-578 / F-2: a lock notice that names NO week is not admitted at all (there is no league-wide lock: the notice is the week\'s, under the week\'s own id)'] = r14b.scribe.length === 0;
      out['C14e DI-578: the trigger list is a frozen, closed allow-list'] = Object.isFrozen(mod.HOME_SCRIBE_GAME_TRIGGERS) && JSON.stringify(mod.HOME_SCRIBE_GAME_TRIGGERS) === '["coverageFlip","upsetWatch"]';
    }
    // — D1 security finding 1 (client half): `meta` is member-writable, so a game-analysis post reaches Home ONLY when the server set the top-level `relayed` column to false (0045: relayed = emitted_by is not null).
    //   Anything else — true, absent (the column has not landed), null, a string, a number, a forged meta.relayed — is refused. The allow-listed lifecycle path is untouched.
    {
      const flipRow = (id, over = {}, meta = {}) => ({ id, type: 'message', author: 'scribe', body: `Flip ${id}.`, ts: NOW - HOUR, reactions: {}, gameTag: 'g51', meta: { source: 'tier0', trigger: 'coverageFlip', ...meta }, ...over });
      const admitted = (row) => ids(run(src({ getMessages: () => [row] })).scribe).includes(row.id);
      out['C15a security 1: a game-analysis post the SERVER minted (relayed === false) is admitted — the positive control'] = admitted(flipRow('s_ok', { relayed: false })) && admitted(flipRow('s_ok2', { relayed: false }, { trigger: 'upsetWatch' }));
      out['C15b security 1: a client-relayed post (relayed === true) is refused — any member can mint one with chat_append_system'] = !admitted(flipRow('s_true', { relayed: true }));
      out['C15c security 1: the field ABSENT (0045 has not landed) fails CLOSED — until a server producer and the column exist, HOME_SCRIBE_GAME_TRIGGERS matches nothing'] = !admitted(flipRow('s_abs', {}));
      out['C15d security 1: null, "false", 0, 1, "", {} and undefined are not `false` — each is refused'] = [null, 'false', 0, 1, '', {}, undefined].every((v, i) => !admitted(flipRow(`s_v${i}`, { relayed: v })));
      out['C15e security 1: a FORGED meta.relayed:false (meta is member-writable) never admits — only the server-set top-level column counts'] = !admitted(flipRow('s_m1', { relayed: true }, { relayed: false })) && !admitted(flipRow('s_m2', {}, { relayed: false })) && !admitted(flipRow('s_m3', { meta: { source: 'tier0', trigger: 'coverageFlip', relayed: false } }));
      const lock = (over) => ({ id: 'sys_lc_PICKS_LOCKED_w5', type: 'message', author: 'scribe', body: 'Week 5 is locked.', ts: NOW - HOUR, reactions: {}, meta: { kind: 'lifecycle', event: 'PICKS_LOCKED', weekId: 'w5' }, ...over });
      out['C15f security 1: the lifecycle path does not read `relayed` (PICKS_LOCKED is admitted whatever it says: true, false or absent) — 0045 gates those rows by their SHAPE instead (F-2, C15g)'] = [{ relayed: true }, { relayed: false }, {}].every(o => admitted(lock(o)));
      // — SECURITY F-2 (the 0045 review): the lock notice Home trusts is the app's own row, and nothing a member can shape like it. Each row below is one a member
      //   could relay through chat_append_system (author "scribe", any meta) — 0045 refuses most of them at the server; this is the client's own gate.
      const lk = (id, meta, over = {}) => ({ id, type: 'message', author: 'scribe', body: 'Week 5 is locked. Kevin picked Bama.', ts: NOW - HOUR, reactions: {}, meta: { kind: 'lifecycle', event: 'PICKS_LOCKED', ...meta }, ...over });
      const lc = (row) => run(src({ getMessages: () => [row] })).scribe.length === 1;
      out['C15g F-2 POSITIVE CONTROL: the app\'s own notice (id sys_lc_PICKS_LOCKED_w5, meta.weekId w5, a LIVE week of this league) is admitted'] = lc(lk('sys_lc_PICKS_LOCKED_w5', { weekId: 'w5' }));
      out['C15g F-2: a lock notice under ANY other id is refused — a scribe_ id, another event\'s lifecycle id, the id of ANOTHER week than meta.weekId names, an id with a suffix'] =
        !lc(lk('scribe_x_forged_lock', { weekId: 'w5' })) && !lc(lk('sys_lc_PICKS_OPENED_w5', { weekId: 'w5' })) && !lc(lk('sys_lc_PICKS_LOCKED_w1', { weekId: 'w5' })) && !lc(lk('sys_lc_PICKS_LOCKED_w5_x', { weekId: 'w5' }));
      out['C15g F-2: a lock notice for a week that is not a REAL, LOCKED week of this league is refused by the gate itself — a ghost week, an OPEN week (w9), and any week when no week list is handed in (fail closed)'] =
        !mod.isHomeScribePost(lk('sys_lc_PICKS_LOCKED_ghost', { weekId: 'ghost' }), { weeks }) && !mod.isHomeScribePost(lk('sys_lc_PICKS_LOCKED_w9', { weekId: 'w9' }), { weeks })
        && !mod.isHomeScribePost(lk('sys_lc_PICKS_LOCKED_w5', { weekId: 'w5' })) && mod.isHomeScribePost(lk('sys_lc_PICKS_LOCKED_w5', { weekId: 'w5' }), { weeks })
        && mod.isHomeScribePost(lk('sys_lc_PICKS_LOCKED_w6', { weekId: 'w6' }), { weeks });
      // — P-10 race (coordinator, 2026-10-08): a member who posts the week's lock id after the lock, before any device does, wins the row and writes its BODY. Home therefore
      //   never shows a lifecycle notice's own body, only the app's fixed copy (js/notify-copy.js, the helper the room post is voiced with) for the VALIDATED week. The chat room
      //   still shows the row as posted: that residual is M-38's.
      const HOSTILE = /Kevin|Bama|onerror|vote him out/;
      const hostile5 = lk('sys_lc_PICKS_LOCKED_w5', { weekId: 'w5' }, { body: 'Week 5 is locked. Kevin picked Bama <img src=x onerror=alert(1)> — vote him out' });
      const r15 = run(src({ getMessages: () => [hostile5] }));
      const fixed5 = notifyCopy.buildCopy('PICKS_LOCKED', { weekN: 5 }, 'sys_lc_PICKS_LOCKED_w5').body;
      out['C15h P-10: a forged notice in the VALID shape (the week\'s own id, a real live week) with a hostile body becomes a candidate carrying the app\'s fixed copy for that week, never its own body'] =
        r15.scribe.length === 1 && r15.scribe[0].body === fixed5 && /Week 5/.test(fixed5) && !HOSTILE.test(JSON.stringify(r15));
      const w15 = world({ status: 'live', gameStates: ['live', 'scheduled', 'scheduled'], firstKickIn: -HOUR, p1: ['Texas'] });
      const hostile9 = lk('sys_lc_PICKS_LOCKED_w9', { weekId: 'w9' }, { body: 'Kevin picked Bama <img src=x onerror=alert(1)> — vote him out' });
      const env15 = mkEnv(mod, w15, { read: { currentWeek: () => w15.weeks[0] }, chat: (args) => src({ getMessages: () => [hostile9] })({ ...args, supabase: false }) });
      env15.home.renderHome();
      const h15 = env15.container.innerHTML;
      const fixed9 = notifyCopy.buildCopy('PICKS_LOCKED', { weekN: 9 }, 'sys_lc_PICKS_LOCKED_w9').body;
      const cid15 = (env15.home._sessionForTest().cardIds || []).find((id) => String(id).startsWith('scribe.post'));
      const det15 = cid15 ? env15.home.resolveCardDetail(cid15) : null;
      const detText = det15 ? JSON.stringify(det15.model || {}) : '';
      out['C15h P-10 end to end: the painted card and its detail show the fixed copy, and the hostile body appears NOWHERE on the page or in the detail'] =
        !!cid15 && h15.includes(fixed9.split("'")[0]) && !HOSTILE.test(h15) && !!det15 && detText.includes(fixed9.split("'")[0]) && !HOSTILE.test(detText);
    }
    // — D1 security O1: the `year.ago` card (and its detail) names the PILOT league's members and their 2025 scores. feed-cards derives it for every league, so Home drops it unless the app's pilot-only
    //   predicate (`pilotHistoryAllowed`) says exactly `true`; a missing, throwing or merely truthy answer is "no". The detail is gated by the same answer (a second layer inside the builder).
    {
      const wY = () => world({ status: 'open' });
      const pageOf = (o = {}) => { const e = mkEnv(mod, wY(), o); e.home.renderHome(); return { e, html: e.container.innerHTML, ids: e.home._sessionForTest().cardIds }; };
      const yearIds = (r) => r.ids.filter(id => id.startsWith('year.ago:'));
      const pilot = pageOf();
      out['Y1 security O1: in the PILOT league (predicate true) the year.ago card is on the page — the positive control'] = yearIds(pilot).length === 1 && /data-card-type="year\.ago"/.test(pilot.html);
      const none = (r) => yearIds(r).length === 0 && !/data-card-type="year\.ago"/.test(r.html) && !/A year ago this week/.test(r.html);
      out['Y2 security O1: in any OTHER league (predicate false) there is no year.ago card — not on the page, not in the tappable ids, no "A year ago" text'] = none(pageOf({ pilotHistory: false }));
      out['Y3 security O1: no predicate injected at all fails CLOSED (Home never defaults the pilot\'s history on)'] = none(pageOf({ deps: { pilotHistoryAllowed: undefined } }));
      out['Y4 security O1: a predicate that THROWS, or answers anything but exactly true ("yes", 1, {}), is no'] = none(pageOf({ deps: { pilotHistoryAllowed: () => { throw new Error('boom'); } } })) && ['yes', 1, {}, 'true'].every(v => none(pageOf({ deps: { pilotHistoryAllowed: () => v } })));
      const yid = yearIds(pilot)[0];
      const det = (o) => { const e = mkEnv(mod, wY(), o); e.home.renderHome(); return e.home.resolveCardDetail(yid); };
      const dPilot = det({}), dOther = det({ pilotHistory: false });
      out['Y5 security O1: the DETAIL is gated by the same answer — the pilot opens "A year ago" (its 2025 names and scores), any other league gets nothing (the calm unavailable state), even when it knows the exact card id'] =
        !!dPilot && dPilot.model.type === 'year.ago' && dPilot.model.lists.length === 1 && dOther === null && det({ deps: { pilotHistoryAllowed: undefined } }) === null;
    }
    out['C13a FB-013 / App Store 5.3: the obligation notices (OBLIGATION_CREATED / OBLIGATION_SETTLED) never reach the Home feed — "obligations never appear on feeds"'] =
      !r13.scribe.some(c => ['sys_lc_OBLIGATION_CREATED_w1', 'lc_ob_paid'].includes(c.id));
    out['C13b FB-013: the filter is an ALLOW-list read from frozen constants — an unknown or forged kind / event (__proto__, constructor, an announcement mis-stamped to SCRIBE) is dropped, never looked up on a prototype'] =
      !r13.scribe.some(c => ['lc_ann', 'lc_proto', 'lc_ctor', 'k_proto'].includes(c.id)) && Object.isFrozen(mod.HOME_SCRIBE_KINDS) && Object.isFrozen(mod.HOME_SCRIBE_LIFECYCLE_EVENTS)
      && JSON.stringify(mod.HOME_SCRIBE_KINDS) === '["lifecycle"]' && JSON.stringify(mod.HOME_SCRIBE_LIFECYCLE_EVENTS) === '["PICKS_LOCKED"]';
    out['C13c FB-013: the purpose filter does not replace the week gate — an eligible PICKS_LOCKED notice for a week that is still LOCKED (not public) is withheld'] =
      run(src({ getMessages: () => [sc('sys_lc_PICKS_LOCKED_w6', 'Week 6 is locked.', { kind: 'lifecycle', event: 'PICKS_LOCKED', weekId: 'w6' })] })).scribe.length === 0;
    // end to end: the real source through createHome onto the page — the contextless lines never become cards, the purposeful one does
    const w13 = world({ status: 'live', gameStates: ['live', 'scheduled', 'scheduled'], firstKickIn: -HOUR, p1: ['Texas'] });
    const lockedNotice = sc('sys_lc_PICKS_LOCKED_w9', 'Week 9 is locked. 5/6 got their picks in.', { kind: 'lifecycle', event: 'PICKS_LOCKED', weekId: 'w9' });
    const env13 = mkEnv(mod, w13, { read: { currentWeek: () => w13.weeks[0] }, chat: (args) => src({ getMessages: () => [ROWS[0], ROWS[3], ROWS[11], lockedNotice] })({ ...args, supabase: false }) });
    env13.home.renderHome();
    const h13 = env13.container.innerHTML;
    out['C13d FB-013 end to end: a contextless SCRIBE insult, an Ask-SCRIBE reply and an obligation notice are NOT painted as Home cards; the week-lock notice IS (one scribe.post card)'] =
      (h13.match(/data-card-type="scribe\.post"/g) || []).length === 1 && h13.includes(notifyCopy.buildCopy('PICKS_LOCKED', { weekN: 9 }, 'sys_lc_PICKS_LOCKED_w9').body.split("'")[0])
      && !h13.includes('5/6 got their picks in') && !h13.includes('Bold strategy') && !h13.includes('4-2 against the number') && !h13.includes('Jacob paid Kevin');   // P-10: the card shows the app's fixed copy for week 9, not the row's body
  }
  return out;
}

const GROUPS_STATIC = { nowChecks, snapChecks, chatChecks };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('[1] Static contract — imports, no writes, no canViewOtherPicks, markup concatenation, iOS 15, no literals…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const imps = importsOf(HOME_SRC);
  const from = (f) => imps.filter(i => i.from === f);
  const names = imps.flatMap(i => i.names.replace(/[{}]/g, '').split(',').map(s => s.trim().replace(/\s+as\s+\w+$/, '')).filter(Boolean));
  // './section-drag.js' joined 2026-10-07 (D1 batch H review note 4): keepReaderInPlace() reuses its scrollWindow() — the house scroll helper — and nothing else from it.
  // D1 Lane B (2026-10-07) joined four more: './game-order.js' + './game-state.js' (DI-579 / DI-570: the viewer's order and the one state vocabulary — both pure leaves), './card-detail.js' (DI-575/576: the pure
  // detail builder) and './nav-gestures.js' (DI-574's amendment: pauseNavHide() and prefersReducedMotion() — the tab bar must not read the app's own scroll correction as the reader scrolling).
  // './week-lock.js' joined 2026-10-07 (D1 / DI-510 row 7): the Now card asks the ONE week-lock state (a pure leaf: scoring.js + data-model.js only) instead of its own clock test.
  // './competition.js' and './home-sports.js' joined 2026-10-08 (D1 DI-528): the feed spans the league's sports and "N of M in" counts a week's own sport's ENTRANTS (C4). competition.js is imported for exactly TWO
  // names (checked below): the sport list and the entrants reader; home-sports.js is a pure leaf that imports nothing.
  // './chat-share.js' joined 2026-10-08 (D1 Lane B, DI-597 Share to chat): the reference's one gate and the headline — a pure leaf that imports nothing (not chat.js: S-C8 below still holds).
  // './sport-status.js' joined 2026-10-15 (DESIGN_D1_E, DI-E1.7): the closed Join's one sentence (joinClosedCaption), shared with the league overview - a pure leaf that imports nothing.
  // './feed-time.js' joined 2026-10-17 (W-92, DI-W92-7/8/10): the one "when did this happen" vocabulary — a pure leaf that imports nothing (no DOM, no storage, no timer).
  const ALLOWED = ['./storage.js', './auth.js', './competition.js', './home-sports.js', './feed-cards.js', './feed-time.js', './feed-caption-lines.js', './reminder-rules.js', './notify-copy.js', './scoring.js', './stats.js', './data-model.js', './icons.js', './week-lock.js', './haptics.js', './section-drag.js', './game-order.js', './game-state.js', './card-detail.js', './nav-gestures.js', './gameday.js', './gameday-sheet.js', './gameday-dom.js', './game-view.js', './pick-groups.js', './next-up.js', './chat-share.js', './sport-status.js'];   // + D1 Lane B Game Day (2026-10-08): the card's model + collapsed markup, its open body, its DOM half, the Game view's markup, the By person / By team renderer and next-up (DI-599) — all leaves; none imports a pick reader (loadtest's DI-540 scan asserts it)
  assert(imps.every(i => ALLOWED.includes(i.from)), `1-1: home.js imports ONLY ${ALLOWED.length} known modules (got ${imps.map(i => i.from).join(', ')})`);
  const compNames = from('./competition.js').flatMap(i => i.names.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean)).sort();
  assert(JSON.stringify(compNames) === JSON.stringify(['homeFeedContexts', 'playersForWeek']) && from('./home-sports.js').length === 1 && JSON.stringify(from('./home-sports.js')[0].names.replace(/[{}]/g, '').split(',').map(x => x.trim()).filter(Boolean).sort()) === JSON.stringify(['cleanJoinOffers', 'deriveFeedCards', 'placeJoinNudges']) && from('./sport-status.js').length === 1 && /^\s*\{?\s*joinClosedCaption\s*\}?\s*$/.test(from('./sport-status.js')[0].names),
    `1-1b: D1 DI-528 - competition.js is imported for exactly homeFeedContexts + playersForWeek (got ${compNames.join(', ')}), home-sports.js for deriveFeedCards + (DESIGN_D1_E) cleanJoinOffers + placeJoinNudges alone, and sport-status.js for joinClosedCaption alone`);
  assert(!imps.some(i => /chat\.js|chatTransport|supabase-backend|app\.js|backend\.js/.test(i.from)), '1-2: S-C8 — no import of chat.js / chatTransport / the adapter / app.js (the chat primitives are INJECTED)');
  const storageNames = from('./storage.js').flatMap(i => i.names.replace(/[{}]/g, '').split(',').map(s => s.trim()).filter(Boolean));
  const WRITERS = /^(save|set|add|delete|toggle|upsert|record|clear|send|post|mark|reset|update|create)\w*/;
  assert(storageNames.length >= 8 && storageNames.every(n => /^(arePicksPublic|hasPlayerSubmitted|get[A-Z]\w*)$/.test(n)), `1-3: S-C8 — the storage import is READS ONLY: ${storageNames.join(', ')}`);
  assert(!names.some(n => WRITERS.test(n) && !/^(createHome|setNews)/.test(n)) || names.filter(n => WRITERS.test(n)).length === 0, `1-4: S-C8 — no imported name looks like a writer (save / set* / send* / add* / delete*): ${names.filter(n => WRITERS.test(n)).join(', ') || 'none'}`);
  assert(!/\b(save|sendEvent|sendChatEvent|sendMessage|setItem|localStorage|saveWeek|saveGame)\s*\(/.test(HOME_CODE) && !/localStorage/.test(HOME_CODE), '1-5: S-C8 — no write call and no localStorage anywhere in the code (read-and-render only)');
  assert(!/canViewOtherPicks/.test(HOME_CODE), '1-6: S-C1 — home.js never names canViewOtherPicks (the commissioner no-stake bypass must not reach a passively-scrolled feed)');
  assert(!/Math\.random|Date\.now\(\)\s*\+/.test(HOME_CODE) && !/Math\.random/.test(HOME_CODE), '1-7: no Math.random anywhere (the feed is deterministic)');
  assert(!/Object\.hasOwn\b|\.at\(|\.findLast\(|\.findLastIndex\(|structuredClone|replaceChildren|:has\(/.test(HOME_CODE), '1-8: iOS 15.0 — no Object.hasOwn / .at() / findLast / structuredClone');
  assert(!/(^|[^\w$.])var\s/.test(HOME_CODE) && !/\.then\(/.test(HOME_CODE), '1-9: no var and no .then() chains (CONVENTIONS #2 / #4)');
  const concats = [...HOME_CODE.matchAll(/'<[^'\n]*'\s*\+|\+\s*'<[^'\n]*'|"<[^"\n]*"\s*\+|\+\s*"<[^"\n]*"/g)];
  assert(concats.length === 0, `1-10: S-C6 — markup is never built by string '+' concatenation (found ${concats.length})`);
  const joinSites = [...HOME_CODE.matchAll(/\bjoinHtml\(/g)].length, glyphSites = [...HOME_CODE.matchAll(/\bglyphSpan\(/g)].length;
  assert(/const joinHtml = \(parts\) => parts\.join\(''\);/.test(HOME_CODE) && joinSites >= 8 && glyphSites >= 2, `1-11: the ONLY two places markup is assembled from parts are joinHtml (${joinSites} uses) and glyphSpan (${glyphSites} uses)`);
  const iconCalls = [...HOME_CODE.matchAll(/(?<![\w$.])icon\(/g)].length;
  assert(iconCalls === 1 && /icon\(name\)/.test(HOME_CODE), `1-12: icon() is called in exactly ONE place — glyphSpan (the constant SVG family, never data): ${iconCalls}`);
  const innerWrites = [...HOME_CODE.matchAll(/\.innerHTML\s*=(?!=)/g)].length;
  // AMENDED 2026-10-07 (D1 Lane B, DI-574 / DI-586): the FEED is still written in exactly one place (container.innerHTML in paint()). Two further, NAMED in-place writers exist because a full repaint would
  // blink every logo and break the reader's momentum: syncPill() inserts the new-posts pill, loadMore() appends the next page. Each takes markup built by this file's escaped templates (pillHTML / itemHTML) — no other
  // insertAdjacentHTML, no outerHTML, no document.write.
  const adjacent = [...HOME_CODE.matchAll(/\.insertAdjacentHTML\(/g)].length;
  const fnBody = (name) => { const m = new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n  \\}\\n`).exec(HOME_CODE); return m ? m[0] : ''; };
  assert(innerWrites === 1 && /function paint\(/.test(HOME_CODE) && adjacent === 2 && /insertAdjacentHTML/.test(fnBody('syncPill')) && /insertAdjacentHTML/.test(fnBody('loadMore')) && !/outerHTML|document\.write/.test(HOME_CODE),
    `1-13: one full DOM write (container.innerHTML in paint()) plus exactly two NAMED in-place writers — syncPill() and loadMore() (${innerWrites} innerHTML, ${adjacent} insertAdjacentHTML); no outerHTML / document.write`);
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(HOME_CODE.replace(/&#\d+;/g, '')) && !/\b(rgb|rgba|hsl)\s*\(/.test(HOME_CODE), '1-14: no colour literal in home.js (CONVENTIONS #13)');
  const emoji = HOME_CODE.match(/\p{Extended_Pictographic}/gu) || [];
  assert(emoji.length === 0, `1-15: no emoji in chrome text (the ▲ / ▽ trend glyphs are geometric shapes, not emoji): ${emoji.join('') || 'none'}`);
  assert(!/escHtml\s*\|\|\s*String|typeof escHtml === 'function' \?|\?\s*escHtml\s*:\s*String/.test(HOME_CODE) && /requireEscHtml\(d\.escHtml, 'createHome'\)/.test(HOME_CODE), '1-16: S-C6 — escHtml is REQUIRED (requireEscHtml), never an optional fallback');
  assert(/escHtml: plainText/.test(HOME_CODE) && (HOME_CODE.match(/cardCopy\(/g) || []).length === 1, '1-17: cardCopy is asked for PLAIN text exactly once (the one call), and the sink escapes it');
  assert(!/recap\.js|renderSeasonSummaryHTML|renderPicksFooterHTML|renderWeekRecapCardHTML/.test(HOME_CODE) && !imps.some(i => /recap/.test(i.from)) && /BETWEEN SEASONS \(coordinator ruling/.test(HOME_SRC),
    '1-17b: SD-6 / D-1 — home.js never imports or names recap.js\'s season summary (its ledger line and emoji chrome stay off Home); the header documents that between seasons is the Now card, the cards that exist, then the end marker');
  // B1 — every attribute is DOUBLE-quoted: the app's escHtml() does not escape the apostrophe, so one single-quoted attribute fed an escaped value is an injection.
  // The same two-part rule xsstest [13a] applies to app.js / chat-ui.js / admin-panel.js now covers js/home.js, plus the joinHtml array elements the sweep cannot see.
  {
    const SINGLE_QUOTED_TEMPLATE_ATTR = /=\s*'[^'\n]*\$\{(?:numHtml|escHtml|esc)\(/;
    const quoteViolations = (src) => {
      const code = stripComments(src);
      const bad = [];
      if (SINGLE_QUOTED_TEMPLATE_ATTR.test(code)) bad.push('a template attribute is single-quoted around an escaped value');
      if (/[\w-]=\\?'/.test(code)) bad.push('an attribute delimiter is a single quote (name=\' or name=\\\')');
      for (const mm of code.matchAll(/joinHtml\(\[/g)) {
        let i = mm.index + mm[0].length - 1, depth = 0, j = i;
        for (; j < code.length; j++) {
          const ch = code[j];
          if (ch === "'" || ch === '"' || ch === '`') { const q = ch; for (j++; j < code.length && code[j] !== q; j++) if (code[j] === '\\') j++; continue; }
          if (ch === '[') depth++; else if (ch === ']' && --depth === 0) break;
        }
        for (const t of code.slice(i, j + 1).matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) {
          const lit = t[1] !== undefined ? t[1] : t[2];
          if (/=\\?'$/.test(lit)) bad.push(`a joinHtml element ends with =' : ${lit.slice(-30)}`);
        }
      }
      return bad;
    };
    assert(quoteViolations(HOME_SRC).length === 0, `1-27: B1 — every attribute in home.js is double-quoted: no template attribute single-quotes an escaped value, no name=' delimiter anywhere, no joinHtml array element ends with =' (${quoteViolations(HOME_SRC).join('; ') || 'none'})`);
    const mut1 = HOME_SRC.replace('data-nudge-category="${escHtml(n.category)}"', "data-nudge-category='${escHtml(n.category)}'");
    const mut2 = HOME_SRC.replace(`'" data-card-key="'`, `"' data-card-key='"`);
    assert(mut1 !== HOME_SRC && quoteViolations(mut1).length > 0, `1-28: B1 teeth — data-nudge-category single-quoted in a scratch copy of the source goes RED (${quoteViolations(mut1)[0] || 'NOT CAUGHT'})`);
    assert(mut2 !== HOME_SRC && quoteViolations(mut2).some(v => /joinHtml element/.test(v) || /delimiter/.test(v)), `1-29: B1 teeth — a joinHtml element ending in =' in a scratch copy goes RED (${quoteViolations(mut2).join('; ') || 'NOT CAUGHT'})`);
  }
  // Merge conditions (reviewer BLOCK, 2026-10-01): no league-banner path in Home; the nudge button's attribute; the header's concrete reasons and the 28-day ruling.
  assert(!/refreshLeague|showLeagueError|showBackendErrorBanner|showSyncFailureBanner|bindPullToRefresh|runManualSync/.test(HOME_CODE), '1-30: DI-368 — Home has NO league-sync dependency and NO banner path in its code (it cannot raise the league banner for a news failure; the league leg is runManualSync\'s, upstream)');
  assert(/PULL-TO-REFRESH: HOME DOES NOT BIND IT/.test(HOME_SRC) && /makeRunManualSync/.test(HOME_SRC) && /homeView\.refresh\(\)/.test(HOME_SRC) && /onFail/.test(HOME_SRC) && /showSyncFailureBanner/.test(HOME_SRC), '1-31: the header documents the wiring: Home does not bind pull-to-refresh; makeRunManualSync gains the home branch; a league failure is runManualSync throwing into onFail -> showSyncFailureBanner; refresh() is the forced news leg plus a repaint');
  assert(!/data-comm-tab/.test(HOME_CODE) && /data-comm-target/.test(HOME_CODE), '1-32: the nudge button carries data-comm-target (never RG-10\'s card-tagging attribute data-comm-tab)');
  assert(/recap\.js:189/.test(HOME_SRC) && /WRONG season/.test(HOME_SRC) && /per-player amounts/.test(HOME_SRC) && /not a `\.feed-card` shell/.test(HOME_SRC) && !/obligations and wagers never on Home|obligations never on Home/i.test(HOME_SRC), '1-33: the header gives the CONCRETE reasons for dropping the season-summary filler (wrong season, per-player ledger amounts, not a .feed-card shell) and does not claim "obligations never on Home"');
  assert(/28 days/.test(HOME_SRC) && /mid-December/.test(HOME_SRC) && /coordinator/.test(HOME_SRC) && home.BETWEEN_SEASONS_AFTER_MS === 28 * 24 * 60 * 60 * 1000, '1-34: between seasons is 28 days, recorded in the header as the coordinator\'s ruling (a 14-day gap happens mid-December)');
  assert(!/home-loading/.test(HOME_CODE) && /if \(busy\) parts\.push\('<p class="sr-only" role="status">Loading Home<\/p>'\);/.test(HOME_CODE), '1-35: the loading status is emitted by wrapItems OUTSIDE every .feed-item (not as a keyed item in the flex column)');
  assert(!/captionTextUnsafeForTests|captionTextFor/.test(HOME_SRC), '1-18: C4 — home.js never names the unescaped caption helper (captionFor, which escapes, is the only entry)');
  assert(/isContentWithheld: d\.isContentWithheld/.test(HOME_CODE), '1-19: S-C7 — deriveCards is ALWAYS handed isContentWithheld (its belt behind home.js\'s own check)');
  assert((HOME_CODE.match(/buildRevealedView\(/g) || []).length === 1, '1-20: S-C2 — the revealed view is built exactly ONCE in the file (never per consumer)');
  // 1-21 (AMENDED 2026-10-07, D1 batch H / PM-110 acceptance 3): "never touching" the scroll position did NOT preserve the reader's place — a repaint that inserts a
  // card above the reader pushes what they are reading down the screen. The rule is now: the ONLY scroll call is keepReaderInPlace()'s one instant compensation
  // (equal to the height that changed above the reader); nothing else scrolls, jumps to, or reads/writes scrollTop.
  {
    // One predicate, so the teeth checks below test exactly what 1-21 asserts. Since review note 4 the one scroll call is the house helper, section-drag.js's
    // scrollWindow() (instant first, the numeric form on iOS 15.0): exactly ONE call, inside keepReaderInPlace(), and NO direct scroll API anywhere in the file.
    // AMENDED 2026-10-07 (D1 Lane B, DI-574): exactly TWO scrollWindow calls — the anchor compensation in keepReaderInPlace() and the new-posts pill's scroll-up in scrollFeedToTop() (the same relative call, smooth).
    // AMENDED 2026-10-08 (D1 Lane B Game Day, DI-605/610): exactly THREE scrollWindow calls — those two plus scrollPageBy(), the ONE helper every Game Day / Related move goes through (a tapped pill's row brought above the
    // tab bar, a collapsed card's header brought back, "See all on Home" centring its card, the belt that restores the page if a card change shifted it): user-initiated, minimal, pausing the tab bar's hide-on-scroll.
    const scrollRule = (code) => {
      const keep = /function keepReaderInPlace\([\s\S]*?\n\}\n/.exec(code), top = /function scrollFeedToTop\([\s\S]*?\n\}\n/.exec(code), by = /function scrollPageBy\([\s\S]*?\n\}\n/.exec(code);
      const all = (code.match(/\bscrollWindow\(/g) || []).length;
      const inside = [keep, top, by].reduce((n, f) => n + (f ? (f[0].match(/\bscrollWindow\(/g) || []).length : 0), 0);
      return { ok: !!keep && !!top && !!by && all === 3 && inside === 3 && !/\bscrollBy\(|scrollTo\b|scrollTop|scrollIntoView|scrollX\b|\.scroll\(/.test(code), all };
    };
    const r21 = scrollRule(HOME_CODE);
    assert(r21.ok && /import \{ scrollWindow \} from '\.\/section-drag\.js';/.test(HOME_CODE),
      `1-21: Home never MOVES the reader except by the house helper: the only scroll calls (${r21.all}) are section-drag.js's scrollWindow() inside keepReaderInPlace() (the anchor compensation), scrollFeedToTop() (the pill's tap) and scrollPageBy() (Game Day's user-initiated moves) — no scrollBy / scrollTo / scrollTop / scrollIntoView / bare .scroll( anywhere`);
    // Teeth (reviewer mutant L, D1 batch H review): a bare window.scroll(…) added to paint() — the one scroll API the first version of the pattern did not name — must turn the rule RED.
    const anchorLine = '    keepReaderInPlace(el, anchor);';
    const mutL = HOME_CODE.replace(anchorLine, `${anchorLine}\n    window.scroll(0, 0);`);
    assert(mutL !== HOME_CODE && scrollRule(mutL).ok === false, '1-21b: teeth — mutant L (a bare window.scroll(0, 0) added to paint() in a scratch copy of the source) turns the 1-21 rule RED');
    const mutBy = HOME_CODE.replace(anchorLine, `${anchorLine}\n    window.scrollBy(0, 1);`);
    const mutTwice = HOME_CODE.replace(anchorLine, `${anchorLine}\n    scrollWindow(window, { top: 1 });`);
    assert(scrollRule(mutBy).ok === false && scrollRule(mutTwice).ok === false, '1-21c: teeth — a direct scrollBy(…), or a fourth scrollWindow(…) outside the three named functions, in a scratch copy also turns the rule RED');
  }
  assert(!/setInterval|setTimeout|requestAnimationFrame/.test(HOME_CODE), '1-22: no timers in the renderer (nothing animates in JS — motion is CSS)');
  assert(fcMod.CARD_TYPES.every(t => t in home.CARD_ICON) && Object.values(home.CARD_ICON).every(n => typeof n === 'string'), '1-23: every card type has an eyebrow glyph');
  const icons = await import('./js/icons.js');
  assert(Object.values(home.CARD_ICON).every(n => n in icons.ICONS), '1-24: every eyebrow glyph is an entry in js/icons.js (the ONE icon family — DI-367)');
  assert(JSON.stringify(Object.keys(home).filter(k => /^(HOME_|FEED_|NEWS_|SKELETON|SCRIBE|BETWEEN|NOW_|ACTION_|ERROR_|BODY_|CARD_)/.test(k)).sort()).length > 100, '1-25: the named constants are exported (every number the screen hangs on)');
  const xss = await read('./xsstest.mjs');
  assert(/'js\/home\.js'\]/.test(xss) && /'js\/stats-core\.js', 'js\/stats\.js', 'js\/feed-cards\.js', 'js\/feed-caption-lines\.js', 'js\/home\.js'\]/.test(xss), '1-26: S-C6 — js/home.js is in xsstest.mjs\'s SWEPT list and its zero-backlog loop (xsstest itself proves the zero)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Dependencies — every required one throws when it is missing (the gate is never defaulted)…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const DEP_RES = depChecks(home);
for (const [label, ok] of Object.entries(DEP_RES)) assert(ok === true, `2: ${label}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] The Now card — the state machine, one row of DI-364 at a time…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const NOW_RES = await nowChecks(home);
for (const [label, ok] of Object.entries(NOW_RES)) assert(ok === true, `3: ${label}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] The snapshot — S-C2 revealed view, S-C10 flags, counts-only submissions, S-C11 stamping…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const SNAP_RES = await snapChecks(home);
for (const [label, ok] of Object.entries(SNAP_RES)) assert(ok === true, `4: ${label}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] The chat-candidate source — private / deleted / wager rows, the SCRIBE week gate (security C2), league binding…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const CHAT_RES = await chatChecks(home);
for (const [label, ok] of Object.entries(CHAT_RES)) assert(ok === true, `5: ${label}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// More named check groups (defined here, run in their own sections below and again against every mutant).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** [6] mergeFeed — pure ordering, so it is proven without markup. */
function mergeChecks(mod) {
  const out = {};
  const wk = (id, n) => fx.mkWeek({ id, n, status: 'final' });
  const weeks = [wk('w1', 1), wk('w2', 2), wk('w3', 3)];
  const card = (id, weekId, sortKey, type = 'week.result') => ({ id, type, weekId, sortKey });
  const kinds = (arr) => arr.map(e => e.kind);
  const keys = (arr, kind = 'card') => arr.filter(e => e.kind === kind).map(e => e.key);
  const cs = [card('a', 'w1', '2026-09-05T00:00:00Z'), card('b', 'w2', '2026-09-12T00:00:00Z'), card('c', 'w2', '2026-09-13T00:00:00Z'), card('d', 'w3', '2026-09-14T00:00:00Z'), card('e', null, '2026-09-13T06:00:00Z', 'scribe.post')];
  const nudge = { key: 'nudge:LIVE_NOT_FINALIZED:w3', category: 'LIVE_NOT_FINALIZED', title: 't', body: 'b', commTab: 'week' };
  const m1 = mod.mergeFeed({ now: NOW, cards: cs, weeks, nudge });
  out['M1 the Now card is pinned FIRST and the nudge SECOND; the end marker is LAST'] = kinds(m1)[0] === 'now' && kinds(m1)[1] === 'nudge' && kinds(m1)[kinds(m1).length - 1] === 'caught-up';
  out['M1b the Now card is first even with nothing else; no nudge unless supplied'] = (() => { const m = mod.mergeFeed({ now: NOW }); return JSON.stringify(kinds(m)) === '["now","caught-up"]'; })();
  // FB-010 (D1 batch H, Drew 2026-10-06: "Feed should always be new cards on top, so if a game ends and you provide an update that should be on top"). The ordinary
  // feed is ONE newest-first chronology by each card's own event time: never grouped by week, and a week-less card (SCRIBE, the Locker Room) is placed by its OWN time.
  out['M2 FB-010: the ordinary feed is newest-first by the card\'s own event time across EVERY week — not grouped by week'] = JSON.stringify(keys(m1)) === JSON.stringify(['d', 'e', 'c', 'b', 'a']);
  {
    const cs2 = [card('old-scribe', null, '2026-09-01T00:00:00Z', 'scribe.post'), card('w3-result', 'w3', '2026-09-14T00:00:00Z'), card('w2-final', 'w2', '2026-09-15T00:00:00Z', 'game.final'), card('w1-result', 'w1', '2026-09-05T00:00:00Z')];
    out['M2b FB-010: an OLDER week\'s newer card (a game that ended later) sits above the newest week\'s older card, and a week-old SCRIBE post is NOT lifted into the newest week\'s group'] =
      JSON.stringify(keys(mod.mergeFeed({ now: NOW, cards: cs2, weeks }))) === '["w2-final","w3-result","w1-result","old-scribe"]';
    // Drew's report, reproduced: next week (w4) is already open, so the OLD merge ranked it newest and lifted its older slate card plus every week-less SCRIBE post above
    // the game that just ended in the live week (w3) — "interjected like 5 cards down".
    const weeks4 = [...weeks, fx.mkWeek({ id: 'w4', n: 4, status: 'open' })];
    const justEnded = card('final-now', 'w3', iso(NOW - MIN), 'game.final');
    const older = [card('w4-slate', 'w4', iso(NOW - 12 * HOUR), 'slate.published'), ...Array.from({ length: 4 }, (_, i) => card('scribe' + i, null, iso(NOW - (i + 1) * DAY), 'scribe.post')), card('w3-revealed', 'w3', iso(NOW - 5 * HOUR), 'week.revealed')];
    // seven ordinary cards -> ONE news slot (1 per 4): relevance picks nx, its publish time places it
    const mm = mod.mergeFeed({ now: NOW, cards: [...older, justEnded], weeks: weeks4, news: { status: 'ready', items: [{ id: 'nx', publishedAt: iso(NOW - 30 * MIN) }, { id: 'ny', publishedAt: iso(NOW - 3 * HOUR) }] } });
    const ordinary = mm.filter(e => e.kind === 'card' || e.kind === 'news').map(e => e.key);
    out['M2c FB-010 acceptance 1: a game that just ended is FIRST in the ordinary feed (directly under the pinned cards) — not fifth below next week\'s older slate card and week-old SCRIBE posts'] =
      ordinary[0] === 'final-now' && mm[0].kind === 'now' && JSON.stringify(ordinary) === '["final-now","news:nx","w3-revealed","w4-slate","scribe0","scribe1","scribe2","scribe3"]';
  }
  out['M3 a sortKey tie breaks on id (deterministic)'] = JSON.stringify(keys(mod.mergeFeed({ cards: [card('z', 'w2', 'S'), card('y', 'w2', 'S'), card('x', 'w2', 'S')], weeks }))) === '["x","y","z"]';
  out['M3b a card and a news item at the SAME instant: the card first, then the news (a stable tie-break, never input order)'] = (() => {
    const t = iso(NOW - HOUR);
    const a = mod.mergeFeed({ now: NOW, cards: [card('c1', 'w3', t)], weeks, news: { status: 'ready', items: [{ id: 'n1', publishedAt: t }] } }).filter(e => e.kind === 'card' || e.kind === 'news').map(e => e.key);
    return JSON.stringify(a) === '["c1","news:n1"]';
  })();
  let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const baseline = JSON.stringify(m1.map(e => e.key));
  let same = true;
  for (let i = 0; i < 10; i++) { const sh = cs.slice().sort(() => rnd() - 0.5); if (JSON.stringify(mod.mergeFeed({ now: NOW, cards: sh, weeks: weeks.slice().reverse(), nudge }).map(e => e.key)) !== baseline) same = false; }
  out['M4 DETERMINISTIC: ten shuffles of the cards and of the weeks give the byte-identical order'] = same;
  // news density
  const nonNews = (n, w = 'w3') => Array.from({ length: n }, (_, i) => card('c' + String(i).padStart(2, '0'), w, `2026-09-14T00:${String(59 - i).padStart(2, '0')}:00Z`));
  const news = (n, o = {}) => ({ status: 'ready', items: Array.from({ length: n }, (_, i) => ({ id: 'n' + (i + 1), publishedAt: iso(NOW - (i + 1) * HOUR), ...o })) });
  const shape = (m) => m.filter(e => e.kind === 'card' || e.kind === 'news').map(e => (e.kind === 'news' ? 'N' : 'c')).join('');
  // FB-010: news joins the ONE chronology at its publish time ("new posts like game updates and other insights are being interjected like 5 cards down" was news slotted
  // by POSITION, one after every fourth card). UX-2's density rule survives as a SELECTION rule — how many news cards (1 per 4 ordinary cards, filling a thin feed,
  // cap 8), chosen in UX-2's relevance order — and the publish time alone decides where each one sits.
  const timed = (n) => Array.from({ length: n }, (_, i) => card('c' + String(i).padStart(2, '0'), 'w3', iso(NOW - (2 * i + 1) * 30 * MIN)));   // c00 -30m, c01 -90m, c02 -150m …
  const nN = (m) => (shape(m).match(/N/g) || []).length;
  out['M5 FB-010: news is placed by its PUBLISH TIME among the cards, newest first (c -30m, N -1h, c -90m, N -2h, then the older cards) — never one-after-every-fourth by position'] =
    shape(mod.mergeFeed({ now: NOW, cards: timed(9), weeks, news: news(8) })) === 'cNcNccccccc';
  out['M5 density (selection): nine cards, plenty of news -> TWO news cards (1 per 4 ordinary cards)'] = nN(mod.mergeFeed({ now: NOW, cards: nonNews(9), weeks, news: news(8) })) === 2;
  out['M5b the midweek exception: fewer than four cards -> news FILLS the feed, up to the cap of 8'] = nN(mod.mergeFeed({ now: NOW, cards: nonNews(3), weeks, news: news(12) })) === 8 && shape(mod.mergeFeed({ now: NOW, cards: nonNews(3), weeks, news: news(12) })).replace(/N/g, '') === 'ccc';
  out['M5c exactly four cards -> exactly one news card (the 1-in-4 ratio resumes)'] = nN(mod.mergeFeed({ now: NOW, cards: nonNews(4), weeks, news: news(5) })) === 1;
  out['M5d no cards at all -> the feed is the news (still capped at 8), newest first'] = shape(mod.mergeFeed({ now: NOW, cards: [], weeks: [], news: news(10) })) === 'N'.repeat(8)
    && JSON.stringify(keys(mod.mergeFeed({ now: NOW, cards: [], weeks: [], news: news(10) }), 'news')) === JSON.stringify(Array.from({ length: 8 }, (_, i) => 'news:n' + (i + 1)));
  out['M5e the cap of 8 holds in a long feed too (40 cards, 12 news -> 8 news)'] = nN(mod.mergeFeed({ now: NOW, cards: nonNews(40), weeks, news: news(12) })) === 8;
  {
    const ranked = { status: 'ready', items: [{ id: 'n1', publishedAt: iso(NOW - 5 * HOUR) }, { id: 'n2', publishedAt: iso(NOW - HOUR) }, { id: 'n3', publishedAt: iso(NOW - 10 * MIN) }] };
    out['M5f relevance SELECTS, time PLACES: three items into two slots takes UX-2\'s first two (n1, n2 — not the newer n3), and the newer of the two sits higher'] =
      JSON.stringify(keys(mod.mergeFeed({ now: NOW, cards: timed(9), weeks, news: ranked }), 'news')) === '["news:n2","news:n1"]';
  }
  // freshness (the boundary), future-dated, junk, duplicates
  const fresh = (ms) => keys(mod.mergeFeed({ now: NOW, cards: [], weeks: [], news: { status: 'ready', items: [{ id: 'x', publishedAt: iso(NOW - ms) }] } }), 'news').length === 1;
  out['M6 48-hour freshness: 47h59m is in, exactly 48h is in, 48h01m is OUT'] = fresh(48 * HOUR - MIN) && fresh(48 * HOUR) && !fresh(48 * HOUR + MIN);
  out['M6b an item dated more than 5 minutes in the future, an unparseable date, and an item with no id are dropped; 4 minutes ahead is tolerated'] = fresh(-4 * MIN) && !fresh(-6 * MIN)
    && mod.eligibleNews([{ id: 'a', publishedAt: 'not a date' }, { id: '', publishedAt: iso(NOW) }, { publishedAt: iso(NOW) }, null, 7], NOW).length === 0;
  out['M6c duplicate ids collapse to the first'] = mod.eligibleNews([{ id: 'a', publishedAt: iso(NOW - HOUR), headline: 'first' }, { id: 'a', publishedAt: iso(NOW - HOUR), headline: 'second' }], NOW).length === 1
    && mod.eligibleNews([{ id: 'a', publishedAt: iso(NOW - HOUR), headline: 'first' }, { id: 'a', publishedAt: iso(NOW - HOUR), headline: 'second' }], NOW)[0].headline === 'first';
  out['M7 news renders ANY time: no weeks, no slate, no cards — still there (UX-2 N2)'] = keys(mod.mergeFeed({ now: NOW, cards: [], weeks: [], news: news(2) }), 'news').length === 2;
  // news slot states
  const st = (status, extra = {}) => kinds(mod.mergeFeed({ now: NOW, cards: nonNews(2), weeks, news: { status, items: [], ...extra } }));
  out['M8 loading -> two skeleton cards where news would be; error -> one calm error; ready-with-nothing-eligible / empty -> one calm empty line'] =
    JSON.stringify(st('loading')) === '["now","card","card","news-skeleton","news-skeleton","caught-up"]' && JSON.stringify(st('error')) === '["now","card","card","news-error","caught-up"]'
    && JSON.stringify(st('empty')) === '["now","card","card","news-empty","caught-up"]'
    && JSON.stringify(kinds(mod.mergeFeed({ now: NOW, cards: nonNews(2), weeks, news: { status: 'ready', items: [{ id: 'old', publishedAt: iso(NOW - 3 * DAY) }] } }))) === '["now","card","card","news-empty","caught-up"]';
  out['M8b off / idle / absent -> the slot does not exist (no message, no ghost card)'] = ['off', 'idle', undefined, 'bogus'].every(s => !st(s).some(k => k.startsWith('news'))) && !kinds(mod.mergeFeed({ now: NOW, cards: nonNews(2), weeks, news: null })).some(k => k.startsWith('news'));
  out['M9 the card list is capped (newest first): 260 cards -> FEED_CARD_CAP (200, DI-586), and the end marker says there was more'] = (() => { const big = (n) => Array.from({ length: n }, (_, i) => card('c' + String(i).padStart(3, '0'), 'w3', new Date(Date.parse('2026-09-14T00:59:00Z') - i * 60000).toISOString())); const m = mod.mergeFeed({ now: NOW, cards: big(260), weeks }); const ks = keys(m); return ks.length === home.FEED_CARD_CAP && ks[0] === 'c000' && ks[ks.length - 1] === 'c' + String(home.FEED_CARD_CAP - 1).padStart(3, '0') && m[m.length - 1].variant === 'capped' && mod.mergeFeed({ now: NOW, cards: nonNews(60), weeks }).slice(-1)[0].variant === 'caught-up'; })();
  out['M9b DI-586: a second occurrence of a key is dropped (the guard behind "no duplicates, no gaps"), and every card keeps its event time as `t` (DI-587 reads it)'] = (() => { const cs = nonNews(5); const m = mod.mergeFeed({ now: NOW, cards: [...cs, cs[2], cs[0]], weeks }); const k = keys(m); return k.length === 5 && new Set(k).size === 5 && m.filter(e => e.kind === 'card').every(e => typeof e.t === 'string' && e.t.length > 0); })();
  out['M10 a failed derivation puts ONE calm error entry where the cards would be (never a blank feed) and NO end marker ("You\'re all caught up." is false after an error)'] = JSON.stringify(kinds(mod.mergeFeed({ now: NOW, cards: nonNews(5), weeks, feedError: true }))) === '["now","error"]';
  out['M11 a brand-new league\'s end marker is its own variant'] = mod.mergeFeed({ now: NOW, emptyLeague: true }).slice(-1)[0].variant === 'new-league' && mod.mergeFeed({ now: NOW }).slice(-1)[0].variant === 'caught-up';
  out['M12 the constants are the DI\'s: 1 per 4, cap 8, 48 h, 15 min TTL, pages of 20, cap 200'] = home.NEWS_PER_NON_NEWS === 4 && home.NEWS_MAX_CARDS === 8 && home.NEWS_FRESHNESS_MS === 48 * HOUR && home.NEWS_STALE_MS === 15 * MIN && home.FEED_PAGE_SIZE === 20 && home.FEED_CARD_CAP === 200 && home.FEED_CARD_LIMIT === undefined;
  return out;
}

const HOSTILE_NAME = (s) => `ZZ${s}<b onmouseover="x()">"&'`;
/** The hostile league needs picks whose selectedTeam matches the RENAMED team, so it is rebuilt by name mapping. */
function hostileLeagueMapped(w2 = 'final') {
  const L = fx.buildLeague({ w2, calculateWeeklyResults });
  const rename = new Map();
  L.games.forEach(g => { rename.set(g.homeTeam, HOSTILE_NAME(g.homeTeam)); rename.set(g.awayTeam, HOSTILE_NAME(g.awayTeam)); });
  L.games.forEach(g => { g.homeTeam = rename.get(g.homeTeam); g.awayTeam = rename.get(g.awayTeam); g.atsWinner = null; });
  L.picks.forEach(p => { p.selectedTeam = rename.get(p.selectedTeam) || p.selectedTeam; });
  L.weeklyResults = [];
  L.weeklyResults.push(...calculateWeeklyResults('w1', L.players, L.picks, L.games.filter(g => g.weekId === 'w1')));
  if (w2 === 'final') L.weeklyResults.push(...calculateWeeklyResults('w2', L.players, L.picks, L.games.filter(g => g.weekId === 'w2')));
  L.players.forEach(p => { p.displayName = HOSTILE_NAME(p.displayName); p.initials = 'Q<Z'; });
  return L;
}

/** The news slot's calm cards, rendered through a real instance: a news fetch that fails ('error') or resolves with nothing ('empty'). */
async function newsSlotHtml(mod, kind) {
  const w = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] });
  const e = mkEnv(mod, w, { read: { currentWeek: () => w.weeks[0] }, deps: { fetchNews: () => (kind === 'error' ? Promise.reject(new Error('x')) : Promise.resolve([])), renderNewsCard: () => '' } });
  e.home.renderHome();
  await flush();
  return e.container.innerHTML;
}

/** [7] Painting: withheld, belts, errors, no-op repaint, entrance, skeleton, escaping. */
async function paintChecks(mod) {
  const out = {};
  const FINAL = () => fx.buildLeague({ w2: 'final', calculateWeeklyResults });
  const finalEnv = (o = {}) => { const L = FINAL(); return mkEnv(mod, L, { read: { currentWeek: () => L.weeks[1] }, ...o }); };
  // — S-C7: nothing is read and nothing is painted while the content is withheld
  {
    let reads = 0;
    const L = FINAL();
    const e = mkEnv(mod, L, { read: { weeks: () => { reads++; return L.weeks; }, currentWeek: () => L.weeks[1] } });
    e.state.withheld = true;
    const r = e.home.renderHome();
    out['P1 S-C7: withheld -> renderHome() paints NOTHING (no write, empty container) and reads NOTHING (checked before any read)'] = r === false && e.container.writes === 0 && e.container.innerHTML === '' && reads === 0 && e.calls.withheldAsked >= 1;
    e.state.withheld = false;
    out['P1b …and the same instance paints normally the moment the gate clears (positive control)'] = e.home.renderHome() === true && e.container.innerHTML.includes('data-card-key="now"') && e.container.writes === 1;
  }
  // — B2: S-C7 FAILS CLOSED — anything but an explicit `false` (undefined, a string, a throw) is "withheld"
  {
    const variants = [['returns undefined', () => undefined], ["returns 'yes'", () => 'yes'], ['returns null', () => null], ['returns 0', () => 0], ['THROWS', () => { throw new Error('gate down'); }]];
    const results = variants.map(([label, fn]) => {
      const e = finalEnv({ withheldFn: fn });
      const r = e.home.renderHome();
      const sk = mkEnv(mod, FINAL(), { withheldFn: fn, deps: { isDataReady: () => false } });
      const r2 = sk.home.renderHome();
      return { label, ok: r === false && e.container.writes === 0 && e.container.innerHTML === '' && r2 === false && sk.container.writes === 0 };
    });
    out['P10 B2 S-C7 fail-closed: isContentWithheld returning undefined / \'yes\' / null / 0, or THROWING -> renderHome() is false with ZERO DOM writes (content AND skeleton paths)'] = results.every(x => x.ok);
    const e0 = finalEnv({ withheldFn: () => false });
    out['P10b …POSITIVE CONTROL: an explicit false paints'] = e0.home.renderHome() === true && e0.container.writes === 1;
  }
  {
    const e = finalEnv({ withheldFn: (n) => n === 3 });       // call 1 = entry, 2 = deriveCards' belt, 3 = the belt right before the write
    const r = e.home.renderHome();
    out['P2 S-C7 belt: the gate flips to withheld AFTER the build -> the DOM is never written'] = r === false && e.container.writes === 0 && e.calls.withheldAsked === 3;
  }
  {
    const e = finalEnv({ withheldFn: (n) => n === 2 });       // only deriveCards' own belt sees "withheld"
    e.home.renderHome();
    const html = e.container.innerHTML;
    out['P3 deriveCards is ALWAYS handed the gate: when ITS check says withheld it derives NO cards (the Now card and the end marker still paint)'] =
      e.calls.withheldAsked === 3 && cardTypes(html).length === 0 && html.includes('data-card-key="now"') && html.includes('feed-caught-up');
  }
  // — errors are calm and local: never a blank feed
  {
    const L = FINAL();
    const bomb = { id: 'bomb', leagueId: 'L1', author: 'scribe', body: 'x', get ts() { throw new Error('secret technical boom'); } };
    const e = mkEnv(mod, L, { read: { currentWeek: () => L.weeks[1] }, chat: { scribe: [bomb], lockerRoom: [] } });
    const r = await nonThrowing(() => e.home.renderHome());
    const html = e.container.innerHTML;
    out['P4 deriveCards THROWS -> a calm error card (title, next action, Retry), the Now card still there, NO technical text, never blank'] =
      r === true && html.includes('data-card-type="home-error"') && html.includes("Home couldn&#39;t") === false && html.includes('Home couldn\'t load this feed.') && html.includes('Pull down to try again.')
      && html.includes('data-home-action="retry-load"') && html.includes('data-card-key="now"') && !/boom|secret|Error/.test(html) && !html.includes('feed-caught-up') && !html.includes("all caught up");
    const L2 = FINAL();
    const e2 = mkEnv(mod, L2, { read: { weeks: () => { throw new Error('storage seam broken'); } } });
    const r2 = await nonThrowing(() => e2.home.renderHome());
    out['P5 the snapshot cannot be assembled at all -> still an error card with Retry, not a blank page and not a throw'] = r2 === true && e2.container.innerHTML.includes('home-error') && e2.container.innerHTML.includes('data-home-action="retry-load"') && !/seam|broken/.test(e2.container.innerHTML) && !e2.container.innerHTML.includes('feed-caught-up') && !e2.container.innerHTML.includes('all caught up');
  }
  // — no flash, no churn
  {
    const e = finalEnv();
    e.home.renderHome();
    const w1 = e.container.writes, html1 = e.container.innerHTML;
    const again = e.home.renderHome();
    out['P6 an identical repaint is a NO-OP: no DOM write (no flash, scroll untouched), the same markup'] = again === true && e.container.writes === w1 && e.container.innerHTML === html1;
    e.container._html = '';
    out['P6b …but if something else EMPTIED the container the next paint restores it'] = e.home.renderHome() === true && e.container.innerHTML === html1.replace(/ feed-item--enter/g, '');
  }
  {
    // entrance: a card that was not on screen fades in; everything already there does not
    const w = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] });
    const e = mkEnv(mod, w, { read: { currentWeek: () => w.weeks[0] } });
    e.home.renderHome();
    const first = e.container.innerHTML;
    out['P7 the FIRST content paint does not animate (cached content is instant)'] = !first.includes('feed-item--enter');
    w.weeks[0] = { ...w.weeks[0], status: 'live' };
    e.home.renderHome();
    const after = e.container.innerHTML;
    const enterKeys = [...after.matchAll(/class="feed-item feed-item--enter" data-card-key="([^"]*)"/g)].map(m => m[1]);
    out['P7b a card that was NOT on screen fades in (week.revealed), and ONLY it — the Now card and the slate card, already there, do not re-animate'] =
      enterKeys.length === 1 && enterKeys[0].startsWith('week.revealed:') && !/feed-item feed-item--enter" data-card-key="now"/.test(after) && !/feed-item--enter" data-card-key="slate/.test(after);
  }
  {
    // loading: cached -> skeleton -> content; the skeleton is never a spinner
    const w = world({ status: 'open', lockIn: 30 * HOUR });
    let ready = false;
    const e = mkEnv(mod, w, { read: { currentWeek: () => w.weeks[0] }, deps: { isDataReady: () => ready } });
    e.home.renderHome();
    const sk = e.container.innerHTML;
    out['P8 not hydrated yet: a SKELETON page — four placeholders (the Game Day one first, DI-603, then three cards), aria-busy, a status for VoiceOver, no spinner, no real card, no Now card'] =
      (sk.match(/feed-skel"/g) || []).length === home.SKELETON_CARD_COUNT - 1 && (sk.match(/gd--skeleton/g) || []).length === 1 && sk.includes('aria-busy="true"') && sk.includes('role="status"') && !/spinner|Loading\.\.\.|<img/i.test(sk) && !sk.includes('data-card-type="week') && !sk.includes('data-now-state');
    const w0 = e.container.writes;
    const segs = sk.split('<div class="feed-item').slice(1);
    const beforeFirstItem = sk.slice(0, sk.indexOf('<div class="feed-item'));
    out['P8d NO LAYOUT SHIFT: the sr-only loading status is a direct child of .home-feed OUTSIDE every .feed-item (an absolutely positioned child takes no flex gap) — no zero-height item in the column, every item holds a skeleton card'] =
      segs.length === home.SKELETON_CARD_COUNT && segs.every(x => /<article class="card feed-card feed-skel"/.test(x) || /<section class="gd gd--skeleton"/.test(x)) && /role="status"/.test(beforeFirstItem) && (sk.match(/role="status"/g) || []).length === 1
      && !/class="feed-item[^>]*"[^>]*><\/div>/.test(sk) && !/key="home-loading"/.test(sk);
    e.home.renderHome();
    out['P8b the skeleton repaint is a no-op too'] = e.container.writes === w0;
    ready = true;
    e.home.renderHome();
    const content = e.container.innerHTML;
    const items = (content.match(/class="feed-item/g) || []).length, entering = (content.match(/class="feed-item feed-item--enter"/g) || []).length;
    // (fix round 2: Game Day's own polite live region — always present, always empty in the markup, DI-604 — is not the skeleton's loading status, so it is set aside before the check)
    out['P8c skeleton -> content: the whole first content paint fades in (every item enters), busy cleared, and the status is gone with the skeleton'] = items > 1 && entering === items && content.includes('aria-busy="false"') && !content.includes('feed-skel') && !content.replace(/<p class="sr-only" data-gd-live role="status" aria-live="polite" aria-atomic="true"><\/p>/g, '').includes('role="status"');
  }
  // — escaping at the sink: hostile data never reaches the markup unescaped
  {
    const L = hostileLeagueMapped('final');
    const chat = { scribe: [{ id: 'hs', leagueId: 'L1', ts: NOW - HOUR, author: 'scribe', authorName: 'SCRIBE', body: 'ZZscribe<script>alert(1)</script> & "q"', reactionCount: 0, meta: { kind: null, test: false } }],
      lockerRoom: [{ id: 'hl', leagueId: 'L1', ts: NOW - HOUR, author: 'p3', authorName: 'ZZspoof', body: 'ZZquote<img src=x onerror=alert(1)>', reactionCount: 4, meta: { kind: null, test: false } }] };
    const tagged = mkEnv(mod, L, { read: { currentWeek: () => L.weeks[1] }, escHtml: tagEsc, chat });
    tagged.home.renderHome();
    const th = tagged.container.innerHTML;
    out['P9 ESCAPING AT THE SINK: with a tagging escaper, no player name, team name, initials, SCRIBE body or Locker Room quote appears OUTSIDE an escaper call'] =
      /⟦/.test(th) && !/ZZ/.test(stripTagged(th)) && !stripTagged(th).includes('Q<Z') && (th.match(/⟦/g) || []).length > 30 && /data-card-type="⟦scribe\.post⟧"/.test(th) && /data-card-type="⟦lockerroom\.top⟧"/.test(th);
    const real = mkEnv(mod, L, { read: { currentWeek: () => L.weeks[1] }, chat });
    real.home.renderHome();
    const rh = real.container.innerHTML;
    out['P9b with the real escaper the hostile markup is INERT: no raw <script>, <img>, <b onmouseover>, no raw initials, the entities are there'] =
      !/<script|<img|<b /i.test(rh) && !rh.includes('Q<Z') && rh.includes('ZZ') && rh.includes('&lt;b onmouseover=&quot;x()&quot;&gt;') && rh.includes('&lt;script&gt;');
    const lockerBody = rh.match(/data-card-type="lockerroom\.top"[\s\S]*?<\/article>/);
    out['P9c the Locker Room quote is plain text: truncated THEN escaped, no link, no image (an excerpt on a passive feed never fetches anything)'] = !!lockerBody && !/<(a|img)\b/i.test(lockerBody[0]);
    const strict = home.createHome;
    out['P9d the escaper is REQUIRED at construction (S-C6) — also for the standalone card renderers'] = (() => { try { mod.cardHTML({ id: 'x', type: 'week.result', facts: { weekN: 2, weekWinnerName: 'A', weekWinnerRecord: '4–0' }, reason: 'x' }, {}); return false; } catch (e) { return e instanceof TypeError; } })() && (() => { try { mod.nowCardHTML({ state: 's', headline: 'h' }, {}); return false; } catch (e) { return e instanceof TypeError; } })() && typeof strict === 'function';
  }
  // — Breathing Room on the three text-and-button cards (the reviewer measured 8 pt where 16 pt belongs): label/title/body are ONE 8 pt group, a sibling of the button group
  {
    const kids = (html, typeAttr) => {
      const m = new RegExp(`<article class="card feed-card[^"]*" data-card-type="${typeAttr}"[^>]*>([\\s\\S]*?)</article>`).exec(html);
      return m ? m[1] : null;
    };
    const structure = (inner) => { if (inner === null) return null; const t = /^<div class="feed-card-text">((?:(?!<\/div>)[\s\S])*)<\/div><div class="feed-actions">([\s\S]*)<\/div>$/.exec(inner); return t ? { text: t[1], actions: t[2] } : null; };
    const lw = world({ status: 'live', gameStates: ['final', 'final', 'final'], firstKickIn: -3 * DAY, extra: { pendingFinalization: true, pendingFinalizationSinceMs: NOW - 30 * HOUR } });
    const nud = mkEnv(mod, lw, { admin: true, read: { currentWeek: () => lw.weeks[0] } }); nud.home.renderHome();
    const ns = structure(kids(nud.container.innerHTML, 'comm-nudge'));
    out['P11 BREATHING ROOM: the commissioner nudge is [text group (label + title + body)] then [button group] as siblings — the button group is NOT inside the 8 pt text stack'] =
      !!ns && /feed-nudge-label/.test(ns.text) && /feed-card-title/.test(ns.text) && /feed-card-body/.test(ns.text) && /<button /.test(ns.actions) && !/<button /.test(ns.text);
    const err = mkEnv(mod, world({ status: 'open', lockIn: 30 * HOUR }), { read: { weeks: () => { throw new Error('x'); } } }); err.home.renderHome();
    const es = structure(kids(err.container.innerHTML, 'home-error'));
    out['P11b BREATHING ROOM: the error card is [text group (title + body)] then [Retry group]'] = !!es && /feed-card-title/.test(es.text) && /feed-card-body/.test(es.text) && /retry-load/.test(es.actions) && !/<button /.test(es.text);
    const nw = await newsSlotHtml(mod, 'error');
    const ws = structure(kids(nw, 'news-error'));
    out['P11c BREATHING ROOM: the news-error card is [text group (message)] then [Retry group]'] = !!ws && /feed-card-body/.test(ws.text) && /retry-news/.test(ws.actions) && !/<button /.test(ws.text);
    const emptyInner = kids(await newsSlotHtml(mod, 'empty'), 'news-empty');
    out['P11d BREATHING ROOM: the news-empty note\'s message is in a text group too (one rule for every .feed-note)'] = emptyInner !== null && /^<div class="feed-card-text"><p class="feed-card-body[^"]*">[^<]*<\/p><\/div>$/.test(emptyInner);
  }
  // — FB-010 on the whole page (D1 batch H): the game that just ended is the first card under the pinned Now card, and a later repaint does not re-date anything
  {
    const lw = world({ status: 'live', gameStates: ['final', 'live', 'scheduled'], firstKickIn: -3 * HOUR, p1: ['Texas'] });
    lw.games[0] = { ...lw.games[0], lastUpdated: iso(NOW - 30 * MIN) };          // Oklahoma at Texas went final half an hour ago
    const e = mkEnv(mod, lw, { read: { currentWeek: () => lw.weeks[0] } });
    e.home.renderHome();
    const types1 = cardTypes(e.container.innerHTML), keys1 = keysOf(e.container.innerHTML);
    out['P12 FB-010 acceptance 1 (page): the game that just ended is the FIRST card under the Now card — above the week\'s reveal card, its slate card and the year-ago note, none of which happened more recently'] =
      keys1[0] === 'now' && types1[0] === 'game.final' && types1.includes('week.revealed') && types1.includes('slate.published') && types1.includes('year.ago')
      && types1.indexOf('week.revealed') > types1.indexOf('game.final') && types1.indexOf('year.ago') > types1.indexOf('week.revealed');
    const w0 = e.container.writes;
    e.state.now = NOW + 2 * HOUR;                                                 // two hours pass; nothing in the league changes
    e.home.renderHome();
    out['P12b FB-010 acceptance 2: a repaint two hours later with no new data re-dates NOTHING — the same order, and no DOM write at all'] =
      JSON.stringify(keysOf(e.container.innerHTML)) === JSON.stringify(keys1) && e.container.writes === w0;
  }
  // — PM-110 acceptance 3 / DI-574 (D1 Lane B): a reader down-feed is not shoved. A newer card that would land ABOVE the first card they can see is HELD (the pill counts it) instead of being
  //   inserted; at or near the top, or on a user refresh, it goes in at once. The fake lays every keyed item out 100 px tall with a 16 px gap under a 60 px header, so getBoundingClientRect()
  //   moves with window.scrollY.
  {
    const scrollCalls = [];
    const saved = { y: globalThis.scrollY, by: globalThis.scrollBy, add: globalThis.addEventListener, rem: globalThis.removeEventListener };
    globalThis.scrollY = 0;
    globalThis.scrollBy = (o, y) => { const d = (o && typeof o === 'object') ? Number(o.top) : Number(y); scrollCalls.push(d); globalThis.scrollY += d; };
    const scrollListeners = [];
    globalThis.addEventListener = (t, fn) => { if (t === 'scroll') scrollListeners.push(fn); };
    globalThis.removeEventListener = (t, fn) => { const k = scrollListeners.indexOf(fn); if (t === 'scroll' && k >= 0) scrollListeners.splice(k, 1); };
    try {
      const laid = fakeContainer();
      laid.querySelectorAll = () => keysOf(laid._html).map((k, i) => ({
        getAttribute: (n) => (n === 'data-card-key' ? k : null),
        getBoundingClientRect: () => { const docTop = 60 + i * 116; return { top: docTop - globalThis.scrollY, bottom: docTop + 100 - globalThis.scrollY }; },
      }));
      const L = FINAL();
      const scribe = [];
      const post = (id, ts) => ({ id, leagueId: 'L1', ts, author: 'scribe', authorName: 'SCRIBE', body: 'Settled: ' + id, reactionCount: 0, meta: { kind: 'lifecycle', test: false } });
      const e = mkEnv(mod, L, { read: { currentWeek: () => L.weeks[1] }, chat: () => ({ scribe: scribe.slice(), lockerRoom: [] }), deps: { getContainer: () => laid } });
      e.home.renderHome();
      const topOf = (key) => { const it = laid.querySelectorAll().find(x => x.getAttribute('data-card-key') === key); return it ? it.getBoundingClientRect().top : null; };
      const sess = () => e.home._sessionForTest();
      // the reader scrolls well down the feed: the first card whose top is in view is the anchor
      globalThis.scrollY = 700;
      const anchorKey = laid.querySelectorAll().find(x => x.getBoundingClientRect().top >= 0).getAttribute('data-card-key');
      const anchorTop = topOf(anchorKey);
      const before = keysOf(laid._html);
      scribe.push(post('fresh', NOW + 7 * DAY));                                   // a NEWER card lands at the top of the ordinary feed…
      e.home.renderHome();
      out['P13 DI-574: reading down-feed, a newer card is HELD — nothing is inserted above the reader, the markup and the scroll position are untouched, and the pill\'s count is 1'] =
        JSON.stringify(keysOf(laid._html)) === JSON.stringify(before) && topOf(anchorKey) === anchorTop && scrollCalls.length === 0 && sess().heldCount === 1 && scrollListeners.length === 1;
      scribe.push(post('fresher', NOW + 8 * DAY));
      e.home.renderHome();
      out['P13b DI-574: more arrivals only update the count (2) — still nothing above the reader, still ONE scroll watch'] = sess().heldCount === 2 && JSON.stringify(keysOf(laid._html)) === JSON.stringify(before) && scrollListeners.length === 1;
      // the reader reaches the top by scrolling: the watch fires, both cards go in (newest first), nothing is compensated, the pill is gone
      globalThis.scrollY = 50;
      scrollListeners.slice().forEach(fn => fn());
      const keysTop = keysOf(laid._html);
      out['P13c DI-574: reaching the top by scrolling lets the held cards in — fresher, then fresh, directly under the Now card — with NO scroll call; the count is 0 and the watch is gone'] =
        keysTop[1].endsWith(':fresher') && keysTop[2].endsWith(':fresh') && scrollCalls.length === 0 && sess().heldCount === 0 && scrollListeners.length === 0;
      // near the top (<= 120 pt) a new card simply appears first — no hold, no compensation
      globalThis.scrollY = 100; scrollCalls.length = 0;
      scribe.push(post('nearTop', NOW + 9 * DAY));
      e.home.renderHome();
      out['P13d DI-574: within 120 pt of the top a newer card simply appears first — not held, no scroll call (chronology is correct where the reader is looking)'] =
        keysOf(laid._html)[1].endsWith(':nearTop') && scrollCalls.length === 0 && sess().heldCount === 0;
      // a change BELOW the reader (an older card joining inside the window, further down) is not held and moves nothing
      globalThis.scrollY = 700; scrollCalls.length = 0;
      const snap = e.home.assembleSnapshot({ viewerId: 'p1', now: NOW });
      const cardsNow = fcMod.deriveCards(snap, { viewerId: 'p1', now: NOW });
      const ordinary = [...cardsNow].sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));
      const pivot = Date.parse(ordinary[14].sortKey);
      const aKey = laid.querySelectorAll().find(x => x.getBoundingClientRect().top >= 0).getAttribute('data-card-key');
      scribe.push(post('older', pivot - 500));
      e.home.renderHome();
      const keys3 = keysOf(laid._html);
      out['P13e PM-110 #3: a change BELOW the reader (an older card joining further down the feed) is inserted, is NOT held, and moves nothing — no scroll call'] =
        scrollCalls.length === 0 && globalThis.scrollY === 700 && sess().heldCount === 0 && keys3.findIndex(k => k.endsWith(':older')) > keys3.indexOf(aKey);
      // a USER refresh (pull-to-refresh / the header sync tap): the card goes in at once and the reader keeps their place with ONE instant compensation (the inserted card's height)
      globalThis.scrollY = 700; scrollCalls.length = 0;
      const anchor2 = laid.querySelectorAll().find(x => x.getBoundingClientRect().top >= 0).getAttribute('data-card-key');
      const top2 = topOf(anchor2);
      scribe.push(post('refreshed', NOW + 10 * DAY));
      await e.home.refresh();
      out['P13f DI-574: on a USER refresh the new card is inserted at once and the card they were reading stays exactly where it was (one instant compensation: the inserted card\'s height)'] =
        keysOf(laid._html)[1].endsWith(':refreshed') && sess().heldCount === 0 && topOf(anchor2) === top2 && scrollCalls.length === 1 && scrollCalls[0] === 116;
      // iOS 15.0: the engine REJECTS the options form (`behavior: 'instant'` is an unknown enum there — a TypeError). The house helper falls back to the numeric
      // form, so the reader still stays put — the same fallback the section drag and the week swipe already rely on (review note 4).
      const optionCalls = [];
      globalThis.scrollBy = (o, y) => {
        if (o && typeof o === 'object') { optionCalls.push(o); throw new TypeError("The provided value 'instant' is not a valid enum value of type ScrollBehavior."); }
        scrollCalls.push(Number(y)); globalThis.scrollY += Number(y);
      };
      globalThis.scrollY = 700; scrollCalls.length = 0;
      const anchor4 = laid.querySelectorAll().find(x => x.getBoundingClientRect().top >= 0).getAttribute('data-card-key');
      const top4 = topOf(anchor4);
      scribe.push(post('ios15', NOW + 11 * DAY));
      await e.home.refresh();
      out['P13g PM-110 #3 on iOS 15.0: the options form is rejected (TypeError) and the numeric fallback still keeps the reader\'s card exactly in place — never a thrown repaint'] =
        optionCalls.length === 1 && optionCalls[0].behavior === 'instant' && scrollCalls.length === 1 && scrollCalls[0] === 116 && topOf(anchor4) === top4 && keysOf(laid._html)[1].endsWith(':ios15');
    } finally {
      globalThis.scrollY = saved.y; globalThis.scrollBy = saved.by; globalThis.addEventListener = saved.add; globalThis.removeEventListener = saved.rem;
    }
  }
  return out;
}

/** [8] Everything asynchronous: news, retry, pull-to-refresh, and the S-C7 re-checks after every await. */
async function asyncChecks(mod) {
  const out = {};
  const mkItems = (n = 2) => Array.from({ length: n }, (_, i) => ({ id: 'n' + (i + 1), url: 'https://example.com/' + i, source: 'ESPN', headline: 'Headline ' + (i + 1), imageUrl: null, publishedAt: iso(NOW - (i + 1) * HOUR), sport: 'cfb', teamIds: [], reason: 'Your sports', relevanceTier: 4 }));
  const deferred = () => { let resolve, reject; const p = new Promise((a, b) => { resolve = a; reject = b; }); return { p, resolve, reject }; };
  /** A news-enabled env whose fetch is SCRIPTED: each call takes the next function off `script`. */
  function newsEnv(script, o = {}) {
    const w = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] });
    const holder = {};
    const e = mkEnv(mod, w, { read: { currentWeek: () => w.weeks[0] }, ...o, deps: {
      fetchNews: (a) => { holder.e.calls.fetch.push(a); return (script.shift() || (() => Promise.resolve([])))(a); },
      renderNewsCard: (it) => { holder.e.calls.newsRender.push(it.id); return `<div class="card news-card" data-news-id="${it.id}"><i data-fake-news="${it.id}"></i></div>`; },
      ...(o.deps || {}),
    } });
    holder.e = e;
    return e;
  }
  const newsCount = (html) => (html.match(/data-news-id="/g) || []).length;
  // — arrival
  {
    const d = deferred();
    const e = newsEnv([() => d.p]);
    e.home.renderHome();
    const sk = e.container.innerHTML;
    out['A1 first render: the cards are THERE instantly and the news slot shows two skeletons; exactly one fetch ({force:false})'] =
      (sk.match(/news-skel:/g) || []).length === 2 && sk.includes('data-card-type="slate.published"') && e.calls.fetch.length === 1 && e.calls.fetch[0].force === false && e.home._newsStateForTest().status === 'loading';
    d.resolve(mkItems(2)); await flush();
    const done = e.container.innerHTML;
    out['A1b the news ARRIVES: skeletons replaced by UX-2\'s cards, spliced verbatim (their markup untouched), the new items fade in'] =
      newsCount(done) === 2 && !done.includes('news-skel') && done.includes('<i data-fake-news="n1"></i>') && e.calls.newsRender.includes('n1') && /feed-item--enter" data-card-key="news:n1"/.test(done) && e.home._newsStateForTest().status === 'ready';
    const w = e.container.writes;
    e.home.renderHome();
    out['A1c a later render does NOT refetch while the slot is fresh (UX-2\'s TTL is theirs; Home asks once)'] = e.calls.fetch.length === 1 && e.container.writes === w;
  }
  {
    const e = newsEnv([]); e.deps.fetchNews = undefined;
    const e2 = mkEnv(mod, world({ status: 'open', lockIn: 30 * HOUR }), {});
    e2.home.renderHome();
    out['A2 no news wiring -> status "off": the slot does not exist (no skeleton, no message)'] = e2.home._newsStateForTest().status === 'off' && !/news-/.test(e2.container.innerHTML);
  }
  // — S-C7: every async paint re-checks, in order
  {
    const d = deferred(); const e = newsEnv([() => d.p]);
    e.home.renderHome(); const w0 = e.container.writes;
    e.state.withheld = true; d.resolve(mkItems(2)); await flush();
    out['A3 S-C7: the gate flips to WITHHELD while the fetch is in flight -> the continuation paints NOTHING'] = e.container.writes === w0 && newsCount(e.container.innerHTML) === 0;
  }
  {
    const d = deferred(); const e = newsEnv([() => d.p]);
    e.home.renderHome(); const w0 = e.container.writes;
    e.state.identity = 'acct|L2|p9'; d.resolve(mkItems(2)); await flush();
    out['A3b S-C7: the IDENTITY moves (a switch / sign-out raced in, RG-174/176) -> nothing painted, and the result is DISCARDED (never committed to the next identity)'] = e.container.writes === w0 && e.home._newsStateForTest().status === 'idle';
  }
  {
    const d = deferred(); const e = newsEnv([() => d.p]);
    e.home.renderHome(); const w0 = e.container.writes;
    e.state.tab = 'chat'; d.resolve(mkItems(2)); await flush();
    out['A3c S-C7: the player navigated away -> nothing painted into an invisible tab'] = e.container.writes === w0;
  }
  // — the news slot's own failure is calm and local
  {
    const d = deferred(); const e = newsEnv([() => d.p]);
    e.home.renderHome(); d.reject(new Error('feed down')); await flush();
    const h = e.container.innerHTML;
    out['A4 news fetch FAILS -> a calm inline message with Retry inside the slot; the league banner is NEVER raised'] =
      h.includes('News is temporarily unavailable.') && h.includes('data-home-action="retry-news"') && h.includes('data-card-type="slate.published"') && e.home._newsStateForTest().status === 'error';
    // Retry
    const d2 = deferred(); const e2 = newsEnv([() => Promise.reject(new Error('down')), () => d2.p]);
    e2.home.renderHome(); await flush();
    const btn = e2.container.innerHTML.match(/<button[^>]*data-home-action="retry-news"[^>]*>/)[0];
    const attrs = Object.fromEntries([...btn.matchAll(/(data-[\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]]));
    e2.container.click(attrs);
    out['A5 Retry: a LIGHT haptic, the slot returns to skeletons at once (no layout jump), and fetchNews is re-called with {force:true}'] =
      e2.calls.haptics.join() === 'light' && e2.container.innerHTML.includes('news-skel:0') && e2.calls.fetch.length === 2 && e2.calls.fetch[1].force === true;
    d2.resolve(mkItems(1)); await flush();
    out['A5b …and the retried result paints'] = newsCount(e2.container.innerHTML) === 1;
  }
  // — pull-to-refresh: Home's leg is the FORCED NEWS fetch plus a repaint (DI-368). The league leg is runManualSync's, upstream: it throws before home.refresh() is reached,
  //   into the binder's existing onFail -> showSyncFailureBanner. Home has no league-sync dependency and no banner dependency at all, so a news failure CANNOT raise the league banner.
  {
    const run = async (newsFails) => {
      const e = newsEnv([() => Promise.resolve(mkItems(2)), () => (newsFails ? Promise.reject(new Error('news down')) : Promise.resolve(mkItems(2)))]);
      e.home.renderHome(); await flush();
      const r = await nonThrowing(() => e.home.refresh());
      return { e, r, html: e.container.innerHTML };
    };
    const ok = await run(false);
    out['A6 pull-to-refresh, news fine: the news is re-fetched with {force:true}, the page repaints, the promise RESOLVES to TRUE'] = ok.r === true && newsCount(ok.html) === 2 && ok.e.calls.fetch.length === 2 && ok.e.calls.fetch[1].force === true;
    const nf = await run(true);
    out['A6b NEWS fails: the news slot shows its own calm error (with Retry) and the rest of the page is intact; the refresh still resolves TRUE — and there is no banner path in Home to raise (hometest [1-30] pins that structurally)'] =
      nf.r === true && nf.html.includes('News is temporarily unavailable.') && nf.html.includes('data-home-action="retry-news"') && nf.html.includes('data-card-type="slate.published"') && nf.e.home._newsStateForTest().status === 'error';
    const none = mkEnv(mod, world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] }), {});
    none.home.renderHome();
    out['A6c no news wiring: refresh() is just a repaint and still resolves TRUE (no fetch to force)'] = (await none.home.refresh()) === true && !/news-/.test(none.container.innerHTML);
  }
  {
    let holder;
    const mk = (flip) => { const e = newsEnv([() => Promise.resolve(mkItems(2)), () => { flip(holder); return Promise.resolve(mkItems(2)); }]); holder = e; return e; };
    const e = mk((h) => { h.state.identity = 'acct|L2|p9'; });
    e.home.renderHome(); await flush(); const w0 = e.container.writes;
    const r1 = await e.home.refresh();
    out['A7 S-C7: the identity moved during the forced news fetch -> no paint (resolves FALSE: nothing completed), and the result is discarded'] = r1 === false && e.container.writes === w0 && e.home._newsStateForTest().status === 'idle';
    const e2 = mk((h) => { h.state.withheld = true; });
    e2.home.renderHome(); await flush(); const w2 = e2.container.writes;
    const r2 = await e2.home.refresh();
    out['A7b S-C7: the content became withheld during the refresh -> no paint, resolves FALSE'] = r2 === false && e2.container.writes === w2;
    const e3 = mk((h) => { h.state.tab = 'chat'; });
    e3.home.renderHome(); await flush(); const w3 = e3.container.writes;
    const r3 = await e3.home.refresh();
    out['A7c S-C7: the player left Home during the refresh -> no paint, resolves FALSE'] = r3 === false && e3.container.writes === w3;
  }
  // — B2 again, across the awaits: news arrival and pull-to-refresh never paint on a throw or a non-boolean
  {
    const variants = [['undefined', () => undefined], ["'yes'", () => 'yes'], ['a throw', () => { throw new Error('gate down'); }]];
    let arrivalOk = true, refreshOk = true;
    for (const [, fn] of variants) {
      const d = deferred(); let mode = () => false;
      const e = newsEnv([() => d.p], { withheldFn: () => mode() });
      e.home.renderHome(); const w0 = e.container.writes;
      mode = fn; d.resolve(mkItems(2)); await flush();
      if (e.container.writes !== w0 || newsCount(e.container.innerHTML) !== 0) arrivalOk = false;
      let m2 = () => false;
      const e2 = newsEnv([() => Promise.resolve(mkItems(2)), () => { m2 = fn; return Promise.resolve(mkItems(2)); }], { withheldFn: () => m2() });
      e2.home.renderHome(); await flush(); const w2 = e2.container.writes;
      const r = await e2.home.refresh();
      if (r !== false || e2.container.writes !== w2) refreshOk = false;
    }
    out['A8 B2: the gate turns undefined / \'yes\' / a THROW while news is in flight -> the arrival paints NOTHING'] = arrivalOk;
    out['A8b B2: …and during pull-to-refresh -> no paint, the promise resolves FALSE'] = refreshOk;
  }
  return out;
}

/** [9] Interactions. */
async function actionChecks(mod) {
  const out = {};
  const attrsOf = (html, action, nth = 0) => {
    const btns = [...html.matchAll(new RegExp(`<button[^>]*data-home-action="${action}"[^>]*>`, 'g'))].map(m => m[0]);
    return btns[nth] ? Object.fromEntries([...btns[nth].matchAll(/(data-[\w-]+)="([^"]*)"/g)].map(m => [m[1], m[2]])) : null;
  };
  {
    const w = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] });
    const e = mkEnv(mod, w, { read: { currentWeek: () => w.weeks[0] } });
    e.home.renderHome();
    const a = attrsOf(e.container.innerHTML, 'go-tab');
    out['I1 the Now card\'s primary action is a real button carrying go-tab + picks + a MEDIUM haptic (a primary action)'] = !!a && a['data-tab'] === 'picks' && a['data-haptic'] === 'medium' && /<button type="button" class="btn feed-action feed-action--solid gd-btn"/.test(e.container.innerHTML);
    out['I1b rendering fires NO haptic (haptics only on a deliberate tap)'] = e.calls.haptics.length === 0;
    e.container.click(a);
    out['I1c a tap: onAction("go-tab", {tab:"picks"}) and ONE medium haptic'] = JSON.stringify(e.calls.actions) === '[["go-tab",{"tab":"picks"}]]' && e.calls.haptics.join() === 'medium';
    const before = [e.calls.actions.length, e.calls.haptics.length];
    e.container.click({ 'data-home-action': 'evil', 'data-tab': 'picks', 'data-haptic': 'medium' });
    e.container.click({ 'data-home-action': 'go-tab', 'data-tab': 'admin', 'data-haptic': 'medium' });
    e.container.click({ 'data-home-action': 'go-tab', 'data-tab': '__proto__', 'data-haptic': 'medium' });
    e.container.click({ 'data-home-action': 'go-tab' });
    e.container.click(null);
    out['I2 the DOM is untrusted: an unknown action, an unknown tab (admin, __proto__), a missing tab, or a click on nothing -> NOTHING happens (no navigation, no haptic)'] = e.calls.actions.length === before[0] && e.calls.haptics.length === before[1];
    e.container.click({ 'data-home-action': 'go-tab', 'data-tab': 'dashboard', 'data-haptic': 'bogus' });
    out['I2b an unknown haptic kind degrades to LIGHT (only medium / light exist)'] = e.calls.haptics.slice(-1)[0] === 'light' && e.calls.actions.slice(-1)[0][1].tab === 'dashboard';
    e.home.renderHome(); e.home.renderHome(); e.home.renderHome();
    out['I3 binding is IDEMPOTENT: three repaints, one listener; unbinding removes it'] = e.container.listenerCount() === 1 && (() => { e.home.bindActions(e.container)(); return e.container.listenerCount() === 0; })();
    // ── D1 Part 2 item 6 (2026-10-08): a Now-card button opens the card's OWN sport ──
    // The Now card describes ONE week (the league's current week). With the member's pointer on the NFL, "Make your picks" on the COLLEGE card used to be a bare go-tab: it opened the NFL's Picks. In a
    // several-sport league the button now carries the sport of the week it is about (from the feed contexts) and the dispatcher forwards it; app.js's onHomeAction routes it through enterSportContext.
    {
      const wk = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] });
      const ctxs = [
        { competitionId: 'c-cfb', dbCode: 'cfb', code: 'CFB', weekIds: ['w9'], playerIds: ['p1', 'p2', 'p3'], currentWeekId: 'w9' },
        { competitionId: 'c-nfl', dbCode: 'nfl', code: 'NFL', weekIds: ['w_nfl'], playerIds: ['p1', 'p3'], currentWeekId: 'w_nfl' },
      ];
      const ms = mkEnv(mod, wk, { read: { currentWeek: () => wk.weeks[0], contexts: () => ctxs } });
      ms.home.renderHome();
      const am = attrsOf(ms.container.innerHTML, 'go-tab');
      out['I5 a several-sport league: the Now card\'s go-tab button carries the sport of ITS week (data-sport="cfb")'] = !!am && am['data-tab'] === 'picks' && am['data-sport'] === 'cfb';
      ms.container.click(am);
      out['I5b ...and a tap forwards it: onAction("go-tab", {tab:"picks", sport:"cfb"})'] = JSON.stringify(ms.calls.actions) === '[["go-tab",{"tab":"picks","sport":"cfb"}]]';
      const nBefore = ms.calls.actions.length;
      ms.container.click({ 'data-home-action': 'go-tab', 'data-tab': 'picks', 'data-sport': 'nhl', 'data-haptic': 'medium' });
      ms.container.click({ 'data-home-action': 'go-tab', 'data-tab': 'picks', 'data-sport': '__proto__', 'data-haptic': 'medium' });
      out['I5c the DOM is untrusted: a sport the league does not run is DROPPED (the tap is a plain go-tab), never forwarded'] = ms.calls.actions.length === nBefore + 2 && ms.calls.actions.slice(-2).every(([a, p]) => a === 'go-tab' && p.tab === 'picks' && !('sport' in p));
      ms.container.click({ 'data-home-action': 'go-tab', 'data-tab': 'commissioner', 'data-sport': 'cfb', 'data-comm-target': 'week', 'data-haptic': 'light' });
      out['I5d a sport rides only on a sport tab: Comm and others never carry one'] = !('sport' in ms.calls.actions.slice(-1)[0][1]);
      const one = mkEnv(mod, wk, { read: { currentWeek: () => wk.weeks[0] } });
      one.home.renderHome();
      const a1 = attrsOf(one.container.innerHTML, 'go-tab');
      out['I6 a ONE-sport league: the button has no data-sport at all (the markup is the unmodified markup)'] = !!a1 && !('data-sport' in a1) && !/data-sport=/.test(one.container.innerHTML);
      one.container.click(a1);
      out['I6b ...and a tap forwards exactly {tab:"picks"}'] = JSON.stringify(one.calls.actions) === '[["go-tab",{"tab":"picks"}]]';
    }
    const noop = mkEnv(mod, world(), { deps: { onAction: undefined, haptic: undefined } });
    noop.home.renderHome();
    out['I4 with no onAction / haptic injected a tap is harmless (the default haptic is the native-only one — a no-op on web)'] = (() => { try { noop.container.click({ 'data-home-action': 'go-tab', 'data-tab': 'picks', 'data-haptic': 'medium' }); return true; } catch { return false; } })();
  }
  {
    const empty = { players: fx.PLAYERS, weeks: [], games: [], picks: [], weeklyResults: [] };
    const c = mkEnv(mod, empty, { admin: true }); c.home.renderHome();
    const a = attrsOf(c.container.innerHTML, 'build-slate');
    c.container.click(a);
    const p = mkEnv(mod, empty); p.home.renderHome();
    out['I5 a brand-new league: the commissioner gets "Build the first slate" (build-slate, medium); a player gets NO button'] =
      !!a && a['data-haptic'] === 'medium' && c.container.innerHTML.includes('Build the first slate') && JSON.stringify(c.calls.actions) === '[["build-slate",{}]]' && !p.container.innerHTML.includes('<button') && p.container.innerHTML.includes('Nothing yet — this is where it starts.');
  }
  {
    const lw = world({ status: 'live', gameStates: ['final', 'final', 'final'], firstKickIn: -3 * DAY, extra: { pendingFinalization: true, pendingFinalizationSinceMs: NOW - 30 * HOUR } });
    const c = mkEnv(mod, lw, { admin: true, read: { currentWeek: () => lw.weeks[0] } }); c.home.renderHome();
    const html = c.container.innerHTML;
    const keys = keysOf(html);
    const a = attrsOf(html, 'go-tab', 0);   // D1 Game Day: the all-final card has no go-tab of its own now (the retired "See the full slate" was index 0), so the nudge's button is the first
    c.container.click(a);
    const pl = mkEnv(mod, lw, { read: { currentWeek: () => lw.weeks[0] } }); pl.home.renderHome();
    out['I6 the commissioner nudge sits directly beneath the Now card, offers "Open Commissioner Panel" -> the right Comm tab (neutral tone, a LIGHT haptic) — and a player never sees it'] =
      keys[0] === 'now' && keys[1].startsWith('nudge:LIVE_NOT_FINALIZED') && html.includes('feed-nudge') && html.includes('Open Commissioner Panel') && a['data-tab'] === 'commissioner' && a['data-comm-target'] === 'week' && !('data-comm-tab' in a) && a['data-haptic'] === 'light'
      && JSON.stringify(c.calls.actions) === '[["go-tab",{"tab":"commissioner","commTab":"week"}]]' && !pl.container.innerHTML.includes('feed-nudge');
    c.container.click({ 'data-home-action': 'go-tab', 'data-tab': 'commissioner', 'data-comm-target': 'nope', 'data-haptic': 'light' });
    out['I6b an unknown commissioner tab is dropped (the panel still opens, on its default)'] = JSON.stringify(c.calls.actions.slice(-1)[0]) === '["go-tab",{"tab":"commissioner"}]';
    c.container.click({ 'data-home-action': 'go-tab', 'data-tab': 'commissioner', 'data-comm-tab': 'games', 'data-haptic': 'light' });
    out['I6c the OLD attribute name (data-comm-tab, RG-10\'s card-tagging attribute) is ignored by the dispatcher: only data-comm-target selects a commissioner tab'] = JSON.stringify(c.calls.actions.slice(-1)[0]) === '["go-tab",{"tab":"commissioner"}]' && !/data-comm-tab/.test(html);
  }
  {
    // FB-022 (D1 batch H) kept the period when "See the full slate" opened the Dashboard; that BUTTON is retired with the Live Peek (D1 Lane B, Drew D-58). What stays is the DISPATCHER's rule — a go-tab that names a week
    // keeps it only if it is one of this league's weeks, and a forged id is dropped (the DOM is untrusted) — pinned here with a hand-built click; the Game Day footer button is gd-dashboard (gamedaytest).
    const lw = world({ status: 'live', gameStates: ['live', 'scheduled', 'scheduled'], firstKickIn: -HOUR, p1: ['Texas'] });
    const e = mkEnv(mod, lw, { read: { currentWeek: () => lw.weeks[0] } }); e.home.renderHome();
    const a = { 'data-home-action': 'go-tab', 'data-tab': 'dashboard', 'data-week-id': 'w9', 'data-haptic': 'medium' };
    e.container.click(a);
    out['I10 FB-022: a go-tab that names one of this league\'s weeks hands it to the app: onAction("go-tab", {tab:"dashboard", weekId:"w9"})'] =
      JSON.stringify(e.calls.actions) === '[["go-tab",{"tab":"dashboard","weekId":"w9"}]]';
    e.container.click({ ...a, 'data-week-id': 'w-forged' });
    e.container.click({ ...a, 'data-week-id': '__proto__' });
    out['I10b FB-022: a week id that is not one of this league\'s weeks (forged, __proto__) is DROPPED — the tab still opens, with no week param'] =
      JSON.stringify(e.calls.actions.slice(1)) === '[["go-tab",{"tab":"dashboard"}],["go-tab",{"tab":"dashboard"}]]';
  }
  {
    // retry-load recovers a failed render in place
    const w = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] });
    let broken = true;
    const e = mkEnv(mod, w, { read: { currentWeek: () => w.weeks[0], weeks: () => { if (broken) throw new Error('x'); return w.weeks; } } });
    e.home.renderHome();
    const a = attrsOf(e.container.innerHTML, 'retry-load');
    broken = false;
    e.container.click(a);
    out['I7 Retry on the error card re-renders in place: the content returns, the error card is gone, a LIGHT haptic'] = !!a && e.container.innerHTML.includes('data-card-key="now"') && !e.container.innerHTML.includes('home-error') && e.calls.haptics.join() === 'light';
  }
  {
    const L = fx.buildLeague({ w2: 'live', calculateWeeklyResults });
    const e = mkEnv(mod, L, { read: { currentWeek: () => L.weeks[1] } });
    const html = paintAll(e);
    const els = [...html.matchAll(/<[a-z]+[^>]*data-home-action[^>]*>/g)].map(m => m[0]);
    // A card that opens a detail (DI-575) is ONE tap target: an <article role="button" tabindex="0"> with an accessible name that says it opens details; every other action is a real <button type="button">.
    const isTapCard = (t) => t.startsWith('<article class="card feed-card feed-card--tap" role="button" tabindex="0"') && /data-home-action="open-card"/.test(t) && /aria-label="[^"]+\. Opens details\."/.test(t);
    out['I8 every actionable element is a real <button type="button"> — or a tappable card (role=button, tabindex=0, "… Opens details.") — every glyph aria-hidden, every chip result also in words'] =
      els.length > 0 && els.every(t => t.startsWith('<button type="button"') || isTapCard(t)) && els.some(t => isTapCard(t)) && !/<svg(?![^>]*aria-hidden="true")/.test(html) && /<span class="sr-only"> (covered|missed)<\/span>/.test(html);
  }
  {
    const empty = { players: fx.PLAYERS, weeks: [], games: [], picks: [], weeklyResults: [] };
    const forged = { 'data-home-action': 'build-slate', 'data-haptic': 'medium' };
    const pl = mkEnv(mod, empty); pl.home.renderHome();
    pl.container.click(forged);
    out['I9 B3: a PLAYER\'s click on a forged build-slate control produces NO haptic and NO onAction (the role is checked at dispatch, not trusted from the markup)'] = pl.calls.haptics.length === 0 && pl.calls.actions.length === 0 && !pl.container.innerHTML.includes('build-slate');
    const co = mkEnv(mod, empty, { admin: true }); co.home.renderHome();
    co.container.click(forged);
    out['I9b B3 POSITIVE CONTROL: the commissioner\'s identical click does fire (one medium haptic, one onAction)'] = co.calls.haptics.join() === 'medium' && JSON.stringify(co.calls.actions) === '[["build-slate",{}]]';
    let stillAdmin = true;
    const dem = mkEnv(mod, empty, { read: { viewer: () => ({ playerId: 'p1', isAdmin: stillAdmin }) } }); dem.home.renderHome();
    stillAdmin = false;
    dem.container.click(forged);
    out['I9c B3: the role is read at the moment of the TAP — a commissioner demoted after the button rendered is refused'] = dem.calls.haptics.length === 0 && dem.calls.actions.length === 0;
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] mergeFeed — the fixed order, week grouping, news density / freshness / states, determinism…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const MERGE_RES = mergeChecks(home);
for (const [label, ok] of Object.entries(MERGE_RES)) assert(ok === true, `6: ${label}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Rendering — the card shell, escaping at the sink, no-op repaint, entrance, skeleton, errors, content withheld…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const PAINT_RES = await paintChecks(home);
for (const [label, ok] of Object.entries(PAINT_RES)) assert(ok === true, `7: ${label}`);
{
  // the shell, over a whole final-week page
  const L = fx.buildLeague({ w2: 'final', calculateWeeklyResults });
  const e = mkEnv(home, L, { read: { currentWeek: () => L.weeks[1] }, chat: {
    scribe: [{ id: 'sp1', leagueId: 'L1', ts: NOW - HOUR, author: 'scribe', authorName: 'SCRIBE', body: 'Line one.\nLine two.', reactionCount: 0, meta: { kind: null, test: false } }],
    lockerRoom: [{ id: 'lr1', leagueId: 'L1', ts: NOW - HOUR, author: 'p3', authorName: 'Kevin', body: 'a take', reactionCount: 3, meta: { kind: null, test: false } }] } });
  const html = paintAll(e);
  const keys = keysOf(html);
  const articles = (html.match(/<article /g) || []).length, shells = (html.match(/<article class="card feed-card[ "]/g) || []).length;
  assert(articles === 20 && articles === shells, `7-1: DI-367 — every card (${articles}) is an <article class="card feed-card …"> (one shell); the Now card is a <section> of the same shell`);   // W-92: 20 exactly (related cards combine; was "> 20")
  assert(html.includes('<section class="gd') && html.includes('data-gd-kind="final"') && !html.includes('feed-now'), '7-2: D1 Game Day — in a final week the Now card is GAME DAY, a <section class="gd"> (the red card, DI-603); the Now card\'s own shell (.feed-now) is kept only for Draft, Between seasons and an empty league');
  assert(keys[0] === 'now' && keys[keys.length - 1] === 'caught-up' && new Set(keys).size === keys.length, '7-3: UN-334 — Now first, the end marker last, every key unique');
  assert(html.includes("You're all caught up."), '7-4: the end marker reads "You\'re all caught up."');
  const cards = [...html.matchAll(/<article class="card feed-card(?: feed-card--tap)?"[^>]*? data-card-type="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g)];
  assert(cards.length > 15 && cards.every(m => /<span class="feed-card-reason">[^<]+<\/span>/.test(m[2])), `7-5: UN-329 — every one of ${cards.length} cards carries its "why am I seeing this" reason label`);
  assert(cards.every(m => /<span class="feed-card-icon" aria-hidden="true"><svg /.test(m[2])), '7-6: every card has its eyebrow glyph, aria-hidden, from the one icon family');
  const wr = html.match(/data-card-type="week\.result"[\s\S]*?<\/article>/)[0];
  assert(wr.includes('feed-card-caption') && !wr.includes('feed-card-body'), '7-7: a captioned card shows the SCRIBE caption INSTEAD of its restating body (one fact, one presentation)');
  const lr = html.match(/data-card-type="lockerroom\.top"[\s\S]*?<\/article>/)[0], sp = html.match(/data-card-type="scribe\.post"[\s\S]*?<\/article>/)[0];
  assert(lr.includes('feed-card-body') && lr.includes('a take') && !lr.includes('feed-card-caption'), '7-8: the Locker Room card keeps its quoted body (the body IS the content) and shows no caption');
  assert(sp.includes('feed-card-body feed-card-body--scribe') && sp.includes('Line one.\nLine two.') && !sp.includes('feed-card-title'), '7-9: a SCRIBE post is its body verbatim (newlines kept for pre-line), no title, no caption');
  assert(cards.some(m => m[1] === 'week.result') && cards.some(m => m[1] === 'rank.changed') && cards.some(m => m[1] === 'streak.extended') && !cards.some(m => m[1] === 'player.week'), '7-10: the league stat cards are on the page (week result, standings, streaks) — W-92: no personal-record card (retired; the week result\'s detail holds the records)');
  const L2 = fx.buildLeague({ w2: 'live', calculateWeeklyResults });
  const e2 = mkEnv(home, L2, { read: { currentWeek: () => L2.weeks[1] } }); paintAll(e2);
  const gf = e2.container.innerHTML.match(/data-card-type="game\.final"[\s\S]*?<\/article>/)[0];
  assert(/badge feed-chip badge-win/.test(gf) && /badge feed-chip badge-loss/.test(gf) && /<svg /.test(gf) && /sr-only"> covered/.test(gf) && /sr-only"> missed/.test(gf), '7-11: game.final chips carry a glyph AND a word, never colour alone (WCAG 1.4.1), with the shipped .badge-win / .badge-loss');
  assert(!/>[^<]*\d{4}-\d{2}-\d{2}T/.test(html), '7-12: no raw ISO timestamp is ever rendered (CONVENTIONS #19 — render-time formatting)');
  // determinism under a shuffle of every input array
  let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const baseline = html;
  let identical = true;
  for (let i = 0; i < 10; i++) {
    // `players` keeps its order ON PURPOSE: calculateSeasonStandings' sort has no final tie-break, so two fully tied players rank in array order — exactly as Standings does (parity, the DI's own premise). Flagged in the report; not changed here.
    const S = { ...L, weeks: L.weeks.slice().sort(() => rnd() - 0.5), games: L.games.slice().sort(() => rnd() - 0.5), picks: L.picks.slice().sort(() => rnd() - 0.5), players: L.players, weeklyResults: L.weeklyResults.slice().sort(() => rnd() - 0.5) };
    const ee = mkEnv(home, S, { read: { currentWeek: () => L.weeks[1] }, chat: { scribe: [{ id: 'sp1', leagueId: 'L1', ts: NOW - HOUR, author: 'scribe', authorName: 'SCRIBE', body: 'Line one.\nLine two.', reactionCount: 0, meta: { kind: null, test: false } }],
      lockerRoom: [{ id: 'lr1', leagueId: 'L1', ts: NOW - HOUR, author: 'p3', authorName: 'Kevin', body: 'a take', reactionCount: 3, meta: { kind: null, test: false } }] } });
    paintAll(ee);
    if (ee.container.innerHTML !== baseline) identical = false;
  }
  assert(identical, '7-13: DETERMINISTIC — ten shuffles of the weeks, games, picks and results give a BYTE-IDENTICAL page (captions included: selected by card id, never random)');
  // a card with nothing to say renders nothing
  assert(home.cardHTML({ id: 'x', type: 'week.result', facts: {}, reason: 'In your league' }, { escHtml: esc, formatKickoff: String }) === '', '7-14: a card with no copy renders NOTHING (never an empty shell)');
  assert(home.cardHTML({ id: 'x', type: 'slate.published', facts: { gameCount: 3 }, reason: 'This week' }, { escHtml: esc, formatKickoff: String }) === '', '7-15: a week-scoped card with no week number renders nothing (never "Week \'s slate")');
  // the commissioner's view of a pre-reveal week
  const ow = world({ status: 'open', lockIn: 30 * HOUR, p1: ['Texas'] });
  const ec = mkEnv(home, ow, { admin: true, read: { currentWeek: () => ow.weeks[0] } }); ec.home.renderHome();
  assert(!ec.container.innerHTML.includes('feed-nudge') && keysOf(ec.container.innerHTML)[0] === 'now', '7-16: no nudge when nothing is due, even for the commissioner');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] Async — news arrival, retry, pull-to-refresh\'s two failure paths, the S-C7 re-checks after every await…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const ASYNC_RES = await asyncChecks(home);
for (const [label, ok] of Object.entries(ASYNC_RES)) assert(ok === true, `8: ${label}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[9] Interactions — delegated, allow-listed, haptics, idempotent binding, real buttons…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const ACTION_RES = await actionChecks(home);
for (const [label, ok] of Object.entries(ACTION_RES)) assert(ok === true, `9: ${label}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
// [2] and [10] as named check groups (so the mutation section can re-run them against every scratch copy).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/** [2] Every required dependency throws when missing. */
function depChecks(mod) {
  const out = {};
  const w = world();
  const base = () => mkEnv(mod, w).deps;
  const REQUIRED = ['escHtml', 'isContentWithheld', 'confirmedStatusFor', 'picksReadConfirmed', 'chatCandidates', 'getContainer', 'currentIdentityKey', 'getCurrentTab'];
  for (const k of REQUIRED) {
    let threw = null, t2 = null;
    try { mod.createHome({ ...base(), [k]: undefined }); } catch (e) { threw = e; }
    try { mod.createHome({ ...base(), [k]: 'not a function' }); } catch (e) { t2 = e; }
    out[`D1 ${k} missing or non-function -> a TypeError at construction`] = threw instanceof TypeError && t2 instanceof TypeError;
  }
  out['D2 createHome() with no argument throws'] = (() => { try { mod.createHome(); return false; } catch (e) { return e instanceof TypeError; } })();
  const e = mkEnv(mod, w);
  const minimal = { escHtml: esc, isContentWithheld: () => false, confirmedStatusFor: x => x.status, picksReadConfirmed: () => true, chatCandidates: () => ({ scribe: [], lockerRoom: [] }), getContainer: () => e.container, currentIdentityKey: () => 'k', getCurrentTab: () => 'home', read: e.read };
  out['D3 the optional ones (onAction, haptic, fetchNews, renderNewsCard, isDataReady, now) all have safe defaults'] = (() => { try { return mod.createHome(minimal).renderHome() === true; } catch { return false; } })();
  out['D4 the instance exposes renderHome, refresh and bindActions'] = typeof mod.createHome(minimal).refresh === 'function' && typeof mod.createHome(minimal).bindActions === 'function' && typeof mod.createHome(minimal).renderHome === 'function';
  out['D5 createHome takes ONE argument (the dependency object)'] = mod.createHome.length === 1;
  return out;
}

/** [10] THE BLIND RULE, at the level of the whole page. Every state, with positive controls. */
async function blindChecks(mod) {
  const out = {};
  const W2_TEAMS = ['Oregon', 'Washington', 'Miami', 'Florida State', 'Penn State', 'Iowa', 'USC', 'UCLA'];
  const page = (L, o = {}) => { const e = mkEnv(mod, L, { read: { currentWeek: () => L.weeks[1] }, ...o }); paintAll(e); return { e, html: e.container.innerHTML }; };
  const w2Cards = (html) => keysOf(html).filter(k => k.includes(':w2:')).map(k => k.split(':')[0]);
  const noW2Teams = (html) => W2_TEAMS.every(t => !html.includes(t));
  const L = (w2, extra = {}) => fx.buildLeague({ w2, calculateWeeklyResults, ...extra });
  // The clock matters: week 2's games kick off 2026-09-12 16:00Z, so OPEN is checked two days before and LOCKED six hours before (a real OPEN / LOCKED Home, not a week whose lock already passed).
  const AT = { OPEN: { now: Date.parse('2026-09-10T12:00:00.000Z') }, LOCKED: { now: Date.parse('2026-09-12T10:00:00.000Z') } };
  for (const [label, w2, extra, allowed, at] of [['OPEN', 'open', {}, ['slate.published', 'picks.submitted', 'year.ago'], AT.OPEN], ['LOCKED', 'locked', {}, ['slate.published', 'year.ago'], AT.LOCKED], ['OPEN with a FINAL game inside it (RG-45)', 'open', { w2Finals: ['g21'] }, ['slate.published', 'picks.submitted', 'year.ago'], AT.OPEN]]) {
    const p = page(L(w2, extra), { state: at });
    out[`B1 ${label}: NO week-2 team name anywhere on the page, though every player's picks are in the store (the local-mode-shaped adversarial fixture)`] = noW2Teams(p.html);
    out[`B1b ${label}: the week-2 cards are ONLY the pick-free types (${allowed.join(', ')} — year.ago is closed 2025 history)`] = w2Cards(p.html).every(t => allowed.includes(t)) && w2Cards(p.html).length >= 1;
    const adm = page(L(w2, extra), { admin: true, state: at });
    out[`B1c ${label}: the COMMISSIONER's page is the same — the no-stake bypass never reaches the feed (S-C1)`] = noW2Teams(adm.html) && w2Cards(adm.html).every(t => allowed.includes(t));
    const anon = page(L(w2, extra), { viewer: null, state: at });
    out[`B1d ${label}: a viewer with no identity sees none either`] = noW2Teams(anon.html);
  }
  const live = page(L('live'));
  out['B2 POSITIVE CONTROL: once the week is LIVE, the finished game IS on the page (Oregon / Washington) — the guard is what hid it before'] = live.html.includes('Oregon') && live.html.includes('Washington') && w2Cards(live.html).includes('game.final');
  out['B2b LIVE: the game still in progress (g22) has no game card, no chips and no aggregate — only the Now card names it, by its public score'] = !keysOf(live.html).some(k => k.endsWith(':g22')) && !live.html.replace(nowHtmlOf(live.html), '').includes('Florida State');
  out['B2c LIVE: no week-level aggregate for week 2 yet (week.result / player.week / rank.changed / streak / milestone wait for the finalize)'] = w2Cards(live.html).every(t => ['game.final', 'called.it', 'stood.alone', 'week.revealed', 'slate.published', 'year.ago'].includes(t));
  const fin = page(L('final'));
  out['B3 POSITIVE CONTROL: FINAL shows every week-2 team and the week-level aggregates'] = W2_TEAMS.filter(t => !['Penn State', 'Iowa'].includes(t)).every(t => fin.html.includes(t)) && w2Cards(fin.html).includes('week.result') && w2Cards(fin.html).includes('rank.changed') && !w2Cards(fin.html).includes('player.week');   // W-92: the aggregates are the combined cards
  const c = page(L('live', { w3: true }), { read: { currentWeek: () => ({ weekId: 'w3' }) } });
  out['B4 Fixture C: a FINAL week 3 after a LIVE week 2 — week 2 contributes NO aggregate card (it is not in the revealed view)'] = !w2Cards(c.html).some(t => ['week.result', 'player.week', 'rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached'].includes(t)) && keysOf(c.html).some(k => k.includes(':w3:'));
  // S-C10 at page level: the week is public here before the others' rows have landed
  const nope = page(L('live'), { supabase: true, picksRead: (id) => id !== 'w2' });
  const yes = page(L('live'), { supabase: true, picksRead: () => true });
  out['B5 S-C10: supabase mode, week 2 public but the other members\' rows have NOT landed -> no game.final / called.it / stood.alone for it'] = !w2Cards(nope.html).some(t => ['game.final', 'called.it', 'stood.alone'].includes(t));
  out['B5b …and POSITIVE CONTROL: with the rows confirmed they appear'] = w2Cards(yes.html).includes('game.final');
  // the Now card for each pre-reveal state names no other player's pick (covered row by row in [3]); the compact callback stays silent
  const calls = [];
  for (const w2 of ['open', 'locked']) { const p = page(L(w2), { state: AT[w2.toUpperCase()] }); calls.push(p.e.calls.compact.length); }
  out['B6 the compact dashboard callback is never called for an OPEN or LOCKED week'] = calls.every(n => n === 0);
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[10] [BLIND-RULE] the whole page against OPEN / LOCKED / LIVE / FINAL — negatives with positive controls, the commissioner and a nobody…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const BLIND_RES = await blindChecks(home);
for (const [label, ok] of Object.entries(BLIND_RES)) assert(ok === true, `10: ${label}`);

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[11] The CSS block — tokens only, breathing room, press, reduced motion, 44 pt…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const CSS = await read('./css/styles.css');
{
  const b = CSS.indexOf('/* ═══ SOCIAL PLATFORM v1 HOME — BEGIN'), e = CSS.indexOf('/* ═══ SOCIAL PLATFORM v1 HOME — END');
  assert(b > 0 && e > b && CSS.indexOf('SOCIAL PLATFORM v1 HOME — BEGIN', b + 10) < 0, '11-1: ONE banner-delimited block (BEGIN … END), appended');
  assert(CSS.slice(e).split('\n').length <= 2, '11-2: the block is the LAST thing in styles.css (appended, nothing after it)');
  const block = CSS.slice(b, e);
  const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(rules) && !/\b(rgb|rgba|hsl|hsla)\s*\(/.test(rules), '11-3: DESIGN — no colour literal in the block (semantic tokens only; works in Light, Dark and every school overlay)');
  const TOKENS = new Set([...rules.matchAll(/var\((--[\w-]+)/g)].map(m => m[1]));
  const ALLOWED_TOKENS = ['--bg-card', '--bg-card-alt', '--bg-input', '--border', '--border-strong', '--text-primary', '--text-secondary', '--maroon', '--maroon-mid', '--maroon-text', '--oxblood', '--oxblood-on', '--gold', '--gold-pale', '--gold-text', '--motion-fast', '--ease-entrance', '--ease-native', '--skeleton-shimmer', '--btn-radius'];   // --ease-native joined 2026-10-07 (D1 Lane B: the card press — the SAME recipe as .news-card:active)
  assert([...TOKENS].every(t => ALLOWED_TOKENS.includes(t)) && TOKENS.size >= 14, `11-4: only the documented semantic tokens are read (${[...TOKENS].join(', ')})`);
  assert(![...TOKENS].some(t => /^--(text-muted|win|loss|live|push|nd)\b/.test(t)) && !/color:var\(--maroon\)/.test(rules) && !/(^|[;{}])color:var\(--maroon-mid\)/.test(rules), '11-5: no --text-muted as content, no base crimson as TEXT (fills only; text uses --maroon-text)');
  assert(!/(^|[^-\w])margin-(left|right|top|bottom)?:\s*(?!0)[1-9]/.test(rules) && /\.feed-now-own\{[^}]*gap:8px/.test(rules), '11-6: BREATHING ROOM — NO positive margin anywhere in the block (space comes from a container gap, never from a margin on one control — the trend glyph\'s 8 pt is a flex gap too)');
  assert(/\.home-feed\{[^}]*display:flex;flex-direction:column;gap:16px/.test(rules), '11-7: BREATHING ROOM — cards are 16 pt apart by the container\'s gap');
  assert(/\.feed-card\{[^}]*gap:8px/.test(rules) && /\.feed-actions\{[^}]*display:flex;flex-wrap:wrap;gap:8px;justify-content:center/.test(rules), '11-8: BREATHING ROOM — 8 pt in-group gap; a button group is centred and WRAPS into a stack that keeps its gap');
  assert(/\.feed-now\{[^}]*gap:16px/.test(rules), '11-9: BREATHING ROOM — 16 pt between the Now card\'s groups (text / compact / actions)');
  assert(/\.feed-action\{[^}]*min-height:44px/.test(rules), '11-10: every Home control is >= 44 pt tall');
  assert(/\.btn:active:not\(:disabled\)\{transform:scale\(\.97\)\}/.test(CSS) && !/\.feed-action[^{]*:active/.test(rules), '11-11: POLISH — the press feedback is the SHIPPED .btn:active scale(.97), reused (no second press language)');
  assert(!/\b(transition|animation)[^;}]*(\b[3-9]\d\d\d?ms|\b[1-9]s\b)/.test(rules.replace(/var\(--skeleton-shimmer,1400ms\)/g, '')) && /--motion-fast:150ms/.test(CSS), '11-12: POLISH — one motion language: the 150 ms token, the shipped skeleton pulse, no stray durations');
  // AMENDED 2026-10-07 (D1 Lane B): three named exceptions, each a DI — the card press (.feed-card--tap:active, the shipped scale(.97) recipe, DI-575), the new-posts pill's ≤ 8 pt fade-slide (@keyframes home-pill-in, DI-574) and its
  // chevron turned a quarter turn so it points up (.home-pill-glyph, no new glyph). The card ENTRANCE (.feed-item--enter) is still an opacity fade and nothing else slides, bounces or scales.
  const moving = rules.replace(/\.feed-skel[^}]*\}/g, '').replace(/\.feed-card--tap:active\{[^}]*\}/, '').replace(/@keyframes home-pill-in\{[\s\S]*?\}\}/, '').replace(/\.home-pill-glyph\{[^}]*\}/, '');
  assert(/@keyframes feed-item-in\{from\{opacity:0\}to\{opacity:1\}\}/.test(rules) && !/translate|scale|rotate/.test(moving) && /\.feed-card--tap:active\{transform:scale\(\.97\)\}/.test(rules) && /@keyframes home-pill-in\{from\{opacity:0;transform:translateY\(-8px\)\}to\{opacity:1;transform:none\}\}/.test(rules), '11-13: POLISH — the card entrance is an OPACITY fade only; nothing else slides, bounces or scales except the three named D1 exceptions (card press, the pill\'s ≤ 8 pt slide, its quarter-turn chevron)');
  assert(/@media \(prefers-reduced-motion:reduce\)\{[^}]*\.feed-item--enter\{animation:none\}[\s\S]*?\.feed-skel-line\{animation:none;opacity:\.7\}[\s\S]*?\.feed-skel-image\{animation:none;opacity:\.7\}/.test(rules), '11-14: POLISH — Reduce Motion removes the card fade-in outright (the content simply appears) and holds the looping skeleton still at a visible mid opacity (.7), one rule per animated selector');
  assert(/animation:feed-skel-pulse var\(--skeleton-shimmer,1400ms\) ease-in-out infinite/.test(rules) && /@keyframes feed-skel-pulse\{0%,100%\{opacity:\.5\}50%\{opacity:\.9\}\}/.test(rules) && /--skeleton-shimmer:1400ms/.test(CSS) && /@keyframes skeleton-shimmer\{0%,100%\{opacity:\.25\}50%\{opacity:\.45\}\}/.test(CSS) && /\.feed-skel-line\{[^}]*background:var\(--border-strong\)/.test(rules), '11-15: DESIGN — the skeleton keeps the shipped 1400 ms token, ease and opacity-pulse language, but on --border-strong at .5-.9 so it is visible on the Dark card (the shipped .25-.45 on --bg-input all but vanishes there)');
  assert((rules.match(/@media/g) || []).length === 2 && /@media \(min-width:600px\)/.test(rules) && !/max-width/.test(rules), '11-16: mobile-first — the only media queries are Reduce Motion and the >=600px enhancement (no max-width)');
  assert(/\.feed-card\{[^}]*overflow-wrap:anywhere/.test(rules) && /font-size:\.8125rem|font-size:\.875rem/.test(rules) && !/font-size:\d+px/.test(rules), '11-17: Dynamic Type — sizes are rem, long names wrap (overflow-wrap:anywhere)');
  assert(/\.feed-card-body--scribe\{white-space:pre-line\}/.test(rules), '11-18: a SCRIBE post keeps its line breaks');
  assert(/\.feed-skel\{pointer-events:none\}/.test(rules), '11-19: a skeleton is inert');
  const classesUsed = [...new Set([...HOME_SRC.matchAll(/class="([^"$]*)/g)].flatMap(m => m[1].split(/\s+/)).map(c => c.replace(/[^\w-]/g, '')).filter(c => /^(feed|home)-/.test(c) && !c.endsWith('--')).concat(['feed-action--solid', 'feed-action--outline', 'feed-action--neutral']))];
  const classesStyled = new Set([...rules.matchAll(/\.((?:feed|home)-[\w-]+)/g)].map(m => m[1]));
  const unstyled = classesUsed.filter(c => !classesStyled.has(c) && !['feed-chip-glyph'].includes(c));
  assert(unstyled.length === 0, `11-20: every .feed-/.home- class the markup uses is styled in the block (${classesUsed.length} used; unstyled: ${unstyled.join(', ') || 'none'})`);
  // 11-22: the shape of SB-18's readiness guard (`readinessmotiontest [112c-ready]`: every LOOPING animation in styles.css has a prefers-reduced-motion override), applied to THIS block —
  // and, stricter than that guard, to its one-shot fade-in too. Every selector in the block that declares an `animation:` other than none must have its OWN rule inside a reduce block
  // that sets `animation:none`; a looping (`infinite`) one must also hold a static opacity that is visibly mid-range (.5 to .9), never the dim end of the pulse.
  {
    const reduceBlocks = [...rules.matchAll(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/g)].map(m => m[1]);
    const reduceRules = reduceBlocks.flatMap(b => [...b.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] })));
    const outside = rules.replace(/@media[^{]*\{[\s\S]*?\n\}/g, '');
    const animated = [...outside.matchAll(/([^{}]+)\{([^{}]*\banimation:(?!none)[^;}]+)[;}]?[^{}]*\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] })).filter(r => !r.sel.startsWith('@'));
    const sels = animated.map(a => a.sel);
    assert(sels.length === 4 && ['.feed-item--enter', '.feed-skel-line', '.feed-skel-image', '.home-pill'].every(x => sels.includes(x)), `11-22a: the block declares exactly four animated selectors — the three originals plus the new-posts pill's entrance (D1 Lane B, DI-574) (${sels.join(', ')})`);
    const missing = animated.filter(a => !reduceRules.some(r => r.sel === a.sel && /animation:none/.test(r.body)));
    assert(missing.length === 0, `11-22b: SB-18 shape — every animated selector in the block has its OWN Reduce Motion rule setting animation:none (missing: ${missing.map(m => m.sel).join(', ') || 'none'})`);
    const looping = animated.filter(a => /\binfinite\b/.test(a.body));
    const holds = looping.every(a => { const r = reduceRules.find(x => x.sel === a.sel); const m = r && /opacity:(\.?\d*\.?\d+)/.exec(r.body); return !!m && Number(m[1]) >= 0.5 && Number(m[1]) <= 0.9; });
    assert(looping.length === 2 && holds, `11-22c: the ${looping.length} LOOPING selectors (${looping.map(l => l.sel).join(', ')}) hold a static, visible mid opacity (.5-.9) under Reduce Motion`);
    const enter = animated.find(a => a.sel === '.feed-item--enter');
    assert(!!enter && !/infinite/.test(enter.body) && reduceRules.some(r => r.sel === '.feed-item--enter' && r.body.trim() === 'animation:none'), '11-22d: the 150 ms card fade-in is NOT left running under Reduce Motion — its override is bare animation:none (no fade, no dimming: the content simply appears)');
    // the pin has teeth: strip each override from a scratch copy of the rules and the check above must go red
    const strip = (txt, sel) => txt.replace(new RegExp(`\\n  ${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{[^}]*\\}`), '');
    const lacks = (txt, sel) => !([...txt.matchAll(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/g)].flatMap(m => [...m[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(x => ({ sel: x[1].trim(), body: x[2] }))).some(r => r.sel === sel && /animation:none/.test(r.body)));
    assert(['.feed-item--enter', '.feed-skel-line', '.feed-skel-image'].every(sel => lacks(strip(rules, sel), sel) && !lacks(rules, sel)), '11-22e: the pin has teeth — removing any one of the three overrides from a scratch copy makes the check fail');
  }
  assert(/\.feed-card-text\{[^}]*display:flex;flex-direction:column;gap:8px/.test(rules) && /\.feed-nudge\{gap:16px;/.test(rules) && /\.feed-note\{gap:16px;/.test(rules) && /\.feed-now\{[^}]*gap:16px/.test(rules) && /\.feed-now-text\{[^}]*gap:8px/.test(rules),
    '11-23: BREATHING ROOM — every text-and-button card has the same two-level rhythm: an 8 pt text group (.feed-card-text / .feed-now-text) and a 16 pt gap before the button group (.feed-nudge, .feed-note, .feed-now), so the buttons sit 16 pt from the text and 16 pt from the card edge');
  const reduced = (CSS.match(/@media \(prefers-reduced-motion:reduce\)/g) || []).length;
  assert(reduced > 10, `11-21: the block sits among the file's own Reduce Motion rules (${reduced} such blocks)`);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[12] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file); each mutant must turn a NAMED check RED…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const URL_OF = (rel) => new URL(rel, import.meta.url).href;
async function loadMutant(rel, edits, rewrites = {}) {
  let src = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  for (const [a, b] of edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${a}`);
    src = src.split(a).join(b);
  }
  src = src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${rewrites[f] || URL_OF('./js/' + f)}'`);
  return { src, mod: await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64')) };
}
const ALL = async (mod) => ({
  ...depChecks(mod), ...(await nowChecks(mod)), ...(await snapChecks(mod)), ...(await chatChecks(mod)), ...mergeChecks(mod),
  ...(await paintChecks(mod)), ...(await asyncChecks(mod)), ...(await actionChecks(mod)), ...(await blindChecks(mod)),
});
/** A mutant of a module home.js IMPORTS (js/gameday.js …): the mutated source is loaded as a data: URL and home.js is re-loaded with its import rewritten to it. */
async function mutantOfDep(label, depFile, edits, mustFail) {
  let res;
  try {
    const dep = await loadMutant('./js/' + depFile, edits);
    const url = 'data:text/javascript;base64,' + Buffer.from(dep.src).toString('base64');
    const { mod } = await loadMutant('./js/home.js', [], { [depFile]: url });
    res = await ALL(mod);
  } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 120)]: false }; }
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every(m => failed.some(f => f.startsWith(m)));
  assert(failed.length > 0 && hit, `${label} → RED on: ${failed.slice(0, 4).map(f => f.slice(0, 80)).join(' | ') || '(nothing — the mutant SURVIVED)'}`);
  return failed;
}
async function mutantOf(label, edits, mustFail) {
  let res;
  try { const { mod } = await loadMutant('./js/home.js', edits); res = await ALL(mod); }
  catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 120)]: false }; }
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every(m => failed.some(f => f.startsWith(m)));
  assert(failed.length > 0 && hit, `${label} → RED on: ${failed.slice(0, 4).map(f => f.slice(0, 80)).join(' | ') || '(nothing — the mutant SURVIVED)'}`);
  return failed;
}
{
  const ctl = await ALL(home);
  assert(Object.values(ctl).every(v => v === true) && Object.keys(ctl).length > 150, `12-0: POSITIVE CONTROL — the unmutated module passes all ${Object.keys(ctl).length} named checks, so a red below is the mutation's doing`);

  // — S-C7: the content-withheld gate
  await mutantOf('12-1: M1 renderHome() no longer checks isContentWithheld() first (S-C7)', [["    if (withheld()) return false;                                            // S-C7 — FIRST, before any read or DOM touch\n", '']], ['P1 S-C7']);
  await mutantOf('12-2: M2 the belt before the DOM write is gone (a gate that flips during the build still paints)', [["    if (withheld()) return false;                                            // belt: re-check right before the write\n", '']], ['P2 S-C7 belt']);
  await mutantOf('12-3: M3 deriveCards is no longer handed the gate (DI-366: ALWAYS passed)', [['viewerIsCommissioner: isCommissioner, isContentWithheld: d.isContentWithheld });   // ALWAYS handed the gate', 'viewerIsCommissioner: isCommissioner });']], ['P3 deriveCards is ALWAYS handed the gate']);
  await mutantOf('12-4: M4 the withheld gate is never consulted at all (every layer: entry, belt, and the async re-check)', [["  const withheld = () => { try { return d.isContentWithheld() !== false; } catch { return true; } };", "  const withheld = () => false;"]], ['P1 S-C7', 'P2 S-C7 belt', 'A3 S-C7', 'A7b']);
  await mutantOf('12-5: M5 an async paint no longer re-checks the IDENTITY (RG-174/176)', [["    if (safeIdentity() !== identityAtStart) return false;\n    if (safeTab() !== HOME_TAB) return false;", '    if (safeTab() !== HOME_TAB) return false;']], ['A3b', 'A7 S-C7']);
  await mutantOf('12-6: M6 an async paint no longer re-checks the TAB', [["    if (safeTab() !== HOME_TAB) return false;\n    return true;", '    return true;']], ['A3c', 'A7c']);
  await mutantOf('12-7: M7 a news result is committed even though the identity moved while it was in flight', [["      if (safeIdentity() !== identityAtStart) { if (news.committedFor !== safeIdentity()) news = { status: 'idle', items: [], fetchedAt: 0 }; return; }\n", '']], ['A3b']);
  await mutantOf('12-8: M8 required dependencies are not enforced (isContentWithheld and friends)', [["    else if (typeof d[name] !== 'function') throw new TypeError(", "    else if (false) throw new TypeError("]], ['D1 isContentWithheld']);
  await mutantOf('12-9: M9 escHtml is not required at construction (S-C6)', [["    if (name === 'escHtml') requireEscHtml(d.escHtml, 'createHome');", "    if (name === 'escHtml') { /* mutated: not enforced */ }"]], ['D1 escHtml']);

  // — the Now card and its compact callback (S-C1, S-C3, S-C10)
  await mutantOf('12-10: M10 the Now card computes its own reveal answer: "public" is always true (the compact dashboard renders in OPEN / LOCKED)', [['  const isPublic = arePicksPublic(cur);                          // the ONE reveal question', '  const isPublic = true;']], ['N11 BLIND GATE', 'N2 draft', 'N3 open']);
  await mutantOf('12-11: M11 the viewer\'s own pick is "the first pick found" — another player\'s pick reaches the Now card (S-C3)', [['const p = asArray(picks).find(x => x && x.gameId === gameId && x.playerId === viewerId);', 'const p = asArray(picks).find(x => x && x.gameId === gameId);']], ['N6 locked, near kickoff']);
  await mutantOf('12-12: M12 the near-kickoff copy ignores "no viewer" (S-C3: no viewer, no team name)', [['      if (viewer) {\n        const team = ownPickTeam(picks, first.gameId, viewer);   // S-C3', '      if (true) {\n        const team = ownPickTeam(picks, first.gameId, viewer);   // S-C3']], ['N7 S-C3']);
  // (12-13 retired 2026-10-08 with the Live Peek's compact block — Drew D-58; the claim it protected is pinned on the new surfaces by gamedaytest / picksviewtest mutation proofs.)

  // — the snapshot (S-C2, S-C10, S-C11)
  await mutantOf('12-14: M14 S-C2 — the revealed view is the unfiltered league (a hidden week reaches the aggregates)', [['  const view = buildRevealedView({ weeks, games, picks, weeklyResults, confirmedStatusFor, includeDemo: isCommissioner === true });', '  const view = { revealedWeeks: weeks, revealedGames: games, revealedPicks: picks, revealedWeeklyResults: weeklyResults };']], ['S1 S-C2']);
  await mutantOf('12-15: M15 S-C10 — picksReadConfirmed is answered "true" without asking (RG-255)', [['    try { ok = d.picksReadConfirmed(w.weekId) === true; } catch { ok = false; }', '    ok = true;']], ['S2 S-C10']);
  await mutantOf('12-16: M16 counts — a member with no count is treated as zero instead of UNKNOWN (DI-T4.11)', [['      if (!entry) { unknown = true; break; }', '      if (!entry) continue;']], ['S3c']);
  await mutantOf('12-17: M17 counts — a public week in supabase mode trusts rows that have not landed', [['      const rowsHere = !supabase || mine || (isPublic && picksConfirmed[w.weekId] === true);', '      const rowsHere = !supabase || mine || isPublic;']], ['S3f']);
  await mutantOf('12-18: M18 S-C11 — a chat candidate without THIS league\'s stamp is kept', [["c.leagueId === leagueId);\n  out.scribe", "true);\n  out.scribe"]], ['S4 S-C11']);

  // — chat candidates (DI-372, security C2)
  await mutantOf('12-19: M19 S-C11 — the chat engine bound to another league still supplies candidates', [["    if (!bound) return empty;                                    // S-C11 — fail closed, never a stale league's messages\n", '']], ['C6 S-C11']);
  await mutantOf('12-20: M20 private rows (the push self-test, the private SCRIBE changelog) are no longer excluded', [["      if (priv) continue;\n", '']], ['C2 private rows']);
  await mutantOf('12-21: M21 SECURITY C2 — a SCRIBE post naming a week that is not public is no longer withheld', [["        if (named && (unresolved || namedWeeks.some(w => !arePicksPublic(w)))) continue; // security C2 / S1 — the blind-gated path, conjunctive\n", '']], ['C1b SECURITY C2']);
  // Since FB-013 the purpose allow-list ALSO keeps the wager kinds off Home, so removing the dedicated exclusion alone changes nothing. The belt still has to hold on
  // its own if the allow-list is ever widened: this mutant widens it to the wager kinds AND removes the exclusion — C3 must go red (with the exclusion in place it stays green).
  await mutantOf('12-22: M22 wager receipts are no longer excluded at the source (SD-6), under an allow-list widened to the wager kinds', [
    ["        if (isWagerReceipt(m)) continue;                         // note (c): a wager receipt carries user-typed claim text; DI-372 keeps those off Home\n", ''],
    ["export const HOME_SCRIBE_KINDS = Object.freeze(['lifecycle']);", "export const HOME_SCRIBE_KINDS = Object.freeze(['lifecycle', 'wagerLogged', 'wagerDue']);"]], ['C3']);
  {
    const { mod: widened } = await loadMutant('./js/home.js', [["export const HOME_SCRIBE_KINDS = Object.freeze(['lifecycle']);", "export const HOME_SCRIBE_KINDS = Object.freeze(['lifecycle', 'wagerLogged', 'wagerDue']);"]]);
    const r = await chatChecks(widened);
    const c3 = Object.keys(r).find(k => k.startsWith('C3'));
    assert(!!c3 && r[c3] === true, '12-22b: …CONTROL for M22 — the allow-list widened to the wager kinds but the dedicated exclusion IN PLACE: C3 stays green (the belt holds on its own)');
  }

  // — escaping at the sink (S-C6)
  await mutantOf('12-23: M23 a card title is interpolated RAW (no escHtml at the sink)', [["`<h3 class=\"feed-card-title\">${escHtml(copy.title)}</h3>`", "`<h3 class=\"feed-card-title\">${copy.title}</h3>`"]], ['P9 ESCAPING AT THE SINK', 'P9b']);
  await mutantOfDep('12-24: M24 Game Day\'s card message (the winner line) is interpolated RAW (no escHtml at the sink)', 'gameday.js', [["`<div class=\"gd-msg\"><div class=\"gd-tx\"><b>${escHtml(b.title || '')}</b>", "`<div class=\"gd-msg\"><div class=\"gd-tx\"><b>${b.title || ''}</b>"]], ['P9 ESCAPING AT THE SINK']);

  // — errors, no-op repaint, entrance
  await mutantOf('12-25: M25 a deriveCards failure is rethrown instead of becoming the calm error card', [["    } catch (e) { console.error('[home] deriveCards failed', e); feedError = true; }", "    } catch (e) { throw e; }"]], ['P4 deriveCards THROWS']);
  await mutantOf('12-26: M26 an identical repaint rewrites the DOM (a flash on every poll)', [["    if (painted && prev.mode === mode && prev.plain === plain) { if (model) afterPaint(el, model); return false; }     // identical: no DOM write, no flash, scroll untouched\n", '']], ['P6 an identical repaint', 'A1c']);

  // — pull-to-refresh (DI-368)
  await mutantOf('12-27: M27 pull-to-refresh no longer FORCES the news fetch (a pull would serve the cache)', [["      try { await loadNews({ force: true }); } catch { /* loadNews already recorded its own failure as the slot's calm error */ }", "      try { await loadNews({ force: false }); } catch { /* loadNews already recorded its own failure as the slot's calm error */ }"]], ['A6 pull-to-refresh']);

  // — the merge
  await mutantOf('12-28: M28 the Now card is no longer pinned first', [["  const out = [{ kind: 'now', key: 'now' }];", '  const out = [];']], ['M1 the Now card', 'M1b']);
  await mutantOf('12-29: M29 news density is 1 per 2 instead of 1 per 4 (the selection rule)', [['Math.floor(n / NEWS_PER_NON_NEWS)', 'Math.floor(n / 2)']], ['M5 density']);
  await mutantOf('12-30: M30 the 48-hour freshness filter is gone', [['    if (!Number.isFinite(ms) || ms > now + NEWS_FUTURE_SKEW_MS || now - ms > NEWS_FRESHNESS_MS) continue;', '    if (!Number.isFinite(ms) || ms > now + NEWS_FUTURE_SKEW_MS) continue;']], ['M6 48-hour']);
  // FB-010 (D1 batch H): the pre-fix merge, put back — cards grouped by week (newest week first, week-less cards joining it), news riding the newest group
  await mutantOf('12-31: M31 FB-010 the merge groups by WEEK again (the newest week\'s older cards and every week-less SCRIBE post above a game that just ended)', [
    ["export function mergeFeed({ now = Date.now(), cards = [], nudge = null,", "export function mergeFeed({ now = Date.now(), cards = [], weeks = [], nudge = null,"],
    [".map(c => ({ kind: 'card', key: c.id, card: c, t: String(c.sortKey ?? ''), tie: 0 })).sort(newestFirst).slice(0, FEED_CARD_CAP);",
      ".map(c => ({ kind: 'card', key: c.id, card: c, t: String(c.sortKey ?? ''), tie: 0, w: (c.weekId == null ? 0 : (new Map(sortWeeks(weeks).reverse().map((x, i) => [x.weekId, i])).get(c.weekId) ?? 1e9)) })).sort((a, b) => (a.w - b.w) || newestFirst(a, b)).slice(0, FEED_CARD_CAP);"],
    ['  timed.sort(newestFirst);\n', '  timed.sort((a, b) => ((a.w || 0) - (b.w || 0)) || newestFirst(a, b));\n']], ['M2b FB-010', 'M2c FB-010']);
  await mutantOf('12-32: M32 the card list is not capped', [[".sort(newestFirst).slice(0, FEED_CARD_CAP);", '.sort(newestFirst);']], ['M9 the card list is capped']);
  await mutantOf('12-56: M56 FB-010 news is no longer placed by its publish time (it sinks below every card, the "5 cards down" family)', [["t: newsTime(it), tie: 1", "t: '', tie: 1"]], ['M5 FB-010', 'M2c FB-010']);
  await mutantOf('12-57: M57 FB-013 the purpose filter is gone (every public SCRIBE post is mirrored into Home again)', [["        if (!allowed && !(gameTrigger && m.relayed === false)) continue;", '']], ['C13 FB-013', 'C13a', 'C13d']);
  await mutantOf('12-66: M66 D1 security 1 the server-minted gate is removed (a member-minted coverageFlip is admitted again)', [["if (!allowed && !(gameTrigger && m.relayed === false)) continue;", "if (!allowed && !gameTrigger) continue;"]], ['C15b', 'C15c', 'C15d', 'C15e']);
  await mutantOf('12-67: M67 D1 security 1 an ABSENT relayed field is read as "not relayed" (fails open before 0045)', [["!(gameTrigger && m.relayed === false)", "!(gameTrigger && m.relayed !== true)"]], ['C15c', 'C15d']);
  await mutantOf('12-68: M68 D1 security 1 the flag is read from meta, which any member can write', [["!(gameTrigger && m.relayed === false)", "!(gameTrigger && meta.relayed !== true)"]], ['C15b', 'C15c', 'C15d', 'C15e']);
  await mutantOf('12-69: M69 D1 security O1 the year.ago card is derived for every league again (the pilot gate is gone)', [["return pilotHistory() ? all : all.filter(c => !c || c.type !== 'year.ago');", "return all;"]], ['Y2', 'Y3', 'Y4']);   // (Y5 stays green on purpose: the detail builder is a SECOND layer, so removing Home's filter alone still leaves the other league's detail unavailable)
  await mutantOf('12-70: M70 D1 security O1 any truthy predicate answer admits the pilot history ("yes", 1)', [["return d.pilotHistoryAllowed ? d.pilotHistoryAllowed() === true : false;", "return d.pilotHistoryAllowed ? !!d.pilotHistoryAllowed() : false;"]], ['Y4']);
  await mutantOf('12-71: M71 D1 security O1 a missing predicate defaults the pilot history ON', [["return d.pilotHistoryAllowed ? d.pilotHistoryAllowed() === true : false;", "return d.pilotHistoryAllowed ? d.pilotHistoryAllowed() === true : true;"]], ['Y3']);
  await mutantOf('12-72: M72 D1 security O1 the detail is not told the answer (the pilot\'s own detail goes dark)', [["sportLabel: (sp) => competitionLabel(snapshot, sp), pilotHistory: pilotHistory(),", "sportLabel: (sp) => competitionLabel(snapshot, sp),"]], ['Y5']);
  await mutantOf('12-57b: M57b DI-578 any game-tagged SCRIBE line is admitted (a roast, an autonomous line, a reply)', [["typeof meta.trigger === 'string' && HOME_SCRIBE_GAME_TRIGGERS.includes(meta.trigger) && !isConversational(m)", 'true']], ['C14 DI-578']);
  await mutantOf('12-57c: M57c DI-578 a reply / mention naming a game is admitted', [["&& !isConversational(m));", ");"]], ['C14 DI-578']);
  await mutantOf('12-57d: M57d DI-578 every post about a game gets a card (no one-per-game rule)', [["      if (k === null) return true;\n      if (seenAbout.has(k)) return false;", "      if (k === null) return true;\n      if (false) return false;"]], ['C14b DI-578']);
  await mutantOf('12-58: M58 FB-013 every lifecycle notice passes (the obligation notices and the duplicates of Home\'s own cards reach the feed)', [["    if (!(typeof meta.event === 'string' && HOME_SCRIBE_LIFECYCLE_EVENTS.includes(meta.event))) return false;", "    if (false) return false;"]], ['C13 FB-013', 'C13a']);
  // — SECURITY F-2 (the 0045 review): each half of the lifecycle gate, and its wiring
  await mutantOf('12-73: M73 F-2 the id check is gone (a lock notice under any id, or another week\'s id, reaches Home)', [["    if (!isNonEmptyString(meta.weekId) || String(m.id ?? '') !== lifecycleIdOf(meta.event, meta.weekId)) return false;", "    if (!isNonEmptyString(meta.weekId)) return false;"]], ['C15g F-2: a lock notice under ANY other id']);
  await mutantOf('12-74: M74 F-2 the week check is gone (a lock notice for a ghost or OPEN week is admitted)', [["    return !!w && LIFECYCLE_LOCKED_STATUSES.includes(w.status);", "    return true;"]], ['C15g F-2: a lock notice for a week that is not']);
  await mutantOf('12-76: M76 P-10 the lock card renders the row\'s own body again (a member who wins the race writes what every Home shows)', [["          c = { ...c, body: fixed };", "          void fixed;"]], ['C15h P-10']);
  await mutantOf('12-75: M75 F-2 the candidate source no longer hands the gate this league\'s weeks (every lock notice fails closed: the positive controls go red)', [["        const allowed = isHomeScribePost(m, { weeks });", "        const allowed = isHomeScribePost(m);"]], ['C15g F-2 POSITIVE CONTROL', 'C13 FB-013']);
  await mutantOf('12-59: M59 FB-012 the summary describes only the first live game again', [['      if (live.length === 1) {', '      if (live.length >= 1) {']], ['L1 FB-012', 'L2 FB-012']);
  // (12-60 retired 2026-10-08 with the Live Peek's compact block — Drew D-58; the claim it protected is pinned on the new surfaces by gamedaytest / picksviewtest mutation proofs.)
  await mutantOf('12-65: M65 review note 4 — the compensation calls scrollBy itself with the options form only (no iOS 15.0 numeric fallback)',
    [["  return scrollWindow(win, { top: delta, left: 0, behavior: 'instant' });", "  try { win.scrollBy({ top: delta, left: 0, behavior: 'instant' }); return true; } catch { return false; }"]], ['P13g']);
  // (12-64 retired 2026-10-08 with the Live Peek's compact block — Drew D-58; the claim it protected is pinned on the new surfaces by gamedaytest / picksviewtest mutation proofs.)
  await mutantOf('12-61: M61 FB-022 a forged week id on View All is passed to the app unchecked (the DOM is untrusted)', [['          if (known) params.weekId = weekId;', '          params.weekId = weekId;']], ['I10b']);
  await mutantOf('12-62: M62 PM-110 #3 the reader\'s place is no longer kept (a card landing above the reader pushes what they are reading down the screen)', [['    keepReaderInPlace(el, anchor);', '    void anchor;']], ['P13f DI-574']);
  // (12-63 / 12-50 retired 2026-10-08: the live Now card's "See the full slate" button is gone with the Live Peek; the Dashboard button is the open card's footer — gdtest pins it.)
  await mutantOf('12-33: M33 the commissioner nudge is built for everyone', [['  if (isCommissioner !== true) return null;\n', '']], ['N14b']);
  // — interactions
  await mutantOf('12-34: M34 an unknown data-home-action is dispatched (the DOM is untrusted)', [["      if (!HOME_ACTIONS.includes(action)) return;\n", '']], ['I2 the DOM is untrusted']);
  // — DI-373's own instruction: thread a bit through the RENDER PATH that reveals an opponent's pick; the page-level suite must go red
  await mutantOf('12-36: M36 a leak threaded through Game Day\'s own-pick field: another player\'s pick is read for the viewer\'s row (the page-level blind check, not just the unit ones, must catch it)',
    [["ownTeam: isNonEmptyString(viewerId) ? ownPickTeam(s.picks, g.gameId, viewerId) : null,", "ownTeam: ((s.picks.find(p => p.gameId === g.gameId && p.playerId !== viewerId) || {}).selectedTeam) || null,"]],
    ['N11 BLIND GATE']);
  // (12-37 retired 2026-10-08: it threaded a rival's pick through the Locked line of the Now card MODEL, which Game Day no longer draws; the Locked card's model (js/gameday.js) holds no pick but the viewer's own by construction — gamedaytest serialises it.)
  // — the security conditions (B2, B3, S1, S2, W1)
  await mutantOf('12-39: M39 B2 — the gate FAILS OPEN: `=== true` plus `catch -> false` (undefined, a string, or a throw now paints)',
    [["const withheld = () => { try { return d.isContentWithheld() !== false; } catch { return true; } };", "const withheld = () => { try { return d.isContentWithheld() === true; } catch { return false; } };"]],
    ['P10 B2 S-C7 fail-closed', 'A8 B2', 'A8b B2']);
  await mutantOf('12-40: M40 B3 — build-slate no longer checks the role at dispatch (a forged control from a player fires a haptic and onAction)',
    [["      if (action === 'build-slate' && !viewerNow().isCommissioner) return;   // B3: the role is checked at DISPATCH, not trusted from the markup that rendered the button — before any haptic\n", '']],
    ['I9 B3', 'I9c B3']);
  await mutantOf('12-41: M41 S1 — the SCRIBE week gate is disjunctive again: meta.weekId overrides the week a gameTag / meta.gameId implies',
    [["  for (const gid of gameRefs) {", "  for (const gid of (weekRefs.length ? [] : gameRefs)) {"]],
    ['C1c S1', 'C1e']);
  await mutantOf('12-42: M42 S2 — Game Day\'s final card reads the UNRESTRICTED weeklyResults (a mirror that says final names a winner the server never confirmed)',
    [["const rows = asArray(s.revealedWeeklyResults).filter(r => r && r.weekId === cur.weekId);   // S2: the REVEALED view only\n", "const rows = asArray(s.weeklyResults).filter(r => r && r.weekId === cur.weekId);   // S2: the REVEALED view only\n"]],
    ['N15d S2']);
  await mutantOf('12-43: M43 W1 — a row with NO league stamp is accepted in supabase mode (no provenance)',
    [["  if (own === null && supabase) return null;                    // W1: supabase mode — no provenance, no candidate\n", '']],
    ['C11 W1', 'C12 W1 end to end']);
  await mutantOf('12-44: M44 W1 — another league\'s row is no longer dropped by the source (it is stamped with ITS league and handed on)',
    [["  if (own !== null && own !== leagueId) return null;            // W1: another league's row, whatever the channel says\n", '']],
    ['C11 W1', 'C11b W1']);
  await mutantOf('12-45: M45 W1 — the row is stamped with the REQUESTED league, not its own, and the source\'s own-league drop is gone (the pre-W1 behaviour: league A\'s rows wear league B)',
    [["  if (own !== null && own !== leagueId) return null;            // W1: another league's row, whatever the channel says\n", ''], ["    leagueId: own === null ? leagueId : own,", "    leagueId,"]],
    ['C11 W1', 'C12 W1 end to end']);
  // — the provenance switch fails closed (v0.29.0 batch-4 follow-up, security note on the Home renderer review, 2026-10-01)
  await mutantOf('12-53: M53 the switch\'s default is false again (a caller that omits `supabase` gets local mode: an unstamped row adopts the requested league)',
    [["timezone = 'PT', supabase = true } = {}) {", "timezone = 'PT', supabase = false } = {}) {"]],
    ['C11e FAIL-CLOSED', 'C11f FAIL-CLOSED']);
  await mutantOf('12-54: M54 the switch is read as `=== true` again (null / "false" / 0 / an object all become local mode)',
    [['    const strictProvenance = supabase !== false;', '    const strictProvenance = supabase === true;']],
    ['C11f FAIL-CLOSED']);
  await mutantOf('12-55: M55 the exact pre-fix code (default false AND `=== true`): both the missing and the non-boolean switch fail open',
    [["timezone = 'PT', supabase = true } = {}) {", "timezone = 'PT', supabase = false } = {}) {"], ['    const strictProvenance = supabase !== false;', '    const strictProvenance = supabase === true;']],
    ['C11e FAIL-CLOSED', 'C11f FAIL-CLOSED']);
  // — the merge conditions (reviewer BLOCK)
  await mutantOf('12-46: M46 Breathing Room — the nudge\'s label / title / body are no longer one text group (the buttons sit 8 pt from the text)',
    [["  return joinHtml([open, text, action, '</article>']);", "  return joinHtml([open, label, title, body, action, '</article>']);"]], ['P11 BREATHING ROOM']);
  await mutantOf('12-47: M47 the loading status is a keyed .feed-item again (a zero-height row in the 16 pt-gap column: the content shifts 16 pt when the skeleton is replaced)',
    [["  if (busy) parts.push('<p class=\"sr-only\" role=\"status\">Loading Home</p>');\n", ''], ["      const items = [];\n      for (let i = 0; i < SKELETON_CARD_COUNT; i++)", "      const items = [{ key: 'home-loading', html: '<p class=\"sr-only\" role=\"status\">Loading Home</p>' }];\n      for (let i = 0; i < SKELETON_CARD_COUNT; i++)"]], ['P8d NO LAYOUT SHIFT']);
  await mutantOf('12-48: M48 "You\'re all caught up." is appended after an error card',
    [["  if (!feedError) out.push({ kind: 'caught-up'", "  if (true) out.push({ kind: 'caught-up'"]], ['M10 a failed derivation']);
  await mutantOf('12-49: M49 the snapshot-failure path keeps the end marker',
    [["return { items: [{ key: 'home-error', html: errorCardHTML({ escHtml }) }], state: 'error', ordinaryKeys: [], heldCount: 0, hasMore: false }; }", "return { items: [{ key: 'home-error', html: errorCardHTML({ escHtml }) }, { key: 'caught-up', html: caughtUpHTML('caught-up') }], state: 'error', ordinaryKeys: [], heldCount: 0, hasMore: false }; }"]], ['P5 the snapshot cannot be assembled']);
  await mutantOf('12-51: M51 the nudge button\'s attribute is data-comm-tab again (RG-10\'s card-tagging attribute)',
    [["${a.commTab ? ` data-comm-target=\"${escHtml(a.commTab)}\"` : ''}", "${a.commTab ? ` data-comm-tab=\"${escHtml(a.commTab)}\"` : ''}"], ["const commTab = attr('data-comm-target');", "const commTab = attr('data-comm-tab');"]], ['I6 the commissioner nudge', 'I6c']);
  await mutantOf('12-52: M52 between seasons is 14 days again (the mid-December gap reads as "the last one")',
    [["export const BETWEEN_SEASONS_AFTER_MS = 28 * 24 * 60 * 60 * 1000;", "export const BETWEEN_SEASONS_AFTER_MS = 14 * 24 * 60 * 60 * 1000;"]], ['N13 between seasons', 'N13b', 'N13d']);
  await mutantOf('12-35: M35 an unknown tab is navigated to (admin, __proto__)', [["        if (!ACTION_TABS.includes(tab)) return;                              // validated BEFORE any haptic: a rejected tap is silent\n", '']], ['I2 the DOM is untrusted']);
}

console.log('\n══════════════════════════════════════════════════');
console.log(fail === 0 ? `✅ ALL PASS — ${pass} passed, ${fail} failed` : `❌ FAILURES — ${pass} passed, ${fail} failed`);
// Flush before exiting (the loadtest.mjs parent parses stdout+stderr): process.exit() does not drain a pipe.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
