/**
 * CFB Pickems — profiletest.mjs
 * =============================
 * Thread "091926-MULTISPORT", Phase 0, DI-219 (AD-73 PROPOSED, UN-220).
 *
 * Proves two things about `js/sports/{index,cfb,nfl}.js`:
 *
 *   A. THE REGISTRY BEHAVES — getProfile() is strict (unknown dbCode = loud
 *      error, never a default), listProfiles() is ordered and frozen, every
 *      profile is DEEPLY frozen, keys are R1 dbCodes, and the modules import
 *      nothing they must not (R6: never app.js; Edge-importable).
 *
 *   B. EVERY PROFILE VALUE EQUALS THE LEGACY CONSTANT IT REPLACES. Where the
 *      legacy value has a runtime seam it is proven THROUGH the real legacy
 *      code, not by re-typing the literal here:
 *        espn.path        <- ESPN_SPORT_ENDPOINTS / espnSportPath()
 *        espn.groups      <- buildEspnUrl()'s query string
 *        espn.teamsUrl    <- the ABSOLUTE URL fetchEspnTeamsList() actually requests
 *                            (core v3 host, not the site API root; coordinator ruling 2026-09-30)
 *        rankings         <- ranks fetchByDateRange() actually parses
 *        slate.size       <- buildSuggestedSlate()'s default targetCount
 *        tiebreakerDefault <- createWeek()
 *        glyphKey         <- icons.js ICONS (the real chrome icon must exist)
 *        markets          <- createGame() (no `market` field = spread)
 *        teamAbbr, affinity.catalog     <- TEAM_ABBR, ALMA_MATERS
 *      Where the legacy literal is un-exported and has no seam (summary root in
 *      extra-point.js, TARGET_SLATE_SIZE and the watch title in app.js) it is
 *      pinned by reading that file's TEXT — app.js is never imported here.
 *
 *   Every slot with NO legacy constant is asserted `null` (or, for NFL, the
 *   whole slot). That is deliberate: a later phase that fills one MUST update
 *   this file in the same change, so a value never lands without a golden.
 *
 * DEFERRED (DI-219, merge time): no loadtest.mjs import, no data-model.js
 * re-exports. This file is standalone.
 *
 * Run:  node profiletest.mjs
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ═════════════════════════════════════════════════════════════════════════════
// [0] Zero browser globals at import time (the Edge Function twin)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[0] Importable with NO browser globals (Edge Function twin)…');
assert(typeof globalThis.window === 'undefined' && typeof globalThis.document === 'undefined',
  'precondition: no window / document in this process');
let localStorageProbe = 'absent';
try { if (typeof globalThis.localStorage !== 'undefined') localStorageProbe = 'present'; } catch { localStorageProbe = 'throws'; }
assert(localStorageProbe !== 'present', `precondition: no usable localStorage in this process (${localStorageProbe})`);

let sports, cfbMod, nflMod, dm, dp, leaguesHome;
try {
  sports = await import('./js/sports/index.js');
  cfbMod = await import('./js/sports/cfb.js');
  nflMod = await import('./js/sports/nfl.js');
  assert(true, 'js/sports/index.js, cfb.js, nfl.js import cleanly with no stubs');
} catch (e) {
  assert(false, `sports modules import cleanly with no stubs — ${e.message}`);
  process.exit(1);
}
dm = await import('./js/data-model.js');
dp = await import('./js/data-provider.js');
leaguesHome = await import('./js/leagues-home.js');
const { ICONS } = await import('./js/icons.js');

const { getProfile, listProfiles, normalizeSportKey } = sports;
const { CFB_PROFILE } = cfbMod;
const { NFL_PROFILE } = nflMod;

// The test's OWN copy of dbCode -> legacy ESPN path key, independent of the
// modules under test so a typo inside cfb.js/nfl.js cannot mask itself.
const LEGACY_KEY = { cfb: 'college-football', nfl: 'nfl' };
const R1_DBCODES = ['cfb', 'nfl', 'nba', 'cbb', 'mm', 'nhl', 'wjc'];
const API_ROOT = 'https://site.api.espn.com/apis/site/v2/sports';

function isDeepFrozen(o) {
  if (o === null || typeof o !== 'object') return true;
  if (!Object.isFrozen(o)) return false;
  return Object.values(o).every(isDeepFrozen);
}
function stripComments(src) {
  // Good enough for OUR files: no `//` inside a string literal on an import line.
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');
}
function importSpecifiers(src) {
  const code = stripComments(src);
  const out = [];
  for (const m of code.matchAll(/^\s*import\s[^;]*?from\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  for (const m of code.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm)) out.push(m[1]);
  const dynamic = /\bimport\s*\(|\brequire\s*\(/.test(code);
  return { specs: out, dynamic };
}

// ═════════════════════════════════════════════════════════════════════════════
// [1] Registry behavior
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Registry: getProfile / listProfiles…');
{
  assert(getProfile('cfb') === CFB_PROFILE, "getProfile('cfb') is the cfb profile object");
  assert(getProfile('nfl') === NFL_PROFILE, "getProfile('nfl') is the nfl profile object");
  assert(getProfile('cfb') === getProfile('cfb'), 'getProfile returns the SAME object every call (no per-call copies)');

  const list = listProfiles();
  assert(eq(list.map(p => p.key), ['cfb', 'nfl']), `listProfiles order is registration order: ${list.map(p => p.key).join(',')}`);
  assert(list[0] === CFB_PROFILE && list[1] === NFL_PROFILE, 'listProfiles entries are the registered objects');
  assert(listProfiles() === listProfiles(), 'listProfiles returns a stable reference');
  assert(Object.isFrozen(list), 'listProfiles() array is frozen');
  let threw = false;
  try { list.push({ key: 'evil' }); } catch { threw = true; }
  assert(threw, 'pushing onto listProfiles() throws (registry cannot be extended from outside)');
  assert(getProfile('cfb') === CFB_PROFILE && listProfiles().length === 2, 'registry unchanged after the attempted push');
  assert(new Set(list.map(p => p.key)).size === list.length, 'profile keys are unique');
  assert(list.every(p => R1_DBCODES.includes(p.key)), 'every key is an R1 dbCode (cfb, nfl, nba, cbb, mm, nhl, wjc)');
  assert(!list.some(p => p.key === 'nhlpo'), "'nhlpo' is never minted (R1/R8)");
  assert(!list.some(p => p.key === 'college-football'),
    "no profile is keyed by the legacy ESPN path key ('college-football')");

  // Unknown -> LOUD error, never a default, never a prototype hit.
  const bad = [
    'nba', 'cbb', 'mm', 'nhl', 'wjc',            // R1 codes not registered in Phase 0
    'college-football', 'football/nfl',           // legacy ESPN spelling is NOT a dbCode
    'CFB', ' cfb ', 'cfb\n', 'nhlpo', '',
    undefined, null, 0, 42, {}, [], true,
    'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf',
  ];
  for (const b of bad) {
    let e = null;
    try { getProfile(b); } catch (err) { e = err; }
    assert(e instanceof Error && e.name === 'UnknownSportError' && typeof e.dbCode === 'string',
      `getProfile(${typeof b === 'string' ? JSON.stringify(b) : String(b)}) throws UnknownSportError`);
  }
  {
    let e = null;
    try { getProfile('<img src=x onerror=alert(1)>'.repeat(10)); } catch (err) { e = err; }
    assert(e && e.dbCode.length <= 40, 'the error carries the offending value on .dbCode, truncated to 40 chars');
  }
  {
    let e = null;
    try { getProfile('zzz'); } catch (err) { e = err; }
    assert(e && /zzz/.test(e.message) && /cfb/.test(e.message) && /nfl/.test(e.message),
      'error message names the bad code and the known set');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// [2] Frozen, deeply
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Profiles are DEEPLY frozen…');
{
  for (const p of listProfiles()) {
    assert(isDeepFrozen(p), `${p.key}: every nested object/array is frozen`);
    let t1 = false, t2 = false;
    try { p.label = 'x'; } catch { t1 = true; }
    try { if (p.espn) p.espn.path = 'x'; else throw new TypeError('n/a'); } catch { t2 = true; }
    assert(t1 && t2 && p.label !== 'x', `${p.key}: assigning to a top-level and a nested field throws in strict mode`);
  }
  let t3 = false, t4 = false, t5 = false;
  try { CFB_PROFILE.affinity.allowedKinds.push('x'); } catch { t3 = true; }
  try { CFB_PROFILE.markets.allowed.push('x'); } catch { t4 = true; }
  try { CFB_PROFILE.teamAbbr.Alabama = 'X'; } catch { t5 = true; }
  assert(t3 && t4 && t5, 'cfb: pushing to allowedKinds / markets.allowed and rewriting teamAbbr all throw');
  assert(dm.TEAM_ABBR.Alabama === 'BAMA', 'cfb.teamAbbr is a COPY — freezing it did not freeze the legacy TEAM_ABBR');
  assert(!Object.isFrozen(dm.TEAM_ABBR) && CFB_PROFILE.teamAbbr !== dm.TEAM_ABBR, 'legacy TEAM_ABBR stays mutable and distinct from the profile copy');
  assert(!Object.isFrozen(dm.ESPN_SPORT_ENDPOINTS['college-football']), 'legacy ESPN_SPORT_ENDPOINTS entry was not frozen by reading it');
}

// ═════════════════════════════════════════════════════════════════════════════
// [3] Slot shape
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Slot shape: same top-level slots on every profile…');
{
  const SLOTS = ['affinity', 'code', 'copy', 'deepLink', 'emoji', 'espn', 'feed', 'glyphKey', 'groupings', 'key', 'label',
    'liveDecorators', 'markets', 'periodQuestion', 'primaryMarkets', 'rankings', 'scribeVocab', 'secondHalfFromPeriod',
    'sideContest', 'slate', 'teamAbbr', 'tiebreakerDefault'];
  assert(eq(Object.keys(CFB_PROFILE).sort(), SLOTS), 'cfb has exactly the specified top-level slots');
  assert(eq(Object.keys(NFL_PROFILE).sort(), SLOTS), 'nfl has exactly the same top-level slots as cfb');
  for (const p of listProfiles()) {
    assert(p.feed && p.feed.provider === 'espn' && eq(Object.keys(p.feed).sort(), ['fetchScores', 'fetchSlate', 'fetchSummary', 'provider']),
      `${p.key}: feed = {provider:'espn', fetchSlate, fetchScores, fetchSummary}`);
    assert(eq(Object.keys(p.espn).sort(), ['groups', 'path', 'summaryPath', 'teamsUrl']), `${p.key}: espn = {path, summaryPath, teamsUrl, groups} (teamsUrl is absolute; the old relative teamsPath is gone)`);
    assert(!('period' in p), `${p.key}: NO period slot (R5/R9 — period kind derives from competition.kind, DI-223)`);
    assert(eq(Object.keys(p.markets).sort(), ['allowed', 'default', 'rotate']), `${p.key}: markets = {allowed, default, rotate}`);
  }
  // N8 (DI-439 §2, 2026-09-29) — `secondHalfFromPeriod: integer | null`, an IN-GAME period
  // (the first one that is "the second half"; football Q3). NOT the excluded competition
  // `period` slot asserted absent above. Football is 3 on both profiles; the other five
  // sports' values live in js/scribe-scoring.js's interim table until their phases land, and
  // liveupsettest.mjs pins that table to these profile values.
  for (const p of listProfiles()) {
    assert(Number.isInteger(p.secondHalfFromPeriod) && p.secondHalfFromPeriod >= 1,
      `${p.key}: secondHalfFromPeriod is a positive integer (null is reserved for hockey, which has no profile yet)`);
  }
  assert(CFB_PROFILE.secondHalfFromPeriod === 3 && NFL_PROFILE.secondHalfFromPeriod === 3,
    'cfb and nfl: the second half starts in period 3 (Q3)');
  assert(eq(Object.keys(CFB_PROFILE.affinity).sort(), ['allowedKinds', 'catalog', 'isAffinityGame', 'kind', 'tiebreakerTotal', 'watch', 'watchTitle']),
    'cfb.affinity = {kind, allowedKinds, watch, watchTitle, catalog, isAffinityGame, tiebreakerTotal}');
  assert(eq(Object.keys(CFB_PROFILE.rankings).sort(), ['max', 'normalize']), 'cfb.rankings = {max, normalize}');
  assert(eq(Object.keys(CFB_PROFILE.slate).sort(), ['anchorDays', 'candidateSize', 'size', 'timeWindow', 'weights']),
    'cfb.slate = {size, candidateSize, weights, anchorDays, timeWindow}');
  assert(eq(Object.keys(CFB_PROFILE.tiebreakerDefault).sort(), ['calcMode', 'question', 'type']), 'cfb.tiebreakerDefault = {type, question, calcMode}');
}

// ═════════════════════════════════════════════════════════════════════════════
// [4] Golden equality — identity + ESPN endpoints
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Golden: identity + ESPN endpoints equal the legacy constants…');
{
  for (const p of listProfiles()) {
    const legacyKey = LEGACY_KEY[p.key];
    const legacy = dm.ESPN_SPORT_ENDPOINTS[legacyKey];
    assert(!!legacy, `${p.key}: legacy ESPN_SPORT_ENDPOINTS['${legacyKey}'] exists`);
    assert(p.label === legacy.label, `${p.key}.label === ESPN_SPORT_ENDPOINTS['${legacyKey}'].label ("${p.label}")`);
    assert(p.code === legacy.code, `${p.key}.code === ESPN_SPORT_ENDPOINTS['${legacyKey}'].code ("${p.code}")`);
    assert(p.espn.path === legacy.path, `${p.key}.espn.path === ESPN_SPORT_ENDPOINTS['${legacyKey}'].path ("${p.espn.path}")`);
    assert(p.espn.path === dm.espnSportPath(legacyKey), `${p.key}.espn.path === espnSportPath('${legacyKey}')`);
    assert(p.emoji === '🏈', `${p.key}.emoji is 🏈 (non-chrome text only)`);
    assert(p.glyphKey === 'sportFootball', `${p.key}.glyphKey is 'sportFootball'`);
    assert(typeof ICONS[p.glyphKey] === 'string' && ICONS[p.glyphKey].startsWith('<svg'),
      `${p.key}.glyphKey resolves to a real inline-SVG icon in icons.js ICONS`);
    assert(!/\p{Extended_Pictographic}/u.test(p.glyphKey), `${p.key}.glyphKey is an icon key, never an emoji`);
  }
  const lhSrc = await readFile(join(HERE, 'js/leagues-home.js'), 'utf8');
  assert(/'sportFootball'/.test(lhSrc), "anchor: js/leagues-home.js uses the same 'sportFootball' key for its sport cards");
  assert(CFB_PROFILE.label === 'College Football' && CFB_PROFILE.code === 'CFB' && CFB_PROFILE.espn.path === 'football/college-football',
    'cfb literals: College Football / CFB / football/college-football');
  assert(NFL_PROFILE.label === 'NFL' && NFL_PROFILE.code === 'NFL' && NFL_PROFILE.espn.path === 'football/nfl',
    'nfl literals: NFL / NFL / football/nfl');

  // Scoreboard URL — through the REAL buildEspnUrl().
  for (const p of listProfiles()) {
    const u = new URL(dp.buildEspnUrl({ sport: LEGACY_KEY[p.key] }));
    assert(`${u.origin}${u.pathname}` === `${API_ROOT}/${p.espn.path}/scoreboard`,
      `${p.key}: buildEspnUrl() scoreboard path === ${API_ROOT}/<espn.path>/scoreboard`);
    assert(u.searchParams.get('limit') === '200', `${p.key}: buildEspnUrl() sends limit=200`);
    if (p.espn.groups === null) {
      assert(!u.searchParams.has('groups'), `${p.key}: espn.groups is null AND buildEspnUrl() sends no groups param`);
    } else {
      assert(u.searchParams.get('groups') === p.espn.groups, `${p.key}: espn.groups ("${p.espn.groups}") === buildEspnUrl()'s groups param`);
    }
  }
  assert(CFB_PROFILE.espn.groups === '80', "cfb.espn.groups is '80' (FBS filter)");
  assert(dp.buildEspnUrl({}) === dp.buildEspnUrl({ sport: 'college-football' }), 'legacy default sport is college-football, the cfb profile');

  // Teams catalog URL — the URL fetchEspnTeamsList() ACTUALLY requests.
  const realFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ sports: [{ leagues: [{ teams: [] }] }] }) }; };
  try { await dp.fetchEspnTeamsList(); } finally { globalThis.fetch = realFetch; }
  // The profile field is ABSOLUTE (coordinator ruling 2026-09-30): the catalog lives on the core v3
  // host, which the site-API-relative `teamsPath` this replaced could not describe (RG-TBD-B3 moved
  // the request there; the old form was red on the merged tree). Compared verbatim, no prefix.
  assert(urls.length >= 1 && urls[0] === CFB_PROFILE.espn.teamsUrl,
    `cfb.espn.teamsUrl === the URL fetchEspnTeamsList() requests (${urls[0]})`);
  {
    const u = new URL(CFB_PROFILE.espn.teamsUrl);
    assert(u.protocol === 'https:' && u.origin !== new URL(API_ROOT).origin,
      `cfb.espn.teamsUrl is an absolute https URL on the core v3 host (${u.origin}), NOT the site API root (${new URL(API_ROOT).origin})`);
  }
  // NFL: the app requests NO NFL teams catalog. Proven, not assumed: fetchEspnTeamsList() takes no sport
  // argument, so an NFL-shaped call still requests the CFB URL. If a later phase gives it a sport
  // parameter, this goes red and nfl.espn.teamsUrl MUST be filled with what the app then requests.
  urls.length = 0;
  globalThis.fetch = async (url) => { urls.push(String(url)); return { ok: true, json: async () => ({ sports: [{ leagues: [{ teams: [] }] }] }) }; };
  try { await dp.fetchEspnTeamsList({ sport: 'nfl' }); await dp.fetchEspnTeamsList('nfl'); } finally { globalThis.fetch = realFetch; }
  assert(urls.length >= 2 && urls.every((x) => x === CFB_PROFILE.espn.teamsUrl),
    `fetchEspnTeamsList() has no sport parameter: NFL-shaped calls still request only the CFB URL (${JSON.stringify(urls)})`);
  assert(NFL_PROFILE.espn.teamsUrl === null,
    'nfl.espn.teamsUrl is null — the app requests no NFL teams catalog (the assertion above proves it); DI-227 probes it');

  // Summary root — un-exported literal in extra-point.js, no seam: pin its text.
  const ep = await readFile(join(HERE, 'js/extra-point.js'), 'utf8');
  const m = ep.match(/const SUMMARY_ROOT\s*=\s*'([^']+)'/);
  assert(!!m, 'anchor: found `const SUMMARY_ROOT = ...` in js/extra-point.js');
  assert(m && m[1] === `${API_ROOT}/${CFB_PROFILE.espn.summaryPath}`, `cfb.espn.summaryPath === extra-point.js SUMMARY_ROOT (${m && m[1]})`);
  assert(NFL_PROFILE.espn.summaryPath === null, 'nfl.espn.summaryPath is null (extra-point.js summary root is CFB-only today)');
}

// ═════════════════════════════════════════════════════════════════════════════
// [5] Golden equality — rankings, through the real parse path
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Golden: cfb.rankings agrees with the ranks fetchByDateRange() really parses…');
{
  const raws = [1, 2, 10, 24, 25, 26, 99, 100, 0, -1, '7', '25', '26', '0', 'abc', '', null, undefined, 3.9, 25.9, NaN];
  const events = raws.map((v, i) => ({
    id: String(9000 + i), date: '2026-09-05T18:00:00Z',
    status: { type: { name: 'STATUS_SCHEDULED', detail: '2:00 PM ET' } },
    competitions: [{
      id: String(9000 + i), neutralSite: false,
      competitors: [
        { homeAway: 'home', team: { location: `RH${i}`, name: 'Team', abbreviation: `H${i}` }, score: null, curatedRank: { current: v } },
        { homeAway: 'away', team: { location: `RA${i}`, name: 'Team', abbreviation: `A${i}` }, score: null, curatedRank: { current: v } },
      ],
      odds: [],
    }],
  }));
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
  let result;
  try { result = await dp.fetchByDateRange({ startDate: '2026-09-05', endDate: '2026-09-05' }); }
  finally { globalThis.fetch = realFetch; }
  assert(result.error === null && result.games.length === raws.length, `fixture check: all ${raws.length} events parsed (games=${result.games.length})`);
  const byId = new Map(result.games.map(g => [g.espnEventId, g]));
  const { normalize, max } = CFB_PROFILE.rankings;
  let allAgree = true;
  raws.forEach((v, i) => {
    const g = byId.get(String(9000 + i));
    const legacy = g ? g.homeRank : 'MISSING';
    const mine = normalize(v);
    const agree = g && legacy === mine && g.awayRank === mine;
    if (!agree) allAgree = false;
    assert(agree, `rank ${typeof v === 'string' ? JSON.stringify(v) : String(v)}: legacy parse -> ${legacy}, profile.normalize -> ${mine}`);
  });
  assert(allAgree, 'normalize() agrees with the legacy parse for every fixture value');
  assert(max === 25, 'rankings.max is 25');
  assert(normalize(max) === max && normalize(max + 1) === null && normalize(1) === 1 && normalize(0) === null,
    'the max is the real boundary: max -> max, max+1 -> null, 1 -> 1, 0 -> null');
  assert(byId.get("9004")?.homeRank === 25 && byId.get("9005")?.homeRank === null,
    'anchor: the REAL parse keeps 25 and drops 26 (so max=25 is proven against legacy, not against this test)');
  assert(NFL_PROFILE.rankings === null, 'nfl.rankings is null (NFL payloads carry no curatedRank; DI-228: none)');
}

// ═════════════════════════════════════════════════════════════════════════════
// [6] Golden equality — markets, tiebreaker default, slate, affinity, abbreviations
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Golden: markets / tiebreaker / slate / affinity / abbreviations…');
{
  // markets <- createGame() has no `market`; absent = spread
  const g = dm.createGame('w_profiletest');
  assert(!('market' in g), 'legacy createGame() carries no `market` field (absent = spread)');
  for (const p of listProfiles()) {
    assert(eq(p.markets.allowed, ['spread']) && p.markets.default === 'spread', `${p.key}.markets = spread only, default spread`);
  }

  // tiebreakerDefault <- createWeek()
  const w = dm.createWeek(2026, 1);
  const tb = CFB_PROFILE.tiebreakerDefault;
  assert(tb.type === w.tiebreakerType, `cfb.tiebreakerDefault.type === createWeek().tiebreakerType ("${tb.type}")`);
  assert(tb.question === w.tiebreakerQuestion, 'cfb.tiebreakerDefault.question === createWeek().tiebreakerQuestion');
  assert(tb.calcMode === w.tiebreakerCalculationMode, `cfb.tiebreakerDefault.calcMode === createWeek().tiebreakerCalculationMode ("${tb.calcMode}")`);
  assert(tb.type === 'almaMaterTotal' && tb.calcMode === 'selectedSlateOnly', 'cfb tiebreaker literals: almaMaterTotal / selectedSlateOnly');
  assert(NFL_PROFILE.tiebreakerDefault === null, 'nfl.tiebreakerDefault is null (DI-228: MNF total; today an NFL week gets createWeek()\'s default)');

  // slate.size <- buildSuggestedSlate()'s default targetCount, and app.js's TARGET_SLATE_SIZE
  const scored = [];
  for (let i = 0; i < 20; i++) {
    scored.push({
      homeTeam: `SH${i}`, awayTeam: `SA${i}`, isAlmaMaterGame: false, timeWindow: 'afternoon',
      kickoff: `2026-09-05T${String(12 + (i % 8)).padStart(2, '0')}:00:00Z`, _score: 100 - i,
    });
  }
  const dflt = dp.buildSuggestedSlate(scored).slate.length;
  assert(dflt === CFB_PROFILE.slate.size, `cfb.slate.size (${CFB_PROFILE.slate.size}) === buildSuggestedSlate() default slate length (${dflt})`);
  assert(dp.buildSuggestedSlate(scored, 7).slate.length === 7, 'anchor: buildSuggestedSlate honors an explicit count, so 10 above is the DEFAULT, not a coincidence');
  const appSrc = await readFile(join(HERE, 'js/app.js'), 'utf8');
  const ts = appSrc.match(/const TARGET_SLATE_SIZE\s*=\s*(\d+)/);
  assert(!!ts && Number(ts[1]) === CFB_PROFILE.slate.size, `cfb.slate.size === app.js TARGET_SLATE_SIZE (${ts && ts[1]})`);

  // affinity
  const a = CFB_PROFILE.affinity;
  // N1 (coordinator ruling 2026-09-30): the six-school list is pilot-only in code. catalog(league) is the PILOT's six for the pilot and [] for anyone else.
  const pilotSix = dm.getAlmaMaters({ pilot: true });
  assert(eq(a.catalog({ pilot: true }), pilotSix) && a.catalog({ pilot: true }) !== pilotSix, 'cfb.affinity.catalog(pilot) deep-equals the pilot list and is a copy');
  a.catalog({ pilot: true }).push('X');
  assert(!dm.getAlmaMaters({ pilot: true }).includes('X'), 'mutating the returned catalog cannot touch the private list');
  assert(eq(a.catalog({ pilot: false }), []) && eq(a.catalog(null), []) && eq(a.catalog({}), []), 'cfb.affinity.catalog() for a non-pilot / unknown league is [] — never the six schools');
  assert(a.kind === 'alma_mater' && eq(a.allowedKinds, ['alma_mater']), "cfb.affinity kind/allowedKinds = alma_mater (CFB's group is fixed, no picker)");
  assert(a.watch === 'straightUp', "cfb.affinity.watch is 'straightUp' (Alma Mater Watch is NEVER ATS)");
  assert(/Alma Mater Watch<\/span>/.test(appSrc) && a.watchTitle === 'Alma Mater Watch', "cfb.affinity.watchTitle === the title app.js renders ('Alma Mater Watch')");
  assert(NFL_PROFILE.affinity === null, 'nfl.affinity is null (DI-226/228 supplies favorite team / hometown)');

  // teamAbbr <- TEAM_ABBR
  assert(eq(CFB_PROFILE.teamAbbr, dm.TEAM_ABBR), `cfb.teamAbbr deep-equals TEAM_ABBR (${Object.keys(dm.TEAM_ABBR).length} entries)`);
  assert(Object.keys(dm.TEAM_ABBR).length > 100, 'anchor: TEAM_ABBR is non-trivial, so the deep-equal above is not vacuous');
  assert(NFL_PROFILE.teamAbbr === null, 'nfl.teamAbbr is null');
}

// ═════════════════════════════════════════════════════════════════════════════
// [7] UNSPECIFIED slots stay null until a DI fills them
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Slots with no legacy constant are null (R6: groupings stays null until merge)…');
{
  const get = (o, path) => path.split('.').reduce((x, k) => (x == null ? x : x[k]), o);
  const CFB_NULL = ['copy', 'feed.fetchSlate', 'feed.fetchScores', 'feed.fetchSummary', 'markets.rotate',
    'affinity.isAffinityGame', 'affinity.tiebreakerTotal', 'groupings', 'slate.candidateSize', 'slate.weights',
    'slate.anchorDays', 'slate.timeWindow', 'sideContest', 'liveDecorators', 'scribeVocab', 'deepLink',
    'primaryMarkets', 'periodQuestion'];
  const NFL_NULL = ['copy', 'feed.fetchSlate', 'feed.fetchScores', 'feed.fetchSummary', 'espn.summaryPath', 'espn.teamsUrl', 'espn.groups',
    'markets.rotate', 'affinity', 'groupings', 'rankings', 'slate', 'sideContest', 'tiebreakerDefault',
    'liveDecorators', 'teamAbbr', 'scribeVocab', 'deepLink', 'primaryMarkets', 'periodQuestion'];
  for (const path of CFB_NULL) assert(get(CFB_PROFILE, path) === null, `cfb.${path} is null`);
  for (const path of NFL_NULL) assert(get(NFL_PROFILE, path) === null, `nfl.${path} is null`);
  assert(CFB_PROFILE.groupings === null && NFL_PROFILE.groupings === null, 'R6: groupings is null on every profile');
}

// ═════════════════════════════════════════════════════════════════════════════
// [8] normalizeSportKey — independent copy, golden-tested against leagues-home.js
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] normalizeSportKey agrees with js/leagues-home.js (two independent copies, R7)…');
{
  const inputs = ['cfb', 'nfl', 'college-football', ' cfb ', '\tnfl\n', '', '   ', null, undefined, 42, {}, [], true,
    'nba', 'cbb', 'mm', 'nhl', 'wjc', 'CFB', 'nhlpo', 'football/nfl', 'zzz'];
  for (const k of inputs) {
    const mine = normalizeSportKey(k), theirs = leaguesHome.normalizeSportKey(k);
    assert(mine === theirs, `normalizeSportKey(${typeof k === 'string' ? JSON.stringify(k) : String(k)}) -> ${JSON.stringify(mine)} agrees with leagues-home (${JSON.stringify(theirs)})`);
  }
  assert(normalizeSportKey('cfb') === 'college-football' && normalizeSportKey('nfl') === 'nfl', 'db code -> ESPN key: cfb -> college-football, nfl -> nfl');
  assert(listProfiles().every(p => dm.ESPN_SPORT_ENDPOINTS[normalizeSportKey(p.key)]), 'every registered profile key normalizes to a real ESPN_SPORT_ENDPOINTS key');
  assert(listProfiles().every(p => normalizeSportKey(p.key) === LEGACY_KEY[p.key]), "normalizeSportKey(profile.key) is the profile's legacy ESPN key");
  // The ONE deliberate divergence: leagues-home resolves prototype names to Object.prototype members.
  assert(normalizeSportKey('constructor') === 'constructor' && normalizeSportKey('__proto__') === '__proto__' && normalizeSportKey('toString') === 'toString',
    "prototype names pass through as themselves (own-property lookup) — the deliberate improvement over leagues-home's copy");
}

// ═════════════════════════════════════════════════════════════════════════════
// [9] Import discipline (R6)
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] Import discipline: never app.js, Edge-importable, no cycle back into data-model…');
{
  const ALLOWED = {
    'index.js': ['./cfb.js', './nfl.js'],
    'cfb.js': ['../data-model.js'],
    'nfl.js': ['../data-model.js'],
  };
  for (const [file, allowed] of Object.entries(ALLOWED)) {
    const src = await readFile(join(HERE, 'js/sports', file), 'utf8');
    const { specs, dynamic } = importSpecifiers(src);
    assert(specs.length > 0, `anchor: the import scan found imports in js/sports/${file} (${specs.join(', ')})`);
    assert(specs.every(s => allowed.includes(s)) && allowed.every(s => specs.includes(s)),
      `js/sports/${file} imports exactly ${JSON.stringify(allowed)}`);
    assert(!specs.some(s => /app\.js|storage\.js|auth|supabase|scoring\.js|data-provider\.js/.test(s)), `js/sports/${file} never imports app.js / storage / auth / supabase / scoring / data-provider`);
    assert(!dynamic, `js/sports/${file} has no dynamic import()/require()`);
    const code = stripComments(src);
    assert(!/\b(window|document|localStorage|sessionStorage|navigator)\b/.test(code), `js/sports/${file} touches no browser global in code`);
  }
  // Canaries: the scan is neither vacuous nor blind.
  const canary = importSpecifiers(`// import x from './app.js'\nimport { a } from './app.js';\nconst z = await import('./y.js');`);
  assert(eq(canary.specs, ['./app.js']) && canary.dynamic === true, 'canary: the scan sees a real import of app.js, ignores a commented one, and flags a dynamic import()');
  // data-model.js must not import js/sports/* (DI-224 rev 3: that closes the cycle).
  const dmSrc = await readFile(join(HERE, 'js/data-model.js'), 'utf8');
  // N1 (coordinator ruling 2026-09-30): data-model.js gained EXACTLY ONE import, ./pilot-only.js (the six-school list is pilot-only in code). That closes no cycle: pilot-only.js
  // imports roles.js and nothing else, and roles.js imports nothing — neither can reach data-model.js or js/sports/*. Pinned as an exact set, so a second import fails here.
  const dmImports = importSpecifiers(dmSrc);
  assert(eq(dmImports.specs, ['./pilot-only.js']) && dmImports.dynamic === false, 'data-model.js imports ONLY ./pilot-only.js (so sports/* -> data-model.js can never be a cycle)');
  const poImports = importSpecifiers(await readFile(join(HERE, 'js/pilot-only.js'), 'utf8'));
  const rolesImports = importSpecifiers(await readFile(join(HERE, 'js/roles.js'), 'utf8'));
  assert(eq(poImports.specs, ['./roles.js']) && rolesImports.specs.length === 0, "…and pilot-only.js's whole import chain is roles.js, which imports nothing — no path back to data-model.js or sports/*");
}

// ═════════════════════════════════════════════════════════════════════════════
console.log(`\n[profiletest] ${pass} passed, ${fail} failed`);
if (fail === 0) console.log('✅ profiletest: every profile value equals its legacy constant; registry behaves');
else console.error(`❌ profiletest: ${fail} failure(s)`);

process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
// Backstop (same reasoning as slatetest.mjs's F-6): a stuck flush must not hang a sweep.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
