/**
 * CFB Pickems — scoringtest.mjs (Build 3, Group D, 2026-09-11, DI-D1)
 * ===========================================================================
 * Unit tests for the CLIENT half of Group D — the cheap, free, deterministic
 * "should SCRIBE speak?" gate in js/scribeLines.js. The expensive half (the
 * paid post, and the server-side re-check of everything decided here) is
 * covered by memorytest.mjs.
 *
 * This file is the D1 counterpart to grouptest.mjs's role for scoring math:
 * a proof that reads start to finish, in its own file, not buried among the
 * chat-fold assertions in loadtest.mjs (CONVENTIONS #28).
 *
 * Run:  node scoringtest.mjs
 * Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 *
 * Sections — in run order; [12] (the mutation section) deliberately sits last
 * in the file but keeps its original number, because every assertion that
 * cites it would otherwise go stale:
 *   [1]  scoreOpportunity is PURE — identical input, identical output, twice
 *   [2]  Threshold semantics — exactly AT fires, one point below never, all five levels
 *   [3]  The five levels; the canonical table lives in js/data-model.js and the
 *        client, the re-export and backend/Code.gs all agree
 *   [4]  The 10-minute bucket — concurrent signals COMBINE (max + 0.5 x the next
 *        two distinct), a signal from the previous bucket does not
 *   [5]  The free prefilter — word-boundary matches, true and false cases
 *   [6]  Cooldown floors apply at EVERY level, Unhinged included
 *   [7]  The consecutive-post guard over the already-hydrated fold
 *   [8]  The remote call fires only when the score clears, once per bucket
 *   [9]  The classifier path — prefilter -> classify -> points -> score
 *   [10] Tier 0 is unchanged; one event still yields one SCRIBE message
 *   [11] The reservation rolls back when the post does not happen
 *   [12] MUTATION-PROOFS (in-memory source copies, never the file, never git):
 *        `>` vs `>=`, the cooldown floor, deduped-rollback, per-room-only bounds,
 *        flat sum, no name collapse
 *   [13] F4 — a dedupe is a POST: the reservation is kept; which states latch
 *   [14] F3 — the detectors, on fixtures (incl. the blind rule on `unanimous`)
 *   [15] F3 — detected signals feed the same gate as every other signal
 *   [16] Note 14 — the in-flight classifier latch is reset between tests
 *   [17] BLOCK-2 — the league-wide floor: a 3-game finalize posts ONCE
 *   [18] BLOCK-2 — per-room floors and the room-agnostic consecutive guard
 *   [19] N-1/N-5 — the client refuses to guess at an unorderable history, and
 *        orders weeks the way the server does
 *   [20] N-3 — the frequency dial is validated at the boundary
 *   [21] FINDING 1 — the dial discriminates; cardinality cannot inflate a score
 *   [22] FINDING 1 — client and server compute the SAME score (cross-runtime twin)
 *   [23] FINDING 1 — all five levels discriminate against REAL detector output
 *   [24] FINDING 5 — a milestone is never a weighted number
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
console.log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);

// ── DOM/browser stubs, same shape as scribetest.mjs's ──────────────────────
const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
  clear: () => lsStore.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in scoringtest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const scribeLines = await import('./js/scribeLines.js');
const scribeAgent = await import('./js/scribeAgent.js');
const storage = await import('./js/storage.js');
const chat = await import('./js/chat.js');
const {
  scoreOpportunity, chatClaimPrefilter, considerAutonomous, scribeTrigger, scribeInspectMessage,
  detectWeekSignals, considerWeekSignals, orderedGradedResults, MILESTONE_MARKS,
  FREQUENCY_LEVELS, FREQUENCY_DEFAULT, FREQUENCY_COPY, MEMORY_COPY, SIGNAL_POINTS,
  _resetAutonomousStateForTest,
} = scribeLines;

const LAST_POST_KEY = 'cfbp_scribe_lastpost';
const LEDGER_KEY = 'cfbp_scribe_ledger';
function resetAll() {
  _resetAutonomousStateForTest();
  lsStore.delete(LAST_POST_KEY);
  lsStore.delete(LEDGER_KEY);
  chat._resetForTest();
  storage.saveSetting('scribeFrequency', 'balanced');
  storage.saveSetting('scribeAutonomousEnabled', true);
  scribeAgent.wireScribeRemoteTransport({ autonomous: null, classify: null });
}
/** Wires a recording stub in place of js/backend.js's (not-yet-written)
 *  relays — the injection seam js/scribeAgent.js documents. */
function wireStub({ autonomousResult = { ok: true, posted: true }, classifyResult = { ok: true, points: 0 } } = {}) {
  const calls = { autonomous: [], classify: [] };
  scribeAgent.wireScribeRemoteTransport({
    autonomous: async body => { calls.autonomous.push(body); return (typeof autonomousResult === 'function') ? autonomousResult(body) : autonomousResult; },
    classify: async body => { calls.classify.push(body); return (typeof classifyResult === 'function') ? classifyResult(body) : classifyResult; },
  });
  return calls;
}
function ev(o) {
  return { id: o.id, seq: o.seq, ts: o.ts ?? o.seq * 1000, type: o.type || 'message',
           author: o.author || 'p1', gameTag: o.gameTag || '', body: o.body || '',
           targetId: o.targetId || '', replyTo: '', notify: !!o.notify, meta: o.meta || null };
}
function setCooldown(gameTag, ms) {
  const lp = JSON.parse(lsStore.get(LAST_POST_KEY) || '{}');
  lp[gameTag || 'main'] = ms;
  lsStore.set(LAST_POST_KEY, JSON.stringify(lp));
}
function getCooldown(gameTag) {
  return JSON.parse(lsStore.get(LAST_POST_KEY) || '{}')[gameTag || 'main'] || 0;
}
// BLOCK-2 — the league-wide autonomous floor shares the same device-local map
// under a reserved key no gameTag can produce.
const ALL_KEY = ':autonomous_all';
function getGlobalCooldown() { return JSON.parse(lsStore.get(LAST_POST_KEY) || '{}')[ALL_KEY] || 0; }
function setGlobalCooldown(ms) {
  const lp = JSON.parse(lsStore.get(LAST_POST_KEY) || '{}');
  lp[ALL_KEY] = ms;
  lsStore.set(LAST_POST_KEY, JSON.stringify(lp));
}
function clearCooldowns() { lsStore.delete(LAST_POST_KEY); }

// ═══════════════════════════════════════════════════════════════════════════
console.log('[1] scoreOpportunity is PURE — same input, same output, twice…');
{
  const signals = [{ signal: 'backdoorBust' }, { signal: 'verbosity' }];
  const a = scoreOpportunity(signals, { level: 'balanced', now: 1_700_000_000_000 });
  const b = scoreOpportunity(signals, { level: 'balanced', now: 1_700_000_000_000 });
  assert(JSON.stringify(a) === JSON.stringify(b), 'two calls with identical input produce byte-identical output');
  assert(a.score === 55, `backdoorBust (50) + verbosity (10) = 50 + 0.5x10 = 55 (got ${a.score})`);
  assert(a.counted.length === 2, 'every contributing signal is itemized ONCE, so E3 can replay WHY a score was what it was');
  const c = scoreOpportunity(signals, { level: 'balanced' });
  assert(c.score === 55, 'omitting `now` scores the same — no hidden clock dependence');
  assert(scoreOpportunity([], { level: 'balanced' }).score === 0, 'no signals scores 0');
  assert(scoreOpportunity([{ signal: 'nonsense' }], { level: 'balanced' }).score === 0, 'an unknown signal contributes 0, never NaN');
  const explicit = scoreOpportunity([{ signal: 'claim', points: 45 }], { level: 'balanced' });
  assert(explicit.score === 45, "an explicit `points` overrides the table — that is how the classifier's verdict enters the score");
  assert(SIGNAL_POINTS.claim === 0, 'and a bare `claim` signal is worth 0 on its own: a keyword match is a reason to ASK, never to speak');
  assert(scoreOpportunity([{ signal: 'backdoorBust' }], { level: 'nonsense-level' }).threshold === FREQUENCY_LEVELS[FREQUENCY_DEFAULT],
    'an unrecognized level reads as Balanced — a malformed value makes SCRIBE quieter-or-equal, never opens the gate');
}

console.log('\n[2] Threshold semantics — exactly AT fires, one point below never…');
{
  for (const [level, threshold] of Object.entries(FREQUENCY_LEVELS)) {
    const at = scoreOpportunity([{ signal: 'x', points: threshold }], { level });
    const below = scoreOpportunity([{ signal: 'x', points: threshold - 1 }], { level });
    assert(at.clears === true, `${level}: a score of exactly ${threshold} CLEARS (>=, not >)`);
    assert(below.clears === false, `${level}: ${threshold - 1} does not`);
  }
}

