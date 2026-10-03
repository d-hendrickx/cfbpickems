/**
 * CFB Pickems — pickheadertest.mjs
 * ================================
 * Bug SB-25 (Social Platform thread, v0.29.0; found by the Breathing Room
 * spacing-sweep reviewer, 2026-10-01; predates the sweep): in the Picks game
 * card's header the two header groups — kickoff time + alma/multiplier/league/
 * source badges on the left, lock + result / live-ATS badges on the right —
 * TOUCH at 0 pt, and the result badge (e.g. "❌ Wrong") is CLIPPED off the
 * card. Reported in two cases:
 *   - an alma badge, a lock badge and a result badge together, 375 pt wide,
 *     1.35x text;
 *   - 320 pt wide at 1x text.
 *
 * The rule (docs/# iOS App Polish & Design Philosophy.md, "Breathing Room";
 * Accessibility: "Respect Dynamic Type"):
 *   - the two header groups never touch: >= 8 pt between them;
 *   - nothing is clipped;
 *   - groups wrap gracefully at small widths and large text, and a stack keeps
 *     its gap.
 *
 * REPRODUCTION (95a16c3, this file's first commit, red): 63 passed / 168 failed
 * offline; with PICKHEADERTEST_WEBFONTS=1 (Oswald loaded) 64 / 168. With Oswald,
 * alma + lock + "❌ Wrong" at 375 wide / 1.35x: the groups 0 pt apart, "Alma /
 * Mater" and "❌ / Wrong" each broken onto two lines (header 70.5 px tall); at
 * 320 / 1x the alma + 2x + source + lock card is clipped 6.4 px by the card edge,
 * and the stress cards 95–130 px.
 *
 * ROOT CAUSE. `.game-card-header` was ONE single-line flex row
 * (justify-content:space-between, no flex-wrap, no gap) holding two single-line
 * `.flex.gap-sm` groups. When the two groups' content is wider than the header:
 * space-between has no free space left to hand out, so the groups abut at 0 pt;
 * flex-shrink then squeezes every pill to its min-content width (the labels
 * break); and once every pill is at min-content the row simply overflows to the
 * right, where `.game-card{overflow:hidden}` cuts off the rightmost item — the
 * result / live badge. Nothing in the row was ever allowed to wrap. The fix is
 * at that layer: the header and both groups wrap, with gaps from the containers
 * (css/styles.css, "SB-25").
 *
 * ENGINE-MEASURED. A real Chromium lays out the REAL css/styles.css against the
 * REAL markup js/app.js's renderGameCard() emits (the Picks page's only card
 * renderer — draft view and submitted view both). Every claim below is a
 * measured distance, never a source grep.
 *
 * WHAT THIS FILE ASSERTS
 *   [1] Fixture integrity — 20 cards from the real renderer cover every badge
 *       combination the header can show: alma x lock x {nothing, live
 *       covering, live trailing, correct, wrong, no decision}, the draft view
 *       open and locked, and stress cards that add the multiplier chip, the
 *       league chip, a source badge and the long "Time TBD" kickoff. TV: the
 *       National TV badge is a Commissioner Games-tab badge; the Picks card
 *       never renders it, even for a nationalTV game — [1] pins that, so the
 *       TV combination is covered by construction.
 *   [2] Geometry — 320 / 375 / 430 wide x 1x / 1.35x / 2x text x light / dark
 *       x two sheets: the release sheet, and the release sheet with the
 *       spacing sweep's deltas overlaid (feat/spacing-sweep: `.gap-sm` 6 -> 8,
 *       phone `.card` padding 12 -> 16). Per configuration, over every card:
 *         P1 nothing clipped: every header item sits inside the header's
 *            content box (so inside the card, and off its edge);
 *         P2 the two groups never touch: >= 16 pt apart, side by side AND
 *            stacked (Breathing Room: 16 between groups; the stack keeps its
 *            gap — review BLOCK #1, B1);
 *         P3 items inside a group stay >= 8 pt apart on both axes;
 *         P4 no badge breaks its own label across two lines;
 *         P5 an empty status group takes no space (no stray blank line);
 *         P6 wrapped lines stay anchored: the left group's lines start at the
 *            content box's left edge, the status group's lines end at its
 *            right edge (the status column stays where the eye looks for it);
 *         P7 the 44 pt touch targets survive (every button on a card);
 *         P8 16 pt from the card edge: every header item AND every pick button
 *            sits >= 16 pt in from the card's inner (border) edge, left and
 *            right, measured from the card itself — P1 measures against the
 *            header's padding box and cannot see the padding's size (review
 *            BLOCK #1, B2: header and body padding 14 -> 16).
 *   [3] The two reported cases, named explicitly.
 *   [4] Mutants (anti-vacuity): each piece of the fix removed from an IN-MEMORY
 *       copy of the sheet or markup (the files are never touched), measured by
 *       the same verdicts() — each must turn its detector red. M10 is the exact
 *       pre-fix code; M3a is the pre-review shape (8 pt once stacked); M11-M13
 *       put the 14 px padding back (both, body only, header only) and must be
 *       caught by P8 on the right element.
 *   [5] Source guards: the new rules exist once and carry no colour; no header
 *       group carries `.flex`/`.gap-sm`; an open draft card's status group is
 *       truly empty (what `:empty` needs).
 *
 * FONTS. The browser is launched with all network resolution blocked, so
 * styles.css's Google Fonts @import never loads and every run lays out with
 * the same local fallback faces (wider than Oswald, so conservative). The
 * assertions are distances and relations, not absolute widths. Set
 * PICKHEADERTEST_WEBFONTS=1 to allow the network and REQUIRE Oswald to load
 * (the shellrendertest.mjs precedent) — a manual, device-like check, never
 * what loadtest runs. Only a device confirms the final pixels.
 *
 * Run:  node pickheadertest.mjs     (spawned by loadtest.mjs [138])
 * Override the browser: PICKHEADERTEST_ENGINE=/path/to/Chromium (falls back to
 * NAVTEST_ENGINE, then the usual /Applications paths). A missing browser is a
 * FAILURE, never a skip.
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ── Node-side stubs: just enough DOM for the real render functions ───────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
function mkEl(id) {
  return {
    id, _html: '', dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null, setAttribute() {}, getAttribute: () => null,
  };
}
const els = new Map();
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => { if (!els.has(id)) els.set(id, mkEl(id)); return els.get(id); },
  querySelector: () => null, querySelectorAll: () => [], createElement: () => mkEl('x'),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' }, hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollTo = () => {};
const REAL_FETCH = globalThis.fetch;                       // the DevTools endpoint is plain HTTP on localhost
globalThis.fetch = async () => { throw new Error('network disabled in pickheadertest'); };

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] pickheadertest.mjs — SB-25: the Picks game-card header (Breathing Room, engine-measured)\n`);

const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const { PICK_RESULT } = await import('./js/data-model.js');

// ── [0] Engine ───────────────────────────────────────────────────────────────
console.log('[0] Engine…');
const ENGINES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
];
const override = process.env.PICKHEADERTEST_ENGINE || process.env.NAVTEST_ENGINE;
const bin = override || ENGINES.find(p => existsSync(p));
assert(!!bin && existsSync(bin), !bin
  ? `NO CHROMIUM-FAMILY BROWSER FOUND. Fix: PICKHEADERTEST_ENGINE=/path/to/Chromium node pickheadertest.mjs. A missing browser is a FAILURE, never a skip. Looked for: ${ENGINES.join(', ')}`
  : `engine to measure in: ${bin}${override ? ' (from env)' : ''}`);
assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');
const WEBFONTS = process.env.PICKHEADERTEST_WEBFONTS === '1';
console.log(WEBFONTS
  ? '  (PICKHEADERTEST_WEBFONTS=1 — network allowed, Oswald REQUIRED to load)'
  : '  (network blocked — deterministic local fallback fonts; set PICKHEADERTEST_WEBFONTS=1 to measure with Oswald)');

// ── Fixture cards (real storage, real renderer) ──────────────────────────────
storage.setBackendMode('local');
const KICK = '2026-10-03T19:30:00Z';                        // a Saturday
const HOME = 'Texas A&M', AWAY = 'Alabama';                // the viewer picked HOME on every card
const mkGame = (id, over = {}) => ({
  gameId: 'sb25_' + id, weekId: 'w_sb25', espnEventId: null, dataQuality: 'espn_live', dataSource: 'espn_live',
  homeTeam: HOME, awayTeam: AWAY, homeConference: 'SEC', awayConference: 'SEC', homeRank: null, awayRank: null,
  kickoff: KICK, kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening',
  spread: -3.5, favorite: HOME, lockedSpread: -3.5, homeScore: null, awayScore: null, status: 'scheduled',
  actualWinner: null, atsWinner: null, isAlmaMaterGame: false, spreadSource: 'espn', oddsProvider: null, lastUpdated: null,
  venue: null, venueDisplay: null, neutralSite: false, multiplier: 1,
  nationalTV: true, broadcastNetwork: 'ESPN',              // TV on every card: [1] proves the Picks header never shows it
  ...over,
});
// The six things the right-hand group can say on a submitted card.
const OUTCOMES = {
  pending:  { game: {},                                                                                    result: PICK_RESULT.PENDING },
  liveCov:  { game: { status: 'live', homeScore: 21, awayScore: 10 },                                      result: PICK_RESULT.LIVE },
  liveTrl:  { game: { status: 'live', homeScore: 10, awayScore: 21 },                                      result: PICK_RESULT.LIVE },
  win:      { game: { status: 'final', homeScore: 28, awayScore: 14, actualWinner: HOME, atsWinner: HOME }, result: PICK_RESULT.WIN },
  loss:     { game: { status: 'final', homeScore: 14, awayScore: 28, actualWinner: AWAY, atsWinner: AWAY }, result: PICK_RESULT.LOSS },
  nd:       { game: { status: 'final', lockedSpread: -3, spread: -3, homeScore: 20, awayScore: 17, actualWinner: HOME, atsWinner: 'no_decision' }, result: PICK_RESULT.NO_DECISION },
};
const STRESS = { isAlmaMaterGame: true, multiplier: 2, dataSource: 'espn_historical', kickoffConfirmed: false };  // "Sat 10/3 · Time TBD"
const CARDS = [];                                            // { id, html, expect: {alma, lock, live, result, mult, league, dq, tbd} }
function add(id, game, pickedTeam, result, isLocked, showResult) {
  const g = mkGame(id, game);
  CARDS.push({ id: g.gameId, game: g, html: app.renderGameCard(g, pickedTeam, result, isLocked, showResult) });
}
// Draft view (showResult false): alma x lock, plus the stress set open and locked.
add('d_plain_open', {}, HOME, PICK_RESULT.PENDING, false, false);
add('d_plain_lock', {}, HOME, PICK_RESULT.PENDING, true, false);
add('d_alma_open', { isAlmaMaterGame: true }, HOME, PICK_RESULT.PENDING, false, false);
add('d_alma_lock', { isAlmaMaterGame: true }, HOME, PICK_RESULT.PENDING, true, false);
add('d_stress_open', STRESS, HOME, PICK_RESULT.PENDING, false, false);
add('d_stress_lock', STRESS, HOME, PICK_RESULT.PENDING, true, false);
// Submitted view (showResult true; renderSubmittedView() always passes isLocked true): alma x every outcome.
for (const alma of [false, true]) {
  for (const [k, o] of Object.entries(OUTCOMES)) add(`s_${alma ? 'alma' : 'plain'}_${k}`, { ...o.game, isAlmaMaterGame: alma }, HOME, o.result, true, true);
}
// Stress: every left-hand chip at once against the longest right-hand label, and against a live badge.
add('s_stress_nd', { ...OUTCOMES.nd.game, ...STRESS, isManual: true, leagueLabel: 'NFL', dataSource: 'partial' }, HOME, PICK_RESULT.NO_DECISION, true, true);
add('s_stress_live', { ...OUTCOMES.liveTrl.game, ...STRESS, multiplier: 3, dataSource: 'proposed' }, HOME, PICK_RESULT.LIVE, true, true);
const byId = id => CARDS.find(c => c.id === 'sb25_' + id);

// ── [1] Fixture integrity ────────────────────────────────────────────────────
console.log('\n[1] Fixture integrity — the real renderer emits every badge combination the header can show…');
const hdrOf = html => { const i = html.indexOf('class="game-card-header"'); return i < 0 ? '' : html.slice(i, html.indexOf('class="game-card-body"')); };
const has = (c, re) => re.test(hdrOf(c.html));
const RE = {
  alma: /class="alma-mater-badge"/, lock: /class="badge badge-locked"/, cover: /badge-live-covering/, trail: /badge-live-trailing/,
  win: /class="badge badge-win">✅ Correct/, loss: /class="badge badge-loss">❌ Wrong/, nd: /class="badge badge-nd">— No Decision/,
  mult: /class="mult-badge"/, league: /class="league-chip"/, dq: /class="dq-badge /, tbd: /Time TBD/,
};
assert(CARDS.length === 20 && CARDS.every(c => hdrOf(c.html)), `[1a] ${CARDS.length} cards rendered by app.renderGameCard(), each with a .game-card-header (need 20)`);
assert(['plain', 'alma'].every(a => ['win', 'loss', 'nd'].every(k => has(byId(`s_${a}_${k}`), RE[k]) && has(byId(`s_${a}_${k}`), RE.lock)))
  && has(byId('s_alma_loss'), RE.alma) && !has(byId('s_plain_loss'), RE.alma),
  '[1b] submitted FINAL cards carry the lock badge and their result badge (Correct / Wrong / No Decision); the alma variant adds the alma badge (the SB-25 trio)');
assert(['plain', 'alma'].every(a => has(byId(`s_${a}_liveCov`), RE.cover) && has(byId(`s_${a}_liveTrl`), RE.trail) && has(byId(`s_${a}_liveCov`), RE.lock)),
  '[1c] submitted LIVE cards carry the lock badge and the live ATS badge ("⚡ Covering" / "⚡ Trailing")');
assert(has(byId('d_plain_lock'), RE.lock) && !has(byId('d_plain_open'), RE.lock) && has(byId('d_alma_open'), RE.alma) && !['d_plain_open', 'd_alma_open', 'd_stress_open'].some(id => /class="badge /.test(hdrOf(byId(id).html))),
  '[1d] draft view: an open card has no right-hand badge at all (its status group is empty); a locked one shows only 🔒');
assert(['d_stress_open', 'd_stress_lock', 's_stress_nd', 's_stress_live'].every(id => has(byId(id), RE.mult) && has(byId(id), RE.dq) && has(byId(id), RE.tbd) && has(byId(id), RE.alma))
  && has(byId('s_stress_nd'), RE.league) && has(byId('s_stress_nd'), RE.nd) && has(byId('s_stress_live'), RE.trail),
  '[1e] stress cards: alma + multiplier + source badge + "Time TBD" kickoff (+ the league chip against "— No Decision"; a 3x live-trailing card)');
assert(CARDS.every(c => c.game.nationalTV) && CARDS.every(c => !/national-tv-badge|ESPN<\/span>/.test(c.html)),
  '[1f] TV: every fixture game is a nationalTV game, and no Picks card renders the National TV badge (it is a Commissioner Games-tab badge) — the TV combination is covered by construction');
assert(CARDS.every(c => { const h = hdrOf(c.html); return (h.match(/<div/g) || []).length === 3; }),
  '[1g] every header holds exactly two groups (left: time + chips; right: lock + result / live)');

// ── Page builders ────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-pickheader-'));
const CSS_HREF = 'file://' + here + 'css/styles.css';
const NOANIM = '<style>*,*::before,*::after{animation:none!important;transition:none!important}</style>';
const MODES = [
  { name: 'light', attrs: 'class="theme-neutral" data-color-scheme="light"' },
  { name: 'dark', attrs: 'class="theme-neutral" data-color-scheme="dark"' },
];
// feat/spacing-sweep's deltas that can reach this page (5741b05/7077da8): `.gap-sm` 6 -> 8 and the
// phone `.card` padding 12 -> 16. Overlaid AFTER the real sheet. (Until review BLOCK #1 this overlay
// also put 16 pt on the game card's header and body; that is the base sheet now, and P8 pins it.)
const SWEEP = `.gap-sm{gap:8px}@media (max-width:480px){.card{padding:16px}}`;
const SHEETS = [{ name: 'release', extra: '' }, { name: 'sweep', extra: SWEEP }];
let fileN = 0;
function page(body, { css = CSS_HREF, extra = '', attrs = MODES[0].attrs } = {}) {
  const file = join(tmp, `p${++fileN}.html`);
  writeFileSync(file, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="${css}">${NOANIM}${extra ? `<style>${extra}</style>` : ''}</head>
<body ${attrs}>${body}</body></html>`);
  return file;
}
const picksPage = cards => `<main class="main-content"><section class="page-section active" id="page-picks"><div id="submitted-games">${cards.map(c => c.html).join('')}</div></section></main>`;
const CSS = readFileSync(join(here, 'css/styles.css'), 'utf8');
/** A mutated copy of the real sheet. A transform that changes nothing is an error, never a silent pass. */
function sheet(transform) {
  const out = transform(CSS);
  if (out === CSS) throw new Error('sheet(): the transform changed nothing — a mutant that is the original proves nothing');
  const file = join(tmp, `s${++fileN}.css`);
  writeFileSync(file, out);
  return 'file://' + file;
}
/** The real cards with their markup mutated (same rule: it must change something). */
function mutCards(transform) {
  const out = CARDS.map(c => ({ ...c, html: transform(c.html) }));
  if (out.every((c, i) => c.html === CARDS[i].html)) throw new Error('mutCards(): the transform changed nothing');
  return out;
}
/** Exact-text replacement that refuses to miss (a renamed rule must fail loudly here, not pass silently). */
const swap = (from, to) => s => { if (!s.includes(from)) throw new Error('mutant text not found: ' + from); return s.split(from).join(to); };

