/**
 * js/leagues-home.js — The Leagues Journey (T-03…T-07, UN-298/299/300/284)
 * ============================================================================
 * DI-312 Leagues Home · DI-313 Create-League stub · DI-314 League Page +
 * sport cards · DI-315 League Standings entry + single-sport view · DI-316
 * Add-Sport stub. See `weekly bug fixes and feedback/UX Revamp 092426/
 * DESIGN_INPUTS_D_LEAGUES_092426.md` for the approved design input this file
 * implements. VERDICT: approved inline 2026-09-24, EXCEPT §0's single-
 * membership fast path (SINGLE_LEAGUE_ROUTE below), held for Drew.
 *
 * ── WHY THIS FILE HAS NO IMPORTS FROM app.js OR auth.js ────────────────────
 * Every function here is PURE RENDER or PURE ROUTING: data in (plain objects/
 * arrays, already resolved by the caller), HTML strings or plain decision
 * objects out. No DOM access, no storage access, no network, no top-level
 * side effects — the same shape as js/brand.js. This is what makes the file
 * independently testable in `leagueshometest.mjs` without booting the whole
 * app, and it is why `app.js`'s own render/security-sensitive functions are
 * never reimplemented here:
 *
 *   - `escHtml` is REQUIRED, injected by every caller. app.js's escHtml is
 *     not exported, so this module cannot import it — and CONVENTIONS #12
 *     ("escHtml() around every piece of user data, every time") is enforced
 *     structurally by throwing when a caller forgets to pass one, rather than
 *     silently falling back to an unescaped identity function.
 *   - `roleBadgeHTML` (the DI-312 card's role badge) is REQUIRED wherever a
 *     league card is rendered, and is never given a default implementation
 *     in this file. The real one — `leagueRoleBadgeHTML()` in app.js — folds
 *     in SECURITY F-6's privilege-hold override (a league mid-way through a
 *     re-verification must not show a stale "Commissioner" label). Forking
 *     that logic into a second module, even to produce byte-identical output
 *     today, is exactly the "two independent renderers of the same fact"
 *     class of defect CLAUDE.md's Architecture bullet 5 and CONVENTIONS #21
 *     exist to prevent — so this module renders whatever the caller's own
 *     `leagueRoleBadgeHTML` returns and owns none of that logic itself.
 *   - `isCommissioner` (DI-314/DI-316) is a plain boolean the caller already
 *     resolved from `getSession().isAdmin` — this module never reads a raw
 *     session object, so it can never mis-derive a privilege decision.
 *   - Sport labels are read from `ESPN_SPORT_ENDPOINTS` in `js/data-model.js`
 *     (a dependency-free leaf module, not app.js) — DI-314's explicit
 *     instruction: "not hard-coded here fresh... one source of truth."
 *
 * ── THE §0 ROUTING RULE — ONE ROUTER (reviewer gate, 2026-09-25) ───────────
 * `resolveLeagueEntryPath()` is now the ONLY place the §0 table is encoded.
 * `resolvePostSignInRoute()` calls it rather than re-deriving the same
 * decision, so the two functions can never disagree — asserted directly by
 * `leagueshometest.mjs`'s agreement sweep across every membership-count ×
 * `singleLeagueRoute` × warm/cold cell. Both are pure and take every input as
 * a parameter so the test suite can exercise the whole table without booting
 * auth.js.
 *
 * THE WARM PREDICATE CONTRACT. `warmRelaunch` means: an existing stored
 * session AND a remembered league id already exist for this device. This
 * module NEVER derives that fact itself — it has no storage access (file
 * header) — the caller computes it (e.g. "is there a persisted Supabase
 * session AND a `getActiveLeagueId()` already") and hands in a plain
 * boolean. In practice this makes `warmRelaunch` true for nearly every call
 * `navigateTo()` makes after the very first post-sign-in landing (by then a
 * league id is already remembered) — so with `SINGLE_LEAGUE_ROUTE:'home'`, a
 * single-membership account sees Leagues Home flash exactly ONCE, right
 * after a cold sign-in with nothing remembered yet, and fast-paths straight
 * to the six-tab shell on every call after that.
 *
 * ── DI-314 AMENDMENT (reviewer gate 1, 2026-09-25) — NO SPORT EMOJI ────────
 * Sport-card glyphs now come from the injected `icon('sportFootball')`
 * (group E's icon family), never a hard-coded emoji map. When `icon` is not
 * injected, the sport card falls back to TEXT ONLY — no glyph at all, never
 * an emoji substitute. This amends DI-314's original "AD-21 emoji rule
 * applies" note; the sport card is chrome-adjacent enough that T-09's icon
 * family reaches it immediately rather than waiting for a later phase.
 */

