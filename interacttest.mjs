#!/usr/bin/env node
/**
 * interacttest.mjs — SCRIBE v3, Package D: the interactive member, proved start to finish.
 * ============================================================================
 * Run:  cd cfb-pickems && node interacttest.mjs
 * (loadtest.mjs spawns it with a ratcheted floor — see its spawned-suites table.)
 *
 * WHY ITS OWN FILE, per CONVENTIONS #28 and the `grouptest.mjs` / `heattest.mjs` /
 * `reasonchiptest.mjs` precedent: Package D adds four small pure things — an
 * alternation predicate, two signal-table entries, a candidate/judge parser pair
 * and a deterministic one-in-four draw — and each of them decides, on its own,
 * whether SCRIBE speaks and how. Those read as proofs top to bottom rather than
 * buried among chat-fold shuffles.
 *
 * SPAWNED BECAUSE A SUITE NOTHING SPAWNS IS A SUITE NOBODY RUNS — the xsstest /
 * transporttest / persisttest / static.check / notifytest / heattest /
 * reasonchiptest lesson, applied at the moment the file is written rather than
 * months later. It also replaces `globalThis.document` wholesale for its chat-ui
 * section, which is exactly the kind of stub loadtest [73] keeps out of its own
 * process.
 *
 * COVERS:
 *   [1] DI-284/287 — the two new SIGNAL_POINTS entries, and the TWIN SYNC: the
 *       client's table (js/scribeLines.js) and the server's (js/scribe-scoring.js)
 *       are the same table, key for key and value for value.
 *   [2] DI-287 — `heatedExchangeRun()`'s full matrix, and `detectHeatedExchange()`
 *       over it: four alternating, exactly two authors, inside five minutes, with
 *       SCRIBE's own posts and system rows excluded.
 *   [3] DI-283 — `REACTION_PALETTE` is the classify schema's enum, in both
 *       directions, plus `'none'` and nothing else.
 *   [4] DI-283 — js/chat-ui.js renders `'scribe'` as a REACTOR without an
 *       avatar/name lookup error. The coordinator's amendment 3 made this a HARD
 *       REQUIREMENT rather than a verify-only note, and this is that test.
 *   [5] DI-283 — the classify trigger is widened to every human message, and is
 *       STILL single-flight.
 *   [6] DI-286 — `parseCandidates()` and `parseJudgeVerdict()`: the three input
 *       shapes, the clamp, and `-1`.
 *   [7] DI-284 — `concedeRoast()` is deterministic, independent of the heat
 *       draw, and lands near one in four.
 *   [8] DI-286/288 — the judge's rubric quotes docs/SCRIBE.md's two tests
 *       VERBATIM, pinned against the shipped persona snapshot.
 *
 * NOT HERE: whether any of this reaches Anthropic. That is a property of the two
 * handlers' wiring and is asserted in `scribeAutonomous.twin.mjs`,
 * `scribeAsk.twin.mjs` and `scribeReact.twin.mjs`, where the real handlers run.
 */

import {
  SIGNAL_POINTS as SERVER_SIGNAL_POINTS,
  heatedExchangeRun, HEATED_MIN_LEN, HEATED_WINDOW_MS,
} from './js/scribe-scoring.js';
import { REACTION_PALETTE, effectiveScribeBestOfN, SCRIBE_BEST_OF_N_DEFAULT, SCRIBE_BEST_OF_N_VALUES } from './js/data-model.js';
import {
  parseCandidates, parseJudgeVerdict, summarizeJudge, JUDGE_REJECTION_REASONS,
  JUDGE_SYSTEM, SCREENSHOT_TEST, ASSERTION_OF_TRUTH_TEST, BEST_OF_CANDIDATES,
  CANDIDATES_OUTPUT_FORMAT, JUDGE_OUTPUT_FORMAT, CANDIDATES_INSTRUCTION,
} from './supabase/functions/_shared/scribe-bestof.mjs';
import { concedeRoast, ROAST_CONCEDE_RATE } from './supabase/functions/_shared/scribe-context.mjs';
import { SCRIBE_PERSONA_TEXT } from './supabase/functions/_shared/scribe-persona.mjs';
import { readFileSync } from 'node:fs';

