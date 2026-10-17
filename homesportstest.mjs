/**
 * CFB Pickems — homesportstest.mjs (D1 / v0.30.0, DI-528: the Home feed combines every sport and names each card's sport)
 * ====================================================================================================================
 * The proof for js/home-sports.js (the per-sport slices and the merge), for the three small edits in js/home.js (the snapshot carries the sports the feed spans; "N of M in" counts a week's
 * own sport's ENTRANTS; a card names its sport) and for the sport naming in js/feed-cards.js cardCopy(). Security C2 (the reveal gate is per week), C4 (entrants, never the active roster)
 * and C5 (every string a card prints is escaped) are each proven by the sequence that breaks them.
 *
 * Run:  node homesportstest.mjs
 *
 *   [1]  THE SINGLE-SPORT RULE - no contexts: derive is called ONCE, with the very snapshot and options it was given, and the cards are returned untouched; a golden through the real pipeline.
 *   [2]  NOTHING MERGES - the combined feed is exactly the CFB-only feed plus the NFL-only feed (entrants as the players), each card tagged, no card in the wrong sport's week.
 *   [3]  C4 - ranks, streaks, records and "N of M in" are among a sport's ENTRANTS; a stray pick row by a non-entrant counts for nothing and names nobody.
 *   [4]  THE BLIND RULE per sport - an open NFL week beside a final/live CFB week reveals no NFL pick (and the reverse); the slices carry no other sport's pick or player; positive controls.
 *   [5]  year-ago is a CFB dataset; chat cards appear once and carry no sport; malformed / duplicate contexts; the withheld gate; determinism and order.
 *   [6]  cardHTML - the chip and the sport on the article (multi-sport only), double-quoted, hostile text inert; a one-sport card's markup is v0.29.0's byte for byte.
 *   [7]  cardCopy - weeks, ranks and records NAME their sport; without a sport code every string is v0.29.0's.
 *   [8]  static scans (incl. [8k]/[8l], 2026-10-08: the one derive path shared by the paint and the card detail).
 *   [9]  MUTATION PROOFS on in-memory copies (never a file on disk): each mutant must turn a NAMED check RED.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const lsStore = new Map();
globalThis.localStorage = {
  getItem: k => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: k => lsStore.delete(k),
  clear: () => lsStore.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null,
  querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in homesportstest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const fc = await import('./js/feed-cards.js');
const hs = await import('./js/home-sports.js');
const home = await import('./js/home.js');
const { calculateWeeklyResults } = await import('./js/scoring.js');
const fx = await import('./statsfixtures.mjs');

const NOW = Date.parse('2026-09-13T12:00:00.000Z');
const CFB_ID = '11111111-1111-4111-8111-111111111111';
const NFL_ID = '22222222-2222-4222-8222-222222222222';
const ALL6 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const NFL_ENTRANTS = ['p3', 'p4', 'p6'];                       // p1 (the viewer), p2 and p5 have NOT joined the NFL
const LEAGUE_ID = 'L1';

// ── the fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The same league re-keyed as another sport's: new week and game ids, only the entrants' picks and players, results recomputed from those picks. */
function nflOf(league, entrants, { stray = false } = {}) {
  const rid = (id) => `n_${id}`;
  const weeks = league.weeks.map((w) => ({ ...w, weekId: rid(w.weekId), competitionId: NFL_ID }));
  const games = league.games.map((g) => ({ ...g, gameId: rid(g.gameId), weekId: rid(g.weekId) }));
  let picks = league.picks.filter((p) => entrants.includes(p.playerId)).map((p) => ({ ...p, pickId: rid(p.pickId), weekId: rid(p.weekId), gameId: rid(p.gameId) }));
  if (stray) {
    // A pick ROW by a non-entrant (p1), as a stale or forged row would be: the roster, not the row, decides who is in the sport.
    const g = games.find((x) => x.weekId === rid('w2'));
    picks = [...picks, { pickId: `${rid('pk')}_stray`, weekId: g.weekId, gameId: g.gameId, playerId: 'p1', selectedTeam: g.homeTeam }];
  }
  const players = league.players.filter((p) => entrants.includes(p.playerId)).map((p) => ({ ...p }));
  const weeklyResults = weeks.filter((w) => w.status === 'final').flatMap((w) => calculateWeeklyResults(w.weekId, players, picks.filter((p) => p.weekId === w.weekId && entrants.includes(p.playerId)), games.filter((g) => g.weekId === w.weekId)));
  return { players, weeks, games, picks, weeklyResults };
}
const withCompetition = (league, competitionId) => ({ ...league, weeks: league.weeks.map((w) => ({ ...w, competitionId })) });

const CHAT = {
  scribe: [{ id: 'm_s1', ts: 1757000000000, author: 'scribe', authorName: 'SCRIBE', body: 'A quiet week. Somebody has to be quiet.', reactionCount: 0, leagueId: LEAGUE_ID, meta: { kind: null, test: false } }],
  lockerRoom: [{ id: 'm_l1', ts: 1757000000000, author: 'p3', authorName: 'Kevin', body: 'mid take', reactionCount: 3, leagueId: LEAGUE_ID, meta: { kind: null, test: false } }],
};

