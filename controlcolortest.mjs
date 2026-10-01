/**
 * CFB Pickems — controlcolortest.mjs
 * ==================================
 * RG-309 (reviewer follow-up to RG-TBD-M13, 2026-09-29) — the SIBLING-BUG SWEEP.
 *
 * THE CLASS. Drew (2026-09-29): "the text in the chat box is white and it's
 * really hard to see." Root cause (M13): `.chat-input` painted a themed
 * background and never set a text `color`, so the <textarea> took the UA's
 * `fieldtext`, which follows the USED color-scheme — and index.html declares
 * `<meta name="color-scheme" content="light dark">`, so with the OS in dark mode
 * every UA-coloured control is WHITE, on cream in the six school themes and in
 * Munera's explicit "Light". `<button>` has the same trap (`buttontext`). The
 * reviewer found `.chat-sheet-close` had the identical shape, which means
 * M13 fixed an instance and left the class open.
 *
 * WHAT THIS SUITE PINS. Every stylesheet rule that sets `background` or
 * `background-color` on an INTERACTIVE CONTROL must leave that control with an
 * explicit text `color` — set by the same rule, by another rule that is
 * guaranteed to apply to the same element (`color:inherit` counts: it is
 * explicit), or by a same-selector duplicate. A control is:
 *   · a <button>/<input>/<textarea>/<select> in the shipped templates
 *     (js/*.js, index.html), matched by tag + static classes; or
 *   · a class with no template evidence at all whose name reads as a control
 *     (btn / button / close / pill / chip / tab / toggle / switch / opt / tap),
 *     which must then be ALLOWLISTED with a reason a test can still check.
 * Background on a non-control (a span, a label, a card div) is not this bug and
 * is not swept.
 *
 * Also proved: the colour tokens this pass assigned clear WCAG 4.5:1 against the
 * surface each control sits on, in Munera light, both Munera dark blocks and all
 * six school themes (static, from the stylesheet's own token blocks); and the
 * sweep goes RED on mutations (M13's `.chat-input`, this pass's
 * `.chat-sheet-close`, a descendant-scoped rule, a brand-new control) — a sweep
 * that cannot see a regression is not coverage. The real-engine rendering of the
 * fixed controls is chatpagetest.mjs [M13b].
 *
 * Run: node controlcolortest.mjs   (CONTROLCOLOR_ROOT=/path/to/a/COPY to sweep a
 * mutated copy of the tree — mutate the copy, never this checkout).
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.CONTROLCOLOR_ROOT || here;
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ── a small CSS reader: comments out, @media/@supports flattened, @keyframes/@font-face dropped ──
function splitTop(s, sep) {
  const out = []; let depth = 0, q = null, cur = '';
  for (const ch of s) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}
function parseBlock(text) {
  const rules = []; let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i); if (open < 0) break;
    const head = text.slice(i, open).trim();
    let depth = 1, j = open + 1, q = null;
    while (j < text.length && depth > 0) {
      const ch = text[j];
      if (q) { if (ch === q) q = null; }
      else if (ch === '"' || ch === "'") q = ch;
      else if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith('@')) { if (/^@(media|supports|layer|container)/.test(head)) rules.push(...parseBlock(body)); }
    else rules.push({ selector: head, body });
    i = j;
  }
  return rules;
}
// Statement at-rules have no block and would swallow the NEXT rule into their head (the file opens with a Google Fonts
// `@import url('…;…');` — the `;`s inside the url are why this is a regex on the whole text, not a split).
const parseCss = css => parseBlock(css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import\s+url\([^)]*\)[^;{]*;/g, '').replace(/@charset[^;]*;/g, ''));
const decls = body => splitTop(body, ';').map(d => { const k = d.indexOf(':'); return k < 0 ? null : [d.slice(0, k).trim().toLowerCase(), d.slice(k + 1).trim()]; }).filter(Boolean);

const INTER = new Set(['button', 'input', 'textarea', 'select']);
const SKIP_INPUT = /type="(checkbox|radio|range|hidden|file|color|image)"/;
const CONTROL_NAME = /(^|-)(btn|button|close|pill|chip|tab|toggle|switch|opt|tap)(-|$)/;
const STATE = /:(hover|active|focus|focus-visible|focus-within|disabled|checked|not\(|before|after|placeholder|first|last|nth|only|empty|read-only|invalid|required|selection|indeterminate|target|visited|link|has\()|::|\[/;

/** Shipped templates with their comments removed. `${…}` expressions are NOT collapsed here: templates nest markup inside
 *  conditionals (`${cond ? `<div class="chat-replying"><button…>` : ''}`), and collapsing the expression would erase that markup.
 *  Only a class ATTRIBUTE's expressions become a `§` marker (classTokens(), below). */
