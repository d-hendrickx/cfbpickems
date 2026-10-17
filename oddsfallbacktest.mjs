/**
 * CFB Pickems - oddsfallbacktest.mjs
 * ===================================
 * W-71 (Deployment 1, batch D, 2026-10-14; DI-W71.1 .. DI-W71.8) - "FIND SPREADS": a second source for a missing spread, for the commissioner to approve.
 *
 * Drew, 2026-10-14: "If espn doesnt have a spread, it should check draft kings or another source and let you know if that is okay to include (whereas espn listed spreads are ok to include)."
 *
 * The server half (supabase/functions/odds-lookup) is proven by supabase/tests/functions/oddsLookup.twin.mjs and the W-71 block of functions.check.mjs. THIS file is the client half:
 *
 *   [A] WHAT IS MISSING   null / espn_unparsed / espn_unresolved are missing, PK (0) is not; the banner's count and the list are one function.
 *   [B] THE SIGN          signedSpreadFrom equals the game modal's own derivation (the modal's literal lines are EXECUTED against it, every case), round-trips, and refuses what it cannot place.
 *   [C] THE LABEL         ESPN / Manual / a book's name for an included line; a raw or forged string never reaches the screen.
 *   [D] CARDS AND WRITES  a server result becomes a card only if every field survives a second look; Include writes spread + favorite + source + book and NOTHING ELSE (lockedSpread untouched);
 *                         a game that gained a spread meanwhile is never overwritten.
 *   [E] THE FLOW          ESPN again first (applied with no question), then the other source (cards, NOTHING written); No thanks writes nothing; each state of DI-W71.8.
 *   [F] THE SCREEN        the controller: phases on the button, cards patched in place (no repaint), Include / No thanks through the real click dispatcher, a double tap, the quiet automatic
 *                         check (once; silent when unconfigured), demo and locked weeks hide the action.
 *   [G] THE CALL          the browser's one call into the function: ids only, every failure a closed reason word.
 *   [H] THE REAL APP      wizard Step 3 and the Games tab through minidom: the banner, the host, the three taps with a REAL ESPN-shaped payload and an injected lookup, the automatic check after a fetch,
 *                         hostile data escaped, the modal's Favorite + Margin block byte-for-byte.
 *
 * NOT COVERED HERE (a device or a key, never a test): how the cards feel under a thumb at 375 pt and the largest text size (commnavbrowsertest [H] measures the geometry in a real engine; the feel is
 * Drew's), the haptic, and whether the vendor really lists FCS games (a real key, after release).
 *
 * Run: node oddsfallbacktest.mjs
 */
import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const _log = console.log.bind(console), _err = console.error.bind(console);
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; _log('  ✅', label); } else { fail++; _err('  ❌', label, extra ? `\n     ${extra}` : ''); }
};
const tick = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)); };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const SF = await import('./js/spread-fallback.js');
const { findMissingSpreads, isSpreadMissing, signedSpreadFrom, spreadSourceLabel, cardFromResult, includePatch, espnSpreadPatches, lineText, runFindSpreads, SPREAD_COPY, KNOWN_PROVIDERS, ODDS_API_SOURCE } = SF;
const { countMissingSpreads } = await import('./js/week-wizard.js');

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const G = (gameId, homeTeam, awayTeam, over = {}) => ({ gameId, homeTeam, awayTeam, spread: null, favorite: null, spreadSource: null, oddsProvider: null, lockedSpread: null, espnEventId: null, ...over });

// ==============================================================================================================================================================================================
_log('\n[A] DI-W71.1 - what "no spread" means…');
{
  const games = [G('a', 'A', 'B'), G('b', 'C', 'D', { spreadSource: 'espn_unparsed' }), G('c', 'E', 'F', { spreadSource: 'espn_unresolved' }), G('d', 'G', 'H', { spread: 0, spreadSource: 'espn' }),
    G('e', 'I', 'J', { spread: -3.5, favorite: 'I', spreadSource: 'espn' }), G('f', 'K', 'L', { spread: 3, favorite: 'L', spreadSource: 'manual' })];
  assert(findMissingSpreads(games).map((g) => g.gameId).join() === 'a,b,c', 'A-1: null (no source), espn_unparsed and espn_unresolved are MISSING; a set spread (-3.5, +3) is not');
  assert(!isSpreadMissing(games[3]), 'A-2: PK (spread 0) is a real, set spread - never missing (CONVENTIONS #18)');
  assert(findMissingSpreads(games).length === countMissingSpreads(games), 'A-3: the list and the wizard’s own counter (countMissingSpreads) can never disagree');
  assert(isSpreadMissing(G('x', 'A', 'B', { spread: '3' })) && isSpreadMissing(G('x', 'A', 'B', { spread: NaN })) && isSpreadMissing(G('x', 'A', 'B', { spread: Infinity })) && isSpreadMissing(null) === false,
    'A-4: a string, NaN or Infinity is not a spread; no game is no problem');
  assert(findMissingSpreads(null).length === 0 && findMissingSpreads(undefined).length === 0, 'A-5: no games, no list');
}

// ==============================================================================================================================================================================================
_log('\n[B] DI-W71.6 - the sign: signedSpreadFrom IS the game modal’s derivation…');
{
  const home = 'Alabama', away = 'Georgia';
  const h = signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: home, margin: 3.5 });
  const a = signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: away, margin: 3.5 });
  const p = signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: null, margin: 0, pk: true });
  assert(h.spread === -3.5 && h.favorite === home, `B-1: the HOME team favored is a NEGATIVE spread (${JSON.stringify(h)})`);
  assert(a.spread === 3.5 && a.favorite === away, `B-2: the AWAY team favored is a POSITIVE spread (${JSON.stringify(a)})`);
  assert(p.spread === 0 && p.favorite === null, `B-3: a pick'em is 0 with NO favorite (${JSON.stringify(p)})`);
  // run the modal's OWN lines (from the source) against the helper, for every case
  const app = read('./js/app.js');
  const a0 = app.indexOf("    let spread = null, fav = null;\n    if (favPick === 'pk')");
  const a1 = app.indexOf('    // Resolve multiplier from preset or custom field', a0);
  assert(a0 > 0 && a1 > a0, 'B-4: (fixture) the modal’s derivation block is found in js/app.js');
  const block = app.slice(a0, a1);
  const modal = new Function('favPick', 'marginVal', 'ht', 'at', `${block}\n    return { spread, fav };`);
  let ok = 0, total = 0;
  for (const margin of [0.5, 1, 3, 3.5, 7, 10.5, 21, 38.5, 100]) {
    for (const side of ['home', 'away']) {
      total++;
      const m = modal(side, margin, home, away);
      const s = signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: side === 'home' ? home : away, margin });
      if (m.spread === s.spread && m.fav === s.favorite) ok++;
    }
  }
  total++; { const m = modal('pk', null, home, away); const s = signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: null, margin: 0, pk: true }); if (m.spread === s.spread && m.fav === s.favorite) ok++; }
  assert(ok === total, `B-5: for every margin and side (and PK) the helper and the modal’s own lines give the SAME spread and favorite (${ok}/${total}) - one arithmetic, two sites`);
  // round trip: spread -> favorite + margin -> spread
  const rt = (spread, favorite) => {
    const side = spread === 0 ? { pk: true, favoriteTeam: null, margin: 0 } : { pk: false, favoriteTeam: favorite, margin: Math.abs(spread) };
    return signedSpreadFrom({ homeTeam: home, awayTeam: away, ...side });
  };
  assert([[-14, home], [14, away], [-0.5, home], [0.5, away], [0, null]].every(([sp, fv]) => rt(sp, fv).spread === sp), 'B-6: spread → (favorite, margin) → spread round-trips for home, away, half points and PK');
  assert(signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: 'Auburn', margin: 3 }) === null && signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: home, margin: -3 }) === null
    && signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: home, margin: NaN }) === null && signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: '', margin: 3 }) === null
    && signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: home, margin: '3.5x' }) === null && signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: home, margin: Infinity }) === null,
    'B-7: a favorite that is neither team, a negative or non-numeric margin, and an empty favorite are all refused (null) - never a guess');
  assert(signedSpreadFrom({ homeTeam: home, awayTeam: away, favoriteTeam: home, margin: '3.5' }).spread === -3.5, 'B-8: a numeric string margin (from a form) is read as a number');
  assert(signedSpreadFrom({ homeTeam: 'X', awayTeam: 'X', favoriteTeam: 'X', margin: 3 }).spread === -3, 'B-9: when both sides share a name the HOME reading wins - deterministic, as the modal’s ordering is');
}

// ==============================================================================================================================================================================================
_log('\n[C] DI-W71.6 - the label…');
{
  assert(spreadSourceLabel(G('a', 'A', 'B', { spreadSource: 'espn' })) === 'ESPN', 'C-1: espn → ESPN');
  assert(spreadSourceLabel(G('a', 'A', 'B', { spreadSource: 'manual' })) === 'Manual', 'C-2: manual → Manual');
  for (const book of KNOWN_PROVIDERS) assert(spreadSourceLabel(G('a', 'A', 'B', { spreadSource: ODDS_API_SOURCE, oddsProvider: book })) === book, `C-3: an included ${book} line reads "${book}"`);
  assert(spreadSourceLabel(G('a', 'A', 'B', { spreadSource: ODDS_API_SOURCE, oddsProvider: '<img onerror=x>' })) === 'Manual', 'C-4: an odds_api line whose book is not one of the four reads Manual - a forged or garbled provider never reaches the screen');
  assert(spreadSourceLabel(G('a', 'A', 'B', { spreadSource: ODDS_API_SOURCE, oddsProvider: null })) === 'Manual', 'C-5: …nor does a missing one');
  assert(spreadSourceLabel(G('a', 'A', 'B')) === 'Manual' && spreadSourceLabel(null) === 'Manual' && spreadSourceLabel(G('a', 'A', 'B', { spreadSource: 'something_new' })) === 'Manual' && spreadSourceLabel(G('a', 'A', 'B', { spreadSource: 'espn_unresolved' })) === 'Manual',
    'C-6: null, an unknown source and espn_unresolved all read Manual');
  assert(spreadSourceLabel(G('a', 'A', 'B', { spreadSource: 'ESPN' })) === 'Manual', 'C-7: the source is matched exactly (case included)');
}

