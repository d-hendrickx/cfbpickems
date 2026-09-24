#!/usr/bin/env node
/**
 * reasonchiptest.mjs — SCRIBE v3, Package B: Feedback v2, proved start to finish.
 * ============================================================================
 * Run:  cd cfb-pickems && node reasonchiptest.mjs
 * (loadtest.mjs spawns it with a ratcheted floor — see its spawned-suites table.)
 *
 * WHY ITS OWN FILE, per CONVENTIONS #28 and the `grouptest.mjs`/`heattest.mjs`
 * precedent: DI-268…271 add four small, closed vocabularies (eleven chips, four
 * families, three valences, four verdicts) and one interaction whose whole point
 * is that it does NOT cost the player a second open/close cycle. That reads as a
 * proof top to bottom; `feedbacktest.mjs` is already 1,800 lines of pilot-era
 * fold and popover coverage and this would be buried in it.
 *
 * COVERS:
 *   [1] DI-268 — the taxonomy: eleven chips, frozen, one family each, copy for
 *       every one of them, no orphan on either side.
 *   [2] DI-268 — `recordFeedbackReasons()`: the allow-list AT THE WRITE
 *       BOUNDARY, the set-not-diff shape, the fold round-trip, toggle on and
 *       back off, and the master switch.
 *   [3] DI-269 — the 280-char `reason_note` clamp beside the unchanged 1000
 *       for everything else, including the prototype-key trap.
 *   [4] DI-270 — the valence map's completeness in BOTH directions and
 *       `reactionValenceCounts()`.
 *   [5] DI-271 — `sanitizeTalkToTrain()` (bad verdict, quote cap, confidence
 *       clamp) and an OBJECT value surviving chat.js's generic fold untouched.
 *   [6] DI-268/269 — what the popover renders: nothing before a rating, both
 *       families + shared tags + the note after Mid/Too much, the positive chip
 *       alone under Hit, `.active` mirroring the rater's own set, and the three
 *       suppressed SCRIBE post kinds.
 *   [7] DI-268 — the INTERACTION, driven through the real popover against a
 *       real element tree: rating with zero chips still rates and dismisses
 *       clean (the one-extra-tap floor), a chip writes immediately, a SECOND
 *       chip still shows as selected even though the fold cannot see it yet,
 *       and the popover survives the repaint its own write causes.
 *
 * NOT HERE: whether any of this changes what SCRIBE says. It does not, by
 * design — Package B captures, Package C acts (DI-268/270's own "what's NOT
 * satisfied by B alone" paragraphs). A test asserting otherwise would be
 * asserting a feature nobody built.
 */

import {
  SCRIBE_FEEDBACK_REASON_CHIPS, SCRIBE_FEEDBACK_CHIP_FAMILY, SCRIBE_FEEDBACK_CHIP_FAMILIES,
  REACTION_PALETTE, REACTION_VALENCE, reactionValenceCounts,
} from './js/data-model.js';
import { REASON_CHIP_COPY, REASON_CHIP_SECTION_COPY } from './js/scribeLines.js';

// ── DOM / browser stubs — same shape as feedbacktest.mjs's ──────────────────
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
globalThis.fetch = async () => { throw new Error('network disabled in reasonchiptest'); };
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
const scribeFeedback = await import('./js/scribeFeedback.js');

const { ingest, getMessage, _resetForTest, onChat } = chat;
const {
  recordFeedback, recordFeedbackReasons, recordTalkToTrain,
  sanitizeTalkToTrain, TALK_TO_TRAIN_VERDICTS, getFeedbackFor,
} = scribeFeedback;

storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true });
storage.addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true });
storage.saveSetting('scribeFeedbackEnabled', true);

const msg = o => ({ gameTag: '', type: 'message', author: 'scribe', body: 'a scribe line', notify: true, ...o });
/** A raw feedback event with EXPLICIT increasing (seq, ts). Required for any
 *  SECOND write to one (author, category) key: `sendEvent()` stamps a local
 *  event {ts:0, seq:0} until the server echoes it, and applyTo() drops a
 *  same-key event that does not beat the current stamp — a pre-existing
 *  property this suite works with rather than around (feedbacktest §[2]'s own
 *  note on the same tie). */
const fbev = (targetId, meta, seq, ts, author = 'p1') =>
  ({ id: `fb_${targetId}_${seq}`, type: 'feedback', targetId, author, notify: false, seq, ts, meta });

// ═══════════════════════════════════════════════════════════════════════════
// [1] THE TAXONOMY — eleven chips, two families that argue opposite ways.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] DI-268 — the closed set, its families, and its copy…');
{
  assert(Object.isFrozen(SCRIBE_FEEDBACK_REASON_CHIPS),
    '1-1: the chip set is FROZEN. It is an allow-list checked at the write boundary, and a list that can be pushed to at runtime is not an allow-list (the REACTION_PALETTE lesson, F3-1)');
  assert(SCRIBE_FEEDBACK_REASON_CHIPS.length === 11,
    `1-2: eleven chips, exactly as DI-268 lists them (got ${SCRIBE_FEEDBACK_REASON_CHIPS.length})`);
  assert(new Set(SCRIBE_FEEDBACK_REASON_CHIPS).size === 11,
    '1-3: …with no duplicate, which would double-count in every family tally Package C runs');
  const EXPECTED = ['annoying', 'too_often', 'tried_too_hard', 'too_long', 'too_mean', 'crossed_a_line',
    'not_funny', 'wrong_target', 'wrong_facts', 'too_soft', 'perfect_more_of_this'];
  assert(JSON.stringify(SCRIBE_FEEDBACK_REASON_CHIPS) === JSON.stringify(EXPECTED),
    `1-4: …and they are Drew's approved ids in DI-268's approved order — the order is also the render order (got ${JSON.stringify(SCRIBE_FEEDBACK_REASON_CHIPS)})`);

  assert(SCRIBE_FEEDBACK_REASON_CHIPS.every(c => SCRIBE_FEEDBACK_CHIP_FAMILY[c]),
    '1-5: every chip has a family. An unfamilied chip is a complaint the Trainer cannot route to a dial');
  assert(Object.keys(SCRIBE_FEEDBACK_CHIP_FAMILY).length === SCRIBE_FEEDBACK_REASON_CHIPS.length,
    '1-6: …and the family map has no key the chip set does not list, which would be a family membership for a chip no player can tap');
  assert(Object.values(SCRIBE_FEEDBACK_CHIP_FAMILY).every(f => SCRIBE_FEEDBACK_CHIP_FAMILIES.includes(f)),
    `1-7: every family is one of the four named ones (got ${JSON.stringify([...new Set(Object.values(SCRIBE_FEEDBACK_CHIP_FAMILY))])})`);

  const fam = f => SCRIBE_FEEDBACK_REASON_CHIPS.filter(c => SCRIBE_FEEDBACK_CHIP_FAMILY[c] === f);
  assert(JSON.stringify(fam('annoying')) === JSON.stringify(['annoying', 'too_often', 'tried_too_hard', 'too_long']),
    `1-8: THE ANNOYING FAMILY is exactly the four "SCRIBE talks too much" complaints. Ruling 7(b): this family argues for FEWER POSTS and must never be answered by lowering heat (got ${JSON.stringify(fam('annoying'))})`);
  assert(JSON.stringify(fam('mean')) === JSON.stringify(['too_mean', 'crossed_a_line']),
    `1-9: THE MEAN FAMILY is exactly the two "that hit too hard" complaints — the opposite correction, LOWER HEAT. Two chips in one bucket is the whole reason a bare rating was not enough (got ${JSON.stringify(fam('mean'))})`);
  assert(fam('annoying').every(c => !fam('mean').includes(c)),
    '1-10: …and the two families are DISJOINT. They are different strings in storage, so no aggregate can accidentally merge "too often" into "too mean"');
  assert(JSON.stringify(fam('positive')) === JSON.stringify(['perfect_more_of_this']),
    '1-11: exactly ONE positive chip — it renders alone under Hit, where there is nothing to disambiguate');

  assert(SCRIBE_FEEDBACK_REASON_CHIPS.every(c => typeof REASON_CHIP_COPY[c] === 'string' && REASON_CHIP_COPY[c].length),
    '1-12: every chip has player-facing copy. A chip with no label renders as a blank button, which is the one failure a closed set exists to prevent');
  assert(Object.keys(REASON_CHIP_COPY).length === SCRIBE_FEEDBACK_REASON_CHIPS.length,
    `1-13: …and the copy table has no orphan label for a chip that no longer exists (got ${Object.keys(REASON_CHIP_COPY).length} labels for ${SCRIBE_FEEDBACK_REASON_CHIPS.length} chips)`);
  assert(SCRIBE_FEEDBACK_REASON_CHIPS.every(c => REASON_CHIP_COPY[c].length <= 16),
    `1-14: …and every label fits a chip on a phone (≤16 chars — the row wraps inside a ~306px popover; the longest is "${SCRIBE_FEEDBACK_REASON_CHIPS.map(c => REASON_CHIP_COPY[c]).sort((a, b) => b.length - a.length)[0]}")`);
  assert(['missPrompt', 'hitPrompt', 'annoyingGroup', 'meanGroup', 'sharedGroup', 'notePlaceholder', 'noteLabel']
    .every(k => typeof REASON_CHIP_SECTION_COPY[k] === 'string' && REASON_CHIP_SECTION_COPY[k].length),
    '1-15: the surrounding copy — both prompts, three headings, the note placeholder and its screen-reader label — is present and non-empty');
  assert(!Object.values(REASON_CHIP_SECTION_COPY).some(v => Object.values(REASON_CHIP_COPY).includes(v)),
    '1-16: no cluster heading repeats a chip\'s own words ("Annoying" is a chip; the heading above it is "Too much SCRIBE"), so one phrase never appears at two meanings in the same popover');
}

