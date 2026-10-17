/**
 * CFB Pickems — gamedayenv.mjs (Deployment 1, Lane B, Game Day, 2026-10-08)
 * =========================================================================
 * Shared TEST FIXTURE for gamedaytest, gamedaybudgettest, picksviewtest and relatedtest. Not a suite: it asserts nothing, loadtest does not spawn it, and it carries no manifest.
 * It stands up the SCENARIOS of docs/mockups/d1/home-gameday.html (live with 1 / 3 / 9 / 11 games, CFB + NFL, a CFB-only member following the NFL, CFB Live + NFL Locked in ONE card, nothing live, Locked,
 * all final, a finalized week, Open due / Open in) over a REAL createHome() (d1homeenv.mkHomeEnv) with a REAL element tree (minidom.mjs), every injected dependency a fake the test controls.
 *
 *   import { installDom } from './d1homeenv.mjs'; installDom();  // BEFORE the first import of any app module
 *   const E = await import('./gamedayenv.mjs');
 *   const s = E.scenario('live3', { fresh: 'fresh' }); const html = E.render(s);   // the Home feed markup as served
 *
 * The sample slate is the mockup's (invented) one: six members, p1 is the viewer (Drew, "DH"). Picks are written exactly as the mockup's `pk` strings (a = away, h = home, - = no pick), p1..p6 in order.
 */
import * as FX from './statsfixtures.mjs';
import { mkHomeEnv, NOW, MIN, HOUR, DAY, iso, esc } from './d1homeenv.mjs';

export { NOW, MIN, HOUR, DAY, iso, esc };
export const NUMHTML = (v) => (v === null || v === undefined || String(v).trim() === '' ? '' : (Number.isFinite(Number(v)) ? String(Number(v)) : esc(String(v))));

/** [id, sport, awayAbbr?, awayName, homeName, fav('a'|'h'), margin, status, awayScore, homeScore, clock, picks('aaahah')] — the mockup's SLATE. */
const S = (id, sp, an, hn, fav, m, st, as, hs, clk, pk) => ({ id, sp, an, hn, fav, m, st, as, hs, clk, pk });
export const SLATE = {
  c1: S('c1', 'cfb', 'Texas', 'Oklahoma', 'h', 3.5, 'live', 21, 17, '4:12 - 3rd', 'aaahah'),
  c2: S('c2', 'cfb', 'Georgia', 'Alabama', 'a', 3.5, 'live', 7, 10, '8:40 - 2nd', 'aahhaa'),
  c3: S('c3', 'cfb', 'Michigan', 'Ohio State', 'h', 7, 'live', 10, 13, 'Halftime', 'aahaha'),
  c4: S('c4', 'cfb', 'USC', 'Stanford', 'a', 10, 'live', 34, 17, '11:02 - 4th', 'aaaaha'),
  c5: S('c5', 'cfb', 'Auburn', 'LSU', 'h', 4, 'live', 3, 0, '6:30 - 1st', 'hahhah'),
  c6: S('c6', 'cfb', 'Oregon', 'Washington', 'a', 3, 'final', 31, 24, 'Final', 'aaahha'),
  c7: S('c7', 'cfb', 'Clemson', 'Miami', 'h', 2.5, 'upcoming', 0, 0, '', 'hhaahh'),
  c8: S('c8', 'cfb', 'Penn State', 'Iowa', 'a', 6, 'live', 17, 10, '9:15 - 3rd', 'aaaaaa'),
  c9: S('c9', 'cfb', 'Florida State', 'North Carolina', 'a', 2, 'live', 14, 17, '2:03 - 2nd', 'ahahha'),
  c10: S('c10', 'cfb', 'Baylor', 'TCU', 'h', 1.5, 'live', 28, 24, '6:40 - 4th', 'hhaaha'),
  c11: S('c11', 'cfb', 'Utah', 'Colorado', 'a', 9, 'live', 20, 7, '13:00 - 3rd', 'aaaahh'),
  n1: S('n1', 'nfl', 'Chiefs', 'Bills', 'a', 2.5, 'live', 17, 14, '3:31 - 2nd', 'aahahh'),
  n2: S('n2', 'nfl', 'Eagles', 'Cowboys', 'a', 3, 'live', 10, 13, '0:48 - 1st', 'ahhaha'),
  n3: S('n3', 'nfl', 'Lions', 'Packers', 'h', 1, 'upcoming', 0, 0, '', 'hahaah'),
};

