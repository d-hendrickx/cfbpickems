/**
 * CFB Pickems — btnspacingtest.mjs
 * ================================
 * Bug SB-14 (Drew, 2026-09-30), verbatim:
 *   "The edit my picks and view dashboard button at the bottom of the picks page
 *    are touching and it's not aesthetically pleasing, there needs to be space.
 *    i feel like ive asked for buttons and lines not to touch like this a few
 *    times now … Also those buttons are not vertically and horizontally spaced
 *    well, htey should be centered"
 *
 * The rule this file enforces is the "Breathing Room" section of
 * docs/# iOS App Polish & Design Philosophy.md (added 2026-09-30):
 *   - at least 8 pt between controls in a group;
 *   - a row that doesn't fit wraps into a stack, and the stack keeps its gap;
 *   - groups are centered horizontally and vertically, equal space above/below;
 *   - space comes from the container (a gap), never from a margin on one button,
 *     so a hidden or missing button never leaves the group off-center;
 *   - check at 375 pt wide (the smallest iPhone) and at the largest text size.
 *
 * REPRODUCTION (headless Chrome 153, mobile emulation, DPR 3, real Oswald +
 * Inter loaded — measured on the pre-fix markup, 2026-09-30):
 *   OPEN week (Edit shown), 375 and 390 wide, text 1x / 1.35x / 2x:
 *     the pair WRAPS; vertical gap between the buttons = 0.00 px (touching);
 *     Edit is centered 4.0 px LEFT of the card's center (its own `mr-sm`
 *     margin is centered along with it). At 430 wide / 1x the pair fits on
 *     one line, 12.22 px apart (8 px margin + a ~4.2 px collapsed space).
 *   LOCKED week (Edit hidden): View Dashboard alone, centered.
 *   Card padding: 16 px above and below in every case (already equal).
 *
 * ROOT CAUSE: the group was never a group. Two inline-level buttons sat in a
 * `text-align:center` card, spaced by a margin on ONE of them. Inline layout
 * stacks wrapped line boxes with no gap at all, and centers each line
 * INCLUDING that margin — so the wrapped Edit button drifts 4 px left. Every
 * iPhone width wraps this pair, so every player saw it.
 *
 * WHAT THIS FILE ASSERTS
 *   [1] Fixture integrity — the OPEN render shows Edit + Dashboard, the LOCKED
 *       render shows Dashboard only, and both buttons are still wired.
 *   [2] Structure — both buttons are children of ONE group element carrying
 *       the `.btn-row` primitive, and no grouped button carries a margin.
 *   [3] The primitive in css/styles.css — `.btn-row` resolves to a centered,
 *       wrapping flex container with a gap of at least 8 px on BOTH axes (the
 *       row gap is the one that applies once the buttons wrap), on the 8-pt
 *       grid, and declares no margin of its own.
 *   [4] Geometry — a small layout model, fed the EMITTED markup and the
 *       RESOLVED cascade, at 375 / 390 / 430 wide and 1x / 1.35x / 2x text, for
 *       both week states: gaps >= 8, every line centered, nothing past the
 *       card's padding, equal space above and below.
 *   [5] Model calibration — the same model, fed the pre-fix layout, reproduces
 *       Chrome's measurement (gap 0.00 px, Edit 4.0 px off-center). A model
 *       that always answered "fine" would fail here, so [4] cannot pass by
 *       being vacuous.
 *
 * The button sizes in [4] are the intrinsic sizes Chrome measured with the
 * real fonts (they do not depend on which layout holds the buttons). Only a
 * device confirms the final pixels: run the on-device check in the SB-14 row.
 *
 * Run:  node btnspacingtest.mjs
 * Also: TZ=UTC node btnspacingtest.mjs && TZ=America/Los_Angeles node btnspacingtest.mjs
 */

import { readFile } from 'node:fs/promises';

