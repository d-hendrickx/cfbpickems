/**
 * CFB Pickems — feedcombinetest.mjs (W-92, release v0.30.1, 2026-10-17)
 * ======================================================================
 * The acceptance proof for the Home feed's "related cards become one card" and "every card says something new" (UN/PF A and B in
 * docs/DESIGN_W92_HOME_FEED_NEEDS.md, Drew "approve M-61"; design inputs DI-W92-1 … DI-W92-6 and the combine half of DI-W92-11 in
 * docs/DESIGN_W92_HOME_FEED_INPUTS.md). Run over the hand-derived statsfixtures league (its header states every outcome).
 *
 *   [1] DI-W92-4  nameList: 0 / 1 / 2 / 3 / 4 / 6 names; a hostile name is escaped at the sink
 *   [2] DI-W92-1  one standings / streak / milestone card per week and kind; per-member admission; ids; reasons; exact copy; facts hygiene
 *   [3] DI-W92-2  the game card names who called it or stood alone; the two separate cards are never emitted; the gate it rides
 *   [4] DI-W92-3  no personal-record cards; the week-final card names both winner and loser and keeps the full table one tap away
 *   [5] DI-W92-5  each card says each thing once: the pinned supporting-line table (P-11 allow-list), captions only where they add a fact
 *   [6] DI-W92-6  the combined card's detail: one screen, a section per member, Compare only for one member, the gate on every repaint, old ids
 *   [7] DI-W92-11 guards: RETIRED_CARD_TYPES is exactly the three, deriveCards never emits one across every fixture
 *   [M] THE MUTATION KIT (S-3): each mutant is a scratch copy loaded as a data: URL (never the file); each must turn a NAMED check RED.
 *       Re-run the kit alone: `node feedcombinetest.mjs --kit`.
 *
 * Run:  node feedcombinetest.mjs     (and under TZ=UTC: the times it renders are zone-independent in what it asserts)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installDom, mkHomeEnv, NOW, HOUR, esc } from './d1homeenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const KIT_ONLY = process.argv.includes('--kit');

const doc = installDom();
const H = await import('./js/home.js');
const fc = await import('./js/feed-cards.js');
const CD = await import('./js/card-detail.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');

// ── fixtures (feedcardstest's shapes) ──────────────────────────────────────────────────────────────────────────
const league = (w2, extra = {}) => fx.buildLeague({ w2, calculateWeeklyResults, ...extra });
function snapshotWith(F, L, o = {}) {
  const confirmed = o.confirmed || ((w) => w.status);
  const view = F.buildRevealedView({ weeks: L.weeks, games: L.games, picks: L.picks, weeklyResults: L.weeklyResults, confirmedStatusFor: confirmed });
  const pr = o.picksConfirmed === undefined ? true : o.picksConfirmed;
  const prMap = (pr && typeof pr === 'object') ? pr : Object.fromEntries(L.weeks.map(w => [w.weekId, pr]));
  return {
    leagueId: 'L1', players: L.players, weeks: L.weeks, games: L.games, picks: L.picks, ...view,
    confirmedStatusFor: confirmed, picksReadConfirmed: prMap,
    submissionCounts: { w2: { submittedCount: 6, totalPlayers: 6 } },
    chatCandidates: { scribe: [{ id: 'm_s1', ts: NOW - HOUR, author: 'scribe', authorName: 'SCRIBE', body: 'A quiet week. Somebody has to be quiet.' }], lockerRoom: [{ id: 'm_l1', ts: NOW - 2 * HOUR, author: 'p3', authorName: 'Kevin', body: 'mid take', reactionCount: 3 }] },
    currentWeekId: 'w2', todayKey: '2026-09-13',
  };
}
const derive = (F, snap, opts = {}) => F.deriveCards(snap, { viewerId: 'p1', now: NOW, ...opts });
const ofType = (cards, type, weekId) => cards.filter(c => c.type === type && (weekId === undefined || c.weekId === weekId));
const one = (cards, type, weekId) => { const l = ofType(cards, type, weekId); return l.length === 1 ? l[0] : null; };
const brief = (c) => (c ? (Array.isArray(c.facts.members) ? c.facts.members : []).map(m => `${m.playerId}:${m.fromRank ?? m.run ?? m.mark}${m.toRank !== undefined ? '>' + m.toRank : ''}${m.kind ? ' ' + m.kind : ''}${m.total !== undefined ? '/' + m.total : ''}`).join(',') : 'NO CARD');
const E = { escHtml: esc };
const copyOf = (F, c, o = {}) => F.cardCopy(c, { ...E, ...o });
/** Milestone rows: p1 sits at 24 after week 1 and p2 at 49, so week 2 crosses 25 for p1 and 50 for p2 (feedcardstest 3-m1's fixture). */
const milestoneLeague = (p2w2 = null) => {
  const L = league('final');
  L.weeklyResults = L.weeklyResults.map(r => (r.playerId === 'p1' && r.weekId === 'w1') ? { ...r, correctCount: 24, correctPicks: 24, incorrectCount: 0, incorrectPicks: 0 }
    : (r.playerId === 'p2' && r.weekId === 'w1') ? { ...r, correctCount: p2w2 === null ? 49 : 24, correctPicks: p2w2 === null ? 49 : 24 }
    : (p2w2 !== null && r.playerId === 'p2' && r.weekId === 'w2') ? { ...r, correctCount: p2w2, correctPicks: p2w2 } : r);
  return L;
};
/** g21 (Washington +7 at Oregon, Washington won 20-17) picked by p6 ALONE: the lone winner is also the only upset caller ("both"). */
const bothLeague = () => {
  const L = league('final');
  L.picks = L.picks.map(p => (p.gameId === 'g21' ? { ...p, selectedTeam: p.playerId === 'p6' ? 'Washington' : 'Oregon' } : p));
  return L;
};
const ALL_FIXTURES = () => [
  ['OPEN', league('open')], ['LOCKED', league('locked')], ['LIVE', league('live')], ['FINAL', league('final')], ['FINAL+w3', league('final', { w3: true })],
  ['OPEN+final g21 (RG-45)', league('open', { w2Finals: ['g21'] })], ['LIVE stale rows + w3', league('live', { staleW2Rows: true, w3: true })], ['milestones', milestoneLeague()], ['both', bothLeague()],
];

// ═══ the named check groups (each takes the module under test, so the kit re-runs them against mutants) ═══════════════

