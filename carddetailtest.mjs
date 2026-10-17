/**
 * CFB Pickems — carddetailtest.mjs (Deployment 1, Lane B, DI-575 / DI-576 / PF-442, 2026-10-07)
 * ============================================================================================
 * The proof for js/card-detail.js — the detail behind a Home feed card — run over the hand-derived statsfixtures league with a REAL home.js snapshot.
 *
 *   [1] The catalog — all fifteen card types have a provider; streak.extended / streak.broken share one layout; a type with no provider has none (non-tappable, never a dead end)
 *   [2] Every type's content — distinct, substantive, and EQUAL to the figure Standings / the weekly update / the card itself states (parity, not recomputation by the code under test)
 *   [3] THE BLIND RULE, per reveal class × week status — the gate is asked of the CURRENT snapshot, with positive controls; S-C10; signed out; deny-by-default facts
 *   [4] Missing data — a vanished week / game, an unknown type, a throwing builder: null, never a thrown render; thin data gets the honest note
 *   [5] The markup — escaped at the sink, the structure, "Show all N" past twelve, the unavailable state
 *   [6] Live language — a live game's row is tentative; no banned word for a non-final phase
 *   [7] Source pins
 *   [8] MUTATION PROOFS on scratch copies (never the file) — the named blind-rule proof #1 (remove the reveal gate) and its neighbours
 *
 * Run:  node carddetailtest.mjs     (also under TZ=UTC: the formatter is injected, so no zone-dependent call is made)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installDom, mkHomeEnv, NOW, HOUR, MIN, iso, esc } from './d1homeenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const doc = installDom();
const home = await import('./js/home.js');
const fc = await import('./js/feed-cards.js');
const CD = await import('./js/card-detail.js');
const scoring = await import('./js/scoring.js');
const gs = await import('./js/game-state.js');
const notify = await import('./js/notify-copy.js');
const fx = await import('./statsfixtures.mjs');
const SRC = await read('./js/card-detail.js');
const { calculateWeeklyResults, calculateSeasonStandings } = scoring;

const CTX = { pilotHistory: true, formatTime: (v) => `T[${typeof v === 'number' ? new Date(v).toISOString().slice(5, 16) : String(v).slice(5, 16)}]`, formatCountdown: (ms) => `${Math.round(ms / HOUR)}h`, capabilities: { thread: true, chat: true }, threadCount: () => 3 };
const league = (w2, extra = {}) => fx.buildLeague({ w2, calculateWeeklyResults, ...extra });
const CHAT = { scribe: [{ id: 'sp1', leagueId: 'L1', ts: NOW - HOUR, author: 'scribe', authorName: 'SCRIBE', body: 'Week 2 is locked.\nSecond line.', reactionCount: 1, context: { weekId: 'w2', weekN: 2, gameId: 'g24', matchup: 'UCLA at USC' }, meta: { kind: 'lifecycle', test: false } }],
  lockerRoom: [{ id: 'lr1', leagueId: 'L1', ts: NOW - HOUR, author: 'p3', authorName: 'Kevin', body: 'Texas is not covering that, trust me', reactionCount: 3, meta: { kind: null, test: false } }] };

function mk(L, o = {}) {
  const e = mkHomeEnv({ home }, doc, L, { read: { currentWeek: () => L.weeks[L.weeks.length - 1] }, chat: CHAT, ...o });
  const viewerId = o.viewer === undefined ? 'p1' : o.viewer;
  const snap = e.home.assembleSnapshot({ viewerId, isCommissioner: !!o.admin, now: NOW });
  const cards = fc.deriveCards(snap, { viewerId, now: NOW, viewerIsCommissioner: !!o.admin });
  return { e, snap, cards, viewerId };
}
const find = (cards, type, pred = () => true) => cards.find(c => c.type === type && pred(c));
// W-92 (DI-W92-1 / DI-W92-6): a combined card narrowed to ONE member opens exactly the detail that member's own card opened before v0.30.1 —
// the per-member layouts below are pinned through it. `combined(type, week)` is the real (several-member) card.
const oneOf = (card, pid) => (card ? { ...card, facts: { ...card.facts, members: card.facts.members.filter(m => m.playerId === pid) } } : null);
const retiredCard = (type) => ({ id: `${type}:L1:w2:p2${type === 'player.week' ? '' : ':g21'}`, type, weekId: 'w2', gameId: type === 'player.week' ? null : 'g21', memberId: 'p2', requiresReveal: fc.CARD_REVEAL_CLASS[type], facts: { playerId: 'p2', playerName: 'Brayden', team: 'Washington', matchup: 'Washington at Oregon', spreadDisplay: '+7', scoreLine: '20–17', against: 2, weekN: 2, wins: 3, losses: 1 }, reason: 'In your league', sport: 'cfb', sortKey: iso(NOW) });
const detail = (mod, card, snap, ctx = CTX) => mod.buildCardDetail(card, snap, ctx);
const rowOf = (m, label) => (m && m.rows.find(r => r.label === label)) || null;
const texts = (m) => JSON.stringify([m.headline, m.freshness, m.rows, m.lists, m.meaning, m.actions, m.note]);

const FINAL = mk(league('final'));
const LIVE = mk(league('live'));

// ═══ [1] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The catalog…');
{
  assert(JSON.stringify([...CD.DETAIL_TYPES].sort()) === JSON.stringify([...fc.CARD_TYPES].sort()), '1a: ALL fifteen card types have a detail provider (DI-575/576: every generated insight card opens a substantive screen)');
  assert(CD.hasDetail('game.final') && !CD.hasDetail('news') && !CD.hasDetail('future.type') && !CD.hasDetail(undefined) && !CD.hasDetail('__proto__') && !CD.hasDetail('constructor'), '1b: a type with no provider (a Lane C type that has not registered one, a forged name) has none — it renders non-tappable and never dead-ends');
  const ext = detail(CD, oneOf(find(FINAL.cards, 'streak.extended', c => c.weekId === 'w2'), 'p3'), FINAL.snap), brk = detail(CD, oneOf(find(FINAL.cards, 'streak.broken', c => c.weekId === 'w2'), 'p1'), FINAL.snap);
  assert(ext && brk && JSON.stringify(ext.rows.map(r => r.label)) === JSON.stringify(brk.rows.map(r => r.label)) && ext.lists[0].id === brk.lists[0].id && ext.title === 'Streak' && brk.title === 'Streak', '1c: streak.extended and streak.broken share ONE layout (the same rows and list, the same title) with their own sentences');
  assert(ext.meaning[0] === 'Kevin is on a 4-game miss streak.' && brk.meaning[0] === "Drew's 4-game streak snapped on Washington at Oregon.", '1d: …"{name} is on a {n}-game {kind} streak." / "{name}\'s {n}-game streak snapped on {matchup}."');
  const titles = Object.fromEntries(FINAL.cards.map(c => [c.type, CD.detailTitle(c)]));
  // W-92: the three retired types keep their catalogued titles (an old shared card still has a name), though none is derived any more.
  titles['player.week'] = CD.detailTitle({ type: 'player.week', facts: { playerName: 'Drew' } });
  titles['called.it'] = CD.detailTitle({ type: 'called.it', facts: {} });
  titles['stood.alone'] = CD.detailTitle({ type: 'stood.alone', facts: {} });
  titles['week.result'] = CD.detailTitle(find(FINAL.cards, 'week.result', c => c.weekId === 'w2'));
  assert(titles['week.result'] === 'Week 2' && titles['player.week'] === "Drew's week" && titles['game.final'] === 'Final' && titles['rank.changed'] === 'Rank change' && titles['year.ago'] === 'A year ago' && titles['lockerroom.top'] === 'Top message' && titles['scribe.post'] === 'SCRIBE' && titles['slate.published'] === 'Slate' && titles['called.it'] === 'Called it' && titles['stood.alone'] === 'Stood alone', '1e: the navigation-bar titles are DI-576\'s ("Week {N}", "{name}\'s week", "Final", "Rank change", …)');
}

// ═══ [2] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Every type\'s content — and its figures equal the ones the rest of the app states…');
{
  const { cards, snap } = FINAL;
  const all = cards.map(c => [c, detail(CD, c, snap)]);
  assert(all.every(([, m]) => m !== null), `2a: every one of the ${cards.length} derived cards (${[...new Set(cards.map(c => c.type))].length} types) opens a detail in a FINAL week`);
  assert(all.every(([, m]) => m.rows.length <= CD.MAX_ROWS && m.rows.every(r => r.label && String(r.value).length > 0)), '2b: at most eight rows, and a row whose value is unknown is OMITTED — never "—" or 0');
  const gf = detail(CD, find(cards, 'game.final', c => c.gameId === 'g24'), snap);
  assert(rowOf(gf, 'Line').value === 'USC -3' && rowOf(gf, 'Result').value === 'USC by 14' && rowOf(gf, 'Covered by').value === 'USC by 11', '2c: game.final — the line is Favorite + margin ("USC -3", never a signed number), the result and the cover margin are the game\'s own (24–10: USC by 14, covered by 11)');
  assert(rowOf(gf, 'Covered').value === 'Brayden, Koby, Jacob & Kihoon' && rowOf(gf, 'Missed').value === 'Drew & Kevin', '2d: …who covered and who missed come from the card\'s own chips (g24 hand-derived: p2 p4 p5 p6 won, p1 p3 lost)');
  assert(rowOf(gf, 'Your pick').value === 'UCLA ✗ missed' && gf.meaning[0] === 'You missed this one.' && gf.meaning[1] === 'That puts you at 1–3 for Week 2.', '2e: …the viewer\'s own pick with a glyph AND a word, "You missed this one.", and the week record from viewerWeekLine — "so far" is absent because Week 2 is final');
  assert(/Final · confirmed T\[/.test(gf.freshness), '2f: …and the freshness line is DI-570\'s "Final · confirmed {time}"');
  const live = detail(CD, find(LIVE.cards, 'game.final'), LIVE.snap);
  assert(/so far\.$/.test(live.meaning[live.meaning.length - 1]), `2g: in a LIVE week the same sentence says "so far" ("${live.meaning[live.meaning.length - 1]}")`);
  const wr = detail(CD, find(cards, 'week.result', c => c.weekId === 'w2'), snap);
  const w2rows = FINAL.snap.revealedWeeklyResults.filter(r => r.weekId === 'w2');
  const win = w2rows.find(r => r.isWinner), los = w2rows.find(r => r.isLoser);
  assert(rowOf(wr, 'Winner').value === `Jacob (${win.correctCount}–${win.incorrectCount})` && rowOf(wr, 'Loser').value === `Kevin (${los.correctCount}–${los.incorrectCount})` && wr.meaning[0] === 'Jacob took Week 2, 4–0.', '2h: week.result — winner and loser equal the STORED week result rows (parity with the Dashboard summary / the weekly update)');
  const tableCtx = { ...CTX, scoreSummaryRowsHTML: (week) => `<tr data-fixture="${week.weekId}"><td>1</td></tr>` };
  const wrT = detail(CD, find(cards, 'week.result', c => c.weekId === 'w2'), snap, tableCtx);
  assert(wrT.tableHtml === '<tr data-fixture="w2"><td>1</td></tr>' && /<tbody><tr data-fixture="w2">/.test(CD.cardDetailHTML(wrT, { escHtml: esc })), '2i: …and the week\'s standings table is the INJECTED Dashboard row renderer\'s own markup (one render path), spliced');
  // W-92 (DI-W92-3): the personal-record card is retired; every member's record is one tap away in the week-final card's table (2i). An old shared
  // player.week card opens nothing (the calm unavailable state).
  assert(!find(cards, 'player.week') && detail(CD, retiredCard('player.week'), snap) === null && wrT.tableHtml.length > 0, '2j: player.week is retired — no such card is derived, an old one opens nothing, and the week-final detail carries the full week table instead');
  const rkCard = find(cards, 'rank.changed', c => c.weekId === 'w2');
  const rk = detail(CD, oneOf(rkCard, 'p1'), snap);
  const standings = calculateSeasonStandings(fx.PLAYERS.map(p => ({ ...p })), FINAL.snap.revealedWeeklyResults, FINAL.snap.weeks, null);
  const p1s = standings.find(s => s.playerId === 'p1'), above = standings.find(s => s.currentRank === p1s.currentRank - 1);
  assert(rowOf(rk, 'To').value === `${fc.ordinal(p1s.currentRank)} of 6` && rowOf(rk, 'Season win %').value === `${p1s.winPct}%` && rowOf(rk, 'Gap to the rank above').value === `${above.totalCorrect - p1s.totalCorrect} picks (weighted)`, '2k: rank.changed — rank, Win % and the WEIGHTED gap equal calculateSeasonStandings\' own row (Standings parity)');
  assert(rk.meaning[1] === 'Rank counts each game by its multiplier. Win % counts every pick once.', '2l: …with Standings\' own sentence about raw versus weighted');
  const rkAll = detail(CD, rkCard, snap);
  const p1sec = rkAll && rkAll.lists.find(l => l.title === 'Drew');
  assert(!!p1sec && JSON.stringify(p1sec.items.map(i => [i.primary, i.secondary])) === JSON.stringify(rk.rows.slice(0, 4).map(r => [r.label, r.value])) && rkAll.rows.length === 0, '2l-b: W-92 parity — on the five-member card, Drew\'s section holds exactly the first four rows his own one-member detail shows (the same builder, no second computation)');
  // W-92 (DI-W92-2 / DI-W92-6): "called it" and "stood alone" live on the GAME's detail, as one list — the retired cards' rows, one per named member.
  const g21m = detail(CD, find(cards, 'game.final', c => c.gameId === 'g21'), snap);
  const ca = g21m && g21m.lists.find(l => l.id === 'standout');
  assert(!!ca && ca.title === 'Called it' && JSON.stringify(ca.items.map(i => [i.primary, i.secondary])) === JSON.stringify(['Brayden', 'Koby', 'Jacob', 'Kihoon'].map(n => [n, 'Washington +7 · won outright by 3'])), '2m: g21\'s detail lists "Called it": the four who took Washington +7 (the underdog\'s own line), each "won outright by 3" (g21 hand-derived: p2 p4 p5 p6)');
  assert(detail(CD, retiredCard('called.it'), snap) === null && rowOf(g21m, 'Result').value === 'Washington by 3', '2n: …the retired called.it card opens nothing, and the final margin stays on the game\'s own Result row');
  const g22m = detail(CD, find(cards, 'game.final', c => c.gameId === 'g22'), snap);
  const so = g22m && g22m.lists.find(l => l.id === 'standout');
  assert(!!so && so.title === 'Stood alone' && so.items.length === 1 && so.items[0].primary === 'Jacob' && so.items[0].secondary === 'Miami · against 5 · covered by 11' && detail(CD, retiredCard('stood.alone'), snap) === null, '2o: g22\'s detail lists "Stood alone": Jacob, "Miami · against 5 · covered by 11"; the retired stood.alone card opens nothing');
  const brk = detail(CD, oneOf(find(cards, 'streak.broken', c => c.weekId === 'w2'), 'p1'), snap);
  assert(rowOf(brk, 'Run').value === '4 covers' && rowOf(brk, 'Started').value === 'Week 1' && rowOf(brk, 'Longest this season').value === '4 covers' && brk.lists[0].items.length === 4 && brk.lists[0].items[0].key === 'g15' && brk.lists[0].items.every(i => i.mark === '✓'), '2p: streak.broken — the run (4 covers from Week 1), newest first (g15 is the last cover before the miss), all ✓');
  const ext = detail(CD, oneOf(find(cards, 'streak.extended', c => c.weekId === 'w2'), 'p3'), snap);
  assert(rowOf(ext, 'Run').value === '4 misses' && rowOf(ext, 'Started').value === 'Week 2' && rowOf(ext, 'Longest this season').value === '1 cover', '2q: streak.extended — a miss run is "4 misses", started Week 2; the longest COVER streak is singular when it is 1');
  const extAll = detail(CD, find(cards, 'streak.extended', c => c.weekId === 'w2'), snap);
  const kev = extAll && extAll.lists.find(l => l.title === 'Kevin');
  assert(!!kev && extAll.lists.map(l => l.title).join() === 'Kevin,Jacob' && JSON.stringify(kev.items.map(i => [i.primary, i.secondary])) === JSON.stringify(ext.rows.slice(0, 4).map(r => [r.label, r.value])) && extAll.meaning[0] === '2 members are on streaks.', '2q-b: W-92 parity — the two-member streak card is one screen with Kevin\'s and Jacob\'s sections, Kevin\'s rows exactly his own one-member detail\'s');
  const ya = detail(CD, find(cards, 'year.ago'), snap);
  assert(ya.lists[0].items.length === 6 && ya.lists[0].items[0].secondary === '7 correct' && ya.lists[0].items.every((it, i, a) => i === 0 || parseInt(a[i - 1].secondary, 10) >= parseInt(it.secondary, 10)) && rowOf(ya, 'This year so far').value === 'Jacob leads after Week 2' && ya.actions[0].id === 'see-2025', '2r: year.ago — the six members of the closed 2025 week, best first, this year\'s leader from Standings\' own function, and the path to the 2025 record');
  const sl = detail(CD, find(cards, 'slate.published'), snap);
  assert(rowOf(sl, 'Games').value === '4' && rowOf(sl, 'Your picks').value === '4 of 4 made' && sl.lists[0].items.length === 4 && /Oregon -7$/.test(sl.lists[0].items[0].secondary), '2s: slate.published — the game count, the viewer\'s OWN pick count, and the slate with each line as Favorite + margin');
  // D1 / DI-540 (consumertest, coordinator 2026-10-08): "Edit My Picks" is offered by the ONE lock state, never by the stored status. A week stored OPEN whose lock instant has passed is LOCKED.
  {
    const OPEN = league('open');
    const w2games = OPEN.games.filter(g => g.weekId === 'w2');
    const lockAt = Math.min(...w2games.map(g => Date.parse(g.kickoff))) - 30 * MIN;                // the default rule: the first kickoff minus 30 minutes
    const slateAt = (now) => {
      const e = mkHomeEnv({ home }, doc, OPEN, { read: { currentWeek: () => OPEN.weeks[OPEN.weeks.length - 1] }, chat: CHAT });
      const sn = e.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now });
      const cs = fc.deriveCards(sn, { viewerId: 'p1', now, viewerIsCommissioner: false });
      const c = find(cs, 'slate.published', x => x.weekId === 'w2');
      return { card: c, model: c ? detail(CD, c, sn) : null };
    };
    const before = slateAt(lockAt - 2 * HOUR), atInstant = slateAt(lockAt), after = slateAt(lockAt + 3 * HOUR);
    assert(!!before.model && before.model.actions[0].label === 'Edit My Picks', `2s-b: BEFORE the lock instant a stored-open week whose picks are all made offers "Edit My Picks" (${before.model && before.model.actions[0].label})`);
    assert(!!atInstant.model && atInstant.model.actions[0].label === 'View the slate' && atInstant.model.meaning.includes('Picks are locked.'), `2s-c: AT the lock instant it is closed ("at exactly the instant it is closed"): "View the slate", "Picks are locked." (${atInstant.model && atInstant.model.actions[0].label})`);
    assert(!!after.model && after.model.actions[0].label === 'View the slate' && !after.model.actions.some(a => /Edit My Picks|Make your picks/.test(a.label)), `2s-d: DERIVED-LOCKED (status open, lock instant passed): the screen does NOT offer "Edit My Picks" or "Make your picks" (${after.model && after.model.actions.map(a => a.label).join()})`);
    assert(!/status\s*===\s*['"]open['"]/.test(stripComments(SRC)) && /weekLockState\(\{ week, games, now: s\.now/.test(stripComments(SRC)) && /from '\.\/week-lock\.js'/.test(SRC), '2s-e: source — card-detail.js has no `status === \'open\'` gate and asks js/week-lock.js\'s weekLockState');
    const noLock = JSON.parse(JSON.stringify(OPEN)); noLock.weeks = noLock.weeks.map(w => (w.weekId === 'w2' ? { ...w, dataSourceMode: 'demo' } : w));
    const e2 = mkHomeEnv({ home }, doc, noLock, { read: { currentWeek: () => noLock.weeks[noLock.weeks.length - 1] }, chat: CHAT, admin: true });
    const sn2 = e2.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: true, now: lockAt + 3 * HOUR });
    const c2 = find(fc.deriveCards(sn2, { viewerId: 'p1', now: lockAt + 3 * HOUR, viewerIsCommissioner: true }), 'slate.published', x => x.weekId === 'w2');
    assert(!!c2 && detail(CD, c2, sn2).actions[0].label === 'Edit My Picks', '2s-f: a DEMO week is exempt from the derived lock (as on the server): it still offers "Edit My Picks"');
  }
  const sc = detail(CD, find(cards, 'scribe.post'), snap);
  assert(sc.headline.body === 'Week 2 is locked.\nSecond line.' && rowOf(sc, 'Week').value === 'Week 2' && rowOf(sc, 'Game').value === 'UCLA at USC' && sc.actions.some(a => a.id === 'open-chat' && a.params.messageId === 'sp1') && sc.actions.some(a => a.id === 'open-thread' && a.params.gameId === 'g24'), '2t: scribe.post — the full post verbatim, its week and game context, "Open in chat" for THAT message and the game\'s thread');
  const lr = detail(CD, find(cards, 'lockerroom.top'), snap);
  assert(lr.headline.body === 'Texas is not covering that, trust me' && rowOf(lr, 'From').value === 'Kevin' && rowOf(lr, 'Reactions').value === '3' && lr.actions[0].id === 'open-chat' && lr.actions[0].params.messageId === 'lr1', '2u: lockerroom.top — the FULL message (the card shows a 120-character excerpt), its author from the roster, the reaction count, and the path to that message');
  // picks.submitted / week.revealed in the right weeks
  const OPEN = mk(league('open'), { state: { now: Date.parse('2026-09-10T12:00:00.000Z') } });
  const ps = find(OPEN.cards, 'picks.submitted');
  if (ps) {
    const m = detail(CD, ps, OPEN.snap);
    assert(!!m && /^\d+ of \d+$/.test(rowOf(m, 'In').value) && rowOf(m, 'You').value === 'Submitted' && m.meaning[0] === "Everyone's picks stay hidden until kickoff." && m.meaning[1] === 'Only the count is shown.' && m.actions[0].label === 'Edit My Picks', '2v: picks.submitted — the count, the viewer\'s own status, and the sentence that says only the count is shown');
  } else assert(false, '2v: fixture — an OPEN week derives a picks.submitted card');
  const wrv = find(LIVE.cards, 'week.revealed');
  const wm = detail(CD, wrv, LIVE.snap);
  assert(!!wm && rowOf(wm, 'Games').value === '4' && wm.lists[0].items.length === 4 && wm.meaning[0] === 'Week 2 is revealed.' && wm.actions[0].id === 'go-dashboard' && wm.actions[0].params.weekId === 'w2', '2w: week.revealed — a row per game with the split and the viewer\'s own pick, and the path to the full slate for THAT week');
  // milestone: a 25-win sequence
  const SEQ = fx.buildSequence({ codes: 'W'.repeat(25), weekSizes: [13, 12], calculateWeeklyResults });
  const sq = mk(SEQ, { read: { currentWeek: () => SEQ.weeks[1] } });
  const mc = find(sq.cards, 'milestone.reached');
  const mm = mc && detail(CD, mc, sq.snap);
  assert(!!mm && rowOf(mm, 'Mark').value === '25 correct picks' && rowOf(mm, 'Season total').value === '25' && mm.lists[0].items.length === 1 && mm.lists[0].items[0].key === 'q25' && mm.meaning[0] === 'Drew hit 25 correct picks this season.', '2x: milestone.reached — the mark, the season total, and the ONE pick that crossed it (the 25th win, q25)');
}

// ═══ [3] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] THE BLIND RULE — the gate is asked of the current snapshot…');
{
  const OPEN = mk(league('open'), { state: { now: Date.parse('2026-09-10T12:00:00.000Z') } });
  const LOCKED = mk(league('locked'), { state: { now: Date.parse('2026-09-12T10:00:00.000Z') } });
  const mkCard = (type, weekId, gameId = null, extra = {}) => ({ id: `${type}:L1:${weekId}:-${gameId ? ':' + gameId : ''}`, type, weekId, gameId, memberId: null, requiresReveal: fc.CARD_REVEAL_CLASS[type], facts: {}, reason: '', sport: 'cfb', sortKey: iso(NOW), ...extra });
  const g24 = FINAL.snap.games.find(g => g.gameId === 'g24');
  const fgFacts = { awayTeam: g24.awayTeam, homeTeam: g24.homeTeam, awayScore: 10, homeScore: 24, atsWinnerTeam: 'USC', marginCovered: '11', chips: [{ playerId: 'p2', initials: 'BR', result: 'win' }] };
  // after-reveal, game-scoped: game.final / called.it / stood.alone
  for (const type of ['game.final', 'called.it', 'stood.alone']) {
    const facts = type === 'game.final' ? { ...fgFacts, standout: { kind: 'called', names: [{ playerId: 'p2', playerName: 'Brayden' }], team: 'UCLA', spreadDisplay: '+3' } } : { playerId: 'p2', playerName: 'Brayden', team: 'UCLA', matchup: 'UCLA at USC', spreadDisplay: '+3', scoreLine: '24–10', against: 3 };
    const card = mkCard(type, 'w2', 'g24', { facts });
    const liveG = { ...LIVE.snap, games: LIVE.snap.games.map(g => (g.gameId === 'g24' ? { ...g, status: 'final', homeScore: 24, awayScore: 10 } : g)) };
    const notFinal = { ...liveG, games: liveG.games.map(g => (g.gameId === 'g24' ? { ...g, status: 'live' } : g)) };
    if (type === 'game.final') {
      assert(detail(CD, card, liveG) !== null, `3a CONTROL ${type}: a final game in a LIVE (public) week opens (and carries its standout)`);
      assert(detail(CD, card, OPEN.snap) === null && detail(CD, card, LOCKED.snap) === null, `3a ${type}: the same card in an OPEN or a LOCKED week is null (after-reveal: arePicksPublic and nothing else)`);
      assert(detail(CD, card, notFinal) === null, `3b ${type}: a game still LIVE inside a revealed week does not open (the game must itself be final)`);
    } else {
      // W-92: retired. Even where its gate WOULD pass (a final game in a public week) it opens nothing — and nowhere else either.
      assert(detail(CD, card, liveG) === null, `3a RETIRED ${type}: even a final game in a LIVE (public) week opens nothing (W-92: the calm unavailable state)`);
      assert(detail(CD, card, OPEN.snap) === null && detail(CD, card, LOCKED.snap) === null, `3a ${type}: the same card in an OPEN or a LOCKED week is null`);
      assert(detail(CD, card, notFinal) === null, `3b ${type}: …and while the game is still LIVE`);
    }
  }
  // after-final: week.result / player.week / rank.changed / streak / milestone
  assert(!FINAL.cards.some(c => c.type === 'player.week'), '3c-0: W-92 — no player.week card is derived in a FINAL week (retired; its 3c rows below are the combined cards\')');
  for (const type of ['week.result', 'player.week', 'rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached']) {
    const real = FINAL.cards.find(c => c.type === type && c.weekId === 'w2') || null;
    if (!real) continue;
    assert(detail(CD, real, FINAL.snap) !== null, `3c CONTROL ${type}: opens in a server-confirmed FINAL week`);
    assert(detail(CD, real, LIVE.snap) === null, `3c ${type}: the same week LIVE (public, not final) does not open`);
    const mirrorFinal = { ...FINAL.snap, confirmedStatusFor: () => 'live' };
    assert(detail(CD, real, mirrorFinal) === null, `3d ${type}: the local mirror says final but the SERVER-confirmed status does not → does not open (RG-253)`);
  }
  // week.revealed: the card is class 'never', its per-game rows are NOT
  const wrCard = mkCard('week.revealed', 'w2', null, { facts: { weekN: 2 } });
  const openM = detail(CD, wrCard, OPEN.snap);
  assert(!!openM && openM.lists.length === 0, '3f: week.revealed against an OPEN week: the card itself is never-class so a screen exists, but it carries NO per-game rows (arePicksPublic is false)');
  const liveM = detail(CD, wrCard, LIVE.snap);
  assert(!!liveM && liveM.lists.length === 1 && liveM.lists[0].items.length === 4, '3f CONTROL: …against the LIVE week the same card carries its four rows');
  const noConfirm = mk(league('live'), { supabase: true, picksRead: () => false });
  const ncM = detail(CD, wrCard, noConfirm.snap);
  assert(!!ncM && ncM.lists.length === 0, '3g: S-C10 — public on this device but the other members\' rows have not landed (picksReadConfirmed false): no per-game rows');
  const others = fx.PLAYERS.filter(p => p.playerId !== 'p1').map(p => p.displayName);
  const rowsText = JSON.stringify(liveM.lists);
  assert(others.every(n => !rowsText.includes(n)), '3h: the split is COUNTS only — no other member\'s name, initials or selection appears in a week.revealed row');
  // S-C10 on named facts
  const noC = mk(league('final'), { supabase: true, picksRead: () => false });
  // W-92: the game card is not even DERIVED without the confirmed rows; a game card held open while the rows go unconfirmed loses its "Called it" list.
  const g21NC = detail(CD, find(FINAL.cards, 'game.final', c => c.gameId === 'g21'), noC.snap);
  assert(!noC.cards.some(c => c.type === 'game.final') && !!g21NC && !g21NC.lists.some(l => l.id === 'standout'), '3i: S-C10 — without the confirmed rows no game card is derived, and one held open names no caller (its "Called it" list needs the flag)');
  const g22NC = detail(CD, find(FINAL.cards, 'game.final', c => c.gameId === 'g22'), noC.snap);
  assert(!!g22NC && !g22NC.lists.some(l => l.id === 'standout') && !/Jacob/.test(JSON.stringify(g22NC.lists)), '3j: S-C10 — …nor who stood alone');
  // signed out
  const anon = mk(league('final'), { viewer: null });
  const gfA = detail(CD, find(anon.cards, 'game.final'), anon.snap);
  assert(!!gfA && !rowOf(gfA, 'Your pick') && gfA.meaning.length === 0, '3k: signed out — no "Your pick" row and no personal sentence');
  const slA = detail(CD, find(anon.cards, 'slate.published'), anon.snap);
  assert(!!slA && !rowOf(slA, 'Your picks') && slA.actions.length === 0, '3l: signed out — no "Your picks" row and no Make-your-picks action');
  // deny-by-default facts
  const bad = (type, facts) => { try { CD.finalizeDetailFacts(type, facts); return 'ok'; } catch (e) { return 'threw'; } };
  assert(bad('game.final', { matchup: 'x', selectedTeam: 'Texas' }) === 'threw' && bad('game.final', { matchup: 'x', games: [{ primary: 'a', spread: -3 }] }) === 'threw' && bad('week.revealed', { games: [{ primary: 'a', margin: 3 }] }) === 'threw' && bad('week.revealed', { tiebreakerGuess: 4 }) === 'threw', '3m: a FORBIDDEN key (selectedTeam / spread / margin / tiebreakerGuess) offered at the top level or inside a list item THROWS — a builder offering one is a bug to fix, not paper over');
  const f = CD.finalizeDetailFacts('game.final', { matchup: 'A at B', secretPick: 'Texas', games: undefined, lineText: 'B -3' });
  assert(f.matchup === 'A at B' && f.lineText === 'B -3' && !('secretPick' in f) && !('games' in f), '3n: any key outside the type\'s allow-list is DROPPED, never carried');
  const g = CD.finalizeDetailFacts('week.revealed', { games: [{ key: 'g', primary: 'A at B', secondary: 'x', mark: 'Texas ▲', hidden: 'Oklahoma', tone: 'covering' }, null, 'junk'] });
  assert(g.games.length === 1 && !('hidden' in g.games[0]) && g.games[0].mark === 'Texas ▲', '3o: structured items are rebuilt from the per-item allow-list (an extra field is dropped; junk entries removed)');
  const allFactKeys = Object.values(CD.DETAIL_ALLOWED_FACTS).flat().concat(Object.values(CD.DETAIL_ITEM_KEYS).flat());
  assert(allFactKeys.every(k => !notify.FORBIDDEN_META_KEYS.includes(k)), '3p: no fact name in any allow-list is a FORBIDDEN_META_KEYS entry');
  const everyFacts = FINAL.cards.map(c => detail(CD, c, FINAL.snap)).filter(Boolean).map(m => JSON.stringify(m.facts));
  assert(everyFacts.every(t => !notify.FORBIDDEN_META_KEYS.some(k => new RegExp(`"${k}"\\s*:`).test(t))), '3q: no finished model carries a forbidden key at any depth');
  assert(FINAL.cards.map(c => detail(CD, c, FINAL.snap)).filter(Boolean).every(m => !/selectedTeam|pickId|"playerId"/.test(JSON.stringify(m.rows) + JSON.stringify(m.lists) + JSON.stringify(m.meaning))), '3r: no raw pick object (selectedTeam / pickId) and no raw player id crosses into what the screen renders');
}

// ═══ [4] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Missing data…');
{
  const c = find(FINAL.cards, 'game.final');
  assert(detail(CD, { ...c, weekId: 'gone' }, FINAL.snap) === null, '4a: the week the card is about is gone → null (the screen shows the calm unavailable state)');
  assert(detail(CD, c, { ...FINAL.snap, games: FINAL.snap.games.filter(g => g.gameId !== c.gameId) }) === null, '4b: the game is gone → null');
  assert(detail(CD, { ...c, type: 'news' }, FINAL.snap) === null && detail(CD, null, FINAL.snap) === null && detail(CD, undefined, FINAL.snap) === null && detail(CD, { type: 'game.final' }, FINAL.snap) === null, '4c: an unknown type, a missing card or a card with no week → null, never a throw');
  assert(detail(CD, c, null) === null && detail(CD, c, 'x') === null, '4d: a missing snapshot → null');
  const thrown = (() => { const real = console.error; console.error = () => {}; try { const bomb = { ...FINAL.snap, get picks() { throw new Error('boom'); } }; return detail(CD, find(FINAL.cards, 'game.final'), bomb); } finally { console.error = real; } })();
  assert(thrown === null, '4e: a builder that throws is caught → null (logged, never shown) — the screen becomes the calm state, not a blank page');
  const sparse = { ...FINAL.snap, picks: [], revealedPicks: [] };
  const wr = detail(CD, find(FINAL.cards, 'week.result'), { ...sparse, revealedWeeklyResults: FINAL.snap.revealedWeeklyResults });
  assert(!!wr && (wr.note === 'Not enough data for more detail yet.') === (wr.rows.length < 2 && wr.lists.length === 0 && !wr.tableHtml), '4f: the "Not enough data for more detail yet." note appears exactly when fewer than two rows (and no list) survive');
  const thin = CD.buildCardDetail({ ...find(FINAL.cards, 'week.result'), facts: { ...find(FINAL.cards, 'week.result').facts, weekWinnerName: '', weekLoserName: '' } }, FINAL.snap, CTX);
  assert(thin === null || typeof thin.note === 'string', '4g: thin facts degrade to the note or to null, never to a thrown error');
  const un = CD.unavailableDetailHTML({ escHtml: esc });
  assert(/Details for this card aren&?#?39?;?t available right now\.|Details for this card aren't available right now\./.test(un) && /It may have been updated or removed\./.test(un) && /data-cd-action="back-home"/.test(un) && />Back to Home</.test(un) && /role="status"/.test(un), '4h: the unavailable state — what happened, why, what to do next (one button back), calm words, no technical text');
  assert(CD.UNAVAILABLE_COPY.title === "Details for this card aren't available right now." && CD.UNAVAILABLE_COPY.body === 'It may have been updated or removed.' && CD.UNAVAILABLE_COPY.button === 'Back to Home', '4i: the copy is DI-575\'s exactly');
}

// ═══ [5] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] The markup…');
{
  let threw = false; try { CD.cardDetailHTML({ rows: [], lists: [], meaning: [], actions: [], eyebrow: {}, headline: {} }, {}); } catch (e) { threw = e instanceof TypeError; }
  assert(threw, '5a: escHtml is REQUIRED — there is no String() fallback');
  const hostile = '<img src=x onerror=alert(1)>"\'&';
  const model = { type: 'game.final', id: 'x', title: 'Final', eyebrow: { reason: hostile, sport: 'CFB' }, headline: { title: hostile, body: hostile }, freshness: hostile, rows: [{ label: hostile, value: hostile }],
    lists: [{ id: 'g', title: hostile, items: [{ key: hostile, primary: hostile, secondary: hostile, mark: hostile, markWord: hostile, tone: 'win' }] }], tableHtml: '', meaning: [hostile], actions: [{ id: 'open-thread', label: hostile, tone: 'primary', params: { gameId: hostile } }], note: hostile };
  const html = CD.cardDetailHTML(model, { escHtml: esc });
  const t = doc.createElement('div'); t.innerHTML = html;
  assert(!t.querySelector('img') && !html.includes('<img') && (html.match(/&lt;img src=x onerror=alert\(1\)&gt;/g) || []).length >= 9, `5b: every dynamic string is escaped at the sink — head, rows, list items, marks, meaning, action labels and ids, the note (${(html.match(/&lt;img/g) || []).length} escaped occurrences)`);
  const real = CD.cardDetailHTML(detail(CD, find(FINAL.cards, 'game.final'), FINAL.snap), { escHtml: esc, iconHtml: '<span class="cd-eyebrow-icon" aria-hidden="true"></span>' });
  const r = doc.createElement('div'); r.innerHTML = real;
  const order = r.querySelector('.cd').children.map(n => n.className.split(' ').find(c => /^cd-(head|numbers|list|table|meaning|actions)$/.test(c)));
  assert(order.join() === 'cd-head,cd-numbers,cd-meaning,cd-actions', `5c: anatomy top to bottom — headline card, "The numbers", "What it means", the action group (${order.join(' > ')})`);
  assert(!!r.querySelector('.cd-head .cd-eyebrow-icon') && r.querySelectorAll('.cd-row').length === 6 && r.querySelector('h4.cd-h').textContent === 'The numbers', '5d: the eyebrow icon is spliced, the rows are <dl>-style key/value pairs, and the section heading is real heading markup');
  const btn = r.querySelector('button[data-cd-action="open-thread"]');
  assert(!!btn && btn.getAttribute('type') === 'button' && btn.getAttribute('data-cd-game') === 'g24' && btn.textContent === 'Open thread · 3' && btn.classList.contains('btn'), '5e: actions are real <button type="button"> carrying only an allow-listed id and its parameters ("Open thread · 3" from the injected count)');
  const big = { ...model, lists: [{ id: 'many', title: 'Many', items: Array.from({ length: 15 }, (_, i) => ({ key: 'k' + i, primary: 'Game ' + i, secondary: 's', mark: '', markWord: '', tone: '' })) }] };
  const bh = doc.createElement('div'); bh.innerHTML = CD.cardDetailHTML(big, { escHtml: esc });
  assert(bh.querySelectorAll('.cd-item').length === 15 && bh.querySelectorAll('.cd-item--extra').length === 3 && bh.querySelector('.cd-more').textContent === 'Show all 15' && bh.querySelector('.cd-more').getAttribute('aria-expanded') === 'false' && bh.querySelector('[data-cd-list]').getAttribute('data-expanded') === 'false', '5f: past twelve rows the list says "Show all 15" (collapsed, aria-expanded=false, the extras marked) — twelve is the preview');
  assert(!/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(real.replace(/data-key="[^"]*"/g, '')), '5g: no raw ISO timestamp is ever rendered (CONVENTIONS #19)');
  const live = CD.cardDetailHTML(detail(CD, find(LIVE.cards, 'week.revealed'), LIVE.snap), { escHtml: esc });
  assert(/<span class="cd-mark cd-mark--(covering|trailing)"[^>]*>[^<]*[▲▽]<span class="sr-only"> (covering|trailing)<\/span>/.test(live), '5h: a live mark carries its glyph AND a screen-reader word — never colour alone');
}

// ═══ [6] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Live language…');
{
  const wm = detail(CD, find(LIVE.cards, 'week.revealed'), LIVE.snap, { ...CTX, liveEntryFor: (id) => (id === 'g22' ? { name: 'STATUS_IN_PROGRESS', shortDetail: 'Q3 4:12', capturedAt: NOW - 20000 } : null) });
  const row = wm.lists[0].items.find(i => i.key === 'g22');
  assert(!!row && /Q3 4:12/.test(row.secondary) && /▲|▽|^[A-Za-z ]+$/.test(row.mark || 'x'), `5i/6a: the LIVE game\'s row carries the capture\'s own label ("${row && row.secondary}") and the viewer\'s mark is a tentative ▲ / ▽ (${JSON.stringify(row && row.mark)})`);
  assert(!gs.containsBannedLiveWord(JSON.stringify(wm.lists)) && !gs.containsBannedLiveWord(wm.meaning.join(' ')), '6b: no banned live word (won / lost / clinched / locked in / decided) in a live-week screen\'s rows or sentences');
  const stale = detail(CD, find(LIVE.cards, 'week.revealed'), LIVE.snap, { ...CTX, liveEntryFor: () => null });
  const srow = stale.lists[0].items.find(i => i.key === 'g22');
  assert(/Score may be behind/.test(srow.secondary), '6c: a live game with no fresh capture says "Score may be behind" in its row (DI-570), not a stale quarter and clock');
  const finalRows = detail(CD, oneOf(find(FINAL.cards, 'streak.broken', c => c.weekId === 'w2'), 'p1'), FINAL.snap);   // W-92: player.week is retired; a FINAL streak run says covered / missed
  assert(finalRows.lists[0].items.every(i => ['covered', 'missed', 'pushed'].some(w => i.markWord.includes(w))), '6d: a FINAL game may say covered / missed (the only phase that may)');
  const allLive = LIVE.cards.map(c => detail(CD, c, LIVE.snap)).filter(Boolean);
  const liveOnly = allLive.filter(m => ['week.revealed', 'slate.published'].includes(m.type));
  assert(liveOnly.every(m => !gs.containsBannedLiveWord(texts(m))), '6e: the live-week screens that describe an unfinished game (week.revealed, slate.published) use no banned word anywhere');
}

// ═══ [7] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Source pins…');
{
  const code = stripComments(SRC);
  const imps = [...code.matchAll(/import\s+([\s\S]*?)\s+from\s+'([^']+)'/g)].map(m => m[2]);
  const ALLOWED = ['./storage.js', './notify-copy.js', './feed-cards.js', './scoring.js', './data-model.js', './history-2025.js', './stats.js', './stats-core.js', './game-state.js', './week-lock.js'];   // week-lock.js (a pure leaf: scoring + data-model only) joined with the derived-lock fix (DI-540 consumertest, 2026-10-08)
  // './chat-share.js' joined 2026-10-08 (D1 Lane B, DI-597 Share to chat): the reference's one gate and the headline — a pure leaf that imports NOTHING (pinned just below), not the chat engine.
  ALLOWED.push('./chat-share.js');
  assert(imps.every(i => ALLOWED.includes(i)) && !imps.some(i => /app\.js|home\.js|chat\.js|chat-ui|chatTransport|supabase|backend/.test(i)), `7a: card-detail.js imports only the pure modules (${imps.join(', ')}) — never home.js, app.js, the chat engine or the adapter`);
  {
    const { readFileSync: rf } = await import('node:fs');
    const cs = stripComments(rf(new URL('./js/chat-share.js', import.meta.url), 'utf8'));
    assert(!/^\s*import\s/m.test(cs) && !/\bimport\(/.test(cs), '7a-2: js/chat-share.js imports nothing (a pure leaf: no store, no chat engine, no DOM)');
  }
  const storageNames = [...code.matchAll(/import\s+\{([^}]*)\}\s+from\s+'\.\/storage\.js'/g)].flatMap(m => m[1].split(',').map(s => s.trim()));
  assert(storageNames.length === 1 && storageNames[0] === 'arePicksPublic', '7b: the storage import is READ-only and is exactly arePicksPublic (the one reveal question)');
  assert(!/canViewOtherPicks/.test(code), '7c: the module never names canViewOtherPicks (the commissioner no-stake bypass must not reach a passively opened screen)');
  assert(!/\blocalStorage\b|\bsave\(|\bsendEvent|\bfetch\(|Math\.random/.test(code), '7d: no storage write, no network, no randomness');
  assert((code.match(/Date\.now\(\)/g) || []).length === 1 && /: Date\.now\(\)/.test(code), '7e: the only clock read is the snapshot-less default for `now`');
  assert(!/\.then\(|(^|[^\w$.])var\s|\.at\(|Object\.hasOwn\(|findLast\(/.test(code), '7f: no .then() chain, no var, iOS 15.0 safe (no .at() / Object.hasOwn / findLast)');
  assert(!/#[0-9a-fA-F]{3,8}\b/.test(code.replace(/&#\d+;/g, '')), '7g: no colour literal');
  assert(/isRevealed\(/.test(code) && (code.match(/isRevealed\(/g) || []).length === 1, '7h: the gate is asked in exactly ONE place, before any builder runs');
  const gateAt = SRC.indexOf('const passed = isRevealed('), builderAt = SRC.indexOf('parts = builder(env)');
  assert(gateAt > 0 && builderAt > gateAt && SRC.indexOf('if (!passed) return null;') > gateAt && SRC.indexOf('if (!passed) return null;') < builderAt, '7i: source order — the gate, then `if (!passed) return null`, then the builder (S-C5: nothing is read before the gate has passed)');
}

// ═══ [8] ═════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] MUTATION PROOFS — scratch copies loaded as data: URLs (never the file)…');
{
  const base = new URL('./js/', import.meta.url).href;
  const retarget = (src) => src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${base}${f}'`);
  const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(retarget(src)).toString('base64') + '#' + Math.random());
  const OPENS = mk(league('open'), { state: { now: Date.parse('2026-09-10T12:00:00.000Z') } });
  const gcard = { id: 'game.final:L1:w2:-:g24', type: 'game.final', weekId: 'w2', gameId: 'g24', memberId: null, requiresReveal: 'after-reveal', facts: { awayTeam: 'UCLA', homeTeam: 'USC', awayScore: 10, homeScore: 24, atsWinnerTeam: 'USC', marginCovered: '11', chips: [] }, reason: '', sport: 'cfb', sortKey: iso(NOW) };
  const probe = (m) => {
    const o = {};
    const openGame = { ...OPENS.snap, games: OPENS.snap.games.map(g => (g.gameId === 'g24' ? { ...g, status: 'final', homeScore: 24, awayScore: 10 } : g)) };
    o.gate = m.buildCardDetail(gcard, openGame, CTX) === null;                                                                                   // BLIND-RULE PROOF #1: an OPEN week never opens a game.final
    o.afterFinal = m.buildCardDetail(find(FINAL.cards, 'week.result'), { ...LIVE.snap, weeks: LIVE.snap.weeks }, CTX) === null || find(FINAL.cards, 'week.result').weekId !== 'w2';
    const mirror = m.buildCardDetail(find(FINAL.cards, 'week.result'), { ...FINAL.snap, confirmedStatusFor: () => 'live' }, CTX);
    o.serverConfirmed = mirror === null;
    const wrv = { id: 'week.revealed:L1:w2:-', type: 'week.revealed', weekId: 'w2', gameId: null, memberId: null, requiresReveal: 'never', facts: { weekN: 2 }, reason: '', sport: 'cfb', sortKey: iso(NOW) };
    const rv = m.buildCardDetail(wrv, OPENS.snap, CTX);
    o.rowsNeedPublic = !!rv && rv.lists.length === 0;
    const nc = mk(league('live'), { supabase: true, picksRead: () => false });
    const rv2 = m.buildCardDetail(wrv, nc.snap, CTX);
    o.rowsNeedConfirmed = !!rv2 && rv2.lists.length === 0;
    // W-92: the game card's "Called it" / "Stood alone" list needs the S-C10 flag (with it the list is there — the positive half); a retired card opens nothing.
    const g21c = find(FINAL.cards, 'game.final', c => c.gameId === 'g21');
    const ca = m.buildCardDetail(g21c, { ...FINAL.snap, picksReadConfirmed: {} }, CTX), caOk = m.buildCardDetail(g21c, FINAL.snap, CTX);
    o.namesNeedConfirmed = !!ca && !ca.lists.some(l => l.id === 'standout') && !!caOk && caOk.lists.some(l => l.id === 'standout');
    o.stoodNamesNeedConfirmed = m.buildCardDetail(retiredCard('stood.alone'), FINAL.snap, CTX) === null && m.buildCardDetail(retiredCard('called.it'), FINAL.snap, CTX) === null;
    let leaked = 'ok'; try { m.finalizeDetailFacts('game.final', { selectedTeam: 'Texas' }); leaked = 'no throw'; } catch { leaked = 'ok'; }
    o.forbiddenThrows = leaked === 'ok';
    const kept = m.finalizeDetailFacts('game.final', { matchup: 'A', stray: 'x' });
    o.dropsStray = !('stray' in kept);
    const p2 = mk(league('final'), { viewer: 'p2' });
    const g2 = m.buildCardDetail(find(p2.cards, 'game.final', c => c.gameId === 'g24'), p2.snap, CTX);
    o.ownPickOnly = !!g2 && rowOf(g2, 'Your pick') && rowOf(g2, 'Your pick').value === 'USC ✓ covered';                  // S-C3: the viewer's OWN pick — never "the first pick found" (p1's is UCLA)
    const anon = mk(league('final'), { viewer: null });
    const ga = m.buildCardDetail(find(anon.cards, 'game.final'), anon.snap, CTX);
    o.anonNoPersonal = !!ga && !rowOf(ga, 'Your pick') && ga.meaning.length === 0;
    const lv = m.buildCardDetail(wrv, LIVE.snap, { ...CTX, liveEntryFor: () => null });
    o.staleWord = !!lv && lv.lists[0].items.some(i => /Score may be behind/.test(i.secondary));
    const tn = m.cardDetailHTML({ type: 'x', eyebrow: { reason: '<b>' }, headline: { title: '<b>', body: '' }, freshness: '', rows: [], lists: [], meaning: [], actions: [], note: '' }, { escHtml: esc });
    o.escapes = !tn.includes('<b>');
    return o;
  };
  const baseRes = probe(CD);
  assert(Object.values(baseRes).every(Boolean), `8-0: the probe is GREEN on the real module (positive control: ${Object.entries(baseRes).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all pass'})`);
  const R = (a, b) => { if (!SRC.includes(a)) throw new Error('mutation anchor missing: ' + a.slice(0, 60)); return SRC.replace(a, b); };
  const mutants = [
    ['BLIND-RULE PROOF #1 — the reveal gate is removed from buildCardDetail', R('if (!passed) return null;', ''), 'gate'],
    ['the gate always passes', R('  if (!passed) return null;', '  void passed;'), 'gate'],
    ['the week-final check uses the local mirror, not the confirmed status', R('confirmedWeekStatus: confirmed,', 'confirmedWeekStatus: week && week.status,'), 'serverConfirmed'],
    ['week.revealed shows its per-game rows without arePicksPublic', R('const rowsOk = arePicksPublic(week) && env.othersOk;', 'const rowsOk = env.othersOk;'), 'rowsNeedPublic'],
    ['week.revealed shows its per-game rows without the S-C10 flag', R('const rowsOk = arePicksPublic(week) && env.othersOk;', 'const rowsOk = arePicksPublic(week);'), 'rowsNeedConfirmed'],
    ['W-92: the game card\'s "Called it" list names members without the S-C10 flag', R('if (!so || !env.othersOk) return null;', 'if (!so) return null;'), 'namesNeedConfirmed'],
    ['W-92: a retired card (called.it / stood.alone) opens a screen again (the early return removed AND a builder found)', R("if (RETIRED_CARD_TYPES.includes(card.type)) return null;\n", '\n').replace("const builder = BUILDERS[card.type];", "const builder = BUILDERS[card.type] || BUILDERS['game.final'];"), 'stoodNamesNeedConfirmed'],
    ['a forbidden key no longer throws', R('assertDeepBlindSafe(facts);\n  const out = {};', 'const out = {};'), 'forbiddenThrows'],
    ['stray facts are carried through', R("for (const k of allowed) {\n    if (!facts", "for (const k of Object.keys(facts || {})) {\n    if (!facts"), 'dropsStray'],
    ['S-C3: the viewer\'s pick is "the first pick found" (another member\'s selection is shown as yours)', R("(s.viewerId ? (s.picks.find(p => p && p.gameId === gameId && p.playerId === s.viewerId) || null) : null)", "(s.picks.find(p => p && p.gameId === gameId) || null)"), 'ownPickOnly'],
    ['a live row ignores the DI-570 state label', R("bits.push(st.phase === 'upcoming' ? c.formatTime(g.kickoff) : st.label);", "bits.push(st.phase === 'upcoming' ? c.formatTime(g.kickoff) : 'Live');"), 'staleWord'],
    ['the markup is not escaped', R("const esc = requireEscHtml(escHtml, 'cardDetailHTML');", "const esc = (v) => String(v ?? '');"), 'escapes'],
  ];
  for (const [name, src, check] of mutants) {
    let res;
    try { res = probe(await load(src)); } catch (e) { res = { [check]: false, _err: String(e.message).slice(0, 80) }; }
    assert(src !== SRC && res[check] === false, `8: mutant "${name}" turns ${check} RED${res._err ? ' (' + res._err + ')' : ''}`);
  }
}

// ═══ [9] ═══════════════════════════════════════════════════════════════════════
console.log('\n[9] The card detail is STYLED (reviewer B1) — structural pins on css/styles.css, each with a mutant…');
{
  const CSS = await read('./css/styles.css');
  const BEGIN = CSS.indexOf('/* ═══ DEPLOYMENT 1 · LANE B — BEGIN'), END = CSS.indexOf('/* ═══ DEPLOYMENT 1 · LANE B — END');
  const blockOf = (css) => { const b = css.indexOf('/* DI-575 / DI-576 — the card detail'), e = css.indexOf('/* ═══ DEPLOYMENT 1 · LANE B — END'); return b >= 0 && e > b ? css.slice(b, e) : ''; };
  const rules = (blk) => [...blk.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
  const body = (rs, sel) => rs.filter(r => r.sel.split(',').map(x => x.trim()).includes(sel)).map(r => r.body).join(';');
  const pins = (css) => {
    const blk = blockOf(css), rs = rules(blk);
    const o = {};
    o.insideBanner = BEGIN >= 0 && css.indexOf('/* ═══ DEPLOYMENT 1 · LANE B — BEGIN') < css.indexOf('/* DI-575 / DI-576 — the card detail') && blk.length > 800;
    o.iconScoped = /width:16px/.test(body(rs, '.cd-eyebrow-icon')) && /height:16px/.test(body(rs, '.cd-eyebrow-icon')) && /width:16px/.test(body(rs, '.cd-eyebrow-icon svg')) && /height:16px/.test(body(rs, '.cd-eyebrow-icon svg'));
    o.noGlobalSvg = !rs.some(r => r.sel.split(',').some(x => /(^|[\s>+~])svg$/.test(x.trim()) && !/\.cd-[a-z-]+\s+svg$/.test(x.trim())));
    o.rowsLabelValue = /display:flex/.test(body(rs, '.cd-row')) && /justify-content:space-between/.test(body(rs, '.cd-row')) && /text-align:right/.test(body(rs, '.cd-row dd')) && /font-variant-numeric:tabular-nums/.test(body(rs, '.cd-row dd'));
    o.listReset = /list-style:none/.test(body(rs, '.cd-items')) && /margin:0/.test(body(rs, '.cd-items')) && /padding:0/.test(body(rs, '.cd-items'));
    o.titleSubStack = /flex-direction:column/.test(body(rs, '.cd-item-main'));
    o.extraHidden = /display:none/.test(body(rs, '.cd-item--extra'));
    o.extraOpens = rs.some(r => /^\.cd-list\[data-expanded="true"\]\s+\.cd-item--extra$/.test(r.sel) && /display:flex/.test(r.body));
    o.actionsGroup = /display:flex/.test(body(rs, '.cd-actions')) && /flex-wrap:wrap/.test(body(rs, '.cd-actions')) && /gap:8px/.test(body(rs, '.cd-actions')) && /justify-content:center/.test(body(rs, '.cd-actions'));
    o.actions44 = /min-height:44px/.test(body(rs, '.cd-action')) && /min-height:44px/.test(body(rs, '.cd-more'));
    o.actionsNoWrap = /white-space:nowrap/.test(body(rs, '.cd-action'));
    o.buttonTokens = /background:var\(--maroon\)/.test(body(rs, '.cd-action--primary')) && /color:var\(--on-accent\)/.test(body(rs, '.cd-action--primary')) && /background:var\(--bg-input\)/.test(body(rs, '.cd-action--secondary')) && /border:1px solid var\(--border\)/.test(body(rs, '.cd-action--secondary'));
    o.stackGap = /gap:16px/.test(body(rs, '.cd')) && /margin-top:0/.test(rs.filter(r => r.sel === '.cd .card+.card').map(r => r.body).join(';')) && /gap:8px/.test(body(rs, '.cd-card'));
    o.noColourLiterals = !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(blk.replace(/\/\*[\s\S]*?\*\//g, ''));
    const px = [...blk.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:padding|margin|gap)\s*:\s*([^;}]+)/g)].flatMap(m => m[1].match(/-?\d+(?:\.\d+)?px/g) || []).map(v => Math.abs(parseFloat(v)));
    o.grid8 = px.length >= 8 && px.every(v => v === 0 || v % 8 === 0 || v === 4);
    o.noMotionInvented = !/transition|animation|@keyframes|(?<!text-)transform/.test(blk.replace(/\/\*[\s\S]*?\*\//g, ''));
    return o;
  };
  const real = pins(CSS);
  assert(Object.values(real).every(Boolean), `9a: the shipped card-detail block satisfies every pin (${Object.entries(real).filter(([, v]) => !v).map(([k]) => k).join(', ') || 'all ' + Object.keys(real).length})`);
  assert(END > BEGIN && CSS.indexOf('/* DI-575 / DI-576 — the card detail') > BEGIN && CSS.indexOf('/* DI-575 / DI-576 — the card detail') < END, '9b: the block lives INSIDE the Lane B banner (BEGIN … END), before the Home block hometest pins as the last thing in the file');
  // every class the markup EMITS has a rule or is a named structural hook — the exact defect class of the first review (markup with no CSS at all)
  const emitted = new Set();
  for (const m of SRC.matchAll(/class="([^"]*)"/g)) for (const c of m[1].replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if ((/^cd[-_]/.test(c) || c === 'cd') && !/-$/.test(c)) emitted.add(c);   // (a trailing "--" is a template stem: its values are added below)
  for (const t of ['win', 'loss', 'push', 'covering', 'trailing']) emitted.add(`cd-mark--${t}`);
  for (const t of ['primary', 'secondary']) emitted.add(`cd-action--${t}`);
  const styled = new Set(rules(blockOf(CSS)).flatMap(r => r.sel.split(',')).flatMap(x => [...x.matchAll(/\.(cd[-_a-z0-9]*)/g)].map(m => m[1])));
  const HOOKS = ['cd-head', 'cd-numbers', 'cd-meaning', 'cd-unavail', 'cd--unavailable', 'cd-mark--push'];   // structural hooks: no rule of their own (they take the shipped .card / default text)
  const unstyled = [...emitted].filter(c => !styled.has(c) && !HOOKS.includes(c)).sort();
  assert(unstyled.length === 0, `9c: every cd-* class card-detail.js emits (${emitted.size}) has a rule in the block, or is one of the ${HOOKS.length} named hooks — unstyled: ${unstyled.join(', ') || 'none'}`);
  assert(HOOKS.every(h => emitted.has(h) || h === 'cd-mark--push'), '9d: …and every named hook is really emitted (a dead exemption must be removed, not left to excuse a future class)');
  // mutants: each way to un-style the screen turns a pin RED
  const MUT = [
    ['the scoped icon size is gone (the icon fills the card)', (c) => c.replace('.cd-eyebrow-icon svg{width:16px;height:16px}', ''), 'iconScoped'],
    ['a GLOBAL svg rule is used instead of a scoped one', (c) => c.replace('.cd-eyebrow-icon svg{width:16px;height:16px}', 'svg{width:16px;height:16px}'), 'noGlobalSvg'],
    ['the numbers lose label-left / value-right', (c) => c.replace('.cd-row{display:flex;align-items:baseline;justify-content:space-between;', '.cd-row{display:block;'), 'rowsLabelValue'],
    ['the numerals are proportional again', (c) => c.replace('color:var(--text-primary);font-variant-numeric:tabular-nums}\n/* Lists', 'color:var(--text-primary)}\n/* Lists'), 'rowsLabelValue'],
    ['the bullets come back', (c) => c.replace('.cd-items{list-style:none;', '.cd-items{'), 'listReset'],
    ['title and subtitle share a line', (c) => c.replace('.cd-item-main{display:flex;flex-direction:column;', '.cd-item-main{display:flex;'), 'titleSubStack'],
    ['rows past 12 are no longer hidden', (c) => c.replace('.cd-item--extra{display:none}', ''), 'extraHidden'],
    ['"Show all" no longer opens them', (c) => c.replace('.cd-list[data-expanded="true"] .cd-item--extra{display:flex}', ''), 'extraOpens'],
    ['the actions touch', (c) => c.replace('.cd-actions{display:flex;flex-wrap:wrap;gap:8px;', '.cd-actions{display:flex;flex-wrap:wrap;gap:0;'), 'actionsGroup'],
    ['the actions are not centred', (c) => c.replace('gap:8px;justify-content:center}\n.cd-action,', 'gap:8px}\n.cd-action,'), 'actionsGroup'],
    ['the actions shrink below 44 pt', (c) => c.replace('.cd-action,.cd-more{min-height:44px;', '.cd-action,.cd-more{min-height:40px;'), 'actions44'],
    ['an action label may wrap inside its button again (no nowrap)', (c) => c.replace('.cd-action{flex:1 1 140px;white-space:nowrap}', '.cd-action{flex:1 1 140px}'), 'actionsNoWrap'],
    ['the primary action is not the shipped primary token', (c) => c.replace('.cd-action--primary{background:var(--maroon);', '.cd-action--primary{background:var(--gold);'), 'buttonTokens'],
    ['a stacked card double-spaces (the .card+.card margin is not cancelled)', (c) => c.replace('.cd .card+.card{margin-top:0}', ''), 'stackGap'],
    ['a colour literal slips in', (c) => c.replace('.cd-mark--loss{color:var(--loss)}', '.cd-mark--loss{color:#ff0000}'), 'noColourLiterals'],
    ['an off-grid gap (6 pt)', (c) => c.replace('.cd-card{display:flex;flex-direction:column;gap:8px;', '.cd-card{display:flex;flex-direction:column;gap:6px;'), 'grid8'],
    ['an invented transition', (c) => c.replace('.cd-more{align-self:stretch}', '.cd-more{align-self:stretch;transition:all .4s}'), 'noMotionInvented'],
    ['the whole block is deleted (the reviewer\'s exact state)', (c) => c.replace(/\/\* DI-575 \/ DI-576 — the card detail[\s\S]*?(?=\/\* ═══ DEPLOYMENT 1 · LANE B — END)/, ''), 'insideBanner'],
  ];
  for (const [name, fn, key] of MUT) {
    const mutated = fn(CSS);
    assert(mutated !== CSS && pins(mutated)[key] === false, `9m: MUTATION — ${name}: the "${key}" pin goes RED`);
  }
}

// ═══ [10] ═══════════════════════════════════════════════════════════════════════
console.log('\n[10] D1 security O1 / DI-576 row 3 — the pilot-only year.ago detail, and the Open Dashboard copy…');
{
  const yaCard = find(FINAL.cards, 'year.ago');
  assert(!!yaCard && !!detail(CD, yaCard, FINAL.snap, { ...CTX, pilotHistory: true }), '10a: (control) with the pilot answer true the year.ago detail builds');
  assert(detail(CD, yaCard, FINAL.snap, { ...CTX, pilotHistory: false }) === null && detail(CD, yaCard, FINAL.snap, { ...CTX, pilotHistory: undefined }) === null && detail(CD, yaCard, FINAL.snap, { ...CTX, pilotHistory: 'true' }) === null && detail(CD, yaCard, FINAL.snap, { ...CTX, pilotHistory: 1 }) === null,
    '10b: false, absent, "true" and 1 are all NO — only the boolean true builds the pilot\'s 2025 names and scores (fail closed; card-detail.js never decides who is the pilot)');
  assert(!/pilot-only|isPilotLeague|isPilotOnlyAllowed/.test(stripComments(SRC)), '10c: card-detail.js stays PURE of the registry — it never imports or calls the pilot predicate (the app injects the answer)');
  const other = find(FINAL.cards, 'week.result', c => c.weekId === 'w2');
  assert(!!detail(CD, other, FINAL.snap, { ...CTX, pilotHistory: false }), '10d: the gate is specific to year.ago — every other card still builds when the answer is false');
  const wkRev = mk(league('live'));
  const revCard = find(wkRev.cards, 'week.revealed');
  const revModel = revCard ? detail(CD, revCard, wkRev.snap) : null;
  assert(!!revModel && revModel.actions.some(a => a.id === 'go-dashboard' && a.label === 'Open Dashboard') && !JSON.stringify(revModel.actions).includes('See the full slate'),
    '10e: DI-576 row 3 (REV 2) — the week.revealed action reads "Open Dashboard", not "See the full slate"');
  assert(/act\('go-dashboard', 'Open Dashboard'/.test(SRC) && !/act\('go-dashboard', 'See the full slate'/.test(SRC), '10f: …at its one source site');
  const mutSrc = SRC.replace("if (env.c.pilotHistory !== true) return null;", '');
  assert(mutSrc !== SRC, '10g: (fixture) the builder\'s own gate exists to be mutated');
  {
    const base = new URL('./js/', import.meta.url).href;
    const load = async (src) => import('data:text/javascript;base64,' + Buffer.from(src.replace(/(from\s+|import\s*\(\s*)'\.\/([\w./-]+)'/g, (_m, pre, f) => `${pre}'${base}${f}'`)).toString('base64') + '#' + Math.random());
    const m = await load(mutSrc);
    assert(m.buildCardDetail(yaCard, FINAL.snap, { ...CTX, pilotHistory: false }) !== null, '10h: MUTATION — with the builder\'s gate removed the other league\'s year.ago detail builds, so 10b is the only thing between it and the pilot\'s names');
    const m2 = await load(SRC.replace("pilotHistory: c.pilotHistory === true,", "pilotHistory: true,"));
    assert(m2.buildCardDetail(yaCard, FINAL.snap, { ...CTX, pilotHistory: false }) !== null, '10i: MUTATION — a normalizeCtx that ignores the injected answer opens it too: 10b goes RED');
  }
}

console.log(`\n══════════════════════════════════════════════════\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
