/**
 * js/cfb-teams.js — College football: a home team AND an alma mater, ONE designated (D2 lane 1, UN-507A, DI-1011..1014; Drew 2026-10-19:
 * "For cfb you can pick a home team and an alma mater, but only one of them gets listed for the designated team rankings (alma mater rankings)").
 * ============================================================================================================================================
 * THE RULE THIS MODULE EXISTS TO KEEP (DI-1011): `league_members.alma_mater` (player.almaMater) stays the ONE and ONLY school scoring reads, exactly as today. It holds the person's
 * DESIGNATED team. The other school lives in `preferences.cfbOtherTeam = { role: 'home' | 'alma', school }`, and the role of the designated one in `preferences.cfbDesignatedRole`
 * ('alma' by default, so every player who exists today reads as { alma: <their school>, designated: 'alma' } and nothing changes for them). Nothing here imports scoring.js, tie-context.js or
 * any reader of the claim: claimedAlmaMaters(), almaMaterClaimants(), the Watch, the tiebreak step and SCRIBE all keep reading `almaMater`, so a stale school can never reach a tiebreak.
 *
 * ONE WRITER (DI-1011): `cfbTeamsPatch(player, { home, alma, designated })` is the only place these three values are computed, and it returns ONE patch (`almaMater` + `preferences`) that every
 * surface hands to its one save (patchPlayer / savePlayer). Both halves therefore land in the same write.
 *
 * The pure half (readCfbTeams, cfbTeamsPatch, cfbTeamsGuard, the copy) has no DOM and no storage. The control (cfbTeamsControlHTML, readCfbTeamsControl and the document delegate) is the ONE
 * component the Profile pane, Chat settings and the commissioner's Edit Player all render (DI-1012). NFL and NHL keep `preferences.homeTeams[sport]` (no designation; not this module's business).
 */
import { schoolFieldHTML } from './school-picker.js';

/** The longest school the column accepts (`alma_mater` CHECK, migration 0001: length <= 80). */
export const CFB_SCHOOL_MAX = 80;

/** The words (DI-1012). */
export const CFB_TEAMS_COPY = Object.freeze({
  designationLabel: 'Counts for Alma Mater Watch',
  designationHome: 'Home team',
  designationAlma: 'Alma mater',
  helper: "Only one team counts for your league's Alma Mater Watch and the tiebreaker. The other is just for your profile.",
  openWarning: 'This changes your Alma Mater Watch team for the current week.',
  lockedNote: 'You can change this after the week finishes.',
  homeLabel: 'Home team',
  almaLabel: 'Alma mater',
});

const clean = (v) => String(v == null ? '' : v).trim().slice(0, CFB_SCHOOL_MAX);
const sameSchool = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase() && clean(a) !== '';

/**
 * What a player record says about their college football teams: `{ home, alma, designated }` where `designated` is 'home' | 'alma' (which of the two `almaMater` holds).
 * An old record with no preferences reads `{ home: '', alma: <almaMater>, designated: 'alma' }` (CONVENTIONS #10). Malformed preference values read as absent.
 */
export function readCfbTeams(player) {
  const p = player && typeof player === 'object' ? player : {};
  const prefs = p.preferences && typeof p.preferences === 'object' ? p.preferences : {};
  const designated = prefs.cfbDesignatedRole === 'home' ? 'home' : 'alma';
  const held = clean(p.almaMater);
  const other = prefs.cfbOtherTeam && typeof prefs.cfbOtherTeam === 'object' ? prefs.cfbOtherTeam : null;
  const otherSchool = other && typeof other.school === 'string' ? clean(other.school) : '';
  const otherRole = other && (other.role === 'home' || other.role === 'alma') ? other.role : null;
  const out = { home: '', alma: '', designated };
  out[designated] = held;
  const otherKind = designated === 'alma' ? 'home' : 'alma';
  // The other school counts only when its role is the OPPOSITE of the designated one (a record that says otherwise is inconsistent and reads as absent, never as a second claim).
  if (otherSchool && otherRole === otherKind) out[otherKind] = otherSchool;
  return out;
}

/**
 * The ONE computation. Input: the three values as the person set them (`designated` only matters when BOTH schools are set). Returns the patch every surface saves in ONE write:
 *   { almaMater, preferences }
 * where `almaMater` is the DESIGNATED school ('' when neither is set), and `preferences` is the player's current preferences with `cfbOtherTeam` / `cfbDesignatedRole` set (or removed when
 * there is nothing to say). The caller passes the player's CURRENT record (read at write time), so unrelated preferences ride through untouched.
 *   - neither set                 -> almaMater '', no cfbOtherTeam, role 'alma'
 *   - only an alma mater          -> almaMater = it, role 'alma'                      (every existing player: unchanged)
 *   - only a home team            -> almaMater = it, role 'home'                      (the one set school is the one that counts)
 *   - both, `designated: 'alma'`  -> almaMater = alma,  cfbOtherTeam = { home, school }
 *   - both, `designated: 'home'`  -> almaMater = home,  cfbOtherTeam = { alma, school }
 *   - both the same school        -> one team (the second is a duplicate claim, not a second school)
 */
