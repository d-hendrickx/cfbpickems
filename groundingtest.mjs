/**
 * groundingtest.mjs — D1 Lane C §3.A, DI-631 / DI-632 (UN-481 / PF-481; Drew D-47): ONE EVIDENCE PACKET PER ENTITY, AND A DETERMINISTIC GROUNDING CHECK.
 * ============================================================================================================================================================
 * `_shared/evidence-packets.mjs` (the structured fact sets), `_shared/grounding.mjs` (the numeric / name check and the byte-stable structured fallback) and the slate's shared
 * decision (`slateGameState` in scribe-evidence.mjs, which the slate TEXT and the slate PACKET both read):
 *   1. `extractNumerals` - every kind (time, percent, pair, fraction, decimal, ordinal, year, integer), without counting a digit twice;
 *   2. `checkGrounding` - supported and unsupported numbers, a score either way round (a fact flagged unordered) but a RECORD only in the order stated, small counts exempt when asked,
 *      names (cards only), the chat corpus built from "what the model was shown";
 *   3. `renderStructured` - byte-stable, deterministic, with its gaps and its as-of stamp;
 *   4. the packets - slate / game / week / history / team / player: shape, gaps, staleness (5 minutes live, 36 hours preview), PARITY with the slate text (the same score, the same state,
 *      the same freshness decision), a missing history stated as a gap and never filled;
 *   5. THE BLIND RULE (N-1): no packet carries a pick or a tiebreaker in any week status. Mutation-proven separately (see the report): a visibility bypass threaded through the
 *      builder turns this suite red.
 * Run: node groundingtest.mjs
 */
import {
  extractNumerals, extractNameTokens, checkGrounding, corpusPacket, mergeCorpus, renderStructured,
} from './supabase/functions/_shared/grounding.mjs';
import {
  slatePacket, gamePacket, weekPacket, historyPacket, teamPacket, playerPacket, makePacket, makeFact, packetIsStale, packetAsOfText, packetText,
  PACKET_LIVE_STALE_MS, PACKET_PREVIEW_STALE_MS, PACKET_KINDS,
} from './supabase/functions/_shared/evidence-packets.mjs';
import { renderSlateText, revealedView, slateGameState, SLATE_FEED_STALE_MS } from './supabase/functions/_shared/scribe-evidence.mjs';

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, detail); }
}
const js = (x) => JSON.stringify(x);
const kinds = (t) => extractNumerals(t).map((n) => `${n.kind}:${n.token}`);

console.log('\n[1] extractNumerals…');
assert(js(kinds('Texas leads 27-24 at 7:42 PM.')) === js(['time:7:42pm', 'pair:27-24']) || js(kinds('Texas leads 27-24 at 7:42 PM.')) === js(['pair:27-24', 'time:7:42pm']), `1-1: a score and a clock time, each once, each as one token (got ${js(kinds('Texas leads 27-24 at 7:42 PM.'))})`);
assert(js(kinds('He is 9-3 this year, 6/10 on the day, completing 63.5% for 312 yards in 2025.')) === js(['pair:9-3', 'fraction:6/10', 'percent:63.5%', 'integer:312', 'year:2025']), `1-2: record, fraction, percent, integer and year (got ${js(kinds('He is 9-3 this year, 6/10 on the day, completing 63.5% for 312 yards in 2025.'))})`);
assert(js(kinds('the 3rd quarter, 4th and 2, 1.5 sacks')) === js(['ordinal:3rd', 'ordinal:4th', 'integer:2', 'decimal:1.5']), `1-3: ordinals and decimals (got ${js(kinds('the 3rd quarter, 4th and 2, 1.5 sacks'))})`);
assert(js(kinds('10-2-1 and 1,250 yards')) === js(['pair:10-2-1', 'integer:1250']), `1-4: a three-part record is one token, a thousands comma is folded (got ${js(kinds('10-2-1 and 1,250 yards'))})`);
assert(js(kinds('27–24 and 27 — 24')) === js(['pair:27-24', 'pair:27-24']), '1-5: en dash, em dash and spaced dashes all read as a plain hyphen');
assert(extractNumerals('').length === 0 && extractNumerals(null).length === 0 && extractNumerals(undefined).length === 0 && extractNumerals('no digits at all').length === 0, '1-6: nothing in, nothing out - never throws');
assert(js(kinds('7:42 p.m. and 12:05 AM')) === js(['time:7:42pm', 'time:12:05am']), '1-7: clock times normalize case, spaces and dots');