// ═══════════════════════════════════════════════════════════════════════════
// [2] recordFeedbackReasons() — the write boundary and the fold.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] DI-268 — the write boundary: allow-list, set-not-diff, fold round-trip…');
{
  _resetForTest();
  ingest([msg({ id: 's1', seq: 1, ts: 1000 })]);
  const res = recordFeedbackReasons({ targetId: 's1', chips: ['too_mean', 'not_funny'], author: 'p1' });
  assert(typeof res === 'string' && res.length > 0,
    '2-1: a reason write returns the event id — it rides the SAME append-only chat log every rating does, no new storage key (AD-16/E2)');
  assert(JSON.stringify(getFeedbackFor('s1').p1?.reason) === JSON.stringify(['too_mean', 'not_funny']),
    `2-2: …and folds under its own 'reason' category as the FULL SET, in tap order (got ${JSON.stringify(getFeedbackFor('s1').p1?.reason)})`);
  assert(getFeedbackFor('s1').p1?.rating === undefined,
    '2-3: …without touching the rating key. Reason and rating are disjoint categories in the fold, structurally, not by convention');

  ingest([fbev('s1', { category: 'reason', value: ['too_mean'] }, 2, 2000)]);
  assert(JSON.stringify(getFeedbackFor('s1').p1.reason) === JSON.stringify(['too_mean']),
    '2-4: TOGGLE OFF — a later set REPLACES the earlier one rather than merging, so un-tapping a chip actually removes it (latest-wins per (author, category), same as a changed rating)');
  ingest([fbev('s1', { category: 'reason', value: [] }, 3, 3000)]);
  assert(Array.isArray(getFeedbackFor('s1').p1.reason) && getFeedbackFor('s1').p1.reason.length === 0,
    '2-5: …and clearing the last chip writes an EMPTY SET, an explicit record of "I took them all back", not silence');

  // Two players, one line, independently.
  recordFeedbackReasons({ targetId: 's1', chips: ['too_long'], author: 'p2' });
  assert(JSON.stringify(getFeedbackFor('s1').p2.reason) === JSON.stringify(['too_long']) &&
         getFeedbackFor('s1').p1.reason.length === 0,
    '2-6: two players\' chip sets on one SCRIBE line coexist — the fold key is (author, category), so nobody overwrites anybody');

  // THE ALLOW-LIST, at the boundary.
  _resetForTest();
  ingest([msg({ id: 's2', seq: 1, ts: 1000 })]);
  recordFeedbackReasons({ targetId: 's2', chips: ['too_mean', 'not_a_real_chip', 'DROP TABLE', '__proto__', 'annoying'], author: 'p1' });
  assert(JSON.stringify(getFeedbackFor('s2').p1.reason) === JSON.stringify(['too_mean', 'annoying']),
    `2-7: AN UNKNOWN CHIP NEVER ENTERS THE LOG. Filtering at the write boundary (CONVENTIONS #7) means no reader downstream — popover, export, Trainer — has to defend against a string somebody invented (got ${JSON.stringify(getFeedbackFor('s2').p1.reason)})`);
  assert(({}).polluted === undefined && Object.prototype.polluted === undefined,
    '2-8: …and a chip literally named "__proto__" pollutes nothing on its way through the filter');

  _resetForTest();
  ingest([msg({ id: 's3', seq: 1, ts: 1000 })]);
  recordFeedbackReasons({ targetId: 's3', chips: ['too_soft', 'too_soft', 'too_soft'], author: 'p1' });
  assert(JSON.stringify(getFeedbackFor('s3').p1.reason) === JSON.stringify(['too_soft']),
    '2-9: duplicates collapse — a double-fired tap cannot make one complaint count twice in a family tally');
  for (const junk of [null, undefined, 'too_mean', 42, { 0: 'too_mean' }]) {
    const id = recordFeedbackReasons({ targetId: 's3', chips: junk, author: 'p1' });
    assert(typeof id === 'string',
      `2-10: a non-array \`chips\` (${JSON.stringify(junk)}) writes an EMPTY set rather than throwing or writing the raw value — a render path reads this back and must never meet a string where it expects a list`);
  }
  assert(!recordFeedbackReasons({ targetId: '', chips: ['annoying'], author: 'p1' }) &&
         !recordFeedbackReasons({ targetId: 's3', chips: ['annoying'], author: '' }),
    '2-11: no target or no author ⇒ no write at all. An unattributable complaint is not data');

  // THE MASTER SWITCH GATES THE WRITE, NOT JUST THE UI.
  storage.saveSetting('scribeFeedbackEnabled', false);
  const off1 = recordFeedbackReasons({ targetId: 's3', chips: ['annoying'], author: 'p2' });
  const off2 = recordFeedback({ targetId: 's3', category: 'reason_note', value: 'because', author: 'p2' });
  const off3 = recordTalkToTrain({ targetId: 's3', author: 'p2', value: { verdict: 'hit', quote: 'nice', confidence: 1 } });
  assert(off1?.ok === false && off1.reason === 'disabled',
    '2-12: with the commissioner\'s switch OFF, a reason write is refused at the seam — the switch means "no new instrumentation is CAPTURED", not "none is offered" (the reviewer\'s 2026-09-10 ruling, extended to all three new categories)');
  assert(off2?.ok === false && off3?.ok === false,
    '2-13: …and the free-text note and the talk-to-train write are refused by the same gate, for the same reason');
  assert(getFeedbackFor('s3').p2 === undefined,
    '2-14: …and nothing at all reached the fold while it was off');
  storage.saveSetting('scribeFeedbackEnabled', true);
}

// ═══════════════════════════════════════════════════════════════════════════
// [3] DI-269 — the per-category clamp.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] DI-269 — reason_note caps at 280; everything else still caps at 1000…');
{
  _resetForTest();
  ingest([msg({ id: 'n1', seq: 1, ts: 1000 })]);
  recordFeedback({ targetId: 'n1', category: 'reason_note', value: 'x'.repeat(5000), author: 'p1' });
  assert(getFeedbackFor('n1').p1.reason_note.length === 280,
    `3-1: a 5000-char note is clamped to 280 AT THE BOUNDARY, not only by the input's maxlength — recordFeedback() is a real API surface and a programmatic caller must not be able to write an unbounded string into the append-only log (got ${getFeedbackFor('n1').p1.reason_note.length})`);
  recordFeedback({ targetId: 'n1', category: 'rewrite', value: 'y'.repeat(5000), author: 'p1' });
  assert(getFeedbackFor('n1').p1.rewrite.length === 1000,
    `3-2: …while the rewrite's own 1000 is UNCHANGED. A rewrite is a proposed SCRIBE line; a note is a quick "why". Two ceilings, one function (got ${getFeedbackFor('n1').p1.rewrite.length})`);
  recordFeedback({ targetId: 'n1', category: 'weigh_in', value: 'z'.repeat(1500), author: 'p2' });
  assert(getFeedbackFor('n1').p2.weigh_in.length === 1000,
    '3-3: …and every other string category keeps 1000 too — the table adds a ceiling, it does not redefine the default');
  recordFeedback({ targetId: 'n1', category: 'reason_note', value: 'short and true', author: 'p2' });
  assert(getFeedbackFor('n1').p2.reason_note === 'short and true',
    '3-4: a note under the cap round-trips byte-for-byte — the clamp is a ceiling, not a transform');

  // THE PROTOTYPE TRAP in the lookup table itself.
  _resetForTest();
  ingest([msg({ id: 'n2', seq: 1, ts: 1000 })]);
  recordFeedback({ targetId: 'n2', category: 'constructor', value: 'a'.repeat(50), author: 'p1' });
  assert(getFeedbackFor('n2').p1 === undefined,
    '3-5: a category named "constructor" is refused by chat.js\'s fold guard (it never becomes an object key) — and on the way there the clamp table answered 1000 rather than a FUNCTION, which `value.slice(0, fn)` would have silently turned into the empty string. Null-prototype table, checked here because the damage would be invisible downstream');
}