import { ESPN_SPORT_ENDPOINTS } from './data-model.js';

// ═══════════════════════════════════════════════════════════════════════════
// §0 — THE ONE HELD DECISION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 'home' | 'skip' — the DI's §0 open question, RULED by Drew 2026-09-27
 * (DI-348, UN-306): "when I sign in from a different browser it immediately
 * jumps to this league without letting me choose the league or sport" — a
 * direct reversal of his 2026-09-25 ruling for option (b) 'skip', made once
 * he felt the actual behavior live rather than read the spec. 'home' means a
 * COLD sign-in (no remembered session/league on this device/browser) always
 * lands on Leagues Home first, even with exactly one membership; a WARM
 * relaunch (session + league already remembered) still fast-paths straight
 * to the six-tab shell, unchanged — see the WARM PREDICATE CONTRACT above.
 */
export const SINGLE_LEAGUE_ROUTE = 'home';

/**
 * The §0 table — the ONE place this rule is encoded (reviewer gate,
 * 2026-09-25: `resolvePostSignInRoute()` below now delegates here instead of
 * carrying its own copy, so the two can never disagree).
 *
 * For membership counts other than exactly 1, the answer is static
 * (`'landing'` / `'leagues-home'`) and `singleLeagueRoute`/`warmRelaunch` are
 * irrelevant. For exactly one membership:
 *   - `liveSportCount > 1` (future, Multi-Sport) → `'league-page'`, always —
 *     a real choice exists even for one league, never skipped.
 *   - `liveSportCount <= 1` and `singleLeagueRoute === 'skip'` → `'six-tab'`,
 *     always — the DI's own §0 recommendation, zero added screens ever.
 *   - `liveSportCount <= 1` and `singleLeagueRoute === 'home'` (today's
 *     default) → `'leagues-home'` when `warmRelaunch` is false (the account
 *     has no remembered session/league yet — the journey Drew described),
 *     `'six-tab'` when `warmRelaunch` is true (see the WARM PREDICATE
 *     CONTRACT in the file header — the caller derives this, not this
 *     function).
 *
 * `app.js`'s `navigateTo()` calls this on every repaint, not only the moment
 * after sign-in, so `warmRelaunch` must be recomputed by the caller on every
 * call (not cached from the first call) — see the contract note above.
 *
 * @returns {'landing'|'six-tab'|'league-page'|'leagues-home'}
 */
export function resolveLeagueEntryPath({
  membershipCount = 0,
  liveSportCount = 1,
  singleLeagueRoute = SINGLE_LEAGUE_ROUTE,
  warmRelaunch = false,
} = {}) {
  const count = Number(membershipCount) || 0;
  const sports = Number(liveSportCount) || 1;
  if (count === 0) return 'landing';        // DI-181a, unchanged, not this file's screen
  if (count > 1) return 'leagues-home';     // a real choice, always shown
  // count === 1
  if (sports > 1) return 'league-page';     // future cell — never skipped
  if (singleLeagueRoute === 'skip') return 'six-tab';
  return warmRelaunch ? 'six-tab' : 'leagues-home';
}

/**
 * The post-sign-in routing decision. Resolves the membership-count/
 * live-sport-count inputs `resolveLeagueEntryPath()` needs from the caller's
 * already-resolved membership list, and DELEGATES the actual tier decision
 * to it — this function never encodes the §0 table itself (see the "ONE
 * ROUTER" note in the file header). `memberships[0].liveSportCount` defaults
 * to 1 — true for every league today, per migration 0001's `sport_default
 * not null`. `lastLeagueId` is the remembered pointer from a prior session,
 * used only for the warm six-tab fast path's `leagueId`. `warmRelaunch` —
 * see the WARM PREDICATE CONTRACT above; the caller derives it, this
 * function does not. `singleLeagueRoute` defaults to the module constant and
 * exists as a parameter purely so the test suite can exercise BOTH branches
 * without reloading the module — production callers never pass it.
 *
 * @returns {{screen:'landing'|'leagues-home'|'league-page'|'six-tab', leagueId?:string}}
 */
