/**
 * CFB Pickems — joinoffertest.mjs (D1 / v0.30.0, DESIGN_D1_E: the join nudge, the APP half - js/app.js joinOffers() and the repaint after a join; Drew D-88, 2026-10-15)
 * =====================================================================================================================================================================
 * Home's nudge (joinnudgetest) trusts one thing: the list the app hands it. This suite proves that list over the REAL js/app.js on the multisport harness (sportenv.mjs): it is exactly the league
 * overview's own "Also in this league" cards (DI-E1.1), so the nudge and the sheet can never disagree, and it answers nothing to a signed-out viewer, a withheld page or a member who plays the sport -
 * including the LATE JOINER, who plays the sport and is not yet in its current week (two different questions, two different predicates). It also proves the nudge ends with no reload: a confirmed Join
 * repaints Home when Home is showing (DI-E1.4).
 *
 * Run:  node joinoffertest.mjs
 *
 *   [1]  joinOffers(): every row of DI-E1.6 over the real app - signed out, one sport, plays both, plays one (open / locked / live / final week), the commissioner who has not joined, three sports,
 *        an archived sport, a late joiner, content withheld; each answer equals the overview model's `other` cards (the same cards, the same Join state).
 *   [2]  The wiring and the repaint: Home is handed joinOffers; a confirmed Join repaints Home (when it is showing) and the offer is gone; a refused Join repaints nothing.
 *   [3]  MUTATION KIT (S-3): scratch copies of js/app.js, each mutant must turn a NAMED check RED.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const HERE = fileURLToPath(new URL('.', import.meta.url));

const { makeEnv, withMutantApp, CID } = await import('./sportenv.mjs');
const env = await makeEnv();
const { app, comp, st } = env;
const warn = console.warn; console.warn = () => {};

const OFFER = (dbCode, code, joinable) => ({ dbCode, code, joinable });
const modelOffers = (m) => m._buildLeagueOverviewModelForTest().other.map((c) => ({ dbCode: c.dbCode, code: c.code, joinable: c.view.joinEnabled === true }));

/** Every named scenario, as a function of the app module under test (the real one, or a mutant). Returns { label: boolean }. */
async function scenarios(m) {
  const R = {};
  const ck = (label, ok) => { R[label] = ok === true; };
  const offers = () => m._joinOffersForTest();
  const reset = (o) => { m._resetAuthHoldForTest(); m._joinStateForTest.joining.clear(); m._joinStateForTest.failed.clear(); return env.league(o); };

  // — a viewer who plays CFB only, in a CFB + NFL league
  for (const [status, joinable] of [['open', true], ['locked', false], ['live', false], ['final', false]]) {
    reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: status } });
    const got = offers();
    ck(`1a the NFL week is ${status.toUpperCase()}: exactly one offer, { nfl, NFL, joinable: ${joinable} }`, eq(got, [OFFER('nfl', 'NFL', joinable)]));
    ck(`1b ...and it is the overview's own "Also in this league" card for ${status} (the same list, the same Join state)`, eq(got, modelOffers(m)));
  }
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  ck('1c an offer is { dbCode, code, joinable } and nothing else', offers().every((o) => eq(Object.keys(o).sort(), ['code', 'dbCode', 'joinable'])));
  // — signed out / unverified
  reset({ sports: ['cfb', 'nfl'], viewer: null, plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  ck('1d signed out (no verified member): nothing is offered', eq(offers(), []));
  // — one sport
  reset({ sports: ['cfb'], viewer: 'p1', weekStatus: { cfb: 'open' } });
  ck('1e a one-sport league: nothing is offered', eq(offers(), []));
  // — plays both
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  ck('1f a member who plays both sports: nothing is offered', eq(offers(), []));
  // — a late joiner: plays NFL, but joined after THIS week locked (the sport-level and the week-level answers differ)
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p1', 'p3'] }, weekStatus: { cfb: 'open', nfl: 'open' }, joinedAt: '2026-10-12T00:00:00.000Z' });
  const nflWeek = st.getWeeks().find((w) => w.weekId === 'w_nfl_2');
  ck('1g FIXTURE: the late joiner PLAYS the NFL but is not on the roster of its current week (so the two predicates differ)', comp.playedSports().some((s) => s.dbCode === 'nfl') && !comp.playersForWeek(nflWeek).some((p) => p.playerId === 'p1'));
  ck('1h a LATE JOINER (plays the sport, not in this week) is never offered it - "plays the sport" is the nudge\'s question, "is in this week" is the first-person lines\'', eq(offers(), []));
  // — the commissioner who has not joined
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', isAdmin: true, plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  ck('1i a commissioner who has not joined is offered the sport exactly like a member', eq(offers(), [OFFER('nfl', 'NFL', true)]));
  // — three sports
  reset({ sports: ['cfb', 'nfl', 'nhl'], viewer: 'p1', plays: { nfl: ['p3'], nhl: ['p2'] }, weekStatus: { cfb: 'open', nfl: 'open', nhl: 'locked' } });
  ck('1j three sports, plays one: one offer for each of the other two, in the league\'s order, each with its own Join state', eq(offers(), [OFFER('nfl', 'NFL', true), OFFER('nhl', 'NHL', false)]) && eq(offers(), modelOffers(m)));
  // — an archived sport is not offered
  reset({ sports: ['cfb', 'nfl', 'nhl'], viewer: 'p1', plays: { nfl: ['p3'], nhl: ['p2'] }, weekStatus: { cfb: 'open', nfl: 'open', nhl: 'open' } });
  env.put('cfbp_competitions', env.lsGet('cfbp_competitions').map((c) => (c.sport === 'nhl' ? { ...c, archivedAt: '2026-10-01T00:00:00.000Z' } : c)));
  ck('1k an ARCHIVED sport is not offered (only a sport the league runs)', eq(offers(), [OFFER('nfl', 'NFL', true)]));
  // — content withheld
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  let withheldAnswer = null;
  try { m.showAuthHoldGate('data-hold'); withheldAnswer = offers(); } catch (e) { withheldAnswer = 'threw: ' + e.message; } finally { m._resetAuthHoldForTest(); }
  ck('1l while content is withheld (a hold gate is up) nothing is offered', eq(withheldAnswer, []));
  // the answer is a fresh array each call (Home may not mutate the app's)
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  const a1 = offers(); a1.push('x');
  ck('1n a fresh array each call', offers().length === 1);

  // — [2] the repaint after a join, when Home is showing
  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  window.navigateTo('home');
  const wiring = m._getHomeWiringForTest();
  const realRender = wiring.homeView.renderHome;
  let renders = 0;
  wiring.homeView.renderHome = (...a) => { renders += 1; return realRender(...a); };
  try {
    const before = renders;
    const ok = await m._joinSportFromOverviewForTest('nfl', { confirmWrite: async () => 'saved' });
    ck('2a a confirmed Join repaints Home when Home is showing (the nudge and the red card\'s Join button end with no reload)', ok === true && renders > before);
    ck('2b ...and the offer is gone at that repaint (the member now plays the sport)', eq(offers(), []));
  } finally { wiring.homeView.renderHome = realRender; }

  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  window.navigateTo('home');
  const w2 = m._getHomeWiringForTest();
  const r2 = w2.homeView.renderHome;
  let n2 = 0;
  w2.homeView.renderHome = (...a) => { n2 += 1; return r2(...a); };
  try {
    const bf = n2;
    const refused = await m._joinSportFromOverviewForTest('nfl', { confirmWrite: async () => 'refused' });
    ck('2c a REFUSED Join repaints nothing on Home and the offer stays (the sheet owns the failure)', refused === false && n2 === bf && eq(offers(), [OFFER('nfl', 'NFL', true)]));
  } finally { w2.homeView.renderHome = r2; }

  reset({ sports: ['cfb', 'nfl'], viewer: 'p1', plays: { nfl: ['p3'] }, weekStatus: { cfb: 'open', nfl: 'open' } });
  window.navigateTo('picks');
  const w3 = m._getHomeWiringForTest();
  const r3 = w3.homeView.renderHome;
  let n3 = 0;
  w3.homeView.renderHome = (...a) => { n3 += 1; return r3(...a); };
  try {
    const bf = n3;
    await m._joinSportFromOverviewForTest('nfl', { confirmWrite: async () => 'saved' });
    ck('2d a Join made while Home is NOT showing does not paint Home (it paints on the next visit, from the new answer)', n3 === bf && eq(offers(), []));
  } finally { w3.homeView.renderHome = r3; }
  return R;
}

console.log('\n[1]-[2] the named checks over the real app…');
const ctl = await scenarios(app);
for (const [label, ok] of Object.entries(ctl)) assert(ok === true, `[${label}]`);

// ═══ static wiring ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n[2s] Static wiring…');
{
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const src = stripComments(await readFile(HERE + 'js/app.js', 'utf8'));
  assert(/const homeView = createHome\(\{[\s\S]{0,4000}?\bjoinOffers,/.test(src), '[2s-1] createHome is handed joinOffers (by reference, the app\'s own function)');
  assert(/function joinOffers\(\) \{[\s\S]{0,600}buildLeagueOverviewModel\(\)\.other\.map\(/.test(src), '[2s-2] joinOffers() reads the league overview\'s own `other` cards (one source of truth with the sheet)');
  assert(/function afterSportMembershipChanged\(\) \{[\s\S]{0,900}state\.currentTab === 'home'[\s\S]{0,60}renderHomePage\(\)/.test(src), '[2s-3] afterSportMembershipChanged repaints Home when Home is the current tab');
  // P-11 (Drew, 2026-10-15): the guard LISTS WHAT EXISTS - joinOffers() may call exactly these functions; a write is not on the list, and a call that disappears fails too.
  const body = (/function joinOffers\(\) \{[\s\S]*?\n\}\n/.exec(src) || [''])[0];
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);
  const calls = [...new Set([...body.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)].map((m) => m[1]).filter((n) => !KEYWORDS.has(n) && n !== 'joinOffers'))].sort();
  const WANT = ['buildLeagueOverviewModel', 'console.warn', 'isContentWithheld', 'other.map', 'viewerMemberId'].sort();
  assert(JSON.stringify(calls) === JSON.stringify(WANT), `[2s-4] joinOffers() calls EXACTLY ${WANT.length} things - the withheld gate, the verified-member gate, the overview model, its map and the warning (found: ${calls.join(', ')}); a write is not among them`);
  assert(/function joinOffers\(\) \{\s*try \{[\s\S]*?\} catch \(e\) \{[^}]*return \[\]; \}\s*\}/.test(src), '[2s-5] a model that cannot be built offers nothing: joinOffers() is one try with a catch that returns [] (never a thrown Home)');
}

// ═══ mutation kit ═════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] MUTATION KIT - scratch copies of js/app.js (never the file); each mutant must turn a NAMED check RED…');
assert(Object.values(ctl).every((v) => v === true), `[3-0] POSITIVE CONTROL: the unmutated app passes all ${Object.keys(ctl).length} named checks, so a red below is the mutation and nothing else`);
async function mutant(label, edits, must) {
  let res;
  try { res = await withMutantApp(edits, scenarios); } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 110)]: false }; }
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([n]) => n);
  assert(failed.length > 0 && must.every((x) => failed.some((f) => f.startsWith(x))), `${label} -> RED on: ${failed.slice(0, 5).map((f) => f.slice(0, 70)).join(' | ') || '(nothing - the mutant SURVIVED)'}`);
}
const LINE = "    return buildLeagueOverviewModel().other.map((c) => ({ dbCode: c.dbCode, code: c.code, joinable: c.view.joinEnabled === true }));";
await mutant('[M1] the nudge is offered to a member who PLAYS the sport (the played cards are read, not the other)', [[LINE, "    return buildLeagueOverviewModel().played.map((c) => ({ dbCode: c.dbCode, code: c.code || c.sportName, joinable: c.view.joinEnabled === true }));"]], ['1a', '1f']);
await mutant('[M2] the nudge is offered signed out (the verified-member gate is gone)', [['    if (isContentWithheld() || !viewerMemberId()) return [];', '    if (isContentWithheld()) return [];']], ['1d']);
await mutant('[M3] the nudge is offered while content is withheld', [['    if (isContentWithheld() || !viewerMemberId()) return [];', '    if (!viewerMemberId()) return [];']], ['1l']);
await mutant('[M4] joinable is ignored: every offer says a Join is open, whatever the sport\'s week', [[LINE, LINE.replace('c.view.joinEnabled === true', 'true')]], ['1a', '1j']);
await mutant('[M5] a LATE JOINER is given the nudge (the week\'s roster, not the sport, decides)', [[LINE, "    return computeSportCards().filter((c) => !c.week || !playersForWeek(c.week).some((p) => p.playerId === viewerMemberId())).map((c) => ({ dbCode: c.entry.dbCode, code: c.entry.code, joinable: c.view.joinEnabled === true }));"]], ['1h']);
await mutant('[M6] a one-sport league is offered something (the model\'s other list is bypassed)', [[LINE, "    return leagueSports().map((s) => ({ dbCode: s.dbCode, code: s.code, joinable: true }));"]], ['1e', '1f']);
await mutant('[M7] the Join does not repaint Home (the nudge would wait for a reload)', [["  try { if (state.currentTab === 'home') { renderHomePage(); } } catch (e) { console.warn('[sport] Home could not refresh', e); }", '']], ['2a']);
await mutant('[M8] a failed Join repaints Home anyway (it is called from the failure path)', [["  if (!ok) { _joinState.failed.add(dbCode); haptic('error'); repaintSportCardSurfaces(); return false; }", "  if (!ok) { _joinState.failed.add(dbCode); haptic('error'); repaintSportCardSurfaces(); afterSportMembershipChanged(); return false; }"]], ['2c']);
await mutant('[M9] Home is repainted even when it is not the current tab', [["  try { if (state.currentTab === 'home') { renderHomePage(); } }", "  try { if (true) { renderHomePage(); } }"]], ['2d']);
await mutant('[M10] the answer is cached for the page (a Join, a lock or a sign-out would not change what Home is told)', [[LINE, "    return (globalThis.__joinOfferCache ||= buildLeagueOverviewModel().other.map((c) => ({ dbCode: c.dbCode, code: c.code, joinable: c.view.joinEnabled === true })));"]], ['1n', '1a']);

console.warn = warn;
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