// ── DOM / browser stubs — same shape as reasonchiptest.mjs's ────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in interacttest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const storage = await import('./js/storage.js');
const chat = await import('./js/chat.js');
const chatUi = await import('./js/chat-ui.js');
const scribeLines = await import('./js/scribeLines.js');

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] DI-284/287 — the two new signals, and the TWIN SYNC…');
// ═══════════════════════════════════════════════════════════════════════════
{
  const client = scribeLines.SIGNAL_POINTS;
  const server = SERVER_SIGNAL_POINTS;
  assert(server.roastOfScribe === 50,
    `1-1: roastOfScribe is 50 server-side (got ${server.roastOfScribe})`);
  assert(client.roastOfScribe === 50,
    `1-2: …and 50 client-side (got ${client.roastOfScribe})`);
  assert(server.heatedExchange === 20 && client.heatedExchange === 20,
    `1-3: heatedExchange is 20 on both sides (server ${server.heatedExchange}, client ${client.heatedExchange})`);

  // THE SYNC ASSERTION ITSELF. `js/scribeLines.js` cannot be imported into a Deno
  // Edge Function (it reaches fetch/DOM/localStorage), so `js/scribe-scoring.js`
  // is a deliberate SECOND copy of this table — and a second copy is only safe
  // while something compares them. This is that something.
  const ck = Object.keys(client).sort();
  const sk = Object.keys(server).sort();
  assert(JSON.stringify(ck) === JSON.stringify(sk),
    `1-4: the two tables carry the SAME KEYS — client ${JSON.stringify(ck)} vs server ${JSON.stringify(sk)}`);
  const differ = ck.filter((k) => client[k] !== server[k]);
  assert(differ.length === 0,
    `1-5: …and the SAME VALUE for every one of them (${differ.length} disagreements: ${JSON.stringify(differ.map((k) => [k, client[k], server[k]]))})`);
  assert(Object.isFrozen(server),
    '1-6: the server copy is FROZEN — it is the allow-list `scribe-autonomous` checks a client-supplied trigger against (N-6), and a list that can be pushed to at runtime is not one');

  // 50 CLEARS BALANCED ON ITS OWN, which is the whole of Drew's §6 answer to
  // open question 2: a direct roast reliably gets an answer rather than needing
  // a second signal in the same bucket.
  const { SCRIBE_FREQUENCY_LEVELS } = await import('./js/data-model.js');
  assert(server.roastOfScribe >= SCRIBE_FREQUENCY_LEVELS.balanced,
    `1-7: roastOfScribe (${server.roastOfScribe}) clears the DEFAULT dial, balanced (${SCRIBE_FREQUENCY_LEVELS.balanced}), on its own — the difference between "SCRIBE answers back" and "SCRIBE answers back when something else also happened"`);
  assert(server.heatedExchange < SCRIBE_FREQUENCY_LEVELS.balanced,
    `1-8: heatedExchange (${server.heatedExchange}) does NOT clear it alone — an ambient "you two are going back and forth" has to combine with something, which is the restraint DI-287 asked for`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] DI-287 — the heated-exchange matrix…');
// ═══════════════════════════════════════════════════════════════════════════
const T0 = 1_700_000_000_000;
const row = (author, offsetMs) => ({ author, ts: T0 + offsetMs });
{
  assert(HEATED_MIN_LEN === 4 && HEATED_WINDOW_MS === 5 * 60 * 1000,
    `2-1: DI-287's own numbers — four messages, five minutes (got ${HEATED_MIN_LEN}, ${HEATED_WINDOW_MS})`);

  const alternating = [row('a', 0), row('b', 1000), row('a', 2000), row('b', 3000)];
  const r = heatedExchangeRun(alternating);
  assert(r.heated === true, '2-2: A B A B inside the window FIRES');
  assert(JSON.stringify(r.authors) === JSON.stringify(['a', 'b']),
    `2-3: …and names the pair, SORTED, so six devices that saw it in different arrival orders mint the same post id (got ${JSON.stringify(r.authors)})`);
  assert(r.count === 4 && r.spanMs === 3000, `2-4: …with the real count and span (got ${r.count}, ${r.spanMs})`);

  assert(heatedExchangeRun([row('a', 0), row('b', 1000), row('a', 2000)]).heated === false,
    '2-5: THREE messages is not an exchange — one short of the floor');
  assert(heatedExchangeRun([]).heated === false, '2-6: an empty list is not an exchange');
  assert(heatedExchangeRun(null).heated === false, '2-7: …and neither is null (CONVENTIONS #7 at the boundary)');

  assert(heatedExchangeRun([row('a', 0), row('a', 1000), row('b', 2000), row('b', 3000)]).heated === false,
    '2-8: A A B B does NOT fire. Two people said four things; nobody went back and forth. This is the assertion that makes the rule ALTERNATION rather than "two authors, four rows"');
  assert(heatedExchangeRun([row('a', 0), row('b', 1000), row('b', 2000), row('a', 3000)]).heated === false,
    '2-9: …nor does A B B A — one consecutive repeat anywhere in the run breaks it');

  assert(heatedExchangeRun([row('a', 0), row('b', 1000), row('c', 2000), row('a', 3000)]).heated === false,
    '2-10: THREE authors does not fire — a three-way conversation is a conversation, not two people arguing');

  const slow = [row('a', 0), row('b', 100000), row('a', 200000), row('b', 400000)];
  assert(heatedExchangeRun(slow).heated === false,
    `2-11: the same four alternating messages spread over ${400000 / 1000}s do NOT fire — 400s is past the five-minute window, and four messages across seven minutes is a conversation, not an argument`);
  const justInside = [row('a', 0), row('b', 1000), row('a', 2000), row('b', HEATED_WINDOW_MS)];
  assert(heatedExchangeRun(justInside).heated === true,
    '2-12: …while exactly AT the window boundary still fires (the comparison is `>` on the span, so the edge is inclusive)');

  assert(heatedExchangeRun([row('a', 0), row('b', 1000), { author: 'a', ts: NaN }, row('b', 3000)]).heated === false,
    '2-13: an UNPLACEABLE timestamp refuses the whole run — "probably recent" is exactly the guess CONVENTIONS #7 exists to refuse, and a span computed over a NaN is not a span');

  // THE FRESHNESS BOUND, which only applies when the caller supplies `now`.
  assert(heatedExchangeRun(alternating, { now: T0 + 4000 }).heated === true,
    '2-14: with `now` just after the run, it still fires');
  assert(heatedExchangeRun(alternating, { now: T0 + 10 * 60 * 1000 }).heated === false,
    '2-15: …but an exchange that ENDED ten minutes ago does not — SCRIBE arriving late to an argument that is already over is the annoying failure, not the instigating one');

  // ONLY THE LAST `minLen` MATTER. A long, calm history in front of a live
  // exchange must not suppress it.
  const longTail = [row('c', -100000), row('c', -90000), row('a', 0), row('b', 1000), row('a', 2000), row('b', 3000)];
  assert(heatedExchangeRun(longTail).heated === true,
    '2-16: only the LAST four rows are considered — an exchange that starts after a quiet stretch still fires');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2b] DI-287 — detectHeatedExchange() over the room…');
// ═══════════════════════════════════════════════════════════════════════════
{
  const m = (author, offsetMs, extra = {}) => ({ type: 'message', author, ts: T0 + offsetMs, ...extra });
  const out = scribeLines.detectHeatedExchange(
    [m('a', 0), m('b', 1000), m('a', 2000), m('b', 3000)], { now: T0 + 4000, gameTag: 'g1' });
  assert(out.length === 1 && out[0].signal === 'heatedExchange',
    `2b-1: a live exchange yields exactly one signal (got ${JSON.stringify(out)})`);
  assert(out[0].subject === 'a+b',
    `2b-2: the subject is the SORTED pair joined — deterministic across six devices (got ${out[0].subject})`);
  assert(out[0].gameTag === 'g1', '2b-3: …scoped to the room it happened in');
  assert(out[0].evidence && out[0].evidence.count === 4, '2b-4: …carrying the count as evidence');

  // SCRIBE'S OWN POSTS AND SYSTEM ROWS ARE NOT TURNS. This is the assertion
  // that stops SCRIBE manufacturing the alternation that justifies its next post.
  const withScribe = [m('a', 0), m('scribe', 500), m('b', 1000), m('a', 2000), m('b', 3000)];
  const r2 = scribeLines.detectHeatedExchange(withScribe, { now: T0 + 4000 });
  assert(r2.length === 1,
    '2b-5: a SCRIBE post sitting inside the exchange is filtered out, and the four human turns around it still read as alternating — SCRIBE\'s own line is not a turn in somebody else\'s argument');
  const scribeAsAuthor = [m('scribe', 0), m('a', 1000), m('scribe', 2000), m('a', 3000)];
  assert(scribeLines.detectHeatedExchange(scribeAsAuthor, { now: T0 + 4000 }).length === 0,
    '2b-6: SCRIBE alternating with ONE player is NOT a heated exchange — that is a conversation with SCRIBE, and §9.5 forbids creating conversation merely to keep SCRIBE talking');
  const withSystem = [m('system', 0), m('a', 1000), m('b', 1500), m('a', 2000), m('b', 3000)];
  assert(scribeLines.detectHeatedExchange(withSystem, { now: T0 + 4000 }).length === 1,
    '2b-7: a `system` row is filtered the same way');
  const withDeleted = [m('a', 0), m('b', 1000), m('a', 2000), m('b', 2500, { deleted: true }), m('b', 3000)];
  assert(scribeLines.detectHeatedExchange(withDeleted, { now: T0 + 4000 }).length === 1,
    '2b-8: a DELETED message is not a turn either — a withdrawn line is not something somebody said');
  const nonMessage = [m('a', 0), { type: 'react', author: 'b', ts: T0 + 1000 }, m('b', 1500), m('a', 2000), m('b', 3000)];
  assert(scribeLines.detectHeatedExchange(nonMessage, { now: T0 + 4000 }).length === 1,
    '2b-9: a `react` row is not a turn — an emoji is not a rebuttal');
  assert(scribeLines.detectHeatedExchange([], {}).length === 0, '2b-10: an empty room yields nothing');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] DI-283 — REACTION_PALETTE is the classify schema\'s enum…');