export function cfbTeamsPatch(player, { home = '', alma = '', designated = 'alma' } = {}) {
  const p = player && typeof player === 'object' ? player : {};
  const prefs = { ...(p.preferences && typeof p.preferences === 'object' ? p.preferences : {}) };
  let h = clean(home), a = clean(alma);
  if (h && a && sameSchool(h, a)) h = '';                       // one school entered twice is one team: keep it as the alma mater
  let almaMater = '';
  let role = 'alma';
  delete prefs.cfbOtherTeam;
  if (h && a) {
    role = designated === 'home' ? 'home' : 'alma';
    almaMater = role === 'home' ? h : a;
    prefs.cfbOtherTeam = role === 'home' ? { role: 'alma', school: a } : { role: 'home', school: h };
  } else if (h) { role = 'home'; almaMater = h; }
  else if (a) { role = 'alma'; almaMater = a; }
  if (role === 'home') prefs.cfbDesignatedRole = 'home'; else delete prefs.cfbDesignatedRole;   // 'alma' is the default: an absent key IS 'alma', so an existing player's record gains nothing
  return { almaMater, preferences: prefs };
}

/** True when the player has BOTH schools (the designation control is shown only then, DI-1012). */
export function hasBothCfbTeams(teams) {
  return !!(teams && clean(teams.home) && clean(teams.alma) && !sameSchool(teams.home, teams.alma));
}

/**
 * The state of the control for a week situation (DI-1012's guard, confirmed by the coordinator 2026-10-19): 'locked' when a CFB week is Locked or Live (the control is disabled with the
 * lockedNote: swapping the school after picks are revealed would change a tiebreak input), 'open' when a CFB week is Open (editable, with the one-line warning), else 'free'.
 * `statuses` is the list of the CFB weeks' EFFECTIVE statuses (strings).
 */
export function cfbTeamsGuard(statuses) {
  const list = (Array.isArray(statuses) ? statuses : []).map((s) => String(s || '').toLowerCase());
  if (list.some((s) => s === 'locked' || s === 'live')) return 'locked';
  if (list.some((s) => s === 'open')) return 'open';
  return 'free';
}

