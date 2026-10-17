/**
 * CFB Pickems — newsd1test.mjs (D1 Lane C client: the server news path, grouped coverage, storylines, the "Also from" sheet's dispatcher, Home's merge; 2026-10-08)
 * ====================================================================================================================================================================
 * The proof for what D1 Lane C added to js/newsTransport.js (DI-673: the SERVER path is the default; the ESPN client path is the C20-gated contingency and keeps its own
 * proofs in newstest.mjs), js/newsRank.js (DI-484 10.2: read-time dedupe, publisher diversity; DI-672: grouped duplicate coverage), js/newsCard.js (DI-663 storyline card,
 * DI-672 grouped card + "Also from" sheet body + its ONE dispatcher), js/newsFeed.js (DI-663 storyline selection; S-C2-N: the slate keys are the PUBLISHED slate, never a
 * pick) and js/home.js (storylines and content keep their own windows in the one chronology).
 *
 * Every Supabase call is a FAKE client (recorded, answered from fixtures); nothing here reaches the network. The browser half (computed style, real taps, press scale) is
 * newsrendertest.mjs.
 *
 * Sections:
 *   [1] the server path: zero network when off, the one RPC and its exact arguments, the two levers (exact-false / exact-true), the registry's publisher, the source's
 *       own link and picture hosts, the pilot-only mirror (league passed AND the installed resolver), blocked sources, the cache, coalescing, identity, errors
 *   [2] S-C2-N / blind rule: two viewers with different picks over one published slate send BYTE-IDENTICAL server arguments and get identical storyline tags
 *   [3] the cards: grouped markup (the "Also from" button is a SIBLING of the link, never inside it), the storyline eyebrow, byline + via, "Updated", SC-N14 vectors
 *   [4] the dispatchers: card tap vs "Also from" tap, tap-time re-validation against the item's OWN source hosts, the sheet's row dispatcher
 *   [5] rank: read-time dedupe, grouping (window, team link, Jaccard, publisher, lead by registry rank, best tier kept), diversity (delays, never drops)
 *   [6] storylines: the game / team tag, 7-day window, per-game and total caps, removed from the ranked rest
 *   [7] Home's merge: storylines outlive the 48-hour news window, do not use news slots, suppress the empty note; content windows; one content-error note
 *   [8] static: the server path never reads picks; the adapter passes no league; one select for the levers
 *   [9] Home's ONE binder (newsFeed bindEvents) routes a content-card tap, Enter and Retry to the openers the app registered (registerHomeNewsOpeners), a news card to
 *       its own opener, a forged id to nothing, and stops after unbind
 *
 * Mutation kit (S-3): `node newsd1test.mjs --mutate=<name>` applies ONE KIT_MUTANTS entry to an in-memory copy of the module graph (never the files) and must go RED.
 * tests/kits/lane-c-news-kit.mjs runs them all.
 *
 * Run:  node newsd1test.mjs      (TZ-independent: every weekday assertion pins its own zone.)
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
// a suite that THROWS part-way still prints its tally (the throw is one more failure, never a silent crash a mutation kit cannot read)
for (const ev of ['uncaughtException', 'unhandledRejection']) process.on(ev, (e) => { fail++; console.error('  ❌ the suite threw:', String((e && e.message) || e).slice(0, 200)); console.log(`\n${'═'.repeat(50)}\n❌ FAILURES — ${pass} passed, ${fail} failed`); process.exit(1); });

// ── DOM / browser stubs (the shape the other standalone suites use) ──────────────────────────────────────────────────────────────────────
const lsStore = new Map();
globalThis.localStorage = { getItem: k => (lsStore.has(k) ? lsStore.get(k) : null), setItem: (k, v) => lsStore.set(k, String(v)), removeItem: k => lsStore.delete(k), clear: () => lsStore.clear() };
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ set innerHTML(v) {}, get innerHTML() { return ''; }, appendChild() {}, remove() {}, addEventListener() {}, removeEventListener() {}, classList: { add() {}, remove() {} }, style: {}, id: '', className: '' }),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, innerHTML: '', dataset: {} }, hidden: false, activeElement: null,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in newsd1test'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };
const realWarn = console.warn;
console.warn = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[news]')) return; realWarn(...a); };
{ const realErr = console.error; console.error = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[home]')) return; realErr(...a); }; }

// ── the mutation kit: [file, from, to]; ONE is applied to an in-memory copy of the module graph when `--mutate=<name>` is given ─────────────────
export const KIT_MUTANTS = {
  'pilot-mirror-off': ['js/newsTransport.js', "if (src.legalStatus === 'blocked' || (!pilot && src.legalStatus !== 'cleared')) { stats.droppedPilot++; continue; }", "if (src.legalStatus === 'blocked') { stats.droppedPilot++; continue; }"],
  'blocked-kept': ['js/newsTransport.js', "if (src.legalStatus === 'blocked' || (!pilot && src.legalStatus !== 'cleared')) { stats.droppedPilot++; continue; }", "if (!pilot && src.legalStatus !== 'cleared') { stats.droppedPilot++; continue; }"],
  'pilot-null-league': ['js/newsTransport.js', "const pilot = league ? isPilotOnlyAllowed('newsPilotSources', league) : isPilotOnlyAllowed('newsPilotSources');", "const pilot = isPilotOnlyAllowed('newsPilotSources', league);"],
  'enabled-loose': ['js/newsTransport.js', "if (row.key === 'news_enabled') newsEnabled = row.value !== false;", "if (row.key === 'news_enabled') newsEnabled = !!row.value;"],
  'images-loose': ['js/newsTransport.js', "if (row.key === 'news_images') newsImages = row.value === true;", "if (row.key === 'news_images') newsImages = !!row.value;"],
  'link-hosts-widened': ['js/newsTransport.js', '  const url = parseArticleUrlFor(row.url, source.linkHosts);', "  const url = parseArticleUrlFor(row.url, [...source.linkHosts, 'espn.com', '.espn.com']);"],
  'image-hosts-ignored': ['js/newsTransport.js', '? isAllowedImageUrl(row.image_url, source.imageHosts) : null;', "? isAllowedImageUrl(row.image_url, ['.espncdn.com', '.cbsistatic.com', '.example']) : null;"],
  'publisher-from-row': ['js/newsTransport.js', '    publisher: source.publisher,\n', "    publisher: typeof row.publisher === 'string' ? row.publisher : source.publisher,\n"],
  'via-unchecked': ['js/newsTransport.js', "const via = typeof row.via === 'string' && /^[A-Za-z0-9 .,'&-]{2,60}$/.test(row.via) ? row.via : null;", "const via = typeof row.via === 'string' ? row.via : null;"],
  'unknown-source-kept': ['js/newsTransport.js', "for (const id of ids) { const c = _sourceCache.get(id); if (c && c.row.publisher) out.set(id, c.row); }", "for (const id of ids) { const c = _sourceCache.get(id); out.set(id, c ? c.row : Object.freeze({ id, publisher: 'Unknown', paywall: 'none', rank: 50, legalStatus: 'cleared', linkHosts: Object.freeze(['.espn.com', '.cbssports.com']), imageHosts: Object.freeze([]) })); }"],
  'identity-unchecked': ['js/newsTransport.js', "    throw new NewsUnavailableError(list, 'identity');\n  }\n  _serverCache.set(sig", "  }\n  _serverCache.set(sig"],
  'cache-ignores-identity': ['js/newsTransport.js', 'const hitUsable = !!hit && sameIdentity(hit, token) && isFresh(hit, now);', 'const hitUsable = !!hit && isFresh(hit, now);'],
  'slate-keys-unsorted': ['js/newsTransport.js', 'return Array.from(out).sort().slice(0, NEWS_SLATE_KEYS_MAX);', 'return Array.from(out).slice(0, NEWS_SLATE_KEYS_MAX);'],
  'slate-from-picks': ['js/newsFeed.js', 'const slateKeys = slateKeysFor(slate.flatMap((g) => [g.homeTeam, g.awayTeam]), normTeam);', "const slateKeys = slateKeysFor(ownPickTeamNames(read.picks((read.week() || {}).weekId), slate, read.viewerId()), normTeam);"],
  'off-platform-ignored': ['js/newsFeed.js', "    if (res && res.off === 'platform') {                 // News is paused platform-wide (news_enabled false): no headline slot; the content cards still stand", '    if (false) {'],
  'also-nested': ['js/newsCard.js', '${main}</div><div class="news-card__also-row"><button type="button" class="news-card__also" data-news-also="${esc(id)}">${esc(also)}</button></div></div>`;', '${main}<div class="news-card__also-row"><button type="button" class="news-card__also" data-news-also="${esc(id)}">${esc(also)}</button></div></div></div>`;'],
  'tag-unescaped': ['js/newsCard.js', '<span class="news-card__tag">${esc(tagText)}</span>', '<span class="news-card__tag">${tagText}</span>'],
  'sheet-unescaped': ['js/newsCard.js', '<span class="news-also-headline">${esc(h)}</span>', '<span class="news-also-headline">${h}</span>'],
  'card-hosts-espn': ['js/newsCard.js', 'const href = parseArticleUrl(item.url, Array.isArray(item.linkHosts) ? item.linkHosts : ESPN_LINK_HOSTS);', 'const href = parseArticleUrl(item.url);'],
  'sheet-unrevalidated': ['js/newsCard.js', '    const href = parseArticleUrl(alt.url, Array.isArray(alt.linkHosts) ? alt.linkHosts : ESPN_LINK_HOSTS);\n    if (!href) return;                                        // fails closed', '    const href = alt.url;\n    if (!href) return;'],
  'also-opens-article': ['js/newsCard.js', "      if (!alsoFrom) return;\n", "      if (!alsoFrom) return;\n      activate(e.target.closest('.news-card') && e.target.closest('.news-card').querySelector('[data-news-id]'));\n"],
  'group-same-publisher': ['js/newsRank.js', '      if ((a.publisher || a.source) === (b.publisher || b.source)) continue;\n', ''],
  'group-window-off': ['js/newsRank.js', '      if (Math.abs(timeOf(a) - timeOf(b)) > GROUP_WINDOW_MS) continue;\n', ''],
  'group-no-team-link': ['js/newsRank.js', '      if (!teamLink) continue;\n', ''],
  'group-lead-newest': ['js/newsRank.js', '(rankOf(a) - rankOf(b)) || (timeOf(a) - timeOf(b))', '(timeOf(b) - timeOf(a))'],
  'group-tier-lost': ['js/newsRank.js', 'visible.set(lead, { item: { ...lead, relevanceTier: best.relevanceTier, reason: best.reason }, also });', 'visible.set(lead, { item: lead, also });'],
  'diversity-off': ['js/newsRank.js', 'return applyPublisherDiversity(groupDuplicateCoverage(dedupeAtReadTime(out)));', 'return groupDuplicateCoverage(dedupeAtReadTime(out));'],
  'dedupe-url-off': ['js/newsRank.js', "(url && seenUrl.has(url)) || ", ''],
  'story-per-game-uncapped': ['js/newsFeed.js', '    if ((perGame.get(gid) || 0) >= STORYLINE_PER_GAME) continue;\n', ''],
  'story-window-off': ['js/newsFeed.js', ' && now - ms <= STORYLINE_WINDOW_MS && ', ' && '],
  'home-storyline-48h': ['js/home.js', "if (now - ms <= STORYLINE_FEED_WINDOW_MS && story.length < STORYLINE_FEED_MAX) story.push(it);", "if (now - ms <= NEWS_FRESHNESS_MS && story.length < STORYLINE_FEED_MAX) story.push(it);"],
  'home-content-expired-kept': ['js/home.js', 'if (Number.isFinite(until) && until > now && content.length < CONTENT_FEED_MAX) content.push(it);', 'if (content.length < CONTENT_FEED_MAX) content.push(it);'],
  'home-empty-note-with-story': ['js/home.js', "if (!items.length && !special.cards.length) notes.push({ kind: 'news-empty', key: 'news-empty' });", "if (!items.length) notes.push({ kind: 'news-empty', key: 'news-empty' });"],
  'feed-content-unrouted': ['js/newsFeed.js', "onOpen: (item) => { if (_openers.content) _openers.content(item); }", 'onOpen: () => {}'],
  'feed-retry-unrouted': ['js/newsFeed.js', "onRetry: () => { if (_openers.retryContent) _openers.retryContent(); }", 'onRetry: () => {}'],
  'feed-unbind-content-kept': ['js/newsFeed.js', "return () => { try { unNews(); } finally { unContent(); } };", 'return () => { unNews(); };'],
  'home-news-error-dropped': ['js/home.js', "    if (newsFailed) notes.push({ kind: 'news-error', key: 'news-error' });", "    if (false) notes.push({ kind: 'news-error', key: 'news-error' });"],
  'home-story-in-slots': ['js/home.js', 'const items = eligibleNews(all.filter(it => !(it && it.cardKind)), now).slice(0, newsSlotCount(errorEntry.length + timed.length));', 'const items = eligibleNews(all.filter(it => !(it && it.cardKind)), now).slice(0, Math.max(0, newsSlotCount(errorEntry.length + timed.length) - all.filter(it => it && it.cardKind).length));'],
};
const mutateArg = (process.argv.find((a) => a.startsWith('--mutate=')) || '').slice(9);

const HERE = fileURLToPath(new URL('.', import.meta.url));
const P = (rel) => HERE + rel;
const GRAPH = ['js/newsRules.js', 'js/team-match.js', 'js/newsCard.js', 'js/newsRank.js', 'js/newsTransport.js', 'js/newsFeed.js'];   // dependency order (leaves first)
const SRC = {};
for (const f of [...GRAPH, 'js/home.js']) SRC[f] = await readFile(P(f), 'utf8');

/** The six news modules + home.js: the real files, or (with a mutant) in-memory copies whose news imports point at each other's copies and everything else at the files. */
async function loadGraph() {
  if (!mutateArg) {
    const out = {};
    for (const f of [...GRAPH, 'js/home.js']) out[f] = await import(pathToFileURL(P(f)).href);
    return out;
  }
  const mu = KIT_MUTANTS[mutateArg];
  if (!mu) throw new Error('unknown mutant ' + mutateArg);
  const n = SRC[mu[0]].split(mu[1]).length - 1;
  if (n !== 1) throw new Error(`mutant anchor must match exactly once in ${mu[0]} (matched ${n}): ${mutateArg}`);
  const text = { ...SRC, [mu[0]]: SRC[mu[0]].split(mu[1]).join(mu[2]) };
  const urls = {};
  const out = {};
  const rewrite = (code) => code.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${urls['js/' + f] || pathToFileURL(P('js/' + f)).href}'`);
  for (const f of GRAPH) {
    urls[f] = 'data:text/javascript;base64,' + Buffer.from(rewrite(text[f])).toString('base64');
    out[f] = await import(urls[f]);
  }
  out['js/home.js'] = mu[0] === 'js/home.js' ? await import('data:text/javascript;base64,' + Buffer.from(rewrite(text['js/home.js'])).toString('base64')) : await import(pathToFileURL(P('js/home.js')).href);
  return out;
}
const G = await loadGraph();
const transport = G['js/newsTransport.js'], card = G['js/newsCard.js'], rank = G['js/newsRank.js'], feed = G['js/newsFeed.js'], home = G['js/home.js'], tm = G['js/team-match.js'];
const auth = await import('./js/auth.js');
const pilotOnly = await import('./js/pilot-only.js');
if (mutateArg) console.log(`\n[MUTANT] ${mutateArg} applied to an in-memory copy of ${KIT_MUTANTS[mutateArg][0]}`);

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-10-08T16:00:00.000Z');          // a Thursday
const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const nonThrowing = async (fn) => { try { return await fn(); } catch (e) { return { threw: String((e && e.message) || e), name: e && e.name, reason: e && e.reason }; } };

