#!/usr/bin/env node
/**
 * scribeschematest.mjs — W-91 (Drew, 2026-10-16: "Also scribe is currently using canned lines please troubleshoot").
 * ============================================================================================================
 * Run:  cd cfb-pickems && node scribeschematest.mjs
 *
 * THE DEFECT. Every structured-output schema and every strict tool schema we send to Anthropic is compiled by the API
 * into a grammar, and the API accepts only a SUBSET of JSON Schema for that. `CANDIDATES_OUTPUT_FORMAT` (scribe-bestof.mjs)
 * pinned `minItems: 3, maxItems: 3` on its array. LIVE answered every `scribe-autonomous` best-of-three generation since
 * v0.29.0 (2026-10-03) with HTTP 400 invalid_request_error, field `output_config.format.schema`: "For 'array' type,
 * 'minItems' values other than 0 or 1 are not supported". So SCRIBE's unprompted model lines never posted, and the room
 * saw only the canned (tier-0) pool. No offline suite could see it: every twin's fake Anthropic accepts any schema, and
 * `interacttest` 6-2 even pinned the rejected shape as a feature.
 *
 * WHAT THIS SUITE PINS (P-11: an allow-list of what exists, never a deny-list of shapes):
 *   [1] THE REGISTRY. Every schema any function sends is listed here by name and walked. A source scan pins the number of
 *       `json_schema` / `input_schema` occurrences per file under supabase/functions/, so a NEW schema (or a vanished
 *       one) fails until it is registered and walked here.
 *   [2] THE KEYWORD ALLOW-LIST. Each schema node may use only: type, properties, items, required, additionalProperties,
 *       enum, anyOf, description, minItems. That is the set our schemas use today, each on the API's documented
 *       supported list. Values are checked too: `minItems` only 0 or 1; `additionalProperties` only `false` (and present
 *       on every object); `type` one basic type; `enum` primitives only; `required` names real properties.
 *   [3] THE WALKER ITSELF IS PROVEN: planted shapes that are NOT on the allow-list (maxItems, minItems 2, minimum,
 *       minLength, pattern, format, uniqueItems, additionalProperties true/{}, a nested bad node, an enum of objects)
 *       must each be refused.
 *   [4] THE COUNT LIVES IN CODE NOW. The schema can no longer say "exactly three", so `parseCandidates()` is what caps the
 *       candidates at BEST_OF_CANDIDATES; fewer than three stays today's degrade (the judge chooses among what came back,
 *       one candidate skips the judge), unchanged.
 */
import { register } from 'node:module';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
register('./supabase/tests/functions/loader.mjs', import.meta.url);

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

const bestof = await import('./supabase/functions/_shared/scribe-bestof.mjs');
const trainerPrompt = await import('./supabase/functions/_shared/scribeTrainerPrompt.js');
const learnPrompt = await import('./supabase/functions/_shared/scribeInstantLearnPrompt.js');
const feedPrompts = await import('./supabase/functions/_shared/feed-prompts.mjs');
const callbackEvidence = await import('./supabase/functions/_shared/callback-evidence.mjs');
const scribeTools = await import('./supabase/functions/_shared/scribe-tools.mjs');
const classify = await import('./supabase/functions/scribe-classify/index.js');

// ── THE WALKER ─────────────────────────────────────────────────────────────────────────────────────────────────────
const ALLOWED_KEYWORDS = Object.freeze(['type', 'properties', 'items', 'required', 'additionalProperties', 'enum', 'anyOf', 'description', 'minItems']);
const BASIC_TYPES = Object.freeze(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);

