/**
 * CFB Pickems — almatest.mjs
 * ==========================
 * Design Inputs — ONE derived alma-mater roster, not two lists (Drew,
 * 2026-09-04, verbatim, correcting the two-list build almatest.mjs
 * originally shipped against — commits 8ae64f4/55f8908): "the roster of
 * alma maters (such as alma mater watch and those filtered in the slate
 * builder) should only be comprised of schools claimed as alma maters by a
 * player. If a player changes their claimed alma mater, this should also
 * change everything else related to alma maters."
 *
 * Run:  node almatest.mjs
 * Also: TZ=UTC node almatest.mjs && TZ=America/Los_Angeles node almatest.mjs
 *
 * WHAT CHANGED (2026-09-04, LATEST revision — RG-55, a deploy blocker found by
 * measurement before review)
 * ---------------------------------------------------------------------------
 *  - NEW §16. Item 1's dropdown cached ESPN's 760-team catalog with
 *    `saveSetting('espnTeamsCache', …)`. `cfbp_settings` is one seam key →
 *    one Google Sheets cell (backend/Code.gs, no chunking, no size check),
 *    Sheets caps a cell at 50,000 chars, and the measured blob came to
 *    89,148 — including `adminPasswordHash` and the site PIN. §16 drives the
 *    modal at real scale and measures the serialized blob (now 405 chars).
 *  - §15 CHANGED, not merely extended — three of its assertions ENCODED the
 *    defect and had to be rewritten, which is called out inline at both
 *    sites rather than quietly edited: §15a looked teams up by `t.id`
 *    (fetchEspnTeamsList no longer emits id/name/abbreviation — nothing read
 *    them, and they were 39,005 of 88,725 chars), and §15d asserted the
 *    cache was readable back out of `getSettings().espnTeamsCache`, i.e. it
 *    asserted the bug. Cache presence is now proven behaviourally; its
 *    absence from the seam is asserted directly.
 *
 * WHAT CHANGED (2026-09-04, PRIOR revision — clears the reviewer BLOCK, F1/F2/
 * F4/F5, plus item 1's ESPN-canonical dropdown)
 * ---------------------------------------------------------------------------
 *  - F1: recomputeAlmaMaterFlags() now ALSO re-flags the Available-Games POOL
 *    (getAvailableGames/saveAvailableGames), not just the slate — §4 extended,
 *    §10's fixture now populates and asserts on both storage keys, scoring
 *    the SLATE BUILDER off the pool the way renderCommPage() actually does.
 *  - F2: §14 restores 8ae64f4's dropped behavioral proof that
 *    fetchByDateRange threads the passed `almaMaters` list through to
 *    parse-time isAlmaMaterGame flagging, PLUS a tmpdir mutation battery —
 *    see §14's own header comment for a correction to the brief's cited line
 *    (data-provider.js:110 turns out to be dead code for this purpose; the
 *    battery targets the line that's actually load-bearing, proven both ways).
 *  - F4: §13 — the tiebreaker Auto-Calc roster now freezes at LOCK
 *    (`week.lockedAlmaMaters`, mirroring `game.lockedSpread`) via
 *    `almaMatersForAutoCalc()` (app.js), snapshotted by BOTH
 *    `applyWeekStatusChange()` (manual lock) and `tickAutoTransition()`
 *    (auto-lock) — two independent paths to LOCKED, both now frozen.
 *  - F5: renderAlmaMaterRankings()'s claimant lookup is now case/whitespace-
 *    insensitive and active-only, matching claimedAlmaMaters()/claimantsOf()
 *    — dedicated fixtures appended to the end of §5 (deactivated-claimant
 *    attribution + whitespace-only mismatch, each reproduced against the
 *    OLD shape's exact failure mode, plus a positive control).
 *  - Item 1 ("Do the dropdown"): §8 rewritten — showEditPlayerModal()'s
 *    free-text `<input>` + `<datalist>` is replaced by an ESPN-canonical
 *    `<select>` (fetchEspnTeamsList(), data-provider.js, cached via
 *    saveSetting('espnTeamsCache', …)/getSettings() — no new KEYS entry;
 *    SUPERSEDED 2026-09-04 by RG-55, see §16: the cache is in-memory now).
 *    §1 gains the exact-equality-first proof this enables in
 *    getAlmaMaterMatch() (data-model.js) — see its own docstring. §15 covers
 *    fetchEspnTeamsList() itself: parsing, the duplicate-`location`
 *    collision (Charlotte/Roosevelt/Troy — fixture uses Washington/Miami
 *    analogues), the offline fallback, and the modal's cache.
 *
 * WHAT CHANGED (2026-09-04, PRIOR revision, for context)
 * ------------------------------------------
 * 8ae64f4 built a commissioner-editable `settings.almaMaters` roster
 * (add/remove buttons in a Settings card) SEPARATE from `claimedAlmaMaters()`
 * (distinct schools among active players' `player.almaMater`, used only by
 * the tiebreaker Auto-Calc). Drew rejected that split outright: there is ONE
 * roster, and it IS the claimed set. This revision:
 *  - Deletes `activeAlmaMaters()` and every settings.almaMaters read/write.
 *    `claimedAlmaMaters()` is now the ONLY roster accessor, feeding Alma
 *    Mater Watch, Alma Mater Rankings, the ⭐ `isAlmaMaterGame` flag (both
 *    ESPN parse-time and the manual Game Modal), the slate builder's Tier 1
 *    guarantee, the Rules tab list, and the tiebreaker Auto-Calc.
 *  - Removes `almaMaters` from DEFAULT_SETTINGS entirely (data-model.js).
 *  - Replaces the Settings-tab add/remove card with a READ-ONLY summary,
 *    extracted into its own exported `renderAlmaMaterSettingsCard()`
 *    (mirrors renderAlmaMaterWatch()/renderAlmaMaterRankings()'s shape,
 *    directly testable without invoking renderCommPage()'s whole closure).
 *  - Replaces showEditPlayerModal()'s `<select>` dropdown (bounded to the
 *    "active roster") with a free-text `<input list=…>` + `<datalist>` of
 *    ALMA_MATERS catalog suggestions — any school can be claimed, catalog
 *    member or not. Saving now calls `recomputeAlmaMaterFlags()` so a
 *    changed claim ripples to open/upcoming weeks' ⭐ flag immediately.
 *  - Same ripple added to the player active/inactive toggle handler
 *    (deactivating the sole claimant of a school removes it from the
 *    derived roster too — a corollary of the derived model, not a named
 *    Design Input; flagged in the handoff report for Drew/reviewer).
 *
 * WHAT THIS FILE DROPPED FROM ITS PRIOR REVISION (encoded the rejected model)
 * -----------------------------------------------------------------------------
 *  - "DEFAULT_SETTINGS.almaMaters — shape" (no field anymore to have a shape)
 *  - "storage seam round-trip — getSettings()/saveSetting('almaMaters', …)"
 *    (no field to round-trip)
 *  - "activeAlmaMaters() — reads the setting, falls back safely" (function
 *    deleted)
 *  - The Commissioner Settings-card add/remove click-handler tests (buttons
 *    deleted; replaced by §7's read-only render test)
 *  - showEditPlayerModal's "(not in current list)" labeling proof (no such
 *    concept once the field accepts anything)
 *  - **NOT DISCLOSED AT THE TIME, found by the reviewer (F2, 2026-09-04):**
 *    8ae64f4's own §5 — "data-provider.js: parse-time isAlmaMaterGame honors
 *    the passed list" — a BEHAVIORAL proof through fetchByDateRange, was
 *    ALSO dropped in this same rewrite, and this list (written at the time)
 *    never named it. A reviewer mutation of the pass-through went undetected
 *    as a result. Restored as §14 below, with the gap itself now named here
 *    instead of silently repeating it.
 * See almatotaltest.mjs's own header for the parallel updates made there
 * (§3/§6/§7 reworded to drop "roster vs. claimed" framing that no longer
 * describes two different things).
 *
 * DIVISION OF LABOR WITH almatotaltest.mjs
 * -------------------------------------------
 * almatotaltest.mjs owns calculateAlmaMaterTotal()'s math, its mutation
 * battery, and the structural call-site scans. This file owns the
 * RENDER/WIRING side: who reads claimedAlmaMaters(), and whether a changed
 * claim actually reaches every consumer.
 *
 * FIXTURE DISCIPLINE (same constraints as slatetest.mjs/tbdtest.mjs/ranktest.mjs)
 * --------------------------------------------------------------------------
 * 1. Every negative assertion ("Purdue no longer matches") is paired with a
 *    same-fixture positive check that the pool/render path actually
 *    produced something real (proves the assertion isn't vacuous).
 * 2. Fixtures are not constructed in the order they're asserted back out.
 * 3. No `git checkout`/`restore`/`stash` anywhere in this file. §14
 *    (2026-09-04) is the one exception to "no mutation battery here" below —
 *    it mutates a tmpdir COPY of data-provider.js/data-model.js only, never
 *    real source (cleaned up + byte-identity-checked at the end of §14). A
 *    full mutation battery for app.js's own render functions was still
 *    judged not worth the cost of copying app.js's whole ~12-module
 *    dependency closure into a tmpdir — the pattern slatetest.mjs uses for
 *    the 2-file data-model.js/data-provider.js system — flagged explicitly
 *    as a coverage gap, not a silent omission. §12's structural residue scan
 *    is source-text only, no mutation.
 *
 * SECTIONS
 *   1  getAlmaMaterMatch(teamName, almaMaters) — configurable list, the
 *      documented precision tradeoff for a non-catalog claim, AND (2026-09-04)
 *      the exact-equality-first proof item 1's dropdown enables
 *   2  DEMO_PLAYERS — Kevin is Notre Dame, no entry still says Purdue
 *   3  claimedAlmaMaters() — derived, not settings-backed; a stray
 *      settings.almaMaters field (leftover from before this fix) is ignored
 *   4  recomputeAlmaMaterFlags() — DRAFT/OPEN recomputed, LOCKED/LIVE/FINAL
 *      left alone
 *   5  renderAlmaMaterWatch/renderAlmaMaterRankings — driven by claims, PLUS
 *      (2026-09-04) F5's dedicated fixtures: the claimant-name lookup is
 *      case/whitespace-insensitive and active-only
 *   6  renderRulesPage — driven by claims, escHtml'd
 *   7  renderAlmaMaterSettingsCard() — READ-ONLY summary, no add/remove UI
 *   8  showEditPlayerModal — ESPN-canonical <select> (2026-09-04, was
 *      free-text + datalist), real #ep-save ripple
 *   9  toggle-active ripple — deactivating the sole claimant clears the roster
 *  10  THE FULL RIPPLE — one claim change reaches Watch, Rankings, the ⭐
 *      flag, Tier 1 (scored from the POOL, per F1), the Rules list, and the
 *      Auto-Calc, end to end
 *  11  A freely-typed non-catalog claim — works, and its documented
 *      precision gap is proven behaviorally (not just via getAlmaMaterMatch)
 *  12  Structural residue scan — the rejected two-list model left nothing
 *      behind in js/app.js or js/data-model.js
 *  13  F4 (2026-09-04, clearing the reviewer BLOCK) — the tiebreaker
 *      Auto-Calc roster freezes at LOCK, mirroring game.lockedSpread:
 *      almaMatersForAutoCalc()'s read side, applyWeekStatusChange()'s
 *      manual-lock write side, tickAutoTransition()'s independent auto-lock
 *      write side, and the pre-migration (no-snapshot) fallback
 *  14  F2 (2026-09-04, clearing the reviewer BLOCK) — restores 8ae64f4's
 *      dropped behavioral proof that data-provider.js threads the passed
 *      `almaMaters` list through to parse-time isAlmaMaterGame flagging via
 *      fetchByDateRange, PLUS a tmpdir mutation battery (deletion AND
 *      inversion). Includes a measured CORRECTION to the brief's cited
 *      line — see its own header comment. Appended rather than renumbered
 *      into the old §5 slot so every existing section above keeps its number.
 *  15  item 1 — fetchEspnTeamsList() itself (data-provider.js): response
 *      parsing, the duplicate-`location` collision, the offline-fallback
 *      throw contract, and showEditPlayerModal()'s cache (fetch-once,
 *      reuse-after)
 *  16  RG-55 (2026-09-04) — the ESPN team catalog never reaches the synced
 *      settings blob. Real 760-team fixture; measures the serialized
 *      `cfbp_settings` payload against Google Sheets' 50,000-char cell cap,
 *      proves the trim, proves the cache still caches, proves the offline
 *      fallback still saves, and holds a bounded-size allow-list of every
 *      settings key app.js/storage.js writes
 *  17  BUG-1 (fb_1788538501410_9egx9, 2026-09-12) — Alma Mater Watch AND
 *      Alma Mater Rankings order by CURRENT AP rank, not player-roster
 *      order: ranked ascending → unranked → BYE (BYE by last known rank),
 *      ties keeping claimedAlmaMaters() order; the order re-derives on every
 *      render when ranks change; week.lockedAlmaMaters (AD-34) is never read
 *      for display order; plus direct unit coverage of the pure
 *      sortAlmaMaterEntries() comparator both renderers share
 *  18  BUG-6 (fb_1788651890158_fva84, 2026-09-12) — Alma Mater Rankings
 *      lists EVERY active claimant of a shared school ("Drew, Kihoon"), not
 *      just the first: renderAlmaMaterRankings()'s getPlayers().find() is
 *      replaced by the shared almaMaterClaimants() predicate the Settings-
 *      tab card also calls (keeping F5's "all three predicates agree" true
 *      structurally). Confirms renderAlmaMaterWatch names no players at all
 */

/*
 * WHAT CHANGED (2026-09-12) — §17 and §18 appended for BUG-1 and BUG-6, both
 * filed by Drew via the in-app feedback form. Appended rather than
 * renumbered into the render section (§5) so every existing section keeps
 * its number; §5 still owns the claim-driven render wiring and F5's
 * claimant-normalisation fixtures, §17/§18 own ORDER and MULTI-CLAIMANT.
 * Both bugs live in the same two functions and share these fixtures.
 */

// Node built-ins for §14's mutation battery — same tmpdir-copy discipline as
// slatetest.mjs's §[M] (CLAUDE.md: never git checkout/restore/stash to undo a
// mutation; mutate a COPY under os.tmpdir(), never real source).
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// ── DOM / localStorage stubs (slatetest.mjs shape — registered elements that
//    remember listeners, so real click handlers can be driven end to end) ──
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();
const selectorSets = new Map();
let lastToasts = [];