// ── Minimal stubs so app.js imports clean (layouttest.mjs's proven shape). ───
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
// getElementById returns a listener RECORDER for an id only when the markup
// just rendered actually contains that id — so [1] can prove the buttons are
// still wired, and a hidden Edit button is genuinely absent.
let CURRENT_HTML = '';
const bound = new Map();
function recorder(id) {
  if (!bound.has(id)) bound.set(id, []);
  return { id, addEventListener: (type) => bound.get(id).push(type), removeEventListener() {}, style: {}, classList: { add() {}, remove() {}, toggle() {} } };
}
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => (['edit-picks-btn', 'go-dash-btn', 'logout-btn'].includes(id) && CURRENT_HTML.includes(`id="${id}"`)) ? recorder(id) : null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {};
globalThis.scrollTo = () => {};
globalThis.fetch = async () => { throw new Error('network disabled in btnspacingtest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] btnspacingtest.mjs — SB-14: the submitted-picks button group (Breathing Room)\n`);

const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const CSS = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');

// ── FIXTURES ────────────────────────────────────────────────────────────────
storage.setBackendMode('local');
storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true, pin: '1111', preferences: {} });
const FUTURE = new Date(Date.now() + 7 * 86400_000).toISOString();
const WEEK = {
  weekId: 'w_sb14', weekNumber: 5, season: 2026, name: 'Week 5', status: 'open', dataSourceMode: 'live',
  startDate: '2026-10-03', endDate: '2026-10-04', picksOpenAt: null, picksLockAt: null,
  tiebreakerQuestion: 'Total points?', actualTiebreakerValue: null, showInHistory: true, blurb: '',
  extraPointEnabled: false, extraPointActual: null, extraPointDetect: null,
};
const GAME = {
  gameId: 'w_sb14_g1', weekId: 'w_sb14', espnEventId: null, dataQuality: 'manual', dataSource: 'manual',
  homeTeam: 'Texas A&M', awayTeam: 'Alabama', homeConference: 'SEC', awayConference: 'SEC', homeRank: null, awayRank: null,
  kickoff: FUTURE, kickoffConfirmed: true, kickoffDateOnly: false, timeWindow: 'evening',
  spread: -3.5, favorite: 'Texas A&M', lockedSpread: null, homeScore: null, awayScore: null, status: 'scheduled',
  actualWinner: null, atsWinner: null, isAlmaMaterGame: false, spreadSource: 'manual', oddsProvider: null,
  lastUpdated: null, venue: null, venueDisplay: null, neutralSite: false, multiplier: 1,
};
storage.saveWeek(WEEK);
storage.saveGame(GAME);
storage.saveAllPicks([{ pickId: 'sb14p', weekId: 'w_sb14', gameId: 'w_sb14_g1', playerId: 'p1', selectedTeam: 'Texas A&M', submittedAt: '2026-10-01T00:00:00Z' }]);

/** Render the REAL submitted view (the exported test seam is an alias of it). */
function renderSubmitted(week) {
  bound.clear();
  const c = {
    _html: '', addEventListener() {},
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); CURRENT_HTML = this._html; },
  };
  app._renderSubmittedViewForTest(c, week, [GAME], { playerId: 'p1', isAdmin: false, verified: true }, 'Drew');
  return { html: c._html, bound: new Map(bound) };
}

// ── A tiny HTML tree (tags only — enough to find a node's parent). ───────────
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
function parseTree(html) {
  const root = { tag: '#root', attrs: '', children: [], parent: null };
  let cur = root;
  for (const m of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g)) {
    const [, close, tag, attrs] = m; const t = tag.toLowerCase();
    if (close) { let n = cur; while (n !== root && n.tag !== t) n = n.parent; if (n !== root) cur = n.parent; continue; }
    const node = { tag: t, attrs, children: [], parent: cur };
    cur.children.push(node);
    if (!VOID.has(t) && !/\/\s*$/.test(attrs)) cur = node;
  }
  return root;
}
const attr = (n, name) => (n.attrs.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1] ?? null;
const classesOf = n => (attr(n, 'class') || '').split(/\s+/).filter(Boolean);
function findById(n, id) {
  if (attr(n, 'id') === id) return n;
  for (const c of n.children) { const f = findById(c, id); if (f) return f; }
  return null;
}

