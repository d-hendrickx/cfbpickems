/**
 * CFB Pickems - rulespagetest.mjs
 * ===============================
 * D1 (v0.30.0, thread 100726-D1, Lane A): DI-536 "The Rules page: cards come from the league's sports" and the DI-512 multisport clause.
 *
 *   [1]  rulesSports - the truth table: no competitions, one sport, a league that archived its NFL, an unknown sport -> today's page; college + NFL -> both; NFL alone -> no college cards.
 *   [2]  The NFL card's words - DI-536's ten bullets, in order, with every number read from the profile / the league's settings (never typed twice); the NFL-only variant drops every college pointer.
 *   [3]  The page - a league with no NFL renders ONE page, byte for byte the same for no rows, one sport and an archived NFL; a two-sport league opens with the line and carries the NFL card once, after the
 *        college cards and before Debts & Bylaws; an NFL-only league has no college-football card, no alma-mater wording and no dangling pointer; the commissioner's own saved rules always render.
 *   [4]  Safety - the weekly prize line is escaped; no `${}` of league text reaches the markup unescaped; the profile - not the card - owns the slate size.
 *
 * Run: node rulespagetest.mjs
 */
import { readFile } from 'node:fs/promises';

const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear() };
const els = new Map();
function mkEl(id) {
  const e = { id, _html: '', dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
    get innerHTML() { return this._html; }, set innerHTML(v) { this._html = String(v); },
    insertAdjacentHTML() {}, appendChild() {}, remove() { els.delete(this.id); }, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null, scrollTo() {}, focus() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; } };
  els.set(id, e); return e;
}
['page-picks', 'games-list', 'page-dashboard', 'submitted-games', 'page-leaderboard', 'header-meta-week', 'page-home', 'page-rules'].forEach(mkEl);
const toasts = [];
const toastBox = mkEl('toast-container');
toastBox.appendChild = (t) => { toasts.push(String(t && t._html)); };
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: (id) => els.get(id) || null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => { const e = mkEl('tmp'); els.delete('tmp'); return e; },
  // A minimal DOM for the body-appended sheets: appending registers the element and one stub per id found in its markup (the sheet and its body), so getElementById finds them.
  body: { classList: { add() {}, remove() {}, toggle() {} }, dataset: {}, innerHTML: '',
    appendChild(el) { if (!el || !el.id) return; els.set(el.id, el); for (const m of String(el._html).matchAll(/ id="([^"]+)"/g)) if (!els.has(m[1])) mkEl(m[1]); } }, hidden: false };
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: {} }; } catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true; globalThis.prompt = () => null; globalThis.alert = () => {}; globalThis.scrollTo = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u_' + Math.random().toString(36).slice(2) };
globalThis.fetch = async () => { throw new Error('network disabled in rulespagetest'); };


let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  \u2705', label); } else { fail++; console.error('  \u274c', label); } }

const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const sr = await import('./js/sport-rules.js');
const { getProfile } = await import('./js/sports/index.js');
const { saveCompetition, setSession, addPlayer, getSettings, saveSettings } = storage;
const origWarn = console.warn; console.warn = () => {};
const origInfo = console.info; console.info = () => {};

const CFB_C = 'aaaaaaaa-0000-0000-0000-000000000001', NFL_C = 'bbbbbbbb-0000-0000-0000-000000000002';
function reset({ comps = [] } = {}) {
  store.clear();
  setSession('p1', true, true);
  addPlayer({ playerId: 'p1', displayName: 'Ann', active: true, almaMater: 'Texas A&M' });
  for (const c of comps) saveCompetition(c);
}
const CFB = { id: CFB_C, sport: 'cfb', isDefault: true, enrollment: 'all', kind: 'season' };
const NFL = { id: NFL_C, sport: 'nfl', isDefault: false, enrollment: 'opt_in', kind: 'season' };
const render = () => { els.get('page-rules')._html = ''; app.renderRulesPage(); return els.get('page-rules')._html; };

console.log('\n[1] rulesSports');
{
  const t = (comps) => JSON.stringify(sr.rulesSports(comps));
  assert(t([]) === '{"hasCfb":true,"hasNfl":false,"both":false}' && t(undefined) === t([]) && t(null) === t([]), '[1a] no competition rows (a local device, a pre-multisport league) -> today\'s page');
  assert(t([{ sport: 'cfb' }]) === t([]), '[1b] one college-football competition -> today\'s page');
  assert(t([{ sport: 'cfb' }, { sport: 'nfl' }]) === '{"hasCfb":true,"hasNfl":true,"both":true}', '[1c] college football and the NFL -> both');
  assert(t([{ sport: 'nfl' }]) === '{"hasCfb":false,"hasNfl":true,"both":false}', '[1d] the NFL alone -> no college cards');
  assert(t([{ sport: 'cfb' }, { sport: 'nfl', archivedAt: '2026-10-01T00:00:00Z' }]) === t([]), '[1e] an ARCHIVED NFL does not count: back to today\'s page');
  assert(t([{ sport: 'cfb', archivedAt: 'x' }, { sport: 'nfl' }]) === '{"hasCfb":false,"hasNfl":true,"both":false}', '[1f] an archived college-football competition does not count either');
  assert(t([{ sport: 'nba' }]) === t([]) && t([null, 7, {}, { sport: 5 }]) === t([]), '[1g] a sport with no rules card here, and junk rows, leave today\'s page alone');
}

