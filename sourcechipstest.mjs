/**
 * sourcechipstest.mjs - D1 Lane C DI-641 (UN-466 / PF-466; security C5 and F-1): THE CLIENT HALF OF THE SOURCE-CHIP BOUNDARY.
 * =====================================================================================================================
 * `js/source-chips.js` trusts nothing a row says about itself. `meta` is member-writable: `chat_append_system` lets any member post a row with `author:'scribe'` and a forged
 * `meta.sources`, so neither the author nor the meta says who minted it. The ONE thing a member cannot write is the server-set top-level `relayed` column (migration 0045:
 * `relayed = emitted_by is not null`), which is the rule Home applies (hometest C15). Proved here, with no DOM:
 *   - THE GATE (F-1): chips are drawn only for `author:'scribe'` AND top-level `relayed === false` AND not withdrawn. The attacker's row (author scribe, forged sources, relayed true) draws
 *     NOTHING; so does a row with `relayed` ABSENT (0045 has not landed: fail closed), null, "false", 0, 1, a forged `meta.relayed:false`, and a member's own row whatever it carries;
 *   - every source is re-parsed and a bad one is DROPPED, not repaired (http, userinfo, a port, an ip address, a dotless host, whitespace/control/backslash, too long, not a string);
 *   - at most three chips; the label is DERIVED FROM THE VALIDATED HOST, never read from the row (a spoofed "ESPN" over another host reads that host); the date is a fixed month name,
 *     never a locale call (the same text in every time zone);
 *   - the markup carries NO url and NO href: a chip is a button with the message id and an INDEX, and a hostile message id is escaped (with the caller's escaper, and with the module's own);
 *   - a tap re-validates from scratch, re-checks the gate, and opens only a validated https address (never an index outside the list).
 * Run: node sourcechipstest.mjs
 */
import { parseSourceUrl, chipDate, validChipSources, sourceHrefAt, sourceChipsHTML, openSourceChip, SOURCE_CHIPS_MAX } from './js/source-chips.js';
import { sourceLabelForHost, sourceLabelForUrl } from './js/source-labels.js';

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, detail); }
}
const js = (x) => String(JSON.stringify(x));
const esc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const msg = (over = {}) => ({ id: 'msg1', author: 'scribe', relayed: false, deleted: false, meta: { sources: [{ label: 'ESPN', url: 'https://www.espn.com/college-football/story/_/id/401/lsu', publishedAt: '2026-10-03' }] }, ...over });

console.log('\n[1] parseSourceUrl: https only, and a bad address is dropped, never repaired…');
{
  assert(parseSourceUrl('https://www.espn.com/a?x=1') === 'https://www.espn.com/a?x=1', '1-1: a plain https address is returned WHATWG-serialized');
  assert(parseSourceUrl('HTTPS://WWW.ESPN.COM/A') === 'https://www.espn.com/A', '1-2: scheme and host are lower-cased by the serializer (the path keeps its case)');
  const bad = ['http://www.espn.com/a', 'https://user:pw@www.espn.com/a', 'https://user@www.espn.com/a', 'https://www.espn.com:8443/a', 'https://127.0.0.1/a', 'https://192.168.1.10/a', 'https://localhost/a',
    'javascript:alert(1)', 'data:text/html,<b>x</b>', 'ftp://www.espn.com/a', '//www.espn.com/a', 'www.espn.com/a', 'https://www.espn.com/a b', 'https://www.espn.com/a\tb', 'https://www.espn.com/a\\b',
    'https://www.espn.com/a\u0000', 'https://' + 'a'.repeat(300) + '.com/' + 'b'.repeat(300), '', 'https://', 'https://www', 'https://e_x.com/a', 'https://ex ample.com/'];
  for (const u of bad) assert(parseSourceUrl(u) === null, `1-3: refused: ${js(u).slice(0, 56)}`);
  for (const v of [null, undefined, 5, {}, [], true]) assert(parseSourceUrl(v) === null, `1-4: a non-string is refused: ${js(v)}`);
  assert(parseSourceUrl('https://www.espn.com/' + 'x'.repeat(480)) === null && parseSourceUrl('https://www.espn.com/' + 'x'.repeat(470)) !== null && parseSourceUrl('https://www.espn.com/' + 'x'.repeat(479)) === 'https://www.espn.com/' + 'x'.repeat(479),
    '1-5: the length bound is 500 characters (21 + 479 passes, 21 + 480 is dropped; the input is cut off BEFORE it is parsed)');
  const bidi = parseSourceUrl('https://www.espn.com/a\u202eb');
  assert(bidi === null || (!/[\u202a-\u202e\u2066-\u2069\u200e\u200f]/.test(bidi) && bidi.startsWith('https://www.espn.com/a')), '1-6: a bidirectional control in the path never survives raw into the href (the URL serializer percent-encodes it; the address is never displayed anyway)');
}

