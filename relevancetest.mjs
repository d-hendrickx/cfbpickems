/**
 * CFB Pickems — relevancetest.mjs (D1 Lane C, DI-668 / DI-660 / DI-669; UN-480, 2026-10-08)
 * ===========================================================================================
 * The proof for js/feed-relevance.js (what is eligible, and the private reason), the content leg of js/newsTransport.js (normalizeContentRow, fetchContent,
 * fetchContentDetail) and of js/newsFeed.js (the content cards beside the news, the calm content-error note, News off). Every Supabase call is a FAKE client.
 *
 *   [1] tiers: own pick > slate > alma / team > sport; "Texas" never claims "Texas A&M"; nothing followed = not eligible
 *   [2] windows: a preview until kickoff, a spotlight 72 hours; a future card is not eligible
 *   [3] inclusion and order: the cap of 40 keeps by tier, then unseen, then newest; the kept set is re-sorted strictly newest-first (relevance never reorders)
 *   [4] privacy: the reason is computed on the device from the viewer's OWN picks only; another player's pick or a signed-out viewer never earns "Your pick"
 *   [5] normalize: typed, capped, no reason accepted from the server, model text only when 'ok', the spotlight's 72-hour eligibility
 *   [6] fetchContent / fetchContentDetail: the exact RPC arguments (no league, team or pick), the cache, identity, errors
 *   [7] the adapter: content beside the news; a failed content read is ONE note and never costs the news; News off = content only (no news request); platform off
 *   [8] static: feed-relevance.js imports only the team matcher
 *
 * Mutation kit (S-3): `node relevancetest.mjs --mutate=<name>` applies one KIT_MUTANTS entry to in-memory copies (never the files) and must go RED.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }
// a suite that THROWS part-way still prints its tally (the throw is one more failure, never a silent crash a mutation kit cannot read)
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { fail++; console.error('  ❌ the suite threw:', String((e && e.message) || e).slice(0, 200)); console.log(`\n${'═'.repeat(50)}\n❌ FAILURES — ${pass} passed, ${fail} failed`); process.exit(1); });

const lsStore = new Map();
globalThis.localStorage = { getItem: k => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, String(v)), removeItem: k => lsStore.delete(k), clear: () => lsStore.clear() };
globalThis.document = { addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} }, hidden: false };
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined }; } catch { /* read-only */ }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in relevancetest'); };
globalThis.matchMedia = () => ({ matches: false });
const realWarn = console.warn; console.warn = (...a) => { if (typeof a[0] === 'string' && /^\[(news|content)\]/.test(a[0])) return; realWarn(...a); };

