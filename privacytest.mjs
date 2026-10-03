#!/usr/bin/env node
/**
 * privacytest.mjs — THE PUBLISHED PRIVACY PAGE IS THE APPROVED TEXT, WORD FOR WORD.
 * =================================================================================
 * Drew approved RD-01 v3.0.0 on 2026-10-01, in his own words: "privacy policy approved" (asked: "please approve RD-01 v3.0.0-draft.2, the version that adds ESPN news.
 * News can't ship without it."; same message: "ok for just espn news sources"). The approved file is byte-identical to v3.0.0-draft.2, so what Drew read is what is
 * pinned. Release v0.29.0 publishes it (docs/regulatory/PUBLISH_SPEC_RD-01_v3.0.0.md): `privacy.html`'s BODY is that text, rendered in the page's existing HTML
 * structure and styles, with the ONE allowed difference below, and nothing else on the page moves — not the <head>, the CSS, the theme or the meta tags. A privacy
 * policy is a statement the operator is answerable for, so the words must not drift: not by a "fix", a reorder, a dropped sentence or a helpful rewording, today or
 * in any later edit. (It replaces the v2.0.0-draft.3 pin of 2026-09-30, which Drew approved in the words "Approve RD-01 v2.0.0-draft.3".)
 *
 * WHAT IS PINNED, AND AGAINST WHAT.
 *   GOLDEN   supabase/tests/fixtures/RD-01_APPROVED_v3.0.0.md is a BYTE-IDENTICAL copy of the approved document (sha256 5857e9cf…ff91, 13,331 bytes, verified
 *            here), so nobody can edit the golden to match an edited page. Its YAML front matter is not published (and still reads `version: 3.0.0-draft.2`:
 *            the approved file must equal what Drew read); the page body is everything from the `# Privacy` line to the end. The copy lives under supabase/,
 *            which deploy.sh excludes from the public site; the register's own copy is docs/regulatory/RD-01_privacy-policy/v3.0.0.md.
 *   DATE     The body's date line holds the placeholder `[publication date]`, exactly once. The publishable text is the body with that ONE token replaced by D,
 *            the date of the web deploy that publishes it (here 2026-10-02). That substitution is the only difference allowed between the approved body and
 *            the page; a deploy that slips restamps D in the page and this test together, in one commit.
 *   EQUALITY The visible text of privacy.html (scripts and styles removed, tags removed, HTML entities decoded, whitespace collapsed) EQUALS the publishable body with
 *            its Markdown stripped (heading marks, bullet marks, **bold**, [text](url) -> text, whitespace collapsed). Word for word, in order. Whitespace and
 *            entity SPELLING are not words (&#39; is an apostrophe); nothing else is forgiven.
 *   STRUCTURE The headings, the bullets and the bold lead-ins map one to one onto h1/h2, ul/li and <strong>, in order, and no Markdown is left in the HTML; the
 *            mailto link and the "Back to the app" link keep their existing form.
 *   HEAD     Everything from <!doctype through <body> is byte-identical to before this step (sha256 pinned): same title, CSS, theme, meta.
 *   TEETH    The same comparison is run, in memory, against a one-word change, a swapped pair of paragraphs, a dropped sentence, a reworded heading, an added
 *            sentence, the golden with the placeholder LEFT IN, a WRONG date, and the page with "Headlines are never relayed." dropped — each must be UNEQUAL —
 *            and against a whitespace/entity-only change, which must still be EQUAL. A comparison that could not fail would pin nothing. (The file-level mutation
 *            is recorded in the commit that re-pinned this suite.)
 *
 * Run: node privacytest.mjs   (plain Node, no dependencies; spawned by loadtest.mjs)
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
function assert(cond, label, detail) {
  if (cond) { pass += 1; console.log(`  ✅ ${label}`); }
  else { fail += 1; console.log(`  ❌ ${label}${detail ? ' — ' + detail : ''}`); }
}
const sha = (s) => createHash('sha256').update(s).digest('hex');

const GOLDEN_PATH = join(HERE, 'supabase', 'tests', 'fixtures', 'RD-01_APPROVED_v3.0.0.md');
const GOLDEN_SHA256 = '5857e9cf1e2f6cce136cba15ae5143d6f02a6c9c905af3c856b7a41730d7ff91';
const GOLDEN_BYTES = 13331;
// D — the date of the v0.29.0 web deploy that publishes the page (PUBLISH_SPEC_RD-01_v3.0.0 §2). The ONE token the page may differ from the approved body by.
const PUBLICATION_DATE = '2026-10-02';
const PLACEHOLDER = '[publication date]';
// privacy.html from `<!doctype html>` through the `<body>` line, as it stood before this step (and therefore as it must stay).
const HEAD_SHA256 = 'df85611ac1941a8a1fe771f54b9f5d4462430a8c28af428e274c99c811a37245';
const DATE_LINE = `<p class="muted">Munera (irbfootball.com and the Munera iPhone app) · last updated ${PUBLICATION_DATE}</p>`;

// ── the two normalisers ────────────────────────────────────────────────────────────────────────────────────
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rarr: '→', larr: '←', middot: '·', mdash: '—', ndash: '–', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”' };
const decodeEntities = (s) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&([a-z]+);/gi, (m, n) => (Object.prototype.hasOwnProperty.call(NAMED, n.toLowerCase()) ? NAMED[n.toLowerCase()] : m));
const collapse = (s) => s.replace(/\s+/g, ' ').trim();

/** The approved body: everything from the `# Privacy` line to the end of the document (the YAML front matter is not published). */
const bodyOfMarkdown = (md) => {
  const i = md.indexOf('\n# Privacy\n');
  return i === -1 ? null : md.slice(i + 1);
};
/** Markdown -> the words a reader sees, in order. */
const markdownText = (md) => collapse(md.split('\n')
  .map((l) => l.replace(/^#{1,6}\s+/, '').replace(/^\s*[-*]\s+/, ''))
  .join(' ')
  .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\*\*/g, ''));
/** HTML -> the words a reader sees, in order: body only, scripts/styles/comments dropped, block tags are word boundaries, inline tags are not. */
const htmlText = (html) => {
  const m = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (!m) return null;
  const noCode = m[1].replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  const spaced = noCode.replace(/<\/?(?:h[1-6]|p|ul|ol|li|div|br|section|header|footer|main|article|table|tr|td|th)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '');
  return collapse(decodeEntities(spaced));
};
/** Where two word streams first differ, for a message a human can act on. */
const firstDiff = (a, b) => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  if (i === a.length && i === b.length) return null;
  return `first difference at character ${i}: page …${JSON.stringify(a.slice(Math.max(0, i - 30), i + 50))} vs approved …${JSON.stringify(b.slice(Math.max(0, i - 30), i + 50))}`;
};

