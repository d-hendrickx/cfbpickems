/**
 * CFB Pickems — picksviewtest.mjs (Deployment 1, Lane B, DI-611 … DI-614, PF-457 "Show picks", security C2 C3 C4 C5 C6 C7 S1 S2, 2026-10-08)
 * ==========================================================================================================================================
 * By person | By team: the preference, the ONE gate that decides whether another member's pick may be drawn, and the ONE renderer that draws it. The blind rule is the point of this file.
 *
 *   [1] The preference: defaults (Dashboard By person, Game Day By team), junk refused, signed out reads the default and writes nothing, where it is stored (the player record only), the two places independent
 *   [2] THE GATE (`pickVisibilityFor`) in every state: public / hidden / none, the exact return shapes (the hidden one carries NO other member's side), Open / Locked / derived-locked / Live / Final,
 *       signed out, a non-entrant (C7), another week (C2), supabase with the rows not landed (S-C10), an unconfigured gate (fails closed), a non-entrant's pick and a late joiner (C4), hostile input
 *   [3] THE RENDERER (`picksRowHTML`): it takes NO picks; the blind form is the same whatever the view says; no cluster, no per-side count and no split caption in ANY non-public state, in ALL THREE forms,
 *       including the fixture where every member picked the same side (S2); the split caption only in the panel form, only in a public week; escaping (C5): hostile names in text, aria-label and title,
 *       and a renderer that REFUSES to run without its escaper
 *   [4] Parity of facts: the same (member, team) pairs in By team as in By person
 *   [5] The default is byte-identical: the Dashboard's compact row, run through the app's own renderDashboardCompact on ten leagues, equals the output of the Home branch (tests/golden/dashboard-chips.json), the
 *       one allowed difference being the `data-game-id` the row now carries
 *   [6] Who may hold another member's pick (S1): the import scan over the Lane B modules, with canaries that must be caught
 *   [7] MUTATION PROOFS: twelve bypasses applied to a scratch copy of the tree, each of which must turn this suite red (the blind rule is not protected by a source-order scan);\n *       [7b] two more (the gate forced public; a commissioner-only bypass) run against a CLONE of the checkout, where loadtest.mjs's [34h-D1] surface sweep must go red on its own assertions (security F2.4)
 *
 * Run:  node picksviewtest.mjs          (PVT_ROOT=/path/to/a/tree runs it against that tree; PVT_CORE=1 skips [7], which a mutation run uses so it cannot recurse)
 */
import { readFileSync, existsSync, mkdirSync, cpSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.PVT_ROOT ? process.env.PVT_ROOT.replace(/\/?$/, '/') : HERE;
const ROOT_URL = pathToFileURL(ROOT).href;
const CORE_ONLY = process.env.PVT_CORE === '1';
const imp = (rel) => import(new URL(rel, ROOT_URL).href);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => { if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); } };

// ── the world: the same stubs d1wiringtest uses, over the tree under test ───────────────────────────────────────────────
const { MiniDocument } = await imp('./minidom.mjs');
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { writes.push(k); store.set(k, String(v)); }, removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
const writes = [];
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = (fn) => fn(); globalThis.matchMedia = () => ({ matches: false });
globalThis.fetch = async () => { throw new Error('network disabled in picksviewtest'); };
const INDEX = read('./index.html');
const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
{ const doc = new MiniDocument(); doc.body.innerHTML = bodyHtmlOf(INDEX); globalThis.document = doc; }
const rw = console.warn, ri = console.info, re = console.error;
console.warn = console.info = () => {};
const app = await imp('./js/app.js');
const storage = await imp('./js/storage.js');
const chips = await imp('./js/pick-chips.js');
const groups = await imp('./js/pick-groups.js');
const ENV = await imp('./picksviewenv.mjs');
console.warn = rw; console.info = ri; console.error = re;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const numHtml = (n) => String(n);
const { leagueOf, seedLeague, RIVAL_CANARY } = ENV;
const rosterOf = (L) => L.players.map((p) => ({ ...p, active: true }));
const gameOf = (L, i = 0) => L.games[i];
const row = (L, o = {}) => groups.picksRowHTML({ game: o.game || gameOf(L, o.i || 0), week: o.week || L.week, entrants: o.entrants || rosterOf(L), viewerId: o.viewer === undefined ? 'p1' : o.viewer, view: o.view || 'team', form: o.form || 'panel', escHtml: esc, numHtml });
const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const setMode = (m) => storage.setBackendMode(m);
const gate = (L, o = {}) => chips.pickVisibilityFor({ game: o.game || gameOf(L, o.i || 0), week: o.week || L.week, viewerId: o.viewer === undefined ? 'p1' : o.viewer, entrants: o.entrants || rosterOf(L) });
const reseed = (kind, o = {}, s = {}) => { const L = leagueOf(kind, o); seedLeague(storage, L, { viewer: s.viewer === undefined ? 'p1' : s.viewer, admin: !!s.admin, logoView: !!s.logoView }); app._ensurePickModulesForTest(); return L; };

