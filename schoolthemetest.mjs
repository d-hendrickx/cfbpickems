/**
 * CFB Pickems — schoolthemetest.mjs (SB-10 / RG-273 provisional, 2026-09-30)
 * ==========================================================================
 * BUG: a player on a school theme (aggie, sooner, trojan, irish, boilermaker,
 * razorback) sees Munera's crimson for every accent TEXT colour, instead of
 * the school's own colour.
 *
 * MECHANISM: `css/styles.css` declared, on `:root`,
 *     --maroon-text:var(--maroon);
 *     --maroon-mid-text:var(--maroon-mid);
 *     --maroon-light-text:var(--maroon-light);
 * A custom property's `var()` is substituted ON THE ELEMENT THAT DECLARES IT.
 * `:root` is `<html>`, where `--maroon` is Munera's `#8C1515`; `<html>`'s
 * computed `--maroon-text` is therefore the literal `#8C1515`, and `<body>`
 * INHERITS that computed literal. The school block `body.theme-<key>`
 * overrides `--maroon` on `<body>`, but nothing on `<body>` re-evaluates the
 * alias, so the override never reaches the ~90 `color:var(--maroon*-text)`
 * sites. Every flat "merge the maps, then resolve var()" model (the method
 * `contrastscan.mjs` and `brandtokentest.mjs` use) substitutes AFTER the
 * merge and so resolves the school's value — which is exactly why the bug
 * was invisible to the existing suites.
 *
 * THIS FILE models the real cascade for the two elements that matter:
 * `<html>` (no class, no attribute) and `<body class="theme-<key>">` with an
 * optional `data-color-scheme`, under an OS light or OS dark preference.
 * Selector matching, specificity, source order, `@media
 * (prefers-color-scheme)` and inheritance are honoured, and `var()` is
 * substituted on the declaring element. Anything it cannot evaluate that
 * could touch a custom property on `<html>`/`<body>` is a LOUD fixture
 * failure, never a silent skip. Section [R] proves the resolver on synthetic
 * stylesheets first, including the SB-10 shape, so a green run cannot be a
 * blind resolver.
 *
 * SCOPE: the LIGHT side of each school only (OS light; pinned Light; pinned
 * Light on a Dark phone). SP-52 DI-451 adds the school DARK sides later; it
 * leaves every assertion here unchanged (its Dark blocks are
 * `:not([data-color-scheme="light"])` / `[data-color-scheme="dark"]`, so the
 * three Light contexts below stay Light). DI-456's `themeresolve.mjs` /
 * `themetest.mjs` supersede this resolver across all 20 sides; until then
 * this is the SB-10 guard.
 *
 * Values are SP-52 DI-451 Table 4L ("SB-10" rows) in
 * `weekly bug fixes and feedback/Social Platform 092626/DESIGN_INPUTS_THEMES_093026.md`.
 *
 * Run:  node schoolthemetest.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { THEMES } from './js/data-model.js';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ─────────────────────────────────────────────────────────────────────────────
// WCAG 2.x contrast (same formula as brandtokentest.mjs / contrastscan.mjs).
// ─────────────────────────────────────────────────────────────────────────────
function lin(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
function lum(hex) {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(f, 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a, b) {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const isHex = (v) => typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());
const norm = (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v);

// ─────────────────────────────────────────────────────────────────────────────
// The resolver.
// ─────────────────────────────────────────────────────────────────────────────
class Unsupported extends Error {}

/** Remove comments, respecting quoted strings. */
function stripComments(src) {
  let out = '', i = 0, q = null;
  while (i < src.length) {
    const c = src[i];
    if (q) { out += c; if (c === '\\') { out += src[i + 1] || ''; i += 2; continue; } if (c === q) q = null; i++; continue; }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
    out += c; i++;
  }
  return out;
}

/** Index of the brace matching the `{` at `open`, respecting strings. */
function matchBrace(src, open) {
  let depth = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === '\\') { i++; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  throw new Unsupported('unbalanced braces');
}