// ═══ THE CONTROL (DI-1012): one component, three surfaces ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * The markup: a Home team field, an Alma mater field (both the shared school picker), and - ONLY when both are set - the two-segment "Counts for Alma Mater Watch" control, then the one-sentence
 * helper. `ids` = { home, alma, desig }: the three hidden inputs the surface reads back (`readCfbTeamsControl`). `guard` is cfbTeamsGuard()'s answer: 'locked' disables every part with the
 * lockedNote; 'open' adds the one-line warning. `escHtml` is injected (CONVENTIONS #12).
 */
export function cfbTeamsControlHTML({ escHtml, ids, teams, guard = 'free', labelPrefix = '' } = {}) {
  if (typeof escHtml !== 'function') throw new TypeError('cfbTeamsControlHTML() requires an injected escHtml function');
  const t = teams && typeof teams === 'object' ? teams : { home: '', alma: '', designated: 'alma' };
  const locked = guard === 'locked';
  const both = hasBothCfbTeams(t);
  const C = CFB_TEAMS_COPY;
  const field = (id, label, value) => `<div class="form-group"><label class="form-label">${escHtml(label)}</label>${schoolFieldHTML({ id, value, label: `${labelPrefix}${label}`, disabled: locked })}</div>`;
  const seg = (kind, label) => {
    const on = t.designated === kind;
    return `<button type="button" class="cc-quick-seg cfb-desig-seg" role="radio" aria-checked="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}" data-cfb-desig="${kind}"${locked ? ' disabled aria-disabled="true"' : ''}>${escHtml(label)}</button>`;
  };
  return `<div class="cfb-teams" data-cfb-teams data-cfb-guard="${escHtml(guard)}" data-cfb-ids="${escHtml(JSON.stringify([ids.home, ids.alma, ids.desig]))}">`
    + field(ids.home, C.homeLabel, t.home)
    + field(ids.alma, C.almaLabel, t.alma)
    + `<div class="form-group cfb-desig"${both ? '' : ' hidden'}><div class="form-label" id="${escHtml(ids.desig)}-lbl">${escHtml(C.designationLabel)}</div>`
    + `<div class="cc-quick-track cfb-desig-track" role="radiogroup" aria-labelledby="${escHtml(ids.desig)}-lbl">${seg('home', C.designationHome)}${seg('alma', C.designationAlma)}</div></div>`
    + `<input type="hidden" id="${escHtml(ids.desig)}" value="${escHtml(t.designated === 'home' ? 'home' : 'alma')}">`
    + `<div class="cfb-notes"><p class="text-muted text-xs cfb-helper">${escHtml(C.helper)}</p>`
    + (locked ? `<p class="text-muted text-xs cfb-guard" role="note">${escHtml(C.lockedNote)}</p>` : '')
    + (guard === 'open' ? `<p class="text-muted text-xs cfb-guard" role="note">${escHtml(C.openWarning)}</p>` : '')
    + '</div></div>';
}

/** Read the control back from its root (or any element inside it): `{ home, alma, designated }`. Anything missing reads empty / 'alma'. */
export function readCfbTeamsControl(root) {
  const el = root && typeof root.closest === 'function' ? (root.matches && root.matches('[data-cfb-teams]') ? root : root.closest('[data-cfb-teams]') || (root.querySelector && root.querySelector('[data-cfb-teams]'))) : (root && root.querySelector ? root.querySelector('[data-cfb-teams]') : null);
  if (!el) return null;
  let ids = [];
  try { ids = JSON.parse(el.getAttribute('data-cfb-ids') || '[]'); } catch { ids = []; }
  // Found by comparing ids, never by building a selector from one (an id is interpolated into nothing).
  const inputs = el.querySelectorAll ? Array.from(el.querySelectorAll('input')) : [];
  const val = (id) => { const n = id ? inputs.find((i) => i.id === id) : null; return n ? String(n.value || '') : ''; };
  const [homeId, almaId, desigId] = ids;
  return { home: val(homeId), alma: val(almaId), designated: val(desigId) === 'home' ? 'home' : 'alma' };
}

/** Show the designation segment only when BOTH schools are set; keep the checked segment in step with the hidden value. In place: no repaint. */
export function syncCfbTeamsControl(root) {
  const el = root && root.matches && root.matches('[data-cfb-teams]') ? root : (root && root.closest ? root.closest('[data-cfb-teams]') : null);
  if (!el) return false;
  const t = readCfbTeamsControl(el);
  if (!t) return false;
  const wrap = el.querySelector('.cfb-desig');
  if (wrap) wrap.hidden = !hasBothCfbTeams(t);
  for (const b of el.querySelectorAll('[data-cfb-desig]')) {
    const on = b.getAttribute('data-cfb-desig') === t.designated;
    b.setAttribute('aria-checked', on ? 'true' : 'false');
    b.setAttribute('tabindex', on ? '0' : '-1');
  }
  return true;
}

let _bound = false;
export function _resetCfbDelegateForTest() { _bound = false; }
/**
 * One document-level delegate: a tap on a designation segment writes the hidden value and fires ONE bubbling `change` on it (the surfaces listen for `change`, as they do for a school pick); a
 * `change` from either school field re-syncs the segment's visibility. Zero top-level side effects: app.js calls this from boot().
 */
export function bindCfbTeamsDelegate(d = (typeof document !== 'undefined' ? document : null)) {
  if (!d || _bound || typeof d.addEventListener !== 'function') return false;
  _bound = true;
  d.addEventListener('click', (e) => {
    const b = e && e.target && e.target.closest ? e.target.closest('[data-cfb-desig]') : null;
    if (!b || b.disabled) return;
    const root = b.closest('[data-cfb-teams]');
    if (!root) return;
    const ids = (() => { try { return JSON.parse(root.getAttribute('data-cfb-ids') || '[]'); } catch { return []; } })();
    const input = ids[2] ? d.getElementById(ids[2]) : null;
    if (!input) return;
    const kind = b.getAttribute('data-cfb-desig') === 'home' ? 'home' : 'alma';
    if (input.value === kind) return;
    input.value = kind;
    syncCfbTeamsControl(root);
    let ev;
    const real = typeof HTMLElement !== 'undefined' && input instanceof HTMLElement && typeof Event === 'function';
    ev = real ? new Event('change', { bubbles: true }) : { type: 'change', bubbles: true };
    try { input.dispatchEvent(ev); } catch { /* the value is already set */ }
  });
  d.addEventListener('change', (e) => { const t = e && e.target; if (t && t.closest && t.closest('[data-cfb-teams]')) syncCfbTeamsControl(t); }, true);
  return true;
}