/** Every problem in one schema, as `path: what` strings. Empty = the API's subset. Never throws. */
function schemaProblems(node, at = '$') {
  const out = [];
  if (!node || typeof node !== 'object' || Array.isArray(node)) return [`${at}: not a schema object`];
  for (const k of Object.keys(node)) if (!ALLOWED_KEYWORDS.includes(k)) out.push(`${at}: keyword '${k}' is not on the allow-list`);
  if ('type' in node && !BASIC_TYPES.includes(node.type)) out.push(`${at}: type ${JSON.stringify(node.type)} is not one basic type`);
  if (!('type' in node) && !('anyOf' in node)) out.push(`${at}: neither type nor anyOf`);
  if ('minItems' in node && !(node.type === 'array' && (node.minItems === 0 || node.minItems === 1))) out.push(`${at}: minItems ${JSON.stringify(node.minItems)} (only 0 or 1, on an array)`);
  if ('description' in node && typeof node.description !== 'string') out.push(`${at}: description is not a string`);
  if ('enum' in node) {
    if (!Array.isArray(node.enum) || !node.enum.length) out.push(`${at}: enum is not a non-empty array`);
    else if (!node.enum.every((v) => v === null || ['string', 'number', 'boolean'].includes(typeof v))) out.push(`${at}: enum holds a non-primitive`);
  }
  if (node.type === 'object') {
    if (node.additionalProperties !== false) out.push(`${at}: an object without additionalProperties:false`);
    const props = node.properties && typeof node.properties === 'object' && !Array.isArray(node.properties) ? node.properties : null;
    if (!props) out.push(`${at}: an object without a properties map`);
    else for (const [name, sub] of Object.entries(props)) out.push(...schemaProblems(sub, `${at}.${name}`));
    if ('required' in node) {
      if (!Array.isArray(node.required)) out.push(`${at}: required is not an array`);
      else for (const r of node.required) if (!props || !Object.prototype.hasOwnProperty.call(props, r)) out.push(`${at}: required '${r}' is not a property`);
    }
  } else {
    if ('properties' in node) out.push(`${at}: properties on a non-object`);
    if ('required' in node) out.push(`${at}: required on a non-object`);
    if ('additionalProperties' in node) out.push(`${at}: additionalProperties on a non-object`);
  }
  if (node.type === 'array') {
    if (!node.items) out.push(`${at}: an array without items`);
    else out.push(...schemaProblems(node.items, `${at}[]`));
  } else if ('items' in node) out.push(`${at}: items on a non-array`);
  if ('anyOf' in node) {
    if (!Array.isArray(node.anyOf) || !node.anyOf.length) out.push(`${at}: anyOf is not a non-empty array`);
    else node.anyOf.forEach((s, i) => out.push(...schemaProblems(s, `${at}|${i}`)));
  }
  return out;
}

// ── [1] THE REGISTRY ──────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[1] EVERY SCHEMA A FUNCTION SENDS IS REGISTERED, AND NO OTHER EXISTS…');
const OUTPUT_FORMATS = {
  'scribe-bestof CANDIDATES_OUTPUT_FORMAT (scribe-autonomous / scribe-scan generation)': bestof.CANDIDATES_OUTPUT_FORMAT,
  'scribe-bestof JUDGE_OUTPUT_FORMAT (scribe-ask + autonomous judge)': bestof.JUDGE_OUTPUT_FORMAT,
  'scribe-classify CLASSIFY_OUTPUT_FORMAT': classify.CLASSIFY_OUTPUT_FORMAT,
  'scribeTrainerPrompt TRAINER_OUTPUT_SCHEMA (trainer)': trainerPrompt.TRAINER_OUTPUT_SCHEMA,
  'scribeInstantLearnPrompt INSTANT_LEARN_OUTPUT_SCHEMA (scribe-learn)': learnPrompt.INSTANT_LEARN_OUTPUT_SCHEMA,
  'feed-prompts FEED_OUTPUT_FORMAT (feed-build)': feedPrompts.FEED_OUTPUT_FORMAT,
  'callback-evidence CALLBACK_OUTPUT_FORMAT (feed-build)': callbackEvidence.CALLBACK_OUTPUT_FORMAT,
};
for (const [name, fmt] of Object.entries(OUTPUT_FORMATS)) {
  assert(!!fmt && fmt.type === 'json_schema' && fmt.schema && typeof fmt.schema === 'object' && Object.keys(fmt).every((k) => k === 'type' || k === 'schema'),
    `1-a: ${name} is exported and is exactly { type:'json_schema', schema }`);
}
const TOOLS = scribeTools.scribeToolDefinitions(true);
assert(TOOLS.length === 10 && TOOLS.every((t) => t.strict === true && t.input_schema) && TOOLS.some((t) => t.name === 'sports_lookup'),
  `1-b: the strict tool list (nine league tools + sports_lookup) is registered: ${TOOLS.length} tools`);

