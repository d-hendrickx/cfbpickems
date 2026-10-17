#!/usr/bin/env node
/**
 * CFB Pickems - tests/kits/w71-oddscap-mutants.mjs (D1 / v0.30.0, thread 100726-D1; the S-3 mutation kit of DI-W71.10, feature-builder-opus, 2026-10-14)
 * =========================================================================================================================================================
 * THE ITEM'S KIT (S-3, D-69) for the odds lookup's per-league DAILY limit (Drew D-80: "M45 b"; "(b) replaces (a)"). Every mutant the builder used to prove the new tests are not vacuous, encoded so the
 * reviewer re-runs them and adds only gap mutants. Two kinds:
 *
 *   OC-xx  a weakening of the FUNCTION (odds-lookup/index.js, vendor.mjs) or the CLIENT (js/odds-lookup-client.js, spread-fallback.js, spread-find-ui.js). Applied to a COPY of this cfb-pickems tree
 *          (never the checkout: no git restore, no stash, no in-place edit); the named suite runs IN THE COPY; the mutant is CAUGHT only if the suite exits non-zero AND every check named in `red`
 *          prints a cross (❌). The copy's file goes back to the checkout's own text before the next mutant.
 *   PG-xx  a weakening of MIGRATION 0060, applied in memory by pglite0060.check.mjs's own `--mutate=<name>` (the text on disk is never touched, so these run in the checkout). Each runs TWICE: with
 *          the migration's end-state proof (`red` = the line the proof's refusal turns red) and with `--noproof` (`redNoProof` = the BEHAVIOUR assertions that must catch it alone). Needs
 *          PGLITE_DIR (else the suite SKIPs green and the mutant counts as NOT caught: a skip is never a catch).
 *
 * Suites: OF oddsfallbacktest.mjs · TW supabase/tests/functions/oddsLookup.twin.mjs · FC supabase/tests/functions.check.mjs · PG supabase/tests/pglite0060.check.mjs
 *
 * Run:  PGLITE_DIR=/Users/drewhendricks/cfbp-tools/pglite-env node tests/kits/w71-oddscap-mutants.mjs          every mutant (about 4 minutes)
 *       node tests/kits/w71-oddscap-mutants.mjs OC-01 PG-03                                                    just those
 *       node tests/kits/w71-oddscap-mutants.mjs --anchors                                                      only check every OC anchor still matches exactly once (instant)
 * Exit 0 only when every mutant is CAUGHT. It is NOT registered with the runner: it copies the tree and takes minutes.
 */
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CFB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IDX = 'supabase/functions/odds-lookup/index.js', VEN = 'supabase/functions/odds-lookup/vendor.mjs';
const OLC = 'js/odds-lookup-client.js', SFB = 'js/spread-fallback.js', SFU = 'js/spread-find-ui.js';
const OF = 'oddsfallbacktest.mjs', TW = 'supabase/tests/functions/oddsLookup.twin.mjs', FC = 'supabase/tests/functions.check.mjs', PG = 'supabase/tests/pglite0060.check.mjs';

const RESERVE_BLOCK = "  // A call WILL be made: reserve it against the league's daily limit first (DI-W71.10). No hook, a throw or any answer but 'reserved' stops here, before the network.\n  let verdict = '';\n  try { verdict = typeof reserve === 'function' ? await reserve() : ''; } catch { verdict = ''; }\n  if (verdict === 'daily_limit') return { ok: false, reason: 'daily_limit' };\n  if (verdict !== 'reserved') return { ok: false, reason: 'reserve_error' };\n";
const MEMO_LINE = '  if (hit && now - hit.at < MEMO_MS) return { ok: true, events: hit.events, creditsLeft: hit.creditsLeft, cached: true };\n';
const FLOOR_LINE = "  if (lastCredits !== null && lastCredits < CREDITS_FLOOR) return { ok: false, reason: 'paused' };\n";

