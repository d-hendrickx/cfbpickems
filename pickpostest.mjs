/**
 * CFB Pickems — pickpostest.mjs
 * =============================
 * UN-413 / DI-503 / DI-505 / DI-507 — the submit line in the Locker Room (Social Platform, Feature 2, 2026-10-01; migration 0044), as amended by Amendment 1 (Q6: the line NAMES who is still missing)
 * and bound by security-reviewer's SC-S1 … SC-S11.
 *
 * WHAT THIS PROVES, AND WHAT IT CANNOT. The line is composed by a database trigger, and an offline suite cannot run Postgres (the fakes enforce no triggers, grants or constraints — a green offline
 * suite is not evidence about the real server; rls.test.mjs group pickPost, Drew's, is). What CAN be proved offline, and is here:
 *   - the SQL's own text is the SPEC: every model below is DERIVED from the parsed migration (the leaguesettingstest [8] technique) — the character classes, the link pattern, the caps, the literal
 *     words and their order are read OUT of 0044's text, never retyped, so the model cannot drift from the SQL and a mutation of the SQL turns a case here red;
 *   - week_label_plain is the SQL twin of data-model.js composeWeekNamePart: parity over a fixture matrix against the REAL formatWeekLabelParts();
 *   - the neutralizer's contract against chat-ui's REAL URL_RE: for a fuzz of hostile names no composed line ever contains text that regex would linkify, and no bidi / format character survives;
 *   - the body formula (counts, the "A and B" / "and N others" forms, the last member's "everyone's in") reproduces the DI's own example verbatim and stays inside the 1000-character column cap;
 *   - the row can never reach a push or a badge: it fails notify-fanout's REAL shouldFanout() and the real chat fold's unread count.
 *
 * Run:  node pickpostest.mjs
 */
import { readFile } from 'node:fs/promises';

const _ls = new Map();
globalThis.localStorage = { getItem: (k) => (_ls.has(k) ? _ls.get(k) : null), setItem: (k, v) => _ls.set(k, String(v)), removeItem: (k) => _ls.delete(k), clear: () => _ls.clear() };
let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
console.log('\npickpostest.mjs — UN-413 the submit line (migration 0044)\n');

const SQL = await readFile(new URL('./supabase/migrations/0044_pick_status_submit_line.sql', import.meta.url), 'utf8');
const strip = (t) => t.replace(/--[^\n]*/g, ' ');
const ws = (t) => t.replace(/\s+/g, ' ').trim();
const norm = (t) => ws(strip(t));
const block = (name) => {
  const i = SQL.search(new RegExp('^create or replace function public\\.' + name + '\\(', 'm'));
  const e = SQL.indexOf('$$;', i);
  return SQL.slice(i, e + 3);
};
const LAB = norm(block('week_label_plain'));
const ANN = norm(block('announce_member_in'));
const BS = String.fromCharCode(92);     // a backslash, built — this file never contains a unicode-escape sequence in its own source

// ── the parts of the SQL the models are DERIVED from ─────────────────────────────────────────────────────
const pull = (hay, re, what) => { const m = re.exec(hay); if (!m) throw new Error('could not derive ' + what + ' from 0044'); return m; };
const BIDI_SRC = pull(LAB, /'(\[[^'\]]*\]\+)', '', 'g'\)\), 60\)/, 'the bidi/format class')[1];          // the class as SQL spells it: [<escapes>]+
const URL_SRC = pull(ANN, /!~\* '(\([^']*\))'/, 'the link pattern')[1];                                       // (https?://|www\.)
const CAP_NAME = Number(pull(ANN, /\), (\d+)\) as v\) cn/, 'the name cap')[1]);
const CAP = { label: Number(pull(LAB, /p_label, ''\), '\[\[:cntrl:\]\]\+', ' ', 'g'\), '\[[^']*\]\+', '', 'g'\)\), (\d+)\)/, 'label cap')[1]),
              espn: Number(pull(LAB, /p_espn, ''\)[^;]*?, (\d+)\);/, 'espn cap')[1]), round: Number(pull(LAB, /p_round, ''\)[^;]*?, (\d+)\);/, 'round cap')[1]),
              out: Number(pull(LAB, /return left\(v_out, (\d+)\);/, 'result cap')[1]) };
