#!/usr/bin/env node
/**
 * CFB Pickems — spotlighttest.mjs (D1 Lane C, DI-664; Drew D-48 "kicker spotlight", W-58; written 2026-10-14)
 * =============================================================================================================
 * The proof for the SPECIAL-TEAMS rules of the Munera Spotlight standard v2 (supabase/functions/_shared/spotlight-standard.mjs): the kicker (4+ field goals made, a
 * made field goal of 50+ yards, a game-winning field goal; NFL 5+ and 55+), the returner (a kick-return or punt-return touchdown) and the punter (4+ punts inside the 20,
 * in because ESPN's box score carries the count), and how they share the one cap (1 per game, 3 per slate day per sport) and the one ranking with the other positions.
 * Pure: the module under test has no import, no clock and no network, so every case here is a plain call. The cases are of two kinds:
 *   RECORDED  real ESPN box scores and scoring plays from supabase/feed/fixtures/espn/ (nothing invented: Blake Craig's 52-yard field goal, Carson Smith's 4 of 4, Cam Little's
 *             55-yarder, Will Reichard's 5 of 5, the two return touchdowns, Alec Clark's 3 punts inside the 20)
 *   PLANTED   a box score built in the SAME shape, its category and key names read FROM the recorded files (a planted key that ESPN does not send fails section [1]), used for
 *             the cases the recorded games do not contain (one below a threshold, the 60-second window, a lead that is not "for good", a clock that is missing)
 *
 *   [1] the standard as published: version 2, the caps, every special-teams rule with its CFB / NFL threshold and its printed label; the evidence the rules read is in the recorded
 *       box scores (the punter rule is in the standard only because ESPN sends `puntsInside20`)
 *   [2] kicker, field goals made: the threshold qualifies, one below does not, per sport; extra points are not field goals; the rule reads MADE (not attempted)
 *   [3] kicker, a long field goal: 50+ (CFB) and 55+ (NFL) qualify, one yard short does not; the rule reads the longest MADE (not a percentage)
 *   [4] kicker, a game-winning field goal: the 60-second window and its edges, overtime, "ahead for good" (a lead extended, a lead caught, a lead the plays do not carry to the
 *       final score), the kicker and team that scored it, and every way the scoring plays can fail to carry the time (the rule is inactive, never guessed)
 *   [5] returner: a kick-return or punt-return touchdown, any role; returns without a touchdown do not
 *   [6] punter: 4+ punts inside the 20 (not total punts), CFB and NFL; the rule is inactive without the count
 *   [7] a rule whose field is absent is inactive for that game and its label is never named
 *   [8] the cap and the ranking with the other positions: sum of value / threshold, a yes-or-no rule counts 1.0, one per game, three per slate day, the rationale
 *   [9] the card text: "Why featured" for each special-teams rule, the stat lines, the game window stated, and no stat that is not in the evidence
 *   [10] the recorded games: the real kickers, returners and punters above and below the thresholds; the returner rule agrees with the scoring plays; the scoring-play
 *        names match the box score's kicking line (what the game-winning rule depends on)
 *   [11] static: the standard is deterministic and carries no popularity wording
 *   [12] absent is not zero (the W-58 review rulings OD-1..3): a field the source does not carry (absent, null, empty, blank) is never read as 0 and never printed:
 *        no "long undefined" on a kicker's line, no go-ahead credited from a running score, a clock or a period the plays do not carry
 *
 * Mutation kit (S-3): `node spotlighttest.mjs --mutate=<name>` applies one KIT_MUTANTS entry to an in-memory copy of the standard (never the file) and must go RED.
 * tests/kits/lane-c-news-kit.mjs runs every name below (group "server").
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }
// a suite that THROWS part-way still prints its tally (the throw is one more failure, never a silent crash a mutation kit cannot read)
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { fail++; console.error('  ❌ the suite threw:', String((e && e.stack) || e).slice(0, 400)); console.log(`\n${'═'.repeat(50)}\n❌ FAILURES — ${pass} passed, ${fail} failed`); process.exit(1); });

const HERE = dirname(fileURLToPath(import.meta.url));
const STD = 'supabase/functions/_shared/spotlight-standard.mjs';

// ── the mutation kit: [file relative to cfb-pickems, from, to]; each `from` must occur exactly once ──────────────────────────────────────────────────────────────────────────
export const KIT_MUTANTS = {
  // thresholds, per sport (each side of each: the at-threshold case and the one-below case go red)
  'k-made-cfb-5': [STD, 'fgMade: 4, fgLong: 50', 'fgMade: 5, fgLong: 50'],
  'k-made-cfb-3': [STD, 'fgMade: 4, fgLong: 50', 'fgMade: 3, fgLong: 50'],
  'k-long-cfb-51': [STD, 'fgMade: 4, fgLong: 50', 'fgMade: 4, fgLong: 51'],
  'k-long-cfb-49': [STD, 'fgMade: 4, fgLong: 50', 'fgMade: 4, fgLong: 49'],
  'k-made-nfl-6': [STD, 'fgMade: 5, fgLong: 55', 'fgMade: 6, fgLong: 55'],
  'k-made-nfl-4': [STD, 'fgMade: 5, fgLong: 55', 'fgMade: 4, fgLong: 55'],
  'k-long-nfl-56': [STD, 'fgMade: 5, fgLong: 55', 'fgMade: 5, fgLong: 56'],
  'k-long-nfl-54': [STD, 'fgMade: 5, fgLong: 55', 'fgMade: 5, fgLong: 54'],
  'p-in20-cfb-5': [STD, 'fgLong: 50, pIn20: 4 }', 'fgLong: 50, pIn20: 5 }'],
  'p-in20-cfb-3': [STD, 'fgLong: 50, pIn20: 4 }', 'fgLong: 50, pIn20: 3 }'],
  'p-in20-nfl-5': [STD, 'fgLong: 55, pIn20: 4 }', 'fgLong: 55, pIn20: 5 }'],
  'p-in20-nfl-3': [STD, 'fgLong: 55, pIn20: 4 }', 'fgLong: 55, pIn20: 3 }'],
  'threshold-strict': [STD, 'if (Number.isFinite(v) && v >= r.threshold)', 'if (Number.isFinite(v) && v > r.threshold)'],
  // the field each rule reads
  'k-made-reads-attempts': [STD, 'fgMade: L.kicking ? L.kicking.fieldGoalsMade : null', 'fgMade: L.kicking ? L.kicking.fieldGoalAttempts : null'],
  'k-long-reads-pct': [STD, 'fgLong: L.kicking ? L.kicking.longFieldGoalMade : null', 'fgLong: L.kicking ? L.kicking.fieldGoalPct : null'],
  'p-reads-total-punts': [STD, 'puntsIn20: L.punting ? L.punting.puntsInside20 : null', 'puntsIn20: L.punting ? L.punting.punts : null'],
  'ret-reads-return-count': [STD, 'returnTd: (L.kickReturns ? v0(L.kickReturns.kickReturnTouchdowns) : 0) + (L.puntReturns ? v0(L.puntReturns.puntReturnTouchdowns) : 0) >= 1,',
    'returnTd: (L.kickReturns ? v0(L.kickReturns.kickReturns) : 0) + (L.puntReturns ? v0(L.puntReturns.puntReturns) : 0) >= 1,'],
  'ret-kick-dropped': [STD, 'returnTd: (L.kickReturns ? v0(L.kickReturns.kickReturnTouchdowns) : 0) + (L.puntReturns ? v0(L.puntReturns.puntReturnTouchdowns) : 0) >= 1,',
    'returnTd: (L.puntReturns ? v0(L.puntReturns.puntReturnTouchdowns) : 0) >= 1,'],
  'ret-punt-dropped': [STD, 'returnTd: (L.kickReturns ? v0(L.kickReturns.kickReturnTouchdowns) : 0) + (L.puntReturns ? v0(L.puntReturns.puntReturnTouchdowns) : 0) >= 1,',
    'returnTd: (L.kickReturns ? v0(L.kickReturns.kickReturnTouchdowns) : 0) >= 1,'],
  'ret-count-kick-only': [STD, 'returnTdCount: (L.kickReturns ? v0(L.kickReturns.kickReturnTouchdowns) : 0) + (L.puntReturns ? v0(L.puntReturns.puntReturnTouchdowns) : 0),',
    'returnTdCount: (L.kickReturns ? v0(L.kickReturns.kickReturnTouchdowns) : 0),'],
  'ret-yes-any': [STD, 'if (s[r.yes] === true)', 'if (s[r.yes] !== undefined)'],
  'ret-needs-offense-role': [STD, "r.role === 'returner' ? !!(p.lines.kickReturns || p.lines.puntReturns)", "r.role === 'returner' ? (!!(p.lines.kickReturns || p.lines.puntReturns) && role !== null)"],
  // the game-winning field goal
  'gw-rule-off': [STD, "if (!gw.active || !p.lines.kicking) continue;", 'continue;'],
  'gw-clock-lt-60': [STD, 'clock !== null && clock <= 60', 'clock !== null && clock < 60'],
  'gw-clock-le-120': [STD, 'clock !== null && clock <= 60', 'clock !== null && clock <= 120'],
  'gw-ot-dropped': [STD, 'period >= 5 || ', ''],
  'gw-q3-counts': [STD, '(period === 4 && clock !== null && clock <= 60)', '(period >= 3 && clock !== null && clock <= 60)'],
  'gw-no-lead-check': [STD, 'const tookLead = mine > theirs && mineBefore <= theirsBefore;', 'const tookLead = mine > theirs;'],
  'gw-held-ignored': [STD, 'if (m2 <= t2) { held = false; break; }', 'if (false) { held = false; break; }'],
  'gw-winner-ignored': [STD, 'if (tookLead && held && String(winnerTeamId) === team && m)', 'if (tookLead && held && m)'],
  'gw-clock-unknown-guessed': [STD, 'if (isFg && (period === null || (period === 4 && clock === null))) active = false;', 'if (isFg && (period === null)) active = false;'],
  'gw-period-unknown-guessed': [STD, 'if (isFg && (period === null || (period === 4 && clock === null))) active = false;', 'if (isFg && ((period === 4 && clock === null))) active = false;'],
  'gw-score-unknown-guessed': [STD, 'if (home === null || away === null) return { active: false, kicks: [] };', ''],
  'gw-inactive-flag-ignored': [STD, 'if (!gw.active || !p.lines.kicking) continue;', 'if (!p.lines.kicking) continue;'],
  'gw-missed-fg-counted': [STD, " && !/missed|blocked|no good/i.test(String(p.type && p.type.text || ''))", ''],
  'gw-name-ignored': [STD, 'gw.kicks.some((k) => k.teamId === teamId && k.kickerName === p.name)', 'gw.kicks.some((k) => k.teamId === teamId)'],
  'gw-team-ignored': [STD, 'gw.kicks.some((k) => k.teamId === teamId && k.kickerName === p.name)', 'gw.kicks.some((k) => k.kickerName === p.name)'],
  'gw-weight-2': [STD, 'k.kickerName === p.name)) met.push({ rule: r, value: 1, weight: 1 });', 'k.kickerName === p.name)) met.push({ rule: r, value: 1, weight: 2 });'],
  'ret-weight-2': [STD, 'if (s[r.yes] === true) met.push({ rule: r, value: 1, weight: 1 });', 'if (s[r.yes] === true) met.push({ rule: r, value: 1, weight: 2 });'],
  // absent is not zero (W-58 review OD-1..3): the number reader and the lines
  'num-undefined-zero': [STD, 'if (v === undefined) return null;', 'if (v === undefined) return 0;'],
  'num-null-zero': [STD, 'if (v === null) return null;', 'if (v === null) return 0;'],
  'num-empty-zero': [STD, "if (t === '') return null;", "if (t === '') return 0;"],
  'num-blank-zero': [STD, "const t = String(v).replace(/,/g, '').trim();", "const t = String(v).replace(/,/g, '');"],
  'long-clause-unguarded': [STD, "${Number.isFinite(s.fgLong) ? `, long ${s.fgLong}` : ''}", ', long ${s.fgLong}'],
  'fg-att-unguarded': [STD, '${Number.isFinite(s.fgAtt) ? `${s.fgMade}/${s.fgAtt}` : s.fgMade}', '${s.fgMade}/${s.fgAtt}'],
  'qb-cmp-unguarded': [STD, "${Number.isFinite(s.passCmp) ? `${s.passCmp}/${s.passAtt}, ` : ''}", '${s.passCmp}/${s.passAtt}, '],
  'eval-unscored-game': [STD, 'if (!Number.isFinite(num(game.homeScore)) || !Number.isFinite(num(game.awayScore))) return [];', ''],
  // the cap and the ranking the special-teams positions share with every other position
  'per-game-all': [STD, 'if (c.length) perGame.push(c[0]);', 'if (c.length) perGame.push(...c);'],
  'per-day-4': [STD, 'export const SPOTLIGHT_PER_DAY_PER_SPORT = 3;', 'export const SPOTLIGHT_PER_DAY_PER_SPORT = 4;'],
  'rank-sum-max': [STD, 'met.reduce((n, m) => n + m.weight, 0)', 'Math.max(...met.map((m) => m.weight))'],
  'rank-score-off': [STD, '(b.score - a.score) || ', ''],
  'rank-later-game-off': [STD, '((b.kickoffMs || 0) - (a.kickoffMs || 0)) || ', ''],
  'rank-name-desc': [STD, '(a.name < b.name ? -1 : a.name > b.name ? 1 : 0)', '(a.name < b.name ? 1 : a.name > b.name ? -1 : 0)'],
  'rationale-weakest-rule': [STD, 'met.sort((a, b) => b.weight - a.weight || (a.rule.id < b.rule.id ? -1 : 1));', 'met.sort((a, b) => a.weight - b.weight || (a.rule.id < b.rule.id ? -1 : 1));'],
  'rationale-rank-zero': [STD, 'rank: i + 1,', 'rank: i,'],
  'version-1': [STD, "export const SPOTLIGHT_STANDARD_VERSION = '2';", "export const SPOTLIGHT_STANDARD_VERSION = '1';"],
  // the printed labels and the card text
  'label-k-made': [STD, 'label: `K: ${t.fgMade}+ field goals`', 'label: `K: ${t.fgMade} field goals`'],
  'label-returner': [STD, "label: 'Returner: a kick-return or punt-return touchdown'", "label: 'Returner: a return touchdown'"],
  'label-p-in20': [STD, 'label: `P: ${t.pIn20}+ punts inside the 20`', 'label: `P: ${t.pIn20}+ punts`'],
  'why-k-made': [STD, "'k.made': `${top.value} field goals`", "'k.made': `${top.value} kicks`"],
  'why-k-long-wrong-stat': [STD, "'k.long': `a ${top.value}-yard field goal`", "'k.long': `a ${c.stats.fgMade}-yard field goal`"],
  'why-gw': [STD, "'k.gameWinner': 'the game-winning field goal'", "'k.gameWinner': 'a field goal'"],
  'why-ret-count': [STD, "c.stats.returnTdCount === 1 ? 'a return touchdown' : `${c.stats.returnTdCount} return touchdowns`", "'a return touchdown'"],
  'why-p-in20': [STD, "'p.in20': `${top.value} punts inside the 20`", "'p.in20': `${top.value + 1} punts inside the 20`"],
  'lines-k-dropped': [STD, "if (ruleIds.some((r) => r.startsWith('k.')) && Number.isFinite(s.fgMade))", 'if (false)'],
  'lines-ret-dropped': [STD, "if (ruleIds.includes('ret.td')) lines.push(", 'if (false) lines.push('],
  'lines-p-dropped': [STD, "if (ruleIds.includes('p.in20') && Number.isFinite(s.puntsIn20)) lines.push(", 'if (false) lines.push('],
};
const mutateArg = (process.argv.find((a) => a.startsWith('--mutate=')) || '').slice(9);

// ── load the standard (a mutant is an IN-MEMORY copy; the file on disk is never written) ──────────────────────────────────────────────────────────────────────────────────────
async function loadStandard() {
  if (!mutateArg) return import(pathToFileURL(join(HERE, STD)).href);
  const mu = KIT_MUTANTS[mutateArg];
  if (!mu) throw new Error('unknown mutant ' + mutateArg);
  const src = readFileSync(join(HERE, mu[0]), 'utf8');
  if (src.split(mu[1]).length - 1 !== 1) throw new Error(`mutant anchor must match exactly once in ${mu[0]}: ${mutateArg}`);
  return import('data:text/javascript;base64,' + Buffer.from(src.split(mu[1]).join(mu[2])).toString('base64'));   // the standard imports nothing, so a data: URL is complete
}
const SS = await loadStandard();
const EV = await import(pathToFileURL(join(HERE, 'supabase/functions/_shared/sports-evidence.mjs')).href);
if (mutateArg) console.log(`\n[MUTANT] ${mutateArg}`);

// ── the recorded ESPN games and their key lists ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const FIX = join(HERE, 'supabase', 'feed', 'fixtures', 'espn');
const recorded = readdirSync(FIX).filter((f) => /^summary-(cfb|nfl)-\d+\.json$/.test(f)).sort()
  .map((file) => ({ file, sport: file.split('-')[1], json: JSON.parse(readFileSync(join(FIX, file), 'utf8')) }));
const rec = (id) => recorded.find((r) => r.file.endsWith(`-${id}.json`));
const KEYS = { cfb: {}, nfl: {} };
const keyDrift = [];
for (const g of recorded) {
  const teams = (g.json.boxscore && Array.isArray(g.json.boxscore.players)) ? g.json.boxscore.players : [];
  for (const t of teams) for (const c of (t.statistics || [])) {
    const seen = KEYS[g.sport][c.name];
    if (!seen) KEYS[g.sport][c.name] = c.keys;
    else if (JSON.stringify(seen) !== JSON.stringify(c.keys)) keyDrift.push(`${g.file}:${c.name}`);
  }
}

// ── builders: a box score in ESPN's shape, with the key names ESPN sends ─────────────────────────────────────────────────────────────────────────────────────────────────
/** One athlete's stats array in the key order of the recorded category; unknown names throw (nothing invented). */
function statsFor(full, vals) {
  for (const k of Object.keys(vals)) if (!full.includes(k)) throw new Error(`planted a stat ESPN does not send: ${k}`);
  return full.map((k) => (k in vals ? String(vals[k]) : (k.includes('/') ? '0/0' : '0')));
}
/** One team's box: spec = { kicking: [[id, name, vals]], … }; dropKeys removes a key from a category (an absent field); omit drops a whole category. */
function teamBox(sport, teamId, spec = {}, { dropKeys = {}, omit = [] } = {}) {
  const statistics = [];
  for (const [name, rows] of Object.entries(spec)) {
    if (omit.includes(name)) continue;
    const full = KEYS[sport][name];
    if (!full) throw new Error(`no recorded ${sport} category ${name}`);
    const drop = dropKeys[name] || [];
    statistics.push({ name, keys: full.filter((k) => !drop.includes(k)),
      athletes: rows.map(([id, nm, vals]) => ({ athlete: { id, displayName: nm }, stats: statsFor(full, vals).filter((_, i) => !drop.includes(full[i])) })) });
  }
  return { team: { id: String(teamId) }, statistics };
}
const HOME = { id: '1', name: 'Home U' }, AWAY = { id: '2', name: 'Away U' };
const KICKOFF = Date.parse('2026-10-03T19:00:00Z');
function game({ sport = 'cfb', eventId = '9001', kickoffMs = KICKOFF, home = 24, away = 23, h = {}, a = {}, plays = [], hOpts, aOpts } = {}) {
  return { sport, eventId, kickoffMs, homeTeam: HOME, awayTeam: AWAY, homeScore: home, awayScore: away, box: [teamBox(sport, 1, h, hOpts), teamBox(sport, 2, a, aOpts)], scoringPlays: plays };
}
// players (ids are digits, as ESPN's are)
const K = (made, att, long, xp = '0/0') => ['101', 'Kay Kicker', { 'fieldGoalsMade/fieldGoalAttempts': `${made}/${att}`, fieldGoalPct: made && att ? ((made / att) * 100).toFixed(1) : '0.0', longFieldGoalMade: long,
  'extraPointsMade/extraPointAttempts': xp, totalKickingPoints: made * 3 + Number(xp.split('/')[0]) }];