// { id, what, file, find, replace | edits, suite, red } - every `find` must match EXACTLY once.
const OC = [
  // -- the function --
  { id: 'OC-01', what: 'the reservation is made BEFORE the memo check (every lookup counts, memo hits included)', file: IDX, find: '  const first = await fetchEvents({ sportKey, apiKey, reserve });', replace: '  await reserve();\n  const first = await fetchEvents({ sportKey, apiKey, reserve });', suite: TW, red: ['10-3a:', '10-3b:', '10-2a:'] },
  { id: 'OC-02', what: 'the first vendor call is not reserved at all (the cap is never enforced)', file: IDX, find: '  const first = await fetchEvents({ sportKey, apiKey, reserve });', replace: "  const first = await fetchEvents({ sportKey, apiKey, reserve: async () => 'reserved' });", suite: TW, red: ['10-2b:', '10-2d:', '10-8a:'] },
  { id: 'OC-03', what: 'an RPC error is treated as a booking (fail OPEN)', file: IDX, find: "    if (error) return 'error';", replace: "    if (error) return 'reserved';", suite: TW, red: ['10-6:'] },
  { id: 'OC-04', what: 'a reserve error on the first call answers 200 vendor_error instead of a 500', file: IDX, find: "  if (!first.ok && first.reason === 'reserve_error') return finish(envelopeError(runId, 'reserve_failed'), 500);\n", replace: '', suite: TW, red: ['10-6:'] },
  { id: 'OC-05', what: 'a reserve error on the SECOND (FCS) call is swallowed', file: IDX, find: "    if (!second.ok && second.reason === 'reserve_error') return finish(envelopeError(runId, 'reserve_failed'), 500);\n", replace: '', suite: TW, red: ['10-9c:'] },
  { id: 'OC-06', what: 'the reservation can be booked against a league the BODY names', file: IDX, find: '{ p_league: leagueId }', replace: '{ p_league: body.p_league || leagueId }', suite: TW, red: ['10-5b:'] },
  { id: 'OC-07', what: 'the reservation is made with the CALLER\'s client, not the service role', file: IDX, find: 'await sb.rpc(RESERVE_RPC,', replace: 'await caller.userSb.rpc(RESERVE_RPC,', suite: TW, red: ['10-2a:', '10-8b:'] },
  { id: 'OC-08', what: 'daily_limit is not in the function\'s closed reason set (it reaches the screen as an error)', file: IDX, find: "'timeout', 'daily_limit']);", replace: "'timeout']);", suite: TW, red: ['10-2b:'] },
  { id: 'OC-09', what: 'any refusal word counts as daily_limit (a broken RPC answer is not fail-closed)', file: IDX, find: "    if (data && typeof data === 'object' && data.ok === false && data.reason === 'daily_limit') return 'daily_limit';", replace: "    if (data && typeof data === 'object' && data.ok === false) return 'daily_limit';", suite: TW, red: ['10-6:'] },
  { id: 'OC-10', what: 'the pilot-only gate is back', file: IDX, edits: [{ find: ".select('status').eq('id', leagueId)", replace: ".select('status, pilot').eq('id', leagueId)" }, { find: "  if (isPausedLeagueRow(leagueRow)) return finish(envelopeSkipped(runId, SKIPPED.LEAGUE_PAUSED));\n", replace: "  if (leagueRow.pilot !== true) return finish(unavailable(runId, 'not_configured'));\n  if (isPausedLeagueRow(leagueRow)) return finish(envelopeSkipped(runId, SKIPPED.LEAGUE_PAUSED));\n" }], suite: TW, red: ['10-1:', '10-1b:'] },
  { id: 'OC-11', what: 'the same pilot gate, caught by the static pin', file: IDX, edits: [{ find: ".select('status').eq('id', leagueId)", replace: ".select('status, pilot').eq('id', leagueId)" }, { find: "  if (isPausedLeagueRow(leagueRow)) return finish(envelopeSkipped(runId, SKIPPED.LEAGUE_PAUSED));\n", replace: "  if (leagueRow.pilot !== true) return finish(unavailable(runId, 'not_configured'));\n  if (isPausedLeagueRow(leagueRow)) return finish(envelopeSkipped(runId, SKIPPED.LEAGUE_PAUSED));\n" }], suite: FC, red: ['W-71 C3 - EVERY LEAGUE'] },
  { id: 'OC-12', what: 'the second fetchEvents is not handed the reservation, caught by the static pin', file: IDX, find: '    const second = await fetchEvents({ sportKey: FCS_SPORT_KEY, apiKey, reserve });', replace: "    const second = await fetchEvents({ sportKey: FCS_SPORT_KEY, apiKey, reserve: async () => 'reserved' });", suite: FC, red: ['W-71 C5 / DI-W71.10 - BOTH'] },
  { id: 'OC-13', what: 'the same unreserved second call, caught by behaviour (the FCS call books nothing)', file: IDX, find: '    const second = await fetchEvents({ sportKey: FCS_SPORT_KEY, apiKey, reserve });', replace: "    const second = await fetchEvents({ sportKey: FCS_SPORT_KEY, apiKey, reserve: async () => 'reserved' });", suite: TW, red: ['10-9a:', '10-9b:', '10-9c:', '4-3:'] },
  // -- the vendor adapter --
  { id: 'OC-20', what: 'the reservation moves BEFORE the memo check (a memo hit counts)', file: VEN, edits: [{ find: RESERVE_BLOCK, replace: '' }, { find: MEMO_LINE, replace: RESERVE_BLOCK + MEMO_LINE }], suite: TW, red: ['10-3a:', '10-3b:', '10-11b:'] },
  { id: 'OC-21', what: 'the same move, caught by the static order pin', file: VEN, edits: [{ find: RESERVE_BLOCK, replace: '' }, { find: MEMO_LINE, replace: RESERVE_BLOCK + MEMO_LINE }], suite: FC, red: ['W-71 C5 / DI-W71.10 - in fetchEvents()'] },
  { id: 'OC-22', what: 'the reservation moves before the credits floor (a paused answer still books a call)', file: VEN, edits: [{ find: RESERVE_BLOCK, replace: '' }, { find: FLOOR_LINE, replace: RESERVE_BLOCK + FLOOR_LINE }], suite: TW, red: ['10-10b:'] },
  { id: 'OC-23', what: 'any truthy verdict lets the call through', file: VEN, find: "  if (verdict !== 'reserved') return { ok: false, reason: 'reserve_error' };", replace: "  if (!verdict) return { ok: false, reason: 'reserve_error' };", suite: TW, red: ['10-6:', '10-11a:'] },
  { id: 'OC-24', what: 'no hook means "go ahead"', file: VEN, find: "verdict = typeof reserve === 'function' ? await reserve() : '';", replace: "verdict = typeof reserve === 'function' ? await reserve() : 'reserved';", suite: TW, red: ['10-11a:'] },
  { id: 'OC-25', what: 'a thrown reservation lets the call through', file: VEN, find: "} catch { verdict = ''; }", replace: "} catch { verdict = 'reserved'; }", suite: TW, red: ['10-6:', '10-11a:'] },
  { id: 'OC-26', what: 'daily_limit from the reservation becomes reserve_error (a 500 instead of the calm line)', file: VEN, find: "  if (verdict === 'daily_limit') return { ok: false, reason: 'daily_limit' };\n", replace: '', suite: TW, red: ['10-2b:', '10-11a:'] },
  // -- the client --
  { id: 'OC-30', what: 'the AUTOMATIC check shows the daily-limit line', file: SFU, find: "else if (o.status === 'daily_limit') st.note = auto ? '' : SF.SPREAD_COPY.DAILY_LIMIT;", replace: "else if (o.status === 'daily_limit') st.note = SF.SPREAD_COPY.DAILY_LIMIT;", suite: OF, red: ['F-19g:'] },
  { id: 'OC-31', what: 'the daily-limit line is an error with a Try again button', file: SFU, find: "else if (o.status === 'daily_limit') st.note = auto ? '' : SF.SPREAD_COPY.DAILY_LIMIT;", replace: "else if (o.status === 'daily_limit') { if (!auto) { st.note = SF.SPREAD_COPY.DAILY_LIMIT; st.noteKind = 'error'; } }", suite: OF, red: ['F-19h:'] },
  { id: 'OC-32', what: 'daily_limit is not its own state (it falls through to the error)', file: SFB, find: " : r === 'daily_limit' ? 'daily_limit'", replace: '', suite: OF, red: ['E-5b:', 'F-19h:'] },
  { id: 'OC-33', what: 'the browser\'s closed reason set loses daily_limit (the real response becomes vendor_error)', file: OLC, find: "'timeout', 'daily_limit'];", replace: "'timeout'];", suite: OF, red: ['G-5a:', 'G-6:'] },
  { id: 'OC-34', what: 'the copy drifts from the coordinator\'s line', file: SFB, find: "DAILY_LIMIT: \"This league has used today's spread lookups. Try again tomorrow, or enter the spread yourself.\",", replace: "DAILY_LIMIT: \"Daily limit reached.\",", suite: OF, red: ['E-12b:', 'F-19h:'] },
  { id: 'OC-35', what: 'the controller never handles daily_limit (no line after a tapped Find)', file: SFU, find: "    else if (o.status === 'daily_limit') st.note = auto ? '' : SF.SPREAD_COPY.DAILY_LIMIT;\n", replace: '', suite: OF, red: ['F-19h:'] },
];