const CNTRL = new RegExp('[' + BS + 'u0000-' + BS + 'u001F' + BS + 'u007F-' + BS + 'u009F]+', 'g');        // postgres [[:cntrl:]] on UTF-8: C0, DEL, C1
const BIDI = new RegExp(BIDI_SRC, 'g');                                                                      // read straight from the SQL (a JS regex source accepts the same escapes)
const URLRE = new RegExp(URL_SRC, 'i');                                                                      // `~*`: case-insensitive, anywhere in the piece
const lit = (re, what) => pull(ANN, re, what)[1].replace(/''/g, "'");
const WORDS = {
  isIn: lit(/v_name \|\| '([^']*)' \|\| v_label \|\| ' · everyone/, 'is-in words'),
  everyone: lit(/v_label \|\| '( · everyone''s in)';/, 'everyone words'),
  sep: lit(/v_label \|\| '( · )' \|\| v_in::text/, 'separator'),
  of: lit(/v_in::text \|\| '( of )' \|\| v_total::text/, 'of'),
  waiting: lit(/v_total::text \|\| '( · still waiting on )' \|\| v_waiting/, 'waiting'),
  and: lit(/v_missing\[1\] \|\| '( and )' \|\| v_missing\[2\] when/, 'and'),
  comma: lit(/v_missing\[1\] \|\| '(, )' \|\| v_missing\[2\] \|\| ' and ' \|\| v_missing\[3\]/, 'comma'),
  others: lit(/\(v_n_missing - 2\)::text \|\| '( others)'/, 'others'),
  fallback: lit(/else '(A player)' end as nm/, 'fallback'),
};

console.log('[1] THE SPEC IS READ OUT OF THE SQL — every derived constant, and what it must be…');
{
  assert(BIDI_SRC.startsWith('[') && BIDI_SRC.endsWith(']+') && Array.from(BIDI_SRC).every((c) => c.charCodeAt(0) < 128) && (BIDI_SRC.match(new RegExp(BS + 'u', 'g')) || []).length === 9,
    '[1a] the bidi / format class in the SQL is spelled with 9 unicode escapes (5 ranges and the BOM) (200B-200F, 202A-202E, 2060-2064, 2066-2069, FEFF) — as TEXT, not raw invisible characters');
  const probe = (code) => BIDI.test(String.fromCharCode(code)) && (BIDI.lastIndex = 0) === 0;
  const must = [0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x202A, 0x202B, 0x202C, 0x202D, 0x202E, 0x2060, 0x2061, 0x2062, 0x2063, 0x2064, 0x2066, 0x2067, 0x2068, 0x2069, 0xFEFF];
  assert(must.every(probe), '[1b] every bidi / zero-width / format code point the security verdict names (SC-S3) is matched by the SQL\'s own class');
  assert(![0x41, 0x20, 0x00B7, 0x2013, 0x2014, 0x2065, 0x202F, 0x00A0, 0x1F4CB].some(probe), '[1c] …and ordinary text, spaces, the middle dot, dashes, U+2065 (unassigned), NBSP and the clipboard glyph are NOT');
  assert(URL_SRC === '(https?://|www' + BS + '.)', `[1d] the link pattern is chat-ui's two openers: ${URL_SRC}`);
  assert(CAP_NAME === 40 && CAP.label === 60 && CAP.espn === 20 && CAP.round === 40 && CAP.out === 60, `[1e] caps: name ${CAP_NAME}, label ${CAP.label}, ESPN ${CAP.espn}, round ${CAP.round}, result ${CAP.out}`);
  assert(WORDS.isIn === ' is in for ' && WORDS.everyone === " · everyone's in" && WORDS.sep === ' · ' && WORDS.of === ' of ' && WORDS.waiting === ' · still waiting on ' && WORDS.and === ' and ' && WORDS.comma === ', ' && WORDS.others === ' others' && WORDS.fallback === 'A player',
    '[1f] the literal words are the DI\'s: " is in for ", " · {n} of {total} · still waiting on ", " and ", ", ", " others", "everyone\'s in", "A player"');
  const chat = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  const urlRe = pull(chat, /const URL_RE = \/(.+)\/gi;/, 'chat-ui URL_RE')[1];
  assert(urlRe.startsWith('(https?') && urlRe.includes('www'), `[1g] chat-ui's URL_RE is what the neutralizer is measured against: /${urlRe}/gi`);
}

