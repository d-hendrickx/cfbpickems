/**
 * CFB Pickems - js/analytics/m-identity.js (D2 lane 4; DI-953 "Picking identity"; UN/PF-519; 2026-10-19)
 * ========================================================================================================
 * Who a member backs and fades, favourite or underdog, home or away, by line band, per sport, and the alma-mater
 * behaviour (college football only). Reveal class: final-week. Counts are RAW (a multiplier game counts once, CONVENTIONS #22).
 *
 * Never a trait: "you are a chalk player" is a LABEL (m-labels.js) with its own rules. A tie never claims a team; a pick'em game
 * never enters the favourite share; the alma straight-up record is its own sentence and is NEVER added to the pick record.
 */
import { register, makeMetric, unavailable, minOf, ratio, REVEAL } from './registry.js';
import { assertEligible, viewOf } from './input.js';
import { sliceOf, scopesOf, graded, wins, losses, pushes, roleEligible, noLine, supportOfPicks } from './slice.js';
import { getAlmaMaterMatch } from '../data-model.js';
import { almaMaterGameResults } from '../stats.js';

const FW = REVEAL.FINAL_WEEK;
const wl = (picks) => ({ n: picks.length, w: wins(picks), l: losses(picks) });
const mine = (slice, memberId) => slice.picksByMember.get(memberId) || [];
const teamName = (slice, teamKey) => {
  for (const g of slice.games) { if (g.homeKey === teamKey) return g.home; if (g.awayKey === teamKey) return g.away; }
  return teamKey;
};

const sideMemo = new WeakMap();
/** Per team key: the member's graded picks backing it and fading it (memoised per pick list: the slice's own per-member arrays are stable). */
function sidesByTeam(picks) {
  if (sideMemo.has(picks)) return sideMemo.get(picks);
  const m = new Map();
  for (const p of graded(picks)) {
    for (const [key, role] of [[p.teamKey, 'backed'], [p.opponentKey, 'faded']]) {
      if (key === null) continue;                    // a pick on a team on neither side of the game has no opponent
      if (!m.has(key)) m.set(key, { backed: [], faded: [] });
      m.get(key)[role].push(p);
    }
  }
  sideMemo.set(picks, m);
  return m;
}

export const IDENT_TEAM_RECORD = register({
  id: 'ident.team_record', v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'teamSide',
  enumerate(slice) {
    const out = [];
    for (const id of slice.memberIds) {
      for (const [teamKey, s] of sidesByTeam(mine(slice, id))) if (s.backed.length >= minOf('teamSide') || s.faded.length >= minOf('teamSide')) out.push({ memberId: id, teamKey });
    }
    return out;
  },
  run(slice, { memberId, teamKey }) {
    const def = IDENT_TEAM_RECORD;
    const s = sidesByTeam(mine(slice, memberId)).get(teamKey) || { backed: [], faded: [] };
    const min = minOf('teamSide');
    const n = s.backed.length + s.faded.length;
    if (s.backed.length < min && s.faded.length < min) return unavailable({ def, slice, subject: { kind: 'member', id: memberId, id2: teamKey }, reason: 'thin', n, min });
    const side = (arr) => (arr.length >= min ? wl(arr) : null);
    return makeMetric({
      def, slice, subject: { kind: 'member', id: memberId, id2: teamKey }, n, num: s.backed.length, den: n,
      value: { team: teamName(slice, teamKey), appearances: n, backed: side(s.backed), faded: side(s.faded) },
      supportRows: supportOfPicks([...s.backed, ...s.faded]),
      excluded: { ...slice.excluded, push: pushes(mine(slice, memberId).filter((p) => p.teamKey === teamKey || p.opponentKey === teamKey)) },
    });
  },
});