// The source pin. Counted per file across supabase/functions (tests excluded). A new schema literal anywhere is a FAIL
// until it is added to OUTPUT_FORMATS / TOOLS above and to this map; a pinned one that disappears is a FAIL too.
const PINNED = {
  json_schema: {
    'supabase/functions/_shared/scribe-bestof.mjs': 2,
    'supabase/functions/_shared/scribeTrainerPrompt.js': 1,
    'supabase/functions/_shared/scribeInstantLearnPrompt.js': 1,
    'supabase/functions/_shared/feed-prompts.mjs': 1,
    'supabase/functions/_shared/callback-evidence.mjs': 1,
    'supabase/functions/scribe-classify/index.js': 1,
  },
  input_schema: {
    'supabase/functions/_shared/scribe-tools.mjs': 10,
  },
};
function sourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(m?js|ts)$/.test(name) && name !== 'test.js') out.push(p);
  }
  return out;
}
const FILES = sourceFiles(path.join(HERE, 'supabase', 'functions'));
for (const [needle, pinned] of Object.entries(PINNED)) {
  const found = {};
  for (const f of FILES) {
    const n = (readFileSync(f, 'utf8').match(new RegExp(needle, 'g')) || []).length;
    if (n) found[path.relative(HERE, f).split(path.sep).join('/')] = n;
  }
  const extra = Object.keys(found).filter((k) => found[k] !== pinned[k]);
  const missing = Object.keys(pinned).filter((k) => found[k] !== pinned[k]);
  assert(extra.length === 0 && missing.length === 0,
    `1-c: '${needle}' occurs exactly where it is pinned (unpinned or changed: ${JSON.stringify(extra.map((k) => `${k}=${found[k]}`))}; pinned but changed or gone: ${JSON.stringify(missing.map((k) => `${k}=${found[k] || 0}`))})`);
}

// ── [2] THE ALLOW-LIST ────────────────────────────────────────────────────────────────────────────────────────────
console.log('\n[2] EVERY REGISTERED SCHEMA USES ONLY WHAT THE API ACCEPTS…');
for (const [name, fmt] of Object.entries(OUTPUT_FORMATS)) {
  const problems = fmt && fmt.schema ? schemaProblems(fmt.schema) : ['missing'];
  assert(problems.length === 0, `2-a: ${name} (${problems.length ? problems.join('; ') : 'clean'})`);
}
for (const t of TOOLS) {
  const problems = schemaProblems(t.input_schema);
  assert(problems.length === 0, `2-b: tool ${t.name} input_schema (${problems.length ? problems.join('; ') : 'clean'})`);
}
const cand = bestof.CANDIDATES_OUTPUT_FORMAT.schema.properties.candidates;
assert(cand.type === 'array' && !('maxItems' in cand) && (cand.minItems === undefined || cand.minItems <= 1),
  `2-c: W-91 by name: the candidates array carries no maxItems and no minItems above 1 (got ${JSON.stringify({ minItems: cand.minItems, maxItems: cand.maxItems })})`);