function stripSource(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(l => l.replace(/^\s*\/\/.*$/, '')).join('\n');
}
function readSources(root) {
  const files = readdirSync(join(root, 'js')).filter(f => f.endsWith('.js')).map(f => readFileSync(join(root, 'js', f), 'utf8'));
  files.push(readFileSync(join(root, 'index.html'), 'utf8'));
  return stripSource(files.join('\n'));
}

/** A class attribute's tokens. A token GLUED to a `§` (a `${…}` expression) keeps its static prefix when that prefix is a whole
 *  class (`chat-react-pill${cond ? ' me' : ''}` → `chat-react-pill`) and is dropped when it ends in `-`/`_` (`chat-bubble-${state}`). */
function classTokens(attr) {
  const stat = []; let dyn = false;
  for (const raw of attr.split(/\s+/).filter(Boolean)) {
    if (!raw.includes('§')) { stat.push(raw); continue; }
    dyn = true;
    const prefix = raw.slice(0, raw.indexOf('§'));
    if (prefix && !/[-_]$/.test(prefix)) stat.push(prefix);
  }
  return { stat, dyn };
}
const hasClassNear = (before, tok) => new RegExp(`class="[^"]*(?<![\\w-])${tok}(?![\\w-])`).test(before);
/** How far back a scoped rule's ancestor class is looked for: the element sits in the same template, a few dozen lines below its container. */
const ANCESTOR_WINDOW = 1500;

/** What the sweep needs from the templates: every interactive element occurrence (with the text before it, for ancestor
 *  context) and every class token's tags. */
function scanTemplates(src) {
  const occ = [], tokenTags = new Map();
  for (const m of src.matchAll(/<([a-z][a-z0-9]*)\b([^>]*)>/g)) {
    const tag = m[1], cm = /class="([^"]*)"/.exec(m[2]);
    const { stat, dyn } = classTokens(cm ? cm[1].replace(/\$\{[^{}]*\}/g, '§') : '');
    for (const t of stat) { if (!tokenTags.has(t)) tokenTags.set(t, new Set()); tokenTags.get(t).add(tag); }
    if (!INTER.has(tag) || SKIP_INPUT.test(m[2])) continue;
    occ.push({ tag, classes: stat, dyn, before: src.slice(Math.max(0, m.index - ANCESTOR_WINDOW), m.index) });
  }
  const shapes = new Map();
  for (const o of occ) shapes.set(`${o.tag}|${o.classes.join('.')}${o.dyn ? '|dyn' : ''}`, o);
  return { occ, shapes: [...shapes.values()], tokenTags };
}