const P = (n, inside, id = '102', name = 'Pat Punter') => [id, name, { punts: n, puntYards: n * 44, grossAvgPuntYards: '44.0', touchbacks: 0, puntsInside20: inside, longPunt: 58 }];
const KR = (n, tds, id = '103', name = 'Rex Returner') => [id, name, { kickReturns: n, kickReturnYards: n * 24, yardsPerKickReturn: '24.0', longKickReturn: 40, kickReturnTouchdowns: tds }];
const PR = (n, tds, id = '103', name = 'Rex Returner') => [id, name, { puntReturns: n, puntReturnYards: n * 9, yardsPerPuntReturn: '9.0', longPuntReturn: 20, puntReturnTouchdowns: tds }];
const QB = (yds, td, id = '104', name = 'Quinn Quarterback') => [id, name, { 'completions/passingAttempts': '28/40', passingYards: yds, yardsPerPassAttempt: (yds / 40).toFixed(1), passingTouchdowns: td, interceptions: 0, adjQBR: '80.0' }];
// scoring plays, in the recorded shape (type.text, period.number, clock.value in seconds REMAINING, running score, scoring team)
let pid = 0;
const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
function play({ type, text, team, period, clock, home, away }) {
  const p = { id: `p${++pid}`, text, homeScore: home, awayScore: away, type: { text: type, abbreviation: type.startsWith('Field') ? 'FG' : 'TD' }, team: { id: team } };
  if (period !== undefined) p.period = { number: period };
  if (clock !== undefined) p.clock = { value: clock, displayValue: fmtClock(clock) };
  return p;
}
const fg = (team, by, period, clock, home, away, o = {}) => play({ type: o.type || 'Field Goal Good', text: `${by} ${o.yds || 38} Yd Field Goal  `, team, period, clock, home, away });
const td = (team, by, period, clock, home, away) => play({ type: 'Passing Touchdown', text: `${by} 10 Yd pass from Quinn Quarterback (Kay Kicker Kick)`, team, period, clock, home, away });
const noClock = (p) => { const q = { ...p }; delete q.clock; return q; };
const noPeriod = (p) => { const q = { ...p }; delete q.period; return q; };

