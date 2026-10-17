/**
 * js/scribe-routes-card.js — THE ADMINISTRATOR'S ROUTING CARD: which model handles each kind of SCRIBE work (D1 Lane C, DI-634 / UN-477 / PF-477).
 * ===========================================================================================================================================
 * PURE RENDER AND PURE DECISIONS. No DOM, no network, no storage, no clock. `js/app.js` owns the sheet (it mounts the shared sheet shell, wires the tap and the
 * swipe, calls `superSetPlatformKv`, toasts and fires the haptic); this module owns WHAT IS SHOWN and WHAT IS WRITTEN. Admin → Settings, directly after the
 * "Chat model for this league" card (`ADMIN_CARD_TAB['scribe-routes'] = 'settings'`, `CARD_OPERABILITY['scribe-routes'] = { scope: 'admin' }`).
 *
 *   READ  platform admins (the rows are in `platform_kv`, which any signed-in account may read: the id is not a secret and the card shows no key).
 *   WRITE Super Admin only, through `super_set_platform_kv` (migration 0049 admits the key). Everyone else sees the same table and the note "Only the app administrator can
 *         change these." with no chevrons and no tap.
 *
 * ONE RESOLVER. The effective route on every row is `resolveAllRoutes()` from `js/scribe-routing.js`, the SAME function the Edge Functions call, over the same catalog
 * in `js/data-model.js`: the card cannot say Haiku while the server sends Sonnet. A cost ratio is COMPUTED from the catalog's prices, never typed. A stored route the resolver
 * had to reject (a tier the class may not use, a tier marked unavailable, a malformed row) is shown in RED, not softened (DI-634 "invalid stored config").
 *
 * WHAT THE PILOT LEAGUE'S OWN MODEL CHOICE DOES: IRB's commissioner picks Sonnet or Opus for chat and learning in Comm/Admin ("Chat model for this league"), and that choice
 * wins over the platform row for that league (DI-633 rule 1). The card shows the PLATFORM route and says so on the two rows it can differ on.
 *
 * STATES (DI-634): loading (skeleton rows, no spinner), populated, saving (the row's pill spins, the previous tier stays displayed), saved (the pill updates), failed (the sheet
 * says so, nothing changes, Retry), read-only, invalid stored config. Copy is the DI's, verbatim. Motion and haptics are the shell's (js/app.js).
 */

import {
  SCRIBE_MODEL_CATALOG, SCRIBE_MODEL_CLASSES, SCRIBE_CLASS_ALLOWED_TIERS, SCRIBE_CLASS_DEFAULT_TIER,
} from './data-model.js';
import { resolveAllRoutes, tierCostRatio, isScribeClass, isScribeTier, parsePlatformRoutes, classSupportsFallback } from './scribe-routing.js';

/** The seven classes, in the order the DI lists them, with their row label and one-line purpose (copy verbatim from DI-634). */
export const ROUTE_ROWS = Object.freeze([
  Object.freeze({ cls: 'chat', label: 'Chat replies and posts', purpose: '@SCRIBE answers and unprompted posts' }),
  Object.freeze({ cls: 'learn', label: 'Learning', purpose: 'Trainer and instant learning' }),
  Object.freeze({ cls: 'feed', label: 'Home cards', purpose: 'previews, storylines, spotlights' }),
  Object.freeze({ cls: 'analysis', label: 'History analysis', purpose: 'callback detail' }),
  Object.freeze({ cls: 'retrieval', label: 'Source lookup', purpose: 'current sports questions' }),
  Object.freeze({ cls: 'classify', label: 'Classifying', purpose: 'reads each message' }),
  Object.freeze({ cls: 'judge', label: 'Quality check', purpose: 'picks the best draft' }),
]);