export const KIT_MUTANTS = {
  'rel-pick-any': ['js/feed-relevance.js', 'if (teamKeySetMatches(keys, groupFor(ctx.ownPickTeamsBySport, ctx.ownPickTeams, c.sport)).length) { tier = 1; reason = REASON_PICK; }', 'if (teamKeySetMatches(keys, ctx.slateTeams).length) { tier = 1; reason = REASON_PICK; }'],
  'rel-window-off': ['js/feed-relevance.js', '    if (!Number.isFinite(until) || until <= now) continue;', ''],
  'rel-spotlight-72h-off': ['js/feed-relevance.js', "    if (c.cardKind === 'spotlight' && now - pub > SPOTLIGHT_ELIGIBLE_MS) continue;", ''],
  'rel-no-resort': ['js/feed-relevance.js', '  kept.sort((a, b) => (b._t - a._t) || (a.id < b.id ? -1 : 1));', ''],
  'rel-seen-ignored': ['js/feed-relevance.js', '((a._seen ? 1 : 0) - (b._seen ? 1 : 0)) || ', ''],
  'rel-untagged-kept': ['js/feed-relevance.js', '    if (tier === null) continue;', "    if (tier === null) { tier = 4; reason = 'CFB'; }"],
  'content-reason-from-server': ['js/newsTransport.js', '    reason: null, relevanceTier: null,\n  });\n}\n\n/**\n * The content leg', "    reason: typeof row.reason === 'string' ? row.reason : null, relevanceTier: null,\n  });\n}\n\n/**\n * The content leg"],
  'content-summary-structured': ['js/newsTransport.js', "    summary: status === 'ok' ? cleanStr(row.summary, 220) || null : null,", '    summary: cleanStr(row.summary, 220) || null,'],
  'content-args-league': ['js/newsTransport.js', "client.rpc('feed_content_list', { p_sports: list, p_limit: CONTENT_LIMIT })", "client.rpc('feed_content_list', { p_sports: list, p_limit: CONTENT_LIMIT, p_league: getActiveLeagueId() })"],
  'content-cache-identity': ['js/newsTransport.js', '  if (hit && !force && sameIdentity(hit, token) && now - hit.fetchedAt < CONTENT_TTL_MS && now >= hit.fetchedAt) return { items: hit.items };', '  if (hit && !force && now - hit.fetchedAt < CONTENT_TTL_MS && now >= hit.fetchedAt) return { items: hit.items };'],
  'content-spotlight-forever': ['js/newsTransport.js', "  const eligibleUntil = kind === 'spotlight' ? Math.min(exp, pub + CONTENT_SPOTLIGHT_MS) : exp;", '  const eligibleUntil = exp;'],
  'leg-error-swallowed': ['js/newsFeed.js', "      return [Object.freeze({ id: 'content-error', cardKind: 'content-error', publishedAt: new Date(now()).toISOString() })];", '      return [];'],
  'leg-error-costs-news': ['js/newsFeed.js', "    const contentP = loadContent({ force, newsOn, seenBaseline });", "    const contentP = loadContent({ force, newsOn, seenBaseline }).then((c) => { if (c.some((x) => x.cardKind === 'content-error')) throw new Error('content'); return c; });"],
  // review B2 / B3 / B4 (2026-10-14)
  'news-fail-drops-content': ['js/newsFeed.js', "      if (!shown.length || !available() || !sameToken(token, read.identity())) { held = null; throw newsErr; }", "      held = null; throw newsErr;"],
  'content-sports-followed-only': ['js/newsFeed.js', "    const sports = Array.from(new Set([...slateSports, ...followed])).filter(known).sort();", "    const sports = (newsOn ? followed : [leagueSportOf(read.settings())]).filter(known).sort();"],
  'rel-by-sport-ignored': ['js/feed-relevance.js', "  const groupFor = (bySport, flat, sport) => (bySport && typeof bySport === 'object' && !Array.isArray(bySport) ? asArray(bySport[sport]) : flat);", "  const groupFor = (bySport, flat) => flat;"],
  'rel-baseline-ignored': ['js/feed-relevance.js', "_seen: seen.has(c.id) || (seenBefore !== null && pub <= seenBefore),", "_seen: seen.has(c.id),"],
  'content-limit-40': ['js/newsTransport.js', 'export const CONTENT_LIMIT = 60;', 'export const CONTENT_LIMIT = 40;'],
  'news-sports-followed-only': ['js/newsFeed.js', '    try { res = await transport.fetchNews({ sports: newsRequestSports(), slateKeys, force: !!force, now: now() }); } catch (e) { newsErr = e; }', '    try { res = await transport.fetchNews({ sports: read.prefs().sports, slateKeys, force: !!force, now: now() }); } catch (e) { newsErr = e; }'],
  'slates-one-week': ['js/newsFeed.js', "  try { weeks = typeof read.weeks === 'function' ? read.weeks() : (read.week() ? [read.week()] : []); } catch { weeks = []; }", "  try { weeks = read.week() ? [read.week()] : []; } catch { weeks = []; }"],
};
const mutateArg = (process.argv.find((a) => a.startsWith('--mutate=')) || '').slice(9);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const GRAPH = ['js/newsRules.js', 'js/team-match.js', 'js/feed-relevance.js', 'js/content-card.js', 'js/newsCard.js', 'js/newsRank.js', 'js/newsTransport.js', 'js/newsFeed.js'];
const SRC = {};
for (const f of GRAPH) SRC[f] = await readFile(HERE + f, 'utf8');
async function loadGraph() {
  const out = {};
  if (!mutateArg) { for (const f of GRAPH) out[f] = await import(pathToFileURL(HERE + f).href); return out; }
  const mu = KIT_MUTANTS[mutateArg];
  if (!mu) throw new Error('unknown mutant ' + mutateArg);
  if (SRC[mu[0]].split(mu[1]).length - 1 !== 1) throw new Error(`mutant anchor must match exactly once in ${mu[0]}: ${mutateArg}`);
  const text = { ...SRC, [mu[0]]: SRC[mu[0]].split(mu[1]).join(mu[2]) };
  const urls = {};
  const rewrite = (code) => code.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${urls['js/' + f] || pathToFileURL(HERE + 'js/' + f).href}'`);
  for (const f of GRAPH) { urls[f] = 'data:text/javascript;base64,' + Buffer.from(rewrite(text[f])).toString('base64'); out[f] = await import(urls[f]); }
  return out;
}
const G = await loadGraph();
const rel = G['js/feed-relevance.js'], transport = G['js/newsTransport.js'], feed = G['js/newsFeed.js'], tm = G['js/team-match.js'];
const auth = await import('./js/auth.js');
if (mutateArg) console.log(`\n[MUTANT] ${mutateArg}`);

const NOW = Date.parse('2026-10-08T17:00:00.000Z');
const HOUR = 3600e3, DAY = 24 * HOUR, MIN = 60e3;
const iso = (ms) => new Date(ms).toISOString();
let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const card = (o = {}) => ({ id: `content_${o.uuid || uuid()}`, cardKind: 'matchup.preview', sport: 'cfb', teamKeys: ['missouri', 'missouri tigers', 'texas a and m', 'texas a and m aggies'],
  publishedAt: iso(NOW - HOUR), eligibleUntil: iso(NOW + DAY), ...o });
const ctx = (o = {}) => ({ slateTeams: [], ownPickTeams: [], almaMaterTeams: [], homeTeams: [], enabledSports: ['cfb'], now: NOW, ...o });

