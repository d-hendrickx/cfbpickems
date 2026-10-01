#!/usr/bin/env node
/**
 * privacytest.mjs — THE PUBLISHED PRIVACY PAGE IS THE APPROVED TEXT, WORD FOR WORD.
 * =================================================================================
 * Drew approved RD-01 v2.0.0-draft.3 on 2026-09-30, in his own words: "Approve RD-01 v2.0.0-draft.3". Coordinator step 5 of round 3b:
 * `privacy.html`'s BODY is replaced with that text, rendered in the page's existing HTML structure and styles, and nothing else on the
 * page moves — not the <head>, the CSS, the theme or the meta tags. A privacy policy is a statement the operator is answerable for, so the
 * words must not drift: not by a "fix", a reorder, a dropped sentence or a helpful rewording, today or in any later edit.
 *
 * WHAT IS PINNED, AND AGAINST WHAT.
 *   GOLDEN   supabase/tests/fixtures/RD-01_PROPOSED_v2.0.0-draft.3_091926_MULTISPORT.md is a BYTE-IDENTICAL copy of the approved document
 *            (sha256 58bc7d5b…3c99, verified here), so nobody can edit the golden to match an edited page. Its YAML front matter is not
 *            published; the page body is everything from the `# Privacy` line to the end. The copy lives under supabase/, which deploy.sh
 *            excludes from the public site; the register's own copy is docs/regulatory/ (design-matrix-pm files it there).
 *   EQUALITY The visible text of privacy.html (scripts and styles removed, tags removed, HTML entities decoded, whitespace collapsed)
 *            EQUALS the golden body with its Markdown stripped (heading marks, bullet marks, **bold**, [text](url) -> text, whitespace
 *            collapsed). Word for word, in order. Whitespace and entity SPELLING are not words (&#39; is an apostrophe); nothing else is forgiven.
 *   STRUCTURE The headings, the bullets and the bold lead-ins map one to one onto h1/h2, ul/li and <strong>, in order, and no Markdown
 *            is left in the HTML; the mailto link and the "Back to the app" link keep their existing form.
 *   HEAD     Everything from <!doctype through <body> is byte-identical to before this step (sha256 pinned): same title, CSS, theme, meta.
 *   TEETH    The same comparison is run, in memory, against a one-word change, a swapped pair of paragraphs, a dropped sentence and a
 *            reworded heading — each must be UNEQUAL — and against a whitespace/entity-only change, which must still be EQUAL. A comparison
 *            that could not fail would pin nothing. (The file-level mutation is recorded in the commit that added this suite.)
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

const GOLDEN_PATH = join(HERE, 'supabase', 'tests', 'fixtures', 'RD-01_PROPOSED_v2.0.0-draft.3_091926_MULTISPORT.md');
const GOLDEN_SHA256 = '58bc7d5b54da40beb0d445e9acc687db6683ba56577f27f19c12ad1b421e3c99';
// privacy.html from `<!doctype html>` through the `<body>` line, as it stood before this step (and therefore as it must stay).
const HEAD_SHA256 = 'df85611ac1941a8a1fe771f54b9f5d4462430a8c28af428e274c99c811a37245';
const DATE_LINE = '<p class="muted">Munera (irbfootball.com and the Munera iPhone app) · last updated 2026-09-30</p>';

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
console.log('[1] The golden is the approved RD-01 v2.0.0-draft.3, byte for byte…');
const goldenRaw = readFileSync(GOLDEN_PATH, 'utf8');
assert(sha(readFileSync(GOLDEN_PATH)) === GOLDEN_SHA256, `the fixture's sha256 is ${GOLDEN_SHA256.slice(0, 8)}…${GOLDEN_SHA256.slice(-4)}, the hash of the document Drew approved (2026-09-30)`);
assert(/^---\nrd: RD-01\n/.test(goldenRaw) && /\nversion: 2\.0\.0-draft\.3\n/.test(goldenRaw), 'it is RD-01, version 2.0.0-draft.3 (front matter, not published)');
const goldenBody = bodyOfMarkdown(goldenRaw);
assert(goldenBody !== null && goldenBody.startsWith('# Privacy\n') && goldenBody.trim().endsWith('[← Back to the app](index.html)'),
  'the publishable body runs from `# Privacy` to the "Back to the app" link, and the YAML front matter is excluded from it');
const approvedText = goldenBody ? markdownText(goldenBody) : '';
assert(approvedText.length > 6000 && approvedText.startsWith('Privacy Munera (irbfootball.com and the Munera iPhone app) · last updated 2026-09-30 '),
  `the approved text is non-trivial and opens with the new title line (${approvedText.length} characters, sha256 ${sha(approvedText).slice(0, 12)}…)`);

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
assert(page.includes(DATE_LINE), 'the date line reads "Munera (irbfootball.com and the Munera iPhone app) · last updated 2026-09-30", in the page\'s own muted-paragraph form');

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

console.log(`\n[privacytest] ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
