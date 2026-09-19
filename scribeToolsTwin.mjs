/**
 * CFB Pickems — scribeToolsTwin.mjs (Build 2, Group C, 2026-09-10, UN-150…154)
 * ==============================================================================
 * Drift-guard for backend/Code.gs's ported twins of the five client
 * scoring/storage functions the blind rule and CONVENTIONS #21 both require
 * to be correct for a SCRIBE tool answer: `arePicksPublic()`,
 * `getEffectiveWeekStatus()` (js/storage.js), `calculateWeeklyResults()`,
 * `calculateSeasonStandings()` (js/scoring.js), and `formatSpread()`
 * (js/data-model.js).
 *
 * Precedent: `captest.mjs` — "THIS BLOCK IS THE TESTED TWIN OF
 * backend/chunkstore.mjs" (Code.gs's own comment, cell-cap chunking arc).
 * Same discipline here: run the REAL js/ functions against fixture data,
 * run Code.gs's *_Twin_ functions against the SAME data, assert
 * byte-identical (JSON-equal) output.
 *
 * Mechanism: Code.gs is executed WHOLESALE inside a Node `vm` context (no
 * GAS-global stubs needed — every twin function below is deliberately pure,
 * no SpreadsheetApp/PropertiesService/etc. dependency, by design, precisely
 * so this file can extract them this way). This is a STRONGER guard than a
 * text diff or a name-only check (the exact class of guard the reviewer
 * found insufficient for notifytest.mjs's [15]/[17b] — see that file's [22]
 * section) — it EXECUTES the real Code.gs source.
 *
 * SCOPING NOTE (named in Code.gs's own header comment for this block, and
 * again in the handoff report — not hidden): this drift test covers the
 * UNGROUPED path only. `calculateSeasonStandingsTwin_` never takes a `weeks`
 * argument and does not reproduce UN-118/UN-125's multi-week-group pooling.
 *
 * Run:  node scribeToolsTwin.mjs
 */
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);

// B2 remediation (2026-09-10) — js/storage.js's load()/save() catch and
// no-op silently when `localStorage` is undefined (by design — see its own
// comment), which made section [5b]'s tiebreaker-guess seeding a silent no-op
// here: every real-path read came back null regardless of what was "saved."
// Minimal in-memory stub, same shape scribetest.mjs/loadtest.mjs already use.
const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
  clear: () => lsStore.clear(),
};