/** Each scenario: the Now card's week status, the games by group, the sports the viewer plays, and which sports' weeks are not public. */
export const SCENARIOS = {
  live1:     { week: 'live', live: ['c1'], up: ['c2', 'c3', 'c4', 'c5', 'c7'], fin: ['c6'], plays: ['cfb'] },
  live3:     { week: 'live', live: ['c1', 'c2', 'c3'], up: ['c4', 'c5', 'c7'], fin: ['c6'], plays: ['cfb'] },
  live9:     { week: 'live', live: ['c1', 'c2', 'c3', 'c4', 'c5', 'c8', 'c9', 'c10', 'c11'], up: ['c7'], fin: ['c6'], plays: ['cfb'] },
  live11:    { week: 'live', live: ['c1', 'c2', 'c3', 'c4', 'c5', 'c8', 'c9', 'c10', 'c11', 'n1', 'n2'], up: ['c7', 'n3'], fin: ['c6'], plays: ['cfb', 'nfl'] },
  both:      { week: 'live', live: ['c1', 'c2', 'c3', 'n1', 'n2'], up: ['c4', 'c5', 'n3'], fin: ['c6'], plays: ['cfb', 'nfl'] },
  spectator: { week: 'live', live: ['c1', 'c2', 'c3', 'n1', 'n2'], up: ['c4', 'c5', 'n3'], fin: ['c6'], plays: ['cfb'], follows: ['nfl'] },
  mixed:     { week: 'live', live: ['c1', 'c2'], up: ['n1', 'n2'], fin: ['c6'], plays: ['cfb', 'nfl'], lockedSports: ['nfl'] },
  quiet:     { week: 'live', live: [], up: ['c7'], fin: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], plays: ['cfb'] },
  locked:    { week: 'locked', live: [], up: ['c1', 'c2', 'c3', 'c4', 'c5', 'c7'], fin: [], plays: ['cfb'] },
  allfinal:  { week: 'live', live: [], up: [], fin: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'], plays: ['cfb'] },
  final:     { week: 'final', live: [], up: [], fin: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], plays: ['cfb'] },
  openDue:   { week: 'open', live: [], up: ['c1', 'c2', 'c3', 'c4', 'c5', 'c7'], fin: [], plays: ['cfb'], noPicks: true },
  openIn:    { week: 'open', live: [], up: ['c1', 'c2', 'c3', 'c4', 'c5', 'c7'], fin: [], plays: ['cfb'] },
  // fix round 2 (DI-599): CFB Week 6 finalized while NFL Week 6 is still OPEN for picks — "What's next" has somewhere to point
  finalNext: { week: 'final', live: [], up: ['n1', 'n2', 'n3'], fin: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], plays: ['cfb', 'nfl'], sportStatus: { nfl: 'open' } },
  finalNextDue: { week: 'final', live: [], up: ['n1', 'n2', 'n3'], fin: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], plays: ['cfb', 'nfl'], sportStatus: { nfl: 'open' }, noPicksFor: ['nfl'] },
};

const SIDE = { a: 'away', h: 'home' };

/**
 * @param {string} name   a key of SCENARIOS
 * @param {{fresh?:'fresh'|'stale', viewer?:string|null, admin?:boolean, supabase?:boolean, picksRead?:(id)=>boolean, derivedLocked?:boolean, hostile?:boolean, picksView?:'person'|'team',
 *          extraPicks?:Array, entrants?:(week)=>object[], logos?:boolean}} o
 */