/** The start every game-winner case shares: 14-14 after a touchdown with 3:00 left in the 4th (home is team 1, away is team 2). */
const tied = () => [td('2', 'Abe Away', 1, 800, 0, 7), td('1', 'Hal Home', 2, 300, 7, 7), td('2', 'Abe Away', 3, 500, 7, 14), td('1', 'Hal Home', 4, 180, 14, 14)];
const q4 = (clock) => fg('1', 'Kay Kicker', 4, clock, 17, 14);
const winnerOf = (g) => (g.homeScore > g.awayScore ? '1' : g.awayScore > g.homeScore ? '2' : null);
const gw = (g) => SS.gameWinningFieldGoals(g.scoringPlays, { homeTeamId: '1', awayTeamId: '2', winnerTeamId: winnerOf(g) });

const evalAll = (g) => SS.evaluateGame(g);
const cand = (g, name = 'Kay Kicker') => evalAll(g).find((c) => c.name === name) || null;
const ids = (c) => (c ? c.met.map((m) => m.rule.id) : []);
const top = (c) => (c ? c.met[0] : null);
const near = (a, b) => Math.abs(a - b) < 1e-9;
/** The `chosen` candidate -> its card strings, the way feed-build builds them. */
const cardOf = (g, name = 'Kay Kicker') => { const c = cand(g, name); return c ? { c, lines: SS.spotlightLines(c), why: SS.spotlightWhy(c) } : null; };

// ═══ [1] the standard as published ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] the standard as published (DI-664 / D-48)');
{
  assert(SS.SPOTLIGHT_STANDARD_VERSION === '2' && SS.SPOTLIGHT_STANDARD.version === '2', '1-1: the standard is version 2 (the version every card prints)');
  assert(SS.SPOTLIGHT_PER_GAME === 1 && SS.SPOTLIGHT_PER_DAY_PER_SPORT === 3, '1-2: the caps are 1 per game and 3 per slate day per sport (kickers and returners share them)');
  const by = (sport, id) => SS.spotlightRules(sport).find((r) => r.id === id);
  const DI = { cfb: { made: 4, long: 50 }, nfl: { made: 5, long: 55 } };
  for (const sport of ['cfb', 'nfl']) {
    const t = DI[sport];
    assert(by(sport, 'k.made') && by(sport, 'k.made').threshold === t.made && by(sport, 'k.made').role === 'K' && by(sport, 'k.made').label === `K: ${t.made}+ field goals`,
      `1-3 (${sport}): kicker, ${t.made}+ field goals made, printed "K: ${t.made}+ field goals"`);
    assert(by(sport, 'k.long') && by(sport, 'k.long').threshold === t.long && by(sport, 'k.long').label === `K: a made field goal of ${t.long}+ yards`,
      `1-4 (${sport}): kicker, a made field goal of ${t.long}+ yards, printed "K: a made field goal of ${t.long}+ yards"`);
    assert(by(sport, 'k.gameWinner') && by(sport, 'k.gameWinner').yes === 'gameWinningFg' && by(sport, 'k.gameWinner').label === 'K: a game-winning field goal', `1-5 (${sport}): kicker, a game-winning field goal (a yes-or-no rule)`);
    assert(by(sport, 'ret.td') && by(sport, 'ret.td').role === 'returner' && by(sport, 'ret.td').yes === 'returnTd' && by(sport, 'ret.td').label === 'Returner: a kick-return or punt-return touchdown',
      `1-6 (${sport}): returner, a kick-return or punt-return touchdown (a yes-or-no rule)`);
    assert(by(sport, 'p.in20') && by(sport, 'p.in20').threshold === 4 && by(sport, 'p.in20').label === 'P: 4+ punts inside the 20', `1-7 (${sport}): punter, 4+ punts inside the 20`);
  }
  assert(SS.spotlightRules('soccer').length === 0 && evalAll({ sport: 'soccer', eventId: '1', homeTeam: HOME, awayTeam: AWAY, box: [] }).length === 0, '1-8: a sport the standard does not name has no rules and selects nobody');
  // the evidence the rules read is in the recorded box scores: the punter rule is in the standard only because ESPN sends the inside-20 count (DI-664)
  const need = { kicking: ['fieldGoalsMade/fieldGoalAttempts', 'longFieldGoalMade'], punting: ['puntsInside20'], kickReturns: ['kickReturnTouchdowns'], puntReturns: ['puntReturnTouchdowns'] };
  for (const sport of ['cfb', 'nfl']) {
    const lacking = Object.entries(need).flatMap(([c, ks]) => ks.filter((k) => !((KEYS[sport][c] || []).includes(k))).map((k) => `${c}.${k}`));
    assert(lacking.length === 0, `1-9 (${sport}): every recorded ${sport} box score carries the keys the special-teams rules read (${lacking.join(', ') || 'kicking, punting, kick and punt returns'})`);
  }
  assert(keyDrift.length === 0, `1-10: a category has the same keys in every recorded game (${keyDrift.join(', ') || 'no drift'}), so the planted box scores below are the recorded shape`);
}

// ═══ [2] kicker: field goals made ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] kicker, field goals made (CFB 4+, NFL 5+)');
{
  for (const [sport, T] of [['cfb', 4], ['nfl', 5]]) {
    const at = cand(game({ sport, h: { kicking: [K(T, T + 1, 40)] } }));
    assert(at && ids(at).join() === 'k.made' && top(at).value === T && near(top(at).weight, 1) && at.role === null,
      `2-1 (${sport}): ${T} field goals made qualifies under k.made only (value ${at && top(at).value}, a kicker has no offensive role)`);
    assert(cand(game({ sport, h: { kicking: [K(T - 1, T + 2, 40)] } })) === null, `2-2 (${sport}): ${T - 1} made (of ${T + 2} tried) does not qualify (one below the threshold)`);
    const over = cand(game({ sport, h: { kicking: [K(T + 1, T + 1, 40)] } }));
    assert(over && top(over).value === T + 1 && near(top(over).weight, (T + 1) / T), `2-3 (${sport}): ${T + 1} made qualifies and ranks above ${T} (value / threshold = ${(T + 1) / T})`);
    assert(cand(game({ sport, h: { kicking: [K(T - 1, T - 1, 40, '9/9')] } })) === null, `2-4 (${sport}): ${T - 1} field goals and 9 extra points does not qualify (extra points are not field goals)`);
  }
  assert(cand(game({ sport: 'cfb', h: { kicking: [K(5, 5, 40)] } })) && cand(game({ sport: 'nfl', h: { kicking: [K(4, 5, 40)] } })) === null && cand(game({ sport: 'cfb', h: { kicking: [K(4, 4, 40)] } })),
    '2-5: the threshold is the SPORT\'s: 4 made qualifies in CFB and not in the NFL; 5 qualifies in both');
  assert(cand(game({ h: { kicking: [K(1, 9, 30)] } })) === null, '2-6: the rule reads field goals MADE, not attempted (1 of 9 does not qualify)');
  const away = cand(game({ home: 23, away: 24, a: { kicking: [K(4, 4, 40)] } }));
  assert(away && away.teamId === '2' && away.teamName === 'Away U' && away.oppName === 'Home U' && away.teamScore === 24 && away.oppScore === 23, '2-7: the away team\'s kicker qualifies the same way (team, opponent and score read from his side)');
  const loser = cand(game({ home: 23, away: 24, h: { kicking: [K(5, 5, 40)] } }));
  assert(loser && loser.teamScore === 23 && loser.oppScore === 24 && /in a 24-23 loss\./.test(SS.spotlightWhy(loser)), '2-8: a kicker on the LOSING side qualifies too, and the card says "loss" (the standard features the performance, not the result)');
}

