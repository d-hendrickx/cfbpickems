/**
 * CFB Pickems - consumertest.mjs
 * ==============================
 * D1 (v0.30.0, thread 100726-D1, Lane A): DI-540 "Deadline, reveal and completion are the same everywhere" (UN-426 / PF-426, acceptance 2 and 3).
 *
 * Every consumer must answer "is this week editable", "is it revealed" and "who is in" from the same three sources: weekLockState (client) / week_lock_instant (server), arePicksPublic(week), and the
 * entrants. Two ways a new surface quietly grows its own answer, and one static scan for each:
 *
 *   [1] A STORED-STATUS GATE. A module that compares a week's stored status to 'open' / 'locked' / 'live' / 'final' / 'draft' has made its own decision about the week. weeklocktest [10] holds app.js to an
 *       allow-list; THIS holds every OTHER module in js/ to one: a count per file, each with the reason it is not an editability or reveal decision. A new comparison, or a removed one, fails until the list
 *       is changed on purpose (a dead entry is as loud as a new gate).
 *   [2] A PICK READER IN A LEAF. The pure modules a surface leans on (the lock helper, the live tiebreak, the sport status, the Rules/seam/admin helpers D1 adds) must import and call no accessor that returns
 *       a submission (getPicks / getTiebreakerGuess / getExtraPointGuess / getPick): a leaf that cannot read a pick cannot leak one before reveal. loadtest [64] already holds app.js and chat-ui.js to the
 *       blind-rule gate; this is its complement for the leaves. A module named here that is not in this tree yet (sport-status.js and the Home block builders arrive with other branches) is checked the day it
 *       appears; nothing needs editing.
 *   [3] Canaries - each scanner is fed synthetic modules and must catch every shape (a new gate, a gate in a new file, an imported reader, a called reader) and must not flag the legal shapes (a game's status, a
 *       reader named only in a comment).
 *
 * What this does NOT prove, stated plainly: that a gate is CORRECT (weeklocktest, pickstatustest and the Home tests prove each consumer reads the right source), or the server (static.check pins
 * week_lock_instant / pick_window_open and the one membership helper). A green scan means no consumer grew a private answer unannounced.
 *
 * Run: node consumertest.mjs
 */
import { readFile, readdir } from 'node:fs/promises';

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const JS_DIR = new URL('./js/', import.meta.url);
const read = (name) => readFile(new URL(name, JS_DIR), 'utf8');

/** Blank comments (keeping offsets), so prose can never satisfy or trip a scan. */
const blank = (s) => s
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:'"\\/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));