// ── In-page measurement library (stringified into every page) ────────────────
function R(e) { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }
function gap2(a, b) {
  const dx = Math.max(0, Math.max(b.l - a.r, a.l - b.r)), dy = Math.max(0, Math.max(b.t - a.b, a.t - b.b));
  return Math.hypot(dx, dy);
}
function visible(list) { return list.filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }); }
function minPair(list) {
  const rs = visible(list).map(R); let m = Infinity;
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) m = Math.min(m, gap2(rs[i], rs[j]));
  return m === Infinity ? null : +m.toFixed(2);
}
function visualLines(list) {
  const rs = visible(list).map(R).sort((a, b) => a.t - b.t || a.l - b.l); const out = [];
  for (const r of rs) {
    const L = out.find(x => r.t < x.b - 1 && r.b > x.t + 1);
    if (L) { L.l = Math.min(L.l, r.l); L.r = Math.max(L.r, r.r); L.t = Math.min(L.t, r.t); L.b = Math.max(L.b, r.b); } else out.push({ ...r });
  }
  return out;
}
function contentBox(e) {
  const cs = getComputedStyle(e), r = e.getBoundingClientRect();
  return { l: r.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft), r: r.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight),
    t: r.top + parseFloat(cs.borderTopWidth) + parseFloat(cs.paddingTop), b: r.bottom - parseFloat(cs.borderBottomWidth) - parseFloat(cs.paddingBottom) };
}
function textLines(e) {                         // how many line boxes the element's own text occupies
  const tops = [];
  const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (!n.textContent.trim()) continue;
    const g = document.createRange(); g.selectNodeContents(n);
    for (const q of g.getClientRects()) if (q.width > 0 && !tops.some(t => Math.abs(t - q.top) < 2)) tops.push(q.top);
  }
  return tops.length;
}
function itemName(e) {
  const cls = (typeof e.className === 'string' ? e.className : '').split(/\s+/);
  return cls.find(c => /^(badge-(?!$)|alma-mater-badge|mult-badge|league-chip|dq-|game-time)/.test(c)) || cls[0] || e.tagName.toLowerCase();
}
/** One record per card: everything P1-P8 need, plus the numbers the report quotes. */
async function measureCards() {
  let oswald = null;
  try { oswald = (await document.fonts.load('600 1em Oswald')).length > 0; } catch { oswald = false; }
  await document.fonts.ready;
  const out = [];
  for (const card of document.querySelectorAll('.game-card')) {
    const hdr = card.querySelector('.game-card-header');
    const cb = contentBox(hdr), cr = R(card), ccs = getComputedStyle(card);
    const inner = { l: cr.l + parseFloat(ccs.borderLeftWidth), r: cr.r - parseFloat(ccs.borderRightWidth) };
    const groups = [...hdr.children];
    const meta = visible(groups[0] ? [...groups[0].children] : []);
    const status = visible(groups[1] ? [...groups[1].children] : []);
    const all = [...meta, ...status];
    // Past the content box on ANY side: left/right is the clip (and the side inset), top/bottom is
    // the header's 8 pt from the divider under it.
    const past = all.map(e => ({ n: itemName(e), r: R(e) }))
      .map(({ n, r }) => ({ n, content: Math.max(cb.l - r.l, r.r - cb.r, cb.t - r.t, r.b - cb.b), card: Math.max(inner.l - r.l, r.r - inner.r) }))
      .filter(x => x.content > 0.5);
    const btns = visible([...card.querySelectorAll('button')]);
    // P8 — distance from the card's own inner (border) edge, left and right, for every header item and every
    // pick button. Measured from the CARD, not from any padding box, so the padding's size is what is judged.
    const edge = [...all.map(e => ({ n: itemName(e), r: R(e) })), ...visible([...card.querySelectorAll('.pick-btn')]).map(e => ({ n: 'pick-btn', r: R(e) }))]
      .map(({ n, r }) => ({ n, d: Math.min(r.l - inner.l, inner.r - r.r) }));
    const edgeMin = edge.length ? edge.reduce((a, b) => (b.d < a.d ? b : a)) : null;
    let between = null, sameLine = null;
    for (const a of meta) for (const b of status) {
      const A = R(a), B = R(b), d = gap2(A, B);
      between = between === null ? d : Math.min(between, d);
      if (A.t < B.b - 1 && A.b > B.t + 1) { const h = Math.max(B.l - A.r, A.l - B.r); sameLine = sameLine === null ? h : Math.min(sameLine, h); }
    }
    const metaLines = visualLines(meta), statusLines = visualLines(status);
    out.push({
      id: card.dataset.gameId,
      past, maxClip: +Math.max(0, ...past.map(p => p.card)).toFixed(2), overScroll: hdr.scrollWidth - hdr.clientWidth,
      between: between === null ? null : +between.toFixed(2), sameLine: sameLine === null ? null : +sameLine.toFixed(2),
      inMeta: minPair(meta), inStatus: minPair(status),
      broken: all.filter(e => textLines(e) > 1).map(itemName),
      statusEmpty: status.length === 0, hdrContentH: +(cb.b - cb.t).toFixed(2), metaH: groups[0] ? +R(groups[0]).h.toFixed(2) : 0,
      metaOff: +Math.max(0, ...metaLines.map(L => Math.abs(L.l - cb.l))).toFixed(2),
      statusOff: statusLines.length ? +Math.max(...statusLines.map(L => Math.abs(L.r - cb.r))).toFixed(2) : 0,
      wrapped: metaLines.length + statusLines.length > 1 && !(metaLines.length === 1 && statusLines.length === 1 && Math.abs(metaLines[0].t - statusLines[0].t) < 2),
      hdrH: +R(hdr).h.toFixed(2),
      btnCount: btns.length, minBtnH: btns.length ? +Math.min(...btns.map(b => R(b).h)).toFixed(2) : null,
      pickBtns: edge.filter(x => x.n === 'pick-btn').length,
      edgeMin: edgeMin ? +edgeMin.d.toFixed(2) : null, edgeWho: edgeMin ? edgeMin.n : null,
    });
  }
  return { oswald, cards: out };
}
const LIB = [R, gap2, visible, minPair, visualLines, contentBox, textLines, itemName].map(f => f.toString()).join('\n');