/** Copy, verbatim from DI-634. */
export const ROUTES_COPY = Object.freeze({
  TITLE: 'SCRIBE models',
  INTRO: 'Which model handles each kind of SCRIBE work. Changes apply to the next request.',
  READ_ONLY: 'Only the app administrator can change these.',
  INVALID: 'Saved routes could not be read, so defaults are in use. Open a route and save it again.',
  UNREADABLE: 'Couldn’t load the saved routes. Showing nothing, not a guess.',
  RETRY: 'Retry',
  SHEET_FALLBACK_HEADING: 'If this model is unavailable',
  SHEET_FALLBACK_NONE: 'Say SCRIBE can’t answer right now',
  SHEET_FALLBACK_NONE_NOTE: 'Recommended',
  SAVE: 'Save',
  CANCEL: 'Cancel',
  SAVING: 'Saving',
  FAILED: 'Couldn’t save. The previous route is still in use.',
  PILOT_NOTE: 'This league’s own choice (Chat model for this league) overrides this row for that league.',
  saved: (tierLabel) => `Saved. New requests use ${tierLabel}.`,
  description: (tier) => {
    if (tier === 'haiku') return 'Lowest cost. Used for Home cards.';
    if (tier === 'sonnet') return 'Fast, and the cheaper chat model.';
    if (tier === 'opus') return `Sharper writing, about ${tierCostRatio('opus', 'sonnet')}× the cost of Sonnet.`;
    return '';
  },
  sourceWord: (source) => (source === 'platform' ? 'set by the administrator' : source === 'league' ? 'set by the league' : 'set by default'),
});

/** "claude-haiku-…": the family part of a model id, for a row's second line. The full id is in the sheet. */
export function idStem(id) {
  const parts = String(id || '').split('-');
  return parts.length > 2 ? `${parts.slice(0, 2).join('-')}-…` : String(id || '');
}

/** "$0.84 this month", or '' when no figure is known (the spend arrives with the status read; absent is never shown as zero). */
export function spendWord(n) {
  if (n === null || n === undefined || n === '') return '';
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 ? `$${v.toFixed(2)} this month` : '';
}

/**
 * The view model: one entry per class. `kv` is the raw `platform_kv` value of `scribe_model_routes` (or null when absent), `spend` an optional `{ <class>: usd }`.
 * @returns {{ invalid:boolean, rows: Array<{cls,label,purpose,tier,tierLabel,id,source,problem,fallbackTier,spend}> }}
 */
export function routesViewModel({ kv = null, spend = null } = {}) {
  const parsed = parsePlatformRoutes(kv);
  // pilot:true with NO league settings shows the PLATFORM route as configured (a non-pilot cap at Sonnet would hide a stored Opus); the league override has its own note.
  const resolved = resolveAllRoutes({ pilot: true, leagueSettings: null, platformRoutes: parsed });
  const rows = ROUTE_ROWS.map((r) => {
    const x = resolved[r.cls];
    return {
      cls: r.cls, label: r.label, purpose: r.purpose, tier: x.tier, tierLabel: SCRIBE_MODEL_CATALOG[x.tier].label, id: x.id,
      source: x.source, problem: x.problem, fallbackTier: x.fallbackTier, spend: spend && Object.prototype.hasOwnProperty.call(spend, r.cls) ? spend[r.cls] : null,
    };
  });
  return { invalid: parsed.invalid, rows };
}

const attr = (s, esc) => esc(String(s));
// Markup is composed by joining parts (never by interpolating a finished fragment into a template), so the XSS sweep (xsstest [9c-1g]) can prove every `${}` left is escaped.
const join = (parts) => parts.join('');

