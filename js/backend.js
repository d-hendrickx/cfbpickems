/**
 * CFB Pickems — Backend Adapter (Phase II)
 * =========================================
 * Talks to the Google Apps Script web app and keeps an in-memory mirror of all
 * storage keys so the rest of the app can keep using SYNCHRONOUS load()/save().
 *
 * Why a mirror?
 *   The whole app was built around synchronous localStorage. Rewriting every
 *   call site to be async would be a huge, risky change. Instead:
 *     - At startup we pull the full snapshot ONCE (async) into `_cache`.
 *     - storage.js reads/writes `_cache` synchronously (instant, like before).
 *     - Writes are also queued and pushed to the Sheet (debounced) in the
 *       background. Last-write-wins, which is fine for a small league.
 *
 * Modes (storage.js decides which to use based on settings.storageMode):
 *   - 'local'         : pure localStorage (default; offline; per-device)
 *   - 'googleSheets'  : this adapter (shared across devices)
 *
 * Config lives in localStorage (so it survives reloads and never ships in source):
 *   cfbp_backend_config = { url, token }
 */

const CFG_KEY = 'cfbp_backend_config';

/**
 * v0.16.0 — SNAPSHOT MIRROR (boot-performance fix).
 * After every successful hydrate/push, the full key/value snapshot is persisted
 * to localStorage under MIRROR_KEY. On the NEXT boot, primeFromMirror() loads
 * it synchronously so the app renders league data in <1s instead of blocking
 * on a Google Apps Script cold start (measured 10–20s).
 *
 * This is NOT a silent storage fallback (loud-fail decision still holds):
 *  - the UI shows a visible "Syncing…" badge until the background hydrate lands;
 *  - if that hydrate FAILS, the persistent red banner appears exactly as before;
 *  - pushes are HELD while stale (see flushPush) so a stale mirror can never
 *    overwrite fresher remote data — local edits are rebased onto the fresh
 *    snapshot when hydrate completes, then pushed.
 */
const MIRROR_KEY = 'cfbp_sheet_mirror';
let _stale = false;            // true = serving mirror data, hydrate not yet landed

const _cache = new Map();      // key -> parsed value (the synchronous mirror)
let _ready = false;            // true once hydrated from the Sheet
let _config = null;            // { url, token }
let _pushTimer = null;
const _dirty = new Set();      // keys changed since last push

/**
 * RG-24 — field-scoped rebase for composite blob keys.
 *
 * `_dirty` is KEY-granular, and so is the rebase in hydrate() below. That is
 * right for keys whose value IS the local intent (picks, weeks, games — the
 * whole array is authored here). It is wrong for `cfbp_settings`, one key
 * holding ~17 independent fields: a device whose mirror predates another
 * device's change writes one field and re-applies its stale view of the other
 * 16, silently reverting them. That is how UN-112's cleared chat came back —
 * chatEpochSeq went to 0 — and it applies identically to chatEnabled and
 * randomizePicksEnabled.
 *
 *   key -> Set(field)  the caller declared which fields it changed
 *   key -> null        a whole-value write is pending; it supersedes fields
 *   (absent)           nothing pending, or a non-object value
 *
 * This makes AD-08's stated promise ("a stale mirror can never overwrite
 * fresher remote data") true for composite blobs, where it previously was not.
 * It does NOT change what gets PUSHED — only what a held write is rebased onto.
 */
const _dirtyFields = new Map();

/** User data whose loss is unrecoverable — see storage.js USER_MUTABLE_KEYS. */
const _USER_DATA_KEYS = [
  'cfbp_players', 'cfbp_weeks', 'cfbp_games', 'cfbp_picks', 'cfbp_results',
  'cfbp_obligations', 'cfbp_tb_guesses', 'cfbp_ep_guesses',
];
function _size(v) {
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') return Object.keys(v).length;
  return v ? 1 : 0;
}
/** True when applying `local` over `remote` would destroy records. */
function _shrinks(local, remote) { return _size(local) < _size(remote); }
/**
 * Test-only seam for RG-12 defense (c).
 *
 * This export is LOAD-BEARING, not a convenience. loadtest.mjs's defense-(c)
 * block used to branch on `typeof be._shrinksForTest === 'function'` and fall
 * back to matching the guard's SOURCE TEXT when it was absent. The export was
 * never added, so the fallback is what ran — and a source-text match cannot
 * tell a working guard from a gutted one. Verified 2026-08-12: replacing the
 * guard's body with `_cache.set(k, v)` (protection gone, text intact) left the
 * suite fully green at 552/552. That is RG-12's own failure mode reproduced
 * inside the commit written to eliminate it. Do not remove this export.
 */
