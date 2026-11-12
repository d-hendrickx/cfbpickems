/**
 * js/avatar.js — profile photos: the pure rules, the one avatar renderer, and the (injected) transport (D2 lane 1, UN-530 / PF-530, DI-773..778, DI-780; Drew's FB-038).
 * ==========================================================================================================================
 * The need: a player is a face, not two letters, in every league they are in. Until now every avatar in the app was initials.
 *
 * WHAT IT IS
 *   1. PURE RULES. `planAvatarCrop` (the center square and the output size), `processAvatarFile` (validate, decode, crop, resize to at most 512 px, re-encode JPEG at 0.82 and step down until the file
 *      is at most 512 KB; re-encoding through a canvas is what STRIPS EXIF and location metadata, DI-774), the path rules (`avatarObjectName`, `avatarVersionedPath`, `parseAvatarPath`: the SAME shape
 *      migration 0067's CHECK enforces), and the native-build gate (`avatarGate`: hidden in the iPhone shell on any build that lacks the camera and photo-library usage strings, DI-778).
 *   2. THE ONE RENDERER, `avatarHTML(player, size, opts)` (DI-776): every person-avatar the app draws goes through it, escapes the name, never throws, and falls back to the initials. With no photo
 *      it returns EXACTLY the markup the call site drew before (the wrapper with the initials as its text), so a league with no photos is byte-identical to the app before this lane.
 *      With a photo it adds the `av` class, an `<img>` (the signed URL) over the initials, so the initials show while the picture loads and on any failure (the image `error` event removes it).
 *   3. THE TRANSPORT, injected (`configureAvatars({ getClient, getLeagueId, getOwnMemberId, ... })`, called by app.js at boot): the league directory (`member_avatars`, migration 0067), signed URLs
 *      (about an hour, cached in memory, never stored), upload (`avatars/{uid}/avatar.jpg`, upsert), remove, and the removal an account deletion owes (DI-775).
 *
 * THE PHOTO BELONGS TO THE ACCOUNT, not to a league: `profiles.avatar_url` holds the object path plus a version (never a URL); the directory maps a league's seats to those paths, so the same
 * face follows the person into every league and the per-league initials remain the fallback. Shown to members of a league the person is in, exactly like the display name. NEVER in a push payload,
 * a share card, an export, a public page or an Edge Function prompt (DI-777): this module is imported by nothing that builds one, and avatartest.mjs scans for it (P-11).
 *
 * LOUD, NEVER SILENT: an upload or a removal that fails says so ("Couldn't upload your photo. Nothing was changed. Try again.") and changes nothing the player can see. A project without the bucket yet
 * (migration 0067 not applied) answers "Photos aren't available yet." and keeps initials everywhere (the directory call is tolerated missing).
 *
 * ZERO top-level side effects and NO imports: the Supabase client, the clock, the document and the image decoder are all injected, so every rule runs under node (avatartest.mjs) and under a real
 * browser (avatarbrowsertest.mjs). iOS 15.0 safe: no Object.hasOwn, no .at(), no structuredClone.
 */

// ═══ 1. THE RULES ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const AVATAR = Object.freeze({
  BUCKET: 'avatars',
  MAX_INPUT_BYTES: 15 * 1024 * 1024,   // DI-774: rejected BEFORE decoding
  MAX_SIDE: 512,
  QUALITY: 0.82,
  MIN_QUALITY: 0.5,
  QUALITY_STEP: 0.1,
  MAX_BYTES: 524288,                   // the bucket's own file_size_limit (migration 0067)
  MIN_NATIVE_BUILD: 5,                 // the first TestFlight build carrying NSCameraUsageDescription and NSPhotoLibraryUsageDescription (DI-778, W-115)
  SIGNED_SECONDS: 3600,
  CACHE_MS: 50 * 60 * 1000,            // re-sign a little before the URL expires
  FAIL_RETRY_MS: 60 * 1000,
});