const SOURCES = {
  'nat-espn-cfb-json': { id: 'nat-espn-cfb-json', publisher: 'ESPN', kind: 'json', paywall: 'none', rank: 40, legal_status: 'cleared', link_hosts: ['espn.com', '.espn.com'], image_hosts: ['a.espncdn.com'] },
  'nat-cbs-cfb': { id: 'nat-cbs-cfb', publisher: 'CBS Sports', kind: 'rss', paywall: 'none', rank: 45, legal_status: 'pilot', link_hosts: ['www.cbssports.com'], image_hosts: ['sportshub.cbsistatic.com'] },
  'nat-yahoo-cfb': { id: 'nat-yahoo-cfb', publisher: 'Yahoo Sports', kind: 'rss', paywall: 'none', rank: 90, legal_status: 'cleared', link_hosts: ['sports.yahoo.com'], image_hosts: [] },
  'nat-blocked': { id: 'nat-blocked', publisher: 'Blocked Wire', kind: 'rss', paywall: 'none', rank: 50, legal_status: 'blocked', link_hosts: ['www.blocked.example'], image_hosts: [] },
};
let rowSeq = 100;
const row = (o = {}) => {
  const id = o.id !== undefined ? o.id : ++rowSeq;
  return {
    id, url: `https://www.espn.com/college-football/story/_/id/${id}/x`, dedupe_key: null, source_id: 'nat-espn-cfb-json', publisher: 'ESPN', via: null, kind: 'json', paywall: 'none',
    headline: `Headline number ${id} about the weekend`, image_url: null, sport: 'cfb', team_keys: [], team_names: [], published_at: iso(NOW - 2 * HOUR), updated_at: iso(NOW - 2 * HOUR), ...o,
  };
};

