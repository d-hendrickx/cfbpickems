/**
 * CFB Pickems — joinnudgetest.mjs (D1 / v0.30.0, DESIGN_D1_E: the join nudge under the tease direction, and Game Day stops speaking to a non-entrant as a player; M-55 reversed, W-85)
 * ==============================================================================================================================================================================
 * Drew, D-88 (2026-10-15): "home should tease the picks of a sport you did not enter to entise you to join and give you fomo" and "Add a join nudge now".
 *
 * The Home half of the feature, proven over the REAL js/home.js, js/home-sports.js and js/gameday.js (the app-level half - joinOffers(), the repaint after a join - is joinoffertest; the browser half -
 * computed styles, a real tap through the real dispatcher, the nothing-written-on-the-first-tap proof - is joinnudgebrowsertest).
 *
 * Run:  node joinnudgetest.mjs
 *
 *   [1]  placeJoinNudges / cleanJoinOffers (the pure leaf): one nudge per offered sport, right under that sport's NEWEST card; 10 cards of a sport -> one nudge; three sports -> one per offered sport;
 *        no card in the window -> none; nothing but a card hosts one; the offers are cleaned to { dbCode, code, joinable } and nothing else.
 *   [2]  The Home feed over a CFB + NFL league, the viewer plays CFB only: Variant A (joinable: a button), Variant B (closed: text only, no button), the exact strings, the placement, the tease untouched,
 *        the nudge never counted as an ordinary entry, signed out / no offers / one-sport -> none, paging (the nudge arrives with the first card of its sport, once), hostile text inert.
 *   [3]  The dispatcher (the real Home click handler): the button is the existing go-tab with the sport, a forged sport is dropped, the closed card is not tappable.
 *   [4]  Privacy: a hostile joinOffers() entry leaves no extra field in the markup or the snapshot.
 *   [5]  Game Day, the model: the Open card for a non-entrant (the line, the Join button, no offer -> no button), Locked, Final, the late joiner; entered and signed-out cells are today's strings (goldens).
 *   [6]  THE SWEEP: every GAME_DAY_STATES row x { entered, not entered, signed out }: no first-person line is reachable for a non-entrant (the model, the collapsed markup and nowCardModel).
 *   [7]  Game Day through the real Home (the W-85 scene: CFB final, NFL open, a CFB-only member): the red card offers Join NFL picks, not Make picks; Locked drops "your picks are in".
 *   [8]  Static contract: no new Home action, the nudge is not an ordinary entry, the dep defaults to nothing offered.
 *   [9]  MUTATION KIT (S-3): scratch copies loaded in memory, each mutant must turn a NAMED check RED.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { installDom, mkHomeEnv, click, keysOf, NOW } from './d1homeenv.mjs';

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const doc = installDom();
const home = await import('./js/home.js');
const hs = await import('./js/home-sports.js');
const gd = await import('./js/gameday.js');
const fx = await import('./statsfixtures.mjs');
const E = await import('./gamedayenv.mjs');
const { calculateWeeklyResults } = await import('./js/scoring.js');

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
const strip = (html) => String(html).replace(/<[^>]*>/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── the exact words (DI-E1.7) ───────────────────────────────────────────────────────────────────────────────────
const TITLE = 'Want in?';
const BODY_A = (c) => `You're watching ${c} from the sidelines. Join to make picks and get on the ${c} standings.`;
const BODY_B = (c) => `You're watching ${c} from the sidelines. You can join when the next ${c} week opens.`;
const BUTTON = (c) => `Join ${c} picks`;

// ── the league: CFB (everyone), NFL (p3 p4 p6), an optional third sport (p2 p5); the viewer is p1 (CFB only) ───────────────────────
const CFB_ID = '11111111-1111-4111-8111-111111111111';
const NFL_ID = '22222222-2222-4222-8222-222222222222';
const NHL_ID = '33333333-3333-4333-8333-333333333333';
const ALL6 = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
const NFL_ENTRANTS = ['p3', 'p4', 'p6'];
const NHL_ENTRANTS = ['p2', 'p5'];
const shiftIso = (v, ms) => (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v) ? new Date(Date.parse(v) + ms).toISOString() : v);
const shiftAll = (o, ms) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shiftIso(v, ms)]));
function rekey(league, entrants, { prefix, compId, shiftMs = 0 }) {
  const rid = (id) => `${prefix}${id}`;
  const weeks = league.weeks.map((w) => ({ ...shiftAll(w, shiftMs), weekId: rid(w.weekId), competitionId: compId }));
  const games = league.games.map((g) => ({ ...shiftAll(g, shiftMs), gameId: rid(g.gameId), weekId: rid(g.weekId) }));
  const players = league.players.filter((p) => entrants.includes(p.playerId)).map((p) => ({ ...p }));
  const picks = league.picks.filter((p) => entrants.includes(p.playerId)).map((p) => ({ ...p, pickId: rid(p.pickId), weekId: rid(p.weekId), gameId: rid(p.gameId) }));
  const weeklyResults = weeks.filter((w) => w.status === 'final').flatMap((w) => calculateWeeklyResults(w.weekId, players, picks.filter((p) => p.weekId === w.weekId), games.filter((g) => g.weekId === w.weekId)));
  return { players, weeks, games, picks, weeklyResults };
}
function world({ nflShiftDays = 0, third = false, extraCfbGames = 0 } = {}) {
  const base = (s) => fx.buildLeague({ w2: s, calculateWeeklyResults });
  const cfbRaw = base('live');
  // W-92 (2026-10-17): related cards combine, so the CFB slice alone is under one page. `extraCfbGames` adds FINAL week-1 CFB games with no picks (they move no
  // record or rank), one result card each, for the paging case (2s/2t) that needs a FULL first page of CFB cards ahead of the older NFL ones.
  for (let i = 0; i < extraCfbGames; i++) cfbRaw.games.push(fx.mkGame({ id: `gx${i}`, weekId: 'w1', kick: new Date(Date.parse('2026-09-05T21:00:00.000Z') + i * 60e3).toISOString(), home: `Home ${i}`, away: `Away ${i}`, kind: 'cover', state: 'final' }));
  const cfb = { ...cfbRaw, weeks: cfbRaw.weeks.map((w) => ({ ...w, competitionId: CFB_ID })) };
  const nfl = rekey(base('final'), NFL_ENTRANTS, { prefix: 'n_', compId: NFL_ID, shiftMs: -nflShiftDays * 86400e3 });
  const nhl = third ? rekey(base('final'), NHL_ENTRANTS, { prefix: 'h_', compId: NHL_ID }) : null;
  const sports = [nfl, ...(nhl ? [nhl] : [])];
  const league = {
    players: cfb.players, weeks: [...cfb.weeks, ...sports.flatMap((s) => s.weeks)], games: [...cfb.games, ...sports.flatMap((s) => s.games)],
    picks: [...cfb.picks, ...sports.flatMap((s) => s.picks)], weeklyResults: [...cfb.weeklyResults, ...sports.flatMap((s) => s.weeklyResults)],
  };
  const ctx = (id, dbCode, code, s, ids) => ({ competitionId: id, dbCode, code, weekIds: s.weeks.map((w) => w.weekId), playerIds: ids, currentWeekId: s.weeks[s.weeks.length - 1].weekId, weekEntrants: Object.fromEntries(s.weeks.map((w) => [w.weekId, ids])) });
  const contexts = [ctx(CFB_ID, 'cfb', 'CFB', cfb, ALL6), ctx(NFL_ID, 'nfl', 'NFL', nfl, NFL_ENTRANTS), ...(nhl ? [ctx(NHL_ID, 'nhl', 'NHL', nhl, NHL_ENTRANTS)] : [])];
  const rosterForWeek = (w) => { const id = String(w.weekId); const ids = id.startsWith('n_') ? NFL_ENTRANTS : id.startsWith('h_') ? NHL_ENTRANTS : ALL6; return cfb.players.filter((p) => ids.includes(p.playerId)); };
  return { league, contexts, rosterForWeek, cfb, nfl, nhl };
}
const OFFER_NFL = (joinable = true) => ({ dbCode: 'nfl', code: 'NFL', joinable });
const OFFER_NHL = (joinable = true) => ({ dbCode: 'nhl', code: 'NHL', joinable });

/** A mounted Home over a world. `offers` is the app's joinOffers() answer (a function so a test can change it between paints). */
function mountFeed(M, w, { offers = [], viewer = 'p1', contexts = w.contexts, deps = {} } = {}) {
  const env = mkHomeEnv({ home: M.home }, doc, w.league, {
    viewer, read: { contexts: () => contexts, rosterForWeek: w.rosterForWeek, currentWeek: () => w.cfb.weeks[w.cfb.weeks.length - 1] },
    deps: { joinOffers: typeof offers === 'function' ? offers : () => offers, ...deps },
  });
  env.home.renderHome();
  return env;
}
/** The feed's keyed items, in order: [{ key, html }]. */
function itemsOf(container) { return container.querySelectorAll('.feed-item').map((n) => ({ key: n.getAttribute('data-card-key'), html: n.innerHTML, node: n })); }
const nudgesOf = (container) => container.querySelectorAll('.feed-join');

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// The named checks, as a function of the modules under test (the real ones, or a mutant). Returns { label: boolean }.
// ═══════════════════════════════════════════════════════════════════════════════════════════════════
async function checks(M) {
  const R = {};
  const ck = (label, ok) => { R[label] = ok === true; };

  // ── [1] the pure leaf ──────────────────────────────────────────────────────────────────────────
  {
    const card = (id, sport) => ({ kind: 'card', key: id, card: { id, sport, type: 'game.final' } });
    const feed = [card('c1', 'cfb'), card('n1', 'nfl'), card('c2', 'cfb'), card('n2', 'nfl'), card('c3', 'cfb'), card('n3', 'nfl')];
    const place = M.hs.placeJoinNudges;
    const keys = (xs) => xs.map((e) => e.key);
    const one = typeof place === 'function' ? place(feed, [OFFER_NFL()]) : feed;
    ck('1a one nudge for the offered sport, immediately after that sport\'s NEWEST card', eq(keys(one), ['c1', 'n1', 'join:nfl', 'c2', 'n2', 'c3', 'n3']));
    ck('1b the entry is { kind: join, key: join:<dbCode>, offer } and carries nothing else of the offer', (() => { const e = one.find((x) => x.kind === 'join'); return !!e && e.key === 'join:nfl' && eq(Object.keys(e).sort(), ['key', 'kind', 'offer']) && eq(e.offer, OFFER_NFL()); })());
    const ten = Array.from({ length: 10 }, (_, i) => card(`n${i}`, 'nfl'));
    ck('1c ten cards of one sport -> exactly one nudge (never one per card)', (typeof place === 'function' ? place(ten, [OFFER_NFL()]) : ten).filter((e) => e.kind === 'join').length === 1);
    const three = [card('c1', 'cfb'), card('h1', 'nhl'), card('n1', 'nfl'), card('h2', 'nhl'), card('n2', 'nfl')];
    const two = typeof place === 'function' ? place(three, [OFFER_NFL(), OFFER_NHL(false)]) : three;
    ck('1d two offered sports -> one nudge each, each under its own newest card; the played sport gets none', eq(keys(two), ['c1', 'h1', 'join:nhl', 'n1', 'join:nfl', 'h2', 'n2']));
    ck('1e an offered sport with NO card in the window gets no nudge', eq(keys(typeof place === 'function' ? place(feed, [OFFER_NHL()]) : feed), keys(feed)));
    ck('1f no offers -> the entries come back unchanged, and the input is never mutated', (() => { const copy = JSON.stringify(feed); const out = typeof place === 'function' ? place(feed, []) : feed; return eq(keys(out), keys(feed)) && JSON.stringify(feed) === copy; })());
    const mixed = [{ kind: 'news', key: 'news:1', item: { sport: 'nfl' } }, { kind: 'divider', key: 'seen-new', variant: 'new' }, { kind: 'error', key: 'home-error' }, card('n1', 'nfl'), { kind: 'divider', key: 'seen-earlier', variant: 'earlier' }];
    ck('1g only a CARD hosts the nudge: a news item, a divider or an error entry of that sport is skipped', eq(keys(typeof place === 'function' ? place(mixed, [OFFER_NFL()]) : mixed), ['news:1', 'seen-new', 'home-error', 'n1', 'join:nfl', 'seen-earlier']));
    ck('1h a non-array entries / offers argument is harmless', (() => { try { return Array.isArray(place(null, null)) && eq(keys(place(feed, 'nfl')), keys(feed)); } catch { return false; } })());
    const clean = M.hs.cleanJoinOffers;
    const dirty = [{ dbCode: 'nfl', code: 'NFL', joinable: true, picks: [{ selectedTeam: 'X' }], memberIds: ['p3'], name: 'Kevin' }, { dbCode: 'nfl', code: 'DUP', joinable: false }, { dbCode: '', code: 'X', joinable: true }, { dbCode: 'nhl' }, null, 'nfl', { dbCode: 'nhl', code: 'NHL', joinable: 'yes' }];
    const cleaned = typeof clean === 'function' ? clean(dirty) : [];
    ck('1i cleanJoinOffers keeps { dbCode, code, joinable } and nothing else; junk, a repeat sport and a non-boolean joinable are dropped or made false', eq(cleaned, [{ dbCode: 'nfl', code: 'NFL', joinable: true }, { dbCode: 'nhl', code: 'NHL', joinable: false }]));
    ck('1j cleanJoinOffers(non-array) -> []', typeof clean === 'function' && eq(clean(null), []) && eq(clean('nfl'), []) && eq(clean({}), []));
  }

  // ── [2] the Home feed ──────────────────────────────────────────────────────────────────────────
  {
    const w = world();
    const baseEnv = mountFeed(M, w, { offers: [] });
    const baseItems = itemsOf(baseEnv.container);
    ck('2-0 fixture: a CFB-only member sees NFL cards (the tease) and no nudge when nothing is offered', baseItems.some((i) => i.html.includes('data-sport="nfl"')) && nudgesOf(baseEnv.container).length === 0);

    const a = mountFeed(M, w, { offers: [OFFER_NFL(true)] });
    const aItems = itemsOf(a.container);
    const aN = nudgesOf(a.container);
    ck('2a Variant A: exactly ONE nudge, a card of the feed\'s own shell (.card.feed-card.feed-join)', aN.length === 1 && /\bcard\b/.test(aN[0].className) && /\bfeed-card\b/.test(aN[0].className));
    ck('2b the nudge sits in its own keyed item (join:nfl) directly AFTER the newest NFL card', (() => { const ks = aItems.map((i) => i.key); const at = ks.indexOf('join:nfl'); const firstNfl = aItems.findIndex((i) => i.html.includes('data-sport="nfl"') && !i.key.startsWith('join:')); return at > 0 && at === firstNfl + 1; })());
    const txt = aN.length ? strip(aN[0].innerHTML) : '';
    ck('2c Variant A words: the NFL chip, "Want in?", the body, the button', txt === `NFL ${TITLE} ${BODY_A('NFL')} ${BUTTON('NFL')}`);
    const btns = aN.length ? aN[0].querySelectorAll('button') : [];
    ck('2d Variant A has ONE button: the existing go-tab to picks with the sport, neutral tone, a light haptic', btns.length === 1 && btns[0].getAttribute('data-home-action') === 'go-tab' && btns[0].getAttribute('data-tab') === 'picks' && btns[0].getAttribute('data-sport') === 'nfl' && btns[0].getAttribute('data-haptic') === 'light' && /feed-action--neutral/.test(btns[0].className) && /\bbtn\b/.test(btns[0].className));
    ck('2e the button\'s label is the sheet\'s own label for the same code', btns.length === 1 && btns[0].textContent.trim() === BUTTON('NFL'));
    ck('2f structure: an 8 pt text group (.feed-card-text) holding the chip, the title and the body, then .feed-actions (the commissioner nudge\'s structure)', aN.length === 1 && aN[0].querySelectorAll('.feed-card-text .sport-chip').length === 1 && aN[0].querySelectorAll('.feed-card-text h3.feed-card-title').length === 1 && aN[0].querySelectorAll('.feed-card-text p.feed-card-body').length === 1 && aN[0].querySelectorAll('.feed-actions button').length === 1);
    ck('2g not gold, not a due pill: no .feed-nudge, no .badge-due, no commissioner label', aN.length === 1 && !/feed-nudge|badge-due|badge/.test(aN[0].innerHTML + aN[0].className));

    const b = mountFeed(M, w, { offers: [OFFER_NFL(false)] });
    const bN = nudgesOf(b.container);
    const bTxt = bN.length ? strip(bN[0].innerHTML) : '';
    ck('2h Variant B (closed window): one nudge with the words and NO button', bN.length === 1 && bTxt === `NFL ${TITLE} ${BODY_B('NFL')}` && bN[0].querySelectorAll('button, a, [data-home-action], [role="button"]').length === 0);
    ck('2i Variant B is plain text: not tappable (no role, no tabindex, no action on the card)', bN.length === 1 && bN[0].getAttribute('role') === null && bN[0].getAttribute('tabindex') === null && bN[0].getAttribute('data-home-action') === null && !/feed-card--tap/.test(bN[0].className));

    const stripNudge = (items) => items.filter((i) => !i.key.startsWith('join:')).map((i) => i.key + '|' + i.html);
    ck('2j THE TEASE IS UNTOUCHED: with the nudge removed the feed is exactly the feed without it (same cards, same order, same markup)', eq(stripNudge(aItems), stripNudge(baseItems)) && eq(stripNudge(itemsOf(b.container)), stripNudge(baseItems)));
    const sess = a.home._sessionForTest();
    ck('2k the nudge is not an ordinary entry: it is not among the rendered ordinary keys, the cards derived, or the new-posts count', !sess.rendered.some((k) => String(k).startsWith('join:')) && sess.heldCount === 0 && !a.container.querySelector('.home-pill'));
    ck('2l the end marker is unchanged by the nudge (caught-up / capped logic reads ordinary entries only)', (a.container.innerHTML.match(/feed-caught-up|feed-sentinel/g) || []).length === (baseEnv.container.innerHTML.match(/feed-caught-up|feed-sentinel/g) || []).length);

    const so = mountFeed(M, w, { offers: [OFFER_NFL(true)], viewer: null });
    ck('2m signed out (no viewer): no nudge even if the dep offers one', nudgesOf(so.container).length === 0);
    const one = mountFeed(M, { ...w, contexts: null }, { offers: [OFFER_NFL(true)], contexts: null });
    ck('2n a one-sport league (no contexts): no nudge', nudgesOf(one.container).length === 0);
    const bare = mkHomeEnv({ home: M.home }, doc, w.league, { viewer: 'p1', read: { contexts: () => w.contexts, rosterForWeek: w.rosterForWeek, currentWeek: () => w.cfb.weeks[w.cfb.weeks.length - 1] } });
    bare.home.renderHome();
    ck('2o the dep is optional and defaults to NOTHING offered (fail closed): a Home with no joinOffers paints no nudge', nudgesOf(bare.container).length === 0);
    const throwing = mountFeed(M, w, { offers: () => { throw new Error('boom'); } });
    ck('2p a joinOffers() that throws paints the feed with no nudge (never a blank or broken feed)', nudgesOf(throwing.container).length === 0 && itemsOf(throwing.container).length > 3);

    const w3 = world({ third: true });
    const t3 = mountFeed(M, w3, { offers: [OFFER_NFL(true), OFFER_NHL(false)] });
    const t3k = itemsOf(t3.container).map((i) => i.key);
    const t3Items = itemsOf(t3.container);
    const underOwn = (code, key) => { const at = t3k.indexOf(key); const first = t3Items.findIndex((i) => i.html.includes(`data-sport="${code}"`) && !i.key.startsWith('join:')); return at > 0 && at === first + 1; };
    ck('2q three sports: one nudge for each sport the member has not joined, each under its own newest card', t3k.filter((k) => k.startsWith('join:')).length === 2 && underOwn('nfl', 'join:nfl') && underOwn('nhl', 'join:nhl'));
    ck('2r ...and the member\'s own sport (CFB) never gets one', !t3k.includes('join:cfb'));

    // paging: the NFL cards are older than a full first page of CFB cards, so no NFL card is in the window until the next page
    const old = world({ nflShiftDays: 90, extraCfbGames: 24 });
    const pg = mountFeed(M, old, { offers: [OFFER_NFL(true)] });
    const first = itemsOf(pg.container).map((i) => i.key);
    ck('2s an offered sport with no card in the visible window gets no nudge (no tease, no cold ad)', !first.some((k) => k.startsWith('join:')) && !itemsOf(pg.container).some((i) => i.html.includes('data-sport="nfl"')));
    let later = [];
    try { for (let i = 0; i < 4; i++) pg.home.loadMore(); later = itemsOf(pg.container).map((i) => i.key); } catch { later = []; }
    const lateItems = itemsOf(pg.container);
    const nflAt = lateItems.findIndex((i) => i.html.includes('data-sport="nfl"') && !i.key.startsWith('join:'));
    ck('2t ...and when the next page brings the first NFL card the nudge arrives with it - once, under it', later.filter((k) => k.startsWith('join:')).length === 1 && later.indexOf('join:nfl') === nflAt + 1 && nflAt > 0);

    // hostile text
    const hostile = mountFeed(M, w, { offers: [{ dbCode: 'nfl', code: 'N"><img src=x onerror=alert(1)>', joinable: true }] });
    const hn = nudgesOf(hostile.container);
    const inert = (root) => root.querySelectorAll('img').length === 0 && root.querySelectorAll('*').every((el) => !el.getAttributeNames().some((n) => /^on/i.test(n))) && root.textContent.includes('onerror=alert(1)');
    ck('2u a hostile sport code is inert text: no live element, no event-handler attribute, the text shown as text', hn.length === 1 && inert(hn[0]));
    const hostileClosed = mountFeed(M, w, { offers: [{ dbCode: 'nfl', code: '<b>NFL</b>', joinable: false }] });
    ck('2v ...in Variant B too', nudgesOf(hostileClosed.container).length === 1 && nudgesOf(hostileClosed.container)[0].querySelectorAll('b').length === 0);
    const render = M.home.joinNudgeHTML;
    ck('2w joinNudgeHTML refuses to render without the injected escaper (no fallback)', typeof render === 'function' && (() => { try { render(OFFER_NFL(), {}); return false; } catch { return true; } })() && typeof render(OFFER_NFL(), { escHtml: esc }) === 'string');
    ck('2x every attribute of the markup is double-quoted', typeof render === 'function' && !/<[^>]*=\s*'/.test(render(OFFER_NFL(), { escHtml: esc }) + render(OFFER_NFL(false), { escHtml: esc })));
  }

  // ── [3] the dispatcher ─────────────────────────────────────────────────────────────────────────
  {
    const w = world();
    const a = mountFeed(M, w, { offers: [OFFER_NFL(true)] });
    const btn = nudgesOf(a.container)[0] ? nudgesOf(a.container)[0].querySelector('button') : null;
    if (btn) click(btn);
    ck('3a a real click on the button reaches onAction as go-tab { tab: picks, sport: nfl } and nothing else', a.calls.actions.length === 1 && eq(a.calls.actions[0], ['go-tab', { tab: 'picks', sport: 'nfl' }]));
    ck('3b ...with ONE light haptic (the Principles: a secondary action is light)', eq(a.calls.haptics, ['light']));
    const f = mountFeed(M, w, { offers: [OFFER_NFL(true)] });
    const fb = nudgesOf(f.container)[0] ? nudgesOf(f.container)[0].querySelector('button') : null;
    if (fb) { fb.setAttribute('data-sport', 'zzz'); click(fb); }
    ck('3c a FORGED data-sport is dropped by the dispatcher: the tap is a plain go-tab with no sport', f.calls.actions.length === 1 && eq(f.calls.actions[0], ['go-tab', { tab: 'picks' }]));
    const c = mountFeed(M, w, { offers: [OFFER_NFL(false)] });
    const card = nudgesOf(c.container)[0];
    if (card) { click(card); const tx = card.querySelector('p'); if (tx) click(tx); }
    ck('3d the closed (Variant B) card does nothing when tapped: no action, no haptic', !!card && c.calls.actions.length === 0 && c.calls.haptics.length === 0);
    ck('3e the action list is the shipped one - no new HOME_ACTION', eq([...M.home.HOME_ACTIONS], ['go-tab', 'build-slate', 'retry-news', 'retry-load', 'open-card', 'new-posts', 'gd-toggle', 'gd-pill', 'gd-more', 'gd-row', 'gd-collapse', 'gd-dashboard']));
  }

  // ── [4] privacy ────────────────────────────────────────────────────────────────────────────────
  {
    const w = world();
    const canary = { dbCode: 'nfl', code: 'NFL', joinable: true, picks: [{ playerId: 'CANARY_P', selectedTeam: 'CANARY_PICK' }], memberIds: ['CANARY_M'], name: 'CANARY_NAME', playerId: 'CANARY_ID' };
    const env = mountFeed(M, w, { offers: [canary] });
    const html = env.container.innerHTML;
    const snap = JSON.stringify(env.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: NOW }).joinOffers ?? null);
    ck('4a a hostile joinOffers() entry: none of its extra fields reaches the markup', !/CANARY/.test(html) && nudgesOf(env.container).length === 1);
    ck('4b ...or the snapshot (the offer is { dbCode, code, joinable } and nothing else)', snap === JSON.stringify([{ dbCode: 'nfl', code: 'NFL', joinable: true }]));
    const wide = JSON.stringify(env.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: NOW }));
    ck('4c ...and nothing of it is in the whole serialized snapshot', !/CANARY/.test(wide));
  }

  // ── [5] Game Day, the model ────────────────────────────────────────────────────────────────────
  const T0 = 1_000_000;
  const fmt = { time: () => 'Sun 12:00 PM', countdown: () => '2h 10m' };
  const upcoming = { game: { gameId: 'n1', homeTeam: 'Bills', awayTeam: 'Chiefs', kickoff: new Date(T0 + 130 * 60e3).toISOString(), status: 'scheduled', homeScore: null, awayScore: null }, weekId: 'w6n', sport: 'nfl', sportLabel: 'NFL', phase: { phase: 'upcoming', label: 'Sun 12:00 PM' }, ownTeam: null };
  const liveGame = { ...upcoming, game: { ...upcoming.game, status: 'live', homeScore: 7, awayScore: 3 }, phase: { phase: 'live', label: '4:12 - 3rd' } };
  const finalGame = { ...upcoming, game: { ...upcoming.game, status: 'final', homeScore: 24, awayScore: 21 }, phase: { phase: 'final', label: '' } };
  const gdIn = (state, { viewerId = 'p1', entered, joinOffer, sportCode = 'NFL' } = {}) => ({
    state, weekN: 6, weekId: 'w6n', viewerId, actionSport: 'nfl', showSport: true, now: T0, fmt,
    entries: [state === 'live' ? { ...liveGame, entered: entered !== false } : state === 'final' ? { ...finalGame, entered: entered !== false } : { ...upcoming, entered: entered !== false }],
    lockMs: T0 + 130 * 60e3, firstKickoffMs: T0 + 130 * 60e3, remaining: 3, gameTotal: 3, counts: { submittedCount: 3, totalPlayers: 6 },
    finalLine: { winnerLine: 'Kevin took Week 6, 4–0', mine: entered === false || !viewerId ? '' : '4–0', next: '' }, mineLine: '', personal: null,
    ...(entered === undefined ? {} : { entered }), ...(joinOffer ? { joinOffer } : {}), sportCode,
  });
  const body = (state, o) => M.gd.gameDayModel(gdIn(state, o)).body;
  const said = (b) => [b.line, b.next].filter(Boolean).join(' · ');                  // what the collapsed card says: the line, then (a non-entrant's) clause in the span the card folds when it is too narrow
  {
    const n = body('open-pending', { entered: false, joinOffer: OFFER_NFL(true) });
    ck('5a Open, non-entrant, joinable: the card says where he stands and the button joins', said(n) === "In 2h 10m · you're not in NFL picks yet" && n.next === "you're not in NFL picks yet" && n.action && n.action.label === 'Join NFL picks' && n.action.tab === 'picks' && n.action.tone === 'solid' && n.action.sport === 'nfl');
    const none = body('open-pending', { entered: false });
    ck('5b Open, non-entrant, NO offer: the same line without "yet" and no button', said(none) === "In 2h 10m · you're not in NFL picks" && !none.action);
    const closed = body('open-pending', { entered: false, joinOffer: OFFER_NFL(false) });
    ck('5c Open, non-entrant, the offer is not joinable: no button, no "yet"', said(closed) === "In 2h 10m · you're not in NFL picks" && !closed.action);
    const e = body('open-pending', { entered: true });
    ck('5d GOLDEN - an entrant is unchanged: "you have not picked yet" and Make picks', e.line === 'In 2h 10m · you have not picked yet' && e.action.label === 'Make picks' && e.action.tone === 'solid');
    const e2 = body('open-pending', {});
    ck('5e GOLDEN - a model handed no entered flag is the entrant\'s (every caller that predates this stays as it was)', e2.line === e.line && e2.action.label === 'Make picks');
    const so = body('open-pending', { viewerId: '' });
    ck('5f GOLDEN - signed out is unchanged: the countdown alone and Make picks', so.line === 'In 2h 10m' && so.action.label === 'Make picks');
    const part = M.gd.gameDayModel({ ...gdIn('open-pending', { entered: true }), remaining: 1 }).body;
    ck('5g GOLDEN - an entrant with some picks left is unchanged', part.line === 'In 2h 10m · you have 1 pick left');
    const lf = body('locked-far', { entered: false, joinOffer: OFFER_NFL(false) });
    ck('5h Locked, non-entrant: the countdown only - "your picks are in" is dropped', lf.line === 'In 2h 10m' && lf.type === 'message');
    ck('5i GOLDEN - Locked entrant "your picks are in"; signed out the countdown alone', body('locked-far', { entered: true }).line === 'In 2h 10m · your picks are in' && body('locked-far', { viewerId: '' }).line === 'In 2h 10m');
    const afterKick = M.gd.gameDayModel({ ...gdIn('locked-far', { entered: false }), firstKickoffMs: T0 - 60e3 }).body;
    ck('5j Locked after kickoff, non-entrant: the existing "Reveal comes as the week goes live"', afterKick.line === 'Reveal comes as the week goes live');
    const od = body('open-done', { entered: false, joinOffer: OFFER_NFL(true) });
    ck('5k "open-done" for a non-entrant is impossible by definition; if it ever arrives it is drawn as the non-entrant\'s Open card, never "You\'re in for Week 6"', od.title !== "You're in for Week 6" && said(od) === "In 2h 10m · you're not in NFL picks yet" && od.action && od.action.label === 'Join NFL picks');
    const fin = body('final', { entered: false, joinOffer: OFFER_NFL(false) });
    ck('5l Final, non-entrant: the winner line and the Results button STAY (R-2: they are the tease); no first-person line, no join button', fin.title === 'Kevin took Week 6, 4–0' && fin.line === '' && fin.action && fin.action.label === 'Results');
    ck('5m GOLDEN - a Final entrant keeps "You went 4–0"', body('final', { entered: true }).line === 'You went 4–0');
    const lv = M.gd.gameDayModel(gdIn('live', { entered: false, joinOffer: OFFER_NFL(false) }));
    ck('5n Live, non-entrant: a pill with no coverage word, no join button anywhere (the week is closed)', lv.pills.length === 1 && lv.pills[0].coverage === 'follow' && lv.body.type === 'pills' && !JSON.stringify(lv).includes('Join '));
    const late = body('open-pending', { entered: false });
    ck('5o a late joiner (plays the sport, not in this week: no offer) is told he is not in it and offered nothing', said(late) === "In 2h 10m · you're not in NFL picks" && !late.action);
    const html = M.gd.gameDayCardHTML(M.gd.gameDayModel(gdIn('open-pending', { entered: false, joinOffer: OFFER_NFL(true) })), { escHtml: esc, numHtml: (v) => String(v) });
    ck('5p the Open card\'s button is the existing go-tab with the sport, the solid tone and the medium haptic (the button it replaces)', /<button type="button" class="btn feed-action feed-action--solid gd-btn" data-home-action="go-tab" data-tab="picks" data-sport="nfl" data-haptic="medium">Join NFL picks<\/button>/.test(html));
    const hostile = M.gd.gameDayCardHTML(M.gd.gameDayModel(gdIn('open-pending', { entered: false, joinOffer: { dbCode: 'nfl', code: '<img src=x onerror=1>', joinable: true }, sportCode: '<img src=x onerror=1>' })), { escHtml: esc, numHtml: (v) => String(v) });
    ck('5q a hostile sport code is inert in the red card (line and button)', !/<img/.test(hostile) && /&lt;img/.test(hostile));
    const noOfferHtml = M.gd.gameDayCardHTML(M.gd.gameDayModel(gdIn('open-pending', { entered: false })), { escHtml: esc, numHtml: (v) => String(v) });
    ck('5r no offer -> the card has no button at all and keeps its message (two lines)', !/<button/.test(noOfferHtml) && /you're not in NFL picks/.test(strip(noOfferHtml).replace(/&#39;/g, "'")) && /gd-msg/.test(noOfferHtml));
  }

  // ── [6] the sweep ──────────────────────────────────────────────────────────────────────────────
  {
    const FIRST_PERSON = /you have|your picks|picked|didn't pick|\bMake\b|You went|You're in for|Edit picks|You're covering|You're trailing|You covered|You missed/i;
    const STATES = [...M.home.GAME_DAY_STATES];
    const cells = { entered: { entered: true }, notEntered: { entered: false, joinOffer: OFFER_NFL(true) }, notEnteredNoOffer: { entered: false }, signedOut: { viewerId: '' } };
    const bad = [];
    for (const state of STATES) {
      for (const [name, o] of Object.entries(cells)) {
        const model = M.gd.gameDayModel(gdIn(state, o));
        const text = strip(M.gd.gameDayCardHTML(model, { escHtml: esc, numHtml: (v) => String(v) })) + ' ' + JSON.stringify(model.body) + ' ' + model.header.aria;
        if (name === 'signedOut' && state === 'open-done') continue;          // a signed-out viewer is never "done": nowCardModel offers him Make your picks
        if (name.startsWith('notEntered') && FIRST_PERSON.test(text)) bad.push(`${state}/${name}: ${text.match(FIRST_PERSON)[0]}`);
        if (name === 'signedOut' && /you have|your picks|picked|You went/i.test(text)) bad.push(`${state}/signedOut: ${text.match(/you have|your picks|picked|You went/i)[0]}`);
      }
    }
    ck(`6a THE SWEEP: ${STATES.length} states x 4 viewer cells - no first-person line is reachable for a non-entrant (or a signed-out viewer) in the model or the collapsed card${bad.length ? ' - ' + bad.join('; ') : ''}`, STATES.length === 6 && bad.length === 0);
    const entrantTexts = STATES.map((s) => strip(M.gd.gameDayCardHTML(M.gd.gameDayModel(gdIn(s, cells.entered)), { escHtml: esc, numHtml: (v) => String(v) })) + JSON.stringify(M.gd.gameDayModel(gdIn(s, cells.entered)).body));
    ck('6b ...and the sweep is not vacuous: an ENTRANT in the same states does reach first-person lines', entrantTexts.filter((t) => FIRST_PERSON.test(t)).length >= 3);
  }

  // ── [7] Game Day through the real Home: the W-85 scene (CFB final, NFL open, a CFB-only member, the Now card on the NFL week) ──────────────────
  {
    for (const [name, status] of [['nflOpen', 'open'], ['nflLocked', 'locked']]) {
      E.SCENARIOS[name] = { week: 'final', live: [], up: ['n1', 'n2', 'n3'], fin: ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'], plays: ['cfb'], sportStatus: { nfl: status }, noPicksFor: ['nfl'] };
    }
    const weekIdsOf = (s, sp) => s.league.weeks.filter((x) => x.sport === sp).map((x) => x.weekId);
    const contextsOf = (s) => {
      const ids = (sp) => weekIdsOf(s, sp);
      const nflIn = ALL6.filter((p) => p !== 'p1');
      return [
        { competitionId: 'c_cfb', dbCode: 'cfb', code: 'CFB', weekIds: ids('cfb'), playerIds: ALL6, currentWeekId: 'w6', weekEntrants: { w6: ALL6 } },
        { competitionId: 'c_nfl', dbCode: 'nfl', code: 'NFL', weekIds: ids('nfl'), playerIds: nflIn, currentWeekId: 'w6n', weekEntrants: { w6n: nflIn } },
      ];
    };
    const scene = (name, { offers = [OFFER_NFL(true)], viewer = 'p1', enteredAll = false, lateJoiner = false } = {}) => {
      const s = E.scenario(name, { viewer });
      const nflWeek = s.league.weeks.find((x) => x.weekId === 'w6n');
      // a late joiner PLAYS the sport (viewerEntered, in playerIds) but was not on the roster when THIS week locked (weekEntrants): the sport-level and week-level answers differ
      const comps = s.competitions.map((c) => {
        const base = { ...c, viewerEntered: enteredAll ? true : c.viewerEntered };
        if (!lateJoiner) return base;
        return { ...base, viewerEntered: true, weekIds: weekIdsOf(s, c.sport), playerIds: ALL6, weekEntrants: c.sport === 'nfl' ? { w6n: ALL6.filter((p) => p !== 'p1') } : { w6: ALL6 } };
      });
      const m = E.mount({ home: M.home }, doc, s, { read: { currentWeek: () => nflWeek, contexts: () => contextsOf(s), rosterForWeek: () => s.league.players }, deps: { competitions: () => comps, joinOffers: typeof offers === 'function' ? offers : () => offers } });
      return { m, card: m.card(), txt: strip(m.card()), s, nflWeek };
    };
    const open = scene('nflOpen');
    ck('7a the W-85 scene: the red card is the OPEN card of the NFL week', /data-gd-kind="open-due"/.test(open.card) && /Picks lock/.test(open.txt));
    ck('7b ...it says where he stands and offers to join - it does not ask a non-player to "Make picks"', /you're not in NFL picks yet/.test(open.txt) && /Join NFL picks/.test(open.txt) && !/Make picks|have not picked|you have/.test(open.txt));
    const b = open.m.container.querySelector('#gd-card button.gd-btn');
    if (b) click(b);
    ck('7c ...and its button goes through the real dispatcher as go-tab { tab: picks, sport: nfl } with a medium haptic', !!b && eq(open.m.env.calls.actions, [['go-tab', { tab: 'picks', sport: 'nfl' }]]) && eq(open.m.env.calls.haptics, ['medium']));
    const noOffer = scene('nflOpen', { offers: [] });
    ck('7d no offer from the app -> the red card keeps its calm message and has no button', !/Make picks/.test(noOffer.txt) && !noOffer.m.container.querySelector('#gd-card button.gd-btn') && /you're not in NFL picks/.test(noOffer.txt));
    const locked = scene('nflLocked', { offers: [OFFER_NFL(false)] });
    ck('7e Locked: "your picks are in" is gone for a non-entrant; the countdown stays', /Locked/.test(locked.txt) && !/your picks are in/.test(locked.txt) && /In \d/.test(locked.txt));
    const lockedIn = scene('nflLocked', { offers: [], enteredAll: true });
    ck('7f GOLDEN - the same Locked card for a member who IS in that sport still says "your picks are in"', /your picks are in/.test(lockedIn.txt));
    const openIn = scene('nflOpen', { offers: [], enteredAll: true });
    ck('7g GOLDEN - the Open card for a member who IS in that sport still says "you have not picked yet" and offers Make picks', /you have not picked yet/.test(openIn.txt) && /Make picks/.test(openIn.txt) && !/Join /.test(openIn.txt));

    const late = scene('nflLocked', { offers: [], lateJoiner: true });
    ck('7o a LATE JOINER (plays the sport, not in THIS week): the Locked card does not say "your picks are in", and there is no Join button (he plays it)', /Locked/.test(late.txt) && !/your picks are in/.test(late.txt) && !late.m.container.querySelector('#gd-card button.gd-btn'));
    const lateOpen = scene('nflOpen', { offers: [], lateJoiner: true });
    ck('7p ...and a late joiner\'s Open card never offers Make picks for a week he is not in', !/Make picks/.test(lateOpen.txt) && !lateOpen.m.container.querySelector('#gd-card button.gd-btn'));

    // the OPEN card (gameday-sheet.js, the sweep's third file): every row of the sport he has not joined is a plain score row that says he is following it - no pick, no coverage, no first-person line
    const openCard = scene('nflLocked', { offers: [OFFER_NFL(false)] });
    openCard.m.open();
    const nflRows = openCard.m.container.querySelectorAll('.gd-row').filter((r) => String(r.getAttribute('data-game-id')).startsWith('n'));
    const personal = /your pick|you have|you're covering|you're trailing|you covered|you missed|no pick|make picks|picked/i;
    ck('7q the OPEN card: every NFL row (a sport he has not joined) says "Following - you\'re not in NFL picks" and carries no first-person line', nflRows.length >= 1 && nflRows.every((r) => /Following — you're not in NFL picks/.test(strip(r.innerHTML)) && !personal.test(strip(r.innerHTML).replace(/Following — you're not in NFL picks/, ''))));

    // nowCardModel: the strings behind the card (its Draft / Between fallback and its spoken model), for the same non-entrant
    const nowFor = (name, { entered = false, offers = [OFFER_NFL(true)], kickInMin = null, viewer = 'p1' } = {}) => {
      const sc = scene(name, { offers, enteredAll: entered, viewer });
      const snap = sc.m.env.home.assembleSnapshot({ viewerId: viewer, isCommissioner: false, now: NOW });
      const games = kickInMin === null ? snap.games : snap.games.filter((g) => g.weekId === 'w6n').map((g) => ({ ...g, kickoff: new Date(NOW + kickInMin * 60e3).toISOString() })).concat(snap.games.filter((g) => g.weekId !== 'w6n'));
      return M.home.nowCardModel({ ...snap, games, currentWeekId: 'w6n' }, { viewerId: viewer, isCommissioner: false, now: NOW });
    };
    const near = nowFor('nflLocked', { kickInMin: 30 });
    ck('7h nowCardModel, Locked within the hour, non-entrant: "You didn\'t pick this game." is omitted', near.state === 'locked-near' && !near.sub);
    const nearIn = nowFor('nflLocked', { kickInMin: 30, entered: true });
    ck('7i GOLDEN - ...and an entrant still gets it', nearIn.state === 'locked-near' && nearIn.sub === "You didn't pick this game.");
    const far = nowFor('nflLocked', { kickInMin: 300 });
    ck('7j nowCardModel, Locked far, non-entrant: no "Picks are in." clause anywhere in the model', far.state === 'locked-far' && !/Picks are in/.test(JSON.stringify(far)));
    const noGames = (() => {
      const sc = scene('nflLocked');
      const snap = sc.m.env.home.assembleSnapshot({ viewerId: 'p1', isCommissioner: false, now: NOW });
      const mk = (entered) => M.home.nowCardModel({ ...snap, games: snap.games.filter((g) => g.weekId !== 'w6n'), currentWeekId: 'w6n', competitions: snap.competitions.map((c) => ({ ...c, viewerEntered: entered })) }, { viewerId: 'p1', isCommissioner: false, now: NOW });
      return { out: mk(false), inn: mk(true) };
    })();
    ck('7k nowCardModel, Locked with no kickoff to count down to: "Reveal comes at kickoff." for a non-entrant, "Picks are in. Reveal comes at kickoff." for an entrant (golden)', noGames.out.sub === 'Reveal comes at kickoff.' && noGames.inn.sub === 'Picks are in. Reveal comes at kickoff.');
    const openN = nowFor('nflOpen');
    ck('7l nowCardModel, Open, non-entrant: no "picks left", no "Make your picks"; the primary button (if any) is the join', openN.state === 'open-pending' && !/picks left|Make your picks/.test(JSON.stringify(openN)) && openN.primary && openN.primary.label === 'Join NFL picks' && openN.primary.tab === 'picks' && openN.primary.sport === 'nfl');
    const openNoOffer = nowFor('nflOpen', { offers: [] });
    ck('7m ...with no offer it has no button at all', openNoOffer.state === 'open-pending' && openNoOffer.primary === null && !/picks left|Make your picks/.test(JSON.stringify(openNoOffer)));
    const openE = nowFor('nflOpen', { entered: true, offers: [] });
    ck('7n GOLDEN - an entrant\'s Open model is unchanged: "picks left" and "Make your picks"', openE.state === 'open-pending' && /picks left/.test(openE.headline) && openE.primary.label === 'Make your picks');
  }
  return R;
}

// ═══ run the checks against the real modules ═══════════════════════════════════════════════════════
const REAL = { home, hs, gd };
const ctl = await checks(REAL);
console.log('\n[1]-[7] the named checks over the real modules…');
for (const [label, ok] of Object.entries(ctl)) assert(ok === true, `[${label}]`);

// ═══ [8] static contract ═══════════════════════════════════════════════════════════════════════════
console.log('\n[8] Static contract…');
{
  const HOME = stripComments(await read('./js/home.js'));
  const HS = stripComments(await read('./js/home-sports.js'));
  const GD = stripComments(await read('./js/gameday.js'));
  assert(/const isOrdinary = \(e\) => e\.kind === 'card' \|\| e\.kind === 'news' \|\| e\.kind === 'error';/.test(HOME), '[8a] the nudge is not an ordinary entry: isOrdinary still names card, news and error only');
  assert(/const shown = withSeenDividers\(visible, list, seen\.baseline\);\s*const placed = placeJoinNudges\(shown, snapshot\.joinOffers\);\s*const entries = \[\.\.\.pinned, \.\.\.placed,/.test(HOME), '[8b] the nudge is placed AFTER the windowing and the dividers (so it is never counted, held, windowed or marked NEW)');
  const importCount = (src) => (src.match(/^\s*import\b|\bimport\s*\(/gm) || []).length;
  assert(importCount(HS) === 0, '[8c] home-sports.js is still a pure leaf: exactly ZERO import statements or dynamic imports (a count, not a list of shapes)');
  assert(importCount(GD) === 0, '[8d] gameday.js is still a pure leaf: exactly ZERO import statements or dynamic imports');
  assert(/joinOffers: typeof d\.joinOffers === 'function' \? d\.joinOffers : \(\) => \[\]/.test(HOME), '[8e] the dep defaults to nothing offered (fail closed)');
  // P-11 (Drew, 2026-10-15): a static guard LISTS WHAT EXISTS. The nudge renderer may call exactly these functions and nothing else - a write, a storage call or a membership call is therefore not on the list; a call that
  // disappears fails too (a pinned line that is gone is a guard that no longer guards).
  const fnBody = (src, name) => { const at = src.indexOf(`function ${name}(`); if (at < 0) return ''; const m = /\)\s*\{/.exec(src.slice(at)); if (!m) return ''; let i = at + m.index + m[0].length - 1, depth = 0; const start = i; for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) break; } } return src.slice(start, i + 1); };
  const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return']);
  const callsOf = (body) => [...new Set([...body.matchAll(/([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(/g)].map((m) => m[1]).filter((n) => !KEYWORDS.has(n)))].sort();
  const RENDER_CALLS = ['JOIN_NUDGE_COPY.button', 'JOIN_NUDGE_COPY.closed', 'JOIN_NUDGE_COPY.open', 'actionButtonHTML', 'escHtml', 'joinHtml', 'requireEscHtml'];
  const rendered = callsOf(fnBody(HOME, 'joinNudgeHTML'));
  assert(eq(rendered, RENDER_CALLS), `[8f] joinNudgeHTML calls EXACTLY ${RENDER_CALLS.length} functions - the escaper, the join helper, the shared button, the copy and nothing else (found: ${rendered.join(', ')})`);
  assert(eq(callsOf(fnBody('function x() { save(1); joinHtml([]); }', 'x')), ['joinHtml', 'save']), '[8f canary] the call census can fail: a planted save() call is listed');
  const placeCalls = callsOf(fnBody(HS, 'placeJoinNudges'));
  const PLACE_CALLS = ['Map', 'Set', 'arr', 'cleanJoinOffers', 'list.slice', 'out.push', 'placed.add', 'placed.has', 'wanted.get', 'wanted.has', 'wanted.set'];
  assert(eq(placeCalls, PLACE_CALLS), `[8g] placeJoinNudges is pure: it calls EXACTLY its own helpers and the collections it builds - nothing that reads or writes the world (found: ${placeCalls.join(', ')})`);
}

// ═══ [9] mutation kit ═════════════════════════════════════════════════════════════════════════════
console.log('\n[9] MUTATION KIT - each mutant must turn a NAMED check RED…');
const URL_OF = (rel) => new URL(rel, import.meta.url).href;
const b64 = (src) => 'data:text/javascript;base64,' + Buffer.from(src).toString('base64');
function applyEdits(src, edits, label) {
  let out = src;
  for (const [a, b] of edits) {
    const n = out.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${label} (matched ${n}): ${a.slice(0, 90)}`);
    out = out.split(a).join(b);
  }
  return out;
}
async function mutantMods({ homeEdits = [], hsEdits = [], gdEdits = [] }) {
  const rewrites = {};
  let hsMod = hs, gdMod = gd;
  if (hsEdits.length) { const src = applyEdits(await read('./js/home-sports.js'), hsEdits, 'home-sports.js'); rewrites['home-sports.js'] = b64(src); hsMod = await import(rewrites['home-sports.js']); }
  if (gdEdits.length) { const src = applyEdits(await read('./js/gameday.js'), gdEdits, 'gameday.js'); rewrites['gameday.js'] = b64(src); gdMod = await import(rewrites['gameday.js']); }
  let homeMod = home;
  if (homeEdits.length || hsEdits.length || gdEdits.length) {
    const src = applyEdits(await read('./js/home.js'), homeEdits, 'home.js').replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${rewrites[f] || URL_OF('./js/' + f)}'`);
    homeMod = await import(b64(src));
  }
  return { home: homeMod, hs: hsMod, gd: gdMod };
}
async function mutant(label, edits, mustFail) {
  let res;
  try { res = await checks(await mutantMods(edits)); }
  catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 110)]: false }; }
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every((m) => failed.some((f) => f.startsWith(m)));
  assert(failed.length > 0 && hit, `${label} -> RED on: ${failed.slice(0, 5).map((f) => f.slice(0, 60)).join(' | ') || '(nothing - the mutant SURVIVED)'}`);
}
assert(Object.values(ctl).every((v) => v === true), `[9-0] POSITIVE CONTROL: the unmutated modules pass all ${Object.keys(ctl).length} named checks, so a red below is the mutation and nothing else`);
{
  const HOME_SRC = await read('./js/home.js');
  const HS_SRC = await read('./js/home-sports.js');
  const GD_SRC = await read('./js/gameday.js');
  const need = (src, s, label) => { if (src.split(s).length - 1 !== 1) throw new Error(`kit anchor missing in ${label}: ${s.slice(0, 80)}`); return s; };
  // each [find, replace] below is checked to match exactly once; a kit that drifts from the source fails loudly rather than passing vacuously
  void need;
  await mutant('[K1] one nudge PER CARD of the sport instead of one per sport', { hsEdits: [['if (!wanted.has(code) || placed.has(code)) continue;', 'if (!wanted.has(code)) continue;']] }, ['1c', '2a']);
  await mutant('[K2] the nudge is shown signed out (the viewer gate is gone)', { homeEdits: [['joinOffers = viewerId ? cleanJoinOffers(d.joinOffers()) : [];', 'joinOffers = cleanJoinOffers(d.joinOffers());']] }, ['2m']);
  await mutant('[K3] the closed variant (B) shows the button anyway / joinable is ignored', { homeEdits: [['const showButton = o.joinable === true;', 'const showButton = true;']] }, ['2h']);
  await mutant('[K4] Make picks is kept for a non-entrant', { gdEdits: [["body.action = !viewerId || asPlayer ? { label: 'Make picks', tab: 'picks', tone: 'solid' }", "body.action = true ? { label: 'Make picks', tab: 'picks', tone: 'solid' }"]] }, ['5a', '5b', '6a', '7b']);
  await mutant('[K5] the first-person "have not picked yet" is kept for a non-entrant', { gdEdits: [['const asPlayer = !!viewerId && entered;', 'const asPlayer = !!viewerId;']] }, ['5a', '5b', '6a']);
  await mutant('[K6] "your picks are in" is kept for a non-entrant on the Locked card', { gdEdits: [["asPlayer ? 'your picks are in' : ''", "viewerId ? 'your picks are in' : ''"]] }, ['5h', '6a', '7e']);
  await mutant('[K7] joinable is ignored on the red card: the offer\'s flag no longer decides the button', { gdEdits: [['const canJoin = !!offer && offer.joinable === true;', 'const canJoin = !!offer;']] }, ['5c']);
  await mutant('[K8] the nudge is counted as an ordinary entry (the rendered keys / new-posts count read the shown list)', { homeEdits: [["ordinaryKeys: visible.map(e => e.key), heldCount", "ordinaryKeys: placed.filter(e => e.kind !== 'divider').map(e => e.key), heldCount"]] }, ['2k']);
  await mutant('[K9] the nudge hides the tease: it REPLACES the newest card of its sport', { hsEdits: [["out.push({ kind: 'join', key: `join:${code}`, offer: wanted.get(code) });", "out[out.length - 1] = { kind: 'join', key: `join:${code}`, offer: wanted.get(code) };"]] }, ['2j', '1a']);
  await mutant('[K10] the offers are not cleaned: extra fields ride into the snapshot', { homeEdits: [['joinOffers = viewerId ? cleanJoinOffers(d.joinOffers()) : [];', 'joinOffers = viewerId ? asArray(d.joinOffers()) : [];']] }, ['4b', '4c']);
  await mutant('[K11] the sport code is not escaped in the nudge', { homeEdits: [['<span class="sport-chip">${escHtml(o.code)}</span>', '<span class="sport-chip">${o.code}</span>']] }, ['2u']);
  await mutant('[K12] a sport with no card in the window still gets a nudge (a cold ad)', { hsEdits: [["    out.push({ kind: 'join', key: `join:${code}`, offer: wanted.get(code) });\n  }\n  return out;", "    out.push({ kind: 'join', key: `join:${code}`, offer: wanted.get(code) });\n  }\n  for (const [c, o] of wanted) if (!placed.has(c)) out.push({ kind: 'join', key: `join:${c}`, offer: o });\n  return out;"]] }, ['1e', '2s']);
  await mutant('[K13] an open-done card for a non-entrant is drawn as "You\'re in for Week 6"', { gdEdits: [["const asPending = state === 'open-pending' || (state === 'open-done' && !entered);", "const asPending = state === 'open-pending';"]] }, ['5k', '6a']);
  await mutant('[K14] the entered flag is ignored for the lines (the late joiner is told "you have not picked yet")', { gdEdits: [['const entered = i.entered !== false;', 'const entered = true;']] }, ['5a', '5b', '5h', '6a']);
  await mutant('[K15] the nowCardModel keeps "You didn\'t pick this game." for a viewer who is not in the sport', { homeEdits: [["const sub = !facts.entered ? '' :", "const sub = false ? '' :"]] }, ['7h']);
  await mutant('[K16] the nowCardModel keeps "Picks are in." for a viewer who is not in the sport', { homeEdits: [["sub: facts.entered ? 'Picks are in. Reveal comes at kickoff.' : 'Reveal comes at kickoff.'", "sub: 'Picks are in. Reveal comes at kickoff.'"]] }, ['7k']);
  await mutant('[K17] nowCardModel Open keeps "picks left / Make your picks" for a viewer who is not in the sport', { homeEdits: [['    if (!facts.entered) {  ', '    if (false) {  ']] }, ['7l', '7m']);
  await mutant('[K19] the non-entrant\'s clause is written into the plain line, not the folding span (the smallest phone at the largest text would break the 33% cap)', { gdEdits: [["if (viewerId && !asPlayer) body.next = canJoin ?", "if (viewerId && !asPlayer) body.line += ' · ' + (canJoin ?"], ["`you're not in ${sportCode} picks yet` : `you're not in ${sportCode} picks`;", "`you're not in ${sportCode} picks yet` : `you're not in ${sportCode} picks`);"]] }, ['5a']);
  await mutant('[K18] the entered answer is read from the SPORT, not the WEEK (a late joiner is treated as in this week)', { homeEdits: [['const entered = !viewer || !comp || comp.single ? true : enteredForWeek(comp, cur, viewer);', 'const entered = !viewer || !comp || comp.single ? true : comp.viewerEntered !== false;']] }, ['7o']);
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