function makeMost(id, role) {
  const def = {
    id, v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'teamSide',
    run(slice, { memberId }) {
      const rows = [];
      const sides = sidesByTeam(mine(slice, memberId));
      for (const [teamKey, s] of sides) rows.push({ teamKey, arr: s[role], n: s[role].length });
      rows.sort((a, b) => (b.n - a.n) || (a.teamKey < b.teamKey ? -1 : 1));
      const min = minOf('teamSide');
      const subject = { kind: 'member', id: memberId };
      if (!rows.length || rows[0].n < min) return unavailable({ def, slice, subject, reason: 'thin', n: rows.length ? rows[0].n : 0, min });
      // a TIE for the top claims nothing (DI-946: strictly greater than the next)
      if (rows.length > 1 && rows[1].n === rows[0].n) return unavailable({ def, slice, subject, reason: 'tie', n: rows[0].n, min });
      const top = rows[0];
      // the same team's count for every OTHER member (is this the league high?)
      let othersMax = 0;
      for (const other of slice.memberIds) {
        if (other === memberId) continue;
        const o = sidesByTeam(mine(slice, other)).get(top.teamKey);
        if (o && o[role].length > othersMax) othersMax = o[role].length;
      }
      const appearances = sides.get(top.teamKey).backed.length + sides.get(top.teamKey).faded.length;
      return makeMetric({
        def, slice, subject, n: top.n, num: top.n, den: appearances,
        value: { team: teamName(slice, top.teamKey), teamKey: top.teamKey, count: top.n, appearances, w: wins(top.arr), l: losses(top.arr), leagueHigh: top.n > othersMax },
        comparison: { value: othersMax, n: slice.memberIds.length - 1, label: 'others_max' },
        supportRows: supportOfPicks(top.arr),
      });
    },
  };
  return register(def);
}
export const IDENT_MOST_BACKED = makeMost('ident.team_most_backed', 'backed');
export const IDENT_MOST_FADED = makeMost('ident.team_most_faded', 'faded');

export const IDENT_TEAM_LOYALTY = register({
  id: 'ident.team_loyalty', v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'teamLoyalty',
  enumerate(slice) {
    const out = [];
    for (const id of slice.memberIds) for (const [teamKey, s] of sidesByTeam(mine(slice, id))) if (s.backed.length + s.faded.length >= minOf('teamLoyalty') && s.backed.length > 0) out.push({ memberId: id, teamKey });
    return out;
  },
  run(slice, { memberId, teamKey }) {
    const def = IDENT_TEAM_LOYALTY;
    const s = sidesByTeam(mine(slice, memberId)).get(teamKey) || { backed: [], faded: [] };
    const n = s.backed.length + s.faded.length;
    const min = minOf('teamLoyalty');
    const subject = { kind: 'member', id: memberId, id2: teamKey };
    if (n < min) return unavailable({ def, slice, subject, reason: 'thin', n, min });
    return makeMetric({ def, slice, subject, n, num: s.backed.length, den: n, value: { team: teamName(slice, teamKey), backed: s.backed.length, appearances: n, share: ratio(s.backed.length, n) }, supportRows: supportOfPicks([...s.backed, ...s.faded]) });
  },
});

/** mean favourite share over members with at least the minimum role-eligible picks, optionally excluding one member */
function favShareOthers(slice, exceptId) {
  const shares = [];
  for (const id of slice.memberIds) {
    if (id === exceptId) continue;
    const el = roleEligible(mine(slice, id));
    if (el.length >= minOf('rate')) shares.push(el.filter((p) => p.pickedFavorite === true).length / el.length);
  }
  return shares.length ? { mean: Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 10000) / 10000, n: shares.length } : null;
}

export const IDENT_FAV_DOG = register({
  id: 'ident.fav_dog', v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'rate',
  run(slice, { memberId }) {
    const def = IDENT_FAV_DOG;
    const all = mine(slice, memberId);
    const el = roleEligible(all);
    const min = minOf('rate');
    const subject = { kind: 'member', id: memberId };
    if (el.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: el.length, min });
    const fav = el.filter((p) => p.pickedFavorite === true);
    const dog = el.filter((p) => p.pickedFavorite === false);
    const others = favShareOthers(slice, memberId);
    return makeMetric({
      def, slice, subject, n: el.length, num: fav.length, den: el.length,
      value: { share: ratio(fav.length, el.length), onFavorite: wl(fav), onUnderdog: wl(dog) },
      comparison: others ? { value: others.mean, n: others.n, label: 'others_mean' } : null,
      supportRows: supportOfPicks(el),
      excluded: { ...slice.excluded, push: pushes(all), noLine: noLine(graded(all)) },
    });
  },
});