// The home.js under test (the real module, or a mutant copy: checks() points this at the module it was handed).
let HM = home;
/** home.js's own assembleHomeSnapshot over an in-memory league, with the sports the feed spans handed in (or null: a one-sport league). */
function assemble({ cfb, nfl = null, contexts, rosterOf = null, chat = CHAT, pickConfirmed = () => true, picksExtra = [], supabase = false }) {
  const weeks = [...cfb.weeks, ...(nfl ? nfl.weeks : [])];
  const games = [...cfb.games, ...(nfl ? nfl.games : [])];
  const picks = [...cfb.picks, ...(nfl ? nfl.picks : []), ...picksExtra];
  const weeklyResults = [...cfb.weeklyResults, ...(nfl ? nfl.weeklyResults : [])];
  const nflWeekIds = new Set(nfl ? nfl.weeks.map((w) => w.weekId) : []);
  const rosterForWeek = rosterOf || ((w) => (nflWeekIds.has(w.weekId) ? cfb.players.filter((p) => NFL_ENTRANTS.includes(p.playerId)) : cfb.players));
  const curId = (league) => (league.weeks[league.weeks.length - 1] || {}).weekId || null;
  const readers = {
    weeks: () => weeks, games: () => games, picks: () => picks, players: () => cfb.players, weeklyResults: () => weeklyResults,
    weekProgress: () => null, currentWeek: () => weeks.find((w) => w.weekId === curId(cfb)) || null, activeWeekId: () => curId(cfb),
    viewer: () => ({ playerId: 'p1', isAdmin: false }), timezone: () => 'PT', leagueId: () => LEAGUE_ID, isSupabase: () => supabase,
    contexts: () => contexts, rosterForWeek,
  };
  return HM.assembleHomeSnapshot({
    read: readers, confirmedStatusFor: (w) => w.status, picksReadConfirmed: pickConfirmed,
    chatCandidates: () => chat, groupTieContexts: null,
  }, { viewerId: 'p1', isCommissioner: false, now: NOW });
}
const ctxCfb = (cfb) => ({ competitionId: CFB_ID, dbCode: 'cfb', code: 'CFB', weekIds: cfb.weeks.map((w) => w.weekId), playerIds: ALL6, currentWeekId: cfb.weeks[cfb.weeks.length - 1].weekId });
const ctxNfl = (nfl, entrants = NFL_ENTRANTS) => ({ competitionId: NFL_ID, dbCode: 'nfl', code: 'NFL', weekIds: nfl.weeks.map((w) => w.weekId), playerIds: entrants, currentWeekId: nfl.weeks[nfl.weeks.length - 1].weekId });
const derive = (snap, opts = {}) => fc.deriveCards(snap, { viewerId: 'p1', now: NOW, ...opts });
const feed = (mod, snap, opts = {}) => mod.deriveFeedCards(fc.deriveCards, snap, { viewerId: 'p1', now: NOW, ...opts });
const untag = (c) => { const { sport, sportCode, competitionId, ...rest } = c; return rest; };
const j = (x) => JSON.stringify(x);

// the two leagues in each state
const cfbFinal = withCompetition(fx.buildLeague({ w2: 'final', calculateWeeklyResults }), CFB_ID);
const cfbLive = withCompetition(fx.buildLeague({ w2: 'live', calculateWeeklyResults }), CFB_ID);
const cfbOpen = withCompetition(fx.buildLeague({ w2: 'open', calculateWeeklyResults }), CFB_ID);
const nflFinal = nflOf(fx.buildLeague({ w2: 'final', calculateWeeklyResults }), NFL_ENTRANTS);
const nflOpen = nflOf(fx.buildLeague({ w2: 'open', calculateWeeklyResults }), NFL_ENTRANTS);
const nflLive = nflOf(fx.buildLeague({ w2: 'live', calculateWeeklyResults }), NFL_ENTRANTS);

