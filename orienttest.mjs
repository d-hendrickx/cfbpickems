/**
 * CFB Pickems — orienttest.mjs
 * ============================
 * SCORE ORIENTATION SUITE — one question, asked at every layer:
 *
 *   "Is the score bound to, and printed next to, the RIGHT team?"
 *
 * Filed as fb_1788305911550_emksp (Drew, commissioner, 2026-09-01, v0.17.7):
 *
 *   "Some of the game scores are switched. The live score convention needs to
 *    be the same convention as the games. So if it is team 1 @ team 2, the
 *    scores need to be listed appropriately following the same convention."
 *
 * The word that drives this file is "SOME". A uniformly reversed render would
 * have produced "the scores are switched". A subset means something
 * DISTINGUISHES the broken cases from the sound ones, and that difference is
 * the root cause. This suite is organised to find it by elimination:
 *
 *   [1] DATA LAYER   (js/data-provider.js) — does a score ever get BOUND to
 *                     the wrong team? Includes the two mechanisms most likely
 *                     to produce a subset: ESPN's non-guaranteed competitors[]
 *                     array order (neutral-site games invert it), and the
 *                     live-refresh merge path that copies scores across by
 *                     name onto an already-stored game.
 *   [2] RENDER LAYER (js/app.js) — given correctly-bound data, is the score
 *                     PRINTED in the same left-to-right order as the matchup
 *                     label sitting directly above/beside it?
 *   [3] STRUCTURE    — the two render sites not reachable through an export,
 *                     plus the CSS that makes the ordering a VISUAL fact and
 *                     not just a DOM-order curiosity.
 *   [4] GRADING      — did any of this reach calculateAtsWinner()? This is the
 *                     money question: ATS decides who owes whom. Asserted as a
 *                     "stays ruled out" guard, not an assumption.
 *
 * Run:  node orienttest.mjs
 * Also: TZ=UTC node orienttest.mjs && TZ=America/Los_Angeles node orienttest.mjs
 *       (RG-38 — kickoff parsing is timezone-sensitive; the date-range filter
 *        in parseAndReport() constructs local Dates from bare date strings.)
 */

// ── DOM / browser stubs (same shape as loadtest.mjs) ─────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: () => null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

// Network is stubbed per-test; default is a hard failure so no suite can
// silently depend on a real ESPN round-trip.
globalThis.fetch = async () => { throw new Error('network disabled in orienttest'); };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const { readFileSync } = await import('node:fs');
const provider = await import('./js/data-provider.js');
const storage  = await import('./js/storage.js');
const scoring  = await import('./js/scoring.js');
const app      = await import('./js/app.js');

