/**
 * CFB Pickems — persisttest.mjs
 * =============================
 * RG-49 — "The extra point and tie breaker's won't save. I keep submitting them
 *          and then the site forgets about them. … I don't think the
 *          feature/bug feedback submitted is always getting saved. Big problem."
 *          (Drew, feedback fb_1788305695294_sp2fy, 2026-09-01, against v0.17.7)
 *
 * Run:  node persisttest.mjs
 *
 * A SEPARATE FILE ON PURPOSE, same rationale as grouptest.mjs and synctest.mjs
 * (CLAUDE.md): this suite drives the REAL backend.hydrate() against a stubbed
 * transport. Doing that inside loadtest.mjs would leave the backend singleton
 * hydrated, `_backendMode` flipped to googleSheets, and load()/save() routed
 * through a live mirror for every suite that ran after it.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Three storage keys that hold ADDITIVE, PER-AUTHOR league data:
 *
 *   cfbp_extra_point_guesses   { "weekId__playerId": yards }
 *   cfbp_tiebreaker_guesses    { "weekId__playerId": guess }
 *   cfbp_feedback              [ { id, name, kind, body, … } ]
 *
 * SCOPE NOTE (Drew, 2026-09-01): Extra Point is NOT a standings input — "the
 * only thing that affects the standings is the performance in the picks and the
 * tiebreaker." This file is about the guesses being SAVED, nothing else. It
 * asserts no ranking behaviour and changes none. The tiebreaker, by contrast,
 * does decide who wins a tied week, so losing one rewrites who gets paid.
 *
 * Every entry in all three is written by a DIFFERENT author, at a DIFFERENT
 * time, into a SINGLE seam key. That is the shape RG-39 proved is dangerous:
 * a device booting on a stale mirror holds a well-formed, populated, completely
 * obsolete copy of the whole collection, and hydrate() re-applies it wholesale
 * over the fresher remote and pushes it to the Sheet.
 *
 * RG-12 defense (c) (`_shrinks`) was written to stop exactly this for user
 * data. It never covered these three:
 *   - `_USER_DATA_KEYS` names 'cfbp_tb_guesses' and 'cfbp_ep_guesses'. Neither
 *     string exists anywhere in the app — storage.js's KEYS calls them
 *     'cfbp_tiebreaker_guesses' and 'cfbp_extra_point_guesses'. The guard has
 *     been INERT for both keys since the day it was written. [6] below is the
 *     structural check that makes a dead key name in a data-protection guard
 *     impossible to ship again (RG-27's class: a guard recorded as covering
 *     something it cannot reach).
 *   - `cfbp_feedback` was never listed at all.
 *
 * AND `_shrinks` IS NOT THE FIX HERE — see [4]. Dropping the smaller side would
 * throw away the submission the player just made, which is the very symptom
 * being reported. These three keys need a MERGE, not a veto. [1]–[5] pin both
 * directions so a future fix cannot trade one silent loss for the other.
 */

// ── DOM / browser stubs ──────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
if (typeof globalThis.btoa !== 'function') globalThis.btoa = s => Buffer.from(String(s), 'binary').toString('base64');
if (typeof globalThis.atob !== 'function') globalThis.atob = s => Buffer.from(String(s), 'base64').toString('binary');

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const be      = await import('./js/backend.js');
const storage = await import('./js/storage.js');
// Phase III Step 4 Part B — [8] drives the seam's THIRD mode, so it needs the
// adapter the seam now routes to. Same module instance js/storage.js holds.
const sb      = await import('./js/supabase-backend.js');

const MIRROR_KEY = 'cfbp_sheet_mirror';
const WEEK = { weekId: 'w1', weekNumber: 1, season: 2026, status: 'open',
               tiebreakerQuestion: 'Total points in the Ohio State game?' };
const PLAYERS = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon']
  .map((n, i) => ({ playerId: `p${i}`, displayName: n, active: true }));

/**
 * Fresh module state per scenario — hydrate() mutates a module-level singleton.
 * Returns the array of payloads the stub transport actually received, so every
 * scenario can prove the damage reaches the SHEET and is not a local artefact.
 */
function resetWorld(REMOTE) {
  store.clear();
  const sent = [];
  globalThis.fetch = async (_url, opts) => {
    const req = JSON.parse(opts.body);
    if (req.action === 'getAll') return { ok: true, json: async () => ({ ok: true, data: REMOTE }) };
    if (req.action === 'setMany') { sent.push(req.entries); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  be.setBackendConfig('https://example.invalid/exec', 'tok');
  return sent;
}

/** Boot exactly as app.js boot() does: prime the stale mirror, go interactive. */
function bootOnStaleMirror(mirrorData) {
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: '2026-08-28T00:00:00Z', data: mirrorData }));
  const primed = be.primeFromMirror();
  storage.setBackendMode('googleSheets');
  return primed;
}

