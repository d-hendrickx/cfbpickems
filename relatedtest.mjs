/**
 * CFB Pickems — relatedtest.mjs (Deployment 1, Lane B, DI-610, PF-452 rev 3, security C3 C4 C7, S3, 2026-10-08)
 * ===========================================================================================================
 * The "Related" region of the Game view: the Home feed cards ABOUT that game. Drew, D-63: "clicking into the game from gameday should [show] home feed cards relevant to that game". It is a FILTER of the
 * cards the feed already derived for this viewer at this instant (after every reveal gate), so it can never show more than Home itself shows that viewer.
 *
 *   [1] The filter: by game, by `gameIds`, by team + week; another week's and another game's cards are out; a SCRIBE post only when the SERVER minted it (relayed === false); junk input is []
 *   [2] A subset of Home, in Home's order, capped at three with "See all on Home" and hidden when there is none
 *   [3] The blind rule: nothing in Related that the feed does not already show; in a Locked or Open week no card that names a pick; C7 — a viewer who has not joined the sport gets no pick-naming card (S3)
 *   [4] Excluded weeks: a draft or demo week has no Game view for a member
 *   [5] Mutation proofs on a scratch copy: the server-minted rule, the not-joined rule and the same-week rule, resolveGameView passing {entered:true} (the reviewer's M4), and Related reading the raw card source (DI-614 mutation 9)
 *
 * Run:  node relatedtest.mjs
 */
import { readFileSync, mkdirSync, cpSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const assert = (cond, label, extra = '') => { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, extra ? `\n     ${extra}` : ''); } };
const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = process.env.RT_ROOT ? process.env.RT_ROOT.replace(/\/?$/, '/') : HERE;
const CORE_ONLY = process.env.RT_CORE === '1';
const imp = (rel) => import(new URL(rel, 'file://' + ROOT).href);
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const { installDom, mkHomeEnv, NOW, HOUR } = await imp('./d1homeenv.mjs');
const doc = installDom();
const home = await imp('./js/home.js');
const fc = await imp('./js/feed-cards.js');
const scoring = await imp('./js/scoring.js');
const storage = await imp('./js/storage.js');
const fx = await imp('./statsfixtures.mjs');
const E = await imp('./gamedayenv.mjs');
const { calculateWeeklyResults } = scoring;
const strip = (h) => h.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

const post = (id, gameId, relayed, ts = NOW - HOUR) => ({ id, leagueId: 'L1', ts, author: 'scribe', authorName: 'SCRIBE', body: `Post ${id}`, reactionCount: 0, context: { weekId: 'w2', weekN: 2, gameId, matchup: 'x' }, meta: { kind: 'lifecycle', test: false }, serverMinted: relayed === false });
const CHAT = { scribe: [post('srv1', 'g24', false, NOW - 1 * HOUR), post('srv2', 'g24', false, NOW - 2 * HOUR), post('srv3', 'g24', false, NOW - 3 * HOUR), post('srv4', 'g24', false, NOW - 4 * HOUR), post('rel1', 'g24', true, NOW - 5 * HOUR), post('srvOther', 'g21', false, NOW - 6 * HOUR)], lockerRoom: [] };
const league = (w2) => fx.buildLeague({ w2, calculateWeeklyResults });
function mk(L, o = {}) {
  const e = mkHomeEnv({ home }, doc, L, { read: { currentWeek: () => L.weeks[L.weeks.length - 1] }, chat: CHAT, deps: { entrantsFor: () => L.players.map((p) => ({ ...p, active: true })) }, ...o });
  const viewerId = o.viewer === undefined ? 'p1' : o.viewer;
  const snap = e.home.assembleSnapshot({ viewerId, isCommissioner: !!o.admin, now: NOW });
  const cards = fc.deriveCards(snap, { viewerId, now: NOW, viewerIsCommissioner: !!o.admin });
  return { e, snap, cards, viewerId };
}
const gameOf = (L, id) => L.games.find((g) => g.gameId === id);

