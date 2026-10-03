/**
 * CFB Pickems — dashcontrasttest.mjs (SB-06 DASHBOARD-DARK-CONTRAST + SB-07
 * LOGO-GRAY-BACKGROUND, Social Platform thread, bugfixer, 2026-09-30)
 * ============================================================================
 * Drew, 2026-09-30: "The black background right now is super cool, but when
 * the dashboard cards are black its hard to read the games and see the
 * logos." — and, same day: "right now the logos all have a gray background
 * behind them but the logo background should match whatever color background
 * they are sitting on."
 *
 * WHAT THIS PROVES
 * ----------------
 *   [1] Every TEXT ROLE on the dashboard's game rows (compact cards AND the
 *       standard matrix) clears WCAG AA — 4.5:1 normal text, 3:1 large text
 *       (>= 24px, or >= 18.66px at weight >= 700) — in EVERY shipped theme,
 *       including Munera night mode via BOTH of its triggers (the
 *       prefers-color-scheme media block and the manual
 *       [data-color-scheme="dark"] block, checked separately, never assumed
 *       identical).
 *   [2] No team-logo element or its container paints a background fill (the
 *       SB-07 gray square), a plate, a halo or a shadow — in the CSS as
 *       written (deny-by-default over every class whose name contains
 *       "logo") and in the resolved cascade for every theme.
 *   [3] Every inline `color:` inside the dashboard renderers in js/app.js is
 *       one this file checks — an inline style is invisible to a CSS scan
 *       (that is how the matrix's "ATS:" label escaped the Phase 2
 *       --maroon -> --maroon-text retarget).
 *
 * WHY contrastscan.mjs DID NOT CATCH THIS
 * ---------------------------------------
 * contrastscan.mjs only fires on rules that declare their OWN resolvable
 * background, and it deliberately SKIPS translucent rgba() backgrounds. The
 * live covering/trailing chips and cells paint a translucent rgba() tint
 * (animated by @keyframes) under a HARDCODED light-mode text hex — both
 * halves of that were outside its reach. This file models the actual element
 * stack instead: page -> card -> row/chip -> text, compositing every
 * translucent layer, every opacity, and both extremes of every keyframe
 * animation, then takes the WORST case.
 *
 * METHOD (static, no DOM — same family as contrastscan.mjs/brandtokentest.mjs)
 *   - Token maps are parsed from css/styles.css, never hardcoded. The
 *     custom-property cascade is modelled correctly: a `var()` inside a
 *     custom property declared on :root is substituted ON :root, so a
 *     descendant theme that overrides --maroon does NOT change an inherited
 *     --maroon-text (real CSS behaviour; see the report for the finding).
 *   - A small selector matcher (tag, classes, attributes, :nth-child(even),
 *     descendant/child combinators) resolves color / background / opacity /
 *     animation / font-size / font-weight per element by !important, then
 *     specificity, then source order. Rules whose selector needs an
 *     interaction state (:hover, :active, ::before …) are ignored — this is
 *     the at-rest rendering. @media blocks other than the two dark token
 *     blocks are ignored (responsive/reduced-motion rules don't change
 *     dashboard colours).
 *   - Inline styles are applied with inline precedence.
 *
 * Run:  node dashcontrasttest.mjs            (assertions)
 *       node dashcontrasttest.mjs --table    (also prints every ratio)
 *       node dashcontrasttest.mjs --css <path> (scan another styles.css —
 *                                             used for the mutation proof)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as ThemeR from './themeresolve.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

// ─── WCAG math ───────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex([r, g, b]) {
  return '#' + [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, '0')).join('').toUpperCase();
}
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
function luminance(hex) { const [r, g, b] = hexToRgb(hex); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
export function contrastRatio(a, b) {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Paint colour {rgb, a} over an opaque hex backdrop → opaque hex. */
function over(color, backdropHex) {
  const bd = hexToRgb(backdropHex);
  return rgbToHex(color.rgb.map((c, i) => c * color.a + bd[i] * (1 - color.a)));
}
/** mix(X, behind, alpha) — the opacity-group composite. */
function mix(xHex, behindHex, alpha) {
  const x = hexToRgb(xHex), b = hexToRgb(behindHex);
  return rgbToHex(x.map((c, i) => c * alpha + b[i] * (1 - alpha)));
}

// ─── CSS text utilities ──────────────────────────────────────────────────────
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, ' ');

/** Split top-level CSS into blocks: { prelude, body, atRule } — at-rule
 *  blocks keep their raw inner text so the caller can decide what to do. */
function topLevelBlocks(css) {
  const out = [];
  let i = 0; const n = css.length;
  while (i < n) {
    const open = css.indexOf('{', i);
    if (open === -1) break;
    const prelude = css.slice(i, open).trim();
    let depth = 1, k = open + 1;
    while (k < n && depth > 0) { if (css[k] === '{') depth++; else if (css[k] === '}') depth--; k++; }
    const body = css.slice(open + 1, k - 1);
    // A stray `;`-terminated statement (e.g. @import …;) before the prelude.
    const cleanPrelude = prelude.includes(';') ? prelude.slice(prelude.lastIndexOf(';') + 1).trim() : prelude;
    out.push({ prelude: cleanPrelude, body, atRule: cleanPrelude.startsWith('@') });
    i = k;
  }
  return out;
}

function parseDecls(body) {
  const decls = [];
  // split on ; not inside parentheses
  let depth = 0, cur = '';
  for (const ch of body) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) { decls.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) decls.push(cur);
  return decls.map((d) => {
    const idx = d.indexOf(':');
    if (idx === -1) return null;
    const prop = d.slice(0, idx).trim().toLowerCase();
    let value = d.slice(idx + 1).trim();
    const important = /!important\s*$/i.test(value);
    value = value.replace(/!important\s*$/i, '').trim();
    return prop ? { prop, value, important } : null;
  }).filter(Boolean);
}

// ─── Token maps (custom-property cascade, modelled correctly) ────────────────
function declsOf(blocks, preludeTest) {
  const vars = {};
  for (const b of blocks) {
    if (b.atRule) continue;
    if (!preludeTest(b.prelude)) continue;
    for (const d of parseDecls(b.body)) if (d.prop.startsWith('--')) vars[d.prop] = d.value;
  }
  return vars;
}
function mediaInner(blocks, test) {
  return blocks.filter((b) => b.atRule && test(b.prelude)).flatMap((b) => topLevelBlocks(b.body));
}
/** Substitute var() references in every value of `raw`, looking names up in
 *  `scope` (which already holds inherited, fully-substituted values). */
function substituteAll(raw, inherited) {
  const scope = { ...inherited, ...raw };
  const out = {};
  const resolving = new Set();
  const sub = (name) => {
    if (out[name] !== undefined) return out[name];
    if (resolving.has(name)) return null;
    resolving.add(name);
    const v = Object.prototype.hasOwnProperty.call(raw, name) ? subValue(raw[name]) : scope[name];
    resolving.delete(name);
    out[name] = v;
    return v;
  };
  const subValue = (v) => {
    if (v == null) return v;
    let guard = 0;
    while (/var\(/.test(v) && guard++ < 20) {
      v = v.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g, (m, nm, fb) => {
        const r = Object.prototype.hasOwnProperty.call(raw, nm) ? sub(nm) : inherited[nm];
        return r != null ? r : (fb != null ? fb.trim() : 'UNRESOLVED');
      });
    }
    return v;
  };
  for (const k of Object.keys(raw)) sub(k);
  return { ...inherited, ...out };
}