// ── the models, built ONLY from the derived constants ───────────────────────────────────────────────────
const btrim = (s) => s.replace(/^ +/, '').replace(/ +$/, '');                       // postgres btrim: spaces only
const left = (s, n) => Array.from(s).slice(0, n).join('');                          // postgres left(): characters, not UTF-16 units
const clean = (s, cap) => left(btrim(String(s == null ? '' : s).replace(CNTRL, ' ').replace(BIDI, '')), cap);
const pickName = (display, initials) => {
  const cn = clean(display, CAP_NAME), ci = clean(initials, CAP_NAME);
  if (cn !== '' && !URLRE.test(cn)) return cn;
  if (ci !== '' && !URLRE.test(ci)) return ci;
  return WORDS.fallback;
};
const CLIP = String.fromCodePoint(0x1F4CB);
const weekLabelPlain = (label, number, espn, round) => {
  const vLabel = clean(label, CAP.label), vEspn = clean(espn, CAP.espn), vRound = clean(round, CAP.round);
  const rawLabel = label == null ? '' : String(label);
  let out;
  if (Array.from(rawLabel)[0] === CLIP || rawLabel.startsWith('Historical')) out = vLabel;
  else out = 'Week ' + (vEspn !== '' ? vEspn : (number == null ? '' : String(number))) + (vRound !== '' ? ', ' + vRound : '');
  if (out === '' || URLRE.test(out)) out = 'Week ' + (number == null ? '' : String(number));
  return left(out, CAP.out);
};
/** The body formula, exactly as the SQL concatenates it: missing = names in roster order. */
const composeBody = ({ name, label, inCount, total, missing }) => {
  const n = missing.length;
  if (n === 0) return name + WORDS.isIn + label + WORDS.everyone;
  const waiting = n === 1 ? missing[0]
    : n === 2 ? missing[0] + WORDS.and + missing[1]
    : n === 3 ? missing[0] + WORDS.comma + missing[1] + WORDS.and + missing[2]
    : missing[0] + WORDS.comma + missing[1] + WORDS.and + String(n - 2) + WORDS.others;
  return name + WORDS.isIn + label + WORDS.sep + String(inCount) + WORDS.of + String(total) + WORDS.waiting + waiting;
};

console.log('\n[2] week_label_plain — PARITY with the real composeWeekNamePart…');
{
  const dm = await import('./js/data-model.js');
  const wk = (over) => ({ weekId: 'w1', weekNumber: 6, label: '', roundLabel: '', espnWeekNumber: '', status: 'open', dataSourceMode: 'live', ...over });
  const cases = [
    ['plain', wk({}), ['', 6, '', '']],
    ['ESPN override', wk({ espnWeekNumber: '7' }), ['', 6, '7', '']],
    ['round label', wk({ roundLabel: 'Part 2' }), ['', 6, '', 'Part 2']],
    ['override + round', wk({ espnWeekNumber: '12', roundLabel: 'Quarterfinal' }), ['', 6, '12', 'Quarterfinal']],
    ['blank override is not an override', wk({ espnWeekNumber: '   ' }), ['', 6, '   ', '']],
    ['historical label wins', wk({ label: 'Historical 2025 Week 3' }), ['Historical 2025 Week 3', 6, '', '']],
    ['demo glyph label wins', wk({ label: CLIP + ' Demo Week' }), [CLIP + ' Demo Week', 6, '', '']],
    ['a label that merely contains Historical is composed', wk({ label: 'Not Historical' }), ['Not Historical', 6, '', '']],
    ['week 14', wk({ weekNumber: 14 }), ['', 14, '', '']],
    ['round + ESPN + a long round', wk({ espnWeekNumber: '3', roundLabel: 'Conference Championship Weekend' }), ['', 6, '3', 'Conference Championship Weekend']],
  ];
  for (const [name, week, args] of cases) {
    const js = dm.formatWeekLabelParts(week).name;
    const sql = weekLabelPlain(...args);
    assert(js === sql, `[2] ${name}: formatWeekLabelParts(week).name = "${js}" and the SQL model = "${sql}"`);
  }
  assert(weekLabelPlain('', 6, '', 'Part 2') === 'Week 6, Part 2' && weekLabelPlain('', 6, '7', '') === 'Week 7', '[2] the two canonical forms the DI names: "Week 6, Part 2" and the ESPN override');
  // SC-S3 / SC-S1 on the label
  assert(weekLabelPlain('', 6, '', 'https://evil.example/x') === 'Week 6', '[2] a round label that is a link falls back to "Week 6" — it never reaches the room');
  assert(weekLabelPlain('', 6, 'www.evil.example', '') === 'Week 6', '[2] …and so does an ESPN override that is a link');
  assert(weekLabelPlain('Historical http://x.y', 6, '', '') === 'Week 6', '[2] …and a historical label that contains a link');
  const hostileRound = 'Pa' + String.fromCharCode(0x202E) + 'rt' + String.fromCharCode(0x200B) + ' 2';
  assert(weekLabelPlain('', 6, '', hostileRound) === 'Week 6, Part 2', '[2] bidi and zero-width characters are stripped from a round label ("Week 6, Part 2")');
  assert(weekLabelPlain('Historical ' + 'x'.repeat(200), 6, '', '').length === CAP.out && weekLabelPlain('', 6, '', 'x'.repeat(200)).length === 'Week 6, '.length + CAP.round, `[2] a historical label is capped at ${CAP.out} characters, and a round label at ${CAP.round}`);
  assert(weekLabelPlain(null, null, null, null) === 'Week ' && weekLabelPlain(undefined, 3, undefined, undefined) === 'Week 3', '[2] NULLs are tolerated (the columns are NOT NULL, but the function is IMMUTABLE and total)');
}

