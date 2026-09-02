/**
 * CFB Pickems — synctest.mjs
 * ==========================
 * RG-39 — "all the emails for the players went away and the pins reset."
 *
 * Run:  node synctest.mjs
 *
 * A SEPARATE FILE ON PURPOSE, same rationale as grouptest.mjs (CLAUDE.md): this
 * suite has to drive the REAL backend.hydrate() against a stubbed transport, and
 * doing that inside loadtest.mjs would leave the backend singleton hydrated,
 * `_backendMode` flipped to googleSheets, and `load()`/`save()` routed through a
 * live mirror for every suite that runs after it. Sync behaviour needs its own
 * process, and a data-destruction proof needs to be readable start to finish.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * `cfbp_players` is the only storage key that holds AUTHENTICATION and CONTACT
 * data: `pinHash` (the player's login PIN, base64) and `email`. Losing a
 * pinHash is not a cosmetic loss. Until RG-40 (2026-08-26) verifyPlayerPin()
 * returned TRUE when the field was absent, so a wiped hash silently converted
 * that player's account into one that accepted ANY PIN — that is what "the pins
 * reset" meant from the outside, and it was live on irbfootball.com. That
 * predicate now fails closed, so the same wipe locks the player out instead of
 * letting the league in. Better, and still a total loss of their credential:
 * this file is what stops the wipe happening at all.
 *
 * Drew, 2026-08-15, after a deploy:
 *   "When we updated the last update, all the emails for the players went away
 *    and the pins reset. We need to make sure that if we input personal
 *    information it stays, and if we update security information it stays."
 *
 * This is RG-12's axis — irreplaceable user data destroyed by a boot-time
 * cascade — so it is graded the same way: reproduce the cascade end to end
 * through the real code path, not by asserting a helper in isolation.
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

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const be      = await import('./js/backend.js');
const storage = await import('./js/storage.js');

const NAMES = ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob', 'Kihoon'];
const MIRROR_KEY = 'cfbp_sheet_mirror';

/** Six players as the Sheet actually holds them: emails and PINs on file. */
const remotePlayers = () => NAMES.map((n, i) => ({
  playerId: `p${i}`, displayName: n, active: true,
  email: `${n.toLowerCase()}@example.com`,
  pinHash: globalThis.btoa(String(1000 + i)),
  almaMater: 'Ohio State',
  preferences: { tz: 'ET' },
}));

/**
 * The snapshot a device boots on after an update: the SAME SIX PLAYERS, in the
 * same order, all still present and well-formed — from before the commissioner
 * ever typed an email or a PIN. Nothing about it looks broken. That is the
 * entire problem.
 */
const stalePlayers = () => NAMES.map((n, i) => ({
  playerId: `p${i}`, displayName: n, active: true, preferences: {},
}));

