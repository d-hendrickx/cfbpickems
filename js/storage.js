/**
 * CFB Pickems — Storage v8 (Phase II — pluggable backend)
 *
 * v8: load()/save() route through a pluggable backend.
 *   - 'local'        : localStorage (default; offline; per-device) — unchanged behaviour
 *   - 'googleSheets' : in-memory mirror hydrated from a Google Sheet via backend.js
 * The rest of this module is UNCHANGED — every getter/setter still calls the
 * private load()/save(), so switching modes needs no call-site edits.
 *
 * Session + site-unlock + backend config always stay device-local (they're
 * per-device concerns), regardless of the active backend.
 */

import {
  DEFAULT_SETTINGS, DEMO_PLAYERS, DEMO_WEEK, DEMO_GAMES, DEMO_PICKS,
  REAL_WEEK_1_2026, REAL_WEEK_1_2026_KNOWN_GAMES,
  SITE_PIN, SITE_PIN_KEY,
  isObligationActive,
  DEFAULT_TZ,
  CHAT_ACCENTS,
  REACTION_PALETTE,
} from './data-model.js';

import { cacheGet, cacheSet, isBackendReady } from './backend.js';
// Phase III Step 4 Part B (DI §1.2 row 1) — THE THIRD STORAGE MODE.
// A NAMESPACE import, and a STATIC one, exactly as the design input specifies:
// js/supabase-backend.js has ZERO top-level side effects by construction (its
// own header, constraint 1 — no client, no storage read, no timer, no DOM), so
// importing it costs a 'pins'/'sheets' boot nothing but the module eval, and
// loadtest.mjs's DOM stub still imports this seam exactly as it does today.
// It imports only ./supabase-projection.js, so this edge introduces no cycle
// (supabase-backend.js never imports auth.js/storage.js/backend.js — DI §1.3's
// register-don't-import rule is what keeps that true).
import * as sb from './supabase-backend.js';
// Phase III Step 3a (DI-180f) — see the getSession() comment below. This is
// the only new import this file gains for the whole build.
import { getAuthMode, getSupabaseSession, isSupabaseWriteWithheld, AuthModeMismatchError } from './auth.js';

const KEYS = {
  SETTINGS:    'cfbp_settings',
  PLAYERS:     'cfbp_players',
  WEEKS:       'cfbp_weeks',
  GAMES:       'cfbp_games',          // selected weekly SLATE
  AVAIL_GAMES: 'cfbp_avail_games',    // available-games pool (fetched, not yet on slate)
  PICKS:       'cfbp_picks',
  RESULTS:     'cfbp_results',
  OBLIGATIONS: 'cfbp_obligations',
  NICKNAMES:   'cfbp_nicknames',
  SESSION:     'cfbp_session',
  LOCK_OVR:    'cfbp_lock_overrides',
  TB_GUESSES:  'cfbp_tiebreaker_guesses',
  EP_GUESSES:  'cfbp_extra_point_guesses', // v0.16.0 — Ischemic Extra Point (longest FG, blackjack rules)
  REJECTED_SUGG: 'cfbp_rejected_suggestions',  // per-week dismissed suggested games
  REACTIONS:   'cfbp_reactions',                // per-week game emoji reactions
  FEEDBACK:    'cfbp_feedback',                 // user-submitted feature requests / issues
  FEEDBACK_EXCLUDED: 'cfbp_feedback_excluded_ids', // Item 10 (DI-B1): per-id "leave out of CSV export" flag
  COMMENTS:    'cfbp_comments',                 // per-game + general chat messages (with PickEms Bot)
  ACTIVE_WEEK: 'cfbp_active_week',
  FETCH_PROOF: 'cfbp_fetch_proof',
  SITE_UNLOCK: SITE_PIN_KEY,  // 'cfbp_site_unlocked'
  // Groups A/B notification workstream (UN-139…UN-148, 2026-09-10). ONE shared
  // list of provider-independent notification records — mirrors the
  // KEYS.COMMENTS single-key precedent (CLAUDE.md architecture bullet),
  // filtered client-side by playerId. Chat messages are explicitly NOT written
  // here (see js/notifications.js §2) — this key holds lifecycle events only
  // (picksOpen/reminder/locking/locked/results/obligations/announcements).
  NOTIFICATIONS: 'cfbp_notifications',
  // Build 2b, E3-E5 (2026-09-10, UN-161…163) — SCRIBE Trainer output. THREE
  // small, flat-array KV keys (NOT the append-only chat-event log E2 uses for
  // feedback, NOT a new dedicated Apps Script sheet like D2's future
  // CFBP_SCRIBE_MEMORY): learnings/Canon/reports are read-heavy, low-write,
  // small-N (dozens across a season), and are APPROVED/EDITED IN PLACE via a
  // status flip — the opposite write/mutation profile from feedback
  // (write-heavy, append-only, never edited) or a future Facts store (needs
  // true per-row delete). Written server-side by `runTrainer` (backend/
  // Code.gs) via the existing setOne()/getOne() seam — same physical
  // mechanism as every other cfbp_* key, just written from Apps Script
  // directly rather than through the client's debounced push.
  //   SCRIBE_LEARNINGS holds THREE item kinds in one flat array — `kind:
  //     'learning' | 'experiment' | 'fact_candidate'` — per the DI's own
  //     instruction to fold fact_candidates in here "so nothing is lost"
  //     rather than invent a fourth key for a shape this key already fits
  //     (small, status-gated, commissioner-approved-in-place).
  //   SCRIBE_CANON holds canon_candidate entries only (`approval_status`,
  //     not `status` — matches the DI's own field name for this one kind).
  //   SCRIBE_REPORTS holds one entry per Trainer run (§8 report sections +
  //     the computed metrics snapshot) — read-only from the client's side;
  //     nothing ever flips a report's own field, only learnings/Canon rows.
  SCRIBE_LEARNINGS: 'cfbp_scribe_learnings',
  SCRIBE_CANON:     'cfbp_scribe_canon',
  SCRIBE_REPORTS:   'cfbp_scribe_reports',
  // FEAT-3 / DI-200c (UN-200, 2026-09-12) — the device ledger of release
  // versions this device has already announced in the Locker Room. Array of
  // version strings, newest appended, last 20 kept. DEVICE-LOCAL (below): six
  // devices each attempt the post and the server's id dedupe (AD-11) collapses
  // them to one row, so this is a per-device "did I already try" record, not
  // league state. checkPickRevealDue()'s `cfbp_reveal_emitted` is the same
  // shape but reaches raw localStorage; this one routes through load()/save()
  // like everything else in this file (AD-02) — the better of the two
  // precedents, chosen deliberately.
  WHATS_NEW_POSTED: 'cfbp_whatsnew_posted',
  // FEAT-2 / DI-175d (UN-175, 2026-09-12) — player game requests. ONE flat,
  // APPEND-ONLY array holding two row kinds ('request' and its 'withdraw'
  // tombstone). Shared league data, so it is deliberately NOT in
  // DEVICE_LOCAL_KEYS below — a request made on Kevin's phone has to reach
  // Drew's Games tab or the feature does nothing.
  //
  // NOT SEEDED, by construction rather than by exemption: absent reads as []
  // through getGameRequestRows(), so there is nothing for ensureSeedData() to
  // fill and therefore no RG-12 seeding surface at all (contrast NOTIFICATIONS
  // /SCRIBE_* above, which ARE seeded because their accessors wanted a real
  // array present). A key that never seeds cannot mistake a failed hydrate for
  // an empty league.
  //
  // Every mutable property of a request — withdrawn / on the slate / missed /
  // passed — is DERIVED AT READ TIME by foldGameRequests() and never written.
  // That is not a style preference: js/backend.js's _unionById() (which this
  // key joins, MANDATORY, see that file) silently reverts a local field flip on
  // a row the remote also holds. A stored status field would look correct on
  // the device that set it and wrong everywhere else.
  GAME_REQUESTS: 'cfbp_game_requests',
  // FEAT-5 / DI-202g bound 3 (UN-202, 2026-09-12) — the device ledger of wagers
  // this device has already resurfaced in the Locker Room. Array of wagerIds,
  // newest appended, last 50 kept. DEVICE-LOCAL (below), the same shape and the
  // same reasoning as WHATS_NEW_POSTED: six devices each attempt the callback
  // and the server's id dedupe (AD-11, `scribe_wagerdue_<wagerId>`) collapses
  // them to one row, so this records what THIS device tried, not league state.
  WAGER_RESURFACED: 'cfbp_wager_resurfaced',
  // ── N1 / FEAT-11 (UN-204, DI-N1 gate 3, 2026-09-12) ──────────────────────
  // The device ledger of lifecycle notices this device has already posted to
  // the Locker Room. Array of the DETERMINISTIC chat ids it emitted
  // (`sys_lc_<EVENT>_<scopeId>`), newest appended, last 50 kept. DEVICE-LOCAL
  // (below), the same shape and the same reasoning as WHATS_NEW_POSTED and
  // WAGER_RESURFACED: six devices may each detect the same transition, the
  // server's id dedupe (AD-11) collapses them onto one row, and this only
  // records what THIS device already tried.
  //
  // Storing the ID rather than the event name is deliberate — it is the exact
  // string the server dedupes on, so "have I posted this?" and "is this the
  // same row?" can never drift apart, and a week-scoped and an
  // obligation-scoped entry cannot collide.
  LIFECYCLE_POSTED: 'cfbp_lifecycle_posted',
  // ── N1 / FEAT-11 (UN-204, DI-N3 — Drew's R10), 2026-09-12 ────────────────
  // "If push notifications are set up then all in app notifications should be
  // that." Whether push is genuinely ACTIVE **on this device, right now**:
  // permission granted AND OneSignal reports the device opted in AND the
  // player's master push toggle is on. A boolean, recomputed at boot and after
  // any permission or master-toggle change.
  //
  // DEVICE-LOCAL because it describes THIS device exactly as SESSION does — the
  // same player's other phone may have push off, and one device's answer must
  // never suppress the other's toast. It is cached rather than computed on
  // demand because the real predicate (subscriptionState(), OneSignal's opted-in
  // report) is ASYNC and chat-ui.js's showToast() is not: CONVENTIONS #9 says
  // wrap async, never expose it, and this is the wrapper.
  //
  // DEFAULT-WHEN-MISSING (CONVENTIONS #10): absent/garbage reads as FALSE, i.e.
  // "push is not carrying this device." That direction is chosen, not
  // inherited — a false FALSE shows a toast the player may not have needed; a
  // false TRUE silently swallows every in-app notice on a device that is not
  // actually receiving pushes, which is UN-N3's exact failure (not enabling
  // push must never be the same as going blind).
  PUSH_ACTIVE: 'cfbp_push_active',
  // DI-210b (iOS Munera, 2026-09-20) — the native shell's own scroll/tab-state
  // survival across a WKWebView background→foreground reload. `{ tab, scrollTop,
  // savedAt }`, overwritten in place (not appended) — this is a snapshot of
  // "where this device was," not a log. DEVICE-LOCAL for the same reason SESSION
  // is: it is a fact about THIS handset's webview, not league state, and it must
  // never reach the sync seam (a shared write here would bounce every device to
  // whichever phone last backgrounded the app). Read only on native boot
  // (isNativeShell()); written only on the native App plugin's `pause` event.
  // Absent/garbage reads as null — "nothing to restore," which is exactly
  // today's behaviour (navigateTo() already defaults to state.currentTab).
  SHELL_UI_STATE: 'cfbp_shell_ui_state',
  // RG-198 (2026-09-21, Drew-approved: "Yes: the app paints your colours
  // immediately on open") — the palette THIS HANDSET last painted. A plain
  // theme key string.
  //
  // NOT A SECOND SOURCE OF TRUTH, and the distinction is the whole design: the
  // theme lives on the PLAYER record (`player.preferences.theme`, CLAUDE.md
  // bullet 4) and getTheme() still answers from there. This only remembers what
  // was on screen last time, so the FIRST frame of a cold boot can be right.
  // On a Supabase device the player record does not exist locally until the
  // adapter is serving (the Sheets mirror prime is skipped by design, §1.5 item
  // 1), so without this the first paint could only ever be 'neutral' — the
  // "neutral page while loading then quickly flashes back to my saved color
  // scheme" half of Drew's report.
  //
  // DEVICE-LOCAL for the same reason SESSION is: it is a fact about what THIS
  // screen last showed. Shared, it would make one player's phone repaint
  // another's. Under the `cfbp_` prefix ON PURPOSE — auth.js's F-1 handover and
  // sign-out sweep then clears it with no new entry in that file's keep-list
  // (the same argument `cfbp_supabase_mirror` makes above), which is what stops
  // player B booting in player A's colours on a shared handset.
  //
  // DEFAULT-WHEN-MISSING (CONVENTIONS #10): absent, unknown or malformed reads
  // as '' and every caller falls back to getTheme() — i.e. exactly today's
  // behaviour. The value is spliced into a CSS class name, so callers validate
  // it against the seven real theme keys rather than trusting the device.
  THEME_HINT: 'cfbp_theme_hint',
};