console.log('\n[3] NAMES — the neutralizer measured against chat-ui\'s REAL URL_RE (SC-S1) and the bidi list (SC-S3)…');
{
  const chat = await readFile(new URL('./js/chat-ui.js', import.meta.url), 'utf8');
  const URL_RE = new RegExp(pull(chat, /const URL_RE = \/(.+)\/gi;/, 'URL_RE')[1], 'gi');
  const hasLink = (s) => { URL_RE.lastIndex = 0; return URL_RE.test(s); };
  const hasHidden = (s) => { BIDI.lastIndex = 0; CNTRL.lastIndex = 0; return BIDI.test(s) || CNTRL.test(s); };
  const ZW = String.fromCharCode(0x200B), RLO = String.fromCharCode(0x202E), BOM = String.fromCharCode(0xFEFF), LRI = String.fromCharCode(0x2066);
  assert(pickName('Kevin', 'KV') === 'Kevin' && pickName('  Kevin  ', 'KV') === 'Kevin', '[3a] an ordinary name is kept, trimmed');
  assert(pickName('https://evil.example/a.png', 'EV') === 'EV', '[3b] SC-S1: a name that is a link is replaced by the member\'s initials');
  assert(pickName('www.evil.example', '') === WORDS.fallback && pickName('HTTP://X.Y', '  ') === WORDS.fallback, '[3c] …and by "A player" when the initials are empty (case-insensitively)');
  assert(pickName('check out https://x.y now', 'CK') === 'CK' && pickName('go to www.x.y', 'GO') === 'GO', '[3d] a link ANYWHERE in the name triggers it, not just at the start');
  assert(pickName('https://evil.example/a.png', 'https://also.evil') === WORDS.fallback, '[3e] initials that are themselves a link fall through to "A player"');
  assert(pickName('Ka' + RLO + 'i' + ZW + 'n', 'KN') === 'Kain', '[3f] SC-S3: the right-to-left override and the zero-width space are REMOVED, not replaced');
  assert(pickName('A\nB\tC', 'X') === 'A B C', '[3g] control characters become a single space each');
  assert(pickName(BOM + LRI + '  ', 'ZZ') === 'ZZ', '[3h] a name that is nothing but invisible characters is empty, so the initials are used');
  assert(pickName('x'.repeat(100), 'XX') === 'x'.repeat(CAP_NAME), `[3i] a name is capped at ${CAP_NAME} characters`);
  assert(Array.from(pickName('é'.repeat(1) + String.fromCodePoint(0x1F600).repeat(60), 'X')).length === CAP_NAME, '[3j] the cap counts CHARACTERS (an emoji is one), as postgres left() does');
  assert(pickName(null, null) === WORDS.fallback && pickName(undefined, 'ab') === 'ab', '[3k] NULL names fall back to initials, then "A player"');
  // a fuzz: random strings built from the dangerous fragments — never a link, never a hidden character in the result
  const FRAGS = ['http://', 'https://', 'HTTPS://', 'www.', 'WWW.', 'x', 'Kevin', '.', '/', ' ', '@', 'ab', ZW, RLO, BOM, LRI, '\n', '\t', 'h', 'ttp', ':', '//'];
  let seed = 20261001;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let bad = 0, linkInInput = 0, n = 0;
  for (let i = 0; i < 4000; i++) {
    const mk = () => Array.from({ length: 1 + Math.floor(rnd() * 6) }, () => FRAGS[Math.floor(rnd() * FRAGS.length)]).join('');
    const d = mk(), ini = mk();
    const out = pickName(d, ini);
    n++;
    if (hasLink(d)) linkInInput++;
    if (hasLink(out) || hasHidden(out) || out === '' || Array.from(out).length > CAP_NAME) bad++;
  }
  assert(n === 4000 && linkInInput > 200 && bad === 0, `[3l] FUZZ: 4000 hostile name/initials pairs (${linkInInput} with a link in the display name) — NOT ONE result matches chat-ui's URL_RE, carries a bidi / control character, is empty or exceeds ${CAP_NAME}`);
  // the SAME property for the whole line: names, label and the fixed words, joined
  let badLines = 0;
  for (let i = 0; i < 2000; i++) {
    const mk = () => Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => FRAGS[Math.floor(rnd() * FRAGS.length)]).join('');
    const missing = Array.from({ length: Math.floor(rnd() * 7) }, () => pickName(mk(), mk()));
    const body = composeBody({ name: pickName(mk(), mk()), label: weekLabelPlain(mk(), 6, mk(), mk()), inCount: 1, total: 1 + missing.length, missing });
    if (hasLink(body) || hasHidden(body) || body.length >= 1000) badLines++;
  }
  assert(badLines === 0, '[3m] FUZZ: 2000 whole composed lines (hostile poster, label and up to six hostile missing names) — none contains a linkifiable string, a hidden character, or reaches the 1000-character column cap');
}

