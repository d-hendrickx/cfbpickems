/**
 * CFB Pickems — themeresolve.mjs (SP-52 DI-456, helper for themetest.mjs and the per-side contrast suites)
 * ============================================================================
 * A small, deliberately honest CSS CASCADE for the properties the theme work depends on. It is test-only code (never loaded by the
 * app) and exists because the defect this whole input is built to prevent (SB-10 / RG-273: `--maroon-text:var(--maroon)` on :root
 * made every school render Munera crimson text) is invisible to any tool that reads one block at a time: it only shows up when
 * the REAL cascade is run, per theme, with `var()` substituted ON THE ELEMENT THAT DECLARES IT.
 *
 * What it models
 *   - rules from css/styles.css (comments stripped), in document order, including the rules inside
 *     `@media (prefers-color-scheme: dark)`; every other at-rule is ignored (@supports only with { supports:true }).
 *   - selector lists; compound selectors (type, universal, #id, .class, [attr], [attr="v"]); descendant and child combinators;
 *     :root, :not(), :is(), :where() (zero specificity), :first-child, :last-child, :nth-child(even|odd). State pseudo-classes
 *     (:hover, :active, :focus*, :disabled…), pseudo-elements and sibling combinators never match (the AT-REST rendering).
 *   - specificity (a,b,c) per the spec, then source order; !important beats both.
 *   - custom properties: declared on the element, INHERITED, and `var(--x, fallback)` substituted against the element's own
 *     computed custom properties AT THE ELEMENT THAT DECLARES THEM (so a :root alias freezes at :root — the SB-10 shape). A cycle
 *     or a missing reference with no fallback is the guaranteed-invalid value (undefined). `initial` is also undefined.
 *   - `color` (inherited) and `background-color` (painted, not inherited) with var() substitution, for the render fixtures.
 * What it does not model: layout, pseudo-elements, transitions, media queries other than the dark scheme, :has().
 *
 * Exports (all pure): parseSheet, resolveSide, makeBody, makeNode, computedCustom, computedProp, parseColor, compositeOver,
 * relLuminance, contrast, hex, plus the selector helpers selectorMatches / specificity.
 */
import fs from 'node:fs';

// ── CSS text → rules ───────────────────────────────────────────────────────────────────────────────────────────────────────
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

function splitTopLevel(css) {
  const out = []; let i = 0; const n = css.length;
  while (i < n) {
    while (i < n && /\s/.test(css[i])) i++;
    if (i >= n) break;
    // a statement at-rule (@import …;) has no block
    if (css[i] === '@') {
      // find the first `;` or `{` OUTSIDE quotes and parentheses (an @import url('…;…') carries semicolons inside its string)
      let k = i, q = null, d = 0, end = -1;
      for (; k < n; k++) {
        const ch = css[k];
        if (q) { if (ch === q) q = null; continue; }
        if (ch === '"' || ch === "'") { q = ch; continue; }
        if (ch === '(') d++; else if (ch === ')') d--;
        else if (d === 0 && (ch === ';' || ch === '{')) { end = k; break; }
      }
      if (end !== -1 && css[end] === ';') { i = end + 1; continue; }
    }
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, k = open + 1;
    while (k < n && depth > 0) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
    out.push({ prelude, body: css.slice(open + 1, k - 1) });
    i = k;
  }
  return out;
}

export function parseDecls(body) {
  const decls = []; let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { decls.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) decls.push(cur);
  return decls.map((d) => {
    const idx = d.indexOf(':'); if (idx === -1) return null;
    const prop = d.slice(0, idx).trim();
    let value = d.slice(idx + 1).trim();
    const important = /!important\s*$/i.test(value);
    value = value.replace(/!important\s*$/i, '').trim();
    return prop ? { prop: prop.startsWith('--') ? prop : prop.toLowerCase(), value, important } : null;
  }).filter(Boolean);
}

