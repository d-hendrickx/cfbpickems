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
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const cssSrc = readFileSync(here + 'css/styles.css', 'utf8');
const htmlSrc = readFileSync(here + 'index.html', 'utf8');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}

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

/** All rule bodies for an exact selector, anywhere in the sheet. */
function ruleBodies(selector) {
  const escaped = selector.replace(/[.#]/g, ch => '\\' + ch);
  const re = new RegExp(`(^|[^a-zA-Z0-9_.#-])${escaped}\\s*\\{([^}]*)\\}`, 'g');
  const out = [];
  let m; while ((m = re.exec(cssSrc))) out.push(m[2]);
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

// ── [2] the nav-clearance contract ──────────────────────────────────────────
// Content must clear the FIXED nav. Two declarations own this: the base
// shorthand and the @supports override that adds the safe-area inset. §1
// proved they parse; this proves they still say the right thing.
console.log('\n[2] nav clearance — .main-content reserves at least the nav height at the bottom…');
{
  const navH = (cssSrc.match(/--nav-height\s*:\s*(\d+)px/) || [])[1];
  assert(!!navH, `--nav-height is declared as a px length (got ${navH})`);

  const mainPad = ruleBodies('.main-content')[0] || '';
  const shorthand = (mainPad.match(/padding\s*:\s*([^;}]+)/) || [])[1] || '';
  assert(/var\(--nav-height\)/.test(shorthand),
    `.main-content's base padding derives its bottom value from --nav-height rather than hardcoding it (got "${shorthand.trim()}")`);

  // The @supports override must ALSO carry --nav-height, or the installed app
  // (where the feature query passes) loses the clearance entirely.
  const supportsBlock = (cssSrc.match(/@supports\s*\(padding-bottom:\s*env\(safe-area-inset-bottom\)\)\s*\{[\s\S]*?\n\}/) || [])[0] || '';
  assert(supportsBlock.length > 0, 'sanity: the safe-area @supports block is present to inspect');
  const supportsMain = (supportsBlock.match(/\.main-content\s*\{([^}]*)\}/) || [])[1] || '';
  assert(/padding-bottom\s*:[^;}]*var\(--nav-height\)/.test(supportsMain),
    `the @supports override keeps --nav-height in .main-content's padding-bottom (got "${supportsMain.trim()}")`);
  assert(/env\(safe-area-inset-bottom\)/.test(supportsMain),
    'the @supports override also adds env(safe-area-inset-bottom) — the installed app pays both');
  assert(invalidCalcs(supportsBlock).length === 0,
    'the whole @supports block is free of invalid calc() (it is the only clearance the installed app actually gets)');

  // .bottom-nav itself: unchanged, and still the thing being cleared.
  assert(/\.bottom-nav\{[^}]*position:fixed[^}]*bottom:0/.test(cssSrc),
    '.bottom-nav is still position:fixed;bottom:0 — no speculative repositioning shipped for B-a');
  const navSupports = (supportsBlock.match(/\.bottom-nav\s*\{([^}]*)\}/) || [])[1] || '';
  assert(/height\s*:[^;}]*var\(--nav-height\)[^;}]*env\(safe-area-inset-bottom\)/.test(navSupports),
    `on the installed app the nav grows by the safe-area inset instead of letting its padding eat the icon row (got "${navSupports.trim()}")`);
}

// ── [3] the submit bar clears the nav rather than hiding under it ───────────
// .bottom-nav is z-index 100, .submit-bar z-index 50. If the bar's offset ever
// falls back to 0 again it sticks flush to the viewport bottom, BEHIND the
// nav — invisible, with its Submit button untappable.
console.log('\n[3] .submit-bar — its sticky offset clears the nav it sits under…');
{
  const body = ruleBodies('.submit-bar')[0] || '';
  const bottom = (body.match(/bottom\s*:\s*([^;}]+)/) || [])[1] || '';
  assert(/var\(--nav-height\)/.test(bottom),
    `.submit-bar's offset is expressed in terms of --nav-height, so it tracks the nav (got "${bottom.trim()}")`);
  const plus = bottom.match(/\+\s*(\d+)px/);
  assert(!!plus && Number(plus[1]) > 0,
    `.submit-bar clears the nav by a positive margin rather than sitting exactly on its edge (got "${bottom.trim()}")`);
  const navZ = Number((cssSrc.match(/\.bottom-nav\{[^}]*z-index:(\d+)/) || [])[1]);
  const barZ = Number((body.match(/z-index:\s*(\d+)/) || [])[1]);
  assert(navZ > barZ,
    `the nav still paints above the submit bar (nav z-index ${navZ} > bar z-index ${barZ}), which is why the bar must be offset rather than layered`);
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
  const overflowAncestors = [];
  for (const sel of selectors) {
    for (const body of ruleBodies(sel)) {
      const ov = body.match(/(^|[;{])\s*(overflow(?:-x|-y)?)\s*:\s*([^;}]+)/);
      if (ov && !/^\s*visible\s*$/.test(ov[3])) overflowAncestors.push(`${sel}{${ov[2]}:${ov[3].trim()}}`);
    }
  }
  assert(overflowAncestors.length === 2,
    `exactly two ancestors of .bottom-nav carry non-visible overflow, both by design and both measured harmless to the fixed nav: ${overflowAncestors.join(' + ')}`);
  assert(overflowAncestors.some(s => s.startsWith('body{overflow-x:hidden')),
    'body{overflow-x:hidden} — the real sideways-scroll guard; it propagates to the viewport, so body itself is not a scroll container');
  assert(overflowAncestors.some(s => s.startsWith('.page-wrapper{overflow-x:hidden')),
    '.page-wrapper{overflow-x:hidden} — v14 belt-and-suspenders. It DOES make .page-wrapper a scroll container (overflow-y computes to auto), which is why position:sticky is inert inside it; it does NOT move the fixed nav (measured, both engines, 2026-09-19)');
}

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