// ═══════════════════════════════════════════════════════════════════════════
// [4] DI-270 — reaction valence.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] DI-270 — every palette emoji has a valence, and the counts add up…');
{
  const missing = REACTION_PALETTE.filter(e => !REACTION_VALENCE[e]);
  assert(missing.length === 0,
    `4-1: EVERY one of the 18 palette emoji is mapped. A half-covered map reads as "neutral" for its gaps and drags every tally toward zero without ever failing (missing: ${JSON.stringify(missing)})`);
  const extra = Object.keys(REACTION_VALENCE).filter(e => !REACTION_PALETTE.includes(e));
  assert(extra.length === 0,
    `4-2: …and nothing is mapped that is NOT in the palette — chat.js's react fold refuses those, so a valence for one would be a rule about an impossible tap (extra: ${JSON.stringify(extra)})`);
  assert(Object.keys(REACTION_VALENCE).length === 18 && REACTION_PALETTE.length === 18,
    `4-3: both lists are still 18 long (map ${Object.keys(REACTION_VALENCE).length}, palette ${REACTION_PALETTE.length})`);
  assert(Object.isFrozen(REACTION_VALENCE), '4-4: the map is frozen — it is a fixed reading of the palette, not runtime state');
  assert(Object.values(REACTION_VALENCE).every(v => ['positive', 'negative', 'neutral'].includes(v)),
    '4-5: every valence is one of the three buckets');

  assert(REACTION_VALENCE['👍'] === 'positive' && REACTION_VALENCE['🔥'] === 'positive' && REACTION_VALENCE['😂'] === 'positive',
    '4-6: 👍 🔥 😂 are positive');
  assert(['👎', '😬', '🖕'].every(e => REACTION_VALENCE[e] === 'negative'),
    '4-7: 👎 😬 🖕 are the three negatives — exactly DI-270\'s list, no more (🖕 on a roast is objection, and reading it as applause is how a training loop learns to keep doing the thing that drew it)');
  assert(['💀', '😭', '😅', '🤡', '👀', '☝️'].every(e => REACTION_VALENCE[e] === 'neutral'),
    '4-8: 💀 😭 😅 🤡 👀 ☝️ ARE NEUTRAL, ON PURPOSE. "That killed me" and "that actually stung" are the same two emoji, and a roast is the one situation where the two readings cannot be told apart — an ambiguous tap scored as approval is worse than one scored as nothing');
  assert(Object.values(REACTION_VALENCE).filter(v => v === 'positive').length === 9,
    `4-9: nine positives, six neutrals, three negatives — the split DI-270 lists (got ${Object.values(REACTION_VALENCE).filter(v => v === 'positive').length} positive)`);

  const counts = reactionValenceCounts({ '🔥': ['p1', 'p2'], '👎': ['p3'], '💀': ['p4', 'p5', 'p6'] });
  assert(counts.positive === 2 && counts.negative === 1 && counts.neutral === 3,
    `4-10: reactionValenceCounts() counts AUTHORS, not emoji — three people typing 💀 is three neutral signals, not one (got ${JSON.stringify(counts)})`);
  const empty = reactionValenceCounts({});
  assert(empty.positive === 0 && empty.negative === 0 && empty.neutral === 0,
    '4-11: no reactions ⇒ three zeroes, never undefined — a caller can add these up without an existence check');
  assert(JSON.stringify(reactionValenceCounts(null)) === JSON.stringify(reactionValenceCounts(undefined)) &&
         reactionValenceCounts(null).neutral === 0,
    '4-12: …and a missing `reactions` object answers the same way rather than throwing. Every message carries `reactions`, but this is an exported pure function and a Trainer can point it at a raw row');
  // `__proto__` as a COMPUTED key — a plain literal key of that name sets the
  // prototype instead of creating an own property, which would make this
  // fixture quietly test nothing.
  const junk = reactionValenceCounts({ '🦄': ['p1'], ['__proto__']: ['p2'], '🔥': 'not-an-array' });
  assert(junk.neutral === 2 && junk.positive === 0 && junk.negative === 0,
    `4-13: an UNKNOWN emoji counts as neutral rather than vanishing (so the buckets still sum to the real number of taps), "__proto__" does not mint a fourth NaN-valued bucket, and a malformed author list contributes zero (got ${JSON.stringify(junk)})`);
  assert(({}).positive === undefined,
    '4-14: …and Object.prototype is untouched by that lookup');

  // Over a REAL folded message, since that is the shape Package C will read.
  _resetForTest();
  ingest([
    msg({ id: 'r1', seq: 1, ts: 1000 }),
    { id: 'rx1', type: 'react', targetId: 'r1', author: 'p1', seq: 2, ts: 2000, meta: { emoji: '🔥' }, notify: false },
    { id: 'rx2', type: 'react', targetId: 'r1', author: 'p2', seq: 3, ts: 3000, meta: { emoji: '👎' }, notify: false },
  ]);
  const real = reactionValenceCounts(getMessage('r1').reactions);
  assert(real.positive === 1 && real.negative === 1,
    `4-15: over a REALLY folded SCRIBE post's \`reactions\`, with no new storage and no new fold — the taps were already there; DI-270's whole delta is that somebody can now ask what they add up to (got ${JSON.stringify(real)})`);
}

// ═══════════════════════════════════════════════════════════════════════════
// [5] DI-271 — talk-to-train: the shape, the sanitizer, the generic fold.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] DI-271 — the talk-to-train event shape (capture path only; C/D wires the classifier)…');
{
  assert(JSON.stringify(TALK_TO_TRAIN_VERDICTS) === JSON.stringify(['hit', 'mid', 'too_much', 'unclear']),
    `5-1: four verdicts, and 'unclear' is one of them — "they said something and we could not tell what" is information, and the honest landing place for anything malformed (got ${JSON.stringify(TALK_TO_TRAIN_VERDICTS)})`);
  for (const bad of ['HIT', 'great', '', null, undefined, 0, {}, ['hit']]) {
    assert(sanitizeTalkToTrain({ verdict: bad }).verdict === 'unclear',
      `5-2: a verdict outside the closed set (${JSON.stringify(bad)}) becomes 'unclear', never the raw value — a classifier is a model and models answer off-menu`);
  }
  for (const v of ['hit', 'mid', 'too_much', 'unclear']) {
    assert(sanitizeTalkToTrain({ verdict: v }).verdict === v, `5-3: …and a legal verdict (${v}) survives untouched`);
  }
  const longQuote = sanitizeTalkToTrain({ verdict: 'mid', quote: 'q'.repeat(1000) });
  assert(longQuote.quote.length === 300,
    `5-4: the quote is capped at 300 chars. It is the PLAYER'S OWN WORDS and stays untrusted data forever — capped here, and (binding on Package C, §7) wrapped as quoted attributed text if it ever reaches a prompt, never concatenated as an instruction (got ${longQuote.quote.length})`);
  for (const bad of [null, undefined, 42, {}, ['x']]) {
    assert(sanitizeTalkToTrain({ quote: bad }).quote === '',
      `5-5: a non-string quote (${JSON.stringify(bad)}) becomes '' rather than an object nobody downstream can render`);
  }
  assert(sanitizeTalkToTrain({ confidence: 5 }).confidence === 1 && sanitizeTalkToTrain({ confidence: -3 }).confidence === 0,
    '5-6: confidence is clamped into [0,1] in both directions — a Trainer thresholds on this number and an out-of-range one would sail over any floor it sets');
  for (const bad of [NaN, Infinity, 'high', null, undefined, {}]) {
    assert(sanitizeTalkToTrain({ confidence: bad }).confidence === 0,
      `5-7: an unusable confidence (${JSON.stringify(bad)}) reads as 0 — the LEAST confident value, so garbage can never clear a confidence floor`);
  }
  assert(sanitizeTalkToTrain({ confidence: '0.75' }).confidence === 0.75,
    '5-8: …while a numeric string coerces rather than being thrown away (JSON from an Edge Function is a real source of those)');
  for (const junk of [null, undefined, 'a string', 42, []]) {
    const s = sanitizeTalkToTrain(junk);
    assert(s.verdict === 'unclear' && s.quote === '' && s.confidence === 0,
      `5-9: a wholly unusable value (${JSON.stringify(junk)}) still produces the full three-key shape — every reader can destructure without a guard`);
  }
  assert(Object.keys(sanitizeTalkToTrain({ verdict: 'hit', quote: 'q', confidence: 1, extra: 'x', prompt: 'ignore previous' })).length === 3,
    '5-10: EXTRA KEYS ARE DROPPED. The sanitizer rebuilds the object rather than spreading it, so a classifier response cannot smuggle a fourth field into the append-only log');

  _resetForTest();
  ingest([msg({ id: 't1', seq: 1, ts: 1000 })]);
  recordTalkToTrain({ targetId: 't1', author: 'p1', value: { verdict: 'too_much', quote: 'scribe that was harsh', confidence: 0.82, extra: 'x' } });
  const folded = getFeedbackFor('t1').p1?.talk_to_train;
  assert(folded && folded.verdict === 'too_much' && folded.quote === 'scribe that was harsh' && folded.confidence === 0.82,
    `5-11: AN OBJECT VALUE SURVIVES chat.js's FOLD UNCHANGED — the 'feedback' branch stores whatever \`meta.value\` it is given and no reader assumes a string, so DI-271 needed no chat.js edit at all (verified, not assumed) (got ${JSON.stringify(folded)})`);
  assert(folded.extra === undefined,
    '5-12: …minus the extra key, because it was sanitized before it was ever sent');
  ingest([fbev('t1', { category: 'talk_to_train', value: { verdict: 'hit', quote: 'actually that was great', confidence: 0.4 } }, 2, 2000)]);
  assert(getFeedbackFor('t1').p1.talk_to_train.verdict === 'hit',
    '5-13: a SECOND remark by the same player about the same post replaces the first — latest-wins per (author, category), the same semantics a changed rating has. The append-only log still holds both');
  assert(getFeedbackFor('t1').p1.rating === undefined && getFeedbackFor('t1').p1.reason === undefined,
    '5-14: …and it collides with nothing else: talk_to_train is its own category beside rating, reason and reason_note');
}

