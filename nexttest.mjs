/**
 * CFB Pickems — nexttest.mjs (Deployment 1, Lane B, DI-599 / PF-455 "After-game continuity", fix round 2, 2026-10-08)
 * =================================================================================================================
 * The proof for js/next-up.js: the viewer's next SHARED opportunity, from published weeks only, never invented.
 *
 *   [1] Priority: picks-due > picks-in > follow > none; inside one, the soonest; the DI-599 fixtures (CFB just finished with NFL Open: entered and not picked / picked; a CFB-only member; no slate)
 *   [2] What is never offered: a Draft week, a demo week (except to the commissioner), a week with no games, a final week, a week whose every game is over, an excluded week, a past lock as "locks…"
 *   [3] The words: DI-599's exact copy, the honest variants for a week already under way, no sport words in a one-sport league (S1), the Final card's short form, the buttons
 *   [4] Purity: no imports, no clock (the caller's `now`), signed out = none
 *   [5] Mutation proofs on data: URLs of scratch copies (never the file)
 *
 * Times are epoch ms and the formatter is the test's own, so nothing here depends on the machine's zone.
 *
 * Run:  node nexttest.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const assert = (cond, label) => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } };
const SRC = readFileSync(fileURLToPath(new URL('./js/next-up.js', import.meta.url)), 'utf8');
const REAL = await import('./js/next-up.js');

const NOW = Date.UTC(2026, 9, 10, 18, 0, 0);            // a Saturday afternoon, UTC
const H = 3600e3, D = 24 * H;
const fmt = { time: (ms) => `T+${Math.round((ms - NOW) / H)}h` };
const wk = (id, n, sport, status, extra = {}) => ({ weekId: id, weekNumber: n, sport, status, ...extra });
const gm = (id, weekId, kickMs, status = 'scheduled') => ({ gameId: id, weekId, kickoff: new Date(kickMs).toISOString(), status });

/** The DI-599 world: CFB Week 6 just finished; NFL Week 6 is open (locks in 18 h, kicks off in 19 h). */
function world({ nflPicked = false, nflEntered = true, extraWeeks = [], extraGames = [], viewerId = 'p1', isCommissioner = false, statusOverride = null } = {}) {
  const weeks = [wk('c6', 6, 'cfb', 'final'), wk('n6', 6, 'nfl', 'open', { picksLockAt: new Date(NOW + 18 * H).toISOString() }), ...extraWeeks];
  const games = [gm('cg1', 'c6', NOW - 6 * H, 'final'), gm('ng1', 'n6', NOW + 19 * H), gm('ng2', 'n6', NOW + 22 * H), ...extraGames];
  return {
    weeks, games, viewerId, now: NOW, isCommissioner,
    statusOf: statusOverride || ((w) => w.status),
    enteredIn: (sp) => (sp === 'nfl' ? nflEntered : true),
    pickedAll: (id) => (id === 'n6' ? nflPicked : false),
    labelOf: (sp) => sp.toUpperCase(),
  };
}

