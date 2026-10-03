/**
 * js/league-create.js — THE NEW LEAGUE FLOW (N1, DI-430, UN-310 / UN-311, 2026-09-30)
 * ============================================================================
 * The approved mockup is `docs/mockups/league-create.html`; the design input is DI-430 in `docs/DESIGN_INPUTS_LEAGUE_CREATION.md`
 * (Revision 3). This module is PURE: data in, HTML strings or plain decision objects out. It touches no DOM, no network and no
 * storage EXCEPT the one device-local key it owns (`cfbp_pending_join`, below), and it imports nothing from app.js or auth.js —
 * the same shape as js/leagues-home.js and js/brand.js, and for the same reason: everything in it is testable in
 * `leaguecreatetest.mjs` without booting the app, and `escHtml` is a REQUIRED injected dependency (CONVENTIONS #12), so a caller
 * that forgets it fails LOUDLY instead of rendering a league name unescaped.
 *
 * WHAT LIVES HERE
 *   1. the copy (every string the flow shows, in one frozen table, so the mockup's words are asserted once);
 *   2. the invite CODE helpers (normalize / format / link / share message) — a league is invited by code and link, NEVER by e-mail
 *      (F1: e-mail auto-link is pilot-only since migration 0032);
 *   3. `cfbp_pending_join` — a public 8-character code with a 30-minute expiry, captured from `?join=CODE` at boot and kept ACROSS the
 *      Google sign-in round trip (the OAuth `redirectTo` is origin-only; the code NEVER enters it). Read and written by THIS module
 *      directly (the `cfbp_auth_mode_last_known` precedent), listed in storage.js's inventory comment, and in auth.js's
 *      `_CLEAR_KEEP_KEYS` because the first-sign-in sweep would otherwise erase it mid-invite. It never auto-joins: joining creates a
 *      membership, so it takes one visible tap;
 *   4. the sports picker's data (offered ∩ registered, grouped) and the step STATE MACHINE (`reduce`);
 *   5. the renderers for every frame of the mockup (name, sports, created, invite, the states, the discard sheet) and the
 *      zero-membership landing's segmented control and invite card;
 *   6. the error mapping (`createErrorKind`) that turns the server's named refusals into the mockup's three failure looks.
 *
 * ── THE ONE SERVER CALL ───────────────────────────────────────────────────────────────────────────────────────────────────────
 * Nothing is created client-side: `createLeague(name, sports)` (auth.js) is one `create_league` RPC. So "Nothing was saved" in the
 * failure banner is a true statement, and a retry after a real failure is safe. If the RPC succeeded and only the membership
 * refresh failed, auth.js throws `LeagueCreatedNotLoadedError` and the flow says the league EXISTS (frame 13) — it never retries,
 * because a second create would spend a second allowance.
 */