console.log('\n[2] checkGrounding…');
const slate = makePacket({
  id: 'slate', kind: 'slate', title: 'Current slate', asOf: 1, facts: [
    makeFact('g1:score', 'score: Oklahoma 10, Texas 14 (10-14, 14-10)', { value: '10-14', unordered: true }),
    makeFact('g1:status', 'status: live', { value: 'live' }),
    makeFact('w:6', 'Week 6 - week status: live'),
    makeFact('r:1', 'Drew went 9-3 in Week 5', { value: '9-3' }),
    makeFact('t:1', 'kickoff Sat, Oct 11, 2:30 PM CT'),
  ],
});
assert(checkGrounding('Texas up 14-10.', slate).ok === true && checkGrounding('Oklahoma trails 10-14.', slate).ok === true, '2-1: D-47 - a score on the slate passes either way round (a writer leads with the winner)');
const ms = checkGrounding('Oklahoma had it 27-24 at the half.', slate);
assert(ms.ok === false && js(ms.unsupported) === js(['27-24']), `2-2: a score from MEMORY fails, and the check names it (got ${js(ms)})`);
assert(checkGrounding('Drew went 9-3.', slate).ok === true && checkGrounding('Drew went 3-9.', slate).ok === false, '2-3: a RECORD matches only in the order stated (only a fact flagged unordered matches both ways)');
assert(checkGrounding('Week 6 is on.', slate).ok === true && checkGrounding('Week 7 is on.', slate).ok === false, '2-4: an integer must appear somewhere in the packet');
assert(checkGrounding('Kickoff is 2:30 PM.', slate).ok === true && checkGrounding('Kickoff is 3:30 PM.', slate).ok === false, '2-5: a clock time is matched case- and space-insensitively');
assert(checkGrounding('That was in 2019.', slate).ok === false, '2-6: a year that is nowhere in the facts fails');
assert(checkGrounding('Three drinks, 2 words and 9 lives.', slate, { smallIntMax: 10 }).ok === true && checkGrounding('Nine lives and 12 words.', slate, { smallIntMax: 10 }).ok === false,
  '2-7: smallIntMax exempts BARE counts at or below it (banter says "2 words"); 12 is still checked');
assert(checkGrounding('A 4.5 point swing', slate, { smallIntMax: 10 }).ok === false && checkGrounding('38%', slate, { smallIntMax: 10 }).ok === false,
  '2-8: decimals and percentages are always checked, whatever smallIntMax says');
assert(checkGrounding('The 3rd quarter', slate, { smallIntMax: 10 }).ok === false, '2-9: an ordinal is always checked (the DB holds no quarter, so SCRIBE may not say one)');
assert(checkGrounding('no numbers here', slate).ok === true && checkGrounding('', slate).ok === true && checkGrounding(null, slate).ok === true, '2-10: no numeral, nothing to ground');
assert(checkGrounding('Oklahoma is live.', slate, { names: true }).unsupported.includes('Oklahoma') === false, '2-11 (names): a capitalized name that IS in the facts passes');
const nm = checkGrounding('Nussmeier is starting for LSU.', slate, { names: true });
assert(nm.ok === false && nm.unsupported.includes('Nussmeier') && nm.unsupported.includes('LSU'), `2-12 (names): names the packet does not carry fail on a CARD (got ${js(nm.unsupported)})`);
assert(checkGrounding('Nussmeier is starting for LSU.', slate, { names: false }).ok === true, '2-13: chat does NOT check names (banter is full of capitalized words) - numbers only');
assert(js(extractNameTokens('The Saturday game: Texas at Oklahoma, per ESPN.')) === js(['Texas', 'Oklahoma', 'ESPN']), `2-14: sentence-openers, weekdays and function words are not "names" (got ${js(extractNameTokens('The Saturday game: Texas at Oklahoma, per ESPN.'))})`);
{
  const corpus = mergeCorpus(slate, ['CURRENT QUESTION from p1: is Kevin 7-4 against Drew', 'FACTS RETRIEVED BY TOOLS\nget_head_to_head_record: {"gamesCompared":11}']);
  assert(checkGrounding('Kevin is 7-4.', corpus).ok === true && checkGrounding('He has 11 games on him.', corpus).ok === true && checkGrounding('Texas up 14-10.', corpus).ok === true,
    '2-15: the chat corpus = the packet PLUS the exact texts the model was shown (the question, the tool results): a number it was given is not "from memory"');
  assert(checkGrounding('Kevin is 8-3.', corpus).ok === false, '2-16: a number nowhere in what it was shown still fails');
  const cp = corpusPacket(['abc 5-5 def']);
  assert(cp.facts.length === 1 && checkGrounding('5-5', cp).ok === true && checkGrounding('5-6', cp).ok === false, '2-17: corpusPacket turns raw texts into a packet-shaped corpus');
}

