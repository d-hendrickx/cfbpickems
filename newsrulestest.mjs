#!/usr/bin/env node
/**
 * CFB Pickems — newsrulestest.mjs (D1 Lane C, DI-670…672; the approved news design's DI-480 / DI-481 with Amendment 1 SC-N3…SC-N8, narrowed for D1)
 * ===================================================================================================================================================
 * The proof for the collector's PURE rules: supabase/functions/_shared/news-rules.mjs (the scanner, text, dates, sport ladder, team matcher, robots, processFeed),
 * js/newsRules.js (URL / host / picture / dedupe / via rules shared with the client), js/team-match.js, and the REGEX discipline of news-fetch.js.
 * Nothing here touches a network: every feed is a RECORDED fixture (supabase/news/fixtures/feeds/, fetched once on 2026-10-08 with the honest agent and trimmed)
 * or a hand-built hostile vector.
 *
 * Run:  node newsrulestest.mjs                 (tz-sensitive: run under TZ=UTC and the machine zone; the date rules must not depend on it)
 *       node newsrulestest.mjs --mutate=<name> (one KIT_MUTANTS entry applied to an in-memory copy; the run must go RED — tests/kits/lane-c-news-kit.mjs runs them all)
 *
 * Sections
 *   [1] entities and text          one forward pass, the fixed named table, numeric validation, single-pass tag strip, caps
 *   [2] the XML scanner            RSS / Atom / CDATA / comments; DOCTYPE subsets and <!ENTITY refused (billion laughs, XXE); not a feed; block caps; nesting;
 *                                  skipped bodies (content:encoded can never inject a field); prototype pollution; attribute bomb; unterminated constructs; NUL; budget
 *   [3] dates                      local_civil (ESPN "EST" in October, SIDEARM "CST" in July), offsets, the 100-byte cap, the clamp and the window
 *   [4] URLs, hosts, pictures      S-C1 vectors per source host list, SC-N4 patterns and the denylist, SC-N3(d) secret keys, canonical form, picture hosts (S-C6, SC-N5)
 *   [5] dedupe, grouping, via      dedupeKeyOf, headlineTokens / jaccard (DI-672), guardVia (DI-481 7.5)
 *   [6] robots.txt                 groups, longest match, `*` and `$`, 404/410/401/403/5xx, caps and the ops budget, no RegExp from data
 *   [7] sport scope                single-sport negative net; SI link paths; Fox categories; headline fallback; mixed is dropped
 *   [8] team matching              the DI-481 7.4 exclusion pairs both ways, ambiguous nicknames, shared NFL locations, abbreviations
 *   [9] processFeed over every recorded publisher feed
 *   [10] regex discipline (SC-N7(d)) and the fuzz harness with bounds (SC-N7(e))
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = (rel) => join(HERE, rel);
const FEEDS = P('supabase/news/fixtures/feeds');
const feed = (f) => readFileSync(join(FEEDS, f), 'utf8');

let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

// ── mutants: each is [file, from, to]; the suite loads in-memory copies (never the files on disk) ───────────────────────────────────────
export const KIT_MUTANTS = {
  'final-url-secret-path': ['supabase/functions/_shared/news-fetch.js', "  return out.length <= 300 && STORABLE_URL.test(out) && !SECRET_KEY_PAIR.test(out) ? out : '';", "  return out.length <= 300 && STORABLE_URL.test(out) ? out : '';"],
  // security review F-1: the observed-host filter gone (the pre-fix character-class test only)
  'observed-any-host': ['supabase/functions/_shared/news-rules.mjs', "  return typeof h === 'string' && h.length >= 1 && h.length <= 100 && h.charAt(0) !== '.' && hostPatternOk(h);", "  return typeof h === 'string' && /^[a-z0-9.-]+$/.test(h);"],
  // a RE-SCAN of the decoded text (the double-decode an attacker uses to smuggle markup past one pass); valid code, so the suite tests it rather than crashing on it
  'entity-rescan': ['supabase/functions/_shared/news-rules.mjs', "    out += rep;\n    i = semi + 1;\n  }\n  return out;\n}", "    out += rep;\n    i = semi + 1;\n  }\n  return out !== input && out.indexOf('&') >= 0 ? decodeEntities(out, guard) : out;\n}"],
  'doctype-allowed': ['supabase/functions/_shared/news-rules.mjs', "      if (head.startsWith('ENTITY')) { out.refused = 'doctype_refused'; break; }", "      if (head.startsWith('ENTITY')) { const gt = src.indexOf('>', lt); if (gt < 0) break; i = gt + 1; continue; }"],
  'subset-allowed': ['supabase/functions/_shared/news-rules.mjs', "        if (gt < 0 || (brk >= 0 && brk < gt)) { out.refused = 'doctype_refused'; break; }", "        if (gt < 0) break;"],
  'no-block-cap': ['supabase/functions/_shared/news-rules.mjs', 'export const NEWS_MAX_BLOCKS = 700;', 'export const NEWS_MAX_BLOCKS = 1000000;'],
  'body-not-skipped': ['supabase/functions/_shared/news-rules.mjs', "const isSkippedBody = (prefix, local) => (prefix === 'content' && local === 'encoded') || (prefix === '' && local === 'content');", 'const isSkippedBody = () => false;'],
  'clamp-off': ['supabase/functions/_shared/news-rules.mjs', "  if (ms > nowMs) return { verdict: 'clamp', ms: nowMs };", ''],
  'window-off': ['supabase/functions/_shared/news-rules.mjs', "  if (nowMs - ms > NEWS_WINDOW_MS) return { verdict: 'drop', ms: NaN };", ''],
  'local-civil-off': ['supabase/functions/_shared/news-rules.mjs', "  if (m && dateMode === 'local_civil' && m[7]", "  if (false && m && dateMode === 'local_civil' && m[7]"],
  'robots-401-allowed': ['supabase/functions/_shared/news-rules.mjs', "  if (st === 401 || st === 403) return 'disallowed';", "  if (st === 401 || st === 403) return 'allowed';"],
  'robots-shortest': ['supabase/functions/_shared/news-rules.mjs', '        if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { len, allow: r.allow };', '        if (!best || len < best.len) best = { len, allow: r.allow };'],
  'robots-no-budget': ['supabase/functions/_shared/news-rules.mjs', "    if (budget.ops > ROBOTS_OPS_BUDGET) throw new Error('budget');", ''],
  'nick-ambiguous-off': ['supabase/functions/_shared/news-rules.mjs', "if (nick && !(t.league === 'cfb' && AMBIGUOUS_NICKNAMES.indexOf(nick) >= 0) && (nickSeen[t.league].get(nick) || []).length === 1) count(L.full, nick, t);", "if (nick) count(L.full, nick, t);"],
  'shortest-span': ['supabase/functions/_shared/news-rules.mjs', '    for (let k = Math.min(L.maxLen, toks.length - i); k >= 1; k--) {', '    for (let k = 1; k <= Math.min(L.maxLen, toks.length - i); k++) {'],
  // ('shared-location' — dropping the one-team-per-location guard — is an EQUIVALENT mutant: the uniqueness cleanup after the loop deletes any alias two teams share,
  //  so the guard is belt-and-braces. Recorded here so a reviewer does not re-add it as a "survivor".)
  'single-sport-net-off': ['supabase/functions/_shared/news-rules.mjs', "    if (path === 'other' || headOther) return null;\n    return sport;", '    return sport;'],
  'multi-mixed-kept': ['supabase/functions/_shared/news-rules.mjs', "  if (decided.size > 1) return null;", ''],
  'link-any-host': ['js/newsRules.js', '  if (!isHostAllowed(host, allowedHosts)) return null;\n  return u.href;', '  return u.href;'],
  'denylist-off': ['js/newsRules.js', '  if (hostDenied(host, LINK_HOST_DENYLIST)) return null;', ''],
  'backslash-ok': ['js/newsRules.js', "  if (/[\\s\\u0000-\\u001F\\u007F\\\\]/.test(raw)) return null;\n  let u;\n  try { u = new URL(raw); } catch { return null; }\n  if (u.protocol !== 'https:') return null;", "  let u;\n  try { u = new URL(raw); } catch { return null; }\n  if (u.protocol !== 'https:') return null;"],
  'secret-key-off': ['js/newsRules.js', '    for (const part of SECRET_KEY_PARTS) { if (key.indexOf(part) >= 0) return true; }', ''],
  'pattern-multitenant-ok': ['js/newsRules.js', '    return MULTI_TENANT_SUFFIXES.indexOf(h) < 0;', '    return true;'],
  'image-any-host': ['js/newsRules.js', "  if (!isHostAllowed(host, imageHosts) && !isHostAllowed(host, shared)) return null;", ''],
  'via-unguarded': ['js/newsRules.js', "  if (!/^[A-Za-z0-9 .,'&-]+$/.test(v)) return null;", ''],
  'tracking-kept': ['js/newsRules.js', "  for (const k of drop) u.searchParams.delete(k);", ''],
};
const mutateArg = (process.argv.find((a) => a.startsWith('--mutate=')) || '').slice(9);

/** Load the three pure modules, with ONE mutant applied to an in-memory copy when asked. Relative imports are rewritten to the (possibly mutated) siblings. */
async function loadModules() {
  const files = { rules: 'js/newsRules.js', tm: 'js/team-match.js', nr: 'supabase/functions/_shared/news-rules.mjs', nf: 'supabase/functions/_shared/news-fetch.js', teams: 'supabase/functions/_shared/news-teams.mjs' };
  const src = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, readFileSync(P(f), 'utf8')]));
  if (!mutateArg) {
    return {
      rules: await import(pathToFileURL(P(files.rules)).href), tm: await import(pathToFileURL(P(files.tm)).href), nr: await import(pathToFileURL(P(files.nr)).href),
      nf: await import(pathToFileURL(P(files.nf)).href), teams: await import(pathToFileURL(P(files.teams)).href), src,
    };
  }
  const mu = KIT_MUTANTS[mutateArg];
  if (!mu) throw new Error('unknown mutant ' + mutateArg);
  const key = Object.keys(files).find((k) => files[k] === mu[0]);
  if (!src[key].includes(mu[1])) throw new Error('mutant target missing: ' + mutateArg);
  const mutated = { ...src, [key]: src[key].split(mu[1]).join(mu[2]) };
  const dataUrl = (code) => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  const rulesUrl = dataUrl(mutated.rules), tmUrl = dataUrl(mutated.tm);
  const nrCode = mutated.nr.replace("'../../../js/newsRules.js'", `'${rulesUrl}'`).replace("'../../../js/team-match.js'", `'${tmUrl}'`);
  return { rules: await import(rulesUrl), tm: await import(tmUrl), nr: await import(dataUrl(nrCode)), nf: key === 'nf' ? await import(dataUrl(mutated.nf)) : await import(pathToFileURL(P(files.nf)).href), teams: await import(pathToFileURL(P(files.teams)).href), src: mutated };
}
const { rules, tm, nr, nf, teams, src: SRC } = await loadModules();
const CAT = teams.NEWS_TEAM_CATALOG;
const NOW = Date.parse('2026-10-08T16:30:00Z');
const H = 3600e3, D = 24 * H;