// ── [3] THE WALKER REFUSES WHAT IS NOT LISTED ─────────────────────────────────────────────────────────────────────
console.log('\n[3] THE WALKER IS PROVEN: PLANTED SHAPES OFF THE ALLOW-LIST ARE REFUSED…');
const arr = (extra) => ({ type: 'object', properties: { xs: { type: 'array', items: { type: 'string' }, ...extra } }, required: ['xs'], additionalProperties: false });
const PLANTS = {
  'minItems 3 / maxItems 3 (the live 400)': arr({ minItems: 3, maxItems: 3 }),
  'minItems 2': arr({ minItems: 2 }),
  'maxItems 1 alone': arr({ maxItems: 1 }),
  uniqueItems: arr({ uniqueItems: true }),
  'minimum on an integer': { type: 'object', properties: { n: { type: 'integer', minimum: 0 } }, required: ['n'], additionalProperties: false },
  'exclusiveMaximum': { type: 'object', properties: { n: { type: 'number', exclusiveMaximum: 1 } }, required: ['n'], additionalProperties: false },
  minLength: { type: 'object', properties: { s: { type: 'string', minLength: 1 } }, required: ['s'], additionalProperties: false },
  pattern: { type: 'object', properties: { s: { type: 'string', pattern: '^a' } }, required: ['s'], additionalProperties: false },
  'format: email': { type: 'object', properties: { s: { type: 'string', format: 'email' } }, required: ['s'], additionalProperties: false },
  'additionalProperties: true': { type: 'object', properties: {}, additionalProperties: true },
  'additionalProperties: {}': { type: 'object', properties: {}, additionalProperties: {} },
  'object with no additionalProperties': { type: 'object', properties: {} },
  'a bad node three levels down': { type: 'object', properties: { a: { type: 'array', items: { type: 'object', properties: { b: { type: 'string', maxLength: 5 } }, required: ['b'], additionalProperties: false } } }, required: ['a'], additionalProperties: false },
  'enum of objects': { type: 'object', properties: { e: { type: 'string', enum: [{ a: 1 }] } }, required: ['e'], additionalProperties: false },
  'type as a list': { type: 'object', properties: { t: { type: ['string', 'null'] } }, required: ['t'], additionalProperties: false },
  'required names a missing property': { type: 'object', properties: {}, required: ['ghost'], additionalProperties: false },
  '$ref (unused here, so unlisted)': { type: 'object', properties: { r: { $ref: '#/$defs/x' } }, required: ['r'], additionalProperties: false },
};
for (const [name, plant] of Object.entries(PLANTS)) {
  assert(schemaProblems(plant).length > 0, `3-a: refused: ${name}`);
}
assert(schemaProblems(arr({ minItems: 1 })).length === 0 && schemaProblems(arr({ minItems: 0 })).length === 0,
  '3-b: control: minItems 0 and 1 on an array are accepted (the two values the API documents)');

// ── [4] THE COUNT IS ENFORCED IN CODE ─────────────────────────────────────────────────────────────────────────────
console.log('\n[4] BEST-OF-THREE KEEPS ITS MEANING WITHOUT THE SCHEMA SAYING SO…');
assert(bestof.BEST_OF_CANDIDATES === 3, '4-a: BEST_OF_CANDIDATES is still 3');
const five = bestof.parseCandidates(JSON.stringify({ candidates: ['a', 'b', 'c', 'd', 'e'] }));
assert(five.length === 3 && five.join() === 'a,b,c', `4-b: a model that returns five gets three, the first three (got ${JSON.stringify(five)})`);
const two = bestof.parseCandidates(JSON.stringify({ candidates: ['a', 'b'] }));
assert(two.length === 2, `4-c: a model that returns two keeps today's degrade: two candidates for the judge (got ${JSON.stringify(two)})`);
const none = bestof.parseCandidates(JSON.stringify({ candidates: [] }));
assert(none.length === 0, `4-d: an empty array is nothing, never a posted envelope (got ${JSON.stringify(none)})`);

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