/** [1] DI-W92-4 */
function nameListChecks(F) {
  const out = {};
  const nl = F.nameList;
  out['N1 nameList: 0 names -> "" (never "and 0 others")'] = typeof nl === 'function' && nl([]) === '' && nl(null) === '' && nl(undefined) === '';
  out['N2 1 -> "Kevin"; 2 -> "Kevin and Jacob"; 3 -> "Kevin, Jacob and Koby" (no ampersand, no serial comma)'] = typeof nl === 'function' && nl(['Kevin']) === 'Kevin' && nl(['Kevin', 'Jacob']) === 'Kevin and Jacob' && nl(['Kevin', 'Jacob', 'Koby']) === 'Kevin, Jacob and Koby';
  out['N3 4 -> "Kevin, Jacob, Koby and 1 other" (singular)'] = typeof nl === 'function' && nl(['Kevin', 'Jacob', 'Koby', 'Drew']) === 'Kevin, Jacob, Koby and 1 other';
  out['N4 6 -> "Kevin, Jacob, Koby and 3 others"'] = typeof nl === 'function' && nl(['Kevin', 'Jacob', 'Koby', 'Drew', 'Brayden', 'Kihoon']) === 'Kevin, Jacob, Koby and 3 others';
  out['N5 the cap is a parameter (max 2: "Kevin, Jacob and 2 others")'] = typeof nl === 'function' && nl(['Kevin', 'Jacob', 'Koby', 'Drew'], 2) === 'Kevin, Jacob and 2 others';
  // escaping at the sink: a hostile name in a COMBINED title reaches the markup escaped
  const hostile = { type: 'streak.extended', id: 'streak.extended:L1:w2:-', weekId: 'w2', facts: { weekN: 2, members: [{ playerId: 'p1', playerName: '<script>alert(1)</script>', run: 4, kind: 'covers' }, { playerId: 'p2', playerName: 'Jacob', run: 3, kind: 'misses' }] } };
  const c = (() => { try { return copyOf(F, hostile); } catch { return { title: '', body: '' }; } })();
  out['N6 a name containing <script> is ESCAPED in a combined title and its body (no raw "<script" survives; "&lt;script&gt;" is there)'] = !/<script/i.test(c.title + c.body) && /&lt;script&gt;/.test(c.title) && /&lt;script&gt;/.test(c.body);
  return out;
}

/** [2] DI-W92-1 */
function combineChecks(F) {
  const out = {};
  const fin = derive(F, snapshotWith(F, league('final')));
  const rk = one(fin, 'rank.changed', 'w2');
  out['C1 ONE rank.changed card for week 2 (five members moved), members by new rank, best first: p5 2>1, p1 1>2, p4 5>4, p6 6>5, p3 4>6'] = !!rk && ofType(fin, 'rank.changed', 'w2').length === 1 && brief(rk) === 'p5:2>1,p1:1>2,p4:5>4,p6:6>5,p3:4>6' && rk.facts.rankedCount === 6 && rk.facts.weekN === 2;
  out['C2 …its id is `rank.changed:L1:w2:-` (the member slot is "-", no suffix), memberId null, reason "In your league"'] = !!rk && rk.id === 'rank.changed:L1:w2:-' && rk.memberId === null && rk.reason === 'In your league';
  const se2 = one(fin, 'streak.extended', 'w2'), sb2 = one(fin, 'streak.broken', 'w2'), se1 = one(fin, 'streak.extended', 'w1');
  out['C3 ONE streak.extended card for week 2 (two extensions) in ROSTER order: Kevin 4 misses, Jacob 5 covers'] = !!se2 && brief(se2) === 'p3:4 misses,p5:5 covers';
  out['C4 ONE streak.broken card for week 2: Drew\'s 4 covers and Kihoon\'s 3 misses ended — and a separate card from the extended one (never grouped across types)'] = !!sb2 && brief(sb2) === 'p1:4 covers,p6:3 misses' && se2 && se2.id !== sb2.id;
  out['C5 never across weeks: week 1\'s streak.extended card is its OWN card (Drew 4 covers, Kihoon 3 misses), week 2\'s is a different one'] = !!se1 && brief(se1) === 'p1:4 covers,p6:3 misses' && se1.id === 'streak.extended:L1:w1:-' && se2.id === 'streak.extended:L1:w2:-';
  out['C6 reason: "Your streak" when the viewer is one of the members (Drew, in week 2\'s ended streaks), "In your league" when not'] = !!sb2 && sb2.reason === 'Your streak' && se2.reason === 'In your league';
  // per-member admission (S-C10: the other members' picks have not landed) — the viewer's own streak is exempt, nobody else's
  const unconf = derive(F, snapshotWith(F, league('final'), { picksConfirmed: false }));
  const sbU = ofType(unconf, 'streak.broken', 'w2');
  out['C7 a member whose own gate fails is ABSENT: with picksReadConfirmed false only the viewer\'s own ended streak (Drew) is admitted — ONE card, one member'] = sbU.length === 1 && brief(sbU[0]) === 'p1:4 covers';
  out['C8 …and that one-member group is a normal one-name card: "Drew\'s 4-game streak snapped this week." (the same shape, no second code path)'] = sbU.length === 1 && copyOf(F, sbU[0]).title === "Drew's 4-game streak snapped this week." && copyOf(F, sbU[0]).body === '';
  out['C9 …and when EVERY member fails there is no card at all: no rank.changed (it needs the others\' picks), no week-2 streak.extended (Kevin and Jacob are not the viewer)'] = ofType(unconf, 'rank.changed').length === 0 && ofType(unconf, 'streak.extended', 'w2').length === 0;
  const p2view = derive(F, snapshotWith(F, league('final'), { picksConfirmed: false }), { viewerId: 'p2' });
  out['C10 …viewer p2 (no streak of his own) with the flag false: no streak card of any kind for week 2'] = ofType(p2view, 'streak.extended', 'w2').length === 0 && ofType(p2view, 'streak.broken', 'w2').length === 0;
  // milestones
  const ms = derive(F, snapshotWith(F, milestoneLeague()));
  const m2 = one(ms, 'milestone.reached', 'w2');
  out['C11 ONE milestone card for week 2: Drew 25 (season 25), Brayden 50 (season 52), id `milestone.reached:L1:w2:-` (the per-mark suffix is gone), reason "Your milestone"'] = !!m2 && brief(m2) === 'p1:25/25,p2:50/52' && m2.id === 'milestone.reached:L1:w2:-' && m2.reason === 'Your milestone';
  const twice = one(derive(F, snapshotWith(F, milestoneLeague(30))), 'milestone.reached', 'w2');
  out['C12 a member who crossed TWO marks in one week (Brayden 24 -> 54 crosses 25 and 50) appears ONCE, with the higher mark'] = !!twice && twice.facts.members.filter(m => m.playerId === 'p2').length === 1 && twice.facts.members.find(m => m.playerId === 'p2').mark === 50 && twice.facts.members.find(m => m.playerId === 'p2').total === 54;
  // the old per-member ids never appear, anywhere
  const ids = ALL_FIXTURES().flatMap(([, L]) => derive(F, snapshotWith(F, L)).filter(c => ['rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached'].includes(c.type)).map(c => c.id));
  out[`C13 across ${ALL_FIXTURES().length} fixtures every combined card's id is \`{type}:L1:{week}:-\` — the old per-member ids (…:p3, …:p1:25) are never produced (${ids.length} ids)`] = ids.length > 6 && ids.every(id => /^(rank\.changed|streak\.extended|streak\.broken|milestone\.reached):L1:w\d:-$/.test(id));
  out['C14 one card per week and kind, never two (every fixture)'] = ALL_FIXTURES().every(([, L]) => { const cs = derive(F, snapshotWith(F, L)); const keys = cs.filter(c => ['rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached'].includes(c.type)).map(c => `${c.type}|${c.weekId}`); return new Set(keys).size === keys.length; });
  // facts hygiene
  out['C15 CARD_ALLOWED_FACTS for the four types is exactly weekN + members (+ rankedCount for rank.changed)'] =
    JSON.stringify(F.CARD_ALLOWED_FACTS['rank.changed']) === '["weekN","members","rankedCount"]' && ['streak.extended', 'streak.broken', 'milestone.reached'].every(t => JSON.stringify(F.CARD_ALLOWED_FACTS[t]) === '["weekN","members"]');
  const NK = F.NESTED_FACT_KEYS;
  out['C16 NESTED_FACT_KEYS allow-lists each member item: rank {playerId, playerName, fromRank, toRank}; streak {playerId, playerName, run, kind}; milestone {playerId, playerName, mark, total}'] =
    !!NK['rank.changed'] && JSON.stringify(NK['rank.changed'].members) === '["playerId","playerName","fromRank","toRank"]' && JSON.stringify(NK['streak.extended'].members) === '["playerId","playerName","run","kind"]' && JSON.stringify(NK['streak.broken'].members) === '["playerId","playerName","run","kind"]' && JSON.stringify(NK['milestone.reached'].members) === '["playerId","playerName","mark","total"]';
  const cleaned = (() => { try { return F.finalizeFacts('rank.changed', { weekN: 2, rankedCount: 6, members: [{ playerId: 'p1', playerName: 'Drew', fromRank: 1, toRank: 2, note: 'x', team: 'Texas' }, 'junk', null, { playerId: 'p2', fromRank: 3, toRank: 1 }, { playerId: 'p3', playerName: 'Kevin', fromRank: '<b>', toRank: 4 }] }); } catch { return null; } })();
  out['C17 finalizeFacts rebuilds each member from its allow-list: extra keys stripped, a non-object dropped, a member with no name dropped, a non-number rank dropped (ids, names, numbers only) — and no win|loss `result` is demanded of a member'] =
    !!cleaned && JSON.stringify(cleaned.members) === JSON.stringify([{ playerId: 'p1', playerName: 'Drew', fromRank: 1, toRank: 2 }, { playerId: 'p3', playerName: 'Kevin', toRank: 4 }]);
  out['C18 a FORBIDDEN key nested inside a member (selectedTeam / spread) THROWS before anything is stripped'] = ['selectedTeam', 'spread'].every(k => { try { F.finalizeFacts('streak.extended', { weekN: 2, members: [{ playerId: 'p1', playerName: 'Drew', run: 4, kind: 'covers', [k]: 'x' }] }); return false; } catch { return true; } });
  out['C19 a streak member\'s kind is the closed set covers | misses (anything else drops the key)'] = (() => { try { const r = F.finalizeFacts('streak.extended', { weekN: 2, members: [{ playerId: 'p1', playerName: 'Drew', run: 4, kind: 'wins' }] }); return r.members.length === 1 && !('kind' in r.members[0]); } catch { return false; } })();
  return out;
}