// ═══ [1] entities and text ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] entities and text (DI-480 6.3, SC-N7(b))');
{
  const d = nr.decodeEntities;
  assert(d('A &amp; B &lt;x&gt; &quot;q&quot; &apos;s') === 'A & B <x> "q" \'s', '1-1: the five predefined entities decode');
  assert(d('Texas A&amp;amp;M') === 'Texas A&amp;M', '1-2: ONE pass: a double-encoded "&amp;amp;" becomes "&amp;" (the output is never re-scanned)');
  assert(d('&#65;&#x42;&#x1F3C8;') === 'AB\u{1F3C8}', '1-3: numeric references (decimal, hex, astral) decode');
  for (const bad of ['&#0;', '&#xD800;', '&#x110000;', '&#7;', '&#x1;', '&#99999999999;']) assert(d(bad) === bad, `1-4: an invalid numeric reference stays literal (${bad})`);
  assert(d('&nbsp;&rsquo;&hellip;&mdash;') === ' \u2019\u2026\u2014', '1-5: the fixed named table decodes (nbsp to a PLAIN space so it collapses; rsquo, hellip, mdash)');
  assert(d('&lol9;&xxe;&foo bar;') === '&lol9;&xxe;&foo bar;', '1-6: any other &name; stays LITERAL (never looked up, never expanded)');
  const long = '&amp;'.repeat(20000);
  assert(d(long).length <= long.length, '1-7: the output is never longer than the input');
  assert(nr.stripTagsOnce('a<b>c</b>d') === 'a c d' && nr.stripTagsOnce('x<unterminated rest') === 'x', '1-8: tags are removed in one linear pass; an unterminated < drops the rest');
  const t0 = performance.now(); nr.stripTagsOnce('<'.repeat(200000)); const tStrip = performance.now() - t0;
  assert(tStrip < 100, `1-9: 200,000 unterminated "<" strip in linear time (${tStrip.toFixed(1)} ms)`);
  assert(nr.cleanText('<script>alert(1)</script> Real &amp; headline', 300) === 'alert(1) Real & headline', '1-10: markup in a title becomes inert plain text');
  const capped = nr.cleanText('word '.repeat(100), 40);
  assert(capped.length <= 40 && capped.endsWith('…') && !capped.includes('  '), '1-11: capped at a word boundary with an ellipsis');
  assert(nr.cleanText(`a‮b​c\u0007d`, 50) === 'abcd', '1-12: bidi overrides, zero-width and control characters are stripped');
}