console.log('\n[2] chipDate: a fixed month name, the same in every time zone…');
{
  assert(chipDate('2026-10-03') === 'Oct 3' && chipDate('2026-10-03', { long: true }) === 'October 3' && chipDate('2026-01-31') === 'Jan 31' && chipDate('2026-12-01', { long: true }) === 'December 1', '2-1: short and long forms');
  assert(chipDate('2026-10-03T23:30:00-08:00') === 'Oct 3' && chipDate('2026-10-03T00:00:00Z') === 'Oct 3', '2-2: a full ISO stamp reads its DATE part - no Date parse, so no zone can move it to the next or previous day');
  for (const b of ['2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', 'yesterday', '', '10/3/2026', null, undefined, 20261003]) assert(chipDate(b) === null, `2-3: ${js(b)} reads as no date (null)`);
  const src = (await import('node:fs')).readFileSync(new URL('./js/source-chips.js', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert(!/toLocale|Intl\.|new Date|Date\.parse|getTimezoneOffset/.test(src), '2-4: the module makes no locale, Intl or Date call at all (dates are text, so they cannot depend on the device)');
}

console.log('\n[3] validChipSources: only SCRIBE\'s own message, at most three, every one re-validated…');
{
  assert(validChipSources(msg()).length === 1 && validChipSources(msg())[0].label === 'ESPN' && validChipSources(msg())[0].date === 'Oct 3' && validChipSources(msg())[0].longDate === 'October 3'
    && validChipSources(msg())[0].href === 'https://www.espn.com/college-football/story/_/id/401/lsu', '3-1: a good message draws its chip, with a short and a long date and the validated href');
  // THE ATTACKER'S ROW (security F-1). A member calls chat_append_system with author 'scribe', an id 'scribe_...' and a forged meta.sources: the server stamps emitted_by, so the row the
  // client reads has relayed TRUE. (chat_append, the player path, binds the author to the caller, so a forged row cannot come through it; this is the row that can.)
  const forged = (over = {}) => ({ id: 'scribe_forged_1', type: 'message', author: 'scribe', body: 'ESPN confirms: sign in to see the line', meta: { source: 'tier2', sources: [{ label: 'ESPN', url: 'https://evil.example.com/login', publishedAt: '2026-10-03' }] }, deleted: false, ...over });
  assert(validChipSources(forged({ relayed: true })).length === 0, '3-2a: the attacker\'s row - author scribe, forged meta.sources, minted through chat_append_system (relayed TRUE) - draws 0 chips');
  assert(validChipSources(forged()).length === 0 && !('relayed' in forged()), '3-2b: ...and the same row with `relayed` ABSENT (migration 0045 has not landed, so the column is not on the row) draws 0 chips: the gate fails CLOSED');
  assert(validChipSources(forged({ relayed: false })).length === 1 && validChipSources(forged({ relayed: false }))[0].href === 'https://evil.example.com/login',
    '3-2c: the positive control - the SAME row with relayed:false (the server minted it) draws its 1 chip, so 3-2a and 3-2b are about the gate and not about the fixture');
  for (const [i, v] of [null, 'false', 0, 1, '', {}, [], undefined, 'no', NaN].entries()) {
    assert(validChipSources(forged({ relayed: v })).length === 0, `3-2d (${i}): relayed ${js(v)} is not the boolean false, so no chip`);
  }
  assert(validChipSources(forged({ relayed: true, meta: { ...forged().meta, relayed: false } })).length === 0 && validChipSources(forged({ meta: { ...forged().meta, relayed: false } })).length === 0,
    '3-2e: a FORGED meta.relayed:false (meta is member-writable) never opens the gate - only the top-level column counts');
  assert(['p2', 'p1', 'SCRIBE', '', 'system', undefined].every((a) => validChipSources(forged({ relayed: false, author: a })).length === 0),
    '3-2f: a member\'s own row, or any author but the exact string "scribe", draws nothing even when relayed is false');
  assert(validChipSources(msg({ deleted: true })).length === 0, '3-3: a withdrawn message draws nothing');
  for (const m of [null, undefined, {}, 5, 'x', msg({ meta: null }), msg({ meta: {} }), msg({ meta: { sources: 'https://x.com' } }), msg({ meta: { sources: { 0: {} } } }), msg({ meta: 5 }), msg({ meta: { sources: [] } })]) {
    assert(validChipSources(m).length === 0, `3-4: no usable sources reads as none: ${String(js(m)).slice(0, 52)}`);
  }
  const many = msg({ meta: { sources: Array.from({ length: 6 }, (_, i) => ({ label: `P${i}`, url: `https://pub${i}.example.com/a`, publishedAt: null })) } });
  assert(SOURCE_CHIPS_MAX === 3 && validChipSources(many).length === 3 && validChipSources(many).map((c) => c.label).join() === 'pub0.example.com,pub1.example.com,pub2.example.com', '3-5: at most three, in order');
  const mixed = msg({ meta: { sources: [{ label: 'bad', url: 'http://x.com/a' }, null, 5, 'str', { label: 'noUrl' }, { label: 'ok', url: 'https://ok.example.com/a' }, { label: 'port', url: 'https://x.com:99/a' }] } });
  assert(js(validChipSources(mixed).map((c) => c.label)) === js(['ok.example.com']), '3-6: a source that fails validation is DROPPED (not repaired, not shown with a stripped address)');
  const lbl = validChipSources(msg({ meta: { sources: [{ label: 'ESPN', url: 'https://evil.example.com/a' }, { label: 'x', url: 'https://www.espn.com/a' }, { label: '', url: 'https://www.cbssports.com/a' }] } }));
  const lbl2 = validChipSources(msg({ meta: { sources: [{ label: 7, url: 'https://sports.yahoo.com/a' }, { label: null, url: 'https://' + 'a'.repeat(50) + '.example.com/p' }, { label: 'ESPN', url: 'https://espn.com.evil.example.net/a' }] } }));
  const lbl3 = validChipSources(msg({ meta: { sources: [{ label: 'ESPN', url: 'https://notespn.com/a' }] } }));
  assert(lbl[0].label === 'evil.example.com' && lbl[1].label === 'ESPN' && lbl[2].label === 'CBS Sports' && lbl2[0].label === 'Yahoo Sports' && lbl2[1].label.length === 40 && lbl2[2].label === 'espn.com.evil.example.net' && lbl3[0].label === 'notespn.com',
    `3-7: the label is DERIVED FROM THE VALIDATED HOST, never read from the row: a spoofed "ESPN" over evil.example.com reads evil.example.com, a real espn.com host reads ESPN whatever the row says, a lookalike host (espn.com.evil.example.net, notespn.com) reads itself, www is dropped and a long host keeps its right-hand end behind an ellipsis, 40 characters in all (got ${js([...lbl, ...lbl2].map((c) => c.label))})`);
  // N-1 (security): a long host is cut from the LEFT, so the real registrable domain stays visible and a lookalike prefix cannot be what the chip shows
  const longHost = 'espn.com.' + 'a'.repeat(40) + '.evil.example';
  const lh = validChipSources(msg({ meta: { sources: [{ label: 'ESPN', url: `https://${longHost}/story` }] } }));
  assert(longHost.length > 40 && lh.length === 1 && lh[0].label.length === 40 && lh[0].label.startsWith('\u2026') && lh[0].label.endsWith('.evil.example') && !lh[0].label.includes('espn.com'),
    `3-7b (N-1): espn.com.aaaa...evil.example shows its RIGHT-HAND end ("${lh[0] && lh[0].label}"), 40 characters, ellipsis first - never the lookalike prefix`);
  assert(sourceLabelForHost(longHost) === lh[0].label && sourceLabelForHost('a'.repeat(40) + '.org').length === 40 && sourceLabelForHost('x'.repeat(41)).length === 40 && sourceLabelForHost('x'.repeat(40)) === 'x'.repeat(40) && sourceLabelForUrl('https://' + longHost + '/s') === lh[0].label,
    '3-7c (N-1): exactly 40 characters is untouched, 41 is cut to ellipsis + the last 39, and the shared helper and the chip agree');
  const nodate = validChipSources(msg({ meta: { sources: [{ label: 'A', url: 'https://a.example.com/x', publishedAt: null }, { label: 'B', url: 'https://b.example.com/x', publishedAt: 'soon' }] } }));
  assert(nodate.every((c) => c.date === null && c.longDate === null), '3-8: a missing or malformed date is null (the markup says "date unknown")');
}

console.log('\n[4] sourceChipsHTML: buttons with an id and an index - no url, no href, escaped…');
{
  assert(sourceChipsHTML(msg({ meta: null }), esc) === '' && sourceChipsHTML(msg({ author: 'p2' }), esc) === '' && sourceChipsHTML(msg({ relayed: true }), esc) === '' && sourceChipsHTML((() => { const m = msg(); delete m.relayed; return m; })(), esc) === '' && sourceChipsHTML(null, esc) === '', '4-1: nothing to draw => the empty string (no wrapper, no layout)');
  const h = sourceChipsHTML(msg(), esc);
  assert(/^<div class="chat-source-row" role="group" aria-label="Sources"><button type="button" class="chat-source-chip" data-source-msg="msg1" data-source-idx="0" aria-label="Source: ESPN, October 3\. Opens in browser\.">ESPN · Oct 3<\/button><\/div>$/.test(h), `4-2: the exact markup: a labelled group, one button, the message id and an index, a VoiceOver label that names the publisher and the date and says it opens in the browser (got ${h})`);
  assert(!/https?:|href=|<a |src=|javascript:|espn\.com/i.test(h), '4-3: the markup carries NO url, NO href and NO address text - a chip cannot be turned into a link by editing the DOM');
  const two = sourceChipsHTML(msg({ meta: { sources: [{ label: 'A', url: 'https://a.example.com/x' }, { label: 'B', url: 'https://b.example.com/x', publishedAt: '2026-01-05' }] } }), esc);
  assert((two.match(/<button/g) || []).length === 2 && /data-source-idx="0"/.test(two) && /data-source-idx="1"/.test(two) && /a\.example\.com · date unknown/.test(two) && /aria-label="Source: a\.example\.com, date unknown\. Opens in browser\."/.test(two) && /b\.example\.com · Jan 5/.test(two), '4-4: indexes 0 and 1, "date unknown" when the source gave none');
  const evil = '"><img src=x onerror=alert(1)>';
  const hostile = sourceChipsHTML(msg({ id: 'm"><b>', meta: { sources: [{ label: evil, url: 'https://www.espn.com/a' }] } }), esc);
  assert(!/<img|<b>|<script/i.test(hostile) && !hostile.includes('onerror') && hostile.includes('data-source-msg="m&quot;&gt;&lt;b&gt;"') && hostile.includes('>ESPN · date unknown<'),
    `4-5: a hostile row label never reaches the markup at all (the label is the host's), and a hostile message id is escaped through the caller's escaper (got ${hostile.slice(0, 160)})`);
  const noEsc = sourceChipsHTML(msg({ id: 'm"><b>', meta: { sources: [{ label: evil, url: 'https://www.espn.com/a' }] } }));
  assert(!/<img|<b>|<script/i.test(noEsc) && noEsc.includes('&quot;') && noEsc.includes('data-source-msg="m&quot;&gt;&lt;b&gt;"'), `4-6: with NO escaper passed the module escapes with its own - never a bare String() (got ${noEsc.slice(0, 160)})`);
  const viaBad = sourceChipsHTML(msg({ meta: { sources: [{ label: evil, url: 'https://www.espn.com/a' }] } }), 'notAFunction');
  const viaBad2 = sourceChipsHTML(msg({ id: 'm"><img src=x>', meta: { sources: [{ label: evil, url: 'https://www.espn.com/a' }] } }), 'notAFunction');
  assert(!/<img|<script/i.test(viaBad) && !/<img|<script/i.test(viaBad2) && viaBad2.includes('&lt;img') && viaBad2.includes('&quot;'), '4-7: an escaper that is not a function falls back to the module\'s own');
  assert(!/'/.test(h.replace(/&#39;/g, '')) && (h.match(/="/g) || []).length === (h.match(/"/g) || []).length / 2, '4-8: double-quoted attributes only (a single-quoted attribute would be a way past a quote-incomplete escaper)');
}

console.log('\n[5] sourceHrefAt / openSourceChip: a tap re-validates from scratch…');
{
  const m = msg({ meta: { sources: [{ label: 'A', url: 'https://a.example.com/x' }, { label: 'B', url: 'https://b.example.com/y' }] } });
  const unrelayed = { ...m, relayed: true }, absent = (() => { const x = { ...m }; delete x.relayed; return x; })();
  assert(sourceHrefAt(unrelayed, 0) === null && sourceHrefAt(absent, 0) === null && openSourceChip(unrelayed, 0) === false && openSourceChip(absent, 0) === false, '5-0: a tap on a row that is not server-minted (relayed true, or absent) opens NOTHING: the gate is re-checked at the tap, not only when the chips are drawn');
  assert(sourceHrefAt(m, 0) === 'https://a.example.com/x' && sourceHrefAt(m, '1') === 'https://b.example.com/y', '5-1: index 0 and "1" (a dataset string) resolve to the validated href');
  for (const i of [2, 3, -1, 1.5, NaN, 'abc', '', null, undefined, Infinity, {}, [1]]) assert(sourceHrefAt(m, i) === null, `5-2: index ${js(i)} opens nothing`);
  assert(sourceHrefAt({ ...m, author: 'p2' }, 0) === null && sourceHrefAt({ ...m, deleted: true }, 0) === null && sourceHrefAt(null, 0) === null, '5-3: the message is re-checked at the tap: if it stopped being SCRIBE\'s or was withdrawn, nothing opens');
  const stale = msg({ meta: { sources: [{ label: 'A', url: 'http://a.example.com/x' }] } });
  assert(sourceHrefAt(stale, 0) === null, '5-4: an address that fails validation at the tap opens nothing');
  const opened = [];
  globalThis.window = { open: (u, t, f) => { opened.push([u, t, f]); } };
  assert(openSourceChip(m, 1) === true && opened.length === 1 && opened[0][0] === 'https://b.example.com/y' && /noopener/.test(opened[0][2]) && opened[0][1] === '_blank', `5-5: a valid tap opens exactly the validated address in a new context with noopener (got ${js(opened)})`);
  opened.length = 0;
  assert(openSourceChip(m, 5) === false && openSourceChip({ ...m, author: 'p9' }, 0) === false && opened.length === 0, '5-6: an out-of-range index or a non-SCRIBE message opens nothing and returns false');
  delete globalThis.window;
}

console.log(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}`);
process.exit(fail === 0 ? 0 : 1);