// ═══════════════════════════════════════════════════════════════════════════
// [6] THE POPOVER'S SECOND ROW — what renders, and when.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] DI-268/269 — progressive disclosure in the popover render…');
{
  const popover = (id, self = 'p1') => chatUi._feedbackPopoverHTMLForTest(getMessage(id), self);
  _resetForTest();
  ingest([
    msg({ id: 'v1', seq: 1, ts: 1000 }),
    msg({ id: 'v2', seq: 2, ts: 2000 }),
    msg({ id: 'v3', seq: 3, ts: 3000 }),
    msg({ id: 'vnews', seq: 4, ts: 4000, meta: { kind: 'whatsNew' } }),
    msg({ id: 'vwager', seq: 5, ts: 5000, meta: { kind: 'wagerLogged' } }),
    msg({ id: 'vdue', seq: 6, ts: 6000, meta: { kind: 'wagerDue' } }),
    { ...msg({ id: 'vhuman', seq: 7, ts: 7000 }), author: 'p2', body: 'a human line' },
  ]);

  const unrated = popover('v1');
  assert(!/data-fb-chip/.test(unrated) && !/data-fb-note/.test(unrated),
    '6-1: BEFORE A RATING there are no chips and no note — the 2×2 grid is byte-for-byte the control that shipped, so a player who only wants to rate still spends exactly one tap');
  assert((unrated.match(/feedback-pick-option/g) || []).length === 4,
    '6-2: …and still exactly four options in it');

  ingest([fbev('v1', { category: 'rating', value: 'mid' }, 10, 10000)]);
  const mid = popover('v1');
  assert(/data-fb-chip="annoying"/.test(mid) && /data-fb-chip="too_often"/.test(mid) &&
         /data-fb-chip="tried_too_hard"/.test(mid) && /data-fb-chip="too_long"/.test(mid),
    '6-3: A MID RATING REVEALS THE CHIPS IN THE SAME POPOVER — the whole annoying family, no second open/close cycle');
  assert(/data-fb-chip="too_mean"/.test(mid) && /data-fb-chip="crossed_a_line"/.test(mid),
    '6-4: …and the mean family');
  assert(['not_funny', 'wrong_target', 'wrong_facts', 'too_soft'].every(c => mid.includes(`data-fb-chip="${c}"`)),
    '6-5: …and the four shared diagnostics');
  assert(mid.indexOf('data-fb-chip="annoying"') < mid.indexOf('data-fb-chip="too_mean"') &&
         mid.indexOf('data-fb-chip="too_mean"') < mid.indexOf('data-fb-chip="not_funny"'),
    '6-6: …in DI-268\'s order: annoying family, then mean family, then shared. The two families are visually separate because they argue for OPPOSITE corrections');
  assert(mid.includes(REASON_CHIP_SECTION_COPY.annoyingGroup) && mid.includes(REASON_CHIP_SECTION_COPY.meanGroup) &&
         mid.includes(REASON_CHIP_SECTION_COPY.sharedGroup) && mid.includes(REASON_CHIP_SECTION_COPY.missPrompt),
    '6-7: …under their two approved cluster headings and the "What kind of miss?" prompt — imported from scribeLines.js, never retyped at the render site');
  assert(!/data-fb-chip="perfect_more_of_this"/.test(mid),
    '6-8: the POSITIVE chip is absent under Mid — "more of this" is not a kind of miss');
  assert(/data-fb-note="1"/.test(mid) && /maxlength="280"/.test(mid),
    '6-9: DI-269\'s optional free-text "why" sits in the same revealed state, capped at 280 by the input as well as at the boundary');
  assert(/<input[^>]*class="feedback-note-input"/.test(mid) && !/<textarea/.test(mid),
    '6-10: …as a single-line <input>, not the rewrite\'s <textarea> — this is a quick why, and the two are different asks');

  ingest([fbev('v1', { category: 'rating', value: 'too_much' }, 11, 11000)]);
  assert(/data-fb-chip="too_mean"/.test(popover('v1')) && /data-fb-note="1"/.test(popover('v1')),
    '6-11: Too much reveals the same row — the two miss ratings ask the same question');

  ingest([fbev('v2', { category: 'rating', value: 'hit' }, 12, 12000)]);
  const hit = popover('v2');
  assert(/data-fb-chip="perfect_more_of_this"/.test(hit),
    '6-12: A HIT REVEALS THE POSITIVE CHIP…');
  assert((hit.match(/data-fb-chip=/g) || []).length === 1,
    `6-13: …ALONE. No cluster, no miss chips — there is nothing to disambiguate when the line landed (got ${(hit.match(/data-fb-chip=/g) || []).length} chips)`);
  assert(hit.includes(REASON_CHIP_SECTION_COPY.hitPrompt) && !hit.includes(REASON_CHIP_SECTION_COPY.missPrompt),
    '6-14: …under "What worked?", not "What kind of miss?"');
  assert(/data-fb-note="1"/.test(hit),
    '6-15: …and the note is offered here too — UN-246 is "why it landed OR didn\'t", both directions');

  // .active mirrors the RATER'S OWN set.
  ingest([fbev('v3', { category: 'rating', value: 'mid' }, 13, 13000)]);
  ingest([fbev('v3', { category: 'reason', value: ['too_often', 'wrong_facts'] }, 14, 14000)]);
  const own = popover('v3');
  assert(/class="feedback-chip active" data-fb-chip="too_often"/.test(own) &&
         /class="feedback-chip active" data-fb-chip="wrong_facts"/.test(own),
    '6-16: .active MIRRORS `mine.reason` — a player reopening the popover sees what they already said, the same mechanism the rewrite button\'s filled state uses');
  assert(/class="feedback-chip" data-fb-chip="annoying"/.test(own) && /class="feedback-chip" data-fb-chip="too_mean"/.test(own),
    '6-17: …and only that. An unselected chip carries no active class');
  assert(/data-fb-chip="too_often" aria-pressed="true"/.test(own) && /data-fb-chip="annoying" aria-pressed="false"/.test(own),
    '6-18: …with aria-pressed tracking it, so the state is not colour-only');
  assert(!/feedback-chip active/.test(popover('v3', 'p2')),
    '6-19: A DIFFERENT VIEWER sees none of it marked. The blind rule for feedback: this popover only ever reads [self], never another player\'s row');

  // Stored garbage never reaches the render.
  ingest([fbev('v3', { category: 'reason', value: ['too_often', 'made_up_chip', '<img src=x onerror=1>'] }, 15, 15000)]);
  const dirty = popover('v3');
  assert(!/made_up_chip/.test(dirty) && !/onerror/.test(dirty),
    '6-20: a chip id that is not in the closed set is filtered at the READ boundary too, so a hostile append (the log is shared) renders nothing at all');
  ingest([fbev('v3', { category: 'reason', value: 'too_often' }, 16, 16000)]);
  assert(/data-fb-chip="too_often"/.test(popover('v3')) && !/feedback-chip active/.test(popover('v3')),
    '6-21: …and a STRING where the set should be renders an empty selection rather than throwing inside the template');

  // The free text is escaped.
  ingest([fbev('v3', { category: 'reason_note', value: '"><script>alert(1)</script>' }, 17, 17000)]);
  const noteHtml = popover('v3');
  assert(!/<script>/.test(noteHtml) && /&lt;script&gt;/.test(noteHtml) && /value="&quot;&gt;/.test(noteHtml),
    '6-22: the player\'s own note is escaped into the value attribute — CONVENTIONS #12, every time, including the attribute that closes with a quote');

  // SUPPRESSION — the three SCRIBE post kinds that are mechanisms, not lines.
  for (const [id, kind] of [['vnews', 'whatsNew'], ['vwager', 'wagerLogged'], ['vdue', 'wagerDue']]) {
    ingest([fbev(id, { category: 'rating', value: 'mid' }, 20 + id.length, 20000 + id.length)]);
    const html = popover(id);
    assert(!/data-fb-chip/.test(html) && !/data-fb-note/.test(html),
      `6-23 (${kind}): a ${kind} post takes NO chips and NO note even when a rating exists on it. A changelog and a wager receipt are SCRIBE-authored MECHANISMS, not SCRIBE lines — the ⭐ already refuses them, and honouring the rule in one of the places that render the feature and not the others is exactly the failure shape the two existing suppressions warn about`);
    assert(/feedback-pick-option/.test(html),
      `6-23b (${kind}): …while the rating grid itself is unchanged — the suppression is scoped to the new row`);
  }

  const human = popover('vhuman');
  assert(!/data-fb-chip/.test(human) && /data-fb-remember="1"/.test(human),
    '6-24: the HUMAN-message popover (📌 Remember this · 👁 Weigh in) is untouched — reason chips are about SCRIBE\'s voice and a human message has none');
}

