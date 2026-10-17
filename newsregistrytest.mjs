#!/usr/bin/env node
/**
 * CFB Pickems — newsregistrytest.mjs (D1 Lane C, DI-670/671; the approved design's DI-477 3.3 / 3.4 and Amendment 1 SC-N1, SC-N3(d), SC-N4, SC-N5, narrowed to D1)
 * ==================================================================================================================================================
 * The proof for supabase/news/news-registry.mjs (the 13-row D1 registry's validator and the 0054 generator) and supabase/news/build-news-teams.mjs (the bundled catalog).
 *
 *   [1] the real D1 file validates; 0054 and news-teams.mjs are exactly what their generators write (determinism; a hand edit of a generated file goes red)
 *   [2] SC-N1: ONE quoting function; hostile vectors in every free-text field round-trip byte for byte through a tokenizer that finds exactly one INSERT
 *   [3] the V-rules, each with a failing fixture (and the id, never the value, in the message)
 *   [4] D1 facts: 13 rows, the five publishers plus ESPN, Fox News a disabled reserve labelled "Fox News", PFT at its final URL, no seeded image host, no `cleared` anywhere
 *   [5] drift: the multi-tenant pattern list is the same in js/newsRules.js and in 0053's news_hosts_ok()
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const P = (rel) => join(HERE, rel);
let pass = 0, fail = 0;
function assert(cond, label) { if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label); } }

const reg = await import('./supabase/news/news-registry.mjs');
const teamsGen = await import('./supabase/news/build-news-teams.mjs');
const rules = await import('./js/newsRules.js');
const { NEWS_TEAM_CATALOG } = await import('./supabase/functions/_shared/news-teams.mjs');
const inputText = readFileSync(P('supabase/news/news-sources-d1.json'), 'utf8');
const doc = JSON.parse(inputText);
const seed = readFileSync(P('supabase/migrations/0054_news_seed_d1.sql'), 'utf8');
const m53 = readFileSync(P('supabase/migrations/0053_news_sources_and_articles.sql'), 'utf8');

/** A small SQL tokenizer (no dependency): strings ('' escapes), quoted identifiers, comments, dollar quotes, everything else. Returns top-level statements and string literals. */
function tokenizeSql(sql) {
  const stmts = []; const strings = []; let cur = ''; let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    if (c === '-' && sql[i + 1] === '-') { const e = sql.indexOf('\n', i); i = e < 0 ? sql.length : e + 1; continue; }
    if (c === '/' && sql[i + 1] === '*') { const e = sql.indexOf('*/', i + 2); i = e < 0 ? sql.length : e + 2; continue; }
    if (c === "'") {
      let j = i + 1, val = '';
      for (;;) {
        if (j >= sql.length) throw new Error('unterminated string');
        if (sql[j] === "'" && sql[j + 1] === "'") { val += "'"; j += 2; continue; }
        if (sql[j] === "'") break;
        val += sql[j]; j++;
      }
      strings.push(val); cur += "'?'"; i = j + 1; continue;
    }
    if (c === '$') { const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i)); if (m) throw new Error('dollar quoting is not allowed in a generated file'); }
    if (c === ';') { if (cur.trim()) stmts.push(cur.trim()); cur = ''; i++; continue; }
    cur += c; i++;
  }
  if (cur.trim()) stmts.push(cur.trim());
  return { stmts, strings };
}

// ═══ [1] the real file ══════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] the D1 registry validates, and both generated files are current');
{
  const v = reg.validateRegistry(doc);
  assert(v.errors.length === 0, `1-1: the D1 file has no validation error (${v.errors.map((e) => e.id + ' ' + e.rule).join('; ') || 'none'})`);
  const a = reg.generateSeedSql(doc, { inputText }), b = reg.generateSeedSql(JSON.parse(inputText), { inputText });
  assert(a === b, '1-2: the generator is deterministic (V11): two runs, byte-identical');
  assert(a === seed, '1-3: 0054_news_seed_d1.sql is EXACTLY what the generator writes (a hand edit of the seed goes red here)');
  const teamsDoc = JSON.parse(readFileSync(P('supabase/news/fixtures/espn-teams-d1.json'), 'utf8'));
  assert(teamsGen.buildNewsTeamsModule(teamsDoc) === readFileSync(P('supabase/functions/_shared/news-teams.mjs'), 'utf8'), '1-4: news-teams.mjs is EXACTLY what build-news-teams.mjs writes from the recorded catalog');
  const cfb = NEWS_TEAM_CATALOG.filter((t) => t.league === 'cfb'), nfl = NEWS_TEAM_CATALOG.filter((t) => t.league === 'nfl');
  assert(cfb.length === 138 && nfl.length === 32 && cfb.every((t) => t.conference && t.location && t.displayName) && nfl.every((t) => t.location && t.displayName && t.nickname),
    `1-5: the catalog holds 138 FBS teams with conferences and 32 NFL teams (${cfb.length} / ${nfl.length})`);
  assert(new Set(NEWS_TEAM_CATALOG.map((t) => t.id)).size === NEWS_TEAM_CATALOG.length && Object.isFrozen(NEWS_TEAM_CATALOG) && Object.isFrozen(NEWS_TEAM_CATALOG[0]), '1-6: catalog ids are unique; the rows are frozen');
}