export function scenario(name, o = {}) {
  const sc = SCENARIOS[name];
  if (!sc) throw new Error(`gamedayenv: no scenario ${name}`);
  const players = FX.PLAYERS.map(p => ({ ...p }));
  if (o.hostile) { players[1].displayName = 'Z"><img src=x onerror=alert(1)>'; players[1].initials = 'Z"><b>'; }
  const all = [...sc.live.map(id => ({ id, st: 'live' })), ...sc.up.map(id => ({ id, st: 'upcoming' })), ...sc.fin.map(id => ({ id, st: 'final' }))];
  const sports = [...new Set(all.map(g => SLATE[g.id].sp))];
  const weekIdOf = (sp) => (sp === 'nfl' ? 'w6n' : 'w6');
  const statusOfWeek = (sp) => (sc.sportStatus && sc.sportStatus[sp] ? sc.sportStatus[sp] : sc.lockedSports && sc.lockedSports.includes(sp) ? 'locked' : sc.week);
  const weeks = sports.map(sp => FX.mkWeek({ id: weekIdOf(sp), n: 6, status: statusOfWeek(sp), extra: { season: '2026', sport: sp, createdAt: iso(NOW - 4 * DAY), picksLockAt: statusOfWeek(sp) === 'open' ? iso(NOW + 2 * HOUR + 10 * MIN) : null, finalizedAt: statusOfWeek(sp) === 'final' ? iso(NOW - 2 * DAY) : null } }));
  const games = [], picks = [];
  const liveEntries = new Map();
  const staleMs = o.fresh === 'stale' ? 4 * MIN : 12 * 1000;
  all.forEach(({ id, st }, i) => {
    const d = SLATE[id];
    const spread = d.fav === 'h' ? -d.m : d.m;
    const kick = st === 'live' ? NOW - 2 * HOUR + i * MIN : st === 'final' ? NOW - 5 * HOUR : NOW + (sc.week === 'locked' ? 2 * HOUR + 10 * MIN : 6 * HOUR) + i * MIN;
    const sp = d.sp;
    const g = {
      ...FX.mkGame({ id: d.id, weekId: weekIdOf(sp), kick: iso(kick), home: d.hn, away: d.an, kind: 'cover', state: 'scheduled' }),
      spread, lockedSpread: spread, favorite: d.fav === 'h' ? d.hn : d.an, status: st === 'live' ? 'live' : st === 'final' ? 'final' : 'scheduled',
      homeScore: st === 'upcoming' ? null : d.hs, awayScore: st === 'upcoming' ? null : d.as, atsWinner: null,
    };
    if (st === 'final') g.lastUpdated = iso(NOW - 4 * HOUR);
    games.push(g);
    if (st === 'live') liveEntries.set(id, { name: d.clk === 'Halftime' ? 'STATUS_HALFTIME' : 'STATUS_IN_PROGRESS', shortDetail: d.clk, detail: d.clk, capturedAt: NOW - staleMs });
    d.pk.split('').forEach((c, k) => {
      if (sc.noPicks && k === 0) return;
      if (sc.noPicksFor && k === 0 && sc.noPicksFor.includes(sp)) return;   // the viewer has not picked that sport's week yet
      if (c === '-' || !players[k]) return;
      picks.push({ pickId: `pk_${id}_${players[k].playerId}`, weekId: weekIdOf(sp), gameId: id, playerId: players[k].playerId, selectedTeam: c === 'a' ? d.an : d.hn });
    });
  });
  for (const x of asArr(o.extraPicks)) picks.push(x);
  const league = { players, weeks, games, picks, weeklyResults: [] };
  if (sc.week === 'final') {
    league.weeklyResults = players.map((p, i) => ({ weekId: 'w6', playerId: p.playerId, displayName: p.displayName, rank: i + 1, correctPicks: 4 - (i % 3), incorrectPicks: i % 3, correctCount: 4 - (i % 3), incorrectCount: i % 3, noDecisions: 0, isWinner: i === 5, isLoser: i === 0 }));
  }
  const play = new Set(sc.plays);
  const competitions = sports.length > 1 ? sports.map(sp => ({ competitionId: `c_${sp}`, sport: sp, label: sp.toUpperCase(), currentWeekId: weekIdOf(sp), viewerEntered: play.has(sp) })) : null;
  const cur = weeks.find(w => w.weekId === 'w6');
  const deps = {
    liveEntryFor: (gid) => liveEntries.get(gid) || null,
    ...(competitions ? { competitions: () => competitions } : {}),
    // WHO IS IN a sport for a week is injected (Home invents no roster: security C4 / A3). Every scenario member plays every sport here; `o.entrants` narrows it (a late joiner, a non-entrant).
    entrantsFor: o.entrants || (() => players.map((p) => ({ ...p, active: true }))),
    // Team logos ON (fix round 2, DI-572 / PF-446 in the open card's rows): the app's logoUrlFor answers a vetted https URL only when the switch is on; here a fixed ESPN-shaped URL per team side
    ...(o.logos ? { logoUrlFor: (game, side) => `https://a.espncdn.com/i/teamlogos/ncaa/500/${game.gameId}-${side}.png` } : {}),
  };
  return {
    name, sc, league, deps, now: NOW, viewer: o.viewer === undefined ? 'p1' : o.viewer, admin: !!o.admin, supabase: !!o.supabase, picksRead: o.picksRead,
    read: { currentWeek: () => cur, picksView: () => o.picksView || 'team' }, competitions,
  };
}
const asArr = (v) => (Array.isArray(v) ? v : []);