// Keys that ALWAYS stay device-local even when a shared backend is active.
// (Session/auth and the site PIN unlock are per-device; backend config is local.)
//
// RG-56 (2026-09-04) — AVAIL_GAMES joined this list, and it is the only entry
// here that is not a per-device auth concern, so the reason is written down.
//
// The available-games POOL is the commissioner's ESPN candidate scratch pad:
// `{ weekId: [game, …] }`, raw parsed ESPN rows, replaced wholesale by the next
// "Fetch ESPN games" click. One app key is ONE Google Sheets cell
// (`backend/Code.gs`, CFBP_STORE: `key | json | updatedAt`) and Sheets caps a
// cell at 50,000 characters. A parsed candidate game serializes to ~963 chars,
// so a single week crosses the cap at ~52 games; Drew's Sep 3–7 fetch returned
// 91 (87,651 chars, 175% of the cap). `setMany()` has no chunking and no size
// check, so Apps Script threw, `handle()` returned ok:false for the WHOLE
// batch, and every other key in that batch — the slate, the week status, his
// own picks — never committed. flushPush() then re-queued the same doomed batch
// on every retry. That is the outage: a scratch key full of third-party data
// holding irreplaceable user data hostage.
//
// RG-55 (the 760-team ESPN catalog) reached the same CONCLUSION the same day,
// on the same three grounds — identical on every device, re-fetches in one
// click, never authoritative — but by a DIFFERENT disposition, and the
// difference matters. RG-55 chose in-memory and explicitly declined a
// localStorage exemption, on the reasoning that a first exception hands the
// next generalist a precedent. This key goes through DEVICE_LOCAL_KEYS instead,
// which is not an exemption at all: the pool must survive a reload, and routing
// it here never leaves the load()/save() seam. Cite the distinction, not a
// sameness — this codebase has been bitten twice by confident wrong citations
// (RG-49's key names that never existed; three test files CLAUDE.md named that
// never existed). The grounds are: it is identical on every device, it
// re-fetches in one click, and it is never authoritative — once a
// candidate is added to the slate it lives in KEYS.GAMES, which IS shared. The
// only cost is that a pool built on one device is not visible on another, where
// "Fetch ESPN games" rebuilds it.
//
// This is NOT the silent-localStorage-fallback AD-06 prohibits. That prohibition
// is about hiding a BROKEN backend behind local storage. This is a declared,
// permanent routing decision for one key, made in the open at the same seam that
// already routes SESSION and SITE_UNLOCK, and it is unconditional — it behaves
// identically whether the backend is healthy, degraded or absent.
// ── Phase III Step 3a (reviewer N9) — THREE MORE DEVICE-LOCAL KEYS, owned by
//    js/auth.js rather than declared in KEYS above, named here so this list is
//    still the one place a reader can see everything that stays on the handset:
//      'cfbp_supabase_session'       js/auth.js AUTH_STORAGE_KEY — the Supabase
//        SDK's own persisted token, written by the SDK (we only configure the
//        storageKey and remove it on sign-out). Never routed through load()/
//        save(): it is the SDK's private format, and putting a bearer token on
//        a shared Sheet would hand every league member every other member's
//        session.
//      'cfbp_supabase_active_league' js/auth.js ACTIVE_LEAGUE_KEY — which
//        league is active ON THIS DEVICE. Device-local for exactly the reason
//        SESSION is: it records what this handset is looking at, not league
//        state. Drew switching leagues on a laptop must not re-scope a phone.
//      'cfbp_auth_mode_last_known'   js/auth.js LAST_AUTH_MODE_KEY (SEC F1-R1,
//        second remediation pass) — the last authMode a SUCCESSFUL config.json
//        read established on THIS device. Device-local because it is a fact
//        about what this handset last saw, not league state; and because its
//        entire job is to be readable when the network is not. It is what makes
//        a failed config read fail CLOSED (keep the last known mode) instead of
//        silently selecting 'pins' — which, after cutover, would resurrect the
//        stale `cfbp_session` above as a live commissioner session. Only ever
//        written by a config read that succeeded.
//      'cfbp_device_data_owner'      js/auth.js DEVICE_DATA_OWNER_KEY (DI-180q) — the account id + active league id this handset's local data belongs to; device-local (a fact about this handset), never synced, opaque ids only.
//      'cfbp_supabase_mirror'        js/supabase-backend.js SNAPSHOT_KEY (Phase III Step 4, DI §5.3) — the last-good league snapshot the adapter paints from while a hydrate is in flight (ACTIVE-STALE) or while offline (OFFLINE-READONLY). Device-local because it IS the device's copy; written only from server truth, never while dirty, and it replaces 'cfbp_sheet_mirror' in dataMode:'supabase' (which the first Supabase boot then wipes, §6.1). Under the `cfbp_` prefix on purpose, so auth.js's F-1 handover sweep clears it with no new list entry, and read back through the adapter's exported hasDeviceSnapshot() rather than a second key literal.
//    All five are read/written by their OWNING module directly (the first four
//    by auth.js, the fifth by supabase-backend.js) rather than through this
//    seam, for the reasons above; none is in the Set below because none is ever
//    passed to load()/save(). Named so a future reader does not conclude the
//    inventory is complete without them.
const DEVICE_LOCAL_KEYS = new Set([
  KEYS.SESSION,
  KEYS.SITE_UNLOCK,
  KEYS.AVAIL_GAMES,
  // FEAT-3 / DI-200c — see the KEYS comment above. Device-local by design, and
  // for the same reason SESSION is: it records what THIS device did, not what
  // the league knows. Putting it on the Sheet would be worse than useless — the
  // first device to post would suppress the other five, which the server-side
  // id dedupe already handles without a shared write.
  KEYS.WHATS_NEW_POSTED,
  // FEAT-5 / DI-202g bound 3 — see the KEYS comment above. Device-local for the
  // same reason WHATS_NEW_POSTED is: putting it on the Sheet would let the first
  // device to post suppress the other five, which the server-side id dedupe
  // already handles without a shared write.
  KEYS.WAGER_RESURFACED,
  // N1 / DI-N1 gate 3 — see the KEYS comment above. Device-local for the same
  // reason WHATS_NEW_POSTED is: on the Sheet, the first device to post would
  // suppress the other five, which the server-side id dedupe already handles
  // without a shared write.
  KEYS.LIFECYCLE_POSTED,
  // N1 / DI-N3 (R10) — device-local for the same reason SESSION is: it is a
  // fact about THIS handset's push subscription. Writing it to the Sheet would
  // let a phone with push on silence the in-app toast on the same player's
  // laptop, which has no push at all.
  KEYS.PUSH_ACTIVE,
  'cfbp_backend_config',
  // DI-210b — see the KEYS comment above. Device-local for the same reason
  // SESSION is: a shared write would let one handset's scroll position bounce
  // every other device in the league.
  KEYS.SHELL_UI_STATE,
  // RG-198 — see the KEYS comment above. Device-local for the same reason
  // SESSION is: it records what THIS screen last painted, not league state.
  KEYS.THEME_HINT,
]);

/**
 * S-C16 (round 1 gate, Drew-approved for adaptertest.mjs's one purpose).
 * A READ-ONLY export of the same Set above — a frozen COPY, never the live
 * reference, so no importer can mutate the real routing table. Exists so
 * adaptertest.mjs's §2.1 "which keys are device-local" list can be DERIVED
 * from this one source instead of hand-maintaining a second copy that
 * drifts every time a new device-local key is added here (exactly what
 * happened with cfbp_shell_ui_state, above). Nothing else changes: every
 * existing caller still uses the module-private `DEVICE_LOCAL_KEYS`
 * directly; this export adds no new behaviour, only visibility.
 */
export function getDeviceLocalKeysForTest() {
  return new Set(DEVICE_LOCAL_KEYS);
}

/**
 * DI §4.3 — the ONE derived, read-only mirror key. Deliberately NOT in `KEYS`
 * above: nothing writes it (the adapter's set() refuses it by name), nothing
 * persists it, and it has no Sheets counterpart — putting it in KEYS would
 * invite exactly the load()/save() treatment it must never get.
 *
 * js/supabase-backend.js OWNS the name (its `DERIVED_PROGRESS_KEY`). This is a
 * second copy of a string, which is RG-49's whole shape, so adaptertest asserts
 * the two are byte-identical rather than trusting that they are.
 */
const WEEK_PROGRESS_KEY = 'cfbp_week_progress';

// Active storage backend: 'local' | 'googleSheets' | 'supabase'. Default local.
// storage.js owns this flag; app.js flips it after a successful hydrate().
//
// Phase III Step 4 Part B (DI §1.2 row 2). This function used to coerce ANY
// mode other than 'googleSheets' to 'local', which is why a third mode is a
// real edit and not a flag. The coercion itself is kept, deliberately, and only
// widened by one name: an unrecognised string is still 'local', because 'local'
// is the mode that cannot lose anybody's data to a typo.
let _backendMode = 'local';
export function getBackendMode() { return _backendMode; }
export function setBackendMode(mode) {
  _backendMode = (mode === 'googleSheets' || mode === 'supabase') ? mode : 'local';
}

/**
 * DI §1.2 row 3 — `useSheets()` renamed `useBackend()`, because it now answers
 * for two different backends.
 *
 * ══ DI-T4.10 (§12, post-gate amendment) — READINESS IS NOT THE ROUTING RULE ══
 *
 * Note the asymmetry between the two arms, which is the whole of the amendment:
 *
 *   googleSheets   `isBackendReady()` is part of the question. A Sheets device
 *                  that has not hydrated falls through to raw localStorage, and
 *                  that is CORRECT for it: the Sheets mirror and localStorage
 *                  hold the same league's data, so the fall-through is a warm
 *                  cache, not a different league. Unchanged, byte-for-byte.
 *
 *   supabase       readiness is NOT part of the question. The MODE decides the
 *                  route; readiness decides only what the adapter ANSWERS (see
 *                  load() below, which returns null rather than falling
 *                  through). A post-cutover device may still hold Sheets-era
 *                  league data under the very same `cfbp_*` keys — the
 *                  first-boot wipe (§6.1) clears only the Sheets mirror and the
 *                  site-unlock flag — so a fall-through there would serve LAST
 *                  SEASON'S SHEET as though it were this league's Supabase rows,
 *                  silently, on exactly the boots where the hydrate failed.
 *                  That is the reported discrepancy js/supabase-backend.js's
 *                  header raised, and this is where it is decided.
 *
 * `DEVICE_LOCAL_KEYS` is checked in both arms and is unchanged: device-local
 * keys keep falling through to raw localStorage in every mode, which is what
 * they are for.
 */
function useBackend(key) {
  if (DEVICE_LOCAL_KEYS.has(key)) return false;
  if (_backendMode === 'googleSheets') return isBackendReady();
  if (_backendMode === 'supabase') return true;
  return false;
}

function load(k) {
  if (useBackend(k)) {
    if (_backendMode === 'supabase') {
      // DI-T4.10. `sb.isReady()` is true in ACTIVE / ACTIVE-STALE /
      // OFFLINE-READONLY and false in IDLE / HYDRATING / SWITCHING / HELD.
      // A not-ready adapter answers `null` — and `null` is distinguishable from
      // an empty league at the accessor layer, because ensureSeedData() seeds
      // nothing in this mode (below) and every empty-state render is gated by
      // app.js's isContentWithheld(), which is true whenever the adapter is not
      // serving. Never `localStorage.getItem` — see useBackend()'s comment.
      try { return sb.isReady() ? sb.get(k) : null; }
      catch (e) { console.error('[Storage:supabase]', k, e); return null; }
    }
    try { return cacheGet(k); } catch (e) { console.error('[Storage:sheets]', k, e); return null; }
  }
  try { const r=localStorage.getItem(k); return r?JSON.parse(r):null; }
  catch(e){ console.error('[Storage]',k,e); return null; }
}
/**
 * @param {string}    k
 * @param {*}         v
 * @param {string[]=} fields  For a key whose value is a plain OBJECT holding
 *   several independent fields (today: cfbp_settings), the caller may declare
 *   exactly which field(s) it changed. The backend rebases only those fields
 *   onto the fresh snapshot after hydrate instead of re-applying the whole
 *   stale object. Omit it and behaviour is exactly as before: whole-value
 *   write. See RG-24 / the AD-08 note in backend.js cacheSet().
 */
function save(k,v,fields) {
  // ── SEC F1 (CRITICAL) — THE WRITE INTERLOCK ────────────────────────────────
  // The ONE edit this remediation makes outside storage.js's designated
  // Step-3a regions, and it is made deliberately and in the open: the finding
  // names storage.save() by function, and an interlock that lives anywhere
  // else is not an interlock. Flagged in the handoff for Drew's ruling.
  //
  // While authMode:'supabase' is set and no Supabase DATA backend is SERVING,
  // identity is being resolved against a project any Google account can join
  // while the write would land somewhere that identity does not govern. A write
  // in that state is the stranger-as-commissioner hazard actually happening.
  // Refuse it, loudly and typed — never a silent no-op, which would look
  // exactly like a successful save to every caller (AD-06).
  //
  // THE QUESTION THIS ASKS IS READINESS, NOT CONFIGURATION (2026-09-18). The
  // predicate was split after the cutover defect: app.js's boot interlock asks
  // whether the BUILD has a Supabase data layer (answerable before any session
  // exists), while this guard asks whether the adapter is SERVING — false
  // during HYDRATING / SWITCHING / HELD / OFFLINE-READONLY, which is exactly
  // when a write must be refused. isSupabaseWriteWithheld() is the former
  // isAuthDataLayerMismatch(), verbatim, so the behaviour here is unchanged;
  // only the name and the question it answers are now stated. §3.3 layer 1 and
  // authtest [44c] drive all four not-serving states.
  if (isSupabaseWriteWithheld()) {
    throw new AuthModeMismatchError(
      `Refusing to write "${k}": authMode is 'supabase' but the data layer is still the Sheets backend.`);
  }
  if (useBackend(k)) {
    if (_backendMode === 'supabase') {
      // DI §1.2 row 5. NOT wrapped in a `return false` catch the way the Sheets
      // arm is: the adapter's set() throws a TYPED AdapterWriteRefusedError for
      // a route it may not write (§2.1) and for the derived progress key, and
      // that refusal has to reach the caller so the red banner can name the
      // rule. Swallowing it into `false` is the silent no-op AD-06 exists for —
      // it looks exactly like a successful save to every caller.
      //
      // The interlock above has already thrown for every not-ready state
      // (§3.3 layer 1): hasSupabaseDataBackend() derives from the adapter's
      // probe, which is true only in ACTIVE/ACTIVE-STALE, so a write during
      // SWITCHING / HELD / OFFLINE-READONLY / HYDRATING never reaches this
      // line and the mirror is never touched by one.
      sb.set(k, v, fields);
      return true;
    }
    try { cacheSet(k, v, fields); return true; } catch (e) { console.error('[Storage:sheets] save', k, e); return false; }
  }
  try { localStorage.setItem(k,JSON.stringify(v)); return true; }
  catch(e){ console.error('[Storage] save',k,e); return false; }
}