console.log('\n[3] The five levels, and client/server agreement…');
{
  assert(Object.keys(FREQUENCY_LEVELS).join(',') === 'quiet,reserved,balanced,active,unhinged', 'all five DI-named levels exist');
  assert(FREQUENCY_LEVELS.quiet === 85 && FREQUENCY_LEVELS.reserved === 65 && FREQUENCY_LEVELS.balanced === 45 &&
         FREQUENCY_LEVELS.active === 25 && FREQUENCY_LEVELS.unhinged === 15, "the thresholds are DI-D1's: 85/65/45/25/15");
  assert(FREQUENCY_DEFAULT === 'balanced', 'Balanced is the default');
  assert(FREQUENCY_COPY.length === 5, "Drew's D-1 ruling: all five are exposed, so all five need copy");
  assert(FREQUENCY_COPY.every(c => FREQUENCY_LEVELS[c.level] !== undefined && c.description),
    'every copy entry names a real level and carries its description (pass 2 imports these rather than retyping them)');
  assert(FREQUENCY_COPY[4].description === 'Maximum SCRIBE. You asked for this.', 'the approved Unhinged line is verbatim from the copy pass');
  assert(MEMORY_COPY.emptyState === 'Nothing recorded yet — that builds as SCRIBE gets to know you.', "D4's approved empty state is exported for pass 2");
  assert(/delete it if it's wrong/.test(MEMORY_COPY.unconfirmedTag), "…as is the approved 'unconfirmed' explainer");

  // N-3 — the canonical client table now lives in js/data-model.js (the one
  // module both js/scribeLines.js and js/scribeAgent.js can import without a
  // cycle); this module re-exports it. Assert the re-export is the SAME
  // object, then compare against the server's unavoidable third copy.
  const dataModelSrc = await readFile(fileURLToPath(new URL('./js/data-model.js', import.meta.url)), 'utf8');
  const canonical = /export const SCRIBE_FREQUENCY_LEVELS = \{([^}]*)\}/.exec(dataModelSrc);
  assert(!!canonical, 'fixture check: the canonical table was found in js/data-model.js');
  const canonicalParsed = {};
  for (const part of canonical[1].split(',')) {
    const kv = /(\w+)\s*:\s*(\d+)/.exec(part);
    if (kv) canonicalParsed[kv[1]] = Number(kv[2]);
  }
  assert(JSON.stringify(canonicalParsed) === JSON.stringify(FREQUENCY_LEVELS),
    'js/scribeLines.js re-exports the canonical table unchanged — one definition, two importers');

  // The two runtimes cannot import each other. Parse both.
  const codeGs = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  const m = /var SCRIBE_FREQUENCY_THRESHOLDS_ = \{([^}]*)\}/.exec(codeGs);
  assert(!!m, 'fixture check: the server table was found by the parse (a miss would make the comparison vacuous)');
  const serverTable = {};
  for (const part of m[1].split(',')) {
    const kv = /(\w+)\s*:\s*(\d+)/.exec(part);
    if (kv) serverTable[kv[1]] = Number(kv[2]);
  }
  assert(JSON.stringify(serverTable) === JSON.stringify(FREQUENCY_LEVELS),
    `the client and server threshold tables are identical — a one-sided edit fails HERE instead of splitting the two runtimes (server: ${JSON.stringify(serverTable)})`);
  assert(/SCRIBE_FREQUENCY_DEFAULT_ = 'balanced'/.test(codeGs), 'and the server default matches the client default');
}

console.log('\n[4] The 10-minute bucket — concurrent signals COMBINE (max + 0.5 x the next two), stale ones do not…');
{
  const now = 1_700_000_000_000;
  const tenMin = 10 * 60 * 1000;
  const summed = scoreOpportunity([{ signal: 'unanimous', ts: now }, { signal: 'drinkDebt', ts: now + 1000 }], { level: 'balanced', now });
  assert(summed.score === 32.5, `unanimous (25) + drinkDebt (15) in the same bucket combine to 25 + 0.5x15 = 32.5 (got ${summed.score})`);
  const stale = scoreOpportunity([{ signal: 'unanimous', ts: now - tenMin * 2 }, { signal: 'drinkDebt', ts: now }], { level: 'balanced', now });
  assert(stale.score === 15, `a signal from two buckets ago is NOT counted (got ${stale.score})`);
  const untimed = scoreOpportunity([{ signal: 'unanimous' }], { level: 'balanced', now });
  assert(untimed.score === 25, "a signal with no timestamp belongs to `now`'s bucket");
}

console.log('\n[5] The free prefilter — the stage that keeps silence free…');
{
  const yes = ['Texas covers, I guarantee it', 'this is a LOCK', "no way they lose", 'book it', "can't lose this week",
               "I'm 100% sure", 'Alabama wins by 20 with 90% certainty', 'calling it now: Ohio State'];
  // Note 11 (reviewer) — WORD BOUNDARIES. These four are the sentences this
  // chat actually produces every week; a substring match on 'lock' bought a
  // paid classifier call for every one of them.
  const no = ['what time is kickoff', 'lol', 'anyone else watching this', 'my picks are in',
              'that was rough', 'see you guys saturday', '',
              'picks are locked in', 'the week locks at noon', 'unlock the thread', 'watching the clock'];
  for (const s of yes) assert(chatClaimPrefilter(s) === true, `prefilter catches: "${s}"`);
  for (const s of no) assert(chatClaimPrefilter(s) === false, `prefilter ignores: "${s || '(empty)'}"`);
  assert(chatClaimPrefilter(null) === false && chatClaimPrefilter(undefined) === false, 'and never throws on a missing body');
}

console.log('\n[6] Cooldown floors apply at EVERY level, Unhinged included…');
{
  for (const level of Object.keys(FREQUENCY_LEVELS)) {
    resetAll();
    wireStub();
    storage.saveSetting('scribeFrequency', level);
    setCooldown('', Date.now() - 60 * 1000);          // 1 minute ago, inside the 10-minute general cooldown
    const r = considerAutonomous('backdoorBust', { subject: 'p1', signals: [{ signal: 'x', points: 999 }] });
    assert(r.fired === false && r.reason === 'cooldown',
      `${level}: a 999-point candidate is still refused inside the 10-minute general cooldown — the dial moves the THRESHOLD, never the cooldown (SCRIBE.md §14)`);
    assert(r.score === 999, '…and the real score is still reported, which is what E3 replays for calibration');
  }
  resetAll();
  wireStub();
  setCooldown('g1', Date.now() - 30 * 60 * 1000);      // 30 min ago: past GENERAL, inside the 60-min GAME cooldown
  const inGame = considerAutonomous('backdoorBust', { subject: 'p1', gameTag: 'g1', signals: [{ signal: 'x', points: 999 }] });
  assert(inGame.fired === false && inGame.reason === 'cooldown', 'a game thread keeps its own, longer 60-minute floor');
  setCooldown('', Date.now() - 30 * 60 * 1000);
  const inMain = considerAutonomous('backdoorBust', { subject: 'p1', signals: [{ signal: 'x', points: 999 }] });
  assert(inMain.fired === true, '…while the main room is clear after 30 minutes (fixture check — the cooldown test above is not vacuous)');
}

console.log('\n[7] The consecutive-post guard over the hydrated fold…');
{
  resetAll();
  const calls = wireStub();
  chat.ingest([ev({ id: 'a1', seq: 1, author: 'scribe', meta: { source: 'tier2', autonomous: true, trigger: 'unanimous' } })], 1, { caughtUp: true });
  const blocked = considerAutonomous('backdoorBust', { subject: 'p1', signals: [{ signal: 'x', points: 90 }] });
  assert(blocked.fired === false && blocked.reason === 'consecutive',
    'a second autonomous post with no human message in between is refused before any network call');
  assert(calls.autonomous.length === 0, '…and nothing was sent');

  chat.ingest([ev({ id: 'h1', seq: 2, author: 'p2', body: 'lol' })], 2, { caughtUp: true });
  const clear = considerAutonomous('backdoorBust', { subject: 'p2', signals: [{ signal: 'x', points: 90 }] });
  assert(clear.fired === true, 'once a human speaks, SCRIBE is clear again');

  resetAll();
  wireStub();
  chat.ingest([ev({ id: 't0', seq: 1, author: 'scribe', meta: { source: 'tier0', trigger: 'coverageFlip' } })], 1, { caughtUp: true });
  const afterTier0 = considerAutonomous('backdoorBust', { subject: 'p1', signals: [{ signal: 'x', points: 90 }] });
  assert(afterTier0.fired === true,
    'a TIER-0 canned line does not block — it is different in kind (free, already rationed by the cooldown) and only an AUTONOMOUS post sets this guard');

  resetAll();
  wireStub();
  chat.ingest([
    ev({ id: 'g1a', seq: 1, author: 'scribe', gameTag: 'g1', meta: { autonomous: true } }),
    ev({ id: 'mh', seq: 2, author: 'p2', body: 'hi' }),
  ], 2, { caughtUp: true });
  const otherTag = considerAutonomous('backdoorBust', { subject: 'p1', gameTag: 'g1', signals: [{ signal: 'x', points: 90 }] });
  assert(otherTag.fired === false && otherTag.reason === 'consecutive',
    'the guard is PER gameTag — a human speaking in the main room does not unblock a game thread');
}

console.log('\n[8] The remote call fires only when the score clears, and once per bucket…');
{
  resetAll();
  const calls = wireStub();
  const below = considerAutonomous('verbosity', { subject: 'p1' });          // 10 points, Balanced 45
  assert(below.fired === false && below.reason === 'below_threshold' && calls.autonomous.length === 0,
    'a 10-point candidate on Balanced never reaches the network — silence is free');

  const cleared = considerAutonomous('backdoorBust', { subject: 'p1' });     // 50 points
  assert(cleared.fired === true && calls.autonomous.length === 1, 'a 50-point candidate does');
  const body = calls.autonomous[0];
  assert(body.trigger === 'backdoorBust' && body.subject === 'p1', 'the call carries the trigger and subject');
  assert(body.evidence.score === 55 && Array.isArray(body.evidence.points),
    `the evidence carries the COMBINED bucket score and its itemization (got ${body.evidence.score} — backdoorBust 50 + 0.5x verbosity 10)`);
  assert(cleared.id.indexOf('scribe_auto_backdoorBust_p1_') === 0, `the deterministic id is scribe_auto_<trigger>_<subject>_<bucket> (got ${cleared.id})`);

  // Clear BOTH cooldowns first (the room floor and BLOCK-2's league-wide
  // floor), so the ONLY thing that can stop the retry is the per-bucket
  // dedupe — otherwise this would pass for the wrong reason.
  clearCooldowns();
  const again = considerAutonomous('backdoorBust', { subject: 'p1' });
  assert(again.fired === false && again.reason === 'already_fired' && calls.autonomous.length === 1,
    'the same (trigger, subject, bucket) never fires twice from one device, even with the cooldown cleared');

  // Not ready -> never fires, and never reserves a cooldown.
  resetAll();
  scribeAgent.wireScribeRemoteTransport({ autonomous: null, classify: null });
  const unwired = considerAutonomous('backdoorBust', { subject: 'p1' });
  assert(unwired.fired === false && unwired.reason === 'not_ready',
    'with the transport unwired (its state until js/backend.js exports the two relays) the gate is inert…');
  assert(getCooldown('') === 0, '…and reserves NOTHING, so tier-0 is completely unaffected by this build until the relays exist');

  resetAll();
  wireStub();
  storage.saveSetting('scribeAutonomousEnabled', false);
  const off = considerAutonomous('backdoorBust', { subject: 'p1' });
  assert(off.fired === false && off.reason === 'not_ready', 'the client-visible setting switches the whole gate off');
  storage.saveSetting('scribeAutonomousEnabled', true);

  resetAll();
  wireStub();
  const mention = considerAutonomous('mention', { subject: 'p1', signals: [{ signal: 'x', points: 999 }] });
  assert(mention.fired === false && mention.reason === 'not_a_candidate',
    'a mention is never an autonomous candidate — that is Group C\'s path and it is never silent');
}