// ═══════════════════════════════════════════════════════════════════════════
{
  const src = readFileSync(new URL('./supabase/functions/scribe-classify/index.js', import.meta.url), 'utf8');
  assert(/const REACTION_ENUM = \[\.\.\.REACTION_PALETTE, 'none'\];/.test(src),
    '3-1: the enum is BUILT FROM THE IMPORT, not retyped — so the emoji the model may return, the emoji js/chat.js\'s fold accepts and the emoji scribe-react writes are the same list by construction');
  assert(/import \{ REACTION_PALETTE[^}]*\} from '\.\.\/\.\.\/\.\.\/js\/data-model\.js';/.test(src),
    '3-2: …imported from js/data-model.js, the one home AD-20 gives it');
  assert(/reactionEmoji: \{ type: 'string', enum: REACTION_ENUM \}/.test(src),
    '3-3: …and it really is the schema\'s enum rather than a bare string the model could fill with anything');
  assert(/required: \['claim', 'kind', 'confidence', 'reactionEmoji', 'roastOfScribe'\]/.test(src),
    '3-4: both new fields are REQUIRED — an optional one would come back absent on exactly the calls that mattered');

  // The enum's CONTENT, asserted against the palette in both directions.
  const enumList = [...REACTION_PALETTE, 'none'];
  assert(enumList.length === REACTION_PALETTE.length + 1,
    `3-5: the enum is the palette PLUS EXACTLY ONE extra word (got ${enumList.length} for a palette of ${REACTION_PALETTE.length})`);
  assert(enumList.filter((e) => !REACTION_PALETTE.includes(e)).join() === 'none',
    '3-6: …and that word is `none`, which is not a palette entry and never becomes one');
  assert(REACTION_PALETTE.every((e) => enumList.includes(e)),
    '3-7: …and every palette emoji is offered (a nineteenth could not reach a model\'s output enum without somebody adding it to the palette first)');
  assert(Object.isFrozen(REACTION_PALETTE),
    '3-8: the palette is FROZEN — it is an allow-list at three write seams now, not two');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] DI-283 — chat-ui renders `scribe` as a REACTOR…');