console.log('\n[2] The NFL card\'s words');
{
  const prize = 'Loser buys winner a consolation prize';
  const withCollege = sr.nflRulesItems({ weeklyPrize: prize, collegeToo: true });
  const DI = [
    'Each week, the Commissioner selects 8 to 10 NFL games for the slate.',
    'You pick which team you think will cover the spread. Straight-up winners don\'t count.',
    'NFL picks lock before the first kickoff of the NFL slate, usually 30 minutes before, at the time shown on the NFL Picks page. NFL and college football lock separately.',
    'Correct pick = 1 point. Incorrect = 0. Exact spread tie = No Decision (0 points). Most correct picks wins the week.',
    'Tiebreaker: the total combined points in the tiebreaker game, usually Monday night. Closest guess wins, over or under. If still tied, Weekly Ties settles it; the alma-mater step does not apply to the NFL.',
    'Optional: some weeks the Commissioner turns on the longest-field-goal side bet (the Extra Point rules above). It never changes anyone\'s correct-pick count; it only comes into play in Weekly Ties.',
    'A game that is cancelled or postponed out of the week is removed from the slate and counts for nobody.',
    'If ESPN corrects a score after the week is final, the Commissioner can correct the week.',
    'NFL has its own weekly winner and standings; they never combine with college football.',
    'Weekly prize: Loser buys winner a consolation prize.',
  ];
  assert(JSON.stringify(withCollege) === JSON.stringify(DI), '[2a] beside college football the card is DI-536\'s ten bullets, word for word and in order' + (JSON.stringify(withCollege) === JSON.stringify(DI) ? '' : ' - got ' + JSON.stringify(withCollege.filter((x, i) => x !== DI[i]))));
  const alone = sr.nflRulesItems({ weeklyPrize: prize, collegeToo: false });
  const joined = alone.join(' ');
  assert(!/college|alma|Weekly Ties|rules above/i.test(joined), '[2b] the NFL-only card names no college football, no alma-mater step and points at no card that is not drawn: ' + (joined.match(/college|alma|Weekly Ties|rules above/i) || ['none'])[0]);
  assert(alone.length === 9 && alone[0] === DI[0] && alone[1] === DI[1] && alone[3] === DI[3] && alone[alone.length - 1] === DI[9], '[2c] ...and states the same rules: the same slate, spread, scoring and prize bullets; the lock, tiebreaker and optional side bet in full; the cancelled-game and score-correction bullets');
  assert(/longest-field-goal guess settles it in a week where that side bet is on, and then a fixed draw/.test(alone[4]) && /closest without going over/.test(alone[5]), '[2d] ...with the tie order the app applies: tiebreaker, then (only in a week the contest is on) the longest field goal, then the seeded draw');
  assert(sr.nflRulesItems({ weeklyPrize: '', collegeToo: true }).length === 9 && sr.nflRulesItems({ collegeToo: true }).every((x) => !/Weekly prize/.test(x)), '[2e] no weekly prize setting -> no prize bullet (nothing typed in its place)');
  assert(sr.nflRulesItems({ weeklyPrize: 'a drink.  ', collegeToo: true }).slice(-1)[0] === 'Weekly prize: a drink.', '[2f] a prize that already ends in a full stop gets no second one');
  assert(sr.nflSlateSizeText({ slate: { minSize: 6, maxSize: 12 } }) === '6 to 12' && sr.nflSlateSizeText({ slate: { size: 10, minSize: 10, maxSize: 10 } }) === '10' && sr.nflSlateSizeText({}) === '' && sr.nflSlateSizeText(getProfile('nfl')) === '8 to 10',
    '[2g] the slate size is READ from the profile: 6 to 12 reads "6 to 12", equal ends read one number, the NFL profile reads "8 to 10"');
  const srcSr = await readFile(new URL('./js/sport-rules.js', import.meta.url), 'utf8').then((t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''));
  assert(!/8 to 10|\b8\b|\b10\b/.test(srcSr), '[2h] no slate number is typed in the card\'s source (comments stripped)');
}

