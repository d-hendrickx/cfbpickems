/**
 * CFB Pickems — backend.js
 * =========================================================================
 * THIS FILE USED TO BE THE GOOGLE APPS SCRIPT TRANSPORT. It is not any more.
 *
 * From 2026-09-23 (UN-237/238, the Sheets retirement) it holds exactly three
 * things, and NOT ONE LINE OF NETWORK CODE besides the `config.json` read:
 *
 *   1. `loadDeployedConfig()` — the read of the site's own `config.json`. Same
 *      origin, a static file next to index.html, and the first thing boot()
 *      does. It is here because it always has been and because moving a
 *      boot-path read on the same day as a transport deletion is two changes
 *      wearing one commit.
 *   2. `dataMode` — the module's live answer to "is this league's data on
 *      Supabase?", set once per page by js/auth.js's `configureAuth()` from the
 *      config read that actually happened. `isBackendConfigured()` is derived
 *      from it.
 *   3. The Sheets-era DEVICE RECORDS, so the wipe paths that still have to
 *      remove them can: `clearMirror()` deletes `cfbp_sheet_mirror`.
 *
 * ── WHAT WENT, AND WHY IT WENT RATHER THAN BEING SWITCHED OFF ───────────────
 * Deleted here: `call()`, `SHEETS_RELAY_ALLOWLIST`, `SheetsRelayRefusedError`,
 * the misroute/transient-HTTP guard (BUG-A/BUG-E), `hydrate()`,
 * `seedFromLocal()`, `flushPush()` with its RG-56 quarantine and
 * `SHEET_CELL_MAX`, `refreshFromBackend()`, the snapshot trio, the three
 * `chat*Remote` relays, `notifyPushRelay`, `notifyLogFetch`, `pingBackend`,
 * the four `scribeMemory*Remote` relays (already gone, DI-260), the
 * `scribeAsk`/`runTrainer`/`scribeAutonomous`/`scribeClassify` relays, and the
 * whole in-memory mirror with its RG-12/RG-24/RG-39/RG-49 rebase defenses.
 *
 * NONE OF THAT WAS REACHABLE. `dataMode` has been `'supabase'` since the
 * cutover on 2026-09-19, and `call()`'s allow-list refused every action except
 * `ping` and `notifyPush`. Leaving the rest behind as unreachable code would
 * mean: a second transport with the production league's token in it, one
 * config flag away from live; a file whose comments describe defenses that no
 * longer defend anything (RG-27's exact failure mode — a source-text match
 * cannot tell a working guard from an inert one); and a shape that invites the
 * next person to "just re-enable it" during an outage.
 *
 * THE MIRROR'S REBASE DEFENSES ARE NOT LOST — THEY MOVED. RG-12 (an empty
 * remote must never be adopted), RG-24 (field-scoped rebase for composite
 * blobs), RG-39 (field-level staleness on player records) and RG-49
 * (append-only logs merge by id) were all properties of THIS file's `hydrate()`
 * over a whole-Sheet snapshot. js/supabase-backend.js does not have that
 * shape at all: it writes ROW-LEVEL DIFFS to typed tables, so a stale device
 * cannot clobber a field it never read, and the RG-12 class is answered by
 * `_classifyHydrateFailure()` plus the withhold states rather than by a
 * size comparison. Deleting inert copies of those guards here does not weaken
 * the live ones; keeping them would have implied a protection that was no
 * longer running.
 *
 * ── PIN MODE IS LOCAL-ONLY NOW, AND THAT IS A REAL BEHAVIOUR CHANGE ─────────
 * CLAUDE.md's locked decision is that the PIN model STAYS IN THE CODE, and it
 * does: js/auth.js's site PIN, player PINs and the commissioner-password
 * re-prompts are all untouched. What a PIN-mode device no longer has is a
 * SHARED backend, because the only one it ever had was the Sheet:
 *   - `isBackendConfigured()` answers false, so js/chat.js does not poll or
 *     append and the three lifecycle emitters in js/app.js stay quiet;
 *   - `isBackendReady()` answers false, so js/storage.js's `useBackend()` is
 *     false for 'googleSheets' and every read and write lands in localStorage.
 * That is a working single-device app, which is what a fork of this repo with
 * no Supabase project gets — and it is honest, where a PIN device pointed at a
 * dead /exec URL would have been six players silently out of sync.
 */

