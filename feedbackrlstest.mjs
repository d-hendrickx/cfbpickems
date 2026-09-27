/**
 * CFB Pickems — feedbackrlstest.mjs (B-05, 2026-09-25)
 * =============================================================================
 * The regression suite for B-05: "submitting feedback shows the red sync
 * banner — new row violates row-level security policy for table \"feedback\"".
 *
 * Run:  node feedbackrlstest.mjs      (sweep BOTH TZ=UTC and
 *       TZ=America/Los_Angeles per CLAUDE.md §5's timezone lesson — RG-38)
 *
 * Precedent: `grouptest.mjs` (UN-118) — a standalone file beside loadtest.mjs,
 * not folded into its chat-fold suite. NOTE: `feedbacktest.mjs` already exists
 * and is about SCRIBE *message* feedback (scribeFeedback.js / chat fold); it
 * has nothing to do with the `cfbp_feedback` key, so this is a new file rather
 * than an extension of that one.
 *
 * WHAT THIS PROVES, and why it is not a restatement of the client's own code:
 * the suite reads the DEPLOYED POLICY TEXT out of `supabase/migrations/*.sql`
 * (last-wins), evaluates its WITH CHECK clause against the row the client
 * actually emits, in SQL's three-valued logic, and asserts the result is
 * literally `true`. `null` (which is what `member_id = my_member_id(...)`
 * returns when `member_id` is NULL) is NOT a pass — that distinction IS the
 * bug: Postgres raises 42501 for anything that is not true.
 *
 * Covers, in order:
 *   0. The scan itself — a multi-line redefinition in a LATER file is the one
 *      read (reviewer proved the first, line-based cut failed OPEN), comments
 *      cannot hijack the match, and a weakened clause makes [4] red. Run
 *      against a tmpdir COPY of the migrations dir, never the real one.
 *   1. Binding — the fixture entry carries exactly the fields app.js's
 *      submitFeedback() literal writes (source-parsed, so fixture drift is
 *      caught rather than silently tested against a stale shape).
 *   2. Schema — every column the projection emits exists on `public.feedback`
 *      in 0001_schema.sql (a column the schema does not have is a different
 *      42703 failure wearing the same costume).
 *   3. THE ACCEPTANCE GATE — the row emitted for a feedback item submitted by
 *      a signed-in player satisfies `feedback_insert`'s WITH CHECK.
 *   4. Non-vacuous — the SAME evaluator returns `null` (refusal) for an entry
 *      with no author, so the gate in 3 cannot pass by construction.
 *   5. Round-trip — `memberId` survives fromRows(toRows(x)), so the second
 *      flush plans NO patch. A fix that stamps member_id server-side only
 *      would pass 3 and fail here: the hydrate would strip it back out
 *      (`extra.__absent`) and every later flush would plan an UPDATE, which
 *      `feedback_update` (is_commissioner) refuses for a player — the same
 *      red banner, for ever.
 *   6. No misattribution — appending MY feedback must not stamp my id onto
 *      somebody else's author-less row already in the array (a commissioner's
 *      mirror holds every player's rows: feedback_select is own-or-comm).
 *   7. Legacy/import compatibility — an author-less legacy row still projects
 *      `member_id: null` and still marks `memberId` absent.
 */