export function resolvePostSignInRoute({
  memberships = [],
  lastLeagueId = null,
  warmRelaunch = false,
  singleLeagueRoute = SINGLE_LEAGUE_ROUTE,
} = {}) {
  const list = Array.isArray(memberships) ? memberships : [];
  const membershipCount = list.length;
  const only = list[0] || {};
  const liveSportCount = membershipCount === 1 ? (Number(only.liveSportCount) || 1) : 1;
  const screen = resolveLeagueEntryPath({ membershipCount, liveSportCount, singleLeagueRoute, warmRelaunch });

  if (membershipCount === 1 && screen === 'league-page') {
    return { screen, leagueId: only.leagueId };
  }
  if (membershipCount === 1 && screen === 'six-tab') {
    return { screen, leagueId: warmRelaunch ? (lastLeagueId || only.leagueId) : only.leagueId };
  }
  return { screen };
}

// ═══════════════════════════════════════════════════════════════════════════
// DI-312 — LEAGUES HOME
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The default `icon(name)` used when a caller does not inject group E's real
 * icon renderer. Named exactly `'chevronRight'` / `'chevronLeft'` /
 * `'sportFootball'` — the same camelCase keys `icons.js` uses, so a caller
 * can swap in the real renderer with no call-site changes.
 *
 * Chevrons: the literal characters app.js already uses for this (U+203A '›'
 * / U+2039 '‹', e.g. the picks-week nav button and the Training Report row)
 * rather than inventing a new glyph — "chevrons only" per the DI, and this
 * is the one case where the un-injected default still draws something.
 *
 * Everything else (today: `'sportFootball'`) returns '' — NEVER an emoji
 * substitute (reviewer gate 1, 2026-09-25, amending DI-314). A caller that
 * has not injected the real icon renderer gets the text label alone, not a
 * placeholder glyph.
 */
function defaultIcon(name) {
  if (name === 'chevronRight') return '›';
  if (name === 'chevronLeft') return '‹';
  return '';
}

function requireEscHtml(escHtml, fnName) {
  if (typeof escHtml !== 'function') {
    throw new TypeError(`${fnName}() requires an injected escHtml function (CONVENTIONS #12)`);
  }
  return escHtml;
}

/**
 * The ONE card component shared by Leagues Home (this DI) and the voluntary
 * reopen sheet (`showLeagueSelectorSheet()`, DI-184f "no second selector
 * implementation," extended by this DI to "no second card markup"). Layout
 * per the DI's mockup: name + Pilot badge on the top line, role badge +
 * chevron on the bottom line.
 *
 * `roleBadgeHTML(role, {leagueId})` is REQUIRED — see the module header for
 * why this file never reimplements it. `isPilotLeague(membership)` defaults
 * to "never a pilot" so the badge degrades gracefully (absent, never a
 * placeholder) until T-23's `leagues.pilot` ships and a caller injects the
 * real predicate.
 */
export function leagueCardHTML(membership, {
  activeLeagueId = null,
  isPilotLeague = () => false,
  escHtml,
  icon = defaultIcon,
  roleBadgeHTML,
} = {}) {
  requireEscHtml(escHtml, 'leagueCardHTML');
  if (typeof roleBadgeHTML !== 'function') {
    throw new TypeError('leagueCardHTML() requires an injected roleBadgeHTML(role, {leagueId}) function — reuse app.js\'s leagueRoleBadgeHTML() verbatim, never a second implementation');
  }
  const m = membership || {};
  const isPilot = !!isPilotLeague(m);
  const isActive = !!activeLeagueId && m.leagueId === activeLeagueId;
  const name = m.leagueName || m.leagueId || '';
  return `<button type="button" class="card league-card" data-action="switch-league" data-league-id="${escHtml(m.leagueId || '')}"${isActive ? ' aria-current="true"' : ''}>
      <div class="league-card-top">
        <span class="league-card-name">${escHtml(name)}</span>
        ${isPilot ? `<span class="badge badge-pilot">Pilot</span>` : ''}
      </div>
      <div class="league-card-bottom">
        ${roleBadgeHTML(m.role, { leagueId: m.leagueId })}
        <span class="league-card-chevron" aria-hidden="true">${icon('chevronRight')}</span>
      </div>
    </button>`;
}