/** [2b] DI-W92-1 copy, exact */
function combineCopyChecks(F) {
  const out = {};
  const fin = derive(F, snapshotWith(F, league('final')));
  const c = (type, wk) => { const x = one(fin, type, wk); return x ? copyOf(F, x) : { title: '', body: '' }; };
  const rk = c('rank.changed', 'w2');
  out['Y1 standings, two or more: "Jacob, Koby and Kihoon moved up; Drew and Kevin slipped." / "Jacob takes first after Week 2."'] = rk.title === 'Jacob, Koby and Kihoon moved up; Drew and Kevin slipped.' && rk.body === 'Jacob takes first after Week 2.';
  const synth = (members, o = {}) => ({ type: 'rank.changed', id: 'rank.changed:L1:w7:-', weekId: 'w7', facts: { weekN: 7, rankedCount: 6, members } });
  const one1 = copyOf(F, synth([{ playerId: 'p4', playerName: 'Koby', fromRank: 3, toRank: 5 }]));
  out['Y2 standings, one member: unchanged — "Koby slipped to 5th this week." / "Down from 3rd after Week 7."'] = one1.title === 'Koby slipped to 5th this week.' && one1.body === 'Down from 3rd after Week 7.';
  const nfl = copyOf(F, synth([{ playerId: 'p6', playerName: 'Kihoon', fromRank: 2, toRank: 1 }]), { sportCode: 'NFL' });
  out['Y3 …in a several-sport league: "Kihoon moved into 1st in NFL this week." / "Up from 2nd after NFL Week 7."'] = nfl.title === 'Kihoon moved into 1st in NFL this week.' && nfl.body === 'Up from 2nd after NFL Week 7.';
  const ups = copyOf(F, synth([{ playerId: 'p1', playerName: 'Drew', fromRank: 4, toRank: 2 }, { playerId: 'p2', playerName: 'Brayden', fromRank: 5, toRank: 3 }]));
  out['Y4 only ups: "Drew and Brayden moved up." / "After Week 7." (nobody took first)'] = ups.title === 'Drew and Brayden moved up.' && ups.body === 'After Week 7.';
  const downs = copyOf(F, synth([{ playerId: 'p1', playerName: 'Drew', fromRank: 2, toRank: 4 }, { playerId: 'p2', playerName: 'Brayden', fromRank: 3, toRank: 5 }]), { sportCode: 'NFL' });
  out['Y5 only downs: "Drew and Brayden slipped." / "After NFL Week 7."'] = downs.title === 'Drew and Brayden slipped.' && downs.body === 'After NFL Week 7.';
  const se = c('streak.extended', 'w2'), sb = c('streak.broken', 'w2');
  out['Y6 streaks extended, two or more: "Kevin and Jacob are riding streaks." / "Kevin 4 misses · Jacob 5 covers"'] = se.title === 'Kevin and Jacob are riding streaks.' && se.body === 'Kevin 4 misses · Jacob 5 covers';
  out['Y7 streaks ended, two or more: "Drew and Kihoon lost their streaks this week." / "Drew 4 covers · Kihoon 3 misses"'] = sb.title === 'Drew and Kihoon lost their streaks this week.' && sb.body === 'Drew 4 covers · Kihoon 3 misses';
  const five = copyOf(F, { type: 'streak.extended', id: 'x', facts: { weekN: 3, members: ['Drew', 'Brayden', 'Kevin', 'Koby', 'Jacob'].map((n, i) => ({ playerId: `p${i + 1}`, playerName: n, run: 3 + i, kind: i % 2 ? 'misses' : 'covers' })) } }, { sportCode: 'NFL' });
  out['Y8 five on streaks (several sports): "Drew, Brayden, Kevin and 2 others are riding streaks in NFL." / the first three runs then " · +2 more"'] = five.title === 'Drew, Brayden, Kevin and 2 others are riding streaks in NFL.' && five.body === 'Drew 3 covers · Brayden 4 misses · Kevin 5 covers · +2 more';
  const s1 = copyOf(F, { type: 'streak.extended', id: 'x', facts: { weekN: 2, members: [{ playerId: 'p3', playerName: 'Kevin', run: 4, kind: 'misses' }] } });
  out['Y9 one streak: unchanged — "Kevin is riding a 4-game miss streak."'] = s1.title === 'Kevin is riding a 4-game miss streak.' && s1.body === '';
  const ms = one(derive(F, snapshotWith(F, milestoneLeague())), 'milestone.reached', 'w2');
  const mc = ms ? copyOf(F, ms) : { title: '', body: '' };
  out['Y10 milestones, two or more: "Drew and Brayden hit correct-pick milestones this season." / "Drew 25 · Brayden 50"'] = mc.title === 'Drew and Brayden hit correct-pick milestones this season.' && mc.body === 'Drew 25 · Brayden 50';
  const m1 = copyOf(F, { type: 'milestone.reached', id: 'x', facts: { weekN: 2, members: [{ playerId: 'p1', playerName: 'Drew', mark: 25, total: 25 }] } });
  out['Y11 one milestone: unchanged — "Drew hit 25 correct picks this season."'] = m1.title === 'Drew hit 25 correct picks this season.' && m1.body === '';
  const empty = copyOf(F, { type: 'streak.broken', id: 'x', facts: { weekN: 2, members: [] } });
  out['Y12 a group with nobody in it renders nothing (never "  lost their streaks")'] = empty.title === '' && empty.body === '';
  return out;
}

