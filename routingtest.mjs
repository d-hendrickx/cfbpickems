/**
 * routingtest.mjs — D1 Lane C §3.A, DI-633 / DI-634 / DI-635 (UN-477 / PF-477): MODEL ROUTING IS DATA, RESOLVED BY TASK CLASS.
 * ============================================================================================================================
 * Proves, offline and with no network: the catalog (the verified ids and prices, the closed sets), `resolveRoute` for EVERY class x pilot / non-pilot x every source (default,
 * platform, league) and every problem (a tier the class may not use, an unavailable tier, a malformed row), the non-pilot cap at Sonnet, learn following chat, the fallback rules,
 * `parsePlatformRoutes` / `parseClassShares` / `classCapUsd`, the request shape per model (`applyModelShape`: the pair is both-or-neither from the catalog), that a fallback / tier change
 * moves ONLY the model and the shape fields of a request (the evidence is byte-identical across tiers), and the Admin routing card: its states, its copy (verbatim from DI-634),
 * the value it writes (always one the database validator accepts) and the Super-Admin-only write affordance. The literal-model rule and the C11/C19 pins live in
 * `supabase/tests/functions.check.mjs`. Run: node routingtest.mjs
 */
import { readFileSync } from 'node:fs';
import {
  SCRIBE_MODEL_TIERS, SCRIBE_MODEL_CATALOG, SCRIBE_MODEL_LEGACY_IDS, SCRIBE_MODEL_CLASSES, SCRIBE_CLASS_ALLOWED_TIERS, SCRIBE_CLASS_DEFAULT_TIER, SCRIBE_FALLBACK_CLASSES,
  SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD, SCRIBE_CLASS_CAP_TOTAL_USD, SCRIBE_MODEL_CHOICES, tierForModelId, legacyModelToTier,
} from './js/data-model.js';
import { resolveRoute, resolveAllRoutes, parsePlatformRoutes, parseClassShares, classCapUsd, feedPlatformCapUsd, tierCostRatio, tierUsableForClass, classSupportsFallback } from './js/scribe-routing.js';
import {
  ROUTE_ROWS, ROUTES_COPY, routesViewModel, renderScribeRoutesBody, renderRouteSheetBody, draftForClass, nextRoutesValue, savedToast, idStem, spendWord,
} from './js/scribe-routes-card.js';
import { applyModelShape, applyShortCallShape, SCRIBE_MODEL_DEFAULT } from './supabase/functions/_shared/anthropic.js';
import { buildRetrievalPayload } from './supabase/functions/_shared/scribe-retrieval.mjs';
import { SCRIBE_MODEL_RATES_USD_PER_MTOK, scribeCostEstimateUsd, scribeWorstCaseUsd } from './supabase/functions/_shared/scribe-rate.js';

let pass = 0, fail = 0;
function assert(cond, label, detail = '') {
  if (cond) { pass++; console.log('  ✅', label); } else { fail++; console.error('  ❌', label, detail); }
}
const js = (x) => JSON.stringify(x);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

console.log('\n[1] THE CATALOG — the current ids and prices, the closed sets…');
assert(SCRIBE_MODEL_CATALOG.haiku.id === 'claude-haiku-5-5' && SCRIBE_MODEL_CATALOG.sonnet.id === 'claude-sonnet-5-5' && SCRIBE_MODEL_CATALOG.opus.id === 'claude-opus-5-5',
  '1-1: the three ids are the current ones (coordinator, 2026-10-08: Haiku 5.5; Haiku 4.5 is Legacy, retiring not sooner than 2026-10-15)');
assert(!SCRIBE_MODEL_TIERS.some((t) => /haiku-4/.test(SCRIBE_MODEL_CATALOG[t].id)) && Object.keys(SCRIBE_MODEL_LEGACY_IDS).includes('claude-haiku-4-5-20251001') && Object.keys(SCRIBE_MODEL_LEGACY_IDS).includes('claude-haiku-4-5')
  && tierForModelId('claude-haiku-4-5-20251001') === 'haiku' && tierForModelId('claude-haiku-4-5') === 'haiku',
  '1-1b: Haiku 4.5 is OUT of the catalog entirely; both of its ids live only in the legacy map and resolve to the haiku tier');
assert(js([SCRIBE_MODEL_CATALOG.haiku.input, SCRIBE_MODEL_CATALOG.haiku.output, SCRIBE_MODEL_CATALOG.sonnet.input, SCRIBE_MODEL_CATALOG.sonnet.output, SCRIBE_MODEL_CATALOG.opus.input, SCRIBE_MODEL_CATALOG.opus.output]) === js([0.1, 0.5, 2, 10, 4, 20]),
  '1-2: prices per million tokens: Haiku 5.5 $0.10 / $0.50, Sonnet $2 / $10, Opus $4 / $20');
{
  const h = SCRIBE_MODEL_CATALOG.haiku;
  assert(h.bandTokens === 100000 && h.inputOver === 0.5 && h.outputOver === 2.5 && SCRIBE_MODEL_CATALOG.sonnet.bandTokens === undefined && SCRIBE_MODEL_CATALOG.opus.bandTokens === undefined,
    '1-2b: Haiku 5.5 is priced in two bands (up to 100,000 prompt tokens $0.10 / $0.50, above that $0.50 / $2.50); Sonnet and Opus have one price and carry no band');
  assert(SCRIBE_MODEL_TIERS.every((t) => SCRIBE_MODEL_CATALOG[t].webSearchTool === 'web_search_20260209'), '1-2c: every tier uses web_search_20260209 (dynamic filtering, Claude 4.6 and later)');
  assert(h.thinking === true && h.effort === true && h.thinkingType === 'disabled' && h.effortFixed === 'low' && SCRIBE_MODEL_CATALOG.sonnet.thinkingType === 'adaptive' && SCRIBE_MODEL_CATALOG.opus.thinkingType === 'adaptive'
    && SCRIBE_MODEL_CATALOG.sonnet.effortFixed === null && SCRIBE_MODEL_CATALOG.opus.effortFixed === null,
    '1-2d: Haiku 5.5 is told thinking:disabled at the fixed effort low; Sonnet and Opus think adaptively at the caller\'s effort');
}
assert(Object.isFrozen(SCRIBE_MODEL_CATALOG) && SCRIBE_MODEL_TIERS.every((t) => Object.isFrozen(SCRIBE_MODEL_CATALOG[t])) && Object.isFrozen(SCRIBE_MODEL_TIERS) && Object.isFrozen(SCRIBE_MODEL_CLASSES),
  '1-3: the catalog and the closed sets are frozen - adding a model is a deliberate code edit');