console.log('\n[4] THE BODY — the DI\'s own example, every form, the cap…');
{
  const L = 'Week 6';
  assert(composeBody({ name: 'Kevin', label: L, inCount: 4, total: 6, missing: ['Jacob', 'Koby'] }) === 'Kevin is in for Week 6 · 4 of 6 · still waiting on Jacob and Koby',
    '[4a] Amendment 1\'s example VERBATIM: "Kevin is in for Week 6 · 4 of 6 · still waiting on Jacob and Koby"');
  assert(composeBody({ name: 'Kihoon', label: L, inCount: 6, total: 6, missing: [] }) === "Kihoon is in for Week 6 · everyone's in", '[4b] the last member in: "Kihoon is in for Week 6 · everyone\'s in" (one line, no count, no "waiting")');
  assert(composeBody({ name: 'A', label: L, inCount: 5, total: 6, missing: ['Z'] }) === 'A is in for Week 6 · 5 of 6 · still waiting on Z', '[4c] ONE missing: "still waiting on Z"');
  assert(composeBody({ name: 'A', label: L, inCount: 3, total: 6, missing: ['X', 'Y', 'Z'] }) === 'A is in for Week 6 · 3 of 6 · still waiting on X, Y and Z', '[4d] THREE missing: "X, Y and Z" (all named)');
  assert(composeBody({ name: 'A', label: L, inCount: 2, total: 6, missing: ['W', 'X', 'Y', 'Z'] }) === 'A is in for Week 6 · 2 of 6 · still waiting on W, X and 2 others', '[4e] FOUR missing: the first two and "and 2 others" (N = missing - 2)');
  assert(composeBody({ name: 'A', label: L, inCount: 1, total: 6, missing: ['V', 'W', 'X', 'Y', 'Z'] }) === 'A is in for Week 6 · 1 of 6 · still waiting on V, W and 3 others', '[4f] FIVE missing: "V, W and 3 others"');
  for (let k = 4; k <= 12; k++) assert(/ and \d+ others$/.test(composeBody({ name: 'A', label: L, inCount: 1, total: k + 1, missing: Array.from({ length: k }, (_, i) => 'n' + i) })) && !/ and 1 others$/.test(composeBody({ name: 'A', label: L, inCount: 1, total: k + 1, missing: Array.from({ length: k }, (_, i) => 'n' + i) })),
    `[4g] ${k} missing: "others" is always plural (never "1 others")`);
  const worst = composeBody({ name: 'n'.repeat(CAP_NAME), label: 'l'.repeat(CAP.out), inCount: 1, total: 99, missing: ['m'.repeat(CAP_NAME), 'm'.repeat(CAP_NAME), 'm'.repeat(CAP_NAME)] });
  assert(worst.length < 400 && worst.length <= 1000, `[4h] the WORST case (a 40-char poster, a 60-char label, three 40-char missing names) is ${worst.length} characters — far inside messages.body's 1000-character check`);
  assert(WORDS.sep === ' · ' && !/\bhttps?\b/i.test(Object.values(WORDS).join('')), '[4i] the fixed words contain no link and use the middle dot the mockup shows');
  // the blind rule at the string level: nothing in the SQL's composition names a pick
  assert(!/selected_team|selected_at|\.result|team/i.test(ANN.slice(ANN.indexOf('v_body :='), ANN.indexOf('insert into public.messages'))), '[4j] the composition code names no pick column and no team: names and two integers only');
}

