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

// ─────────────────────────────────────────────────────────────────────────────
// [1] Token values match DI-328b's literal hex (source-of-truth check)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] :root and theme-neutral carry the exact Munera hex values…');
{
  const expected = {
    maroon: '#7A1F2B', 'maroon-mid': '#922536', 'maroon-light': '#A83B4A',
    gold: '#C9A24B', 'gold-light': '#E8C96A', 'gold-text': '#6E5419',
    bg: '#E8E4DC', 'bg-card': '#FFFFFF',
  };
  for (const [name, hex] of Object.entries(expected)) {
    assert(rootVars[name] && rootVars[name].toUpperCase() === hex.toUpperCase(),
      `[1a/:root] --${name} is ${hex} (found: ${rootVars[name]})`);
    assert(neutralVars[name] && neutralVars[name].toUpperCase() === hex.toUpperCase(),
      `[1b/theme-neutral] --${name} is ${hex} (found: ${neutralVars[name]})`);
  }
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
  // this is the "value moved, pixels didn't" guarantee (DI-328a).
  assert(aggieVars.maroon && aggieVars.maroon.toUpperCase() === '#500000',
    `[1c/theme-aggie] --maroon is the OLD literal #500000 (found: ${aggieVars.maroon})`);
  assert(aggieVars.maroon && aggieVars.maroon.toUpperCase() !== '#7A1F2B',
    '[1d/theme-aggie] --maroon is NOT the new Munera Oxblood value (no leak)');
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] Computed WCAG contrast — every pairing in DI-328b's table, recomputed
//     from the literal hex above, asserted against its documented verdict.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] WCAG contrast — every DI-328b pairing, computed fresh…');
{
  const ink = rootVars['text-primary'];
  const marble = rootVars['bg'];
  const white = rootVars['bg-card'];
  const oxblood = rootVars['maroon'];
  const gold = rootVars['gold'];
  const goldText = rootVars['gold-text'];
  const goldLight = rootVars['gold-light'];

  const cases = [
    { label: 'Ink on Marble', a: ink, b: marble, min: 14.0, verdict: 'AAA' },
    { label: 'Oxblood text on Marble', a: oxblood, b: marble, min: 7.0, verdict: 'AAA' },
    { label: 'Oxblood text on white (--bg-card)', a: oxblood, b: white, min: 7.0, verdict: 'AAA' },
    { label: 'White text on Oxblood bg', a: white, b: oxblood, min: 7.0, verdict: 'AAA' },
    { label: 'Gold text on Ink bg', a: gold, b: ink, min: 7.0, verdict: 'AAA' },
    { label: '--gold-text on Marble (the required variant)', a: goldText, b: marble, min: 4.5, verdict: 'AA' },
    { label: '--gold-light on Oxblood (the required variant)', a: goldLight, b: oxblood, min: 4.5, verdict: 'AA' },
  ];
  for (const c of cases) {
    const ratio = contrastRatio(c.a, c.b);
    assert(ratio >= c.min, `[2/${c.label}] ${ratio.toFixed(2)}:1 clears ${c.verdict} (>= ${c.min}:1)`);
  }

  // FAIL cases — documented as pairings to avoid; asserted as FAILING, not
  // passing, so a future accidental "fix" that makes plain --gold usable as
  // text somewhere doesn't silently invalidate the documented guidance.
  const failCases = [
    // Corrected 2026-09-25 (reviewer BLOCK round 1) — this was mis-stated as
    // 1.39:1 in the original DI-328b comment table AND in this table before
    // recomputation; the real value is ~1.89:1. Still a clear AA fail (<4.5).
    { label: 'plain Gold text on Marble bg (must use --gold-text instead)', a: gold, b: marble, max: 4.5, expectAround: 1.89 },
    { label: 'Ink text on Oxblood bg (a pairing to AVOID, nothing builds it)', a: ink, b: oxblood, max: 4.5, expectAround: 1.84 },
  ];
  for (const c of failCases) {
    const ratio = contrastRatio(c.a, c.b);
    assert(ratio < c.max, `[2/${c.label}] ${ratio.toFixed(2)}:1 correctly FAILS AA (< ${c.max}:1)`);
    assert(Math.abs(ratio - c.expectAround) < 0.05,
      `[2/${c.label}] computed ratio ${ratio.toFixed(2)}:1 matches the documented figure (~${c.expectAround}:1)`);
  }

  // Gold on Oxblood — passes AA-Large (3:1) but fails AA body text (4.5:1);
  // both halves of that claim are asserted, not just one.
  const goldOnOxblood = contrastRatio(gold, oxblood);
  assert(goldOnOxblood >= 3.0, `[2/Gold on Oxblood] ${goldOnOxblood.toFixed(2)}:1 clears AA-Large (>= 3:1)`);
  assert(goldOnOxblood < 4.5, `[2/Gold on Oxblood] ${goldOnOxblood.toFixed(2)}:1 correctly FAILS AA body text (< 4.5:1) — must use --gold-light for text`);
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