// ═══ [3] kicker: a long field goal ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] kicker, a made field goal of 50+ yards (CFB) / 55+ (NFL)');
{
  for (const [sport, L] of [['cfb', 50], ['nfl', 55]]) {
    const at = cand(game({ sport, h: { kicking: [K(1, 1, L)] } }));
    assert(at && ids(at).join() === 'k.long' && top(at).value === L && near(top(at).weight, 1), `3-1 (${sport}): a ${L}-yard field goal qualifies under k.long only`);
    assert(cand(game({ sport, h: { kicking: [K(1, 1, L - 1)] } })) === null, `3-2 (${sport}): a ${L - 1}-yard field goal does not qualify (one yard short)`);
    const longer = cand(game({ sport, h: { kicking: [K(1, 1, L + 4)] } }));
    assert(longer && top(longer).value === L + 4 && near(top(longer).weight, (L + 4) / L), `3-3 (${sport}): a ${L + 4}-yard field goal qualifies and carries its distance (${L + 4} / ${L})`);
  }
  assert(cand(game({ sport: 'cfb', h: { kicking: [K(1, 1, 50)] } })) && cand(game({ sport: 'nfl', h: { kicking: [K(1, 1, 50)] } })) === null && cand(game({ sport: 'nfl', h: { kicking: [K(1, 1, 54)] } })) === null,
    '3-4: the distance is the SPORT\'s: 50 qualifies in CFB and not in the NFL (54 is still short there)');
  assert(cand(game({ h: { kicking: [K(1, 1, 30)] } })) === null, '3-5: a kicker who made 1 of 1 (100.0%) from 30 yards does not qualify (the rule reads the longest MADE, not the percentage)');
  const both = cand(game({ h: { kicking: [K(4, 4, 52)] } }));
  assert(both && ids(both).join() === 'k.long,k.made' && near(both.score, 4 / 4 + 52 / 50) && top(both).rule.id === 'k.long', '3-6: 4 made and a 52-yarder qualify under BOTH; the card names the stronger (the distance, 52 / 50), the score is the sum (2.04)');
}

// ═══ [4] kicker: a game-winning field goal ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] kicker, a game-winning field goal: the last 60 seconds of regulation or overtime, ahead for good');
{
  const win = (p) => game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), p] });
  const credited = (g) => ids(cand(g)).includes('k.gameWinner');

  const g41 = win(q4(41));
  const r41 = gw(g41);
  assert(r41.active === true && r41.kicks.length === 1 && r41.kicks[0].kickerName === 'Kay Kicker' && r41.kicks[0].teamId === '1' && r41.kicks[0].period === 4 && r41.kicks[0].clockSec === 41 && r41.kicks[0].yards === 38,
    '4-1: a go-ahead field goal with 0:41 left in the 4th (the DI\'s example) is found, with its kicker, team, period, clock and distance');
  const c41 = cand(g41);
  assert(c41 && ids(c41).join() === 'k.gameWinner' && top(c41).value === 1 && near(top(c41).weight, 1) && near(c41.score, 1), '4-2: the kicker qualifies under k.gameWinner ALONE (2 made does not reach 4), as a yes-or-no rule that counts 1.0');
  assert(credited(win(q4(60))), '4-3: the window\'s edge: exactly 60 seconds left counts ("the last 60 seconds")');
  assert(!credited(win(q4(61))), '4-4: 61 seconds left does not count');
  assert(credited(win(q4(0))) && credited(win(q4(1))), '4-5: the final seconds (0:01 and 0:00) count');
  assert(!credited(win(q4(180))) && !credited(win(q4(480))), '4-6: a go-ahead field goal with 3:00 or 8:00 left is not a game-winner');
  assert(!credited(win(fg('1', 'Kay Kicker', 3, 41, 17, 14))), '4-7: the same 0:41 left in the THIRD period is not a game-winner (the window is the end of regulation)');
  // overtime
  const otTie = [td('2', 'Abe Away', 1, 800, 0, 7), td('1', 'Hal Home', 4, 300, 7, 7), td('2', 'Abe Away', 4, 100, 7, 14), td('1', 'Hal Home', 4, 20, 14, 14)];
  const ot = (period, clock) => game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...otTie, fg('1', 'Kay Kicker', period, clock, 17, 14)] });
  assert(credited(ot(5, 600)) && credited(ot(5, 0)) && credited(ot(6, 600)), '4-8: a go-ahead field goal in overtime counts (1st and 2nd overtime), whatever the clock says');
  assert(credited(game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...otTie, noClock(fg('1', 'Kay Kicker', 5, 600, 17, 14))] })), '4-9: AS BUILT (the DI is silent): an overtime field goal whose play carries no clock still counts (overtime has no 60-second window to measure)');
  // "ahead for good"
  const lead = [td('2', 'Abe Away', 1, 800, 0, 7), td('1', 'Hal Home', 2, 300, 7, 7), td('1', 'Hal Home', 3, 500, 14, 7)];
  const extended = game({ home: 17, away: 7, h: { kicking: [K(2, 2, 38)] }, plays: [...lead, fg('1', 'Kay Kicker', 4, 41, 17, 7)] });
  assert(!credited(extended), '4-10: a field goal at 0:41 that EXTENDS a lead (14-7 to 17-7) does not "put the team ahead": not a game-winner');
  const caught = game({ home: 17, away: 21, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), q4(41), td('2', 'Abe Away', 4, 10, 17, 21)] });
  assert(!credited(caught), '4-11: a go-ahead field goal the other team answers with a touchdown (the team loses) is not a game-winner');
  const retied = game({ home: 20, away: 17, h: { kicking: [K(3, 3, 38)] }, plays: [...tied(), q4(41), fg('2', 'Abe Away', 4, 3, 17, 17), fg('1', 'Kay Kicker', 5, 400, 20, 17)] });
  const rt = gw(retied);
  assert(rt.kicks.length === 1 && rt.kicks[0].period === 5, '4-12: a go-ahead field goal at 0:41 that is TIED again at 0:03 is not "for good": only the overtime kick that decided it is found');
  const truncated = game({ home: 14, away: 21, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), q4(41)] });
  assert(!credited(truncated) && gw(truncated).kicks.length === 0, '4-13: scoring plays that end with the kicker\'s team ahead while the final score says it LOST (a play is missing) are not trusted: no game-winner');
  const tieGame = game({ home: 17, away: 17, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), q4(41), fg('2', 'Abe Away', 4, 3, 17, 17)] });
  assert(!credited(tieGame), '4-14: a game that ended tied has no game-winning field goal');
  const awayKick = game({ home: 14, away: 17, a: { kicking: [K(2, 2, 38)] }, plays: [...tied(), fg('2', 'Kay Kicker', 4, 41, 14, 17)] });
  assert(ids(cand(awayKick)).includes('k.gameWinner') && cand(awayKick).teamId === '2', '4-15: the away team\'s kicker is found the same way');
  // who gets the credit
  const backup = ['105', 'Bo Backup', { 'fieldGoalsMade/fieldGoalAttempts': '0/0', longFieldGoalMade: 0, 'extraPointsMade/extraPointAttempts': '2/2', totalKickingPoints: 2 }];
  const two = game({ home: 17, away: 14, h: { kicking: [K(1, 1, 38), backup] }, plays: [...tied(), q4(41)] });
  assert(ids(cand(two)).includes('k.gameWinner') && cand(two, 'Bo Backup') === null, '4-16: only the kicker who SCORED it gets the credit: the second kicking-line player on the same team (extra points only) does not');
  const same = (id, nm) => [id, nm, { 'fieldGoalsMade/fieldGoalAttempts': '1/1', longFieldGoalMade: 38, 'extraPointsMade/extraPointAttempts': '0/0', totalKickingPoints: 3 }];
  const twins = game({ home: 17, away: 14, h: { kicking: [same('201', 'Sam Same')] }, a: { kicking: [same('202', 'Sam Same')] }, plays: [...tied(), fg('1', 'Sam Same', 4, 41, 17, 14)] });
  const tw = evalAll(twins).filter((c) => c.name === 'Sam Same' && ids(c).includes('k.gameWinner'));
  assert(tw.length === 1 && tw[0].teamId === '1', '4-17: two kickers with the same name on opposite teams: only the one on the scoring team is credited');
  const missed = game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), fg('1', 'Kay Kicker', 4, 41, 17, 14, { type: 'Field Goal Missed' })] });
  assert(gw(missed).kicks.length === 0 && !credited(missed), '4-18: a play typed as a missed (or blocked) field goal is never a made field goal, even if a score is attached to it');
  const tdLate = game({ home: 20, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), td('1', 'Hal Home', 4, 41, 20, 14)] });
  assert(gw(tdLate).kicks.length === 0 && !credited(tdLate), '4-19: a go-ahead TOUCHDOWN in the last minute is not a field goal');

  // every way the scoring plays can fail to carry the time: the rule is INACTIVE for the game, never guessed
  const lastNo = win(noClock(q4(41)));
  assert(gw(lastNo).active === false && !credited(lastNo) && cand(lastNo) === null,
    '4-20: the DI\'s "scoring plays lack the clock" fixture: a 4th-period field goal with no clock makes the rule inactive (the 2-made kicker is not featured on a guess)');
  const lastNoBig = game({ home: 17, away: 14, h: { kicking: [K(4, 4, 38)] }, plays: [...tied(), noClock(q4(41))] });
  const cNoBig = cand(lastNoBig);
  assert(cNoBig && ids(cNoBig).join() === 'k.made' && !/game-winning/.test(SS.spotlightWhy(cNoBig)) && cNoBig.met.every((m) => m.rule.id !== 'k.gameWinner'),
    '4-21: a kicker with 4 made still qualifies on k.made when the clock is missing, and the card NEVER names the game-winning rule (it was not evaluated)');
  const noPer = game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), noPeriod(q4(41))] });
  assert(gw(noPer).active === false && !credited(noPer), '4-22: a field goal whose period is not carried makes the rule inactive');
  const dashScore = game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), { ...q4(41), homeScore: '--', awayScore: '--' }] });
  assert(gw(dashScore).active === false && !credited(dashScore), '4-23: a play whose running score is not a number ("--") makes the rule inactive (a play with the score field ABSENT altogether is OD-2, section [12])');
  for (const [what, plays] of [['null', null], ['an empty list', []], ['undefined', undefined]]) {
    const r = SS.gameWinningFieldGoals(plays, { homeTeamId: '1', awayTeamId: '2', winnerTeamId: '1' });
    assert(r.active === false && r.kicks.length === 0, `4-24 (${what}): no scoring plays at all: the rule is inactive`);
  }
  assert(SS.gameWinningFieldGoals(win(q4(41)).scoringPlays, {}).active === false, '4-25: without both team ids the rule is inactive');
  const q1noClock = game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [noClock(fg('1', 'Kay Kicker', 1, 600, 3, 0)), td('2', 'Abe Away', 1, 400, 3, 7), td('1', 'Hal Home', 3, 500, 10, 7), td('2', 'Abe Away', 3, 100, 10, 14), td('1', 'Hal Home', 4, 180, 14, 14), q4(41)] });
  assert(gw(q1noClock).active === true && credited(q1noClock), '4-26: AS BUILT (the DI is silent): a missing clock on a FIRST-quarter field goal does not make the rule inactive (it could never be in the last 60 seconds)');
  const mixed = game({ home: 20, away: 17, h: { kicking: [K(3, 3, 38)] }, plays: [...tied(), noClock(fg('2', 'Abe Away', 4, 90, 14, 17)), fg('1', 'Kay Kicker', 4, 3, 17, 17), fg('1', 'Kay Kicker', 5, 400, 20, 17)] });
  assert(gw(mixed).active === false && !credited(mixed), '4-27: ONE 4th-period field goal without a clock makes the rule inactive for the WHOLE game: the valid overtime kick in the same game is not credited either');
}