// ═══ [1] The preference ═══════════════════════════════════════════════════════════════════════
_log('\n[1] The preference (DI-611)…');
{
  reseed('live');
  assert(storage.getPicksView('dashboard') === 'person' && storage.getPicksView('gameday') === 'team', '1a: the defaults — Dashboard By person (what it always was), Game Day By team');
  assert(storage.getPicksView('nonsense') === 'person' && storage.getPicksView(undefined) === 'person' && storage.getPicksView(null) === 'person', '1b: an unknown place reads as the Dashboard\'s default (never throws)');
  writes.length = 0;
  assert(storage.setPicksView('dashboard', 'team') === true && storage.getPicksView('dashboard') === 'team' && storage.getPicksView('gameday') === 'team', '1c: setting the Dashboard to By team writes it and leaves Game Day alone');
  assert(storage.setPicksView('gameday', 'person') === true && storage.getPicksView('gameday') === 'person' && storage.getPicksView('dashboard') === 'team', '1d: the two places are independent (Game Day to By person leaves the Dashboard on By team)');
  const bad = [['dashboard', 'everyone'], ['dashboard', ''], ['dashboard', null], ['dashboard', undefined], ['dashboard', { a: 1 }], ['dashboard', '__proto__'], ['nowhere', 'team'], [undefined, 'team'], ['__proto__', 'team'], ['gameday', 'TEAM']];
  assert(bad.every(([p, v]) => storage.setPicksView(p, v) === false) && storage.getPicksView('dashboard') === 'team' && storage.getPicksView('gameday') === 'person', `1e: ${bad.length} junk (place, value) pairs are REFUSED and change nothing`);
  const rec = storage.getPlayer('p1');
  assert(rec && rec.preferences && rec.preferences.picksViewDashboard === 'team' && rec.preferences.picksViewGameDay === 'person', '1f: it lives on the PLAYER RECORD (preferences.picksViewDashboard / picksViewGameDay), so it follows the member across devices');
  const keys = [...store.keys()].filter((k) => /pick.*view|picksview|show.?picks/i.test(k));
  assert(keys.length === 0 && !JSON.stringify(storage.getSettings ? storage.getSettings() : {}).match(/picksView/i) && new Set(writes).size === 1 && writes[0] === 'cfbp_players', `1g: no key of its own and nothing in the league-shared settings: the only key written was ${[...new Set(writes)].join(',')}`);
  storage.clearSession(); writes.length = 0;
  assert(storage.getPicksView('dashboard') === 'person' && storage.getPicksView('gameday') === 'team', '1h: signed out, the defaults are read (the stored values belong to a member)');
  assert(storage.setPicksView('dashboard', 'team') === false && writes.length === 0, '1i: signed out, a write is refused and nothing is persisted (UN-127: a shared handset)');
  const src = read('./js/storage.js');
  const body = src.slice(src.indexOf('export function getPicksView'), src.indexOf('export function setPicksView') + 400);
  assert(/_playerPref\(/.test(body) && /_setPlayerPref\(/.test(body) && !/localStorage/.test(body) && !/getSettings|saveSettings/.test(body), '1j: source — it goes through _playerPref/_setPlayerPref (the storage seam), never localStorage and never the shared settings blob');
}

// ═══ [2] THE GATE ══════════════════════════════════════════════════════════════════════════════
_log('\n[2] THE GATE: pickVisibilityFor in every state…');
{
  const live = reseed('live');
  const g = gate(live, { i: 1 });
  assert(g.state === 'public' && Array.isArray(g.picks) && g.picks.length === 6 && g.picks.every((p) => ['away', 'home', 'none'].includes(p.side)) && Object.keys(g).sort().join() === 'picks,state', '2a: a LIVE week is public: one entry per ENTRANT, each side away | home | none, and nothing else in the return');
  assert(g.picks.find((p) => p.playerId === 'p1').side === 'away' && g.picks.find((p) => p.playerId === 'p3').side === 'home', '2b: …and the sides are the stored picks (x2: p1 away, p3 home)');
  const open = reseed('open');
  const h = gate(open);
  assert(h.state === 'hidden' && Object.keys(h).sort().join() === 'own,state,submitted' && Object.keys(h.own).join() === 'side' && h.own.side === 'away' && h.submitted.join() === 'p2,p3,p4,p5,p6',
    `2c: an OPEN week the viewer has submitted is HIDDEN: exactly { state, own: { side }, submitted: [ids] } — the viewer's own side and WHO is in, no one else's side (got ${JSON.stringify(h)})`);
  const flat = JSON.stringify(h);
  assert(!/home|away/.test(flat.replace('"side":"away"', '')) && !/"picks"/.test(flat), '2d: …and the structure contains no other side and no picks list for a renderer to find, even by mistake');
  assert(gate(reseed('locked'), { viewer: 'p6' }).state === 'hidden' && gate(reseed('derivedLocked')).state === 'hidden', '2e: LOCKED and DERIVED-LOCKED (open on the clock, past its lock instant) are hidden too: only a LIVE or FINAL week is public');
  assert(gate(reseed('final'), { viewer: 'p4' }).state === 'public', '2f: a FINAL week is public');
  const partial = reseed('open', { noPicksFor: ['p5'] });
  assert(gate(partial, { viewer: 'p2' }).submitted.join() === 'p1,p3,p4,p6', '2g: a member who has not submitted is not in the "who is in" list');
  assert(gate(reseed('open', { noPicksFor: ['p1'] }), { viewer: 'p1' }).state === 'none' && gate(reseed('locked', { noPicksFor: ['p1'] }), { viewer: 'p1' }).state === 'none', '2h: a viewer who has NOT submitted gets nothing (the caller says "Submit your picks to see who is in")');
  assert(gate(reseed('open'), { viewer: null }).state === 'none' && gate(reseed('locked'), { viewer: null }).state === 'none', '2i: signed out, in a week that is not public: nothing');
  assert(gate(reseed('live'), { viewer: null }).state === 'public' && gate(reseed('final'), { viewer: null }).state === 'public', '2j: signed out, in a public week: public (the week is public to everyone)');
  // C7
  for (const kind of ['open', 'locked', 'live', 'final']) {
    const L = reseed(kind, {}, { viewer: 'p1' });
    const v = gate(L, { entrants: rosterOf(L).filter((p) => p.playerId !== 'p1') });
    assert(v.state === 'none', `2k-${kind}: C7 — a signed-in member who is NOT an entrant of that game's sport gets nothing in a ${kind} week (plain scores only, before and after reveal)`);
  }
  // C2
  const live2 = reseed('live');
  const otherWeek = { ...live2.week, weekId: 'someOtherWeek' };
  assert(gate(live2, { week: otherWeek }).state === 'none', '2l: C2 — a game is asked about ITS OWN week: another week\'s record answers nothing');
  // two weeks in one world: CFB live, NFL locked (the mixed card)
  {
    const A = leagueOf('live', { weekId: 'wA' }), B = leagueOf('locked', { weekId: 'wB' });
    seedLeague(storage, A, { viewer: 'p1' });
    storage.saveWeek(B.week); B.games.forEach((x, i) => storage.saveGame({ ...x, gameId: 'n' + (i + 1) })); storage.saveAllPicks([...A.picks, ...B.picks.map((p) => ({ ...p, pickId: 'b' + p.pickId, gameId: 'n' + p.gameId.slice(1) }))]);
    const gA = gate(A, { i: 1 }), gB = chips.pickVisibilityFor({ game: { ...B.games[0], gameId: 'n1' }, week: B.week, viewerId: 'p1', entrants: rosterOf(B) });
    assert(gA.state === 'public' && gB.state === 'hidden', '2m: C2 — CFB LIVE and NFL LOCKED in one world: each game gets ITS week\'s answer (public for the live game, hidden for the locked one) — never the card\'s first live week');
  }
  // S-C10 supabase
  {
    const L = reseed('live');
    setMode('supabase');
    chips._resetPickGateForTest();
    assert(gate(L, { i: 1 }).state === 'none', '2n: supabase mode with an UNCONFIGURED gate fails CLOSED: a public week is not drawn (nothing confirms the rows landed)');
    chips.configurePickGate({ picksReadConfirmed: () => false, submissionStateFor: () => 'yes' });
    assert(gate(L, { i: 1 }).state === 'none', '2o: S-C10 — supabase, the week reads public but the other rows have NOT landed: nothing (not the blind form either)');
    chips.configurePickGate({ picksReadConfirmed: (id) => id === L.weekId, submissionStateFor: () => 'yes' });
    assert(gate(L, { i: 1 }).state === 'public', '2p: …and once the adapter confirms THAT week\'s rows, it is public');
    chips.configurePickGate({ picksReadConfirmed: () => { throw new Error('adapter down'); }, submissionStateFor: () => { throw new Error('adapter down'); } });
    assert(gate(L, { i: 1 }).state === 'none', '2q: an adapter that THROWS is a refusal, never a reveal');
    const O = reseed('open'); setMode('supabase');
    chips.configurePickGate({ picksReadConfirmed: () => false, submissionStateFor: (w, p) => (p === 'p5' ? 'no' : p === 'p6' ? 'unknown' : 'yes') });
    const sh = gate(O);
    assert(sh.state === 'hidden' && sh.submitted.join() === 'p2,p3,p4', `2r: supabase, Open: "who is in" is the adapter's rule ('no' and 'unknown' are not in): ${sh.submitted.join()}`);
    setMode('local'); app._ensurePickModulesForTest();
    chips.configurePickGate({ picksReadConfirmed: (id) => app && false, submissionStateFor: () => 'yes' }); chips._resetPickGateForTest();
  }
  // C4
  {
    const L = reseed('live');
    const stray = [...L.picks, { pickId: 'pk_stray', weekId: L.weekId, gameId: 'x2', playerId: 'pX', selectedTeam: 'Georgia' }];
    storage.saveAllPicks(stray);
    const vis = gate(L, { i: 1 });
    assert(vis.picks.length === 6 && !vis.picks.some((p) => p.playerId === 'pX'), '2s: C4 — a NON-entrant\'s pick (pX is in the picks table, not in the roster) changes no entry: the roster is the entrants\', never the picks\' authors');
    const late = rosterOf(L).filter((p) => p.playerId !== 'p6');
    assert(gate(L, { i: 1, entrants: late }).picks.length === 5 && !gate(L, { i: 1, entrants: late }).picks.some((p) => p.playerId === 'p6'), '2t: C4 — a late joiner (not on that week\'s roster) is absent from it, picks or no picks');
    assert(gate(L, { i: 1, entrants: late }).state === 'public', '2u: …and the rest of the roster still sees the public week');
  }
  // hostile input
  const nope = [undefined, null, {}, { game: null }, { game: {}, week: {} }, { game: { gameId: 'x', weekId: 'w' }, week: { weekId: 'w' }, entrants: 'nope' }, { game: { gameId: 5, weekId: 'w' }, week: { weekId: 'w' } }, { game: 'x', week: 'y' }];
  assert(nope.every((a) => { try { return chips.pickVisibilityFor(a).state === 'none' || chips.pickVisibilityFor(a).state === 'hidden'; } catch { return false; } }), '2v: hostile or missing input never throws and never reveals (nothing, or at most the empty blind form)');
  assert(nope.every((a) => { try { const r = chips.pickVisibilityFor(a); return r.state !== 'public'; } catch { return false; } }), '2w: …and is never public');
}

// ═══ [3] THE RENDERER ═════════════════════════════════════════════════════════════════════════
_log('\n[3] THE RENDERER: the blind form, no figure before the gate, escaping, refusal…');
{
  const rnd = groups.picksRowHTML.toString();
  assert(!/\bpicks\b\s*[,}=]/.test(rnd.slice(0, rnd.indexOf('{', rnd.indexOf('{') + 1) + 120).split('=>')[0]) && !/function picksRowHTML\([^)]*\bpicks\b/.test(rnd), '3a: SIGNATURE — picksRowHTML takes no `picks` (the destructured parameter list names game, week, entrants, viewerId, view, form, escHtml, numHtml and nothing else)');
  const sigOf = read('./js/pick-groups.js').match(/export function picksRowHTML\(\{([^}]*)\}/)[1].split(',').map((s) => s.trim());
  assert(sigOf.join() === 'game,week,entrants,viewerId,view,form,escHtml,numHtml', `3b: …exactly: ${sigOf.join(', ')}`);
  const throws = (fn) => { try { fn(); return false; } catch (e) { return e instanceof TypeError; } };
  const L0 = reseed('live');
  assert(throws(() => groups.picksRowHTML({ game: L0.games[1], week: L0.week, entrants: rosterOf(L0), viewerId: 'p1', view: 'team', form: 'panel', numHtml })) && throws(() => groups.picksRowHTML({ game: L0.games[1], week: L0.week, entrants: rosterOf(L0), viewerId: 'p1', view: 'team', form: 'panel', escHtml: esc })) && throws(() => groups.picksRowHTML({ game: L0.games[1], week: L0.week, entrants: rosterOf(L0), viewerId: 'p1', view: 'team', form: 'panel', escHtml: 'nope', numHtml })),
    '3c: C5 — it REFUSES to run without its escaper or numHtml (a TypeError, no `typeof escHtml` fallback)');
  // the blind form, every form, every view, every non-public state
  const FORMS = ['dash', 'card', 'panel'], VIEWS = ['person', 'team'];
  for (const kind of ['open', 'locked', 'derivedLocked']) {
    const L = reseed(kind);
    for (const form of FORMS) {
      const htmls = VIEWS.map((view) => row(L, { form, view, i: 0 }));
      assert(htmls[0] === htmls[1] && htmls[0].length > 0, `3d-${kind}-${form}: the BLIND form is the same whatever the view says (By person and By team are byte-identical in a ${kind} week)`);
      const html = htmls[0];
      assert(!/pg-cluster|pg-split|pg-label/.test(html) && !/\b\d+ on \w/.test(strip(html)) && !/\bNo pick\b/.test(strip(html)), `3e-${kind}-${form}: S2 — no cluster, no split caption, no per-side count, no "No pick" group before the reveal`);
      assert(!/>OU<|>OKLA</i.test(html) && (html.match(/•••/g) || []).length === 5 && /TEX/.test(strip(html)), `3f-${kind}-${form}: the viewer's own pick (TEX) is named and the five others are "•••": nobody else's team appears (the home side, picked only by p4 and p6, is absent)`);
    }
  }
  // the same-side fixture: every member picked the same side. A per-side count would read "6 on TEX" and give the whole slate away.
  for (const kind of ['open', 'locked', 'derivedLocked']) {
    const L = reseed(kind);
    storage.saveAllPicks(L.picks.map((p) => (p.gameId === 'x1' ? { ...p, selectedTeam: 'Texas' } : p)));
    for (const form of FORMS) for (const view of VIEWS) {
      const html = row(L, { form, view });
      assert(!/\b6 on\b|\b5 on\b|\bon TEX\b|\bon OU\b/.test(strip(html)) && !/pg-cluster|pg-split/.test(html) && !/>OU</.test(html), `3g-${kind}-${form}-${view}: S2 same-side fixture (all six on TEX): no "6 on TEX", no cluster, no split caption`);
    }
  }
  // the public forms
  const P = reseed('live');
  const person = { dash: row(P, { form: 'dash', view: 'person', i: 1 }), card: row(P, { form: 'card', view: 'person', i: 1 }), panel: row(P, { form: 'panel', view: 'person', i: 1 }) };
  const team = { dash: row(P, { form: 'dash', view: 'team', i: 1 }), card: row(P, { form: 'card', view: 'team', i: 1 }), panel: row(P, { form: 'panel', view: 'team', i: 1 }) };
  assert(/data-picks-view="team"/.test(team.dash) && /pg-cluster/.test(team.dash) && /^<div class="pg-row pg-row--dash"/.test(team.dash) && /^<span class="pg-row pg-row--card"/.test(team.card) && /^<div class="pg-row pg-row--panel"/.test(team.panel), '3h: By team in a public week groups under the team picked, in three forms (a div for the Dashboard and the panel, a span for the open card whose row is a <button>)');
  assert(/pg-split/.test(team.panel) && !/pg-split/.test(team.dash) && !/pg-split/.test(team.card) && !/pg-split/.test(person.dash) && !/pg-split/.test(person.card) && /pg-split/.test(person.panel), '3i: the split caption "{a} on TEX · {b} on UGA" exists only in the PANEL form, and only in a public week');
  assert(/\b4 on GEO?R?|\b\d on \w+ · \d on \w+/.test(strip(team.panel)) && ['2', '4'].every((n) => new RegExp(`\\b${n} on `).test(strip(team.panel))), `3j: …and its figures are the roster's (${(strip(team.panel).match(/\d on \w+ · \d on \w+/) || [''])[0]})`);
  assert(/aria-label="Georgia[^"]*: /.test(team.dash) && /aria-label="Alabama[^"]*: /.test(team.dash) && /role="group"/.test(team.dash), '3k: each cluster is a group named for VoiceOver with the team, its result word and the members: "Georgia, covering: Drew, Brayden, Kihoon"');
  const L1 = reseed('live', { noPicksFor: ['p4'] });
  assert(/No pick: Koby/.test(row(L1, { view: 'team', form: 'dash', i: 0 })) && /pg-cluster--none/.test(row(L1, { view: 'team', form: 'dash', i: 0 })), '3l: a member with no pick sits in a muted "No pick" cluster');
  // none state
  const O = reseed('open', { noPicksFor: ['p1'] });
  assert(row(O, { viewer: 'p1' }) === '' && row(reseed('live'), { viewer: 'p1', entrants: rosterOf(L0).filter((p) => p.playerId !== 'p1') }) === '', '3m: the gate says nothing -> the row is "" (the caller says why in its own words): not submitted, and a non-entrant (C7)');
  assert(groups.picksRowHTML({ game: null, week: null, escHtml: esc, numHtml }) === '' && groups.picksRowHTML({ escHtml: esc, numHtml }) === '', '3n: a missing game or week is "" (never throws)');
  // entrants only
  const E = reseed('live');
  storage.saveAllPicks([...E.picks, { pickId: 'pk_stray', weekId: E.weekId, gameId: 'x2', playerId: 'pX', selectedTeam: 'Georgia' }]);
  const without = rosterOf(E).filter((p) => p.playerId !== 'p6');
  assert(!/pX|\bX\b/.test(row(E, { view: 'team', form: 'dash', i: 1 })) && !/Kihoon/.test(row(E, { view: 'team', form: 'dash', i: 1, entrants: without })) && /No pick|pg-cluster/.test(row(E, { view: 'team', form: 'dash', i: 1, entrants: without })),
    '3o: C4 — By team lists the ENTRANTS only: a stray pick by a non-member appears nowhere, and a member outside the roster is in no cluster and no "No pick" group');
  // escaping
  const H = reseed('live', { hostile: true });
  const hostiles = [];
  for (const form of FORMS) for (const view of VIEWS) hostiles.push(row(H, { form, view, i: 1 }));
  const names = (h) => [...h.matchAll(/<[a-z][^>]*>/gi)].flatMap((m) => [...m[0].replace(/"[^"]*"/g, '""').matchAll(/\s([a-z-]+)(?==|\s|>|$)/gi)].map((a) => a[1].toLowerCase()));
  assert(hostiles.every((h) => !/<img/i.test(h) && !/<b>/.test(h) && !names(h).some((n) => n.startsWith('on') || n === 'src')) && hostiles.every((h) => /&lt;img src=x onerror=alert\(1\)&gt;|&lt;b&gt;/.test(h)), `3p: C5 — a hostile display name and initials come out inert in text, aria-label and title, in every form and view (${hostiles.length} renders)`);
  const hb = reseed('open', { hostile: true });
  const blindHostile = FORMS.map((form) => row(hb, { form, view: 'team' }));
  assert(blindHostile.every((h) => !/<img/i.test(h) && !names(h).some((n) => n.startsWith('on') || n === 'src')) && blindHostile.some((h) => /aria-label="[^"]*&lt;img/.test(h) || /title="[^"]*&lt;img/.test(h)), '3q: …and in the blind form\'s aria-label and title as well');
  const unquoted = [...hostiles, ...blindHostile].flatMap((h) => [...h.matchAll(/<[a-z][^>]*>/gi)].map((m) => m[0]).filter((t) => /\s[a-z-]+=[^"'\s>]/i.test(t.replace(/"[^"]*"/g, '""'))));
  assert(unquoted.length === 0, '3r: every attribute is double-quoted');
  void RIVAL_CANARY;
}