const APP_SRC = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
const CSS_SRC = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES — real ESPN scoreboard payload shape.
//
// Both events are FINAL with LOPSIDED, UNMISTAKABLE scores. That is deliberate:
// a 41–10 game cannot be read correctly by accident, and it cannot be confused
// for a rounding or formatting difference. If orientation is wrong anywhere,
// these numbers make it unambiguous.
//
// EVENT 1 — ordinary home/away game. competitors[] in ESPN's conventional
//           [home, away] order. HOME wins big.
// EVENT 2 — NEUTRAL-SITE game with competitors[] in INVERTED [away, home]
//           order, which is exactly what ESPN emits for many neutral-site
//           kickoff-classic games. AWAY wins big. This is candidate mechanism
//           #1 for "some": if home/away were derived positionally rather than
//           from each competitor's own homeAway field, THIS event breaks and
//           event 1 does not — a perfect "some are switched" signature.
// ─────────────────────────────────────────────────────────────────────────────
const espnPayload = {
  events: [
    {
      id: '401700001',
      date: '2026-09-05T23:30Z',
      name: 'Texas Longhorns at Ohio State Buckeyes',
      status: { type: { name: 'STATUS_FINAL', detail: 'Final' } },
      competitions: [{
        neutralSite: false,
        venue: { fullName: 'Ohio Stadium', address: { city: 'Columbus', state: 'OH' } },
        odds: [{ provider: { name: 'ESPN BET' }, details: 'OSU -3.5' }],
        competitors: [
          { homeAway: 'home', score: '41', team: { location: 'Ohio State', name: 'Buckeyes', abbreviation: 'OSU', conferenceId: '5' } },
          { homeAway: 'away', score: '10', team: { location: 'Texas',      name: 'Longhorns', abbreviation: 'TEX', conferenceId: '8' } },
        ],
      }],
    },
    {
      id: '401700002',
      date: '2026-09-05T20:00Z',
      name: 'Notre Dame Fighting Irish vs Alabama Crimson Tide',
      status: { type: { name: 'STATUS_FINAL', detail: 'Final' } },
      competitions: [{
        neutralSite: true,
        venue: { fullName: 'Mercedes-Benz Stadium', address: { city: 'Atlanta', state: 'GA' } },
        odds: [{ provider: { name: 'ESPN BET' }, details: 'ND -6.5' }],
        // INVERTED ORDER — away listed first.
        competitors: [
          { homeAway: 'away', score: '38', team: { location: 'Notre Dame', name: 'Fighting Irish', abbreviation: 'ND',  conferenceId: '18' } },
          { homeAway: 'home', score: '7',  team: { location: 'Alabama',    name: 'Crimson Tide',   abbreviation: 'ALA', conferenceId: '8'  } },
        ],
      }],
    },
  ],
};

function stubEspn(payload) {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => payload });
}