// PG-xx: name -> the labels that must print FAIL with the proof (`red`) and with --noproof (`redNoProof`). Recorded with --discover-pg.
const PASTE = 'the paste succeeds on a database WITH leagues';
const PGM = [
  ['PG-01', 'no-cap', [PASTE], ['the 7th is refused', 'a refused reservation changes NOTHING']],
  ['PG-02', 'authed-exec', [PASTE], ['both functions: EXECUTE for service_role only', "the league's own COMMISSIONER (his JWT, role authenticated): calling"]],
  ['PG-03', 'fn-revoke-public-only', [PASTE], ['both functions: EXECUTE for service_role only', "the league's own COMMISSIONER (his JWT, role authenticated): calling"]],
  ['PG-04', 'cap-fn-authed', [PASTE], ['both functions: EXECUTE for service_role only', "the league's own COMMISSIONER (his JWT, role authenticated): calling"]],
  ['PG-05', 'authed-dml', [PASTE], ['table privileges:', "the league's own COMMISSIONER (his JWT, role authenticated): READ"]],
  ['PG-06', 'table-revoke-missing', [PASTE], ['table privileges:', 'anon: READ']],
  ['PG-07', 'service-write', [PASTE], ['table privileges:', 'the SERVICE ROLE cannot insert or reset']],
  ['PG-08', 'rls-off', [PASTE], ['RLS enabled AND forced', 'RLS with no policy']],
  ['PG-09', 'rls-not-forced', [PASTE], ['RLS enabled AND forced']],
  ['PG-10', 'invoker', [PASTE], ['odds_lookup_try_reserve is SECURITY DEFINER', "the service role's reservation IS allowed"]],
  ['PG-11', 'path-unpinned', [PASTE], ['odds_lookup_try_reserve is SECURITY DEFINER']],
  ['PG-12', 'local-day', ['the row is written for the UTC date'], ['the row is written for the UTC date']],
  ['PG-13', 'default-7', ['the 7th is refused'], ['the 7th is refused']],
  ['PG-14', 'cap-over-100', ['CAP_CASES'], ['CAP_CASES']],
  ['PG-15', 'cap-fraction', ['CAP_CASES'], ['CAP_CASES']],
  ['PG-16', 'cap-string', ['CAP_CASES'], ['CAP_CASES']],
  ['PG-17', 'realtime', [PASTE], ['not in supabase_realtime']],
  ['PG-18', 'no-fk', [PASTE], ['league_id references leagues ON DELETE CASCADE', 'a FORGED league uuid']],
  ['PG-19', 'no-cascade', [PASTE], ['league_id references leagues ON DELETE CASCADE', 'ON DELETE CASCADE: deleting a league']],
  ['PG-20', 'repaste-open', ['PART 0 refuses a PARTIAL re-paste', 'a second paste of the whole file is refused'], ['PART 0 refuses a PARTIAL re-paste', 'a second paste of the whole file is refused']],
  ['PG-21', 'key-check-skip', ['PART 0 refuses a database whose key CHECK'], ['PART 0 refuses a database whose key CHECK']],
  ['PG-22', 'null-league-open', [PASTE], ['a NULL league raises bad_league']],
];