console.log('\n[1] tiers (DI-668)');
{
  const one = (c, x) => rel.eligibleCards([c], ctx(x))[0];
  assert(one(card(), { ownPickTeams: ['Missouri'], slateTeams: ['Missouri', 'Texas A&M'] }).reason === 'Your pick', '1-1: the viewer\'s own picked team -> tier 1 "Your pick"');
  assert(one(card(), { slateTeams: ['Missouri'] }).relevanceTier === 2 && one(card(), { slateTeams: ['Missouri'] }).reason === "In this week's slate", '1-2: a slate team -> tier 2 "In this week\'s slate"');
  assert(one(card(), { almaMaterTeams: ['Missouri'] }).reason === 'Your alma mater' && one(card(), { homeTeams: ['Texas A&M'] }).reason === 'Your team', '1-3: alma mater / a News-settings team -> tier 3');
  assert(one(card(), {}).reason === 'CFB' && one(card(), {}).relevanceTier === 4, '1-4: a followed sport alone -> tier 4, the sport label');
  assert(rel.eligibleCards([card()], ctx({ enabledSports: ['nfl'] })).length === 0, '1-5: a card about nothing this viewer follows is NOT eligible');
  const aggies = card({ teamKeys: ['texas a and m', 'texas a and m aggies'] });
  assert(one(aggies, { slateTeams: ['Texas'], enabledSports: [] }) === undefined, '1-6: "Texas" in the slate never claims a Texas A&M card (the one matcher: equality of keys)');
  assert(one(aggies, { slateTeams: ['Texas A&M'] }).relevanceTier === 2, '1-7: …and "Texas A&M" does');
  const out = rel.eligibleCards([card({ reason: 'Planted' })], ctx({ slateTeams: ['Missouri'] }))[0];
  assert(out.reason === "In this week's slate" && ['Your pick', "In this week's slate", 'Your alma mater', 'Your team', 'CFB', 'NFL'].includes(out.reason), '1-8: the reason is ALWAYS recomputed here from the closed set (an incoming one is overwritten)');
}

console.log('\n[2] windows');
{
  assert(rel.eligibleCards([card({ eligibleUntil: iso(NOW - MIN) })], ctx()).length === 0, '2-1: a preview past its kickoff (eligibleUntil) is gone');
  assert(rel.eligibleCards([card({ cardKind: 'spotlight', publishedAt: iso(NOW - 73 * HOUR), eligibleUntil: iso(NOW + 10 * DAY) })], ctx()).length === 0, '2-2: a spotlight older than 72 hours is gone, whatever its row\'s retention');
  assert(rel.eligibleCards([card({ cardKind: 'spotlight', publishedAt: iso(NOW - 70 * HOUR), eligibleUntil: iso(NOW + 2 * HOUR) })], ctx()).length === 1, '2-3: …and one at 70 hours stays');
  assert(rel.eligibleCards([card({ publishedAt: iso(NOW + 10 * MIN) })], ctx()).length === 0, '2-4: a card published in the future is not eligible');
  assert(rel.eligibleCards([card({ cardKind: 'content-error' }), card({ cardKind: 'team.card' })], ctx()).length === 0, '2-5: only the three content kinds are cards here');
}

console.log('\n[3] inclusion and order (the cap of 40; time alone orders)');
{
  const cards = [];
  for (let i = 0; i < 30; i++) cards.push(card({ uuid: `00000000-0000-4000-8000-1000000000${String(i).padStart(2, '0')}`, teamKeys: ['vanderbilt'], sport: 'cfb', publishedAt: iso(NOW - i * MIN) }));   // tier 4 (sport), the newest
  for (let i = 0; i < 20; i++) cards.push(card({ uuid: `00000000-0000-4000-8000-2000000000${String(i).padStart(2, '0')}`, publishedAt: iso(NOW - (100 + i) * MIN) }));                       // tier 2 (slate), older
  const out = rel.eligibleCards(cards, ctx({ slateTeams: ['Missouri'] }));
  assert(out.length === 40 && out.filter((c) => c.relevanceTier === 2).length === 20, `3-1: 50 eligible -> the 40 kept include ALL 20 slate cards (tier first), though they are older (${out.length})`);
  const times = out.map((c) => Date.parse(c.publishedAt));
  assert(times.every((t, i) => i === 0 || times[i - 1] >= t), '3-2: the kept set is ordered strictly newest-first (relevance never reorders)');
  const seen = new Set(cards.slice(0, 20).map((c) => c.id));
  const out2 = rel.eligibleCards(cards.slice(0, 30), ctx({ seenIds: seen, max: 10 }));
  assert(out2.every((c) => !seen.has(c.id)), '3-3: inside a tier, UNSEEN cards are kept before seen ones');
  assert(cards.every((c) => !('reason' in c) || c.reason === undefined), '3-4: the inputs are never mutated');
}

