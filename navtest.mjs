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

  // ── THE SAFE-AREA CLEARANCE AUDIT (reviewer BLOCK, round 1) ───────────────
  // On the installed app .bottom-nav GROWS by env(safe-area-inset-bottom) — its
  // @supports override sets height:calc(var(--nav-height) + env(...)). So any
  // offset that means "clear the bottom nav" and is written in terms of
  // --nav-height ALONE is short by the inset on every notched iPhone, and lands
  // INSIDE the opaque z-index:100 nav. This is a class check over the whole
  // sheet, not a check of .submit-bar: every sibling rule (#auth-banner-stack,
  // #page-chat .chat-jump-latest) already carries the term, and the next one
  // written must too.
  const RULE_RE = /([^{}]+)\{([^{}]*)\}/g;
  const navClearanceOffenders = [];
  const navClearanceChecked = [];
  for (const [, selector, body] of cssRules.matchAll(RULE_RE)) {
    const decl = body.match(/(?:^|[;{])\s*bottom\s*:\s*([^;}]+)/);
    if (!decl || !/var\(--nav-height\)/.test(decl[1])) continue;
    const sel = selector.trim().replace(/\s+/g, ' ');
    navClearanceChecked.push(`${sel}{bottom:${decl[1].trim()}}`);
    if (!/env\(\s*safe-area-inset-bottom/.test(decl[1])) navClearanceOffenders.push(`${sel}{bottom:${decl[1].trim()}}`);
  }
  assert(navClearanceChecked.length >= 3,
    `fixture check: found ${navClearanceChecked.length} rules whose bottom offset is derived from --nav-height to audit (${navClearanceChecked.length ? navClearanceChecked.map(s => s.split('{')[0]).join(', ') : 'none — the scanner is broken'})`);
  assert(navClearanceOffenders.length === 0,
    `every offset that clears .bottom-nav also carries env(safe-area-inset-bottom) — the nav GROWS by that inset on a notched iPhone (@supports block), so an offset of --nav-height alone lands the element INSIDE the opaque nav. Offenders: ${navClearanceOffenders.join(' | ') || 'none'}`);

  // The REST-POSITION invariant. The bar pins at (nav + inset + 8); .main-content
  // reserves (nav + inset + 20) below the content, so the bar's flow position is
  // always 12px ABOVE the pin line and a short slate can never make sticky shove
  // it up over the tiebreaker. BOTH numbers exist TWICE — a base rule and an
  // @supports override that adds the inset — and the invariant has to hold in
  // BOTH. Reading only the base pair (as this section first did) is blind to
  // exactly the installed-app case the reviewer caught.
  // Both quantities are now (--nav-height) + (inset) + (constant). The bar has
  // ONE rule carrying env(...,0px), so it is correct in both worlds; the reserve
  // has TWO — a base rule with no inset and an @supports override that adds one.
  // The invariant to prove is that the CONSTANT terms keep their margin in each
  // world, and that the inset term appears on both sides in the installed case
  // so the two grow together.
  const supportsBlock6 = (cssSrc.match(/@supports\s*\(padding-bottom:\s*env\(safe-area-inset-bottom\)\)\s*\{[\s\S]*?\n\}/) || [])[0] || '';
  const barDecl = (/\.submit-bar\{[^}]*?bottom:(calc\([^;}]*\))/.exec(cssRules) || [])[1] || '';
  const reserveBase = (/\.main-content\{[^}]*padding:[^;}]*?calc\(([^;}]*)\)/.exec(cssRules) || [])[1] || '';
  const reserveInset = (/\.main-content\s*\{[^}]*?padding-bottom:calc\(([^;}]*)\)/.exec(supportsBlock6) || [])[1] || '';
  const constOf = expr => { const m = [...String(expr).matchAll(/\+\s*(\d+)px/g)]; return m.length ? Number(m[m.length - 1][1]) : NaN; };
  const hasInset = expr => /env\(\s*safe-area-inset-bottom/.test(String(expr));

  assert(!!barDecl && !!reserveBase && !!reserveInset,
    `all three declarations are readable — bar offset "${barDecl}", base reserve "${reserveBase}", @supports reserve "${reserveInset}"`);
  assert(hasInset(barDecl) && hasInset(reserveInset),
    `on the installed app the bar's offset AND .main-content's reserve both grow by env(safe-area-inset-bottom), so they move together instead of drifting apart by the inset (bar: ${hasInset(barDecl)}, reserve: ${hasInset(reserveInset)})`);
  assert(/env\(\s*safe-area-inset-bottom\s*,\s*0px\s*\)/.test(barDecl),
    `the bar's inset term carries the 0px fallback, so the same single declaration is correct in a desktop browser too — matching #auth-banner-stack and #page-chat .chat-jump-latest rather than needing an @supports block (got "${barDecl}")`);
  for (const [world, offset, reserve] of [
    ['browser (inset resolves to 0)', constOf(barDecl), constOf(reserveBase)],
    ['installed app (inset live)', constOf(barDecl), constOf(reserveInset)],
  ]) {
    assert(Number.isFinite(offset) && Number.isFinite(reserve),
      `${world}: both constants are readable — bar +${offset}px, reserve +${reserve}px`);
    assert(reserve > offset,
      `${world}: .main-content reserves MORE below the content (+${reserve}px) than the bar's sticky offset (+${offset}px), so the bar rests ${reserve - offset}px above its pinned position and never shoves up over the tiebreaker`);
  }

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
  // that actually bit: on a notched iPhone .bottom-nav grows by the bottom
  // inset. Same technique B-a's harness used — substitute the inset TEXTUALLY
  // into a copy of the real stylesheet and lay the real rules out against it.
  // The env() inside the @supports CONDITION is protected, or the whole block
  // would stop matching and the override under test would never apply.
  const INSET = 34;                       // iPhone 14/15/16 home-indicator inset
  const COND = '@supports(padding-bottom:env(safe-area-inset-bottom))';
  const navStart = htmlSrc.indexOf('<nav class="bottom-nav"');
  const navHtml = htmlSrc.slice(navStart, htmlSrc.indexOf('</nav>', navStart) + 6);
  const tmp = mkdtempSync(join(tmpdir(), 'cfbp-navtest-'));

  const insetFile = join(tmp, 'styles-inset.css');
  {
    const GUARD = '/*__SUPPORTS_CONDITION__*/';
    let sheet = cssSrc.split(COND).join(GUARD);
    assert(sheet !== cssSrc,
      `fixture check: the @supports safe-area block was found and protected before substitution, so the installed-app override still applies in the variant (looked for "${COND}")`);
    const before = sheet;
    sheet = sheet.replace(/env\(\s*safe-area-inset-bottom\s*(?:,[^)]*)?\)/g, INSET + 'px');
    assert(sheet !== before,
      `fixture check: at least one env(safe-area-inset-bottom) was substituted with ${INSET}px — otherwise the variant would be identical to the browser case and prove nothing (RG-27)`);
    writeFileSync(insetFile, sheet.split(GUARD).join(COND));
  }
  const insetHref = 'file://' + insetFile;

  const fixtures = {};
  function fixture(name, { tab = 'picks', sectionId = 'page-picks', inner, css = cssHref }) {
    const file = join(tmp, name + '.html');
    writeFileSync(file, `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<link rel="stylesheet" href="${css}"></head>
<body data-tab="${tab}"><div class="page-wrapper">
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
  // the deliberately-too-wide child: the thing overflow-x:hidden was there for
  fixture('wide', { inner: `<div id="games-list">${gameCards(6)}</div>
    <div id="too-wide" style="width:1200px;height:40px;background:#eee">an element 1200px wide, wider than every phone</div>
    ${tiebreaker}${submitBar(6)}` });
  // the submitted view: no .submit-bar, and Edit My Picks must stay reachable
  fixture('submitted', { inner: `<div class="tiebreaker-card tiebreaker-submitted"><span class="tiebreaker-label">🎯 Your Tiebreaker Guess</span><span class="tiebreaker-value">52</span></div>
    <div id="submitted-games">${gameCards(14)}</div>
    <div class="card mt-md text-center" style="padding:16px">
      <button class="btn btn-secondary mr-sm" id="edit-picks-btn">✏️ Edit My Picks</button>
      <button class="btn btn-primary" id="go-dash-btn">View Dashboard</button></div>` });
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
      navH: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--nav-height')),
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
    const pinLine = long.viewport.h - long.navH - 8;
    for (const where of ['top', 'mid']) {
      const s = long.samples[where];
      assert(Math.abs(s.bar.bottom - pinLine) <= 1.5,
        `at scroll ${where} (scrollY ${s.scrollY}) the submit bar is PINNED: its bottom is ${s.bar.bottom}px, the pin line is ${pinLine}px (viewport ${long.viewport.h} − nav ${long.navH} − 8) — B-c was the bar rendering at its flow position instead, ${Math.round(long.maxScroll)}px down the page`);
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

    // ── 7e. §4's nav contract, measured rather than asserted from source ─────
    for (const where of ['top', 'mid', 'bottom']) {
      const s = long.samples[where];
      assert(Math.abs(s.nav.bottom - long.viewport.h) <= 0.5 && Math.abs(s.nav.h - long.navH) <= 0.5,
        `at scroll ${where} the bottom nav is still flush to the viewport bottom at its full height (bottom ${s.nav.bottom} of ${long.viewport.h}, height ${s.nav.h} vs --nav-height ${long.navH}) — B-a's geometry is unchanged by RG-188`);
    }

    // ── 7e2. THE INSTALLED APP: nav grows by the inset, bar must grow with it ─
    // Reviewer BLOCK round 1. With a 34px home-indicator inset the nav is 94px
    // tall; a bar offset of --nav-height alone (68px) puts the bar's bottom 26px
    // INSIDE an opaque z-index:100 nav, which is the reported bug wearing a hat.
    // Everything here is measured against the substituted stylesheet.
    for (const n of [1, 3, 14]) {
      const m = await measure(fixtures['inset' + n],
        { computed: [...CHAIN, '.submit-bar'], rects: RECTS, scrolls: ['top', 'mid', 'bottom'] });
      const navH = m.samples.top.nav.h;
      assert(Math.abs(navH - (m.navH + INSET)) <= 0.5,
        `inset variant, ${n}-game slate: the nav really is ${navH}px — --nav-height ${m.navH} PLUS the ${INSET}px inset (its @supports override applied), which is the whole reason this variant exists`);
      assert(Math.abs(m.samples.top.nav.bottom - m.viewport.h) <= 0.5,
        `inset variant, ${n}-game slate: the taller nav is still flush to the viewport bottom (${m.samples.top.nav.bottom} of ${m.viewport.h})`);
      const scrolled = m.maxScroll > 0 ? m.samples.mid : m.samples.top;
      assert(scrolled.bar.bottom <= scrolled.nav.top - 7.5,
        `inset variant, ${n}-game slate: the pinned bar clears the TALLER nav by ${Math.round(scrolled.nav.top - scrolled.bar.bottom)}px (bar bottom ${scrolled.bar.bottom}, nav top ${scrolled.nav.top}) — without the inset term in its offset it lands ${INSET}px inside the nav and the player cannot tap Submit at all`);
      assert(scrolled.bar.top >= 0 && scrolled.bar.bottom <= m.viewport.h,
        `inset variant, ${n}-game slate: the whole bar is on screen (top ${scrolled.bar.top}, bottom ${scrolled.bar.bottom} of ${m.viewport.h})`);
      const rest = m.samples.bottom;
      assert(rest.bar.top >= rest.tb.bottom,
        `inset variant, ${n}-game slate, at the end: the resting bar still does not cover #tb-input (bar top ${rest.bar.top} ≥ input bottom ${rest.tb.bottom}) — the @supports bottom reserve grows by the same inset the offset does`);
      assert(rest.bar.top >= rest.lastCard.bottom && rest.bar.bottom <= rest.nav.top,
        `inset variant, ${n}-game slate, at the end: the last game card is not hidden (card bottom ${rest.lastCard.bottom} ≤ bar top ${rest.bar.top}) and the bar is clear of the nav (bar bottom ${rest.bar.bottom} ≤ nav top ${rest.nav.top})`);
    }

    // ── 7f. the two deliberate holds, measured ──────────────────────────────
    assert(long.computed['.submit-bar'].position === 'sticky' && long.computed['.submit-bar'].bottom === `${long.navH + 8}px`,
      `the bar's own rule is untouched: position ${long.computed['.submit-bar'].position}, resolved offset ${long.computed['.submit-bar'].bottom} (B-a's calc fix, now doing visible work)`);
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
  } catch (e) {
    assert(false, `the engine section ran to completion (threw: ${e && e.message})`);
  } finally {
    if (engine) { try { engine.proc.kill(); } catch { /* already gone */ } }
  }
}

process.stdout.write(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}\n`,
  () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 20000).unref();