console.log('\n[9] The classifier path — prefilter -> classify -> points -> score…');
{
  resetAll();
  const calls = wireStub({ classifyResult: { ok: true, claim: true, kind: 'guarantee', confidence: 0.9, points: 45 } });
  scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: 'what time is kickoff', gameTag: '', triggerMessageId: 'm1' });
  await new Promise(r => setTimeout(r, 5));
  assert(calls.classify.length === 0, 'ordinary chat never reaches the classifier — the free prefilter is the whole point');

  scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: 'Texas covers, I guarantee it', gameTag: '', triggerMessageId: 'm2' });
  await new Promise(r => setTimeout(r, 5));
  assert(calls.classify.length === 1 && calls.classify[0].messageId === 'm2', 'a message that clears the prefilter is classified, by id (the server re-reads the body itself)');
  assert(calls.autonomous.length === 1, 'a 45-point guarantee clears Balanced and becomes an autonomous candidate');
  assert(calls.autonomous[0].trigger === 'claim' && calls.autonomous[0].evidence.score === 45,
    `the claim's points enter the same opportunity score as every other signal (got ${calls.autonomous[0].evidence.score})`);

  resetAll();
  const calls2 = wireStub({ classifyResult: { ok: true, claim: false, kind: 'none', confidence: 0.9, points: 0 } });
  scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: 'I guarantee nothing, honestly', gameTag: '', triggerMessageId: 'm3' });
  await new Promise(r => setTimeout(r, 5));
  assert(calls2.classify.length === 1 && calls2.autonomous.length === 0,
    'a zero-point verdict ends there — the classifier can only ever make SCRIBE quieter');

  resetAll();
  const calls3 = wireStub({ classifyResult: async () => { throw new Error('boom'); } });
  scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: 'lock of the week', gameTag: '', triggerMessageId: 'm4' });
  await new Promise(r => setTimeout(r, 5));
  assert(calls3.autonomous.length === 0, 'a classifier outage drops the opportunity silently — never a garbled post');
}

console.log('\n[10] Tier 0 is unchanged — the canned line still posts…');
{
  resetAll();
  scribeAgent.wireScribeRemoteTransport({ autonomous: null, classify: null });   // pass 1's real state
  // scribeTrigger calls chat.sendEvent directly; drive the REAL function and
  // read what it queued out of the fold, rather than stubbing the module —
  // the question here is whether tier-0 still behaves, not whether a stub does.
  const posted = scribeTrigger('unanimous', { subject: 'w1' });
  assert(posted === true, 'a detector still posts its canned tier-0 line exactly as it did in Build 2');
  const msgs = chat.getMessages({ tag: 'all' }).filter(m => m.author === 'scribe');
  assert(msgs.length === 1 && msgs[0].meta.source === 'tier0', "…as a tier-0 post (meta.source 'tier0'), unchanged");
  assert(getCooldown('') > 0, 'and it sets the general cooldown, as it always has');

  // With autonomy AVAILABLE and the candidate clearing, the same detector
  // yields ONE message, not two: the reservation makes the existing rate
  // limiter drop the canned line.
  resetAll();
  const calls = wireStub();
  const posted2 = scribeTrigger('backdoorBust', { subject: 'p1' });
  assert(calls.autonomous.length === 1, 'the detector fed the opportunity score at the one choke point every detector already passes through');
  assert(posted2 === false, 'and the tier-0 line was dropped by the EXISTING rate limiter — one event, one SCRIBE message, the better line');
  assert(chat.getMessages({ tag: 'all' }).filter(m => m.author === 'scribe').length === 0, 'no canned line was queued');
}

console.log('\n[11] The reservation rolls back when the post does not happen…');
{
  resetAll();
  wireStub({ autonomousResult: { ok: true, skipped: 'disabled_autonomous' } });
  const before = getCooldown('');
  const r = considerAutonomous('backdoorBust', { subject: 'p1' });
  assert(r.fired === true && getCooldown('') > 0, 'a firing candidate reserves the cooldown immediately (synchronously — that is what suppresses the canned line)');
  await r.promise;
  assert(getCooldown('') === before,
    'but a server that says "autonomy is off" gets the reservation ROLLED BACK — a post that never happened must not silence the free lines for ten minutes');

  const latched = considerAutonomous('chartLeadChange', { subject: 'p9' });
  assert(latched.fired === false && latched.reason === 'server_off_latch',
    '…and the device latches off for 30 minutes, so a deployment with the Script Property off cannot cost more than one canned line per half hour');

  resetAll();
  wireStub({ autonomousResult: { ok: true, posted: false, reason: 'anthropic_http_500' } });
  const r2 = considerAutonomous('backdoorBust', { subject: 'p1' });
  await r2.promise;
  assert(getCooldown('') === 0, 'an Anthropic outage also rolls back — silence, but not a lingering cooldown');
  const next = considerAutonomous('chartLeadChange', { subject: 'p2' });
  assert(next.fired === true, '…and a genuine failure does NOT latch the device off: only an explicit "disabled" answer does');
  await next.promise;   // let its rollback land before the next fixture reserves

  resetAll();
  wireStub({ autonomousResult: { ok: true, posted: true } });
  const r3 = considerAutonomous('backdoorBust', { subject: 'p1' });
  await r3.promise;
  assert(getCooldown('') > 0, 'a candidate that DID post keeps its cooldown — SCRIBE stays rationed to one message per ten minutes');
}

console.log('\n[13] F4 — a dedupe is a POST: the reservation is kept, not rolled back…');
{
  resetAll();
  wireStub({ autonomousResult: { ok: true, deduped: true, responseMessageId: 'scribe_auto_x' } });
  const r = considerAutonomous('backdoorBust', { subject: 'p1' });
  assert(r.fired === true, 'fixture check: the candidate fired and reserved');
  await r.promise;
  assert(getCooldown('') > 0,
    'deduped:true means ANOTHER DEVICE already posted the message — the cooldown STAYS, because a SCRIBE message really is in the room');
  const follow = scribeTrigger('unanimous', { subject: 'w1' });
  assert(follow === false,
    '…so a tier-0 canned line cannot fire seconds behind it (SCRIBE.md §14: never two SCRIBE messages back to back)');

  resetAll();
  wireStub({ autonomousResult: { ok: true, throttled: true, reason: 'budget' } });
  const b = considerAutonomous('backdoorBust', { subject: 'p1' });
  await b.promise;
  assert(getCooldown('') === 0, 'a BUDGET refusal rolls the reservation back — nothing was posted');
  const afterBudget = considerAutonomous('chartLeadChange', { subject: 'p2' });
  assert(afterBudget.fired === false && afterBudget.reason === 'server_off_latch',
    '…and latches the device off for 30 minutes: the month\'s budget will still be gone on the next detector');

  resetAll();
  wireStub({ autonomousResult: { ok: true, throttled: true, reason: 'not_configured' } });
  const nc = considerAutonomous('backdoorBust', { subject: 'p1' });
  await nc.promise;
  const afterNc = considerAutonomous('chartLeadChange', { subject: 'p2' });
  assert(afterNc.reason === 'server_off_latch', 'a missing API key latches too — it will not appear on its own');

  resetAll();
  wireStub({ autonomousResult: { ok: true, throttled: true, reason: 'throttle' } });
  const t = considerAutonomous('backdoorBust', { subject: 'p1' });
  await t.promise;
  assert(getCooldown('') === 0, 'an hourly THROTTLE rolls back…');
  const afterThrottle = considerAutonomous('chartLeadChange', { subject: 'p2' });
  assert(afterThrottle.fired === true,
    '…and does NOT latch — the hour rolls over on its own, and latching would silence autonomy over a cap that simply filled up');
}