/** The exact words (DI-773, DI-774, DI-778). Nothing here is user data. */
export const AVATAR_COPY = Object.freeze({
  sheetTitle: 'Profile Photo',
  choose: 'Choose Photo',
  remove: 'Remove Photo',
  cancel: 'Cancel',
  avatarButton: 'Profile photo, edit',
  editLabel: 'Edit',
  previewTitle: 'Use this photo?',
  use: 'Use Photo',
  different: 'Choose Different',
  working: 'Preparing your photo…',
  updated: 'Photo updated',
  removed: 'Photo removed',
  notPhoto: "That file isn't a photo we can use.",
  tooBig: 'That photo is too large. Choose a smaller one.',
  uploadFailed: "Couldn't upload your photo. Nothing was changed. Try again.",
  removeFailed: "Couldn't remove your photo. Nothing was changed. Try again.",
  unavailable: "Photos aren't available yet.",
  reportPrefix: 'Report a photo',
});

/** The center-cropped square and the size it is drawn at. `null` for dimensions that cannot be a picture. */
export function planAvatarCrop(width, height, maxSide = AVATAR.MAX_SIDE) {
  const w = Math.floor(Number(width)), h = Math.floor(Number(height));
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return null;
  const side = Math.min(w, h);
  return { sx: Math.floor((w - side) / 2), sy: Math.floor((h - side) / 2), side, out: Math.min(side, Math.max(1, Math.floor(maxSide))) };
}

/**
 * `{ ok: true, blob, width, height, bytes }` or `{ ok: false, reason: 'too_big' | 'not_photo' | 'encode_failed' }`.
 * `env` (injected; the browser's own when omitted): `{ decode(file) -> Promise<{ width, height, draw(ctx, sx, sy, side, out), close? }>, canvas(size) -> { getContext, toBlob(cb, type, q) } }`.
 * The picture is re-encoded from decoded pixels, so no byte of the original file's EXIF, GPS or maker notes survives (DI-774).
 */
let _envOverride = null;
/** Test seam: a decoder and canvas double for `processAvatarFile` when no `env` is passed (the app's own call site passes none). */
export function _setAvatarEnvForTest(env) { _envOverride = env || null; }
export async function processAvatarFile(file, env = _envOverride || browserEnv()) {
  try {
    if (!file || typeof file !== 'object') return { ok: false, reason: 'not_photo' };
    const size = Number(file.size);
    if (Number.isFinite(size) && size > AVATAR.MAX_INPUT_BYTES) return { ok: false, reason: 'too_big' };
    const type = typeof file.type === 'string' ? file.type.toLowerCase() : '';
    if (type && type.indexOf('image/') !== 0) return { ok: false, reason: 'not_photo' };
    if (size === 0) return { ok: false, reason: 'not_photo' };
    let img = null;
    try { img = await env.decode(file); } catch { img = null; }
    if (!img) return { ok: false, reason: 'not_photo' };
    try {
      const plan = planAvatarCrop(img.width, img.height);
      if (!plan) return { ok: false, reason: 'not_photo' };
      let out = plan.out;
      let quality = AVATAR.QUALITY;
      for (let attempt = 0; attempt < 10; attempt++) {
        const canvas = env.canvas(out);
        const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
        if (!ctx) return { ok: false, reason: 'encode_failed' };
        img.draw(ctx, plan.sx, plan.sy, plan.side, out);
        const blob = await new Promise((resolve) => { try { canvas.toBlob((b) => resolve(b || null), 'image/jpeg', quality); } catch { resolve(null); } });
        if (!blob) return { ok: false, reason: 'encode_failed' };
        if (blob.size <= AVATAR.MAX_BYTES) return { ok: true, blob, width: out, height: out, bytes: blob.size };
        // Still too big: lose quality first, then pixels (never below 64 px: that is not a photo any more).
        if (quality - AVATAR.QUALITY_STEP >= AVATAR.MIN_QUALITY - 1e-9) quality = Math.round((quality - AVATAR.QUALITY_STEP) * 100) / 100;
        else { out = Math.floor(out * 0.85); if (out < 64) return { ok: false, reason: 'encode_failed' }; quality = AVATAR.QUALITY; }
      }
      return { ok: false, reason: 'encode_failed' };
    } finally { try { if (img && typeof img.close === 'function') img.close(); } catch { /* released by the engine anyway */ } }
  } catch { return { ok: false, reason: 'not_photo' }; }
}