// ── A tiny cascade resolver for class-only selectors in css/styles.css. ──────
// Resolves what a given class list gets from rules whose selector is made of
// classes only (`.a`, `.a.b`), top level or inside a WIDTH media query that
// matches the viewport. Specificity = number of classes, then source order;
// the inline style attribute wins. Non-width media (colour scheme, motion,
// hover) are skipped — none of them carry layout for these elements.
function cssRules(css) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = []; const ctx = []; let i = 0, order = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i), close = css.indexOf('}', i);
    if (close !== -1 && (open === -1 || close < open)) { ctx.pop(); i = close + 1; continue; }
    if (open === -1) break;
    // Drop any statement before the selector (`@import url(…);` precedes `:root{`).
    const raw = css.slice(i, open);
    const prelude = raw.slice(raw.lastIndexOf(';') + 1).trim();
    if (prelude.startsWith('@')) {
      const media = prelude.startsWith('@media') ? prelude.slice(6).trim() : null;
      ctx.push(media !== null ? { media } : (prelude.startsWith('@supports') ? { supports: true } : { skip: true }));
      i = open + 1; continue;
    }
    const end = css.indexOf('}', open);
    if (!ctx.some(c => c.skip)) {
      rules.push({ selectors: prelude.split(',').map(s => s.trim()), body: css.slice(open + 1, end), media: ctx.filter(c => c.media).map(c => c.media), order: order++ });
    }
    i = end + 1;
  }
  return rules;
}
function mediaMatches(cond, vw) {
  const feats = [...cond.matchAll(/\(\s*([a-z-]+)\s*:\s*([^)]+)\)/g)];
  if (!feats.length) return /^(all|screen)?$/.test(cond.trim());
  return feats.every(([, f, v]) => (f === 'min-width' ? vw >= parseFloat(v) : f === 'max-width' ? vw <= parseFloat(v) : false));
}
function decls(body) {
  const out = []; let depth = 0, start = 0;
  for (let k = 0; k <= body.length; k++) {
    const ch = body[k];
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if ((ch === ';' || k === body.length) && depth === 0) {
      const d = body.slice(start, k); start = k + 1;
      const c = d.indexOf(':'); if (c > 0) out.push([d.slice(0, c).trim().toLowerCase(), d.slice(c + 1).replace(/!important/, '').trim()]);
    }
  }
  return out;
}
const RULES = cssRules(CSS);
// Custom properties are per viewport: `:root{--page-pad}` is 16 px, but 14 px at
// <= 480 wide and 10 px at <= 360 (Chrome confirms 14 px at 375/390/430).
const rootVars = vw => Object.fromEntries(RULES.filter(r => r.selectors.includes(':root') && r.media.every(m => mediaMatches(m, vw)))
  .flatMap(r => decls(r.body)).filter(([p]) => p.startsWith('--')));
const varOf = (v, vw) => { const V = rootVars(vw); return v.replace(/var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)/g, (_, n) => V[n] ?? 'NaN'); };
function resolve(classes, inlineStyle, vw) {
  const hits = [];
  for (const r of RULES) {
    if (!r.media.every(m => mediaMatches(m, vw))) continue;
    for (const s of r.selectors) {
      if (!/^(\.[\w-]+)+$/.test(s)) continue;
      const need = s.slice(1).split('.');
      if (need.every(c => classes.includes(c))) hits.push({ spec: need.length, order: r.order, body: r.body });
    }
  }
  hits.sort((a, b) => a.spec - b.spec || a.order - b.order);
  const p = {};
  const set = (prop, val) => {
    val = varOf(val, vw);
    const box = (pre, v) => { const t = v.split(/\s+/); const [a, b = a, c = a, d = b] = t; Object.assign(p, { [pre + '-top']: a, [pre + '-right']: b, [pre + '-bottom']: c, [pre + '-left']: d }); };
    if (prop === 'margin' || prop === 'padding') box(prop, val);
    else if (prop === 'gap') { const [r, c = r] = val.split(/\s+/); p['row-gap'] = r; p['column-gap'] = c; }
    else if (prop === 'flex-flow') { for (const t of val.split(/\s+/)) (/wrap/.test(t) ? p['flex-wrap'] = t : p['flex-direction'] = t); }
    else if (prop === 'border') { const w = val.split(/\s+/).find(t => /^[\d.]+px$/.test(t) || t === '0'); p['border-width'] = w ?? '0'; }
    else p[prop] = val;
  };
  for (const h of hits) for (const [k, v] of decls(h.body)) set(k, v);
  for (const [k, v] of decls(inlineStyle || '')) set(k, v);
  return p;
}
const px = v => (v === undefined || v === 'normal' ? 0 : parseFloat(v));