// ═══ [2] the scanner ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] the XML scanner (DI-480 6.2, SC-N6, SC-N7)');
const rss = (items, head = '') => `<?xml version="1.0"?>${head}<rss version="2.0"><channel><title>Test Feed</title>${items}</channel></rss>`;
const rssItem = (o = {}) => `<item><title>${o.title || 'A perfectly ordinary college football headline'}</title><link>${o.link || 'https://www.example.com/a/1'}</link><pubDate>${o.date || 'Thu, 08 Oct 2026 15:00:00 +0000'}</pubDate>${o.extra || ''}</item>`;
{
  const s = nr.scanXmlFeed;
  let r = s(rss(rssItem() + rssItem({ title: 'Second' })));
  assert(!r.refused && r.items.length === 2 && r.format === 'rss' && r.channelTitle === 'Test Feed', '2-1: a plain RSS feed: two items, the channel title');
  r = s('<feed xmlns="http://www.w3.org/2005/Atom"><title>Atom T</title><entry><title>Atom headline here ok</title><link rel="self" href="https://x.example/self"/><link rel="alternate" href="https://www.example.com/atom/1"/><updated>2026-10-08T15:00:00Z</updated></entry></feed>');
  assert(!r.refused && r.format === 'atom' && r.items[0].linkHref === 'https://www.example.com/atom/1' && r.items[0].updated === '2026-10-08T15:00:00Z', '2-2: Atom: rel="alternate" wins over rel="self"; <updated> read');
  r = s(rss(rssItem({ title: '<![CDATA[Bama & <b>Georgia</b> preview]]>' })));
  assert(r.items[0].title === 'Bama & <b>Georgia</b> preview', '2-3: CDATA is literal content');
  r = s(rss('<!-- <item><title>commented out</title></item> -->' + rssItem()));
  assert(r.items.length === 1, '2-4: a commented-out item is skipped');
  r = s(rss(rssItem(), '<!DOCTYPE rss SYSTEM "http://x/rss.dtd">'));
  assert(!r.refused && r.items.length === 1, '2-5: a DOCTYPE with NO internal subset is skipped (never fetched)');
  const laughs = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">]><rss><channel>${rssItem({ title: '&lol2;' })}</channel></rss>`;
  r = s(laughs);
  assert(r.refused === 'doctype_refused' && r.items.length === 0, '2-6: billion laughs (an internal subset) -> doctype_refused, nothing parsed');
  r = s('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><rss><channel><item><title>&xxe;</title></item></channel></rss>');
  assert(r.refused === 'doctype_refused', '2-7: XXE (file://) -> doctype_refused, nothing fetched');
  r = s('<rss><channel><!ENTITY meta SYSTEM "http://169.254.169.254/"><item><title>x</title></item></channel></rss>');
  assert(r.refused === 'doctype_refused', '2-8: an <!ENTITY anywhere (no DOCTYPE) -> refused');
  r = s(rss(rssItem({ title: '&lol9;&lol9; title that is long enough' })));
  assert(!r.refused && nr.cleanText(r.items[0].title, 300) === '&lol9;&lol9; title that is long enough', '2-9: billion-laughs SHAPE without a DOCTYPE: the references stay literal');
  r = s('<!DOCTYPE html><html><head><title>Parking</title></head><body>Buy this domain</body></html>');
  assert(r.refused === 'not_feed', '2-10: an HTML page (a parking page, a bot wall) -> not_feed');
  r = s(rss('<item/>'.repeat(100000)));
  assert(!r.refused && r.items.length === 0 && r.stats.blocks <= nr.NEWS_MAX_BLOCKS, `2-11: 100,000 empty <item/> are not read past ${nr.NEWS_MAX_BLOCKS} blocks`);
  r = s(rss(rssItem().repeat(900)));
  assert(r.items.length === nr.NEWS_MAX_BLOCKS && r.stats.blocks === nr.NEWS_MAX_BLOCKS, `2-12: 900 real items -> exactly ${nr.NEWS_MAX_BLOCKS} read`);
  r = s(rss(rssItem({ extra: '<description>' + 'x'.repeat(70000) + '</description>' }) + rssItem()));
  assert(r.items.length === 1 && r.stats.oversize === 1, '2-13: a block over 64 KiB is skipped (oversize_item); its neighbour survives');
  r = s(rss('<item><title>outer headline long enough</title><item><title>inner</title></item></item>' + rssItem()));
  assert(r.stats.malformed >= 1 && r.items.every((x) => x.title !== 'outer headline long enough'), '2-14: a block inside a block marks the outer one malformed (skipped)');
  r = s(rss('<item><content:encoded><title>Injected by a hostile article body</title><media:thumbnail url="https://img.example/from-the-body.jpg"/></content:encoded><title>Real headline for this item</title><media:thumbnail url="https://img.example/real.jpg"/><link>https://www.example.com/a</link></item>'));
  assert(r.items[0].title === 'Real headline for this item' && JSON.stringify(r.items[0].images) === JSON.stringify(['https://img.example/real.jpg']),
    '2-15: a content:encoded body can never inject a field or a picture candidate (it is skipped unread)');
  const yahoo = s(feed('yahoo-nfl.xml'));
  assert(yahoo.items.every((it) => Object.values(it).every((v) => typeof v !== 'string' || !v.includes('Happy Mocktober'))), '2-16: Yahoo\'s full-article content:encoded never reaches any field (the recorded feed)');
  const before = Object.getOwnPropertyNames(Object.prototype).length;
  r = s(rss('<item __proto__="x" constructor="y"><__proto__>polluted</__proto__><constructor>c</constructor><toString>t</toString><title __proto__="z">Prototype vector headline</title><link>https://www.example.com/p</link></item>'));
  assert(Object.getOwnPropertyNames(Object.prototype).length === before && ({}).polluted === undefined && r.items[0].title === 'Prototype vector headline' && typeof r.items[0].toString === 'function',
    '2-17: __proto__ / constructor / toString elements and attributes pollute nothing (fixed-shape items, a switch over fixed names)');
  const attrBomb = '<rss><channel><item><title ' + 'a="1" '.repeat(50000) + '>Attribute bomb headline</title></item></channel></rss>';
  const t0 = performance.now(); r = s(attrBomb); const tA = performance.now() - t0;
  assert(tA < 2000 && !r.items.some((x) => x.title === 'never'), `2-18: 50,000 attributes are scanned in bounded time (${tA.toFixed(0)} ms)`);
  r = s(rss(rssItem()) + '<![CDATA[never closed');
  assert(r.items.length === 1, '2-19: an unterminated CDATA after the feed ends the scan; items already read stand');
  r = s('<rss><channel>' + rssItem() + '<!-- never closed ' + rssItem());
  assert(r.items.length === 1, '2-20: an unterminated comment ends the scan');
  r = s(rss(rssItem({ title: 'NUL\u0000 inside a headline here' })));
  assert(nr.cleanText(r.items[0].title, 300) === 'NUL inside a headline here', '2-21: a NUL byte is stripped, never fatal');
  let tick = 0; const clock = () => (tick += 1000);
  r = s(rss(rssItem().repeat(600)), { clock });
  assert(r.refused === 'scan_budget', '2-22: the scan budget trips INSIDE the loop (an injected clock that jumps 1 s a read)');
  r = nr.scanXmlFeed(feed('ncaa-cfb.xml'));
  assert(r.items.length >= 10 && r.items[0].encText.includes('ncaa.com/_flysystem'), '2-23: NCAA.com: the picture URL inside a CDATA <enclosure> is read as the enclosure TEXT');
}

// ═══ [3] dates ═════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] dates (DI-480 6.4, Amendment 1 A.1, SC-N7(f))');
{
  const p = nr.parseFeedDate;
  const iso = (ms) => new Date(ms).toISOString();
  assert(iso(p('Thu, 8 Oct 2026 08:31:37 EST', { dateMode: 'local_civil' })) === '2026-10-08T12:31:37.000Z', '3-1: ESPN RSS "EST" in October under local_civil reads as New York DAYLIGHT time (12:31Z, not 13:31Z)');
  assert(iso(p('Thu, 8 Oct 2026 08:31:37 EST', { dateMode: 'as_labeled' })) === '2026-10-08T13:31:37.000Z', '3-2: …the literal read (as_labeled) is an hour later — the bug local_civil fixes');
  assert(iso(p('Wed, 15 Jul 2026 19:00:00 CST', { dateMode: 'local_civil' })) === '2026-07-16T00:00:00.000Z', '3-3: SIDEARM "CST" in July under local_civil is Central DAYLIGHT time');
  assert(iso(p('Wed, 15 Jul 2026 19:00:00 CDT', { dateMode: 'local_civil' })) === iso(p('Wed, 15 Jul 2026 19:00:00 CDT', { dateMode: 'as_labeled' })), '3-4: a correct "CDT" label in July reads identically either way');
  assert(iso(p('Thu, 8 Jan 2026 08:00:00 EST', { dateMode: 'local_civil' })) === '2026-01-08T13:00:00.000Z', '3-5: "EST" in January IS standard time (no shift)');
  assert(iso(p('Thu, 08 Oct 2026 12:00:00 -0400', { offsetMinutes: -240 })) === '2026-10-08T12:00:00.000Z', '3-6: a feed that labels UTC as -0400 is corrected by date_offset_minutes -240');
  assert(iso(p('2026-10-08T15:07:51Z')) === '2026-10-08T15:07:51.000Z', '3-7: ISO 8601 (ESPN JSON, Atom)');
  assert(Number.isNaN(p('garbage')) && Number.isNaN(p('')) && Number.isNaN(p(null)), '3-8: unparseable / empty / null -> NaN (the item is dropped)');
  assert(Number.isNaN(p(' '.repeat(100) + '2026-10-08T15:07:51Z')) && !Number.isNaN(p(' '.repeat(60) + '2026-10-08T15:07:51Z')), '3-9: the raw field is capped at 100 bytes BEFORE parsing: a date that starts past byte 100 is never read (SC-N7(f))');
  const v = nr.dateVerdict;
  assert(v(NOW + 60e3, NOW).verdict === 'clamp' && v(NOW + 60e3, NOW).ms === NOW, '3-10: one minute ahead is CLAMPED to ingest time (A.1: every future time, the 0-5 minute band included)');
  assert(v(NOW + 24 * H, NOW).verdict === 'clamp', '3-11: one day ahead is clamped');
  assert(v(NOW + 72 * H, NOW).verdict === 'clamp' && v(NOW + 73 * H, NOW).verdict === 'drop', '3-12: 72 hours ahead is the last clamp; 73 hours is dropped');
  assert(v(Date.parse('9999-12-31T00:00:00Z'), NOW).verdict === 'drop' && v(0, NOW).verdict === 'drop', '3-13: year 9999 and 1970 are dropped');
  assert(v(NOW - 13 * D, NOW).verdict === 'keep' && v(NOW - 15 * D, NOW).verdict === 'drop', '3-14: the 14-day window');
  assert(v(NaN, NOW).verdict === 'drop', '3-15: NaN is dropped');
}