console.log('\n[4] privacy: the reason is the viewer\'s own, on the device');
{
  const week = { weekId: 'w5', status: 'open' };
  const games = [{ gameId: 'g1', homeTeam: 'Missouri', awayTeam: 'Texas A&M', kickoff: iso(NOW + 2 * DAY), status: 'scheduled' }];
  const picks = [{ playerId: 'p2', gameId: 'g1', selectedTeam: 'Missouri' }];
  const contentRow = { id: '00000000-0000-4000-8000-000000000abc', kind: 'matchup.preview', sport: 'cfb', team_keys: ['missouri', 'texas a and m'], published_at: iso(NOW - HOUR), fresh_as_of: iso(NOW - HOUR), expires_at: iso(NOW + DAY),
    card: { headline: 'Texas A&M at Missouri' }, summary: null, watch: [], talk: null, facts: [], sources: [], synthesis_status: 'structured', version: 1 };
  const mk = (viewer) => feed.createHomeNews({
    read: { prefs: () => ({ on: true, sports: ['cfb'], teams: [] }), settings: () => ({}), viewerId: () => viewer, almaMater: () => '', week: () => week, games: () => games, picks: () => picks, identity: () => ({ epoch: 1, leagueId: 'L1' }), timezone: () => 'PT' },
    transport: { fetchNews: async () => ({ items: [], errors: {}, stats: {} }), fetchContent: async () => ({ items: [transport.normalizeContentRow(contentRow)] }) }, now: () => NOW,
  });
  const asP1 = (await mk('p1').fetchNews()).find((i) => i.cardKind === 'matchup.preview');
  const asP2 = (await mk('p2').fetchNews()).find((i) => i.cardKind === 'matchup.preview');
  const anon = (await mk(null).fetchNews()).find((i) => i.cardKind === 'matchup.preview');
  assert(asP2 && asP2.reason === 'Your pick', '4-1: the player who picked Missouri sees "Your pick"');
  assert(asP1 && asP1.reason === "In this week's slate" && anon && anon.reason === "In this week's slate", '4-2: ANOTHER player\'s pick, or a signed-out viewer, never earns "Your pick" (the slate tier instead)');
}

console.log('\n[5] normalizeContentRow');
{
  const row = (o = {}) => ({ id: '00000000-0000-4000-8000-0000000000aa', kind: 'matchup.preview', sport: 'cfb', event_ref: 'espn:event:401856716', team_keys: ['missouri', '<bad>'], published_at: iso(NOW - HOUR),
    fresh_as_of: iso(NOW - HOUR), expires_at: iso(NOW + DAY), card: { headline: 'Texas A&M‮ at Missouri', away: { name: 'Texas A&M', record: '3-2', rank: null }, home: { name: 'Missouri', record: '4-1', rank: 14 }, kickoff: iso(NOW + DAY), tv: ['ABC'] },
    summary: 'A summary.', watch: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }], talk: { text: 'Talk?' }, facts: [{ id: 'm:1:rec:142', text: 'Missouri is 4-1.', source: { label: 'ESPN', publishedAt: '2026-10-08' } }],
    sources: [{ label: 'ESPN', publishedAt: '2026-10-08' }], synthesis_status: 'ok', version: 2, reason: 'Your pick', ...o });
  const n = transport.normalizeContentRow(row());
  assert(n && n.id === 'content_00000000-0000-4000-8000-0000000000aa' && n.cardKind === 'matchup.preview' && Object.isFrozen(n), '5-1: a good row -> one frozen item, id "content_<uuid>"');
  assert(n.reason === null, '5-2: a reason from the server is IGNORED (the reason is the device\'s, DI-668)');
  assert(!/‮/.test(n.card.headline) && n.teamKeys.join() === 'missouri', '5-3: bidi controls are stripped; a team key outside [a-z0-9 ] is dropped');
  assert(n.summary === 'A summary.' && n.watch.length === 2 && n.talk.text === 'Talk?', '5-4: status ok -> the model text, at most two watch lines');
  const st = transport.normalizeContentRow(row({ synthesis_status: 'structured' }));
  assert(st.summary === null && st.watch.length === 0 && st.talk === null && st.synthesisStatus === 'structured', '5-5: status structured -> NO model text, even if a row carries some');
  const sp = transport.normalizeContentRow(row({ kind: 'spotlight', published_at: iso(NOW - HOUR), expires_at: iso(NOW + 13 * DAY), card: { headline: 'Braden Atkinson', name: 'Braden Atkinson', team: 'Oregon State', opponent: 'Colorado State', score: '56-26', result: 'won', date: '2026-10-03', lines: ['31/34, 427 passing yards'], why: 'Why featured: …' } }));
  assert(Date.parse(sp.eligibleUntil) === NOW - HOUR + 72 * HOUR, '5-6: a spotlight is eligible 72 hours from publication (not its 14-day retention)');
  for (const [label, o] of [['bad id', { id: 'nope' }], ['bad kind', { kind: 'team.card' }], ['bad sport', { sport: 'nba' }], ['no headline', { card: {} }], ['bad date', { published_at: 'x' }]]) {
    assert(transport.normalizeContentRow(row(o)) === null, `5-7: ${label} -> null`);
  }
}

