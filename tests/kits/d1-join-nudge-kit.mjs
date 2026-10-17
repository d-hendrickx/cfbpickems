/**
 * CFB Pickems — tests/kits/d1-join-nudge-kit.mjs (D1 / v0.30.0, DESIGN_D1_E: the join nudge + W-85; the S-3 mutation kit, feature-builder, 2026-10-15)
 * =====================================================================================================================================================
 * THE ITEM'S KIT (S-3, D-69): the mutants that prove the nudge's tests are not vacuous, encoded so the reviewer re-runs them and adds only gap mutants. Each mutant is applied to a COPY of this cfb-pickems
 * tree (never the checkout: no git restore, no stash, no in-place edit), the named suite is run IN THE COPY (the Chromium suite serves the copy it lives in), and the mutant is CAUGHT only if every
 * named check prints ❌. The mutated file goes back to the checkout's own text before the next mutant.
 *
 * In-suite kits that run with their suites (no copy needed - `node <suite>.mjs` runs them):
 *   joinnudgetest.mjs         [9] K1..K19: 19 in-memory mutants of js/home-sports.js, js/home.js and js/gameday.js (one nudge per card, signed-out gate gone, Variant B with a button, Make picks kept,
 *                             first-person lines kept, joinable ignored, the nudge counted as ordinary, the nudge replacing the tease, the offers not cleaned, an unescaped code, a cold ad, open-done drawn
 *                             as "You're in", the entered flag ignored, the late joiner treated as in the week, the clause outside the folding span) - each RED on the named checks
 *   joinoffertest.mjs         [3] M1..M10: 10 in-memory mutants of js/app.js (an entrant offered the sport, signed out, withheld, joinable ignored, a LATE JOINER offered it, a one-sport league offered
 *                             something, no Home repaint after a Join, a repaint on a failed Join, a repaint on another tab, a cached answer)
 *   joinnudgebrowsertest.mjs  [7] 7-1..7-16: 16 override-sheet mutants on the real page (padding, target, 16 pt gap, 8 pt stack, off-centre, chip placement, gold card, gold button, literal colour,
 *                             low contrast, the press removed, overflow, the red card's budget / target / clip, the fold removed)
 *   gamedaybudgettest.mjs     [4j] without the fold the non-entrant's Open card reads 35.1%; [4k] an engine without container queries (iOS 15) folds at every size and stays inside the cap
 *   xsstest.mjs               [9c-1f-j1..j4] removing escHtml() from the nudge's chip / sentence / title / the shared button's action IS reported
 *
 * This file: the SOURCE-level mutants the in-suite kits cannot reach (they need the real app, the real stylesheet or a second suite to see them).
 *
 * Run:  node tests/kits/d1-join-nudge-kit.mjs                 every mutant (about 6 minutes: eight of them drive Chromium)
 *       node tests/kits/d1-join-nudge-kit.mjs KB1 KB4         just those
 * Exit 0 only when every mutant is CAUGHT.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const JOIN_LINE = "    return buildLeagueOverviewModel().other.map((c) => ({ dbCode: c.dbCode, code: c.code, joinable: c.view.joinEnabled === true }));";
// { id, what, file, find, replace, suite, red: [the check labels that must print ❌] }  —  `find` must match EXACTLY once.
const MUTANTS = [
  { id: 'KB1', what: 'a confirmed Join no longer repaints Home (the nudge and the red card\'s Join would wait for a reload)', file: 'js/app.js',
    find: "  try { if (state.currentTab === 'home') { renderHomePage(); } } catch (e) { console.warn('[sport] Home could not refresh', e); }", replace: '',
    suite: 'joinnudgebrowsertest.mjs', red: ['[5-7]', '[6-9]'] },
  { id: 'KB2', what: 'the FIRST tap joins (the nudge\'s route writes the membership before the sheet opens)', file: 'js/app.js',
    find: "    openLeagueOverview({ focusSport: code });   // the Join lives here and nowhere else\n    return false;", replace: "    runJoinTap(code);\n    openLeagueOverview({ focusSport: code });   // the Join lives here and nowhere else\n    return false;",
    suite: 'joinnudgebrowsertest.mjs', red: ['[5-2]', '[6-8]'] },
  { id: 'KB3', what: 'the nudge is offered for the sports the member PLAYS (the played cards are read, not the other)', file: 'js/app.js',
    find: JOIN_LINE, replace: "    return buildLeagueOverviewModel().played.map((c) => ({ dbCode: c.dbCode, code: c.sportName === 'College Football' ? 'CFB' : c.dbCode.toUpperCase(), joinable: true }));",
    suite: 'joinnudgebrowsertest.mjs', red: ['[1-1]'] },
  { id: 'KB4', what: 'the 16 pt between the text group and the button is gone (the .feed-join modifier removed)', file: 'css/styles.css',
    find: '.feed-join{gap:16px}\n', replace: '',
    suite: 'joinnudgebrowsertest.mjs', red: ['[1-5]'] },
  { id: 'KB5', what: 'the sport chip trails the card like every other card\'s (the leading override removed)', file: 'css/styles.css',
    find: '.feed-join .sport-chip{margin-left:0}\n', replace: '',
    suite: 'joinnudgebrowsertest.mjs', red: ['[1-7]'] },
  { id: 'KB6', what: 'the nudge is the commissioner nudge\'s gold', file: 'css/styles.css',
    find: '.feed-join{gap:16px}\n', replace: '.feed-join{gap:16px;background:var(--gold-pale);border-color:var(--gold)}\n',
    suite: 'joinnudgebrowsertest.mjs', red: ['[3-1]'] },
  { id: 'KB7a', what: 'the fold rule is removed from the stylesheet (the clause never folds)', file: 'css/styles.css',
    find: '@container (max-width:12.5em){.gd-next{display:none}}', replace: '',
    suite: 'gamedaybudgettest.mjs', red: ['[1m-1]', '[1l]'] },
  { id: 'KB7b', what: 'the fold rule is removed from the stylesheet (the clause never folds) - the real app', file: 'css/styles.css',
    find: '@container (max-width:12.5em){.gd-next{display:none}}', replace: '',
    suite: 'joinnudgebrowsertest.mjs', red: ['[6-4]', '[6-4b]'] },
  { id: 'KB8', what: 'the red card asks a non-entrant to "Make picks" again', file: 'js/gameday.js',
    find: "body.action = !viewerId || asPlayer ? { label: 'Make picks', tab: 'picks', tone: 'solid' }", replace: "body.action = true ? { label: 'Make picks', tab: 'picks', tone: 'solid' }",
    suite: 'joinnudgebrowsertest.mjs', red: ['[6-3]'] },
  { id: 'KB9', what: 'the dispatcher keeps a FORGED data-sport (the "known sport" check removed)', file: 'js/home.js',
    find: '          if (known) params.sport = sport;', replace: '          params.sport = sport;',
    suite: 'joinnudgetest.mjs', red: ['[3c'] },
  { id: 'KB10', what: 'the sport code is written raw into the nudge\'s chip (and the xss sweep sees it)', file: 'js/home.js',
    find: '<span class="sport-chip">${escHtml(o.code)}</span>', replace: '<span class="sport-chip">${o.code}</span>',
    suite: 'xsstest.mjs', red: ['[9c-1f] js/home.js sweeps clean at ZERO'] },
  { id: 'KB11', what: 'the nudge is placed on the page BEFORE the dividers and windowing (counted as an ordinary entry)', file: 'js/home.js',
    find: '    const placed = placeJoinNudges(shown, snapshot.joinOffers);', replace: '    const placed = shown;',
    suite: 'joinnudgetest.mjs', red: ['[2a', '[8b]'] },
  { id: 'KB12', what: 'sport-status.js\'s closed caption drifts from the nudge\'s (two strings again)', file: 'js/sport-status.js',
    find: "  return `You can join when the next ${String(code || 'this sport')} week opens.`;", replace: "  return `You can join when the next ${String(code || 'this sport')} week begins.`;",
    suite: 'joinnudgetest.mjs', red: ['[2h'] },
];

const only = new Set(process.argv.slice(2));
const run = MUTANTS.filter((m) => !only.size || only.has(m.id));
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-joinkit-'));
const COPY = join(tmp, 'cfb-pickems');
console.log(`\nd1-join-nudge kit — ${run.length} mutant(s); copying ${CFB} -> ${COPY} (node_modules and .git left out)\n`);
cpSync(CFB, COPY, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });

let caught = 0, survived = 0, broken = 0;
for (const m of run) {
  const real = join(CFB, m.file), copy = join(COPY, m.file);
  const original = readFileSync(real, 'utf8');
  const n = original.split(m.find).length - 1;
  if (n !== 1) { broken++; console.log(`  ⚠️  ${m.id} ANCHOR matches ${n} times in ${m.file} — the kit is stale for this mutant`); continue; }
  writeFileSync(copy, original.split(m.find).join(m.replace));
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [m.suite], { cwd: COPY, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  writeFileSync(copy, original);                                                   // the COPY's file goes back to the checkout's text
  const out = `${r.stdout || ''}\n${r.stderr || ''}`;
  const redLines = out.split('\n').filter((l) => l.includes('❌'));
  const missing = m.red.filter((label) => !redLines.some((l) => l.includes(label)));
  const ok = r.status !== 0 && missing.length === 0;
  if (ok) caught++; else survived++;
  console.log(`  ${ok ? '✅ CAUGHT  ' : '❌ SURVIVED'} ${m.id} (${m.suite}, ${Math.round((Date.now() - t0) / 1000)}s) — ${m.what}`);
  console.log(`        RED on: ${m.red.filter((l) => !missing.includes(l)).join(' | ') || '(none)'}${missing.length ? `   NOT red: ${missing.join(' | ')}` : ''}   [exit ${r.status}, ${redLines.length} ❌ line(s)]`);
}
try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
console.log(`\n${survived === 0 && broken === 0 ? '✅ ALL CAUGHT' : '❌ NOT ALL CAUGHT'} — ${caught} caught, ${survived} survived, ${broken} stale anchor(s)`);
process.exit(survived === 0 && broken === 0 ? 0 : 1);
