/**
 * CFB Pickems — readinessmotiontest.mjs (SB-18 READINESS-NIGHT + LIVE-BADGE REDUCED MOTION, and SB-21 CHAT "NEW" DIVIDER;
 * Social Platform thread, bugfixer, 2026-10-01; REBUILT on SP-52 THEMES per the SP-52 reviewer's ruling D7)
 * ============================================================================
 * Three small, pre-existing defects of one class: a hardcoded light-mode colour that no night-mode token could reach, and a
 * looping animation that ignored Reduce Motion.
 *
 * (a) SB-18 — THE COMMISSIONER'S READINESS CHIPS ARE UNREADABLE IN NIGHT MODE.
 *     renderAdminGamesList() (js/app.js; Comm -> Games -> Selected Slate) puts a chip on every game that is not ready:
 *       .game-readiness-warn        color:#8a5a00   "⚠️ Pending confirmation"
 *       .game-readiness-incomplete  color:#9a1c1c   "⛔ Incomplete — hidden from players"
 *     SP-52 (A1.8) already declares --readiness-warn-text / --readiness-incomplete-text in every theme block; the two rules
 *     still painted the literals, so every Dark side read them at about 2:1.
 *
 * (b) SB-18 — THE LIVE INDICATORS IGNORE REDUCE MOTION. .badge-live (the header's week badge during a LIVE week, so it pulsed
 *     on every tab all Saturday), .badge-live-covering / -trailing, .pick-btn.live-covering / -trailing, the Picks card's
 *     "🔴 LIVE" line (.score-status) and Chat's LIVE dot (.live-pulse) loop forever with no prefers-reduced-motion override,
 *     while their dashboard twins (.pick-cell.pick-live-*, .dc-chip-live-*, .live-dot) have one. And (themes DI A1.10) a FINAL card's
 *     "FINAL" line carried the same .score-status class, so a settled result looped too, with motion allowed or not: renderGameCard() now
 *     gives FINAL the static score-status-no-pulse treatment. Only LIVE pulses.
 *
 * (c) SB-21 — CHAT'S "NEW" UNREAD DIVIDER IS UNREADABLE IN NIGHT MODE. .chat-new-divider (js/chat-ui.js messageHTML(), the
 *     main feed's first unread message) paints its label and its two hairlines with a hardcoded #B02A37: 2.48:1 on the
 *     lifted Dark card #25201B and 2.62:1 on Graphite Dark's #1C1C1E (2.90:1 / 2.63:1 on the pre-SP-52 surfaces).
 *
 * METHOD: SP-52's 20-sided resolver (themeresolve.mjs), never a copy of it. The real markup (renderAdminGamesList(),
 * renderGameCard(), chat-ui's messageHTML() and pillsHTML(), and the literal templates in js/app.js / js/chat-ui.js, each
 * checked to exist) is parsed into a node tree mounted where the app mounts it, and every colour, surface, animation and
 * opacity comes out of the real cascade on that tree. Contrast: 10 looks x Light/Dark x BOTH triggers (System with the OS
 * set that way, and the pinned Appearance with the OS set the OPPOSITE way) = 40 contexts. The Paper Dark scope is not
 * assumed: a chip inside a paper root reads the paper tokens because its real ancestor is a paper root. Reduce Motion:
 * the same resolver on the stylesheet with its `@media (prefers-reduced-motion: reduce)` blocks unwrapped in place, so an
 * override that loses on specificity or source order is RED.
 *
 * WHAT THIS PROVES
 *   [0] Fixtures: the chains are DERIVED from the real renderers and mounts; every literal template is checked to exist.
 *   [1] Both readiness chips clear WCAG AA in all 40 contexts.
 *   [2] Light is byte-identical (both chips resolve to the pre-fix literal on every Light context); tints and borders are
 *       unchanged; warn never collapses into incomplete.
 *   [3] Deny-by-default for the defect class (no literal readiness text; the pre-fix hexes live on only as token values);
 *       DI-448 R1/R4/R6 and A1.8's per-look rule (Paper's paper card reads the LIGHT pair); .sync-syncing unreachable-or-AA.
 *   [4] Reduce Motion: every live indicator, at every place it renders, still loops when motion is allowed and resolves to
 *       animation:none at full opacity under prefers-reduced-motion:reduce, on all 20 sides. A stylesheet-wide net requires a
 *       same-selector override (later in source, under conditions the base rule meets) on every infinite animation, apart
 *       from MOTION_EXEMPT (named progress indicators, rotation-only). KNOWN_MOTION_DEBT is CLOSED (empty).
 *   [5] Mutation proof for (a) and (b), in memory: each part of the fix reverted on a string copy turns its check RED.
 *   [6] SB-21: the NEW divider clears AA in all 40 contexts; Light is byte-identical (#B02A37); the label and its hairlines
 *       read one token; the token is a literal on :root, never school-owned, identical across triggers; in Paper Dark it sits on a
 *       LIGHT paper .chat-surface (a paper root since A1.10) and reads the light value from the paper scope.
 *   [7] Mutation proof for (c), in memory, including A1.10's pair proved forward from the pre-A1.10 stylesheet: the .chat-surface
 *       root alone is RED, the scope value alone is RED, both together are GREEN and rebuild the shipped stylesheet byte for byte.
 *
 * Run:  node readinessmotiontest.mjs              (assertions)
 *       node readinessmotiontest.mjs --table      (also prints every ratio and every motion resolution)
 *       node readinessmotiontest.mjs --css <path> (scan another styles.css)
 */

import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as R from './themeresolve.mjs';
import { ALL_THEME_KEYS, SCHOOLS } from './themetables.mjs';
import { dashboardRoles } from './dashcontrasttest.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

// ─── DOM / localStorage stubs (pickcontrasttest.mjs shape) ───────────────────
// Only so js/app.js and js/chat-ui.js can be imported and their renderers called in Node.
const _store = new Map();
globalThis.localStorage = {
  getItem: (k) => (_store.has(k) ? _store.get(k) : null),
  setItem: (k, v) => _store.set(k, String(v)),
  removeItem: (k) => _store.delete(k),
  clear: () => _store.clear(),
};
function makeEl(id) {
  return {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
  };
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => makeEl('__detached__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in readinessmotiontest'); };

// ─── CSS text helpers (structural checks and the motion net) ─────────────────
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
/** Split on `delim` at paren depth 0 (a data: URI or :not(a,b) never splits). */
function splitTop(s, delim) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === delim && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function declsOf(body) {
  return splitTop(body, ';').map((d) => {
    const i = d.indexOf(':');
    if (i === -1) return null;
    const prop = d.slice(0, i).trim();
    return { prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value: d.slice(i + 1).trim() };
  }).filter((d) => d && d.prop);
}
const selectorsOf = (prelude) => splitTop(prelude, ',').map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean);
/** Every style rule as { prelude, body, ctx: [enclosing at-rule preludes], order }. */
function ruleBlocks(css) {
  const out = []; let order = 0;
  (function walk(src, ctx) {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf('{', i);
      if (open === -1) break;
      let prelude = src.slice(i, open);
      if (prelude.includes(';')) prelude = prelude.slice(prelude.lastIndexOf(';') + 1);
      prelude = prelude.trim();
      let depth = 1, k = open + 1;
      while (k < src.length && depth > 0) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
      const body = src.slice(open + 1, k - 1);
      if (/^@keyframes/.test(prelude)) { /* frames are not rules */ }
      else if (prelude.startsWith('@')) walk(body, [...ctx, prelude]);
      else out.push({ prelude: prelude.replace(/\s+/g, ' '), body, ctx, order: order++ });
      i = k;
    }
  })(stripComments(css), []);
  return out;
}
const REDUCE_ANY = /\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/i;
const isReduce = (ctx) => ctx.some((c) => REDUCE_ANY.test(c));
/** The conditions of an at-rule context OTHER than reduced motion, normalised — a compound override such as
 *  `@media (min-width:600px) and (prefers-reduced-motion:reduce)` covers a base rule only where (min-width:600px) holds. */
const condsOf = (ctx) => ctx.map((c) => c.replace(REDUCE_ANY, '').replace(/^@media\b/i, '').replace(/\band\b/gi, ' ').replace(/\s+/g, '').toLowerCase()).filter(Boolean);
/** The stylesheet as a Reduce Motion PHONE applies it: every unconditional `@media (prefers-reduced-motion: reduce){…}`
 *  unwrapped IN PLACE (so its rules compete by specificity and source order exactly as they would live). A compound query
 *  (`(min-width:600px) and (…reduce)`) stays wrapped: it does not apply on a phone. */
function unwrapReduced(css) {
  const src = stripComments(css);
  const re = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/gi;
  let out = '', i = 0, m;
  while ((m = re.exec(src))) {
    const open = m.index + m[0].length - 1;
    let depth = 1, k = open + 1;
    while (k < src.length && depth > 0) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
    out += src.slice(i, m.index) + '\n' + src.slice(open + 1, k - 1) + '\n';
    i = k; re.lastIndex = k;
  }
  return out + src.slice(i);
}
/** @keyframes name -> every declaration in every frame. */
function keyframesOf(css) {
  const kf = {}; const src = stripComments(css);
  for (const m of src.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)\s*\{/g)) {
    let depth = 1, k = m.index + m[0].length;
    while (k < src.length && depth > 0) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
    kf[m[1]] = [...src.slice(m.index + m[0].length, k - 1).matchAll(/\{([^{}]*)\}/g)].flatMap((f) => declsOf(f[1]));
  }
  return kf;
}
/** The declarations of the ONE plain (non-@media) rule whose prelude is `sel`. */
function ruleBody(css, sel) {
  const hits = ruleBlocks(css).filter((b) => b.ctx.length === 0 && b.prelude === sel);
  return hits.length === 1 ? declsOf(hits[0].body) : null;
}