/** Fresh module state per scenario — hydrate mutates a module-level singleton. */
function resetWorld(remoteOverride) {
  store.clear();
  const REMOTE = remoteOverride || {
    cfbp_players: remotePlayers(),
    cfbp_weeks:   [{ weekId: 'w1', weekNumber: 1, season: 2026, status: 'open' }],
    cfbp_picks:   [{ pickId: 'x1', weekId: 'w1', gameId: 'g1', playerId: 'p0', selectedTeam: 'Ohio State' }],
    cfbp_settings: { theme: 'neutral' },
  };
  const sent = [];
  globalThis.fetch = async (_url, opts) => {
    const req = JSON.parse(opts.body);
    if (req.action === 'getAll') return { ok: true, json: async () => ({ ok: true, data: REMOTE }) };
    if (req.action === 'setMany') { sent.push(req.entries); return { ok: true, json: async () => ({ ok: true }) }; }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  be.setBackendConfig('https://example.invalid/exec', 'tok');
  return { REMOTE, sent };
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] RG-39 — THE CASCADE: one tap during a cold start wipes every email and PIN…');
// Reproduced end to end through the real boot path, in the order app.js runs it:
//   boot() app.js:204  primeFromMirror()      — serve the last-known snapshot
//   boot() app.js:208  setBackendMode(sheets) — reads/writes now hit the mirror
//   boot() app.js:227  revealApp()            — THE APP IS INTERACTIVE HERE
//   boot() app.js:235  await hydrateBackend() — Apps Script cold start, 10–20s
// The gap between paint and hydrate is not an edge case; the primer records it
// as a normal condition. Anything the player touches in that gap is a write
// against a stale mirror.
{
  const { sent } = resetWorld();
  localStorage.setItem(MIRROR_KEY, JSON.stringify({
    at: '2026-08-01T00:00:00Z',
    data: { cfbp_players: stalePlayers(), cfbp_weeks: [{ weekId: 'w1', weekNumber: 1, season: 2026, status: 'open' }] },
  }));
  const primed = be.primeFromMirror();
  storage.setBackendMode('googleSheets');

  assert(primed > 0, `boot: primeFromMirror() served the stale snapshot (${primed} keys)`);
  assert(be.isMirrorStale() === true, 'boot: the mirror is flagged STALE — hydrate has not returned yet');
  assert(storage.getPlayers().length === 6 && storage.getPlayers().every(p => !p.email && !p.pinHash),
    'fixture check: the stale snapshot has all six players and NO emails, NO pinHashes — same record COUNT as the Sheet, which is why a size check cannot see it');

  // ONE ordinary tap. Theme is a per-PLAYER preference (CLAUDE.md architecture
  // bullet 4), so it is a whole-array read-modify-write of cfbp_players.
  storage.setSession('p1', false, true);
  storage.setTheme('ohio');
  assert(storage.getPlayer('p1').preferences.theme === 'ohio',
    'a player changes their theme during the cold start — one legitimate, ordinary tap, and the ONLY user action in this scenario');

  await be.hydrate();

  const after = storage.getPlayers();
  assert(after.filter(p => p.email).length === 6,
    `THE REPORT (emails): all six emails survive hydrate (got ${after.filter(p => p.email).length}/6)`);
  assert(after.filter(p => p.pinHash).length === 6,
    `THE REPORT (PINs): all six pinHashes survive hydrate (got ${after.filter(p => p.pinHash).length}/6)`);
  assert(storage.getPlayerPin('p0') === '1000',
    `the commissioner panel can still read p0's PIN back (got "${storage.getPlayerPin('p0')}")`);
  assert(storage.verifyPlayerPin('p0', '9999') === false,
    'A WRONG PIN IS STILL REJECTED — a wiped hash never "reset" the PIN, it removed the check (pre-RG-40 the account then accepted anything; post-RG-40 it accepts nothing). Either way the hash surviving hydrate is the thing being proven here');
  assert(storage.verifyPlayerPin('p0', '1000') === true,
    "…and the RIGHT pin still works — the fix restores data, it does not lock everyone out");

  // The other half of what makes this permanent and league-wide: the wiped
  // array does not merely sit in one device's memory, it is pushed to the Sheet.
  await be.flushPush();
  const playersPush = sent.map(e => e && e.cfbp_players).filter(Boolean).pop();
  assert(playersPush, 'fixture check: a cfbp_players write really was pushed — the scenario reaches the Sheet, it is not a local-only artefact');
  assert(playersPush && playersPush.filter(p => p.email).length === 6,
    `and the value PUSHED TO THE SHEET carries all six emails (got ${playersPush ? playersPush.filter(p => p.email).length : 'n/a'}/6) — this is what turns one device's stale mirror into league-wide, permanent loss`);
  assert(playersPush && playersPush.filter(p => p.pinHash).length === 6,
    `…and all six pinHashes (got ${playersPush ? playersPush.filter(p => p.pinHash).length : 'n/a'}/6)`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] …while the tap that caused it is still honoured — the fix preserves, it does not veto…');
// A guard that fixed this by throwing the local write away would be trading one
// silent data loss for another. The player's theme choice is real user intent.
{
  resetWorld();
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: '2026-08-01T00:00:00Z', data: { cfbp_players: stalePlayers() } }));
  be.primeFromMirror();
  storage.setBackendMode('googleSheets');
  storage.setSession('p1', false, true);
  storage.setTheme('ohio');
  await be.hydrate();

  assert(storage.getPlayer('p1').preferences.theme === 'ohio',
    "the player's theme choice SURVIVES — a field they actually set is kept, not discarded with the staleness");
  assert(storage.getPlayer('p1').email === 'brayden@example.com',
    'and that same record still has its email — one record, local field kept AND remote field restored');
  assert(storage.getPlayer('p1').preferences.tz === 'ET',
    "the remote's own preference sub-field on that record is not collateral damage either");
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] A REAL edit still wins — the guard must not freeze the commissioner out…');
// The mirror image of [1]: the local value is NEWER, not stale. If the guard
// cannot tell these apart it is useless, because every genuine edit to an email
// or PIN would be silently reverted — which is Drew's complaint in reverse
// ("if we update security information it stays").
{
  resetWorld();
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: '2026-08-01T00:00:00Z', data: { cfbp_players: remotePlayers() } }));
  be.primeFromMirror();
  storage.setBackendMode('googleSheets');

  storage.setSession('p0', true, true);
  storage.savePlayer({ ...storage.getPlayer('p2'), email: 'kevin.new@example.com' });
  storage.setPlayerPin('p3', '4242');
  await be.hydrate();

  assert(storage.getPlayer('p2').email === 'kevin.new@example.com',
    'a freshly typed EMAIL survives hydrate — the commissioner\'s edit is not reverted by the remote it is newer than');
  assert(storage.getPlayerPin('p3') === '4242',
    `a freshly set PIN survives hydrate (got "${storage.getPlayerPin('p3')}") — "if we update security information it stays"`);
  assert(storage.verifyPlayerPin('p3', '4242') === true,
    '…and the player can actually log in with it');
  assert(storage.getPlayer('p4').email === 'jacob@example.com',
    'every untouched record keeps its remote value — the edit is surgical, not a whole-array stamp');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] Adding a player still works, and RG-12 defense (c) still refuses a shrink…');
{
  resetWorld();
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: '2026-08-01T00:00:00Z', data: { cfbp_players: remotePlayers() } }));
  be.primeFromMirror();
  storage.setBackendMode('googleSheets');
  storage.addPlayer({ playerId: 'p9', displayName: 'Co-Commissioner', active: true, email: 'co@example.com' });
  await be.hydrate();
  assert(storage.getPlayers().length === 7 && storage.getPlayer('p9'),
    `a newly ADDED player survives hydrate — a held write may still grow user data (got ${storage.getPlayers().length})`);
  assert(storage.getPlayer('p9').email === 'co@example.com', '…with the email it was created with');
  assert(storage.getPlayers().filter(p => p.email).length === 7,
    'and the six existing emails are untouched by the addition');
}
{
  // Defense (c)'s original job, unchanged: a stale local that has FEWER records
  // than the remote is dropped wholesale.
  resetWorld();
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: '2026-08-01T00:00:00Z', data: { cfbp_players: remotePlayers().slice(0, 3) } }));
  be.primeFromMirror();
  storage.setBackendMode('googleSheets');
  storage.savePlayer({ ...storage.getPlayer('p0'), displayName: 'Drew!' });
  await be.hydrate();
  assert(storage.getPlayers().length === 6,
    `RG-12 defense (c) UNCHANGED: a held write holding only 3 of 6 players is dropped, remote kept (got ${storage.getPlayers().length})`);
  assert(be._shrinksForTest([1, 2], [1, 2, 3]) === true && be._shrinksForTest([1, 2, 3], [1, 2]) === false,
    'the record-count shrink test itself is still live and still exported (RG-27 — this seam is load-bearing)');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[5] The same protection covers a player who left, and a remote that is missing fields…');
{
  // A record present locally but NOT remotely (e.g. added on another device and
  // not yet in this snapshot) must not crash the merge or be dropped.
  resetWorld();
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: '2026-08-01T00:00:00Z', data: { cfbp_players: stalePlayers() } }));
  be.primeFromMirror();
  storage.setBackendMode('googleSheets');
  storage.addPlayer({ playerId: 'pX', displayName: 'Newcomer', active: true });
  await be.hydrate();
  assert(storage.getPlayer('pX') && storage.getPlayer('pX').displayName === 'Newcomer',
    'a local-only record with no remote counterpart is kept as-is, not dropped and not crashed on');
  assert(storage.getPlayers().filter(p => p.email).length === 6,
    'and the six remote emails are still restored alongside it');
}
{
  // Legacy shape, BOTH ways it occurs in the Sheet: a record with no `email`
  // key at all (p0/p1), and one carrying an explicitly BLANK email (p2/p3) —
  // which is what the commissioner panel writes when the field is cleared, and
  // what a Sheet cell that was typed into and emptied round-trips as.
  //
  // Both must restore NOTHING and invent NOTHING. CONVENTIONS #10: an absent or
  // empty field must not change behaviour. The two shapes take different
  // branches, so both are exercised deliberately — asserting only the
  // key-absent shape leaves the blank-value branch untested, and a mutation
  // that materialises `email: ''` onto every record passes unnoticed.
  resetWorld({
    cfbp_players: NAMES.map((n, i) => (i < 2
      ? { playerId: `p${i}`, displayName: n, active: true }
      : { playerId: `p${i}`, displayName: n, active: true, email: '', pinHash: '' })),
    cfbp_weeks: [],
  });
  localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: '2026-08-01T00:00:00Z', data: { cfbp_players: stalePlayers() } }));
  be.primeFromMirror();
  storage.setBackendMode('googleSheets');
  storage.setSession('p1', false, true);
  storage.setTheme('texas');
  await be.hydrate();
  const legacy = storage.getPlayers();
  assert(legacy.length === 6, 'a remote with no email/pinHash fields at all merges without throwing');
  assert(!('email' in legacy.find(p => p.playerId === 'p0')),
    'a remote record with NO email key leaves the local record with no email key — absent stays absent');
  assert(!('email' in legacy.find(p => p.playerId === 'p2')) && !('pinHash' in legacy.find(p => p.playerId === 'p2')),
    'a remote record with an explicitly BLANK email/pinHash does not materialise those fields locally either — blank is nothing to restore, not something to copy');
  assert(legacy.every(p => !p.email && !p.pinHash),
    'and no record ends up with a truthy email or pinHash invented from a blank remote');
  // Fixture check: p2 genuinely has no PIN in this scenario, so the blank-field
  // branch really is the one under test.
  //
  // This assertion used to read `verifyPlayerPin('p2','anything') === true` —
  // it proved the fixture by exercising the fail-open bypass, which meant a
  // green synctest was DEFENDING RG-40: the change that closed the bypass
  // turned this line red and read as a regression. Same trap [34e] in
  // loadtest.mjs documents. Rewritten to establish the same fact from the
  // record itself, so it stays a fixture check and stops being a hostage.
  assert(storage.hasPlayerPin('p2') === false && storage.verifyPlayerPin('p2', 'anything') === false,
    'fixture check: p2 genuinely has no PIN set in this scenario — and with no hash the account now rejects everything rather than accepting anything (RG-40)');
  assert(storage.getPlayer('p1').preferences.theme === 'texas', 'the local preference still applies');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n══════════════════════════════════════════════════');
if (fail === 0) console.log(`✅ ALL PASS — ${pass} passed, 0 failed`);
else { console.error(`❌ FAILURES — ${pass} passed, ${fail} failed`); process.exitCode = 1; }