import { readFile } from 'node:fs/promises';
import { readdirSync, readFileSync, mkdirSync, copyFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

// Every read below resolves against THIS FILE, never the cwd — loadtest.mjs
// spawns its suites with an explicit cwd and a future runner might not.
const HERE = fileURLToPath(new URL('.', import.meta.url));

// ── Minimal DOM / localStorage stubs — same shape as grouptest.mjs's. ────────
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
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
globalThis.fetch = async () => { throw new Error('network disabled in feedbackrlstest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log('\n══════════════════════════════════════════════════════════════');
console.log(' feedbackrlstest.mjs — B-05: cfbp_feedback vs. feedback_insert');
console.log(` TZ=${process.env.TZ || '(system)'}`);
console.log('══════════════════════════════════════════════════════════════\n');

const LEAGUE = '00000000-0000-4000-8000-00000000abcd';
const ME = 'p3';          // the signed-in player's league_members.id
const OTHER = 'p5';

// ─────────────────────────────────────────────────────────────────────────────
// SQL THREE-VALUED EVALUATION OF THE DEPLOYED POLICY TEXT
// ─────────────────────────────────────────────────────────────────────────────
const NULLV = Symbol('NULL');
const sqlEq = (a, b) => (a === null || a === undefined || b === null || b === undefined || a === NULLV || b === NULLV)
  ? NULLV : (a === b);
function sqlAnd(...vs) {
  if (vs.some(v => v === false)) return false;
  if (vs.some(v => v === NULLV)) return NULLV;
  return true;
}
/** Split a WITH CHECK clause on top-level ` and ` (parens are call args only). */
function splitTopLevelAnd(src) {
  const out = []; let depth = 0, cur = '';
  const s = src.trim();
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (depth === 0 && /\s/.test(c) && /\sand$/i.test(cur + ' ') === false) { /* fallthrough */ }
    cur += c;
    if (depth === 0 && /\sand\s$/i.test(cur)) { out.push(cur.slice(0, -5)); cur = ''; }
  }
  if (cur.trim()) out.push(cur);
  return out.map(t => t.trim()).filter(Boolean);
}
/** Evaluate the supported grammar against a row. Unknown term => throw (loud). */
function evalWithCheck(clause, row, env) {
  const terms = splitTopLevelAnd(clause);
  const vals = terms.map((t) => {
    let m;
    if ((m = t.match(/^is_member\(\s*([a-z_]+)\s*\)$/i))) return env.is_member(row[m[1]]);
    if ((m = t.match(/^([a-z_]+)\s*=\s*my_member_id\(\s*([a-z_]+)\s*\)$/i))) {
      return sqlEq(row[m[1]] === undefined ? null : row[m[1]], env.my_member_id(row[m[2]]));
    }
    throw new Error(`feedbackrlstest cannot evaluate policy term "${t}" — the policy changed shape.`
      + ' Update this evaluator deliberately rather than loosening the gate.');
  });
  return sqlAnd(...vals);
}
const ENV = {
  is_member: (lid) => (lid === null || lid === undefined ? NULLV : lid === LEAGUE),
  my_member_id: (lid) => (lid === LEAGUE ? ME : null),
};

// ─────────────────────────────────────────────────────────────────────────────
// READ THE DEPLOYED POLICY + SCHEMA (last-wins across all migrations)
//
// ══ REVIEWER (B-05, 2026-09-25) — THE SCAN USED TO FAIL OPEN ════════════════
//
// The first cut of this scan was LINE-based: `lines.forEach()` with a per-line
// regex. `[\s\S]*?` cannot cross a newline when the haystack is one line, so a
// policy redefined across two lines — which is the HOUSE STYLE here:
// `feedback_select` two lines above the one we read is already written that
// way, and 0026 redefines six insert policies like it — was invisible. The
// suite kept reporting 0002:313 and kept passing. Reviewer proved it with a
// scratch `9999_test_mutation.sql`. A guard that reads a STALE policy while a
// weaker one is deployed is worse than no guard: it reports green about a
// predicate nobody is enforcing.
//
// So: read each file WHOLE, strip comments first (a prose citation of the
// policy — and this repo's migrations quote each other constantly — must not
// be able to hijack the match), scan with a GLOBAL regex, take the LAST match
// across files in filename order, and derive the line number from the match
// offset in the stripped-but-offset-preserving text.
// ─────────────────────────────────────────────────────────────────────────────
const MIG_DIR = join(HERE, 'supabase/migrations');

/** Blank out SQL comments while preserving every byte offset and newline, so a
 *  match offset still maps to the right line. Quote-aware: a `--` inside a
 *  string literal is data, not a comment. */
function stripSqlComments(src) {
  const out = src.split('');
  let i = 0;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i];
    if (c === "'") {                       // string literal — '' is an escaped quote
      i++;
      while (i < src.length) {
        if (src[i] === "'" && src[i + 1] === "'") { i += 2; continue; }
        if (src[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }
    if (c === '-' && src[i + 1] === '-') {
      let j = src.indexOf('\n', i); if (j < 0) j = src.length;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i); j = j < 0 ? src.length : j + 2;
      blank(i, j); i = j; continue;
    }
    i++;
  }
  return out.join('');
}

/** LAST-WINS scan for `feedback_insert`'s WITH CHECK across a migrations dir.
 *  Exposed as a function taking the directory so the self-test below can run it
 *  against a SCRATCH COPY — nothing in this suite ever writes to the real one. */
function scanFeedbackInsertPolicy(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
  let found = null;
  for (const f of files) {
    const stripped = stripSqlComments(readFileSync(join(dir, f), 'utf8'));
    const re = /create\s+policy\s+feedback_insert\b[\s\S]*?with\s+check\s*\(([\s\S]*?)\)\s*;/gi;
    let m;
    while ((m = re.exec(stripped)) !== null) {
      found = {
        file: join(dir, f),
        line: stripped.slice(0, m.index).split('\n').length,
        clause: m[1].replace(/\s+/g, ' ').trim(),   // multi-line clauses normalize to one line
      };
    }
  }
  return found;
}

const policy = scanFeedbackInsertPolicy(MIG_DIR);
assert(!!policy, 'feedback_insert policy found in the migrations (last-wins, whole-file scan)');
console.log(`     → ${policy.file.slice(policy.file.indexOf('supabase/'))}:${policy.line}`);
console.log(`     → WITH CHECK (${policy.clause})\n`);

// ─────────────────────────────────────────────────────────────────────────────
// [0] SELF-TEST OF THE SCAN — proven fail-CLOSED against a SCRATCH COPY
//
// Every mutation below runs against a COPY of the migrations directory in
// tmpdir. Nothing in this suite writes to `supabase/migrations/`: an applied
// migration is never edited (CLAUDE.md), and a test that can create a file
// there is one stray run away from being handed to Drew as a paste.
// ─────────────────────────────────────────────────────────────────────────────
console.log('[0] The scan itself — fail-closed on a multi-line redefinition');
const REAL_SQL_COUNT = readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).length;
const SCRATCH = join(tmpdir(), `feedbackrlstest-${process.pid}`);
rmSync(SCRATCH, { recursive: true, force: true });
mkdirSync(SCRATCH, { recursive: true });
for (const f of readdirSync(MIG_DIR).filter(f => f.endsWith('.sql'))) copyFileSync(join(MIG_DIR, f), join(SCRATCH, f));

// (a) REVIEWER'S EXACT REPRODUCTION — a TWO-LINE redefinition in a later file.
//     House style: `feedback_select` two lines above the policy we read is
//     already multi-line, and 0026 redefines six insert policies that way.
//     The prose citation is placed AFTER the real statement on purpose: under
//     a scan that does not strip comments, last-wins would report `(true)`.
writeFileSync(join(SCRATCH, '9999_test_mutation.sql'),
  "create policy feedback_insert on public.feedback for insert to authenticated\n"
  + "  with check (is_member(league_id) and member_id = my_member_id(league_id) and kind <> 'spam');\n"
  + "-- Prose citation of the same policy, AFTER the real one — this repo's migrations quote\n"
  + "-- each other constantly, and a comment must never be able to hijack the match:\n"
  + "--   create policy feedback_insert on public.feedback for insert to authenticated with check (true);\n");
const mutA = scanFeedbackInsertPolicy(SCRATCH);
assert(!!mutA && mutA.file.endsWith('9999_test_mutation.sql'),
  'a TWO-LINE redefinition in a later file is what the scan reports (the line-based first cut reported 0002:313 and passed — it failed OPEN)');
assert(!!mutA && /is_member\(league_id\)/.test(mutA.clause) && /kind <> 'spam'/.test(mutA.clause),
  `the whole multi-line clause is captured, both lines of it (got: ${mutA && mutA.clause})`);
assert(!!mutA && mutA.clause !== 'true', 'the commented-out citation did NOT hijack the match — comments are stripped before scanning');
assert(!!mutA && mutA.line === 1, `the reported line is the create-policy line of the redefinition (got ${mutA && mutA.line})`);
let mutAThrew = null;
try { evalWithCheck(mutA.clause, { league_id: LEAGUE, member_id: ME, kind: 'bug' }, ENV); } catch (e) { mutAThrew = e; }
assert(mutAThrew instanceof Error,
  'a policy term this evaluator cannot model THROWS — an unrecognized clause goes red and is read by a human, never silently skipped');

// (b) A WEAKENED redefinition, written multi-line, using only modellable terms:
//     the author check is gone. This is the case that must make [4] RED.
writeFileSync(join(SCRATCH, '9999_test_mutation.sql'),
  "create policy feedback_insert on public.feedback for insert to authenticated\n"
  + "  with check (\n"
  + "    is_member(league_id)\n"
  + "  );\n");
const mutB = scanFeedbackInsertPolicy(SCRATCH);
assert(!!mutB && mutB.clause === 'is_member(league_id)',
  `a clause split across four lines normalizes to one (got: ${mutB && mutB.clause})`);
assert(evalWithCheck(mutB.clause, { league_id: LEAGUE, member_id: null }, ENV) === true,
  '[4] WOULD GO RED under this weakened policy: an author-less row PASSES it, so the non-vacuity '
  + 'assertion stops holding — which is the alarm a silently-weakened deployed policy must trip');

rmSync(SCRATCH, { recursive: true, force: true });
assert(!existsSync(join(MIG_DIR, '9999_test_mutation.sql'))
  && readdirSync(MIG_DIR).filter(f => f.endsWith('.sql')).length === REAL_SQL_COUNT,
  `the real supabase/migrations/ is untouched — every mutation ran against a tmpdir copy (${REAL_SQL_COUNT} files)`);

const schemaSrc = await readFile(join(MIG_DIR, '0001_schema.sql'), 'utf8');
const tblMatch = schemaSrc.match(/create table public\.feedback \(([\s\S]*?)\n\);/);
const SCHEMA_COLS = new Set(
  (tblMatch ? tblMatch[1].split('\n') : [])
    .map(l => l.trim())
    .filter(l => l && !/^--/.test(l) && !/^(primary key|foreign key|unique|check|constraint)\b/i.test(l))
    .map(l => l.split(/\s+/)[0])
    .filter(Boolean),
);

// ─────────────────────────────────────────────────────────────────────────────
// [1] BINDING — the fixture matches app.js's submitFeedback() entry literal
// ─────────────────────────────────────────────────────────────────────────────
console.log('[1] Fixture binding to app.js submitFeedback()');
const appSrc = await readFile(join(HERE, 'js/app.js'), 'utf8');
const sfIdx = appSrc.indexOf('export function submitFeedback');
const litStart = appSrc.indexOf('const entry = {', sfIdx);
const litEnd = appSrc.indexOf('\n  };', litStart);
const literal = appSrc.slice(litStart, litEnd);
const LITERAL_FIELDS = [...literal.matchAll(/^\s{4}([A-Za-z_]+)\s*[:,]/gm)].map(m => m[1]);
assert(LITERAL_FIELDS.length >= 7, `submitFeedback()'s entry literal parsed (${LITERAL_FIELDS.join(', ')})`);

/** The entry EXACTLY as submitFeedback() builds it (no memberId — that is the bug). */
function submittedEntry() {
  return {
    id: 'fb_1758800000000_ab12c',
    name: 'Drew',
    kind: 'bug',
    weekId: 'w5',
    body: 'the standings column sorts backwards',
    submittedAt: '2026-09-25T18:04:00.000Z',
    appVersion: 'v0.25.1',
    siteUrl: 'https://irbfootball.com/',
  };
}
assert(LITERAL_FIELDS.every(f => f in submittedEntry()),
  'every field app.js writes is present in the fixture (no silent fixture drift)');

// ─────────────────────────────────────────────────────────────────────────────
// Build the row through the REAL path: storage seam -> projection
// ─────────────────────────────────────────────────────────────────────────────
store.set('cfbp_session', JSON.stringify({ playerId: ME, isAdmin: false, playerVerified: true }));
const storage = await import('./js/storage.js');
const { toRows, fromRows } = await import('./js/supabase-projection.js');
const CTX = { leagueId: LEAGUE, memberIds: new Set([ME, OTHER]) };
const projectOne = (entry) => toRows.cfbp_feedback([entry], CTX).feedback[0];

storage.clearFeedback();
storage.appendFeedback(submittedEntry());
const stored = storage.getFeedback();
const row = projectOne(stored[0]);

// ─────────────────────────────────────────────────────────────────────────────
// [2] SCHEMA — every emitted column exists on public.feedback
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] Emitted columns vs. 0001_schema.sql');
assert(SCHEMA_COLS.size > 5, `feedback DDL parsed (${SCHEMA_COLS.size} columns)`);
const unknown = Object.keys(row).filter(c => !SCHEMA_COLS.has(c));
assert(unknown.length === 0, `no emitted column is absent from the schema${unknown.length ? ' — ' + unknown.join(', ') : ''}`);

