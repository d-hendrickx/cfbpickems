/**
 * CFB Pickems — gamestatetest.mjs (Deployment 1, Lane B, DI-570, 2026-10-07)
 * ==========================================================================
 * The proof for js/game-state.js: one vocabulary for "what state is this game in".
 *
 *   [1] The phase table — one assertion per phase and per boundary (the 3:00 line is exact: 180 000 ms is live, 180 001 is stale)
 *   [2] PARITY — the fresh live label equals js/app.js's liveStatusDisplayShort() text (a frozen copy of the original is the oracle) and the two constants match app.js
 *   [3] The freshness line — the exact DI-570 copy, every phase
 *   [4] Decided language — isDecided() is true for final and nothing else; coverWord() per phase; the banned-word scanner
 *   [5] Purity — no imports, no storage, no clock of its own
 *   [6] MUTATION PROOFS on scratch copies (never the file): each mutant must turn a NAMED check RED
 *
 * Run:  node gamestatetest.mjs     (date-free: every instant is a parameter, so it is TZ-independent)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const GS = await import('./js/game-state.js');
const SRC = await read('./js/game-state.js');
const APP = await read('./js/app.js');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const { gameStateOf, freshnessLine, coverWord, isDecided, isLivePhase, containsBannedLiveWord, liveDetailLabel, LIVE_STATUS_STALE_MS, PHASE_LABELS } = GS;

const NOW = 1_800_000_000_000;
const MIN = 60_000;
const fmtK = (iso) => `K<${iso}>`;
const g = (o = {}) => ({ gameId: 'g1', status: 'scheduled', kickoff: new Date(NOW + 3600_000).toISOString(), homeScore: null, awayScore: null, ...o });
const cap = (ageMs, o = {}) => ({ name: 'STATUS_IN_PROGRESS', detail: 'Q2 - 4:12', shortDetail: 'Q2 4:12', capturedAt: NOW - ageMs, ...o });

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The phase table…');
{
  const up = gameStateOf(g(), { now: NOW, formatKickoff: fmtK });
  assert(up.phase === 'upcoming' && up.label === `K<${g().kickoff}>` && up.score === null && up.fresh === null, '1a: scheduled + kickoff ahead = upcoming, labelled with the viewer-zone kickoff');
  assert(gameStateOf(g({ kickoff: null }), { now: NOW }).phase === 'upcoming' && gameStateOf(g({ kickoff: null }), { now: NOW }).label === 'TBD', '1b: scheduled with an unknown kickoff = upcoming ("TBD"), never awaiting');
  assert(gameStateOf(g({ kickoff: 'not a date' }), { now: NOW }).phase === 'upcoming', '1c: an unparseable kickoff is unknown, not past');
  const aw = gameStateOf(g({ kickoff: new Date(NOW - 1).toISOString() }), { now: NOW });
  assert(aw.phase === 'awaiting' && aw.label === 'Waiting for a score update', '1d: scheduled + kickoff in the past = awaiting, with the honest word');
  assert(gameStateOf(g({ kickoff: new Date(NOW).toISOString() }), { now: NOW }).phase === 'awaiting', '1e: kickoff == now is already awaiting (the boundary)');
  assert(gameStateOf(g({ kickoff: new Date(NOW + 1).toISOString() }), { now: NOW }).phase === 'upcoming', '1f: kickoff one ms ahead is still upcoming');

  const live = (age, extra = {}, entry) => gameStateOf(g({ status: 'live', homeScore: 7, awayScore: 3, ...extra }), { now: NOW, liveEntry: entry === undefined ? cap(age) : entry });
  assert(live(0).phase === 'live' && live(0).label === 'Q2 4:12' && live(0).fresh === true && live(0).pulse === true, '1g: a fresh capture = live, labelled with the capture text, dot pulses');
  assert(live(LIVE_STATUS_STALE_MS).phase === 'live' && live(LIVE_STATUS_STALE_MS).fresh === true, '1h: BOUNDARY — a capture exactly 3:00 old (180 000 ms) is still live');
  const stale = live(LIVE_STATUS_STALE_MS + 1);
  assert(stale.phase === 'live-stale' && stale.label === 'Score may be behind' && stale.fresh === false && stale.pulse === false, '1i: BOUNDARY — 180 001 ms is live-stale, "Score may be behind", the dot does not pulse');
  assert(stale.score.home === 7 && stale.score.away === 3, '1j: a stale game KEEPS its last known score');
  const never = live(0, {}, null);
  assert(never.phase === 'live-stale' && never.capturedAt === null && never.fresh === false, '1k: status live with NO capture at all = live-stale');
  assert(live(-5 * MIN).phase === 'live', '1l: a capture stamped in the future (clock skew) reads as age 0, live');
  assert(gameStateOf(g({ status: 'live', homeScore: 7, awayScore: 3 }), { now: NOW, liveEntry: { name: 'STATUS_HALFTIME', capturedAt: NOW - 1000 } }).label === 'Halftime' && gameStateOf(g({ status: 'live', homeScore: 7, awayScore: 3 }), { now: NOW, liveEntry: { name: 'STATUS_HALFTIME', capturedAt: NOW - 1000 } }).pulse === false, '1m: halftime = live, labelled "Halftime", the dot is still');
  assert(gameStateOf(g({ status: 'live', homeScore: 7, awayScore: 3 }), { now: NOW, liveEntry: { detail: 'Q3 - 10:00' } }).phase === 'live', '1n: an entry with no capturedAt reads as captured just now (the original helper\'s `?? nowMs`)');
  assert(live(10 * MIN, { isManual: true }, null).phase === 'live' && live(10 * MIN, { isManual: true }, null).fresh === null, '1o: a MANUAL game has no provider capture ever — it is live with unknown freshness, never "Score may be behind"');
  assert(live(10 * MIN, { dataSource: 'demo' }, null).phase === 'live' && live(10 * MIN, { dataSource: 'demo' }, null).fresh === null && live(10 * MIN, { dataSource: 'espn' }, null).phase === 'live-stale', '1o2: so does a Demo Simulation game (dataSource demo); a provider-fed game with no capture is still live-stale');
  assert(gameStateOf(g({ status: 'live' }), { now: NOW, liveEntry: cap(0) }).phase === 'no-score', '1p: live with no scores = no-score');

  const fin = gameStateOf(g({ status: 'final', homeScore: 24, awayScore: 17 }), { now: NOW });
  assert(fin.phase === 'final' && fin.label === 'Final' && fin.score.home === 24, '1q: final with a score = final');
  assert(gameStateOf(g({ status: 'final' }), { now: NOW }).phase === 'no-score' && gameStateOf(g({ status: 'final', homeScore: 0, awayScore: null }), { now: NOW }).phase === 'no-score', '1r: final without BOTH scores = no-score (nothing can be called)');
  assert(gameStateOf(g({ status: 'final', homeScore: 0, awayScore: 0 }), { now: NOW }).phase === 'final', '1s: a 0–0 final is a score (zero is not missing)');
  assert(gameStateOf(g({ status: 'postponed' }), { now: NOW }).phase === 'upcoming' && gameStateOf(null, { now: NOW }).phase === 'upcoming', '1t: an unrecognised status or a missing game degrades to upcoming — never throws, never live');
  assert(GS.GAME_PHASES.length === 6 && ['upcoming', 'awaiting', 'live', 'live-stale', 'final', 'no-score'].every(p => GS.GAME_PHASES.includes(p)), '1u: exactly the six phases');
  assert(isLivePhase('live') && isLivePhase('live-stale') && !isLivePhase('final') && !isLivePhase('awaiting') && !isLivePhase('upcoming'), '1v: only live and live-stale count as live — a final / awaiting / upcoming game is never counted live');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] PARITY with the shipped chips…');
{
  // The ORIGINAL liveStatusDisplayShort (js/app.js), frozen verbatim here as the oracle. A drift in the module OR in app.js turns a check red.
  const ORACLE_BUDGET = 14;
  const oracleShort = (entry, nowMs) => {
    if (!entry) return null;
    const isHalftime = entry.name === 'STATUS_HALFTIME';
    const source = isHalftime ? 'Halftime' : (entry.shortDetail || entry.detail || '');
    let pulse = !isHalftime;
    const ageMs = nowMs - (entry.capturedAt ?? nowMs);
    if (ageMs > 3 * 60 * 1000) pulse = false;
    const text = source.length <= ORACLE_BUDGET ? source : source.slice(0, Math.max(0, ORACLE_BUDGET - 1)) + '…';
    return { text, pulse };
  };
  const entries = [
    cap(0), cap(1000, { shortDetail: 'Q4 0:42' }), cap(0, { shortDetail: '' , detail: 'End of 1st Quarter' }), cap(0, { shortDetail: '2nd OT 12:00 remaining' }),
    cap(0, { shortDetail: 'abcdefghijklmn' }), cap(0, { shortDetail: 'abcdefghijklmno' }), { name: 'STATUS_HALFTIME', capturedAt: NOW }, { name: 'STATUS_END_PERIOD', detail: 'End of 3rd', capturedAt: NOW },
    cap(0, { shortDetail: '', detail: '' }), cap(179_000),
  ];
  let same = 0;
  for (const e of entries) {
    const want = oracleShort(e, NOW);
    const st = gameStateOf(g({ status: 'live', homeScore: 1, awayScore: 0 }), { now: NOW, liveEntry: e });
    if (liveDetailLabel(e) === want.text && st.phase === 'live' && st.label === want.text && st.pulse === want.pulse) same++;
  }
  assert(same === entries.length, `2a: a FRESH live capture labels byte-for-byte what the shipped liveStatusDisplayShort() prints, and the dot pulses exactly when it does (${same}/${entries.length} entries)`);
  assert(liveDetailLabel(null) === '' && liveDetailLabel(undefined) === '', '2b: no entry = no label');
  // stale: the shipped helper keeps the quarter text with pulse off; the model replaces it with the honest word and ALSO has pulse off — the one intended difference
  const st = gameStateOf(g({ status: 'live', homeScore: 1, awayScore: 0 }), { now: NOW, liveEntry: cap(5 * MIN) });
  assert(oracleShort(cap(5 * MIN), NOW).pulse === false && st.pulse === false && st.label !== oracleShort(cap(5 * MIN), NOW).text, '2c: a STALE capture is the one place the model differs from the old chip, on purpose: same still dot, the honest label instead of a minutes-old quarter and clock');
  // app.js pins
  const sm = /const LIVE_STATUS_STALE_MS = (\d+) \* (\d+) \* (\d+);/.exec(APP);
  assert(!!sm && Number(sm[1]) * Number(sm[2]) * Number(sm[3]) === LIVE_STATUS_STALE_MS, '2d: the module\'s LIVE_STATUS_STALE_MS equals js/app.js\'s (one three-minute rule)');
  const bm = /const LIVE_STATUS_SHORT_BUDGET = (\d+);/.exec(APP);
  assert(!!bm && Number(bm[1]) === GS.LIVE_STATUS_SHORT_BUDGET, '2e: the 14-character chip budget equals js/app.js\'s');
  const fnStart = APP.indexOf('export function liveStatusDisplayShort(');
  const fnBody = APP.slice(fnStart, APP.indexOf('\n}\n', fnStart) + 3);
  assert(/source\.length <= LIVE_STATUS_SHORT_BUDGET/.test(fnBody) && /entry\.shortDetail \|\| entry\.detail/.test(fnBody) && /entry\.name === 'STATUS_HALFTIME'/.test(fnBody) && /entry\.capturedAt \?\? nowMs/.test(fnBody), '2f: the shipped helper still has the four rules the oracle copies (halftime by name, shortDetail-then-detail, the budget, capturedAt ?? now) — if app.js changes them, this goes red and the oracle must be re-read');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] The freshness line — exact copy…');
{
  const fl = (game, ctx = {}) => freshnessLine(gameStateOf(game, { now: NOW, formatKickoff: fmtK, liveEntry: ctx.entry === undefined ? null : ctx.entry }), { game, now: NOW, formatKickoff: fmtK, formatTime: (ms) => `T<${typeof ms}>` });
  const L = (extra = {}) => g({ status: 'live', homeScore: 7, awayScore: 3, ...extra });
  assert(fl(L(), { entry: cap(12_000) }) === 'Updated 12s ago', '3a: live under a minute → "Updated 12s ago"');
  assert(fl(L(), { entry: cap(59_999) }) === 'Updated 59s ago' && fl(L(), { entry: cap(60_000) }) === 'Updated 1m ago', '3b: the seconds→minutes turn is at 60 s');
  assert(fl(L(), { entry: cap(170_000) }) === 'Updated 2m ago', '3c: live over a minute → whole minutes ("Updated 2m ago")');
  assert(fl(L(), { entry: cap(4 * MIN) }) === 'Scores may be behind — last update 4 min ago.', '3d: live-stale → "Scores may be behind — last update 4 min ago."');
  assert(fl(L(), { entry: null }) === 'Update time unavailable.', '3e: live-stale with no capture → "Update time unavailable."');
  assert(fl(L({ isManual: true }), { entry: null }) === '', '3f: a manual live game claims no freshness at all');
  assert(fl(g({ status: 'final', homeScore: 24, awayScore: 17, lastUpdated: new Date(NOW).toISOString() })) === 'Final · confirmed T<number>', '3g: final → "Final · confirmed {time}" (the time formatter gets the instant)');
  assert(fl(g({ status: 'final', homeScore: 24, awayScore: 17 })) === 'Final', '3h: final with no timestamp → "Final" (no invented time)');
  assert(fl(g()) === `Kickoff K<${g().kickoff}>`, '3i: upcoming → "Kickoff {time}"');
  assert(fl(g({ kickoff: new Date(NOW - 5).toISOString() })) === '' && fl(g({ status: 'live' }), { entry: cap(0) }) === '', '3j: awaiting and no-score need no second line (the label says it)');
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Decided language…');
{
  assert(GS.GAME_PHASES.filter(isDecided).join() === 'final', '4a: isDecided() is true for final and for NO other phase');
  assert(coverWord('live', true) === 'covering' && coverWord('live-stale', false) === 'trailing' && coverWord('live', null) === 'right on the number', '4b: live phases are tentative — covering / trailing / right on the number');
  assert(coverWord('final', true) === 'covered' && coverWord('final', false) === 'did not cover' && coverWord('final', null) === 'push', '4c: final is settled — covered / did not cover / push');
  assert(['upcoming', 'awaiting', 'no-score'].every(p => coverWord(p, true) === '' && coverWord(p, false) === ''), '4d: a game that has not produced a score has no cover language at all');
  assert(['live', 'live-stale'].every(p => !containsBannedLiveWord(coverWord(p, true)) && !containsBannedLiveWord(coverWord(p, false)) && !containsBannedLiveWord(coverWord(p, null))), '4e: no live cover word is a banned word');
  const bannedSamples = ['You won this one', 'He lost', 'clinched the week', 'Locked in!', 'This is decided', 'LOST by 3'];
  assert(bannedSamples.every(containsBannedLiveWord), '4f: the scanner catches won / lost / clinched / locked in / decided, in any case');
  const okSamples = ['wonder', 'a lostgame', 'Texas is covering by 2.5', 'unclinched', 'preceded', 'Score may be behind', 'Waiting for a score update'];
  assert(okSamples.every(s => !containsBannedLiveWord(s)), '4g: the scanner uses word boundaries — "wonder", "undecided"-style substrings and the module\'s own labels pass');
  assert(Object.values(PHASE_LABELS).every(t => !containsBannedLiveWord(t)), '4h: none of the module\'s own labels is a banned word');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] Purity…');
{
  const code = stripComments(SRC);
  assert(!/^\s*import\s/m.test(code) && !/\brequire\(/.test(code), '5a: no imports at all — a leaf module');
  assert(!/\b(localStorage|load\(|save\(|document\.|window\.|fetch\()/.test(code), '5b: no storage, no DOM, no network');
  assert((code.match(/Date\.now\(\)/g) || []).length === 2 && (code.match(/now = Date\.now\(\)/g) || []).length === 2, '5c: the clock is only ever a parameter default (two `now = Date.now()` defaults, no other call)');
  assert(!/Math\.random/.test(code) && !/\.at\(|Object\.hasOwn/.test(code), '5d: deterministic; iOS 15.0 safe (no .at() / Object.hasOwn)');
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file)…');
{
  const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + Math.random());
  const probe = (m) => {
    const lv = (age) => m.gameStateOf(g({ status: 'live', homeScore: 7, awayScore: 3 }), { now: NOW, liveEntry: cap(age) });
    const out = {
      boundaryLive: lv(180000).phase === 'live',
      boundaryStale: lv(180001).phase === 'live-stale',
      awaiting: m.gameStateOf(g({ kickoff: new Date(NOW - 1).toISOString() }), { now: NOW }).phase === 'awaiting',
      manual: m.gameStateOf(g({ status: 'live', homeScore: 1, awayScore: 0, isManual: true }), { now: NOW, liveEntry: null }).phase === 'live',
      decided: m.isDecided('live') === false && m.isDecided('final') === true,
      noScore: m.gameStateOf(g({ status: 'final' }), { now: NOW }).phase === 'no-score',
    };
    return out;
  };
  const base = probe(GS);
  assert(Object.values(base).every(Boolean), '6-0: the probe is GREEN on the real module (positive control)');
  const mutants = [
    ['the stale window is 4 minutes', SRC.replace('3 * 60 * 1000', '4 * 60 * 1000'), 'boundaryStale'],
    ['stale is >= instead of >', SRC.replace('ageMs <= staleMs', 'ageMs < staleMs'), 'boundaryLive'],
    ['awaiting is dropped (a past-kickoff game stays "upcoming")', SRC.replace('kickoffMs !== null && kickoffMs <= now', 'false'), 'awaiting'],
    ['a manual game is judged stale', SRC.replace("if (g.isManual === true || g.dataSource === 'demo') return", 'if (false) return'), 'manual'],
    ['live counts as decided', SRC.replace("phase === 'final'", "phase === 'final' || phase === 'live'"), 'decided'],
    ['a final with no score keeps the final phase', SRC.replace("return hasScore ? { ...base, phase: 'final'", "return true ? { ...base, phase: 'final'"), 'noScore'],
  ];
  for (const [name, src, check] of mutants) {
    let res;
    try { res = probe(await load(src)); } catch (e) { res = { [check]: false }; }
    assert(src !== SRC && res[check] === false, `6: mutant "${name}" turns ${check} RED`);
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