console.log('\n[14] F3 — the detectors, on fixtures…');
{
  const players = [{ playerId: 'p1', active: true }, { playerId: 'p2', active: true }, { playerId: 'p3', active: true }];
  // home -3, home wins by 10 -> HOME covers.
  const game = (id, over = {}) => ({ gameId: id, weekId: 'w1', status: 'final', homeTeam: 'H' + id, awayTeam: 'A' + id,
    kickoff: '2026-09-05T1' + (id.length) + ':00:00Z', homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3, ...over });
  const pick = (playerId, gameId, team) => ({ weekId: 'w1', playerId, gameId, selectedTeam: team });

  // unanimous — all three submitters on the same side of g1
  {
    const games = [game('g1'), game('g2')];
    const picks = [pick('p1', 'g1', 'Hg1'), pick('p2', 'g1', 'Hg1'), pick('p3', 'g1', 'Hg1'),
                   pick('p1', 'g2', 'Hg2'), pick('p2', 'g2', 'Ag2'), pick('p3', 'g2', 'Hg2')];
    const out = detectWeekSignals({ weekId: 'w1', weekStatus: 'locked', games, picks, players });
    const u = out.filter(s => s.signal === 'unanimous');
    assert(u.length === 1 && u[0].subject === 'g1', `exactly one unanimous signal, on the game everyone agreed about (got ${u.length})`);
    assert(u[0].gameTag === 'g1' && u[0].evidence.team === 'Hg1' && u[0].evidence.count === 3, 'it carries the game, the side, and how many agreed');

    const partial = detectWeekSignals({ weekId: 'w1', weekStatus: 'locked', games,
      picks: picks.filter(p => !(p.playerId === 'p3' && p.gameId === 'g1')), players });
    assert(partial.filter(s => s.signal === 'unanimous').length === 0,
      'two of three agreeing while the third abstained is NOT unanimity — it is a small sample');

    // N-4 — THE BLIND RULE AT THE SIGNAL LEVEL.
    for (const status of ['open', 'draft', null, '', 'nonsense']) {
      const blind = detectWeekSignals({ weekId: 'w1', weekStatus: status, games, picks, players });
      assert(blind.filter(s => s.signal === 'unanimous').length === 0,
        `weekStatus ${JSON.stringify(status)}: no unanimous signal is even DETECTED — "all six took the same side" is a statement about every player's pick`);
    }
    for (const status of ['live', 'final']) {
      const visible = detectWeekSignals({ weekId: 'w1', weekStatus: status, games, picks, players });
      assert(visible.filter(s => s.signal === 'unanimous').length === 1, `weekStatus '${status}': picks are public, so the signal fires`);
    }
  }

  // loneWolfWin — one player alone on the covering side
  {
    const games = [game('g1')];
    const picks = [pick('p1', 'g1', 'Hg1'), pick('p2', 'g1', 'Ag1'), pick('p3', 'g1', 'Ag1')];
    const out = detectWeekSignals({ weekId: 'w1', games, picks, players });
    const lw = out.filter(s => s.signal === 'loneWolfWin');
    assert(lw.length === 1 && lw[0].subject === 'p1', 'the one player on the ATS-winning side is the subject');
    assert(lw[0].evidence.against === 2, 'and the evidence says how many he was alone against');

    const split = detectWeekSignals({ weekId: 'w1', games, picks: [pick('p1', 'g1', 'Hg1'), pick('p2', 'g1', 'Hg1'), pick('p3', 'g1', 'Ag1')], players });
    assert(split.filter(s => s.signal === 'loneWolfWin').length === 0, 'two players on the winning side is not a lone wolf');
    const pushGames = [game('g1', { homeScore: 23, awayScore: 20 })];   // exactly the spread -> no decision
    assert(detectWeekSignals({ weekId: 'w1', games: pushGames, picks, players }).filter(s => s.signal === 'loneWolfWin').length === 0,
      'a push produces no lone wolf — there is no winning side');
  }

  // chartLeadChange
  {
    const before = [{ playerId: 'p2', totalCorrectCount: 10 }, { playerId: 'p1', totalCorrectCount: 9 }];
    const after = [{ playerId: 'p1', totalCorrectCount: 14 }, { playerId: 'p2', totalCorrectCount: 12 }];
    const out = detectWeekSignals({ weekId: 'w1', standingsBefore: before, standingsAfter: after });
    const lc = out.filter(s => s.signal === 'chartLeadChange');
    assert(lc.length === 1 && lc[0].subject === 'p1' && lc[0].evidence.from === 'p2', 'a new name on top fires once, naming both players');
    assert(detectWeekSignals({ weekId: 'w1', standingsBefore: after, standingsAfter: after }).filter(s => s.signal === 'chartLeadChange').length === 0,
      'the same leader either side fires nothing');
  }

  // milestone — RAW counts, on the crossing only
  {
    const before = [{ playerId: 'p1', totalCorrectCount: 23, totalCorrect: 40 }];
    const after = [{ playerId: 'p1', totalCorrectCount: 26, totalCorrect: 46 }];
    const out = detectWeekSignals({ weekId: 'w1', standingsBefore: before, standingsAfter: after });
    const ms = out.filter(s => s.signal === 'milestone');
    assert(ms.length === 1 && ms[0].evidence.milestone === 25, `crossing 25 fires once (got ${JSON.stringify(ms.map(x => x.evidence.milestone))})`);
    assert(ms[0].evidence.total === 26, 'the evidence carries the real total, so the post can be anchored in the number');
    assert(detectWeekSignals({ weekId: 'w1', standingsBefore: after, standingsAfter: [{ playerId: 'p1', totalCorrectCount: 29 }] })
      .filter(s => s.signal === 'milestone').length === 0, 'and never again for that mark');
    const weighted = detectWeekSignals({ weekId: 'w1',
      standingsBefore: [{ playerId: 'p1', totalCorrectCount: 20, totalCorrect: 24 }],
      standingsAfter: [{ playerId: 'p1', totalCorrectCount: 22, totalCorrect: 27 }] });
    assert(weighted.filter(s => s.signal === 'milestone').length === 0,
      'a milestone is a RAW count of games, never the multiplied tally — crossing 25 WEIGHTED points fires nothing (CONVENTIONS #22)');
  }

  // streak — chronological, and a shuffled input cannot change it
  {
    const games = [], picks = [];
    for (let i = 1; i <= 4; i++) {
      // first three cover for p1, the fourth does not
      const homeWins = i <= 3;
      games.push({ gameId: 's' + i, weekId: 'w1', status: 'final', homeTeam: 'H' + i, awayTeam: 'A' + i,
        kickoff: `2026-09-0${i}T17:00:00Z`, homeScore: homeWins ? 30 : 10, awayScore: 20, spread: -3, lockedSpread: -3 });
      picks.push({ weekId: 'w1', playerId: 'p1', gameId: 's' + i, selectedTeam: 'H' + i });
    }
    const threeOnly = detectWeekSignals({ weekId: 'w1', games: games.slice(0, 3), picks: picks.slice(0, 3), players });
    const st = threeOnly.filter(s => s.signal === 'streak');
    assert(st.length === 1 && st[0].evidence.run === 3 && st[0].evidence.state === 'active', 'three straight covers reaches the streak threshold');
    const shuffled = detectWeekSignals({ weekId: 'w1', games: games.slice(0, 3).reverse(), picks: picks.slice(0, 3).reverse(), players });
    assert(JSON.stringify(shuffled) === JSON.stringify(threeOnly), 'and a reversed input array produces the identical signal — kickoff order, not array order');
    const twoOnly = detectWeekSignals({ weekId: 'w1', games: games.slice(0, 2), picks: picks.slice(0, 2), players });
    assert(twoOnly.filter(s => s.signal === 'streak').length === 0, 'two is not a streak');
    const noKick = games.slice(0, 3).map((g, i) => (i === 1 ? { ...g, kickoff: null } : g));
    assert(detectWeekSignals({ weekId: 'w1', games: noKick, picks: picks.slice(0, 3), players }).filter(s => s.signal === 'streak').length === 0,
      'a history that cannot be fully ordered emits NO streak — absent beats confidently wrong');
  }

  // an ordinary week fires nothing at all
  {
    const games = [game('g1'), game('g2')];
    // Two on the covering side of each game: no unanimity, no lone wolf.
    const picks = [pick('p1', 'g1', 'Hg1'), pick('p2', 'g1', 'Ag1'), pick('p3', 'g1', 'Hg1'),
                   pick('p1', 'g2', 'Hg2'), pick('p2', 'g2', 'Hg2'), pick('p3', 'g2', 'Ag2')];
    const standings = [{ playerId: 'p1', totalCorrectCount: 7 }, { playerId: 'p2', totalCorrectCount: 5 }];
    const out = detectWeekSignals({ weekId: 'w1', games, picks, players,
      standingsBefore: standings, standingsAfter: [{ playerId: 'p1', totalCorrectCount: 9 }, { playerId: 'p2', totalCorrectCount: 6 }] });
    assert(out.length === 0, `an ordinary week produces ZERO signals — silence is the default and it is free (got ${JSON.stringify(out.map(s => s.signal))})`);
  }
  assert(detectWeekSignals({}).length === 0, 'and calling it with nothing at all is a clean no-op, not a throw');
}

