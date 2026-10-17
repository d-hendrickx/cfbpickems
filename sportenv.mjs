/**
 * CFB Pickems — sportenv.mjs (D1 / v0.30.0, thread 100726-D1, Lane A)
 * ====================================================================
 * NOT A SUITE. The shared harness the multisport app-level suites run on (sportsurfacetest, sportstatetest, dashboardallsportstest, participationtest, sportopstest, leagueoverviewtest;
 * 2026-10-08: an earlier header named two suites that were never written, and one that scans source and does not use this file; sportsurfacetest [S-e] now checks every name here exists). It stubs the DOM exactly as far as layouttest.mjs does (page containers that keep their innerHTML, recorded listeners, a CLICKABLE parse
 * for the controls the suites press), freezes the clock, and builds a league with one sport or several in the local store so the REAL js/app.js renderers run end to end:
 *
 *     const env = await makeEnv();
 *     env.league({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] } });
 *     const html = env.render('picks');          // the page's emitted markup (window.navigateTo)
 *
 * Everything is local mode (pins), so the pointer's user is 'local' and the storage seam is the in-memory mirror over this file's localStorage. Nothing here touches a network.
 * The clock is frozen at NOW so a countdown, a lock time and "kicks off in" read the same in every tree this fixture is run against - which is what lets a single-sport render be hashed here
 * and compared with the same render of the unmodified v0.29.0 code (the GOLDEN tests).
 */

export const NOW = Date.parse('2026-10-08T15:00:00.000Z');

// ── the frozen clock ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const RealDate = Date;
class FrozenDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(NOW); else super(...a); }
  static now() { return NOW; }
}
globalThis.Date = FrozenDate;

// ── the DOM stub ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

/** The buttons a suite presses, parsed out of a page's markup (so the REAL binder's listener is the one that runs). */
const CLICKABLE_ATTR = /\bclass="([^"]*)"/;
function parseButtons(html) {
  const out = [];
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
    const attrs = m[1];
    const dataset = {};
    for (const a of attrs.matchAll(/data-([a-zA-Z-]+)="([^"]*)"/g)) dataset[a[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a[2];
    const handlers = {};
    const attr = (n) => { const r = new RegExp('(?:^|\\s)' + n + '="([^"]*)"').exec(attrs); return r ? r[1] : null; };
    out.push({
      dataset, id: attr('id'), className: (CLICKABLE_ATTR.exec(attrs) || [])[1] || '', text: m[2].replace(/<[^>]*>/g, ''), disabled: /\bdisabled\b/.test(attrs),
      getAttribute: attr, setAttribute() {}, removeAttribute() {}, focus() {}, scrollIntoView() {}, closest() { return null; },
      classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
      addEventListener(t, fn) { (handlers[t] ||= []).push(fn); },
      removeEventListener(t, fn) { if (handlers[t]) handlers[t] = handlers[t].filter((h) => h !== fn); },
      listenerCount: (t = 'click') => (handlers[t] || []).length,
      click() { (handlers.click || []).slice().forEach((fn) => fn({ target: this, preventDefault() {}, stopPropagation() {} })); },
    });
  }
  return out;
}

export const els = new Map();
function mkEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: { setProperty() {}, removeProperty() {} }, _buttons: null, attrs: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); this._buttons = null; },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; this._buttons = null; },
    appendChild() {}, remove() { if (this.id && els.get(this.id) === this) els.delete(this.id); }, focus() {}, scrollTo() {}, scrollIntoView() {}, closest: () => null,
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }, removeAttribute(k) { delete this.attrs[k]; },
    _listeners: null,
    addEventListener(type, fn) { ((this._listeners ||= {})[type] ||= []).push(fn); },
    removeEventListener(type, fn) { if (this._listeners?.[type]) this._listeners[type] = this._listeners[type].filter((h) => h !== fn); },
    _fire(type, ev) { (this._listeners?.[type] || []).slice().forEach((fn) => fn(ev)); },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 320, height: 600, bottom: 600, right: 320 }),
    querySelector(sel) {
      if (sel === '#picks-head-slot' && this._html.includes('<div id="picks-head-slot"></div>')) {
        const host = this;
        return { get outerHTML() { return '<div id="picks-head-slot"></div>'; }, set outerHTML(h) { host._html = host._html.replace('<div id="picks-head-slot"></div>', h); host._buttons = null; } };
      }
      const m = /^#([\w-]+)$/.exec(sel);
      if (m) return this.buttons().find((b) => b.id === m[1]) || null;
      return null;
    },
    buttons() { if (!this._buttons) this._buttons = parseButtons(this._html); return this._buttons; },
    querySelectorAll(sel) {
      const cls = /^\.([\w-]+)$/.exec(sel);
      if (cls) return this.buttons().filter((b) => b.className.split(/\s+/).includes(cls[1]));
      const data = /^\[data-([\w-]+)\]$/.exec(sel);
      if (data) { const key = data[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()); return this.buttons().filter((b) => key in b.dataset); }
      return [];
    },
  };
  els.set(id, e);
  return e;
}
const PAGES = ['page-home', 'page-picks', 'games-list', 'page-dashboard', 'submitted-games', 'page-leaderboard', 'page-chat', 'page-rules', 'page-commissioner', 'header-meta-week', 'header-meta', 'league-pill', 'toast-container'];
PAGES.forEach(mkEl);