/** The card body. `state`: { kv, loaded, loading, error, attempted, spend }, `canWrite` Super Admin. Returns the HTML that goes INSIDE the admin shell's `.card`. */
export function renderScribeRoutesBody({ state = {}, canWrite = false, escHtml, icon } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  const ic = typeof icon === 'function' ? icon : () => '';
  const intro = `<p class="text-muted text-xs mb-sm">${esc(ROUTES_COPY.INTRO)}</p>`;
  const notLoaded = !state.loaded;
  if (state.error && notLoaded) {
    return `${intro}<p class="text-xs mb-sm admin-ai-loss" role="alert">${esc(ROUTES_COPY.UNREADABLE)}</p>
      <button type="button" class="btn btn-ghost btn-sm" id="scribe-routes-retry-btn">${esc(ROUTES_COPY.RETRY)}</button>`;
  }
  if (notLoaded) {
    // Loading: skeleton rows (cached -> skeleton -> progressive; no spinner), the same shimmer vocabulary the cross-league cards use.
    const skel = ROUTE_ROWS.map(() => `
      <div class="scribe-route-row scribe-route-row--skeleton" aria-hidden="true">
        <div class="scribe-route-main"><div class="league-card-skeleton-line league-card-skeleton-line-wide"></div><div class="league-card-skeleton-line league-card-skeleton-line-narrow"></div></div>
      </div>`).join('');
    return `${intro}<div class="scribe-route-list" aria-busy="true">${skel}</div>`;
  }
  const vm = routesViewModel({ kv: state.kv === undefined ? null : state.kv, spend: state.spend || null });
  const invalid = vm.invalid
    ? `<p class="text-xs mb-sm admin-ai-loss" role="alert" id="scribe-routes-invalid">${esc(ROUTES_COPY.INVALID)}</p>` : '';
  const rows = vm.rows.map((r) => {
    const bad = r.problem ? ` <span class="badge admin-ai-pill-loss">${esc(r.problem === 'model_unavailable' ? 'Model unavailable' : 'Route not allowed')}</span>` : '';
    const second = [idStem(r.id), ROUTES_COPY.sourceWord(r.source), spendWord(r.spend)].filter(Boolean).join(' · ');
    const aria = `${r.label}, ${r.tierLabel}${canWrite ? ', double-tap to change' : ''}`;
    const note = (r.cls === 'chat' || r.cls === 'learn') ? `<span class="cc-row-secondary">${esc(ROUTES_COPY.PILOT_NOTE)}</span>` : '';
    const chevron = canWrite ? join(['<span class="cc-row-chevron" aria-hidden="true">', ic('chevronRight'), '</span>']) : '';
    const inner = join([
      '<span class="cc-row-label scribe-route-main">',
      `<span>${esc(r.label)}${bad}</span>`,
      `<span class="cc-row-secondary">${esc(r.purpose)}</span>`,
      `<span class="cc-row-secondary">${esc(second)}</span>`,
      note,
      '</span>',
      `<span class="badge badge-draft scribe-route-pill${state.saving === r.cls ? ' is-saving' : ''}" data-route-pill="${attr(r.cls, esc)}">${esc(r.tierLabel)}</span>`,
      chevron,
    ]);
    return canWrite
      ? join([`<button type="button" class="control-center-row scribe-route-row" data-route-class="${attr(r.cls, esc)}" aria-label="${attr(aria, esc)}">`, inner, '</button>'])
      : join([`<div class="control-center-row control-center-row--inert scribe-route-row" role="group" aria-label="${attr(aria, esc)}">`, inner, '</div>']);
  }).join('');
  const readOnly = canWrite ? '' : `<p class="text-muted text-xs mt-sm" id="scribe-routes-readonly">${esc(ROUTES_COPY.READ_ONLY)}</p>`;
  return join([intro, invalid, '<div class="scribe-route-list">', rows, '</div>', readOnly]);
}

/**
 * The sheet body for one class: the allowed tiers as radio rows (descriptions computed from the catalog), the fallback group, and the Save / Cancel pair (a centered group with
 * an 8 pt gap). `draft` is { tier, fallback } (fallback null = "say SCRIBE can't answer right now"); `status` is 'idle' | 'saving' | 'failed'.
 */