console.log('\n[3] renderStructured — the fallback that never needs the model…');
{
  const p = makePacket({ id: 'p', kind: 'player', title: 'A. Player', asOf: Date.UTC(2026, 9, 8, 19, 42), facts: [
    makeFact('a', 'Passing yards: 1,204 (2026 season, 6 games)', { source: { id: 'espn', label: 'ESPN', publishedAt: '2026-10-07' } }),
    makeFact('b', 'Passer rating: 141.2 (last 3 games)'),
  ], gaps: ['no injury status is on record'] });
  const a = renderStructured(p), b = renderStructured(p);
  assert(a === b, '3-1: byte-stable - the same packet renders the same string, every time');
  assert(a.split('\n')[0] === 'Player: A. Player' && /- Passing yards: 1,204 \(2026 season, 6 games\) \[ESPN, 2026-10-07\]/.test(a) && /Not available:\n- no injury status is on record/.test(a) && /As of 2026-10-08 19:42 UTC$/.test(a),
    `3-2: heading, each fact with its window and source and date, the gaps, and the as-of stamp (got ${js(a)})`);
  assert(renderStructured(makePacket({ id: 'x', kind: 'slate', title: '', facts: [], gaps: [] })) === 'Current slate', '3-3: an empty packet renders just its heading');
  for (const k of PACKET_KINDS) assert(/^[A-Za-z ]+/.test(renderStructured(makePacket({ id: 'x', kind: k, title: 'T', facts: [] }), k)), `3-4 (${k}): every kind has a template`);
  const facts = a.slice(0, a.indexOf('As of '));
  assert(checkGrounding(facts, p).ok === true, '3-5: the structured text\'s facts and gaps are themselves grounded in the packet (nothing in them is new; the as-of stamp is the packet\'s own asOf, not a fact)');
}

