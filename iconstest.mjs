/**
 * CFB Pickems — iconstest.mjs (DI-329e, UX Revamp Group E, 2026-09-25)
 * =====================================================================
 * Unit tests for js/icons.js — the Munera inline-SVG icon family (AD-93).
 * Precedent for a focused standalone suite beside loadtest.mjs:
 * grouptest.mjs (UN-118), platformtest.mjs.
 *
 * Run:  node iconstest.mjs
 *
 * Covers:
 *   [1] Every entry in ICONS is a structurally valid, hand-authored SVG
 *       matching the shipped nav-SVG convention exactly: starts with
 *       `<svg `, contains `viewBox="0 0 24 24"`, `stroke="currentColor"`,
 *       `stroke-width="2"`, `fill="none"`, and carries no OTHER `fill="..."`
 *       value anywhere in the markup (decorative shapes stay outline-only).
 *   [2] icon('unknown-name') warns via console.warn and returns '' rather
 *       than throwing.
 *   [3] icon(name) with no options returns `aria-hidden="true"
 *       focusable="false"` (the default, decorative case — matches every
 *       shipped nav icon, index.html:216-242).
 *   [4] icon(name, { label }) returns `role="img" aria-label="<label>"`
 *       instead, and does NOT also carry aria-hidden.
 *   [5] The DI-329b chrome-vs-text scan PRIMITIVE — a reusable
 *       `scanSourceForBannedEmoji()` — self-tested against a synthetic
 *       fixture string here, NOT run against the real js/app.js yet.
 *       WIRING WINDOW: js/app.js still carries the Phase 1 emoji this DI
 *       names (🔔 index.html:184; ⭐ app.js's 9 alma-mater sites; 📡
 *       renderSourceBadge() plus 3 dropdown sites) because app.js is
 *       SHARED-SERIALIZED territory claimed by other groups this pass —
 *       running this scan against the live file today would correctly
 *       report FAIL, not because the scan is wrong but because the
 *       conversion hasn't been wired in yet. A future pass imports
 *       `scanSourceForBannedEmoji` from this file (or promotes it into
 *       js/icons.js) and runs it for real against js/app.js's chrome-surface
 *       functions once DI-330's Phase 1 conversion lands.
 */

import { readFile } from 'node:fs/promises';
import { ICONS, icon } from './js/icons.js';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