// ═══ [1] The filter ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The filter…');
const FINAL = league('final');
const F = mk(FINAL);
{
  const g24 = gameOf(FINAL, 'g24');
  const rel = fc.cardsForGame(F.cards, g24);
  const ids = rel.map((c) => c.id);
  assert(rel.length >= 5, `1a: the final game g24 has Related cards (${rel.length}: ${[...new Set(rel.map((c) => c.type))].join(', ')})`);
  assert(rel.some((c) => c.type === 'game.final' && c.gameId === 'g24'), '1b: the game\'s own "Final" card is in it (matched by its gameId)');
  assert(['srv1', 'srv2', 'srv3', 'srv4'].every((id) => ids.some((x) => x.includes(id))), '1c: SCRIBE posts the SERVER minted about this game (relayed === false) are in it');
  assert(!ids.some((x) => x.includes('rel1')) && !ids.some((x) => x.includes('srvOther')), '1d: a relayed post (a member-minted row) and a post about ANOTHER game are not');
  assert(rel.every((c) => c.type !== 'game.final' || c.gameId === 'g24'), '1e: no other game\'s "Final" card is in it');
  const other = fc.cardsForGame(F.cards, gameOf(FINAL, 'g21'));
  assert(other.some((c) => c.type === 'game.final' && c.gameId === 'g21') && !other.some((c) => c.type === 'game.final' && c.gameId === 'g24') && other.some((c) => /srvOther/.test(c.id)), '1f: g21\'s Related is g21\'s: its own Final card and its own SCRIBE post');
  // synthetic cards: every way a card can be ABOUT a game, and the ways it cannot
  const G = { gameId: 'gx', weekId: 'wk', homeTeam: 'Home U', awayTeam: 'Away U' };
  const c = (o) => ({ id: o.id, type: o.type || 'game.final', ts: 1, facts: o.facts || {}, ...(o.top || {}) });
  const cards = [
    c({ id: 'byTop', top: { gameId: 'gx' } }), c({ id: 'byFact', facts: { gameId: 'gx' } }), c({ id: 'byList', facts: { gameIds: ['q', 'gx'] } }),
    c({ id: 'byTeam', type: 'streak.extended', facts: { teamIds: ['Home U'], weekId: 'wk' } }), c({ id: 'byTeamTop', type: 'streak.extended', top: { weekId: 'wk' }, facts: { teamIds: ['Away U'] } }),
    c({ id: 'teamWrongWeek', type: 'streak.extended', facts: { teamIds: ['Home U'], weekId: 'other' } }), c({ id: 'teamNoWeek', type: 'streak.extended', facts: { teamIds: ['Home U'] } }),
    c({ id: 'otherGame', facts: { gameId: 'gy' } }), c({ id: 'none' }),
    { id: 'scribeServer', type: 'scribe.post', ts: 1, serverMinted: true, facts: { gameId: 'gx' } }, { id: 'scribeMember', type: 'scribe.post', ts: 1, facts: { gameId: 'gx' } }, { id: 'scribeFalse', type: 'scribe.post', ts: 1, serverMinted: 'true', facts: { gameId: 'gx' } },
  ];
  assert(fc.cardsForGame(cards, G).map((x) => x.id).join() === 'byTop,byFact,byList,byTeam,byTeamTop,scribeServer', `1g: matched by gameId (card or facts), by gameIds, and by a team of the game IN THE GAME'S WEEK only; a SCRIBE post only with serverMinted === true exactly (${fc.cardsForGame(cards, G).map((x) => x.id).join()})`);
  const junk = [undefined, null, [], 'x', 7, {}, { gameId: '' }, { gameId: 5 }];
  assert(junk.every((j) => Array.isArray(fc.cardsForGame(cards, j)) && fc.cardsForGame(cards, j).length === 0) && [undefined, null, 'x', 7, {}].every((j) => fc.cardsForGame(j, G).length === 0), '1h: a missing or malformed game, or a list that is not a list, is []');
  assert(fc.cardsForGame(cards, G, undefined).length === 6 && fc.cardsForGame(cards, G, null).length >= 0, '1i: the options argument is optional (and a null one never throws)');
}