function probe(mod) {
  const o = {};
  const due = mod.nextOpportunity(world());
  o.due = due.kind === 'picks-due' && due.weekId === 'n6' && due.sport === 'nfl' && due.lockAt === NOW + 18 * H;
  const inn = mod.nextOpportunity(world({ nflPicked: true }));
  o.in = inn.kind === 'picks-in' && inn.weekId === 'n6' && inn.editable === true;
  const fol = mod.nextOpportunity(world({ nflEntered: false }));
  o.follow = fol.kind === 'follow' && fol.weekId === 'n6' && fol.entered === false;
  const none = mod.nextOpportunity({ ...world(), weeks: [wk('c6', 6, 'cfb', 'final')], games: [gm('cg1', 'c6', NOW - 6 * H, 'final')] });
  o.none = none.kind === 'none';
  const draft = mod.nextOpportunity({ ...world(), weeks: [wk('c6', 6, 'cfb', 'final'), wk('n6', 6, 'nfl', 'draft')] });
  o.draft = draft.kind === 'none';
  const lockGone = mod.nextOpportunity({ ...world(), weeks: [wk('c6', 6, 'cfb', 'final'), wk('n6', 6, 'nfl', 'open', { picksLockAt: new Date(NOW - H).toISOString() })] });
  o.pastLock = lockGone.kind !== 'picks-due' && !/lock/.test(mod.nextLine(lockGone, fmt, { showSport: true }));
  const demo = { ...world(), weeks: [wk('c6', 6, 'cfb', 'final'), wk('n6', 6, 'nfl', 'open', { picksLockAt: new Date(NOW + 18 * H).toISOString(), dataSourceMode: 'demo' })] };
  o.demo = mod.nextOpportunity(demo).kind === 'none' && mod.nextOpportunity({ ...demo, isCommissioner: true }).kind === 'picks-due';
  o.s1 = !/CFB|NFL/.test(mod.nextLine(due, fmt, { showSport: false }) + mod.nextShort(due, fmt, { showSport: false }) + mod.nextAction(due, { showSport: false }).label);
  o.copyDue = mod.nextLine(due, fmt, { showSport: true }) === 'Next up: NFL Week 6 — picks lock T+18h.' && mod.nextAction(due, { showSport: true }).label === 'Make your NFL picks';
  o.copyFollow = mod.nextLine(fol, fmt, { showSport: true }) === "NFL Week 6 kicks off T+19h. You're not entered — follow along in Game Day and the chat.";
  o.signedOut = mod.nextOpportunity(world({ viewerId: '' })).kind === 'none';
  return o;
}

// ═══ [1] ═══
console.log('\n[1] Priority and the DI-599 fixtures…');
{
  const due = REAL.nextOpportunity(world());
  assert(due.kind === 'picks-due' && due.weekId === 'n6' && due.sport === 'nfl' && due.weekN === 6 && due.lockAt === NOW + 18 * H && due.editable === true, `1a: CFB just finished, NFL Open, entered and NOT picked -> picks-due on NFL Week 6, its real lock instant (${JSON.stringify(due)})`);
  const inn = REAL.nextOpportunity(world({ nflPicked: true }));
  assert(inn.kind === 'picks-in' && inn.weekId === 'n6' && inn.editable === true, '1b: …every NFL game picked -> picks-in, still editable (the lock is ahead)');
  const fol = REAL.nextOpportunity(world({ nflEntered: false }));
  assert(fol.kind === 'follow' && fol.entered === false && fol.live === false, '1c: a CFB-only member (not entered in NFL) -> follow, never picks-due (they are never named as missing NFL picks)');
  const none = REAL.nextOpportunity({ ...world(), weeks: [wk('c6', 6, 'cfb', 'final')], games: [gm('cg1', 'c6', NOW - 6 * H, 'final')] });
  assert(none.kind === 'none' && none.weekId === null, '1d: no published slate still to come -> none');
  // two candidates: a due week beats an earlier follow week; two due weeks: the sooner lock first
  const two = REAL.nextOpportunity(world({ extraWeeks: [wk('c7', 7, 'cfb', 'live')], extraGames: [gm('cg7', 'c7', NOW - H, 'live')] }));
  assert(two.kind === 'picks-due' && two.weekId === 'n6', '1e: picks-due outranks follow (a live CFB week does not hide the NFL picks still to make)');
  const soon = REAL.nextOpportunity(world({ extraWeeks: [wk('c7', 7, 'cfb', 'open', { picksLockAt: new Date(NOW + 5 * H).toISOString() })], extraGames: [gm('cg7', 'c7', NOW + 6 * H)] }));
  assert(soon.kind === 'picks-due' && soon.weekId === 'c7', '1f: two weeks due: the one that locks SOONER first');
  const lockedDone = REAL.nextOpportunity({ ...world({ nflPicked: true }), weeks: [wk('c6', 6, 'cfb', 'final'), wk('n6', 6, 'nfl', 'locked', { picksLockAt: new Date(NOW - H).toISOString() })] });
  assert(lockedDone.kind === 'picks-in' && lockedDone.editable === false, '1g: a LOCKED week the viewer completed -> picks-in, not editable (no Edit My Picks)');
  const lockedNot = REAL.nextOpportunity({ ...world(), weeks: [wk('c6', 6, 'cfb', 'final'), wk('n6', 6, 'nfl', 'locked', { picksLockAt: new Date(NOW - H).toISOString() })] });
  assert(lockedNot.kind === 'follow' && lockedNot.entered === true, '1h: a LOCKED week the viewer did not complete -> follow (they cannot act on it)');
  const ownLive = REAL.nextOpportunity({ ...world(), weeks: [wk('c6', 6, 'cfb', 'live')], games: [gm('cg1', 'c6', NOW - 3 * H, 'final'), gm('cg2', 'c6', NOW - H, 'live')] });
  assert(ownLive.kind === 'follow' && ownLive.weekId === 'c6' && ownLive.live === true, '1i: a Final game whose own week still has a game going -> follow that week, under way');
}

