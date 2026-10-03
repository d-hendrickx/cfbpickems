/**
 * CFB Pickems — pilotonlytest.mjs
 * ================================
 * N1 (DI-432 §7, 2026-09-30) — the pilot-only registry, ENFORCED BY CODE. js/pilot-only.js names every surface that belongs to the pilot league alone; this suite is the
 * tripwire that keeps the names and the code in agreement, in BOTH directions:
 *
 *   • every registered client site really contains its `isPilotOnlyAllowed('<key>'` call (a site that drops its gate goes red);
 *   • every `isPilotOnlyAllowed('<key>'` call in js/ names a REGISTERED key, and every key that lists client sites is actually used (a new gated site that was never
 *     registered — or a registry entry whose site is gone — goes red);
 *   • a NON-pilot render of the sites this suite can drive contains no "2025", no founders' roster name and no "IRB"; a pilot render still carries them.
 *
 * Run:  node pilotonlytest.mjs
 *
 * NOT covered here: the server half of the registry (Edge Functions read `leagues.pilot` themselves; functions.check.mjs and the function twins pin it) and the picture of
 * each site inside the running app (authtest.mjs [80] drives the real app.js renders with a non-pilot and a pilot active league).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';

let pass = 0, fail = 0;
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, extra ? `\n     ${extra}` : ''); }
};
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const stripComments = (raw) => raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
const fnBody = (code, header) => {
  const at = code.indexOf(header);
  if (at < 0) return '';
  // brace-balanced body from the first `{` after the header
  let i = code.indexOf('{', at), depth = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === '{') depth++;
    else if (code[j] === '}') { depth--; if (depth === 0) return code.slice(i, j + 1); }
  }
  return '';
};

// minimal DOM/Storage shims so recap.js / control-center.js import cleanly
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null };
globalThis.window = globalThis;
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {} }, appendChild() {}, dataset: {} }, hidden: false };
globalThis.location = { href: 'https://irbfootball.com/', origin: 'https://irbfootball.com', pathname: '/', search: '', hash: '' };

const PO = await import('./js/pilot-only.js');
const { PILOT_ONLY_REGISTRY, PILOT_ONLY_KEYS } = PO;

console.log('\n[1] The registry is well-formed and closed…');
{
  assert(Object.isFrozen(PILOT_ONLY_REGISTRY) && PILOT_ONLY_KEYS.every((k) => Object.isFrozen(PILOT_ONLY_REGISTRY[k])), '[1a] the registry is deep-frozen');
  assert(PILOT_ONLY_KEYS.length === 8, `[1b] eight keys (got ${PILOT_ONLY_KEYS.length}: ${PILOT_ONLY_KEYS.join(', ')})`);
  for (const k of PILOT_ONLY_KEYS) {
    const e = PILOT_ONLY_REGISTRY[k];
    assert(Array.isArray(e.client) && Array.isArray(e.server), `[1c] ${k}: has a client list and a server list`);
    assert(e.client.length + e.server.length > 0, `[1d] ${k}: names at least ONE site (a key with no site is dead weight, and a site nobody listed is the bug this file exists for)`);
    for (const s of e.client) assert(existsSync(new URL(`./${s.file}`, import.meta.url)) && typeof s.marker === 'string' && s.marker.length > 0, `[1e] ${k}: client site ${s.file} exists and is described`);
    for (const s of e.server) assert(existsSync(new URL(`./${s.file.startsWith('supabase') ? s.file : s.file}`, import.meta.url)) && typeof s.note === 'string' && s.note.length > 0, `[1f] ${k}: server site ${s.file} exists and is described`);
  }
}

console.log('\n[2] Tripwire A — every registered client site contains its gate…');
{
  const cache = {};
  const code = (f) => (cache[f] ||= stripComments(src(`./${f}`)));
  for (const k of PILOT_ONLY_KEYS) {
    for (const s of PILOT_ONLY_REGISTRY[k].client) {
      assert(new RegExp(`isPilotOnlyAllowed\\('${k}'`).test(code(s.file)), `[2a] ${k}: ${s.file} contains isPilotOnlyAllowed('${k}'  —  ${s.marker}`);
      assert(/from '\.\/pilot-only\.js'/.test(code(s.file)), `[2b] ${s.file} imports the registry (no second predicate)`);
    }
  }
  const app = code('js/app.js');
  // The three 2K25 renderers each open with the gate (first statement), not merely somewhere in the file.
  for (const fn of ['function renderSeason2025OutstandingSection()', 'function renderSeason2025RecordSection()', 'function renderSeason2025ObligationsAdmin()']) {
    const body = fnBody(app, fn);
    assert(/^\{\s*if \(!isPilotOnlyAllowed\('season2025Record'\)\) return '';/.test(body), `[2c] ${fn}: the gate is the FIRST statement`);
  }
  assert(/^\{\s*if \(!isPilotOnlyAllowed\('sixSchoolAlmaMaters'\)\) return \[\];/.test(fnBody(app, 'function almaMaterCatalogFallback()')), '[2d] almaMaterCatalogFallback(): gated first, returns NO schools for a non-pilot league');
  assert(/isPilotOnlyAllowed\('recap2025'\)/.test(fnBody(stripComments(src('./js/recap.js')), 'export function renderSeasonSummaryHTML(')), '[2e] recap.js renderSeasonSummaryHTML(): the 2K25 card is gated');
  assert(/isPilotOnlyAllowed\('irbCopy', ctx\.league\)/.test(fnBody(stripComments(src('./js/control-center.js')), 'export function renderIdentityHeader(')), '[2f] control-center.js renderIdentityHeader(): the league-name fallback is gated on the league in hand');
  // SP-53 (2026-10-01): the Invite-to-League helper line stopped being a pilot literal (it names the ACTIVE league for every league, so a renamed league never reads a stale name); the push "needs-install" copy is the ONE
  // remaining IRB-string site in app.js and keeps its gate. The tripwire still requires the gate at that site, and now ALSO fails if the literal "IRB Football" comes back into the Invite line.
  assert(/isPilotOnlyAllowed\('irbCopy'\)/.test(app) && (app.match(/isPilotOnlyAllowed\('irbCopy'\)/g) || []).length >= 1, '[2g] app.js: the remaining IRB-string site (the push install copy) is gated');
  assert(!/Share this code with anyone joining IRB Football/.test(app), '[2g-2] app.js: the Invite-to-League line carries no pilot literal (SP-53: it names the active league)');
}

console.log('\n[3] Tripwire B — every gate in js/ names a registered key, and every registered client key is used…');
{
  const files = readdirSync(new URL('./js/', import.meta.url)).filter((f) => f.endsWith('.js'));
  const used = new Map();
  for (const f of files) {
    if (f === 'pilot-only.js') continue;
    const code = stripComments(src(`./js/${f}`));
    for (const m of code.matchAll(/isPilotOnlyAllowed\(\s*'([^']*)'/g)) {
      if (!used.has(m[1])) used.set(m[1], new Set());
      used.get(m[1]).add(`js/${f}`);
    }
    // a call with a NON-literal key can never be checked by this tripwire: not allowed.
    const dynamic = [...code.matchAll(/isPilotOnlyAllowed\(\s*([^'\s)][^,)]*)/g)].map((m) => m[1]);
    assert(dynamic.length === 0, `[3a] js/${f}: every isPilotOnlyAllowed() call takes a string-literal key (dynamic: ${JSON.stringify(dynamic)})`);
  }
  for (const [key, where] of used) assert(PILOT_ONLY_KEYS.includes(key), `[3b] the key '${key}' used in ${[...where].join(', ')} is REGISTERED`);
  for (const k of PILOT_ONLY_KEYS) {
    if (PILOT_ONLY_REGISTRY[k].client.length) assert(used.has(k), `[3c] the registered client key '${k}' is used by at least one gate`);
  }
  // Each registered client FILE is among the files that actually use the key.
  for (const k of PILOT_ONLY_KEYS) for (const s of PILOT_ONLY_REGISTRY[k].client) assert(used.get(k)?.has(s.file), `[3d] ${k}: ${s.file} is one of the files using it`);
  // MUTATION-PROOF of the tripwire's teeth: delete a gate from a scratch copy of the source text and the scan must go red.
  const mutated = stripComments(src('./js/recap.js')).replace("&& isPilotOnlyAllowed('recap2025')", '');
  assert(!/isPilotOnlyAllowed\('recap2025'/.test(mutated), '[3e] mutation: removing the recap gate from a scratch copy makes the [2a] scan report it absent (the tripwire has teeth)');
}

console.log('\n[4] The server half is registered against real files, and the pilot-only functions really check the row…');
{
  for (const f of ['supabase/functions/trainer/index.js', 'supabase/functions/scribe-learn/index.js']) {
    assert(/isPilotLeagueRow/.test(src(`./${f}`)), `[4a] ${f} checks isPilotLeagueRow (a non-pilot league is never iterated by a pilot-only job)`);
  }
  const persona = src('./supabase/functions/_shared/scribe-persona.mjs');
  assert(/lore/.test(persona) && /scribeSystemBlocks/.test(persona), '[4b] the persona seam takes the lore flag (lorePersona)');
  // R-F3 (DI-435 title seam, round 3b): [4c]/[4d] used to say "the IRB push title constants STILL live in job-rules.mjs (DI-435 owns their replacement)".
  // The seam is now closed, so they pin the closed seam instead: the constants are the pilot's ONLY, selected through isPilotLeagueRow and never by name,
  // and the registry's note says the gap is closed rather than open.
  const jobRules = src('./supabase/functions/_shared/job-rules.mjs');
  assert(/SYSTEM_TITLE/.test(jobRules) && /export function systemPushTitle\(league/.test(jobRules) && /if \(isPilotLeagueRow\(league\)\) return selfTest \? SYSTEM_TEST_TITLE : SYSTEM_TITLE;/.test(jobRules)
    && /sanitizeLeagueLabel\(league && league\.name\)/.test(jobRules),
    '[4c] the IRB push title constants live in job-rules.mjs and are handed out ONLY by systemPushTitle(league): isPilotLeagueRow(league) gets them, every other league gets its own name through the one label sanitizer');
  assert(/DI-435/.test(PILOT_ONLY_REGISTRY.irbCopy.server[0].note) && !/STILL IRB/.test(PILOT_ONLY_REGISTRY.irbCopy.server[0].note) && /PILOT\\'?s only|PILOT.s only/.test(PILOT_ONLY_REGISTRY.irbCopy.server[0].note),
    '[4d] …and the registry says the seam is CLOSED (the titles are the pilot\'s only), not that the gap is still open');
  {
    // [4e] BEHAVIOUR, not just shape: a non-pilot league's system push is never titled with IRB's name; the pilot's is, byte for byte.
    const rules = await import('./supabase/functions/_shared/job-rules.mjs');
    const sys = { id: 'sys_x', author: 'system', body: 'b', type: 'message' };
    const pilotT = rules.composePush(sys, '', { league: { pilot: true, name: 'Anything' } }).title;
    const otherT = rules.composePush(sys, '', { league: { pilot: false, name: 'Saturday Crew' } }).title;
    const unknownT = rules.composePush(sys, '').title;
    assert(pilotT === "IRB Pick 'Ems" && otherT === 'Saturday Crew' && unknownT === 'Your league' && !/IRB/.test(otherT + unknownT),
      `[4e] behaviour: pilot -> "IRB Pick 'Ems" (by the flag), non-pilot -> its own name, unknown -> "Your league"; IRB's name never reaches a non-pilot league (got ${JSON.stringify([pilotT, otherT, unknownT])})`);
  }
}

console.log('\n[5] A NON-pilot render carries none of the pilot league\'s content; a pilot render still does…');
{
  const recap = await import('./js/recap.js');
  const { setPilotOnlyLeagueResolver } = PO;
  const week = { weekId: 'w1', season: '2026', weekNumber: 1, status: 'open', label: 'Week 1', sport: 'cfb', startDate: '2026-09-05', endDate: '2026-09-06' };
  localStorage.setItem('cfbp_settings', JSON.stringify({ season: '2026' }));
  localStorage.setItem('cfbp_weeks', JSON.stringify([week]));
  const LEAK = /2025|2K25|Kihoon|Brayden|Kevin|Koby|Jacob|Arch Manning|Permanent Record|Champion of record|IRB/;
  setPilotOnlyLeagueResolver(() => ({ pilot: false }));
  const nonPilot = recap.renderSeasonSummaryHTML(week);
  assert(!LEAK.test(nonPilot), '[5a] a NON-pilot league\'s season summary carries no 2025, no roster name, no "IRB"', nonPilot.slice(0, 200));
  setPilotOnlyLeagueResolver(null);
  assert(!LEAK.test(recap.renderSeasonSummaryHTML(week)), '[5b] …and with NO league resolved (fail closed) it carries none either');
  setPilotOnlyLeagueResolver(() => ({ pilot: true }));
  const pilot = recap.renderSeasonSummaryHTML(week);
  assert(/Permanent Record/.test(pilot) && /CFP 2K25/.test(pilot), '[5c] a PILOT league still gets its Permanent Record (equals the pre-change render for that week)');
  setPilotOnlyLeagueResolver(null);
  // The drawer's identity block
  let cc = null;
  try { cc = await import('./js/control-center.js'); } catch (e) { cc = null; }
  if (cc && typeof cc.renderIdentityHeader === 'function') {
    const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const mk = (league) => { try { return cc.renderIdentityHeader({ escHtml: esc, icon: () => '', session: { player: { displayName: 'Sam' } }, league, version: { APP_VERSION: 'v', APP_VERSION_DATE: 'd' } }); } catch (e) { return `THREW ${e.message}`; } };
    const nonPilotHdr = mk({ name: '', pilot: false }); const noLeagueHdr = mk(undefined); const pilotHdr = mk({ name: '', pilot: true });
    assert(!/IRB/.test(nonPilotHdr) && /Your league/.test(nonPilotHdr), '[5d] the drawer\'s league-name fallback for a non-pilot league is "Your league", never "IRB Pick\'Ems"', nonPilotHdr.slice(0, 160));
    assert(!/IRB/.test(noLeagueHdr) && /Your league/.test(noLeagueHdr), '[5e] …and with no league record at all it is neutral too (unknown is never the pilot)');
    assert(/IRB Pick&#39;Ems/.test(pilotHdr), '[5f] the pilot league\'s own fallback is unchanged');
  } else {
    assert(false, '[5d] control-center.js could not be imported in this harness to drive renderIdentityHeader()');
  }
}

console.log('\n[6] The six-school list is pilot-only IN CODE — one accessor, no bare constant (coordinator ruling 2026-09-30)…');
{
  const dm = await import('./js/data-model.js');
  const SIX = ['Oklahoma', 'Texas A&M', 'USC', 'Notre Dame', 'Purdue', 'Arkansas'];
  PO.setPilotOnlyLeagueResolver(null);
  assert(!('ALMA_MATERS' in dm), '[6a] data-model.js no longer exports a bare ALMA_MATERS constant — there is nothing to read the six schools from except the accessor');
  assert(JSON.stringify(dm.getAlmaMaters({ pilot: true })) === JSON.stringify(SIX), '[6b] getAlmaMaters(pilotLeague) is the six founders\' schools, in order');
  for (const league of [{ pilot: false }, {}, null, { pilot: 'true' }]) assert(dm.getAlmaMaters(league).length === 0, `[6c] getAlmaMaters(${JSON.stringify(league)}) is [] — a non-pilot or unknown league never gets the six`);
  assert(dm.getAlmaMaters().length === 0, '[6d] with NO league and no resolver it is [] (fail closed)');
  PO.setPilotOnlyLeagueResolver(() => ({ pilot: true }));
  assert(dm.getAlmaMaters().length === 6 && dm.getAlmaMaters({ pilot: false }).length === 0, '[6e] the resolver answers for the active league; an explicit league always wins');
  const a1 = dm.getAlmaMaters({ pilot: true }); a1.push('X');
  assert(dm.getAlmaMaters({ pilot: true }).length === 6, '[6f] every call returns a FRESH copy (mutating one cannot touch the private list)');
  // the defaults that used to read the constant
  assert(dm.getAlmaMaterMatch('Oklahoma Sooners') === 'Oklahoma', '[6g] PILOT: getAlmaMaterMatch(team) with no roster still falls back to the six (byte-identical to before)');
  PO.setPilotOnlyLeagueResolver(() => ({ pilot: false }));
  assert(dm.getAlmaMaterMatch('Oklahoma Sooners') === null && dm.getAlmaMaterMatch('USC Trojans') === null, '[6h] NON-PILOT: the same call flags NOTHING — the founders\' schools never mark another league\'s games');
  assert(dm.getAlmaMaterMatch('Oklahoma Sooners', ['Oklahoma']) === 'Oklahoma', '[6i] …while an EXPLICIT roster (how app.js always calls it) matches whatever any league claims');
  const cfb = (await import('./js/sports/cfb.js')).CFB_PROFILE;
  assert(cfb.affinity.catalog().length === 0 && cfb.affinity.catalog({ pilot: true }).length === 6, '[6j] the cfb profile\'s affinity catalog goes through the accessor too (non-pilot: [])');
  PO.setPilotOnlyLeagueResolver(null);
  // source tripwires: the bare name is gone from CODE everywhere, and the private list is read in exactly one place
  const files = [...readdirSync(new URL('./js/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(new URL('./js/sports/', import.meta.url)).filter((f) => f.endsWith('.js')).map((f) => `js/sports/${f}`)];
  const noStrings = (c) => c.replace(/'(?:[^'\\\n]|\\.)*'/g, "''").replace(/"(?:[^"\\\n]|\\.)*"/g, '""');   // a log MESSAGE that names the retired constant is not a use of it
  const offenders = files.filter((f) => /\bALMA_MATERS\b/.test(noStrings(stripComments(src(`./${f}`)))));
  assert(offenders.length === 0, `[6k] no js/ module mentions the bare ALMA_MATERS constant in code (found: ${JSON.stringify(offenders)})`);
  const dmCode = stripComments(src('./js/data-model.js'));
  assert((dmCode.match(/\bPILOT_ALMA_MATERS\b/g) || []).length === 2 && /isPilotOnlyAllowed\('sixSchoolAlmaMaters', \.\.\.league\) \? \[\.\.\.PILOT_ALMA_MATERS\] : \[\]/.test(dmCode),
    '[6l] the private list appears exactly twice in data-model.js: its declaration and the ONE gated read inside getAlmaMaters()');
  assert(/const PILOT_ALMA_MATERS = Object\.freeze\(/.test(dmCode) && !/export const PILOT_ALMA_MATERS/.test(dmCode), '[6m] it is frozen and NOT exported');
  const dp = stripComments(src('./js/data-provider.js'));
  assert(/pending = resilientFetch\(url, \[\], fetchOptions\);/.test(dp) && (dp.match(/almaMaters = getAlmaMaters\(\)/g) || []).length >= 5,
    '[6n] data-provider: every default goes through the accessor, and the SERVER refresh path passes an explicit empty roster (it never reads the flag, and its scoreboard is shared across leagues)');
  // MUTATION on an in-memory copy: read the private list directly at the fallback and the [6k]-style scan reports it
  assert(/\bPILOT_ALMA_MATERS\b/.test(dmCode.replace('isPilotOnlyAllowed(\'sixSchoolAlmaMaters\', ...league) ? [...PILOT_ALMA_MATERS] : []', '[...PILOT_ALMA_MATERS]')) && !/isPilotOnlyAllowed\('sixSchoolAlmaMaters', \.\.\.league\)/.test(dmCode.replace('isPilotOnlyAllowed(\'sixSchoolAlmaMaters\', ...league) ? [...PILOT_ALMA_MATERS] : []', '[...PILOT_ALMA_MATERS]')),
    '[6o] mutation: removing the gate from getAlmaMaters() in a scratch copy is visible to the [6l] pin (the tripwire has teeth)');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