/** [3] DI-W92-2 */
function standoutChecks(F) {
  const out = {};
  const fin = derive(F, snapshotWith(F, league('final')));
  const gf = (cs, gid) => cs.find(c => c.type === 'game.final' && c.gameId === gid) || null;
  const g21 = gf(fin, 'g21'), g22 = gf(fin, 'g22'), g23 = gf(fin, 'g23');
  const names = (s) => (s && Array.isArray(s.names) ? s.names.map(n => `${n.playerId}:${n.playerName}`).join(',') : '');
  out['S1 g21 (Washington +7 won outright 20-17): the game card carries standout {kind:"called", names: Brayden, Koby, Jacob, Kihoon (roster order), team Washington, line +7}'] =
    !!g21 && !!g21.facts.standout && g21.facts.standout.kind === 'called' && names(g21.facts.standout) === 'p2:Brayden,p4:Koby,p5:Jacob,p6:Kihoon' && g21.facts.standout.team === 'Washington' && g21.facts.standout.spreadDisplay === '+7';
  out['S2 …and its ONE supporting line is "Brayden, Koby, Jacob and 1 other called it: Washington +7 won outright."'] = !!g21 && copyOf(F, g21).body === 'Brayden, Koby, Jacob and 1 other called it: Washington +7 won outright.' && copyOf(F, g21).title === 'Washington 20, Oregon 17 (Final) — Washington covered by 10.';
  out['S3 g22: Jacob stood alone on Miami, which covered — "Jacob stood alone on Miami against 5 others, and it covered."'] = !!g22 && g22.facts.standout && g22.facts.standout.kind === 'alone' && g22.facts.standout.against === 5 && copyOf(F, g22).body === 'Jacob stood alone on Miami against 5 others, and it covered.';
  out['S4 g23 has nobody to name: no standout fact, no supporting line (the chips are unchanged)'] = !!g23 && !('standout' in g23.facts) && copyOf(F, g23).body === '' && copyOf(F, g23).chips.length === 6;
  const b = gf(derive(F, snapshotWith(F, bothLeague())), 'g21');
  out['S5 the lone winner is also the only upset caller: kind "both" — "Kihoon called it and stood alone: Washington +7 won outright."'] = !!b && b.facts.standout && b.facts.standout.kind === 'both' && copyOf(F, b).body === 'Kihoon called it and stood alone: Washington +7 won outright.';
  out['S6 week 1 too: g13 "Drew, Koby and Jacob called it: Oklahoma +7 won outright." and g11 "Jacob stood alone on Clemson against 5 others, and it covered."'] =
    copyOf(F, gf(fin, 'g13')).body === 'Drew, Koby and Jacob called it: Oklahoma +7 won outright.' && copyOf(F, gf(fin, 'g11')).body === 'Jacob stood alone on Clemson against 5 others, and it covered.';
  out['S7 copy without a line: "Kevin called it: Texas won outright." (the line text is dropped when spreadDisplay is empty); "1 other" is singular'] =
    copyOf(F, { type: 'game.final', id: 'x', facts: { awayTeam: 'Texas', homeTeam: 'Ohio', awayScore: 21, homeScore: 17, atsWinnerTeam: 'Texas', chips: [], standout: { kind: 'called', names: [{ playerId: 'p3', playerName: 'Kevin' }], team: 'Texas' } } }).body === 'Kevin called it: Texas won outright.'
    && copyOf(F, { type: 'game.final', id: 'x', facts: { awayTeam: 'A', homeTeam: 'B', awayScore: 1, homeScore: 0, chips: [], standout: { kind: 'alone', names: [{ playerId: 'p3', playerName: 'Kevin' }], team: 'A', against: 1 } } }).body === 'Kevin stood alone on A against 1 other, and it covered.';
  // the gate the standout rides: the game card's own
  const live = derive(F, snapshotWith(F, league('live')));
  out['S8 LIVE week, g21 final: its card already names its callers (the week is public, the game is final)'] = !!gf(live, 'g21') && gf(live, 'g21').facts.standout && gf(live, 'g21').facts.standout.kind === 'called';
  out['S9 …a still-LIVE game (g22, whose lone pick exists) has no card, so no standout'] = !gf(live, 'g22') && !JSON.stringify(live).includes('stood alone');
  const openFinal = derive(F, snapshotWith(F, league('open', { w2Finals: ['g21'] })));
  out['S10 RG-45: a FINAL game inside an OPEN week — no game card, no standout, no player name tied to a week-2 game anywhere'] = !gf(openFinal, 'g21') && !openFinal.some(c => c.weekId === 'w2' && c.facts && c.facts.standout) && !JSON.stringify(openFinal.filter(c => c.weekId === 'w2')).includes('Washington');
  const lockedFinal = derive(F, snapshotWith(F, league('locked', { w2Finals: ['g21', 'g22'] })));
  out['S11 …nor in a LOCKED week with two final games'] = !lockedFinal.some(c => c.weekId === 'w2' && c.type === 'game.final');
  const unconf = derive(F, snapshotWith(F, league('final'), { picksConfirmed: false }), { viewerId: 'p5' });
  out['S12 S-C10, the recorded safe-direction edge: with the others\' picks not landed there is no game card, so even the viewer\'s OWN "called it" (Jacob, g21) does not show'] = ofType(unconf, 'game.final').length === 0 && !JSON.stringify(unconf).includes('"standout"');
  out['S13 the game card\'s reason is unchanged ("In this week\'s slate")'] = !!g21 && g21.reason === "In this week's slate";
  const L = league('final'); L.players = L.players.map(p => (p.playerId === 'p2' ? { ...p, displayName: '<img src=x onerror=alert(1)>' } : p));
  const hostile = gf(derive(F, snapshotWith(F, L)), 'g21');
  out['S14 a hostile member name in the supporting line is escaped (no raw <img)'] = !!hostile && !/<img/.test(copyOf(F, hostile).body) && /&lt;img/.test(copyOf(F, hostile).body);
  // facts hygiene for the nested standout
  out['S15 game.final allow-lists `standout`; finalizeFacts rebuilds it: kind is the closed set called|alone|both, names are {playerId, playerName} only, extra keys stripped'] = (() => {
    try {
      if (!F.CARD_ALLOWED_FACTS['game.final'].includes('standout')) return false;
      const r = F.finalizeFacts('game.final', { standout: { kind: 'called', names: [{ playerId: 'p1', playerName: 'Drew', initials: 'DH' }, 'junk', { playerId: 'p2' }], team: 'Texas', spreadDisplay: '+3', note: 'x' } });
      const bad = F.finalizeFacts('game.final', { standout: { kind: 'won', names: [{ playerId: 'p1', playerName: 'Drew' }], team: 'Texas' } });
      return JSON.stringify(r.standout) === '{"kind":"called","names":[{"playerId":"p1","playerName":"Drew"}],"team":"Texas","spreadDisplay":"+3"}' && !('standout' in bad);
    } catch { return false; }
  })();
  out['S16 a forbidden key inside the standout (or one of its names) THROWS'] = ['selectedTeam', 'spread'].every(k => { try { F.finalizeFacts('game.final', { standout: { kind: 'called', names: [{ playerId: 'p1', playerName: 'D', [k]: 1 }], team: 'T' } }); return false; } catch { return true; } });
  // Related: the game's one card, and a non-entrant gets nothing that names a pick
  const rel = F.cardsForGame(fin, { gameId: 'g21', weekId: 'w2', homeTeam: 'Oregon', awayTeam: 'Washington' });
  out['S17 the Game view\'s Related list for g21 is that ONE card (the game result), no "called it" card beside it'] = rel.length === 1 && rel[0].type === 'game.final' && F.cardsForGame(fin, { gameId: 'g21', weekId: 'w2', homeTeam: 'Oregon', awayTeam: 'Washington' }, { entered: false }).length === 0;
  return out;
}

