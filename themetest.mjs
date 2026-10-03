/**
 * CFB Pickems — themetest.mjs (SP-52 THEMES, DI-456; Social Platform thread, feature-builder, 2026-10-01)
 * ============================================================================
 * Four Munera looks (Munera / Paper / Ink / Graphite) and six school themes, each with a Light and a Dark side: TWENTY SIDES. This is
 * the suite that proves every one of them from the REAL cascade, not from reading one block at a time — the tool that would have
 * caught SB-10 (school themes rendering Munera crimson text, because `--maroon-text:var(--maroon)` on :root froze at <html>).
 *
 *   [T1]  the resolver itself on a synthetic stylesheet (specificity, order, var() substituted ON THE DECLARING ELEMENT, the media
 *         trigger vs the attribute trigger, :where() is zero specificity, an equal-specificity tie resolves by order)
 *   [T2]  every contract token resolves to a literal on all 20 sides, both triggers (no var( left, nothing empty)
 *   [T3]  CONFORMANCE: the resolved values equal DESIGN_INPUTS_THEMES_093026.md Tables 1-4 (themetables.mjs), side by side — including
 *         every "—" (not declared on that side)
 *   [T4]  the CONTRAST MATRIX: 4.5:1 text roles and 3:1 icon/mark roles on every side, over the composited translucent tab bar; the
 *         named advisories are a RATCHETED list that can only shrink
 *   [T5]  disjoint writers (R5), Block A's selector list = the THEMES keys minus paper and graphite (J8), specificity ranks, and the
 *         trap: a school under Dark resolves page / inset / border / text to Munera Dark's
 *   [T6]  every Dark block exists twice (media trigger + pinned attribute) with byte-identical declarations (R6)
 *   [T7]  no :root alias of a token any theme block overrides (R1 — the SB-10 guard), with a negative control
 *   [T8]  the chrome-literal scan: no literal white in any header/chrome rule (DI-454)
 *   [T9]  the on-accent and on-gold sweeps (DI-448 C2 / C3)
 *   [T10] the Paper scope (J1): both triggers carry the identical root list, every root exists, :where() => zero specificity, no fills
 *   [T11] RENDER FIXTURES: real renderers + the control center driven into HTML and every text element's effective colour resolved
 *         through the cascade on all 20 sides: zero sub-threshold text outside the named advisories; no dark text on the ink page
 *   [T12] the first-paint blocks in index.html, EXECUTED in a sandbox (DI-453)
 *   [T13] THEMES keys == the CSS theme blocks == the inline OK list (ten keys)
 *   [T14] the scheme-swap fade lists colour properties only and has a reduced-motion twin
 *   [T15] Graphite's live family reads the semantic tokens on both sides; every other look is unchanged
 *
 * Run:  node themetest.mjs                  (assertions)
 *       node themetest.mjs --css <path>     (resolve another styles.css — used for the mutation proofs)
 *       node themetest.mjs --html <path>    (read another index.html)
 *       node themetest.mjs --table          (also print every contrast ratio)
 * Mutation proofs (CLAUDE.md: commit first, mutate a scratch COPY, never git checkout/restore/stash) are recorded in the handoff.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from './themeresolve.mjs';
import { TABLES, SCHOOLS, LOOKS, ALL_THEME_KEYS, ALL_TOKENS } from './themetables.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (flag, dflt) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : dflt; };
const CSS_PATH = argOf('--css', path.join(root, 'css/styles.css'));
const HTML_PATH = argOf('--html', path.join(root, 'index.html'));
const TABLE_MODE = argv.includes('--table');

let pass = 0, fail = 0;
const assert = (cond, label) => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } };
const norm = (v) => (v == null ? v : String(v).replace(/\s+/g, '').toUpperCase());

const cssText = fs.readFileSync(CSS_PATH, 'utf8');
const sheet = R.parseSheet(cssText);
const KEYS = ALL_THEME_KEYS;
const SIDES = KEYS.flatMap((k) => ['L', 'D'].map((s) => ({ key: k, side: s, id: `${k}:${s}` })));
const rgb = (v) => R.parseColor(v).rgb;
const NOT_LIGHT = ':not([data-color-scheme="light"])';
const MANUAL = '[data-color-scheme="dark"]';

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T1] the resolver, on a synthetic stylesheet…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  const syn = R.parseSheet(`
    @import url('https://example.com/a?x=1;2;3');
    :root{--a:#111111;--t:var(--a);--u:var(--missing,#abcdef);--c1:var(--c2);--c2:var(--c1);--n:var(--a)}
    body.theme-x{--a:#222222}
    body.theme-y{--a:#222222;--t:var(--a)}
    @media (prefers-color-scheme: dark){ body.theme-x:not([data-color-scheme="light"]){--d:dark} }
    body.theme-x[data-color-scheme="dark"]{--d:dark}
    :where(body.theme-w) .c{--k:zero}
    .c{--k:one}
    .e{--k:early} :where(body.theme-w) .e{--k:late-zero}
    body.theme-eq{--q:first} body.theme-eq{--q:second}
    body.theme-i{--init:initial;--o:keep}
    body.theme-cb > .kid{--ch:child} body.theme-cb .deep{--ds:desc}
    .hi{--imp:low !important} body.theme-cb .hi{--imp:high}
  `);
  const at = (key, pinned, osDark, name) => R.computedCustom(syn, R.makeBody(key, pinned), name, { osDark });
  assert(at('x', null, false, '--a') === '#222222', '[T1] a body-level override applies (--a: #222222 on body.x)');
  assert(at('x', null, false, '--t') === '#111111',
    '[T1] THE SB-10 SHAPE: a :root alias var(--a) froze at :root, so body.x\'s override of --a does NOT reach --t (got ' + at('x', null, false, '--t') + ')');
  assert(at('y', null, false, '--t') === '#222222' && at('y', null, false, '--a') === '#222222',
    '[T1] …while an alias declared ON BODY follows the body-level override (body.y declares both: --t resolves against body.y\'s own --a)');
  assert(at('x', null, false, '--u') === '#abcdef', '[T1] var(--missing, fallback) uses the fallback');
  assert(at('x', null, false, '--c1') === undefined, '[T1] a reference cycle is the guaranteed-invalid value (undefined)');
  assert(at('x', null, false, '--d') === undefined && at('x', null, true, '--d') === 'dark',
    '[T1] the media trigger: System with the OS light sets nothing, System with the OS dark applies the media block');
  assert(at('x', 'dark', false, '--d') === 'dark' && at('x', 'light', true, '--d') === undefined,
    '[T1] the pinned triggers: [data-color-scheme="dark"] applies with the OS light; :not([data-color-scheme="light"]) excludes a pinned Light even with the OS dark');
  {
    const body = R.makeBody('w', null);
    const c = R.makeNode({ tag: 'div', classes: ['c'], parent: body }); body.children.push(c);
    const e = R.makeNode({ tag: 'div', classes: ['e'], parent: body }); body.children.push(e);
    assert(R.computedCustom(syn, c, '--k', {}) === 'one', '[T1] :where() is ZERO specificity: `.c{…}` (later) beats `:where(body.w) .c{…}` (earlier)');
    assert(R.computedCustom(syn, e, '--k', {}) === 'late-zero',
      '[T1] …and the tie is real: `:where(body.w) .e` is (0,1,0), exactly `.e`, so the LATER rule wins by source order (the equal-specificity case themetest [T5] exists to forbid)');
  }
  assert(at('eq', null, false, '--q') === 'second', '[T1] equal specificity resolves by source order (the later declaration wins)');
  assert(at('i', null, false, '--init') === undefined && at('i', null, false, '--o') === 'keep', '[T1] `initial` is the guaranteed-invalid value');
  {
    const body = R.makeBody('cb', null);
    const kid = R.makeNode({ tag: 'div', classes: ['kid'], parent: body }); body.children.push(kid);
    const mid = R.makeNode({ tag: 'div', parent: body }); body.children.push(mid);
    const deep = R.makeNode({ tag: 'span', classes: ['deep'], parent: mid }); mid.children.push(deep);
    assert(R.computedCustom(syn, kid, '--ch', {}) === 'child' && R.computedCustom(syn, deep, '--ds', {}) === 'desc' && R.computedCustom(syn, deep, '--ch', {}) === undefined,
      '[T1] child (>) and descendant combinators match as written');
    const hi = R.makeNode({ tag: 'div', classes: ['hi'], parent: body }); body.children.push(hi);
    assert(R.computedCustom(syn, hi, '--imp', {}) === 'low', '[T1] !important beats specificity');
  }
  const specOf = (s) => R.specificity(R.parseSelectorList(s)[0]).join(',');
  assert(specOf('body.theme-neutral') === '0,1,1' && specOf('body.theme-neutral:not([data-color-scheme="light"])') === '0,2,1' && specOf('body.theme-neutral[data-color-scheme="dark"]') === '0,2,1',
    '[T1] specificity: Light body.theme-x is (0,1,1); both Dark triggers are (0,2,1)');
  assert(specOf(':where(body.theme-paper:not([data-color-scheme="light"])) :where(.card, .modal)') === '0,0,0', '[T1] a :where()-wrapped selector is (0,0,0)');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T2] every contract token resolves to a literal on all 20 sides, both triggers…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
const TOKEN_NAMES = Object.keys(ALL_TOKENS).filter((t) => t !== 'color-scheme');
function expectedFor(key, side) {
  const exp = {};
  if (!SCHOOLS.includes(key)) {
    for (const tok of TOKEN_NAMES) exp[tok] = ALL_TOKENS[tok][colOf(key, side)] ?? undefined;
    return exp;
  }
  // a school is an overlay on MUNERA: Munera's values for the side, replaced by the school's own roles (R4)
  for (const tok of TOKEN_NAMES) exp[tok] = ALL_TOKENS[tok][colOf('neutral', side)] ?? undefined;
  for (const tok of Object.keys(TABLES.t4l)) {
    exp[tok] = (side === 'D' && TABLES.t4d[tok] && TABLES.t4d[tok][key] != null) ? TABLES.t4d[tok][key] : TABLES.t4l[tok][key];
  }
  // A1.9 F3a: Table 4D may carry a token Table 4L does not (Notre Dame Dark's --on-accent-gold); it applies on the Dark side only
  if (side === 'D') for (const tok of Object.keys(TABLES.t4d)) if (!(tok in TABLES.t4l) && TABLES.t4d[tok][key] != null) exp[tok] = TABLES.t4d[tok][key];
  if (side === 'D') exp['--game-edge'] = undefined; // the gold edge is Munera and Ink only
  return exp;
}
const colOf = (key, side) => `${key}:${side}`;
function paperScopeNode(r) {
  // a representative scope root: <div class="card"> directly under <body>
  const n = R.makeNode({ tag: 'div', classes: ['card'], parent: r.body }); r.body.children.push(n);
  return n;
}
{
  for (const trig of ['system', 'pinned']) {
    for (const { key, side, id } of SIDES) {
      const r = R.resolveSide(sheet, key, side, trig);
      const missing = [], unresolved = [];
      const expT2 = expectedFor(key, side);
      for (const tok of TOKEN_NAMES) {
        const want = expT2[tok];
        if (want == null) continue;
        const got = r.get(tok);
        if (got === undefined || got === '') missing.push(tok);
        else if (/var\(/.test(got)) unresolved.push(`${tok}=${got}`);
      }
      assert(missing.length === 0 && unresolved.length === 0,
        `[T2] ${id} (${trig}): every contract token resolves to a literal${missing.length ? ' — MISSING ' + missing.join(', ') : ''}${unresolved.length ? ' — UNRESOLVED ' + unresolved.join(', ') : ''}`);
    }
  }
  for (const trig of ['system', 'pinned']) {
    const r = R.resolveSide(sheet, 'paper', 'D', trig);
    const sn = paperScopeNode(r);
    const bad = Object.keys(ALL_TOKENS).filter((t) => t !== 'color-scheme' && ALL_TOKENS[t]['paper:Dscope'] != null)
      .filter((t) => { const g = R.computedCustom(sheet, sn, t, r.ctx); return g === undefined || /var\(/.test(g); });
    assert(bad.length === 0, `[T2] the Paper Dark scope (${trig}) resolves every scope token to a literal${bad.length ? ' — ' + bad.join(', ') : ''}`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T3] CONFORMANCE — resolved values equal Tables 1-4, per side, per trigger…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
// tokens a school's SHIPPED Light block legitimately keeps from before SP-52 (A&M's warm page/inset/border; every school's tinted shadows)
const SCHOOL_LIGHT_SHIPPED = new Set(['--bg', '--bg-card-alt', '--bg-input', '--border', '--border-strong', '--text-primary', '--shadow-card', '--shadow-btn', '--bg-card']);
let compared = 0;
{
  for (const trig of ['system', 'pinned']) for (const { key, side, id } of SIDES) {
    const r = R.resolveSide(sheet, key, side, trig);
    const exp = expectedFor(key, side);
    const diffs = [];
    for (const [tok, want] of Object.entries(exp)) {
      if (SCHOOLS.includes(key) && side === 'L' && SCHOOL_LIGHT_SHIPPED.has(tok)) continue;
      compared++;
      const got = r.get(tok);
      if (norm(got) !== norm(want)) diffs.push(`${tok}: got ${got} want ${want}`);
    }
    assert(diffs.length === 0, `[T3] ${id} (${trig}) equals the tables${diffs.length ? ' — ' + diffs.slice(0, 6).join(' | ') + (diffs.length > 6 ? ` (+${diffs.length - 6} more)` : '') : ''}`);
  }
  assert(compared > 2000, `[T3] fixture: ${compared} token values compared (a vacuous run would compare none)`);
  // the "—" cells that matter: R2 tokens are NOT declared where the tables say so
  const un = (key, side, tok) => R.resolveSide(sheet, key, side, 'system').get(tok);
  assert(['neutral', 'ink'].every((k) => un(k, 'D', '--game-edge') === '#D4A017') && ['paper', 'graphite', ...SCHOOLS].every((k) => un(k, 'D', '--game-edge') === undefined)
    && KEYS.every((k) => un(k, 'L', '--game-edge') === undefined),
    '[T3] --game-edge exists ONLY on Munera Dark and Ink Dark (the gold hairline on dark game cards); every other side reads var(--game-edge, var(--border))');
  assert(un('ink', 'L', '--chrome-tab-border') === '#14110E' && un('neutral', 'L', '--chrome-tab-border') === undefined && un('graphite', 'D', '--chrome-tab-border') === undefined
    && un('paper', 'D', '--chrome-tab-border') === undefined && ['neutral', 'ink', ...SCHOOLS].every((k) => un(k, 'D', '--chrome-tab-border') === '#463D33'),
    '[T3] --chrome-tab-border: Ink Light and the Block-A Dark sides only');
  assert(un('graphite', 'L', '--chrome-sync-busy') === '#6E5419' && KEYS.filter((k) => k !== 'graphite').every((k) => un(k, 'L', '--chrome-sync-busy') === undefined) && un('graphite', 'D', '--chrome-sync-busy') === undefined,
    '[T3] --chrome-sync-busy exists only on Graphite Light (Graphite Dark resets it with `initial`, so the consumer falls back to --gold-light)');
  // RE-DERIVED by A1.9 F3a (2026-10-01) — OLD: "--on-accent-gold exists only on Graphite Dark". NEW: Graphite Dark (#6E5419, its near-white fill) AND Notre Dame Dark (#E8BE45, so the
  // matrix header's .pts-label clears 4.5:1 on the lifted navy fill: 4.26 -> 4.79); no Light side and no other Dark side declares it (the consumers fall back to --gold-light, R2).
  assert(un('graphite', 'D', '--on-accent-gold') === '#6E5419' && un('irish', 'D', '--on-accent-gold') === '#E8BE45'
    && KEYS.every((k) => (k === 'graphite' || k === 'irish') ? true : un(k, 'D', '--on-accent-gold') === undefined) && KEYS.every((k) => un(k, 'L', '--on-accent-gold') === undefined),
    '[T3] --on-accent-gold exists only on Graphite Dark (#6E5419) and Notre Dame Dark (#E8BE45), never on a Light side (A1.9 F3a)');
  // the school facts the DI calls out by name
  const a = R.resolveSide(sheet, 'aggie', 'L', 'system');
  assert(a.get('--text-muted') === '#6B5F53' && a.get('--text-secondary') === '#4A3F35' && a.get('--bg') === '#F7F4EF' && a.get('--bg-card-alt') === '#FAFAF8' && a.get('--border') === '#E4DDD5',
    '[T3] A&M Light keeps its warm page/inset/border and takes the AA muted (#6B5F53) and secondary (#4A3F35) — DI-451 F3');
  assert(R.contrast(rgb(a.get('--text-muted')), rgb(a.get('--bg'))) > 5.6, `[T3] …A&M muted text is ${R.contrast(rgb(a.get('--text-muted')), rgb(a.get('--bg'))).toFixed(2)}:1 on the A&M page (DI: 5.65)`);
  for (const k of SCHOOLS) {
    const L = R.resolveSide(sheet, k, 'L', 'system'), D = R.resolveSide(sheet, k, 'D', 'system');
    assert(['--chrome-bg', '--chrome-rule', '--gold', '--gold-light'].every((t) => norm(L.get(t)) === norm(D.get(t))),
      `[T3] ${k}: header, rule and gold are CONSTANT across sides (no status-bar or theme-color change on a flip for schools)`);
    assert(norm(L.get('--maroon-text')) === norm(L.get('--maroon')) && norm(L.get('--maroon-mid-text')) === norm(L.get('--maroon-mid')),
      `[T3] ${k}: Light --maroon-text / -mid-text equal the school's own fills (SB-10: no school renders Munera crimson as text)`);
    assert(norm(D.get('--maroon-text')) === norm(D.get('--maroon-mid-text')) && norm(D.get('--maroon-text')) === norm(D.get('--maroon-light-text')),
      `[T3] ${k}: Dark --maroon-text / -mid-text / -light-text are one verified value`);
  }
  for (const k of ['neutral', 'paper', 'ink', 'graphite', ...SCHOOLS]) {
    const L = R.resolveSide(sheet, k, 'L', 'system');
    assert(L.get('--oxblood') === '#7A1F2B' && L.get('--oxblood-on') === '#FFFFFF' && R.resolveSide(sheet, k, 'D', 'system').get('--oxblood') === '#7A1F2B',
      `[T3] ${k}: --oxblood / --oxblood-on are constants no block sets differently`);
  }
  // the Paper Dark SCOPE column
  for (const trig of ['system', 'pinned']) {
    const r = R.resolveSide(sheet, 'paper', 'D', trig);
    const sn = paperScopeNode(r);
    const diffs = [];
    for (const tok of TOKEN_NAMES) {
      const want = ALL_TOKENS[tok]['paper:Dscope'];
      const got = R.computedCustom(sheet, sn, tok, r.ctx);
      if (want != null) { if (norm(got) !== norm(want)) diffs.push(`${tok}: got ${got} want ${want}`); }
      else {
        // "—" in the scope column: NOT re-declared, so the container inherits the page-context value
        const page = ALL_TOKENS[tok]['paper:D'];
        if (page != null && norm(got) !== norm(page)) diffs.push(`${tok}: scope should inherit ${page}, got ${got}`);
      }
    }
    assert(diffs.length === 0, `[T3] Paper Dark paper scope (${trig}) equals the "Paper D (paper scope)" column${diffs.length ? ' — ' + diffs.slice(0, 5).join(' | ') : ''}`);
    assert(R.computedProp(sheet, sn, 'color', r.ctx) === '#14110E' && R.computedProp(sheet, R.makeNode({ tag: 'p', parent: r.body }), 'color', r.ctx) === '#E8E4DC',
      `[T3] Paper Dark (${trig}): text inside a paper container is Ink; text on the page is Marble (the scope's own \`color\`, not an inherited accident)`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T4] the CONTRAST MATRIX — every text role at 4.5:1, every icon/mark at 3:1, on all 20 sides…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
// NAMED ADVISORIES — a ratcheted list: each is a documented, carried gap (DESIGN_INPUTS_THEMES_093026.md DI-448 "Known advisories"). The
// assertion is that the FAILING SET IS A SUBSET of what is named here, so a new failure is RED and a fixed one only shrinks the list.
const LIGHT_SIDES = KEYS.map((k) => k + ':L');
// A1.9 (coordinator, 2026-10-01) CLOSED two of the three entries that stood here, so the list SHRANK:
//   - "accent-text-on-inset" (DI-448 advisory 1, WITHDRAWN: its premise was false, SB-06's matrix "ATS:" label sits on the zebra rows): every Dark accent-text value is lifted
//     one step (hue kept) until it clears 4.5:1 on the lifted inset #332C25 (F1);
//   - "paper-light-maroon-light-text": Paper Light --maroon-light-text is now #A6191C (F3b, 4.05 -> 5.27).
// "live-text-on-live-bg" loses Paper Dark (F3c: the paper scope's --live-text is #C81E1E) and keeps ONLY the Light sides: it predates SP-52 and fixing it would alter Munera Light,
// which DI-448 acceptance (6) freezes — deferred to ledger section 6 by A1.9, unchanged here.
const ADVISORIES = [
  { id: 'live-text-on-live-bg', role: '--live-text on --live-bg', min: 4.3, sides: [...LIGHT_SIDES],
    why: 'PRE-EXISTING and unchanged by SP-52: Light --live-text #DC2626 on --live-bg #FEF2F2 is 4.41:1 (.badge-live, the pulsing LIVE badge). DEFERRED to ledger section 6 by A1.9 (fixing it alters Munera Light, frozen by DI-448 acceptance (6)); recommended follow-up with --push-text (2.48)' },
];
const advisoryHit = {};
const advisoryFor = (roleId, sideId, ratio) => ADVISORIES.find((a) => a.role === roleId && a.sides.includes(sideId) && ratio >= a.min);
function rolesFor(key, side) {
  const r = R.resolveSide(sheet, key, side, 'system');
  const T = (n) => r.get(n);
  let S = T;
  if (key === 'paper' && side === 'D') { const sn = paperScopeNode(r); S = (n) => R.computedCustom(sheet, sn, n, r.ctx); }
  const roles = [];
  const sid = `${key}:${side}`;
  const add = (id, fg, bg, floor = 4.5, advisory = null, only = null) => { if (!only || only.includes(sid)) roles.push({ id, fg, bg, floor, advisory }); };
  const surfaces = { page: [T, rgb(T('--bg'))], card: [S, rgb(S('--bg-card'))], inset: [S, rgb(S('--bg-card-alt'))], game: [S, rgb(S('--bg-game'))] };
  for (const [sn, [tk, bg]] of Object.entries(surfaces)) for (const t of ['--text-primary', '--text-secondary', '--text-muted']) add(`${t} on ${sn}`, rgb(tk(t)), bg);
  for (const sn of ['page', 'card', 'game']) { const [tk, bg] = surfaces[sn]; add(`--maroon-text on ${sn}`, rgb(tk('--maroon-text')), bg); }
  add('--maroon-text on inset', rgb(S('--maroon-text')), surfaces.inset[1]);   // A1.9 F1: no longer an advisory — every Dark side clears it
  add('--maroon-mid-text on card', rgb(S('--maroon-mid-text')), surfaces.card[1]);
  add('--maroon-light-text on page', rgb(T('--maroon-light-text')), surfaces.page[1]);
  // A1.9: every role it touched is measured on EVERY surface it sits on (the Dark accent-text tokens, Paper Light's --maroon-light-text, the Paper Dark scope's three tokens, Notre Dame's gold)
  const DARK_SIDES = KEYS.map((k) => k + ':D');
  add('--maroon-mid-text on inset (A1.9)', rgb(S('--maroon-mid-text')), surfaces.inset[1], 4.5, null, DARK_SIDES);
  add('--maroon-light-text on card (A1.9)', rgb(S('--maroon-light-text')), surfaces.card[1], 4.5, null, [...DARK_SIDES, 'paper:L']);
  add('--maroon-light-text on inset (A1.9)', rgb(S('--maroon-light-text')), surfaces.inset[1], 4.5, null, [...DARK_SIDES, 'paper:L']);
  add('--maroon-light-text on game card (A1.9)', rgb(S('--maroon-light-text')), surfaces.game[1], 4.5, null, [...DARK_SIDES, 'paper:L']);
  for (const tk of ['--maroon-text', '--maroon-mid-text', '--maroon-light-text']) add(`${tk} on --maroon-pale (A1.9)`, rgb(S(tk)), rgb(S('--maroon-pale')), 4.5, null, DARK_SIDES);
  add('--live-text on card (A1.9 F3c)', rgb(S('--live-text')), surfaces.card[1], 4.5, null, ['paper:D']);
  add('--live-text on inset (A1.9 F3c)', rgb(S('--live-text')), surfaces.inset[1], 4.5, null, ['paper:D']);
  add('--nd-text on card (A1.9 F3d)', rgb(S('--nd-text')), surfaces.card[1], 4.5, null, ['paper:D']);
  add('--nd-text on inset (A1.9 F3d)', rgb(S('--nd-text')), surfaces.inset[1], 4.5, null, ['paper:D']);
  add('--loss on card (A1.9 F3d)', rgb(S('--loss')), surfaces.card[1], 4.5, null, ['paper:D']);
  add('--loss on inset (A1.9 F3d)', rgb(S('--loss')), surfaces.inset[1], 4.5, null, ['paper:D']);
  // .ob-net-me.net-negative paints rgba(185,28,28,.15) under --loss: the tint over the inset is the surface that was 4.39:1
  add('--loss on its 15% tint over the inset (A1.9 F3d)', rgb(S('--loss')), R.compositeOver({ rgb: [185, 28, 28], a: 0.15 }, surfaces.inset[1]), 4.5, null, ['paper:D']);
  // Notre Dame Dark: .pts-label is --on-accent-gold at opacity .85 over the accent fill (--maroon, #153E71)
  add('.pts-label --on-accent-gold at .85 over --maroon (A1.9 F3a)', R.compositeOver({ rgb: rgb(S('--on-accent-gold') || S('--gold-light')), a: 0.85 }, rgb(S('--maroon'))), rgb(S('--maroon')), 4.5, null, ['irish:D']);
  for (const f of ['--maroon', '--maroon-mid', '--maroon-light']) add(`--on-accent on ${f}`, rgb(T('--on-accent')), rgb(T(f)));
  const hdr = rgb(T('--chrome-bg'));
  const dim = (c) => R.compositeOver(R.parseColor(c), hdr);
  add('--chrome-fg on header', rgb(T('--chrome-fg')), hdr);
  add('--chrome-fg-dim on header', dim(T('--chrome-fg-dim')), hdr);
  add('--chrome-fg-faint on header (icon 3:1)', dim(T('--chrome-fg-faint')), hdr, 3);
  add('--chrome-mark on header (mark 3:1)', rgb(T('--chrome-mark')), hdr, 3);
  if (parseFloat(T('--chrome-rule-w')) >= 3) add('--chrome-rule vs header (3:1)', rgb(T('--chrome-rule')), hdr, 3);
  add('--on-gold on --gold (avatar initials)', rgb(T('--on-gold')), rgb(T('--gold')));
  add('--gold-text on --gold-pale', rgb(S('--gold-text')), rgb(S('--gold-pale')));
  add('--win on --win-bg', rgb(S('--win')), rgb(S('--win-bg')));
  add('--loss on --loss-bg', rgb(S('--loss')), rgb(S('--loss-bg')));
  add('--win on inset (zebra rows)', rgb(S('--win')), surfaces.inset[1]);
  add('--live-text on --live-bg', rgb(S('--live-text')), rgb(S('--live-bg')));
  add('--nd-text on --nd-bg', rgb(S('--nd-text')), rgb(S('--nd-bg')));
  add('--warning-text on --push-bg', rgb(S('--warning-text')), rgb(S('--push-bg')));
  add('--live-trail-text on card', rgb(S('--live-trail-text')), surfaces.card[1]);
  add('--live-trail-text on inset', rgb(S('--live-trail-text')), surfaces.inset[1]);
  add('--pick-live-cover-text on inset (A1.7)', rgb(S('--pick-live-cover-text')), surfaces.inset[1]);
  add('--pick-live-trail-text on inset (A1.7)', rgb(S('--pick-live-trail-text')), surfaces.inset[1]);
  add('--readiness-warn-text on card (A1.8)', rgb(S('--readiness-warn-text')), surfaces.card[1]);
  add('--readiness-incomplete-text on card (A1.8)', rgb(S('--readiness-incomplete-text')), surfaces.card[1]);
  // the translucent tab bar composites over whatever scrolls beneath it: the page, and the LIGHTEST card
  const bar = R.parseColor(T('--nav-material'));
  const barOver = (under) => R.compositeOver(bar, under);
  const lightest = [surfaces.card[1], surfaces.game[1]].sort((a, b) => R.relLuminance(b) - R.relLuminance(a))[0];
  for (const [bn, under] of [['page', surfaces.page[1]], ['lightest card', lightest]]) {
    add(`--chrome-tab-icon over the bar over ${bn} (icon 3:1)`, rgb(T('--chrome-tab-icon')), barOver(under), 3);
    add(`--chrome-tab-icon-selected over the bar over ${bn} (icon 3:1)`, rgb(T('--chrome-tab-icon-selected')), barOver(under), 3);
  }
  // Home wiring (2026-10-01; DESIGN_NEEDS_HOME Amendment 3 A3.4): the centre Home disc is filled with --chrome-tab-icon-selected and sits inside a cut-out ring of the OPAQUE --chrome-tab-bg, with the
  // mark reversed out in --chrome-tab-bg: ONE opaque pair is the disc against its ring, the mark on the disc, and the selected inner ring on the disc. It never touches the translucent bar, so the
  // pair above (over the bar over a card) does not cover it. Held to the full 4.5:1 here (the measured lowest is 4.60, Notre Dame Dark), though the non-text floor is 3:1.
  add('--chrome-tab-icon-selected vs --chrome-tab-bg (the Home disc fill against its opaque ring; the reversed-out mark on the disc)', rgb(T('--chrome-tab-icon-selected')), rgb(T('--chrome-tab-bg')));
  return roles;
}
{
  let rolesTotal = 0;
  const failing = {};
  const worstBySide = {};
  for (const { key, side, id } of SIDES) {
    const roles = rolesFor(key, side);
    rolesTotal += roles.length;
    let worst = 99;
    const fails = [];
    for (const rl of roles) {
      const ratio = R.contrast(rl.fg, rl.bg);
      if (TABLE_MODE) console.log(`     ${id.padEnd(14)} ${rl.id.padEnd(62)} ${ratio.toFixed(2)}`);
      if (rl.floor === 4.5) worst = Math.min(worst, ratio);
      if (ratio < rl.floor) {
        const adv = advisoryFor(rl.id, id, ratio);
        if (adv) (advisoryHit[adv.id] ??= new Set()).add(id);
        else fails.push(`${rl.id} ${ratio.toFixed(2)} < ${rl.floor}`);
      }
    }
    worstBySide[id] = worst;
    assert(fails.length === 0, `[T4] ${id}: every role clears its floor (worst text role ${worst.toFixed(2)}:1)${fails.length ? ' — FAILS: ' + fails.join(' | ') : ''}`);
  }
  assert(rolesTotal > 20 * 30, `[T4] fixture: ${rolesTotal} roles evaluated across 20 sides (a vacuous run would evaluate none)`);
  // the readout in DI-448 448.6 (recomputed there with the same maths): the worst text role per side
  const READOUT = { 'neutral:L': 4.89, 'neutral:D': 5.21, 'paper:L': 5.56, 'paper:D': 4.89, 'ink:L': 4.89, 'ink:D': 5.21, 'graphite:L': 4.69, 'graphite:D': 4.86 };
  for (const [id, want] of Object.entries(READOUT)) {
    const r = R.resolveSide(sheet, id.split(':')[0], id.split(':')[1], 'system');
    // the DI's worst text role is over text/secondary/muted on page, card, inset and game card only
    const roles = rolesFor(id.split(':')[0], id.split(':')[1]).filter((x) => /^--text-(primary|secondary|muted) on/.test(x.id));
    const worst = Math.min(...roles.map((x) => R.contrast(x.fg, x.bg)));
    assert(Math.abs(worst - want) < 0.02, `[T4] ${id}: the worst text role is ${worst.toFixed(2)}:1 — matches the DI-448 readout (${want})`);
  }
  // advisories are a RATCHETED list: each must still fire on exactly the sides it names — a FIXED side makes the entry stale (delete it); a NEW failure is red above
  for (const adv of ADVISORIES) {
    const hit = [...(advisoryHit[adv.id] || [])].sort();
    assert(JSON.stringify(hit) === JSON.stringify(adv.sides.slice().sort()),
      `[T4] named advisory "${adv.id}" fires on exactly the sides it names (${hit.join(', ')}) — ${adv.why}`);
  }
  // J3: the translucent bar. Over a light paper card the unselected icons were 2.56:1 at .72; the stated alphas pass
  assert(R.resolveSide(sheet, 'paper', 'D', 'system').get('--nav-material') === 'rgba(43,37,32,.92)' && R.resolveSide(sheet, 'ink', 'L', 'system').get('--nav-material') === 'rgba(20,17,14,.88)',
    '[T4] J3: Paper Dark and Ink Light carry the more opaque tab-bar material (.92 / .88) that keeps the icons at 3:1 over a light card');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T5] disjoint writers, the A-list, specificity ranks, and the A&M trap…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
const themeKeysIn = (sel) => [...sel.matchAll(/body\.theme-([a-z]+)/g)].map((m) => m[1]);
const darkMedia = sheet.rules.filter((r) => r.media === 'dark' && /body\.theme-/.test(r.selectorText));
const darkManual = sheet.rules.filter((r) => r.media === null && r.selectorText.includes(MANUAL) && /body\.theme-/.test(r.selectorText));
const propNames = (rule) => new Set(rule.decls.map((d) => d.prop).filter((p) => p !== 'color-scheme'));
const bodyLevel = (rules) => rules.filter((r) => !r.selectorText.startsWith(':where('));
const classify = (rule) => {
  const keys = [...new Set(themeKeysIn(rule.selectorText))];
  if (keys.length === 8) return 'A';
  if (keys.length === 2) return 'B-munera';
  if (keys.length === 1 && keys[0] === 'paper') return 'P';
  if (keys.length === 1 && keys[0] === 'graphite') return 'G';
  if (keys.length === 1) return 'B-' + keys[0];
  return '?';
};
{
  const mediaBlocks = bodyLevel(darkMedia);
  const by = {}; for (const r of mediaBlocks) (by[classify(r)] ??= []).push(r);
  assert(Object.keys(by).sort().join(',') === ['A', 'B-aggie', 'B-irish', 'B-boilermaker', 'B-munera', 'B-razorback', 'B-sooner', 'B-trojan', 'G', 'P'].sort().join(',')
    && Object.values(by).every((l) => l.length === 1),
    `[T5] the media region has exactly the blocks A, B-munera, six B-school, P and G, once each (found ${Object.entries(by).map(([k, v]) => k + '×' + v.length).join(' ')})`);
  const A = by.A?.[0], BM = by['B-munera']?.[0];
  const aKeys = [...new Set(themeKeysIn(A.selectorText))].sort();
  const { THEMES } = await import('./js/data-model.js');
  const expectA = THEMES.map((t) => t.key).filter((k) => k !== 'paper' && k !== 'graphite').sort();
  assert(JSON.stringify(aKeys) === JSON.stringify(expectA), `[T5] Block A's selector list equals the THEMES keys minus paper and graphite (J8): ${aKeys.join(', ')}`);
  assert(A.selectors.length === 8 && A.selectors.every((cx) => R.specificity(cx).join(',') === '0,2,1'), '[T5] …as an ENUMERATED list of eight (0,2,1) selectors, not a :not() chain');
  const overlap = (x, y) => [...propNames(x)].filter((n) => propNames(y).has(n));
  assert(overlap(A, BM).length === 0, `[T5] Block A and B-munera write DISJOINT token names${overlap(A, BM).length ? ' — OVERLAP ' + overlap(A, BM).join(', ') : ''}`);
  for (const k of SCHOOLS) {
    const B = by['B-' + k][0];
    assert(overlap(A, B).length === 0, `[T5] Block A and B-${k} write DISJOINT token names (the trap: A must never set --maroon-text)${overlap(A, B).length ? ' — OVERLAP ' + overlap(A, B).join(', ') : ''}`);
    assert(B.selectors.length === 1 && R.specificity(B.selectors[0]).join(',') === '0,2,1', `[T5] B-${k} is one (0,2,1) selector`);
  }
  assert(!propNames(A).has('--maroon-text') && !propNames(A).has('--maroon') && !propNames(A).has('--gold-text') && !propNames(A).has('--chrome-bg'),
    '[T5] Block A sets no school-owned token (--maroon*, --gold*, --chrome-bg)');
  assert(!SCHOOLS.some((k) => aKeys.length && by['B-' + k][0].decls.some((d) => ['--bg', '--bg-card', '--text-primary', '--border'].includes(d.prop))),
    '[T5] no B-school block sets a page, card, text or border token — a school inherits Munera\'s');
  // specificity ranks: every Light theme block is (0,1,1); every Dark block is >= (0,2,1)
  const lightBlocks = sheet.rules.filter((r) => r.media === null && /^body\.theme-[a-z]+$/.test(r.selectorText));
  assert(lightBlocks.length === 10 && lightBlocks.every((r) => R.specificity(r.selectors[0]).join(',') === '0,1,1'), `[T5] ten Light blocks, each (0,1,1) (found ${lightBlocks.length})`);
  assert(mediaBlocks.every((r) => r.selectors.every((cx) => { const s = R.specificity(cx); return s[0] === 0 && s[1] >= 2; })) && bodyLevel(darkManual).every((r) => r.selectors.every((cx) => R.specificity(cx)[1] >= 2)),
    '[T5] every Dark block is (0,2,1) or higher, so no Light value can leak into a Dark side and source order never decides');
  // THE TRAP: A&M under Dark resolves page / inset / border / text to Munera Dark's, while A&M Light keeps its own warm page
  for (const trig of ['system', 'pinned']) {
    const ag = R.resolveSide(sheet, 'aggie', 'D', trig), mu = R.resolveSide(sheet, 'neutral', 'D', trig);
    assert(['--bg', '--bg-card', '--bg-card-alt', '--bg-input', '--border', '--border-strong', '--text-primary', '--text-secondary', '--text-muted'].every((t) => ag.get(t) === mu.get(t)),
      `[T5] THE TRAP (${trig}): body.theme-aggie under Dark resolves page, cards, inset, border and text to Munera Dark's — the A&M Light surfaces (#F7F4EF …) cannot leak`);
  }
  assert(R.resolveSide(sheet, 'aggie', 'L', 'system').get('--bg') === '#F7F4EF', '[T5] …and A&M Light keeps its own warm page (#F7F4EF)');
  // a mutation-proof helper: a school whose Dark set repeated a Block-A name would be caught — prove the detector bites
  const fake = { decls: [{ prop: '--bg' }, { prop: '--maroon' }] };
  assert([...propNames(A)].some((n) => propNames(fake).has(n)), '[T5] negative control: the overlap detector DOES fire on a block that repeats a Block-A name');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T6] both triggers carry byte-identical declarations (R6)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  const canon = (r) => r.decls.map((d) => `${d.prop}:${d.value.replace(/\s+/g, ' ')}`).join(';');
  const keyOf = (r, trig) => r.selectorText.replace(/\s+/g, ' ').split(trig).join('@@');
  const media = new Map(darkMedia.map((r) => [keyOf(r, NOT_LIGHT), r]));
  const manual = new Map(darkManual.map((r) => [keyOf(r, MANUAL), r]));
  assert(media.size === darkMedia.length && manual.size === darkManual.length, '[T6] every Dark rule has a distinct selector key');
  assert(darkMedia.length === 12 && darkManual.length === 12, `[T6] twelve Dark rules per trigger (A, B-munera, 6 B-school, P, P scope, P .dashboard-scroll, G): media ${darkMedia.length}, manual ${darkManual.length}`);
  const onlyMedia = [...media.keys()].filter((k) => !manual.has(k)), onlyManual = [...manual.keys()].filter((k) => !media.has(k));
  assert(onlyMedia.length === 0 && onlyManual.length === 0, `[T6] every media block has a manual twin and vice versa${onlyMedia.length ? ' — media-only: ' + onlyMedia.join(' / ') : ''}${onlyManual.length ? ' — manual-only: ' + onlyManual.join(' / ') : ''}`);
  const drift = [];
  for (const [k, m] of media) { const t = manual.get(k); if (t && canon(m) !== canon(t)) drift.push(k.slice(0, 70)); }
  assert(drift.length === 0, `[T6] declaration sets are BYTE-IDENTICAL between the two triggers for all ${media.size} blocks${drift.length ? ' — DRIFT: ' + drift.join(' | ') : ''}`);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T7] no :root alias of a token any theme block overrides (R1 — the SB-10 guard)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
function rootAliasViolations(sh) {
  const rootRules = sh.rules.filter((r) => r.media === null && r.selectorText.trim() === ':root');
  const rootDecl = {}; for (const r of rootRules) for (const d of r.decls) if (d.prop.startsWith('--')) rootDecl[d.prop] = d.value;
  const themeRules = sh.rules.filter((r) => !(r.media === null && r.selectorText.trim() === ':root') && /body(\.theme-|\[data-color-scheme)|:where\(body/.test(r.selectorText));
  const overridden = {}; // token -> set of values the theme blocks give it
  for (const r of themeRules) for (const d of r.decls) if (d.prop.startsWith('--')) (overridden[d.prop] ??= new Set()).add(d.value.replace(/\s+/g, '').toUpperCase());
  const out = [];
  for (const [name, val] of Object.entries(rootDecl)) {
    for (const m of val.matchAll(/var\(\s*(--[A-Za-z0-9_-]+)/g)) {
      const target = m[1];
      const vals = overridden[target];
      if (!vals) continue;
      // an override is a DIFFERENT value; a constant a block merely restates (--oxblood) never changes the answer
      const rootVal = (rootDecl[target] || '').replace(/\s+/g, '').toUpperCase();
      if ([...vals].some((v) => v !== rootVal)) out.push(`${name}:${val} aliases ${target}, which a theme block overrides`);
    }
  }
  return out;
}
{
  const v = rootAliasViolations(sheet);
  assert(v.length === 0, `[T7] no :root declaration aliases (var()) a token a theme block overrides${v.length ? ' — ' + v.join(' | ') : ''}`);
  const bad = R.parseSheet(':root{--maroon:#8C1515;--maroon-text:var(--maroon)} body.theme-aggie{--maroon:#500000}');
  assert(rootAliasViolations(bad).length === 1, '[T7] negative control: re-adding `--maroon-text:var(--maroon)` to :root IS caught (the exact SB-10 shape)');
  const ok = R.parseSheet(':root{--oxblood:#7A1F2B;--gate:var(--oxblood)} body.theme-aggie{--oxblood:#7A1F2B}');
  assert(rootAliasViolations(ok).length === 0, '[T7] …and a constant a theme block merely RESTATES (--oxblood) is not an override');
  const r = R.resolveSide(sheet, 'aggie', 'L', 'system');
  assert(r.get('--maroon-text') === '#500000', '[T7] consequence: A&M text accent resolves to A&M\'s own #500000 (not Munera crimson #8C1515)');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T8] the chrome-literal scan — no literal white in any header or chrome rule (DI-454)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
const CHROME_NAMES = /app-header|header-meta|league-pill|control-center-trigger|header-sync|header-identity|header-feedback|brand-wordmark|notif-bell|native-shell::before/;
const WHITE = /#fff\b|#ffffff\b|\bwhite\b|rgba?\(\s*255\s*,\s*255\s*,\s*255/i;
{
  const hits = [];
  let scanned = 0;
  for (const r of sheet.rules) {
    if (!CHROME_NAMES.test(r.selectorText)) continue;
    scanned++;
    for (const d of r.decls) if (WHITE.test(d.value)) hits.push(`${r.selectorText.replace(/\s+/g, ' ').slice(0, 60)} { ${d.prop}:${d.value} }`);
  }
  assert(scanned >= 20, `[T8] fixture: ${scanned} chrome rules scanned`);
  assert(hits.length === 0, `[T8] no #fff / white / rgba(255,255,255…) in any chrome rule${hits.length ? ' — ' + hits.join(' | ') : ''}`);
  const get = (sel, prop) => {
    const rule = sheet.rules.filter((x) => x.media === null && x.selectorText.split(',').map((q) => q.replace(/\s+/g, ' ').trim()).includes(sel) && x.decls.some((d) => d.prop === prop)).pop();
    return rule?.decls.find((d) => d.prop === prop)?.value;
  };
  assert(get('.app-header', 'background') === 'var(--chrome-bg)' && /var\(--chrome-rule-w\) solid var\(--chrome-rule\)/.test(get('.app-header', 'border-bottom') || '') && get('.app-header', 'box-shadow') === 'var(--chrome-shadow)',
    '[T8] .app-header reads --chrome-bg, --chrome-rule-w/--chrome-rule and --chrome-shadow');
  assert(get('.control-center-trigger', 'color') === 'var(--chrome-mark)' && get('.league-pill', 'color') === 'var(--chrome-fg)' && get('.header-meta strong', 'color') === 'var(--chrome-fg)',
    '[T8] the trigger reads --chrome-mark; the league pill and the week name read --chrome-fg');
  assert(/var\(--chrome-tab-border,\s*var\(--border\)\)/.test(get('.bottom-nav', 'border') || '') && get('.bottom-nav', 'background') === 'var(--chrome-tab-bg)',
    '[T8] .bottom-nav reads --chrome-tab-bg and var(--chrome-tab-border, var(--border)) (R2 fallback)');
  assert(get('.nav-item', 'color') === 'var(--chrome-tab-icon)' && get('.nav-item.active', 'color') === 'var(--chrome-tab-icon-selected)' && get('.nav-item.active::after', 'background') === 'var(--chrome-tab-icon-selected)',
    '[T8] .nav-item reads --chrome-tab-icon; .nav-item.active (colour AND its dot) reads --chrome-tab-icon-selected');
  assert(/var\(--chrome-sync-busy,\s*var\(--gold-light\)\)/.test(sheet.css.match(/\.header-sync-icon\[data-sync="syncing"\]\s*\{[^}]*\}/)?.[0] || ''),
    '[T8] the syncing icon reads var(--chrome-sync-busy, var(--gold-light)) (R2 fallback)');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T9] the on-accent and on-gold sweeps (DI-448 C2/C3)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
function accentFillWhiteViolations(sh) {
  const out = [];
  for (const r of sh.rules) {
    if (r.media !== null) continue;
    if (/^body\.theme-|^:root|^:where/.test(r.selectorText.trim())) continue;
    const bg = r.decls.filter((d) => d.prop === 'background' || d.prop === 'background-color').map((d) => d.value);
    if (!bg.some((v) => /^var\(--maroon(?:-mid|-light)?\)$/.test(v.trim()))) continue;
    const col = r.decls.filter((d) => d.prop === 'color').map((d) => d.value.trim());
    if (col.some((c) => /^(#fff|#ffffff|white|var\(--oxblood-on\))$/i.test(c))) out.push(r.selectorText.replace(/\s+/g, ' ').slice(0, 70));
  }
  return out;
}
{
  const v = accentFillWhiteViolations(sheet);
  assert(v.length === 0, `[T9] ZERO rules pair an accent fill (--maroon*) with a literal white / --oxblood-on label${v.length ? ' — ' + v.join(' | ') : ''}`);
  assert(accentFillWhiteViolations(R.parseSheet('.x{background:var(--maroon);color:#fff} .y{background:var(--maroon-mid);color:var(--oxblood-on)}')).length === 2,
    '[T9] negative control: a rule putting #fff back on an accent fill (or --oxblood-on) IS caught');
  const reads = (sel) => sheet.rules.filter((r) => r.selectorText.replace(/\s+/g, ' ').trim() === sel).flatMap((r) => r.decls).filter((d) => d.prop === 'color').map((d) => d.value.trim());
  const LABELS = ['.btn-primary', '.player-tile.selected .player-avatar,.player-tile:hover .player-avatar', '.layout-toggle-btn.active', '.dc-chip-init', '.comm-tab.active', '.cb-count',
    '.comment-avatar', '.chat-pill.active', '.chat-avatar-mine', '.chat-send-btn', '.chat-bubble-unread', '.chat-jump-latest', '.ob-filter-tab.active', '.lc-btn-primary', '.stand-table th'];
  const missing = LABELS.filter((l) => !reads(l).includes('var(--on-accent)'));
  assert(missing.length === 0, `[T9] the sixteen accent-fill label rules read var(--on-accent)${missing.length ? ' — NOT: ' + missing.join(' | ') : ''}`);
  assert(sheet.rules.some((r) => /^\.dashboard-table th$/.test(r.selectorText.trim()) && r.decls.some((d) => d.prop === 'color' && d.value === 'var(--on-accent)')),
    '[T9] .dashboard-table th reads var(--on-accent)');
  assert(/\.dashboard-table th\.player-col\{color:var\(--on-accent-gold,var\(--gold-light\)\)\}/.test(sheet.css.replace(/\s+/g, ' ').replace(/\{ /g, '{').replace(/ \}/g, '}')) || sheet.rules.some((r) => r.selectorText.trim() === '.dashboard-table th.player-col' && r.decls.some((d) => d.value === 'var(--on-accent-gold,var(--gold-light))')),
    '[T9] the gold-on-fill sibling .dashboard-table th.player-col reads var(--on-accent-gold, var(--gold-light)) (R2: only Graphite Dark sets it)');
  assert(sheet.rules.some((r) => /\.pts-label/.test(r.selectorText) && r.decls.some((d) => d.prop === 'color' && /on-accent-gold/.test(d.value))), '[T9] .pts-label reads var(--on-accent-gold, …)');
  for (const sel of ['.cc-avatar', '.header-identity-avatar', '.notif-bell-badge']) {
    assert(sheet.rules.some((r) => r.selectorText.replace(/\s+/g, ' ').trim() === sel && r.decls.some((d) => d.prop === 'color' && d.value === 'var(--on-gold)')), `[T9] ${sel} reads var(--on-gold) (initials on gold)`);
  }
  assert(sheet.rules.some((r) => r.selectorText.trim() === '.cc-row-switch[data-on="true"]::after' && r.decls.some((d) => d.prop === 'background' && d.value === 'var(--on-accent)')),
    '[T9] the Team-logos switch thumb reads --on-accent when on (a white thumb vanishes on Graphite Dark\'s near-white track)');
  // the same class one level over: a label painted on a TEXT-token fill (--text-muted) must follow the surface, never a literal white
  // (raising Dark --text-muted to AA left white initials at 2.33:1 on it — .dc-chip-blind .dc-chip-init, .alma-result-tie)
  {
    const bad = sheet.rules.filter((r) => r.media === null && r.decls.some((d) => (d.prop === 'background' || d.prop === 'background-color') && /^var\(--text-(muted|secondary)\)$/.test(d.value.trim()))
      && r.decls.some((d) => d.prop === 'color' && /^(#fff|#ffffff|white)$/i.test(d.value.trim()))).map((r) => r.selectorText.replace(/\s+/g, ' ').slice(0, 60));
    assert(bad.length === 0, `[T9] no label is a literal white on a --text-muted / --text-secondary fill${bad.length ? ' — ' + bad.join(' | ') : ''}`);
    assert(sheet.rules.some((r) => /dc-chip-blind \.dc-chip-init/.test(r.selectorText) && r.decls.some((d) => d.prop === 'color' && d.value === 'var(--bg-card)')) && sheet.rules.some((r) => /alma-result-tie/.test(r.selectorText) && r.decls.some((d) => d.prop === 'color' && d.value === 'var(--bg-card)')),
      '[T9] the blind chip initials and the Alma Mater tie pill read var(--bg-card) on their --text-muted fill');
  }
  // --on-accent is white everywhere except Graphite Dark; --on-gold is Ink on every side
  const ons = SIDES.map(({ key, side }) => R.resolveSide(sheet, key, side, 'system')).map((r, i) => [SIDES[i].id, r.get('--on-accent'), r.get('--on-gold')]);
  assert(ons.every(([id, a, g]) => (id === 'graphite:D' ? a === '#14110E' : a === '#FFFFFF') && g === '#14110E'), '[T9] --on-accent is white on every side except Graphite Dark (#14110E); --on-gold is Ink on every side');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T10] the Paper scope — both triggers carry the identical root list; zero specificity; no fills (J1)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
function paperScopeRules(rules) { return rules.filter((r) => r.selectorText.startsWith(':where(body.theme-paper') && !/:where\(\s*\.dashboard-scroll\s*\)\s*$/.test(r.selectorText)); }
const rootList = (r) => { const m = /\)\s*:where\(([\s\S]*)\)\s*$/.exec(r.selectorText.replace(/\s+/g, ' ')); return m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []; };
{
  const scopeMedia = paperScopeRules(darkMedia), scopeManual = paperScopeRules(darkManual);
  assert(scopeMedia.length === 1 && scopeManual.length === 1, '[T10] one paper-scope rule per trigger');
  const lm = rootList(scopeMedia[0]), ll = rootList(scopeManual[0]);
  assert(lm.length >= 30 && JSON.stringify(lm) === JSON.stringify(ll), `[T10] BOTH triggers list the identical roots (${lm.length} selectors)`);
  const missing = lm.filter((sel) => { const cls = sel.replace(/^\./, ''); return !new RegExp('\\.' + cls.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '(?![A-Za-z0-9_-])').test(cssText.replace(/\/\*[\s\S]*?\*\//g, '').replace(/:where\([^)]*\)/g, '')); });
  assert(missing.length === 0, `[T10] every listed root exists in the stylesheet outside the scope itself${missing.length ? ' — MISSING ' + missing.join(', ') : ''}`);
  assert([...scopeMedia, ...scopeManual].every((r) => r.selectors.every((cx) => R.specificity(cx).join(',') === '0,0,0')), '[T10] the scope selector is wrapped in :where() — specificity (0,0,0), so a card\'s own rules always win');
  const forbidden = [...scopeMedia[0].decls].filter((d) => /^--(maroon|maroon-mid|maroon-light|gold|gold-light|on-|chrome-|shadow-|nav-material|oxblood)$/.test(d.prop));
  assert(forbidden.length === 0, '[T10] the scope sets no fill (--maroon*, --gold, --gold-light), chrome, shadow or --on-* token');
  const dash = darkMedia.filter((r) => /:where\(\s*\.dashboard-scroll\s*\)\s*$/.test(r.selectorText))[0];
  assert(dash && dash.decls.some((d) => d.prop === 'background' && d.value === 'var(--bg-card)'), '[T10] .dashboard-scroll (no background of its own) gets the paper surface so its odd rows are not the ink page');
  // bite: a root missing from ONE trigger's list is detected by the list comparison
  assert(JSON.stringify(lm.slice(1)) !== JSON.stringify(ll), '[T10] negative control: dropping a root from one trigger makes the lists differ');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T12] the first-paint blocks in index.html, EXECUTED in a sandbox (DI-453)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
const html = fs.readFileSync(HTML_PATH, 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const schemeBlock = blocks.find((b) => b.includes('cfbp_scheme_hint'));
const themeBlock = blocks.find((b) => b.includes('cfbp_theme_hint'));
const chromeBlock = blocks.find((b) => b.includes('--chrome-bg'));
{
  assert(!!schemeBlock && !!themeBlock && !!chromeBlock, '[T12] index.html carries the scheme-hint block, the theme block and the chrome block');
  assert(blocks.filter((b) => b.includes('cfbp_theme_hint')).length === 1, '[T12] the theme block is still the ONLY block mentioning the theme-hint key (boottest [29] finds it by that substring)');
  assert(!schemeBlock.includes('cfbp_theme_hint') && !chromeBlock.includes('cfbp_theme_hint'), '[T12] …and neither new block contains that substring');
  const iS = blocks.indexOf(schemeBlock), iT = blocks.indexOf(themeBlock), iC = blocks.indexOf(chromeBlock);
  assert(iS < iT && iT < iC, '[T12] source order: scheme hint, THEN the theme class, THEN the chrome tint (the tint reads tokens that need both)');
  const runScheme = (raw, throwing = false) => {
    const set = [];
    const ls = { getItem: (k) => { if (throwing) throw new Error('storage denied'); return k === 'cfbp_scheme_hint' ? raw : null; } };
    const doc = { body: { setAttribute: (n, v) => set.push([n, v]) } };
    // eslint-disable-next-line no-new-func
    new Function('localStorage', 'document', schemeBlock)(ls, doc);
    return set;
  };
  assert(JSON.stringify(runScheme(JSON.stringify('light'))) === JSON.stringify([['data-color-scheme', 'light']]) && JSON.stringify(runScheme(JSON.stringify('dark'))) === JSON.stringify([['data-color-scheme', 'dark']]),
    '[T12] a pinned light/dark hint sets data-color-scheme on <body> before first paint');
  assert(runScheme(JSON.stringify('system')).length === 0 && runScheme(JSON.stringify('bogus')).length === 0 && runScheme(JSON.stringify('<script>')).length === 0 && runScheme('not json at all').length === 0 && runScheme(null).length === 0,
    '[T12] system, bogus, a script-looking value, corrupt JSON and an absent hint set NOTHING (the CSS media query decides) — nothing off the device is ever spliced');
  let threw = false; try { runScheme(JSON.stringify('dark'), true); } catch { threw = true; }
  assert(!threw, '[T12] a denied localStorage never throws out of the block');
  const runChrome = (value, withMeta = true, throwing = false) => {
    const meta = { content: '#8C1515', setAttribute(n, v) { if (n === 'content') this.content = v; } };
    const doc = { body: {}, querySelector: () => (withMeta ? meta : null) };
    const gcs = () => ({ getPropertyValue: () => { if (throwing) throw new Error('boom'); return value; } });
    // eslint-disable-next-line no-new-func
    new Function('document', 'getComputedStyle', chromeBlock)(doc, gcs);
    return meta.content;
  };
  assert(runChrome(' #1C1C1E ') === '#1C1C1E' && runChrome('#14110E') === '#14110E', '[T12] the chrome block tints <meta name="theme-color"> from the resolved --chrome-bg (trimmed)');
  assert(runChrome('') === '#8C1515' && runChrome('#000', false) === '#8C1515' && runChrome('#000', true, true) === '#8C1515', '[T12] an empty token, a missing meta tag or a throwing getComputedStyle leaves the static value and never throws');
  assert(/<meta name="theme-color" content="#8C1515" \/>/.test(html), '[T12] the static <meta name="theme-color"> is Munera crimson #8C1515 (it was the stale Aggie #500000)');
  const man = JSON.parse(fs.readFileSync(path.join(path.dirname(HTML_PATH), 'manifest.json'), 'utf8'));
  assert(man.theme_color === '#8C1515' && man.background_color === '#500000', '[T12] manifest theme_color is #8C1515 (J10); background_color is left alone');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T13] THEMES keys == the CSS theme blocks == the inline OK list (ten keys)…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  const { THEMES, THEME_GROUP_LABELS } = await import('./js/data-model.js');
  const keys = THEMES.map((t) => t.key);
  const okList = (/var OK = \[([^\]]*)\]/.exec(themeBlock || '')?.[1] || '').split(',').map((s) => s.replace(/['"\s]/g, '')).filter(Boolean);
  assert(keys.length === 10 && new Set(keys).size === 10, `[T13] THEMES has ten distinct keys (${keys.join(', ')})`);
  assert(JSON.stringify(keys.slice().sort()) === JSON.stringify(okList.slice().sort()), `[T13] the inline OK list equals the THEMES keys (${okList.join(', ')})`);
  const cssKeys = [...new Set(sheet.rules.filter((r) => r.media === null && /^body\.theme-[a-z]+$/.test(r.selectorText.trim())).map((r) => r.selectorText.trim().slice('body.theme-'.length)))];
  assert(JSON.stringify(cssKeys.sort()) === JSON.stringify(keys.slice().sort()), `[T13] every THEMES key has a Light block \`body.theme-<key>\` (and nothing else does): ${cssKeys.join(', ')}`);
  const darkKeys = new Set(darkMedia.flatMap((r) => themeKeysIn(r.selectorText)));
  assert(keys.every((k) => darkKeys.has(k)), '[T13] every THEMES key has a Dark side (a media block names it)');
  assert(THEMES[0].key === 'neutral' && THEMES.every((t) => t.group in THEME_GROUP_LABELS) && JSON.stringify([...new Set(THEMES.map((t) => t.group))]) === JSON.stringify(['munera', 'neutral', 'school']),
    '[T13] the picker order: Munera (neutral) first, then Paper, Ink, Graphite, then the six schools; three groups in first-appearance order');
  assert(THEMES.find((t) => t.key === 'neutral').label === 'Munera (default)' && THEMES.find((t) => t.key === 'paper').label === 'Munera Paper' && THEMES.find((t) => t.key === 'ink').label === 'Munera Ink' && THEMES.find((t) => t.key === 'graphite').label === 'Graphite',
    '[T13] the four names are exactly as ruled (Munera, Munera Paper, Munera Ink, Graphite)');
  assert(!THEMES.some((t) => 'desc' in t), '[T13] the unused `desc: "Default"` field is dropped');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T14] the scheme-swap fade lists colour properties only and has a reduced-motion twin…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  const swap = sheet.rules.filter((r) => r.media === null && /body\.scheme-swap/.test(r.selectorText) && r.decls.some((d) => d.prop === 'transition-property'));
  assert(swap.length === 1, '[T14] one scheme-swap transition rule');
  const props = swap[0].decls.find((d) => d.prop === 'transition-property').value.split(',').map((s) => s.trim());
  const COLOUR = ['background-color', 'color', 'border-color', 'box-shadow', 'fill', 'stroke', 'text-decoration-color'];
  assert(props.every((p) => COLOUR.includes(p)) && !props.some((p) => /transform|opacity|width|height|all|margin|padding|top|left/.test(p)),
    `[T14] the fade transitions colour properties ONLY — never transform, opacity or width (${props.join(', ')})`);
  assert(swap[0].decls.some((d) => d.prop === 'transition-duration' && d.value === 'var(--motion-nav)') && swap[0].decls.some((d) => d.prop === 'transition-timing-function' && d.value === 'var(--ease-native)'),
    '[T14] …over --motion-nav (260ms, the Navigation range) with --ease-native: no new duration');
  const twin = sheet.rules.filter((r) => /reduce/.test(r.media || '') && /body\.scheme-swap/.test(r.selectorText) && r.decls.some((d) => d.prop === 'transition' && /^none$/.test(d.value.trim())));
  assert(twin.length === 1, '[T14] a prefers-reduced-motion twin turns the fade OFF (the change is instant under Reduce Motion)');
  const quickTwin = sheet.rules.filter((r) => /reduce/.test(r.media || '') && /cc-quick-seg/.test(r.selectorText));
  assert(quickTwin.length >= 1, '[T14] the quick row\'s press scale and transitions have a Reduce Motion twin');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T15] Graphite keeps "live" meaning live; every other look is unchanged…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
{
  const mk = (key, side, classes, parentClasses = []) => {
    const r = R.resolveSide(sheet, key, side, 'system');
    let parent = r.body;
    for (const pc of parentClasses) { const n = R.makeNode({ tag: 'div', classes: [pc], parent }); parent.children.push(n); parent = n; }
    const n = R.makeNode({ tag: 'span', classes, parent }); parent.children.push(n);
    return { r, n };
  };
  const probe = (key, side, classes) => { const { r, n } = mk(key, side, classes); return { bg: R.computedBackground(sheet, n, r.ctx), color: R.computedProp(sheet, n, 'color', r.ctx) }; };
  const LIVE = [['.live-pill', ['live-pill']], ['.dc-status.dc-live', ['dc-status', 'dc-live']], ['.dc-chip-live', ['dc-chip-live']], ['.alma-live-pill', ['alma-live-pill']]];
  for (const side of ['L', 'D']) {
    const g = R.resolveSide(sheet, 'graphite', side, 'system');
    for (const [label, classes] of LIVE) {
      const p = probe('graphite', side, classes);
      assert(norm(p.bg) === norm(g.get('--live-bg')) && norm(p.color) === norm(g.get('--loss')), `[T15] Graphite ${side}: ${label} paints --live-bg with --loss text (${p.bg} / ${p.color})`);
    }
    const { r: gr, n: dot } = mk('graphite', side, ['live-dot']);
    assert(norm(R.computedBackground(sheet, dot, gr.ctx)) === norm(gr.get('--live')), `[T15] Graphite ${side}: .live-dot paints the semantic --live (red)`);
    const { r: gd, n: det } = mk('graphite', side, ['dc-status', 'dc-live-detail']);
    assert(norm(R.computedProp(sheet, det, 'color', gd.ctx)) === norm(gd.get('--loss')), `[T15] Graphite ${side}: .dc-status.dc-live-detail text is --loss`);
    const ahead = probe('graphite', side, ['alma-live-pill', 'alma-live-ahead']);
    const behind = probe('graphite', side, ['alma-live-pill', 'alma-live-behind']);
    assert(norm(ahead.color) === norm(g.get('--win')) && norm(behind.color) === norm(g.get('--loss')),
      `[T15] Graphite ${side}: the ahead/behind variants KEEP their win/loss colours (the override must not out-rank them) — ${ahead.color} / ${behind.color}`);
    assert(!sheet.rules.some((r) => /theme-graphite/.test(r.selectorText) && /badge-locked/.test(r.selectorText)), '[T15] .badge-locked is not overridden in Graphite (Locked is a neutral state: a brand tint)');
  }
  for (const key of ['neutral', 'paper', 'ink', ...SCHOOLS]) for (const side of ['L', 'D']) {
    const r = R.resolveSide(sheet, key, side, 'system');
    const p = probe(key, side, ['live-pill']);
    assert(norm(p.bg) === norm(r.get('--maroon-pale')) && norm(p.color) === norm(r.get('--maroon-mid-text')), `[T15] ${key} ${side}: .live-pill keeps its brand tint (--maroon-pale / --maroon-mid-text), unchanged`);
  }
  const scoped = sheet.rules.filter((r) => /\.live-dot|\.live-pill|dc-live|dc-chip-live|alma-live-pill/.test(r.selectorText) && /theme-graphite/.test(r.selectorText));
  assert(scoped.length >= 2 && scoped.every((r) => r.selectors.every((cx) => /theme-graphite/.test(JSON.stringify(cx[0].compound)) || /theme-graphite/.test(r.selectorText))), '[T15] every override selector is scoped to body.theme-graphite');
  const g = R.resolveSide(sheet, 'graphite', 'L', 'system'), gd = R.resolveSide(sheet, 'graphite', 'D', 'system');
  assert(R.contrast(rgb(g.get('--loss')), rgb(g.get('--live-bg'))) > 5.8 && R.contrast(rgb(gd.get('--loss')), rgb(gd.get('--live-bg'))) > 6.2, '[T15] --loss on --live-bg is 5.91:1 Light and 6.22:1 Dark (the DI\'s figures)');
}

// ═════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T11] RENDER FIXTURES — the real renderers, every text element, all 20 sides…');
// ═════════════════════════════════════════════════════════════════════════════════════════════
// The REAL renderers (renderDashboardCompact / renderDashboardTable / renderGameCard / renderLeaderboard / renderControlCenter incl. the
// quick row) are driven into HTML (themefixtures.mjs), parsed, and every text-bearing element's EFFECTIVE colour (inherited, var()
// substituted on the element, translucent colours and opacity composited) is checked against its PAINTED surface (every ancestor
// background composited over the first opaque one) through the real cascade, per side. This is the test that finds a card-like container
// missing from PAPER_ROOTS: it would paint dark text on the ink page, or a card token outside the scope.
//
// NAMED ADVISORIES — every sub-threshold element found is either a PRE-EXISTING gap that is identical on v0.28.0 (verified by running this
// same fixture set against that stylesheet: 87 failing element signatures on Munera alone, 24 of the 31 that remain are the same elements
// and 7 are new) or one of the SP-52 consequences named below. The list is a RATCHET: a new failing element is RED; a fixed one makes its entry
// stale (the "still fires" assertion goes red until the entry is deleted), so it can only shrink.
// A1.9 (coordinator, 2026-10-01) CLOSED five entries that stood here, so the list SHRANK by five:
//   "accent-text-on-zebra-inset" (F1: every Dark accent-text value lifted until it clears 4.5:1 on the lifted inset #332C25), "badge-draft-dash" (F3e: .badge-draft reads
//   --bg-card-alt), "paper-dark-live-text" (F3c: the paper scope's --live-text #C81E1E), "paper-dark-net-negative" (F3d: the paper scope's --loss #A81717) and
//   "irish-dark-pts-label" (F3a: Notre Dame Dark --on-accent-gold #E8BE45). What remains is PRE-EXISTING on v0.28.0 and carried unchanged.
const T11_ADVISORIES = [
  { id: 'faint-empty-glyphs', min: 1.4, why: 'the empty-state glyph affordances (💬, +) are drawn at opacity .4-.55 by design: icons, not text; PRE-EXISTING on every look (and v0.28.0)',
    test: (e) => /^(button\.chat-bubble-btn\.chat-bubble-empty|button\.reaction-add-btn\.reaction-add-btn-mini)$/.test(e.sig) },
  { id: 'chip-initials', min: 2.8, why: 'the 18px initials circle inside a solid win/loss chip: white on a translucent-white wash over the constant --win-fill / --loss-fill (no theme sets them); PRE-EXISTING; DI UN-T7 deferral — the chip carries the check/cross and the name',
    test: (e) => e.sig === 'span.dc-chip-init' },
  { id: 'drag-handle', min: 1.0, why: 'the ≡ grab handle on a matrix column header: --text-muted at opacity .4 over the accent fill; a decorative affordance; PRE-EXISTING',
    test: (e) => e.sig === 'span.col-drag-handle' },
  { id: 'pick-logo-name', min: 2.8, why: 'the team name beside a team logo is drawn at opacity .65 (.72rem); PRE-EXISTING; recommended follow-up: drop the opacity',
    test: (e) => e.sig === 'span.pick-btn-logo-name' },
  { id: 'rank-medals', min: 1.0, why: 'the gold / silver / bronze medal numerals in the Standings rank column read the school --gold, which is cream/white for Oklahoma and Arkansas (1.01:1) and 1.98-2.26:1 elsewhere; PRE-EXISTING (identical on v0.28.0); a --gold-text read is the follow-up',
    test: (e) => /^td\.rank-[123]\.rank-cell$/.test(e.sig) },
  { id: 'blind-redaction-glyph', min: 3.4, why: 'the ••• redaction mark on a blind chip / blind matrix cell is --text-muted at opacity .85 (.dc-chip-blind, .pick-cell-blind): a mask, not content; PRE-EXISTING on every look',
    test: (e) => e.sig === 'span.dc-chip-pick' && e.text === '•••' || e.sig === 'td.pick-cell.pick-cell-blind' },
];
const sigOf = (n) => n.tag + (n.classes.size ? '.' + [...n.classes].sort().join('.') : '');
function evaluateFixture(key, side, html) {
  const r = R.resolveSide(sheet, key, side, 'system');
  const wrap = R.makeNode({ tag: 'div', classes: ['page-wrapper'], parent: r.body }); r.body.children.push(wrap);
  R.parseHtml(html, wrap);
  const out = [];
  R.walk(wrap, (n) => {
    if (n === wrap || !n.text) return;
    if (R.isHidden(sheet, n, r.ctx)) return;
    const colorV = R.computedProp(sheet, n, 'color', r.ctx);
    const fg = R.parseColor(colorV);
    const surfaces = R.paintedSurfaces(sheet, n, r.ctx);
    if (!fg || !surfaces) { out.push({ sig: sigOf(n), text: n.text, unresolved: !fg ? `color ${colorV}` : 'surface' }); return; }
    const op = R.opacityOf(sheet, n, r.ctx);
    let worst = 99, wsurf = null, wtext = null;
    for (const s of surfaces) {
      const text = R.compositeOver({ rgb: fg.rgb, a: fg.a * op }, s);
      const ratio = R.contrast(text, s);
      if (ratio < worst) { worst = ratio; wsurf = s; wtext = text; }
    }
    const px = R.fontPx(sheet, n, r.ctx), wt = R.fontWeight(sheet, n, r.ctx);
    out.push({ sig: sigOf(n), text: n.text, ratio: worst, floor: (px >= 24 || (px >= 18.66 && wt >= 700)) ? 3 : 4.5, surface: wsurf, textRgb: wtext });
  });
  return out;
}
{
  const { buildFixtures } = await import('./themefixtures.mjs');
  const F = await buildFixtures();
  const names = Object.keys(F);
  const empties = names.filter((n) => !F[n] || F[n].length < 100);
  assert(empties.length === 0, `[T11] fixture: all ${names.length} fixtures rendered (${empties.length ? 'EMPTY: ' + empties.join(', ') : names.join(', ')})`);
  // A1.10 (2026-10-01): + the Chat page in its REAL mount — #page-chat > .chat-surface > #chat-scroll, the day separator and the "NEW" divider
  const MARKERS = [['dashboard-compact-live', 'dc-chip-live'], ['dashboard-compact-final', 'dc-chip-win'], ['dashboard-matrix-live', 'pick-live-covering'], ['dashboard-matrix-live', 'pick-live-trailing'],
    ['dashboard-compact-open', 'dc-chip-blind'], ['control-center-pinned', 'cc-quick-seg'], ['control-center-pinned', 'Match my phone'],
    ['chat-page', 'id="page-chat"'], ['chat-page', '<div class="chat-surface"><div class="chat-scroll" id="chat-scroll">'], ['chat-page', 'chat-day-sep'], ['chat-page', 'chat-new-divider'], ['chat-page', 'chat-time'],
    ['chat-page', 'data-swipe-armed="true"']];
  const absent = MARKERS.filter(([n, m]) => !F[n].includes(m)).map(([n, m]) => `${n}:${m}`);
  assert(absent.length === 0, `[T11] fixture: the Final (win/loss chips), Live (covering/trailing, LIVE pill), Open (the dashed BLIND chip) states, the quick Light/Dark row and the Chat page in its real #page-chat > .chat-surface > #chat-scroll mount (day separator, "NEW" divider, timestamps) are all really on screen${absent.length ? ' — ABSENT ' + absent.join(', ') : ''}`);
  let evaluated = 0, unresolved = 0, inkPage = [];
  const failing = {};
  for (const { key, side, id } of SIDES) {
    for (const name of names) {
      for (const e of evaluateFixture(key, side, F[name])) {
        if (e.unresolved) { unresolved++; continue; }
        evaluated++;
        // THE PAPER GUARD: nothing may paint dark text on the ink page (a card-like container missing from PAPER_ROOTS)
        if (key === 'paper' && side === 'D' && R.relLuminance(e.surface) < 0.03 && R.relLuminance(e.textRgb) < 0.25) inkPage.push(`${name}: <${e.sig}> "${e.text.slice(0, 24)}"`);
        if (e.ratio < e.floor) {
          const rec = { ...e, side: id, fixture: name };
          const adv = T11_ADVISORIES.find((a) => a.test(rec) && e.ratio >= a.min);
          if (adv) (failing[adv.id] ??= new Set()).add(id);
          else { const u = (failing.__unnamed ??= new Map()); const k = `<${e.sig}> "${e.text.slice(0, 18)}"`; const cur = u.get(k) || { sides: new Set(), worst: 99, fixture: name }; cur.sides.add(id); cur.worst = Math.min(cur.worst, e.ratio); u.set(k, cur); }
        }
      }
    }
  }
  assert(evaluated > 12000, `[T11] fixture: ${evaluated} text elements evaluated across 20 sides (a vacuous run would evaluate none)`);
  assert(unresolved === 0, `[T11] every text colour and painted surface resolved through the cascade (${unresolved} unresolved — an image/unknown background would be skipped, never guessed)`);
  const un = [...(failing.__unnamed || new Map()).entries()].map(([k, v]) => `${v.fixture} ${k} on ${[...v.sides].join(',')} worst ${v.worst.toFixed(2)}`);
  assert(un.length === 0, `[T11] ZERO sub-threshold text outside the named advisories${un.length ? ' — ' + un.slice(0, 25).join(' | ') + (un.length > 25 ? ` (+${un.length - 25} more)` : '') : ''}`);
  assert(inkPage.length === 0, `[T11] Paper Dark: no element paints dark text on the ink page${inkPage.length ? ' — ' + inkPage.slice(0, 8).join(' | ') : ''}`);
  for (const adv of T11_ADVISORIES) {
    const hit = failing[adv.id];
    assert(!!hit && hit.size >= 1, `[T11] named advisory "${adv.id}" still fires (${hit ? [...hit].length + ' side(s)' : 'NOT FIRING — delete the entry; the list can only shrink'}) — ${adv.why}`);
  }
  // THE PAPER-ROOT GUARD (J1's failure mode): a card-like container missing from PAPER_ROOTS renders as a DARK card with light text — LEGIBLE, so the contrast checks above cannot see
  // it; it is the WRONG LOOK ("the cards are always the lightest thing on screen", Drew: ink page, light cards). This list is the DI's own, kept INDEPENDENT of the stylesheet's list on
  // purpose — if it were read from the CSS, removing a root from the CSS would silently remove it from the test too.
  {
    // A1.10 (2026-10-01): + 'chat-surface' — DI-442 moved the thread's card from .chat-scroll to .chat-surface (and `#page-chat .chat-scroll{background:none}`), so a
    // .chat-scroll root alone left the Paper Dark thread on a DARK card under paper-scope (Ink) text: .chat-day-sep / .chat-time 2.60:1.
    // v0.29.0 batch-5b integration (2026-10-01): 'layout-edit-strip' LEFT this list (and both scope lists in css/styles.css) WITH THE ELEMENT IT NAMED — SP-57 retired
    // .layout-edit-strip (layouttest SP57-c7), and DI-450 requires every listed root to exist ([T10]). Its successor, #layout-edit-bar, is a FULL-BLEED fixed bar under the
    // header (left:0;right:0), so by DI-450's rule (bounded, elevated containers are paper; chrome and full-bleed overlays are page context) it is NOT a paper root.
    const DI_PAPER_ROOTS = ['card', 'game-card', 'dc-game', 'week-status-card', 'info-box', 'api-url-box', 'player-tile', 'submit-bar', 'picks-week-nav', 'dashboard-scroll', 'stand-box', 'game-admin-card',
      'toast', 'modal', 'chat-scroll', 'chat-surface', 'chat-composer', 'chat-view-header', 'chat-sheet', 'chat-toast', 'chat-login-prompt', 'reaction-picker', 'comm-tabbar', 'avail-group', 'avail-filter-bar',
      'layout-toggle', 'lc-card', 'lc-codecard', 'league-standings-row', 'recap-blurb', 'week-banner', 'tiebreaker-card', 'pending-games-notice', 'effective-times-preview', 'picks-timing-info', 'cc-quick-track'];
    const r = R.resolveSide(sheet, 'paper', 'D', 'system');
    const seen = new Set(), dark = [];
    for (const name of names) {
      const wrap = R.makeNode({ tag: 'div', classes: ['page-wrapper'], parent: r.body }); r.body.children.push(wrap);
      R.parseHtml(F[name], wrap);
      R.walk(wrap, (n) => {
        const cls = DI_PAPER_ROOTS.filter((c) => n.classes.has(c));
        if (!cls.length || R.isHidden(sheet, n, r.ctx)) return;
        const surf = R.paintedSurfaces(sheet, n, r.ctx);
        if (!surf) return;
        cls.forEach((c) => seen.add(c));
        if (R.relLuminance(surf[0]) < 0.5) dark.push(`${name}: .${cls[0]} paints ${R.hex(surf[0])}`);
      });
    }
    assert(seen.size >= 10, `[T11] fixture: ${seen.size} of the DI's paper roots are really on screen in the fixtures (${[...seen].join(', ')}) — a guard that sees none would pass vacuously`);
    assert(dark.length === 0, `[T11] Paper Dark: every card-like root in the fixtures paints a LIGHT paper surface — a root missing from PAPER_ROOTS would be a dark card with light text (legible, wrong look)${dark.length ? ' — DARK: ' + [...new Set(dark)].slice(0, 6).join(' | ') : ''}`);
  }
  // The drawer on Paper Dark (F1): the drawer is PAGE context, so its rows read Marble on Ink with NO retarget; the quick row's track is a paper surface inside it
  {
    const r = R.resolveSide(sheet, 'paper', 'D', 'system');
    const wrap = R.makeNode({ tag: 'div', classes: ['page-wrapper'], parent: r.body }); r.body.children.push(wrap);
    R.parseHtml(F['control-center-pinned'], wrap);
    const find = (cls) => { let hit = null; R.walk(wrap, (n) => { if (!hit && n.classes.has(cls)) hit = n; }); return hit; };
    const ratioOf = (n) => { const fg = R.parseColor(R.computedProp(sheet, n, 'color', r.ctx)); const s = R.paintedSurfaces(sheet, n, r.ctx)[0]; return { fg, s, ratio: R.contrast(R.compositeOver(fg, s), s) }; };
    const label = find('cc-row-label'), name = find('cc-identity-name'), track = find('cc-quick-track'), seg = (() => { let h = null; R.walk(wrap, (n) => { if (!h && n.classes.has('cc-quick-seg') && n.attrs['aria-checked'] === 'false') h = n; }); return h; })();
    const L = ratioOf(label), N = ratioOf(name);
    assert(L.ratio > 13 && N.ratio > 13 && R.hex(L.s) === '#14110E', `[T11] Paper Dark drawer (F1 closed by construction): row labels and the identity name are Marble on Ink (${L.ratio.toFixed(1)}:1 on ${R.hex(L.s)}; DI: 14.8:1)`);
    const trackBg = R.hex(R.paintedSurfaces(sheet, track, r.ctx)[0]);
    const segR = ratioOf(seg);
    assert(trackBg === '#E8E4DC' && segR.ratio > 12, `[T11] …and the quick row's track is a PAPER surface inside the ink drawer (${trackBg}) with Ink segment text (${segR.ratio.toFixed(1)}:1)`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T16] DI-454: the status bar follows the chrome and the page — the real cascade through the real SB-08 tracker maths (js/status-bar.js)…');
// ═════════════════════════════════════════════════════════════════════════════════════
{
  const SB = await import('./js/status-bar.js');
  const rows = [];
  for (const k of ALL_THEME_KEYS) for (const side of ['L', 'D']) {
    const r = R.resolveSide(sheet, k, side, 'system');
    rows.push({ k, side, chrome: String(r.get('--chrome-bg') || '').trim(), page: String(r.get('--bg') || '').trim() });
  }
  assert(rows.length === 20 && rows.every((x) => /^#[0-9a-fA-F]{6}$/.test(x.chrome) && /^#[0-9a-fA-F]{6}$/.test(x.page)), `[T16] fixture: all 20 sides resolve --chrome-bg and --bg to literal colours through the real cascade (${rows.length} sides)`);
  const restLight = rows.filter((x) => SB.statusBarStyleFor(x.chrome) === 'LIGHT').map((x) => `${x.k}:${x.side}`);
  assert(restLight.length === 1 && restLight[0] === 'graphite:L',
    `[T16] DI-454: with the header under the clock, the glyph style is DARK glyphs ('LIGHT') on Graphite Light ALONE (white header) and white glyphs ('DARK') on Munera, Paper, Ink, all six schools and Graphite Dark, both sides (dark glyphs on: ${restLight.join(', ') || 'none'})`);
  const wrongPage = rows.filter((x) => SB.statusBarStyleFor(x.page) !== (x.side === 'L' ? 'LIGHT' : 'DARK')).map((x) => `${x.k}:${x.side} ${x.page}`);
  assert(wrongPage.length === 0, `[T16] DI-454 / A1.1: once the header has scrolled away the glyphs sit on the PAGE: dark glyphs on every Light page, white glyphs on every Dark one (A1.5: "dark on light looks and white on Night")${wrongPage.length ? ' — WRONG: ' + wrongPage.join(', ') : ''}`);
  const crimsonHdr = rows.filter((x) => x.side === 'L' && ['aggie', 'sooner', 'trojan', 'irish', 'boilermaker', 'razorback'].includes(x.k)).every((x) => SB.statusBarStyleFor(x.chrome) === 'DARK');
  assert(crimsonHdr && SB.statusBarStyleFor('#14110E') === 'DARK' && SB.statusBarStyleFor('#1C1C1E') === 'DARK' && SB.statusBarStyleFor('#8C1515') === 'DARK' && SB.statusBarStyleFor('#FFFFFF') === 'LIGHT',
    "[T16] the DI's named colours through the tracker's own maths: #FFFFFF -> LIGHT; crimson #8C1515, Ink #14110E, #1C1C1E and every school primary -> DARK");
  const flips = rows.filter((x) => x.side === 'L').filter((x) => SB.statusBarStyleFor(x.chrome) !== SB.statusBarStyleFor(rows.find((y) => y.k === x.k && y.side === 'D').chrome)).map((x) => x.k);
  assert(flips.length === 1 && flips[0] === 'graphite', `[T16] T6a: a Light<->Dark flip changes the header's glyph style on Graphite alone (${flips.join(', ') || 'none'}) — the one look whose --chrome-bg moves, which is why every flip re-syncs the chrome`);
  assert(/body\.native-shell::before\{[^}]*var\(--bg\)/.test(cssText) && !/body\.native-shell::before\{[^}]*--chrome-bg/.test(cssText),
    "[T16] A1.1: the band under the Dynamic Island is still the page-coloured soft edge (var(--bg)), never --chrome-bg — SB-08 O2b, Drew's pick, is not re-pointed");
}

// ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n[T17] A1.9 (the SP-52 review round): every value it set is pinned, measured on every surface it sits on, and the closed advisories cannot come back…');
// ═════════════════════════════════════════════════════════════════════════════════════
{
  const ratio = (a, b) => R.contrast(rgb(a), rgb(b));
  const fmt = (n) => n.toFixed(2);
  // F1 — every Dark accent-text value (three tokens x ten looks x BOTH triggers) clears 4.5:1 on the lifted Dark inset (#332C25), the thinnest surface it sits on
  for (const k of ALL_THEME_KEYS) {
    let worst = 99, worstTok = '';
    for (const trig of ['system', 'pinned']) {
      const r = R.resolveSide(sheet, k, 'D', trig);
      for (const tok of ['--maroon-text', '--maroon-mid-text', '--maroon-light-text']) for (const surf of ['--bg', '--bg-card', '--bg-card-alt', '--bg-game']) {
        const v = ratio(r.get(tok), r.get(surf));
        if (v < worst) { worst = v; worstTok = `${tok} on ${surf} (${trig})`; }
      }
    }
    assert(worst >= 4.5, `[T17] F1 ${k}:D: --maroon-text / -mid-text / -light-text clear 4.5:1 on the page, card, inset and game card under BOTH triggers (worst ${fmt(worst)}:1, ${worstTok})`);
  }
  {
    const A = R.resolveSide(sheet, 'neutral', 'D', 'system');
    assert(A.get('--maroon-text') === '#EA7272' && A.get('--maroon-mid-text') === '#EA7073' && A.get('--maroon-light-text') === '#E07879' && ratio(A.get('--maroon-text'), A.get('--bg-card-alt')) >= 4.5,
      `[T17] F1 the SB-06 matrix "ATS:" label's Munera Dark accent #EA7272 on the zebra inset #332C25 is ${fmt(ratio(A.get('--maroon-text'), A.get('--bg-card-alt')))}:1 (was 4.21 after the inset lift; 4.90 before it)`);
  }
  // F3a — Notre Dame Dark: the matrix header sub-label (.pts-label, .85 opacity) over the lifted navy fill
  {
    const r = R.resolveSide(sheet, 'irish', 'D', 'system');
    const fill = rgb(r.get('--maroon'));
    const inkTok = r.get('--on-accent-gold') || r.get('--gold-light');   // the consumer's own var(--on-accent-gold, var(--gold-light)) fallback — a missing token must FAIL here, not throw
    const shown = R.compositeOver({ rgb: rgb(inkTok), a: 0.85 }, fill);
    assert(r.get('--on-accent-gold') === '#E8BE45' && R.contrast(shown, fill) >= 4.5 && /\.pts-label\{[^}]*color:var\(--on-accent-gold,var\(--gold-light\)\)/.test(cssText),
      `[T17] F3a Notre Dame Dark: .pts-label reads --on-accent-gold #E8BE45 at .85 over the navy fill ${fmt(R.contrast(shown, fill))}:1 (was 4.26)`);
  }
  // F3b — Paper Light --maroon-light-text on the parchment page, white card and inset
  {
    const r = R.resolveSide(sheet, 'paper', 'L', 'system');
    const vs = ['--bg', '--bg-card', '--bg-card-alt'].map((s) => ratio(r.get('--maroon-light-text'), r.get(s)));
    assert(r.get('--maroon-light-text') === '#A6191C' && vs.every((v) => v >= 4.5), `[T17] F3b Paper Light --maroon-light-text #A6191C: ${vs.map(fmt).join(' / ')}:1 on the page / card / inset (page was 4.05)`);
  }
  // F3c / F3d — the Paper Dark scope, BOTH triggers, on every surface it sits on
  for (const trig of ['system', 'pinned']) {
    const r = R.resolveSide(sheet, 'paper', 'D', trig);
    const sn = paperScopeNode(r);
    const S = (n) => R.computedCustom(sheet, sn, n, r.ctx);
    const live = ['--bg-card', '--bg-card-alt', '--live-bg'].map((s) => ratio(S('--live-text'), S(s)));
    const nd = ['--bg-card', '--bg-card-alt', '--nd-bg'].map((s) => ratio(S('--nd-text'), S(s)));
    const lossTint = R.compositeOver({ rgb: [185, 28, 28], a: 0.15 }, rgb(S('--bg-card-alt')));   // .ob-net-me.net-negative's own hard-coded tint
    const loss = [['--bg-card', rgb(S('--bg-card'))], ['--bg-card-alt', rgb(S('--bg-card-alt'))], ['--loss-bg', rgb(S('--loss-bg'))], ['its 15% tint over the inset', lossTint]].map(([n, bg]) => [n, R.contrast(rgb(S('--loss')), bg)]);
    assert(S('--live-text') === '#C81E1E' && live.every((v) => v >= 4.5), `[T17] F3c Paper Dark scope (${trig}): --live-text #C81E1E is ${live.map(fmt).join(' / ')}:1 on the card / inset / --live-bg (card was 4.21, inset 3.81)`);
    assert(S('--nd-text') === '#6E5F50' && nd.every((v) => v >= 4.5), `[T17] F3d Paper Dark scope (${trig}): --nd-text #6E5F50 is ${nd.map(fmt).join(' / ')}:1 on the card / inset / --nd-bg (inset was 4.10)`);
    assert(S('--loss') === '#A81717' && loss.every(([, v]) => v >= 4.5), `[T17] F3d Paper Dark scope (${trig}): --loss #A81717 is ${loss.map(([n, v]) => fmt(v) + ' on ' + n).join(' / ')} (its tint over the inset was 4.02 at #B91C1C)`);
  }
  // F3e — .badge-draft reads the inset token; muted text on that inset clears 4.5:1 on every side
  {
    const bd = /\.badge-draft\{([^}]*)\}/.exec(cssText.replace(/\/\*[\s\S]*?\*\//g, ''));
    assert(!!bd && /background:var\(--bg-card-alt\)/.test(bd[1]) && !/#[0-9a-fA-F]{3,8}/.test(bd[1]), '[T17] F3e: .badge-draft paints var(--bg-card-alt) and carries no hard-coded colour');
    const worst = SIDES.map(({ key, side, id }) => {
      const r = R.resolveSide(sheet, key, side, 'system');
      let S = (n) => r.get(n);
      if (key === 'paper' && side === 'D') { const sn = paperScopeNode(r); S = (n) => R.computedCustom(sheet, sn, n, r.ctx); }
      return [id, ratio(S('--text-muted'), S('--bg-card-alt'))];
    }).sort((a, b) => a[1] - b[1])[0];
    assert(worst[1] >= 4.5, `[T17] F3e: the badge's text on its fill (--text-muted on --bg-card-alt) is >= 4.5:1 on all 20 sides (worst ${fmt(worst[1])}:1 on ${worst[0]}; the Dark dash was 2.38)`);
  }
  // THE CLOSED ADVISORIES CANNOT COME BACK: the lists hold exactly what A1.9 left, nothing re-added "just for now"
  assert(JSON.stringify(ADVISORIES.map((a) => a.id)) === JSON.stringify(['live-text-on-live-bg']) && JSON.stringify(ADVISORIES[0].sides.slice().sort()) === JSON.stringify(LIGHT_SIDES.slice().sort()),
    `[T17] [T4]'s advisory list is exactly ["live-text-on-live-bg"] on the ten LIGHT sides (deferred to ledger section 6 by A1.9) — ${JSON.stringify(ADVISORIES.map((a) => a.id))}`);
  assert(JSON.stringify(T11_ADVISORIES.map((a) => a.id)) === JSON.stringify(['faint-empty-glyphs', 'chip-initials', 'drag-handle', 'pick-logo-name', 'rank-medals', 'blind-redaction-glyph']),
    `[T17] [T11]'s advisory list is exactly the six PRE-EXISTING entries (identical on v0.28.0) — the five A1.9 closed are gone and stay gone: ${T11_ADVISORIES.map((a) => a.id).join(', ')}`);
  // F1/F2 — the dashcontrasttest guards: unmodified SB-06 rule, restored 3.74 floors, Paper Light's own 3.35 entries (a loosened constant there is red HERE, in another suite)
  {
    const dct = await import('./dashcontrasttest.mjs');
    const dsrc = fs.readFileSync(path.join(path.dirname(HTML_PATH), 'dashcontrasttest.mjs'), 'utf8');
    const KD = dct.KNOWN_DEBT;
    const m1 = KD['chat-hdr · game thread header — covering — matchup'], m2 = KD['chat-hdr · game thread header — covering — LIVE score'];
    const p1 = KD['chat-hdr · game thread header — covering — matchup @ Paper Light'], p2 = KD['chat-hdr · game thread header — covering — LIVE score @ Paper Light'];
    assert(m1 && m2 && m1.floor === 3.74 && m2.floor === 3.74 && JSON.stringify(m1.except) === '["paper"]' && JSON.stringify(m2.except) === '["paper"]',
      '[T17] F2: every look that existed before SP-52 keeps the 3.74 floor on the chat thread header\'s "covering — matchup" and "LIVE score" (Paper Light is carved out by name, not by loosening)');
    assert(p1 && p2 && p1.floor === 3.35 && p2.floor === 3.35 && JSON.stringify(p1.themes) === '["paper"]' && JSON.stringify(p2.themes) === '["paper"]',
      '[T17] F2: Paper Light has its OWN named entries at 3.35 (the parchment page cannot reach 4.5 with one token), limited to the "paper" map');
    assert(!('SP52_ADVISORIES' in dct) && !/advisoryFor/.test(dsrc), '[T17] F1: dashcontrasttest carries no advisory machinery at all — nothing left to excuse a role with');
    assert(/ok: rows\.length > 0 && rows\.every\(\(r\) => r\.ratio >= r\.floor\) \}/.test(dsrc) && dct.SB06_ROLES.length === 9,
      '[T17] F1: the SB-06 night-mode guard is the UNMODIFIED `rows.every((r) => r.ratio >= r.floor)` over all nine SB06_ROLES — a role in it can never be excused');
  }
}

// ── summary ──────────────────────────────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