// ─── INIT / SEED ──────────────────────────────────────────────────────────────

export function initStorage() {
  ensureSeedData();
}

/**
 * Keys whose contents are USER DATA — created by players and the commissioner,
 * irreplaceable if destroyed. Seeding any of these over live data is how RG-12
 * (and its 2026-08-12 recurrence) wiped real picks off every device.
 *
 * The rule: in googleSheets mode these are NEVER seeded automatically. An empty
 * read is indistinguishable from a failed hydrate, a cold start, or a transient
 * 200-with-empty-body — and guessing wrong destroys the season.
 */
export const USER_MUTABLE_KEYS = [
  KEYS.PLAYERS, KEYS.WEEKS, KEYS.GAMES, KEYS.PICKS, KEYS.RESULTS,
  KEYS.OBLIGATIONS, KEYS.TB_GUESSES, KEYS.EP_GUESSES, KEYS.ACTIVE_WEEK,
  KEYS.NICKNAMES, KEYS.LOCK_OVR,
];

/**
 * Seed default data for any missing keys. Idempotent — only fills gaps.
 *
 * RG-12 DEFENSE (a), rebuilt 2026-08-12. The ledger recorded this guard as
 * shipped in v0.17.1; it was NOT in the code, and its absence let the exact
 * original cascade run again and destroy live picks. Do not remove it, and do
 * not "simplify" it away — verify against `USER_MUTABLE_KEYS` before touching.
 *
 * In googleSheets mode, user-mutable keys are seeded ONLY when the caller
 * passes `{ confirmEmpty: true }` — which the boot path must never do. A human
 * confirming "yes, this Sheet really is brand new" is the only acceptable
 * source of that flag.
 */
export function ensureSeedData(opts = {}) {
  // Phase III Step 4 Part B (DI §1.2 row 6) — RG-12'S REFUSAL COVERS THE NEW
  // MODE TOO, and this ONE LINE is the whole of it.
  //
  // `=== 'googleSheets'` would have read FALSE in dataMode:'supabase', so a
  // hydrate that delivered nothing — a held adapter, an offline boot, a partial
  // read — would have seeded DEMO_PLAYERS, DEMO_PICKS and the draft week
  // template straight into a real league's keys. That is RG-12's cascade
  // exactly, arriving through a mode the guard had never heard of. The test is
  // now "is this a SHARED store" rather than "is this the Sheet", which is the
  // property the refusal was always about.
  // ══ SUPABASE MODE SEEDS NOTHING, EVER ══════════════════════════════════
  // (Coordinator ruling 2026-09-18, gap 2 — one line, and it is a stronger
  // statement than the RG-12 guard below rather than a version of it.)
  //
  // THE SERVER IS THE SEED. A Supabase league is created by `create_league()`,
  // its members by the linking RPCs, its weeks and games by the commissioner
  // through the adapter — every one of them server-side, under RLS, in a table
  // that already exists before any device boots. There is no state in which a
  // handset is the right place to invent a roster, a slate or a draft week.
  //
  // WHAT THE RG-12 GUARD ALONE LEFT OPEN, and why one line is not enough.
  // `maySeedUserData` protects USER_MUTABLE_KEYS only, so the walk below would
  // still reach cfbp_settings, cfbp_comments, cfbp_notifications and the three
  // SCRIBE keys — and push each of them at the adapter. Two outcomes, both
  // wrong: a commissioner session WRITES a default settings blob over a league
  // that has one, and every other session throws AdapterWriteRefusedError out
  // of whatever called ensureSeedData(). Neither is "seeding was refused"; the
  // first is a silent overwrite and the second is a crash in a boot path.
  //
  // FAIL-SAFE BY CONSTRUCTION: an empty read in this mode means the hydrate has
  // not landed, and app.js's isContentWithheld() is true for exactly that
  // state, so nothing renders an empty league as though it were a real one.
  // `{ confirmEmpty: true }` does NOT override this — it is the answer to "is
  // this SHEET really new", a question the Supabase path never asks.
  if (getBackendMode() === 'supabase') {
    console.info('[Storage] supabase data mode: seeding is skipped entirely — the server is the seed, and a device is never the right place to invent league data.');
    return;
  }
  const shared = getBackendMode() !== 'local';
  const maySeedUserData = !shared || opts.confirmEmpty === true;

  const seed = (key, value) => {
    if (load(key)) return;                                    // already present
    if (!maySeedUserData && USER_MUTABLE_KEYS.includes(key)) {
      // Refuse, loudly. An empty user-data key against a shared store means
      // hydrate did not deliver it — NOT that the league has no data.
      console.warn('[Storage] REFUSING to seed user-mutable key in shared-backend mode:', key,
        '— an empty read is not proof the store is empty (RG-12).');
      return;
    }
    save(key, value);
  };

  seed(KEYS.SETTINGS,     DEFAULT_SETTINGS);
  seed(KEYS.PLAYERS,      DEMO_PLAYERS);
  seed(KEYS.WEEKS,        [REAL_WEEK_1_2026, DEMO_WEEK]);
  seed(KEYS.GAMES,        REAL_WEEK_1_2026_KNOWN_GAMES);
  seed(KEYS.AVAIL_GAMES,  {});
  seed(KEYS.PICKS,        DEMO_PICKS);
  seed(KEYS.RESULTS,      []);
  seed(KEYS.OBLIGATIONS,  []);
  seed(KEYS.NICKNAMES,    {});
  seed(KEYS.LOCK_OVR,     {});
  seed(KEYS.TB_GUESSES,   {});
  seed(KEYS.EP_GUESSES,   {});
  seed(KEYS.REJECTED_SUGG,{});
  seed(KEYS.REACTIONS,    {});
  seed(KEYS.FEEDBACK,     []);
  seed(KEYS.FEEDBACK_EXCLUDED, []);
  seed(KEYS.COMMENTS,     []);
  seed(KEYS.ACTIVE_WEEK,  REAL_WEEK_1_2026.weekId);
  // Not in USER_MUTABLE_KEYS — same class as COMMENTS/FEEDBACK/REACTIONS just
  // above: user-GENERATED content, not commissioner-authored league state, and
  // — unlike those — a genuinely NEW key as of this release, so no device has
  // ever held real data under it. An empty read cannot be confused with a
  // failed hydrate for a key that never existed before now (RG-12's concern is
  // specific to keys that already hold live data). Safe to seed unconditionally.
  seed(KEYS.NOTIFICATIONS, []);
  // Build 2b (2026-09-10) — brand-new keys as of this release, same class as
  // NOTIFICATIONS just above: nothing has ever held real data under them, so
  // an empty read cannot be confused with a failed hydrate (RG-12's concern
  // is specific to keys that ALREADY hold live data). Safe to seed
  // unconditionally, not gated behind maySeedUserData.
  seed(KEYS.SCRIBE_LEARNINGS, []);
  seed(KEYS.SCRIBE_CANON,     []);
  seed(KEYS.SCRIBE_REPORTS,   []);
}