/** Split on a delimiter at paren/bracket depth 0, outside strings. */
function splitTop(s, delim) {
  const parts = []; let depth = 0, q = null, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { cur += c; if (c === '\\') { cur += s[++i] || ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === delim && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts;
}

/** Custom-property declarations of one rule body, in source order. */
function customDecls(body) {
  const out = [];
  for (const raw of splitTop(body, ';')) {
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const name = raw.slice(0, colon).trim();
    if (!name.startsWith('--')) continue;
    let value = raw.slice(colon + 1).trim();
    let important = false;
    if (/!\s*important\s*$/i.test(value)) { important = true; value = value.replace(/!\s*important\s*$/i, '').trim(); }
    out.push({ name, value, important });
  }
  return out;
}

/** Flatten a stylesheet into style rules with their at-rule conditions. */
function parseRules(cssSrc) {
  const src = stripComments(cssSrc);
  const rules = []; let order = 0;
  (function walk(text, conds) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      // A statement at-rule (`@import url(…);`, `@charset …;`) ends at a
      // top-level `;` and is not part of the next rule's prelude.
      const prelude = splitTop(text.slice(i, open), ';').pop().trim();
      const close = matchBrace(text, open);
      const inner = text.slice(open + 1, close);
      if (prelude.startsWith('@')) {
        if (/^@(media|supports)\b/i.test(prelude)) walk(inner, [...conds, prelude]);
        // @keyframes / @font-face / others hold no style rules for elements.
      } else if (prelude) {
        rules.push({ prelude, selectors: splitTop(prelude, ',').map((s) => s.trim()).filter(Boolean), conds, decls: customDecls(inner), order: order++ });
      }
      i = close + 1;
    }
  })(src, []);
  return rules;
}

/** Evaluate an at-rule prelude: true / false / null (cannot evaluate).
 *  Supported: a single `(prefers-color-scheme: dark|light)`, `(min-width: Npx)`
 *  or `(max-width: Npx)` feature; the viewport is `env.width` CSS px (default
 *  390, an iPhone; the width queries in styles.css only set `--page-pad`). */
function evalCond(prelude, env) {
  let m = /^@media\s*\(\s*prefers-color-scheme\s*:\s*(dark|light)\s*\)\s*$/i.exec(prelude);
  if (m) return m[1].toLowerCase() === 'dark' ? env.osDark : !env.osDark;
  m = /^@media\s*\(\s*(min|max)-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)\s*$/i.exec(prelude);
  if (m) { const w = env.width ?? 390, n = Number(m[2]); return m[1].toLowerCase() === 'min' ? w >= n : w <= n; }
  return null;
}