console.log('\n[15] F3 — detected signals feed the same gate as every other signal…');
{
  const players = [{ playerId: 'p1', active: true }, { playerId: 'p2', active: true }, { playerId: 'p3', active: true }];
  const games = [{ gameId: 'g1', weekId: 'w1', status: 'final', homeTeam: 'H', awayTeam: 'A',
                   kickoff: '2026-09-05T17:00:00Z', homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3 }];
  const picks = [{ weekId: 'w1', playerId: 'p1', gameId: 'g1', selectedTeam: 'H' },
                 { weekId: 'w1', playerId: 'p2', gameId: 'g1', selectedTeam: 'A' },
                 { weekId: 'w1', playerId: 'p3', gameId: 'g1', selectedTeam: 'A' }];

  resetAll();
  const calls = wireStub();
  const balanced = considerWeekSignals({ weekId: 'w1', games, picks, players });
  assert(balanced.detected.length === 1 && balanced.detected[0].signal === 'loneWolfWin', 'fixture check: one signal was detected');
  assert(balanced.outcomes[0].fired === false && balanced.outcomes[0].reason === 'below_threshold',
    'a lone-wolf win alone is 30 points — below Balanced (45), so it is scored and refused, exactly like any other signal');
  assert(calls.autonomous.length === 0, '…and costs nothing');

  resetAll();
  const calls2 = wireStub();
  storage.saveSetting('scribeFrequency', 'active');            // 25
  const active = considerWeekSignals({ weekId: 'w1', games, picks, players });
  assert(active.outcomes[0].fired === true && calls2.autonomous.length === 1,
    'the same signal clears on Active (25) — the DETECTOR never decides, the dial does');
  assert(calls2.autonomous[0].trigger === 'loneWolfWin' && calls2.autonomous[0].subject === 'p1',
    'and the call names the signal and its subject');
  assert(calls2.autonomous[0].evidence.score === 30, `carrying the scored value (got ${calls2.autonomous[0].evidence.score})`);
  storage.saveSetting('scribeFrequency', 'balanced');

  // BLOCK-2c — two signals in one finalize produce ONE candidate: the
  // highest-point one, carrying BOTH in its evidence.
  resetAll();
  const calls3 = wireStub();
  const before = [{ playerId: 'p2', totalCorrectCount: 10 }, { playerId: 'p1', totalCorrectCount: 9 }];
  const after = [{ playerId: 'p1', totalCorrectCount: 14 }, { playerId: 'p2', totalCorrectCount: 12 }];
  const both = considerWeekSignals({ weekId: 'w1', games, picks, players, standingsBefore: before, standingsAfter: after });
  assert(both.detected.length === 2, `fixture check: a lone-wolf win AND a lead change were detected (got ${both.detected.map(s => s.signal).join(', ')})`);
  assert(calls3.autonomous.length === 1, 'exactly ONE autonomous call, not one per signal');
  assert(both.candidate.signal === 'chartLeadChange',
    `the candidate is the highest-point signal — a 45-point lead change beats a 30-point lone wolf (got ${both.candidate.signal})`);
  assert(calls3.autonomous[0].evidence.score === 60,
    `and its evidence carries BOTH facts, combined: 45 + 0.5x30 (got ${calls3.autonomous[0].evidence.score}) — nothing is lost except the duplicate post`);
  assert(calls3.autonomous[0].evidence.points.map(p => p.signal).sort().join(',') === 'chartLeadChange,loneWolfWin',
    'the model is told about every signal that fired, so it can choose which to name');

  // Same-room signals DO combine (max + 0.5 x the next two distinct).
  resetAll();
  const calls4 = wireStub();
  const sameRoom = considerAutonomous('chartLeadChange', { subject: 'g1', gameTag: 'g1' });   // 45 alone
  assert(sameRoom.fired === true, 'fixture check: a 45-point signal clears Balanced on its own');
  clearCooldowns();
  const combined = considerAutonomous('streak', { subject: 'p1', gameTag: 'g1' });           // 45 + 0.5x35
  assert(combined.score === 62.5,
    `two signals in the SAME room and the same 10-minute bucket combine to 45 + 0.5x35 = 62.5 (got ${combined.score})`);
  assert(combined.fired === true && calls4.autonomous.length === 2, 'and the bucket carries both into the evidence');
}

console.log('\n[16] Note 14 — the in-flight classifier latch is reset between tests…');
{
  resetAll();
  const calls = wireStub({ classifyResult: { ok: true, claim: true, kind: 'guarantee', confidence: 0.9, points: 45 } });
  scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: 'I guarantee it', gameTag: '', triggerMessageId: 'q1' });
  // Deliberately NOT awaited — this is the shape that used to wedge the flag.
  resetAll();
  const calls2 = wireStub({ classifyResult: { ok: true, claim: true, kind: 'guarantee', confidence: 0.9, points: 45 } });
  scribeInspectMessage({ author: 'p1', authorName: 'Drew', body: 'I guarantee it again', gameTag: '', triggerMessageId: 'q2' });
  await new Promise(r => setTimeout(r, 5));
  assert(calls2.classify.length === 1,
    'a second inspect after a reset still classifies — _resetAutonomousStateForTest clears classifyInFlight, so no later test passes for the wrong reason');
}

console.log('\n[17] BLOCK-2 — the league-wide floor: a 3-game finalize posts ONCE…');
{
  const players = [{ playerId: 'p1', active: true }, { playerId: 'p2', active: true }, { playerId: 'p3', active: true }];
  // Three game threads finalizing together, each with its own lone wolf.
  const games = [], picks = [];
  for (let i = 1; i <= 3; i++) {
    games.push({ gameId: 'g' + i, weekId: 'w1', status: 'final', homeTeam: 'H' + i, awayTeam: 'A' + i,
      kickoff: `2026-09-0${i}T17:00:00Z`, homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3 });
    picks.push({ weekId: 'w1', playerId: 'p1', gameId: 'g' + i, selectedTeam: 'H' + i });     // alone on the cover
    picks.push({ weekId: 'w1', playerId: 'p2', gameId: 'g' + i, selectedTeam: 'A' + i });
    picks.push({ weekId: 'w1', playerId: 'p3', gameId: 'g' + i, selectedTeam: 'A' + i });
  }
  resetAll();
  const calls = wireStub();
  storage.saveSetting('scribeFrequency', 'active');    // 25 — each lone wolf (30) clears on its own
  const out = considerWeekSignals({ weekId: 'w1', weekStatus: 'final', games, picks, players });
  assert(out.detected.filter(s => s.signal === 'loneWolfWin').length === 3,
    `fixture check: all three lone-wolf wins were detected (got ${out.detected.length} signals)`);
  assert(calls.autonomous.length === 1,
    'ONE paid call, not three — this is the defect BLOCK-2 found: three game threads, three per-room cooldowns, three simultaneous posts in one reader\'s stream');
  assert(out.outcomes.length === 1 && out.outcomes[0].fired === true, 'and one outcome, reported honestly to the caller');
  const distinctNames = new Set(out.detected.map(s => s.signal));
  assert(calls.autonomous[0].evidence.points.length === distinctNames.size,
    `the post carries every DISTINCT fact once — ${out.detected.length} signal instances collapse to ${distinctNames.size} names (got ${calls.autonomous[0].evidence.points.length})`);
  assert(calls.autonomous[0].evidence.score === 50,
    `and scores streak 35 + 0.5x loneWolfWin 30 = 50, not the old flat 195 (got ${calls.autonomous[0].evidence.score})`);
  assert(out.candidate.signal === 'streak',
    `the candidate is the highest-point signal across all of them — a 35-point streak outranks a 30-point lone wolf (got ${out.candidate.signal})`);
  assert(new Set(out.detected.map(s => s.signal)).size === 2,
    'fixture check: this finalize genuinely produced two KINDS of signal across three game threads (not one repeated)');

  // A second finalize five minutes later: blocked by the league-wide floor,
  // even though it is a different room with its own untouched per-room floor.
  const later = Date.now() + 5 * 60 * 1000;
  const nextGames = [{ gameId: 'g9', weekId: 'w2', status: 'final', homeTeam: 'H9', awayTeam: 'A9',
    kickoff: '2026-09-09T17:00:00Z', homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3 }];
  const nextPicks = [{ weekId: 'w2', playerId: 'p1', gameId: 'g9', selectedTeam: 'H9' },
                     { weekId: 'w2', playerId: 'p2', gameId: 'g9', selectedTeam: 'A9' },
                     { weekId: 'w2', playerId: 'p3', gameId: 'g9', selectedTeam: 'A9' }];
  const second = considerAutonomous('loneWolfWin', { subject: 'p1', gameTag: 'g9', now: later,
    signals: [{ signal: 'loneWolfWin' }, { signal: 'milestone' }] });
  assert(second.fired === false && second.reason === 'global_cooldown',
    'five minutes later, a brand-new room with an untouched per-room floor is still refused — the reader\'s stream is what the rule protects');
  assert(calls.autonomous.length === 1, '…and it costs nothing');

  // Eleven minutes later it is clear again.
  const muchLater = Date.now() + 11 * 60 * 1000;
  const third = considerAutonomous('loneWolfWin', { subject: 'p1', gameTag: 'g9', now: muchLater,
    signals: [{ signal: 'loneWolfWin' }, { signal: 'milestone' }] });
  assert(third.fired === true, 'past ten minutes the league-wide floor clears (fixture check — the bound is a cooldown, not an off switch)');
  storage.saveSetting('scribeFrequency', 'balanced');
}

console.log('\n[18] BLOCK-2 — the per-room floors and the room-agnostic consecutive guard both still hold…');
{
  // Per-room floor still applies on top of the league-wide one.
  resetAll();
  wireStub();
  setCooldown('g1', Date.now() - 30 * 60 * 1000);     // inside the 60-minute GAME floor, past the 10-minute general one
  setGlobalCooldown(Date.now() - 30 * 60 * 1000);     // league-wide floor is clear
  const inGame = considerAutonomous('backdoorBust', { subject: 'p1', gameTag: 'g1', signals: [{ signal: 'x', points: 999 }] });
  assert(inGame.fired === false && inGame.reason === 'cooldown',
    'a game thread keeps its own 60-minute floor even when the league-wide floor is clear');

  // Room-agnostic consecutive guard: the latest message in the WHOLE stream
  // is an autonomous SCRIBE post, in a different room.
  resetAll();
  const calls = wireStub();
  setGlobalCooldown(Date.now() - 30 * 60 * 1000);
  chat.ingest([ev({ id: 'a1', seq: 1, author: 'scribe', gameTag: 'g7', meta: { autonomous: true } })], 1, { caughtUp: true });
  const other = considerAutonomous('backdoorBust', { subject: 'p1', gameTag: '', signals: [{ signal: 'x', points: 999 }] });
  assert(other.fired === false && other.reason === 'consecutive_all',
    'an autonomous post in ANOTHER room is still the last thing the reader saw — SCRIBE does not follow itself');
  assert(calls.autonomous.length === 0, '…checked before any network call');

  chat.ingest([ev({ id: 'h1', seq: 2, author: 'p2', gameTag: 'g7', body: 'lol' })], 2, { caughtUp: true });
  const afterHuman = considerAutonomous('backdoorBust', { subject: 'p2', gameTag: '', signals: [{ signal: 'x', points: 999 }] });
  assert(afterHuman.fired === true, 'a human speaking anywhere clears it');
}

