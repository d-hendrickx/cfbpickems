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
} from './data-model.js';

import { cacheGet, cacheSet, isBackendReady } from './backend.js';

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
  COMMENTS:    'cfbp_comments',                 // per-game + general chat messages (with PickEms Bot)
  ACTIVE_WEEK: 'cfbp_active_week',
  FETCH_PROOF: 'cfbp_fetch_proof',
  SITE_UNLOCK: SITE_PIN_KEY,  // 'cfbp_site_unlocked'
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
const DEVICE_LOCAL_KEYS = new Set([
  KEYS.SESSION,
  KEYS.SITE_UNLOCK,
  KEYS.AVAIL_GAMES,
  'cfbp_backend_config',
]);

// Active storage backend: 'local' | 'googleSheets'. Default local.
// storage.js owns this flag; app.js flips it after a successful hydrate().
let _backendMode = 'local';
export function getBackendMode() { return _backendMode; }
export function setBackendMode(mode) { _backendMode = (mode === 'googleSheets') ? 'googleSheets' : 'local'; }

function useSheets(key) {
  return _backendMode === 'googleSheets' && isBackendReady() && !DEVICE_LOCAL_KEYS.has(key);
}

function load(k) {
  if (useSheets(k)) {
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
  if (useSheets(k)) {
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
  const sheets = getBackendMode() === 'googleSheets';
  const maySeedUserData = !sheets || opts.confirmEmpty === true;

  const seed = (key, value) => {
    if (load(key)) return;                                    // already present
    if (!maySeedUserData && USER_MUTABLE_KEYS.includes(key)) {
      // Refuse, loudly. An empty user-data key in sheets mode means hydrate
      // did not deliver it — NOT that the league has no data.
      console.warn('[Storage] REFUSING to seed user-mutable key in sheets mode:', key,
        '— an empty read is not proof the Sheet is empty (RG-12).');
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
  seed(KEYS.COMMENTS,     []);
  seed(KEYS.ACTIVE_WEEK,  REAL_WEEK_1_2026.weekId);
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
  save(KEYS.COMMENTS, []);
  save(KEYS.ACTIVE_WEEK, REAL_WEEK_1_2026.weekId);
  save(KEYS.FETCH_PROOF, null);
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
export function setAccent(color) { _setPlayerPref('accent', color); }
export function getChatNick() { return _playerPref('chatNick') || null; }
export function setChatNick(nick) { _setPlayerPref('chatNick', (nick || '').slice(0, 16)); }
export function getNotifPrefs() {
  // toastDuration: ms the floating toast stays before auto-removing; 0 means
  // "Until dismissed" (no auto-remove timer). Default 6000 (CONVENTIONS #10 —
  // old/absent records must not change behavior until the player opens prefs).
  return { sound: false, toasts: true, systemEvents: true, toastDuration: 6000, ...(_playerPref('notif') || {}) };
}
export function setNotifPrefs(prefs) { _setPlayerPref('notif', { ...getNotifPrefs(), ...prefs }); }
export function getAccentFor(playerId) {
  const p = (load(KEYS.PLAYERS) || []).find(x => x.playerId === playerId);
  return p?.preferences?.accent || null;
}
export function getChatNickFor(playerId) {
  const p = (load(KEYS.PLAYERS) || []).find(x => x.playerId === playerId);
  return p?.preferences?.chatNick || null;
}

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

export function getSession(){ return load(KEYS.SESSION)||{playerId:null,isAdmin:false,playerVerified:false}; }
export function setSession(playerId,isAdmin=false,playerVerified=false){
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

/** Toggle a player's reaction. Returns the new list for that emoji on that game. */
export function toggleReaction(weekId, gameId, emoji, playerId) {
  if (!weekId || !gameId || !emoji || !playerId) return [];
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