// ═══ [4] Parity of facts ═══════════════════════════════════════════════════════════════════════
_log('\n[4] Parity: the same members and the same picks in By team as in By person…');
{
  const L = reseed('live');
  const abbrOf = (html) => [...html.matchAll(/class="dc-chip[^"]*"[^>]*data-player-id="(p\d)"[^>]*><span class="dc-chip-init">([^<]*)<\/span><span class="dc-chip-pick">([^<]*)</g)].map((m) => `${m[1]}:${m[3].replace(/[▲▽✓✗—\s]/g, '')}`).sort();
  for (let i = 0; i < 3; i++) {
    const byPerson = abbrOf(row(L, { form: 'dash', view: 'person', i }));
    const t = row(L, { form: 'dash', view: 'team', i });
    const pairs = [];
    for (const m of t.matchAll(/<span class="pg-cluster[^"]*" role="group" aria-label="([^"]*)"><b class="pg-label" aria-hidden="true">([^<]*)<\/b>((?:<span class="pg-ini[^"]*" aria-hidden="true">[^<]*<\/span>)*)<\/span>/g)) {
      if (/No pick/.test(m[2])) continue;
      const label = m[2].replace(/[▲▽✓✗—\s]/g, '');
      const inis = [...m[3].matchAll(/>([^<]*)<\/span>/g)].map((x) => x[1]);
      for (const ini of inis) { const p = L.players.find((q) => q.initials === ini); pairs.push(`${p.playerId}:${label}`); }
    }
    assert(byPerson.length === 6 && pairs.sort().join() === byPerson.join(), `4-${i}: game ${L.games[i].gameId}: the (member, team) pairs By team equal By person's — ${pairs.length} pairs, ${byPerson.length} chips`, `${pairs.join()} vs ${byPerson.join()}`);
  }
  // the results agree: the cover mark on a team's label is the one its members' chips carry
  const t = row(L, { form: 'dash', view: 'team', i: 0 });
  const p = row(L, { form: 'dash', view: 'person', i: 0 });
  assert(/pg-cluster--(win|los|nd)/.test(t) && /dc-chip-(win|loss|nd)/.test(p), '4-r: a finished game carries its result in both presentations (✓ / ✗ on the team label; on each chip)');
}

// ═══ [5] The default is byte-identical ═════════════════════════════════════════════════════════
_log('\n[5] The default (By person) is byte-identical to the Home branch\'s Dashboard row…');
{
  const gold = JSON.parse(read('./tests/golden/dashboard-chips.json')).fixtures;
  const mine = ENV.dashFixtures({ app, storage });
  assert(gold.length === 10 && mine.length === 10 && gold.every((g, i) => g.name === mine[i].name), `5a: ten fixtures (live, Team logos, no pick, hostile names, open, open with one not in, locked, derived-locked, final, signed out)`);
  const allowed = (h) => h.replace(/<div class="dc-game" data-game-id="x\d">/g, '<div class="dc-game">');
  assert(gold.every((g, i) => g.html === allowed(mine[i].html)), '5b: the whole row markup equals the golden, the ONE allowed difference being the data-game-id the game row now carries (the FLIP needs it)', gold.map((g, i) => (g.html === allowed(mine[i].html) ? '' : g.name)).filter(Boolean).join(' | '));
  assert(mine.every((m) => (m.html.match(/<div class="dc-game" data-game-id="x\d">/g) || []).length === 3), '5c: …exactly once per game row');
  const chipsOf = (h) => [...h.matchAll(/<div class="dc-chips">([\s\S]*?)<\/div>(?=\s*<\/div>)/g)].map((m) => m[1]).join('|');
  assert(gold.some((g) => chipsOf(g.html).length > 400) && gold.every((g, i) => chipsOf(g.html) === chipsOf(mine[i].html)), '5d: …and the CHIPS themselves (the part that carries the blind rule) are identical, with no stripping at all');
  assert(mine[4].html.includes('dc-chip-blind') && !mine[4].html.includes('dc-chip-win') && mine[0].html.includes('dc-chip-live') && !mine[0].html.includes('dc-chip-blind'), '5e: (fixture) an open week draws blind chips; the live week does not');
}

// ═══ [6] Who may hold another member's pick (S1) ═══════════════════════════════════════════════
_log('\n[6] Who may hold another member\'s pick: the import scan over the Lane B modules…');
{
  const RAW = ['getPicks', 'getPicksForWeek', 'getAllPicks', 'getPicksFor', 'allPicks', 'getAllWeeklyResults', 'loadPicks', 'getPicksByPlayer', 'getPlayerPicks'];
  const importsOf = (src) => [...src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/import\s+(?:\*\s+as\s+(\w+)|\{([^}]*)\}|(\w+))\s+from\s+['"]([^'"]+)['"]/g)].map((m) => ({ from: m[4], names: (m[2] || m[1] || m[3] || '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean), star: !!m[1] }));
  const offenders = (src, self) => importsOf(src).flatMap((i) => (i.star && /storage\.js|app\.js/.test(i.from) ? [`${self}: namespace import of ${i.from}`] : i.names.filter((n) => RAW.includes(n)).map((n) => `${self}: ${n} from ${i.from}`)));
  const SAFE = ['js/pick-groups.js', 'js/gameday.js', 'js/gameday-sheet.js', 'js/game-view.js', 'js/game-sort.js', 'js/game-arrange.js', 'js/keyed-list.js', 'js/gameday-dom.js'];
  const found = SAFE.flatMap((f) => offenders(read('./' + f), f));
  assert(found.length === 0, `6a: none of ${SAFE.length} Lane B modules (the Game Day model, the open body, the DOM half, the Game view, the By team renderer, the sort and arrange modules, keyed-list) imports a raw pick reader or a namespace of the storage seam${found.length ? ': ' + found.join(' | ') : ''}`);
  const gi = importsOf(read('./js/pick-groups.js')).map((i) => i.from).sort();
  assert(gi.join() === './data-model.js,./pick-chips.js,./scoring.js', `6b: pick-groups.js imports ONLY ./pick-chips.js (the gate), ./scoring.js and ./data-model.js (got ${gi.join()}): another member's pick reaches it only as the gate's return value`);
  const holders = ['js/pick-chips.js'].filter((f) => importsOf(read('./' + f)).some((i) => i.names.includes('getPicks')));
  assert(holders.join() === 'js/pick-chips.js' && importsOf(read('./js/pick-chips.js')).find((i) => i.from === './storage.js').names.includes('getPicks'), '6c: the ONE Lane B module that imports the raw reader is the chip-helper module (the gate)');
  const gdm = importsOf(read('./js/gameday.js'));
  assert(gdm.length === 0, '6d: the Game Day model (js/gameday.js) imports NOTHING: plain data in, plain JSON out');
  const body = importsOf(read('./js/gameday-sheet.js')).map((i) => i.from).sort();
  // (fix round 2, DI-605 line 1 / PF-446: the rows draw the shared team lockup — keyed-list.js, a pure leaf with no imports at all, on the SAFE list above)
  assert(['./keyed-list.js,./pick-groups.js', './pick-groups.js', ''].includes(body.join()) && importsOf(read('./js/keyed-list.js')).length === 0, `6e: the open body imports only the By team renderer and the team lockup (a leaf that imports nothing) (got ${body.join() || 'nothing'})`);
  // canaries: the scanner must catch each shape
  const canaries = [
    ["import { getPicks } from './storage.js';", 'a raw reader from the storage seam'],
    ["import { loadPicks as lp, getPicks as gp } from './storage.js';", 'an aliased reader'],
    ["import * as S from './storage.js';", 'a namespace import of the seam'],
    ["import { getAllPicks } from './app.js';", 'a reader from app.js'],
  ];
  for (const [src, what] of canaries) assert(offenders(src, 'canary').length >= 1, `6f: the scan CATCHES ${what}`);
  assert(offenders("import { escHtml } from './x.js';\nimport { evaluatePick } from './scoring.js';", 'ok').length === 0, '6g: …and passes a clean import list (it is not vacuous in the other direction)');
  // the whole tree: who else imports getPicks in the Lane B family of files
  const treeHolders = SAFE.concat(['js/pick-groups.js', 'js/pick-chips.js']).filter((f, i, a) => a.indexOf(f) === i && importsOf(read('./' + f)).some((x) => x.names.includes('getPicks')));
  assert(treeHolders.join() === 'js/pick-chips.js', `6h: across the Lane B modules, exactly one holds the reader (${treeHolders.join()})`);
  // the participation scan (C4/A3), widened (security F1, fix round 1) to the SAME pattern participationtest.mjs (the Lane A branch) uses: ANY variable name, `p => p.active`, `p => p && p.active`, `(p) => ...`, on any
  // list. Every Lane B module that could build a roster is scanned — the Game Day model and its open body included — and the canaries prove each spelling is seen.
  const strip2 = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"\\/])\/\/[^\n]*/g, (m, p) => p + ' '.repeat(m.length - p.length));
  const ACTIVE_ROSTER = /\.filter\(\s*\(?\s*([A-Za-z_$][\w$]*)\s*\)?\s*=>\s*\1\s*(?:&&\s*\1\.active\b|\.active\b)/;
  const scan = (src) => ACTIVE_ROSTER.test(strip2(src));
  const SCANNED = [...new Set(SAFE.concat(['js/pick-groups.js', 'js/pick-chips.js']))];
  const roster = SCANNED.filter((f) => scan(read('./' + f)));
  assert(SCANNED.includes('js/gameday.js') && SCANNED.includes('js/gameday-sheet.js') && roster.length === 0, `6i: C4 — none of the ${SCANNED.length} Lane B modules (gameday.js and gameday-sheet.js among them) builds a roster from the ACTIVE players, whatever the variable is called (the entrants come from the caller)${roster.length ? ': ' + roster.join() : ''}`);
  assert(scan('const roster = players.filter(p => p && p.active);') && scan('players.filter((p) => p && p.active)') && scan('getPlayers().filter(p=>p.active)') && scan('list.filter(q=>q&&q.active)') && !scan('entrants.filter(p => p && isId(p.playerId))') && !scan('// players.filter(p => p.active)\nconst x = 1;'), '6j: …and that pattern really is caught (canaries: four spellings, two lists), while the entrants filter and a spelling that sits only in a comment are not flagged');

  // security F1 (fix round 1) — THE LANE A MERGE TRIPWIRE. Until the sports branch lands, a league has ONE sport and `entrantsForWeek` (app.js) answers "every active player", which is exactly what Lane A's
  // `playersForWeek(week)` would answer. The moment js/competition.js EXPORTS `playersForWeek`, three things must be true or this goes red at the merge: (1) `entrantsForWeek`'s body CALLS it and no longer filters the
  // active players itself; (2) `submissionCountsFor` (js/home.js: "{k} of {n} picked", the Open card's count) counts from the week's entrants, not from the league-wide active list. Dormant until then — and
  // while dormant it still pins that its anchors exist, so a rename cannot disarm it silently. Do NOT satisfy it by editing it: do the swap.
  const bodyOf = (src, name) => { const m = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\}\\n`).exec(src); return m ? m[0] : null; };
  // (Merge of int, 2026-10-08: the ONE `entrantsForWeek` now lives in js/sport-seam.js, which app.js imports; Lane B's placeholder in app.js was the duplicate and is gone. The tripwire reads the function
  // wherever app.js takes it from — its own body, or the seam's when app.js imports it from './sport-seam.js' — so a rename or a second private copy still cannot hide from it.)
  const seamCall = /\bplayersForWeek\s*\(|\bapi\(\s*'playersForWeek'\s*\)\s*\(/;
  const tripwire = (competitionSrc, appSrc, homeSrc, seamSrc = '') => {
    const out = [];
    const fromSeam = /import\s*\{[^}]*\bentrantsForWeek\b[^}]*\}\s*from\s*'\.\/sport-seam\.js'/.test(strip2(appSrc));
    const ent = bodyOf(strip2(appSrc), 'entrantsForWeek') || (fromSeam ? bodyOf(strip2(seamSrc), 'entrantsForWeek') : null), cnt = bodyOf(strip2(homeSrc), 'submissionCountsFor');
    if (fromSeam && bodyOf(strip2(appSrc), 'entrantsForWeek')) out.push('two: app.js defines its own entrantsForWeek AND imports the seam\'s');
    if (!ent) out.push('anchor: app.js has no function entrantsForWeek');
    if (!cnt) out.push('anchor: home.js has no function submissionCountsFor');
    const armed = /export\s+(?:async\s+)?function\s+playersForWeek\b|export\s+const\s+playersForWeek\b|export\s*\{[^}]*\bplayersForWeek\b[^}]*\}/.test(strip2(competitionSrc));
    if (armed) {
      if (ent && !seamCall.test(ent)) out.push('armed: entrantsForWeek does not call playersForWeek(week)');
      if (ent && ACTIVE_ROSTER.test(ent)) out.push('armed: entrantsForWeek still filters the ACTIVE players itself');
      // (Lane B Game Day round, 2026-10-08: int's form is the one kept — `activeAll`, the active roster, survives ONLY as the one-sport default, and a several-sport league asks `rosterFor(w)`, the week's
      // entrants (homesportstest [8f]/[8g] pin the caller and the default; the active filter ON the week's entrants, `asArray(rosterFor(w)).filter(...)`, narrows them and is allowed). Any OTHER
      // active-roster filter in the function is still the defect.)
      if (cnt && ACTIVE_ROSTER.test(cnt.replace(/const activeAll = players\.filter\(p => p && p\.active\);/, '').replace(/asArray\(rosterFor\(w\)\)\.filter\(p => p && p\.active\)/, ''))) out.push('armed: submissionCountsFor still counts from the league-wide ACTIVE players');
      if (cnt && !/\b(?:rosterFor|entrantsFor|entrantsForWeek|playersForWeek|playersForCompetition)\s*\(/.test(cnt)) out.push('armed: submissionCountsFor does not ask for the week\'s entrants (rosterFor / playersForWeek)');
    }
    return { armed, out };
  };
  {
    const oldEnt = 'function entrantsForWeek(week) {\n  return getPlayers().filter(p => p && p.active);\n}\n', newEnt = 'function entrantsForWeek(week) {\n  return playersForWeek(week);\n}\n';
    const oldCnt = 'function submissionCountsFor({ weeks, players }) {\n  const active = players.filter(p => p && p.active);\n  return active.length;\n}\n', newCnt = 'function submissionCountsFor({ weeks, entrantsFor }) {\n  for (const w of weeks) { const active = entrantsFor(w); void active; }\n}\n';
    const exporting = 'export function playersForWeek(week) { return []; }\n', dormant = 'export function getCompetitions() { return []; }\n';
    assert(tripwire(dormant, oldEnt, oldCnt).armed === false && tripwire(dormant, oldEnt, oldCnt).out.length === 0, '6k: canary — DORMANT: competition.js does not export playersForWeek, the single-sport placeholders are fine');
    const armedOld = tripwire(exporting, oldEnt, oldCnt);
    assert(armedOld.armed && armedOld.out.length === 4, `6l: canary — ARMED with the old bodies: all four defects are reported (no call, a private active-roster filter, a league-wide count, no ask for entrants) (${armedOld.out.length}: ${armedOld.out.map((x) => x.slice(7, 40)).join(' | ')})`);
    assert(tripwire(exporting, newEnt, newCnt).out.length === 0, '6m: canary — ARMED with the swap done (entrantsForWeek calls playersForWeek; submissionCountsFor asks for the week\'s entrants): clean');
    assert(tripwire(exporting, newEnt, oldCnt).out.length >= 1 && tripwire(exporting, oldEnt, newCnt).out.length >= 1, '6n: canary — ARMED with only HALF the swap done: still red (each half is checked on its own)');
    const intCnt = 'function submissionCountsFor({ weeks, players, rosterFor = null }) {\n  const activeAll = players.filter(p => p && p.active);\n  for (const w of weeks) { let active = activeAll; if (rosterFor) active = rosterFor(w); void active; }\n}\n';
    const intNoAsk = 'function submissionCountsFor({ weeks, players }) {\n  const activeAll = players.filter(p => p && p.active);\n  return activeAll.length;\n}\n';
    const intTwo = 'function submissionCountsFor({ weeks, players, rosterFor = null }) {\n  const activeAll = players.filter(p => p && p.active);\n  for (const w of weeks) { let active = rosterFor ? rosterFor(w) : players.filter(q => q && q.active); void active; }\n}\n';
    assert(tripwire(exporting, newEnt, intCnt).out.length === 0 && tripwire(exporting, newEnt, intNoAsk).out.length === 1 && tripwire(exporting, newEnt, intTwo).out.length === 1, '6n-2: canary — int\'s form (the one-sport `activeAll` default plus `rosterFor(w)`) is clean; the default with no roster ask, or a SECOND active filter beside it, is red');
    assert(tripwire(dormant, 'function other() {}\n', oldCnt).out.some((x) => /anchor/.test(x)) && tripwire(dormant, oldEnt, 'function other() {}\n').out.some((x) => /anchor/.test(x)), '6o: canary — a renamed entrantsForWeek or submissionCountsFor is reported (dormant or not): the tripwire cannot be disarmed by a rename');
    assert(tripwire('export { playersForWeek } from "./x.js";\n', oldEnt, oldCnt).armed && tripwire('export const playersForWeek = (w) => [];\n', oldEnt, oldCnt).armed, '6p: canary — an `export { playersForWeek }` and an `export const playersForWeek` arm it as well as `export function`');
    const seamApp = "import { isMultiSportLeague, entrantsForWeek } from './sport-seam.js';\n", seamOk = "export function entrantsForWeek(week) {\n  const r = api('playersForWeek')(week);\n  return Array.isArray(r) ? r : [];\n}\n";
    assert(tripwire(exporting, seamApp, newCnt, seamOk).out.length === 0 && tripwire(exporting, seamApp, newCnt, "export function entrantsForWeek(week) {\n  return getPlayers().filter(p => p && p.active);\n}\n").out.length >= 1 && tripwire(exporting, seamApp + newEnt, newCnt, seamOk).out.some((x) => /^two/.test(x)), '6p-2: canary — the ONE function may live in js/sport-seam.js (imported by app.js): clean when the seam calls playersForWeek, red when the seam filters the active players itself, red when app.js ALSO keeps a private copy');
    const real = tripwire(read('./js/competition.js'), read('./js/app.js'), read('./js/home.js'), read('./js/sport-seam.js'));
    assert(real.out.length === 0, `6q: THE TRIPWIRE on the real tree — ${real.armed ? 'ARMED (js/competition.js exports playersForWeek)' : 'dormant (js/competition.js does not export playersForWeek yet)'}; its anchors exist and nothing is violated${real.out.length ? ': ' + real.out.join(' | ') : ''}`);
  }
}

if (!CORE_ONLY) await mutations();
async function mutations() {
  _log('\n[7] MUTATION PROOFS — twelve bypasses on a scratch copy of the tree; every one must turn this suite red (and [7b], two more against loadtest\'s [34h-D1] sweep)…');
  const tmp = mkdtempSync(join(tmpdir(), 'cfbp-pvt-'));
  const copy = join(tmp, 'cfb-pickems');
  mkdirSync(copy, { recursive: true });
  for (const p of ['js', 'tests/golden', 'index.html', 'minidom.mjs', 'statsfixtures.mjs', 'picksviewenv.mjs', 'picksviewtest.mjs']) {
    if (existsSync(join(ROOT, p))) cpSync(join(ROOT, p), join(copy, p), { recursive: true });
  }
  const file = (rel) => join(copy, rel);
  const original = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const run = () => { const r = spawnSync(process.execPath, [join(copy, 'picksviewtest.mjs')], { cwd: copy, env: { ...process.env, PVT_ROOT: copy, PVT_CORE: '1' }, encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const base = run();
  assert(base.code === 0 && /ALL PASS/.test(base.out), `7-0: POSITIVE CONTROL — the unmutated COPY passes the whole suite (${(base.out.match(/(\d+) passed/) || [])[1]} assertions) in a separate process`, base.out.slice(-600));
  const reds = (out) => [...out.matchAll(/❌ ([^\n]{0,70})/g)].map((m) => m[1]).slice(0, 3);
  const proofs = [];
  const mut = (id, label, rel, edits, also = null) => proofs.push({ id, label, rel, edits, also });
  const GATE = 'js/pick-chips.js', GROUPS = 'js/pick-groups.js';
  mut('M1', 'the public gate is removed: every week reads as public (the Open / Locked / derived-locked renders must go red)', GATE, [["if (isPublic && rowsConfirmed(week.weekId)) {", "if (true) {"]]);
  mut('M2', 'S-C10: the rows-landed check is dropped (a public week draws before the server confirmed it)', GATE, [["if (!supabase) return true;", "return true;"]]);
  mut('M3', 'C2: the gate no longer insists on the game\'s OWN week (the current week answers for any game)', GATE, [["if (game.weekId !== week.weekId) return NONE;", ""]]);
  mut('M4', 'C7: a signed-in non-entrant is let through', GATE, [["if (viewer && !ids.has(viewer)) return NONE;", ""]]);
  mut('M5', 'C4: the roster grows with every author of a pick on the game (a non-entrant / late joiner counts)', GATE, [["const ids = new Set(roster.map(p => p.playerId));", "const ids = new Set(roster.map(p => p.playerId));\n  for (const x of getPicks(week.weekId)) { if (x && !ids.has(x.playerId)) { roster.push({ playerId: x.playerId }); ids.add(x.playerId); } }"]]);
  mut('M6', 'a visibility bypass THREADED THROUGH the render path: the blind return carries every side and the blind chips draw them (an opponent\'s pick reaches the screen)', GATE, [
    ["    submitted: roster.filter(p => p.playerId !== viewer && submittedOf(week.weekId, p.playerId)).map(p => p.playerId),\n  };", "    submitted: roster.filter(p => p.playerId !== viewer && submittedOf(week.weekId, p.playerId)).map(p => p.playerId),\n    picks: roster.map(p => ({ playerId: p.playerId, side: sideOf(onGame.find(x => x.playerId === p.playerId), game) })),\n  };"]]);
  mut('M7', 'S2: the blind panel prints a per-side count', GROUPS, [["return `<div class=\"pg-row pg-row--panel pg-row--blind\" data-picks-view=\"blind\"><div class=\"dc-chips\">${chips}</div><p class=\"pg-cap\">${escHtml(BLIND_CAPTION)}", "const n6 = (vis.picks || []).filter(q => q.side === 'away').length;\n    return `<div class=\"pg-row pg-row--panel pg-row--blind\" data-picks-view=\"blind\"><div class=\"dc-chips\">${chips}</div><p class=\"pg-cap\">${n6} on ${escHtml(abbr(game.awayTeam))} ${escHtml(BLIND_CAPTION)}"]]);
  mut('M8', 'S2: the split caption is printed in every form (the form guard is removed at the callee AND at the By team call site: not only the public panel)', GROUPS, [["if (form !== 'panel' || vis.state !== 'public') return '';", "if (vis.state !== 'public') return '';"], ["${f === 'panel' ? splitCaption(game, vis, byId, abbr, escHtml, numHtml, f) : ''}", "${splitCaption(game, vis, byId, abbr, escHtml, numHtml, f)}"]]);
  mut('M9', 'one gate answer reused for the whole list (memoised on the first game): the second week\'s game gets the first week\'s verdict', GROUPS, [["const vis = pickVisibilityFor({ game, week, viewerId, entrants });", "const vis = (globalThis.__memo = globalThis.__memo || pickVisibilityFor({ game, week, viewerId, entrants }));"]]);
  mut('M10', 'C5: a display name is no longer escaped in a cluster\'s aria-label', GROUPS, [["const names = members.map(p => escHtml(p.displayName)).join(', ');", "const names = members.map(p => String(p.displayName)).join(', ');"]]);
  mut('M11', 'a REAL visibility bypass: the blind return carries every member\'s side AND the blind chips are drawn as if the viewer could see them (a rival\'s pick reaches the served markup)', GATE, [
    ["    submitted: roster.filter(p => p.playerId !== viewer && submittedOf(week.weekId, p.playerId)).map(p => p.playerId),\n  };", "    submitted: roster.filter(p => p.playerId !== viewer && submittedOf(week.weekId, p.playerId)).map(p => p.playerId),\n    picks: roster.map(p => ({ playerId: p.playerId, side: sideOf(onGame.find(x => x.playerId === p.playerId), game) })),\n  };"]],
    { rel: GROUPS, edits: [["lookup: (pid) => (pid === viewerId ? (team(vis.own.side) ? { selectedTeam: team(vis.own.side) } : null) : (vis.submitted.includes(pid) ? { hidden: true } : null)),\n      viewerId, canSeeOthers: false,", "lookup: (pid) => { const q = (vis.picks || []).find(x => x.playerId === pid); return q && team(q.side) ? { selectedTeam: team(q.side) } : null; },\n      viewerId, canSeeOthers: true,"]] });
  // (Retargeted at the merge of int, 2026-10-08: competition.js now exports playersForWeek and the swap is DONE — the one entrantsForWeek is js/sport-seam.js's. The tripwire's job from here on is to keep it
  // done: the mutant puts back the single-sport placeholder body (a private active-roster filter, no call into playersForWeek) and the armed tripwire must go red.)
  mut('M12', 'the Lane A MERGE TRIPWIRE (security F1), post-merge: the ONE entrantsForWeek (js/sport-seam.js) goes back to filtering the ACTIVE players itself instead of calling playersForWeek (the swap undone)', 'js/sport-seam.js', [["  const r = api('playersForWeek')(week);\n  return Array.isArray(r) ? r : [];", "  return storageApi.getPlayers().filter((p) => p && p.active);"]]);
  const results = [];
  for (const m of proofs) {
    writeFileSync(file(m.rel), original(m.rel));
    let src = original(m.rel);
    let applied = true;
    for (const [from, to] of m.edits) { if (!src.includes(from)) { applied = false; break; } src = src.replace(from, to); }
    if (!applied) { assert(false, `7-${m.id}: the mutation APPLIES to the source (its anchor moved: ${m.edits[0][0].slice(0, 60)}…)`); continue; }
    writeFileSync(file(m.rel), src);
    if (m.also) {
      let src2 = original(m.also.rel); let ok2 = true;
      for (const [from, to] of m.also.edits) { if (!src2.includes(from)) { ok2 = false; break; } src2 = src2.replace(from, to); }
      if (!ok2) { writeFileSync(file(m.rel), original(m.rel)); assert(false, `7-${m.id}: the second half of the mutation APPLIES (its anchor moved)`); continue; }
      writeFileSync(file(m.also.rel), src2);
    }
    const r = run();
    writeFileSync(file(m.rel), original(m.rel));                                 // restore from the pristine copy, then prove it is green again below
    if (m.also) writeFileSync(file(m.also.rel), original(m.also.rel));
    results.push([m, r]);
    assert(r.code !== 0 && /❌/.test(r.out), `7-${m.id}: ${m.label} → RED on: ${reds(r.out).join(' | ') || '(nothing!)'}`);
  }
  const again = run();
  assert(again.code === 0 && /ALL PASS/.test(again.out), '7-Z: …and after every restore the copy is GREEN again (the proofs did not leave a mutant behind)');

  // ── 7b: the loadtest [34h-D1] SURFACE SWEEP's own teeth (security F2.4, fix round 1). The sweep lives inline in loadtest.mjs (the core suite): it draws the Dashboard By team row and the three forms of the
  // one renderer in every non-public state, as a player and as the commissioner, and scans the markup for a rival's team. Security ran two mutants of the gate against it by hand; they are encoded here on a
  // CLONE of the whole checkout (the core reads files outside cfb-pickems/), with the core run in the clone and the SWEEP's own assertions required to go red (not "something somewhere").
  _log('\n[7b] The [34h-D1] surface sweep in loadtest.mjs: two gate bypasses, run against a clone of the checkout; its assertions must go red…');
  const { cloneTree } = await import(pathToFileURL(join(HERE, 'tests/lib/tree.mjs')).href);
  const repo = join(HERE, '..');
  const clone = join(tmp, 'tree');
  cloneTree(repo, clone);
  const cc = join(clone, 'cfb-pickems');
  const core = () => { const r = spawnSync(process.execPath, [join(cc, 'loadtest.mjs')], { cwd: cc, env: { ...process.env, CFBP_CORE: 'full' }, encoding: 'utf8', timeout: 240000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const SWEEP = /THE LANE B SURFACE SWEEP/, SC10 = /S-C10 on the Lane B surfaces/;
  const cbase = core();
  assert(cbase.code === 0 && /✅ THE LANE B SURFACE SWEEP/.test(cbase.out) && /✅ S-C10 on the Lane B surfaces/.test(cbase.out), `7b-0: POSITIVE CONTROL — the core suite on the unmutated clone passes and both Lane B sweep assertions are green (${(cbase.out.match(/(\d+) passed/) || [])[1]} assertions)`, cbase.out.slice(-500));
  const sweepMuts = [
    ['M-A', 'the gate is FORCED PUBLIC (every week reads as public to the renderer): the sweep, and the S-C10 check, must go red', [["if (isPublic && rowsConfirmed(week.weekId)) {", "if (true) {"]], [SWEEP, SC10]],
    ['M-B', 'a COMMISSIONER-ONLY bypass (the gate reads a signed-in commissioner as public): the sweep\'s commissioner passes must go red', [["import { arePicksPublic, getPicks, getBackendMode, hasPlayerSubmitted } from './storage.js';", "import { arePicksPublic, getPicks, getBackendMode, hasPlayerSubmitted, getSession } from './storage.js';"], ["try { isPublic = arePicksPublic(week) === true; } catch { isPublic = false; }", "try { isPublic = arePicksPublic(week) === true || getSession().isAdmin === true; } catch { isPublic = false; }"]], [SWEEP]],
  ];
  for (const [id, label, edits, mustRed] of sweepMuts) {
    const file = join(cc, 'js/pick-chips.js'), pristine = readFileSync(join(HERE, 'js/pick-chips.js'), 'utf8');
    let src = pristine, ok = true;
    for (const [from, to] of edits) { if (!src.includes(from)) { ok = false; break; } src = src.replace(from, to); }
    if (!ok) { assert(false, `7b-${id}: the mutation APPLIES (its anchor moved: ${edits[0][0].slice(0, 60)}…)`); continue; }
    writeFileSync(file, src);
    const r = core();
    writeFileSync(file, pristine);                                                          // restore from the pristine file
    const redLines = [...r.out.matchAll(/❌ ([^\n]{0,80})/g)].map((m) => m[1]);
    assert(r.code !== 0 && mustRed.every((re) => redLines.some((l) => re.test(l))), `7b-${id}: ${label} → RED on: ${redLines.filter((l) => mustRed.some((re) => re.test(l))).join(' | ') || redLines.slice(0, 2).join(' | ') || '(nothing!)'}`);
  }
  const cagain = core();
  assert(cagain.code === 0 && /✅ THE LANE B SURFACE SWEEP/.test(cagain.out), '7b-Z: …and after both restores the clone\'s core suite is GREEN again');
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

_log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 180000).unref();