/**
 * Token maps for every SIDE of every theme.
 * RE-DERIVED (SP-52 DI-456, 2026-10-01): this used to model ten maps by hand (the bare :root, each theme block, and ONE theme's two night triggers) with
 * its own substituteAll(). The night region is now an enumerated list of shared Dark-surface selectors plus per-look and per-school brand blocks, so the
 * maps come from themeresolve.mjs's REAL cascade instead — specificity, source order, the media trigger, and var() substituted ON THE DECLARING ELEMENT
 * (the shape SB-10 broke on). Names are kept so every consumer keeps working:
 *   'default (no class)'                      the bare :root
 *   '<key>'                                   the key's LIGHT side            (aggie, sooner, trojan, irish, boilermaker, razorback, neutral, paper, ink, graphite)
 *   '<key> · dark (OS setting)'               its DARK side by the media trigger (System + the OS dark)
 *   '<key> · dark (manual toggle)'            its DARK side by the pinned attribute (OS light) — checked separately, never assumed identical
 * 1 + 10 + 10 + 10 = 31 maps = the TWENTY sides, Dark counted once per trigger. For Paper Dark the dashboard, the Picks card and the chat header all sit
 * inside a PAPER ROOT (themetest [T10]), so the map is the page-context tokens overlaid by the paper-scope tokens — the surface those suites model.
 */
export function buildThemes(cssSrc) {
  const sheet = ThemeR.parseSheet(cssSrc);
  const names = ThemeR.allCustomNames(sheet);
  const themeKeys = [...new Set(sheet.rules.filter((r) => r.media === null && /^body\.theme-[a-z]+$/.test(r.selectorText.trim())).map((r) => r.selectorText.trim().slice('body.theme-'.length)))];
  const mapOf = (key, side, trigger) => {
    const r = ThemeR.resolveSide(sheet, key, side, trigger);
    const out = {}; for (const n of names) { const v = r.get(n); if (v !== undefined) out[n] = v; }
    if (key === 'paper' && side === 'D') {
      const scope = ThemeR.makeNode({ tag: 'div', classes: ['card'], parent: r.body }); r.body.children.push(scope);
      for (const n of names) { const v = ThemeR.computedCustom(sheet, scope, n, r.ctx); if (v !== undefined) out[n] = v; }
    }
    return out;
  };
  const rootNode = ThemeR.makeNode({ tag: 'html' });
  const rootMap = {}; for (const n of names) { const v = ThemeR.computedCustom(sheet, rootNode, n, { osDark: false }); if (v !== undefined) rootMap[n] = v; }
  const themes = { 'default (no class)': rootMap };
  for (const key of themeKeys) themes[key] = mapOf(key, 'L', 'system');
  for (const key of themeKeys) themes[`${key} · dark (OS setting)`] = mapOf(key, 'D', 'system');
  for (const key of themeKeys) themes[`${key} · dark (manual toggle)`] = mapOf(key, 'D', 'pinned');
  // how many tokens Munera's Dark blocks (A + B-munera) declare per trigger — the old suites' "both night blocks parsed" fixture
  const darkNeutral = (manual) => sheet.rules.filter((r) => (manual ? (r.media === null && /body\.theme-neutral\[data-color-scheme="dark"\]/.test(r.selectorText)) : (r.media === 'dark' && /body\.theme-neutral:not\(/.test(r.selectorText))) && !r.selectorText.startsWith(':where('))
    .flatMap((r) => r.decls.filter((d) => d.prop.startsWith('--')).map((d) => d.prop));
  return { themes, themeKeys, blocks: topLevelBlocks(stripComments(cssSrc)), sheet, mediaDarkCount: new Set(darkNeutral(false)).size, manualDarkCount: new Set(darkNeutral(true)).size };
}

// ─── Colour value parsing ────────────────────────────────────────────────────
const NAMED = { white: '#FFFFFF', black: '#000000' };
function subVars(value, tokens) {
  let v = value, guard = 0;
  while (/var\(/.test(v) && guard++ < 20) {
    v = v.replace(/var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([^()]*(?:\([^()]*\))?[^()]*))?\)/g,
      (m, nm, fb) => tokens[nm] ?? (fb != null ? fb.trim() : 'UNRESOLVED'));
  }
  return v;
}
/** One colour literal → {rgb:[r,g,b], a} or null. */
function parseColor(v) {
  v = v.trim();
  if (/^transparent$/i.test(v) || /^none$/i.test(v)) return { rgb: [0, 0, 0], a: 0 };
  if (NAMED[v.toLowerCase()]) return { rgb: hexToRgb(NAMED[v.toLowerCase()]), a: 1 };
  if (/^#[0-9a-f]{3,8}$/i.test(v)) {
    const h = v.slice(1);
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
    return { rgb: hexToRgb('#' + (h.length === 4 ? h.slice(0, 3) : h.slice(0, 6))), a };
  }
  const m = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?))?\s*\)$/i);
  if (m) {
    let a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]));
    return { rgb: [+m[1], +m[2], +m[3]], a };
  }
  return null;
}
/** A background value → list of candidate paint colours (a gradient yields
 *  every stop — the text must clear the floor against the worst one). */
