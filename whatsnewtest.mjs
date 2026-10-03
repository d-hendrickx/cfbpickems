#!/usr/bin/env node
/**
 * CFB Pickems — whatsnewtest.mjs (v0.29.0 release cut, 2026-10-02)
 * ================================================================
 * The in-app release notes for v0.29.0, pinned against the REAL constant (js/app.js `_whatsNewForTest()`), the REAL renderers
 * and the REAL Rules copy it points at — not against a fixture. Until this file, nothing asserted what a shipped entry SAYS: loadtest [82]
 * only proves that no entry carries a placeholder and that the newest entry's version/date match APP_VERSION.
 *
 * WHAT IS PINNED
 *   [1] The four version strings agree (APP_VERSION, index.html's three ?v=, service-worker CACHE_NAME) and the entry is the newest one.
 *   [2] The entry says what shipped, in plain words: Home, News settings in the menu, Settings and Comm in the menu, "hold a section's title ...
 *       replaces Edit layout", Move up / Move down, League Settings, the tie steps (coupled to the REAL Weekly Ties Rules copy), Standings on one
 *       screen, and every fixed line the cut brief named.
 *   [3] The privacy line (regulatory condition R-C14, RD-01 v3.0.0) is present EXACTLY, once, and is NOT the first `added` item (the first item is
 *       SCRIBE's chat-post headline and is cut at 90 characters; the line is longer than that).
 *   [4] What did NOT ship is not announced (server-side pick lock, "who has picked", league creation, multi-sport) and no internal ID leaks.
 *   [5] v0.28.0's two web-overpromising lines now read as iPhone-app items.
 *   [6] Both renderers show the entry (the Picks card is closed; the Rules history opens it) and escape it.
 *   [7] TEETH: the same checks run in memory against mutants (privacy line dropped, moved first, reworded; an unshipped feature announced; an
 *       internal ID; a stale date) and each must FAIL.
 *
 * Run:  node whatsnewtest.mjs   (and under TZ=UTC / TZ=America/Los_Angeles; spawned by loadtest.mjs [139])
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── DOM / localStorage stubs — requesttest.mjs's shape, trimmed to what importing app.js and the two pure renderers touch. ────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const els = new Map();
function mkEl(id) {
  const e = {
    id, _html: '', dataset: {}, style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html; },
    set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML(pos, h) { this._html = pos === 'afterbegin' ? h + this._html : this._html + h; },
    appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    scrollTo() {}, focus() {},
  };
  els.set(id, e);
  return e;
}
['page-rules', 'page-commissioner', 'page-picks'].forEach(mkEl);
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => els.get(id) || null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => mkEl('tmp'),
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in whatsnewtest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass += 1; console.log('  ✅', label); }
  else { fail += 1; console.log('  ❌', label); }
}

console.log(`\n[TZ=${process.env.TZ || '(system default)'}] whatsnewtest.mjs — the v0.29.0 release notes\n`);

const app = await import('./js/app.js');
const live = app._whatsNewForTest();
const R = live.releases;
const NOW = R[0];
const PREV = R[1];

// The privacy line, exactly as the cut brief and the publish spec (PUBLISH_SPEC_RD-01_v3.0.0 §5, R-C14) give it.
const PRIVACY_LINE = "The privacy policy has been updated to cover News, which loads headlines straight from ESPN. You'll find it at the bottom of the menu.";

/** Every property this suite pins about a release object, as named failures. [] means the entry is as shipped. */
function problems(rel) {
  const out = [];
  const added = Array.isArray(rel?.added) ? rel.added : [];
  const fixed = Array.isArray(rel?.fixed) ? rel.fixed : [];
  const all = [...added, ...fixed];
  const hasAdded = re => added.some(b => re.test(b));
  const hasFixed = re => fixed.some(b => re.test(b));
  if (rel?.version !== app.APP_VERSION) out.push('version');
  if (rel?.date !== app.APP_VERSION_DATE) out.push('date');
  if (added.filter(b => b === PRIVACY_LINE).length !== 1) out.push('privacy-line-exactly-once');
  if (added[0] === PRIVACY_LINE) out.push('privacy-line-not-first');
  if (!(added[0] && added[0].length <= 90 && /^Meet Home/.test(added[0]))) out.push('headline-is-home-and-uncut');
  if (!hasAdded(/ESPN headlines for the sports and teams you follow/)) out.push('news-line');
  if (!hasAdded(/News in the menu \(≡\)/)) out.push('news-settings-in-menu');
  if (!hasAdded(/Settings and the Commissioner panel now live in the menu \(≡\)/)) out.push('settings-comm-in-menu');
  if (!hasAdded(/The bottom bar is Picks, Dashboard, Home, Chat and Standings\./)) out.push('five-tab-bar');
  if (!hasAdded(/Rearrange Dashboard and Standings by holding a section's title\. It replaces Edit layout\./)) out.push('hold-to-rearrange');
  if (!hasAdded(/^VoiceOver and keyboard: every section has Move up and Move down buttons\.$/)) out.push('move-up-down');
  if (!hasAdded(/League Settings, in the menu: commissioners can rename the league and close it to new members, and any member can leave\./)) out.push('league-settings');
  if (!hasAdded(/correct picks, tiebreaker, your alma mater against the spread, the Extra Point, then a fixed draw\. See Weekly Ties in Rules\./)) out.push('tie-steps');
  if (!hasAdded(/^Standings now fit on one screen\.$/)) out.push('standings-one-screen');
  if (!hasFixed(/Swiping between weeks locks vertical scrolling while you drag, and the next week slides in/)) out.push('week-swipe');
  if (!hasFixed(/^FINAL game cards no longer pulse\.$/)) out.push('final-no-pulse');
  if (!hasFixed(/^Dark themes are easier to read/)) out.push('dark-readability');
  if (!hasFixed(/^The weekly email's winner and loser now match Weekly History\.$/)) out.push('weekly-email');
  if (!hasFixed(/^Commissioners: Undo on a paid week is now in Comm → Players → Obligations only\.$/)) out.push('undo-location');
  if (all.some(b => /server-side|who (has|have) picked|create a league|league creation|multi-sport|multisport/i.test(b))) out.push('announces-unshipped');
  if (all.some(b => /\b(UN|DI|SB|SP|RG|AD|DO|VT)-\d+\b/.test(b))) out.push('internal-id');
  if (all.some(b => /RELEASE-EDIT/.test(b))) out.push('placeholder');
  return out;
}

console.log('[1] Stamps — one release, one version, one date, newest first…');
{
  const html = readFileSync(join(HERE, 'index.html'), 'utf8');
  const sw = readFileSync(join(HERE, 'service-worker.js'), 'utf8');
  assert(app.APP_VERSION === 'v0.29.0' && app.APP_VERSION_DATE === '2026-10-02', `[1a] APP_VERSION is v0.29.0 and APP_VERSION_DATE is 2026-10-02 (got ${app.APP_VERSION}, ${app.APP_VERSION_DATE})`);
  assert(NOW?.version === 'v0.29.0' && NOW?.date === '2026-10-02', `[1b] WHATS_NEW_RELEASES[0] is the v0.29.0 entry dated 2026-10-02 (got ${NOW?.version}, ${NOW?.date})`);
  assert(PREV?.version === 'v0.28.0', `[1c] the entry before it is v0.28.0 — newest first, nothing dropped (got ${PREV?.version})`);
  assert((html.match(/\?v=29-0['"]/g) || []).length === 3 && !/\?v=28-0/.test(html), '[1d] index.html carries ?v=29-0 in exactly three places (styles.css, app.js, service-worker registration) and no 28-0');
  assert(/const CACHE_NAME = 'cfb-pickems-v29-0';/.test(sw), '[1e] service-worker.js CACHE_NAME is cfb-pickems-v29-0');
  assert(live.shown.length >= 1 && live.shown[0] === NOW, '[1f] the Picks card shows v0.29.0 first (whatsNewDisplayList)');
}

console.log('\n[2] The entry as shipped passes every pinned property…');
{
  const p = problems(NOW);
  assert(p.length === 0, `[2a] problems(v0.29.0) is empty (got: ${p.join(', ') || 'none'})`);
  assert(NOW.added.length === 9 && NOW.fixed.length === 7, `[2b] nine added lines and seven fixed lines (got ${NOW.added.length} / ${NOW.fixed.length})`);
}

console.log('\n[3] The privacy line (R-C14) — exact, once, not the headline…');
{
  assert(NOW.added.filter(b => b === PRIVACY_LINE).length === 1, '[3a] the privacy line is in `added`, character for character, exactly once');
  assert(NOW.added[0] !== PRIVACY_LINE && PRIVACY_LINE.length > 90, `[3b] it is not the first item (the 90-character chat headline would cut it; it is ${PRIVACY_LINE.length} characters)`);
  assert(NOW.added[0].length <= 90, `[3c] the first item (SCRIBE's chat-post headline) is within the 90-character cut, so it posts uncut (${NOW.added[0].length} characters)`);
  assert(!NOW.fixed.includes(PRIVACY_LINE), '[3d] it is not duplicated under `fixed`');
  const src = readFileSync(join(HERE, 'js', 'app.js'), 'utf8');
  assert(src.includes("The privacy policy has been updated to cover News, which loads headlines straight from ESPN. You\\'ll find it at the bottom of the menu."), '[3e] the same text is in js/app.js source (what the served-file grep in the publish spec §6 finds)');
}

console.log('\n[4] Coupled to what the app really has — the tie steps and the privacy link…');
{
  const rules = app.renderWeeklyTiesRulesHTML();
  assert(/Weekly Ties/.test(rules), '[4a] the Rules page has the "Weekly Ties" section the release line points at');
  const order = ['Picks', 'Tiebreaker', 'alma mater', 'Extra Point', "The week&#39;s draw|The week's draw"]
    .map(t => rules.search(new RegExp(t)));
  assert(order.every(i => i >= 0) && order.every((v, i) => i === 0 || v > order[i - 1]), `[4b] Rules lists the same five steps in the same order the release line names them (positions ${order.join(', ')})`);
  const tieLine = NOW.added.find(b => /Weekly ties/.test(b)) || '';
  const idx = ['correct picks', 'tiebreaker', 'alma mater', 'Extra Point', 'draw'].map(t => tieLine.indexOf(t));
  assert(idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])), `[4c] the release line names the steps in the Rules order (positions ${idx.join(', ')})`);
  const nav = readFileSync(join(HERE, 'index.html'), 'utf8').match(/<button class="nav-item[^"]*" data-tab="([a-z]+)"/g).map(s => s.match(/data-tab="([a-z]+)"/)[1]);
  assert(nav.join(',') === 'picks,dashboard,home,chat,leaderboard', `[4d] the bottom bar the line describes is the real one: ${nav.join(', ')}`);
  const cc = readFileSync(join(HERE, 'js', 'control-center.js'), 'utf8');
  assert(/<a href="privacy\.html">Privacy Policy<\/a>/.test(cc), '[4e] the control center ends with the Privacy Policy link ("the bottom of the menu")');
}

console.log('\n[5] v0.28.0 — the sign-in line names no platform; the bounce line is an iPhone-app item…');
{
  const all28 = [...(PREV.added || []), ...(PREV.fixed || [])];
  // C1 (v0.29.0 release review, 2026-10-02): the Munera sign-in has been live on the WEB since v0.28.0 (gaterebrandtest [1a]/[1e], brand.js getGateWordmark()),
  // while the phone app (TestFlight build 3) still runs v0.27.2 — so "iPhone app:" was wrong the other way. The line now names no platform.
  assert(PREV.added[0] === 'A new Munera sign-in screen.', `[5a] v0.28.0's first "added" line reads exactly "A new Munera sign-in screen." (got ${JSON.stringify(PREV.added[0])})`);
  assert(!all28.some(b => /Munera sign-in/.test(b) && /iPhone|on the web and in the app/.test(b)) && all28.filter(b => /Munera sign-in/.test(b)).length === 1,
    '[5b] exactly one v0.28.0 line mentions the Munera sign-in, and it claims no platform (neither "iPhone app" nor "on the web and in the app")');
  assert(PREV.fixed.some(b => /^In the iPhone app, pages bounce at the top and bottom/.test(b)), '[5c] the bounce line is explicitly an iPhone-app item');
}

console.log('\n[6] Both renderers show the entry, escaped…');
{
  const card = app.renderWhatsNewCardHTML();
  const hist = app.renderReleaseNotesCardHTML();
  assert(/What's new in v0\.29\.0/.test(card) && /Move up and Move down buttons/.test(card), '[6a] the Picks card is titled "What\'s new in v0.29.0" and carries the bullets');
  assert(/data-release="v0\.29\.0"[^>]*\bopen\b/.test(hist), '[6b] the Rules → Release notes history opens v0.29.0 (newest) first');
  assert(/You'll find it at the bottom of the menu\./.test(card), '[6c] the privacy line renders in the Picks card as written');
  const hostile = app.renderWhatsNewCardHTML([{ version: 'v9.9.9', date: '2026-10-02', added: ['<img src=x onerror=alert(1)>'], fixed: ['<b>bold</b>'] }]);
  assert(!/<img src=x/.test(hostile) && /&lt;img src=x/.test(hostile) && !/<b>bold<\/b>/.test(hostile), '[6c2] every bullet goes through escHtml: markup in a bullet renders as text (CONVENTIONS #12)');
  assert(/Comm → Players → Obligations only\./.test(hist), '[6d] the history carries the commissioner Undo line');
}

console.log('\n[7] TEETH — the same checks FAIL on in-memory mutants…');
{
  const clone = () => ({ ...NOW, added: [...NOW.added], fixed: [...NOW.fixed] });
  const caught = (mutate, name) => { const r = clone(); mutate(r); return problems(r).includes(name); };
  assert(caught(r => { r.added = r.added.filter(b => b !== PRIVACY_LINE); }, 'privacy-line-exactly-once'), '[7a] privacy line dropped -> caught');
  assert(caught(r => { r.added = [...r.added, PRIVACY_LINE]; }, 'privacy-line-exactly-once'), '[7b] privacy line doubled -> caught');
  assert(caught(r => { r.added = r.added.map(b => (b === PRIVACY_LINE ? 'The privacy policy has been updated. You\'ll find it at the bottom of the menu.' : b)); }, 'privacy-line-exactly-once'), '[7c] privacy line reworded to the v0.28.0 wording -> caught');
  assert(caught(r => { r.added = [PRIVACY_LINE, ...r.added.filter(b => b !== PRIVACY_LINE)]; }, 'privacy-line-not-first'), '[7d] privacy line moved first -> caught');
  assert(caught(r => { r.added = [...r.added, 'Server-side pick lock: picks lock on our server at kickoff.']; }, 'announces-unshipped'), '[7e] an unshipped feature announced (server-side pick lock) -> caught');
  assert(caught(r => { r.added = [...r.added, 'See who has picked this week in Chat.']; }, 'announces-unshipped'), '[7f] an unshipped feature announced ("who has picked") -> caught');
  assert(caught(r => { r.fixed = [...r.fixed, 'Fixed SB-23 on the week swipe.']; }, 'internal-id'), '[7g] an internal ID in player copy -> caught');
  assert(caught(r => { r.date = '2026-10-01'; }, 'date'), '[7h] a date that disagrees with APP_VERSION_DATE -> caught');
  assert(caught(r => { r.added = r.added.filter(b => !/Edit layout/.test(b)); }, 'hold-to-rearrange'), '[7i] the Edit layout replacement line dropped -> caught');
  assert(caught(r => { r.fixed = r.fixed.map(b => b.replace('Comm → Players → Obligations only', 'the Standings tab')); }, 'undo-location'), '[7j] the Undo location changed -> caught');
  assert(caught(r => { r.added = r.added.map(b => (/^Meet Home/.test(b) ? b + ' And so much more, all of it new this week!' : b)); }, 'headline-is-home-and-uncut'), '[7k] a headline cut past 90 characters -> caught');
  assert(problems(NOW).length === 0, '[7l] and the real entry still passes after every mutation above (the mutants were clones, the real constant is untouched)');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
// Flush both streams before exiting (loadtest parses stdout + stderr from a pipe); the unref'd timer is the backstop if a callback never fires.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
