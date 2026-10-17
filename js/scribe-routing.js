/**
 * js/scribe-routing.js — which model handles which kind of SCRIBE work (D1 Lane C, DI-633 / DI-636, UN-477 / PF-477).
 * ===================================================================================================================
 * PURE. No DOM, no network, no storage, no clock. It imports the catalog from `js/data-model.js` (the one module every runtime can import without a cycle) and
 * nothing else, so the Edge Functions (`supabase/functions/_shared/scribe-routing.mjs` loads the platform rows and calls into here) and the Admin routing card
 * (`js/scribe-routes-card.js`) resolve a route by THE SAME FUNCTION. Two copies of "what model does this class use" is how the card says Haiku while the server
 * sends Sonnet.
 *
 * ROUTING IS DATA, NOT CODE. A class (chat, learn, classify, judge, feed, analysis, retrieval) names a TIER (haiku, sonnet, opus); the catalog turns a tier into a
 * model id and a price. The platform row `platform_kv.scribe_model_routes` ({ v:1, routes:{ <class>:{ tier, fallback } } }) re-routes a class without a deploy.
 *
 * RESOLUTION, in this order (DI-633):
 *   1. `chat` and `learn` in a PILOT league: the commissioner's existing `settings.scribe.model` choice (Sonnet or Opus, DI-282) wins if it names a usable tier.
 *   2. otherwise the platform route for the class;
 *   3. otherwise the default table (chat sonnet, learn follows chat, everything else haiku). No fallback by default.
 *   A NON-PILOT league resolves chat and learn to at most Sonnet (a stranger's commissioner cannot buy Opus at the platform's expense: the rule N1 / DI-432 made).
 *   A route naming a tier the class may not use, or a tier the catalog marks `available:false`, resolves to the class default and is REPORTED, not hidden:
 *   `problem` is `'route_invalid'` or `'model_unavailable'` (the status card shows it in red, DI-637).
 *   DEFAULT-WHEN-MISSING (CONVENTIONS #10): a platform with no route row and a league with no model choice resolve to the defaults, which are what ran before routing existed.
 *
 * A FALLBACK NEVER WIDENS ANYTHING (DI-635). It only names a second tier for the SAME request; the evidence and the prompt are built before routing and are
 * byte-identical for every tier.
 */

import {
  SCRIBE_MODEL_TIERS, SCRIBE_MODEL_CATALOG, SCRIBE_MODEL_CLASSES, SCRIBE_CLASS_ALLOWED_TIERS, SCRIBE_CLASS_DEFAULT_TIER,
  SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD, SCRIBE_CLASS_CAP_TOTAL_USD, SCRIBE_FALLBACK_CLASSES, tierForModelId,
} from './data-model.js';

/** Where a resolved route came from. A closed set; it is written to `job_runs.payload` as `routeSource`. */
export const SCRIBE_ROUTE_SOURCES = Object.freeze(['default', 'platform', 'league']);
/** The two problems a route can have. Closed set; written to the status card, never free text. */
export const SCRIBE_ROUTE_PROBLEMS = Object.freeze(['route_invalid', 'model_unavailable']);

const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const tierRank = (t) => SCRIBE_MODEL_TIERS.indexOf(t);

export function isScribeClass(cls) { return typeof cls === 'string' && SCRIBE_MODEL_CLASSES.includes(cls); }
export function isScribeTier(t) { return typeof t === 'string' && SCRIBE_MODEL_TIERS.includes(t); }
/** Does this class's handler execute a fallback tier? (Only `chat`: see SCRIBE_FALLBACK_CLASSES.) */
export function classSupportsFallback(cls) { return typeof cls === 'string' && SCRIBE_FALLBACK_CLASSES.includes(cls); }

/** Can this class use this tier right now: allowed for the class AND available in the catalog. */
export function tierUsableForClass(cls, tier) {
  return isScribeClass(cls) && isScribeTier(tier)
    && SCRIBE_CLASS_ALLOWED_TIERS[cls].includes(tier)
    && SCRIBE_MODEL_CATALOG[tier].available === true;
}

/**
 * Read `platform_kv.scribe_model_routes` (the raw jsonb value, or null/undefined when the row is absent).
 *   - absent               -> `{ routes:{}, invalid:false, present:false }`, every class on its default
 *   - well-formed          -> `{ routes, invalid:false, present:true }`; an entry is `{ tier, fallback }` with `fallback` a tier or null
 *   - malformed in any way -> `{ routes:{}, invalid:true, present:true }`: defaults are used and the status card says so in red (never softened, DI-634)
 * The database validator (0043) refuses a malformed write; this is the belt for a row that arrived any other way. Pure and total: it never throws.
 */