console.log('=== privacytest.mjs ===\n');

// ── [1] the golden is the approved document, untouched ─────────────────────────────────────────────────────
console.log('[1] The golden is the approved RD-01 v3.0.0, byte for byte, and the date rule holds…');
const goldenRaw = readFileSync(GOLDEN_PATH, 'utf8');
assert(sha(readFileSync(GOLDEN_PATH)) === GOLDEN_SHA256 && readFileSync(GOLDEN_PATH).length === GOLDEN_BYTES,
  `the fixture's sha256 is ${GOLDEN_SHA256.slice(0, 8)}…${GOLDEN_SHA256.slice(-4)} and it is ${GOLDEN_BYTES} bytes, the hash of the document Drew approved (2026-10-01)`);
assert(/^---\nrd: RD-01\n/.test(goldenRaw) && /\nversion: 3\.0\.0-draft\.2\n/.test(goldenRaw), 'it is RD-01 with front matter `version: 3.0.0-draft.2` (the approved bytes are never edited; the front matter is not published)');
const goldenBody = bodyOfMarkdown(goldenRaw);
assert(goldenBody !== null && goldenBody.startsWith('# Privacy\n') && goldenBody.trim().endsWith('[← Back to the app](index.html)'),
  'the publishable body runs from `# Privacy` to the "Back to the app" link, and the YAML front matter is excluded from it');
// The date rule: the placeholder appears ONCE in the BODY (the front matter mentions it too, so the count is body-only), on the date line.
const placeholderCount = goldenBody ? goldenBody.split(PLACEHOLDER).length - 1 : -1;
assert(placeholderCount === 1 && goldenBody.split('\n').filter((l) => l.includes(PLACEHOLDER)).join('') === `Munera (irbfootball.com and the Munera iPhone app) · last updated ${PLACEHOLDER}`,
  `the approved body holds the placeholder "${PLACEHOLDER}" exactly once, on the date line (found ${placeholderCount})`);