export function resetToDemo() {
  save(KEYS.SETTINGS,   DEFAULT_SETTINGS);
  save(KEYS.PLAYERS,    DEMO_PLAYERS);
  save(KEYS.WEEKS,      [REAL_WEEK_1_2026, DEMO_WEEK]);
  save(KEYS.GAMES,      [...REAL_WEEK_1_2026_KNOWN_GAMES, ...DEMO_GAMES]);
  save(KEYS.AVAIL_GAMES,{});
  save(KEYS.PICKS,      DEMO_PICKS);
  save(KEYS.RESULTS,    []);
  save(KEYS.OBLIGATIONS,[]);
  save(KEYS.NICKNAMES,  {});
  save(KEYS.LOCK_OVR,   {});
  save(KEYS.TB_GUESSES, {});
  save(KEYS.EP_GUESSES, {});
  save(KEYS.REJECTED_SUGG, {});
  save(KEYS.REACTIONS, {});
  save(KEYS.FEEDBACK, []);
  save(KEYS.FEEDBACK_EXCLUDED, []);
  save(KEYS.COMMENTS, []);
  // FEAT-2 / DI-175d — the ONE shrinking write this key has, and it is the
  // same accepted residual backend.js already documents for cfbp_feedback: a
  // device holding a pre-reset mirror can union old rows back until it
  // re-hydrates. A full factory reset that left months of requests pointing
  // at wiped games would be the worse outcome.
  save(KEYS.GAME_REQUESTS, []);
  save(KEYS.ACTIVE_WEEK, REAL_WEEK_1_2026.weekId);
  save(KEYS.FETCH_PROOF, null);
  save(KEYS.NOTIFICATIONS, []);
  save(KEYS.SCRIBE_LEARNINGS, []);
  save(KEYS.SCRIBE_CANON, []);
  save(KEYS.SCRIBE_REPORTS, []);
  clearSession();
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────

export function getSettings() { return{...DEFAULT_SETTINGS,...(load(KEYS.SETTINGS)||{})}; }
/**
 * Change ONE setting. This is a read-modify-write of the whole `cfbp_settings`
 * blob — ~17 independent fields under a single seam key — so it must tell the
 * backend which field it actually meant (RG-24). Without that, a device whose
 * mirror predates another device's change pushes its stale view of the other
 * 16 fields and silently reverts them; that is how a cleared chat came back
 * (chatEpochSeq → 0) and it applies identically to chatEnabled and
 * randomizePicksEnabled. The field list is DECLARED here rather than diffed in
 * backend.js on purpose: a diff cannot distinguish a real edit from
 * getSettings()'s DEFAULT_SETTINGS spread materializing a field the stored
 * blob never had.
 */
export function saveSetting(k,v){ const s=getSettings();s[k]=v;save(KEYS.SETTINGS,s,[k]); }
/** Replace the ENTIRE settings blob (factory reset / import). Deliberately
 *  declares no field list — every field is intended. */
export function saveSettings(s){ save(KEYS.SETTINGS,s); }

// ─── TIMEZONE + THEME (per-player when logged in, per-device otherwise) ───────
//
// Each player can choose their own time zone and color theme. Preferences live
// on the player record (under `preferences.tz` / `preferences.theme`) so when
// the league is connected to a shared backend, every player's choices follow
// THEM across devices instead of being clobbered by whoever logged in last.
//
// UN-127 (2026-08-27, Drew, applied to timezone this same day): signed out,
// BOTH preferences resolve to a fixed league default now — neither one reads
// a device-level `settings.*` fallback any more. That fallback used to let
// whichever anonymous person touched the control last repaint/re-zone the
// app for the next anonymous person on the same shared device. The controls
// that used to write those fallbacks are hidden while signed out (app.js
// renderThemeToggle/renderTzToggle), so `settings.theme` / `settings.timezone`
// can no longer drift away from their defaults going forward; any leftover
// values from before this change are simply unread, not deleted
// (CONVENTIONS #10). Signed in is unchanged for both: preferences live on the
// player record and follow them across devices.

function _playerPref(key) {
  const sess = getSession();
  if (!sess?.playerId) return undefined;
  const p = getPlayer(sess.playerId);
  return p?.preferences?.[key];
}

function _setPlayerPref(key, value) {
  const sess = getSession();
  if (!sess?.playerId) return false;
  const players = getPlayers();
  const idx = players.findIndex(p => p.playerId === sess.playerId);
  if (idx < 0) return false;
  const prefs = { ...(players[idx].preferences || {}), [key]: value };
  players[idx] = { ...players[idx], preferences: prefs };
  save(KEYS.PLAYERS, players);
  return true;
}

export function getTimezone() {
  // Signed out, TZ is ALWAYS the league default (DEFAULT_TZ) — the
  // settings.timezone device-level fallback is deliberately no longer
  // consulted here. See the block comment above this section.
  return _playerPref('tz') || DEFAULT_TZ;
}
export function setTimezone(tzKey) {
  // Only a SIGNED-IN player can persist a timezone choice now. No device-
  // level fallback write any more — _setPlayerPref() itself already returns
  // false and no-ops when nobody is logged in, so this silently does nothing
  // for an anonymous caller rather than reintroducing the shared-device
  // fallback. The control that called this while signed out has been removed
  // (app.js renderTzToggle), so in practice this path isn't reachable while
  // signed out — this is defense in depth, not the only gate.
  _setPlayerPref('tz', tzKey);
}

// ── v0.17.0 chat identity + notification prefs (per-player, follow the person) ──
export function getAccent() { return _playerPref('accent') || null; }
/**
 * XSS-HARDEN round 2, C2 (2026-09-12) — VALIDATE AT THE WRITE SEAM.
 *
 * `accent` is interpolated into a `style="background:${accent};color:#fff"`
 * attribute at two chat-ui render sites. An attribute needs no angle bracket
 * to break out of: `red" onmouseover="…` closes the style value and starts a
 * new attribute on a real element. The render sites now escape (the sink
 * fix), and this is the other half — a value that is not one of the eight
 * palette colours never enters a player record in the first place.
 *
 * ALLOW-LIST, not a pattern, and no normalisation: an exact match against
 * CHAT_ACCENTS (the same list the swatch row renders from), or `null` to
 * clear. Anything else is REFUSED — the preference is left as it was rather
 * than being coerced into something adjacent, because a silent coercion is
 * how a "close enough" value gets a second life later.
 *
 * THE ONLY CHANGE TO THIS FILE. The load()/save() seam, its synchronous
 * reads, and every other accessor are untouched (AD-02).
 */
export function setAccent(color) {
  if (color === null || color === undefined || color === '') { _setPlayerPref('accent', null); return true; }
  if (!CHAT_ACCENTS.includes(color)) {
    console.warn('[storage] setAccent refused a value outside the palette:', color);
    return false;
  }
  _setPlayerPref('accent', color);
  return true;
}
export function getChatNick() { return _playerPref('chatNick') || null; }
export function setChatNick(nick) { _setPlayerPref('chatNick', (nick || '').slice(0, 16)); }
export function getNotifPrefs() {
  // toastDuration: ms the floating toast stays before auto-removing; 0 means
  // "Until dismissed" (no auto-remove timer). Default 6000 (CONVENTIONS #10 —
  // old/absent records must not change behavior until the player opens prefs).
  return { sound: false, toasts: true, systemEvents: true, toastDuration: 6000, ...(_playerPref('notif') || {}) };
}
export function setNotifPrefs(prefs) { _setPlayerPref('notif', { ...getNotifPrefs(), ...prefs }); }
// ── DI-267 (SCRIBE v3, Package A, 2026-09-23) — the one-time hard-line nudge ──
//
// A per-PLAYER flag, on the player record's `preferences` like every other
// per-player state (CLAUDE.md's architecture bullet 4), so the prompt follows
// the person across devices and a player who dismissed it on his phone does not
// meet it again on a laptop. Device-level would have been the easy version and
// the wrong one: this prompt exists because the league's ceiling went up, which
// is a fact about the player, not about the browser.
//
// AN ACCESSOR PAIR THROUGH THE SEAM (AD-02, CONVENTIONS #8) rather than a
// reader poking `player.preferences` at the call site, which is what the rest of
// this section does and what makes the seam checkable at all.
//
// DEFAULT-WHEN-MISSING: `null` — "never shown". Every existing player record
// predates this field, and the honest reading of an absent value is that the
// prompt has not happened yet, which is exactly what makes it fire once
// (CONVENTIONS #10).
export function getHardLinePromptSeenAt() {
  return _playerPref('hardLinePromptSeenAt') || null;
}
export function setHardLinePromptSeenAt(iso) {
  return _setPlayerPref('hardLinePromptSeenAt', String(iso || new Date().toISOString()));
}

export function getAccentFor(playerId) {
  const p = (load(KEYS.PLAYERS) || []).find(x => x.playerId === playerId);
  return p?.preferences?.accent || null;
}
export function getChatNickFor(playerId) {
  const p = (load(KEYS.PLAYERS) || []).find(x => x.playerId === playerId);
  return p?.preferences?.chatNick || null;
}

// ── Groups A/B notification prefs (UN-139…UN-148, 2026-09-10, DI-A4) ──────────
// A DIFFERENT concept from getNotifPrefs()/setNotifPrefs() above, which govern
// the existing in-app toast (sound/toasts/systemEvents/toastDuration) while the
// app is OPEN. These govern the Notification Center's push/in-app category
// toggles — `player.preferences.notifyPushMaster` (the one master "Push
// Notifications" row) and `player.preferences.notifyCategories.*` (five
// category rows: chat/pickReminders/leagueUpdates/results/obligations).
// CONVENTIONS #10 — default-when-missing: an old/absent record reads as
// EVERYTHING ON (opt-out model), matching the existing chat-prefs precedent
// (`toasts`/`systemEvents` also default true) so a fresh install behaves
// exactly like an explicit "leave it on" choice.
export const DEFAULT_NOTIFY_CATEGORIES = Object.freeze({
  chat: true, pickReminders: true, leagueUpdates: true, results: true, obligations: true,
});

// Session-scoped (own prefs) — used by the Notification Center's settings card.
export function getNotifyPushMaster() {
  const v = _playerPref('notifyPushMaster');
  return v === undefined ? true : !!v;
}
export function setNotifyPushMaster(on) { _setPlayerPref('notifyPushMaster', !!on); }
export function getNotifyCategoryPrefs() {
  return { ...DEFAULT_NOTIFY_CATEGORIES, ...(_playerPref('notifyCategories') || {}) };
}
export function setNotifyCategoryPref(category, on) {
  _setPlayerPref('notifyCategories', { ...getNotifyCategoryPrefs(), [category]: !!on });
}

// ── FEAT-8a / UN-179 (2026-09-12, DI-179d) — per-player section order ────────
//
// `player.preferences.sectionOrder = { dashboard: [...], standings: [...] }` —
// ONE preference key holding BOTH pages, so a future third page is an entry
// rather than a new key (and `clearSectionOrder('dashboard')` provably cannot
// touch Standings, which is an assertion in layouttest.mjs).
//
// Deliberately on the PLAYER RECORD via _playerPref/_setPlayerPref — the same
// pair tz/theme/accent/chatNick/notif all go through — and deliberately NOT on
// `settings.*`. `settings` is one league-shared blob synced to the Sheet: one
// player's write is every player's read. That is the trap UN-124 documented,
// and `settings.dashboardColumnOrder` (app.js, a DIFFERENT and older feature)
// is still sitting in it. UN-179 does not extend that pattern.
//
// CONVENTIONS #10 (default-when-missing): absent `sectionOrder`, or a record
// written before this release, reads as `[]`, which app.js's effectiveOrder()
// resolves to the shipped default order byte-for-byte. Every player record in
// the Sheet today is already in that state, so UN-22/RG-01's locked dashboard
// order is unaffected for anyone who has not opted in.
//
// Anonymous: _playerPref returns undefined and _setPlayerPref no-ops when
// nobody is signed in, so an anonymous viewer reads [] (the default order) and
// can persist nothing — UN-127's shared-device ruling, same shape as theme/tz.
// Defense in depth; app.js also renders no control while signed out (DI-179g).
export function getSectionOrder(pageKey) {
  const all = _playerPref('sectionOrder') || {};
  const ids = all[pageKey];
  // Coerce at the boundary (CONVENTIONS #7) — this blob round-trips through a
  // Google Sheet cell and a hand-editable JSON export.
  return Array.isArray(ids) ? ids.filter(id => typeof id === 'string') : [];
}
export function setSectionOrder(pageKey, ids) {
  if (!pageKey) return;
  const all = { ...(_playerPref('sectionOrder') || {}) };
  all[pageKey] = (Array.isArray(ids) ? ids : []).filter(id => typeof id === 'string');
  _setPlayerPref('sectionOrder', all);
}
export function clearSectionOrder(pageKey) {
  if (!pageKey) return;
  const all = { ...(_playerPref('sectionOrder') || {}) };
  delete all[pageKey];
  _setPlayerPref('sectionOrder', all);
}

// ANY-player reads — the policy layer (js/notifications.js) resolves whether a
// RECIPIENT (not necessarily the signed-in session) wants a given category,
// exactly the same shape getAccentFor()/getChatNickFor() already use above.
export function getNotifyPushMasterFor(playerId) {
  const p = (load(KEYS.PLAYERS) || []).find(x => x.playerId === playerId);
  const v = p?.preferences?.notifyPushMaster;
  return v === undefined ? true : !!v;
}
export function getNotifyCategoryPrefsFor(playerId) {
  const p = (load(KEYS.PLAYERS) || []).find(x => x.playerId === playerId);
  return { ...DEFAULT_NOTIFY_CATEGORIES, ...(p?.preferences?.notifyCategories || {}) };
}

// ── Groups A/B notification records (DI-A3, §2) ───────────────────────────────
// ONE shared list, exactly the KEYS.COMMENTS precedent — every read/write goes
// through load()/save() like every other key (CONVENTIONS #8). Retention
// pruning (30 days / 200-record cap per player, §1.3) is a POLICY concern, not
// a storage concern, and lives in js/notifications.js — this pair is a pure
// read/write seam, same shape as every getX/setX pair above it.
export function getNotifications() { return load(KEYS.NOTIFICATIONS) || []; }
export function setNotifications(list) { save(KEYS.NOTIFICATIONS, list); }

export function getTheme() {
  // v0.17.0 — league default is the school-agnostic neutral palette; players
  // opt into school themes per their own preference.
  //
  // UN-127 (2026-08-27, Drew): signed OUT, theme is ALWAYS 'neutral' — the
  // settings.theme device-level fallback is deliberately no longer consulted
  // here. It used to let whichever anonymous person touched the dropdown
  // last repaint the app for the next anonymous person on the same shared
  // device ("too much flipping" with multiple people not logged in). The
  // control that wrote settings.theme is now hidden while signed out
  // (app.js renderThemeToggle) so this field can no longer drift away from
  // 'neutral' going forward; old values left over from before this change
  // are simply unread, not deleted (CONVENTIONS #10).
  return _playerPref('theme') || 'neutral';
}
export function setTheme(themeKey) {
  // UN-127: only a SIGNED-IN player can persist a theme choice. No device-
  // level fallback write anymore — _setPlayerPref() itself already returns
  // false and no-ops when nobody is logged in, so this silently does nothing
  // for an anonymous caller rather than reintroducing the shared-device
  // fallback. The UI control that used to call this while signed out has
  // been removed (app.js renderThemeToggle), so in practice this path is not
  // reachable while signed out — this is defense in depth, not the only gate.
  _setPlayerPref('theme', themeKey);
}

/**
 * RG-198 — the DEVICE's memory of the palette it last painted. See KEYS.
 * THEME_HINT for why this exists and why it is not a second source of truth.
 *
 * Reads answer '' for absent, malformed or non-string values (CONVENTIONS #10):
 * every caller falls back to getTheme(), which is today's behaviour exactly.
 * Validation against the seven real theme keys is the CALLER's job — this seam
 * owns storage, not the palette list, and app.js/index.html both splice the
 * value into a CSS class name.
 */
export function getThemeHint() {
  const v = load(KEYS.THEME_HINT);
  return typeof v === 'string' ? v : '';
}
export function setThemeHint(key) {
  save(KEYS.THEME_HINT, String(key || ''));
}

// ─── FETCH PROOF ──────────────────────────────────────────────────────────────

export function saveFetchProof(r){ save(KEYS.FETCH_PROOF,r); }
export function getFetchProof(){ return load(KEYS.FETCH_PROOF)||null; }


// ─── SITE ACCESS PIN ──────────────────────────────────────────────────────────

export function isSiteUnlocked() {
  try { return localStorage.getItem(SITE_PIN_KEY) === '1'; }
  catch { return false; }
}
export function setSiteUnlocked(val) {
  try { if(val) localStorage.setItem(SITE_PIN_KEY,'1'); else localStorage.removeItem(SITE_PIN_KEY); }
  catch {}
}
export function verifySitePin(pin) {
  // Settings override takes precedence; falls back to the default constant.
  const override = (getSettings().sitePin || '').trim();
  const effective = override || SITE_PIN;
  return String(pin) === String(effective);
}
export function getEffectiveSitePin() {
  return (getSettings().sitePin || '').trim() || SITE_PIN;
}
export function setSitePin(newPin) {
  saveSetting('sitePin', String(newPin || '').trim());
}

// ─── SESSION ──────────────────────────────────────────────────────────────────

// Phase III Step 3a (DI-180f) — the ONE seam edit this build makes to
// storage.js, per its own explicit scope. getSession() delegates to
// js/auth.js's synthesized {playerId,isAdmin,playerVerified} shape ONLY when
// authMode:'supabase'; every other line in this file, and every other
// function in this pair, is untouched. Still synchronous (CONVENTIONS #9) —
// getSupabaseSession() is a plain in-memory read, never a fetch.
export function getSession(){
  if (getAuthMode() === 'supabase') {
    try { return getSupabaseSession(); }
    catch { return {playerId:null,isAdmin:false,playerVerified:false}; }
  }
  return load(KEYS.SESSION)||{playerId:null,isAdmin:false,playerVerified:false};
}
/**
 * ══ DI §6.7 — A GUARDED NO-OP IN authMode:'supabase' ═════════════════════════
 * (Coordinator ruling 2026-09-18, gap 3.)
 *
 * getSession() already delegates to js/auth.js in this mode (just above), so
 * `cfbp_session` is UNREADABLE here — which is precisely what makes writing it
 * dangerous rather than merely pointless. A stray call would lay down a
 * PIN-era `{playerId, isAdmin}` record that nothing in this mode can see, and
 * that a ROLLBACK to `pins` would read straight back as a live session. That is
 * the SEC F1-R1 hazard (js/backend.js:339-357) arriving by a different door: a
 * device that was a commissioner before cutover becoming one again, silently,
 * on a config change nobody connected to it.
 *
 * The PIN login paths are retired in this mode (DI-180g), so no production
 * caller should reach this at all — which is why it WARNS rather than returning
 * quietly. A no-op that says nothing is how the next such caller gets written.
 *
 * clearSession() below is deliberately NOT guarded: removing that record is
 * always safe and app.js's boot does it on purpose on a supabase config read.
 */
export function setSession(playerId,isAdmin=false,playerVerified=false){
  if (getAuthMode() === 'supabase') {
    console.warn('[Storage] REFUSING to write cfbp_session in supabase auth mode:',
      'the session lives in the Supabase auth session and the adapter\'s owner tuple.',
      'A PIN-era record written here is invisible to this mode and would be read back as a live session by a rollback to pins.');
    return;
  }
  save(KEYS.SESSION,{playerId,isAdmin,playerVerified,setAt:new Date().toISOString()});
}
export function clearSession(){ localStorage.removeItem(KEYS.SESSION); }

// ─── PLAYER AUTH ──────────────────────────────────────────────────────────────

/**
 * Does this player have a USABLE PIN on file?
 *
 * One definition, used by both verifyPlayerPin() below and the login-failure
 * copy in app.js, so "has a PIN" cannot mean two different things in the gate
 * and in the message explaining the gate.
 *
 * A hash is usable only if it is a non-empty string. `btoa()` never returns
 * whitespace and never returns '', so anything else — a number a Sheets cell
 * deserialised to, a null, a mangled object, a cleared cell — is not a hash.
 */
export function hasPlayerPin(playerId){
  const p=getPlayer(playerId);
  return !!p && typeof p.pinHash==='string' && p.pinHash.trim()!=='';
}
/**
 * RG-40, 2026-08-26 — THIS FAILED OPEN. The shipped line was:
 *
 *     if(!p.pinHash)return true;      // ANY pin passes
 *
 * A missing hash was read as "this player hasn't set a PIN yet, so don't gate
 * them." That is an authentication bypass wearing a convenience default, and it
 * was harmless only for as long as no real account ever lost its hash.
 *
 * RG-39 made it live-exploitable: a stale mirror re-applied over the Sheet
 * stripped `email` and `pinHash` from every player and pushed the result
 * league-wide. Those accounts did not have their PINs "reset" — they stopped
 * having a PIN check at all, and anyone past the shared site PIN could sign in
 * as anybody and edit their picks.
 *
 * Drew's ruling: FAIL CLOSED. No hash, no login. The recovery path is the
 * commissioner, who authenticates against `settings.adminPasswordHash` — a
 * different mechanism that touches no player record — and re-issues the PIN
 * from Commissioner → Players → Reset PIN. Deliberately NO self-service
 * recovery: a backdoor that restores access without a credential is the same
 * defect with a friendlier name.
 *
 * The player is told which of the two failures happened; see
 * loginFailureMessage() in app.js. Asserted in loadtest [56].
 */
export function verifyPlayerPin(playerId,pin){
  if(!hasPlayerPin(playerId))return false;
  return getPlayer(playerId).pinHash===btoa(String(pin));
}
export function setPlayerPin(playerId,pin){
  const p=getPlayer(playerId); if(!p)return;
  savePlayer({...p,pinHash:btoa(String(pin))});
}
/**
 * Decode the stored PIN. Commissioner-only convenience used by the
 * "Show PIN" / "Email PIN" features. Never call this on the main page.
 */
export function getPlayerPin(playerId){
  const p=getPlayer(playerId);
  if(!p||!p.pinHash) return '';
  try { return atob(p.pinHash); } catch { return ''; }
}

// ─── PLAYERS ──────────────────────────────────────────────────────────────────

export function getPlayers(){ return load(KEYS.PLAYERS)||[]; }
export function getPlayer(id){ return getPlayers().find(p=>p.playerId===id)||null; }
export function savePlayer(player){
  const all=getPlayers();
  const idx=all.findIndex(p=>p.playerId===player.playerId);
  const upd={...player,updatedAt:new Date().toISOString()};
  if(idx>=0)all[idx]=upd;else all.push(upd);
  save(KEYS.PLAYERS,all);
}
export function addPlayer(p){ const all=getPlayers();all.push(p);save(KEYS.PLAYERS,all); }

// ─── NICKNAMES ────────────────────────────────────────────────────────────────

export function getNicknames(){ return load(KEYS.NICKNAMES)||{}; }
export function getNickname(weekId,playerId){ return getNicknames()[`${weekId}__${playerId}`]||null; }
export function setNickname(weekId,playerId,nick){
  const all=getNicknames(); const key=`${weekId}__${playerId}`;
  if(nick?.trim())all[key]=nick.trim();else delete all[key];
  save(KEYS.NICKNAMES,all);
}
export function getDisplayNamePlain(weekId,playerId,players){
  const p=(players||getPlayers()).find(x=>x.playerId===playerId);
  if(!p)return'Unknown';
  const n=getNickname(weekId,playerId);
  return n?`${p.displayName} "${n}"`:p.displayName;
}

// ─── TIEBREAKER GUESSES ───────────────────────────────────────────────────────

export function getTiebreakerGuesses(){ return load(KEYS.TB_GUESSES)||{}; }
export function getTiebreakerGuess(weekId,playerId){
  const v=getTiebreakerGuesses()[`${weekId}__${playerId}`];
  return v!==undefined?v:null;
}
export function setTiebreakerGuess(weekId,playerId,value){
  const all=getTiebreakerGuesses();
  const key=`${weekId}__${playerId}`;
  all[key]=Number(value);
  // RG-49 — DECLARE THE FIELD. This is a read-modify-write of a blob holding
  // one entry PER PLAYER PER WEEK under a single seam key: exactly the shape
  // RG-24 was raised for (`cfbp_settings`, ~17 independent fields), one key
  // over. Without the field list, a device booting on a stale mirror re-applies
  // its whole obsolete view of everyone's guesses over the fresh remote and
  // flushPush sends it to the Sheet — so one player's ordinary submit during the
  // 10–20s Apps Script cold start silently deletes the other five. Declared
  // here, not diffed in backend.js, for the same reason saveSetting() declares:
  // a diff cannot tell a real edit from a key this device never learned about.
  save(KEYS.TB_GUESSES,all,[key]);
}

// ─── ISCHEMIC EXTRA POINT GUESSES (v0.16.0) ───────────────────────────────────
// Longest-made-FG guesses, blackjack rules. Same shape as tiebreaker guesses:
// { "weekId__playerId": yards }. Syncs through the seam like all league data.

export function getExtraPointGuesses(){ return load(KEYS.EP_GUESSES)||{}; }
export function getExtraPointGuess(weekId,playerId){
  const v=getExtraPointGuesses()[`${weekId}__${playerId}`];
  return v!==undefined?v:null;
}
export function setExtraPointGuess(weekId,playerId,value){
  const all=getExtraPointGuesses();
  const key=`${weekId}__${playerId}`;
  if(value===null||value===''||value===undefined) delete all[key];
  else all[key]=Number(value);
  // RG-49 — same reasoning as setTiebreakerGuess above. The RG-24 rebase also
  // carries the DELETE correctly: a field named in the list but absent from the
  // written value is deleted from the fresh remote, so clearing your own guess
  // stays cleared and still cannot touch anyone else's.
  save(KEYS.EP_GUESSES,all,[key]);
}

// ─── ACTIVE WEEK ──────────────────────────────────────────────────────────────

export function getActiveWeekId(){ return load(KEYS.ACTIVE_WEEK)||null; }
export function setActiveWeekId(weekId){ save(KEYS.ACTIVE_WEEK,weekId); }

// ─── WEEKS ────────────────────────────────────────────────────────────────────

export function getWeeks(){ return load(KEYS.WEEKS)||[]; }
export function getWeek(weekId){ return getWeeks().find(w=>w.weekId===weekId)||null; }

export function getCurrentWeek(){
  const activeId=getActiveWeekId();
  if(activeId){ const f=getWeeks().find(w=>w.weekId===activeId); if(f)return f; }
  const weeks=getWeeks();
  const active=weeks.find(w=>['open','locked','live'].includes(w.status));
  if(active)return active;
  return[...weeks].sort((a,b)=>b.weekNumber-a.weekNumber)[0]||null;
}

export function saveWeek(week){
  const weeks=getWeeks();
  const idx=weeks.findIndex(w=>w.weekId===week.weekId);
  const upd={...week,updatedAt:new Date().toISOString()};
  if(idx>=0)weeks[idx]=upd;else weeks.push(upd);
  save(KEYS.WEEKS,weeks);
}
export function deleteWeek(weekId){ save(KEYS.WEEKS,getWeeks().filter(w=>w.weekId!==weekId)); }

export function getEffectiveWeekStatus(week){
  if(!week)return null;
  if(week.status==='final'||week.status==='draft')return week.status;
  const now=new Date();
  if(week.picksLockAt&&now>=new Date(week.picksLockAt))return'locked';
  if(week.picksOpenAt&&now>=new Date(week.picksOpenAt))return'open';
  return week.status;
}

/**
 * UN-116 — THE ONE MOMENT OF TRUTH for revealing other players' selections.
 *
 * Every surface that could expose a pick, tiebreaker or Extra Point guess that
 * is not the viewer's own asks THIS function and nothing else: the dashboard
 * matrix, the compact chips, the score summary, the chat pick chips (⚡), the
 * reveal ritual, and the Extra Point post-to-chat. Before this existed the
 * threshold was written out longhand at nine call sites and had already
 * drifted — the compact view blinded correctly while the standard matrix had
 * no check at all, so submitting your picks revealed everyone else's while you
 * could still go back and edit your own.
 *
 * The threshold is LIVE or FINAL — deliberately NOT 'locked'. Drew, 2026-08-12:
 * picks stay editable while the slate is open (a locked architectural
 * decision), so visibility must key off a state nobody can undo, and it must
 * not open one moment earlier than the games themselves. The chat reveal
 * ritual was moved off lock to match this rather than the reverse.
 *
 * `week.status === 'live'` and `week.status === 'final'` are honoured
 * explicitly, ahead of the computed effective status.
 *
 * RG (2026-08-12) — the 'live' half was missing, and the whole live window
 * rendered blind for any week whose commissioner had filled in Auto-Open At or
 * Auto-Lock At (Week tab). getEffectiveWeekStatus() tests those two date fields
 * BEFORE falling through to week.status and has no 'live' branch at all, so it
 * reported 'open' or 'locked' for a week the app itself had already advanced to
 * LIVE. Matrix, compact chips, tiebreakers, chat pick chips and the reveal
 * ritual all went dark until manual finalize.
 *
 * week.status === 'live' is the authoritative signal: tickAutoTransition()
 * writes it (LOCKED → LIVE) the moment the first game kicks off and persists it
 * through saveWeek, which is exactly the moment picks become public. A
 * scheduled open/lock time describes a window that has, by definition, already
 * closed by then and must not override it.
 *
 * This is deliberately scoped to arePicksPublic() rather than teaching
 * getEffectiveWeekStatus() to return 'live'. That broader change would also
 * move canPlayerSubmitPicks(), i.e. pick editability — a locked architectural
 * decision — and is not needed to make the blind rule correct. The residual
 * (getEffectiveWeekStatus still cannot express 'live') is recorded for Drew.
 */
export function arePicksPublic(week){
  if(!week)return false;
  const eff=getEffectiveWeekStatus(week);
  return eff==='live'||eff==='final'||week.status==='live'||week.status==='final';
}

// ─── SLATE GAMES (selected for this week) ────────────────────────────────────

export function getGames(weekId=null){
  const g=load(KEYS.GAMES)||[];
  return weekId?g.filter(x=>x.weekId===weekId):g;
}
export function getGame(gameId){ return getGames().find(g=>g.gameId===gameId)||null; }

export function saveGame(game){
  const all=getGames();
  const idx=all.findIndex(g=>g.gameId===game.gameId);
  const upd={...game,updatedAt:new Date().toISOString()};
  if(idx>=0)all[idx]=upd;else all.push(upd);
  save(KEYS.GAMES,all);
}
export function deleteGame(gameId){
  save(KEYS.GAMES,getGames().filter(g=>g.gameId!==gameId));
  // Cascade: remove any picks tied to this game so they don't orphan / skew scoring.
  deletePicksForGame(gameId);
  // Also clear any lock override for the removed game.
  const o=getGameLockOverrides(); if(o[gameId]){ delete o[gameId]; save(KEYS.LOCK_OVR,o); }
}
export function deletePicksForGame(gameId){
  const all=load(KEYS.PICKS)||[];
  const filtered=all.filter(p=>p.gameId!==gameId);
  if(filtered.length!==all.length) save(KEYS.PICKS,filtered);
  return all.length-filtered.length; // number of picks removed
}
export function countPicksForGame(gameId){
  return (load(KEYS.PICKS)||[]).filter(p=>p.gameId===gameId).length;
}
export function saveAllGamesForWeek(weekId,newGames){
  const existing=getGames().filter(g=>g.weekId!==weekId);
  save(KEYS.GAMES,[...existing,...newGames]);
}
export function clearSlateForWeek(weekId){
  save(KEYS.GAMES,getGames().filter(g=>g.weekId!==weekId));
}

// ─── AVAILABLE GAMES POOL (fetched from ESPN, not yet on slate) ───────────────
// Stored as { weekId: [game, ...] }

export function getAvailableGames(weekId){
  const all=load(KEYS.AVAIL_GAMES)||{};
  return all[weekId]||[];
}
export function saveAvailableGames(weekId,games){
  const all=load(KEYS.AVAIL_GAMES)||{};
  all[weekId]=games;
  save(KEYS.AVAIL_GAMES,all);
}
export function clearAvailableGames(weekId){
  const all=load(KEYS.AVAIL_GAMES)||{};
  delete all[weekId];
  save(KEYS.AVAIL_GAMES,all);
}

// ─── GAME LOCK OVERRIDES ─────────────────────────────────────────────────────

export function getGameLockOverrides(){ return load(KEYS.LOCK_OVR)||{}; }
export function setGameLockOverride(gameId,unlocked){
  const o=getGameLockOverrides();
  if(unlocked)o[gameId]='unlocked';else delete o[gameId];
  save(KEYS.LOCK_OVR,o);
}
export function clearAllLockOverrides(){ save(KEYS.LOCK_OVR,{}); }

// ─── REJECTED SUGGESTIONS ─────────────────────────────────────────────────────
// Per-week set of suggested-game keys the Commissioner has dismissed, so they
// don't keep reappearing in the suggested slate. Keyed by weekId → [keys].
// A "suggestion key" is a stable matchup identity: "homeTeam@@awayTeam" (lowercased),
// or the ESPN event id when present. This survives re-fetches.

export function suggestionKeyOf(game){
  if(!game) return '';
  if(game.espnEventId) return `espn:${game.espnEventId}`;
  return `m:${(game.homeTeam||'').toLowerCase()}@@${(game.awayTeam||'').toLowerCase()}`;
}
export function getRejectedSuggestions(weekId){
  const all=load(KEYS.REJECTED_SUGG)||{};
  return all[weekId]||[];
}
export function rejectSuggestion(weekId, game){
  const all=load(KEYS.REJECTED_SUGG)||{};
  const key=suggestionKeyOf(game);
  const list=new Set(all[weekId]||[]);
  list.add(key);
  all[weekId]=[...list];
  save(KEYS.REJECTED_SUGG, all);
}
export function unrejectSuggestion(weekId, key){
  const all=load(KEYS.REJECTED_SUGG)||{};
  all[weekId]=(all[weekId]||[]).filter(k=>k!==key);
  save(KEYS.REJECTED_SUGG, all);
}
export function clearRejectedSuggestions(weekId){
  const all=load(KEYS.REJECTED_SUGG)||{};
  delete all[weekId];
  save(KEYS.REJECTED_SUGG, all);
}
export function isSuggestionRejected(weekId, game){
  return getRejectedSuggestions(weekId).includes(suggestionKeyOf(game));
}

// ─── EMOJI REACTIONS ──────────────────────────────────────────────────────────
// Storage shape: { weekId: { gameId: { emoji: [playerId, ...] } } }
// Each player can add multiple emojis to one game; toggling the same emoji
// twice removes their vote. Reactions auto-sync to the Sheet in shared mode
// (they go through load()/save() like everything else).

function _reactionsAll() { return load(KEYS.REACTIONS) || {}; }
function _saveReactions(all) { save(KEYS.REACTIONS, all); }

/** Returns { emoji: [playerId, …] } for one game (empty object when none). */
export function getReactionsForGame(weekId, gameId) {
  const all = _reactionsAll();
  return (all[weekId] && all[weekId][gameId]) || {};
}

/**
 * Toggle a player's reaction. Returns the new list for that emoji on that
 * game — or `false` if the emoji was REFUSED.
 *
 * XSS-HARDEN round 3 (F3-1, 2026-09-12) — ALLOW-LIST, mirroring setAccent()
 * above, and for the identical reason. The emoji becomes an object KEY in the
 * `cfbp_reactions` blob and is then rendered as element CONTENT by
 * renderReactionStrip() (app.js) and reactionsHTML() (chat-ui.js). The render
 * sites now escape (the sink fix); this is the other half — a value that is
 * not one of the 18 palette emoji never enters the blob in the first place.
 *
 * Exact match against REACTION_PALETTE (the same frozen list both pickers
 * render from, AD-20), no normalisation: multi-codepoint entries like ☝️
 * carry a variation selector, and "close enough" normalisation is how a
 * hostile value gets a second life later.
 *
 * REFUSAL RETURNS `false`, not `[]`: `[]` already means "toggled off, nobody
 * left," so callers could not tell the two apart. Both call sites in app.js
 * guard with Array.isArray() before .includes().
 *
 * THE ONLY CHANGE TO THIS FILE in round 3. The load()/save() seam, its
 * synchronous reads, and every other accessor are untouched (AD-02).
 */
export function toggleReaction(weekId, gameId, emoji, playerId) {
  if (!weekId || !gameId || !emoji || !playerId) return [];
  if (!REACTION_PALETTE.includes(emoji)) {
    console.warn('[storage] toggleReaction refused an emoji outside the palette:', emoji);
    return false;
  }
  const all = _reactionsAll();
  if (!all[weekId]) all[weekId] = {};
  if (!all[weekId][gameId]) all[weekId][gameId] = {};
  const current = new Set(all[weekId][gameId][emoji] || []);
  if (current.has(playerId)) current.delete(playerId);
  else current.add(playerId);
  if (current.size === 0) {
    delete all[weekId][gameId][emoji];
    if (!Object.keys(all[weekId][gameId]).length) delete all[weekId][gameId];
    if (!Object.keys(all[weekId]).length) delete all[weekId];
  } else {
    all[weekId][gameId][emoji] = [...current];
  }
  _saveReactions(all);
  return all[weekId]?.[gameId]?.[emoji] || [];
}

/** Wipe all reactions for a week (used by week-reset). */
export function clearReactionsForWeek(weekId) {
  const all = _reactionsAll();
  if (all[weekId]) { delete all[weekId]; _saveReactions(all); }
}

// ─── FEEDBACK / FEATURE REQUESTS ─────────────────────────────────────────────
// Player-submitted feedback (Priority 13). Lives at KEYS.FEEDBACK as a list.
// Each entry: { id, name, body, submittedAt, appVersion, siteUrl }.
// Goes through load()/save() so it auto-syncs to the Google Sheet when cloud
// sync is enabled — that's the "separate sheet" the priority asked for.
export function getFeedback() { return load(KEYS.FEEDBACK) || []; }
export function appendFeedback(entry) {
  const all = getFeedback();
  all.push(entry);
  save(KEYS.FEEDBACK, all);
}
export function clearFeedback() { save(KEYS.FEEDBACK, []); }

// ─── SCRIBE TRAINER OUTPUT (Build 2b, E3-E5, 2026-09-10, UN-161…163) ──────────
// Written server-side by `runTrainer` (backend/Code.gs) through the SAME
// setOne()/getOne() seam every other cfbp_* key uses — these accessors exist
// so the CLIENT (Comm→Data approve/reject UI, the Rules-page archive card)
// reads/writes through the storage seam like everything else (CONVENTIONS
// #8), never a parallel fetch path. A commissioner's approve/reject flip
// round-trips through the normal debounced push like any other setting.
//
// SCRIBE_LEARNINGS holds three item `kind`s in one flat array — see the KEYS
// comment above for why one key covers all three. Shape per item:
//   kind:'learning'       { learningId, category, instruction, evidenceSummary,
//                            confidence, status:'pending'|'approved'|'rejected',
//                            createdAt, reviewAt }
//   kind:'experiment'     { experiment, reason, confidence,
//                            status:'pending'|'approved'|'rejected' } — NEVER
//                            auto-applied regardless of confidence (E3 DI,
//                            §3 D1 calibration loop: "gated through the same
//                            human-approval step... never auto-applied").
//   kind:'fact_candidate' { playerId, key, value, confidence, sourceMessageId,
//                            status:'pending'|'approved'|'rejected' } — ALWAYS
//                            written pending regardless of confidence: D2
//                            (the Facts store this would apply to) does not
//                            exist yet in this build, so there is no runtime
//                            path an auto-approval could take effect on.
export function getScribeLearnings() { return load(KEYS.SCRIBE_LEARNINGS) || []; }
export function setScribeLearnings(list) { save(KEYS.SCRIBE_LEARNINGS, list || []); }

// SCRIBE_CANON items: { canonId, contextSummary, relevantFacts,
// preferredResponse, whyItWorked, pattern, source,
// approvalStatus:'pending'|'approved'|'rejected' } — field named
// `approvalStatus` (not `status`) per the DI's own field name for this kind.
export function getScribeCanon() { return load(KEYS.SCRIBE_CANON) || []; }
export function setScribeCanon(list) { save(KEYS.SCRIBE_CANON, list || []); }

// SCRIBE_REPORTS: one entry per Trainer run, oldest-first as stored (E5a's
// archive card reverses for display — see app.js). Read-only from the
// client's side; nothing here ever flips a report's own field. The only
// writer in production is `runTrainer` (backend/Code.gs), server-side,
// through this same physical key.
export function getScribeReports() { return load(KEYS.SCRIBE_REPORTS) || []; }
// Test-only seam (same `_xxxForTest` convention as `_resetEspnTeamsCacheForTest`)
// — trainertest.mjs's PART B needs to seed a report to exercise the archive
// card/modal without spinning up the full Apps Script harness for a
// client-side render test. No production call site.
export function _setScribeReportsForTest(list) { save(KEYS.SCRIBE_REPORTS, list || []); }

// ─── WHAT'S NEW — DEVICE POST LEDGER (FEAT-3 / DI-200c, UN-200) ──────────────
// The accessor pair CONVENTIONS #8 requires for every new stored thing: load()
// and save() are module-private, so a caller in app.js physically cannot reach
// this key any other way — which is the point of the seam.
//
// DEFAULT-WHEN-MISSING (CONVENTIONS #10): absent/garbage reads as the empty
// list, i.e. "this device has announced nothing yet". That direction is safe in
// exactly one way and unsafe in the other, so it is chosen rather than
// inherited: a false EMPTY costs one extra queued event that the server's id
// dedupe (AD-11) discards; a false NON-EMPTY would silently suppress the
// announcement of a release forever, on that device, with no way to notice.
export function getWhatsNewPosted() {
  const v = load(KEYS.WHATS_NEW_POSTED);
  return Array.isArray(v) ? v : [];
}
/** Appends `version` if new and keeps the last 20 — the same bound (and the
 *  same reason: an unbounded device ledger is a slow leak) as
 *  checkPickRevealDue()'s own `.slice(-20)`. */
export function setWhatsNewPosted(version) {
  if (!version) return;
  const list = getWhatsNewPosted();
  if (list.includes(version)) return;
  list.push(version);
  save(KEYS.WHATS_NEW_POSTED, list.slice(-20));
}

// ─── WAGER RESURFACE — DEVICE LEDGER (FEAT-5 / DI-202g, UN-202) ─────────────
// The accessor pair CONVENTIONS #8 requires. `load()`/`save()` are
// module-private, so app.js physically cannot reach this key any other way.
//
// DEFAULT-WHEN-MISSING (CONVENTIONS #10): absent or garbage reads as the empty
// list — "this device has resurfaced nothing yet". That direction is chosen,
// not inherited: a false EMPTY costs one extra queued event that the server's
// id dedupe (AD-11) discards; a false NON-EMPTY would silently suppress a
// wager's callback forever, on that device, with nothing to notice.
export function getWagerResurfaced() {
  const v = load(KEYS.WAGER_RESURFACED);
  return Array.isArray(v) ? v : [];
}
/** Appends `wagerId` if new and keeps the last 50 — bounded for the same reason
 *  WHATS_NEW_POSTED and `cfbp_reveal_emitted` are: an unbounded device ledger is
 *  a slow leak. 50 is a season's worth of wagers at this league's size. */
export function setWagerResurfaced(wagerId) {
  if (!wagerId) return;
  const list = getWagerResurfaced();
  if (list.includes(wagerId)) return;
  list.push(wagerId);
  save(KEYS.WAGER_RESURFACED, list.slice(-50));
}

// ─── LIFECYCLE POSTS — DEVICE LEDGER (N1 / FEAT-11, UN-204, DI-N1 gate 3) ────
// The accessor pair CONVENTIONS #8 requires. `load()`/`save()` are
// module-private, so app.js physically cannot reach this key any other way.
//
// DEFAULT-WHEN-MISSING (CONVENTIONS #10): absent or garbage reads as the empty
// list — "this device has posted nothing yet". Chosen in that direction for the
// same reason as its two siblings above: a false EMPTY costs one extra queued
// event that the server's id dedupe (AD-11) discards, while a false NON-EMPTY
// would silently suppress a lifecycle notice forever, on that device, with
// nothing to notice.
export function getLifecyclePosted() {
  const v = load(KEYS.LIFECYCLE_POSTED);
  return Array.isArray(v) ? v : [];
}
/** Appends the deterministic chat id if new and keeps the last 50 — bounded for
 *  the same reason WHATS_NEW_POSTED and WAGER_RESURFACED are: an unbounded
 *  device ledger is a slow leak. 50 covers a full season of week transitions
 *  plus obligations at this league's size. */
export function setLifecyclePosted(chatId) {
  if (!chatId) return;
  const list = getLifecyclePosted();
  if (list.includes(chatId)) return;
  list.push(chatId);
  save(KEYS.LIFECYCLE_POSTED, list.slice(-50));
}

// ─── PUSH-ACTIVE, PER DEVICE (N1 / FEAT-11, UN-204, DI-N3 — Drew's R10) ──────
// The accessor pair CONVENTIONS #8 requires. Read SYNCHRONOUSLY by
// chat-ui.js's showToast(); written by app.js's refreshPushActiveFlag(), which
// owns the async half (subscriptionState() + OneSignal's opted-in report) and
// never exposes it (CONVENTIONS #9).
//
// The coercion is deliberate: `=== true`, not truthiness. A half-written value,
// a string 'false' from some future migration, or a null from a failed read all
// have to resolve to "push is NOT carrying this device," because the failure
// that matters is a device that shows no toast while receiving no push.
export function getPushActive() { return load(KEYS.PUSH_ACTIVE) === true; }
export function setPushActive(on) { save(KEYS.PUSH_ACTIVE, !!on); }

// ─── SHELL UI STATE, PER DEVICE (DI-210b, iOS Munera, 2026-09-20) ────────────
// Accessor pair per CONVENTIONS #8. `getShellUiState()` default-when-missing
// (CONVENTIONS #10) is `null` — "nothing was ever saved," never a guessed tab.
// Only ever read on a native boot and only ever written from the native App
// plugin's `pause` handler (both in js/app.js); never through the sync seam
// (DEVICE_LOCAL_KEYS above).
export function getShellUiState() {
  const v = load(KEYS.SHELL_UI_STATE);
  return (v && typeof v === 'object' && typeof v.tab === 'string') ? v : null;
}
export function setShellUiState(tab, scrollTop) {
  save(KEYS.SHELL_UI_STATE, { tab: String(tab || ''), scrollTop: Number(scrollTop) || 0, savedAt: new Date().toISOString() });
}

// ─── GAME REQUESTS (FEAT-2 / UN-175, DI-175d, 2026-09-12) ────────────────────
// A player flags a game they want on a future slate; the commissioner sees it
// on Comm → Games while he is building the week whose dates contain it.
//
// TWO ROW KINDS in one append-only array (KEYS.GAME_REQUESTS above):
//   { id:'gr_<epochMs>_<rand5>', kind:'request', playerId, playerName,
//     espnEventId, espnSport, homeTeam, awayTeam, homeMascot, awayMascot,
//     homeRank, awayRank, kickoff, gameDate:'YYYY-MM-DD', season, createdAt,
//     appVersion }
//   { id:'gr_…', kind:'withdraw', targetRequestId, playerId, createdAt }
//
// NOTHING IS EVER EDITED OR REMOVED. A withdrawal is a new tombstone row, the
// same event-log shape chat already uses, because backend.js's _unionById()
// merge is only safe for a list with no per-row delete and no per-row field
// mutation (see that file's `cfbp_comments` exclusion for the inverse hazard).
//
// DEFAULT-WHEN-MISSING (CONVENTIONS #10): absent/garbage reads as [] — "nobody
// has asked for anything", which renders an empty card. The opposite direction
// does not exist here: there is no field to default, because status is derived.
export const GAME_REQUEST_CAP = 3;          // open requests per player (coordinator ruling Q3)
export const GAME_REQUEST_RETENTION_DAYS = 21;

/**
 * A calendar date key ('YYYY-MM-DD') in AMERICA/CHICAGO, for any Date or ISO
 * string. Central-pinned DELIBERATELY and load-bearing: data-provider.js groups
 * the commissioner's Available Games pool by Central date and getTimeWindow()
 * is Central too, so a request has to bucket the same way or an 11pm Eastern /
 * 8pm Pacific Saturday kickoff lands in the wrong week from the one surface
 * that has to match it.
 */
export function centralDateKey(value = new Date()) {
  const d = (value instanceof Date) ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t) => parts.find(p => p.type === t)?.value || '';
  const y = get('year'), m = get('month'), day = get('day');
  return (y && m && day) ? `${y}-${m}-${day}` : '';
}