console.log('\n[3] The page');
{
  reset();
  const none = render();
  reset({ comps: [CFB] });
  const one = render();
  reset({ comps: [CFB, { ...NFL, archivedAt: '2026-10-01T00:00:00Z' }] });
  const archived = render();
  assert(none === one && one === archived, '[3a] no rows, one college-football sport and an archived NFL render the SAME page, byte for byte');
  assert(/The Ischemic Extra Point/.test(one) && /Weekly Ties — who wins/.test(one) && /Alma mater games/.test(one) && /Debts &amp; Bylaws/.test(one) && !/NFL rules|These rules are for college football/.test(one),
    '[3b] ...and it is the page the league always had: the Extra Point card, the default sections, Weekly Ties and Debts & Bylaws; no NFL card, no opening line');

  reset({ comps: [CFB, NFL] });
  const both = render();
  const at = (re, s = both) => s.search(re);
  assert(at(/These rules are for college football\. NFL rules are below\./) > at(/How to Play/) && at(/These rules are for college football\. NFL rules are below\./) < at(/The Week Lifecycle/), '[3c] a two-sport league\'s page opens with the line, right under the heading');
  assert((both.match(/<h3>NFL rules<\/h3>/g) || []).length === 1 && at(/<h3>NFL rules<\/h3>/) > at(/Weekly Ties — who wins/) && at(/<h3>NFL rules<\/h3>/) < at(/Debts &amp; Bylaws/), '[3d] ...the NFL card appears ONCE, after the college cards (Weekly Ties) and before Debts & Bylaws');
  assert(/The Ischemic Extra Point/.test(both) && /Alma mater games/.test(both) && /Each week, the Commissioner selects 8 to 10 NFL games for the slate\./.test(both) && /NFL and college football lock separately\./.test(both),
    '[3e] ...beside the whole college page, and the card reads from the profile ("8 to 10") with the two-sport lock sentence');
  const stripNote = both.replace(/<p class="rules-sport-note[^>]*>[^<]*<\/p>/, '').replace(/\n      <div class="divider"><\/div>\n      <div class="rules-section"><h3>NFL rules<\/h3>[\s\S]*?<\/ul>\n      <\/div>/, '');
  assert(stripNote === one, '[3f] the ONLY differences from the one-sport page are the opening line and the NFL card with its divider (nothing else moved)');

  reset({ comps: [NFL] });
  const nfl = render();
  assert(!/The Ischemic Extra Point/.test(nfl) && !/Weekly Ties — who wins/.test(nfl) && !/Alma mater games/.test(nfl) && !/These rules are for college football/.test(nfl) && /<h3>NFL rules<\/h3>/.test(nfl) && /Debts &amp; Bylaws/.test(nfl),
    '[3g] an NFL-only league: no Extra Point card, no Weekly Ties card, no alma-mater default section, no opening line - the NFL card is its rules, and Debts & Bylaws stays');
  const visible = nfl.replace(/<!--[\s\S]*?-->/g, '');                 // the template\'s own HTML comments (developer notes) are not page text
  const rulesCard = visible.slice(visible.indexOf('<h3>NFL rules</h3>'), visible.indexOf('</ul>', visible.indexOf('<h3>NFL rules</h3>')));
  assert(!/college|alma|Weekly Ties|rules above/i.test(rulesCard) && /8 to 10 NFL games/.test(rulesCard), '[3h] ...and the card says nothing about college football, alma maters or a card that is not on the page');
  assert(!/alma/i.test(visible.slice(visible.indexOf('Chat</h3>'))), '[3i] ...with no alma-mater wording from the Chat card down (the rules card, Debts & Bylaws)');

  // the commissioner's own saved rules always render
  reset({ comps: [NFL] });
  saveSettings({ ...getSettings(), customRules: [{ id: 'c1', section: 'House rules', items: ['No phones at the table'] }] });
  const custom = render();
  assert(/House rules/.test(custom) && /No phones at the table/.test(custom) && /<h3>NFL rules<\/h3>/.test(custom), '[3j] an NFL-only league whose commissioner saved rules still shows them, above the NFL card');
}

console.log('\n[4] Safety');
{
  reset({ comps: [CFB, NFL] });
  saveSettings({ ...getSettings(), weeklyPrize: '<img src=x onerror=alert(1)> & more' });
  const html = render();
  assert(!/<img src=x/.test(html) && /&lt;img src=x onerror=alert\(1\)&gt; &amp; more/.test(html), '[4a] the league\'s weekly prize line is escaped in the NFL card');
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const i = src.indexOf('export function renderNflRulesHTML('); const blk = src.slice(i, src.indexOf('export function renderRulesPage', i));
  assert(/nflRulesItems\(\{ weeklyPrize, collegeToo \}\)\.map\(i => `<li>\$\{escHtml\(i\)\}<\/li>`\)/.test(blk) && /escHtml\(NFL_RULES_HEADING\)/.test(blk) && /escHtml\(RULES_COLLEGE_NOTE\)/.test(src),
    '[4b] every string of the card passes through escHtml at the one place it is drawn');
}

console.warn = origWarn; console.info = origInfo;
console.log(`\n${'='.repeat(50)}\n${fail === 0 ? '\u2705 ALL PASS' : '\u274c FAILURES'} \u2014 ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