/** Every named check, as a function of the module under test (the real one, or a mutant). Returns { name: boolean }. */
async function checks(M, H = home) {
  HM = H;
  const out = {};
  const ck = (name, v) => { out[name] = v === true; };

  // ── [1] THE SINGLE-SPORT RULE ──
  {
    const snap = assemble({ cfb: cfbFinal, contexts: null });
    ck('1a contexts is null in a one-sport league', snap.contexts === null);
    let calls = 0, seenSnap = null, seenOpts = null;
    const spy = (s, o) => { calls++; seenSnap = s; seenOpts = o; return [{ id: 'x', sortKey: '2026', type: 'week.result' }]; };
    const opts = { viewerId: 'p1', now: NOW };
    const r = M.deriveFeedCards(spy, snap, opts);
    ck('1b no contexts: derive is called ONCE with the very same snapshot and options', calls === 1 && seenSnap === snap && seenOpts === opts);
    ck('1c ...and its cards come back untouched (same objects, no tag)', r.length === 1 && r[0].id === 'x' && !('sportCode' in r[0]) && !('competitionId' in r[0]));
    ck('1d golden: through the real pipeline the one-sport feed is EXACTLY deriveCards()', j(feed(M, snap)) === j(derive(snap)));
    ck('1e ...and an empty contexts list is NOT a one-sport league (it is a league with no sport slice: chat only)', feed(M, assemble({ cfb: cfbFinal, contexts: [] })).every((c) => c.sport === null));
  }

  // ── [2] NOTHING MERGES ──
  {
    const both = assemble({ cfb: cfbFinal, nfl: nflFinal, contexts: [ctxCfb(cfbFinal), ctxNfl(nflFinal)] });
    const cards = feed(M, both);
    const cfbCards = cards.filter((c) => c.sport === 'cfb');
    const nflCards = cards.filter((c) => c.sport === 'nfl');
    const chatCards = cards.filter((c) => c.sport === null);
    const cfbWeeks = new Set(cfbFinal.weeks.map((w) => w.weekId));
    const nflWeeks = new Set(nflFinal.weeks.map((w) => w.weekId));
    ck('2a every card is CFB, NFL or a chat card', cfbCards.length + nflCards.length + chatCards.length === cards.length && cfbCards.length > 0 && nflCards.length > 0 && chatCards.length > 0);
    ck('2b a CFB card sits in a CFB week and an NFL card in an NFL week - never across', cfbCards.every((c) => c.weekId === null || cfbWeeks.has(c.weekId)) && nflCards.every((c) => c.weekId !== null && nflWeeks.has(c.weekId)));
    ck('2c every sport card carries its code and competition (the chip and the tap handler read them)', cfbCards.every((c) => c.sportCode === 'CFB' && c.competitionId === CFB_ID) && nflCards.every((c) => c.sportCode === 'NFL' && c.competitionId === NFL_ID));
    // The strong form: the CFB cards in the combined feed ARE the cards a CFB-only league would show, and the NFL cards ARE an NFL-only league's (entrants as its players).
    const cfbOnly = derive(assemble({ cfb: cfbFinal, contexts: null }), {}).filter((c) => c.weekId !== null);
    const nflOnly = derive(assemble({ cfb: nflFinal, contexts: null }), {}).filter((c) => c.weekId !== null && c.type !== 'year.ago');
    const norm = (list) => list.map(untag).map((c) => ({ ...c, sport: undefined })).sort((a, b) => (a.id < b.id ? -1 : 1));
    ck('2d the CFB cards in the combined feed are EXACTLY what the CFB-only league produces (nothing from the NFL reached them)', j(norm(cfbCards.filter((c) => c.weekId !== null))) === j(norm(cfbOnly)));
    ck('2e the NFL cards are EXACTLY what the NFL-only league (its entrants) produces, year-ago aside', j(norm(nflCards)) === j(norm(nflOnly.map((c) => ({ ...c, id: c.id })))));
    ck('2f the NFL feed is not empty (the comparison above is not vacuous)', nflOnly.length > 5 && cfbOnly.length > 5);
    // The control that shows the rule is DOING something: derive over the unsplit snapshot (what a one-sport pipeline would do) mixes the sports' weeks into one season.
    const blended = derive(both);
    ck('2g CONTROL: deriving over the UNSPLIT league yields different cards (a blend), so 2d/2e are not tautologies', j(norm(blended.filter((c) => c.weekId !== null))) !== j(norm([...cfbCards, ...nflCards].filter((c) => c.weekId !== null))));
    ck('2h a week number quoted by two sports is two cards: CFB Week 2 and NFL Week 2 each appear, with their own ids', ['w2', 'n_w2'].every((id) => cards.filter((c) => c.type === 'week.result' && c.weekId === id).length === 1) && new Set(cards.map((c) => c.id)).size === cards.length);
  }

  // ── [3] C4: ENTRANTS ──
  {
    const both = assemble({ cfb: cfbFinal, nfl: nflFinal, contexts: [ctxCfb(cfbFinal), ctxNfl(nflFinal)] });
    const cards = feed(M, both);
    const nflRanks = cards.filter((c) => c.sport === 'nfl' && c.type === 'rank.changed');
    const cfbRanks = cards.filter((c) => c.sport === 'cfb' && c.type === 'rank.changed');
    if (process.env.HS_DEBUG) console.log('RANK', j(cards.filter((c) => c.type === 'rank.changed').map((c) => [c.sport, c.weekId, c.memberId, c.facts.fromRank, c.facts.toRank, c.facts.rankedCount])));
    ck('3a NFL rank cards rank among the THREE entrants, CFB among all six', nflRanks.length > 0 && nflRanks.every((c) => c.facts.rankedCount === 3) && cfbRanks.length > 0 && cfbRanks.every((c) => c.facts.rankedCount === 6));
    // W-92: a combined card names its people in `members`, and a game card names its upset callers / lone winner in `standout` — both are checked, not just memberId
    ck('3b no NFL card names a member who is not in the NFL (memberId, a combined card\'s members, a game card\'s standout names)', cards.filter((c) => c.sport === 'nfl').every((c) => (c.memberId === null || NFL_ENTRANTS.includes(c.memberId)) && (Array.isArray(c.facts.members) ? c.facts.members : []).every((m) => NFL_ENTRANTS.includes(m.playerId)) && (!c.facts.standout || c.facts.standout.names.every((n) => NFL_ENTRANTS.includes(n.playerId)))) && cards.some((c) => c.sport === 'nfl' && Array.isArray(c.facts.members) && c.facts.members.length > 0));
    ck('3c ...in chips either', cards.filter((c) => c.sport === 'nfl' && c.type === 'game.final').every((c) => c.facts.chips.every((ch) => NFL_ENTRANTS.includes(ch.playerId))));
    // adversarial: a stray pick ROW by the viewer (a non-entrant) in an NFL game
    const strayLeague = nflOf(fx.buildLeague({ w2: 'final', calculateWeeklyResults }), NFL_ENTRANTS, { stray: true });
    const stray = assemble({ cfb: cfbFinal, nfl: strayLeague, contexts: [ctxCfb(cfbFinal), ctxNfl(strayLeague)] });
    const sc = feed(M, stray);
    ck('3d a stray pick row by a non-entrant names nobody and moves nothing: the NFL cards are identical to the run without it', j(sc.filter((c) => c.sport === 'nfl')) === j(cards.filter((c) => c.sport === 'nfl')));
    // the other half of A3: a non-entrant's pick ROW is not "somebody else also picked that side" either. A stray pick agreeing with the NFL's lone wolf must not un-alone him.
    // W-92 (DI-W92-2): the lone wolf is named on his GAME's card (`standout`, kind alone / both) — the stood.alone card is retired.
    const isWolf = (c) => c.sport === 'nfl' && c.type === 'game.final' && c.facts.standout && (c.facts.standout.kind === 'alone' || c.facts.standout.kind === 'both');
    const wolves = cards.filter(isWolf);
    ck('3j fixture: the NFL feed has a game card naming a lone wolf to attack', wolves.length > 0);
    if (wolves.length) {
      const w0 = wolves[0];
      const strayWolf = [{ pickId: 'stray_wolf', weekId: w0.weekId, gameId: w0.gameId, playerId: 'p1', selectedTeam: w0.facts.standout.team, submittedAt: 'x' }];
      const wolvesAfter = feed(M, assemble({ cfb: cfbFinal, nfl: nflFinal, contexts: [ctxCfb(cfbFinal), ctxNfl(nflFinal)], picksExtra: strayWolf })).filter((c) => isWolf(c) && c.gameId === w0.gameId);
      ck('3k a stray pick (by a non-entrant) on the lone wolf\'s side leaves him alone: the card still names him, unchanged', wolvesAfter.length === 1 && j(wolvesAfter[0].facts.standout) === j(w0.facts.standout) && j(wolvesAfter[0].facts) === j(w0.facts));
    }
    // "N of M in": the snapshot's counts
    const open = assemble({ cfb: cfbOpen, nfl: nflOpen, contexts: [ctxCfb(cfbOpen), ctxNfl(nflOpen)] });
    ck('3e "N of M in" counts the ENTRANTS of the week\'s own sport: CFB 6 of 6, NFL 3 of 3', eq(open.submissionCounts.w2, { submittedCount: 6, totalPlayers: 6 }) && eq(open.submissionCounts.n_w2, { submittedCount: 3, totalPlayers: 3 }));
    const strayOpenLeague = nflOf(fx.buildLeague({ w2: 'open', calculateWeeklyResults }), NFL_ENTRANTS, { stray: true });
    const strayOpen = assemble({ cfb: cfbOpen, nfl: strayOpenLeague, contexts: [ctxCfb(cfbOpen), ctxNfl(strayOpenLeague)] });
    ck('3f ...and a stray row by a non-entrant does not raise the count (3 of 3, not 4)', eq(strayOpen.submissionCounts.n_w2, { submittedCount: 3, totalPlayers: 3 }));
    const oneSport = assemble({ cfb: cfbOpen, contexts: null });
    ck('3g a one-sport league counts the active roster, exactly as before (6 of 6)', eq(oneSport.submissionCounts.w2, { submittedCount: 6, totalPlayers: 6 }));
    ck('3h the picks.submitted cards carry those counts', feed(M, open).filter((c) => c.type === 'picks.submitted').every((c) => (c.sport === 'nfl' ? c.facts.totalPlayers === 3 : c.facts.totalPlayers === 6)));
    // a reader that throws fails closed to nobody (never to the whole roster)
    const brokenRoster = assemble({ cfb: cfbOpen, nfl: nflOpen, contexts: [ctxCfb(cfbOpen), ctxNfl(nflOpen)], rosterOf: () => { throw new Error('boom'); } });
    ck('3i a roster reader that throws yields NO count (unknown), never the active roster', brokenRoster.submissionCounts.n_w2 === null && brokenRoster.submissionCounts.w2 === null);
  }

  // ── [4] THE BLIND RULE, per sport ──
  {
    const PICK_FACT_TYPES = ['game.final', 'called.it', 'stood.alone', 'player.week', 'streak.extended', 'streak.broken', 'milestone.reached', 'rank.changed', 'week.result'];
    const leaks = (cards, weekIds) => cards.filter((c) => weekIds.has(c.weekId) && PICK_FACT_TYPES.includes(c.type));
    // an OPEN NFL week beside a FINAL CFB week
    const a = assemble({ cfb: cfbFinal, nfl: nflOpen, contexts: [ctxCfb(cfbFinal), ctxNfl(nflOpen)] });
    const ca = feed(M, a);
    const nflOpenIds = new Set(['n_w2']);
    ck('4a CFB final + NFL open: no pick-bearing card exists for the open NFL week', leaks(ca, nflOpenIds).length === 0);
    ck('4b ...and the serialized NFL cards of that week carry no picked team and no initials chip', !/"selectedTeam"|"chips":\[\{/.test(j(ca.filter((c) => c.weekId === 'n_w2'))));
    ck('4c POSITIVE CONTROL: the CFB final week DOES have its pick-bearing cards', leaks(ca, new Set(['w2'])).length > 0);
    ck('4d POSITIVE CONTROL: the open NFL week still has its never-class card (the slate)', ca.some((c) => c.weekId === 'n_w2' && c.type === 'slate.published'));
    // a LIVE CFB week (public) beside an OPEN NFL week: reveal for CFB only
    const b = assemble({ cfb: cfbLive, nfl: nflOpen, contexts: [ctxCfb(cfbLive), ctxNfl(nflOpen)] });
    const cb = feed(M, b);
    ck('4e CFB live + NFL open: CFB shows its revealed card, NFL shows none', cb.some((c) => c.sport === 'cfb' && c.type === 'week.revealed') && !cb.some((c) => c.sport === 'nfl' && c.type === 'week.revealed'));
    // the reverse: NFL live, CFB open
    const c2 = assemble({ cfb: cfbOpen, nfl: nflLive, contexts: [ctxCfb(cfbOpen), ctxNfl(nflLive)] });
    const cc = feed(M, c2);
    ck('4f the reverse (NFL live + CFB open): NFL reveals, CFB does not', cc.some((c) => c.sport === 'nfl' && c.type === 'week.revealed') && !cc.some((c) => c.sport === 'cfb' && c.type === 'week.revealed'));
    ck('4g ...and no CFB week of that league has a pick-bearing card', leaks(cc, new Set(['w2'])).length === 0);
    // the slices carry nothing of the other sport
    const snap = assemble({ cfb: cfbFinal, nfl: nflOpen, contexts: [ctxCfb(cfbFinal), ctxNfl(nflOpen)] });
    const cfbSlice = M.sportContextSnapshot(snap, ctxCfb(cfbFinal));
    const nflSlice = M.sportContextSnapshot(snap, ctxNfl(nflOpen));
    const nflWeekSet = new Set(nflOpen.weeks.map((w) => w.weekId));
    ck('4h the CFB slice holds no NFL week, game, pick, result or player outside CFB', ['weeks', 'games', 'picks', 'weeklyResults', 'revealedWeeks', 'revealedGames', 'revealedPicks', 'revealedWeeklyResults'].every((k) => cfbSlice[k].every((x) => !nflWeekSet.has(x.weekId))));
    ck('4i the NFL slice holds only NFL weeks and only the three entrants as players', ['weeks', 'games', 'picks', 'weeklyResults', 'revealedWeeks', 'revealedGames', 'revealedPicks', 'revealedWeeklyResults'].every((k) => nflSlice[k].every((x) => nflWeekSet.has(x.weekId))) && eq(nflSlice.players.map((p) => p.playerId), NFL_ENTRANTS));
    ck('4j ...and its counts and read-confirmed flags are its own weeks\' alone', Object.keys(nflSlice.submissionCounts).every((k) => nflWeekSet.has(k)) && Object.keys(nflSlice.picksReadConfirmed).every((k) => nflWeekSet.has(k)));
    const league = M.leagueChatSnapshot(snap);
    ck('4k the league-wide (chat) slice holds no week, game, pick or result at all', ['weeks', 'games', 'picks', 'weeklyResults', 'revealedWeeks', 'revealedGames', 'revealedPicks', 'revealedWeeklyResults'].every((k) => league[k].length === 0) && league.tieContexts === null);
    // the confirmation flag of one sport never opens another (S-C10)
    const only = assemble({ cfb: cfbFinal, nfl: nflFinal, contexts: [ctxCfb(cfbFinal), ctxNfl(nflFinal)], supabase: true, pickConfirmed: (id) => id === 'w2' || id === 'w1' });
    const co = feed(M, only);
    ck('4l S-C10 per week: picks confirmed for the CFB weeks only => no NFL card that needs other members\' picks (game.final) exists', co.some((c) => c.sport === 'cfb' && c.type === 'game.final') && !co.some((c) => c.sport === 'nfl' && c.type === 'game.final'));
  }

  // ── [5] year-ago, chat, malformed contexts, withheld, determinism ──
  {
    const snap = assemble({ cfb: cfbFinal, nfl: nflFinal, contexts: [ctxCfb(cfbFinal), ctxNfl(nflFinal)] });
    const cards = feed(M, snap);
    ck('5a year-ago is never offered for another sport\'s week', !cards.some((c) => c.type === 'year.ago' && c.sport !== 'cfb'));
    const injected = (s) => (s.currentWeekId === 'n_w2' ? [{ id: 'ya', type: 'year.ago', sortKey: '2026-09-13T00:00:00.000Z', weekId: 'n_w2' }] : []);
    ck('5b CONTROL: a derive that DID offer an NFL year-ago has it dropped', M.deriveFeedCards(injected, snap, {}).every((c) => c.type !== 'year.ago'));
    const scribe = cards.filter((c) => c.type === 'scribe.post');
    const single = derive(assemble({ cfb: cfbFinal, contexts: null })).filter((c) => c.type === 'scribe.post');
    ck('5c a chat card appears ONCE (not once per sport) and carries no sport', scribe.length === single.length && scribe.length >= 1 && scribe.every((c) => c.sport === null && !('sportCode' in c) && !('competitionId' in c)));
    ck('5d the Locker Room card likewise', cards.filter((c) => c.type === 'lockerroom.top').length === 1 && cards.filter((c) => c.type === 'lockerroom.top').every((c) => c.sport === null));
    const bad = [null, 7, 'x', {}, { competitionId: '', dbCode: 'cfb', weekIds: [] }, { competitionId: 'a', dbCode: '', weekIds: [] }, { competitionId: 'a', dbCode: 'cfb', weekIds: 'w1' }];
    const mal = assemble({ cfb: cfbFinal, nfl: nflFinal, contexts: [...bad, ctxCfb(cfbFinal)] });
    const mc = feed(M, mal);
    ck('5e malformed contexts contribute nothing (only the one valid context produced sport cards)', mc.filter((c) => c.sport).every((c) => c.sport === 'cfb') && mc.some((c) => c.sport === 'cfb'));
    const dup = assemble({ cfb: cfbFinal, nfl: nflFinal, contexts: [ctxCfb(cfbFinal), ctxCfb(cfbFinal), ctxNfl(nflFinal)] });
    const dc = feed(M, dup);
    ck('5f a duplicated context is used once (no duplicate card ids)', new Set(dc.map((c) => c.id)).size === dc.length && j(dc) === j(cards));
    ck('5g the withheld gate yields NO cards in a several-sport league, as it does in a one-sport one', feed(M, snap, { isContentWithheld: () => true }).length === 0 && feed(M, snap, { isContentWithheld: () => { throw new Error('x'); } }).length === 0);
    ck('5h the feed is deterministic and newest-first (same input, same JSON; sortKey never increases down the list)', j(feed(M, snap)) === j(cards) && cards.every((c, i) => i === 0 || cards[i - 1].sortKey >= c.sortKey));
    let threw = false;
    try { M.deriveFeedCards(null, snap, {}); } catch { threw = true; }
    ck('5i deriveFeedCards() without a derive function refuses loudly', threw);
    ck('5j a throwing derive propagates (home.js turns it into the calm error card, never a partial feed)', (() => { try { M.deriveFeedCards(() => { throw new Error('x'); }, snap, {}); return false; } catch { return true; } })());
  }

  // ── [5b] security N1 (Part 2 item 10, 2026-10-08): the slice keeps a pick row only for an entrant OF THAT WEEK ──
  {
    const ctxN = { competitionId: NFL_ID, dbCode: 'nfl', code: 'NFL', weekIds: ['wn1', 'wn2'], playerIds: ['p1', 'p3', 'p4'], weekEntrants: { wn1: ['p1', 'p3'], wn2: ['p1', 'p3', 'p4'] }, currentWeekId: 'wn2' };
    const snapN = {
      players: [{ playerId: 'p1', active: true }, { playerId: 'p3', active: true }, { playerId: 'p4', active: true }],
      weeks: [{ weekId: 'wn1' }, { weekId: 'wn2' }], games: [], weeklyResults: [], revealedWeeks: [{ weekId: 'wn1' }, { weekId: 'wn2' }], revealedGames: [], revealedWeeklyResults: [],
      picks: [{ weekId: 'wn1', gameId: 'g1', playerId: 'p4', selectedTeam: 'X' }, { weekId: 'wn1', gameId: 'g1', playerId: 'p1', selectedTeam: 'X' }, { weekId: 'wn2', gameId: 'g2', playerId: 'p4', selectedTeam: 'Y' }],
      revealedPicks: [{ weekId: 'wn1', gameId: 'g1', playerId: 'p4', selectedTeam: 'X' }, { weekId: 'wn1', gameId: 'g1', playerId: 'p1', selectedTeam: 'X' }, { weekId: 'wn2', gameId: 'g2', playerId: 'p4', selectedTeam: 'Y' }],
      submissionCounts: {}, picksReadConfirmed: {}, contexts: [ctxN],
    };
    const sl = M.sportContextSnapshot(snapN, ctxN);
    const key = (x) => `${x.weekId}:${x.playerId}`;
    ck('5k a late joiner\'s row in the week that locked BEFORE he joined counts for nothing (picks and revealed picks), his row in the next week does', eq(sl.picks.map(key), ['wn1:p1', 'wn2:p4']) && eq(sl.revealedPicks.map(key), ['wn1:p1', 'wn2:p4']));
    ck('5l ...and the player list is still the roster as of now (he is named, he ranks from his next week)', eq(sl.players.map((p) => p.playerId), ['p1', 'p3', 'p4']));
    const flat = M.sportContextSnapshot({ ...snapN, contexts: [{ ...ctxN, weekEntrants: undefined }] }, { ...ctxN, weekEntrants: undefined });
    ck('5m a context with no weekEntrants (an older caller) falls back to the roster as of now - never to nobody', flat.picks.length === 3);
  }

  // ── [6] cardHTML ──
  {
    const escHtml = esc;
    const card = { id: 'c1', type: 'week.result', facts: { weekN: 2, weekWinnerName: 'Kevin', weekWinnerRecord: '3-1', weekLoserName: 'Drew', weekLoserRecord: '1-3' }, reason: 'Week result', sortKey: '2026-09-14T00:00:00.000Z' };
    const TNOW = Date.parse('2026-09-14T02:00:00.000Z');   // W-92: a card now carries its time ("2h ago"); a fixed clock keeps the golden deterministic
    const plain = H.cardHTML(card, { escHtml, now: TNOW });
    ck('6a a card with no sport has NO chip and NO sport attribute (a one-sport league\'s markup)', !/sport-chip|data-sport|data-competition-id/.test(plain) && /<article class="card feed-card feed-card--tap" role="button" tabindex="0" data-card-type="week\.result" data-home-action="open-card"/.test(plain));   // re-derived 2026-10-08 (merge): every card type is a tap target now (DI-575), so the sportless card has the tap shell and still no chip / sport attribute
    const tagged = H.cardHTML({ ...card, sport: 'nfl', sportCode: 'NFL', competitionId: NFL_ID }, { escHtml, now: TNOW });
    ck('6b a card in a several-sport league carries the chip and the sport on the article', /<span class="sport-chip">NFL<\/span>/.test(tagged) && new RegExp(`<article class="card feed-card feed-card--tap" role="button" tabindex="0" data-card-type="week\\.result" data-sport="nfl" data-competition-id="${NFL_ID}" data-home-action="open-card"`).test(tagged));   // re-derived 2026-10-08 (merge): the sport rides on the tap shell, before the action attributes
    ck('6c the chip sits in the card\'s eyebrow', /<div class="feed-card-eyebrow">[\s\S]*<span class="feed-card-trail"><span class="sport-chip">NFL<\/span><time class="feed-card-time"[^>]*>2h ago<\/time><span class="feed-card-chev"[\s\S]*?<\/span><\/span><\/div>/.test(tagged));   // W-92 (DI-W92-8, 2026-10-17): the trailing group is [chip][time][chevron], one span pushed to the trailing edge   // re-derived 2026-10-08 (merge): the chip sits in the eyebrow and the chevron FOLLOWS it (both at the trailing edge; styles.css .sport-chip + .feed-card-chev)
    const hostile = H.cardHTML({ ...card, sport: '"><img src=x onerror=alert(1)>', sportCode: '<img src=x onerror=alert(1)>', competitionId: '" onmouseover="x' }, { escHtml });
    ck('6d hostile sport text (code, dbCode, competition id) is inert: no live element, no attribute break', !/<img/i.test(hostile) && !/"\s*onmouseover=/.test(hostile) && !/onerror=alert\(1\)>/.test(hostile.replace(/&gt;/g, '')) && /&lt;img/.test(hostile));
    ck('6e a sport code without a dbCode renders neither the chip nor the attributes (both or neither)', !/sport-chip|data-sport/.test(H.cardHTML({ ...card, sportCode: 'NFL' }, { escHtml })) && !/sport-chip|data-sport/.test(H.cardHTML({ ...card, sport: 'nfl' }, { escHtml })));
    ck('6f the chip is a span with text only (no handler, no role, not focusable)', !/<span class="sport-chip"[^>]*(?:role|tabindex|onclick)/.test(tagged));
    ck('6g golden: a one-sport card renders exactly the unmodified (server-tree) markup', plain === GOLDEN_CARD_HTML);
  }

  // ── [7] cardCopy ──
  {
    const cc = (type, facts, sportCode) => fc.cardCopy({ type, facts }, { escHtml: esc, sportCode });
    const W = { weekN: 3 };
    const cases = [
      ['slate.published', { ...W, gameCount: 4, firstKickoff: null }, "Week 3's slate is up — 4 games.", "NFL Week 3's slate is up — 4 games."],
      ['picks.submitted', { ...W, submittedCount: 2, totalPlayers: 3 }, '2/3 in for Week 3.', '2/3 in for NFL Week 3.'],
      ['week.revealed', W, 'Week 3 is revealed. Every pick is visible now.', 'NFL Week 3 is revealed. Every pick is visible now.'],
      ['week.result', { ...W, weekWinnerName: 'Kevin', weekWinnerRecord: '3-1' }, 'Week 3 is final.', 'NFL Week 3 is final.'],
      ['player.week', { ...W, playerName: 'Kevin', wins: 3, losses: 1 }, "Kevin's Week 3: 3–1", "Kevin's NFL Week 3: 3–1"],
      // W-92 (DI-W92-1): these four carry their people as `members`; a one-member card reads exactly as the per-member card did
      ['rank.changed', { ...W, members: [{ playerId: 'p3', playerName: 'Kevin', fromRank: 2, toRank: 1 }] }, 'Kevin moved into 1st this week.', 'Kevin moved into 1st in NFL this week.'],
      ['streak.extended', { ...W, members: [{ playerId: 'p3', playerName: 'Kevin', run: 4, kind: 'covers' }] }, 'Kevin is riding a 4-game cover streak.', 'Kevin is riding a 4-game cover streak in NFL.'],
      ['streak.broken', { ...W, members: [{ playerId: 'p3', playerName: 'Kevin', run: 4, kind: 'covers' }] }, "Kevin's 4-game streak snapped this week.", "Kevin's 4-game streak in NFL snapped this week."],
      ['milestone.reached', { ...W, members: [{ playerId: 'p3', playerName: 'Kevin', mark: 10, total: 10 }] }, 'Kevin hit 10 correct picks this season.', 'Kevin hit 10 correct picks in NFL this season.'],
    ];
    for (const [type, facts, plainTitle, sportTitle] of cases) {
      const a = cc(type, facts, '').title, b = cc(type, facts, 'NFL').title;
      ck(`7 ${type}: no sport code => v0.29.0's words; with one => it names the sport`, a === plainTitle && b === sportTitle);
    }
    const RK1 = { ...W, members: [{ playerId: 'p3', playerName: 'Kevin', fromRank: 2, toRank: 1 }] };
    ck('7 rank.changed body names the sport\'s week too', cc('rank.changed', RK1, 'NFL').body === 'Up from 2nd after NFL Week 3.' && cc('rank.changed', RK1, '').body === 'Up from 2nd after Week 3.');
    ck('7 types that name no week or rank are unchanged by a sport code (game.final, called.it, stood.alone, year.ago, scribe.post, lockerroom.top)', ['game.final', 'called.it', 'stood.alone', 'year.ago', 'scribe.post', 'lockerroom.top'].every((t) => j(cc(t, { awayTeam: 'A', homeTeam: 'B', awayScore: 1, homeScore: 2, team: 'B', note: 'n', body: 'b', excerpt: 'e', reactionCount: 2, playerName: 'P', matchup: 'A at B', chips: [] }, 'NFL')) === j(cc(t, { awayTeam: 'A', homeTeam: 'B', awayScore: 1, homeScore: 2, team: 'B', note: 'n', body: 'b', excerpt: 'e', reactionCount: 2, playerName: 'P', matchup: 'A at B', chips: [] }, ''))));
    ck('7 a hostile sport code is escaped through the injected escaper', !/<img/i.test(cc('week.result', W, '<img src=x onerror=1>').title) && /&lt;img/.test(cc('week.result', W, '<img src=x onerror=1>').title));
  }
  return out;
}

// Captured from the UNCHANGED v0.29.0 home.js (a scratch copy of the tree before this work) for this exact card: a one-sport league's card markup must never move.
// RE-CAPTURED 2026-10-08 (merge): from the SERVER tree's home.js (17a9fa29), where week.result - like every card type - has a detail provider (DI-575) and so renders as ONE tap target. The merged tree is byte-identical
// to it for a card with no sport (run on both trees). The v0.29.0 non-tappable shell it replaces is the same card without the role/tabindex/data-home-action attributes and the chevron.
// RE-CAPTURED 2026-10-17 (W-92, DI-W92-5 / DI-W92-8): the same one-sport card now carries its time ("2h ago" at the fixed TNOW) in the eyebrow's trailing group, a data-feed-label, and a VoiceOver label that
// includes its supporting line and its time (the old "final.. Opens details." double stop is gone). Still: no chip, no sport attribute.
const GOLDEN_CARD_HTML = "<article class=\"card feed-card feed-card--tap\" role=\"button\" tabindex=\"0\" data-card-type=\"week.result\" data-home-action=\"open-card\" data-card-id=\"c1\" data-haptic=\"light\" data-feed-label=\"Week 2 is final. Kevin closes Week 2 3-1. Drew finishes 1-3, which is its own kind of achievement.\" aria-label=\"Week 2 is final. Kevin closes Week 2 3-1. Drew finishes 1-3, which is its own kind of achievement. 2 hours ago. Opens details.\"><div class=\"feed-card-eyebrow\"><span class=\"feed-card-icon\" aria-hidden=\"true\"><svg aria-hidden=\"true\" focusable=\"false\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M8 4h8v5a4 4 0 0 1-8 0z\"/><path d=\"M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4\"/><line x1=\"12\" y1=\"13\" x2=\"12\" y2=\"17\"/><line x1=\"8\" y1=\"20\" x2=\"16\" y2=\"20\"/></svg></span><span class=\"feed-card-reason\">Week result</span><span class=\"feed-card-trail\"><time class=\"feed-card-time\" datetime=\"2026-09-14T00:00:00.000Z\" data-feed-time=\"2026-09-14T00:00:00.000Z\" aria-label=\"2 hours ago\">2h ago</time><span class=\"feed-card-chev\" aria-hidden=\"true\"><svg aria-hidden=\"true\" focusable=\"false\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polyline points=\"9 6 15 12 9 18\"/></svg></span></span></div><h3 class=\"feed-card-title\">Week 2 is final.</h3><p class=\"feed-card-caption\">Kevin closes Week 2 3-1. Drew finishes 1-3, which is its own kind of achievement.</p></article>";

console.log('\n[1-7] DI-528 - the single-sport rule, nothing merges, entrants, the blind rule per sport, chat and year-ago, markup, copy…');
const ctl = await checks(hs);
for (const [name, ok] of Object.entries(ctl)) assert(ok, `[${name}]`);
assert(Object.keys(ctl).length >= 60, `[7z] the named-check table is not empty (${Object.keys(ctl).length} named checks)`);

// ═════════════════════════════════════════════════════════════════
console.log('\n[8] static scans…');
{
  const HS = await read('./js/home-sports.js');
  const HOME = await read('./js/home.js');
  const FC = await read('./js/feed-cards.js');
  const hsCode = stripComments(HS);
  const homeCode = stripComments(HOME);
  assert(!/^\s*import\s/m.test(hsCode) && !/\bfrom\s+'/.test(hsCode), '[8a] js/home-sports.js imports NOTHING (a pure leaf: it is handed deriveCards, it reads no store)');
  assert(!/\b(getPlayers|getPicks|getWeeks|getGames|canViewOtherPicks|arePicksPublic|localStorage|document|window|fetch)\b/.test(hsCode), '[8b] ...and names no store reader, no reveal predicate and no DOM or network');
  assert(!/p\s*=>\s*p\s*&&?\s*p\.active|\.filter\(\s*\(?p\)?\s*=>\s*p\.active/.test(hsCode), '[8c] ...and never filters an active roster (C4: the entrants arrive in the context, from playersForCompetition)');
  assert(!/(?<![A-Za-z])deriveCards\(/.test(homeCode.replace(/deriveFeedCards\(deriveCards,/g, '')), '[8d] home.js never calls deriveCards() directly: the one call goes through deriveFeedCards (once per sport)');
  assert((homeCode.match(/deriveFeedCards\(/g) || []).length === 1, '[8e] ...exactly once');
  assert(/function submissionCountsFor\([^)]*rosterFor = null/.test(homeCode) && /rosterFor: contexts \? read\.rosterForWeek : null/.test(homeCode), '[8f] the counts take the week\'s entrants only when the snapshot has contexts (a one-sport league passes none)');
  const activeExprs = homeCode.match(/players\.filter\(p => p && p\.active\)/g) || [];
  assert(activeExprs.length >= 1 && /const activeAll = players\.filter\(p => p && p\.active\);/.test(homeCode), '[8g] the active roster survives in home.js only as the one-sport default (`activeAll`) the counts fall back to');
  assert(/const sp = sportCode \? t\(sportCode\) : '';/.test(FC) && /sportCode = ''/.test(FC), '[8h] cardCopy takes an optional sportCode, escaped through the injected escaper, empty by default');
  const cardHtmlFn = (HOME.match(/export function cardHTML\([\s\S]*?\n\}\n/) || [''])[0];
  assert(/escHtml\(card\.sportCode\)/.test(cardHtmlFn) && /data-sport="\$\{escHtml\(card\.sport\)\}"/.test(cardHtmlFn) && /data-competition-id="\$\{escHtml\(card\.competitionId \|\| ''\)\}"/.test(cardHtmlFn),
    '[8i] cardHTML escapes the sport code, the sport and the competition id at the sink, in double-quoted attributes');
  const css = await read('./css/styles.css');
  assert(/\.sport-chip\{[^}]*color:var\(--text-secondary\)[^}]*\}/.test(css) && !/\.sport-chip\{[^}]*#[0-9a-fA-F]{3,8}/.test(css), '[8j] the chip is styled with tokens only (secondary text on the card, no colour literal)');
  // ADDED 2026-10-08 (merge of the sports client with the int Home / card-detail work): ONE derive path. The paint, the new-posts pill and the card-detail screen must derive their cards the same way, or a
  // card id the feed shows is not an id the detail can resolve in a several-sport league, and the pilot-only year.ago filter (security O1) must sit on the merged list so no sport's slice routes around it.
  const deriveBody = (homeCode.match(/function deriveHomeCards\(snapshot, o\) \{[\s\S]*?\n  \}/) || [''])[0];
  assert(/const all = deriveFeedCards\(deriveCards, snapshot, o\);/.test(deriveBody) && /pilotHistory\(\) \? all : all\.filter\(c => !c \|\| c\.type !== 'year\.ago'\)/.test(deriveBody),
    '[8k] deriveHomeCards() is deriveFeedCards(deriveCards, ...) THEN the pilot-only year.ago filter on the merged list');
  assert((homeCode.match(/(?<![\w.])deriveCards\(/g) || []).length === 0 && (homeCode.match(/cards = deriveHomeCards\(/g) || []).length === 2,
    '[8l] home.js never calls deriveCards() directly: the paint and the card detail BOTH go through deriveHomeCards() (exactly two assignments), so the id the feed shows is the id the detail resolves');
}

// ═════════════════════════════════════════════════════════════════
console.log('\n[9] MUTATION PROOFS on in-memory copies - each mutant must turn a NAMED check RED…');
{
  const HS_SRC = await read('./js/home-sports.js');
  const HOME_SRC = await read('./js/home.js');
  const URL_OF = (rel) => new URL(rel, import.meta.url).href;
  const mutate = async (src, edits, rewrite = false) => {
    let out = src;
    for (const [a, b] of edits) {
      const n = out.split(a).length - 1;
      if (n !== 1) throw new Error(`mutation anchor must match exactly once (matched ${n}): ${a.slice(0, 80)}`);
      out = out.split(a).join(b);
    }
    if (rewrite) out = out.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${f === 'home-sports.js' ? 'data:text/javascript;base64,' + Buffer.from(HS_SRC).toString('base64') : URL_OF('./js/' + f)}'`);
    return import('data:text/javascript;base64,' + Buffer.from(out).toString('base64'));
  };
  const redOn = async (label, mod, must, useHome = false) => {
    let res;
    try { res = await checks(useHome ? hs : mod, useHome ? mod : home); } catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 100)]: false }; }
    const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([n]) => n);
    const hit = must.every((m) => failed.some((f) => f.startsWith(m)));
    assert(failed.length > 0 && hit, `${label} -> RED on: ${failed.slice(0, 4).map((f) => f.slice(0, 70)).join(' | ') || '(nothing - the mutant SURVIVED)'}`);
  };
  assert(Object.values(ctl).every((v) => v === true), '[9-0] POSITIVE CONTROL: the unmutated modules pass every named check, so a red below is the mutation and nothing else');
  await redOn('[9-1] the slice\'s players are the ACTIVE ROSTER, not the sport\'s entrants (C4)', await mutate(HS_SRC, [["players: arr(s.players).filter((p) => !!p && entrants.has(str(p.playerId))),", 'players: arr(s.players),']]), ['3a', '2e']);
  await redOn('[9-2] the slice keeps EVERY sport\'s weeks (nothing is partitioned)', await mutate(HS_SRC, [['weeks: arr(s.weeks).filter(mine),', 'weeks: arr(s.weeks),']]), ['4h', '4i']);
  await redOn('[9-3] the slice keeps every sport\'s games, picks and reveal view (a pick crosses over)', await mutate(HS_SRC, [['games: arr(s.games).filter(mine),', 'games: arr(s.games),'], ['picks: arr(s.picks).filter((x) => mine(x) && entrantOf(x)),', 'picks: arr(s.picks),'], ['revealedPicks: arr(s.revealedPicks).filter((x) => mine(x) && entrantOf(x)),', 'revealedPicks: arr(s.revealedPicks),'], ['revealedGames: arr(s.revealedGames).filter(mine),', 'revealedGames: arr(s.revealedGames),']]), ['4h', '4i']);
  await redOn('[9-3b] the slice keeps its sport\'s pick rows of ANY member (not only its entrants): a non-entrant\'s stray pick un-alones a lone wolf', await mutate(HS_SRC, [['picks: arr(s.picks).filter((x) => mine(x) && entrantOf(x)),', 'picks: arr(s.picks).filter(mine),'], ['revealedPicks: arr(s.revealedPicks).filter((x) => mine(x) && entrantOf(x)),', 'revealedPicks: arr(s.revealedPicks).filter(mine),']]), ['3k']);
  await redOn('[9-4] contexts are ignored: derive runs once over the whole league (the blend)', await mutate(HS_SRC, [['if (contexts === null) return derive(snapshot, opts);', 'if (true) return derive(snapshot, opts);']]), ['2a', '2d']);
  await redOn('[9-3c] N1: the slice judges a pick row against the roster as of NOW, not the week\'s own entrants (a late joiner\'s row in a week that locked before he joined counts)', await mutate(HS_SRC, [['  const entrantOf = (x) => {\n    const list = perWeek && Object.prototype.hasOwnProperty.call(perWeek, str(x.weekId)) ? perWeek[str(x.weekId)] : null;\n    return Array.isArray(list) ? list.map(str).includes(str(x.playerId)) : entrants.has(str(x.playerId));\n  };', '  const entrantOf = (x) => entrants.has(str(x.playerId));']]), ['5k']);
  await redOn('[9-5] year-ago is offered for every sport', await mutate(HS_SRC, [["if (c.type === 'year.ago' && ctx.dbCode !== 'cfb') continue;", '']]), ['5b']);
  await redOn('[9-6] the chat slice keeps the sports\' weeks, games and picks (a pick-bearing pass without a sport)', await mutate(HS_SRC, [["    weeks: [], games: [], picks: [], weeklyResults: [],\n    revealedWeeks: [], revealedGames: [], revealedPicks: [], revealedWeeklyResults: [],\n    submissionCounts: {}, picksReadConfirmed: {}, tieContexts: null,", '    submissionCounts: {}, picksReadConfirmed: {}, tieContexts: null,']]), ['4k']);
  await redOn('[9-7] a slice\'s read-confirmed flags are the whole league\'s (S-C10 crosses sports)', await mutate(HS_SRC, [['picksReadConfirmed: readConfirmed,', 'picksReadConfirmed: rc,']]), ['4j']);
  await redOn('[9-8] the "N of M in" count ignores the week\'s entrants (the active roster again)', await mutate(HOME_SRC, [['if (rosterFor) { try { active = asArray(rosterFor(w)).filter(p => p && p.active); } catch { active = []; } }', '']], true), ['3e', '3h'], true);
  await redOn('[9-9] a roster reader that throws falls back to the whole roster instead of nobody', await mutate(HOME_SRC, [['catch { active = []; } }', 'catch { active = activeAll; } }']], true), ['3i'], true);
  await redOn('[9-10] the chip is rendered for a card with no dbCode / the attributes are not escaped', await mutate(HOME_SRC, [['data-sport="${escHtml(card.sport)}"', 'data-sport="${card.sport}"']], true), ['6d'], true);
  await redOn('[9-11] the sport code is passed to cardHTML unescaped', await mutate(HOME_SRC, [['<span class="sport-chip">${escHtml(card.sportCode)}</span>', '<span class="sport-chip">${card.sportCode}</span>']], true), ['6d'], true);
  await redOn('[9-12] the one-sport golden: a sport-less card gets a chip anyway', await mutate(HOME_SRC, [["const hasSport = typeof card.sportCode === 'string' && card.sportCode !== '' && typeof card.sport === 'string' && card.sport !== '';", 'const hasSport = true;']], true), ['6a', '6e', '6g'], true);
  await redOn('[9-13] the withheld gate is not handed to the per-sport derive calls', await mutate(HS_SRC, [['const cards = arr(derive(sportContextSnapshot(snapshot, ctx), opts));', 'const cards = arr(derive(sportContextSnapshot(snapshot, ctx), { ...opts, isContentWithheld: undefined }));']]), ['5g']);
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