export const IDENT_HOME_AWAY = register({
  id: 'ident.home_away', v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'rate',
  run(slice, { memberId }) {
    const def = IDENT_HOME_AWAY;
    const g = graded(mine(slice, memberId));
    const site = g.filter((p) => !p.neutral && p.side !== null);
    const home = site.filter((p) => p.side === 'home'), away = site.filter((p) => p.side === 'away');
    const min = minOf('rate');
    const subject = { kind: 'member', id: memberId };
    if (site.length < min) return unavailable({ def, slice, subject, reason: 'thin', n: site.length, min });
    return makeMetric({
      def, slice, subject, n: site.length, num: home.length, den: site.length,
      value: { homeShare: ratio(home.length, site.length), home: wl(home), away: wl(away), neutral: g.length - site.length },
      supportRows: supportOfPicks(site),
    });
  },
});

export const BANDS = Object.freeze([
  { band: 'le3', lo: -Infinity, hi: 3 }, { band: '3to7', lo: 3, hi: 7 }, { band: '7to14', lo: 7, hi: 14 }, { band: 'gt14', lo: 14, hi: Infinity },
]);
/** Closed upper edge: 3 is in 'le3', 7 in '3to7', 14 in '7to14'. */
export const bandOf = (margin) => (margin <= 3 ? 'le3' : margin <= 7 ? '3to7' : margin <= 14 ? '7to14' : 'gt14');

export const IDENT_SPREAD_BAND = register({
  id: 'ident.spread_band', v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'bucket',
  run(slice, { memberId }) {
    const def = IDENT_SPREAD_BAND;
    const el = roleEligible(mine(slice, memberId)).filter((p) => p.margin > 0);
    const min = minOf('bucket');
    const subject = { kind: 'member', id: memberId };
    const bands = [];
    const used = [];
    for (const b of BANDS) {
      const inBand = el.filter((p) => bandOf(p.margin) === b.band);
      if (inBand.length < min) continue;
      const fav = inBand.filter((p) => p.pickedFavorite === true);
      bands.push({ band: b.band, picks: inBand.length, favShare: ratio(fav.length, inBand.length), w: wins(inBand), l: losses(inBand) });
      used.push(...inBand);
    }
    if (!bands.length) return unavailable({ def, slice, subject, reason: 'thin', n: el.length, min });
    return makeMetric({ def, slice, subject, n: used.length, value: { bands }, supportRows: supportOfPicks(used) });
  },
});

/** Cross-sport (DI-945: one of exactly two cross-scope kinds): the member's graded win percentage per competition, SIDE BY SIDE, never combined. */
export const IDENT_SPORT_SPLIT = register({
  id: 'ident.sport_split', v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'sportPicks', crossScope: 'sport',
  run(input, { memberId, season }) {
    assertEligible(input);
    const def = IDENT_SPORT_SPLIT;
    const scopes = scopesOf(input).filter((s) => !s.archived);
    const latest = season || scopes.map((s) => s.season).sort().pop();
    const rows = [];
    const sup = [];
    for (const s of scopes.filter((x) => x.season === latest)) {
      const slice = sliceOf(input, { competitionId: s.competitionId, season: s.season });
      const g = graded(mine(slice, memberId));
      rows.push({ competitionId: s.competitionId, sport: s.sport, n: g.length, w: wins(g), l: losses(g), pct: ratio(wins(g), g.length) });
      sup.push(...supportOfPicks(g));
    }
    const min = minOf('sportPicks');
    const ok = rows.filter((r) => r.n >= min);
    const subject = { kind: 'member', id: memberId };
    const cross = { leagueId: input.leagueId, sport: 'multi', competitionId: null, format: 'mixed', season: latest, dataKey: input.dataKey, asOf: { weekId: '', weekNumber: 0, throughKickoffMs: 0 }, throughWeek: null, excluded: { push: 0, noLine: 0, notEntrant: 0, other: 0 } };
    if (ok.length < 2) return unavailable({ def, slice: cross, subject, reason: 'thin', n: rows.reduce((a, r) => a + r.n, 0), min });
    return makeMetric({ def, slice: cross, subject, n: ok.reduce((a, r) => a + r.n, 0), value: { sports: ok }, supportRows: sup, window: { kind: 'season' } });
  },
});