export function parsePlatformRoutes(value) {
  if (value === null || value === undefined) return { routes: {}, invalid: false, present: false };
  const bad = { routes: {}, invalid: true, present: true };
  if (typeof value !== 'object' || Array.isArray(value)) return bad;
  const keys = Object.keys(value);
  if (keys.some((k) => k !== 'v' && k !== 'routes')) return bad;
  if (value.v !== 1 || !value.routes || typeof value.routes !== 'object' || Array.isArray(value.routes)) return bad;
  const routes = {};
  const entries = Object.entries(value.routes);
  if (entries.length > 16) return bad;
  for (const [cls, e] of entries) {
    if (!isScribeClass(cls) || !e || typeof e !== 'object' || Array.isArray(e)) return bad;
    if (Object.keys(e).some((k) => k !== 'tier' && k !== 'fallback')) return bad;
    if (!isScribeTier(e.tier)) return bad;
    const fb = e.fallback;
    if (fb !== undefined && fb !== null && !isScribeTier(fb)) return bad;
    routes[cls] = { tier: e.tier, fallback: isScribeTier(fb) ? fb : null };
  }
  return { routes, invalid: false, present: true };
}

function entry(tier, source, problem, fallbackTier, cls) {
  const t = SCRIBE_MODEL_CATALOG[tier];
  // a fallback is carried only for a class whose handler executes one (an ignored setting is a lie on the card)
  const fbTier = classSupportsFallback(cls) ? fallbackTier : null;
  const fb = fbTier ? SCRIBE_MODEL_CATALOG[fbTier] : null;
  return { tier, id: t.id, label: t.label, source, problem: problem || null, fallbackTier: fbTier || null, fallbackId: fb ? fb.id : null };
}

/**
 * Resolve one class to `{ class, tier, id, label, source, problem, fallbackTier, fallbackId }`. Pure; throws only on a class that is not in the closed set (a
 * programming error: every call site passes a literal, and `functions.check.mjs` pins that it does).
 *
 * @param {string} cls one of SCRIBE_MODEL_CLASSES
 * @param {{ pilot?: boolean, leagueSettings?: object|null, platformRoutes?: any }} [opts]
 *   `pilot` must be the boolean `true` to earn the pilot's own choice (the same fail-closed direction as `isPilotLeagueRow`);
 *   `leagueSettings` is the league's `settings` blob (only `.scribe.model` is read); `platformRoutes` is the raw `scribe_model_routes` value or a parsed result.
 */
export function resolveRoute(cls, { pilot = false, leagueSettings = null, platformRoutes = null, _depth = 0 } = {}) {
  if (!isScribeClass(cls)) throw new RangeError(`resolveRoute: unknown class ${String(cls)}`);
  const pr = (platformRoutes && typeof platformRoutes === 'object' && own(platformRoutes, 'routes') && own(platformRoutes, 'invalid') && own(platformRoutes, 'present'))
    ? platformRoutes : parsePlatformRoutes(platformRoutes);
  const chatLike = cls === 'chat' || cls === 'learn';
  const cap = (tier) => (chatLike && pilot !== true && tierRank(tier) > tierRank('sonnet')) ? 'sonnet' : tier;   // a stranger's commissioner cannot buy Opus
  let problem = pr.invalid ? 'route_invalid' : null;

  // 1. the pilot commissioner's own chat model (DI-282), for the two classes it governed before routing existed
  if (chatLike && pilot === true) {
    const s = leagueSettings && typeof leagueSettings === 'object' && leagueSettings.scribe && typeof leagueSettings.scribe === 'object' ? leagueSettings.scribe : null;
    const lt = s ? tierForModelId(s.model) : null;
    if (lt && tierUsableForClass(cls, lt)) {
      const fb = pr.routes[cls] && pr.routes[cls].fallback;
      return { class: cls, ...entry(lt, 'league', problem, fb && fb !== lt && tierUsableForClass(cls, fb) ? fb : null, cls) };
    }
    if (lt && !SCRIBE_MODEL_CATALOG[lt].available) problem = problem || 'model_unavailable';
  }

  // 2. the platform route
  const r = pr.routes[cls];
  if (r) {
    if (!SCRIBE_CLASS_ALLOWED_TIERS[cls].includes(r.tier)) {
      problem = 'route_invalid';
    } else if (!SCRIBE_MODEL_CATALOG[r.tier].available) {
      problem = problem || 'model_unavailable';
    } else {
      const tier = cap(r.tier);
      let fb = r.fallback && r.fallback !== tier && tierUsableForClass(cls, r.fallback) ? cap(r.fallback) : null;
      if (fb === tier) fb = null;
      return { class: cls, ...entry(tier, 'platform', problem, fb, cls) };
    }
  }

  // 3. the default table (learn follows chat; an unusable default falls to the first usable tier the class allows)
  let tier = SCRIBE_CLASS_DEFAULT_TIER[cls];
  if (cls === 'learn' && _depth === 0) {
    const chat = resolveRoute('chat', { pilot, leagueSettings, platformRoutes: pr, _depth: 1 });
    if (tierUsableForClass('learn', chat.tier)) tier = chat.tier;
  }
  if (!tierUsableForClass(cls, tier)) {
    const alt = SCRIBE_CLASS_ALLOWED_TIERS[cls].find((t) => tierUsableForClass(cls, t));
    problem = problem || 'model_unavailable';
    if (alt) tier = alt;
  }
  return { class: cls, ...entry(cap(tier), 'default', problem, null, cls) };
}