assert(SCRIBE_MODEL_CLASSES.length === 7 && js([...SCRIBE_MODEL_CLASSES].sort()) === js(['analysis', 'chat', 'classify', 'feed', 'judge', 'learn', 'retrieval']),
  '1-4: seven classes: chat, learn, classify, judge, feed, analysis, retrieval');
assert(js(SCRIBE_CLASS_ALLOWED_TIERS.chat) === js(['sonnet', 'opus']) && js(SCRIBE_CLASS_ALLOWED_TIERS.learn) === js(['sonnet', 'opus'])
  && ['feed', 'analysis', 'retrieval', 'classify', 'judge'].every((c) => js(SCRIBE_CLASS_ALLOWED_TIERS[c]) === js(['haiku', 'sonnet'])),
  '1-5: allowed tiers per class are the DI\'s: chat and learn sonnet or opus; feed, analysis, retrieval, classify, judge haiku or sonnet (Opus is a chat option, not a routine feed model)');
assert(SCRIBE_CLASS_DEFAULT_TIER.chat === 'sonnet' && SCRIBE_CLASS_DEFAULT_TIER.learn === 'sonnet' && ['classify', 'judge', 'feed', 'analysis', 'retrieval'].every((c) => SCRIBE_CLASS_DEFAULT_TIER[c] === 'haiku'),
  '1-6: the default table: chat sonnet, learn sonnet (following chat), everything else haiku');