// ==============================================================================================================================================================================================
_log('\n[D] DI-W71.4 / DI-W71.5 / DI-W71.7 - cards and the one write…');
{
  const game = G('g1', 'Alabama', 'Georgia');
  const R = (over = {}) => ({ gameId: 'g1', provider: 'FanDuel', favorite: 'Georgia', margin: 3.5, pk: false, asOf: '2026-10-14T18:14:00Z', ...over });
  const c = cardFromResult(game, R());
  assert(c && c.provider === 'FanDuel' && c.favorite === 'Georgia' && c.margin === 3.5 && c.pk === false && c.asOf === '2026-10-14T18:14:00.000Z', `D-1: a valid result becomes a card (${JSON.stringify(c)})`);
  assert(lineText(c) === 'Georgia -3.5' && lineText(cardFromResult(game, R({ pk: true, favorite: null, margin: 0 }))) === 'PK', 'D-2: the line reads "Georgia -3.5" (the favorite, then the negative number); a pick\'em reads PK');
  const bad = [
    ['an unknown book', R({ provider: 'PointsBet' })], ['a forged book', R({ provider: '<script>' })], ['a favorite that is neither team', R({ favorite: 'Auburn' })],
    ['a favorite given in other case', R({ favorite: 'georgia' })], ['a negative margin', R({ margin: -3.5 })], ['a zero margin that is not a pick\'em', R({ margin: 0 })], ['a quarter-point margin', R({ margin: 3.25 })],
    ['a margin over 100', R({ margin: 101 })], ['a string margin', R({ margin: '3.5' })], ['NaN', R({ margin: NaN })], ['another game\'s id', R({ gameId: 'g2' })], ['no result', null],
  ];
  for (const [name, r] of bad) assert(cardFromResult(game, r) === null, `D-3: ${name} → no card`);
  assert(cardFromResult(G('g1', 'Alabama', 'Georgia', { spread: -3 }), R()) === null, 'D-4: a game that already has a spread never gets a card');
  assert(cardFromResult(game, R({ asOf: 'not a date' })).asOf === null && cardFromResult(game, R({ asOf: undefined })).asOf === null, 'D-5: an unreadable time is "no time shown", not a bad card');

  // the write
  const card = cardFromResult(game, R());
  const patch = includePatch(game, card);
  assert(JSON.stringify(Object.keys(patch).sort()) === '["favorite","oddsProvider","spread","spreadSource"]', `D-6: Include writes exactly spread, favorite, spreadSource and oddsProvider (${Object.keys(patch).join()}) - not lockedSpread, not the game’s teams, nothing else`);
  assert(patch.spread === 3.5 && patch.favorite === 'Georgia' && patch.spreadSource === 'odds_api' && patch.oddsProvider === 'FanDuel', `D-7: Georgia (AWAY) favored by 3.5 is stored as +3.5 with the favorite named - the sign came from signedSpreadFrom (${JSON.stringify(patch)})`);
  const homeCard = cardFromResult(game, R({ favorite: 'Alabama', margin: 7 }));
  assert(includePatch(game, homeCard).spread === -7, 'D-8: HOME favored is negative');
  const pkPatch = includePatch(game, cardFromResult(game, R({ pk: true, favorite: null, margin: 0 })));
  assert(pkPatch.spread === 0 && pkPatch.favorite === null && pkPatch.spreadSource === 'odds_api', 'D-9: a pick\'em is stored as 0 with no favorite');
  assert(includePatch(G('g1', 'Alabama', 'Georgia', { spread: -2 }), card) === null, 'D-10: a game that has gained a spread since the card was built is NEVER overwritten (a manual entry in between wins)');
  assert(includePatch(game, { ...card, gameId: 'zzz' }) === null && includePatch(game, { ...card, provider: 'Nope' }) === null && includePatch(game, null) === null && includePatch(null, card) === null, 'D-11: a card for another game, a forged book, no card, no game → no write');
  // ESPN again: matched by event id only
  const missing = [G('m1', 'A', 'B', { espnEventId: '4019000001' }), G('m2', 'C', 'D', { espnEventId: '4019000002' }), G('m3', 'E', 'F', { espnEventId: null }), G('m4', 'G', 'H', { espnEventId: '4019000009' })];
  const fresh = [{ espnEventId: '4019000001', spread: -6.5, favorite: 'A', spreadSource: 'espn', oddsProvider: 'Draft Kings' }, { espnEventId: '4019000002', spread: null, favorite: null, spreadSource: 'espn_unresolved' },
    { espnEventId: '4019000009', spread: 9, favorite: 'H', spreadSource: 'manual' }, { espnEventId: null, spread: -1, favorite: 'E', spreadSource: 'espn' }];
  const ps = espnSpreadPatches({ missing, fresh });
  assert(ps.length === 1 && ps[0].gameId === 'm1' && ps[0].patch.spread === -6.5 && ps[0].patch.spreadSource === 'espn' && ps[0].patch.oddsProvider === 'Draft Kings',
    `D-12: only a missing game WITH an event id whose fresh ESPN row now carries a RESOLVED ESPN line is patched (${JSON.stringify(ps.map((x) => x.gameId))}): an unresolved row, a non-ESPN row and a game with no event id are not`);
  assert(espnSpreadPatches({ missing: [G('m1', 'A', 'B', { espnEventId: 4019000001 })], fresh }).length === 1, 'D-13: ids compare as strings');
  assert(espnSpreadPatches({ missing: null, fresh: null }).length === 0, 'D-14: nothing in, nothing out');
}