function makeEl(id) {
  const listeners = new Map();
  const e = {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    appendChild(child) { if (id === 'toast-container') lastToasts.push(child.innerHTML); },
    removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: sel => bySelector(sel),
    querySelectorAll: sel => selectorSets.get(sel) || [],
    closest: () => null,
    _fire(type, ev = {}) {
      const fns = listeners.get(type) || [];
      if (!fns.length) throw new Error(`almatest: nothing bound to '${type}' on #${id}`);
      for (const fn of fns) fn({ target: e, ...ev });
    },
  };
  return e;
}
function el(id) { if (!registry.has(id)) registry.set(id, makeEl(id)); return registry.get(id); }
function bySelector(sel) {
  if (typeof sel === 'string' && sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
  const set = selectorSets.get(sel);
  return set && set.length ? set[0] : null;
}
function resetDom() { registry.clear(); selectorSets.clear(); lastToasts = []; }

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => bySelector(sel),
  querySelectorAll: sel => selectorSets.get(sel) || [],
  createElement: () => makeEl('__toast__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

globalThis.fetch = async () => { throw new Error('network disabled in almatest (mock it per-section)'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const dm = await import('./js/data-model.js');
const storage = await import('./js/storage.js');
const dp = await import('./js/data-provider.js');
const app = await import('./js/app.js');

const { ALMA_MATERS, ALMA_MATER_EXCLUDE_PATTERNS, getAlmaMaterMatch, DEFAULT_SETTINGS, DEMO_PLAYERS, WEEK_STATUS, GAME_STATUS } = dm;
const { scoreCandidateGames, buildSuggestedSlate, fetchByDateRange, fetchEspnTeamsList } = dp;
const {
  claimedAlmaMaters, recomputeAlmaMaterFlags, almaMatersForAutoCalc,
  renderAlmaMaterWatch, renderAlmaMaterRankings, renderRulesPage,
  renderAlmaMaterSettingsCard, showEditPlayerModal, bindCommEventListeners,
  applyWeekStatusChange, tickAutoTransition,
} = app;

console.log('[almatest] data-model.js exports —', Object.keys(dm).length);
console.log('[almatest] data-provider.js exports —', Object.keys(dp).length);
console.log('[almatest] app.js exports —', Object.keys(app).length);

assert(typeof app.activeAlmaMaters === 'undefined', 'fixture check: activeAlmaMaters() no longer exists as an app.js export — the two-list model is genuinely gone, not just unused');
assert(typeof renderAlmaMaterSettingsCard === 'function', 'fixture check: renderAlmaMaterSettingsCard() is exported (extracted for direct testability)');

function freshWeek(o = {}) {
  return {
    weekId: 'aw1', weekNumber: 1, label: 'Week 1', season: 2026,
    status: 'open', dataSourceMode: 'espn_historical',
    picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
    actualTiebreakerValue: null, tiebreakerFinalized: false,
    tiebreakerCalculationMode: 'selectedSlateOnly',
    blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
    ...o,
  };
}
let _gid = 0;
function freshGame(o = {}) {
  _gid++;
  return {
    gameId: `ag${_gid}`, weekId: 'aw1',
    homeTeam: 'Home', awayTeam: 'Away', homeMascot: '', awayMascot: '',
    homeConference: '', awayConference: '', homeRank: null, awayRank: null,
    kickoff: '2026-09-08T18:00:00Z', kickoffConfirmed: true, timeWindow: 'afternoon',
    spread: null, favorite: null, lockedSpread: null,
    homeScore: null, awayScore: null,
    status: 'scheduled', actualWinner: null, atsWinner: null,
    isAlmaMaterGame: false, nationalTV: false, broadcastNetwork: null, marqueeEvent: false,
    multiplier: 1, isManual: false, neutralSite: false,
    dataSource: 'espn_historical', dataQuality: 'confirmed', spreadSource: 'espn',
    espnEventId: null,
    ...o,
  };
}
let _pid = 0;
function freshPlayer(o = {}) {
  _pid++;
  return {
    playerId: `ap${_pid}`, displayName: `Player${_pid}`, initials: `P${_pid}`,
    email: '', active: true, almaMater: '', pinHash: '',
    createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    ...o,
  };
}

/**
 * The FULL source text of a function — declaration through its own closing
 * brace, located by brace matching, never by a fixed-length slice.
 *
 * Reviewer note 2 (2026-09-12): §17j used to slice a fixed 4000 characters
 * from `export function renderAlmaMaterWatch`. That function's body grew to
 * ~4.3k in the BUG-1 pass, so a `lockedAlmaMaters` read inserted at the TAIL
 * of the body landed OUTSIDE the window and the guard stayed green against
 * the exact mutation it exists to catch. Every source-window guard in this
 * file that means "this whole function" now goes through here, and asserts
 * that the window actually reached the closing brace.
 */
function fnBodySrc(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start); i >= 0 && i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] getAlmaMaterMatch(teamName, almaMaters) — configurable list…');
{
  // Default (no 2nd arg) — unchanged behavior, full catalog, backward compat
  // for every caller not yet migrated (scoring.js's internal call, notably).
  assert(getAlmaMaterMatch('Purdue') === 'Purdue', 'default (no list arg): Purdue still matches the full catalog');
  assert(getAlmaMaterMatch('Notre Dame') === 'Notre Dame', 'default: Notre Dame still matches');

  // A trimmed list (a school no active player claims this week) — a real
  // shape claimedAlmaMaters() produces whenever fewer than 6 players claim
  // catalog schools.
  const trimmed = ALMA_MATERS.filter(a => a !== 'Purdue');
  assert(getAlmaMaterMatch('Purdue', trimmed) === null, 'Purdue does NOT match once no one claims it (absent from the passed list)');
  assert(getAlmaMaterMatch('Purdue Boilermakers', trimmed) === null, 'fixture check: the exact-pattern form ("Purdue Boilermakers") ALSO stops matching — not just the bare key');
  assert(getAlmaMaterMatch('Notre Dame', trimmed) === 'Notre Dame', 'fixture check: Notre Dame still matches with Purdue removed — the trim did not break its siblings (not vacuous)');
  assert(getAlmaMaterMatch('Texas A&M Aggies', trimmed) === 'Texas A&M', 'fixture check: another untouched school (Texas A&M, via its exact pattern) still matches too');

  // A brand-new school NOT in the catalog at all — rule 1 (the key itself is
  // always a valid pattern) makes it work with zero new pattern data. This
  // is what a freely-typed, non-catalog claim resolves through.
  const withNewSchool = ['Notre Dame', 'Clemson'];
  assert(getAlmaMaterMatch('Clemson', withNewSchool) === 'Clemson', 'a claimed school with NO catalog pattern data still matches via the word-aware key-itself fallback');
  assert(getAlmaMaterMatch('Clemson Tigers', withNewSchool) === 'Clemson', 'word-aware matching also finds the bare key inside a longer ESPN displayName for the new school');
  assert(getAlmaMaterMatch('South Carolina', withNewSchool) === null, 'an unrelated school is still correctly NOT matched against the custom list');

  // Exclude patterns still apply for a catalog school claimed via a custom list.
  const withArkansas = ['Arkansas'];
  assert(getAlmaMaterMatch('Arkansas', withArkansas) === 'Arkansas', 'fixture check: Arkansas itself matches via a custom single-school list');
  assert(getAlmaMaterMatch('Arkansas State', withArkansas) === null, 'ALMA_MATER_EXCLUDE_PATTERNS still excludes Arkansas State even for a trimmed/custom list');
  assert(Array.isArray(ALMA_MATER_EXCLUDE_PATTERNS['Arkansas']) && ALMA_MATER_EXCLUDE_PATTERNS['Arkansas'].includes('Arkansas State'),
    'fixture check: the exclude-pattern catalog entry the assertion above depends on genuinely exists (not vacuous)');

  // THE DOCUMENTED PRECISION TRADEOFF (data-model.js's getAlmaMaterMatch
  // docstring, this revision): a non-catalog claim gets word-boundary
  // bare-name matching only, with NO exclude-pattern protection against a
  // same-prefix sibling program. "Washington" has no catalog entry at all —
  // unlike Miami (which DOES have an exclude entry protecting it), a claimed
  // "Washington" WILL also match "Washington State".
  assert(!('Washington' in ALMA_MATER_EXCLUDE_PATTERNS), 'fixture check: Washington genuinely has no exclude-pattern entry — the gap this assertion documents is real, not simulated');
  const withWashington = ['Washington'];
  assert(getAlmaMaterMatch('Washington', withWashington) === 'Washington', 'fixture check: the claimed school correctly matches its own team name (not vacuous)');
  assert(getAlmaMaterMatch('Washington State', withWashington) === 'Washington', 'DOCUMENTED PRECISION GAP: a non-catalog claim of "Washington" also matches "Washington State" — no exclude entry exists to stop it, unlike the six catalog schools');
  // Positive control — the SAME word-prefix shape, but for a catalog school
  // WITH an exclude entry (Arkansas/Arkansas State), does NOT false-positive —
  // proves the gap is specific to non-catalog claims, not a universal bug.
  assert(getAlmaMaterMatch('Arkansas State', ['Arkansas']) === null, 'fixture check: the identical word-prefix shape does NOT false-positive for a CATALOG school with an exclude entry — the gap is isolated to non-catalog claims');

  // EXACT EQUALITY FIRST (item 1, 2026-09-04 — the ESPN-canonical dropdown,
  // "Do the dropdown"). This is the concrete correctness fix, not a
  // shortcut: proven with a BEFORE/AFTER reference implementation of the
  // OLD (pre-this-batch) matching order, so the divergence is measured, not
  // assumed.
  const oldGetAlmaMaterMatch = (teamName, list) => {
    // The exact pre-fix loop, copied here as an inert reference (never
    // touches real source — CLAUDE.md's mutation-testing discipline extends
    // naturally to "never re-derive a fixed reference by importing/mutating
    // the module under test").
    if (!teamName) return null;
    const tLow = teamName.trim().toLowerCase();
    const wordAwareIncludes = (haystack, needle) => {
      const n = needle.toLowerCase();
      const idx = haystack.indexOf(n);
      if (idx === -1) return false;
      const before = idx === 0 ? '' : haystack[idx - 1];
      const after  = idx + n.length >= haystack.length ? '' : haystack[idx + n.length];
      const isWordChar = c => /[a-z0-9]/.test(c);
      return (!before || !isWordChar(before)) && (!after || !isWordChar(after));
    };
    for (const alma of list) {
      const excludes = ALMA_MATER_EXCLUDE_PATTERNS[alma] || [];
      if (excludes.some(ex => tLow.includes(ex.toLowerCase()))) continue;
      const patterns = new Set([alma]);
      if ([...patterns].some(p => wordAwareIncludes(tLow, p))) return alma;
    }
    return null;
  };
  const bothClaimed = ['Washington', 'Washington State']; // two DIFFERENT players, two DIFFERENT dropdown claims
  assert(oldGetAlmaMaterMatch('Washington State', bothClaimed) === 'Washington',
    'fixture check (THE BUG, reference implementation): the OLD matching order resolves "Washington State" the TEAM to the "Washington" CLAIM — wrong claimant — because the loop hits "Washington"\'s word-boundary substring before ever reaching "Washington State"\'s own entry. Proves the divergence below is real, not assumed.');
  assert(getAlmaMaterMatch('Washington State', bothClaimed) === 'Washington State',
    'THE FIX: exact-equality-first resolves "Washington State" the team to the "Washington State" claim — the SAME two-claim list the reference above got wrong');
  assert(getAlmaMaterMatch('Washington', bothClaimed) === 'Washington',
    'fixture check: "Washington" the team still resolves to the "Washington" claim, not its sibling — both sides of the pair are correct simultaneously');
  assert(oldGetAlmaMaterMatch('Washington', bothClaimed) === 'Washington',
    'fixture check: the OLD code got THIS side right by coincidence (list order) — underscoring that the bug was order-dependent, not a total failure, which is exactly why it went unnoticed');

  // Exact-first also short-circuits for the SIX catalog schools — a claim
  // stored as the bare canonical name (what the dropdown stores, and what
  // every existing catalog claim already looks like) resolves without ever
  // touching ALMA_MATER_EXACT_PATTERNS/ALMA_MATER_EXCLUDE_PATTERNS.
  assert(getAlmaMaterMatch('Oklahoma', ['Oklahoma']) === 'Oklahoma', 'exact-first: a bare catalog claim matches its own bare team name with no pattern-list involvement');
  assert(getAlmaMaterMatch('Oklahoma State', ['Oklahoma']) === null, 'fixture check: exact-first does not ALSO make "Oklahoma State" match "Oklahoma" — it fails exact equality and correctly falls through to the (still-protective, catalog) exclude pattern');

  // Exact-first does not break the EXISTING alias fallback for a team name
  // that is legitimately NOT identical to the claim string (ESPN sometimes
  // returns "Southern California" for USC-class teams — see
  // ALMA_MATER_EXACT_PATTERNS.USC) — the pattern loop still runs when exact
  // equality genuinely doesn't apply.
  assert(getAlmaMaterMatch('Southern California', ['USC']) === 'USC', 'exact-first correctly does NOT match ("usc" !== "southern california"), so control falls through to the existing alias pattern, which still resolves it — the fallback survives, it is not bypassed');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] DEMO_PLAYERS — Kevin…');
{
  const kevin = DEMO_PLAYERS.find(p => p.playerId === 'p3');
  assert(!!kevin && kevin.displayName === 'Kevin', 'fixture check: p3 is genuinely Kevin (not vacuous)');
  assert(kevin.almaMater === 'Notre Dame', `Kevin's DEMO_PLAYERS alma mater is Notre Dame (got "${kevin?.almaMater}")`);
  assert(!DEMO_PLAYERS.some(p => p.almaMater === 'Purdue'), 'no DEMO_PLAYERS entry still says Purdue (structural sweep, not just Kevin)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] claimedAlmaMaters() — derived, not settings-backed…');
{
  localStorage.clear();
  assert(!('almaMaters' in DEFAULT_SETTINGS), 'DEFAULT_SETTINGS no longer carries an almaMaters field at all');

  // Fixtures interleaved — the inactive player and the duplicate-school
  // player are NOT placed in claim order, so a positional bug would surface.
  storage.addPlayer(freshPlayer({ playerId: 'c1', displayName: 'Kihoon', almaMater: 'Texas A&M', active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'c2', displayName: 'Ghost', almaMater: 'Georgia', active: false })); // inactive
  storage.addPlayer(freshPlayer({ playerId: 'c3', displayName: 'Drew', almaMater: 'Texas A&M', active: true })); // shares c1's school
  storage.addPlayer(freshPlayer({ playerId: 'c4', displayName: 'NoSchool', almaMater: '', active: true })); // blank

  const claimed = claimedAlmaMaters();
  assert(claimed.filter(a => a === 'Texas A&M').length === 1, `Texas A&M, claimed by BOTH Kihoon and Drew, appears exactly ONCE — got ${claimed.filter(a => a === 'Texas A&M').length} occurrences`);
  assert(!claimed.includes('Georgia'), 'the INACTIVE player\'s school is excluded entirely');
  assert(!claimed.some(a => a === ''), 'a blank almaMater contributes nothing');
  assert(claimed.length === 1, `fixture check: exactly ONE distinct claimed school (Texas A&M) among active players — got ${claimed.length}: ${JSON.stringify(claimed)}`);
  assert(!claimed.includes('Purdue') && !claimed.includes('Oklahoma') && !claimed.includes('USC') && !claimed.includes('Arkansas'),
    'schools NOBODY claims (including catalog schools) do not appear in the derived roster at all — "unclaimed school in the roster" is not a concept this model has');

  // A stray settings.almaMaters field — the exact leftover shape from
  // before this fix (someone's device saved a settings blob while 8ae64f4/
  // 55f8908 was live, or a test elsewhere wrote one) — must be completely
  // inert. getSettings()'s DEFAULT_SETTINGS spread no longer seeds the
  // field, but a directly-written stored blob CAN still carry it; nothing
  // may read it.
  storage.saveSettings({ almaMaters: ['Oklahoma', 'USC', 'Arkansas'], weeklyGameCount: 10 });
  const claimedAfterStrayField = claimedAlmaMaters();
  assert(JSON.stringify(claimedAfterStrayField) === JSON.stringify(claimed),
    'a stray settings.almaMaters field (leftover from the rejected model) does not change claimedAlmaMaters() at all — the field is genuinely dead, not just unread by convention');

  // Case-insensitive dedupe, defensively (CONVENTIONS #7).
  localStorage.clear();
  storage.addPlayer(freshPlayer({ playerId: 'ci1', almaMater: 'Oklahoma', active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'ci2', almaMater: 'oklahoma', active: true }));
  const ciClaimed = claimedAlmaMaters();
  assert(ciClaimed.length === 1, `case-variant duplicates ("Oklahoma" / "oklahoma") still collapse to ONE entry — got ${JSON.stringify(ciClaimed)}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] recomputeAlmaMaterFlags() — DRAFT/OPEN recomputed, LOCKED/LIVE/FINAL left alone…');
{
  localStorage.clear();
  const openWeek  = freshWeek({ weekId: 'open_w', status: WEEK_STATUS.OPEN });
  const finalWeek = freshWeek({ weekId: 'final_w', status: WEEK_STATUS.FINAL });
  storage.saveWeek(openWeek);
  storage.saveWeek(finalWeek);

  const openPurdue  = freshGame({ gameId: 'op1', weekId: 'open_w',  homeTeam: 'Purdue',  awayTeam: 'Iowa',    isAlmaMaterGame: true });
  const openClemson = freshGame({ gameId: 'op2', weekId: 'open_w',  homeTeam: 'Clemson', awayTeam: 'Miami',   isAlmaMaterGame: false });
  const finalPurdue = freshGame({ gameId: 'fp1', weekId: 'final_w', homeTeam: 'Purdue',  awayTeam: 'Illinois',isAlmaMaterGame: true, status: 'final', homeScore: 20, awayScore: 10 });
  storage.saveGame(openPurdue);
  storage.saveGame(openClemson);
  storage.saveGame(finalPurdue);

  const newClaims = ['Notre Dame', 'Clemson']; // Purdue no longer claimed, Clemson newly claimed
  const changed = recomputeAlmaMaterFlags(newClaims);

  assert(storage.getGame('op1').isAlmaMaterGame === false, 'OPEN week: the stale Purdue flag is recomputed to false against the new claims');
  assert(storage.getGame('op2').isAlmaMaterGame === true, 'OPEN week: the Clemson game is recomputed to true — a newly-claimed school is picked up going forward');
  assert(storage.getGame('fp1').isAlmaMaterGame === true, 'FINAL week: the Purdue flag is LEFT UNTOUCHED even though it would no longer match — already-settled weeks are not silently rewritten');
  assert(changed === 2, `changedGames counts exactly the 2 OPEN-week games that actually flipped, not the FINAL week's unchanged one (got ${changed})`);

  const changedAgain = recomputeAlmaMaterFlags(newClaims);
  assert(changedAgain === 0, 'a second call with the identical claim list reports 0 changed games (not vacuously non-zero every time)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] renderAlmaMaterWatch / renderAlmaMaterRankings — driven by claims…');
{
  localStorage.clear();
  const week = freshWeek({ weekId: 'watch_w' });
  storage.saveWeek(week);
  const ndGame = freshGame({ weekId: 'watch_w', homeTeam: 'Notre Dame', awayTeam: 'Stanford', homeRank: 12 });
  storage.saveGame(ndGame);

  // ONE player claims Notre Dame — the roster IS this claim, not a stored list.
  storage.addPlayer(freshPlayer({ playerId: 'wp1', displayName: 'Kevin', almaMater: 'Notre Dame', active: true }));

  const watchHtml = renderAlmaMaterWatch('watch_w');
  assert((watchHtml.match(/alma-watch-row/g) || []).length === 1, `renderAlmaMaterWatch() emits exactly one row for a single claimed school (got ${(watchHtml.match(/alma-watch-row/g) || []).length})`);
  assert(watchHtml.includes('Notre Dame'), 'fixture check: the one row rendered is genuinely Notre Dame\'s (not vacuous)');
  assert(!watchHtml.includes('Purdue') && !watchHtml.includes('Oklahoma') && !watchHtml.includes('Texas A&amp;M') && !watchHtml.includes('USC'),
    'catalog schools NOBODY claims get no row at all — not a hidden/BYE row, genuinely absent');

  const rankHtml = renderAlmaMaterRankings();
  assert((rankHtml.match(/alma-rank-row/g) || []).length === 1, 'renderAlmaMaterRankings() also emits exactly one row for the same single claim');
  assert(rankHtml.includes('#12 AP'), 'fixture check: the Notre Dame row shows its real AP rank (not vacuous)');

  // A second player claims a brand-new (non-catalog) school with no game on
  // this week's slate — BYE row proof (UN-74), now driven by a real claim
  // rather than a configured list.
  storage.addPlayer(freshPlayer({ playerId: 'wp2', displayName: 'Reviewer', almaMater: 'Clemson', active: true }));
  const watchHtml2 = renderAlmaMaterWatch('watch_w');
  assert((watchHtml2.match(/alma-watch-row/g) || []).length === 2, 'a second distinct claim renders a second row');
  assert(watchHtml2.includes('Clemson') && watchHtml2.includes('BYE'), 'the newly-claimed school with no game on the slate renders a BYE row, not an error/blank');

  // Two players sharing a school — the row count does NOT double.
  storage.addPlayer(freshPlayer({ playerId: 'wp3', displayName: 'Brayden', almaMater: 'notre dame', active: true })); // case-variant, same school
  const watchHtml3 = renderAlmaMaterWatch('watch_w');
  assert((watchHtml3.match(/alma-watch-row/g) || []).length === 2, 'a THIRD player claiming the SAME school (case-variant) does not add a third row — still 2');

  // F5 (2026-09-04, clearing the reviewer BLOCK) — renderAlmaMaterRankings()'s
  // claimant-name lookup, its own dedicated fixture (a fresh roster; the one
  // above already has three overlapping claims and isn't a clean base for
  // this).
  localStorage.clear();
  // Failure mode 1 — an INACTIVE player, listed FIRST, with the identical
  // stored casing as an ACTIVE player listed second. claimedAlmaMaters()
  // correctly excludes the inactive one (its own .filter(p=>p.active)), but
  // the OLD `getPlayers().find(p => p.almaMater === alma)` had no active
  // filter at all — .find() returns whichever player is FIRST in the
  // unfiltered array, which is the INACTIVE one here, attributing the
  // school to a deactivated player.
  storage.addPlayer(freshPlayer({ playerId: 'f5_inactive', displayName: 'GhostClaimant', almaMater: 'Oklahoma', active: false }));
  storage.addPlayer(freshPlayer({ playerId: 'f5_active',   displayName: 'RealClaimant',  almaMater: 'Oklahoma', active: true  }));
  assert(claimedAlmaMaters().includes('Oklahoma'), 'fixture check: Oklahoma IS in the derived roster, via the ACTIVE claimant only (not vacuous)');
  const rankHtmlF5a = renderAlmaMaterRankings();
  assert(rankHtmlF5a.includes('RealClaimant'), 'F5 FIX: the rankings row attributes Oklahoma to the ACTIVE claimant');
  assert(!rankHtmlF5a.includes('GhostClaimant'), 'F5 FIX: the DEACTIVATED player, despite being listed first and sharing the identical stored casing, is never shown as the claimant');

  // Failure mode 2 — a WHITESPACE-only difference between the ACTIVE
  // player's raw stored value and the TRIMMED string claimedAlmaMaters()
  // actually derives and passes back in as `alma`. The OLD `===` compare
  // (no trim) would find NO player at all for this — a real, active
  // claimant's school rendering with a BLANK byline, not just a wrong one.
  localStorage.clear();
  storage.addPlayer(freshPlayer({ playerId: 'f5_ws', displayName: 'WhitespaceClaimant', almaMater: '  Arkansas  ', active: true }));
  assert(claimedAlmaMaters().includes('Arkansas'), 'fixture check: claimedAlmaMaters() itself trims — the derived roster holds the clean "Arkansas", not "  Arkansas  " (not vacuous)');
  const rankHtmlF5b = renderAlmaMaterRankings();
  assert(rankHtmlF5b.includes('WhitespaceClaimant'), 'F5 FIX: a claimant stored with surrounding whitespace is still matched against the TRIMMED roster entry — the OLD exact `===` compare would have found nobody and rendered a blank byline');

  // Positive control — an exact-casing, no-whitespace, single active
  // claimant still resolves correctly (the ordinary case is not broken by
  // either fix).
  localStorage.clear();
  storage.addPlayer(freshPlayer({ playerId: 'f5_plain', displayName: 'PlainClaimant', almaMater: 'USC', active: true }));
  assert(renderAlmaMaterRankings().includes('PlainClaimant'), 'fixture check: the ordinary exact-match case still resolves correctly (not vacuous — the fix does not overcorrect into matching nothing)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] renderRulesPage — driven by claims, escHtml\'d…');
{
  localStorage.clear();
  el('page-rules');
  storage.addPlayer(freshPlayer({ playerId: 'rp1', displayName: 'Hostile', almaMater: '<img src=x onerror=alert(1)>', active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'rp2', displayName: 'Kevin', almaMater: 'Notre Dame', active: true }));
  renderRulesPage();
  const html = el('page-rules').innerHTML;
  assert(html.includes('Notre Dame'), 'fixture check: the Rules tab genuinely rendered a real claim (not vacuous)');
  assert(!html.includes('<img src=x onerror=alert(1)>'), 'a malicious claimed school name is NOT rendered as raw, executable HTML');
  assert(html.includes('&lt;img'), 'the malicious school name IS present, escHtml-encoded — rendered, not silently dropped, just made safe');

  // An inactive player's claim does not reach the Rules tab either.
  storage.addPlayer(freshPlayer({ playerId: 'rp3', displayName: 'Ghost', almaMater: 'Oklahoma', active: false }));
  renderRulesPage();
  const html2 = el('page-rules').innerHTML;
  assert(!html2.includes('Oklahoma'), 'an inactive player\'s claimed school does not appear on the Rules tab');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] renderAlmaMaterSettingsCard() — READ-ONLY summary, no add/remove UI…');
{
  localStorage.clear();
  // Interleaved: Jacob (Arkansas) added AFTER Drew (Texas A&M) and Kihoon
  // (also Texas A&M), so claimant-grouping isn't accidentally order-dependent.
  storage.addPlayer(freshPlayer({ playerId: 'sc1', displayName: 'Drew', almaMater: 'Texas A&M', active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'sc2', displayName: 'Kihoon', almaMater: 'Texas A&M', active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'sc3', displayName: 'Jacob', almaMater: 'Arkansas', active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'sc4', displayName: 'Ghost', almaMater: 'Georgia', active: false }));

  const html = renderAlmaMaterSettingsCard();
  assert(html.includes('data-comm-tab="settings"'), 'RG-10: the card carries data-comm-tab="settings" (a card missing it renders on all five tabs)');
  assert(html.includes('Texas A&amp;M') || html.includes('Texas A&M'), 'fixture check: the derived roster genuinely rendered Texas A&M (not vacuous)');
  assert(html.includes('Drew') && html.includes('Kihoon'), 'BOTH claimants of a shared school are listed, not just one');
  assert(html.includes('Arkansas') && html.includes('Jacob'), 'Arkansas (Jacob\'s claim) is listed with its claimant');
  assert(!html.includes('Georgia'), 'the inactive player\'s claimed school does not appear on the summary card');
  assert(!html.includes('alma-remove-btn') && !html.includes('alma-add-btn') && !html.includes('alma-new-school'),
    'no add/remove button or input exists anywhere in the card — it is genuinely read-only');
  assert(/Players.*Edit|Players\s*→\s*Edit/.test(html), 'the card points the commissioner to Players → Edit to change a claim, rather than offering its own control');

  // Empty state — nobody has claimed anything.
  localStorage.clear();
  const emptyHtml = renderAlmaMaterSettingsCard();
  assert(!emptyHtml.includes('alma-remove-btn') && !emptyHtml.includes('alma-add-btn'), 'fixture check: still no add/remove UI with zero claims (not vacuous)');
  assert(/no active player has claimed/i.test(emptyHtml), 'an explicit empty-state message appears when no active player has claimed a school');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] showEditPlayerModal — ESPN-canonical <select>, real #ep-save ripple…');
{
  // 8a. Static rendering — no cache, ESPN unreachable in this harness (global
  // fetch is stubbed to throw), so this exercises the ALMA_MATERS fallback
  // AND the fetch-failure note text, end to end, awaited for determinism.
  localStorage.clear();
  resetDom();
  storage.addPlayer(freshPlayer({ playerId: 'ep1', displayName: 'Test Kevin', active: true, almaMater: 'Clemson' }));
  let capturedHtml = '';
  document.body.appendChild = ov => { capturedHtml = ov.innerHTML; };
  await showEditPlayerModal('ep1');

  assert(/<select\b[^>]*id="ep-alma"/.test(capturedHtml), 'item 1 (2026-09-04, "Do the dropdown") — the alma-mater field is genuinely a <select id="ep-alma">, not the old free-text <input>');
  assert(!capturedHtml.includes('<input') || !/<input\b[^>]*id="ep-alma"/.test(capturedHtml), 'no <input id="ep-alma"> survives — the free-text field is gone, not just supplemented');
  assert(!capturedHtml.includes('<datalist'), 'no <datalist> survives — options live directly in the <select> now');
  assert(!capturedHtml.includes('list="ep-alma-catalog"'), 'fixture check: the old datalist wiring attribute is gone too, not just the tag');

  // Clemson (the player's stored claim) is NOT in the ALMA_MATERS fallback
  // catalog (no cache + fetch unreachable) — buildAlmaMaterOptions() must
  // inject it as an extra, pre-selected option so Save can't silently blank
  // or change it.
  assert(/<option value="Clemson" selected>Clemson \(current — not in ESPN list\)<\/option>/.test(capturedHtml),
    'the stored claim (Clemson, not in the fallback list) renders as an extra pre-selected option — never silently dropped');
  for (const am of ALMA_MATERS) {
    assert(new RegExp(`<option value="${am.replace('&','&amp;')}"[^>]*>`).test(capturedHtml),
      `fixture check: the ALMA_MATERS fallback catalog offers "${am}" as a real <option> (not vacuous — proves the fallback actually populated, not an empty <select>)`);
  }
  assert(capturedHtml.includes('<option value="">— None —</option>'), 'an empty "— None —" option is always offered — alma mater stays optional');
  assert(!capturedHtml.includes('not in current list'), 'the old two-list-model "(not in current list)" labeling string is gone (distinct from this design\'s own "(current — not in ESPN list)" text)');

  // The fetch-failure path must leave a clear, non-blocking note — checked
  // via the SAME el()-registry trick §8b already relies on (module-global
  // id lookup, independent of whether ov.innerHTML was ever parsed).
  el('ep-alma-note');
  await showEditPlayerModal('ep1');
  assert(/Could not reach ESPN/.test(el('ep-alma-note').textContent), 'a fetch failure updates the note to say ESPN could not be reached — never silently blank, never a stuck "Loading…"');

  // escHtml on a hostile stored value — both places it now appears (the
  // <option> value AND its label).
  storage.addPlayer(freshPlayer({ playerId: 'ep3', displayName: 'Test Hostile', active: true, almaMater: '"><script>alert(1)</script>' }));
  let capturedHtml3 = '';
  document.body.appendChild = ov => { capturedHtml3 = ov.innerHTML; };
  await showEditPlayerModal('ep3');
  assert(!capturedHtml3.includes('<script>alert(1)</script>'), 'a hostile stored almaMater value is never rendered as raw, executable HTML');
  assert(capturedHtml3.includes('&lt;script&gt;') || capturedHtml3.includes('&amp;lt;script&amp;gt;'), 'the hostile value IS present, escHtml-encoded — rendered safely, not silently dropped');

  // 8b. THE REAL SAVE FLOW — pre-register the modal's field elements + save
  // button BEFORE calling showEditPlayerModal(), so its real
  // querySelector('#ep-save')?.addEventListener(...) attaches to THESE
  // objects (the established almatest/almatotaltest DOM-stub trick — see
  // #alma-add-btn in almatotaltest.mjs §7 for the identical shape). The
  // fake DOM never parses ov.innerHTML into real nodes, so el('ep-alma')'s
  // synthetic .value works identically whether the real markup is an
  // <input> or a <select> — this is why §8b needed NO changes for the
  // dropdown migration beyond adding `await`.
  localStorage.clear();
  resetDom();
  const week = freshWeek({ weekId: 'ep_w' });
  storage.saveWeek(week);
  storage.addPlayer(freshPlayer({ playerId: 'ep4', displayName: 'Test Player', active: true, almaMater: 'Purdue' }));
  const g = freshGame({ weekId: 'ep_w', homeTeam: 'Clemson', awayTeam: 'Wake Forest', isAlmaMaterGame: false });
  storage.saveGame(g);

  el('toast-container');
  el('ep-name').value = 'Test Player';
  el('ep-email').value = '';
  el('ep-alma').value = 'Clemson'; // changing the claim: Purdue -> Clemson (simulates the <select>'s value after a real pick)
  el('ep-save');
  el('ep-c');
  await showEditPlayerModal('ep4');
  el('ep-save')._fire('click');

  assert(storage.getPlayer('ep4').almaMater === 'Clemson', 'clicking the REAL #ep-save handler writes the new claim to the player record');
  assert(storage.getGame(g.gameId).isAlmaMaterGame === true, 'the ripple: recomputeAlmaMaterFlags() fired as part of the save, so the OPEN week\'s Clemson game is now flagged ⭐ — no separate re-import needed');
  assert(lastToasts.some(t => t.includes('Updated')), 'fixture check: a confirming toast fired (not vacuous)');
  assert(lastToasts.some(t => /re-flagged/.test(t)), 'the toast reports how many games were re-flagged, the same pattern the old add/remove buttons used');

  // Negative control — saving WITHOUT changing the claim reports 0 re-flagged.
  resetDom();
  el('toast-container');
  el('ep-name').value = 'Test Player';
  el('ep-email').value = '';
  el('ep-alma').value = 'Clemson'; // unchanged from what's now stored
  el('ep-save');
  el('ep-c');
  await showEditPlayerModal('ep4');
  el('ep-save')._fire('click');
  assert(!lastToasts.some(t => /re-flagged/.test(t)), 'saving with an UNCHANGED claim reports no re-flagged games (0 is falsy in the toast\'s conditional, matching the add/remove precedent)');

  // 8c. Save-without-touching-the-field preserves a claim the dropdown
  // doesn't offer — the exact silent-blanking risk buildAlmaMaterOptions()'s
  // pre-selected "current" option exists to prevent. Simulated here by
  // NEVER writing to el('ep-alma').value at all (as a real unmodified
  // <select> would leave it) before firing Save.
  resetDom();
  el('toast-container');
  storage.addPlayer(freshPlayer({ playerId: 'ep5', displayName: 'Untouched', active: true, almaMater: 'Clemson' }));
  el('ep-name').value = 'Untouched';
  el('ep-email').value = '';
  el('ep-save');
  el('ep-c');
  await showEditPlayerModal('ep5');
  // The real render path (buildAlmaMaterOptions) would have pre-selected
  // "Clemson" on the <select> it built; the fake DOM doesn't replay that
  // onto el('ep-alma').value automatically (it never parses innerHTML), so
  // this fixture sets it explicitly to what the REAL selected option would
  // have been — proving the SAVE HANDLER'S contract (whatever's in
  // #ep-alma.value at Save time is what's written), while §8a already
  // proved the RENDER contract (that value really is what gets pre-selected).
  el('ep-alma').value = 'Clemson';
  el('ep-save')._fire('click');
  assert(storage.getPlayer('ep5').almaMater === 'Clemson', 'saving without touching the alma-mater field preserves a claim that is not in the dropdown\'s own option list — never silently blanked');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] toggle-active ripple — deactivating the sole claimant clears the roster…');
{
  localStorage.clear();
  resetDom();
  const week = freshWeek({ weekId: 'tg_w' });
  storage.saveWeek(week);
  const player = freshPlayer({ playerId: 'tg1', displayName: 'Sole Claimant', active: true, almaMater: 'Oklahoma' });
  storage.addPlayer(player);
  const g = freshGame({ weekId: 'tg_w', homeTeam: 'Oklahoma', awayTeam: 'Temple', isAlmaMaterGame: true });
  storage.saveGame(g);

  assert(claimedAlmaMaters().includes('Oklahoma'), 'fixture check: Oklahoma is genuinely claimed before the toggle (not vacuous)');

  el('toast-container');
  const btn = el('toggle-btn-tg1');
  btn.dataset.playerId = 'tg1';
  selectorSets.set('.toggle-player-btn', [btn]);
  bindCommEventListeners(week, storage.getGames('tg_w'), [], [], storage.getSettings(), [week], []);
  btn._fire('click');

  assert(storage.getPlayer('tg1').active === false, 'the real .toggle-player-btn handler deactivated the player');
  assert(!claimedAlmaMaters().includes('Oklahoma'), 'Oklahoma no longer appears in claimedAlmaMaters() once its sole claimant is deactivated');
  assert(storage.getGame(g.gameId).isAlmaMaterGame === false, 'the ripple: the OPEN week\'s Oklahoma game is un-flagged immediately, without a separate player-edit save');
  assert(lastToasts.some(t => /re-flagged/.test(t)), 'the deactivate toast reports the re-flag, same pattern as the player-edit save');

  // Re-activating restores the claim and re-flags again.
  btn._fire('click');
  assert(storage.getPlayer('tg1').active === true, 'a second click re-activates the player');
  assert(claimedAlmaMaters().includes('Oklahoma'), 'Oklahoma is back in the derived roster once its claimant is active again');
  assert(storage.getGame(g.gameId).isAlmaMaterGame === true, 'the game is re-flagged ⭐ on reactivation too — the ripple runs both directions');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[10] THE FULL RIPPLE — one claim change reaches Watch, Rankings, ⭐, Tier 1, Rules, Auto-Calc…');
{
  localStorage.clear();
  resetDom();

  const week = freshWeek({ weekId: 'fr_w', tiebreakerCalculationMode: 'allAlmaMaterGames' });
  storage.saveWeek(week);
  el('page-rules');

  // A decoy game with a strong score (ranked matchup, tight spread, national
  // TV) that would normally win a 1-slot slate on points alone.
  const decoy = freshGame({
    weekId: 'fr_w', homeTeam: 'Ohio State', awayTeam: 'Michigan',
    homeRank: 2, awayRank: 3, spread: -3, nationalTV: true, broadcastNetwork: 'FOX',
    isAlmaMaterGame: false, status: GAME_STATUS.FINAL, homeScore: 30, awayScore: 24,
  });
  // The soon-to-be-claimed school's game — deliberately unranked, wide
  // spread, no TV, so it would LOSE a score-only comparison to the decoy.
  const claimGame = freshGame({
    weekId: 'fr_w', homeTeam: 'Clemson', awayTeam: 'Wake Forest',
    homeRank: null, awayRank: null, spread: -21, nationalTV: false,
    isAlmaMaterGame: false, status: GAME_STATUS.FINAL, homeScore: 31, awayScore: 10,
  });
  storage.saveAllGamesForWeek('fr_w', [decoy, claimGame]);
  // F1 (2026-09-04, clearing the reviewer BLOCK) — the REAL slate builder
  // (renderCommPage(), js/app.js ~line 3040) scores candidates from the
  // AVAILABLE-GAMES POOL (getAvailableGames), never the slate
  // (getGames/saveAllGamesForWeek). Distinct gameIds from the slate copies
  // above (freshGame()'s auto-incrementing _gid) so the pool row and the
  // slate row are genuinely two different stored records, exactly like the
  // real app after a fetch — a game can be suggested (in the pool) before
  // it's ever added to the slate.
  const decoyAvail = freshGame({
    weekId: 'fr_w', homeTeam: 'Ohio State', awayTeam: 'Michigan',
    homeRank: 2, awayRank: 3, spread: -3, nationalTV: true, broadcastNetwork: 'FOX',
    isAlmaMaterGame: false, status: GAME_STATUS.FINAL, homeScore: 30, awayScore: 24,
  });
  const claimGameAvail = freshGame({
    weekId: 'fr_w', homeTeam: 'Clemson', awayTeam: 'Wake Forest',
    homeRank: null, awayRank: null, spread: -21, nationalTV: false,
    isAlmaMaterGame: false, status: GAME_STATUS.FINAL, homeScore: 31, awayScore: 10,
  });
  storage.saveAvailableGames('fr_w', [decoyAvail, claimGameAvail]);

  el('toast-container');
  storage.addPlayer(freshPlayer({ playerId: 'fr1', displayName: 'Reviewer', active: true, almaMater: '' }));

  // BEFORE the claim — none of the six consumers mention Clemson.
  assert(!claimedAlmaMaters().includes('Clemson'), 'fixture check: before the claim, Clemson is not in the derived roster (not vacuous)');
  assert(!renderAlmaMaterWatch('fr_w').includes('Clemson'), 'before: Alma Mater Watch has no Clemson row');
  assert(!renderAlmaMaterRankings().includes('Clemson'), 'before: Alma Mater Rankings has no Clemson row');
  const scoredBefore = scoreCandidateGames(storage.getAvailableGames('fr_w'), 'fr_w');
  const slateBefore = buildSuggestedSlate(scoredBefore, 1).slate;
  assert(slateBefore.length === 1 && slateBefore[0].homeTeam === 'Ohio State', 'before: with NEITHER pool game flagged, the 1-slot slate goes to the higher-scored decoy (Ohio State), not Clemson — proves the fixture score gap is real, not vacuous');
  renderRulesPage();
  assert(!el('page-rules').innerHTML.includes('Clemson'), 'before: the Rules tab has no Clemson entry');

  // THE CLAIM — via the REAL #ep-save handler, the one place a claim actually changes.
  el('ep-name').value = 'Reviewer';
  el('ep-email').value = '';
  el('ep-alma').value = 'Clemson';
  el('ep-save'); el('ep-c');
  await showEditPlayerModal('fr1');
  el('ep-save')._fire('click');
  assert(storage.getPlayer('fr1').almaMater === 'Clemson', 'fixture check: the claim genuinely changed (not vacuous)');

  // AFTER — all six consumers now know about Clemson.
  assert(claimedAlmaMaters().includes('Clemson'), 'AFTER: claimedAlmaMaters() includes Clemson');
  assert(storage.getGame(claimGame.gameId).isAlmaMaterGame === true, 'AFTER: the ⭐ flag on the SLATE — recomputeAlmaMaterFlags() ran as part of the save');
  assert(storage.getAvailableGames('fr_w').find(g => g.gameId === claimGameAvail.gameId).isAlmaMaterGame === true,
    'AFTER: F1 fix — the ⭐ flag on the AVAILABLE-GAMES POOL also updated, the same save, not just the slate. This is the exact bug reproduced verbatim in the design input: fetch candidates, change Kevin to Notre Dame, suggested slate still shows Purdue.');
  assert(renderAlmaMaterWatch('fr_w').includes('Clemson'), 'AFTER: Alma Mater Watch now has a Clemson row');
  assert(renderAlmaMaterRankings().includes('Clemson'), 'AFTER: Alma Mater Rankings now has a Clemson row');
  const scoredAfter = scoreCandidateGames(storage.getAvailableGames('fr_w'), 'fr_w');
  const slateAfter = buildSuggestedSlate(scoredAfter, 1).slate;
  assert(slateAfter.some(g => g.homeTeam === 'Clemson'), 'AFTER: Tier 1, scored from the POOL exactly like renderCommPage() does — the low-scored Clemson game is now guaranteed onto even a 1-slot slate, unconditionally, beating the higher-scored decoy purely on the ⭐ flag');
  renderRulesPage();
  assert(el('page-rules').innerHTML.includes('Clemson'), 'AFTER: the Rules tab now lists Clemson');
  const total = (await import('./js/scoring.js')).calculateAlmaMaterTotal(storage.getGames('fr_w'), almaMatersForAutoCalc(storage.getWeek('fr_w')), week.tiebreakerCalculationMode);
  assert(total === 31, `AFTER: the tiebreaker Auto-Calc sums the newly-claimed Clemson game's FINAL score (31) — got ${total}`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[11] A freely-typed non-catalog claim — works end to end…');
{
  localStorage.clear();
  const week = freshWeek({ weekId: 'nc_w' });
  storage.saveWeek(week);
  storage.addPlayer(freshPlayer({ playerId: 'nc1', displayName: 'Huskies Fan', active: true, almaMater: 'Washington' }));

  // Positive — the claim renders correctly for its own team.
  const uwGame = freshGame({ weekId: 'nc_w', homeTeam: 'Washington', awayTeam: 'Oregon', homeRank: 9 });
  const wsuGame = freshGame({ weekId: 'nc_w', homeTeam: 'Washington State', awayTeam: 'Boise State', homeRank: null });
  storage.saveAllGamesForWeek('nc_w', [uwGame, wsuGame]);
  const changed = recomputeAlmaMaterFlags(claimedAlmaMaters());
  assert(changed >= 1, `fixture check: recomputing against the new non-catalog claim changed at least one game (got ${changed}, not vacuous)`);
  assert(storage.getGames('nc_w').find(g => g.homeTeam === 'Washington').isAlmaMaterGame === true, 'the freely-typed claim "Washington" correctly flags its OWN team\'s game');

  // The documented precision gap, reached through the SAME real pipeline
  // (recomputeAlmaMaterFlags -> getAlmaMaterMatch), not just the raw unit
  // check in §1: with no exclude-pattern entry for "Washington", the sibling
  // program's game is ALSO flagged.
  assert(storage.getGames('nc_w').find(g => g.homeTeam === 'Washington State').isAlmaMaterGame === true,
    'DOCUMENTED PRECISION GAP, proven through the real recomputeAlmaMaterFlags() pipeline: the non-catalog claim "Washington" also flags "Washington State" — no exclude-pattern data exists for it, unlike the six catalog schools');

  // The gap is a property of the SCHOOL NAME, not of every non-catalog
  // claim — a catalog-adjacent but genuinely unambiguous non-catalog name
  // (no real-world sibling program) does not false-positive against an
  // unrelated team.
  storage.addPlayer(freshPlayer({ playerId: 'nc2', displayName: 'Tigers Fan', active: true, almaMater: 'Clemson' }));
  const clemsonGame = freshGame({ weekId: 'nc_w', homeTeam: 'Clemson', awayTeam: 'Wake Forest' });
  const unrelated = freshGame({ weekId: 'nc_w', homeTeam: 'Wisconsin', awayTeam: 'Iowa' });
  storage.saveAllGamesForWeek('nc_w', [uwGame, wsuGame, clemsonGame, unrelated]);
  recomputeAlmaMaterFlags(claimedAlmaMaters());
  assert(storage.getGames('nc_w').find(g => g.homeTeam === 'Clemson').isAlmaMaterGame === true, 'fixture check: the Clemson claim still flags its own game (not vacuous)');
  assert(storage.getGames('nc_w').find(g => g.homeTeam === 'Wisconsin').isAlmaMaterGame === false, 'an unrelated, non-prefix-colliding team is correctly NOT flagged by any non-catalog claim');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[12] Structural residue scan — the rejected two-list model left nothing behind…');
{
  const { readFile } = await import('node:fs/promises');
  const appJsSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const dataModelJsSrc = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');
  const isCode = l => !/^\s*(\/\/|\*|\/\*)/.test(l);
  const codeOnly = src => src.split('\n').filter(isCode).join('\n');
  const appCode = codeOnly(appJsSrc);
  const dmCode = codeOnly(dataModelJsSrc);

  assert(!/\bactiveAlmaMaters\s*\(/.test(appCode), 'no call to activeAlmaMaters( survives anywhere in js/app.js executable code');
  assert(!/function\s+activeAlmaMaters/.test(appCode), 'the activeAlmaMaters function declaration itself is gone');
  assert(!/settings\.almaMaters/.test(appCode), 'no code reads settings.almaMaters directly in js/app.js');
  assert(!/almaMaters\s*:\s*ALMA_MATERS/.test(dmCode), 'DEFAULT_SETTINGS no longer seeds an almaMaters field from the catalog');
  assert(!/alma-remove-btn/.test(appCode), 'no .alma-remove-btn class/selector survives (render or handler)');
  assert(!/alma-add-btn/.test(appCode), 'no #alma-add-btn survives');
  assert(!/alma-new-school/.test(appCode), 'no #alma-new-school input survives');
  assert(!/not in current list/.test(appCode), 'the old "(not in current list)" labeling string is gone');
  assert(/export function claimedAlmaMaters/.test(appCode), 'fixture check: claimedAlmaMaters() itself DOES still exist — proves this scan distinguishes "removed the two-list model" from "broke the app" (not vacuous)');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[13] F4 — the Auto-Calc roster freezes at LOCK, mirroring lockedSpread…');
{
  // 13a. almaMatersForAutoCalc() — the read side.
  localStorage.clear();
  storage.addPlayer(freshPlayer({ playerId: 'f4p1', displayName: 'Live Claimant', active: true, almaMater: 'Oklahoma' }));

  const openWeek = freshWeek({ weekId: 'f4_open', status: WEEK_STATUS.OPEN });
  assert(JSON.stringify(almaMatersForAutoCalc(openWeek)) === JSON.stringify(claimedAlmaMaters()),
    'DRAFT/OPEN week: nothing frozen yet — reads the LIVE claimedAlmaMaters(), same as before F4');

  const lockedWithSnapshot = freshWeek({ weekId: 'f4_locked', status: WEEK_STATUS.LOCKED, lockedAlmaMaters: ['Frozen School'] });
  assert(JSON.stringify(almaMatersForAutoCalc(lockedWithSnapshot)) === JSON.stringify(['Frozen School']),
    'LOCKED week WITH a snapshot: reads the FROZEN roster, not the live one — proves the freeze actually overrides claimedAlmaMaters() even when they disagree');
  assert(JSON.stringify(claimedAlmaMaters()) !== JSON.stringify(['Frozen School']),
    'fixture check: the frozen and live rosters are GENUINELY different in this fixture — not a vacuous "any list passes"');

  const liveWithSnapshot = freshWeek({ weekId: 'f4_live', status: WEEK_STATUS.LIVE, lockedAlmaMaters: ['Frozen School'] });
  const finalWithSnapshot = freshWeek({ weekId: 'f4_final', status: WEEK_STATUS.FINAL, lockedAlmaMaters: ['Frozen School'] });
  assert(JSON.stringify(almaMatersForAutoCalc(liveWithSnapshot)) === JSON.stringify(['Frozen School']), 'LIVE week WITH a snapshot also reads it — not just LOCKED');
  assert(JSON.stringify(almaMatersForAutoCalc(finalWithSnapshot)) === JSON.stringify(['Frozen School']), 'FINAL week WITH a snapshot also reads it — not just LOCKED');

  const emptySnapshot = freshWeek({ weekId: 'f4_empty', status: WEEK_STATUS.LOCKED, lockedAlmaMaters: [] });
  assert(JSON.stringify(almaMatersForAutoCalc(emptySnapshot)) === JSON.stringify([]),
    'a LOCKED week that genuinely froze to ZERO claimed schools returns [], NOT a fallback to the live roster — Array.isArray(), not truthiness, is the presence check');

  const noSnapshot = freshWeek({ weekId: 'f4_pre_migration', status: WEEK_STATUS.LOCKED }); // lockedAlmaMaters absent, like a pre-F4 Sheet row
  assert(!('lockedAlmaMaters' in noSnapshot) || noSnapshot.lockedAlmaMaters === undefined, 'fixture check: this week genuinely carries no lockedAlmaMaters field, simulating a pre-migration Sheet row (not vacuous)');
  assert(JSON.stringify(almaMatersForAutoCalc(noSnapshot)) === JSON.stringify(claimedAlmaMaters()),
    'a LOCKED week locked BEFORE this shipped (no snapshot at all) falls back to the LIVE roster rather than throwing or reading "no snapshot" as "zero schools claimed"');

  // 13b. applyWeekStatusChange() — the manual-lock write side.
  localStorage.clear();
  storage.addPlayer(freshPlayer({ playerId: 'f4p2', displayName: 'Snapshot Claimant', active: true, almaMater: 'USC' }));
  const w13b = freshWeek({ weekId: 'f4_manual', status: WEEK_STATUS.OPEN });
  storage.saveWeek(w13b);
  storage.saveGame(freshGame({ weekId: 'f4_manual', spread: -3 }));
  const rosterAtLock = claimedAlmaMaters();
  const lockedUpd = applyWeekStatusChange(w13b, 'locked');
  assert(JSON.stringify(lockedUpd.lockedAlmaMaters) === JSON.stringify(rosterAtLock),
    'applyWeekStatusChange(week, "locked") snapshots claimedAlmaMaters() onto the returned/saved week, mirroring the lockedSpread freeze on every game in the SAME call');
  assert(JSON.stringify(storage.getWeek('f4_manual').lockedAlmaMaters) === JSON.stringify(rosterAtLock),
    'fixture check: the snapshot is genuinely PERSISTED (re-read from storage), not just present on the returned object (not vacuous)');

  // A claim change AFTER lock must not move the already-saved snapshot.
  storage.addPlayer(freshPlayer({ playerId: 'f4p3', displayName: 'Post-lock Claimant', active: true, almaMater: 'Purdue' }));
  assert(JSON.stringify(claimedAlmaMaters()) !== JSON.stringify(rosterAtLock), 'fixture check: the LIVE roster genuinely changed after lock (not vacuous)');
  assert(JSON.stringify(storage.getWeek('f4_manual').lockedAlmaMaters) === JSON.stringify(rosterAtLock),
    'a claim added AFTER lock does not retroactively touch the already-persisted lockedAlmaMaters snapshot — the tiebreaker answer players already guessed against cannot silently move');

  // Transitioning LOCKED -> FINAL must not clear/overwrite the existing snapshot.
  const finalUpd = applyWeekStatusChange(storage.getWeek('f4_manual'), 'final');
  assert(JSON.stringify(finalUpd.lockedAlmaMaters) === JSON.stringify(rosterAtLock),
    'transitioning an already-LOCKED week to "final" leaves its lockedAlmaMaters snapshot exactly as it was — only the "locked" branch ever writes it');

  // 13c. tickAutoTransition() — the SECOND, independent path to LOCKED (a
  // commissioner never presses a button; the tick fires on its own once the
  // effective lock time passes). Must snapshot identically to 13b's manual
  // path — the freeze cannot depend on which of the two ways a week locks.
  localStorage.clear();
  storage.addPlayer(freshPlayer({ playerId: 'f4p4', displayName: 'Auto-lock Claimant', active: true, almaMater: 'Arkansas' }));
  const autoWeek = freshWeek({
    weekId: 'f4_auto', status: WEEK_STATUS.OPEN, dataSourceMode: 'espn_historical',
    picksLockAt: new Date(Date.now() - 60 * 1000).toISOString(), // 1 minute in the past — the auto-lock condition is already true
    // §13c exercises the OPEN→LOCKED (auto-lock) leg ONLY; LOCKED is its
    // terminal state. Disable auto-live so the tick cannot cascade
    // LOCKED→LIVE. This is what keeps the "week is now LOCKED" sanity check
    // true BY CONSTRUCTION rather than by luck of the calendar: with
    // auto-live on, once real "now" passed the game's kickoff the tick would
    // advance the week straight through LOCKED to LIVE in a single call and
    // this fixture would rot (it did — the hardcoded kickoff went stale).
    autoLiveEnabled: false,
  });
  storage.saveWeek(autoWeek);
  // Kickoff pinned relative to "now" (well in the future) rather than a
  // hardcoded calendar date, so nothing in this block depends on when it runs.
  storage.saveGame(freshGame({ weekId: 'f4_auto', spread: -3, kickoff: new Date(Date.now() + 60 * 60 * 1000).toISOString() }));
  storage.setActiveWeekId('f4_auto');
  const rosterAtAutoLock = claimedAlmaMaters();
  tickAutoTransition();
  const afterTick = storage.getWeek('f4_auto');
  assert(afterTick.status === WEEK_STATUS.LOCKED, 'fixture check: the auto-lock condition genuinely fired — the week is now LOCKED (not vacuous)');
  assert(JSON.stringify(afterTick.lockedAlmaMaters) === JSON.stringify(rosterAtAutoLock),
    'tickAutoTransition()\'s auto-lock leg ALSO snapshots claimedAlmaMaters() onto lockedAlmaMaters — the same freeze as the manual applyWeekStatusChange() path, not just one of the two ways a week can reach LOCKED');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[14] F2 — restoring 8ae64f4\'s dropped ESPN-threading proof, plus a mutation battery…');
{
  // 14a. BEHAVIORAL PROOF — fetchByDateRange -> resilientFetch -> finalise ->
  // parseAndReport all honor the PASSED `almaMaters` list at parse time, not
  // just getAlmaMaterMatch() in isolation (§1 above). Restores 8ae64f4's
  // dropped §5 almost verbatim, updated for the derived-roster model (a
  // plain array literal in place of that revision's settings-backed list —
  // the function under test doesn't know or care where its caller's list
  // came from, so the fixture doesn't need to invoke claimedAlmaMaters()).
  function espnEvent({ id, home, away }) {
    const comp = {
      id: String(id), neutralSite: false, dateValid: true,
      competitors: [
        { homeAway: 'home', team: { location: home, name: 'Team', abbreviation: 'H' }, score: null, curatedRank: {} },
        { homeAway: 'away', team: { location: away, name: 'Team', abbreviation: 'A' }, score: null, curatedRank: {} },
      ],
      odds: [], broadcasts: [], notes: [], timeValid: true,
    };
    return {
      id: String(id), date: '2026-09-05T18:00Z',
      status: { type: { name: 'STATUS_SCHEDULED', detail: 'Sat, September 5th at 2:00 PM EDT', shortDetail: '9/5 - 2:00 PM EDT' } },
      competitions: [comp],
    };
  }
  const events = [
    espnEvent({ id: 'e1', home: 'Purdue', away: 'Ohio State' }),
    espnEvent({ id: 'e2', home: 'Notre Dame', away: 'Stanford' }),
  ];
  async function parseFixture(almaMaters) {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
    try { return await fetchByDateRange({ startDate: '2026-09-05', endDate: '2026-09-05', almaMaters }); }
    finally { globalThis.fetch = saved; }
  }

  const trimmedRes = await parseFixture(['Notre Dame']);
  assert(trimmedRes.error === null && trimmedRes.games.length === 2, 'fixture check: both games parsed without error (non-vacuous)');
  const purdueGame1 = trimmedRes.games.find(g => g.homeTeam === 'Purdue');
  const ndGame1     = trimmedRes.games.find(g => g.homeTeam === 'Notre Dame');
  assert(purdueGame1?.isAlmaMaterGame === false, 'with almaMaters=["Notre Dame"] passed explicitly through fetchByDateRange(), the Purdue game is NOT flagged isAlmaMaterGame');
  assert(ndGame1?.isAlmaMaterGame === true, 'the Notre Dame game IS flagged isAlmaMaterGame with the same passed list');

  // Omitting almaMaters entirely — every existing caller/test that predates
  // this feature must keep working EXACTLY as before (full catalog default).
  const defaultRes = await parseFixture(undefined);
  const purdueGame2 = defaultRes.games.find(g => g.homeTeam === 'Purdue');
  assert(purdueGame2?.isAlmaMaterGame === true, 'omitting almaMaters entirely falls back to the full ALMA_MATERS catalog — Purdue still flags true (backward compat for every un-migrated caller)');

  // 14b. MUTATION BATTERY — proves 14a would actually go RED if the
  // threading breaks.
  //
  // A CORRECTION to the brief's cited line, found while building this
  // battery and worth recording here rather than silently working around:
  // the brief names `js/data-provider.js:110` — `const result = await
  // resilientFetch(espnUrl, almaMaters);`, inside fetchByDateRange's
  // per-date loop — as the pass-through the reviewer mutated by hand.
  // Mutating THAT specific occurrence is, measurably, a NO-OP for
  // fetchByDateRange's own return value: the loop only ever reads
  // `result._rawEvents`/`result.fetchMethod` off of it (raw, unflagged ESPN
  // JSON), and fetchByDateRange re-derives its actual `games` (and thus
  // every `isAlmaMaterGame` a caller ever sees) from a SEPARATE, always-
  // correct final call — `parseAndReport(uniqueEvents, lastEspnUrl,
  // lastMethod, startDate, endDate, almaMaters)` — a few lines later, which
  // this file's own comment even labels "we return raw events for merging
  // upstream." Confirmed empirically (scratch harness, not asserted here)
  // before writing this battery: mutating line 110 in isolation, tested
  // via fetchByDateRange()'s output, never goes red, on the CURRENT tree or
  // any prior revision — a restored §5 would not have caught it either.
  // The brief's underlying ask — prove the "fetchByDateRange →
  // parseAndReport" chain actually threads `almaMaters` through to the
  // final flags, and that a regression there goes RED — is fully valid and
  // is what this battery proves; it targets the call that is ACTUALLY
  // load-bearing for that chain (the final parseAndReport call) rather than
  // the one named, which is real code but a provable no-op for this
  // specific purpose. Flagged in the handoff report as its own finding
  // (dead/wasted computation, not a bug — nothing behaves incorrectly
  // today), not silently corrected in production code as part of this
  // batch.
  //
  // Both a DELETION (drop the trailing arg — parseAndReport's own default
  // parameter silently substitutes ALMA_MATERS) and an INVERSION
  // (substitute the hardcoded ALMA_MATERS catalog directly at the call
  // site) — CLAUDE.md's mutation-testing discipline requires inversions as
  // well as deletions, not just one shape.
  const realDataProviderSrc = await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8');
  const realDataModelSrc = await readFile(new URL('./js/data-model.js', import.meta.url), 'utf8');
  const CALL_SITE = `  const { games, report } = parseAndReport(uniqueEvents, lastEspnUrl, lastMethod, startDate, endDate, almaMaters);`;
  assert(realDataProviderSrc.includes(CALL_SITE), 'fixture check: the exact call-site text this battery targets is genuinely present in the real source, unindented/mis-copied text would silently no-op every mutation below (not vacuous)');
  assert(realDataProviderSrc.split(CALL_SITE).length - 1 === 1, 'fixture check: the call-site text is UNIQUE in the file — a non-unique needle would mutate the wrong occurrence or all of them');

  const mutantDirs = [];
  async function importMutant(mutatedSrc) {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'almatest-mutant-'));
    mutantDirs.push(dir);
    await writeFile(path.join(dir, 'data-model.js'), realDataModelSrc, 'utf8');
    await writeFile(path.join(dir, 'data-provider.js'), mutatedSrc, 'utf8');
    const url = new URL(`file://${path.join(dir, 'data-provider.js')}?t=${Date.now()}_${Math.random()}`);
    return import(url.href);
  }

  // Fixture check for the correction above: prove the BRIEF'S OWN cited line
  // really is a no-op, so the correction is measured, not asserted on faith.
  const NAMED_LINE = `    const result = await resilientFetch(espnUrl, almaMaters);`;
  assert(realDataProviderSrc.includes(NAMED_LINE), 'fixture check: the brief\'s originally-cited line is still present in real source (the correction is about which line MATTERS, not that the cited one is gone)');
  {
    const namedMutantSrc = realDataProviderSrc.replace(NAMED_LINE, `    const result = await resilientFetch(espnUrl);`);
    assert(namedMutantSrc !== realDataProviderSrc, 'fixture check: this mutation of the brief\'s cited line actually changed the source text');
    const namedMutantMod = await importMutant(namedMutantSrc);
    const saved = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
    let purdueFlag;
    try {
      const res = await namedMutantMod.fetchByDateRange({ startDate: '2026-09-05', endDate: '2026-09-05', almaMaters: ['Notre Dame'] });
      purdueFlag = res.games.find(g => g.homeTeam === 'Purdue')?.isAlmaMaterGame;
    } finally { globalThis.fetch = saved; }
    assert(purdueFlag === false, 'CORRECTION, PROVEN: mutating the brief\'s literally-cited line (data-provider.js:110\'s resilientFetch(espnUrl, almaMaters) inside the per-date loop) does NOT change fetchByDateRange()\'s output at all — Purdue still correctly reads false. This line\'s almaMaters argument is dead code for this purpose, confirmed rather than assumed.');
  }

  const MUTATIONS = [
    {
      name: 'DELETE the trailing arg — parseAndReport(..., almaMaters) -> parseAndReport(...)',
      apply: s => s.replace(CALL_SITE, `  const { games, report } = parseAndReport(uniqueEvents, lastEspnUrl, lastMethod, startDate, endDate);`),
    },
    {
      name: 'INVERT — pass the hardcoded ALMA_MATERS catalog instead of the caller\'s almaMaters',
      apply: s => s.replace(CALL_SITE, `  const { games, report } = parseAndReport(uniqueEvents, lastEspnUrl, lastMethod, startDate, endDate, ALMA_MATERS);`),
    },
  ];

  const proveRed = async (mod) => {
    const saved = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ events }) });
    try {
      const res = await mod.fetchByDateRange({ startDate: '2026-09-05', endDate: '2026-09-05', almaMaters: ['Notre Dame'] });
      const purdueGame = res.games.find(g => g.homeTeam === 'Purdue');
      return purdueGame?.isAlmaMaterGame === true; // RED if the caller's ['Notre Dame']-only list was silently ignored
    } finally { globalThis.fetch = saved; }
  };

  // Sanity — the UNMUTATED module must NOT trip the check.
  {
    const baseline = await importMutant(realDataProviderSrc);
    const baselineTripped = await proveRed(baseline);
    assert(baselineTripped === false, 'GREEN — the real, unmutated data-provider.js does not trip the threading check');
  }

  for (const m of MUTATIONS) {
    const mutatedSrc = m.apply(realDataProviderSrc);
    assert(mutatedSrc !== realDataProviderSrc, `fixture check: mutation "${m.name}" actually changed the source text`);
    try {
      const mutantMod = await importMutant(mutatedSrc);
      const tripped = await proveRed(mutantMod);
      assert(tripped === true, `RED — mutation caught: ${m.name}`);
    } catch (e) {
      // A mutation that breaks the module entirely (throws on import/call) is
      // ALSO a caught mutation — slatetest.mjs-style, a crash is not a silent pass.
      assert(true, `RED — mutation caught (via exception): ${m.name} — ${e.message}`);
    }
  }

  // Clean up every tmpdir this battery created — never touches real source.
  await Promise.all(mutantDirs.map(d => rm(d, { recursive: true, force: true }).catch(() => {})));
  assert(realDataProviderSrc === await readFile(new URL('./js/data-provider.js', import.meta.url), 'utf8'),
    'real source under cfb-pickems/js/ is byte-identical after the whole battery — every mutation ran against a tmpdir copy only');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[15] item 1 — fetchEspnTeamsList() parsing, duplicate-location handling, and the modal\'s cache…');
{
  function espnTeam({ id, location, name, abbreviation, displayName }) {
    return { team: { id, location, name, abbreviation, displayName: displayName || `${location} ${name}` } };
  }
  const rawTeams = [
    espnTeam({ id: '264', location: 'Washington', name: 'Huskies', abbreviation: 'WASH' }),
    espnTeam({ id: '265', location: 'Washington State', name: 'Cougars', abbreviation: 'WSU' }),
    espnTeam({ id: '2390', location: 'Miami', name: 'Hurricanes', abbreviation: 'MIA' }),
    espnTeam({ id: '193', location: 'Miami', name: 'RedHawks', abbreviation: 'M-OH', displayName: 'Miami (OH) RedHawks' }),
    // A malformed/incomplete entry — ESPN's real feed occasionally omits
    // fields; a team with no location at all is unusable as an alma-mater
    // claim (nothing to store/match against) and must be dropped, not
    // rendered as a blank option.
    { team: { id: '999', location: '', name: 'Nobody', abbreviation: 'N/A', displayName: '' } },
    { notATeamKey: true }, // a genuinely malformed row — filtered by .filter(Boolean) after .map(t => t?.team)
  ];
  const mockEspnResponse = { sports: [{ leagues: [{ teams: rawTeams }] }] };

  // 15a. Direct-fetch success path.
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => mockEspnResponse });
  let teams;
  try { teams = await fetchEspnTeamsList(); } finally { globalThis.fetch = savedFetch; }

  assert(Array.isArray(teams) && teams.length === 4, `fixture check: 4 usable teams parsed out of 6 raw entries — the blank-location and malformed rows are dropped (got ${teams?.length})`);
  const wash = teams.find(t => t.displayName === 'Washington Huskies');
  assert(wash?.location === 'Washington', 'fixture check: a normal team maps location/displayName correctly (not vacuous)');
  // RG-55 (2026-09-04): this used to look the team up by `t.id === '264'`.
  // fetchEspnTeamsList() no longer emits id/name/abbreviation — nothing in the
  // app ever read them, and they were 39,005 of the 88,725 characters the real
  // 760-team catalog serialized to. §16d holds the measured proof.
  assert(wash && !('id' in wash) && !('name' in wash) && !('abbreviation' in wash),
    'a parsed team carries ONLY location + displayName — no id/name/abbreviation (RG-55)');

  // Duplicate `location` across two DIFFERENT teams (Miami / Miami (OH),
  // standing in for the verified real-catalog collisions — Charlotte,
  // Roosevelt, Troy — same shape, easier fixture names). Both survive as
  // separate entries; only `displayName` distinguishes them.
  const miamis = teams.filter(t => t.location === 'Miami');
  assert(miamis.length === 2, `fixture check: BOTH same-location teams survive as distinct entries, not deduped — got ${miamis.length}`);
  assert(new Set(miamis.map(t => t.displayName)).size === 2, 'the two same-location teams have DIFFERENT displayName values — the only thing that lets a human tell them apart in the dropdown');
  assert(miamis[0].location === miamis[1].location, 'fixture check, the documented collision itself: selecting EITHER one stores the identical `location` string — the collision is real and NOT resolved at the data level (see the handoff report)');

  // 15b. Proxy-fallback path — direct fetch fails, first proxy succeeds.
  globalThis.fetch = async (url) => {
    if (typeof url === 'string' && url.startsWith('https://site.api.espn.com')) throw new Error('direct blocked');
    return { ok: true, json: async () => mockEspnResponse };
  };
  let proxyTeams;
  try { proxyTeams = await fetchEspnTeamsList(); } finally { globalThis.fetch = savedFetch; }
  assert(Array.isArray(proxyTeams) && proxyTeams.length === 4, 'the proxy-fallback path returns the same parsed shape when the direct fetch fails but a proxy succeeds');

  // 15c. Total failure — throws (does NOT itself catch/fallback; that is
  // js/app.js's showEditPlayerModal()'s job, per fetchEspnTeamsList()'s own
  // docstring).
  globalThis.fetch = async () => { throw new Error('network fully disabled'); };
  let threw = false;
  try { await fetchEspnTeamsList(); } catch { threw = true; } finally { globalThis.fetch = savedFetch; }
  assert(threw === true, 'fetchEspnTeamsList() throws on total failure (direct + all 3 proxies exhausted) rather than returning an empty/partial list silently');

  // 15d. showEditPlayerModal()'s cache — "near-static; don't refetch on
  // every modal open." First call with no cache: the SYNCHRONOUS render
  // shows the 6-school ALMA_MATERS fallback (nothing to fetch from yet);
  // fetch happens in the background and, once it resolves, the SAME <select>
  // element is repopulated in place. Uses the el()-registry pattern (§8b/
  // §10's established trick) rather than the one-shot ov.innerHTML capture
  // §8a/§15a-c use — capturing ov.innerHTML only ever proves the INITIAL
  // synchronous render; the background refresh mutates a DIFFERENT element
  // (document.getElementById('ep-alma')) after that capture already
  // happened, so only a REGISTERED, re-inspectable element can observe it.
  localStorage.clear();
  resetDom();
  // RG-55: the cache is module state now, so localStorage.clear() no longer
  // resets it — the cold-cache precondition has to be asked for explicitly.
  app._resetEspnTeamsCacheForTest();
  storage.addPlayer(freshPlayer({ playerId: 'cache1', displayName: 'Cache Test', active: true, almaMater: '' }));
  let fetchCallCount = 0;
  globalThis.fetch = async () => { fetchCallCount++; return { ok: true, json: async () => mockEspnResponse }; };
  try {
    el('ep-alma');
    el('ep-alma-note');
    await showEditPlayerModal('cache1');
    assert(fetchCallCount > 0, 'fixture check: the first modal open with no cache genuinely triggers a fetch (not vacuous)');
    assert(/Washington Huskies/.test(el('ep-alma').innerHTML), 'AFTER the fetch resolves, the <select> is repopulated with the REAL ESPN list (not just the 6-school fallback) — "Washington Huskies" (a non-catalog school) is now offered');
    assert(/From ESPN's team catalog \(4 schools\)/.test(el('ep-alma-note').textContent), 'the note updates to confirm the real catalog loaded, with a count');
    // RG-55 (2026-09-04). These two assertions used to read the cache back out
    // of `getSettings().espnTeamsCache` — that is, they ENCODED the defect:
    // they asserted that a 760-team third-party catalog belonged in the
    // synced, 50,000-char-capped, credential-bearing settings blob. The cache
    // now lives in app.js module memory. That it IS cached is proven the only
    // way that actually matters, and the only way still available —
    // BEHAVIOURALLY, by the second-open-makes-no-fetch check below. That it is
    // NOT in the seam is asserted here; the measurements are §16's.
    storage.saveSetting('autoRefreshInterval', 60);   // guarantee a real blob, so this can't pass by measuring null
    const settingsBlob15 = localStorage.getItem('cfbp_settings');
    assert(/autoRefreshInterval/.test(settingsBlob15 || ''), 'fixture check: a real settings blob exists to be measured (not vacuous)');
    assert(!/espnTeamsCache/.test(settingsBlob15) && !/Washington Huskies/.test(settingsBlob15),
      'the fetched catalog is NOT written into the synced settings blob — neither the field nor its contents (RG-55; §16 has the measured reason)');

    const countBeforeSecondOpen = fetchCallCount;
    // A cache HIT never reaches the async refresh branch at all (`if
    // (!cached)` is false), so nothing ever writes to the pre-registered
    // el('ep-alma') this time — the whole render is synchronous, captured
    // the same way §8a/§15a-c capture a one-shot synchronous render
    // (ov.innerHTML at appendChild time), not via the registry.
    resetDom();
    let capturedHtmlCacheHit = '';
    document.body.appendChild = ov => { capturedHtmlCacheHit = ov.innerHTML; };
    await showEditPlayerModal('cache1');
    assert(fetchCallCount === countBeforeSecondOpen, 'a SECOND modal open, with a cache now present, does NOT fetch again — "near-static; don\'t refetch on every modal open"');
    assert(/Washington Huskies/.test(capturedHtmlCacheHit), 'fixture check: the second open still renders the full cached list synchronously, with no fetch in between (not vacuous)');
  } finally { globalThis.fetch = savedFetch; }
}


// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[16] item 1 — the ESPN team catalog never reaches the synced settings blob…');
{
  // WHY THIS SECTION EXISTS (RG-55, 2026-09-04 — found by measurement, before
  // review, before deploy). §15d proved the dropdown's catalog cache WORKS.
  // It never measured what the cache WEIGHS. The shipped-in-the-working-tree
  // implementation cached it with
  //
  //     saveSetting('espnTeamsCache', { teams: fresh, fetchedAt: … })
  //
  // and `cfbp_settings` is ONE key → ONE Google Sheets cell (backend/Code.gs
  // writes the whole JSON string with `setValues([[str, now]])` / `appendRow`
  // — no chunking, no size check anywhere in the file). Google Sheets caps a
  // cell at 50,000 characters. The real catalog is 760 teams and serializes
  // to ~88.7k — 77% OVER, before a single other settings field. And that same
  // blob carries `adminPasswordHash` and the site PIN, so the first time a
  // commissioner opened the player editor the credential-bearing blob either
  // failed to write or truncated.
  //
  // The fixture below is the REAL ESPN response, captured 2026-09-04 from
  // https://site.api.espn.com/apis/site/v2/sports/football/college-football/teams?limit=1000
  // — all 760 usable teams, five fields each, VERBATIM (nothing derived,
  // nothing hand-written, nothing sampled). Stored as positional tuples only
  // to keep the repeated key names out of the file; §16a re-labels them back
  // into ESPN's real `{ team: { … } }` response shape with no transformation.
  // A hand-written 4-team stub cannot prove a size ceiling, which is exactly
  // why the original build's 4-team fixture missed this entirely.
  const ESPN_TEAMS_FIXTURE_2026_09_04 = [
  ["2000","Abilene Christian","Wildcats","ACU","Abilene Christian Wildcats"],["2001","Adams State","Grizzlies","ADSU","Adams State Grizzlies"],["2003","Adrian","Bulldogs","ADR","Adrian Bulldogs"],["2005","Air Force","Falcons","AF","Air Force Falcons"],
  ["2006","Akron","Zips","AKR","Akron Zips"],["2010","Alabama A&M","Bulldogs","AAMU","Alabama A&M Bulldogs"],["333","Alabama","Crimson Tide","ALA","Alabama Crimson Tide"],["2011","Alabama State","Hornets","ALST","Alabama State Hornets"],
  ["2013","Albany State","Golden Rams","ABSU","Albany State Golden Rams"],["2790","Albion","Britons","ALBI","Albion Britons"],["2015","Albright","Lions","ALBR","Albright Lions"],["2016","Alcorn State","Braves","ALCN","Alcorn State Braves"],
  ["365","Alfred","Saxons","ALFR","Alfred Saxons"],["3162","Alfred State","Pioneers","AFST","Alfred State Pioneers"],["2018","Allegheny","Gators","ALLG","Allegheny Gators"],["2019","Allen","Yellow Jackets","ALNU","Allen Yellow Jackets"],
  ["2800","Alma","Scots","ALMA","Alma Scots"],["111674","Alvernia","Golden Wolves","ALVR","Alvernia Golden Wolves"],["2022","American International","Yellow Jackets","AIC","American International Yellow Jackets"],["7","Amherst","Mammoths","AMH","Amherst Mammoths"],
  ["2023","Anderson (IN)","Ravens","ANIN","Anderson (IN) Ravens"],["129469","Anderson (SC)","Trojans","ANSC","Anderson (SC) Trojans"],["134002","Andrew","Fighting Tigers","AND","Andrew Fighting Tigers"],["2025","Angelo State","Rams","AGSU","Angelo State Rams"],
  ["2026","App State","Mountaineers","APP","App State Mountaineers"],["3111","Apprentice School","Builders","APPRE","Apprentice School Builders"],["9","Arizona State","Sun Devils","ASU","Arizona State Sun Devils"],["12","Arizona","Wildcats","ARIZ","Arizona Wildcats"],
  ["124386","Arkansas Baptist","Buffaloes","ARBA","Arkansas Baptist Buffaloes"],["2028","Arkansas Monticello","Boll Weevils","UAM","Arkansas Monticello Boll Weevils"],["8","Arkansas","Razorbacks","ARK","Arkansas Razorbacks"],["2032","Arkansas State","Red Wolves","ARST","Arkansas State Red Wolves"],
  ["2033","Arkansas Tech","Wonder Boys","ARTE","Arkansas Tech Wonder Boys"],["2029","Arkansas-Pine Bluff","Golden Lions","UAPB","Arkansas-Pine Bluff Golden Lions"],["349","Army","Black Knights","ARMY","Army Black Knights"],["308","Ashland","Eagles","ASH","Ashland Eagles"],
  ["2038","Assumption","Greyhounds","ASP","Assumption Greyhounds"],["2","Auburn","Tigers","AUB","Auburn Tigers"],["124","Augsburg","Auggies","AUGS","Augsburg Auggies"],["2042","Augustana (IL)","Vikings","AUGC","Augustana (IL) Vikings"],
  ["2043","Augustana (SD)","Vikings","AUSD","Augustana (SD) Vikings"],["2044","Aurora","Spartans","AUR","Aurora Spartans"],["2045","Austin","'Roos","AUS","Austin 'Roos"],["2046","Austin Peay","Governors","APSU","Austin Peay Governors"],
  ["3178","Ave Maria University","Gyrenes","AVE M","Ave Maria University Gyrenes"],["2047","Averett","Cougars","AVER","Averett Cougars"],["2048","Avila University","Eagles","AVILA","Avila University Eagles"],["2049","Azusa Pacific","Cougars","APU","Azusa Pacific Cougars"],
  ["495","BLUEFIELD","Ramblin' Rams","BLU","BLUEFIELD Ramblin' Rams"],["252","BYU","Cougars","BYU","BYU Cougars"],["488","Baker University","Baker","BAK","Baker University Baker"],["188","Baldwin Wallace","Yellow Jackets","BW","Baldwin Wallace Yellow Jackets"],
  ["2050","Ball State","Cardinals","BALL","Ball State Cardinals"],["122666","Barton","Bulldogs","BART","Barton Bulldogs"],["121","Bates","Bobcats","BATE","Bates Bobcats"],["239","Baylor","Bears","BAY","Baylor Bears"],
  ["2056","Belhaven","Blazers","BELH","Belhaven Blazers"],["266","Beloit","Buccaneers","BELO","Beloit Buccaneers"],["132","Bemidji State","Beavers","BST","Bemidji State Beavers"],["490","Benedict","Tigers","BEN","Benedict Tigers"],
  ["2283","Benedictine (IL)","Eagles","BNIL","Benedictine (IL) Eagles"],["16111","Benedictine College","Ravens","BENC","Benedictine College Ravens"],["2060","Bentley","Falcons","BENT","Bentley Falcons"],["2757","Berry","Vikings","BERR","Berry Vikings"],
  ["492","Bethany (KS)","Bethany (Ks)","BETHA","Bethany (Ks)"],["2062","Bethany (WV)","Bison","BCWV","Bethany (WV) Bison"],["2802","Bethel (MN)","Royals","BUMN","Bethel (MN) Royals"],["2064","Bethel University Tennessee","Wildcats","BETHTN","Bethel University Tennessee Wildcats"],
  ["2065","Bethune-Cookman","Wildcats","BCU","Bethune-Cookman Wildcats"],["2069","Black Hills State","Yellow Jackets","BHSU","Black Hills State Yellow Jackets"],["2071","Bloomsburg","Huskies","BBU","Bloomsburg Huskies"],["124180","Bluefield State","Big Blue","BLUS","Bluefield State Big Blue"],
  ["2074","Bluffton","Beavers","BLF","Bluffton Beavers"],["68","Boise State","Broncos","BOIS","Boise State Broncos"],["103","Boston College","Eagles","BC","Boston College Eagles"],["340","Bowdoin","Polar Bears","BOW","Bowdoin Polar Bears"],
  ["2075","Bowie State","Bulldogs","BOWE","Bowie State Bulldogs"],["189","Bowling Green","Falcons","BGSU","Bowling Green Falcons"],["2913","Brevard","Tornados","BRE","Brevard Tornados"],["2079","Bridgewater","Eagles","BRI","Bridgewater Eagles"],
  ["18","Bridgewater State","Bears","BRIS","Bridgewater State Bears"],["2080","British Columbia","British Col","BBM","British Columbia British Col"],["2781","Brockport","Golden Eagles","BRO","Brockport Golden Eagles"],["225","Brown","Bears","BRWN","Brown Bears"],
  ["2803","Bryant","Bulldogs","BRY","Bryant Bulldogs"],["2083","Bucknell","Bison","BUCK","Bucknell Bison"],["63","Buena Vista","Beavers","BVU","Buena Vista Beavers"],["2084","Buffalo","Bulls","BUF","Buffalo Bulls"],
  ["2085","Buffalo State","Bengals","BSU","Buffalo State Bengals"],["2086","Butler","Bulldogs","BTLR","Butler Bulldogs"],["2570","CSU Pueblo","ThunderWolves","CSUP","CSU Pueblo ThunderWolves"],["2094","Cal Lutheran","Kingsmen","CLU","Cal Lutheran Kingsmen"],
  ["13","Cal Poly","Mustangs","CP","Cal Poly Mustangs"],["2858","California (PA)","Vulcans","CAPA","California (PA) Vulcans"],["25","California","Golden Bears","CAL","California Golden Bears"],["129738","Calvin","Knights","CALU","Calvin Knights"],
  ["2097","Campbell","Fighting Camels","CAM","Campbell Fighting Camels"],["2098","Campbellsville University","Tigers","CMPBVIL","Campbellsville University Tigers"],["424","Capital","Comets","CAPU","Capital Comets"],["2101","Carleton","Knights","CAR","Carleton Knights"],
  ["2102","Carnegie Mellon","Tartans","CGMU","Carnegie Mellon Tartans"],["32","Carroll (WI)","Pioneers","CRU","Carroll (WI) Pioneers"],["2105","Carson Newman","Eagles","CN","Carson Newman Eagles"],["2106","Carthage","Firebirds","CCW","Carthage Firebirds"],
  ["2963","Case Western Reserve","Spartans","CWRU","Case Western Reserve Spartans"],["2107","Catawba","Indians","CAT","Catawba Indians"],["2108","Catholic","Cardinals","CATH","Catholic Cardinals"],["101442","Centenary (LA)","Gentlemen","CTLA","Centenary (LA) Gentlemen"],
  ["2110","Central Arkansas","Bears","CARK","Central Arkansas Bears"],["2964","Central College","Dutch","CNTC","Central College Dutch"],["2115","Central Connecticut","Blue Devils","CCSU","Central Connecticut Blue Devils"],["2860","Central Methodist","Eagles","CDF","Central Methodist Eagles"],
  ["2117","Central Michigan","Chippewas","CMU","Central Michigan Chippewas"],["2118","Central Missouri","Mules","UCM","Central Missouri Mules"],["2122","Central Oklahoma","Bronchos","UCO","Central Oklahoma Bronchos"],["2119","Central State","Marauders","CNSU","Central State Marauders"],
  ["2120","Central Washington","Wildcats","CWAU","Central Washington Wildcats"],["2121","Centre","Colonels","CCO","Centre Colonels"],["2123","Chadron State","Eagles","CHAD","Chadron State Eagles"],["411","Chapman","Panthers","CHAP","Chapman Panthers"],
  ["2128","Charleston (WV)","Golden Eagles","UCWV","Charleston (WV) Golden Eagles"],["2127","Charleston Southern","Buccaneers","CHSO","Charleston Southern Buccaneers"],["2429","Charlotte","49ers","CLT","Charlotte 49ers"],["3253","Charlotte","Saints","COLLE","Charlotte Saints"],
  ["236","Chattanooga","Mocs","UTC","Chattanooga Mocs"],["80","Chicago","Maroons","CHI","Chicago Maroons"],["2804","Chowan","Hawks","CWAN","Chowan Hawks"],["3112","Christopher Newport","Captains","CNU","Christopher Newport Captains"],
  ["2132","Cincinnati","Bearcats","CIN","Cincinnati Bearcats"],["17","Claremont Mudd Scripps","Stags","CMS","Claremont Mudd Scripps Stags"],["2134","Clarion","Golden Eagles","CLRN","Clarion Golden Eagles"],["2805","Clark Atlanta","Panthers","CKGA","Clark Atlanta Panthers"],
  ["228","Clemson","Tigers","CLEM","Clemson Tigers"],["2557","Coast Guard","Bears","USCG","Coast Guard Bears"],["324","Coastal Carolina","Chanticleers","CCU","Coastal Carolina Chanticleers"],["2141","Coe","Kohawks","COE","Coe Kohawks"],
  ["33","Colby","White Mules","CLBY","Colby White Mules"],["3210","Cole College","Jaguars","COLE","Cole College Jaguars"],["2142","Colgate","Raiders","COLG","Colgate Raiders"],["108382","College of Idaho","Yotes","COI","College of Idaho Yotes"],
  ["38","Colorado","Buffaloes","COLO","Colorado Buffaloes"],["11","Colorado Mesa","Mavericks","COMU","Colorado Mesa Mavericks"],["2146","Colorado School of Mines","Orediggers","CMIN","Colorado School of Mines Orediggers"],["36","Colorado State","Rams","CSU","Colorado State Rams"],
  ["171","Columbia","Lions","COLU","Columbia Lions"],["2148","Concord","Mountain Lions","CONC","Concord Mountain Lions"],["2152","Concordia (MN)","Cobbers","CCMN","Concordia (MN) Cobbers"],["409","Concordia (WI)","Falcons","CUW","Concordia (WI) Falcons"],
  ["2151","Concordia Chicago","Cougars","CUC","Concordia Chicago Cougars"],["3066","Concordia St. Paul","Golden Bears","CSP","Concordia St. Paul Golden Bears"],["507","Concordia University Nebraska","Clippers","CONCONE","Concordia University Nebraska Clippers"],["2985","Concordia-Michigan","Cardinals","CONCMI","Concordia-Michigan Cardinals"],
  ["2155","Cornell (IA)","Rams","CNIA","Cornell (IA) Rams"],["172","Cornell","Big Red","COR","Cornell Big Red"],["509","Crown","Polars","CRWN","Crown Polars"],["510","Culver-Stockton College","Wildcats","CULVE","Culver-Stockton College Wildcats"],
  ["2161","Cumberland (TN)","Bulldogs","CUMBTN","Cumberland (TN) Bulldogs"],["511","Cumberlands","Indians","CMBS","Cumberlands Indians"],["40","Curry","Colonels","CC","Curry Colonels"],["512","Dakota State University","Trojans","DAKOT","Dakota State University Trojans"],
  ["513","Dakota Wesleyan","Tigers","DWU","Dakota Wesleyan Tigers"],["159","Dartmouth","Big Green","DART","Dartmouth Big Green"],["2166","Davidson","Wildcats","DAV","Davidson Wildcats"],["2168","Dayton","Flyers","DAY","Dayton Flyers"],
  ["83","DePauw","Tigers","DPU","DePauw Tigers"],["110438","Dean","Bulldogs","DEAN","Dean Bulldogs"],["190","Defiance College","Yellow Jackets","DEF","Defiance College Yellow Jackets"],["48","Delaware","Blue Hens","DEL","Delaware Blue Hens"],
  ["2169","Delaware State","Hornets","DSU","Delaware State Hornets"],["2808","Delaware Valley","Aggies","DVU","Delaware Valley Aggies"],["2170","Delta State","Statesmen","DLST","Delta State Statesmen"],["2171","Denison","Big Red","DSN","Denison Big Red"],
  ["2254","Des Moines","Vikings","GRANDVIEW","Des Moines Vikings"],["2175","Dickinson","Red Devils","DKSN","Dickinson Red Devils"],["316","Dickinson State University","Blue Hawks","DIC","Dickinson State University Blue Hawks"],["2181","Drake","Bulldogs","DRKE","Drake Bulldogs"],
  ["49","Dubuque","Spartans","DBQ","Dubuque Spartans"],["150","Duke","Blue Devils","DUKE","Duke Blue Devils"],["2184","Duquesne","Dukes","DUQ","Duquesne Dukes"],["151","East Carolina","Pirates","ECU","East Carolina Pirates"],
  ["2191","East Central","Tigers","ECNU","East Central Tigers"],["2188","East Stroudsburg","Warriors","ESU","East Stroudsburg Warriors"],["2193","East Tennessee State","Buccaneers","ETSU","East Tennessee State Buccaneers"],["2837","East Texas A&M","Lions","ETAM","East Texas A&M Lions"],
  ["2194","East Texas Baptist","Tigers","ETBU","East Texas Baptist Tigers"],["127954","Eastern","Eagles","EU","Eastern Eagles"],["2197","Eastern Illinois","Panthers","EIU","Eastern Illinois Panthers"],["2198","Eastern Kentucky","Colonels","EKU","Eastern Kentucky Colonels"],
  ["2199","Eastern Michigan","Eagles","EMU","Eastern Michigan Eagles"],["2201","Eastern New Mexico","Greyhounds","ENMU","Eastern New Mexico Greyhounds"],["2202","Eastern Oregon","Eastern Oregon","EORE","Eastern Oregon"],["331","Eastern Washington","Eagles","EWU","Eastern Washington Eagles"],
  ["2205","Edinboro","Fighting Scots","EDBR","Edinboro Fighting Scots"],["2206","Edward Waters","Tigers","EDW","Edward Waters Tigers"],["122775","Elgin","Eagles","JUDSO","Elgin Eagles"],["2207","Elizabeth City State","Vikings","ECSU","Elizabeth City State Vikings"],
  ["72","Elmhurst","Bluejays","ELMH","Elmhurst Bluejays"],["2210","Elon","Phoenix","ELON","Elon Phoenix"],["2213","Emory & Henry","Wasps","EHC","Emory & Henry Wasps"],["2214","Emporia State","Hornets","EMSU","Emporia State Hornets"],
  ["452","Endicott","Gulls","ENDC","Endicott Gulls"],["101784","Erskine","Flying Fleet","ERSK","Erskine Flying Fleet"],["101","Eureka","Red Devils","ERKA","Eureka Red Devils"],["2865","Evangel University","Crusaders","EVA","Evangel University Crusaders"],
  ["2221","FDU Florham","Devils","FDUF","FDU Florham Devils"],["2986","Fairmont State","Falcons","FMSU","Fairmont State Falcons"],["2219","Faulkner University","Eagles","FAULKNER","Faulkner University Eagles"],["2220","Fayetteville State","Broncos","FAYU","Fayetteville State Broncos"],
  ["2222","Ferris State","Bulldogs","FRST","Ferris State Bulldogs"],["366","Ferrum","Panthers","FC","Ferrum Panthers"],["2224","Findlay","Oilers","UF","Findlay Oilers"],["114","Fitchburg State","Falcons","FBSU","Fitchburg State Falcons"],
  ["50","Florida A&M","Rattlers","FAMU","Florida A&M Rattlers"],["2226","Florida Atlantic","Owls","FAU","Florida Atlantic Owls"],["57","Florida","Gators","FLA","Florida Gators"],["2229","Florida International","Panthers","FIU","Florida International Panthers"],
  ["125762","Florida Memorial University","Lions","FLAMEMRL","Florida Memorial University Lions"],["52","Florida State","Seminoles","FSU","Florida State Seminoles"],["2230","Fordham","Rams","FOR","Fordham Rams"],["2231","Fort Hays","Tigers","FHSU","Fort Hays Tigers"],
  ["2237","Fort Lewis","Skyhawks","FLWC","Fort Lewis Skyhawks"],["2232","Fort Valley State","Wildcats","FVSU","Fort Valley State Wildcats"],["2967","Framingham State","Rams","FRSU","Framingham State Rams"],["2234","Franklin & Marshall","Diplomats","FMC","Franklin & Marshall Diplomats"],
  ["2233","Franklin","Grizzlies","FRKL","Franklin Grizzlies"],["112334","Franklin Pierce","Ravens","FP","Franklin Pierce Ravens"],["278","Fresno State","Bulldogs","FRES","Fresno State Bulldogs"],["527","Friends University","Friends","FRIE","Friends University Friends"],
  ["341","Frostburg State","Bobcats","FSTU","Frostburg State Bobcats"],["231","Furman","Paladins","FUR","Furman Paladins"],["417","Gallaudet","Bison","GLDT","Gallaudet Bison"],["367","Gannon","Golden Knights","GANN","Gannon Golden Knights"],
  ["2241","Gardner-Webb","Runnin' Bulldogs","GWEB","Gardner-Webb Runnin' Bulldogs"],["2242","Geneva","Golden Tornadoes","GEN","Geneva Golden Tornadoes"],["415","George Fox","Bruins","GFU","George Fox Bruins"],["2244","George Mason University","Patriots","GMU","George Mason University Patriots"],
  ["2245","Georgetown (KY)","Tigers","GTKY","Georgetown (KY) Tigers"],["46","Georgetown","Hoyas","GTWN","Georgetown Hoyas"],["61","Georgia","Bulldogs","UGA","Georgia Bulldogs"],["290","Georgia Southern","Eagles","GASO","Georgia Southern Eagles"],
  ["2247","Georgia State","Panthers","GAST","Georgia State Panthers"],["59","Georgia Tech","Yellow Jackets","GT","Georgia Tech Yellow Jackets"],["2248","Gettysburg","Bullets","GTYB","Gettysburg Bullets"],["2249","Glenville State","Pioneers","GVLS","Glenville State Pioneers"],
  ["530","Graceland University","Graceland","GRC","Graceland University Graceland"],["2755","Grambling","Tigers","GRAM","Grambling Tigers"],["125","Grand Valley State","Lakers","GVSU","Grand Valley State Lakers"],["2256","Greensboro","Pride","GRNB","Greensboro Pride"],
  ["2257","Greenville","Panthers","GRNV","Greenville Panthers"],["65","Grinnell","Pioneers","GRNL","Grinnell Pioneers"],["146","Grove City","Wolverines","GRO","Grove City Wolverines"],["2258","Guilford","Quakers","GLFD","Guilford Quakers"],
  ["2968","Gustavus Adolphus","Golden Gusties","GAC","Gustavus Adolphus Golden Gusties"],["348","Hamilton","Continentals","HAM","Hamilton Continentals"],["162","Hamline","Pipers","HMLN","Hamline Pipers"],["297","Hampden Sydney","Tigers","HSC","Hampden Sydney Tigers"],
  ["2261","Hampton","Pirates","HAMP","Hampton Pirates"],["2262","Hanover","Panthers","HNVR","Hanover Panthers"],["2810","Hardin Simmons","Cowboys","HSU","Hardin Simmons Cowboys"],["2264","Harding","Bisons","HARD","Harding Bisons"],
  ["173","Hartwick","Hawks","HRTW","Hartwick Hawks"],["108","Harvard","Crimson","HARV","Harvard Crimson"],["535","Haskell Indian Nations Univ","Jayhawks","HASKELL","Haskell Indian Nations Univ Jayhawks"],["62","Hawai'i","Rainbow Warriors","HAW","Hawai'i Rainbow Warriors"],
  ["191","Heidelberg","Student Princes","HDBG","Heidelberg Student Princes"],["2271","Henderson State","Reddies","HSTU","Henderson State Reddies"],["418","Hendrix","Warriors","HDX","Hendrix Warriors"],["125974","Hilbert","Hawks","HLBT","Hilbert Hawks"],
  ["2273","Hillsdale","Chargers","HLDL","Hillsdale Chargers"],["2274","Hiram","Terriers","HIRM","Hiram Terriers"],["174","Hobart","Statesmen","HBRT","Hobart Statesmen"],["108354","Holland College","Hurricanes","HOL","Holland College Hurricanes"],
  ["107","Holy Cross","Crusaders","HC","Holy Cross Crusaders"],["2812","Hope","Flying Dutchmen","HOPE","Hope Flying Dutchmen"],["2277","Houston Christian","Huskies","HCU","Houston Christian Huskies"],["248","Houston","Cougars","HOU","Houston Cougars"],
  ["47","Howard","Bison","HOW","Howard Bison"],["2758","Howard Payne","Yellow Jackets","HWPU","Howard Payne Yellow Jackets"],["2938","Huntingdon","Hawks","HNTC","Huntingdon Hawks"],["2280","Husson","Eagles","HUSS","Husson Eagles"],
  ["2291","IU Pennsylvania","Crimson Hawks","IUP","IU Pennsylvania Crimson Hawks"],["304","Idaho State","Bengals","IDST","Idaho State Bengals"],["70","Idaho","Vandals","IDHO","Idaho Vandals"],["2286","Illinois College","Blueboys","ILLC","Illinois College Blueboys"],
  ["356","Illinois","Fighting Illini","ILL","Illinois Fighting Illini"],["2287","Illinois State","Redbirds","ILST","Illinois State Redbirds"],["306","Illinois Wesleyan","Titans","ILWU","Illinois Wesleyan Titans"],["2916","Incarnate Word","Cardinals","UIW","Incarnate Word Cardinals"],
  ["84","Indiana","Hoosiers","IU","Indiana Hoosiers"],["282","Indiana State","Sycamores","INST","Indiana State Sycamores"],["111756","Indiana Wesleyan","Wildcats","INWESL","Indiana Wesleyan Wildcats"],["2292","Indianapolis","Greyhounds","INDY","Indianapolis Greyhounds"],
  ["2294","Iowa","Hawkeyes","IOWA","Iowa Hawkeyes"],["66","Iowa State","Cyclones","ISU","Iowa State Cyclones"],["175","Ithaca","Bombers","ITH","Ithaca Bombers"],["2296","Jackson State","Tigers","JKST","Jackson State Tigers"],
  ["55","Jacksonville State","Gamecocks","JXST","Jacksonville State Gamecocks"],["256","James Madison","Dukes","JMU","James Madison Dukes"],["2939","Jamestown","Jimmies","UJ","Jamestown Jimmies"],["2302","John Carroll","Blue Streaks","JCU","John Carroll Blue Streaks"],
  ["118","Johns Hopkins","Blue Jays","JHU","Johns Hopkins Blue Jays"],["2304","Johnson C. Smith","Golden Bulls","JCSU","Johnson C. Smith Golden Bulls"],["246","Juniata","Eagles","JUN","Juniata Eagles"],["126","Kalamazoo","Hornets","KALC","Kalamazoo Hornets"],
  ["2305","Kansas","Jayhawks","KU","Kansas Jayhawks"],["2306","Kansas State","Wildcats","KSU","Kansas State Wildcats"],["547","Kansas Wesleyan","Ks Wesleyan","KANSA","Kansas Wesleyan Ks Wesleyan"],["2871","Kean","Cougars","KEAN","Kean Cougars"],
  ["126110","Keiser University","Keiser","KEISER","Keiser University Keiser"],["338","Kennesaw State","Owls","KENN","Kennesaw State Owls"],["2309","Kent State","Golden Flashes","KENT","Kent State Golden Flashes"],["3077","Kentucky Christian","Knights","KYCHR","Kentucky Christian Knights"],
  ["2310","Kentucky State","Thorobreds","KYSU","Kentucky State Thorobreds"],["2316","Kentucky Wesleyan","Panthers","KWC","Kentucky Wesleyan Panthers"],["96","Kentucky","Wildcats","UK","Kentucky Wildcats"],["352","Kenyon","Owls","KNY","Kenyon Owls"],
  ["122774","Keystone","Giants","KYSN","Keystone Giants"],["247","King's","Monarchs","KNGS","King's Monarchs"],["255","Knox","Prairie Fire","KNOX","Knox Prairie Fire"],["2315","Kutztown","Golden Bears","KUTZ","Kutztown Golden Bears"],
  ["99","LSU","Tigers","LSU","LSU Tigers"],["2318","La Verne","Leopards","ULV","La Verne Leopards"],["548","LaGrange","Panthers","LGC","LaGrange Panthers"],["322","Lafayette","Leopards","LAF","Lafayette Leopards"],
  ["437","Lake Erie","Storm","LKER","Lake Erie Storm"],["262","Lake Forest","Foresters","LFC","Lake Forest Foresters"],["6353","Lakeland","Muskies","LKLD","Lakeland Muskies"],["2320","Lamar","Cardinals","LAM","Lamar Cardinals"],
  ["2323","Lane College","Dragons","LANE","Lane College Dragons"],["2324","Langston","Lions","LNGT","Langston Lions"],["268","Lawrence","Vikings","LAW","Lawrence Vikings"],["388","Lebanon Valley","Flying Dutchmen","LVC","Lebanon Valley Flying Dutchmen"],
  ["2329","Lehigh","Mountain Hawks","LEH","Lehigh Mountain Hawks"],["2331","Lenoir Rhyne","Bears","LENR","Lenoir Rhyne Bears"],["2333","Lewis & Clark","River Otters","LC","Lewis & Clark River Otters"],["2335","Liberty","Flames","LIB","Liberty Flames"],
  ["124179","Lincoln (CA)","Oaklanders","LNCA","Lincoln (CA) Oaklanders"],["2876","Lincoln (MO)","Blue Tigers","LNMO","Lincoln (MO) Blue Tigers"],["2339","Lincoln (PA)","Lions","LNPA","Lincoln (PA) Lions"],["3209","Lindenwood Belleville","Lynx","LINB","Lindenwood Belleville Lynx"],
  ["2815","Lindenwood","Lions","LIN","Lindenwood Lions"],["2877","Lindsey Wilson","LINDSEY","LWU","Lindsey Wilson LINDSEY"],["203","Linfield","Wildcats","LINF","Linfield Wildcats"],["2940","Livingstone","Blue Bears","LIV","Livingstone Blue Bears"],
  ["209","Lock Haven","Bald Eagles","LHU","Lock Haven Bald Eagles"],["2341","Long Island University","Sharks","LIU","Long Island University Sharks"],["263","Loras","Duhawks","LOR","Loras Duhawks"],["2347","Louisiana Christian","Wildcats","LCHR","Louisiana Christian Wildcats"],
  ["309","Louisiana","Ragin' Cajuns","UL","Louisiana Ragin' Cajuns"],["2348","Louisiana Tech","Bulldogs","LT","Louisiana Tech Bulldogs"],["97","Louisville","Cardinals","LOU","Louisville Cardinals"],["67","Luther","Norse","LUTH","Luther Norse"],
  ["2354","Lycoming","Warriors","LYCO","Lycoming Warriors"],["101161","Lyon","Scots","LYON","Lyon Scots"],["126146","Madonna","MADONNA","MDNN","MADONNA"],["2770","Manitoba","MANITOBA","MB","MANITOBA"],
  ["109","MIT","Engineers","MIT","MIT Engineers"],["2359","Macalester","Scots","MAC","Macalester Scots"],["311","Maine","Black Bears","ME","Maine Black Bears"],["274","Maine Maritime","Mariners","UMMA","Maine Maritime Mariners"],
  ["2362","Manchester","Spartans","MNCH","Manchester Spartans"],["2365","Mansfield","Mountaineers","MNFD","Mansfield Mountaineers"],["2366","Marian (IN)","MARIAN","MUIN","Marian (IN) MARIAN"],["317","Marietta","Pioneers","MRTT","Marietta Pioneers"],
  ["2368","Marist","Red Foxes","MRST","Marist Red Foxes"],["2369","Mars Hill","Lions","MHU","Mars Hill Lions"],["276","Marshall","Thundering Herd","MRSH","Marshall Thundering Herd"],["446","Martin Luther","Knights","MLC","Martin Luther Knights"],
  ["2371","Mary Hardin Baylor","Crusaders","MHB","Mary Hardin Baylor Crusaders"],["120","Maryland","Terrapins","MD","Maryland Terrapins"],["2373","Maryville (TN)","Scots","MCTN","Maryville (TN) Scots"],["110","Mass Maritime","Buccaneers","MMT","Mass Maritime Buccaneers"],
  ["113","Massachusetts","Minutemen","MASS","Massachusetts Minutemen"],["561","Mayville State","Comets","MYSU","Mayville State Comets"],["2700","McDaniel","Green Terror","MCD","McDaniel Green Terror"],["2816","McKendree","Bearcats","MCK","McKendree Bearcats"],
  ["241","McMurry","War Hawks","MCM","McMurry War Hawks"],["2377","McNeese","Cowboys","MCN","McNeese Cowboys"],["235","Memphis","Tigers","MEM","Memphis Tigers"],["2382","Mercer","Bears","MER","Mercer Bears"],
  ["2383","Merchant Marine","Mariners","MMA","Merchant Marine Mariners"],["2385","Mercyhurst","Lakers","MERC","Mercyhurst Lakers"],["2771","Merrimack","Warriors","MRMK","Merrimack Warriors"],["291","Methodist","Monarchs","MU","Methodist Monarchs"],
  ["193","Miami (OH)","RedHawks","M-OH","Miami (OH) RedHawks"],["2390","Miami","Hurricanes","MIA","Miami Hurricanes"],["127","Michigan State","Spartans","MSU","Michigan State Spartans"],["2392","Michigan Tech","Huskies","MTU","Michigan Tech Huskies"],
  ["130","Michigan","Wolverines","MICH","Michigan Wolverines"],["2393","Middle Tennessee","Blue Raiders","MTSU","Middle Tennessee Blue Raiders"],["2394","Middlebury","Panthers","MIDB","Middlebury Panthers"],["565","Midland","MIDLAND LUTHERAN","MIDL","Midland MIDLAND LUTHERAN"],
  ["2395","Midwestern State","Mustangs","MWSU","Midwestern State Mustangs"],["2396","Miles","Golden Bears","MILE","Miles Golden Bears"],["210","Millersville","Marauders","MILL","Millersville Marauders"],["74","Millikin","Big Blue","MILK","Millikin Big Blue"],
  ["2398","Millsaps","Majors","MLSP","Millsaps Majors"],["134","Minnesota Duluth","Bulldogs","UMD","Minnesota Duluth Bulldogs"],["135","Minnesota","Golden Gophers","MINN","Minnesota Golden Gophers"],["2399","Minnesota Morris","Cougars","MNMO","Minnesota Morris Cougars"],
  ["2817","Minnesota St Moorhead","Dragons","MSUM","Minnesota St Moorhead Dragons"],["2364","Minnesota State","Mavericks","MNST","Minnesota State Mavericks"],["568","Minot State","Beavers","MINS","Minot State Beavers"],["2969","Misericordia","Cougars","MISE","Misericordia Cougars"],
  ["344","Mississippi State","Bulldogs","MSST","Mississippi State Bulldogs"],["2400","Mississippi Valley State","Delta Devils","MVSU","Mississippi Valley State Delta Devils"],["2880","Missouri Baptist","Spartans","MOBU","Missouri Baptist Spartans"],["2402","Missouri S&T","Miners","MS&T","Missouri S&T Miners"],
  ["2403","Missouri Southern State","Lions","MSSU","Missouri Southern State Lions"],["2623","Missouri State","Bears","MOST","Missouri State Bears"],["142","Missouri","Tigers","MIZ","Missouri Tigers"],["137","Missouri Western","Griffons","MOWE","Missouri Western Griffons"],
  ["2919","Monmouth (IL)","Fighting Scots","MNIL","Monmouth (IL) Fighting Scots"],["2405","Monmouth","Hawks","MONM","Monmouth Hawks"],["134001","Monroe","Mustangs","MON","Monroe Mustangs"],["149","Montana","Grizzlies","MONT","Montana Grizzlies"],
  ["147","Montana State","Bobcats","MTST","Montana State Bobcats"],["2701","Montana Western","Bulldogs","UMW","Montana Western Bulldogs"],["2818","Montclair State","Red Hawks","MCST","Montclair State Red Hawks"],["3100","Monterrey Tech","Borregos","MITE","Monterrey Tech Borregos"],
  ["323","Moravian","Greyhounds","MOR","Moravian Greyhounds"],["2413","Morehead State","Eagles","MORE","Morehead State Eagles"],["60","Morehouse","Maroon Tigers","MRHO","Morehouse Maroon Tigers"],["2415","Morgan State","Bears","MORG","Morgan State Bears"],
  ["2416","Morningside","Chiefs","MNGS","Morningside Chiefs"],["2419","Mount St Joseph","Lions","MSJ","Mount St Joseph Lions"],["426","Mount Union","Purple Raiders","UMU","Mount Union Purple Raiders"],["2422","Muhlenberg","Mules","MUHL","Muhlenberg Mules"],
  ["93","Murray State","Racers","MUR","Murray State Racers"],["332","Muskingum","Fighting Muskies","MSK","Muskingum Fighting Muskies"],["152","NC State","Wolfpack","NCSU","NC State Wolfpack"],["2426","Navy","Midshipmen","NAVY","Navy Midshipmen"],
  ["158","Nebraska","Cornhuskers","NEB","Nebraska Cornhuskers"],["2438","Nebraska Kearney","Lopers","NEBK","Nebraska Kearney Lopers"],["6845","Nebraska Wesleyan","Prairie Wolves","NWU","Nebraska Wesleyan Prairie Wolves"],["2904","Nelson (TX)","Lions","NEL","Nelson (TX) Lions"],
  ["2440","Nevada","Wolf Pack","NEV","Nevada Wolf Pack"],["111675","New England","Nor'easters","UNE","New England Nor'easters"],["160","New Hampshire","Wildcats","UNH","New Hampshire Wildcats"],["2441","New Haven","Chargers","NHVN","New Haven Chargers"],
  ["2424","New Mexico Highlands","Cowboys","NMHU","New Mexico Highlands Cowboys"],["167","New Mexico","Lobos","UNM","New Mexico Lobos"],["166","New Mexico State","Aggies","NMSU","New Mexico State Aggies"],["2444","Newberry","Wolves","NBRY","Newberry Wolves"],
  ["2447","Nicholls","Colonels","NICH","Nicholls Colonels"],["2884","Nichols","Bison","NICC","Nichols Bison"],["2450","Norfolk State","Spartans","NORF","Norfolk State Spartans"],["2453","North Alabama","Lions","UNA","North Alabama Lions"],
  ["123086","North American","Stallions","NAMU","North American Stallions"],["2448","North Carolina A&T","Aggies","NCAT","North Carolina A&T Aggies"],["2428","North Carolina Central","Eagles","NCCU","North Carolina Central Eagles"],["153","North Carolina","Tar Heels","UNC","North Carolina Tar Heels"],
  ["286","North Carolina Wesleyan","Battling Bishops","NCW","North Carolina Wesleyan Battling Bishops"],["3071","North Central College","Cardinals","NCC","North Central College Cardinals"],["155","North Dakota","Fighting Hawks","UND","North Dakota Fighting Hawks"],["2449","North Dakota State","Bison","NDSU","North Dakota State Bison"],
  ["2822","North Greenville","Trailblazers","NGU","North Greenville Trailblazers"],["75","North Park","Vikings","NPU","North Park Vikings"],["249","North Texas","Mean Green","UNT","North Texas Mean Green"],["196","Northeastern State","RiverHawks","NESU","Northeastern State RiverHawks"],
  ["2464","Northern Arizona","Lumberjacks","NAU","Northern Arizona Lumberjacks"],["2458","Northern Colorado","Bears","UNCO","Northern Colorado Bears"],["2459","Northern Illinois","Huskies","NIU","Northern Illinois Huskies"],["2460","Northern Iowa","Panthers","UNI","Northern Iowa Panthers"],
  ["128","Northern Michigan","Wildcats","NMI","Northern Michigan Wildcats"],["425","Northern State","Wolves","NSU","Northern State Wolves"],["138","Northwest Missouri State","Bearcats","MWMO","Northwest Missouri State Bearcats"],["583","Northwestern (MN)","Eagles","UNW","Northwestern (MN) Eagles"],
  ["2823","Northwestern (OK)","Rangers","NWOK","Northwestern (OK) Rangers"],["2466","Northwestern State","Demons","NWST","Northwestern State Demons"],["77","Northwestern","Wildcats","NU","Northwestern Wildcats"],["2886","Northwood","Timberwolves","NWD","Northwood Timberwolves"],
  ["2467","Norwich","Cadets","NWCH","Norwich Cadets"],["87","Notre Dame","Fighting Irish","ND","Notre Dame Fighting Irish"],["391","Oberlin","Yeomen","OBE","Oberlin Yeomen"],["195","Ohio","Bobcats","OHIO","Ohio Bobcats"],
  ["2477","Ohio Dominican","Panthers","OHDU","Ohio Dominican Panthers"],["427","Ohio Northern","Polar Bears","OHNU","Ohio Northern Polar Bears"],["194","Ohio State","Buckeyes","OSU","Ohio State Buckeyes"],["3161","Ohio State Newark","Titans","OSU","Ohio State Newark Titans"],
  ["2980","Ohio Wesleyan","Battling Bishops","OWU","Ohio Wesleyan Battling Bishops"],["319","Oklahoma Baptist","Bison","OKBU","Oklahoma Baptist Bison"],["2824","Oklahoma Panhandle","OK PANHANDLE ST","OPSU","Oklahoma Panhandle OK PANHANDLE ST"],["201","Oklahoma","Sooners","OU","Oklahoma Sooners"],
  ["197","Oklahoma State","Cowboys","OKST","Oklahoma State Cowboys"],["295","Old Dominion","Monarchs","ODU","Old Dominion Monarchs"],["145","Ole Miss","Rebels","MISS","Ole Miss Rebels"],["354","Olivet","Comets","UOO","Olivet Comets"],
  ["2483","Oregon","Ducks","ORE","Oregon Ducks"],["204","Oregon State","Beavers","ORST","Oregon State Beavers"],["359","Otterbein","Cardinals","OTTB","Otterbein Cardinals"],["2888","Ouachita Baptist","Tigers","OBU","Ouachita Baptist Tigers"],
  ["2487","Pace","Setters","PACE","Pace Setters"],["205","Pacific (OR)","Boxers","PCOR","Pacific (OR) Boxers"],["2486","Pacific Lutheran","Lutes","PCLT","Pacific Lutheran Lutes"],["213","Penn State","Nittany Lions","PSU","Penn State Nittany Lions"],
  ["219","Pennsylvania","Quakers","PENN","Pennsylvania Quakers"],["108358","Phoenix","Firestorm","AZCHR","Phoenix Firestorm"],["95","Pikeville","Bears","PIKEV","Pikeville Bears"],["90","Pittsburg State","Gorillas","PTSU","Pittsburg State Gorillas"],
  ["221","Pittsburgh","Panthers","PITT","Pittsburgh Panthers"],["2972","Plymouth State","Panthers","PLYM","Plymouth State Panthers"],["3179","Point University","Skyhawks","POINT","Point University Skyhawks"],["2923","Pomona Pitzer","Sagehens","POPI","Pomona Pitzer Sagehens"],
  ["2502","Portland State","Vikings","PRST","Portland State Vikings"],["126086","Post","Eagles","POST","Post Eagles"],["2504","Prairie View A&M","Panthers","PV","Prairie View A&M Panthers"],["2506","Presbyterian","Blue Hose","PRES","Presbyterian Blue Hose"],
  ["163","Princeton","Tigers","PRIN","Princeton Tigers"],["2508","Puget Sound","Loggers","PUG","Puget Sound Loggers"],["2509","Purdue","Boilermakers","PUR","Purdue Boilermakers"],["2825","Quincy","Hawks","QUI","Quincy Hawks"],
  ["2516","Randolph Macon","Yellow Jackets","RMC","Randolph Macon Yellow Jackets"],["29","Redlands","Bulldogs","REDL","Redlands Bulldogs"],["2890","Reinhardt","Eagles","RHDT","Reinhardt Eagles"],["2528","Rensselaer","Engineers","RPI","Rensselaer Engineers"],
  ["227","Rhode Island","Rams","URI","Rhode Island Rams"],["2519","Rhodes","Lynx","RHDS","Rhodes Lynx"],["242","Rice","Owls","RICE","Rice Owls"],["257","Richmond","Spiders","RICH","Richmond Spiders"],
  ["2891","Ripon","Red Hawks","RIP","Ripon Red Hawks"],["2523","Robert Morris","Colonials","RMU","Robert Morris Colonials"],["184","Rochester (NY)","Yellow Jackets","URNY","Rochester (NY) Yellow Jackets"],["2524","Rockford","Regents","RFU","Rockford Regents"],
  ["599","Roosevelt","Lakers","RSVT","Roosevelt Lakers"],["127991","Roosevelt","Lakers","RSVT","Roosevelt Lakers"],["86","Rose Hulman","Fightin' Engineers","RHIT","Rose Hulman Fightin' Engineers"],["2827","Rowan","Profs","ROW","Rowan Profs"],
  ["164","Rutgers","Scarlet Knights","RUTG","Rutgers Scarlet Knights"],["2545","SE Louisiana","Lions","SELA","SE Louisiana Lions"],["2567","SMU","Mustangs","SMU","SMU Mustangs"],["2782","SUNY Cortland","Red Dragons","NYCL","SUNY Cortland Red Dragons"],
  ["3236","SUNY Erie","Kats","NYER","SUNY Erie Kats"],["2951","SUNY Maritime","Privateers","NYMT","SUNY Maritime Privateers"],["3110","SUNY Morrisville","Mustangs","NYMS","SUNY Morrisville Mustangs"],["16","Sacramento State","Hornets","SAC","Sacramento State Hornets"],
  ["2529","Sacred Heart","Pioneers","SHU","Sacred Heart Pioneers"],["129","Saginaw Valley State","Cardinals","SVSU","Saginaw Valley State Cardinals"],["2830","Saint Anselm","Hawks","SANS","Saint Anselm Hawks"],["2831","Saint Francis (IN)","Cougars","SFIN","Saint Francis (IN) Cougars"],
  ["2598","Saint Francis","Red Flash","SFPA","Saint Francis Red Flash"],["2600","Saint John's (MN)","Johnnies","STJM","Saint John's (MN) Johnnies"],["2614","Saint Vincent","Bearcats","SVC","Saint Vincent Bearcats"],["2615","Saint Xavier","Cougars","STX","Saint Xavier Cougars"],
  ["2532","Salisbury","Sea Gulls","SAL","Salisbury Sea Gulls"],["2776","Salve Regina","Seahawks","SALV","Salve Regina Seahawks"],["2534","Sam Houston","Bearkats","SHSU","Sam Houston Bearkats"],["2535","Samford","Bulldogs","SAM","Samford Bulldogs"],
  ["21","San Diego State","Aztecs","SDSU","San Diego State Aztecs"],["301","San Diego","Toreros","USD","San Diego Toreros"],["23","San José State","Spartans","SJSU","San José State Spartans"],["2542","Savannah State","Tigers","SAV","Savannah State Tigers"],
  ["611","Seton Hill","Griffins","SEHI","Seton Hill Griffins"],["2553","Sewanee","Tigers","SEWA","Sewanee Tigers"],["2551","Shaw","Bears","SHAW","Shaw Bears"],["2828","Shenandoah","Hornets","SHEN","Shenandoah Hornets"],
  ["2974","Shepherd","Rams","SHEP","Shepherd Rams"],["2559","Shippensburg","Raiders","SHIP","Shippensburg Raiders"],["2560","Shorter","Hawks","SHOU","Shorter Hawks"],["2562","Siena Heights","Saints","SHTU","Siena Heights Saints"],
  ["129758","Simpson (CA)","Red Hawks","SUCA","Simpson (CA) Red Hawks"],["2564","Simpson (IA)","Storm","SCIA","Simpson (IA) Storm"],["2894","Sioux Falls","Cougars","SFU","Sioux Falls Cougars"],["215","Slippery Rock","The Rock","SRU","Slippery Rock The Rock"],
  ["6","South Alabama","Jaguars","USA","South Alabama Jaguars"],["2579","South Carolina","Gamecocks","SC","South Carolina Gamecocks"],["2569","South Carolina State","Bulldogs","SCST","South Carolina State Bulldogs"],["233","South Dakota","Coyotes","SDAK","South Dakota Coyotes"],
  ["613","South Dakota Mines","Hardrockers","SDMT","South Dakota Mines Hardrockers"],["2571","South Dakota State","Jackrabbits","SDST","South Dakota State Jackrabbits"],["58","South Florida","Bulls","USF","South Florida Bulls"],["2546","Southeast Missouri State","Redhawks","SEMO","Southeast Missouri State Redhawks"],
  ["267","Southeastern","Fires","SEU","Southeastern Fires"],["199","Southeastern Oklahoma State","Savage Storm","SEOK","Southeastern Oklahoma State Savage Storm"],["2568","Southern Arkansas","Muleriders","SAR","Southern Arkansas Muleriders"],["2583","Southern Connecticut State","Owls","SCTS","Southern Connecticut State Owls"],
  ["79","Southern Illinois","Salukis","SIU","Southern Illinois Salukis"],["2582","Southern","Jaguars","SOU","Southern Jaguars"],["2572","Southern Miss","Golden Eagles","USM","Southern Miss Golden Eagles"],["200","Southern Nazarene","Crimson Storm","SNU","Southern Nazarene Crimson Storm"],
  ["2584","Southern Oregon","Raiders","SOR","Southern Oregon Raiders"],["253","Southern Utah","Thunderbirds","SUU","Southern Utah Thunderbirds"],["2896","Southern Virginia","Knights","SOVA","Southern Virginia Knights"],["2586","Southwest Baptist","Bearcats","SWBU","Southwest Baptist Bearcats"],
  ["2587","Southwest Minnesota State","Mustangs","SWMS","Southwest Minnesota State Mustangs"],["616","Southwestern (KS)","Moundbuilders","SWKS","Southwestern (KS) Moundbuilders"],["2927","Southwestern Oklahoma State","Bulldogs","SOSU","Southwestern Oklahoma State Bulldogs"],["2588","Southwestern U","Pirates","SWU","Southwestern U Pirates"],
  ["81","Springfield","Pride","SPR","Springfield Pride"],["2591","St. Ambrose","Fighting Bees","STAM","St. Ambrose Fighting Bees"],["111610","St. Andrews","Knights","STAU","St. Andrews Knights"],["2595","St. Francis (IL)","Fighting Saints","SFIL","St. Francis (IL) Fighting Saints"],
  ["374","St. John Fisher","Cardinals","STJF","St. John Fisher Cardinals"],["2779","St. Lawrence","Saints","USL","St. Lawrence Saints"],["2832","St. Norbert","Green Knights","STNC","St. Norbert Green Knights"],["133","St. Olaf","Oles","OLAF","St. Olaf Oles"],
  ["3254","St. Petersburg","Glory Eagles","UFFL","St. Petersburg Glory Eagles"],["375","St. Scholastica","Saints","CSS","St. Scholastica Saints"],["2900","St. Thomas","Tommies","STMN","St. Thomas Tommies"],["24","Stanford","Cardinal","STAN","Stanford Cardinal"],
  ["2617","Stephen F. Austin","Lumberjacks","SFA","Stephen F. Austin Lumberjacks"],["618","Sterling","STERLING KS","STLG","Sterling STERLING KS"],["56","Stetson","Hatters","STET","Stetson Hatters"],["471","Stevenson","Mustangs","STVS","Stevenson Mustangs"],
  ["284","Stonehill","Skyhawks","STO","Stonehill Skyhawks"],["2619","Stony Brook","Seawolves","STBK","Stony Brook Seawolves"],["2834","Sul Ross State","Lobos","SRST","Sul Ross State Lobos"],["216","Susquehanna","River Hawks","SUSQ","Susquehanna River Hawks"],
  ["183","Syracuse","Orange","SYR","Syracuse Orange"],["2628","TCU","Horned Frogs","TCU","TCU Horned Frogs"],["2627","Tarleton State","Texans","TAR","Tarleton State Texans"],["620","Taylor","Trojans","TLRU","Taylor Trojans"],
  ["218","Temple","Owls","TEM","Temple Owls"],["2634","Tennessee State","Tigers","TNST","Tennessee State Tigers"],["2635","Tennessee Tech","Golden Eagles","TNTC","Tennessee Tech Golden Eagles"],["2633","Tennessee","Volunteers","TENN","Tennessee Volunteers"],
  ["245","Texas A&M","Aggies","TA&M","Texas A&M Aggies"],["2658","Texas A&M-Kingsville","Javelinas","TAMK","Texas A&M-Kingsville Javelinas"],["2637","Texas College","Steers","TXCL","Texas College Steers"],["251","Texas","Longhorns","TEX","Texas Longhorns"],
  ["2639","Texas Lutheran","Bulldogs","TXLU","Texas Lutheran Bulldogs"],["2640","Texas Southern","Tigers","TXSO","Texas Southern Tigers"],["326","Texas State","Bobcats","TXST","Texas State Bobcats"],["2641","Texas Tech","Red Raiders","TTU","Texas Tech Red Raiders"],
  ["2643","The Citadel","Bulldogs","CIT","The Citadel Bulldogs"],["2442","The College of New Jersey","Lions","TCNJ","The College of New Jersey Lions"],["2644","Thiel","Tomcats","THI","Thiel Tomcats"],["2646","Thomas More","Saints","TMOR","Thomas More Saints"],
  ["134000","Thomas","Night Hawks","THO","Thomas Night Hawks"],["2838","Tiffin","Dragons","TIFF","Tiffin Dragons"],["2649","Toledo","Rockets","TOL","Toledo Rockets"],["119","Towson","Tigers","TOW","Towson Tigers"],
  ["2651","Trine","Thunder","TRNE","Trine Thunder"],["2977","Trinity (CT)","Bantams","TCCT","Trinity (CT) Bantams"],["386","Trinity (TX)","Tigers","TUTX","Trinity (TX) Tigers"],["3214","Trinity Bible","Lions","TBIB","Trinity Bible Lions"],
  ["2653","Troy","Trojans","TROY","Troy Trojans"],["3237","Troy","Vikings","HVCC","Troy Vikings"],["2654","Truman State","Bulldogs","TRST","Truman State Bulldogs"],["112","Tufts","Jumbos","TUFT","Tufts Jumbos"],
  ["2655","Tulane","Green Wave","TULN","Tulane Green Wave"],["202","Tulsa","Golden Hurricane","TLSA","Tulsa Golden Hurricane"],["2839","Tusculum","Pioneers","TUSC","Tusculum Pioneers"],["2657","Tuskegee","Golden Tigers","TUSK","Tuskegee Golden Tigers"],
  ["5","UAB","Blazers","UAB","UAB Blazers"],["399","UAlbany","Great Danes","UALB","UAlbany Great Danes"],["302","UC Davis","Aggies","UCD","UC Davis Aggies"],["2116","UCF","Knights","UCF","UCF Knights"],
  ["26","UCLA","Bruins","UCLA","UCLA Bruins"],["41","UConn","Huskies","CONN","UConn Huskies"],["2433","UL Monroe","Warhawks","ULM","UL Monroe Warhawks"],["379","UMass Dartmouth","Corsairs","MDAR","UMass Dartmouth Corsairs"],
  ["2882","UNC Pembroke","Braves","UNCP","UNC Pembroke Braves"],["2439","UNLV","Rebels","UNLV","UNLV Rebels"],["30","USC","Trojans","USC","USC Trojans"],["2630","UT Martin","Skyhawks","UTM","UT Martin Skyhawks"],
  ["110243","UT Permian Basin","Falcons","UTPB","UT Permian Basin Falcons"],["2638","UTEP","Miners","UTEP","UTEP Miners"],["2636","UTSA","Roadrunners","UTSA","UTSA Roadrunners"],["2842","UVA Wise","Cavaliers","UVAW","UVA Wise Cavaliers"],
  ["237","Union","Garnet Chargers","UNNY","Union Garnet Chargers"],["559","University of Mary","Marauders","MARY","University of Mary Marauders"],["3212","University of Mexico","MEXICO U","UNAM","University of Mexico MEXICO U"],["389","Upper Iowa","Peacocks","UIU","Upper Iowa Peacocks"],
  ["2667","Ursinus","Bears","URSN","Ursinus Bears"],["328","Utah State","Aggies","USU","Utah State Aggies"],["3101","Utah Tech","Trailblazers","UTU","Utah Tech Trailblazers"],["254","Utah","Utes","UTAH","Utah Utes"],
  ["390","Utica","Pioneers","UTIC","Utica Pioneers"],["2678","VMI","Keydets","VMI","VMI Keydets"],["2673","Valdosta State","Blazers","VALD","Valdosta State Blazers"],["628","Valley City State","Vikings","VCSU","Valley City State Vikings"],
  ["2674","Valparaiso","Beacons","VAL","Valparaiso Beacons"],["238","Vanderbilt","Commodores","VAN","Vanderbilt Commodores"],["293","Vermont State Castleton","Spartans","VTSC","Vermont State Castleton Spartans"],["222","Villanova","Wildcats","VILL","Villanova Wildcats"],
  ["258","Virginia","Cavaliers","UVA","Virginia Cavaliers"],["2355","Virginia Lynchburg","Dragons","VUL","Virginia Lynchburg Dragons"],["330","Virginia State","Trojans","VSU","Virginia State Trojans"],["259","Virginia Tech","Hokies","VT","Virginia Tech Hokies"],
  ["2676","Virginia Union","Panthers","VUU","Virginia Union Panthers"],["2749","WPI","Engineers","WPI","WPI Engineers"],["2706","WVU Tech","Golden Bears","WVUT","WVU Tech Golden Bears"],["89","Wabash","Little Giants","WAB","Wabash Little Giants"],
  ["2681","Wagner","Seahawks","WAG","Wagner Seahawks"],["154","Wake Forest","Demon Deacons","WAKE","Wake Forest Demon Deacons"],["3080","Waldorf","Warriors","WLDF","Waldorf Warriors"],["2682","Walsh","Cavaliers","WLSH","Walsh Cavaliers"],
  ["2683","Warner","Royals","WRNR","Warner Royals"],["2685","Wartburg","Knights","WTBG","Wartburg Knights"],["2687","Washburn","Ichabods","WSBN","Washburn Ichabods"],["2686","Washington & Jefferson","Presidents","W&J","Washington & Jefferson Presidents"],
  ["264","Washington","Huskies","WASH","Washington Huskies"],["143","Washington St. Louis","Bears","WUMO","Washington St. Louis Bears"],["265","Washington State","Cougars","WSU","Washington State Cougars"],["2688","Washington and Lee","Generals","W&L","Washington and Lee Generals"],
  ["630","Wayland Baptist","Pioneers","WYBU","Wayland Baptist Pioneers"],["131","Wayne State (MI)","Warriors","WSMI","Wayne State (MI) Warriors"],["2844","Wayne State (NE)","Wildcats","WSNE","Wayne State (NE) Wildcats"],["2845","Waynesburg","Yellow Jackets","WAYN","Waynesburg Yellow Jackets"],
  ["2691","Webber International","Warriors","WINT","Webber International Warriors"],["2692","Weber State","Wildcats","WEB","Weber State Wildcats"],["336","Wesleyan (CT)","Cardinals","WSCT","Wesleyan (CT) Cardinals"],["2695","West Alabama","Tigers","UWA","West Alabama Tigers"],
  ["223","West Chester","Golden Rams","WCHT","West Chester Golden Rams"],["110242","West Florida","Argonauts","UWF","West Florida Argonauts"],["2698","West Georgia","Wolves","WGA","West Georgia Wolves"],["2699","West Liberty","Hilltoppers","WLU","West Liberty Hilltoppers"],
  ["3211","West Memphis","Crusaders","FAI","West Memphis Crusaders"],["2704","West Texas","Buffaloes","WTAM","West Texas Buffaloes"],["277","West Virginia","Mountaineers","WVU","West Virginia Mountaineers"],["2707","West Virginia State","Yellow Jackets","WVSU","West Virginia State Yellow Jackets"],
  ["455","West Virginia Wesleyan","Bobcats","WVWC","West Virginia Wesleyan Bobcats"],["2717","Western Carolina","Catamounts","WCU","Western Carolina Catamounts"],["2714","Western Colorado","Mountaineers","WCOL","Western Colorado Mountaineers"],["2843","Western Connecticut State","Wolves","WCSU","Western Connecticut State Wolves"],
  ["2710","Western Illinois","Leathernecks","WIU","Western Illinois Leathernecks"],["98","Western Kentucky","Hilltoppers","WKU","Western Kentucky Hilltoppers"],["2711","Western Michigan","Broncos","WMU","Western Michigan Broncos"],["2702","Western New England","Golden Bears","WNE","Western New England Golden Bears"],
  ["2703","Western New Mexico","Mustangs","WNMU","Western New Mexico Mustangs"],["2848","Western Oregon","Wolves","WORU","Western Oregon Wolves"],["2909","Westfield State","Owls","WFST","Westfield State Owls"],["134087","Westgate Christian University","Ravens","WES","Westgate Christian University Ravens"],
  ["433","Westminster (MO)","Blue Jays","WCMO","Westminster (MO) Blue Jays"],["2849","Westminster (PA)","Titans","WCPA","Westminster (PA) Titans"],["396","Wheaton (IL)","Thunder","WCIL","Wheaton (IL) Thunder"],["112335","Wheeling","Cardinals","WHLG","Wheeling Cardinals"],
  ["2850","Whittier","Poets","WHTR","Whittier Poets"],["2721","Whitworth","Pirates","WHIW","Whitworth Pirates"],["2725","Widener","Pride","WIDE","Widener Pride"],["398","Wilkes","Colonels","WILK","Wilkes Colonels"],
  ["2930","Willamette","Bearcats","WLMT","Willamette Bearcats"],["2729","William & Mary","Tribe","W&M","William & Mary Tribe"],["2911","William Jewell","Cardinals","WJC","William Jewell Cardinals"],["2970","William Paterson","Pioneers","WPU","William Paterson Pioneers"],
  ["2912","William Penn","Statesmen","WPEN","William Penn Statesmen"],["2731","Williams","Ephs","WLM","Williams Ephs"],["3130","Williamson","Mechanics","WMSN","Williamson Mechanics"],["2733","Wilmington (OH)","Fightin' Quakers","WCOH","Wilmington (OH) Fightin' Quakers"],
  ["351","Wingate","Bulldogs","WINU","Wingate Bulldogs"],["2851","Winona State","Warriors","WNST","Winona State Warriors"],["2736","Winston-Salem State","Rams","WSSU","Winston-Salem State Rams"],["275","Wisconsin","Badgers","WIS","Wisconsin Badgers"],
  ["2738","Wisconsin Eau Claire","Blugolds","UWEC","Wisconsin Eau Claire Blugolds"],["2740","Wisconsin La Crosse","Eagles","UWL","Wisconsin La Crosse Eagles"],["2741","Wisconsin Lutheran","Warriors","WLC","Wisconsin Lutheran Warriors"],["271","Wisconsin Oshkosh","Titans","UWO","Wisconsin Oshkosh Titans"],
  ["272","Wisconsin Platteville","Pioneers","UWP","Wisconsin Platteville Pioneers"],["2723","Wisconsin River Falls","Falcons","UWRF","Wisconsin River Falls Falcons"],["2743","Wisconsin Stevens Point","Pointers","UWSP","Wisconsin Stevens Point Pointers"],["2744","Wisconsin Stout","Blue Devils","UWST","Wisconsin Stout Blue Devils"],
  ["2745","Wisconsin Whitewater","Warhawks","UWW","Wisconsin Whitewater Warhawks"],["2746","Wittenberg","Tigers","WITT","Wittenberg Tigers"],["2747","Wofford","Terriers","WOF","Wofford Terriers"],["2748","Wooster","Fighting Scots","WOO","Wooster Fighting Scots"],
  ["402","Worcester State","Lancers","WORC","Worcester State Lancers"],["2751","Wyoming","Cowboys","WYO","Wyoming Cowboys"],["43","Yale","Bulldogs","YALE","Yale Bulldogs"],["2754","Youngstown State","Penguins","YSU","Youngstown State Penguins"],
];

  // Google Sheets' hard per-cell character cap. backend/Code.gs stores one
  // storage key per row, whole JSON string in column 2, no chunking.
  const GOOGLE_SHEETS_CELL_LIMIT = 50000;
  // Our own working ceiling for `cfbp_settings`. Deliberately FAR below the
  // Sheets cap, not just under it: the cap is where the write breaks, this is
  // where we want to notice. ~17 small scalar fields plus the rules text
  // should never approach five figures.
  const SETTINGS_BLOB_CEILING = 20000;

  // Re-label the tuples into ESPN's real response shape. Pure renaming — no
  // field is computed, defaulted, or reconstructed.
  const fixtureTeams = ESPN_TEAMS_FIXTURE_2026_09_04.map(
    ([id, location, name, abbreviation, displayName]) => ({ team: { id, location, name, abbreviation, displayName } }));
  const realEspnResponse = { sports: [{ leagues: [{ teams: fixtureTeams }] }] };

  // ── 16a. SCALE PROOF — the fixture is genuinely production-sized, and the
  //    payload the ORIGINAL code wrote genuinely blows the cell limit. This
  //    is the reproduction, made permanent: if either assertion below ever
  //    goes quiet, every ceiling assertion after it is vacuous.
  assert(ESPN_TEAMS_FIXTURE_2026_09_04.length === 760,
    `fixture check: the fixture is the real 760-team ESPN catalog, not a stub — got ${ESPN_TEAMS_FIXTURE_2026_09_04.length}`);
  const originalShapeWrite = {
    teams: ESPN_TEAMS_FIXTURE_2026_09_04.map(([id, location, name, abbreviation, displayName]) =>
      ({ id, location, name, abbreviation, displayName })),
    fetchedAt: new Date().toISOString(),
  };
  const originalShapeChars = JSON.stringify(originalShapeWrite).length;
  assert(originalShapeChars > GOOGLE_SHEETS_CELL_LIMIT,
    `RG-55 reproduction: the ORIGINAL five-field cache payload is ${originalShapeChars} chars — over Google Sheets' ${GOOGLE_SHEETS_CELL_LIMIT}-char cell cap on its own, before any other settings field (that is the defect this section exists for)`);

  // ── 16b. THE FIX — driving the modal at real scale writes NOTHING resembling
  //    a team catalog into `cfbp_settings`.
  localStorage.clear();
  resetDom();
  app._resetEspnTeamsCacheForTest();
  storage.addPlayer(freshPlayer({ playerId: 'sz1', displayName: 'Size Test', active: true, almaMater: '' }));
  const savedFetch16 = globalThis.fetch;
  let fetchCalls16 = 0;
  globalThis.fetch = async () => { fetchCalls16++; return { ok: true, json: async () => realEspnResponse }; };
  try {
    el('ep-alma');
    el('ep-alma-note');
    await showEditPlayerModal('sz1');
    assert(fetchCalls16 > 0, 'fixture check: the real-scale modal open genuinely fetched (not vacuous)');
    assert(/Abilene Christian Wildcats/.test(el('ep-alma').innerHTML),
      'fixture check: the <select> really was repopulated from the 760-team catalog — the dropdown still works at full scale (not vacuous)');

    // Force an ordinary, unrelated settings write AFTER the modal. This is the
    // real-world hazard in miniature: `saveSetting()` is a read-modify-write of
    // the WHOLE blob, so once an oversized field is in there, every later
    // settings edit — changing the refresh interval, toggling chat — re-writes
    // it. It also guarantees `cfbp_settings` exists, so the measurements below
    // can never pass by measuring nothing.
    storage.saveSetting('autoRefreshInterval', 60);
    const blob = localStorage.getItem('cfbp_settings');
    assert(typeof blob === 'string' && blob.length > 0,
      'fixture check: `cfbp_settings` really was written and really is being measured (not vacuous — a null blob would make every size assertion below trivially true)');
    assert(/adminPasswordHash/.test(blob) && /autoRefreshInterval/.test(blob),
      'fixture check: the measured blob IS the real settings blob — it carries the commissioner password hash, which is precisely what an over-limit write would have truncated');

    assert(blob.length < SETTINGS_BLOB_CEILING,
      `the serialized \`cfbp_settings\` blob is ${blob.length} chars — under the ${SETTINGS_BLOB_CEILING}-char working ceiling (Sheets' hard cap is ${GOOGLE_SHEETS_CELL_LIMIT}); RG-55 measured ${originalShapeChars}+ here`);
    assert(!/espnTeamsCache/.test(blob),
      'no `espnTeamsCache` field exists in the synced settings blob at all — the catalog is not cached through the storage seam');
    assert(!/Abilene Christian/.test(blob) && !/Wildcats/.test(blob),
      'CONTENT check, independent of the field name: not one team string from the ESPN catalog appears anywhere in the settings blob — renaming the field could not dodge this guard');

    // ── 16c. …and the cache STILL CACHES. This is the property §15d bought and
    //    the fix must not spend: a second modal open makes zero fetch calls.
    const callsBeforeReopen = fetchCalls16;
    resetDom();
    let capturedReopen = '';
    document.body.appendChild = ov => { capturedReopen = ov.innerHTML; };
    await showEditPlayerModal('sz1');
    assert(fetchCalls16 === callsBeforeReopen,
      'a SECOND modal open still makes ZERO fetch calls — moving the cache out of the settings blob did not cost the caching');
    assert(/Abilene Christian Wildcats/.test(capturedReopen),
      'fixture check: the second open renders the full 760-team cached list synchronously (not vacuous — proves the cache HIT served real content)');
    const blobAfterReopen = localStorage.getItem('cfbp_settings');
    assert(blobAfterReopen.length < SETTINGS_BLOB_CEILING && !/espnTeamsCache/.test(blobAfterReopen),
      'a cache HIT writes nothing to the settings blob either — the blob is unchanged in size and still carries no catalog');

    // The reset seam itself must be real, or 16b/§15d's "cold cache" premise is
    // unfalsifiable (RG-27: a guard whose seam does nothing reads as protection).
    app._resetEspnTeamsCacheForTest();
    resetDom();
    el('ep-alma'); el('ep-alma-note');
    await showEditPlayerModal('sz1');
    assert(fetchCalls16 > callsBeforeReopen,
      'canary: _resetEspnTeamsCacheForTest() genuinely empties the in-memory cache — after a reset the next modal open DOES fetch again, so "cold cache" preconditions in this file are real, not assumed');
  } finally { globalThis.fetch = savedFetch16; }

  // ── 16d. THE TRIM — fetchEspnTeamsList() returns only what the dropdown
  //    reads. `id`, `name` and `abbreviation` had ZERO readers anywhere in the
  //    app (the sole caller is showEditPlayerModal → buildAlmaMaterOptions,
  //    which reads `location` and `displayName` only; the offline fallback
  //    almaMaterCatalogFallback() has only ever produced those two fields).
  const savedFetch16d = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => realEspnResponse });
  let trimmed;
  try { trimmed = await fetchEspnTeamsList(); } finally { globalThis.fetch = savedFetch16d; }
  assert(trimmed.length === 760, `fixture check: all 760 teams still parse — the trim dropped FIELDS, not teams (got ${trimmed.length})`);
  assert(trimmed.every(t => t.location && t.displayName),
    'fixture check: every returned team still carries the two fields the dropdown actually needs (not vacuous — an all-empty result would satisfy the drop-checks below)');
  const strayFields = new Set();
  for (const t of trimmed) for (const k of Object.keys(t)) if (k !== 'location' && k !== 'displayName') strayFields.add(k);
  assert(strayFields.size === 0,
    `fetchEspnTeamsList() returns { location, displayName } and nothing else — no id/name/abbreviation, which nothing reads (stray: ${[...strayFields].join(', ') || 'none'})`);
  const trimmedChars = JSON.stringify({ teams: trimmed, fetchedAt: new Date().toISOString() }).length;
  assert(trimmedChars < originalShapeChars,
    `fixture check: the trim measurably shrinks the payload — ${originalShapeChars} chars before, ${trimmedChars} after (not vacuous)`);
  // MEASURED, not assumed: trimming ALONE is NOT a fix. 49,720 chars still sits
  // ~280 under the 50,000 cap with the rest of the settings blob unaccounted
  // for. This assertion is here so nobody ever "solves" this by trimming and
  // putting the catalog back in the seam.
  assert(trimmedChars > SETTINGS_BLOB_CEILING,
    `the trimmed payload is STILL ${trimmedChars} chars — trimming alone would NOT have made this safe to sync (Sheets cap ${GOOGLE_SHEETS_CELL_LIMIT}); the fix had to be not storing it in the seam at all`);

  // ── 16e. STRUCTURAL — every settings key app.js/storage.js writes is on a
  //    reviewed allow-list of bounded fields. This is the guard that makes a
  //    FUTURE recurrence impossible rather than merely unlikely: adding any new
  //    `saveSetting('x', …)` fails this test until someone judges x's size.
  const appSrc16 = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const storageSrc16 = await readFile(new URL('./js/storage.js', import.meta.url), 'utf8');
  const BOUNDED_SETTINGS_KEYS = new Set([
    // scalars / small enums
    'dashboardLayout', 'chatRetentionDays', 'autoRefreshInterval', 'randomizePicksEnabled',
    'chatEpochSeq', 'chatEpochSetAt', 'chatEnabled', 'adminPasswordHash', 'sitePin',
    'commissionerEmail', 'welcomeTitleTop', 'welcomeTitleMain', 'welcomeSubtitle',
    // Build 1 (2026-09-10): two booleans — E1 feedback master switch (UN-159),
    // F4-interim inline image previews (UN-164). Tiny scalars, trivially bounded.
    'scribeFeedbackEnabled', 'chatImagePreviewEnabled',
    // Build 2, Group C (2026-09-10, UN-150…154): two more booleans — the
    // client-visible convenience gates for the interactive @SCRIBE runtime.
    // Trivially bounded (same shape as the pair above).
    'scribeInteractiveEnabled', 'scribeWebSearchEnabled',
    // Build 2b, E4 (2026-09-10, UN-162, correction #9): the Trainer-learnings
    // runtime kill switch. Same trivially-bounded boolean shape as the pair
    // above.
    'scribeLearningsEnabled',
    // Build 3, Group D (2026-09-11, correction #9): the frequency dial and
    // the autonomous client gate. SIZE JUDGED, which is what this list is
    // for: `scribeFrequency` is one of five fixed level names (the longest
    // is 'balanced', 8 chars) — it can never grow, because
    // js/scribeLines.js's FREQUENCY_LEVELS is the closed set it is validated
    // against on read, on BOTH sides of the wire. `scribeAutonomousEnabled`
    // is a boolean. Both are listed now, ahead of pass 2's Comm -> Settings
    // dial writing them, deliberately: the guard's purpose is to have the
    // size judgment ON THE RECORD before the field ships, and this list has
    // never required that a listed key already have a call site.
    'scribeFrequency', 'scribeAutonomousEnabled',
    // small maps/arrays, bounded by a fixed real-world count
    'commPanelSectionsCollapsed', 'commPanelSectionsHidden',  // 19 comm-panel sections
    'dashboardColumnOrder',                                    // 6 players
    'ob2025',                                                  // last season's obligation ids
    // commissioner free text — unbounded in principle, human-typed in practice.
    // Flagged to Drew 2026-09-04 as the only remaining unbounded settings
    // writers; neither has a maxlength or a size guard.
    'customRules', 'seasonRecapText',
  ]);
  // Scan EXECUTABLE lines only. A line whose first non-space character is `*`,
  // `//` or `/*` is prose — including this fix's own docstrings, which quote
  // the defective `saveSetting('espnTeamsCache', …)` call verbatim so the next
  // reader knows what happened. Treating that quotation as a live call site
  // would make this guard permanently red for documenting itself, and the
  // pressure would be to loosen it. Both halves of the exclusion are proven by
  // the canaries below: a real call IS caught, a commented one is NOT.
  const scanSettingKeys = (src) => {
    const keys = new Set();
    for (const rawLine of src.split('\n')) {
      const t = rawLine.trimStart();
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) continue;
      for (const m of rawLine.matchAll(/\bsaveSetting\(\s*'([^']+)'/g)) keys.add(m[1]);
    }
    return keys;
  };
  const seenSettingKeys = new Set([...scanSettingKeys(appSrc16), ...scanSettingKeys(storageSrc16)]);
  assert(seenSettingKeys.size >= 15,
    `fixture check: the scan really found the saveSetting() call sites — ${seenSettingKeys.size} distinct keys (a regex that matched nothing would make the allow-list check vacuous)`);
  const unreviewed = [...seenSettingKeys].filter(k => !BOUNDED_SETTINGS_KEYS.has(k));
  assert(unreviewed.length === 0,
    `every settings key written by app.js/storage.js is on the reviewed bounded-size allow-list — a new one must be size-judged before it ships (unreviewed: ${unreviewed.join(', ') || 'none'})`);
  assert(!seenSettingKeys.has('espnTeamsCache'),
    'RG-55, named directly: `espnTeamsCache` is not written through saveSetting() anywhere');
  // Canary 1 — prove the scan WOULD have caught the shipped defect (RG-27: a
  // structural scan that cannot fail is not a guard). This is the exact line
  // from the original build, byte for byte.
  const canaryLive = scanSettingKeys(`        saveSetting('espnTeamsCache', { teams: fresh, fetchedAt: new Date().toISOString() });`);
  assert(canaryLive.has('espnTeamsCache') && !BOUNDED_SETTINGS_KEYS.has('espnTeamsCache'),
    'canary: run against the exact defective line from the original build, this same scan DOES flag it — the guard is capable of failing');
  // Canary 2 — prove the comment exclusion is doing exactly one job and not
  // quietly blinding the scan. Same key, same file, only the prose marker
  // differs; also prove the exclusion does not swallow a real call that merely
  // happens to sit on a line containing a `//`-bearing URL.
  assert(scanSettingKeys(` * originally cached with \`saveSetting('espnTeamsCache', …)\``).size === 0,
    'canary: a saveSetting() mentioned inside a JSDoc line is correctly NOT counted as a call site — the exclusion is narrow and deliberate');
  assert(scanSettingKeys(`  saveSetting('customRules', x); // see https://example.com/docs`).has('customRules'),
    'canary: the exclusion is NOT overbroad — a real call on a line that also carries a // URL comment is still counted');

  // ── 16f. THE FALLBACK, at scale — ESPN unreachable must still let the
  //    commissioner save a player, with the existing claim preserved as an
  //    option, and must write nothing to the settings blob on the failure path.
  localStorage.clear();
  resetDom();
  app._resetEspnTeamsCacheForTest();
  storage.saveSetting('autoRefreshInterval', 60);   // establish a real blob to compare against
  const blobBeforeFailure = localStorage.getItem('cfbp_settings');
  storage.addPlayer(freshPlayer({ playerId: 'sz2', displayName: 'Offline Test', active: true, almaMater: 'Clemson' }));
  const savedFetch16f = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ESPN unreachable'); };
  let capturedOffline = '';
  try {
    document.body.appendChild = ov => { capturedOffline = ov.innerHTML; };
    el('toast-container');
    el('ep-name').value = 'Offline Test';
    el('ep-email').value = '';
    el('ep-alma').value = 'Clemson';
    el('ep-save'); el('ep-c'); el('ep-alma-note');
    await showEditPlayerModal('sz2');
    el('ep-save')._fire('click');
  } finally { globalThis.fetch = savedFetch16f; }
  assert(storage.getPlayer('sz2').almaMater === 'Clemson',
    'ESPN unreachable: the commissioner can still save the player, and the existing claim survives (a fetch failure never blocks Save)');
  assert(/<option value="Clemson" selected>/.test(capturedOffline),
    'fixture check: the current claim is preserved as a pre-selected option on the offline fallback list (not vacuous — proves the fallback render really happened)');
  assert(localStorage.getItem('cfbp_settings') === blobBeforeFailure,
    'the ESPN-failure path writes nothing at all to the settings blob — byte-identical before and after');
}
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[17] BUG-1 — Alma Mater Watch / Rankings sort by CURRENT AP rank…');
{
  // BUG-1 (fb_1788538501410_9egx9, filed 2026-09-04 against v0.17.8). Drew,
  // verbatim: "Under alma mater watch, the order should be in order of the
  // ranking. For example, right now TAMU is 8 and Oklahoma is 10, so TAMU
  // should be first. If the rankings change halfway through the season, the
  // order should adjust accordingly."
  //
  // Before the fix BOTH renderers iterated claimedAlmaMaters() — i.e. active
  // PLAYER-ROSTER order — and never sorted at all, so the displayed order was
  // an artifact of who joined the league in what order.
  //
  // Coordinator's ruling (no prior spec existed): ranked schools first
  // ascending by rank, then unranked, then BYE; ties inside a tier keep
  // claimedAlmaMaters() order. Applied to Rankings too so the two surfaces
  // agree (coordinator-directed consistency extension).
  //
  // FIXTURE DISCIPLINE #2 — nothing below is built in the order it is
  // asserted back out. Roster insertion order is deliberately close to the
  // REVERSE of the expected render order, and the two BYE schools are
  // inserted so that roster order alone would put the rank-5 one ahead of the
  // rank-3 one.
  localStorage.clear();
  storage.saveWeek(freshWeek({ weekId: 'ord_w' }));
  storage.saveWeek(freshWeek({ weekId: 'ord_w0', weekNumber: 0, label: 'Week 0' }));

  // This week's slate. Opponents are chosen to share no word with any claimed
  // school, so getAlmaMaterMatch() can't attribute a row to the wrong side.
  storage.saveGame(freshGame({ weekId: 'ord_w', gameId: 'ord_usc',  homeTeam: 'Vanderbilt', awayTeam: 'USC',        awayRank: null }));
  storage.saveGame(freshGame({ weekId: 'ord_w', gameId: 'ord_ok',   homeTeam: 'Oklahoma',   awayTeam: 'Baylor',     homeRank: 10 }));
  storage.saveGame(freshGame({ weekId: 'ord_w', gameId: 'ord_bama', homeTeam: 'Alabama',    awayTeam: 'Mercer',     homeRank: 1 }));
  storage.saveGame(freshGame({ weekId: 'ord_w', gameId: 'ord_ark',  homeTeam: 'Arkansas',   awayTeam: 'Tulane',     homeRank: null }));
  storage.saveGame(freshGame({ weekId: 'ord_w', gameId: 'ord_tamu', homeTeam: 'Rutgers',    awayTeam: 'Texas A&M',  awayRank: 8 }));
  // LAST-KNOWN ranks for the two BYE schools — a prior week only. These are
  // saved AFTER the slate above precisely so the reverse-find that resolves
  // "most recent game" reaches them (and so this fixture isn't built in
  // assertion order).
  storage.saveGame(freshGame({ weekId: 'ord_w0', gameId: 'ord_clem', homeTeam: 'Clemson',  awayTeam: 'Furman',  homeRank: 5 }));
  storage.saveGame(freshGame({ weekId: 'ord_w0', gameId: 'ord_mich', homeTeam: 'Michigan', awayTeam: 'Bowling Green', homeRank: 3 }));

  // Roster order — NOT rank order. Rice (no game anywhere, ever) is FIRST.
  storage.addPlayer(freshPlayer({ playerId: 'ord_p1', displayName: 'RiceGuy',  almaMater: 'Rice',       active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'ord_p2', displayName: 'Drew',     almaMater: 'Oklahoma',   active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'ord_p3', displayName: 'Koby',     almaMater: 'USC',        active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'ord_p4', displayName: 'Kihoon',   almaMater: 'Texas A&M',  active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'ord_p5', displayName: 'ClemGuy',  almaMater: 'Clemson',    active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'ord_p6', displayName: 'BamaGuy',  almaMater: 'Alabama',    active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'ord_p7', displayName: 'MichGuy',  almaMater: 'Michigan',   active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'ord_p8', displayName: 'Jacob',    almaMater: 'Arkansas',   active: true }));

  const rosterOrder = claimedAlmaMaters();
  assert(JSON.stringify(rosterOrder) === JSON.stringify(['Rice', 'Oklahoma', 'USC', 'Texas A&M', 'Clemson', 'Alabama', 'Michigan', 'Arkansas']),
    `fixture check: claimedAlmaMaters() hands the renderers PLAYER-ROSTER order, which is not rank order (got ${JSON.stringify(rosterOrder)})`);

  const watchHtml = renderAlmaMaterWatch('ord_w');
  const watchTeams = [...watchHtml.matchAll(/<span class="alma-watch-team">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert(watchTeams.length === 8, `fixture check: Watch rendered all eight claimed schools (not vacuous — got ${watchTeams.length})`);

  // [17a] THE REPORTED BUG, in Drew's own example: TAMU is 8, Oklahoma is 10,
  // so TAMU must come first. Roster order puts Oklahoma first.
  assert(watchTeams.indexOf('#8 Texas A&amp;M') < watchTeams.indexOf('#10 Oklahoma'),
    '[17a] BUG-1: Alma Mater Watch lists #8 Texas A&M BEFORE #10 Oklahoma, even though Oklahoma\'s claimant sits earlier in the player roster');

  // [17b] Full ordering — ranked ascending, then unranked (roster order
  // inside the tier), then BYE (last known rank ascending inside the tier,
  // then no-known-rank).
  const expectedWatch = ['#1 Alabama', '#8 Texas A&amp;M', '#10 Oklahoma', 'USC', 'Arkansas', 'Michigan', 'Clemson', 'Rice'];
  assert(JSON.stringify(watchTeams) === JSON.stringify(expectedWatch),
    `[17b] BUG-1: Watch order is ranked-ascending → unranked → BYE (got ${JSON.stringify(watchTeams)})`);

  // [17c] Stability inside the unranked tier: USC and Arkansas are both
  // unranked and both playing; the roster order between them is preserved.
  assert(watchTeams.indexOf('USC') < watchTeams.indexOf('Arkansas'),
    '[17c] within a tier the existing claimedAlmaMaters() order is preserved — USC (roster #3) still precedes Arkansas (roster #8)');

  // [17d] A BYE school never jumps a school that is actually playing, even
  // when its last known rank is better: Michigan was #3 last week but is on
  // BYE, so it sits below UNRANKED-but-playing Arkansas.
  assert(watchTeams.indexOf('Arkansas') < watchTeams.indexOf('Michigan'),
    '[17d] a BYE school does not outrank a school that is actually playing — #3-last-week Michigan sorts below unranked-but-playing Arkansas');

  // [17e] Inside the BYE tier, last-known rank still orders the rows, and a
  // BYE school with no known rank anywhere goes last.
  assert(watchTeams.indexOf('Michigan') < watchTeams.indexOf('Clemson') && watchTeams.indexOf('Clemson') < watchTeams.indexOf('Rice'),
    '[17e] inside the BYE tier: last-known #3 Michigan, then last-known #5 Clemson, then Rice (never ranked anywhere) last');
  assert(watchHtml.includes('alma-watch-bye'), 'fixture check: the BYE rows are genuinely BYE rows (not vacuous)');

  // [17f] Coordinator-directed consistency extension — the SAME ordering on
  // the Standings page's Alma Mater Rankings. Rankings is season-wide and has
  // no slate, so it has no BYE tier: every school resolves a rank from its
  // most recent game across getGames() (which is why Michigan/Clemson land in
  // the RANKED tier here and in the BYE tier on Watch).
  const rankHtml = renderAlmaMaterRankings();
  const rankSchools = [...rankHtml.matchAll(/<span class="alma-rank-school">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert(rankSchools.length === 8, `fixture check: Rankings rendered all eight claimed schools (not vacuous — got ${rankSchools.length})`);
  assert(rankSchools.indexOf('Texas A&amp;M (Aggies)') < rankSchools.indexOf('Oklahoma (Sooners)'),
    '[17f] BUG-1: Alma Mater Rankings puts #8 Texas A&M before #10 Oklahoma too — the two surfaces agree');
  const expectedRank = ['Alabama', 'Michigan', 'Clemson', 'Texas A&amp;M (Aggies)', 'Oklahoma (Sooners)', 'Rice', 'USC (Trojans)', 'Arkansas (Razorbacks)'];
  assert(JSON.stringify(rankSchools) === JSON.stringify(expectedRank),
    `[17g] Rankings order is ranked-ascending then unranked-in-roster-order (got ${JSON.stringify(rankSchools)})`);

  // [17h] "If the rankings change halfway through the season, the order
  // should adjust accordingly" — flip the two ranks in the game data ONLY
  // (no roster change, no re-render trick) and the order must invert. This is
  // the assertion that proves the order is derived at render time and not
  // cached anywhere.
  const okGame = storage.getGame('ord_ok');
  const tamuGame = storage.getGame('ord_tamu');
  storage.saveGame({ ...okGame, homeRank: 2 });
  storage.saveGame({ ...tamuGame, awayRank: 14 });
  const watchTeams2 = [...renderAlmaMaterWatch('ord_w').matchAll(/<span class="alma-watch-team">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  const expectedWatch2 = ['#1 Alabama', '#2 Oklahoma', '#14 Texas A&amp;M', 'USC', 'Arkansas', 'Michigan', 'Clemson', 'Rice'];
  assert(JSON.stringify(watchTeams2) === JSON.stringify(expectedWatch2),
    `[17h] BUG-1: when the AP ranks change mid-season, the Watch order adjusts on the next render with no roster change — Oklahoma at #2 now precedes Texas A&M at #14 (got ${JSON.stringify(watchTeams2)})`);
  const rankSchools2 = [...renderAlmaMaterRankings().matchAll(/<span class="alma-rank-school">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  const expectedRank2 = ['Alabama', 'Oklahoma (Sooners)', 'Michigan', 'Clemson', 'Texas A&amp;M (Aggies)', 'Rice', 'USC (Trojans)', 'Arkansas (Razorbacks)'];
  assert(JSON.stringify(rankSchools2) === JSON.stringify(expectedRank2),
    `[17i] the Rankings order adjusts to the same rank change, on the same render pass (got ${JSON.stringify(rankSchools2)})`);

  // [17j] No cached display ordering exists anywhere — week.lockedAlmaMaters
  // is the tiebreaker Auto-Calc's frozen roster (AD-34 / F4) and must never
  // be read for display order. Source-text guard.
  //
  // Reviewer note 2 (2026-09-12): both windows used to be fixed-length slices
  // (4000 / 2500 chars) from the declaration. renderAlmaMaterWatch()'s body is
  // longer than 4000 chars, so a read inserted at its TAIL escaped the window
  // entirely and this guard passed against its own mutation. Brace-matched
  // now, with the "did the window reach the closing brace" check asserted
  // rather than assumed.
  const appSrcOrd = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
  const lockedReads = [...appSrcOrd.matchAll(/lockedAlmaMaters/g)].length;
  assert(lockedReads > 0, 'fixture check: lockedAlmaMaters IS referenced in app.js (not a vacuous scan)');
  const watchFnSrc = fnBodySrc(appSrcOrd, 'export function renderAlmaMaterWatch');
  const rankFnSrc  = fnBodySrc(appSrcOrd, 'export function renderAlmaMaterRankings');
  assert(watchFnSrc.trimEnd().endsWith('}') && watchFnSrc.includes('⭐ Alma Mater Watch'),
    "fixture check: the Watch window is brace-matched all the way to the function's closing } and contains its final return — a window that stops short is a silent hole");
  assert(rankFnSrc.trimEnd().endsWith('}') && rankFnSrc.includes('alma-rank-value'),
    "fixture check: the Rankings window reaches its closing } and contains its final return");
  assert(watchFnSrc.length > 4000,
    `fixture check: renderAlmaMaterWatch()'s body is ${watchFnSrc.length} chars — longer than the 4000-char slice this guard used to take, which is exactly how a tail insertion escaped it`);
  assert(!watchFnSrc.includes('lockedAlmaMaters') && !rankFnSrc.includes('lockedAlmaMaters'),
    '[17j] neither renderer reads week.lockedAlmaMaters — the AD-34 lock snapshot drives the tiebreaker Auto-Calc only, never display order');

  // [17k] The pure comparator itself, tested directly (the seasonStandingsRows()
  // pattern: factor the logic out, export it, test it without the renderer).
  if (typeof app.sortAlmaMaterEntries !== 'function') {
    assert(false, '[17k] app.js exports a pure sortAlmaMaterEntries() helper both renderers share');
  } else {
    const { sortAlmaMaterEntries } = app;
    assert(JSON.stringify(sortAlmaMaterEntries([])) === '[]', '[17k] sortAlmaMaterEntries([]) is []');
    const input = [
      { alma: 'D', rank: null, onBye: true },
      { alma: 'B', rank: 10, onBye: false },
      { alma: 'C', rank: null, onBye: false },
      { alma: 'A', rank: 1, onBye: false },
      { alma: 'E', rank: 4, onBye: true },
    ];
    const snapshot = JSON.stringify(input);
    const sorted = sortAlmaMaterEntries(input);
    assert(sorted.map(e => e.alma).join('') === 'ABCED', `[17l] sortAlmaMaterEntries orders ranked → unranked → BYE(by last rank) (got ${sorted.map(e => e.alma).join('')})`);
    assert(JSON.stringify(input) === snapshot, '[17m] sortAlmaMaterEntries does NOT mutate the array it was handed (returns a new one)');
    const allTied = [{ alma: 'x1', rank: null }, { alma: 'x2', rank: null }, { alma: 'x3', rank: null }];
    assert(sortAlmaMaterEntries(allTied).map(e => e.alma).join('') === 'x1x2x3', '[17n] an all-unranked list comes back in exactly the order it went in (stable)');
    assert(sortAlmaMaterEntries([{ alma: 'z', rank: 3 }, { alma: 'y', rank: 3 }]).map(e => e.alma).join('') === 'zy', '[17o] two schools sharing the SAME rank keep roster order between them');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[18] BUG-6 — Alma Mater Rankings lists EVERY claimant, not just the first…');
{
  // BUG-6 (fb_1788651890158_fva84, filed 2026-09-05 against v0.17.10). Drew,
  // verbatim: "In the alma mater rankings it only lists drew by tamu and not
  // kihoon. If there are too people with the same alma mater, both should be
  // listed"
  //
  // renderAlmaMaterRankings() resolved its byline with
  // `getPlayers().find(p => p.active && …)` — .find() structurally returns at
  // most ONE player, so a school claimed by two people could only ever name
  // one of them. The Settings-tab card's claimantsOf() (a .filter()) already
  // had this right; the F5 note requires all three predicates to agree.
  localStorage.clear();
  storage.saveWeek(freshWeek({ weekId: 'dual_w' }));
  storage.saveGame(freshGame({ weekId: 'dual_w', gameId: 'dual_g1', homeTeam: 'Texas A&M', awayTeam: 'Auburn', homeRank: 8 }));

  // Roster order: Drew, then an INACTIVE Aggie, then Kihoon, then a
  // whitespace/case-variant Aggie. Only the three ACTIVE ones may appear, in
  // roster order.
  storage.addPlayer(freshPlayer({ playerId: 'du_p1', displayName: 'Drew',       almaMater: 'Texas A&M',   active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'du_p2', displayName: 'GhostAggie', almaMater: 'Texas A&M',   active: false }));
  storage.addPlayer(freshPlayer({ playerId: 'du_p3', displayName: 'Kihoon',     almaMater: 'Texas A&M',   active: true }));

  const bylineOf = html => {
    const m = [...html.matchAll(/<span class="alma-rank-player[^"]*">([\s\S]*?)<\/span>/g)].map(x => x[1]);
    return m;
  };

  const html1 = bylineOf(renderAlmaMaterRankings());
  assert(html1.length === 1, `fixture check: exactly one Texas A&M row exists — two claimants do NOT double the row (got ${html1.length})`);
  // [18a] THE REPORTED BUG, in Drew's own words.
  assert(html1[0] === 'Drew, Kihoon',
    `[18a] BUG-6: the Texas A&M row names BOTH active claimants, in roster order, joined with ", " (got "${html1[0]}")`);
  // [18b] The active-only rule from F5 still holds — a deactivated claimant
  // must not be swept in by the change from .find() to .filter().
  assert(!renderAlmaMaterRankings().includes('GhostAggie'),
    '[18b] the DEACTIVATED Texas A&M claimant is still excluded — listing "both" means both ACTIVE claimants, not everyone who ever claimed it');

  // [18c] A third claimant, stored with different casing AND surrounding
  // whitespace, is also listed (F5's normalisation survives the fix) and
  // lands in roster order, last.
  storage.addPlayer(freshPlayer({ playerId: 'du_p4', displayName: 'CaseAggie', almaMater: '  texas a&m  ', active: true }));
  assert(claimedAlmaMaters().length === 1, 'fixture check: the case/whitespace variant did not create a SECOND roster entry (not vacuous)');
  assert(bylineOf(renderAlmaMaterRankings())[0] === 'Drew, Kihoon, CaseAggie',
    '[18c] a claimant stored with different casing and surrounding whitespace is listed too, in roster order');

  // [18d] The byline is escHtml'd per name, not concatenated raw.
  storage.addPlayer(freshPlayer({ playerId: 'du_p5', displayName: '<img src=x onerror=alert(1)>', almaMater: 'Texas A&M', active: true }));
  const hostileHtml = renderAlmaMaterRankings();
  assert(!hostileHtml.includes('<img src=x onerror=alert(1)>') && hostileHtml.includes('&lt;img'),
    '[18d] each claimant name is escHtml-encoded individually — a hostile display name is rendered safely, not dropped and not executable');

  // [18e] UN-74/DI-74 flex-layout rule — the .alma-rank-player span is
  // ALWAYS emitted, even with nothing in it.
  localStorage.clear();
  storage.saveWeek(freshWeek({ weekId: 'dual_w2' }));
  storage.saveGame(freshGame({ weekId: 'dual_w2', gameId: 'dual_g2', homeTeam: 'Clemson', awayTeam: 'Furman', homeRank: 7 }));
  storage.addPlayer(freshPlayer({ playerId: 'du_p6', displayName: 'SoloClaimant', almaMater: 'Clemson', active: true }));
  const soloHtml = renderAlmaMaterRankings();
  assert((soloHtml.match(/alma-rank-player/g) || []).length === 1,
    '[18e] the .alma-rank-player span is emitted on every row (UN-74/DI-74 flex layout) — single claimant');
  assert(bylineOf(soloHtml)[0] === 'SoloClaimant', 'fixture check: the single-claimant case still renders exactly one name (the fix does not overcorrect)');

  // [18f] renderAlmaMaterWatch has NO claimant assumption to fix — it renders
  // school / matchup / time only and never names a player. Asserted so a
  // future edit can't quietly add a single-claimant byline there.
  const watchDual = renderAlmaMaterWatch('dual_w2');
  assert(watchDual.includes('Clemson') && !watchDual.includes('SoloClaimant'),
    '[18f] renderAlmaMaterWatch names no players at all — it had no single-claimant bug to fix, and must not grow one');
  assert(!watchDual.includes('alma-rank-player'), '[18f] …and emits no claimant span either');

  // [18g] The three predicates still agree (the F5 invariant). The Settings
  // card and Rankings must name the same people for the same school.
  localStorage.clear();
  storage.saveWeek(freshWeek({ weekId: 'dual_w3' }));
  storage.saveGame(freshGame({ weekId: 'dual_w3', gameId: 'dual_g3', homeTeam: 'Texas A&M', awayTeam: 'Auburn', homeRank: 8 }));
  storage.addPlayer(freshPlayer({ playerId: 'du_q1', displayName: 'Drew',   almaMater: 'Texas A&M', active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'du_q2', displayName: 'Kihoon', almaMater: 'Texas A&M', active: true }));
  const cardHtml = renderAlmaMaterSettingsCard();
  assert(cardHtml.includes('Drew, Kihoon'), 'fixture check: the Settings-tab card already listed both claimants (not vacuous — it is the reference behavior)');
  assert(bylineOf(renderAlmaMaterRankings())[0] === 'Drew, Kihoon',
    '[18g] Rankings and the Settings-tab card now name the same claimants, in the same order, from the same predicate');

  // [18h] One shared predicate, not a third copy — the exported helper.
  if (typeof app.almaMaterClaimants !== 'function') {
    assert(false, '[18h] app.js exports a shared almaMaterClaimants() predicate that Rankings and the Settings card both call');
  } else {
    const { almaMaterClaimants } = app;
    assert(almaMaterClaimants('Texas A&M').map(p => p.displayName).join(', ') === 'Drew, Kihoon',
      '[18h] almaMaterClaimants() returns EVERY active claimant in roster order');
    assert(almaMaterClaimants('  TEXAS A&M  ').map(p => p.displayName).join(', ') === 'Drew, Kihoon',
      '[18i] almaMaterClaimants() normalises case and whitespace the same way claimedAlmaMaters() does');
    assert(almaMaterClaimants('Nobody State').length === 0, '[18j] almaMaterClaimants() returns [] for a school nobody claims — never undefined, never a throw');
    assert(almaMaterClaimants('').length === 0 && almaMaterClaimants(null).length === 0, '[18k] almaMaterClaimants() handles empty/null defensively (CONVENTIONS #7)');
    const appSrcDual = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
    // Comments are stripped before the scan — the fix's own docstring quotes
    // the OLD `getPlayers().find(...)` shape by name, and a guard that can be
    // tripped by prose describing the bug is not a guard on the code.
    const rankBody = appSrcDual
      .slice(appSrcDual.indexOf('export function renderAlmaMaterRankings'), appSrcDual.indexOf('export function renderAlmaMaterSettingsCard'))
      .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    assert(rankBody.includes('almaMaterClaimants('), 'fixture check: the comment-stripped scan window still holds real code (not vacuous)');
    assert(!/getPlayers\(\)\.find\(/.test(rankBody),
      '[18l] renderAlmaMaterRankings() no longer contains a getPlayers().find() claimant lookup — the single-claimant shape is structurally gone, not merely worked around');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[19] Demo games must never feed an alma-mater rank lookup…');
{
  // Reviewer note 1 on the BUG-1/BUG-6 APPROVE-WITH-NOTES (2026-09-12).
  // renderAlmaMaterRankings()'s reverse-find over getGames() and
  // renderAlmaMaterWatch()'s BYE "last known rank" fallback both read EVERY
  // game in storage with no `dataSourceMode !== 'demo'` filter — unlike the
  // five other consumers that already have one (seasonStandingsRows,
  // renderLeaderboard's visible-week set, the weekly-history week list,
  // currentSeasonObligations, the demo-obligation purge). resetToDemo()
  // writes GAMES as [...REAL_WEEK_1_2026_KNOWN_GAMES, ...DEMO_GAMES], so the
  // fictional demo slate is at the END of the array and the reverse-find hits
  // it FIRST: the reviewer saw "#7 AP" for Notre Dame and "#8 AP" for Texas
  // A&M on the Standings page, numbers that exist nowhere but the fixture.
  localStorage.clear();

  // A REAL week: Texas A&M plays and is genuinely unranked; Clemson is #12.
  storage.saveWeek(freshWeek({ weekId: 'dm_real', dataSourceMode: 'espn_live' }));
  storage.saveGame(freshGame({ weekId: 'dm_real', gameId: 'dm_real_tamu', homeTeam: 'Texas A&M', awayTeam: 'Auburn',  homeRank: null }));
  storage.saveGame(freshGame({ weekId: 'dm_real', gameId: 'dm_real_clem', homeTeam: 'Clemson',   awayTeam: 'Furman',  homeRank: 12 }));

  // The SHIPPED demo fixture, saved AFTER the real week — the exact order
  // resetToDemo() produces, which is what makes the reverse-find reach it.
  storage.saveWeek(dm.DEMO_WEEK);
  dm.DEMO_GAMES.forEach(g => storage.saveGame(g));

  storage.addPlayer(freshPlayer({ playerId: 'dm_p1', displayName: 'Drew',    almaMater: 'Texas A&M', active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'dm_p2', displayName: 'KobyC',   almaMater: 'Clemson',   active: true }));
  storage.addPlayer(freshPlayer({ playerId: 'dm_p3', displayName: 'NDGuy',   almaMater: 'Notre Dame', active: true }));
  // Purdue: really #20 in the real week, and present in the demo fixture with
  // NO rank — so the unfiltered lookup does the opposite damage here, erasing
  // a real rank instead of inventing one. Same root cause, both directions.
  storage.saveGame(freshGame({ weekId: 'dm_real', gameId: 'dm_real_pur', homeTeam: 'Purdue', awayTeam: 'Ball State', homeRank: 20 }));
  storage.addPlayer(freshPlayer({ playerId: 'dm_p4', displayName: 'PurdueGuy', almaMater: 'Purdue', active: true }));

  const allIds = storage.getGames().map(g => g.gameId);
  assert(allIds.indexOf('dg2') > allIds.indexOf('dm_real_tamu'),
    'fixture check: the demo Texas A&M game sits AFTER the real one in storage, so an unfiltered reverse-find would reach the demo game first (not a vacuous test)');
  assert(dm.DEMO_GAMES.some(g => g.homeTeam === 'Texas A&M' && g.homeRank === 8) && dm.DEMO_GAMES.some(g => g.awayTeam === 'Notre Dame' && g.awayRank === 7),
    'fixture check: the shipped DEMO_GAMES really do carry the fictional #8 Texas A&M / #7 Notre Dame ranks the reviewer saw');

  const rankHtml = renderAlmaMaterRankings();
  const rowOf = school => {
    const rows = rankHtml.split('<div class="alma-rank-row">').slice(1);
    return rows.find(r => r.includes(school)) || '';
  };

  // ── THE REVIEWER'S REPRODUCTION ──
  assert(!rowOf('Texas A&amp;M').includes('#8 AP'),
    '[19a] Rankings: the fictional demo-fixture rank (#8 Texas A&M) never becomes a badge on the Standings page');
  assert(rowOf('Texas A&amp;M').includes('Unranked'),
    '[19b] …the school falls back to its REAL most-recent game, where it is unranked');
  assert(!rowOf('Notre Dame').includes('#7 AP') && rowOf('Notre Dame').includes('Unranked'),
    '[19c] Rankings: Notre Dame — whose only game anywhere is the demo fixture — shows Unranked, not #7 AP');
  assert(rowOf('Clemson').includes('#12 AP'),
    '[19d] positive control: a rank from a genuinely non-demo week still renders — the filter did not overcorrect into hiding real ranks');

  const rankSchools = [...rankHtml.matchAll(/<span class="alma-rank-school">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert(rankSchools.indexOf('Clemson') === 0,
    `[19e] …and ORDER is unaffected by demo data: really-#12 Clemson leads, ahead of the two schools a demo rank would have promoted (got ${JSON.stringify(rankSchools)})`);

  // ── Watch's BYE "last known rank" fallback, same lookup, same exclusion ──
  // A current slate with neither Texas A&M nor Notre Dame on it, so both are
  // BYE rows and both hit the fallback. Clemson plays, and is unranked on this
  // slate, so a BYE school promoted by a demo rank would jump it.
  storage.saveWeek(freshWeek({ weekId: 'dm_bye', weekNumber: 2, dataSourceMode: 'espn_live' }));
  storage.saveGame(freshGame({ weekId: 'dm_bye', gameId: 'dm_bye_clem', homeTeam: 'Clemson', awayTeam: 'Wofford', homeRank: null }));
  const watchHtml = renderAlmaMaterWatch('dm_bye');
  const watchTeams = [...watchHtml.matchAll(/<span class="alma-watch-team">([\s\S]*?)<\/span>/g)].map(m => m[1]);
  assert(watchTeams.length === 4 && (watchHtml.match(/alma-watch-bye/g) || []).length === 3,
    `fixture check: Watch rendered all four schools with three genuine BYE rows (got ${JSON.stringify(watchTeams)})`);
  // The BYE tier is ordered by LAST KNOWN rank, so a demo rank is visible here
  // as ORDER even though a BYE row prints no rank prefix. With the demo games
  // in the lookup the order is Notre Dame (#7, fictional) → Texas A&M (#8,
  // fictional) → Purdue (real #20 erased by a rankless demo game).
  assert(JSON.stringify(watchTeams) === JSON.stringify(['Clemson', 'Purdue', 'Texas A&amp;M', 'Notre Dame']),
    `[19f] Watch: the BYE "last known rank" fallback skips demo weeks — really-#20 Purdue leads the BYE tier and the two schools ranked only by the demo fixture fall to the no-known-rank end, in roster order (got ${JSON.stringify(watchTeams)})`);
  assert(watchTeams[0] === 'Clemson',
    `[19g] …and a school actually playing still outranks every BYE row (got ${JSON.stringify(watchTeams)})`);

  // ── The historical demo week (dataSourceMode: 'demo' too) is excluded by the
  //    same week-id set — one rule, not two hand-kept lists. ──
  storage.saveWeek(dm.HISTORICAL_DEMO_WEEK);
  storage.saveGame({ ...dm.HISTORICAL_DEMO_GAMES[1], homeRank: 3 });   // Texas A&M, rank forced ON for this probe
  assert(!renderAlmaMaterRankings().includes('#3 AP'),
    '[19h] a rank on the HISTORICAL demo week (loaded via 📅 Load Historical Demo Week) is excluded by the same dataSourceMode==="demo" rule');

  // ── One shared lookup, so the two surfaces cannot drift apart again. ──
  {
    const appSrcDemo = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
    const codeOf = body => body.split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*')).join('\n');
    const watchBody = codeOf(fnBodySrc(appSrcDemo, 'export function renderAlmaMaterWatch'));
    const rankBody  = codeOf(fnBodySrc(appSrcDemo, 'export function renderAlmaMaterRankings'));
    assert(watchBody.includes('almaMaterRankLookupGames(') && rankBody.includes('almaMaterRankLookupGames('),
      '[19i] both renderers resolve ranks through the SAME shared lookup helper — the filter cannot be fixed on one surface and forgotten on the other');
    assert(!/getGames\(/.test(rankBody),
      '[19j] renderAlmaMaterRankings() no longer reads getGames() directly at all — there is no unfiltered snapshot left for a demo game to enter through');
    // Reviewer note 3: the comment promised the reversed copy was built once
    // per render, but `[...allGamesForBye].reverse()` ran once per BYE school.
    assert(!/\[\.\.\.allGamesForBye\]\.reverse\(\)/.test(watchBody),
      '[19k] the per-BYE-school `[...allGamesForBye].reverse()` copy is gone — the reversed list really is built once per render, as the comment always claimed');
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, ${fail} failed`);
else { console.log(`❌ ${pass} passed, ${fail} failed`); process.exitCode = 1; }