/** A fake Supabase client: records every call; answers news_feed, news_sources_for and the platform_kv lever select from the given state. */
function mkClient({ rows = [], levers = [{ key: 'news_enabled', value: true }, { key: 'news_images', value: true }], sources = SOURCES, feedError = null, feedThrows = false, gate = null } = {}) {
  const calls = { rpc: [], from: [] };
  const c = {
    calls,
    from(table) {
      const q = { table, select: null, in: null };
      calls.from.push(q);
      return {
        select(cols) { q.select = cols; return { in: async (col, vals) => { q.in = [col, vals]; return { data: levers, error: null }; } }; },
      };
    },
    async rpc(name, args) {
      calls.rpc.push({ name, args: JSON.parse(JSON.stringify(args)) });
      if (name === 'news_feed') {
        if (gate) await gate;
        if (feedThrows) throw new Error('boom');
        if (feedError) return { data: null, error: feedError };
        return { data: rows, error: null };
      }
      if (name === 'news_sources_for') return { data: (args.p_ids || []).map((id) => sources[id]).filter(Boolean), error: null };
      return { data: null, error: { code: 'unexpected' } };
    },
  };
  return c;
}
const install = (client) => transport.installNewsTransport({ getClient: () => client });
const reset = () => { transport.clearNewsCache(); };
const NON_PILOT = { id: 'L2', pilot: false };
const PILOT = { id: 'L1', pilot: true };
const feedCalls = (c) => c.calls.rpc.filter((x) => x.name === 'news_feed');

// ═══ [1] the server path ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] the server path (DI-673): one RPC, exact arguments, the levers, the registry, the hosts, the pilot mirror, the cache, identity');
{
  reset();
  transport.installNewsTransport({ getClient: null });
  const r0 = await nonThrowing(() => transport.fetchServerNews({ sports: [], now: NOW }));
  assert(Array.isArray(r0.items) && r0.items.length === 0 && r0.off === false, '1-1: no sport asked for -> no request of any kind, an empty answer (S-C8)');
  const r1 = await nonThrowing(() => transport.fetchServerNews({ sports: ['cfb'], now: NOW }));
  assert(r1.name === 'NewsUnavailableError' && r1.reason === 'no_client', '1-2: no injected client -> NewsUnavailableError("no_client"), never a silent empty feed');
  assert(transport.NEWS_CLIENT_ESPN_FALLBACK === false && transport.fetchNews !== transport.fetchEspnNews, '1-3: the ESPN client path is OFF (C20): fetchNews is the server path');

  reset();
  const c = mkClient({ rows: [row({ id: 1 })] });
  install(c);
  const keys = transport.slateKeysFor(['Texas', 'Oklahoma', 'Duke', 'Clemson'], tm.normTeam);
  const r2 = await transport.fetchNews({ sports: ['cfb', 'nfl', 'xyz', 'cfb'], slateKeys: keys, now: NOW, league: PILOT });
  const fc = feedCalls(c);
  assert(fc.length === 1 && JSON.stringify(fc[0].args) === JSON.stringify({ p_sports: ['cfb', 'nfl'], p_limit: 100, p_slate_keys: ['clemson', 'duke', 'oklahoma', 'texas'] }),
    `1-4: ONE news_feed call with exactly { p_sports (known, unique), p_limit 100, p_slate_keys (sorted) } (got ${JSON.stringify(fc.map(x => x.args))})`);
  assert(c.calls.from.length === 1 && c.calls.from[0].table === 'platform_kv' && c.calls.from[0].select === 'key,value' && JSON.stringify(c.calls.from[0].in) === JSON.stringify(['key', ['news_enabled', 'news_images']]),
    '1-5: the two levers are read in ONE select on platform_kv (key,value) for exactly news_enabled and news_images');
  assert(r2.items.length === 1 && r2.items[0].id === 'news_1' && r2.items[0].publisher === 'ESPN' && r2.off === false, '1-6: a good row becomes one item, id "news_<n>"');

  // levers
  const lever = async (levers) => { reset(); const cc = mkClient({ rows: [row({ id: 2, image_url: 'https://a.espncdn.com/photo/x.jpg' })], levers }); install(cc); return transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT }); };
  const off = await lever([{ key: 'news_enabled', value: false }, { key: 'news_images', value: true }]);
  assert(off.off === 'platform' && off.items.length === 0, '1-7: news_enabled exactly false -> off "platform", no article returned (SC-N17)');
  const missing = await lever([{ key: 'news_images', value: true }]);
  assert(missing.off === false && missing.items.length === 1, '1-8: a MISSING news_enabled row reads ON');
  const nullish = await lever([{ key: 'news_enabled', value: null }, { key: 'news_images', value: true }]);
  assert(nullish.off === false && nullish.items.length === 1, '1-9: only an EXACT false turns News off (a null value reads on)');
  assert(missing.items[0].imageUrl === 'https://a.espncdn.com/photo/x.jpg', '1-10: news_images exactly true + a host pinned on THAT source -> the picture is kept');
  const picsStr = await lever([{ key: 'news_enabled', value: true }, { key: 'news_images', value: 'true' }]);
  assert(picsStr.items.length === 1 && picsStr.items[0].imageUrl === null, '1-11: news_images "true" (a string, not exactly true) -> no picture (fail closed)');
  const picsNone = await lever([{ key: 'news_enabled', value: true }]);
  assert(picsNone.items[0].imageUrl === null, '1-12: a missing news_images row -> no picture');

  // the registry and the hosts
  reset();
  const c3 = mkClient({ rows: [
    row({ id: 10, source_id: 'nat-cbs-cfb', publisher: 'Evil Wire', url: 'https://www.cbssports.com/college-football/news/a-story/', image_url: 'https://sportshub.cbsistatic.com/i/r/x.jpg' }),
    row({ id: 11, source_id: 'nat-cbs-cfb', url: 'https://www.espn.com/college-football/story/_/id/11/x' }),
    row({ id: 12, source_id: 'nat-cbs-cfb', url: 'https://www.cbssports.com/college-football/news/b/', image_url: 'https://a.espncdn.com/photo/x.jpg' }),
    row({ id: 13, source_id: 'nat-unknown' }),
    row({ id: 14, source_id: 'nat-yahoo-cfb', url: 'https://sports.yahoo.com/a.html', via: 'Pat Forde' }),
    row({ id: 15, source_id: 'nat-yahoo-cfb', url: 'https://sports.yahoo.com/b.html', via: '<b>x</b>' }),
    row({ id: 'abc', source_id: 'nat-espn-cfb-json' }),
    row({ id: 16, sport: 'curling' }),
  ] });
  install(c3);
  const r3 = await transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT });
  const by = Object.fromEntries(r3.items.map((it) => [it.id, it]));
  assert(by.news_10 && by.news_10.publisher === 'CBS Sports' && by.news_10.source === 'CBS Sports', '1-13: the publisher is the REGISTRY\'s (news_sources_for), never the row\'s text');
  assert(by.news_10 && by.news_10.imageUrl === 'https://sportshub.cbsistatic.com/i/r/x.jpg' && by.news_12 && by.news_12.imageUrl === null,
    '1-14: a picture is kept only on a host pinned on ITS OWN source (an ESPN still on a CBS row is dropped)');
  assert(!by.news_11, '1-15: a URL off the source\'s OWN link hosts drops the row (an espn.com link under the CBS source)');
  assert(!by.news_13 && r3.stats.droppedSource >= 1, '1-16: a source the registry does not return (not visible / unknown) drops its rows');
  assert(by.news_14 && by.news_14.via === 'Pat Forde' && by.news_15 && by.news_15.via === null, '1-17: a via credit passes only the guarded shape; markup is refused');
  assert(!by['news_abc'] && !by.news_16, '1-18: a non-integer id or an unknown sport drops the row');
  assert(by.news_10 && Array.isArray(by.news_10.linkHosts) && by.news_10.linkHosts.join() === 'www.cbssports.com', '1-19: an item carries its source\'s link hosts (the tap re-validates against them)');

  // the pilot mirror
  const pilotRun = async (league, resolverLeague) => {
    reset();
    pilotOnly.setPilotOnlyLeagueResolver(() => resolverLeague);
    const cc = mkClient({ rows: [
      row({ id: 20, source_id: 'nat-cbs-cfb', url: 'https://www.cbssports.com/college-football/news/c/' }),
      row({ id: 21, source_id: 'nat-espn-cfb-json' }),
      row({ id: 22, source_id: 'nat-blocked', url: 'https://www.blocked.example/a' }),
    ] });
    install(cc);
    const r = league === undefined ? await transport.fetchNews({ sports: ['cfb'], now: NOW }) : await transport.fetchNews({ sports: ['cfb'], now: NOW, league });
    pilotOnly.setPilotOnlyLeagueResolver(null);
    return r.items.map((it) => it.id).sort().join(',');
  };
  assert(await pilotRun(NON_PILOT, null) === 'news_21', '1-20: a NON-pilot league (passed) keeps only CLEARED sources (the client mirror of news_visible_source_ids)');
  assert(await pilotRun(PILOT, null) === 'news_20,news_21', '1-21: the pilot league (passed) also sees pilot sources');
  assert(await pilotRun(undefined, PILOT) === 'news_20,news_21', '1-22: NO league passed -> the installed resolver answers for the active league (the pilot league sees its pilot sources; the adapter passes none)');
  assert(await pilotRun(undefined, NON_PILOT) === 'news_21', '1-23: NO league passed and the resolver says non-pilot -> cleared only');
  assert((await pilotRun(PILOT, null)).indexOf('news_22') < 0, '1-24: a BLOCKED source is dropped even in the pilot league');

  // cache, force, coalescing
  reset();
  const c4 = mkClient({ rows: [row({ id: 30 })] });
  install(c4);
  await transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT });
  await transport.fetchNews({ sports: ['cfb'], now: NOW + 5 * MIN, league: PILOT });
  assert(feedCalls(c4).length === 1, '1-25: a second read inside the 15-minute TTL is served from the cache (no second RPC)');
  await transport.fetchNews({ sports: ['cfb'], now: NOW + 6 * MIN, force: true, league: PILOT });
  assert(feedCalls(c4).length === 2, '1-26: force re-reads');
  await transport.fetchNews({ sports: ['cfb'], slateKeys: ['texas'], now: NOW + 7 * MIN, league: PILOT });
  assert(feedCalls(c4).length === 3, '1-27: a different slate is a different query (no cross-slate cache hit)');
  await transport.fetchNews({ sports: ['cfb'], now: NOW + 16 * MIN + 6 * MIN, league: PILOT });
  assert(feedCalls(c4).length === 4, '1-28: past the TTL it re-reads');

  reset();
  let open; const gate = new Promise((r) => { open = r; });
  const c5 = mkClient({ rows: [row({ id: 31 })], gate });
  install(c5);
  const pa = transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT });
  const pb = transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT });
  open(); const [ra, rb] = await Promise.all([pa, pb]);
  assert(feedCalls(c5).length === 1 && ra.items.length === 1 && rb.items.length === 1, '1-29: two concurrent identical reads share ONE request');

  // identity
  reset();
  let open2; const gate2 = new Promise((r) => { open2 = r; });
  const c6 = mkClient({ rows: [row({ id: 32 })], gate: gate2 });
  install(c6);
  const p6 = nonThrowing(() => transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT }));
  await flush();
  auth._bumpIdentityEpochForTest('newsd1test');
  open2();
  const r6 = await p6;
  assert(r6.name === 'NewsUnavailableError' && r6.reason === 'identity', '1-30: the identity epoch moves while the read is in flight -> the result is discarded (NewsUnavailableError "identity")');
  const r6b = await transport.fetchNews({ sports: ['cfb'], now: NOW + MIN, league: PILOT });
  assert(feedCalls(c6).length === 2 && r6b.items.length === 1, '1-31: the discarded result was never cached: the next read goes to the server');

  reset();
  const c7 = mkClient({ rows: [row({ id: 33 })] });
  install(c7);
  await transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT });
  auth._bumpIdentityEpochForTest('newsd1test-2');
  await transport.fetchNews({ sports: ['cfb'], now: NOW + MIN, league: PILOT });
  assert(feedCalls(c7).length === 2, '1-32: a cached result for the previous identity is a MISS for the new one');

  // errors
  reset();
  install(mkClient({ feedError: { code: '42501', message: 'permission denied' } }));
  const e1 = await nonThrowing(() => transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT }));
  assert(e1.name === 'NewsUnavailableError' && e1.reason === 'fetch' && !/permission denied/.test(e1.threw), '1-33: an RPC error -> NewsUnavailableError("fetch"), the server\'s text never carried');
  reset();
  install(mkClient({ feedThrows: true }));
  const e2 = await nonThrowing(() => transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT }));
  assert(e2.name === 'NewsUnavailableError' && e2.reason === 'fetch', '1-34: a thrown RPC -> NewsUnavailableError("fetch")');
  reset();
  const c8 = mkClient({ rows: [row({ id: 34 })] });
  install(c8);
  await transport.fetchNews({ sports: ['cfb'], now: NOW, league: PILOT });
  c8.rpc = async (name, args) => { c8.calls.rpc.push({ name, args }); return { data: null, error: { code: 'x' } }; };
  const r8 = await transport.fetchNews({ sports: ['cfb'], now: NOW + MIN, force: true, league: PILOT });
  assert(r8.items.length === 1 && r8.items[0].id === 'news_34', '1-35: a forced refresh that fails keeps the fresh cached result (pull-to-refresh never blanks the slot)');
  reset();
}