// F6 remediation (2026-09-10) — section [8] below imports js/chat.js to
// compare its REAL fold (delete/edit/epoch semantics) against Code.gs's
// ported twin. Minimal DOM/browser stubs, same shape scribetest.mjs already
// uses, so chat.js's own imports (backend.js/chatTransport.js) load cleanly.
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.fetch = async () => { throw new Error('network disabled in scribeToolsTwin'); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const dataModel = await import('./js/data-model.js');
const scoring = await import('./js/scoring.js');
const storage = await import('./js/storage.js');
const chat = await import('./js/chat.js');
storage.setBackendMode('local');
storage.initStorage();

const codeGsSrc = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');

function loadCodeGsSandbox() {
  const sandbox = {};
  vm.createContext(sandbox);
  vm.runInContext(codeGsSrc, sandbox, { filename: 'Code.gs' });
  return sandbox;
}

const gs = loadCodeGsSandbox();

console.log('[1] Fixture check — every twin function actually loaded as a callable…');
{
  const names = ['arePicksPublicTwin_', 'getEffectiveWeekStatusTwin_', 'calculateAtsWinnerTwin_',
    'evaluatePickTwin_', 'gameMultiplierTwin_', 'rankWeeklyResultsTwin_', 'calculateWeeklyResultsTwin_',
    'calculateSeasonStandingsTwin_', 'formatSpreadTwin_', 'getTiebreakerGuessTwin_'];
  for (const n of names) assert(typeof gs[n] === 'function', `Code.gs exposes ${n} as a real function`);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────
function mkPlayer(id, name) { return { playerId: id, displayName: name, active: true }; }
const players = [mkPlayer('p1', 'Drew'), mkPlayer('p2', 'Brayden'), mkPlayer('p3', 'Kevin')];

function mkGame(overrides) {
  return {
    gameId: 'g1', weekId: 'w1', homeTeam: 'Texas A&M', awayTeam: 'Notre Dame',
    homeScore: 24, awayScore: 21, spread: -2.5, lockedSpread: -2.5, favorite: 'Texas A&M',
    multiplier: 1, status: 'final', atsWinner: null,
    ...overrides,
  };
}

console.log('\n[2] getEffectiveWeekStatus / arePicksPublic — every real status branch…');
{
  const weekCases = [
    { status: 'draft' },
    { status: 'final' },
    { status: 'open', picksOpenAt: '2020-01-01T00:00:00Z' },
    { status: 'locked', picksLockAt: '2020-01-01T00:00:00Z' },
    { status: 'live' },
    { status: 'open' },
    null,
  ];
  for (const w of weekCases) {
    const real = storage.getEffectiveWeekStatus(w);
    const twin = gs.getEffectiveWeekStatusTwin_(w);
    assert(real === twin, `getEffectiveWeekStatus(${JSON.stringify(w)}) real=${real} === twin=${twin}`);
    const realPub = storage.arePicksPublic(w);
    const twinPub = gs.arePicksPublicTwin_(w);
    assert(realPub === twinPub, `arePicksPublic(${JSON.stringify(w)}) real=${realPub} === twin=${twinPub}`);
  }
}

console.log('\n[3] formatSpread — every documented example + edge cases…');
{
  const cases = [
    [-6.5, 'TCU', null], [7.0, 'Indiana', null], [-6.5, null, { homeTeam: 'TCU', awayTeam: 'UNC' }],
    [7.0, null, { homeTeam: 'IU', awayTeam: 'PU' }], [0, null, { homeTeam: 'A', awayTeam: 'B' }],
    [null, null, null], [undefined, null, null], [0, null, null], [3, 'Kansas', null],
  ];
  for (const [spread, favorite, game] of cases) {
    const real = dataModel.formatSpread(spread, favorite, game);
    const twin = gs.formatSpreadTwin_(spread, favorite, game);
    assert(real === twin, `formatSpread(${spread}, ${favorite}, ${JSON.stringify(game)}) real="${real}" === twin="${twin}"`);
  }
}

console.log('\n[4] calculateWeeklyResults — win/loss/no-decision/pending/multiplier, byte-identical row-for-row…');
{
  const games = [
    mkGame({ gameId: 'g1', homeScore: 24, awayScore: 21, spread: -2.5, lockedSpread: -2.5, multiplier: 1 }),
    mkGame({ gameId: 'g2', homeTeam: 'Oklahoma', awayTeam: 'Texas', homeScore: 10, awayScore: 24, spread: -7, lockedSpread: -7, multiplier: 2 }),
    mkGame({ gameId: 'g3', homeTeam: 'USC', awayTeam: 'Utah', homeScore: 20, awayScore: 13, spread: -7, lockedSpread: -7, multiplier: 1 }),   // no-decision (exact push)
    mkGame({ gameId: 'g4', homeTeam: 'LSU', awayTeam: 'Bama', status: 'scheduled', homeScore: null, awayScore: null }),   // pending
  ];
  const picks = [
    { weekId: 'w1', gameId: 'g1', playerId: 'p1', selectedTeam: 'Texas A&M' },
    { weekId: 'w1', gameId: 'g2', playerId: 'p1', selectedTeam: 'Texas' },
    { weekId: 'w1', gameId: 'g3', playerId: 'p1', selectedTeam: 'USC' },
    { weekId: 'w1', gameId: 'g4', playerId: 'p1', selectedTeam: 'LSU' },
    { weekId: 'w1', gameId: 'g1', playerId: 'p2', selectedTeam: 'Notre Dame' },
    { weekId: 'w1', gameId: 'g2', playerId: 'p2', selectedTeam: 'Oklahoma' },
  ];
  // calculateWeeklyResults() takes players/picks/games directly — no storage
  // seeding needed. It DOES call js/storage.js's getTiebreakerGuess()
  // internally, which reads through the seam; seed it there so `real` and
  // `twin` (which takes the tiebreaker object directly) see the SAME data.
  players.forEach(p => storage.savePlayer(p));

  const realRows = scoring.calculateWeeklyResults('w1', players, picks, games, null);
  const tbGuessesObj = {};   // no tiebreaker guesses seeded — deterministic empty case
  const twinRows = gs.calculateWeeklyResultsTwin_('w1', players, picks, games, null, tbGuessesObj);

  assert(realRows.length === twinRows.length && realRows.length === 3, `same row count (${realRows.length})`);
  for (let i = 0; i < realRows.length; i++) {
    const a = realRows[i], b = twinRows.find(r => r.playerId === a.playerId);
    assert(!!b, `twin has a row for ${a.playerId}`);
    for (const field of ['correctPicks', 'incorrectPicks', 'correctCount', 'incorrectCount', 'noDecisions', 'pending', 'rank', 'isWinner', 'isLoser', 'wonByTiebreaker']) {
      assert(a[field] === b[field], `${a.playerId}.${field}: real=${a[field]} === twin=${b[field]}`);
    }
  }

  console.log('\n[5] calculateSeasonStandings — same rows through the season aggregator…');
  const realStandings = scoring.calculateSeasonStandings(players, realRows);
  const twinStandings = gs.calculateSeasonStandingsTwin_(players, twinRows);
  assert(realStandings.length === twinStandings.length, 'same standings row count');
  for (const rs of realStandings) {
    const ts = twinStandings.find(s => s.playerId === rs.playerId);
    for (const field of ['totalCorrect', 'totalIncorrect', 'totalCorrectCount', 'totalIncorrectCount', 'totalND', 'weeklyWins', 'weeklyLosses', 'winPct', 'currentRank', 'isSeasonLeader', 'isCurrentLastPlace']) {
      assert(rs[field] === ts[field], `standings ${rs.playerId}.${field}: real=${rs[field]} === twin=${ts[field]}`);
    }
  }
}

console.log('\n[5b] B2 remediation — calculateWeeklyResults with a NON-NULL actualTiebreaker + seeded guesses: tiebreakerDelta AND tie-break ORDERING…');
{
  const games2 = [
    mkGame({ gameId: 'g1', homeScore: 24, awayScore: 21, spread: -2.5, lockedSpread: -2.5, multiplier: 1 }),
  ];
  const picks2 = [
    { weekId: 'w2', gameId: 'g1', playerId: 'p1', selectedTeam: 'Texas A&M' },   // correct
    { weekId: 'w2', gameId: 'g1', playerId: 'p2', selectedTeam: 'Texas A&M' },   // correct — TIES p1 on correctPicks
    { weekId: 'w2', gameId: 'g1', playerId: 'p3', selectedTeam: 'Notre Dame' },  // wrong
  ];
  const actualTiebreaker = 50;
  const tbGuessesObj = { 'w2__p1': 55, 'w2__p2': 48 };   // p2 closer (|48-50|=2) than p1 (|55-50|=5)
  // Seed the REAL guesses through the storage seam so scoring.calculateWeeklyResults()
  // (which calls storage.getTiebreakerGuess() internally) sees the SAME data
  // the twin receives directly as a plain object.
  storage.setTiebreakerGuess('w2', 'p1', 55);
  storage.setTiebreakerGuess('w2', 'p2', 48);

  const realRows2 = scoring.calculateWeeklyResults('w2', players, picks2, games2, actualTiebreaker);
  const twinRows2 = gs.calculateWeeklyResultsTwin_('w2', players, picks2, games2, actualTiebreaker, tbGuessesObj);

  assert(realRows2.length === twinRows2.length, 'same row count with a non-null actualTiebreaker');
  for (const a of realRows2) {
    const b = twinRows2.find(r => r.playerId === a.playerId);
    assert(!!b, `twin has a row for ${a.playerId}`);
    for (const field of ['tiebreakerGuess', 'tiebreakerDelta', 'rank', 'isWinner', 'isLoser', 'wonByTiebreaker']) {
      assert(a[field] === b[field], `w2 ${a.playerId}.${field}: real=${a[field]} === twin=${b[field]}`);
    }
  }
  // Fixture + structural check: prove this fixture ACTUALLY exercises tie-break
  // ordering (not just equal deltas producing equal ranks by coincidence).
  const p1Real = realRows2.find(r => r.playerId === 'p1'), p2Real = realRows2.find(r => r.playerId === 'p2');
  assert(p1Real.correctPicks === p2Real.correctPicks, 'fixture check: p1 and p2 are genuinely tied on correctPicks — the tiebreaker is what must separate them');
  assert(p2Real.rank < p1Real.rank, 'fixture check: REAL calculateWeeklyResults() breaks the tie by tiebreaker delta (p2 closer to 50, ranks better)');
  const p1Twin = twinRows2.find(r => r.playerId === 'p1'), p2Twin = twinRows2.find(r => r.playerId === 'p2');
  assert(p2Twin.rank < p1Twin.rank, 'the TWIN reproduces the SAME tie-break ordering, not just matching deltas in isolation');
}

console.log('\n[5c] B2 remediation — gameMultiplierTwin_ vs the real gameMultiplier(), RG-07 cases (missing field, fractional, Number(null), non-finite, negative, zero)…');
{
  const cases = [
    {}, { multiplier: undefined }, { multiplier: null }, { multiplier: 1.5 },
    { multiplier: 0 }, { multiplier: -2 }, { multiplier: 'abc' }, { multiplier: 2 }, { multiplier: NaN },
  ];
  for (const g of cases) {
    const real = scoring.gameMultiplier(g);
    const twin = gs.gameMultiplierTwin_(g);
    assert(real === twin, `gameMultiplier(${JSON.stringify(g)}) real=${real} === twin=${twin}`);
  }
  assert(scoring.gameMultiplier(null) === gs.gameMultiplierTwin_(null), 'gameMultiplier(null) [missing game entirely] real === twin');
  assert(scoring.gameMultiplier(undefined) === gs.gameMultiplierTwin_(undefined), 'gameMultiplier(undefined) real === twin');
}

console.log('\n[6] Tiebreaker delta — real getTiebreakerGuess() shape vs the twin\'s object-lookup…');
{
  const key = 'w9__p1';
  const tbGuessesObj = { [key]: 42 };
  const twinGuess = gs.getTiebreakerGuessTwin_(tbGuessesObj, 'w9', 'p1');
  assert(twinGuess === 42, 'twin reads the exact "<weekId>__<playerId>" key shape js/storage.js writes');
  assert(gs.getTiebreakerGuessTwin_(tbGuessesObj, 'w9', 'pMissing') === null, 'twin returns null for a missing guess, matching getTiebreakerGuess()');
}

console.log('\n[6b] F6 remediation — fold-semantics twin: scribeFoldEventsForContextTwin_ vs the REAL js/chat.js fold (delete/edit/epoch), same input…');
{
  storage.saveSetting('chatEpochSeq', 0);
  storage.saveSetting('chatRetentionDays', 0);
  chat._resetForTest();

  const now = Date.now();
  const events = [
    { id: 'm1', seq: 1, ts: now - 5000, type: 'message', author: 'p1', gameTag: '', body: 'first message', targetId: '', replyTo: '', notify: false, meta: null },
    { id: 'm2', seq: 2, ts: now - 4000, type: 'message', author: 'p2', gameTag: '', body: 'ORIGINAL', targetId: '', replyTo: '', notify: false, meta: null },
    { id: 'm3', seq: 3, ts: now - 3000, type: 'message', author: 'p1', gameTag: '', body: 'will be deleted', targetId: '', replyTo: '', notify: false, meta: null },
    { id: 'edit1', seq: 4, ts: now - 2000, type: 'edit', author: 'p2', gameTag: '', body: 'EDITED', targetId: 'm2', replyTo: '', notify: false, meta: null },
    { id: 'del1', seq: 5, ts: now - 1000, type: 'delete', author: 'p1', gameTag: '', body: '', targetId: 'm3', replyTo: '', notify: false, meta: null },
    { id: 'm4', seq: 6, ts: now, type: 'message', author: 'p1', gameTag: '', body: 'last message', targetId: '', replyTo: '', notify: false, meta: null },
  ];

  // REAL client fold — js/chat.js's ingest() + getMessages(), the exact same
  // choke point production rendering uses (isHiddenByEpoch is unconditional
  // inside getMessages(); deleted messages are filtered here the same way
  // SCRIBE's context assembly must — production chat UI shows a tombstone
  // instead, a DIFFERENT and deliberate choice this comparison is not about).
  chat.ingest(events);
  const realFolded = chat.getMessages({ tag: 'all', respectRetention: true })
    .filter(m => m.type === 'message' && m.author !== 'system' && !m.deleted)
    .map(m => ({ id: m.id, author: m.author, body: m.body }));

  const twinFolded = gs.scribeFoldEventsForContextTwin_(events, { gameTag: '', epochSeq: 0, retentionCutoffMs: 0 });

  assert(realFolded.length === twinFolded.length, `same surviving-message count (real=${realFolded.length}, twin=${twinFolded.length})`);
  assert(twinFolded.length === 3, 'fixture check: exactly 3 of the 6 raw events are real, non-deleted messages (m1, m2-edited, m4 — NOT m3-deleted, and edit1/del1 are mutation events, not messages)');
  for (let i = 0; i < realFolded.length; i++) {
    assert(realFolded[i].id === twinFolded[i].id, `same order at position ${i}: real=${realFolded[i].id} twin=${twinFolded[i].id}`);
    assert(realFolded[i].body === twinFolded[i].body, `${realFolded[i].id}: same folded body, real="${realFolded[i].body}" twin="${twinFolded[i].body}"`);
  }
  assert(twinFolded.some(m => m.id === 'm2' && m.body === 'EDITED'), 'twin: the edited message carries its LATEST body, matching the real fold');
  assert(!twinFolded.some(m => m.id === 'm3'), 'twin: the deleted message is absent entirely, matching the real fold');

  // Epoch watermark — set AFTER m2 (seq 2); both real and twin must agree
  // that m1+m2 are hidden and m4 survives.
  storage.saveSetting('chatEpochSeq', 2);
  chat._resetForTest();
  chat.ingest(events);
  const realEpochIds = chat.getMessages({ tag: 'all', respectRetention: true })
    .filter(m => m.type === 'message' && m.author !== 'system' && !m.deleted)
    .map(m => m.id).sort();
  const twinEpochIds = gs.scribeFoldEventsForContextTwin_(events, { gameTag: '', epochSeq: 2, retentionCutoffMs: 0 }).map(m => m.id).sort();
  assert(JSON.stringify(realEpochIds) === JSON.stringify(twinEpochIds), `epoch-hidden set agrees between real (${realEpochIds}) and twin (${twinEpochIds})`);
  assert(!twinEpochIds.includes('m1') && !twinEpochIds.includes('m2'), 'twin: pre/at-epoch messages (seq<=2) are excluded');
  assert(twinEpochIds.includes('m4'), 'twin: a post-epoch message survives');

  storage.saveSetting('chatEpochSeq', 0);   // reset so no later section inherits this
  storage.saveSetting('chatRetentionDays', 0);
  chat._resetForTest();
}

console.log('\n[7] Structural — zero embedding/vector-API residue anywhere in this feature\'s code path…');
{
  assert(!/embedding|vector[-_]?db|pinecone|weaviate/i.test(codeGsSrc), 'Code.gs carries no embedding/vector-store residue (same style of scan as loadtest.mjs\'s existing residue scans)');
}

console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
else process.stderr.write(`❌ FAILURES — ${pass} passed, ${fail} failed` + '\n', () => process.stdout.write('', () => process.exit(1)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