// ─────────────────────────────────────────────────────────────────────────────
// [1] Every ICONS entry is a structurally valid, hand-authored SVG
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] ICONS entries — structural validity, shared convention…');
{
  const names = Object.keys(ICONS);
  assert(names.length > 0, '[1a] ICONS is non-empty');
  assert(names.includes('bell') && names.includes('almaMater') && names.includes('settings'),
    '[1b] Phase 1 set present: bell, almaMater, settings');
  assert(names.includes('chevronRight') && names.includes('chevronLeft') && names.includes('sportFootball'),
    '[1b2] Coordinator follow-up set present: chevronRight, chevronLeft, sportFootball (2026-09-25)');
  assert(
    names.includes('calendarWeek') && names.includes('playersGroup') && names.includes('rulebook') &&
    names.includes('scribeSpark') && names.includes('cloudData') && names.includes('shieldAdmin'),
    '[1b3] Coordinator follow-up set present: calendarWeek, playersGroup, rulebook, scribeSpark, cloudData, shieldAdmin (2026-09-25, commissioner/admin panel tabs)'
  );
  assert(
    names.includes('clipboard') && names.includes('pin') && names.includes('pencil') && names.includes('tv'),
    '[1b5] F8 icon-inventory set present: clipboard, pin, pencil, tv (WIRING_CHECKLIST_B_092526.md, UX Revamp wiring pass 3a — renderSourceBadge/Data Source Mode select/game-filter chips)'
  );
  // Raised 16 -> 17, wiring pass 3a-bis (2026-09-25) — BLOCK 4's `warning`
  // glyph (renderSourceBadge()'s `partial` data-quality state had none).
  // Raised 17 -> 24, 3c fix window third pass (STEP B(14)) — the week wizard's
  // status-button glyphs: megaphone, lock, unlock, play, pause, check, undo.
  assert(['megaphone', 'lock', 'unlock', 'play', 'pause', 'check', 'undo'].every(n => names.includes(n)),
    '[1b7] STEP B(14) set present: megaphone, lock, unlock, play, pause, check, undo (week wizard status buttons, D-1 phase 2)');
  // Raised 24 -> 25, reviewer round 3 item 5 (2026-09-26) — `refresh`
  // (invite-card "Rotate Code", replacing 🔄).
  assert(names.includes('refresh'), '[1b8] reviewer round 3 item 5 set present: refresh (invite-card Rotate Code)');
  // Raised 25 -> 26, full-app review Step 6 (2026-09-26) — `close` (the
  // drawer's close button and the backend-error banner's Dismiss, replacing ✕).
  assert(names.includes('close'), '[1b9] full-app review Step 6 set present: close (drawer close, banner Dismiss)');
  // Raised 26 -> 27, v0.27.0 fix (2026-09-27) — `munera`, the temple mark
  // that fills the header's #control-center-trigger on the native shell. It
  // shipped EMPTY in v0.26.0 (an invisible button; the drawer's Sign Out was
  // unreachable by tap). Same family shape as every other entry — the [1c-1i]
  // loop below scans it like the rest.
  assert(names.includes('munera'), '[1b10] v0.27.0 set present: munera (the native header mark that opens the control center)');
  assert(names.length === 27, `[1b6] ICONS carries exactly 27 entries this pass (found ${names.length}: ${names.join(', ')}) — a raised count here is a deliberate signal to re-check this assertion, not a floor to silently exceed`);

  for (const name of names) {
    const svg = ICONS[name];
    assert(typeof svg === 'string' && svg.startsWith('<svg ') && svg.trim().endsWith('</svg>'),
      `[1c/${name}] well-formed <svg>...</svg> string`);
    assert(svg.includes('viewBox="0 0 24 24"'), `[1d/${name}] viewBox="0 0 24 24"`);
    assert(svg.includes('stroke="currentColor"'), `[1e/${name}] stroke="currentColor"`);
    assert(svg.includes('stroke-width="2"'), `[1f/${name}] stroke-width="2"`);
    assert(svg.includes('fill="none"'), `[1g/${name}] fill="none" on the root <svg>`);
    // No OTHER fill value anywhere in the markup — outline-only, decoration
    // never leaks a solid fill that would ignore currentColor theming.
    const fillMatches = [...svg.matchAll(/fill="([^"]*)"/g)].map(m => m[1]);
    assert(fillMatches.every(v => v === 'none'), `[1h/${name}] every fill="" attribute is "none" (found: ${JSON.stringify(fillMatches)})`);
    // Balanced tags, roughly — every opened element that isn't self-closing
    // has a matching close; cheap structural smoke test, not a full parser.
    // `ellipse` added alongside `polyline` for the 2026-09-25 additions
    // (chevronRight/chevronLeft use polyline; sportFootball uses ellipse).
    const opens = (svg.match(/<(svg|path|line|circle|rect|polyline|ellipse)\b/g) || []).length;
    const closes = (svg.match(/<\/(svg|path|line|circle|rect|polyline|ellipse)>/g) || []).length
      + (svg.match(/\/>/g) || []).length;
    assert(opens > 0 && closes >= opens, `[1i/${name}] tag-balance smoke test (opens=${opens}, closes-or-self-closed=${closes})`);
  }

  // ── [1j] DI-349 (2026-09-27) — Comm-panel Games-tab icon swap ───────────
  // `ICONS.sportFootball` moved from the ellipse+diagonal-lace football
  // glyph (concept: rotated ellipse, one diagonal seam line, three short
  // cross-ticks) to the recommended "scoreboard tile" concept (rounded
  // rect + vertical divider + a short tick in each half). Mutation-proven:
  // the OLD glyph's distinguishing path data must be entirely gone, not
  // just supplemented, and the new glyph's distinguishing shapes must be
  // present and share the `tv` glyph's rect-based grammar.
  const sf = ICONS.sportFootball;
  assert(!sf.includes('ellipse'), '[1j-1] old football-ellipse element is gone from sportFootball');
  assert(!sf.includes('rotate(45'), '[1j-2] old 45°-rotation transform (the ellipse\'s orientation) is gone');
  assert(!sf.includes('x1="9.5" y1="14.5"') && !sf.includes('x1="11.5" y1="12.5"') && !sf.includes('x1="13.5" y1="10.5"'),
    '[1j-3] old lace-tick coordinates are gone (all three cross-ticks removed, not just one)');
  assert(sf.includes('<rect'), '[1j-4] new glyph draws the scoreboard-tile <rect>');
  assert(sf.includes('rx="2"'), '[1j-5] the tile rect uses the family\'s rounded-corner radius (rx="2", matching the `tv`/`clipboard`/`lock` glyphs)');
  const lineCount = (sf.match(/<line\b/g) || []).length;
  assert(lineCount === 3, `[1j-6] exactly 3 <line> elements: the vertical divider + one tick per half (found ${lineCount})`);
  assert(sf.includes('x1="12" y1="6" x2="12" y2="18"'), '[1j-7] the vertical divider line spans the tile\'s full height, centered');
  // Shares the `tv` glyph's rect-based grammar (DI-349's stated rationale).
  assert(ICONS.tv.includes('<rect') && sf.includes('<rect'), '[1j-8] sportFootball now shares the rect-based grammar the `tv` glyph already established');
}