/** Split a selector list on top-level commas (not inside (), []). */
function splitList(s) {
  const out = []; let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ── selector parsing ───────────────────────────────────────────────────────────────────────────────────────────────────────
function parseCompound(src) {
  const c = { tag: null, ids: [], cls: [], attrs: [], pseudos: [], pseudoEl: false };
  let i = 0; const n = src.length;
  const ident = () => { const m = /^[a-zA-Z0-9_\-\\]+/.exec(src.slice(i)); if (!m) return ''; i += m[0].length; return m[0]; };
  while (i < n) {
    const ch = src[i];
    if (ch === '*') { i++; }
    else if (ch === '#') { i++; c.ids.push(ident()); }
    else if (ch === '.') { i++; c.cls.push(ident()); }
    else if (ch === '[') {
      const close = src.indexOf(']', i); const inner = src.slice(i + 1, close); i = close + 1;
      const m = /^\s*([^\s~|^$*=]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]*)))?\s*$/.exec(inner);
      if (m) c.attrs.push({ name: m[1], op: m[2] || null, value: m[3] ?? m[4] ?? m[5] });
    } else if (ch === ':') {
      if (src[i + 1] === ':') { c.pseudoEl = true; i += 2; ident(); if (src[i] === '(') { i = matchParen(src, i) + 1; } continue; }
      i++; const name = ident().toLowerCase(); let arg = null;
      if (src[i] === '(') { const end = matchParen(src, i); arg = src.slice(i + 1, end); i = end + 1; }
      c.pseudos.push({ name, arg });
    } else if (/[a-zA-Z]/.test(ch)) { c.tag = ident().toLowerCase(); }
    else i++;
  }
  return c;
}
function matchParen(s, i) { let d = 0; for (let k = i; k < s.length; k++) { if (s[k] === '(') d++; else if (s[k] === ')') { d--; if (d === 0) return k; } } return s.length - 1; }

/** complex selector → [{compound, comb}] where comb is the combinator BEFORE the compound ('' | ' ' | '>' | '+' | '~'). */
function parseComplex(src) {
  const parts = []; let cur = ''; let depth = 0; let comb = '';
  const push = () => { if (cur.trim()) { parts.push({ compound: parseCompound(cur.trim()), comb }); comb = ''; } cur = ''; };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '(' || ch === '[') depth++; else if (ch === ')' || ch === ']') depth--;
    if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === '\n' || ch === '\t')) {
      if (cur.trim()) push();
      if (ch === '>' || ch === '+' || ch === '~') comb = ch; else if (!comb && parts.length) comb = ' ';
      continue;
    }
    cur += ch;
  }
  push();
  return parts;
}
const _selCache = new Map();
export function parseSelectorList(src) {
  if (_selCache.has(src)) return _selCache.get(src);
  const v = splitList(src).map(parseComplex);
  _selCache.set(src, v); return v;
}

/** Specificity of ONE complex selector as [a,b,c]. */
export function specificity(complex) {
  let a = 0, b = 0, c = 0;
  for (const { compound: k } of complex) {
    a += k.ids.length; b += k.cls.length + k.attrs.length; if (k.tag) c++; if (k.pseudoEl) c++;
    for (const p of k.pseudos) {
      if (p.name === 'where') continue;
      if (p.name === 'is' || p.name === 'not' || p.name === 'matches') {
        let best = [0, 0, 0];
        for (const inner of parseSelectorList(p.arg || '')) { const s = specificity(inner); if (cmp(s, best) > 0) best = s; }
        a += best[0]; b += best[1]; c += best[2];
      } else b++;
    }
  }
  return [a, b, c];
}
const cmp = (x, y) => (x[0] - y[0]) || (x[1] - y[1]) || (x[2] - y[2]);

// ── matching ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
let _nodeId = 0;
export function makeNode({ tag = 'div', classes = [], attrs = {}, parent = null, index = 0, count = 1, text = '', style = '' } = {}) {
  return { id: ++_nodeId, tag, classes: new Set(classes), attrs: { ...attrs }, parent, index, count, text, style, children: [] };
}
/** The two elements every side is resolved on: <html> and <body class="theme-KEY" data-color-scheme=…>. */
export function makeBody(themeKey, pinned) {
  const html = makeNode({ tag: 'html' });
  const attrs = {}; if (pinned === 'light' || pinned === 'dark') attrs['data-color-scheme'] = pinned;
  const body = makeNode({ tag: 'body', classes: themeKey ? ['theme-' + themeKey] : [], attrs, parent: html });
  html.children.push(body);
  return body;
}