// ─── Mounting real markup into themeresolve's node tree ──────────────────────
const N = (tag, classes = [], attrs = {}) => ({ tag, classes, attrs });
const page = (id, attrs = {}) => [N('div', ['page-wrapper']), N('main', ['main-content']), N('section', ['page-section', 'active'], { id, ...attrs })];
// index.html: body > .page-wrapper > main.main-content > section.page-section#page-* (the app adds .active); the header is
// body > .page-wrapper > header.app-header > .app-header-inner > #header-meta.header-meta > #header-meta-week.
const SHELL = {
  // js/app.js renderCommPage(): `<div class="admin-section" data-comm-tab="games"> … <div id="admin-games-list">${renderAdminGamesList(…)}`,
  // mounted by `c.innerHTML = sections.join('\n')` into #page-commissioner, which carries data-comm-active.
  comm: [...page('page-commissioner', { 'data-comm-active': 'games' }), N('div', ['admin-section'], { 'data-comm-tab': 'games' }), N('div', [], { id: 'admin-games-list' })],
  submitted: [...page('page-picks'), N('div', [], { id: 'submitted-games' })],
  draft: [...page('page-picks'), N('div', [], { id: 'games-list' })],
  picksPage: page('page-picks'),
  rules: page('page-rules'),
  header: [N('div', ['page-wrapper']), N('header', ['app-header']), N('div', ['app-header-inner']), N('div', ['header-meta'], { id: 'header-meta' }), N('span', [], { id: 'header-meta-week' })],
  // js/chat-ui.js renderChatPage(): the feed is `<div class="chat-surface"><div class="chat-scroll" id="chat-scroll">${scrollBodyHTML}`;
  // the pills and a game view's header sit in `.chat-sticky-stack`; the game sheet is body > #chat-sheet-wrap.
  chatFeed: [...page('page-chat'), N('div', ['chat-surface']), N('div', ['chat-scroll'], { id: 'chat-scroll' })],
  chatSticky: [...page('page-chat'), N('div', ['chat-sticky-stack'])],
  chatPage: page('page-chat'),
  chatSheet: [N('div', [], { id: 'chat-sheet-wrap' })],
};
function mount(body, shell, html) {
  let parent = body;
  for (const s of shell) {
    const n = R.makeNode({ tag: s.tag, classes: s.classes, attrs: s.attrs, parent, index: parent.children.length });
    parent.children.push(n); for (const sib of parent.children) sib.count = parent.children.length;
    parent = n;
  }
  if (html) R.parseHtml(html, parent);
  return parent;
}
/** A dashcontrasttest.dashboardRoles() chain (outermost first, chain[0] = body) as themeresolve nodes under `body`. */
function mountChain(body, chain) {
  let parent = body;
  for (const it of chain.slice(1)) {
    const style = it.style ? Object.entries(it.style).map(([k, v]) => `${k}:${v}`).join(';') : '';
    const n = R.makeNode({ tag: it.tag || 'div', classes: it.cls || [], attrs: it.attrs || {}, parent, index: it.even ? 1 : 0, count: 2, style });
    parent.children.push(n); parent = n;
  }
  return parent;
}
const findAll = (host, pred) => { const out = []; R.walk(host, (n) => { if (pred(n)) out.push(n); }); return out; };
const hasC = (n, c) => n.classes.has(c);
const label = (n) => { const p = []; for (let x = n; x && x.tag !== 'html'; x = x.parent) p.unshift(x.tag + (x.attrs.id ? '#' + x.attrs.id : '') + [...x.classes].map((c) => '.' + c).join('')); return p.join(' > '); };

// ─── Contexts: the twenty sides, Dark AND Light once per trigger ─────────────
const CONTEXTS = ALL_THEME_KEYS.flatMap((key) => ['L', 'D'].flatMap((side) => ['system', 'pinned'].map((trigger) => ({ key, side, trigger, id: `${key}:${side} (${trigger})` }))));
const SIDES20 = ALL_THEME_KEYS.flatMap((key) => ['L', 'D'].map((side) => ({ key, side, id: `${key}:${side}` })));
// Paper Dark paints LIGHT paper cards (J1): a chip inside .game-admin-card (a paper root) reads the LIGHT pair there (A1.8).
const darkSurface = (c) => c.side === 'D' && c.key !== 'paper';

/** The effective text colour of `n` against every surface painted under it — themetest [T11]'s method. */
function evalText(sheet, n, ctx) {
  const colorV = R.computedProp(sheet, n, 'color', ctx);
  const fg = R.parseColor(colorV);
  const surfaces = R.paintedSurfaces(sheet, n, ctx);
  if (!fg || !surfaces) return { unresolved: !fg ? `color ${colorV}` : 'surface' };
  const op = R.opacityOf(sheet, n, ctx);
  let worst = null;
  for (const s of surfaces) {
    const ratio = R.contrast(R.compositeOver({ rgb: fg.rgb, a: fg.a * op }, s), s);
    if (!worst || ratio < worst.ratio) worst = { ratio, bg: R.hex(s) };
  }
  const px = R.fontPx(sheet, n, ctx), wt = R.fontWeight(sheet, n, ctx);
  return { ...worst, color: String(colorV).toUpperCase(), floor: (px >= 24 || (px >= 18.66 && wt >= 700)) ? 3 : 4.5, px, wt };
}
/** The worst text element inside `el` (the element itself included). */
function worstIn(sheet, el, ctx) {
  if (!el) return { unresolved: 'not rendered' };
  let worst = null;
  R.walk(el, (n) => {
    if (!n.text || R.isHidden(sheet, n, ctx)) return;
    const e = evalText(sheet, n, ctx);
    if (worst?.unresolved) return;
    if (e.unresolved || !worst || e.ratio < worst.ratio) worst = e;
  });
  return worst || { unresolved: 'no visible text' };
}

// ─── Fixtures: the real renderers ────────────────────────────────────────────
async function renderFixtures() {
  const dm = await import('./js/data-model.js');
  const app = await import('./js/app.js');
  const st = await import('./js/storage.js');
  const chatUi = await import('./js/chat-ui.js');
  const { GAME_STATUS, PICK_RESULT, createGame } = dm;
  const W = 'w_sb18';
  const base = { homeTeam: 'Texas A&M', awayTeam: 'LSU', favorite: 'Texas A&M' };
  // gameDataReadiness(): kickoff set but unconfirmed + no spread -> 'warn'; no kickoff at all -> 'incomplete';
  // confirmed kickoff + spread -> 'ok'.
  const warn = createGame(W, { ...base, gameId: 'g_sb18_warn', kickoff: '2026-10-03T19:30:00Z', spread: null });
  const inc = createGame(W, { ...base, gameId: 'g_sb18_inc', kickoff: null, spread: -3.5 });
  const ok = createGame(W, { ...base, gameId: 'g_sb18_ok', kickoff: '2026-10-03T23:00:00Z', kickoffConfirmed: true, spread: -3.5 });
  const live = createGame(W, { ...base, gameId: 'g_sb18_live', kickoff: '2026-10-03T16:00:00Z', kickoffConfirmed: true, spread: -3.5, status: GAME_STATUS.LIVE, homeScore: 14, awayScore: 7 });
  const week = { weekId: W, status: 'live' };
  const pickLive = (alma) => createGame(W, { ...base, gameId: alma ? 'g_sb18_pa' : 'g_sb18_p', spread: -3.5, status: GAME_STATUS.LIVE, homeScore: 14, awayScore: 7, kickoff: '2026-10-03T19:30:00Z', isAlmaMaterGame: alma });
  const g = pickLive(false), ga = pickLive(true);
  // Chat's game pill: a LIVE game on the current week, written through the storage seam (local mode, the stub above).
  st.saveWeek({ weekId: W, weekNumber: 5, status: 'live', name: 'Week 5' });
  st.saveGame(live);
  const msg = { id: 'm_sb21', type: 'message', seq: 9, ts: Date.parse('2026-10-03T20:00:00Z'), author: 'p2', body: 'Did you see that?', notify: true };
  return {
    readiness: dm.gameDataReadiness,
    fixtures: { warn, inc, ok, live },
    admin: app.renderAdminGamesList([warn, inc, ok, live], week, {}),
    adminOkOnly: app.renderAdminGamesList([ok], week, {}),
    covering: app.renderGameCard(g, g.homeTeam, PICK_RESULT.LIVE, true, true),
    trailing: app.renderGameCard(g, g.awayTeam, PICK_RESULT.LIVE, true, true),
    coveringAlma: app.renderGameCard(ga, ga.homeTeam, PICK_RESULT.LIVE, true, true),
    trailingAlma: app.renderGameCard(ga, ga.awayTeam, PICK_RESULT.LIVE, true, true),
    finalCard: app.renderGameCard({ ...g, status: GAME_STATUS.FINAL }, g.homeTeam, PICK_RESULT.WIN, true, true),
    draft: app.renderGameCard({ ...g, status: GAME_STATUS.SCHEDULED, homeScore: null, awayScore: null }, g.homeTeam, PICK_RESULT.PENDING, false, false),
    pills: chatUi._pillsHTMLForTest(),
    divider: chatUi._messageHTMLForTest(msg, 'p1', true),
    noDivider: chatUi._messageHTMLForTest(msg, 'p1', false),
  };
}

// The literal templates the .badge-live and .live-pulse chains model — each checked to exist in [0-8] / [0-14].
const TEMPLATE_HTML = {
  header: '<span class="week-heading week-heading-inline"><span class="week-heading-name"><strong>Week 5</strong><span class="badge badge-live ml-sm">LIVE</span></span></span>',
  weekNav: '<div class="picks-week-nav"><div class="week-heading"><span class="picks-week-nav-label">Week 5</span> <span class="badge badge-live">LIVE</span><span class="week-heading-dates">Oct 3</span></div></div>',
  history: '<span class="hist-pick badge-live">Texas A&amp;M </span>',
  faq: '<div class="faq-stage"><span class="badge badge-live">LIVE</span></div>',
  chatViewHeader: '<div class="chat-view-header"><div><strong>LSU @ Texas A&amp;M</strong> <span class="text-muted text-xs">A&amp;M -3.5</span></div><div><span class="live-pulse"></span> LIVE 7–14</div></div>',
  chatSheet: '<div class="chat-sheet"><div class="chat-sheet-header"><div><div class="chat-sheet-title">LSU @ Texas A&amp;M</div><div class="chat-sheet-sub">A&amp;M -3.5 · <span class="live-pulse"></span> LIVE 7–14</div></div></div></div>',
};

/** Every live indicator, at every place it renders. `sb18` roles must hold animation:none AND full opacity under Reduce
 *  Motion; `regression` roles (the dashboard twins that already had the pattern) must hold animation:none; `still` roles
 *  never loop at all (a state that is already approved as still). */
