/**
 * CFB Pickems — groupdtest.mjs (Build 3, Group D pass 2 — the UI)
 * ==============================================================================
 * Behavioral tests for DI-D1's commissioner dial + detector call sites, DI-D3's
 * player profile, and DI-D4's "My SCRIBE File," per `weekly bug fixes and
 * feedback/Chat SCRIBE updates 090526/DESIGN_INPUTS_BATCH2_091026.md`
 * (Document 2, §3/§5/§6) and Drew's Part 0 rulings D-1 (expose all five
 * levels) and D-5 (one confirm before a delete), plus the coordinator's
 * 2026-09-11 review amendments (F1 ledger split, F2 single call site, F3
 * Section 1 copy, and minor items 4-10).
 *
 * Precedent: `grouptest.mjs` (UN-118) — a separate file beside loadtest.mjs,
 * spawned from it as [81], never folded into the chat-fold suite. Render
 * assertions are made against RENDERED OUTPUT, not source text (protocol step
 * 29 / RG-27: a source-grep test passes when the guard is reverted).
 *
 * Run:  node groupdtest.mjs        (sweep TZ=UTC and TZ=America/Los_Angeles)
 *
 * Sections:
 *   [1]  DI-D1 dial — all five levels render with their approved copy, the
 *        current level is the selected one, RG-10 wrapper present.
 *   [2]  DI-D1 dial — the write goes through the storage seam, declares its
 *        field, and refuses an unknown level.
 *   [3]  DI-D4 — the entry point is hidden while signed out, present signed in.
 *   [4]  DI-D4 — modal states: loading skeleton, empty, populated, error.
 *   [5]  DI-D4 — row anatomy: unconfirmed tag, episode jump, computed rows
 *        read-only with an "as of" stamp, hard limits, roast tolerance.
 *   [6]  DI-D4 — delete requires the confirm and calls the delete relay with
 *        the CURRENT player's id.
 *   [7]  DI-D4 — add-a-topic writes kind 'hardline', clamped to 80 chars.
 *   [8]  DI-D4 — roast tolerance round-trips as a memory row.
 *   [9]  DI-D3/E1 — no other player's rows ever reach a render path.
 *   [10] DI-D3 — zero-row profile is well-formed; stats are the Standings
 *        page's own numbers, asserted against scoring.js directly.
 *   [11] DI-D1 — the ONE detector call site (F2: the lock-phase one is
 *        removed): blind-rule gate, standings before/after actually reach
 *        the detectors, once per (week, phase), and F1's regression — a
 *        pre-final finalizeWeek() must not consume the week's evaluation.
 *   [12] DI-D2 — approving a fact candidate fires the memory sync exactly
 *        once; approving anything else fires it zero times.
 *   [13] Structural — the memory rows never touch the KV storage seam, and
 *        the transport defaults ARE js/backend.js's real relays.
 */

import { readFile } from 'node:fs/promises';

// ── DOM / browser stubs — IDENTICAL shape to loadtest.mjs's ──────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
const nullEl = new Proxy(function () {}, {
  get: (t, p) => {
    if (p === 'classList') return { add() {}, remove() {}, toggle() {}, contains: () => false };
    if (p === 'style') return {};
    if (p === 'dataset') return {};
    if (['addEventListener', 'removeEventListener', 'appendChild', 'removeChild', 'insertAdjacentHTML', 'remove', 'focus', 'scrollTo'].includes(p)) return () => {};
    if (p === 'querySelectorAll') return () => [];
    if (p === 'querySelector' || p === 'closest') return () => null;
    if (p === 'innerHTML' || p === 'textContent' || p === 'value') return '';
    return undefined;
  },
  set: () => true,
});
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [], classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in groupdtest'); };
globalThis.matchMedia = () => ({ matches: false });
// Overridden per-section — every delete assertion drives this deliberately.
let confirmCalls = [];
let confirmAnswer = true;
globalThis.confirm = msg => { confirmCalls.push(String(msg)); return confirmAnswer; };
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const storage = await import('./js/storage.js');
const scoring = await import('./js/scoring.js');
const backend = await import('./js/backend.js');
const scribeLines = await import('./js/scribeLines.js');
const scribeAgent = await import('./js/scribeAgent.js');
const chatUi = await import('./js/chat-ui.js');
const app = await import('./js/app.js');

const { FREQUENCY_COPY, FREQUENCY_LEVELS } = scribeLines;
const {
  renderScribeParticipationCardHTML, setScribeFrequency, setScribeAutonomousEnabled,
  renderScribeFileBodyHTML, getPlayerProfile, seasonStandingsRows,
  scribeFileDeleteRow, scribeFileAddTopic, scribeFileSetTolerance,
  fireScribeWeekSignals, applyScribeLearningDecision, syncApprovedScribeFacts,
  _wireScribeMemoryTransportForTest, _restoreScribeMemoryTransportForTest,
  _scribeMemoryTransportDefaultsForTest, _setScribeMemoryCacheForTest,
  _resetScribeWeekSignalLedgerForTest, _scribeWeekSignalLedgerForTest,
  refreshScribeMemory,
} = app;

console.log('[groupdtest] modules imported —', Object.keys(app).length, 'app.js exports');

// Autonomy transport UNWIRED for the whole file: `considerAutonomous` then
// returns `not_ready` before it reserves any cooldown or attempts any network
// call, which is precisely what these tests want — they assert what the
// DETECTORS produce and what the call sites pass, never what the server does
// with it (that is memorytest/scoringtest's job, in their own processes).
scribeAgent.wireScribeRemoteTransport({});

// ── Fixture league ──────────────────────────────────────────────────────────
storage.addPlayer({ playerId: 'p1', displayName: 'Drew', active: true, preferences: { theme: 'maroon', chatNick: 'Commish' } });
storage.addPlayer({ playerId: 'p2', displayName: 'Brayden', active: true });
storage.addPlayer({ playerId: 'p3', displayName: 'Kevin', active: true });
storage.setSession('p1', true, true);

/** A single row's markup, sliced from `data-mem-id="<id>"` back to the start
 *  of its own .card and forward to the next row — so an assertion about ROW A
 *  can never be satisfied by text belonging to ROW B (which is exactly how a
 *  loose slice made the "1.0 confidence carries no tag" check pass for the
 *  wrong reason on the first run of this file). */
function rowHTMLById(html, id) {
  const at = html.indexOf(`data-mem-id="${id}"`);
  if (at < 0) return '';
  const start = html.lastIndexOf('<div class="card', at);
  const nextRow = html.indexOf('data-mem-id="', at + 1);
  const end = nextRow < 0 ? html.length : html.lastIndexOf('<div class="card', nextRow);
  return html.slice(start < 0 ? at : start, end > at ? end : html.length);
}

const memRow = (o) => ({
  id: 'mem_' + Math.random().toString(36).slice(2, 8),
  playerId: 'p1', kind: 'fact', key: 'almaMater', value: 'Purdue',
  provenance: 'trainer-proposed', confidence: 1, createdAt: '2026-09-01T00:00:00.000Z',
  reviewAt: '', sourceMessageId: '', ...o,
});

// ═════════════════════════════════════════════════════════════════════════
// 1. DI-D1 — the dial renders all five approved levels (Drew's D-1 ruling)
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[1] DI-D1 — Comm→Settings dial renders five levels…');
setScribeAutonomousEnabled(true);
setScribeFrequency('balanced');
const dial = renderScribeParticipationCardHTML();

assert(/<div class="admin-section" data-comm-tab="settings">/.test(dial),
  'RG-10: the card ships its OWN data-comm-tab="settings" wrapper (an untagged .admin-section renders on all five tabs)');
assert(!/data-comm-tab="(week|games|players|data)"/.test(dial),
  'RG-10 negative check: the dial renders under no other commissioner tab');
assert(dial.includes('How often SCRIBE jumps into the conversation on its own. Direct @SCRIBE questions always get answered regardless of this setting.'),
  'the approved DI-D1 copy is present verbatim, including the "direct @SCRIBE questions always get answered" promise');
assert(FREQUENCY_COPY.length === 5, `fixture check: FREQUENCY_COPY carries all five levels (got ${FREQUENCY_COPY.length})`);
let allFive = true, allDesc = true;
for (const o of FREQUENCY_COPY) {
  if (!dial.includes(`data-scribe-freq="${o.level}"`)) allFive = false;
  if (!dial.includes(o.description)) allDesc = false;
}
assert(allFive, 'all FIVE levels are selectable — Quiet / Reserved / Balanced / Active / Unhinged (Drew\'s D-1 ruling overrides the DI\'s 3-level recommendation)');
assert(allDesc, 'each level renders its approved one-line description from SCRIBE_COPY_GROUP_D_091126.md §5');
assert(dial.includes('Maximum SCRIBE. You asked for this.'), 'the Unhinged line is the approved copy, not a paraphrase');
assert(/data-scribe-freq="balanced"[^>]*aria-checked="true"|class="scribe-freq-opt selected" data-scribe-freq="balanced"/.test(dial)
  || /class="scribe-freq-opt selected"[\s\S]{0,120}data-scribe-freq="balanced"/.test(dial),
  'the CURRENT level (balanced) is the one marked selected');
assert((dial.match(/scribe-freq-opt selected/g) || []).length === 1,
  'exactly ONE level is selected at a time — radio behaviour, never two and never zero');

setScribeFrequency('unhinged');
const dialU = renderScribeParticipationCardHTML();
assert(/class="scribe-freq-opt selected"[\s\S]{0,140}data-scribe-freq="unhinged"/.test(dialU),
  'changing the stored level moves the selected state with it (unhinged)');
assert(dialU.includes(`score ${FREQUENCY_LEVELS.unhinged} or better`),
  `the card states the ACTIVE threshold from FREQUENCY_LEVELS, not a hardcoded number (got the ${FREQUENCY_LEVELS.unhinged} threshold)`);

// States: Off / Set (DI-D1)
setScribeAutonomousEnabled(false);
const dialOff = renderScribeParticipationCardHTML();
assert(dialOff.includes('notif-prefs-row-dim') && dialOff.includes('Off. SCRIBE posts nothing unprompted'),
  'OFF state: the dial is visibly dimmed and the card says autonomy is off');
assert(!/id="scribe-autonomous-toggle" checked/.test(dialOff), 'OFF state: the master checkbox renders unchecked');
setScribeAutonomousEnabled(true);
assert(/id="scribe-autonomous-toggle" checked/.test(renderScribeParticipationCardHTML()), 'SET state: the master checkbox renders checked again');

// ═════════════════════════════════════════════════════════════════════════
// 2. DI-D1 — the write goes through the seam and is field-declared
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] DI-D1 — the dial writes through the storage seam…');
setScribeFrequency('quiet');
assert(storage.getSettings().scribeFrequency === 'quiet',
  'setScribeFrequency() persists through getSettings()/saveSetting() — the seam, not a parallel store');
assert(scribeAgent.getScribeFrequency() === 'quiet',
  'and the value is what scribeAgent.getScribeFrequency() reads back — one definition, client-wide');
const badWrite = setScribeFrequency('turbo');
assert(badWrite.ok === false && storage.getSettings().scribeFrequency === 'quiet',
  'an unknown level is REFUSED, not stored — an unrecognized value would make scoreOpportunity() fall back to Balanced silently');
setScribeAutonomousEnabled(false);
assert(storage.getSettings().scribeAutonomousEnabled === false && scribeAgent.isScribeAutonomousEnabled() === false,
  'the Off switch persists through the same seam and is what scribeAgent reads');
setScribeAutonomousEnabled(true);
{
  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export function setScribeFrequency'), src.indexOf('export function setScribeAutonomousEnabled'));
  assert(/saveSetting\('scribeFrequency', lvl\)/.test(fn),
    "[structural] the write is saveSetting('scribeFrequency', …) — which DECLARES the changed field for the bounded-size push (RG-24/RG-49/RG-55), not saveSettings() on the whole blob");
  assert(!/localStorage/.test(fn), '[structural] the dial never touches localStorage directly (AD-02)');
}
setScribeFrequency('balanced');