// ═════════════════════════════════════════════════════════════════════════════
// [1] DATA LAYER — is the score ever BOUND to the wrong team?
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] Data layer (js/data-provider.js) — score→team binding through the real parse path…');
{
  stubEspn(espnPayload);
  const res = await provider.fetchByDateRange({ startDate: '2026-09-05', endDate: '2026-09-05' });

  assert(res.error === null && res.games.length === 2,
    `fixture check: both ESPN events parsed (got ${res.games.length}, error=${res.error || 'none'})`);

  const normal  = res.games.find(g => g.espnEventId === '401700001');
  const neutral = res.games.find(g => g.espnEventId === '401700002');

  // 1a — ordinary game, conventional [home, away] competitor order.
  assert(normal?.homeTeam === 'Ohio State' && normal?.awayTeam === 'Texas',
    '1a: ordinary game — homeTeam/awayTeam taken from each competitor\'s homeAway field');
  assert(normal?.homeScore === 41 && normal?.awayScore === 10,
    `1a: ordinary game — 41 binds to HOME (Ohio State), 10 to AWAY (Texas); got home=${normal?.homeScore} away=${normal?.awayScore}`);

  // 1b — THE SUBSET CANDIDATE. Neutral site, competitors[] inverted.
  // If this assertion fails while 1a passes, ESPN array order IS the root
  // cause and "some" means "the neutral-site ones".
  assert(neutral?.homeTeam === 'Alabama' && neutral?.awayTeam === 'Notre Dame',
    '1b: NEUTRAL-SITE game with INVERTED competitors[] — home/away still resolved by homeAway, not by array position');
  assert(neutral?.homeScore === 7 && neutral?.awayScore === 38,
    `1b: NEUTRAL-SITE inverted order — 7 binds to HOME (Alabama), 38 to AWAY (Notre Dame); got home=${neutral?.homeScore} away=${neutral?.awayScore}`);

  // 1c — actualWinner is derived from the bound scores, so it inherits any
  // binding error. Notre Dame is the AWAY team and won 38–7.
  assert(normal?.actualWinner === 'Ohio State',
    '1c: actualWinner follows the binding on an ordinary game (home won)');
  assert(neutral?.actualWinner === 'Notre Dame',
    '1c: actualWinner follows the binding on the inverted neutral-site game (AWAY won) — a positional bug would name Alabama here');

  // 1d — SPREAD SIGN under inverted competitor order. The odds `details` in
  //      both fixtures use ESPN's real ABBREVIATION form ('OSU -3.5' / 'ND
  //      -6.5'); they spelled the school name out until 2026-09-03, which only
  //      resolved via a school-name heuristic rung that was deleted that day
  //      for reading shared-suffix matchups backwards. The abbreviation rung
  //      finds each side by `homeAway`, never by array position, so this
  //      assertion still catches a positional bug.
  //      CLAUDE.md locks
  // game.spread to signed HOME perspective (negative = home favored). ESPN
  // said "ND -6.5" and Notre Dame is the AWAY team, so home perspective must
  // be POSITIVE 6.5. Getting this wrong is the shape of the v0.13–v0.15
  // spread bug and would be far worse than a swapped score line.
  assert(normal?.spread === -3.5 && normal?.favorite === 'Ohio State',
    `1d: ordinary game — home favorite yields NEGATIVE home-perspective spread; got ${normal?.spread} (fav ${normal?.favorite})`);
  assert(neutral?.spread === 6.5 && neutral?.favorite === 'Notre Dame',
    `1d: inverted neutral-site game — AWAY favorite yields POSITIVE home-perspective spread; got ${neutral?.spread} (fav ${neutral?.favorite})`);

  // 1e — THE MERGE PATH (candidate mechanism #2). refreshScoresByEventIds()
  // copies homeScore/awayScore by NAME from a freshly-parsed live result onto
  // an already-stored game row. That is only correct if both sides agreed on
  // the mapping. Feed it a stored row whose home/away are the CORRECT way
  // round and confirm the refresh does not transpose them.
  const stored = [
    { gameId: 'ot_g1', espnEventId: '401700001', espnSport: 'college-football', homeTeam: 'Ohio State', awayTeam: 'Texas' },
    { gameId: 'ot_g2', espnEventId: '401700002', espnSport: 'college-football', homeTeam: 'Alabama',    awayTeam: 'Notre Dame' },
  ];
  stubEspn(espnPayload);
  const refreshed = await provider.refreshScoresByEventIds([], stored);
  const up1 = refreshed.updated.find(u => u.gameId === 'ot_g1');
  const up2 = refreshed.updated.find(u => u.gameId === 'ot_g2');

  assert(refreshed.errors.length === 0 && refreshed.updated.length === 2,
    `1e: fixture check: live refresh returned both games (updated=${refreshed.updated.length}, errors=${JSON.stringify(refreshed.errors)})`);
  assert(up1?.homeScore === 41 && up1?.awayScore === 10,
    `1e: live-refresh merge preserves orientation on the ordinary game; got home=${up1?.homeScore} away=${up1?.awayScore}`);
  assert(up2?.homeScore === 7 && up2?.awayScore === 38,
    `1e: live-refresh merge preserves orientation on the INVERTED neutral-site game — the merge copies by name, so a parse-side transposition would surface here; got home=${up2?.homeScore} away=${up2?.awayScore}`);
  assert(up2?.actualWinner === 'Notre Dame',
    '1e: live-refresh carries the AWAY winner through unchanged on the inverted game');
}