console.log('\n[5] THE ROW CAN NEVER REACH A PUSH OR A BADGE (DI-505)…');
{
  const jr = await import('./supabase/functions/_shared/job-rules.mjs');
  const insertTuple = ANN.slice(ANN.indexOf("values (NEW.league_id, 'sys_in_'"), ANN.indexOf('on conflict'));
  const type = pull(insertTuple, /\|\| gen_random_uuid\(\)::text, '([a-z]+)'/, 'type')[1];
  const notify = pull(insertTuple, /v_body, '', '', (true|false),/, 'notify')[1] === 'true';
  const row = { type, notify, author: 'system', meta: { kind: 'picksIn', weekId: 'w6', memberId: 'p3', inCount: 4, total: 6 } };
  assert(type === 'system' && notify === false, `[5a] derived FROM THE SQL: the inserted row's type is "${type}" and notify is ${notify}`);
  assert(jr.shouldFanout(row) === false, '[5b] notify-fanout\'s REAL shouldFanout() refuses the row (type must be "message" AND notify true) — no push, ever');
  assert(jr.shouldFanout({ ...row, type: 'message', notify: true }) === true, '[5c] positive control: the same shape as a notifying message WOULD fan out (so [5b] is not passing over a dead predicate)');
  const chat = await import('./js/chat.js');
  chat._resetForTest();
  chat.ingest([{ id: 'sys_in_00000000-0000-4000-8000-000000000001', seq: 1, ts: Date.now(), type: 'system', author: 'system', body: composeBody({ name: 'Kevin', label: 'Week 6', inCount: 1, total: 6, missing: ['A'] }), notify: false, meta: row.meta }], 1, { caughtUp: true });
  assert(chat.unreadCount('p9') === 0, '[5d] the real chat fold does not count the line toward the Chat badge (system rows are never unread)');
  chat.ingest([{ id: 'm_plain_1', seq: 2, ts: Date.now(), type: 'message', author: 'p4', body: 'hello', notify: true, meta: null }], 2, { caughtUp: true });
  assert(chat.unreadCount('p9') === 1, '[5e] positive control: an ordinary notifying message from someone else IS counted (so [5d] is not a dead counter)');
  chat._resetForTest();
}

console.log('\n[6] THE SQL TEXT, ONCE MORE — the properties the models above are only valid for…');
{
  assert(!ANN.includes('selected_team'), '[6a] announce_member_in never names the selection column (the blind rule)');
  assert(/exception when others then raise warning 'announce_member_in: sqlstate %', sqlstate; end; return NEW;/.test(ANN) && /set lock_timeout = '2s'/.test(norm(block('announce_member_in'))), '[6b] a chat fault is swallowed (SQLSTATE only) and lock_timeout is pinned: a pick write can never fail because of the line');
  assert((ANN.match(/\(m\.meta ->> 'kind'\) = 'picksIn'/g) || []).length === 2 && ANN.indexOf('pg_advisory_xact_lock(') < ANN.lastIndexOf("(m.meta ->> 'kind') = 'picksIn'"), '[6c] the once-only probe runs before AND after the advisory lock');
  assert(/array_agg\(c\.nm order by c\.id\) filter \(where c\.n < v_games\)/.test(ANN) && /where m\.league_id = NEW\.league_id and m\.active \) c;/.test(ANN), '[6d] the missing list is active members only, league-fenced, in roster order (league_members.id ascending)');
  assert(LAB.includes("left(coalesce(p_label, ''), 1) = chr(128203)") && LAB.includes("like 'Historical%'"), '[6e] the demo / historical label rule tests the RAW label, as composeWeekNamePart does');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail === 0 ? 0 : 1)));
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