// ==============================================================================================================================================================================================
_log('\n[E] DI-W71.2 / DI-W71.3 / DI-W71.7 - the flow, with every effect injected…');
{
  const mkEnv = ({ games, espn = { games: [] }, lookup = { ok: true, results: [], unmatched: 0 } } = {}) => {
    const store = new Map(games.map((g) => [g.gameId, { ...g }]));
    const writes = [], calls = { espn: 0, lookup: 0, stages: [] };
    const deps = {
      getGames: () => [...store.values()],
      fetchEspn: async () => { calls.espn++; if (espn instanceof Error) throw espn; return espn; },
      saveGame: (g) => { writes.push(g); store.set(g.gameId, g); },
      lookup: async () => { calls.lookup++; if (lookup instanceof Error) throw lookup; return lookup; },
      now: () => '2026-10-14T20:00:00.000Z', onStage: (s) => calls.stages.push(s),
    };
    return { deps, store, writes, calls };
  };
  const week = { weekId: 'w1' };
  // ESPN found everything: applied with no card, second stage skipped
  {
    const env = mkEnv({ games: [G('a', 'A', 'B', { espnEventId: '4019000001' })], espn: { games: [{ espnEventId: '4019000001', spread: -3, favorite: 'A', spreadSource: 'espn', oddsProvider: 'Draft Kings' }] } });
    const out = await runFindSpreads({ week, deps: env.deps });
    assert(out.stage1.added === 1 && out.stage1.all && env.writes.length === 1 && env.writes[0].spreadSource === 'espn' && env.calls.lookup === 0 && env.calls.stages.join() === 'espn',
      `E-1: ESPN has the line now: it is written with NO question, "Found every spread on ESPN", and the other source is never asked (writes ${env.writes.length}, lookup calls ${env.calls.lookup})`);
    assert(env.writes[0].lockedSpread === null && env.writes[0].updatedAt === '2026-10-14T20:00:00.000Z', 'E-1b: …and lockedSpread is untouched');
  }
  // fallback found: NOT applied
  {
    const results = [{ gameId: 'a', provider: 'FanDuel', favorite: 'A', margin: 3.5, pk: false, asOf: '2026-10-14T18:00:00Z' }, { gameId: 'b', provider: 'BetMGM', favorite: null, margin: 0, pk: true, asOf: null }];
    const env = mkEnv({ games: [G('a', 'A', 'B'), G('b', 'C', 'D'), G('c', 'E', 'F')], lookup: { ok: true, results, unmatched: 1 } });
    const out = await runFindSpreads({ week, deps: env.deps });
    assert(out.other.status === 'cards' && out.other.cards.length === 2 && out.other.noLine === 1 && env.writes.length === 0, `E-2: the other source has lines for two of three: TWO CARDS, ONE "no line", and NOTHING WRITTEN (invariant 1) - writes ${env.writes.length}`);
    assert(env.calls.stages.join() === 'espn,other' && env.calls.espn === 1 && env.calls.lookup === 1, 'E-3: stage order is ESPN then the other source, one call each');
  }
  // ESPN fills one; the other source is asked about the REST only
  {
    const results = [{ gameId: 'b', provider: 'FanDuel', favorite: 'C', margin: 2, pk: false, asOf: null }, { gameId: 'a', provider: 'FanDuel', favorite: 'A', margin: 9, pk: false, asOf: null }];
    const env = mkEnv({ games: [G('a', 'A', 'B', { espnEventId: '4019000001' }), G('b', 'C', 'D')], espn: { games: [{ espnEventId: '4019000001', spread: -3, favorite: 'A', spreadSource: 'espn' }] }, lookup: { ok: true, results, unmatched: 0 } });
    const out = await runFindSpreads({ week, deps: env.deps });
    assert(out.stage1.added === 1 && !out.stage1.all && out.other.cards.length === 1 && out.other.cards[0].gameId === 'b' && env.writes.length === 1,
      'E-4: ESPN fills game a; the other source’s result for a is DROPPED (a has a spread now) and only b gets a card');
  }
  // states
  const st = async (lookup, espn) => (await runFindSpreads({ week, deps: mkEnv({ games: [G('a', 'A', 'B')], lookup, espn }).deps })).other.status;
  assert(await st({ ok: false, reason: 'not_configured' }) === 'not_configured' && await st({ ok: false, reason: 'paused' }) === 'paused' && await st({ ok: false, reason: 'unsupported' }) === 'unsupported'
    && await st({ ok: false, reason: 'vendor_error' }) === 'error' && await st({ ok: false, reason: 'timeout' }) === 'error' && await st(new Error('x')) === 'error' && await st({ ok: true, results: [], unmatched: 1 }) === 'none',
    'E-5: not_configured / paused / unsupported / (vendor_error | timeout | a throw → error) / no results → none');
  assert(await st({ ok: false, reason: 'daily_limit' }) === 'daily_limit' && await st({ ok: false, reason: 'daily-limit' }) === 'error' && await st({ ok: false, reason: 'DAILY_LIMIT' }) === 'error',
    'E-5b: DI-W71.10 - daily_limit is its own state (this league has used today\'s lookups), and only the exact word is (a near miss is an error)');
  {
    const env = mkEnv({ games: [G('a', 'A', 'B')], espn: { error: 'ESPN returned 0 events' } });
    const out = await runFindSpreads({ week, deps: env.deps });
    assert(out.stage1.error && env.calls.lookup === 0 && env.writes.length === 0, 'E-6: ESPN unreachable → stop with the error (offline copy); the other source is not asked and nothing is written');
    const env2 = mkEnv({ games: [G('a', 'A', 'B')], espn: new Error('network') });
    assert((await runFindSpreads({ week, deps: env2.deps })).stage1.error, 'E-6b: a throw from the ESPN read is the same error');
  }
  {
    const env = mkEnv({ games: [G('a', 'A', 'B', { spread: -3 })] });
    const out = await runFindSpreads({ week, deps: env.deps });
    assert(out.stage1.all && env.calls.espn === 0 && env.calls.lookup === 0, 'E-7: nothing is missing → nothing is fetched (no read, no credit)');
  }
  {
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup: { ok: true, results: [], unmatched: 1 } });
    await runFindSpreads({ week, deps: env.deps, skipEspn: true });
    assert(env.calls.espn === 0 && env.calls.lookup === 1, 'E-8: skipEspn (the automatic check right after a fetch has just read ESPN) runs the other source alone');
  }
  {
    // a manual entry during the ESPN re-read wins
    const games = [G('a', 'A', 'B', { espnEventId: '4019000001' })];
    const env = mkEnv({ games, espn: { games: [{ espnEventId: '4019000001', spread: -3, favorite: 'A', spreadSource: 'espn' }] } });
    const realFetch = env.deps.fetchEspn;
    env.deps.fetchEspn = async (w) => { const r = await realFetch(w); env.store.set('a', { ...env.store.get('a'), spread: 6, favorite: 'B', spreadSource: 'manual' }); return r; };
    const out = await runFindSpreads({ week, deps: env.deps });
    assert(env.writes.length === 0 && env.store.get('a').spread === 6 && out.stage1.added === 0, 'E-9: a spread the commissioner typed while ESPN was being read is NEVER overwritten by the ESPN line');
  }
  assert((await runFindSpreads({ week: null, deps: {} })).other.status === 'skipped' && (await runFindSpreads({ week, deps: null })).other.status === 'skipped', 'E-10: no week or no deps → nothing happens');
  assert(SF.espnAddedCopy(1) === 'Added 1 spread from ESPN.' && SF.espnAddedCopy(3) === 'Added 3 spreads from ESPN.' && SF.noLineCopy(1) === 'No other source has a line for 1 game yet. Enter the spread yourself, or check again later.'
    && SF.noLineCopy(2).includes('2 games') && SF.stillNeedCopy(1) === '1 game still needs a spread.' && SF.stillNeedCopy(2) === '2 games still need a spread.' && SF.addedCopy('Georgia -3.5', 'FanDuel') === 'Spread added: Georgia -3.5 (FanDuel).',
    'E-11: the copy is the DI’s, singular and plural');
  assert(SPREAD_COPY.NOT_CONFIGURED === "Other spread sources aren't set up yet." && SPREAD_COPY.PAUSED === "Spread lookup is paused to protect this month's allowance. Enter spreads yourself for now."
    && SPREAD_COPY.ERROR === "Couldn't check other sources. Try again." && SPREAD_COPY.OFFLINE === "Couldn't fetch games — check your connection and try again." && SPREAD_COPY.QUESTION === 'Include this spread?'
    && SPREAD_COPY.NOT_ESPN === 'Not an ESPN line' && SPREAD_COPY.CHECKING_ESPN === 'Checking ESPN…' && SPREAD_COPY.CHECKING_OTHER === 'Checking other sources…' && SPREAD_COPY.ESPN_ALL === 'Found every spread on ESPN.', 'E-12: every state’s copy is exactly the DI’s');
  assert(SPREAD_COPY.DAILY_LIMIT === "This league has used today's spread lookups. Try again tomorrow, or enter the spread yourself.", 'E-12b: DI-W71.10 - the daily-limit line is exactly the coordinator\'s copy');
}

