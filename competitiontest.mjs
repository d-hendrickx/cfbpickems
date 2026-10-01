/**
 * CFB Pickems — competitiontest.mjs
 * ==================================
 * Thread "091926-MULTISPORT", Phase 1a — built to docs/DESIGN_INPUTS_MULTISPORT_CORE.md Revision 5:
 * DI-220 (competition data model, AD-74) §2, DI-224's read functions (AD-75) §5 and DI-225 (settings
 * inheritance, AD-79) §6. Standalone, beside the other suites; spawned by loadtest.mjs.
 *
 * Run:  node competitiontest.mjs
 *       for tz in UTC America/Los_Angeles; do TZ=$tz node competitiontest.mjs; done
 *
 *   [0]  Structure — the exported API is the DI's; js/competition.js reads and never writes (only the
 *        commissioner-only saveCompetition delegates a write); the storage.js functions the DIs say stay
 *        BYTE-IDENTICAL (getCurrentWeek, saveWeek, deleteWeek) are pinned by their exact source text.
 *   [1]  PRE-BACKFILL — zero competition rows: the DI's three rules keep a CFB-only league byte-identical
 *        (§2/§5); no getter ever seeds a row.
 *   [2]  getCompetitions — default first, then createdAt ascending; league-filtered; a NEW array.
 *   [3]  competitionForWeek / profileForWeek — R1: NULL competitionId is the default; a dangling id is null.
 *   [4]  getWeeksForCompetition — read-only, a NEW array, exact membership.
 *   [5]  getCurrentWeekFor — §7's matrix (a)-(d): deep-equals getCurrentWeek() single-competition; scoped
 *        pointer/step-2/step-3 with two competitions; a pointer at another competition's week is refused.
 *   [6]  getAllCurrentWeeks — pre-backfill, the default ALWAYS included (offseason), others only while live.
 *   [7]  getLiveSports — R7's derivation, N = 3 days at both edges; archived excluded; unregistered sport lists.
 *   [8]  getEffectiveSetting — the R2 sources, the ALLOW-LIST (DI-225's fifth assertion), the week tier.
 *   [9]  DI-220's top risk — saveWeek/deleteWeek stay on the raw unfiltered array (the adapter-planner half
 *        of this proof, "saving a week in competition B emits zero deletes for A", is adaptertest [A-MS]).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

// ── stubs (grouptest.mjs's shape — only what storage.js/auth.js need to import cleanly) ─────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in competitiontest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const storage = await import('./js/storage.js');
const comp = await import('./js/competition.js');
const { DEFAULT_SETTINGS } = await import('./js/data-model.js');
const { getWeeks, saveWeek, deleteWeek, saveSetting, getCurrentWeek } = storage;
const {
  getCompetitions, getCompetition, getDefaultCompetition, saveCompetition, competitionForWeek, profileForWeek,
  getWeeksForCompetition, getCurrentWeekFor, getAllCurrentWeeks, getLiveSports, getEffectiveSetting,
  COMPETITION_OVERRIDABLE_KEYS, LIVE_SPORT_LOOKAHEAD_DAYS, SETTING_SOURCES,
} = comp;

const LEAGUE = 'L-test-0001';
const ACTIVE_LEAGUE_KEY = 'cfbp_supabase_active_league';      // js/auth.js ACTIVE_LEAGUE_KEY (test-only literal)
const KEY_COMPETITIONS = 'cfbp_competitions';
const KEY_WEEKS = 'cfbp_weeks';
const KEY_SETTINGS = 'cfbp_settings';
const KEY_ACTIVE_WEEK = 'cfbp_active_week';

function reset({ league = LEAGUE } = {}) {
  store.clear();
  if (league) localStorage.setItem(ACTIVE_LEAGUE_KEY, league);
}
const wk = (weekId, extra = {}) => ({ weekId, weekNumber: 1, status: 'draft', startDate: '', endDate: '', ...extra });
const put = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const ids = (a) => a.map((w) => w.weekId);

const CID = {
  D: '11111111-1111-4111-8111-111111111111',   // the stored default (cfb)
  N: '22222222-2222-4222-8222-222222222222',   // an NFL season
  S: '33333333-3333-4333-8333-333333333333',   // an NHL season (no registered profile)
};
const C = {
  D: { id: CID.D, sport: 'cfb', kind: 'season', enrollment: 'all', isDefault: true, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-01-01T00:00:00.000Z' },
  N: { id: CID.N, sport: 'nfl', kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: 'wn2', settings: {}, createdAt: '2026-02-01T00:00:00.000Z' },
  S: { id: CID.S, sport: 'nhl', kind: 'season', enrollment: 'all', isDefault: false, archivedAt: null, activeWeekId: null, settings: {}, createdAt: '2026-03-01T00:00:00.000Z' },
};

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[0] Structure — the DI\'s API; reads never write; three storage.js functions stay byte-identical…');
{
  const src = await readFile(join(HERE, 'js', 'competition.js'), 'utf8');
  const noComments = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  const imports = [...noComments.matchAll(/from '([^']+)'/g)].map((m) => m[1]).sort();
  assert(eq(imports, ['./auth.js', './data-model.js', './sports/index.js', './storage.js']),
    `[0a] imports exactly storage.js, auth.js, data-model.js and sports/index.js (got ${JSON.stringify(imports)}) — never app.js, chat, scoring`);
  const exported = [...noComments.matchAll(/^export (?:function|const) (\w+)/gm)].map((m) => m[1]).sort();
  assert(eq(exported, ['COMPETITION_OVERRIDABLE_KEYS', 'LIVE_SPORT_LOOKAHEAD_DAYS', 'SETTING_SOURCES', 'competitionForWeek', 'getAllCurrentWeeks',
    'getCompetition', 'getCompetitions', 'getCurrentWeekFor', 'getDefaultCompetition', 'getEffectiveSetting', 'getLiveSports',
    'getWeeksForCompetition', 'profileForWeek', 'saveCompetition']),
    `[0b] the exported API is exactly Revision 5's client API (+ the three constants) — got ${JSON.stringify(exported)}`);
  // Every write in this module is the ONE exported saveCompetition delegating to the storage seam.
  const withoutSave = noComments.replace(/export function saveCompetition\([^)]*\) \{[\s\S]*?\n\}\n/, '');
  assert(withoutSave !== noComments && !/\bsave[A-Za-z]*\(|\bdelete[A-Z][A-Za-z]*\(|localStorage|setItem|removeItem/.test(withoutSave),
    '[0c] outside the one commissioner-only saveCompetition() there is no write call, no localStorage, no storage mutation anywhere in js/competition.js');
  assert(!/leagues-home/.test(noComments), '[0d] never imports js/leagues-home.js');
  // The DI returns getWeeks() itself pre-backfill; in supabase mode that is the MIRROR'S OWN array (sb.get()
  // hands it out by reference), which a caller could then mutate. A local-mode test cannot see the difference
  // (load() re-parses every call), so it is pinned in the source: the pre-backfill answer is always a copy.
  assert(/if \(getCompetitions\(leagueId\)\.length === 0\) return competitionId \? \[\] : getWeeks\(\)\.slice\(\);/.test(noComments),
    '[0d2] getWeeksForCompetition\'s pre-backfill answer is getWeeks().slice() — a COPY, never the mirror\'s own array');

  const stor = await readFile(join(HERE, 'js', 'storage.js'), 'utf8');
  const GOLD_CURRENT = `export function getCurrentWeek(){
  const activeId=getActiveWeekId();
  if(activeId){ const f=getWeeks().find(w=>w.weekId===activeId); if(f)return f; }
  const weeks=getWeeks();
  const active=weeks.find(w=>['open','locked','live'].includes(w.status));
  if(active)return active;
  return[...weeks].sort((a,b)=>b.weekNumber-a.weekNumber)[0]||null;
}`;
  assert(stor.includes(GOLD_CURRENT), '[0e] getCurrentWeek() in storage.js is BYTE-IDENTICAL to its pre-multi-sport text (AD-75)');
  const GOLD_SAVE = `export function saveWeek(week){
  const weeks=getWeeks();
  const idx=weeks.findIndex(w=>w.weekId===week.weekId);
  const upd={...week,updatedAt:new Date().toISOString()};
  if(idx>=0)weeks[idx]=upd;else weeks.push(upd);
  save(KEYS.WEEKS,weeks);
}
export function deleteWeek(weekId){ save(KEYS.WEEKS,getWeeks().filter(w=>w.weekId!==weekId)); }`;
  assert(stor.includes(GOLD_SAVE), '[0f] saveWeek()/deleteWeek() in storage.js are BYTE-IDENTICAL: both read and write the RAW getWeeks() array');
  assert(!/getWeeksForCompetition/.test(stor.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')),
    '[0g] storage.js never calls getWeeksForCompetition — the competition-scoped view cannot feed a seam write');

  assert(COMPETITION_OVERRIDABLE_KEYS.length === 5 && Object.isFrozen(COMPETITION_OVERRIDABLE_KEYS)
    && eq([...COMPETITION_OVERRIDABLE_KEYS].sort(), ['candidateGameCount', 'season', 'seasonPrize', 'weeklyGameCount', 'weeklyPrize']),
    '[0h] the competition allow-list is FROZEN and is exactly the five UI-facing keys (no reminderCadence, no serverJobs.*)');
  assert(eq([...SETTING_SOURCES], ['default', 'league', 'competition', 'week']), '[0i] the source enum is R2\'s: default | league | competition | week');
  assert(LIVE_SPORT_LOOKAHEAD_DAYS === 3, '[0j] R7\'s N = 3 days');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] PRE-BACKFILL (zero competition rows) — today\'s behaviour, exactly; no getter seeds a row…');
{
  reset();
  assert(eq(getCompetitions(), []) && getDefaultCompetition() === null, '[1a] no rows -> getCompetitions() is [] and getDefaultCompetition() is NULL (no virtual default is invented)');
  assert(competitionForWeek(wk('w1')) === null && competitionForWeek(null) === null, '[1b] competitionForWeek is null for every week pre-backfill');
  assert(profileForWeek(wk('w1')).key === 'cfb', '[1c] …so profileForWeek() is the cfb profile (`comp?.sport || \'cfb\'`): every week is cfb pre-backfill');
  assert(getCompetition(LEAGUE, CID.D) === null && getCompetition(LEAGUE, null) === null, '[1d] getCompetition on a missing id / no id is null');
  assert(eq(getLiveSports(), []), '[1e] getLiveSports() is [] with no competition rows (the DI\'s own definition)');

  // Fixture matrix — with weeks in every state, the pre-backfill answers ARE today's answers.
  const weeks = [wk('w1', { status: 'final', weekNumber: 1 }), wk('w2', { status: 'open', weekNumber: 2 }), wk('w3', { status: 'draft', weekNumber: 3 })];
  put(KEY_WEEKS, weeks); put(KEY_ACTIVE_WEEK, 'w1');
  assert(eq(getWeeksForCompetition(null), getWeeks()) && eq(getWeeksForCompetition(), getWeeks()), '[1f] getWeeksForCompetition(null) is every week, in order');
  assert(getWeeksForCompetition(null) !== getWeeksForCompetition(null), '[1g] …and always a NEW array (never the mirror\'s own)');
  assert(eq(getWeeksForCompetition(CID.N), []), '[1h] an explicit competition id pre-backfill -> []');
  assert(eq(getCurrentWeekFor(null), getCurrentWeek()) && getCurrentWeekFor().weekId === 'w1', '[1i] getCurrentWeekFor(null) deep-equals getCurrentWeek()');
  assert(getCurrentWeekFor(CID.N) === null, '[1j] getCurrentWeekFor(<explicit id>) is null pre-backfill');
  assert(eq(getAllCurrentWeeks(), [getCurrentWeek()].filter(Boolean)), '[1k] getAllCurrentWeeks() deep-equals [getCurrentWeek()] (exactly today\'s single week)');
  reset();
  assert(eq(getAllCurrentWeeks(), []) && getCurrentWeekFor(null) === null && eq(getWeeksForCompetition(null), []),
    '[1l] no weeks at all: getAllCurrentWeeks() [], getCurrentWeekFor(null) null, getWeeksForCompetition(null) []');

  reset(); put(KEY_WEEKS, weeks);
  getAllCurrentWeeks(); getLiveSports(); getWeeksForCompetition(null); profileForWeek(wk('w1')); getEffectiveSetting('weeklyGameCount'); getCurrentWeekFor(null);
  assert(eq([...store.keys()].sort(), [ACTIVE_LEAGUE_KEY, KEY_WEEKS].sort()) && !store.has(KEY_COMPETITIONS),
    `[1m] after every read function ran, the store holds only what the test put there — cfbp_competitions was never written (${JSON.stringify([...store.keys()])})`);
  reset({ league: null });
  assert(getDefaultCompetition() === null && eq(getCompetitions(), []), '[1n] with no active league (local mode) the same pre-backfill answers hold');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] getCompetitions — default first, then createdAt ascending; league-filtered; a NEW array…');
{
  reset();
  put(KEY_COMPETITIONS, [C.N, C.S, C.D]);
  assert(eq(getCompetitions().map((c) => c.id), [CID.D, CID.N, CID.S]), '[2a] default first, then createdAt ascending (stored order was N, S, D)');
  assert(eq(getCompetitions(LEAGUE).map((c) => c.id), [CID.D, CID.N, CID.S]), '[2b] an explicit league id equal to the active one is the same answer');
  assert(eq(getCompetitions('some-other-league'), []), '[2c] a league that is not the loaded one answers [] — never another league\'s rows');
  const a = getCompetitions(); a.length = 0;
  assert(getCompetitions().length === 3, '[2d] mutating the returned array never touches storage');
  put(KEY_COMPETITIONS, [{ ...C.S, createdAt: '2026-01-05T00:00:00.000Z' }, { ...C.N, createdAt: '2026-01-04T00:00:00.000Z' }]);
  assert(eq(getCompetitions().map((c) => c.id), [CID.N, CID.S]), '[2e] with no default, createdAt ascending decides');
  assert(getDefaultCompetition() === null, '[2f] …and getDefaultCompetition() is null (rows exist but none is the default)');
  put(KEY_COMPETITIONS, [C.D, C.N]);
  assert(getDefaultCompetition().id === CID.D && getCompetition(LEAGUE, CID.N).sport === 'nfl' && getCompetition('other', CID.N) === null,
    '[2g] getDefaultCompetition / getCompetition(league, id) resolve; a foreign league resolves null');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] competitionForWeek / profileForWeek — R1: NULL competitionId is the default, resolved ONLY here…');
{
  reset();
  put(KEY_COMPETITIONS, [C.D, C.N]);
  assert(competitionForWeek(wk('w1')).id === CID.D, '[3a] a week with no competitionId -> the default competition');
  assert(competitionForWeek(wk('w1', { competitionId: null })).id === CID.D, '[3b] …and an explicit null is the same');
  assert(competitionForWeek(wk('wn', { competitionId: CID.N })).sport === 'nfl', '[3c] a week with a competitionId -> that competition');
  assert(competitionForWeek(wk('wx', { competitionId: 'no-such-competition' })) === null,
    '[3d] a DANGLING competitionId is null — never silently the default (that would relabel another sport\'s week)');
  assert(competitionForWeek(null).id === CID.D && competitionForWeek(undefined).id === CID.D, '[3e] a missing week resolves to the default rather than throwing');
  assert(profileForWeek(wk('w1')).key === 'cfb', '[3f] profileForWeek(default week) is the cfb profile');
  assert(profileForWeek(wk('wn', { competitionId: CID.N })).key === 'nfl', '[3g] …an NFL competition\'s week is the nfl profile, through the COMPETITION');
  assert(profileForWeek(wk('wn', { competitionId: CID.N, sport: 'cfb' })).key === 'nfl', '[3h] a week\'s own drifted `sport` field is ignored (R1)');
  put(KEY_COMPETITIONS, [C.D, C.S]);
  let threw = null;
  try { profileForWeek(wk('wh', { competitionId: CID.S })); } catch (e) { threw = e; }
  assert(threw && threw.name === 'UnknownSportError' && threw.dbCode === 'nhl',
    '[3i] a competition whose sport has no registered profile THROWS (getProfile is strict; DI-224\'s catch tests err.name) — never a silent cfb');
  assert(profileForWeek(wk('wd', { competitionId: 'dangling' })).key === 'cfb',
    '[3j] (pinned as specified) a dangling competitionId falls back to the cfb profile, exactly as DI-219\'s `comp?.sport || \'cfb\'`');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] getWeeksForCompetition — a READ-ONLY view; a NEW array every call…');
{
  reset();
  put(KEY_COMPETITIONS, [C.D, C.N, C.S]);
  put(KEY_WEEKS, [
    wk('w1'), wk('w1b', { competitionId: null }), wk('w1c', { competitionId: CID.D }),
    wk('wn1', { competitionId: CID.N }), wk('wn2', { competitionId: CID.N }),
    wk('ws1', { competitionId: CID.S }), wk('wdangle', { competitionId: 'ghost' }),
  ]);
  assert(eq(ids(getWeeksForCompetition(CID.D)), ['w1', 'w1b', 'w1c']), '[4a] the default competition\'s weeks: no competitionId, null, and its own explicit id');
  assert(eq(ids(getWeeksForCompetition(null)), ['w1', 'w1b', 'w1c']) && eq(ids(getWeeksForCompetition()), ['w1', 'w1b', 'w1c']), '[4b] competitionId null / omitted asks for the default too');
  assert(eq(ids(getWeeksForCompetition(CID.N)), ['wn1', 'wn2']), '[4c] a non-default competition: only its own weeks');
  assert(eq(ids(getWeeksForCompetition(CID.S)), ['ws1']), '[4d] a third competition: only its own week');
  assert(!ids(getWeeksForCompetition(CID.D)).includes('wdangle') && !ids(getWeeksForCompetition(CID.N)).includes('wdangle'),
    '[4e] a week with a DANGLING competitionId belongs to no competition\'s view');
  assert(eq(getWeeksForCompetition('not-a-competition'), []), '[4f] an unknown competition id -> [] (never the default\'s weeks)');
  const before = JSON.stringify(getWeeks());
  const view = getWeeksForCompetition(CID.N);
  view.length = 0; view.push({ weekId: 'x' });
  assert(JSON.stringify(getWeeks()) === before, '[4g] mutating the returned array never touches storage — it is a NEW array');
  assert(getWeeksForCompetition(CID.N) !== getWeeksForCompetition(CID.N), '[4h] …every call returns a fresh array');
  put(KEY_COMPETITIONS, [C.N]);
  assert(eq(getWeeksForCompetition(null), []), '[4i] rows exist but none is the default: the default\'s view is [] (no default -> no weeks belong to it)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] getCurrentWeekFor — DI-224 §7 (a)-(d)…');
{
  // (a) SINGLE-COMPETITION matrix: with only the default, getCurrentWeekFor(null) deep-equals getCurrentWeek().
  const fixtures = {
    'pointer valid':            { weeks: [wk('a', { status: 'final', weekNumber: 1 }), wk('b', { status: 'open', weekNumber: 2 })], pointer: 'a' },
    'pointer dangling':         { weeks: [wk('a', { status: 'final', weekNumber: 1 }), wk('b', { status: 'open', weekNumber: 2 })], pointer: 'ghost' },
    'no pointer, an open week': { weeks: [wk('a', { status: 'final', weekNumber: 3 }), wk('b', { status: 'locked', weekNumber: 1 })], pointer: null },
    'no pointer, no open week': { weeks: [wk('a', { status: 'final', weekNumber: 1 }), wk('b', { status: 'final', weekNumber: 4 }), wk('c', { status: 'draft', weekNumber: 2 })], pointer: null },
    'no weeks':                 { weeks: [], pointer: null },
  };
  for (const [name, f] of Object.entries(fixtures)) {
    reset(); put(KEY_COMPETITIONS, [C.D]); put(KEY_WEEKS, f.weeks);
    if (f.pointer) put(KEY_ACTIVE_WEEK, f.pointer);
    assert(eq(getCurrentWeekFor(null), getCurrentWeek()), `[5a] single competition, ${name}: getCurrentWeekFor(null) deep-equals getCurrentWeek() (${JSON.stringify(getCurrentWeek() && getCurrentWeek().weekId)})`);
  }
  // (b) TWO competitions: default CFB + NFL.
  const two = () => {
    reset(); put(KEY_COMPETITIONS, [C.D, C.N]);
    put(KEY_WEEKS, [
      wk('w1', { status: 'final', weekNumber: 1 }), wk('w2', { status: 'open', weekNumber: 2 }),
      wk('wn1', { status: 'final', weekNumber: 1, competitionId: CID.N }), wk('wn2', { status: 'open', weekNumber: 2, competitionId: CID.N }),
      wk('wn3', { status: 'live', weekNumber: 3, competitionId: CID.N }),
    ]);
  };
  two(); put(KEY_ACTIVE_WEEK, 'w1');
  assert(getCurrentWeekFor(CID.N).weekId === 'wn2', '[5b] the NFL pointer (active_week_id = wn2) resolves the NFL week');
  assert(getCurrentWeekFor(null).weekId === 'w1' && getCurrentWeekFor(CID.D).weekId === 'w1', '[5b] the default uses league_kv active_week');
  put(KEY_COMPETITIONS, [C.D, { ...C.N, activeWeekId: 'ghost' }]);
  assert(getCurrentWeekFor(CID.N).weekId === 'wn2', '[5c] a dangling NFL pointer falls to NFL\'s FIRST open/locked/live week (wn2), never a CFB week');
  put(KEY_COMPETITIONS, [C.D, { ...C.N, activeWeekId: null }]);
  assert(getCurrentWeekFor(CID.N).weekId === 'wn2', '[5d] no NFL pointer: the same step-2 answer');
  two(); store.delete(KEY_ACTIVE_WEEK);
  assert(getCurrentWeekFor(null).weekId === 'w2', '[5e] the default\'s fallbacks stay in ITS weeks: with no pointer the first open week is CFB\'s w2, not NFL\'s wn2');
  put(KEY_WEEKS, [wk('w1', { status: 'final', weekNumber: 1 }), wk('wn2', { status: 'open', weekNumber: 2, competitionId: CID.N })]);
  assert(getCurrentWeekFor(null).weekId === 'w1' && getCurrentWeek().weekId === 'wn2',
    '[5f] the default never returns an NFL week even with no pointer and no open CFB week (step 3 = its own highest weekNumber); the legacy getCurrentWeek() would have — that is the leak getCurrentWeekFor() closes');
  two(); put(KEY_ACTIVE_WEEK, 'wn3');
  assert(getCurrentWeekFor(null).weekId === 'w2', '[5g] (c) a default pointer at ANOTHER competition\'s week (wn3) is REFUSED — falls to step 2 (w2), not followed');
  put(KEY_COMPETITIONS, [C.D, { ...C.N, activeWeekId: 'w2' }]);
  assert(getCurrentWeekFor(CID.N).weekId === 'wn2', '[5h] …and an NFL pointer at a CFB week (w2) is refused the same way');
  assert(getCurrentWeekFor('ghost') === null, '[5i] (d) an unknown competition id -> null, never the default\'s week');
  put(KEY_COMPETITIONS, [C.D, { ...C.N, activeWeekId: null }]);
  put(KEY_WEEKS, [wk('wn1', { status: 'final', weekNumber: 4, competitionId: CID.N }), wk('wn2', { status: 'final', weekNumber: 9, competitionId: CID.N })]);
  assert(getCurrentWeekFor(CID.N).weekId === 'wn2' && getCurrentWeekFor(null) === null,
    '[5j] step 3: highest weekNumber of THAT competition; a competition with no weeks resolves null');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] getAllCurrentWeeks — default ALWAYS included; others only while live…');
{
  const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);
  reset(); put(KEY_COMPETITIONS, [C.N, C.S, C.D]);
  put(KEY_WEEKS, [
    wk('w1', { status: 'open', weekNumber: 1 }),
    wk('wn1', { status: 'open', weekNumber: 1, competitionId: CID.N }),
    wk('ws1', { status: 'final', weekNumber: 1, competitionId: CID.S }),
  ]);
  put(KEY_ACTIVE_WEEK, 'w1');
  assert(eq(ids(getAllCurrentWeeks(LEAGUE, NOW)), ['w1', 'wn1']),
    '[6a] exactly one week per included competition, DEFAULT FIRST (stored order was N, S, D); the finished NHL season is excluded');
  put(KEY_WEEKS, [wk('w1', { status: 'final', weekNumber: 1 }), wk('wn1', { status: 'open', weekNumber: 1, competitionId: CID.N })]);
  assert(eq(ids(getAllCurrentWeeks(LEAGUE, NOW)), ['w1', 'wn1']),
    '[6b] the default competition is included EVEN WHEN NOT LIVE (offseason: its last week is still its current week — byte-identical single-sport behaviour)');
  put(KEY_WEEKS, [wk('w1', { status: 'open', weekNumber: 1 }), wk('wn1', { status: 'final', weekNumber: 1, competitionId: CID.N })]);
  assert(eq(ids(getAllCurrentWeeks(LEAGUE, NOW)), ['w1']), '[6c] a non-default competition that is not live is excluded');
  put(KEY_COMPETITIONS, [C.D, { ...C.N, archivedAt: '2026-09-01T00:00:00Z' }]);
  put(KEY_WEEKS, [wk('w1', { status: 'open', weekNumber: 1 }), wk('wn1', { status: 'open', weekNumber: 1, competitionId: CID.N })]);
  assert(eq(ids(getAllCurrentWeeks(LEAGUE, NOW)), ['w1']), '[6d] an ARCHIVED competition is excluded even with an open week');
  put(KEY_COMPETITIONS, [C.D, C.N]);
  put(KEY_WEEKS, [wk('wn1', { status: 'open', weekNumber: 1, competitionId: CID.N })]);
  assert(eq(ids(getAllCurrentWeeks(LEAGUE, NOW)), ['wn1']), '[6e] a default competition with no weeks contributes nothing (null is filtered), the live NFL week still lists');
  put(KEY_COMPETITIONS, [C.D, { ...C.N, activeWeekId: null }, C.S]);
  put(KEY_WEEKS, [wk('wn1', { status: 'open', weekNumber: 1, competitionId: CID.N }), wk('ws1', { status: 'draft', weekNumber: 1, competitionId: CID.S, startDate: '2026-10-03' })]);
  assert(eq(ids(getAllCurrentWeeks(LEAGUE, NOW)), ['wn1', 'ws1']), '[6f] a draft week starting inside the window makes its competition included, ordered by createdAt after the default');
  reset(); put(KEY_WEEKS, [wk('w1', { status: 'open' })]);
  assert(eq(getAllCurrentWeeks(), [getCurrentWeek()]), '[6g] (pre-backfill, again) zero rows -> [getCurrentWeek()]');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] getLiveSports — R7: derived, never stored; N = 3 days at both edges…');
{
  const NOW = Date.UTC(2026, 9, 1, 12, 0, 0);          // noon UTC, Oct 1 — startDate strings parse as UTC midnight
  const setup = (comps, weeks) => { reset(); put(KEY_COMPETITIONS, comps); put(KEY_WEEKS, weeks); };
  const codes = (r) => r.map((s) => `${s.dbCode}:${s.competitionId}`);

  setup([C.D, C.N], [wk('w1', { status: 'open' })]);
  assert(eq(getLiveSports(LEAGUE, NOW), [{ dbCode: 'cfb', label: 'College Football', competitionId: CID.D }]),
    `[7a] shape is exactly [{dbCode,label,competitionId}] and the label is the profile's own copy (${JSON.stringify(getLiveSports(LEAGUE, NOW))})`);
  for (const st of ['open', 'locked', 'live']) {
    setup([C.D], [wk('w1', { status: st })]);
    assert(getLiveSports(LEAGUE, NOW).length === 1, `[7b] a week in "${st}" makes its competition live`);
  }
  setup([C.D], [wk('w1', { status: 'final' })]);
  assert(getLiveSports(LEAGUE, NOW).length === 0, '[7c] a competition with only FINAL weeks is not live (getLiveSports never auto-includes the default — getAllCurrentWeeks does)');
  setup([C.D], []);
  assert(getLiveSports(LEAGUE, NOW).length === 0, '[7d] a competition with no weeks is not live');

  // THE DI'S NAMED CASES: only a week starting in 5 days is NOT live at N=3; one starting in 2 days IS.
  setup([C.D, C.N], [wk('w1', { status: 'final' }), wk('wn1', { status: 'draft', competitionId: CID.N, startDate: '2026-10-06' })]);   // +4.5 days
  assert(eq(getLiveSports(LEAGUE, NOW), []), '[7e] a competition whose only week is a DRAFT starting ~5 days out is NOT live (N=3)');
  setup([C.D, C.N], [wk('w1', { status: 'final' }), wk('wn1', { status: 'draft', competitionId: CID.N, startDate: '2026-10-03' })]);   // +1.5 days
  assert(eq(codes(getLiveSports(LEAGUE, NOW)), [`nfl:${CID.N}`]), '[7f] …starting ~2 days out IS live');
  for (const [date, expect, why] of [['2026-10-04', true, '+2.5d'], ['2026-10-05', false, '+3.5d — just past the window'], ['2026-10-02', true, '+0.5d'], ['2026-10-01', false, 'UTC midnight before `now` — already past'], ['2026-09-20', false, 'long past']]) {
    setup([C.N], [wk('wn1', { status: 'draft', competitionId: CID.N, startDate: date })]);
    assert(getLiveSports(LEAGUE, NOW).length === (expect ? 1 : 0), `[7g] draft week startDate ${date} (${why}): ${expect ? 'live' : 'not live'}`);
  }
  // The window's edges in milliseconds, through an ISO timestamp startDate.
  setup([C.N], [wk('wn1', { status: 'draft', competitionId: CID.N, startDate: new Date(NOW + 3 * 86400000).toISOString() })]);
  assert(getLiveSports(LEAGUE, NOW).length === 1, '[7h] a start exactly now + 3 days is INSIDE the window (t - now <= N days)');
  setup([C.N], [wk('wn1', { status: 'draft', competitionId: CID.N, startDate: new Date(NOW + 3 * 86400000 + 1).toISOString() })]);
  assert(getLiveSports(LEAGUE, NOW).length === 0, '[7i] …one millisecond later is outside');
  setup([C.N], [wk('wn1', { status: 'draft', competitionId: CID.N, startDate: new Date(NOW).toISOString() })]);
  assert(getLiveSports(LEAGUE, NOW).length === 1, '[7j] a start exactly at now is inside (t - now >= 0)');
  setup([C.N], [wk('wn1', { status: 'draft', competitionId: CID.N, startDate: 'not a date' })]);
  assert(getLiveSports(LEAGUE, NOW).length === 0, '[7k] an unparseable startDate never makes a competition live');

  setup([C.D, { ...C.N, archivedAt: '2026-09-01T00:00:00Z' }], [wk('w1', { status: 'open' }), wk('wn1', { status: 'open', competitionId: CID.N })]);
  assert(eq(codes(getLiveSports(LEAGUE, NOW)), [`cfb:${CID.D}`]), '[7l] an ARCHIVED competition is excluded, whatever its weeks say');
  setup([C.N, C.D], [wk('w1', { status: 'open' }), wk('wn1', { status: 'open', competitionId: CID.N })]);
  assert(eq(codes(getLiveSports(LEAGUE, NOW)), [`cfb:${CID.D}`, `nfl:${CID.N}`]), '[7m] the DEFAULT competition is listed first, then createdAt ascending');
  // Q11's "ever" vs "live": the sport code appears in historical weeks.sport values, but nothing is live.
  setup([C.D, C.N], [wk('w1', { status: 'open' }), wk('wn0', { status: 'final', sport: 'nfl', competitionId: CID.N })]);
  assert(eq(codes(getLiveSports(LEAGUE, NOW)), [`cfb:${CID.D}`]), '[7n] a competition with no open/locked/live week and no imminent start is excluded even though `nfl` still appears in historical weeks.sport (Q11: "ever" is not "live")');
  setup([C.D, C.S], [wk('ws1', { status: 'open', competitionId: CID.S })]);
  let live;
  let threw = null;
  try { live = getLiveSports(LEAGUE, NOW); } catch (e) { threw = e; }
  assert(!threw && eq(live, [{ dbCode: 'nhl', label: 'nhl', competitionId: CID.S }]),
    `[7o] an unregistered sport lists labelled by its dbCode WITHOUT throwing (${JSON.stringify(live)}) — the unknown-sport banner is DI-224's, at the fetch call site`);
  assert(eq(getLiveSports('some-other-league', NOW), []), '[7p] a league that is not the loaded one answers []');
  setup([C.D], [wk('w1', { status: 'open' })]);
  assert(getLiveSports().length === 1, '[7q] defaults: leagueId = the active league, now = the clock');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] getEffectiveSetting — week > competition > league > default, an ALLOW-LIST, own-property reads…');
{
  reset();
  put(KEY_COMPETITIONS, [{ ...C.D }, { ...C.N, settings: { weeklyGameCount: 8, weeklyPrize: 'a steak', serverJobs: { scoresRefresh: false }, reminderCadence: 'never', chatEnabled: false, constructor: 'x' } }]);
  put(KEY_WEEKS, [wk('wA', { weeklyGameCount: 6, season: '2027' }), wk('wB')]);

  let r = getEffectiveSetting('weeklyGameCount');
  assert(r.source === 'default' && r.value === DEFAULT_SETTINGS.weeklyGameCount, `[8a] no tier set -> source 'default', the built-in value (${JSON.stringify(r)})`);
  saveSetting('weeklyGameCount', 12);
  r = getEffectiveSetting('weeklyGameCount');
  assert(r.source === 'league' && r.value === 12, '[8b] only the league set it -> source \'league\' (the DEFAULT tier is really reachable: the league tier reads the STORED blob, not getSettings()\' default-merged one)');
  r = getEffectiveSetting('weeklyGameCount', { competitionId: CID.N });
  assert(r.source === 'competition' && r.value === 8, '[8c] a competition value beats the league value (even though the league also set it) -> \'competition\'');
  r = getEffectiveSetting('weeklyGameCount', { competitionId: CID.N, weekId: 'wA' });
  assert(r.source === 'week' && r.value === 6, '[8d] a value on the WEEK itself beats everything -> \'week\'');
  r = getEffectiveSetting('weeklyGameCount', { competitionId: CID.N, weekId: 'wB' });
  assert(r.source === 'competition' && r.value === 8, '[8e] a week with no such field falls through to the competition');
  r = getEffectiveSetting('weeklyGameCount', { competitionId: CID.D });
  assert(r.source === 'league' && r.value === 12, '[8f] a competition with no override falls through to the league (a default-competition league truthfully reports \'league\', never \'competition\')');
  r = getEffectiveSetting('weeklyPrize', { competitionId: CID.N });
  assert(r.source === 'competition' && r.value === 'a steak', '[8g] weeklyPrize is allow-listed too');
  r = getEffectiveSetting('season', { weekId: 'wA' });
  assert(r.source === 'week' && r.value === '2027', '[8h] the week tier is a per-record fact and is NEVER allow-listed (`season` is on the week object)');

  // DI-225's FIFTH ASSERTION — a NON-allow-listed key with a stray competitions.settings entry is IGNORED.
  r = getEffectiveSetting('serverJobs', { competitionId: CID.N });
  assert(r.source !== 'competition', `[8i] serverJobs with a stray competitions.settings entry is IGNORED — source is ${r.source}, never 'competition'`);
  r = getEffectiveSetting('reminderCadence', { competitionId: CID.N });
  assert(r.source !== 'competition' && r.value !== 'never', '[8j] reminderCadence (deliberately NOT allow-listed) is ignored even with a stray value present');
  r = getEffectiveSetting('chatEnabled', { competitionId: CID.N });
  assert(r.source !== 'competition' && r.value === DEFAULT_SETTINGS.chatEnabled, '[8k] a chat knob is league-only: a stray competition value does not disable chat');
  saveSetting('chatEnabled', true);
  assert(getEffectiveSetting('chatEnabled', { competitionId: CID.N }).source === 'league', '[8l] …and once the league sets it, the answer is the league\'s');

  for (const k of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
    const x = getEffectiveSetting(k, { competitionId: CID.N, weekId: 'wA' });
    assert(x.source === 'default' && x.value === undefined, `[8m] "${k}" never resolves to an Object.prototype member (source ${x.source}, value ${typeof x.value})`);
  }
  r = getEffectiveSetting('noSuchSettingAnywhere');
  assert(r.source === 'default' && r.value === undefined, '[8n] an unknown key -> {value: undefined, source: default}');
  r = getEffectiveSetting('weeklyGameCount', { competitionId: 'ghost' });
  assert(r.source === 'league', '[8o] an unknown competitionId falls through, it never throws');
  assert(SETTING_SOURCES.includes(getEffectiveSetting('weeklyGameCount', { competitionId: CID.N, weekId: 'wA' }).source), '[8p] every source returned is a member of the R2 enum');
  assert(JSON.parse(localStorage.getItem(KEY_SETTINGS)).weeklyGameCount === 12 && !('serverJobs' in JSON.parse(localStorage.getItem(KEY_SETTINGS))),
    '[8q] resolving settings wrote nothing into cfbp_settings');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] DI-220\'s top risk — saveWeek / deleteWeek write the raw, unfiltered array…');
{
  reset();
  put(KEY_COMPETITIONS, [C.D, C.N]);
  put(KEY_WEEKS, [wk('w1'), wk('w2'), wk('wn1', { competitionId: CID.N }), wk('wn2', { competitionId: CID.N })]);
  const aBefore = JSON.stringify(getWeeksForCompetition(CID.D));
  saveWeek({ ...getWeeks().find((w) => w.weekId === 'wn2'), blurb: 'NFL opener' });
  const after = getWeeks();
  assert(after.length === 4 && eq(ids(after), ['w1', 'w2', 'wn1', 'wn2']) && after.find((w) => w.weekId === 'wn2').blurb === 'NFL opener',
    '[9a] saving a week in competition B keeps every week of competition A (4 rows in, 4 rows out, only the one edited)');
  assert(JSON.stringify(getWeeksForCompetition(CID.D)) === aBefore, '[9b] …and competition A\'s weeks are BYTE-IDENTICAL before and after');
  const bBefore = JSON.stringify(getWeeksForCompetition(CID.N));
  deleteWeek('w2');
  assert(eq(ids(getWeeks()), ['w1', 'wn1', 'wn2']) && JSON.stringify(getWeeksForCompetition(CID.N)) === bBefore,
    '[9c] deleting a week in A removes exactly that week and leaves competition B\'s weeks byte-identical');
  // THE CONTROL — the mistake the DI names: building the seam write from the competition-filtered view.
  const filtered = getWeeksForCompetition(CID.N);
  localStorage.setItem(KEY_WEEKS, JSON.stringify(filtered));
  assert(getWeeks().length === 2, '[9d] CONTROL: a write built from getWeeksForCompetition() drops every other competition\'s weeks — exactly why that view is read-only and never feeds saveWeek/deleteWeek');

  reset();
  saveCompetition({ id: CID.N, sport: 'nfl' });
  saveCompetition({ id: CID.S, sport: 'nhl' });
  saveCompetition({ id: CID.N, sport: 'nfl', kind: 'season' });
  const cs = storage.getCompetitions();
  assert(cs.length === 2 && cs.find((c) => c.id === CID.N).kind === 'season' && typeof cs[0].updatedAt === 'string',
    '[9e] saveCompetition (the exported, commissioner-only path) upserts by id — no duplicate — and stamps updatedAt: the saveWeek shape');
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