/** The sweep. Returns { offenders, unverified, stats } — both lists empty means the class is closed. */
export function sweep(cssText, srcText) {
  const rules = parseCss(cssText);
  const entries = [];
  for (const r of rules) for (const sel of splitTop(r.selector, ',')) {
    const s = sel.trim(), parts = s.split(/\s*[>+~]\s*|\s+/).filter(Boolean), last = parts[parts.length - 1] || '';
    const ds = decls(r.body);
    entries.push({
      sel: s, scoped: parts.length > 1, last, state: STATE.test(last),
      ancestors: parts.slice(0, -1).flatMap(p => [...p.matchAll(/\.([\w-]+)/g)].map(m => m[1])),
      tag: (last.match(/^[a-z][a-z0-9]*/) || [''])[0], classes: [...last.matchAll(/\.([\w-]+)/g)].map(m => m[1]),
      bg: ds.some(([k]) => k === 'background' || k === 'background-color'), color: ds.some(([k]) => k === 'color'),
    });
  }
  const { occ, shapes, tokenTags } = scanTemplates(srcText);
  const colorBySel = new Set(entries.filter(e => e.color).map(e => e.sel));
  // Does rule `e` apply to this element occurrence? Tag + static classes must match; a descendant-scoped rule additionally needs its
  // ancestor classes in the occurrence's own template (a scoped rule with NO ancestor class cannot be placed: it never "applies").
  const applies = (e, o) => (e.tag === '' || e.tag === o.tag) && (e.classes.length > 0 || e.tag !== '') && e.classes.every(k => o.classes.includes(k))
    && (!e.scoped || (e.ancestors.length > 0 && e.ancestors.every(a => hasClassNear(o.before, a))));
  const guaranteed = o => entries.some(c => c.color && !c.state && applies(c, o));
  const offenders = [], unverified = [], seenOff = new Set();
  const bgRules = entries.filter(e => e.bg && !e.state);
  for (const e of bgRules) {
    if (e.color || colorBySel.has(e.sel)) continue;                   // the rule (or its same-selector twin) sets it itself
    if (e.scoped && e.ancestors.length === 0) {                        // `body[data-x] button{background}` — cannot be placed on an element; it must carry its own colour
      if (INTER.has(e.tag) && !seenOff.has(e.sel)) { seenOff.add(e.sel); offenders.push({ control: `${e.tag} (scoped, no ancestor class)`, rule: e.sel }); }
      continue;
    }
    const targets = occ.filter(o => applies(e, o));
    if (targets.length) {
      for (const o of targets) if (!guaranteed(o)) {
        const k = `${o.tag}.${o.classes.join('.')}${o.dyn ? ' (dynamic classes)' : ''}`;
        if (!seenOff.has(k)) { seenOff.add(k); offenders.push({ control: k, rule: e.sel, dyn: o.dyn, classes: o.classes, tag: o.tag }); }
      }
      continue;
    }
    // no <button>/<input>/… in the templates carries this selector
    const ctlClasses = e.classes.filter(c => CONTROL_NAME.test(c));
    if (!ctlClasses.length) continue;
    const tags = ctlClasses.flatMap(c => [...(tokenTags.get(c) || [])]);
    if (tags.length && !tags.some(t => INTER.has(t))) continue;       // seen only on span/div/label: a badge, not a control
    if (!guaranteed({ tag: e.tag, classes: e.classes, before: '' })) unverified.push({ control: `.${e.classes.join('.')}`, rule: e.sel, seen: tags.length > 0 });
  }
  return { offenders, unverified, stats: { rules: rules.length, entries: entries.length, shapes: shapes.length, bgRules: bgRules.length } };
}