/** Parse a compound selector into simple parts. */
function parseCompound(s) {
  const parts = []; let i = 0;
  const tag = /^(\*|[a-zA-Z][\w-]*)/.exec(s);
  if (tag) { parts.push({ k: 'tag', v: tag[1].toLowerCase() }); i = tag[1].length; }
  while (i < s.length) {
    const c = s[i];
    if (c === '.') { const m = /^\.([\w-]+)/.exec(s.slice(i)); parts.push({ k: 'class', v: m[1] }); i += m[0].length; }
    else if (c === '#') { const m = /^#([\w-]+)/.exec(s.slice(i)); parts.push({ k: 'id', v: m[1] }); i += m[0].length; }
    else if (c === '[') {
      const end = s.indexOf(']', i);
      const m = /^\[\s*([\w-]+)\s*(?:(=|~=|\|=|\^=|\$=|\*=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]$/.exec(s.slice(i, end + 1));
      if (!m) throw new Unsupported(`attribute selector ${s.slice(i, end + 1)}`);
      parts.push({ k: 'attr', name: m[1], op: m[2] || null, v: m[3] ?? m[4] ?? m[5] ?? null }); i = end + 1;
    } else if (c === ':') {
      const pe = s[i + 1] === ':';
      const m = /^::?([\w-]+)/.exec(s.slice(i));
      const name = m[1].toLowerCase(); i += m[0].length;
      let arg = null;
      if (s[i] === '(') {
        let depth = 0, j = i;
        for (; j < s.length; j++) { if (s[j] === '(') depth++; else if (s[j] === ')' && --depth === 0) break; }
        arg = s.slice(i + 1, j); i = j + 1;
      }
      parts.push({ k: pe ? 'pseudo-element' : 'pseudo', name, arg });
    } else throw new Unsupported(`compound selector "${s}"`);
  }
  return parts;
}

/** Split a complex selector into compounds; true if any combinator is not a descendant/child. */
function splitComplex(sel) {
  const toks = []; let cur = '', depth = 0, q = null, comb = null;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth === 0 && (c === ' ' || c === '>' || c === '+' || c === '~' || c === '\n' || c === '\t')) {
      if (cur) { toks.push({ comb, compound: cur }); cur = ''; comb = ' '; }
      if (c !== ' ' && c !== '\n' && c !== '\t') comb = c;
      continue;
    }
    cur += c;
  }
  if (cur) toks.push({ comb, compound: cur });
  return toks;
}

const MAX_SPEC = (a, b) => (a[0] !== b[0] ? (a[0] > b[0] ? a : b) : a[1] !== b[1] ? (a[1] > b[1] ? a : b) : a[2] >= b[2] ? a : b);
const ADD_SPEC = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Match one compound against an element: { match: true|false|null, spec }. */
function matchCompound(compound, el) {
  let spec = [0, 0, 0], result = true;
  const and = (r) => { if (r === false) result = false; else if (r === null && result !== false) result = null; };
  for (const p of parseCompound(compound)) {
    if (p.k === 'tag') { if (p.v !== '*') { spec = ADD_SPEC(spec, [0, 0, 1]); and(p.v === el.tag); } }
    else if (p.k === 'class') { spec = ADD_SPEC(spec, [0, 1, 0]); and(el.classes.includes(p.v)); }
    else if (p.k === 'id') { spec = ADD_SPEC(spec, [1, 0, 0]); and(false); }
    else if (p.k === 'attr') {
      spec = ADD_SPEC(spec, [0, 1, 0]);
      const has = Object.prototype.hasOwnProperty.call(el.attrs, p.name);
      if (!p.op) and(has);
      else if (p.op === '=') and(has && el.attrs[p.name] === p.v);
      else and(has ? null : false);
    } else if (p.k === 'pseudo-element') { spec = ADD_SPEC(spec, [0, 0, 1]); and(false); }
    else if (p.name === 'root') { spec = ADD_SPEC(spec, [0, 1, 0]); and(el.tag === 'html'); }
    else if (p.name === 'not' || p.name === 'is' || p.name === 'where') {
      let any = false, unknown = false, argSpec = [0, 0, 0];
      for (const a of splitTop(p.arg, ',')) {
        const r = matchCompound(a.trim(), el);
        argSpec = MAX_SPEC(argSpec, r.spec);
        if (r.match === true) any = true; else if (r.match === null) unknown = true;
      }
      const m = any ? true : unknown ? null : false;
      if (p.name !== 'where') spec = ADD_SPEC(spec, argSpec);
      and(p.name === 'not' ? (m === null ? null : !m) : m);
    } else { spec = ADD_SPEC(spec, [0, 1, 0]); and(null); } // :hover, :has(), … — cannot evaluate
  }
  return { match: result, spec };
}

/** Match a complex selector against `el` whose single ancestor chain is `parents` (nearest first). */
function matchSelector(sel, el, parents) {
  const toks = splitComplex(sel);
  const subject = matchCompound(toks[toks.length - 1].compound, el);
  if (toks.length === 1) return subject;
  if (subject.match === false) return subject;
  // <body>'s only ancestor is <html>; <html> has none. Descendant / child are
  // the only combinators that can then apply; anything else is unsupported.
  let spec = subject.spec, ok = subject.match;
  let chain = parents.slice();
  for (let t = toks.length - 2; t >= 0; t--) {
    const comb = toks[t + 1].comb;
    if (comb !== ' ' && comb !== '>') return { match: null, spec };
    const anc = chain.shift();
    if (!anc) return { match: false, spec };
    const r = matchCompound(toks[t].compound, anc);
    spec = ADD_SPEC(spec, r.spec);
    if (r.match === false) return { match: false, spec };
    if (r.match === null) ok = null;
  }
  return { match: ok, spec };
}

const INVALID = Symbol('guaranteed-invalid');

/** Substitute every var() in `value` using `lookup(name)`; INVALID on failure. */
function substitute(value, lookup) {
  let out = '', i = 0;
  while (i < value.length) {
    const k = value.indexOf('var(', i);
    if (k < 0) { out += value.slice(i); break; }
    out += value.slice(i, k);
    let depth = 0, j = k + 3;
    for (; j < value.length; j++) { if (value[j] === '(') depth++; else if (value[j] === ')' && --depth === 0) break; }
    const args = value.slice(k + 4, j);
    const comma = splitTop(args, ',');
    const name = comma[0].trim();
    const fallback = comma.length > 1 ? comma.slice(1).join(',').trim() : undefined;
    const got = lookup(name);
    if (got !== undefined && got !== INVALID) out += got;
    else if (fallback !== undefined) { const f = substitute(fallback, lookup); if (f === INVALID) return INVALID; out += f; }
    else return INVALID;
    i = j + 1;
  }
  return out;
}

/** Declared custom properties for one element: Map name -> {value, rule}. */
function declaredFor(rules, el, parents, env, problems) {
  const hits = [];
  for (const r of rules) {
    if (!r.decls.length) continue;
    let best = null, unknown = false;
    for (const sel of r.selectors) {
      let m;
      try { m = matchSelector(sel, el, parents); } catch (e) { if (e instanceof Unsupported) { unknown = true; continue; } throw e; }
      if (m.match === true) best = best ? MAX_SPEC(best, m.spec) : m.spec;
      else if (m.match === null) unknown = true;
    }
    if (!best) { if (unknown) problems.add(`cannot evaluate "${r.prelude}" for <${el.tag}>`); continue; }
    let condOk = true;
    for (const c of r.conds) {
      const v = evalCond(c, env);
      if (v === null) { problems.add(`cannot evaluate at-rule "${c}" around "${r.prelude}" (matches <${el.tag}>)`); condOk = false; }
      else if (!v) condOk = false;
    }
    if (!condOk) continue;
    if (r.decls.some((d) => d.important)) problems.add(`!important custom property in "${r.prelude}"`);
    hits.push({ spec: best, order: r.order, rule: r });
  }
  hits.sort((a, b) => (a.spec[0] - b.spec[0]) || (a.spec[1] - b.spec[1]) || (a.spec[2] - b.spec[2]) || (a.order - b.order));
  const declared = new Map();
  for (const h of hits) for (const d of h.rule.decls) declared.set(d.name, { value: d.value, rule: h.rule.prelude });
  return declared;
}

/** Computed custom properties: var() substituted on THIS element, else inherited. */
function computeFor(declared, inherited) {
  const out = new Map(inherited), busy = new Set(), done = new Set();
  const resolve = (name) => {
    if (!declared.has(name)) return inherited.get(name);
    if (done.has(name)) return out.get(name);
    if (busy.has(name)) return INVALID;
    busy.add(name);
    const v = substitute(declared.get(name).value, resolve);
    busy.delete(name); done.add(name);
    out.set(name, v === INVALID ? undefined : v.trim());
    return out.get(name);
  };
  for (const name of declared.keys()) resolve(name);
  return out;
}

/**
 * Resolve the computed custom properties of <html> and <body> for one side.
 *   themeKey: 'aggie' … 'neutral', or null for a classless <body>
 *   env: { osDark: boolean, scheme: undefined | 'light' | 'dark' }
 */
export function resolveSide(cssSrc, themeKey, env) {
  const rules = typeof cssSrc === 'string' ? parseRules(cssSrc) : cssSrc;
  const problems = new Set();
  const html = { tag: 'html', classes: [], attrs: {} };
  const body = { tag: 'body', classes: themeKey ? [`theme-${themeKey}`] : [], attrs: env.scheme ? { 'data-color-scheme': env.scheme } : {} };
  const htmlDecl = declaredFor(rules, html, [], env, problems);
  const htmlComp = computeFor(htmlDecl, new Map());
  const bodyDecl = declaredFor(rules, body, [html], env, problems);
  const bodyComp = computeFor(bodyDecl, htmlComp);
  return { html: htmlComp, body: bodyComp, htmlDecl, bodyDecl, problems: [...problems] };
}

// ─────────────────────────────────────────────────────────────────────────────
// [R] Resolver self-test on synthetic stylesheets — proves the model before
//     it is trusted against the real file.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[R] the resolver models the real cascade (synthetic stylesheets)…');
{
  const L = { osDark: false };
  const sb10 = ':root{--a:#111111;--b:var(--a)} body.theme-t{--a:#222222}';
  const s1 = resolveSide(sb10, 't', L);
  assert(norm(s1.body.get('--a')) === '#222222', '[R1] a body.theme-* override of --a reaches <body>');
  assert(norm(s1.body.get('--b')) === '#111111',
    '[R2] THE SB-10 SHAPE: --b:var(--a) declared on :root is substituted on <html> and inherited as the :root value, so <body>\'s --b is #111111 even though <body>\'s --a is #222222');
  const s2 = resolveSide(':root{--a:#111111} body{--b:var(--a)} body.theme-t{--a:#222222}', 't', L);
  assert(norm(s2.body.get('--b')) === '#222222', '[R3] the same alias declared on body (where the override lives) follows the override');
  const s3 = resolveSide('body.theme-t{--a:#111111} body{--a:#222222}', 't', L);
  assert(norm(s3.body.get('--a')) === '#111111', '[R4] specificity beats source order ((0,1,1) over a later (0,0,1))');
  const s4 = resolveSide('body.theme-t{--a:#111111} body.theme-t{--a:#222222}', 't', L);
  assert(norm(s4.body.get('--a')) === '#222222', '[R5] equal specificity: the later rule wins');
  const dark = '@media (prefers-color-scheme: dark){ body.theme-t:not([data-color-scheme="light"]){--a:#DDDDDD} } body.theme-t{--a:#AAAAAA} body.theme-t[data-color-scheme="dark"]{--a:#DDDDDD}';
  assert(norm(resolveSide(dark, 't', { osDark: true }).body.get('--a')) === '#DDDDDD', '[R6] OS dark, no attribute: the media block applies');
  assert(norm(resolveSide(dark, 't', { osDark: true, scheme: 'light' }).body.get('--a')) === '#AAAAAA', '[R7] OS dark, pinned Light: :not([data-color-scheme="light"]) excludes the media block');
  assert(norm(resolveSide(dark, 't', { osDark: false, scheme: 'dark' }).body.get('--a')) === '#DDDDDD', '[R8] OS light, pinned Dark: the attribute block applies');
  assert(norm(resolveSide(dark, 't', { osDark: false }).body.get('--a')) === '#AAAAAA', '[R9] OS light, no attribute: Light');
  const w = resolveSide(':where(body.theme-t){--a:#111111} body{--a:#222222}', 't', L);
  assert(norm(w.body.get('--a')) === '#222222', '[R10] :where() contributes zero specificity');
  const fb = resolveSide(':root{--a:#111111} .x{--z:#999999} body{--b:var(--nope,var(--a))}', null, L);
  assert(norm(fb.body.get('--b')) === '#111111', '[R11] var() fallback chains resolve; a .class rule does not match <body>');
  const loud = resolveSide('@media (orientation: landscape){ body{--a:#111111} } body:hover{--b:#222222}', null, L);
  assert(loud.problems.length === 2, `[R12] an unevaluable at-rule or pseudo-class on a rule that matches <body> is reported loudly, never skipped (${loud.problems.length} problem(s))`);
  const imp = resolveSide("@import url('https://x.example/a;b');\n:root{--a:#111111}", null, L);
  assert(norm(imp.body.get('--a')) === '#111111', '[R13] a statement at-rule (@import …;) before :root does not swallow the :root block');
  const wq = '@media (max-width: 480px){ :root{--p:14px} } @media(min-width:768px){:root{--p:24px}} :root{--p:16px}';
  assert(resolveSide(':root{--p:16px} ' + wq.split(' :root{--p:16px}')[0], null, { osDark: false, width: 390 }).body.get('--p') === '14px'
    && resolveSide(':root{--p:16px} ' + wq.split(' :root{--p:16px}')[0], null, { osDark: false, width: 1024 }).body.get('--p') === '24px'
    && resolveSide(':root{--p:16px} ' + wq.split(' :root{--p:16px}')[0], null, { osDark: false, width: 600 }).body.get('--p') === '16px',
  '[R14] min-width / max-width media queries are evaluated against the modelled viewport (390 → 14px, 600 → 16px, 1024 → 24px)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures: the real stylesheet, the six schools, Table 4L.
// ─────────────────────────────────────────────────────────────────────────────
const cssPath = fileURLToPath(new URL('./css/styles.css', import.meta.url));
const cssSrc = await readFile(cssPath, 'utf8');
const RULES = parseRules(cssSrc);

const SCHOOLS = ['aggie', 'sooner', 'trojan', 'irish', 'boilermaker', 'razorback'];
const TEXT_TOKENS = ['--maroon-text', '--maroon-mid-text', '--maroon-light-text'];
const FILL_OF = { '--maroon-text': '--maroon', '--maroon-mid-text': '--maroon-mid', '--maroon-light-text': '--maroon-light' };

// SP-52 DI-451 Table 4L, rows "--maroon-text (SB-10: explicit)", "--maroon-mid-text (SB-10)", "--maroon-light-text (SB-10)".
// AMENDED (coordinator, 2026-10-01, AA): --maroon-light-text for sooner,
// trojan and razorback is the school's own --maroon-mid, not its
// --maroon-light (#B83A3B 4.47 / #D62828 3.95 / #C84057 3.83:1 on the page,
// where the token's one consumer paints). The other three keep --maroon-light.
const TABLE_4L = {
  aggie:       { '--maroon-text': '#500000', '--maroon-mid-text': '#6B0000', '--maroon-light-text': '#8C1515' },
  sooner:      { '--maroon-text': '#841617', '--maroon-mid-text': '#9C1F20', '--maroon-light-text': '#9C1F20' },
  trojan:      { '--maroon-text': '#990000', '--maroon-mid-text': '#B30000', '--maroon-light-text': '#B30000' },
  irish:       { '--maroon-text': '#0C2340', '--maroon-mid-text': '#163255', '--maroon-light-text': '#23477A' },
  boilermaker: { '--maroon-text': '#1C1410', '--maroon-mid-text': '#2A1F18', '--maroon-light-text': '#3F2F22' },
  razorback:   { '--maroon-text': '#9D2235', '--maroon-mid-text': '#B22842', '--maroon-light-text': '#B22842' },
};
// Which of the school's own fills each Light text token equals (Table 4L as amended).
const LIGHT_TEXT_FILL = { aggie: '--maroon-light', sooner: '--maroon-mid', trojan: '--maroon-mid', irish: '--maroon-light', boilermaker: '--maroon-light', razorback: '--maroon-mid' };
// Munera Light (DI-448 Table 3, column "Munera L") and Munera Dark (shipped).
const MUNERA_L = { '--maroon-text': '#8C1515', '--maroon-mid-text': '#A6191C', '--maroon-light-text': '#BF2C2D' };
// RE-DERIVED by A1.9 F1 (2026-10-01) — OLD: #E86464 / #E86467 / #DE6E6F (which measured 4.21 / 4.22 / 4.30:1 on the lifted Dark inset #332C25: SB-06's matrix 'ATS:' label sits on the zebra rows). NEW: each
// lifted one step, hue kept, until it clears 4.5:1 there (4.68 / 4.62 / 4.67).
const MUNERA_D = { '--maroon-text': '#EA7272', '--maroon-mid-text': '#EA7073', '--maroon-light-text': '#E07879' };

// The Light side, in every way a player can be on it. All three stay Light
// after DI-451 adds school Dark blocks.
const LIGHT_CONTEXTS = [
  { label: 'OS light', env: { osDark: false } },
  { label: 'pinned Light', env: { osDark: false, scheme: 'light' } },
  { label: 'pinned Light on a Dark phone', env: { osDark: true, scheme: 'light' } },
];

console.log('\n[F] fixtures…');
{
  // RE-DERIVED (SP-52 DI-447, 2026-10-01): THEMES now holds four Munera looks (neutral, paper, ink, graphite) and the six schools. The
  // test's intent — the school list this suite iterates IS the shipped school list — is kept by selecting the entries that carry a
  // school (group 'school', school !== null), instead of "everything but neutral".
  const themeKeys = THEMES.filter((t) => t.group === 'school' && t.school).map((t) => t.key).sort();
  assert(JSON.stringify(themeKeys) === JSON.stringify([...SCHOOLS].sort()),
    `[F1] the six school keys equal the school entries of js/data-model.js THEMES (${themeKeys.join(', ')})`);
  assert(THEMES.filter((t) => !t.school).map((t) => t.key).join(',') === 'neutral,paper,ink,graphite',
    '[F1b] …and the four non-school looks are neutral, paper, ink, graphite (SP-52)');
  for (const k of SCHOOLS) {
    assert(RULES.some((r) => r.conds.length === 0 && r.selectors.includes(`body.theme-${k}`)),
      `[F2/${k}] a top-level body.theme-${k} block exists in css/styles.css`);
  }
  // The element model is <html> with no class/attribute and <body> with only
  // theme-* and data-color-scheme. Prove no rule keyed on any OTHER html/body
  // state (cfbp-booting, data-tab, …) declares a custom property — so the
  // model is complete for custom properties, not assumed to be.
  const offModel = [];
  for (const r of RULES) {
    if (!r.decls.length) continue;
    for (const sel of r.selectors) {
      const toks = splitComplex(sel);
      const subj = toks[toks.length - 1].compound;
      if (!/^(html|body)\b|^:root\b/.test(subj)) continue;
      for (const p of parseCompound(subj)) {
        const extra = (p.k === 'class' && !p.v.startsWith('theme-'))
          || (p.k === 'attr' && p.name !== 'data-color-scheme')
          || (p.k === 'pseudo' && !['root', 'not', 'is', 'where'].includes(p.name));
        if (extra) offModel.push(sel);
      }
    }
  }
  assert(offModel.length === 0,
    `[F3] no rule keyed on an html/body state outside the model declares a custom property${offModel.length ? ` (found: ${offModel.join(' | ')})` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] THE REPRODUCTION — every school's computed accent-text tokens on its
//     Light side equal the school's own Table 4L values, never Munera crimson.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] SB-10 — each school\'s computed --maroon-text* on its Light side…');
const sideCache = new Map();
function side(themeKey, env) {
  const key = `${themeKey}|${env.osDark}|${env.scheme || ''}`;
  if (!sideCache.has(key)) sideCache.set(key, resolveSide(RULES, themeKey, env));
  return sideCache.get(key);
}
{
  for (const k of SCHOOLS) {
    for (const ctx of LIGHT_CONTEXTS) {
      const s = side(k, ctx.env);
      assert(s.problems.length === 0, `[1-pre/${k}/${ctx.label}] the resolver evaluated every rule that matches <html>/<body>${s.problems.length ? ` (${s.problems.join('; ')})` : ''}`);
      for (const tok of TEXT_TOKENS) {
        const got = norm(s.body.get(tok));
        const want = TABLE_4L[k][tok];
        assert(got === want,
          `[1a/${k}/${ctx.label}] ${tok} resolves to the school's ${want} (got ${got}${got === MUNERA_L[tok] ? ' = MUNERA CRIMSON' : ''})`);
      }
    }
    // DI-451's own check: a school's Light accent text equals its own fill
    // (--maroon-light-text: the fill named in LIGHT_TEXT_FILL, per the AA amendment).
    const s = side(k, { osDark: false });
    for (const tok of TEXT_TOKENS) {
      const fill = tok === '--maroon-light-text' ? LIGHT_TEXT_FILL[k] : FILL_OF[tok];
      assert(norm(s.body.get(tok)) === norm(s.body.get(fill)),
        `[1b/${k}] Light ${tok} equals the school's own ${fill} (${norm(s.body.get(tok))} vs ${norm(s.body.get(fill))})`);
    }
    assert(norm(s.body.get('--maroon-text')) !== MUNERA_L['--maroon-text'],
      `[1c/${k}] --maroon-text is not Munera crimson ${MUNERA_L['--maroon-text']}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] The fix changes nothing for Munera: a classless <body> (the boot
//     script's catch path) and theme-neutral keep Munera Light; Munera Dark
//     keeps its shipped remap under both triggers.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Munera unchanged — Light (classless and theme-neutral) and Dark…');
{
  for (const [label, key] of [['classless <body>', null], ['theme-neutral', 'neutral']]) {
    for (const ctx of LIGHT_CONTEXTS) {
      const s = side(key, ctx.env);
      assert(s.problems.length === 0, `[2-pre/${label}/${ctx.label}] resolver evaluated every rule${s.problems.length ? ` (${s.problems.join('; ')})` : ''}`);
      for (const tok of TEXT_TOKENS) {
        assert(norm(s.body.get(tok)) === MUNERA_L[tok], `[2a/${label}/${ctx.label}] ${tok} is Munera Light ${MUNERA_L[tok]} (got ${norm(s.body.get(tok))})`);
      }
    }
  }
  for (const [label, env] of [['OS dark', { osDark: true }], ['pinned Dark', { osDark: false, scheme: 'dark' }]]) {
    const s = side('neutral', env);
    for (const tok of TEXT_TOKENS) {
      assert(norm(s.body.get(tok)) === MUNERA_D[tok], `[2b/theme-neutral/${label}] ${tok} is Munera Dark ${MUNERA_D[tok]} (got ${norm(s.body.get(tok))})`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] The guard against the whole class (DI-448 R1): no `:root` custom
//     property aliases (var()) a token that some <body> block overrides with
//     a DIFFERENT value. Checked semantically for every theme and scheme: the
//     alias's value on <body> must equal the alias re-evaluated against
//     <body>'s own tokens.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] R1 — no stale :root alias on any theme × scheme…');
{
  const rootAliases = [];
  for (const r of RULES) {
    if (r.conds.length || !r.selectors.includes(':root')) continue;
    for (const d of r.decls) if (d.value.includes('var(')) rootAliases.push(d);
  }
  assert(rootAliases.length > 0, `[3-pre] the :root aliases were found (${rootAliases.map((d) => d.name).join(', ')})`);
  const ENVS = [{ osDark: false }, { osDark: true }, { osDark: false, scheme: 'light' }, { osDark: true, scheme: 'light' }, { osDark: false, scheme: 'dark' }, { osDark: true, scheme: 'dark' }];
  const stale = [];
  for (const key of [...SCHOOLS, 'neutral', null]) {
    for (const env of ENVS) {
      const s = side(key, env);
      for (const d of rootAliases) {
        if (s.bodyDecl.has(d.name)) continue; // re-declared on <body>: not inherited from :root
        const reEval = substitute(d.value, (n) => s.body.get(n));
        const onBody = s.body.get(d.name);
        if (reEval !== INVALID && norm(reEval) !== norm(onBody)) {
          stale.push(`${d.name} on ${key ? `theme-${key}` : 'classless'} (${env.scheme || 'system'}, OS ${env.osDark ? 'dark' : 'light'}): body has ${onBody}, alias means ${reEval}`);
        }
      }
    }
  }
  assert(stale.length === 0,
    `[3a] every :root alias still means what it says on <body>, for all ${SCHOOLS.length + 2} themes × ${ENVS.length} schemes${stale.length ? ` — ${stale.length} stale, e.g. ${stale.slice(0, 3).join(' | ')}` : ''}`);
  const rootTextAliases = rootAliases.filter((d) => TEXT_TOKENS.includes(d.name));
  assert(rootTextAliases.length === 0,
    `[3b] :root holds literals for --maroon-text/--maroon-mid-text/--maroon-light-text, never var()${rootTextAliases.length ? ` (found: ${rootTextAliases.map((d) => `${d.name}:${d.value}`).join(', ')})` : ''}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] Structure for DI-451: each school's top-level Light block declares the
//     three tokens itself as literal hex (explicit, R8 table values), so the
//     Dark blocks DI-451 adds can override them by name at (0,2,1).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] each school Light block declares its own --maroon-text* explicitly…');
{
  for (const k of SCHOOLS) {
    const blocks = RULES.filter((r) => r.conds.length === 0 && r.selectors.length === 1 && r.selectors[0] === `body.theme-${k}`);
    const decls = new Map();
    for (const b of blocks) for (const d of b.decls) decls.set(d.name, d.value);
    for (const tok of TEXT_TOKENS) {
      const v = decls.get(tok);
      assert(isHex(v) && norm(v) === TABLE_4L[k][tok],
        `[4/${k}] body.theme-${k} declares ${tok}:${TABLE_4L[k][tok]} as a literal (found: ${v === undefined ? 'not declared' : v})`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] Contrast on the Light surfaces the tokens actually paint on (WCAG AA,
//     4.5:1 — every consumer is body-size or small text).
//       --maroon-text      : 70+ sites on page, cards, insets, pale/tint
//                            chips, gold-pale panels → all seven surfaces.
//       --maroon-mid-text  : live pills, chips, banners on --maroon-pale;
//                            .dc-live-detail on the card → all seven too.
//       --maroon-light-text: ONE consumer, `.admin-section-title-toggle:hover`
//                            (styles.css), a commissioner/admin section title
//                            that sits OUTSIDE its .card (app.js
//                            `<div class="admin-section-title">` precedes
//                            `<div class="card">`), i.e. on the page --bg.
//     Plus every rule that pairs a --maroon*-text colour with its own
//     background, resolved per school.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] AA contrast on each school\'s Light surfaces…');
// Named-advisory ratchet. 2026-09-30 it held sooner, trojan and razorback
// (DI-451 Table 4L's --maroon-light-text under 4.5:1 on the page). EMPTIED
// 2026-10-01: the coordinator amended Table 4L for AA, so every school must
// pass on every surface. The list may only shrink; do not add to it.
const ADVISORY_LIGHT_TEXT_ON_PAGE = new Set();
{
  const SURFACES = ['--bg', '--bg-card', '--bg-card-alt', '--bg-input', '--maroon-pale', '--maroon-tint', '--gold-pale'];
  const PAIRS = {
    '--maroon-text': SURFACES,
    '--maroon-mid-text': SURFACES,
    '--maroon-light-text': SURFACES, // paints on --bg today; held to every Light surface
  };
  for (const k of SCHOOLS) {
    const t = side(k, { osDark: false }).body;
    for (const [tok, surfaces] of Object.entries(PAIRS)) {
      for (const surf of surfaces) {
        const fg = t.get(tok), bg = t.get(surf);
        if (!isHex(fg) || !isHex(bg)) { assert(false, `[5-pre/${k}] ${tok} on ${surf} resolved to hex (fg ${fg}, bg ${bg})`); continue; }
        const r = contrast(fg, bg);
        if (tok === '--maroon-light-text' && surf === '--bg' && r < 4.5 && ADVISORY_LIGHT_TEXT_ON_PAGE.has(k)) {
          console.log(`  ⚠️  [5-advisory/${k}] ${tok} ${norm(fg)} on ${surf} ${norm(bg)} = ${r.toFixed(2)}:1 (< 4.5; named advisory, hover-only; ready fix in the SB-10 hand-off)`);
          continue;
        }
        assert(r >= 4.5, `[5a/${k}] ${tok} ${norm(fg)} on ${surf} ${norm(bg)} = ${r.toFixed(2)}:1 (>= 4.5)`);
      }
    }
  }
  // Every rule that sets its own colour from a --maroon*-text token AND its
  // own resolvable background, evaluated per school.
  const src = stripComments(cssSrc);
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m, checked = 0;
  const pairs = [];
  while ((m = ruleRe.exec(src))) {
    const body = m[2];
    const col = /(?:^|;)\s*color\s*:\s*(var\(--maroon(?:-mid|-light)?-text[^;]*?)\s*(?:;|$)/.exec(body);
    const bgm = /(?:^|;)\s*background(?:-color)?\s*:\s*(var\(--[\w-]+\))\s*(?:;|$)/.exec(body);
    if (col && bgm) pairs.push({ sel: m[1].trim().replace(/\s+/g, ' '), fg: col[1], bg: bgm[1] });
  }
  const unresolved = [];
  for (const k of SCHOOLS) {
    const t = side(k, { osDark: false }).body;
    for (const p of pairs) {
      const fg = substitute(p.fg, (n) => t.get(n)), bg = substitute(p.bg, (n) => t.get(n));
      if (!isHex(fg) || !isHex(bg)) { unresolved.push(`${k}: ${p.sel}`); continue; }
      checked++;
      const r = contrast(fg, bg);
      if (r < 4.5) assert(false, `[5b/${k}] "${p.sel}" ${norm(fg)} on ${norm(bg)} = ${r.toFixed(2)}:1 (< 4.5)`);
    }
  }
  assert(pairs.length >= 20 && unresolved.length === 0 && checked === pairs.length * SCHOOLS.length,
    `[5b] every same-rule --maroon*-text-on-background pairing clears AA on all six schools (${pairs.length} rules × ${SCHOOLS.length} schools = ${checked} resolved${unresolved.length ? `; UNRESOLVED: ${unresolved.slice(0, 3).join(' | ')}` : ''})`);
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