// ── The CDP client (spacingtest.mjs / shellrendertest.mjs shape) ─────────────
function launch() {
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run',
    '--no-default-browser-check', '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--disable-default-apps', '--disable-extensions', '--disable-search-engine-choice-screen',
    '--metrics-recording-only', '--mute-audio',
    ...(WEBFONTS ? [] : ['--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE localhost']),   // no network unless asked: deterministic fonts
    'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  return new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
    proc.stderr.on('data', d => { buf += d.toString(); const m = buf.match(/ws:\/\/\S+/); if (m) { clearTimeout(t); res({ proc, ws: m[0] }); } });
    proc.on('error', e => { clearTimeout(t); rej(e); });
  });
}
async function attach(browserWs) {
  const list = await (await REAL_FETCH('http://' + new URL(browserWs).host + '/json/list')).json();
  const target = list.find(t => t.type === 'page');
  if (!target) throw new Error('no page target to attach to');
  const sock = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { sock.addEventListener('open', res, { once: true }); sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true }); });
  let id = 0; const pending = new Map(); const waiters = [];
  sock.addEventListener('message', ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method) waiters.filter(w => w.method === msg.method).forEach(w => w.res());
  });
  const send = (method, params = {}) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, m => m.error ? rej(new Error(method + ' → ' + JSON.stringify(m.error))) : res(m.result));
    sock.send(JSON.stringify({ id: myId, method, params }));
  });
  const once = method => new Promise(res => waiters.push({ method, res }));
  return { send, once, sock };
}