const MOTION_ROLES = [
  { id: '.badge-live — commissioner slate (game LIVE)', rule: '.badge-live', kind: 'sb18', fx: 'admin', shell: 'comm', pick: (h) => findAll(h, (n) => hasC(n, 'badge') && hasC(n, 'badge-live'))[0] },
  { id: '.badge-live — header week badge (week LIVE, every tab)', rule: '.badge-live', kind: 'sb18', tpl: 'header', shell: 'header', pick: (h) => findAll(h, (n) => hasC(n, 'badge-live'))[0] },
  { id: '.badge-live — Picks/Dashboard week nav (week LIVE)', rule: '.badge-live', kind: 'sb18', tpl: 'weekNav', shell: 'picksPage', pick: (h) => findAll(h, (n) => hasC(n, 'badge-live'))[0] },
  { id: '.badge-live — History pick (result LIVE)', rule: '.badge-live', kind: 'sb18', tpl: 'history', shell: 'picksPage', pick: (h) => findAll(h, (n) => hasC(n, 'badge-live'))[0] },
  { id: '.badge-live — Rules FAQ stage chip', rule: '.badge-live', kind: 'sb18', tpl: 'faq', shell: 'rules', pick: (h) => findAll(h, (n) => hasC(n, 'badge-live'))[0] },
  { id: '.badge-live-covering — Picks card header', rule: '.badge-live-covering', kind: 'sb18', fx: 'covering', shell: 'submitted', pick: (h) => findAll(h, (n) => hasC(n, 'badge-live-covering'))[0] },
  { id: '.badge-live-covering — Picks alma-mater card header', rule: '.badge-live-covering', kind: 'sb18', fx: 'coveringAlma', shell: 'submitted', pick: (h) => findAll(h, (n) => hasC(n, 'badge-live-covering'))[0] },
  { id: '.badge-live-trailing — Picks card header', rule: '.badge-live-trailing', kind: 'sb18', fx: 'trailing', shell: 'submitted', pick: (h) => findAll(h, (n) => hasC(n, 'badge-live-trailing'))[0] },
  { id: '.badge-live-trailing — Picks alma-mater card header', rule: '.badge-live-trailing', kind: 'sb18', fx: 'trailingAlma', shell: 'submitted', pick: (h) => findAll(h, (n) => hasC(n, 'badge-live-trailing'))[0] },
  // the latent pick buttons: the real draft view's two buttons, the state class applied (the only container they render in)
  { id: '.pick-btn.live-covering — Picks draft button (latent)', rule: '.pick-btn.live-covering', kind: 'sb18', fx: 'draft', shell: 'draft',
    pick: (h) => { const b = findAll(h, (n) => n.tag === 'button' && hasC(n, 'pick-btn'))[0]; if (b) b.classes = new Set(['pick-btn', 'live-covering']); return b; } },
  { id: '.pick-btn.live-trailing — Picks draft button (latent)', rule: '.pick-btn.live-trailing', kind: 'sb18', fx: 'draft', shell: 'draft',
    pick: (h) => { const b = findAll(h, (n) => n.tag === 'button' && hasC(n, 'pick-btn'))[1]; if (b) b.classes = new Set(['pick-btn', 'live-trailing']); return b; } },
  // SB-18 review, merge condition 1: the Picks card's "🔴 LIVE" line and Chat's LIVE dot (were KNOWN_MOTION_DEBT)
  { id: '.score-status — Picks card "🔴 LIVE" line', rule: '.score-status', kind: 'sb18', fx: 'covering', shell: 'submitted', pick: (h) => findAll(h, (n) => hasC(n, 'score-status'))[0] },
  { id: '.score-status.score-status-no-pulse — halftime/stale (already still)', rule: '.score-status-no-pulse', kind: 'still', fx: 'covering', shell: 'submitted',
    pick: (h) => { const s = findAll(h, (n) => hasC(n, 'score-status'))[0]; if (s) s.classes.add('score-status-no-pulse'); return s; } },
  // themes DI A1.10 (2026-10-01): a FINAL card's status line is a settled result — the REAL renderGameCard() output, never loops, motion allowed or not
  { id: '.score-status — FINAL card "FINAL" line (never loops, A1.10)', rule: '.score-status-final', kind: 'still', fx: 'finalCard', shell: 'submitted', pick: (h) => findAll(h, (n) => hasC(n, 'score-status'))[0] },
  { id: '.live-pulse — Chat game pill (live game)', rule: '.live-pulse', kind: 'sb18', fx: 'pills', shell: 'chatSticky', pick: (h) => findAll(h, (n) => hasC(n, 'live-pulse'))[0] },
  { id: '.live-pulse — Chat game-thread header (main page)', rule: '.live-pulse', kind: 'sb18', tpl: 'chatViewHeader', shell: 'chatSticky', pick: (h) => findAll(h, (n) => hasC(n, 'live-pulse'))[0] },
  { id: '.live-pulse — game-thread bottom sheet header', rule: '.live-pulse', kind: 'sb18', tpl: 'chatSheet', shell: 'chatSheet', pick: (h) => findAll(h, (n) => hasC(n, 'live-pulse'))[0] },
  // regression: the dashboard twins that already had the pattern (SB-06's chains, imported; the animated element is the chip itself)
  { id: '.pick-cell.pick-live-covering — matrix (regression)', rule: '.pick-cell.pick-live-covering', kind: 'regression', dash: 'pick cell — live covering' },
  { id: '.pick-cell.pick-live-trailing — matrix (regression)', rule: '.pick-cell.pick-live-trailing', kind: 'regression', dash: 'pick cell — live trailing' },
  { id: '.dc-chip-live-covering — compact (regression)', rule: '.dc-chip-live-covering', kind: 'regression', dash: 'pick chip — live covering — team', chip: true },
  { id: '.dc-chip-live-trailing — compact (regression)', rule: '.dc-chip-live-trailing', kind: 'regression', dash: 'pick chip — live trailing — team', chip: true },
  { id: '.live-dot — matrix live cell (regression)', rule: '.live-dot', kind: 'regression', dash: 'pick cell — live covering', dot: true },
];
const DASH = dashboardRoles({});
function mountMotionRole(body, F, role) {
  if (role.dash) {
    const chain = (DASH.find((r) => r.id === role.dash) || {}).chain;
    if (!chain || chain[0].tag !== 'body') return null;
    const c = role.chip ? chain.slice(0, -1) : role.dot ? [...chain, { tag: 'span', cls: ['live-dot'] }] : chain;
    return mountChain(body, c);
  }
  const html = role.fx ? F[role.fx] : TEMPLATE_HTML[role.tpl];
  if (!html) return null;
  return role.pick(mount(body, SHELL[role.shell], html)) || null;
}

// Pre-existing infinite animations with NO reduced-motion override. CLOSED (2026-10-01): SB-18's review fixed the last two
// entries (.score-status, .live-pulse) and moved .spinner to MOTION_EXEMPT, so this list is EMPTY and [4-debt] keeps it so —
// a new looping animation gets a Reduce Motion override, not a debt entry.
export const KNOWN_MOTION_DEBT = {};
// Named exemptions, each with its reason (SB-18 review, merge condition 3). A progress indicator keeps moving under Reduce
// Motion — iOS's UIActivityIndicatorView keeps spinning when Reduce Motion is on, because a still spinner reads as a hang.
// [4-exempt] requires every entry to (i) still loop, (ii) still have no override (a stale entry must be DELETED — the list
// only shrinks), and (iii) be ROTATION-ONLY, so a pulse or a slide can never be filed here.
export const MOTION_EXEMPT = {
  '.spinner': 'the loading spinner (spin .8s, rotate only; js/app.js loading states): progress, not decoration — iOS activity indicators keep spinning under Reduce Motion',
};

const PRE_FIX = { warn: '#8A5A00', incomplete: '#9A1C1C' };
const CHIP_TOKENS = ['--readiness-warn-text', '--readiness-incomplete-text'];
const DIVIDER_LIGHT = '#B02A37';
const DIVIDER_TOKEN = '--chat-new-text';
const isSchoolOnlyBlock = (prelude) => /body\.theme-(aggie|sooner|trojan|irish|boilermaker|razorback)\b/.test(prelude) && !/theme-neutral/.test(prelude);

/** Every check, as data — the main block asserts on the live files and [5]/[7] re-run the SAME analysis on mutated copies.
 *  opts.only: 'contrast' | 'motion' to skip the half a mutation cannot affect (speed only; never changes a result). */