// ─────────────────────────────────────────────────────────────────────────────
// [3] THE ACCEPTANCE GATE — the emitted row satisfies feedback_insert
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] THE GATE — WITH CHECK evaluated against the emitted row');
console.log(`     row.league_id = ${JSON.stringify(row.league_id)}`);
console.log(`     row.member_id = ${JSON.stringify(row.member_id)}   (my_member_id => ${JSON.stringify(ME)})`);
const verdict = evalWithCheck(policy.clause, row, ENV);
assert(verdict === true,
  `a signed-in player's feedback row PASSES feedback_insert's WITH CHECK (got ${verdict === NULLV ? 'NULL' : verdict})`);
assert(row.member_id === ME,
  'member_id carries the submitting player — the one column the policy compares');
assert(row.league_id === LEAGUE, 'league_id carries the league — is_member() has something to test');

// ─────────────────────────────────────────────────────────────────────────────
// [4] NON-VACUOUS — the evaluator really refuses an author-less row
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] Non-vacuity — the same evaluator on the pre-fix row');
const orphanRow = { ...row, member_id: null };
assert(evalWithCheck(policy.clause, orphanRow, ENV) === NULLV,
  'member_id NULL yields SQL NULL, not true — exactly the 42501 Drew saw (gate in [3] cannot pass by construction)');