const MIRROR_KEY = 'cfbp_sheet_mirror';

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * `authMode` — 'supabase' | 'prelink' | 'pins'. CONVENTIONS #10: anything the
 * file does not say is 'pins', the safe default, never 'supabase'.
 */
function _normalizeAuthMode(raw) {
  return (raw === 'supabase' || raw === 'prelink') ? raw : 'pins';
}

/**
 * `dataMode` — 'supabase' or 'sheets'. The name is `dataMode` and not
 * `storageMode` because `storageMode` is a legacy `cfbp_settings` field the
 * projection strips as a credential (supabase-projection.js) — reusing it would
 * make a grep ambiguous (Step 4 DI §1.4).
 *
 * 'sheets' now means "no shared backend on this device" rather than "the Google
 * Sheet". The VALUE is kept rather than renamed because it is the rollback
 * marker: `cfbp_auth_mode_last_known` and every historical config.json use it,
 * and a device that reads an older config must resolve to the same non-Supabase
 * state it always did.
 */
function _normalizeDataMode(raw) {
  return raw === 'supabase' ? 'supabase' : 'sheets';
}

/**
 * NOT read off a persisted record: a cutover-era value could be read back on a
 * device whose config.json has since been rolled back. This is set once per
 * page, by js/auth.js's `configureAuth()`, from the config read that actually
 * happened — and it defaults to 'sheets', which is the flag-off world.
 *
 * js/auth.js already imports this module; this module imports nothing of
 * auth.js's, so there is no cycle and no second config fetch.
 */
let _dataMode = 'sheets';
export function getDataMode() { return _dataMode; }
export function setDataMode(mode) { _dataMode = _normalizeDataMode(mode); return _dataMode; }

/**
 * Load deployed config from `config.json` next to the published site. The
 * "Option A" auto-connect path: the commissioner sets it ONCE before deploying
 * and every device that opens the site picks it up. No per-device setup.
 *
 * Returns:
 *   { ok: true,  authMode, dataMode, authModeKnown: true, supabaseUrl, supabaseAnonKey }
 *   { ok: false, reason: 'missing',   authModeKnown: false }   file 404 / fetch failed
 *   { ok: false, reason: 'malformed', authModeKnown: false, error }
 *
 * ── `backendUrl` / `backendToken` ARE GONE (2026-09-23) ────────────────────
 * They were the Apps Script /exec URL and its shared token, and this function
 * used to answer `{ ok:false, reason:'empty' }` when either was blank — a
 * branch js/app.js's boot() still has to handle for 'missing'/'malformed', so
 * nothing downstream breaks by its absence. There is no 'empty' outcome any
 * more: a config.json this function can PARSE is a config.json that told us
 * what we asked it, and the only thing left to ask is which auth/data mode the
 * league is on.
 *
 * ── SEC F1-R1 — `authModeKnown` IS THE FINDING, AND IT SURVIVES VERBATIM ───
 * Both failure branches used to return a hardcoded `authMode:'pins'`. That is
 * a config read ANSWERING a question it could not ask: an offline cold boot, a
 * Pages 5xx, a service-worker 503 or a captive portal would all report "this
 * league is on PINs" with the same confidence as a config.json that actually
 * says so. After cutover that downgrade is a privilege escalation — pins mode
 * makes storage.getSession() read `cfbp_session` again, which on a pre-cutover
 * device may still say `isAdmin:true`.
 *
 * So the failure branches carry no authMode at all; they carry
 * `authModeKnown:false`, and js/app.js's `resolveEffectiveAuthMode()` decides
 * (keep the last-known-good mode, and if there is none, behave as today).
 * `authModeKnown:true` on the success branch so the flag is explicit in both
 * directions rather than inferred from the absence of a key.
 */