/**
 * Seeds the REAL storage seam with a scenario (local mode: every device holds every row). The Game Day gate (js/pick-chips.js) reads other members' picks through storage.js — the one raw reader — so
 * a test that drives it through Home must put the fixture THERE, not only in Home's injected readers. A fresh `localStorage` each call; the viewer is a verified, signed-in player.
 */
export function seed(storage, s) {
  globalThis.localStorage.clear();
  storage.setBackendMode('local');
  storage.getPlayers().forEach(p => storage.savePlayer({ ...p, active: false }));
  s.league.players.forEach(p => storage.addPlayer({ ...p, active: true, preferences: { ...(p.preferences || {}) } }));
  s.league.weeks.forEach(w => storage.saveWeek(w));
  s.league.games.forEach(g => storage.saveGame(g));
  storage.saveAllPicks(s.league.picks);
  storage.setSession(s.viewer, s.admin, true);
  return storage;
}

/**
 * A mounted Home for a scenario: `{ env, html(), open(gameId?), close(), card() }`., `mods` = { home, storage } (the real modules, imported after installDom(); `storage` seeds the real seam, see seed()).
 * Rendering is synchronous; `html()` is the Home container's markup as served.
 */
export function mount(mods, doc, s, extra = {}) {
  if (mods.storage) seed(mods.storage, s);
  const env = mkHomeEnv(mods, doc, s.league, {
    viewer: s.viewer, admin: s.admin, supabase: s.supabase, picksRead: s.picksRead, read: { ...s.read, ...(extra.read || {}) },
    deps: { ...s.deps, ...(extra.deps || {}) }, state: { now: s.now, ...(extra.state || {}) },
  });
  env.home.renderHome();
  return {
    env, home: env.home, container: env.container,
    html: () => env.container.innerHTML,
    card: () => (/<section class="gd[\s\S]*?<\/section>/.exec(env.container.innerHTML) || [''])[0],
    open: (gameId = null) => { env.home.openGameDay(gameId ? { gameId } : {}); return env.container.innerHTML; },
    close: () => { env.home.closeGameDay(); return env.container.innerHTML; },
  };
}

/** Just the Home feed markup for a scenario (collapsed unless `open`). */
export function render(mods, doc, s, { open = false, gameId = null } = {}) {
  const m = mount(mods, doc, s);
  if (open) m.open(gameId);
  return m.html();
}