/** How many skeleton placeholders `renderLeaguesHome({loading:true})` draws
 *  while memberships resolve — the touched-screen-audit recommendation
 *  (§7 of the DI): "2–3 skeleton .league-card placeholders." Feature-builder
 *  judgment call, self-certified per the DI's own note that this is a Polish-
 *  pass decision, not a mandate; wiring this in is app.js's call. */
export const LEAGUES_HOME_SKELETON_COUNT = 3;

function leaguesHomeSkeletonHTML() {
  return Array.from({ length: LEAGUES_HOME_SKELETON_COUNT }, () =>
    `<div class="card league-card league-card-skeleton" aria-hidden="true">
      <div class="league-card-skeleton-line league-card-skeleton-line-wide"></div>
      <div class="league-card-skeleton-line league-card-skeleton-line-narrow"></div>
    </div>`
  ).join('');
}

/**
 * DI-312's list wrapper. Per §0, this is meaningfully reached only when
 * `memberships.length > 1` — a 0- or 1-membership account is routed
 * elsewhere before this ever renders — but the function itself renders
 * defensively for any count rather than assuming the caller got routing
 * right, so a routing bug fails loud (a visibly wrong card count) instead of
 * throwing.
 */
/**
 * `showTitle` (REVIEWER ROUND 2 D2, RG-298, 2026-09-28) — the boot-time
 * full-page caller (`leagueSelectorHTML()`, js/app.js) IS the whole screen,
 * so its own "Your Leagues" `.admin-section-title` is the page's only
 * heading and stays on (default `true`, unchanged call shape for that
 * caller). The Leagues Home OVERLAY (`showLeaguesHomeOverlay()`, DI-418)
 * has its OWN nav-bar title reading "Your Leagues" one level up
 * (`.league-page-title`, mirroring League Page's own header) — rendering
 * this section title too duplicated the phrase twice in one screen.
 * `showTitle: false` suppresses ONLY this internal heading; the card list
 * itself (and the loading skeleton's own list) is unchanged either way.
 */
export function renderLeaguesHome({
  memberships = [],
  activeLeagueId = null,
  isPilotLeague = () => false,
  escHtml,
  icon = defaultIcon,
  roleBadgeHTML,
  loading = false,
  showTitle = true,
} = {}) {
  requireEscHtml(escHtml, 'renderLeaguesHome');
  const title = showTitle ? '<div class="admin-section-title">Your Leagues</div>' : '';
  if (loading) {
    return `${title}
      <div class="league-card-list" aria-busy="true">${leaguesHomeSkeletonHTML()}</div>`;
  }
  const list = Array.isArray(memberships) ? memberships : [];
  const cards = list.map(m => leagueCardHTML(m, { activeLeagueId, isPilotLeague, escHtml, icon, roleBadgeHTML })).join('');
  return `${title}
    <div class="league-card-list">
      ${cards}
      ${renderCreateLeagueStubCard({ escHtml, icon })}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DI-313 / DI-316 — THE SHARED "NOT RELEASED YET" STUB PATTERN
// ═══════════════════════════════════════════════════════════════════════════

/** One toast-copy template, per the DI's §2 "Shared stub pattern for other
 *  groups": `"{Feature} isn't available yet — {reassurance}."`. Exported so
 *  T-13k's Help Center stub (or any future stub) reuses this instead of
 *  writing a third copy of the string. */
export function comingSoonCopy(feature, reassurance = "it's coming in a future update.") {
  return `${feature} isn't available yet — ${reassurance}`;
}

/** The two exact copy strings this DI's stubs use, built from the template
 *  above so both are provably instances of the one pattern rather than two
 *  independently-typed literals that could drift apart. */
export const COMING_SOON_COPY = Object.freeze({
  createLeague: comingSoonCopy('Creating additional leagues'),
  addSport: comingSoonCopy('Adding additional sports'),
});

/**
 * A card that reads like any other tappable card (DI: "a real, tappable card
 * that explains itself on tap, not a dead control" — never grayed out). It
 * carries its toast copy as a data attribute (`data-coming-soon-copy`) rather
 * than binding a listener itself — this module does no DOM binding anywhere;
 * app.js's wiring pass delegates clicks on `[data-action="coming-soon"]` to
 * `showComingSoonToast(el.dataset.comingSoonCopy)`, which is how EVERY stub
 * card in the app is required to route (never a bespoke inline toast call).
 */