// ═════════════════════════════════════════════════════════════════════════════
// [2] RENDER LAYER — given correct data, is the score PRINTED in the same
//     order as the matchup label it sits next to?
//
// Every matchup label in this app is built by matchup() / matchupBare() /
// the .matchup DOM block, and every one of them reads AWAY first:
// "Texas @ Ohio State". So the score beside it must read AWAY first too.
// This is Drew's report stated as an invariant: if the label is
// "team 1 @ team 2", the score is "team 1's points – team 2's points".
//
// Fixture: AWAY team wins 38–7. Correct render = "38–7". Reversed = "7–38".
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] Render layer (js/app.js) — score order vs. matchup order…');
{
  const WK = {
    weekId: 'ot_wk', weekNumber: 1, season: 2026, status: 'final',
    dataSourceMode: 'demo', startDate: '2026-09-05', endDate: '2026-09-06',
  };
  storage.saveWeek(WK);

  // AWAY (Notre Dame) beat HOME (Alabama) 38–7 at a neutral site.
  const G = {
    weekId: WK.weekId, gameId: 'ot_game', espnEventId: null,
    homeTeam: 'Alabama', awayTeam: 'Notre Dame',
    homeConference: 'SEC', awayConference: 'Ind',
    kickoff: '2026-09-05T20:00:00Z', kickoffConfirmed: true,
    spread: 6.5, favorite: 'Notre Dame', lockedSpread: 6.5,
    homeScore: 7, awayScore: 38,
    status: 'final', actualWinner: 'Notre Dame', atsWinner: 'Notre Dame',
    neutralSite: true, multiplier: 1,
  };
  storage.saveGame(G);
  storage.addPlayer({ playerId: 'ot_p1', displayName: 'Drew', active: true });
  const PICKS = [{ pickId: 'ot_pk1', weekId: WK.weekId, gameId: G.gameId, playerId: 'ot_p1', selectedTeam: 'Notre Dame' }];
  storage.saveAllPicks([...storage.getPicks(), ...PICKS]);

  const players = [{ playerId: 'ot_p1', displayName: 'Drew', active: true }];
  const games   = storage.getGames(WK.weekId);
  const results = [{ playerId: 'ot_p1', rank: 1, correctPicks: 1, incorrectPicks: 0, tiebreakerGuess: 45, tiebreakerDelta: 0 }];

  assert(games.length === 1 && games[0].awayScore === 38 && games[0].homeScore === 7,
    'fixture check: the stored game is correctly oriented (away 38, home 7) — any failure below is a RENDER defect, not a data defect');

  // ── 2a — the standard matrix (renderDashboardTable) ──────────────────────
  const matrixHtml = app.renderDashboardTable(players, games, PICKS, results, WK.weekId, null);

  const label = (matrixHtml.match(/<div class="game-info-matchup">([\s\S]*?)<\/div>/) || [])[1] || '';
  assert(/Notre Dame\s+vs\s+Alabama/.test(label),
    `fixture check: the matrix label reads AWAY-first ("Notre Dame vs Alabama") — got "${label.trim()}"`);

  const finalPill = (matrixHtml.match(/<span class="status-pill status-pill-final">([\s\S]*?)<\/span>/) || [])[1] || '';
  assert(finalPill.length > 0, 'fixture check: the matrix FINAL score pill rendered');
  assert(/38\s*[–-]\s*7/.test(finalPill),
    `2a: THE BUG — the matrix FINAL pill must print AWAY–HOME ("38–7") to match its own "Notre Dame vs Alabama" label; got "${finalPill.trim()}"`);

  // Same game, LIVE. The live pill is a separate code path from the final pill
  // and has to be asserted separately — this is the one Drew named explicitly
  // ("the live score convention").
  const liveGames = [{ ...G, status: 'live' }];
  const liveHtml  = app.renderDashboardTable(players, liveGames, PICKS, results, WK.weekId, null);
  const livePill  = (liveHtml.match(/<span class="live-pill"[\s\S]*?LIVE[^<]*/) || [''])[0];
  assert(/LIVE/.test(livePill), 'fixture check: the matrix LIVE score pill rendered');
  assert(/38\s*[–-]\s*7/.test(livePill),
    `2b: THE BUG — the matrix LIVE pill must print AWAY–HOME ("38–7") to match its label; got "${livePill.replace(/<[^>]*>/g, '').trim()}"`);

  // ── 2c/2d — the compact dashboard (renderDashboardCompact) ───────────────
  const dcHtml = app.renderDashboardCompact(players, games, PICKS, results, WK.weekId, null);
  const dcLabel = (dcHtml.match(/<div class="dc-matchup">([\s\S]*?)<\/div>/) || [])[1] || '';
  assert(/Notre Dame\s+vs\s+Alabama/.test(dcLabel),
    `fixture check: the compact card label reads AWAY-first — got "${dcLabel.trim()}"`);

  const dcFinal = (dcHtml.match(/<span class="dc-status dc-final">([\s\S]*?)<\/span>/) || [])[1] || '';
  assert(dcFinal.length > 0, 'fixture check: the compact FINAL score rendered');
  assert(/38\s*[–-]\s*7/.test(dcFinal),
    `2c: THE BUG — the compact card's FINAL score must print AWAY–HOME ("38–7") to match its own "Notre Dame vs Alabama" label; got "${dcFinal.trim()}"`);

  const dcLiveHtml = app.renderDashboardCompact(players, liveGames, PICKS, results, WK.weekId, null);
  const dcLive = (dcLiveHtml.match(/<span class="dc-status dc-live">([\s\S]*?)<\/span>\s*<\/div>/) || [])[1] || '';
  assert(dcLive.length > 0, 'fixture check: the compact LIVE score rendered');
  assert(/38\s*[–-]\s*7/.test(dcLive),
    `2d: THE BUG — the compact card's LIVE score must print AWAY–HOME ("38–7"); got "${dcLive.replace(/<[^>]*>/g, '').trim()}"`);

  // ── 2e — the view that was ALREADY correct. This is the control. It proves
  // the convention is away-first (not a matter of taste) and that the defect
  // is a SUBSET of render sites, which is precisely what "some" meant.
  const myWeekSrc = APP_SRC.slice(APP_SRC.indexOf('class="hist-game-row"') - 1200, APP_SRC.indexOf('class="hist-game-row"') + 400);
  // Locator updated 2026-09-12 (XSS-HARDEN): the score fields are now
  // coerced at the render boundary — `${numHtml(g.awayScore)}`. The optional
  // `numHtml(` prefix keeps this binding to the score TOKEN rather than to
  // one particular spelling of it, so the orientation check keeps checking
  // orientation instead of rotting to a vacuous pass (RG-69).
  assert(/\$\{(?:numHtml\()?g\.awayScore\)?\}\s*[–-]\s*\$\{(?:numHtml\()?g\.homeScore\)?\}/.test(myWeekSrc),
    '2e: CONTROL — the per-week history row already prints awayScore first, matching its "away @ home" label. Away-first is the established convention; the sites above are the deviants');
}