// ─────────────────────────────────────────────────────────────────────────────
// [2] icon('unknown') — warns, returns '', never throws
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] icon(unknown) — warns and returns empty string…');
{
  const originalWarn = console.warn;
  let warned = false, warnedWith = null;
  console.warn = (...args) => { warned = true; warnedWith = args.join(' '); };
  let threw = false;
  let result;
  try { result = icon('this-icon-does-not-exist'); }
  catch (e) { threw = true; }
  console.warn = originalWarn;

  assert(threw === false, '[2a] icon(unknown) does not throw');
  assert(result === '', '[2b] icon(unknown) returns empty string');
  assert(warned === true && /unknown icon/i.test(warnedWith || ''), '[2c] icon(unknown) warns with the icon name context');
}

// ─────────────────────────────────────────────────────────────────────────────
// [3] icon(name) default — aria-hidden, decorative
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] icon(name) default — aria-hidden="true" focusable="false"…');
{
  const out = icon('bell');
  assert(out.includes('aria-hidden="true"'), '[3a] carries aria-hidden="true"');
  assert(out.includes('focusable="false"'), '[3b] carries focusable="false"');
  assert(!out.includes('role="img"'), '[3c] does NOT carry role="img" by default');
  assert(!out.includes('aria-label'), '[3d] does NOT carry aria-label by default');
  assert(out.includes('viewBox="0 0 24 24"'), '[3e] still the same underlying SVG markup');
}

// ─────────────────────────────────────────────────────────────────────────────
// [4] icon(name, { label }) — standalone, labeled case
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] icon(name, { label }) — role="img" aria-label, no aria-hidden…');
{
  const out = icon('settings', { label: 'Settings' });
  assert(out.includes('role="img"'), '[4a] carries role="img"');
  assert(out.includes('aria-label="Settings"'), '[4b] carries aria-label with the given text');
  assert(!out.includes('aria-hidden'), '[4c] does NOT also carry aria-hidden');
  assert(!out.includes('focusable="false"'), '[4d] does NOT also carry focusable="false"');
}