// ═══ [4] URLs, hosts, pictures ════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] URLs, hosts, pictures (S-C1, SC-N3(d), SC-N4, S-C6, SC-N5)');
{
  const pa = rules.parseArticleUrl;
  const CBS = ['www.cbssports.com'];
  assert(pa('https://www.cbssports.com/college-football/news/x/', CBS) === 'https://www.cbssports.com/college-football/news/x/', '4-1: an on-host https link is returned (serialized)');
  for (const [label, raw] of [
    ['a backslash differential', 'https://www.cbssports.com\\@evil.example/'], ['userinfo', 'https://www.cbssports.com@evil.example/'], ['a port', 'https://www.cbssports.com:8443/x'],
    ['javascript:', 'javascript:alert(1)'], ['data:', 'data:text/html,x'], ['protocol-relative', '//www.cbssports.com/x'], ['http:', 'http://www.cbssports.com/x'],
    ['a suffix-confusion host', 'https://www.cbssports.com.evil.example/x'], ['a trailing-dot host', 'https://www.cbssports.com./x'], ['an IP literal', 'https://10.0.0.5/x'],
    ['an IDN homograph', 'https://www.cbsspоrts.com/x'], ['whitespace', 'https://www.cbssports.com/a b'], ['a 10 KB link', 'https://www.cbssports.com/' + 'a'.repeat(10000)],
    ['a host off the list', 'https://www.espn.com/x'],
  ]) assert(pa(raw, CBS) === null, `4-2: refused — ${label}`);
  assert(pa('https://feeds.feedburner.com/x', ['feeds.feedburner.com']) === null && pa('https://t.co/abc', ['t.co']) === null, '4-3: a denylisted redirector is refused EVEN WHEN a list names it (checked first, SC-N4)');
  assert(pa('https://news.example.org/a', ['.example.org']) === 'https://news.example.org/a', '4-4: a reviewed two-label suffix pattern matches a subdomain');
  assert(pa('https://x.cloudfront.net/a', ['.cloudfront.net']) === null && pa('https://d1.cloudfront.net/a', ['d1.cloudfront.net']) === 'https://d1.cloudfront.net/a', '4-5: a multi-tenant suffix PATTERN matches nothing; an EXACT host on that platform still does');
  assert(pa('https://x.com/a', ['.com']) === null, '4-6: a one-label pattern matches nothing');
  assert(rules.hostPatternOk('www.si.com') && !rules.hostPatternOk('WWW.SI.COM') && !rules.hostPatternOk('.com') && !rules.hostPatternOk('.wordpress.com') && !rules.hostPatternOk('1.2.3.4') && !rules.hostPatternOk('a..b'), '4-7: hostPatternOk (the SC-N4 rule the SQL helper mirrors)');
  for (const u of ['https://x.example/?apiKey=1', 'https://x.example/?access_token=1', 'https://x.example/?SIG=1', 'https://x.example/?partnerKey=abc', 'https://x.example/?sessionid=1', 'not a url'])
    assert(rules.hasSecretShapedQueryKey(u), `4-8: a secret-shaped query KEY is detected (${u.slice(19) || u})`);
  assert(!rules.hasSecretShapedQueryKey('https://x.example/?id=3&page=2'), '4-9: an ordinary query is not');
  assert(rules.canonicalizeArticleUrl('https://WWW.SI.COM/nfl/x/?utm_source=RSS&utm_medium=x&id=3&fbclid=z#top') === 'https://www.si.com/nfl/x?id=3', '4-10: canonical form: host lower-case, utm_* / fbclid / fragment removed, trailing slash removed');
  assert(rules.canonicalizeArticleUrl('https://www.cbssports.com/') === 'https://www.cbssports.com/', '4-11: …the root keeps its slash');
  const img = rules.isAllowedImageUrl;
  assert(img('https://sportshub.cbsistatic.com/i/x.jpg', ['sportshub.cbsistatic.com']) === 'https://sportshub.cbsistatic.com/i/x.jpg', '4-12: a picture on the source\'s pinned host is allowed');
  for (const [label, raw, hosts] of [['an unpinned host', 'https://images2.minutemediacdn.com/a.jpg', ['sportshub.cbsistatic.com']], ['http:', 'http://sportshub.cbsistatic.com/i.jpg', ['sportshub.cbsistatic.com']],
    ['javascript:', 'javascript:alert(1)', ['x']], ['an IP literal', 'https://10.0.0.1/a.jpg', ['10.0.0.1']], ['a tracker even when pinned', 'https://pixel.quantserve.com/p.gif', ['pixel.quantserve.com']],
    ['a fetch-any-URL proxy even when pinned', 'https://i0.wp.com/evil.example/a.jpg', ['i0.wp.com']], ['a 301-char URL', 'https://sportshub.cbsistatic.com/' + 'a'.repeat(300), ['sportshub.cbsistatic.com']]])
    assert(img(raw, hosts) === null, `4-13: picture refused — ${label}`);
  assert(Array.isArray(rules.SHARED_IMAGE_CDNS) && rules.SHARED_IMAGE_CDNS.length === 0, '4-14: SHARED_IMAGE_CDNS is EMPTY in D1 (every picture host is pinned per source after Drew\'s union review, SC-N5)');
  assert(rules.FORBIDDEN_IMAGE_PROXIES.every((h) => !rules.SHARED_IMAGE_CDNS.some((e) => e.host === h)), '4-15: …and holds no forbidden proxy (vacuous today, armed for the day an entry is added)');
}