/** Last value the transport was asked to write for `key`, or undefined. */
const lastPushOf = (sent, key) => sent.map(e => e && e[key]).filter(v => v !== undefined).pop();

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[1] THE REPORT — Extra Point: \"I keep submitting them and then the site forgets about them\"…");
// The scenario is one ordinary Saturday, no unusual action by anyone:
//   Drew and four others submit their Extra Point guesses. All six reach the Sheet.
//   Kihoon then opens the app. His mirror is from Thursday, before any of them
//   submitted. app.js boot(): primeFromMirror() → setBackendMode('googleSheets')
//   → revealApp() — THE APP IS INTERACTIVE HERE — → await hydrateBackend(),
//   which is a 10–20s Apps Script cold start. Kihoon enters his guess in that
//   window. That is the entire scenario.
{
  const REMOTE = {
    cfbp_players: PLAYERS, cfbp_weeks: [WEEK],
    cfbp_extra_point_guesses: { w1__p0: 47, w1__p1: 52, w1__p2: 48, w1__p3: 55, w1__p4: 41 },
  };
  const sent = resetWorld(REMOTE);
  const primed = bootOnStaleMirror({
    cfbp_players: PLAYERS, cfbp_weeks: [WEEK], cfbp_extra_point_guesses: {},
  });

  assert(primed > 0, `boot: primeFromMirror() served Kihoon's Thursday snapshot (${primed} keys)`);
  assert(be.isMirrorStale() === true, 'boot: the mirror is flagged STALE — hydrate has not returned yet');
  assert(Object.keys(storage.getExtraPointGuesses()).length === 0,
    'fixture check: the stale snapshot genuinely holds NO Extra Point guesses — it predates every submission, and nothing about it looks broken');

  storage.setExtraPointGuess('w1', 'p5', 60);   // ONE ordinary submit, the only user action here

  await be.hydrate();

  const after = storage.getExtraPointGuesses();
  assert(after.w1__p0 === 47,
    `THE REPORT: Drew's submitted Extra Point guess survives another player's cold-start submit (got ${JSON.stringify(after.w1__p0)}, expected 47)`);
  assert(Object.keys(after).length === 6,
    `…and so does everyone else's — all six guesses on file after hydrate (got ${Object.keys(after).length}/6: ${JSON.stringify(after)})`);

  // The half that makes it permanent and league-wide rather than one bad render.
  await be.flushPush();
  const pushed = lastPushOf(sent, 'cfbp_extra_point_guesses');
  assert(pushed, 'fixture check: an Extra Point write really was pushed — the scenario reaches the Sheet');
  assert(pushed && pushed.w1__p0 === 47,
    `and the value PUSHED TO THE SHEET still carries Drew's 47 (got ${JSON.stringify(pushed && pushed.w1__p0)}) — this is what turns one phone's stale mirror into league-wide, permanent loss`);
  assert(pushed && Object.keys(pushed).length === 6,
    `…and all six entries (got ${pushed ? Object.keys(pushed).length : 'n/a'}/6)`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[2] THE REPORT — the tiebreaker, identical shape, identical loss…");
// Same key shape, same single seam key, same per-author entries. The tiebreaker
// decides the weekly cash prize whenever records tie, so losing one rewrites who
// gets paid — it is not a cosmetic loss.
{
  const REMOTE = {
    cfbp_players: PLAYERS, cfbp_weeks: [WEEK],
    cfbp_tiebreaker_guesses: { w1__p0: 12, w1__p1: 41, w1__p2: 55, w1__p3: 30, w1__p4: 21 },
  };
  const sent = resetWorld(REMOTE);
  bootOnStaleMirror({ cfbp_players: PLAYERS, cfbp_weeks: [WEEK], cfbp_tiebreaker_guesses: {} });

  storage.setTiebreakerGuess('w1', 'p5', 17);
  await be.hydrate();

  const after = storage.getTiebreakerGuesses();
  assert(after.w1__p0 === 12,
    `THE REPORT: Drew's tiebreaker guess survives another player's cold-start submit (got ${JSON.stringify(after.w1__p0)}, expected 12)`);
  assert(Object.keys(after).length === 6,
    `…and all six tiebreaker guesses are on file (got ${Object.keys(after).length}/6: ${JSON.stringify(after)})`);

  await be.flushPush();
  const pushed = lastPushOf(sent, 'cfbp_tiebreaker_guesses');
  assert(pushed && Object.keys(pushed).length === 6,
    `…and the value PUSHED TO THE SHEET carries all six (got ${pushed ? Object.keys(pushed).length : 'n/a'}/6)`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log("\n[3] THE REPORT — feedback: \"I don't think the feature/bug feedback submitted is always getting saved\"…");
// Drew called this the biggest issue in the batch, and he is right about why: if
// the bug-reporting channel is lossy, no other report in the queue can be
// trusted to be complete. `cfbp_feedback` is an append-only list of immutable
// rows written by six different people — the same collision shape as [1] and
// [2], one key over, and it is not in `_USER_DATA_KEYS` at all.
{
  const REMOTE = {
    cfbp_players: PLAYERS, cfbp_weeks: [WEEK],
    cfbp_feedback: [
      { id: 'fb_1', name: 'Kevin', kind: 'bug',     body: 'Chat scroll jumps' },
      { id: 'fb_2', name: 'Koby',  kind: 'feature', body: 'Show the spread on the card' },
      { id: 'fb_3', name: 'Jacob', kind: 'bug',     body: 'Standings off by one' },
    ],
  };
  const sent = resetWorld(REMOTE);
  bootOnStaleMirror({ cfbp_players: PLAYERS, cfbp_weeks: [WEEK], cfbp_feedback: [] });

  storage.appendFeedback({ id: 'fb_drew', name: 'Drew', kind: 'bug', body: "The extra point and tie breaker's won't save" });
  await be.hydrate();

  const after = storage.getFeedback();
  const ids = after.map(f => f.id);
  assert(ids.includes('fb_1') && ids.includes('fb_2') && ids.includes('fb_3'),
    `THE REPORT: the three earlier submissions survive a fourth player's cold-start submit (got ${JSON.stringify(ids)})`);
  assert(ids.includes('fb_drew'),
    "…and the submission that was just made is still there too — this is a merge, not a veto");
  assert(after.length === 4, `four submissions on file, none lost (got ${after.length})`);

  await be.flushPush();
  const pushed = lastPushOf(sent, 'cfbp_feedback');
  assert(pushed && pushed.length === 4,
    `and the value PUSHED TO THE SHEET carries all four (got ${pushed ? pushed.length : 'n/a'}/4) — otherwise every submission silently deletes the queue behind it`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] …while the submit that triggered it is HONOURED — a merge, never a veto…');
// This is the assertion that rules out the tempting one-line "fix": adding these
// keys to `_USER_DATA_KEYS` so RG-12 defense (c) drops the smaller side. It
// would stop the collection shrinking — by throwing away the guess the player
// just typed. That IS Drew's reported symptom, arrived at from the other
// direction. Both halves have to hold at once or the fix is not a fix.
{
  const REMOTE = {
    cfbp_players: PLAYERS, cfbp_weeks: [WEEK],
    cfbp_extra_point_guesses: { w1__p0: 47, w1__p1: 52, w1__p2: 48, w1__p3: 55, w1__p4: 41 },
    cfbp_tiebreaker_guesses:  { w1__p0: 12, w1__p1: 41, w1__p2: 55, w1__p3: 30, w1__p4: 21 },
  };
  const sent = resetWorld(REMOTE);
  bootOnStaleMirror({
    cfbp_players: PLAYERS, cfbp_weeks: [WEEK],
    cfbp_extra_point_guesses: {}, cfbp_tiebreaker_guesses: {},
  });

  storage.setExtraPointGuess('w1', 'p5', 60);
  storage.setTiebreakerGuess('w1', 'p5', 17);
  await be.hydrate();

  assert(storage.getExtraPointGuess('w1', 'p5') === 60,
    `the cold-start Extra Point submit is kept, not vetoed (got ${JSON.stringify(storage.getExtraPointGuess('w1', 'p5'))})`);
  assert(storage.getTiebreakerGuess('w1', 'p5') === 17,
    `the cold-start tiebreaker submit is kept, not vetoed (got ${JSON.stringify(storage.getTiebreakerGuess('w1', 'p5'))})`);

  await be.flushPush();
  const ep = lastPushOf(sent, 'cfbp_extra_point_guesses');
  assert(ep && ep.w1__p5 === 60 && ep.w1__p0 === 47,
    'the pushed value contains BOTH the new submit and the five it must not have destroyed');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] …and a DELIBERATE clear of your own guess still wins over the remote…');
// The inverse hazard, already recorded in ledger §6 against `_rebaseRecords()`:
// a merge that only ever adds can resurrect something the player intentionally
// removed. setExtraPointGuess(w,p,null) DELETES the entry (storage.js) — that is
// a real, reachable user intent (clear the box, submit). It must survive
// hydrate, and it must not take anyone else's entry with it.
{
  const REMOTE = {
    cfbp_players: PLAYERS, cfbp_weeks: [WEEK],
    cfbp_extra_point_guesses: { w1__p0: 47, w1__p1: 52, w1__p5: 60 },
  };
  resetWorld(REMOTE);
  bootOnStaleMirror({
    cfbp_players: PLAYERS, cfbp_weeks: [WEEK],
    cfbp_extra_point_guesses: { w1__p5: 60 },
  });

  storage.setExtraPointGuess('w1', 'p5', null);     // Kihoon clears his own entry
  await be.hydrate();

  const after = storage.getExtraPointGuesses();
  assert(!('w1__p5' in after),
    `the player's own deliberate clear is honoured, not resurrected by the merge (got ${JSON.stringify(after)})`);
  assert(after.w1__p0 === 47 && after.w1__p1 === 52,
    'and clearing your own entry does not touch anyone else\'s');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[6] GUARD INTEGRITY — every key a data-protection guard names must actually exist…');
// RG-27's class, one layer down. `_USER_DATA_KEYS` in backend.js is the list
// RG-12 defense (c) consults before refusing a destructive held write. Two of
// its eight entries — 'cfbp_tb_guesses' and 'cfbp_ep_guesses' — are strings the
// app has never used for anything. `_USER_DATA_KEYS.includes(k)` is false for
// every real key those two were meant to name, so the guard silently did
// nothing for the two keys in [1] and [2], while READING as though it covered
// them. A source-text audit of the guard would have called it present.
//
// This check is structural on purpose: it is the only kind that can catch a
// guard which is fully written, fully committed, and aimed at nothing.
{
  const backendSrc = readFileSync(new URL('./js/backend.js', import.meta.url), 'utf8');
  const storageSrc = readFileSync(new URL('./js/storage.js', import.meta.url), 'utf8');

  /** Pull the string literals out of a named const array in a source file. */
  function namedKeyList(src, constName) {
    const m = src.match(new RegExp(`const\\s+${constName}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    if (!m) return null;
    return [...m[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map(x => x[1] || x[2]);
  }
  /** Every cfbp_* key the app actually defines, from storage.js's KEYS block. */
  function realKeys(src) {
    const m = src.match(/const\s+KEYS\s*=\s*\{([\s\S]*?)\n\};/);
    if (!m) return null;
    return new Set([...m[1].matchAll(/'(cfbp_[A-Za-z0-9_]+)'/g)].map(x => x[1]));
  }

  const guarded = namedKeyList(backendSrc, '_USER_DATA_KEYS');
  const real    = realKeys(storageSrc);

  assert(Array.isArray(guarded) && guarded.length >= 6,
    `fixture check: the scan actually parsed _USER_DATA_KEYS out of backend.js (${guarded ? guarded.length : 0} entries) — a broken parser would find 0 and pass everything below`);
  assert(real instanceof Set && real.size >= 15,
    `fixture check: the scan actually parsed storage.js's KEYS block (${real ? real.size : 0} real keys)`);
  assert(real && real.has('cfbp_extra_point_guesses') && real.has('cfbp_tiebreaker_guesses'),
    'fixture check: the two keys this bug is about are among the real keys the scan found');

  const dead = (guarded || []).filter(k => !real.has(k));
  assert(dead.length === 0,
    `every key named in _USER_DATA_KEYS is a real storage key — a guard cannot protect a key that does not exist (dead names found: ${JSON.stringify(dead)})`);

  // Canaries. A structural check is only worth its line count if it demonstrably
  // fails on the defect it claims to catch, and passes on the healthy shape.
  const canaryDead = ['cfbp_picks', 'cfbp_not_a_real_key'].filter(k => !real.has(k));
  assert(canaryDead.length === 1 && canaryDead[0] === 'cfbp_not_a_real_key',
    'canary: an invented key name IS flagged by this check');
  const canaryClean = ['cfbp_picks', 'cfbp_players', 'cfbp_extra_point_guesses'].filter(k => !real.has(k));
  assert(canaryClean.length === 0,
    'canary: three genuinely real key names are NOT flagged — the check is not simply failing everything');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[7] RG-51 — ONE pick-draft reset, not seven divergent copies…');
// Adjacent defect found during the same audit, same "the collection grew, the
// resets did not" shape as [6]. `state.draftExtraPoint` (added v0.16.0) is
// module state in app.js and was reset in exactly ONE of the six places the
// pick draft is torn down — the submit path. The other five each cleared a
// different subset:
//
//   app.js:929   clearSession()  — session points at a deleted player: nothing
//   app.js:951   logout (locked week)                    : draftPicks only
//   app.js:988   logout (pick form)                      : draftPicks + tiebreaker
//   app.js:1148  login as a different player             : draftPicks + tiebreaker
//   app.js:1196  logout (submitted view)                 : nothing
//   app.js:1202  "Edit My Picks"                         : draftPicks + tiebreaker
//
// Consequence on a shared device: player A types an Extra Point guess, logs
// out; player B logs in and the Extra Point box is PRE-FILLED with A's number.
// B reads a rival's guess while the week is still OPEN (RG-37's class — and
// Extra Point is blackjack, where knowing the field is more decisive than
// knowing one ATS pick), and if B submits, A's number is recorded as B's entry.
//
// The root cause is the five divergent copies, not the one missing line, so the
// invariant asserted here is structural and about the copies: the draft is
// reset in exactly ONE function, and every session-change site in the picks
// flow calls it. `state` is module-private in app.js, so this cannot be driven
// behaviourally without exporting it. Canaries below prove both matchers fail
// on the defect and pass on the healthy shape.
{
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');

  /** Direct resets of any draft field, with the body of `fnName` excised. */
  function directDraftResetsOutside(rawSrc, fnName) {
    // Comment-blind for the same reason picksFlowSessionResets() is (see its
    // comment): a paragraph that NAMES the draft fields is documentation, not a
    // stray reset, and a rule that cannot tell them apart reports the prose.
    const src = blankComments(rawSrc);
    const m = src.match(new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
    const rest = m ? src.slice(0, m.index) + src.slice(m.index + m[0].length) : src;
    return [...rest.matchAll(/state\.draft(?:Picks\s*=\s*\{\s*\}|Tiebreaker\s*=\s*null|ExtraPoint\s*=\s*null)/g)]
      .map(x => x[0]);
  }
  /**
   * REGRESSION IN THIS SUITE, found by a full sweep 2026-09-17 (Phase III Step
   * 3a, commit 976354d): this scan counted a COMMENT as a call site.
   *
   * app.js's supabase-mode recursion guard explains itself in prose — "In
   * 'pins' mode clearSession() removes KEYS.SESSION … clearSession() changes
   * NOTHING the next getSession() can observe … and renderPicksPage()
   * re-enters this exact branch" — and that paragraph contains both anchors
   * this matcher keys on, inside 400 characters of each other. So the rule
   * reported the app's own documentation as a missing clearPickDraft().
   *
   * The fix is comment-BLINDNESS, not a reworded comment. Rewording would have
   * turned the suite green while leaving the matcher able to do it again to the
   * next paragraph that mentions the two functions — and the comment is the
   * most load-bearing prose in that file (it is the SEC-concern-1 infinite
   * recursion guard). Blanked LENGTH-PRESERVINGLY, so every offset this
   * function reports still indexes the real file, using the same blanker
   * authtest [17d] already uses for the identity-path audit; the canaries below
   * prove the blanker only removed comments.
   */
  function blankComments(src) {
    let out = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
    out = out.split('\n').map(line => {
      const bare = line.match(/^(\s*)\/\//);
      if (bare) return line.replace(/[^\n]/g, ' ');
      // A trailing `//` counts as a comment only when the code before it has
      // balanced quotes — otherwise it is inside a string (a URL, a regex).
      for (let i = 0; i < line.length - 1; i++) {
        if (line[i] === '/' && line[i + 1] === '/') {
          const head = line.slice(0, i);
          const q = ch => (head.split(ch).length - 1) % 2 === 0;
          if (q("'") && q('"') && q('`')) return head + ' '.repeat(line.length - i);
        }
      }
      return line;
    }).join('\n');
    return out;
  }

  /** clearSession() sites in the PICKS flow (they re-render the picks page). */
  function picksFlowSessionResets(rawSrc) {
    const src = blankComments(rawSrc);
    const out = [];
    const re = /clearSession\(\)|setSession\(/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const stmt = src.slice(m.index, m.index + 400);
      if (!/renderPicksPage\(\)/.test(stmt)) continue;      // not the picks flow
      out.push({ text: stmt.replace(/\s+/g, ' ').slice(0, 90),
                 clears: /clearPickDraft\(\)/.test(stmt) });
    }
    return out;
  }

  // The blanker is load-bearing for the scan above, so prove it only removed
  // comments: identical length (every offset still indexes the real file) and
  // the result still parses. A blanker that ate half a string literal would
  // sail through a "does it contain the anchors" check.
  {
    const blanked = blankComments(appSrc);
    assert(blanked.length === appSrc.length,
      'the comment-blanker preserves LENGTH, so the scan below still indexes the real js/app.js');
    const { writeFileSync, unlinkSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { spawnSync } = await import('node:child_process');
    const tmp = join(tmpdir(), `cfbp-persisttest-blanked-${process.pid}.mjs`);
    writeFileSync(tmp, blanked);
    const checked = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
    try { unlinkSync(tmp); } catch {}
    assert(checked.status === 0,
      `…and the blanked source still parses — it removed comments and nothing else (${String(checked.stderr || '').split('\n')[0]})`);
    assert(/clearSession\(\)/.test(appSrc) && !/changes NOTHING the next getSession\(\) can observe/.test(blanked),
      'fixture: the app.js COMMENT that broke this rule is still in the file (it is the SEC-concern-1 recursion guard and must stay readable) and the blanker really does hide it from the scan');
    assert(picksFlowSessionResets(
        "// clearSession() does nothing here, so renderPicksPage() would recurse\nconst x = 1;").length === 0,
      'canary: a COMMENT naming both anchors is not counted as a call site');
    assert(picksFlowSessionResets(
        "/* clearSession() ... renderPicksPage() */\nconst x = 1;").length === 0,
      'canary: …including a block comment');
  }

  const sites = picksFlowSessionResets(appSrc);
  assert(sites.length >= 4,
    `fixture check: the scan found ${sites.length} session-change sites in the picks flow — a broken matcher would find 0 and pass vacuously`);

  const uncleared = sites.filter(s => !s.clears).map(s => s.text);
  assert(uncleared.length === 0,
    `every session change in the picks flow resets the whole draft, so one player's guess cannot pre-fill the next player's box (sites not calling clearPickDraft(): ${JSON.stringify(uncleared)})`);

  const strays = directDraftResetsOutside(appSrc, 'clearPickDraft');
  assert(strays.length === 0,
    `the draft is reset in exactly ONE place — five divergent inline copies is what let draftExtraPoint be forgotten by four of them (stray resets: ${JSON.stringify(strays)})`);

  // …AND the one place actually resets everything. Centralising the CALL SITES
  // without checking the BODY is RG-27 exactly: gutting the helper's third line
  // while leaving its name and all six call sites intact left the two
  // assertions above fully green, so the "guard" recorded as covering
  // draftExtraPoint covered nothing. Verified by mutation 2026-09-01.
  function draftFieldsResetIn(src, fnName) {
    const m = src.match(new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}`));
    if (!m) return null;
    return ['draftPicks', 'draftTiebreaker', 'draftExtraPoint']
      .filter(f => new RegExp(`state\\.${f}\\s*=\\s*(?:\\{\\s*\\}|null)`).test(m[0]));
  }
  const resetInBody = draftFieldsResetIn(appSrc, 'clearPickDraft');
  assert(resetInBody !== null,
    'fixture check: clearPickDraft() exists and its body was parsed — a missing helper must fail here, not pass vacuously');
  assert(resetInBody && resetInBody.length === 3,
    `clearPickDraft()'s BODY resets all three draft fields (found: ${JSON.stringify(resetInBody)}) — the call sites being centralised proves nothing if the function they call is empty`);

  assert((draftFieldsResetIn(
      'function clearPickDraft() {\n  state.draftPicks = {};\n  state.draftTiebreaker = null;\n}',
      'clearPickDraft') || []).length === 2,
    'canary: a helper that resets only TWO of the three fields IS flagged — this is the exact mutation that survived the first version of this test');
  assert(draftFieldsResetIn('function somethingElse() {}', 'clearPickDraft') === null,
    'canary: a MISSING helper is reported as unparsed, never as three fields found');

  // Canaries — each matcher must fail on the broken shape and pass on the fixed one.
  assert(picksFlowSessionResets(
      "on('click', () => { clearSession(); state.draftPicks={}; renderPicksPage(); });")
      .filter(s => !s.clears).length === 1,
    'canary: a picks-flow logout that does NOT call clearPickDraft() IS flagged');
  assert(picksFlowSessionResets(
      "on('click', () => { clearSession(); clearPickDraft(); renderPicksPage(); });")
      .filter(s => !s.clears).length === 0,
    'canary: a picks-flow logout that DOES call it is not flagged');
  assert(picksFlowSessionResets(
      "adminLogout(){ clearSession(); navigateTo('dashboard'); }").length === 0,
    'canary: a clearSession() outside the picks flow is correctly ignored, not force-fitted into this rule');
  assert(directDraftResetsOutside(
      'function clearPickDraft() {\n  state.draftPicks = {};\n}\nfunction other(){ state.draftTiebreaker = null; }',
      'clearPickDraft').length === 1,
    'canary: a stray reset OUTSIDE the helper IS flagged');
  assert(directDraftResetsOutside(
      'function clearPickDraft() {\n  state.draftPicks = {};\n  state.draftTiebreaker = null;\n  state.draftExtraPoint = null;\n}\nfunction other(){ state.draftPicks[g]=t; }',
      'clearPickDraft').length === 0,
    'canary: the three resets INSIDE the helper are not flagged, and a per-game draft write is not mistaken for a reset');
}

// ═══════════════════════════════════════════════════════════════════════════
// [8] PHASE III STEP 4 PART B — SUPABASE MODE SEEDS NOTHING, EVER
//
// Closes adaptertest.mjs's A9b skip, which named THIS file as its follow-up
// because the lines live in js/storage.js and Part A could not edit it.
//
// TWO CHANGES, and the second is the stronger one.
//
//   (a) RG-12's refusal now covers the new mode. The guard read
//       `getBackendMode() === 'googleSheets'`, which is FALSE in
//       `dataMode:'supabase'` — so a hydrate that delivered nothing (a held
//       adapter, an offline boot, a partial read) would have seeded
//       DEMO_PLAYERS, DEMO_PICKS and the draft week template into a real
//       league's keys. That is RG-12's cascade arriving through a mode the
//       guard had never heard of. It is now `!== 'local'`: the question is "is
//       this a SHARED store", which is what the refusal was always about.
//
//   (b) …and in supabase mode ensureSeedData() returns IMMEDIATELY, before the
//       walk begins (coordinator ruling, 2026-09-18). (a) alone protects only
//       USER_MUTABLE_KEYS, so the walk would still reach cfbp_settings,
//       cfbp_comments, cfbp_notifications and the three SCRIBE keys and push
//       each at the adapter — a commissioner session OVERWRITING a real
//       settings blob with defaults, and every other session throwing
//       AdapterWriteRefusedError out of a boot path. THE SERVER IS THE SEED: a
//       Supabase league's rows exist before any device boots, and there is no
//       state in which a handset is the right place to invent them.
//
// Driven, not grepped: the mode is really set, ensureSeedData() is really
// called, and the keys are really read back — through BOTH the raw store and
// the adapter's mirror, because "it did not write localStorage" is not the same
// claim as "it did not write".
console.log('\n[8] ensureSeedData() in dataMode:\'supabase\' seeds NOTHING — not a user key, not any key');
{
  const modeBefore = storage.getBackendMode();
  [...store.keys()].filter(k => k.startsWith('cfbp_')).forEach(k => store.delete(k));
  storage.setBackendMode('supabase');
  assert(storage.getBackendMode() === 'supabase',
    '[8] fixture: setBackendMode() accepts the third mode at all (it used to coerce anything but googleSheets to local)');

  // THE FIXTURE IS A COMMISSIONER, and that is the WORST case, not a
  // convenience. A player is refused by the adapter's ROUTE TABLE before the
  // seed walk can get anywhere (cfbp_settings is 'refuse' for a player, and it
  // is the first key ensureSeedData() touches), so a player-session drive would
  // pass whether or not either guard existed. A commissioner is ALLOWED to
  // write settings — which is exactly the session that would have silently
  // overwritten a live league's settings blob with DEFAULT_SETTINGS.
  sb._resetForTest();
  sb.init({ getSession: () => ({ isAdmin: true, playerId: 'p1' }) });
  sb._setStateForTest('ACTIVE', 'persisttest');       // SERVING: the worst case for (b)

  const info = [];
  const realInfo = console.info, realWarn = console.warn;
  console.info = (...a) => info.push(a.join(' '));
  console.warn = () => {};
  let threw = null;
  try { storage.ensureSeedData(); } catch (e) { threw = e; }
  finally { console.info = realInfo; console.warn = realWarn; }

  assert(threw === null,
    `[8] ensureSeedData() RETURNS CLEANLY in supabase mode (got ${threw && threw.name}) — it used to walk on into keys the adapter refuses and throw out of whatever called it, which on a boot path is a dead boot rather than a refusal`);
  assert(storage.USER_MUTABLE_KEYS.filter(k => store.has(k)).length === 0,
    '[8] not one USER_MUTABLE_KEY reached localStorage');
  const anyCfbp = [...store.keys()].filter(k => k.startsWith('cfbp_'));
  assert(anyCfbp.length === 0, `[8] …and NOTHING under cfbp_ did (found ${JSON.stringify(anyCfbp)})`);
  assert(sb.get('cfbp_settings') === null && sb.get('cfbp_players') === null && sb.get('cfbp_comments') === null,
    "[8] …and nothing reached the ADAPTER'S MIRROR either — including cfbp_settings, which a commissioner session IS permitted to write and which would have gone out as a real patch_kv on the next flush");
  assert(sb._dirtyKeysForTest().length === 0,
    '[8] …so no push was queued: the league on the server is untouched, not merely un-overwritten locally');
  assert(info.some(l => /seeding is skipped entirely/.test(l)),
    '[8] …and it said so on the console rather than returning in silence (AD-06: a no-op nobody can see is how the next caller gets written)');

  // { confirmEmpty: true } DOES NOT OVERRIDE IT. That flag answers "is this
  // SHEET really brand new" — a question the Supabase path never asks, because
  // an empty read there means the hydrate has not landed.
  [...store.keys()].filter(k => k.startsWith('cfbp_')).forEach(k => store.delete(k));
  let threw2 = null;
  try { storage.ensureSeedData({ confirmEmpty: true }); } catch (e) { threw2 = e; }
  assert(threw2 === null && [...store.keys()].filter(k => k.startsWith('cfbp_')).length === 0
    && sb.get('cfbp_players') === null,
    '[8] { confirmEmpty: true } seeds nothing in supabase mode either — the flag is about the Sheet, and the Supabase path has no question for it to answer');

  // NON-VACUITY, which is the half that matters: the SAME call still seeds in
  // 'local' mode. Without this, every assertion above would pass just as well
  // against an ensureSeedData() that had been deleted.
  sb._resetForTest();
  [...store.keys()].filter(k => k.startsWith('cfbp_')).forEach(k => store.delete(k));
  storage.setBackendMode('local');
  storage.ensureSeedData();
  const seededLocal = storage.USER_MUTABLE_KEYS.filter(k => store.has(k));
  assert(seededLocal.length === storage.USER_MUTABLE_KEYS.length,
    `[8] canary: in 'local' mode the SAME call seeds every one of them (${seededLocal.length}/${storage.USER_MUTABLE_KEYS.length})`);

  // And the googleSheets arm is untouched by either change: it still walks, and
  // it still refuses the user-mutable keys LOUDLY, by name.
  [...store.keys()].filter(k => k.startsWith('cfbp_')).forEach(k => store.delete(k));
  storage.setBackendMode('googleSheets');
  const warns = [];
  const realWarn2 = console.warn;
  console.warn = (...a) => warns.push(a.join(' '));
  try { storage.ensureSeedData(); } finally { console.warn = realWarn2; }
  assert(storage.USER_MUTABLE_KEYS.filter(k => store.has(k)).length === 0,
    '[8] googleSheets still refuses every user-mutable key exactly as it did before — the guard was widened, not moved');
  assert(warns.some(w => /REFUSING to seed user-mutable key/.test(w)) && warns.some(w => /RG-12/.test(w)),
    '[8] …loudly, by name, citing RG-12 — and the fact that this path still WARNS while supabase RETURNS is the difference between the two rules, not an inconsistency');
  // Read back through the SEAM, not the raw store: in googleSheets mode a write
  // lands in backend.js's mirror when it is hydrated and in localStorage when it
  // is not, and this assertion is about whether the walk RAN, not about where
  // one particular device happened to put the result.
  assert(storage.getSettings() && typeof storage.getSettings() === 'object'
    && Object.keys(storage.getSettings()).length > 0,
    '[8] …while still seeding the non-user-mutable defaults, which is what makes googleSheets a WALK and supabase a RETURN');

  [...store.keys()].filter(k => k.startsWith('cfbp_')).forEach(k => store.delete(k));
  storage.setBackendMode(modeBefore);
  sb._resetForTest();
}

// ═══════════════════════════════════════════════════════════════════════════
// [9] DI-T4.10 — A NOT-READY ADAPTER NEVER FALLS THROUGH TO RAW LOCAL STORAGE
//
// THE DEFECT, as js/supabase-backend.js's own module header reported it before
// Part B existed. DI §1.2's table routes load() to the adapter when
// `useBackend(key)` is true — and the obvious reading of `useBackend` is
// "mode AND ready", exactly as the googleSheets arm reads. Under that reading a
// HELD / HYDRATING / SWITCHING adapter makes useBackend() false and load() falls
// through to `localStorage.getItem`.
//
// WHICH IS FINE FOR SHEETS AND WRONG FOR SUPABASE. A Sheets device's mirror and
// its localStorage hold the SAME league, so the fall-through is a warm cache. A
// post-cutover device's localStorage holds LAST SEASON'S SHEET DATA under the
// very same `cfbp_*` keys — the first-boot wipe (§6.1) removes only
// `cfbp_sheet_mirror` and `cfbp_site_unlocked`, not the twenty-two league keys —
// so the fall-through serves the pre-migration league as though it were the
// live one, silently, on exactly the boots where the hydrate failed.
//
// So in `dataMode:'supabase'` the MODE decides the route and READINESS decides
// what the adapter answers: not ready ⇒ `null`.
console.log('\n[9] DI-T4.10 — in supabase mode a not-ready adapter answers null, never localStorage');
{
  const modeBefore = storage.getBackendMode();
  [...store.keys()].filter(k => k.startsWith('cfbp_')).forEach(k => store.delete(k));

  // SHEETS-ERA DATA ON THE DEVICE — the pre-cutover league, still sitting under
  // the same keys. This is the thing that must never be served.
  const staleRoster = [{ playerId: 'p_old', displayName: 'Last Season', active: true }];
  const stalePicks = [{ pickId: 'pk_old', weekId: 'w_old', gameId: 'g_old', playerId: 'p_old', selectedTeam: 'Old U' }];
  store.set('cfbp_players', JSON.stringify(staleRoster));
  store.set('cfbp_picks', JSON.stringify(stalePicks));
  store.set('cfbp_avail_games', JSON.stringify({ w_old: [{ gameId: 'g_old' }] }));

  storage.setBackendMode('local');
  assert(storage.getPlayers().length === 1 && storage.getPlayers()[0].playerId === 'p_old',
    "[9] fixture: in 'local' mode that stale data is exactly what load() serves — so the assertions below are about a real hazard");

  sb._resetForTest();                       // IDLE: constructed, nothing hydrated
  storage.setBackendMode('supabase');
  assert(sb.isReady() === false, '[9] fixture: the adapter is NOT ready');
  assert(storage.getPlayers().length === 0,
    `[9] getPlayers() answers EMPTY, not last season's roster (got ${JSON.stringify(storage.getPlayers())})`);
  assert(storage.getPicks().length === 0,
    '[9] …and getPicks() answers empty, not last season\'s picks');
  assert(store.get('cfbp_players') === JSON.stringify(staleRoster),
    '[9] …and the stale rows are still ON THE DEVICE — they are not served, and they are also not destroyed. Refusing to read is not the same as deleting, and only one of those is reversible');

  // DEVICE-LOCAL KEYS STILL FALL THROUGH, in every mode. They are the exception
  // the rule is written around, not a gap in it.
  assert(storage.getAvailableGames('w_old').length === 1,
    '[9] a DEVICE-LOCAL key still reads straight from localStorage — DEVICE_LOCAL_KEYS is checked first, in both arms, unchanged');

  // R2 — THE RELEASE. A ready adapter serves ITS mirror, and the stale rows
  // never reappear.
  sb._seedMirrorForTest('cfbp_players', [{ playerId: 'p_new', displayName: 'This Season', active: true }]);
  sb._setStateForTest('ACTIVE', 'persisttest');
  assert(sb.isReady() === true, '[9] R2: fixture — the adapter is serving');
  assert(storage.getPlayers().length === 1 && storage.getPlayers()[0].playerId === 'p_new',
    '[9] R2: load() now answers from the ADAPTER — the league the server actually holds');
  assert(!JSON.stringify(storage.getPlayers()).includes('p_old'),
    '[9] R2: …and nothing of the Sheets-era roster leaks into it');

  // A key the adapter simply has no value for is still null, not a fall-through.
  assert(storage.getPicks().length === 0,
    '[9] R2: a key the mirror does not hold answers EMPTY — "the adapter has no rows for this" and "look in localStorage instead" are different answers, and only the first is true');

  // The one-line rule, stated where a reader will find it.
  {
    const fs = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = fs.readFileSync(fileURLToPath(new URL('./js/storage.js', import.meta.url)), 'utf8');
    const fn = src.slice(src.indexOf('function useBackend(key)'), src.indexOf('function save(k,v,fields)'))
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
    assert(/if \(_backendMode === 'supabase'\) return true;/.test(fn),
      "[9] useBackend() returns true for supabase by MODE alone — readiness is not part of the routing question");
    assert(/if \(_backendMode === 'googleSheets'\) return isBackendReady\(\);/.test(fn),
      '[9] …while the googleSheets arm still asks isBackendReady(), byte-identically to before');
    assert(/sb\.isReady\(\) \? sb\.get\(k\) : null/.test(fn),
      '[9] …and load() answers null for a not-ready adapter rather than reaching localStorage');
  }

  [...store.keys()].filter(k => k.startsWith('cfbp_')).forEach(k => store.delete(k));
  sb._resetForTest();
  storage.setBackendMode(modeBefore);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, 0 failed`);
else { console.error(`❌ ${fail} FAILED — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