// ── The layout model: one row of buttons inside a card's content box. ───────
// FLEX mode (display:flex): items keep their intrinsic width, break onto a new
//   line when the next one (plus column-gap) doesn't fit, lines are row-gap
//   apart, and justify-content places each line.
// INLINE mode (display:block): the pre-fix layout. Inline-level buttons are
//   separated by one collapsed space, wrapped line boxes abut with NO gap, and
//   text-align places each line — margins included.
const SPACE = 4.22; // a collapsed space between two inline buttons in the card's 15 px Inter (Chrome: 12.22 − 8)
function layout(group, items, W) {
  const flex = /flex/.test(group.display || '');
  if (!flex && /flex|grid/.test(group.display || '')) throw new Error('unmodelled display ' + group.display);
  const colGap = flex ? px(group['column-gap']) : SPACE;
  const rowGap = flex ? px(group['row-gap']) : 0;
  const wraps = flex ? group['flex-wrap'] === 'wrap' : true;
  const lines = [];
  for (const it of items) {
    const outer = it.ml + it.w + it.mr;
    const line = lines[lines.length - 1];
    if (line && (!wraps || line.used + colGap + outer <= W)) { line.items.push(it); line.used += colGap + outer; }
    else lines.push({ items: [it], used: outer });
  }
  const align = flex ? (group['justify-content'] || 'normal') : (group['text-align'] || 'start');
  let y = 0;
  for (const line of lines) {
    const free = W - line.used; const n = line.items.length;
    let x, extra = 0;
    if (/^(center)$/.test(align)) x = free / 2;
    else if (/^(normal|start|flex-start|left)$/.test(align)) x = 0;
    else if (/^(end|flex-end|right)$/.test(align)) x = free;
    else if (align === 'space-between') { x = 0; extra = n > 1 ? free / (n - 1) : 0; }
    else throw new Error('unmodelled alignment ' + align);
    const h = Math.max(...line.items.map(i => i.h));
    line.boxes = line.items.map(it => { const left = x + it.ml; x = left + it.w + it.mr + colGap + extra; return { id: it.id, left, right: left + it.w, top: y + (h - it.h) / 2, bottom: y + (h + it.h) / 2 }; });
    line.top = y; line.bottom = y + h; line.width = line.used;
    y += h + rowGap;
  }
  return lines;
}
function measure(lines, W) {
  const hGaps = lines.flatMap(l => l.boxes.slice(1).map((b, k) => b.left - l.boxes[k].right));
  const vGaps = lines.slice(1).map((l, k) => l.top - lines[k].bottom);
  const lineOffsets = lines.map(l => { const L = Math.min(...l.boxes.map(b => b.left)), R = Math.max(...l.boxes.map(b => b.right)); return (L + R) / 2 - W / 2; });
  const minLeft = Math.min(...lines.flatMap(l => l.boxes.map(b => b.left)));
  const maxRight = Math.max(...lines.flatMap(l => l.boxes.map(b => b.right)));
  return { hGaps, vGaps, lineOffsets, fits: minLeft >= -0.01 && maxRight <= W + 0.01, wrapped: lines.length > 1 };
}
const f2 = n => (Math.round(n * 100) / 100).toFixed(2);

// Intrinsic button sizes, measured in headless Chrome with the real fonts.
const SIZES = {
  1:    { 'edit-picks-btn': [166.86, 50], 'go-dash-btn': [162.5, 46] },
  1.35: { 'edit-picks-btn': [206.56, 57], 'go-dash-btn': [205.38, 54] },
  2:    { 'edit-picks-btn': [283.72, 72], 'go-dash-btn': [285, 69] },
};
const WIDTHS = [375, 390, 430];

// ═════════════════════════════════════════════════════════════════════════════
console.log('[1] FIXTURE INTEGRITY — the OPEN and LOCKED submitted views…');
// ═════════════════════════════════════════════════════════════════════════════
const OPEN = renderSubmitted(WEEK);
const LOCKED = renderSubmitted({ ...WEEK, status: 'locked' });
{
  assert(OPEN.html.includes('id="submitted-games"'), '1a: the render is the submitted-picks view (#submitted-games)');
  assert((OPEN.html.match(/id="edit-picks-btn"/g) || []).length === 1 && (OPEN.html.match(/id="go-dash-btn"/g) || []).length === 1,
    '1b: OPEN week (canEdit) — exactly one Edit My Picks and one View Dashboard button');
  assert(!LOCKED.html.includes('id="edit-picks-btn"') && (LOCKED.html.match(/id="go-dash-btn"/g) || []).length === 1,
    '1c: LOCKED week (canEdit false) — Edit is hidden, View Dashboard alone');
  assert((OPEN.bound.get('go-dash-btn') || []).includes('click') && (OPEN.bound.get('edit-picks-btn') || []).includes('click'),
    '1d: both buttons are still wired to their click handlers (ids unchanged)');
  assert((LOCKED.bound.get('go-dash-btn') || []).includes('click'), '1e: LOCKED — View Dashboard is still wired');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] STRUCTURE — one group element, spaced by the container, not by a button…');