/** [4] DI-W92-3 */
function recordChecks(F) {
  const out = {};
  const fin = derive(F, snapshotWith(F, league('final')));
  out['R1 a final week with six players produces NO player.week card (the six "[name]\'s Week 2: 4–0" cards are gone)'] = ofType(fin, 'player.week').length === 0;
  const wr = one(fin, 'week.result', 'w2');
  out['R2 the week-final card is unchanged in title and facts; its plain body now names BOTH: "Jacob took it, 4–0; Kevin finished 0–4."'] = !!wr && copyOf(F, wr).title === 'Week 2 is final.' && copyOf(F, wr).body === 'Jacob took it, 4–0; Kevin finished 0–4.';
  return out;
}

/** [7] DI-W92-11 guards (the combine half) */
function retiredChecks(F) {
  const out = {};
  out['RT1 RETIRED_CARD_TYPES is exactly ["called.it","stood.alone","player.week"] and frozen'] = Array.isArray(F.RETIRED_CARD_TYPES) && Object.isFrozen(F.RETIRED_CARD_TYPES) && JSON.stringify(F.RETIRED_CARD_TYPES) === '["called.it","stood.alone","player.week"]';
  out['RT2 …and each stays in the catalog (CARD_TYPES, the reveal map, the allow-lists, CARD_NAMES_PICK): retired from the feed, not deleted'] = Array.isArray(F.RETIRED_CARD_TYPES) && F.RETIRED_CARD_TYPES.every(t => F.CARD_TYPES.includes(t) && F.CARD_REVEAL_CLASS[t] && Array.isArray(F.CARD_ALLOWED_FACTS[t]) && F.CARD_NAMES_PICK[t] === true);
  const emitted = ALL_FIXTURES().flatMap(([name, L]) => [null, 'p1', 'p5'].flatMap(v => derive(F, snapshotWith(F, L), { viewerId: v }).filter(c => ['called.it', 'stood.alone', 'player.week'].includes(c.type)).map(c => `${name}:${c.id}`)));
  out[`RT3 deriveCards NEVER emits a retired type: ${ALL_FIXTURES().length} fixtures x 3 viewers (${emitted.length ? emitted.slice(0, 3).join(' ') : 'none'})`] = emitted.length === 0;
  out['RT4 CAPTION_TYPES_THAT_ADD_A_FACT is exactly ["week.result"] and frozen (DI-W92-5)'] = Array.isArray(F.CAPTION_TYPES_THAT_ADD_A_FACT) && Object.isFrozen(F.CAPTION_TYPES_THAT_ADD_A_FACT) && JSON.stringify(F.CAPTION_TYPES_THAT_ADD_A_FACT) === '["week.result"]';
  return out;
}