function backgroundCandidates(value, tokens) {
  const v = subVars(value, tokens).trim();
  if (/UNRESOLVED/.test(v)) return null;
  if (/gradient\(/i.test(v)) {
    const stops = [...v.matchAll(/(#[0-9a-f]{3,8}|rgba?\([^)]*\))/gi)].map((m) => parseColor(m[1])).filter(Boolean);
    return stops.length ? stops : null;
  }
  if (/url\(/i.test(v)) return null;
  // `background: <color> <other layers…>` — first token that is a colour.
  const direct = parseColor(v);
  if (direct) return [direct];
  const tok = v.match(/(#[0-9a-f]{3,8}|rgba?\([^)]*\)|\btransparent\b|\bnone\b|\bwhite\b|\bblack\b)/i);
  return tok ? [parseColor(tok[1])] : null;
}

// ─── Rules + a small selector matcher ────────────────────────────────────────
function parseCompound(s) {
  const c = { tag: null, ids: [], cls: [], attrs: [], pseudos: [], pseudoEl: false };
  const re = /(^[a-zA-Z][a-zA-Z0-9]*|^\*)|#([a-zA-Z0-9_-]+)|\.([a-zA-Z0-9_-]+)|\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]|(::?[a-zA-Z-]+(?:\([^)]*\))?)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) c.tag = m[1] === '*' ? null : m[1].toLowerCase();
    else if (m[2]) c.ids.push(m[2]);
    else if (m[3]) c.cls.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4].trim(), value: m[5] });
    else if (m[6]) { if (m[6].startsWith('::')) c.pseudoEl = true; else c.pseudos.push(m[6]); }
  }
  return c;
}
function parseSelector(sel) {
  const parts = sel.replace(/\s*[>+~]\s*/g, ' ').trim().split(/\s+/).map(parseCompound);
  let a = 0, b = 0, cc = 0;
  for (const p of parts) { a += p.ids.length; b += p.cls.length + p.attrs.length + p.pseudos.length; cc += (p.tag ? 1 : 0) + (p.pseudoEl ? 1 : 0); }
  return { parts, spec: a * 1e6 + b * 1e3 + cc };
}
const AT_REST_PSEUDOS = new Set([':nth-child(even)', ':last-child', ':first-child']);
function compoundMatches(c, node) {
  if (c.pseudoEl) return false;
  if (c.tag && c.tag !== (node.tag || 'div')) return false;
  for (const id of c.ids) if (!(node.attrs && node.attrs.id === id)) return false;
  for (const k of c.cls) if (!(node.cls || []).includes(k)) return false;
  for (const at of c.attrs) {
    const has = node.attrs && Object.prototype.hasOwnProperty.call(node.attrs, at.name);
    if (!has) return false;
    if (at.value !== undefined && String(node.attrs[at.name]) !== at.value) return false;
  }
  for (const p of c.pseudos) {
    const not = p.match(/^:not\((.*)\)$/);
    if (not) {
      // :not(<simple compound>) — the element must NOT match the inner compound.
      const inner = parseCompound(not[1]);
      if (inner.pseudos.length || inner.pseudoEl) return false; // e.g. :not(:disabled) — state-dependent, skip the rule
      if (compoundMatches(inner, node)) return false;
      continue;
    }
    if (!AT_REST_PSEUDOS.has(p)) return false;
    if (p === ':nth-child(even)' && !node.even) return false;
    if (p === ':last-child' && !node.last) return false;
    if (p === ':first-child' && !node.first) return false;
  }
  return true;
}
function selectorMatches(parsed, chain, idx) {
  const parts = parsed.parts;
  if (!compoundMatches(parts[parts.length - 1], chain[idx])) return false;
  let j = idx - 1;
  for (let p = parts.length - 2; p >= 0; p--) {
    while (j >= 0 && !compoundMatches(parts[p], chain[j])) j--;
    if (j < 0) return false;
    j--;
  }
  return true;
}
export function collectRules(blocks) {
  const rules = [];
  let order = 0;
  for (const b of blocks) {
    if (b.atRule) continue; // @media/@supports/@keyframes are not at-rest dashboard colour sources
    const decls = parseDecls(b.body).filter((d) => !d.prop.startsWith('--'));
    if (!decls.length) continue;
    for (const sel of b.prelude.split(',')) {
      const s = sel.trim();
      if (!s || s.startsWith('@') || s === ':root' || /^body\.theme-/.test(s) || /^html/.test(s)) continue;
      // Sibling combinators (+ ~) are not ancestor relations; no dashboard
      // colour depends on one — skip rather than mis-model them.
      if (/[+~]/.test(s.replace(/\([^)]*\)/g, '').replace(/\[[^\]]*\]/g, ''))) continue;
      rules.push({ sel: s, parsed: parseSelector(s), decls, order: order++ });
    }
  }
  return rules;
}
function keyframes(blocks) {
  const kf = {};
  for (const b of blocks) {
    const m = b.prelude.match(/^@keyframes\s+([a-zA-Z0-9_-]+)/);
    if (!m) continue;
    kf[m[1]] = topLevelBlocks(b.body).map((f) => parseDecls(f.body)).flat();
  }
  return kf;
}
/** Winning declared value per property for chain[idx] (no inheritance). */
function cascade(rules, chain, idx) {
  const win = {};
  const consider = (prop, value, important, spec, order) => {
    const cur = win[prop];
    const key = [important ? 1 : 0, spec, order];
    if (!cur || key[0] > cur.key[0] || (key[0] === cur.key[0] && (key[1] > cur.key[1] || (key[1] === cur.key[1] && key[2] >= cur.key[2])))) {
      win[prop] = { value, key };
    }
  };
  for (const r of rules) {
    if (!selectorMatches(r.parsed, chain, idx)) continue;
    for (const d of r.decls) {
      let prop = d.prop;
      if (prop === 'background' || prop === 'background-color') prop = 'bg';
      if (prop === 'animation' || prop === 'animation-name') prop = 'animation';
      consider(prop, d.value, d.important, r.parsed.spec, r.order);
    }
  }
  const inline = chain[idx].style || {};
  for (const [p, v] of Object.entries(inline)) {
    const prop = (p === 'background' || p === 'background-color') ? 'bg' : p;
    consider(prop, v, false, 9e9, 9e9); // inline beats any non-!important rule
  }
  return Object.fromEntries(Object.entries(win).map(([k, v]) => [k, v.value]));
}

// ─── Role evaluation ─────────────────────────────────────────────────────────
function pxSize(value, parentPx) {
  const m = String(value).match(/^([\d.]+)(rem|px|em|%)$/);
  if (!m) return parentPx;
  const n = parseFloat(m[1]);
  return m[2] === 'rem' ? n * 16 : m[2] === 'px' ? n : m[2] === 'em' ? n * parentPx : (n / 100) * parentPx;
}
/** Evaluate one role (a chain of nodes, outermost first; the LAST node holds
 *  the text) in one theme. Returns the worst-case ratio and its colours. */
export function evaluateRole(role, tokens, rules, kf) {
  const chain = role.chain;
  // variants: each is { surface, groups:[{alpha, behind}] }
  let variants = [{ surface: null, groups: [] }];
  let color = null; let fontPx = 16; let weight = 400; let unresolved = null;
  for (let i = 0; i < chain.length; i++) {
    const decl = cascade(rules, chain, i);
    if (i === 0 && !decl.bg) decl.bg = 'var(--bg)';
    if (decl['font-size']) fontPx = pxSize(decl['font-size'], fontPx);
    if (decl['font-weight']) weight = /bold/.test(decl['font-weight']) ? 700 : parseInt(decl['font-weight'], 10) || weight;
    if (decl.color) color = decl.color;
    const op = decl.opacity !== undefined ? parseFloat(decl.opacity) : 1;
    if (op < 1) variants = variants.map((v) => ({ surface: v.surface, groups: [...v.groups, { alpha: op, behind: v.surface }] }));
    const bgList = [];
    if (decl.bg) {
      const c = backgroundCandidates(decl.bg, tokens);
      if (!c) { unresolved = `background "${decl.bg}" on ${nodeLabel(chain[i])}`; break; }
      bgList.push(...c);
    }
    if (decl.animation && decl.animation !== 'none') {
      const name = decl.animation.split(/\s+/).find((t) => kf[t]);
      if (name) for (const d of kf[name]) if (d.prop === 'background' || d.prop === 'background-color') {
        const c = backgroundCandidates(d.value, tokens); if (c) bgList.push(...c);
      }
    }
    if (bgList.length) {
      variants = variants.flatMap((v) => bgList.map((c) => ({ surface: v.surface == null ? over(c, '#FFFFFF') : over(c, v.surface), groups: v.groups })));
    }
  }
  if (unresolved) return { unresolved };
  const colorSub = color ? subVars(color, tokens) : tokens['--text-primary'];
  const fg = parseColor(colorSub || '');
  if (!fg) return { unresolved: `color "${color}"` };
  let worst = null;
  for (const v of variants) {
    let text = over(fg, v.surface), bg = v.surface;
    for (let g = v.groups.length - 1; g >= 0; g--) {
      const { alpha, behind } = v.groups[g];
      text = mix(text, behind, alpha); bg = mix(bg, behind, alpha);
    }
    const ratio = contrastRatio(text, bg);
    if (!worst || ratio < worst.ratio) worst = { ratio, text, bg };
  }
  const large = fontPx >= 24 || (fontPx >= 18.66 && weight >= 700);
  return { ...worst, fontPx, weight, floor: large ? 3.0 : 4.5 };
}
/** Every opaque surface a chain can paint under its LAST element: the same
 *  page -> element compositing evaluateRole() does, but returning each
 *  candidate (each gradient stop, each @keyframes extreme) instead of only the
 *  worst one for a text colour. Used by logovarianttest.mjs [4b], which needs
 *  to know whether a logo's surface can sit on BOTH sides of its threshold. */
export function surfaceCandidates(chain, tokens, rules, kf) {
  let surfaces = [null];
  for (let i = 0; i < chain.length; i++) {
    const decl = cascade(rules, chain, i);
    if (i === 0 && !decl.bg) decl.bg = 'var(--bg)';
    const bgList = [];
    if (decl.bg) {
      const c = backgroundCandidates(decl.bg, tokens);
      if (!c) return { unresolved: `background "${decl.bg}" on ${nodeLabel(chain[i])}` };
      bgList.push(...c);
    }
    if (decl.animation && decl.animation !== 'none') {
      const name = decl.animation.split(/\s+/).find((t) => kf[t]);
      if (name) for (const d of kf[name]) if (d.prop === 'background' || d.prop === 'background-color') {
        const c = backgroundCandidates(d.value, tokens); if (c) bgList.push(...c);
      }
    }
    if (bgList.length) surfaces = surfaces.flatMap((s) => bgList.map((c) => (s == null ? over(c, '#FFFFFF') : over(c, s))));
  }
  return { surfaces: [...new Set(surfaces)] };
}
function nodeLabel(n) {
  return (n.tag || 'div') + (n.cls || []).map((c) => '.' + c).join('') + (n.even ? ':nth-child(even)' : '');
}

// ─── The dashboard's element stacks ──────────────────────────────────────────
// Outermost first. Mirrors the markup renderDashboardCompact() /
// renderDashboardTable() / matrixGameHeaderHTML() / renderGameBadges() emit
// (js/app.js) inside renderDashboardInner()'s 'dash-picks' card.
const BODY = { tag: 'body' };
const CARD = [BODY, { cls: ['main-content'] }, { cls: ['page', 'active'], attrs: { id: 'page-dashboard' } }, { cls: ['card', 'mb-md'] }];
const DC_GAME = [...CARD, { cls: ['dashboard-compact'] }, { cls: ['dc-game'] }];
const DC_META = [...DC_GAME, { cls: ['dc-game-head'] }, { cls: ['dc-meta'] }];
const chip = (state, extra = {}) => [...DC_GAME, { cls: ['dc-chips'] }, { cls: ['dc-chip', state].filter(Boolean), attrs: { 'data-player-id': 'p', draggable: 'true' }, ...extra }];

function tableRow(even) {
  return [...CARD, { cls: ['dashboard-scroll'] }, { tag: 'table', cls: ['dashboard-table'] }, { tag: 'tbody' }, { tag: 'tr', even }];
}
const GAME_TD = (even) => [...tableRow(even), { tag: 'td', cls: ['game-info-cell'] }];
const META_TD = (even) => [...GAME_TD(even), { cls: ['game-info-meta'] }];
const PICK_TD = (even, ...cls) => [...tableRow(even), { tag: 'td', cls: ['pick-cell', ...cls] }];
const HEAD = [...CARD, { cls: ['dashboard-scroll'] }, { tag: 'table', cls: ['dashboard-table'] }, { tag: 'thead' }, { tag: 'tr' }];

export function dashboardRoles(atsInlineStyle) {
  const R = [];
  const add = (surface, id, chain) => R.push({ surface, id, chain });
  // ── compact dashboard (the only layout on the iOS app; default on phones)
  add('compact', 'matchup (team names)', [...DC_GAME, { cls: ['dc-game-head'] }, { cls: ['dc-matchup'] }]);
  add('compact', 'meta row text (" · " separators)', DC_META);
  add('compact', 'spread badge', [...DC_META, { tag: 'span', cls: ['spread-badge-sm'] }]);
  add('compact', 'kickoff time', [...DC_META, { tag: 'span', cls: ['dc-status', 'dc-scheduled'] }]);
  add('compact', 'FINAL score chip', [...DC_META, { tag: 'span', cls: ['dc-status', 'dc-final'] }]);
  add('compact', 'LIVE score chip', [...DC_META, { tag: 'span', cls: ['dc-status', 'dc-live'] }]);
  add('compact', 'live quarter/clock chip', [...DC_META, { tag: 'span', cls: ['dc-status', 'dc-live-detail'] }]);
  add('compact', 'red-zone chip', [...DC_META, { tag: 'span', cls: ['dc-status', 'dc-redzone'] }]);
  add('compact', 'ESPN link', [...DC_META, { tag: 'a', cls: ['espn-link'] }]);
  add('compact', 'reaction count', [...DC_META, { tag: 'span', cls: ['reaction-strip'] }, { tag: 'button', cls: ['reaction-chip'] }, { tag: 'span', cls: ['reaction-chip-count'] }]);
  add('compact', 'reaction count (mine)', [...DC_META, { tag: 'span', cls: ['reaction-strip'] }, { tag: 'button', cls: ['reaction-chip', 'reaction-chip-mine'] }, { tag: 'span', cls: ['reaction-chip-count'] }]);
  add('compact', 'multiplier badge (2x)', [...DC_GAME, { cls: ['dc-game-head'] }, { cls: ['dc-matchup'] }, { tag: 'span', cls: ['mult-badge'] }]);
  add('compact', 'league chip (NFL)', [...DC_GAME, { cls: ['dc-game-head'] }, { cls: ['dc-matchup'] }, { tag: 'span', cls: ['league-chip'] }]);
  const CHIP_STATES = [
    ['pending', 'dc-chip-pending'], ['win', 'dc-chip-win'], ['loss', 'dc-chip-loss'], ['no decision', 'dc-chip-nd'],
    ['live covering', 'dc-chip-live-covering'], ['live trailing', 'dc-chip-live-trailing'], ['live (even)', 'dc-chip-live'],
    ['blind (•••)', 'dc-chip-blind'], ['no pick (—)', 'dc-chip-none'],
  ];
  for (const [label, cls] of CHIP_STATES) {
    add('compact', `pick chip — ${label} — team`, [...chip(cls), { tag: 'span', cls: ['dc-chip-pick'] }]);
    add('compact', `pick chip — ${label} — initials`, [...chip(cls), { tag: 'span', cls: ['dc-chip-init'] }]);
  }
  // ── standard matrix (desktop web default)
  add('matrix', 'column header "Game / Spread"', [...HEAD, { tag: 'th' }]);
  add('matrix', 'player column name', [...HEAD, { tag: 'th', cls: ['player-col'], attrs: { 'data-player-id': 'p', draggable: 'true' } }, { tag: 'span', cls: ['player-col-name'] }]);
  add('matrix', 'player W–L record', [...HEAD, { tag: 'th', cls: ['player-col'], attrs: { 'data-player-id': 'p', draggable: 'true' } }, { tag: 'span', cls: ['pts-label'] }]);
  for (const even of [false, true]) {
    const z = even ? ' (even row)' : '';
    add('matrix', `matchup (team names)${z}`, [...GAME_TD(even), { cls: ['game-info-matchup'] }]);
    add('matrix', `matchup abbreviations, logo view${z}`, [...GAME_TD(even), { cls: ['game-info-matchup'] }, { tag: 'span', cls: ['matrix-hdr-block'] }, { tag: 'span', cls: ['matrix-hdr-abbr'] }]);
    add('matrix', `spread badge${z}`, [...META_TD(even), { tag: 'span', cls: ['spread-badge-sm'] }]);
    add('matrix', `kickoff time${z}`, [...META_TD(even), { tag: 'span', cls: ['kickoff-time'] }]);
    add('matrix', `FINAL pill${z}`, [...META_TD(even), { tag: 'span', cls: ['status-pill', 'status-pill-final'] }]);
    add('matrix', `LIVE pill${z}`, [...META_TD(even), { tag: 'span', cls: ['live-pill'], style: { 'font-size': '.66rem' } }]);
    add('matrix', `red-zone mark${z}`, [...META_TD(even), { tag: 'span', cls: ['rz-mark'] }]);
    add('matrix', `"ATS: <team>" label (inline style)${z}`, [...META_TD(even), { tag: 'span', style: atsInlineStyle }]);
    add('matrix', `ESPN link${z}`, [...META_TD(even), { tag: 'a', cls: ['espn-link'] }]);
    add('matrix', `pick cell — pending${z}`, PICK_TD(even, 'result-pending'));
    add('matrix', `pick cell — win${z}`, PICK_TD(even, 'result-win'));
    add('matrix', `pick cell — win ✓${z}`, [...PICK_TD(even, 'result-win'), { tag: 'span', cls: ['pick-icon'] }]);
    add('matrix', `pick cell — loss${z}`, PICK_TD(even, 'result-loss'));
    add('matrix', `pick cell — no decision${z}`, PICK_TD(even, 'result-nd'));
    add('matrix', `pick cell — live covering${z}`, PICK_TD(even, 'pick-live', 'pick-live-covering'));
    add('matrix', `pick cell — live covering ▲${z}`, [...PICK_TD(even, 'pick-live', 'pick-live-covering'), { tag: 'span', cls: ['live-arrow'] }]);
    add('matrix', `pick cell — live trailing${z}`, PICK_TD(even, 'pick-live', 'pick-live-trailing'));
    add('matrix', `pick cell — live trailing ▽${z}`, [...PICK_TD(even, 'pick-live', 'pick-live-trailing'), { tag: 'span', cls: ['live-arrow'] }]);
    add('matrix', `pick cell — live even${z}`, PICK_TD(even, 'pick-live', 'pick-live-even'));
    add('matrix', `pick cell — blind (•••)${z}`, PICK_TD(even, 'pick-cell-blind'));
  }
  // ── chat game-thread header (UN-94: "mirrors the dashboard's covering /
  // not-covering colors") — the main chat page's game-filter header, whose
  // matchup <strong> and "LIVE 14–10" INHERIT the state colour (js/chat-ui.js
  // renderChatPage). Its translucent tint replaces --bg-card, so it composites
  // over the page ground. The bottom-sheet header's title/sub set their own
  // colours and inherit nothing from the state class.
  const CHAT_PAGE = [BODY, { cls: ['main-content'] }, { tag: 'section', cls: ['page-section', 'active'], attrs: { id: 'page-chat' } }];
  for (const [label, cls] of [['covering', 'chat-thread-covering'], ['trailing', 'chat-thread-trailing'], ['even', 'chat-thread-even'], ['won', 'chat-thread-won'], ['lost', 'chat-thread-lost']]) {
    add('chat-hdr', `game thread header — ${label} — matchup`, [...CHAT_PAGE, { cls: ['chat-view-header', cls] }, { tag: 'div' }, { tag: 'strong' }]);
    add('chat-hdr', `game thread header — ${label} — LIVE score`, [...CHAT_PAGE, { cls: ['chat-view-header', cls] }, { tag: 'div' }]);
  }
  return R;
}

// ─── Logo elements (SB-07) ───────────────────────────────────────────────────
// The four <img> render paths bindLogoImageEvents() (js/app.js) handles, each
// inside the container it actually sits in.
export const LOGO_STACKS = {
  'Picks page pick button logo': [...CARD, { tag: 'button', cls: ['pick-btn', 'selected'] }, { tag: 'span', cls: ['pick-btn-logo-wrap'] }, { tag: 'span', cls: ['pick-btn-logo-box'] }, { tag: 'img', cls: ['pick-btn-logo', 'is-loaded'] }],
  'compact dashboard chip logo': [...chip('dc-chip-win'), { tag: 'span', cls: ['dc-chip-pick'] }, { tag: 'span', cls: ['dc-chip-pick-logo'] }, { tag: 'img', cls: ['dc-chip-logo', 'is-loaded'] }],
  'matrix row-header logo': [...GAME_TD(false), { cls: ['game-info-matchup'] }, { tag: 'span', cls: ['matrix-hdr-block'] }, { tag: 'span', cls: ['matrix-hdr-logos'] }, { tag: 'span', cls: ['matrix-hdr-logo-box'] }, { tag: 'img', cls: ['matrix-hdr-logo', 'is-loaded'] }],
  'commissioner slate-row logo': [...CARD, { cls: ['game-admin-card'] }, { cls: ['game-admin-matchup'] }, { tag: 'img', cls: ['slate-row-logo'] }],
};

// ─── Pre-existing debt (see [1] below for how it is enforced) ────────────────
// AA failures that ALREADY exist in the light themes, at least as badly as in
// night mode. Not caused by night mode, not SB-06, and deliberately NOT fixed
// here (each would change light-mode visuals every player already sees;
// reported to Drew as a separate item). Every entry is a RATCHET, not a waiver:
//   - scope 'light' = may fail ONLY in a light theme; must pass in dark.
//     scope 'all'   = may fail anywhere, but night mode may never be WORSE
//                     than Munera light for the same role (1-dark-*).
//   - floor = the worst ratio measured on 2026-09-30 across all themes; it may
//     never drop below that (1-ratchet-*).
//   - an entry that no longer fails anywhere must be DELETED (1-shrink-*), so
//     the list only ever gets shorter.
// Keyed by role id with the " (even row)" suffix stripped.
// RE-DERIVED (SP-52 DI-448/DI-456, 2026-10-01): six entries were DELETED, exactly as this list's own 1-shrink rule demands — "compact · meta row text", "compact ·
// kickoff time", "compact · ESPN link", "matrix · kickoff time", "matrix · ESPN link" and "matrix · pick cell — pending" were all --text-muted (#9A8A7A, 2.9 to 3.3:1)
// on white/Marble; SP-52 raises Light --text-muted to #6B5F53 (4.89 to 6.20:1), so they pass on every look. The list got SHORTER, which is the point of it.
export const KNOWN_DEBT = {
  'compact · pick chip — win — initials': { scope: 'all', floor: 3.34, why: 'white initials on a 25%-white disk over the constant --win-fill' },
  'compact · pick chip — loss — initials': { scope: 'all', floor: 4.23, why: 'white initials on a 25%-white disk over the constant --loss-fill' },
  'compact · pick chip — live covering — team': { scope: 'light', floor: 4.19, why: 'light #1A7A3F (= --win) on its own tint at the breathing peak (.18)' },
  'matrix · pick cell — live covering': { scope: 'light', floor: 4.19, why: 'same, matrix cell' },
  'matrix · pick cell — live covering ▲': { scope: 'light', floor: 4.19, why: 'same, the ▲ arrow' },
  'compact · pick chip — blind (•••) — team': { scope: 'all', floor: 2.38, why: 'deliberately dimmed (opacity .85, --text-muted)' },
  'compact · pick chip — blind (•••) — initials': { scope: 'all', floor: 2.68, why: 'white on --text-muted disk, opacity .85' },
  'compact · pick chip — no pick (—) — team': { scope: 'all', floor: 2.22, why: 'deliberately dimmed (opacity .5)' },
  'compact · pick chip — no pick (—) — initials': { scope: 'all', floor: 2.58, why: 'opacity .5 over the whole chip (worst: razorback)' },
  'matrix · pick cell — blind (•••)': { scope: 'all', floor: 2.38, why: 'deliberately dimmed (opacity .85, --text-muted)' },
  // A1.9 F2 (coordinator, 2026-10-01): every look that existed BEFORE SP-52 keeps its existing 3.74 floor (a floor is a ratchet, never loosened inside a builder commit; the earlier
  // 3.35 here would have let Munera Light slide 0.39:1 without a red). Paper Light — a NEW look — gets its OWN named entries at 3.35, because the parchment page (#DDD7CA vs Marble
  // #E8E4DC) cannot reach 4.5 with one token. `except` / `themes` select by the table's map name ('paper' IS Paper Light; Paper Dark's maps are 'paper · dark (...)').
  'chat-hdr · game thread header — covering — matchup': { scope: 'light', floor: 3.74, except: ['paper'], why: 'light #1A7A3F (= --win) on its own tint over the Marble page' },
  'chat-hdr · game thread header — covering — LIVE score': { scope: 'light', floor: 3.74, except: ['paper'], why: 'same' },
  'chat-hdr · game thread header — covering — matchup @ Paper Light': { base: 'chat-hdr · game thread header — covering — matchup', themes: ['paper'], scope: 'light', floor: 3.35,
    why: 'the same role on Paper Light\'s deeper parchment page: 3.35:1 (a debt row on a NEW look at its own measured floor, never a waiver)' },
  'chat-hdr · game thread header — covering — LIVE score @ Paper Light': { base: 'chat-hdr · game thread header — covering — LIVE score', themes: ['paper'], scope: 'light', floor: 3.35, why: 'same' },
};
// The five SB-06 roles — NEVER admissible as debt in night mode.
export const SB06_ROLES = ['pick chip — live trailing — team', 'pick cell — live trailing', 'pick chip — live covering — team', 'pick cell — live covering', '"ATS: <team>" label (inline style)',
  'game thread header — covering — matchup', 'game thread header — covering — LIVE score', 'game thread header — trailing — matchup', 'game thread header — trailing — LIVE score'];

const baseId = (r) => `${r.surface} · ${r.role.replace(/ \(even row\)$/, '')}`;
/** The KNOWN_DEBT entry that covers this row, or undefined: matches the role AND the look (an entry may name `themes` it is limited to, or `except` ones it must not cover). */
const debtFor = (r) => Object.entries(KNOWN_DEBT).find(([k, d]) => (d.base || k) === baseId(r) && (!d.themes || d.themes.includes(r.theme)) && !(d.except || []).includes(r.theme))?.[1];
const isDark = (t) => /dark/.test(t);
// SP-52: Munera PAPER Dark paints LIGHT paper cards on an ink page (the paper scope, themetest [T10]); the dashboard sits inside a paper root, so for debt purposes
// it behaves like a LIGHT look (the Light debt rows above apply; "night mode must not be worse than Munera light" does not).
const darkSurface = (t) => isDark(t) && !/^paper/.test(t);
// RETIRED (A1.9, coordinator 2026-10-01): this suite carried a ratcheted SP52_ADVISORIES list with three entries — the matrix "ATS:" label on a zebra row (Dark accent text on the lifted inset,
// 4.18-4.21:1), Notre Dame Dark's W-L record (.pts-label, 4.26:1) and Paper Dark's zebra --nd-text/--loss (4.1 / 4.39:1). A1.9 CLOSED all three at the VALUE level (the Dark accent-text values lifted
// to clear 4.5:1 on #332C25; Notre Dame Dark --on-accent-gold; Paper Dark's scope --nd-text, --loss and --live-text), so the list is empty and the machinery is deleted — not left behind as an
// escape hatch. GUARD RULE (A1.9): a guard a bug fix in this release marks "never admissible" (the SB-06 roles in night mode) changes only by a dated coordinator ruling, never inside a builder commit.

/** Every check this suite makes, as data — so the main block can assert on
 *  the live files and [4] can re-run the SAME analysis on mutated copies. */
export function analyze(cssSrc, appSrc) {
  const clean = stripComments(cssSrc);
  const { themes, themeKeys, mediaDarkCount, manualDarkCount } = buildThemes(cssSrc);
  const tl = topLevelBlocks(clean);
  const rules = collectRules(tl);
  const kf = keyframes(tl);

  // The matrix's "ATS:" span is styled INLINE in renderDashboardTable().
  const tableFn = appSrc.slice(appSrc.indexOf('export function renderDashboardTable('), appSrc.indexOf('// ─── EMOJI REACTIONS'));
  const compactFn = appSrc.slice(appSrc.indexOf('export function renderDashboardCompact('), appSrc.indexOf('// ─── LEADERBOARD / STANDINGS'));
  const hdrFn = appSrc.slice(appSrc.indexOf('function matrixGameHeaderHTML('), appSrc.indexOf('function renderGameBadges('));
  const atsMatch = tableFn.match(/<span style="([^"]*)">ATS:/);
  const atsStyle = Object.fromEntries((atsMatch ? atsMatch[1] : '').split(';').filter(Boolean).map((d) => d.split(':').map((s) => s.trim())));

  // [1] text roles
  const table = [];
  for (const [themeName, tokens] of Object.entries(themes)) {
    for (const role of dashboardRoles(atsStyle)) {
      table.push({ theme: themeName, surface: role.surface, role: role.id, ...evaluateRole(role, tokens, rules, kf) });
    }
  }
  const unexplainedByTheme = {};
  for (const themeName of Object.keys(themes)) {
    unexplainedByTheme[themeName] = table.filter((r) => r.theme === themeName && !r.unresolved && r.ratio < r.floor).filter((b) => {
      const d = debtFor(b);
      return !d || (d.scope === 'light' && darkSurface(themeName));
    });
  }
  const sb06Dark = {};
  // (Paper Dark is a LIGHT-surface look — its dashboard sits on paper — so the "SB-06 in night mode" roles are asserted on the DARK-surface looks only.)
  for (const darkName of Object.keys(themes).filter(darkSurface)) {
    sb06Dark[darkName] = SB06_ROLES.map((id) => {
      const rows = table.filter((r) => r.theme === darkName && !r.unresolved && r.role.replace(/ \(even row\)$/, '') === id);
      const worst = rows.reduce((a, r) => (!a || r.ratio < a.ratio ? r : a), null);
      return { id, rows, worst, ok: rows.length > 0 && rows.every((r) => r.ratio >= r.floor) };
    });
  }

  // [2] logos — deny-by-default over the whole file (incl. @media/@supports).
  const logoClassNames = [...new Set([...clean.matchAll(/\.([a-zA-Z0-9_-]*logo[a-zA-Z0-9_-]*)/g)].map((m) => m[1]))];
  const bindFn = appSrc.slice(appSrc.indexOf('function bindLogoImageEvents('), appSrc.indexOf('export const _bindLogoImageEventsForTest'));
  const imgClasses = [...new Set([...bindFn.matchAll(/contains\('([a-z-]+logo)'\)/g)].map((m) => m[1]))];
  const PAINT = /^(background|background-color|background-image|box-shadow|filter|outline)$/;
  const logoOffenders = [];
  (function scan(bl) {
    for (const b of bl) {
      if (b.atRule) { if (!/^@keyframes/.test(b.prelude)) scan(topLevelBlocks(b.body)); continue; }
      if (!/logo/.test(b.prelude)) continue;
      for (const sel of b.prelude.split(',')) {
        if (!/\.[a-zA-Z0-9_-]*logo/.test(sel)) continue;
        if (/::?(before|after)\b/.test(sel) || /:(hover|active|focus)/.test(sel)) continue;
        // Only rules whose SUBJECT (last compound) is a logo element/box — an
        // ancestor-scoped rule like `.x.logo-broken .name` styles something else.
        const last = sel.trim().split(/\s+|>/).filter(Boolean).pop();
        if (!/logo/.test(last)) continue;
        for (const d of parseDecls(b.body)) {
          if (!PAINT.test(d.prop)) continue;
          if (/^(transparent|none)$/i.test(d.value)) continue;
          logoOffenders.push(`${sel.trim()} { ${d.prop}: ${d.value} }`);
        }
      }
    }
  })(tl);
  const logoResolvedBad = {};
  for (const [themeName, tokens] of Object.entries(themes)) {
    const bad = [];
    for (const [label, st] of Object.entries(LOGO_STACKS)) {
      for (let i = st.length - 1; i >= 0; i--) {
        if (!(st[i].cls || []).some((c) => /logo/.test(c))) break;
        const d = cascade(rules, st, i);
        if (!d.bg) continue;
        const c = backgroundCandidates(d.bg, tokens);
        if (!c || c.some((x) => x.a > 0)) bad.push(`${label}: ${nodeLabel(st[i])} background ${d.bg}`);
      }
    }
    logoResolvedBad[themeName] = bad;
  }

  // [3] inline colours in the dashboard renderers
  const inlineColours = [tableFn, compactFn, hdrFn].flatMap((src) => [...src.matchAll(/style="[^"]*(?<![a-z-])color:([^;"]+)/g)].map((m) => m[1].trim()));
  // [3b] the SB-06 defect CLASS, deny-by-default: the two light-mode live
  // text hexes may never again be a rule's own `color:` (they live on only as
  // token VALUES — --win's light value and --live-trail-text's light value).
  const hardcodedLive = [...clean.matchAll(/([^{}]+)\{[^{}]*?(?<![a-z-])color\s*:\s*(#1a7a3f|#9a3030)\b/gi)].map((m) => `${m[1].trim()} { color: ${m[2]} }`);

  return {
    themes, themeKeys, mediaDarkCount, manualDarkCount, rules, kf,
    located: !!atsMatch && tableFn.length > 2000 && compactFn.length > 2000 && hdrFn.length > 200,
    table, unexplainedByTheme, sb06Dark,
    logoClassNames, imgClasses, logoOffenders, logoResolvedBad, inlineColours, hardcodedLive,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let pass = 0, fail = 0;
  const assert = (cond, label) => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } };
  const showTable = process.argv.includes('--table');
  const cssArg = process.argv.indexOf('--css');
  const cssPath = cssArg > -1 ? path.resolve(process.argv[cssArg + 1]) : path.join(root, 'css', 'styles.css');
  const appArg = process.argv.indexOf('--app');
  const appPath = appArg > -1 ? path.resolve(process.argv[appArg + 1]) : path.join(root, 'js', 'app.js');
  const cssSrc = await readFile(cssPath, 'utf8');
  const appSrc = await readFile(appPath, 'utf8');
  const dmSrc = await readFile(path.join(root, 'js', 'data-model.js'), 'utf8');

  console.log(`\n[dashcontrasttest] ${path.relative(root, cssPath)} + ${path.relative(root, appPath)}`);
  const A = analyze(cssSrc, appSrc);

  // ── [0] Fixtures — the parser actually found what it needs ────────────────
  console.log('\n[0] fixtures');
  const shippedKeys = [...dmSrc.matchAll(/\{\s*key:\s*'([a-z]+)'/g)].map((m) => m[1]);
  assert(shippedKeys.length >= 7 && shippedKeys.every((k) => A.themeKeys.includes(k)),
    `0-1: every shipped theme in data-model.js THEMES (${shippedKeys.join(', ')}) has a body.theme-* block this suite tests (found ${A.themeKeys.join(', ')})`);
  assert(A.mediaDarkCount >= 20 && A.manualDarkCount >= 20,
    `0-2: both Munera night-mode token blocks parsed (OS-setting block ${A.mediaDarkCount} tokens, manual-toggle block ${A.manualDarkCount})`);
  assert(A.themes['neutral · dark (OS setting)']['--bg-card'] !== A.themes.neutral['--bg-card'],
    `0-3: the dark map really is dark (--bg-card ${A.themes['neutral · dark (OS setting)']['--bg-card']} vs light ${A.themes.neutral['--bg-card']})`);
  assert(A.rules.length > 500 && Object.keys(A.kf).includes('live-cell-breathe-cov'),
    `0-4: ${A.rules.length} selector rules and ${Object.keys(A.kf).length} @keyframes parsed (incl. live-cell-breathe-cov)`);
  assert(A.located, '0-5: renderDashboardTable / renderDashboardCompact / matrixGameHeaderHTML bodies located, and the inline-styled "ATS:" span found');

  // ── [1] Every dashboard text role clears AA in every shipped theme ────────
  console.log('\n[1] dashboard text roles — WCAG AA in every theme');
  const unresolved = A.table.filter((r) => r.unresolved);
  assert(unresolved.length === 0, `1-0: every role resolved to a concrete colour pair in every theme (${unresolved.length} unresolved${unresolved.length ? ': ' + unresolved.slice(0, 3).map((u) => `${u.theme}/${u.role}: ${u.unresolved}`).join('; ') : ''})`);
  for (const themeName of Object.keys(A.themes)) {
    const rows = A.table.filter((r) => r.theme === themeName && !r.unresolved);
    const bad = rows.filter((r) => r.ratio < r.floor);
    const unexplained = A.unexplainedByTheme[themeName];
    assert(unexplained.length === 0,
      `1-${themeName}: all ${rows.length} dashboard text roles >= AA, apart from ${bad.length - unexplained.length} named pre-existing-debt rows` +
      (unexplained.length ? ` — ${unexplained.length} FAIL:\n        ` + unexplained.map((b) => `${b.surface} · ${b.role}: ${b.ratio.toFixed(2)}:1 (${b.text} on ${b.bg}, floor ${b.floor})`).join('\n        ') : ''));
  }
  // Night mode never makes a failing role worse than Munera light.
  for (const darkName of Object.keys(A.themes).filter(darkSurface)) {
    const worse = A.table.filter((r) => r.theme === darkName && !r.unresolved && r.ratio < r.floor).filter((r) => {
      const light = A.table.find((x) => x.theme === 'neutral' && x.role === r.role && x.surface === r.surface);
      return !light || r.ratio + 1e-9 < light.ratio;
    });
    assert(worse.length === 0, `1-dark-${darkName}: no dashboard role that fails in night mode is worse than it is in Munera light (${worse.map((w) => `${w.role} ${w.ratio.toFixed(2)}`).join('; ') || 'clean'})`);
  }
  for (const [id, d] of Object.entries(KNOWN_DEBT)) {
    const rows = A.table.filter((r) => !r.unresolved && debtFor(r) === d);
    const min = Math.min(...rows.map((r) => r.ratio));
    assert(rows.length > 0 && min + 0.005 >= d.floor, `1-ratchet: "${id}" never below its recorded ${d.floor}:1 floor (worst now ${min.toFixed(2)}:1 — ${d.why})`);
    assert(rows.some((r) => r.ratio < r.floor), `1-shrink: "${id}" still fails somewhere — if it now passes everywhere, delete it from KNOWN_DEBT`);
  }
  for (const [darkName, list] of Object.entries(A.sb06Dark)) {
    for (const s of list) {
      assert(s.ok, `1-SB06-${darkName}: ${s.id} >= AA in night mode (worst ${s.worst ? `${s.worst.ratio.toFixed(2)}:1, ${s.worst.text} on ${s.worst.bg}` : 'not found'})`);
    }
  }

  // ── [2] SB-07 — no gray backing / plate / halo behind any team logo ───────
  console.log('\n[2] team logos sit transparently on their real surface (SB-07)');
  assert(A.imgClasses.length === 4 && A.imgClasses.every((c) => A.logoClassNames.includes(c)),
    `2-0: fixture — the ${A.imgClasses.length} <img> classes bindLogoImageEvents() handles (${A.imgClasses.join(', ')}) are all styled in styles.css`);
  assert(A.imgClasses.every((c) => Object.values(LOGO_STACKS).some((st) => (st[st.length - 1].cls || []).includes(c))),
    '2-0b: fixture — every logo render path has an element stack in LOGO_STACKS (a new path must be added there)');
  assert(A.logoOffenders.length === 0,
    `2-1: no rule on a team-logo element/box paints a background, plate, halo or shadow (${A.logoOffenders.length} found${A.logoOffenders.length ? ':\n        ' + A.logoOffenders.join('\n        ') : ''})`);
  for (const [themeName, bad] of Object.entries(A.logoResolvedBad)) {
    assert(bad.length === 0, `2-${themeName}: every team logo sits on its real surface — no fill on the logo or its box (${bad.length ? bad.join('; ') : 'clean'})`);
  }

  // ── [3] Inline colour styles in the dashboard renderers are all covered ───
  console.log('\n[3] inline colour styles in the dashboard renderers');
  assert(A.inlineColours.length === 1,
    `3-1: exactly ONE inline colour in the dashboard renderers — the "ATS:" label, checked as a role in [1] (found ${A.inlineColours.length}: ${A.inlineColours.join(', ')}). A new one must get its own role here.`);
  assert(A.hardcodedLive.length === 0,
    `3-2: no rule in styles.css paints text with the hardcoded light-mode live hexes #1A7A3F / #9a3030 — they are token values only, remapped for night mode (${A.hardcodedLive.length ? A.hardcodedLive.join('; ') : 'clean'})`);

  // ── [4] Mutation proof — the guard sees the exact defects ─────────────────
  // In-memory string copies only (never a working-tree write, never git —
  // CLAUDE.md's mutation-testing rule cannot apply to a .replace() on a string
  // already in memory). Each mutation reverts ONE part of the SB-06/SB-07 fix
  // to its pre-fix text and must turn the matching check RED; the live files
  // above must stay GREEN on the identical analysis.
  console.log('\n[4] mutation proof — each fix reverted in memory must go RED');
  const darkOs = 'neutral · dark (OS setting)';
  const mutate = (src, from, to, label) => {
    const out = src.split(from).join(to);
    assert(out !== src, `4-pre: mutation target found — ${label}`);
    return out;
  };
  const sbFail = (a, id) => !a.sb06Dark[darkOs].find((s) => s.id === id).ok;
  {
    const m = analyze(mutate(cssSrc, 'color:var(--live-trail-text)', 'color:#9a3030', 'trailing text back to #9a3030'), appSrc);
    assert(sbFail(m, 'pick chip — live trailing — team') && sbFail(m, 'pick cell — live trailing'),
      '4-1: trailing chip + cell text reverted to #9a3030 → [1] goes RED in night mode');
  }
  {
    const m = analyze(mutate(cssSrc, 'color:var(--win);animation:live-cell-breathe-cov', 'color:#1A7A3F;animation:live-cell-breathe-cov', 'covering chip text back to #1A7A3F'), appSrc);
    assert(sbFail(m, 'pick chip — live covering — team') && !sbFail(m, 'pick cell — live covering'),
      '4-2: covering CHIP text reverted to #1A7A3F → [1] goes RED for the chip only (the matrix cell still fixed)');
  }
  {
    const m = analyze(mutate(cssSrc, '--live-trail-text:#D88383;', '--live-trail-text:#9a3030;', 'dark --live-trail-text back to the light value'), appSrc);
    assert(sbFail(m, 'pick chip — live trailing — team'),
      '4-3: the night-mode --live-trail-text remap removed → [1] goes RED (the token, not just the call site, is load-bearing)');
  }
  {
    const m = analyze(cssSrc, mutate(appSrc, 'style="font-size:.68rem;color:var(--maroon-text)">ATS:', 'style="font-size:.68rem;color:var(--maroon)">ATS:', 'ATS inline colour back to --maroon'));
    assert(sbFail(m, '"ATS: <team>" label (inline style)'), '4-4: ATS inline colour reverted to var(--maroon) → [1] goes RED in night mode');
  }
  {
    const m = analyze(mutate(cssSrc, '.pick-btn-logo-box{width:40px;height:40px;border-radius:8px;', '.pick-btn-logo-box{width:40px;height:40px;border-radius:8px;background:var(--bg-input);', 'pick-button logo box fill restored'), appSrc);
    assert(m.logoOffenders.length === 1 && Object.values(m.logoResolvedBad).every((b) => b.length === 1),
      `4-5: the gray --bg-input fill restored on .pick-btn-logo-box → [2] goes RED in all ${Object.keys(m.logoResolvedBad).length} theme maps`);
  }
  {
    const m = analyze(mutate(cssSrc, '.dc-chip-logo{width:14px;height:14px;', '.dc-chip-logo{box-shadow:0 0 0 2px #fff;width:14px;height:14px;', 'a halo added to the compact chip logo'), appSrc);
    assert(m.logoOffenders.length === 1, '4-6: a halo/plate (box-shadow) on a logo → [2-1] goes RED (Drew: no plate, no halo)');
  }
  {
    const m = analyze(cssSrc, mutate(appSrc, '<span class="dc-chip-pick-logo">', '<span class="dc-chip-pick-logo" style="color:#123">', 'a second inline colour in renderDashboardCompact'));
    assert(m.inlineColours.length === 2, '4-7: a new inline colour in a dashboard renderer → [3-1] goes RED (it must get a role)');
  }

  if (showTable) {
    console.log('\n── full table (worst case per role; ratios are text:background) ──');
    for (const r of A.table) {
      if (r.unresolved) { console.log(`  ${r.theme.padEnd(30)} ${r.surface.padEnd(8)} ${r.role.padEnd(52)} UNRESOLVED ${r.unresolved}`); continue; }
      console.log(`  ${r.theme.padEnd(30)} ${r.surface.padEnd(8)} ${r.role.padEnd(52)} ${r.ratio.toFixed(2).padStart(6)}:1 ${r.ratio >= r.floor ? 'ok  ' : 'FAIL'} ${r.text} on ${r.bg} (${r.fontPx.toFixed(1)}px/${r.weight})`);
    }
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  // Same double-armed exit as contrastscan.mjs / brandtokentest.mjs.
  process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 8000).unref();
}