// ── the allowlist: every entry is a reason a test can still check ─────────────────────────────
const cssReal = readFileSync(join(ROOT, 'css/styles.css'), 'utf8');
const srcReal = readSources(ROOT);
const entriesOf = css => parseCss(css).flatMap(r => splitTop(r.selector, ',').map(s => ({ sel: s.trim(), color: decls(r.body).some(([k]) => k === 'color') })));
// a CLASS use (a `class="…"` attribute, `className = '…'` or classList.add/toggle) — an `id="notif-bell-btn"` is not one
const tokenUsed = (src, tok) => new RegExp(`class="[^"]*(?<![\\w-])${tok}(?![\\w-])|className\\s*=\\s*'[^']*(?<![\\w-])${tok}(?![\\w-])|classList\\.(?:add|toggle)\\([^)]*'${tok}'`).test(src);
const ALLOW = [
  { match: o => o.control === 'button.card (dynamic classes)', why: "`<button class=\"card ${cls}\">` in js/leagues-home.js renderComingSoonCard(): `cls` always starts with `coming-soon-card`, whose own rule sets color:inherit",
    holds: (css) => entriesOf(css).some(e => e.sel === '.coming-soon-card' && e.color) },
  { match: o => o.control === '.header-feedback-btn' || o.rule === '.header-feedback-btn', why: 'JS-created (app.js renderHeaderFeedbackButton): its content is an emoji plus a label span that sets its own colour — no UA-coloured text',
    holds: (css) => entriesOf(css).some(e => e.sel === '.header-feedback-label' && e.color) },
  { match: o => o.control === '.notif-bell-btn' || o.rule === '.notif-bell-btn', why: 'dead rule — no template renders a `notif-bell-btn` class (the bell moved into the control center); if one starts to, this entry goes stale and the sweep fails',
    holds: (css, src) => !tokenUsed(src, 'notif-bell-btn') },
  { match: o => o.control === '.home-badge-btn' || o.rule === '.home-badge-btn', why: 'dead rule — no template renders a `home-badge-btn` class; if one starts to, this entry goes stale and the sweep fails',
    holds: (css, src) => !tokenUsed(src, 'home-badge-btn') },
  // v0.28.0 integration (round 2, step 3): the Push branch (UN-315 / DI-436.5) added `.league-switch-leaving`, and its name
  // ("switch") reads as a control to this sweep. It is not one: app.js hideLeagueSwitchOverlay() creates it as a bare `div`
  // ghost (aria-hidden, pointer-events:none, no text) that fades the league-switch cover out. The class is applied through
  // `ghost.className = …`, not a `<tag class="…">` template, so the sweep has no template evidence and needs this entry.
  { match: o => o.control === '.league-switch-leaving' || o.rule === '.league-switch-leaving',
    why: "JS-created (app.js hideLeagueSwitchOverlay, UN-315 / DI-436.5): a `div` ghost that is aria-hidden, pointer-events:none and carries no text — a cover-coloured fade veil, not a control, so there is no UA-coloured text to fix; if it ever becomes a button/input or takes pointer events, this entry goes stale and the sweep fails",
    holds: (css, src) => /const ghost = document\.createElement\('div'\);\s*ghost\.className = 'league-switch-leaving';/.test(src)
      && /\.league-switch-leaving\{[^}]*pointer-events:none/.test(css) },
];
const filtered = (res, css, src) => {
  const live = x => { const a = ALLOW.find(al => al.match(x)); return !(a && a.holds(css, src)); };
  return { offenders: res.offenders.filter(live), unverified: res.unverified.filter(live) };
};

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] Fixture — the reader sees the real stylesheet and the real templates…');
// ─────────────────────────────────────────────────────────────────────────────
const real = sweep(cssReal, srcReal);
assert(real.stats.rules > 1000 && real.stats.bgRules > 300, `[1a] the stylesheet parses (${real.stats.rules} rules, ${real.stats.bgRules} background-setting selectors)`);
assert(real.stats.shapes > 100, `[1b] the templates yield ${real.stats.shapes} distinct interactive element shapes (buttons/inputs/textareas/selects)`);
{
  const shapes = scanTemplates(srcReal).shapes.map(s => `${s.tag}.${s.classes.join('.')}`);
  assert(['textarea.chat-input', 'button.chat-sheet-close', 'button.chat-act', 'input.form-input.chat-search-input'].every(k => shapes.includes(k)),
    '[1c] the shapes include the controls this bug lived on: textarea.chat-input, button.chat-sheet-close, button.chat-act, the search input');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] THE SWEEP — no control sets a background without an explicit text colour…');
// ─────────────────────────────────────────────────────────────────────────────
const res = filtered(real, cssReal, srcReal);
assert(res.offenders.length === 0,
  `[2a] every background-setting rule on a <button>/<input>/<textarea>/<select> leaves its control an explicit colour${res.offenders.length ? ' — OFFENDERS: ' + res.offenders.map(o => `${o.control} (rule ${o.rule})`).join(' | ') : ''}`);
assert(res.unverified.length === 0,
  `[2b] every control-named class with no template evidence is allowlisted with a checkable reason${res.unverified.length ? ' — UNVERIFIED: ' + res.unverified.map(o => `${o.control} (rule ${o.rule})`).join(' | ') : ''}`);