function attrMatch(node, a) {
  const has = Object.prototype.hasOwnProperty.call(node.attrs, a.name);
  if (!has) return false;
  if (!a.op) return true;
  const v = String(node.attrs[a.name]);
  switch (a.op) { case '=': return v === a.value; case '~=': return v.split(/\s+/).includes(a.value); case '^=': return v.startsWith(a.value); case '$=': return v.endsWith(a.value); case '*=': return v.includes(a.value); case '|=': return v === a.value || v.startsWith(a.value + '-'); default: return false; }
}
function compoundMatches(k, node) {
  if (k.pseudoEl) return false;
  if (k.tag && k.tag !== node.tag) return false;
  for (const id of k.ids) if (node.attrs.id !== id) return false;
  for (const c of k.cls) if (!node.classes.has(c)) return false;
  for (const a of k.attrs) if (!attrMatch(node, a)) return false;
  for (const p of k.pseudos) {
    switch (p.name) {
      case 'root': if (node.tag !== 'html') return false; break;
      case 'where': case 'is': case 'matches': if (!parseSelectorList(p.arg || '').some((cx) => complexMatches(cx, node))) return false; break;
      case 'not': if (parseSelectorList(p.arg || '').some((cx) => complexMatches(cx, node))) return false; break;
      case 'first-child': if (node.index !== 0) return false; break;
      case 'last-child': if (node.index !== node.count - 1) return false; break;
      case 'nth-child': {
        const arg = String(p.arg || '').trim();
        if (arg === 'even') { if (node.index % 2 !== 1) return false; }
        else if (arg === 'odd') { if (node.index % 2 !== 0) return false; }
        else return false;
        break;
      }
      default: return false; // :hover :active :focus :disabled :checked :has … — at-rest rendering only
    }
  }
  return true;
}
function complexMatches(parts, node) {
  if (!parts.length) return false;
  const walk = (pi, n) => {
    if (!compoundMatches(parts[pi].compound, n)) return false;
    if (pi === 0) return true;
    const comb = parts[pi].comb;
    if (comb === ' ') { for (let a = n.parent; a; a = a.parent) if (walk(pi - 1, a)) return true; return false; }
    if (comb === '>') return !!n.parent && walk(pi - 1, n.parent);
    return false; // sibling combinators: not modelled
  };
  return walk(parts.length - 1, node);
}
export function selectorMatches(selectorText, node) {
  return parseSelectorList(selectorText).some((cx) => complexMatches(cx, node));
}

// ── sheet ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** media: null (always) | 'dark' | 'other' (ignored). */
export function parseSheet(cssText) {
  const css = stripComments(cssText);
  const rules = []; let order = 0;
  const walkBlocks = (blocks, media) => {
    for (const b of blocks) {
      if (b.prelude.startsWith('@')) {
        if (/^@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)\s*$/i.test(b.prelude)) walkBlocks(splitTopLevel(b.body), 'dark');
        else if (/^@supports/i.test(b.prelude)) walkBlocks(splitTopLevel(b.body), media === 'dark' ? 'dark' : 'supports');
        else if (/^@media/i.test(b.prelude)) walkBlocks(splitTopLevel(b.body), 'other:' + b.prelude);
        continue; // @keyframes, @font-face, @page: no tokens
      }
      const decls = parseDecls(b.body);
      if (!decls.length) continue;
      rules.push({ selectorText: b.prelude, selectors: parseSelectorList(b.prelude), decls, media, order: order++ });
    }
  };
  walkBlocks(splitTopLevel(css), null);
  return { rules, css };
}
export function loadSheet(path) { return parseSheet(fs.readFileSync(path, 'utf8')); }

// ── cascade ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
function mediaApplies(rule, ctx) {
  if (rule.media === null) return true;
  if (rule.media === 'dark') return !!ctx.osDark;
  if (rule.media === 'supports') return !!ctx.supports;
  return false; // any other @media: not modelled
}
/** A rule index so a fixture with hundreds of nodes does not run every selector against every node: each (rule, complex selector)
 *  is bucketed by the FIRST class of its rightmost compound, else its tag, else `any`. */