// ═══ [2] A subset of Home, in Home's order, capped, hidden when empty ═════════════════════════════
console.log('\n[2] A subset of Home, in its order, capped at three…');
{
  const view = F.e.home.resolveGameView('g24');
  assert(!!view && view.relatedIds.length >= 5 && view.related.length === 3 && view.related.every((id, i) => id === view.relatedIds[i]), `2a: Related shows the first THREE of the matching cards, in the feed's order (${view && view.related.length} of ${view && view.relatedIds.length})`);
  const feedIds = F.cards.map((c) => c.id);
  assert(view.relatedIds.every((id) => feedIds.includes(id)), '2b: every Related card is a card the feed itself derived for this viewer — it adds none');
  const pos = view.relatedIds.map((id) => feedIds.indexOf(id));
  assert(pos.every((p, i) => i === 0 || p > pos[i - 1]), '2c: …and in the feed\'s own order (newest first, stable)');
  assert(/data-gv="related"/.test(view.html) && /class="gv-sect">Related</.test(view.html) && /data-gv-action="see-all-home"/.test(view.html) && (view.html.match(/class="gv-rel"/g) || []).length === 3, '2d: the region is headed "Related", holds three cards and offers "See all on Home" when there are more');
  const g21 = F.e.home.resolveGameView('g21');
  assert(g21.relatedIds.length >= 1 && (g21.relatedIds.length > 3 ? /see-all-home/.test(g21.html) : !/see-all-home/.test(g21.html)), '2e: "See all on Home" appears exactly when there are more than three');
  const LIVE = league('live');
  const lv = mk(LIVE, { chat: { scribe: [], lockerRoom: [] } });
  const sched = LIVE.games.find((g) => g.weekId === 'w2' && g.status === 'scheduled');
  const none = lv.e.home.resolveGameView(sched.gameId);
  assert(!!none && none.relatedIds.length === 0 && !/data-gv="related"/.test(none.html) && !/>Related</.test(none.html), `2f: a game the feed says nothing about has NO Related region at all (not an empty box): ${sched.gameId}`);
  const seen = [];
  for (const id of view.related) { const k = F.cards.find((c) => c.id === id); seen.push(k.type); }
  assert(seen.length === 3, '2g: (fixture) three card types shown: ' + seen.join(', '));
  const sent = view.html;
  assert(!/Live Peek|GameDay/.test(sent) && /League picks/.test(sent) && /gv-score/.test(sent) && sent.indexOf('gv-score') < sent.indexOf('data-gv="related"') && sent.indexOf('League picks') < sent.indexOf('data-gv="related"'), '2h: the Related region comes AFTER the score card and the picks panel in the Game view (DI-591: 16 pt apart, top to bottom) and uses no retired name');
}