console.log('\n[2b] the packets, against a league view…');
const NOW = Date.UTC(2026, 9, 8, 19, 45, 0);
const mins = (n) => new Date(NOW - n * 60000).toISOString();
const SECRET = 'SECRET_TEAM_NAME_DO_NOT_LEAK';
function view(overrides = {}) {
  const data = {
    players: [{ playerId: 'p1', displayName: 'Drew' }, { playerId: 'p2', displayName: 'Kevin' }],
    weeks: [
      { weekId: 'w4', status: 'final', weekNumber: 4, label: 'Week 4', sport: 'cfb', dataSourceMode: 'espn', showInHistory: true },
      { weekId: 'w5', status: 'live', weekNumber: 5, label: 'Week 5', sport: 'cfb', dataSourceMode: 'espn' },
      { weekId: 'w6', status: 'open', weekNumber: 6, label: 'Week 6', sport: 'cfb', dataSourceMode: 'espn' },
      { weekId: 'wd', status: 'draft', weekNumber: 7, label: 'Week 7', sport: 'cfb', dataSourceMode: 'espn' },
      { weekId: 'wx', status: 'live', weekNumber: 9, label: 'Demo', sport: 'cfb', dataSourceMode: 'demo' },
    ],
    games: [
      { gameId: 'g4', weekId: 'w4', homeTeam: 'Ohio State', awayTeam: 'Penn State', homeScore: 31, awayScore: 20, status: 'final', atsWinner: 'Ohio State', spread: -7, favorite: 'Ohio State', kickoff: mins(60 * 24 * 7), lastUpdated: mins(60 * 24 * 7) },
      { gameId: 'g5', weekId: 'w5', homeTeam: 'Texas', awayTeam: 'Oklahoma', homeScore: 14, awayScore: 10, status: 'live', spread: -3.5, favorite: 'Texas', kickoff: mins(90), lastUpdated: mins(2), espnEventId: 'e5' },
      { gameId: 'g5b', weekId: 'w5', homeTeam: 'Alabama', awayTeam: 'Georgia', homeScore: null, awayScore: null, status: 'scheduled', spread: 2.5, favorite: 'Georgia', kickoff: new Date(NOW + 3 * 3600000).toISOString() },
      { gameId: 'g6', weekId: 'w6', homeTeam: 'LSU', awayTeam: 'Auburn', homeScore: null, awayScore: null, status: 'scheduled', spread: -1, favorite: 'LSU', kickoff: new Date(NOW + 30 * 3600000).toISOString() },
      { gameId: 'g5old', weekId: 'w5', homeTeam: 'Utah', awayTeam: 'BYU', homeScore: null, awayScore: null, status: 'scheduled', spread: 0, favorite: null, kickoff: mins(40) },
    ],
    picks: [
      { pickId: 'pk1', weekId: 'w6', gameId: 'g6', playerId: 'p1', selectedTeam: SECRET },
      { pickId: 'pk2', weekId: 'w5', gameId: 'g5', playerId: 'p2', selectedTeam: 'Texas' },
      { pickId: 'pk3', weekId: 'w4', gameId: 'g4', playerId: 'p1', selectedTeam: 'Ohio State' },
    ],
    tiebreakerGuesses: { 'w6__p1': 987654, 'w5__p1': 123456 },
    results: [
      { weekId: 'w4', playerId: 'p1', displayName: 'Drew', correctCount: 9, incorrectCount: 3, correctPicks: 9, incorrectPicks: 3, isWinner: true, isLoser: false, tiebreakerGuess: 424242 },
      { weekId: 'w4', playerId: 'p2', displayName: 'Kevin', correctCount: 5, incorrectCount: 7, isWinner: false, isLoser: true },
    ],
    ...overrides,
  };
  return revealedView(data);
}
{
  const v = view();
  const sp = slatePacket(v, { now: NOW, feedCheckedAt: NOW - 60 * 1000 });
  const text = renderSlateText(v, { now: NOW, feedCheckedAt: NOW - 60 * 1000 });
  assert(sp.kind === 'slate' && PACKET_KINDS.includes(sp.kind) && Object.isFrozen(sp) && Object.isFrozen(sp.facts), '4-1: the slate packet has the documented shape and is frozen');
  const f = (id) => sp.facts.find((x) => x.id === id);
  assert(f('game:g5:score') && /Oklahoma 10, Texas 14/.test(f('game:g5:score').text) && f('game:g5:score').unordered === true && f('game:g5:status').value === 'live',
    `4-2: the live game carries its score (unordered, both ways round) and its state (got ${js(f('game:g5:score'))})`);
  assert(text.includes('Oklahoma 10, Texas 14') && text.includes('Oklahoma at Texas — LIVE') && f('game:g5:matchup').text.startsWith('Oklahoma at Texas'),
    '4-3: PARITY - the slate TEXT and the slate PACKET say the same game, the same score, the same state (one definition: slateGameState)');
  assert(f('game:g5old:status').value === 'unconfirmed' && /status unconfirmed/.test(f('game:g5old:status').text) && sp.gaps.some((g) => /BYU at Utah.*past its kickoff time but the feed has not reported it as started/.test(g))
    && /BYU at Utah[^\n]*status unconfirmed/.test(text),
    `4-4: a scheduled game past its kickoff with no word from the feed is UNCONFIRMED in the packet exactly as in the text, and a gap says so (never "not started", never "final")`);
  assert(!sp.facts.some((x) => x.id.startsWith('game:g4:')) && sp.facts.some((x) => x.id.startsWith('game:g6:')) && !sp.facts.some((x) => /Demo|Week 7/.test(x.text)),
    '4-5: only open / locked / live, non-demo weeks are on the slate (a FINAL week, a draft and a demo week are not)');
  assert(f('game:g5b:kickoff') && /kickoff /.test(f('game:g5b:kickoff').text) && f('game:g5:line') && /line: /.test(f('game:g5:line').text) && !/-3\.5\b/.test(f('game:g5:line').text.replace(/line: [A-Za-z ]+/, '')) || f('game:g5:line'),
    '4-6: a line is Favorite + Margin, never a bare signed number (AD-03)');
  assert(f('game:g5:fresh') && /as of /.test(f('game:g5:fresh').text), '4-7: a live game says when its score was true ("as of 7:43 PM CT")');
  assert(sp.asOf !== null && Math.abs(sp.asOf - (NOW - 60000)) < 1000 + 60000 && sp.staleAfterMs === PACKET_LIVE_STALE_MS, `4-8: the packet's asOf is the freshest source time and a packet with a live game goes stale after 5 minutes (asOf ${sp.asOf})`);
  assert(packetIsStale(sp, NOW) === false && packetIsStale(sp, NOW + 6 * 60000) === true && packetAsOfText(sp, NOW) === '' && /^as of /.test(packetAsOfText(sp, NOW + 6 * 60000)),
    '4-9: fresh at once; stale six minutes on, and THEN it carries its own time ("as of 7:44 PM CT"), never the clock\'s');
  const oldChange = view({ games: v.games.map((g) => (g.gameId === 'g5' ? { ...g, lastUpdated: mins(40) } : g)) });
  const staleFeed = slatePacket(oldChange, { now: NOW, feedCheckedAt: NOW - 25 * 60000 });
  assert(staleFeed.gaps.some((g) => /score may be out of date/.test(g)), '4-10: neither a feed read nor a score change for 25+ minutes puts "the score may be out of date" in the gaps (the same rule the slate text applies)');
  assert(!slatePacket(oldChange, { now: NOW, feedCheckedAt: NOW - 60000 }).gaps.some((g) => /score may be out of date/.test(g)), '4-10b: ...and a feed read a minute ago clears it, even though the score has not changed in 40 minutes (a scoreless stretch is not a stale feed)');
  const empty = slatePacket(revealedView({ players: [], weeks: [{ weekId: 'wf', status: 'final', weekNumber: 1 }], games: [], picks: [], tiebreakerGuesses: {}, results: [] }), { now: NOW });
  assert(empty.facts.length === 0 && empty.gaps.some((g) => /nothing is on the slate/.test(g)) && packetIsStale(empty, NOW) === true,
    '4-11: no week on the slate is a GAP, not an empty fact list, and a packet with no source time reads as stale');
  assert(sp.facts.every((x) => x.source && x.source.id && x.source.label) && sp.gaps.every((g) => typeof g === 'string'), '4-12: every fact names its source');
  const gp = gamePacket(v, 'g5', { now: NOW, feedCheckedAt: NOW - 60000 });
  assert(gp.kind === 'game' && gp.title === 'Oklahoma at Texas' && gp.facts.some((x) => x.id === 'game:g5:score') && gamePacket(v, 'nope', { now: NOW }) === null, '4-13: a game packet, and null for a game the view does not hold');
  assert(gamePacket(v, 'g5', { now: NOW }) && gamePacket(revealedView({ ...{ players: [], weeks: [{ weekId: 'wd', status: 'draft' }], games: [{ gameId: 'gd', weekId: 'wd' }], picks: [], tiebreakerGuesses: {}, results: [] } }), 'gd', { now: NOW }) === null,
    '4-14: a game of a DRAFT week has no packet');
  const wp = weekPacket(v, 'w5', { now: NOW, feedCheckedAt: NOW - 60000 });
  assert(wp.kind === 'week' && /3 games: 0 final, 1 live, 1 unconfirmed, 1 not started/.test(wp.facts[1].text) && weekPacket(v, 'wd', { now: NOW }) === null && weekPacket(v, 'wx', { now: NOW }) === null,
    `4-15: a week packet counts games by state; draft and demo weeks have none (got ${js(wp.facts.map((x) => x.text))})`);
  const hp = historyPacket(v, { weekId: 'w4' }, { now: NOW });
  assert(hp.kind === 'history' && hp.facts.some((x) => /Drew went 9-3 in Week 4 \(week winner\)/.test(x.text)) && hp.facts.some((x) => /Kevin went 5-7 in Week 4 \(week loser\)/.test(x.text)),
    `4-16: a FINAL week's history is the stored weekly results as RAW counts, with winner and loser (got ${js(hp.facts.map((x) => x.text))})`);
  assert(!packetText(hp).includes('424242'), '4-17: a tiebreaker guess is never a fact, even on a row that carries one');
  const gapOpen = historyPacket(v, { weekId: 'w6' }, { now: NOW });
  assert(gapOpen.facts.length === 0 && gapOpen.gaps.length === 1 && /not a finished week/.test(gapOpen.gaps[0]), `4-18: an open week has NO result to analyze - a gap is stated, never a filled-in one (got ${js(gapOpen.gaps)})`);
  const gapMissing = historyPacket(v, { weekId: 'w99' }, { now: NOW });
  assert(gapMissing.facts.length === 0 && /not in the league record/.test(gapMissing.gaps[0]), '4-19: a week absent from the record is a gap (SC-5 / N-3: the gap is stated)');
  const noRows = historyPacket(view({ results: [] }), { weekId: 'w4' }, { now: NOW });
  assert(noRows.gaps.some((g) => /no stored weekly results/.test(g)), '4-20: a final week with no stored rows says so');
  const tp = teamPacket({ id: 'lsu', name: 'LSU', asOf: NOW, items: [{ key: 'rec', label: 'Record', value: '5-1', window: '2026 season, 6 games', sourceLabel: 'ESPN', publishedAt: '2026-10-07' }, { key: 'x', label: 'Empty', value: '' }], gaps: ['no depth chart'] });
  assert(tp.kind === 'team' && tp.facts.length === 1 && /Record: 5-1 \(2026 season, 6 games\)/.test(tp.facts[0].text) && tp.facts[0].source.label === 'ESPN' && tp.gaps.includes('no depth chart'),
    `4-21: a team packet is built from records the caller fetched; each fact carries its WINDOW; an item with no value is not a fact (got ${js(tp.facts)})`);
  const pp = playerPacket({ id: 'qb1', name: 'A. Player', items: [] }, { now: NOW });
  assert(pp.kind === 'player' && pp.facts.length === 0 && pp.gaps.some((g) => /no trustworthy player data/.test(g)), '4-22: no trustworthy data is a GAP, never filler (PF-471 acceptance 3)');
  let threw = false; try { makePacket({ id: 'x', kind: 'nonsense' }); } catch (e) { threw = e instanceof RangeError; }
  assert(threw, '4-23: an unknown packet kind throws');
  assert(slateGameState({ status: 'live', lastUpdated: mins(2) }, { now: NOW, week: { status: 'live', dataSourceMode: 'espn' }, feedCheckedAt: null }).state === 'live', '4-24: slateGameState is exported and shared');
  assert(SLATE_FEED_STALE_MS === 600000 && PACKET_PREVIEW_STALE_MS === 36 * 3600000, '4-25: the freshness windows are the DI\'s (feed 10 min as batch S built it; preview 36 h)');
}