// ═══════════════════════════════════════════════════════════════════════════
//
// THE COORDINATOR'S AMENDMENT 3 made this a HARD REQUIREMENT rather than DI-283's
// original verify-only note, and it is the right call: every OTHER reactor in this
// app's history has been a roster member, `reactionNamesHTML()` resolves each one
// through `nameOf()`, and a lookup that fell through to `getPlayer(id)?.displayName`
// for an id that is not a player is the shape of a render that throws or prints
// `undefined` in the room. SCRIBE is now the first non-member reactor.
{
  storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true });
  storage.addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true });

  const msg = { id: 'm1', author: 'p1', body: 'hi', type: 'message', reactions: { '🔥': ['scribe'] } };
  let html = null, threw = null;
  try { html = chatUi._reactionsHTML(msg, 'p1'); } catch (err) { threw = err; }
  assert(threw === null,
    `4-1: rendering a reaction whose ONLY reactor is 'scribe' does not throw (got ${threw && threw.message})`);
  assert(typeof html === 'string' && html.includes('🔥'),
    `4-2: …and the pill renders with the emoji (got ${JSON.stringify(html)})`);
  assert(html.includes('S.C.R.I.B.E.'),
    `4-3: …and the attribution line NAMES it — nameOf('scribe') answers before any getPlayer() lookup, so there is no undefined and no raw id in the room (got ${JSON.stringify(html)})`);
  assert(!/undefined/.test(html),
    '4-4: …and the word `undefined` appears nowhere in the output, which is what a fallen-through name lookup actually looks like on screen');
  assert(html.includes('🔥 1'),
    '4-5: …and the count is 1, so SCRIBE is counted as a reactor rather than silently dropped');

  // MIXED — SCRIBE alongside a real player, which is the common case.
  const mixed = { id: 'm2', author: 'p1', body: 'hi', type: 'message', reactions: { '💀': ['p2', 'scribe'] } };
  const mixedHtml = chatUi._reactionsHTML(mixed, 'p1');
  assert(mixedHtml.includes('Brayden') && mixedHtml.includes('S.C.R.I.B.E.'),
    `4-6: a mixed group names BOTH the player and SCRIBE (got ${JSON.stringify(mixedHtml)})`);
  assert(mixedHtml.includes('💀 2'), '4-7: …and counts both');

  // `me` HIGHLIGHTING MUST NOT FIRE FOR SCRIBE when the viewer is a player.
  assert(!/chat-react-pill me/.test(chatUi._reactionsHTML(msg, 'p1')),
    '4-8: a SCRIBE reaction does not render as the VIEWER\'s own (`.me`) — the pill is a tap-to-toggle-mine control, and a player must not be shown SCRIBE\'s tap as theirs');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] DI-283 — the classify trigger is widened, and still single-flight…');
