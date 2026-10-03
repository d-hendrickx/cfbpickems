/**
 * CFB Pickems — contrastscan.mjs (Reviewer BLOCK on d74286b, 2026-09-27, item 5)
 * ================================================================================
 * A NODE-side rendered-contrast APPROXIMATION for `body.theme-neutral` — light
 * mode and dark mode (`prefers-color-scheme: dark`) — parsed straight from
 * `css/styles.css`, never a hardcoded copy of the values. Precedent:
 * brandtokentest.mjs's own regex-based token extraction/WCAG math; this file
 * extends the same technique to every RULE in the file, not just the token
 * declarations.
 *
 * WHAT THIS IS PROVING
 * ---------------------
 * The reviewer's headless-Chrome scan on commit d74286b found two DISTINCT
 * failure shapes in dark mode:
 *   (A) A rule sets a `background`/`background-color` from a pale/tint token
 *       (--maroon-pale, --gold-pale, --nd-bg, --push-bg, --live-bg, etc.) but
 *       does NOT set its own `color:` — so the element renders with whatever
 *       `--text-primary` resolves to for that mode. In light mode that's Ink
 *       on a pale-pink/cream surface (fine); in dark mode, Phase 1 flipped
 *       `--text-primary` to Marble but left these pale/tint tokens UNCHANGED
 *       (light pale-pink), so the result was Marble-on-pale-pink at
 *       1.13-1.15:1 — a severe AA fail. THIS FILE's scan targets exactly this
 *       shape: for every rule with a resolvable background, it computes the
 *       EFFECTIVE text colour (the rule's own `color:` if set, else the
 *       resolved `--text-primary` for that mode) and asserts >= the WCAG
 *       floor for that selector's text size.
 *   (B) A rule sets `color:var(--maroon)` (or a sibling crimson/semantic
 *       token) directly, with no background of its own — plain crimson text
 *       on whatever's behind it. This shape is fixed STRUCTURALLY by the
 *       item-1 token-retarget (color:var(--maroon) -> color:var(--maroon-text),
 *       audited exhaustively in brandtokentest.mjs and re-verified here in
 *       section [3] below as a completeness grep — a rule that still reads a
 *       BASE crimson/semantic token as its own `color:` is a regression back
 *       to the exact defect this pass exists to close), not by this scanner's
 *       background-driven check, which cannot evaluate "whatever's behind it"
 *       without full layout/inheritance simulation.
 *
 * METHOD
 * ------
 *   1. Parse every `--name:value` custom-property declaration out of
 *      `:root`, `body.theme-neutral`, and BOTH dark blocks (the
 *      `@media(prefers-color-scheme:dark)` block and the
 *      `[data-color-scheme="dark"]` manual override — checked byte-identical
 *      to each other, same as brandtokentest.mjs's own [2c-a]/[2c-b]).
 *   2. Resolve LIGHT = :root merged with theme-neutral's own overrides.
 *      Resolve DARK = LIGHT merged with the dark block's own overrides (a
 *      dark block only redeclares a SUBSET; everything else falls through to
 *      LIGHT, exactly matching the real CSS cascade for an element that only
 *      matches `body.theme-neutral` and the dark trigger).
 *   3. Recursively resolve `var(--x, fallback)` chains to a literal hex (or
 *      `transparent`) in both maps — a value this can't resolve (a
 *      `linear-gradient(...)`, a `url(...)`) is SKIPPED, not asserted on; a
 *      false pass from an under-resolved rule is the acceptable failure mode
 *      for a heuristic static scanner, a false CATCH is not (this scanner
 *      never invents a value it can't derive from the file itself).
 *      REVIEWER BLOCK, round 2 (2026-09-27) — `rgba(r,g,b,a)` LITERALS are
 *      now resolved too (previously always skipped, the same "acceptable
 *      false pass" as above — until a translucent pill material shipped
 *      with a genuine dark-mode contrast failure hiding behind exactly that
 *      skip). An rgba() background is composited over the mode's own `--bg`
 *      (the realistic surface a `position:fixed` element actually floats
 *      above — not `--bg-card`, which assumes a card ancestor this class of
 *      element doesn't have) to a literal effective hex, then treated
 *      identically to every other resolved background from here on. Solid
 *      (`a>=1`) rgb()/rgba() literals convert directly, no compositing
 *      needed.
 *   4. Strip every `@media`/`@keyframes` block (brace-depth-aware, since a
 *      naive `[^}]*` regex stops at the FIRST inner `}`) and every comment.
 *      REVIEWER BLOCK, round 2 (2026-09-27) — `@supports` blocks are NO
 *      LONGER blindly discarded (the "at-rule blind spot" that let
 *      `.bottom-nav`'s @supports-gated backdrop-filter material through
 *      completely unscanned, in EITHER mode, the same shape as the original
 *      d74286b finding one level up the at-rule stack). Their INNER rule
 *      content is extracted separately (still brace-depth-aware) and
 *      appended back into the scan text as ordinary top-level rules — the
 *      `@supports (condition){` wrapper itself is discarded (never scanned
 *      as a fake selector), only what's INSIDE it is kept. `@media`/
 *      `@keyframes` are still fully discarded — a responsive/animation-
 *      scoped override cannot be reliably resolved against a single
 *      light/dark pair the way an unconditionally-reachable `@supports`
 *      enhancement can.
 *   5. Walk every remaining top-level `selector{body}` pair. For each one
 *      with a resolvable `background`/`background-color`, compute the
 *      effective text colour per the method in (A) above and assert
 *      contrast >= 4.5:1 (>= 3.0:1 for the enumerated LARGE_TEXT selectors
 *      below) in BOTH light and dark.
 *
 * MUTATION PROOF (per the reviewer's own instruction) — this file is run
 * TWICE from loadtest.mjs's own harness process against two DIFFERENT files:
 * once against `git show d74286b:cfb-pickems/css/styles.css` (checked out to
 * a scratch copy, read-only, never touching the working tree) — this MUST
 * fail (RED) on the seven cited classes — and once against the live,
 * currently-shipped `css/styles.css` — this MUST pass (GREEN). Both runs are
 * driven by the exported `scanFile()`/`runScan()` functions so the two
 * invocations share one code path; only the CSS SOURCE differs. The SAME
 * two-run discipline now also covers the round-2 finding: a THIRD scratch
 * source (the live file with `.bottom-nav`'s @supports rule's `background:`
 * reverted to the hardcoded `rgba(255,255,255,.72)` literal it shipped with
 * before round 2) is scanned and MUST fail dark mode on `.bottom-nav`
 * specifically — proving the extraction+compositing fix above actually
 * catches the exact defect it was built to catch, not just a differently-
 * shaped one.
 *
 * Run:  node contrastscan.mjs                (scans the live file, must be green)
 *       node contrastscan.mjs --prefix-proof  (scans d74286b's copy, must be RED)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import * as R from './themeresolve.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// WCAG contrast — the standard relative-luminance formula (byte-identical
// method to brandtokentest.mjs's own, reproduced here rather than imported,
// since this file must also run standalone against an out-of-tree scratch
// copy of an old commit's CSS with no guarantee the rest of the repo is at
// the same revision).
// ─────────────────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
function channelToLinear(c) {
  const cs = c / 255;
  return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
}
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channelToLinear(r) + 0.7152 * channelToLinear(g) + 0.0722 * channelToLinear(b);
}
export function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ─────────────────────────────────────────────────────────────────────────────
// Brace-depth-aware @-rule stripper. A naive `@media[^}]*\{[^}]*\}` regex only
// spans to the FIRST inner `}` (the first nested rule's close), leaving the
// rest of the block's real content to be misparsed as top-level rules — this
// walks the string counting `{`/`}` so the WHOLE block, however deeply
// nested, is removed as one unit.
// ─────────────────────────────────────────────────────────────────────────────
function stripAtRuleBlocks(css, prefixes) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    let matched = false;
    for (const prefix of prefixes) {
      if (css.startsWith(prefix, i)) {
        const braceStart = css.indexOf('{', i);
        if (braceStart === -1) break;
        let depth = 1;
        let k = braceStart + 1;
        while (k < n && depth > 0) {
          if (css[k] === '{') depth++;
          else if (css[k] === '}') depth--;
          k++;
        }
        i = k;
        matched = true;
        break;
      }
    }
    if (!matched) {
      out += css[i];
      i++;
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reviewer BLOCK, round 2 (2026-09-27) — the "@supports blind spot" fix.
// Same brace-depth walk as stripAtRuleBlocks() above, but for ONE prefix,
// and it KEEPS the inner content instead of discarding it — the at-rule's
// own condition text (`@supports (...) or (...)`) is discarded, only what
// sits between the outer `{`/`}` survives, concatenated across every match.
// Scoped to `@supports` only (not `@media`/`@keyframes`, which stay fully
// discarded by stripAtRuleBlocks() — see runScan()'s own comment for why
// those two are a different case). This file has exactly two real
// `@supports` blocks today (css/styles.css: `.bottom-nav`'s backdrop-filter
// material, `#page-chat.active`'s `not(height:100dvh)` fallback) — neither
// contains a NESTED @media/@keyframes/@supports, so a single non-recursive
// pass is sufficient; a future block that DID nest one would need this
// revisited, not silently mis-scanned (flagged here, not assumed away).
// ─────────────────────────────────────────────────────────────────────────────
function extractAtRuleBlockContents(css, prefix) {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    if (css.startsWith(prefix, i)) {
      const braceStart = css.indexOf('{', i);
      if (braceStart === -1) break;
      let depth = 1;
      let k = braceStart + 1;
      const contentStart = k;
      while (k < n && depth > 0) {
        if (css[k] === '{') depth++;
        else if (css[k] === '}') depth--;
        k++;
      }
      out += css.slice(contentStart, k - 1) + '\n';
      i = k;
    } else {
      i++;
    }
  }
  return out;
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Custom-property extraction — same technique as brandtokentest.mjs's
// extractVars(), generalized to capture ANY value (not just #hex), since a
// dark block's own declarations sometimes read var(--gold-light) rather than
// a literal hex (e.g. --gold-text:#E8C96A is literal, but a future edit could
// legitimately write --gold-text:var(--gold-light) instead — the resolver in
// resolveValue() below handles either shape identically).
// ─────────────────────────────────────────────────────────────────────────────
function extractDeclarations(cssText, selectorRegex) {
  const vars = {};
  const blockRe = new RegExp(`${selectorRegex}\\s*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = blockRe.exec(cssText))) {
    const body = m[1];
    const declRe = /--([a-zA-Z0-9-]+)\s*:\s*([^;]+?)\s*(?:;|$)/g;
    let d;
    while ((d = declRe.exec(body))) {
      vars[`--${d[1]}`] = d[2].trim();
    }
  }
  return vars;
}

// Reviewer BLOCK, round 2 (2026-09-27) — selectors this scanner is allowed
// to composite a TRANSLUCENT rgba() background for, against `--bg` (the
// mode's own page background). Deliberately a NAMED ALLOWLIST, not a global
// capability: this file's rgba() backgrounds are overwhelmingly small
// inline tints/badges/chips that sit on a CARD (`--bg-card`), not directly
// on the page — trying this composite against EVERY rgba() rule in the file
// was tried first and produced 12 new "failures" that were really just a
// WRONG backdrop assumption for elements that don't sit on `--bg` at all
// (e.g. `.badge-live-covering`, a chip inside a game card) — exactly the
// "invents a value it can't derive" failure mode this scanner's own doc
// comment forbids. `.bottom-nav` is the one genuine case: a
// `position:fixed` pill floating directly over page content, with no card
// ancestor, so `--bg` really is its backdrop. Add a selector here only when
// that same reasoning applies — not by default.
const TRANSLUCENT_COMPOSITE_SELECTORS = ['.bottom-nav'];

/** Composite an rgba(r,g,b,a) literal over an opaque hex backdrop, returning
 *  the resulting opaque hex — the same math a browser performs painting a
 *  translucent layer. Reviewer BLOCK, round 2 (2026-09-27). */