// ═══ [5] dedupe, grouping, via ════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] dedupe, grouping, via (DI-480 6.6, DI-672, DI-481 7.5)');
{
  const k = rules.dedupeKeyOf;
  assert(k('Game recap') === null && k('short one') === null, '5-1: under 20 folded characters -> null (too generic to dedupe on)');
  assert(k('Texas A&M beats Auburn in overtime') === k('TEXAS A AND M beats   auburn, in overtime!') && /^[0-9a-f]{14}$/.test(k('Texas A&M beats Auburn in overtime')), '5-2: case, punctuation and "&" fold to one 14-hex key');
  assert(k('Café owner wins the Heisman Trophy race') === k('Cafe owner wins the Heisman Trophy race'), '5-3: combining marks fold (NFKD)');
  const a = rules.headlineTokens('Cowboys activate Pro Bowl guard from IR - ESPN', ['ESPN']);
  const b = rules.headlineTokens('Cowboys activate Pro Bowl guard from IR', ['Yahoo Sports']);
  assert(!a.has('espn') && rules.jaccard(a, b) === 1, '5-4: a trailing outlet credit (a registry name) is removed before grouping; identical cores score 1.0');
  assert(rules.jaccard(rules.headlineTokens('Alabama beats Georgia'), rules.headlineTokens('Ohio State routs Indiana')) === 0 && rules.jaccard(new Set(), new Set()) === 0, '5-5: unrelated headlines score 0');
  const v = rules.guardVia;
  assert(v('The Oklahoman', 'Yahoo Sports') === 'The Oklahoman' && v("Aggies Wire", 'Yahoo Sports') === 'Aggies Wire', '5-6: an ordinary outlet credit is kept');
  for (const [label, t] of [['non-ASCII (a homoglyph)', 'Thе Oklahoman'], ['a banned voice', 'SCRIBE Official'], ['"official"', 'Official Team Site'], ['the publisher itself', 'yahoo sports'],
    ['too long', 'x'.repeat(61)], ['markup', '<b>Wire</b>'], ['a quote', 'The "Wire"']]) assert(v(t, 'Yahoo Sports') === null, `5-7: via refused — ${label}`);
}