// ═══ [2] ═══
console.log('\n[2] What is never offered…');
{
  const p = probe(REAL);
  assert(p.draft, '2a: a Draft week is never offered (the commissioner has not published it)');
  assert(p.demo, '2b: a demo week is offered to the commissioner only (UN-71)');
  const noGames = REAL.nextOpportunity({ ...world(), games: [gm('cg1', 'c6', NOW - 6 * H, 'final')] });
  assert(noGames.kind === 'none', '2c: a week with no games is not a slate');
  const allOver = REAL.nextOpportunity({ ...world(), weeks: [wk('c6', 6, 'cfb', 'final'), wk('n6', 6, 'nfl', 'live')], games: [gm('ng1', 'n6', NOW - 5 * H, 'final')] });
  assert(allOver.kind === 'none', '2d: a week whose every game is over has nothing left to come');
  assert(p.pastLock, '2e: a lock instant in the PAST is never shown as "picks lock …" (the week is not due)');
  const excluded = REAL.nextOpportunity({ ...world(), excludeWeekIds: ['n6'] });
  assert(excluded.kind === 'none', '2f: an excluded week is not offered');
  const confirmed = REAL.nextOpportunity({ ...world(), statusOf: (w) => (w.weekId === 'n6' ? 'draft' : w.status) });
  assert(confirmed.kind === 'none', '2g: the status the APP trusts (statusOf: the server-confirmed one) decides, not the raw mirror');
}

// ═══ [3] ═══
console.log('\n[3] The words…');
{
  const due = REAL.nextOpportunity(world()), inn = REAL.nextOpportunity(world({ nflPicked: true })), fol = REAL.nextOpportunity(world({ nflEntered: false }));
  const none = REAL.nextOpportunity({ ...world(), weeks: [], games: [] });
  assert(REAL.nextLine(due, fmt, { showSport: true }) === 'Next up: NFL Week 6 — picks lock T+18h.', `3a: picks-due: "${REAL.nextLine(due, fmt, { showSport: true })}"`);
  assert(REAL.nextLine(inn, fmt, { showSport: true }) === "You're in for NFL Week 6. Picks lock T+18h.", `3b: picks-in: "${REAL.nextLine(inn, fmt, { showSport: true })}"`);
  assert(REAL.nextLine(fol, fmt, { showSport: true }) === "NFL Week 6 kicks off T+19h. You're not entered — follow along in Game Day and the chat.", `3c: follow (not entered): "${REAL.nextLine(fol, fmt, { showSport: true })}"`);
  assert(REAL.nextLine(none, fmt, { showSport: true }) === 'Nothing else is scheduled yet. When the commissioner publishes the next slate, it shows up here.', '3d: none: DI-599\'s sentence, exactly');
  const ownLive = REAL.nextOpportunity({ ...world(), weeks: [wk('c6', 6, 'cfb', 'live')], games: [gm('cg1', 'c6', NOW - 3 * H, 'final'), gm('cg2', 'c6', NOW - H, 'live')] });
  assert(REAL.nextLine(ownLive, fmt, { showSport: false }) === 'Week 6 is under way — follow along in Game Day and the chat.', `3e: a week already under way says so (never "kicks off" a time in the past): "${REAL.nextLine(ownLive, fmt)}"`);
  const lockedDone = REAL.nextOpportunity({ ...world({ nflPicked: true }), weeks: [wk('c6', 6, 'cfb', 'final'), wk('n6', 6, 'nfl', 'locked', { picksLockAt: new Date(NOW - H).toISOString() })] });
  assert(REAL.nextLine(lockedDone, fmt, { showSport: true }) === "You're in for NFL Week 6. It kicks off T+19h.", '3f: picks-in after the lock: "It kicks off …" (no past "Picks lock")');
  assert(probe(REAL).s1, '3g: S1 — a one-sport league prints no sport word in the line, the short form or the button');
  assert(REAL.nextShort(due, fmt, { showSport: true }) === 'Next: NFL Week 6 picks lock T+18h' && REAL.nextShort(inn, fmt, { showSport: true }) === "Next: you're in for NFL Week 6" && REAL.nextShort(fol, fmt, { showSport: true }) === 'Next: NFL Week 6 kicks off T+19h' && REAL.nextShort(none, fmt) === '', '3h: the Final card\'s short form, and NOTHING for none (the card never says "Next: nothing")');
  const a1 = REAL.nextAction(due, { showSport: true }), a2 = REAL.nextAction(inn, { showSport: true }), a3 = REAL.nextAction(fol), a4 = REAL.nextAction(none), a5 = REAL.nextAction(lockedDone);
  assert(a1.action === 'next-picks' && a1.label === 'Make your NFL picks' && a1.tone === 'primary' && a2.action === 'next-picks' && a2.label === 'Edit My Picks' && a3.action === 'open-gameday' && a3.label === 'Open Game Day' && a4 === null && a5 === null, '3i: the buttons: "Make your NFL picks" (primary), "Edit My Picks", "Open Game Day"; none for none or a locked week');
}