// ═════════════════════════════════════════════════════════════════════════
// 3. DI-D4 — the entry point is hidden while signed out
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] DI-D4 — "My SCRIBE File" entry point visibility…');
{
  const signedIn = chatUi._prefsPanelHTMLForTest();
  assert(signedIn.includes('data-scribe-file') && signedIn.includes('My SCRIBE File'),
    'signed IN: the player-settings surface (where chatNick/accent are edited) carries the "My SCRIBE File" button');
  assert(signedIn.includes('id="pref-nick"') && signedIn.includes('data-accent'),
    'fixture check: that really is the chatNick/accent surface DI-D4 names as the entry point');
  storage.clearSession();
  const signedOut = chatUi._prefsPanelHTMLForTest();
  assert(!signedOut.includes('data-scribe-file') && !signedOut.includes('My SCRIBE File'),
    'signed OUT: the entire entry point is absent from the rendered output');
  storage.setSession('p1', true, true);
  assert(await app.openScribeFileModal.call(null) !== undefined, 'fixture check: openScribeFileModal is callable');
  storage.clearSession();
  const blocked = await app.openScribeFileModal();
  assert(blocked === null, 'signed OUT: openScribeFileModal() renders nothing even if reached directly — the second lock on the same door');
  storage.setSession('p1', true, true);
}