// ---- alma mater (college football only) --------------------------------------------------------------------------
const safeMatch = (team, school) => { try { return !!getAlmaMaterMatch(team, [school]); } catch { return false; } };

/** per week, the member's school: the week's lock snapshot, else the live roster (flagged approx). */
function almaFor(input, weekId, memberId) {
  const snap = viewOf(input).almaByWeek.get(weekId);
  if (!snap) return { school: null, approx: true };
  return { school: snap.schoolOf(memberId), approx: snap.source !== 'snapshot' };
}

export const IDENT_ALMA_PICK = register({
  id: 'ident.alma_pick', v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'almaGames',
  run(slice, { memberId }) {
    const def = IDENT_ALMA_PICK;
    const subject = { kind: 'member', id: memberId };
    if (slice.sport !== 'cfb') return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: minOf('almaGames') });
    const backed = [], faded = [];
    let approx = false;
    for (const p of graded(mine(slice, memberId))) {
      const g = slice.gameById.get(p.gameId);
      if (!g || !g.isAlmaMaterGame) continue;
      const { school, approx: ap } = almaFor(slice.input, p.weekId, memberId);
      if (!school) continue;
      const homeMine = safeMatch(g.home, school), awayMine = safeMatch(g.away, school);
      if (homeMine === awayMine) continue;                       // neither side, or ambiguous: absent beats wrong
      if (ap) approx = true;
      (safeMatch(p.team, school) ? backed : faded).push(p);
    }
    const n = backed.length + faded.length, min = minOf('almaGames');
    if (n < min) return unavailable({ def, slice, subject, reason: 'thin', n, min });
    return makeMetric({ def, slice, subject, n, num: backed.length, den: n, value: { backedShare: ratio(backed.length, n), backed: wl(backed), faded: wl(faded), approx }, supportRows: supportOfPicks([...backed, ...faded]) });
  },
});

export const IDENT_ALMA_SU = register({
  id: 'ident.alma_su', v: 1, family: 'identity', reveal: FW, level: 'member', minKey: 'almaGames',
  run(slice, { memberId }) {
    const def = IDENT_ALMA_SU;
    const subject = { kind: 'member', id: memberId };
    if (slice.sport !== 'cfb') return unavailable({ def, slice, subject, reason: 'no_data', n: 0, min: minOf('almaGames') });
    const view = viewOf(slice.input);
    let w = 0, l = 0, approx = false;
    const rows = [];
    for (const wk of slice.finals) {
      const { school, approx: ap } = almaFor(slice.input, wk.weekId, memberId);
      if (!school) continue;
      const games = view.rawGames.filter((g) => String(g.weekId) === wk.weekId);
      for (const r of almaMaterGameResults(school, games)) { if (ap) approx = true; if (r.result === 'win') w++; else l++; rows.push({ gameId: r.gameId, weekId: r.weekId, memberId, k: slice.gameById.get(r.gameId)?.kickoffMs ?? 0 }); }
    }
    const n = w + l, min = minOf('almaGames');
    if (n < min) return unavailable({ def, slice, subject, reason: 'thin', n, min });
    // STRAIGHT UP, never against the spread (locked decision), and NEVER added to the pick record above.
    return makeMetric({ def, slice, subject, n, num: w, den: n, value: { w, l, approx, straightUp: true }, supportRows: rows });
  },
});