console.log('\n[19] N-1 — the client refuses to guess at an unorderable history…');
{
  const games = [
    { gameId: 'a', weekId: 'w1', status: 'final', homeTeam: 'H', awayTeam: 'A', kickoff: '2026-09-01T17:00:00Z', homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3 },
    { gameId: 'b', weekId: 'w1', status: 'final', homeTeam: 'H', awayTeam: 'A', kickoff: null, homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3 },
  ];
  const picks = [{ weekId: 'w1', playerId: 'p1', gameId: 'a', selectedTeam: 'H' },
                 { weekId: 'w1', playerId: 'p1', gameId: 'b', selectedTeam: 'H' }];
  const missingKickoff = orderedGradedResults('p1', games, picks);
  assert(missingKickoff.complete === false, 'a graded pick whose game has no kickoff marks the sequence INCOMPLETE');
  assert(missingKickoff.results.length === 1, '…and is excluded from it rather than silently ranked first');

  const missingGame = orderedGradedResults('p1', [games[0]], picks.concat([{ weekId: 'w1', playerId: 'p1', gameId: 'ghost', selectedTeam: 'H' }]));
  assert(missingGame.complete === false, 'a pick whose game is missing entirely does the same');

  const clean = orderedGradedResults('p1', [games[0]], [picks[0]]);
  assert(clean.complete === true && clean.results.length === 1, 'a clean history reports complete (fixture check — the flag is not stuck false)');

  // N-5 — week ordering matches the server's (season, weekNumber) comparator.
  const weeks = [{ weekId: 'w2', season: '2026', weekNumber: 2 }, { weekId: 'w1', season: '2026', weekNumber: 1 }];
  const twoWeeks = [
    { gameId: 'x', weekId: 'w2', status: 'final', homeTeam: 'H', awayTeam: 'A', kickoff: '2026-09-01T17:00:00Z', homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3 },
    { gameId: 'y', weekId: 'w1', status: 'final', homeTeam: 'H', awayTeam: 'A', kickoff: '2026-09-09T17:00:00Z', homeScore: 10, awayScore: 20, spread: -3, lockedSpread: -3 },
  ];
  const twoPicks = [{ weekId: 'w2', playerId: 'p1', gameId: 'x', selectedTeam: 'H' },
                    { weekId: 'w1', playerId: 'p1', gameId: 'y', selectedTeam: 'H' }];
  const ranked = orderedGradedResults('p1', twoWeeks, twoPicks, weeks);
  assert(ranked.results.map(r => r.weekId).join(',') === 'w1,w2',
    `week 1 sorts before week 2 even though its kickoff is LATER — (season, weekNumber) leads, exactly as backend/Code.gs orders it (got ${ranked.results.map(r => r.weekId).join(',')})`);
  const unknownWeek = orderedGradedResults('p1', twoWeeks, twoPicks, [weeks[0]]);
  assert(unknownWeek.complete === false, 'and a pick whose week is not in the supplied list marks the sequence incomplete rather than ranking it 0');
}

console.log('\n[20] N-3 — the frequency dial is validated at the boundary…');
{
  resetAll();
  for (const [stored, expected] of [['quiet', 'quiet'], ['UNHINGED', 'unhinged'], [' active ', 'active'],
                                    ['nonsense', 'balanced'], ['', 'balanced'], [null, 'balanced'],
                                    [undefined, 'balanced'], [42, 'balanced']]) {
    storage.saveSetting('scribeFrequency', stored);
    assert(scribeAgent.getScribeFrequency() === expected,
      `settings.scribeFrequency ${JSON.stringify(stored)} reads as '${expected}'`);
  }
  storage.saveSetting('scribeFrequency', 'balanced');
}


// ── FINDING 1 (reviewer, round 3) — the amended combiner. These five rows
// ARE the specification: DI-D1 amendment #3 names each of them, and the same
// five are asserted against backend/Code.gs's implementation at [22] so the
// two runtimes cannot drift into different answers.
const COMBINER_FIXTURES = [
  { label: 'ordinary week (streak 35, loneWolf 30, unanimous 25)',
    signals: ['streak', 'loneWolfWin', 'unanimous'], expected: 62.5,
    fires: ['balanced', 'active', 'unhinged'], quiet: ['quiet', 'reserved'] },
  { label: 'lead-change week (45, 35, 30)',
    signals: ['chartLeadChange', 'streak', 'loneWolfWin'], expected: 77.5,
    fires: ['reserved', 'balanced', 'active', 'unhinged'], quiet: ['quiet'] },
  { label: 'big week (backdoorBust 50, leadChange 45, streak 35)',
    signals: ['backdoorBust', 'chartLeadChange', 'streak'], expected: 90,
    fires: ['quiet', 'reserved', 'balanced', 'active', 'unhinged'], quiet: [] },
  { label: 'a lone contradiction claim (50)',
    signals: [{ signal: 'claim', points: 50 }], expected: 50,
    fires: ['balanced', 'active', 'unhinged'], quiet: ['quiet', 'reserved'] },
  { label: 'guarantee 45 + verbosity 10',
    signals: [{ signal: 'claim', points: 45 }, 'verbosity'], expected: 50,
    fires: ['balanced', 'active', 'unhinged'], quiet: ['quiet', 'reserved'] },
  // F-A — `points:null`/`points:undefined` mean "the caller supplied
  // nothing," so the TABLE value is used. `Number(null)` is 0 and
  // `Number.isFinite(0)` is true, so a naive finite-check reads null as an
  // explicit zero — the RG-07 null trap, and it made the two runtimes
  // disagree because Code.gs guards `!== null` first.
  { label: 'points:null falls through to the table (streak 35 + loneWolf 30)',
    signals: [{ signal: 'streak', points: null }, { signal: 'loneWolfWin', points: null }], expected: 50,
    fires: ['balanced', 'active', 'unhinged'], quiet: ['quiet', 'reserved'] },
  { label: 'points:undefined does the same (backdoorBust 50 + streak 35)',
    signals: [{ signal: 'backdoorBust', points: undefined }, { signal: 'streak' }], expected: 67.5,
    fires: ['reserved', 'balanced', 'active', 'unhinged'], quiet: ['quiet'] },
  { label: 'an explicit 0 IS respected (claim 0 + streak 35)',
    signals: [{ signal: 'claim', points: 0 }, { signal: 'streak' }], expected: 35,
    fires: ['active', 'unhinged'], quiet: ['quiet', 'reserved', 'balanced'] },
];

console.log('\n[21] FINDING 1 — the dial discriminates, and cardinality cannot inflate a score…');
{
  for (const f of COMBINER_FIXTURES) {
    const got = scoreOpportunity(f.signals, { level: 'balanced' }).score;
    assert(got === f.expected, `${f.label} -> ${f.expected} (got ${got})`);
    for (const level of f.fires) {
      assert(scoreOpportunity(f.signals, { level }).clears === true, `  …fires at ${level}`);
    }
    for (const level of f.quiet) {
      assert(scoreOpportunity(f.signals, { level }).clears === false, `  …stays silent at ${level}`);
    }
  }

  // CARDINALITY — the defect, closed.
  const twenty = Array.from({ length: 20 }, () => ({ signal: 'verbosity' }));
  const spam = scoreOpportunity(twenty, { level: 'quiet' });
  assert(spam.score === 10, `twenty verbosity signals are ONE verbosity signal, worth 10 (got ${spam.score}) — the old flat sum made it 200`);
  assert(spam.clears === false, '…and 10 does not clear Quiet, which is the whole point of the setting');
  assert(spam.counted.length === 1, 'the itemization collapses too, so the prompt names each signal once');

  const threeClaims = scoreOpportunity(
    [{ signal: 'claim', points: 50 }, { signal: 'claim', points: 50 }, { signal: 'claim', points: 50 }],
    { level: 'balanced' });
  assert(threeClaims.score === 50, `one logged verdict repeated three times is still worth 50 (got ${threeClaims.score})`);

  // The fourth-and-beyond signal contributes nothing.
  const four = scoreOpportunity(['backdoorBust', 'chartLeadChange', 'streak', 'unanimous', 'drinkDebt'], { level: 'balanced' });
  assert(four.score === 90, `only the top three distinct signals count — a fourth and fifth add nothing (got ${four.score})`);
  const cap = scoreOpportunity(Object.keys(SIGNAL_POINTS).concat(Object.keys(SIGNAL_POINTS)), { level: 'balanced' });
  assert(cap.counted.length <= 8, `the collapsed list is capped at 8 names (got ${cap.counted.length})`);

  // Ordering/ties are deterministic.
  const a = scoreOpportunity(['streak', 'loneWolfWin', 'unanimous'], { level: 'balanced' });
  const b = scoreOpportunity(['unanimous', 'streak', 'loneWolfWin'], { level: 'balanced' });
  assert(a.score === b.score && JSON.stringify(a.counted) === JSON.stringify(b.counted),
    'input order does not change the score or the itemization');
}

console.log('\n[22] FINDING 1 — client and server compute the SAME score (cross-runtime twin)…');
{
  const vm = await import('node:vm');
  const codeGs = await readFile(fileURLToPath(new URL('./backend/Code.gs', import.meta.url)), 'utf8');
  // scribeScoreOpportunity_ is pure — no Sheets, no Properties, no Cache — so
  // a bare context is enough to run the real server implementation here and
  // compare it against the client's, fixture by fixture.
  const sandbox = { console };
  vm.createContext(sandbox);
  vm.runInContext(codeGs, sandbox, { filename: 'Code.gs' });
  assert(typeof sandbox.scribeScoreOpportunity_ === 'function', 'fixture check: the server scorer loaded');

  for (const f of COMBINER_FIXTURES) {
    const server = sandbox.scribeScoreOpportunity_(f.signals.map(s => (typeof s === 'string' ? { signal: s } : s)));
    const client = scoreOpportunity(f.signals, { level: 'balanced' }).score;
    assert(server === client && server === f.expected,
      `${f.label}: client ${client}, server ${server}, expected ${f.expected}`);
  }
  const twenty = Array.from({ length: 20 }, () => ({ signal: 'verbosity' }));
  assert(sandbox.scribeScoreOpportunity_(twenty) === scoreOpportunity(twenty, { level: 'quiet' }).score,
    'and both collapse twenty instances of one signal identically');
  assert(sandbox.scribeScoreOpportunity_([]) === 0 && scoreOpportunity([], { level: 'balanced' }).score === 0,
    'both score an empty signal list as 0');
  assert(sandbox.scribeScoreOpportunity_([{ signal: 'nope' }]) === scoreOpportunity([{ signal: 'nope' }], { level: 'balanced' }).score,
    'and both treat an unknown signal name the same way');
}