// ═══════════════════════════════════════════════════════════════════════════
{
  const src = readFileSync(new URL('./js/scribeLines.js', import.meta.url), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, ' ')).join('\n');
  assert(!/if \(chatClaimPrefilter\(body\)\) \{[\s\S]{0,80}considerClaim/.test(code),
    '5-1: `considerClaim` is NO LONGER gated behind `chatClaimPrefilter` — the prefilter is a bold-claim keyword pass and most reactable messages are not claims (DI-283\'s own reasoning)');
  assert(/considerClaim\(\{ triggerMessageId, gameTag, author \}\);/.test(code),
    '5-2: …it is called unconditionally for every non-@scribe human message');
  assert(typeof scribeLines.chatClaimPrefilter === 'function',
    '5-3: …and `chatClaimPrefilter` is NOT DELETED. It is still the honest description of the CLAIM half, scoringtest still asserts it, and a future pass that wants to narrow the trigger again has the function it would narrow to');
  assert(scribeLines.chatClaimPrefilter('this is a lock of the week') === true
    && scribeLines.chatClaimPrefilter('what time do picks lock') === true
    && scribeLines.chatClaimPrefilter('morning') === false,
    '5-4: …and it still behaves, so 5-3 is not passing on a stub');

  assert(/let classifyInFlight = false;/.test(code) && /if \(!triggerMessageId \|\| classifyInFlight\) return null;/.test(code),
    '5-5: the SINGLE-FLIGHT guard survives the widening. It is now the primary bound on a burst of typing — the keyword gate that used to filter most messages out is gone, so a device must still never have two classify calls in the air at once');
  assert(/\.finally\(\(\) => \{ classifyInFlight = false; \}\)/.test(code),
    '5-6: …and it is cleared in a `finally`, so a rejected round trip cannot latch the classifier off for the rest of the session');
  assert(/if \(Date\.now\(\) < autonomyOffUntil\) return null;/.test(code),
    '5-7: …and the 30-minute off-latch still gates the CALL and not just the post, which is what keeps a league with the server switch off at one wasted request per half hour rather than one per message');

  // THE REACTION RELAY IS FIRED FROM THE CLASSIFY RESULT, not from the score.
  assert(/scribeReactRemote\(\{ messageId: triggerMessageId \}\)/.test(code),
    '5-8: the reaction relay fires off the classify result');
  assert(/const classified = !!\(r && r\.ok && !r\.skipped\);/.test(code),
    '5-9: …gated on the call having produced a VERDICT — a skipped classify wrote none, so asking for a reaction would spend a react ticket to be told so');
  const reactAt = code.indexOf('scribeReactRemote');
  const pointsAt = code.indexOf('const points = Number(r && r.points) || 0;');
  assert(reactAt > -1 && pointsAt > -1 && reactAt < pointsAt,
    '5-10: …and it fires INDEPENDENTLY of the points, before them — a reaction is not an autonomous post and must not be gated like one');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] DI-286 — the candidate and judge parsers…');