// ==============================================================================================================================================================================================
_log('\n[F] The screen controller - phases, in-place patching, the three taps…');
const { MiniDocument, MiniElement } = await import('./minidom.mjs');
if (typeof MiniElement.prototype.cloneNode !== 'function') MiniElement.prototype.cloneNode = function () { return this; };
{
  const UI = await import('./js/spread-find-ui.js');
  const doc = new MiniDocument();
  const mkEnv = ({ games, week = { weekId: 'w1', status: 'draft', dataSourceMode: 'espn_live' }, lookup, espn = { games: [] }, reduced = true } = {}) => {
    const store = new Map(games.map((g) => [g.gameId, { ...g }]));
    const log = { toasts: [], haptics: [], saves: [], repaints: 0, lookups: 0 };
    let gate = null;                                   // a promise the test can hold the lookup on
    const deps = {
      document: doc, escHtml: esc, getWeek: (id) => (id === week.weekId ? week : null), getGames: () => [...store.values()],
      saveGame: (g) => { store.set(g.gameId, g); log.saves.push(g); }, formatTime: (iso) => `T(${iso})`,
      fetchEspn: async () => espn, lookup: async () => { log.lookups++; if (gate) await gate; return typeof lookup === 'function' ? lookup() : lookup; },
      toast: (m, k) => log.toasts.push([m, k]), haptic: (k) => log.haptics.push(k), now: () => 'NOW', reducedMotion: () => reduced, repaintHost: () => { log.repaints++; paintHost(); },
    };
    const ui = UI.createSpreadFindUI(deps);
    const mount = () => { doc.body.innerHTML = `<div id="screen">${ui.hostHTML(week, [...store.values()])}</div>`; ui.bind(doc.body); };
    const paintHost = mount;
    mount();
    return { ui, deps, store, log, week, mount, hold: () => { let release; gate = new Promise((r) => { release = r; }); return () => { gate = null; release(); }; } };
  };
  const host = () => doc.querySelector('[data-spread-host]');
  const text = () => norm(host() ? host().textContent : '');
  const btn = (action, gameId) => [...doc.querySelectorAll('[data-spread-action]')].find((b) => b.getAttribute('data-spread-action') === action && (!gameId || b.getAttribute('data-game-id') === gameId));
  const R = (gameId, over = {}) => ({ gameId, provider: 'FanDuel', favorite: 'A', margin: 3.5, pk: false, asOf: '2026-10-14T18:14:00Z', ...over });

  // F-1 .. : the block and its phases
  {
    const env = mkEnv({ games: [G('a', 'A', 'B'), G('b', 'C', 'D'), G('c', 'E', 'F', { spread: -1, spreadSource: 'manual' })], lookup: { ok: true, results: [R('a'), R('b', { favorite: 'D', margin: 2 })], unmatched: 0 } });
    assert(!!host() && text() === 'Find spreads' && !btn('find').disabled, `F-1: with games missing a spread the host holds a "Find spreads" button and nothing else (${text()})`);
    const release = env.hold();
    btn('find').click();
    await tick(3);
    assert(btn('find').disabled && btn('find').getAttribute('aria-busy') === 'true' && /Checking/.test(norm(btn('find').textContent)), `F-2: tapped, the button is disabled, aria-busy, and reads "${norm(btn('find').textContent)}" (busy state, DI-W71.2)`);
    btn('find').click(); btn('find').click();
    assert(env.log.lookups <= 1, 'F-3: a second tap while a check runs does nothing (one lookup)');
    const hostNode = host();
    release(); await tick(12);
    assert(host() === hostNode, 'F-4: the answer patches INTO the existing host - the host node is the same node (no repaint, nothing jumps)');
    assert(env.log.repaints === 0, `F-5: …and the screen was not asked to repaint (repaints ${env.log.repaints}): nothing was written, so nothing around the block changed`);
    assert(doc.querySelectorAll('[data-spread-card]').length === 2, `F-6: a card per line another source has (${doc.querySelectorAll('[data-spread-card]').length})`);
    const card = doc.querySelector('[data-spread-card="a"]');
    assert(/FanDuel has A -3\.5/.test(norm(card.textContent)) && /Not an ESPN line/.test(norm(card.textContent)) && /updated T\(2026-10-14T18:14:00\.000Z\)/.test(norm(card.textContent)) && /Include this spread\?/.test(norm(card.textContent)),
      `F-7: the card names the book, the favorite and the line, says it is not an ESPN line, when it was posted, and asks (${norm(card.textContent)})`);
    assert(norm(btn('include', 'a').textContent) === 'Include' && norm(btn('decline', 'a').textContent) === 'No thanks' && /A @ B|B @ A/.test(norm(card.textContent)), 'F-8: Include and No thanks, and the card names its game');
    assert(env.log.saves.length === 0, 'F-9: INVARIANT 1 - the cards are up and NOTHING has been written');
    // No thanks
    btn('decline', 'b').click(); await tick(3);
    assert(!doc.querySelector('[data-spread-card="b"]') && env.log.saves.length === 0 && !!doc.querySelector('[data-spread-card="a"]'), 'F-10: No thanks collapses that card and writes nothing; the other card stays');
    // Include
    btn('include', 'a').click();
    await new Promise((r) => setTimeout(r, 30));
    assert(env.log.saves.length === 1 && env.log.saves[0].gameId === 'a' && env.log.saves[0].spreadSource === 'odds_api' && env.log.saves[0].oddsProvider === 'FanDuel' && env.log.saves[0].favorite === 'A' && env.log.saves[0].spread === -3.5 && env.log.saves[0].lockedSpread === null,
      `F-11: Include writes the line - A (home) favored by 3.5 is -3.5, source odds_api, book FanDuel, lockedSpread untouched (${JSON.stringify(env.log.saves[0])})`);
    assert(env.log.toasts.some(([m, k]) => m === 'Spread added: A -3.5 (FanDuel).' && k === 'success') && env.log.haptics.join() === 'light' && env.log.repaints >= 1 && !doc.querySelector('[data-spread-card="a"]'),
      `F-12: toast "Spread added: A -3.5 (FanDuel).", one light haptic, the screen repainted (the rows and the count changed), the card gone (toasts ${JSON.stringify(env.log.toasts)}, haptics ${env.log.haptics})`);
    assert(env.store.get('b').spread === null, 'F-13: the declined game is still without a spread - "No thanks" left it for the commissioner\'s own entry');
    // Find spreads again brings a declined card back
    btn('find').click(); await tick(12);
    assert(!!doc.querySelector('[data-spread-card="b"]'), 'F-14: a declined card is not remembered past the page session: Find spreads brings it back');
    // double tap on Include
    btn('include', 'b').click(); btn('include', 'b').click();
    await new Promise((r) => setTimeout(r, 30));
    assert(env.log.saves.filter((g) => g.gameId === 'b').length === 1, 'F-15: a double tap on Include writes ONCE');
  }
  // F-16: the game gained a spread while the card sat there
  {
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup: { ok: true, results: [R('a')], unmatched: 0 } });
    btn('find').click(); await tick(12);
    env.store.set('a', { ...env.store.get('a'), spread: 4, favorite: 'B', spreadSource: 'manual' });          // a manual entry in between
    btn('include', 'a').click(); await new Promise((r) => setTimeout(r, 30));
    assert(env.log.saves.length === 0 && env.store.get('a').spread === 4 && env.log.toasts.length === 1 && env.log.toasts[0][0] === 'That game has a spread now.' && env.log.haptics.length === 0, `F-16: Include on a game that gained a spread meanwhile writes NOTHING and says so once, without the success haptic (${JSON.stringify(env.log.toasts)})`);
  }
  // F-17: the quiet automatic check
  {
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup: { ok: false, reason: 'not_configured' } });
    await env.ui.autoCheck('w1'); await tick(6);
    assert(env.log.lookups === 1 && text() === 'Find spreads', 'F-17: the automatic check asked the other source once, and said NOTHING when it is not set up (the notice is for a manual tap only)');
    await env.ui.autoCheck('w1'); await tick(3);
    assert(env.log.lookups === 1, 'F-18: …and it runs ONCE per week per page session');
    btn('find').click(); await tick(12);
    assert(/aren't set up yet/.test(text()), `F-19: a manual tap, though, says "${text()}"`);
  }
  // F-19b..: N-1 - the automatic check is quiet about EVERY failure; only a commissioner-tapped Find shows the error note and Try again
  for (const [label, lookup] of [['a vendor error', { ok: false, reason: 'vendor_error' }], ['a timeout', { ok: false, reason: 'timeout' }], ['an unsupported sport', { ok: false, reason: 'unsupported' }], ['a lookup that throws', () => { throw new Error('boom'); }]]) {
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup });
    await env.ui.autoCheck('w1'); await tick(8);
    assert(env.log.lookups === 1 && text() === 'Find spreads' && !doc.querySelector('.spread-find-note') && !doc.querySelector('[data-spread-card]') && env.log.toasts.length === 0 && env.log.saves.length === 0,
      `F-19b: the automatic check asked once and said NOTHING for ${label}: no note, no Try again, no card, no toast, no write (${text()})`);
    btn('find').click(); await tick(14);
    assert(env.log.lookups === 2 && (label === 'an unsupported sport' ? /aren't set up yet/.test(text()) : /Couldn't check other sources\. Try again\./.test(text()) && !!doc.querySelector('.spread-find-note button')),
      `F-19c: ...while a TAP on Find for ${label} does say so (${text()})`);
  }
  {
    // the automatic check's whole run failing (the games read throws) is quiet too
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup: { ok: true, results: [], unmatched: 1 } });
    let n = 0; const real = env.deps.getGames;
    env.deps.getGames = (id) => { if (++n === 3) throw new Error('read failed'); return real(id); };
    await env.ui.autoCheck('w1'); await tick(8);
    assert(!doc.querySelector('.spread-find-note') && text() === 'Find spreads', `F-19d: ...and so is an automatic run that throws outright (${text()})`);
  }
  {
    // F-19e (review D-1, coordinator ruling 2026-10-14): "paused" is NOT an error. It explains why no card appears, so it IS shown after an AUTOMATIC check - calmly (a plain muted note, no
    // error styling, no Try again button, no toast, nothing written) - and the same after a tapped Find. (The quiet cases above are the errors and "not set up".)
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup: { ok: false, reason: 'paused' } });
    await env.ui.autoCheck('w1'); await tick(8);
    const note = doc.querySelector('.spread-find-note');
    assert(env.log.lookups === 1 && !!note && norm(note.textContent) === "Spread lookup is paused to protect this month's allowance. Enter spreads yourself for now." && !/spread-find-note-error/.test(note.getAttribute('class') || '') && !note.querySelector('button')
      && !doc.querySelector('[data-spread-card]') && env.log.toasts.length === 0 && env.log.saves.length === 0,
      `F-19e: an AUTOMATIC check answered paused SHOWS the paused line - calm (no error class, no Try again), no card, no toast, nothing written (${text()})`);
    btn('find').click(); await tick(14);
    assert(env.log.lookups === 2 && /Spread lookup is paused to protect this month's allowance\./.test(text()) && !doc.querySelector('.spread-find-note button'), `F-19f: …and a TAPPED Find shows the same line (${text()})`);
  }
  {
    // F-19g/h (DI-W71.10, Drew D-80): this league has used today's lookups. The AUTOMATIC check stays quiet; a TAPPED Find shows ONE calm line - muted, no error styling, NO Try again
    // button (trying again today cannot succeed), no card, no toast, nothing written. Driven through the real delegated click listener.
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup: { ok: false, reason: 'daily_limit' } });
    await env.ui.autoCheck('w1'); await tick(8);
    assert(env.log.lookups === 1 && text() === 'Find spreads' && !doc.querySelector('.spread-find-note') && !doc.querySelector('[data-spread-card]') && env.log.toasts.length === 0 && env.log.saves.length === 0,
      `F-19g: an AUTOMATIC check answered daily_limit says NOTHING: no note, no button but Find spreads, no card, no toast, no write (${text()})`);
    btn('find').click(); await tick(14);
    const note = doc.querySelector('.spread-find-note');
    assert(env.log.lookups === 2 && !!note && norm(note.textContent) === "This league has used today's spread lookups. Try again tomorrow, or enter the spread yourself."
      && /text-muted/.test(note.getAttribute('class') || '') && !/spread-find-note-error/.test(note.getAttribute('class') || '') && !note.querySelector('button') && note.getAttribute('role') === 'status'
      && doc.querySelectorAll('[data-spread-action]').length === 1 && !doc.querySelector('[data-spread-card]') && env.log.toasts.length === 0 && env.log.saves.length === 0 && env.log.haptics.length === 0,
      `F-19h: a TAPPED Find answered daily_limit shows the one calm line (muted, role=status), NO Try again button (the only action left is Find spreads itself), no card, no toast, no haptic, nothing written (${text()})`);
    assert(!btn('find').disabled && !btn('find').getAttribute('aria-busy'), 'F-19i: …and Find spreads is back to its resting state (enabled, not busy): the commissioner can still enter the spread by hand or tap again');
  }
  {
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup: { ok: true, results: [R('a')], unmatched: 0 } });
    await env.ui.autoCheck('w1'); await tick(8);
    assert(!!doc.querySelector('[data-spread-card="a"]') && env.log.saves.length === 0 && env.log.repaints === 0, 'F-20: the automatic check puts the card up quietly - no write, no repaint, no toast');
  }
  // F-21..: the states
  const stateText = async (lookup, espn) => { const env = mkEnv({ games: [G('a', 'A', 'B')], lookup, espn }); btn('find').click(); await tick(14); return { t: text(), env }; };
  assert(/Spread lookup is paused to protect this month's allowance\. Enter spreads yourself for now\./.test((await stateText({ ok: false, reason: 'paused' })).t), 'F-21: paused');
  { const r = await stateText({ ok: false, reason: 'vendor_error' }); assert(/Couldn't check other sources\. Try again\./.test(r.t) && /Try again/.test(norm(doc.querySelector('.spread-find-note button')?.textContent)), 'F-22: an error says so calmly and offers Try again'); }
  {
    // the error's own "Try again" button, tapped through the delegated listener (S-2: every new button): same action as Find spreads, a second lookup, and this time a card
    let n = 0;
    const env = mkEnv({ games: [G('a', 'A', 'B')], lookup: () => (++n === 1 ? { ok: false, reason: 'vendor_error' } : { ok: true, results: [R('a')], unmatched: 0 }) });
    btn('find').click(); await tick(14);
    const again = doc.querySelector('.spread-find-note button');
    assert(!!again && /Try again/.test(norm(again.textContent)) && again.getAttribute('data-spread-action') === 'find' && env.log.lookups === 1, 'F-22b: after an error the note offers "Try again" - the same "find" action as the main button');
    again.click(); await tick(14);
    assert(env.log.lookups === 2 && !!doc.querySelector('[data-spread-action="include"]') && !/Couldn't check/.test(text()), `F-22c: tapping Try again asks again, the error line is gone and the line found is a card to approve (${text()})`);
    assert(env.store.get('a').spread === null || env.store.get('a').spread === undefined, 'F-22d: and still nothing is written until Include');
  }
  assert(/No other source has a line for 1 game yet/.test((await stateText({ ok: true, results: [], unmatched: 1 })).t), 'F-23: no source has a line');
  assert(/Couldn't fetch games/.test((await stateText({ ok: true, results: [] }, { error: 'ESPN returned 0 events' })).t), 'F-24: ESPN unreachable shows the offline copy');
  {
    const env = mkEnv({ games: [G('a', 'A', 'B', { espnEventId: '4019000001' })], lookup: { ok: true, results: [], unmatched: 0 }, espn: { games: [{ espnEventId: '4019000001', spread: -4, favorite: 'A', spreadSource: 'espn', oddsProvider: 'Draft Kings' }] } });
    btn('find').click(); await tick(14);
    assert(env.log.saves.length === 1 && env.log.saves[0].spreadSource === 'espn' && env.log.toasts.some(([m]) => m === 'Found every spread on ESPN.') && env.log.repaints >= 1, 'F-25: ESPN fills the only missing game: written with no question, "Found every spread on ESPN." toast, screen repainted');
  }
  {
    const env = mkEnv({ games: [G('a', 'A', 'B', { espnEventId: '4019000001' }), G('b', 'C', 'D')], lookup: { ok: true, results: [], unmatched: 1 }, espn: { games: [{ espnEventId: '4019000001', spread: -4, favorite: 'A', spreadSource: 'espn' }] } });
    btn('find').click(); await tick(14);
    assert(env.log.toasts.some(([m]) => m === 'Added 1 spread from ESPN.'), 'F-26: ESPN fills one of two: "Added 1 spread from ESPN."');
  }
  // demo and past-locked hide the action
  for (const [label, week] of [['demo', { weekId: 'w1', status: 'draft', dataSourceMode: 'demo' }], ['locked', { weekId: 'w1', status: 'locked', dataSourceMode: 'espn_live' }], ['live', { weekId: 'w1', status: 'live', dataSourceMode: 'espn_live' }], ['final', { weekId: 'w1', status: 'final', dataSourceMode: 'espn_live' }]]) {
    const env = mkEnv({ games: [G('a', 'A', 'B')], week });
    assert(!btn('find') && env.ui.canRun(week) === false, `F-27: a ${label} week hides the action`);
    assert((await env.ui.find('w1')) === null && env.log.lookups === 0, `F-28: …and a ${label} week cannot be driven programmatically either`);
  }
  assert(!!(() => { const e = mkEnv({ games: [G('a', 'A', 'B')], week: { weekId: 'w1', status: 'open', dataSourceMode: 'espn_live' } }); return btn('find'); })(), 'F-29: an OPEN week can still take a spread');
  { const env = mkEnv({ games: [G('a', 'A', 'B', { spread: 1 })] }); assert(host() && text() === '', 'F-30: nothing missing → the host is empty (no button, no count)'); }
  // hostile data
  {
    const evil = '<img src=x onerror=alert(1)>';
    const env = mkEnv({ games: [G('a', evil, 'B"><script>')], lookup: { ok: true, results: [R('a', { favorite: evil }), R('zzz'), R('a', { provider: '<b>x</b>' })], unmatched: 0 } });
    btn('find').click(); await tick(12);
    const html = host().innerHTML;
    assert(!/<img|<script/.test(html) && /&lt;img/.test(html), 'F-31: hostile team names are escaped in the card and its game line');
    assert(doc.querySelectorAll('[data-spread-card]').length === 1, 'F-32: a result for a game that is not on the slate, and one with a forged book, build no card');
  }
}

// ==============================================================================================================================================================================================
_log('\n[G] The browser’s one call…');
{
  const C = await import('./js/odds-lookup-client.js');
  const noClient = await C.callOddsLookup('w1');
  assert(noClient.ok === false && noClient.reason === 'not_configured', 'G-1: with no shared backend (local PIN mode) the call answers not_configured without touching the network');
  C._setOddsLookupForTest(async (id) => ({ ok: true, results: [{ gameId: id }], unmatched: 0 }));
  assert((await C.callOddsLookup('w9')).results[0].gameId === 'w9', 'G-2: the test seam answers in the real call’s place (and is the only way a suite reaches the screen with cards)');
  C._setOddsLookupForTest(null);
  assert((await C.callOddsLookup('w1')).reason === 'not_configured', 'G-3: the seam clears');
  const src = read('./js/odds-lookup-client.js');
  assert(/body: \{ league_id: leagueId, week_id: weekId \}/.test(src) && !/\bhttps?:\/\//.test(src.replace(/\/\*[\s\S]*?\*\//g, '')) && !/apiKey|api_key|ODDS|odds-api/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/odds-lookup|OddsLookup|ODDS_?LOOKUP/g, '')),
    'G-4: the call sends IDS ONLY (league_id, week_id), holds no URL, no key and no vendor name');
  // G-5: the REAL mapping of what functions.invoke hands back (DI-W71.10 adds daily_limit to the closed set; the function answers it as HTTP 200 inside the shared envelope)
  const map = C.lookupResultFrom;
  const dl = map({ data: { ok: false, error: 'daily_limit', reason: 'daily_limit', runId: 'odds-lookup_1_x' }, error: null });
  assert(dl.ok === false && dl.reason === 'daily_limit' && Object.keys(dl).sort().join() === 'ok,reason', `G-5a: the function's daily_limit envelope (HTTP 200) reaches the screen as { ok:false, reason:'daily_limit' } - not vendor_error (${JSON.stringify(dl)})`);
  const five = map({ data: null, error: { name: 'FunctionsHttpError', message: 'Edge Function returned a non-2xx status code' } });
  assert(five.ok === false && five.reason === 'vendor_error', 'G-5b: a 500 (reserve_failed: the counter itself failed) reaches the screen as vendor_error - "Couldn\'t check other sources. Try again."');
  assert(map({ data: { ok: false, reason: 'cap' } }).reason === 'vendor_error' && map({ data: { ok: false, reason: 'daily-limit' } }).reason === 'vendor_error' && map({ data: { ok: true, skipped: 'league_paused' } }).reason === 'not_configured'
    && map({ data: { ok: true, results: [{ gameId: 'a' }], unmatched: 2 } }).results.length === 1 && map(null).reason === 'vendor_error' && map({ data: 'x' }).reason === 'vendor_error',
    'G-5c: any word outside the closed set is vendor_error; a skipped run is not_configured; ok carries its results');
  // G-6: the browser's closed set and the function's are the SAME six words, so no reason the function can give is silently turned into an error on the screen
  const words = (txt, re) => ((re.exec(txt) || [])[1] || '').split(',').map((w) => w.trim().replace(/^'|'$/g, '')).filter(Boolean).sort().join();
  const fnSrc = read('./supabase/functions/odds-lookup/index.js');
  const clientWords = words(src, /const REASONS = \[([^\]]*)\]/);
  const fnWords = words(fnSrc, /const REASONS = Object\.freeze\(\[([^\]]*)\]\)/);
  assert(clientWords === fnWords && clientWords.split(',').includes('daily_limit') && clientWords.split(',').length === 6, `G-6: the client's REASONS and the function's REASONS are the same six words, daily_limit among them (${clientWords} | ${fnWords})`);
}

// ==============================================================================================================================================================================================
_log('\n[H] THE REAL APP - wizard Step 3 and the Games tab, through minidom…');
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), clear: () => store.clear(), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
  globalThis.window = globalThis;
  globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
  globalThis.location = { origin: 'https://irbfootball.test', reload() {}, search: '', hash: '' };
  try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; } catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
  globalThis.requestAnimationFrame = (fn) => { fn(); return 1; };
  globalThis.matchMedia = () => ({ matches: false });
  globalThis.innerWidth = 390; globalThis.innerHeight = 800; globalThis.scrollTo = () => {};
  globalThis.confirm = () => { confirms++; return true; }; globalThis.prompt = () => null; globalThis.alert = () => {};
  let confirms = 0;
  if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };
  console.warn = () => {}; console.info = () => {};
  // ESPN's scoreboard, field-for-field the shape oddstest.mjs uses; a fake fetch answers any ESPN URL with it
  const DATE = '2026-09-05';
  const comp = (id, side, loc, ab, mascot) => ({ id, homeAway: side, score: '0', team: { id, location: loc, name: mascot, abbreviation: ab, displayName: `${loc} ${mascot}`, shortDisplayName: loc } });
  const evt = (n, home, away, odds) => ({ id: `40190000${String(n).padStart(2, '0')}`, date: `${DATE}T19:00:00Z`, name: `${away.loc} at ${home.loc}`, shortName: `${away.ab} @ ${home.ab}`,
    status: { type: { name: 'STATUS_SCHEDULED', detail: '3:00 PM ET', completed: false } },
    competitions: [{ id: `40190000${String(n).padStart(2, '0')}`, date: `${DATE}T19:00:00Z`, competitors: [comp(`${n}h`, 'home', home.loc, home.ab, home.mascot), comp(`${n}a`, 'away', away.loc, away.ab, away.mascot)],
      venue: { fullName: 'Test Stadium', address: { city: 'Testville', state: 'CA' } }, ...(odds ? { odds: [odds] } : {}) }] });
  const ALA = { loc: 'Alabama', ab: 'ALA', mascot: 'Crimson Tide' }, GA = { loc: 'Georgia', ab: 'UGA', mascot: 'Bulldogs' }, TEX = { loc: 'Texas', ab: 'TEX', mascot: 'Longhorns' }, OU = { loc: 'Oklahoma', ab: 'OU', mascot: 'Sooners' };
  const dk = (details, homeFav) => ({ provider: { id: '100', name: 'Draft Kings' }, details, homeTeamOdds: { favorite: homeFav }, awayTeamOdds: { favorite: !homeFav } });
  let espnEvents = [];
  let fetches = 0;
  globalThis.fetch = async () => { fetches++; return { ok: true, status: 200, json: async () => ({ events: espnEvents }) }; };

  const INDEX = read('./index.html');
  const bodyHtmlOf = (html) => html.slice(html.indexOf('<body'), html.indexOf('</body>')).replace(/<script[\s\S]*?<\/script>/g, '').replace(/^<body[^>]*>/, '');
  const freshDoc = () => { const d = new MiniDocument(); d.body.innerHTML = bodyHtmlOf(INDEX); return d; };
  globalThis.document = freshDoc();
  const app = await import('./js/app.js');
  const storage = await import('./js/storage.js');
  const dm = await import('./js/data-model.js');
  const OC = await import('./js/odds-lookup-client.js');

  let WK = 'wk_sf', seedN = 0;
  const seed = ({ status = 'draft', mode = 'espn_live', games = null, blurb = 'Week 5 is here, bring your A game.' } = {}) => {
    store.clear(); globalThis.document = freshDoc(); WK = 'wk_sf' + (++seedN);
    storage.setSession(null, true, false);
    storage.saveWeek({ ...dm.createWeek('2026', 5, DATE, '2026-09-06'), weekId: WK, status, dataSourceMode: mode, blurb });
    storage.setActiveWeekId(WK);
    const ko = `${DATE}T19:00:00.000Z`;
    for (const g of (games || [
      { gameId: 'g_ala', homeTeam: 'Alabama', awayTeam: 'Georgia', homeMascot: 'Crimson Tide', awayMascot: 'Bulldogs', espnEventId: '4019000001' },
      { gameId: 'g_tex', homeTeam: 'Texas', awayTeam: 'Oklahoma', homeMascot: 'Longhorns', awayMascot: 'Sooners', espnEventId: '4019000002' },
      { gameId: 'g_man', homeTeam: 'Purdue', awayTeam: 'Indiana', espnEventId: null },
      { gameId: 'g_set', homeTeam: 'Iowa', awayTeam: 'Nebraska', spread: -2.5, favorite: 'Iowa', spreadSource: 'manual' },
    ])) storage.saveGame({ ...dm.createGame(WK, { kickoff: ko, spread: null, kickoffConfirmed: true, ...g }), gameId: g.gameId });
    OC._setOddsLookupForTest(null);
  };
  const wkGames = () => storage.getGames(WK);
  const gameOf = (id) => wkGames().find((g) => g.gameId === id);
  const body = () => document.getElementById('week-wizard-body');
  const stepNow = () => { const m = /Step (\d+) of/.exec(norm(document.getElementById('week-wizard-step-tracker')?.textContent)); return m ? Number(m[1]) : null; };
  const toasts = () => [...document.querySelectorAll('#toast-container .toast')].map((t) => norm(t.textContent));
  const openWizardAtStep3 = () => {
    app._openWeekWizardSheetForTest();
    let g = 0; while (stepNow() !== 3 && g++ < 6) { const b = body().querySelector(stepNow() < 3 ? '#wiz-step' + stepNow() + '-next' : '#wiz-step' + stepNow() + '-back'); if (!b) break; b.click(); }
    return stepNow() === 3;
  };
  const hostBtn = (action, gameId) => [...document.querySelectorAll('[data-spread-action]')].find((b) => b.getAttribute('data-spread-action') === action && (!gameId || b.getAttribute('data-game-id') === gameId));
  const settle = async (ms = 40) => { for (let i = 0; i < 20; i++) await tick(4); await new Promise((r) => setTimeout(r, ms)); await tick(6); };
  const R = (gameId, over = {}) => ({ gameId, provider: 'FanDuel', favorite: 'Georgia', margin: 3.5, pk: false, asOf: '2026-10-14T18:14:00Z', ...over });

  // H-1: Step 3 shows the banner count and the button
  seed();
  assert(openWizardAtStep3(), 'H-1: (fixture) the wizard is on Step 3, Confirm slate + spreads');
  const missingNow = SF.findMissingSpreads(wkGames()).length;
  const bannerText = norm(body().querySelector('.warning-box')?.textContent);
  assert(missingNow === 3 && bannerText.includes('3') && !!body().querySelector('[data-spread-host]') && norm(hostBtn('find')?.textContent) === 'Find spreads',
    `H-2: Step 3 shows the existing count line (${JSON.stringify(bannerText)}) AND a "Find spreads" button under it - the banner count (${missingNow}) is the list’s length`);
  assert(body().querySelectorAll('.week-wizard-game-row').length === 4, 'H-3: the slate’s rows are untouched (four)');

  // H-4: tap Find spreads (the real dispatcher) with ESPN carrying one of the three missing lines, and the other source carrying the rest
  espnEvents = [evt(1, ALA, GA, dk('UGA -4.5', false)), evt(2, TEX, OU, null)];            // Alabama v Georgia: Georgia (away) -4.5. Texas v Oklahoma: no odds yet.
  OC._setOddsLookupForTest(async () => ({ ok: true, results: [R('g_tex', { favorite: 'Texas', margin: 6 }), R('g_man', { favorite: 'Indiana', margin: 2.5, provider: 'DraftKings' })], unmatched: 0 }));
  fetches = 0;
  hostBtn('find').click();
  await settle();
  assert(fetches >= 1, `H-4: tapping Find spreads re-reads ESPN (fetches ${fetches})`);
  const ala = gameOf('g_ala');
  assert(ala.spread === 4.5 && ala.favorite === 'Georgia' && ala.spreadSource === 'espn' && ala.oddsProvider === 'Draft Kings' && ala.lockedSpread === null,
    `H-5: the ESPN re-read WROTE Alabama v Georgia from ESPN’s own line (Georgia away favored by 4.5 = +4.5, source espn, Draft Kings) with NO question (${JSON.stringify({ s: ala.spread, f: ala.favorite, src: ala.spreadSource })})`);
  assert(toasts().includes('Added 1 spread from ESPN.'), `H-6: …and said so once (${JSON.stringify(toasts())})`);
  assert(gameOf('g_tex').spread === null && gameOf('g_man').spread === null, 'H-7: INVARIANT 1 - the other source’s two lines are CARDS; neither game has been written');
  const cardsUp = [...document.querySelectorAll('[data-spread-card]')].map((c) => c.getAttribute('data-spread-card')).sort().join();
  assert(cardsUp === 'g_man,g_tex', `H-8: two cards are up in Step 3 (${cardsUp}); the banner now counts the two still missing (${SF.findMissingSpreads(wkGames()).length})`);
  assert(/Texas -6/.test(norm(document.querySelector('[data-spread-card="g_tex"]').textContent)) && /DraftKings has Indiana -2\.5/.test(norm(document.querySelector('[data-spread-card="g_man"]').textContent)), 'H-9: each card names its book, favorite and line');
  // Include the Texas card; No thanks the Purdue one
  hostBtn('include', 'g_tex').click();
  await settle(260);
  const tex = gameOf('g_tex');
  assert(tex.spread === -6 && tex.favorite === 'Texas' && tex.spreadSource === 'odds_api' && tex.oddsProvider === 'FanDuel' && tex.lockedSpread === null && SF.spreadSourceLabel(tex) === 'FanDuel',
    `H-10: Include wrote Texas v Oklahoma: Texas (home) favored by 6 = -6, source odds_api, FanDuel, lockedSpread untouched (${JSON.stringify({ s: tex.spread, f: tex.favorite, src: tex.spreadSource, p: tex.oddsProvider })})`);
  assert(app.isSpreadSignConsistentWithFavorite(tex) && app.isSpreadSignConsistentWithFavorite(ala), 'H-11: the included line passes the guard the LOCK uses (the sign and the favorite agree) - so the lock will freeze it');
  assert(toasts().includes('Spread added: Texas -6 (FanDuel).'), 'H-12: toast "Spread added: Texas -6 (FanDuel)."');
  assert(stepNow() === 3 && norm(body().querySelector('.warning-box')?.textContent).includes('1'), `H-13: the step repainted in place on the same step with the count down to one (${norm(body().querySelector('.warning-box')?.textContent)})`);
  hostBtn('decline', 'g_man').click();
  await settle(260);
  assert(gameOf('g_man').spread === null && !document.querySelector('[data-spread-card="g_man"]'), 'H-14: No thanks wrote nothing and the card went');
  // the Next gate: a game is lined only after Include or a manual entry
  assert(SF.findMissingSpreads(wkGames()).map((g) => g.gameId).join() === 'g_man', 'H-15: the game left without a spread is still counted missing (the Step 3 gate / Step 6 checklist count it until Include or a manual entry)');
  // Find spreads again: ESPN has nothing new; the same card comes back
  hostBtn('find').click();
  await settle();
  assert(!!document.querySelector('[data-spread-card="g_man"]'), 'H-16: Find spreads again offers the declined card once more');
  app._weekWizardSessionForTest();

  // H-17: not configured / error copy through the real screen
  seed(); openWizardAtStep3(); espnEvents = [];
  OC._setOddsLookupForTest(async () => ({ ok: false, reason: 'not_configured' }));
  fetches = 0;
  hostBtn('find').click(); await settle();
  assert(/ESPN returned 0 events|Couldn't fetch games/.test(norm(body().querySelector('[data-spread-host]').textContent)) || /aren't set up yet/.test(norm(body().querySelector('[data-spread-host]').textContent)),
    `H-17: with ESPN empty and no key: the block shows a calm line (${norm(body().querySelector('[data-spread-host]').textContent)})`);
  espnEvents = [evt(1, ALA, GA, null), evt(2, TEX, OU, null)];
  hostBtn('find').click(); await settle();
  assert(/Other spread sources aren't set up yet\./.test(norm(body().querySelector('[data-spread-host]').textContent)), `H-18: ESPN answers with no lines and the lookup is not configured: "Other spread sources aren't set up yet." (${norm(body().querySelector('[data-spread-host]').textContent)})`);
  assert(SF.findMissingSpreads(wkGames()).length === 3, 'H-19: and everything else still works - nothing was written');

  // H-20: the automatic check after Fetch Games (Step 2), once
  seed({ games: [] }); app._openWeekWizardSheetForTest();
  let lookups = 0;
  OC._setOddsLookupForTest(async () => { lookups++; return { ok: true, results: [], unmatched: 2 }; });
  espnEvents = [evt(1, ALA, GA, null), evt(2, TEX, OU, null)];
  let g2 = 0; while (stepNow() !== 2 && g2++ < 4) { const b = body().querySelector(stepNow() === 1 ? '#wiz-step1-create' : '#wiz-step' + stepNow() + '-back'); if (!b) break; b.click(); }
  assert(stepNow() === 2, 'H-20: (fixture) the wizard is on Step 2, Populate games');
  body().querySelector('#wiz-fetch-apply-btn').click();
  await settle();
  assert(wkGames().length >= 1 && lookups === 1, `H-21: Fetch Games added games with no line and the automatic check asked the other source ONCE (games ${wkGames().length}, lookups ${lookups})`);

  // H-22: the Games tab
  seed(); espnEvents = [evt(1, ALA, GA, dk('UGA -4.5', false))];
  OC._setOddsLookupForTest(async () => ({ ok: true, results: [R('g_tex', { favorite: 'Texas', margin: 6 })], unmatched: 0 }));
  globalThis.navigateTo('commissioner');
  app.setCommTab('games', { source: 'tap' });
  const comm = document.getElementById('page-commissioner');
  const sec = comm.querySelector('#games-spreads');
  assert(!!sec && /3 games still need a spread\./.test(norm(sec.textContent)) && !!sec.querySelector('[data-spread-host]') && !!sec.closest('#games-section'),
    `H-22: the Games list's SUMMARY AREA (inside #games-section, under the summary line) holds the entry while games are missing a line: "${norm(sec?.textContent)}"`);
  assert(![...comm.querySelectorAll('.admin-section[data-comm-tab="games"]')].some((x) => /^Spreads$/.test(norm(x.querySelector('.admin-section-title')?.textContent))), 'H-22b: and there is no separate "Spreads" card any more (W-69: one games list)');
  const find2 = comm.querySelector('[data-spread-host] [data-spread-action="find"]');
  find2.click(); await settle();
  assert(gameOf('g_ala').spreadSource === 'espn' && gameOf('g_tex').spread === null && !!document.querySelector('[data-spread-card="g_tex"]'), 'H-23: Find spreads on the Games tab: ESPN’s line written, the other source’s line offered as a card');
  app._spreadFindUIForTest().stateFor(WK);
  // H-24: Build slate triggers the quiet check once
  seed({ games: [] }); espnEvents = [evt(1, ALA, GA, null), evt(2, TEX, OU, null)];
  let l2 = 0; OC._setOddsLookupForTest(async () => { l2++; return { ok: false, reason: 'not_configured' }; });
  globalThis.navigateTo('commissioner'); app.setCommTab('games', { source: 'tap' });
  document.getElementById('comm-build-slate-btn')?.click(); await settle();
  assert(l2 === 1, `H-24: Build slate ran the quiet check once (${l2})`);

  // H-25: demo / locked weeks
  seed({ mode: 'demo' }); openWizardAtStep3();
  assert(!hostBtn('find'), 'H-25: a demo week’s Step 3 has no Find spreads');
  seed({ status: 'locked' }); globalThis.navigateTo('commissioner'); app.setCommTab('games', { source: 'tap' });
  assert(![...document.querySelectorAll('[data-spread-action="find"]')].length, 'H-26: a locked week has no Find spreads on the Games tab');

  // H-27: hostile data through the real screens
  const evil = '<img src=x onerror=alert(1)>';
  seed({ games: [{ gameId: 'g_ev', homeTeam: evil, awayTeam: 'Georgia' }] });
  OC._setOddsLookupForTest(async () => ({ ok: true, results: [{ gameId: 'g_ev', provider: 'FanDuel', favorite: evil, margin: 3, pk: false, asOf: null }], unmatched: 0 }));
  espnEvents = [];
  openWizardAtStep3(); hostBtn('find').click(); await settle();
  // ESPN is empty so stage 1 errors; drive the quiet path instead
  app._spreadFindUIForTest().stateFor(WK).autoRan = false; await app._spreadFindUIForTest().autoCheck(WK); await settle();
  const hh = body().innerHTML;
  // The check is on the DOM, not on the serialized text: W-69's Remove button carries the name in an aria-label, and a serializer writes a decoded `<` inside an ATTRIBUTE value raw (harmless there; it is no element).
  assert(!body().querySelector('img') && !body().querySelector('[onerror]') && /&lt;img/.test(hh), `H-27: a hostile team name is escaped in Step 3 and its card: no <img> element and no onerror attribute exists, and the name is shown as text (img elements ${body().querySelectorAll('img').length}, escaped text ${/&lt;img/.test(hh)}, cards ${body().querySelectorAll('[data-spread-card]').length})`);

  // ============================================================================================================================================================================
  // H-34..: W-69's rows (the merge wiring, DI-W71.2): the Games list's summary entry, and a per-row "Find spread"
  const GL = await import('./js/games-list.js');
  {
    const slateRow = { onSlate: true, key: 'k', slateGame: { gameId: 'x' }, game: { gameId: 'x' } };
    assert(JSON.stringify(GL.rowActionNames(slateRow)) === '["edit","remove"]' && JSON.stringify(GL.rowActionNames(slateRow, { pastDraft: true })) === '["edit","unlock","remove"]',
      'H-34: (pure) a slate row\'s actions are exactly what W-69 had when the new option is absent');
    assert(JSON.stringify(GL.rowActionNames(slateRow, { findSpread: true })) === '["find-spread","edit","remove"]' && JSON.stringify(GL.rowActionNames({ onSlate: false, suggested: '' }, { findSpread: true })) === '["add"]',
      'H-34b: (pure) "find-spread" comes first on a slate row that asks for it, and a NOT-on-slate row never offers it');
  }
  seed(); espnEvents = [evt(7, { loc: 'Yale', ab: 'YAL', mascot: 'Bulldogs' }, { loc: 'Zed', ab: 'ZED', mascot: 'Zebras' }, null)];      // ESPN answers, with an unrelated game: the re-read succeeds and finds no line for the slate
  let gate = null;
  OC._setOddsLookupForTest(async () => { if (gate) await gate; return { ok: true, results: [R('g_tex', { favorite: 'Texas', margin: 6 })], unmatched: 0 }; });
  globalThis.navigateTo('commissioner'); app.setCommTab('games', { source: 'tap' });
  const gsec = document.getElementById('games-section');
  const rowOf = (needle) => [...gsec.querySelectorAll('.games-row')].find((r) => norm(r.textContent).includes(needle));
  const rowFind = (needle) => rowOf(needle)?.querySelector('[data-action="row-find-spread"]') || null;
  assert(!!gsec && gsec.querySelectorAll('.games-row').length === 4, `H-35: (fixture) the Games list is up with its four rows (${gsec && gsec.querySelectorAll('.games-row').length})`);
  assert(!!rowFind('Alabama') && !!rowFind('Texas') && !!rowFind('Purdue') && !rowFind('Iowa'), 'H-36: the three slate games WITHOUT a spread each offer "Find spread" on their row; the one with a spread (Iowa) does not');
  const tb = rowFind('Texas');
  assert(norm(tb.textContent) === 'Find spread' && tb.getAttribute('aria-label') === 'Find spread Oklahoma @ Texas' && [...rowOf('Texas').querySelector('.games-row-actions').children].map((c) => c.getAttribute('data-action')).join() === 'row-find-spread,row-edit,row-remove',
    `H-37: the button reads "Find spread", names its game for a screen reader, and sits first in the row's actions (${[...rowOf('Texas').querySelector('.games-row-actions').children].map((c) => c.getAttribute('data-action')).join()})`);
  const sigsBefore = [...gsec.querySelectorAll('.games-row')].map((r) => r.getAttribute('data-sig')).join();
  // the tap, through the section's delegated listener, with the lookup held so the busy state can be read
  let release; gate = new Promise((r) => { release = r; });
  tb.click();
  await settle(10);
  const busyBtn = rowFind('Texas');
  assert(busyBtn.disabled === true && busyBtn.getAttribute('aria-busy') === 'true' && norm(busyBtn.textContent) === 'Checking other sources…',
    `H-38: while the lookup runs the TAPPED row button is disabled, aria-busy and reads the phase ("${norm(busyBtn.textContent)}")`);
  assert(norm(hostBtn('find')?.textContent) === 'Checking other sources…' && hostBtn('find')?.disabled === true, 'H-39: …and the summary entry shows the same run (one action, two doors)');
  assert([...gsec.querySelectorAll('.games-row')].map((r) => r.getAttribute('data-sig')).join() === sigsBefore, 'H-40: no row\'s change signature moved while it ran: nothing flips (the busy state is on the button, not in the row\'s markup)');
  release(); gate = null;
  await settle(40);
  const doneBtn = rowFind('Texas');
  assert(doneBtn && doneBtn.disabled === false && !doneBtn.hasAttribute('aria-busy') && norm(doneBtn.textContent) === 'Find spread', 'H-41: when the answer is in the button is back to "Find spread", enabled');
  assert(!!gsec.querySelector('#games-spreads [data-spread-card="g_tex"]') && gameOf('g_tex').spread === null, 'H-42: the line found is a CARD in the summary entry (naming its game) and nothing has been written (invariant 1)');
  // Include from the Games tab: the section is patched IN PLACE (the node, its scroll and filters survive), the count drops, the row's button goes and the row names the book
  gsec.setAttribute('data-planted', 'yes');
  const countBefore = norm(gsec.querySelector('#games-spreads [data-bind="spread-count"]')?.textContent);
  hostBtn('include', 'g_tex').click();
  await settle(260);
  const gsec2 = document.getElementById('games-section');
  assert(gsec2 === gsec && gsec2.getAttribute('data-planted') === 'yes', 'H-43: Include on the Games tab patched the section in place: the same node, not a full Comm repaint (W-69\'s invariant: scroll, filters and focus survive)');
  const countAfter = norm(gsec2.querySelector('#games-spreads [data-bind="spread-count"]')?.textContent);
  assert(countBefore === '3 games still need a spread.' && countAfter === '2 games still need a spread.', `H-44: the entry's count line went ${JSON.stringify(countBefore)} -> ${JSON.stringify(countAfter)}`);
  assert(!rowFind('Texas') && /FanDuel/.test(norm(rowOf('Texas').querySelector('.games-row-src')?.textContent)) && /-6/.test(norm(rowOf('Texas').textContent)),
    `H-45: the Texas row lost its "Find spread" and now shows the line with the book's name (${norm(rowOf('Texas').querySelector('.games-row-meta')?.textContent)})`);
  // no game missing: the entry and every row button go (patched, not repainted)
  for (const id of ['g_ala', 'g_man']) storage.saveGame({ ...gameOf(id), spread: -1, favorite: gameOf(id).homeTeam, spreadSource: 'manual' });
  gsec2.querySelector('[data-seg="all"]').click(); await settle(20);
  assert(norm(gsec2.querySelector('#games-spreads').textContent) === '' && gsec2.querySelectorAll('[data-action="row-find-spread"]').length === 0, 'H-46: with every spread set the entry and the row buttons are gone after the next patch');
  // a week that cannot take a spread (demo, locked) offers neither
  for (const [label, over] of [['demo', { mode: 'demo' }], ['locked', { status: 'locked' }]]) {
    seed(over); globalThis.navigateTo('commissioner'); app.setCommTab('games', { source: 'tap' });
    const gs = document.getElementById('games-section');
    assert(gs && gs.querySelectorAll('[data-action="row-find-spread"]').length === 0 && norm(gs.querySelector('#games-spreads')?.textContent) === '', `H-47: a ${label} week offers no row button and no summary entry`);
  }
  // N-4 / I-3: the source label on Step 3's rows and on the Games rows comes from the ONE function (a forged source reads Manual)
  seed({ games: [
    { gameId: 'l_espn', homeTeam: 'Alabama', awayTeam: 'Georgia', spread: -3, favorite: 'Alabama', spreadSource: 'espn' },
    { gameId: 'l_man', homeTeam: 'Texas', awayTeam: 'Oklahoma', spread: -4, favorite: 'Texas', spreadSource: 'manual' },
    { gameId: 'l_odds', homeTeam: 'Purdue', awayTeam: 'Indiana', spread: -5, favorite: 'Purdue', spreadSource: 'odds_api', oddsProvider: 'FanDuel' },
    { gameId: 'l_forged', homeTeam: 'Iowa', awayTeam: 'Nebraska', spread: -6, favorite: 'Iowa', spreadSource: 'evil <b>x</b>', oddsProvider: 'Totally Real Book' },
  ] });
  openWizardAtStep3();
  const lab = (needle) => norm([...body().querySelectorAll('.week-wizard-game-row')].find((r) => norm(r.textContent).includes(needle))?.querySelector('.games-row-src')?.textContent);
  assert(lab('Alabama') === 'ESPN' && lab('Texas') === 'Manual' && lab('Purdue') === 'FanDuel' && lab('Iowa') === 'Manual', `H-48: N-4 - Step 3's rows show where each line came from: ${JSON.stringify([lab('Alabama'), lab('Texas'), lab('Purdue'), lab('Iowa')])} (a forged source reads Manual)`);
  app._weekWizardSessionForTest();
  globalThis.navigateTo('commissioner'); app.setCommTab('games', { source: 'tap' });
  const gl = document.getElementById('games-section');
  const glab = (needle) => norm([...gl.querySelectorAll('.games-row')].find((r) => norm(r.textContent).includes(needle))?.querySelector('.games-row-src')?.textContent);
  assert(glab('Alabama') === 'ESPN' && glab('Texas') === 'Manual' && glab('Purdue') === 'FanDuel' && glab('Iowa') === 'Manual', `H-49: I-3 - the Games rows say the same through the same function: ${JSON.stringify([glab('Alabama'), glab('Texas'), glab('Purdue'), glab('Iowa')])}`);

  // H-28: the modal's Favorite + Margin block, byte for byte (AD-03 stays)
  const appSrc = read('./js/app.js');
  const MODAL_SELECT = `        <select class="form-select" id="m-spread-fav">
          <option value="">— Favorite —</option>
          <option value="home"\${initFav===game?.homeTeam?' selected':''}>Home favored</option>
          <option value="away"\${initFav===game?.awayTeam?' selected':''}>Away favored</option>
          <option value="pk"\${game?.spread===0?' selected':''}>Pick'em (PK)</option>
        </select>
        <input class="form-input" id="m-spread-margin" type="number" step="0.5" min="0" placeholder="margin (positive)" value="\${initMargin}" />`;
  const MODAL_DERIVE = `    let spread = null, fav = null;
    if (favPick === 'pk') { spread = 0; fav = null; }
    else if (favPick === 'home' && marginVal !== null && !isNaN(marginVal)) { spread = -marginVal; fav = ht; }
    else if (favPick === 'away' && marginVal !== null && !isNaN(marginVal)) { spread = marginVal; fav = at; }`;
  assert(appSrc.includes(MODAL_SELECT) && appSrc.includes(MODAL_DERIVE), 'H-28: the game modal’s Favorite + Margin markup and its signed derivation are byte-for-byte what they were (AD-03: the spread entry is unchanged; this batch added no input)');
  assert(!/m-spread-(fav|margin)/.test(read('./js/spread-find-ui.js') + read('./js/spread-fallback.js')) && !/type="number"/.test(read('./js/spread-fallback.js')), 'H-29: the new surface has NO spread input of any kind - no signed number is ever typed or shown as an input');
  assert(!/\bconfirm\(/.test(read('./js/spread-find-ui.js') + read('./js/spread-fallback.js') + read('./js/odds-lookup-client.js')) && confirms === 0, 'H-30: no browser dialog anywhere in the new flow');
  const GLSRC = read('./js/games-list.js');
  const appCalls = (appSrc.match(/SF\.spreadSourceLabel\(/g) || []).length;
  assert(!/game\.spreadSource==='espn'\?'\(ESPN\)':'\(Manual\)'|game\.spreadSource==='espn'\?'ESPN':'Manual'/.test(appSrc)
    && appCalls === 2 && /SF\.spreadSourceLabel\(d\)/.test(appSrc) && /SF\.spreadSourceLabel\(g\)/.test(appSrc)
    && !/import \{[^}]*\bspreadSourceLabel\b[^}]*\} from '\.\/games-list\.js'/.test(appSrc)
    && !/export function spreadSourceLabel/.test(GLSRC) && /import \{ spreadSourceLabel, SPREAD_COPY \} from '\.\/spread-fallback\.js'/.test(GLSRC) && (GLSRC.match(/\bspreadSourceLabel\(/g) || []).length === 1,
    `H-31: ONE spreadSourceLabel (spread-fallback.js) is called at every site - the swap picker's incoming caption and Step 3's rows in app.js (${appCalls} calls), and the Games row in games-list.js (which no longer has a label function of its own: it printed an unknown source raw, which W-71 C-4 forbids); the two inline ternaries are gone`);
  const sw = read('./service-worker.js');
  assert(['spread-fallback', 'spread-find-ui', 'odds-lookup-client'].every((m) => sw.includes(`'./js/${m}.js'`)), 'H-32: the service worker precaches the three new modules (a shell one module short serves a graph that cannot resolve)');
  const loadsrc = read('./loadtest.mjs');
  assert(['spread-fallback', 'spread-find-ui', 'odds-lookup-client'].every((m) => loadsrc.includes(`'${m}'`)), 'H-33: and the module-load list names them');
}

_log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
