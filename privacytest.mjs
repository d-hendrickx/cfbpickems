#!/usr/bin/env node
/**
 * privacytest.mjs — THE PUBLISHED PRIVACY PAGE IS THE APPROVED TEXT, WORD FOR WORD.
 * =================================================================================
 * Drew approved RD-01 v4.0.0-draft.1 on 2026-10-15, in his own words: "Approve RD-01 v4.0.0-draft.1" (M-57, D-90). The approved file is byte-identical to the draft, so what
 * Drew read is what is pinned. Release v0.30.0 publishes it on the deploy day (2026-10-15, D-87): `privacy.html`'s BODY is that text, rendered in the page's existing HTML
 * structure and styles, and nothing else on the page moves — not the <head>, the CSS, the theme or the meta tags. A privacy policy is a statement the operator is answerable
 * for, so the words must not drift: not by a "fix", a reorder, a dropped sentence or a helpful rewording, today or in any later edit. (It replaces the v3.0.0 pin of 2026-10-02,
 * which Drew approved in the words "privacy policy approved"; v3.0.0's fixture RD-01_APPROVED_v3.0.0.md stays beside this one as the record of what was live before.)
 *
 * WHAT IS PINNED, AND AGAINST WHAT.
 *   GOLDEN   supabase/tests/fixtures/RD-01_APPROVED_v4.0.0.md is a BYTE-IDENTICAL copy of the approved document (sha256 2198d6e6…b199, 14,861 bytes, verified here, and cmp-equal to
 *            docs/regulatory/RD-01_privacy-policy/v4.0.0-draft.1.md on main), so nobody can edit the golden to match an edited page. Its YAML front matter is not published (and
 *            still reads `version: 4.0.0-draft.1`: the approved file must equal what Drew read); the page body is everything from the `# Privacy` line to the end. The copy
 *            lives under supabase/, which deploy.sh excludes from the public site.
 *   DATE     v4.0.0 carries NO placeholder: its date line already reads 2026-10-15, the date of the web deploy (a deploy that slips leaves the line as written, the v2.0.0
 *            precedent; changing it is a new draft). So the page's body equals the approved body with NOTHING substituted, and the old "[publication date]" token must be
 *            absent from both the golden's body and the page.
 *   EQUALITY The visible text of privacy.html (scripts and styles removed, tags removed, HTML entities decoded, whitespace collapsed) EQUALS the approved body with its
 *            Markdown stripped (heading marks, bullet marks, **bold**, [text](url) -> text, whitespace collapsed). Word for word, in order. Whitespace and entity SPELLING are
 *            not words (&#39; is an apostrophe); nothing else is forgiven.
 *   STRUCTURE The headings, the bullets and the bold lead-ins map one to one onto h1/h2, ul/li and <strong>, in order, and no Markdown is left in the HTML; the mailto link
 *            and the "Back to the app" link keep their existing form.
 *   HEAD     Everything from <!doctype through <body> is byte-identical to before this step (sha256 pinned): same title, CSS, theme, meta.
 *   V4 TEXT  The sentences v4.0.0 adds are asserted by name (the R-13 SCRIBE paragraph, the Sports publishers bullet with "Fox News" and "14 days", the ESPN bullet cut down
 *            to scores and logos), and the clauses it deletes are asserted ABSENT from both the golden and the page.
 *   TEETH    The same comparison is run, in memory, against a one-word change, a swapped pair of paragraphs, a dropped sentence, a reworded heading, an added sentence, the date
 *            LEFT AT 2026-10-02, the old placeholder left in, "Fox News" dropped from the publisher list, the R-13 sentence dropped, and each of v3.0.0's deleted ESPN clauses put
 *            back — each must be UNEQUAL — and against a whitespace/entity-only change, which must still be EQUAL. A comparison that could not fail would pin nothing. (The
 *            file-level mutations are run in a scratch copy and recorded in evidence/final-copy.)
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

const GOLDEN_PATH = join(HERE, 'supabase', 'tests', 'fixtures', 'RD-01_APPROVED_v4.0.0.md');
const GOLDEN_SHA256 = '2198d6e665658aa946fb3c459bfdac963e400960e40883fe7a8562627756b199';
const GOLDEN_BYTES = 14861;
// The date the approved text itself carries: the v0.30.0 web deploy day (D-87). v4.0.0 has no placeholder, so the page differs from the approved body by NOTHING.
const PUBLICATION_DATE = '2026-10-15';
// v3.0.0's date-placeholder token. v4.0.0 does not use it; it must appear in neither the golden's body nor the page.
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
console.log('[1] The golden is the approved RD-01 v4.0.0, byte for byte, and the date rule holds…');
const goldenRaw = readFileSync(GOLDEN_PATH, 'utf8');
assert(sha(readFileSync(GOLDEN_PATH)) === GOLDEN_SHA256 && readFileSync(GOLDEN_PATH).length === GOLDEN_BYTES,
  `the fixture's sha256 is ${GOLDEN_SHA256.slice(0, 8)}…${GOLDEN_SHA256.slice(-4)} and it is ${GOLDEN_BYTES} bytes, the hash of the document Drew approved (2026-10-15)`);
assert(/^---\nrd: RD-01\n/.test(goldenRaw) && /\nversion: 4\.0\.0-draft\.1\n/.test(goldenRaw), 'it is RD-01 with front matter `version: 4.0.0-draft.1` (the approved bytes are never edited; the front matter is not published)');
const goldenBody = bodyOfMarkdown(goldenRaw);
assert(goldenBody !== null && goldenBody.startsWith('# Privacy\n') && goldenBody.trim().endsWith('[← Back to the app](index.html)'),
  'the publishable body runs from `# Privacy` to the "Back to the app" link, and the YAML front matter is excluded from it');
// The date rule: v4.0.0 has NO placeholder. The date line is literal, once, in the BODY (the front matter mentions the old token too, so the count is body-only).
const placeholderCount = goldenBody ? goldenBody.split(PLACEHOLDER).length - 1 : -1;
assert(placeholderCount === 0 && goldenBody.split('\n').filter((l) => l.includes('last updated')).join('') === `Munera (irbfootball.com and the Munera iPhone app) · last updated ${PUBLICATION_DATE}`,
  `the approved body holds no "${PLACEHOLDER}" token (found ${placeholderCount}) and its one date line reads "last updated ${PUBLICATION_DATE}"`);
// The publishable body IS the approved body: nothing is substituted.
const publishableBody = goldenBody;
const approvedText = publishableBody ? markdownText(publishableBody) : '';
assert(approvedText.length > 6000 && approvedText.startsWith(`Privacy Munera (irbfootball.com and the Munera iPhone app) · last updated ${PUBLICATION_DATE} `),
  `the approved text is non-trivial and opens with the title line and ${PUBLICATION_DATE} (${approvedText.length} characters, sha256 ${sha(approvedText).slice(0, 12)}…)`);
// What v4.0.0 adds, by name (the page is compared to the whole text below; these make a failure there readable and pin the intent).
assert(approvedText.includes('SCRIBE also writes short Home cards from public sports information, such as team records and player statistics.')
  && approvedText.includes('When someone asks SCRIBE a current sports question, only that question, without names or league content, is used for the web search.'),
  'the approved text carries the R-13 SCRIBE paragraph (Home cards from public information; only the name-free question goes to the web search)');
assert(approvedText.includes('Sports publishers — When News is on, our servers collect public headline feeds from sports publishers (ESPN, CBS Sports, Yahoo Sports, Sports Illustrated, NBC Sports, NCAA.com and Fox News) and keep each headline, link and picture address for 14 days.')
  && approvedText.includes('Your phone reads the headlines from our servers, not from the publishers.')
  && approvedText.includes('Turning News off stops the headline and picture requests.'),
  'the approved text carries the Sports publishers bullet: all seven publishers including Fox News, the 14-day keep, phone-reads-from-our-servers, and the News-off promise');
assert(approvedText.includes('ESPN provides live scores and team logos through its public scoreboard. Your browser or phone asks ESPN for these directly,')
  && approvedText.includes('News preferences'),
  'the approved ESPN bullet is cut down to scores and logos, and the News preference words in "What we collect" and "Who can see it" are carried');
// v3.0.0's four ESPN clauses are GONE from the approved text (v0.30.0 makes them untrue, or the Sports publishers bullet now says them for every publisher).
assert(!/Headlines are never relayed\./.test(approvedText) && !/sports headlines and their pictures/.test(approvedText) && !/Turning News off stops the headline requests\./.test(approvedText) && !/opens ESPN's website/.test(approvedText),
  'the four v3.0.0 ESPN clauses (headlines and pictures from ESPN, never relayed, News off stops the headline requests, tapping opens ESPN) are absent from the approved text');

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
assert(page.includes(DATE_LINE) && page.split('last updated').length === 2 && !page.includes(PLACEHOLDER) && !page.includes('2026-10-02'), `the date line reads "Munera (irbfootball.com and the Munera iPhone app) · last updated ${PUBLICATION_DATE}", once, in the page\'s own muted-paragraph form, with no placeholder left and v3.0.0\'s 2026-10-02 gone`);

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
assert(htmlTagTexts('li').length === mdBullets.length && mdBullets.length === 30,
  `${mdBullets.length} bullets in the approved text are ${htmlTagTexts('li').length} <li> elements on the page`);
assert(JSON.stringify(htmlTagTexts('strong')) === JSON.stringify(mdBold) && mdBold.length === 23,
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
// The date rule's teeth (v4.0.0 has no placeholder, so the comparison is the approved body with ONLY the date token varied).
const withDate = (token) => markdownText(goldenBody.replace(/last updated \S+/, `last updated ${token}`));
const equalsApprovedWithDate = (token) => htmlText(page) === withDate(token);
assert(equalsApprovedWithDate(PUBLICATION_DATE), 'control: the real page equals the approved body with its own date');
assert(!equalsApprovedWithDate(PLACEHOLDER), 'MUTATION: the approved body with the old placeholder in its date line is UNEQUAL to the page');
assert(!equalsApprovedWithDate('2026-10-02') && !equalsApprovedWithDate('2026-10-01') && !equalsApprovedWithDate('2026-09-30'), 'MUTATION: a WRONG date (v3.0.0\'s 2026-10-02, or 2026-10-01, or v2.0.0\'s 2026-09-30) is UNEQUAL');
const staleDatePage = page.replace(`last updated ${PUBLICATION_DATE}`, 'last updated 2026-10-02');
assert(staleDatePage !== page && !equalsApproved(staleDatePage), 'MUTATION: the page keeping v3.0.0\'s date 2026-10-02 (the date line not bumped) is UNEQUAL');
const placeholderPage = page.replace(`last updated ${PUBLICATION_DATE}`, `last updated ${PLACEHOLDER}`);
assert(placeholderPage !== page && !equalsApproved(placeholderPage), 'MUTATION: the page itself carrying "[publication date]" is UNEQUAL');
// v4.0.0's additions cannot be quietly removed, and v3.0.0's deleted clauses cannot be quietly put back.
const noFox = page.replace(' and Fox News)', ')');
assert(noFox !== page && !equalsApproved(noFox), 'MUTATION: "Fox News" dropped from the publisher list is UNEQUAL (the list names every publisher that is switched on)');
const noR13 = page.replace(' No league messages, picks or member information are sent for those cards.', '');
assert(noR13 !== page && !equalsApproved(noR13), 'MUTATION: the R-13 sentence "No league messages, picks or member information are sent for those cards." dropped is UNEQUAL');
const noR13Para = page.replace(/\n {2}<p>SCRIBE also writes short Home cards[^\n]*<\/p>/, '');
assert(noR13Para !== page && !equalsApproved(noR13Para), 'MUTATION: the whole R-13 SCRIBE paragraph dropped is UNEQUAL');
const noPublishers = page.replace(/\n {4}<li><strong>Sports publishers<\/strong>[^\n]*<\/li>/, '');
assert(noPublishers !== page && !equalsApproved(noPublishers), 'MUTATION: the whole Sports publishers bullet dropped is UNEQUAL');
const no14 = page.replace(' for 14 days', '');
assert(no14 !== page && !equalsApproved(no14), 'MUTATION: the 14-day retention clause dropped from the Sports publishers bullet is UNEQUAL');
const backRelay = page.replace("which likewise sees your IP address and the address requested, and nothing about your account.", "which likewise sees your IP address and the address requested, and nothing about your account. Headlines are never relayed.");
assert(backRelay !== page && !equalsApproved(backRelay), 'MUTATION: v3.0.0\'s deleted "Headlines are never relayed." put back into the ESPN bullet is UNEQUAL (the promise is untrue once the server collects headlines)');
const backNewsOff = page.replace('Our server also fetches scores from ESPN on the league\'s behalf.', 'Our server also fetches scores from ESPN on the league\'s behalf. Turning News off stops the headline requests.');
assert(backNewsOff !== page && !equalsApproved(backNewsOff), 'MUTATION: v3.0.0\'s deleted "Turning News off stops the headline requests." put back is UNEQUAL');
const backHeadlines = page.replace('through its public scoreboard. Your browser', 'through its public scoreboard and, when News is on, sports headlines and their pictures. Your browser');
assert(backHeadlines !== page && !equalsApproved(backHeadlines), 'MUTATION: v3.0.0\'s deleted "and, when News is on, sports headlines and their pictures" put back is UNEQUAL');
const backTap = page.replace('Our server also fetches scores from ESPN on the league\'s behalf.', 'Our server also fetches scores from ESPN on the league\'s behalf. Tapping a headline opens ESPN\'s website (on iPhone, inside the app), under ESPN\'s own privacy policy.');
assert(backTap !== page && !equalsApproved(backTap), 'MUTATION: v3.0.0\'s deleted "Tapping a headline opens ESPN\'s website…" put back is UNEQUAL');

console.log(`\n[privacytest] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