/** [5] DI-W92-5 — the supporting-line table, rendered through home.js's cardHTML. An ALLOW-LIST (P-11): a line not in the table fails. */
const LINE_TABLE = Object.freeze({
  'slate.published': 'none', 'week.revealed': 'none', 'year.ago': 'none', 'picks.submitted': 'none',
  'game.final': 'standout', 'week.result': 'caption-or-body',
  'rank.changed': 'body-if-any', 'streak.extended': 'body-if-any', 'streak.broken': 'body-if-any', 'milestone.reached': 'body-if-any',
  'scribe.post': 'body', 'lockerroom.top': 'body',
});
function lineChecks(Hm, F) {
  const out = {};
  const cards = [
    ...derive(F, snapshotWith(F, league('final'))), ...derive(F, snapshotWith(F, league('open'))), ...derive(F, snapshotWith(F, league('live'))), ...derive(F, snapshotWith(F, milestoneLeague())),
  ];
  const seenTypes = new Set();
  const wrong = [];
  for (const c of cards) {
    const html = Hm.cardHTML(c, { escHtml: esc, now: NOW });
    if (!html) { wrong.push(`${c.id}: rendered nothing`); continue; }
    seenTypes.add(c.type);
    const lines = [...html.matchAll(/<p class="(feed-card-body|feed-card-caption)[^"]*">([\s\S]*?)<\/p>/g)].map(m => ({ kind: m[1] === 'feed-card-caption' ? 'caption' : 'body', text: m[2] }));
    const titles = (html.match(/<h3 class="feed-card-title">/g) || []).length;
    const rule = LINE_TABLE[c.type];
    const copy = F.cardCopy(c, { escHtml: esc });
    let ok;
    if (!rule) ok = false;
    else if (rule === 'none') ok = lines.length === 0;
    else if (rule === 'standout') ok = c.facts.standout ? (lines.length === 1 && lines[0].kind === 'body' && lines[0].text === copy.body) : lines.length === 0;
    else if (rule === 'caption-or-body') ok = lines.length === 1;
    else if (rule === 'body-if-any') ok = copy.body ? (lines.length === 1 && lines[0].kind === 'body') : lines.length === 0;
    else if (rule === 'body') ok = lines.length === 1 && lines[0].kind === 'body';
    if (titles > 1) ok = false;
    if (!ok) wrong.push(`${c.type} ${c.id}: ${JSON.stringify(lines)}`);
  }
  out[`L1 every rendered card (${cards.length}, ${seenTypes.size} types) shows ONE headline and AT MOST ONE supporting line, exactly the one the pinned DI-W92-5 table allows (wrong: ${wrong.slice(0, 2).join(' | ') || 'none'})`] = wrong.length === 0 && seenTypes.size >= 11;
  out['L2 the table is an allow-list over the types that exist: every emitted type has a row (a new type without one fails L1)'] = [...seenTypes].every(t => LINE_TABLE[t]);
  const pick = cards.find(c => c.type === 'picks.submitted');
  out['L3 picks.submitted shows NO caption (SCRIBE\'s "4 of 6 in for Week 7." restated "4/6 in for Week 7.")'] = !!pick && !/feed-card-caption/.test(Hm.cardHTML(pick, { escHtml: esc, now: NOW }));
  const rk = cards.find(c => c.type === 'rank.changed');
  out['L4 a standings / streak / milestone card shows no SCRIBE caption — its body is the fact (the caption pools stay in code, unused here)'] = !!rk && cards.filter(c => ['rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached', 'year.ago'].includes(c.type)).every(c => !/feed-card-caption/.test(Hm.cardHTML(c, { escHtml: esc, now: NOW })));
  const wr = cards.find(c => c.type === 'week.result');
  out['L5 the week-final card keeps its SCRIBE caption (it adds the loser and both records) in place of the plain body'] = !!wr && /<p class="feed-card-caption">/.test(Hm.cardHTML(wr, { escHtml: esc, now: NOW })) && !/<p class="feed-card-body"/.test(Hm.cardHTML(wr, { escHtml: esc, now: NOW }));
  return out;
}

/** [6] DI-W92-6 — the detail. Runs over a REAL Home snapshot (home.js assembleSnapshot) like carddetailtest. */
const CTX = { pilotHistory: true, formatTime: (v) => `T[${String(v).slice(5, 16)}]`, formatCountdown: () => '1h', capabilities: { thread: true, chat: true, compare: true, weekDetail: true, share: false, gameday: true }, canCompare: () => true, threadCount: () => 2, scoreSummaryRowsHTML: () => '<tr><td>1</td><td>Jacob</td><td>4</td><td>0</td><td>31</td></tr>'.repeat(6) };
function envSnap(L, o = {}) {
  const e = mkHomeEnv({ home: H }, doc, L, { read: { currentWeek: () => L.weeks[L.weeks.length - 1] }, ...o });
  const viewerId = o.viewer === undefined ? 'p1' : o.viewer;
  const snap = e.home.assembleSnapshot({ viewerId, isCommissioner: false, now: NOW });
  return { e, snap, viewerId };
}
function detailChecks(CDm, F) {
  const out = {};
  const { snap } = envSnap(league('final'));
  const cards = F.deriveCards(snap, { viewerId: 'p1', now: NOW });
  const rk = cards.find(c => c.type === 'rank.changed' && c.weekId === 'w2');
  const m = rk ? CDm.buildCardDetail(rk, snap, CTX) : null;
  const ids = (l) => (l || []).map(x => x.title).join(',');
  out['D1 the five-member standings card opens ONE screen titled "Rank change" with a section per member, titled by name, best rank first'] = !!m && m.title === 'Rank change' && ids(m.lists) === 'Jacob,Drew,Koby,Kihoon,Kevin' && m.rows.length === 0;
  out['D2 …each member\'s section holds that member\'s own rows (From, To, …) as label / value, at most four'] = !!m && m.lists.every(l => l.items.length >= 2 && l.items.length <= 4 && l.items.every(i => i.primary && i.secondary)) && m.lists[0].items[0].primary === 'From' && m.lists[0].items[0].secondary === '2nd' && m.lists[0].items[1].secondary === '1st of 6';
  out['D3 …its headline is the card\'s own (cardCopy title and supporting line) and it says what it means in one sentence'] = !!m && m.headline.title === 'Jacob, Koby and Kihoon moved up; Drew and Kevin slipped.' && m.headline.body === 'Jacob takes first after Week 2.' && JSON.stringify(m.meaning) === '["Standings changed for 5 members after Week 2."]';
  out['D4 …actions: See standings, Week results — and NO "Compare with" (a combined card has more than one member)'] = !!m && m.actions.map(a => a.id).join(',') === 'go-standings,week-detail' && !m.actions.some(a => a.id === 'compare');
  const se = cards.find(c => c.type === 'streak.extended' && c.weekId === 'w2');
  const sm = se ? CDm.buildCardDetail(se, snap, CTX) : null;
  out['D5 the two-member streak card: one screen ("Streak"), sections Kevin and Jacob, "2 members are on streaks.", Week results, no Compare'] = !!sm && sm.title === 'Streak' && ids(sm.lists) === 'Kevin,Jacob' && sm.meaning[0] === '2 members are on streaks.' && !sm.actions.some(a => a.id === 'compare') && sm.actions.some(a => a.id === 'week-detail');
  // one member opens exactly today's detail (the shape, the rows, Compare)
  const unSnap = envSnap(league('final'), { supabase: true, picksRead: () => false }).snap;   // S-C10 is asked only in supabase mode
  const sb1 = F.deriveCards(unSnap, { viewerId: 'p1', now: NOW }).find(c => c.type === 'streak.broken' && c.weekId === 'w2');
  const s1 = sb1 ? CDm.buildCardDetail(sb1, unSnap, CTX) : null;
  out['D6 a ONE-member group opens the detail it opens today: the streak rows (Run, Started, Longest this season), the run list, its own sentence'] = !!s1 && s1.rows.map(r => r.label).join(',') === 'Run,Started,Longest this season' && s1.lists[0] && s1.lists[0].id === 'run' && s1.meaning[0].startsWith("Drew's 4-game streak snapped");
  const msSnap = envSnap(milestoneLeague()).snap;
  const ms = F.deriveCards(msSnap, { viewerId: 'p1', now: NOW }).find(c => c.type === 'milestone.reached' && c.weekId === 'w2');
  const mm = ms ? CDm.buildCardDetail(ms, msSnap, CTX) : null;
  out['D7 the two-member milestone card: sections Drew and Brayden, "2 members passed milestones."'] = !!mm && mm.title === 'Milestone' && ids(mm.lists) === 'Drew,Brayden' && mm.meaning[0] === '2 members passed milestones.';
  // Compare on a one-member card about ANOTHER member (today's behaviour)
  const otherOne = { ...rk, facts: { ...rk.facts, members: [rk.facts.members.find(x => x.playerId === 'p5')] } };
  const om = CDm.buildCardDetail(otherOne, snap, CTX);
  out['D8 "Compare with {name}" appears only when the card has exactly ONE member (and it is someone else)'] = !!om && om.actions.some(a => a.id === 'compare' && a.label === 'Compare with Jacob') && om.rows.length >= 2;
  // the game card's list
  const g21 = cards.find(c => c.type === 'game.final' && c.gameId === 'g21');
  const gm = g21 ? CDm.buildCardDetail(g21, snap, CTX) : null;
  const sl = gm ? gm.lists.find(l => l.id === 'standout') : null;
  out['D9 the game result\'s detail gains ONE list "Called it": a row per named member (pick and line, how it won)'] = !!sl && sl.title === 'Called it' && sl.items.map(i => i.primary).join(',') === 'Brayden,Koby,Jacob,Kihoon' && sl.items.every(i => i.secondary === 'Washington +7 · won outright by 3');
  const g22 = cards.find(c => c.type === 'game.final' && c.gameId === 'g22');
  const g22m = g22 ? CDm.buildCardDetail(g22, snap, CTX) : null;
  const al = g22m ? g22m.lists.find(l => l.id === 'standout') : null;
  out['D10 …"Stood alone" for g22: Jacob, "Miami · against 5 · covered by 11"'] = !!al && al.title === 'Stood alone' && al.items.length === 1 && al.items[0].primary === 'Jacob' && al.items[0].secondary === 'Miami · against 5 · covered by 11';
  // the gate on every repaint
  const liveSnap = envSnap(league('final'), { confirmed: (w) => (w.weekId === 'w2' ? 'live' : w.status) }).snap;
  out['D11 hold the standings card open while the week becomes unconfirmed (the server says LIVE): the detail is null — the calm unavailable state'] = !!rk && CDm.buildCardDetail(rk, liveSnap, CTX) === null;
  // retired ids and types
  out['D12 a retired type (an old shared called.it / stood.alone / player.week card) resolves to null — the calm unavailable state, never a builder'] =
    ['called.it', 'stood.alone', 'player.week'].every(t => CDm.buildCardDetail({ id: `${t}:L1:w2:p2:g21`, type: t, weekId: 'w2', gameId: t === 'player.week' ? null : 'g21', memberId: 'p2', facts: { playerId: 'p2', playerName: 'Brayden', team: 'Washington', matchup: 'Washington at Oregon', wins: 3, losses: 1 }, reason: 'In your league', sortKey: '2026-09-12T16:00:00.000Z' }, snap, CTX) === null);
  return out;
}

/** [6b] an old shared id resolves to nothing in the app's own resolver (DI-575/597 behaviour, verified) */
function resolverChecks() {
  const out = {};
  const { e } = envSnap(league('final'));
  e.home.renderHome();
  out['O1 resolveCardDetail("called.it:L1:w2:p2:g21") — a card id shared before this release — is null (the screen shows the calm unavailable state)'] = e.home.resolveCardDetail('called.it:L1:w2:p2:g21') === null && e.home.resolveCardDetail('player.week:L1:w2:p5') === null && e.home.resolveCardDetail('rank.changed:L1:w2:p3') === null;
  out['O2 …while the NEW combined id resolves (positive control)'] = !!e.home.resolveCardDetail('rank.changed:L1:w2:-');
  out['O3 the feed paints no retired card and every combined card is a tap target the dispatcher accepts'] = (() => { const s = e.home._sessionForTest(); return s.cardIds.includes('rank.changed:L1:w2:-') && s.cardIds.includes('streak.extended:L1:w2:-') && !s.cardIds.some(id => /^(called\.it|stood\.alone|player\.week):/.test(id)); })();
  return out;
}

// ═══ run ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const GROUPS = [
  ['[1] DI-W92-4 nameList', () => nameListChecks(fc)],
  ['[2] DI-W92-1 combined weekly cards', () => combineChecks(fc)],
  ['[2b] DI-W92-1 copy', () => combineCopyChecks(fc)],
  ['[3] DI-W92-2 the game card names who called it / stood alone', () => standoutChecks(fc)],
  ['[4] DI-W92-3 personal-record cards leave Home', () => recordChecks(fc)],
  ['[5] DI-W92-5 one supporting line, from the pinned table', () => lineChecks(H, fc)],
  ['[6] DI-W92-6 the combined card\'s detail', () => detailChecks(CD, fc)],
  ['[6b] DI-W92-6 old ids', () => resolverChecks()],
  ['[7] DI-W92-11 retired types', () => retiredChecks(fc)],
];
if (!KIT_ONLY) {
  for (const [title, run] of GROUPS) {
    console.log(`\n${title}…`);
    let res = {};
    try { res = run(); } catch (e) { assert(false, `${title} threw: ${e && e.message}`); continue; }
    for (const [label, ok] of Object.entries(res)) assert(ok === true, label);
  }
}