const editsOf = (m) => m.edits || [{ find: m.find, replace: m.replace }];
const args = process.argv.slice(2);
const anchorsOnly = args.includes('--anchors');
const ids = args.filter((a) => !a.startsWith('--'));
const runOC = OC.filter((m) => !ids.length || ids.includes(m.id));
const runPG = PGM.filter(([id]) => !ids.length || ids.includes(id));

let caught = 0, survived = 0, broken = 0;
if (anchorsOnly || runOC.length) {
  for (const m of runOC) for (const e of editsOf(m)) { const n = readFileSync(join(CFB, m.file), 'utf8').split(e.find).length - 1; if (n !== 1) { broken++; console.log(`  ⚠️  ${m.id} anchor matches ${n}x in ${m.file}`); } }
  if (anchorsOnly) { console.log(broken ? `\n❌ ${broken} stale anchor(s) of ${runOC.length}` : `\n✅ all ${runOC.length} OC anchors match exactly once`); process.exit(broken ? 1 : 0); }
  if (broken) { console.log(`\n❌ ${broken} stale anchor(s): fix the kit before judging`); process.exit(1); }
}

if (runOC.length) {
  const tmp = mkdtempSync(join(tmpdir(), 'cfbp-w71oddscap-'));
  const COPY = join(tmp, 'cfb-pickems');
  console.log(`\nw71-oddscap kit - ${runOC.length} OC mutant(s); copying ${CFB} -> ${COPY} (node_modules and .git left out)\n`);
  cpSync(CFB, COPY, { recursive: true, filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(src) });
  if (existsSync(join(CFB, '..', 'docs'))) cpSync(join(CFB, '..', 'docs'), join(tmp, 'docs'), { recursive: true });   // functions.check reads ../docs
  for (const m of runOC) {
    const copy = join(COPY, m.file);
    const original = readFileSync(join(CFB, m.file), 'utf8');
    writeFileSync(copy, editsOf(m).reduce((t, e) => t.split(e.find).join(e.replace), original));
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [m.suite], { cwd: COPY, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
    writeFileSync(copy, original);
    const redLines = `${r.stdout || ''}\n${r.stderr || ''}`.split('\n').filter((l) => l.includes('❌'));
    if (r.status === null) { broken++; console.log(`  ⚠️  ${m.id} TIMED OUT - NOT counted as caught`); continue; }
    const missing = m.red.filter((label) => !redLines.some((l) => l.includes(label)));
    const ok = r.status !== 0 && missing.length === 0;
    if (ok) caught++; else survived++;
    console.log(`  ${ok ? '✅ CAUGHT  ' : '❌ SURVIVED'} ${m.id} (${m.suite.replace(/^.*\//, '')}, ${Math.round((Date.now() - t0) / 1000)}s) - ${m.what}`);
    console.log(`        RED on: ${m.red.filter((l) => !missing.includes(l)).join(' | ') || '(none)'}${missing.length ? `   NOT red: ${missing.join(' | ')}` : ''}   [exit ${r.status}, ${redLines.length} red line(s)]`);
  }
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* temp */ }
}