/** The browser's own decoder and canvas. `createImageBitmap` with the image's own orientation applied (a portrait iPhone photo is upright), else an <img> element. */
export function browserEnv() {
  return {
    async decode(file) {
      if (typeof createImageBitmap === 'function') {
        let bmp = null;
        try { bmp = await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { try { bmp = await createImageBitmap(file); } catch { bmp = null; } }
        if (bmp) return { width: bmp.width, height: bmp.height, draw: (ctx, sx, sy, side, out) => ctx.drawImage(bmp, sx, sy, side, side, 0, 0, out, out), close: () => { try { bmp.close(); } catch { /* gone */ } } };
      }
      const url = URL.createObjectURL(file);
      try {
        const el = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('decode')); i.src = url; });
        return { width: el.naturalWidth, height: el.naturalHeight, draw: (ctx, sx, sy, side, out) => ctx.drawImage(el, sx, sy, side, side, 0, 0, out, out) };
      } finally { try { URL.revokeObjectURL(url); } catch { /* gone */ } }
    },
    canvas(size) { const c = document.createElement('canvas'); c.width = size; c.height = size; return c; },
  };
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH_RE = new RegExp(`^(${UUID})/avatar\\.jpg\\?v=([0-9]{1,15})$`);
/** `{userId}/avatar.jpg` — the ONE object name an account may write (migration 0067's policies pin it). */
export function avatarObjectName(userId) { return `${String(userId || '').toLowerCase()}/avatar.jpg`; }
/** What `profiles.avatar_url` stores: the object name plus a version (a cache key; never a URL). */
export function avatarVersionedPath(userId, version) { return `${avatarObjectName(userId)}?v=${Math.max(0, Math.floor(Number(version) || 0))}`; }
/** `{ userId, version, name }` for a stored path of exactly the shape the database CHECK accepts; `null` for anything else (a URL, another shape). */
export function parseAvatarPath(path) {
  const m = PATH_RE.exec(typeof path === 'string' ? path : '');
  return m ? { userId: m[1], version: m[2], name: `${m[1]}/avatar.jpg` } : null;
}

/**
 * Is the photo control offered on THIS build? The web app: yes. The iPhone shell: only at or above the build that carries the camera and photo-library usage strings (the system chooser's
 * "Take Photo" terminates a WKWebView app that lacks them). An unknown build number is hidden, never guessed (DI-778).
 */
export function avatarGate({ native = false, buildNumber = null } = {}) {
  if (!native) return true;
  const n = Number(buildNumber);
  return buildNumber !== null && buildNumber !== '' && Number.isFinite(n) && n >= AVATAR.MIN_NATIVE_BUILD;
}