// ═══════════════════════════════════════════════════════════════════════════
// [7] THE INTERACTION — driven through the real popover, on a real element tree.
//
// A render-only test cannot see the property the design input actually
// protects: that rating STILL costs one tap, that the chips arrive without a
// second open/close, and that the popover survives the repaint its own write
// causes. Those are facts about the DOM and about call ordering, so this
// section runs the real toggleFeedbackPicker()/bindMessageActionButtons()
// against a small element tree — the same method feedbacktest [28c] uses,
// widened so `innerHTML` actually yields clickable children.
// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] DI-268 — the interaction: one-tap rating, in-place chips, survives its own repaint…');
{
  const byId = new Map();
  function purge(el) { if (el.id) byId.delete(el.id); el.children.forEach(purge); }
  function mkEl(tag, className = '', data = {}) {
    let _id = '', _html = '';
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(), className, dataset: { ...data }, style: {},
      children: [], parentNode: null, value: '',
      classList: {
        add(c) { if (!el.className.split(/\s+/).includes(c)) el.className = `${el.className} ${c}`.trim(); },
        remove(c) { el.className = el.className.split(/\s+/).filter(x => x && x !== c).join(' '); },
        contains(c) { return el.className.split(/\s+/).includes(c); },
      },
      get id() { return _id; },
      set id(v) { if (_id) byId.delete(_id); _id = v; if (v) byId.set(v, el); },
      get innerHTML() { return _html; },
      set innerHTML(v) {
        el.children.forEach(purge);
        el.children = [];
        _html = String(v);
        // Enough of a parser for the popover's own markup: every <button>,
        // <input> and <textarea> becomes a real child carrying its class, its
        // id, its data-* attrs and its value, which is all any selector in
        // chat-ui.js asks about. (<textarea> and id support arrived with R-5,
        // 2026-09-23: the ✏️ Rewrite path now flushes the note before handing
        // over to openFeedbackTextModal(), and that modal binds #fb-modal-text
        // unconditionally — a harness that cannot build it would have the flush
        // "pass" against a handler that threw halfway through.)
        for (const tagMatch of _html.matchAll(/<(button|input|textarea)\b([^>]*)>/g)) {
          const attrs = tagMatch[2];
          const child = mkEl(tagMatch[1]);
          const cls = /class="([^"]*)"/.exec(attrs);
          if (cls) child.className = cls[1];
          const idAttr = /\sid="([^"]*)"/.exec(attrs);
          if (idAttr) child.id = idAttr[1];
          for (const a of attrs.matchAll(/data-([\w-]+)="([^"]*)"/g)) {
            child.dataset[a[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = a[2];
          }
          const val = /\svalue="([^"]*)"/.exec(attrs);
          if (val) child.value = val[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
          el.appendChild(child);
        }
      },
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      remove() {
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(x => x !== el);
        el.parentNode = null;
        purge(el);
      },
      contains(n) { for (let c = n; c; c = c.parentNode) if (c === el) return true; return false; },
      closest(sel) {
        const toks = String(sel).split(',').map(s => s.trim()).filter(Boolean);
        for (let n = el; n; n = n.parentNode) if (toks.some(t => matchesSel(n, t))) return n;
        return null;
      },
      querySelectorAll(sel) {
        const toks = String(sel).split(',').map(s => s.trim()).filter(Boolean);
        const out = [];
        (function walk(n) { n.children.forEach(c => { if (toks.some(t => matchesSel(c, t))) out.push(c); walk(c); }); })(el);
        return out;
      },
      querySelector(sel) { return el.querySelectorAll(sel)[0] || null; },
      addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
      removeEventListener(type, fn) { listeners.set(type, (listeners.get(type) || []).filter(f => f !== fn)); },
      _fire(type, ev) { (listeners.get(type) || []).slice().forEach(fn => fn(ev)); },
    };
    return el;
  }
  function matchesSel(node, tok) {
    const attr = /\[data-([\w-]+)(?:="([^"]*)")?\]/.exec(tok);
    if (attr) {
      const key = attr[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const have = node.dataset?.[key];
      if (have === undefined) return false;
      if (attr[2] !== undefined && have !== attr[2]) return false;
      tok = tok.slice(0, attr.index);
    }
    if (!tok) return true;
    if (tok.startsWith('.')) return String(node.className || '').split(/\s+/).includes(tok.slice(1));
    if (tok.startsWith('#')) return node.id === tok.slice(1);
    return node.tagName === tok.toUpperCase();
  }

  const docListeners = new Map();
  const realDoc = globalThis.document;
  globalThis.document = {
    addEventListener(t, fn) { if (!docListeners.has(t)) docListeners.set(t, []); docListeners.get(t).push(fn); },
    removeEventListener(t, fn) { docListeners.set(t, (docListeners.get(t) || []).filter(f => f !== fn)); },
    getElementById: id => byId.get(id) || null,
    querySelector: () => null, querySelectorAll: () => [],
    createElement: tag => mkEl(tag),
    body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
    hidden: false,
  };
  const clickOutside = target => (docListeners.get('click') || []).slice().forEach(fn => fn({ target }));
  const clickEv = el => ({ stopPropagation() {}, target: el });
  // mountFeedbackPicker() arms its outside-click closer in a setTimeout(…, 0),
  // deliberately (so the click that OPENED the popover cannot immediately close
  // it). Every open below therefore has to let a macrotask run before the
  // document is clicked, exactly as a human's second tap does.
  const settle = () => new Promise(r => setTimeout(r, 0));
  // F-3(a), 2026-09-23 — chip taps coalesce behind a 400ms trailing debounce
  // (chat-ui.js's CHIP_WRITE_DEBOUNCE_MS). Waiting it out is the only honest way
  // to observe the write, so this waits slightly longer than the real timer.
  const debounced = () => new Promise(r => setTimeout(r, 480));
  /** The EVENTS this device actually put on the wire for one message/category.
   *  The outbox, not the fold: a local event is stamped {ts:0,seq:0} and
   *  applyTo() drops a second write to a key that already holds one, so the
   *  fold cannot count rows (the property 7-22 already leans on). */
  const feedbackRows = (targetMid, category) => JSON.parse(store.get('cfbp_chat_outbox2') || '[]')
    .filter(e => e.type === 'feedback' && e.targetId === targetMid && e.meta?.category === category);
  const reasonRows = targetMid => feedbackRows(targetMid, 'reason');

  try {
    _resetForTest();
    ingest([msg({ id: 'ix', seq: 1, ts: 1000 })]);
    storage.setSession('p1', false, true);
    storage.saveSetting('scribeFeedbackEnabled', true);

    // The host, rebuilt from scratch on every "repaint" — exactly what
    // renderChatPage()'s innerHTML swap does to the real one.
    let root = null, repaints = 0;
    const repaint = () => {
      repaints += 1;
      if (root) root.remove();
      root = mkEl('div', 'chat-scroll');
      const m = root.appendChild(mkEl('div', 'chat-msg', { mid: 'ix' }));
      const col = m.appendChild(mkEl('div', 'chat-bubble-col'));
      const reactions = col.appendChild(mkEl('div', 'chat-reactions'));
      reactions.appendChild(mkEl('button', 'chat-fb-star is-unrated', { fbOpen: 'ix' }));
      const actions = col.appendChild(mkEl('div', 'chat-actions'));
      actions.appendChild(mkEl('button', 'chat-act chat-act-feedback', { fbOpen: 'ix' }));
      chatUi._bindMessageActionButtons(root, repaint, 'main');
      return root;
    };
    const star = () => root.querySelector('.chat-fb-star');
    const picker = () => byId.get('chat-feedback-picker') || null;
    const chipBtn = chip => picker()?.querySelector(`[data-fb-chip="${chip}"]`) || null;

    repaint();
    star()._fire('click', clickEv(star()));
    assert(!!picker() && picker().parentNode?.className.includes('chat-reactions'),
      '7-1: fixture — tapping the ⭐ opens the popover on the row, through the real binder and the real toggle');
    assert(picker().querySelectorAll('[data-fb-chip]').length === 0,
      '7-2: …with NO chips yet. The first tap is still just a rating control');

    // ── The rating tap: records, and REVEALS rather than closing.
    picker().querySelector('[data-fb-rating="mid"]')._fire('click', clickEv(null));
    assert(getFeedbackFor('ix').p1?.rating === 'mid',
      '7-3: the rating is recorded on the tap, exactly as before — nothing about the write changed');
    assert(!!picker(),
      '7-4: AND THE POPOVER IS STILL OPEN — through a full repaint, which is what a write causes in this app. This is DI-268\'s "the SAME popover reveals the chip row, no extra open/close cycle", proven against the DOM rather than the template');
    assert(picker().querySelectorAll('[data-fb-chip]').length === 10,
      `7-5: …now showing the ten miss chips (got ${picker().querySelectorAll('[data-fb-chip]').length})`);
    assert(repaints >= 2,
      `7-6: fixture — a repaint really did happen between the tap and that assertion (${repaints} so far), so 7-4 is not passing because nothing moved`);
    assert(getFeedbackFor('ix').p1?.reason === undefined,
      '7-7: THE CHIP STEP IS OPTIONAL — revealing it writes nothing at all. A player who stops here has spent one tap and left one rating');

    // ── Dismiss with zero chips: the one-extra-tap floor.
    await settle();
    clickOutside(mkEl('div', 'somewhere-else'));
    assert(!picker(),
      '7-8: tapping outside dismisses it, unchanged');
    assert(getFeedbackFor('ix').p1.rating === 'mid' && getFeedbackFor('ix').p1.reason === undefined &&
           getFeedbackFor('ix').p1.reason_note === undefined,
      '7-9: …leaving JUST the rating on file — no empty chip set, no empty note. The regression guard for "rating stays one tap"');
    assert(chatUi._openFeedbackPickerStateForTest() === null,
      '7-10: …and the re-mount marker is disarmed, so the next unrelated repaint cannot resurrect it');
    repaint();
    assert(!picker(), '7-11: …proven by repainting again with nothing open — no popover comes back');

    // ── Chips write immediately, and the popover survives each write.
    star()._fire('click', clickEv(star()));
    assert(picker().querySelectorAll('[data-fb-chip]').length === 10,
      '7-12: REOPENING a rated line goes straight to the chips — the rating is already on file, so the second row is its normal state, not a special case');
    chipBtn('too_often')._fire('click', clickEv(null));
    assert(reasonRows('ix').length === 0,
      '7-13: a chip tap NO LONGER writes on the tap (F-3, 2026-09-23) — it arms a 400ms trailing coalesce, so a burst of taps cannot put one row per tap into the append-only log');
    await debounced();
    assert(JSON.stringify(getFeedbackFor('ix').p1.reason) === JSON.stringify(['too_often']),
      '7-13b: …and when the window closes the set is written, with no Save button ever shown — the design input\'s floor is one extra tap, and a confirm step would make it two for every chip');
    assert(!!picker(),
      '7-14: …and the popover is still open for the next one');
    assert(chipBtn('too_often').className.includes('active'),
      '7-15: …with the tapped chip showing as selected');

    chipBtn('wrong_facts')._fire('click', clickEv(null));
    assert(chipBtn('too_often').className.includes('active') && chipBtn('wrong_facts').className.includes('active'),
      '7-16: A SECOND CHIP ALSO SHOWS AS SELECTED — and this is the assertion the design nearly failed on: a local write is stamped {ts:0,seq:0} until the server echoes it, so the fold IGNORES this second write to the same (author,"reason") key. Reading `.active` from the fold alone would have shown the player their tap doing nothing');
    assert(chipBtn('annoying') && !chipBtn('annoying').className.includes('active'),
      '7-17: …while an untapped chip in the same family stays unselected');
    chipBtn('too_often')._fire('click', clickEv(null));
    assert(!chipBtn('too_often').className.includes('active') && chipBtn('wrong_facts').className.includes('active'),
      '7-18: TOGGLE OFF — re-tapping a selected chip removes it from the set and leaves the others alone');

    // ── The note: written on dismissal, at most once.
    const note = picker().querySelector('[data-fb-note]');
    assert(!!note && note.dataset.fbNote === '1', '7-19: fixture — the free-text field is present in the revealed state');
    note.value = 'it keeps bringing up the same game';
    await settle();
    clickOutside(mkEl('div', 'somewhere-else'));
    assert(getFeedbackFor('ix').p1.reason_note === 'it keeps bringing up the same game',
      '7-20: DI-269 — text typed and then dismissed is still saved. The closer flushes it, so a player who types and taps away does not lose the one thing they bothered to write');
    assert(!picker() && chatUi._openFeedbackPickerStateForTest() === null,
      '7-21: …and that flush does not resurrect the popover it just closed (the write repaints; the marker is disarmed FIRST, deliberately)');
    assert(JSON.stringify(reasonRows('ix').slice(-1)[0]?.meta?.value) === JSON.stringify(['wrong_facts']),
      `7-21b: …and the SAME dismissal flushed the chip set that was still inside its debounce window — a tap 399ms before the popover closes is a tap, not a draft (F-3) (got ${JSON.stringify(reasonRows('ix').slice(-1)[0]?.meta?.value)})`);

    // ── Clearing the rating closes, as it always has.
    //
    // ASSERTED ON THE OUTBOX, NOT ON THE FOLD, and that is not a dodge: a local
    // event is stamped {ts:0, seq:0} until the server echoes it, so this clear
    // TIES with the rating already sitting on the same key and applyTo() drops
    // it — the pre-existing property feedbacktest §[2] documents at length. What
    // the tap must do is SEND the explicit clear, and the outbox is where a sent
    // event lives until the transport takes it.
    star()._fire('click', clickEv(star()));
    picker().querySelector('[data-fb-rating="mid"]')._fire('click', clickEv(null));
    const outbox = JSON.parse(store.get('cfbp_chat_outbox2') || '[]');
    assert(outbox.some(e => e.type === 'feedback' && e.targetId === 'ix' && e.meta?.category === 'rating' && e.meta?.value === null),
      '7-22: re-tapping the current rating sends an EXPLICIT clear (value: null) — silence would leave the clear out of the reconstructible record');
    assert(!picker(),
      '7-23: …and THAT closes the popover — a cleared rating has nothing left to explain');

    // ── The other surface cannot steal it.
    star()._fire('click', clickEv(star()));
    assert(!!picker(), '7-24: fixture — a popover is open on the main feed again');
    const sheetHost = mkEl('div', 'chat-sheet-scroll');
    const sm = sheetHost.appendChild(mkEl('div', 'chat-msg', { mid: 'ix' }));
    const scol = sm.appendChild(mkEl('div', 'chat-bubble-col'));
    scol.appendChild(mkEl('div', 'chat-reactions')).appendChild(mkEl('button', 'chat-fb-star', { fbOpen: 'ix' }));
    chatUi._bindMessageActionButtons(sheetHost, () => {}, 'sheet');
    assert(picker().closest('.chat-sheet-scroll') === null,
      '7-25: the game sheet re-binding the SAME message does not pull the open popover out of the main feed — the marker names its surface, and both surfaces render the same message ids');
    await settle();
    clickOutside(mkEl('div', 'somewhere-else'));

    // ── The reaction picker evicts it, and it stays evicted.
    star()._fire('click', clickEv(star()));
    assert(!!picker(), '7-26: fixture — open once more');
    const reactOpen = mkEl('button', 'chat-act', { reactOpen: 'ix' });
    root.querySelector('.chat-actions').appendChild(reactOpen);
    chatUi._bindMessageActionButtons(root, repaint, 'main');
    reactOpen._fire('click', clickEv(reactOpen));
    assert(!picker(), '7-27: opening the reaction picker closes the feedback popover — single-open-at-a-time, unchanged');
    repaint();
    assert(!picker() && chatUi._openFeedbackPickerStateForTest() === null,
      '7-28: …and it stays closed through the next repaint, because that eviction disarms the marker too');

    // ── THE PRODUCTION REPAINT PATH, which the sections above deliberately do
    // not have. In the app, chat-ui subscribes `handleChatEvent` to chat.js and
    // repaints on EVERY ingest — so a write repaints the room before its own
    // handler has returned. That is the race the re-mount marker exists for, and
    // it cannot be seen without a subscriber, because a suite with none only
    // ever exercises the "nobody repainted us, do it ourselves" branch.
    const unsubscribe = onChat(kind => { if (kind === 'events') repaint(); });
    try {
      star()._fire('click', clickEv(star()));
      assert(!!picker(), '7-a: fixture — open, with a live subscriber repainting on every event');
      const before = repaints;
      chipBtn('too_long')._fire('click', clickEv(null));
      assert(!!picker(),
        '7-b: a chip tap under a live subscriber leaves the popover OPEN — the repaint the write triggers destroys the node and the binder puts it straight back, in the same state');
      assert(chipBtn('too_long')?.className.includes('active'),
        '7-c: …with the tapped chip selected in the re-mounted copy, so the in-flight set survived the node that held it');
      assert(repaints - before === 1,
        `7-d: EXACTLY ONE repaint for that tap, not two. The handler checks whether the repaint already consumed its marker before rendering again — a second render would have found no marker and closed the popover (got ${repaints - before})`);
    } finally {
      unsubscribe();
    }
    await settle();
    clickOutside(mkEl('div', 'somewhere-else'));

    // ── The master switch, at the interaction layer.
    storage.saveSetting('scribeFeedbackEnabled', false);
    star()._fire('click', clickEv(star()));
    const before = JSON.stringify(getFeedbackFor('ix').p1);
    const outboxBefore = store.get('cfbp_chat_outbox2') || '[]';
    picker()?.querySelector('[data-fb-rating="hit"]')?._fire('click', clickEv(null));
    picker()?.querySelector('[data-fb-chip="too_mean"]')?._fire('click', clickEv(null));
    assert(JSON.stringify(getFeedbackFor('ix').p1) === before && (store.get('cfbp_chat_outbox2') || '[]') === outboxBefore,
      '7-29: with the switch OFF, live handlers on an already-open popover write NOTHING — not to the fold and not even to the outbox. The guard is at the seam, not only in the render, which is the reviewer\'s original reason for putting it there: a player holding the popover open when the commissioner flips the switch still has live click handlers bound');
    assert(!picker(),
      '7-30: …and the popover closes rather than sitting there pretending the tap landed');
    await debounced();
    assert((store.get('cfbp_chat_outbox2') || '[]') === outboxBefore,
      '7-30b: …and nothing leaks out of the DEBOUNCE either. F-3 moved the chip write off the tap, so the master switch now has to be honoured up to 400ms later — after the popover is gone and the handler that armed it has returned');
    storage.saveSetting('scribeFeedbackEnabled', true);

    // ═════════════════════════════════════════════════════════════════════════
    // [7F] THE 2026-09-23 FIX PASS — same real popover, same real binder, same
    // element tree. Five properties that a render-only test cannot see:
    //   F-1   the re-mount marker is OWNED, so a same-device account switch
    //         cannot inherit the previous player's in-flight state.
    //   F-3a  chip taps coalesce into ONE full-set row, and no dismissal drops
    //         a set still inside the window.
    //   F-3b  a note is compared against the last text SENT, not the lagging
    //         fold, so Enter-then-blur writes one row per edit.
    //   R-1   clearing or flipping a rating retracts the chips and the note it
    //         was the only way to display.
    //   R-4   the two dismissal paths that wrote nothing now write.
    // ═════════════════════════════════════════════════════════════════════════
    console.log('\n[7F] Fix pass 2026-09-23 — F-1 owner / F-3 coalesce+dedupe / R-1 cascade / R-4 dismissals…');

    /** An independent surface per property, so none of these inherit §7's
     *  accumulated state on 'ix'. Same construction as `repaint()` above. */
    const surfaceFor = targetMid => {
      let node = null;
      const rp = () => {
        if (node) node.remove();
        node = mkEl('div', 'chat-scroll');
        const mm = node.appendChild(mkEl('div', 'chat-msg', { mid: targetMid }));
        const col = mm.appendChild(mkEl('div', 'chat-bubble-col'));
        col.appendChild(mkEl('div', 'chat-reactions')).appendChild(mkEl('button', 'chat-fb-star is-unrated', { fbOpen: targetMid }));
        col.appendChild(mkEl('div', 'chat-actions'));
        chatUi._bindMessageActionButtons(node, rp, 'main');
        return node;
      };
      const api = {
        repaint: rp,
        root: () => node,
        star: () => node.querySelector('.chat-fb-star'),
        chip: c => picker()?.querySelector(`[data-fb-chip="${c}"]`) || null,
        note: () => picker()?.querySelector('[data-fb-note]') || null,
        tap: c => api.chip(c)._fire('click', clickEv(null)),
        rate: v => picker().querySelector(`[data-fb-rating="${v}"]`)._fire('click', clickEv(null)),
        type: text => { const el = api.note(); el.value = text; el._fire('input', {}); },
        enter: () => api.note()._fire('keydown', { key: 'Enter', stopPropagation() {} }),
        open: () => { rp(); const s = api.star(); s._fire('click', clickEv(s)); },
      };
      return api;
    };
    let nextSeq = 900;
    const freshMsg = id => { nextSeq += 1; ingest([msg({ id, seq: nextSeq, ts: nextSeq * 1000 })]); return id; };
    const dismiss = async () => { await settle(); clickOutside(mkEl('div', 'somewhere-else')); };
    const outboxAll = () => JSON.parse(store.get('cfbp_chat_outbox2') || '[]');

    // ── F-1 — the marker names its owner, and an account switch cannot use it.
    const own = surfaceFor(freshMsg('f1a'));
    own.open();
    own.rate('mid');
    own.tap('too_mean');
    own.type('he was on the sideline');
    assert(chatUi._openFeedbackPickerStateForTest()?.author === 'p1',
      '7F-1: the re-mount marker NAMES THE PLAYER WHO ARMED IT. It carries their in-flight chips and their half-typed "why", and the popover it re-mounts writes under whoever me() is at the moment of the tap');
    storage.setSession('p2', false, true);
    own.repaint();
    assert(!picker(),
      '7F-2: after a same-device account switch with no repaint in between, the next repaint mounts NOTHING — p2 does not inherit p1\'s open popover, which is the whole finding: p2 would have been handed p1\'s chips and p1\'s sentence, under p2\'s id');
    assert(chatUi._openFeedbackPickerStateForTest() === null,
      '7F-3: …and the marker is nulled on the spot rather than waiting for a dismissal p2 will never perform');
    await debounced();
    assert(reasonRows('f1a').length === 0 && feedbackRows('f1a', 'reason_note').length === 0,
      '7F-4: …and p1\'s in-flight work is DROPPED, not flushed: nothing is written for this line — not under p2\'s id (the finding), and not under p1\'s either, because the player who typed it has left the device (chat.js\'s own handover discards unsent work for the same reason)');
    assert(getFeedbackFor('f1a').p2 === undefined && getFeedbackFor('f1a').p1?.reason === undefined,
      '7F-5: …so neither player has a reason row on that line in the fold');
    storage.setSession('p1', false, true);

    // ── F-3(a) — three rapid taps, one row; and a pending set survives a close.
    const deb = surfaceFor(freshMsg('f3a'));
    deb.open(); deb.rate('mid');
    deb.tap('too_often'); deb.tap('too_long'); deb.tap('too_mean');
    assert(reasonRows('f3a').length === 0,
      '7F-6: THREE RAPID CHIP TAPS HAVE WRITTEN NOTHING YET. Two of those three rows would have been obsolete the instant the next tap landed, and this is an append-only log — they would all three be there forever');
    assert(['too_often', 'too_long', 'too_mean'].every(c => deb.chip(c).className.includes('active')),
      '7F-7: …while the popover shows all three selected ON THE TAP. The debounce is invisible to the player: `working` is still armed synchronously, so the coalesce costs no feedback');
    await debounced();
    const set1 = reasonRows('f3a');
    assert(set1.length === 1,
      `7F-8: when the window closes there is EXACTLY ONE feedback event for those three taps (got ${set1.length})`);
    assert(JSON.stringify(set1[0].meta.value) === JSON.stringify(['too_often', 'too_long', 'too_mean']),
      `7F-9: …carrying the FINAL set. Coalescing is only sound because the event is a SET, NOT A DIFF — any single row, applied alone, is the whole answer (got ${JSON.stringify(set1[0]?.meta?.value)})`);
    deb.tap('not_funny');
    assert(reasonRows('f3a').length === 1, '7F-10: fixture — the fourth tap is pending and unwritten');
    await dismiss();
    const set2 = reasonRows('f3a');
    assert(set2.length === 2 && (set2[1].meta.value || []).includes('not_funny'),
      `7F-11: THE DISMISSAL FLUSHES THE PENDING SET. A debounce that can lose the last tap is worse than no debounce, because the player watched the chip light up (got ${JSON.stringify(set2.map(e => e.meta.value))})`);

    // ── F-3(b) — one row per edit, not two.
    const nt = surfaceFor(freshMsg('f3b'));
    nt.open(); nt.rate('mid');
    nt.type('it keeps bringing up the Fresno game'); nt.enter();
    assert(feedbackRows('f3b', 'reason_note').length === 1, '7F-12: fixture — Enter writes the note once');
    nt.type('it keeps bringing up the Fresno game, badly'); nt.enter();
    assert(feedbackRows('f3b', 'reason_note').length === 2,
      '7F-13: …and an EDIT writes a second row, as it should');
    assert(getFeedbackFor('f3b').p1.reason_note === 'it keeps bringing up the Fresno game',
      '7F-14: fixture, and the trap itself: the FOLD still reads the FIRST note after that edit. A local event is stamped {ts:0,seq:0} and applyTo() drops a same-key tie, so the fold lags every edit by one server echo');
    nt.note()._fire('change', {});
    assert(feedbackRows('f3b', 'reason_note').length === 2,
      '7F-15: A BLUR WITH UNCHANGED TEXT WRITES NOTHING. noteChanged() compares against the last text this device SENT — comparing against the lagging fold made Enter-then-blur write the same sentence twice, one append-only row each, on every edit after the first');
    nt.type('and the Fresno game was last year');
    nt.note()._fire('change', {});
    assert(feedbackRows('f3b', 'reason_note').length === 3,
      '7F-16: …while a blur that really did change the text still writes. The guard suppresses duplicates, not edits');
    await dismiss();

    // ── R-1 — clearing a rating retracts what the rating was explaining.
    const cas = surfaceFor(freshMsg('r1a'));
    cas.open(); cas.rate('mid');
    cas.tap('too_mean');
    await debounced();
    cas.type('way over the line'); cas.enter();
    assert(reasonRows('r1a').length === 1 && feedbackRows('r1a', 'reason_note').length === 1,
      '7F-17: fixture — a rating, a chip and a note are all on file for this line');
    const beforeClear = outboxAll().length;
    cas.rate('mid');                                  // re-tapping the current rating clears it
    const cascade = outboxAll().slice(beforeClear).filter(e => e.type === 'feedback' && e.targetId === 'r1a');
    assert(cascade.length === 3,
      `7F-18: CLEARING THE RATING WRITES THREE EVENTS, NOT ONE. The rating is what REVEALS the chips and the note, so a bare clear leaves a complaint no screen can display and no tap can retract — and Package C's Trainer would still read it as live (got ${cascade.length})`);
    assert(cascade[0].meta.category === 'rating' && cascade[0].meta.value === null,
      '7F-19: …in the order the player\'s state collapses: the explicit rating clear first');
    assert(cascade[1].meta.category === 'reason' && JSON.stringify(cascade[1].meta.value) === JSON.stringify([]),
      '7F-20: …then the EMPTY SET — the same "I took them all back" record an un-tap writes, not silence');
    assert(cascade[2].meta.category === 'reason_note' && cascade[2].meta.value === '',
      '7F-21: …then the note, cleared to empty');
    assert(!picker(), '7F-22: …and the popover still closes on the clear, exactly as it always has');
    // The FOLD outcome, proved by echoing those three events back with server
    // stamps — a local write ties with the value already on its key and
    // applyTo() drops it, so an unechoed clear cannot show up in the fold (the
    // property §[2] and 7-22 already document).
    ingest(cascade.map((e, i) => ({ ...e, seq: 5000 + i, ts: 5000000 + i })));
    const cleared = getFeedbackFor('r1a').p1;
    assert(cleared.rating === null && Array.isArray(cleared.reason) && cleared.reason.length === 0 && cleared.reason_note === '',
      `7F-23: once echoed, NOTHING is left on that line for that player — no orphan chip, no orphan note (got ${JSON.stringify(cleared)})`);
    assert(!/data-fb-chip/.test(chatUi._feedbackPopoverHTMLForTest(getMessage('r1a'), 'p1')),
      '7F-24: …and reopening the popover is back to the bare 2×2 grid, so the next rating starts from a clean slate');

    // ── R-1 — flipping a rating drops the chips the new rating cannot show.
    const flip = surfaceFor(freshMsg('r1b'));
    flip.open(); flip.rate('mid');
    flip.tap('too_mean'); flip.tap('wrong_facts');
    await debounced();
    assert(reasonRows('r1b').length === 1, '7F-25: fixture — two miss chips on file under a Mid rating');
    flip.rate('too_much');
    assert(reasonRows('r1b').length === 1,
      '7F-26: FLIPPING MID → TOO MUCH WRITES NO CHIP ROW AT ALL. Both miss ratings render the same ten chips, so nothing the player selected became unreachable — DI-268\'s two miss ratings ask the same question');
    assert(flip.chip('too_mean').className.includes('active') && flip.chip('wrong_facts').className.includes('active'),
      '7F-27: …and both chips are still selected after that flip');
    flip.rate('hit');
    const afterHit = reasonRows('r1b');
    assert(afterHit.length === 2 && JSON.stringify(afterHit[1].meta.value) === JSON.stringify([]),
      `7F-28: FLIPPING TO HIT DROPS THE MISS CHIPS IN THE SAME TAP. "Hit" renders the positive chip alone, so 'too_mean' would have sat in the log arguing for less heat on a line the player had just said landed — invisible, and impossible to un-tap (got ${JSON.stringify(afterHit.map(e => e.meta.value))})`);
    assert(!/data-fb-chip="too_mean"/.test(picker().innerHTML) && /data-fb-chip="perfect_more_of_this"/.test(picker().innerHTML),
      '7F-29: …and the popover now offers the positive chip alone, matching exactly what was written');
    flip.tap('perfect_more_of_this');
    await debounced();
    flip.rate('mid');
    const afterMid = reasonRows('r1b');
    assert(JSON.stringify(afterMid[afterMid.length - 1].meta.value) === JSON.stringify([]),
      `7F-30: …and the rule runs BOTH ways — flipping back to a miss rating drops "More of this", which the miss view cannot render either (got ${JSON.stringify(afterMid[afterMid.length - 1].meta.value)})`);
    await dismiss();

    // ── R-4 — the two dismissal paths that used to write nothing.
    const rt = surfaceFor(freshMsg('r4a'));
    rt.open(); rt.rate('mid');
    rt.tap('too_long');
    rt.type('and it was the wrong week');
    assert(reasonRows('r4a').length === 0 && feedbackRows('r4a', 'reason_note').length === 0,
      '7F-31: fixture — a chip inside its debounce window and a typed-but-unentered note, neither written');
    const reStar = rt.star(); reStar._fire('click', clickEv(reStar));       // re-tapping the ⭐ dismisses
    assert(!picker() && chatUi._openFeedbackPickerStateForTest() === null,
      '7F-32: re-tapping the ⭐ closes the popover and disarms the marker, unchanged');
    assert(reasonRows('r4a').length === 1 && feedbackRows('r4a', 'reason_note').length === 1,
      '7F-33: …AND NOW WRITES BOTH. This was the one exit that saved nothing: a player who typed a "why" and tapped the star again to put the popover away lost the sentence, silently');
    assert(feedbackRows('r4a', 'reason_note')[0].meta.value === 'and it was the wrong week',
      '7F-34: …byte-for-byte what they typed');

    const rx = surfaceFor(freshMsg('r4b'));
    rx.open(); rx.rate('mid');
    rx.tap('too_soft');
    rx.type('soft take');
    const reactBtn = rx.root().querySelector('.chat-actions').appendChild(mkEl('button', 'chat-act', { reactOpen: 'r4b' }));
    chatUi._bindMessageActionButtons(rx.root(), rx.repaint, 'main');
    reactBtn._fire('click', clickEv(reactBtn));
    assert(!picker() && chatUi._openFeedbackPickerStateForTest() === null,
      '7F-35: opening the reaction picker still evicts the feedback popover — single-open-at-a-time, unchanged');
    assert(reasonRows('r4b').length === 1 && feedbackRows('r4b', 'reason_note').length === 1 &&
           feedbackRows('r4b', 'reason_note')[0].meta.value === 'soft take',
      '7F-36: …and THAT eviction writes the in-flight chip set and the note too. [data-react-open] calls stopPropagation(), so the popover\'s own outside-click closer never runs for this tap — without this, everything in it went in the bin');
    await dismiss();

    // ── R-5 — ✏️ Rewrite is a dismissal too, and it saves the "why" first.
    const rw = surfaceFor(freshMsg('r5a'));
    rw.open(); rw.rate('mid');
    rw.tap('tried_too_hard');
    rw.type('this one needed a rewrite, not a chip');
    assert(reasonRows('r5a').length === 0 && feedbackRows('r5a', 'reason_note').length === 0,
      '7F-37: fixture — the chip is inside its debounce window and the note is typed but not entered');
    picker().querySelector('[data-fb-rewrite]')._fire('click', clickEv(null));
    assert(feedbackRows('r5a', 'reason_note')[0]?.meta?.value === 'this one needed a rewrite, not a chip' &&
           JSON.stringify(reasonRows('r5a')[0]?.meta?.value) === JSON.stringify(['tried_too_hard']),
      '7F-38: HANDING OVER TO THE ✏️ REWRITE MODAL WRITES BOTH FIRST. A modal taking over is a dismissal like any other, and "type a why, then decide to write the line properly instead" is the most likely next tap a player mid-complaint makes — it used to drop the sentence on the floor');
    assert(!!document.getElementById('feedback-text-modal'),
      '7F-39: …and the modal really did open on top of that. Fixture, and not a redundant one: a flush that threw on its way into openFeedbackTextModal() would satisfy 7F-38 and still leave the player staring at nothing');
    assert(chatUi._openFeedbackPickerStateForTest() === null,
      '7F-40: …with the popover\'s marker disarmed before the write, so the repaint it causes cannot re-mount the popover the modal just replaced');
    document.getElementById('feedback-text-modal').remove();

    // ── R-6 — reopening inside the echo window shows what was SENT.
    const echo = surfaceFor(freshMsg('r6a'));
    echo.open(); echo.rate('mid');
    echo.type('first draft'); echo.enter();
    echo.tap('too_long');
    await debounced();
    echo.type('second draft'); echo.enter();      // second write to each key…
    echo.tap('not_funny');
    await debounced();
    assert(getFeedbackFor('r6a').p1.reason_note === 'first draft' &&
           JSON.stringify(getFeedbackFor('r6a').p1.reason) === JSON.stringify(['too_long']),
      `7F-41: fixture, and the trap itself — the FOLD still holds the FIRST note and the FIRST chip set. Both second writes tied at {ts:0,seq:0} and applyTo() dropped them (got ${JSON.stringify(getFeedbackFor('r6a').p1)})`);
    await dismiss();
    echo.open();
    assert(echo.note().value === 'second draft',
      `7F-42: REOPENING INSIDE THE ECHO WINDOW RENDERS WHAT THIS DEVICE SENT, not the lagging fold. Being shown the previous sentence back is precisely how a player concludes the edit did not save and types it a second time (got ${JSON.stringify(echo.note().value)})`);
    assert(echo.chip('not_funny').className.includes('active') && echo.chip('too_long').className.includes('active'),
      '7F-43: …and the chip set the same way. The two values are computed three lines apart in reasonSectionHTML() from the same lagging source, so they are fixed together — fixing one and not the other is the failure shape this file\'s three suppression comments warn about');
    assert(!/feedback-chip active/.test(chatUi._feedbackPopoverHTMLForTest(getMessage('r6a'), 'p2')),
      '7F-44: …and NONE of it crosses players: the record is matched on (message, player), so p2 still sees their own empty row — the blind rule for feedback is unchanged');
    // 7F-44 IS NOT THE PROOF OF THE AUTHOR MATCH, and saying so here is the
    // point (merge-review finding, 2026-09-24). p2 has no rating on this line,
    // so reasonSectionHTML() returns '' before chipsOnFileFor() is ever
    // reached — delete `&& rec.author === author` from lastSentFor() and that
    // assertion stays green. What it really proves is the rating gate.
    //
    // 7F-44b is the one that bites. p2 gets a rating of their OWN, and their
    // own chips and note are set to the EXACT values p1's unsent record carries
    // as its `foldAtSend` — so an author-blind lookup would sail through the
    // bound check and hand p1's in-flight selection and p1's in-flight sentence
    // to a different player, which is the whole reason the match is there.
    ingest([
      fbev('r6a', { category: 'rating', value: 'mid' }, 5900, 5900000, 'p2'),
      fbev('r6a', { category: 'reason', value: ['too_long'] }, 5901, 5901000, 'p2'),
      fbev('r6a', { category: 'reason_note', value: 'first draft' }, 5902, 5902000, 'p2'),
    ]);
    const p2Html = chatUi._feedbackPopoverHTMLForTest(getMessage('r6a'), 'p2');
    assert(/data-fb-chip="too_long" aria-pressed="true"/.test(p2Html) &&
           !/data-fb-chip="not_funny" aria-pressed="true"/.test(p2Html) &&
           /value="first draft"/.test(p2Html) && !/second draft/.test(p2Html),
      `7F-44b: A PLAYER WITH A ROW OF THEIR OWN SEES ONLY THEIR OWN. p2 is shown their own single chip and their own note — not p1's unsent ['too_long','not_funny'] and not p1's unsent "second draft", even though p2's fold matches p1's foldAtSend exactly and nothing but the author match separates the two (got chips ${JSON.stringify(p2Html.match(/data-fb-chip="[^"]+" aria-pressed="true"/g) || [])}, note ${JSON.stringify((/value="([^"]*)"/.exec(p2Html) || [])[1])})`);
    // THE OVERRIDE IS BOUNDED. A LATER write from the player's other device
    // arrives stamped, moves the fold, and must win — otherwise a stale local
    // record would shadow it for the rest of the session.
    //
    // DISMISSED FIRST, DELIBERATELY: the closer flushes whatever is in the live
    // input, so a popover left open across the remote write would (correctly,
    // and by a rule that long predates this fix) write the visible text back
    // over it on the way out, and this assertion would be testing that instead.
    await dismiss();
    ingest([fbev('r6a', { category: 'reason_note', value: 'typed on my phone' }, 6000, 6000000)]);
    ingest([fbev('r6a', { category: 'reason', value: ['wrong_target'] }, 6001, 6001000)]);
    echo.open();
    assert(echo.note().value === 'typed on my phone',
      `7F-45: A LATER WRITE FROM ANOTHER DEVICE WINS. The override lasts only while the fold still reads what it read when we sent (foldAtSend); the moment the log moves — our own echo, or the same player on their phone — the log is authoritative again (got ${JSON.stringify(echo.note().value)})`);
    assert(echo.chip('wrong_target').className.includes('active') && !echo.chip('not_funny').className.includes('active'),
      '7F-46: …and the chip row follows the same bound, so the two halves cannot drift apart into showing one field from the log and the other from a stale local record');
    await dismiss();
  } finally {
    globalThis.document = realDoc;
  }
}

console.log(`\n${pass} passed, ${fail} failed.`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