// ── [1] the stored-status gate inventory ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
// `<recv>.status <op> 'open'|...` or WEEK_STATUS.X, a bare `status` / `eff` (the effective status helpers use those names). A GAME's status is a different thing (the receiver is a game).
const SITE = /(?:\b([A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*)\??\.status|\b(status|eff))\s*(?:===|!==|==|!=)\s*(?:'(?:draft|open|locked|live|final)'|WEEK_STATUS\.(?:DRAFT|OPEN|LOCKED|LIVE|FINAL))/g;
const GAMEISH = /^(?:g|gm|game|games|nowGame|cur|nextGame|ev)$/;
export function statusGateSites(src) {
  const code = blank(src);
  const hits = [];
  let m;
  SITE.lastIndex = 0;
  while ((m = SITE.exec(code))) {
    if (m[1] && GAMEISH.test(m[1].split(/\??\./).pop())) continue;
    hits.push({ recv: m[1] || m[2], at: m.index });
  }
  return hits;
}

// File -> { n: how many comparisons, why: the reason none of them is a player-facing editability or reveal decision }. app.js is weeklocktest [10]'s.
const ALLOWED = {
  'extra-point.js':        { n: 2,  why: "a week the commissioner has not opened ('draft') has no side contest to settle: a skip, not an edit gate" },
  'home.js':               { n: 1,  why: "the feed skips DRAFT weeks; what a card says about the deadline and the reveal comes from weekLockState / revealedWeeks" },
  'league-settings.js':    { n: 4,  why: "the Leave row's fact ('picks you made in an open week won't be scored', SP-53); it is fed the effective lock instant, and nothing here lets a player edit" },
  'live-tiebreak.js':      { n: 1,  why: "stops the live tiebreak display once the week is FINAL (a display phase); the guesses it shows are handed in already gated" },
  'multisport-admin.js':   { n: 10, why: "D1 commissioner row actions (Open / Lock / Finalize / Archive per sport): which button the COMMISSIONER is offered next from the stored status; no player editability, no reveal" },
  'pick-status.js':        { n: 2,  why: "the 'Who's in' strip exists only while a week is open or locked (a display phase); the reveal question is asked first through read.isPublic and fails closed" },
  'recap.js':              { n: 3,  why: "history: FINAL weeks only, for the recap and Weekly History" },
  'reminder-rules.js':     { n: 8,  why: "which week a reminder is about (open), draft-age and finalize-nudge selection for the commissioner; 'is the deadline passed' is effectiveLockAtMs, never the stored status" },
  'spread-find-ui.js':     { n: 2,  why: "W-71: whether the COMMISSIONER is offered 'Find spreads' on a week (draft or open: the slate can still take a spread); no player edit, no reveal, no pick gate, and it writes only a game's spread" },
  'sport-stall.js':        { n: 2,  why: "DI-557: the stall banner's live window mirrors the SERVER's own scores-refresh window (a week locked or live, scores_refresh_due_leagues): it asks 'is a score expected to be moving', never whether a pick can be edited or revealed; it reads no pick and shows no player's selection" },
  'storage.js':            { n: 6,  why: "the effective-status / arePicksPublic helpers themselves: this IS the definition the other consumers call" },
  'supabase-backend.js':   { n: 9,  why: "the adapter's reveal bookkeeping (which weeks became public since the last hydrate) and its projections; server-driven, not a UI decision" },
  'tie-context.js':        { n: 1,  why: "tie-break context S3 to S5 runs only on a settled (FINAL) week" },
  'week-wizard.js':        { n: 6,  why: "the commissioner's wizard and Manage view: transitions and which controls the COMMISSIONER sees" },
};

console.log('\n[1] No module outside app.js keeps a private stored-status gate');
{
  const files = (await readdir(JS_DIR)).filter((f) => f.endsWith('.js') && f !== 'app.js').sort();
  const found = {};
  for (const f of files) { const n = statusGateSites(await read(f)).length; if (n) found[f] = n; }
  const wrong = Object.keys(found).filter((f) => !ALLOWED[f] || ALLOWED[f].n !== found[f]).map((f) => [f, found[f], ALLOWED[f] ? ALLOWED[f].n : 0]);
  assert(wrong.length === 0, `[1a] every file's stored-status comparisons match its allow-list entry (a NEW gate must ask weekLockState / arePicksPublic instead; mismatches [file, found, allowed]: ${JSON.stringify(wrong)})`);
  const dead = Object.keys(ALLOWED).filter((f) => !(f in found));
  assert(dead.length === 0, `[1b] ...and the list has no dead entry (${JSON.stringify(dead)})`);
  assert(Object.values(ALLOWED).every((e) => typeof e.why === 'string' && e.why.length > 30), '[1c] ...each entry says why it is not an editability or reveal decision');
  const chatUi = statusGateSites(await read('chat-ui.js'));
  assert(chatUi.length === 0, `[1d] the chat surface compares no week status at all (${chatUi.length}): the Locker Room line and pick chips ask arePicksPublic`);
}

// ── [2] no pick reader in a leaf ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const READERS = ['getPicks', 'getPick', 'getTiebreakerGuess', 'getExtraPointGuess', 'getTiebreakerGuesses', 'getExtraPointGuesses'];
export function pickReaderUses(src) {
  const code = blank(src);
  const used = READERS.filter((r) => new RegExp(String.raw`\b${r}\b`).test(code));
  return used;
}
const LEAVES = ['week-lock.js', 'live-tiebreak.js', 'sport-status.js', 'sport-seam.js', 'multisport-admin.js', 'sport-rules.js', 'pick-status.js', 'tie-context.js', 'feed-caption-lines.js', 'chat-sport-pills.js', 'sport-tag.js', 'sport-stall.js'];   // W-57 Part 2: the Locker Room's pill builder and its closed set of sport codes render and validate what they are handed; neither may ever hold a pick

console.log('\n[2] Leaf modules import and call no pick reader');
{
  const present = [], absent = [];
  for (const f of LEAVES) { try { present.push([f, await read(f)]); } catch { absent.push(f); } }
  assert(present.length >= 6, `[2a] the scan found the leaves that exist in this tree (${present.map(([f]) => f).join(', ')}); not in this tree yet, checked when they arrive: ${absent.join(', ') || 'none'}`);
  for (const [f, src] of present) {
    const used = pickReaderUses(src);
    assert(used.length === 0, `[2b] ${f}: names no submission reader (${used.join(', ') || 'none'})`);
  }
  const wl = (await read('week-lock.js')).match(/^import [^;]* from '([^']+)';/gm) || [];
  assert(wl.every((l) => !/storage|app|chat|supabase/.test(l)), '[2c] week-lock.js imports no storage, app, chat or backend module (a pure leaf cannot reach a pick)');
}

// ── [3] canaries ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[3] The scanners catch every shape and do not flag the legal ones');
{
  const gate = (s) => statusGateSites(s).length;
  assert(gate("if (week.status === 'open') edit();") === 1 && gate("if (w.status!=='locked') x();") === 1 && gate('if (week.status === WEEK_STATUS.OPEN) y();') === 1 && gate("const s = status === 'open';") === 1,
    '[3a] a new gate is found in each spelling: week.status === \'open\', w.status!==\'locked\', WEEK_STATUS.OPEN, a bare status');
  assert(gate("if (game.status === 'final') z();") === 0 && gate("games.filter(g => g.status === 'live')") === 0 && gate("if (nowGame.status !== 'final') q();") === 0,
    '[3b] a GAME\'s status is not a week gate (final / live games are the scoreboard\'s business)');
  assert(gate("// if (week.status === 'open') old();\n/* week.status === 'locked' */ const ok = true;") === 0, '[3c] a gate named only in a comment is not a gate');
  assert(gate("if (week.status === 'open' && week.status !== 'draft') {}") === 2, '[3d] two comparisons on one line are two sites');
  assert(pickReaderUses("import { getPicks } from './storage.js';") .join() === 'getPicks' && pickReaderUses('const p = getTiebreakerGuess(w, id);').join() === 'getTiebreakerGuess' && pickReaderUses('storageApi.getExtraPointGuess(w, id)').join() === 'getExtraPointGuess',
    '[3e] an imported reader, a called reader and a reader reached through a namespace are all found');
  assert(pickReaderUses("// getPicks(weekId) lives in storage.js\n/* getTiebreakerGuess */ export const x = 1;").length === 0 && pickReaderUses('function getPicksSummary() {}').length === 0 && pickReaderUses('const hasPlayerSubmitted = 1').length === 0,
    '[3f] a reader named only in a comment, a longer identifier and the boolean hasPlayerSubmitted are not flagged');
}

console.log(`\n${'='.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