/** Whole days from `fromKey` to `toKey`, both 'YYYY-MM-DD'. Parsed as UTC noon
 *  so the arithmetic can never be moved by a DST boundary. */
function _dayDelta(fromKey, toKey) {
  const ms = (k) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || ''));
    return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], 12) : NaN;
  };
  const a = ms(fromKey), b = ms(toKey);
  if (Number.isNaN(a) || Number.isNaN(b)) return NaN;
  return Math.round((b - a) / 86400000);
}

/** The raw stored array. Never filtered — retention hiding happens in the fold. */
export function getGameRequestRows() {
  const v = load(KEYS.GAME_REQUESTS);
  return Array.isArray(v) ? v : [];
}

/** The ONLY writer. Appends; never rewrites an existing row. */
function _appendGameRequestRow(row) {
  const all = getGameRequestRows();
  all.push(row);
  save(KEYS.GAME_REQUESTS, all);
  return row;
}

/**
 * Does a request belong to `week`? TWO RULES, OR'd (DI-175e):
 *   1. gameDate falls inside week.startDate…week.endDate, INCLUSIVE both ends
 *      (plain string compare — both are commissioner-entered calendar dates).
 *   2. the request's espnEventId is present in this week's fetched pool.
 * Rule 2 exists because ESPN reschedules: kickoff/gameDate is a snapshot taken
 * when the player asked, possibly months earlier, and rule 1 alone would drop a
 * moved game out of the very week being built.
 */