console.log('\n[6] fetchContent / fetchContentDetail (the exact arguments; cache; identity; errors)');
{
  const mkClient = (answer) => { const calls = []; return { calls, async rpc(name, args) { calls.push({ name, args: JSON.parse(JSON.stringify(args)) }); return typeof answer === 'function' ? answer(name, args) : answer; } }; };
  const good = { data: [{ id: '00000000-0000-4000-8000-0000000000bb', kind: 'matchup.preview', sport: 'cfb', team_keys: ['missouri'], published_at: iso(NOW - HOUR), fresh_as_of: iso(NOW - HOUR), expires_at: iso(NOW + DAY), card: { headline: 'X at Y' }, synthesis_status: 'structured' }], error: null };
  transport.clearNewsCache();
  transport.installNewsTransport({ getClient: null });
  let e = null; try { await transport.fetchContent({ sports: ['cfb'], now: NOW }); } catch (x) { e = x; }
  assert(e && e.name === 'ContentUnavailableError' && e.reason === 'no_client', '6-1: no client -> ContentUnavailableError no_client');
  const c = mkClient(good);
  transport.installNewsTransport({ getClient: () => c });
  const r = await transport.fetchContent({ sports: ['nfl', 'cfb', 'nba', 'cfb'], now: NOW });
  assert(c.calls.length === 1 && JSON.stringify(c.calls[0]) === JSON.stringify({ name: 'feed_content_list', args: { p_sports: ['cfb', 'nfl'], p_limit: 60 } }), `6-2: ONE call with exactly { p_sports (known, sorted), p_limit 60 (the RPC's maximum, review B4) } — no league, team or pick (${JSON.stringify(c.calls[0])})`);
  assert(r.items.length === 1, '6-3: the rows come back normalized');
  await transport.fetchContent({ sports: ['cfb', 'nfl'], now: NOW + MIN });
  assert(c.calls.length === 1, '6-4: a second read inside the 5-minute TTL is served from the cache');
  auth._bumpIdentityEpochForTest('relevancetest');
  await transport.fetchContent({ sports: ['cfb', 'nfl'], now: NOW + 2 * MIN });
  assert(c.calls.length === 2, '6-5: a cached result for the previous identity is a MISS for the new one');
  transport.clearNewsCache();
  const bad = mkClient({ data: null, error: { code: 'XX', message: 'secret' } });
  transport.installNewsTransport({ getClient: () => bad });
  e = null; try { await transport.fetchContent({ sports: ['cfb'], now: NOW }); } catch (x) { e = x; }
  assert(e && e.name === 'ContentUnavailableError' && e.reason === 'fetch' && !/secret/.test(String(e.message)), '6-6: a failed read -> ContentUnavailableError fetch (the server\'s text is never carried)');
  assert((await transport.fetchContent({ sports: [], now: NOW })).items.length === 0 && bad.calls.length === 1, '6-7: no sport -> no request');
  const det = mkClient((name, args) => ({ data: name === 'feed_content_get' ? [{ ...good.data[0], gaps: ['the series history is not in the source'] }] : null, error: null }));
  transport.installNewsTransport({ getClient: () => det });
  const d = await transport.fetchContentDetail('00000000-0000-4000-8000-0000000000bb');
  assert(det.calls.length === 1 && JSON.stringify(det.calls[0].args) === JSON.stringify({ p_id: '00000000-0000-4000-8000-0000000000bb' }) && d && d.gaps.length === 1, '6-8: the detail is ONE feed_content_get by id; gaps come back');
  assert(await transport.fetchContentDetail('not-a-uuid') === null && det.calls.length === 1, '6-9: a malformed id makes no request');
  const L = '11111111-1111-4111-8111-111111111111';
  const ins = mkClient((name) => ({ data: name === 'league_insight_get' ? [{ synthesis_status: 'ok', synthesis: { read: 'A dry read.' }, created_at: iso(NOW) }] : null, error: null }));
  transport.installNewsTransport({ getClient: () => ins });
  const a = await transport.fetchLeagueInsight({ leagueId: L, weekRef: '2026:cfb:6' });
  assert(ins.calls.length === 1 && JSON.stringify(ins.calls[0]) === JSON.stringify({ name: 'league_insight_get', args: { p_league: L, p_week_ref: '2026:cfb:6' } }) && a.status === 'ok' && a.read === 'A dry read.',
    '6-10: the callback read is ONE league_insight_get with the active league and the week (membership is the server\'s first check)');
  const st = mkClient(() => ({ data: [{ synthesis_status: 'structured', synthesis: null, created_at: iso(NOW) }], error: null }));
  transport.installNewsTransport({ getClient: () => st });
  assert((await transport.fetchLeagueInsight({ leagueId: L, weekRef: '2026:cfb:6' })).status === 'none', '6-11: a structured row has no read ("Analysis isn\'t available right now.")');
  assert((await transport.fetchLeagueInsight({ leagueId: 'x', weekRef: '2026:cfb:6' })).status === 'none' && st.calls.length === 1, '6-12: a malformed league id or week ref makes no request');
  transport.clearNewsCache();
}