const WIDTHS = [320, 375, 430];
const SCALES = [1, 1.35, 2];
const f2 = n => (n === null || n === undefined) ? '—' : (Math.round(n * 100) / 100).toFixed(2);
const short = id => id.replace(/^sb25_/, '');

/** The eight properties, judged ONCE here so [2] and the mutants in [4] can never disagree. */
function verdicts(cards) {
  const both = cards.filter(c => c.between !== null);
  const empty = cards.filter(c => c.statusEmpty);
  const withBtns = cards.filter(c => c.btnCount);
  return {
    both, empty, withBtns,
    P1: cards.filter(c => c.past.length || c.overScroll > 0),
    // B1 (review BLOCK #1): 16 between the groups in EVERY direction — side by side and stacked.
    P2: both.filter(c => c.between < 16 - 0.01),
    P3: cards.filter(c => (c.inMeta !== null && c.inMeta < 8) || (c.inStatus !== null && c.inStatus < 8)),
    P4: cards.filter(c => c.broken.length),
    P5: empty.filter(c => Math.abs(c.hdrContentH - c.metaH) > 0.5),
    P6: cards.filter(c => c.metaOff > 0.5 || c.statusOff > 0.5),
    P7: withBtns.filter(c => c.minBtnH < 44),
    // B2 (review BLOCK #1): 16 from the card's inner edge, measured from the card.
    P8: cards.filter(c => c.edgeMin === null || c.edgeMin < 16 - 0.01),
  };
}
const red = v => ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'].filter(k => v[k].length);