export function analyze(cssSrc, F, { debt = KNOWN_MOTION_DEBT, exempt = MOTION_EXEMPT, only = null } = {}) {
  const out = {};
  const sheet = R.parseSheet(cssSrc);
  const all = ruleBlocks(cssSrc);

  if (only !== 'motion') {
    // [1]/[6] contrast — every chip and the divider, mounted where the app mounts them, in all 40 contexts.
    const table = [];
    const sync = [];
    for (const c of CONTEXTS) {
      const r = R.resolveSide(sheet, c.key, c.side, c.trigger);
      const admin = mount(r.body, SHELL.comm, F.admin);
      const feed = mount(r.body, SHELL.chatFeed, F.divider);
      const syncHost = mount(r.body, SHELL.chatPage, '<span id="chat-sync-badge" class="sync-badge sync-syncing">Syncing…</span>');
      for (const level of ['warn', 'incomplete']) {
        const chip = findAll(admin, (n) => hasC(n, 'game-readiness') && hasC(n, `game-readiness-${level}`))[0];
        const card = chip ? (() => { for (let x = chip.parent; x; x = x.parent) if (hasC(x, 'game-admin-card')) return x; return null; })() : null;
        table.push({ ctx: c, role: level, ...worstIn(sheet, chip, r.ctx), cardBg: card ? (R.paintedSurfaces(sheet, card, r.ctx) || []).map(R.hex)[0] : null, chip });
      }
      const div = findAll(feed, (n) => hasC(n, 'chat-new-divider'))[0];
      table.push({ ctx: c, role: 'divider', ...worstIn(sheet, div, r.ctx), node: div });
      sync.push({ ctx: c, ...worstIn(sheet, findAll(syncHost, (n) => hasC(n, 'sync-syncing'))[0], r.ctx) });
    }
    out.table = table;
    out.sync = sync;
    out.failing = (role, pred = () => true) => table.filter((x) => x.role === role && pred(x.ctx) && (x.unresolved || x.ratio < x.floor));
    out.at = (role, id) => table.find((x) => x.role === role && x.ctx.id === id);

    // [2] light byte-identical; tints and borders unchanged; warn != incomplete.
    out.lightDrift = table.filter((x) => x.role !== 'divider' && x.ctx.side === 'L' && !x.unresolved && x.color !== PRE_FIX[x.role]);
    out.shape = Object.fromEntries(['warn', 'incomplete'].map((l) => {
      const d = ruleBody(cssSrc, `.game-readiness-${l}`) || [];
      const v = (p) => (d.find((x) => x.prop === p) || {}).value || '';
      return [l, { bg: v('background'), border: v('border'), color: v('color') }];
    }));
    out.collapsed = CONTEXTS.filter((c) => { const w = out.at('warn', c.id), i = out.at('incomplete', c.id); return w && i && !w.unresolved && !i.unresolved && w.color === i.color; }).map((c) => c.id);

    // [3] the defect class, deny-by-default, and the token shape (DI-448 R1/R4/R6, A1.8).
    out.literalChip = all.filter((b) => /game-readiness/.test(b.prelude))
      .flatMap((b) => declsOf(b.body).filter((d) => d.prop === 'color' && !/^var\(/.test(d.value)).map((d) => `${b.prelude} { color: ${d.value} }`));
    out.preHexInProperty = all.flatMap((b) => declsOf(b.body).filter((d) => !d.prop.startsWith('--') && /#(8a5a00|9a1c1c)\b/i.test(d.value)).map((d) => `${b.prelude.slice(0, 60)} { ${d.prop}: ${d.value} }`));
    const rootDecls = all.filter((b) => b.prelude === ':root' && b.ctx.length === 0).flatMap((b) => declsOf(b.body));
    out.rootDecl = Object.fromEntries(rootDecls.filter((d) => [...CHIP_TOKENS, DIVIDER_TOKEN].includes(d.prop)).map((d) => [d.prop, d.value]));
    out.schoolWriters = all.filter((b) => isSchoolOnlyBlock(b.prelude)).filter((b) => declsOf(b.body).some((d) => [...CHIP_TOKENS, DIVIDER_TOKEN].includes(d.prop))).map((b) => b.prelude.slice(0, 60));
    const triggerDrift = (role) => ALL_THEME_KEYS.filter((k) => { const s = out.at(role, `${k}:D (system)`), p = out.at(role, `${k}:D (pinned)`); return !s || !p || s.unresolved || p.unresolved || s.color !== p.color; });
    out.triggerDrift = { warn: triggerDrift('warn'), incomplete: triggerDrift('incomplete'), divider: triggerDrift('divider') };
    out.paperDarkLightPair = ['system', 'pinned'].every((t) => ['warn', 'incomplete'].every((l) => { const x = out.at(l, `paper:D (${t})`); return x && !x.unresolved && x.color === PRE_FIX[l]; }));
    out.darkSurfaceRemapped = CONTEXTS.filter(darkSurface).every((c) => ['warn', 'incomplete'].every((l) => { const x = out.at(l, c.id); return x && !x.unresolved && x.color !== PRE_FIX[l]; }));

    // [6] SB-21's own structural checks.
    out.dividerLightDrift = table.filter((x) => x.role === 'divider' && x.ctx.side === 'L' && !x.unresolved && x.color !== DIVIDER_LIGHT);
    out.literalDivider = all.filter((b) => /chat-new-divider/.test(b.prelude))
      .flatMap((b) => declsOf(b.body).filter((d) => (d.prop === 'color' || /^background/.test(d.prop) || d.prop === 'border-color') && !/^var\(/.test(d.value)).map((d) => `${b.prelude} { ${d.prop}: ${d.value} }`));
    const dLabel = ruleBody(cssSrc, '.chat-new-divider') || [], dLines = ruleBody(cssSrc, '.chat-new-divider::before,.chat-new-divider::after') || [];
    out.dividerOneHue = { label: (dLabel.find((d) => d.prop === 'color') || {}).value || '', lines: (dLines.find((d) => d.prop === 'background') || {}).value || '' };
  }

  if (only !== 'contrast') {
    // [4] Reduce Motion, through the real cascade, both ways, on all 20 sides.
    const reduced = R.parseSheet(unwrapReduced(cssSrc));
    const motionTable = MOTION_ROLES.map((role) => ({ role, sides: [] }));
    for (const s of SIDES20) {
      const rn = R.resolveSide(sheet, s.key, s.side, 'system'), rr = R.resolveSide(reduced, s.key, s.side, 'system');
      MOTION_ROLES.forEach((role, i) => {
        const nn = mountMotionRole(rn.body, F, role), nr = mountMotionRole(rr.body, F, role);
        if (!nn || !nr) { motionTable[i].sides.push({ side: s.id, unresolved: 'chain not derived' }); return; }
        const runAnim = (R.computedProp(sheet, nn, 'animation', rn.ctx) || 'none').trim();
        const rmAnim = (R.computedProp(reduced, nr, 'animation', rr.ctx) || 'none').trim();
        const op = R.computedProp(reduced, nr, 'opacity', rr.ctx);
        motionTable[i].sides.push({ side: s.id, runAnim, rmAnim, rmOpacity: op === undefined ? 1 : parseFloat(op), node: nn });
      });
    }
    for (const row of motionTable) {
      const ok = row.sides.filter((x) => !x.unresolved);
      row.unresolved = row.sides.filter((x) => x.unresolved).map((x) => x.side);
      row.runBad = ok.filter((x) => (row.role.kind === 'still' ? x.runAnim !== 'none' : !/\binfinite\b/.test(x.runAnim))).map((x) => `${x.side} "${x.runAnim}"`);
      row.rmBad = ok.filter((x) => x.rmAnim !== 'none' || (row.role.kind === 'sb18' && x.rmOpacity < 1)).map((x) => `${x.side} "${x.rmAnim}" opacity ${x.rmOpacity}`);
      row.sample = ok[0] || {};
    }
    out.motionTable = motionTable;
    out.rmBroken = (rule) => motionTable.filter((x) => x.role.rule === rule).every((x) => x.unresolved.length === 0 && x.rmBad.length === SIDES20.length);

    // The net: every rule (outside a reduce block) whose animation loops forever needs a same-selector override, LATER in the
    // file, that does not loop, under conditions the base rule itself meets.
    const kf = keyframesOf(cssSrc);
    const animText = (decls) => decls.filter((d) => /^animation(-name|-iteration-count)?$/.test(d.prop)).map((d) => d.value).join(' ');
    const overrides = [];
    for (const b of all) if (isReduce(b.ctx)) {
      const a = animText(declsOf(b.body));
      if (a && !/\binfinite\b/.test(a)) overrides.push({ sels: selectorsOf(b.prelude), order: b.order, conds: condsOf(b.ctx) });
    }
    const infinite = [];
    for (const b of all) {
      if (isReduce(b.ctx)) continue;
      const a = animText(declsOf(b.body));
      if (!/\binfinite\b/.test(a)) continue;
      const bc = condsOf(b.ctx);
      const kfName = a.split(/[\s,]+/).find((t) => kf[t]);
      for (const sel of selectorsOf(b.prelude)) {
        infinite.push({ sel, anim: a, kfName, covered: overrides.some((o) => o.order > b.order && o.sels.includes(sel) && o.conds.every((c) => bc.includes(c))) });
      }
    }
    const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
    const rotateOnly = (name) => !!name && (kf[name] || []).length > 0 && kf[name].every((d) => d.prop === 'transform' && /^rotate\([^()]*\)$/.test(d.value.trim()));
    out.infinite = infinite;
    out.uncovered = infinite.filter((x) => !x.covered);
    out.unlisted = out.uncovered.filter((x) => !own(debt, x.sel) && !own(exempt, x.sel));
    out.debtRows = Object.keys(debt).map((sel) => ({ sel, stillUncovered: out.uncovered.some((x) => x.sel === sel) }));
    out.exemptRows = Object.keys(exempt).map((sel) => {
      const hits = infinite.filter((x) => x.sel === sel);
      return { sel, present: hits.length > 0, uncovered: hits.length > 0 && hits.every((x) => !x.covered), rotateOnly: hits.length > 0 && hits.every((x) => rotateOnly(x.kfName)), anim: hits.map((x) => x.anim).join(' | ') };
    });
  }
  return out;
}

/** .sync-syncing: does any shipped JS/HTML ever put the class on an element? */
async function syncSyncingWriters(extraSources = []) {
  const files = (await readdir(path.join(root, 'js'), { recursive: true })).filter((f) => f.endsWith('.js')).map((f) => path.join('js', f));
  files.push('index.html');
  const hits = [];
  const WRITER = /\bsync-syncing\b|sync-\$\{|['"`]sync-['"`]\s*\+/;
  for (const f of files) {
    const src = await readFile(path.join(root, f), 'utf8');
    src.split('\n').forEach((line, i) => { if (WRITER.test(line)) hits.push(`${f}:${i + 1}`); });
  }
  extraSources.forEach((s, i) => { if (WRITER.test(s)) hits.push(`synthetic#${i}`); });
  return hits;
}

// ═════════════════════════════════════════════════════════════════════════════
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let pass = 0, fail = 0;
  const assert = (cond, lbl) => { if (cond) { pass++; console.log('  ✅', lbl); } else { fail++; console.error('  ❌', lbl); } };
  const showTable = process.argv.includes('--table');
  const cssArg = process.argv.indexOf('--css');
  const cssPath = cssArg > -1 ? path.resolve(process.argv[cssArg + 1]) : path.join(root, 'css', 'styles.css');
  const cssSrc = await readFile(cssPath, 'utf8');
  const appSrc = await readFile(path.join(root, 'js', 'app.js'), 'utf8');
  const chatSrc = await readFile(path.join(root, 'js', 'chat-ui.js'), 'utf8');
  const dmSrc = await readFile(path.join(root, 'js', 'data-model.js'), 'utf8');

  console.log(`\n[readinessmotiontest] ${path.relative(root, cssPath)} through themeresolve.mjs (SP-52's 20-sided real cascade) + the real renderers`);
  const F = await renderFixtures();
  const A = analyze(cssSrc, F);
  const fmt = (x) => (x.unresolved ? `UNRESOLVED ${x.unresolved}` : `${x.ratio.toFixed(2)}:1 (${x.color} on ${x.bg})`);

  // ── [0] Fixtures ───────────────────────────────────────────────────────────
  console.log('\n[0] fixtures');
  const shippedKeys = [...dmSrc.matchAll(/\{\s*key:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert(shippedKeys.length === 10 && shippedKeys.every((k) => ALL_THEME_KEYS.includes(k)) && ALL_THEME_KEYS.every((k) => shippedKeys.includes(k)),
    `0-1: data-model.js THEMES (${shippedKeys.join(', ')}) are exactly the ten looks themeresolve resolves`);
  const neutralD = ['system', 'pinned'].map((t) => R.resolveSide(R.parseSheet(cssSrc), 'neutral', 'D', t).get('--bg-card'));
  assert(CONTEXTS.length === 40 && SIDES20.length === 20 && neutralD.every((v) => String(v).toUpperCase() === '#25201B'),
    `0-2: 40 contrast contexts (10 looks x Light/Dark x System/pinned) and 20 motion sides; Munera Dark's card is SP-52's lifted #25201B under both triggers (${neutralD.join(' / ')}) — the surface the pre-SP-52 suite could only emulate`);
  const lv = (gm) => F.readiness(gm).level;
  assert(lv(F.fixtures.warn) === 'warn' && lv(F.fixtures.inc) === 'incomplete' && lv(F.fixtures.ok) === 'ok',
    `0-3: gameDataReadiness() classifies the fixtures warn / incomplete / ok (${lv(F.fixtures.warn)} / ${lv(F.fixtures.inc)} / ${lv(F.fixtures.ok)})`);
  for (const level of ['warn', 'incomplete']) {
    const x = A.at(level, 'neutral:L (system)');
    const chip = x && x.chip;
    const card = chip && (() => { for (let y = chip.parent; y; y = y.parent) if (hasC(y, 'game-admin-card')) return y; return null; })();
    assert(!!(card && hasC(card, `game-admin-card-${level}`) && card.parent && card.parent.attrs.id === 'admin-games-list'),
      `0-4: renderAdminGamesList() really renders the ${level} chip inside .game-admin-card.game-admin-card-${level} under #admin-games-list (${chip ? label(chip) : 'NOT RENDERED'})`);
  }
  assert(!/game-readiness/.test(F.adminOkOnly), '0-5: a ready game renders no readiness chip (the fixtures are what make the chip appear)');
  assert(/<div class="admin-section" data-comm-tab="games">[\s\S]{0,600}?<div id="admin-games-list">\$\{renderAdminGamesList\(/.test(appSrc) &&
    /c\.innerHTML = sections\.join\('\\n'\)/.test(appSrc) && /c\.setAttribute\('data-comm-active'/.test(appSrc),
    '0-6: the chip mount is the real one: #page-commissioner (data-comm-active) > .admin-section[data-comm-tab="games"] > #admin-games-list');
  const templates = {
    header: /<span class="week-heading-name"><strong>\$\{escHtml\(wl\.name\)\}<\/strong><span class="badge badge-\$\{escHtml\(week\.status\)\} ml-sm">/,
    weekNav: /<div class="week-heading">\s*<span class="picks-week-nav-label">[^\n]*<span class="badge badge-\$\{escHtml\(viewWeek\.status\)\}">/,
    history: /class="hist-pick \$\{getResultBadgeClass\(res\)\}"/.test(appSrc) && /live:'badge-live'/.test(appSrc) ? /./ : /$^/,
    faq: /<div class="faq-stage"><span class="badge badge-live">LIVE<\/span>/,
    header_id: /getElementById\('header-meta-week'\)/,
  };
  const missingTpl = Object.entries(templates).filter(([, re]) => !re.test(appSrc)).map(([k]) => k);
  assert(missingTpl.length === 0 && /LIVE:'live'/.test(dmSrc.replace(/\s+/g, '')),
    `0-7: every .badge-live template this suite models exists in js/app.js — header week badge, week nav, History (getResultBadgeClass live -> badge-live), Rules FAQ (${missingTpl.length ? 'MISSING: ' + missingTpl.join(', ') : 'all found'})`);
  const chatTpl = {
    viewHeader: /<div class="chat-view-header\$\{headerCls\}">[\s\S]{0,400}?<div>\$\{g\.status === GAME_STATUS\.LIVE \? `<span class="live-pulse"><\/span> LIVE/,
    sheet: /<div class="chat-sheet-sub">[^\n]*\n\s*\$\{g\?\.status === GAME_STATUS\.LIVE \? ` · <span class="live-pulse"><\/span> LIVE/,
    sheetWrap: /wrap\.id = 'chat-sheet-wrap';/,
    sticky: /<div class="chat-sticky-stack">[\s\S]{0,700}?\$\{U\.searchOpen \? searchBarHTML\(\) : pillsHTML\(\)\}\s*\$\{viewHeader\}/,
  };
  const missingChat = Object.entries(chatTpl).filter(([, re]) => !re.test(chatSrc)).map(([k]) => k);
  assert(missingChat.length === 0,
    `0-8: every .live-pulse template this suite models exists in js/chat-ui.js — the pills and a game view's header inside .chat-sticky-stack, the sheet header's sub-line in #chat-sheet-wrap (${missingChat.length ? 'MISSING: ' + missingChat.join(', ') : 'all found'})`);
  assert(/class="chat-pill[^"]*chat-pill-live[^"]*"[^>]*>\s*<span class="live-pulse"><\/span>/.test(F.pills),
    '0-9: chat-ui pillsHTML() really renders a .chat-pill.chat-pill-live with its .live-pulse dot for a LIVE game on the current week (written through the storage seam)');
  assert(/<div class="score-status">🔴 LIVE<\/div>/.test(F.covering) && /<div class="score-status\$\{noPulseCls\}">/.test(appSrc) && /' score-status-no-pulse'/.test(appSrc),
    '0-10: renderGameCard() really renders the live card\'s <div class="score-status">🔴 LIVE</div>, and the template carries the approved still state (score-status-no-pulse, halftime/stale)');
  assert(/<div class="score-status score-status-no-pulse">FINAL<\/div>/.test(F.finalCard) && !/score-status-no-pulse/.test(F.covering),
    `0-10b: renderGameCard() renders a FINAL card's line as the static <div class="score-status score-status-no-pulse">FINAL</div> and a LIVE card's without it — only LIVE pulses (themes DI A1.10) (${(F.finalCard.match(/<div class="score-status[^"]*">[^<]*<\/div>/) || ['FINAL line not found'])[0]})`);
  const unresolvedMotion = A.motionTable.filter((x) => x.unresolved.length).map((x) => x.role.id);
  assert(unresolvedMotion.length === 0, `0-11: every motion role's element was derived on all 20 sides (${unresolvedMotion.join('; ') || 'all'})`);
  assert(['.game-readiness-warn', '.game-readiness-incomplete', '.badge-live', '.badge-live-covering', '.badge-live-trailing', '.pick-btn.live-covering', '.pick-btn.live-trailing', '.score-status', '.live-pulse', '.chat-new-divider'].every((s) => ruleBody(cssSrc, s)),
    '0-12: each of the ten rules this suite fixes is located exactly once (outside any @media) in styles.css');
  assert(!/animation-(name|iteration-count|play-state)\s*:/.test(stripComments(cssSrc)),
    '0-13: styles.css sets animations through the `animation` shorthand only, so resolving `animation` is the whole answer (no longhand can override it unseen)');
  const divCount = (F.divider.match(/class="chat-new-divider"/g) || []).length;
  assert(divCount === 1 && /<div class="chat-new-divider"><span>NEW<\/span><\/div>/.test(F.divider) && !/chat-new-divider/.test(F.noDivider),
    '0-14: chat-ui messageHTML(m, self, true) renders exactly one <div class="chat-new-divider"><span>NEW</span></div>, and showNewDivider=false renders none');
  assert(/<div class="chat-surface">\s*<div class="chat-scroll" id="chat-scroll">\s*\$\{scrollBodyHTML\}/.test(chatSrc) && /msgsHTML \+= messageHTML\(item, self, isNew\);/.test(chatSrc) &&
    /item\.kind === 'gamereact-run' \? gamereactRunHTML\(item\) : messageHTML\(item, self, false\)/.test(chatSrc),
    '0-15: the divider mount is the real one — renderChatPage() feeds messageHTML(item, self, isNew) into .chat-surface > #chat-scroll; the game sheet always passes false (the divider never renders there)');

  // ── [1] AA in all 40 contexts ──────────────────────────────────────────────
  console.log('\n[1] readiness chips — WCAG AA in every context (10 looks x Light/Dark x both triggers)');
  const chipRows = A.table.filter((x) => x.role !== 'divider');
  assert(chipRows.every((x) => !x.unresolved), `1-0: every chip resolved to a concrete colour pair in every context (${chipRows.filter((x) => x.unresolved).length} unresolved)`);
  for (const c of CONTEXTS) {
    const w = A.at('warn', c.id), i = A.at('incomplete', c.id);
    assert(!w.unresolved && !i.unresolved && w.ratio >= w.floor && i.ratio >= i.floor, `1-${c.id}: warn ${fmt(w)}, incomplete ${fmt(i)} >= 4.5`);
  }

  // ── [2] Light byte-identical; tint/border unchanged; warn != incomplete ────
  console.log('\n[2] light mode unchanged; the two states stay distinct');
  for (const key of ALL_THEME_KEYS) {
    const drift = A.lightDrift.filter((x) => x.ctx.key === key);
    assert(drift.length === 0, `2-L-${key}: on ${key}:L (both triggers) both chips resolve to the pre-fix literal (warn ${PRE_FIX.warn}, incomplete ${PRE_FIX.incomplete})${drift.length ? ' — DRIFT: ' + drift.map((d) => `${d.ctx.id} ${d.role} ${d.color}`).join('; ') : ''}`);
  }
  assert(A.shape.warn.bg === 'rgba(224,160,32,.12)' && A.shape.warn.border === '1px solid rgba(224,160,32,.3)' &&
    A.shape.incomplete.bg === 'rgba(185,28,28,.08)' && A.shape.incomplete.border === '1px solid rgba(185,28,28,.25)',
    `2-S: tints and borders are the pre-fix values, byte for byte — only the text colour moved (${JSON.stringify({ warn: A.shape.warn.bg, incomplete: A.shape.incomplete.bg })})`);
  assert(A.collapsed.length === 0, `2-D: warn and incomplete never resolve to the same text colour in any context (${A.collapsed.join(', ') || 'distinct everywhere'})`);

  // ── [3] Deny-by-default for the defect class; the token shape ──────────────
  console.log('\n[3] the defect class: no hardcoded readiness text; DI-448 R1/R4/R6 and A1.8');
  assert(A.literalChip.length === 0, `3-1: no .game-readiness* rule paints color: with a literal — tokens only, so a Dark side can reach it (${A.literalChip.join('; ') || 'clean'})`);
  assert(A.preHexInProperty.length === 0, `3-2: #8a5a00 / #9a1c1c live on only as custom-property VALUES (the tokens), never in a property declaration (${A.preHexInProperty.join('; ') || 'clean'})`);
  assert(CHIP_TOKENS.every((t) => /^#[0-9a-f]{6}$/i.test(A.rootDecl[t] || '')) && A.rootDecl[CHIP_TOKENS[0]].toUpperCase() === PRE_FIX.warn && A.rootDecl[CHIP_TOKENS[1]].toUpperCase() === PRE_FIX.incomplete,
    `3-3: --readiness-warn-text / --readiness-incomplete-text are LITERALS on :root equal to the pre-fix hexes (DI-448 R1) (${JSON.stringify({ w: A.rootDecl[CHIP_TOKENS[0]], i: A.rootDecl[CHIP_TOKENS[1]] })})`);
  assert(A.triggerDrift.warn.length === 0 && A.triggerDrift.incomplete.length === 0 && A.darkSurfaceRemapped,
    `3-4: on every Dark side both triggers resolve both chips to the SAME colour (R6), and every dark-SURFACE side (Munera, Ink, Graphite, six schools) reads a remapped value, never the light literal${A.triggerDrift.warn.length + A.triggerDrift.incomplete.length ? ' — DRIFT: ' + [...A.triggerDrift.warn, ...A.triggerDrift.incomplete].join(', ') : ''}`);
  assert(A.paperDarkLightPair, '3-5: Paper Dark (both triggers) reads the LIGHT pair at the chip — .game-admin-card is a paper root, so the chip sits on a light paper card (A1.8: the night pair is 2.49 / 2.42:1 there)');
  assert(A.schoolWriters.length === 0, `3-6: no school block declares a readiness or divider token — semantics, not school-owned (DI-448 R4) (${A.schoolWriters.join(', ') || 'clean'})`);
  const syncHits = await syncSyncingWriters();
  const syncFails = A.sync.filter((x) => !x.unresolved && x.ratio < x.floor);
  const syncWorst = Math.min(...A.sync.filter((x) => !x.unresolved).map((x) => x.ratio));
  assert(syncHits.length === 0 || syncFails.length === 0,
    `3-7: .sync-syncing is UNREACHABLE (no writer in js/ or index.html${syncHits.length ? ': ' + syncHits.join(', ') : ''}), or else clears AA everywhere — today ${syncHits.length ? 'REACHABLE' : 'unreachable'}; if it were reachable it would read ${syncWorst.toFixed(2)}:1 worst (dead CSS, reported, not fixed)`);

  // ── [4] Reduce Motion ──────────────────────────────────────────────────────
  console.log('\n[4] live indicators — still loop with motion allowed; animation:none at full opacity under prefers-reduced-motion:reduce (20 sides)');
  for (const row of A.motionTable) {
    if (row.unresolved.length) { assert(false, `4-x: ${row.role.id} — chain not derived on ${row.unresolved.join(', ')}`); continue; }
    if (row.role.kind === 'still') {
      assert(row.runBad.length === 0, `4-run: ${row.role.id} never loops, motion allowed or not (${row.runBad.join('; ') || row.sample.runAnim})`);
    } else {
      assert(row.runBad.length === 0, `4-run: ${row.role.id} still loops when motion is allowed — live stays soft (${row.runBad.join('; ') || row.sample.runAnim})`);
    }
    const what = row.role.kind === 'sb18' ? 'animation none, full opacity' : 'animation none';
    assert(row.rmBad.length === 0, `4-rm: ${row.role.id} under Reduce Motion: ${what} on all 20 sides (${row.rmBad.length ? row.rmBad.slice(0, 3).join('; ') + (row.rmBad.length > 3 ? ` (+${row.rmBad.length - 3})` : '') : `"${row.sample.rmAnim}", opacity ${row.sample.rmOpacity}`})`);
  }
  assert(A.unlisted.length === 0,
    `4-net: every infinite animation in styles.css has a same-selector prefers-reduced-motion override after it (under conditions the base rule meets), apart from the named MOTION_EXEMPT (${A.infinite.length} infinite rules; unlisted gaps: ${A.unlisted.map((x) => `${x.sel} {${x.anim}}`).join('; ') || 'none'})`);
  assert(Object.keys(KNOWN_MOTION_DEBT).length === 0,
    `4-debt: KNOWN_MOTION_DEBT is CLOSED (empty) — .score-status and .live-pulse were fixed here and .spinner is a named exemption; a new looping animation gets an override, never a debt entry (${Object.keys(KNOWN_MOTION_DEBT).join(', ') || 'empty'})`);
  assert(Object.keys(MOTION_EXEMPT).length === 1 && A.exemptRows.every((x) => x.present && x.uncovered && x.rotateOnly),
    `4-exempt: MOTION_EXEMPT holds exactly the one reviewed entry, which still loops, still has no override (else delete it — the list only shrinks) and is ROTATION-ONLY (a progress indicator, never a pulse) (${A.exemptRows.map((x) => `${x.sel}: present ${x.present}, uncovered ${x.uncovered}, rotate-only ${x.rotateOnly} — ${MOTION_EXEMPT[x.sel]}`).join('; ')})`);

  // ── [5] Mutation proof (SB-18) — in memory, never on disk, never git ───────
  console.log('\n[5] mutation proof (SB-18) — each part of the fix reverted in memory must go RED');
  // A mutation whose target is missing returns null (and its own "target found" check is RED); every effect assertion below
  // requires a real mutant (`!!m && …`), so no effect check can pass vacuously on an unmutated copy.
  const mutate = (src, from, to, lbl) => {
    if (src == null) { assert(false, `pre: mutation target found — ${lbl} (the previous step of this mutant was not found)`); return null; }
    const out = src.split(from).join(to); const ok = out !== src; assert(ok, `pre: mutation target found — ${lbl}`); return ok ? out : null;
  };
  const runC = (src) => (src == null ? null : analyze(src, F, { only: 'contrast' }));
  const runM = (src, opts = {}) => (src == null ? null : analyze(src, F, { only: 'motion', ...opts }));
  const DARK_SURFACE_IDS = CONTEXTS.filter(darkSurface).map((c) => c.id);
  const redOnAll = (a, role, ids) => ids.every((id) => a.failing(role, (c) => c.id === id).length === 1);
  {
    const m = runC(mutate(cssSrc, 'color:var(--readiness-warn-text)', 'color:#8a5a00', 'warn chip text back to #8a5a00'));
    assert(!!m && redOnAll(m, 'warn', DARK_SURFACE_IDS) && m.literalChip.length === 1, `5-1: warn chip text back to #8a5a00 → [1] RED on all ${DARK_SURFACE_IDS.length} dark-surface contexts and [3-1] RED`);
  }
  {
    const m = runC(mutate(cssSrc, 'color:var(--readiness-incomplete-text)', 'color:#9a1c1c', 'incomplete chip text back to #9a1c1c'));
    assert(!!m && redOnAll(m, 'incomplete', DARK_SURFACE_IDS) && m.literalChip.length === 1, `5-2: incomplete chip text back to #9a1c1c → [1] RED on all ${DARK_SURFACE_IDS.length} dark-surface contexts and [3-1] RED`);
  }
  {
    const m = runC(mutate(cssSrc, '--readiness-warn-text:#BC9839;', '--readiness-warn-text:#8a5a00;', 'every night value of the warn token set to the light literal'));
    assert(!!m && redOnAll(m, 'warn', DARK_SURFACE_IDS) && !m.darkSurfaceRemapped, '5-3: every night --readiness-warn-text set to the light literal → [1] and [3-4] RED (the token, not just the call site, is load-bearing)');
  }
  {
    // the manual Block A is an enumerated selector list; its LAST selector sits right before the `{` (pickcontrasttest 4-7's anchor)
    const manualAt = cssSrc.indexOf('body.theme-razorback[data-color-scheme="dark"] {');
    const head = cssSrc.slice(0, manualAt), tail = cssSrc.slice(manualAt);
    const tailM = tail.replace(/\n\s*--readiness-warn-text:[^;]+;/, '').replace(/\n\s*--readiness-incomplete-text:[^;]+;/, '');
    const ok = manualAt > 0 && tailM !== tail;
    assert(ok, 'pre: mutation target found — both tokens dropped from the MANUAL Block A only');
    const m = ok ? runC(head + tailM) : null;
    const blockA = ['neutral', 'ink', ...SCHOOLS];
    assert(!!m && blockA.every((k) => m.failing('warn', (c) => c.id === `${k}:D (pinned)`).length === 1) && blockA.every((k) => m.failing('warn', (c) => c.id === `${k}:D (system)`).length === 0),
      '5-4: both tokens dropped from the manual-toggle Block A only → RED for the pinned trigger on all eight Block-A looks, still GREEN for the System trigger (checked separately, never assumed identical)');
  }
  {
    const m = runC(mutate(cssSrc, '--readiness-warn-text:#8a5a00;', '--readiness-warn-text:#7A6000;', "light warn token set to --warning-text's #7A6000"));
    assert(!!m && m.lightDrift.length > 0, "5-5: light warn token set to --warning-text's light #7A6000 → [2-L] RED (light no longer byte-identical) — why the warn chip needs its own token");
  }
  {
    const m = runC(mutate(mutate(cssSrc, '--readiness-warn-text:#8A5A00;', '--readiness-warn-text:#BC9839;', "the paper scope's warn value set to the night value"), '--readiness-incomplete-text:#9A1C1C;', '--readiness-incomplete-text:#F87171;', "the paper scope's incomplete value set to the night value"));
    assert(!!m && ['system', 'pinned'].every((t) => m.failing('warn', (c) => c.id === `paper:D (${t})`).length === 1 && m.failing('incomplete', (c) => c.id === `paper:D (${t})`).length === 1),
      "5-6: the paper scope's readiness pair set to the night pair → RED on Paper Dark, both triggers (A1.8's per-look rule is load-bearing: the chip sits on a LIGHT paper card)");
  }
  {
    const m = runM(mutate(cssSrc, '@media (prefers-reduced-motion:reduce){.badge-live{animation:none}}', '', '.badge-live reduced-motion override removed'));
    assert(!!m && m.rmBroken('.badge-live') && m.unlisted.some((x) => x.sel === '.badge-live'), '5-7: .badge-live override removed → [4-rm] RED at all five render sites and [4-net] RED');
  }
  const picksOverride = '.pick-btn.live-covering,.pick-btn.live-trailing,.badge-live-covering,.badge-live-trailing{animation:none}';
  const PICKS_RULES = ['.badge-live-covering', '.badge-live-trailing', '.pick-btn.live-covering', '.pick-btn.live-trailing'];
  {
    const m = runM(mutate(cssSrc, picksOverride, '', 'the Picks live badges/buttons override removed'));
    assert(!!m && PICKS_RULES.every((r) => m.rmBroken(r)) && m.unlisted.length === 4, '5-8: the Picks live badge/button override removed → [4-rm] RED for all four rules and [4-net] RED (4 unlisted)');
  }
  {
    const m = runM(mutate(cssSrc, '.badge-live{animation:none}}', '.badge-live{animation:none;opacity:.5}}', '.badge-live override dims instead of holding'));
    assert(!!m && m.rmBroken('.badge-live') && m.unlisted.length === 0, '5-9: override stops the pulse but dims to .5 → [4-rm] RED (full opacity is load-bearing), while [4-net] stays GREEN — the two checks are independent');
  }
  {
    const removed = cssSrc.split(picksOverride).join('');
    const anchor = '.pick-btn.live-covering{border-color:#92c97d';
    const ok = removed !== cssSrc && removed.includes(anchor);
    assert(ok, 'pre: mutation target found — the Picks override moved ABOVE the rules it overrides');
    const m = ok ? runM(removed.replace(anchor, `@media (prefers-reduced-motion:reduce){${picksOverride}}\n${anchor}`)) : null;
    assert(!!m && PICKS_RULES.every((r) => m.rmBroken(r)) && m.unlisted.length === 4, '5-10: the same override placed BEFORE the base rules → [4-rm] and [4-net] RED (equal specificity, source order decides — a present-but-losing override is caught)');
  }
  {
    const m = runM(cssSrc + '\n.sb18-probe{animation:pulse 1s infinite}\n');
    assert(!!m && m.unlisted.some((x) => x.sel === '.sb18-probe'), '5-11: a NEW infinite animation without an override → [4-net] RED (the net is deny-by-default, not a list)');
  }
  {
    // RETARGETED (SB-18 review, merge condition 2): the old probe was `.score-status`, a KNOWN_MOTION_DEBT entry this fix closes. The
    // ratchet now lives on MOTION_EXEMPT, so the probe is its one entry: an exempt spinner that gains an override is STALE until deleted.
    const m = runM(cssSrc + '\n@media (prefers-reduced-motion:reduce){.spinner{animation:none}}\n');
    assert(!!m && m.exemptRows.some((x) => x.sel === '.spinner' && !x.uncovered), '5-12: the exempt .spinner gains a Reduce Motion override → [4-exempt] RED until the entry is deleted (the exemption list can only shrink)');
  }
  {
    const m = runM(mutate(cssSrc, '@media (prefers-reduced-motion:reduce){.badge-live{animation:none}}', '', '.badge-live override removed (for the exemption-shape probe)'), { exempt: { ...MOTION_EXEMPT, '.badge-live': 'a pulse filed as an exemption' } });
    assert(!!m && m.unlisted.length === 0 && m.exemptRows.some((x) => x.sel === '.badge-live' && !x.rotateOnly), '5-13: a pulse filed in MOTION_EXEMPT (.badge-live) silences [4-net] but turns [4-exempt] RED — only a rotation-only progress indicator may be exempt');
  }
  {
    const m = runM(mutate(cssSrc, '@media (prefers-reduced-motion:reduce){.score-status{animation:none}}', '', '.score-status reduced-motion override removed'));
    const still = m && m.motionTable.find((x) => x.role.rule === '.score-status-no-pulse');
    assert(!!m && m.rmBroken('.score-status') && m.unlisted.some((x) => x.sel === '.score-status') && still && still.rmBad.length === 0,
      '5-14: .score-status override removed → [4-rm] RED for the Picks "🔴 LIVE" line and [4-net] RED, while the halftime/stale state (score-status-no-pulse) stays still on its own');
  }
  {
    const m = runM(mutate(cssSrc, '@media (prefers-reduced-motion:reduce){.live-pulse{animation:none}}', '', '.live-pulse reduced-motion override removed'));
    assert(!!m && m.rmBroken('.live-pulse') && m.motionTable.filter((x) => x.role.rule === '.live-pulse').length === 3 && m.unlisted.some((x) => x.sel === '.live-pulse'),
      '5-15: .live-pulse override removed → [4-rm] RED at all three Chat sites (game pill, thread header, sheet header) and [4-net] RED');
  }
  {
    const removed = cssSrc.split('@media (prefers-reduced-motion:reduce){.live-pulse{animation:none}}').join('');
    const anchor = '.live-pulse{display:inline-block';
    const ok = removed !== cssSrc && removed.includes(anchor);
    assert(ok, 'pre: mutation target found — the .live-pulse override moved ABOVE its base rule');
    const m = ok ? runM(removed.replace(anchor, `@media (prefers-reduced-motion:reduce){.live-pulse{animation:none}}\n${anchor}`)) : null;
    assert(!!m && m.rmBroken('.live-pulse') && m.unlisted.some((x) => x.sel === '.live-pulse'), '5-16: the .live-pulse override placed BEFORE its base rule → [4-rm] and [4-net] RED (source order decides)');
  }
  {
    const m = runM(mutate(cssSrc, '@media (prefers-reduced-motion:reduce){.score-status{animation:none}}', '@media (min-width:600px) and (prefers-reduced-motion:reduce){.score-status{animation:none}}', '.score-status override narrowed to wide screens'));
    assert(!!m && m.rmBroken('.score-status') && m.unlisted.some((x) => x.sel === '.score-status'), '5-17: the .score-status override narrowed to `(min-width:600px) and (…reduce)` → [4-rm] and [4-net] RED (a phone is not covered by a wide-screen query)');
  }
  {
    const hits = await syncSyncingWriters(['chatEl.className = \'sync-badge sync-syncing\';']);
    assert(hits.length > 0 && syncFails.length > 0, `5-18: a writer that makes .sync-syncing reachable → [3-7] RED (its own ${syncFails.length ? Math.min(...syncFails.map((x) => x.ratio)).toFixed(2) : '?'}:1 would then have to be fixed)`);
  }
  {
    // themes DI A1.10: the FINAL card's markup without the static treatment (what renderGameCard() emitted before) — the line must LOOP again,
    // with motion allowed, on every side. (The on-disk proof that renderGameCard() itself is load-bearing is a scratch-tree app.js mutant.)
    const stripped = F.finalCard.split(' score-status-no-pulse">FINAL').join('">FINAL');
    const ok = stripped !== F.finalCard;
    assert(ok, 'pre: mutation target found — the FINAL card rendered without score-status-no-pulse');
    const m = ok ? analyze(cssSrc, { ...F, finalCard: stripped }, { only: 'motion' }) : null;
    const fin = m && m.motionTable.find((x) => x.role.rule === '.score-status-final');
    assert(!!fin && fin.runBad.length === SIDES20.length && fin.runBad.every((s) => /\binfinite\b/.test(s)),
      `5-19: a FINAL card rendered as before A1.10 (no score-status-no-pulse) → [4-run] RED on all 20 sides — the settled "FINAL" line loops again (${fin ? fin.runBad[0] || 'still' : 'no row'})`);
  }

  // ── [6] SB-21: Chat's "NEW" unread divider ─────────────────────────────────
  console.log('\n[6] SB-21 — the Chat "NEW" divider: WCAG AA in every context; light unchanged; one token');
  const divRows = A.table.filter((x) => x.role === 'divider');
  assert(divRows.every((x) => !x.unresolved), `6-0: the divider resolved to a concrete colour pair in every context (${divRows.filter((x) => x.unresolved).length} unresolved)`);
  for (const c of CONTEXTS) {
    const d = A.at('divider', c.id);
    assert(!d.unresolved && d.ratio >= d.floor, `6-${c.id}: "NEW" ${fmt(d)} >= ${d.floor || 4.5}`);
  }
  for (const key of ALL_THEME_KEYS) {
    const drift = A.dividerLightDrift.filter((x) => x.ctx.key === key);
    assert(drift.length === 0, `6-L-${key}: on ${key}:L (both triggers) the divider resolves to the pre-fix ${DIVIDER_LIGHT}${drift.length ? ' — DRIFT: ' + drift.map((d) => `${d.ctx.id} ${d.color}`).join('; ') : ''}`);
  }
  assert(A.literalDivider.length === 0, `6-1: no .chat-new-divider* rule paints its label or hairlines with a literal — tokens only (${A.literalDivider.join('; ') || 'clean'})`);
  assert(A.dividerOneHue.label === `var(${DIVIDER_TOKEN})` && A.dividerOneHue.lines === `var(${DIVIDER_TOKEN})`,
    `6-2: the label and its two hairlines read ONE token, ${DIVIDER_TOKEN} — one hue, as the single literal was (label ${A.dividerOneHue.label || '—'}, hairlines ${A.dividerOneHue.lines || '—'})`);
  assert(/^#[0-9a-f]{6}$/i.test(A.rootDecl[DIVIDER_TOKEN] || '') && A.rootDecl[DIVIDER_TOKEN].toUpperCase() === DIVIDER_LIGHT,
    `6-3: ${DIVIDER_TOKEN} is a LITERAL on :root equal to the pre-fix ${DIVIDER_LIGHT} (DI-448 R1) (${A.rootDecl[DIVIDER_TOKEN] || 'not declared'})`);
  assert(A.triggerDrift.divider.length === 0, `6-4: on every Dark side both triggers resolve the divider to the SAME colour (R6)${A.triggerDrift.divider.length ? ' — DRIFT: ' + A.triggerDrift.divider.join(', ') : ''}`);
  const paperDiv = ['system', 'pinned'].map((t) => A.at('divider', `paper:D (${t})`));
  assert(paperDiv.every((x) => x && !x.unresolved && x.color === DIVIDER_LIGHT && R.relLuminance(R.parseColor(x.bg).rgb) > 0.5),
    `6-5: Paper Dark (both triggers): .chat-surface is a paper root, so the divider sits on LIGHT paper and reads the LIGHT ${DIVIDER_LIGHT} (themes DI A1.10, the A1.7 rule) (${paperDiv.map(fmt).join(' | ')})`);

  // ── [7] Mutation proof (SB-21) ─────────────────────────────────────────────
  console.log('\n[7] mutation proof (SB-21) — each part of the fix reverted in memory must go RED');
  const DARK_IDS = CONTEXTS.filter((c) => c.side === 'D').map((c) => c.id);
  const darkOf = (keys, trig) => keys.flatMap((k) => (trig ? [trig] : ['system', 'pinned']).map((t) => `${k}:D (${t})`));
  const divRed = (m, ids) => !!m && redOnAll(m, 'divider', ids);
  const divGreen = (m, ids) => !!m && ids.every((id) => m.failing('divider', (c) => c.id === id).length === 0);
  {
    // RE-DERIVED (themes DI A1.10): Paper Dark's thread is now a LIGHT paper card, where the literal reads 5.66:1 — so the literal is RED on every
    // dark-SURFACE context (18), not all 20 Dark ones; [6-1] stays RED everywhere (deny-by-default on the literal itself).
    const m = runC(mutate(cssSrc, `color:var(${DIVIDER_TOKEN})`, `color:${DIVIDER_LIGHT}`, 'divider label back to #B02A37'));
    assert(divRed(m, DARK_SURFACE_IDS) && divGreen(m, darkOf(['paper'])) && m.literalDivider.length === 1,
      `7-1: divider label back to ${DIVIDER_LIGHT} → [6] RED on all ${DARK_SURFACE_IDS.length} dark-surface contexts (legible only on Paper Dark's light paper) and [6-1] RED`);
  }
  {
    const m = runC(mutate(cssSrc, `background:var(${DIVIDER_TOKEN});opacity:.5`, `background:${DIVIDER_LIGHT};opacity:.5`, 'divider hairlines back to #B02A37'));
    assert(!!m && m.literalDivider.length === 1 && m.dividerOneHue.lines !== `var(${DIVIDER_TOKEN})` && divGreen(m, DARK_IDS), '7-2: hairlines back to the literal → [6-1] and [6-2] RED while the label stays GREEN (the hairline check is its own)');
  }
  const darkVal = (A.at('divider', 'neutral:D (system)') || {}).color || '(none)';
  {
    const at = cssSrc.indexOf('body.theme-neutral:not([data-color-scheme="light"]),');
    const head = cssSrc.slice(0, at), tail = cssSrc.slice(at);
    const tailM = tail.replace(new RegExp(`\\n\\s*${DIVIDER_TOKEN}:[^;]+;`), '');
    const ok = at > 0 && tailM !== tail;
    assert(ok, 'pre: mutation target found — the token dropped from the System-trigger Block A only');
    const m = ok ? runC(head + tailM) : null;
    const blockA = ['neutral', 'ink', ...SCHOOLS];
    assert(divRed(m, darkOf(blockA, 'system')) && divGreen(m, darkOf(blockA, 'pinned')), '7-3: the token dropped from the System-trigger Block A only → RED on all eight Block-A looks under System, still GREEN pinned (each trigger checked on its own)');
  }
  {
    const re = new RegExp(`(body\\.theme-graphite(?::not\\(\\[data-color-scheme="light"\\]\\)|\\[data-color-scheme="dark"\\]) \\{[^}]*?)\\n\\s*${DIVIDER_TOKEN}:[^;]+;`, 'g');
    const src = cssSrc.replace(re, '$1');
    const ok = (cssSrc.match(re) || []).length === 2;
    assert(ok, 'pre: mutation target found — the token dropped from both Graphite Dark blocks');
    const m = ok ? runC(src) : null;
    assert(divRed(m, darkOf(['graphite'])) && divGreen(m, darkOf(['neutral', 'paper'])), "7-4: the token dropped from Graphite Dark → RED there (it is not in Block A and inherits :root's light value), Munera and Paper unaffected — why Graphite declares its own");
  }
  // The A1.10 pair, as it appears in the stylesheet: `.chat-surface,` right after `.chat-scroll,` in both paper-scope root lists, and the LIGHT value right after
  // --readiness-incomplete-text in both paper-scope blocks (the uppercase #9A1C1C is the scope's own; :root's is lowercase).
  const SCOPE_TOKEN_RE = new RegExp(`(--readiness-incomplete-text:#9A1C1C;)\\n[ \\t]*${DIVIDER_TOKEN}:${DIVIDER_LIGHT};`, 'g');
  const ROOT_LINE_RE = /\n[ \t]*\.chat-surface,(?=\n)/g;
  const addRoot = (src) => src.replace(/(\n[ \t]*)\.chat-scroll,\n/g, '$1.chat-scroll,$1.chat-surface,\n');
  const addScopeToken = (src) => src.replace(/(\n([ \t]*)--readiness-incomplete-text:#9A1C1C;)/g, `$1\n$2${DIVIDER_TOKEN}:${DIVIDER_LIGHT};`);
  {
    // RE-DERIVED (themes DI A1.10): the divider now sits on a paper root in Paper Dark, so the value that matters there is the paper SCOPE's, not the page block's.
    const ok = (cssSrc.match(SCOPE_TOKEN_RE) || []).length === 2;
    assert(ok, 'pre: mutation target found — the paper scope\'s --chat-new-text (both triggers)');
    const m = ok ? runC(cssSrc.replace(SCOPE_TOKEN_RE, `$1\n    ${DIVIDER_TOKEN}:#DE747E;`)) : null;
    assert(divRed(m, darkOf(['paper'])) && divGreen(m, darkOf(['neutral', 'graphite'])),
      '7-5: the paper scope declares the Dark #DE747E instead of the light value → RED on Paper Dark, both triggers (A1.10: inside Paper\'s light scope the token takes the LIGHT value, the A1.7 rule); Munera and Graphite unaffected');
  }
  {
    const m = runC(mutate(cssSrc, `${DIVIDER_TOKEN}:${DIVIDER_LIGHT};`, `${DIVIDER_TOKEN}:#B91C1C;`, "light token set to --loss's #B91C1C"));
    assert(!!m && m.dividerLightDrift.length === 20, "7-6: light token set to --loss's #B91C1C → [6-L] RED on all 20 Light contexts (light no longer byte-identical) — why the divider needs its own token");
  }
  {
    // THE A1.10 PAIR, proved FORWARD from the pre-A1.10 stylesheet (f6b2d64: .chat-surface not a paper root, no scope value — there the divider read the
    // page block's #DE747E on the dark page-context .chat-surface). Paper root and scope value only work TOGETHER: either one alone is RED.
    const roots = (cssSrc.match(ROOT_LINE_RE) || []).length, toks = (cssSrc.match(SCOPE_TOKEN_RE) || []).length;
    assert(roots === 2 && toks === 2, `pre: mutation target found — the A1.10 pair in both triggers (.chat-surface root lines ${roots}/2, scope values ${toks}/2)`);
    const pre = roots === 2 && toks === 2 ? cssSrc.replace(ROOT_LINE_RE, '').replace(SCOPE_TOKEN_RE, '$1') : null;
    const m0 = pre ? runC(pre) : null;
    assert(divGreen(m0, darkOf(['paper'])), '7-7a: the pre-A1.10 stylesheet (neither half) → the divider alone is GREEN on Paper Dark (page value on a dark card) — the forward proof\'s base; themetest [T11] is what catches that thread\'s day separator and timestamps (2.60:1)');
    const m1 = pre ? runC(addRoot(pre)) : null;
    assert(divRed(m1, darkOf(['paper'])), `7-7: .chat-surface made a paper root with NO scope value → RED on Paper Dark, both triggers (${darkVal} on light paper) — the root cannot land alone`);
    const m2 = pre ? runC(addScopeToken(pre)) : null;
    assert(divRed(m2, darkOf(['paper'])), `7-7b: the scope value with NO .chat-surface root → RED on Paper Dark (${DIVIDER_LIGHT} on the dark page-context .chat-surface) — the value cannot land alone`);
    const both = pre ? addScopeToken(addRoot(pre)) : null;
    const m3 = both ? runC(both) : null;
    assert(!!m3 && both === cssSrc && m3.table.filter((x) => x.role === 'divider').every((x) => !x.unresolved && x.ratio >= x.floor),
      `7-8: root AND scope value → GREEN in all 40 contexts, and the two-part change rebuilds the shipped stylesheet BYTE FOR BYTE (A1.10 is exactly this pair, nothing else)`);
  }

  // ── Printed, not asserted ──────────────────────────────────────────────────
  console.log('\n  NOTE KNOWN_MOTION_DEBT: closed (empty). MOTION_EXEMPT: ' + Object.entries(MOTION_EXEMPT).map(([k, v]) => `${k} — ${v}`).join('; '));
  console.log('  NOTE .sync-syncing ratios (dead CSS; printed for the record): ' + A.sync.filter((x) => ['neutral:L (system)', 'neutral:D (system)'].includes(x.ctx.id)).map((x) => `${x.ctx.id} ${fmt(x)}`).join(' | '));
  if (showTable) {
    console.log('\n── full table (worst text element per role; ratios are text:background) ──');
    for (const x of A.table) console.log(`  ${x.ctx.id.padEnd(28)} ${x.role.padEnd(11)} ${fmt(x)}${x.unresolved ? '' : ` ${x.px.toFixed(1)}px/${x.wt}`}`);
    for (const x of A.motionTable) console.log(`  motion  ${x.role.id.padEnd(66)} run "${x.sample.runAnim}"  reduce "${x.sample.rmAnim}" opacity ${x.sample.rmOpacity}`);
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  // Same double-armed exit as pickcontrasttest.mjs: app.js is imported, so never rely on the event loop draining on its own.
  process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 8000).unref();
}
