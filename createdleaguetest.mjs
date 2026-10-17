/**
 * CFB Pickems — createdleaguetest.mjs (D1 / v0.30.0, thread 100726-D1, Lane A; DI-551 "A created league whose main sport is the NFL")
 * =====================================================================================================================================
 * League creation lets a founder choose sports, and with the NFL playable a league whose MAIN (default) competition is the NFL must behave as an NFL league, not as college football with a
 * different label. This suite drives the REAL renderers (sportenv.mjs's local store; nothing touches a network) over three leagues:
 *
 *   [1] an NFL-ONLY league (the default competition is `nfl`): Picks, Dashboard, Standings, Rules and the Commissioner page print NO occurrence of `alma`, `college football` or `Extra Point`
 *       outside the named allow-list (the platform's own What's New card is one release-note card shown to every league; it is not the league's rules), and a non-vacuity control proves
 *       the scan is not blind: the college-football league DOES print those words on the same surfaces;
 *   [2] a college-football league created through the new path (a competition row, `isDefault`) renders BYTE-IDENTICALLY to IRB's shape (no competition rows) on every surface;
 *   [3] a league created with BOTH sports keeps its college surfaces (the alma-mater card, the Extra Point Ledger, the college Rules cards) beside the NFL card (DI-520 to 536);
 *   [4] the week wizard's creation path for an NFL main sport builds an NFL week (the tiebreaker is the game's total, the side contest is off by default, no alma-mater default) and for a
 *       college main sport builds today's week exactly;
 *   [5] NEW_LEAGUE_DEFAULTS carries no college-football text (DI-551 #2);
 *   [6] MUTATION PROOFS on in-memory copies of js/app.js - each must turn a NAMED check RED.
 *
 * Run:  node createdleaguetest.mjs
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { makeEnv, withMutantApp, els } from './sportenv.mjs';
import { setPilotOnlyLeagueResolver } from './js/pilot-only.js';
import { createWeek } from './js/data-model.js';
import { getProfile } from './js/sports/index.js';
import * as seam from './js/sport-seam.js';

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, detail ? `— ${detail}` : ''); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const env = await makeEnv();
const { app } = env;
// A CREATED league is not the pilot: IRB's own content (the 2K25 Permanent Record, the founders' schools) is closed to it. In local mode app.js answers `{ pilot: true }` (a PIN-era device IS the
// founding league's), so this fixture installs the answer a created league's membership row gives.
setPilotOnlyLeagueResolver(() => ({ pilot: false }));
const FORBID = /alma|college football|extra point/i;

// THE ALLOW-LIST (DI-551.3 "outside an allow-list"). Each entry is a piece of text that may carry a forbidden word and WHY it is not the league's own surface. Anything not named here fails.
const WHATS_NEW = app.renderWhatsNewCardHTML();   // the platform's release notes: one card, identical for every league; a v0.29.0 line names the Weekly Ties steps
const ALLOW = [
  { name: "the What's New / release-notes card", why: 'platform text shown to every league identically (renderWhatsNewCardHTML); it is not a rule of the league', strip: (h) => h.split(WHATS_NEW).join('') },
];
// HTML comments are not rendered: they are the source's own notes (several name the retired Alma Maters section), so they are cut before the scan.
const scrub = (html) => ALLOW.reduce((h, a) => a.strip(h), html.replace(/<!--[\s\S]*?-->/g, ''));
const hitsOf = (html) => [...scrub(html).matchAll(new RegExp(FORBID.source, 'gi'))].map((m) => scrub(html).slice(Math.max(0, m.index - 36), m.index + 48).replace(/\s+/g, ' '));

/** Every surface DI-551.3 names, as markup. A league whose main sport is the NFL gets weeks the way the wizard builds them: createWeek() with the NFL profile (the tiebreaker is one game's total, the side contest off). */
function surfaces(opts, mod = app) {
  env.league(opts);
  // F-2 (review, 2026-10-08): the commissioner's Comm LENS is a view toggle; `opts.lens` moves it after the league is built so a surface can be read on each lens.
  if (opts.lens) { seam.resetLensSport(); seam.setLensSport(opts.lens); }
  if ((opts.sports || [])[0] === 'nfl') {
    const prof = createWeek('2026', 1, '', '', { profile: getProfile('nfl') });
    const fields = ['tiebreakerType', 'tiebreakerQuestion', 'tiebreakerCalculationMode', 'extraPointEnabled'];
    env.put('cfbp_weeks', env.lsGet('cfbp_weeks').map((w) => ({ ...w, ...Object.fromEntries(fields.map((f) => [f, prof[f]])) })));
  }
  const out = {};
  for (const tab of ['picks', 'dashboard', 'leaderboard']) { try { out[tab] = env.renderFull(tab); } catch (e) { out[tab] = 'THROW ' + e.message; } }
  const rules = els.get('page-rules'); rules._html = ''; mod.renderRulesPage(); out.rules = rules._html;
  const comm = els.get('page-commissioner'); comm._html = ''; try { mod.renderCommPage(); } catch (e) { comm._html = 'THROW ' + e.message; } out.comm = comm._html;
  return out;
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[1] An NFL-only league prints no alma-mater, college-football or Extra Point wording…');
// ═════════════════════════════════════════════════════════════════
const nfl = surfaces({ sports: ['nfl'], isAdmin: true });
const cfb = surfaces({ sports: ['cfb'], isAdmin: true });
for (const s of ['picks', 'dashboard', 'leaderboard', 'rules', 'comm']) {
  assert(!/^THROW/.test(nfl[s]) && nfl[s].length > 300, `[1a] the NFL-only ${s} surface rendered (${nfl[s].length} characters)`);
  const h = hitsOf(nfl[s]);
  assert(h.length === 0, `[1b] NFL-only ${s}: no forbidden wording outside the allow-list`, JSON.stringify(h.slice(0, 4)));
}
for (const s of ['leaderboard', 'rules', 'comm']) assert(hitsOf(cfb[s]).length > 0, `[1c] non-vacuity: the college-football ${s} surface DOES print those words (so a clean NFL result is the filtering, not a blind scan)`);
assert(ALLOW.every((a) => a.why && a.why.length > 30), '[1d] every allow-list entry carries a reason a reviewer can check');
assert(!/alma-mater-settings|Alma maters &amp; home teams/.test(nfl.comm) && !/almaMater/.test(nfl.comm.replace(/\s+/g, ' ')), '[1e] DI-551: the Commissioner page has NO "Alma maters & home teams" card in an NFL-only league');
assert(!/Alma Mater Watch|Alma Mater Rankings/i.test(nfl.dashboard + nfl.leaderboard), '[1f] DI-551: no Alma Mater Watch on the Dashboard and no Alma Mater Rankings in Standings');
assert(!/Extra Point Ledger/.test(nfl.leaderboard) && !/id="(extra-point|ep-)[^"]*"/i.test(nfl.picks), '[1g] DI-551: no Extra Point Ledger in Standings and no Extra Point input on Picks by default');

// ═════════════════════════════════════════════════════════════════
console.log('\n[2] A college-football league created through the new path renders IRB\'s shape, byte for byte…');
// ═════════════════════════════════════════════════════════════════
// Same pilot-ness on both sides (a created league is not the pilot; the 2K25 record is IRB's alone), so the ONLY difference is the shape of the store: one competition row (isDefault, the
// creation path) against none (IRB's pre-multisport shape).
for (const [label, base] of [['a player', {}], ['the commissioner', { isAdmin: true }]]) {
  const withRow = surfaces({ sports: ['cfb'], rows: true, ...base });
  const irbShape = surfaces({ sports: ['cfb'], rows: false, ...base });
  const diff = Object.keys(withRow).filter((k) => withRow[k] !== irbShape[k]);
  assert(diff.length === 0, `[2a] ${label}: Picks, Dashboard, Standings, Rules and Comm are byte-identical with and without the competition row`, JSON.stringify(diff));
}
{
  const c = surfaces({ sports: ['cfb'], rows: true, isAdmin: true });
  assert(/Ischemic Extra Point \(blackjack rules\)/.test(c.rules) && /Alma maters &amp; home teams/.test(c.comm) && /Extra Point Ledger/.test(c.leaderboard) && /Ischemic Extra Point — /.test(c.comm) && /Alma Mater Rankings/.test(c.leaderboard),
    '[2b] and a college league still HAS its college surfaces: the Extra Point rules card, the alma-mater card, the Extra Point Ledger, the Extra Point card and Alma Mater Rankings');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[3] A league created with BOTH sports keeps its college surfaces beside the NFL card (DI-520 to 536)…');
// ═════════════════════════════════════════════════════════════════
{
  const both = surfaces({ sports: ['cfb', 'nfl'], isAdmin: true, plays: { nfl: ['p1', 'p2'] } });
  assert(/These rules are for college football\. NFL rules are below\./.test(both.rules) && /NFL rules<\/h3>/.test(both.rules) && /Ischemic Extra Point \(blackjack rules\)/.test(both.rules),
    '[3a] the two-sport Rules page opens with the college note, keeps the college cards and adds the NFL card');
  assert(/Alma maters &amp; home teams/.test(both.comm) && /Extra Point Ledger/.test(both.leaderboard), '[3b] with college football as the main sport the alma-mater card and the Extra Point Ledger remain');
  const nflMain = surfaces({ sports: ['nfl', 'cfb'], isAdmin: true, plays: { cfb: ['p1', 'p2'] } });
  assert(/NFL rules<\/h3>/.test(nflMain.rules) && /Ischemic Extra Point \(blackjack rules\)/.test(nflMain.rules), '[3c] an NFL-MAIN league that also runs college football still draws the college cards (a league that plays college football reads its rules) beside the NFL card');
  // F-2 (review, 2026-10-08): the alma-mater card and the player alma line follow the LEAGUE (its default competition's profile, as DI-551 words it), never the commissioner's lens. [3d] before this read the
  // card off the lens, so a college-football league lost it whenever its commissioner looked at the NFL; the checks below pin both directions on BOTH lenses.
  for (const lens of ['nfl', 'cfb']) {
    const c = surfaces({ sports: ['nfl', 'cfb'], isAdmin: true, plays: { cfb: ['p1', 'p2'] }, lens });
    assert(seam.getLensSport() === lens && !/Alma maters &amp; home teams/.test(c.comm) && !/No alma mater set/.test(c.comm),
      `[3d] an NFL-MAIN league that also runs college football: Comm on the ${lens.toUpperCase()} lens shows no alma-mater card and no player alma line (the league's DEFAULT competition is the NFL)`);
  }
  {
    // the CFB-main two-sport league: the card, the player line and every Rules and Players section are IDENTICAL on the CFB lens and on the NFL lens
    // What is lens-specific BY DESIGN (DI-534) is set aside, and everything else must be identical: the Players tab's "Sport entries / Who plays <sport>" card (it lists the lens sport's entrants) and the lens week's id on the
    // Weekly Nicknames buttons (data-week-id="w_<sport>_2" is the lens sport's current week).
    const tabs = (html) => { const out = {}; const parts = html.split(/(?=data-comm-tab=")/); for (const p of parts) { const m = /^data-comm-tab="([a-z-]+)"/.exec(p); if (m && !/id="comm-sport-entries-card"/.test(p)) out[m[1]] = (out[m[1]] || '') + p.replace(/w_(cfb|nfl)_\d+/g, 'w_LENSWEEK'); } return out; };
    const onCfb = surfaces({ sports: ['cfb', 'nfl'], isAdmin: true, plays: { nfl: ['p1', 'p2'] }, lens: 'cfb' });
    const lensCfb = seam.getLensSport();
    const onNfl = surfaces({ sports: ['cfb', 'nfl'], isAdmin: true, plays: { nfl: ['p1', 'p2'] }, lens: 'nfl' });
    const lensNfl = seam.getLensSport();
    const tC = tabs(onCfb.comm), tN = tabs(onNfl.comm);
    assert(lensCfb === 'cfb' && lensNfl === 'nfl', '[3e] fixture: the two renders really are on different lenses', JSON.stringify({ lensCfb, lensNfl }));
    assert(/Alma maters &amp; home teams/.test(onCfb.comm) && /Alma maters &amp; home teams/.test(onNfl.comm) && /No alma mater set|text-xs text-muted">[^<]+<\/div>/.test(tN.players || ''),
      '[3f] F-2: a CFB-MAIN two-sport league keeps the alma-mater card and the player alma line with Comm on the NFL lens too');
    assert(tC.rules && tC.players && tC.rules === tN.rules && tC.players === tN.players,
      '[3g] F-2: a CFB-main two-sport league\'s Comm Rules tab and Players tab (the lens-specific Sport entries card and lens week id set aside) are IDENTICAL on the NFL lens and on the CFB lens', JSON.stringify(['rules', 'players'].filter((k) => (tC[k] || '') !== (tN[k] || ''))));
  }
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[4] The wizard builds an NFL week for an NFL main sport, and today\'s week for a college one…');
// ═════════════════════════════════════════════════════════════════
{
  const { createWeekFromWizard } = await import('./js/week-wizard.js');
  const build = (profileKey) => {
    let saved = null;
    createWeekFromWizard({ fields: { season: '2026', weekNumber: 1, competitionId: null, profile: getProfile(profileKey), startDate: '2026-10-08', endDate: '2026-10-12' },
      deps: { createWeek, saveWeek: (w) => { saved = w; }, setActiveWeekId() {} } });
    return saved;
  };
  const n = build('nfl'); const c = build('cfb');
  assert(n.tiebreakerType === 'custom' && n.tiebreakerCalculationMode === 'manual' && /total combined points scored in the tiebreaker game/.test(n.tiebreakerQuestion) && n.extraPointEnabled === false,
    '[4a] an NFL main sport: the tiebreaker is one game\'s total (type custom, manual), the side contest is OFF by default');
  const strings = Object.values(n).filter((v) => typeof v === 'string').join(' | ');
  assert(!FORBID.test(strings), '[4b] …and no field of an NFL week carries the alma-mater / college-football / Extra Point wording', strings.match(FORBID)?.[0] || '');
  const plain = createWeek('2026', 1, '2026-10-08', '2026-10-12');
  const norm = (w) => JSON.stringify({ ...w, weekId: 'x', createdAt: 'x', updatedAt: 'x', dataSourceMode: 'x', roundLabel: 'x' }, Object.keys({ ...w }).sort());
  assert(norm(c) === norm(plain), '[4c] a college main sport builds EXACTLY today\'s week (the profile adds nothing: byte-identical to createWeek() with no profile)');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[5] NEW_LEAGUE_DEFAULTS carries no college-football text (DI-551 #2)…');
// ═════════════════════════════════════════════════════════════════
{
  const { NEW_LEAGUE_DEFAULTS, NEW_LEAGUE_ON_ROWS } = await import('./js/league-defaults.js');
  const text = JSON.stringify([NEW_LEAGUE_DEFAULTS, NEW_LEAGUE_ON_ROWS]);
  assert(!FORBID.test(text) && !/ischemic|home team/i.test(text), '[5a] the settings a new league is seeded with, and the "Already on" rows its creation sheet states, name no alma mater, college football or Extra Point', text.match(FORBID)?.[0] || '');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[6] MUTATION PROOFS - each edit to an in-memory copy of js/app.js must turn a NAMED check RED…');
// ═════════════════════════════════════════════════════════════════
{
  const MUTANTS = [
    ['the Standings ledger gate removed', [["  if (!contextSportHasAffinity() && tally.enabledWeeks === 0) return '';", '']], 'leaderboard'],
    ['the Comm alma-mater card shown for every sport', [['    if (leagueHasAlmaAffinity()) sections.push(renderAlmaMaterSettingsCard());', '    sections.push(renderAlmaMaterSettingsCard());']], 'comm'],
    ['the Rules page always teaches the college side contest', [["${rs.hasCfb?'and (optionally) enter your Ischemic Extra Point guess.", "${true?'and (optionally) enter your Ischemic Extra Point guess."]], 'rules'],
    ['the Comm Extra Point card always the college game', [["ownContest = pr && pr.key !== 'cfb' && pr.sideContest && pr.sideContest.label ? pr.sideContest : null;", 'ownContest = null;']], 'comm'],
    ['the Rules editor always seeds the college default text', [['  const seed=rulesSports(liveLeagueCompetitions()).hasCfb?DEFAULT_RULES:[];', '  const seed=DEFAULT_RULES;']], 'comm'],
  ];
  for (const [label, edits, surface] of MUTANTS) {
    const hits = await withMutantApp(edits, async (m) => hitsOf(surfaces({ sports: ['nfl'], isAdmin: true }, m)[surface]));
    assert(hits.length > 0, `[6] MUTANT - ${label}: the NFL-only ${surface} surface prints forbidden wording (check [1b] ${surface} goes RED)`, JSON.stringify(hits.slice(0, 2)));
  }
  // F-2 (review, 2026-10-08): the mutants the loop above cannot see - an alma gate that follows the commissioner's LENS prints nothing forbidden on an NFL-only league; it LOSES the card of a college-football-main
  // two-sport league when Comm looks at the NFL. Each must turn [3f] / [3d] RED.
  const LENS_MUTANTS = [
    ['the alma gate reads the commissioner lens again', [["const sport = getLeagueDefaultCompetition()?.sport || 'cfb';", "const sport = getLensSport() || 'cfb';"]]],
    ['the alma gate always answers false', [["const sport = getLeagueDefaultCompetition()?.sport || 'cfb';", "const sport = 'nfl';"]]],
  ];
  for (const [label, edits] of LENS_MUTANTS) {
    const res = await withMutantApp(edits, async (m) => {
      const cfbMainOnNfl = surfaces({ sports: ['cfb', 'nfl'], isAdmin: true, plays: { nfl: ['p1', 'p2'] }, lens: 'nfl' }, m).comm;
      const nflMainOnCfb = surfaces({ sports: ['nfl', 'cfb'], isAdmin: true, plays: { cfb: ['p1', 'p2'] }, lens: 'cfb' }, m).comm;
      return { card: /Alma maters &amp; home teams/.test(cfbMainOnNfl), line: /No alma mater set|text-xs text-muted">[^<]+<\/div>/.test(cfbMainOnNfl), nflMainShowsOnCfbLens: /Alma maters &amp; home teams/.test(nflMainOnCfb) };
    });
    assert(!res.card || !res.line || res.nflMainShowsOnCfbLens, `[6] MUTANT - ${label}: a college-football-main two-sport league on the NFL lens LOSES its alma-mater card or player line, or an NFL-main one GAINS it on the CFB lens (checks [3f] / [3d] go RED)`, JSON.stringify(res));
  }
  const hitsBack = hitsOf(surfaces({ sports: ['nfl'], isAdmin: true }).comm) .length + hitsOf(surfaces({ sports: ['nfl'], isAdmin: true }).leaderboard).length;
  assert(hitsBack === 0, '[6z] and with the real app restored the same surfaces are clean again (the mutants left nothing behind)');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
