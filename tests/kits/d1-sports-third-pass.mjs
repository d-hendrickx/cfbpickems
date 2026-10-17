/**
 * CFB Pickems — tests/kits/d1-sports-third-pass.mjs (D1 / v0.30.0, thread 100726-D1; the S-3 mutation kit of the sports third pass, feature-builder-opus, 2026-10-08)
 * ====================================================================================================================================================
 * THE ITEM'S KIT (S-3, D-69): every mutant the third pass used to prove its tests are not vacuous, encoded so the reviewer re-runs them and adds only gap mutants.
 * Each mutant is applied to a COPY of this cfb-pickems tree (never the checkout: no git restore, no stash, no in-place edit), the named suite is run IN THE COPY, and the
 * mutant is CAUGHT only if every named check prints ❌. The mutated file is restored from the checkout's own text before the next mutant.
 *
 * In-suite kits that run with their suites (no copy needed):
 *   sportsurfacetest [L-m1] a player screen reads the separate lens -> [L-b4] RED; [L-m2] setLensSport without the commissioner check -> (d) RED;
 *                    [L-m3] the separate lens outlives a join -> (c) RED            (DI-534 REV 5, item 3)
 *   sportgeometrytest [9-1]..[9-11]  eleven override-sheet mutants on the real page (padding knocked down, targets shrunk, gaps removed, off-centre,
 *                    the switcher allowed to wrap, the pills held on one line, a literal colour)                    (P-8, item 2)
 *
 * Run:  node tests/kits/d1-sports-third-pass.mjs                 every mutant (about 4 minutes: four of them drive Chromium)
 *       node tests/kits/d1-sports-third-pass.mjs K1-a K3-b      just those
 * Exit 0 only when every mutant is CAUGHT.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// { id, item, what, file, find, replace, suite, red: [the check labels that must print ❌] }  —  `find` must match EXACTLY once.
const MUTANTS = [
  // ── item 1: the held-refusal words (js/app.js submitPicks) ──
  { id: 'K1-a', item: 1, what: 'the toast promises a save on this device and a wait for a reopen again', file: 'js/app.js',
    find: "showToast('Your picks may not have been sent. Reopen the app, then make any missing picks again.', 'warning');",
    replace: "showToast('Picks saved on this device. An earlier change could not be saved, so they may not reach the league until you reopen the app.', 'warning');",
    suite: 'lockclienttest.mjs', red: ['[2t-2] ...and the toast', '[2t-6] ...and the toast the member saw'] },
  { id: 'K1-b', item: 1, what: 'the toast says flatly the picks were NOT sent ([2u]: they often are)', file: 'js/app.js',
    find: "showToast('Your picks may not have been sent. Reopen the app, then make any missing picks again.', 'warning');",
    replace: "showToast('Your picks were not sent. Reopen the app, then make any missing picks again.', 'warning');",
    suite: 'lockclienttest.mjs', red: ['[2t-2] ...and the toast', '[2u insert+patch] ...so the SAME words', '[2u patch+insert] ...so the SAME words', '[2u patch+patch] ...so the SAME words'] },
  { id: 'K1-c', item: 1, what: 'the success haptic fires under the warning again', file: 'js/app.js',
    find: '  if (!refusedHeld) nativeHapticImpact(\'LIGHT\');', replace: '  nativeHapticImpact(\'LIGHT\');',
    suite: 'lockclienttest.mjs', red: ['[2t-2c]'] },
  { id: 'K1-d', item: 1, what: 'the confirm promises a save on this device again', file: 'js/app.js',
    find: "'To be sure they count, reopen the app, then make these picks again.\\n\\n' +", replace: "'New picks are saved on THIS device but may not reach the league until you reopen the app.\\n\\n' +",
    suite: 'lockclienttest.mjs', red: ['[2t-2] Submit ASKS'] },
  // ── item 4: the lock-flip timer is armed by real paints (P-2) ──
  { id: 'K4-a', item: 4, what: 'the Comm paint no longer arms the timer', file: 'js/app.js',
    find: '  armLockFlipForPage();\n  const session=getSession();\n  if(!session.isAdmin){', replace: '  const session=getSession();\n  if(!session.isAdmin){',
    suite: 'sportsurfacetest.mjs', red: ['[H-o2]', '[H-o4]'] },
  { id: 'K4-b', item: 4, what: 'the timer watches the default sport\'s week whatever the page shows', file: 'js/app.js',
    find: '    if (isMultiSport()) { const hw = headerWeekFor(); return hw.all ? getContextWeek() : hw.week; }', replace: '',
    suite: 'sportsurfacetest.mjs', red: ['[H-m] a real Picks paint', '[H-n]'] },
  // ── item 3: DI-534 REV 5 - the lens, the caption, the navigator ──
  { id: 'K3-a', item: 3, what: 'the caption shows in the ordinary state too', file: 'js/app.js',
    find: "const noteText = lensIsSeparate() ? commLensNoteFor(here) : '';", replace: 'const noteText = commLensNoteFor(here);',
    suite: 'sportsurfacetest.mjs', red: ['[L-a1]', '[L-a3]'] },
  { id: 'K3-a2', item: 3, what: 'the caption shows in the ordinary state too (the Comm suite)', file: 'js/app.js',
    find: "const noteText = lensIsSeparate() ? commLensNoteFor(here) : '';", replace: 'const noteText = commLensNoteFor(here);',
    suite: 'commsporttest.mjs', red: ['[13c]'] },
  { id: 'K3-b', item: 3, what: 'the in-page navigator prints the header\'s compact form again', file: 'js/app.js',
    find: "navCode ? navCode + ' · ' + wl.name : wl.name", replace: "navCode ? navCode + ' ' + wl.name : wl.name",
    suite: 'sportsurfacetest.mjs', red: ['[S-b1] in a several-sport league', '[S-b2]'] },
  { id: 'K3-c', item: 3, what: 'the separate lens outlives the commissioner joining the sport', file: 'js/sport-seam.js',
    find: '    else if (pointerCanHold(_localLens)) {', replace: '    else if (false) {',
    suite: 'sportsurfacetest.mjs', red: ['[L-c1]', '[L-c2]'] },
  { id: 'K3-f', item: 3, what: 'the separate lens ends on "he plays it" without the pointer really holding the sport (Comm drops onto the other sport)', file: 'js/sport-seam.js',
    find: '      if (moved) _localLens = null;\n      else return _localLens;', replace: '      _localLens = null;',
    suite: 'sportsurfacetest.mjs', red: ['[L-c3]'] },
  { id: 'K3-f2', item: 3, what: 'the same, seen by the Finalize wizard on the NFL lens', file: 'js/sport-seam.js',
    find: '      if (moved) _localLens = null;\n      else return _localLens;', replace: '      _localLens = null;',
    suite: 'wizardfinalizetest.mjs', red: ['1-20'] },
  { id: 'K3-d', item: 3, what: 'a non-commissioner gets a separate lens', file: 'js/sport-seam.js',
    find: "  if (!viewerIsCommissioner()) { _localLens = null; return false; }\n  _localLens = dbCode;", replace: '  _localLens = dbCode;',
    suite: 'sportsurfacetest.mjs', red: ['[L-d]'] },
  { id: 'K3-e', item: 3, what: 'the separate lens survives the role being lost', file: 'js/sport-seam.js',
    find: '    if (!valid(_localLens) || !viewerIsCommissioner()) _localLens = null;', replace: '    if (!valid(_localLens)) _localLens = null;',
    suite: 'sportsurfacetest.mjs', red: ['[L-e1]'] },
  // ── item 5: one abbreviation lookup, NFL first ──
  { id: 'K5-a', item: 5, what: 'the college table is read before the NFL one', file: 'js/data-model.js',
    find: "  if (Object.prototype.hasOwnProperty.call(NFL_TEAM_ABBR, n)) return NFL_TEAM_ABBR[n];        // D1 (DI-536): an NFL team reads its ESPN abbreviation\n  if (Object.prototype.hasOwnProperty.call(TEAM_ABBR, n) && TEAM_ABBR[n]) return TEAM_ABBR[n];",
    replace: "  if (Object.prototype.hasOwnProperty.call(TEAM_ABBR, n) && TEAM_ABBR[n]) return TEAM_ABBR[n];\n  if (Object.prototype.hasOwnProperty.call(NFL_TEAM_ABBR, n)) return NFL_TEAM_ABBR[n];",
    suite: 'profiletest.mjs', red: ['[ab-4]'] },
  { id: 'K5-b', item: 5, what: 'teamAbbr reads the college table only again', file: 'js/data-model.js',
    find: 'export function teamAbbr(name) {\n  return singleTeamAbbr(name);\n}',
    replace: "export function teamAbbr(name) {\n  if (!name) return '';\n  if (TEAM_ABBR[name]) return TEAM_ABBR[name];\n  const words = String(name).split(/\\s+/).filter(Boolean);\n  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();\n  const initials = words.map(w => w.replace(/[^A-Za-z&]/g, '').charAt(0)).join('').toUpperCase().slice(0, 5);\n  return initials || words[0].slice(0, 4).toUpperCase();\n}",
    suite: 'profiletest.mjs', red: ['[ab-1]', '[ab-3]'] },
  // ── item 2: the defects the browser suite found, put back (the browser suite runs against the COPY it lives in) ──
  { id: 'K2-a', item: 2, what: 'the overview\'s close button is dead again (the delegated close removed)', file: 'js/app.js',
    find: "  if (!t && e.target?.closest?.('#league-overview-close')) { closeLeagueOverview(); return; }\n", replace: '',
    suite: 'sportgeometrytest.mjs', red: ['[8-7]'] },
  { id: 'K2-b', item: 2, what: 'the pill\'s tap target back to its drawn 28 pt', file: 'css/styles.css',
    find: 'border:0;padding:13px;margin-top:-8px;margin-bottom:-8px;background:none;', replace: 'border:0;padding:5px 13px;background:none;',
    suite: 'sportgeometrytest.mjs', red: ['[3-7]'] },
  { id: 'K2-c', item: 2, what: 'the Add a sport close back to 40 pt', file: 'css/styles.css',
    find: '#add-sport-sheet .as-close{width:44px;height:44px;', replace: '#add-sport-sheet .as-close{width:40px;height:40px;',
    suite: 'sportgeometrytest.mjs', red: ['[6-2]'] },
  { id: 'K2-d', item: 2, what: 'a literal border colour on .badge-open again', file: 'css/styles.css',
    find: '.badge-open{background:var(--win-bg);color:var(--win);border:1px solid rgba(26,122,63,.3);border-color:color-mix(in srgb,var(--win) 30%,transparent)}',
    replace: '.badge-open{background:var(--win-bg);color:var(--win);border:1px solid rgba(26,122,63,.3)}',
    suite: 'sportgeometrytest.mjs', red: ['[7-overview]', '[7-commAll]'] },
];

const only = new Set(process.argv.slice(2));
const run = MUTANTS.filter((m) => !only.size || only.has(m.id));
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-d1kit-'));
const COPY = join(tmp, 'cfb-pickems');
console.log(`\nd1-sports-third-pass kit — ${run.length} mutant(s); copying ${CFB} -> ${COPY} (node_modules and dot-directories left out)\n`);
cpSync(CFB, COPY, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });

let caught = 0, survived = 0, broken = 0;
for (const m of run) {
  const real = join(CFB, m.file), copy = join(COPY, m.file);
  const original = readFileSync(real, 'utf8');
  const n = original.split(m.find).length - 1;
  if (n !== 1) { broken++; console.log(`  ⚠️  ${m.id} (item ${m.item}) ANCHOR matches ${n} times in ${m.file} — the kit is stale for this mutant`); continue; }
  writeFileSync(copy, original.split(m.find).join(m.replace));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [m.suite], { cwd: COPY, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  writeFileSync(copy, original);                                                   // the COPY's file goes back to the checkout's text
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const redLines = out.split('\n').filter((l) => l.includes('❌'));
  const missing = m.red.filter((label) => !redLines.some((l) => l.includes(label)));
  const ok = r.status !== 0 && missing.length === 0;
  if (ok) caught++; else survived++;
  console.log(`  ${ok ? '✅ CAUGHT  ' : '❌ SURVIVED'} ${m.id} (item ${m.item}, ${m.suite}, ${Math.round((Date.now() - t0) / 1000)}s) — ${m.what}`);
  console.log(`        RED on: ${m.red.filter((l) => !missing.includes(l)).join(' | ') || '(none)'}${missing.length ? `   NOT red: ${missing.join(' | ')}` : ''}   [exit ${r.status}, ${redLines.length} ❌ line(s)]`);
}
try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
console.log(`\n${survived === 0 && broken === 0 ? '✅ ALL CAUGHT' : '❌ NOT ALL CAUGHT'} — ${caught} caught, ${survived} survived, ${broken} stale anchor(s)`);
process.exit(survived === 0 && broken === 0 ? 0 : 1);