// ═══ [2] SC-N1 ══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] SC-N1: one quoting function, one statement, a byte-for-byte round trip');
{
  const t = tokenizeSql(seed);
  assert(t.stmts.length === 2 && /^set standard_conforming_strings = on$/i.test(t.stmts[0]) && /^insert into public\.news_sources/i.test(t.stmts[1]),
    `2-1: the committed 0054 is exactly two statements: the strings setting, then ONE insert (${t.stmts.length})`);
  assert(/on conflict \(id\) do nothing$/i.test(t.stmts[1]), '2-2: …and the insert is on conflict (id) do nothing (a re-paste changes nothing)');
  assert(!/\bE'/.test(seed) && !/\$[A-Za-z_]*\$/.test(seed), "2-3: no E'' string and no dollar quoting anywhere in the generated file");
  // the round trip: every string literal, in order, equals the field it came from
  const expectStrings = [];
  const rows = doc.sources.slice().sort((x, y) => (x.fallbackOf ? 1 : 0) - (y.fallbackOf ? 1 : 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const r of rows) {
    expectStrings.push(r.id, r.publisher, r.kind, ...r.sports, r.feedUrl, ...r.feedHosts, ...r.linkHosts, r.format, r.uaProfile, r.dateMode, r.paywall, r.launchTier);
    if (r.fallbackOf) expectStrings.push(r.fallbackOf);
    expectStrings.push(r.legalStatus === 'cleared' ? 'cleared' : 'pilot', r.legalNote);
    if (r.legalStatus === 'cleared') expectStrings.push(r.legalCheckedAt);
    expectStrings.push(...(Array.isArray(r.imageHosts) && r.imageHosts.length ? r.imageHosts : ['{}']), 'unverified');   // an empty text[] is the literal '{}'::text[]
  }
  const header = tokenizeSql(seed.slice(0, seed.indexOf('set standard_conforming_strings'))).strings;
  const body = t.strings.slice(header.length);
  const firstDiff = body.findIndex((x, i) => x !== expectStrings[i]);
  assert(JSON.stringify(body) === JSON.stringify(expectStrings), `2-4: every string literal decodes back to its field, in order (${body.length} literals${firstDiff >= 0 ? `; first difference at ${firstDiff}: ${JSON.stringify(body[firstDiff])} vs ${JSON.stringify(expectStrings[firstDiff])}` : ''})`);
  // hostile vectors in every free-text field
  const hostile = ["'", ';', '--', '$$', '\\', '/**/', "'); drop table public.news_sources; --", 'line\nbreak', 'para\u2028sep', "Frogs O' War", "Hawai'i Athletics", "Bucky's 5th Quarter", "O'Colly"];
  const evilDoc = JSON.parse(inputText);
  evilDoc.sources.forEach((r, i) => { const v0 = hostile[i % hostile.length]; r.legalNote = 'note ' + v0; r.publisher = r.id === 'nat-foxnews-all' ? 'Fox News' : 'Pub ' + v0.replace(/[\n\u2028]/g, ' ').slice(0, 20) + ' ' + i; });
  // publishers with control characters are refused by V9, so the newline vectors go only in legal notes (which V9 bounds by length and, for controls, refuses — see [3])
  evilDoc.sources.forEach((r) => { r.publisher = r.publisher.replace(/\s+/g, ' ').trim(); r.legalNote = r.legalNote.replace(/[\n\u2028]/g, ' '); });
  const v = reg.validateRegistry(evilDoc);
  assert(v.errors.length === 0, `2-5: the hostile vectors are VALID text (the quoting must handle them, SC-N1): ${v.errors.map((e) => e.id + ' ' + e.rule + ' ' + e.msg).join('; ') || 'none'}`);
  const sql = reg.generateSeedSql(evilDoc, { inputText: JSON.stringify(evilDoc) });
  const et = tokenizeSql(sql);
  assert(et.stmts.length === 2 && /^insert into public\.news_sources/i.test(et.stmts[1]), `2-6: with "'); drop table … --" in every row, the file is STILL exactly one insert (${et.stmts.length} statements)`);
  const evRows = evilDoc.sources.slice().sort((x, y) => (x.fallbackOf ? 1 : 0) - (y.fallbackOf ? 1 : 0) || (x.id < y.id ? -1 : 1));
  const evHeader = tokenizeSql(sql.slice(0, sql.indexOf('set standard_conforming_strings'))).strings;
  const evStrings = et.strings.slice(evHeader.length);
  const pubs = evRows.map((r) => r.publisher), notes = evRows.map((r) => r.legalNote);
  assert(pubs.every((p) => evStrings.includes(p)) && notes.every((n) => evStrings.includes(n)), '2-7: …and every hostile publisher and note round-trips byte for byte');
  let threw = '';
  try { reg.sqlLit('ok\u0000secret-value', 'nat-x.publisher'); } catch (e) { threw = String(e.message); }
  assert(/NUL/.test(threw) && threw.includes('nat-x.publisher') && !threw.includes('secret-value'), '2-8: a NUL throws, naming the id and field and NEVER the value');
  assert(reg.sqlLit("a'b") === "'a''b'" && reg.sqlArr([]) === "'{}'::text[]" && reg.sqlArr(["x'y"]) === "array['x''y']::text[]", '2-9: sqlLit doubles quotes; sqlArr builds only from sqlLit');
  // the generator lint: no field is interpolated into SQL text outside the quoting functions
  const gen = readFileSync(P('supabase/news/news-registry.mjs'), 'utf8');
  const genBody = gen.slice(gen.indexOf('  const rows = doc.sources.slice().sort'), gen.indexOf('export function imageHostUnion'));   // after the validity throw (an error message, not SQL)
  const interps = [...genBody.matchAll(/\$\{([^}]+)\}/g)].map((m) => m[1].trim());
  const allowed = (x) => /^r\.id$|^f$|^rows\.length|^enabledN|^rows\.length - enabledN$|^sha$|^SEED_COLUMNS\.join|^values\.join|^rows\.map\(\(r\) => sqlLit\(r\.id|^cleared\.length$|^pilotEnabledN$|^sqlLit\(r\.legalCheckedAt, w\('legalCheckedAt'\)\)$/.test(x);   // M-56: a count, and the quoted checked-at
  assert(interps.every(allowed), `2-10: the generator interpolates no field into SQL text (every \${…} is a count, the sha, the column list, the joined sqlLit output or the w() label): ${JSON.stringify(interps.filter((x) => !allowed(x)))}`);
}

// ═══ [3] the V-rules ════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] the V-rules, each with a failing fixture');
{
  const base = () => JSON.parse(inputText);
  const one = (mut) => { const d = base(); mut(d.sources.find((r) => r.id === 'nat-cbs-cfb'), d); return reg.validateRegistry(d).errors; };
  const has = (errs, rule) => errs.some((e) => e.rule === rule && e.id);
  const SECRET = 'SUPERSECRETVALUE';
  let e = one((r) => { r.feedUrl = `https://www.cbssports.com/rss/?apiKey=${SECRET}`; });
  assert(has(e, 'V13') && !JSON.stringify(e).includes(SECRET), '3-1: V13 a secret-shaped query key fails, and the message carries the id, never the value');
  e = one((r) => { r.feedUrl = 'http://www.cbssports.com/rss/'; }); assert(has(e, 'V17'), '3-2: V17 an http feed fails');
  e = one((r) => { r.feedUrl = 'https://user:pw@www.cbssports.com/rss/'; }); assert(has(e, 'V17'), '3-3: V17 a userinfo URL fails');
  e = one((r) => { r.feedUrl = 'https://www.cbssports.com:8443/rss/'; }); assert(has(e, 'V17'), '3-4: V17 a port fails');
  e = one((r) => { r.feedUrl = "https://www.cbssports.com/rss/'x"; }); assert(has(e, 'V17'), "3-5: V17 a ' in the feed URL fails (the character class, SC-N1)");
  e = one((r) => { r.feedUrl = 'https://10.0.0.5/rss/'; r.feedHosts = ['10.0.0.5']; }); assert(has(e, 'V16'), '3-6: an IP-literal host fails');
  e = one((r) => { r.feedHosts = ['other.example']; }); assert(has(e, 'SC-N3'), '3-7: SC-N3(c) the feed URL host must be in feedHosts');
  e = one((r) => { r.uaProfile = 'espn_library'; }); assert(has(e, 'V15'), '3-8: V15 espn_library only on site.api.espn.com');
  e = one((r) => { r.linkHosts = ['t.co']; }); assert(has(e, 'V16'), '3-9: V16 a denylisted redirector in linkHosts fails');
  e = one((r) => { r.linkHosts = ['.cloudfront.net']; }); assert(has(e, 'V16'), '3-10: V16 a suffix pattern on a multi-tenant platform fails');
  e = one((r) => { r.linkHosts = ['xn--cbssprts-x2a.com']; }); assert(has(e, 'SC-N4'), '3-11: an xn-- label without idnAck fails');
  e = one((r) => { r.legalStatus = 'cleared'; }); assert(has(e, 'V4'), '3-12: V4 `cleared` with no dated check and no recorded Drew decision fails');
  const M56 = { legalStatus: 'cleared', legalCheckedAt: '2026-10-15T00:00:00Z', legalDecision: 'M-56 (Drew, 2026-10-15): collect ESPN only' };
  e = one((r) => { Object.assign(r, M56, { enabled: true }); }); assert(!has(e, 'V4'), `3-12b: V4 (amended for M-56) — cleared WITH the dated check and Drew's recorded decision on an enabled row passes (${e.map((x) => x.msg).join('; ')})`);
  e = one((r) => { Object.assign(r, M56, { legalDecision: 'the coordinator said so' }); }); assert(has(e, 'V4'), '3-12c: V4 — a "decision" that does not name Drew\'s recorded M-item fails');
  e = one((r) => { Object.assign(r, M56, { legalCheckedAt: 'yesterday' }); }); assert(has(e, 'V4'), '3-12d: V4 — a cleared row without an ISO checked-at fails (0053\'s cleared-needs-date CHECK)');
  e = one((r) => { Object.assign(r, M56, { legalStatus: 'blocked' }); }); assert(has(e, 'V4'), '3-12e: V4 — the registry may seed only `cleared` (blocked or anything else is refused)');
  e = one((r) => { Object.assign(r, M56, { enabled: false }); }); assert(has(e, 'V4'), '3-12f: V4 — a cleared row must be seeded enabled');
  e = one((r) => { r.legal_status = 'cleared'; }); assert(has(e, 'V4'), '3-12g: V4 — the snake_case spelling is refused');
  e = one((r) => { r.imageHosts = ['sportshub.cbsistatic.com']; }); assert(has(e, 'SC-N5'), '3-13: SC-N5 a seeded image host with no recorded approval (and on a pilot row) fails');
  const IMG = { imageHosts: ['.espncdn.com'], imageDecision: 'v0.29.0 (live since 2026-10-03): the approved ESPN picture hosts' };
  e = one((r) => { Object.assign(r, M56, IMG, { enabled: true }); }); assert(!has(e, 'SC-N5'), `3-13b: SC-N5 (amended) — picture hosts WITH their recorded approval on a cleared row pass (${e.map((x) => x.msg).join('; ')})`);
  e = one((r) => { Object.assign(r, IMG); }); assert(has(e, 'SC-N5'), '3-13c: SC-N5 — picture hosts on a PILOT row fail, approval or not');
  e = one((r) => { Object.assign(r, M56, IMG, { enabled: true, imageHosts: ['1.2.3.4'] }); }); assert(has(e, 'SC-N5'), '3-13d: SC-N5 — a malformed picture host fails');
  e = one((r) => { Object.assign(r, M56, { enabled: true, imageHosts: ['.espncdn.com'] }); }); assert(has(e, 'SC-N5'), '3-13e: SC-N5 — picture hosts without imageDecision fail');
  e = one((r) => { r.publisher = 'SCRIBE Sports'; }); assert(has(e, 'V9'), '3-14: V9 a banned voice in the publisher fails');
  e = one((r) => { r.publisher = 'CBS\u202ESports'; }); assert(has(e, 'V9'), '3-15: V9 a bidi override in the publisher fails');
  e = one((r) => { r.legalNote = 'note\nwith a line break'; }); assert(has(e, 'V9'), '3-16: V9 a control character in a legal note fails');
  e = one((r, d) => { d.sources.find((x) => x.id === 'nat-foxnews-all').publisher = 'Fox Sports'; }); assert(e.some((x) => x.rule === 'D-40'), '3-17: Fox News may never be labelled "Fox Sports" (D-40)');
  e = one((r, d) => { d.sources.find((x) => x.id === 'nat-espn-cfb-json').fallbackOf = 'nat-espn-cfb'; }); assert(e.some((x) => /cycle/.test(x.msg)), '3-18: a fallback cycle fails');
  e = one((r) => { r.fallbackOf = 'no-such-row'; }); assert(e.some((x) => /fallbackOf/.test(x.msg)), '3-19: a fallback naming no row fails');
  e = one((r, d) => { d.sources.push({ ...r }); }); assert(has(e, 'V3'), '3-20: V3 a duplicate id fails');
  e = one((r, d) => { const c = { ...r, id: 'nat-cbs-cfb-2' }; d.sources.push(c); }); assert(has(e, 'V10'), '3-21: V10 the same feed URL twice fails');
  e = one((r) => { r.sports = ['cfb', 'curling']; }); assert(has(e, 'V2'), '3-22: V2 an unknown sport fails');
  e = one((r) => { delete r.format; }); assert(has(e, 'V2'), '3-23: V2 a missing required key fails');
  let threw = false;
  try { const d = base(); d.sources[0].feedUrl = 'http://x'; reg.generateSeedSql(d); } catch { threw = true; }
  assert(threw, '3-24: the generator REFUSES to write a seed from an invalid registry');
}

// ═══ [4] D1 facts ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] D1 facts (D-39, D-40, DI-671)');
{
  const rows = doc.sources;
  const pubs = [...new Set(rows.map((r) => r.publisher))].sort();
  assert(rows.length === 13 && JSON.stringify(pubs) === JSON.stringify(['CBS Sports', 'ESPN', 'Fox News', 'NBC Sports', 'NCAA.com', 'Sports Illustrated', 'Yahoo Sports']),
    `4-1: 13 rows; ESPN plus the D-40 five (CBS Sports, Yahoo Sports, Sports Illustrated, NBC Sports, NCAA.com) plus the Fox News reserve (${pubs.join(', ')})`);
  const fox = rows.find((r) => r.id === 'nat-foxnews-all');
  assert(fox && fox.enabled === false && !('legalStatus' in fox) && fox.publisher === 'Fox News' && /M-56/.test(fox.legalNote) && /not a Drew exclusion/.test(fox.legalNote),
    '4-2: Fox News (labelled "Fox News", never "Fox Sports") is seeded DISABLED and PILOT with the other eight; Drew enables them after the privacy page is served (M-56 Phase 2); its note records that the reserve was the coordinator\'s (D-40), not a Drew exclusion');
  const ESPN_IDS = ['nat-espn-cfb', 'nat-espn-cfb-json', 'nat-espn-nfl', 'nat-espn-nfl-json'];
  assert(JSON.stringify(rows.filter((r) => r.enabled).map((r) => r.id).sort()) === JSON.stringify(ESPN_IDS) && JSON.stringify(rows.filter((r) => r.legalStatus === 'cleared').map((r) => r.id).sort()) === JSON.stringify(ESPN_IDS),
    '4-3: M-56, two phases (the coordinator\'s option A, 2026-10-15) — the four ESPN rows are seeded enabled and cleared; the nine other publishers are seeded PILOT and DISABLED (Drew enables them after the new privacy page is served; R-C28(b))');
  assert(rows.find((r) => r.id === 'nat-nbcpft-nfl').feedUrl === 'https://www.nbcsports.com/profootballtalk.rss', '4-4: ProFootballTalk is registered at its FINAL URL (the old one redirects off-host)');
  const V029 = ['espncdn.com', '.espncdn.com', 'espn.com', '.espn.com', 'espnmedia-cdn.akamaized.net'];
  // live v0.29.0's ESPN picture allow-list, read from js/newsCard.js's NEWS_IMAGE_HOSTS (text, not an import: newsCard reaches the DOM helpers)
  const ncSrc = readFileSync(P('js/newsCard.js'), 'utf8');
  const blockNC = ncSrc.slice(ncSrc.indexOf('export const NEWS_IMAGE_HOSTS'), ncSrc.indexOf('});', ncSrc.indexOf('export const NEWS_IMAGE_HOSTS')));
  const v029Hosts = [...blockNC.matchAll(/'([a-z0-9.-]+)'/g)].map((m) => m[1]);
  assert(rows.filter((r) => 'imageHosts' in r).map((r) => r.id).sort().join() === ESPN_IDS.join() && rows.filter((r) => 'imageHosts' in r).every((r) => JSON.stringify(r.imageHosts) === JSON.stringify(V029))
    && JSON.stringify(V029.slice().sort()) === JSON.stringify(v029Hosts.sort()),
    '4-5: picture hosts are seeded ONLY on the four ESPN rows, and they are EXACTLY live v0.29.0\'s approved ESPN set (js/newsCard.js NEWS_IMAGE_HOSTS); no other publisher\'s pictures');
  assert(JSON.stringify(reg.imageHostUnion(doc)) === JSON.stringify(['a.espncdn.com', 'a57.foxnews.com', 'espnmedia-cdn.akamaized.net', 'images2.minutemediacdn.com', 'nbcsports.brightspotcdn.com', 'sportshub.cbsistatic.com', 'www.ncaa.com']),
    '4-6: the union Drew reviews once is these seven hosts (no fetch-any-URL proxy among them)');
  assert(reg.imageHostUnion(doc).every((h) => !rules.FORBIDDEN_IMAGE_PROXIES.some((f) => h === f || h.endsWith('.' + f))), '4-7: …none is a forbidden proxy');
  const stmtText = seed.slice(seed.indexOf('set standard_conforming_strings'));
  const clearedRows = stmtText.split('\n').filter((l) => /^\s*\('nat-/.test(l) && /'cleared'/.test(l)).map((l) => l.match(/^\s*\('([a-z0-9-]+)'/)[1]).sort();
  assert(JSON.stringify(clearedRows) === JSON.stringify(ESPN_IDS) && rows.filter((r) => r.legalStatus === 'cleared').every((r) => /^M-56 \(Drew, 2026-10-15\)/.test(r.legalDecision)),
    "4-8: M-56 — the seed's statements set 'cleared' on the four ESPN rows ONLY, each carrying Drew's recorded decision (DI-479 5.6 as amended by M-56)");
  assert(!/set\s+legal_status\s*=\s*'cleared'|legal_status\s*:=\s*'cleared'|values[^;]*'cleared'/i.test(m53.replace(/--[^\n]*/g, '')), "4-9: 0053 never SETS 'cleared' (only compares with it)");
  assert(rows.filter((r) => r.multiSport).map((r) => r.id).sort().join() === 'nat-foxnews-all,nat-si-all' && rows.filter((r) => r.allowVia).every((r) => r.publisher === 'Yahoo Sports'),
    '4-10: SI and Fox News are the multi-sport rows; only Yahoo carries a via credit');
  assert(rows.filter((r) => r.dateMode === 'local_civil').map((r) => r.id).sort().join() === 'nat-espn-cfb,nat-espn-nfl', '4-11: the ESPN RSS rows read "EST" as local civil time');
}

// ═══ [5] drift ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] drift between the JS rules and the SQL helper');
{
  const fn = m53.slice(m53.indexOf('create or replace function public.news_hosts_ok'), m53.indexOf('create or replace function public.news_keys_ok'));
  const sqlList = [...(/if h in \(([^)]*)\)/.exec(fn) || [])[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
  assert(JSON.stringify(sqlList) === JSON.stringify(rules.MULTI_TENANT_SUFFIXES.slice().sort()), `5-1: the multi-tenant pattern list is identical in js/newsRules.js and 0053's news_hosts_ok() (${sqlList.length})`);
  const fr = (/feed_url !~\* '([^']+)'/.exec(m53) || [])[1] || '';
  assert(['key', 'token', 'secret', 'auth', 'sig', 'pass', 'pwd', 'session', 'credential', 'hmac'].every((k) => fr.includes(k)), '5-2: the SQL secret-key detector names the same ten parts as hasSecretShapedQueryKey');
  assert(m53.includes(reg.FEED_URL_RE.source.replace(/\\\//g, '/').replace('^https://', '^https://')) || m53.includes("feed_url ~ '^https://[A-Za-z0-9._~:/?#@!$&()*+,;=%-]+$'"), '5-3: the V17 feed-URL character class is the same in the generator and in 0053\'s CHECK');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