// ═══ [5] returner ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] returner: a kick-return or punt-return touchdown');
{
  for (const sport of ['cfb', 'nfl']) {
    const kr = cand(game({ sport, h: { kickReturns: [KR(2, 1)] } }), 'Rex Returner');
    assert(kr && ids(kr).join() === 'ret.td' && top(kr).value === 1 && near(top(kr).weight, 1) && near(kr.score, 1) && kr.role === null && kr.stats.returnTdCount === 1,
      `5-1 (${sport}): one kick-return touchdown qualifies under ret.td (a yes-or-no rule, 1.0), whatever the role (here none)`);
    const pr = cand(game({ sport, h: { puntReturns: [PR(3, 1)] } }), 'Rex Returner');
    assert(pr && ids(pr).join() === 'ret.td' && pr.stats.returnTdCount === 1, `5-2 (${sport}): one punt-return touchdown qualifies`);
    assert(cand(game({ sport, h: { kickReturns: [KR(6, 0)] } }), 'Rex Returner') === null && cand(game({ sport, h: { puntReturns: [PR(6, 0)] } }), 'Rex Returner') === null,
      `5-3 (${sport}): six returns for 144 yards and no touchdown does not qualify (returns are not touchdowns)`);
  }
  const both = cand(game({ h: { kickReturns: [KR(2, 1)], puntReturns: [PR(2, 1)] } }), 'Rex Returner');
  assert(both && ids(both).join() === 'ret.td' && both.stats.returnTdCount === 2 && near(both.score, 1) && /2 return touchdowns/.test(SS.spotlightWhy(both)),
    '5-4: a kick-return AND a punt-return touchdown by one player: still ONE yes-or-no rule (score 1.0), the card counts two ("2 return touchdowns")');
  const wr = cand(game({ h: { kickReturns: [KR(2, 1, '104', 'Wes Receiver')], receiving: [['104', 'Wes Receiver', { receptions: 5, receivingYards: 61, yardsPerReception: '12.2', receivingTouchdowns: 0, longReception: 25 }]] } }), 'Wes Receiver');
  assert(wr && wr.role === 'WR/TE' && ids(wr).join() === 'ret.td', '5-5: "any returner": a receiver who also returns a kick for a touchdown qualifies as a returner (and his role stays WR/TE)');
  assert(cand(game({ h: { defensive: [['106', 'Dee Defender', { totalTackles: 8, soloTackles: 5, sacks: 0, tacklesForLoss: 1, passesDefended: 1, hurries: 0, defensiveTouchdowns: 1 }]] } }), 'Dee Defender') === null,
    '5-6: a defensive touchdown is not a return touchdown (nor a "defensive touchdown plus another turnover" on its own)');
  // the field absent: the category without the touchdown key can say nothing about touchdowns
  const noKey = cand(game({ h: { kickReturns: [KR(6, 0)], puntReturns: [PR(2, 1, '107', 'Pia Punt')] }, hOpts: { dropKeys: { kickReturns: ['kickReturnTouchdowns'] } } }), 'Pia Punt');
  assert(noKey && ids(noKey).join() === 'ret.td', '5-7: a box score whose KICK-return category lacks the touchdown key still credits a PUNT-return touchdown (each field is read on its own)');
  const none = cand(game({ h: { kickReturns: [KR(4, 1)] }, hOpts: { dropKeys: { kickReturns: ['kickReturnTouchdowns'] } } }), 'Rex Returner');
  assert(none === null, '5-8: with the touchdown key absent from every return category, nobody qualifies as a returner (the rule is inactive; nothing is guessed from the return count)');
  assert(cand(game({ h: {} }), 'Rex Returner') === null && cand(game({ h: { kickReturns: [] } }), 'Rex Returner') === null, '5-9: a box score with no return categories (or no returners) features nobody');
}

// ═══ [6] punter ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] punter: 4+ punts inside the 20 (both sports)');
{
  for (const sport of ['cfb', 'nfl']) {
    const at = cand(game({ sport, h: { punting: [P(7, 4)] } }), 'Pat Punter');
    assert(at && ids(at).join() === 'p.in20' && top(at).value === 4 && near(top(at).weight, 1) && near(at.score, 1) && at.role === null, `6-1 (${sport}): 4 punts inside the 20 qualifies under p.in20`);
    assert(cand(game({ sport, h: { punting: [P(9, 3)] } }), 'Pat Punter') === null, `6-2 (${sport}): 3 inside the 20 (of 9 punts) does not qualify (one below)`);
    const over = cand(game({ sport, h: { punting: [P(8, 5)] } }), 'Pat Punter');
    assert(over && top(over).value === 5 && near(top(over).weight, 1.25), `6-3 (${sport}): 5 inside the 20 qualifies and ranks above 4 (5 / 4)`);
  }
  assert(cand(game({ h: { punting: [P(12, 2)] } }), 'Pat Punter') === null, '6-4: the rule reads punts INSIDE THE 20, not total punts (12 punts, 2 inside does not qualify)');
  const noCount = cand(game({ h: { punting: [P(9, 6)] }, hOpts: { dropKeys: { punting: ['puntsInside20'] } } }), 'Pat Punter');
  assert(noCount === null, '6-5: a box score whose punting line has no inside-20 count: the punter rule is inactive (nothing is guessed from total punts)');
  assert(cand(game({ h: { kicking: [K(1, 1, 30)] } }), 'Pat Punter') === null && cand(game({ h: {} }), 'Pat Punter') === null, '6-6: a game with no punting category features no punter');
  const kickerPunter = game({ h: { kicking: [K(1, 1, 30)], punting: [P(9, 4, '101', 'Kay Kicker')] } });
  const kp = cand(kickerPunter);
  assert(kp && ids(kp).join() === 'p.in20' && top(kp).value === 4, '6-7: a player in BOTH the kicking and the punting lines is judged on each rule separately (his 1 field goal adds nothing, his 4 inside the 20 qualifies)');
}

// ═══ [7] absent fields ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] a rule whose field is absent is inactive for that game, and its label is never named (DI-664)');
{
  // a kicker who would qualify twice over; remove one field at a time
  const big = (opts) => cand(game({ h: { kicking: [K(5, 5, 55)] }, hOpts: opts }));
  const full = big({});
  assert(full && ids(full).join() === 'k.made,k.long', '7-1: with both fields, a 5-for-5 kicker with a 55-yarder qualifies under k.made (5 / 4) and k.long (55 / 50)');
  const noMade = big({ dropKeys: { kicking: ['fieldGoalsMade/fieldGoalAttempts'] } });
  assert(noMade && ids(noMade).join() === 'k.long' && !SS.spotlightWhy(noMade).includes('field goals made') && !SS.spotlightWhy(noMade).includes('K: 4+'),
    '7-2: without the made/attempted key only k.long is evaluated; the card never names "K: 4+ field goals"');
  const noLong = big({ dropKeys: { kicking: ['longFieldGoalMade'] } });
  assert(noLong && ids(noLong).join() === 'k.made' && !SS.spotlightWhy(noLong).includes('50+ yards'), '7-3: without the longest-made key only k.made is evaluated; the card never names "50+ yards"');
  assert(big({ dropKeys: { kicking: ['longFieldGoalMade', 'fieldGoalsMade/fieldGoalAttempts'] } }) === null, '7-4: with neither key nobody qualifies as a kicker');
  assert(big({ omit: ['kicking'] }) === null, '7-5: a box score with no kicking category features no kicker');
  // every candidate\'s rules are among the rules its box score could evaluate
  const evaluated = recorded.flatMap((r) => { const g = EV.spotlightGame(EV.parseSummary(r.json, r.sport)); return g ? evalAll(g).flatMap((c) => c.met.map((m) => `${r.file}:${c.name}:${m.rule.id}`)) : []; });
  assert(evaluated.length > 0 && evaluated.every((s) => /:(qb|rb|wr|def|k|ret|p)\./.test(s)), `7-6: on the recorded games every rule a card names is a rule of the published list (${evaluated.length} named)`);
}