// ═══ [3] The blind rule ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] The blind rule…');
{
  const PICK = new Set(['game.final', 'called.it', 'stood.alone', 'week.result', 'player.week', 'rank.changed', 'streak.extended', 'streak.broken', 'milestone.reached']);
  const cardsOf = (html) => [...html.matchAll(/data-card-type="([a-z.]+)"/g)].map((m) => m[1]);
  // Locked / Open weeks through the real Game view
  for (const name of ['locked', 'openIn']) {
    const s = E.scenario(name);
    const m = E.mount({ home, storage }, doc, s);
    const first = s.league.games[0].gameId;
    const v = m.home.resolveGameView(first);
    const types = cardsOf(v ? v.html : '');
    assert(!!v && types.every((t) => !PICK.has(t)), `3a-${name}: the Game view of a game in a ${name === 'locked' ? 'LOCKED' : 'OPEN'} week shows no card that names a pick (${types.join(', ') || 'no cards'})`);
    const feed = fc.deriveCards(m.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: s.now }), { viewerId: 'p1', now: s.now, viewerIsCommissioner: false });
    assert(v.relatedIds.every((id) => feed.some((c) => c.id === id)), `3b-${name}: …and every one is in the feed (a subset: it widens no gate)`);
  }
  // C7 / S3: not joined the sport
  const g24 = gameOf(FINAL, 'g24');
  const entered = fc.cardsForGame(F.cards, g24, { entered: true }), notIn = fc.cardsForGame(F.cards, g24, { entered: false });
  assert(entered.some((c) => PICK.has(c.type)) && notIn.length >= 1 && notIn.every((c) => !PICK.has(c.type)) && notIn.length < entered.length, `3c: S3/C7 — for a viewer who has NOT joined the sport the pick-naming cards are omitted (${entered.length} -> ${notIn.length}) and the rest stay`);
  const only = fc.cardsForGame(F.cards, g24, { entered: false }).map((c) => c.type);
  assert(only.every((t) => ['scribe.post', 'slate.published', 'picks.submitted', 'week.revealed', 'year.ago', 'lockerroom.top'].includes(t)), `3d: …and what stays is the closed list that names no pick (${[...new Set(only)].join(', ')})`);
  // the Game view of a non-entrant, on a FINAL game (reviewer N2, fix round 1: the first version of this check used a LIVE game, where no card names a pick at all, so it could never fail). g21 is final and the feed
  // draws three "called it" cards about it for an entrant; for a viewer who is NOT on the roster not one of them may reach the Game view. The positive control is the same game for an entrant.
  const rosterWithout = (L, id) => L.players.filter((p) => p.playerId !== id).map((p) => ({ ...p, active: true }));
  const vIn = mk(FINAL).e.home.resolveGameView('g21');
  const vNon = mk(FINAL, { deps: { entrantsFor: () => rosterWithout(FINAL, 'p1') } }).e.home.resolveGameView('g21');
  // W-92 (DI-W92-2): the three "called it" cards about g21 are folded into g21's own result card, which now NAMES the callers — so the pick-naming Related card is exactly that one.
  assert(!!vIn && cardsOf(vIn.html).filter((t) => PICK.has(t)).join() === 'game.final' && /called it: Washington \+7 won outright/.test(vIn.html), `3e-0: (positive control) an ENTRANT opening the final game g21 sees its pick-naming Related card — the result card naming who called it (${cardsOf(vIn ? vIn.html : '').join(', ')})`);
  assert(!!vNon && cardsOf(vNon.html).every((t) => !PICK.has(t)) && vNon.relatedIds.length < vIn.relatedIds.length && !/pg-cluster|pg-pp/.test(vNon.html), `3e: a viewer who is not on the roster gets NO pick-naming Related card for the same final game (${vNon && vNon.relatedIds.length} cards instead of ${vIn && vIn.relatedIds.length}; what stays is the SCRIBE post, which names no pick) and no pick line in the panel`);
  const sNonLive = E.scenario('live3', { entrants: () => fx.PLAYERS.filter((p) => p.playerId !== 'p1').map((p) => ({ ...p, active: true })) });
  const vNonLive = E.mount({ home, storage }, doc, sNonLive).home.resolveGameView('c1');
  assert(!!vNonLive && !/pg-cluster|pg-pp/.test(vNonLive.html), '3e-live: …and on a LIVE game of the Game Day fixture the panel draws no pick line for a non-entrant either (the card check above is the one with teeth; this one is the panel)');
  // DI-614 / S-C10 (reviewer N2, fix round 1): Related is a filter of the feed's GATED list, so a week whose other members' rows have not landed (supabase) yields nothing for a final game, and the same game with the
  // rows landed yields cards (the positive control). Related is also a subset of the feed in every state tried.
  {
    const notLanded = mk(FINAL, { supabase: true, picksRead: () => false });
    const landed = mk(FINAL, { supabase: true, picksRead: () => true });
    const vNo = notLanded.e.home.resolveGameView('g21'), vYes = landed.e.home.resolveGameView('g21');
    assert(!!vYes && vYes.relatedIds.length >= 1, `3h-0: (positive control) with the rows LANDED the final game g21 has Related cards (${vYes && vYes.relatedIds.length})`);
    const typeOfId = (env, id) => { const c = env.cards.find((x) => x.id === id); return c ? c.type : null; };
    const pickNaming = (env, v) => v.relatedIds.filter((id) => PICK.has(typeOfId(env, id)));
    assert(!!vNo && pickNaming(notLanded, vNo).length === 0 && cardsOf(vNo.html).every((t) => !PICK.has(t)) && pickNaming(landed, vYes).length === 1, `3h: S-C10 — a final game in a week whose rows have NOT landed shows NO pick-naming Related card (${pickNaming(notLanded, vNo).length}, against ${pickNaming(landed, vYes).length} once they have); the feed itself holds ${notLanded.cards.length} cards, ${landed.cards.length} once they have`);
    for (const [label, env] of [['rows landed', landed], ['rows not landed', notLanded], ['server status live', mk(FINAL, { confirmed: () => 'live' })], ['local', mk(FINAL)]]) {
      const feedIds = new Set(env.cards.map((c) => c.id));
      const all = FINAL.games.map((g) => env.e.home.resolveGameView(g.gameId)).filter(Boolean);
      assert(all.length > 0 && all.every((v) => v.relatedIds.every((id) => feedIds.has(id))), `3h-subset-${label}: every Related card of every game is a card the feed derived for this viewer in this state (${all.length} games)`);
    }
  }
  // week mismatch: a team match counts only in the game's own week
  const TEAM = { id: 'tw', type: 'streak.extended', ts: 1, facts: { teamIds: ['Texas'], weekId: 'w1' } };
  assert(fc.cardsForGame([TEAM], { gameId: 'z', weekId: 'w2', homeTeam: 'Texas', awayTeam: 'X' }).length === 0 && fc.cardsForGame([TEAM], { gameId: 'z', weekId: 'w1', homeTeam: 'Texas', awayTeam: 'X' }).length === 1, '3f: a team-matched card from ANOTHER week is not about this game (the week must match)');
  assert(!/storage\.js|getPicks|\bpicks\b/.test(read('./js/feed-cards.js').slice(read('./js/feed-cards.js').indexOf('export function cardsForGame'), read('./js/feed-cards.js').indexOf('// ═══ copy (title / body)')).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')), '3g: cardsForGame reads no pick and no storage: it only filters the cards it is handed');
}

// ═══ [4] Excluded weeks ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] Excluded weeks…');
{
  const draftNfl = (s) => { s.league.weeks = s.league.weeks.map((w) => (w.sport === 'nfl' ? { ...w, status: 'draft' } : w)); };
  const demoNfl = (s) => { s.league.weeks = s.league.weeks.map((w) => (w.sport === 'nfl' ? { ...w, dataSourceMode: 'demo' } : w)); };
  for (const [label, tweak] of [['draft', draftNfl], ['demo', demoNfl]]) {
    const s = E.scenario('both'); tweak(s);
    const m = E.mount({ home, storage }, doc, s);
    assert(m.home.resolveGameView('n1') === null && m.home.resolveGameView('c1') !== null, `4a-${label}: a ${label} week has no Game view for a member (its sibling CFB game does)`);
  }
  const s = E.scenario('both', { admin: true }); demoNfl(s);
  assert(E.mount({ home, storage }, doc, s).home.resolveGameView('n1') !== null, '4b: …a demo week\'s Game view is the commissioner\'s');
  const sw = E.scenario('live3'); const mw = E.mount({ home, storage }, doc, sw); mw.env.state.withheld = true;
  assert(mw.home.resolveGameView('c1') === null, '4c: a WITHHELD Home (a security hold) resolves no Game view');
  const sh = E.scenario('live3', { hostile: true });
  sh.league.games = sh.league.games.map((g) => ({ ...g, homeTeam: `H"><img src=x onerror=1>`, awayTeam: 'A<b>x</b>' }));
  sh.league.picks = sh.league.picks.map((p) => ({ ...p, selectedTeam: `H"><img src=x onerror=1>` }));
  const vh = E.mount({ home, storage }, doc, sh).home.resolveGameView('c1');
  const attrNames = (h) => [...h.matchAll(/<[a-z][^>]*>/gi)].flatMap((mm) => [...mm[0].replace(/"[^"]*"/g, '""').matchAll(/\s([a-z-]+)(?==|\s|>|$)/gi)].map((a) => a[1].toLowerCase()));
  assert(!!vh && !/<img/i.test(vh.html) && !/<b>x<\/b>/.test(vh.html) && !attrNames(vh.html).some((n) => n.startsWith('on') || n === 'src') && /&lt;img/.test(vh.html), '4d: hostile team names in a Game view (score card, panel, Related) come out inert: no live element, no handler attribute, present as text');
}

if (!CORE_ONLY) await mutations();
async function mutations() {
  console.log('\n[5] MUTATION PROOFS — five on a scratch copy; each must turn this suite red…');
  const tmp = mkdtempSync(join(tmpdir(), 'cfbp-rel-'));
  const copy = join(tmp, 'cfb-pickems');
  mkdirSync(copy, { recursive: true });
  for (const p of ['js', 'index.html', 'minidom.mjs', 'statsfixtures.mjs', 'd1homeenv.mjs', 'gamedayenv.mjs', 'relatedtest.mjs']) if (existsSync(join(ROOT, p))) cpSync(join(ROOT, p), join(copy, p), { recursive: true });
  const original = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const run = () => { const r = spawnSync(process.execPath, [join(copy, 'relatedtest.mjs')], { cwd: copy, env: { ...process.env, RT_ROOT: copy, RT_CORE: '1' }, encoding: 'utf8', timeout: 120000 }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
  const base = run();
  assert(base.code === 0 && /ALL PASS/.test(base.out), '5-0: POSITIVE CONTROL — the unmutated COPY passes in a separate process', base.out.slice(-400));
  const FILE = 'js/feed-cards.js';
  const muts = [
    ['R1', 'the server-minted rule is dropped (a member-minted SCRIBE post can be "about" a game)', [["if (c.type === 'scribe.post' && c.serverMinted !== true) return false;", ""]]],
    ['R2', 'the not-joined rule is dropped (a pick-naming card reaches a viewer who has not joined the sport)', [["if (entered === false && namesPick(c.type)) return false;", ""]]],
    ['R3', 'the same-week rule is dropped (a team match from ANOTHER week counts)', [["&& typeof game.weekId === 'string' && (c.weekId === game.weekId || f.weekId === game.weekId)", ""]]],
    // N2 / security F2.1 (fix round 1): the two mutants the reviewer ran by hand, now encoded. Both are in js/home.js's resolveGameView.
    ['R4', 'the reviewer\'s M4: resolveGameView hands the filter {entered:true} whoever is looking (a viewer who has not joined the sport gets the pick-naming cards)', [["const related = cardsForGame(cards, game, { entered: viewer ? viewerIn && entered : true });", "const related = cardsForGame(cards, game, { entered: true });"]], 'js/home.js'],
    // (R5 retargeted 2026-10-08, D1 Lane B Game Day consolidated round: the Game view's cards now come from the shared freshSnapshot(); the mutant re-derives them RAW right after it)
    ['R5', 'DI-614 mutation (9): Related reads the RAW card source (the rows-landed and reveal gates are skipped) instead of the feed\'s gated list', [["    const { snapshot, cards, viewerId, isCommissioner, now } = fresh;", "    const { snapshot, viewerId, isCommissioner, now } = fresh;\n    const cards = deriveHomeCards({ ...snapshot, picksReadConfirmed: new Proxy({}, { get: () => true }) }, { viewerId, now, viewerIsCommissioner: isCommissioner, isContentWithheld: d.isContentWithheld });"]], 'js/home.js'],
  ];
  for (const [id, label, edits, fileOf] of muts) {
    const F = fileOf || FILE;
    let src = original(F), ok = true;
    for (const [from, to] of edits) { if (!src.includes(from)) { ok = false; break; } src = src.replace(from, to); }
    if (!ok) { assert(false, `5-${id}: the mutation APPLIES (its anchor moved)`); continue; }
    writeFileSync(join(copy, F), src);
    const r = run();
    writeFileSync(join(copy, F), original(F));
    assert(r.code !== 0 && /❌/.test(r.out), `5-${id}: ${label} → RED on: ${[...r.out.matchAll(/❌ ([^\n]{0,60})/g)].map((m) => m[1]).slice(0, 2).join(' | ') || '(nothing!)'}`);
  }
  const again = run();
  assert(again.code === 0 && /ALL PASS/.test(again.out), '5-Z: …and after every restore the copy is GREEN again');
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best effort */ }
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 8000).unref();
