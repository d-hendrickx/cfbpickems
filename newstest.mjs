/**
 * CFB Pickems — newstest.mjs (Social Platform News, option A: ESPN headlines only; DI-375…384, SC-N rules that apply to an ESPN-only client transport, 2026-10-01)
 * =================================================================================================================================================================
 * The proof for js/newsRules.js, js/newsCard.js, js/newsRank.js, js/newsTransport.js, js/newsFeed.js, js/newsSettings.js, the News edits to js/control-center.js,
 * js/storage.js (news prefs), js/platform.js (openExternalUrl) and js/data-model.js (newsEnabled).
 *
 * Every network call is a FAKE `fetch`: nothing here reaches ESPN. The fixtures are trimmed copies of the SHAPES the live endpoint returned on 2026-10-01 (a video-clip
 * item with an espnmedia-cdn.akamaized.net still, an ESPN betting article, an http:// NHL preview), not invented ones.
 *
 * Run:  node newstest.mjs      Must be run under BOTH TZ=UTC and TZ=America/Los_Angeles.
 *
 * Sections:
 *   [1]  Static contract: import allow-lists (S-C10), the zero-import rank module, one fetch host, no AI (UN-341), no proxy / Capacitor HTTP / localStorage, iOS 15, wiring lists
 *   [2]  newsRules: text hygiene. There is NO betting filter (Drew reversed SD-6 on 2026-10-01: "I want betting news"): betting headlines are KEPT — the [BET-KEEP] guards in [2], [5], [8] and [10]
 *   [3]  newsCard: parseArticleUrl (S-C1), the image host list (S-C6), the card (S-C3, W9), the tap (S-C1), openExternalUrl (S-C4)
 *   [4]  newsRank: the four tiers, freshness, team matching accuracy, sport gating, no mutation, ownPickTeamNames (S-C2)
 *   [5]  newsTransport: normalization (S-C5), dedupe, TTL, identity (S-C9), errors, zero network off (S-C8)
 *   [6]  The kill switch: the three layers
 *   [7]  News preferences in storage (S-C7), the one-time seed
 *   [8]  newsFeed: the Home adapter and the settings ctx
 *   [9]  newsSettings + the control-center drawer's third pane
 *   [10] MUTATION PROOFS on scratch copies (never the files): each mutant must turn a NAMED check RED
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
console.log(`\n[TZ] running under TZ=${process.env.TZ || '(unset)'}\n`);

// ── DOM / browser stubs (the same minimal shape the other standalone suites use) ──────────────────────────────────────
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
  hidden: false, activeElement: null,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in newstest'); };
globalThis.matchMedia = () => ({ matches: false });
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };
const realWarn = console.warn;
console.warn = (...a) => { if (typeof a[0] === 'string' && a[0].startsWith('[news]')) return; realWarn(...a); };      // the transport's expected discard / filter-error warnings

const rules = await import('./js/newsRules.js');
const card = await import('./js/newsCard.js');
const rank = await import('./js/newsRank.js');
const transport = await import('./js/newsTransport.js');
const feed = await import('./js/newsFeed.js');
const settingsUi = await import('./js/newsSettings.js');
const storage = await import('./js/storage.js');
const dataModel = await import('./js/data-model.js');
const platform = await import('./js/platform.js');
const auth = await import('./js/auth.js');
const cc = await import('./js/control-center.js');
const { icon } = await import('./js/icons.js');

const read = (rel) => readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}
const NEWS_FILES = ['js/newsRules.js', 'js/newsCard.js', 'js/newsRank.js', 'js/newsTransport.js', 'js/newsFeed.js', 'js/newsSettings.js'];
const SRC = {};
for (const f of NEWS_FILES) SRC[f] = await read('./' + f);
const CODE = Object.fromEntries(NEWS_FILES.map(f => [f, stripComments(SRC[f])]));
const importsOf = (code) => [...code.matchAll(/^\s*import\s+[\s\S]*?\s+from\s+['"]([^'"]+)['"]/gm)].map(m => m[1]);

// ── shared fixtures ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NOW = Date.parse('2026-10-01T16:00:00.000Z');
const MIN = 60e3, HOUR = 3600e3, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const CH = (code) => String.fromCharCode(code);          // invisible characters are built, never typed into this source

const team = (name, short, teamId, extra = {}) => ({ id: teamId + 1000, type: 'team', description: name, teamId, team: { id: teamId, description: name, abbreviation: short.slice(0, 4).toUpperCase(), shortDisplayName: short }, ...extra });
const article = (o = {}) => ({
  id: 1, headline: 'Texas rolls past Oklahoma in a Red River thriller', description: 'The Longhorns controlled the second half.', published: iso(NOW - 2 * HOUR),
  images: [{ url: 'https://a.espncdn.com/photo/2026/1001/r1_1296x729_16-9.jpg' }],
  categories: [team('Texas Longhorns', 'Texas', 251), { id: 9571, type: 'league', description: 'NCAA Football' }],
  links: { web: { href: 'https://www.espn.com/college-football/story/_/id/50000001/texas-rolls-past-oklahoma' } },
  premium: false, ...o,
});
const payload = (articles) => ({ header: 'NCAAF News', link: {}, articles });
const item = (o = {}) => Object.freeze({
  id: 'news_abc', url: 'https://www.espn.com/college-football/story/_/id/1/x', source: 'ESPN', headline: 'A headline', imageUrl: null, publishedAt: iso(NOW - 2 * HOUR),
  sport: 'cfb', teamIds: [], reason: null, relevanceTier: null, teamNames: [], teamShortNames: [], description: null, ...o,
});

/** A fake fetch: records every call, answers from `handler(url, opts, n)`. */
function mkFetch(handler) {
  const calls = [];
  const f = async (url, opts) => { calls.push({ url: String(url), opts }); return handler(String(url), opts, calls.length); };
  f.calls = calls;
  return f;
}
const okRes = (url, json, o = {}) => ({
  ok: o.ok !== false, status: o.status || 200, url: o.resUrl !== undefined ? o.resUrl : url,
  headers: { get: (k) => (String(k).toLowerCase() === 'content-length' && o.contentLength !== undefined ? String(o.contentLength) : null) },
  text: async () => (o.text !== undefined ? o.text : JSON.stringify(json)),
});
const sportOf = (url) => Object.entries(transport.NEWS_SPORT_PATHS).find(([, p]) => url.includes('/' + p + '/news'))?.[0];
const withFetch = async (f, fn) => { const prev = globalThis.fetch; globalThis.fetch = f; try { return await fn(); } finally { globalThis.fetch = prev; } };
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); };
const firstTagAttrNames = (html) => { const open = html.slice(0, html.indexOf('>') + 1); return [...open.replace(/="[^"]*"/g, '').matchAll(/\s([a-zA-Z_:][-\w:.]*)/g)].map(m => m[1]); };
const nonThrowing = async (fn) => { try { return await fn(); } catch (e) { return { threw: String((e && e.message) || e), name: e && e.name, e }; } };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('[1] Static contract — allow-lists, the zero-import rank module, one fetch host, no AI, no proxy…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const ALLOW = {
    'js/newsTransport.js': ['./data-provider.js', './auth.js', './newsCard.js', './newsRules.js'],
    'js/newsCard.js': ['./haptics.js', './platform.js'],
    'js/newsSettings.js': ['./icons.js'],
    'js/newsFeed.js': ['./storage.js', './auth.js', './newsTransport.js', './newsRank.js', './newsCard.js'],
    'js/newsRules.js': [],
    'js/newsRank.js': [],
  };
  assert(!/^\s*import\s/m.test(CODE['js/newsRank.js']) && importsOf(CODE['js/newsRank.js']).length === 0, '1-1: js/newsRank.js has ZERO import statements (S-C10)');
  assert(!/^\s*import\s/m.test(CODE['js/newsRules.js']), '1-2: js/newsRules.js has ZERO import statements (the shared pure rules file B reuses from an Edge function)');
  for (const [f, allowed] of Object.entries(ALLOW)) {
    const imps = importsOf(CODE[f]);
    const bad = imps.filter(i => !allowed.includes(i));
    assert(bad.length === 0, `1-3: ${f} imports only its allow-list (${allowed.join(', ') || 'nothing'}) — outside the list: ${bad.join(', ') || 'none'} (S-C10 / DI-382)`);
  }
  // the one fetch host: every absolute URL in the transport's CODE is site.api.espn.com
  const urls = [...CODE['js/newsTransport.js'].matchAll(/https?:\/\/([A-Za-z0-9.${}_-]+)/g)].map(m => m[1]);
  assert(CODE['js/newsTransport.js'].includes('site.api.espn.com') && urls.every(u => u.startsWith('${NEWS_API_HOST}') || u === 'site.api.espn.com'), `1-4: js/newsTransport.js builds requests for site.api.espn.com only (hosts seen: ${urls.join(', ')})`);
  assert(/credentials:\s*'omit'/.test(CODE['js/newsTransport.js']) && /referrerPolicy:\s*'no-referrer'/.test(CODE['js/newsTransport.js']), "1-5: the fetch is credentials:'omit' with referrerPolicy:'no-referrer'");
  assert(!/headers\s*:/.test(CODE['js/newsTransport.js']), '1-6: the fetch carries NO custom headers (a custom header would turn a simple GET into a preflighted one the endpoint answers 403 to)');
  // UN-341: the allow-list above is the guard; this is the second, redundant layer (comments stripped — the files' headers name what they never do)
  const AI = /anthropic|claude|scribe-ask|_shared\/anthropic|supabase\.functions\.invoke|\/functions\/v1\/|\.rpc\(|supabase\.from|createClient/i;
  for (const f of NEWS_FILES) assert(!AI.test(CODE[f]), `1-7: ${f} references no AI / Anthropic / Edge function / Supabase client (UN-341)`);
  for (const f of NEWS_FILES) {
    assert(!/CORS_FALLBACKS|attemptFetch|CapacitorHttp|localStorage|\bload\(|\bsave\(|import\(|\beval\(|new Function/.test(CODE[f]), `1-8: ${f} uses no proxy chain, no Capacitor HTTP, no localStorage / load / save, no dynamic import, no eval (S-C11, SD-16)`);
    assert(!/Object\.hasOwn|\.at\(|AbortSignal\.timeout|structuredClone|replaceAll/.test(CODE[f]), `1-9: ${f} is iOS 15.0 safe (no Object.hasOwn, .at(), AbortSignal.timeout, structuredClone, replaceAll)`);
  }
  assert(!/href\s*=\s*["'`$]/.test(CODE['js/newsCard.js']), '1-10: js/newsCard.js builds NO href attribute from anything (W9)');
  assert(!/data-home-action|data-tab|data-comm-target|data-comm-tab|data-haptic/.test(CODE['js/newsCard.js']), '1-11: js/newsCard.js never names data-home-action / data-tab / data-comm-target / data-comm-tab / data-haptic (W9)');
  assert(!/srcset|style=|crossorigin|\bon[a-z]+=/i.test(CODE['js/newsCard.js']), '1-12: the card markup has no srcset / style= / crossorigin / on*= attribute (S-C6, W9)');
  // wiring lists
  const sw = await read('./service-worker.js');
  for (const f of NEWS_FILES) assert(sw.includes(`'./${f}'`), `1-13: service-worker.js STATIC_ASSETS precaches ./${f} (a boot-critical module missing from the shell cache is RG-236)`);
  const lt = await read('./loadtest.mjs');
  for (const f of NEWS_FILES) assert(new RegExp(`'${f.replace('js/', '').replace('.js', '')}'`).test(lt), `1-14: loadtest.mjs [1]'s import list names ${f.replace('js/', '').replace('.js', '')}`);
  assert(/\n {2}'account-exit',\n\]\) \{/.test(lt), "1-15: 'account-exit' is STILL the last entry of loadtest.mjs [1]'s list (accountexittest [11x] pins it) — the news modules sit above it");
  // labels stay in step across the three places that carry them
  assert(JSON.stringify(card.SPORT_CHIP_LABELS) === JSON.stringify(rank.SPORT_LABELS), '1-16: newsCard.SPORT_CHIP_LABELS equals newsRank.SPORT_LABELS (newsCard may not import newsRank, so the pair is pinned here)');
  assert(JSON.stringify(Object.keys(transport.NEWS_SPORT_PATHS)) === JSON.stringify(Array.from(storage.ALLOWED_NEWS_SPORTS)) && JSON.stringify(settingsUi.NEWS_SPORT_KEYS) === JSON.stringify(Array.from(storage.ALLOWED_NEWS_SPORTS)),
    '1-17: the five sports are the same five, in the same order, in the transport map, the prefs allow-list and the settings rows (SD-17)');
  assert(card.NEWS_CARD_REASONS.includes("In this week's slate") && card.NEWS_CARD_REASONS.includes('Your pick') && card.NEWS_CARD_REASONS.includes('Your alma mater') && card.NEWS_CARD_REASONS.includes('Your team') && Object.values(card.SPORT_CHIP_LABELS).every(l => card.NEWS_CARD_REASONS.includes(l)),
    '1-18: the reason pill\'s closed set is the four team / slate labels plus every sport label (DI-377 #6)');
  assert(dataModel.DEFAULT_SETTINGS.newsEnabled === true, '1-19: DEFAULT_SETTINGS.newsEnabled is true (CONVENTIONS #10: a blob that predates the field reads as ON)');
  assert(transport.NEWS_FEATURE_ENABLED === true && transport.NEWS_CACHE_TTL_MS === 15 * 60 * 1000 && transport.NEWS_MAX_RESPONSE_BYTES === 500000 && transport.NEWS_ARTICLE_LIMIT === 20, '1-20: the transport constants are the DI-375 values');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] newsRules — text hygiene; betting headlines are KEPT ([BET-KEEP], SD-6 reversed 2026-10-01)…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const s = rules.stripControlAndBidi;
  assert(s('a\nb\tc\r\nd') === 'a b c d', '2-1: line breaks and tabs become ONE space, never a join');
  assert(s('x' + CH(0x202E) + 'y' + CH(0x200B) + 'z' + CH(0xFEFF) + CH(0x2066) + 'w') === 'xyzw', '2-2: the right-to-left override, zero-width space, BOM and a bidi isolate are removed');
  assert(s('a' + CH(0x85) + CH(0x7F) + CH(0) + 'b') === 'ab', '2-3: C1 controls, DEL and NUL are removed');
  assert(s('a' + CH(0x2028) + 'b' + CH(0x2029) + 'c') === 'a b c', '2-4: the line / paragraph separators read as a space');
  assert(s('  a   b  ') === 'a b' && s(null) === '' && s(undefined) === '' && s(5) === '5' && s({}) === '[object Object]', '2-5: whitespace collapses and trims; a non-string never throws');
  assert(s('<b>ok</b>') === '<b>ok</b>', '2-6: markup is NOT removed here — it is plain text that is escaped again at render');

  // [BET-KEEP] the betting filter is gone (Drew, 2026-10-01: "I want betting news" / "ok to remove betting filter"). Re-adding a drop must be a deliberate, reviewed change.
  assert(JSON.stringify(Object.keys(rules).sort()) === '["stripControlAndBidi"]', '2-7: [BET-KEEP] newsRules exports ONLY stripControlAndBidi — the scored betting filter (bettingVerdict / isBettingItem / the term lists) is removed (SD-6 reversed by Drew, 2026-10-01)');
  const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert(!/bettingVerdict|isBettingItem|HARD_SINGLE|BETTING_|droppedBetting|droppedFilterError/.test(stripComments(CODE['js/newsRules.js']) + stripComments(CODE['js/newsTransport.js']) + stripComments(CODE['js/newsFeed.js'])), '2-8: [BET-KEEP] no betting-filter code remains in newsRules, newsTransport or newsFeed');
  {
    // 2-8b (News delta review, 2026-10-01): the scan now reaches the two files a betting drop could ALSO be hidden in — the card renderer (a `return ''` for a betting headline would silently thin the feed) and Home itself
    // (a filter inside its news splice). Word-bounded, because "between" starts with "bet" (js/home.js's own BETWEEN_SEASONS prose and code).
    const homeCode = stripComments(await read('./js/home.js'));
    const BET_WORDS = /bettingVerdict|isBettingItem|HARD_SINGLE|BETTING_|droppedBetting|droppedFilterError|\bbetting\b|\bbets?\b|\bodds\b|sportsbook|\bparlay\b/i;
    assert(!BET_WORDS.test(CODE['js/newsCard.js']) && !BET_WORDS.test(homeCode),
      '2-8b: [BET-KEEP] no betting-filter code remains in newsCard.js (renderNewsCard) or home.js (the news splice): a betting headline renders as a card like any other (newshometest [8] proves it through the real Home renderer)');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] newsCard — parseArticleUrl, the image hosts, the card, the tap, openExternalUrl…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const U = card.parseArticleUrl;
{
  // S-C1 — the proof cases, verbatim
  assert(U('https://www.espn.com\\@evil.example/') === null, '3-1: the S-C1 PROOF CASE https://www.espn.com\\@evil.example/ is refused (WHATWG reads host www.espn.com, Foundation reads another — the backslash itself is the differential)');
  assert(U('https://www.espn.com@evil.example/') === null, '3-2: its plain-@ sibling is refused (userinfo)');
  assert(U('https://www.espn.com:8443/x') === null && U('https://www.espn.com:443/x') === 'https://www.espn.com/x', '3-3: a non-default port is refused (the default port normalizes away and is not "a port")');
  assert(U('https://espn.com.evil.example/') === null && U('https://notespn.com/') === null && U('https://evilespn.com/') === null && U('https://www.espn.com./') === null, '3-4: a lookalike host, a host that merely ENDS in the letters and a trailing-dot host are refused');
  assert(U('https://user:pw@www.espn.com/') === null && U('https://espn.com@evil.example/') === null, '3-5: userinfo is refused even beside a valid host');
  for (const bad of ['http://www.espn.com/x', '//www.espn.com/x', 'javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'ftp://www.espn.com/', 'https://www.espn.com/a b', 'https://www.espn.com/a\tb', 'https://www.espn.com/a' + CH(0) + 'b', 'https://www.espn.com/' + 'a'.repeat(700), '', 'not a url', 'https://[::1]/']) {
    assert(U(bad) === null, `3-6: refused: ${JSON.stringify(bad.slice(0, 48))}`);
  }
  for (const bad of [null, undefined, 5, {}, [], true]) assert(U(bad) === null, `3-7: a non-string (${JSON.stringify(bad)}) is refused`);
  assert(U('https://www.espn.com/foo') === 'https://www.espn.com/foo' && U('https://x.espn.com/foo') === 'https://x.espn.com/foo' && U('https://espn.com/foo') === 'https://espn.com/foo', '3-8: https://www.espn.com, any *.espn.com subdomain and espn.com are accepted');
  assert(U('HTTPS://WWW.ESPN.COM/Foo?a=1') === 'https://www.espn.com/Foo?a=1' && U('HTTPS://WWW.ESPN.COM/Foo?a=1') !== 'HTTPS://WWW.ESPN.COM/Foo?a=1', '3-9: what comes back is the WHATWG-SERIALIZED href, never the raw input');
  // security C3: after parsing, a hostname is letters, digits, dots and hyphens ONLY (WHATWG tolerates a quote and other odd characters in a host)
  let premise = ''; try { premise = new URL('https://a"b.espn.com/x').hostname; } catch { premise = ''; }
  assert(premise === 'a"b.espn.com', '3-9b: (the premise) the WHATWG parser really does accept a quote in a hostname — so the pattern below is doing real work');
  for (const bad of ['https://a"b.espn.com/x', 'https://a<b.espn.com/x', 'https://a_b.espn.com/x', 'https://a`b.espn.com/x', "https://a'b.espn.com/x", 'https://a{b}.espn.com/x', 'https://a$b.espn.com/x', 'https://a!b.espn.com/x', 'https://a*b.espn.com/x', 'https://a,b.espn.com/x']) {
    assert(U(bad) === null, `3-9c: a hostname outside [a-z0-9.-] is refused: ${JSON.stringify(bad)}`);
  }
  assert(U('https://xn--e1afmkfd.espn.com/x') === 'https://xn--e1afmkfd.espn.com/x' && U('https://a-b.c1.espn.com/x') === 'https://a-b.c1.espn.com/x', '3-9d: punycode and hyphenated ESPN hosts are still accepted');
}
{
  const I = card.isAllowedNewsImageUrl;
  for (const ok of ['https://a.espncdn.com/photo/2026/0929/r1_608x342_16-9.jpg', 'https://s.espncdn.com/x.png', 'https://espnmedia-cdn.akamaized.net/espn/media/common/2026/1001/ss_1.jpg', 'https://x.espn.com/i.jpg']) assert(I(ok) === ok, `3-10: an ESPN CDN picture is allowed: ${ok.slice(8, 40)}`);
  for (const bad of ['http://a.espncdn.com/x.jpg', 'data:image/png;base64,AAAA', 'javascript:alert(1)', 'https://evil.akamaized.net/x.jpg', 'https://espnmedia-cdn.akamaized.net.evil.example/x.jpg', 'https://a.espncdn.com.evil.example/x.jpg', 'https://a.espncdn.com@evil.example/x.jpg', 'https://1.2.3.4/x.jpg', 'https://[::1]/x.jpg', 'https://a.espncdn.com:8443/x.jpg', 'https://a.espncdn.com/' + 'a'.repeat(400), 'https://a.espncdn.com/a b.jpg', 'https://a.espncdn.com\\@evil.example/x', 'https://i0.wp.com/a.espncdn.com/x.jpg', '', null, undefined, 5])
    assert(I(bad) === null, `3-11: refused: ${JSON.stringify(String(bad).slice(0, 52))}`);
  assert(transport.normalizeNewsPayload(payload([article({ images: [{ url: 'https://i0.wp.com/x.jpg' }, { url: 'https://a.espncdn.com/ok.jpg' }] })]), 'cfb', NOW).items[0].imageUrl === 'https://a.espncdn.com/ok.jpg', '3-12: the first picture whose host is on the list is used (a bad first picture does not blank a good second one)');
  for (const bad of ['https://a"b.espncdn.com/x.jpg', 'https://a<b.espncdn.com/x.jpg', 'https://a_b.espncdn.com/x.jpg', 'https://a b.espncdn.com/x.jpg']) assert(I(bad) === null, `3-12b: a picture hostname outside [a-z0-9.-] is refused: ${JSON.stringify(bad)}`);
}
{
  // relativeTime
  const r = (ms) => card.relativeTime(iso(NOW - ms), NOW);
  assert(r(30e3) === 'Just now' && r(5 * MIN) === '5m ago' && r(2 * HOUR) === '2h ago' && r(25 * HOUR) === 'Yesterday' && r(47 * HOUR) === 'Yesterday' && r(49 * HOUR) === '2d ago' && r(-HOUR) === 'Just now' && card.relativeTime('nope', NOW) === '', '3-13: relativeTime buckets (Just now / Nm / Nh / Yesterday / Nd; a future time reads "Just now"; junk reads "")');
}
{
  // renderNewsCard
  const base = item({ reason: "In this week's slate", imageUrl: 'https://a.espncdn.com/photo/x_16-9.jpg', headline: 'Texas quarterback ruled questionable ahead of Oklahoma matchup' });
  const html = card.renderNewsCard(base);
  const count = (s, re) => (s.match(re) || []).length;
  assert(html.startsWith('<div class="card news-card" data-news-id="news_abc" role="link" tabindex="0" aria-label="Texas quarterback ruled questionable ahead of Oklahoma matchup, ESPN">'), '3-14: the card shell, id, role, tabindex and aria-label are the DI-377 markup contract');
  assert(/<img class="news-card__image" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" src="https:\/\/a\.espncdn\.com\/photo\/x_16-9\.jpg">/.test(html), '3-15: the image carries loading="lazy" decoding="async" referrerpolicy="no-referrer" and nothing else (S-C6)');
  assert(!/crossorigin|srcset|style=|\bon[a-z]+=|href=|data-home-action|data-tab|data-comm|data-haptic/i.test(html), '3-16: no crossorigin / srcset / style / on* / href / data-home-action / data-tab / data-comm-* / data-haptic anywhere in the output (W9)');
  assert(html.includes('news-card__reason">In this week&#39;s slate</span>') && html.includes('news-card__pub">ESPN</span>') && html.includes('news-card__sport">CFB</span>') && html.includes('<p class="news-card__headline">Texas quarterback'), '3-17: reason pill, publisher, sport chip and headline are all present (the publisher is never conditional)');
  assert(count(html, /<div/g) === count(html, /<\/div>/g) && count(html, /<span/g) === count(html, /<\/span>/g) && count(html, /<p[ >]/g) === count(html, /<\/p>/g), '3-18: the markup is balanced');
  assert(count(html, /news-card__reason/g) === 1, '3-19: exactly one reason pill');
  const noImg = card.renderNewsCard(item({ imageUrl: null }));
  assert(!/<img/.test(noImg) && !/placeholder/.test(noImg) && noImg.includes('news-card__body'), '3-20: no image -> NO <img> and no placeholder box (the first-class text layout)');
  assert(!/news-card__reason/.test(noImg), '3-20b: no reason -> no pill');
  // hostile
  const HOSTILE = '"><img src=x onerror=alert(1)>';
  const benign = card.renderNewsCard(item({ headline: 'x', reason: 'Your pick' }));
  const hostile = card.renderNewsCard(item({ headline: HOSTILE, reason: 'Your pick' }));
  assert(!/<img src=x/i.test(hostile) && count(hostile, /</g) === count(benign, /</g), '3-21: the hostile headline `"><img src=x onerror=alert(1)>` produces NO raw <img src=x and adds NO literal "<" (every one became &lt;)');
  const aria = /aria-label="([^"]*)"/.exec(hostile);
  const ariaNames = firstTagAttrNames(hostile);
  assert(!!aria && !aria[1].includes('"') && aria[1].includes('&quot;') && /^<div class="card news-card"/.test(hostile) && !ariaNames.some(n => /^on/i.test(n)) && ariaNames.join(',') === 'class,data-news-id,role,tabindex,aria-label', '3-22: no " breakout from the aria-label attribute (the quote is &quot;; the opening tag still has exactly its five attributes, none of them on*)');
  assert(card.renderNewsCard(item({ headline: "O'Brien's \"x\" & <b>y</b>" })).includes("O&#39;Brien&#39;s &quot;x&quot; &amp; &lt;b&gt;y&lt;/b&gt;"), '3-23: the escaper is QUOTE-COMPLETE: & < > " and the apostrophe all escape (the app\'s escHtml leaves the apostrophe)');
  assert(card._escForTest("'") === '&#39;' && card._escForTest(null) === '' && card._escForTest(0) === '0' && card._escForTest(undefined) === '', '3-23b: esc("\'") is &#39;, esc(null) is "", esc(0) is "0" (a plain String replace, no zero-blanking)');
  const evilId = card.renderNewsCard(item({ id: 'x" data-home-action="build-slate' }));
  assert(evilId.includes('data-news-id="x&quot; data-home-action=&quot;build-slate"') && !firstTagAttrNames(evilId).includes('data-home-action'), '3-24: an id carrying a fake data-home-action stays inside its attribute VALUE — it is never an attribute');
  const evilSource = card.renderNewsCard(item({ source: '"><script>alert(1)</script>' }));
  assert(!/<script/i.test(evilSource), '3-25: a hostile source is escaped');
  for (const bad of ['<script>alert(1)</script>', 'Your pick" data-tab="commissioner', 'Someone else\'s pick', 'x']) {
    assert(!/news-card__reason/.test(card.renderNewsCard(item({ reason: bad }))), `3-26: a reason outside the CLOSED set renders NO pill: ${JSON.stringify(bad.slice(0, 40))}`);
  }
  for (const r of card.NEWS_CARD_REASONS) assert(card.renderNewsCard(item({ reason: r })).includes('news-card__reason'), `3-27: the reason "${r}" renders`);
  for (const bad of ['javascript:alert(1)', 'http://a.espncdn.com/x.jpg', 'data:image/png;base64,AAAA', 'https://evil.example/x.jpg', 'https://a.espncdn.com@evil.example/x.jpg'])
    assert(!/<img/.test(card.renderNewsCard(item({ imageUrl: bad }))), `3-28: an image that is not an https ESPN-CDN host renders NO <img>: ${JSON.stringify(bad.slice(0, 40))}`);
  for (const bad of [null, undefined, 5, 'x', [], {}, item({ headline: '' }), item({ headline: '   ' }), item({ source: '' }), item({ id: '' }), item({ sport: 'mlb' }), item({ sport: undefined }), item({ publishedAt: 'nope' }), item({ publishedAt: undefined })])
    assert(card.renderNewsCard(bad) === '', `3-29: bad input renders '' : ${JSON.stringify(bad && bad.headline !== undefined ? { h: bad.headline, s: bad.source, sp: bad.sport, p: bad.publishedAt } : bad)}`);
  assert(card.renderNewsCard(item({ headline: 'z'.repeat(900) })).match(/news-card__headline">(z+)</)[1].length === 300, '3-30: a headline is capped at 300 characters at the sink as well');
  assert(card.renderNewsCard(new Proxy({}, { get() { throw new Error('boom'); } })) === '', '3-31: an item that throws on read renders \'\' (never an exception into Home)');
}
{
  // bindNewsCardEvents (S-C1: resolves by id, never by DOM)
  const mkRoot = () => {
    const l = {};
    return {
      addEventListener(t, f, c) { (l[t] ||= []).push({ f, c }); },
      removeEventListener(t, f) { l[t] = (l[t] || []).filter(x => x.f !== f); },
      fire(t, ev) { for (const x of (l[t] || []).slice()) x.f(ev); },
      count(t) { return (l[t] || []).length; },
    };
  };
  const mkCard = (id, extra = {}) => ({ dataset: { newsId: id }, attrs: { href: 'https://evil.example/' }, getAttribute(n) { return n === 'data-news-id' ? id : (this.attrs[n] || null); }, ...extra });
  const ev = (cardEl, extra = {}) => ({ target: { closest: (sel) => (sel === '.news-card' ? cardEl : null) }, ...extra });
  const items = [item({ id: 'news_a', url: 'HTTPS://WWW.ESPN.COM/College-Football/Story?x=1' }), item({ id: 'news_http', url: 'http://www.espn.com/nhl/preview?gameId=1' }), item({ id: 'news_evil', url: 'https://www.espn.com\\@evil.example/' })];
  const opened = [];
  const root = mkRoot();
  card.bindNewsCardEvents(root, { items, onOpen: (h) => opened.push(h) });
  const c = mkCard('news_a');
  root.fire('click', ev(c));
  assert(opened.length === 1 && opened[0] === 'https://www.espn.com/College-Football/Story?x=1' && opened[0] !== items[0].url, '3-32: a tap opens the WHATWG-serialized href — never the raw item.url');
  c.dataset.url = 'https://evil.example/'; c.dataset.href = 'https://evil.example/'; c.attrs.href = 'https://evil.example/'; c.attrs['data-url'] = 'https://evil.example/';
  opened.length = 0; root.fire('click', ev(c));
  assert(opened.length === 1 && opened[0] === 'https://www.espn.com/College-Football/Story?x=1', '3-33: mutating dataset.url / href / data-url on the rendered card changes NOTHING — the DOM is never consulted for the URL');
  opened.length = 0;
  root.fire('click', ev(mkCard('news_nope'))); root.fire('click', ev(mkCard('news_http'))); root.fire('click', ev(mkCard('news_evil'))); root.fire('click', ev(null)); root.fire('click', { target: {} }); root.fire('click', {});
  assert(opened.length === 0, '3-34: an unknown id, an item whose url FAILS validation at tap time (http; the backslash proof case) and events with no card open NOTHING (re-validated at tap, S-C1 checkpoint 2)');
  // keyboard
  let prevented = 0;
  root.fire('keydown', ev(c, { key: 'Enter', preventDefault() { prevented++; } })); root.fire('keydown', ev(c, { key: ' ', preventDefault() { prevented++; } })); root.fire('keydown', ev(c, { key: 'a', preventDefault() { prevented++; } }));
  assert(opened.length === 2 && prevented === 2, '3-35: Enter and Space on the focused card open it (and prevent the page scroll); other keys do not');
  // items as a function follow a refresh without a rebind
  const root2 = mkRoot(); let list = [items[0]]; const opened2 = [];
  card.bindNewsCardEvents(root2, { items: () => list, onOpen: (h) => opened2.push(h) });
  root2.fire('click', ev(mkCard('news_b')));
  list = [item({ id: 'news_b', url: 'https://www.espn.com/b' })];
  root2.fire('click', ev(mkCard('news_b')));
  assert(opened2.length === 1 && opened2[0] === 'https://www.espn.com/b', '3-36: `items` may be a function: a card that arrives with a refresh opens without rebinding, a vanished one opens nothing');
  // re-binding replaces
  const opened3 = []; const root3 = mkRoot();
  card.bindNewsCardEvents(root3, { items, onOpen: (h) => opened3.push(['first', h]) });
  const unbind = card.bindNewsCardEvents(root3, { items, onOpen: (h) => opened3.push(['second', h]) });
  root3.fire('click', ev(mkCard('news_a')));
  assert(root3.count('click') === 1 && opened3.length === 1 && opened3[0][0] === 'second', '3-37: binding the same root twice REPLACES the first binding (one listener, one open, the latest wiring wins)');
  unbind();
  assert(root3.count('click') === 0 && root3.count('keydown') === 0 && root3.count('error') === 0, '3-38: unbind removes every listener it added');
  // a picture that fails to load is removed, not left as a broken glyph
  const classes = new Set(); const imgEl = { classList: { contains: (c2) => c2 === 'news-card__image', add: (c2) => classes.add(c2) } };
  root.fire('error', { target: imgEl }); root.fire('error', { target: { classList: { contains: () => false, add: () => classes.add('WRONG') } } });
  assert(classes.has('news-card__image--failed') && !classes.has('WRONG'), '3-39: a delegated capture-phase error listener hides a failed .news-card__image (no inline onerror exists)');
  assert(root.count('error') === 1, '3-39b: …registered once per root');
  assert(typeof card.bindNewsCardEvents(null) === 'function' && typeof card.bindNewsCardEvents({}) === 'function', '3-40: a missing root binds nothing and returns a callable unbind');
}
{
  // openExternalUrl (S-C4): the generic https floor, the native path, the web path
  const saved = globalThis.window;
  const log = [];
  globalThis.window = { open: (...a) => log.push(['web', ...a]) };
  assert(platform.openExternalUrl('https://www.espn.com/x') === true && JSON.stringify(log[0]) === JSON.stringify(['web', 'https://www.espn.com/x', '_blank', 'noopener,noreferrer']), '3-41: web: a new tab with noopener,noreferrer');
  log.length = 0;
  for (const bad of ['http://www.espn.com/x', 'javascript:alert(1)', 'data:text/html,x', 'ftp://x', '//x', '', null, undefined, 5, {}]) assert(platform.openExternalUrl(bad) === false, `3-42: openExternalUrl refuses ${JSON.stringify(String(bad).slice(0, 30))} on its own (a floor independent of any caller's allow-list)`);
  assert(log.length === 0, '3-42b: …and neither window.open nor Browser.open was called for any of them');
  const calls = [];
  globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: { Browser: { open: (o) => calls.push(['browser', o]) }, Haptics: { impact: (o) => calls.push(['haptic', o]) } } }, open: (...a) => calls.push(['web', ...a]) };
  assert(platform.openExternalUrl('https://www.espn.com/x') === true && JSON.stringify(calls) === JSON.stringify([['browser', { url: 'https://www.espn.com/x' }]]), '3-43: native: @capacitor/browser gets { url } (the in-app Safari sheet), window.open is not touched');
  calls.length = 0;
  assert(card.openNewsArticle('https://www.espn.com/x') === true && JSON.stringify(calls) === JSON.stringify([['haptic', { style: 'LIGHT' }], ['browser', { url: 'https://www.espn.com/x' }]]), '3-44: native tap: a LIGHT haptic first, then the sheet (Interaction Principles: a secondary action)');
  globalThis.window = { open: (...a) => log.push(['web', ...a]) }; log.length = 0;
  assert(card.openNewsArticle('https://www.espn.com/x') === true && log.length === 1, '3-45: web tap: no haptic (haptic() is a no-op off native), the tab opens');
  globalThis.window = { Capacitor: { isNativePlatform: () => true, Plugins: {} }, open: (...a) => log.push(['web-fallback', ...a]) }; log.length = 0;
  assert(platform.openExternalUrl('https://www.espn.com/x') === true && log[0][0] === 'web-fallback', '3-46: a native shell WITHOUT the Browser plugin falls back to a tab, never throws');
  globalThis.window = {};
  assert(platform.openExternalUrl('https://www.espn.com/x') === false, '3-47: no window.open at all -> false, no throw');
  globalThis.window = saved;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] newsRank — tiers, freshness, matching accuracy, sport gating, no mutation, ownPickTeamNames…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const R = (items, o = {}) => rank.rankNews(items, { now: NOW, ...o });
const tx = (name, short, o = {}) => item({ id: 'news_' + name.replace(/\W/g, ''), teamNames: [name], teamShortNames: [short], ...o });
{
  const longhorns = tx('Texas Longhorns', 'Texas');
  assert(R([longhorns], { slateTeams: ['Texas', 'Oklahoma'], enabledSports: ['cfb'] })[0].reason === "In this week's slate" && R([longhorns], { slateTeams: ['Texas'], enabledSports: ['cfb'] })[0].relevanceTier === 2, '4-1: tier 2 — a team in this week\'s slate (and nobody\'s pick): "In this week\'s slate"');
  assert(R([tx('Clemson Tigers', 'Clemson')], { ownPickTeams: ['Clemson'] })[0].reason === 'Your pick' && R([tx('Clemson Tigers', 'Clemson')], { ownPickTeams: ['Clemson'] })[0].relevanceTier === 1, '4-2: tier 1 — the viewer\'s own pick: "Your pick"');
  assert(R([tx('Tulane Green Wave', 'Tulane')], { slateTeams: ['Texas'], ownPickTeams: ['Tulane'] })[0].reason === 'Your pick', '4-3: a picked team that is NOT on the slate (a manual / off-slate game) still tags "Your pick"');
  assert(R([longhorns], { slateTeams: ['Texas'], ownPickTeams: ['Texas'] })[0].reason === 'Your pick' && R([longhorns], { slateTeams: ['Texas'], ownPickTeams: ['Texas'] })[0].relevanceTier === 1, '4-4: DI-376 amendment (reviewer F2) — a picked team that is ALSO on the slate reads "Your pick" (a pick is almost always a slate game, so with the slate first the label could never render)');
  assert(R([longhorns, tx('Duke Blue Devils', 'Duke', { publishedAt: iso(NOW - 10 * MIN) })], { slateTeams: ['Texas', 'Duke'], ownPickTeams: ['Texas'], enabledSports: ['cfb'] }).map(x => x.reason).join('|') === "Your pick|In this week's slate", '4-4b: …and it sorts FIRST even though the slate-only item is newer (pick is tier 1, slate tier 2)');
  assert(R([tx('Texas A&M Aggies', 'Texas A&M')], { almaMaterTeams: ['Texas A&M'] })[0].reason === 'Your alma mater' && R([tx('Ole Miss Rebels', 'Ole Miss')], { homeTeams: ['Ole Miss'] })[0].reason === 'Your team', '4-5: tier 3 — "Your alma mater" and "Your team" are two distinct labels from two distinct lists');
  assert(R([tx('Texas A&M Aggies', 'Texas A&M')], { almaMaterTeams: ['Texas A&M'], homeTeams: ['Texas A&M'] })[0].reason === 'Your alma mater', '4-6: alma mater beats a team chip for the same school');
  assert(R([item({ sport: 'nfl' })], { enabledSports: ['nfl'] })[0].reason === 'NFL' && R([item({ sport: 'nfl' })], { enabledSports: ['nfl'] })[0].relevanceTier === 4 && R([item({ sport: 'nfl' })], { enabledSports: ['cfb'] }).length === 0, '4-7: tier 4 — a followed sport reads as its sport label; an unfollowed sport with no team match is EXCLUDED');
  assert(R([item({ sport: 'cfb' })], { enabledSports: ['cfb'] }).length === 1, '4-8: #7 — with NO slate, NO picks, NO alma mater and NO chips, a followed sport still ranks (news renders any time)');
  assert(R([item({ sport: 'cfb' }), item({ id: 'n2', sport: 'bogus' })], { enabledSports: ['cfb', 'bogus'] }).length === 1, '4-8b: a sport outside the five never ranks, even if listed');
  // freshness (hard)
  const age = (ms) => item({ id: 'n_age', publishedAt: iso(NOW - ms) });
  assert(R([age(47 * HOUR + 59 * MIN)], { enabledSports: ['cfb'] }).length === 1 && R([age(48 * HOUR + MIN)], { enabledSports: ['cfb'] }).length === 0 && R([age(48 * HOUR)], { enabledSports: ['cfb'] }).length === 1, '4-9: freshness boundary — 47h59m in, 48h01m out, exactly 48h in (a HARD filter, not a sort tiebreak)');
  assert(R([age(-4 * MIN)], { enabledSports: ['cfb'] }).length === 1 && R([age(-6 * MIN)], { enabledSports: ['cfb'] }).length === 0 && R([item({ publishedAt: 'nope' }), item({ publishedAt: undefined })], { enabledSports: ['cfb'] }).length === 0, '4-10: an item dated 4 min ahead is in, 6 min ahead is out, and an unparseable date is out (fail closed)');
  // matching accuracy
  const D = rank.resolveKnownTeamNames;
  assert(JSON.stringify(D(['Texas A&M Aggies'], ['Texas', 'Texas A&M'])) === '["Texas A&M"]' && JSON.stringify(D(['Texas Longhorns'], ['Texas', 'Texas A&M'])) === '["Texas"]', '4-11: the DI\'s Texas / Texas A&M disambiguation, BOTH directions — the longest known candidate wins');
  assert(D(['Duke Blue Devils'], ['Texas', 'Texas A&M']).length === 0 && D(['', null, undefined], ['Texas']).length === 0 && D(['Texas'], []).length === 0, '4-12: an unresolvable description yields NO tag (never a guess)');
  assert(JSON.stringify(D(["Hawai'i Rainbow Warriors", "St. John's Red Storm"], ["Hawai" + CH(0x2019) + "i", "St. John's"])) === JSON.stringify(["Hawai" + CH(0x2019) + "i", "St. John's"]), '4-13: apostrophe / punctuation variants of a name still match (normalized, whole-word prefix)');
  const noShort = (name, o = {}) => item({ id: 'news_' + name.replace(/\W/g, ''), teamNames: [name], teamShortNames: [], ...o });
  assert(R([noShort('Texas A&M Aggies')], { slateTeams: ['Texas'], almaMaterTeams: ['Texas A&M'], enabledSports: [] })[0].reason === 'Your alma mater', '4-14: UNION resolution — a slate "Texas" does not claim an article about Texas A&M whose own school is only in the alma-mater list');
  assert(R([tx('Texas A&M Aggies', 'Texas A&M')], { slateTeams: ['Texas'], enabledSports: ['cfb'] })[0].reason === 'CFB', '4-15: with real ESPN short names, a slate "Texas" does NOT claim a Texas A&M article (exact short-name equality) — it falls to tier 4');
  assert(R([tx('Michigan State Spartans', 'Michigan State')], { slateTeams: ['Michigan'], enabledSports: ['cfb'] })[0].reason === 'CFB' && R([tx('Michigan Wolverines', 'Michigan')], { slateTeams: ['Michigan'], enabledSports: ['cfb'] })[0].reason === "In this week's slate", '4-16: "Michigan" claims Michigan Wolverines and NOT Michigan State Spartans — the common case the DI\'s prefix rule would have got wrong');
  assert(R([tx('Miami (OH) RedHawks', 'Miami (OH)')], { slateTeams: ['Miami'], enabledSports: ['cfb'] })[0].reason === 'CFB' && R([tx('Miami Hurricanes', 'Miami')], { slateTeams: ['Miami'], enabledSports: ['cfb'] })[0].reason === "In this week's slate", '4-17: "Miami" does not claim Miami (OH)');
  assert(R([item({ teamNames: ['University of Iowa', 'Iowa Hawkeyes'], teamShortNames: ['Iowa', 'Iowa'] })], { almaMaterTeams: ['Iowa'] })[0].reason === 'Your alma mater', '4-18: ESPN\'s duplicate "University of X" and "X Hawkeyes" category entries both resolve to the one school');
  // sport gating: a school's name is also a pro team's city
  const steelers = noShort('Pittsburgh Steelers', { sport: 'nfl' }), rockets = noShort('Houston Rockets', { sport: 'nba' }), cougarsBb = noShort('Houston Cougars', { sport: 'cbb' });
  assert(R([steelers], { slateTeams: ['Pittsburgh'], enabledSports: ['nfl'] })[0].reason === 'NFL', '4-19: a CFB slate "Pittsburgh" does NOT label a Pittsburgh STEELERS article "In this week\'s slate" (sport gating — it falls to tier 4)');
  assert(R([steelers], { slateTeams: ['Pittsburgh'], enabledSports: ['nfl'], teamSports: { slate: ['cfb', 'nfl'] } })[0].reason === "In this week's slate", '4-19b: …and the gate is the ONLY reason it did not (widen it and the same item matches)');
  assert(R([rockets], { almaMaterTeams: ['Houston'], enabledSports: ['nba'] })[0].reason === 'NBA' && R([cougarsBb], { almaMaterTeams: ['Houston'], enabledSports: ['cbb'] })[0].reason === 'Your alma mater', '4-20: an alma mater matches college sports (CFB and CBB — the same school) and NOT a pro team that shares its city');
  assert(R([steelers], { ownPickTeams: ['Pittsburgh'], enabledSports: [] }).length === 0, '4-21: a picked CFB "Pittsburgh" does not tag a Steelers article (and with no sport followed it is excluded)');
  assert(R([item({ teamNames: ['Texas Longhorns'], teamShortNames: ['Texas'], sport: 'cfb' })], { slateTeams: ['Texas'], teamSports: { slate: 'cfb' }, enabledSports: [] })[0].reason === "In this week's slate", '4-22: a malformed teamSports entry falls back to the fail-safe default, never to "match anything"');
  // order, determinism, no mutation
  const a = item({ id: 'a', publishedAt: iso(NOW - 3 * HOUR) }), b = item({ id: 'b', publishedAt: iso(NOW - 1 * HOUR) }), c = tx('Texas Longhorns', 'Texas', { id: 'c', publishedAt: iso(NOW - 40 * HOUR) }), d = item({ id: 'd', publishedAt: iso(NOW - 3 * HOUR) });
  const o = R([a, b, c, d], { slateTeams: ['Texas'], enabledSports: ['cfb'] }).map(x => x.id);
  assert(JSON.stringify(o) === '["c","b","a","d"]', `4-23: sorted by tier, then newest first, then id (got ${JSON.stringify(o)})`);
  const shuffles = Array.from({ length: 10 }, (_, i) => [a, b, c, d].map((x, j) => [x, (j * 7 + i * 3) % 5]).sort((p, q) => p[1] - q[1]).map(p => p[0]));
  assert(shuffles.every(sh => JSON.stringify(R(sh, { slateTeams: ['Texas'], enabledSports: ['cfb'] }).map(x => x.id)) === JSON.stringify(o)), '4-24: the same items in ten shuffled orders rank byte-identically (deterministic)');
  const orig = [Object.freeze({ ...a, teamNames: Object.freeze(['x']) })];
  const snapshot = JSON.stringify(orig);
  const ranked = R(orig, { enabledSports: ['cfb'] });
  assert(JSON.stringify(orig) === snapshot && orig[0].reason === null && orig[0].relevanceTier === null && ranked[0] !== orig[0] && ranked[0].reason === 'CFB', '4-25: rankNews NEVER mutates its input (S-C9): the original keeps reason null, the result is a NEW object with the label');
  assert(R(null).length === 0 && R(undefined).length === 0 && R('x').length === 0 && R([null, 5, 'x', undefined], { enabledSports: ['cfb'] }).length === 0, '4-26: junk input ranks to []');
  // ownPickTeamNames — S-C2
  const O = rank.ownPickTeamNames;
  const games = [{ gameId: 'g1', homeTeam: 'Texas', awayTeam: 'Oklahoma' }, { gameId: 'g2', homeTeam: 'Clemson', awayTeam: 'Duke' }];
  const allPicks = [
    { playerId: 'B', gameId: 'g1', selectedTeam: 'Texas' },           // B's OPEN pick comes FIRST
    { playerId: null, gameId: 'g1', selectedTeam: 'Texas' },          // a corrupted row with no player at all
    { playerId: undefined, gameId: 'g2', selectedTeam: 'Duke' },
    { playerId: 'A', gameId: 'g2', selectedTeam: 'Clemson' },
    { playerId: 'A', gameId: 'g2', selectedTeam: 'Wake Forest' },     // not either team of its own game: corrupted
    { playerId: 'A', gameId: 'gX', selectedTeam: 'Texas' },           // no such game
  ];
  assert(JSON.stringify(O(allPicks, games, 'A')) === '["Clemson"]', '4-27: S-C2 — player A gets ONLY A\'s own, game-consistent pick (B\'s earlier row, the null/undefined-player rows, the corrupted selection and the orphan are all ignored)');
  const onlyB = allPicks.filter(p => p.playerId === 'B');
  assert(O(onlyB, games, 'A').length === 0 && O(allPicks, games, 'B').length === 1 && O(allPicks, games, 'B')[0] === 'Texas', '4-28: S-C2 fixture, verbatim — B has an OPEN pick on Texas, A has none: ownPickTeamNames(allPicks, games, "A") is []');
  for (const v of [null, undefined, '', '   ', 5, {}, []]) assert(O(allPicks, games, v).length === 0, `4-29: S-C2 — a falsy / non-string viewer id (${JSON.stringify(v)}) returns [] BEFORE a pick is read, even though the array holds null-player rows`);
  assert(O(null, games, 'A').length === 0 && O(allPicks, null, 'A').length === 0 && O(undefined, undefined, 'A').length === 0, '4-30: missing picks / games arrays read as empty');
  assert(O([{ playerId: 'A', gameId: 'g1', selectedTeam: 'Texas' }, { playerId: 'A', gameId: 'g1', selectedTeam: 'Texas' }], games, 'A').length === 1, '4-31: a repeated pick dedupes');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] newsTransport — normalization, dedupe, TTL, identity, errors, zero network…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const N = (arts, sport = 'cfb', now = NOW, o) => transport.normalizeNewsPayload(payload(arts), sport, now, o);
const serve = (byPath) => mkFetch((url) => {
  const sport = sportOf(url);
  const j = typeof byPath === 'function' ? byPath(sport, url) : byPath[sport];
  if (j === 'fail') return okRes(url, null, { ok: false, status: 503 });
  return okRes(url, j);
});
{
  const one = N([article()]);
  const it0 = one.items[0];
  assert(one.items.length === 1 && it0.source === 'ESPN' && it0.sport === 'cfb' && it0.reason === null && it0.relevanceTier === null, '5-1: a normal article becomes one NewsItem with source "ESPN", its sport, and reason / relevanceTier null (rankNews fills them on a COPY)');
  assert(it0.url === 'https://www.espn.com/college-football/story/_/id/50000001/texas-rolls-past-oklahoma' && /^news_[0-9a-f]+$/.test(it0.id) && it0.publishedAt === iso(NOW - 2 * HOUR), '5-2: the url is the validated href, the id is news_<hex>, publishedAt is normalized ISO');
  assert(JSON.stringify(it0.teamNames) === '["Texas Longhorns"]' && JSON.stringify(it0.teamShortNames) === '["Texas"]' && JSON.stringify(it0.teamIds) === '["251"]', '5-3: team names, short names and the REAL team id (teamId 251, NOT the category\'s own id 1251) come from the type:"team" categories only');
  assert(Object.isFrozen(it0) && Object.isFrozen(it0.teamNames) && Object.isFrozen(it0.teamIds), '5-3b: the cached item is frozen (nothing downstream can mutate it in place)');
  assert(N([article({ categories: [{ id: 5, type: 'team', description: 'Odd FC', team: { id: 77, shortDisplayName: 'Odd' } }] })]).items[0].teamIds[0] === '77' && N([article({ categories: [{ id: 5, type: 'team', description: 'Odd FC' }] })]).items[0].teamIds.length === 0, '5-4: teamId falls back to team.id, and with neither the id list is [] — never the category id, and it never blocks rendering');
  assert(N([article({ categories: [{ type: 'team', description: 'A' }, { type: 'league', description: 'B' }, null, 5, { type: 'team' }] })]).items[0].teamNames.length === 1, '5-5: only type:"team" categories with a string description count; junk entries are skipped');
  // caps and hygiene
  const long = N([article({ headline: 'h'.repeat(900), description: 'd'.repeat(900) })]).items[0];
  assert(long.headline.length === 300 && long.description.length === 500, '5-6: headline is capped at 300 and description at 500 BEFORE the item reaches a card');
  const dirty = N([article({ headline: 'A' + CH(0x202E) + 'B\nC' + CH(0x200B), description: ' \t ' })]).items[0];
  assert(dirty.headline === 'AB C' && dirty.description === null, '5-7: control / bidi characters are stripped, line breaks read as a space, a blank description is null');
  assert(N([article({ headline: 5 }), article({ headline: null }), article({ headline: undefined }), article({ headline: {} }), article({ headline: '   ' }), null, 'x', 5]).items.length === 0, '5-8: a non-string, null, blank headline or a non-object article is dropped — `.slice()` is never called on a non-string');
  const stats = N([article({ headline: 5 })]).stats;
  assert(stats.droppedShape === 1, '5-8b: …and the drop is COUNTED (stats.droppedShape)');
  // links (S-C1 checkpoint 1) and the secret-shaped query keys (SC-N3 d)
  for (const href of ['javascript:alert(1)', 'http://evil.example/x', 'http://www.espn.com.evil.example/x', 'http://www.espn.com@evil.example/x', 'http://www.espn.com:8080/x', 'http://www.espn.com\\@evil.example/', 'ftp://www.espn.com/x', 'https://www.espn.com\\@evil.example/', 'https://evil.example/x', 'https://www.espn.com:8443/x', '', null, undefined, 5]) {
    const r = N([article({ links: { web: { href } } })]);
    assert(r.items.length === 0 && r.stats.refusedLinks === 1, `5-9: a link ${JSON.stringify(String(href).slice(0, 36))} DROPS the item (it has no safe place to go) and counts refusedLinks`);
  }
  assert(N([article({ links: null }), article({ links: {} }), article({ links: { web: null } })]).items.length === 0, '5-9b: missing links / web objects drop the item without throwing');
  for (const q of ['?api_key=abc', '?token=abc', '?x=1&Auth=2', '?sessionid=3', '?SIG=4']) assert(N([article({ links: { web: { href: 'https://www.espn.com/a' + q } } })]).items.length === 0, `5-10: a secret-shaped query key (${q}) drops the link (SC-N3 d)`);
  assert(N([article({ links: { web: { href: 'https://www.espn.com/a?gameId=401&ex_cid=espnapi' } } })]).items.length === 1, '5-10b: ordinary ESPN query keys (gameId, ex_cid) are NOT secret-shaped');
  // http -> https for ESPN's own article hosts ONLY (coordinator ruling, 2026-10-01): the validator is unchanged and still refuses anything that is not https afterwards
  const up = transport.upgradeEspnHttpLink;
  for (const href of ['http://www.espn.com/nhl/recap?gameId=401891821', 'http://www.espn.com/nhl/preview?gameId=401891817', 'HTTP://WWW.ESPN.COM/nhl/recap?gameId=1', 'http://espn.com/x', 'http://x.espn.com/x']) {
    const r = N([article({ links: { web: { href } } })]);
    assert(r.items.length === 1 && r.items[0].url.startsWith('https://') && /^https:\/\/([a-z]+\.)?espn\.com\//.test(r.items[0].url) && r.stats.upgradedLinks === 1 && r.stats.refusedLinks === 0, `5-10c: an NHL-style ${JSON.stringify(href)} is KEPT as https (counted upgradedLinks)`);
  }
  assert(N([article({ links: { web: { href: 'http://www.espn.com/nhl/recap?gameId=401891821' } } })]).items[0].url === 'https://www.espn.com/nhl/recap?gameId=401891821', '5-10d: the kept url is exactly the https twin of the live NHL link');
  for (const href of ['http://evil.example/x', 'http://www.espn.com.evil.example/x', 'http://www.espn.com@evil.example/x', 'http://user:pw@www.espn.com/x', 'http://www.espn.com:8080/x', 'http://www.espn.com\\@evil.example/x', 'http://www.espn.com/a b', 'http://www.espn.com/' + 'a'.repeat(700), 'http://notespn.com/x', 'http://www.espn.com./x']) {
    assert(up(href) === href, `5-10e: the upgrade leaves ${JSON.stringify(href.slice(0, 44))} UNTOUCHED (still http — the validator drops it)`);
    assert(N([article({ links: { web: { href } } })]).items.length === 0, `5-10f: …and the item is dropped end to end`);
  }
  assert(up('https://www.espn.com/x') === 'https://www.espn.com/x' && up('ftp://www.espn.com/x') === 'ftp://www.espn.com/x' && up('javascript:alert(1)') === 'javascript:alert(1)' && up(null) === null && up(undefined) === undefined && up(5) === 5 && up('') === '' && up('//www.espn.com/x') === '//www.espn.com/x', '5-10g: an https link, other schemes, a scheme-relative link and non-strings pass through unchanged');
  assert(card.parseArticleUrl('http://www.espn.com/nhl/recap?gameId=1') === null && card.parseArticleUrl(up('http://www.espn.com/nhl/recap?gameId=1')) === 'https://www.espn.com/nhl/recap?gameId=1', '5-10h: the VALIDATOR is unchanged — it still refuses the http link itself; only the upgraded twin passes');
  assert(N([article({ images: [{ url: 'http://a.espncdn.com/x.jpg' }] })]).items[0].imageUrl === null, '5-10i: picture URLs are NEVER upgraded (an http picture is still refused)');

  // dates (S-C5)
  assert(N([article({ published: 'nope' }), article({ published: '' }), article({ published: undefined }), article({ published: 5 }), article({ published: iso(NOW + 6 * MIN) })]).items.length === 0, '5-11: an unparseable, missing, non-string or more-than-5-minute-future date DROPS the item');
  assert(N([article({ published: iso(NOW + 4 * MIN) })]).items.length === 1, '5-11b: 4 minutes ahead (clock skew) is kept');
  assert(N([article({ published: iso(NOW + 6 * MIN) })]).stats.droppedDate === 1, '5-11c: …and the drop is counted');
  assert(N([article({ published: 'x'.repeat(5000) + '2026-10-01' })]).items.length === 0, '5-11d: the raw date field is capped at 100 characters BEFORE Date.parse');
  // images (S-C6)
  assert(N([article({ images: [{ url: 'https://a.espncdn.com/x.jpg' }] })]).items[0].imageUrl === 'https://a.espncdn.com/x.jpg' && N([article({ images: [{ url: 'http://a.espncdn.com/x.jpg' }] })]).items[0].imageUrl === null && N([article({ images: [{ url: 'https://evil.example/x.jpg' }] })]).items[0].imageUrl === null && N([article({ images: [] })]).items[0].imageUrl === null && N([article({ images: 'x' })]).items[0].imageUrl === null && N([article({ images: [null, 5, {}] })]).items[0].imageUrl === null, '5-12: imageUrl is https + an ESPN CDN host, else null (an item with no usable picture is kept, text-only)');
  // [BET-KEEP] betting content is KEPT like any other headline (SD-6 reversed by Drew, 2026-10-01): the live betting shapes and the review batteries' betting headlines
  const BET_HEADLINES = ['College football Week 5 best bets: The plays to make on Michigan, Alabama ... and UMass?', 'Top 25 betting lines: Ohio State, Florida, Alabama all road favorites this week against the spread',
    'How to bet Steelers Browns on TNF: Analysis, tips and top prop plays', 'Heisman Trophy odds: Arch Manning moves up', 'CFP odds: Who is in, who is out', 'Where to bet on college football this season',
    'Bet the over in Texas-Oklahoma', 'Betting the Iron Bowl', 'College football odds: Georgia, Ohio State lead the way', 'Heisman odds tracker', 'Updated CFP odds for all 25 ranked teams',
    'Point spread for Alabama-Georgia set at 3', 'Betting the SEC: three plays for Saturday', 'How the betting market sees Michigan', 'Super Bowl odds: Chiefs, Eagles favored', 'Texas ATS record is 4-1',
    'DraftKings promo code and parlay picks for Week 6'];
  const betKeep = N(BET_HEADLINES.map((h, k) => article({ headline: h, links: { web: { href: `https://www.espn.com/college-football/story/_/id/${90000 + k}/bet-keep` } } })));
  assert(betKeep.items.length === BET_HEADLINES.length && betKeep.items.every((it, k) => it.headline === BET_HEADLINES[k]), `5-13: [BET-KEEP] all ${BET_HEADLINES.length} betting headlines are KEPT by normalize, in order and unaltered`);
  const betDesk = N([article({ headline: 'Week 6 college football betting: lines, odds and picks', description: 'ESPN BET odds and best bets for every ranked game', categories: [{ id: 1, type: 'topic', description: 'Sports Betting' }], links: { web: { href: 'https://www.espn.com/espn/betting/story/_/id/41234567/week-6-college-football-betting' } } })]);
  assert(betDesk.items.length === 1 && !('droppedBetting' in betDesk.stats) && !('droppedFilterError' in betDesk.stats), '5-14: [BET-KEEP] an ESPN betting-desk article (the /espn/betting/ path, the "Sports Betting" category, an "ESPN BET" description: the live shape) is KEPT, and the stats carry no betting counters');
  // prototype pollution (SC-N7 a, applied to JSON)
  const polluted = JSON.parse('{"articles":[{"headline":"Proto story","__proto__":{"polluted":"yes"},"constructor":{"prototype":{"p2":1}},"published":"' + iso(NOW - HOUR) + '","links":{"web":{"href":"https://www.espn.com/p"}},"categories":[{"type":"team","description":"X","__proto__":{"p3":1}}]}]}');
  const pr = transport.normalizeNewsPayload(polluted, 'cfb', NOW);
  assert(({}).polluted === undefined && ({}).p2 === undefined && ({}).p3 === undefined && pr.items.length === 1 && pr.items[0].polluted === undefined, '5-15: a payload shipping __proto__ / constructor keys pollutes nothing and adds nothing to the item (fixed property names only)');
  // shape
  for (const bad of [null, undefined, 5, 'x', {}, { articles: 'x' }, { articles: {} }]) { const r = await nonThrowing(() => transport.normalizeNewsPayload(bad, 'cfb', NOW)); assert(r.name === 'NewsFetchError' && r.e.code === 'bad_shape', `5-16: a payload with no articles array throws NewsFetchError(bad_shape): ${JSON.stringify(bad)}`); }
  const twenty = N(Array.from({ length: 60 }, (_, i) => article({ headline: 'Story ' + i, links: { web: { href: 'https://www.espn.com/s/' + i } } })));
  assert(twenty.items.length === 20, '5-17: at most 20 articles are read even if the payload ships more');
  assert(N(Array.from({ length: 5 }, () => article({ categories: Array.from({ length: 500 }, (_, i) => team('T' + i, 'T' + i, i)) }))).items[0].teamNames.length === 20, '5-18: at most 20 categories per article are read');
  // canonical id / dedupe
  assert(transport.canonicalizeArticleUrl('https://www.espn.com/a/b/?utm_source=x&id=1#frag') === 'https://www.espn.com/a/b/?id=1' && transport.canonicalizeArticleUrl('https://www.espn.com/a/b/') === 'https://www.espn.com/a/b' && transport.canonicalizeArticleUrl('https://www.espn.com/') === 'https://www.espn.com/' && transport.canonicalizeArticleUrl('https://WWW.espn.com/A?utm_x=1') === 'https://www.espn.com/a' && transport.canonicalizeArticleUrl('::bad::') === '::bad::', '5-19: canonicalizeArticleUrl strips utm_* and the fragment, drops a trailing slash at the end of the string (not the root), lower-cases, and survives junk');
  assert(transport.hashCanonicalUrl('x') === transport.hashCanonicalUrl('x') && transport.hashCanonicalUrl('x') !== transport.hashCanonicalUrl('y'), '5-20: the id is deterministic');
  const dup = N([article(), article({ links: { web: { href: 'https://www.espn.com/college-football/story/_/id/50000001/texas-rolls-past-oklahoma?utm_campaign=z/' } } })]);
  assert(dup.items.length === 1, '5-21: two items with the same canonical url (one utm-decorated) collapse to one');
}
{
  // the fetch itself
  transport.clearNewsCache();
  const f = serve({ cfb: payload([article()]) });
  const r = await withFetch(f, () => transport.fetchNews({ sports: ['cfb'], now: NOW }));
  assert(f.calls.length === 1 && f.calls[0].url === 'https://site.api.espn.com/apis/site/v2/sports/football/college-football/news?limit=20', '5-22: the request is the fixed per-sport URL with limit=20 and nothing else');
  assert(f.calls[0].opts.credentials === 'omit' && f.calls[0].opts.referrerPolicy === 'no-referrer' && !('headers' in f.calls[0].opts) && !('mode' in f.calls[0].opts), "5-23: credentials 'omit', referrerPolicy 'no-referrer', NO custom headers, NO mode override");
  assert(r.items.length === 1 && Object.keys(r.errors).length === 0 && typeof r.stats === 'object', '5-24: fetchNews resolves { items, errors, stats }');
  // five sports, five distinct URLs, paths from the frozen map
  transport.clearNewsCache();
  const f5 = serve((sport) => payload([article({ headline: 'Story for ' + sport, links: { web: { href: 'https://www.espn.com/' + sport + '/story/1' } } })]));
  const r5 = await withFetch(f5, () => transport.fetchNews({ sports: ['cfb', 'nfl', 'nba', 'nhl', 'cbb'], now: NOW }));
  assert(f5.calls.length === 5 && new Set(f5.calls.map(c => c.url)).size === 5 && r5.items.length === 5 && JSON.stringify(r5.items.map(i => i.sport)) === '["cfb","nfl","nba","nhl","cbb"]', '5-25: five sports -> five requests in parallel, five items back in the requested order');
  assert(Object.isFrozen(transport.NEWS_SPORT_PATHS) && transport.espnNewsPath('cfb') === 'football/college-football' && transport.espnNewsPath('mlb') === null && transport.espnNewsPath('__proto__') === null && transport.espnNewsPath('constructor') === null && transport.espnNewsPath(undefined) === null, '5-26: the sport map is frozen and an unknown key is REFUSED (null) — never silently CFB, and prototype names are not keys');
  transport.clearNewsCache();
  const fu = serve({ cfb: payload([article()]) });
  const ru = await withFetch(fu, () => transport.fetchNews({ sports: ['cfb', 'mlb', '__proto__'], now: NOW }));
  assert(fu.calls.length === 1 && ru.items.length === 1 && ru.errors.mlb.code === 'unknown_sport' && ru.errors['__proto__'].code === 'unknown_sport' && Object.getPrototypeOf(ru.errors) === null, '5-27: an unknown sport key makes NO request and is recorded as an error (even "__proto__" is only a key — the errors map has no prototype); the real sport still loads');
  transport.clearNewsCache();
  const fz = mkFetch(() => { throw new Error('must not be called'); });
  const noSports = await withFetch(fz, async () => [await transport.fetchNews({ sports: [], now: NOW }), await transport.fetchNews({ now: NOW }), await transport.fetchNews({ sports: 'cfb', now: NOW }), await transport.fetchNews({ sports: [5, null, {}], now: NOW })]);
  assert(fz.calls.length === 0 && noSports.every(x => x.items.length === 0), '5-28: ZERO fetch calls when no sport is requested, or only junk is (S-C8)');
}
{
  // failures: one error code each, nothing leaks
  const cases = [
    ['http', (url) => okRes(url, null, { ok: false, status: 503 })],
    ['bad_host', (url) => okRes(url, payload([article()]), { resUrl: 'https://evil.example/apis/site/v2/sports/football/college-football/news' })],
    ['bad_host', (url) => okRes(url, payload([article()]), { resUrl: '' })],
    ['too_large', (url) => okRes(url, payload([article()]), { contentLength: 600000 })],
    ['too_large', (url) => okRes(url, null, { text: ' '.repeat(600000) })],
    ['bad_json', (url) => okRes(url, null, { text: '{not json' })],
    ['bad_shape', (url) => okRes(url, { header: 'x' })],
    ['fetch_error', () => { throw new TypeError('Failed to fetch https://site.api.espn.com/secret?token=abc'); }],
  ];
  for (const [code, handler] of cases) {
    transport.clearNewsCache();
    const f = mkFetch(handler);
    const e = await withFetch(f, () => nonThrowing(() => transport.fetchNews({ sports: ['cfb'], now: NOW })));
    assert(e.name === 'NewsUnavailableError' && e.e.sports[0] === 'cfb', `5-29: every sport failing (${code}) -> NewsUnavailableError`);
    const partial = await withFetch(mkFetch((url, o, n) => (sportOf(url) === 'nfl' ? handler(url, o, n) : okRes(url, payload([article()])))), () => transport.fetchNews({ sports: ['cfb', 'nfl'], now: NOW }));
    transport.clearNewsCache();
    assert(partial.items.length === 1 && partial.errors.nfl && partial.errors.nfl.code === code && !/secret|token|espn\.com/.test(partial.errors.nfl.message + String(partial.errors.nfl.cause && partial.errors.nfl.cause.message)), `5-30: one sport failing (${code}) renders the other, records code "${code}", and no URL / query / platform message rides along`);
  }
  // timeout through the real AbortController
  transport.clearNewsCache();
  const slow = mkFetch((url, o) => new Promise((_, rej) => { o.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))); }));
  const t0 = Date.now();
  const te = await withFetch(slow, () => nonThrowing(() => transport.fetchNews({ sports: ['cfb'], timeoutMs: 25, now: NOW })));
  assert(te.name === 'NewsUnavailableError' && Date.now() - t0 < 2000, '5-31: a hanging request times out through an AbortController (no AbortSignal.timeout — iOS 15) -> NewsUnavailableError');
  const timeoutErr = await withFetch(slow, async () => { try { return (await transport.fetchNews({ sports: ['cfb', 'nfl'], timeoutMs: 20, now: NOW })).errors; } catch (e) { return e; } });
  assert(timeoutErr.name === 'NewsUnavailableError', '5-31b: …for every sport at once');
}
{
  // TTL / cache / force / in-flight
  transport.clearNewsCache();
  let n = 0;
  const f = mkFetch((url) => okRes(url, payload([article({ headline: 'Call ' + (++n), links: { web: { href: 'https://www.espn.com/c/' + n } } })])));
  await withFetch(f, async () => {
    const a = await transport.fetchNews({ sports: ['cfb'], now: NOW });
    const b = await transport.fetchNews({ sports: ['cfb'], now: NOW + 14 * MIN });
    assert(f.calls.length === 1 && b.items[0].headline === 'Call 1' && a.items[0] === b.items[0], '5-32: a call inside the TTL returns the cached items with ZERO network (the "cached" rung of the Loading hierarchy)');
    const c = await transport.fetchNews({ sports: ['cfb'], now: NOW + 16 * MIN });
    assert(f.calls.length === 2 && c.items[0].headline === 'Call 2', '5-33: past the 15-minute TTL it refetches');
    const d = await transport.fetchNews({ sports: ['cfb'], force: true, now: NOW + 16 * MIN + 1000 });
    assert(f.calls.length === 3 && d.items[0].headline === 'Call 3', '5-34: force:true (pull-to-refresh) ALWAYS refetches, TTL or not');
    const e = await transport.fetchNews({ sports: ['cfb', 'nfl'], now: NOW + 16 * MIN + 2000 });
    assert(f.calls.length === 4 && f.calls[3].url.includes('/nfl/'), '5-35: the TTL is per sport — the cached sport is served, only the missing one is fetched');
  });
  // in-flight dedupe
  transport.clearNewsCache();
  let release; const gate = new Promise(r => { release = r; });
  const fg = mkFetch(async (url) => { await gate; return okRes(url, payload([article()])); });
  const pair = await withFetch(fg, async () => { const p1 = transport.fetchNews({ sports: ['cfb'], now: NOW }); const p2 = transport.fetchNews({ sports: ['cfb'], force: true, now: NOW }); await flush(); release(); return Promise.all([p1, p2]); });
  assert(fg.calls.length === 1 && pair[0].items.length === 1 && pair[1].items.length === 1, '5-36: two simultaneous callers for the same sport share ONE request');
  // a failed forced refresh falls back to a still-fresh cache
  transport.clearNewsCache();
  let fail = false;
  const ff = mkFetch((url) => (fail ? okRes(url, null, { ok: false, status: 500 }) : okRes(url, payload([article()]))));
  await withFetch(ff, async () => {
    await transport.fetchNews({ sports: ['cfb'], now: NOW });
    fail = true;
    const r = await transport.fetchNews({ sports: ['cfb'], force: true, now: NOW + 2 * MIN });
    assert(r.items.length === 1 && Object.keys(r.errors).length === 0, '5-37: a failed forced refresh serves the still-fresh cached items instead (offline, cache available)');
    const stale = await nonThrowing(() => transport.fetchNews({ sports: ['cfb'], force: true, now: NOW + 30 * MIN }));
    assert(stale.name === 'NewsUnavailableError', '5-38: …but a STALE (past TTL) entry is never served: failure with nothing fresh -> NewsUnavailableError (offline, nothing cached)');
  });
}
{
  // identity (S-C9): the real primitives, the reviewer's exact failing sequence
  transport.clearNewsCache();
  lsStore.set('cfbp_supabase_active_league', 'L1');
  let release; const gate = new Promise(r => { release = r; });
  const f = mkFetch(async (url) => { await gate; return okRes(url, payload([article()])); });
  const res = await withFetch(f, async () => {
    const p = nonThrowing(() => transport.fetchNews({ sports: ['cfb'], now: NOW }));
    await flush();
    auth._bumpIdentityEpochForTest('newstest');          // a sign-out / a different player signs in while the request is in flight
    release();
    return p;
  });
  assert(res.name === 'NewsUnavailableError' && res.e.reason === 'identity' && transport._newsCacheSizeForTest() === 0, '5-39: the identity EPOCH moves while a request is in flight -> the result is discarded: never cached, never returned (the S-C9 sequence)');
  transport.clearNewsCache();
  let release2; const gate2 = new Promise(r => { release2 = r; });
  const f2 = mkFetch(async (url) => { await gate2; return okRes(url, payload([article()])); });
  const res2 = await withFetch(f2, async () => {
    const p = nonThrowing(() => transport.fetchNews({ sports: ['cfb'], now: NOW }));
    await flush();
    lsStore.set('cfbp_supabase_active_league', 'L2');      // a league switch mid-flight
    release2();
    return p;
  });
  assert(res2.name === 'NewsUnavailableError' && transport._newsCacheSizeForTest() === 0, '5-40: the active LEAGUE moves mid-flight -> discarded, never cached');
  // a cache entry written under one identity is a MISS under another
  transport.clearNewsCache();
  lsStore.set('cfbp_supabase_active_league', 'L1');
  const f3 = serve({ cfb: payload([article()]) });
  await withFetch(f3, async () => {
    await transport.fetchNews({ sports: ['cfb'], now: NOW });
    await transport.fetchNews({ sports: ['cfb'], now: NOW + MIN });
    assert(f3.calls.length === 1, '5-41: (control) the same identity is served from cache');
    lsStore.set('cfbp_supabase_active_league', 'L2');
    await transport.fetchNews({ sports: ['cfb'], now: NOW + 2 * MIN });
    assert(f3.calls.length === 2, '5-42: a different LEAGUE reads the cache as a miss (entries carry the token they were written under — safe even if clearNewsCache() is never called)');
    auth._bumpIdentityEpochForTest('newstest-2');
    await transport.fetchNews({ sports: ['cfb'], now: NOW + 3 * MIN });
    assert(f3.calls.length === 3, '5-43: a different identity EPOCH reads the cache as a miss');
  });
  transport.clearNewsCache();
  assert(transport._newsCacheSizeForTest() === 0 && transport._resetNewsTransportForTest === transport.clearNewsCache, '5-44: clearNewsCache() empties it (the identity chokepoint\'s hook); the test seam is the same function');
  lsStore.delete('cfbp_supabase_active_league');
  // errors carry fixed codes only
  const err = new transport.NewsFetchError('cfb', new TypeError('Failed to fetch https://site.api.espn.com/x?token=abc'));
  assert(err.code === 'fetch_error' && err.cause.message === 'fetch_error' && !/token|espn/.test(err.message + err.cause.message) && new transport.NewsFetchError('cfb', Object.assign(new Error('x'), { name: 'AbortError' })).code === 'timeout' && new transport.NewsFetchError('cfb', 'nonsense').code === 'fetch_error' && new transport.NewsFetchError('cfb', new SyntaxError('x')).code === 'bad_json', '5-45: NewsFetchError maps any cause to a FIXED sentinel code — a URL, query or platform message never rides along (SC-N3 b, applied to the client)');
  assert(new transport.NewsUnavailableError(['cfb']).name === 'NewsUnavailableError' && new transport.NewsUnavailableError(['cfb']).reason === 'fetch', '5-46: NewsUnavailableError carries the sports and a reason');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5b] Security C4 — the byte cap is enforced WHILE the body streams…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const enc = new TextEncoder();
  const streamed = (chunks, st) => (url) => ({
    ok: true, status: 200, url, headers: { get: () => null }, text: async () => { st.textCalled = true; return ''; },
    body: { getReader() { let i = 0; return { async read() { st.reads++; if (i >= chunks.length) return { done: true, value: undefined }; return { done: false, value: chunks[i++] }; }, async cancel() { st.cancelled = true; } }; } },
  });
  // 1) a stream far over the cap, with no content-length: reading STOPS at the cap, the reader is cancelled and the request aborted
  transport.clearNewsCache();
  const st1 = { reads: 0, cancelled: false, textCalled: false };
  const f1 = mkFetch((url) => (sportOf(url) === 'cfb' ? streamed(Array.from({ length: 200 }, () => new Uint8Array(100000)), st1)(url) : okRes(url, payload([article()]))));
  const r1 = await withFetch(f1, () => transport.fetchNews({ sports: ['cfb', 'nfl'], now: NOW }));
  assert(r1.errors.cfb && r1.errors.cfb.code === 'too_large' && r1.items.length === 1, '5b-1: a 20 MB stream is refused as too_large (the other sport still loads)');
  assert(st1.reads <= 7, `5b-2: …after reading ${st1.reads} chunks, not 200 — it stopped AT the cap instead of buffering the whole body (500 KB / 100 KB chunks = 6 reads)`);
  const cfbCall = f1.calls.find(c => c.url.includes('/college-football/'));
  assert(st1.cancelled === true && cfbCall.opts.signal.aborted === true && st1.textCalled === false, '5b-3: …the reader was cancelled, the request aborted, and res.text() was never used');
  // 2) a valid body streamed in chunks parses, including a multi-byte character split across two chunks
  transport.clearNewsCache();
  const headline = 'Café résumé — naïve plan';
  const bytes = enc.encode(JSON.stringify(payload([article({ headline })])));
  const cut = bytes.indexOf(0xC3) + 1;                         // inside the two-byte "é"
  const st2 = { reads: 0, cancelled: false, textCalled: false };
  const r2 = await withFetch(mkFetch(streamed([bytes.slice(0, cut), bytes.slice(cut)], st2)), () => transport.fetchNews({ sports: ['cfb'], now: NOW }));
  assert(r2.items.length === 1 && r2.items[0].headline === headline && st2.textCalled === false && st2.cancelled === false, '5b-4: a streamed body under the cap parses, a character split across two chunks stays intact, and nothing is cancelled');
  // 3) a body under the cap but large (about 400 KB in four chunks) is fine
  transport.clearNewsCache();
  const big = enc.encode(JSON.stringify({ articles: [article()], pad: 'x'.repeat(400000) }));
  const quarter = Math.ceil(big.length / 4);
  const st3 = { reads: 0, cancelled: false, textCalled: false };
  const r3 = await withFetch(mkFetch(streamed([0, 1, 2, 3].map(k => big.slice(k * quarter, (k + 1) * quarter)), st3)), () => transport.fetchNews({ sports: ['cfb'], now: NOW }));
  assert(r3.items.length === 1 && st3.reads === 5 && st3.cancelled === false, '5b-5: a ~400 KB body under the cap streams through in full (four chunks and the done read)');
  // 4) a chunk that is not bytes is a fetch error, and the stream is released
  transport.clearNewsCache();
  const st4 = { reads: 0, cancelled: false, textCalled: false };
  const r4 = await withFetch(mkFetch((url) => (sportOf(url) === 'cfb' ? streamed(['not bytes'], st4)(url) : okRes(url, payload([article()])))), () => transport.fetchNews({ sports: ['cfb', 'nfl'], now: NOW }));
  assert(r4.errors.cfb && r4.errors.cfb.code === 'fetch_error' && st4.cancelled === true, '5b-6: a chunk that is not bytes is a fetch_error and the reader is cancelled');
  // 5) no readable body (older environments, the other tests' fakes): the res.text() fallback still enforces the same cap
  transport.clearNewsCache();
  const r5 = await withFetch(mkFetch((url) => okRes(url, null, { text: JSON.stringify({ articles: [], pad: 'x'.repeat(600000) }) })), () => nonThrowing(() => transport.fetchNews({ sports: ['cfb'], now: NOW })));
  assert(r5.name === 'NewsUnavailableError', '5b-7: with no res.body the text() fallback still refuses an over-cap body');
  // 6) a mid-stream network error maps to a fixed code
  transport.clearNewsCache();
  const r6 = await withFetch(mkFetch((url) => ({ ok: true, status: 200, url, headers: { get: () => null }, body: { getReader() { return { async read() { throw new TypeError('network lost https://site.api.espn.com/secret?token=x'); }, async cancel() {} }; } } })), () => nonThrowing(() => transport.fetchNews({ sports: ['cfb', 'nfl'], now: NOW })));
  assert(r6.name === 'NewsUnavailableError', '5b-8: a stream that errors mid-body fails the sport calmly (no message or URL escapes)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] The kill switch — three layers, AND\'d…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const A = transport.isNewsAvailable;
  const combos = [[undefined, undefined, true], [true, undefined, true], [undefined, true, true], [true, true, true], [false, undefined, false], [false, true, false], [undefined, false, false], [true, false, false], [false, false, false]];
  for (const [league, player, want] of combos) {
    assert(A({ leagueSettings: league === undefined ? {} : { newsEnabled: league }, playerPrefs: player === undefined ? {} : { on: player } }) === want, `6-1: league ${league} + player ${player} -> ${want} (code constant on)`);
  }
  assert(A() === true && A({}) === true && A({ leagueSettings: undefined, playerPrefs: undefined }) === true && A({ leagueSettings: null, playerPrefs: null }) === true, '6-2: absent settings / prefs read as ON (CONVENTIONS #10) — only an explicit false gates');
  assert(A({ leagueSettings: { newsEnabled: 0 } }) === true && A({ leagueSettings: { newsEnabled: 'false' } }) === true && A({ playerPrefs: { on: 0 } }) === true && A({ playerPrefs: { on: null } }) === true, '6-3: only the BOOLEAN false gates (0, "false", null do not)');
  assert(A({ leagueSettings: { newsEnabled: false }, playerPrefs: { on: true } }) === false, '6-4: a commissioner\'s league-off beats a player\'s own on:true (AND, never OR)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] News preferences in storage — untrusted on read, validated on write, the one-time seed…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const P = dataModel.createPlayer('Drew', 'd@example.com', '0000', 'Texas A&M');
  P.playerId = 'pNews';
  storage.savePlayer(P);
  storage.setSession('pNews');
  const put = (news) => { const p = storage.getPlayer('pNews'); storage.savePlayer({ ...p, preferences: { ...(p.preferences || {}), news } }); };
  const clear = () => { const p = storage.getPlayer('pNews'); const prefs = { ...(p.preferences || {}) }; delete prefs.news; storage.savePlayer({ ...p, preferences: prefs }); };
  clear();
  assert(JSON.stringify(storage.getNewsPrefs()) === '{"on":true,"sports":["cfb"],"teams":[]}', '7-1: defaults — on, the league\'s sport, no teams (a record that predates the feature reads as "just my league\'s sport", never "everything", never "nothing")');
  put({ on: false });
  assert(storage.getNewsPrefs().on === false, '7-2: an explicit on:false turns it off');
  for (const bad of [0, null, 'false', 'no', {}, [], 1, 'off']) { put({ on: bad }); assert(storage.getNewsPrefs().on === true, `7-3: on:${JSON.stringify(bad)} reads as ON — only an explicit boolean false turns it off (S-C7)`); }
  put({ sports: ['cfb', 'nfl', 'mlb', 5, null, 'cfb', '__proto__', {}], teams: [] });
  assert(JSON.stringify(storage.getNewsPrefs().sports) === '["cfb","nfl"]', '7-4: sports keeps only the five known keys, once each — junk is dropped, never coerced');
  put({ sports: [] });
  assert(JSON.stringify(storage.getNewsPrefs().sports) === '[]', '7-5: a validly EMPTY sports array is PRESERVED (the player unchecked every sport on purpose)');
  for (const bad of ['cfb', 5, null, {}, true]) { put({ sports: bad }); assert(JSON.stringify(storage.getNewsPrefs().sports) === '["cfb"]', `7-6: a non-array sports (${JSON.stringify(bad)}) falls back to the league sport`); }
  put({ teams: Array.from({ length: 500 }, (_, i) => 'Team ' + i) });
  assert(storage.getNewsPrefs().teams.length === 20, '7-7: a 500-entry teams array is capped at 20');
  put({ teams: ['x'.repeat(10000), 5, null, {}, '  ', 'Texas A&M', 'texas a&m'] });
  const t = storage.getNewsPrefs().teams;
  assert(t.length === 2 && t[0].length === 100 && t[1] === 'Texas A&M', '7-8: a 10,000-character team is cut to 100, non-strings and blanks are dropped, a case-insensitive duplicate collapses');
  for (const bad of [null, 5, 'x', [], [1, 2]]) { put(bad); assert(JSON.stringify(storage.getNewsPrefs()) === '{"on":true,"sports":["cfb"],"teams":[]}', `7-9: a stored news value of ${JSON.stringify(bad)} reads as the defaults`); }
  // write seam
  clear();
  storage.setNewsPrefs({ sports: ['nfl', 'bogus', 'cfb'], on: 'yes', teams: ['Texas', 5], evil: 1 });
  const stored = storage.getPlayer('pNews').preferences.news;
  assert(JSON.stringify(stored) === '{"on":true,"sports":["nfl","cfb"],"teams":["Texas"]}', `7-10: setNewsPrefs validates what it writes — junk sports and non-string teams are refused, a non-boolean on is ignored, unknown keys are not stored (got ${JSON.stringify(stored)})`);
  storage.setNewsPrefs({ on: false });
  assert(storage.getNewsPrefs().on === false && JSON.stringify(storage.getNewsPrefs().sports) === '["nfl","cfb"]', '7-11: a patch merges onto the validated current value');
  // the one-time seed
  clear();
  assert(storage.seedNewsTeamsOnce() === true && JSON.stringify(storage.getNewsPrefs().teams) === '["Texas A&M"]', '7-12: the FIRST open seeds the alma-mater chip');
  storage.setNewsPrefs({ teams: [] });
  assert(storage.seedNewsTeamsOnce() === false && storage.getNewsPrefs().teams.length === 0, '7-13: a chip the player REMOVED does not silently reappear (the sentinel survives a later write)');
  storage.setNewsPrefs({ on: true, sports: ['cfb'] });
  assert(storage.seedNewsTeamsOnce() === false && storage.getPlayer('pNews').preferences.news.seeded === true, '7-14: …even after other prefs are written');
  clear();
  storage.setNewsPrefs({ teams: ['Texas A&M'] });
  assert(storage.seedNewsTeamsOnce() === true && JSON.stringify(storage.getNewsPrefs().teams) === '["Texas A&M"]', '7-15: seeding never duplicates a chip the player already has');
  put({ seeded: 'yes' });
  assert(storage.seedNewsTeamsOnce() === true, '7-16: only the boolean true is the sentinel (a stored string "yes" does not stop the seed)');
  // anonymous
  storage.clearSession();
  assert(storage.setNewsPrefs({ on: false }) === false && storage.seedNewsTeamsOnce() === false && JSON.stringify(storage.getNewsPrefs()) === '{"on":true,"sports":["cfb"],"teams":[]}', '7-17: signed out, reads are the defaults and writes / the seed do nothing (no shared-device fallback)');
  storage.setSession('pNews');
  // league-layer read path
  storage.saveSetting('newsEnabled', false);
  assert(storage.getSettings().newsEnabled === false && transport.isNewsAvailable({ leagueSettings: storage.getSettings(), playerPrefs: storage.getNewsPrefs() }) === false, '7-18: saveSetting("newsEnabled", false) is read back through getSettings() and gates isNewsAvailable');
  storage.saveSetting('newsEnabled', true);
  assert(storage.getSettings().newsEnabled === true, '7-19: …and true turns it back on');
  clear();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] newsFeed — the Home adapter and the settings ctx…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const mkWorld = (o = {}) => {
  const week = { weekId: 'w9', status: 'open', ...(o.week || {}) };
  const games = o.games || [{ gameId: 'g1', weekId: 'w9', homeTeam: 'Texas', awayTeam: 'Oklahoma', status: 'scheduled' }, { gameId: 'g2', weekId: 'w9', homeTeam: 'Clemson', awayTeam: 'Duke', status: 'final' }, { gameId: 'g3', weekId: 'w9', homeTeam: 'Auburn', awayTeam: 'Texas A&M', espnSport: 'nfl' }];
  const picks = o.picks || [{ playerId: 'B', gameId: 'g1', selectedTeam: 'Texas' }, { playerId: 'A', gameId: 'g2', selectedTeam: 'Clemson' }];
  return { week, games, picks, viewer: o.viewer === undefined ? 'A' : o.viewer, alma: o.alma === undefined ? 'Texas A&M' : o.alma, prefs: o.prefs || { on: true, sports: ['cfb'], teams: [] }, settings: o.settings || {}, id: o.id || { epoch: 1, leagueId: 'L1' } };
};
const mkRead = (w) => ({
  prefs: () => w.prefs, settings: () => w.settings, viewerId: () => w.viewer, almaMater: () => w.alma,
  week: () => w.week, games: () => w.games, picks: () => w.picks, identity: () => w.id,
});
const mkTransport = (items, track = { calls: [] }) => ({ fetchNews: async (args) => { track.calls.push(args); if (items instanceof Error) throw items; return { items, errors: {}, stats: {} }; } });
const espnItem = (name, short, o = {}) => item({ id: 'news_' + name.replace(/\W/g, '') + (o.id || ''), teamNames: [name], teamShortNames: [short], ...o });
{
  const track = { calls: [] };
  const w = mkWorld();
  const items = [espnItem('Texas Longhorns', 'Texas'), espnItem('Clemson Tigers', 'Clemson'), espnItem('Texas A&M Aggies', 'Texas A&M'), item({ id: 'news_gen' })];
  const home = feed.createHomeNews({ read: mkRead(w), transport: mkTransport(items, track), now: () => NOW });
  const out = await home.fetchNews({ force: false });
  assert(Array.isArray(out) && out.length === 4 && JSON.stringify(track.calls[0]) === '{"sports":["cfb"],"force":false,"now":' + NOW + '}', '8-1: fetchNews asks the transport for the player\'s own sports only (nothing else is a request input)');
  const label = (id) => out.find(x => x.id === id).reason;
  assert(label('news_TexasLonghorns') === "In this week's slate" && label('news_ClemsonTigers') === 'Your pick' && label('news_TexasAMAggies') === 'Your alma mater' && label('news_gen') === 'CFB', '8-2: viewer A picked Clemson, who is on the slate: "Your pick" (F2); an unpicked slate team, the alma mater and the sport label come out as the DI says');
  const inputs = feed.buildRankInputs(mkRead(w));
  assert(JSON.stringify(inputs.slateTeams) === '["Texas","Oklahoma","Clemson","Duke"]', '8-3: SC-N13(b) — the slate is EVERY game of the current published week, home and away, final or not; a manual NFL game in a CFB league is not a CFB slate team');
  assert(JSON.stringify(inputs.ownPickTeams) === '["Clemson"]', '8-4: the viewer\'s own picks come from ownPickTeamNames over the FULL picks array — B\'s Texas pick is not A\'s');
  assert(JSON.stringify(inputs.teamSports) === '{"slate":["cfb"],"pick":["cfb"],"alma":["cfb","cbb"],"home":["cfb","cbb"]}', '8-5: team groups are sport-gated (slate / picks to the league sport, alma / chips to college sports)');
  {
    // reviewer F2 end to end: the REAL buildRankInputs, the picked team ON the slate, the card reads "Your pick" — and nobody else's pick ever does
    const pw = mkWorld({ picks: [{ playerId: 'A', gameId: 'g1', selectedTeam: 'Texas' }, { playerId: 'B', gameId: 'g2', selectedTeam: 'Duke' }] });
    const articles = [espnItem('Texas Longhorns', 'Texas', { id: '_a' }), espnItem('Duke Blue Devils', 'Duke', { id: '_b' }), espnItem('Clemson Tigers', 'Clemson', { id: '_c', publishedAt: iso(NOW - 10 * MIN) })];
    const rankedA = rank.rankNews(articles, { ...feed.buildRankInputs(mkRead(pw)), now: NOW });
    const byId = (list, id) => list.find(x => x.id === id);
    assert(byId(rankedA, '_a').reason === 'Your pick' && byId(rankedA, '_a').relevanceTier === 1, '8-5b: F2 — viewer A picked Texas (on the slate): the Texas article reads "Your pick", tier 1');
    assert(byId(rankedA, '_b').reason === "In this week's slate", '8-5c: BLIND — B picked Duke, A did not: the Duke article is an ordinary slate item for A, never "Your pick"');
    assert(rankedA[0].id === '_a', '8-5d: …and A\'s picked team\'s article sorts first, ahead of a NEWER slate item');
    assert(card.renderNewsCard(byId(rankedA, '_a')).includes('news-card__reason">Your pick</span>') && !card.renderNewsCard(byId(rankedA, '_b')).includes('Your pick'), '8-5e: the rendered card carries the "Your pick" pill for A\'s pick only');
    const rankedNobody = rank.rankNews(articles, { ...feed.buildRankInputs(mkRead({ ...pw, viewer: null })), now: NOW });
    assert(rankedNobody.every(x => x.reason !== 'Your pick'), '8-5f: BLIND — a signed-out viewer gets no "Your pick" label from anyone\'s picks');
    const rankedC = rank.rankNews(articles, { ...feed.buildRankInputs(mkRead({ ...pw, viewer: 'C' })), now: NOW });
    assert(rankedC.every(x => x.reason !== 'Your pick'), '8-5g: BLIND — viewer C, who picked nothing, gets none');
  }
  // blind rule — the one place this feature could leak a pick
  const nobody = mkWorld({ viewer: null });
  assert(feed.buildRankInputs(mkRead(nobody)).ownPickTeams.length === 0, '8-6: BLIND RULE — a viewer with no id gets NO pick tier even though the league\'s picks are all in the array');
  const nobodyOut = await feed.createHomeNews({ read: mkRead(nobody), transport: mkTransport([espnItem('Texas Longhorns', 'Texas'), espnItem('Clemson Tigers', 'Clemson')]), now: () => NOW }).fetchNews();
  assert(nobodyOut.every(x => x.reason !== 'Your pick'), '8-7: BLIND RULE — nothing is ever labelled "Your pick" for a signed-out viewer');
  const onlyOthers = mkWorld({ viewer: 'C', picks: [{ playerId: 'A', gameId: 'g2', selectedTeam: 'Duke' }, { playerId: 'B', gameId: 'g1', selectedTeam: 'Oklahoma' }] });
  assert(feed.buildRankInputs(mkRead(onlyOthers)).ownPickTeams.length === 0, '8-8: BLIND RULE — viewer C, who picked nothing, sees no pick label sourced from A\'s or B\'s picks');
  // every week status
  for (const [status, expectSlate] of [['draft', false], ['open', true], ['locked', true], ['live', true], ['final', false], ['bogus', false], [undefined, false]]) {
    const wi = feed.buildRankInputs(mkRead(mkWorld({ week: { status } })));
    assert((wi.slateTeams.length > 0) === expectSlate && (expectSlate || wi.ownPickTeams.length === 0), `8-9: week status ${status}: slate ${expectSlate ? 'built' : 'EMPTY'} (${expectSlate ? 'published and still this week' : 'a draft slate is unpublished, a final week is over — tier 4 still works'})`);
  }

  const noWeek = mkRead(mkWorld()); noWeek.week = () => null;
  assert(feed.buildRankInputs(noWeek).slateTeams.length === 0, '8-9c: no week at all -> no slate, no pick tier');
  // NFL league
  const nflLeague = mkWorld({ settings: { sport: 'nfl' }, games: [{ gameId: 'n1', homeTeam: 'Green Bay', awayTeam: 'Chicago', espnSport: 'nfl' }, { gameId: 'c1', homeTeam: 'Texas', awayTeam: 'Duke' }] });
  const ni = feed.buildRankInputs(mkRead(nflLeague));
  assert(JSON.stringify(ni.slateTeams) === '["Green Bay","Chicago"]' && JSON.stringify(ni.teamSports.slate) === '["nfl"]', '8-10: in an NFL league the slate is the NFL games and the slate gate is the NFL (a CFB game is not its slate)');
  assert(feed.leagueSportOf({ sport: 'nfl' }) === 'nfl' && feed.leagueSportOf({ sport: 'mlb' }) === 'cfb' && feed.leagueSportOf({}) === 'cfb' && feed.leagueSportOf(null) === 'cfb', '8-11: the league sport is one of the five, else CFB');
  // alma mater / chips
  const chips = mkWorld({ prefs: { on: true, sports: ['cfb'], teams: ['Texas A&M', 'Ole Miss'] } });
  assert(JSON.stringify(feed.buildRankInputs(mkRead(chips)).homeTeams) === '["Ole Miss"]' && JSON.stringify(feed.buildRankInputs(mkRead(chips)).almaMaterTeams) === '["Texas A&M"]', '8-12: homeTeams = the chips BEYOND the alma mater (the DI-376 interpretation, Open Item 3)');
  // OFF: null, zero requests
  for (const [name, w2] of [['the player\'s own switch', mkWorld({ prefs: { on: false, sports: ['cfb'], teams: [] } })], ['the league switch', mkWorld({ settings: { newsEnabled: false } })]]) {
    const tr = { calls: [] };
    const h = feed.createHomeNews({ read: mkRead(w2), transport: mkTransport([item()], tr), now: () => NOW });
    const r = await h.fetchNews({ force: true });
    assert(r === null && tr.calls.length === 0 && h.isOn() === false && h.currentItems().length === 0, `8-13: OFF by ${name}: fetchNews resolves null (Home renders NOTHING for the slot) and makes ZERO transport calls (S-C8)`);
  }
  {
    // zero NETWORK end to end (the real transport, a counting fake fetch), off at either layer
    transport.clearNewsCache();
    const counter = mkFetch(() => { throw new Error('must not be called'); });
    const offA = feed.createHomeNews({ read: mkRead(mkWorld({ prefs: { on: false, sports: ['cfb'], teams: [] } })), now: () => NOW });
    const offB = feed.createHomeNews({ read: mkRead(mkWorld({ settings: { newsEnabled: false } })), now: () => NOW });
    const html = [];
    await withFetch(counter, async () => { for (const h of [offA, offB]) { const r = await h.fetchNews({ force: true }); html.push(r === null ? '' : 'rendered'); } });
    assert(counter.calls.length === 0 && html.every(x => x === ''), '8-14: S-C8 — with news off (either layer) a simulated render cycle makes ZERO fetch calls through the REAL transport, and there is no card, so no image request exists either');
  }
  // empty / error
  {
    const noSports = feed.createHomeNews({ read: mkRead(mkWorld({ prefs: { on: true, sports: [], teams: ['Texas'] } })), transport: mkTransport([]), now: () => NOW });
    const withSports = feed.createHomeNews({ read: mkRead(mkWorld()), transport: mkTransport([]), now: () => NOW });
    const offNoSports = feed.createHomeNews({ read: mkRead(mkWorld({ prefs: { on: false, sports: [], teams: [] } })), transport: mkTransport([]), now: () => NOW });
    assert(noSports.emptyCopy() === 'Pick at least one sport in News settings.' && feed.NEWS_EMPTY_NO_SPORTS_COPY === 'Pick at least one sport in News settings.' && withSports.emptyCopy() === null && offNoSports.emptyCopy() === null, '8-14b: F5 — News ON with every sport unchecked has its own calm empty line ("Pick at least one sport in News settings."); with a sport selected, or News off, there is no override (Home keeps "No headlines yet")');
    assert((await noSports.fetchNews()).length === 0, '8-14c: …and that state makes no request and answers [] (the transport is told to fetch no sport)');
  }
  const emptyOut = await feed.createHomeNews({ read: mkRead(mkWorld()), transport: mkTransport([]), now: () => NOW }).fetchNews();
  assert(Array.isArray(emptyOut) && emptyOut.length === 0, '8-15: nothing to show -> [] (Home\'s calm "No headlines yet" line, a different answer from OFF)');
  const unavailable = await nonThrowing(() => feed.createHomeNews({ read: mkRead(mkWorld()), transport: mkTransport(new transport.NewsUnavailableError(['cfb'])), now: () => NOW }).fetchNews());
  assert(unavailable.name === 'NewsUnavailableError', '8-16: NewsUnavailableError propagates to Home (its calm "temporarily unavailable" + Retry — never the league banner)');
  // [BET-KEEP] no read-time betting filter: a betting headline that reached the cache reaches Home
  const beltOut = await feed.createHomeNews({ read: mkRead(mkWorld()), transport: mkTransport([item({ id: 'news_ok', headline: 'Fine story' }), item({ id: 'news_bet', headline: 'Best bets for the weekend' })]), now: () => NOW }).fetchNews();
  assert(beltOut.length === 2 && beltOut.some(it => it.id === 'news_bet'), '8-17: [BET-KEEP] the Home adapter has no read-time betting re-check: a betting headline reaches Home like any other (SD-6 reversed by Drew, 2026-10-01)');
  // turned off while it loaded
  const w3 = mkWorld(); let release; const gate = new Promise(r => { release = r; });
  const slowT = { fetchNews: async () => { await gate; return { items: [item()], errors: {}, stats: {} }; } };
  const h3 = feed.createHomeNews({ read: mkRead(w3), transport: slowT, now: () => NOW });
  const p3 = h3.fetchNews(); await flush(); w3.prefs = { on: false, sports: ['cfb'], teams: [] }; release();
  assert((await p3) === null && h3.currentItems().length === 0, '8-18: news turned OFF while it was loading -> the result is dropped (null), nothing paints');
  // identity: the tap memo tears itself down
  const w4 = mkWorld(); const h4 = feed.createHomeNews({ read: mkRead(w4), transport: mkTransport([espnItem('Texas Longhorns', 'Texas')]), now: () => NOW });
  await h4.fetchNews();
  assert(h4.currentItems().length === 1, '8-19: (control) the ranked items are what a tap resolves against');
  w4.id = { epoch: 2, leagueId: 'L1' };
  assert(h4.currentItems().length === 0, '8-20: SC-N13(d) — the memoized ranked list is torn down on an identity change: a tap resolves nothing and nothing can paint the previous viewer\'s "Your pick"');
  const w5 = mkWorld(); const h5 = feed.createHomeNews({ read: mkRead(w5), transport: mkTransport([espnItem('Texas Longhorns', 'Texas')]), now: () => NOW });
  await h5.fetchNews(); h5.reset();
  assert(h5.currentItems().length === 0 && transport._newsCacheSizeForTest() === 0, '8-21: reset() (the identity chokepoint\'s hook) forgets the ranked items and clears the transport cache');
  const w6 = mkWorld(); let swap = false; const readSwap = mkRead(w6); readSwap.identity = () => (swap ? { epoch: 9, leagueId: 'L1' } : { epoch: 1, leagueId: 'L1' });
  const h6 = feed.createHomeNews({ read: readSwap, transport: { fetchNews: async () => { swap = true; return { items: [item()], errors: {}, stats: {} }; } }, now: () => NOW });
  const swapped = await nonThrowing(() => h6.fetchNews());
  assert(!!swapped.threw && h6.currentItems().length === 0, '8-22: an identity that moved while the transport was running makes fetchNews REJECT (Home shows its calm error + Retry, not a false "No headlines yet") and holds nothing');
  // tap wiring: bindEvents resolves ids against the CURRENT items
  const w7 = mkWorld(); const h7 = feed.createHomeNews({ read: mkRead(w7), transport: mkTransport([espnItem('Texas Longhorns', 'Texas', { url: 'https://www.espn.com/x/1' })]), now: () => NOW });
  await h7.fetchNews();
  const lst = {}; const rootEl = { addEventListener(t, f) { lst[t] = f; }, removeEventListener() {} };
  const opened = []; h7.bindEvents(rootEl, { onOpen: (hh) => opened.push(hh) });
  lst.click({ target: { closest: () => ({ dataset: { newsId: h7.currentItems()[0].id } }) } });
  assert(opened.length === 1 && opened[0] === 'https://www.espn.com/x/1', '8-23: bindEvents wires the delegated tap to the adapter\'s CURRENT items');
  assert(h7.renderNewsCard(h7.currentItems()[0]).includes('data-news-id=') && h7.renderNewsCard({}) === '', '8-24: renderNewsCard is the card renderer, \'\' on bad input');
  // prefs-changed subscription
  let hits = 0; const un = feed.subscribeNewsPrefsChanged(() => { hits++; }); feed.subscribeNewsPrefsChanged(() => { throw new Error('listener boom'); });
  const callbacks = feed.makeNewsSettingsCallbacks({ refresh: () => {}, ensureCatalog: () => {} });
  storage.savePlayer({ ...storage.getPlayer('pNews'), preferences: {} });
  callbacks.onSetNewsPrefs({ sports: ['nfl'] });
  assert(hits === 1 && JSON.stringify(storage.getNewsPrefs().sports) === '["nfl"]', '8-25: onSetNewsPrefs writes the validated patch and notifies subscribers (a throwing listener does not stop the others)');
  un(); callbacks.onSetNewsPrefs({ sports: ['cfb'] });
  assert(hits === 1, '8-26: an unsubscribed listener is not called');
  const order = []; const cb2 = feed.makeNewsSettingsCallbacks({ refresh: () => order.push('refresh'), ensureCatalog: () => order.push('catalog') });
  storage.savePlayer({ ...storage.getPlayer('pNews'), preferences: { news: { teamsSeeded: 1 } } });
  cb2.onOpenNews();
  assert(order.join(',') === 'refresh,catalog' && storage.getPlayer('pNews').preferences.news.seeded === true, '8-27: opening the News pane seeds once, repaints, then kicks the shared catalog fetch');
  assert(feed.makeNewsSettingsCallbacks().onOpenNews() === undefined && feed.makeNewsSettingsCallbacks({ refresh() { throw new Error('x'); }, ensureCatalog() { throw new Error('y'); } }).onOpenNews() === undefined, '8-28: a throwing refresh / catalog callback never breaks the pane');
  // the settings ctx
  storage.savePlayer({ ...storage.getPlayer('pNews'), preferences: { news: { on: false, sports: ['nfl'], teams: ['Texas A&M'] } } });
  storage.saveSetting('newsEnabled', false);
  const sc = feed.buildNewsSettingsCtx({ teamCatalog: [{ location: 'Texas A&M', displayName: 'Texas A&M Aggies' }, { location: 'Texas' }, null, { location: '' }, { displayName: 'x' }] });
  assert(sc.on === false && JSON.stringify(sc.sports) === '["nfl"]' && sc.teams[0] === 'Texas A&M' && sc.leagueOff === true && sc.maxTeams === 20 && sc.almaMater === 'Texas A&M' && sc.catalog.length === 2 && sc.catalog[1].displayName === 'Texas', '8-29: ctx.news carries the prefs, the league-off flag, the cap, the alma mater and a cleaned catalog');
  storage.saveSetting('newsEnabled', true);
  assert(feed.buildNewsSettingsCtx().catalog.length === 0 && feed.buildNewsSettingsCtx().leagueOff === false, '8-30: no catalog -> an empty list; league on -> leagueOff false');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[9] newsSettings + the control-center drawer\'s third pane…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
let pickerScenario = null;
const CATALOG = [{ location: 'Texas A&M', displayName: 'Texas A&M Aggies' }, { location: 'Texas', displayName: 'Texas Longhorns' }, { location: "Hawai'i", displayName: "Hawai'i Rainbow Warriors" }, { location: 'Ole Miss', displayName: 'Ole Miss Rebels' }];
const model = (o = {}) => ({ on: true, sports: ['cfb'], teams: ['Texas A&M'], leagueOff: false, catalog: CATALOG, almaMater: 'Texas A&M', maxTeams: 20, catalogNote: 'All 136 schools, from ESPN.', ...o });
{
  const body = settingsUi.renderNewsSettingsBody(model());
  const pane = settingsUi.renderNewsSettingsPane(model());
  assert(pane.includes('data-action="cc-pop-news"') && pane.includes('admin-section-title">News<') && pane.includes('Control Center'), '9-1: the pushed pane has the back row (the same .control-center-back Profile uses), the title and the body');
  assert(body.includes('Show news in Home') && body.includes('Off hides the news slot entirely — no message, nothing to see.') && body.includes('News never uses AI-generated text and never costs anything extra to run — it&#39;s headlines, images, and links, fetched directly from ESPN, the same way Google News works.'), '9-2: the master label, its sub-label and the footer note are the DI-379 copy (the footer corrected for the client-side fetch)');
  assert(body.includes("NFL / NBA / NHL / CBB teams aren&#39;t selectable yet — those sports are followed at the sport level only until the shared team catalog work lands."), '9-3: the mockup\'s hint copy is verbatim');
  assert(['CFB', 'NFL', 'NBA', 'NHL', 'CBB'].every(l => body.includes(`<span class="cc-row-label">${l}</span>`)) && (body.match(/data-action="cc-news-toggle-sport"/g) || []).length === 5, '9-4: exactly the five sport rows, in the DI order');
  assert(!/betting|gambling|specific leagues/i.test(body), '9-5: no betting / gambling toggle row (betting headlines are simply kept since the 2026-10-01 reversal of SD-6; no toggle was asked for) and no "specific leagues" row (deferred)');
  assert(/data-action="cc-news-toggle-on" role="switch" aria-checked="true"/.test(body) && /data-sport="cfb" role="switch" aria-checked="true"/.test(body) && /data-sport="nfl" role="switch" aria-checked="false"/.test(body), '9-6: switches are real role=switch buttons with aria-checked in step with the prefs');
  assert((body.match(/class="cc-row-switch" data-on="true"/g) || []).length === 2 && (body.match(/class="cc-row-switch" data-on="false"/g) || []).length === 4, '9-6b: and data-on in step (master + CFB on, four off)');
  assert(body.includes('class="news-chip news-chip--alma" data-action="cc-news-remove-team" data-team="Texas A&amp;M" aria-label="Remove Texas A&amp;M Aggies"') && body.includes('news-chip__label">Texas A&amp;M Aggies<'), '9-7: the alma-mater chip is marked (gold), labelled with the catalog\'s display name, stores the location, and its remove control says what it removes');
  assert(!body.includes('<option value="Texas A&amp;M">') && body.includes('<option value="Texas">Texas Longhorns</option>') && body.includes('<option value="">Choose a team…</option>'), '9-8: the picker offers every catalog team NOT already followed, plus a placeholder');
  assert(body.includes('id="cc-news-team-add" data-field="news-add-team"') && body.includes('id="cc-news-team-note" role="status">All 136 schools, from ESPN.<'), '9-9: the picker is a native <select> (iOS draws its own wheel) with the shared catalog caption');
  // hostile team names: a stored (untrusted) preference and a catalog entry
  const HOSTILE = ['" onmouseover="x', "' onfocus='x", '<img src=x onerror=y>', "Hawai'i", '"><script>alert(1)</script>'];
  const hb = settingsUi.renderNewsSettingsBody(model({ teams: HOSTILE, catalog: HOSTILE.map(h => ({ location: h, displayName: h + ' Warriors' })), almaMater: HOSTILE[1] }));
  const tagAttrs = [...hb.matchAll(/<([a-z]+)\s([^>]*)>/g)].map(m => ({ tag: m[1], attrs: m[2] }));
  const attrNames = tagAttrs.flatMap(t => [...t.attrs.replace(/="[^"]*"/g, '').matchAll(/([a-zA-Z_:][-\w:.]*)/g)].map(m => m[1]));
  assert(!/<img|<script/i.test(hb) && !attrNames.some(n => /^on/i.test(n) || n === 'style') && tagAttrs.every(t => !['img', 'script'].includes(t.tag)), '9-10: SC-N14 vectors — `" onmouseover="x`, `\' onfocus=\'x`, `<img src=x onerror=y>` and an apostrophe team all render INERT in chips, labels, data-team, aria-label and <option>s (no img / script tag, no on* or style attribute exists)');
  const attrs = [...hb.matchAll(/<[a-z]+\s([^>]*)>/g)].map(m => m[1]);
  const unquoted = attrs.filter(a => /=[^"\s]/.test(a.replace(/="[^"]*"/g, '')));
  assert(attrs.length > 10 && unquoted.length === 0, `9-11: SC-N14 — EVERY attribute in the pane markup is double-quoted (${attrs.length} tags scanned, ${unquoted.length} with an unquoted value)`);
  assert(hb.includes('data-team="&#39; onfocus=&#39;x"') && hb.includes('data-team="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;"'), '9-12: the stored name is escaped at data-team, apostrophe and quote included');
  // states
  const off = settingsUi.renderNewsSettingsBody(model({ leagueOff: true }));
  assert(off.includes('class="news-settings-note" role="note">The commissioner has turned off league news. Your own settings are saved for when it&#39;s back on.</div>') && (off.match(/ disabled aria-disabled="true"/g) || []).length === 8, '9-13: league OFF — the inline banner (DI-380 copy) and EIGHT disabled controls (master, five sports, the chip, the picker); the screen stays reachable');
  assert(!settingsUi.renderNewsSettingsBody(model()).includes('news-settings-note') && !/ disabled/.test(settingsUi.renderNewsSettingsBody(model())), '9-14: league ON — no banner and nothing disabled');
  const full = settingsUi.renderNewsSettingsBody(model({ teams: Array.from({ length: 20 }, (_, i) => 'T' + i), maxTeams: 20 }));
  assert(/id="cc-news-team-add" data-field="news-add-team" disabled/.test(full) && full.includes('most teams News allows'), '9-15: at the cap the picker is disabled and says why');
  assert(!settingsUi.renderNewsSettingsBody(model({ teams: [] })).includes('news-chip-row') && settingsUi.renderNewsSettingsBody({}).includes('Show news in Home') && settingsUi.renderNewsSettingsBody(null).includes('Show news in Home'), '9-16: no chips -> no empty chip row; a missing / empty model still renders the pane');
  assert(settingsUi.renderNewsNavRow().includes('data-action="cc-push-news"') && settingsUi.renderNewsNavRow().includes('>News<') && settingsUi.renderNewsNavRow().includes('<svg'), '9-17: the nav row is label + chevron, dispatching cc-push-news');
  assert(settingsUi.newsTeamOptionsHTML(CATALOG, ['texas']).indexOf('value="Texas"') < 0 && settingsUi.newsTeamOptionsHTML(CATALOG, []).indexOf('Hawai&#39;i Rainbow Warriors') > 0 && settingsUi.newsTeamOptionsHTML(null, null) === '', '9-18: followed teams drop out of the options case-insensitively; a bad catalog is empty');
  // the reducer
  const P = settingsUi.newsPatchFor;
  const nn = { on: true, sports: ['cfb', 'nba'], teams: ['Texas A&M', 'Ole Miss'], leagueOff: false, maxTeams: 3 };
  assert(JSON.stringify(P('cc-news-toggle-on', nn)) === '{"on":false}' && JSON.stringify(P('cc-news-toggle-on', { ...nn, on: false })) === '{"on":true}', '9-19: the master switch flips');
  assert(JSON.stringify(P('cc-news-toggle-sport', nn, { sport: 'nfl' })) === '{"sports":["cfb","nfl","nba"]}' && JSON.stringify(P('cc-news-toggle-sport', nn, { sport: 'cfb' })) === '{"sports":["nba"]}', '9-20: a sport toggles, and the list stays in the CANONICAL order');
  for (const bad of ['mlb', '', undefined, '__proto__', 5]) assert(P('cc-news-toggle-sport', nn, { sport: bad }) === null, `9-21: an unknown sport key (${JSON.stringify(bad)}) writes nothing`);
  assert(JSON.stringify(P('cc-news-remove-team', nn, { team: 'texas a&m' })) === '{"teams":["Ole Miss"]}' && P('cc-news-remove-team', nn, {}) === null, '9-22: removing a team is case-insensitive; a missing team writes nothing');
  assert(JSON.stringify(P('cc-news-add-team', nn, { value: 'Texas' })) === '{"teams":["Texas A&M","Ole Miss","Texas"]}' && P('cc-news-add-team', nn, { value: 'ole miss' }) === null && P('cc-news-add-team', nn, { value: '' }) === null && P('cc-news-add-team', { ...nn, teams: ['a', 'b', 'c'] }, { value: 'd' }) === null, '9-23: adding appends; a duplicate, a blank and one past the cap write nothing');
  assert(P('cc-news-toggle-on', { ...nn, leagueOff: true }) === null && P('cc-news-add-team', { ...nn, leagueOff: true }, { value: 'x' }) === null && P('nonsense', nn) === null && P('cc-news-toggle-on', null) !== undefined, '9-24: with the league layer off every action writes NOTHING (a stray event on a disabled control), and an unknown action is null');
  // in-place option patch
  let html = ''; const sel = { value: 'Ole Miss', set innerHTML(v) { html = v; }, get innerHTML() { return html; } };
  assert(settingsUi.patchNewsTeamOptionsInPlace({ getElementById: (id) => (id === 'cc-news-team-add' ? sel : null) }, CATALOG, ['Texas']) === true && html.startsWith('<option value="">') && !html.includes('value="Texas"') && sel.value === 'Ole Miss' && settingsUi.patchNewsTeamOptionsInPlace({ getElementById: () => null }, CATALOG, []) === false && settingsUi.patchNewsTeamOptionsInPlace(null, CATALOG, []) === false, '9-25: the full ESPN list lands IN PLACE (the node survives, the player\'s in-progress choice is re-asserted)');
}
{
  // control-center: reducer, rows, pane
  const Mach = cc._controlCenterStateMachine;
  const pane = (events) => Mach(events).map(s => s.pane).join(',');
  assert(pane([{ type: 'open' }, { type: 'transition-end' }, { type: 'push-news' }, { type: 'pop-news' }]) === 'main,main,news,main', '9-26: push-news / pop-news mirror push-profile / pop-profile');
  assert(pane([{ type: 'pop-news' }]) === 'main' && pane([{ type: 'open' }, { type: 'transition-end' }, { type: 'push-profile' }, { type: 'push-news' }]) === 'main,main,profile,profile', '9-27: push-news needs the OPEN drawer and the MAIN pane (not from Profile); pop-news from main is a no-op');
  assert(pane([{ type: 'open' }, { type: 'transition-end' }, { type: 'push-news' }, { type: 'close', reducedMotion: true }]) === 'main,main,news,main' && pane([{ type: 'open' }, { type: 'transition-end' }, { type: 'push-news' }, { type: 'close' }, { type: 'transition-end' }]) === 'main,main,news,news,main', '9-28: closing the drawer returns the pane to main (immediately under reduced motion, at transition-end otherwise)');
  const ctxBase = { escHtml: (s) => String(s ?? ''), icon, isNativeShell: () => false, flags: {}, session: { player: { id: 'p1', displayName: 'Drew' }, isAdmin: false }, bodies: { almaMaterNoteText: 'All 136 schools, from ESPN.' }, callbacks: {}, version: {} };
  const st = { phase: 'open', pane: 'main', settingsOpenRow: null, feedbackGroupOpenRow: null };
  assert(!cc.renderSettingsAccordion(ctxBase, st).includes('cc-push-news') && cc.renderNewsSettingsScreen(ctxBase) === '' && cc.renderNewsSettingsScreen(null) === '', '9-29: with NO ctx.news the drawer has no News row and the pane is empty (the feature off app-wide)');
  const withNews = { ...ctxBase, news: model() };
  const acc = cc.renderSettingsAccordion(withNews, st);
  assert(acc.includes('data-action="cc-push-news"') && acc.indexOf('Chat settings') < acc.indexOf('cc-push-news') && acc.indexOf('cc-push-news') < acc.indexOf('Team logos'), '9-30: with ctx.news the "News" nav row sits in My Preferences, between Chat settings and Team logos');
  assert(cc.renderNewsSettingsScreen(withNews).includes('All 136 schools, from ESPN.') && cc.renderControlCenter(withNews, st).includes('data-pane="news" data-active="false"') && cc.renderControlCenter(withNews, { ...st, pane: 'news' }).includes('data-pane="news" data-active="true"'), '9-31: the third pane is in the drawer and active only when pushed; the shared catalog caption reaches it');
}
{
  // mount: taps through the REAL mountControlCenter on a fake DOM
  const VOID = new Set(['br', 'img', 'hr', 'meta', 'link', 'input']);
  const dataAttr = (p) => 'data-' + String(p).replace(/[A-Z]/g, m => '-' + m.toLowerCase());
  class FakeEl {
    constructor(tag) { this.tagName = String(tag || 'div').toUpperCase(); this._a = new Map(); this.children = []; this.parentNode = null; this._l = {}; this._value = ''; this.style = { setProperty() {}, getPropertyValue() { return ''; } }; this.disabled = false; const s = this; this.dataset = new Proxy({}, { get(_, p) { return s._a.get(dataAttr(p)); }, set(_, p, v) { s._a.set(dataAttr(p), String(v)); return true; } }); }
    get id() { return this._a.get('id') || ''; } get className() { return this._a.get('class') || ''; } get value() { return this._value; } set value(v) { this._value = v; }
    setAttribute(n, v) { this._a.set(n, v === undefined ? '' : String(v)); } getAttribute(n) { return this._a.has(n) ? this._a.get(n) : null; } removeAttribute(n) { this._a.delete(n); } hasAttribute(n) { return this._a.has(n); }
    addEventListener(t, f) { (this._l[t] ||= []).push(f); } removeEventListener(t, f) { this._l[t] = (this._l[t] || []).filter(x => x !== f); }
    dispatch(t, e = {}) { (this._l[t] || []).slice().forEach(f => f({ target: this, ...e })); }
    focus() { if (globalThis.document) globalThis.document.activeElement = this; }
    set innerHTML(h) { this._html = String(h); const kids = parse(h); for (const k of kids) k.parentNode = this; this.children = kids; } get innerHTML() { return this._html === undefined ? '[parsed]' : this._html; }
    querySelector(s) { return all(this, s)[0] || null; } querySelectorAll(s) { return all(this, s); }
    closest(s) { let n = this; while (n) { if (match(n, s)) return n; n = n.parentNode; } return null; }
  }
  function parse(html) {
    const root = { children: [] }; const stack = [root]; const re = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g; let m;
    while ((m = re.exec(html))) {
      const [, closing, tag, attrStr, self] = m;
      if (closing) { if (stack.length > 1) stack.pop(); continue; }
      const el = new FakeEl(tag);
      const ar = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g; let am;
      while ((am = ar.exec(attrStr || ''))) { const v = am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : (am[2] !== undefined ? am[2] : '')); el.setAttribute(am[1], v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')); }
      el.parentNode = stack[stack.length - 1] === root ? null : stack[stack.length - 1];
      stack[stack.length - 1].children.push(el);
      if (!(self === '/' || VOID.has(tag.toLowerCase()))) stack.push(el);
    }
    return root.children;
  }
  const cmp = (c) => { const r = { tag: null, id: null, classes: [], attrs: [] }; const re = /(#[-\w]+)|(\.[-\w]+)|(\[[^\]]+\])|([a-zA-Z][a-zA-Z0-9-]*)/g; let m; while ((m = re.exec(c.trim()))) { if (m[1]) r.id = m[1].slice(1); else if (m[2]) r.classes.push(m[2].slice(1)); else if (m[3]) { const a = m[3].slice(1, -1).match(/^([-a-zA-Z0-9_:]+)(?:="([^"]*)")?$/); if (a) r.attrs.push({ n: a[1], v: a[2] }); } else if (m[4]) r.tag = m[4].toUpperCase(); } return r; };
  const matchC = (el, c) => !!el && !!el.tagName && !(c.tag && el.tagName !== c.tag) && !(c.id && el.id !== c.id) && c.classes.every(x => el.className.split(/\s+/).includes(x)) && c.attrs.every(a => el.hasAttribute(a.n) && (a.v === undefined || el.getAttribute(a.n) === a.v));
  const match = (el, sel) => sel.split(',').some(p => matchC(el, cmp(p)));
  function all(root, sel) { const out = []; (function walk(e) { for (const k of e.children || []) { if (match(k, sel)) out.push(k); walk(k); } })(root); return out; }

  // Reviewer F1 + F5 (2026-10-01): the full school list lands IN PLACE (the app patches the picker's <option>s and writes its caption as text), THEN the player adds and removes
  // chips. Written as a function of the control-center module so the SAME scenario runs against the real file and against mutants of it.
  pickerScenario = async (ccMod) => {
    const sw = globalThis.window, sd = globalThis.document;
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    globalThis.document = { addEventListener() {}, removeEventListener() {}, activeElement: null };
    const out = {};
    try {
      const FALLBACK = [{ location: 'Texas A&M', displayName: 'Texas A&M' }, { location: 'Texas', displayName: 'Texas' }];
      const FULL = Array.from({ length: 50 }, (_, i) => ({ location: 'School' + i, displayName: 'School ' + i + ' Mascots' }));
      const w = [];
      const c = { escHtml: (x) => String(x ?? ''), icon, isNativeShell: () => false, flags: {}, session: { player: { id: 'p1', displayName: 'Drew' }, isAdmin: false }, version: {},
        bodies: { almaMaterNoteText: 'Loading every school…' },
        news: { on: true, sports: ['cfb'], teams: ['Texas'], leagueOff: false, catalog: FALLBACK, almaMater: '', maxTeams: 20 },
        callbacks: { onOpenNews() {}, onSetNewsPrefs: (pt) => w.push(pt) } };
      const rootEl = new FakeEl('div');
      const a = ccMod.mountControlCenter(rootEl, c);
      a.open();
      rootEl.dispatch('transitionend', { target: rootEl.querySelector('#control-center'), propertyName: 'transform' });
      rootEl.dispatch('click', { target: rootEl.querySelector('[data-action="cc-push-news"]') });
      const opts = () => Array.from(rootEl.querySelector('#cc-news-team-add').querySelectorAll('option')).map(o => o.getAttribute('value')).filter(Boolean);
      const paneHtml = () => rootEl.querySelector('[data-pane-content="news"]').innerHTML;
      const active = () => globalThis.document.activeElement;
      // the app's two in-place landings: the options (patchNewsTeamOptionsInPlace) and the caption (syncAlmaMaterCatalogNotes writes textContent)
      settingsUi.patchNewsTeamOptionsInPlace({ getElementById: (id) => rootEl.querySelector('#' + id) }, FULL, ['Texas']);
      rootEl.querySelector('#cc-news-team-note').textContent = 'All 50 schools, from ESPN.';
      const landed = opts().length;
      const picker = rootEl.querySelector('#cc-news-team-add'); picker.value = 'School7'; rootEl.dispatch('change', { target: picker });
      const afterAdd = opts();
      out['P1 after the full list lands in place, adding a team keeps the full list (50 offered, not the short fallback)'] = landed === 50 && afterAdd.length === 50 && afterAdd.includes('School8') && !afterAdd.includes('School7') && !afterAdd.includes('Texas');
      out['P2 the caption the app wrote does not revert to "Loading every school…" after the repaint'] = paneHtml().includes('All 50 schools, from ESPN.') && !paneHtml().includes('Loading every school');
      out['P5 adding a chip puts focus back on the picker'] = !!active() && active().id === 'cc-news-team-add';
      // remove the chip that was just added (index 1 of 2): focus goes to the chip that remains, and the team is offered again
      const chips = () => Array.from(rootEl.querySelectorAll('[data-action="cc-news-remove-team"]'));
      rootEl.dispatch('click', { target: chips()[1] });
      const afterRemove = opts();
      out['P3 a removed team is offered again by the picker'] = afterRemove.includes('School7') && afterRemove.length === 51 && w.length === 2 && JSON.stringify(w[1]) === '{"teams":["Texas"]}';
      const focusA = active();
      // remove the last remaining chip: nothing left to land on, so focus goes to the picker
      rootEl.dispatch('click', { target: chips()[0] });
      const focusB = active();
      out['P4 removing a chip restores focus: to the chip that remains, then (none left) to the picker'] = !!focusA && focusA.getAttribute('data-team') === 'Texas' && !!focusB && focusB.id === 'cc-news-team-add' && opts().includes('Texas');
      a.destroy();

      // Review round 2 (R2, 2026-10-01): the NON-PILOT remove path. The followed team is in NO catalog (the fallback is EMPTY, as it is for a player whose school is not in the
      // pilot list) and ESPN's landed list leaves followed teams OUT, so after the landing nothing on screen knows that team's name except its own chip. Removing it must still offer
      // it again; that is what `alsoKnown` in absorbLiveNewsPicker is for, and P3 above cannot see it (School7 was in the live list when it was added, so the options carried it).
      const w2 = [];
      const c2 = { escHtml: (x) => String(x ?? ''), icon, isNativeShell: () => false, flags: {}, session: { player: { id: 'p1', displayName: 'Drew' }, isAdmin: false }, version: {},
        bodies: { almaMaterNoteText: 'Loading every school…' },
        news: { on: true, sports: ['cfb'], teams: ['Zzyzx Tech'], leagueOff: false, catalog: [], almaMater: '', maxTeams: 20 },
        callbacks: { onOpenNews() {}, onSetNewsPrefs: (pt) => w2.push(pt) } };
      const root2 = new FakeEl('div');
      const a2 = ccMod.mountControlCenter(root2, c2);
      a2.open();
      root2.dispatch('transitionend', { target: root2.querySelector('#control-center'), propertyName: 'transform' });
      root2.dispatch('click', { target: root2.querySelector('[data-action="cc-push-news"]') });
      const opts2 = () => Array.from(root2.querySelector('#cc-news-team-add').querySelectorAll('option')).map(o => o.getAttribute('value')).filter(Boolean);
      const startOpts = opts2().length;
      settingsUi.patchNewsTeamOptionsInPlace({ getElementById: (id) => root2.querySelector('#' + id) }, FULL, ['Zzyzx Tech']);
      root2.querySelector('#cc-news-team-note').textContent = 'All 50 schools, from ESPN.';
      const landed2 = opts2();
      root2.dispatch('click', { target: root2.querySelector('[data-action="cc-news-remove-team"]') });
      const after2 = opts2();
      out['P6 a followed team that is in NO catalog (empty fallback, non-pilot) is offered again after it is removed, alongside the full landed list'] = startOpts === 0 && landed2.length === 50 && !landed2.includes('Zzyzx Tech') && after2.includes('Zzyzx Tech') && after2.length === 51 && after2.includes('School8') && w2.length === 1 && JSON.stringify(w2[0]) === '{"teams":[]}';
      a2.destroy();
    } finally { globalThis.window = sw; globalThis.document = sd; }
    return out;
  };
  const savedW = globalThis.window, savedD = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, activeElement: null };
  const writes = [], opened = []; let opens = 0;
  const ctx = {
    escHtml: (s) => String(s ?? ''), icon, isNativeShell: () => false, flags: {}, session: { player: { id: 'p1', displayName: 'Drew' }, isAdmin: false }, version: {}, bodies: { almaMaterNoteText: '' },
    news: model({ teams: ['Texas A&M', 'Ole Miss'], sports: ['cfb'] }),
    callbacks: { onOpenNews: () => { opens++; }, onSetNewsPrefs: (p) => writes.push(p) },
  };
  const root = new FakeEl('div');
  const api = cc.mountControlCenter(root, ctx);
  api.open();
  root.dispatch('transitionend', { target: root.querySelector('#control-center'), propertyName: 'transform' });
  const click = (el) => root.dispatch('click', { target: el });
  const newsRow = root.querySelector('[data-action="cc-push-news"]');
  assert(!!newsRow && root.querySelectorAll('.control-center-pane')[2].getAttribute('data-active') === 'false', '9-32: mounted — the News row and the (inactive) third pane exist');
  click(newsRow);
  assert(api.getState().pane === 'news' && opens === 1 && root.querySelectorAll('.control-center-pane')[2].getAttribute('data-active') === 'true' && root.querySelectorAll('.control-center-pane')[0].getAttribute('data-active') === 'false', '9-33: tapping the row pushes the pane and fires onOpenNews once');
  // a switch flips IN PLACE (same node, aria-checked + data-on updated), the write is the callback's
  const nflRow = root.querySelector('[data-sport="nfl"]');
  const nflSwitch = nflRow.querySelector('.cc-row-switch');
  click(nflRow);
  assert(root.querySelector('[data-sport="nfl"]') === nflRow && nflRow.getAttribute('aria-checked') === 'true' && nflSwitch.getAttribute('data-on') === 'true' && JSON.stringify(writes[0]) === '{"sports":["cfb","nfl"]}', '9-34: a sport switch flips IN PLACE (the same node, so the shipped 150 ms transition plays) and writes the patch');
  click(nflRow);
  assert(nflRow.getAttribute('aria-checked') === 'false' && JSON.stringify(writes[1]) === '{"sports":["cfb"]}', '9-35: tapping again flips it back — the drawer\'s local state followed the first tap');
  const master = root.querySelector('[data-action="cc-news-toggle-on"]');
  click(master);
  assert(master.getAttribute('aria-checked') === 'false' && JSON.stringify(writes[2]) === '{"on":false}', '9-36: the master switch flips in place and writes { on:false }');
  // a chip removes (structural -> repaint), the picker adds
  const chip = root.querySelector('[data-action="cc-news-remove-team"]');
  click(chip);
  assert(JSON.stringify(writes[3]) === '{"teams":["Ole Miss"]}' && root.querySelectorAll('[data-action="cc-news-remove-team"]').length === 1, '9-37: removing a chip writes the new list and repaints the pane (one chip left)');
  const picker = root.querySelector('#cc-news-team-add');
  picker.value = 'Texas'; root.dispatch('change', { target: picker });
  assert(JSON.stringify(writes[4]) === '{"teams":["Ole Miss","Texas"]}' && root.querySelectorAll('[data-action="cc-news-remove-team"]').length === 2, '9-38: choosing a school adds a chip and writes the list');
  const picker2 = root.querySelector('#cc-news-team-add');
  picker2.value = 'Texas'; root.dispatch('change', { target: picker2 });
  assert(writes.length === 5 && picker2.value === '', '9-39: choosing a school that is already followed writes nothing and returns the picker to its placeholder');
  click(root.querySelector('[data-action="cc-pop-news"]'));
  assert(api.getState().pane === 'main', '9-40: the back row pops to the main pane');
  // league OFF: disabled controls and a stray event write nothing
  api.update({ ...ctx, news: model({ leagueOff: true }) });
  click(root.querySelector('[data-action="cc-push-news"]'));
  const before = writes.length;
  click(root.querySelector('[data-action="cc-news-toggle-on"]')); click(root.querySelector('[data-sport="nfl"]')); root.dispatch('change', { target: Object.assign(root.querySelector('#cc-news-team-add'), { value: 'Texas' }) });
  assert(writes.length === before && root.querySelector('.news-settings-note') !== null, '9-41: with the league layer off the pane shows the banner and a stray event on a (disabled) control writes NOTHING');
  api.destroy();
  globalThis.window = savedW; globalThis.document = savedD;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[9b] The CSS block — tokens only, neutral third-party content, 8-pt rhythm, press, reduced motion, 44 pt…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
{
  const css = await read('./css/styles.css');
  const b = css.indexOf('/* === SOCIAL PLATFORM NEWS -- BEGIN'), e = css.indexOf('/* === SOCIAL PLATFORM NEWS -- END');
  const homeBegin = css.indexOf('/* ═══ SOCIAL PLATFORM v1 HOME — BEGIN');
  assert(b > 0 && e > b && css.indexOf('SOCIAL PLATFORM NEWS -- BEGIN', b + 10) < 0, '9b-1: ONE banner-delimited News block (BEGIN ... END)');
  assert(homeBegin > e, '9b-2: the block sits BEFORE the Home block (hometest [11-2] pins the Home block as the last thing in the file)');
  const block = css.slice(b, e);
  const rules = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map(m => ({ sel: m[1].trim(), body: m[2] }));
  assert(rules.length > 15 && !/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(rules.map(r => r.body).join(';')), `9b-3: ${rules.length} rules, TOKENS ONLY — no hex / rgb / hsl colour literal anywhere in the block (it must read in Light, Dark and every school overlay)`);
  const cardRules = rules.filter(r => /^\.news-card/.test(r.sel) && !/:focus-visible/.test(r.sel)).map(r => r.body).join(';');   // the keyboard focus ring is the app's own, not content
  assert(!/--maroon|--oxblood|--gold/.test(cardRules), '9b-4: the news CARD\'s content uses no Oxblood / Gold / maroon token (third-party content stays neutral — a headline must not read as a Munera action; only the keyboard focus ring is the app\'s own)');
  const press = rules.find(r => r.sel === '.news-card:active'), base = rules.find(r => r.sel === '.news-card');
  assert(!!press && /scale\(\.97\)/.test(press.body) && !!base && /transition:transform var\(--motion-fast\) var\(--ease-native\)/.test(base.body), '9b-5: the card presses to 97% on the shipped 150 ms token with the iOS easing token (Interaction Principles, Button Behavior)');
  const chipPress = rules.find(r => r.sel === '.news-chip:active');
  assert(!!chipPress && /scale\(\.97\)/.test(chipPress.body) && /min-height:44px/.test(rules.find(r => r.sel === '.news-chip').body), '9b-6: a chip presses to 97% and is a 44 pt tap target (CONVENTIONS #17)');
  assert(/aspect-ratio:16\/9/.test(rules.find(r => r.sel === '.news-card__image').body) && /\.news-card__image--failed/.test(block) && /display:none/.test(rules.find(r => r.sel === '.news-card__image--failed').body), '9b-7: the picture has a reserved 16:9 box (nothing jumps while it loads) and a failed one is removed');
  assert(/-webkit-line-clamp:2/.test(rules.find(r => r.sel === '.news-card__headline').body), '9b-8: the headline clamps to two lines');
  const reduce = [...block.matchAll(/@media \(prefers-reduced-motion:reduce\)\{([\s\S]*?)\n\}/g)].flatMap(m => [...m[1].matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(x => ({ sel: x[1].trim(), body: x[2] })));
  assert(['.news-card', '.news-chip'].every(sel => reduce.some(r => r.sel === sel && /transition:none/.test(r.body))), '9b-9: Reduce Motion removes the press transition for EACH animated selector (.news-card, .news-chip), one rule per selector');
  const spacing = [...block.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?:padding|margin|gap)\s*:\s*([^;}]+)/g)].flatMap(m => m[1].match(/-?\d+(?:\.\d+)?px/g) || []).map(v => Math.abs(parseFloat(v)));
  const odd = spacing.filter(v => v !== 0 && v % 8 !== 0 && v !== 4);
  assert(spacing.length > 10 && odd.length === 0, `9b-10: every padding / margin / gap in the block is on the 8-point grid (${spacing.length} values; off-grid: ${odd.join(', ') || 'none'})`);
  const hintRule = rules.find(r => /\.news-settings-hint,\.news-settings-footer/.test(r.sel));
  assert(!!hintRule && /color:var\(--text-secondary\)/.test(hintRule.body), '9b-11: the hint and footer are INFORMATION: --text-secondary, not the muted helper token (muted text fails AA on a surface)');
  assert(/\.control-center-news\{gap:16px\}/.test(block.replace(/\s+/g, ' ').replace(/ \{/g, '{')) || rules.some(r => r.sel === '.control-center-news' && /gap:16px/.test(r.body)), '9b-12: the pane\'s group rhythm is 16 (Breathing Room: 16 between groups)');
  assert(rules.some(r => r.sel === '.news-chip-row' && /gap:8px/.test(r.body)) && rules.some(r => r.sel === '.news-card__body' && /gap:8px/.test(r.body) && /padding:16px/.test(r.body)), '9b-13: chips are 8 apart; the card body is padded 16 with an 8 stack gap (nothing touches an edge)');
  const feedHome = css.slice(homeBegin);
  assert(!/news-card|news-chip|news-settings/.test(feedHome), '9b-14: nothing News leaked into the Home block');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[10] MUTATION PROOFS — scratch copies loaded as data: URLs (never the files); each mutant must turn a NAMED check RED…');
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const URL_OF = (rel) => new URL(rel, import.meta.url).href;
async function loadMutant(rel, edits) {
  let src = await readFile(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  for (const [a, b] of edits) {
    if (a instanceof RegExp) {                                   // a regex anchor (spacing-tolerant); it too must match EXACTLY once
      const n = (src.match(new RegExp(a.source, a.flags.includes('g') ? a.flags : a.flags + 'g')) || []).length;
      if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${String(a).slice(0, 80)}`);
      src = src.replace(a, () => b);
      continue;
    }
    const n = src.split(a).length - 1;
    if (n !== 1) throw new Error(`mutation anchor must match exactly once in ${rel} (matched ${n}): ${a.slice(0, 80)}`);
    src = src.split(a).join(b);
  }
  src = src.replace(/from '\.\/([\w.-]+)'/g, (_m, f) => `from '${URL_OF('./js/' + f)}'`);
  return await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
}
const GAMES = [{ gameId: 'g1', homeTeam: 'Texas', awayTeam: 'Oklahoma' }, { gameId: 'g2', homeTeam: 'Clemson', awayTeam: 'Duke' }];
const PICKS = [{ playerId: 'B', gameId: 'g1', selectedTeam: 'Texas' }, { playerId: null, gameId: 'g1', selectedTeam: 'Texas' }, { playerId: 'A', gameId: 'g2', selectedTeam: 'Clemson' }];

// each check group takes a module (the real one, or a MUTANT) and returns { label: boolean }
const cardChecks = (m) => {
  const html = (o) => { try { return m.renderNewsCard(item(o)); } catch { return '<<threw>>'; } };
  const u = m.parseArticleUrl;
  return {
    'C1 esc escapes the apostrophe': html({ headline: "O'Brien" }).includes('O&#39;Brien') && !html({ headline: "O'Brien" }).includes("O'Brien"),
    'C2 the backslash proof case is refused': u('https://www.espn.com\\@evil.example/') === null,
    'C3 parseArticleUrl returns the SERIALIZED href, not the raw string': u('HTTPS://WWW.ESPN.COM/Foo') === 'https://www.espn.com/Foo',
    'C4 userinfo is refused': u('https://www.espn.com@evil.example/') === null && u('https://user:pw@www.espn.com/') === null,
    'C5 the host test is a suffix test, not a substring test': u('https://espn.com.evil.example/') === null && u('https://notespn.com/') === null,
    'C6 a port is refused': u('https://www.espn.com:8443/x') === null,
    'C7 only https': u('http://www.espn.com/x') === null,
    'C8 the card never emits a data-home-action / data-tab / data-comm / data-haptic': !/data-home-action|data-tab|data-comm|data-haptic/.test(html({ reason: 'Your pick', imageUrl: 'https://a.espncdn.com/x.jpg' })),
    'C9 the image carries referrerpolicy="no-referrer"': /referrerpolicy="no-referrer"/.test(html({ imageUrl: 'https://a.espncdn.com/x.jpg' })),
    'C10 the reason set is closed': !/news-card__reason/.test(html({ reason: '<script>alert(1)</script>' })),
    'C11 an off-list image host renders no <img>': !/<img/.test(html({ imageUrl: 'https://evil.example/x.jpg' })),
    'C12 the headline is escaped': !/<img src=x/.test(html({ headline: '"><img src=x onerror=alert(1)>' })),
    'C13 an image from an http host renders no <img>': !/<img/.test(html({ imageUrl: 'http://a.espncdn.com/x.jpg' })),
    'C14 a hostname outside [a-z0-9.-] is refused, for an article and for a picture': u('https://a"b.espn.com/x') === null && u('https://a_b.espn.com/x') === null && !/<img/.test(html({ imageUrl: 'https://a"b.espncdn.com/x.jpg' })),
  };
};
const tapChecks = async (m) => {
  const l = {};
  const root = { addEventListener(t, f) { (l[t] ||= []).push(f); }, removeEventListener() {} };
  const opened = [];
  const items = [item({ id: 'news_a', url: 'HTTPS://WWW.ESPN.COM/Foo' }), item({ id: 'news_http', url: 'http://www.espn.com/x' })];
  m.bindNewsCardEvents(root, { items, onOpen: (h) => opened.push(h) });
  const card1 = { dataset: { newsId: 'news_a', url: 'https://evil.example/' }, getAttribute: () => null };
  for (const f of l.click || []) f({ target: { closest: () => card1 } });
  const a = opened.slice(); opened.length = 0;
  for (const f of l.click || []) f({ target: { closest: () => ({ dataset: { newsId: 'news_http' }, getAttribute: () => null }) } });
  return {
    'T1 a tap opens the serialized href of the item resolved BY ID, never the raw url or a DOM value': a.length === 1 && a[0] === 'https://www.espn.com/Foo',
    'T2 an item whose url fails validation at TAP time opens nothing': opened.length === 0,
  };
};
const rankChecks = (m) => {
  const O = m.ownPickTeamNames;
  const mk = (name, short, sport = 'cfb', teamShortNames) => item({ id: 'n' + name, teamNames: [name], teamShortNames: teamShortNames === undefined ? [short] : teamShortNames, sport });
  const run = (items, o) => { try { return m.rankNews(items, { now: NOW, ...o }); } catch { return null; } };
  const frozen = Object.freeze({ ...item({ id: 'z' }), teamNames: Object.freeze([]) });
  const r1 = run([frozen], { enabledSports: ['cfb'] });
  return {
    'R1 own picks: only the viewer\'s rows, and a null viewer gets nothing even with null-player rows': JSON.stringify(O(PICKS, GAMES, 'A')) === '["Clemson"]' && O(PICKS, GAMES, null).length === 0 && O(PICKS, GAMES, undefined).length === 0 && O(PICKS, GAMES, 'C').length === 0,
    'R2 a short name matches by EQUALITY: "Michigan" does not claim Michigan State': run([mk('Michigan State Spartans', 'Michigan State')], { slateTeams: ['Michigan'], enabledSports: ['cfb'] })?.[0]?.reason === 'CFB',
    'R3 sport gating: a CFB slate "Pittsburgh" does not claim a Steelers article': run([mk('Pittsburgh Steelers', '', 'nfl', [])], { slateTeams: ['Pittsburgh'], enabledSports: ['nfl'] })?.[0]?.reason === 'NFL',
    'R4 the 48-hour freshness window is a hard filter': run([item({ id: 'old', publishedAt: iso(NOW - 49 * HOUR) })], { enabledSports: ['cfb'] })?.length === 0,
    'R5 rankNews never mutates its input (S-C9)': !!r1 && r1.length === 1 && r1[0] !== frozen && frozen.reason === null,
    'R6 union resolution: a slate "Texas" does not claim an article about Texas A&M whose school is only an alma mater': run([mk('Texas A&M Aggies', '', 'cfb', [])], { slateTeams: ['Texas'], almaMaterTeams: ['Texas A&M'] })?.[0]?.reason === 'Your alma mater',
    'R7 the future-date floor': run([item({ id: 'fut', publishedAt: iso(NOW + 10 * MIN) })], { enabledSports: ['cfb'] })?.length === 0,
    'R8 a picked team that is ALSO on the slate reads "Your pick" (F2), and sorts first': run([mk('Texas Longhorns', 'Texas')], { slateTeams: ['Texas'], ownPickTeams: ['Texas'] })?.[0]?.reason === 'Your pick',
  };
};
const transportChecks = async (m) => {
  const out = {};
  const run = async (handler, o, pre) => { m.clearNewsCache(); const f = mkFetch(handler); try { if (pre) pre(); const r = await withFetch(f, () => m.fetchNews({ sports: ['cfb'], now: NOW, ...o })); return { r, f }; } catch (e) { return { e, f }; } };
  const good = (url) => okRes(url, payload([article()]));
  const a1 = await run(good); out['X1 credentials are omitted'] = a1.f.calls[0]?.opts?.credentials === 'omit';
  const a2 = await run((url) => okRes(url, payload([article()]), { resUrl: 'https://evil.example/news' })); out['X2 a response from another host is refused'] = !!a2.e && a2.e.name === 'NewsUnavailableError';
  const a3 = await run((url) => okRes(url, null, { text: JSON.stringify({ articles: [], pad: 'x'.repeat(600000) }) })); out['X3 an oversized body (actual length) is refused'] = !!a3.e;
  const a3b = await run((url) => okRes(url, payload([article()]), { contentLength: 900000 })); out['X3b an oversized body (declared length) is refused'] = !!a3b.e;
  const a4 = m.normalizeNewsPayload(payload([article({ links: { web: { href: 'javascript:alert(1)' } } }), article({ links: { web: { href: 'https://www.espn.com\\@evil.example/' } } })]), 'cfb', NOW);
  out['X4 a link parseArticleUrl refuses drops the item'] = a4.items.length === 0;
  const a5 = m.normalizeNewsPayload(payload([article({ headline: 'Best bets for the weekend' })]), 'cfb', NOW);
  out['X5 [BET-KEEP] betting content is KEPT (SD-6 reversed)'] = a5.items.length === 1 && a5.items[0].headline === 'Best bets for the weekend';
  // identity mid-flight
  m.clearNewsCache();
  let release; const gate = new Promise(r => { release = r; });
  const f7 = mkFetch(async (url) => { await gate; return good(url); });
  const r7 = await withFetch(f7, async () => { const p = nonThrowing(() => m.fetchNews({ sports: ['cfb'], now: NOW })); await flush(); auth._bumpIdentityEpochForTest('mut'); release(); return p; });
  out['X7 a result that resolves after the identity epoch moved is discarded and never cached'] = r7.name === 'NewsUnavailableError' && m._newsCacheSizeForTest() === 0;
  // cache keyed by identity
  m.clearNewsCache(); lsStore.set('cfbp_supabase_active_league', 'M1');
  const f8 = mkFetch(good);
  await withFetch(f8, async () => { await m.fetchNews({ sports: ['cfb'], now: NOW }); lsStore.set('cfbp_supabase_active_league', 'M2'); await m.fetchNews({ sports: ['cfb'], now: NOW + MIN }); });
  lsStore.delete('cfbp_supabase_active_league');
  out['X8 a cache entry from another league is a miss'] = f8.calls.length === 2;
  const a9 = await run(good, { sports: ['mlb'] }); out['X9 an unknown sport key is refused, never mapped to CFB'] = a9.f.calls.length === 0;
  const a10 = m.normalizeNewsPayload(payload([article({ categories: [{ id: 5, type: 'team', description: 'T', teamId: 251 }] })]), 'cfb', NOW);
  out['X10 the team id is teamId, never the category id'] = JSON.stringify(a10.items[0].teamIds) === '["251"]';
  const a11 = m.normalizeNewsPayload(payload([article({ published: iso(NOW + 30 * MIN) })]), 'cfb', NOW);
  out['X11 a future-dated item is dropped'] = a11.items.length === 0;
  let ok12 = false; try { ok12 = m.normalizeNewsPayload(payload([article({ headline: 7 })]), 'cfb', NOW).items.length === 0; } catch { ok12 = false; }
  out['X12 a non-string headline is dropped'] = ok12;
  const a13 = m.normalizeNewsPayload(payload([article({ images: [{ url: 'https://evil.example/x.jpg' }] })]), 'cfb', NOW);
  out['X13 an off-list picture host is nulled'] = a13.items[0].imageUrl === null;
  const up = m.upgradeEspnHttpLink;
  out['X14 the http upgrade is limited to espn.com article hosts, no port, no userinfo, no backslash'] = typeof up === 'function'
    && ['http://evil.example/x', 'http://www.espn.com.evil.example/x', 'http://www.espn.com@evil.example/x', 'http://www.espn.com:8080/x', 'http://www.espn.com\\@evil.example/x', 'http://www.espn.com/a b'].every(h => up(h) === h)
    && up('http://www.espn.com/x') === 'https://www.espn.com/x';
  const a15 = m.normalizeNewsPayload(payload([article({ links: { web: { href: 'http://www.espn.com/nhl/recap?gameId=401' } } })]), 'cfb', NOW);
  out['X15 an NHL-style http espn.com link is kept as https'] = a15.items.length === 1 && a15.items[0].url === 'https://www.espn.com/nhl/recap?gameId=401' && a15.stats.upgradedLinks === 1;
  const a16 = m.normalizeNewsPayload(payload([article({ links: { web: { href: 'http://evil.example/x' } } }), article({ links: { web: { href: 'http://www.espn.com\\@evil.example/' } } })]), 'cfb', NOW);
  out['X16 a non-espn http link, and a backslash laundering attempt, are dropped'] = a16.items.length === 0;
  const st17 = { reads: 0, cancelled: false };
  m.clearNewsCache();
  const f17 = mkFetch((url) => ({ ok: true, status: 200, url, headers: { get: () => null }, text: async () => '', body: { getReader() { let i = 0; return { async read() { st17.reads++; if (i >= 40) return { done: true }; i++; return { done: false, value: new Uint8Array(100000) }; }, async cancel() { st17.cancelled = true; } }; } } }));
  let r17 = null; try { await withFetch(f17, () => m.fetchNews({ sports: ['cfb'], now: NOW })); } catch (e) { r17 = e; }
  out['X17 a streamed body is cut off AT the byte cap (it is not read to the end first)'] = !!r17 && st17.reads <= 7 && st17.cancelled === true;
  return out;
};
const rulesChecks = (m) => ({
  'B8 control / bidi characters are stripped': m.stripControlAndBidi('x' + CH(0x202E) + 'y' + CH(0x200B) + 'z') === 'xyz',
  'B11 [BET-KEEP] the rules module exports no betting filter': typeof m.bettingVerdict === 'undefined' && typeof m.isBettingItem === 'undefined',
});
const feedChecks = async (m) => {
  const out = {};
  const w = mkWorld();
  const e1 = m.buildRankInputs(mkRead(w));
  out['F1 the viewer\'s picks are filtered by id'] = JSON.stringify(e1.ownPickTeams) === '["Clemson"]';
  const e2 = m.buildRankInputs(mkRead(mkWorld({ viewer: null })));
  out['F2 a null viewer has NO own picks'] = e2.ownPickTeams.length === 0;
  out['F3 a draft week has no slate'] = m.buildRankInputs(mkRead(mkWorld({ week: { status: 'draft' } }))).slateTeams.length === 0 && m.buildRankInputs(mkRead(mkWorld({ week: { status: 'final' } }))).slateTeams.length === 0;
  const tr = { calls: [] };
  const off = m.createHomeNews({ read: mkRead(mkWorld({ prefs: { on: false, sports: ['cfb'], teams: [] } })), transport: mkTransport([item()], tr), now: () => NOW });
  const r = await off.fetchNews();
  out['F4 OFF resolves null and makes no transport call'] = r === null && tr.calls.length === 0;
  const w4 = mkWorld(); const h4 = m.createHomeNews({ read: mkRead(w4), transport: mkTransport([espnItem('Texas Longhorns', 'Texas')]), now: () => NOW });
  await h4.fetchNews(); w4.id = { epoch: 2, leagueId: 'L1' };
  out['F5 the tap memo is identity-scoped'] = h4.currentItems().length === 0;
  const beltOut = await m.createHomeNews({ read: mkRead(mkWorld()), transport: mkTransport([item({ id: 'news_bet', headline: 'Best bets for the weekend' })]), now: () => NOW }).fetchNews();
  out['F6 [BET-KEEP] a betting headline reaches Home (no read-time filter)'] = beltOut.length === 1 && beltOut[0].id === 'news_bet';
  const nfl = m.buildRankInputs(mkRead(mkWorld({ settings: { sport: 'nfl' } })));
  out['F7 the slate gate follows the league sport'] = JSON.stringify(nfl.teamSports.slate) === '["nfl"]';
  const w8 = mkWorld({ prefs: { on: true, sports: ['cfb'], teams: [] } }); let release; const gate = new Promise(r2 => { release = r2; });
  const h8 = m.createHomeNews({ read: mkRead(w8), transport: { fetchNews: async () => { await gate; return { items: [item()], errors: {}, stats: {} }; } }, now: () => NOW });
  const p8 = h8.fetchNews(); await flush(); w8.prefs = { on: false, sports: ['cfb'], teams: [] }; release();
  out['F8 news turned off while loading drops the result'] = (await p8) === null;
  return out;
};
const settingsChecks = (m) => {
  const hb = m.renderNewsSettingsBody({ on: true, sports: ['cfb'], teams: ["' onfocus='x"], catalog: [], almaMater: '', maxTeams: 20 });
  const off = m.renderNewsSettingsBody({ on: true, sports: ['cfb'], teams: [], catalog: CATALOG, leagueOff: true, maxTeams: 20 });
  return {
    'S1 a stored team name is escaped quote-complete': hb.includes('data-team="&#39; onfocus=&#39;x"'),
    'S2 league OFF disables the controls and shows the banner': (off.match(/ disabled aria-disabled="true"/g) || []).length >= 7 && off.includes('news-settings-note'),
    'S3 with the league layer off every action writes nothing': m.newsPatchFor('cc-news-toggle-on', { on: true, leagueOff: true }) === null,
    'S4 an unknown sport key writes nothing': m.newsPatchFor('cc-news-toggle-sport', { sports: [] }, { sport: 'mlb' }) === null,
    'S5 sports keep the canonical order': JSON.stringify(m.newsPatchFor('cc-news-toggle-sport', { sports: ['cfb', 'nba'] }, { sport: 'nfl' })) === '{"sports":["cfb","nfl","nba"]}',
    'S6 a duplicate team is not added': m.newsPatchFor('cc-news-add-team', { teams: ['Texas'] }, { value: 'texas' }) === null,
  };
};
async function mutant(label, rel, edits, runChecks, mustFail) {
  let res;
  try { const mod = await loadMutant(rel, edits); res = await runChecks(mod); }
  catch (e) { res = { 'the mutant could not run': false, [String(e.message).slice(0, 100)]: false }; }
  const failed = Object.entries(res).filter(([, ok]) => ok !== true).map(([l]) => l);
  const hit = mustFail.every(m => failed.some(f => f.startsWith(m)));
  assert(failed.length > 0 && hit, `${label} → RED on: ${failed.slice(0, 4).map(f => f.slice(0, 70)).join(' | ') || '(nothing — the mutant SURVIVED)'}`);
}
{
  // positive controls: the real modules pass every named check, so a red below is the mutation's doing
  const ctl = { ...cardChecks(card), ...(await tapChecks(card)), ...rankChecks(rank), ...(await transportChecks(transport)), ...rulesChecks(rules), ...(await feedChecks(feed)), ...settingsChecks(settingsUi), ...(await pickerScenario(cc)) };
  const notOk = Object.entries(ctl).filter(([, v]) => v !== true).map(([l]) => l);
  assert(notOk.length === 0 && Object.keys(ctl).length >= 55, `10-0: POSITIVE CONTROL — the unmutated modules pass all ${Object.keys(ctl).length} named checks${notOk.length ? ' (failing: ' + notOk.join(' | ') + ')' : ''}`);

  // newsCard.js
  await mutant('10-1: M1 esc() no longer escapes the apostrophe (S-C3)', './js/newsCard.js', [[`"'": '&#39;'`, `"x": '&#39;'`]], async (m) => cardChecks(m), ['C1']);
  await mutant('10-2: M2 parseArticleUrl accepts a backslash (the S-C1 proof case)', './js/newsCard.js', [['raw.length > URL_MAX) return null;\n  if (/[\\s\\u0000-\\u001F\\u007F\\\\]/.test(raw)) return null;', 'raw.length > URL_MAX) return null;\n  if (/[\\s\\u0000-\\u001F\\u007F]/.test(raw)) return null;']], async (m) => cardChecks(m), ['C2']);
  await mutant('10-3: M3 parseArticleUrl returns the RAW string, not the serialized href', './js/newsCard.js', [['  return u.href;\n}', '  return raw;\n}']], async (m) => cardChecks(m), ['C3']);
  await mutant('10-4: M4 userinfo is no longer refused', './js/newsCard.js', [['if (u.username || u.password) return null;                // userinfo is refused outright, never out-guessed', '']], async (m) => cardChecks(m), ['C4']);
  await mutant('10-5: M5 the host test is a substring test', './js/newsCard.js', [["host !== 'espn.com' && !host.endsWith('.espn.com')", "host.indexOf('espn.com') < 0"]], async (m) => cardChecks(m), ['C5']);
  await mutant('10-6: M6 a port is allowed', './js/newsCard.js', [['if (u.port) return null;                                  // an ESPN article never needs a non-default port', '']], async (m) => cardChecks(m), ['C6']);
  await mutant('10-7: M7 http is allowed for an article', './js/newsCard.js', [["if (u.protocol !== 'https:') return null;\n  if (u.port) return null;                                  //", "if (false) return null;\n  if (u.port) return null;                                  //"]], async (m) => cardChecks(m), ['C7']);
  await mutant('10-8: M8 the card emits a data-home-action (Home\'s delegated handler would obey it)', './js/newsCard.js', [['role="link" tabindex="0"', 'role="link" tabindex="0" data-home-action="build-slate" data-haptic="medium"']], async (m) => cardChecks(m), ['C8']);
  await mutant('10-9: M9 the image loses referrerpolicy="no-referrer"', './js/newsCard.js', [['decoding="async" referrerpolicy="no-referrer" src=', 'decoding="async" src=']], async (m) => cardChecks(m), ['C9']);
  await mutant('10-10: M10 the reason pill is no longer a closed set', './js/newsCard.js', [["const reason = NEWS_CARD_REASONS.indexOf(item.reason) >= 0 ? item.reason : '';", "const reason = typeof item.reason === 'string' ? item.reason : '';"]], async (m) => cardChecks(m), ['C10']);
  await mutant('10-11: M11 the image host allow-list is gone', './js/newsCard.js', [['return ok ? u.href : null;', 'return u.href;']], async (m) => cardChecks(m), ['C11']);
  await mutant('10-12: M12 an http image host is allowed', './js/newsCard.js', [["if (u.protocol !== 'https:' || u.port || u.username || u.password) return null;", "if (u.port || u.username || u.password) return null;"]], async (m) => cardChecks(m), ['C13']);
  await mutant('10-13: M13 the headline is interpolated unescaped', './js/newsCard.js', [['<p class="news-card__headline">${esc(headline)}</p>', '<p class="news-card__headline">${headline}</p>']], async (m) => cardChecks(m), ['C12']);
  await mutant('10-14: M14 a tap opens item.url (the raw string) instead of the validated href', './js/newsCard.js', [['try { open(href); }', 'try { open(item.url); }']], tapChecks, ['T1']);
  await mutant('10-15: M15 the tap-time re-validation is gone (an item that never went through normalize opens)', './js/newsCard.js', [['if (!href) return;                                        // fails closed: nothing opens', '']], tapChecks, ['T2']);
  await mutant('10-16: M16 a tap reads its URL out of the DOM (dataset.url)', './js/newsCard.js', [['const href = parseArticleUrl(item.url);                   // re-validated at tap time (S-C1)', 'const href = parseArticleUrl(card.dataset && card.dataset.url ? card.dataset.url : item.url);']], tapChecks, ['T1']);

  // newsRank.js
  await mutant('10-17: M17 ownPickTeamNames loses its viewer guard (S-C2: a null viewer meets null-player rows)', './js/newsRank.js', [["if (typeof viewerPlayerId !== 'string' || !viewerPlayerId.trim()) return [];", '']], async (m) => rankChecks(m), ['R1']);
  await mutant('10-18: M18 ownPickTeamNames loses its OWN player filter (it trusts the caller)', './js/newsRank.js', [['if (!pick || pick.playerId !== viewerPlayerId) continue;     // this function does its OWN filtering', 'if (!pick) continue;']], async (m) => rankChecks(m), ['R1']);
  await mutant('10-19: M19 short names are ignored — prefix matching only (the DI\'s Michigan / Michigan State trap)', './js/newsRank.js', [['    if (short) {                                                  // rule (a): equality only, never a prefix', '    if (false) {']], async (m) => rankChecks(m), ['R2']);
  await mutant('10-20: M20 sport gating removed (a Pittsburgh slate claims a Steelers article)', './js/newsRank.js', [['sportsFor(teamSports, group).indexOf(item.sport) >= 0 && ', '']], async (m) => rankChecks(m), ['R3']);
  await mutant('10-21: M21 the freshness filter is gone', './js/newsRank.js', [['if (age > NEWS_FRESHNESS_WINDOW_MS || age < -NEWS_FUTURE_SKEW_MS) continue;', '']], async (m) => rankChecks(m), ['R4', 'R7']);
  await mutant('10-22: M22 rankNews mutates its input in place', './js/newsRank.js', [['out.push({ ...item, reason, relevanceTier: tier });', 'item.reason = reason; item.relevanceTier = tier; out.push(item);']], async (m) => rankChecks(m), ['R5']);
  await mutant('10-23: M23 candidates are resolved per list instead of over the union', './js/newsRank.js', [['    const resolved = resolveKnownTeamNames(needPrefix, Array.from(allCandidateNorms));', "    const resolved = resolveKnownTeamNames(needPrefix, Array.from(allCandidateNorms).filter((n) => n.length < 6));"]], async (m) => rankChecks(m), ['R6']);

  // newsTransport.js
  await mutant('10-24: M24 credentials are included', './js/newsTransport.js', [[/res = await fetch\(url, \{ credentials: 'omit'/, "res = await fetch(url, { credentials: 'include'"]], transportChecks, ['X1']);
  await mutant('10-25: M25 the response-host check is gone', './js/newsTransport.js', [["if (resHost !== NEWS_API_HOST) throw new NewsFetchError(sport, 'bad_host');", '']], transportChecks, ['X2']);
  await mutant('10-26: M26 the actual-length byte cap is gone', './js/newsTransport.js', [["if (text.length > NEWS_MAX_RESPONSE_BYTES) throw new NewsFetchError(sport, 'too_large');", '']], transportChecks, ['X3 ']);
  await mutant('10-27: M27 the declared-length byte cap is gone', './js/newsTransport.js', [["if (declared > NEWS_MAX_RESPONSE_BYTES) throw new NewsFetchError(sport, 'too_large');", '']], transportChecks, ['X3b']);
  await mutant('10-28: M28 links are not validated at normalize time', './js/newsTransport.js', [['const url = parseArticleUrl(upgraded);', "const url = typeof upgraded === 'string' ? upgraded : null;"]], transportChecks, ['X4']);
  await mutant('10-31: M31 an in-flight result is committed after the identity moved (S-C9)', './js/newsTransport.js', [["    throw new NewsFetchError(sport, 'identity');\n  }\n  _cache.set", "    /* mutated */\n  }\n  _cache.set"], ["throw new NewsUnavailableError(list, 'identity');", '/* mutated */']], transportChecks, ['X7']);
  await mutant('10-32: M32 the cache ignores identity', './js/newsTransport.js', [['const hitUsable = !!hit && sameIdentity(hit, token) && isFresh(hit, nowMs);', 'const hitUsable = !!hit && isFresh(hit, nowMs);']], transportChecks, ['X8']);
  await mutant('10-33: M33 an unknown sport silently maps to CFB', './js/newsTransport.js', [['? NEWS_SPORT_PATHS[sportKey] : null;', '? NEWS_SPORT_PATHS[sportKey] : NEWS_SPORT_PATHS.cfb;']], transportChecks, ['X9']);
  await mutant('10-34: M34 the team id is the category id', './js/newsTransport.js', [['const rawId = c.teamId !== undefined && c.teamId !== null ? c.teamId :', 'const rawId = c.id !== undefined && c.id !== null ? c.id :']], transportChecks, ['X10']);
  await mutant('10-35: M35 a future-dated item is kept', './js/newsTransport.js', [['if (Number.isNaN(ms) || ms > nowMs + NEWS_FUTURE_SKEW_MS) { stats.droppedDate++; return null; }', 'if (Number.isNaN(ms)) { stats.droppedDate++; return null; }']], transportChecks, ['X11']);
  await mutant('10-36: M36 a non-string headline is no longer dropped', './js/newsTransport.js', [["if (typeof entry.headline !== 'string') { stats.droppedShape++; return null; }", "if (false) { stats.droppedShape++; return null; }"]], transportChecks, ['X12']);
  await mutant('10-37: M37 the picture host is not checked at normalize time', './js/newsTransport.js', [['const candidate = img && typeof img === \'object\' ? isAllowedNewsImageUrl(logoOk(img.url)) : null;', "const candidate = img && typeof img === 'object' ? logoOk(img.url) : null;"]], transportChecks, ['X13']);

  await mutant('10-59: M59 the http upgrade applies to ANY host', './js/newsTransport.js', [["if (host !== 'espn.com' && !host.endsWith('.espn.com')) return raw;", '']], transportChecks, ['X14']);
  await mutant('10-60: M60 the upgrade ignores the backslash / whitespace refusal (a rewrite could launder a crafted string)', './js/newsTransport.js', [['if (/[\\s\\u0000-\\u001F\\u007F\\\\]/.test(raw)) return raw;', '']], transportChecks, ['X14']);
  await mutant('10-61: M61 the upgrade ignores ports and userinfo', './js/newsTransport.js', [["if (u.protocol !== 'http:' || u.port || u.username || u.password) return raw;", "if (u.protocol !== 'http:') return raw;"]], transportChecks, ['X14']);
  await mutant('10-62: M62 normalize no longer upgrades (the NHL recaps are lost again)', './js/newsTransport.js', [['const upgraded = upgradeEspnHttpLink(webLink);', 'const upgraded = webLink;']], transportChecks, ['X15']);

  await mutant('10-63: M63 the article validator accepts any hostname characters (security C3)', './js/newsCard.js', [[/if \(!HOST_CHARS\.test\(host\)\) return null;\s+\/\/ after parsing[^\n]*\n/, '']], async (m) => cardChecks(m), ['C14']);
  await mutant('10-64: M64 the picture validator accepts any hostname characters (security C3)', './js/newsCard.js', [[/if \(!HOST_CHARS\.test\(host\)\) return null;\s+\/\/ letters, digits, dots and hyphens only \(security C3\)\n/, '']], async (m) => cardChecks(m), ['C14']);
  await mutant('10-65: M65 the slate is checked BEFORE the viewer\'s own pick again (F2: "Your pick" can never render)', './js/newsRank.js', [[/if \(hit\('pick'\)\) \{ tier = 1; reason = REASON_PICK; \}[^\n]*\n\s*else if \(hit\('slate'\)\) \{ tier = 2; reason = REASON_SLATE; \}/, "if (hit('slate')) { tier = 2; reason = REASON_SLATE; }\n      else if (hit('pick')) { tier = 1; reason = REASON_PICK; }"]], async (m) => rankChecks(m), ['R8']);
  await mutant('10-66: M66 the byte cap is checked only AFTER the whole stream is read (security C4)', './js/newsTransport.js', [[/if \(total > NEWS_MAX_RESPONSE_BYTES\) throw new NewsFetchError\(sport, 'too_large'\);[^\n]*\n/, '']], transportChecks, ['X17']);
  await mutant('10-68: M68 the live picker and its caption are not absorbed before a chip repaint (reviewer F1)', './js/control-center.js', [['  function absorbLiveNewsPicker(alsoKnown) {\n', '  function absorbLiveNewsPicker(alsoKnown) {\n    return;\n']], (m) => pickerScenario(m), ['P1', 'P2', 'P3']);
  await mutant('10-69: M69 focus is not restored after a chip is removed or added (reviewer F5)', './js/control-center.js', [['  function refocusNewsPane(index) {\n', '  function refocusNewsPane(index) {\n    return;\n']], (m) => pickerScenario(m), ['P4', 'P5']);
  await mutant('10-70: M70 the removed team is not re-offered when it is in no catalog (review round 2 R2: the `alsoKnown` push in absorbLiveNewsPicker is deleted)', './js/control-center.js', [['    if (alsoKnown && alsoKnown.location) found.push(alsoKnown);\n', '']], (m) => pickerScenario(m), ['P6']);
  await mutant('10-71: M71 a betting drop is quietly re-added at normalize ([BET-KEEP] must catch it)', './js/newsTransport.js', [['  let imageUrl = null;\n', "  if (/\\bbets?\\b|odds/i.test(headline)) { stats.droppedShape++; return null; }\n  let imageUrl = null;\n"]], transportChecks, ['X5']);
  await mutant('10-72: M72 a read-time betting filter is quietly re-added to the Home adapter ([BET-KEEP] must catch it)', './js/newsFeed.js', [['const ranked = rankNews(items, { ...buildRankInputs(read), now: now() });', "const ranked = rankNews(items, { ...buildRankInputs(read), now: now() }).filter((it) => !/\\bbets?\\b/i.test(it.headline));"]], feedChecks, ['F6']);

  // newsRules.js
  await mutant('10-44: M44 bidi overrides are no longer stripped', './js/newsRules.js', [['const STRIP_RANGES = [[0x00, 0x1F], [0x7F, 0x9F], [0x200B, 0x200F], [0x202A, 0x202E], [0x2066, 0x2069], [0xFEFF, 0xFEFF]];', 'const STRIP_RANGES = [[0x00, 0x1F]];']], async (m) => rulesChecks(m), ['B8']);

  // newsFeed.js
  await mutant('10-46: M46 the viewer\'s "own picks" are everyone\'s picks (the blind-rule leak)', './js/newsFeed.js', [['ownPickTeams: ownPickTeamNames(allPicks, slateGames, viewerId),', 'ownPickTeams: allPicks.map((p) => p.selectedTeam),']], feedChecks, ['F1', 'F2']);
  await mutant('10-47: M47 a draft / final week still builds a slate', './js/newsFeed.js', [["export const NEWS_SLATE_STATUSES = Object.freeze(['open', 'locked', 'live']);", "export const NEWS_SLATE_STATUSES = Object.freeze(['open', 'locked', 'live', 'draft', 'final']);"]], feedChecks, ['F3']);
  await mutant('10-48: M48 OFF is not honoured — the transport is called anyway', './js/newsFeed.js', [['if (!available()) { held = null; return null; }     // OFF: no request of any kind, and Home renders nothing for the slot', '']], feedChecks, ['F4']);
  await mutant('10-49: M49 the tap memo outlives an identity change', './js/newsFeed.js', [['if (!sameToken(held.token, read.identity())) { held = null; return []; }', '']], feedChecks, ['F5']);
  await mutant('10-51: M51 the slate gate ignores the league sport', './js/newsFeed.js', [["teamSports: { slate: [leagueSport], pick: [leagueSport], alma: ['cfb', 'cbb'], home: ['cfb', 'cbb'] },", "teamSports: { slate: ['cfb'], pick: ['cfb'], alma: ['cfb', 'cbb'], home: ['cfb', 'cbb'] },"]], feedChecks, ['F7']);
  await mutant('10-52: M52 a result that arrives after news was turned off is still returned', './js/newsFeed.js', [['    if (!available()) { held = null; return null; }     // turned off while it loaded: drop the result, paint nothing', '']], feedChecks, ['F8']);

  // newsSettings.js
  await mutant('10-53: M53 the settings esc() no longer escapes the apostrophe', './js/newsSettings.js', [[`"'": '&#39;'`, `"x": '&#39;'`]], async (m) => settingsChecks(m), ['S1']);
  await mutant('10-54: M54 league OFF no longer disables the controls', './js/newsSettings.js', [["const disabledAttr = disabled ? ' disabled aria-disabled=\"true\"' : '';\n  return join([\n    `<button type=\"button\" class=\"control-center-row", "const disabledAttr = '';\n  return join([\n    `<button type=\"button\" class=\"control-center-row"]], async (m) => settingsChecks(m), ['S2']);
  await mutant('10-55: M55 the reducer writes through a league-off screen', './js/newsSettings.js', [['  if (n.leagueOff === true) return null;', '']], async (m) => settingsChecks(m), ['S3']);
  await mutant('10-56: M56 an unknown sport key is accepted by the reducer', './js/newsSettings.js', [["if (NEWS_SPORT_KEYS.indexOf(sport) < 0) return null;", '']], async (m) => settingsChecks(m), ['S4']);
  await mutant('10-57: M57 a duplicate team is added', './js/newsSettings.js', [["|| teams.some((t) => String(t).toLowerCase() === value.toLowerCase())) return null;", ") return null;"]], async (m) => settingsChecks(m), ['S6']);

  // the code-level kill switch (a constant): proven by flipping it, not by mutating a guard
  {
    const off = await loadMutant('./js/newsTransport.js', [['export const NEWS_FEATURE_ENABLED = true;', 'export const NEWS_FEATURE_ENABLED = false;']]);
    const f = mkFetch(() => { throw new Error('must not be called'); });
    const r = await withFetch(f, () => off.fetchNews({ sports: ['cfb', 'nfl'], force: true, now: NOW }));
    assert(f.calls.length === 0 && r.items.length === 0 && off.isNewsAvailable({}) === false && off.isNewsAvailable({ leagueSettings: { newsEnabled: true }, playerPrefs: { on: true } }) === false, '10-58: with NEWS_FEATURE_ENABLED = false (the deploy-time lever) fetchNews makes ZERO calls and isNewsAvailable is false whatever the league and the player say');
  }
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