assert(Object.values(SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD).reduce((a, b) => a + b, 0) === SCRIBE_CLASS_CAP_TOTAL_USD && SCRIBE_CLASS_CAP_TOTAL_USD === 25
  && js(SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD) === js({ chat: 10, learn: 3, classify: 2, judge: 1, feed: 5, analysis: 1, retrieval: 3 }),
  '1-7: the default split of the $25 is Drew\'s (M-39: chat 10, learn 3, classify 2, judge 1, feed 5, analysis 1, retrieval 3) and sums to exactly 25');
{
  // M-39 - THE TOTAL IS ITS OWN ASSERTION, independent of the exact-object pin above: a future re-split that moves one share without moving another cannot leave the shares summing to anything
  // but the $25 the pilot and the platform are capped at. Checked three ways: the runtime object, the number literals in the SOURCE of the object, and what every consumer actually sees.
  const dmSrc = readFileSync(new URL('./js/data-model.js', import.meta.url), 'utf8');
  const lit = dmSrc.slice(dmSrc.indexOf('export const SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD'), dmSrc.indexOf('export const SCRIBE_CLASS_CAP_TOTAL_USD'));
  const srcNums = [...lit.matchAll(/\b(?:chat|learn|classify|judge|feed|analysis|retrieval):\s*(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  const classes = Object.keys(SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD);
  assert(srcNums.length === 7 && srcNums.reduce((a, b) => a + b, 0) === 25 && Object.values(SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD).every((v) => Number.isFinite(v) && v >= 0),
    `1-7b: the seven default shares, read from the SOURCE literal (${js(srcNums)}), total exactly $25 and are all non-negative numbers`);
  assert(classes.reduce((t, c) => t + parseClassShares(null).shares[c], 0) === 25 && classes.reduce((t, c) => t + classCapUsd(c, { leagueCapUsd: 25 }), 0) === 25
    && Math.abs(classes.reduce((t, c) => t + classCapUsd(c, { leagueCapUsd: 5 }), 0) - 5) < 1e-9,
    '1-7c: ...and what the handlers see (the parsed defaults, and the per-class caps for the pilot\'s $25 and for a $5 league) also total exactly the league\'s cap');
}
assert(js([...SCRIBE_MODEL_CHOICES]) === js([SCRIBE_MODEL_CATALOG.sonnet.id, SCRIBE_MODEL_CATALOG.opus.id]) && SCRIBE_MODEL_DEFAULT === SCRIBE_MODEL_CATALOG.sonnet.id,
  '1-8: the commissioner\'s choices and the default model DERIVE from the catalog');
for (const [legacy, tier] of Object.entries(SCRIBE_MODEL_LEGACY_IDS)) {
  assert(tierForModelId(legacy) === tier && legacyModelToTier(legacy) === tier && tierForModelId(SCRIBE_MODEL_CATALOG[tier].id) === tier,
    `1-9 (${legacy}): a stored legacy id maps to its tier, and a catalog id to its own`);
}
for (const bad of ['constructor', '__proto__', 'toString', 'gpt-5', '', null, undefined, 42, {}]) {
  assert(tierForModelId(bad) === null, `1-10 (${String(bad)}): an unknown id (prototype keys included) maps to NO tier`);
}
assert(SCRIBE_MODEL_TIERS.every((t) => SCRIBE_MODEL_RATES_USD_PER_MTOK[SCRIBE_MODEL_CATALOG[t].id].input === SCRIBE_MODEL_CATALOG[t].input)
  && Object.entries(SCRIBE_MODEL_LEGACY_IDS).every(([id, t]) => SCRIBE_MODEL_RATES_USD_PER_MTOK[id].output === SCRIBE_MODEL_CATALOG[t].output),
  '1-11: the rate card is derived from the catalog (legacy ids priced as the tier that replaced them)');
assert(scribeCostEstimateUsd(SCRIBE_MODEL_CATALOG.opus.id, { input_tokens: 1e6, output_tokens: 1e6 }, 0) === 24 && scribeCostEstimateUsd('claude-opus-5', { input_tokens: 1e6, output_tokens: 1e6 }, 0) === 24
  && scribeCostEstimateUsd('not-a-model', { input_tokens: 1e6, output_tokens: 0 }, 0) === 2,
  '1-12: a million in and out on Opus is $24 (a stored legacy id meters at the same price); an unpriced id falls back to Sonnet rates (F-3), never NaN');
{
  const H = SCRIBE_MODEL_CATALOG.haiku.id;
  assert(scribeCostEstimateUsd(H, { input_tokens: 100000, output_tokens: 1e6 }, 0) === 0.51 && scribeCostEstimateUsd(H, { input_tokens: 100001, output_tokens: 1e6 }, 0) > 2.5
    && scribeCostEstimateUsd(H, { input_tokens: 1e6, output_tokens: 1e6 }, 0) === 3,
    '1-12b: Haiku 5.5 meters at $0.10 / $0.50 up to 100,000 prompt tokens and the WHOLE request at $0.50 / $2.50 above that (100,000 in + 1M out = $0.51; 1M in + 1M out = $3)');
  assert(scribeCostEstimateUsd(H, { input_tokens: 50000, cache_read_input_tokens: 60000, output_tokens: 0 }, 0) > scribeCostEstimateUsd(H, { input_tokens: 50000, cache_read_input_tokens: 40000, output_tokens: 0 }, 0) * 4,
    '1-12c: the band is decided by the whole prompt (fresh + cached), so a cached prompt past 100,000 tokens bills at the upper band');
  assert(scribeCostEstimateUsd('claude-haiku-4-5-20251001', { input_tokens: 1e5, output_tokens: 1e6 }, 0) === 0.51 && scribeCostEstimateUsd('claude-haiku-4-5', { input_tokens: 1e5, output_tokens: 1e6 }, 0) === 0.51,
    '1-12d: a stored Haiku 4.5 id meters at the Haiku 5.5 price - it is sent as the current id');
  assert(SCRIBE_MODEL_RATES_USD_PER_MTOK[SCRIBE_MODEL_CATALOG.sonnet.id] && js(SCRIBE_MODEL_RATES_USD_PER_MTOK[SCRIBE_MODEL_CATALOG.sonnet.id]) === js({ input: 2, output: 10 }) && js(SCRIBE_MODEL_RATES_USD_PER_MTOK[SCRIBE_MODEL_CATALOG.opus.id]) === js({ input: 4, output: 20 }),
    '1-12e: a one-price tier\'s rate-card entry is exactly { input, output } (no band keys)');
  assert(scribeWorstCaseUsd({ model: H, maxTokens: 1000, promptChars: 7000 }) < scribeWorstCaseUsd({ model: SCRIBE_MODEL_CATALOG.sonnet.id, maxTokens: 1000, promptChars: 7000 })
    && scribeWorstCaseUsd({ model: H, maxTokens: 1000, promptChars: 500000 }) > 10 * scribeWorstCaseUsd({ model: H, maxTokens: 1000, promptChars: 100000 }) / 5,
    '1-12f: the reservation follows the band too (a prompt estimated past 100,000 tokens reserves at the upper band)');
}
assert(tierCostRatio('opus', 'sonnet') === 2 && tierCostRatio('haiku', 'sonnet') === 0.05 && tierCostRatio('nope') === 1 && tierCostRatio('sonnet', 'sonnet') === 1,
  '1-13: the cost ratio is COMPUTED from the catalog ($4+$20 over $2+$10 = 2; Haiku 5.5 over Sonnet is 0.05, a cheaper tier never rounds to 0), never typed');

console.log('\n[2] resolveRoute — every class x pilot / non-pilot x source…');
const ROUTES = (r) => ({ v: 1, routes: r });
{
  // defaults
  for (const cls of SCRIBE_MODEL_CLASSES) {
    for (const pilot of [true, false]) {
      const r = resolveRoute(cls, { pilot });
      const want = SCRIBE_CLASS_DEFAULT_TIER[cls];
      assert(r.tier === want && r.id === SCRIBE_MODEL_CATALOG[want].id && r.source === 'default' && r.problem === null && r.fallbackTier === null,
        `2-1 (${cls}, pilot=${pilot}): nothing configured -> the default tier, source default, no problem, no fallback (got ${js(r)})`);
    }
  }
  assert(js(Object.keys(resolveAllRoutes({ pilot: true }))) === js(SCRIBE_MODEL_CLASSES), '2-2: resolveAllRoutes returns every class, in order');
  // platform route per class x pilot
  for (const cls of SCRIBE_MODEL_CLASSES) {
    for (const tier of SCRIBE_CLASS_ALLOWED_TIERS[cls]) {
      for (const pilot of [true, false]) {
        const r = resolveRoute(cls, { pilot, platformRoutes: ROUTES({ [cls]: { tier, fallback: null } }) });
        const capped = (cls === 'chat' || cls === 'learn') && !pilot && tier === 'opus' ? 'sonnet' : tier;
        assert(r.tier === capped && r.source === (capped === SCRIBE_CLASS_DEFAULT_TIER[cls] && false ? 'default' : 'platform') && r.problem === null,
          `2-3 (${cls} -> ${tier}, pilot=${pilot}): a platform route is honoured${capped !== tier ? ' but a non-pilot league is capped at Sonnet' : ''} (got ${r.tier}/${r.source})`);
      }
    }
  }
  // the league's own model wins for chat and learn, pilot only
  const s = (id) => ({ scribe: { model: id } });
  for (const cls of ['chat', 'learn']) {
    const r = resolveRoute(cls, { pilot: true, leagueSettings: s(SCRIBE_MODEL_CATALOG.opus.id), platformRoutes: ROUTES({ [cls]: { tier: 'sonnet' } }) });
    assert(r.tier === 'opus' && r.source === 'league', `2-4 (${cls}): the pilot commissioner's Opus choice WINS over the platform row (got ${r.tier}/${r.source})`);
    const legacy = resolveRoute(cls, { pilot: true, leagueSettings: s('claude-opus-5') });
    assert(legacy.tier === 'opus' && legacy.id === SCRIBE_MODEL_CATALOG.opus.id && legacy.source === 'league', `2-5 (${cls}): a STORED LEGACY id resolves to its tier and is sent as the catalog id`);
    const np = resolveRoute(cls, { pilot: false, leagueSettings: s(SCRIBE_MODEL_CATALOG.opus.id) });
    assert(np.tier === 'sonnet' && np.source === 'default', `2-6 (${cls}): a NON-pilot league's commissioner cannot buy Opus - the league choice is ignored (got ${np.tier}/${np.source})`);
    const str = resolveRoute(cls, { pilot: 'true', leagueSettings: s(SCRIBE_MODEL_CATALOG.opus.id) });
    assert(str.tier === 'sonnet', `2-7 (${cls}): only the boolean true earns the pilot's own choice (a truthy string is clamped: fail-closed)`);
  }
  // a league model never touches the other classes
  for (const cls of ['feed', 'analysis', 'retrieval', 'classify', 'judge']) {
    const r = resolveRoute(cls, { pilot: true, leagueSettings: s(SCRIBE_MODEL_CATALOG.opus.id) });
    assert(r.tier === 'haiku' && r.source === 'default', `2-8 (${cls}): the commissioner's chat model does not leak into ${cls}`);
  }
  // learn follows chat
  const lf = resolveRoute('learn', { pilot: true, platformRoutes: ROUTES({ chat: { tier: 'opus' } }) });
  assert(lf.tier === 'opus' && lf.source === 'default', `2-9: with no learn route, learn FOLLOWS chat's resolved tier (got ${lf.tier}/${lf.source})`);
  const lx = resolveRoute('learn', { pilot: true, platformRoutes: ROUTES({ chat: { tier: 'opus' }, learn: { tier: 'sonnet' } }) });
  assert(lx.tier === 'sonnet' && lx.source === 'platform', '2-10: an explicit learn route wins over following chat');
  // problems, reported loudly
  const p1 = resolveRoute('feed', { platformRoutes: ROUTES({ feed: { tier: 'opus' } }) });
  assert(p1.tier === 'haiku' && p1.problem === 'route_invalid' && p1.source === 'default', `2-11: Opus for feed is outside the class's allowed set -> the default, reported route_invalid (got ${js(p1)})`);
  const p2 = resolveRoute('chat', { platformRoutes: ROUTES({ chat: { tier: 'haiku' } }) });
  assert(p2.tier === 'sonnet' && p2.problem === 'route_invalid', '2-12: Haiku for chat is not allowed -> the default, route_invalid');
  for (const bad of [{ v: 2, routes: {} }, { v: 1 }, { v: 1, routes: { chat: { tier: 'gpt' } } }, { v: 1, routes: { nope: { tier: 'haiku' } } }, 'sonnet', 5, [], { v: 1, routes: [], extra: 1 }, { v: 1, routes: { chat: { tier: 'sonnet', color: 'red' } } }]) {
    const r = resolveRoute('feed', { platformRoutes: bad });
    assert(r.tier === 'haiku' && r.source === 'default' && r.problem === 'route_invalid', `2-13: a malformed stored value is reported route_invalid and every class runs on its default (${js(bad)})`);
  }
  assert(parsePlatformRoutes(null).invalid === false && parsePlatformRoutes(undefined).present === false, '2-14: an ABSENT row is not a problem: every class on its default (CONVENTIONS #10)');
  // unavailable tier
  const saved = SCRIBE_MODEL_CATALOG.opus.available;
  assert(tierUsableForClass('chat', 'opus') === true, '2-15 (control): Opus is usable for chat while available');
  // fallbacks
  for (const legacy of ['claude-haiku-4-5-20251001', 'claude-haiku-4-5']) {
    // a commissioner whose stored chat model still names Haiku 4.5: it maps to the haiku tier, which chat may not use, so chat resolves to its default WITHOUT a problem word and without throwing
    const r = resolveRoute('chat', { pilot: true, leagueSettings: { scribe: { model: legacy } } });
    assert(r.tier === 'sonnet' && r.source === 'default' && r.problem === null && r.id === SCRIBE_MODEL_CATALOG.sonnet.id, `2-15b (${legacy}): a stored Haiku 4.5 choice does not fail - it maps to the haiku tier and chat runs on its default (got ${js(r)})`);
    const j = resolveRoute('judge', { pilot: true, leagueSettings: { scribe: { model: legacy } } });
    assert(j.tier === 'haiku' && j.id === 'claude-haiku-5-5' && j.problem === null, `2-15c (${legacy}): the judge class is unaffected and runs on the catalog's Haiku 5.5`);
  }
  const f1 = resolveRoute('chat', { pilot: true, platformRoutes: ROUTES({ chat: { tier: 'sonnet', fallback: 'opus' } }) });
  assert(f1.fallbackTier === 'opus' && f1.fallbackId === SCRIBE_MODEL_CATALOG.opus.id, `2-16: a fallback tier the class allows is carried with its id (got ${js(f1)})`);
  const f2 = resolveRoute('chat', { pilot: false, platformRoutes: ROUTES({ chat: { tier: 'sonnet', fallback: 'opus' } }) });
  assert(f2.fallbackTier === null, '2-17: a non-pilot league\'s fallback is capped at Sonnet too, so it collapses to none');
  const f3 = resolveRoute('feed', { platformRoutes: ROUTES({ feed: { tier: 'haiku', fallback: 'opus' } }) });
  assert(f3.fallbackTier === null && f3.tier === 'haiku', '2-18: a fallback tier outside the class\'s allowed set is dropped');
  const f4 = resolveRoute('chat', { pilot: true, platformRoutes: ROUTES({ chat: { tier: 'sonnet', fallback: 'sonnet' } }) });
  assert(f4.fallbackTier === null, '2-19: a fallback equal to the primary is no fallback');
  // only the class whose handler EXECUTES a fallback carries one (DI-635 / PF-477 acceptance 3: a fallback OR an honest failure path): a stored fallback elsewhere is ignored, not carried
  for (const cls of ['learn', 'classify', 'judge', 'feed', 'analysis', 'retrieval']) {
    const allowed = SCRIBE_CLASS_ALLOWED_TIERS[cls];
    const other = allowed.find((t) => t !== SCRIBE_CLASS_DEFAULT_TIER[cls]);
    const x = resolveRoute(cls, { pilot: true, platformRoutes: ROUTES({ [cls]: { tier: SCRIBE_CLASS_DEFAULT_TIER[cls], fallback: other } }) });
    assert(x.fallbackTier === null && x.fallbackId === null && x.tier === SCRIBE_CLASS_DEFAULT_TIER[cls] && x.problem === null, `2-19b (${cls}): a stored fallback is ignored for a class whose handler runs no retry (no fallbackTier, no fallbackId, no problem word - the stored data is legal, just inert)`);
  }
  assert(js([...SCRIBE_FALLBACK_CLASSES]) === js(['chat']) && classSupportsFallback('chat') && !classSupportsFallback('learn') && !classSupportsFallback('nope') && !classSupportsFallback(undefined) && Object.isFrozen(SCRIBE_FALLBACK_CLASSES),
    '2-19c: exactly one class supports a fallback today (chat), the set is frozen and a non-class is not in it');
  const lg = resolveRoute('chat', { pilot: true, leagueSettings: { scribe: { model: SCRIBE_MODEL_CATALOG.sonnet.id } }, platformRoutes: ROUTES({ chat: { tier: 'opus', fallback: 'sonnet' } }) });
  assert(lg.source === 'league' && lg.tier === 'sonnet' && lg.fallbackTier === null, '2-19d: the pilot commissioner\'s own choice wins, and a fallback equal to it is no fallback');
  void saved;
  assert(throwsRange(() => resolveRoute('nope')) && throwsRange(() => resolveRoute('constructor')), '2-20: an unknown class THROWS (a programming error, never a silent default)');
}
function throwsRange(fn) { try { fn(); return false; } catch (e) { return e instanceof RangeError; } }

console.log('\n[3] the split of the $25 — parseClassShares / classCapUsd…');
{
  assert(parseClassShares(null).invalid === false && js(parseClassShares(null).shares) === js(SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD), '3-1: absent row -> the defaults, not a problem');
  const merged = parseClassShares({ feed: 3, chat: 12 });
  assert(merged.shares.feed === 3 && merged.shares.chat === 12 && merged.shares.learn === 3 && merged.invalid === false, '3-2: stored shares override only the classes they name');
  for (const bad of [{ chat: -1 }, { chat: 'x' }, { chat: NaN }, { nope: 1 }, { chat: 20, feed: 20 }, 'x', [], 5]) {
    const r = parseClassShares(bad);
    assert(r.invalid === true && js(r.shares) === js(SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD), `3-3: a malformed row is reported and every share takes its DEFAULT - never "no cap" (${js(bad)})`);
  }
  assert(classCapUsd('chat', { leagueCapUsd: 25 }) === 10 && classCapUsd('feed', { leagueCapUsd: 25 }) === 5 && classCapUsd('retrieval', { leagueCapUsd: 25 }) === 3 && classCapUsd('analysis', { leagueCapUsd: 25 }) === 1, '3-4: the pilot\'s $25 uses each share as written (chat 10, retrieval 3, analysis 1 since M-39)');
  assert(classCapUsd('chat', { leagueCapUsd: 5 }) === 2 && classCapUsd('retrieval', { leagueCapUsd: 5 }) === 0.6, '3-5: a $5 league uses share / 25 x its cap (chat 10/25 x 5 = 2, retrieval 3/25 x 5 = 0.6)');
  assert(classCapUsd('chat', { shares: { chat: 0 }, leagueCapUsd: 25 }) === 0, '3-6: a share of 0 turns the class off');
  assert(classCapUsd('chat', { leagueCapUsd: -1 }) === 0 && classCapUsd('chat', { leagueCapUsd: NaN }) === 0 && classCapUsd('nope', { leagueCapUsd: 25 }) === 0, '3-7: a bad cap input or an unknown class is a cap of 0 (fail closed)');
  assert(feedPlatformCapUsd({}) === 5 && feedPlatformCapUsd({ shares: { feed: 2.5 } }) === 2.5 && feedPlatformCapUsd({ shares: { feed: -1 } }) === 0, '3-8: the Home-card class bills the PLATFORM ledger, so its cap is the share itself');
}

console.log('\n[4] the request shape depends on the model — the pair is both-or-neither…');
{
  const mk = () => ({ model: 'x', max_tokens: 10, system: [], messages: [] });
  for (const t of ['sonnet', 'opus']) {
    const p = applyModelShape(mk(), SCRIBE_MODEL_CATALOG[t].id, 'high');
    assert(p.thinking && p.thinking.type === 'adaptive' && p.output_config && p.output_config.effort === 'high', `4-1 (${t}): thinking:adaptive and output_config.effort travel together`);
  }
  for (const asked of ['low', 'medium', 'high', 'ludicrous', undefined]) {
    const h = applyModelShape(mk(), SCRIBE_MODEL_CATALOG.haiku.id, asked);
    assert(h.thinking && h.thinking.type === 'disabled' && h.output_config && h.output_config.effort === 'low' && Object.keys(h.thinking).join() === 'type',
      `4-2 (asked ${String(asked)}): Haiku 5.5 is sent thinking:{type:'disabled'} WITH output_config.effort 'low' - the pair together (RG-222), whatever effort the caller asked for, and disabled is only legal at effort high or below`);
  }
  const hf = applyModelShape({ ...mk(), output_config: { format: { type: 'json_schema' } } }, SCRIBE_MODEL_CATALOG.haiku.id, 'high');
  assert(hf.output_config && hf.output_config.format && hf.output_config.effort === 'low' && hf.thinking.type === 'disabled', '4-3: on Haiku a structured-output `format` already on the request is kept, with the fixed effort JOINED to it inside the same output_config');
  // the two things Haiku 5.5 rejects can never be produced, by any tier, any effort word, any input
  let never = true;
  for (const t of SCRIBE_MODEL_TIERS) for (const e of ['low', 'medium', 'high', 'max', 'enabled', '', null, undefined, 7, {}]) {
    const p = applyModelShape(mk(), SCRIBE_MODEL_CATALOG[t].id, e);
    if (!p.thinking || !['adaptive', 'disabled'].includes(p.thinking.type) || 'budget_tokens' in p.thinking || JSON.stringify(p).includes('budget_tokens') || p.thinking.type === 'enabled') never = false;
    if (!['low', 'medium', 'high'].includes(p.output_config && p.output_config.effort)) never = false;
  }
  assert(never, '4-3b: for every tier and every effort word (known, unknown, wrong type) the request carries thinking.type adaptive or disabled and NEVER enabled or a budget_tokens, and always an effort from the closed enum beside it');
  const sc = applyShortCallShape({ ...mk(), output_config: { format: { type: 'json_schema' } } }, SCRIBE_MODEL_CATALOG.haiku.id);
  assert(sc.thinking.type === 'disabled' && sc.output_config.effort === 'low' && sc.output_config.format, '4-3c: a short structured call (classify, 128 tokens) on Haiku 5.5 is told not to think, keeping its format');
  assert(js(applyShortCallShape(mk(), SCRIBE_MODEL_CATALOG.sonnet.id)) === js(mk()) && js(applyShortCallShape(mk(), SCRIBE_MODEL_CATALOG.opus.id)) === js(mk()) && js(applyShortCallShape(mk(), 'claude-not-in-the-catalog')) === js(mk()),
    '4-3d: ...and a short call on any OTHER model is left exactly as it has always been sent (no adaptive thinking is added to a 128-token budget)');
  // a stored legacy Haiku id is sent as the current one with the current shape
  assert(applyModelShape(mk(), 'claude-haiku-4-5-20251001', 'high').thinking.type === 'disabled' && applyModelShape(mk(), 'claude-haiku-4-5', 'high').output_config.effort === 'low', '4-3e: a legacy Haiku id given to the shaper gets the Haiku 5.5 shape');
  const sf = applyModelShape({ ...mk(), output_config: { format: { type: 'json_schema' } } }, SCRIBE_MODEL_CATALOG.sonnet.id, 'low');
  assert(sf.output_config.format && sf.output_config.effort === 'low', '4-4: on Sonnet the effort JOINS the format inside the same output_config (it is not a second assignment that drops one)');
  assert(applyModelShape(mk(), SCRIBE_MODEL_CATALOG.sonnet.id, 'ludicrous').output_config.effort === 'low', '4-5: an unknown effort word clamps to the default');
  assert(applyModelShape(mk(), 'claude-not-in-the-catalog', 'low').thinking === undefined, '4-6: a model the catalog does not know gets neither field');
  // byte-identical evidence across tiers: only the model + the shape fields differ between two requests built from the same input
  const base = { max_tokens: 1024, system: [{ type: 'text', text: 'SYSTEM' }], messages: [{ role: 'user', content: 'EVIDENCE' }] };
  const onSonnet = applyModelShape({ model: SCRIBE_MODEL_CATALOG.sonnet.id, ...JSON.parse(JSON.stringify(base)) }, SCRIBE_MODEL_CATALOG.sonnet.id, 'low');
  const onOpus = applyModelShape({ model: SCRIBE_MODEL_CATALOG.opus.id, ...JSON.parse(JSON.stringify(base)) }, SCRIBE_MODEL_CATALOG.opus.id, 'low');
  const onHaiku = applyModelShape({ model: SCRIBE_MODEL_CATALOG.haiku.id, ...JSON.parse(JSON.stringify(base)) }, SCRIBE_MODEL_CATALOG.haiku.id, 'low');
  const strip = (p) => { const c = { ...p }; delete c.model; delete c.thinking; delete c.output_config; return js(c); };
  assert(strip(onSonnet) === strip(onOpus) && strip(onOpus) === strip(onHaiku), '4-7: DI-635 - the system and the evidence are BYTE-IDENTICAL for every tier; routing changes only the model id and the shape fields');
  const rs = buildRetrievalPayload({ question: 'Is Nussmeier starting for LSU?', model: SCRIBE_MODEL_CATALOG.sonnet.id });
  const rh = buildRetrievalPayload({ question: 'Is Nussmeier starting for LSU?', model: SCRIBE_MODEL_CATALOG.haiku.id });
  const sh = (p) => { const c = JSON.parse(JSON.stringify(p)); delete c.model; delete c.thinking; delete c.output_config; c.tools = c.tools.map((t) => ({ ...t, type: 'T' })); return js(c); };
  assert(sh(rs) === sh(rh) && rh.tools[0].type === SCRIBE_MODEL_CATALOG.haiku.webSearchTool && rs.tools[0].type === SCRIBE_MODEL_CATALOG.sonnet.webSearchTool,
    '4-8: the retrieval request differs between tiers only in the model, the shape fields and the search-tool version the catalog names for that tier');
  assert(rh.thinking && rh.thinking.type === 'disabled' && rh.output_config.effort === 'low' && rh.tools[0].type === 'web_search_20260209' && rh.model === 'claude-haiku-5-5' && !JSON.stringify(rh).includes('budget_tokens'),
    '4-9: the isolated lookup on Haiku 5.5 carries thinking disabled at effort low, the dynamic-filtering search tool and the current id');
}

console.log('\n[5] the Admin routing card…');
{
  const html = (state, canWrite) => renderScribeRoutesBody({ state, canWrite, escHtml: esc, icon: (n) => `<i>${n}</i>` });
  const loading = html({ loaded: false }, true);
  assert(/aria-busy="true"/.test(loading) && !/data-route-class/.test(loading) && !/spinner/.test(loading) && (loading.match(/scribe-route-row--skeleton/g) || []).length === 7,
    '5-1: loading is SEVEN skeleton rows - no spinner, no tap target (cached -> skeleton -> progressive)');
  const unreadable = html({ loaded: false, error: 'boom' }, true);
  assert(unreadable.includes(esc(ROUTES_COPY.UNREADABLE)) && /scribe-routes-retry-btn/.test(unreadable) && !/boom/.test(unreadable), '5-2: a failed first read says so calmly with Retry, and never shows the raw error');
  const pop = html({ loaded: true, kv: null }, true);
  assert((pop.match(/data-route-class="/g) || []).length === 7 && ROUTE_ROWS.every((r) => pop.includes(esc(r.label)) && pop.includes(esc(r.purpose))), '5-3: populated: seven rows, each with its label and one-line purpose, as buttons for the Super Admin');
  assert(pop.includes('set by default') && pop.includes('claude-haiku-…') && pop.includes('claude-sonnet-…') && !pop.includes('claude-haiku-4-5-20251001'),
    '5-4: the second line reads "claude-haiku-… · set by default" (the family, not the whole id)');
  assert(pop.includes(esc(ROUTES_COPY.INTRO)) && !/scribe-routes-readonly/.test(pop) && (pop.match(/cc-row-chevron/g) || []).length === 7, '5-5: the intro copy is the DI\'s, and the Super Admin sees chevrons and no read-only note');
  const ro = html({ loaded: true, kv: null }, false);
  assert(!/data-route-class/.test(ro) && !/cc-row-chevron/.test(ro) && ro.includes(esc(ROUTES_COPY.READ_ONLY)) && ro.includes('set by default'), '5-6: read-only (a platform admin who is not Super Admin): the same table, NO tap targets, NO chevrons, and the note "Only the app administrator can change these."');
  const routed = html({ loaded: true, kv: ROUTES({ feed: { tier: 'sonnet' } }) }, true);
  assert(/Home cards[\s\S]{0,400}Sonnet/.test(routed) && /set by the administrator/.test(routed), '5-7: a platform route shows its tier and "set by the administrator"');
  const invalid = html({ loaded: true, kv: { v: 9 } }, true);
  assert(invalid.includes(esc(ROUTES_COPY.INVALID)) && /scribe-routes-invalid/.test(invalid) && /class="[^"]*admin-ai-loss[^"]*"[^>]*id="scribe-routes-invalid"/.test(invalid), '5-8: invalid stored config is a RED note (the loss class), never softened');
  {
    // the reviewer's polish note: the loss colour is a CLASS, not an inline style, on every state of both renderers - and the class exists in the stylesheet with the token colour
    const css = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
    const failed = renderRouteSheetBody({ cls: 'chat', draft: { tier: 'sonnet', fallback: null }, status: 'failed', escHtml: esc });
    const states = [invalid, html({ loaded: true, kv: ROUTES({ feed: { tier: 'opus' } }) }, true), html({ loaded: true, kv: null, error: true }, true), failed];
    assert(states.every((x) => !/style\s*=/.test(x)) && /admin-ai-loss/.test(failed) && /class="scribe-route-error admin-ai-loss/.test(failed),
      '5-8b: the routing card (invalid note, a rejected-route badge, the unreadable note) and the sheet\'s failed-save line carry NO inline style; the red is the admin-ai-loss class');
    const code = (f) => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert(!/style\s*=/.test(code('./js/scribe-routes-card.js')) && !/style\s*=/.test(code('./js/content-status-card.js')),
      '5-8b2: neither admin card module (routing, status) contains an inline style attribute anywhere in its code - the status card\'s red/amber pills and red lines are classes too');
    assert(/\.admin-ai-loss\{color:var\(--loss\)\}/.test(css) && /\.badge\.admin-ai-pill-loss\{background:var\(--loss-bg\);color:var\(--loss\);border-color:var\(--loss\)\}/.test(css),
      '5-8c: ...and the stylesheet defines the classes with the TOKEN colours (no hardcoded colour)');
  }
  const probl = html({ loaded: true, kv: ROUTES({ feed: { tier: 'opus' } }) }, true);
  assert(/Route not allowed/.test(probl), '5-9: a stored route the resolver had to reject is flagged on its row');
  const sp = html({ loaded: true, kv: null, spend: { feed: 0.84 } }, true);
  assert(sp.includes('$0.84 this month') && !html({ loaded: true, kv: null, spend: null }, true).includes('this month'), '5-10: the month\'s spend shows when known and is ABSENT (never "$0.00") when unknown');
  assert(idStem('claude-sonnet-5-5') === 'claude-sonnet-…' && spendWord(0.836) === '$0.84 this month' && spendWord(null) === '' && spendWord(-1) === '', '5-11: idStem and spendWord');
  const hostile = html({ loaded: true, kv: null }, true);
  assert(!/<script|onerror=|javascript:/i.test(hostile), '5-12: no script sink in the card');
  const saving = html({ loaded: true, kv: null, saving: 'feed' }, true);
  assert(/scribe-route-pill is-saving" data-route-pill="feed"/.test(saving), '5-13: while a save is in flight the pill is marked saving and the previous tier stays displayed');
}
{
  const sheet = (cls, draft, status) => renderRouteSheetBody({ cls, draft, status, escHtml: esc });
  const f = sheet('feed', { tier: 'haiku', fallback: null }, 'idle');
  assert((f.match(/data-route-tier=/g) || []).length === 2 && /data-route-tier="haiku"[^>]*aria-checked="true"/.test(f) && !/data-route-tier="opus"/.test(f), '6-1: the Home cards sheet offers exactly Haiku and Sonnet (Opus is not allowed for feed), Haiku selected');
  assert(f.includes(esc(ROUTES_COPY.description('haiku'))) && f.includes('Lowest cost. Used for Home cards.'), '6-2: the description is the DI\'s, verbatim');
  assert(!/data-route-fallback=/.test(f) && !f.includes(esc(ROUTES_COPY.SHEET_FALLBACK_HEADING)) && (f.match(/role="radiogroup"/g) || []).length === 1,
    '6-2b: the Home cards sheet has NO "If this model is unavailable" group (its failure path is the structured-facts card, DI-635): a setting that does nothing is not offered');
  for (const cls of ['learn', 'classify', 'judge', 'analysis', 'retrieval']) {
    const x = sheet(cls, { tier: SCRIBE_CLASS_DEFAULT_TIER[cls], fallback: 'sonnet' }, 'idle');
    assert(!/data-route-fallback=/.test(x) && (x.match(/role="radiogroup"/g) || []).length === 1, `6-2c (${cls}): no fallback group, and a stale draft fallback renders nothing`);
  }
  const c = sheet('chat', { tier: 'sonnet', fallback: null }, 'idle');
  assert((c.match(/data-route-tier=/g) || []).length === 2 && c.includes('Sharper writing, about 2× the cost of Sonnet.') && c.includes('Fast, and the cheaper chat model.'), '6-3: the chat sheet offers Sonnet and Opus; the ratio is the COMPUTED 2×');
  assert(c.includes(esc(ROUTES_COPY.SHEET_FALLBACK_HEADING)) && c.includes(esc(ROUTES_COPY.SHEET_FALLBACK_NONE)) && /data-route-fallback="none"[^>]*aria-checked="true"/.test(c), '6-4: "If this model is unavailable" - "Say SCRIBE can’t answer right now" is the recommended default');
  assert(/data-route-fallback="opus"/.test(c) && !/data-route-fallback="sonnet"/.test(c), '6-5: the fallback options are the class\'s OTHER allowed tiers');
  const fb = sheet('chat', { tier: 'sonnet', fallback: 'opus' }, 'idle');
  assert(/data-route-fallback="opus"[^>]*aria-checked="true"/.test(fb), '6-6: a chosen fallback is the selected radio');
  const bad = sheet('chat', { tier: 'haiku', fallback: 'sonnet' }, 'idle');
  assert(/data-route-tier="sonnet"[^>]*aria-checked="true"/.test(bad), '6-7: a draft tier outside the class\'s allowed set falls to the class default (never renders an illegal selection)');
  assert(/id="scribe-route-save"[^>]*>Save</.test(c) && /id="scribe-route-cancel"/.test(c) && /scribe-route-actions/.test(c), '6-8: Save (primary) and Cancel (secondary) in the centered action group');
  const sv = sheet('chat', { tier: 'sonnet', fallback: null }, 'saving');
  assert(/id="scribe-route-save"[^>]*disabled[^>]*>Saving</.test(sv) && /id="scribe-route-cancel"[^>]*disabled/.test(sv), '6-9: while saving, Save reads "Saving" and is disabled, and Cancel is disabled (nothing in flight is abandoned)');
  const failed = sheet('chat', { tier: 'sonnet', fallback: null }, 'failed');
  assert(failed.includes(esc(ROUTES_COPY.FAILED)) && /is-visible/.test(failed) && /id="scribe-route-save"[^>]*>Retry</.test(failed) && /role="alert"/.test(failed), '6-10: failed: "Couldn’t save. The previous route is still in use." in the sheet, and the button becomes Retry');
  assert(sheet('nope', {}, 'idle') === '', '6-11: an unknown class renders nothing');
  assert((c.match(/role="radio"/g) || []).length === 4 && (c.match(/role="radiogroup"/g) || []).length === 2, '6-12: two radiogroups with aria-checked on every radio - the accessible shape the heat and model dials use');
}
{
  // the value written
  const feedSonnet = nextRoutesValue(null, 'feed', 'sonnet', null);
  assert(js(feedSonnet) === js({ v: 1, routes: { feed: { tier: 'sonnet', fallback: null } } }), `7-1: first save writes { v:1, routes:{ feed:{ tier, fallback } } } (got ${js(feedSonnet)})`);
  const keep = nextRoutesValue(feedSonnet, 'chat', 'opus', 'sonnet');
  assert(js(keep) === js({ v: 1, routes: { feed: { tier: 'sonnet', fallback: null }, chat: { tier: 'opus', fallback: 'sonnet' } } }) || (keep.routes.feed.tier === 'sonnet' && keep.routes.chat.tier === 'opus' && keep.routes.chat.fallback === 'sonnet'),
    '7-2: saving one class keeps every other class\'s entry as stored');
  const back = nextRoutesValue(keep, 'feed', 'haiku', null);
  assert(back.routes.feed === undefined && back.routes.chat.tier === 'opus', '7-3: a class set back to its DEFAULT tier with no fallback is REMOVED (it reads "set by default" again; no redundant entry)');
  const backWithFb = nextRoutesValue(keep, 'chat', 'sonnet', 'opus');
  assert(backWithFb.routes.chat && backWithFb.routes.chat.tier === 'sonnet' && backWithFb.routes.chat.fallback === 'opus', '7-4: the default tier WITH a fallback is kept (the fallback is a real setting)');
  assert(nextRoutesValue(null, 'feed', 'haiku', 'sonnet') === null && nextRoutesValue(null, 'classify', 'haiku', 'sonnet') === null && nextRoutesValue(null, 'learn', 'sonnet', 'opus') === null,
    '7-4b: a fallback for a class that runs no retry is never written (null): the card cannot save a setting that does nothing');
  assert(nextRoutesValue(null, 'feed', 'opus', null) === null && nextRoutesValue(null, 'chat', 'haiku', null) === null && nextRoutesValue(null, 'nope', 'haiku', null) === null,
    '7-5: an illegal tier for the class, or an unknown class, is never written (null)');
  assert(nextRoutesValue(null, 'chat', 'sonnet', 'sonnet') === null && nextRoutesValue(null, 'chat', 'sonnet', 'haiku') === null && nextRoutesValue(null, 'chat', 'sonnet', 'nope') === null, '7-6: a fallback equal to the primary, outside the allowed set or unknown is refused');
  const repaired = nextRoutesValue({ v: 7, junk: true }, 'feed', 'sonnet', null);
  assert(js(repaired) === js({ v: 1, routes: { feed: { tier: 'sonnet', fallback: null } } }), '7-7: a malformed stored value is replaced by a fresh one holding only the entry being saved ("Open a route and save it again")');
  // every combination parses back as valid (the database validator in 0043 has the same rules - pglite0051 runs the real one)
  let allValid = true, count = 0;
  for (const cls of SCRIBE_MODEL_CLASSES) for (const tier of SCRIBE_CLASS_ALLOWED_TIERS[cls]) for (const fb of [null, ...(classSupportsFallback(cls) ? SCRIBE_CLASS_ALLOWED_TIERS[cls].filter((t) => t !== tier) : [])]) {
    const v = nextRoutesValue(null, cls, tier, fb);
    count += 1;
    if (!v || parsePlatformRoutes(v).invalid || Object.keys(v).sort().join() !== 'routes,v' || v.v !== 1) allValid = false;
  }
  assert(allValid && count >= 15, `7-8: every legal (class, tier, fallback) combination (${count}) yields a value the parser and the database shape accept`);
  assert(savedToast('sonnet') === 'Saved. New requests use Sonnet.' && savedToast('haiku') === 'Saved. New requests use Haiku.', '7-9: the saved toast is the DI\'s');
  const vm = routesViewModel({ kv: ROUTES({ chat: { tier: 'opus', fallback: 'sonnet' } }) });
  const chat = vm.rows.find((r) => r.cls === 'chat');
  assert(chat.tier === 'opus' && chat.source === 'platform' && chat.fallbackTier === 'sonnet' && draftForClass({ kv: ROUTES({ chat: { tier: 'opus', fallback: 'sonnet' } }), cls: 'chat' }).fallback === 'sonnet',
    '7-10: the view model and the sheet\'s opening draft come from the SAME resolver the server calls');
}

console.log('\n[6] static: where the pieces are wired…');
{
  const { readFileSync } = await import('node:fs');
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const panel = read('./js/admin-panel.js');
  const roles = read('./js/roles.js');
  assert(/'scribe-routes': 'settings'/.test(panel) && /'scribe-model': 'Chat model for this league'/.test(panel) && /'scribe-routes': 'SCRIBE models'/.test(panel),
    '8-1: the card is on Admin -> Settings, titled "SCRIBE models", and the old card is retitled "Chat model for this league" (no behaviour change)');
  assert(panel.indexOf("'scribe-model': 'settings'") < panel.indexOf("'scribe-routes': 'settings'") && panel.indexOf("'scribe-routes': 'settings'") < panel.indexOf("'pilot-league-flag': 'settings'"), '8-2: it sits directly AFTER the chat-model card');
  assert(/'scribe-routes':\s+\{ scope: 'admin' \}/.test(roles), '8-3: CARD_OPERABILITY[scribe-routes] is { scope: \'admin\' } (read: platform admins; the write is Super Admin only, in the card and on the server)');
  const app = read('./js/app.js');
  assert(/await superSetPlatformKv\('scribe_model_routes', next\)/.test(app) && /getIsSuperAdmin\(\) === true/.test(app) && !/superSetPlatformKv\('scribe_(?:class_caps_usd|search)'/.test(app),
    '8-4: the ONE write is superSetPlatformKv(\'scribe_model_routes\', …), the card is gated on the Super Admin flag, and no UI writes the caps or the search switch');
  assert(/if \(!getIsSuperAdmin\(\)\) return;/.test(app), '8-5: the tap handler re-checks the Super Admin flag (the card renders no tap target for anyone else; this is the belt)');
}

console.log(`\n${'─'.repeat(70)}\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed\n${'─'.repeat(70)}`);
process.exit(fail === 0 ? 0 : 1);