// ═════════════════════════════════════════════════════════════════════════
// 4. DI-D4 — the four states
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] DI-D4 — loading / empty / populated / error states…');
{
  const loading = renderScribeFileBodyHTML({ loading: true });
  assert(loading.includes('scribe-file-skeleton') && (loading.match(/class="card" style="height:52px/g) || []).length === 3,
    'LOADING: skeleton rows in the app\'s existing idiom (DI-A3 precedent — three fading .card rows), not a spinner and not an empty state');
  assert(loading.includes('UI-level boundary'), 'LOADING: the privacy footnote is visible even while the rows are still coming');

  _setScribeMemoryCacheForTest('p1', []);
  const empty = renderScribeFileBodyHTML({ profile: getPlayerProfile('p1') });
  assert(empty.includes(scribeLines.MEMORY_COPY.emptyState),
    `EMPTY: the approved MEMORY_COPY empty-state string renders verbatim ("${scribeLines.MEMORY_COPY.emptyState}")`);
  assert(!empty.includes('data-mem-del'), 'EMPTY: no delete controls render when there is nothing recorded');
  assert(empty.includes('What SCRIBE knows') && empty.includes('Hard limits') && empty.includes('Roast tolerance'),
    'EMPTY: all three sections still render — an empty file is a state, not a missing surface');

  const err = renderScribeFileBodyHTML({ error: "Couldn't load — try again." });
  assert(err.includes("Couldn't load — try again.") && err.includes('role="alert"'),
    'ERROR: a failed fetch says so inline and loudly, never a silent empty state (AD-06 instinct)');

  const rowErr = renderScribeFileBodyHTML({ profile: getPlayerProfile('p1'), rowError: "Couldn't save — try again." });
  assert(rowErr.includes("Couldn't save — try again."),
    'ERROR (write): the DI\'s exact inline copy renders when a delete/upsert fails (a bare string is still accepted — no caller can crash on the scoped shape)');
}

// ═════════════════════════════════════════════════════════════════════════
// 5. DI-D4 — row anatomy
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5] DI-D4 — row anatomy: tags, jumps, computed rows, sections…');
{
  const rows = [
    memRow({ id: 'm_confirmed', key: 'almaMater', value: 'Purdue', confidence: 1, provenance: 'commissioner-set' }),
    memRow({ id: 'm_shaky', key: 'job', value: 'started a new job', confidence: 0.6, provenance: 'trainer-proposed', sourceMessageId: 'msg_42' }),
    memRow({ id: 'm_computed', key: 'seasonRecord', value: '12-6', confidence: 1, provenance: 'computed', refreshedAt: '2026-09-11T15:00:00.000Z' }),
    memRow({ id: 'm_h2h', kind: 'relation', key: 'headToHead:p2', provenance: 'computed', refreshedAt: '2026-09-11T15:00:00.000Z',
             value: JSON.stringify({ pair: 'p1|p2', gamesCompared: 17, agreed: 12, aRightBWrong: 3, bRightAWrong: 2 }) }),
    memRow({ id: 'm_hard', kind: 'hardline', key: 'topic:my-knee-surgery', value: 'my knee surgery', provenance: 'player-stated' }),
    memRow({ id: 'm_tol', kind: 'roastTolerance', key: 'roastTolerance', value: 'light', provenance: 'player-stated' }),
  ];
  _setScribeMemoryCacheForTest('p1', rows);
  const html = renderScribeFileBodyHTML({ profile: getPlayerProfile('p1') });

  assert(html.includes('What SCRIBE has recorded about you, in plain language. Delete anything you told it — no explanation needed. Facts it works out from the standings refresh on their own.'),
    'F3: Section 1 body is the AMENDED copy — it promises deletion of what the player told SCRIBE and says plainly that derived facts refresh themselves (the old line promised deletion of rows that are in fact read-only)');
  assert(html.includes(scribeLines.MEMORY_COPY.sectionBody),
    'and it is rendered FROM MEMORY_COPY.sectionBody (single home for approved copy, moved 2026-09-11)');
  assert(!html.includes('Delete anything — no explanation needed.'),
    'and the superseded pre-amendment line is NOT also rendered — one body line, not two');
  assert(html.includes('Alma mater') && html.includes('Purdue'),
    'a fact renders in PRODUCT LANGUAGE ("Alma mater"), never as the raw key "almaMater"');
  const shaky = rowHTMLById(html, 'm_shaky');
  assert(shaky.includes('>unconfirmed<'), 'a 0.6-confidence fact carries the "unconfirmed" tag');
  assert(shaky.includes(scribeLines.MEMORY_COPY.unconfirmedTag),
    'and the approved explainer renders as VISIBLE text, not a title= tooltip (tooltips do not fire on touch)');
  const confirmed = rowHTMLById(html, 'm_confirmed');
  assert(confirmed.includes('Purdue') && !confirmed.includes('started a new job'),
    'fixture check: the row slicer really isolates one row (the confirmed row holds its own value and none of the next row\'s)');
  assert(!confirmed.includes('>unconfirmed<'), 'a 1.0-confidence fact carries NO tag — the default is unremarked');
  {
    // Item 5 — the band is 0.5 ≤ c < 0.85, and a row with NO confidence is
    // untagged. `Number(null)`/`Number('')` are both 0, so an open-ended
    // "below 0.85" test would have labelled every unstamped row unconfirmed.
    const band = (c) => {
      _setScribeMemoryCacheForTest('p1', [memRow({ id: 'm_band', key: 'job', value: 'v', confidence: c })]);
      return renderScribeFileBodyHTML({ profile: getPlayerProfile('p1') }).includes('>unconfirmed<');
    };
    assert(band(0.5) === true, 'item 5: confidence 0.5 (the floor, inclusive) IS tagged unconfirmed');
    assert(band(0.84) === true, 'item 5: confidence 0.84 is tagged unconfirmed');
    assert(band(0.85) === false, 'item 5: confidence 0.85 (the ceiling, exclusive) is NOT tagged');
    assert(band(0.3) === false, 'item 5: confidence BELOW the 0.5 floor is not tagged either — the tag means "shaky," not "anything under 0.85"');
    assert(band(null) === false && band(undefined) === false && band('') === false,
      'item 5: a row with no confidence at all is untagged for all three empty shapes — the guard runs BEFORE Number() coerces them to 0');
    assert(band('0.6') === true, 'item 5: …while a numeric STRING from the sheet still reads as a real value');
  }
  assert(shaky.includes('data-jump="msg_42"'),
    'EPISODE POINTER: a row derived from a flagged message gets the jump affordance, reusing quoteHTML()\'s data-jump attribute');
  assert(!confirmed.includes('data-jump'), 'a row with no sourceMessageId gets NO jump affordance (nothing to jump to)');

  const computed = rowHTMLById(html, 'm_computed');
  assert(!computed.includes('data-mem-del'),
    'COMPUTED rows are read-only — no 🗑, because the next sync regenerates them (coordinator amendment 2026-09-11)');
  const expectedAsOf = 'as of ' + new Date(Date.parse('2026-09-11T15:00:00.000Z')).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  assert(computed.includes(expectedAsOf), `COMPUTED rows carry an "as of" stamp from refreshedAt (expected "${expectedAsOf}")`);
  assert(html.includes('Head-to-head vs Brayden'),
    'a headToHead relation renders the OPPONENT BY NAME, resolved through getPlayer() (CONVENTIONS #20)');
  assert(html.includes('17 games compared') && html.includes('you right 3') && html.includes('them right 2'),
    'and its JSON value is rendered in product language from the viewer\'s side, never dumped as raw JSON');

  assert(html.includes('Topics SCRIBE will never bring up about you. Private from other players. Visible to the commissioner until real sign-in ships — see below.'),
    'HARD LIMITS body is the approved copy VERBATIM — the DI marks this line load-bearing and not to be softened');
  assert(html.includes('my knee surgery') && html.includes('data-mem-del="m_hard"'),
    'a hard-limit topic renders in its own section with its own delete control');
  assert(html.includes('maxlength="80"') && html.includes('id="scribe-hardline-add-btn"'),
    'the "Add a topic" input is capped at 80 chars (DI-D4) and has an Add button');
  assert(html.includes('data-tolerance="light"') && html.includes('data-tolerance="standard"') && html.includes('data-tolerance="no_limits"'),
    'ROAST TOLERANCE offers exactly the three approved options — Light / Standard / No limits');
  assert(/class="scribe-tolerance-opt selected" data-tolerance="light"/.test(html),
    'and the stored value is the one shown as selected');
  assert(html.includes('This is a UI-level boundary, not a technical one — the commissioner administers the underlying data. Real per-player privacy is planned but not built yet (see the SSO roadmap).'),
    'the privacy footnote renders VERBATIM and unconditionally — never behind a disclosure triangle');
  assert(!html.includes('<details'), 'the footnote is not collapsible (DI-D4: "always visible, not collapsible")');

  // Escaping — every piece of stored text is user/Trainer data.
  _setScribeMemoryCacheForTest('p1', [memRow({ id: 'm_xss', key: 'job', value: '<img src=x onerror=alert(1)>' })]);
  const escaped = renderScribeFileBodyHTML({ profile: getPlayerProfile('p1') });
  assert(!escaped.includes('<img src=x') && escaped.includes('&lt;img src=x'),
    'CONVENTIONS #12: a stored value containing markup is escaped, every time');
}

// ═════════════════════════════════════════════════════════════════════════
// 6. DI-D4 — delete: one confirm, real relay, current player's id
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6] DI-D4 — delete requires the confirm (Drew\'s D-5 ruling)…');
{
  const deleteCalls = [];
  _wireScribeMemoryTransportForTest({ remove: async (args) => { deleteCalls.push(args); return { ok: true, deleted: true, id: args.id }; } });
  _setScribeMemoryCacheForTest('p1', [
    memRow({ id: 'm_del', key: 'job', value: 'a job' }),
    memRow({ id: 'm_comp', key: 'winPct', value: '61.5', provenance: 'computed' }),
    memRow({ id: 'm_other', playerId: 'p2', key: 'job', value: "another player's row" }),
  ]);

  confirmCalls = []; confirmAnswer = false;
  const cancelled = await scribeFileDeleteRow('m_del');
  assert(confirmCalls.length === 1 && confirmCalls[0] === 'Delete this? SCRIBE will forget it.',
    'the confirm fires ONCE with the exact approved copy: "Delete this? SCRIBE will forget it."');
  assert(cancelled.skipped === 'cancelled' && deleteCalls.length === 0,
    'declining the confirm calls NOTHING — no relay, no cache change (a cancel that deletes anyway is the worst version of this)');
  assert(getPlayerProfile('p1').facts.some(f => f.id === 'm_del'), 'and the row is still there after a cancel');

  confirmCalls = []; confirmAnswer = true;
  const done = await scribeFileDeleteRow('m_del');
  assert(confirmCalls.length === 1, 'accepting asks exactly once — one confirm, not two');
  assert(done.ok === true && deleteCalls.length === 1, 'accepting calls the delete relay exactly once');
  assert(deleteCalls[0].id === 'm_del' && deleteCalls[0].playerId === 'p1',
    'and it passes the row id together with the CURRENT player\'s playerId (the server\'s ownership check needs the requester)');
  assert(!getPlayerProfile('p1').facts.some(f => f.id === 'm_del'),
    'the row is gone from the very next profile read — true removal, not a hidden tombstone');

  deleteCalls.length = 0; confirmCalls = [];
  const notMine = await scribeFileDeleteRow('m_other');
  assert(notMine.skipped === 'not_mine' && deleteCalls.length === 0 && confirmCalls.length === 0,
    "another player's row cannot be deleted from this surface — refused before the confirm, let alone the relay");
  const computed = await scribeFileDeleteRow('m_comp');
  assert(computed.skipped === 'computed' && deleteCalls.length === 0,
    'a computed row refuses deletion rather than promising a removal the next sync would undo');

  // Failure path — inline error, never silent.
  _wireScribeMemoryTransportForTest({ remove: async () => { throw new Error('boom'); } });
  _setScribeMemoryCacheForTest('p1', [memRow({ id: 'm_fail', key: 'job', value: 'x' })]);
  confirmAnswer = true;
  const failed = await scribeFileDeleteRow('m_fail');
  assert(failed.ok === false, 'a failed delete reports failure to the caller');
  assert(getPlayerProfile('p1').facts.some(f => f.id === 'm_fail'),
    'and the row stays in the file — the UI never shows a deletion that did not happen');

  // Item 9 (reviewer) — the error belongs ON THE ROW that failed, not in a
  // banner at the top of a modal the player may have scrolled past.
  const scoped = app._scribeFileRowErrorForTest();
  assert(scoped && scoped.scope === 'row' && scoped.id === 'm_fail' && scoped.message === "Couldn't save — try again.",
    'item 9: the failure is recorded scoped to the failing row id, not as a file-level banner');
  const failHTML = renderScribeFileBodyHTML({ profile: getPlayerProfile('p1'), rowError: scoped });
  const failRow = rowHTMLById(failHTML, 'm_fail');
  assert(failRow.includes("Couldn't save — try again."),
    'item 9: and it RENDERS inside that row, next to the 🗑 that did not work');
  assert(failHTML.indexOf("Couldn't save") > failHTML.indexOf('What SCRIBE knows'),
    'item 9: …not above the first section heading, which is where the old banner sat');
  assert((failHTML.match(/Couldn't save — try again\./g) || []).length === 1,
    'item 9: exactly once — the row error is not also echoed at the top');

  _setScribeMemoryCacheForTest('p1', []);
  _wireScribeMemoryTransportForTest({ upsert: async () => { throw new Error('nope'); } });
  await scribeFileAddTopic('a topic that will not save');
  const hardScoped = app._scribeFileRowErrorForTest();
  assert(hardScoped && hardScoped.scope === 'hardline',
    'item 9: a failed ADD scopes its error to the Add control, which is the thing that did not work');
  const hardHTML = renderScribeFileBodyHTML({ profile: getPlayerProfile('p1'), rowError: hardScoped });
  assert(hardHTML.indexOf("Couldn't save") > hardHTML.indexOf('scribe-hardline-add-btn'),
    'item 9: …and renders directly beneath it');
  await scribeFileSetTolerance('light');
  const tolScoped = app._scribeFileRowErrorForTest();
  assert(tolScoped && tolScoped.scope === 'tolerance',
    'item 9: a failed tolerance write scopes to the tolerance control');
  const tolHTML = renderScribeFileBodyHTML({ profile: getPlayerProfile('p1'), rowError: tolScoped });
  assert(tolHTML.indexOf("Couldn't save") > tolHTML.indexOf('data-tolerance="no_limits"'),
    'item 9: …and renders beneath the three buttons');
  assert(!renderScribeFileBodyHTML({ profile: getPlayerProfile('p1'), rowError: { scope: 'row', id: 'someone-else', message: 'x' } }).includes('>x<'),
    'item 9: an error scoped to a row that is not on screen renders nowhere — it never leaks into another row');
  _restoreScribeMemoryTransportForTest();
}

// ═════════════════════════════════════════════════════════════════════════
// 7. DI-D4 — add a hard-limit topic
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[7] DI-D4 — "Add a topic" writes a hard-line row…');
{
  const upserts = [];
  _wireScribeMemoryTransportForTest({
    upsert: async (rec) => { upserts.push(rec); return { ok: true, record: { ...rec, id: 'mem_new_' + upserts.length } }; },
  });
  _setScribeMemoryCacheForTest('p1', []);

  const added = await scribeFileAddTopic('  my knee surgery  ');
  assert(added.ok === true && upserts.length === 1, 'adding a topic calls the upsert relay exactly once');
  assert(upserts[0].kind === 'hardline', "the row is written with kind 'hardline'");
  assert(upserts[0].playerId === 'p1', 'about the CURRENT player, never anyone else');
  assert(upserts[0].value === 'my knee surgery', 'the topic text is trimmed but otherwise verbatim');
  assert(upserts[0].provenance === 'player-stated' && upserts[0].confidence === 1,
    "provenance is 'player-stated' at confidence 1 — a player stating his own boundary is definitionally certain (the server forces this too)");
  assert(upserts[0].key !== 'topic',
    `each topic gets its OWN upsert key so five hard-lines do not collapse onto one row (got "${upserts[0].key}")`);

  await scribeFileAddTopic('my divorce');
  assert(upserts[1].key !== upserts[0].key, 'a DIFFERENT topic gets a different key — two rows, not one overwritten');
  await scribeFileAddTopic('my knee surgery');
  assert(upserts[2].key === upserts[0].key, 'the SAME topic re-added reuses the key — idempotent, never a duplicate row');
  assert(getPlayerProfile('p1').hardlines.length === 2,
    'so the file shows two hard limits after three adds, one of which was a repeat');

  const long = 'x'.repeat(200);
  await scribeFileAddTopic(long);
  assert(upserts[3].value.length === 80,
    `the topic is clamped to 80 characters, matching the input's maxlength (got ${upserts[3].value.length})`);

  // Item 6 (reviewer) — two long topics that share a long prefix must not
  // collide. Before the hash suffix the key was a truncated slug, so the
  // second of these would have silently OVERWRITTEN the first: a player adds
  // a boundary and watches the previous one disappear.
  _setScribeMemoryCacheForTest('p1', []);
  upserts.length = 0;
  const prefix = 'the surgery i had on my left knee and how it went afterwards';
  const topicA = prefix + ' in winter';
  const topicB = prefix + ' in summer';
  assert(topicA.length >= 55 && topicA.length <= 80 && topicB.length >= 55 && topicB.length <= 80
    && topicA !== topicB && topicA.slice(0, 40) === topicB.slice(0, 40),
    `fixture check: two long topics (${topicA.length}/${topicB.length} chars, both within the 80 cap) that genuinely share their first 40 characters`);
  await scribeFileAddTopic(topicA);
  await scribeFileAddTopic(topicB);
  assert(upserts[0].key !== upserts[1].key,
    'item 6: two long topics sharing a prefix get DIFFERENT upsert keys (slug + hash of the full text)');
  assert(getPlayerProfile('p1').hardlines.length === 2,
    'item 6: …so both persist — neither silently overwrites the other');
  await scribeFileAddTopic(topicA);
  assert(upserts[2].key === upserts[0].key && getPlayerProfile('p1').hardlines.length === 2,
    'item 6: and re-adding one of them is still idempotent — the hash is of the topic, not of the moment');
  const beforeBlank = upserts.length;
  const emptyAdd = await scribeFileAddTopic('   ');
  assert(emptyAdd.skipped === 'empty' && upserts.length === beforeBlank, 'a blank topic writes nothing at all');
  _restoreScribeMemoryTransportForTest();
}

// ═════════════════════════════════════════════════════════════════════════
// 8. DI-D4 — roast tolerance round-trips
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[8] DI-D4 — roast tolerance round-trip…');
{
  const upserts = [];
  _wireScribeMemoryTransportForTest({
    upsert: async (rec) => { upserts.push(rec); return { ok: true, record: { ...rec, id: 'mem_tol' } }; },
  });
  _setScribeMemoryCacheForTest('p1', []);
  assert(getPlayerProfile('p1').roastTolerance === null, 'a player who has never set one has NO tolerance value — never an invented default');

  const set = await scribeFileSetTolerance('no_limits');
  assert(set.ok === true && upserts.length === 1 && upserts[0].kind === 'roastTolerance',
    "setting tolerance writes a memory row of kind 'roastTolerance' (schema-present; nothing consumes it yet, per the DI)");
  assert(getPlayerProfile('p1').roastTolerance === 'no_limits', 'and it reads straight back out of the profile');
  assert(/class="scribe-tolerance-opt selected" data-tolerance="no_limits"/.test(renderScribeFileBodyHTML({ profile: getPlayerProfile('p1') })),
    'and the control renders the stored value as selected');

  await scribeFileSetTolerance('light');
  assert(upserts[1].key === upserts[0].key && getPlayerProfile('p1').roastTolerance === 'light',
    'changing it REPLACES the single row (same upsert key), never stacks a second');
  const bogus = await scribeFileSetTolerance('savage');
  assert(bogus.skipped === 'unknown_value' && upserts.length === 2, 'an option that is not one of the three is refused, not stored');
  _restoreScribeMemoryTransportForTest();
}

// ═════════════════════════════════════════════════════════════════════════
// 9. E1 attribution-leak precedent — no other player's rows ever render
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[9] DI-D4 — structural: another player\'s file never reaches this screen…');
{
  const LEAK = 'BRAYDENS-PRIVATE-STRING';
  _setScribeMemoryCacheForTest('p1', [
    memRow({ id: 'mine', key: 'job', value: 'my own row' }),
    memRow({ id: 'theirs1', playerId: 'p2', key: 'job', value: LEAK }),
    memRow({ id: 'theirs2', playerId: 'p2', kind: 'hardline', key: 'topic:x', value: LEAK + '-HARDLINE' }),
    memRow({ id: 'theirs3', playerId: 'p3', kind: 'roastTolerance', key: 'roastTolerance', value: 'no_limits' }),
  ]);
  const profile = getPlayerProfile('p1');
  const html = renderScribeFileBodyHTML({ profile });
  assert(!html.includes(LEAK), 'no value belonging to another player appears anywhere in the rendered output');
  assert(!html.includes('theirs1') && !html.includes('theirs2') && !html.includes('theirs3'),
    'not even as a row id — the filter happens before render, not in CSS');
  assert(profile.facts.length === 1 && profile.hardlines.length === 0 && profile.roastTolerance === null,
    'getPlayerProfile() itself narrows to the subject player — the render function is handed nothing to leak');
  const cached = app._scribeMemoryCacheForTest();
  assert(cached.rows.length === 4,
    'fixture check: the cache really did hold three foreign rows, so the assertions above are not vacuous');

  // The refresh path filters too, even if the server answers with more.
  _wireScribeMemoryTransportForTest({
    async list() { return { ok: true, records: [memRow({ id: 'ok', key: 'job', value: 'mine' }), memRow({ id: 'bad', playerId: 'p2', value: LEAK })] }; },
  });
  await refreshScribeMemory('p1');
  assert(!app._scribeMemoryCacheForTest().rows.some(r => r.playerId !== 'p1'),
    "a server response containing another player's row is dropped at the client too — defense in depth, because the server's own check is best-effort");
  _restoreScribeMemoryTransportForTest();
}

// ═════════════════════════════════════════════════════════════════════════
// 10. DI-D3 — profile shape + stats come from the SAME scoring functions
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[10] DI-D3 — profile is well-formed and its stats are the Standings page\'s own…');
{
  _setScribeMemoryCacheForTest('p1', []);
  const bare = getPlayerProfile('p1', { withStats: true });
  assert(bare && typeof bare === 'object' && !Array.isArray(bare), 'a player with zero memory rows returns an object, never undefined and never a throw');
  assert(Array.isArray(bare.facts) && Array.isArray(bare.relations) && Array.isArray(bare.hardlines),
    'every collection is an array, empty rather than missing (no-fabrication guard: absent is absent)');
  assert(bare.episodes === undefined,
    'item 7: the unrendered `episodes` array is gone — the jump affordance reads row.sourceMessageId directly, so nothing computes a collection nobody displays');
  assert(bare.roastTolerance === null && bare.isEmpty === true, 'and the scalar fields read null/true rather than an invented placeholder');
  assert(bare.preferences.chatNick === 'Commish' && bare.preferences.theme === 'maroon',
    'player.preferences.* is carried through from the PLAYER record (CLAUDE.md architecture bullet 4), not re-derived');
  const unknown = getPlayerProfile('nobody', { withStats: true });
  assert(unknown.stats === null && unknown.displayName === '' && unknown.isEmpty === true,
    'an unknown playerId produces an empty, well-formed profile rather than throwing');

  // Real weekly results so the standings have something to compute from.
  storage.saveWeek({ weekId: 'w1', weekNumber: 1, season: '2026', status: 'final', showInHistory: true });
  storage.saveAllWeeklyResults('w1', [
    { weekId: 'w1', playerId: 'p1', displayName: 'Drew', correctPicks: 7, incorrectPicks: 2, correctCount: 6, incorrectCount: 2, noDecisions: 0, isWinner: true, isLoser: false, rank: 1 },
    { weekId: 'w1', playerId: 'p2', displayName: 'Brayden', correctPicks: 3, incorrectPicks: 5, correctCount: 3, incorrectCount: 5, noDecisions: 0, isWinner: false, isLoser: true, rank: 2 },
    { weekId: 'w1', playerId: 'p3', displayName: 'Kevin', correctPicks: 5, incorrectPicks: 3, correctCount: 5, incorrectCount: 3, noDecisions: 0, isWinner: false, isLoser: false, rank: 3 },
  ]);
  const players = storage.getPlayers().filter(p => p.active);
  const weeksRaw = storage.getWeeks();
  const visible = new Set(weeksRaw.filter(w => w.showInHistory !== false && w.dataSourceMode !== 'demo').map(w => w.weekId));
  const direct = scoring.calculateSeasonStandings(players, storage.getWeeklyResults().filter(r => visible.has(r.weekId)), weeksRaw);
  const viaHelper = seasonStandingsRows();
  assert(JSON.stringify(viaHelper) === JSON.stringify(direct),
    'seasonStandingsRows() is byte-identical to calculateSeasonStandings() called the way the Standings page calls it — one computation, not two (CONVENTIONS #21)');
  const mine = direct.find(r => r.playerId === 'p1');
  const profStats = getPlayerProfile('p1', { withStats: true }).stats;
  assert(getPlayerProfile('p1').stats === null && getPlayerProfile('p1').statsIncluded === false,
    'item 7: stats are LAZY — the default profile (what the modal asks for, and it renders no stats) computes none, and says so via statsIncluded');
  assert(getPlayerProfile('p1', { withStats: true }).statsIncluded === true,
    'item 7: …and a caller that asks for them gets them, flagged as included, so "not asked for" is never mistaken for "no standings row"');
  assert(JSON.stringify(profStats) === JSON.stringify(mine),
    "the profile's stat block IS the player's standings row object — identical output, never independently recomputed");
  assert(profStats.totalCorrect === 7 && profStats.totalCorrectCount === 6,
    'and it keeps BOTH tallies distinct — weighted 7 for ranking, raw 6 for audit (CONVENTIONS #22)');
  assert(profStats.winPct === scoring.calculateSeasonStandings(players, storage.getWeeklyResults().filter(r => visible.has(r.weekId)), weeksRaw).find(r => r.playerId === 'p1').winPct,
    'win% comes from the raw counts the scoring module computes, not a second ratio');
  {
    const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function getPlayerProfile'), src.indexOf('// ── Product-language labels'));
    assert(/seasonStandingsRows\(\)/.test(fn) && !/correctPicks|winPct\s*=/.test(fn),
      '[structural] getPlayerProfile() delegates every stat to seasonStandingsRows() — it computes no pick math of its own');
  }
}