// ═══════════════════════════════════════════════════════════════════════════
{
  assert(BEST_OF_CANDIDATES === 3, `6-1: three candidates (got ${BEST_OF_CANDIDATES})`);
  assert(CANDIDATES_OUTPUT_FORMAT.schema.properties.candidates.minItems === 3
    && CANDIDATES_OUTPUT_FORMAT.schema.properties.candidates.maxItems === 3,
    '6-2: the schema pins BOTH minItems and maxItems — a model that returned one is not cheaper, it is a best-of-1 wearing a best-of-3\'s cost');

  const good = JSON.stringify({ candidates: ['one', 'two', 'three'] });
  assert(JSON.stringify(parseCandidates(good)) === JSON.stringify(['one', 'two', 'three']),
    '6-3: the intended shape parses');
  assert(JSON.stringify(parseCandidates('["a","b","c"]')) === JSON.stringify(['a', 'b', 'c']),
    '6-4: a BARE ARRAY parses too — a model that dropped the wrapper has still produced three candidates');
  assert(JSON.stringify(parseCandidates('just a line of prose')) === JSON.stringify(['just a line of prose']),
    '6-5: UNPARSEABLE text becomes ONE candidate rather than silence. With bestOfN defaulting to 3, a single upstream shape surprise would otherwise silence SCRIBE entirely on both voice paths — and "SCRIBE went quiet" is the failure this project is least equipped to notice');
  assert(parseCandidates('   ').length === 0 && parseCandidates('').length === 0 && parseCandidates(null).length === 0,
    '6-6: …but genuinely EMPTY text yields nothing at all, and the caller posts nothing');
  assert(JSON.stringify(parseCandidates(JSON.stringify({ candidates: ['', '  ', 'real'] }))) === JSON.stringify(['real']),
    '6-7: empty candidates are dropped — `["","","x"]` is one candidate, not three');
  assert(parseCandidates(JSON.stringify({ candidates: ['a', 'b', 'c', 'd', 'e'] })).length === 3,
    '6-8: …and more than three are capped at three');

  const verdict = parseJudgeVerdict(JSON.stringify({ winnerIndex: 1, rejections: [{ index: 0, reason: 'not_funny' }] }), 3);
  assert(verdict.winnerIndex === 1 && verdict.parsed === true, '6-9: a well-formed verdict parses');
  assert(verdict.rejections.length === 1 && verdict.rejections[0].reason === 'not_funny', '6-10: …carrying its rejections');

  assert(parseJudgeVerdict(JSON.stringify({ winnerIndex: -1, rejections: [] }), 3).winnerIndex === -1,
    '6-11: `-1` is LEGAL and means no post — rejecting all three is a correct answer, not a failure');
  assert(parseJudgeVerdict(JSON.stringify({ winnerIndex: 7, rejections: [] }), 3).winnerIndex === -1,
    '6-12: an OUT-OF-RANGE winner resolves to -1, not to "pick one anyway" — a model that answered 7 for three candidates has failed, and the fail-closed reading of a quality gate is silence');
  assert(parseJudgeVerdict('not json', 3).winnerIndex === -1 && parseJudgeVerdict('not json', 3).parsed === false,
    '6-13: an UNPARSEABLE verdict is -1. The judge IS the quality gate; a gate that cannot answer must not wave the batch through');
  assert(parseJudgeVerdict('', 3).winnerIndex === -1, '6-14: …and so is an empty one');

  const clamped = parseJudgeVerdict(JSON.stringify({ winnerIndex: 0, rejections: [{ index: 1, reason: 'he quoted Kevin saying something private' }] }), 3);
  assert(clamped.rejections[0].reason === 'other',
    `6-15: a REJECTION REASON off the closed set is clamped to 'other'. This is the clause that makes DI-286's "no player text" true by construction rather than by a sanitiser — the judge's own prose can never reach job_runs (got ${clamped.rejections[0].reason})`);
  const badIdx = parseJudgeVerdict(JSON.stringify({ winnerIndex: 0, rejections: [{ index: 9, reason: 'not_funny' }] }), 3);
  assert(badIdx.rejections.length === 0, '6-16: …and a rejection naming a candidate that does not exist is dropped');

  assert(JUDGE_OUTPUT_FORMAT.schema.properties.rejections.items.properties.reason.enum.length === JUDGE_REJECTION_REASONS.length,
    '6-17: the schema offers the SAME closed set the parser clamps to — the model is not asked to volunteer a word that would be thrown away');
  assert(JUDGE_REJECTION_REASONS.includes('other'), '6-18: …including the fallback word itself');

  const summary = summarizeJudge({ rejections: [{ index: 0, reason: 'too_mean' }, { index: 2, reason: 'too_mean' }, { index: 1, reason: 'not_funny' }] }, 3);
  assert(summary.bestOfN === 3 && summary.bestOfRejected === 3, `6-19: the summary counts (got ${JSON.stringify(summary)})`);
  assert(JSON.stringify(summary.bestOfReasons) === JSON.stringify(['not_funny', 'too_mean']),
    `6-20: …and DEDUPLICATES and SORTS the reasons, so the anti-canon seed is a stable set of failure modes rather than a transcript (got ${JSON.stringify(summary.bestOfReasons)})`);
  assert(JSON.stringify(summarizeJudge(null, 0)) === JSON.stringify({ bestOfN: 0, bestOfRejected: 0, bestOfReasons: [] }),
    '6-21: …and a missing verdict summarises to zeroes rather than throwing');
}
{
  assert(SCRIBE_BEST_OF_N_DEFAULT === 3, `6-22: bestOfN defaults to 3, ON (Drew's §6 decision) — got ${SCRIBE_BEST_OF_N_DEFAULT}`);
  assert(JSON.stringify(SCRIBE_BEST_OF_N_VALUES) === JSON.stringify([1, 3]), '6-23: …out of a CLOSED set of two');
  assert(effectiveScribeBestOfN(1) === 1 && effectiveScribeBestOfN(3) === 3, '6-24: both legal values bind');
  for (const raw of [undefined, null, 0, 2, 5, 'three', {}, NaN, -1]) {
    assert(effectiveScribeBestOfN(raw) === 3,
      `6-25: garbage (${JSON.stringify(raw)}) resolves to the DEFAULT 3, not to 1 — unlike the heat and learning-rate dials, this one's safe direction is "the quality gate stays on"`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] DI-284 — concedeRoast() is deterministic and near one in four…');
// ═══════════════════════════════════════════════════════════════════════════
{
  assert(ROAST_CONCEDE_RATE === 0.25, `7-1: about one in four (got ${ROAST_CONCEDE_RATE})`);
  const id = 'scribe_auto_roastOfScribe_m1_283000';
  assert(concedeRoast(id) === concedeRoast(id) && concedeRoast(id) === concedeRoast(id),
    '7-2: DETERMINISTIC for one id — a retried or duplicated invocation must not answer the same roast in two different registers depending on which one won the ticket');

  let conceded = 0;
  const N = 4000;
  for (let i = 0; i < N; i += 1) if (concedeRoast(`scribe_auto_roastOfScribe_m${i}_283000`)) conceded += 1;
  const observed = conceded / N;
  assert(Math.abs(observed - ROAST_CONCEDE_RATE) < 0.04,
    `7-3: over ${N} ids the rate lands near ${ROAST_CONCEDE_RATE} (observed ${observed.toFixed(3)}) — a rate somebody chose and somebody can observe, which is the whole reason this is a draw rather than a licence in the prompt`);
  assert(conceded > 0 && conceded < N,
    '7-4: …and it is genuinely both — a function that always or never conceded would also pass a "deterministic" test');

  // INDEPENDENCE FROM THE HEAT DRAW. Two features sharing one hash over one id
  // would mean every explored post was also a concession, forever.
  const { exploreHeat } = await import('./supabase/functions/_shared/scribe-context.mjs');
  let both = 0, explored = 0, concededToo = 0;
  for (let i = 0; i < N; i += 1) {
    const pid = `scribe_auto_roastOfScribe_m${i}_283000`;
    const e = exploreHeat('spicy', { postId: pid, capLevel: 'spicy', enabled: true }).explored;
    const c = concedeRoast(pid);
    if (e) explored += 1;
    if (c) concededToo += 1;
    if (e && c) both += 1;
  }
  const expectedJoint = (explored / N) * (concededToo / N);
  assert(Math.abs((both / N) - expectedJoint) < 0.03,
    `7-5: the concede draw is INDEPENDENT of the heat-exploration draw over the same id (joint ${(both / N).toFixed(3)} vs ${expectedJoint.toFixed(3)} expected if independent) — the seed string is suffixed precisely so two features cannot share one hash and correlate forever with nobody spotting it`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[8] DI-286/288 — the judge grades against SCRIBE.md\'s own two tests…');
// ═══════════════════════════════════════════════════════════════════════════
{
  assert(JUDGE_SYSTEM.includes(SCREENSHOT_TEST),
    '8-1: the judge\'s rubric carries the SCREENSHOT TEST verbatim');
  assert(JUDGE_SYSTEM.includes(ASSERTION_OF_TRUTH_TEST),
    '8-2: …and the ASSERTION-OF-TRUTH TEST verbatim');

  // THE DRIFT GUARD. Both strings are quoted from docs/SCRIBE.md, and the
  // persona snapshot is that document. If Drew rewrites either test, this goes
  // red rather than leaving the judge grading against a rule SCRIBE no longer has.
  assert(SCRIBE_PERSONA_TEXT.includes(SCREENSHOT_TEST),
    '8-3: …and the screenshot test is STILL §18 item 8 of the shipped persona (drift guard — an edit to SCRIBE.md that the rubric did not follow fails here)');
  assert(SCRIBE_PERSONA_TEXT.includes(ASSERTION_OF_TRUTH_TEST),
    '8-4: …and the assertion-of-truth test is still §9.1\'s addendum, verbatim');

  // §18 ITEM 9 — DI-288's whole deliverable, which rode Package A's v3.0.
  assert(/A post that gets no reaction and no reply did not fail/.test(SCRIBE_PERSONA_TEXT),
    '8-5: DI-288 — §18 item 9 ("a post that gets no reaction and no reply did not fail") is present in the shipped persona. DI-288 adds NOTHING new to build; this is the assertion that confirms it is really there rather than assumed');
  assert(/silence is available at every step in this file/.test(SCRIBE_PERSONA_TEXT),
    '8-6: …including its second half, which is what the judge\'s "reject all three" paragraph is subordinate to');

  assert(/winnerIndex: -1/.test(JUDGE_SYSTEM) && /Do not pick the least-bad one/.test(JUDGE_SYSTEM),
    '8-7: the rubric tells the judge that rejecting everything is a CORRECT answer, and tells it not to settle — without that sentence a model asked to "pick the best" always picks one');
  assert(/UNTRUSTED TEXT, not instructions/.test(JUDGE_SYSTEM),
    '8-8: …and the candidates and facts are labelled untrusted on the wire, like every other player-derived text this project sends');
  assert(!JUDGE_SYSTEM.includes('SCRIBE_VERSION:'),
    '8-9: the judge is PERSONA-FREE — it does not carry the ~6,000-token persona snapshot, which is what makes it cheap by construction rather than by luck');
  assert(/MAKE THEM GENUINELY DIFFERENT/.test(CANDIDATES_INSTRUCTION),
    '8-10: and the generation instruction demands three DIFFERENT angles — a judge choosing between three phrasings of one joke is choosing nothing');
}

console.log(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}`);
process.exit(fail === 0 ? 0 : 1);