export function renderRouteSheetBody({ cls, draft, status = 'idle', escHtml } = {}) {
  const esc = typeof escHtml === 'function' ? escHtml : String;
  if (!isScribeClass(cls)) return '';
  const allowed = SCRIBE_CLASS_ALLOWED_TIERS[cls];
  const tier = allowed.includes(draft && draft.tier) ? draft.tier : SCRIBE_CLASS_DEFAULT_TIER[cls];
  const withFallback = classSupportsFallback(cls);
  const fbOptions = withFallback ? allowed.filter((t) => t !== tier) : [];
  const fallback = draft && fbOptions.includes(draft.fallback) ? draft.fallback : null;
  const radio = (name, value, checked, label, desc, extra = '') => {
    const dataAttr = name === 'tier' ? 'data-route-tier' : 'data-route-fallback';
    const extraHtml = extra === '' ? '' : join([' <span class="text-muted text-xs">', esc(extra), '</span>']);
    return `
        <button type="button" class="scribe-freq-opt${checked ? ' selected' : ''}" ${dataAttr}="${esc(value)}" role="radio" aria-checked="${checked ? 'true' : 'false'}">
          <span class="scribe-freq-label">${esc(label)}${extraHtml}</span>
          <span class="scribe-freq-desc">${esc(desc)}</span>
        </button>`;
  };
  const tierRows = allowed.map((t) => radio('tier', t, t === tier, SCRIBE_MODEL_CATALOG[t].label, ROUTES_COPY.description(t))).join('');
  const fbRows = withFallback
    ? radio('fallback', 'none', fallback === null, ROUTES_COPY.SHEET_FALLBACK_NONE, '', ROUTES_COPY.SHEET_FALLBACK_NONE_NOTE)
      + fbOptions.map((t) => radio('fallback', t, fallback === t, SCRIBE_MODEL_CATALOG[t].label, `Use ${SCRIBE_MODEL_CATALOG[t].label} for that one request.`)).join('')
    : '';
  // only the class whose handler executes a fallback offers one (SCRIBE_FALLBACK_CLASSES): every other class's failure path is the honest one DI-635 names for it
  const fbGroup = withFallback ? join([
    `<div class="form-label mt-sm">${esc(ROUTES_COPY.SHEET_FALLBACK_HEADING)}</div>`,
    `<div class="scribe-freq-dial" role="radiogroup" aria-label="${esc(ROUTES_COPY.SHEET_FALLBACK_HEADING)}">`, fbRows, '</div>',
  ]) : '';
  const row = ROUTE_ROWS.find((r) => r.cls === cls);
  const saving = status === 'saving';
  return `
    <div class="scribe-route-sheet" data-route-sheet-class="${esc(cls)}">
      <p class="text-muted text-xs mb-sm">${esc(row.label)} · ${esc(row.purpose)}</p>
      <div class="scribe-freq-dial" role="radiogroup" aria-label="${esc(row.label)} model">${tierRows}</div>
      ${fbGroup}
      <p class="scribe-route-error admin-ai-loss text-xs${status === 'failed' ? ' is-visible' : ''}" id="scribe-route-error" role="alert">${status === 'failed' ? esc(ROUTES_COPY.FAILED) : ''}</p>
      <div class="scribe-route-actions">
        <button type="button" class="btn btn-primary" id="scribe-route-save" ${saving ? 'disabled aria-busy="true"' : ''}>${esc(saving ? ROUTES_COPY.SAVING : (status === 'failed' ? ROUTES_COPY.RETRY : ROUTES_COPY.SAVE))}</button>
        <button type="button" class="btn btn-ghost" id="scribe-route-cancel" ${saving ? 'disabled' : ''}>${esc(ROUTES_COPY.CANCEL)}</button>
      </div>
    </div>`;
}

/** The draft a sheet opens with for a class: the effective route's tier and its fallback. */
export function draftForClass({ kv = null, cls }) {
  const x = routesViewModel({ kv }).rows.find((r) => r.cls === cls);
  return { tier: x ? x.tier : SCRIBE_CLASS_DEFAULT_TIER[cls], fallback: x && classSupportsFallback(cls) ? x.fallbackTier : null };
}

/**
 * The new `scribe_model_routes` value after saving `{ tier, fallback }` for one class. Pure. Keeps every other class's entry as stored; a class set back to its DEFAULT tier with no
 * fallback is REMOVED (so it reads "set by default" again and the row does not accumulate redundant entries). A malformed stored value is replaced by a fresh `{ v:1, routes }` holding
 * only the entry being saved ("Open a route and save it again"). The result always passes the database validator (0043): v 1, at most 16 classes, tiers from the closed set.
 * Returns null for an unusable class/tier (the caller does not write).
 */
export function nextRoutesValue(currentKv, cls, tier, fallback = null) {
  if (!isScribeClass(cls) || !isScribeTier(tier) || !SCRIBE_CLASS_ALLOWED_TIERS[cls].includes(tier)) return null;
  const fb = fallback === null || fallback === undefined ? null : fallback;
  if (fb !== null && (!classSupportsFallback(cls) || !isScribeTier(fb) || fb === tier || !SCRIBE_CLASS_ALLOWED_TIERS[cls].includes(fb))) return null;
  const parsed = parsePlatformRoutes(currentKv);
  const routes = {};
  for (const c of SCRIBE_MODEL_CLASSES) if (parsed.routes[c]) routes[c] = { tier: parsed.routes[c].tier, fallback: parsed.routes[c].fallback };
  if (tier === SCRIBE_CLASS_DEFAULT_TIER[cls] && fb === null) delete routes[cls];
  else routes[cls] = { tier, fallback: fb };
  return { v: 1, routes };
}

/** The toast line after a successful save. */
export function savedToast(tier) { return ROUTES_COPY.saved(isScribeTier(tier) ? SCRIBE_MODEL_CATALOG[tier].label : ''); }