// ═══ [6] robots.txt ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] robots.txt (DI-480 6.7, SC-N7(c))');
{
  const rv = (body, path, status = 200) => nr.robotsVerdict({ httpStatus: status, body }, path);
  assert(rv('', '/rss', 404) === 'allowed' && rv('', '/rss', 410) === 'allowed', '6-1: 404 / 410 = allowed (no file)');
  assert(rv('', '/rss', 401) === 'disallowed' && rv('', '/rss', 403) === 'disallowed', '6-2: 401 / 403 = DISALLOWED (stricter than RFC 9309, on purpose: Bleacher Report)');
  assert(rv('', '/rss', 503) === 'unknown' && rv('', '/rss', 0) === 'unknown', '6-3: 5xx / anything odd = unknown (skip this cycle, not a failure)');
  assert(rv('User-agent: *\nDisallow: /rss/', '/rss/headlines/') === 'disallowed', '6-4: a * group disallow');
  assert(rv('User-agent: *\nDisallow: /\n\nUser-agent: cfbpickems-news\nAllow: /', '/rss') === 'allowed', '6-5: OUR product-token group wins over *');
  assert(rv('User-agent: *\nDisallow: /rss/\nAllow: /rss/headlines/', '/rss/headlines/nfl') === 'allowed', '6-6: the LONGEST matching rule wins');
  assert(rv('User-agent: *\nDisallow: /rss\nAllow: /rss', '/rss') === 'allowed', '6-7: an Allow wins a tie');
  assert(rv('User-agent: *\nDisallow: /*.xml$', '/news/football/fbs/rss.xml') === 'disallowed' && rv('User-agent: *\nDisallow: /*.xml$', '/rss.xml?x=1') === 'allowed', '6-8: `*` and the `$` anchor');
  assert(rv('User-agent: *\nDisallow:', '/anything') === 'allowed', '6-9: an empty Disallow allows everything');
  assert(rv('User-agent: *\nDisallow: /x\n' + '#'.repeat(110000), '/rss') === 'unknown', '6-10: a robots.txt over 100 KiB is unknown (never partially parsed into an allow)');
  assert(rv('User-agent: *\n' + 'Disallow: /a\n'.repeat(1001), '/rss') === 'unknown', '6-11: more than 1,000 rules is unknown');
  assert(rv('User-agent: *\nDisallow: /' + 'a'.repeat(501), '/rss') === 'unknown', '6-12: a rule over 500 characters is unknown');
  // The classic quadratic wildcard case: one star then a long literal that almost matches at every offset. ~74 KiB, under the size cap, so the OPS BUDGET is what answers.
  const evil = 'User-agent: *\n' + Array.from({ length: 150 }, () => 'Disallow: /*' + 'a'.repeat(480) + 'b').join('\n');
  const t0 = performance.now(); const ev = rv(evil, '/' + 'a'.repeat(1999)); const tR = performance.now() - t0;
  assert(ev === 'unknown' && tR < 3000, `6-13: a pathological wildcard file exhausts the ops budget -> unknown, in bounded time (${tR.toFixed(0)} ms)`);
  const strip = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  assert(!/new RegExp|RegExp\(/.test(strip(SRC.nr)), '6-14: no RegExp is ever built from data in the collector rules (SC-N7(c))');
}

// ═══ [7] sport scope ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] sport scope (DI-481 7.2, narrowed: no betting rung)');
{
  const c = nr.classifySport;
  const single = { sports: ['cfb'], multi: false };
  assert(c(single, { headline: 'Texas A&M names a new starter at quarterback' }) === 'cfb', '7-1: a single-sport row keeps an ordinary item');
  assert(c(single, { headline: 'Texas A&M volleyball sweeps Auburn' }) === null, '7-2: …but drops one that names another sport (the negative-only safety net)');
  assert(c(single, { headline: 'Best bets: NBA player props for Thursday' }) === null, '7-3: …and an NBA item in a CFB feed (a cross-sport post)');
  assert(c(single, { headline: 'Ohio State on track for the playoff' }) === 'cfb', '7-4: "on track" is NOT track and field (only the phrase drops)');
  assert(c(single, { headline: 'Bets and odds for Week 6 college football' }) === 'cfb', '7-5: betting headlines are KEPT (Drew removed the betting filter, 2026-10-01)');
  assert(c(single, { href: 'https://www.cbssports.com/nba/news/x', headline: 'Ordinary words' }) === null, '7-6: a link path naming another sport drops it');
  const si = { sports: ['cfb', 'nfl'], multi: true };
  assert(c(si, { href: 'https://www.si.com/nfl/steelers/onsi/x', headline: 'Steelers get injury news' }) === 'nfl', '7-7: SI /nfl/ -> nfl');
  assert(c(si, { href: 'https://www.si.com/college/tennessee/football/x', headline: 'Vols notes' }) === 'cfb', '7-8: SI /college/<team>/football -> cfb');
  assert(c(si, { href: 'https://www.si.com/fannation/college/cfb-hq/x', headline: 'Week 6 notes' }) === 'cfb', '7-9: SI cfb-hq -> cfb');
  assert(c(si, { href: 'https://www.si.com/fannation/mlb/fastball/x', headline: 'Brewers vs Dodgers' }) === null, '7-10: SI MLB -> dropped');
  assert(c(si, { href: 'https://www.si.com/college/kentucky/basketball/x', headline: 'Kentucky basketball opens practice' }) === null, '7-11: SI college BASKETBALL -> dropped');
  assert(c(si, { cats: ['fox-news/sports', 'fox-news/sports/nfl'], href: 'https://www.foxnews.com/sports/x', headline: 'Weekend notes' }) === 'nfl', '7-12: Fox News taxonomy categories decide (rung 2)');
  assert(c(si, { cats: ['fox-news/sports/nfl', 'fox-news/sports/mlb'], href: 'https://www.foxnews.com/sports/x', headline: 'NFL quarterback news from both leagues' }) === null, '7-13: two sports in the categories -> dropped (even when the headline reads like NFL football)');
  assert(c(si, { href: 'https://www.foxnews.com/sports/x', headline: 'Heisman race tightens after Saturday' }) === 'cfb', '7-14: headline fallback: a college hint -> cfb');
  assert(c(si, { href: 'https://www.foxnews.com/sports/x', headline: 'A quarterback controversy brews' }, { teamLeagues: ['nfl'] }) === 'nfl', '7-15: …a football item naming only NFL teams -> nfl');
  assert(c(si, { href: 'https://www.foxnews.com/sports/x', headline: 'A day at the races' }) === null, '7-16: no football signal at all -> dropped (the conservative default)');
}

// ═══ [8] team matching ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] team matching (DI-481 7.4)');
{
  const names = (text, lg) => nr.matchTeams(text, lg, CAT).map((t) => t.location);
  assert(JSON.stringify(names('Texas A&M upsets Texas in overtime', 'cfb')) === JSON.stringify(['Texas A&M', 'Texas']), '8-1: "Texas A&M" consumes its span; "Texas" is matched separately');
  assert(JSON.stringify(names('Texas A&M rolls on', 'cfb')) === JSON.stringify(['Texas A&M']), '8-2: "Texas A&M" never also claims "Texas"');
  for (const [text, want, notWant] of [['Michigan State stuns', 'Michigan State', 'Michigan'], ['Oklahoma State wins', 'Oklahoma State', 'Oklahoma'], ['Kansas State wins', 'Kansas State', 'Kansas'],
    ['Washington State wins', 'Washington State', 'Washington'], ['Arkansas State wins', 'Arkansas State', 'Arkansas'], ['Southern Miss wins', 'Southern Miss', 'USC'], ['Texas Tech wins', 'Texas Tech', 'Texas'], ['Texas State wins', 'Texas State', 'Texas']]) {
    const got = names(text, 'cfb');
    assert(got.includes(want) && !got.includes(notWant), `8-3: "${text}" -> ${want}, never ${notWant}`);
  }
  assert(names('Tigers roll in the second half', 'cfb').length === 0 && names('Bulldogs and Wildcats', 'cfb').length === 0, '8-4: an ambiguous college nickname alone never matches');
  assert(names('Wolverines hold on late', 'cfb').length === 0 && names('Orange crush the Cardinal', 'cfb').length === 0 && names('Wolverines hold on late', 'cfb').length === 0,
    '8-4b: …including one that is UNIQUE in FBS but on the deny list (Wolverines; the English words Orange and Cardinal)');
  assert(JSON.stringify(names('Steelers get good injury news', 'nfl')) === JSON.stringify(['Pittsburgh']), '8-5: an NFL nickname (unique in the NFL) matches');
  assert(names('New York loses again', 'nfl').length === 0 && JSON.stringify(names('New York Giants lose again', 'nfl')) === JSON.stringify(['New York']), '8-6: a location two NFL teams share never matches alone; the full name does');
  assert(names('ND and UT meet', 'cfb').length === 0, '8-7: two-letter abbreviations never match');
  assert(names('Lsu fans', 'cfb').includes('LSU') && names('LSU wins', 'cfb').includes('LSU'), '8-8: LSU (a location) matches either case; an abbreviation-only alias needs the exact case');
  assert(names('Miami (OH) beats Toledo', 'cfb').includes('Miami (OH)') && !names('Miami (OH) beats Toledo', 'cfb').includes('Miami'), '8-9: "Miami (OH)" is not "Miami"');
  assert(names('Dolphins fans despair', 'cfb').length === 0, '8-10: sport gating: an NFL nickname in a CFB article matches nothing');
  const tags = nr.teamTags(nr.matchTeams('Texas A&M upsets Texas', 'cfb', CAT));
  assert(tags.team_keys.includes('texas a and m') && tags.team_keys.includes('texas a and m aggies') && tags.team_names.includes('Texas A&M Aggies'), '8-11: tags carry normTeam(location), normTeam(displayName) and the display name');
  assert(tm.normTeam('Texas A&M') === 'texas a and m' && tm.normTeam("Hawai'i") === 'hawaii', '8-12: normTeam (one definition, js/team-match.js)');
  assert(JSON.stringify(tm.teamKeySetMatches(['texas a and m', 'auburn'], ['Texas', 'Auburn', 'Texas A&M'])) === JSON.stringify(['Auburn', 'Texas A&M']), '8-13: teamKeySetMatches is EQUALITY only ("texas" never claims "texas a and m")');
}

// ═══ [9] processFeed over every recorded publisher ═══════════════════════════════════════════════════════════════════════════════════
console.log('\n[9] processFeed over every recorded publisher feed (2026-10-08 recordings, trimmed)');
{
  const REG = JSON.parse(readFileSync(P('supabase/news/news-sources-d1.json'), 'utf8')).sources;
  const FIX = { 'nat-espn-cfb-json': 'espn-cfb-json.json', 'nat-espn-nfl-json': 'espn-nfl-json.json', 'nat-espn-cfb': 'espn-cfb-rss.xml', 'nat-espn-nfl': 'espn-nfl-rss.xml', 'nat-cbs-cfb': 'cbs-cfb.xml',
    'nat-cbs-nfl': 'cbs-nfl.xml', 'nat-yahoo-cfb': 'yahoo-cfb.xml', 'nat-yahoo-nfl': 'yahoo-nfl.xml', 'nat-si-all': 'si-all.xml', 'nat-nbcpft-nfl': 'nbcpft-nfl.xml', 'nat-nbcsports-cfb': 'nbcsports-cfb.xml',
    'nat-ncaa-cfb': 'ncaa-cfb.xml', 'nat-foxnews-all': 'foxnews-all.xml' };
  for (const s of REG) {
    const row = { id: s.id, publisher: s.publisher, kind: s.kind, sports: s.sports, format: s.format, link_hosts: s.linkHosts, image_hosts: s.observedImageHosts, multi_sport: s.multiSport,
      allow_via: s.allowVia, paywall: s.paywall, date_mode: s.dateMode, date_offset_minutes: s.dateOffsetMinutes };
    const r = nr.processFeed({ body: feed(FIX[s.id]), source: row, nowMs: NOW, catalog: CAT });
    const okRows = r.items.every((it) => rules.parseArticleUrl(it.url, s.linkHosts) && Date.parse(it.published_at) <= NOW && it.publisher === s.publisher && s.sports.includes(it.sport)
      && it.headline.length >= 8 && it.headline.length <= 300 && (it.image_url === null || rules.isAllowedImageUrl(it.image_url, s.observedImageHosts)));
    assert(!r.refused && r.items.length >= 1 && okRows, `9-${s.id}: ${r.items.length} of ${r.parsed} kept; every row on-host, not in the future, the registry's publisher, a listed sport, a pinned picture or none`);
  }
  const si = nr.processFeed({ body: feed('si-all.xml'), source: { id: 'nat-si-all', publisher: 'Sports Illustrated', sports: ['cfb', 'nfl'], format: 'rss', link_hosts: ['www.si.com'], image_hosts: [], multi_sport: true }, nowMs: NOW, catalog: CAT });
  assert(si.items.every((it) => !it.url.includes('utm_')), '9-a: SI: utm_source is stripped from every stored link');
  assert(si.dropped.droppedFootball > 0, `9-b: SI: the all-sports feed's other sports are dropped (${si.dropped.droppedFootball})`);
  const espnRss = nr.processFeed({ body: feed('espn-cfb-rss.xml'), source: { id: 'nat-espn-cfb', publisher: 'ESPN', sports: ['cfb'], format: 'rss', link_hosts: ['www.espn.com'], image_hosts: [], date_mode: 'local_civil' }, nowMs: NOW, catalog: CAT });
  const lit = nr.processFeed({ body: feed('espn-cfb-rss.xml'), source: { id: 'nat-espn-cfb', publisher: 'ESPN', sports: ['cfb'], format: 'rss', link_hosts: ['www.espn.com'], image_hosts: [], date_mode: 'as_labeled' }, nowMs: NOW, catalog: CAT });
  assert(espnRss.items.length && Date.parse(espnRss.items[0].published_at) === Date.parse(lit.items[0].published_at) - H, '9-c: ESPN RSS under local_civil is exactly one hour earlier than the literal "EST" read (October)');
  const ncaa = nr.processFeed({ body: feed('ncaa-cfb.xml'), source: { id: 'nat-ncaa-cfb', publisher: 'NCAA.com', sports: ['cfb'], format: 'rss', link_hosts: ['www.ncaa.com'], image_hosts: ['www.ncaa.com'] }, nowMs: NOW, catalog: CAT });
  assert(ncaa.items.some((it) => it.image_url && it.image_url.startsWith('https://www.ncaa.com/')), '9-d: NCAA.com: the picture comes from the CDATA enclosure text');
  const yahoo = nr.processFeed({ body: feed('yahoo-nfl.xml'), source: { id: 'nat-yahoo-nfl', publisher: 'Yahoo Sports', sports: ['nfl'], format: 'rss', link_hosts: ['sports.yahoo.com'], image_hosts: [], allow_via: true }, nowMs: NOW, catalog: CAT });
  assert(yahoo.items.some((it) => it.via) && yahoo.items.every((it) => it.via === null || rules.guardVia(it.via, 'Yahoo Sports') === it.via), '9-e: Yahoo: the guarded via credit');
  const hostile = nr.processFeed({ body: rss(rssItem({ link: 'https://evil.example/x' }) + rssItem({ link: 'https://www.cbssports.com/x?api_key=1' }) + rssItem({ link: 'https://www.cbssports.com/ok', title: 'A fine headline that names Alabama' })),
    source: { id: 'x', publisher: 'CBS Sports', sports: ['cfb'], format: 'rss', link_hosts: ['www.cbssports.com'], image_hosts: [] }, nowMs: NOW, catalog: CAT });
  assert(hostile.items.length === 1 && hostile.dropped.refusedLinks === 2 && hostile.items[0].team_names.includes('Alabama Crimson Tide'), '9-f: an off-host link and a secret-keyed link are refused and counted; the good item survives with its team tag');
  const future = nr.processFeed({ body: rss(rssItem({ date: new Date(NOW + 2 * H).toUTCString(), title: 'A future dated headline ok here' }) + rssItem({ date: new Date(NOW + 100 * H).toUTCString(), title: 'Far future headline that drops' })),
    source: { id: 'x', publisher: 'CBS Sports', sports: ['cfb'], format: 'rss', link_hosts: ['www.example.com'], image_hosts: [] }, nowMs: NOW, catalog: CAT });
  assert(future.items.length === 1 && Date.parse(future.items[0].published_at) === NOW && future.dropped.clampedFuture === 1 && future.dropped.droppedFuture === 1, '9-g: two hours ahead is clamped to now; 100 hours ahead is dropped');
  const unsorted = nr.processFeed({ body: rss(rssItem({ date: 'Thu, 01 Jan 2018 00:00:00 +0000', title: 'An ancient pinned item first', link: 'https://www.example.com/old' }) + rssItem({ date: new Date(NOW - H).toUTCString(), title: 'The newest item sits last in the feed', link: 'https://www.example.com/new' })),
    source: { id: 'x', publisher: 'CBS Sports', sports: ['cfb'], format: 'rss', link_hosts: ['www.example.com'], image_hosts: [] }, nowMs: NOW, catalog: CAT });
  assert(unsorted.items.length === 1 && unsorted.items[0].url === 'https://www.example.com/new' && unsorted.lastItemAt === NOW - H, '9-h: document order is not trusted: the 2018 item is dropped; last_item_at is the newest KEPT item');
  // security review F-1 (2026-10-14): a host the collector RECORDS is publisher-controlled; only one 0053's column CHECK accepts is recorded, so news_record_poll can never be
  // made to raise for a whole batch by one source's markup. An IP literal (picture), a trailing-dot link host and a 101-character host are each dropped; the good hosts stay.
  const long101 = 'a'.repeat(97) + '.com';
  const poisoned = nr.processFeed({ body: rss(
    rssItem({ title: 'Ohio State and Michigan meet in a top five college football showdown', link: 'https://www.cbssports.com/college-football/news/a/',
      extra: `<enclosure url="https://1.2.3.4/pixel.jpg" type="image/jpeg"/><enclosure url="https://${long101}/p.jpg" type="image/jpeg"/><description>&lt;img src="https://sportshub.cbsistatic.com/i/p.jpg"&gt;</description>` })
    + rssItem({ title: 'Texas and Oklahoma renew the college football rivalry this weekend', link: 'https://www.cbssports.com./college-football/news/b/' })
    + rssItem({ title: 'Alabama and Georgia meet again in a college football rematch', link: `https://${long101}/college-football/c/`, extra: `<description>&lt;img src="https://${long101}/p.jpg"&gt;&lt;img src="https://sportshub.cbsistatic.com/i/p.jpg"&gt;</description>` })),
    source: { id: 'nat-cbs-cfb', publisher: 'CBS Sports', sports: ['cfb'], format: 'rss', link_hosts: ['www.cbssports.com'], image_hosts: [] }, nowMs: NOW, catalog: CAT });
  assert(JSON.stringify(poisoned.observed.linkHosts) === JSON.stringify(['www.cbssports.com']) && poisoned.observed.imageHosts.indexOf('1.2.3.4') < 0 && poisoned.observed.imageHosts.indexOf(long101) < 0
    && poisoned.observed.imageHosts.indexOf('sportshub.cbsistatic.com') >= 0,
    `9-i (F-1): observed hosts keep only what 0053's CHECK accepts: no IP literal, no trailing dot, nothing over 100 characters (link ${JSON.stringify(poisoned.observed.linkHosts)}, image ${JSON.stringify(poisoned.observed.imageHosts)})`);
  // security review F-1b: the final URL the collector would store is refused when the column would refuse it — a secret-shaped pair ANYWHERE (the path included)
  assert(nf.storableFinalUrl('https://www.si.com/a&token=1/feed') === '' && nf.storableFinalUrl('https://www.si.com/news&signup=x/feed') === ''
    && nf.storableFinalUrl('https://www.si.com/feed?path=football') === 'https://www.si.com/feed?path=football',
    '9-k (F-1b): storableFinalUrl refuses a final URL whose PATH carries a secret-shaped pair (&token=, &signup=), and keeps an allow-listed query');
  assert(['1.2.3.4', 'www.cbssports.com.', long101, 'WWW.EXAMPLE.COM', '', 'a..b.com'].every((h) => !nr.observableHost(h)) && ['www.cbssports.com', 'sportshub.cbsistatic.com', 'a'.repeat(96) + '.com'].every((h) => nr.observableHost(h)),
    '9-j (F-1): observableHost refuses an IP literal, a trailing dot, 101 characters, upper case, empty and a double dot; accepts real hosts up to 100 characters');
}

// ═══ [10] regex discipline and the fuzz harness ══════════════════════════════════════════════════════════════════════════════════════
console.log('\n[10] regex discipline (SC-N7(d)) and the fuzz harness (SC-N7(e))');
{
  /** Regex literals in a source (comments stripped): a `/` that starts a literal after ( , = : [ ! & | ? { } ; or `return`, read to the closing `/` outside a class. */
  function regexLiterals(code) {
    const c = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1');
    const out = [];
    for (let i = 0; i < c.length; i++) {
      if (c[i] !== '/') continue;
      let j = i - 1; while (j >= 0 && /\s/.test(c[j])) j--;
      const prev = c[j]; const word = c.slice(Math.max(0, j - 5), j + 1);
      if (!('(,=:[!&|?{};'.includes(prev) || /return$/.test(word))) continue;
      if (c[i + 1] === '/' || c[i + 1] === '*') continue;
      let k = i + 1, inClass = false;
      while (k < c.length && c[k] !== '\n') { if (c[k] === '\\') { k += 2; continue; } if (c[k] === '[') inClass = true; else if (c[k] === ']') inClass = false; else if (c[k] === '/' && !inClass) break; k++; }
      if (c[k] !== '/') continue;
      out.push(c.slice(i + 1, k)); i = k;
    }
    return out;
  }
  for (const [name, code, reg] of [['js/newsRules.js', SRC.rules, rules.REGEX_REGISTRY], ['supabase/functions/_shared/news-rules.mjs', SRC.nr, nr.REGEX_REGISTRY],
    ['supabase/functions/_shared/news-fetch.js', SRC.nf, nf.REGEX_REGISTRY], ['js/team-match.js', SRC.tm, tm.REGEX_REGISTRY]]) {
    const lits = [...new Set(regexLiterals(code))];
    const known = new Set(Object.values(reg || {}).map((r) => r.source));
    const unlisted = lits.filter((l) => !known.has(l));
    assert(lits.length > 0 && unlisted.length === 0, `10-1: ${name}: every regex literal (${lits.length}) is in its REGEX_REGISTRY — unlisted: ${JSON.stringify(unlisted)}`);
    const forbidden = Object.entries(reg || {}).filter(([, r]) => /\([^)]*[+*][^)]*\)[+*{]|\\[1-9]|\(\?[=!<]/.test(r.source));
    assert(forbidden.length === 0, `10-2: ${name}: no registered regex has a nested quantifier, a backreference or a lookaround — ${JSON.stringify(forbidden.map(([k]) => k))}`);
    // best of 3 per (regex, input), and the bar widens with the load average like 10-7..10-9 (a catastrophic pattern takes SECONDS on 64 KiB, far past any widened bar)
    const rxWiden = Math.min(8, Math.max(1, os.loadavg()[0] / 8));
    let worst = 0;
    for (const r of Object.values(reg || {})) {
      for (const adv of ['a'.repeat(65536), ' '.repeat(65535) + '!', '<'.repeat(65536), '&'.repeat(65536), 'Thu, 08 Oct 2026 '.repeat(4000)]) {
        let one = Infinity;
        for (let k = 0; k < 3; k++) {
          const t0 = performance.now(); const rr = new RegExp(r.source, r.flags.replace('g', '')); rr.test(adv); adv.replace(new RegExp(r.source, r.flags.includes('g') ? r.flags : r.flags + 'g'), ''); one = Math.min(one, performance.now() - t0);
        }
        worst = Math.max(worst, one);
      }
    }
    assert(worst < 40 * rxWiden, `10-3: ${name}: every registered regex runs in at most ${(40 * rxWiden).toFixed(0)} ms on 64 KiB of adversarial input (worst ${worst.toFixed(1)} ms, best of 3; the design's bar is 20 ms, doubled${rxWiden > 1 ? `, then widened x${rxWiden.toFixed(1)} for load average ${os.loadavg()[0].toFixed(1)}` : ''})`);
  }
  // fuzz: >= 2,000 mutations of recorded feeds from a fixed seeded PRNG
  let seed = 0x5eed1234;
  const rnd = () => { seed ^= seed << 13; seed >>>= 0; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0; return seed / 4294967296; };
  const bases = ['cbs-cfb.xml', 'si-all.xml', 'ncaa-cfb.xml', 'yahoo-cfb.xml', 'espn-cfb-rss.xml', 'nbcpft-nfl.xml'].map(feed);
  const insertions = ['<', '&', ']]>', '<![CDATA[', '<!--', '<item>', '</item>', '"', "'", '<!ENTITY', '&#x0;', '\u0000', '<?', '<__proto__>'];
  let threw = 0, tooLong = 0, capViol = 0, n = 0;
  for (let i = 0; i < 2200; i++) {
    let b = bases[i % bases.length];
    const ops = 1 + Math.floor(rnd() * 4);
    for (let o = 0; o < ops; o++) {
      const at = Math.floor(rnd() * b.length);
      const kind = Math.floor(rnd() * 5);
      if (kind === 0) b = b.slice(0, at) + String.fromCharCode(Math.floor(rnd() * 256)) + b.slice(at + 1);
      else if (kind === 1) b = b.slice(0, at);
      else if (kind === 2) b = b.slice(0, at) + b.slice(at + Math.floor(rnd() * 500));
      else if (kind === 3) b = b.slice(0, at) + b.slice(at, at + Math.floor(rnd() * 300)).repeat(2) + b.slice(at);
      else b = b.slice(0, at) + insertions[Math.floor(rnd() * insertions.length)] + b.slice(at);
    }
    n++;
    try {
      const r = nr.scanXmlFeed(b);
      const total = r.items.reduce((acc, it) => acc + it.title.length + it.link.length + it.desc.length + it.date.length + it.cats.join('').length, 0);
      if (total > b.length) tooLong++;
      if (r.items.some((it) => it.title.length > nr.RAW_CAPS.title || it.desc.length > nr.RAW_CAPS.desc || it.date.length > nr.RAW_CAPS.date || it.cats.length > nr.MAX_CATEGORIES)) capViol++;
      nr.processFeed({ body: b, source: { id: 'f', publisher: 'Fuzz', sports: ['cfb'], format: 'rss', link_hosts: ['www.cbssports.com'], image_hosts: [] }, nowMs: NOW, catalog: CAT });
    } catch { threw++; }
  }
  assert(n >= 2000 && threw === 0, `10-4: ${n} seeded mutations of the recorded feeds: the scanner and processFeed NEVER throw (${threw} threw)`);
  assert(tooLong === 0, '10-5: …the captured output is never longer than the input');
  assert(capViol === 0, '10-6: …and every raw cap holds');
  // generators and the bounds (best of 5; a loaded machine widens the bar and says so)
  const load = os.loadavg()[0];
  const widen = Math.min(8, Math.max(1, load / 8));
  if (widen > 1) console.log(`  (load average ${load.toFixed(1)}: timing bars widened x${widen.toFixed(1)})`);
  const best = (fn) => { let b = Infinity; for (let i = 0; i < 5; i++) { const t0 = performance.now(); fn(); b = Math.min(b, performance.now() - t0); } return b; };
  const real = feed('cbs-cfb.xml');
  const mk = (bytes) => { let s0 = ''; while (s0.length < bytes) s0 += real; return s0.slice(0, bytes); };
  const t512 = best(() => nr.scanXmlFeed(mk(524288)));
  const t1m = best(() => nr.scanXmlFeed(mk(1048576)));
  assert(t1m <= 150 * widen, `10-7: a 1 MiB feed scans in at most ${(150 * widen).toFixed(0)} ms (${t1m.toFixed(1)} ms, best of 5)`);
  assert(t1m <= 2.5 * t512 + 5 * widen, `10-8: growth is linear: time(1 MiB) <= 2.5 x time(512 KiB) + 5 ms (${t1m.toFixed(1)} vs ${t512.toFixed(1)})`);
  for (const [label, gen] of [['runs of <', (k) => '<'.repeat(k)], ['runs of &', (k) => '<rss><channel><item><title>' + '&'.repeat(k) + '</title></item></channel></rss>'],
    ['an unterminated <!--', (k) => '<rss><channel>' + rssItem() + '<!--' + 'x'.repeat(k)], ['an unterminated <![CDATA[', (k) => '<rss><channel>' + rssItem() + '<![CDATA[' + 'x'.repeat(k)],
    ['deep nesting', (k) => '<rss><channel><item>' + '<a>'.repeat(k / 3) + '</item></channel></rss>'], ['unterminated quotes', (k) => '<rss><channel><item><title a="' + 'x'.repeat(k)],
    ['a 64 KiB - 1 block', () => rss('<item><title>' + 'y'.repeat(65536 - 40) + '</title></item>')]]) {
    const small = best(() => nr.scanXmlFeed(gen(131072))); const big = best(() => nr.scanXmlFeed(gen(262144)));
    assert(big <= 2.5 * small + 5 * widen && big < 400 * widen, `10-9: generator "${label}": linear (${small.toFixed(1)} ms -> ${big.toFixed(1)} ms) and bounded`);
  }
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