function indexFor(sheet) {
  if (sheet._index) return sheet._index;
  const idx = { cls: new Map(), tag: new Map(), any: [] };
  for (const rule of sheet.rules) {
    for (const cx of rule.selectors) {
      if (!cx.length) continue;
      const k = cx[cx.length - 1].compound;
      const entry = { rule, cx, spec: specificity(cx) };
      if (k.cls.length) { const key = k.cls[0]; (idx.cls.get(key) || idx.cls.set(key, []).get(key)).push(entry); }
      else if (k.tag) { (idx.tag.get(k.tag) || idx.tag.set(k.tag, []).get(k.tag)).push(entry); }
      else idx.any.push(entry);
    }
  }
  sheet._index = idx;
  return idx;
}
/** Winning declarations per property for `node`: { prop: {value, spec, order, important} }. */
function cascadeDeclared(sheet, node, ctx) {
  const cache = (ctx._declCache ??= new Map());
  if (cache.has(node)) return cache.get(node);
  const idx = indexFor(sheet);
  const cands = [...idx.any];
  for (const c of node.classes) { const l = idx.cls.get(c); if (l) cands.push(...l); }
  const tl = idx.tag.get(node.tag); if (tl) cands.push(...tl);
  const win = {};
  for (const { rule, cx, spec } of cands) {
    if (!mediaApplies(rule, ctx)) continue;
    if (!complexMatches(cx, node)) continue;
    for (const d of rule.decls) {
      const key = d.prop;
      const cur = win[key];
      const better = !cur
        || (d.important && !cur.important)
        || (d.important === cur.important && (cmp(spec, cur.spec) > 0 || (cmp(spec, cur.spec) === 0 && rule.order >= cur.order)));
      if (better) win[key] = { value: d.value, spec, order: rule.order, important: d.important, selector: rule.selectorText };
    }
  }
  // inline style (a fixture's style="…") beats any non-important rule
  if (node.style) for (const d of parseDecls(node.style)) win[d.prop] = { value: d.value, spec: [9, 9, 9], order: 9e9, important: d.important, selector: '<inline>' };
  cache.set(node, win);
  return win;
}

function substituteVars(value, lookup, depth = 0) {
  if (value == null) return undefined;
  let v = value;
  const re = /var\(\s*(--[A-Za-z0-9_-]+)\s*(?:,((?:[^()]|\([^()]*\))*))?\)/;
  let guard = 0;
  while (re.test(v) && guard++ < 50) {
    let bad = false;
    v = v.replace(re, (m, name, fb) => {
      const got = lookup(name);
      if (got !== undefined) return got;
      if (fb !== undefined) return fb.trim();
      bad = true; return '\u0000INVALID\u0000';
    });
    if (bad) return undefined;
  }
  return v.includes('\u0000') ? undefined : v.trim();
}

/** The computed value of custom property `name` on `node`: declared here (var() substituted against this node) or inherited. */
export function computedCustom(sheet, node, name, ctx = {}) {
  const memo = (ctx._customMemo ??= new Map());
  const key = node.id + '|' + name;
  if (memo.has(key)) return memo.get(key);
  const active = (ctx._active ??= new Set());
  if (active.has(key)) return undefined; // a cycle is the guaranteed-invalid value
  active.add(key);
  const decl = cascadeDeclared(sheet, node, ctx)[name];
  let out;
  if (decl) {
    const raw = decl.value.trim();
    if (/^initial$/i.test(raw)) out = undefined;
    else if (/^(inherit|unset)$/i.test(raw)) out = node.parent ? computedCustom(sheet, node.parent, name, ctx) : undefined;
    else out = substituteVars(raw, (ref) => computedCustom(sheet, node, ref, ctx));
  } else out = node.parent ? computedCustom(sheet, node.parent, name, ctx) : undefined;
  active.delete(key);
  memo.set(key, out);
  return out;
}

/** Computed `color` (inherited) or `background-color` (not inherited) etc., var()-substituted on the element. */
const INHERITED = new Set(['color', 'color-scheme', 'font-size', 'font-weight', 'opacity_']);
export function computedProp(sheet, node, prop, ctx = {}) {
  const decl = cascadeDeclared(sheet, node, ctx)[prop];
  if (decl) {
    const raw = decl.value.trim();
    if (/^inherit$/i.test(raw)) return node.parent ? computedProp(sheet, node.parent, prop, ctx) : undefined;
    return substituteVars(raw, (ref) => computedCustom(sheet, node, ref, ctx));
  }
  if (INHERITED.has(prop) && node.parent) return computedProp(sheet, node.parent, prop, ctx);
  return undefined;
}
/** The raw winning background shorthand/background-color on this node ('background' and 'background-color' merged by order). */
export function computedBackground(sheet, node, ctx = {}) {
  const d = cascadeDeclared(sheet, node, ctx);
  const a = d['background'], b = d['background-color'];
  const win = a && b ? (a.order > b.order ? a : b) : (a || b);
  if (!win) return undefined;
  return substituteVars(win.value.trim(), (ref) => computedCustom(sheet, node, ref, ctx));
}