function fakeClassList() {
  const set = new Set();
  return { add: (c) => set.add(c), remove: (c) => set.delete(c), toggle: (c, on) => (on ? set.add(c) : set.delete(c)), contains: (c) => set.has(c), [Symbol.iterator]: () => set[Symbol.iterator]() };
}
const bodyChildren = [];
// OPT-IN (D1 third pass, P-2): a suite that must PRESS a control bound with document.querySelectorAll('… [data-action="x"]') turns this on, so the REAL binder attaches its listener to the
// page's parsed button and the press runs the real handler. Off by default: every other suite on this harness sees the document return [] exactly as before.
let docActions = false;
export function enableDocumentActions(on) { docActions = !!on; }
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: (id) => els.get(id) || null,
  querySelector: () => null,
  // the identity chokepoint sweeps every body-appended surface that carries data-hold-teardown (a sheet the previous identity opened must not survive into the next)
  querySelectorAll: (sel) => {
    if (sel === '[data-hold-teardown]') return [...els.values()].filter((e) => e.attrs && 'data-hold-teardown' in e.attrs);
    const act = docActions ? /\[data-action="([\w-]+)"\]$/.exec(sel) : null;
    if (act) return [...els.values()].flatMap((e) => (e._html && typeof e.buttons === 'function' ? e.buttons() : [])).filter((b) => b.dataset.action === act[1]);
    return [];
  },
  createElement: () => mkEl('tmp-' + els.size),
  body: { classList: fakeClassList(), dataset: {}, style: {}, setAttribute() {}, removeAttribute() {}, getAttribute: () => null, appendChild(el) { bodyChildren.push(el); if (el && el.id) els.set(el.id, el); }, innerHTML: '', get lastChild() { return bodyChildren[bodyChildren.length - 1] || null; } },
  hidden: false,
};
globalThis.window = globalThis;
globalThis.scrollY = 0;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in sportenv'); };

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

/**
 * An IN-MEMORY mutant of a module under js/ (never a file on disk, so there is nothing to restore and no git hazard): the source with each [from, to] edit applied (each anchor must match
 * EXACTLY once) and every relative import rewritten to the absolute file URL the real tree resolves to, so the mutant shares the real storage / auth / competition instances. Importing a mutant
 * app.js re-assigns `window.navigateTo`; `withMutantApp` puts the real one back.
 */