// ═════════════════════════════════════════════════════════════════════════
// 11. DI-D1 — the detector call sites
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[11] DI-D1 — the (one) detector call site: blind rule, standings before/after, idempotency…');
{
  _resetScribeWeekSignalLedgerForTest();
  // RAW counts chosen to cross exactly one MILESTONE_MARK (25) for p1 and
  // none for p2 — weighted totals move too, and the two must not be confused
  // (CONVENTIONS #22: a milestone is "you were right 25 times," a count of
  // games, never a score).
  assert(scribeLines.MILESTONE_MARKS.includes(25), 'fixture check: 25 really is a milestone mark');
  const before = [
    { playerId: 'p2', displayName: 'Brayden', totalCorrect: 40, totalCorrectCount: 24, currentRank: 1 },
    { playerId: 'p1', displayName: 'Drew', totalCorrect: 38, totalCorrectCount: 23, currentRank: 2 },
  ];
  const after = [
    { playerId: 'p1', displayName: 'Drew', totalCorrect: 45, totalCorrectCount: 27, currentRank: 1 },
    { playerId: 'p2', displayName: 'Brayden', totalCorrect: 40, totalCorrectCount: 24, currentRank: 2 },
  ];

  // Blind rule first — a LOCKED week is not yet public (arePicksPublic is
  // live/final), which is exactly why F2 removed the lock-phase call site:
  // the function still refuses to read the field, and a call that can only
  // ever skip is worse than no call at all.
  const lockedWeek = { weekId: 'wS', weekNumber: 9, season: '2026', status: 'locked', finalizedAt: null };
  const blind = fireScribeWeekSignals(lockedWeek, { phase: 'lock' });
  assert(blind.fired === false && blind.skipped === 'picks_blind',
    'THE BLIND RULE: with picks not yet public, the function reads nobody\'s picks and detects nothing (arePicksPublic(), the app\'s ONE definition)');
  assert(_scribeWeekSignalLedgerForTest().length === 0,
    'and it does NOT mark the week done — a week that is not yet public is still evaluated once it is');

  const finalWeek = { weekId: 'wS', weekNumber: 9, season: '2026', status: 'final', finalizedAt: new Date().toISOString() };
  const r1 = fireScribeWeekSignals(finalWeek, { phase: 'final', standingsBefore: before, standingsAfter: after });
  assert(r1.fired === true, 'a freshly finalized, public week IS evaluated');
  assert(r1.detected.some(s => s.signal === 'chartLeadChange' && s.subject === 'p1'),
    'STANDINGS BEFORE/AFTER genuinely reach the detectors — the lead change from Brayden to Drew is detected, which is only possible from both snapshots');
  assert(r1.detected.some(s => s.signal === 'milestone' && s.evidence.milestone === 25 && s.evidence.playerId === 'p1'),
    'and a RAW-count milestone crossed between the two snapshots is detected too (23 → 27 crosses 25)');
  assert(!r1.detected.some(s => s.signal === 'milestone' && s.evidence.playerId === 'p2'),
    'while a player who crossed nothing gets no milestone — the guard is the crossing, not the total');

  const r2 = fireScribeWeekSignals(finalWeek, { phase: 'final', standingsBefore: before, standingsAfter: after });
  assert(r2.fired === false && r2.skipped === 'already_fired' && r2.detected.length === 0,
    'IDEMPOTENT: the same week+phase never evaluates twice on this device — the ledger, not the cooldown, is what survives a reload');
  const led = _scribeWeekSignalLedgerForTest();
  assert(led.includes('wS|final'), 'the ledger records the (week, phase) that was evaluated');
  assert(led.length === 1 && !led.some(k => k.split('|').length > 2),
    'item 8: PHASE KEYS ONLY — the per-signal entries nothing ever read are gone, so the bounded 200-entry list is not spent on them');

  // A recompute of an OLD week is not news.
  _resetScribeWeekSignalLedgerForTest();
  const oldWeek = { weekId: 'wOld', weekNumber: 1, season: '2026', status: 'final', finalizedAt: '2026-08-01T00:00:00.000Z' };
  const stale = fireScribeWeekSignals(oldWeek, { phase: 'final', standingsBefore: before, standingsAfter: after });
  assert(stale.fired === false && stale.skipped === 'stale_finalize',
    "Comm→Data's retroactive recalculation stays silent — a week finalized weeks ago is a recompute, not news");

  // Demo weeks never speak.
  _resetScribeWeekSignalLedgerForTest();
  const demo = fireScribeWeekSignals({ weekId: 'wD', status: 'final', dataSourceMode: 'demo', finalizedAt: new Date().toISOString() }, { phase: 'final' });
  assert(demo.fired === false && demo.skipped === 'demo', 'a DEMO week never produces a SCRIBE signal (v0.17.0 rule, applied here too)');

  // ── F1 (reviewer BLOCK) — THE POISONED LEDGER ────────────────────────
  // finalizeWeek() is NOT called only from the final transition: "Calculate
  // ATS" and the manual-score promote path both call it on a LIVE week whose
  // finalizedAt is still null. The old combined freshness test read that NaN
  // as "too old," wrote the ledger, and the genuine finalize minutes later
  // returned already_fired — the feature silently never ran for that week.
  _resetScribeWeekSignalLedgerForTest();
  const liveWeek = { weekId: 'wF1', weekNumber: 12, season: '2026', status: 'live', finalizedAt: null };
  const notYet = fireScribeWeekSignals(liveWeek, { phase: 'final', standingsBefore: before, standingsAfter: after });
  assert(notYet.fired === false && notYet.skipped === 'not_final_yet',
    'F1: a LIVE week with finalizedAt:null is "not final yet" — a distinct outcome from "stale," not a silent skip');
  assert(_scribeWeekSignalLedgerForTest().length === 0,
    'F1: and it writes NOTHING to the ledger — this is the regression: the pre-final call must not consume the week\'s one evaluation');
  const realFinal = fireScribeWeekSignals({ ...liveWeek, status: 'final', finalizedAt: new Date().toISOString() },
    { phase: 'final', standingsBefore: before, standingsAfter: after });
  assert(realFinal.fired === true && realFinal.detected.some(s => s.signal === 'chartLeadChange'),
    'F1: …so the REAL finalize that follows still fires, with its signals intact');
  assert(_scribeWeekSignalLedgerForTest().includes('wF1|final'), 'F1: and only then is the week marked evaluated');

  // The real finalize path reaches it.
  _resetScribeWeekSignalLedgerForTest();
  storage.saveWeek({ weekId: 'wLive', weekNumber: 11, season: '2026', status: 'final', showInHistory: true, finalizedAt: new Date().toISOString() });
  app.finalizeWeek(storage.getWeek('wLive'));
  assert(_scribeWeekSignalLedgerForTest().includes('wLive|final'),
    'THE CALL SITE IS REALLY WIRED: running the app\'s own finalizeWeek() marks the week evaluated (asserted through behaviour, not a source grep)');
  // …and the same function on a not-yet-final week leaves the ledger clean.
  _resetScribeWeekSignalLedgerForTest();
  storage.saveWeek({ weekId: 'wMid', weekNumber: 13, season: '2026', status: 'live', showInHistory: true });
  app.finalizeWeek(storage.getWeek('wMid'));
  assert(_scribeWeekSignalLedgerForTest().length === 0,
    'F1 end-to-end: calling the app\'s own finalizeWeek() on a LIVE week (the "Calculate ATS" path) writes no ledger entry at all');
  {
    const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function finalizeWeek'), src.indexOf('export function finalizeWeek') + 6000);
    assert(/const scribeStandingsBefore=seasonStandingsRows\(\);/.test(fn),
      '[structural] "before" is captured at the TOP of finalizeWeek, ahead of saveAllWeeklyResults() — there is no second chance to read it');
    assert(fn.indexOf('const scribeStandingsBefore') < fn.indexOf('saveAllWeeklyResults(week.weekId,results)'),
      '[structural] …and provably before that WRITE CALL (not the comment that mentions it), so "before" is genuinely before');
    assert(/standingsAfter: seasonStandingsRows\(\)/.test(fn),
      '[structural] "after" is read at the call site, once the results have landed — two genuine snapshots of the same function');
    assert((src.match(/\n\s*fireScribeWeekSignals\(/g) || []).length === 1,
      '[structural] F2: there is exactly ONE call site in app.js — the finalize one. The lock-phase call the DI originally specified is removed, not merely inert');
    const lockFn = src.slice(src.indexOf('export function applyWeekStatusChange'), src.indexOf('export function applyWeekStatusChange') + 6000);
    assert(!/fireScribeWeekSignals\(/.test(lockFn),
      '[structural] F2: applyWeekStatusChange no longer calls it — a call site that could never fire read as coverage it did not provide');
  }
  _resetScribeWeekSignalLedgerForTest();
}

// ═════════════════════════════════════════════════════════════════════════
// 12. DI-D2 — approve → sync, exactly once
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[12] DI-D2 — approving a fact candidate applies it to SCRIBE\'s memory…');
{
  const syncs = [];
  _wireScribeMemoryTransportForTest({ async sync(args) { syncs.push(args); return { ok: true, applied: 1 }; } });
  storage.setScribeLearnings([
    { kind: 'fact_candidate', playerId: 'p1', key: 'job', value: 'started a new job', confidence: 0.6, status: 'pending' },
    { kind: 'learning', category: 'tone', instruction: 'be drier', confidence: 0.95, status: 'pending' },
  ]);

  const rejected = applyScribeLearningDecision(0, false);
  assert(rejected.ok === true && rejected.synced === false && syncs.length === 0,
    'REJECTING a fact candidate syncs nothing — only an approval has anything to apply');
  assert(storage.getScribeLearnings()[0].status === 'rejected', 'and the status flip itself persisted through the seam');

  const approved = applyScribeLearningDecision(0, true);
  assert(approved.ok === true && approved.synced === true, 'APPROVING a fact candidate reports that it triggered the sync');
  assert(syncs.length === 1, 'the scribeMemorySync action fires EXACTLY once per approval, never twice');
  assert(storage.getScribeLearnings()[0].status === 'approved', 'and the row is approved in the learnings list');

  const learning = applyScribeLearningDecision(1, true);
  assert(learning.synced === false && syncs.length === 1,
    'approving a LEARNING (not a fact candidate) fires no sync — nothing about it belongs in the memory sheet');

  _wireScribeMemoryTransportForTest({ async sync() { return { ok: false, error: 'nope' }; } });
  const failed = await syncApprovedScribeFacts();
  assert(failed.ok === false, 'a refused sync surfaces as a failure rather than a silent success (the approval itself already persisted)');
  _restoreScribeMemoryTransportForTest();
}

// ═════════════════════════════════════════════════════════════════════════
// 13. Structural — the seam, and the transport defaults
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[13] Structural — memory rows never enter the KV seam; the defaults are the real relays…');
{
  // UN-237/238 (DI-260, 2026-09-23) — THESE USED TO NAME js/backend.js's FOUR
  // `scribeMemory*Remote` RELAYS. Those relays pointed at Apps Script actions
  // the post-cutover allow-list refused, which is the failure Drew reported;
  // they are now deleted and the defaults are the Supabase adapter's own calls.
  // The assertion's JOB is unchanged and is the reason it is by IDENTITY rather
  // than by name: a stub in this file can never be mistaken for the app's
  // wiring, and a default that silently reverted to a look-alike would pass
  // every behavioural test in this suite.
  const sbAdapter = await import('./js/supabase-backend.js');
  const defaults = _scribeMemoryTransportDefaultsForTest();
  assert(defaults.list === sbAdapter.scribeMemoryList, 'the default list transport IS js/supabase-backend.js\'s scribeMemoryList — a stub in this file can never be mistaken for the app\'s wiring');
  assert(defaults.upsert === sbAdapter.scribeMemoryUpsert, 'the default upsert transport IS sb.scribeMemoryUpsert');
  assert(defaults.remove === sbAdapter.scribeMemoryDelete, 'the default delete transport IS sb.scribeMemoryDelete');
  assert(defaults.sync === sbAdapter.scribeMemoryApply, 'the default sync transport IS sb.scribeMemoryApply — the rename is deliberate: the sweep is `scribe_memory_apply(p_league)` now, and no credential is sent because the RPC derives the commissioner from the JWT');

  const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const start = src.indexOf('// ═══ BUILD 3, GROUP D pass 2');
  const end = src.indexOf('// ─── PICK PERMISSION');
  const section = src.slice(start, end);
  assert(start > 0 && end > start && section.length > 4000, `fixture check: the Group D section was located in app.js (${section.length} chars)`);
  const code = section.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert(!/\b(save|load)\(KEYS\./.test(code) && !/KEYS\.SCRIBE_MEMORY/.test(code),
    'DI-D2: memory rows never go through load()/save() — they live in their own sheet precisely so a row can be physically deleted');
  assert(!/localStorage/.test(code),
    'and the memory surface touches localStorage nowhere (AD-02) — the only device-local write in this build is the week-signal ledger, which is elsewhere and deliberate');

  const storageSrc = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
  const keysBlock = storageSrc.slice(storageSrc.indexOf('const KEYS'), storageSrc.indexOf('const KEYS') + 2600)
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert(/SETTINGS:/.test(keysBlock), 'fixture check: the KEYS block really was located and still holds its real entries');
  assert(!/^\s*\w*MEMORY\w*\s*:/im.test(keysBlock),
    'no new KV key was added for SCRIBE memory (same structural check E2 ran for feedback — the storage seam is untouched by this feature)');

  const backendSrc = await readFile(new URL('./js/backend.js', import.meta.url), 'utf8');
  const noRetry = backendSrc.slice(backendSrc.indexOf('const NO_RETRY_ACTIONS'), backendSrc.indexOf('const NO_RETRY_ACTIONS') + 200);
  assert(!/scribeMemory/.test(noRetry),
    'the four memory actions are deliberately NOT on NO_RETRY_ACTIONS — none spends money and each is idempotent, so a flaky Apps Script redirect leg is retried like every other read/write');
}

// ═════════════════════════════════════════════════════════════════════════
// 14. FEAT-5 (UN-202 / UN-203, DI-202) — the UI half of wager memory.
//     RENDERED OUTPUT, never a source grep (RG-27): a source-grep test passes
//     when the guard it claims to protect is reverted.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[14] FEAT-5 — 🤝 wager memory: action, modal, ack controls, ⭐ suppressions, file rows…');
{
  const { _messageHTMLForTest, _wagerActionHTMLForTest, _wagerAckHTMLForTest } = chatUi;
  const { renderWagerModalBodyHTML, buildWagerValue, wagerReviewAtFor, wagerSettleWeeks,
          _setWagerCacheForTest, scribeWagerAnswer } = app;
  const msg = (o = {}) => ({ id: 'm_claim', type: 'message', author: 'p2', gameTag: '', ts: Date.now(),
                             body: 'I bet USC is not ranked by week 7', reactions: {}, meta: null, ...o });

  // ── 8. THE 🤝 ACTION (DI-202a). ──
  const human = _messageHTMLForTest(msg(), 'p1', false);
  assert(/data-wager="m_claim"/.test(human) && human.includes('🤝'),
    '14-1: 🤝 renders in .chat-actions on an ordinary human message for a signed-in viewer');
  assert(human.indexOf('data-wager=') > human.indexOf('data-reply='),
    '14-2: …among the "do something durable with this" controls (after reply/react), not ahead of them');
  assert(!/title=/.test(_wagerActionHTMLForTest(msg(), 'p1')),
    '14-3: …with NO title attribute — tooltips do not fire on touch, which is the only input this app has');
  assert(/aria-label="Log this as a wager"/.test(_wagerActionHTMLForTest(msg(), 'p1')),
    '14-4: …and the meaning is carried by aria-label instead');
  assert(_wagerActionHTMLForTest(msg({ author: 'scribe' }), 'p1') === '',
    '14-5: ABSENT on a SCRIBE message — you cannot log SCRIBE into a bet');
  assert(_wagerActionHTMLForTest(msg({ author: 'system' }), 'p1') === '',
    '14-6: ABSENT on a system message');
  assert(_wagerActionHTMLForTest(msg({ deleted: true }), 'p1') === '',
    '14-7: ABSENT on a withdrawn message — its text is a tombstone, not evidence');
  assert(_wagerActionHTMLForTest(msg(), '') === '',
    '14-8: ABSENT signed out — a signed-out reader gets no dead control (the persistentStarHTML precedent)');
  assert(!/data-wager="/.test(_messageHTMLForTest(msg({ author: 'scribe' }), 'p1', false)),
    '14-9: …and the absence holds through the REAL messageHTML(), not just the helper in isolation');

  // ── 9. THE MODAL (DI-202b), every field and its exact copy. ──
  const wk = (n, id) => ({ weekId: id, season: '2026', weekNumber: n, label: `Week ${n}`,
                           startDate: `2026-10-0${n}`, endDate: `2026-10-0${n}`, status: 'draft', dataSourceMode: 'espn' });
  const WEEKS14 = [wk(5, 'wk5'), wk(6, 'wk6'), wk(7, 'wk7')];
  const modal = renderWagerModalBodyHTML({ message: msg(), players: storage.getPlayers(), weeks: WEEKS14, currentWeek: WEEKS14[0] });
  assert(modal.includes('The claim') && modal.includes('chat-quote-static') && modal.includes('I bet USC is not ranked by week 7'),
    '14-10: field 1 — the source message is quoted read-only, with chat\'s OWN quote markup (it is evidence, not an editable field)');
  assert(/<textarea[^>]*id="wager-claim"[^>]*maxlength="110"/.test(modal) && modal.includes('/110'),
    '14-11: field 2 — the bet is a 110-char textarea with a live counter');
  assert(modal.includes('Keep it short. SCRIBE reads this back later.'),
    '14-12: …carrying its helper line (one character off DI-202b verbatim — see the note at WAGER_COPY.betHelp)');
  assert(modal.includes("Who's on the other side?") && /<option value="" selected>Open to the room<\/option>/.test(modal),
    '14-13: field 3 — the counterparty select DEFAULTS to "Open to the room"');
  assert(!/<option value="p2"/.test(modal) && /<option value="p1"/.test(modal) && /<option value="p3"/.test(modal),
    '14-14: …and the claim\'s own author is excluded from it — a man cannot be his own counterparty');
  assert(modal.includes('Settle by') && /<option value="wk6" selected>/.test(modal),
    '14-15: field 4 — Settle by defaults to the NEXT week, not the current one');
  assert(modal.includes('>End of the season</option>') && /<option value="wk7">End of the season<\/option>/.test(modal),
    '14-16: …with a final "End of the season" option resolving to the highest-numbered eligible week');
  assert(!/wk5"/.test(modal.split('id="wager-week"')[1].split('</select>')[0]) === false,
    '14-17: fixture check — the Settle-by list really was extracted from the emitted markup');
  assert(/id="wager-cancel"[^>]*>Cancel</.test(modal) && /id="wager-log"[^>]*>Log it</.test(modal),
    '14-18: Cancel and Log it, with the approved labels');
  assert(/class="btn btn-ghost wager-btn"/.test(modal) && /class="btn btn-primary wager-btn"/.test(modal),
    '14-19: …both carrying .wager-btn, which is where the 44px floor lives');
  const cssSrc14 = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
  const rule14 = name => (cssSrc14.match(new RegExp('^\\' + name + '\\{[^}]*\\}', 'm')) || [''])[0];
  assert(/min-height:44px/.test(rule14('.wager-btn')) && /min-height:44px/.test(rule14('.chat-wager-ack')) && /min-height:44px/.test(rule14('.wager-select')),
    '14-20: every control in this feature carries a SCOPED 44px override — .btn-sm bases at 34px and is never raised globally');
  assert(!/#[0-9A-Fa-f]{3,8}\b/.test(rule14('.wager-btn') + rule14('.chat-wager-ack') + rule14('.chat-wager-row') + rule14('.wager-error')),
    '14-21: no hex literal in any new rule — colour comes from :root tokens, so all seven themes are covered for free');

  // The 200-char PRE-SEND assertion. A slice landing mid-JSON is unparseable
  // forever (memorytest 28-18 proves the server really does slice), so this is
  // checked BEFORE the request leaves the device.
  const longIds = buildWagerValue({ claim: '"'.repeat(110), counterpartyId: 'p'.repeat(20),
                                    weekId: 'w'.repeat(24), loggedBy: 'q'.repeat(20) });
  assert(!!longIds && longIds.length <= 200,
    `14-22: the SERIALISED envelope is guaranteed ≤200 chars even with a fully JSON-escaped 110-char claim and 64 chars of ids (got ${longIds ? longIds.length : 'null'})`);
  let reparsed = null;
  try { reparsed = JSON.parse(longIds); } catch { reparsed = null; }
  assert(!!reparsed && reparsed.o === 'p'.repeat(20) && reparsed.w === 'w'.repeat(24),
    '14-23: …and it still parses, with the ids intact — the claim is what gives way, never the envelope');
  assert(wagerReviewAtFor({ endDate: '2026-10-11' }) === new Date('2026-10-11T23:59:59').toISOString()
      && wagerReviewAtFor({ startDate: '', endDate: '' }) === '',
    '14-24: reviewAt is the due week\'s own date; a week with NO date yields \'\' and is excluded from Settle-by entirely, because a wager that can never resurface must not be loggable');
  assert(wagerSettleWeeks([...WEEKS14, wk(8, 'wkdemo')].map(w => w.weekId === 'wkdemo' ? { ...w, dataSourceMode: 'demo' } : w), WEEKS14[0])
          .every(w => w.weekId !== 'wkdemo'),
    '14-25: a demo week is never offered as a settle-by target');

  // ── 10. THE ACK CONTROLS (DI-202f viewer table). ──
  const logged = (o = {}) => ({ id: 'scribe_wager_w1', type: 'message', author: 'scribe', gameTag: '', ts: Date.now(),
    body: 'Logged. Brayden against Kevin, due by Week 7.', reactions: {},
    meta: { kind: 'wagerLogged', wagerId: 'w1', dueWeekId: 'wk7', counterpartyId: 'p3', proposerId: 'p2', source: 'tier0' }, ...o });
  _setWagerCacheForTest([]);
  assert(/data-wager-ack="accepted"/.test(_wagerAckHTMLForTest(logged(), 'p3')) && /data-wager-ack="declined"/.test(_wagerAckHTMLForTest(logged(), 'p3')),
    '14-26: the NAMED COUNTERPARTY with no answer yet gets both controls');
  assert(_wagerAckHTMLForTest(logged(), 'p3').includes("🤝 I'm in") && _wagerAckHTMLForTest(logged(), 'p3').includes("🙅 I'm not"),
    '14-27: …with the exact approved copy');
  assert(_wagerAckHTMLForTest(logged(), 'p2').includes('Waiting on Kevin.') && !/data-wager-ack/.test(_wagerAckHTMLForTest(logged(), 'p2')),
    '14-28: the PROPOSER gets no buttons and the waiting line instead — he cannot take his own bet');
  assert(_wagerAckHTMLForTest(logged(), 'p1').includes('Waiting on Kevin.') && !/data-wager-ack/.test(_wagerAckHTMLForTest(logged(), 'p1')),
    '14-29: a THIRD PARTY gets the same muted waiting line and no controls');
  assert(_wagerAckHTMLForTest(logged(), '') === '',
    '14-30: SIGNED OUT gets neither a control nor a waiting line');
  const openRoom = logged({ meta: { ...logged().meta, counterpartyId: '' } });
  assert(/data-wager-ack="accepted"/.test(_wagerAckHTMLForTest(openRoom, 'p1')) && /data-wager-ack="accepted"/.test(_wagerAckHTMLForTest(openRoom, 'p3')),
    '14-31: OPEN TO THE ROOM — any signed-in player may answer (coordinator ruling Q9)');
  assert(_wagerAckHTMLForTest(openRoom, 'p2').includes('Open to the room.') && !/data-wager-ack/.test(_wagerAckHTMLForTest(openRoom, 'p2')),
    '14-32: …except the proposer, who still gets the muted line');
  _setWagerCacheForTest([{ id: 'mem_ack', playerId: 'p3', kind: 'wager', key: 'wagerack:w1',
                           value: JSON.stringify({ w: 'w1', r: 'accepted' }), provenance: 'player-stated', confidence: 1 }]);
  assert(scribeWagerAnswer('w1')?.reply === 'accepted' && scribeWagerAnswer('w1')?.playerId === 'p3',
    '14-33: the answer is derived from the counterparty-owned `wagerack:` row — attested by the man who accepted, not asserted by the man who benefits');
  assert(_wagerAckHTMLForTest(logged(), 'p3').includes('You&#39;re in.') && !/data-wager-ack/.test(_wagerAckHTMLForTest(logged(), 'p3')),
    '14-34: after answering, the buttons are replaced IN PLACE by a static line — one action, one message, no second chat post');
  _setWagerCacheForTest([{ id: 'mem_ack', playerId: 'p3', kind: 'wager', key: 'wagerack:w1',
                           value: JSON.stringify({ w: 'w1', r: 'declined' }), provenance: 'player-stated', confidence: 1 }]);
  assert(_wagerAckHTMLForTest(logged(), 'p3').includes('You passed.'),
    '14-35: …and a decline reads "You passed." — declining is not a character flaw');
  _setWagerCacheForTest([]);
  assert(scribeWagerAnswer('w1') === null,
    '14-36: AD-49 — with the ack row deleted the answer is gone and the status reverts to SILENT, because the record of acceptance was withdrawn');

  // ── 11. THE TWO ⭐ SUPPRESSIONS, asserted SEPARATELY (DI-202f). ──
  const ordinary = _messageHTMLForTest({ id: 'sc_1', type: 'message', author: 'scribe', gameTag: '', ts: Date.now(),
    body: 'An ordinary SCRIBE line.', reactions: {}, meta: null }, 'p1', false);
  assert(/data-fb-open="sc_1"/.test(ordinary) && /chat-fb-star/.test(ordinary),
    '14-37: fixture check — an ORDINARY SCRIBE message renders BOTH ⭐ affordances, so the two assertions below are not vacuous');
  const loggedHTML = _messageHTMLForTest(logged(), 'p1', false);
  const dueHTML = _messageHTMLForTest({ id: 'scribe_wagerdue_w1', type: 'message', author: 'scribe', gameTag: '',
    ts: Date.now(), body: 'Week 7. Brayden said "…".', reactions: {}, meta: { kind: 'wagerDue', wagerId: 'w1', status: 'silent' } }, 'p1', false);
  assert(!/chat-act-feedback/.test(loggedHTML) && !/chat-act-feedback/.test(dueHTML),
    '14-38: suppression 1 of 2 — neither wager post renders ⭐ Rate in .chat-actions (feedbackButtonHTML)');
  assert(!/chat-fb-star/.test(loggedHTML) && !/chat-fb-star/.test(dueHTML),
    '14-39: suppression 2 of 2 — and neither renders the persistent ⭐ in the bubble footer either (persistentStarHTML). Fixing one and not the other is the exact failure shape the retention filter had');

  // ── 12. MY SCRIBE FILE (DI-202k). ──
  const wagerRow = { id: 'mem_w1', playerId: 'p1', kind: 'wager', key: 'wager:w1',
    value: JSON.stringify({ c: 'USC is not ranked by week 7', o: 'p3', w: 'wk7', b: 'p2' }),
    provenance: 'player-stated', confidence: 1, createdAt: '2026-09-12T00:00:00.000Z',
    reviewAt: '2026-10-11T23:59:59.000Z', sourceMessageId: 'm_claim' };
  const ackRow = { ...wagerRow, id: 'mem_a1', key: 'wagerack:w1', sourceMessageId: 'scribe_wager_w1',
    value: JSON.stringify({ w: 'w1', r: 'accepted' }) };
  const brokenRow = { ...wagerRow, id: 'mem_w2', key: 'wager:w2', value: '{"c":"half a row' };
  storage.saveWeek({ ...wk(7, 'wk7'), weekId: 'wk7' });
  _setScribeMemoryCacheForTest('p1', [wagerRow, ackRow, brokenRow]);
  const fileHTML = renderScribeFileBodyHTML({ profile: getPlayerProfile('p1') });
  const wagerCard = rowHTMLById(fileHTML, 'mem_w1');
  assert(wagerCard.includes('Wager') && !wagerCard.includes('Wager — your answer'),
    '14-40: a proposer row is labelled "Wager"');
  assert(wagerCard.includes('USC is not ranked by week 7') && wagerCard.includes('with Kevin') && wagerCard.includes('settle by Week 7'),
    '14-41: …and its value reads back in plain language: the claim, who is on the other side, and the deadline');
  assert(wagerCard.includes('data-mem-del="mem_w1"') && wagerCard.includes('🗑'),
    '14-42: …and it keeps its 🗑 — provenance is player-stated, never computed, which is the half of AD-49 that has to hold');
  assert(wagerCard.includes('data-jump="m_claim"'),
    '14-43: …and sourceMessageId gives "↩ Jump to the message" with no new code');
  assert(rowHTMLById(fileHTML, 'mem_a1').includes('Wager — your answer') && rowHTMLById(fileHTML, 'mem_a1').includes('Accepted'),
    '14-44: the counterparty-owned ack row is labelled "Wager — your answer"');
  const brokenCard = rowHTMLById(fileHTML, 'mem_w2');
  assert(brokenCard.includes('{&quot;c&quot;:&quot;half a row') && brokenCard.includes('data-mem-del="mem_w2"'),
    '14-45: a row whose JSON cannot be parsed falls back to the RAW STORED STRING and stays deletable — the headToHead precedent, verbatim, rather than guessing at a value');
  assert(fileHTML.includes("Wagers you've logged live here too. Delete one and SCRIBE forgets it."),
    '14-46: the approved footnote sentence renders in the file, where the wager rows actually are');
  assert(getPlayerProfile('p1').wagers.length === 3 && getPlayerProfile('p3').wagers.length === 0,
    '14-47: the profile carries ONLY the viewer\'s own wager rows — the league-wide read the resurfacing path needs never reaches this screen (DI-202l)');
  // ── 12b. logWager()/answerWager() — DI-202l's write states, through the REAL
  //        functions and the REAL transport seam. ──
  const chat14 = await import('./js/chat.js');
  const backend14 = await import('./js/backend.js');
  chat14._resetForTest?.();
  chat14.ingest?.([{ seq: 1, id: 'm_claim', ts: Date.now(), type: 'message', author: 'p2', gameTag: '',
                     body: 'I bet USC is not ranked by week 7', targetId: '', replyTo: '', meta: null }]);
  storage.saveWeek({ ...wk(7, 'wk7'), status: 'draft' });
  storage.saveSetting('chatEnabled', true);
  storage.setSession('p1', false, true);
  _setWagerCacheForTest([]);
  _setScribeMemoryCacheForTest('p1', []);

  // Offline: the memory write goes STRAIGHT to Apps Script — there is no outbox
  // behind it — so the copy must not pretend there is a queue (AD-06).
  backend14.setDataMode('sheets');
  const offline = await app.logWager({ messageId: 'm_claim', claim: 'USC is not ranked', counterpartyId: 'p3', dueWeekId: 'wk7' });
  assert(offline.ok === false && offline.skipped === 'offline'
      && offline.message === "Not connected — a wager can't be logged right now.",
    '14-48: backend unreachable -> the write is REFUSED with the honest line. A memory write has no durable outbox, and the copy must not imply one (AD-06)');
  backend14.setDataMode('supabase');

  // Server rejects (e.g. Apps Script not yet redeployed: unknown kind "wager").
  let sent = null;
  _wireScribeMemoryTransportForTest({ upsert: async () => ({ ok: false, error: 'scribeMemoryUpsert: unknown kind "wager"' }),
                                      list: async () => ({ ok: true, records: [] }) });
  const rejected = await app.logWager({ messageId: 'm_claim', claim: 'USC is not ranked', counterpartyId: 'p3', dueWeekId: 'wk7' });
  assert(rejected.ok === false && rejected.message === "Couldn't log that wager — nothing was saved. Try again.",
    '14-49: a server refusal (Apps Script not redeployed yet) says nothing was saved — correct behaviour, and the exact reason DI-202o says SERVER FIRST');
  assert(chat14.getMessages({ tag: 'all' }).every(m => m.meta?.kind !== 'wagerLogged'),
    '14-50: …and NO acknowledgment post went out. A post announcing a wager that was never stored would be permanent, and the wager it names would never resurface');

  // Success.
  _wireScribeMemoryTransportForTest({
    upsert: async rec => { sent = rec; return { ok: true, record: { id: 'mem_new', ...rec } }; },
    list: async () => ({ ok: true, records: sent ? [{ id: 'mem_new', ...sent }] : [] }),
  });
  const okRes = await app.logWager({ messageId: 'm_claim', claim: 'USC is not ranked by week 7', counterpartyId: 'p3', dueWeekId: 'wk7' });
  assert(okRes.ok === true && okRes.message === 'Logged. SCRIBE will bring it back up.',
    '14-51: a successful log reports the approved toast copy');
  assert(sent.playerId === 'p2' && sent.kind === 'wager' && sent.key === `wager:${okRes.wagerId}`
      && sent.provenance === 'player-stated' && Number(sent.confidence) === 1,
    '14-52: the row is owned by the PROPOSER (the author of the quoted message) — which is what lets HIM delete it, AD-49\'s non-negotiable');
  assert(sent.sourceMessageId === 'm_claim' && !!sent.reviewAt && Date.parse(sent.reviewAt) > 0,
    '14-53: …carrying the source message and a parseable reviewAt (an unparseable one can never resurface, so it is computed at log time, not later)');
  assert(JSON.parse(sent.value).b === 'p1' && JSON.parse(sent.value).o === 'p3',
    '14-54: …and the envelope records WHO LOGGED IT separately from whose claim it is — Drew\'s worked example is a third party logging Brayden\'s bet');
  const ackPost = chat14.getMessages({ tag: 'all' }).find(m => m.meta?.kind === 'wagerLogged');
  assert(ackPost?.id === `scribe_wager_${okRes.wagerId}` && ackPost?.replyTo === 'm_claim' && ackPost?.author === 'scribe',
    '14-55: the acknowledgment post lands under the deterministic id, threaded beneath the claim');
  assert(ackPost?.body.includes('Brayden') && ackPost?.body.includes('Kevin') && ackPost?.body.includes('Week 7')
      && !/Oct|—\s*\w+\s*\d/.test(ackPost?.body || ''),
    `14-56: …naming both sides and the week NAME only (got: ${ackPost?.body})`);
  const dupe = await app.logWager({ messageId: 'm_claim', claim: 'again', counterpartyId: '', dueWeekId: 'wk7' });
  assert(dupe.ok === false && dupe.message === "That one's already logged.",
    '14-57: logging the SAME message twice is refused — no second row, no second post');

  // The answer write.
  let ackSent = null;
  _wireScribeMemoryTransportForTest({
    upsert: async rec => { ackSent = rec; return { ok: true, record: { id: 'mem_ack', ...rec } }; },
    list: async () => ({ ok: true, records: [{ id: 'mem_ack', ...(ackSent || {}) }] }),
  });
  storage.setSession('p3', false, true);
  const ansRes = await app.answerWager({ wagerId: okRes.wagerId, reply: 'accepted' });
  assert(ansRes.ok === true && ackSent.playerId === 'p3' && ackSent.key === `wagerack:${okRes.wagerId}`
      && JSON.parse(ackSent.value).r === 'accepted',
    '14-58: the answer is written as the COUNTERPARTY\'s own row — "accepted" is attested by the man who accepted, not asserted by the man who benefits from it');
  assert(ackSent.sourceMessageId === `scribe_wager_${okRes.wagerId}`,
    '14-59: …pointing back at the acknowledgment post it was tapped on');
  assert(chat14.getMessages({ tag: 'all' }).filter(m => m.meta?.kind === 'wagerLogged').length === 1
      && chat14.getMessages({ tag: 'all' }).every(m => m.meta?.kind !== 'wagerDue'),
    '14-60: …and answering posts NOTHING to the room — one action, one message');
  const badReply = await app.answerWager({ wagerId: okRes.wagerId, reply: 'maybe' });
  assert(badReply.ok === false && badReply.skipped === 'unknown_reply',
    '14-61: there are exactly two answers. A third value is refused at the boundary rather than stored and discovered later by a reader that does not handle it');

  _restoreScribeMemoryTransportForTest();
  backend14.setDataMode('sheets');
  storage.clearSession();
  _setScribeMemoryCacheForTest(null, []);
  _setWagerCacheForTest([]);
}

// ═════════════════════════════════════════════════════════════════════════
// 15. UN-235 / DI-252 — SCRIBE autonomous PACING (hourly cap + cooldown)
//
// Drew, 2026-09-21: "Let's make the default cap be 4 message per hour, but the
// commissioner can make the cap unlimited, can the cooldown period be less?"
// and "I want to be able to set the cooldown."
//
// THE LOAD-BEARING ASSERTION IN THIS SECTION IS [15e], THE MERGE RULE.
// `saveSetting('scribe', …)` replaces `value.scribe` AS A WHOLE UNIT on the
// server (supabase-backend's `_kvFieldPatch` → `patch_kv` merge is shallow at
// the declared field), so a whole-bag replace would silently destroy
// `scribe.classifyDailyCap` and `scribe.monthlyBudgetUsd` — neither of which
// has any client writer to put them back. Mutation-proven: replacing the spread
// in setScribePacing() with a bare `{autonomousHourlyLimit, autonomousCooldownMinutes}`
// turns [15e] red.
// ═════════════════════════════════════════════════════════════════════════
console.log('\n[15] DI-252 — SCRIBE pacing: the hourly cap and the cooldown are commissioner-set…');
{
  const {
    renderScribeParticipationCardHTML: renderPacingCard,
    resolveScribeHourlyLimit, resolveScribeCooldownMinutes, getScribePacing,
    setScribePacing, scribePacingHelperText, scribePacingUnlimitedWarning,
    isServerScribeAutonomousOn, SCRIBE_PACING_SERVER_OFF_NOTE,
  } = app;

  // ── [15a] THE PARSING CONTRACT IS THE SERVER'S, VALUE FOR VALUE ──────────
  // Asserted against the Edge Function's own source, not against a second
  // hand-typed table: a client that disagrees with `resolveAutonomousHourlyCap`
  // about what "4" or "0" or "\"4\"" means shows the commissioner a number the
  // server is not obeying, which is the one failure a settings screen owns.
  const fnSrc = await readFile(new URL('./supabase/functions/scribe-autonomous/index.js', import.meta.url), 'utf8');
  assert(/const DEFAULT_HOURLY_CAP = 4;/.test(fnSrc) && /const DEFAULT_GLOBAL_COOLDOWN_MINUTES = 10;/.test(fnSrc),
    '15a fixture: the server still defaults to 4/hour and a 10-minute gap (if this moves, the client defaults below move with it)');
  for (const [raw, want, why] of [
    [undefined, 4, 'absent'], [null, 4, 'null'], [NaN, 4, 'NaN'], [4.5, 4, 'a float'],
    [-3, 4, 'a negative'], ['4', 4, 'a STRING, even a numeric-looking one — a runbook typo must fail toward the safe cap'],
    [99, 4, 'above 60'], [0, 0, 'the exact integer 0 — the ONE unmistakable "unlimited"'],
    [1, 1, 'the floor'], [12, 12, 'the menu ceiling'], [60, 60, 'the server ceiling'],
  ]) {
    assert(resolveScribeHourlyLimit(raw) === want,
      `15a: hourly limit — ${why} resolves to ${want} (got ${resolveScribeHourlyLimit(raw)})`);
  }
  for (const [raw, want, why] of [
    [undefined, 10, 'absent'], [null, 10, 'null'], ['10', 10, 'a string'], [2.5, 10, 'a float'],
    [0, 10, 'ZERO — no "unlimited" reading here; a cooldown of zero is no cooldown at all, which is not what "can the cooldown be less?" asked'],
    [-1, 10, 'a negative'], [99, 10, 'above 60'], [1, 1, 'the floor'], [2, 2, 'Drew\'s own verification value'], [60, 60, 'the ceiling'],
  ]) {
    assert(resolveScribeCooldownMinutes(raw) === want,
      `15a: cooldown — ${why} resolves to ${want} (got ${resolveScribeCooldownMinutes(raw)})`);
  }

  // ── [15b] THE RENDER REFLECTS WHAT IS STORED, INCLUDING NOTHING ──────────
  setScribeAutonomousEnabled(true);
  storage.saveSetting('scribe', undefined);
  const unset = renderPacingCard();
  assert(/data-comm-tab="settings"/.test(unset) && !/data-comm-tab="(week|games|players|data)"/.test(unset),
    '15b: RG-10 — the pacing controls inherit the dial card\'s own settings-tab wrapper and render under no other commissioner tab');
  assert(unset.includes('Unprompted posts per hour') && unset.includes('Minimum gap between unprompted posts'),
    '15b: both approved labels render verbatim');
  assert(/id="scribe-hourly-limit-select"[\s\S]*?<option value="4" selected>4<\/option>/.test(unset),
    '15b: with NOTHING stored the hourly select pre-selects 4 — the factory default, shown as a real choice rather than a blank');
  assert(/id="scribe-cooldown-select"[\s\S]*?<option value="10" selected>10 min<\/option>/.test(unset),
    '15b: …and the cooldown select pre-selects 10 min');
  assert(/<option value="0" >Unlimited<\/option>/.test(unset),
    '15b: "Unlimited" is a named OPTION, not a typed zero — the commissioner never reads the digit (DI-252 §2b.3)');
  assert((unset.match(/id="scribe-hourly-limit-select"[\s\S]*?<\/select>/)[0].match(/<option/g) || []).length === 13,
    '15b: twelve numbered choices plus Unlimited');

  storage.saveSetting('scribe', { autonomousHourlyLimit: 'garbage', autonomousCooldownMinutes: 0 });
  const garbage = renderPacingCard();
  assert(/<option value="4" selected>4<\/option>/.test(garbage) && /<option value="10" selected>10 min<\/option>/.test(garbage),
    '15b: STORED GARBAGE renders as the defaults it resolves to, never as a blank select or as the garbage itself');

  storage.saveSetting('scribe', { autonomousHourlyLimit: 20, autonomousCooldownMinutes: 7 });
  const offMenu = renderPacingCard();
  assert(/<option value="20" selected>20<\/option>/.test(offMenu) && /<option value="7" selected>7 min<\/option>/.test(offMenu),
    '15b: a legitimate value the MENU does not carry (the server accepts 1–60, and the runbook\'s SQL can set one) is inserted and selected — the card must never show a different number from the one the server is obeying');

  storage.saveSetting('scribe', { autonomousHourlyLimit: 0, autonomousCooldownMinutes: 2 });
  const unlim = renderPacingCard();
  assert(/<option value="0" selected>Unlimited<\/option>/.test(unlim), '15b: a stored 0 renders as Unlimited selected');
  assert(!/<option value="(1|2|3|4|5|6|7|8|9|10|11|12)" selected>/.test(unlim.match(/id="scribe-hourly-limit-select"[\s\S]*?<\/select>/)[0]),
    '15b: …and no numbered option is selected at the same time');
  assert(unlim.includes('Unlimited at a 2-minute gap could post up to 30 times an hour'),
    '15b: the Unlimited warning renders only while Unlimited is chosen, computed from the LIVE gap');
  storage.saveSetting('scribe', { autonomousHourlyLimit: 4, autonomousCooldownMinutes: 10 });
  assert(!renderPacingCard().includes('Unlimited at a'),
    '15b: …and it is ABSENT at a bounded cap (a standing warning is a warning nobody reads)');

  // ── [15c] THE DIAL'S OWN COPY STOPPED LYING ─────────────────────────────
  // DI-252 §2b.1: that sentence hard-coded "The 10-minute cooldown applies at
  // every level" while this change makes the number configurable.
  storage.saveSetting('scribe', { autonomousCooldownMinutes: 3 });
  assert(renderPacingCard().includes('The 3-minute cooldown applies at every level.'),
    '15c: the dial\'s cooldown sentence reads the LIVE value');
  assert(!renderPacingCard().includes('The 10-minute cooldown applies'),
    '15c: …and the hard-coded "10-minute" claim is gone');
  storage.saveSetting('scribe', { autonomousCooldownMinutes: 10 });
  assert(renderPacingCard().includes('The 10-minute cooldown applies at every level.'),
    '15c: …which still reads 10 when 10 is what is stored — the number moved, the sentence did not');

  // ── [15d] THE HELPER MATH ────────────────────────────────────────────────
  // Coordinator ruling (2): the $0.03/post CEILING, never the floor or a
  // midpoint. Under-stating what SCRIBE costs is the one direction this line
  // must not err in.
  assert(scribePacingHelperText({ hourlyLimit: 4, cooldownMinutes: 10 })
      === 'At most 4 posts an hour, at least 10 minutes apart — about 12¢ an hour at the very most.',
    `15d: the DI's own worked example, verbatim (got ${JSON.stringify(scribePacingHelperText({ hourlyLimit: 4, cooldownMinutes: 10 }))})`);
  assert(scribePacingHelperText({ hourlyLimit: 1, cooldownMinutes: 1 })
      === 'At most 1 post an hour, at least 1 minute apart — about 3¢ an hour at the very most.',
    `15d: singular "post" and "minute" at 1 and 1 (got ${JSON.stringify(scribePacingHelperText({ hourlyLimit: 1, cooldownMinutes: 1 }))})`);
  assert(scribePacingHelperText({}) === scribePacingHelperText({ hourlyLimit: 4, cooldownMinutes: 10 }),
    '15d: an unset pair reads as the defaults it will actually run under');
  assert(scribePacingHelperText({ hourlyLimit: 0, cooldownMinutes: 10 })
      === 'As many posts as the 10-minute gap allows — about 18¢ an hour at the very most.',
    `15d: Unlimited substitutes 60/gap for the cap — six posts, 18¢ (got ${JSON.stringify(scribePacingHelperText({ hourlyLimit: 0, cooldownMinutes: 10 }))})`);
  assert(scribePacingHelperText({ hourlyLimit: 0, cooldownMinutes: 1 })
      === 'As many posts as the 1-minute gap allows — about $1.80 an hour at the very most.',
    `15d: past a dollar the phrase becomes dollars, not "180¢" (got ${JSON.stringify(scribePacingHelperText({ hourlyLimit: 0, cooldownMinutes: 1 }))})`);
  assert(scribePacingUnlimitedWarning({ cooldownMinutes: 60 })
      === "Unlimited at a 60-minute gap could post up to 1 time an hour — about 3¢/hour at the high end. Your $25/month budget still stops SCRIBE if it's reached.",
    `15d: the warning is singular at one-an-hour and always names the $25/month ceiling (got ${JSON.stringify(scribePacingUnlimitedWarning({ cooldownMinutes: 60 }))})`);
  assert(/\$25\/month/.test(scribePacingUnlimitedWarning({ cooldownMinutes: 10 })),
    '15d: …the ceiling Drew called "stays regardless" is named on every Unlimited warning');

  // ── [15e] THE MERGE RULE — SIBLINGS SURVIVE A SAVE ──────────────────────
  storage.saveSetting('scribe', {
    classifyDailyCap: 40, monthlyBudgetUsd: 25,
    autonomousHourlyLimit: 4, autonomousCooldownMinutes: 10,
  });
  storage.saveSetting('serverJobs', { scribeAutonomous: false, notifyFanout: true });
  storage.saveSetting('serverJobsFlippedAt', { notifyFanout: '2026-09-20T00:00:00.000Z' });

  const res = setScribePacing({ hourlyLimit: 0, cooldownMinutes: 2 });
  assert(res.ok === true && res.hourlyLimit === 0 && res.cooldownMinutes === 2,
    '15e: choosing Unlimited + a 2-minute gap reports back exactly what it stored');
  const bag = storage.getSettings().scribe;
  assert(bag.autonomousHourlyLimit === 0,
    `15e: Unlimited is written as the INTEGER 0 — not null, not absent, not the string "0" (got ${JSON.stringify(bag.autonomousHourlyLimit)}), because 0 is the only value resolveAutonomousHourlyCap() reads as unlimited`);
  assert(bag.autonomousCooldownMinutes === 2, '15e: …and the cooldown alongside it');
  assert(bag.classifyDailyCap === 40,
    `15e: MERGE RULE — scribe.classifyDailyCap survives the save (got ${JSON.stringify(bag.classifyDailyCap)}). scribe-classify is its only reader and NOTHING on the client would ever write it back; a whole-bag replace here loses it silently and permanently.`);
  assert(bag.monthlyBudgetUsd === 25, '15e: …and scribe.monthlyBudgetUsd, the ceiling the Unlimited warning promises still applies');
  assert(storage.getSettings().serverJobs.scribeAutonomous === false
      && storage.getSettings().serverJobs.notifyFanout === true,
    '15e: …and the separate top-level serverJobs map is untouched (a saveSettings() whole-blob write is what would have taken it)');
  assert(storage.getSettings().serverJobsFlippedAt.notifyFanout === '2026-09-20T00:00:00.000Z',
    '15e: …and serverJobsFlippedAt with it');
  assert(storage.getSettings().autonomousHourlyLimit === undefined,
    '15e: NOTHING is written at the TOP level — the server reads these two keys from inside `scribe`, so a top-level write is a value nothing will ever read');
  assert(getScribePacing().hourlyLimit === 0 && getScribePacing().cooldownMinutes === 2,
    '15e: getScribePacing() reads back what was just saved — one definition, card and copy alike');
  {
    const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
    const fn = src.slice(src.indexOf('export function setScribePacing'), src.indexOf('function scribeChoiceOptions'));
    assert(/\.\.\.\(getSettings\(\)\.scribe \|\| \{\}\)/.test(fn),
      '[15e structural] the write read-modify-writes the NESTED bag — the serverJobs precedent (js/app.js:11128), not a fresh object');
    assert(!/saveSettings\(/.test(fn), '[15e structural] never saveSettings() — a whole-blob replace declares no field and can send a stale mirror over a fresh remote (RG-24/49/55)');
    assert(!/localStorage/.test(fn), '[15e structural] and never localStorage directly (AD-02)');
  }

  // ── [15f] THE HONEST SERVER-OFF NOTE ────────────────────────────────────
  assert(isServerScribeAutonomousOn() === false,
    '15f fixture: settings.serverJobs.scribeAutonomous is false — today\'s real state');
  assert(renderPacingCard().includes(SCRIBE_PACING_SERVER_OFF_NOTE),
    '15f: with the server job OFF the card SAYS SO, in place, without hover (coordinator ruling (1): show the controls with the honest note — hiding them would defeat Drew asking to be able to set them)');
  storage.saveSetting('serverJobs', { scribeAutonomous: true });
  assert(isServerScribeAutonomousOn() === true && !renderPacingCard().includes(SCRIBE_PACING_SERVER_OFF_NOTE),
    '15f: …and the note disappears the moment the job is switched on');
  storage.saveSetting('serverJobs', { scribeAutonomous: false });

  // ── [15g] OFF-STATE + ESCAPING + TAP TARGETS ────────────────────────────
  setScribeAutonomousEnabled(false);
  const dimmed = renderPacingCard();
  assert(/class="scribe-pacing notif-prefs-row-dim"/.test(dimmed),
    '15g: with the dial OFF the pacing group takes the dial\'s own dim treatment — these numbers mean nothing until SCRIBE can post at all');
  setScribeAutonomousEnabled(true);
  assert(/class="scribe-pacing"/.test(renderPacingCard()), '15g: …and is live again when it is on');
  const live = renderPacingCard();
  assert(!/<script|onerror=|javascript:/i.test(live), '15g: no script sink in the rendered card');
  assert(/<button class="btn btn-secondary btn-sm" id="scribe-pacing-save-btn">Save<\/button>/.test(live),
    '15g: the Save button reuses the existing .btn.btn-secondary.btn-sm, matching the refresh-interval Save beside it');
  {
    const css = await readFile(new URL('./css/styles.css', import.meta.url), 'utf8');
    assert(/\.scribe-pacing \.btn-sm\{min-height:44px\}/.test(css),
      '15g: CONVENTIONS #17 — .btn-sm ships at 34px, so the pacing Save is lifted to 44 in place (the .gr-row-action precedent)');
    const block = css.slice(css.indexOf('.scribe-pacing{'), css.indexOf('.scribe-pacing p:empty'));
    assert(!/#[0-9a-fA-F]{3,8}\b/.test(block),
      `15g: no hex literal in the new CSS — every colour is a theme var, so all seven themes get it for free (got ${JSON.stringify(block)})`);
  }
  // Emoji only (CONVENTIONS #16) — the two glyphs this feature introduces.
  assert(!/<svg/i.test(live.slice(live.indexOf('scribe-pacing'))), '15g: no inline SVG — the bottom-nav exception is not widened');

  // ── [15h] THE HANDLER AND THE RENDER NAME THE SAME ELEMENTS ─────────────
  // The click handler lives inside renderCommPage()'s wiring block and cannot
  // be reached without a live DOM (the RG-27 shape). What CAN drift silently is
  // the pair of ids: a renamed select would leave the Save button reading
  // `undefined` from `getElementById(...)?.value`, which parseInt turns into
  // NaN, which resolves to the DEFAULTS — a Save that quietly reset both
  // settings and toasted success. So the ids are pinned on both sides.
  {
    const src = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
    const wiring = src.slice(src.indexOf("const readPacingSelects = () =>"), src.indexOf("document.getElementById('ep-detect-btn')"));
    for (const id of ['scribe-hourly-limit-select', 'scribe-cooldown-select', 'scribe-pacing-helper', 'scribe-pacing-warning', 'scribe-pacing-save-btn']) {
      assert(wiring.includes(`'${id}'`) && live.includes(`id="${id}"`),
        `15h: #${id} is named by BOTH the handler and the rendered card — a rename on one side alone would make Save silently store the defaults and toast success`);
    }
    assert(/setScribePacing\(readPacingSelects\(\)\)/.test(wiring),
      '15h: the Save button drives the REAL setScribePacing() — the same function [15e] mutation-proved, not a second copy of the merge');
    // DI-252's copy, with punctuation moved off the `— SCRIBE` shape loadtest
    // §[65] forbids app-wide (a retired v2.1 voice tic). Every word survives.
    assert(/catch \(err\)[\s\S]{0,700}Pacing settings did not save\. SCRIBE is still using the old limits — try again\.'/.test(wiring),
      '15h: AD-06 loud-fail — a throw from the seam produces an error toast naming what SCRIBE is STILL obeying, never a success toast on a write that failed');
    const successAt = wiring.indexOf("'⏱ Pacing settings saved'");
    const saveAt = wiring.indexOf('setScribePacing(readPacingSelects())');
    assert(successAt > saveAt && successAt < wiring.indexOf('} catch'),
      '15h: …and the success toast sits INSIDE the try, after the write — not before it and not in a finally');
    assert(/refreshPacingCopy\)/.test(wiring) && (wiring.match(/addEventListener\('change', refreshPacingCopy\)/g) || []).length === 2,
      '15h: BOTH selects refresh the helper/warning copy live, so the sentence describes what is on screen rather than what was last saved');
  }

  storage.saveSetting('scribe', { autonomousHourlyLimit: 4, autonomousCooldownMinutes: 10 });
  storage.saveSetting('serverJobs', undefined);
  storage.saveSetting('serverJobsFlippedAt', undefined);
}

// ── Result ───────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
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
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));

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
