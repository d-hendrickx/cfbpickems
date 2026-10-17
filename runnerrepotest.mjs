#!/usr/bin/env node
/**
 * runnerrepotest.mjs — the runner's checks of the REAL repo (M-49, Drew 2026-10-14: "Yes, approve 47, 48, 49"; the revised M-43).
 *
 * These cases lived in testruntest.mjs (section G, and denylist-real-manifests). They read the real manifests, every suite script,
 * loadtest.mjs and deploy.sh, and build the real dependency map. testruntest is held to the runner's own code (affectedByDepsOnly), so
 * while they lived there a manifest edit, a deploy.sh edit or a suite script edit could break them and nothing ran them before the
 * batch's --full (review N2). Here they cost seconds and are NOT held: the generated map selects this suite, and it reads nearly every
 * file in the repo (the whole dependency map), so nearly every --affected diff selects it. That is the honest set, and it is cheap.
 *
 *   - denylist-real-manifests   every real manifest validates and names no denied script; the runner checks the denylist twice
 *   - repo-integrity            the suite set, floors, isolate:"tree", the tagged and the INFERRED browser lists, the tz set (evidence,
 *                               pinned), the fixed-zone rule, deploy.sh Gate 1 (`node loadtest.mjs --tz UTC`, `caffeinate -is`), the
 *                               scoring suites in smoke, the quick and smoke sets, manifest size and the iOS-boundary rule
 *   - repo-depmap               dependency edges, totality over js/css/index/service worker, W-22's list-only selection on the real tree
 *   - repo-selftest-selection   when testruntest and this suite run (M-42/M-43/M-49), through the runner's own planner
 *
 * A new suite usually lands here: a Chromium suite joins the inferred-browser list, a date-sensitive one the tz list.
 * Its mutation kit is tests/kits/runner-split-kit.mjs (scratch copies of the repo, one real-tree fact broken each).
 *
 * Run:   node runnerrepotest.mjs                 every case
 *        node runnerrepotest.mjs --case <name>   one case
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const REAL = here;                                            // the repo's cfb-pickems/ (this file's own checkout)
const ROOT = here;                                            // the runner under test is the one beside it
const argv = process.argv.slice(2);
const ONLY = (i => (i >= 0 ? argv[i + 1] : null))(argv.indexOf('--case'));

let pass = 0, fail = 0;
function assert(cond, label, detail) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, detail !== undefined ? `— ${detail}` : ''); }
}
const lib = n => import(pathToFileURL(path.join(ROOT, 'tests', 'lib', n)).href);
const cases = [];
const testCase = (name, fn) => cases.push({ name, fn });

testCase('denylist-real-manifests', async () => {
  const { loadManifests, denied } = await lib('manifest.mjs');
  const { suites, errors } = loadManifests(path.join(REAL, 'tests', 'suites'), { cfbDir: REAL });
  assert(errors.length === 0, 'every real manifest validates', errors.slice(0, 3).join(' | '));
  const bad = [...suites.values()].filter(m => denied(m.script) || (m.args || []).some(denied));
  assert(bad.length === 0, 'no real manifest names a denied script', bad.map(m => m.id).join(','));
  const src = readFileSync(path.join(ROOT, 'testrun.mjs'), 'utf8');
  assert((src.replace(/\s+/g, ' ').match(/assertNotDenied\(m\.script, m\.args, \{ cwd(: cfbDir)? \}\)/g) || []).length >= 2, 'the runner checks the denylist at plan time AND at spawn time (defence in depth), each time on the real file (cwd given)');
});

testCase('repo-integrity', async () => {
  const { loadManifests } = await lib('manifest.mjs');
  const { legacyBlockCount } = await lib('extract.mjs');
  const { suites, errors } = loadManifests(path.join(REAL, 'tests', 'suites'), { cfbDir: REAL });
  assert(errors.length === 0, 'tests/suites validates', errors.slice(0, 2).join(' | '));
  assert(suites.size >= 100 && suites.has('core') && suites.has('core-load'), `the suite set is registered (${suites.size}), including the core and its [1]-only variant`);
  assert([...suites.values()].filter(m => m.kind !== 'core').every(m => m.floor > 0), 'every real suite has a positive floor (the ratchet is on)');
  assert(legacyBlockCount(readFileSync(path.join(REAL, 'loadtest.mjs'), 'utf8')) === 0, 'loadtest.mjs registers nothing the old way');
  for (const id of ['notifytest', 'pushnativetest', 'static.check']) assert(suites.get(id)?.isolate === 'tree', `${id} is isolate:"tree" (it mutates or plants files inside the checkout)`);
  for (const id of ['adminairendertest', 'ccscrolltest', 'chatpagetest', 'chatsportbrowsertest', 'gamearrangetest', 'gamedaybudgettest', 'gameslistbrowsertest', 'gameviewstyletest', 'historybrowsertest', 'joinnudgebrowsertest', 'leaguesettingsrendertest', 'matrixheadertest', 'navtest', 'newsrendertest', 'overlayscrolltest', 'pickheadertest', 'sectiondragtest', 'shellrendertest', 'spacingtest', 'sportgeometrytest', 'sportstallbrowsertest', 'weekpagertest', 'weekswipetest', 'wizardsheettest']) assert(suites.get(id)?.tags.includes('browser'), `${id} is tagged browser`);
  const { inferTags } = await import(pathToFileURL(path.join(ROOT, 'testrun.mjs')).href);
  const inferredBrowser = [...suites.values()].filter(m => inferTags(REAL, m).has('browser')).map(m => m.id).sort();
  // seven on 95a16c3; the v0.30.0 landing tree (2026-10-07) added six that really drive Chromium: leaguesettingsrendertest, overlayscrolltest, pickheadertest, sectiondragtest, spacingtest, weekpagertest; D1 (2026-10-08) adds chatsportbrowsertest (the Locker Room's sport pills, DI-553); D1 Lane B history (2026-10-08, P-8) adds historybrowsertest (the comparison, the week detail, the rival picker and the chat's filter label, engine-measured); D1 third pass (2026-10-08, P-8) adds sportgeometrytest; D1 Lane B Game Day adds gamearrangetest, gamedaybudgettest and gameviewstyletest (fix round 2's P-8 proof) (the multisport surfaces, engine-measured); D1 Lane C (2026-10-08) adds adminairendertest; D1 Lane C news/content (2026-10-14, P-8) adds newsrendertest (the grouped news card, the storyline card, the content cards and their detail, engine-measured); D1 W-68 / W-69 (2026-10-14, P-8) adds gameslistbrowsertest (the Comm Games list, the add-or-swap sheet and the swap picker, computed-style measured); W-70 (2026-10-14, P-8) adds commnavbrowsertest (the Comm tab pager, the wizard's swipe-down and step pager, the W-71 Find spreads block, engine-measured with real touches); D1 DI-557 (2026-10-14, P-8) adds sportstallbrowsertest (the stall banner: computed style, the one fade, the scroll offset frame by frame, red wins, scope; raised by the page's own compressed interval)
  assert(JSON.stringify(inferredBrowser) === JSON.stringify(['adminairendertest', 'ccscrolltest', 'chatpagetest', 'chatsportbrowsertest', 'commnavbrowsertest', 'gamearrangetest', 'gamedaybudgettest', 'gameslistbrowsertest', 'gameviewstyletest', 'historybrowsertest', 'joinnudgebrowsertest', 'leaguesettingsrendertest', 'matrixheadertest', 'navtest', 'newsrendertest', 'overlayscrolltest', 'pickheadertest', 'sectiondragtest', 'shellrendertest', 'spacingtest', 'sportgeometrytest', 'sportstallbrowsertest', 'weekpagertest', 'weekswipetest', 'wizardsheettest']), 'exactly the twenty-five Chromium suites infer as browser — no false positive squats a browser slot (testruntest itself once did), none is missed', inferredBrowser.join(','));
  // the tz set (W-11 add-on (b), 2026-10-07) is EVIDENCE, pinned so a suite never drops out of the second-zone pass silently: every suite whose own
  // process called a Date/Intl API whose result depends on the zone (local getters/setters, toLocale*/toString, Intl.DateTimeFormat without a
  // timeZone, local-component or zone-less string Date construction) under a probe. A new date-sensitive suite is added here deliberately.
  const tzSet = [...suites.values()].filter(m => m.tags.includes('tz')).map(m => m.id).sort();
  assert(JSON.stringify(tzSet) === JSON.stringify(['adminpaneltest', 'almaprototest', 'almatest', 'authtest', 'boottest', 'btnspacingtest', 'chatfoottest', 'chatscrolltest', 'commpagertest', 'commsporttest', 'core', 'csvinjecttest', 'd1wiringtest', 'dashboardallsportstest', 'drafttest', 'eptest', 'feedbacktest', 'feedcombinetest', 'feedtimetest', 'finalizeentrantstest', 'gamedaybudgettest', 'gamedaytest', 'gameslisttest', 'gamesorttest', 'gdseamtest', 'gradetest', 'groupdtest', 'headermetatest', 'homefeedtest', 'hometest', 'joinnudgetest', 'joinoffertest', 'layouttest', 'lifecycletest', 'livetiebreaktest', 'lockclienttest', 'logofailtest', 'logotoggletest', 'logovarianttest', 'matrixheadertest', 'oddsfallbacktest', 'participationtest', 'pickcontrasttest', 'pickheadertest', 'pickstatustest', 'picksviewtest', 'pilotonlytest', 'profiletest', 'pushtest', 'readinessmotiontest', 'recaptest', 'relatedtest', 'sharetest', 'slateaddswaptest', 'slatetest', 'spacingtest', 'sportopstest', 'sportstalltest', 'sportstatetest', 'sportsurfacetest', 'standingscopetest', 'themetest', 'trainertest', 'weeklocktest', 'wizardfinalizetest', 'xsstest']), 'exactly the evidence-based tz set is tagged (66 suites; W-92 (2026-10-17) added feedcombinetest and feedtimetest - the real Home renderer formats each card\'s time in a zone (toLocaleDateString in js/feed-time.js); DESIGN_D1_E (2026-10-15) added joinnudgetest and joinoffertest - the real Home and application renderers over minidom / the multisport harness format dates (probed: toLocaleDateString, toLocaleTimeString, zone-less Date strings); the Game Day merge of int (2026-10-08) brings Lane B Game Day: gamedaybudgettest, gamedaytest, gamesorttest, picksviewtest and relatedtest and the logo / header suites logovarianttest, matrixheadertest and pickheadertest it tags; D1 added weeklocktest, livetiebreaktest, lockclienttest (FB-001/FB-002) and wizardfinalizetest (FB-027: the Manage screen renders dates); Lane B added chatfoottest, d1wiringtest, homefeedtest, logofailtest, pilotonlytest and spacingtest (Home / card-detail renders and chat times); Lane A added commsporttest, pickstatustest and finalizeentrantstest (they render or build dates), 2026-10-07; D1 multisport client added sportsurfacetest, sportstatetest, dashboardallsportstest, sportopstest and participationtest - the real renderers format dates, 2026-10-08) — W-70 (2026-10-14) added commpagertest and W-71 oddsfallbacktest (each drives the real application renderers through minidom); DI-557 (2026-10-14) added sportstalltest (the same: the real renderers over minidom, probed: toLocaleDateString, toLocaleTimeString, zone-less Date strings) — none dropped from the second-zone pass, none added unexamined', tzSet.join(','));
  assert([...suites.values()].every(m => !(m.tags.includes('tz') && m.env && m.env.TZ)) && !suites.get('themetest-tz-America-Los-Angeles')?.tags.includes('tz') && suites.get('themetest')?.tags.includes('tz'), 'no fixed-zone manifest is tagged tz; its base suite (themetest) is');
  const deploySh = readFileSync(path.join(REAL, '..', 'deploy.sh'), 'utf8');
  assert(/\(cd "\$SRC" && \$KEEPAWAKE node loadtest\.mjs --tz UTC\)/.test(deploySh), 'deploy.sh Gate 1 runs `node loadtest.mjs --tz UTC`: the release gate is the full run plus the UTC second-zone pass (D-42)');
  assert(/KEEPAWAKE=""; command -v caffeinate >\/dev\/null 2>&1 && KEEPAWAKE="caffeinate -is"/.test(deploySh), 'deploy.sh Gate 1 keeps the Mac awake for the run with caffeinate -is when it exists (D-57), so an idle sleep cannot turn the gate into a false red');
  for (const id of ['grouptest', 'atstest', 'spreadsigntest', 'spreadlocktest']) assert(suites.get(id)?.tags.includes('smoke') && suites.get(id)?.floor > 0, `${id} (scoring math: who owes whom / the signed spread) is registered and in the smoke set, so every tier runs it`);
  assert(suites.get('core')?.floor >= 1740 && suites.get('core-load')?.floor >= 62, 'the core suites carry real floors (core ≥ 1740 inline, core-load ≥ 62): a floor of 0 skipped the check (reviewer N5)');
  const quick = [...suites.values()].filter(m => m.tags.includes('quick') || m.tags.includes('smoke'));
  const inQuick = id => ['quick', 'smoke'].some(t => suites.get(id)?.tags.includes(t));
  assert(['core-load', 'scoringtest', 'groupdtest', 'boottest', 'authtest', 'hometest', 'static.check', 'notifytest'].every(inQuick), 'the quick tier carries the [1] load, scoring math, boot, auth and the blind-rule checks');
  assert(!quick.some(m => m.tags.includes('browser')), 'no Chromium suite is in the quick tier');
  const smoke = [...suites.values()].filter(m => m.tags.includes('smoke'));
  assert(smoke.length >= 10 && smoke.length <= 30 && smoke.every(m => (m.expectedMs ?? 0) <= 16000 && !m.tags.includes('slow') && !m.tags.includes('browser')), `the always-on smoke set is small and cheap (${smoke.length} suites, none slow or browser) — it is added to EVERY --affected run`);
  assert(!inQuick('chatpagetest') && suites.get('boottest').tags.includes('slow') && !suites.get('boottest').tags.includes('smoke'), 'the two long poles (boottest, authtest) are in --quick but NOT in the always-on set: they are reached by dependency when the diff can touch them');
  // boundarytest's Tier-1 rule: shipped *.json may not mention the iOS shell
  const bad = readdirSync(path.join(REAL, 'tests', 'suites')).filter(f => f.endsWith('.json')).filter(f => /munera-ios|@capacitor|@onesignal/i.test(readFileSync(path.join(REAL, 'tests', 'suites', f), 'utf8')));
  assert(bad.length === 0, 'no manifest mentions the iOS shell / @capacitor (they are shipped *.json; the iOS boundary test scans them)', bad.join(','));
  const big = readdirSync(path.join(REAL, 'tests', 'suites')).filter(f => f.endsWith('.json')).map(f => [f, statSync(path.join(REAL, 'tests', 'suites', f)).size]).filter(([, s]) => s > 4000);
  assert(big.length === 0, 'every manifest stays small (< 4 KB — verbatim history lives in _archive.md)', big.map(b => b.join(':')).join(','));
});