// The publishable body = the approved body with that ONE token replaced by D — the only difference allowed.
const publishableBody = goldenBody ? goldenBody.replace(PLACEHOLDER, PUBLICATION_DATE) : null;
assert(publishableBody !== null && !publishableBody.includes(PLACEHOLDER) && publishableBody.length === goldenBody.length - PLACEHOLDER.length + PUBLICATION_DATE.length,
  `the publishable body is the approved body with that one token replaced by ${PUBLICATION_DATE} — and nothing else changed (length ${goldenBody ? goldenBody.length : '?'} -> ${publishableBody ? publishableBody.length : '?'})`);
const approvedText = publishableBody ? markdownText(publishableBody) : '';
assert(approvedText.length > 6000 && approvedText.startsWith(`Privacy Munera (irbfootball.com and the Munera iPhone app) · last updated ${PUBLICATION_DATE} `),
  `the approved text is non-trivial and opens with the title line and ${PUBLICATION_DATE} (${approvedText.length} characters, sha256 ${sha(approvedText).slice(0, 12)}…)`);
assert(/Headlines are never relayed\./.test(approvedText) && /News preferences/.test(approvedText) && /Turning News off stops the headline requests\./.test(approvedText),
  'the approved text carries v3.0.0\'s News sentences (R-C26: News A and v3.0.0 ship together)');

// ── [2] the page ───────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[2] privacy.html says exactly that…');
const page = readFileSync(join(HERE, 'privacy.html'), 'utf8');
const pageText = htmlText(page);
assert(pageText !== null, 'privacy.html has a <body>');
const diff = pageText === null ? 'no body' : firstDiff(pageText, approvedText);
assert(pageText === approvedText, 'THE VISIBLE TEXT OF privacy.html EQUALS THE APPROVED TEXT, word for word and in order (whitespace and entity spelling aside)', diff || '');

const bodyStart = page.indexOf('<body>');
const head = bodyStart === -1 ? '' : page.slice(0, bodyStart + '<body>\n'.length);
assert(sha(head) === HEAD_SHA256,
  `everything from <!doctype through <body> is byte-identical to before this step — the same title, CSS, theme and meta tags (sha256 ${HEAD_SHA256.slice(0, 8)}…)`);
assert(page.includes(DATE_LINE) && page.split('last updated').length === 2 && !page.includes(PLACEHOLDER), `the date line reads "Munera (irbfootball.com and the Munera iPhone app) · last updated ${PUBLICATION_DATE}", once, in the page\'s own muted-paragraph form, with no placeholder left`);