for (const a of ALLOW) assert(a.holds(cssReal, srcReal), `[2c] allowlist reason still holds — ${a.why}`);
{
  const named = ['.chat-sheet-close', '.chat-act', '.chat-mention-opt', '.chat-bubble-btn', '.reaction-pick-option', '.control-center-identity-tap', '.chat-replying button', '.chat-react-pill', '.chat-search-result', '.player-tile', '.chat-input'];
  const e = entriesOf(cssReal);
  assert(named.every(sel => e.some(x => x.sel === sel && x.color)), `[2d] the ten controls this pass fixed (plus .chat-input, M13) each carry their own colour: ${named.join(', ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] MUTATIONS — the sweep goes RED when the bug comes back (anti-vacuity)…');
// ─────────────────────────────────────────────────────────────────────────────
const mutate = (css, sel, from, to = '') => { const i = css.indexOf(sel + '{'); if (i < 0) return null; const j = css.indexOf('}', i); const body = css.slice(i, j); if (!body.includes(from)) return null; return css.slice(0, i) + body.replace(from, to) + css.slice(j); };
{
  const m1 = mutate(cssReal, '.chat-input', 'color:var(--text-primary);');
  const r1 = m1 && filtered(sweep(m1, srcReal), m1, srcReal);
  assert(!!m1 && r1.offenders.some(o => o.control.startsWith('textarea.chat-input')), '[3a] MUTATION: removing `color` from .chat-input (M13) is REPORTED');
  const m2 = mutate(cssReal, '.chat-sheet-close', 'color:var(--text-primary);');
  const r2 = m2 && filtered(sweep(m2, srcReal), m2, srcReal);
  assert(!!m2 && r2.offenders.some(o => o.control === 'button.chat-sheet-close'), '[3b] MUTATION: removing `color` from .chat-sheet-close (the reviewer\'s sibling) is REPORTED');
  const m3 = mutate(cssReal, '.chat-replying button', 'color:inherit;');
  const r3 = m3 && filtered(sweep(m3, srcReal), m3, srcReal);
  assert(!!m3 && r3.offenders.some(o => o.rule === '.chat-replying button'), '[3c] MUTATION: a descendant-scoped `.chat-replying button` without colour is REPORTED');
  const cssNew = cssReal + '\n.zz-close{background:var(--bg-input);border:none}\n';
  const rNew = filtered(sweep(cssNew, srcReal + '\n<button class="zz-close">x</button>'), cssNew, srcReal);
  assert(rNew.offenders.some(o => o.control === 'button.zz-close'), '[3d] a brand-new <button class="zz-close"> whose rule sets a background and no colour is REPORTED');
  const cssFixed = cssReal + '\n.zz-close{background:var(--bg-input);color:inherit;border:none}\n';
  assert(!filtered(sweep(cssFixed, srcReal + '\n<button class="zz-close">x</button>'), cssFixed, srcReal).offenders.some(o => o.control === 'button.zz-close'),
    '[3e] …and `color:inherit` (explicit) satisfies it — the sweep does not demand a hard-coded colour');
  const cssTwin = cssReal + '\n.zz-close{background:var(--bg-input);border:none}\n.zz-close.zz-x{color:var(--text-primary)}\n';
  assert(!filtered(sweep(cssTwin, srcReal + '\n<button class="zz-close zz-x">x</button>'), cssTwin, srcReal).offenders.some(o => o.control.startsWith('button.zz-close')),
    '[3f] …and so does a second rule that is guaranteed to apply to the same element (.zz-close.zz-x)');
  const cssDead = cssReal + '\n.zz-dead-btn{background:none}\n';
  const rDead = sweep(cssDead, srcReal);
  assert(rDead.unverified.some(o => o.control === '.zz-dead-btn'), '[3g] a control-named class with no template evidence and no colour is UNVERIFIED until allowlisted');
  const cssBadge = cssReal + '\n.zz-close-badge{background:var(--bg-input)}\n';
  assert(!sweep(cssBadge, srcReal + '\n<span class="zz-close-badge">x</span>').unverified.some(o => o.control === '.zz-close-badge')
    && !sweep(cssBadge, srcReal + '\n<span class="zz-close-badge">x</span>').offenders.some(o => o.control.includes('zz-close-badge')),
    '[3h] a control-NAMED class that only ever sits on a <span> is a badge, not a control — not swept');
  // The `.league-switch-leaving` allowlist entry (Push, UN-315 / DI-436.5) must be able to GO STALE: make its ghost a
  // <button>, or let it take pointer events, and the class is UNVERIFIED again instead of quietly staying excused.
  const ghostDiv = "const ghost = document.createElement('div');";
  const srcBtn = srcReal.replace(ghostDiv, "const ghost = document.createElement('button');");
  assert(srcBtn !== srcReal && filtered(sweep(cssReal, srcBtn), cssReal, srcBtn).unverified.some(o => o.control === '.league-switch-leaving'),
    '[3i] MUTATION: the league-switch ghost created as a <button> is UNVERIFIED — the allowlist entry goes stale');
  const cssClick = cssReal.replace(/(\.league-switch-leaving\{[^}]*?)pointer-events:none;/, '$1');
  assert(cssClick !== cssReal && filtered(sweep(cssClick, srcReal), cssClick, srcReal).unverified.some(o => o.control === '.league-switch-leaving'),
    '[3j] MUTATION: the league-switch ghost made clickable (pointer-events:none removed) is UNVERIFIED — the allowlist entry goes stale');
  assert(filtered(sweep(cssReal, srcReal), cssReal, srcReal).unverified.length === 0,
    '[3k] …and the unmutated tree has no unverified control (the entry holds today)');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] CONTRAST — the tokens this pass assigned clear 4.5:1 in every palette…');
// ─────────────────────────────────────────────────────────────────────────────
{
  const rulesAll = parseCss(cssReal);
  const tokensOf = sel => { const out = {}; for (const r of rulesAll) if (splitTop(r.selector, ',').some(s => s.trim() === sel)) for (const [k, v] of decls(r.body)) if (k.startsWith('--')) out[k] = v; return out; };
  const root = tokensOf(':root');
  const THEMES = {
    'Munera light': { ...root, ...tokensOf('body.theme-neutral') },
    'Munera dark (OS)': { ...root, ...tokensOf('body.theme-neutral'), ...tokensOf('body.theme-neutral:not([data-color-scheme="light"])') },
    'Munera dark (manual)': { ...root, ...tokensOf('body.theme-neutral'), ...tokensOf('body.theme-neutral[data-color-scheme="dark"]') },
  };
  for (const k of ['aggie', 'sooner', 'trojan', 'irish', 'boilermaker', 'razorback']) THEMES[`school: ${k}`] = { ...root, ...tokensOf(`body.theme-${k}`) };
  const hex = v => { const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(v || '').trim()); if (!m) return null; let h = m[1]; if (h.length === 3) h = [...h].map(c => c + c).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // ink × the surface each fixed control sits on. `inherit` controls take their parent's ink: --text-secondary on --bg-card-alt (.chat-replying), --text-primary on --bg-card (the drawer).
  const PAIRS = [['--text-primary', '--bg-input'], ['--text-primary', '--bg-card'], ['--text-primary', '--bg-card-alt'], ['--text-secondary', '--bg-card-alt']];
  let worst = Infinity, worstAt = '';
  let resolvedAll = true;
  for (const [name, t] of Object.entries(THEMES)) for (const [fg, bg] of PAIRS) {
    const a = hex(t[fg]), b = hex(t[bg]);
    if (!a || !b) { resolvedAll = false; console.error(`   (unresolved ${fg}/${bg} in ${name}: ${t[fg]} / ${t[bg]})`); continue; }
    const r = ratio(a, b); if (r < worst) { worst = r; worstAt = `${name}: ${fg} on ${bg}`; }
  }
  assert(resolvedAll && Object.keys(THEMES).length === 9, '[4a] every token the pairs read resolves to a hex value in all 9 palettes (Munera light, dark ×2, six school themes)');
  assert(worst >= 4.5, `[4b] the WORST ink/surface pair across all palettes is ${worst.toFixed(2)}:1 (${worstAt}) — ≥ 4.5:1`);
  const whiteOnCream = ratio([255, 255, 255], hex(THEMES['school: aggie']['--bg-input']));
  assert(whiteOnCream < 1.5, `[4c] anti-vacuity: the bug's own pair (UA white on the school themes' --bg-input) is ${whiteOnCream.toFixed(2)}:1 and would fail the same bar`);
}

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.exit(fail === 0 ? 0 : 1));