export function renderComingSoonCard({ title, subtitle = '', copy, escHtml, extraClass = '' } = {}) {
  requireEscHtml(escHtml, 'renderComingSoonCard');
  if (!copy) throw new TypeError('renderComingSoonCard() requires copy — the toast text a tap must show');
  const cls = extraClass ? `coming-soon-card ${extraClass}` : 'coming-soon-card';
  return `<button type="button" class="card ${cls}" data-action="coming-soon" data-coming-soon-copy="${escHtml(copy)}">
      <span class="coming-soon-card-title">${escHtml(title)}</span>
      ${subtitle ? `<span class="coming-soon-card-subtitle text-muted">${escHtml(subtitle)}</span>` : ''}
    </button>`;
}

/** DI-313 — always the last card in Leagues Home's list. */
export function renderCreateLeagueStubCard({ escHtml } = {}) {
  return renderComingSoonCard({
    title: '+ Create new league',
    copy: COMING_SOON_COPY.createLeague,
    escHtml,
    extraClass: 'create-league-card',
  });
}

/** DI-316 — commissioner-only; the caller decides visibility (`isCommissioner`
 *  in `renderLeaguePage()`) and simply does not call this when false, per the
 *  DI's "absent entirely, not disabled" rule. */
export function renderAddSportStubCard({ escHtml } = {}) {
  return renderComingSoonCard({
    title: '+ Add new sport',
    copy: COMING_SOON_COPY.addSport,
    escHtml,
    extraClass: 'add-sport-card',
  });
}

/**
 * DI-313/DI-316's shared dispatcher factory. Production wiring calls
 * `makeShowComingSoonToast(showToast)` ONCE (app.js's real `showToast`,
 * `type:'info'` — the new toast variant this DI adds) and binds the returned
 * function to every `[data-action="coming-soon"]` tap, app-wide, so no stub
 * anywhere ever hand-writes its own toast call.
 */