console.log('\n[7] the adapter: content beside the news, and never at its cost');
{
  const nRow = (id) => ({ id: `news_${id}`, url: `https://www.espn.com/college-football/story/_/id/${id}/x`, source: 'ESPN', publisher: 'ESPN', headline: `Headline ${id}`, imageUrl: null, publishedAt: iso(NOW - HOUR), sport: 'cfb', teamIds: [], teamNames: [], teamShortNames: [], teamKeys: [], reason: null, relevanceTier: null });
  const cItem = transport.normalizeContentRow({ id: '00000000-0000-4000-8000-0000000000cc', kind: 'spotlight', sport: 'cfb', team_keys: ['missouri'], published_at: iso(NOW - HOUR), fresh_as_of: iso(NOW - HOUR), expires_at: iso(NOW + 10 * DAY), card: { headline: 'Jamal Roberts', name: 'Jamal Roberts' }, synthesis_status: 'structured' });
  const read = (on = true) => ({ prefs: () => ({ on, sports: ['cfb'], teams: [] }), settings: () => ({ newsEnabled: on }), viewerId: () => 'p1', almaMater: () => '', week: () => null, games: () => [], picks: () => [], identity: () => ({ epoch: 1, leagueId: 'L1' }), timezone: () => 'PT' });
  const calls = { news: 0, content: 0 };
  const tr = (o = {}) => ({ fetchNews: async () => { calls.news++; if (o.newsThrows) throw new Error('news down'); return { items: [nRow(1)], errors: {}, stats: {}, off: o.off || false }; },
    fetchContent: async (a) => { calls.content++; calls.lastContent = a; if (o.contentThrows) throw new Error('content down'); return { items: [cItem] }; } });
  let h = feed.createHomeNews({ read: read(), transport: tr(), now: () => NOW });
  let out = await h.fetchNews();
  assert(out.some((i) => i.id === 'news_1') && out.some((i) => i.cardKind === 'spotlight'), '7-1: the content cards ride beside the news');
  assert(JSON.stringify(calls.lastContent.sports) === JSON.stringify(['cfb']) && !('league' in calls.lastContent) && !('slateKeys' in calls.lastContent), '7-2: the content read carries the followed sports only');
  h = feed.createHomeNews({ read: read(), transport: tr({ contentThrows: true }), now: () => NOW });
  out = await h.fetchNews();
  assert(out.some((i) => i.id === 'news_1') && out.filter((i) => i.cardKind === 'content-error').length === 1, '7-3: a failed content read is ONE calm content-error note; the news still stands');
  h = feed.createHomeNews({ read: read(), transport: tr({ newsThrows: true }), now: () => NOW });
  out = await h.fetchNews().catch(() => null);
  assert(Array.isArray(out) && out.some((i) => i.cardKind === 'spotlight') && out.filter((i) => i.cardKind === 'news-error').length === 1 && out.length === 2
    && h.currentItems().length === 1 && h.currentItems()[0].cardKind === 'spotlight',
    '7-4: review B3 — a failed NEWS read KEEPS the content cards and adds ONE news-error marker (Home\'s calm note with Retry); a tap resolves only the cards');
  h = feed.createHomeNews({ read: read(), transport: tr({ newsThrows: true, contentThrows: true }), now: () => NOW });
  let threw = false; try { await h.fetchNews(); } catch { threw = true; }
  assert(threw && h.currentItems().length === 0, '7-4b: …and with no content card standing it is the error it always was (Home\'s news error, which reloads both)');
  calls.news = 0;
  h = feed.createHomeNews({ read: read(false), transport: tr(), now: () => NOW });
  out = await h.fetchNews();
  assert(calls.news === 0 && Array.isArray(out) && out.length === 1 && out[0].cardKind === 'spotlight', '7-5: News OFF: no news request; the content cards alone');
  h = feed.createHomeNews({ read: read(false), transport: tr({ contentThrows: true }), now: () => NOW });
  assert(await h.fetchNews() === null, '7-6: News OFF and no content: the slot does not exist (never an empty-state note)');
  h = feed.createHomeNews({ read: read(), transport: tr({ off: 'platform' }), now: () => NOW });
  out = await h.fetchNews();
  assert(Array.isArray(out) && out.length === 1 && out[0].cardKind === 'spotlight', '7-7: News paused platform-wide: no headlines, the content cards still stand');
  h = feed.createHomeNews({ read: read(), transport: { fetchNews: async () => ({ items: [nRow(2)], errors: {}, stats: {} }) }, now: () => NOW });
  out = await h.fetchNews();
  assert(out.length === 1 && out[0].id === 'news_2', '7-8: an injected transport with no content leg behaves exactly as before');
  const html = h.renderNewsCard(transport.normalizeContentRow({ id: '00000000-0000-4000-8000-0000000000dd', kind: 'matchup.preview', sport: 'cfb', team_keys: [], published_at: iso(NOW - HOUR), fresh_as_of: iso(NOW - HOUR), expires_at: iso(NOW + DAY), card: { headline: 'A at B' }, synthesis_status: 'structured' }));
  assert(/data-content-id="content_00000000-0000-4000-8000-0000000000dd"/.test(html) && /content-card--matchup/.test(html), '7-9: the adapter draws a content item with the content card (one sink)');
  assert(/data-content-retry="1"/.test(h.renderNewsCard({ id: 'content-error', cardKind: 'content-error' })), '7-10: …and the content-error note with its Retry');
}

