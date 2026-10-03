/**
 * CFB Pickems — brandtokentest.mjs (DI-328j, UX Revamp Group E, fix round 1
 * 2026-09-25, reviewer BLOCK)
 * =====================================================================
 * A SOURCE-LEVEL regression test: computes the real WCAG contrast ratio for
 * every pairing named in `css/styles.css`'s own DI-328b comment table, from
 * the LITERAL hex values checked into `:root`/`body.theme-neutral` — not
 * from hardcoded expected numbers that could drift silently out of sync
 * with the CSS. If a future edit changes `--maroon`'s hex without updating
 * the comment table, this test goes red, not silently stale. Precedent:
 * grouptest.mjs (UN-118), platformtest.mjs, iconstest.mjs (this same DI).
 *
 * Also covers (per the coordinator's fix-round-1 AND follow-up instructions,
 * folded in rather than opening a second file):
 *   - `createGame()` defaults `homeLogo`/`awayLogo` to `null` (DI-331b).
 *   - `js/data-provider.js`'s exported `logoOk(u)` — the DB CHECK-constraint
 *     coercion (security review E-2 follow-up, 2026-09-25): matches
 *     `sql-drafts/E_logos.sql`'s `^https://` + length<=300 constraint
 *     exactly, so a malformed URL degrades to the name fallback client-side
 *     instead of the whole games PATCH failing server-side. Tested directly
 *     (exported, not source-level) against `http://` (wrong scheme), a
 *     301-char URL (over length), `undefined` (absent), and a valid URL at
 *     the exact 300-char boundary (must still pass).
 *   - The projection round-trip: `homeLogo`/`awayLogo` land in the TYPED
 *     `home_logo`/`away_logo` columns via `js/supabase-projection.js`'s
 *     `GAME_COLS`, never in the `extra` jsonb catch-all, and round-trip
 *     back out unchanged. This is the assertion the coordinator asked to be
 *     placed in an existing projection suite (`grep -l GAME_COLS *.mjs`
 *     returned nothing — no suite references it by name) or, failing that,
 *     in this file. `projectiontest.mjs` exists and structurally covers
 *     `toRows`/`fromRows` round-trips in general, but CLAUDE.md's Prohibited
 *     Moves section names it explicitly as Drew-only to RUN ("Never run a
 *     script that auto-loads real credentials... `projectiontest.mjs` are
 *     Drew's to run") — that rule is not scoped to only its credentialed
 *     sections, so it was not edited or run here. This file, which this
 *     pass owns and can run itself, carries the assertion instead.
 *
 * Run:  node brandtokentest.mjs
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createGame } from './js/data-model.js';
import { toRows, fromRows } from './js/supabase-projection.js';
import { logoOk } from './js/data-provider.js';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ─────────────────────────────────────────────────────────────────────────────
// WCAG contrast — the standard relative-luminance formula, computed fresh
// from literal hex, not assumed.
// ─────────────────────────────────────────────────────────────────────────────
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
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
function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexA);
  const lB = relativeLuminance(hexB);
  const lighter = Math.max(lA, lB);
  const darker = Math.min(lA, lB);
  return (lighter + 0.05) / (darker + 0.05);
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS token extraction — parses the LITERAL `:root { ... }` / theme blocks
// out of css/styles.css, not a hardcoded copy of the values.
// ─────────────────────────────────────────────────────────────────────────────

/** Extract every `--name{...}` declaration inside every `selector { ... }`
 *  block matching `selectorRegex`, across the WHOLE file (there can be more
 *  than one `:root{}` block — css/styles.css:2591 adds an unrelated one
 *  further down for a different feature; both are valid CSS and merge). No
 *  nested braces occur inside any of these blocks, so a non-greedy match to
 *  the next `}` is safe — the same assumption css/styles.css's own theme
 *  blocks are written under. */