export async function loadDeployedConfig() {
  try {
    // Cache-bust on every load so a fresh deploy is picked up immediately.
    const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: 'missing', authModeKnown: false };
    const data = await res.json();
    const authMode = _normalizeAuthMode(data?.authMode);
    const dataMode = _normalizeDataMode(data?.dataMode);
    const supabaseUrl = (data?.supabaseUrl || '').trim();
    const supabaseAnonKey = (data?.supabaseAnonKey || '').trim();
    return { ok: true, authMode, dataMode, authModeKnown: true, supabaseUrl, supabaseAnonKey };
  } catch (err) {
    return { ok: false, reason: 'malformed', error: String(err.message || err), authModeKnown: false };
  }
}

/**
 * "Does this league have a shared backend at all?"
 *
 * WHAT THIS PREDICATE MEANS CHANGED ON 2026-09-23, AND THE NAME DID NOT.
 * It used to ask whether a Sheet URL and token were on the device. Every call
 * site (js/chat.js's four, js/app.js's three lifecycle gates) has always used
 * it to mean "is there somewhere to send this", and that question now has
 * exactly one answer: the league's data mode. The name is kept because
 * renaming it across two modules would be churn that obscures the one line
 * that actually changed.
 *
 * Read off `_dataMode` — the value `configureAuth()` established from a
 * SUCCESSFUL config read — and not off a persisted record, for the reason
 * `_dataMode`'s own comment gives.
 */
export function isBackendConfigured() { return _dataMode === 'supabase'; }

/**
 * The Sheets mirror is never ready again, and this is deliberately a CONSTANT
 * rather than a deleted export.
 *
 * js/storage.js is ask-first and is not edited by this change. Its
 * `useBackend(key)` reads `isBackendReady()` for the 'googleSheets' arm and
 * falls through to `localStorage` when it is false — so a device still in that
 * mode reads and writes locally, with nothing lost and nothing silently going
 * nowhere. Removing the export would break that file's import; returning true
 * would route reads at a cache nothing fills.
 */
export function isBackendReady() { return false; }

/**
 * The two synchronous cache accessors js/storage.js imports.
 *
 * UNREACHABLE BY CONSTRUCTION: `useBackend()` gates both on `isBackendReady()`,
 * which is false above. They THROW rather than answering null/no-op, because
 * this pair is the storage seam's write path and the one thing it must never
 * do is look like it worked. storage.js wraps each in try/catch with a
 * `console.error`, so a future caller that reached them would fail loudly and
 * visibly instead of dropping a pick into a Map nothing reads.
 */
export function cacheGet(key) {
  throw new Error(`[backend] the Google Sheets mirror was retired on 2026-09-23 and cannot answer a read for "${key}". Reads in Supabase mode go through js/supabase-backend.js; in local mode they go to localStorage. Reaching this line means js/storage.js's useBackend() returned true for the 'googleSheets' arm, which isBackendReady() no longer allows.`);
}
export function cacheSet(key /* , value, fields */) {
  throw new Error(`[backend] the Google Sheets mirror was retired on 2026-09-23 and cannot accept a write for "${key}". Nothing was saved. Writes in Supabase mode go through js/supabase-backend.js; in local mode they go to localStorage.`);
}

/**
 * Remove the Sheets-era snapshot from this device.
 *
 * STILL LOAD-BEARING, and it is the reason this function outlived the mirror
 * it belongs to: js/auth.js's device wipe and js/supabase-backend.js's
 * first-Supabase-boot wipe (§6.1) both call it through this export rather than
 * reaching for the key literal. A pre-cutover device can still be carrying a
 * full copy of the league under `cfbp_sheet_mirror`, and nothing else on the
 * device will ever clear it.
 */
export function clearMirror() { try { localStorage.removeItem(MIRROR_KEY); } catch { /* a device that refuses the removal keeps the stale copy; nothing reads it */ } }

/** Test-only: the key `clearMirror()` removes, so a suite can assert the wipe
 *  without hard-coding the string in a second place (the discrepancy
 *  js/auth.js:3194 records — this file exported a clearer but no name). */
export function _mirrorKeyForTest() { return MIRROR_KEY; }