export function gameRequestMatchesWeek(req, week, availPool = []) {
  if (!req || !week) return false;
  const d = String(req.gameDate || '');
  const s = String(week.startDate || ''), e = String(week.endDate || '');
  if (d && s && e && d >= s && d <= e) return true;
  const id = req.espnEventId != null ? String(req.espnEventId) : '';
  if (!id) return false;
  return (Array.isArray(availPool) ? availPool : []).some(
    g => g?.espnEventId != null && String(g.espnEventId) === id);
}

/**
 * THE FOLD. Returns a NEW array of request rows, each with a derived `status`,
 * newest-stored-order preserved. The input array is never touched — that
 * property is what keeps _unionById() safe for this key, and requesttest [2]
 * deep-equals the input before and after to prove it.
 *
 *   withdrawn  a 'withdraw' row exists for this id FROM THE SAME playerId
 *   onSlate    any game in cfbp_games (any week) carries this espnEventId
 *   pending    otherwise, and gameDate >= today (Central)
 *   missed     otherwise, and the week containing gameDate exists and is
 *              locked / live / final
 *   passed     otherwise (gameDate is behind us with no such week)
 *
 * RETENTION IS A READ-TIME FILTER, never a delete: a row whose gameDate is more
 * than 21 days past is omitted from this result and left untouched in storage.
 * Deleting would be a shrinking write, which is exactly what the append-only
 * union merge cannot survive (notifications.js set the same precedent).
 */