// ═════════════════════════════════════════════════════════════════════════════
// [3] STRUCTURAL — the render sites with no export, plus the CSS that turns
//     DOM order into left-to-right VISUAL order.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] Structural — renderGameCard\'s .live-score block, the admin list, and the CSS…');
{
  // 3a — .matchup and .live-score are BOTH `grid-template-columns:1fr auto 1fr`.
  // That is what makes this a real visual bug rather than a DOM-order nit: the
  // two rows are stacked, three columns each, so column 1 of the score sits
  // directly under column 1 of the matchup. If the matchup's column 1 is the
  // away team and the score's column 1 is the home score, the number is
  // literally printed under the wrong team's name.
  const matchupRule   = (CSS_SRC.match(/\.matchup\{([^}]*)\}/) || [])[1] || '';
  const liveScoreRule = (CSS_SRC.match(/\.live-score\{([^}]*)\}/) || [])[1] || '';
  assert(/grid-template-columns:\s*1fr auto 1fr/.test(matchupRule),
    `3a: fixture check: .matchup is a 3-column grid (away | @ | home) — got "${matchupRule}"`);
  assert(/grid-template-columns:\s*1fr auto 1fr/.test(liveScoreRule),
    `3a: fixture check: .live-score is a 3-column grid stacked under it — got "${liveScoreRule}"`);

  // 3b — the .matchup DOM order: away block first, then the @ divider, then home.
  // Locator note (2026-09-12, BUG-4): the `.team` divs now carry an optional
  // ` team-picked` modifier, so these match the class-attribute PREFIX rather
  // than the whole literal `<div class="team away">`. The property under test
  // is unchanged — away block first, @ divider, then home.
  const matchupBlock = (APP_SRC.match(/<div class="matchup">[\s\S]*?<div class="vs-divider">[\s\S]*?<\/div>\s*<div class="team home/) || [''])[0];
  assert(/<div class="team away/.test(matchupBlock) &&
         matchupBlock.indexOf('class="team away') < matchupBlock.indexOf('class="team home'),
    '3b: fixture check: the game card renders the AWAY team in grid column 1 and HOME in column 3');

  // 3c — THE BUG, on the shared score-block source Drew named. Item 2
  // (commits 58a041c/ae9be3e/cab55be) extracted this markup OUT of an inline
  // `const liveScore = … ? \`<div class="live-score">…</div>\` : ''` ternary in
  // renderGameCard and INTO the shared renderLiveScoreBlockHTML(), now used by
  // renderGameCard AND updatePicksLiveStatusInPlace(). The old locator keyed off
  // `const liveScore = ` and the ternary shape; after the extraction that regex
  // re-bound to an unrelated region containing NEITHER score token, so the
  // orientation check passed/failed on nothing (RG-69). Bind by FUNCTION NAME to
  // the one place the score markup now lives, and demand BOTH tokens are present
  // so the locator fails LOUDLY if the markup moves again instead of rotting to a
  // vacuous pass. The two .score-num divs inside .live-score must appear
  // away-then-home so they line up under the names in the 3-column grid.
  const lsbIdx = APP_SRC.indexOf('function renderLiveScoreBlockHTML');
  const liveScoreBlock = lsbIdx >= 0
    ? (APP_SRC.slice(lsbIdx).match(/<div class="live-score">[\s\S]*?<\/div>\s*<\/div>/) || [''])[0]
    : '';
  // Locator updated 2026-09-12 (XSS-HARDEN) — see the note at 2e.
  const awayNumIdx = liveScoreBlock.search(/\$\{(?:numHtml\()?game\.awayScore\)?\}/);
  const homeNumIdx = liveScoreBlock.search(/\$\{(?:numHtml\()?game\.homeScore\)?\}/);
  assert(liveScoreBlock.length > 0 && awayNumIdx >= 0 && homeNumIdx >= 0,
    'fixture check: renderLiveScoreBlockHTML\'s .live-score block located WITH both score tokens present — a miss here means the locator has rotted (markup moved/renamed), not that orientation is fine');
  const firstNumIsAway = awayNumIdx < homeNumIdx;
  assert(firstNumIsAway,
    '3c: THE BUG — renderLiveScoreBlockHTML\'s .live-score prints the AWAY score in grid column 1, under the away team name. It currently prints homeScore first, putting each score under the OTHER team [structural — only a browser confirms the pixels, but the grid columns make the mapping deterministic]');

  // 3d — the commissioner's admin game list. Its label is "away @ home" too.
  // Scope to renderAdminGamesList specifically — a second, unrelated
  // .game-admin-meta block (the proposed-games list) appears earlier in the
  // file and carries no score.
  const adminFnIdx = APP_SRC.indexOf('function renderAdminGamesList');
  const adminMetaIdx = APP_SRC.indexOf('<div class="game-admin-meta">', adminFnIdx);
  const adminBlock = adminMetaIdx >= 0 ? APP_SRC.slice(adminMetaIdx, adminMetaIdx + 900) : '';
  assert(/FINAL/.test(adminBlock), 'fixture check: the admin game list\'s FINAL score span located');
  // Locator updated 2026-09-12 (XSS-HARDEN) — see the note at 2e.
  assert(adminBlock.search(/\$\{(?:numHtml\()?game\.awayScore\)?\}/) < adminBlock.search(/\$\{(?:numHtml\()?game\.homeScore\)?\}/),
    '3d: THE BUG — the admin game list\'s FINAL score must read AWAY–HOME to match the "away @ home" header directly above it');

  // 3e — THE GUARD THAT MAKES THIS UNREPEATABLE. Sweep every score pair in
  // app.js and chat-ui.js. Any template that interpolates homeScore and
  // awayScore adjacent to one another, separated only by a dash, is a score
  // line — and every score line in this app must read away-first, because
  // every matchup label in this app reads away-first. A new render site added
  // next season fails here the moment it is written the wrong way round.
  const CHAT_SRC = readFileSync(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  const offenders = [];
  for (const [file, src] of [['js/app.js', APP_SRC], ['js/chat-ui.js', CHAT_SRC]]) {
    // Locator updated 2026-09-12 (XSS-HARDEN) — see the note at 2e. Without
    // the optional `numHtml(` this sweep matches NOTHING and passes vacuously,
    // which is the precise failure mode this block exists to prevent.
    const re = /\$\{\s*(?:numHtml\()?\s*(?:game|g)\.(home|away)Score[^}]*\}\s*[–—-]\s*\$\{\s*(?:numHtml\()?\s*(?:game|g)\.(home|away)Score[^}]*\}/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      if (m[1] === 'home' && m[2] === 'away') {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${file}:${line}`);
      }
    }
  }
  assert(offenders.length === 0,
    `3e: GUARD — every "score–score" template in the app reads AWAY first, matching the universal "away @ home" matchup convention. Offenders: ${offenders.join(', ') || 'none'}`);
}

// ═════════════════════════════════════════════════════════════════════════════
// [4] GRADING — did wrong-oriented scores ever reach the money math?
//
// This is the question that decides the severity of the whole report. ATS
// determines who covered and therefore who owes whom. Asserted explicitly so
// the answer is on the record and STAYS ruled out.
// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Grading — calculateAtsWinner() reads by field NAME, never by render order…');
{
  // Alabama (home) +6.5, lost 7–38. Home + 6.5 = 13.5 < 38 → Notre Dame covers.
  const g = {
    homeTeam: 'Alabama', awayTeam: 'Notre Dame',
    homeScore: 7, awayScore: 38,
    lockedSpread: 6.5, spread: 6.5, status: 'final',
  };
  assert(scoring.calculateAtsWinner(g) === 'Notre Dame',
    '4a: the away blowout winner covers — grading reads game.homeScore/game.awayScore as named fields');

  // The transposed twin: identical object with the two scores swapped. It
  // grades to the OPPOSITE team, which is what a data-layer binding bug would
  // have cost. Suite [1] is what proves the app never produces this object.
  const transposed = { ...g, homeScore: 38, awayScore: 7 };
  assert(scoring.calculateAtsWinner(transposed) === 'Alabama',
    '4b: the transposed twin grades to the OPPOSITE team — quantifies exactly what a binding bug would cost, and is why suite [1] exists');

  assert(scoring.calculateAtsWinner(g) !== scoring.calculateAtsWinner(transposed),
    '4c: orientation is outcome-changing for ATS, so "display-only" is a claim that must be PROVEN by suite [1], never assumed');

  // The render layer is a pure function of the game object; it never writes
  // back. No render site in app.js assigns to homeScore/awayScore from a
  // display string, so a reversed pill cannot contaminate stored data.
  const writesFromRender = /score-num[\s\S]{0,400}?(homeScore|awayScore)\s*=/.test(APP_SRC);
  assert(!writesFromRender,
    '4d: no score-rendering block assigns back to homeScore/awayScore — the display defect is structurally incapable of writing transposed data');
}

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