// ═══ [2] S-C2-N: the server never learns a pick ═══════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] S-C2-N / blind rule: two viewers with different picks send byte-identical server arguments and see identical storyline tags');
{
  const week = { weekId: 'w5', status: 'open' };
  const games = [
    { gameId: 'g1', homeTeam: 'Texas', awayTeam: 'Oklahoma', kickoff: iso(NOW + 2 * DAY), status: 'scheduled' },
    { gameId: 'g2', homeTeam: 'Clemson', awayTeam: 'Duke', kickoff: iso(NOW + 2 * DAY), status: 'scheduled' },
  ];
  const picks = [
    { playerId: 'p1', gameId: 'g1', selectedTeam: 'Texas' }, { playerId: 'p1', gameId: 'g2', selectedTeam: 'Clemson' },
    { playerId: 'p2', gameId: 'g1', selectedTeam: 'Oklahoma' }, { playerId: 'p2', gameId: 'g2', selectedTeam: 'Duke' },
  ];
  const storyItem = Object.freeze({ id: 'news_s1', url: 'https://www.espn.com/college-football/story/_/id/1/x', source: 'ESPN', publisher: 'ESPN', headline: 'Red River week preview', imageUrl: null,
    publishedAt: iso(NOW - 3 * DAY), sport: 'cfb', teamKeys: ['texas', 'texas longhorns'], teamNames: ['Texas'], linkHosts: ['espn.com', '.espn.com'] });
  const run = async (viewer) => {
    const seen = [];
    const hn = feed.createHomeNews({
      read: { prefs: () => ({ on: true, sports: ['cfb'], teams: [] }), settings: () => ({}), viewerId: () => viewer, almaMater: () => '', week: () => week, games: () => games, picks: () => picks,
        identity: () => ({ epoch: 1, leagueId: 'L1' }), timezone: () => 'ET' },
      transport: { fetchNews: async (args) => { seen.push(JSON.stringify(args)); return { items: [storyItem], errors: {}, stats: {}, off: false }; } },
      now: () => NOW,
    });
    const items = await hn.fetchNews();
    return { args: seen, tags: (items || []).filter((i) => i.cardKind === 'storyline').map((i) => i.storyline.tag) };
  };
  const a = await run('p1'), b = await run('p2'), anon = await run(null);
  assert(a.args.length === 1 && a.args[0] === b.args[0] && a.args[0] === anon.args[0], `2-1: p1 (Texas, Clemson), p2 (Oklahoma, Duke) and a signed-out viewer send IDENTICAL transport arguments (${a.args[0]})`);
  assert(!/"league"/.test(a.args[0]) && JSON.parse(a.args[0]).slateKeys.join() === 'clemson,duke,oklahoma,texas', '2-2: the slate keys are every team of the published slate (sorted), and no league / pick / viewer field travels');
  assert(a.tags.join('|') === b.tags.join('|') && a.tags.length === 1 && !/Your pick|picked/i.test(a.tags[0]), `2-3: the storyline tag is the same for every viewer and names no pick ("${a.tags[0]}")`);
  const shuffled = transport.slateKeysFor(['Texas', 'Duke', 'Oklahoma', 'Clemson', 'texas'], tm.normTeam).join();
  assert(shuffled === 'clemson,duke,oklahoma,texas', '2-4: slateKeysFor is order-independent, deduped and sorted');
  const many = Array.from({ length: 90 }, (_, i) => `Team ${String(i).padStart(2, '0')}`);
  const k1 = transport.slateKeysFor(many, tm.normTeam), k2 = transport.slateKeysFor(many.slice().reverse(), tm.normTeam);
  assert(k1.length === 60 && k1.join() === k2.join(), '2-5: past 60 teams the truncation is the same whatever the order (it cannot depend on who picked what)');
}