// ── [3] structure: Markdown mapped onto the page's existing elements ────────────────────────────────────────
console.log('\n[3] The Markdown maps onto the page\'s existing HTML structure, one to one…');
const mdH1 = [...goldenBody.matchAll(/^# (.+)$/gm)].map((m) => m[1]);
const mdH2 = [...goldenBody.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
const mdBullets = [...goldenBody.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
const mdBold = [...goldenBody.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]);
const htmlTagTexts = (tag) => [...page.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'gi'))].map((m) => collapse(decodeEntities(m[1].replace(/<[^>]+>/g, ''))));
assert(JSON.stringify(htmlTagTexts('h1')) === JSON.stringify(mdH1) && mdH1.length === 1, `one <h1>, "${mdH1[0]}", as in the approved text`);
assert(JSON.stringify(htmlTagTexts('h2')) === JSON.stringify(mdH2) && mdH2.length === 10,
  `the ${mdH2.length} <h2> section headings equal the approved headings, in order (${mdH2.join(' | ')})`);
assert(htmlTagTexts('li').length === mdBullets.length && mdBullets.length === 29,
  `${mdBullets.length} bullets in the approved text are ${htmlTagTexts('li').length} <li> elements on the page`);
assert(JSON.stringify(htmlTagTexts('strong')) === JSON.stringify(mdBold) && mdBold.length === 22,
  `the ${mdBold.length} bold lead-ins are the ${htmlTagTexts('strong').length} <strong> elements, the same words in the same order`);
assert(!/\*\*/.test(page) && !/\]\(/.test(page) && !/^#{1,6} /m.test(page) && !/^\s*- /m.test(page), 'no Markdown syntax is left in the HTML');
assert(page.includes('<a href="mailto:hendricksdrew1@gmail.com">hendricksdrew1@gmail.com</a>'), 'the contact address keeps the mailto link form');
assert(page.includes('<p class="muted"><a href="index.html">← Back to the app</a></p>'), 'the "Back to the app" link keeps its existing form, muted paragraph and all');
assert(/<ul>[\s\S]*?<\/ul>/.test(page) && htmlTagTexts('li').length === (page.match(/<li>/g) || []).length
  && (page.match(/<ul>/g) || []).length === (page.match(/<\/ul>/g) || []).length && (page.match(/<ul>/g) || []).length === 5 + 1,
  'every <li> sits in a <ul> (six lists: collect, who can see, who helps, how long, choices, delete)');
assert(!/<script\b/i.test(page) && (page.match(/<style>/g) || []).length === 1, 'the page has no script and still exactly one style block — nothing was added around the text');

// ── [4] TEETH: the comparison can fail ─────────────────────────────────────────────────────────────────────
console.log('\n[4] The comparison has teeth: it goes UNEQUAL on any change of words, and stays equal on spelling-only changes…');
const equalsApproved = (html) => htmlText(html) === approvedText;
assert(equalsApproved(page), 'control: the real page is equal');
const oneWord = page.replace('Leagues are private', 'Leagues are public');
assert(oneWord !== page && !equalsApproved(oneWord), 'MUTATION: one word changed ("private" -> "public") is UNEQUAL');
const droppedSentence = page.replace(' We never see your Google password.', '');
assert(droppedSentence !== page && !equalsApproved(droppedSentence), 'MUTATION: one sentence dropped is UNEQUAL');
{
  const lis = page.match(/<li>[\s\S]*?<\/li>/g);
  const swapped = page.replace(lis[0], '\u0000A').replace(lis[1], '\u0000B').replace('\u0000A', lis[1]).replace('\u0000B', lis[0]);
  assert(swapped !== page && !equalsApproved(swapped), 'MUTATION: two bullets swapped (same words, different order) is UNEQUAL');
}
const reworded = page.replace('<h2>Who can see it</h2>', '<h2>Who sees it</h2>');
assert(reworded !== page && !equalsApproved(reworded) && JSON.stringify([...reworded.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1])) !== JSON.stringify(mdH2),
  'MUTATION: a reworded heading is UNEQUAL, and the heading-list check sees it too');
const extraSentence = page.replace('</p>\n\n  <h2>What we collect', ' It is very secure.</p>\n\n  <h2>What we collect');
assert(extraSentence !== page && !equalsApproved(extraSentence), 'MUTATION: one sentence ADDED is UNEQUAL (a policy may not grow words nobody approved)');
const respelled = page.replace(/\n {2}/g, '\n\n      ').replace(/'/g, '&#39;').replace(/ · /g, ' &middot; ').replace('→', '&rarr;').replace(/"Do Not Track"/, '&quot;Do Not Track&quot;');
assert(respelled !== page && equalsApproved(respelled), 'control: changing only WHITESPACE and ENTITY SPELLING (&#39;, &middot;, &rarr;, &quot;, extra blank lines) stays EQUAL — the normaliser forgives spelling, never words');
// v3.0.0's three new teeth (PUBLISH_SPEC_RD-01_v3.0.0 §4): the placeholder left in, a wrong date, and the News sentence dropped.
const equalsGoldenWith = (token) => htmlText(page) === markdownText(goldenBody.replace(PLACEHOLDER, token));
assert(equalsGoldenWith(PUBLICATION_DATE), 'control: the real page equals the approved body with the placeholder replaced by the publication date');
assert(!equalsGoldenWith(PLACEHOLDER), 'MUTATION: the golden with the placeholder LEFT IN is UNEQUAL to the page (a page that shipped "[publication date]" would be caught the other way round too)');
assert(!equalsGoldenWith('2026-10-01') && !equalsGoldenWith('2026-09-30'), 'MUTATION: a WRONG date (2026-10-01, or v2.0.0\'s 2026-09-30) is UNEQUAL');
const placeholderPage = page.replace(`last updated ${PUBLICATION_DATE}`, `last updated ${PLACEHOLDER}`);
assert(placeholderPage !== page && !equalsApproved(placeholderPage), 'MUTATION: the page itself carrying "[publication date]" is UNEQUAL');
const noRelay = page.replace(' Headlines are never relayed.', '');
assert(noRelay !== page && !equalsApproved(noRelay), 'MUTATION: "Headlines are never relayed." dropped from the page is UNEQUAL (the S-C11 promise cannot be quietly removed)');
const noNewsOff = page.replace(' Turning News off stops the headline requests.', '');
assert(noNewsOff !== page && !equalsApproved(noNewsOff), 'MUTATION: "Turning News off stops the headline requests." dropped is UNEQUAL (the S-C8 promise)');

console.log(`\n[privacytest] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