let engine = null;
try {
  if (!bin) throw new Error('no engine binary');
  engine = await launch();
  const cdp = await attach(engine.ws);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  /** Load `file` at `w` px wide and `scale`x text, then measure every card. */
  async function measure(file, { w, scale }) {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 812, deviceScaleFactor: 1, mobile: true });
    const loaded = cdp.once('Page.loadEventFired');
    await cdp.send('Page.navigate', { url: 'file://' + file });
    await loaded;
    if (scale !== 1) await cdp.send('Runtime.evaluate', { expression: `document.documentElement.style.fontSize='${scale * 100}%'` });
    const r = await cdp.send('Runtime.evaluate', { expression: `(async () => { ${LIB}\n return await (${measureCards.toString()})(); })()`, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error('measure threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  }

  // ── [2] GEOMETRY ───────────────────────────────────────────────────────────
  console.log('\n[2] Geometry — 320 / 375 / 430 wide x 1 / 1.35 / 2x text x light / dark x release / sweep, every card…');
  const RESULTS = new Map();                         // `${sheet}|${mode}|${w}|${scale}` -> cards
  let fontCheck = null;
  for (const sheet of SHEETS) {
    for (const mode of MODES) {
      const file = page(picksPage(CARDS), { extra: sheet.extra, attrs: mode.attrs });
      for (const w of WIDTHS) {
        for (const scale of SCALES) {
          const { oswald, cards } = await measure(file, { w, scale });
          fontCheck = fontCheck === null ? oswald : (fontCheck && oswald);
          RESULTS.set(`${sheet.name}|${mode.name}|${w}|${scale}`, cards);
          const tag = `${sheet.name.padEnd(8)} ${mode.name.padEnd(5)} ${w} wide ${String(scale).padEnd(4)}x`;
          const fixtureOk = cards.length === CARDS.length;
          const v = verdicts(cards);
          // P1 — nothing clipped, nothing into the header's inset (side padding, and 8 pt off the divider below).
          assert(fixtureOk && v.P1.length === 0, `[2-P1] ${tag}: nothing clipped — every header item inside the header's content box (${v.P1.length ? v.P1.slice(0, 4).map(c => `${short(c.id)}: ${c.past.map(p => `${p.n} ${f2(p.content)} past content, ${f2(p.card)} past card edge`).join('; ') || `scrolls ${c.overScroll}px`}`).join(' | ') + (v.P1.length > 4 ? ` | +${v.P1.length - 4} more` : '') : `${cards.length} cards`})`);
          // P2 — the groups never touch.
          const minB = v.both.length ? Math.min(...v.both.map(c => c.between)) : null;
          assert(fixtureOk && v.both.length >= 14 && v.P2.length === 0, `[2-P2] ${tag}: the two groups never touch — >= 16 pt apart, side by side and stacked (${v.both.length} cards with both groups; ${v.P2.length ? v.P2.slice(0, 4).map(c => `${short(c.id)} ${f2(c.between)} pt${c.sameLine !== null ? ` / ${f2(c.sameLine)} on one line` : ''}`).join(', ') : `smallest ${f2(minB)} pt`})`);
          // P3 — items inside a group keep 8 pt.
          assert(fixtureOk && v.P3.length === 0, `[2-P3] ${tag}: items inside a group stay >= 8 pt apart, on both axes (${v.P3.length ? v.P3.slice(0, 4).map(c => `${short(c.id)} left ${f2(c.inMeta)} / right ${f2(c.inStatus)}`).join(', ') : 'all'})`);
          // P4 — no pill breaks its label.
          assert(fixtureOk && v.P4.length === 0, `[2-P4] ${tag}: no badge breaks its own label across two lines (${v.P4.length ? v.P4.slice(0, 4).map(c => `${short(c.id)}: ${c.broken.join(', ')}`).join(' | ') : 'none'})`);
          // P5 — an empty status group takes no space.
          assert(fixtureOk && v.empty.length >= 3 && v.P5.length === 0, `[2-P5] ${tag}: a card with no right-hand badge has no stray blank line (${v.empty.length} such cards; ${v.P5.length ? v.P5.map(c => `${short(c.id)} header ${f2(c.hdrContentH)} vs left group ${f2(c.metaH)}`).join(', ') : 'header height = left group height'})`);
          // P6 — wrapped lines stay anchored.
          assert(fixtureOk && v.P6.length === 0, `[2-P6] ${tag}: the left group's lines start at the content edge, the status group's lines end at it (${v.P6.length ? v.P6.slice(0, 4).map(c => `${short(c.id)} left off ${f2(c.metaOff)} / right off ${f2(c.statusOff)}`).join(', ') : `${cards.filter(c => c.wrapped).length} cards wrap, all anchored`})`);
          // P7 — the 44 pt touch targets survive (the draft cards' pick buttons are the card's only controls).
          assert(fixtureOk && v.withBtns.length >= 6 && v.P7.length === 0, `[2-P7] ${tag}: every button on a card is >= 44 pt tall (${v.withBtns.length} cards with buttons; smallest ${f2(v.withBtns.length ? Math.min(...v.withBtns.map(c => c.minBtnH)) : null)} pt)`);
          // P8 — 16 pt in from the card's own edge: header items on every card, pick buttons on the draft cards.
          const pickBtnCards = cards.filter(c => c.pickBtns > 0).length;
          const minEdge = cards.filter(c => c.edgeMin !== null).reduce((a, c) => (a === null || c.edgeMin < a.edgeMin ? c : a), null);
          assert(fixtureOk && pickBtnCards >= 6 && v.P8.length === 0, `[2-P8] ${tag}: every header item and every pick button sits >= 16 pt in from the card's inner edge (${pickBtnCards} cards with pick buttons; ${v.P8.length ? v.P8.slice(0, 4).map(c => `${short(c.id)} ${c.edgeWho} ${f2(c.edgeMin)} pt`).join(', ') : `closest ${minEdge ? `${minEdge.edgeWho} ${f2(minEdge.edgeMin)} pt` : '—'}`})`);
        }
      }
    }
  }
  if (WEBFONTS) assert(fontCheck === true, 'PICKHEADERTEST_WEBFONTS=1: Oswald actually LOADED (document.fonts.load) — a web-font run that silently fell back would measure the wrong type');

  // ── [3] THE REPORTED CASES ─────────────────────────────────────────────────
  console.log('\n[3] The two reported cases, by name…');
  const pick = (sheet, w, scale, id) => RESULTS.get(`${sheet}|light|${w}|${scale}`).find(c => c.id === 'sb25_' + id);
  for (const sheet of SHEETS.map(s => s.name)) {
    for (const id of ['s_alma_loss', 's_alma_nd']) {
      const c = pick(sheet, 375, 1.35, id);
      assert(c.past.length === 0 && c.between >= 16 - 0.01 && c.edgeMin >= 16 - 0.01, `[3a] ${sheet}: alma + lock + result (${id.endsWith('loss') ? 'Wrong' : 'No Decision'}) at 375 wide, 1.35x text — groups ${f2(c.between)} pt apart${c.sameLine !== null ? ` (${f2(c.sameLine)} on one line)` : ', stacked'}, result clipped by ${f2(c.maxClip)} px, closest item ${f2(c.edgeMin)} pt from the card edge (header ${f2(c.hdrH)} px tall)`);
    }
    const at320 = RESULTS.get(`${sheet}|light|320|1`);
    const bad = at320.filter(c => c.past.length || (c.between !== null && c.between < 16 - 0.01) || c.edgeMin < 16 - 0.01);
    assert(bad.length === 0, `[3b] ${sheet}: 320 wide, 1x text — every card: ${bad.length ? bad.map(c => `${short(c.id)} groups ${f2(c.between)} pt, clipped ${f2(c.maxClip)} px, edge ${f2(c.edgeMin)} pt`).join(' | ') : 'groups >= 16 apart, nothing clipped, everything >= 16 from the card edge'}`);
  }

  // ── [4] MUTANTS (anti-vacuity) ─────────────────────────────────────────────
  // Each piece of the fix is taken out of an in-memory copy (the real files are never
  // touched) and the SAME detectors from [2] must go red. If one stayed green, the
  // matching assertion in [2] would be measuring nothing.
  console.log('\n[4] Mutants — each piece of the fix removed in memory; the [2] detectors must go red…');
  const HDR_NEW = '.game-card-header{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:16px;padding:8px 16px;background:var(--bg-card-alt);border-bottom:1px solid var(--border)}';
  const HDR_OLD = '.game-card-header{display:flex;align-items:center;justify-content:space-between;padding:8px 14px;background:var(--bg-card-alt);border-bottom:1px solid var(--border)}';
  const BODY = '.game-card-body{padding:16px}';
  const BODY_OLD = '.game-card-body{padding:14px}';
  const HDR_14 = HDR_NEW.replace('padding:8px 16px;', 'padding:8px 14px;');
  const GROUPS = '.game-card-meta,.game-card-status{display:flex;flex-wrap:wrap;align-items:center;gap:8px}';
  const STATUS = '.game-card-status{flex:1 1 auto;justify-content:flex-end}';
  const EMPTY = '.game-card-status:empty{display:none}';
  const CHIPS = '.game-card-meta .mult-badge,.game-card-meta .league-chip{margin-left:0}';
  const OLD_MARKUP = h => swap('<div class="game-card-status">', '<div class="flex gap-sm flex-center">\n        ')(swap('<div class="game-card-meta">', '<div class="flex gap-sm flex-center">')(h));
  const MUT_AT = [[320, 1], [320, 1.35], [320, 2], [375, 1.35], [430, 2]];
  const MUTANTS = [
    // M1: the gap alone still holds the groups apart in a no-wrap row (P2 stays green) — what returns is the clip and the squeezed labels.
    { id: 'M1', what: 'the header does not wrap (flex-wrap removed from .game-card-header)', css: swap(HDR_NEW, HDR_NEW.replace('flex-wrap:wrap;', '')), want: ['P1', 'P4'] },
    { id: 'M2', what: 'the header has no gap (gap:16px removed)', css: swap(HDR_NEW, HDR_NEW.replace('gap:16px;', '')), want: ['P2'] },
    // M3a is the state review BLOCK #1 rejected (8a8a5ea..d752d01): 16 side by side, only 8 once stacked (B1).
    { id: 'M3a', what: 'the stack loses its gap: groups 8 pt apart once stacked (gap:16px -> 8px 16px, the pre-review shape)', css: swap(HDR_NEW, HDR_NEW.replace('gap:16px;', 'gap:8px 16px;')), want: ['P2'] },
    // M3b sweeps the width in 4 px steps at 1x: an alma card goes from one line (430) to wrapped (320), so with a column gap of 8 its
    // one-line distance MUST pass through the 8–16 band on the way — font-independent (five sampled widths missed it with Oswald loaded).
    { id: 'M3b', what: 'groups 8 pt apart side by side (gap:16px -> 16px 8px), widths 320–430 in 4 px steps', css: swap(HDR_NEW, HDR_NEW.replace('gap:16px;', 'gap:16px 8px;')), want: ['P2'],
      at: Array.from({ length: 28 }, (_, i) => [320 + 4 * i, 1]) },
    { id: 'M4', what: 'the in-group gap back to .gap-sm\'s 6 px', css: swap(GROUPS, GROUPS.replace('gap:8px', 'gap:6px')), want: ['P3'] },
    { id: 'M5', what: 'the groups do not wrap (flex-wrap removed from the group rule)', css: swap(GROUPS, GROUPS.replace('flex-wrap:wrap;', '')), anyOf: ['P1', 'P4'] },
    { id: 'M6', what: 'the :empty rule removed (an open draft card keeps an empty status group)', css: swap(EMPTY, ''), want: ['P5'] },
    { id: 'M7', what: 'the chips keep their own 6 px margin-left inside the header', css: swap(CHIPS, ''), want: ['P6'] },
    { id: 'M8', what: 'the status group not anchored right (flex-grow + flex-end removed)', css: swap(STATUS, ''), want: ['P6'] },
    { id: 'M9', what: 'markup: whitespace back inside the status group (so :empty never matches)', html: swap('<div class="game-card-status">', '<div class="game-card-status">\n        '), want: ['P5'] },
    // M10 does not expect P3: the old markup's in-group gap is .gap-sm, which is 6 px here but 8 px once feat/spacing-sweep
    // merges — so P3 would go green there for a reason unrelated to this fix. M4 owns P3 independently of .gap-sm.
    { id: 'M10', what: 'the exact pre-fix code (95a16c3: old header rule, 14 px body, .flex.gap-sm groups)', css: s => swap(BODY, BODY_OLD)(swap(HDR_NEW, HDR_OLD)(s)), html: OLD_MARKUP, want: ['P1', 'P2', 'P4', 'P8'] },
    // B2 (review BLOCK #1): P8 must see BOTH halves — header and body back to 14 together, then each alone, naming who is too close.
    { id: 'M11', what: 'header and body padding back to 14 (the pre-review value)', css: s => swap(BODY, BODY_OLD)(swap(HDR_NEW, HDR_14)(s)), want: ['P8'] },
    { id: 'M12', what: 'body padding alone back to 14 -> the PICK BUTTONS sit 14 from the edge', css: swap(BODY, BODY_OLD), want: ['P8'], who: 'pick-btn' },
    { id: 'M13', what: 'header padding alone back to 14 -> the HEADER ITEMS sit 14 from the edge', css: swap(HDR_NEW, HDR_14), want: ['P8'], who: 'header' },
  ];
  for (const m of MUTANTS) {
    let reds = new Set(), why = '';
    const p8who = new Set();                       // who P8 caught: 'pick-btn' or 'header' (any header item)
    try {
      const css = m.css ? sheet(m.css) : CSS_HREF;
      const cards = m.html ? mutCards(m.html) : CARDS;
      const file = page(picksPage(cards), { css });
      for (const [w, scale] of (m.at || MUT_AT)) {
        const v = verdicts((await measure(file, { w, scale })).cards);
        for (const k of red(v)) { if (!reds.has(k)) why += ` ${k}@${w}/${scale}x(${short(v[k][0].id)}${k === 'P8' ? ' ' + v.P8[0].edgeWho + ' ' + f2(v.P8[0].edgeMin) : ''})`; reds.add(k); }
        for (const c of v.P8) p8who.add(c.edgeWho === 'pick-btn' ? 'pick-btn' : 'header');
      }
    } catch (e) { why = ' THREW: ' + e.message; reds = null; }
    const ok = reds && (m.want ? m.want.every(k => reds.has(k)) : m.anyOf.some(k => reds.has(k))) && (!m.who || p8who.has(m.who));
    assert(!!ok, `[4-${m.id}] ${m.what} -> ${m.want ? m.want.join(' + ') : m.anyOf.join(' or ')} go${m.want && m.want.length === 1 ? 'es' : ''} red${m.who ? `, caught on a ${m.who === 'pick-btn' ? 'pick button' : 'header item'}` : ''} (red:${why || ' nothing'}${m.who ? `; P8 caught: ${[...p8who].join(', ') || 'nothing'}` : ''})`);
  }

  // ── [5] SOURCE GUARDS (what a measurement cannot see) ──────────────────────
  console.log('\n[5] Source guards — tokens only, no utility gap that out-ranks the groups, the empty group really empty…');
  {
    const body = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const rule of [HDR_NEW, BODY, GROUPS, STATUS, EMPTY, CHIPS]) {
      const n = body.split(rule).length - 1;
      assert(n === 1 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rule), `[5a] styles.css declares "${rule.slice(0, 60)}…" exactly once, with no hex/rgb colour (tokens only; light and dark follow) (found ${n})`);
    }
    assert(CARDS.every(c => !/gap-sm|class="flex /.test(hdrOf(c.html))),
      '[5b] no header group carries .flex / .gap-sm — .gap-sm sits LATER in styles.css than the header rules and would out-rank the groups\' own 8 pt gap (and the sweep changes it)');
    assert(['d_plain_open', 'd_alma_open', 'd_stress_open'].every(id => hdrOf(byId(id).html).includes('<div class="game-card-status"></div>')),
      '[5c] an open draft card renders its status group with nothing inside, not even whitespace — the only way `:empty` can hide it');
  }
} catch (e) {
  fail++;
  console.error('  ❌ the engine section threw: ' + (e && e.stack || e));
} finally {
  try { engine && engine.proc && engine.proc.kill(); } catch {}
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

console.log(`\n[pickheadertest] ${pass} passed, ${fail} failed`);
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`, () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