console.log('\n[9] review B2 / B4: every current week, the slate sports, per-sport tiers, the visit baseline, the 60 -> 40 cut');
{
  const cfbWeek = { weekId: 'wc', status: 'open', sport: 'cfb' }, nflWeek = { weekId: 'wn', status: 'open', sport: 'nfl' };
  const GAMES = { wc: [{ gameId: 'gc', homeTeam: 'Missouri', awayTeam: 'Texas A&M' }], wn: [{ gameId: 'gn', homeTeam: 'Kansas City Chiefs', awayTeam: 'Buffalo Bills', espnSport: 'nfl', kickoffTime: iso(NOW + 30 * HOUR) }] };
  const PICKS = { wc: [], wn: [{ playerId: 'p1', gameId: 'gn', selectedTeam: 'Kansas City Chiefs' }] };
  const nflCard = transport.normalizeContentRow({ id: '00000000-0000-4000-8000-0000000000e1', kind: 'matchup.preview', sport: 'nfl', team_keys: ['kansas city chiefs', 'buffalo bills'], published_at: iso(NOW - HOUR),
    fresh_as_of: iso(NOW - HOUR), expires_at: iso(NOW + DAY), card: { headline: 'Buffalo Bills at Kansas City Chiefs' }, synthesis_status: 'structured', version: 1 });
  const cfbCard = transport.normalizeContentRow({ id: '00000000-0000-4000-8000-0000000000e2', kind: 'matchup.preview', sport: 'cfb', team_keys: ['missouri', 'texas a and m'], published_at: iso(NOW - 2 * HOUR),
    fresh_as_of: iso(NOW - 2 * HOUR), expires_at: iso(NOW + DAY), card: { headline: 'Texas A&M at Missouri' }, synthesis_status: 'structured', version: 1 });
  const mkRead = ({ sports = ['cfb'], on = true, weeks = [cfbWeek, nflWeek] } = {}) => ({ prefs: () => ({ on, sports, teams: [] }), settings: () => ({ newsEnabled: on }), viewerId: () => 'p1', almaMater: () => '',
    weeks: () => weeks, week: () => weeks[0] || null, games: (id) => GAMES[id] || [], picks: (id) => PICKS[id] || [], identity: () => ({ epoch: 1, leagueId: 'L1' }), timezone: () => 'ET' });
  const asked = [];
  const tr = { fetchNews: async () => ({ items: [], errors: {}, stats: {} }), fetchContent: async (a) => { asked.push(a.sports.join(',')); return { items: [nflCard, cfbCard] }; } };
  let out = await feed.createHomeNews({ read: mkRead(), transport: tr, now: () => NOW }).fetchNews();
  const r = (id) => (out.find((i) => i.contentId === id) || {}).reason;
  assert(asked[0] === 'cfb,nfl' && r('00000000-0000-4000-8000-0000000000e1') === 'Your pick' && r('00000000-0000-4000-8000-0000000000e2') === "In this week's slate",
    `9-1: a CFB + NFL league, the viewer follows only CFB: the content read asks for BOTH slate sports, the picked NFL game reads "Your pick", the CFB game "In this week's slate" (${asked[0]})`);
  asked.length = 0;
  out = await feed.createHomeNews({ read: mkRead({ sports: ['nfl'], weeks: [] }), transport: tr, now: () => NOW }).fetchNews();
  assert(asked[0] === 'cfb,nfl' && out.some((i) => i.contentId === '00000000-0000-4000-8000-0000000000e2' && i.reason === 'CFB'),
    '9-2: no published week: the league\'s sport (CFB) PLUS the followed NFL; the CFB card shows under its sport label');
  asked.length = 0;
  out = await feed.createHomeNews({ read: mkRead({ sports: [], weeks: [] }), transport: tr, now: () => NOW }).fetchNews();
  assert(asked[0] === 'cfb' && out.some((i) => i.contentId === '00000000-0000-4000-8000-0000000000e2'), '9-3: News on with every sport unchecked still shows the league\'s own sport (followed sports only WIDEN)');
  // per-sport tiers at the relevance layer: a slate team of one sport never ranks another sport's card
  const cross = rel.eligibleCards([card({ sport: 'nfl', teamKeys: ['missouri'] })], ctx({ slateTeams: ['Missouri'], slateTeamsBySport: { cfb: ['Missouri'] }, enabledSports: ['cfb', 'nfl'] }))[0];
  assert(cross && cross.relevanceTier === 4 && cross.reason === 'NFL', '9-4: a CFB slate team never puts an NFL card in "In this week\'s slate" (by-sport groups; the NFL card is its sport tier)');
  // B4: the visit baseline decides seen / unseen, together with explicit ids
  const older = card({ uuid: '00000000-0000-4000-8000-3000000000a1', publishedAt: iso(NOW - 3 * HOUR) });
  const newer = card({ uuid: '00000000-0000-4000-8000-3000000000a2', publishedAt: iso(NOW - HOUR) });
  const keep = (x) => rel.eligibleCards([older, newer], ctx({ seenIds: new Set([newer.id]), max: 1, ...x }))[0].id;
  assert(keep({}) === older.id, '9-5: the newer card already seen, the older one not -> the unseen one is kept (no baseline)');
  assert(keep({ seenBefore: NOW - 4 * HOUR }) === older.id && keep({ seenBefore: NOW - 2 * HOUR }) === newer.id,
    '9-6: review B4 — a card published at or before the visit baseline counts SEEN: once the baseline passes the older card too, both are seen and the newest is kept');
  // B4: the device asks for 60 and keeps 40 by tier — the server's newest 40 is not the cut
  const rows = [];
  for (let i = 0; i < 50; i++) rows.push({ id: `00000000-0000-4000-8000-4000000000${String(i).padStart(2, '0')}`, kind: 'matchup.preview', sport: 'cfb', team_keys: ['vanderbilt'], published_at: iso(NOW - i * MIN),
    fresh_as_of: iso(NOW - i * MIN), expires_at: iso(NOW + DAY), card: { headline: `Game ${i}` }, synthesis_status: 'structured', version: 1 });
  for (let i = 0; i < 5; i++) rows.push({ id: `00000000-0000-4000-8000-5000000000${String(i).padStart(2, '0')}`, kind: 'matchup.preview', sport: 'cfb', team_keys: ['missouri'], published_at: iso(NOW - (300 + i) * MIN),
    fresh_as_of: iso(NOW - (300 + i) * MIN), expires_at: iso(NOW + DAY), card: { headline: `Picked ${i}` }, synthesis_status: 'structured', version: 1 });
  const srv = { async rpc(name, args) { return { data: rows.slice(0, args.p_limit), error: null }; } };   // the server's newest-first order, cut at p_limit
  transport.clearNewsCache();
  transport.installNewsTransport({ getClient: () => srv });
  const got = await transport.fetchContent({ sports: ['cfb'], now: NOW });
  const kept = rel.eligibleCards(got.items, ctx({ slateTeams: ['Missouri'] }));
  assert(kept.length === 40 && kept.filter((c) => c.relevanceTier === 2).length === 5,
    `9-7: 55 cards on the server, 5 of them older slate cards: asking for 60 lets all 5 survive the cut to 40 (tier first), which a 40-row request could not (${kept.filter((c) => c.relevanceTier === 2).length})`);
  transport.clearNewsCache();
  // coordinator ruling 2026-10-14 (PF-480; S-C2-N amended): the NEWS request carries the followed sports PLUS the published slates' sports, so a default-preference CFB
  // follower whose pick is an NFL game gets that game's NFL storyline; two viewers who differ only in their picks still send the same request
  const chiefs = { id: 'news_chiefs1', url: 'https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/chiefs-x', publisher: 'NBC Sports', source: 'NBC Sports', headline: 'Chiefs injury update before Buffalo',
    publishedAt: iso(NOW - 2 * HOUR), sport: 'nfl', teamKeys: ['kansas city chiefs'], teamNames: ['Kansas City Chiefs'], linkHosts: ['www.nbcsports.com'] };
  const newsArgs = [];
  const trN = { fetchNews: async (a) => { newsArgs.push(JSON.stringify(a)); return { items: a.sports.includes('nfl') ? [chiefs] : [], errors: {}, stats: {} }; }, fetchContent: async () => ({ items: [] }) };
  const outN = await feed.createHomeNews({ read: mkRead({ sports: ['cfb'] }), transport: trN, now: () => NOW }).fetchNews();
  const story = (outN || []).find((i) => i.id === 'news_chiefs1');
  assert(JSON.parse(newsArgs[0]).sports.join() === 'cfb,nfl' && story && story.cardKind === 'storyline' && /Buffalo Bills at Kansas City Chiefs/.test(story.storyline.tag),
    `9-8: a default-preference CFB follower with an NFL pick in a CFB + NFL league: the news request carries NFL too and the Chiefs article is that game's STORYLINE (${newsArgs[0] && JSON.parse(newsArgs[0]).sports})`);
  const otherViewer = { ...mkRead({ sports: ['cfb'] }), viewerId: () => 'p2' };
  await feed.createHomeNews({ read: otherViewer, transport: trN, now: () => NOW }).fetchNews();
  assert(newsArgs[1] === newsArgs[0], '9-9: S-C2-N still holds: a viewer with no NFL pick sends the BYTE-IDENTICAL request (the slate is league-level, never a pick)');
  newsArgs.length = 0;
  await feed.createHomeNews({ read: mkRead({ sports: [] }), transport: trN, now: () => NOW }).fetchNews();
  assert(newsArgs.length === 0 || JSON.parse(newsArgs[0]).sports.length === 0, '9-10: a viewer who unchecked EVERY sport still asks News for nothing ("Pick at least one sport")');
}

console.log('\n[8] static');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const fr = strip(SRC['js/feed-relevance.js']);
  const imps = [...fr.matchAll(/^\s*import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  assert(JSON.stringify(imps) === JSON.stringify(['./team-match.js']) && !/fetch\(|localStorage|\.rpc\(|document\./.test(fr), '8-1: feed-relevance.js imports only the team matcher and does no I/O');
  assert(typeof tm.teamKeySetMatches === 'function', '8-2: (fixture) the shared matcher is the one it uses');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
