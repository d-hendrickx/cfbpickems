/**
 * CFB Pickems — navtest.mjs
 * =========================
 * THE BOTTOM-NAV LAYOUT CONTRACT, and the defect class that was silently
 * eating it.
 *
 * Filed as bug B-a (session "iOS Munera", 2026-09-19): "bottom nav floats
 * mid-screen in the installed app" — the long-open §6 row. It matters now
 * because the app is about to be wrapped in a Capacitor WKWebView shell,
 * where the same layout defect would be front and centre.
 *
 * Run:  node navtest.mjs
 * Both timezones, like every other suite (this file reads no clock, but the
 * sweep is uniform):
 *   for tz in UTC America/Los_Angeles; do TZ=$tz node navtest.mjs; done
 *
 * §7 DRIVES A REAL BROWSER. It looks for a Chromium-family app in /Applications;
 * if there is none it FAILS LOUDLY rather than skipping, because a layout guard
 * that quietly does nothing is not a guard — and loadtest.mjs spawns this file,
 * so the failure reaches everyone. Point it somewhere else with:
 *
 *   NAVTEST_ENGINE=/path/to/Chromium node navtest.mjs
 *   NAVTEST_ENGINE=/path/to/Chromium node loadtest.mjs     (same, via the spawn)
 *
 * The browser only lays out fixtures built from this repo's own CSS and markup;
 * it loads nothing from the network (no fonts, no config, no backend).
 *
 * Precedent: grouptest.mjs / atstest.mjs / gradetest.mjs / synctest.mjs — a
 * focused standalone suite beside loadtest.mjs, spawned by it (section [82]).
 *
 * ── WHAT THE OFF-DEVICE REPRODUCTION ACTUALLY FOUND (2026-09-19) ────────────
 * B-a itself did NOT reproduce off-device. The real css/styles.css was laid
 * out at 393x852 in TWO engines — Blink 152 and macOS WKWebView, the same
 * engine family a Capacitor shell uses — with zero safe-area insets AND with
 * the installed app's insets substituted in (top 59px, bottom 34px), on a long
 * page and a short page, with .page-wrapper both auto-height and height-
 * constrained, at four scroll offsets each. `.bottom-nav` was pinned with
 * gapBelowNav === 0 in EVERY measurement. So the drift is not in the CSS
 * arithmetic and not in the containing-block chain as a spec-conformant engine
 * evaluates it; B-a stays OPEN and needs a device. See the RG row.
 *
 * What that reproduction DID turn up is a defect CLASS that had been eating
 * declarations in this stylesheet, unreported, including two in the bottom
 * nav's own layout contract. CSS Values & Units L4 §10.1: the `+` and `-`
 * operators inside calc() MUST be surrounded by whitespace. Without it the
 * expression is invalid — and when the expression also contains var(), it is
 * "invalid at computed-value time", which is WORSE than a parse error:
 *
 *   • the declaration is NOT dropped at parse time, so it looks live in the
 *     source and it wins the cascade;
 *   • at computed-value time every longhand it sets falls back to its INITIAL
 *     value — not to the previous valid declaration for that property;
 *   • so `padding: 7px; padding: 0 14px calc(var(--nav-height)+20px)` computes
 *     to padding 0 on all four sides. The earlier, correct value is destroyed.
 *
 * All three bullets were measured in WKWebView, not inferred (harness A/B:
 * #a unspaced+var -> 0/0/0/0, #b spaced control -> 0/14/80/14, #f
 * `padding:7px` then the bad shorthand -> 0/0/0/0).
 *
 * The two live instances, both on the nav. Named by SELECTOR, not by line
 * number — the pre-fix line numbers this header used to cite (99 and 316) had
 * already rotted by the time the fix's own comments were added:
 *
 *   .main-content{padding:0 var(--page-pad) calc(var(--nav-height)+20px)}
 *       The whole shorthand dead. This is THE rule that holds page content
 *       clear of the fixed nav and gives every page its side gutters. It
 *       survived only by luck: the safe-area @supports block re-declares
 *       padding-bottom validly, and a v14.1 "belt-and-suspenders" rule
 *       re-declares padding-left/right validly — but only inside
 *       @media(max-width:480px). So at EVERY width above 480px the app has had
 *       NO side padding at all (≥600px gained only padding-top:8px, never the
 *       gutters). Measured: 0px gutter at 520px, unaffected at 393px.
 *
 *   .submit-bar{bottom:calc(var(--nav-height)+8px)}
 *       The "sit 8px above the bottom nav" offset computes to 0 instead of 68px
 *       (measured against the spaced control). LATENT, not currently visible:
 *       position:sticky is independently inert here because .main-content sets
 *       overflow-x:hidden and so is a scroll container that never scrolls, so
 *       the bar does not stick at all today. Spacing the operator is what stops
 *       the bar sticking BEHIND the nav (z-index 100 vs. 50) the day that
 *       second, separately-reported defect is fixed.
 *
 * §1 is therefore the guard that matters: it fails on ANY invalid calc()
 * anywhere in the stylesheet, not just these two. §1c proves the scanner can
 * still see one (RG-27 — a guard that cannot detect its own removal is not
 * coverage).
 *
 * §5 closes a hole in loadtest [58]. That audit enumerates the ancestors of
 * .bottom-nav from a HARDCODED four-selector list and checks them for
 * transform/filter/backdrop-filter/perspective/will-change/contain. It never
 * checked `overflow` — and `overflow` other than visible is the single most
 * commonly reported cause of position:fixed drift on iOS. §5 derives the real
 * ancestor chain from index.html and checks the full property set, and it
 * RECORDS .page-wrapper's overflow-x:hidden as a known, asserted fact rather
 * than asserting it away, because the measurement above showed it does not
 * cause the drift in either engine.
 *
 * ── B-c / RG-188 (2026-09-19): §6 + §7, and a REAL ENGINE IN THE SUITE ──────
 * The "second, independent defect" the §3 note above deferred is bug B-c:
 * `.submit-bar` NEVER PINS. On a long slate the player has to scroll to the
 * very bottom of the page to reach Submit — a defect on the pick-filing
 * critical path, on the web as well as on iOS.
 *
 * Root cause, measured (Blink 153 + macOS WKWebView, both at 393x852):
 * `body`, `.page-wrapper` and `.main-content` each declared `overflow-x:hidden`.
 * Per CSS Overflow 3, `hidden` on one axis forces the other axis's `visible` to
 * compute to `auto`, so all three became SCROLL CONTAINERS — and all three are
 * content-height boxes that never scroll (measured scrollHeight === clientHeight
 * on each). `position:sticky` resolves against the nearest scrollport, so the
 * bar's sticky rectangle was a box that never moved: it rendered at its flow
 * position at every scroll offset. Nothing was wrong with the bar's own rule.
 * This is the same mechanism as RG-17 (chat) and RG-16 (loud-fail banner); the
 * Testing Protocol step 14 exists because of it. It had claimed three victims:
 * `.submit-bar`, `.app-header` and `.comm-tabbar`.
 *
 * Fix: `overflow-x: hidden; overflow-x: clip` on those three selectors.
 * `clip` clips exactly like `hidden` but is explicitly NOT a scroll container,
 * so `overflow-y` stays `visible` and the viewport is once again the nearest
 * scrollport. The `hidden` declaration is kept FIRST as the cascade fallback for
 * any engine without `clip` (Safari <16 / Chrome <90) — those engines keep
 * today's behaviour rather than gaining a sideways scroll. The project's floor
 * is iOS 16.4, so every real device gets `clip`.
 *
 * SCOPE, stated because a test now pins it: reviving the scrollport also
 * revives `.app-header`'s and `.comm-tabbar`'s sticky, neither of which is the
 * reported bug and both of which would change what all six players see on
 * every page. Both are therefore held at `position:relative` — the exact
 * behaviour they have today (a sticky that never sticks renders identically to
 * relative, and relative keeps their z-index applying, which `static` would
 * not). Reviving either is Drew's call, one declaration each. §6/§7 assert the
 * hold so it cannot lapse unnoticed in either direction.
 *
 * §7 is the part that could not be faked: a REAL LAYOUT ENGINE, driven over the
 * DevTools protocol at an exact 393x852 viewport, scrolled, with rects read out
 * of it. Source assertions cannot see this defect class at all — the CSS said
 * `position:sticky` the whole time it wasn't sticking. Two details that cost an
 * hour and are worth keeping: `html{scroll-behavior:smooth}` means scrollTo()
 * must pass `behavior:'instant'` or every measurement reads the pre-animation
 * position (0), and `--dump-dom` + `--virtual-time-budget` hangs on this page,
 * so the harness attaches to a page target instead.
 */

import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

const here = fileURLToPath(new URL('.', import.meta.url));
const cssSrc = readFileSync(here + 'css/styles.css', 'utf8');
const htmlSrc = readFileSync(here + 'index.html', 'utf8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}

// SB-08 (2026-09-30) — a minimal PNG reader for §7k's PAINTED-pixel check.
// No dependency: 8-bit RGB/RGBA, non-interlaced (what Chromium's
// Page.captureScreenshot emits), all five scanline filters. §7k samples what
// the engine actually PAINTED in the top safe-area band, because the thing
// under test is a pseudo-element (::before) with pointer-events:none — it is
// invisible to elementsFromPoint() and has no getBoundingClientRect(), so a
// DOM-geometry check cannot see it at all. Pixels are the only honest probe.
function decodePng(buf) {
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0;
  const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || (ctype !== 6 && ctype !== 2) || interlace !== 0) throw new Error(`decodePng: unsupported PNG (depth ${depth}, color type ${ctype}, interlace ${interlace})`);
  const bpp = ctype === 6 ? 4 : 3, stride = w * bpp;
  const raw = inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)], src = y * (stride + 1) + 1, row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[row + x - bpp] : 0;
      const b = y > 0 ? out[row - stride + x] : 0;
      const c = x >= bpp && y > 0 ? out[row - stride + x - bpp] : 0;
      let v = raw[src + x];
      if (ft === 1) v += a;
      else if (ft === 2) v += b;
      else if (ft === 3) v += (a + b) >> 1;
      else if (ft === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[row + x] = v & 255;
    }
  }
  return { w, h, px: (x, y) => { const i = y * stride + x * bpp; return [out[i], out[i + 1], out[i + 2]]; } };
}

// SB-08 — every colour in a computed value, in order, as [r,g,b,a] (0..255,
// alpha 0..1). Chromium reports a resolved color-mix() as `color(srgb r g b /
// a)` with 0..1 channels and plain colours as rgb()/rgba().
function cssColors(str) {
  const out = [];
  const re = /rgba?\(([^)]*)\)|color\(\s*srgb\s+([^)]*)\)/g;
  let m;
  while ((m = re.exec(String(str || '')))) {
    if (m[1] != null) {
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      out.push([p[0], p[1], p[2], p[3] ?? 1]);
    } else {
      const p = m[2].split(/[\s/]+/).filter(Boolean).map(Number);
      out.push([p[0] * 255, p[1] * 255, p[2] * 255, p[3] ?? 1]);
    }
  }
  return out;
}
// A custom property's computed value is the authored token (#8C1515), not rgb().
function parseHex(str) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(str || '').trim());
  return m ? [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1) : null;
}
// WCAG relative luminance / contrast, for §7l's glyph-legibility sweep.
const linC = c => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lumOf = ([r, g, b]) => 0.2126 * linC(r) + 0.7152 * linC(g) + 0.0722 * linC(b);
const contrastOf = (a, b) => { const x = lumOf(a), y = lumOf(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

// ── the calc() validator ────────────────────────────────────────────────────
// Pull each calc(...) out with balanced-paren scanning (a regex cannot do
// nested var()/env()/calc()), then mask every IDENTIFIER — including
// --custom-props, unit suffixes and function names — down to a single letter,
// so that the hyphens inside `--nav-height` and `safe-area-inset-bottom` can
// never be mistaken for the minus operator. Whatever + or - survives masking
// is a real operator and must have whitespace on both sides.
function findCalcs(text) {
  const out = [];
  let i = 0;
  while ((i = text.indexOf('calc(', i)) !== -1) {
    let depth = 0, j = i + 4;
    for (; j < text.length; j++) {
      if (text[j] === '(') depth++;
      else if (text[j] === ')') { depth--; if (depth === 0) break; }
    }
    if (depth !== 0) { i += 5; continue; }   // unbalanced — leave it to §2
    out.push(text.slice(i, j + 1));
    i = j + 1;
  }
  return out;
}
const maskIdents = s => s.replace(/--?[a-zA-Z][a-zA-Z0-9-]*/g, 'I');

/** Every calc() in `css` whose + or - lacks whitespace on both sides. */
function invalidCalcs(css) {
  const found = [];
  css.split('\n').forEach((line, idx) => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('/*') || t.startsWith('//')) return;  // prose
    for (const raw of findCalcs(line)) {
      const masked = maskIdents(raw.slice(5, -1));
      for (let k = 0; k < masked.length; k++) {
        const ch = masked[k];
        if (ch !== '+' && ch !== '-') continue;
        // A sign is UNARY (and needs no surrounding whitespace) when the
        // nearest preceding non-space character is the start of the
        // expression, an opening paren, a comma, or another operator —
        // calc(-1 * x), calc(2 * -1px), calc(x - -1px).
        let p = k - 1;
        while (p >= 0 && /\s/.test(masked[p])) p--;
        const prevSignificant = p >= 0 ? masked[p] : undefined;
        if (prevSignificant === undefined || '(,*/+-'.includes(prevSignificant)) continue;
        const before = masked[k - 1], after = masked[k + 1];
        if (!/\s/.test(before ?? ' ') || !/\s/.test(after ?? ' ')) {
          found.push({ line: idx + 1, expr: raw });
          break;
        }
      }
    }
  });
  return found;
}