if (runPG.length) {
  console.log(`\nw71-oddscap kit - ${runPG.length} PG mutant(s) x 2 (with the migration's proof, and --noproof), in memory via ${PG} --mutate (PGLITE_DIR=${process.env.PGLITE_DIR || '(unset: every PG mutant will SKIP and count as NOT caught)'})\n`);
  for (const [id, name, red, redNoProof] of runPG) {
    for (const [variant, extra, want] of [['proof', [], red], ['noproof', ['--noproof'], redNoProof]]) {
      const r = spawnSync(process.execPath, [PG, `--mutate=${name}`, ...extra], { cwd: CFB, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
      const out = `${r.stdout || ''}\n${r.stderr || ''}`;
      const failLines = out.split('\n').filter((l) => /^\s*FAIL\b/.test(l));
      const skipped = /^SKIP\s/m.test(out);
      const missing = want.filter((label) => !failLines.some((l) => l.includes(label)));
      const ok = !skipped && r.status !== 0 && missing.length === 0 && new RegExp(`MUTATION ${name}`).test(out);
      if (ok) caught++; else survived++;
      console.log(`  ${ok ? '✅ CAUGHT  ' : '❌ SURVIVED'} ${id} ${name} (${variant})${skipped ? ' - SKIPPED: PGlite not installed' : ''}`);
      console.log(`        RED on: ${want.filter((l) => !missing.includes(l)).join(' | ') || '(none)'}${missing.length ? `   NOT red: ${missing.join(' | ')}` : ''}   [exit ${r.status}, ${failLines.length} FAIL line(s)]`);
    }
  }
}

console.log(`\n${survived === 0 && broken === 0 ? '✅ ALL CAUGHT' : '❌ NOT ALL CAUGHT'} - ${caught} caught, ${survived} survived, ${broken} stale/timed out`);
process.exit(survived === 0 && broken === 0 ? 0 : 1);