function extractVars(cssText, selectorRegex) {
  const vars = {};
  const blockRe = new RegExp(`${selectorRegex}\\s*\\{([^}]*)\\}`, 'g');
  let m;
  while ((m = blockRe.exec(cssText))) {
    const body = m[1];
    const declRe = /--([a-zA-Z0-9-]+)\s*:\s*(#[0-9A-Fa-f]{3,8})/g;
    let d;
    while ((d = declRe.exec(body))) {
      vars[d[1]] = d[2];
    }
  }
  return vars;
}

const stylesPath = fileURLToPath(new URL('./css/styles.css', import.meta.url));
const cssText = await readFile(stylesPath, 'utf8');

// `:root` (escaped — no regex metachars, but written explicitly for clarity)
const rootVars = extractVars(cssText, ':root');
// `body.theme-neutral` — the Munera-default theme block.
const neutralVars = extractVars(cssText, 'body\\.theme-neutral');
// `body.theme-aggie` — must hold the OLD literal Aggie values, unchanged.
const aggieVars = extractVars(cssText, 'body\\.theme-aggie');
// DI-360 night mode — the media-query block AND the manual-override block
// (`body.theme-neutral[data-color-scheme="dark"]`) must carry the identical
// token set (source-level "keep these two blocks in sync" contract).
// RE-DERIVED (SP-52 DI-448/DI-456, 2026-10-01). The night region is no longer one `body.theme-neutral:not(…){}` block per trigger: Munera Dark is the
// SHARED SURFACE block A (an enumerated list of the eight Munera-surface keys) plus the BRAND block B-munera (neutral + ink), each in both triggers, and
// every school has its own B-school pair. These extractors read exactly Block A and B-munera for body.theme-neutral through themeresolve.mjs's parser (a
// regex over `selector {` can no longer find a selector that sits inside a comma list), keeping extractVars()'s own `--name:#hex` capture rule.
import * as ThemeR from './themeresolve.mjs';
const _sheet = ThemeR.parseSheet(cssText);
const _hexDecls = (rules) => { const v = {}; for (const r of rules) for (const d of r.decls) if (d.prop.startsWith('--') && /^#[0-9A-Fa-f]{3,8}$/.test(d.value.trim())) v[d.prop.slice(2)] = d.value.trim(); return v; };
const _isNeutralMedia = (r) => r.media === 'dark' && /body\.theme-neutral:not\(\[data-color-scheme="light"\]\)/.test(r.selectorText) && !r.selectorText.startsWith(':where(');
const _isNeutralManual = (r) => r.media === null && /body\.theme-neutral\[data-color-scheme="dark"\]/.test(r.selectorText) && !r.selectorText.startsWith(':where(');
const _nightMediaRules = _sheet.rules.filter(_isNeutralMedia);   // Block A and B-munera
const _nightManualRules = _sheet.rules.filter(_isNeutralManual);
const nightMediaVars = _hexDecls(_nightMediaRules);
const nightManualVars = _hexDecls(_nightManualRules);

// ─────────────────────────────────────────────────────────────────────────────
// [1] Token values match DI-362's amended hex (source-of-truth check).
//     DI-362 (2026-09-27, UN-320) amended the base --maroon/--gold values
//     DI-328b originally shipped ("Deep Cardinal" #8C1515 / "Royal Gold"
//     #D4A017) and recomputed --maroon-mid/--maroon-light proportionally
//     from the new base (same HSL delta each stop held to the OLD base) —
//     see css/styles.css's own DI-362 comment for the derivation. This
//     table was #7A1F2B/#922536/#A83B4A/#C9A24B before that amendment.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] :root and theme-neutral carry the exact DI-362 Munera hex values…');
{
  const expected = {
    maroon: '#8C1515', 'maroon-mid': '#A6191C', 'maroon-light': '#BF2C2D',
    'maroon-pale': '#FBF2F3', 'maroon-tint': '#F5E2E2',
    gold: '#D4A017', 'gold-light': '#E8C96A', 'gold-text': '#6E5419',
    bg: '#E8E4DC', 'bg-card': '#FFFFFF',
  };
  for (const [name, hex] of Object.entries(expected)) {
    assert(rootVars[name] && rootVars[name].toUpperCase() === hex.toUpperCase(),
      `[1a/:root] --${name} is ${hex} (found: ${rootVars[name]})`);
    assert(neutralVars[name] && neutralVars[name].toUpperCase() === hex.toUpperCase(),
      `[1b/theme-neutral] --${name} is ${hex} (found: ${neutralVars[name]})`);
  }
  // --gold-light/--gold-text are DI-362's explicit "do NOT change" tokens —
  // asserted here as UNCHANGED from the pre-DI-362 (and pre-DI-328b) values,
  // not merely present, so a future edit that quietly rederives them from
  // the new --gold gets caught.
  assert(rootVars['gold-light'] && rootVars['gold-light'].toUpperCase() === '#E8C96A',
    '[1a3/:root] --gold-light is UNCHANGED at #E8C96A — DI-362 verified it still clears AA on the new crimson rather than re-deriving it');
  assert(rootVars['gold-text'] && rootVars['gold-text'].toUpperCase() === '#6E5419',
    '[1a4/:root] --gold-text is UNCHANGED at #6E5419 — an independently-chosen dark value, not derived from --gold mathematically');
  // --text-primary/--text-secondary/--text-muted are DELIBERATELY not
  // redeclared per-theme (css/styles.css's own "each theme overrides only
  // the brand color variables" convention, unchanged by this DI) — every
  // theme, including theme-neutral, inherits them from bare :root. Asserted
  // as an explicit non-declaration, not silently assumed, so a future edit
  // that DOES add a stray theme-neutral override is at least a visible diff
  // here even though this test doesn't fail on it either way.
  assert(rootVars['text-primary'] && rootVars['text-primary'].toUpperCase() === '#14110E',
    `[1a2/:root] --text-primary is #14110E (found: ${rootVars['text-primary']})`);
  assert(!('text-primary' in neutralVars),
    '[1b2/theme-neutral] --text-primary is correctly NOT redeclared here — inherits from :root by design');
  // theme-aggie must hold the OLD literal maroon values, not the new ones —
  // this is the "value moved, pixels didn't" guarantee (DI-328a), UNCHANGED
  // by DI-362 (that DI only amends bare :root/theme-neutral, never a school
  // theme's own literal palette).
  assert(aggieVars.maroon && aggieVars.maroon.toUpperCase() === '#500000',
    `[1c/theme-aggie] --maroon is the OLD literal #500000 (found: ${aggieVars.maroon})`);
  assert(aggieVars.maroon && aggieVars.maroon.toUpperCase() !== '#7A1F2B' && aggieVars.maroon.toUpperCase() !== '#8C1515',
    '[1d/theme-aggie] --maroon is NOT the Oxblood value NOR the new DI-362 crimson value (no leak either way)');
  // --oxblood/--oxblood-on — the CONSTANT admin-panel marker — stays at the
  // OLD literal Oxblood value on purpose, in EVERY theme block including
  // theme-neutral, never repointed to DI-362's new crimson (css/styles.css's
  // own comment on this token: "never repointed to this theme's own
  // --maroon"). A leak here would mean an aggie-themed viewer's Admin panel
  // marker silently changed color for a reason that has nothing to do with
  // aggie's own palette.
  assert(rootVars.oxblood && rootVars.oxblood.toUpperCase() === '#7A1F2B',
    `[1e/:root] --oxblood (the constant admin marker) is UNCHANGED at #7A1F2B, not repointed to the new crimson (found: ${rootVars.oxblood})`);
  assert(neutralVars.oxblood && neutralVars.oxblood.toUpperCase() === '#7A1F2B',
    `[1f/theme-neutral] --oxblood is likewise UNCHANGED here (found: ${neutralVars.oxblood})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] Computed WCAG contrast — every pairing in DI-362's own candidate table,
//     recomputed from the literal hex above, asserted against its documented
//     verdict. (DI-328b's original Oxblood/Gold table is superseded by this
//     one — the underlying formula is identical, only the base hexes moved.)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] WCAG contrast — every DI-362 pairing, computed fresh…');
{
  const ink = rootVars['text-primary'];
  const marble = rootVars['bg'];
  const white = rootVars['bg-card'];
  const crimson = rootVars['maroon'];
  const gold = rootVars['gold'];
  const goldText = rootVars['gold-text'];
  const goldLight = rootVars['gold-light'];

  const cases = [
    { label: 'Ink on Marble', a: ink, b: marble, min: 14.0, verdict: 'AAA' },
    { label: 'Crimson text on Marble', a: crimson, b: marble, min: 7.0, verdict: 'AAA' },
    { label: 'Crimson text on white (--bg-card)', a: crimson, b: white, min: 9.0, verdict: 'AAA' },
    { label: 'White text on Crimson bg', a: white, b: crimson, min: 9.0, verdict: 'AAA' },
    { label: 'Gold text on Ink bg', a: gold, b: ink, min: 7.0, verdict: 'AAA' },
    { label: '--gold-text on Marble (the required variant)', a: goldText, b: marble, min: 4.5, verdict: 'AA' },
    { label: '--gold-light on Crimson (the required variant)', a: goldLight, b: crimson, min: 4.5, verdict: 'AA' },
  ];
  for (const c of cases) {
    const ratio = contrastRatio(c.a, c.b);
    assert(ratio >= c.min, `[2/${c.label}] ${ratio.toFixed(2)}:1 clears ${c.verdict} (>= ${c.min}:1)`);
  }

  // FAIL cases — documented as pairings to avoid; asserted as FAILING, not
  // passing, so a future accidental "fix" that makes plain --gold usable as
  // text somewhere doesn't silently invalidate the documented guidance.
  const failCases = [
    // DI-362 recomputed this against the NEW gold (#D4A017) — was ~1.89:1
    // against the old gold (#C9A24B, itself a 2026-09-25 correction of a
    // 1.39:1 mis-statement). Still a clear AA fail (<4.5) either way.
    { label: 'plain Gold text on Marble bg (must use --gold-text instead)', a: gold, b: marble, max: 4.5, expectAround: 1.87 },
    // Recomputed against the NEW crimson (#8C1515) — was ~1.84:1 against the
    // old Oxblood (#7A1F2B).
    { label: 'Ink text on Crimson bg (a pairing to AVOID, nothing builds it)', a: ink, b: crimson, max: 4.5, expectAround: 2.00 },
  ];
  for (const c of failCases) {
    const ratio = contrastRatio(c.a, c.b);
    assert(ratio < c.max, `[2/${c.label}] ${ratio.toFixed(2)}:1 correctly FAILS AA (< ${c.max}:1)`);
    assert(Math.abs(ratio - c.expectAround) < 0.05,
      `[2/${c.label}] computed ratio ${ratio.toFixed(2)}:1 matches the documented figure (~${c.expectAround}:1)`);
  }

  // Gold on Crimson — passes AA-Large (3:1) but fails AA body text (4.5:1);
  // the SAME SHAPE as the old Gold-on-Oxblood finding (4.25:1) — both halves
  // of that claim are asserted, not just one. This is the pairing DI-360's
  // night mode explicitly depends on staying fixable via --gold-light.
  const goldOnCrimson = contrastRatio(gold, crimson);
  assert(goldOnCrimson >= 3.0, `[2/Gold on Crimson] ${goldOnCrimson.toFixed(2)}:1 clears AA-Large (>= 3:1)`);
  assert(goldOnCrimson < 4.5, `[2/Gold on Crimson] ${goldOnCrimson.toFixed(2)}:1 correctly FAILS AA body text (< 4.5:1) — must use --gold-light for text`);
  assert(Math.abs(goldOnCrimson - 3.96) < 0.05,
    `[2/Gold on Crimson] ${goldOnCrimson.toFixed(2)}:1 matches DI-362's own documented figure (~3.96:1)`);

  // --maroon-mid/--maroon-light are used as TEXT in several call sites
  // (.live-pill, .dc-status.dc-live, .btn-primary:hover background is a
  // fill not text, but .admin-section-title-toggle:hover uses --maroon-light
  // as text) — usually against --maroon-pale or white. Re-verified fresh
  // against the recomputed tint stops, not assumed to survive the rebase.
  const maroonMid = rootVars['maroon-mid'];
  const maroonLight = rootVars['maroon-light'];
  const maroonPale = rootVars['maroon-pale'];
  const midOnPale = contrastRatio(maroonMid, maroonPale);
  const lightOnWhite = contrastRatio(maroonLight, white);
  assert(midOnPale >= 4.5, `[2/--maroon-mid on --maroon-pale] ${midOnPale.toFixed(2)}:1 clears AA (>= 4.5:1) — used as text in .live-pill/.dc-status.dc-live/etc.`);
  assert(lightOnWhite >= 4.5, `[2/--maroon-light on white] ${lightOnWhite.toFixed(2)}:1 clears AA (>= 4.5:1) — used as text in .admin-section-title-toggle:hover`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [2d] DI-393 (UN-353, 2026-09-27) — the header's `.header-sync-icon`. Every
//     OTHER contrast pairing in this file/contrastscan.mjs is verified against
//     `--bg-card` (a light card surface); this is the one icon in the app
//     painted directly on `var(--maroon)` (the header bar), which is a
//     GENUINELY different surface contrastscan.mjs cannot check at all (that
//     scanner only fires on rules with their own `background:` — this icon's
//     rule has none, it inherits the header's). By-hand audit, computed fresh
//     from the literal hex/alpha values shipped in css/styles.css's own
//     `.header-sync-icon[data-sync="..."]` rules, per the WCAG 1.4.11
//     non-text/graphical-object floor (3.0:1 — the correct criterion for an
//     ICON, not 1.4.3's 4.5:1 text floor).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2d] DI-393 — .header-sync-icon colours against var(--maroon), by hand…');
{
  const crimson = rootVars['maroon'];
  const goldLight = rootVars['gold-light'];
  const liveText = rootVars['live']; // light-mode --live-text is an alias of --live (see :root)

  /** Composite an rgba(255,255,255,alpha) foreground over an opaque hex
   *  background, returning the resulting opaque hex — the same math a
   *  browser performs when painting semi-transparent text, so contrastRatio()
   *  (which only accepts opaque hex) can be reused unmodified. */
  function whiteOverHex(alpha, bgHex) {
    const bg = hexToRgb(bgHex);
    const mix = (b) => Math.round(255 * alpha + b * (1 - alpha));
    const r = mix(bg.r), g = mix(bg.g), b = mix(bg.b);
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  // The trap this DI's own CSS comment names explicitly: the file's usual
  // "reuse the semantic --live/--live-text token" reflex fails badly on
  // THIS surface — asserted as a genuine, documented FAIL, the same
  // discipline section [2]'s failCases above already use.
  const liveOnCrimson = contrastRatio(liveText, crimson);
  assert(liveOnCrimson < 3.0,
    `[2d/--live(-text) on var(--maroon)] ${liveOnCrimson.toFixed(2)}:1 correctly FAILS even the 3.0:1 icon floor — confirms why .header-sync-icon's refused/error state does NOT reuse this token`);

  // The values the shipped CSS actually uses.
  const syncedOffline = whiteOverHex(0.75, crimson); // synced / offline base
  const offlineOnly = whiteOverHex(0.6, crimson);    // offline's own dimmer value
  const refusedRatio = contrastRatio('#ffffff', crimson); // refused/error: opaque white

  const syncedRatio = contrastRatio(syncedOffline, crimson);
  const offlineRatioVal = contrastRatio(offlineOnly, crimson);
  const goldOnCrimsonIcon = contrastRatio(goldLight, crimson);

  assert(syncedRatio >= 3.0,
    `[2d/synced: rgba(255,255,255,.75) on var(--maroon)] ${syncedRatio.toFixed(2)}:1 clears the 3.0:1 icon floor (matches .header-meta's own existing dim-white-on-this-exact-maroon convention)`);
  assert(offlineRatioVal >= 3.0,
    `[2d/offline: rgba(255,255,255,.6) on var(--maroon)] ${offlineRatioVal.toFixed(2)}:1 clears the 3.0:1 icon floor while reading visibly dimmer than synced (${syncedRatio.toFixed(2)}:1)`);
  assert(offlineRatioVal < syncedRatio,
    `[2d/offline vs synced] offline (${offlineRatioVal.toFixed(2)}:1) is genuinely dimmer than synced (${syncedRatio.toFixed(2)}:1) — the visual de-emphasis DI-393's own "reduced opacity" instruction asks for is real, not just claimed`);
  assert(refusedRatio >= 3.0,
    `[2d/refused+error: opaque #fff on var(--maroon)] ${refusedRatio.toFixed(2)}:1 clears the 3.0:1 icon floor with wide margin (matches .header-meta strong's own existing white-on-maroon convention)`);
  assert(goldOnCrimsonIcon >= 3.0,
    `[2d/syncing: --gold-light on var(--maroon)] ${goldOnCrimsonIcon.toFixed(2)}:1 clears the 3.0:1 icon floor — the SAME pairing already verified at 4.5:1+ in [2] above, reused here for a different call site, not re-derived from scratch`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [2c] DI-360 (UN-318) — Munera night mode, Phase 1. Source-level: both the
//     automatic (`prefers-color-scheme: dark`) block and the manual-override
//     (`[data-color-scheme="dark"]`) block exist, carry the IDENTICAL token
//     set (the file's own "keep these two blocks in sync" contract — there
//     is no CSS mixin without a build step), stay scoped to `body.theme-
//     neutral` only (never leaking onto a school theme, and never bare
//     `:root` either — the five non-aggie school themes inherit --bg/
//     --text-primary from bare :root and would otherwise go dark too), and
//     every new dark token clears AA against the other new dark tokens it
//     pairs with.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2c] DI-360 — night mode: scope, sync, and contrast…');
{
  assert(_nightMediaRules.length === 2 && Object.keys(nightMediaVars).length > 0,
    `[2c-pre] fixture: the \`@media(prefers-color-scheme:dark)\` blocks that select body.theme-neutral — Block A (shared surfaces) and B-munera (brand roles) — were found and parsed (${_nightMediaRules.length} rules)`);
  assert(_nightManualRules.length === 2 && Object.keys(nightManualVars).length > 0,
    `[2c-pre] fixture: the \`body.theme-neutral[data-color-scheme="dark"]\` manual blocks (A and B-munera) were found and parsed (${_nightManualRules.length} rules)`);

  // The two blocks must declare the exact same set of variables, with the
  // exact same values — a future edit to one without the other is exactly
  // the defect this "keep in sync" contract exists to prevent.
  const mediaKeys = Object.keys(nightMediaVars).sort();
  const manualKeys = Object.keys(nightManualVars).sort();
  assert(mediaKeys.length > 5 && mediaKeys.join(',') === manualKeys.join(','),
    `[2c-a] the media-query and manual-override blocks declare the IDENTICAL variable set (media: ${mediaKeys.join(',')} | manual: ${manualKeys.join(',')})`);
  // RE-DERIVED per block (themetest [T6] proves it for all twelve Dark rules; this pins the two that carry Munera): each of A and B-munera is byte-identical
  // between the media trigger and the manual trigger, declaration for declaration.
  {
    const canon = (r) => r.decls.map((d) => `${d.prop}:${d.value.replace(/\s+/g, ' ')}`).join(';');
    const pair = (sel) => [_nightMediaRules.find(sel), _nightManualRules.find(sel)];
    const isA = (r) => (r.selectorText.match(/body\.theme-/g) || []).length === 8;
    const isB = (r) => (r.selectorText.match(/body\.theme-/g) || []).length === 2;
    const [aM, aU] = pair(isA), [bM, bU] = pair(isB);
    assert(!!aM && !!aU && !!bM && !!bU && canon(aM) === canon(aU) && canon(bM) === canon(bU),
      '[2c-a2] Block A and Block B-munera are each BYTE-IDENTICAL between the media-query trigger and the manual-override trigger (the "keep in sync" contract, per block)');
  }
  let allMatch = true, mismatch = null;
  for (const k of mediaKeys) {
    if (nightMediaVars[k].toUpperCase() !== nightManualVars[k].toUpperCase()) { allMatch = false; mismatch = k; }
  }
  assert(allMatch, `[2c-b] every shared variable has the IDENTICAL value in both blocks${mismatch ? ` (mismatch on --${mismatch}: media=${nightMediaVars[mismatch]}, manual=${nightManualVars[mismatch]})` : ''}`);

  // Scope: the dark override selector must never be bare `:root` (which
  // would leak dark mode onto the five school themes that inherit --bg/
  // --text-primary from :root — sooner/trojan/irish/boilermaker/razorback).
  const bareRootInDarkMedia = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{/.test(cssText);
  assert(!bareRootInDarkMedia,
    '[2c-c] the dark media query never targets bare :root directly — only body.theme-neutral, so the five non-aggie school themes (which inherit --bg/--text-primary from :root) never go dark');
  // [2c-d] OVERTURNED by Drew's amendment (2026-09-30, "make light/dark versions of school themes") and re-derived (SP-52 DI-448/DI-451/DI-456, 2026-10-01).
  // The old assertion — "every school selector is ABSENT from both night blocks" (school themes stay light-only) — would now fail a CORRECT build. The
  // scoping it protected is pinned in the NEW direction: every school selector IS in Block A's list (so it inherits Munera Dark's page, cards, text and
  // semantics) and has its OWN B-school pair; none is in P (Paper) or G (Graphite); and bare :root still never goes dark (checked above).
  const schoolThemes = ['theme-aggie', 'theme-sooner', 'theme-trojan', 'theme-irish', 'theme-boilermaker', 'theme-razorback'];
  const mediaBlockMatch = cssText.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{([\s\S]*?)\n\}/);
  assert(!!mediaBlockMatch, '[2c-pre] fixture: the dark-mode @media block\'s full body was located for the school-theme checks below');
  const darkRules = _sheet.rules.filter((r) => r.media === 'dark' && !r.selectorText.startsWith(':where('));
  const blockA = darkRules.find((r) => (r.selectorText.match(/body\.theme-/g) || []).length === 8);
  for (const theme of schoolThemes) {
    assert(!!blockA && blockA.selectorText.includes(`body.${theme}:not(`),
      `[2c-d] body.${theme} IS in the shared Dark-surface block A — it inherits Munera Dark's page, cards, text and semantics (the school Dark side exists)`);
    const own = darkRules.filter((r) => r.selectorText.trim().startsWith(`body.${theme}:not(`));
    assert(own.length === 1 && own[0].decls.some((d) => d.prop === '--maroon-text'),
      `[2c-d2] body.${theme} has its OWN B-school block declaring its accent-text roles (--maroon-text …) — the school's brand is not borrowed from Munera`);
    const inPG = darkRules.filter((r) => /^body\.theme-(paper|graphite)/.test(r.selectorText.trim()) && r.selectorText.includes(theme));
    assert(inPG.length === 0, `[2c-d3] body.${theme} appears in neither the Paper nor the Graphite block`);
  }

  // Contrast — every new dark token against the ones it actually pairs with
  // in the shipped CSS, computed fresh (mirrors [2]'s discipline).
  const darkBg = nightMediaVars['bg'];
  const darkCard = nightMediaVars['bg-card'];
  const darkTextPrimary = nightMediaVars['text-primary'];
  const darkTextSecondary = nightMediaVars['text-secondary'];
  const darkTextMuted = nightMediaVars['text-muted'];
  const darkWin = nightMediaVars['win'];
  const darkWinBg = nightMediaVars['win-bg'];
  const darkLoss = nightMediaVars['loss'];
  const darkLossBg = nightMediaVars['loss-bg'];

  const darkCases = [
    { label: 'dark --text-primary on dark --bg', a: darkTextPrimary, b: darkBg, min: 7.0 },
    { label: 'dark --text-primary on dark --bg-card', a: darkTextPrimary, b: darkCard, min: 7.0 },
    { label: 'dark --text-secondary on dark --bg', a: darkTextSecondary, b: darkBg, min: 4.5 },
    { label: 'dark --text-secondary on dark --bg-card', a: darkTextSecondary, b: darkCard, min: 4.5 },
    { label: 'dark --text-muted on dark --bg', a: darkTextMuted, b: darkBg, min: 4.5 },
    { label: 'dark --text-muted on dark --bg-card', a: darkTextMuted, b: darkCard, min: 4.5 },
    { label: 'dark --win on dark --win-bg', a: darkWin, b: darkWinBg, min: 4.5 },
    { label: 'dark --win on dark --bg', a: darkWin, b: darkBg, min: 4.5 },
    { label: 'dark --loss on dark --loss-bg', a: darkLoss, b: darkLossBg, min: 4.5 },
    { label: 'dark --loss on dark --bg', a: darkLoss, b: darkBg, min: 4.5 },
  ];
  for (const c of darkCases) {
    assert(c.a && c.b, `[2c-pre] fixture: both sides of "${c.label}" were parsed from the CSS (a=${c.a}, b=${c.b})`);
    if (!c.a || !c.b) continue;
    const ratio = contrastRatio(c.a, c.b);
    assert(ratio >= c.min, `[2c-e/${c.label}] ${ratio.toFixed(2)}:1 clears AA (>= ${c.min}:1)`);
  }

  // The hard requirement DI-360 carries forward from DI-362/DI-328b: Gold-on-
  // Crimson text must clear AA via --gold-light, and this holds REGARDLESS
  // of light/dark mode because --maroon/--gold/--gold-light are explicitly
  // UNCHANGED by night mode (Oxblood/Crimson-as-fill is background-agnostic).
  // Re-verified here rather than assumed to "still hold" from [2] above.
  assert(!('maroon' in nightMediaVars) && !('gold' in nightMediaVars) && !('gold-light' in nightMediaVars),
    '[2c-f] night mode does NOT redeclare --maroon/--gold/--gold-light — confirms they are inherited unchanged from body.theme-neutral\'s own (light-mode-computed) values, not silently overridden in the dark block');
  const goldLightOnCrimsonDark = contrastRatio(neutralVars['gold-light'], neutralVars['maroon']);
  assert(goldLightOnCrimsonDark >= 4.5,
    `[2c-g] --gold-light on --maroon still clears AA (${goldLightOnCrimsonDark.toFixed(2)}:1 >= 4.5:1) even though night mode leaves both tokens untouched — the pairing DI-360 depends on holding in dark mode too`);

  // Coordinator fix (2026-09-27, item 3) — `color-scheme:dark` in both dark
  // blocks, so the browser paints native UI (scrollbars, form-control
  // chrome, default focus ring) in dark styling too, not just our own
  // tokens. Source-level: `extractVars()` only captures `--name:#hex`
  // declarations, so this plain CSS property needs its own direct check.
  const hasDarkScheme = (r) => r.decls.some((d) => d.prop === 'color-scheme' && /^dark$/.test(d.value.trim()));
  assert(_nightMediaRules.some(hasDarkScheme),
    '[2c-h] the @media(prefers-color-scheme:dark) block A sets color-scheme:dark on body.theme-neutral');
  assert(_nightManualRules.some(hasDarkScheme),
    '[2c-i] the manual-override block A sets color-scheme:dark too — both triggers get native-UI dark styling, not just the automatic one');
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] createGame() defaults homeLogo/awayLogo to null (DI-331b, CONVENTIONS #10)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] createGame() default-when-missing story for homeLogo/awayLogo…');
{
  const g = createGame('w_test');
  assert(g.homeLogo === null, '[3a] createGame() defaults homeLogo to null when not overridden');
  assert(g.awayLogo === null, '[3b] createGame() defaults awayLogo to null when not overridden');
  const g2 = createGame('w_test', { homeLogo: 'https://a.espncdn.com/i/teamlogos/ncaa/500/2633.png' });
  assert(g2.homeLogo === 'https://a.espncdn.com/i/teamlogos/ncaa/500/2633.png',
    '[3c] createGame() overrides still flow through normally (homeLogo passed via overrides)');
  assert(g2.awayLogo === null, '[3d] awayLogo still defaults to null when only homeLogo is overridden');
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] data-provider.js — logoOk() matches the DB CHECK constraint exactly,
//     tested directly against the exported function (not source-level).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] js/data-provider.js — logoOk() matches the DB CHECK constraint…');
{
  const validUrl = 'https://a.espncdn.com/i/teamlogos/ncaa/500/2633.png';
  assert(logoOk(validUrl) === validUrl, '[4a] a normal https:// URL under 300 chars passes through unchanged');
  assert(logoOk('http://a.espncdn.com/logo.png') === null,
    '[4b] http:// (wrong scheme — the DB constraint requires https://) → null');
  const longButOk = 'https://a.espncdn.com/' + 'a'.repeat(300 - 'https://a.espncdn.com/'.length); // exactly 300 chars
  assert(longButOk.length === 300 && logoOk(longButOk) === longButOk,
    '[4c] a URL at EXACTLY the 300-char boundary still passes (constraint is <=300, not <300)');
  const tooLong = longButOk + 'x'; // 301 chars
  assert(tooLong.length === 301 && logoOk(tooLong) === null,
    '[4d] a 301-char URL (one over the boundary) → null');
  assert(logoOk(undefined) === null, '[4e] undefined (absent team.logo) → null');
  assert(logoOk(null) === null, '[4f] null → null');
  assert(logoOk(42) === null, '[4g] a non-string value → null (defensive, CONVENTIONS #7)');

  // Confirms parseAndReport() actually CALLS logoOk() at the two capture
  // sites, not just that logoOk() itself is correct in isolation — a
  // source-level check for the wiring, since parseAndReport() is
  // module-private and not exported.
  const providerPath = fileURLToPath(new URL('./js/data-provider.js', import.meta.url));
  const providerSrc = await readFile(providerPath, 'utf8');
  assert(/const\s+homeLogo\s*=\s*logoOk\(home\.team\?\.logo\)/.test(providerSrc),
    '[4h] homeLogo is captured via `logoOk(home.team?.logo)`, not a bare ?? null');
  assert(/const\s+awayLogo\s*=\s*logoOk\(away\.team\?\.logo\)/.test(providerSrc),
    '[4i] awayLogo is captured via `logoOk(away.team?.logo)`');
  assert(/homeLogo,\s*awayLogo,/.test(providerSrc) || /homeLogo,\s*\n\s*awayLogo,/.test(providerSrc),
    '[4j] homeLogo/awayLogo are passed into createGame()\'s overrides object');
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] Projection round-trip — homeLogo/awayLogo land in TYPED columns, never
//     in `extra`, and round-trip back out unchanged (js/supabase-projection.js
//     GAME_COLS, fix round 1).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] Projection round-trip — GAME_COLS carries homeLogo/awayLogo as typed columns…');
{
  const HOME_URL = 'https://a.espncdn.com/i/teamlogos/ncaa/500/2633.png';
  const game = createGame('w_test', {
    gameId: 'g_proj_test', homeTeam: 'Texas A&M', awayTeam: 'LSU',
    homeLogo: HOME_URL, awayLogo: null,
  });

  const projected = toRows.cfbp_games([game], { leagueId: 'L1' });
  assert(Array.isArray(projected.games) && projected.games.length === 1,
    '[5a] toRows.cfbp_games() projects exactly one row for one game');
  const row = projected.games[0];
  assert(row.home_logo === HOME_URL,
    `[5b] the typed home_logo column carries the URL (got: ${JSON.stringify(row.home_logo)})`);
  assert(row.away_logo === null,
    `[5c] the typed away_logo column is null (got: ${JSON.stringify(row.away_logo)})`);
  assert(row.extra && !Object.prototype.hasOwnProperty.call(row.extra, 'homeLogo'),
    '[5d] `extra` does NOT contain a homeLogo key — it went to the typed column instead');
  assert(row.extra && !Object.prototype.hasOwnProperty.call(row.extra, 'awayLogo'),
    '[5e] `extra` does NOT contain an awayLogo key');

  const restored = fromRows.cfbp_games({ games: [row] }, { leagueId: 'L1' });
  assert(Array.isArray(restored) && restored.length === 1,
    '[5f] fromRows.cfbp_games() restores exactly one legacy object');
  assert(restored[0].homeLogo === HOME_URL,
    `[5g] the round-tripped legacy object's homeLogo matches the original URL (got: ${JSON.stringify(restored[0].homeLogo)})`);
  assert(restored[0].awayLogo === null,
    `[5h] the round-tripped legacy object's awayLogo is null (got: ${JSON.stringify(restored[0].awayLogo)})`);

  // The exact defect this whole round exists to prevent: a game object that
  // ALREADY has a stray extra.homeLogo (simulating a row written during a
  // hypothetical gap where the client shipped before this projection fix)
  // must NOT have that stray value survive a fresh toRows() pass — toRows
  // rebuilds `extra` from scratch from the OBJECT's own unknown keys, and
  // homeLogo/awayLogo are no longer unknown, so this is the self-healing
  // half of the mechanism described in sql-drafts/E_logos.sql's header.
  const poisoned = { ...game, extra: { homeLogo: 'https://stale.example/old.png' } };
  const reProjected = toRows.cfbp_games([poisoned], { leagueId: 'L1' });
  assert(reProjected.games[0].home_logo === HOME_URL,
    '[5i] a fresh toRows() pass on an object whose OWN field is correct ignores a stray same-named key sitting in that object\'s own `.extra` — extra is only ever built from unknown top-level keys, never merged with a pre-existing extra blob on the input');
}

// ── Result ───────────────────────────────────────────────────────────────────
process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
