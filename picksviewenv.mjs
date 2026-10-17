/**
 * CFB Pickems — picksviewenv.mjs (Deployment 1, Lane B, DI-614, 2026-10-08)
 * =========================================================================
 * Shared TEST FIXTURE for picksviewtest and relatedtest. Not a suite: it asserts nothing, loadtest does not spawn it, and it carries no manifest.
 *
 *   leagueOf(kind, opts)                         a small league in one of the week states the gate must tell apart
 *   seedLeague(storage, L, { viewer, ... })      puts it on the REAL storage seam (local mode) and signs the viewer in
 *   dashFixtures({ app, storage })               the Dashboard compact row's markup for a fixed set of leagues, through the app's own renderDashboardCompact: the same builder runs against the
 *                                                BASE tree (the Home branch, before Lane B moved the chip loop into js/pick-chips.js) to write tests/golden/dashboard-chips.json, and against
 *                                                this tree in the suite, which asserts the two are byte-identical (the DEFAULT, By person, output did not change).
 *
 * Every date is far in the past or far in the future, so no game state or label depends on the day the suite runs. The six members are statsfixtures' (p1 Drew ... p6 Kihoon).
 */
import * as FX from './statsfixtures.mjs';

const PAST = '2020-09-12T17:00:00.000Z';
const FUTURE = '2099-09-12T17:00:00.000Z';
export const PLAYERS = FX.PLAYERS.map((p) => ({ ...p }));

/** Outcome strings are six letters, p1..p6 in order: 'a' = the away team, 'h' = the home team, '-' = no pick. */
const SLATE = [
  { id: 'x1', home: 'Oklahoma', away: 'Texas', fav: 'home', pk: 'aaahah' },
  { id: 'x2', home: 'Alabama', away: 'Georgia', fav: 'away', pk: 'aahhaa' },
  { id: 'x3', home: 'Ohio State', away: 'Michigan', fav: 'home', pk: 'aahaha' },
];
export const GAME_IDS = SLATE.map((g) => g.id);
export const RIVAL_CANARY = 'RIVAL-PICK-CANARY';

/**
 * @param {'live'|'open'|'locked'|'derivedLocked'|'final'} kind
 * @param {{weekId?:string, logos?:boolean, hostile?:boolean, noPicksFor?:string[], sport?:string}} o
 */
export function leagueOf(kind, o = {}) {
  const weekId = o.weekId || 'wv1';
  const status = kind === 'derivedLocked' ? 'open' : kind;
  const week = FX.mkWeek({ id: weekId, n: 1, status, extra: kind === 'derivedLocked' ? { picksLockAt: PAST } : (kind === 'open' ? { picksLockAt: FUTURE } : {}) });
  const players = PLAYERS.map((p) => ({ ...p }));
  if (o.hostile) { players[1].displayName = 'Z"><img src=x onerror=alert(1)>'; players[1].initials = 'Z"><b>'; }
  const games = SLATE.map((s, i) => {
    const started = kind === 'live' || kind === 'final' || kind === 'locked' || kind === 'derivedLocked';
    const state = kind === 'final' ? 'final' : kind === 'live' ? (i === 0 ? 'final' : i === 1 ? 'live' : 'scheduled') : 'scheduled';
    const g = {
      ...FX.mkGame({ id: s.id, weekId, kick: (kind === 'open' || (kind === 'live' && i === 2)) ? FUTURE : (started ? PAST : FUTURE), home: s.home, away: s.away, kind: 'cover', state }),
      spread: s.fav === 'home' ? -3.5 : 3.5, lockedSpread: s.fav === 'home' ? -3.5 : 3.5, favorite: s.fav === 'home' ? s.home : s.away,
    };
    if (state === 'live') { g.homeScore = 17; g.awayScore = 14; }
    if (state === 'final') { g.homeScore = 24 - i; g.awayScore = 10 + i; }
    if (o.logos) { g.homeLogo = 'https://a.espncdn.com/i/teamlogos/ncaa/500/201.png'; g.awayLogo = 'https://a.espncdn.com/i/teamlogos/ncaa/500/251.png'; }
    if (o.sport) g.sport = o.sport;
    return g;
  });
  const picks = [];
  SLATE.forEach((s, gi) => s.pk.split('').forEach((c, k) => {
    if (c === '-' || !players[k] || (o.noPicksFor || []).includes(players[k].playerId)) return;
    picks.push({ pickId: `pk_${s.id}_${players[k].playerId}`, weekId, gameId: s.id, playerId: players[k].playerId, selectedTeam: c === 'a' ? games[gi].awayTeam : games[gi].homeTeam });
  }));
  return { kind, weekId, week, players, games, picks };
}

/** The REAL storage seam, local mode (every device holds every row), the viewer verified and signed in (or nobody). */
export function seedLeague(storage, L, { viewer = 'p1', admin = false, logoView = false } = {}) {
  globalThis.localStorage.clear();
  storage.setBackendMode('local');
  storage.getPlayers().forEach((p) => storage.savePlayer({ ...p, active: false }));
  L.players.forEach((p) => storage.addPlayer({ ...p, active: true, preferences: { logoView } }));
  storage.saveWeek(L.week);
  L.games.forEach((g) => storage.saveGame(g));
  storage.saveAllPicks(L.picks);
  if (viewer) storage.setSession(viewer, admin, true); else storage.clearSession();
  return L;
}

const FIXTURES = [
  ['live as p1 (public week)', 'live', { viewer: 'p1' }],
  ['live as p3 with Team logos on', 'live', { viewer: 'p3', logos: true, logoView: true }],
  ['live, a member with no pick on game x1', 'live', { viewer: 'p1', noPicksFor: ['p4'] }],
  ['live with hostile names', 'live', { viewer: 'p1', hostile: true }],
  ['open as p1 (everyone submitted, blind)', 'open', { viewer: 'p1' }],
  ['open as p2, p5 not submitted', 'open', { viewer: 'p2', noPicksFor: ['p5'] }],
  ['locked as p6 (blind)', 'locked', { viewer: 'p6' }],
  ['derived-locked as p1 (blind)', 'derivedLocked', { viewer: 'p1' }],
  ['final as p4', 'final', { viewer: 'p4' }],
  ['live, signed out', 'live', { viewer: null }],
];

/** @returns {Array<{name:string, html:string}>} */
export function dashFixtures({ app, storage }) {
  return FIXTURES.map(([name, kind, o]) => {
    const L = leagueOf(kind, o);
    seedLeague(storage, L, { viewer: o.viewer, logoView: !!o.logoView });
    const html = app.renderDashboardCompact(L.players.filter((p) => p.active !== false), storage.getGames(L.weekId), storage.getPicks(L.weekId), [], L.weekId, null);
    return { name, html };
  });
}