// ═══ [3] the cards ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] the cards: grouped (DI-672), storyline (DI-663), byline, Updated, SC-N14');
const baseItem = (o = {}) => Object.freeze({
  id: 'news_1', url: 'https://www.cbssports.com/college-football/news/a/', source: 'CBS Sports', publisher: 'CBS Sports', via: null, headline: 'Texas holds off Oklahoma late', imageUrl: null,
  publishedAt: iso(NOW - 2 * HOUR), updatedAt: null, sport: 'cfb', reason: null, linkHosts: Object.freeze(['www.cbssports.com']), imageHosts: Object.freeze(['sportshub.cbsistatic.com']), ...o,
});
const alt = (o = {}) => Object.freeze({ id: 'news_2', publisher: 'Yahoo Sports', via: null, headline: 'Texas holds off Oklahoma', publishedAt: iso(NOW - 3 * HOUR), url: 'https://sports.yahoo.com/a.html', linkHosts: Object.freeze(['sports.yahoo.com']), ...o });
const grouped = baseItem({ alsoFrom: Object.freeze([alt()]) });
{
  const g = card.renderNewsCard(grouped);
  const mainOpen = g.indexOf('<div class="news-card__main"'), mainClose = g.indexOf('</div><div class="news-card__also-row">');
  const btnAt = g.indexOf('<button type="button" class="news-card__also"');
  assert(/^<div class="card news-card news-card--grouped">/.test(g) && !/^<div[^>]*role="link"/.test(g), '3-1: the grouped card\'s outer box is NOT a link (the link role moved to its main block)');
  // count the open/close divs between the main block's start and the button: the main block must be CLOSED before the button begins
  const rowAt = g.indexOf('<div class="news-card__also-row">');
  const between = g.slice(mainOpen, rowAt);
  const opens = (between.match(/<div\b/g) || []).length, closes = (between.match(/<\/div>/g) || []).length;
  assert(mainOpen > 0 && rowAt > mainOpen && btnAt > rowAt && opens === closes, `3-2: the "Also from" button is a SIBLING of the link block, never inside it (the main block opened ${opens} divs and closed ${closes} before the row starts)`);
  assert(/<div class="news-card__main" data-news-id="news_1" role="link" tabindex="0" aria-label="[^"]+">/.test(g), '3-3: the main block carries the id, role="link", tabindex and an aria-label');
  assert(/data-news-also="news_1">Also from Yahoo Sports<\/button>/.test(g), '3-4: the button names the other publisher ("Also from Yahoo Sports")');
  assert(!/=\s*'|=[^"\s>]/.test(g.replace(/>[^<]*</g, '><')), '3-5: every attribute value is double-quoted');
  const plain = card.renderNewsCard(baseItem());
  assert(/^<div class="card news-card" data-news-id="news_1" role="link"/.test(plain) && !/news-card__also/.test(plain), '3-6: an ungrouped card is the unchanged single link card');
  assert(card.alsoFromLabel(['CBS Sports']) === 'Also from CBS Sports' && card.alsoFromLabel(['CBS Sports', 'Yahoo Sports', 'CBS Sports']) === 'Also from CBS Sports and Yahoo Sports'
    && card.alsoFromLabel(['A', 'B', 'C']) === 'Also from A, B and C' && card.alsoFromLabel([]) === '', '3-7: alsoFromLabel: one, two (deduped), three, none');
  assert(card.bylineOf(baseItem({ publisher: 'Yahoo Sports', via: 'Pat Forde' })) === 'Pat Forde via Yahoo Sports' && card.bylineOf(baseItem()) === 'CBS Sports'
    && card.bylineOf(baseItem({ publisher: 'Yahoo Sports', via: 'yahoo sports' })) === 'Yahoo Sports', '3-8: the byline: "{via} via {publisher}", the publisher alone, never "X via X"');
  const upd = card.renderNewsCard(baseItem({ updatedAt: iso(NOW - 2 * HOUR + 31 * MIN) }));
  const noUpd = card.renderNewsCard(baseItem({ updatedAt: iso(NOW - 2 * HOUR + 29 * MIN) }));
  assert(/news-card__updated">Updated /.test(upd) && !/news-card__updated/.test(noUpd), '3-9: "Updated {date}" only when the publisher updated it 30+ minutes after publication');
  const s = card.renderStorylineCard(baseItem({ cardKind: 'storyline', storyline: { tag: 'Oklahoma at Texas · Sat', gameId: 'g1' } }));
  assert(/news-card--storyline/.test(s) && /<p class="news-card__eyebrow"><span class="news-card__kind">Storyline<\/span><span aria-hidden="true">·<\/span><span class="news-card__tag">Oklahoma at Texas · Sat<\/span><\/p>/.test(s),
    '3-10: the storyline card: kind label "Storyline", then the deterministic tag');
  assert(card.renderStorylineCard(baseItem({ cardKind: 'storyline' })) === '' && card.renderStorylineCard(null) === '', '3-11: a storyline without its tag renders nothing (never a guessed tag)');
  assert(!/news-card__reason/.test(card.renderStorylineCard(baseItem({ reason: 'Your pick', storyline: { tag: 'Texas' } }))), '3-12: a storyline card carries no reason pill (the tag is its context)');
  const fb = card.renderNewsCard(baseItem({ imageUrl: 'https://sportshub.cbsistatic.com/i/x.jpg' }));
  const fb2 = card.renderNewsCard(baseItem({ imageUrl: 'https://a.espncdn.com/x.jpg' }));
  assert(/<img class="news-card__image"[^>]*referrerpolicy="no-referrer"/.test(fb) && !/<img/.test(fb2), '3-13: the card re-checks the picture against the item\'s OWN pinned hosts');
  // SC-N14: hostile text in every new sink
  const H = '"><img src=x onerror=alert(1)>\'<script>';
  const hostile = card.renderStorylineCard(baseItem({ headline: H, publisher: H, via: H, storyline: { tag: H } }));
  const hostileG = card.renderNewsCard(baseItem({ alsoFrom: [alt({ publisher: H, headline: H })] }));
  const sheet = card.renderAlsoFromSheet(baseItem({ alsoFrom: [alt({ publisher: H, headline: H, via: H, id: 'x"><b' })] }));
  const clean = (h) => h.length > 0 && !h.includes(H) && !/<img|<script|<b\b|onerror=alert\(1\)>|'</.test(h) && !/data-news-also-open="x"/.test(h);
  assert(clean(hostile) && clean(hostileG) && clean(sheet), '3-14: SC-N14: markup in a headline, publisher, via, tag or an alternate\'s fields renders as inert text in the storyline card, the grouped card and the sheet');
  const sh = card.renderAlsoFromSheet(baseItem({ alsoFrom: [alt(), alt({ id: 'news_3', publisher: 'Sports Illustrated', headline: 'Texas survives' }), alt({ id: 'news_4', headline: '' }), null, alt({ id: 'news_5', publishedAt: 'nope' })] }));
  assert((sh.match(/<button type="button" class="news-also-open"/g) || []).length === 2 && /data-news-also-open="news_2"/.test(sh) && /data-news-also-open="news_3"/.test(sh) && /<span class="news-also-go">Open<\/span>/.test(sh),
    '3-15: the sheet body: one 44 pt row per good alternate (headline, publisher, time, Open); a row without a headline or a date is dropped');
  assert(card.renderAlsoFromSheet(baseItem()) === '' && card.renderAlsoFromSheet(baseItem({ alsoFrom: [null] })) === '', '3-16: no good alternate -> no sheet body');
}

// ═══ [4] the dispatchers ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] the dispatchers: the card tap, the "Also from" tap, re-validation at tap time, the sheet\'s rows');
// a tiny DOM: parsed markup with real parent links, closest(), getAttribute(), dataset
const dataAttr = (p) => 'data-' + String(p).replace(/[A-Z]/g, m => '-' + m.toLowerCase());
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.a = new Map(); this.children = []; this.parentNode = null; this.l = {}; const s = this; this.dataset = new Proxy({}, { get(_, p) { return s.a.get(dataAttr(p)); } }); }
  getAttribute(n) { return this.a.has(n) ? this.a.get(n) : null; } hasAttribute(n) { return this.a.has(n); }
  get className() { return this.a.get('class') || ''; }
  addEventListener(t, f) { (this.l[t] ||= []).push(f); } removeEventListener(t, f) { this.l[t] = (this.l[t] || []).filter(x => x !== f); }
  closest(sel) { let n = this; while (n) { if (n.tagName && matches(n, sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel) { const out = []; (function w(e) { for (const k of e.children) { if (matches(k, sel)) out.push(k); w(k); } })(this); return out[0] || null; }
}
function matches(el, sel) {
  return sel.split(',').some((p) => {
    p = p.trim();
    const attr = p.match(/^\[([-\w]+)\]$/); if (attr) return el.hasAttribute(attr[1]);
    const cls = p.match(/^\.([-\w]+)$/); if (cls) return el.className.split(/\s+/).includes(cls[1]);
    return false;
  });
}
function mount(html) {
  const root = new El('div');
  const stack = [root];
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g; let m;
  while ((m = re.exec(html))) {
    if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
    const el = new El(m[2]);
    const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*"([^"]*)")?/g; let am;
    while ((am = ar.exec(m[3] || ''))) el.a.set(am[1], (am[2] || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
    el.parentNode = stack[stack.length - 1]; stack[stack.length - 1].children.push(el);
    if (!(m[4] === '/' || /^(img|br|hr|input|meta|link)$/i.test(m[2]))) stack.push(el);
  }
  return root;
}
const find = (root, pred) => { let hit = null; (function w(e) { for (const k of e.children) { if (!hit && pred(k)) hit = k; w(k); } })(root); return hit; };
const click = (root, target) => (root.l.click || []).forEach((f) => f({ target, preventDefault() {} }));
{
  const cbsItem = baseItem({ alsoFrom: Object.freeze([alt()]) });
  const espnOnCbs = baseItem({ id: 'news_9', url: 'https://www.espn.com/college-football/story/_/id/9/x' });
  const root = mount(card.renderNewsCard(cbsItem) + card.renderNewsCard(espnOnCbs));
  const opened = [], sheets = [];
  card.bindNewsCardEvents(root, { items: () => [cbsItem, espnOnCbs], onOpen: (h) => opened.push(h), onAlsoFrom: (it) => sheets.push(it.id) });
  const headline = find(root, (e) => e.className === 'news-card__headline' && e.parentNode.parentNode.getAttribute('data-news-id') === 'news_1');
  click(root, headline);
  assert(opened.length === 1 && opened[0] === 'https://www.cbssports.com/college-football/news/a/' && sheets.length === 0, '4-1: a tap on the grouped card\'s main block opens ITS article (validated against its own CBS hosts), not the sheet');
  const btn = find(root, (e) => e.className === 'news-card__also');
  click(root, btn);
  assert(sheets.length === 1 && sheets[0] === 'news_1' && opened.length === 1, '4-2: a tap on "Also from" opens the sheet for that card and NEVER the article');
  const espnCard = find(root, (e) => e.getAttribute('data-news-id') === 'news_9');
  click(root, espnCard);
  assert(opened.length === 1, '4-3: an espn.com URL on a CBS item opens NOTHING at tap time (re-validated against the item\'s own hosts)');
  const root2 = mount(card.renderNewsCard(cbsItem));
  const opened2 = [];
  card.bindNewsCardEvents(root2, { items: () => [cbsItem], onOpen: (h) => opened2.push(h) });
  click(root2, find(root2, (e) => e.className === 'news-card__also'));
  assert(opened2.length === 0, '4-4: with no sheet opener registered, the "Also from" tap does nothing (never falls through to the article)');

  // the sheet's ONE dispatcher
  const g = baseItem({ alsoFrom: Object.freeze([alt(), alt({ id: 'news_3', url: 'https://www.espn.com/college-football/story/_/id/3/x' }), alt({ id: 'news_4', publisher: 'ESPN', url: 'https://www.espn.com/college-football/story/_/id/4/x', linkHosts: null })]) });
  const sroot = mount(card.renderAlsoFromSheet(g));
  const sopen = [];
  const unbind = card.bindAlsoFromSheetEvents(sroot, g, { onOpen: (h) => sopen.push(h) });
  const rowOf = (id) => find(sroot, (e) => e.getAttribute('data-news-also-open') === id);
  click(sroot, find(rowOf('news_2'), (e) => e.className === 'news-also-headline'));
  assert(sopen.length === 1 && sopen[0] === 'https://sports.yahoo.com/a.html', '4-5: a tap anywhere on a sheet row opens THAT alternate\'s validated URL');
  click(sroot, rowOf('news_3'));
  assert(sopen.length === 1, '4-6: an alternate whose URL is off ITS source\'s hosts opens nothing (re-validated at tap time)');
  click(sroot, rowOf('news_4'));
  assert(sopen.length === 2 && sopen[1] === 'https://www.espn.com/college-football/story/_/id/4/x', '4-7: an alternate with no hosts of its own (the ESPN contingency) is checked against ESPN\'s');
  const forged = mount('<ul><li><button type="button" class="news-also-open" data-news-also-open="news_999">x</button></li></ul>');
  const fopen = [];
  card.bindAlsoFromSheetEvents(forged, g, { onOpen: (h) => fopen.push(h) });
  click(forged, find(forged, (e) => e.hasAttribute('data-news-also-open')));
  assert(fopen.length === 0, '4-8: a row id that is not in the group opens nothing (the id is resolved, never a URL read from the DOM)');
  unbind();
  click(sroot, rowOf('news_2'));
  assert(sopen.length === 2, '4-9: unbind removes the listener');
}

// ═══ [5] rank ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] rank: read-time dedupe (DI-484 #4), grouping (DI-672), publisher diversity (DI-484 #3)');
const rItem = (o = {}) => ({ id: 'n' + Math.random().toString(36).slice(2, 8), url: null, source: 'ESPN', publisher: 'ESPN', headline: 'x', publishedAt: iso(NOW - HOUR), sport: 'cfb', teamKeys: ['texas'], teamNames: ['Texas'], relevanceTier: 4, reason: 'CFB', ...o });
{
  const a = rItem({ id: 'a', url: 'https://www.espn.com/story/1?utm_source=x', relevanceTier: 2, reason: "In this week's slate" });
  const b = rItem({ id: 'b', url: 'https://www.espn.com/story/1', relevanceTier: 4 });
  assert(rank.dedupeAtReadTime([a, b]).map(i => i.id).join() === 'a', '5-1: two ids at one canonical URL are one item (the better tier wins)');
  const k1 = rItem({ id: 'k1', url: 'https://www.cbssports.com/1', publisher: 'CBS Sports', dedupeKey: 'abc123' });
  const k2 = rItem({ id: 'k2', url: 'https://www.cbssports.com/2', publisher: 'CBS Sports', dedupeKey: 'abc123', publishedAt: iso(NOW - 2 * HOUR) });
  const k3 = rItem({ id: 'k3', url: 'https://sports.yahoo.com/3', publisher: 'Yahoo Sports', dedupeKey: 'abc123' });
  assert(rank.dedupeAtReadTime([k1, k2, k3]).map(i => i.id).sort().join() === 'k2,k3', '5-2: the same publisher\'s same dedupe key is one item (the earlier); another publisher\'s same key is NOT a read-time duplicate');

  const head = 'Texas holds off Oklahoma in the Red River Rivalry thriller';
  const cbs = rItem({ id: 'cbs', publisher: 'CBS Sports', source: 'CBS Sports', rank: 45, headline: head, url: 'https://www.cbssports.com/a', publishedAt: iso(NOW - 3 * HOUR) });
  const yah = rItem({ id: 'yah', publisher: 'Yahoo Sports', source: 'Yahoo Sports', rank: 90, headline: head + '!', url: 'https://sports.yahoo.com/a', publishedAt: iso(NOW - HOUR), relevanceTier: 1, reason: 'Your pick' });
  const gr = rank.groupDuplicateCoverage([yah, cbs]);
  assert(gr.length === 1 && gr[0].id === 'cbs' && gr[0].alsoFrom.length === 1 && gr[0].alsoFrom[0].id === 'yah' && gr[0].clusterId === 'cl_cbs',
    '5-3: near-identical coverage from two publishers with a shared team, inside 36 h, is ONE card: the lead is the better registry rank (CBS 45 over Yahoo 90) even when the other is newer');
  assert(gr[0].relevanceTier === 1 && gr[0].reason === 'Your pick', '5-4: the lead keeps the BEST tier the group earned (a duplicate\'s "Your pick" does not vanish with it)');
  assert(Object.isFrozen(gr[0].alsoFrom) && Object.isFrozen(gr[0].alsoFrom[0]) && gr[0].alsoFrom[0].url === 'https://sports.yahoo.com/a', '5-5: alsoFrom entries are frozen and carry their own URL and hosts');
  assert(rank.groupDuplicateCoverage([cbs, rItem({ ...yah, publishedAt: iso(NOW - 3 * HOUR - 37 * HOUR) })]).length === 2, '5-6: more than 36 hours apart -> two cards');
  assert(rank.groupDuplicateCoverage([cbs, rItem({ ...yah, teamKeys: ['ohio state'], teamNames: ['Ohio State'] })]).length === 2, '5-7: no shared team -> two cards');
  assert(rank.groupDuplicateCoverage([cbs, rItem({ ...yah, headline: 'Texas fires its defensive coordinator after loss' })]).length === 2, '5-8: different headlines (Jaccard below 0.8) -> two cards');
  assert(rank.groupDuplicateCoverage([cbs, rItem({ ...yah, publisher: 'CBS Sports', source: 'CBS Sports' })]).length === 2, '5-9: the SAME publisher twice is never grouped (DI-672 groups across publishers)');
  const out = rank.rankNews([yah, cbs], { now: NOW, enabledSports: ['cfb'], slateTeams: [], ownPickTeams: [], almaMaterTeams: [], homeTeams: [], teamSports: {} });
  assert(out.length === 1 && Array.isArray(out[0].alsoFrom), '5-10: rankNews applies the grouping');

  const mk = (pub, i) => rItem({ id: `${pub}${i}`, publisher: pub, source: pub, headline: `${pub} story ${i} ${'abcdefghij'[i]}`, url: `https://x/${pub}/${i}`, publishedAt: iso(NOW - i * MIN), teamKeys: [], teamNames: [] });
  const input = [mk('ESPN', 0), mk('ESPN', 1), mk('ESPN', 2), mk('ESPN', 3), mk('ESPN', 4), mk('CBS Sports', 5), mk('Yahoo Sports', 6), mk('NBC Sports', 7), mk('CBS Sports', 8), mk('NCAA.com', 9)];
  const div = rank.applyPublisherDiversity(input);
  const pubs = div.map((i) => i.publisher);
  const run3 = pubs.some((p, i) => i >= 2 && p === pubs[i - 1] && p === pubs[i - 2]);
  const first8 = pubs.slice(0, 8).filter((p) => p === 'ESPN').length;
  assert(!run3 && first8 <= 3 && div.length === input.length && new Set(div.map(i => i.id)).size === input.length,
    `5-11: no publisher three in a row, at most three of the first eight, nothing dropped (${pubs.join(' > ')})`);
  const same = [mk('ESPN', 0), mk('ESPN', 1), mk('ESPN', 2), mk('ESPN', 3)];
  assert(rank.applyPublisherDiversity(same).map(i => i.id).join() === same.map(i => i.id).join(), '5-12: when every item shares a publisher the order stands (diversity delays, it never stalls or drops)');
  const ranked = rank.rankNews(input, { now: NOW, enabledSports: ['cfb'], slateTeams: [], ownPickTeams: [], almaMaterTeams: [], homeTeams: [], teamSports: {} });
  const rp = ranked.map((i) => i.publisher);
  assert(!rp.some((p, i) => i >= 2 && p === rp[i - 1] && p === rp[i - 2]), '5-13: rankNews applies the diversity rule');
}

// ═══ [6] storylines ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] storylines (DI-663): the deterministic tag, the windows, the caps');
{
  const games = [
    { gameId: 'g1', homeTeam: 'Texas', awayTeam: 'Oklahoma', kickoff: '2026-10-10T19:30:00Z', status: 'scheduled' },      // Saturday afternoon ET
    { gameId: 'g2', homeTeam: 'Clemson', awayTeam: 'Duke', kickoff: '2026-10-20T19:30:00Z', status: 'scheduled' },        // 12 days out: not in range
    { gameId: 'g3', homeTeam: 'Ohio State', awayTeam: 'Penn State', kickoff: '2026-10-07T23:00:00Z', status: 'live' },
  ];
  const s = (o) => ({ id: 's' + Math.random().toString(36).slice(2, 8), url: 'https://www.espn.com/x', publisher: 'ESPN', source: 'ESPN', headline: 'h', publishedAt: iso(NOW - DAY), sport: 'cfb', teamKeys: ['texas'], ...o });
  const items = [s({ id: 'a', teamKeys: ['oklahoma'] }), s({ id: 'b', teamKeys: ['clemson'] }), s({ id: 'c', teamKeys: ['penn state'] }), s({ id: 'd', teamKeys: ['vanderbilt'] }), s({ id: 'e', teamKeys: [] })];
  const r = feed.selectStorylines(items, { slateGames: games, now: NOW, tzKey: 'ET' });
  const tag = (id) => (r.storylines.find((x) => x.id === id) || {}).storyline;
  assert(tag('a') && tag('a').tag === 'Oklahoma at Texas · Sat' && tag('a').gameId === 'g1', `6-1: a game within 72 hours: "Away at Home · Weekday" in the viewer's zone (got ${tag('a') && tag('a').tag})`);
  assert(tag('b') && tag('b').tag === 'Clemson', '6-2: a slate game further out: the matched team\'s name');
  assert(tag('c') && /^Penn State at Ohio State/.test(tag('c').tag), '6-3: a LIVE game is in range whatever its kickoff');
  assert(!tag('d') && !tag('e') && r.rest.map((x) => x.id).sort().join() === 'd,e', '6-4: an item naming no slate team (or no team) is not a storyline and stays in the ranked rest; chosen ones leave it');
  assert(r.storylines.every((x) => x.cardKind === 'storyline' && Object.isFrozen(x.storyline)), '6-5: storylines are marked cardKind "storyline" with a frozen tag');
  const wk = feed.selectStorylines([s({ id: 'w', teamKeys: ['texas'] })], { slateGames: games, now: NOW, tzKey: 'PT' });
  assert(wk.storylines[0].storyline.tag === 'Oklahoma at Texas · Sat', '6-6: the weekday is computed in the viewer\'s zone at render time (PT)');
  const old = feed.selectStorylines([s({ id: 'o', publishedAt: iso(NOW - 7 * DAY - MIN) }), s({ id: 'f', publishedAt: iso(NOW + 10 * MIN) }), s({ id: 'k', publishedAt: iso(NOW - 6 * DAY) })], { slateGames: games, now: NOW });
  assert(old.storylines.map((x) => x.id).join() === 'k', '6-7: older than 7 days or from the future -> not a storyline; 6 days old -> still one');
  const five = feed.selectStorylines(Array.from({ length: 5 }, (_, i) => s({ id: 't' + i, publishedAt: iso(NOW - (i + 1) * HOUR) })), { slateGames: games, now: NOW });
  assert(five.storylines.length === 3 && five.storylines.map((x) => x.id).join() === 't0,t1,t2', '6-8: at most 3 storylines per game, newest first');
  const teams = ['oklahoma', 'texas', 'clemson', 'duke', 'ohio state', 'penn state'];
  const lots = feed.selectStorylines(Array.from({ length: 18 }, (_, i) => s({ id: 'L' + String(i).padStart(2, '0'), teamKeys: [teams[i % 6]], publishedAt: iso(NOW - (i + 1) * MIN) })), { slateGames: games, now: NOW });
  assert(lots.storylines.length === 8, '6-9: at most 8 storylines in all');
}

// ═══ [7] Home's merge ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] Home\'s merge: storylines and content keep their own windows; one chronology');
{
  const n = (o) => ({ id: 'n' + Math.random().toString(36).slice(2, 8), url: 'https://www.espn.com/x', publisher: 'ESPN', source: 'ESPN', headline: 'h', publishedAt: iso(NOW - HOUR), sport: 'cfb', ...o });
  const story = n({ id: 'st', cardKind: 'storyline', storyline: { tag: 'Texas' }, publishedAt: iso(NOW - 6 * DAY) });
  const m1 = home.mergeFeed({ now: NOW, cards: [], news: { status: 'ready', items: [story] } });
  assert(m1.some((e) => e.kind === 'news' && e.item.id === 'st'), '7-1: a 6-day-old storyline is on Home (its window is 7 days, not news\'s 48 hours)');
  assert(!m1.some((e) => e.kind === 'news-empty'), '7-2: a storyline alone is not an empty news slot (no "No headlines yet" note beside it)');
  const cards = Array.from({ length: 8 }, (_, i) => ({ id: 'c' + i, sortKey: iso(NOW - i * HOUR) }));
  const stories = Array.from({ length: 3 }, (_, i) => n({ id: 'st' + i, cardKind: 'storyline', storyline: { tag: 'Texas' }, publishedAt: iso(NOW - (i + 1) * DAY) }));
  const news = [n({ id: 'h1', publishedAt: iso(NOW - 2 * HOUR) }), n({ id: 'h2', publishedAt: iso(NOW - 3 * HOUR) })];
  const m2 = home.mergeFeed({ now: NOW, cards, news: { status: 'ready', items: [...stories, ...news] } });
  const ids = m2.filter((e) => e.kind === 'news').map((e) => e.item.id);
  assert(ids.includes('h1') && ids.includes('h2') && ids.filter((x) => x.startsWith('st')).length === 3, `7-3: storylines do not use up the news slots (8 cards -> 2 news slots, both headlines shown; got ${ids.join(',')})`);
  const order = m2.filter((e) => e.kind === 'card' || e.kind === 'news').map((e) => e.t);
  assert(order.every((t, i) => i === 0 || order[i - 1] >= t), '7-4: one chronology: storylines, headlines and league cards are placed by time alone');
  const content = [
    n({ id: 'cv', cardKind: 'matchup.preview', eligibleUntil: iso(NOW + DAY) }), n({ id: 'cx', cardKind: 'matchup.preview', eligibleUntil: iso(NOW - MIN) }),
    n({ id: 'ce1', cardKind: 'content-error' }), n({ id: 'ce2', cardKind: 'content-error' }), n({ id: 'cu', cardKind: 'unknown.kind', eligibleUntil: iso(NOW + DAY) }),
  ];
  const m3 = home.mergeFeed({ now: NOW, cards: [], news: { status: 'ready', items: content } });
  const k3 = m3.filter((e) => e.kind === 'news').map((e) => e.item.id);
  assert(k3.includes('cv') && !k3.includes('cx') && !k3.includes('cu'), '7-5: a content card shows until its eligibleUntil; an expired one or an unknown kind does not');
  assert(k3.filter((x) => x.startsWith('ce')).length === 1, '7-6: at most ONE content-error note');
  const st9 = Array.from({ length: 10 }, (_, i) => n({ id: 'S' + i, cardKind: 'storyline', storyline: { tag: 'T' }, publishedAt: iso(NOW - (i + 1) * HOUR) }));
  assert(home.mergeFeed({ now: NOW, cards: [], news: { status: 'ready', items: st9 } }).filter((e) => e.kind === 'news').length === 8, '7-7: at most 8 storylines on Home');
  const m4 = home.mergeFeed({ now: NOW, cards: [], news: { status: 'ready', items: [n({ id: 'old', publishedAt: iso(NOW - 3 * DAY) })] } });
  assert(!m4.some((e) => e.kind === 'news') && m4.some((e) => e.kind === 'news-empty'), '7-8: an ORDINARY headline older than 48 hours is still dropped (only storylines got the longer window)');
  // the adapter: News paused platform-wide -> the slot does not exist
  const hn = feed.createHomeNews({
    read: { prefs: () => ({ on: true, sports: ['cfb'], teams: [] }), settings: () => ({}), viewerId: () => 'p1', almaMater: () => '', week: () => null, games: () => [], picks: () => [], identity: () => ({ epoch: 1, leagueId: 'L1' }), timezone: () => 'PT' },
    transport: { fetchNews: async () => ({ items: [], errors: {}, stats: {}, off: 'platform' }) }, now: () => NOW,
  });
  assert(await hn.fetchNews() === null, '7-9: off "platform" -> the adapter returns null (the slot does not exist, never an empty-state note)');
  // review B3: the adapter's news-error marker beside content cards -> Home's ONE news-error note beside them; the marker is never a card
  const contentOnly = n({ id: 'cv2', cardKind: 'matchup.preview', eligibleUntil: iso(NOW + DAY) });
  const m5 = home.mergeFeed({ now: NOW, cards: [], news: { status: 'ready', items: [contentOnly, { id: 'news-error', cardKind: 'news-error' }] } });
  assert(m5.some((e) => e.kind === 'news' && e.item.id === 'cv2') && m5.filter((e) => e.kind === 'news-error').length === 1 && !m5.some((e) => e.kind === 'news-empty')
    && !m5.some((e) => e.kind === 'news' && e.item.id === 'news-error'), '7-10: review B3 — a failed headline read beside standing content: the content card AND one news-error note (never "No headlines yet", never the marker as a card)');
}

// ═══ [8] static ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] static contract');
{
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const T = strip(SRC['js/newsTransport.js']);
  const server = T.slice(T.indexOf('export async function fetchServerNews'), T.indexOf('export async function fetchNews'));
  assert(server.length > 500 && !/pick|selectedTeam|viewer/i.test(server), '8-1: the server path reads nothing about picks or the viewer');
  const F = strip(SRC['js/newsFeed.js']);
  const fetchFn = F.slice(F.indexOf('async function fetchNews('), F.indexOf('return {', F.indexOf('async function fetchNews(')));
  const sportsFn = fetchFn.slice(fetchFn.indexOf('const newsRequestSports'), fetchFn.indexOf('const slateKeys'));
  assert(/transport\.fetchNews\(\{ sports: newsRequestSports\(\), slateKeys, force: !!force, now: now\(\) \}\)/.test(fetchFn) && sportsFn.length > 50 && !/pick|viewer/i.test(sportsFn.replace(/\/\*\*[\s\S]*?\*\//g, '')),
    '8-2: the adapter passes exactly { sports, slateKeys, force, now } (no league, no pick); the sports are the followed ones plus the published slate\'s, read from no pick');
  assert((T.match(/\.from\('platform_kv'\)/g) || []).length === 1 && (T.match(/\.rpc\('news_feed'/g) || []).length === 1 && (T.match(/\.rpc\('news_sources_for'/g) || []).length === 1,
    '8-3: one lever select, one feed RPC, one registry RPC — nothing else on the client touches the news tables');
  assert(!/\.from\('news_articles'\)|\.from\('news_sources'\)/.test(T), '8-4: the client never selects the news tables directly (the RPCs are the contract)');
  const C = strip(SRC['js/newsCard.js']);
  const sheetFn = C.slice(C.indexOf('export function renderAlsoFromSheet'), C.indexOf('export function bindAlsoFromSheetEvents'));
  assert(/'<ul class="news-also-list">' \+ rows\.join\(''\) \+ '<\/ul>'/.test(sheetFn), '8-5: the sheet body joins rows it escaped itself (concatenation, never a re-interpolated template)');
  const A = strip(await readFile(P('js/app.js'), 'utf8'));
  const appSheet = A.slice(A.indexOf('function openNewsAlsoSheet('), A.indexOf('function mountSheetShell('));
  assert(/bindAlsoFromSheetEvents\(wrap, item, \{ onOpen:/.test(appSheet) && !/data-news-also-open/.test(appSheet) && !/\.url\b/.test(appSheet),
    '8-6: app.js\'s sheet uses the ONE row dispatcher (newsCard.js) and reads no URL itself');
}

console.log('\n[9] Home\'s one binder routes content taps to the app\'s openers');
{
  const C1 = Object.freeze({ id: 'content_00000000-0000-4000-8000-0000000000c1', contentId: '00000000-0000-4000-8000-0000000000c1', cardKind: 'matchup.preview', sport: 'cfb',
    eventRef: 'espn:event:401856716', teamKeys: ['missouri'], publishedAt: iso(NOW - HOUR), freshAsOf: iso(NOW - HOUR), eligibleUntil: iso(NOW + DAY), card: { headline: 'Texas A&M at Missouri' },
    summary: null, watch: [], talk: null, facts: [], sources: [], synthesisStatus: 'structured', version: 1 });
  const N1 = { id: 'news_n1', url: 'https://www.espn.com/college-football/story/_/id/1/x', publisher: 'ESPN', source: 'ESPN', headline: 'A headline', publishedAt: iso(NOW - HOUR), sport: 'cfb', linkHosts: ['www.espn.com'] };
  const hn = feed.createHomeNews({
    read: { prefs: () => ({ on: true, sports: ['cfb'], teams: [] }), settings: () => ({}), viewerId: () => 'p1', almaMater: () => '', week: () => null, games: () => [], picks: () => [],
      identity: () => ({ epoch: 1, leagueId: 'L1' }), timezone: () => 'ET' },
    transport: { fetchNews: async () => ({ items: [N1], errors: {}, stats: {}, off: false }), fetchContent: async () => ({ items: [C1] }) },
    now: () => NOW,
  });
  await hn.fetchNews();
  const held = hn.currentItems().map((i) => i.id);
  assert(held.includes(C1.id) && held.includes(N1.id), `9-0: fixture: the adapter holds one content card and one headline (${held.join(',')})`);
  const opened = [], retried = [], newsOpened = [], also = [];
  feed.registerHomeNewsOpeners({ openAlsoFrom: (it) => also.push(it.id), openContent: (it) => opened.push(it.id), retryContent: () => retried.push(1) });
  const L = {};
  const root = { addEventListener(t, f) { (L[t] ||= []).push(f); }, removeEventListener(t, f) { L[t] = (L[t] || []).filter((x) => x !== f); } };
  const un = hn.bindEvents(root, { onOpen: (it) => newsOpened.push(it.id) });
  const el = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null), closest: () => null });
  const target = (map) => ({ closest: (sel) => { for (const [k, v] of Object.entries(map)) if (sel.includes(k)) return v; return null; } });
  const fire = (type, ev) => (L[type] || []).slice().forEach((f) => f({ preventDefault() {}, stopPropagation() {}, ...ev }));
  fire('click', { target: target({ 'data-content-id': el({ 'data-content-id': C1.id }) }) });
  assert(opened.join() === C1.id && newsOpened.length === 0, '9-1: a content card tap reaches the app\'s registered openContent with the HELD item (and no news opener)');
  fire('keydown', { key: 'Enter', target: target({ 'data-content-id': el({ 'data-content-id': C1.id }) }) });
  assert(opened.length === 2, '9-2: Enter on a focused content card opens it too');
  fire('click', { target: target({ 'data-content-id': el({ 'data-content-id': 'content_00000000-0000-4000-8000-0000000000ff' }) }) });
  assert(opened.length === 2, '9-3: a forged content id opens nothing');
  fire('click', { target: target({ 'data-content-retry': el({}) }) });
  assert(retried.length === 1 && opened.length === 2, '9-4: Retry on the content-error note reaches the app\'s retryContent');
  un();
  fire('click', { target: target({ 'data-content-id': el({ 'data-content-id': C1.id }) }) });
  assert(opened.length === 2, '9-5: after unbind nothing is routed (no stale listener)');
  feed.registerHomeNewsOpeners({});
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