export function _shrinksForTest(local, remote) { return _shrinks(local, remote); }
function _isPlainObject(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
const _listeners = new Set();  // status change subscribers

// Sync observability — exposed via getSyncStatus() so the UI can render a
// human-readable "synced 12s ago" / "3 pending writes" / "last error: …" panel.
let _lastSyncAt = null;        // ISO timestamp of last successful push or pull
let _lastError = null;         // last error message or null

export function getSyncStatus() {
  return {
    ready: _ready,
    configured: !!(getBackendConfig() && getBackendConfig().url),
    lastSyncAt: _lastSyncAt,
    lastError: _lastError,
    pendingWrites: _dirty.size,
  };
}

// ── Config ────────────────────────────────────────────────────────────────────

/**
 * Load deployed config from `config.json` next to the published site.
 * This is the "Option A" auto-connect path — the commissioner sets the URL +
 * token ONCE in config.json before deploying, and every device that opens
 * the site picks it up automatically. No per-device setup, no Commissioner
 * panel visit, no token sharing.
 *
 * Returns:
 *   { ok: true,  url, token }              — config.json exists, has values
 *   { ok: false, reason: 'missing' }       — file 404 or fetch failed
 *   { ok: false, reason: 'empty' }         — file exists but values blank
 *   { ok: false, reason: 'malformed', error } — file exists but invalid JSON
 *
 * The caller (boot in app.js) decides what to do with each outcome — typically
 * 'empty' or 'missing' → silent fall back to local mode (a fork-friendly
 * default), while real connection errors get surfaced loudly to the user.
 */
export async function loadDeployedConfig() {
  try {
    // Cache-bust on every load so a fresh deploy is picked up immediately
    const res = await fetch('config.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return { ok: false, reason: 'missing' };
    const data = await res.json();
    const url = (data?.backendUrl || '').trim();
    const token = (data?.backendToken || '').trim();
    if (!url || !token) return { ok: false, reason: 'empty' };
    return { ok: true, url, token };
  } catch (err) {
    return { ok: false, reason: 'malformed', error: String(err.message || err) };
  }
}

export function getBackendConfig() {
  if (_config) return _config;
  try { _config = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); }
  catch { _config = null; }
  return _config;
}
export function setBackendConfig(url, token) {
  _config = { url: (url || '').trim().replace(/\/$/, ''), token: (token || '').trim() };
  localStorage.setItem(CFG_KEY, JSON.stringify(_config));
  return _config;
}
export function clearBackendConfig() {
  _config = null;
  localStorage.removeItem(CFG_KEY);
}
export function isBackendConfigured() {
  const c = getBackendConfig();
  return !!(c && c.url && c.token);
}
export function isBackendReady() { return _ready; }

export function isMirrorStale() { return _stale; }

/**
 * Synchronously load the last-known snapshot into the in-memory cache.
 * Returns the number of keys primed (0 = no mirror; caller must await hydrate
 * before rendering league data). Marks the backend "ready but stale".
 */
export function primeFromMirror() {
  try {
    const raw = localStorage.getItem(MIRROR_KEY);
    if (!raw) return 0;
    const snap = JSON.parse(raw);
    if (!snap || typeof snap.data !== 'object') return 0;
    _cache.clear();
    Object.entries(snap.data).forEach(([k, v]) => _cache.set(k, v));
    _ready = true;
    _stale = true;
    _lastSyncAt = snap.at || null;
    return _cache.size;
  } catch (e) {
    console.warn('[backend] mirror unreadable, ignoring', e);
    return 0;
  }
}

function persistMirror() {
  try {
    const data = {};
    _cache.forEach((v, k) => { data[k] = v; });
    localStorage.setItem(MIRROR_KEY, JSON.stringify({ at: new Date().toISOString(), data }));
  } catch (e) { console.warn('[backend] mirror persist failed', e); }
}

export function clearMirror() { try { localStorage.removeItem(MIRROR_KEY); } catch {} }

// ── Status events (so the UI can show a sync indicator) ────────────────────────
export function onBackendStatus(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
function emit(status, detail) { _listeners.forEach(fn => { try { fn(status, detail); } catch {} }); }

// ── Low-level transport ─────────────────────────────────────────────────────
async function call(action, payload = {}) {
  const c = getBackendConfig();
  if (!c || !c.url) throw new Error('Backend not configured');
  const body = JSON.stringify({ action, token: c.token, ...payload });
  // Apps Script web apps accept text/plain without a CORS preflight, which
  // avoids the OPTIONS request that Apps Script does not handle.
  const res = await fetch(c.url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body,
    redirect: 'follow',
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Backend error');
  return data;
}

// ── Connection test ───────────────────────────────────────────────────────────
export async function pingBackend() {
  try {
    const data = await call('ping');
    return { ok: true, ...data };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
}

// ── Hydrate the in-memory mirror from the Sheet ────────────────────────────────
export async function hydrate() {
  emit('syncing');
  try {
    const data = await call('getAll');

    // ── RG-12 DEFENSE (b), rebuilt 2026-08-12 ──────────────────────────────
    // The ledger recorded this guard as shipped in v0.17.1. It was NOT in the
    // code, and its absence let live picks be destroyed a second time.
    //
    // If the mirror currently holds substantive league data and the remote
    // returns none of it, that is far more likely a cold start, a transient
    // 200-with-empty-body, or a partial read than a genuinely emptied Sheet.
    // Preserve the mirror and fail LOUD (AD-06) rather than adopt the void —
    // because adopting it means ensureSeedData reseeds a DRAFT template and
    // flushPush sends it to every device.
    const fresh = data.data || {};
    const hadData = k => { const v = _cache.get(k); return Array.isArray(v) ? v.length > 0 : !!v; };
    const freshHas = k => { const v = fresh[k]; return Array.isArray(v) ? v.length > 0 : !!v; };
    const mirrorHadLeague = hadData('cfbp_players') || hadData('cfbp_weeks') || hadData('cfbp_picks');
    const remoteHasLeague = freshHas('cfbp_players') || freshHas('cfbp_weeks') || freshHas('cfbp_picks');
    if (mirrorHadLeague && !remoteHasLeague) {
      throw new Error(
        'Sync refused: the server returned no players, weeks or picks while this device ' +
        'still holds them. Your local data is preserved and nothing was overwritten. ' +
        'This is usually a cold start or a dropped response — retry in a moment.'
      );
    }

    // Capture any local edits made while stale (dirty keys) BEFORE clearing,
    // then re-apply them over the fresh snapshot — user intent wins for keys
    // they touched this session; everything else takes the fresh remote value.
    const localEdits = new Map();
    _dirty.forEach(k => { if (_cache.has(k)) localEdits.set(k, _cache.get(k)); });
    _cache.clear();
    Object.entries(fresh).forEach(([k, v]) => _cache.set(k, v));
    localEdits.forEach((v, k) => {
      // RG-24 — when the writer declared WHICH fields it changed, graft only
      // those onto the fresh remote value. Everything else keeps the remote
      // value, so one device's settings write can no longer revert another's.
      const fields = _dirtyFields.get(k);
      const fresh = _cache.get(k);
      if (fields instanceof Set && _isPlainObject(fresh) && _isPlainObject(v)) {
        const merged = { ...fresh };
        fields.forEach(f => {
          if (f in v) merged[f] = v[f]; else delete merged[f];
        });
        _cache.set(k, merged);
      } else if (_USER_DATA_KEYS.includes(k) && _shrinks(v, _cache.get(k))) {
        // NEW DEFENSE (c), 2026-08-12. RG-12's two guards both protect against
        // an empty REMOTE. Neither protects against a stale LOCAL that looks
        // perfectly valid — a device booting on a mirror from before the picks
        // were made holds a well-formed, populated, and completely obsolete
        // WEEKS/PICKS. Re-applying it here and pushing it is indistinguishable
        // from a legitimate edit, and it destroys everyone's data.
        //
        // A held write may ADD to user data. It may never make it smaller.
        // Deletions are rare, recoverable, and can be redone; silent mass loss
        // is neither. Keep the fresher remote and drop the stale local.
        console.warn('[backend] DROPPED a stale held write that would have shrunk', k,
          `(local ${_size(v)} -> remote ${_size(_cache.get(k))}). Remote kept.`);
        _dirty.delete(k);
        _dirtyFields.delete(k);
      } else {
        _cache.set(k, v);
      }
    });
    _ready = true;
    _stale = false;
    _lastSyncAt = new Date().toISOString();
    _lastError = null;
    persistMirror();
    emit('synced', { keys: _cache.size });
    // Any held-back stale writes can now flush safely.
    if (_dirty.size) schedulePush();
    return _cache.size;
  } catch (err) {
    _lastError = String(err.message || err);
    emit('error', { error: _lastError });
    throw err;
  }
}

/**
 * Seed an EMPTY backend from a local snapshot (first-time migration).
 * Only writes keys the backend doesn't already have, unless force=true.
 */
export async function seedFromLocal(localSnapshot, force = false) {
  const remote = (await call('getAll')).data || {};
  const entries = {};
  Object.entries(localSnapshot).forEach(([k, v]) => {
    if (force || !(k in remote)) entries[k] = v;
  });
  if (Object.keys(entries).length) await call('setMany', { entries });
  return Object.keys(entries).length;
}

// ── Synchronous cache accessors (used by storage.js when in sheets mode) ───────
export function cacheGet(key) {
  return _cache.has(key) ? _cache.get(key) : null;
}
/**
 * @param {string}    key
 * @param {*}         value
 * @param {string[]=} fields  RG-24 — for a plain-object value, the fields the
 *   caller actually changed. Omitted (every caller but saveSetting) = a
 *   whole-value write, identical to the previous behaviour. A whole-value
 *   write already pending for a key is never downgraded to a field patch.
 */
export function cacheSet(key, value, fields) {
  if (_dirtyFields.get(key) === null) {
    // a whole-value write (e.g. resetToDemo) is already queued for this key —
    // it wins; a later field write cannot narrow it back down.
  } else if (Array.isArray(fields) && fields.length && _isPlainObject(value)) {
    const set = _dirtyFields.get(key) || new Set();
    fields.forEach(f => set.add(f));
    _dirtyFields.set(key, set);
  } else {
    _dirtyFields.set(key, null);
  }
  _cache.set(key, value);
  _dirty.add(key);
  schedulePush();
}

// ── Debounced background push to the Sheet ─────────────────────────────────────
function schedulePush() {
  if (_pushTimer) clearTimeout(_pushTimer);
  _pushTimer = setTimeout(flushPush, 800);
}
export async function flushPush() {
  if (_pushTimer) { clearTimeout(_pushTimer); _pushTimer = null; }
  if (!_dirty.size) return { pushed: 0 };
  // HOLD writes while serving stale mirror data — pushing a full blob based on
  // a stale snapshot could clobber fresher remote data. Dirty keys stay queued
  // and are rebased + flushed automatically when hydrate() lands.
  if (_stale) return { pushed: 0, held: true };
  // If the backend isn't configured (e.g. user disconnected mid-session), keep
  // the dirty set for later and bail quietly instead of throwing.
  const c = getBackendConfig();
  if (!c || !c.url) return { pushed: 0, skipped: true };
  const entries = {};
  _dirty.forEach(k => { entries[k] = _cache.has(k) ? _cache.get(k) : null; });
  // RG-24 — the field list describes writes that have NOT yet reached the
  // Sheet. Keep a copy so a failed push can restore it along with _dirty;
  // losing it would silently downgrade the retry's rebase to whole-value.
  const sentFields = new Map(_dirtyFields);
  _dirty.clear();
  _dirtyFields.clear();
  emit('syncing');
  try {
    await call('setMany', { entries });
    _lastSyncAt = new Date().toISOString();
    _lastError = null;
    persistMirror();
    emit('synced', { pushed: Object.keys(entries).length });
    return { pushed: Object.keys(entries).length };
  } catch (err) {
    // Re-mark dirty so a later push retries
    Object.keys(entries).forEach(k => {
      _dirty.add(k);
      if (!_dirtyFields.has(k) && sentFields.has(k)) _dirtyFields.set(k, sentFields.get(k));
    });
    _lastError = String(err.message || err);
    emit('error', { error: _lastError });
    throw err;
  }
}

// ── Manual full refresh (pull) ─────────────────────────────────────────────────
export async function refreshFromBackend() { return hydrate(); }

// ── Season snapshots / backups ─────────────────────────────────────────────────
export async function createSnapshot(label = '') { return call('snapshot', { label }); }
export async function listSnapshots() { return (await call('listSnapshots')).snapshots || []; }
export async function restoreSnapshot(id) { const r = await call('restoreSnapshot', { id }); await hydrate(); return r; }


// ── Chat transport (v0.16.0) ───────────────────────────────────────────────────
// The chat log does NOT ride the debounced blob push — it has its own
// append + incremental-fetch endpoints so six concurrent authors can never
// clobber each other (append-only, server-assigned seq, id-level dedupe).

export async function chatAppendRemote(events) {
  const r = await call('chatAppend', { events });
  return { assigned: r.assigned || [], head: r.head ?? 0 };
}
export async function chatSinceRemote(afterSeq, limit = 500) {
  const r = await call('chatSince', { seq: afterSeq, limit });
  return { events: r.events || [], head: r.head ?? 0 };
}
export async function chatBeforeRemote(beforeSeq, limit = 100) {
  const r = await call('chatBefore', { seq: beforeSeq, limit });
  return { events: r.events || [], head: r.head ?? 0 };
}