// ═══ [4] ═══
console.log('\n[4] Purity…');
{
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  assert(!/^\s*import\s/m.test(code) && !/Date\.now\(|new Date\(\)/.test(code), '4a: js/next-up.js imports nothing and reads no clock (the caller passes `now`)');
  assert(REAL.nextOpportunity(world({ viewerId: '' })).kind === 'none' && REAL.nextOpportunity({}).kind === 'none', '4b: signed out (no viewer) or no input -> none (S4: nothing personal)');
}

// ═══ [5] ═══
console.log('\n[5] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file)…');
{
  const load = (src) => import('data:text/javascript;base64,' + Buffer.from(src).toString('base64') + '#' + Math.random());
  const R = (a, b) => { if (SRC.split(a).length !== 2) throw new Error('mutation anchor must match exactly once: ' + a.slice(0, 70)); return SRC.replace(a, b); };
  const base = probe(REAL);
  assert(Object.values(base).every(Boolean), `5-0: the probe is GREEN on the real module (positive control: ${Object.entries(base).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  const mutants = [
    ['a Draft week is offered', R("if (!['open', 'locked', 'live'].includes(st)) continue;", "if (!['open', 'locked', 'live', 'draft'].includes(st)) continue;"), 'draft'],
    ['a demo week is offered to everyone', R("if (w.dataSourceMode === 'demo' && i.isCommissioner !== true) continue;", ''), 'demo'],
    ['a past lock still counts as due', R('const editable = st === \'open\' && lockAhead;', "const editable = st === 'open';"), 'pastLock'],
    ['the entry check is ignored (a non-entrant is told to pick)', R('if (entered && editable && !done) kind = \'picks-due\';', "if (editable && !done) kind = 'picks-due';"), 'follow'],
    ['the sport word is always printed', R("const sp = (next, showSport) => (showSport && isStr(next.sportLabel) ? `${next.sportLabel} ` : '');", "const sp = (next) => `${next.sportLabel} `;"), 's1'],
    ['a signed-out viewer is given an opportunity', R("if (!isStr(i.viewerId) || !Number.isFinite(now)) return none;", 'if (!Number.isFinite(now)) return none;'), 'signedOut'],
  ];
  for (const [name, src, check] of mutants) {
    let res;
    try { res = probe(await load(src)); } catch (e) { res = { [check]: false, _err: String(e.message).slice(0, 80) }; }
    assert(src !== SRC && res[check] === false, `5: mutant "${name}" turns ${check} RED${res._err ? ' (' + res._err + ')' : ''}`);
  }
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