// ═══ [M] THE MUTATION KIT (S-3) ═══════════════════════════════════════════════════════════════════════════════════════
console.log('\n[M] MUTATION KIT — scratch copies loaded as data: URLs; each mutant must turn a NAMED check RED…');
const URL_OF = (rel) => new URL(rel, import.meta.url).href;
async function loadMutant(rel, edits) {
  let src = await read(rel);
  for (const [a, b] of edits) {
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${a.slice(0, 120)}`);
    src = src.split(a).join(b);
  }
  src = src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${URL_OF('./js/' + f)}'`);
  return import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}
async function kill(label, rel, edits, runner, mustFail) {
  let res = null, err = null;
  try { const mod = await loadMutant(rel, edits); res = runner(mod); } catch (e) { err = e; }
  if (err) { assert(false, `${label} — the mutant could not be built: ${err.message}`); return; }
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every(m => failed.some(f => f.startsWith(m)));
  assert(failed.length > 0 && hit, `${label} → RED on: ${failed.slice(0, 4).map(f => f.slice(0, 80)).join(' | ') || '(nothing — the mutant SURVIVED)'}`);
}
{
  // positive control: the unmutated modules pass every check group the kit re-runs
  const ctl = { ...nameListChecks(fc), ...combineChecks(fc), ...combineCopyChecks(fc), ...standoutChecks(fc), ...recordChecks(fc), ...retiredChecks(fc), ...lineChecks(H, fc), ...detailChecks(CD, fc) };
  assert(Object.values(ctl).every(Boolean), `M0: POSITIVE CONTROL — the real modules pass all ${Object.keys(ctl).length} named checks, so a red below is the mutation's doing`);
  const FC = './js/feed-cards.js', CDF = './js/card-detail.js', HF = './js/home.js';
  // DI-W92-11's named mutants (combine half)
  await kill('M1: admit a member WITHOUT its own gate (the S-C10 per-member check on streaks removed)', FC,
    [["if (!nm || !othersConfirmed(W, { memberId: p.playerId, selfExempt: true })) continue;\n        const ordered", "if (!nm) continue;\n        const ordered"]], combineChecks, ['C7', 'C10']);
  await kill('M2: build a group ACROSS weeks (the streak members list is no longer reset per week)', FC,
    [['const extended = [], broken = [];', 'const extended = _w92Ext, broken = _w92Brk;'], ['  const statsMemo = new Map();', '  const statsMemo = new Map(); const _w92Ext = [], _w92Brk = [];']], combineChecks, ['C3']);
  await kill('M3: emit a RETIRED type (a stood.alone card is pushed beside the game card again)', FC,
    [["          sortKey: isoAt(base),\n        });", "          sortKey: isoAt(base),\n        });\n        if (standout && standout.kind !== 'called') push('stood.alone', W, { memberId: standout.names[0].playerId, suffix: g.gameId, facts: { playerId: standout.names[0].playerId, playerName: standout.names[0].playerName, team: standout.team, matchup: `${g.awayTeam} at ${g.homeTeam}`, against: standout.against }, sortKey: isoAt(base, 1) });"]], retiredChecks, ['RT3']);
  await kill('M4: show the standout in an OPEN week (the game card no longer asks the reveal gate, only the game\'s own status)', FC,
    [["if (gate('game.final', W, g) && othersConfirmed(W)) {", "if (g.status === 'final' && othersConfirmed(W)) {"]], standoutChecks, ['S10', 'S11']);
  await kill('M5: drop the LOSER from the week-final fallback body', FC,
    [["body = `${t(f.weekWinnerName)} took it, ${t(f.weekWinnerRecord)}; ${t(f.weekLoserName)} finished ${t(f.weekLoserRecord)}.`;", "body = `${t(f.weekWinnerName)} took it, ${t(f.weekWinnerRecord)}.`;"]], recordChecks, ['R2']);
  await kill('M6: let a caption show on a RESTATING type (picks.submitted) again', FC,
    [["export const CAPTION_TYPES_THAT_ADD_A_FACT = Object.freeze(['week.result']);", "export const CAPTION_TYPES_THAT_ADD_A_FACT = Object.freeze(['week.result', 'picks.submitted', 'rank.changed']);"]],
    (F) => ({ ...retiredChecks(F), ...lineChecks(H, F) }), ['RT4']);
  await kill('M6b: …the same, through home.js\'s own gate (cardHTML shows any caption it gets)', HF,
    [['const showCaption = !!captionHtml && CAPTION_TYPES_THAT_ADD_A_FACT.includes(card.type) && !keepsBody;', 'const showCaption = !!captionHtml && !keepsBody;']], (Hm) => lineChecks(Hm, fc), ['L1', 'L3', 'L4']);
  await kill('M7: an UNESCAPED name in a combined title (nameList over the raw names)', FC,
    [['const names = (list) => nameList(list.map(m => t(m.playerName)));', 'const names = (list) => nameList(list.map(m => String(m.playerName)));']], nameListChecks, ['N6']);
  await kill('M7b: an unescaped name in the game card\'s supporting line', FC,
    [['const who = nameList(asArray(so.names).map(n => t(n && n.playerName)));', 'const who = nameList(asArray(so.names).map(n => String(n && n.playerName)));']], standoutChecks, ['S14']);
  await kill('M8: nameList uses an ampersand / serial comma again', FC,
    [["return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;", "return n.length === 1 ? n[0] : `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;"]], nameListChecks, ['N2']);
  await kill('M9: the per-member allow-list is skipped (members pass through raw)', FC,
    [['if (k === \'members\') { out[k] = asArray(out[k]).map(m => cleanMember(m, itemKeys)).filter(Boolean); continue; }', 'if (k === \'members\') continue;']], combineChecks, ['C17']);
  await kill('M10: a member crossing two marks is listed twice (one entry per mark)', FC,
    [['const crossed = MILESTONE_MARKS.filter(mark => before < mark && after >= mark);\n        if (crossed.length) crossedMembers.push({ playerId: p.playerId, playerName: nm, mark: Math.max(...crossed), total: after });',
      'const crossed = MILESTONE_MARKS.filter(mark => before < mark && after >= mark);\n        for (const mk of crossed) crossedMembers.push({ playerId: p.playerId, playerName: nm, mark: mk, total: after });']], combineChecks, ['C12']);
  await kill('M11: Compare is offered on a combined (several-member) detail', CDF,
    [['...(single ? compareAction(env, single.playerId, single.playerName) : [])', '...compareAction(env, members[0].playerId, members[0].playerName)']], (C) => detailChecks(C, fc), ['D4']);
  // A retired type is refused TWICE — the RETIRED_CARD_TYPES early return, and no builder for it — so (the 11-10g pattern) each layer alone holds
  // and only both removed together let an old shared id open a screen.
  {
    const onlyGuard = await loadMutant(CDF, [['if (RETIRED_CARD_TYPES.includes(card.type)) return null;', '']]);
    const onlyBuilder = await loadMutant(CDF, [['const builder = BUILDERS[card.type];', "const builder = BUILDERS[card.type] || BUILDERS['game.final'];"]]);
    const d12 = (C) => Object.entries(detailChecks(C, fc)).find(([l]) => l.startsWith('D12'))[1];
    assert(d12(onlyGuard) === true && d12(onlyBuilder) === true, 'M12a: either layer alone HOLDS (the early return removed, or a builder found for a retired type): an old shared id still opens nothing');
  }
  await kill('M12b: BOTH layers removed — an old shared called.it / stood.alone / player.week id opens a screen again', CDF,
    [['if (RETIRED_CARD_TYPES.includes(card.type)) return null;', ''], ['const builder = BUILDERS[card.type];', "const builder = BUILDERS[card.type] || BUILDERS['game.final'];"]], (C) => detailChecks(C, fc), ['D12']);
  await kill('M13: the detail stops asking the reveal gate (a screen held open while the week becomes unconfirmed keeps its content)', CDF,
    [['  if (!passed) return null;\n', '']], (C) => detailChecks(C, fc), ['D11']);
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