import {
  NEW_LEAGUE_NAME_MAX, NEW_LEAGUE_MAX_SPORTS, NEW_LEAGUE_SPORT_KINDS, NEW_LEAGUE_DEFAULTS, newLeagueOnRows,
} from './league-defaults.js';

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 1. COPY — one frozen table
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The league-name cap (the server's own `check (length(name) between 1 and 80)`), re-exported so the DOM layer never types the number a second time. */
export const NAME_MAX = NEW_LEAGUE_NAME_MAX;

export const LC_COPY = Object.freeze({
  // the sheet
  title: 'New League',
  cancel: 'Cancel',
  next: 'Next',
  back: 'Name',
  close: 'Close',
  done: 'Done',
  // name step
  nameLabel: 'League name',
  namePlaceholder: 'e.g. Saturday Crew',
  nameHelper: 'Your friends will see this name. You can change it later.',   // SP-53 / DI-458 (2026-10-01, Q9 agreed with Multi-Sport): the promise is restored WITH the rename UI (League Settings). It is a PROMISE: this string ships in the SAME release as the rename RPC, never before (the 2026-09-30 coordinator ruling softened it to "Your friends will see this name." while no rename existed)
  clearName: 'Clear name',
  // sports step
  sportsTitle: 'Sports',
  seasons: 'Seasons',
  tournaments: 'Tournaments',
  sportsHelper: 'Pick at least one season. Tournaments are optional. You can add more any time from your league page.',
  main: 'Main',
  create: 'Create League',
  creating: 'Creating…',
  stillWorking: 'Still working…',
  tryAgain: 'Try Again',
  retrying: 'Trying…',
  // states
  failed: "Couldn't create the league. Nothing was saved — check your connection and try again.",
  limit: "You've reached the limit for new leagues right now. Try again tomorrow.",
  paused: "New leagues aren't being created right now — check back soon.",
  invalidLink: 'That invite link has expired. Ask whoever invited you to send it again.',
  // created step
  createdTitle: 'Created',
  commissionerLine: "You're the commissioner.",
  onHeading: 'Already on for your league',
  onHelper: 'Change any of this later in Comm.',
  inviteFriends: 'Invite Friends',
  notNow: 'Not Now',
  // invite step
  inviteTitle: 'Invite Friends',
  leagueCode: 'League code',
  copyCode: 'Copy Code',
  codeCopied: 'Code copied',
  shareInvite: 'Share Invite',
  linkCopied: 'Invite link copied',
  inviteHelper: 'Friends open Munera, tap Join a League, and enter this code. Anyone with the code can join. You can change it any time in Comm.',
  // discard
  discardTitle: 'Discard new league?',
  discard: 'Discard',
  keepEditing: 'Keep Editing',
  // the two entry points
  entryLabel: 'Create new league',
  landingClosed: "Creating leagues isn't available yet — it's coming in a future update.",
  // the zero-membership landing (S-9)
  createChoice: 'Create a league',
  segClaim: 'I have a claim code',
  segInvite: 'I have an invite code',
  inviteLinkNote: 'You opened an invite link. Check the code, then tap Join League.',
  claimInstead: 'I have a claim code instead',
  inviteCodeLabel: 'Invitation code',
  inviteCodePlaceholder: 'e.g. K7QX 9M2P',
});

export const readyTitle = (name) => `${name} is ready`;
// R-F4 (reviewer, 2026-09-30) — frame 13 used to end "Pull down to refresh.", which does nothing while the Leagues Home overlay is up (pull-to-refresh is suspended under it).
// The recovery is now a visible Try Again button (the Interaction Principles' error-state pattern: what happened, and a way to retry it), so the copy stops at the fact.
export const refreshFailedCopy = (name) => `${name} was created, but this device couldn't load it.`;
/** The stub toast's copy when the gate is closed on the LANDING card — the same words `comingSoonCopy('Creating leagues')` builds. */
export const landingClosedCopy = () => LC_COPY.landingClosed;

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 2. INVITE CODE HELPERS
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** `leagues.join_code` is `^[A-Z2-9]{8}$` (0001): eight characters from A-Z and 2-9 (no 0 or 1) — the alphabet is the server CHECK's own, never a client guess. */
export const JOIN_CODE_RE = /^[A-Z2-9]{8}$/;
/** The web app's own address — the link is always this origin, never `location.origin` (the native shell's origin is `capacitor://localhost`, which opens nothing for a friend). */
export const INVITE_ORIGIN = 'https://irbfootball.com';

/**
 * Anything a person might type or paste → the one canonical 8-character code, or ''.
 * `K7QX 9M2P`, `k7qx-9m2p` and `K7QX9M2P` all yield `K7QX9M2P`; a wrong-shaped value yields ''. The server still decides whether the code is real.
 */
export function normalizeInviteCode(raw) {
  const s = String(raw == null ? '' : raw).toUpperCase().replace(/[\s-]+/g, '');
  return JOIN_CODE_RE.test(s) ? s : '';
}
/** `K7QX9M2P` → `K7QX 9M2P` (two groups of four, for reading aloud). Anything not a code is returned as given. */
export function formatInviteCode(code) {
  const c = normalizeInviteCode(code);
  return c ? `${c.slice(0, 4)} ${c.slice(4)}` : String(code == null ? '' : code);
}
/** The invite link: `https://irbfootball.com/?join=CODE`. '' for a value that is not a code. */
export function inviteLink(code) {
  const c = normalizeInviteCode(code);
  return c ? `${INVITE_ORIGIN}/?join=${c}` : '';
}
/** The share message: carries the league name, the link AND the code (a friend on a phone with no app installed still has something to read out). */
export function inviteMessage({ leagueName, code } = {}) {
  const c = normalizeInviteCode(code);
  const name = String(leagueName || '').trim() || 'my league';
  return c ? `Join ${name} on Munera: ${inviteLink(c)} — or enter the code ${formatInviteCode(c)}` : '';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 3. cfbp_pending_join — the invite that survives sign-in
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const PENDING_JOIN_KEY = 'cfbp_pending_join';
export const PENDING_JOIN_TTL_MS = 30 * 60 * 1000;

function store(storage) {
  try { return storage || (typeof localStorage !== 'undefined' ? localStorage : null); } catch { return null; }
}
function writeRaw(storage, value) {
  try { const s = store(storage); if (s) s.setItem(PENDING_JOIN_KEY, JSON.stringify(value)); return !!s; } catch { return false; }
}
function readRaw(storage) {
  try { const s = store(storage); return s ? s.getItem(PENDING_JOIN_KEY) : null; } catch { return null; }
}
/** Remove the key. Never throws. */
export function clearPendingJoin({ storage } = {}) {
  try { const s = store(storage); if (s) s.removeItem(PENDING_JOIN_KEY); } catch { /* a stuck key expires on its own */ }
}

/**
 * AT BOOT — capture `?join=CODE`. The value is upper-cased and validated against `^[A-Z2-9]{8}$`; a good one is stored as `{code, exp}` (TTL 30 minutes), a
 * malformed one is stored as `{bad:true, exp}` so the visitor is TOLD (an expired or malformed link is loud, never silent) but never gets a usable code out of a forged
 * value. THE URL IS SCRUBBED either way — only the `join` parameter, every other parameter survives — and the scrub happens AFTER the value is persisted, so a reload
 * between the two cannot lose it. Nothing here calls the network or the auth layer; it may run before the site gate, before config, before sign-in.
 *
 * @param {{ href?: string, replaceState?: (url: string) => void, now?: number, storage?: object }} [opts]
 * @returns {{ state: 'none'|'stored'|'malformed', code: string }}
 */
export function capturePendingJoin({ href, replaceState, now = Date.now(), storage } = {}) {
  let url;
  try {
    const h = href != null ? href : (typeof location !== 'undefined' ? location.href : '');
    url = new URL(h, INVITE_ORIGIN);
  } catch { return { state: 'none', code: '' }; }
  if (!url.searchParams.has('join')) return { state: 'none', code: '' };
  const raw = url.searchParams.get('join');
  const code = normalizeInviteCode(raw);
  const exp = now + PENDING_JOIN_TTL_MS;
  const persisted = writeRaw(storage, code ? { code, exp } : { bad: true, exp });
  // Scrub the param (only that one) — AFTER the write. If nothing could be persisted the URL is still scrubbed: a bookmarkable link must not keep re-triggering.
  try {
    url.searchParams.delete('join');
    const rest = url.searchParams.toString();
    const clean = url.pathname + (rest ? `?${rest}` : '') + (url.hash || '');
    const fn = replaceState || (typeof history !== 'undefined' && history.replaceState ? (u) => history.replaceState(history.state ?? null, '', u) : null);
    if (fn) fn(clean);
  } catch { /* the capture stands; the scrub is cosmetic */ }
  void persisted;
  return { state: code ? 'stored' : 'malformed', code };
}

/**
 * Read the pending invite WITHOUT consuming it. `state`:
 *   'none'       nothing waiting;
 *   'valid'      a well-formed, unexpired code (returned as `code`);
 *   'expired'    older than 30 minutes — the key is REMOVED and the caller shows LC_COPY.invalidLink;
 *   'malformed'  unparseable, forged or captured from a bad `?join=` — the key is REMOVED and the caller shows the same message.
 */
export function readPendingJoin({ now = Date.now(), storage } = {}) {
  const raw = readRaw(storage);
  if (raw == null) return { state: 'none', code: '' };
  let v = null;
  try { v = JSON.parse(raw); } catch { v = null; }
  if (!v || typeof v !== 'object') { clearPendingJoin({ storage }); return { state: 'malformed', code: '' }; }
  if (!Number.isFinite(v.exp)) { clearPendingJoin({ storage }); return { state: 'malformed', code: '' }; }
  if (v.exp <= now) { clearPendingJoin({ storage }); return { state: 'expired', code: '' }; }
  if (v.bad === true) { clearPendingJoin({ storage }); return { state: 'malformed', code: '' }; }
  const code = normalizeInviteCode(v.code);
  if (!code || v.code !== code) { clearPendingJoin({ storage }); return { state: 'malformed', code: '' }; }
  return { state: 'valid', code };
}

/**
 * CONSUME once: read, and remove the key in the same call. A valid result is handed to the caller exactly once (memberships loaded → the Join form opens prefilled);
 * a second call answers `none`. Expired/malformed are removed by readPendingJoin() and reported here once, so the loud message is shown once.
 */
export function takePendingJoin(opts = {}) {
  const r = readPendingJoin(opts);
  if (r.state === 'valid') clearPendingJoin(opts);
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 4. THE SPORTS PICKER AND THE STEP STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The icon-family key for each R1 code's picker row (mockup frame 3: football, ball, puck, cup). A code with no entry falls back to the football glyph. */
export const SPORT_GLYPH = Object.freeze({
  cfb: 'sportFootball', nfl: 'sportFootball', nba: 'sportBasketball', cbb: 'sportBasketball', nhl: 'sportHockey', mm: 'trophy', wjc: 'trophy',
});

/**
 * The picker's rows: `listProfiles()` ∩ `platform_kv.offered_sports`, grouped by NEW_LEAGUE_SPORT_KINDS, in that table's order. A sport appears only when it is BOTH a
 * registered profile AND offered; there are no "coming soon" rows, and a group with nothing in it is absent (so no Tournaments section renders while none is offered).
 *
 * @param {{ profiles: Array<{key:string,label:string,glyphKey?:string}>, offered: string[] }} args
 * @returns {{ season: Array<{key,label,glyphKey}>, tournament: Array<{key,label,glyphKey}> }}
 */
export function pickerGroups({ profiles = [], offered = [] } = {}) {
  const byKey = new Map((Array.isArray(profiles) ? profiles : []).map((p) => [p && p.key, p]));
  const on = new Set(Array.isArray(offered) ? offered : []);
  const pick = (codes) => codes
    .filter((c) => on.has(c) && byKey.has(c))
    .map((c) => { const p = byKey.get(c); return { key: c, label: String(p.label || c), glyphKey: SPORT_GLYPH[c] || 'sportFootball' }; });
  return { season: pick(NEW_LEAGUE_SPORT_KINDS.season), tournament: pick(NEW_LEAGUE_SPORT_KINDS.tournament) };
}

/** True when the string has at least one non-space character. A name of only spaces is NOT a name (Next stays dimmed; no red text). */
export function nameValid(name) { return String(name == null ? '' : name).trim().length > 0; }

/**
 * The initial state of the sheet. `phase` is the banner/interaction phase, orthogonal to `step`:
 *   'idle' · 'creating' · 'failed' · 'limit' · 'paused' · 'refresh_failed'
 * `signupsOpen:false` starts in 'paused' (frame 10): the field and Next are disabled and the paused copy shows. `seasonKeys` is the set of season codes in the picker,
 * so Main (the first ticked SEASON) can be derived without a second table.
 */
export function createInitialState({ signupsOpen = true, groups = { season: [], tournament: [] } } = {}) {
  return {
    step: 'name',
    name: '',
    ticked: [],
    seasonKeys: (groups.season || []).map((s) => s.key),
    phase: signupsOpen === false ? 'paused' : 'idle',
    slow: false,
    discardPrompt: false,
    created: null,          // { leagueId, name, code } once the server answered
  };
}

/**
 * The sheet opened straight on the Invite step — "Invite Friends" from the League Page's empty state (frame 6) for a league that ALREADY exists. Same step, same markup,
 * same Copy Code / Share Invite; `created` carries the league's id, name and (once read) its join code, so the step needs no second implementation.
 */
export function createInviteState({ leagueId = '', name = '', code = '' } = {}) {
  return { step: 'invite', name: String(name || ''), ticked: [], seasonKeys: [], phase: 'idle', slow: false, discardPrompt: false,
    created: { leagueId: String(leagueId || ''), name: String(name || ''), code: String(code || '') } };
}

/** Main = the first ticked SEASON in tick order (the server's rule: `create_league` takes the first season in the list). '' when none. */
export function mainSport(state) {
  const seasons = new Set(state.seasonKeys || []);
  return (state.ticked || []).find((k) => seasons.has(k)) || '';
}
/** Create is enabled only with at least one ticked SEASON (S-3: a tournament-only league is refused in v1) and while not busy or paused. */
export function canCreate(state) {
  return !!mainSport(state) && state.phase !== 'creating' && state.phase !== 'paused' && state.phase !== 'limit';
}
/** Next (name → sports) needs a real name and an open door. */
export function canAdvance(state) {
  return nameValid(state.name) && state.phase !== 'paused';
}
/** The ordered list `create_league` receives — tick order, capped at NEW_LEAGUE_MAX_SPORTS. */
export function sportsPayload(state) {
  return (state.ticked || []).slice(0, NEW_LEAGUE_MAX_SPORTS);
}
/** Input worth asking about on Cancel / swipe-down: a typed name (any character) or a ticked sport. Nothing entered ⇒ dismiss immediately. */
export function hasInput(state) {
  return String(state.name || '').length > 0 || (state.ticked || []).length > 0;
}
/** Is the sheet mid-create (Back, swipe-dismiss, Esc and the backdrop are all OFF)? */
export function isBusy(state) { return state.phase === 'creating'; }
/** Can the user dismiss right now (no discard prompt needed)? Not while creating; not after the league exists. */
export function dismissMode(state) {
  if (state.phase === 'creating') return 'blocked';
  if (state.created) return 'close';                 // the league exists: closing is a plain close, never a discard
  return hasInput(state) ? 'confirm' : 'close';
}

/**
 * The reducer. Pure; unknown actions return the state unchanged.
 *   {type:'name', value}      typing (capped at 80 characters — the server limit — so no length error is ever needed)
 *   {type:'next'}             name → sports, only when canAdvance()
 *   {type:'back'}             sports → name, never while creating
 *   {type:'toggle', key}      tick / untick a sport; ticking beyond 7 is ignored; Main follows the tick order
 *   {type:'creating'}         the call is in flight: rows dim, Back off, swipe-dismiss off
 *   {type:'slow'}             past 8 seconds: the button says "Still working…"
 *   {type:'failed'}           red persistent banner; input and ticks kept
 *   {type:'limit'}            gold banner; the primary becomes Done
 *   {type:'paused'}           the emergency valve: field and Next disabled
 *   {type:'created', created} success: the Created screen
 *   {type:'refreshFailed', created}  the server made it, this device could not load it
 *   {type:'code', code}       the league's join code arrived (read after creation, or on "Invite Friends" from the League Page)
 *   {type:'invite'}           Created → Invite
 *   {type:'askDiscard'} / {type:'keepEditing'}
 */
export function reduce(state, action) {
  const a = action || {};
  switch (a.type) {
    case 'name': {
      const value = String(a.value == null ? '' : a.value).slice(0, NEW_LEAGUE_NAME_MAX);
      return { ...state, name: value };
    }
    case 'next':
      return state.step === 'name' && canAdvance(state) ? { ...state, step: 'sports', phase: state.phase === 'failed' || state.phase === 'limit' ? 'idle' : state.phase } : state;
    case 'back':
      return state.step === 'sports' && !isBusy(state) ? { ...state, step: 'name', phase: state.phase === 'failed' ? 'idle' : state.phase } : state;
    case 'toggle': {
      if (isBusy(state) || state.step !== 'sports') return state;
      const key = String(a.key || '');
      const has = state.ticked.includes(key);
      if (has) return { ...state, ticked: state.ticked.filter((k) => k !== key) };
      if (state.ticked.length >= NEW_LEAGUE_MAX_SPORTS) return state;
      return { ...state, ticked: [...state.ticked, key] };
    }
    case 'creating': return { ...state, phase: 'creating', slow: false, discardPrompt: false };
    case 'slow': return state.phase === 'creating' ? { ...state, slow: true } : state;
    case 'failed': return { ...state, phase: 'failed', slow: false };
    case 'limit': return { ...state, phase: 'limit', slow: false };
    // The emergency valve can close between "Next" and "Create" (the server is the authority); the sheet returns to the name step, where frame 10 lives.
    case 'paused': return { ...state, step: 'name', phase: 'paused', slow: false };
    case 'code': return state.created ? { ...state, created: { ...state.created, code: String(a.code || '') } } : state;
    case 'created': return { ...state, step: 'created', phase: 'idle', slow: false, created: a.created || null, discardPrompt: false };
    case 'refreshFailed': return { ...state, phase: 'refresh_failed', slow: false, created: a.created || null };
    case 'invite': return state.created ? { ...state, step: 'invite' } : state;
    case 'askDiscard': return dismissMode(state) === 'confirm' ? { ...state, discardPrompt: true } : state;
    case 'keepEditing': return { ...state, discardPrompt: false };
    default: return state;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 5. ERRORS
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * Turn a create failure into one of the mockup's looks: 'paused' (frame 10: the emergency valve / the release gate), 'limit' (frame 9: gold banner, one copy for all
 * three server limits so no cap is disclosed), 'created_not_loaded' (frame 13) or 'failed' (frame 8: red, persistent, retry). Matching is by the server's own snake_case
 * words in `error.message`, against a fixed table, never against free text — an unrecognised message is 'failed', never something reassuring.
 */
export function createErrorKind(err) {
  if (err && (err.name === 'LeagueCreatedNotLoadedError' || err.code === 'league_created_not_loaded')) return 'created_not_loaded';
  const raw = `${(err && err.message) || ''} ${(err && err.code) || ''}`;
  if (/creation_closed|signups_closed/.test(raw)) return 'paused';
  if (/league_limit|creation_rate|creation_paused/.test(raw)) return 'limit';
  return 'failed';
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 6. RENDERERS — every frame of the mockup
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

function requireEscHtml(escHtml, who) {
  if (typeof escHtml !== 'function') throw new TypeError(`${who}() requires an escHtml function — a league name must never render unescaped`);
}
const noIcon = () => '';

/** The header (mobile nav bar): Cancel/Back on the left, the title, Next/Done on the right — per step and phase. Returns markup only. */
export function navBarHTML(state, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'navBarHTML');
  const busy = isBusy(state);
  let title = LC_COPY.title; let left = ''; let right = '';
  const btn = (side, action, label, { disabled = false, lead = '' } = {}) =>
    `<button type="button" class="lc-nav-btn lc-nav-${side}" data-lc-action="${action}"${disabled ? ' aria-disabled="true" disabled' : ''}>${lead}${escHtml(label)}</button>`;
  if (state.step === 'name') {
    left = btn('l', 'cancel', LC_COPY.cancel);
    right = btn('r', 'next', LC_COPY.next, { disabled: !canAdvance(state) });
  } else if (state.step === 'sports') {
    title = LC_COPY.sportsTitle;
    left = btn('l', 'back', LC_COPY.back, { disabled: busy, lead: `<span class="lc-nav-ic" aria-hidden="true">${icon('chevronLeft')}</span>` });
    right = '<span class="lc-nav-btn lc-nav-r" aria-hidden="true"></span>';
  } else if (state.step === 'created') {
    title = LC_COPY.createdTitle;
    left = '<span class="lc-nav-btn lc-nav-l" aria-hidden="true"></span>';
    right = '<span class="lc-nav-btn lc-nav-r" aria-hidden="true"></span>';
  } else {
    title = LC_COPY.inviteTitle;
    left = '<span class="lc-nav-btn lc-nav-l" aria-hidden="true"></span>';
    right = btn('r', 'done', LC_COPY.done);
  }
  const webClose = busy || state.created ? '' : `<button type="button" class="lc-web-close" data-lc-action="cancel" aria-label="${escHtml(LC_COPY.close)}">${icon('clear')}</button>`;
  return `<div class="lc-nav">${left}<div class="lc-nav-title" id="league-create-title">${escHtml(title)}</div>${right}${webClose}</div>`;
}

/** A banner (frames 8, 9, 10, 13). `kind`: 'err' (red, persistent) or 'info' (gold). role="alert" on the red one so VoiceOver reads it when it appears. */
export function bannerHTML(kind, text, { escHtml, icon = noIcon, cta = null } = {}) {
  requireEscHtml(escHtml, 'bannerHTML');
  const isErr = kind === 'err';
  // `cta` ({ id, label }) adds ONE retry button to the banner (R-F4, frame 13). No cta = the banner's markup exactly as it always was. (Named `cta`, not `action`: this file's
  // xsstest sweep is name-based and `action` is the nav bar's own literal-only parameter — a second meaning for the word would move that pin.)
  const act = cta && cta.id && cta.label
    ? `<button type="button" class="lc-banner-action" id="${escHtml(cta.id)}">${escHtml(cta.label)}</button>` : '';
  return `<div class="lc-banner ${isErr ? 'lc-banner-err' : 'lc-banner-info'}" role="${isErr ? 'alert' : 'status'}" data-lc-banner="${isErr ? 'err' : 'info'}">`
    + `<span class="lc-banner-ic" aria-hidden="true">${icon(isErr ? 'warning' : 'lock')}</span><span>${escHtml(text)}</span>${act}</div>`;
}

/** The banner (if any) a phase owes, as markup. `name` is the created league's name for frame 13. */
export function phaseBannerHTML(state, { escHtml, icon } = {}) {
  requireEscHtml(escHtml, 'phaseBannerHTML');
  switch (state.phase) {
    case 'failed': return bannerHTML('err', LC_COPY.failed, { escHtml, icon });
    case 'limit': return bannerHTML('info', LC_COPY.limit, { escHtml, icon });
    case 'paused': return bannerHTML('info', LC_COPY.paused, { escHtml, icon });
    case 'refresh_failed': return bannerHTML('err', refreshFailedCopy((state.created && state.created.name) || state.name), { escHtml, icon });
    default: return '';
  }
}

/** Frame 2 / 12 / 10 — the name step. Rendered ONCE on entry; typing updates the counter and the Next state in place (a repaint would drop focus and the keyboard). */
export function nameStepHTML(state, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'nameStepHTML');
  const paused = state.phase === 'paused';
  const len = String(state.name || '').length;   // UTF-16 units, the same unit `maxlength` enforces, so the counter can never disagree with the field
  return `<div class="lc-body lc-step" data-lc-step="name">
      ${phaseBannerHTML(state, { escHtml, icon })}
      <label class="lc-label" for="league-create-name">${escHtml(LC_COPY.nameLabel)}</label>
      <div class="lc-input${paused ? ' lc-input-disabled' : ''}">
        <input type="text" id="league-create-name" class="lc-input-field" value="${escHtml(state.name || '')}" maxlength="${NEW_LEAGUE_NAME_MAX}"
               placeholder="${escHtml(LC_COPY.namePlaceholder)}" autocomplete="off" autocapitalize="words" enterkeyhint="next" spellcheck="false"${paused ? ' disabled' : ''}>
        <button type="button" class="lc-input-clear" data-lc-action="clear-name" aria-label="${escHtml(LC_COPY.clearName)}"${len ? '' : ' hidden'}>${icon('clear')}</button>
      </div>
      <div class="lc-count" id="league-create-count" aria-hidden="true">${len} / ${NEW_LEAGUE_NAME_MAX}</div>
      <div class="lc-helper">${escHtml(LC_COPY.nameHelper)}</div>
      <div class="lc-web-actions">
        <button type="button" class="lc-btn lc-btn-secondary" data-lc-action="cancel">${escHtml(LC_COPY.cancel)}</button>
        <button type="button" class="lc-btn lc-btn-primary" data-lc-action="next"${canAdvance(state) ? '' : ' aria-disabled="true" disabled'}>${escHtml(LC_COPY.next)}</button>
      </div>
    </div>`;
}

function sportRowHTML(s, { state, escHtml, icon }) {
  const on = state.ticked.includes(s.key);
  const main = on && mainSport(state) === s.key;
  const busy = isBusy(state);
  const aria = `${s.label}${main ? ', main' : ''}, ${on ? 'selected' : 'not selected'}`;
  return `<button type="button" class="lc-row" role="checkbox" aria-checked="${on ? 'true' : 'false'}" aria-label="${escHtml(aria)}" data-lc-sport="${escHtml(s.key)}"${busy ? ' disabled' : ''}>`
    + `<span class="lc-row-ic" aria-hidden="true">${icon(s.glyphKey)}</span>`
    + `<span class="lc-row-name">${escHtml(s.label)}</span>`
    + (main ? `<span class="lc-main-tag">${escHtml(LC_COPY.main)}</span>` : '')
    + `<span class="lc-tick${on ? ' lc-tick-on' : ''}" aria-hidden="true">${on ? `<span class="lc-tick-ic">${icon('check')}</span>` : ''}</span></button>`;
}

/** Frames 3, 7, 8, 9 — the sports step. `groups` is `pickerGroups()`'s output. */
export function sportsStepHTML(state, groups, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'sportsStepHTML');
  const g = groups || { season: [], tournament: [] };
  const busy = isBusy(state);
  const limited = state.phase === 'limit';
  const section = (label, rows) => (rows.length
    ? `<div class="lc-sec">${escHtml(label)}</div><div class="lc-card${busy || limited ? ' lc-card-dim' : ''}" role="group" aria-label="${escHtml(label)}">${rows.map((s) => sportRowHTML(s, { state, escHtml, icon })).join('')}</div>`
    : '');
  let primary;
  if (limited) {
    primary = `<button type="button" class="lc-btn lc-btn-secondary" data-lc-action="done-limit">${escHtml(LC_COPY.done)}</button>`;
  } else if (busy) {
    primary = `<button type="button" class="lc-btn lc-btn-primary lc-btn-busy" aria-disabled="true" disabled><span class="lc-spin" aria-hidden="true"></span>${escHtml(state.slow ? LC_COPY.stillWorking : LC_COPY.creating)}</button>`;
  } else if (state.phase === 'failed') {
    primary = `<button type="button" class="lc-btn lc-btn-primary" data-lc-action="create"${canCreate(state) ? '' : ' aria-disabled="true" disabled'}>${escHtml(LC_COPY.tryAgain)}</button>`;
  } else {
    primary = `<button type="button" class="lc-btn lc-btn-primary" data-lc-action="create"${canCreate(state) ? '' : ' aria-disabled="true" disabled'}>${escHtml(LC_COPY.create)}</button>`;
  }
  return `<div class="lc-body lc-step" data-lc-step="sports" aria-busy="${busy ? 'true' : 'false'}">
      ${phaseBannerHTML(state, { escHtml, icon })}
      ${section(LC_COPY.seasons, g.season)}
      ${section(LC_COPY.tournaments, g.tournament)}
      <div class="lc-helper">${escHtml(LC_COPY.sportsHelper)}</div>
      <div class="lc-footer">${primary}${busy ? '' : `<button type="button" class="lc-btn lc-btn-text lc-web-only" data-lc-action="back">${escHtml(LC_COPY.back)}</button>`}</div>
    </div>`;
}

/** Frame 4 — Created. The five rows come from NEW_LEAGUE_DEFAULTS, read-only; success is a screen, not a toast (the role changed and the screen states what is already on). */
export function createdStepHTML(state, { escHtml, icon = noIcon, defaults = NEW_LEAGUE_DEFAULTS } = {}) {
  requireEscHtml(escHtml, 'createdStepHTML');
  const c = state.created || {};
  const rows = newLeagueOnRows(defaults).map((r) => `<div class="lc-on-row" data-lc-on="${escHtml(r.id)}"><span class="lc-on-ic" aria-hidden="true">${icon('check')}</span><span>${escHtml(r.text)}</span></div>`).join('');
  return `<div class="lc-body lc-step" data-lc-step="created">
      <div class="lc-hero"><div class="lc-seal" aria-hidden="true">${icon('check')}</div>
        <h2 class="lc-hero-title">${escHtml(readyTitle(c.name || state.name))}</h2><p class="lc-hero-sub">${escHtml(LC_COPY.commissionerLine)}</p></div>
      <div class="lc-sec">${escHtml(LC_COPY.onHeading)}</div>
      <div class="lc-card">${rows}</div>
      <div class="lc-helper">${escHtml(LC_COPY.onHelper)}</div>
      <div class="lc-footer">
        <button type="button" class="lc-btn lc-btn-primary" data-lc-action="invite">${escHtml(LC_COPY.inviteFriends)}</button>
        <button type="button" class="lc-btn lc-btn-text" data-lc-action="not-now">${escHtml(LC_COPY.notNow)}</button>
      </div>
    </div>`;
}

/** Frame 5 — Invite. The code from `getLeagueJoinCode()` in two groups of four; `Copy Code` copies the 8 characters; `Share Invite` shares the link. */
export function inviteStepHTML(state, { escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'inviteStepHTML');
  const c = state.created || {};
  const code = normalizeInviteCode(c.code);
  return `<div class="lc-body lc-step" data-lc-step="invite">
      <div class="lc-codecard"><div class="lc-code-lab">${escHtml(LC_COPY.leagueCode)}</div>
        <div class="lc-code" id="league-create-code" aria-label="${escHtml(LC_COPY.leagueCode)} ${escHtml(code.split('').join(' '))}"${code ? '' : ' aria-busy="true"'}>${code ? escHtml(formatInviteCode(code)) : '&middot;&middot;&middot;&middot; &middot;&middot;&middot;&middot;'}</div>
        <button type="button" class="lc-btn lc-btn-secondary lc-btn-sm" data-lc-action="copy-code"${code ? '' : ' disabled'}><span class="lc-btn-ic" aria-hidden="true">${icon('copy')}</span>${escHtml(LC_COPY.copyCode)}</button></div>
      <div class="lc-helper">${escHtml(LC_COPY.inviteHelper)}</div>
      <div class="lc-footer">
        <button type="button" class="lc-btn lc-btn-primary" data-lc-action="share"${code ? '' : ' disabled'}><span class="lc-btn-ic" aria-hidden="true">${icon('share')}</span>${escHtml(LC_COPY.shareInvite)}</button>
        <button type="button" class="lc-btn lc-btn-text lc-web-only" data-lc-action="done">${escHtml(LC_COPY.done)}</button>
      </div>
    </div>`;
}

/**
 * THE ONE ACTION-SHEET BUILDER (UN-389 / DI-446, 2026-09-30 — generalized out of `discardSheetHTML()`, never forked). The iOS action sheet (`.lc-scrim` + `.lc-actionsheet` +
 * `.lc-as-*`; a small confirm dialog on web at 600px and up, the same markup restyled): a title group with ONE destructive action, then a separate bold Cancel group. `message` is an
 * optional muted sentence under the title (the Delete Account sheet's "Archive {League}?" carries one; the discard prompt does not). Everything interpolated goes through the
 * injected `escHtml`. `actionAttr` names the attribute each control's action rides on (the New League sheet's `data-lc-action`; the Delete Account sheet's `data-ax-action`), and
 * `scrimAction` is what tapping the dimmed scrim does (always "the safe choice": keep editing / cancel). With no `message` and the defaults, the output is BYTE-IDENTICAL to what
 * `discardSheetHTML()` has always returned (pinned by the golden in accountexittest.mjs).
 *
 * @param {{ escHtml: Function, titleId: string, title: string, message?: string, danger: { label: string, action: string }, cancel: { label: string, action: string }, scrimAction: string, actionAttr?: string }} args
 */
export function actionSheetHTML({ escHtml, titleId, title, message = '', danger, cancel, scrimAction, actionAttr = 'data-lc-action' } = {}) {
  requireEscHtml(escHtml, 'actionSheetHTML');
  const ttlCls = message ? 'lc-as-ttl lc-as-ttl-has-msg' : 'lc-as-ttl';
  const msg = message ? `<div class="lc-as-msg">${escHtml(message)}</div>` : '';
  return `<div class="lc-scrim" ${actionAttr}="${escHtml(scrimAction)}"></div>
    <div class="lc-actionsheet" role="alertdialog" aria-modal="true" aria-labelledby="${escHtml(titleId)}">
      <div class="lc-as-grp"><div class="${ttlCls}" id="${escHtml(titleId)}">${escHtml(title)}</div>${msg}
        <button type="button" class="lc-as-act lc-as-danger" ${actionAttr}="${escHtml(danger.action)}">${escHtml(danger.label)}</button></div>
      <div class="lc-as-grp"><button type="button" class="lc-as-act lc-as-bold" ${actionAttr}="${escHtml(cancel.action)}">${escHtml(cancel.label)}</button></div>
    </div>`;
}

/** Frame 11 — the discard action sheet (iOS) / small confirm dialog (web; the same markup, restyled at 600px and up). Title, destructive Discard, bold Keep Editing. A thin caller of `actionSheetHTML()`. */
export function discardSheetHTML({ escHtml } = {}) {
  requireEscHtml(escHtml, 'discardSheetHTML');
  return actionSheetHTML({
    escHtml, titleId: 'lc-discard-title', title: LC_COPY.discardTitle, scrimAction: 'keep-editing',
    danger: { label: LC_COPY.discard, action: 'discard' }, cancel: { label: LC_COPY.keepEditing, action: 'keep-editing' },
  });
}

/** The one body for a state — the dispatcher app.js calls. */
export function stepBodyHTML(state, groups, deps) {
  if (state.step === 'name') return nameStepHTML(state, deps);
  if (state.step === 'sports') return sportsStepHTML(state, groups, deps);
  if (state.step === 'created') return createdStepHTML(state, deps);
  return inviteStepHTML(state, deps);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 7. THE ENTRY POINTS — Leagues Home's stub card and the zero-league landing's Create card
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** The OPEN entry (Leagues Home): `data-action="create-league"` with the plus icon. The gate-CLOSED markup is leagues-home.js's own stub, untouched. */
export function entryCardHTML({ escHtml, icon = noIcon } = {}) {
  requireEscHtml(escHtml, 'entryCardHTML');
  return `<button type="button" class="card create-league-card create-league-card-open" data-action="create-league">`
    + `<span class="create-league-card-ic" aria-hidden="true">${icon('plus')}</span><span class="create-league-card-title">${escHtml(LC_COPY.entryLabel)}</span></button>`;
}

/** The landing's Create card body: an enabled button when the gate is open, else a disabled control with the "coming in a future update" line. */
export function landingCreateCardHTML({ open, signupsOpen = true, escHtml } = {}) {
  requireEscHtml(escHtml, 'landingCreateCardHTML');
  if (!open) {
    return `<button type="button" class="btn btn-primary btn-block" id="league-create-open-btn" disabled aria-disabled="true">${escHtml(LC_COPY.create)}</button>
        <p class="text-muted" style="font-size:.78rem;margin-top:8px">${escHtml(LC_COPY.landingClosed)}</p>`;
  }
  return `<button type="button" class="btn btn-primary btn-block" id="league-create-open-btn" data-action="create-league"${signupsOpen ? '' : ' disabled aria-disabled="true"'}>${escHtml(LC_COPY.create)}</button>`;
}

/**
 * S-9 (DI-430 §Zero-membership landing) — the two-segment control on the claim-code screen: "I have a claim code" / "I have an invite code", two 44px segments, the
 * ACTIVE one marked. It is markup for BOTH modes; the claim card (today's, unchanged) or the invite card renders under it. Mentions no league by name.
 */
export function landingSegmentsHTML({ mode = 'claim', escHtml } = {}) {
  requireEscHtml(escHtml, 'landingSegmentsHTML');
  const seg = (key, label) => `<button type="button" class="lc-seg${mode === key ? ' lc-seg-on' : ''}" role="tab" aria-selected="${mode === key ? 'true' : 'false'}" data-lc-seg="${key}">${escHtml(label)}</button>`;
  return `<div class="lc-segs" role="tablist" aria-label="${escHtml(LC_COPY.segClaim)} / ${escHtml(LC_COPY.segInvite)}">${seg('claim', LC_COPY.segClaim)}${seg('invite', LC_COPY.segInvite)}</div>`;
}

/** The invite note shown above the prefilled code when the visitor arrived through an invite link, plus the text link back to the claim card. */
export function inviteLinkNoteHTML({ escHtml } = {}) {
  requireEscHtml(escHtml, 'inviteLinkNoteHTML');
  return `<p class="lc-invite-note">${escHtml(LC_COPY.inviteLinkNote)}</p>`;
}
/**
 * The THIRD choice on the zero-membership landing (coordinator ruling 2026-09-30, "anyone may create a league"): "Create a league". It is an ENTRY, not a segment — it opens the
 * approved New League sheet through the same `[data-action="create-league"]` dispatcher as every other entry — so it sits under the card, and the two-segment control (claim /
 * invite) is unchanged. The CALLER renders it only while `league_creation_open` is true: with the gate closed it is not disabled, it is ABSENT (the screen is byte-identical to
 * today's), the same hidden-not-dimmed treatment the rest of the gate uses.
 */
export function claimCreateEntryHTML({ escHtml } = {}) {
  requireEscHtml(escHtml, 'claimCreateEntryHTML');
  return `<button type="button" class="btn btn-ghost btn-block lc-create-entry" id="link-create-league-btn" data-action="create-league">${escHtml(LC_COPY.createChoice)}</button>`;
}
export function claimInsteadHTML({ escHtml } = {}) {
  requireEscHtml(escHtml, 'claimInsteadHTML');
  return `<button type="button" class="btn btn-ghost btn-block lc-claim-instead" data-lc-seg="claim">${escHtml(LC_COPY.claimInstead)}</button>`;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// 8. SHARING — web copies the link, native share is FEATURE-DETECTED; navigator.share is never used
// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * What "Share Invite" does. Native shell WITH `Capacitor.Plugins.Share` → the plugin's share sheet with the league name, the link and the code; everything else (web, and a
 * native shell without the plugin) → copy the LINK ("Invite link copied"). NEVER the Web Share API (`navigator` is not consulted): its behaviour differs by browser, and the
 * approved parity pair is "native share vs copy link". Returns a small result the caller turns into a toast/haptic; never throws.
 *
 * @param {{ leagueName: string, code: string, isNative: boolean, plugins?: object, copyText?: (t: string) => Promise<boolean>|boolean }} args
 * @returns {Promise<{ via: 'share'|'copy'|'none', ok: boolean }>}
 */
export async function shareInvite({ leagueName, code, isNative, plugins, copyText } = {}) {
  const link = inviteLink(code);
  if (!link) return { via: 'none', ok: false };
  const Share = isNative && plugins ? plugins.Share : null;
  if (Share && typeof Share.share === 'function') {
    try {
      await Share.share({ title: String(leagueName || ''), text: inviteMessage({ leagueName, code }), url: link, dialogTitle: LC_COPY.shareInvite });
      return { via: 'share', ok: true };
    } catch (err) {
      // The person dismissed the sheet: not a failure, and never a second attempt (a cancelled share must not fall through to a silent clipboard write).
      const msg = String((err && err.message) || err || '');
      if (/cancel|dismiss|abort/i.test(msg)) return { via: 'share', ok: false };
      // any other plugin failure falls through to the copy path below
    }
  }
  let ok = false;
  try { ok = !!(await (copyText ? copyText(link) : false)); } catch { ok = false; }
  return { via: 'copy', ok };
}