export function foldGameRequests({ rows = null, games = null, weeks = null, today = null } = {}) {
  const all   = Array.isArray(rows)  ? rows  : getGameRequestRows();
  const slate = Array.isArray(games) ? games : getGames();
  const wks   = Array.isArray(weeks) ? weeks : getWeeks();
  const todayKey = today || centralDateKey();

  const withdrawn = new Set();
  for (const r of all) {
    if (!r || r.kind !== 'withdraw' || !r.targetRequestId) continue;
    const target = all.find(x => x && x.kind === 'request' && x.id === r.targetRequestId);
    // A withdraw only counts from the row's own author — one player cannot
    // retract another's ask.
    if (target && target.playerId === r.playerId) withdrawn.add(target.id);
  }

  const onSlateIds = new Set(
    (slate || []).map(g => g?.espnEventId).filter(v => v != null).map(String));

  const out = [];
  for (const row of all) {
    if (!row || row.kind !== 'request' || !row.id) continue;
    const gameDate = String(row.gameDate || '');
    const age = _dayDelta(gameDate, todayKey);
    if (!Number.isNaN(age) && age > GAME_REQUEST_RETENTION_DAYS) continue;   // hidden, not deleted
    let status;
    if (withdrawn.has(row.id)) status = 'withdrawn';
    else if (row.espnEventId != null && onSlateIds.has(String(row.espnEventId))) status = 'onSlate';
    else if (!gameDate || gameDate >= todayKey) status = 'pending';
    else {
      const wk = wks.find(w => {
        const s = String(w?.startDate || ''), e = String(w?.endDate || '');
        return s && e && gameDate >= s && gameDate <= e;
      });
      const st = wk ? String(getEffectiveWeekStatus(wk) || wk.status || '') : '';
      status = (st === 'locked' || st === 'live' || st === 'final') ? 'missed' : 'passed';
    }
    out.push({ ...row, status });
  }
  return out;
}

/**
 * Collapse folded requests to ONE ROW PER GAME, keyed on espnEventId (falling
 * back to the matchup when an id is somehow absent). Requester names come out
 * in a stable order — oldest ask first — so the commissioner's "requested by
 * Drew, Kevin" does not reshuffle between renders.
 */
export function groupGameRequests(list) {
  const sorted = (list || []).slice().sort((a, b) =>
    String(a?.createdAt || '').localeCompare(String(b?.createdAt || '')));
  const groups = new Map();
  for (const r of sorted) {
    const key = r?.espnEventId != null && r.espnEventId !== ''
      ? 'e:' + String(r.espnEventId)
      : 'm:' + String(r?.awayTeam || '') + '@' + String(r?.homeTeam || '');
    if (!groups.has(key)) groups.set(key, { key, espnEventId: r?.espnEventId ?? null, sample: r, requests: [], names: [], playerIds: [] });
    const g = groups.get(key);
    g.requests.push(r);
    if (!g.playerIds.includes(r.playerId)) {
      g.playerIds.push(r.playerId);
      g.names.push(r.playerName || r.playerId || '');
    }
  }
  return [...groups.values()];
}

/** Open = still actionable. onSlate / missed / passed / withdrawn rows are
 *  settled and deliberately do NOT count against the cap. */
export function countOpenGameRequests(playerId, folded = null) {
  const list = Array.isArray(folded) ? folded : foldGameRequests();
  return list.filter(r => r.playerId === playerId && r.status === 'pending').length;
}

/**
 * Create a request. Returns `{ ok, reason, request }` — every refusal is a
 * named reason the caller turns into the exact DI-175g copy string, so the
 * three blocked states (on the slate / duplicate / at the cap) can be asserted
 * without a DOM.
 */
export function submitGameRequest(fields = {}) {
  const { playerId, playerName = '', espnEventId, homeTeam = '', awayTeam = '',
          homeMascot = '', awayMascot = '', homeRank = null, awayRank = null,
          kickoff = null, gameDate = null, season = null, appVersion = '' } = fields;
  if (!playerId) return { ok: false, reason: 'signedOut', request: null };
  if (espnEventId == null || espnEventId === '') return { ok: false, reason: 'noEvent', request: null };
  const eid = String(espnEventId);

  // Already on a slate → blocked by construction. This is also the one place
  // the blind rule could have been pressured (announcing interest in a game
  // that is live on an OPEN slate), and it is removed rather than mitigated.
  if (getGames().some(g => g?.espnEventId != null && String(g.espnEventId) === eid)) {
    return { ok: false, reason: 'onSlate', request: null };
  }
  const folded = foldGameRequests();
  if (folded.some(r => r.playerId === playerId && r.status === 'pending' && String(r.espnEventId) === eid)) {
    return { ok: false, reason: 'duplicate', request: null };
  }
  if (countOpenGameRequests(playerId, folded) >= GAME_REQUEST_CAP) {
    return { ok: false, reason: 'cap', request: null };
  }

  const row = {
    id: 'gr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    kind: 'request',
    playerId, playerName,
    espnEventId: eid,
    espnSport: 'college-football',   // forward-compat; v1 only ever writes this
    homeTeam, awayTeam, homeMascot, awayMascot, homeRank, awayRank,
    kickoff,
    gameDate: gameDate || centralDateKey(kickoff || new Date()),
    season,
    createdAt: new Date().toISOString(),
    appVersion,
  };
  _appendGameRequestRow(row);
  return { ok: true, reason: null, request: row };
}

/** Withdraw = APPEND a tombstone. The original row stays exactly as written. */
export function withdrawGameRequest(requestId, playerId) {
  if (!requestId || !playerId) return { ok: false, reason: 'signedOut' };
  const target = getGameRequestRows().find(r => r && r.kind === 'request' && r.id === requestId);
  if (!target) return { ok: false, reason: 'missing' };
  if (target.playerId !== playerId) return { ok: false, reason: 'notYours' };
  _appendGameRequestRow({
    id: 'gr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
    kind: 'withdraw',
    targetRequestId: requestId,
    playerId,
    createdAt: new Date().toISOString(),
  });
  return { ok: true, reason: null };
}