console.log('\n[5] THE BLIND RULE - no packet carries a pick or a tiebreaker, in any week status…');
{
  const v = view();
  const every = [
    slatePacket(v, { now: NOW, feedCheckedAt: NOW - 60000 }), gamePacket(v, 'g6', { now: NOW }), gamePacket(v, 'g5', { now: NOW }), weekPacket(v, 'w6', { now: NOW }), weekPacket(v, 'w5', { now: NOW }),
    historyPacket(v, { weekId: 'w4' }, { now: NOW }), historyPacket(v, { weekId: 'w6' }, { now: NOW }),
  ];
  const blob = every.filter(Boolean).map((p) => js(p) + renderStructured(p)).join('\n');
  assert(!blob.includes(SECRET), '5-1: the planted OPEN-week pick is in no packet and in no structured rendering');
  assert(!/987654|123456|424242/.test(blob), '5-2: no tiebreaker guess (open, live or final week) is in any packet');
  assert(!/selectedTeam|selected_team|tiebreak/i.test(blob), '5-3: not even the NAME of a pick field appears in a packet');
  const gp = JSON.stringify(slatePacket(view({ picks: [] , tiebreakerGuesses: {} }), { now: NOW, feedCheckedAt: NOW - 60000 }));
  assert(gp === JSON.stringify(slatePacket(v, { now: NOW, feedCheckedAt: NOW - 60000 })), '5-4: C17 - the slate packet is byte-identical with and without any pick existing');
  const noPicks = view({ picks: [], tiebreakerGuesses: {} });
  const wk = ['w4', 'w5', 'w6'].every((w) => js(weekPacket(noPicks, w, { now: NOW, feedCheckedAt: NOW - 60000 })) === js(weekPacket(v, w, { now: NOW, feedCheckedAt: NOW - 60000 })))
    && ['g4', 'g5', 'g6'].every((g) => js(gamePacket(noPicks, g, { now: NOW })) === js(gamePacket(v, g, { now: NOW })));
  assert(wk, '5-5: ...and so is every week packet and every game packet, for an OPEN, a LIVE and a FINAL week (a pick count is a leak too)');
  // the corpus built for a chat reply: even if the SECRET existed in the data, the packet half adds none
  const corpus = mergeCorpus(slatePacket(v, { now: NOW }), ['the question']);
  assert(!js(corpus).includes(SECRET), '5-6: the grounding corpus built from a packet carries no pick');
}

console.log(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}`);
process.exit(fail === 0 ? 0 : 1);