testCase('repo-depmap', async () => {
  const { loadManifests } = await lib('manifest.mjs');
  const { buildDepMap, listRepoFiles } = await lib('depmap.mjs');
  const root = path.resolve(REAL, '..');
  const { suites } = loadManifests(path.join(REAL, 'tests', 'suites'), { cfbDir: REAL });
  const map = buildDepMap({ root, cfbDir: REAL, suites });
  const has = (id, f) => map.get(id)?.files.has(f);
  assert(has('hometest', 'cfb-pickems/js/home.js') && has('hometest', 'cfb-pickems/js/storage.js'), 'hometest depends on js/home.js and, transitively, on js/storage.js');
  assert(has('notifytest', 'cfb-pickems/js/notify-copy.js') && has('notifytest', 'cfb-pickems/backend/notifyServer.mjs'), 'notifytest depends on the files it mutates by path (js/notify-copy.js, backend/notifyServer.mjs)');
  assert(has('pushnativetest', 'cfb-pickems/js/push-native.js'), 'pushnativetest depends on js/push-native.js (named via path.join(__dirname, \'js\', …))');
  assert(has('accountexittest', 'cfb-pickems/loadtest.mjs'), 'accountexittest depends on loadtest.mjs (it pins section [1]\'s import list)');
  assert(has('functions.check', 'cfb-pickems/tests/suites/core.json') || has('functions.check', 'cfb-pickems/loadtest.mjs'), 'functions.check depends on the harness wiring it inspects');
  assert([...suites.keys()].every(id => map.get(id).files.has(`cfb-pickems/${suites.get(id).script}`)), 'every suite depends on its own script');
  // totality: a change to any app module must map to at least one suite, or --affected would stop (M-42) for every js edit. A held suite
  // (affectedByDepsOnly, D-76) does not count: it never selects for an app file, and testruntest's own reach of every file made this vacuous (N5)
  const files = listRepoFiles(root);
  const covered = f => [...map.values()].some(d => !d.gate && d.files.has(f));
  assert([...map.values()].some(d => d.gate), 'control: the real map has a held suite (testruntest), so excluding held suites below is not a no-op');
  const uncovered = files.filter(f => /^cfb-pickems\/js\/[^/]+\.js$/.test(f) && !covered(f));
  assert(uncovered.length === 0, 'every cfb-pickems/js/*.js module is reached by at least one suite --affected can select for it (held suites excluded)', uncovered.join(','));
  const cssUncovered = files.filter(f => /^cfb-pickems\/css\/.+\.css$/.test(f) && !covered(f));
  assert(cssUncovered.length === 0, 'every css file is reached by at least one suite', cssUncovered.join(','));
  for (const f of ['cfb-pickems/index.html', 'cfb-pickems/service-worker.js']) assert(covered(f), `${f} is reached by at least one suite`);
  // W-22: on the real tree, a module joining section [1]'s list selects the [1] load and the suites that pin the list, not the sweep
  const { selectAffected, classifyLoadtestEdit } = await lib('depmap.mjs');
  const real = readFileSync(path.join(REAL, 'loadtest.mjs'), 'utf8');
  const edit = classifyLoadtestEdit(real, real.replace("  'account-exit',\n]) {", "  'zz-probe',\n  'account-exit',\n]) {"));
  const sel = selectAffected({ changed: ['cfb-pickems/loadtest.mjs'], depMap: map, suites, root, loadtestEdit: edit });
  const pins = ['core-load', 'core', 'accountexittest', 'leaguesettingsuitest', 'newstest', 'scribeprofiletest', 'functions.check'];
  assert(!sel.full && pins.every(id => sel.ids.has(id)), `on the real tree, a list-only loadtest.mjs edit is not a full run and selects the [1] load and every suite that reads loadtest.mjs by name (${pins.join(', ')})`, `full=${sel.full} missing=${pins.filter(id => !sel.ids.has(id)).join(',')} ${sel.reasons.join(' | ')}`);
  assert(sel.ids.size < suites.size / 3 && !sel.ids.has('weekpagertest') && !sel.ids.has('sectiondragtest'), `…and it is a small set (${sel.ids.size} of ${suites.size}), not the browser suites that only glob the directory loadtest.mjs sits in`, [...sel.ids].join(','));
});