// ─── FEEDBACK EXPORT EXCLUSIONS ───────────────────────────────────────────────
// Item 10 (DI-B1) — per-feedback-id "leave this out of the next CSV export"
// flag, checked in the Data-tab feedback list (renderFeedbackAdmin) and
// honored by buildFeedbackCsvRows(). Modeled EXACTLY on REJECTED_SUGG above:
// a persisted id-SET with toggle add/remove, going through load()/save() so
// it syncs cross-device like everything else in this file. Flat, unlike
// REJECTED_SUGG's per-week grouping — feedback ids are already globally
// unique ('fb_<timestamp>_<rand>', see the entry builder in app.js), so
// nothing here needs a weekId key.
//
// DEFAULT-WHEN-MISSING (CONVENTIONS #10): absence from this set means
// INCLUDED. Only an explicit uncheck adds an id here — nothing ever adds a
// new id automatically — so a freshly submitted report can never be silently
// missing from a download just because other rows were excluded earlier.
export function getExcludedFeedbackIds() { return load(KEYS.FEEDBACK_EXCLUDED) || []; }
export function isFeedbackExcluded(id) { return getExcludedFeedbackIds().includes(id); }
export function setFeedbackExcluded(id, excluded) {
  const set = new Set(getExcludedFeedbackIds());
  if (excluded) set.add(id); else set.delete(id);
  save(KEYS.FEEDBACK_EXCLUDED, [...set]);
}

// ─── COMMENTS / CHAT ─────────────────────────────────────────────────────────
// Per-game comments + general chat + PickEms Bot posts all live in one list.
// Each entry:
//   {
//     commentId: 'c_<timestamp>_<rand>',
//     weekId:    string,
//     gameId:    string | null,   // null = general chat (not tied to a game)
//     authorId:  string,          // playerId, or the literal 'bot' for PickEms Bot
//     authorKind:'player' | 'bot',
//     body:      string,          // trimmed, max 200 chars for players; bot can go slightly longer
//     createdAt: ISO string,
//   }
//
// One list scales well for a small league across a full season (a few hundred
// entries max). If it ever grows too large we can shard by weekId later.

const COMMENT_MAX_LEN = 200;

/** Get all comments across the app. */
export function getComments() { return load(KEYS.COMMENTS) || []; }

/** Get comments for a specific game, oldest-first. */
export function getGameComments(gameId) {
  return getComments()
    .filter(c => c.gameId === gameId)
    .sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt));
}

/**
 * Add a new comment. Returns the created entry on success or null on rejection.
 * body is trimmed and capped to COMMENT_MAX_LEN chars. If body is empty after
 * trimming, no entry is created (nothing to say = don't spam the log).
 */
export function addComment({ weekId, gameId, authorId, authorKind = 'player', body }) {
  const trimmed = (body || '').trim().slice(0, COMMENT_MAX_LEN);
  if (!trimmed) return null;
  const entry = {
    commentId: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    weekId: weekId || null,
    gameId: gameId || null,
    authorId: authorId || 'unknown',
    authorKind,
    body: trimmed,
    createdAt: new Date().toISOString(),
  };
  const all = getComments();
  all.push(entry);
  save(KEYS.COMMENTS, all);
  return entry;
}

/** Remove a comment (used when a player deletes their own or admin moderates). */
export function deleteComment(commentId) {
  save(KEYS.COMMENTS, getComments().filter(c => c.commentId !== commentId));
}

/**
 * Idempotent bot post. Bot messages are typically triggered by observable
 * events (game finalized, week finalized, new leader) — this dedupe helper
 * ensures a given `eventKey` only produces ONE bot post no matter how many
 * times the trigger fires. Returns true if the post was actually added.
 */
export function addBotPostIfNew({ eventKey, weekId, gameId, body }) {
  const existing = getComments().some(c =>
    c.authorKind === 'bot' && c.botEventKey === eventKey
  );
  if (existing) return false;
  const entry = {
    commentId: `c_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    weekId: weekId || null,
    gameId: gameId || null,
    authorId: 'bot',
    authorKind: 'bot',
    botEventKey: eventKey,
    body: (body || '').trim().slice(0, 400), // bot allowed slightly longer
    createdAt: new Date().toISOString(),
  };
  const all = getComments();
  all.push(entry);
  save(KEYS.COMMENTS, all);
  return true;
}

// ─── PICKS ────────────────────────────────────────────────────────────────────

export function getPicks(weekId=null,playerId=null){
  let p=load(KEYS.PICKS)||[];
  if(weekId)   p=p.filter(x=>x.weekId===weekId);
  if(playerId) p=p.filter(x=>x.playerId===playerId);
  return p;
}
export function getPick(weekId,gameId,playerId){
  return getPicks(weekId,playerId).find(p=>p.gameId===gameId)||null;
}
export function saveAllPicks(newPicks){
  const all=load(KEYS.PICKS)||[];
  for(const pick of newPicks){
    const idx=all.findIndex(p=>p.pickId===pick.pickId);
    if(idx>=0)all[idx]={...pick,updatedAt:new Date().toISOString()};
    else all.push(pick);
  }
  save(KEYS.PICKS,all);
}
export function hasPlayerSubmitted(weekId,playerId){
  const picks=getPicks(weekId,playerId);
  const games=getGames(weekId);
  return games.length>0&&picks.length>=games.length;
}

/**
 * ══ DI §4.3 / DI-T4.11 — THE DERIVED WHO-HAS-SUBMITTED COUNTS ════════════════
 * (Phase III Step 4 Part B; coordinator ruling 2026-09-18, gap 1.)
 *
 * WHY THIS FUNCTION EXISTS AT ALL. Under RLS, on an OPEN week, `picks_select`
 * returns a player exactly one member's rows — their own. Every surface that
 * derived "who has submitted" from the picks array would therefore answer
 * "nobody else has", to everybody, every week. `week_submission_status()` (a
 * DEFINER RPC returning per-member COUNTS and no pick content) is the answer,
 * and the adapter folds it into the derived mirror key below.
 *
 * WHY IT IS HERE AND NOT IN app.js. §0.3 item 1: no module reaches into
 * js/supabase-backend.js to read data — the seam is the only door. app.js used
 * to call `sb.get('cfbp_week_progress')` directly, which was a reported
 * discrepancy; this is the accessor that closes it. authtest's static rule pins
 * that `sb.get(`/`sb.set(` appear in NO file but this one.
 *
 * THE RETURN CONTRACT IS THE WHOLE POINT (DI-T4.11): `null` means WE DO NOT
 * KNOW, and callers must render that as unknown, never as zero. Three ways to
 * get `null`, and all three are honest:
 *   • not in supabase data mode — nothing derives counts, the picks array is
 *     already the truth (every device holds every pick);
 *   • the adapter is not serving — IDLE/HYDRATING/SWITCHING/HELD;
 *   • the adapter is serving from the DEVICE SNAPSHOT (ACTIVE-STALE /
 *     OFFLINE-READONLY), where this key is deliberately absent because it is
 *     never persisted. A stale copy of it would say "nobody has submitted" with
 *     total confidence, which is the exact failure §4.3 exists to prevent.
 *
 * @returns {null | { at: string, weeks: { [weekId]: { [memberId]: {pickCount, hasTiebreaker, hasExtraPoint, lastUpdated} } } }}
 */
export function getWeekProgress(){
  if (_backendMode !== 'supabase') return null;
  try {
    // ACTIVE ONLY — not `isReady()`, and the difference is reviewer F1/F5.
    //
    // `isReady()` is true in three states, and two of them are states in which
    // this device has STOPPED ASKING: ACTIVE-STALE (serving the device
    // snapshot) and OFFLINE-READONLY (serving it with no live connection).
    // Both SERVE, so a count left in the mirror would be handed to the
    // dashboard and rendered as fact.
    //
    // The adapter already deletes the key on the ACTIVE -> OFFLINE-READONLY
    // transition, and never persists it to the snapshot at all. This is the
    // SECOND guard, and it is the one that holds by construction rather than by
    // the right transition having happened: whatever is in the mirror, a device
    // that is not currently in touch with the server does not get to state a
    // count. "We stopped asking" and "nobody submitted" are different facts,
    // and only one of them is safe to draw (DI-T4.11).
    if (sb.getState() !== 'ACTIVE') return null;
    return sb.get(WEEK_PROGRESS_KEY);
  }
  catch(e){ console.error('[Storage:supabase] week progress', e); return null; }
}

// ─── RESULTS ──────────────────────────────────────────────────────────────────

export function getWeeklyResults(weekId=null){
  const r=load(KEYS.RESULTS)||[];
  return weekId?r.filter(x=>x.weekId===weekId):r;
}
export function saveAllWeeklyResults(weekId,newResults){
  const existing=(load(KEYS.RESULTS)||[]).filter(r=>r.weekId!==weekId);
  save(KEYS.RESULTS,[...existing,...newResults]);
}

// ─── OBLIGATIONS ──────────────────────────────────────────────────────────────

export function getObligations(weekId=null){
  const all=load(KEYS.OBLIGATIONS)||[];
  return weekId?all.filter(o=>o.weekId===weekId):all;
}
/**
 * UN-126 — obligations EXCLUDING anything voided (a merge-absorbed record is
 * voided too — see mergeObligationsById in app.js). This is the read every
 * "what does someone actually owe" surface should use. getObligations()
 * itself stays a raw, unfiltered read on purpose — the CSV export and the
 * Data-tab Obligation Corrections tool both need to see voided/merged rows
 * so the audit trail stays visible (CLAUDE.md — money records are never
 * destroyed). Old rows with no `voided` field at all read as active
 * (CONVENTIONS #10 — `!== true`, not a truthy check, so missing==active).
 */
export function getActiveObligations(weekId=null){
  return getObligations(weekId).filter(isObligationActive);
}
export function saveObligation(ob){
  const all=load(KEYS.OBLIGATIONS)||[];
  const idx=all.findIndex(o=>o.obligationId===ob.obligationId);
  if(idx>=0)all[idx]=ob;else all.push(ob);
  save(KEYS.OBLIGATIONS,all);
}
export function saveAllObligations(list){ save(KEYS.OBLIGATIONS, list || []); }
export function createObligation(weekId,payerPlayerId,recipientPlayerId,prize,type='weekly'){
  return{
    obligationId:`ob_${Date.now()}_${Math.random().toString(36).slice(2,5)}`,
    type,weekId,payerPlayerId,recipientPlayerId,
    amountOrPrize:prize,status:'unpaid',
    createdAt:new Date().toISOString(),paidAt:null,
    // UN-126 — presence of a record no longer implies it's the settled
    // answer (Part 1 fix in app.js's reconcileWeeklyObligation), and a
    // record can be voided or folded into another WITHOUT ever being
    // deleted (Part 2, commissioner-only, Data tab). Every obligation that
    // predates this ships with these five fields entirely ABSENT — every
    // reader below treats absence identically to these defaults
    // (CONVENTIONS #10 default-when-missing).
    needsReview:false, reviewNote:null,
    voided:false, voidedAt:null, voidReason:null,
    mergedInto:null, mergedFrom:[],
  };
}


// ─── SCOPED RESET (current week only) ────────────────────────────────────────

/**
 * Reset only the current/active week's slate and picks.
 * Does NOT touch players, other weeks, results, or settings.
 */
export function resetCurrentWeekData(weekId) {
  if (!weekId) return;
  clearSlateForWeek(weekId);
  clearAvailableGames(weekId);
  // Remove picks for this week only
  const allPicks = load(KEYS.PICKS) || [];
  save(KEYS.PICKS, allPicks.filter(p => p.weekId !== weekId));
  // Remove results for this week only
  const allResults = load(KEYS.RESULTS) || [];
  save(KEYS.RESULTS, allResults.filter(r => r.weekId !== weekId));
  // Remove obligations for this week only
  const allObs = load(KEYS.OBLIGATIONS) || [];
  save(KEYS.OBLIGATIONS, allObs.filter(o => o.weekId !== weekId));
  // Remove tiebreaker guesses for this week
  const allTb = load(KEYS.TB_GUESSES) || {};
  Object.keys(allTb).forEach(k => { if(k.startsWith(weekId+'__')) delete allTb[k]; });
  save(KEYS.TB_GUESSES, allTb);
  // Remove Extra Point guesses for this week
  const allEp = load(KEYS.EP_GUESSES) || {};
  Object.keys(allEp).forEach(k => { if(k.startsWith(weekId+'__')) delete allEp[k]; });
  save(KEYS.EP_GUESSES, allEp);
  // Remove emoji reactions for this week
  clearReactionsForWeek(weekId);
}

// ─── EXPORT ───────────────────────────────────────────────────────────────────

export function exportAllData(){
  return{
    exportedAt:new Date().toISOString(),
    settings:getSettings(),players:getPlayers(),
    weeks:getWeeks(),games:getGames(),
    picks:load(KEYS.PICKS)||[],results:load(KEYS.RESULTS)||[],
    obligations:getObligations(),nicknames:getNicknames(),
    tiebreakerGuesses:getTiebreakerGuesses(),
    extraPointGuesses:getExtraPointGuesses(),
  };
}

/**
 * Raw snapshot keyed by the ACTUAL storage keys (cfbp_*). Used to seed/push the
 * shared backend. Reads LOCALSTORAGE directly (not the backend cache) so a
 * "push local to Sheet" seed always sends this device's local data. Device-local
 * keys (session, site unlock, backend config) are excluded so they never sync.
 */
export function exportAllDataRaw(){
  const out={};
  Object.values(KEYS).forEach(k=>{
    if(DEVICE_LOCAL_KEYS.has(k)) return;
    try{
      const raw=localStorage.getItem(k);
      if(raw!=null) out[k]=JSON.parse(raw);
    }catch(e){ /* skip unparseable */ }
  });
  return out;
}