/** Every class resolved at once — what the Admin card and the status card show. */
export function resolveAllRoutes(opts = {}) {
  const out = {};
  for (const cls of SCRIBE_MODEL_CLASSES) out[cls] = resolveRoute(cls, opts);
  return out;
}

/**
 * "about 2x": how many times a tier costs a base tier, from the catalog and never typed (DI-633). Averages input and output so one number stands for a mixed
 * call, rounded to the nearest half. Opus over Sonnet is 2 on the verified prices ($4+$20 over $2+$10).
 */
export function tierCostRatio(tier, baseTier = 'sonnet') {
  if (!isScribeTier(tier) || !isScribeTier(baseTier)) return 1;
  const a = SCRIBE_MODEL_CATALOG[tier];
  const b = SCRIBE_MODEL_CATALOG[baseTier];
  const raw = (a.input + a.output) / (b.input + b.output);
  // a tier dearer than the base reads to the nearest half ("about 2x"); one CHEAPER than it reads to two decimals (Haiku 5.5 over Sonnet is 0.05, never "0")
  return raw < 1 ? Math.round(raw * 100) / 100 : Math.round(raw * 2) / 2;
}

// ── DI-636 — the $25 split per class ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Read `platform_kv.scribe_class_caps_usd` (raw jsonb or null): a share per class in dollars, each a non-negative number, the sum at most 25 (the database
 * validator enforces it; this re-checks). An absent row or an absent share takes the default; a malformed row is reported `invalid:true` and every share takes
 * its default (a malformed cap row must never read as "no cap").
 * @returns {{ shares: Record<string, number>, invalid: boolean, present: boolean }}
 */
export function parseClassShares(value) {
  const shares = { ...SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD };
  if (value === null || value === undefined) return { shares, invalid: false, present: false };
  const bad = { shares: { ...SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD }, invalid: true, present: true };
  if (typeof value !== 'object' || Array.isArray(value)) return bad;
  const merged = { ...SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD };
  for (const [k, v] of Object.entries(value)) {
    if (!isScribeClass(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 0) return bad;
    merged[k] = v;
  }
  // The database validator bounds the sum of the shares STORED (0043); merged with defaults the sum can pass 25 when only some shares were written, so the
  // same bound is applied here to the stored part only.
  const storedSum = Object.values(value).reduce((n, v) => n + v, 0);
  if (storedSum > SCRIBE_CLASS_CAP_TOTAL_USD + 1e-9) return bad;
  return { shares: merged, invalid: false, present: true };
}

/**
 * A class's monthly dollar cap for one league: `share / 25 x` the league's own monthly cap (DI-636), so the pilot's $25 uses each share as written and a $5 league
 * uses one fifth. A share of 0 means the class is off. Returns a finite number >= 0 (a bad cap input is treated as 0: fail closed).
 */
export function classCapUsd(cls, { shares = SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD, leagueCapUsd = SCRIBE_CLASS_CAP_TOTAL_USD } = {}) {
  if (!isScribeClass(cls)) return 0;
  const share = Number(own(shares, cls) ? shares[cls] : SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD[cls]);
  const cap = Number(leagueCapUsd);
  if (!Number.isFinite(share) || !Number.isFinite(cap) || share < 0 || cap < 0) return 0;
  return Math.round((share / SCRIBE_CLASS_CAP_TOTAL_USD) * cap * 1e6) / 1e6;
}

/** The feed class bills the PLATFORM ledger (public cards for every league), so its cap is the share itself, not a fraction of a league's cap. */
export function feedPlatformCapUsd({ shares = SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD } = {}) {
  const share = Number(own(shares, 'feed') ? shares.feed : SCRIBE_CLASS_CAP_SHARES_DEFAULT_USD.feed);
  return Number.isFinite(share) && share >= 0 ? share : 0;
}