console.log('\n[23] FINDING 1 — all five levels discriminate against REAL detector output…');
{
  // Two realistic finalizes, built from the detectors rather than from
  // hand-written signal names, so this asserts the end-to-end gradient a
  // league would actually experience (Testing Protocol candidate 56).
  const players = [{ playerId: 'p1', active: true }, { playerId: 'p2', active: true }, { playerId: 'p3', active: true }];
  const games = [], picks = [];
  for (let i = 1; i <= 4; i++) {
    games.push({ gameId: 'w' + i, weekId: 'w1', status: 'final', homeTeam: 'H' + i, awayTeam: 'A' + i,
      kickoff: `2026-09-0${i}T17:00:00Z`, homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3 });
    // g1 is p1 alone on the cover; the rest are unanimous on the cover.
    ['p1', 'p2', 'p3'].forEach(pid => {
      const team = (i === 1 && pid !== 'p1') ? 'A' + i : 'H' + i;
      picks.push({ weekId: 'w1', playerId: pid, gameId: 'w' + i, selectedTeam: team });
    });
  }
  const ordinary = detectWeekSignals({ weekId: 'w1', weekStatus: 'final', games, picks, players });
  const names = new Set(ordinary.map(s => s.signal));
  assert(names.has('loneWolfWin') && names.has('unanimous') && names.has('streak') && names.size === 3,
    `fixture check: an ordinary week produces exactly loneWolfWin + unanimous + streak (got ${[...names].join(', ')})`);
  const ordinaryScore = scoreOpportunity(ordinary.map(s => ({ signal: s.signal })), { level: 'balanced' }).score;
  assert(ordinaryScore === 62.5, `the ordinary week scores 62.5 (got ${ordinaryScore})`);
  for (const [level, should] of [['quiet', false], ['reserved', false], ['balanced', true], ['active', true], ['unhinged', true]]) {
    const clears = scoreOpportunity(ordinary.map(s => ({ signal: s.signal })), { level }).clears;
    assert(clears === should, `ordinary week at ${level}: ${should ? 'fires' : 'stays silent'}`);
  }

  const before = [{ playerId: 'p2', totalCorrectCount: 10 }, { playerId: 'p1', totalCorrectCount: 9 }];
  const after = [{ playerId: 'p1', totalCorrectCount: 14 }, { playerId: 'p2', totalCorrectCount: 12 }];
  const leadChange = detectWeekSignals({ weekId: 'w1', weekStatus: 'final', games, picks, players,
    standingsBefore: before, standingsAfter: after });
  assert(new Set(leadChange.map(s => s.signal)).size === 4, 'fixture check: the lead-change week adds chartLeadChange to the same three');
  const leadScore = scoreOpportunity(leadChange.map(s => ({ signal: s.signal })), { level: 'balanced' }).score;
  assert(leadScore === 77.5, `the lead-change week scores 77.5 — top three only, so unanimous falls off (got ${leadScore})`);
  for (const [level, should] of [['quiet', false], ['reserved', true], ['balanced', true], ['active', true], ['unhinged', true]]) {
    const clears = scoreOpportunity(leadChange.map(s => ({ signal: s.signal })), { level }).clears;
    assert(clears === should, `lead-change week at ${level}: ${should ? 'fires' : 'stays silent'}`);
  }
  assert(ordinaryScore < leadScore,
    'and the dial genuinely orders them: a lead-change week outranks an ordinary one, which is what made Quiet mean something again');
}

console.log('\n[24] FINDING 5 — a milestone is never a weighted number…');
{
  const weightedOnly = detectWeekSignals({ weekId: 'w1',
    standingsBefore: [{ playerId: 'p1', totalCorrect: 23 }],
    standingsAfter: [{ playerId: 'p1', totalCorrect: 26 }] });
  assert(weightedOnly.filter(s => s.signal === 'milestone').length === 0,
    'a standings shape carrying only the WEIGHTED tally produces no milestone — announcing "25 correct picks" off a multiplied number is a stat that never happened');
  const rawOnly = detectWeekSignals({ weekId: 'w1',
    standingsBefore: [{ playerId: 'p1', totalCorrectCount: 23 }],
    standingsAfter: [{ playerId: 'p1', totalCorrectCount: 26 }] });
  assert(rawOnly.filter(s => s.signal === 'milestone').length === 1,
    'with a raw count present it fires (fixture check — the guard is not blanket)');
  const newPlayer = detectWeekSignals({ weekId: 'w1',
    standingsBefore: [],
    standingsAfter: [{ playerId: 'pNew', totalCorrectCount: 25 }] });
  assert(newPlayer.filter(s => s.signal === 'milestone').length === 1,
    'a player with no prior standings row counts as 0, not as missing data — that is a new player crossing 25');
}