// ═══ [8] the cap and the ranking ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] the cap and the ranking the special-teams positions share with every other position');
{
  // the DI\'s kicker fixture: 4 field goals, a 52-yard make, a go-ahead make with 0:41 left
  const plays = [td('2', 'Abe Away', 1, 800, 0, 7), td('1', 'Hal Home', 2, 300, 7, 7), td('2', 'Abe Away', 3, 500, 7, 14), td('1', 'Hal Home', 4, 180, 14, 14), fg('1', 'Kay Kicker', 4, 41, 17, 14)];
  const diKick = game({ eventId: '9101', home: 17, away: 14, h: { kicking: [K(4, 4, 52)] }, plays });
  const dk = cand(diKick);
  assert(dk && ids(dk).join() === 'k.long,k.gameWinner,k.made' && near(dk.score, 4 / 4 + 52 / 50 + 1) && near(dk.score, 3.04), '8-1: the DI\'s kicker fixture (4 made, a 52-yarder, a 0:41 go-ahead) qualifies three ways; the score is the SUM 1 + 1.04 + 1 = 3.04');
  const sel = SS.selectSpotlights([diKick]);
  assert(sel.length === 1 && sel[0].rationale.ruleId === 'k.long' && sel[0].rationale.value === 52 && sel[0].rationale.rule === 'K: a made field goal of 50+ yards', '8-2: the rationale names the strongest rule (the 52-yard make, 52 / 50), not the first or the weakest');
  assert(Object.isFrozen(sel[0].rationale) && sel[0].rationale.standardVersion === '2' && sel[0].rationale.rank === 1 && sel[0].rationale.ofCandidates === 1, '8-3: the stored rationale is frozen and carries { standardVersion, rule, value, rank, ofCandidates }');
  // the sum decides: the kicker (3.04) outranks a passer (2.325) who is stronger on any single stat than any one of the kicker\'s
  const qbGame = game({ eventId: '9102', h: { passing: [QB(450, 6)] } });
  const order = SS.selectSpotlights([qbGame, diKick]);
  assert(near(cand(qbGame, 'Quinn Quarterback').score, 450 / 400 + 6 / 5) && order[0].name === 'Kay Kicker' && order[1].name === 'Quinn Quarterback',
    '8-4: ranking is the SUM of value / threshold: the 3.04 kicker is ahead of the 2.325 passer (450 / 400 + 6 / 5), though the passer\'s best single stat (1.2) beats the kicker\'s (1.04)');
  // one per game, whoever it is
  const crowded = game({ eventId: '9103', h: { passing: [QB(450, 6)], kicking: [K(4, 4, 38)], kickReturns: [KR(2, 1)], punting: [P(8, 5)] } });
  assert(evalAll(crowded).length === 4, '8-5: one game with a passer, a kicker, a returner and a punter all qualifying lists four candidates');
  const one = SS.selectSpotlights([crowded]);
  assert(one.length === 1 && one[0].name === 'Quinn Quarterback' && one[0].rationale.ofCandidates === 1, '8-6: only ONE is selected per game (the best; the others are not spotlighted)');
  // three per slate day, kickers and returners in the same cap
  const day = [
    game({ eventId: '9201', kickoffMs: KICKOFF + 1, h: { passing: [QB(450, 6)] } }),                                     // 2.325
    game({ eventId: '9202', kickoffMs: KICKOFF + 2, home: 17, away: 14, h: { kicking: [K(4, 4, 52)] }, plays }),            // 3.04
    game({ eventId: '9203', kickoffMs: KICKOFF + 3, h: { kickReturns: [KR(2, 1)] } }),                                     // 1.0
    game({ eventId: '9204', kickoffMs: KICKOFF + 4, h: { punting: [P(8, 5)] } }),                                          // 1.25
    game({ eventId: '9205', kickoffMs: KICKOFF + 5, h: { kicking: [K(4, 4, 38)] } }),                                      // 1.0
  ];
  const three = SS.selectSpotlights(day);
  assert(three.length === 3 && three.map((c) => c.name).join() === 'Kay Kicker,Quinn Quarterback,Pat Punter' && three.map((c) => c.rationale.rank).join() === '1,2,3' && three.every((c) => c.rationale.ofCandidates === 5),
    `8-7: five games, five qualifiers: the day keeps THREE (kicker 3.04, passer 2.325, punter 1.25) and the returner and the 4-made kicker (1.0 each) are out (${three.map((c) => c.name).join(', ')})`);
  // ties: the later game, then the name
  const ties = SS.selectSpotlights([
    game({ eventId: '9301', kickoffMs: KICKOFF + 1, h: { kickReturns: [KR(2, 1, '103', 'Zed Returner')] } }),
    game({ eventId: '9302', kickoffMs: KICKOFF + 2, h: { kicking: [K(4, 4, 38)] } }),
    game({ eventId: '9303', kickoffMs: KICKOFF + 3, h: { passing: [QB(300, 5)] } }),
    game({ eventId: '9304', kickoffMs: KICKOFF + 4, h: { punting: [P(8, 4)] } }),
  ]);
  assert(ties.map((c) => c.name).join() === 'Pat Punter,Quinn Quarterback,Kay Kicker', `8-8: four 1.0s (a returner, a kicker, a passer, a punter): the three LATEST games are kept, in that order, whatever the position (${ties.map((c) => c.name).join(', ')})`);
  const sameTime = SS.selectSpotlights([
    game({ eventId: '9401', h: { kickReturns: [KR(2, 1, '103', 'Zed Returner')] } }),
    game({ eventId: '9402', h: { kicking: [K(4, 4, 38)] } }),
    game({ eventId: '9403', h: { punting: [P(8, 4)] } }),
  ]);
  assert(sameTime.map((c) => c.name).join() === 'Kay Kicker,Pat Punter,Zed Returner', `8-9: three 1.0s in games at the same time: alphabetical by name (${sameTime.map((c) => c.name).join(', ')})`);
  assert(near(cand(game({ h: { kickReturns: [KR(2, 1)] } }), 'Rex Returner').score, 1) && near(cand(game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays }), 'Kay Kicker').score, 1),
    '8-10: a return touchdown and a game-winning field goal each count exactly 1.0 (a yes-or-no rule is neither a bonus nor a penalty)');
  assert(SS.selectSpotlights([]).length === 0 && SS.selectSpotlights(null).length === 0 && SS.selectSpotlights([game({ h: { kicking: [K(3, 3, 49)] } })]).length === 0, '8-11: no qualifier means no card (3 field goals, a 49-yarder: nothing is featured)');
}

// ═══ [9] the card text ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[9] the card text: Why featured, the stat lines, the window, and no stat that is not in the evidence');
{
  const END = 'Selected under the Munera Spotlight standard v2';
  const plays = [td('2', 'Abe Away', 1, 800, 0, 7), td('1', 'Hal Home', 2, 300, 7, 7), td('2', 'Abe Away', 3, 500, 7, 14), td('1', 'Hal Home', 4, 180, 14, 14), fg('1', 'Kay Kicker', 4, 41, 24, 14)];
  const k5 = cardOf(game({ home: 24, away: 23, h: { kicking: [K(5, 5, 44)] } }));
  assert(k5.why === `Why featured: 5 field goals in a 24-23 win. ${END} (K: 4+ field goals).`, `9-1: the DI's kicker example, character for character: "${k5.why}"`);
  assert(k5.lines.join('|') === '5/5 field goals, long 44', `9-2: the kicker's stat line is made / attempted and the longest made, from the box score only ("${k5.lines.join('|')}")`);
  const kl = cardOf(game({ h: { kicking: [K(1, 1, 52)] } }));
  assert(kl.why === `Why featured: a 52-yard field goal in a 24-23 win. ${END} (K: a made field goal of 50+ yards).`, `9-3: a long field goal: "${kl.why}"`);
  const kg = cardOf(game({ home: 24, away: 23, h: { kicking: [K(2, 2, 38)] }, plays }));
  assert(kg.why === `Why featured: the game-winning field goal in a 24-23 win. ${END} (K: a game-winning field goal).`, `9-4: a game-winning field goal: "${kg.why}"`);
  const rt = cardOf(game({ h: { kickReturns: [KR(2, 1)] } }), 'Rex Returner');
  assert(rt.why === `Why featured: a return touchdown in a 24-23 win. ${END} (Returner: a kick-return or punt-return touchdown).` && rt.lines.join('|') === '1 return touchdown', `9-5: a returner: "${rt.why}" / "${rt.lines.join('|')}"`);
  const rt2 = cardOf(game({ h: { kickReturns: [KR(2, 1)], puntReturns: [PR(2, 1)] } }), 'Rex Returner');
  assert(rt2.lines.join('|') === '2 return touchdowns' && /^Why featured: 2 return touchdowns in a 24-23 win\./.test(rt2.why), '9-6: two return touchdowns are counted, in both the line and the sentence');
  const pu = cardOf(game({ h: { punting: [P(8, 4)] } }), 'Pat Punter');
  assert(pu.why === `Why featured: 4 punts inside the 20 in a 24-23 win. ${END} (P: 4+ punts inside the 20).` && pu.lines.join('|') === '4 punts inside the 20', `9-7: a punter: "${pu.why}" / "${pu.lines.join('|')}"`);
  const nfl = cardOf(game({ sport: 'nfl', h: { kicking: [K(5, 6, 47)] } }));
  assert(nfl.why === `Why featured: 5 field goals in a 24-23 win. ${END} (K: 5+ field goals).` && nfl.lines.join('|') === '5/6 field goals, long 47', `9-8: NFL prints the NFL threshold ("K: 5+ field goals"), and the misses stay in the line (5/6)`);
  const loss = cardOf(game({ home: 23, away: 24, h: { kicking: [K(5, 5, 44)] } }));
  assert(/in a 24-23 loss\. Selected/.test(loss.why), '9-9: the window is the one game: the sentence states its final score and the result for the featured player\'s team ("24-23 loss")');
  assert([k5, kl, kg, rt, rt2, pu, nfl, loss].every((x) => x.lines.length >= 1 && x.lines.length <= 3), '9-10: every special-teams card has 1 to 3 stat lines');
  // no stat that is not in the evidence: every number a line or a sentence prints is a number the game\'s box score or final score carries
  const digits = (s) => (String(s).match(/\d+/g) || []).map(Number);
  const evidence = (g, extra = []) => new Set([...digits(JSON.stringify(g.box.map((t) => t.statistics.map((c) => c.athletes.map((a) => a.stats))))), g.homeScore, g.awayScore, ...extra]);
  const planted = [[game({ home: 24, away: 23, h: { kicking: [K(5, 5, 44)] } }), 'Kay Kicker'], [game({ h: { kicking: [K(1, 1, 52)] } }), 'Kay Kicker'], [game({ home: 24, away: 23, h: { kicking: [K(2, 2, 38)] }, plays }), 'Kay Kicker'],
    [game({ h: { kickReturns: [KR(2, 1)] } }), 'Rex Returner'], [game({ h: { punting: [P(8, 4)] } }), 'Pat Punter'], [game({ sport: 'nfl', h: { kicking: [K(5, 6, 47)] } }), 'Kay Kicker']];
  const stray = [];
  for (const [g, nm] of planted) {
    const x = cardOf(g, nm); const ok = evidence(g, [1, 2, 4, 5, 20, 50, 55]);   // the thresholds and the version printed in the label are the standard\'s own words
    for (const n of digits(`${x.lines.join(' ')} ${x.why}`)) if (!ok.has(n)) stray.push(`${nm}:${n}`);
    if (/undefined|null|NaN|Infinity/.test(`${x.lines.join(' ')} ${x.why}`)) stray.push(`${nm}:undefined`);
  }
  assert(stray.length === 0, `9-11: on the planted cards every number printed is in the box score or the final score, and nothing prints "undefined" or "null" (${stray.join(', ') || 'none stray'})`);
  // the same property on every recorded candidate (all positions), because the special-teams lines share the function with the rest
  const strayRec = [];
  for (const r of recorded) {
    const g = EV.spotlightGame(EV.parseSummary(r.json, r.sport)); if (!g) continue;
    const ok = evidence(g, [1, 2, 3, 4, 5, 20, 50, 55, 150, 175, 200, 400]);
    for (const c of evalAll(g)) {
      const text = `${SS.spotlightLines(c).join(' ')} ${SS.spotlightWhy(c)}`;
      for (const n of digits(text)) if (!ok.has(n)) strayRec.push(`${r.file}:${c.name}:${n}`);
      if (/undefined|null|NaN|Infinity/.test(text)) strayRec.push(`${r.file}:${c.name}:undefined`);
    }
  }
  assert(strayRec.length === 0, `9-12: on every candidate in the recorded games, every number printed is in the evidence and nothing prints "undefined" (${strayRec.join(', ') || 'none stray'})`);
  // the published card (sports-evidence.buildSpotlight) carries the window: opponent, score, date, and sources every stat line to the box score
  const nflRec = rec('401872974');
  const rg = EV.spotlightGame(EV.parseSummary(nflRec.json, 'nfl'));
  const chosen = SS.selectSpotlights([rg])[0];
  const built = EV.buildSpotlight(chosen, rg, { lines: SS.spotlightLines(chosen), why: SS.spotlightWhy(chosen), asOfMs: Date.parse('2026-10-08T17:00:00Z') });
  assert(built.card.name === 'Will Reichard' && built.card.team === 'Minnesota' && built.card.opponent === 'Miami' && built.card.score === '15-10' && built.card.result === 'won' && built.card.date === '2026-10-04',
    `9-13: the published card states the game: athlete, team, opponent, score, result and date (${built.card.name}, ${built.card.team} vs ${built.card.opponent}, ${built.card.score} ${built.card.result}, ${built.card.date})`);
  assert(built.facts.filter((f) => f.text.startsWith('Will Reichard: ')).every((f) => f.source && f.source.id === 'espn.boxscore') && built.facts.some((f) => /5\/5 field goals, long 50/.test(f.text)) && built.facts.some((f) => /K: 5\+ field goals \(Munera Spotlight standard v2\)/.test(f.text)),
    '9-14: the kicker\'s stat line is a fact sourced to the ESPN box score, and the rule is a fact sourced to the standard');
}