export function makeShowComingSoonToast(showToastFn) {
  if (typeof showToastFn !== 'function') {
    throw new TypeError('makeShowComingSoonToast(showToastFn) requires the real showToast function');
  }
  return function showComingSoonToast(copy) {
    showToastFn(copy, 'info');
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DI-314 — LEAGUE PAGE + SPORT CARDS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The sport-card list for League Page, derived from `leagues.sport_default`
 * plus whatever `weeks.sport` values actually exist for the league —
 * DI-314's explicit instruction, and the reason this reads
 * `ESPN_SPORT_ENDPOINTS` (data-model.js) for labels instead of a second
 * hard-coded sport-name literal. Deduped; always at least one entry (today,
 * always `college-football`, matching migration 0001's `not null default`).
 */
// STEP B(13) (3c fix window, third pass) — the DATABASE spells sports with
// short codes (`leagues.sport_default` / `weeks.sport`: not null default
// 'cfb', migration 0001) while ESPN_SPORT_ENDPOINTS is keyed by ESPN's path
// segment ('college-football'). Without this map a real league's 'cfb' would
// render a second, unlabeled "cfb" card beside "College Football". Unknown
// codes pass through unchanged (their label falls back to the raw key, as
// before) rather than being dropped.
const DB_SPORT_TO_ESPN_KEY = Object.freeze({ cfb: 'college-football', nfl: 'nfl' });
// DI-417 (UN-372, 2026-09-28) — EXPORTED. The header league pill needs the
// exact same db-code -> ESPN-key normalization (`getCurrentWeek()?.sport`
// carries the short DB code, e.g. 'cfb') so it can look up
// ESPN_SPORT_ENDPOINTS by the same key deriveLeagueSports() already does.
// One normalization implementation, not a second one in js/app.js.
export function normalizeSportKey(k) {
  const s = typeof k === 'string' ? k.trim() : '';
  return s ? (DB_SPORT_TO_ESPN_KEY[s] || s) : '';
}

export function deriveLeagueSports({ sportDefault = 'college-football', weekSports = [] } = {}) {
  const keys = new Set();
  const d = normalizeSportKey(sportDefault);
  if (d) keys.add(d);
  for (const s of (Array.isArray(weekSports) ? weekSports : [])) {
    const k = normalizeSportKey(s);
    if (k) keys.add(k);
  }
  if (keys.size === 0) keys.add('college-football');
  return [...keys].map(key => ({
    key,
    label: ESPN_SPORT_ENDPOINTS[key]?.label || key,
  }));
}

/** DI-314's PARITY-BY-DESIGN pair for League Page's back navigation: native
 *  gets BOTH the visible back control and swipe-back; web gets only the
 *  visible control (no competing gesture — Interaction Principles' "Avoid
 *  creating competing gestures"). Returns which affordances to wire, never a
 *  navigation TARGET — the navigation stack itself belongs to app.js's
 *  existing overlay+inert mechanism (`app.js:19928`), not this module. */
export function leaguePageBackAffordances({ isNativeShell = false } = {}) {
  return { backButton: true, swipeBack: !!isNativeShell };
}

/**
 * League Page (DI-314). `isCommissioner` is the caller's already-resolved
 * `getSession().isAdmin` (this module never reads a raw session object —
 * see the file header). `hasSportChoice` is accepted for forward
 * compatibility with Multi-Sport's own routing question but is NOT used to
 * gate what renders here: League Page always lists every sport `sports`
 * names, one source of truth (`sports.length` already tells a caller whether
 * a real choice exists; duplicating that as a second boolean this function
 * trusts would be exactly the kind of drift CONVENTIONS #21 warns against).
 */
export function renderLeaguePage(league, {
  isCommissioner = false,
  hasSportChoice = null, // eslint-disable-line no-unused-vars -- accepted, not required; see doc comment
  sports = null,
  escHtml,
  icon = defaultIcon,
} = {}) {
  requireEscHtml(escHtml, 'renderLeaguePage');
  const lg = league || {};
  const sportList = Array.isArray(sports) && sports.length ? sports : deriveLeagueSports({});
  const sportCards = sportList.map(s => {
    // HARD GATE (reviewer, 2026-09-25) — no emoji, no hard-coded glyph map.
    // The glyph comes ONLY from the injected icon family; a caller that has
    // not injected one renders TEXT ONLY (defaultIcon('sportFootball') is
    // '' — see its doc comment), never an emoji substitute.
    const glyph = icon('sportFootball');
    return `<button type="button" class="card sport-card" data-action="open-sport" data-league-id="${escHtml(lg.leagueId || '')}" data-sport="${escHtml(s.key)}">
      <span class="sport-card-label">${glyph ? `<span class="sport-card-icon" aria-hidden="true">${glyph}</span> ` : ''}${escHtml(s.label)}</span>
      <span class="sport-card-chevron" aria-hidden="true">${icon('chevronRight')}</span>
    </button>`;
  }).join('');
  return `<div class="league-page-header">
      <button type="button" class="league-page-back" data-action="league-page-back" aria-label="Back">${icon('chevronLeft')}</button>
      <h2 class="league-page-title">${escHtml(lg.leagueName || lg.name || '')}</h2>
    </div>
    <div class="league-page-body">
      <div class="admin-section-title">Sports</div>
      ${sportCards}
      <button type="button" class="league-standings-row" data-action="open-league-standings" data-league-id="${escHtml(lg.leagueId || '')}">
        <span>League Standings</span>
        <span aria-hidden="true">${icon('chevronRight')}</span>
      </button>
      ${isCommissioner ? renderAddSportStubCard({ escHtml }) : ''}
    </div>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DI-315 — LEAGUE STANDINGS ENTRY + SINGLE-SPORT VIEW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns `'Across College Football'` today, always — the honest,
 * single-sport form. `weeks` is whatever week list the caller already used
 * to build `standingsRows` (i.e. `seasonStandingsRows()`'s own inputs), read
 * here ONLY for its `sport` field, never re-fetched. The >1-distinct-sport
 * branch is the named seam Multi-Sport's roll-up (`weeksForStandings()`)
 * extends later — deferred, dated 2026-09-24, not built here (DI §4/§8).
 */
export function leagueStandingsScopeLabel(weeks) {
  const list = Array.isArray(weeks) ? weeks : [];
  const sportKeys = new Set(list.map(w => w?.sport || 'college-football').filter(Boolean));
  if (sportKeys.size > 1) {
    // Multi-Sport's territory (§8) — this DI does not compute a real
    // roll-up; the label exists so the seam is named, not so this branch is
    // reachable in production today (every league has one sport).
    return 'Across all sports';
  }
  const [only] = sportKeys.size ? [...sportKeys] : ['college-football'];
  const label = ESPN_SPORT_ENDPOINTS[only]?.label || 'College Football';
  return `Across ${label}`;
}

/**
 * Header row for the standings list — printed ONCE, not per-row (reviewer
 * gate 5, 2026-09-25). CLAUDE.md's Architecture bullet 5 / CONVENTIONS #22:
 * the record is the WEIGHTED tally (`correctPicks`/`incorrectPicks` —
 * `game.multiplier` applied, drives rank) and the percentage is the RAW win%
 * (`correctCount`/`incorrectCount` — never multiplied). Adjacent and
 * unlabeled, a reader could assume the percentage is derived from the
 * adjacent record; it is not always (a multiplier week can make them
 * diverge). Labeled explicitly so the two tallies are never conflated.
 */
const LEAGUE_STANDINGS_HEADER_HTML = `<div class="league-standings-row-item league-standings-header" aria-hidden="true">
      <span class="league-standings-rank"></span>
      <span class="league-standings-name">Player</span>
      <span class="league-standings-record">W-L (wtd)</span>
      <span class="league-standings-pct">Win % (raw)</span>
    </div>`;

function leagueStandingsRowHTML(row, escHtml) {
  const r = row || {};
  const correct = Number(r.totalCorrect) || 0;
  const incorrect = Number(r.totalIncorrect) || 0;
  // Reviewer gate 5 (2026-09-25) — formatted EXACTLY as the Standings tab
  // itself does (`js/app.js:9836`: `${s.winPct}%`), never a forced decimal.
  // `winPct` already carries calculateSeasonStandings()'s own rounding
  // (Math.round(...*1000)/10); re-formatting it here would be a second,
  // possibly-diverging opinion of the same number.
  const pct = Number.isFinite(r.winPct) ? r.winPct : 0;
  return `<div class="league-standings-row-item">
      <span class="league-standings-rank">${escHtml(String(r.currentRank ?? ''))}.</span>
      <span class="league-standings-name">${escHtml(r.displayName || '')}</span>
      <span class="league-standings-record" aria-label="Weighted record">${escHtml(`${correct}-${incorrect}`)}</span>
      <span class="league-standings-pct" aria-label="Raw win percentage">${escHtml(`${pct}%`)}</span>
    </div>`;
}

/**
 * The single-sport League Standings view. `standingsRows` MUST be the exact
 * output of `calculateSeasonStandings()`/`seasonStandingsRows()` — this
 * function performs NO ranking, filtering or aggregation of its own (DI's
 * explicit rule: "not a reimplementation... two independent renderers of the
 * same ranking is exactly the class of defect CLAUDE.md's Architecture
 * bullet 5 exists to prevent"). Rows are read-only — no per-player
 * drill-down, matching today's Standings tab.
 *
 * `weeks` MUST be the SAME filtered list `renderLeaderboard()` uses to build
 * `standingsRows` in the first place (`js/app.js`'s own `visibleWeekIds`:
 * `showInHistory !== false && dataSourceMode !== 'demo'`, further narrowed
 * to weeks that actually have a `getWeeklyResults()` row) — never the raw
 * `getWeeks()` output. Passing the unfiltered list would let a draft or demo
 * week make this view claim results exist when the Standings tab shows none
 * (or vice versa) — the empty-state gate below trusts `weeks.length` alone,
 * so the caller's filtering IS the correctness boundary here.
 */
export function renderLeagueStandingsView({ standingsRows = [], weeks = [], escHtml, icon = defaultIcon } = {}) {
  requireEscHtml(escHtml, 'renderLeagueStandingsView');
  const rows = Array.isArray(standingsRows) ? standingsRows : [];
  const weekList = Array.isArray(weeks) ? weeks : [];
  const hasResults = weekList.length > 0;
  const body = hasResults
    ? `<div class="league-standings-scope text-muted">${escHtml(leagueStandingsScopeLabel(weekList))}</div>
       <div class="league-standings-list">${LEAGUE_STANDINGS_HEADER_HTML}${rows.map(r => leagueStandingsRowHTML(r, escHtml)).join('')}</div>`
    : `<div class="empty-state">
         <p>No results yet. Standings will appear once your league's first week is scored.</p>
       </div>`;
  return `<div class="league-page-header">
      <button type="button" class="league-page-back" data-action="league-standings-back" aria-label="Back">${icon('chevronLeft')}</button>
      <h2 class="league-page-title">League Standings</h2>
    </div>
    <div class="league-page-body">${body}</div>`;
}