// M-43 (D-76) and M-42 (D-75) on the REAL manifests, through the runner's own planner: when does the runner's self-test run?
testCase('repo-selftest-selection', async () => {
  const { loadManifests } = await lib('manifest.mjs');
  const { buildDepMap, classifyLoadtestEdit } = await lib('depmap.mjs');
  const { buildPlan, parseArgs } = await import(pathToFileURL(path.join(ROOT, 'testrun.mjs')).href);
  const root = path.resolve(REAL, '..');
  const { suites } = loadManifests(path.join(REAL, 'tests', 'suites'), { cfbDir: REAL });
  const depMap = buildDepMap({ root, cfbDir: REAL, suites });
  const plan = (args, changedFiles, loadtestEdit = null) => { try { return buildPlan(parseArgs(args), { suites, depMap, changedFiles, loadtestEdit }); } catch (e) { return { error: e.message, selected: [], tier: null }; } };
  const picks = p => p.selected.some(m => m.id === 'testruntest');
  const rt = suites.get('testruntest');
  // M-49 (Drew, 2026-10-14: "Yes, approve 47, 48, 49"; the revised M-43): runner code only. tests/suites/** left the gate: every builder branch edits a manifest
  // (a floor raise), so it put testruntest in 26 of 36 real branch diffs. The checks that DO read the manifests live here, in runnerrepotest.
  // tests/parity.mjs stays: the landing proof is tested by testruntest alone (parity-tool + its mutants), while 48 other suites' broad globs reach it
  const RUNNER_SET = ['loadtest.mjs', 'testrun.mjs', 'testruntest.mjs', 'tests/lib/**', 'tests/parity.mjs'];
  assert(rt?.affectedByDepsOnly === true && JSON.stringify([...(rt?.deps || [])].sort()) === JSON.stringify(RUNNER_SET), `testruntest is held to exactly its runner paths in --affected (${RUNNER_SET.join(', ')})`, JSON.stringify({ affectedByDepsOnly: rt?.affectedByDepsOnly, deps: rt?.deps }));
  assert(!!rt && !rt.tags.includes('smoke') && !rt.tags.includes('quick'), 'testruntest carries no smoke or quick tag (either would run it whatever changed)', JSON.stringify(rt?.tags));
  // (c) a diff of app files only: never the self-test (it still reads every one of them, so the generated map alone would pick it)
  assert(depMap.get('testruntest')?.files.has('cfb-pickems/js/home.js'), 'control: the generated map does reach js/home.js for testruntest (the selection, not the map, holds it back)');
  const app = ['cfb-pickems/js/home.js', 'cfb-pickems/js/app.js', 'cfb-pickems/js/storage.js', 'cfb-pickems/css/styles.css', 'cfb-pickems/index.html', 'cfb-pickems/service-worker.js', 'cfb-pickems/hometest.mjs', 'cfb-pickems/supabase/tests/static.check.mjs'];
  for (const f of app) {
    const p = plan(['--affected'], [f]);
    assert(!p.error && !p.stop && p.tier === 'affected' && !picks(p), `(c) an app-only diff (${f}) does not select testruntest`, p.error || `tier ${p.tier} stop ${!!p.stop} picks ${picks(p)}`);
  }
  const all = plan(['--affected'], app);
  assert(!all.error && !all.stop && !picks(all), '(c) …nor do all of those at once', all.error || '');
  // (d) its own paths do
  for (const f of ['cfb-pickems/testruntest.mjs', 'cfb-pickems/tests/suites/testruntest.json', 'cfb-pickems/tests/parity.mjs']) {
    const p = plan(['--affected'], [f, 'cfb-pickems/js/home.js']);
    assert(!p.error && !p.stop && picks(p), `(d) a diff with ${f} selects testruntest`, p.error || `stop ${!!p.stop}`);
  }
  const real = readFileSync(path.join(REAL, 'loadtest.mjs'), 'utf8');
  const listOnly = classifyLoadtestEdit(real, real.replace("  'account-exit',\n]) {", "  'zz-probe',\n  'account-exit',\n]) {"));
  const lp = plan(['--affected'], ['cfb-pickems/loadtest.mjs'], listOnly);
  assert(!lp.error && !lp.stop && picks(lp), '(d) a list-only loadtest.mjs edit selects testruntest (it reads loadtest.mjs, and loadtest.mjs is one of its paths)', lp.error || '');
  const below = classifyLoadtestEdit(real, real.replace("console.log('\\n[1b] ", "console.log('\\n[1b]  "));
  for (const [f, edit] of [['cfb-pickems/testrun.mjs', null], ['cfb-pickems/tests/lib/depmap.mjs', null], ['cfb-pickems/loadtest.mjs', below]]) {
    const stop = plan(['--affected'], [f], edit);
    const full = plan(['--affected', '--allow-full'], [f], edit);
    assert(!stop.error && !!stop.stop && stop.selected.length === 0, `(d) a change to ${f}${edit ? ' (below section [1])' : ''} stops --affected (M-42: it would be the full run)`, stop.error || `tier ${stop.tier}`);
    assert(!full.error && full.tier === 'full' && picks(full), `(d) …and with --allow-full that full run includes testruntest`, full.error || `tier ${full.tier}`);
  }
  // B2 / N4 on the real manifests: what a stopped run tells a builder to run instead
  const ltStop = plan(['--affected'], ['cfb-pickems/loadtest.mjs'], below);
  const ltOnly = (ltStop.stop && ltStop.stop.only && ltStop.stop.only.ids) || [];
  const READERS = ['accountexittest', 'core', 'functions.check', 'leaguesettingsuitest', 'newstest', 'scribeprofiletest', 'testruntest'];
  assert(READERS.every(id => ltOnly.includes(id)) && !ltOnly.includes('core-load'), `(N4) a loadtest.mjs-only stop prints --only the core and every suite that reads loadtest.mjs by name (${READERS.join(', ')}; core-load is inside core)`, JSON.stringify(ltOnly));
  const rStop = plan(['--affected'], ['cfb-pickems/testrun.mjs', 'cfb-pickems/tests/lib/depmap.mjs', 'cfb-pickems/js/home.js'], null);
  assert(!!rStop.stop && !!rStop.stop.command && rStop.stop.command.includes('cfb-pickems/js/home.js') && !/--changed \S*cfb-pickems\/(testrun\.mjs|tests\/lib)/.test(rStop.stop.command) && JSON.stringify(rStop.stop.only && rStop.stop.only.ids) === '["testruntest"]', '(B2) a runner-file stop on the real tree prints --changed without the runner files and --only testruntest (the rest of the diff reaches runnerrepotest already)', JSON.stringify(rStop.stop));
  const rAlone = plan(['--affected'], ['cfb-pickems/testrun.mjs'], null);
  assert(!!rAlone.stop && !rAlone.stop.command && JSON.stringify(rAlone.stop.only && rAlone.stop.only.ids) === '["runnerrepotest","testruntest"]', '(M-49) a runner-file-only stop on the real tree offers --only runnerrepotest,testruntest: both of the runner\'s own tests', JSON.stringify(rAlone.stop));
  // M-49: a manifest edit (a floor raise, a new suite), a deploy.sh edit or a suite script edit selects THIS suite, the cheap real-tree
  // checks, and not the runner's five-minute self-test
  const picksRepo = p => p.selected.some(m => m.id === 'runnerrepotest');
  for (const f of ['cfb-pickems/tests/suites/grouptest.json', 'deploy.sh', 'cfb-pickems/hometest.mjs', 'cfb-pickems/supabase/tests/static.check.mjs']) {
    const p = plan(['--affected'], [f]);
    assert(!p.error && !p.stop && picksRepo(p) && !picks(p), `(M-49) a diff with ${f} selects runnerrepotest and not testruntest`, p.error || `stop ${!!p.stop} repo ${picksRepo(p)} self-test ${picks(p)}`);
  }
  const me = suites.get('runnerrepotest');
  assert(!!me && !me.affectedByDepsOnly && !me.tags.includes('slow') && !me.tags.includes('browser'), '(M-49) runnerrepotest is not held, not slow and not a browser suite: the generated map selects it, and it costs seconds', JSON.stringify(me && { held: me.affectedByDepsOnly, tags: me.tags }));
  const fullRepo = plan(['--full'], []);
  assert(!fullRepo.error && picksRepo(fullRepo), '(M-49) --full runs runnerrepotest');
  // (e) every full run, and never --quick
  const fullPlan = plan(['--full'], []);
  assert(!fullPlan.error && picks(fullPlan), '(e) --full runs testruntest');
  const quick = plan(['--quick'], []);
  assert(!quick.error && !picks(quick), '--quick never runs testruntest (no smoke or quick tag)');
});

console.log('runnerrepotest.mjs — the runner\'s checks of the real repo (manifests, suite scripts, loadtest.mjs, deploy.sh, the dependency map)');
const selected = ONLY ? cases.filter(c => c.name === ONLY) : cases;
if (ONLY && !selected.length) { console.error(`no case "${ONLY}"`); process.exit(2); }
for (const c of selected) {
  console.log(`\n[${c.name}]`);
  try { await c.fn(); } catch (e) { fail++; console.error('  ❌', `case ${c.name} threw:`, e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e); }
}
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exitCode = fail === 0 ? 0 : 1;