// ═══ [10] the recorded games ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[10] the recorded games: real kickers, returners and punters at and below the thresholds');
{
  const gameOf = (id) => { const r = rec(id); return EV.spotlightGame(EV.parseSummary(r.json, r.sport)); };
  const get = (id, name) => evalAll(gameOf(id)).find((c) => c.name === name) || null;
  const mo = get('401856708', 'Blake Craig');
  assert(mo && ids(mo).join() === 'k.long' && top(mo).value === 52 && mo.stats.fgMade === 3 && mo.stats.fgAtt === 4, '10-1: (CFB 401856708) Missouri\'s Blake Craig: a 52-yard field goal qualifies; his 3 of 4 does NOT (one short of 4)');
  const az = get('401856817', 'Carson Smith');
  assert(az && ids(az).join() === 'k.made' && top(az).value === 4 && az.stats.fgMade === 4 && az.stats.fgAtt === 4 && az.stats.fgLong === 46, '10-2: (CFB 401856817) Arizona State\'s Carson Smith: 4 of 4 qualifies AT the threshold (his longest, 46, is under 50)');
  const nd = get('401858250', 'Jaden Jefferson');
  assert(nd && ids(nd).join() === 'ret.td' && nd.stats.returnTdCount === 1 && nd.role === null, '10-3: (CFB 401858250) North Carolina\'s Jaden Jefferson: a 98-yard kickoff-return touchdown qualifies as a returner');
  const pu = get('401869956', 'Devin Roche');
  assert(pu && ids(pu).join() === 'ret.td' && pu.stats.returnTdCount === 1, '10-4: (CFB 401869956) Devin Roche: a 78-yard punt-return touchdown qualifies');
  const lt = get('401872969', 'Cam Little');
  assert(lt && ids(lt).join() === 'k.long' && top(lt).value === 55 && lt.stats.fgMade === 3, '10-5: (NFL 401872969) Jacksonville\'s Cam Little: a 55-yard field goal qualifies AT the NFL distance (his 3 made is under 5)');
  const rei = get('401872974', 'Will Reichard');
  assert(rei && ids(rei).join() === 'k.made' && top(rei).value === 5 && rei.stats.fgMade === 5 && rei.stats.fgLong === 50, '10-6: (NFL 401872974) Minnesota\'s Will Reichard: 5 of 5 qualifies AT the NFL count; his 50-yarder does NOT qualify there (55+ in the NFL)');
  const asCfb = evalAll({ ...gameOf('401872974'), sport: 'cfb' }).find((c) => c.name === 'Will Reichard');
  assert(asCfb && ids(asCfb).join() === 'k.made,k.long', '10-7: the same box score read under the CFB thresholds qualifies his 50-yarder as well: the distance really is per sport');
  // the punters: Alec Clark's 3 inside the 20 (8 punts) is the real "one short"; and across every recorded game the punters credited are exactly those with 4+ inside the 20
  const clark = evalAll(gameOf('401856708')).find((c) => c.name === 'Alec Clark');
  const punters = recorded.flatMap((r) => (r.json.boxscore.players || []).flatMap((t) => t.statistics.filter((c) => c.name === 'punting').flatMap((c) => c.athletes.map((a) => ({ name: a.athlete.displayName, in20: Number(a.stats[c.keys.indexOf('puntsInside20')]) })))));
  const credited = new Set(recorded.flatMap((r) => { const g = EV.spotlightGame(EV.parseSummary(r.json, r.sport)); return g ? evalAll(g).filter((c) => ids(c).includes('p.in20')).map((c) => c.name) : []; }));
  const expected = new Set(punters.filter((x) => x.in20 >= 4).map((x) => x.name));
  const clarkRow = punters.find((x) => x.name === 'Alec Clark');
  assert(clark === undefined && clarkRow && clarkRow.in20 === 3 && punters.length >= 10 && [...credited].sort().join() === [...expected].sort().join(),
    `10-8: (CFB 401856708) Alec Clark: 8 punts, 3 inside the 20 is NOT a spotlight (one short of 4); across the ${punters.length} recorded punters the ones credited are exactly those with 4+ inside the 20 (${[...credited].join(', ') || 'none do'})`);
  // the recorded games never carry a game-winning field goal; the rule runs (active) and finds none
  const gwAll = recorded.map((r) => { const g = EV.spotlightGame(EV.parseSummary(r.json, r.sport)); return g ? SS.gameWinningFieldGoals(g.scoringPlays, { homeTeamId: g.homeTeam.id, awayTeamId: g.awayTeam.id, winnerTeamId: g.homeScore > g.awayScore ? g.homeTeam.id : g.awayTeam.id }) : null; }).filter(Boolean);
  assert(gwAll.length >= 6 && gwAll.every((x) => x.active === true && x.kicks.length === 0), '10-9: on the recorded final games the game-winning rule is ACTIVE (every field goal carries a period and a clock) and finds none');
  // Reichard\'s last field goal (15-10, Q4 6:41) is NOT a game-winner at 6:41; at 0:41 it would still not be (it extends a 12-10 lead)
  const g74 = gameOf('401872974');
  const late = { ...g74, scoringPlays: g74.scoringPlays.map((p) => (p.period.number === 4 ? { ...p, clock: { value: 41, displayValue: '0:41' } } : p)) };
  assert(!ids(evalAll(late).find((c) => c.name === 'Will Reichard')).includes('k.gameWinner'), '10-10: on the real plays with the last field goal moved to 0:41: it still is not a game-winner (it extended a 12-10 lead to 15-10)');
  // the returner rule agrees with the scoring plays (the DI words it as "a scoring play of type kick return or punt return"; the standard reads the box score\'s touchdown stat)
  const mismatch = [];
  for (const r of recorded) {
    const g = EV.spotlightGame(EV.parseSummary(r.json, r.sport)); if (!g) continue;
    const fromBox = new Set(evalAll(g).filter((c) => ids(c).includes('ret.td')).map((c) => c.name));
    const fromPlays = new Set(g.scoringPlays.filter((p) => /(kickoff|kick|punt) return touchdown/i.test(p.type.text)).map((p) => p.text.replace(/ \d+ Yd .*$/, '').trim()));
    if ([...fromBox].sort().join() !== [...fromPlays].sort().join()) mismatch.push(`${r.file}: box [${[...fromBox]}] plays [${[...fromPlays]}]`);
  }
  assert(mismatch.length === 0, `10-11: on the recorded games the returners the standard credits are exactly the scorers of the "Kickoff Return Touchdown" / "Punt Return Touchdown" scoring plays (${mismatch.join('; ') || 'identical'})`);
  // the game-winning rule matches the scorer by NAME: on real data the scoring-play name must equal the box score\'s kicking-line name for every field goal
  const unmatched = [];
  for (const r of recorded) {
    for (const p of (r.json.scoringPlays || [])) {
      if (!/field goal/i.test(p.type.text)) continue;
      const m = String(p.text).match(/^(.{2,80}?) (\d{1,2}) Yd Field Goal/i);
      const team = r.json.boxscore.players.find((t) => String(t.team.id) === String(p.team.id));
      const names = new Set(team.statistics.filter((c) => c.name === 'kicking').flatMap((c) => c.athletes.map((a) => a.athlete.displayName)));
      if (!m || !names.has(m[1].trim()) || !(p.period && Number.isFinite(p.period.number)) || !(p.clock && Number.isFinite(p.clock.value))) unmatched.push(`${r.file}:${p.text.trim()}`);
    }
  }
  assert(unmatched.length === 0, `10-12: on the recorded games every field-goal scoring play parses to a kicker who is in the box score's kicking line, with a period and a clock (${unmatched.length} do not)`);
}