console.log('\n[12] Mutation-proofs — in-memory source copies only, never the file, never git…');
{
  const src = await readFile(fileURLToPath(new URL('./js/scribeLines.js', import.meta.url)), 'utf8');
  const toDataUrl = s => 'data:text/javascript;base64,' + Buffer.from(s, 'utf8').toString('base64');
  // The mutants import the REAL sibling modules by absolute URL, so they
  // share this process's already-loaded chat.js/scribeAgent.js state.
  const base = new URL('./js/', import.meta.url).href;
  const absolutize = s => s.replace(/from '\.\//g, `from '${base}`);

  // Mutation 1 — make the threshold `>` instead of `>=`.
  const m1src = absolutize(src.replace('clears: score >= threshold', 'clears: score > threshold'));
  assert(m1src !== absolutize(src), 'fixture check: mutation 1 changed the source');
  const m1 = await import(toDataUrl(m1src));
  assert(m1.scoreOpportunity([{ signal: 'x', points: 45 }], { level: 'balanced' }).clears === false,
    'MUTANT: with `>` instead of `>=`, a score exactly at the threshold stops firing — [2] is load-bearing');

  // Mutation 2 — drop the cooldown floor.
  const m2src = absolutize(src.replace(
    "  if (rateLimited(gameTag)) return { fired: false, reason: 'cooldown', ...scored };",
    '  // MUTATION: cooldown floor removed'));
  assert(m2src !== absolutize(src), 'fixture check: mutation 2 changed the source');
  const m2 = await import(toDataUrl(m2src));
  resetAll();
  const calls = wireStub();
  setCooldown('', Date.now() - 1000);
  m2._resetAutonomousStateForTest();
  const leaked = m2.considerAutonomous('backdoorBust', { subject: 'pX', signals: [{ signal: 'x', points: 999 }] });
  assert(leaked.fired === true,
    'MUTANT: without the floor, SCRIBE posts one second after its last message — [6] is what holds the rate limit that DEFINES the character');

  // Mutation 3 (F4) — treat a dedupe as "did not post" again.
  const m3src = absolutize(src.replace('    if (r && r.deduped === true) return r;', '    // MUTATION: deduped rolls back'));
  assert(m3src !== absolutize(src), 'fixture check: mutation 3 changed the source');
  const m3 = await import(toDataUrl(m3src));
  resetAll();
  wireStub({ autonomousResult: { ok: true, deduped: true, responseMessageId: 'scribe_auto_x' } });
  m3._resetAutonomousStateForTest();
  const dedup = m3.considerAutonomous('backdoorBust', { subject: 'pZ' });
  assert(dedup.fired === true, 'fixture check: the mutant candidate fired and reserved');
  await dedup.promise;
  assert(getCooldown('') === 0,
    'MUTANT: the reservation is released even though another device DID post — five of six devices would then be free to fire a canned line straight after it ([13] is what closes that)');

  // Mutation 4 (BLOCK-2) — remove the league-wide floor and the room-agnostic
  // consecutive guard, i.e. go back to "every bound is per gameTag", and let
  // considerWeekSignals loop over every signal again.
  const m4src = absolutize(src
    .replace("  if (globalBlocked) return { fired: false, reason: 'global_cooldown', ...scored };", '  // MUTATION: league-wide floor removed')
    .replace("  if (autonomousConsecutiveBlocked(null)) return { fired: false, reason: 'consecutive_all', ...scored };", '  // MUTATION: room-agnostic guard removed')
    .replace(`  const candidate = detected.reduce((best, s) => (pointsOf(s) > pointsOf(best) ? s : best), detected[0]);
  const outcome = considerAutonomous(candidate.signal, {
    subject: candidate.subject, gameTag: candidate.gameTag || '', weekId: (input && input.weekId) || '',
    playerId: (candidate.evidence && candidate.evidence.playerId) || '',
    signals: detected.map(s => ({ signal: s.signal })),
  });
  return { detected, outcomes: [outcome], candidate };`,
      `  const candidate = detected[0];
  const outcomes = detected.map(s => considerAutonomous(s.signal, {
    subject: s.subject, gameTag: s.gameTag || '', weekId: (input && input.weekId) || '',
    playerId: (s.evidence && s.evidence.playerId) || '', signals: [{ signal: s.signal }],
  }));
  return { detected, outcomes, candidate };`));
  assert(m4src !== absolutize(src), 'fixture check: mutation 4 changed the source');
  const m4 = await import(toDataUrl(m4src));
  resetAll();
  const calls4 = wireStub();
  m4._resetAutonomousStateForTest();
  storage.saveSetting('scribeFrequency', 'active');
  const players4 = [{ playerId: 'p1', active: true }, { playerId: 'p2', active: true }, { playerId: 'p3', active: true }];
  const games4 = [], picks4 = [];
  for (let i = 1; i <= 3; i++) {
    games4.push({ gameId: 'mg' + i, weekId: 'w1', status: 'final', homeTeam: 'H' + i, awayTeam: 'A' + i,
      kickoff: `2026-09-0${i}T17:00:00Z`, homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3 });
    // A DIFFERENT lone wolf in each game, so the mutant's per-signal ids are
    // all distinct and nothing but the missing league-wide floor is in play.
    ['p1', 'p2', 'p3'].forEach((pid, idx) => {
      picks4.push({ weekId: 'w1', playerId: pid, gameId: 'mg' + i, selectedTeam: (idx === i - 1 ? 'H' + i : 'A' + i) });
    });
  }
  m4.considerWeekSignals({ weekId: 'w1', weekStatus: 'final', games: games4, picks: picks4, players: players4 });
  assert(calls4.autonomous.length >= 3,
    `MUTANT: the same three-game finalize fires ${calls4.autonomous.length} simultaneous paid posts into one reader's stream — the exact defect BLOCK-2 found, and [17] is what closes it`);
  storage.saveSetting('scribeFrequency', 'balanced');

  // Mutation 5 (FINDING 1) — restore the flat sum.
  const m5src = absolutize(src.replace(
    '  return a + 0.5 * (b + c);',
    '  return collapsed.reduce((t, x) => t + (Number(x.points) || 0), 0);   // MUTATION: flat sum'));
  assert(m5src !== absolutize(src), 'fixture check: mutation 5 changed the source');
  const m5 = await import(toDataUrl(m5src));
  const ordinary5 = m5.scoreOpportunity(['streak', 'loneWolfWin', 'unanimous'], { level: 'quiet' });
  assert(ordinary5.score === 90 && ordinary5.clears === true,
    `MUTANT: with a flat sum an ORDINARY week scores ${ordinary5.score} and fires on QUIET — the dial stops discriminating, which is what FINDING 1 found and [21]/[23] close`);

  // Mutation 6 (FINDING 1) — remove the collapse-by-name.
  const m6src = absolutize(src.replace(
    `    const prev = byName.get(name);
    if (prev === undefined || pts > prev) byName.set(name, pts);`,
    '    byName.set(name, (byName.get(name) || 0) + pts);   // MUTATION: instances accumulate'));
  assert(m6src !== absolutize(src), 'fixture check: mutation 6 changed the source');
  const m6 = await import(toDataUrl(m6src));
  const spam6 = m6.scoreOpportunity(Array.from({ length: 20 }, () => ({ signal: 'verbosity' })), { level: 'quiet' });
  assert(spam6.score === 200 && spam6.clears === true,
    `MUTANT: without the name collapse, twenty verbosity signals score ${spam6.score} and post on QUIET — cardinality buys volume, the second half of FINDING 1`);
}

// ══════════════════════════════════════════════════════════════════════════
// [25] FEAT-5 / DI-202j (UN-202, 2026-09-12) — WAGERS NEVER TOUCH SCORING.
//
// Drew, verbatim: "they should not influence pickem scores." That was not
// merely dropped as a non-feature — it was converted into a NEGATIVE design
// input with a proof. A comment is not verification; this is.
//
// Two halves, and both are needed. The BEHAVIOURAL half computes the money
// numbers with a store that has wagers all over it and with the identical store
// that has none, and requires the two to be BYTE-IDENTICAL. The STRUCTURAL half
// shows why that is not a coincidence: js/scoring.js cannot reach the memory
// sheet at all.
// ══════════════════════════════════════════════════════════════════════════
console.log('\n[25] FEAT-5 / DI-202j — wagers never influence pickem scores…');
{
  const scoring = await import('./js/scoring.js');

  const players25 = [
    { playerId: 'w_p1', displayName: 'Drew', active: true },
    { playerId: 'w_p2', displayName: 'Brayden', active: true },
    { playerId: 'w_p3', displayName: 'Kevin', active: true },
  ];
  const week25 = { weekId: 'w_wk1', season: '2026', weekNumber: 1, status: 'final',
                   startDate: '2026-09-05', endDate: '2026-09-06', actualTiebreakerValue: 51 };
  const games25 = [];
  const picks25 = [];
  for (let i = 1; i <= 4; i++) {
    games25.push({ gameId: 'w_g' + i, weekId: 'w_wk1', status: 'final',
      homeTeam: 'Home' + i, awayTeam: 'Away' + i, kickoff: `2026-09-0${i}T17:00:00Z`,
      homeScore: 30, awayScore: 20, spread: -3, lockedSpread: -3, favorite: 'home',
      multiplier: i === 1 ? 2 : 1 });
    picks25.push({ pickId: `w_k1_${i}`, weekId: 'w_wk1', playerId: 'w_p1', gameId: 'w_g' + i, selectedTeam: 'Home' + i, tiebreakerGuess: 50 });
    picks25.push({ pickId: `w_k2_${i}`, weekId: 'w_wk1', playerId: 'w_p2', gameId: 'w_g' + i, selectedTeam: 'Away' + i, tiebreakerGuess: 44 });
    picks25.push({ pickId: `w_k3_${i}`, weekId: 'w_wk1', playerId: 'w_p3', gameId: 'w_g' + i, selectedTeam: i <= 2 ? 'Home' + i : 'Away' + i, tiebreakerGuess: 60 });
  }
  const compute25 = () => {
    const weekly = scoring.calculateWeeklyResults('w_wk1', players25, picks25, games25, week25.actualTiebreakerValue);
    const season = scoring.calculateSeasonStandings(players25, weekly, [week25]);
    return JSON.stringify({ weekly, season });
  };

  // ── A store with NO wagers anywhere. ──
  localStorage.removeItem('cfbp_wager_resurfaced');
  const before25 = compute25();
  assert(before25.length > 200 && /correctPicks/.test(before25) && /correctCount/.test(before25),
    '25-1: fixture check — the baseline really computed both tallies (weighted for standings, raw for audit), so the comparison below is not comparing two empty objects');

  // ── The SAME store, now with wagers on every surface this feature touches:
  //    the device ledger (the ONE KV key the feature adds), the proposer and
  //    counterparty memory rows, and both SCRIBE posts sitting in the room. ──
  storage.setWagerResurfaced('wA');
  storage.setWagerResurfaced('wB');
  const wagerRows25 = [
    { id: 'mem_wA', playerId: 'w_p1', kind: 'wager', key: 'wager:wA',
      value: JSON.stringify({ c: 'Home1 covers by 30', o: 'w_p2', w: 'w_wk1', b: 'w_p3' }),
      provenance: 'player-stated', confidence: 1, reviewAt: '2026-09-06T23:59:59.000Z', sourceMessageId: 'm_a' },
    { id: 'mem_aA', playerId: 'w_p2', kind: 'wager', key: 'wagerack:wA',
      value: JSON.stringify({ w: 'wA', r: 'accepted' }), provenance: 'player-stated', confidence: 1 },
    { id: 'mem_wB', playerId: 'w_p3', kind: 'wager', key: 'wager:wB',
      value: JSON.stringify({ c: 'Nobody goes 4-0', o: '', w: 'w_wk1', b: 'w_p3' }),
      provenance: 'player-stated', confidence: 1, reviewAt: '2026-09-06T23:59:59.000Z', sourceMessageId: 'm_b' },
  ];
  chat._resetForTest?.();
  chat.ingest?.([
    { seq: 1, id: 'scribe_wager_wA', ts: Date.now(), type: 'message', author: 'scribe', gameTag: '',
      body: 'Logged. Drew against Brayden, due by Week 1.', targetId: '', replyTo: 'm_a',
      meta: { kind: 'wagerLogged', wagerId: 'wA', proposerId: 'w_p1', counterpartyId: 'w_p2' } },
    { seq: 2, id: 'scribe_wagerdue_wA', ts: Date.now(), type: 'message', author: 'scribe', gameTag: '',
      body: 'Week 1, as promised.', targetId: '', replyTo: 'm_a',
      meta: { kind: 'wagerDue', wagerId: 'wA', status: 'accepted' } },
  ]);
  const after25 = compute25();
  assert(after25 === before25,
    '25-2: BYTE-IDENTICAL weekly results and season standings with wagers present and absent — a logged wager, an accepted answer, both SCRIBE posts and a written device ledger move no number that decides who owes whom money');
  assert(storage.getWagerResurfaced().length === 2 && wagerRows25.length === 3,
    '25-3: fixture check — the wagers really were present for that comparison (ledger written, rows built), so 25-2 is not passing on an empty second half');

  // ── STRUCTURAL: why 25-2 is not a coincidence. ──
  const scoringSrc25 = await readFile(fileURLToPath(new URL('./js/scoring.js', import.meta.url)), 'utf8');
  assert(!/from '\.\/(scribeAgent|backend|scribeLines|chat|chat-ui)\.js'/.test(scoringSrc25),
    '25-4: js/scoring.js imports NOTHING from scribeAgent / backend / scribeLines / chat — the memory sheet is not merely unused by it, it is unreachable from it');
  const scoringCode25 = scoringSrc25.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/wager/i.test(scoringCode25),
    '25-5: …and the word "wager" appears nowhere in its live code — no field, no branch, no tally');
  const storageSrc25 = await readFile(fileURLToPath(new URL('./js/storage.js', import.meta.url)), 'utf8');
  const keys25 = (storageSrc25.match(/const KEYS = \{[\s\S]*?\n\};/) || [''])[0];
  const wagerKeys25 = (keys25.match(/^\s*\w*WAGER\w*\s*:/gim) || []);
  assert(wagerKeys25.length === 1 && /WAGER_RESURFACED/.test(wagerKeys25[0]),
    `25-6: the KV surface gained EXACTLY ONE key for this whole feature — the device ledger — and nothing else (found ${wagerKeys25.length})`);
  const devLocal25 = (storageSrc25.match(/const DEVICE_LOCAL_KEYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
  assert(/KEYS\.WAGER_RESURFACED/.test(devLocal25),
    '25-7: …and that one key is DEVICE-LOCAL, so it never reaches the Sheet the scoring data lives in');
  localStorage.removeItem('cfbp_wager_resurfaced');
}

console.log('\n══════════════════════════════════════════════════');
console.log(fail === 0 ? `✅ ALL PASS — ${pass} passed, ${fail} failed` : `❌ FAILURES — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