/** The native build number through the app plugin (`Capacitor.Plugins.App.getInfo()`), or `null` when it cannot be read. */
export async function readNativeBuild(win = (typeof window !== 'undefined' ? window : null)) {
  try {
    const app = win && win.Capacitor && win.Capacitor.Plugins && win.Capacitor.Plugins.App;
    if (!app || typeof app.getInfo !== 'function') return null;
    const info = await app.getInfo();
    const n = Number(info && info.build);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

/**
 * The preview sheet's markup (DI-773): a circular preview of the center-cropped picture, the shared submission control (Use Photo, passed in pre-built by submit-state.js), Choose Different, and Cancel.
 * It rides the shared action-sheet shell (`.lc-scrim` + `.lc-actionsheet`); `url` is a local object URL and is escaped here, `submitHTML` is the submission control's own escaped markup.
 */
export function avatarPreviewHTML({ url, submitHTML }) {
  return `<div class="lc-scrim" data-ls-action="cancel"></div>
    <div class="lc-actionsheet av-preview" role="dialog" aria-modal="true" aria-labelledby="av-prev-title">
      <div class="lc-as-grp av-prev-grp"><div class="lc-as-ttl" id="av-prev-title">${esc(AVATAR_COPY.previewTitle)}</div>
        <div class="av-prev-circle"><img src="${esc(url)}" alt=""></div>
        ${submitHTML || ''}
        <button type="button" class="lc-as-act" data-ls-action="avatar-different">${esc(AVATAR_COPY.different)}</button></div>
      <div class="lc-as-grp"><button type="button" class="lc-as-act lc-as-bold" data-ls-action="cancel">${esc(AVATAR_COPY.cancel)}</button></div>
    </div>`;
}

/** The Feedback form's pre-filled text for a reported photo (DI-778). The name is escaped where it is rendered; this returns plain text. */
export function reportPhotoText(name) {
  const who = String(name == null ? '' : name).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 60);
  return who ? `${AVATAR_COPY.reportPrefix}: ${who}` : AVATAR_COPY.reportPrefix;
}

// ═══ 2. THE RENDERER (DI-776) ═══════════════════════════════════════════════════════════════════════════════════════════════════

const SIZES = Object.freeze({ xs: 24, sm: 32, md: 40, lg: 72 });
let cfg = null;
let _dirLeague = '';
const _dir = new Map();        // member id -> stored path (this league's directory)
const _urls = new Map();       // versioned path -> { url, at, blob }
const _failed = new Map();     // versioned path -> time of the last failed signing
let _queue = null;
let _dirTried = false;
let _dirMissing = false;       // migration 0067 not applied: the directory RPC does not exist

function esc(v) {
  const e = cfg && typeof cfg.escHtml === 'function' ? cfg.escHtml : null;
  const s = v == null ? '' : String(v);
  if (e) { try { return e(s); } catch { /* fall through */ } }
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const now = () => (cfg && typeof cfg.now === 'function' ? cfg.now() : Date.now());

/** `configureAvatars({ escHtml, getClient, getLeagueId, getOwnMemberId, getOwnUserId, initialsOf, onChange, now, setTimer })` — called once by js/app.js at boot. */
export function configureAvatars(c) {
  const d = c && typeof c === 'object' ? c : {};
  cfg = {
    escHtml: typeof d.escHtml === 'function' ? d.escHtml : null,
    getClient: typeof d.getClient === 'function' ? d.getClient : () => null,
    getLeagueId: typeof d.getLeagueId === 'function' ? d.getLeagueId : () => '',
    getOwnMemberId: typeof d.getOwnMemberId === 'function' ? d.getOwnMemberId : () => '',
    getOwnUserId: typeof d.getOwnUserId === 'function' ? d.getOwnUserId : () => '',
    initialsOf: typeof d.initialsOf === 'function' ? d.initialsOf : null,
    onChange: typeof d.onChange === 'function' ? d.onChange : () => {},
    now: typeof d.now === 'function' ? d.now : null,
    setTimer: typeof d.setTimer === 'function' ? d.setTimer : (fn, ms) => setTimeout(fn, ms),
    doc: d.doc || null,
  };
}
const theDoc = () => (cfg && cfg.doc) || (typeof document !== 'undefined' ? document : null);

export function _resetAvatarsForTest() { cfg = null; _dir.clear(); _urls.clear(); _failed.clear(); _queue = null; _dirLeague = ''; _dirTried = false; _dirMissing = false; }
export const _avatarStateForTest = () => ({ dir: [..._dir.entries()], urls: [..._urls.keys()], failed: [..._failed.keys()], league: _dirLeague, missing: _dirMissing, queued: _queue ? _queue.size : 0 });
export function _seedAvatarDirectoryForTest(leagueId, rows) { return setDirectory(leagueId, rows); }
export function _seedAvatarUrlForTest(path, url) { _urls.set(path, { url, at: now(), blob: false }); }

/** Replaces the directory; returns true when what a screen would draw CHANGED (a different league, or a different set of seat paths), so an unchanged refresh repaints nothing. */
function setDirectory(leagueId, rows) {
  const before = `${_dirLeague}|${JSON.stringify([..._dir.entries()].sort())}`;
  _dirLeague = String(leagueId || '');
  _dir.clear();
  for (const r of Array.isArray(rows) ? rows : []) {
    const p = r && typeof r.avatar_url === 'string' ? r.avatar_url : '';
    if (r && typeof r.member_id === 'string' && parseAvatarPath(p)) _dir.set(r.member_id, p);
  }
  return before !== `${_dirLeague}|${JSON.stringify([..._dir.entries()].sort())}`;
}

/** The stored path for a person in the current league's directory, or ''. A directory read for ANOTHER league is never consulted. */
export function avatarPathFor(player) {
  try {
    if (!cfg || !player || typeof player !== 'object') return '';
    const lg = String(cfg.getLeagueId() || '');
    if (!lg || lg !== _dirLeague) return '';
    return _dir.get(String(player.playerId || player.memberId || player.id || '')) || '';
  } catch { return ''; }
}
export function ownAvatarPath() {
  try { if (!cfg) return ''; const id = String(cfg.getOwnMemberId() || ''); return id && String(cfg.getLeagueId() || '') === _dirLeague ? (_dir.get(id) || '') : ''; } catch { return ''; }
}

function freshUrl(path) {
  const hit = _urls.get(path);
  if (!hit) return '';
  if (!hit.blob && now() - hit.at > AVATAR.CACHE_MS) { _urls.delete(path); return ''; }
  return hit.url;
}

/**
 * THE ONE AVATAR RENDERER. `player` is the person (a player record or a roster row), `size` a number of points or 'xs' | 'sm' | 'md' | 'lg' (the image's width and height attributes, so nothing
 * jumps), `opts` is `{ tag: 'span' | 'div', cls, initials, accent, ariaHidden }`: `cls` keeps the call site's own wrapper class (and so its own size, colour and shape), `initials` the call site's own fallback text,
 * `accent` is a chat bubble's accent colour (the background of the initials circle, white text; escaped here) and `ariaHidden: true` adds `aria-hidden="true"`. Never throws.
 */
export function avatarHTML(player, size = 'md', opts = {}) {
  try {
    const o = opts && typeof opts === 'object' ? opts : {};
    const tag = o.tag === 'div' ? 'div' : 'span';
    const cls = String(o.cls || '').replace(/[^A-Za-z0-9_ -]/g, '').trim();
    let initials = o.initials;
    if (initials == null) { try { initials = cfg && cfg.initialsOf ? cfg.initialsOf(player) : ''; } catch { initials = ''; } }
    const style = typeof o.accent === 'string' && o.accent ? ` style="background:${esc(o.accent)};color:#fff"` : '';
    const aria = o.ariaHidden === true ? ' aria-hidden="true"' : '';
    const path = avatarPathFor(player);
    const text = esc(initials);
    if (!path) return `<${tag} class="${esc(cls)}"${style}${aria}>${text}</${tag}>`;
    const url = freshUrl(path);
    if (!url) queueSign(path);
    const px = typeof size === 'number' && size > 0 ? Math.floor(size) : (SIZES[size] || SIZES.md);
    const clsAv = cls ? `${cls} av` : 'av';
    const img = url ? `<img class="av-img" src="${esc(url)}" alt="" width="${esc(px)}" height="${esc(px)}" decoding="async" draggable="false">` : '';
    return `<${tag} class="${esc(clsAv)}" data-av-path="${esc(path)}" data-av-px="${esc(px)}"${style}${aria}>${img}<span class="av-i">${text}</span></${tag}>`;
  } catch { return ''; }
}

/** Puts the picture into every avatar on the page whose URL has arrived (and takes it off one whose URL is gone). Idempotent; touches nothing else. */
export function paintAvatars(root) {
  try {
    const d = theDoc();
    const scope = root || d;
    if (!scope || typeof scope.querySelectorAll !== 'function' || !d) return 0;
    let n = 0;
    for (const el of scope.querySelectorAll('[data-av-path]')) {
      const path = el.getAttribute('data-av-path') || '';
      const url = freshUrl(path);
      const img = el.querySelector ? el.querySelector('.av-img') : null;
      if (!url) { if (img && typeof img.remove === 'function') img.remove(); continue; }
      if (img) { if (img.getAttribute('src') !== url) img.setAttribute('src', url); continue; }
      const px = el.getAttribute('data-av-px') || '40';
      const i = d.createElement('img');
      i.className = 'av-img'; i.setAttribute('src', url); i.setAttribute('alt', ''); i.setAttribute('width', px); i.setAttribute('height', px); i.setAttribute('decoding', 'async'); i.setAttribute('draggable', 'false');
      el.insertBefore(i, el.firstChild);
      n++;
    }
    return n;
  } catch { return 0; }
}

/** One delegated `error` listener (capture): a picture that fails to load is removed and its URL forgotten, so the initials under it show and the next signing is retried later. Idempotent. */
let _errBound = false;
export function bindAvatarDelegate(d = theDoc()) {
  if (_errBound || !d || typeof d.addEventListener !== 'function') return;
  _errBound = true;
  d.addEventListener('error', (e) => {
    try {
      const t = e && e.target;
      if (!t || typeof t.getAttribute !== 'function' || !/(^|\s)av-img(\s|$)/.test(t.getAttribute('class') || '')) return;
      const host = t.parentNode;
      const path = host && typeof host.getAttribute === 'function' ? host.getAttribute('data-av-path') : '';
      if (path) { _urls.delete(path); _failed.set(path, now()); }
      if (typeof t.remove === 'function') t.remove();
    } catch { /* decoration */ }
  }, true);
}

// ═══ 3. THE TRANSPORT (injected) ═══════════════════════════════════════════════════════════════════════════════════════════════

function queueSign(path) {
  try {
    if (!cfg || !path) return;
    const failedAt = _failed.get(path);
    if (failedAt && now() - failedAt < AVATAR.FAIL_RETRY_MS) return;
    if (!_queue) {
      _queue = new Set();
      cfg.setTimer(() => { const batch = [..._queue]; _queue = null; return signBatch(batch); }, 0);
    }
    _queue.add(path);
  } catch { /* initials stay */ }
}

async function signBatch(paths) {
  try {
    const client = cfg && cfg.getClient();
    if (!client || !client.storage || !paths.length) return;
    const byName = new Map();
    for (const p of paths) { const pp = parseAvatarPath(p); if (pp) byName.set(pp.name, p); }
    const names = [...byName.keys()];
    if (!names.length) return;
    const { data, error } = await client.storage.from(AVATAR.BUCKET).createSignedUrls(names, AVATAR.SIGNED_SECONDS);
    if (error || !Array.isArray(data)) { for (const p of paths) _failed.set(p, now()); return; }
    for (const row of data) {
      const full = byName.get(row && row.path);
      if (!full) continue;
      if (row.signedUrl && !row.error) { _urls.set(full, { url: row.signedUrl, at: now(), blob: false }); _failed.delete(full); }
      else _failed.set(full, now());
    }
    paintAvatars();
  } catch { for (const p of paths) _failed.set(p, now()); }
}

/**
 * Reads this league's photo directory (`member_avatars`). Returns 'ok' | 'missing' (migration 0067 not applied: tolerated, initials everywhere) | 'failed' | 'stale' (the league changed while the
 * call was in flight: the answer is dropped, never shown under the wrong league).
 */
export async function refreshAvatarDirectory() {
  try {
    const client = cfg && cfg.getClient();
    const lg = cfg ? String(cfg.getLeagueId() || '') : '';
    if (!client || !lg || typeof client.rpc !== 'function') return 'failed';
    _dirTried = true;
    const { data, error } = await client.rpc('member_avatars', { p_league: lg });
    if (String(cfg.getLeagueId() || '') !== lg) return 'stale';
    if (error) {
      const code = String(error.code || ''), msg = String(error.message || '');
      if (code === 'PGRST202' || code === '42883' || /could not find the function|does not exist/i.test(msg)) { _dirMissing = true; if (setDirectory(lg, [])) { try { cfg.onChange(); } catch { /* never wedges */ } } return 'missing'; }
      return 'failed';
    }
    _dirMissing = false;
    if (setDirectory(lg, data)) { try { cfg.onChange(); } catch { /* a listener never wedges the refresh */ } }
    return 'ok';
  } catch { return 'failed'; }
}
export const avatarDirectoryMissing = () => _dirMissing;
export const avatarDirectoryTried = () => _dirTried;
/** Forget everything (a league switch or an identity change): the next render shows initials until the new league's directory arrives. */
export function clearAvatarDirectory() { _dir.clear(); _dirLeague = ''; _queue = null; for (const [k, v] of _urls) { if (v.blob) { try { URL.revokeObjectURL(v.url); } catch { /* gone */ } } _urls.delete(k); } _failed.clear(); }

function classify(err) {
  const msg = String((err && (err.message || err.error)) || '');
  const status = Number(err && (err.statusCode || err.status)) || 0;
  if (status === 404 || /bucket not found/i.test(msg)) return 'unavailable';
  return 'failed';
}

/**
 * Uploads the processed picture and points the account's profile at it. `{ ok: true, path }` or `{ ok: false, reason: 'unavailable' | 'failed' }`.
 * ORDER (reviewer, batch 1, 2026-10-19): the profile pointer FIRST, then the object. The object name never changes ({uid}/avatar.jpg); the `?v=` on the pointer is only a cache-buster, so a pointer that moves
 * to a new version while the object is untouched changes nothing anyone can see. If the pointer update fails nothing was written. If the object upload then fails the pointer is put back (best effort: a pointer
 * left on a new version still names the same, unchanged object). The one picture-changing write is the LAST, so "Nothing was changed" is true on every failure and a co-member can never see the new picture
 * under a pointer that says nothing happened. The new picture is shown at once from the local blob.
 */
export async function uploadOwnAvatar(blob) {
  try {
    const client = cfg && cfg.getClient();
    const uid = cfg ? String(cfg.getOwnUserId() || '') : '';
    if (!client || !client.storage || !uid || !blob) return { ok: false, reason: 'failed' };
    const name = avatarObjectName(uid);
    const before = ownAvatarPath();
    const path = avatarVersionedPath(uid, now());
    const wr = await client.from('profiles').update({ avatar_url: path }).eq('id', uid).select('avatar_url');
    if (wr.error || !Array.isArray(wr.data) || wr.data.length !== 1) return { ok: false, reason: 'failed' };
    const up = await client.storage.from(AVATAR.BUCKET).upload(name, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '3600' });
    if (up && up.error) {
      try { await client.from('profiles').update({ avatar_url: before || null }).eq('id', uid).select('avatar_url'); } catch { /* a pointer left on a new version still names the same object */ }
      return { ok: false, reason: classify(up.error) };
    }
    let local = '';
    try { if (typeof URL !== 'undefined' && URL.createObjectURL) local = URL.createObjectURL(blob); } catch { local = ''; }
    const lg = String(cfg.getLeagueId() || ''), mid = String(cfg.getOwnMemberId() || '');
    // The own seat is known even when the league's directory has not been read yet (the face appears at once; the other seats arrive with the next read).
    if (lg && mid) { if (_dirLeague !== lg) { _dir.clear(); _dirLeague = lg; } _dir.set(mid, path); }
    if (local) _urls.set(path, { url: local, at: now(), blob: true });
    try { cfg.onChange(); } catch { /* a listener never wedges the upload */ }
    return { ok: true, path };
  } catch { return { ok: false, reason: 'failed' }; }
}

/** Removes the object, then clears the path. `{ ok: true }` or `{ ok: false, reason }`. Removing a photo that is not there is a success. */
export async function removeOwnAvatar() {
  try {
    const client = cfg && cfg.getClient();
    const uid = cfg ? String(cfg.getOwnUserId() || '') : '';
    if (!client || !client.storage || !uid) return { ok: false, reason: 'failed' };
    const rm = await client.storage.from(AVATAR.BUCKET).remove([avatarObjectName(uid)]);
    if (rm && rm.error && classify(rm.error) !== 'unavailable') return { ok: false, reason: 'failed' };
    const wr = await client.from('profiles').update({ avatar_url: null }).eq('id', uid).select('avatar_url');
    if (wr.error || !Array.isArray(wr.data) || wr.data.length !== 1) return { ok: false, reason: 'failed' };
    const lg = String(cfg.getLeagueId() || ''), mid = String(cfg.getOwnMemberId() || '');
    if (lg && lg === _dirLeague && mid) _dir.delete(mid);
    try { cfg.onChange(); } catch { /* a listener never wedges the removal */ }
    return { ok: true };
  } catch { return { ok: false, reason: 'failed' }; }
}

/**
 * Best effort, before the account-deletion RPC: a SQL cascade cannot delete a Storage object (DI-775). Never throws, never blocks the deletion for longer than `timeoutMs`, and clears the path
 * with the object so a refused deletion leaves the account consistent (no photo, no dangling path).
 */
export async function removeOwnAvatarBeforeDeletion(timeoutMs = 4000) {
  try {
    if (!cfg || !cfg.getClient()) return false;
    const work = removeOwnAvatar().then((r) => r.ok);
    const cap = new Promise((resolve) => { cfg.setTimer(() => resolve(false), timeoutMs); });
    return await Promise.race([work, cap]);
  } catch { return false; }
}