// Rule matching runs against a COMMENT-STRIPPED copy. This file's own comments
// quote rules verbatim (".main-content{overflow-x:hidden}" appears in three
// historical notes in styles.css), and a selector audit that reads prose reports
// offenders that do not exist — which is exactly what happened while RG-188 was
// being written. Comments are still searched deliberately, by name, where a
// section wants to prove a note is present.
const cssRules = cssSrc.replace(/\/\*[\s\S]*?\*\//g, '');

/** All rule bodies for an exact selector, anywhere in the sheet (comments excluded). */
function ruleBodies(selector) {
  const escaped = selector.replace(/[.#]/g, ch => '\\' + ch);
  const re = new RegExp(`(^|[^a-zA-Z0-9_.#-])${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const out = [];
  let m; while ((m = re.exec(cssRules))) out.push(m[2]);
  return out;
}

// ── [1] THE ROOT-CAUSE GUARD: no silently-dropped declarations ──────────────
console.log('\n[1] calc() whitespace — no declaration in styles.css is invalid at computed-value time…');
{
  const bad = invalidCalcs(cssSrc);
  const detail = bad.map(b => `styles.css:${b.line}  ${b.expr}`).join('\n      ');
  assert(bad.length === 0,
    `every calc() in css/styles.css surrounds its + / - with whitespace, so no declaration is silently invalid at computed-value time (found ${bad.length}${bad.length ? ':\n      ' + detail : ''})`);

  // [1b] The two instances B-a's reproduction found, pinned by name, so the
  // fix cannot be half-applied and so the class guard above cannot be
  // satisfied by deleting the rules instead of spacing them.
  const mainPad = ruleBodies('.main-content')[0] || '';
  assert(/padding\s*:/.test(mainPad),
    '.main-content still declares a padding shorthand (the nav-clearance + side-gutter rule was not deleted)');
  assert(invalidCalcs(mainPad).length === 0,
    `.main-content's padding shorthand uses a VALID calc, so all four longhands survive to computed-value time (body: ${mainPad.trim()})`);

  const submitBar = ruleBodies('.submit-bar')[0] || '';
  assert(/position\s*:\s*sticky/.test(submitBar), '.submit-bar is still position:sticky (rule not deleted)');
  assert(/bottom\s*:/.test(submitBar), '.submit-bar still declares a bottom offset');
  assert(invalidCalcs(submitBar).length === 0,
    `.submit-bar's bottom offset uses a VALID calc, so it resolves to a real length instead of falling back to 0 (body: ${submitBar.trim()})`);

  // [1c] FIXTURE / ANTI-VACUITY (RG-27): the scanner must still be able to
  // see a bad calc. Without this, spacing every calc in the sheet and then
  // breaking the scanner would read as a pass.
  const probe = `.probe{padding:0 var(--page-pad) calc(var(--nav-height)+20px)}`;
  assert(invalidCalcs(probe).length === 1,
    "fixture: the scanner still flags the exact pattern .main-content's padding shorthand shipped with — calc(var(--nav-height)+20px)");
  assert(invalidCalcs(`.p{bottom:calc(60px+8px)}`).length === 1,
    'fixture: the scanner flags an unspaced + with no var() either');
  assert(invalidCalcs(`.p{bottom:calc(100dvh - var(--nav-height) - env(safe-area-inset-bottom,0px))}`).length === 0,
    'fixture: the scanner does NOT false-positive on hyphens inside --custom-props, env() keywords or unit suffixes');
  assert(invalidCalcs(`.p{width:calc(-1 * var(--page-pad))}`).length === 0,
    'fixture: a legal unary sign directly after ( is not flagged as an unspaced operator');
  assert(invalidCalcs(`.p{width:calc(100% -  var(--page-pad))}`).length === 0,
    'fixture: extra whitespace around a valid operator is not flagged');
}

// ── [2] the nav-clearance contract — RE-DERIVED for the pill (DI-397, UN-357,
//        2026-09-27) ─────────────────────────────────────────────────────────
// `.bottom-nav` retired its old full-bleed `bottom:0;height:var(--nav-height)`
// shape for a floating, inset PILL: `--nav-height` is GONE from the sheet
// entirely (mutation-proof at the end of this section) — replaced by four
// named parts (`--nav-pill-h/gap/inset/radius`) and ONE compound total,
// `--nav-bar-clearance`, that every consumer (`.main-content`, `.submit-bar`,
// the pill itself) now reads instead. The old @supports(padding-bottom:
// env(safe-area-inset-bottom)) block this section used to inspect is GONE
// too — `--nav-bar-clearance` bakes `env(safe-area-inset-bottom,0px)` into
// itself unconditionally, so there is no separate installed-app override
// left to check: one declaration is now correct in both worlds.
console.log('\n[2] nav clearance — the pill\'s four named tokens + the one compound clearance…');
{
  const rootBlock = (cssSrc.match(/:root\s*\{[\s\S]*?\n\}/) || [''])[0];
  assert(/--nav-pill-h\s*:\s*48px/.test(rootBlock), '--nav-pill-h is declared as 48px (the pill\'s own content height)');
  assert(/--nav-pill-gap\s*:\s*8px/.test(rootBlock), '--nav-pill-gap is declared as 8px (the floating offset above the true screen edge)');
  assert(/--nav-pill-inset\s*:\s*12px/.test(rootBlock), '--nav-pill-inset is declared as 12px (the left/right inset from the screen edges)');
  assert(/--nav-pill-radius\s*:\s*24px/.test(rootBlock), '--nav-pill-radius is declared as 24px — exactly half of --nav-pill-h, a true capsule');
  const clearanceDecl = (rootBlock.match(/--nav-bar-clearance\s*:\s*([^;]+);/) || [])[1] || '';
  // RE-DERIVED (Home wiring, 2026-10-01; Amendment 3 + 3.1): the clearance is the pill's height plus its own bottom offset, --nav-pill-bottom; THAT token is the shipped gap + the safe-area inset
  // (with a 0px fallback), floored so the Home disc's collar keeps 8px from the screen edge. The clearance carries no disc term: pages leave no more room (Drew, 56 pt).
  const pillBottomDecl = (rootBlock.match(/--nav-pill-bottom\s*:\s*([^;]+);/) || [])[1] || '';
  assert(/var\(--nav-pill-h\)/.test(clearanceDecl) && /var\(--nav-pill-bottom\)/.test(clearanceDecl) && !/--nav-disc/.test(clearanceDecl),
    `--nav-bar-clearance sums pill height + --nav-pill-bottom and carries NO disc term, computed once — got "${clearanceDecl.trim()}"`);
  assert(/var\(--nav-pill-gap\)/.test(pillBottomDecl) && /env\(\s*safe-area-inset-bottom\s*,\s*0px\s*\)/.test(pillBottomDecl) && /var\(--nav-disc-reach\)/.test(pillBottomDecl) && /^max\(/.test(pillBottomDecl.trim()),
    `--nav-pill-bottom = max(gap + the safe-area inset (0px fallback), reach + 8px): the shipped offset with the disc floor — got "${pillBottomDecl.trim()}"`);
  assert(invalidCalcs(`.p{x:${pillBottomDecl}}`).length === 0, '--nav-pill-bottom\'s own calc() is valid (no unspaced operator)');
  assert(invalidCalcs(`.p{x:${clearanceDecl}}`).length === 0, '--nav-bar-clearance\'s own calc() is valid (no unspaced operator)');

  // `.main-content` reads the ONE compound token — no separate installed-app
  // override left to keep in sync with it.
  const mainPad = ruleBodies('.main-content')[0] || '';
  const shorthand = (mainPad.match(/padding\s*:\s*([^;}]+)/) || [])[1] || '';
  assert(/var\(--nav-bar-clearance\)/.test(shorthand),
    `.main-content's padding derives its bottom value from --nav-bar-clearance rather than hardcoding it (got "${shorthand.trim()}")`);
  assert(!/@supports\s*\(padding-bottom:\s*env\(safe-area-inset-bottom\)\)/.test(cssSrc),
    'the old safe-area @supports block is genuinely gone, not merely emptied — --nav-bar-clearance replaced the two-declaration (base + override) shape it existed for');

  // `.bottom-nav` itself: a floating pill, inset from both side edges and the
  // true bottom edge — never `left:0;right:0;bottom:0` again.
  const navBody = ruleBodies('.bottom-nav')[0] || '';
  assert(/position:\s*fixed/.test(navBody), '.bottom-nav is still position:fixed');
  assert(/left:\s*var\(--nav-pill-inset\)/.test(navBody) && /right:\s*var\(--nav-pill-inset\)/.test(navBody),
    `.bottom-nav is inset from BOTH side edges by --nav-pill-inset, never full-bleed left:0;right:0 (got "${navBody.trim()}")`);
  const navBottom = (navBody.match(/bottom\s*:\s*([^;]+);/) || [])[1] || '';
  assert(/var\(--nav-pill-bottom\)/.test(navBottom),
    `.bottom-nav floats above the true bottom edge by --nav-pill-bottom (the shipped gap + the safe-area inset, floored for the Home disc; got "${navBottom.trim()}") — never bottom:0`);
  assert(/height\s*:\s*var\(--nav-pill-h\)/.test(navBody), '.bottom-nav\'s own height is exactly --nav-pill-h — no separate installed-app growth rule left');
  assert(/border-radius\s*:\s*var\(--nav-pill-radius\)/.test(navBody), '.bottom-nav is a true capsule (border-radius:var(--nav-pill-radius))');
  assert(invalidCalcs(navBody).length === 0, '.bottom-nav\'s own bottom: calc() is valid');

  // MUTATION-PROOF (RG-27) — `--nav-height` really is retired, not just
  // unused: css/styles.css's own comment on --nav-bar-clearance claims this
  // is mutation-proof; this section is what actually proves it, against the
  // real source text, not a hand-typed stand-in.
  // Checked against `cssRules` (the comment-stripped copy §1 already
  // defines), not raw `cssSrc` — the token's OWN retirement is explained in
  // several historical comments that quote it verbatim (e.g. the
  // --nav-bar-clearance :root comment above), and a check against the raw
  // source would false-positive on its own explanation.
  assert(!/--nav-height\s*:/.test(cssRules), '--nav-height is not DECLARED anywhere in css/styles.css (outside comments) — DI-397 retired it, not merely stopped reading it');
  assert(!/var\(--nav-height\)/.test(cssRules), 'no rule in css/styles.css READS var(--nav-height) either (outside comments) — every former consumer was repointed at --nav-bar-clearance or the pill\'s own named tokens');
}

// ── [3] the submit bar clears the pill rather than hiding under it ──────────
// .bottom-nav is z-index 100, .submit-bar z-index 50. If the bar's offset ever
// falls back to 0 again it sticks flush to the viewport bottom, BEHIND the
// nav — invisible, with its Submit button untappable.
console.log('\n[3] .submit-bar — its sticky offset clears the pill it sits above…');
{
  const body = ruleBodies('.submit-bar')[0] || '';
  const bottom = (body.match(/bottom\s*:\s*([^;]+);/) || [])[1] || '';
  assert(/var\(--nav-bar-clearance\)/.test(bottom),
    `.submit-bar's offset is expressed in terms of --nav-bar-clearance, so it tracks the pill's full footprint (height + gap + inset) as one unit (got "${bottom.trim()}")`);
  const plus = bottom.match(/\+\s*(\d+)px/);
  assert(!!plus && Number(plus[1]) > 0,
    `.submit-bar clears the pill by a positive margin rather than sitting exactly on its edge (got "${bottom.trim()}")`);
  assert(invalidCalcs(body).length === 0, '.submit-bar\'s own bottom: calc() is valid');
  const navBody3 = ruleBodies('.bottom-nav')[0] || '';
  const navZ = Number((navBody3.match(/z-index:\s*(\d+)/) || [])[1]);
  const barZ = Number((body.match(/z-index:\s*(\d+)/) || [])[1]);
  assert(navZ > barZ,
    `the pill still paints above the submit bar (pill z-index ${navZ} > bar z-index ${barZ}), which is why the bar must be offset rather than layered`);
}

// ── [4] B-a: no speculative fix was shipped ─────────────────────────────────
// Recorded as an assertion, not prose, because "we did not change the nav"
// is exactly the kind of claim that quietly stops being true.
console.log('\n[4] B-a — the nav/wrapper geometry is unchanged pending a device repro…');
{
  assert(/\.page-wrapper\{min-height:100vh;display:flex;flex-direction:column\}/.test(cssSrc),
    '.page-wrapper still min-height:100vh + flex column — untouched');
  assert(/viewport-fit=cover/.test(htmlSrc), 'index.html still opts into viewport-fit=cover (UN-98/100)');
  assert(/apple-mobile-web-app-status-bar-style"\s+content="black-translucent"/.test(htmlSrc),
    'the translucent status bar (the reason the insets are non-zero on the installed app) is unchanged');
}

// ── [5] the ancestor audit loadtest [58] should have had ────────────────────
// [58] checks a HARDCODED list of four selectors for transform/filter/
// backdrop-filter/perspective/will-change/contain. Two gaps: the list is not
// derived from the DOM, so a restructure silently narrows the audit; and
// `overflow` — the most commonly reported cause of position:fixed drift on
// iOS — was never in the property set at all.
console.log('\n[5] .bottom-nav ancestor chain — derived from index.html, full property set…');
{
  // Strip comments and <script>/<style> bodies so their angle brackets and
  // string literals cannot corrupt the tag stack.
  const cleaned = htmlSrc
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '<style></style>');
  const navIdx = cleaned.indexOf('<nav class="bottom-nav"');
  assert(navIdx > 0, 'sanity: found <nav class="bottom-nav"> in index.html to walk up from');

  const VOID = new Set(['area','base','br','col','embed','hr','img','input','link','meta','source','track','wbr']);
  const stack = [];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(cleaned)) && m.index < navIdx) {
    const [, closing, rawName, attrs] = m;
    const name = rawName.toLowerCase();
    if (VOID.has(name) || /\/\s*$/.test(attrs)) continue;
    if (closing) { if (stack.length && stack[stack.length - 1].name === name) stack.pop(); }
    else stack.push({ name, classes: ((attrs.match(/class="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(Boolean) });
  }
  const chain = stack.map(s => s.name + (s.classes.length ? '.' + s.classes.join('.') : ''));
  assert(stack.length >= 2, `derived a real ancestor chain for .bottom-nav: ${chain.join(' > ') || '(empty)'}`);
  assert(stack.some(s => s.classes.includes('page-wrapper')),
    `.page-wrapper is on the derived chain, so [58]'s hardcoded list still matches the DOM (chain: ${chain.join(' > ')})`);
  assert(!stack.some(s => s.classes.includes('main-content')),
    '.main-content is NOT an ancestor of the nav — so its own overflow can never affect the nav, only its in-page descendants');

  // Selectors that can match anything on that chain, plus the two element
  // selectors above it that never appear as tags in the body markup.
  const selectors = ['html', 'body'];
  for (const s of stack) { for (const c of s.classes) if (!selectors.includes('.' + c)) selectors.push('.' + c); }

  const CB_PROPS = ['transform', 'translate', 'rotate', 'scale', 'perspective',
                    'filter', 'backdrop-filter', 'will-change', 'contain',
                    'container-type', 'container'];
  const offenders = [];
  for (const sel of selectors) {
    for (const body of ruleBodies(sel)) {
      for (const prop of CB_PROPS) {
        if (new RegExp(`(^|[;{])\\s*${prop}\\s*:`).test(body)) offenders.push(`${sel} { ${prop}: … }`);
      }
    }
  }
  assert(offenders.length === 0,
    `no ancestor of .bottom-nav establishes a containing block for fixed descendants — checked ${CB_PROPS.length} properties, incl. the container-query and individual-transform ones [58] predates, across ${selectors.length} selectors (${selectors.join(', ')})${offenders.length ? ': ' + offenders.join(' | ') : ''}`);

  // OVERFLOW — the class [58] never looked at. NOT asserted absent: measured
  // in Blink 152 and macOS WKWebView on 2026-09-19 and it does NOT move the
  // fixed nav in either. Asserted as a KNOWN STATE so it cannot change, in
  // either direction, without a test failing and a human reading this note.
  //
  // RG-188 amends the VALUE, not the count. Both rules are still here and both
  // still clip sideways overflow; the value is now `clip`, which does the same
  // clipping WITHOUT becoming a scroll container. The check reads the LAST
  // declaration in each rule, because that is the one that wins the cascade —
  // reading the first would report the `hidden` fallback and miss a regression
  // that deleted the `clip` line.
  const overflowAncestors = [];
  for (const sel of selectors) {
    for (const body of ruleBodies(sel)) {
      const all = [...body.matchAll(/(?:^|[;{])\s*(overflow(?:-x|-y)?)\s*:\s*([^;}]+)/g)];
      if (!all.length) continue;
      const last = all[all.length - 1];
      if (/^\s*visible\s*$/.test(last[2])) continue;
      overflowAncestors.push({ sel, prop: last[1], value: last[2].trim(), body,
        text: `${sel}{${last[1]}:${last[2].trim()}}` });
    }
  }
  assert(overflowAncestors.length === 2,
    `exactly two ancestors of .bottom-nav carry non-visible overflow, both by design and both measured harmless to the fixed nav: ${overflowAncestors.map(o => o.text).join(' + ')}`);
  for (const name of ['body', '.page-wrapper']) {
    const hit = overflowAncestors.find(o => o.sel === name);
    assert(!!hit && hit.prop === 'overflow-x' && hit.value === 'clip',
      `${name} clips sideways overflow with overflow-x:CLIP, not hidden — clip is not a scroll container, so it cannot steal the scrollport from position:sticky descendants (RG-188). Got ${hit ? hit.text : '(no non-visible overflow at all — the v14 sideways-scroll guard was deleted)'}`);
    assert(!!hit && /overflow-x\s*:\s*hidden[^}]*overflow-x\s*:\s*clip/.test(hit.body),
      `${name} keeps overflow-x:hidden BEFORE the clip declaration as the pre-clip-support fallback (Safari <16), in that order — an engine without clip keeps today's behaviour instead of gaining a sideways scroll`);
  }
}

// ── [6] B-c / RG-188: no ancestor of .submit-bar may be a scroll container ──
// The SOURCE half of the fix. §7 measures the consequence; this section pins
// the mechanism, derives the chain from index.html (so a markup restructure
// widens the audit instead of silently narrowing it), and states the two
// deliberate holds.
console.log('\n[6] B-c — the .submit-bar ancestor chain, and the two sticky rules held at relative…');
{
  // Derive .submit-bar's chain. The bar is written into #page-picks by
  // renderPicksPage() (app.js), so the chain is #page-picks' chain plus the
  // section itself. Asserted against app.js so the fixture in §7 cannot drift
  // away from what the app actually renders.
  const appSrc = readFileSync(here + 'js/app.js', 'utf8');
  assert(/<div class="submit-bar">/.test(appSrc),
    'app.js still renders <div class="submit-bar"> (the element these sections are about)');
  assert(/id="tb-input"/.test(appSrc) && /class="tiebreaker-card"/.test(appSrc),
    'app.js still renders the tiebreaker card + #tb-input immediately before it — the thing the bar must not cover at rest');
  assert(/id="edit-picks-btn"/.test(appSrc) && /Edit My Picks/.test(appSrc),
    'the submitted view still offers "Edit My Picks" (locked decision) — §7 proves it stays reachable');
  assert(!/class="submit-bar"/.test(appSrc.slice(appSrc.indexOf('id="edit-picks-btn"'))),
    'the SUBMITTED/locked view carries no .submit-bar at all, so the sticky bar cannot cover the Edit My Picks card');

  const chainHtml = htmlSrc
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '<script></script>')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '<style></style>');
  const picksIdx = chainHtml.indexOf('id="page-picks"');
  assert(picksIdx > 0, 'sanity: found the #page-picks section in index.html to walk up from');
  const wrapperIdx = chainHtml.indexOf('<div class="page-wrapper">');
  const mainIdx = chainHtml.indexOf('<main class="main-content">');
  assert(wrapperIdx > 0 && mainIdx > wrapperIdx && picksIdx > mainIdx,
    `the real chain is still body > .page-wrapper > .main-content > #page-picks (indices ${wrapperIdx}/${mainIdx}/${picksIdx}) — the chain §7's fixture reproduces`);

  const BAR_ANCESTORS = ['html', 'body', '.page-wrapper', '.main-content', '.page-section', '#page-picks'];
  const scrollPorts = [];
  for (const sel of BAR_ANCESTORS) {
    for (const body of ruleBodies(sel)) {
      const all = [...body.matchAll(/(?:^|[;{])\s*(overflow(?:-x|-y)?)\s*:\s*([^;}]+)/g)];
      if (!all.length) continue;
      const last = all[all.length - 1];
      const v = last[2].trim();
      // visible and clip are the only two values that do NOT create a scroll
      // container. hidden/auto/scroll all do — and on ONE axis they drag the
      // other axis's `visible` to `auto` with them (CSS Overflow 3 §3.1).
      if (v === 'visible' || v === 'clip') continue;
      scrollPorts.push(`${sel}{${last[1]}:${v}}`);
    }
  }
  assert(scrollPorts.length === 0,
    `no ancestor of .submit-bar is a scroll container, so the viewport is the nearest scrollport and position:sticky resolves against the thing that actually scrolls (RG-188; checked ${BAR_ANCESTORS.join(', ')})${scrollPorts.length ? ' — offenders: ' + scrollPorts.join(' | ') : ''}`);

  // ── EVERY sticky in the sheet, not just this one (reviewer, round 1) ──────
  // The same audit over each sticky rule's own chain. One of them is SUPPOSED
  // to be scrollport-bound: .chat-jump-latest lives inside #page-chat.active,
  // which is an explicitly-bounded flex column with overflow:hidden, and it
  // sticks inside .chat-scroll. That is encoded as a named EXPECTED exception
  // with its reason, not waved through by a loose rule — if it ever stops being
  // scrollport-bound, this fails and someone reads this note.
  const STICKY_CHAINS = {
    '.submit-bar':      { chain: BAR_ANCESTORS, expectScrollport: false, why: 'RG-188: pins against the viewport' },
    '.app-header':      { chain: ['html', 'body', '.page-wrapper'], expectScrollport: false, why: 'held at relative, but its chain must stay clean so the hold is the ONLY thing stopping it' },
    '.comm-tabbar':     { chain: ['html', 'body', '.page-wrapper', '.main-content', '.page-section', '#page-commissioner'], expectScrollport: false, why: 'same' },
    '.chat-jump-latest': { chain: ['#page-chat.active', '.chat-scroll'], expectScrollport: true, why: 'BY DESIGN: it pins inside .chat-scroll, the one bounded scroller in UN-110\'s flex column — this sticky has always worked and must keep a scrollport' },
  };
  for (const [sel, { chain, expectScrollport, why }] of Object.entries(STICKY_CHAINS)) {
    const isSticky = ruleBodies(sel).some(b => /position\s*:\s*sticky/.test(b))
      || cssRules.includes(sel) && new RegExp(`${sel.replace(/[.#]/g, c => '\\' + c)}\\s*\\{[^}]*position\\s*:\\s*sticky`).test(cssRules);
    assert(isSticky, `fixture check: ${sel} still declares position:sticky somewhere, so auditing its chain is not vacuous`);
    const ports = [];
    for (const anc of chain) {
      for (const body of ruleBodies(anc.replace('.active', ''))) {
        const all = [...body.matchAll(/(?:^|[;{])\s*(overflow(?:-x|-y)?)\s*:\s*([^;}]+)/g)];
        if (!all.length) continue;
        const v = all[all.length - 1][2].trim();
        if (v !== 'visible' && v !== 'clip') ports.push(`${anc}{${all[all.length - 1][1]}:${v}}`);
      }
    }
    assert(expectScrollport ? ports.length > 0 : ports.length === 0,
      `${sel}'s chain ${expectScrollport ? 'still HAS the scroll container it needs' : 'has no scroll container'} — ${why}. Chain ${chain.join(' > ')}; found: ${ports.join(' | ') || 'none'}`);
  }

  for (const name of ['body', '.page-wrapper', '.main-content']) {
    const bodies = ruleBodies(name);
    const joined = bodies.join(' ;; ');
    assert(/overflow-x\s*:\s*hidden[\s\S]*overflow-x\s*:\s*clip/.test(joined),
      `${name} declares overflow-x:hidden THEN overflow-x:clip — the fallback first, the fix second (RG-188)`);
    assert(!/(^|[;{])\s*overflow\s*:\s*hidden/.test(joined) && !/(^|[;{])\s*overflow-y\s*:\s*(hidden|auto|scroll)/.test(joined),
      `${name} sets no overflow shorthand and no non-visible overflow-y — either would make it a scroll container again and re-break the bar (got: ${joined.trim().slice(0, 160)})`);
  }

  // ── THE SAFE-AREA CLEARANCE AUDIT — RE-DERIVED for --nav-bar-clearance
  //    (DI-397, 2026-09-27) ───────────────────────────────────────────────
  // The reviewer's original finding (round 1): an offset written in terms of
  // --nav-height ALONE, with no separate env(safe-area-inset-bottom) term of
  // its own, was short by the inset on a notched iPhone. --nav-bar-clearance
  // now BAKES that env() term into itself once (§[2]) — so the class of bug
  // this audit exists to catch is now "a bottom: offset that reads the
  // pill's raw parts (--nav-pill-h/--nav-pill-gap) directly instead of the
  // one compound token that already carries the inset." Scoped OFF
  // `.bottom-nav` itself (and its `.nav-hidden`/keyboard-up variants), which
  // legitimately compose the raw parts PLUS its own explicit env() term —
  // §[2] already audits that rule on its own terms.
  const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
  const rawPartOffenders = [];
  const clearanceChecked = [];
  for (const [, selector, body] of cssRules.matchAll(RULE_RE)) {
    const sel = selector.trim().replace(/\s+/g, ' ');
    if (/\.bottom-nav/.test(sel)) continue;   // audited directly in §[2]
    const decl = body.match(/(?:^|[;{])\s*bottom\s*:\s*([^;}]+)/);
    if (!decl) continue;
    if (/var\(--nav-bar-clearance\)/.test(decl[1])) { clearanceChecked.push(`${sel}{bottom:${decl[1].trim()}}`); continue; }
    if (/var\(--nav-pill-(h|gap)\)/.test(decl[1])) rawPartOffenders.push(`${sel}{bottom:${decl[1].trim()}}`);
  }
  assert(clearanceChecked.length >= 3,
    `fixture check: found ${clearanceChecked.length} non-nav rules whose bottom offset is derived from --nav-bar-clearance to audit (${clearanceChecked.length ? clearanceChecked.map(s => s.split('{')[0]).join(', ') : 'none — the scanner is broken'})`);
  assert(rawPartOffenders.length === 0,
    `no rule outside .bottom-nav itself composes the pill's RAW parts (--nav-pill-h/--nav-pill-gap) for a bottom: offset — every consumer reads the one compound --nav-bar-clearance token instead, so the safe-area inset can never be silently dropped by hand-assembling the parts. Offenders: ${rawPartOffenders.join(' | ') || 'none'}`);

  // The REST-POSITION invariant. The bar pins at (clearance + 8); .main-content
  // reserves (clearance + 20) below the content, so the bar's flow position is
  // always 12px ABOVE the pin line and a short slate can never make sticky
  // shove it up over the tiebreaker. Both quantities now read the SAME single
  // --nav-bar-clearance token (§[2]) — no more base-rule/@supports-override
  // pair to keep in sync, so there is only ONE world to prove the invariant
  // in, not two: whatever the inset resolves to, both sides move together by
  // construction.
  const barDecl = (/\.submit-bar\{[^}]*?bottom:(calc\([^;}]*\))/.exec(cssRules) || [])[1] || '';
  const reserveDecl = (/\.main-content\{[^}]*padding:[^;}]*?calc\(([^;}]*)\)/.exec(cssRules) || [])[1] || '';
  const constOf = expr => { const m = [...String(expr).matchAll(/\+\s*(\d+)px/g)]; return m.length ? Number(m[m.length - 1][1]) : NaN; };

  assert(!!barDecl && !!reserveDecl,
    `both declarations are readable — bar offset "${barDecl}", .main-content reserve "${reserveDecl}"`);
  assert(/var\(--nav-bar-clearance\)/.test(barDecl) && /var\(--nav-bar-clearance\)/.test(reserveDecl),
    `both the bar's offset AND .main-content's reserve read the SAME --nav-bar-clearance token, so they move together by construction instead of drifting apart (bar: "${barDecl}", reserve: "${reserveDecl}")`);
  const offset = constOf(barDecl), reserve = constOf(reserveDecl);
  assert(Number.isFinite(offset) && Number.isFinite(reserve),
    `both constants are readable — bar +${offset}px, reserve +${reserve}px`);
  assert(reserve > offset,
    `.main-content reserves MORE below the content (+${reserve}px) than the bar's sticky offset (+${offset}px), so the bar rests ${reserve - offset}px above its pinned position and never shoves up over the tiebreaker`);

  // The two deliberate holds. `relative`, not `static`: a sticky that never
  // sticks paints identically to relative AND keeps z-index applying (z-index
  // is ignored on static), so this is a byte-identical hold of today's
  // rendering rather than a new stacking decision.
  for (const [sel, why] of [
    ['.app-header', 'a pinned header on every page is a change all six players would see, and UN-110 shows Drew guards vertical space — not part of B-c'],
    ['.comm-tabbar', 'its top:0 was written against no sticky header; pinned, it would sit UNDER the opaque .app-header — not part of B-c'],
  ]) {
    const bodies = ruleBodies(sel);
    const positions = bodies.flatMap(b => [...b.matchAll(/(?:^|[;{])\s*position\s*:\s*([a-z-]+)/g)].map(m => m[1]));
    assert(positions.length >= 2 && positions[positions.length - 1] === 'relative',
      `${sel} is held at position:relative — its sticky rule is revivable in one declaration but is NOT revived by RG-188 (${why}). Effective position chain: ${positions.join(' → ') || '(none)'}`);
    // The hold must be EXPLAINED where it lives, or the next reader deletes it
    // as dead CSS. Checked by looking backwards from the rule itself rather than
    // forwards from the comment — the explanation is long and grows.
    const holdRe = new RegExp(`${sel.replace('.', '\\.')}\\s*\\{\\s*position\\s*:\\s*relative\\s*;?\\s*\\}`);
    const at = cssSrc.search(holdRe);
    assert(at > 0 && /RG-188/.test(cssSrc.slice(Math.max(0, at - 2500), at)),
      `${sel}'s hold is preceded by the RG-188 comment that explains it, so the next reader learns it is deliberate rather than deleting it as dead CSS (rule found at index ${at})`);
    // Cascade order: this hold is a same-specificity override, so it only works
    // if it comes AFTER the sticky rule it overrides. Moving the block up the
    // file would silently revive both stickies.
    const stickyAt = cssRules.search(new RegExp(`${sel.replace('.', '\\.')}\\s*\\{[^}]*position\\s*:\\s*sticky`));
    const holdAtRules = cssRules.search(holdRe);
    assert(stickyAt >= 0 && holdAtRules > stickyAt,
      `${sel}'s hold sits AFTER its position:sticky rule in the sheet (sticky at ${stickyAt}, hold at ${holdAtRules}) — same specificity, so source order is the whole mechanism`);
  }
}

// ── [7] ENGINE-MEASURED — a real layout engine, at 393x852, scrolled ────────
// Everything above is source text. This defect class is invisible to source
// text: the stylesheet said `position:sticky` for the entire time the bar was
// not sticking. Testing Protocol step 14 requires a real scrolling context for
// any positioning claim; this is that, automated.
console.log('\n[7] ENGINE-MEASURED (Chromium over the DevTools protocol, 393×852)…');
{
  const ENGINES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  ];
  // NAVTEST_ENGINE overrides the search. This section is spawned by loadtest.mjs,
  // the harness every thread is required to run, so a missing browser must be
  // loud (never a silent skip — a guard that skips is not a guard) AND must be
  // fixable in one line by the person who hit it.
  const override = process.env.NAVTEST_ENGINE;
  const bin = override || ENGINES.find(p => existsSync(p));
  const HOWTO = 'Fix: NAVTEST_ENGINE=/path/to/Chromium node navtest.mjs — or export it once, and loadtest.mjs passes it down to this suite. [7] measures layout in a real engine and cannot be faked, so a missing browser is a FAILURE, never a skip.';
  assert(!!bin && existsSync(bin), !bin
    ? `NO CHROMIUM-FAMILY BROWSER FOUND in /Applications. ${HOWTO} Looked for: ${ENGINES.join(', ')}`
    : !existsSync(bin)
      ? `NAVTEST_ENGINE points at a file that does not exist: "${override}". ${HOWTO}`
      : `engine to measure in: ${bin}${override ? ' (from NAVTEST_ENGINE)' : ''}`);
  assert(typeof WebSocket === 'function', 'this Node has a global WebSocket (v22+) to speak the DevTools protocol over');

  // ── fixtures: the REAL stylesheet, the REAL nav markup, the derived chain ──
  const cssHref = 'file://' + here + 'css/styles.css';
  // THE INSTALLED-APP VARIANT (reviewer BLOCK, round 1). env(safe-area-inset-*)
  // is 0 in every desktop engine, so a browser-only pass is blind to the case
  // that actually bit: on a notched iPhone the pill's GAP grows by the bottom
  // inset (DI-397 moved the growth from the nav's own HEIGHT into its
  // POSITION — see §[2]/§7e2). Same technique B-a's harness used —
  // substitute the inset TEXTUALLY into a copy of the real stylesheet and lay
  // the real rules out against it. DI-397 (2026-09-27) retired the
  // @supports(padding-bottom:env(safe-area-inset-bottom)) block this used to
  // protect during substitution — --nav-bar-clearance bakes
  // env(safe-area-inset-bottom,0px) into itself UNCONDITIONALLY now, so every
  // env() occurrence in the sheet is a real consumer and none needs shielding
  // from a blind text substitution.
  const INSET = 34;                       // iPhone 14/15/16 home-indicator inset
  const navStart = htmlSrc.indexOf('<nav class="bottom-nav"');
  const navHtml = htmlSrc.slice(navStart, htmlSrc.indexOf('</nav>', navStart) + 6);
  const tmp = mkdtempSync(join(tmpdir(), 'cfbp-navtest-'));

  const insetFile = join(tmp, 'styles-inset.css');
  {
    const sheet = cssSrc.replace(/env\(\s*safe-area-inset-bottom\s*(?:,[^)]*)?\)/g, INSET + 'px');
    assert(sheet !== cssSrc,
      `fixture check: at least one env(safe-area-inset-bottom) was substituted with ${INSET}px — otherwise the variant would be identical to the browser case and prove nothing (RG-27)`);
    writeFileSync(insetFile, sheet);
  }
  const insetHref = 'file://' + insetFile;

  // UN-212 verification finding §7j — same textual-substitution technique,
  // for env(safe-area-inset-TOP) instead of -bottom. No @supports condition
  // wraps this one (.app-header's own padding-top:env(safe-area-inset-top,
  // 0px) is a bare declaration, unlike the bottom-inset @supports block
  // above), so no GUARD/protect step is needed here.
  const TOPINSET = 59; // Dynamic-Island-class inset (iPhone 15/16/18 Pro family)
  const SOFT_EDGE = 12; // SB-08 option O2b (Drew's pick, 2026-09-30): the band overhangs the inset by 12px
  const topInsetFile = join(tmp, 'styles-top-inset.css');
  {
    const before = cssSrc;
    const sheet = cssSrc.replace(/env\(\s*safe-area-inset-top\s*(?:,[^)]*)?\)/g, TOPINSET + 'px');
    assert(sheet !== before,
      `fixture check: at least one env(safe-area-inset-top) was substituted with ${TOPINSET}px — otherwise this variant would be identical to the browser case and prove nothing (RG-27)`);
    writeFileSync(topInsetFile, sheet);
  }
  const topInsetHref = 'file://' + topInsetFile;
  // The MUTATED sibling — same top-inset substitution, but with the
  // "body.native-shell" prefix stripped from ONLY the new backdrop-strip
  // rule (leaving a bare "::before{...}" that would paint on every body,
  // web included). Used for §7j's mutation-proof (scope removed ⇒ RED).
  const topInsetMutatedFile = join(tmp, 'styles-top-inset-mutated.css');
  {
    const insetSheet = readFileSync(topInsetFile, 'utf8');
    const stripRuleMatch = /body\.native-shell::before\{([^}]*)\}/.exec(insetSheet);
    assert(!!stripRuleMatch, 'fixture check: the top-inset sheet still contains the body.native-shell::before rule to mutate');
    const mutated = stripRuleMatch
      ? insetSheet.replace('body.native-shell::before{' + stripRuleMatch[1] + '}', '::before{' + stripRuleMatch[1] + '}')
      : insetSheet;
    assert(mutated !== insetSheet, 'fixture check: the mutation actually changed the top-inset sheet text');
    writeFileSync(topInsetMutatedFile, mutated);
  }
  const topInsetMutatedHref = 'file://' + topInsetMutatedFile;
  // SB-08 (2026-09-30) — §7k's two mutation sheets, built from the SAME
  // top-inset substitution, and written so they stay meaningful on EITHER
  // side of the fix: STRIP-FORCED = any existing body.native-shell::before
  // rule removed and RG-209's exact backdrop re-injected (the reported bug,
  // recreated on demand); STRIP-ABSENT = every body.native-shell::before rule
  // removed and nothing added. §7k's detector must go RED on the first and
  // GREEN on the second — proof that what it measures is the band paint, not
  // an artifact of the fixture.
  const RG209_STRIP = 'body.native-shell::before{content:"";position:fixed;top:0;left:0;right:0;height:' + TOPINSET + 'px;background:var(--maroon);z-index:150;pointer-events:none}';
  const withoutStrip = readFileSync(topInsetFile, 'utf8').replace(/body\.native-shell::before\{[^}]*\}/g, '');
  const topInsetStripForcedFile = join(tmp, 'styles-top-inset-strip-forced.css');
  writeFileSync(topInsetStripForcedFile, withoutStrip + '\n' + RG209_STRIP + '\n');
  const topInsetStripAbsentFile = join(tmp, 'styles-top-inset-strip-absent.css');
  writeFileSync(topInsetStripAbsentFile, withoutStrip);
  // SB-08 fix — §7k-7's mutation sheet: the REAL soft edge, raised from z-index
  // 90 to RG-209's 150 (above the header). The header at rest must then stop
  // filling the band — proof that the z-order, not luck, is what keeps the
  // header's colour under the Dynamic Island while the header is there.
  const topInsetBandAboveFile = join(tmp, 'styles-top-inset-band-above.css');
  {
    const insetSheet = readFileSync(topInsetFile, 'utf8');
    const bandRule = /body\.native-shell::before\{[^}]*\}/.exec(insetSheet);
    const raised = bandRule ? insetSheet.replace(bandRule[0], bandRule[0].replace(/z-index:\s*90/, 'z-index:150')) : insetSheet;
    assert(raised !== insetSheet, 'fixture check: the band-above mutation actually raised the band\'s z-index in the top-inset sheet');
    writeFileSync(topInsetBandAboveFile, raised);
  }

  const fixtures = {};
  function fixture(name, { tab = 'picks', sectionId = 'page-picks', inner, css = cssHref, bodyClass = '' }) {
    const file = join(tmp, name + '.html');
    const classAttr = bodyClass ? ` class="${bodyClass}"` : '';
    writeFileSync(file, `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${css}"></head>
<body${classAttr} data-tab="${tab}"><div class="page-wrapper">
<header class="app-header"><div class="app-header-inner"><div class="header-meta" id="header-meta"><strong>Week 3</strong></div></div></header>
<main class="main-content"><section class="page-section active" id="${sectionId}">${inner}</section></main>
${navHtml}</div></body></html>`);
    fixtures[name] = file;
    return file;
  }
  const gameCards = n => Array.from({ length: n }, (_, i) =>
    `<div class="game-card"><div style="padding:16px">Game ${i + 1} — Team A @ Team B
     <div style="display:flex;gap:8px"><button class="pick-btn">Team A</button><button class="pick-btn">Team B</button></div></div></div>`).join('');
  const tiebreaker = `<div class="tiebreaker-card"><div class="tiebreaker-label">🎯 Weekly Tiebreaker (Required)</div>
    <div class="tiebreaker-question">Total points in the Michigan game?</div>
    <input class="form-input" id="tb-input" type="number" placeholder="Your numeric guess…" style="margin-top:10px">
    <p class="text-muted text-xs mt-sm">Required. Closest guess wins ties.</p></div>`;
  const submitBar = n => `<div class="submit-bar"><div class="submit-progress"><strong>0</strong>/${n} + tiebreaker</div>
    <button class="btn btn-primary" id="submit-picks-btn">Submit All Picks</button></div>`;
  const SLATES = [1, 2, 3, 6, 14];
  for (const n of SLATES) fixture('open' + n, { inner: `<div id="games-list">${gameCards(n)}</div>${tiebreaker}${submitBar(n)}` });
  // the same pages, laid out as the INSTALLED APP sees them (inset substituted)
  for (const n of [1, 3, 14]) fixture('inset' + n, { css: insetHref, inner: `<div id="games-list">${gameCards(n)}</div>${tiebreaker}${submitBar(n)}` });
  // UN-212 §7j — the native-shell status-bar backdrop strip, at a real
  // top-inset. Three variants of the SAME 14-game slate (deliberately the
  // tall/scrollable one — §7a already proved it scrolls 1222px — so §7j's
  // own "content really did slide up underneath" fixture check is not
  // vacuous against a page short enough to never scroll at all): native
  // (class present, strip should render), web (class absent, strip must
  // not), and web-against-the-MUTATED-sheet (class absent, scope stripped —
  // proves the guard is load-bearing rather than assumed).
  fixture('topInsetNative', { css: topInsetHref, bodyClass: 'native-shell',
    inner: `<div id="games-list">${gameCards(14)}</div>${tiebreaker}${submitBar(14)}` });
  fixture('topInsetWeb', { css: topInsetHref,
    inner: `<div id="games-list">${gameCards(14)}</div>${tiebreaker}${submitBar(14)}` });
  fixture('topInsetWebMutated', { css: topInsetMutatedHref,
    inner: `<div id="games-list">${gameCards(14)}</div>${tiebreaker}${submitBar(14)}` });
  // SB-08 §7k — the same native 14-game slate against the two mutation sheets.
  fixture('topInsetNativeStripForced', { css: 'file://' + topInsetStripForcedFile, bodyClass: 'native-shell',
    inner: `<div id="games-list">${gameCards(14)}</div>${tiebreaker}${submitBar(14)}` });
  fixture('topInsetNativeStripAbsent', { css: 'file://' + topInsetStripAbsentFile, bodyClass: 'native-shell',
    inner: `<div id="games-list">${gameCards(14)}</div>${tiebreaker}${submitBar(14)}` });
  fixture('topInsetNativeBandAbove', { css: 'file://' + topInsetBandAboveFile, bodyClass: 'native-shell',
    inner: `<div id="games-list">${gameCards(14)}</div>${tiebreaker}${submitBar(14)}` });
  // SB-08 §7l — the glyph sweep's worst case, after the option renders: a
  // 46px team-logo disc at the clock's x on every card, cycling dark and light
  // marks (Notre Dame navy, Aggie maroon, Ink, gold, white, Sooner crimson),
  // so dark logos pass directly under dark glyphs and light ones under light.
  const LOGO_DISCS = ['#0C2340', '#500000', '#1C1410', '#C99700', '#FFFFFF', '#9D2235'];
  const logoCards = n => Array.from({ length: n }, (_, i) =>
    `<div class="game-card"><div style="padding:14px 16px;display:flex;align-items:center;gap:12px">
       <div style="width:46px;height:46px;border-radius:50%;background:${LOGO_DISCS[i % LOGO_DISCS.length]};flex:0 0 auto"></div>
       <div style="flex:1">Team A @ Team B</div></div>
     <div style="display:flex;gap:8px;padding:0 16px 16px"><button class="pick-btn">Team A</button><button class="pick-btn">Team B</button></div></div>`).join('');
  fixture('topInsetNativeLogos', { css: topInsetHref, bodyClass: 'native-shell',
    inner: `<div id="games-list">${logoCards(14)}</div>${tiebreaker}${submitBar(14)}` });
  // the deliberately-too-wide child: the thing overflow-x:hidden was there for
  fixture('wide', { inner: `<div id="games-list">${gameCards(6)}</div>
    <div id="too-wide" style="width:1200px;height:40px;background:#eee">an element 1200px wide, wider than every phone</div>
    ${tiebreaker}${submitBar(6)}` });
  // the submitted view: no .submit-bar, and Edit My Picks must stay reachable
  fixture('submitted', { inner: `<div class="tiebreaker-card tiebreaker-submitted"><span class="tiebreaker-label">🎯 Your Tiebreaker Guess</span><span class="tiebreaker-value">52</span></div>
    <div id="submitted-games">${gameCards(14)}</div>
    <div class="card mt-md" style="padding:16px"><div class="btn-row">
      <button class="btn btn-secondary" id="edit-picks-btn">✏️ Edit My Picks</button>
      <button class="btn btn-primary" id="go-dash-btn">View Dashboard</button></div></div>` });
  // other pages that live inside .main-content
  fixture('dashboard', { tab: 'dashboard', sectionId: 'page-dashboard', inner:
    `<div class="card"><div class="dashboard-scroll scroll-fade"><table class="dashboard-table"><thead><tr>
      ${['Game', 'Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'].map(h => `<th style="min-width:110px">${h}</th>`).join('')}
    </tr></thead><tbody>${Array.from({ length: 14 }, (_, i) => `<tr><td class="game-info-cell">Game ${i + 1}</td>${Array.from({ length: 6 }, () => '<td class="pick-cell">TEAM</td>').join('')}</tr>`).join('')}</tbody></table></div></div>` });
  fixture('comm', { tab: 'commissioner', sectionId: 'page-commissioner', inner:
    `<div class="comm-tabbar" role="tablist">${['Week', 'Games', 'Players', 'Settings', 'Data'].map(t => `<button class="comm-tab">${t}</button>`).join('')}</div>
     <div class="card"><div class="batch-grid-scroll"><table class="dashboard-table" style="min-width:1100px"><tbody>
     ${Array.from({ length: 20 }, (_, i) => `<tr><td>Row ${i + 1}</td><td style="min-width:900px">a very wide commissioner row</td></tr>`).join('')}</tbody></table></div></div>` });

  // ── the CDP client: launch, attach to the page target, measure ─────────────
  function launch() {
    const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0',
      '--user-data-dir=' + join(tmp, 'profile'), '--no-first-run', '--no-default-browser-check',
      '--disable-gpu', '--allow-file-access-from-files', '--hide-scrollbars',
      '--disable-background-networking', '--disable-sync', '--disable-component-update',
      '--disable-default-apps', '--disable-extensions', '--disable-search-engine-choice-screen',
      '--metrics-recording-only', '--mute-audio', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
    return new Promise((res, rej) => {
      let buf = '';
      const t = setTimeout(() => { proc.kill(); rej(new Error('no DevTools endpoint within 25s: ' + buf.slice(-300))); }, 25000);
      proc.stderr.on('data', d => {
        buf += d.toString();
        const m = buf.match(/ws:\/\/\S+/);
        if (m) { clearTimeout(t); res({ proc, ws: m[0] }); }
      });
      proc.on('error', e => { clearTimeout(t); rej(e); });
    });
  }
  async function attach(browserWs) {
    const list = await (await fetch('http://' + new URL(browserWs).host + '/json/list')).json();
    const target = list.find(t => t.type === 'page');
    if (!target) throw new Error('no page target to attach to');
    const sock = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      sock.addEventListener('open', res, { once: true });
      sock.addEventListener('error', () => rej(new Error('DevTools socket refused')), { once: true });
    });
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
  const MEASURE = cfg => `(() => {
    const cfg = ${JSON.stringify(cfg)};
    const R = sel => { const e = document.querySelector(sel); if (!e) return null;
      const r = e.getBoundingClientRect();
      return {top:+r.top.toFixed(1),bottom:+r.bottom.toFixed(1),left:+r.left.toFixed(1),right:+r.right.toFixed(1),h:+r.height.toFixed(1),w:+r.width.toFixed(1)}; };
    const se = document.scrollingElement;
    const out = {viewport:{w:innerWidth,h:innerHeight},
      navPillH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-pill-h')),
      navPillGap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-pill-gap')),
      ...(() => { const pr = document.createElement('div'); pr.style.cssText = 'position:absolute;visibility:hidden;width:var(--nav-disc-reach);height:var(--nav-pill-bottom)'; document.body.appendChild(pr);
        const cs = getComputedStyle(pr); const o = { discReach: parseFloat(cs.width), pillBottom: parseFloat(cs.height) }; pr.remove(); return o; })(),
      doc:{scrollHeight:se.scrollHeight,scrollWidth:se.scrollWidth,clientWidth:se.clientWidth,clientHeight:se.clientHeight},
      computed:{}, samples:{}};
    for (const sel of (cfg.computed||[])) { const e = document.querySelector(sel);
      if (!e) { out.computed[sel] = null; continue; }
      const cs = getComputedStyle(e);
      out.computed[sel] = {overflowX:cs.overflowX,overflowY:cs.overflowY,position:cs.position,bottom:cs.bottom,zIndex:cs.zIndex,
        scrollsY:e.scrollHeight > e.clientHeight + 1, scrollsX:e.scrollWidth > e.clientWidth + 1}; }
    out.maxScroll = Math.max(0, se.scrollHeight - innerHeight);
    const at = {top:0, mid:Math.round(out.maxScroll/2), bottom:out.maxScroll};
    for (const name of (cfg.scrolls||['top','mid','bottom'])) {
      window.scrollTo({top:at[name],left:0,behavior:'instant'});   // html{scroll-behavior:smooth} would animate a plain scrollTo
      const s = {scrollY:Math.round(window.scrollY)};
      for (const k of Object.keys(cfg.rects||{})) s[k] = R(cfg.rects[k]);
      out.samples[name] = s;
    }
    window.scrollTo({top:0,left:9999,behavior:'instant'});
    out.userCanScrollSideways = Math.round(window.scrollX) > 0;   // the only sideways test that matters: can a THUMB do it
    window.scrollTo({top:0,left:0,behavior:'instant'});
    return out;
  })()`;

  let engine = null;
  try {
    if (!bin) throw new Error('no engine binary');
    engine = await launch();
    const page = await attach(engine.ws);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    const viewport = async (w, h) => page.send('Emulation.setDeviceMetricsOverride',
      { width: w, height: h, deviceScaleFactor: 1, mobile: true });
    const measure = async (file, cfg, w = 393, h = 852) => {
      await viewport(w, h);
      const loaded = page.once('Page.loadEventFired');
      await page.send('Page.navigate', { url: 'file://' + file });
      await loaded;
      const r = await page.send('Runtime.evaluate', { expression: MEASURE(cfg), returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('measure threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
      return r.result.value;
    };
    const CHAIN = ['body', '.page-wrapper', '.main-content'];
    const RECTS = { bar: '.submit-bar', nav: '.bottom-nav', header: '.app-header',
                    lastCard: '.game-card:last-of-type', tb: '#tb-input' };

    // ── 7a. the root cause itself, measured ──────────────────────────────────
    const long = await measure(fixtures.open14, { computed: [...CHAIN, 'html', '.submit-bar'], rects: RECTS });
    assert(long.viewport.w === 393 && long.viewport.h === 852,
      `the engine really is laid out at 393×852 (got ${long.viewport.w}×${long.viewport.h}) — every number below is in that viewport`);
    for (const sel of CHAIN) {
      const c = long.computed[sel];
      assert(!!c && c.overflowY === 'visible',
        `${sel} computes overflow-y:VISIBLE, so it is not a scroll container and cannot steal the scrollport from the sticky bar (got overflow-x:${c && c.overflowX} / overflow-y:${c && c.overflowY}) — this is the B-c root cause, measured`);
      assert(!!c && c.overflowX === 'clip',
        `${sel} still clips sideways overflow — computed overflow-x:${c && c.overflowX} (clip, the non-scroll-container clipper)`);
    }
    assert(long.maxScroll > 400,
      `fixture check: the 14-game slate really is much taller than one screen (page scrolls ${long.maxScroll}px) — a bar that "pins" on a page that cannot scroll would prove nothing`);

    // ── 7b. THE BUG: pinned above the nav while scrolled, not only at the end ─
    // RE-DERIVED (Home wiring): the pill's offset is --nav-pill-bottom (here, at inset 0, the 16px floor), and the fixed bar carries the disc collar's reach as its disc-specific nudge.
    assert(long.discReach === 8 && long.pillBottom === Math.max(long.navPillGap, long.discReach + 8),
      `the engine resolves the disc tokens: reach ${long.discReach}px (56 pt disc: (56 − 48) / 2 + 4 = 8) and --nav-pill-bottom ${long.pillBottom}px = max(gap ${long.navPillGap}, reach + 8) = ${Math.max(long.navPillGap, long.discReach + 8)}px at inset 0`);
    const pinLine = long.viewport.h - long.navPillH - long.pillBottom - 8 - long.discReach;
    for (const where of ['top', 'mid']) {
      const s = long.samples[where];
      assert(Math.abs(s.bar.bottom - pinLine) <= 1.5,
        `at scroll ${where} (scrollY ${s.scrollY}) the submit bar is PINNED: its bottom is ${s.bar.bottom}px, the pin line is ${pinLine}px (viewport ${long.viewport.h} − pill height ${long.navPillH} − pill offset ${long.pillBottom} − 8 − disc reach ${long.discReach}) — B-c was the bar rendering at its flow position instead, ${Math.round(long.maxScroll)}px down the page`);
      assert(s.bar.top >= 0 && s.bar.bottom <= long.viewport.h,
        `at scroll ${where} the whole bar is inside the viewport (top ${s.bar.top}, bottom ${s.bar.bottom} of ${long.viewport.h}) — Submit is on screen without hunting for it`);
      assert(s.bar.bottom <= s.nav.top - 7,
        `at scroll ${where} the bar clears the fixed bottom nav by ${Math.round(s.nav.top - s.bar.bottom)}px instead of hiding behind it (nav paints above it, z-index 100 vs 50)`);
    }

    // ── 7c/7d. at rest it is back in flow, covering nothing ─────────────────
    for (const n of SLATES) {
      const m = n === 14 ? long : await measure(fixtures['open' + n], { computed: CHAIN, rects: RECTS, scrolls: ['bottom'] });
      const s = m.samples.bottom;
      assert(s.bar.top >= s.tb.bottom,
        `${n}-game slate, scrolled to the end: the bar RESTS below the tiebreaker input rather than sticking over it (bar top ${s.bar.top} ≥ tb bottom ${s.tb.bottom}) — the case a sticky bottom offset alone would not rule out`);
      assert(s.bar.top >= s.lastCard.bottom,
        `${n}-game slate, at the end: the bar covers no part of the last game card (bar top ${s.bar.top} ≥ card bottom ${s.lastCard.bottom})`);
      assert(s.bar.bottom <= s.nav.top,
        `${n}-game slate, at the end: the resting bar is above the nav (bar bottom ${s.bar.bottom} ≤ nav top ${s.nav.top}), fully tappable`);
    }

    // ── 7e. DI-397's pill contract, measured rather than asserted from source ──
    // A floating pill, not a full-bleed bar: it never touches the viewport's
    // true bottom edge (it floats --nav-pill-gap above it), never spans the
    // full width (inset --nav-pill-inset from both sides), and its height
    // never varies with scroll position.
    for (const where of ['top', 'mid', 'bottom']) {
      const s = long.samples[where];
      const gapBelow = long.viewport.h - s.nav.bottom;
      assert(Math.abs(gapBelow - long.pillBottom) <= 0.5,
        `at scroll ${where} the pill floats --nav-pill-bottom (${long.pillBottom}px: the shipped gap, floored for the disc at inset 0) above the true viewport bottom, not flush to it (measured gap ${gapBelow.toFixed(1)}px, nav bottom ${s.nav.bottom} of viewport ${long.viewport.h})`);
      assert(Math.abs(s.nav.h - long.navPillH) <= 0.5,
        `at scroll ${where} the pill's own height is a CONSTANT --nav-pill-h (${long.navPillH}px), never growing (measured ${s.nav.h}px)`);
      assert(s.nav.left > 0 && (long.viewport.w - s.nav.right) > 0,
        `at scroll ${where} the pill is inset from BOTH side edges (left ${s.nav.left}, right-gap ${(long.viewport.w - s.nav.right).toFixed(1)}), never full-bleed left:0;right:0 (viewport ${long.viewport.w}px wide)`);
    }

    // ── 7e2. THE INSTALLED APP: the GAP grows by the inset, the pill's own
    //        HEIGHT does not — the structural fix DI-397 names by name (the
    //        safe-area clearance lives in the pill's POSITION, never inside
    //        its own box height). Reviewer BLOCK round 1's ORIGINAL bug (a
    //        nav that grew by the inset, offset math that didn't) is now a
    //        different-shaped bug to guard against: a pill whose HEIGHT
    //        stayed 48px is correct; the same bug would now look like the
    //        GAP failing to grow, or --nav-bar-clearance (which the bar's
    //        offset reads) failing to move with it. Everything here is
    //        measured against the substituted stylesheet.
    for (const n of [1, 3, 14]) {
      const m = await measure(fixtures['inset' + n],
        { computed: [...CHAIN, '.submit-bar'], rects: RECTS, scrolls: ['top', 'mid', 'bottom'] });
      const navH = m.samples.top.nav.h;
      assert(Math.abs(navH - m.navPillH) <= 0.5,
        `inset variant, ${n}-game slate: the pill's own height is UNCHANGED by the inset — still --nav-pill-h (${m.navPillH}px), measured ${navH}px (the old "nav grows by the inset" shape is retired: DI-397 moves the clearance into the pill's POSITION instead)`);
      const gapBelow = m.viewport.h - m.samples.top.nav.bottom;
      assert(Math.abs(gapBelow - (m.navPillGap + INSET)) <= 0.5,
        `inset variant, ${n}-game slate: the GAP below the pill grows by the inset instead — --nav-pill-gap (${m.navPillGap}px) PLUS the ${INSET}px inset (measured gap ${gapBelow.toFixed(1)}px), which is the whole reason this variant exists`);
      const scrolled = m.maxScroll > 0 ? m.samples.mid : m.samples.top;
      assert(scrolled.bar.bottom <= scrolled.nav.top - 7.5,
        `inset variant, ${n}-game slate: the pinned bar clears the pill (now floating higher, not taller) by ${Math.round(scrolled.nav.top - scrolled.bar.bottom)}px (bar bottom ${scrolled.bar.bottom}, nav top ${scrolled.nav.top}) — without the inset term in --nav-bar-clearance it would land ${INSET}px inside the pill's floated position and the player could not tap Submit at all`);
      assert(scrolled.bar.top >= 0 && scrolled.bar.bottom <= m.viewport.h,
        `inset variant, ${n}-game slate: the whole bar is on screen (top ${scrolled.bar.top}, bottom ${scrolled.bar.bottom} of ${m.viewport.h})`);
      const rest = m.samples.bottom;
      assert(rest.bar.top >= rest.tb.bottom,
        `inset variant, ${n}-game slate, at the end: the resting bar still does not cover #tb-input (bar top ${rest.bar.top} ≥ input bottom ${rest.tb.bottom}) — .main-content's --nav-bar-clearance reserve grows by the same inset the bar's offset does, the same one token both read`);
      assert(rest.bar.top >= rest.lastCard.bottom && rest.bar.bottom <= rest.nav.top,
        `inset variant, ${n}-game slate, at the end: the last game card is not hidden (card bottom ${rest.lastCard.bottom} ≤ bar top ${rest.bar.top}) and the bar is clear of the pill (bar bottom ${rest.bar.bottom} ≤ nav top ${rest.nav.top})`);
    }

    // ── 7f. the two deliberate holds, measured ──────────────────────────────
    assert(long.computed['.submit-bar'].position === 'sticky' && long.computed['.submit-bar'].bottom === `${long.navPillH + long.pillBottom + 8 + long.discReach}px`,
      `the bar's own rule is unchanged but for the disc nudge (clearance + 8 + the collar's reach): position ${long.computed['.submit-bar'].position}, resolved offset ${long.computed['.submit-bar'].bottom} (B-a's calc fix, now doing visible work)`);
    const hdrMid = long.samples.mid.header;
    assert(hdrMid.bottom < 0,
      `.app-header still scrolls away exactly as it does today (its bottom is ${hdrMid.bottom} at scrollY ${long.samples.mid.scrollY}) — RG-188 deliberately does NOT revive its sticky; that is Drew's call and one declaration`);

    // ── 7g. no sideways scroll comes back, at four widths, with a wide child ─
    for (const w of [320, 375, 393, 768]) {
      const m = await measure(fixtures.wide, { computed: CHAIN, rects: { ...RECTS, wide: '#too-wide' }, scrolls: ['top'] }, w, 852);
      assert(m.samples.top.wide.w >= 1200,
        `fixture check at ${w}px: the probe child really is ${m.samples.top.wide.w}px wide, far wider than the viewport — otherwise the next assertion is vacuous (RG-27)`);
      assert(m.userCanScrollSideways === false,
        `at ${w}px wide a 1200px child still cannot be scrolled sideways by the user (scrollX stays 0 after scrollTo(9999)) — overflow-x:clip clips as hard as hidden did; this is what the v14 rules were for`);
      assert(m.doc.scrollWidth <= m.doc.clientWidth + 0.5,
        `at ${w}px the document's scrollWidth (${m.doc.scrollWidth}) never exceeds its clientWidth (${m.doc.clientWidth}) — no phantom sideways overflow`);
    }

    // ── 7h. the submitted/locked view: Edit My Picks stays reachable ─────────
    {
      const m = await measure(fixtures.submitted,
        { computed: CHAIN, rects: { edit: '#edit-picks-btn', nav: '.bottom-nav', bar: '.submit-bar' }, scrolls: ['bottom'] });
      const s = m.samples.bottom;
      assert(s.bar === null,
        'the submitted view renders no .submit-bar at all, so nothing sticky can cover its card (source-asserted in §6, measured here)');
      assert(s.edit && s.edit.bottom <= s.nav.top && s.edit.top >= 0 && s.edit.h >= 40,
        `"✏️ Edit My Picks" is fully on screen and clear of the nav when scrolled to the end (top ${s.edit && s.edit.top}, bottom ${s.edit && s.edit.bottom}, nav top ${s.edit && s.nav.top}, height ${s.edit && s.edit.h}) — the locked decision holds`);
    }

    // ── 7i. the other pages that live inside .main-content ───────────────────
    {
      const m = await measure(fixtures.dashboard,
        { computed: [...CHAIN, '.dashboard-scroll'], rects: { table: '.dashboard-table' }, scrolls: ['top'] });
      assert(m.computed['.dashboard-scroll'].scrollsX === true,
        'the dashboard matrix keeps its OWN internal sideways scroll (.dashboard-scroll{overflow-x:auto} is a scroll container by design) — clip on the ancestors did not flatten it');
      assert(m.userCanScrollSideways === false,
        'the dashboard PAGE still cannot be scrolled sideways even though its table is wider than the phone — the v14 intent, preserved');
    }
    {
      const m = await measure(fixtures.comm,
        { computed: [...CHAIN, '.comm-tabbar', '.batch-grid-scroll'], rects: { tabbar: '.comm-tabbar', nav: '.bottom-nav' }, scrolls: ['top', 'mid'] });
      assert(m.computed['.comm-tabbar'].position === 'relative',
        `the commissioner tab bar is held at position:relative (got ${m.computed['.comm-tabbar'].position}) — it behaves exactly as it does today; pinned at top:0 it would sit under the opaque header`);
      assert(m.samples.mid.tabbar.top < m.samples.top.tabbar.top,
        `the comm tab bar scrolls with the panel as it does today (top ${m.samples.top.tabbar.top} → ${m.samples.mid.tabbar.top})`);
      assert(m.computed['.batch-grid-scroll'].scrollsX === true && m.userCanScrollSideways === false,
        'the commissioner panel\'s wide batch grid keeps its internal sideways scroll while the page itself still has none');
    }

    // ── 7j. UN-212 — the native-shell status-bar backdrop strip, ENGINE-MEASURED
    //       at a real 59px top inset (Dynamic-Island-class), plus the
    //       mutation-proof that the body.native-shell scope is load-bearing. ──
    {
      const PSEUDO_EXPR = `(() => {
        const cs = getComputedStyle(document.body, '::before');
        const header = document.querySelector('.app-header');
        const headerCs = header ? getComputedStyle(header) : null;
        const bar = document.querySelector('.submit-bar');
        const card = document.querySelector('.game-card');
        window.scrollTo({ top: 200, left: 0, behavior: 'instant' });
        const cardTopScrolled = card ? card.getBoundingClientRect().top : null;
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
        return {
          content: cs.content, height: cs.height, position: cs.position,
          top: cs.top, left: cs.left, right: cs.right, zIndex: cs.zIndex,
          pointerEvents: cs.pointerEvents, bg: cs.backgroundColor, bgImage: cs.backgroundImage,
          headerBg: headerCs ? headerCs.backgroundColor : null,
          headerZ: headerCs ? headerCs.zIndex : null,
          barZ: bar ? getComputedStyle(bar).zIndex : null,
          pageBg: getComputedStyle(document.body).backgroundColor,
          cardTopScrolled,
        };
      })()`;
      const measurePseudo = async file => {
        await viewport(393, 852);
        const loaded = page.once('Page.loadEventFired');
        await page.send('Page.navigate', { url: 'file://' + file });
        await loaded;
        const r = await page.send('Runtime.evaluate', { expression: PSEUDO_EXPR, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('measurePseudo threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
        return r.result.value;
      };

      // ── native: the band renders. SB-08 (2026-09-30) CONVERTED [7j-b/c/d]
      //    from RG-209's strip (inset-tall, z-index 150, painted the header's
      //    --maroon) to option O2b's soft edge, Drew's pick: inset + 12px tall,
      //    UNDER the header (z 90 < 100) so the header still covers it at
      //    rest, above page content and the submit bar (50), painted from the
      //    PAGE's --bg at 78% → 62% → clear and never from the header's colour.
      //    The legibility RG-209 bought with paint is now bought by the glyph
      //    style following the surface (§7l). Each check still detects the
      //    defect it exists for: a band that is missing, mis-sized, mis-stacked
      //    or header-coloured fails here.
      const native = await measurePseudo(fixtures.topInsetNative);
      assert(native.content !== 'none',
        `[7j-a] native-shell: the ::before is actually generated (content computed to ${JSON.stringify(native.content)}, not "none")`);
      assert(native.height === `${TOPINSET + SOFT_EDGE}px`,
        `[7j-b] native-shell: the soft edge is the substituted inset PLUS its ${SOFT_EDGE}px overhang (got ${native.height}, expected ${TOPINSET + SOFT_EDGE}px)`);
      assert(native.position === 'fixed' && native.top === '0px' && native.zIndex === '90' && native.pointerEvents === 'none'
        && Number(native.headerZ) > 90 && Number(native.barZ) < 90,
        `[7j-c] native-shell: position:fixed, top:0, z-index:90, pointer-events:none, and in the engine's own stacking BELOW the header (${native.headerZ}) and ABOVE the submit bar (${native.barZ}) (got position=${native.position} top=${native.top} zIndex=${native.zIndex} pointerEvents=${native.pointerEvents})`);
      {
        const stops = cssColors(native.bgImage);
        const page = cssColors(native.pageBg)[0];
        const hdr = cssColors(native.headerBg)[0];
        const near = (a, b, t = 2) => !!a && !!b && Math.abs(a[0] - b[0]) <= t && Math.abs(a[1] - b[1]) <= t && Math.abs(a[2] - b[2]) <= t;
        const alphas = stops.map(s => +s[3].toFixed(2));
        assert(stops.length === 3 && near(stops[0], page) && near(stops[1], page) && alphas[0] === 0.78 && alphas[1] === 0.62 && alphas[2] === 0
          && cssColors(native.bg)[0]?.[3] === 0,
          `[7j-d] native-shell: the band is a gradient of the PAGE's own resolved colour (${native.pageBg}) at alpha ${alphas.join(' → ')} (expected 0.78 → 0.62 → 0) on a transparent background-color — read off the engine, not the source (got ${native.bgImage})`);
        assert(!!hdr && stops.every(s => !near(s, hdr, 8)),
          `[7j-d2] native-shell: no stop of the band is the HEADER's colour (${native.headerBg}) — SB-08's "all color in the header should scroll up and away", at the source of the paint`);
      }
      assert(native.cardTopScrolled !== null && native.cardTopScrolled < TOPINSET,
        `[7j-e] fixture check: scrolled, the first game card's own top (${native.cardTopScrolled}px) rises above the ${TOPINSET}px inset band — this is the exact "content slides up underneath" case the strip exists to sit above (proves the scenario is real, not that the strip fixes the card's own position, which it never moves)`);

      // ── web (unmutated, real scoped rule): the strip must NOT exist at all ──
      const web = await measurePseudo(fixtures.topInsetWeb);
      assert(web.content === 'none',
        `[7j-f] web (no native-shell class), REAL scoped rule: no ::before is generated at all (content computed to ${JSON.stringify(web.content)}) — the scope holds, measured in a real engine, not just read from source`);

      // ── mutation-proof: web against the MUTATED sheet (scope stripped) ⇒ RED
      const webMutated = await measurePseudo(fixtures.topInsetWebMutated);
      assert(webMutated.content !== 'none',
        `[7j-g] MUTATION-PROOF: web (no native-shell class) against the MUTATED stylesheet (body.native-shell prefix stripped from the strip rule) DOES now generate the ::before (content computed to ${JSON.stringify(webMutated.content)}) — i.e. [7j-f]'s "no strip on web" assertion goes RED under this mutation, proving [7j-f] is not vacuously true against the real file`);
    }

    // ── 7k. SB-08 STATUS-BAR-STRIP (Drew, 2026-09-30, iOS/TestFlight):
    //   "On ios when I scroll up the bottom of the header disappears (intended
    //    behavior), but there is still a row of color on my iphone just
    //    underneath the floating island and my camera. All color in the
    //    header should scroll up and away and you should be able to see the
    //    page continue to scroll underneath the camera and time/battery/wifi
    //    icon, etc"
    // What the engine PAINTS in the top safe-area band [0, TOPINSET) at a
    // 59px Dynamic-Island inset, sampled from a real screenshot — the band
    // is exactly where the reported "row of color" sits. The contract, both
    // front ends:
    //   k-1/k-2  header at rest: the header's own color fills the whole band
    //            (the header covers the safe area whenever it is back);
    //   k-3/k-4  header scrolled away: NO band row is predominantly the
    //            header's color — it scrolled up and away with the header —
    //            and page content really is passing under the band;
    //   k-5/k-6  mutation proof — RG-209's strip forced back in goes RED,
    //            removed goes GREEN, so the detector measures the paint.
    // Option-neutral by design: whatever keeps the status glyphs legible
    // (RG-209's guarantee — see the SB-08 option set) must not paint the
    // HEADER's color into the band once the header has left it.
    {
      const BAND_SHARE = 0.5;   // a row counts as "header-colored" when ≥ half of it is
      const TOL = 4;            // per-channel tolerance (anti-aliasing / color management)
      const frames = n => `new Promise(r => { let k = ${n}; const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })`;
      const shootBand = async (file, scrollY) => {
        await viewport(393, 852);
        const loaded = page.once('Page.loadEventFired');
        await page.send('Page.navigate', { url: 'file://' + file });
        await loaded;
        const r = await page.send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
          window.scrollTo({ top: ${scrollY}, left: 0, behavior: 'instant' });
          await ${frames(3)};
          const h = document.querySelector('.app-header').getBoundingClientRect();
          const card = document.querySelector('.game-card').getBoundingClientRect();
          return { scrollY: Math.round(window.scrollY), headerBottom: h.bottom, cardTop: card.top,
                   headerBg: getComputedStyle(document.querySelector('.app-header')).backgroundColor };
        })()` });
        if (r.exceptionDetails) throw new Error('shootBand threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
        const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
        const img = decodePng(Buffer.from(shot.data, 'base64'));
        const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(r.result.value.headerBg);
        const hdr = m ? [+m[1], +m[2], +m[3]] : null;
        let headerRows = 0, rows = 0;
        for (let y = 0; y < Math.min(TOPINSET, img.h); y += 2) {
          let hits = 0, n = 0;
          for (let x = 0; x < img.w; x += 3) {
            const [pr, pg, pb] = img.px(x, y); n++;
            if (hdr && Math.abs(pr - hdr[0]) <= TOL && Math.abs(pg - hdr[1]) <= TOL && Math.abs(pb - hdr[2]) <= TOL) hits++;
          }
          rows++; if (hits / n >= BAND_SHARE) headerRows++;
        }
        return { ...r.result.value, hdr, img: { w: img.w, h: img.h }, headerRows, rows };
      };

      const SCROLLED = 200;   // > the header's full height, so it has certainly left the band
      for (const [label, file] of [['native', fixtures.topInsetNative], ['web', fixtures.topInsetWeb]]) {
        const rest = await shootBand(file, 0);
        assert(rest.img.w === 393 && rest.img.h === 852 && !!rest.hdr,
          `[7k-0] ${label}: fixture check — the screenshot is the 393×852 viewport (${rest.img.w}×${rest.img.h}) and the header's resolved color parsed (${rest.headerBg})`);
        assert(rest.headerRows === rest.rows,
          `[7k-1/2] ${label}, header AT REST: every sampled row of the ${TOPINSET}px safe-area band is the header's own color (${rest.headerRows}/${rest.rows} rows) — when the header is back it covers the safe area, exactly as today`);
        const up = await shootBand(file, SCROLLED);
        assert(up.headerBottom < 0 && up.cardTop < TOPINSET,
          `[7k-3] ${label}: fixture check — at scrollY ${up.scrollY} the header has fully left the viewport (bottom ${up.headerBottom.toFixed(1)}px) and page content has scrolled up into the band (first card top ${up.cardTop.toFixed(1)}px < ${TOPINSET}px)`);
        assert(up.headerRows === 0,
          `[7k-4] ${label}, header SCROLLED AWAY: no row of the ${TOPINSET}px band under the Dynamic Island is still predominantly the header's color (${up.headerRows}/${up.rows} rows are) — SB-08: "all color in the header should scroll up and away"`);
      }

      // ── mutation proof: the detector measures the band paint, both ways ──
      const forced = await shootBand(fixtures.topInsetNativeStripForced, SCROLLED);
      assert(forced.headerRows === forced.rows,
        `[7k-5] MUTATION-PROOF: with RG-209's strip forced back into the sheet, the scrolled band is header-colored in ${forced.headerRows}/${forced.rows} rows — [7k-4] goes RED on exactly the reported bug`);
      const absent = await shootBand(fixtures.topInsetNativeStripAbsent, SCROLLED);
      assert(absent.headerRows === 0,
        `[7k-6] MUTATION-PROOF: with every body.native-shell::before rule removed, the scrolled band carries no header color (${absent.headerRows}/${absent.rows} rows) — the strip is the ONLY thing that painted it`);
      // SB-08 fix — the z-order is load-bearing: the same soft edge raised
      // above the header (RG-209's 150) washes the header at rest.
      const above = await shootBand(fixtures.topInsetNativeBandAbove, 0);
      assert(above.headerRows < above.rows,
        `[7k-7] MUTATION-PROOF: with the soft edge raised to z-index 150 (above the header), the header AT REST no longer fills the band (${above.headerRows}/${above.rows} rows) — [7k-1/2] goes RED, so the real band's z-index 90 is what keeps the header whole while it is there`);
    }

    // ── 7l. SB-08 — THE GLYPH TRACKER (js/status-bar.js), the real file, in
    //    the real engine, against the real stylesheet at a 59px inset.
    //    O2b removes the painted backdrop, so the status glyphs' legibility
    //    now rests entirely on the STYLE following the surface under them:
    //      l-1  header at rest   → surface 'chrome', read from --chrome-bg,
    //           which resolves to the header's OWN colour on every look
    //           (not frozen to the default crimson — the SB-10 shape);
    //      l-2  header scrolled away → surface 'page', read from --bg, and
    //           the style is the one that look's luminance calls for;
    //      l-3  every frame of a scroll sweep over dark AND light logo discs:
    //           the chosen glyph colour against what is actually PAINTED in
    //           the clock and icon boxes, 10th percentile ≥ 3:1 (WCAG for
    //           large text and graphics; the option renders measured 0 of
    //           126 frames under it);
    //      l-4  MUTATION-PROOF: the same frames judged with today's constant
    //           'DARK' go under 3:1 on every light look — the tracker is
    //           what makes the soft edge legible, not an accident;
    //      l-5…7 surfaces other than header/page: an opaque gate wins, a
    //           translucent scrim does not, the Chat tab's hidden header;
    //      l-8  the LIVE tracker with a StatusBar stub: one call per flip,
    //           driven by real scroll events and a real MutationObserver.
    {
      const SB_URL = 'data:text/javascript;base64,' + Buffer.from(readFileSync(here + 'js/status-bar.js', 'utf8')).toString('base64');
      const settle = `new Promise(r => { let k = 3; const f = () => (--k <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); })`;
      const GLYPH_BOXES = [[44, 18, 90, 39], [278, 22, 352, 36]];   // CSS px: the clock, and signal/wifi/battery (393pt iPhone)
      const evalIn = async expr => {
        const r = await page.send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.exceptionDetails) throw new Error('§7l eval threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
        return r.result.value;
      };
      const openLogos = async () => {
        await viewport(393, 852);
        const loaded = page.once('Page.loadEventFired');
        await page.send('Page.navigate', { url: 'file://' + fixtures.topInsetNativeLogos });
        await loaded;
        await evalIn(`(async () => { window.__sb = await import(${JSON.stringify(SB_URL)}); return true; })()`);
      };
      const setLook = (cls, scheme) => evalIn(`(() => {
        document.body.className = 'native-shell ' + ${JSON.stringify(cls)};
        ${scheme ? `document.body.setAttribute('data-color-scheme', ${JSON.stringify(scheme)});` : `document.body.removeAttribute('data-color-scheme');`}
        document.body.setAttribute('data-tab', 'picks');
        return true; })()`);
      const resolveAt = y => evalIn(`(async () => {
        window.scrollTo({ top: ${y}, left: 0, behavior: 'instant' });
        await ${settle};
        const s = window.__sb.resolveGlyphSurface(document, window);
        return { ...s, style: window.__sb.statusBarStyleFor(s.color), scrollY: Math.round(scrollY),
          headerBg: getComputedStyle(document.querySelector('.app-header')).backgroundColor,
          pageBg: getComputedStyle(document.body).backgroundColor };
      })()`);
      // CDP's `clip` is in DOCUMENT coordinates: the viewport's top band at
      // scrollY s is clip y = s (a clip at y 0 on a scrolled page captures the
      // blank space above the viewport — measured, 2026-09-30).
      const glyphP10 = async (rgb, scrollY) => {
        const shot = await page.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, clip: { x: 0, y: scrollY, width: 393, height: TOPINSET, scale: 1 } });
        const img = decodePng(Buffer.from(shot.data, 'base64'));
        const cs = [];
        for (const [x0, y0, x1, y1] of GLYPH_BOXES) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) cs.push(contrastOf(rgb, img.px(x, y)));
        cs.sort((a, b) => a - b);
        return { p10: cs[Math.floor(cs.length * 0.1)], min: cs[0] };
      };
      const GLYPH_RGB = { DARK: [255, 255, 255], LIGHT: [0, 0, 0] };   // Capacitor 'DARK' = light content

      await openLogos();
      const themeKeys = [...new Set([...cssSrc.matchAll(/body\.theme-([a-z]+)\b/g)].map(m => m[1]))];
      assert(themeKeys.length >= 7 && themeKeys.includes('neutral'),
        `[7l-0] fixture check: every look in the stylesheet is swept (${themeKeys.join(', ')}), each on BOTH sides (SP-52: 20 sides) — a sweep of one look would prove nothing about the rest`);
      // SP-52 (2026-10-01) — OLD: every look on its default side + Munera Night (8 sides). NEW: every look on BOTH sides, pinned (20 sides: the ten looks x Light/Night), because DI-454's
      // claim is a statement about all of them ("Munera, Paper, Ink, all six schools and Graphite Dark take light glyphs; Graphite Light alone takes dark glyphs").
      const SIDES = themeKeys.flatMap(k => [['light', 'Light'], ['dark', 'Night']].map(([sch, nm]) => ({ label: `${k} (${nm})`, cls: 'theme-' + k, scheme: sch })));
      const restLight = [];
      // 0 … 960px every 24px (the header's exit, then every disc colour under
      // the clock), plus every 2px across the header's exit (56 … 100px).
      const SWEEP = [...new Set([...Array.from({ length: 41 }, (_, i) => i * 24), ...Array.from({ length: 23 }, (_, i) => 56 + i * 2)])].sort((a, b) => a - b);
      // THE STRADDLE. While the header's bottom edge (its 3px gold rule
      // included) is physically crossing the glyph band, the glyphs sit half
      // on the header and half on the page and no single glyph colour can
      // suit both halves. The tracker flips at the glyph MIDLINE, which keeps
      // the mismatched half smallest, and the plugin cross-fades the flip.
      // §7l-3 holds every other frame to 3:1; §7l-3t proves the sub-3:1
      // frames are ONLY these, and that the window is no wider than the band.
      const BAND_TOP = Math.min(...GLYPH_BOXES.map(b => b[1])), BAND_BOTTOM = Math.max(...GLYPH_BOXES.map(b => b[3]));
      const RULE = 3;
      const straddles = headerBottom => headerBottom > BAND_TOP && headerBottom - RULE < BAND_BOTTOM;
      for (const side of SIDES) {
        await setLook(side.cls, side.scheme);
        const rest = await resolveAt(0);
        const restHdr = cssColors(rest.headerBg)[0], restTok = cssColors(rest.color)[0] || parseHex(rest.color);
        // [7l-1] RE-DERIVED by SP-52 (2026-10-01, DI-454) — OLD: `rest.style === 'DARK'` (white glyphs) on every look, because every header was crimson. NEW: the style at rest is the
        // one the HEADER's luminance calls for — white glyphs on every look's header except Graphite Light's white one, which takes dark glyphs (pinned by [7l-1b] below).
        const wantRest = restHdr && lumOf(restHdr) >= 0.179 ? 'LIGHT' : 'DARK';
        if (rest.style === 'LIGHT') restLight.push(side.label);
        assert(rest.surface === 'chrome' && !!restTok && !!restHdr && restTok.slice(0, 3).every((v, i) => Math.abs(v - restHdr[i]) <= 1) && rest.style === wantRest,
          `[7l-1] ${side.label}, header AT REST: the glyphs sit on the header — surface ${rest.surface}, --chrome-bg ${rest.color} IS the header's own ${rest.headerBg}, style ${rest.style} (want ${wantRest} by the header's luminance: ${wantRest === 'DARK' ? 'white glyphs' : 'dark glyphs'})`);
        const up = await resolveAt(300);
        const pageRgb = cssColors(up.pageBg)[0], tok = parseHex(up.color) || cssColors(up.color)[0];
        const wantStyle = lumOf(pageRgb) >= 0.179 ? 'LIGHT' : 'DARK';
        assert(up.surface === 'page' && !!tok && tok.slice(0, 3).every((v, i) => Math.abs(v - pageRgb[i]) <= 1) && up.style === wantStyle,
          `[7l-2] ${side.label}, header SCROLLED AWAY: the glyphs sit on the page under the soft edge — surface ${up.surface}, --bg ${up.color} (page ${up.pageBg}), style ${up.style} (want ${wantStyle} by luminance)`);
        let below = 0, worst = Infinity, worstMin = Infinity, constBelow = 0, settled = 0;
        const straddleYs = [], straddleBelow = [], belowOutside = [];
        for (const y of SWEEP) {
          const at = await resolveAt(y);
          const hb = await evalIn(`document.querySelector('.app-header').getBoundingClientRect().bottom`);
          const { p10, min } = await glyphP10(GLYPH_RGB[at.style], at.scrollY);
          if (straddles(hb)) {
            straddleYs.push(at.scrollY);
            if (p10 < 3) straddleBelow.push(`${at.scrollY}px ${p10.toFixed(2)}:1`);
            continue;
          }
          settled++;
          if (p10 < 3) { below++; belowOutside.push(`${at.scrollY}px (header bottom ${hb}) ${p10.toFixed(2)}:1`); }
          worst = Math.min(worst, p10); worstMin = Math.min(worstMin, min);
          if (at.style !== 'DARK') { if ((await glyphP10(GLYPH_RGB.DARK, at.scrollY)).p10 < 3) constBelow++; }
          else if (p10 < 3) constBelow++;
        }
        assert(below === 0 && settled >= 50,
          `[7l-3] ${side.label}: over ${settled} scroll frames (0…${SWEEP[SWEEP.length - 1]}px, dark and light logos passing under the clock) where the header's edge is NOT crossing the glyphs, no frame's glyph contrast falls under 3:1 at the 10th percentile (${below} do${belowOutside.length ? ': ' + belowOutside.join(', ') : ''}; worst p10 ${worst.toFixed(2)}:1, worst pixel ${worstMin.toFixed(2)}:1)`);
        const span = straddleYs.length ? Math.max(...straddleYs) - Math.min(...straddleYs) : 0;
        assert(straddleYs.length > 0 && span <= (BAND_BOTTOM - BAND_TOP) + RULE,
          `[7l-3t] ${side.label}: the ONLY frames held out of [7l-3] are the straddle — the header's own edge crossing the ${BAND_TOP}…${BAND_BOTTOM}px glyph band — and that window is ${span}px of scroll (≤ the band plus the rule, ${(BAND_BOTTOM - BAND_TOP) + RULE}px); measured inside it: ${straddleBelow.length ? straddleBelow.join(', ') : 'none under 3:1'} — the flip is at the glyph midline and the plugin cross-fades it (device check)`);
        if (wantStyle === 'LIGHT') {
          assert(constBelow > 0,
            `[7l-4] ${side.label}: MUTATION-PROOF — judged with today's constant 'DARK' (white glyphs), ${constBelow}/${settled} of the same settled frames fall under 3:1, so [7l-3] goes RED without the tracker`);
        }
      }

      assert(restLight.length === 1 && restLight[0] === 'graphite (Light)',
        `[7l-1b] DI-454: across all ${SIDES.length} sides the header AT REST takes dark glyphs on Graphite Light alone (white header) and white glyphs everywhere else — got dark glyphs on: ${restLight.join(', ') || 'none'}`);

      // l-5…7 — the other surfaces, on Munera (light).
      await setLook('theme-neutral', null);
      const gate = await evalIn(`(async () => {
        const g = document.createElement('div'); g.id = 'sb08-gate';
        g.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#14110E';
        document.body.appendChild(g);
        window.scrollTo({ top: 300, left: 0, behavior: 'instant' }); await ${settle};
        const s = window.__sb.resolveGlyphSurface(document, window); g.remove();
        return { ...s, style: window.__sb.statusBarStyleFor(s.color) };
      })()`);
      assert(gate.surface === 'overlay' && gate.style === 'DARK',
        `[7l-5] an OPAQUE overlay above the page (the Ink sign-in gate) is what the glyphs sit on, whatever the page beneath is doing — surface ${gate.surface} ${gate.color}, style ${gate.style}`);
      const scrim = await evalIn(`(async () => {
        const g = document.createElement('div'); g.className = 'modal-overlay'; g.id = 'sb08-scrim';
        document.body.appendChild(g);
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); await ${settle};
        const a = window.__sb.resolveGlyphSurface(document, window);
        window.scrollTo({ top: 300, left: 0, behavior: 'instant' }); await ${settle};
        const b = window.__sb.resolveGlyphSurface(document, window); g.remove();
        return { rest: { ...a, style: window.__sb.statusBarStyleFor(a.color) }, up: { ...b, style: window.__sb.statusBarStyleFor(b.color) } };
      })()`);
      assert(scrim.rest.surface === 'chrome' && scrim.rest.style === 'DARK' && scrim.up.surface === 'page' && scrim.up.style === 'LIGHT',
        `[7l-6] a TRANSLUCENT scrim (.modal-overlay) tints rather than replaces: at rest the glyphs still follow the header (${scrim.rest.surface}/${scrim.rest.style}), scrolled the page (${scrim.up.surface}/${scrim.up.style})`);
      const chat = await evalIn(`(async () => {
        document.body.setAttribute('data-tab', 'chat');
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); await ${settle};
        const s = window.__sb.resolveGlyphSurface(document, window);
        const hidden = getComputedStyle(document.querySelector('.app-header')).display;
        document.body.setAttribute('data-tab', 'picks');
        return { ...s, style: window.__sb.statusBarStyleFor(s.color), hidden };
      })()`);
      assert(chat.hidden === 'none' && chat.surface === 'page' && chat.style === 'LIGHT',
        `[7l-7] the Chat tab hides the header (display ${chat.hidden}), so even at scrollY 0 the glyphs follow the page — surface ${chat.surface}, style ${chat.style}`);

      // l-8 — the LIVE tracker: real scroll events, a real MutationObserver.
      const live = await evalIn(`(async () => {
        const calls = [], bgs = [];
        const plugin = { setStyle: o => calls.push(o.style), setBackgroundColor: o => bgs.push(o.color) };
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); await ${settle};
        const t = window.__sb.createStatusBarTracker({ doc: document, win: window, isNative: () => true, getPlugin: () => plugin });
        t.install(); await ${settle};
        const marks = { install: calls.slice() };
        for (let y = 20; y <= 400; y += 20) { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); await ${settle}; }
        marks.scrolled = calls.slice();
        const g = document.createElement('div'); g.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#14110E';
        document.body.appendChild(g); await ${settle};
        marks.gate = calls.slice();
        g.remove(); await ${settle};
        marks.ungate = calls.slice();
        for (let y = 380; y >= 0; y -= 20) { window.scrollTo({ top: y, left: 0, behavior: 'instant' }); await ${settle}; }
        marks.back = calls.slice();
        return { marks, bgs };
      })()`);
      const m = live.marks;
      assert(JSON.stringify(m.install) === '["DARK"]' && JSON.stringify(m.scrolled) === '["DARK","LIGHT"]',
        `[7l-8a] live: installed at rest → ${JSON.stringify(m.install)}; twenty scroll steps down past the header → ${JSON.stringify(m.scrolled)} — ONE bridge call for the one flip, not one per scroll event`);
      assert(JSON.stringify(m.gate) === '["DARK","LIGHT","DARK"]' && JSON.stringify(m.ungate) === '["DARK","LIGHT","DARK","LIGHT"]',
        `[7l-8b] live: an opaque gate mounted on <body> flips the glyphs with no scroll at all (${JSON.stringify(m.gate)}), and unmounting it flips them back (${JSON.stringify(m.ungate)}) — the MutationObserver, not a scroll, drove both`);
      assert(JSON.stringify(m.back) === '["DARK","LIGHT","DARK","LIGHT","DARK"]' && live.bgs.length === 1 && /^#8C1515$/i.test(live.bgs[0]),
        `[7l-8c] live: scrolling back to the top returns the header's white glyphs (${JSON.stringify(m.back)}); the Android-only background was sent once, from --chrome-bg (${JSON.stringify(live.bgs)})`);
    }

    // ── 7m. THE HOME DISC (Home wiring, 2026-10-01; DESIGN_NEEDS_HOME Amendment 3 + 3.1, Drew: "vertically centered on the tab bar with an equal overhang on the top and bottom", 56 pt,
    //        "I don't want pages to leave more room at the bottom"). The REAL index.html nav markup + the REAL styles.css, laid out in the engine at bottom insets 0 / 21 (Face ID landscape) /
    //        34 (Face ID portrait), Home selected. Everything here is MEASURED, none of it asserted from source.
    {
      const sheetAt = (n, f = x => x, tag = n) => { const file = join(tmp, `styles-disc-${tag}.css`); writeFileSync(file, f(cssSrc.replace(/env\(\s*safe-area-inset-bottom\s*(?:,[^)]*)?\)/g, n + 'px'))); return 'file://' + file; };
      const NOREACH = x => { const y = x.split('+ var(--nav-pill-bottom) + var(--nav-disc-reach)))').join('+ var(--nav-pill-bottom)))'); return y; };
      const discFix = (name, css) => fixture(name, { tab: 'home', sectionId: 'page-home', css, inner: '<div id="home-root"><p>Home</p></div><div id="auth-banner-stack"><div class="auth-banner">Session expired</div></div><div class="update-available-banner">Update available</div>' });
      discFix('disc0', cssHref); discFix('disc21', sheetAt(21)); discFix('disc34', sheetAt(34));
      discFix('discNoReach34', sheetAt(34, NOREACH, '34nr').replace('styles-disc-34nr', 'styles-disc-34nr'));
      // review N2 (2026-10-02): the SAME fixture with both banners put back at the bare clearance (the shipped rule) — the clearance detector below must see them overlap the collar
      discFix('discBannerBare34', sheetAt(34, (x) => x.split('bottom:calc(var(--nav-bar-clearance) + var(--nav-disc-reach) + 8px)').join('bottom:var(--nav-bar-clearance)'), '34nb'));
      const PROBE = `(() => {
        const R = e => e.getBoundingClientRect();
        const nav = document.querySelector('.bottom-nav'), disc = document.querySelector('.nav-home-disc'), btn = document.querySelector('.nav-item[data-tab="home"]');
        const len = v => { const p = document.createElement('div'); p.style.cssText = 'position:absolute;visibility:hidden;height:' + v; document.body.appendChild(p); const h = parseFloat(getComputedStyle(p).height); p.remove(); return h; };
        const ring = len('var(--nav-disc-ring)'), reach = len('var(--nav-disc-reach)'), clearance = len('var(--nav-bar-clearance)'), pillBottom = len('var(--nav-pill-bottom)');
        const n = R(nav), d = R(disc), b = R(btn), vh = innerHeight;
        const cx = (d.left + d.right) / 2, topPt = d.top + 1, botPt = d.bottom - 1;
        const inBtn = (x, y) => { const e = document.elementFromPoint(x, y); return !!(e && e.closest && e.closest('.nav-item[data-tab="home"]')); };
        const bR = (sel) => { const e = document.querySelector(sel); return e ? R(e) : null; };
        const authB = bR('#auth-banner-stack'), updB = bR('.update-available-banner');
        const out = { vh, ring, reach, clearance, pillBottom,
          bannerGap: { auth: authB ? (d.top - ring) - authB.bottom : null, update: updB ? (d.top - ring) - updB.bottom : null }, pill: { top: n.top, bottom: n.bottom, h: n.height }, disc: { top: d.top, bottom: d.bottom, h: d.height, w: d.width, left: d.left, right: d.right },
          overAbove: n.top - d.top, overBelow: d.bottom - n.bottom, dyCenter: (d.top + d.bottom) / 2 - (n.top + n.bottom) / 2, dxCenter: cx - (b.left + b.right) / 2,
          hitTop: inBtn(cx, topPt), hitBottom: inBtn(cx, botPt), hitCollar: inBtn(cx, d.top - 3), hitFarSide: inBtn(d.right + 2, (d.top + d.bottom) / 2),
          active: btn.classList.contains('active') && btn.getAttribute('aria-current') === 'page' };
        const gl = t => { const s = document.querySelector('.nav-item[data-tab="' + t + '"] svg'); return s ? R(s) : null; };
        const dash = gl('dashboard'), chat = gl('chat');
        out.gapLeft = dash ? d.left - ring - dash.right : null; out.gapRight = chat ? chat.left - (d.right + ring) : null;
        out.minTab = Math.min(...[...document.querySelectorAll('.nav-item')].map(e => R(e).width));
        const roof = document.querySelector('.nav-home-disc .home-roof'), cs = getComputedStyle(disc);
        out.roofFill = getComputedStyle(roof).fill; out.discColor = cs.color; out.discBg = cs.backgroundColor;
        out.ringOpacity = getComputedStyle(disc, '::after').opacity;
        const collarTopAfter = (setup) => { setup(); nav.style.transition = 'none'; void nav.offsetHeight; const dd = R(disc); const t = dd.top - ring; return { collarTop: t, visible: Math.max(0, vh - t) }; };
        out.hiddenClass = collarTopAfter(() => nav.classList.add('nav-hidden')); nav.classList.remove('nav-hidden');
        out.hiddenKeyboard = collarTopAfter(() => document.body.setAttribute('data-keyboard-up', '')); document.body.removeAttribute('data-keyboard-up');
        return out;
      })()`;
      const probeAt = async (file, w = 393, h = 852) => {
        await viewport(w, h);
        const loaded = page.once('Page.loadEventFired');
        await page.send('Page.navigate', { url: 'file://' + file });
        await loaded;
        const r = await page.send('Runtime.evaluate', { expression: PROBE, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw new Error('disc probe threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
        return r.result.value;
      };
      for (const [name, inset] of [['disc0', 0], ['disc21', 21], ['disc34', 34]]) {
        for (const w of [320, 375, 430]) {
          const m = await probeAt(fixtures[name], w);
          const tag = `[7m] inset ${inset}, ${w} wide`;
          assert(m.disc.h === 56 && m.disc.w === 56 && m.reach === 8 && m.ring === 4,
            `${tag}: the disc is a 56 pt circle (Drew: "prefer 56 pt") with a 4 pt collar ring and an 8 pt reach (measured ${m.disc.w} x ${m.disc.h}, ring ${m.ring}, reach ${m.reach})`);
          assert(Math.abs(m.overAbove - m.overBelow) <= 0.5 && Math.abs(m.overAbove - 4) <= 0.5,
            `${tag}: EQUAL overhang above and below the 48 pt pill, each (56 − 48) / 2 = 4 pt (measured ${m.overAbove.toFixed(2)} above, ${m.overBelow.toFixed(2)} below) — Drew's words, "an equal overhang on the top and bottom"`);
          assert(Math.abs(m.dyCenter) <= 0.5 && Math.abs(m.dxCenter) <= 0.5,
            `${tag}: the disc is vertically CENTERED on the tab bar (centre off by ${m.dyCenter.toFixed(2)} pt) and centred on its own button (${m.dxCenter.toFixed(2)} pt): flex-centred, never translated`);
          assert(m.vh - (m.disc.bottom + m.ring) >= 8 - 0.5 && m.vh - m.disc.bottom >= 8 - 0.5,
            `${tag}: the collar keeps ≥ 8 pt from the screen edge and the fill ≥ 8 pt (measured collar ${(m.vh - m.disc.bottom - m.ring).toFixed(1)}, fill ${(m.vh - m.disc.bottom).toFixed(1)}) — the floor in --nav-pill-bottom (${m.pillBottom})`);
          assert(m.hitTop && m.hitBottom && !m.hitCollar,
            `${tag}: a tap on the disc's overhang above and below is the HOME button (it is a descendant), and 3 pt above the fill (the painted collar, outside the pill) is not: the collar is a box-shadow, never hit-testable`);
          assert(m.gapLeft >= 8 && m.gapRight >= 8 && m.minTab >= 44,
            `${tag}: the collar is ≥ 8 pt from both neighbouring glyphs (measured ${m.gapLeft && m.gapLeft.toFixed(1)} / ${m.gapRight && m.gapRight.toFixed(1)}) and no tab is under 44 pt wide (narrowest ${m.minTab.toFixed(1)})`);
          assert(m.bannerGap.auth !== null && m.bannerGap.update !== null && m.bannerGap.auth >= 8 - 0.5 && m.bannerGap.update >= 8 - 0.5,
            `${tag}: the two fixed banners (#auth-banner-stack, .update-available-banner) sit >= 8 pt ABOVE the disc's collar (measured ${m.bannerGap.auth && m.bannerGap.auth.toFixed(1)} / ${m.bannerGap.update && m.bannerGap.update.toFixed(1)}): they paint above the nav's z-index and used to cover the disc's top 8 pt (review N2)`);
          assert(m.hiddenClass.visible <= 0.5 && m.hiddenKeyboard.visible <= 0.5,
            `${tag}: with .nav-hidden, and with the keyboard up, 0 px of the pill OR the disc's collar remains on screen (collar top ${m.hiddenClass.collarTop.toFixed(1)} / ${m.hiddenKeyboard.collarTop.toFixed(1)} of ${m.vh}): no sliver`);
        }
        const m = await probeAt(fixtures[name]);
        assert(m.clearance === 48 + m.pillBottom && (inset >= 8 ? m.clearance === 48 + 8 + inset : m.clearance === 64),
          `[7m] inset ${inset}: --nav-bar-clearance is ${m.clearance}px = ${inset >= 8 ? 'the SHIPPED 48 + 8 + ' + inset + ' (the disc added NO room at the bottom: Drew, 2026-10-01)' : '48 + the floored pill offset 16 (the pill must not cover the composer where there is no inset)'}`);
        assert(m.active && /^rgb\(\d+, \d+, \d+\)$/.test(m.discBg) && m.roofFill === m.discColor && Number(m.ringOpacity) === 1,
          `[7m] inset ${inset}: Home selected: the roof is FILLED with the disc's reversed-out colour (${m.roofFill}) and the 2 px inner ring is fully visible (opacity ${m.ringOpacity}): shapes, not colour alone`);
      }
      // ── the CHAT composer vs the collar (Drew M-11 Q2 "lift", 2026-10-02): with the keyboard DOWN the composer's bottom edge sits >= 8 pt clear of the disc's collar on every phone; with the keyboard UP
      //    the gap above the keyboard is unchanged (8 pt, the nav and its collar are hidden). A chat page fixture: the real #page-chat.active rules, a flex-filling thread and a composer at the bottom.
      {
        const chatFix = (name, css) => fixture(name, { tab: 'chat', sectionId: 'page-chat', css, inner: '<div style="flex:1 1 auto;min-height:0;overflow:auto">thread</div><div id="cmp" class="chat-composer" style="flex:none;height:56px">composer</div>' });
        const CHATGAP = (cur) => cur.replace('#page-chat.active{--chat-nav-gap:calc(8px + var(--nav-disc-reach));', '#page-chat.active{--chat-nav-gap:8px;');
        const NOKB = (cur) => cur.replace('body[data-keyboard-up] #page-chat.active{--nav-bar-clearance:0px;--chat-nav-gap:8px}', 'body[data-keyboard-up] #page-chat.active{--nav-bar-clearance:0px}');
        chatFix('chat0', cssHref); chatFix('chat21', sheetAt(21, undefined, '21c')); chatFix('chat34', sheetAt(34, undefined, '34c'));
        chatFix('chatBare34', sheetAt(34, CHATGAP, '34cb')); chatFix('chatNoKb34', sheetAt(34, NOKB, '34ck'));
        const CHAT_PROBE = `(() => {
          const R = (e) => e.getBoundingClientRect();
          const len = (v) => { const p = document.createElement('div'); p.style.cssText = 'position:absolute;visibility:hidden;height:' + v; document.body.appendChild(p); const h = parseFloat(getComputedStyle(p).height); p.remove(); return h; };
          const ring = len('var(--nav-disc-ring)'), reach = len('var(--nav-disc-reach)');
          const d = R(document.querySelector('.nav-home-disc')), c = R(document.getElementById('cmp')), vh = innerHeight;
          const down = { gap: (d.top - ring) - c.bottom, fromEdge: vh - c.bottom };
          document.body.setAttribute('data-keyboard-up', ''); void document.body.offsetHeight;
          const c2 = R(document.getElementById('cmp'));
          return { ring, reach, vh, down, up: { fromEdge: vh - c2.bottom } };
        })()`;
        const chatAt = async (file, w) => {
          await viewport(w, 852);
          const loaded = page.once('Page.loadEventFired');
          await page.send('Page.navigate', { url: 'file://' + file });
          await loaded;
          const r = await page.send('Runtime.evaluate', { expression: CHAT_PROBE, returnByValue: true, awaitPromise: true });
          if (r.exceptionDetails) throw new Error('chat probe threw: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
          return r.result.value;
        };
        for (const [name, inset] of [['chat0', 0], ['chat21', 21], ['chat34', 34]]) {
          for (const w of [320, 375, 430]) {
            const m = await chatAt(fixtures[name], w);
            const tag = `[7m] chat, inset ${inset}, ${w} wide`;
            assert(m.down.gap >= 8 - 0.5,
              `${tag}: keyboard DOWN — the composer's bottom edge is >= 8 pt clear of the disc's collar (measured ${m.down.gap.toFixed(1)} pt; the old 8 pt lift measured 0)`);
            assert(Math.abs(m.up.fromEdge - 8) <= 0.5,
              `${tag}: keyboard UP — the composer sits 8 pt above the keyboard edge, UNCHANGED (measured ${m.up.fromEdge.toFixed(1)} pt)`);
          }
        }
        const bare = await chatAt(fixtures.chatBare34, 375);
        assert(bare.down.gap <= 0.5 && bare.down.gap >= -0.5,
          `[7m] chat mutation: with the bare 8 pt lift the SAME detector measures ${bare.down.gap.toFixed(1)} pt to the collar (touching): the lift detector discriminates`);
        const nokb = await chatAt(fixtures.chatNoKb34, 375);
        assert(Math.abs(nokb.up.fromEdge - 16) <= 0.5,
          `[7m] chat mutation: without the keyboard-up override the SAME detector measures a ${nokb.up.fromEdge.toFixed(1)} pt gap above the keyboard (not 8): the unchanged-gap detector discriminates`);
      }
      // MUTATION PROOF (same detector, the shipped distance minus the reach): the collar sliver must be SEEN.
      const mutB = await probeAt(fixtures.discBannerBare34);
      assert(mutB.bannerGap.auth <= -7.5 && mutB.bannerGap.update <= -7.5,
        `[7m] mutation: with both banners back at the bare clearance the SAME detector measures ${mutB.bannerGap.auth.toFixed(1)} / ${mutB.bannerGap.update.toFixed(1)} pt (they overlap the collar by the reach): the banner clearance detector discriminates`);
      const mut = await probeAt(fixtures.discNoReach34);
      assert(mut.hiddenClass.visible >= 7.5 && mut.hiddenKeyboard.visible >= 7.5,
        `[7m] mutation: with the hide distance stopping at the pill (no + var(--nav-disc-reach)) the SAME detector sees ${mut.hiddenClass.visible.toFixed(1)} px of collar left on screen: the sliver test discriminates`);
    }
  } catch (e) {
    assert(false, `the engine section ran to completion (threw: ${e && e.message})`);
  } finally {
    if (engine) { try { engine.proc.kill(); } catch { /* already gone */ } }
  }
}

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 20000).unref();
