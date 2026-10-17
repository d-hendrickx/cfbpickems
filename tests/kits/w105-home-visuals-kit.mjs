/**
 * CFB Pickems — tests/kits/w105-home-visuals-kit.mjs (W-105, the Home visuals, release v0.30.2; the S-3 mutation kit, feature-builder, 2026-10-17)
 * ===================================================================================================================================================
 * THE ITEM'S KIT (S-3, D-69): the mutants that prove W-105's tests are not vacuous, encoded so the reviewer re-runs them and adds only gap mutants. Each mutant is applied
 * to a COPY of this cfb-pickems tree (never the checkout: no git restore, no stash, no in-place edit), the named suite is run IN THE COPY (the Chromium suites serve the
 * copy they live in), and the mutant is CAUGHT only if the suite exits non-zero AND every named check prints ❌. The mutated file goes back to the checkout's own text
 * before the next mutant.
 *
 * The design inputs' list (DI-W105 "Mutation proofs"), each mapped: density 4 instead of 3 (K1); cap 8 instead of 10 (K2); selection ignores pictures (K3); publisher guard
 * removed (K4); anchors dropped (K5); clamp re-added (K6, K6b in Chromium); marks drawn with the setting off (K7); unescaped team name in the marks (K8); failed picture
 * left in place (K9); no scroll hold above the viewport (K10 binder, K10b app); the .news-images-bound guard removed (K11, Chromium). Plus the builder's gap mutants:
 * a clock read in selectNews (K12), a partly visible card treated as on screen (K13), the failed-picture memory ignored at render (K14), the Related list given marks
 * (K15), the skeleton back to 96 pt (K16, Chromium), a new picture host (K17), a second image-validator call site (K18), the cached-picture instant path removed (K19),
 * marks on a card that is not game.final (K20), the guard emptying slots (K21), the stale 48-hour window bypassed for pictures (K22).
 *
 * Run:  node tests/kits/w105-home-visuals-kit.mjs              every mutant (about 6 minutes: four drive Chromium)
 *       node tests/kits/w105-home-visuals-kit.mjs K1 K6b       just those
 * Exit 0 only when every mutant is CAUGHT.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// { id, what, file, find, replace, suite, red: [check labels that must print ❌] }  —  `find` must match EXACTLY once.
const MUTANTS = [
  { id: 'K1', what: 'news density is one per FOUR other cards again (DI-W105-1)', file: 'js/home.js',
    find: 'export const NEWS_PER_NON_NEWS = 3;', replace: 'export const NEWS_PER_NON_NEWS = 4;', suite: 'newspicturestest.mjs', red: ['1-1:', '1-2:'] },
  { id: 'K1b', what: 'the same, seen by hometest', file: 'js/home.js',
    find: 'export const NEWS_PER_NON_NEWS = 3;', replace: 'export const NEWS_PER_NON_NEWS = 4;', suite: 'hometest.mjs', red: ['M5 density', 'M12b'] },
  { id: 'K2', what: 'the cap is EIGHT again (DI-W105-1)', file: 'js/home.js',
    find: 'export const NEWS_MAX_CARDS = 10;', replace: 'export const NEWS_MAX_CARDS = 8;', suite: 'newspicturestest.mjs', red: ['1-1:', '1-3:'] },
  { id: 'K3', what: 'the selection ignores pictures (no story counts as pictured)', file: 'js/home.js',
    find: '  const pictured = pool.filter(hasPicture);', replace: '  const pictured = [];', suite: 'newspicturestest.mjs', red: ['2-1 (a)', '2-8 (c/e)', '2-10 (e)'] },
  { id: 'K4', what: 'the publisher guard removed', file: 'js/home.js',
    find: '  const fits = (it) => (perPublisher.get(publisherOf(it)) || 0) < cap;', replace: '  const fits = (it) => true;', suite: 'newspicturestest.mjs', red: ['2-7 (c)', '2-11c'] },
  { id: 'K5', what: 'the anchors dropped: the first N pictured stories by relevance are taken, wherever they sit in time', file: 'js/home.js',
    find: '  if (m > 0) {\n', replace: '  if (false) {\n', suite: 'newspicturestest.mjs', red: ['2-1b (a)'] },
  { id: 'K6', what: 'the two-line clamp re-added to the news headline', file: 'css/styles.css',
    find: '.news-card__headline{margin:0;font-size:1rem;font-weight:600;line-height:1.35;color:var(--text-primary);overflow-wrap:anywhere;min-width:0}',
    replace: '.news-card__headline{margin:0;font-size:1rem;font-weight:600;line-height:1.35;color:var(--text-primary);overflow-wrap:anywhere;min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    suite: 'newstest.mjs', red: ['9b-8:', '9b-8b'] },
  { id: 'K6b', what: 'the clamp re-added in ANOTHER rule (the allow-list catches it; Chromium measures the cut)', file: 'css/styles.css',
    find: '.news-card__pub{font-weight:600}', replace: '.news-card__pub{font-weight:600}\n.news-card__body .news-card__headline{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    suite: 'newsrendertest.mjs', red: ['W1 375 pt, 1x text', 'W1 320 pt, 2x text', 'W1c'] },
  { id: 'K7', what: 'the marks row drawn when NO side has a usable logo (Team logos off)', file: 'js/home.js',
    find: "  if (!vetted(away.logoUrl) && !vetted(home.logoUrl)) return '';", replace: '', suite: 'hometest.mjs', red: ['7-20:', '7-23:', '7-31:'] },
  { id: 'K8', what: 'a team name reaches the marks row unescaped (the lockup handed an identity escaper)', file: 'js/home.js',
    find: "rank: null, logoUrl: vetted(t.logoUrl), escHtml, size: 'md' });", replace: "rank: null, logoUrl: vetted(t.logoUrl), escHtml: (v) => String(v), size: 'md' });", suite: 'hometest.mjs', red: ['7-28:'] },
  { id: 'K9', what: 'a failed picture is left in place (the error arm does nothing)', file: 'js/newsCard.js',
    find: '    if (!isPicture(img) || hasClass(img, PICTURE_FAILED) || hasClass(img, PICTURE_COLLAPSING)) return;', replace: '    return;', suite: 'newspicturestest.mjs', red: ['4-4:', '4-5:', '4-7:', '4-13:'] },
  { id: 'K10', what: 'the binder never reports a picture as ABOVE the viewport (no scroll hold)', file: 'js/newsCard.js',
    find: '      pictureRemoved(height, above);', replace: '      pictureRemoved(height, false);', suite: 'newspicturestest.mjs', red: ['4-7:', '4-8:', '5-1:'] },
  { id: 'K10b', what: 'the app\'s hook stops scrolling (it holds nothing)', file: 'js/app.js',
    find: "  return scrollPageBy(-removedPx, 'instant');\n}", replace: '  return false;\n}', suite: 'newspicturestest.mjs', red: ['5-2:'] },
  { id: 'K11', what: 'the .news-images-bound guard removed: pictures hidden in EVERY root (one without the binder never shows them)', file: 'css/styles.css',
    find: '.news-images-bound .news-card__image{opacity:0;', replace: '.news-card__image{opacity:0;', suite: 'newsrendertest.mjs', red: ['W2a'] },
  { id: 'K12', what: 'selectNews reads the clock', file: 'js/home.js',
    find: '  const pictured = pool.filter(hasPicture);', replace: '  const pictured = pool.filter(hasPicture).filter(() => Date.now() > 0);', suite: 'hometest.mjs', red: ['1-8b'] },
  { id: 'K12b', what: 'the same clock read, seen at run time (Date.now made to throw)', file: 'js/home.js',
    find: '  const pictured = pool.filter(hasPicture);', replace: '  const pictured = pool.filter(hasPicture).filter(() => Date.now() > 0);', suite: 'newspicturestest.mjs', red: ['2-6 (b)'] },
  { id: 'K13', what: 'a partly visible card whose picture is above the top is treated as on screen (it would collapse under the reader)', file: 'js/newsCard.js',
    find: '  const above = !!r && height > 0 && r.bottom <= 0;', replace: '  const above = !!r && height > 0 && r.bottom <= -height;', suite: 'newspicturestest.mjs', red: ['4-8:'] },
  { id: 'K14', what: 'the failed-picture memory ignored at render (Home\'s next repaint redraws the empty box)', file: 'js/newsCard.js',
    find: '  const imageSrc = allowedSrc && !failedPictures.has(allowedSrc) ? allowedSrc : null;', replace: '  const imageSrc = allowedSrc;', suite: 'newspicturestest.mjs', red: ['4-13:'] },
  { id: 'K15', what: 'the Game view\'s Related list given the marks too', file: 'js/home.js',
    find: 'now, formatDate: dateFormatterFor(snapshot.timezone) })}</div>`).join(\'\');', replace: 'now, formatDate: dateFormatterFor(snapshot.timezone), marksFor: () => null })}</div>`).join(\'\');', suite: 'hometest.mjs', red: ['7-30:'] },
  { id: 'K16', what: 'the skeleton picture back to a fixed 96 pt', file: 'css/styles.css',
    find: '.feed-skel-image{height:auto;aspect-ratio:16/9;', replace: '.feed-skel-image{height:96px;', suite: 'newsrendertest.mjs', red: ['W4 375 pt', 'W4 320 pt'] },
  { id: 'K17', what: 'a new picture host accepted in code (the ESPN contingency list widened)', file: 'js/newsCard.js',
    find: "  exact: Object.freeze(['espncdn.com', 'espn.com', 'espnmedia-cdn.akamaized.net']),", replace: "  exact: Object.freeze(['espncdn.com', 'espn.com', 'espnmedia-cdn.akamaized.net', 'images.example']),", suite: 'newspicturestest.mjs', red: ['6-4:'] },
  { id: 'K18', what: 'a second picture-validator call site with a hand-made host list', file: 'js/home.js',
    find: 'export function hasPicture(item) {', replace: "export const _w105Planted = (u) => isAllowedImageUrl(u, ['cdn.example']);\nexport function hasPicture(item) {", suite: 'newspicturestest.mjs', red: ['6-2:'] },
  { id: 'K19', what: 'the instant path for an already-loaded picture removed (a repaint would re-fade it)', file: 'js/newsCard.js',
    find: '    if (img.complete === true && Number(img.naturalWidth) > 0) addClass(img, PICTURE_INSTANT, PICTURE_LOADED);', replace: '', suite: 'newspicturestest.mjs', red: ['4-2:'] },
  { id: 'K19b', what: 'the same, in Chromium (a real Home repaint)', file: 'js/newsCard.js',
    find: '    if (img.complete === true && Number(img.naturalWidth) > 0) addClass(img, PICTURE_INSTANT, PICTURE_LOADED);', replace: '', suite: 'newsrendertest.mjs', red: ['W2c'] },
  { id: 'K20', what: 'marks drawn on a card that is not a game result', file: 'js/home.js',
    find: "  const marks = card.type === 'game.final' && typeof marksFor === 'function'", replace: "  const marks = typeof marksFor === 'function'", suite: 'hometest.mjs', red: ['7-29:'] },
  { id: 'K21', what: 'the guard EMPTIES slots (the overflow fill removed: one pinned picture would shrink the news count)', file: 'js/home.js',
    find: '  for (const it of pool) { if (used.size >= slots) break; if (!used.has(it)) take(it); }   // the guard never empties a slot a story could fill\n', replace: '', suite: 'newspicturestest.mjs', red: ['2-11 (edge)', '2-11b'] },
  { id: 'K22', what: 'a story offered twice is chosen twice (the pool is not de-duplicated)', file: 'js/home.js',
    find: "if (seenIds.has(id)) return false; seenIds.add(id); return true; });", replace: 'return true; });', suite: 'newspicturestest.mjs', red: ['2-13 (f)'] },
];

const only = new Set(process.argv.slice(2));
const run = MUTANTS.filter((m) => !only.size || only.has(m.id));
const tmp = mkdtempSync(join(tmpdir(), 'cfbp-w105kit-'));
const COPY = join(tmp, 'cfb-pickems');
console.log(`\nw105-home-visuals kit — ${run.length} mutant(s); copying ${CFB} -> ${COPY} (node_modules and .git left out)\n`);
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