export async function loadMutant(rel, edits) {
  let src = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  for (const [a, b] of edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${a.slice(0, 90)}`);
    src = src.split(a).join(b);
  }
  const dir = new URL(rel, import.meta.url);
  src = src.replace(/(from\s+|import\()\s*'(\.{1,2}\/[\w.\/-]+)'/g, (_m, pre, f) => `${pre}'${new URL(f, dir).href}'`);
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}
export async function withMutantApp(edits, fn) {
  const real = globalThis.navigateTo;
  try {
    const m = await loadMutant('./js/app.js', edits);
    return await fn(m);
  } finally { globalThis.navigateTo = real; globalThis.window.navigateTo = real; }
}

export const PAGE_OF = { picks: 'page-picks', dashboard: 'page-dashboard', leaderboard: 'page-leaderboard', standings: 'page-leaderboard', home: 'page-home' };

// ── the league builder ───────────────────────────────────────────────────────────────────────────────────────────────────────────
export const LEAGUE = 'L-test-0001';
export const CID = { cfb: '11111111-1111-4111-8111-111111111111', nfl: '22222222-2222-4222-8222-222222222222', nhl: '33333333-3333-4333-8333-333333333333' };
const SPORT_ORDER = ['cfb', 'nfl', 'nhl'];
const HOUR = 3600_000;

/** A game record shaped like createGame()'s, with every field the renderers read. `at` is hours from NOW (negative = already kicked off). */
export function mkGame(weekId, id, home, away, at, extra = {}) {
  return {
    gameId: `${weekId}_${id}`, weekId, espnEventId: null, dataQuality: 'manual', dataSource: 'manual',
    homeTeam: home, awayTeam: away, homeConference: 'SEC', awayConference: 'SEC', homeRank: null, awayRank: null,
    kickoff: new RealDate(NOW + at * HOUR).toISOString(), kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening',
    spread: -3.5, favorite: home, lockedSpread: null, homeScore: null, awayScore: null, status: 'scheduled',
    actualWinner: null, atsWinner: null, isAlmaMaterGame: false, spreadSource: 'manual', oddsProvider: null, lastUpdated: null,
    venue: null, venueDisplay: null, neutralSite: false, multiplier: 1, ...extra,
  };
}
export const mkWeek = (weekId, weekNumber, status, extra = {}) => ({
  weekId, weekNumber, season: 2026, name: `Week ${weekNumber}`, status, dataSourceMode: 'live', startDate: '2026-10-08', endDate: '2026-10-12',
  picksOpenAt: null, picksLockAt: null, tiebreakerQuestion: 'Total points?', actualTiebreakerValue: null, showInHistory: true, blurb: '',
  extraPointEnabled: false, extraPointActual: null, extraPointDetect: null, ...extra,
});

/**
 * The default fixture. `sports` is the list of sports the league runs (one entry = a one-sport league with NO competition rows when `rows:false`, or with one row when `rows:true`).
 * Per sport: a FINAL week 1 (graded, with results and picks) and an OPEN week 2 whose games kick off tomorrow, named after the sport so a leak is visible in the markup
 * ("CFB-open-home", "NFL-open-away"). `submitted` lists the members who have submitted their week-2 picks in every sport they play. `plays` maps a sport to the player ids enrolled in it (opt_in sports); a sport absent from `plays` enrolls everyone ('all').
 */
export async function makeEnv() { return buildEnv(); }

async function buildEnv() {
  const st = await import('./js/storage.js');
  const auth = await import('./js/auth.js');
  const comp = await import('./js/competition.js');
  const app = await import('./js/app.js');
  st.setBackendMode('local');

  const put = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const PLAYERS = [
    { playerId: 'p1', displayName: 'Drew', initials: 'DH', active: true, pin: '1111', preferences: {} },
    { playerId: 'p2', displayName: 'Brayden', initials: 'BR', active: true, pin: '2222', preferences: {} },
    { playerId: 'p3', displayName: 'Kevin', initials: 'KC', active: true, pin: '3333', preferences: {} },
    { playerId: 'p4', displayName: 'Koby', initials: 'KR', active: true, pin: '4444', preferences: {} },
  ];

  /** Rebuilds the whole local store for one scenario. */
  function league({ sports = ['cfb'], rows = true, viewer = 'p1', isAdmin = false, plays = {}, weekStatus = {}, finals = true, extraWeeks = [], leagueId = LEAGUE, joinedAt = '2026-09-01T00:00:00.000Z', lockOffsetHours = 24, submitted = [] } = {}) {
    store.clear();
    auth._resetAuthForTest();
    localStorage.setItem('cfbp_supabase_active_league', leagueId);
    for (const e of els.values()) { e._html = ''; e._buttons = null; }
    bodyChildren.length = 0;
    const comps = [], members = [], weeks = [], games = [], picks = [], results = [];
    sports.forEach((sp, i) => {
      const cid = CID[sp];
      const optIn = Object.prototype.hasOwnProperty.call(plays, sp);
      comps.push({ id: cid, sport: sp, kind: 'season', enrollment: optIn ? 'opt_in' : 'all', isDefault: i === 0, archivedAt: null, activeWeekId: null, settings: {}, createdAt: `2026-0${i + 1}-01T00:00:00.000Z` });
      if (optIn) for (const m of plays[sp]) members.push({ id: `${cid}:${m}`, competitionId: cid, memberId: m, enrolledBy: 'self', joinedAt });
      const tag = sp.toUpperCase();
      const w1 = `w_${sp}_1`, w2 = `w_${sp}_2`;
      const cidField = rows ? { competitionId: i === 0 ? undefined : cid } : {};
      const wk1 = mkWeek(w1, 1, 'final', { blurb: `${tag}-final-blurb`, ...cidField });
      const wk2 = mkWeek(w2, 2, weekStatus[sp] || 'open', { blurb: `${tag}-open-blurb`, ...cidField });
      weeks.push(wk1, wk2);
      const g1 = mkGame(w1, 'g1', `${tag}-final-home`, `${tag}-final-away`, -200, { status: 'final', homeScore: 28, awayScore: 21, actualWinner: `${tag}-final-home`, atsWinner: `${tag}-final-home`, lastUpdated: new RealDate(NOW - 190 * HOUR).toISOString() });
      const g2 = mkGame(w2, 'g1', `${tag}-open-home`, `${tag}-open-away`, lockOffsetHours + 1);
      const g3 = mkGame(w2, 'g2', `${tag}-open-home2`, `${tag}-open-away2`, lockOffsetHours + 4);
      games.push(g1, g2, g3);
      const entrants = optIn ? plays[sp] : PLAYERS.map((p) => p.playerId);
      for (const m of submitted) {
        if (!entrants.includes(m)) continue;     // a non-entrant has no pick row (the A3 test adds a stray one by hand)
        for (const g of [g2, g3]) picks.push({ pickId: `pk_${g.gameId}_${m}`, weekId: w2, gameId: g.gameId, playerId: m, selectedTeam: g.homeTeam, submittedAt: '2026-10-07T00:00:00.000Z' });
      }
      if (finals) {
        for (const m of entrants) {
          const home = m === 'p1' || m === 'p3';
          picks.push({ pickId: `pk_${w1}_${m}`, weekId: w1, gameId: g1.gameId, playerId: m, selectedTeam: home ? g1.homeTeam : g1.awayTeam, submittedAt: '2026-10-01T00:00:00.000Z' });
          results.push({ weekId: w1, playerId: m, rank: home ? 1 : 3, correctPicks: home ? 1 : 0, incorrectPicks: home ? 0 : 1, correctCount: home ? 1 : 0, incorrectCount: home ? 0 : 1, noDecisions: 0, isWinner: m === 'p1', isLoser: m === 'p2' });
        }
      }
    });
    // the default competition's weeks carry no competitionId (the pre-backfill shape); a second sport's carry theirs
    put('cfbp_competitions', rows ? comps : []);
    put('cfbp_competition_members', members);
    put('cfbp_players', PLAYERS);
    put('cfbp_weeks', [...weeks, ...extraWeeks].map((w) => { const c = { ...w }; if (c.competitionId === undefined) delete c.competitionId; return c; }));
    put('cfbp_games', games);
    put('cfbp_picks', picks);
    put('cfbp_weekly_results', results);
    put('cfbp_session', { playerId: viewer, isAdmin, playerVerified: !!viewer });
    put('cfbp_active_week', `w_${sports[0]}_2`);
    return { comps, members, weeks, games, picks, results };
  }

  /** Renders a tab through the REAL entry point and returns the page's markup. */
  function render(tab) {
    const page = els.get(PAGE_OF[tab] || `page-${tab}`);
    page._html = ''; page._buttons = null;
    window.navigateTo(tab);
    return page._html;
  }
  /** Picks writes its game cards into two child containers (#games-list while drafting, #submitted-games once submitted); this is the page PLUS those, for content checks. Goldens hash render() alone. */
  function renderFull(tab) {
    const html = render(tab);
    return tab === 'picks' ? html + (els.get('games-list')?._html || '') + (els.get('submitted-games')?._html || '') : html;
  }
  const page = (tab) => els.get(PAGE_OF[tab] || `page-${tab}`);
  const lsGet = (k) => { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; };
  return { st, auth, comp, app, league, render, renderFull, page, put, lsGet, els, store, NOW, PLAYERS, bodyChildren, RealDate };
}

