/**
 * CFB Pickems — pickcontrasttest.mjs (SB-17 PICKS-LIVE-CONTRAST, Social
 * Platform thread, bugfixer, 2026-10-01)
 * ============================================================================
 * Found by the reviewer of SB-06 (pre-existing): on the PICKS page in night
 * mode, the live pick-state text was never remapped. Four rules painted text
 * with a hardcoded light-mode hex that no night-mode token could reach:
 *
 *   .pick-btn.live-covering   color:#2d6b1a      .badge-live-covering  color:#2d6b1a
 *   .pick-btn.live-trailing   color:#8b1a1a      .badge-live-trailing  color:#8b1a1a
 *
 * In Munera Dark they measured 1.29 to 2.16:1 (WCAG AA is 4.5:1) — worse than
 * the dashboard text SB-06 had just fixed. CONVENTIONS #13.
 *
 * WHY NOTHING CAUGHT IT
 * ---------------------
 * contrastscan.mjs deliberately skips translucent rgba() backgrounds and names
 * `.badge-live-covering` as one it skips (its TRANSLUCENT_COMPOSITE_SELECTORS
 * comment). dashcontrasttest.mjs (SB-06) models the dashboard and the chat
 * header only, and its deny-scan [3-2] covers only the dashboard's two hexes.
 * The Picks page's own live hexes sat outside every net.
 *
 * WHAT THIS PROVES
 * ----------------
 *   [0] Fixtures. The element stacks are DERIVED from the real markup:
 *       renderGameCard() (js/app.js) is rendered in Node and each badge's and
 *       button's ancestor chain is read out of the HTML, so the model follows
 *       the template rather than a hand-written guess. Includes the alma-mater
 *       card, whose header paints --maroon-pale instead of --bg-card-alt.
 *   [1] Every live pick-state text role on the Picks page clears WCAG AA
 *       (4.5:1 normal, 3:1 large) in EVERY theme map — the bare :root, the six
 *       school themes, Munera, and Munera night mode via BOTH triggers (the
 *       prefers-color-scheme block and the manual [data-color-scheme="dark"]
 *       block, parsed separately). Same composited-surface method and the
 *       same resolver as dashcontrasttest.mjs (imported, not copied):
 *       page -> card -> header/body -> element, translucent tints composited,
 *       worst case taken.
 *   [2] Light mode is byte-identical (every light map resolves the four rules
 *       to the pre-fix literals), and live stays distinct from final: the
 *       translucent tint and the running animation are kept, and the live
 *       text/background pair never equals its final twin's (.badge-win /
 *       .badge-loss / .pick-btn.locked-win / .pick-btn.locked-loss).
 *   [3] Deny-by-default for the defect CLASS: no rule whose selector names a
 *       live covering/trailing state paints `color:` with a literal; the two
 *       pre-fix hexes live on only as :root token values; the two tokens are
 *       literals on :root (DI-448 R1), identical in both dark blocks (R6), and
 *       never declared by a school block (R4: semantics, not school-owned).
 *   [4] Mutation proof, in memory: each part of the fix reverted on a string
 *       copy must turn the matching check RED (never a working-tree write).
 *
 * NOT ASSERTED, PRINTED (see the NOTE lines):
 *   - Reachability. renderGameCard() only adds .live-covering/.live-trailing
 *     to a .pick-btn when showResult is true, and it renders .pick-buttons
 *     only when showResult is false, so the two .pick-btn rules are
 *     unreachable in today's markup. They are still fixed and still measured
 *     (a latent rule must not keep a light-only hex); the suite prints the
 *     reachability scan so the reader knows which surface a player can see.
 *   - The `pulse` trough. .badge-live-* run `animation:pulse`, which dims the
 *     whole badge to opacity .5 at mid-cycle. Neither this suite's resolver
 *     nor dashcontrasttest/contrastscan treats an opacity keyframe as the
 *     at-rest state; the trough ratios are printed for information.
 *
 * Run:  node pickcontrasttest.mjs              (assertions)
 *       node pickcontrasttest.mjs --table      (also prints every ratio)
 *       node pickcontrasttest.mjs --css <path> (scan another styles.css —
 *                                               used for the on-disk
 *                                               mutation proof)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildThemes, collectRules, evaluateRole } from './dashcontrasttest.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

// ─── DOM / localStorage stubs (tbdtest.mjs / slatetest.mjs shape) ────────────
// Only so js/app.js can be imported and renderGameCard() called in Node.
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
globalThis.fetch = async () => { throw new Error('network disabled in pickcontrasttest'); };

// ─── Small local helpers ─────────────────────────────────────────────────────
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');
const isDark = (t) => /dark/.test(t);
// SP-52 (A1.7): Munera Paper Dark paints LIGHT paper cards (.game-card is one of its paper roots), so its map carries the LIGHT pair of these tokens; every other Dark
// side — Munera, Ink, Graphite and the six schools — is a dark surface that carries the remapped pair.
const isDarkSurface = (t) => isDark(t) && !/^paper/.test(t);

/** Every top-level (or @media-nested) rule as { prelude, body }. */
function allRuleBlocks(css) {
  const out = [];
  (function walk(src) {
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
      else if (prelude.startsWith('@')) walk(body);
      else out.push({ prelude, body });
      i = k;
    }
  })(stripComments(css));
  return out;
}
function declsOf(body) {
  return body.split(';').map((d) => {
    const i = d.indexOf(':');
    return i === -1 ? null : { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
  }).filter((d) => d && d.prop);
}
/** @keyframes name -> [{prop, value}] — every declaration in every frame. */
function keyframesOf(css) {
  const kf = {};
  const src = stripComments(css);
  for (const m of src.matchAll(/@keyframes\s+([a-zA-Z0-9_-]+)\s*\{/g)) {
    let depth = 1, k = m.index + m[0].length;
    while (k < src.length && depth > 0) { if (src[k] === '{') depth++; else if (src[k] === '}') depth--; k++; }
    const inner = src.slice(m.index + m[0].length, k - 1);
    kf[m[1]] = [...inner.matchAll(/\{([^{}]*)\}/g)].flatMap((f) => declsOf(f[1]));
  }
  return kf;
}
/** The declarations of the ONE plain rule whose whole prelude is `sel`. */
function ruleBody(css, sel) {
  const hits = allRuleBlocks(css).filter((b) => b.prelude === sel);
  return hits.length === 1 ? declsOf(hits[0].body) : null;
}

// ─── Markup: the real renderGameCard() output, walked into element chains ────
const VOID = new Set(['img', 'br', 'input', 'meta', 'link', 'hr', 'source', 'wbr']);
/** Ancestor chains (outermost first, element last) of every element in `html`
 *  matching `pred`. Nodes are shaped for dashcontrasttest's selector matcher. */
function chainsIn(html, pred) {
  const stack = []; const found = [];
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g)) {
    const [, close, tagRaw, attrsRaw] = m; const tag = tagRaw.toLowerCase();
    if (close) { for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; } continue; }
    // (?:^|\s) — never `data-class=` / `data-game-id=`: `\b` would match the
    // tail of a hyphenated data-* attribute and invent an #id a selector could hit.
    const cls = ((attrsRaw.match(/(?:^|\s)class="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean);
    const id = (attrsRaw.match(/(?:^|\s)id="([^"]*)"/) || [])[1];
    const node = { tag, cls, attrs: id ? { id } : {} };
    if (pred(node)) found.push([...stack, node]);
    if (!VOID.has(tag) && !/\/\s*$/.test(attrsRaw)) stack.push(node);
  }
  return found;
}
const has = (n, c) => (n.cls || []).includes(c);
const label = (chain) => chain.map((n) => n.tag + (n.attrs?.id ? '#' + n.attrs.id : '') + n.cls.map((c) => '.' + c).join('')).join(' > ');

// The page the cards are injected into (index.html section + the Picks
// renderers' list containers, js/app.js renderSubmittedView / the draft list).
const BODY = { tag: 'body' };
const MAIN = { tag: 'main', cls: ['main-content'], attrs: {} };
const PICKS = { tag: 'section', cls: ['page-section', 'active'], attrs: { id: 'page-picks' } };
const SUBMITTED = [BODY, MAIN, PICKS, { tag: 'div', cls: [], attrs: { id: 'submitted-games' } }];
const DRAFT = [BODY, MAIN, PICKS, { tag: 'div', cls: [], attrs: { id: 'games-list' } }];

async function renderFixtures() {
  const dm = await import('./js/data-model.js');
  const app = await import('./js/app.js');
  const { GAME_STATUS, PICK_RESULT, createGame } = dm;
  // Home favoured by 3.5 and up 14-7: adjusted 10.5 > 7, so HOME is covering.
  const live = (alma) => createGame('w_sb17', {
    gameId: alma ? 'g_sb17_alma' : 'g_sb17', homeTeam: 'Texas A&M', awayTeam: 'LSU',
    spread: -3.5, favorite: 'Texas A&M', status: GAME_STATUS.LIVE, homeScore: 14, awayScore: 7,
    kickoff: '2026-10-03T19:30:00Z', isAlmaMaterGame: alma,
  });
  const g = live(false), ga = live(true);
  const out = {
    // Submitted (read-only) view — the ONLY place the live badge renders.
    covering: app.renderGameCard(g, g.homeTeam, PICK_RESULT.LIVE, true, true),
    trailing: app.renderGameCard(g, g.awayTeam, PICK_RESULT.LIVE, true, true),
    coveringAlma: app.renderGameCard(ga, ga.homeTeam, PICK_RESULT.LIVE, true, true),
    trailingAlma: app.renderGameCard(ga, ga.awayTeam, PICK_RESULT.LIVE, true, true),
    // Draft view — the ONLY place .pick-buttons renders.
    draft: app.renderGameCard({ ...g, status: GAME_STATUS.SCHEDULED, homeScore: null, awayScore: null }, g.homeTeam, PICK_RESULT.PENDING, false, false),
  };
  // Reachability scan for the two .pick-btn live classes, every combination
  // the two call sites can pass (status x showResult x side x result).
  let pickBtnLive = 0, combos = 0;
  for (const status of Object.values(GAME_STATUS)) for (const showResult of [false, true]) for (const side of ['home', 'away', null]) {
    for (const result of Object.values(PICK_RESULT)) {
      const gg = { ...g, status, homeScore: status === GAME_STATUS.SCHEDULED ? null : 14, awayScore: status === GAME_STATUS.SCHEDULED ? null : 7 };
      const html = app.renderGameCard(gg, side ? gg[side + 'Team'] : null, result, showResult, showResult);
      combos++;
      if (chainsIn(html, (n) => has(n, 'pick-btn') && (has(n, 'live-covering') || has(n, 'live-trailing'))).length) pickBtnLive++;
    }
  }
  out.reach = { pickBtnLive, combos };
  return out;
}

const PRE_FIX = { covering: '#2D6B1A', trailing: '#8B1A1A' };

/** The six roles, each with its final-state twin (same chain, class swapped). */
function picksRoles(R) {
  const badge = (html, cls) => chainsIn(html, (n) => has(n, 'badge') && has(n, cls))[0];
  const swapLast = (chain, from, to) => [...chain.slice(0, -1), { ...chain[chain.length - 1], cls: chain[chain.length - 1].cls.map((c) => (c === from ? to : c)) }];
  const out = [];
  for (const [state, cls, finalCls, html, htmlAlma] of [
    ['covering', 'badge-live-covering', 'badge-win', R.covering, R.coveringAlma],
    ['trailing', 'badge-live-trailing', 'badge-loss', R.trailing, R.trailingAlma],
  ]) {
    for (const [where, h] of [['header', html], ['alma-mater header', htmlAlma]]) {
      const c = badge(h, cls);
      const chain = c ? [...SUBMITTED, ...c] : null;
      out.push({ id: `badge — live ${state} — ${where}`, state, rule: `.${cls}`, chain, twin: chain && swapLast(chain, cls, finalCls), latent: false });
    }
  }
  // The latent pick buttons: the real draft-view button chain, state class
  // applied (the only container .pick-buttons ever renders in).
  const btn = chainsIn(R.draft, (n) => n.tag === 'button' && has(n, 'pick-btn'))[0];
  for (const [state, cls, finalCls] of [['covering', 'live-covering', 'locked-win'], ['trailing', 'live-trailing', 'locked-loss']]) {
    const chain = btn ? [...DRAFT, ...btn.slice(0, -1), { ...btn[btn.length - 1], cls: ['pick-btn', cls] }] : null;
    out.push({ id: `pick button — live ${state} (latent)`, state, rule: `.pick-btn.${cls}`, chain, twin: chain && swapLast(chain, cls, finalCls), latent: true });
  }
  return out;
}

/** Every check, as data — so the main block asserts on the live files and [4]
 *  re-runs the SAME analysis on mutated copies. */
export function analyze(cssSrc, roles) {
  const { themes, themeKeys, blocks, mediaDarkCount, manualDarkCount } = buildThemes(cssSrc);
  const rules = collectRules(blocks);
  const kf = keyframesOf(cssSrc);
  const table = [];
  for (const [theme, tokens] of Object.entries(themes)) {
    for (const r of roles) {
      if (!r.chain) { table.push({ theme, role: r, unresolved: 'chain not derived' }); continue; }
      const res = evaluateRole({ chain: r.chain }, tokens, rules, kf);
      const twin = evaluateRole({ chain: r.twin }, tokens, rules, kf);
      // The pulse trough: the same chain with the keyframes' minimum opacity
      // applied to the element as an opacity group (printed, not asserted).
      const decl = ruleBody(cssSrc, r.rule) || [];
      const anim = (decl.find((d) => d.prop === 'animation') || {}).value || '';
      const frames = kf[anim.split(/\s+/).find((t) => kf[t])] || [];
      const minOp = Math.min(1, ...frames.filter((d) => d.prop === 'opacity').map((d) => parseFloat(d.value)));
      const last = r.chain[r.chain.length - 1];
      const trough = minOp < 1 ? evaluateRole({ chain: [...r.chain.slice(0, -1), { ...last, style: { opacity: String(minOp) } }] }, tokens, rules, kf) : null;
      table.push({ theme, role: r, ...res, twin, trough, minOp });
    }
  }
  const failing = (t) => table.filter((x) => x.theme === t && !x.unresolved && x.ratio < x.floor);

  // [2] light byte-identical; live distinct from final; tint + motion kept.
  const lightDrift = table.filter((x) => !isDark(x.theme) && !x.unresolved && x.text !== PRE_FIX[x.role.state]);
  const twinSame = table.filter((x) => !x.unresolved && x.twin && x.text === x.twin.text && x.bg === x.twin.bg);
  const structural = roles.map((r) => {
    const d = ruleBody(cssSrc, r.rule) || [];
    const bg = (d.find((x) => x.prop === 'background') || {}).value || '';
    const anim = (d.find((x) => x.prop === 'animation') || {}).value || '';
    const a = bg.match(/^rgba\([^)]*,\s*([\d.]+)\s*\)$/);
    return { rule: r.rule, ok: !!a && parseFloat(a[1]) < 1 && !!anim && anim !== 'none', bg, anim };
  });

  // [3] the defect class, deny-by-default.
  const blocksAll = allRuleBlocks(cssSrc);
  // SP-52 (2026-10-01): `.dc-chip-live-covering .dc-chip-init` / `.dc-chip-live-trailing .dc-chip-init` are the initials CIRCLE inside a live chip, filled with the CONSTANT
  // --win-fill / --loss-fill and labelled with a constant white (the "constant pair" the --win-fill comment in styles.css describes: white-on-fill is background-agnostic,
  // so there is nothing for night mode to remap). They are labels on a constant fill, not live pick-state TEXT — exempt by name, so the defect class stays denied everywhere else.
  const literalLive = blocksAll.filter((b) => /live-(covering|trailing)/.test(b.prelude))
    .flatMap((b) => b.prelude.split(',').map((x) => x.trim()).filter((sel) => /live-(covering|trailing)/.test(sel) && !/\.dc-chip-init$/.test(sel)).length
      ? declsOf(b.body).filter((d) => d.prop === 'color' && !/^var\(/.test(d.value)).map((d) => `${b.prelude} { color: ${d.value} }`) : []);
  // RE-DERIVED (SP-52 A1.7): the pre-fix hexes live on :root AND — as the LIGHT pair — in Munera Paper's paper-scope rules (the Picks .game-card is a paper root,
  // so Paper Dark's cards read the light values; the dark pair measures 1.23-1.89:1 on its light cards). Nowhere else.
  const preHexOutsideRoot = blocksAll.filter((b) => b.prelude !== ':root' && !/^:where\(body\.theme-paper/.test(b.prelude.replace(/\s+/g, ' ').trim()))
    .flatMap((b) => [...b.body.matchAll(/#(2d6b1a|8b1a1a)\b/gi)].map((m) => `${b.prelude} { … ${m[0]} … }`));
  const paperScopeLight = blocksAll.filter((b) => /^:where\(body\.theme-paper/.test(b.prelude.replace(/\s+/g, ' ').trim()) && /:where\(\s*\.card/.test(b.prelude))
    .every((b) => /--pick-live-cover-text:#2d6b1a/i.test(b.body) && /--pick-live-trail-text:#8b1a1a/i.test(b.body));
  const TOK = ['--pick-live-cover-text', '--pick-live-trail-text'];
  const rootDecl = Object.fromEntries(blocksAll.filter((b) => b.prelude === ':root').flatMap((b) => declsOf(b.body)).filter((d) => TOK.includes(d.prop)).map((d) => [d.prop, d.value]));
  const darkSides = Object.keys(themes).filter(isDarkSurface);
  const tokenShape = {
    paperScopeLight,
    rootLiteral: TOK.every((t) => /^#[0-9a-f]{6}$/i.test(rootDecl[t] || '')) && rootDecl[TOK[0]]?.toUpperCase() === PRE_FIX.covering && rootDecl[TOK[1]]?.toUpperCase() === PRE_FIX.trailing,
    rootDecl,
    bothTriggers: TOK.every((t) => darkSides.every((s) => themes[s][t] && themes[s][t] !== rootDecl[t] && themes[s][t] === themes[darkSides[0]][t])),
    paperDarkLight: TOK.every((t) => Object.keys(themes).filter((x) => /^paper · dark/.test(x)).length === 2 && Object.keys(themes).filter((x) => /^paper · dark/.test(x)).every((x) => themes[x][t]?.toLowerCase() === rootDecl[t]?.toLowerCase())),
    darkVals: Object.fromEntries(TOK.map((t) => [t, darkSides.map((s) => themes[s][t])])),
    // R4: not school-owned — no body.theme-<key> block of a SCHOOL (Light block or any Dark selector naming a school) declares either token
    schoolWriters: blocksAll.filter((b) => /body\.theme-(aggie|sooner|trojan|irish|boilermaker|razorback)\b/.test(b.prelude) && !/theme-neutral/.test(b.prelude)).filter((b) => declsOf(b.body).some((d) => TOK.includes(d.prop))).map((b) => b.prelude.replace(/\s+/g, ' ').slice(0, 60)),
  };

  return { themes, themeKeys, mediaDarkCount, manualDarkCount, rules, kf, table, failing, lightDrift, twinSame, structural, literalLive, preHexOutsideRoot, tokenShape };
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
  const dmSrc = await readFile(path.join(root, 'js', 'data-model.js'), 'utf8');

  console.log(`\n[pickcontrasttest] ${path.relative(root, cssPath)} + js/app.js renderGameCard()`);
  const R = await renderFixtures();
  const roles = picksRoles(R);
  const A = analyze(cssSrc, roles);

  // ── [0] Fixtures ───────────────────────────────────────────────────────────
  console.log('\n[0] fixtures');
  const shippedKeys = [...dmSrc.matchAll(/\{\s*key:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert(shippedKeys.length >= 7 && shippedKeys.every((k) => A.themeKeys.includes(k)),
    `0-1: every shipped theme in data-model.js THEMES (${shippedKeys.join(', ')}) has a body.theme-* block this suite tests`);
  assert(A.mediaDarkCount >= 20 && A.manualDarkCount >= 20,
    `0-2: both Munera night-mode token blocks parsed (OS-setting ${A.mediaDarkCount} tokens, manual toggle ${A.manualDarkCount})`);
  // RE-DERIVED (SP-52 A1.7 / DI-456): the maps come from themeresolve.mjs's real cascade — 1 bare :root + 10 Light sides + 10 Dark sides x 2 triggers = 31 maps (the
  // twenty sides; Dark once per trigger). The old count of 10 pinned the pre-SP-52 world (seven themes, one night look).
  assert(Object.keys(A.themes).length === 31 && Object.keys(A.themes).filter(isDark).length === 20 && Object.keys(A.themes).filter(isDarkSurface).length === 18,
    `0-3: 31 theme maps (1 bare :root + 10 light + 10 dark x 2 triggers; 18 of the dark ones are dark SURFACES, 2 are Paper Dark): ${Object.keys(A.themes).length}`);
  assert(['.pick-btn.live-covering', '.pick-btn.live-trailing', '.badge-live-covering', '.badge-live-trailing'].every((s) => ruleBody(cssSrc, s)),
    '0-4: the four live pick-state rules are each located exactly once in styles.css');
  for (const r of roles.filter((x) => !x.latent)) {
    const card = r.chain && r.chain.find((n) => has(n, 'game-card'));
    const hdr = r.chain && r.chain.find((n) => has(n, 'game-card-header'));
    const alma = /alma/.test(r.id);
    assert(!!(card && hdr && (has(card, 'alma-mater') === alma)),
      `0-5: renderGameCard() really renders "${r.id}" inside .game-card${alma ? '.alma-mater' : ''} > .game-card-header (${r.chain ? label(r.chain.slice(SUBMITTED.length)) : 'NOT RENDERED'})`);
  }
  const btnRaw = chainsIn(R.draft, (n) => n.tag === 'button' && has(n, 'pick-btn'))[0];
  assert(!!(btnRaw && btnRaw.some((n) => has(n, 'pick-buttons')) && btnRaw.some((n) => has(n, 'game-card-body')) && roles.filter((x) => x.latent).every((x) => x.chain)),
    `0-6: the draft view renders button.pick-btn inside .game-card-body > .pick-buttons (${btnRaw ? label(btnRaw) : 'NOT RENDERED'})`);
  assert(roles.every((r) => r.chain && r.chain.every((n) => !n.attrs?.id || ['page-picks', 'submitted-games', 'games-list'].includes(n.attrs.id))),
    '0-7: the derived chains carry no invented #id (a data-game-id attribute is not an id)');
  console.log(`  NOTE reachability: .pick-btn.live-covering/.live-trailing rendered in ${R.reach.pickBtnLive} of ${R.reach.combos} renderGameCard() combinations` +
    (R.reach.pickBtnLive === 0 ? ' — the two .pick-btn rules are LATENT (fixed and measured anyway); the badges are what a player sees.' : '.'));

  // ── [1] AA in every theme map ──────────────────────────────────────────────
  console.log('\n[1] Picks live pick-state text — WCAG AA in every theme map');
  const unresolved = A.table.filter((x) => x.unresolved);
  assert(unresolved.length === 0, `1-0: every role resolved to a concrete colour pair in every theme (${unresolved.length} unresolved${unresolved.length ? ': ' + unresolved.slice(0, 3).map((u) => `${u.theme}/${u.role.id}: ${u.unresolved}`).join('; ') : ''})`);
  for (const theme of Object.keys(A.themes)) {
    for (const r of roles) {
      const row = A.table.find((x) => x.theme === theme && x.role === r);
      if (!row || row.unresolved) continue;
      assert(row.ratio >= row.floor, `1-${theme}: ${r.id} ${row.ratio.toFixed(2)}:1 >= ${row.floor} (${row.text} on ${row.bg})`);
    }
  }

  // ── [2] Light byte-identical; live distinct from final ─────────────────────
  console.log('\n[2] light mode unchanged; live stays distinct from final');
  for (const theme of Object.keys(A.themes).filter((t) => !isDark(t))) {
    const drift = A.lightDrift.filter((x) => x.theme === theme);
    assert(drift.length === 0, `2-L-${theme}: all ${roles.length} roles resolve to the pre-fix literal text colour (covering ${PRE_FIX.covering}, trailing ${PRE_FIX.trailing})${drift.length ? ' — DRIFT: ' + drift.map((d) => `${d.role.id} ${d.text}`).join('; ') : ''}`);
  }
  for (const theme of Object.keys(A.themes)) {
    const same = A.twinSame.filter((x) => x.theme === theme);
    assert(same.length === 0, `2-F-${theme}: no live role's text/background pair equals its final twin's (.badge-win/-loss, .pick-btn.locked-win/-loss)${same.length ? ' — SAME: ' + same.map((s) => s.role.id).join('; ') : ''}`);
  }
  const notSoft = A.structural.filter((s) => !s.ok);
  assert(notSoft.length === 0, `2-S: all four live rules keep a translucent tint and a running animation — live is soft, final is solid${notSoft.length ? ' — ' + notSoft.map((s) => `${s.rule} bg "${s.bg}" animation "${s.anim}"`).join('; ') : ''}`);

  // ── [3] Deny-by-default for the defect class ───────────────────────────────
  console.log('\n[3] the defect class: no hardcoded live pick-state text');
  assert(A.literalLive.length === 0,
    `3-1: no rule whose selector names a live covering/trailing state paints color: with a literal — tokens only, so night mode can reach it (${A.literalLive.length ? A.literalLive.join('; ') : 'clean'})`);
  assert(A.preHexOutsideRoot.length === 0,
    `3-2: #2d6b1a / #8b1a1a appear only as :root token values and in Paper's paper-scope rules (the LIGHT pair, A1.7), never in any other rule or block (${A.preHexOutsideRoot.length ? A.preHexOutsideRoot.join('; ') : 'clean'})`);
  assert(A.tokenShape.rootLiteral,
    `3-3: --pick-live-cover-text / --pick-live-trail-text are LITERALS on :root equal to the pre-fix hexes (DI-448 R1) (${JSON.stringify(A.tokenShape.rootDecl)})`);
  assert(A.tokenShape.bothTriggers,
    `3-4: both night triggers remap both tokens, on every dark-SURFACE side (Munera, Ink, Graphite, six schools), to the SAME value (DI-448 R6) (${JSON.stringify(A.tokenShape.darkVals)})`);
  assert(A.tokenShape.paperDarkLight && A.tokenShape.paperScopeLight,
    '3-6: Paper Dark (both triggers) reads the LIGHT pair — its paper-scope rules declare #2d6b1a / #8b1a1a on the light cards (A1.7: the dark pair is 1.23-1.89:1 there)');
  assert(A.tokenShape.schoolWriters.length === 0,
    `3-5: no school theme block declares either token — semantics, not school-owned (DI-448 R4) (${A.tokenShape.schoolWriters.join(', ') || 'clean'})`);

  // ── [4] Mutation proof — in memory, never on disk, never git ───────────────
  console.log('\n[4] mutation proof — each part of the fix reverted in memory must go RED');
  // A mutation whose target is missing returns null, and every effect
  // assertion below requires a real mutant (`!!m && …`) — so no effect check
  // can pass vacuously on an unmutated copy.
  const mutate = (src, from, to, lbl) => { const out = src.split(from).join(to); const ok = out !== src; assert(ok, `4-pre: mutation target found — ${lbl}`); return ok ? out : null; };
  const run = (src) => (src == null ? null : analyze(src, roles));
  // the dark SURFACES that share Block A's values (Graphite Dark carries its own surfaces; Paper Dark is a light-surface look) — where a reverted token must go RED everywhere
  const muneraDark = (a) => Object.keys(a.themes).filter(isDarkSurface).filter((t) => !/^graphite/.test(t));
  const darkFail = (a, idPart) => muneraDark(a).every((t) => a.failing(t).some((x) => x.role.id.includes(idPart)));
  const failsIn = (a, theme, idPart) => a.failing(theme).some((x) => x.role.id.includes(idPart));
  {
    const m = run(mutate(cssSrc, '.badge-live-covering{background:rgba(76,175,80,.15);color:var(--pick-live-cover-text)', '.badge-live-covering{background:rgba(76,175,80,.15);color:#2d6b1a', 'covering badge back to #2d6b1a'));
    assert(!!m && darkFail(m, 'badge — live covering') && m.literalLive.length === 1, '4-1: covering badge text back to #2d6b1a → [1] RED in both night maps and [3-1] RED');
  }
  {
    const m = run(mutate(cssSrc, '.badge-live-trailing{background:rgba(244,67,54,.1);color:var(--pick-live-trail-text)', '.badge-live-trailing{background:rgba(244,67,54,.1);color:#8b1a1a', 'trailing badge back to #8b1a1a'));
    assert(!!m && darkFail(m, 'badge — live trailing') && m.literalLive.length === 1, '4-2: trailing badge text back to #8b1a1a → [1] RED in both night maps and [3-1] RED');
  }
  {
    const m = run(mutate(cssSrc, 'background:rgba(146,201,125,.18);color:var(--pick-live-cover-text)', 'background:rgba(146,201,125,.18);color:#2d6b1a', 'covering pick button back to #2d6b1a'));
    assert(!!m && darkFail(m, 'pick button — live covering') && m.literalLive.length === 1, '4-3: covering pick-button text back to #2d6b1a → [1] RED in both night maps');
  }
  {
    const m = run(mutate(cssSrc, 'background:rgba(232,160,160,.18);color:var(--pick-live-trail-text)', 'background:rgba(232,160,160,.18);color:#8b1a1a', 'trailing pick button back to #8b1a1a'));
    assert(!!m && darkFail(m, 'pick button — live trailing') && m.literalLive.length === 1, '4-4: trailing pick-button text back to #8b1a1a → [1] RED in both night maps');
  }
  const darkTrail = A.tokenShape.darkVals['--pick-live-trail-text']?.[0] || '(no night value)';
  {
    const m = run(mutate(cssSrc, `--pick-live-trail-text:${darkTrail};`, '--pick-live-trail-text:#8b1a1a;', 'night remap of the trailing token removed'));
    assert(!!m && darkFail(m, 'live trailing') && !m.tokenShape.bothTriggers, '4-5: night-mode --pick-live-trail-text remap removed → [1] and [3-4] RED (the token, not just the call site, is load-bearing)');
  }
  {
    const m = run(mutate(cssSrc, `--pick-live-trail-text:${darkTrail};`, '--pick-live-trail-text:#D88383;', "trailing night value set to SB-06's #D88383"));
    // RE-DERIVED (SP-52 DI-448, 2026-10-01): on SB-17's original surfaces #D88383 failed the pick-button tint (4.27:1) but still passed the badge. DI-448 LIFTS the Dark inset
    // (--bg-card-alt #261F19 -> #332C25), which is the badge header's ground, so the same value now fails the badge too (4.46:1) — A1.7 predicted exactly this. Either way SB-06's
    // dashboard token does not fit the Picks tints, which is why the two tokens stay separate (A1.7's optional merge is NOT taken: "if every surface still passes AA" is false).
    assert(!!m && darkFail(m, 'pick button — live trailing') && darkFail(m, 'badge — live trailing'),
      "4-6: night trailing set to SB-06's --live-trail-text value #D88383 → RED on the pick button (4.27:1) AND, with DI-448's lifted inset, the badge (4.46:1) — why the dashboard token does not fit the Picks tints");
  }
  {
    // RE-DERIVED: the manual Block A is an enumerated selector list now; its LAST selector sits right before the `{`
    const manualAt = cssSrc.indexOf('body.theme-razorback[data-color-scheme="dark"] {');
    const head = cssSrc.slice(0, manualAt), tail = cssSrc.slice(manualAt);
    const tailM = tail.replace(/\n\s*--pick-live-cover-text:[^;]+;/, '').replace(/\n\s*--pick-live-trail-text:[^;]+;/, '');
    const ok = manualAt > 0 && tailM !== tail;
    assert(ok, '4-pre: mutation target found — both tokens dropped from the MANUAL dark block only');
    const m = ok ? analyze(head + tailM, roles) : null;
    assert(!!m && failsIn(m, 'neutral · dark (manual toggle)', 'live') && !failsIn(m, 'neutral · dark (OS setting)', 'live'),
      '4-7: both tokens dropped from the manual-toggle block only → RED for the manual trigger, still GREEN for the OS trigger (the two are checked separately, never assumed identical)');
  }
  {
    const m = run(mutate(cssSrc, '--pick-live-cover-text:#2d6b1a;', '--pick-live-cover-text:#1A7A3F;', 'light covering token set to --win #1A7A3F'));
    assert(!!m && m.lightDrift.length > 0 && failsIn(m, 'neutral', 'badge — live covering'),
      '4-8: light covering token set to --win #1A7A3F → [2-L] RED (light no longer byte-identical) and [1] RED on the light covering badge — why --win does not fit here');
  }

  // ── Printed, not asserted ──────────────────────────────────────────────────
  console.log('\n  NOTE pulse trough (opacity .5 at mid-cycle; printed, not asserted — no suite treats an opacity keyframe as at-rest):');
  for (const theme of ['neutral', 'neutral · dark (OS setting)']) {
    const rows = A.table.filter((x) => x.theme === theme && x.trough && !x.unresolved);
    console.log(`    ${theme}: ` + rows.map((x) => `${x.role.id.replace('badge — live ', '')} ${x.trough.ratio.toFixed(2)}:1`).join(' | '));
  }
  if (showTable) {
    console.log('\n── full table (worst case per role; ratios are text:background) ──');
    for (const x of A.table) {
      if (x.unresolved) { console.log(`  ${x.theme.padEnd(30)} ${x.role.id.padEnd(42)} UNRESOLVED ${x.unresolved}`); continue; }
      console.log(`  ${x.theme.padEnd(30)} ${x.role.id.padEnd(42)} ${x.ratio.toFixed(2).padStart(6)}:1 ${x.ratio >= x.floor ? 'ok  ' : 'FAIL'} ${x.text} on ${x.bg} (${x.fontPx.toFixed(1)}px/${x.weight})${x.trough ? `  trough ${x.trough.ratio.toFixed(2)}` : ''}`);
    }
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  // Same double-armed exit as dashcontrasttest.mjs / contrastscan.mjs: app.js
  // is imported, so never rely on the event loop draining on its own.
  process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 8000).unref();
}