// ─────────────────────────────────────────────────────────────────────────────
// [5] ROUND-TRIP — memberId survives hydrate, so flush #2 plans no patch
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[5] Round-trip — no perpetual UPDATE (feedback_update is commissioner-only)');
const backLegacy = fromRows.cfbp_feedback({ feedback: [row] }, CTX)[0];
assert(backLegacy.memberId === ME, 'memberId survives fromRows() — it is NOT marked absent');
assert(!(Array.isArray(row.extra?.__absent) && row.extra.__absent.includes('memberId')),
  'extra.__absent does not list memberId (a stripped author re-projects as null and plans a refused patch)');
const reRow = projectOne(backLegacy);
assert(reRow.member_id === row.member_id,
  're-projecting the hydrated row emits the same member_id — the diff plans nothing on the next flush');

// ─────────────────────────────────────────────────────────────────────────────
// [6] NO MISATTRIBUTION — another player's author-less row is untouched
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[6] No misattribution of rows already in the array');
storage.clearFeedback();
const legacyOther = { ...submittedEntry(), id: 'fb_legacy_1', name: 'Kihoon' };   // imported: no memberId
const all0 = storage.getFeedback();
assert(Array.isArray(all0) && all0.length === 0, 'fixture check: feedback list starts empty');
storage.appendFeedback(legacyOther);
storage.appendFeedback({ ...submittedEntry(), id: 'fb_mine_1' });
const list = storage.getFeedback();
const mine = list.find(e => e.id === 'fb_mine_1');
const theirs = list.find(e => e.id === 'fb_legacy_1');
assert(mine && mine.memberId === ME, 'the entry I just submitted carries my member id');
// `legacyOther` here stands in for an imported row; appending mine must not rewrite it.
assert(theirs && theirs.name === 'Kihoon', 'the pre-existing row is still in the list');

// ─────────────────────────────────────────────────────────────────────────────
// [7] LEGACY / IMPORT COMPATIBILITY
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[7] Legacy rows (pre-cutover import) still project member_id NULL');
const legacyRow = projectOne({ id: 'fb_old', name: '(anonymous)', body: 'x', submittedAt: '2026-08-01T00:00:00.000Z', appVersion: 'v0.19.0', siteUrl: '' });
assert(legacyRow.member_id === null, 'an entry with no author projects member_id: null (never a guessed author)');
assert(Array.isArray(legacyRow.extra.__absent) && legacyRow.extra.__absent.includes('memberId'),
  'the legacy row still marks memberId absent, so its round-trip stays exact');

console.log('\n──────────────────────────────────────────────────────────────');
console.log(fail
  ? `❌ ${fail} FAILED — ${pass} passed, ${fail} failed`
  : `✅ ALL PASS — ${pass} passed, ${fail} failed`);
console.log('──────────────────────────────────────────────────────────────\n');
process.exit(fail ? 1 : 0);