// ═══ [11] static ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[11] static: deterministic, no popularity wording');
{
  const code = readFileSync(join(HERE, STD), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  assert(!/\bDate\b|Math\.random|\bfetch\s*\(|\bprocess\b|\bimport\s+/.test(code), '11-1: the standard reads no clock, no randomness, no network and imports nothing (comment-stripped source)');
  assert(!/\b(popular\w*|trending|viral|reach|status symbol|followers|fan favorite|likes)\b/i.test(code), '11-2: no popularity, trending, reach or "status symbol" wording in the standard\'s code (DI-664)');
  const g = game({ home: 17, away: 14, h: { kicking: [K(4, 4, 52)] }, plays: [td('2', 'Abe Away', 1, 800, 0, 7), td('1', 'Hal Home', 2, 300, 7, 7), td('2', 'Abe Away', 3, 500, 7, 14), td('1', 'Hal Home', 4, 180, 14, 14), fg('1', 'Kay Kicker', 4, 41, 17, 14)] });
  assert(JSON.stringify(SS.selectSpotlights([g])) === JSON.stringify(SS.selectSpotlights([g])), '11-3: the same game selects the same card every time (deterministic: no model, no clock)');
  const x = cardOf(g);
  assert(!/\b(popular\w*|trending|viral|reach|status symbol)\b/i.test(`${x.why} ${x.lines.join(' ')}`), '11-4: a special-teams card carries no popularity wording');
}

// ═══ [12] absent is not zero ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[12] absent is not zero (review rulings OD-1..3): a field the source does not carry is never read as 0 and never printed (DI-664: "never guessed")');
{
  const BAD = /undefined|null|NaN|Infinity/;
  const noLongKey = { hOpts: { dropKeys: { kicking: ['longFieldGoalMade'] } } };
  // OD-1 — the kicker's stat line when the box score has no longest-made field (and its published fact)
  const od1 = cardOf(game({ h: { kicking: [K(5, 5, 44)] }, ...noLongKey }));
  const od1Text = od1 ? od1.lines.join(' | ') : '(no card)';
  assert(od1 && od1.lines.join('|') === '5/5 field goals' && !BAD.test(od1Text) && ids(od1.c).join() === 'k.made',
    `12-1 (OD-1): a 5-for-5 kicker whose box score has NO longest-made field: the line is "5/5 field goals" (the long clause is left out, not printed as undefined) and k.long is not evaluated ("${od1Text}")`);
  const od1Game = game({ h: { kicking: [K(5, 5, 44)] }, ...noLongKey });
  const od1Pick = SS.selectSpotlights([od1Game])[0];
  const od1Built = EV.buildSpotlight(od1Pick, EV.spotlightGame(EV.parseSummary(rec('401872974').json, 'nfl')), { lines: SS.spotlightLines(od1Pick), why: SS.spotlightWhy(od1Pick), asOfMs: 0 });
  assert(od1Built.facts.every((f) => !BAD.test(f.text)) && od1Built.facts.some((f) => f.text === 'Kay Kicker: 5/5 field goals.'),
    `12-2 (OD-1b): ...so the published card carries only facts the evidence supports ("${od1Built.facts.map((f) => f.text).find((t) => BAD.test(t)) || od1Built.facts.map((f) => f.text)[1]}")`);
  for (const [what, cell] of [['an empty cell', ''], ['a blank cell', '   '], ['a "--" cell', '--']]) {
    const c = cardOf(game({ h: { kicking: [K(5, 5, cell)] } }));
    assert(c && c.lines.join('|') === '5/5 field goals' && !BAD.test(c.lines.join(' ')) && ids(c.c).join() === 'k.made',
      `12-3 (${what}): the longest-made cell present but ${what}: it is not 0 and not printed ("${c && c.lines.join('|')}"), and k.long does not fire`);
  }
  const noAtt = cardOf(game({ h: { kicking: [['101', 'Kay Kicker', { 'fieldGoalsMade/fieldGoalAttempts': '5', longFieldGoalMade: 44 }]] } }));
  assert(noAtt && noAtt.lines.join('|') === '5 field goals, long 44' && !BAD.test(noAtt.lines.join(' ')), `12-4: a made/attempted cell with no attempts in it prints the made count alone, never "5/null" or "5/0" ("${noAtt && noAtt.lines.join('|')}")`);
  const noCmp = cand(game({ h: { passing: [['104', 'Quinn Quarterback', { 'completions/passingAttempts': '/40', passingYards: 450, passingTouchdowns: 6 }]] } }), 'Quinn Quarterback');
  assert(noCmp && !BAD.test(SS.spotlightLines(noCmp).join(' ')) && SS.spotlightLines(noCmp)[0].startsWith('450 passing yards'), `12-5: the same for a passer (a completions/attempts cell with no completions in it prints no "null/40": "${noCmp && SS.spotlightLines(noCmp)[0]}")`);

  // OD-2 — a go-ahead is never credited from a running score the plays do not carry (the previous play: 14-7 after a touchdown, then a 0:41 field goal to 17-7 that only EXTENDS the lead)
  const variants = [['absent', (o, k) => { delete o[k]; }], ['null', (o, k) => { o[k] = null; }], ['an empty string', (o, k) => { o[k] = ''; }], ['a blank string', (o, k) => { o[k] = '   '; }]];
  for (const [what, put] of variants) {
    const prev = td('1', 'Hal Home', 3, 500, 14, 7); put(prev, 'homeScore'); put(prev, 'awayScore');
    const g = game({ home: 17, away: 7, h: { kicking: [K(2, 2, 38)] }, plays: [td('2', 'Abe Away', 1, 800, 0, 7), td('1', 'Hal Home', 2, 300, 7, 7), prev, fg('1', 'Kay Kicker', 4, 41, 17, 7)] });
    assert(gw(g).active === false && cand(g) === null, `12-6 (OD-2, running score ${what}): the rule is inactive; a field goal that only extended a 14-7 lead is not credited as the go-ahead (active ${gw(g).active}, ${ids(cand(g)).join() || 'no card'})`);
  }
  for (const [what, put] of variants) {
    const last = fg('1', 'Kay Kicker', 4, 41, 17, 14); put(last, 'awayScore');
    const g = game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), last] });
    assert(gw(g).active === false && cand(g) === null, `12-7 (OD-2, the field goal's own away score ${what}): the rule is inactive (active ${gw(g).active}, ${ids(cand(g)).join() || 'no card'})`);
  }

  // OD-3 — a clock object with no numeric value is not "0 seconds left"; a period object with no number is not "period 0"
  for (const [what, clock] of [['display text only', { displayValue: '8:00' }], ['a null value', { value: null, displayValue: '8:00' }], ['an empty value', { value: '', displayValue: '8:00' }], ['a blank value', { value: '  ', displayValue: '8:00' }]]) {
    const g = game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), { ...fg('1', 'Kay Kicker', 4, 480, 17, 14), clock }] });
    assert(gw(g).active === false && cand(g) === null, `12-8 (OD-3, clock with ${what}): a field goal with 8:00 left is not read as 0 seconds left; the rule is inactive (active ${gw(g).active}, ${ids(cand(g)).join() || 'no card'})`);
  }
  for (const [what, period] of [['no number', {}], ['a null number', { number: null }], ['an empty number', { number: '' }]]) {
    const g = game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), { ...q4(41), period }] });
    assert(gw(g).active === false && cand(g) === null, `12-9 (OD-3, period object with ${what}): the period is unknown, not 0; the rule is inactive (active ${gw(g).active}, ${ids(cand(g)).join() || 'no card'})`);
  }
  // the control: the same plays with every field present are credited (the fix does not switch the rule off)
  const control = game({ home: 17, away: 14, h: { kicking: [K(2, 2, 38)] }, plays: [...tied(), q4(41)] });
  assert(gw(control).active === true && ids(cand(control)).join() === 'k.gameWinner', '12-10: CONTROL: the same plays with the running score, the period and the clock all present: the 0:41 go-ahead is credited');
  for (const [what, v] of [['absent', undefined], ['null', null], ['an empty string', ''], ['a blank string', '   ']]) {
    const g = game({ h: { kicking: [K(5, 5, 44)] } }); g.homeScore = v;
    assert(evalAll(g).length === 0 && SS.selectSpotlights([g]).length === 0, `12-12 (a game whose home score is ${what}): not a FINAL game: nobody is featured, so "in a 24-23 win" is never written from a score the source did not carry`);
  }
  const zeros = game({ home: 3, away: 0, h: { kicking: [K(1, 1, 38)] }, plays: [fg('1', 'Kay Kicker', 4, 0, 3, 0)] });
  assert(gw(zeros).active === true && gw(zeros).kicks.length === 1 && gw(zeros).kicks[0].clockSec === 0 && ids(cand(zeros)).join() === 'k.gameWinner',
    '12-11: CONTROL: a genuine 0 is still a number: a clock of 0:00 and a running score of 0-0 before and 3-0 after are read as 0 and the go-ahead is credited (the fix drops only what is not there)');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