function compositeOverHex(r, g, b, a, backdropHex) {
  const bg = hexToRgb(backdropHex);
  const mix = (fg, bgc) => Math.round(fg * a + bgc * (1 - a));
  const rr = mix(r, bg.r), gg = mix(g, bg.g), bb = mix(b, bg.b);
  return '#' + [rr, gg, bb].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Resolve a raw CSS value (a var() chain, a literal hex, an rgb()/rgba()
 *  literal, or a recognized keyword) to a literal hex or 'transparent',
 *  against the given token map. Returns null when the value can't be
 *  resolved (gradients, url(), an unknown var(), a TRANSLUCENT rgba() whose
 *  selector isn't on TRANSLUCENT_COMPOSITE_SELECTORS) — the caller SKIPS
 *  rather than asserts on a null.
 *  `compositeAllowed` — Reviewer BLOCK, round 2 — true only when the CALLER
 *  (scanRules(), below) has already checked the current selector against
 *  TRANSLUCENT_COMPOSITE_SELECTORS; threaded through recursive var() calls
 *  unchanged so a token chain that bottoms out at an rgba() (e.g.
 *  `var(--nav-material)` -> `rgba(255,255,255,.72)`) inherits the SAME
 *  permission the top-level call was given, not a fresh (always-false)
 *  default. */
function resolveValue(raw, tokenMap, depth = 0, compositeAllowed = false) {
  if (raw == null || depth > 12) return null;
  const value = raw.trim();
  const varMatch = value.match(/^var\(\s*(--[a-zA-Z0-9-]+)\s*(?:,\s*([\s\S]+))?\)$/);
  if (varMatch) {
    const [, name, fallback] = varMatch;
    if (Object.prototype.hasOwnProperty.call(tokenMap, name)) {
      return resolveValue(tokenMap[name], tokenMap, depth + 1, compositeAllowed);
    }
    if (fallback !== undefined) return resolveValue(fallback, tokenMap, depth + 1, compositeAllowed);
    return null;
  }
  if (/^#[0-9A-Fa-f]{3,8}$/.test(value)) return value.length === 4
    ? '#' + [...value.slice(1)].map((c) => c + c).join('')
    : value.slice(0, 7);
  if (/^transparent$/i.test(value)) return 'transparent';
  if (/^#fff(fff)?$/i.test(value)) return '#FFFFFF';
  if (/^white$/i.test(value)) return '#FFFFFF';
  if (/^#000(000)?$/i.test(value)) return '#000000';
  if (/^black$/i.test(value)) return '#000000';
  // Reviewer BLOCK, round 2 (2026-09-27) — rgb()/rgba() literals, previously
  // ALWAYS skipped ("a value this can't resolve... is SKIPPED, not asserted
  // on"). An OPAQUE rgb()/rgba(...,1) converts directly regardless of
  // `compositeAllowed` (no compositing needed, no backdrop assumption made).
  // A TRANSLUCENT one only resolves when `compositeAllowed` is true (i.e.
  // the calling selector is on TRANSLUCENT_COMPOSITE_SELECTORS, above) —
  // composited over `--bg`, the realistic backdrop for the one class of
  // element that allowlist covers (a `position:fixed` chrome element with
  // no card ancestor). Everywhere else, an unresolvable translucent rgba()
  // is SKIPPED exactly as it always was pre-round-2.
  const rgbaMatch = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+))?\s*\)$/);
  if (rgbaMatch) {
    const [, rs, gs, bs, as] = rgbaMatch;
    const alpha = as !== undefined ? parseFloat(as) : 1;
    if (!(alpha >= 0 && alpha <= 1)) return null;
    if (alpha >= 1) {
      return '#' + [rs, gs, bs].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
    }
    if (!compositeAllowed) return null;
    const bgToken = tokenMap['--bg'];
    const backdropHex = bgToken ? resolveValue(bgToken, tokenMap, depth + 1, false) : null;
    if (!backdropHex || backdropHex === 'transparent') return null;
    return compositeOverHex(Number(rs), Number(gs), Number(bs), alpha, backdropHex);
  }
  return null; // linear-gradient(), url(), named colors we don't enumerate, etc.
}

/** Extract the FIRST value assigned to `background`/`background-color` in a
 *  rule body (never `border-color`/`box-shadow` etc. — the lookbehind rules
 *  those out the same way brandtokentest.mjs's audit already does for
 *  `color:`). Multi-layer backgrounds (comma-separated) take the first
 *  layer's color-like token only; anything with `url(`/`linear-gradient(` is
 *  left to resolveValue() to reject. */
function extractBackground(body) {
  const m = body.match(/(?<![a-zA-Z-])background(?:-color)?\s*:\s*([^;]+?)\s*(?:;|$)/);
  return m ? m[1] : null;
}
/** Same shape, for `color:` (never background-color/border-color/etc.). */
function extractColor(body) {
  const m = body.match(/(?<![a-zA-Z-])color\s*:\s*([^;]+?)\s*(?:;|$)/);
  return m ? m[1] : null;
}

// Selectors this scan treats as WCAG "large text" (>= 3.0:1 floor instead of
// 4.5:1) — enumerated explicitly, per the task's own instruction, rather than
// inferring font-size from the cascade (which this static scanner has no
// reliable way to do for inherited sizes). Empty today: every background-
// bearing class this pass touched renders small badge/label/body text, never
// a large heading — kept as a real list (not a comment) so a future rule
// that legitimately needs the 3.0 floor has somewhere to be added, reviewed,
// named.
const LARGE_TEXT_SELECTORS = [];

/** Walk every top-level `selector{body}` pair in the (already at-rule- and
 *  comment-stripped) CSS text and run the background/text contrast check
 *  against both token maps. Returns { checked, skipped, failures }. */
function scanRules(strippedCss, lightMap, darkMap) {
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  let checked = 0;
  let skipped = 0;
  const failures = [];
  while ((m = ruleRe.exec(strippedCss))) {
    const selector = m[1].trim();
    const body = m[2];
    if (!selector || !body.trim()) continue;
    const rawBg = extractBackground(body);
    if (!rawBg) continue; // this scan only fires on rules with their own background
    const rawColor = extractColor(body);

    // Reviewer BLOCK, round 2 (2026-09-27) — see TRANSLUCENT_COMPOSITE_SELECTORS'
    // own comment: only a named allowlist of selectors may resolve a
    // TRANSLUCENT rgba() background by compositing over --bg; every other
    // rgba() background is skipped exactly as it always was.
    const compositeAllowed = TRANSLUCENT_COMPOSITE_SELECTORS.some((s) => selector.includes(s));
    const lightBg = resolveValue(rawBg, lightMap, 0, compositeAllowed);
    const darkBg = resolveValue(rawBg, darkMap, 0, compositeAllowed);
    if (!lightBg || !darkBg || lightBg === 'transparent' || darkBg === 'transparent') {
      skipped++;
      continue;
    }
    const lightText = rawColor ? resolveValue(rawColor, lightMap) : lightMap['--text-primary'];
    const darkText = rawColor ? resolveValue(rawColor, darkMap) : darkMap['--text-primary'];
    if (!lightText || !darkText) {
      skipped++;
      continue;
    }

    checked++;
    const floor = LARGE_TEXT_SELECTORS.some((s) => selector.includes(s)) ? 3.0 : 4.5;
    const lightRatio = contrastRatio(lightText, lightBg);
    const darkRatio = contrastRatio(darkText, darkBg);
    if (lightRatio < floor) {
      failures.push({ selector, mode: 'light', ratio: lightRatio, floor, text: lightText, bg: lightBg });
    }
    if (darkRatio < floor) {
      failures.push({ selector, mode: 'dark', ratio: darkRatio, floor, text: darkText, bg: darkBg });
    }
  }
  return { checked, skipped, failures };
}

/**
 * Parse a full styles.css source string into { lightMap, darkMap } for ONE theme key.
 * RE-DERIVED (SP-52 DI-456, 2026-10-01): this used to regex out `:root`, `body.theme-neutral` and the two night blocks of ONE theme — which is
 * exactly the per-theme gap that hid SB-10 (a `var()` on :root froze at <html>), and which stopped working at all when the Dark blocks became
 * enumerated selector LISTS (`body.theme-neutral:not(…), body.theme-ink:not(…) {`). It now asks the REAL cascade (themeresolve.mjs: specificity,
 * order, the media trigger, var() substituted on the declaring element) for the side's custom properties, so any of the TWENTY sides can be scanned.
 * The `light`/`dark` of a key are its Light side and its Dark side (System trigger; themetest [T3] proves the pinned trigger resolves identically).
 */
export function buildTokenMaps(cssSrc, key = 'neutral') {
  const sheet = R.parseSheet(cssSrc);
  const names = R.allCustomNames(sheet);
  const mapOf = (side) => { const r = R.resolveSide(sheet, key, side, 'system'); const out = {}; for (const n of names) { const v = r.get(n); if (v !== undefined) out[n] = v; } return out; };
  return { lightMap: mapOf('L'), darkMap: mapOf('D') };
}

/** Full scan of one CSS source string. Returns the scanRules() result plus
 *  the token maps used, for callers that want to inspect specific tokens. */
export function runScan(cssSrc, key = 'neutral') {
  const { lightMap, darkMap } = buildTokenMaps(cssSrc, key);
  // ORDER FIX (reviewer follow-up, 2026-09-27) — comments MUST be stripped
  // BEFORE at-rule blocks are stripped, not after. stripAtRuleBlocks() scans
  // the raw string for the literal substring "@media"/"@supports"/
  // "@keyframes" at ANY position, oblivious to whether that position is
  // inside a comment — and this file's OWN prose elsewhere in styles.css
  // discusses "@media(max-width:480px)" and similar by name inside a
  // comment (e.g. styles.css:519). Stripping at-rules first meant that
  // comment's "@media" was treated as a REAL at-rule start; the stripper
  // then hunted forward for the next literal `{` (landing on some unrelated
  // real rule's opening brace, since the comment itself has none right
  // there) and depth-counted from THAT point, silently swallowing every
  // real rule in between as "inside the media block" — including
  // `.submit-bar`, which sat inside the swallowed range and was never
  // handed to scanRules() at all (not a resolver failure — the rule never
  // reached the resolver to begin with). Comments-first removes the false
  // trigger structurally, the same fix shape as brandtest.mjs's own
  // stripComments-before-scanning discipline for its SCRIBE/MunerAI guard.
  const withoutComments = stripComments(cssSrc);
  // Reviewer BLOCK, round 2 (2026-09-27) — the "@supports blind spot" fix.
  // Extract @supports blocks' INNER content BEFORE the general at-rule strip
  // discards the whole block — appended back as ordinary top-level rules
  // (their own `@supports (...)` condition text is never scanned as a fake
  // selector). `@media`/`@keyframes` are still fully discarded by
  // stripAtRuleBlocks() below, unchanged — see this function's own header
  // comment for why those two stay excluded.
  const supportsInner = extractAtRuleBlockContents(withoutComments, '@supports');
  const clean = stripAtRuleBlocks(withoutComments, ['@media', '@supports', '@keyframes']);
  const result = scanRules(clean + '\n' + supportsInner, lightMap, darkMap);
  return { ...result, lightMap, darkMap };
}

// ═════════════════════════════════════════════════════════════════════════════
// CLI / test-harness entry point
// ═════════════════════════════════════════════════════════════════════════════
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  let pass = 0, fail = 0;
  function assert(cond, label) {
    if (cond) { pass++; console.log('  ✅', label); }
    else { fail++; console.error('  ❌', label); }
  }

  const prefixProof = process.argv.includes('--prefix-proof');

  console.log(prefixProof
    ? '\n[contrastscan] PREFIX-PROOF MODE — scanning d74286b\'s styles.css (must find the seven-class failure)…'
    : '\n[contrastscan] scanning the live css/styles.css (must be green)…');

  let cssSrc;
  if (prefixProof) {
    const show = spawnSync('git', ['show', 'd74286b:cfb-pickems/css/styles.css'], {
      cwd: path.resolve(root, '..'), encoding: 'utf8', maxBuffer: 1024 * 1024 * 20,
    });
    assert(show.status === 0 && show.stdout.length > 0,
      `[pre] git show d74286b:cfb-pickems/css/styles.css succeeded (status ${show.status}, ${show.stdout.length} bytes) — read-only, never touches the working tree`);
    cssSrc = show.stdout;
  } else {
    cssSrc = await readFile(path.join(root, 'css', 'styles.css'), 'utf8');
  }

  const { checked, skipped, failures, lightMap, darkMap } = runScan(cssSrc);
  console.log(`  [info] ${checked} background-bearing rules checked, ${skipped} skipped (unresolvable value — gradient/rgba/url/unknown var), ${failures.length} failing pairs`);

  assert(checked > 100, `[1] a non-trivial number of rules were actually checked (got ${checked}) — a near-zero count would mean the parser found nothing, making every assertion below vacuous`);

  const NAMED_SEVEN = [
    '.team.team-picked',
    '.game-card.alma-mater .game-card-header',
    '.week-banner',
    '.tiebreaker-card',
    '.chat-mine .chat-bubble',
    '.chat-reveal',
    '.suggested-slate-box',
  ];

  // Reviewer follow-up (2026-09-27, eed1d62) — four more surfaces with a
  // hardcoded `background:#fff`, same root cause, same commit range (the
  // bug predates eed1d62 too — the ORDER FIX above is what makes the
  // scanner able to see `.submit-bar` at all; it was silently swallowed by
  // the at-rule stripper before that fix, never reaching scanRules()).
  // Counted separately from NAMED_SEVEN so a future reader can tell the two
  // review passes apart in the output.
  const NAMED_FOUR_FIXED_WHITE_BG = ['.bottom-nav', '.toast', '.modal', '.submit-bar'];

  if (prefixProof) {
    // MUST be RED — the reviewer's own reproduction of the pre-fix defect.
    const darkFails = failures.filter((f) => f.mode === 'dark');
    const failedSelectors = new Set(darkFails.map((f) => f.selector));
    for (const sel of NAMED_SEVEN) {
      assert(failedSelectors.has(sel),
        `[prefix-proof] ${sel} correctly FAILS dark-mode contrast on d74286b (the un-fixed commit) — reproduces the reviewer's own finding`);
    }
    for (const sel of NAMED_FOUR_FIXED_WHITE_BG) {
      assert(failedSelectors.has(sel),
        `[prefix-proof] ${sel} correctly FAILS dark-mode contrast on d74286b (a hardcoded background:#fff predating this commit too) — reproduces the reviewer's eed1d62 follow-up finding`);
    }
    assert(darkFails.length >= NAMED_SEVEN.length + NAMED_FOUR_FIXED_WHITE_BG.length,
      `[prefix-proof] at least ${NAMED_SEVEN.length + NAMED_FOUR_FIXED_WHITE_BG.length} dark-mode failures found on d74286b (got ${darkFails.length}) — the scanner catches the real defect, not a narrower symptom of it`);
    // Sanity: light mode must NOT be broken on the old commit — proves the
    // scanner isn't just failing everything indiscriminately.
    const lightFailsOnNamed = failures.filter((f) => f.mode === 'light' && NAMED_SEVEN.includes(f.selector));
    assert(lightFailsOnNamed.length === 0,
      '[prefix-proof] none of the seven classes fail in LIGHT mode on d74286b — confirms this is a dark-mode-specific regression the scanner isolates correctly, not a blanket failure');
  } else {
    // MUST be GREEN — the live, fixed file.
    for (const sel of NAMED_SEVEN) {
      const hit = failures.find((f) => f.selector === sel);
      assert(!hit, `[live] ${sel} passes contrast in both light and dark (${hit ? `FAILED ${hit.mode} at ${hit.ratio.toFixed(2)}:1, floor ${hit.floor}:1` : 'clean'})`);
    }
    for (const sel of NAMED_FOUR_FIXED_WHITE_BG) {
      const hit = failures.find((f) => f.selector === sel);
      assert(!hit, `[live] ${sel} passes contrast in both light and dark (${hit ? `FAILED ${hit.mode} at ${hit.ratio.toFixed(2)}:1, floor ${hit.floor}:1` : 'clean'})`);
    }

    // ── Round 2 (2026-09-27) — `.bottom-nav`'s glass material, RED before /
    //    GREEN after, per the reviewer's own explicit instruction. Not a
    //    git-checkout of an old commit (there is no such commit — this is
    //    THIS session's own live source) — a pure in-memory string mutation
    //    of the CURRENT file, reverting `.bottom-nav`'s @supports rule back
    //    to the hardcoded `rgba(255,255,255,.72)` it shipped with before this
    //    fix. No working-tree file is read a second time, written, or
    //    restored — the CLAUDE.md git-mutation-testing hazard (accidental
    //    loss of uncommitted work via checkout/restore) simply cannot apply
    //    to a `.replace()` on a string already in memory. */
    {
      const mutatedOldMaterial = cssSrc.replace(
        '.bottom-nav{background:var(--nav-material);',
        '.bottom-nav{background:rgba(255,255,255,.72);'
      );
      assert(mutatedOldMaterial !== cssSrc,
        '[pill-material-mutation] sanity: the mutation target string was found and replaced (the assertion below would be vacuous otherwise)');
      const mutatedResult = runScan(mutatedOldMaterial);
      const mutatedNavDarkFail = mutatedResult.failures.find((f) => f.selector === '.bottom-nav' && f.mode === 'dark');
      assert(!!mutatedNavDarkFail,
        `[pill-material-mutation] RED before: reverting .bottom-nav's material to the old hardcoded rgba(255,255,255,.72) correctly FAILS dark-mode contrast${mutatedNavDarkFail ? ` (${mutatedNavDarkFail.ratio.toFixed(2)}:1 on ${mutatedNavDarkFail.bg}, matching the reviewer's own ~#BDBCBB finding)` : ''} — the scanner catches the exact defect this pass fixed, not a narrower symptom of it`);
      const liveNavDarkFail = failures.find((f) => f.selector === '.bottom-nav' && f.mode === 'dark');
      assert(!liveNavDarkFail,
        '[pill-material-mutation] GREEN after: the LIVE file (var(--nav-material), mode-aware) passes the identical check the mutated copy just failed');
    }

    // A blanket "zero failures across the whole file" floor is NOT the right
    // bar here: this is a HEURISTIC static scanner (no DOM, no real
    // cascade/inheritance simulation) and a container element with no text
    // of its own but child elements carrying their OWN explicit `color:`
    // (.bottom-nav, .modal, .toast, .google-g-mark's SVG, a toggle's
    // ::after knob) will always read as a "failure" here even though
    // nothing is actually broken — and several of those ALREADY read that
    // way in LIGHT mode too, proving the tool's limitation, not a real bug.
    // The bar that actually matters: dark mode must never make something
    // WORSE than light mode already is. A selector failing in BOTH modes is
    // a pre-existing condition this pass didn't create; a selector that
    // fails ONLY in dark is a genuine regression and must be justified by
    // name below, never silently swept in.
    const darkFails = failures.filter((f) => f.mode === 'dark');
    const lightFailSelectors = new Set(failures.filter((f) => f.mode === 'light').map((f) => f.selector));
    const newDarkOnly = darkFails.filter((f) => !lightFailSelectors.has(f.selector));

    // Reviewed individually (see the handoff report for the full triage):
    // structural/non-text-bearing elements this static scanner cannot tell
    // apart from real text.
    //
    // REVIEWER CORRECTION (2026-09-27, eed1d62 follow-up) — `.bottom-nav`,
    // `.toast` and `.modal` were WRONGLY on this list. `.bottom-nav`'s own
    // reasoning ("container; children carry their own color") was flatly
    // wrong — `.nav-item` DOES set its own color, but that color FAILS
    // against a permanently-white bar in dark mode (3.26-3.67:1), which is
    // exactly the defect, not a reason to wave it through. `.toast`/`.modal`
    // were dismissed as "no dark-mode design exists for it yet" — true, but
    // that was the SAME hardcoded-`#fff`-background shape as every other
    // fix in this file, not a genuinely different, larger surface; leaving
    // them light was the bug, not a deliberate scope boundary. All three are
    // fixed (background:#fff -> var(--bg-card)) and removed from this list.
    // RE-DERIVED (SP-52, 2026-10-01): '.dc-chip-blind .dc-chip-init' LEFT this list — the entry claimed "no text", but the circle carries the player's
    // initials, and raising Dark --text-muted (its fill) would have left them at 2.33:1; that rule now reads color:var(--bg-card) and passes. Three
    // entries joined, each reviewed: the knob's ON state (same no-text artifact as its off state), the layout-edit section move button, and .badge-draft.
    // A1.9 (coordinator, 2026-10-01) CLOSED the last two, so the list SHRANK: '.section-move-btn' (F1: every Dark accent-text value is lifted until it clears 4.5:1 on the
    // lifted inset #332C25 — advisory 1 is withdrawn) and '.badge-draft' (F3e: it reads var(--bg-card-alt) instead of a hard-coded #F5F3EE, so its dash is no longer
    // light-on-light on a Dark side). Two assertions below PIN that they stay closed, so the allow-list can never quietly re-admit them.
    const KNOWN_NON_ISSUES = new Set([
      '.google-g-mark',   // Google's OAuth SVG mark, no text, governed by Google's own branding rules
      '.cc-row-switch::after', // a toggle switch's circular knob pseudo-element, no text
      '.cc-row-switch[data-on="true"]::after', // the same knob in its ON state (SP-52: now painted --on-accent so it stays visible on Graphite Dark's near-white track) — no text
    ]);
    for (const f of newDarkOnly) {
      const onList = KNOWN_NON_ISSUES.has(f.selector);
      assert(onList,
        onList
          ? `[live] ${f.selector}'s new dark-only reading (${f.ratio.toFixed(2)}:1 on ${f.bg}) is on the reviewed allow-list (known scanner artifact or an out-of-scope surface, see contrastscan.mjs's own comment) — not a genuine regression`
          : `[live] ${f.selector} is a NEW dark-only contrast failure (${f.ratio.toFixed(2)}:1 on ${f.bg}) NOT on the reviewed allow-list — this is a genuine, unreviewed regression`);
    }
    assert(!newDarkOnly.some((f) => f.selector === '.section-move-btn') && !newDarkOnly.some((f) => f.selector === '.badge-draft'),
      `[live] A1.9: '.section-move-btn' and '.badge-draft' are NOT dark-only failures any more (accent text lifted past 4.5:1 on the lifted inset; the badge reads --bg-card-alt) — and they are no longer on the allow-list, so a regression is red`);
    assert(!/\.badge-draft\{[^}]*background:#/i.test(cssSrc.replace(/\/\*[\s\S]*?\*\//g, '')) && /\.badge-draft\{background:var\(--bg-card-alt\)/.test(cssSrc),
      "[live] A1.9 F3e: .badge-draft's fill is the theme inset token, never a hard-coded colour");
    assert(newDarkOnly.length <= KNOWN_NON_ISSUES.size,
      `[live] no MORE new dark-only failures than the reviewed allow-list accounts for (got ${newDarkOnly.length} new, allow-list covers ${KNOWN_NON_ISSUES.size}) — a real regression must be named, not hidden by a loose count check`);

    // ── [2a] RE-DERIVED (SP-52 DI-456): every look, both sides — "dark mode must never make something WORSE than light mode already is", generalised
    //    to "no look may make something WORSE than the default look already is". Each of the TEN themes is scanned on its Light AND Dark side through the
    //    real cascade; a selector may fail on a look only if it also fails on Munera (the default) in the same mode, or is a named artifact.
    //    LIMIT, stated: Paper Dark's cards are re-lit by a scoped rule this rule-at-a-time scanner cannot model (it resolves Paper Dark's PAGE tokens);
    //    themetest [T4]/[T11] prove Paper Dark's paper surfaces.
    {
      const KEYS = ['neutral', 'paper', 'ink', 'graphite', 'aggie', 'sooner', 'trojan', 'irish', 'boilermaker', 'razorback'];
      // NON-TEXT artifacts this rule-at-a-time scanner reads as failures only where a look's accent fill is NEAR-WHITE or its bar is NEAR-BLACK: the rule
      // paints a fill but carries no text of its own (a 7px dot, a step dot, a switch track, the status strip, a hover state that inherits its base rule's
      // --on-accent label, and the tab-bar container whose children set their own colours — themetest [T4] measures the tab icons themselves).
      const ACCENT_FILL_NON_TEXT = ['.live-dot', '.week-wizard-step-dot', '.cc-row-switch', 'body.native-shell::before', '.btn-primary:hover', '.bottom-nav', '.lc-tick-on'];
      const base = runScan(cssSrc, 'neutral');
      const key = (f) => f.mode + '|' + f.selector;
      const baseSet = new Set(base.failures.map(key));
      let totalChecked = 0;
      for (const k of KEYS) {
        const r = runScan(cssSrc, k);
        totalChecked += r.checked;
        const worse = r.failures.filter((f) => !baseSet.has(key(f)) && !(k === 'paper' && f.mode === 'dark') && !ACCENT_FILL_NON_TEXT.some((n) => f.selector.includes(n)));
        assert(worse.length === 0,
          `[2a] ${k}: both sides scanned through the real cascade (${r.checked} rules) — no rule fails here that does not also fail on Munera in the same mode${worse.length ? ' — WORSE: ' + worse.slice(0, 5).map((f) => `${f.selector} ${f.mode} ${f.ratio.toFixed(2)}:1`).join(' | ') : ''}`);
      }
      assert(totalChecked > 1000, `[2a] fixture: ${totalChecked} rule-checks across the ten looks (a vacuous run would check none)`);
    }

    // ── [3] Completeness — item 1's token-retarget audit, source-level ──
    // A rule whose `color:` still reads a BASE crimson/semantic token
    // directly (never through its -text sibling) is the exact defect class
    // item 1 exists to close — re-verified here as a grep-shaped assertion,
    // not re-derived from the runtime scan above (which only fires on
    // background-bearing rules and would miss a bare `color:var(--maroon)`
    // with no background of its own, e.g. .nav-item.active). FOUR sites are
    // a REVIEWED, NAMED exception (not an oversight): .header-identity-avatar,
    // #notif-bell-badge, .chat-pill.active .chat-unread-dot and .cc-avatar
    // all pair crimson text with a background that does NOT change between
    // modes (--gold or a hardcoded #fff) — --maroon-text is deliberately
    // BRIGHTENED for dark mode, which would make contrast WORSE against an
    // unchanging surface, so these four correctly keep reading plain
    // --maroon (also unchanging) instead.
    const codeOnly = stripComments(cssSrc);
    const bareMaroonColor = (codeOnly.match(/(?<![a-zA-Z-])color:var\(--maroon\)/g) || []).length;
    const bareMaroonMidColor = (codeOnly.match(/(?<![a-zA-Z-])color:var\(--maroon-mid\)/g) || []).length;
    const bareNdColor = (codeOnly.match(/(?<![a-zA-Z-])color:var\(--nd\)/g) || []).length;
    const barePushColor = (codeOnly.match(/(?<![a-zA-Z-])color:var\(--push\)/g) || []).length;
    const bareLiveColor = (codeOnly.match(/(?<![a-zA-Z-])color:var\(--live\)/g) || []).length;
    // RE-DERIVED (SP-52 DI-448 C3, 2026-10-01): of the four reviewed exceptions, THREE paired crimson text with a --gold fill (.header-identity-avatar,
    // #notif-bell-badge, .cc-avatar) and now read --on-gold (Ink on every side: maroon-on-gold measured 3.96:1 on Munera Dark and 2.13:1 on Graphite Dark).
    // The fourth, .chat-pill.active .chat-unread-dot, pairs crimson with --on-accent (white; near-ink on Graphite Dark) and keeps reading --maroon.
    assert(bareMaroonColor === 1, `[3a] exactly ONE reviewed fixed-background exception still reads "color:var(--maroon)" directly — .chat-pill.active .chat-unread-dot (got ${bareMaroonColor})`);
    assert((codeOnly.match(/color:var\(--on-gold\)/g) || []).length >= 3 && /\.cc-avatar\{[^}]*color:var\(--on-gold\)/.test(codeOnly) && /\.notif-bell-badge[^}]*color:var\(--on-gold\)/.test(codeOnly),
      '[3a-b] the three gold-filled sites (.header-identity-avatar, .notif-bell-badge, .cc-avatar) read var(--on-gold)');
    assert(bareMaroonMidColor === 0, `[3b] zero remaining "color:var(--maroon-mid)" sites — got ${bareMaroonMidColor}`);
    assert(bareNdColor === 0, `[3c] zero remaining "color:var(--nd)" sites — got ${bareNdColor}`);
    assert(barePushColor === 0, `[3d] zero remaining "color:var(--push)" sites — got ${barePushColor}`);
    assert(bareLiveColor === 0, `[3e] zero remaining "color:var(--live)" sites — got ${bareLiveColor}`);
    const maroonTextCount = (codeOnly.match(/color:var\(--maroon-text\)/g) || []).length;
    assert(maroonTextCount >= 60, `[3f] at least 60 sites now read color:var(--maroon-text) (got ${maroonTextCount}) — the retarget landed, not just the removal`);
  }

  // Same summary-line shape brandtokentest.mjs/iconstest.mjs already use
  // (`✅ ALL PASS — N passed, M failed` / `❌ FAILURES — N passed, M failed`)
  // — loadtest.mjs's own spawned-subprocess registration parses exactly this
  // pattern; a different shape here would make this suite unregisterable.
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  // Same double-armed exit as brandtokentest.mjs/headermetatest.mjs (reviewer
  // F3/security F-6 precedent) — the write-then-exit callback is the fast
  // path; the unref'd timer is only a backstop if a pipe reader goes away
  // mid-write, so a hung suite can never stall loadtest.mjs's own sweep.
  process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));
  setTimeout(() => process.exit(fail === 0 ? 0 : 1), 8000).unref();
}