// ── sides ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Resolve every custom property on <body> for one side.
 *   side 'L' | 'D'; trigger 'system' (no attribute; osDark = side === 'D') | 'pinned' (attribute = light|dark; the OS is set the
 *   OPPOSITE way on purpose, so a leak from the wrong trigger shows).
 * Returns { tokens(name), all(names), body, ctx }.
 */
export function resolveSide(sheet, themeKey, side, trigger = 'system') {
  const dark = side === 'D';
  const pinned = trigger === 'pinned' ? (dark ? 'dark' : 'light') : null;
  const osDark = trigger === 'pinned' ? !dark : dark;
  const body = makeBody(themeKey, pinned);
  const ctx = { osDark };
  const get = (name) => computedCustom(sheet, body, name, ctx);
  return { body, ctx, get, tokens: (names) => Object.fromEntries(names.map((n) => [n, get(n)])) };
}

/** All custom-property names any rule declares. */
export function allCustomNames(sheet) {
  const s = new Set();
  for (const r of sheet.rules) for (const d of r.decls) if (d.prop.startsWith('--')) s.add(d.prop);
  return [...s];
}

// ── colours ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const NAMED = { white: [255, 255, 255], black: [0, 0, 0] };
export function parseColor(v) {
  if (v == null) return null;
  v = String(v).trim();
  if (/^transparent$/i.test(v)) return { rgb: [0, 0, 0], a: 0 };
  if (NAMED[v.toLowerCase()]) return { rgb: NAMED[v.toLowerCase()], a: 1 };
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return { rgb: [(n >> 16) & 255, (n >> 8) & 255, n & 255], a: h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i.exec(v);
  if (m) { const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4])); return { rgb: [+m[1], +m[2], +m[3]], a }; }
  return null;
}
export function compositeOver(top, bottomRgb) {
  return top.rgb.map((c, i) => c * top.a + bottomRgb[i] * (1 - top.a));
}
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
export function relLuminance(rgb) { return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]); }
export function contrast(a, b) {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
export const hex = (rgb) => '#' + rgb.map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
export function rgbOf(v) { const c = parseColor(v); return c ? c.rgb : null; }


// ── a tiny HTML fixture parser (test-only: well-formed markup the app's own renderers emit) ─────────────────────────────────
const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'wbr']);
/** Parse `html` into element nodes appended under `parent`. <svg>, <script>, <style> and comments are dropped (icons are not text). */
export function parseHtml(html, parent) {
  const tokRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s=>\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  const stack = [parent];
  const roots = [];
  let m;
  const text = (t) => { const cur = stack[stack.length - 1]; const clean = t.replace(/&nbsp;/g, ' ').replace(/&[a-z#0-9]+;/gi, 'x').trim(); if (clean) cur.text += (cur.text ? ' ' : '') + clean; };
  let skip = null; // tag name being skipped (svg/script/style) + depth
  let skipDepth = 0;
  while ((m = tokRe.exec(html))) {
    const whole = m[0];
    if (whole.startsWith('<!--')) continue;
    if (m[4] !== undefined) { if (!skip) text(m[4]); continue; }
    const tag = m[1].toLowerCase();
    const closing = whole.startsWith('</');
    if (skip) {
      if (tag === skip) { if (closing) { skipDepth--; if (skipDepth === 0) skip = null; } else if (!m[3]) skipDepth++; }
      continue;
    }
    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) { if (stack[k].tag === tag) { stack.length = k; break; } }
      continue;
    }
    if (tag === 'svg' || tag === 'script' || tag === 'style') { if (!m[3]) { skip = tag; skipDepth = 1; } continue; }
    const attrs = {}; let classes = []; let style = '';
    const attrRe = /([^\s=>\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let am;
    while ((am = attrRe.exec(m[2] || ''))) {
      const name = am[1]; const val = am[2] ?? am[3] ?? am[4] ?? '';
      if (name === 'class') classes = val.split(/\s+/).filter(Boolean);
      else if (name === 'style') style = val;
      else attrs[name] = val;
    }
    const par = stack[stack.length - 1];
    const node = makeNode({ tag, classes, attrs, parent: par, style });
    node.index = par.children.length; par.children.push(node);
    for (const sib of par.children) sib.count = par.children.length;
    if (par === parent) roots.push(node);
    if (!VOID.has(tag) && !m[3]) stack.push(node);
  }
  return roots;
}
/** Every node in a subtree (pre-order). */
export function walk(node, fn) { fn(node); for (const c of node.children) walk(c, fn); }

/** Effective font size in px for a node (rem/em/%/px resolved up the chain; the root is 16px). */
export function fontPx(sheet, node, ctx = {}) {
  const chain = []; for (let n = node; n; n = n.parent) chain.unshift(n);
  let px = 16;
  for (const n of chain) {
    const d = cascadeDeclared(sheet, n, ctx)['font-size'];
    if (!d) continue;
    const v = substituteVars(d.value.trim(), (ref) => computedCustom(sheet, n, ref, ctx));
    const mm = /^([\d.]+)(rem|px|em|%)$/.exec(String(v || ''));
    if (!mm) continue;
    const num = parseFloat(mm[1]);
    px = mm[2] === 'rem' ? num * 16 : mm[2] === 'px' ? num : mm[2] === 'em' ? num * px : (num / 100) * px;
  }
  return px;
}
export function fontWeight(sheet, node, ctx = {}) {
  for (let n = node; n; n = n.parent) {
    const d = cascadeDeclared(sheet, n, ctx)['font-weight'];
    if (d) { const v = d.value.trim(); return /bold/i.test(v) ? 700 : (parseInt(v, 10) || 400); }
  }
  return 400;
}
/** Product of the `opacity` of this node and its ancestors (an opacity group, approximated as applying to the text over its surface). */
export function opacityOf(sheet, node, ctx = {}) {
  let o = 1;
  for (let n = node; n; n = n.parent) {
    const d = cascadeDeclared(sheet, n, ctx)['opacity'];
    if (d) { const f = parseFloat(substituteVars(d.value.trim(), (ref) => computedCustom(sheet, n, ref, ctx)) || '1'); if (Number.isFinite(f)) o *= f; }
  }
  return o;
}
/** Is the node (or an ancestor) not painted? display:none, visibility:hidden, [hidden], .sr-only. */
export function isHidden(sheet, node, ctx = {}) {
  for (let n = node; n; n = n.parent) {
    if (Object.prototype.hasOwnProperty.call(n.attrs, 'hidden') || n.attrs['aria-hidden'] === 'true' && n.classes.has('sr-only')) return true;
    if (n.classes.has('sr-only')) return true;
    const d = cascadeDeclared(sheet, n, ctx);
    if (d['display'] && /^none$/i.test(d['display'].value.trim())) return true;
    if (d['visibility'] && /^hidden$/i.test(d['visibility'].value.trim())) return true;
  }
  return false;
}
/**
 * The colours painted UNDER a node's text, worst-case list of opaque surfaces: walks up the ancestors, compositing translucent layers
 * over the first opaque one (the page background, body{background:var(--bg)}, is always reached). A gradient yields every stop; an
 * unparseable or image background returns null (unresolved: the caller records it, never guesses).
 */
export function paintedSurfaces(sheet, node, ctx = {}) {
  const layers = [];
  for (let n = node; n; n = n.parent) {
    const raw = computedBackground(sheet, n, ctx);
    if (raw === undefined || /^(none|transparent)$/i.test(raw.trim())) continue;
    if (/url\(/i.test(raw)) return null;
    let cands;
    if (/gradient\(/i.test(raw)) {
      cands = [...raw.matchAll(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)].map((mm) => parseColor(mm[1])).filter(Boolean);
    } else {
      const direct = parseColor(raw.trim()); let c = direct;
      if (!c) { const tok = raw.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|\btransparent\b|\bwhite\b|\bblack\b)/i); c = tok ? parseColor(tok[1]) : null; }
      cands = c ? [c] : [];
    }
    if (!cands.length) return null;
    layers.push(cands);
    if (cands.every((c) => c.a >= 1)) break;
  }
  if (!layers.length) return null;
  let surfaces = [null];
  for (let i = layers.length - 1; i >= 0; i--) {
    const next = [];
    for (const under of surfaces) for (const c of layers[i]) next.push(under === null ? compositeOver(c, [255, 255, 255]) : compositeOver(c, under));
    surfaces = next;
  }
  return surfaces;
}