// ─────────────────────────────────────────────────────────────────────────────
// [4e] SECURITY N2 (pass-2 security-reviewer, 2026-09-25) — icon(name, { label })
// escapes a hostile label rather than interpolating it raw into the
// aria-label attribute value.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4e] icon(name, { label }) — hostile label is escaped, never breaks out of the attribute…');
{
  const hostile = `"><script>alert(1)</script>`;
  const out = icon('settings', { label: hostile });
  assert(!out.includes('<script>'), '[4e-1] no live <script> tag from the label');
  assert(out.includes('&quot;'), '[4e-3] the double-quote is escaped, not a raw attribute break-out');
  assert(out.includes('&lt;script&gt;'), '[4e-4] the angle brackets are escaped');
  // The SVG's own attribute list must still parse as exactly one aria-label
  // attribute — a successful break-out would add a SECOND attribute (or a
  // child element) instead.
  const labelAttrCount = (out.match(/aria-label="/g) || []).length;
  assert(labelAttrCount === 1, `[4e-5] exactly one aria-label attribute survives (got ${labelAttrCount})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// [4f] SECURITY N3 (pass-2 security-reviewer, 2026-09-25) — every ICONS entry
// is inert markup: no <script>, no <foreignObject>, no <use>/<image> (both
// can pull in external content via href/xlink:href), no href/xlink:href
// attribute at all, no url(...) reference (a CSS-context injection vector
// inside an inline style/fill). Hand-authored SVG staying hand-authored,
// enforced rather than assumed.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4f] ICONS entries carry no active/referencing SVG content…');
{
  const BANNED_TAGS = /<\s*(script|foreignObject|use|image)\b/i;
  const BANNED_ATTRS = /\b(xlink:href|href)\s*=/i;
  const BANNED_URL = /url\s*\(/i;
  for (const [name, svg] of Object.entries(ICONS)) {
    assert(!BANNED_TAGS.test(svg), `[4f-tags] "${name}" carries no <script>/<foreignObject>/<use>/<image>`);
    assert(!BANNED_ATTRS.test(svg), `[4f-attrs] "${name}" carries no href/xlink:href attribute`);
    assert(!BANNED_URL.test(svg), `[4f-url] "${name}" carries no url(...) reference`);
  }
  // Canary — a scanner that flags nothing could just be broken.
  const poisoned = `<svg viewBox="0 0 24 24"><use href="#evil"/></svg>`;
  assert(BANNED_TAGS.test(poisoned) && BANNED_ATTRS.test(poisoned), '[4f-canary] the three patterns actually catch a poisoned fixture');
}

// ─────────────────────────────────────────────────────────────────────────────
// [5] DI-329b chrome-vs-text scan primitive — self-test only, not yet wired
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] Chrome-vs-text banned-emoji scan primitive — self-test against a fixture…');

/**
 * Returns every banned emoji found inside `sourceText`. Deliberately a flat
 * substring scan, not a JS parser — the future wiring pass narrows this to
 * an allow-listed function-name list (chrome-surface renderers only,
 * chat-composer/SCRIBE-line functions excluded, per DI-329b) once it runs
 * against the real js/app.js. Exported so that future pass can `import` it
 * instead of re-deriving the same primitive a second time (AD-20's own
 * "one shared source" rule, applied to test tooling too).
 */
export function scanSourceForBannedEmoji(sourceText, bannedEmoji) {
  const found = [];
  for (const glyph of bannedEmoji) {
    if (sourceText.includes(glyph)) found.push(glyph);
  }
  return found;
}

{
  const PHASE_1_BANNED = ['🔔', '📡', '⭐'];
  const dirtyFixture = 'function renderBell(){ return `<span>🔔</span>`; }';
  const cleanFixture  = `function renderBell(){ return icon('bell'); }`;

  assert(
    JSON.stringify(scanSourceForBannedEmoji(dirtyFixture, PHASE_1_BANNED)) === JSON.stringify(['🔔']),
    '[5a] scan finds a banned emoji present in a dirty fixture'
  );
  assert(
    scanSourceForBannedEmoji(cleanFixture, PHASE_1_BANNED).length === 0,
    '[5b] scan finds nothing in a fixture already converted to icon()'
  );
  assert(
    scanSourceForBannedEmoji('☕ unrelated text-surface emoji, not in the Phase 1 list', PHASE_1_BANNED).length === 0,
    '[5c] scan ignores emoji outside the banned Phase 1 list (e.g. text-surface glyphs)'
  );

  // Explicitly NOT asserted here: the real js/app.js as a WHOLE FILE. See
  // this section's header comment — a blanket sweep still belongs to a
  // later pass (app.js carries plenty of Phase 1 emoji outside the sites
  // named below). SECTION [6] immediately below DOES check the real file,
  // scoped to the specific call sites this pass converted.
  console.log('  ℹ️  scanSourceForBannedEmoji() NOT run against the whole of js/app.js this pass — see [6] for the scoped, real-file check.');
}

// ─────────────────────────────────────────────────────────────────────────────
// [6] REVIEWER BLOCK 4 (pass-2, 2026-09-25) — the real js/app.js, scoped to
// the specific call sites this pass converted (renderSourceBadge()'s four
// data-quality badges, the three National TV sites). Not a whole-file sweep
// (see [5]'s note) — this asserts THESE sites specifically use icon(...)
// and carry none of the five emoji they used to.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] BLOCK 4 — renderSourceBadge()/National TV call sites use icon(), no emoji…');
{
  const appSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const BANNED = ['📅', '📋', '📌', '⚠️', '📺'];

  const fnStart = appSrc.indexOf('function renderSourceBadge(game)');
  assert(fnStart !== -1, '[6a] fixture: renderSourceBadge() found in js/app.js');
  const fnBody = appSrc.slice(fnStart, appSrc.indexOf('\n}', fnStart));
  for (const glyph of BANNED) {
    assert(!fnBody.includes(glyph), `[6b] renderSourceBadge() no longer emits ${glyph}`);
  }
  assert(["calendarWeek", "clipboard", "pin", "warning"].every(n => fnBody.includes(`icon('${n}'`)),
    "[6c] renderSourceBadge() calls icon('calendarWeek'/'clipboard'/'pin'/'warning', ...) for its four badges");

  const tvSites = [...appSrc.matchAll(/national-tv-badge[^`]*`/g)].map(m => m[0]);
  const tvChipLine = appSrc.split('\n').find(l => l.includes('On National TV'));
  assert(tvSites.length === 2, `[6d] fixture: found 2 national-tv-badge template sites (got ${tvSites.length})`);
  assert(!!tvChipLine, '[6e] fixture: found the "On National TV" filter-chip line');
  for (const site of [...tvSites, tvChipLine]) {
    assert(site.includes("icon('tv')"), `[6f] site uses icon('tv') — ${JSON.stringify(site.slice(0, 60))}…`);
    assert(!BANNED.some(g => site.includes(g)), `[6g] site carries no banned emoji — ${JSON.stringify(site.slice(0, 60))}…`);
  }
}

// ── Result ───────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// [7] STEP B(14) (3c fix window, third pass) — the week wizard's chrome emoji
// are gone: status buttons render a Munera glyph + text, and the Data Source
// <option>s are text-only (an <option> cannot hold an SVG; the native picker
// convention is text).
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] STEP B(14) — week wizard: glyph + text status buttons, text-only data-source options…');
{
  const { readFileSync } = await import('node:fs');
  const ww = await import('./js/week-wizard.js');
  const statuses = ['draft', 'open', 'locked', 'live', 'final'];
  const btns = statuses.flatMap(st => ww.narrowedWeekStatusButtons(st));
  assert(btns.length > 0 && btns.every(b => typeof b.icon === 'string' && ICONS[b.icon] && typeof b.text === 'string' && b.text.length > 0),
    `[7a] every narrowed wizard status button names a real ICONS glyph and a text label (${btns.map(b => `${b.to}:${b.icon}`).join(', ')})`);
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{23E9}-\u{23FA}\u{21A9}]/u;
  assert(btns.every(b => !EMOJI.test(b.text)), '[7b] …and no text label carries an emoji / pictographic arrow');
  const app = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/week-wizard-status-btn" data-to="\$\{b\.to\}">\$\{wizardStatusIconHTML\(b\)\}\$\{escHtml\(b\.text\)\}<\/button>/.test(app),
    '[7c] the wizard renders wizardStatusIconHTML(b) + escHtml(b.text) — never the emoji label');
  // DI-353 (UN-311, 2026-09-27) — the Data Source <select> is REMOVED from
  // the wizard's commissioner-facing form entirely (Admin → Week's own
  // 'data-source-mode' card is the one surviving control), so this pin now
  // asserts the ABSENCE rather than an emoji-free presence — a stray future
  // re-add of this field (with or without emoji) is still caught, either way.
  const cwMode = (app.match(/<select class="form-select" id="\$\{idPrefix\}cw-mode">[\s\S]*?<\/select>/) || [''])[0];
  assert(!cwMode, '[7d] the wizard\'s commissioner-facing form has NO Data Source <select> (DI-353 — Admin → Week is the one surviving control)');
}

// ─────────────────────────────────────────────────────────────────────────────
// [8] S1-A (full-app review, 2026-09-26) — EVERY icon() host has an svg size.
// icon() emits a viewBox-only <svg> (no width/height attributes), so a host
// without a scoped `… svg{width;height}` rule gets the UA default: the
// Week-tab status buttons rendered the glyph 41×41 and grew the button, the
// invite Copy/Rotate buttons collapsed it to 0×0. DENY-BY-DEFAULT: the host of
// every call site is DERIVED from the source (the open-tag stack before the
// call), never listed by hand; a call site whose host cannot be resolved, or
// whose host has no size rule, fails.
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[8] S1-A — every icon() host in app.js / leagues-home.js has an svg{width;height} rule…');
{
  const { readFileSync } = await import('node:fs');
  const stripJs = raw => raw.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, (m, a) => a + ' '.repeat(m.length - a.length))).join('\n');
  const cssRaw = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');

  // Every selector whose rule body sets BOTH width and height.
  const sizedSelectors = (css) => {
    const out = new Set();
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const body = m[2];
      if (!/(^|[;\s])width\s*:/.test(body) || !/(^|[;\s])height\s*:/.test(body)) continue;
      for (const sel of m[1].split(',')) out.add(sel.trim().replace(/\s+/g, ' '));
    }
    return out;
  };
  const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link', 'source']);
  // The open-tag stack immediately before `idx` (innermost last).
  const openStack = (src, idx) => {
    const before = src.slice(Math.max(0, idx - 800), idx);
    const stack = [];
    for (const m of before.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b((?:[^<>"]|"[^"]*")*)>/g)) {
      const [, close, tag, attrs] = m;
      const t = tag.toLowerCase();
      if (close) { const at = stack.map(x => x.tag).lastIndexOf(t); if (at > -1) stack.splice(at); continue; }
      if (VOID.has(t) || /\/\s*$/.test(attrs)) continue;
      const cls = ((attrs.match(/\bclass="([^"]*)"/) || [])[1] || '').split(/\s+/).filter(c => c && !/[${}]/.test(c));
      const id = (attrs.match(/\bid="([^"$]*)"/) || [])[1] || '';
      stack.push({ tag: t, cls, id });
    }
    return stack;
  };
  const candidatesFor = (stack) => {
    const host = stack[stack.length - 1];
    const out = [];
    for (const anc of stack.slice(-3).reverse()) {
      for (const c of anc.cls) { out.push(`.${c} svg`); if (anc !== host) out.push(`.${c} ${host.tag} svg`); }
      if (anc.id) out.push(`#${anc.id} svg`);
    }
    return out;
  };
  // Resolve every call site; a bare `return icon(...)` helper is followed to
  // the `${helper(` sites that place it (each of THOSE must resolve).
  const resolveSites = (src, file) => {
    const sites = [];
    for (const m of src.matchAll(/(?<![\w.$])icon\(/g)) {
      const line = src.slice(0, m.index).split('\n').length;
      // `const glyph = icon(...)` — follow the variable to the `${glyph}`
      // interpolations that place it (within the same render, just below).
      const assigned = (src.slice(Math.max(0, m.index - 80), m.index).match(/(?:const|let)\s+(\w+)\s*=\s*$/) || [])[1];
      if (assigned) {
        const tail = src.slice(m.index, m.index + 1200);
        const uses = [...tail.matchAll(new RegExp(`\\$\\{${assigned}\\}`, 'g'))];
        if (!uses.length) { sites.push({ file, line, stack: [], unresolved: `const ${assigned}` }); continue; }
        for (const u of uses) sites.push({ file, line: src.slice(0, m.index + u.index).split('\n').length, stack: openStack(src, m.index + u.index), via: assigned });
        continue;
      }
      const stack = openStack(src, m.index);
      if (stack.length) { sites.push({ file, line, stack }); continue; }
      const fn = [...src.slice(0, m.index).matchAll(/function\s+(\w+)\s*\(/g)].pop()?.[1];
      const uses = fn ? [...src.matchAll(new RegExp(`\\$\\{${fn}\\(`, 'g'))] : [];
      if (!uses.length) { sites.push({ file, line, stack: [], unresolved: fn || '(no enclosing function)' }); continue; }
      for (const u of uses) sites.push({ file, line: src.slice(0, u.index).split('\n').length, stack: openStack(src, u.index), via: fn });
    }
    return sites;
  };
  const audit = (src, file, sized) => resolveSites(src, file).map(s => {
    const cands = s.stack.length ? candidatesFor(s.stack) : [];
    const hit = cands.find(c => sized.has(c));
    return { ...s, cands, hit };
  });

  // Self-test first — a matcher that silently passes everything proves nothing.
  const fxCss = sizedSelectors('.ok svg{width:1px;height:1px} .half svg{width:1px}');
  const fx = audit('const a = `<span class="ok">${icon(\'x\')}</span><b class="half">${icon(\'y\')}</b>`;', 'fixture', fxCss);
  assert(fx.length === 2 && !!fx[0].hit && !fx[1].hit,
    `[8a] self-test: a sized host passes and a host with only width (no height) is REPORTED (${JSON.stringify(fx.map(f => f.hit || 'unsized'))})`);
  const fxHelper = audit('function glyph(b){ return icon(b.i); }\nconst s = `<button class="ok">${glyph(b)}</button>`;', 'fixture', fxCss);
  assert(fxHelper.length === 1 && fxHelper[0].via === 'glyph' && !!fxHelper[0].hit,
    '[8b] self-test: a `return icon(...)` helper is followed to the element that places it');

  const sized = sizedSelectors(cssRaw);
  const all = [];
  for (const f of ['./js/app.js', './js/leagues-home.js']) {
    all.push(...audit(stripJs(readFileSync(new URL(f, import.meta.url), 'utf8')), f.slice(2), sized));
  }
  assert(all.length >= 25, `[8c] fixture: the derivation found a real population of icon() call sites (${all.length}) — a matcher that found none would make [8d] vacuous`);
  const offenders = all.filter(s => !s.hit).map(s => `${s.file}:${s.line}${s.via ? ` via ${s.via}()` : ''} host=${s.unresolved ? `UNRESOLVED(${s.unresolved})` : JSON.stringify(s.stack[s.stack.length - 1])}`);
  assert(offenders.length === 0,
    `[8d] every icon() host has a scoped svg{width;height} rule in css/styles.css (offenders: ${JSON.stringify(offenders)})`);
  for (const [name, sel] of [['week-status-btn', '.week-status-btn svg'], ['invite Copy', '#copy-invite-code-btn svg'], ['invite Rotate', '#rotate-invite-code-btn svg']]) {
    assert(all.some(s => s.hit === sel), `[8e] the reviewer's named host "${name}" resolves to its own rule ${sel}`);
  }
}

process.stdout.write(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`,
  () => process.exit(fail === 0 ? 0 : 1));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