// ═════════════════════════════════════════════════════════════════════════════
function groupOf(html) {
  const tree = parseTree(html);
  const ids = ['edit-picks-btn', 'go-dash-btn'].filter(id => html.includes(`id="${id}"`));
  const btns = ids.map(id => findById(tree, id));
  return { tree, ids, btns, group: btns[btns.length - 1]?.parent || null };
}
const G_OPEN = groupOf(OPEN.html), G_LOCKED = groupOf(LOCKED.html);
const MARGIN_CLASS = /^-?m[trblxy]?-/;
{
  assert(G_OPEN.btns.every(b => b && b.parent === G_OPEN.group),
    '2a: OPEN — Edit My Picks and View Dashboard are children of the SAME group element');
  assert(classesOf(G_OPEN.group).includes('btn-row'),
    `2b: OPEN — the group carries the .btn-row primitive (got class="${classesOf(G_OPEN.group).join(' ')}")`);
  assert(classesOf(G_LOCKED.group).includes('btn-row'),
    `2c: LOCKED — the same group, same primitive, with Edit hidden (got class="${classesOf(G_LOCKED.group).join(' ')}")`);
  for (const [name, G] of [['OPEN', G_OPEN], ['LOCKED', G_LOCKED]]) {
    const offenders = G.btns.flatMap(b => [...classesOf(b).filter(c => MARGIN_CLASS.test(c)), ...(/margin/.test(attr(b, 'style') || '') ? ['style:margin'] : [])].map(c => `${attr(b, 'id')}:${c}`));
    assert(offenders.length === 0,
      `2d-${name}: no grouped button carries a margin class or inline margin — space comes from the gap (offenders: ${offenders.join(', ') || 'none'})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] THE PRIMITIVE — .btn-row in css/styles.css…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const r = resolve(['btn-row'], '', 375);
  assert(/^(flex|inline-flex)$/.test(r.display || ''), `3a: .btn-row is a flex container (display: ${r.display ?? 'unset'})`);
  assert(r['flex-wrap'] === 'wrap', `3b: .btn-row wraps when the row doesn't fit (flex-wrap: ${r['flex-wrap'] ?? 'unset'})`);
  assert(r['justify-content'] === 'center', `3c: .btn-row centers each line horizontally (justify-content: ${r['justify-content'] ?? 'unset'})`);
  assert(r['align-items'] === 'center', `3d: .btn-row centers buttons of different heights on one line (align-items: ${r['align-items'] ?? 'unset'})`);
  const rg = px(r['row-gap']), cg = px(r['column-gap']);
  assert(rg >= 8 && cg >= 8, `3e: gap >= 8 px on BOTH axes — row-gap is the one that holds once wrapped (row ${r['row-gap'] ?? 'unset'}, column ${r['column-gap'] ?? 'unset'})`);
  assert(rg % 8 === 0 && cg % 8 === 0, '3f: the gap is on the 8-pt grid');
  const m = ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'].filter(k => px(r[k]) !== 0);
  assert(m.length === 0, `3g: .btn-row declares no margin of its own, so it sits evenly inside its card (${m.join(', ') || 'none'})`);
  for (const vw of WIDTHS) {
    const rv = resolve(['btn-row'], '', vw);
    assert(px(rv['row-gap']) === rg && px(rv['column-gap']) === cg && rv['justify-content'] === r['justify-content'] && rv['flex-wrap'] === r['flex-wrap'],
      `3h-${vw}: no width media query overrides .btn-row at ${vw} wide`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] GEOMETRY — 375 / 390 / 430 wide, 1x / 1.35x / 2x text, both week states…');
// ═════════════════════════════════════════════════════════════════════════════
function scenario(G, vw, scale) {
  const group = resolve(classesOf(G.group), attr(G.group, 'style'), vw);
  // the card that holds the group: the group itself, or its parent
  const card = classesOf(G.group).includes('card') ? G.group : G.group.parent;
  const cardP = card === G.group ? group : resolve(classesOf(card), attr(card, 'style'), vw);
  const pagePad = px(varOf('var(--page-pad)', vw));
  const inset = (P, side) => px(P['border-width']) + px(P['padding-' + side]);
  let W = vw - 2 * pagePad - inset(cardP, 'left') - inset(cardP, 'right');
  let above = px(cardP['padding-top']), below = px(cardP['padding-bottom']);
  if (card !== G.group) {
    W -= px(group['margin-left']) + px(group['margin-right']) + px(group['padding-left']) + px(group['padding-right']);
    above += px(group['margin-top']) + px(group['padding-top']);
    below += px(group['margin-bottom']) + px(group['padding-bottom']);
  }
  const items = G.btns.map(b => {
    const id = attr(b, 'id'); const s = resolve(classesOf(b), attr(b, 'style'), vw);
    const [w, h] = SIZES[scale][id];
    return { id, w, h, ml: px(s['margin-left']), mr: px(s['margin-right']) };
  });
  return { m: measure(layout(group, items, W), W), W, above, below, card };
}
for (const [name, G] of [['OPEN', G_OPEN], ['LOCKED', G_LOCKED]]) {
  for (const vw of WIDTHS) {
    for (const scale of [1, 1.35, 2]) {
      let s;
      try { s = scenario(G, vw, scale); }
      catch (e) { assert(false, `4-${name}-${vw}-${scale}x: layout could not be modelled — ${e.message}`); continue; }
      const { m, above, below } = s;
      const gapsOk = m.hGaps.every(g => g >= 8) && m.vGaps.every(g => g >= 8);
      const centred = m.lineOffsets.every(o => Math.abs(o) <= 0.5);
      const even = above === below && above >= 16;
      const parts = [
        m.wrapped ? `stacked, vertical gap ${m.vGaps.map(f2).join('/')} px` : (m.hGaps.length ? `one line, gap ${m.hGaps.map(f2).join('/')} px` : 'single button'),
        `line offsets ${m.lineOffsets.map(f2).join('/')} px`,
        m.fits ? `fits ${f2(s.W)} px` : `OVERFLOWS ${f2(s.W)} px`,
        `above ${above} / below ${below} px`,
      ];
      assert(gapsOk && centred && m.fits && even && classesOf(s.card).includes('card'),
        `4-${name.padEnd(6)} ${vw} wide ${String(scale).padEnd(4)}x — ${parts.join(' · ')}`);
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] MODEL CALIBRATION — the pre-fix layout reproduces Chrome\'s measurement…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // The cascade resolver derives the card's width from styles.css the same way
  // [4] does. Chrome measured the card at 347 / 362 / 402 px wide.
  const cardWidth = vw => vw - 2 * px(varOf('var(--page-pad)', vw));
  assert(cardWidth(375) === 347 && cardWidth(390) === 362 && cardWidth(430) === 402,
    `5a: the resolver puts the card at ${cardWidth(375)} / ${cardWidth(390)} / ${cardWidth(430)} px wide (Chrome: 347 / 362 / 402 — --page-pad is 14 px at <= 480 wide)`);
  const content = vw => { const P = resolve(['card', 'mt-md', 'text-center'], 'padding:16px', vw); return cardWidth(vw) - 2 * (px(P['border-width']) + px(P['padding-left'])); };
  // The pre-fix group, as plain resolved properties (not read from app.js):
  // a `text-align:center` card holding two inline buttons, `mr-sm` on Edit.
  const old = { display: 'block', 'text-align': 'center' };
  const items = [{ id: 'edit-picks-btn', w: 166.86, h: 50, ml: 0, mr: 8 }, { id: 'go-dash-btn', w: 162.5, h: 46, ml: 0, mr: 0 }];
  const at375 = measure(layout(old, items, content(375)), content(375));
  assert(at375.wrapped && Math.abs(at375.vGaps[0]) < 0.01,
    `5b: 375 wide — the old layout stacks with a ${f2(at375.vGaps[0] ?? NaN)} px gap (Chrome measured 0.00: the buttons touch)`);
  assert(Math.abs(at375.lineOffsets[0] + 4) < 0.05,
    `5c: 375 wide — the old layout puts Edit ${f2(at375.lineOffsets[0])} px off-center (Chrome measured -4.01)`);
  const at430 = measure(layout(old, items, content(430)), content(430));
  assert(!at430.wrapped && Math.abs(at430.hGaps[0] - 12.22) < 0.05,
    `5d: 430 wide — the old layout fits on one line, ${f2(at430.hGaps[0] ?? NaN)} px apart (Chrome measured 12.22)`);
}

console.log(`\n[btnspacingtest] ${pass} passed, ${fail} failed`);
// Flush before exiting (tbflagtest.mjs / authtest.mjs precedent): process.exit()
// does not drain piped stdout/stderr. The unref'd timer is the backstop if the
// write callback never fires.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail ? 1 : 0)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
