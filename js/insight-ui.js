/**
 * CFB Pickems - js/insight-ui.js (D2 lane 4 batch 2; DI-964, 970 to 973, 1085, 1086; W-129; UN-519/520/543; 2026-10-21)
 * =====================================================================================================================
 * THE DOM HALF of the insight surfaces: the insight DETAIL (a pushed screen over whatever opened it), Profile's YOUR NUMBERS (a pushed screen), and the ASK SCRIBE sheet (the shared sheet shell).
 * Every pixel of markup is built by the pure modules (insight-view.js, ask-insight.js); this file only mounts it, routes its taps and repaints it when the data moves.
 *
 * EVERYTHING it needs from the app arrives as a dependency (the pushed-screen.js discipline): the pushed-screen API, the app's sheet shell and exit animation, escHtml, the icon family, the haptic, the
 * toast, the online check. It imports no app.js, no storage and no network. The wire (analytics-wire.js) is the only data source.
 *
 * THE DOM IS ONLY EVER A REQUEST (Std-9): each button is allow-listed by `data-ins-action` / `data-ask-action`, and the action must exist in the CURRENT model with the same parameters before anything
 * happens (a forged id, a stale tap or a button from a screen that has since repainted does nothing). A row that opens another insight names an id the CURRENT model lists, never one read from markup alone.
 *
 * SEND TO THE LOCKER ROOM (PF-520 / DI-963; coordinator ruling 2026-10-21): the detail's "Share to Locker Room" and the Ask sheet's "Send this insight to the Locker Room" are offered only for a
 * candidate the engine marks shareable, whose id has the server's strict shape (lane 7's 0062 rule (e)), to a member the app lets share now; the share goes through the app's ONE share sheet
 * (chat-share.js `insight` reference). A Game Day fact is never shared.
 *
 * ASK SCRIBE'S OPEN QUESTIONS (batch 3, DI-970 to 973; Drew 2026-10-21 "Lets build the open-question Ask SCRIBE"): "Why is this unusual?" and the composer are live while the platform
 * setting is on (`isAskOpen`, read by the app). The request names the insight and carries the question and the hash of the packet on screen, never a number (`askModel`); the server
 * answers from its own recompute. An answer is drawn escaped, labelled "SCRIBE's read"; a failure shows "SCRIBE couldn't answer that one" and the games behind the insight.
 */
import { pushScreen, popScreen, invalidateScreens, isScreenOpen, topScreenId } from './pushed-screen.js';
import { insightDetailHTML, insightReadHTML, yourNumbersModel, yourNumbersHTML, YN_COPY } from './insight-view.js';
import { whatIfModel, whatIfHTML } from './what-if-view.js';
import { gameInsightsBodyHTML, GDI_COPY } from './game-insights-view.js';
import { isGdFactId } from './analytics-wire.js';
import { PULL_TO_REFRESH_ARM_PX, PULL_TO_REFRESH_SUCCESS_FADE_MS } from './nav-gestures.js';
import { ASK_COPY, ASK_LIMITS, CHIP_DEFS, askBodyHTML, buildAskRequest, canAskModel, noteModelAsk, emptyAskState, composerRows } from './ask-insight.js';

export const INSIGHT_ID_PREFIX = 'ins1:';
export const ASK_WRAP_ID = 'ask-sheet-wrap', ASK_SHEET_ID = 'ask-sheet';
export const GDI_WRAP_ID = 'gdi-sheet-wrap', GDI_SHEET_ID = 'gdi-sheet';
const isInsightId = (id) => typeof id === 'string' && id.startsWith(INSIGHT_ID_PREFIX) && id.length <= 400;
/** what the detail and the Ask sheet open: an insight id, or a Game Day fact of the CURRENT computation (DI-977 "Open details" / "Ask SCRIBE") */
const isOpenableId = (id) => isInsightId(id) || isGdFactId(id);
export { isInsightId };
const isFn = (f) => typeof f === 'function';
const req = (d, name) => { if (!isFn(d[name])) throw new TypeError(`createInsightUI() requires an injected ${name} function`); return d[name]; };

/**
 * PULL TO REFRESH on Your numbers (DI-964 "pull-to-refresh native, refreshes the data key"). The window binder (nav-gestures.js bindPullToRefresh) is suspended while any pushed screen is up
 * (gesturesSuspended() lists #pushed-root, so nothing arms UNDER a screen), so the screen's own scroller carries this small machine instead: it arms only at the scroller's top, on a vertical pull
 * (a sideways drag is the swipe-back's and cancels it), at the SAME 64 pt arm point the app uses everywhere, and the release runs the app's ONE sync path then the engine. Pure and exported for the test.
 *   phases  idle -> ready (touch at the top) -> pulling -> armed (>= 64 pt) -> refreshing (released while armed) -> done (success: the completion haptic) -> idle
 */
export const PTR_ARM_PX = PULL_TO_REFRESH_ARM_PX;
export function ptrStep(st, ev) {
  const s0 = st && typeof st === 'object' ? st : { phase: 'idle', axis: null };
  const e = ev || {};
  switch (e.type) {
    case 'start': return s0.phase === 'refreshing' ? s0 : { phase: e.atTop === true ? 'ready' : 'idle', axis: null };
    case 'move': {
      if (s0.phase !== 'ready' && s0.phase !== 'pulling' && s0.phase !== 'armed') return s0;
      const dy = Number(e.dy) || 0, dx = Number(e.dx) || 0;
      let axis = s0.axis;
      if (!axis) { if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return s0; axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x'; }
      if (axis === 'x' || dy <= 0) return { phase: 'idle', axis: 'x' };
      return { phase: dy >= PTR_ARM_PX ? 'armed' : 'pulling', axis };
    }
    case 'end': return s0.phase === 'armed' ? { phase: 'refreshing', axis: null } : (s0.phase === 'refreshing' ? s0 : { phase: 'idle', axis: null });
    case 'cancel': return s0.phase === 'refreshing' ? s0 : { phase: 'idle', axis: null };
    case 'done': return { phase: e.ok === true ? 'done' : 'idle', axis: null };
    case 'settle': return s0.phase === 'refreshing' ? s0 : { phase: 'idle', axis: null };
    default: return s0;
  }
}

/**
 * @param {object} d  { wire, escHtml, icon, haptic, ensurePushedScreens, mountSheetShell, playSheetExit, dismissBlocked, isContentWithheld, showToast?, isOnline?, formatTime?, beforePush?,
 *                      openProfile?, askModel?, today?, loadAskLimits?, saveAskLimits? }
 */
export function createInsightUI(d = {}) {
  const wire = d.wire;
  if (!wire || !isFn(wire.detail) || !isFn(wire.yourNumbers) || !isFn(wire.askContext)) throw new TypeError('createInsightUI() requires the analytics wire');
  const escHtml = req(d, 'escHtml'), icon = req(d, 'icon'), haptic = isFn(d.haptic) ? d.haptic : () => {}, ensurePushedScreens = req(d, 'ensurePushedScreens');
  const mountSheetShell = req(d, 'mountSheetShell'), playSheetExit = req(d, 'playSheetExit'), isContentWithheld = req(d, 'isContentWithheld');
  const dismissBlocked = isFn(d.dismissBlocked) ? d.dismissBlocked : () => false;
  const toast = isFn(d.showToast) ? d.showToast : () => {};
  const online = isFn(d.isOnline) ? d.isOnline : () => true;
  const beforePush = isFn(d.beforePush) ? d.beforePush : () => {};
  const dayKey = isFn(d.today) ? d.today : () => new Date().toISOString().slice(0, 10);
  const deps = { escHtml, icon };

  const hapticOf = (btn) => { try { const k = btn.getAttribute('data-haptic'); if (k) haptic(k); } catch { /* a haptic is a courtesy */ } };
  const updatedText = () => {
    const ms = isFn(wire.builtAt) ? wire.builtAt() : 0;
    if (!ms || !isFn(d.formatTime)) return '';
    try { return `Updated ${d.formatTime(ms)}`; } catch { return ''; }
  };

  // =================================================================================================================
  // THE DETAIL (frame 2)
  // =================================================================================================================
  /** Send to the Locker Room (PF-520 / DI-963): the app says this member may share now (signed in, chat on) AND the wire has a share for this exact insight (shareable, the strict id shape). */
  const shareOn = () => { try { return isFn(d.shareOffered) && d.shareOffered() === true; } catch { return false; } };
  const shareOf = (id) => (shareOn() && isFn(wire.shareFor) ? wire.shareFor(id) : null);
  const openShare = (id) => { const s0 = shareOf(id); if (s0 && isFn(d.openShare)) d.openShare(s0); };
  const detailModel = (id) => wire.detail(id, { shareOffered: !!shareOf(id), updatedText: updatedText(), formatTime: isFn(d.formatTime) ? d.formatTime : null });

  function openDetail(id, { backLabel = 'Home', restore = null } = {}) {
    if (isContentWithheld() || !isOpenableId(id)) return false;
    ensurePushedScreens();
    if (!restore) beforePush();
    const first = detailModel(id);
    pushScreen({
      id: `insight:${id}`,
      title: 'Insight',
      backLabel,
      restoreKey: id,
      meta: { kind: 'insight', ref: id },
      instant: !!(restore && restore.instant), scrollTop: restore ? restore.scrollTop || 0 : 0,      // DI-588: the Back chip puts the reader back exactly where they were
      render: () => {
        const m = detailModel(id);
        const r = isInsightId(id) ? reads.get(id) : null;
        const html = insightDetailHTML(m && r && r.state !== 'absent' ? { ...m, read: { state: r.state, text: r.text, fresh: r.fresh === true } } : m, deps);
        if (r) r.fresh = false;                                         // the read fades in once, never again on a repaint
        return html;
      },
      onClick: (e, api) => onDetailClick(e, api, id),
    });
    if (first) { try { wire.noteShown([id]); } catch { /* the no-repeat ledger is a courtesy */ } }
    if (first && isInsightId(id)) void requestRead(id);              // DI-1107: SCRIBE's read, once per insight and packet (never for a Game Day fact)
    return true;
  }

  // DI-1107: SCRIBE's read. Memory only (never stored), cleared on an identity change (reset); requested once per (insight, packet hash) per session, only while the platform Ask setting
  // is on and the device is online. Every failure (skipped, failed, unavailable, a refreshed packet) leaves NO section: a discretionary extra never shows an error.
  const reads = new Map();                                          // insight id -> { key, state: 'loading' | 'ok' | 'absent', text, fresh }
  async function requestRead(id) {
    if (!isInsightId(id) || !askOpen() || !online() || !isFn(d.askModel) || !isFn(wire.askShaFor)) return;
    let sha = null;
    try { sha = await wire.askShaFor(id); } catch { sha = null; }
    if (typeof sha !== 'string' || !sha) return;
    const key = `${id}|${sha}`;
    const cur = reads.get(id);
    if (cur && cur.key === key) return;                              // once per insight and packet
    const ctx = wire.askContext(id);
    if (!ctx) return;
    const request = buildAskRequest({ insightId: id, question: { chip: 'take' }, packetSha: sha, leagueId: ctx.leagueId, requestId: `take${Date.now().toString(36)}` });
    if (!request) return;
    reads.set(id, { key, state: 'loading', text: '' });
    paintRead(id);
    let res = null;
    try { res = await d.askModel(request); } catch { res = null; }
    if (!reads.has(id) || reads.get(id).key !== key) return;        // reset or superseded while it was in flight
    const ok = res && res.kind === 'answer' && typeof res.text === 'string' && res.text && res.refreshed !== true;
    reads.set(id, ok ? { key, state: 'ok', text: res.text, fresh: true } : { key, state: 'absent', text: '' });
    paintRead(id);
  }
  /** The read's section, patched IN PLACE on the open detail of that insight (the shell's repaint is debounced a second; the read must not wait for it). The render function draws the
   *  same state on any later repaint, so the two never disagree. */
  function paintRead(id) {
    if (typeof document === 'undefined') return;
    const r = reads.get(id);
    let det = null;
    try { det = Array.from(document.querySelectorAll('#pushed-root .ins-detail')).find((x) => x.getAttribute('data-ins-id') === id) || null; } catch { det = null; }
    if (!det) return;
    const html = r && r.state !== 'absent' ? insightReadHTML({ state: r.state, text: r.text, fresh: r.fresh === true }, deps) : '';
    if (r) r.fresh = false;
    const old = det.querySelector('.ins-read');
    let node = null;
    if (html) { const tmp = document.createElement('div'); tmp.innerHTML = html; node = tmp.querySelector('.ins-read'); }
    if (old && node) { old.parentNode.replaceChild(node, old); return; }
    if (old && !node) { old.parentNode.removeChild(old); return; }
    if (!old && node) {
      const after = det.querySelector('.ins-numbers') || det.querySelector('.cd-head');
      const next = after ? after.nextSibling : det.firstChild;
      if (next) det.insertBefore(node, next); else det.appendChild(node);
    }
  }

  function onDetailClick(e, api, id) {
    const btn = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-ins-action]') : null;
    if (!btn) return;
    const act = btn.getAttribute('data-ins-action');
    if (act === 'back') { api.pop(); return; }
    if (act === 'defn') {                                  // the definition opens in place (nothing above it moves)
      const body = btn.parentNode && typeof btn.parentNode.querySelector === 'function' ? btn.parentNode.querySelector('#ins-defn-body') : null;
      if (!body) return;
      const open = body.hasAttribute('hidden');
      if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      hapticOf(btn);
      return;
    }
    if (act === 'show-all') {
      const list = btn.closest('[data-cd-list]');
      if (!list) return;
      const open = list.getAttribute('data-expanded') !== 'true';
      list.setAttribute('data-expanded', open ? 'true' : 'false');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.textContent = open ? 'Show fewer' : `Show all ${list.querySelectorAll('.cd-item').length}`;
      return;
    }
    const m = detailModel(id);                             // re-derived NOW: the DOM is only a request
    if (act === 'open-game') {                             // DI-964 item 3: a game behind the insight opens that game (the shipped Game view, above this detail); only a game the CURRENT model lists
      const gid = btn.getAttribute('data-ins-game');
      if (!m || typeof gid !== 'string' || !gid || !m.rows.some((r) => r.gameId === gid)) return;
      hapticOf(btn);
      if (isFn(d.openGame)) d.openGame(gid, { backLabel: 'Insight' });
      return;
    }
    if (!m || !m.actions.some((a) => a.id === act)) return;
    hapticOf(btn);
    if (act === 'ask') { openAsk(id); return; }
    if (act === 'your-numbers') { openYourNumbers({ backLabel: 'Insight', fromInsight: true }); return; }
    if (act === 'what-if') { openWhatIf({ backLabel: 'Insight' }); return; }
    if (act === 'share') { openShare(id); return; }                  // offered only when the model holds it (shareable, re-derived now); the share sheet re-asks the gate
    // 'share' is never offered (see the file header), so it is not in the model and never reaches here
  }

  // =================================================================================================================
  // YOUR NUMBERS (frames 4 and 9)
  // =================================================================================================================
  const yn = { sport: null, season: null, failed: false, loading: false, open: { rank: false, seasons: false } };
  const wi = { open: null, table: false, picker: null, copyId: null, teamKey: null };      // the What-if screen's in-place state (the DOM is only a request)
  let unbindPull = null;

  /** the ids the CURRENT Your numbers model lists (the only insight ids a row tap may open) */
  function ynIds(parts) {
    const ids = new Set();
    for (const k of ['labels', 'identity', 'performance', 'social']) for (const c of (parts && parts[k]) || []) if (c && typeof c.id === 'string') ids.add(c.id);
    for (const t of (parts && parts.teams) || []) for (const r of t.rows || []) if (r && typeof r.id === 'string' && r.id) ids.add(r.id);
    return ids;
  }
  const ynParts = () => {
    const p = wire.yourNumbers({ sport: yn.sport, season: yn.season, nextKickoffText: isFn(d.nextKickoffText) ? d.nextKickoffText() : '', archiveSeasons: isFn(d.archiveSeasons) ? d.archiveSeasons() : [], compareOffered: isFn(d.compareOffered) ? d.compareOffered() === true : false });
    return p ? { ...p, open: { ...yn.open } } : null;
  };

  function ynRender() {
    if (!wire.isReady()) {
      if (yn.failed) return yourNumbersHTML(yourNumbersModel({ failed: true }), deps);
      return null;                                         // still loading: the shell draws its skeleton (never a spinner, never a blank page)
    }
    const parts = ynParts();
    if (!parts) return yourNumbersHTML(yourNumbersModel({ failed: true }), deps);
    return yourNumbersHTML(yourNumbersModel(parts), deps);
  }

  /** (Re)build the numbers; resolves true when the engine built (a forced run is a pull-to-refresh or Retry). A second call while one runs joins it. */
  let ynRun = null;
  function ynLoad({ force = false } = {}) {
    if (ynRun) return ynRun;
    yn.loading = true;
    ynRun = (async () => {
      let ok = false;
      try { const r = await wire.refresh({ force }); ok = !!r && r.ok === true; } catch { ok = false; }
      yn.failed = !ok && !wire.isReady();                 // a failed REFRESH over numbers already on screen keeps them (cached content first); only an empty screen says it failed
      yn.loading = false;
      ynRun = null;
      if (isScreenOpen()) invalidateScreens();
      return ok;
    })();
    return ynRun;
  }

  function openYourNumbers({ backLabel = 'Back', fromInsight = false, restore = null } = {}) {
    if (isContentWithheld()) return false;
    ensurePushedScreens();
    if (!restore) beforePush();
    yn.failed = false;
    if (!fromInsight && !restore) { yn.sport = null; yn.season = null; yn.open = { rank: false, seasons: false }; }
    const pushed = pushScreen({
      id: 'insight:your-numbers',
      title: 'Your numbers',
      backLabel,
      restoreKey: 'yn:open',
      meta: { kind: 'your-numbers', ref: 'your-numbers' },
      instant: !!(restore && restore.instant), scrollTop: restore ? restore.scrollTop || 0 : 0,
      render: ynRender,
      onClick: (e, api) => onYourNumbersClick(e, api),
      onClose: () => { try { unbindPull?.(); } catch { /* the listeners go with the level */ } unbindPull = null; },
    });
    if (pushed) { try { unbindPull?.(); } catch { /* replaced */ } unbindPull = bindPull('insight:your-numbers', refreshYourNumbers); }
    if (!wire.isReady()) void ynLoad({ force: false });
    return true;
  }

  /** the pull's refresh: the app's ONE sync path first (its failure is loud: the red banner, AD-06), then the engine on the fresh mirror; true when the numbers rebuilt */
  async function refreshYourNumbers() {
    if (isFn(d.syncNow)) {
      try { await d.syncNow(); } catch (e) { try { if (isFn(d.onSyncFail)) d.onSyncFail(e); } catch { /* the banner is the caller's */ } return false; }
    }
    const ok = await ynLoad({ force: true });
    if (!ok) toast(YN_COPY.refreshFailed, 'warning');
    return ok;
  }

  /** Binds the pull to the level's own scroller and puts the status pill above it (outside the body, so a repaint never removes it). Returns the unbind. */
  function bindPull(levelId, refreshFn) {
    if (typeof document === 'undefined') return () => {};
    const level = Array.from(document.querySelectorAll('#pushed-root .ps-level')).find((l) => l.getAttribute('data-ps-id') === levelId) || null;
    const body = level ? level.querySelector('[data-ps-body]') : null;
    if (!level || !body || !isFn(body.addEventListener)) return () => {};
    const wrap = document.createElement('div');
    wrap.className = 'ins-ptr-wrap';
    wrap.setAttribute('aria-hidden', 'false');
    const pill = document.createElement('p');
    pill.className = 'ins-ptr';
    pill.setAttribute('role', 'status');
    pill.setAttribute('aria-live', 'polite');
    pill.setAttribute('data-phase', 'idle');
    wrap.appendChild(pill);
    level.insertBefore(wrap, body);
    const LABEL = { idle: '', ready: '', pulling: YN_COPY.pull, armed: YN_COPY.release, refreshing: YN_COPY.refreshing, done: '' };
    let st = { phase: 'idle', axis: null }, y0 = null, x0 = null, alive = true, settleTimer = null;
    const set = (next) => {
      const was = st.phase;
      st = next;
      if (st.phase !== was) { pill.setAttribute('data-phase', st.phase); pill.textContent = LABEL[st.phase] || ''; }
    };
    const onStart = (e) => {
      const t = e && e.touches && e.touches[0];
      if (!t || topScreenId() !== levelId || ask || st.phase === 'refreshing') { y0 = null; return; }        // a sheet on top (Ask) or a covered level never pulls
      y0 = t.clientY; x0 = t.clientX;
      set(ptrStep(st, { type: 'start', atTop: (Number(body.scrollTop) || 0) <= 0 }));
    };
    const onMove = (e) => { if (y0 === null) return; const t = e && e.touches && e.touches[0]; if (!t) return; set(ptrStep(st, { type: 'move', dy: t.clientY - y0, dx: t.clientX - x0 })); };
    const onEnd = async () => {
      if (y0 === null) return;
      y0 = null;
      set(ptrStep(st, { type: 'end' }));
      if (st.phase !== 'refreshing') return;
      let ok = false;
      try { ok = (await refreshFn()) === true; } catch { ok = false; }
      if (!alive) return;
      set(ptrStep(st, { type: 'done', ok }));
      if (ok) haptic('light');                               // the Philosophy's "soft impact: pull-to-refresh completes" (native only, haptics.js gates it)
      settleTimer = setTimeout(() => { settleTimer = null; if (alive) set(ptrStep(st, { type: 'settle' })); }, PULL_TO_REFRESH_SUCCESS_FADE_MS);
    };
    const onCancel = () => { y0 = null; set(ptrStep(st, { type: 'cancel' })); };
    body.addEventListener('touchstart', onStart, { passive: true });
    body.addEventListener('touchmove', onMove, { passive: true });
    body.addEventListener('touchend', onEnd, { passive: true });
    body.addEventListener('touchcancel', onCancel, { passive: true });
    return () => {
      alive = false;
      if (settleTimer !== null) { clearTimeout(settleTimer); settleTimer = null; }
      try { body.removeEventListener('touchstart', onStart); body.removeEventListener('touchmove', onMove); body.removeEventListener('touchend', onEnd); body.removeEventListener('touchcancel', onCancel); } catch { /* gone with the level */ }
      try { wrap.remove(); } catch { /* gone */ }
    };
  }

  /** flips one in-place disclosure (.ins-xp) and its trigger's aria-expanded; the height animates in CSS (150 ms, --ease-native), Reduce Motion swaps at once. Returns the new state, or null. */
  function toggleXp(btn) {
    const xp = btn && isFn(btn.closest) ? btn.closest('.ins-xp') : null;
    if (!xp) return null;
    const open = xp.getAttribute('data-open') !== 'true';
    xp.setAttribute('data-open', open ? 'true' : 'false');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    return open;
  }

  function onYourNumbersClick(e, api) {
    const btn = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-ins-action]') : null;
    if (!btn) return;
    const act = btn.getAttribute('data-ins-action');
    if (act === 'back') { api.pop(); return; }
    if (act === 'yn-retry') { hapticOf(btn); yn.failed = false; if (isScreenOpen()) invalidateScreens(); void ynLoad({ force: true }); return; }
    if (!wire.isReady()) return;
    const parts = ynParts();
    if (!parts) return;
    if (act === 'yn-sport') {
      const sp = btn.getAttribute('data-ins-sport');
      if (!parts.sports.includes(sp) || sp === parts.sport) return;     // only a sport the model lists, and a tap on the current one changes nothing
      haptic('selection');
      yn.sport = sp; yn.season = null;                                // a sport's own latest season
      invalidateScreens();
      return;
    }
    if (act === 'yn-open') {
      const id = btn.getAttribute('data-ins-id');
      if (!isInsightId(id) || !ynIds(parts).has(id)) return;          // not a row of the current model: nothing happens
      hapticOf(btn);
      openDetail(id, { backLabel: 'Your numbers' });
      return;
    }
    if (act === 'open-profile') {
      hapticOf(btn);
      if (isFn(d.openProfile)) d.openProfile();
      return;
    }
    const model = yourNumbersModel(parts);
    if (act === 'yn-xp') {                                             // the rank table twin or the Seasons rows, opened in place; only a disclosure the CURRENT model draws
      const which = btn.getAttribute('data-ins-xp');
      if (!((which === 'rank' && model.rankPath) || (which === 'seasons' && model.seasons.length >= 2))) return;
      const open = toggleXp(btn);
      if (open === null) return;
      yn.open[which] = open;
      if (which === 'rank') { const lab = btn.querySelector('span'); if (lab) lab.textContent = open ? YN_COPY.rankHide : YN_COPY.rankTable; }
      else hapticOf(btn);
      return;
    }
    if (act === 'yn-compare') {                                        // "Compare with..." (DI-964): the shipped rival picker, then the shipped Compare screen above this one
      if (!model.compare || !isFn(d.openCompare)) return;
      hapticOf(btn);
      d.openCompare({ competitionId: parts.competitionId, opener: btn });
      return;
    }
    if (act === 'yn-what-if') {
      if (!model.whatIf) return;
      hapticOf(btn);
      openWhatIf({ backLabel: 'Your numbers' });
      return;
    }
    if (act === 'yn-season') {                                         // another season this league's record holds: the whole screen follows it
      const sv = btn.getAttribute('data-ins-season');
      if (!model.seasons.some((x) => x.kind === 'record' && !x.current && x.season === sv)) return;
      haptic('selection');
      yn.season = sv;
      api.repaint();
      return;
    }
    if (act === 'yn-season-archive') {                                 // an archive season (IRB's 2025, weekly totals only): the season record where it already lives, Standings
      const sv = btn.getAttribute('data-ins-season');
      if (!model.seasons.some((x) => x.kind === 'archive' && x.season === sv) || !isFn(d.openSeasonArchive)) return;
      hapticOf(btn);
      d.openSeasonArchive(sv);
    }
  }

  // =================================================================================================================
  // WHAT IF (frame 5; DI-978 to 982; PF-524's only visible surface)
  // =================================================================================================================
  const wiParts = () => wire.whatIf({ sport: yn.sport, season: yn.season, copyId: wi.copyId, teamKey: wi.teamKey });
  const wiModel = () => (wire.isReady() ? whatIfModel(wiParts(), wi) : null);
  function wiRender() {
    if (!wire.isReady()) return yn.failed ? whatIfHTML(null, deps) : null;     // still loading: the shell's skeleton
    return whatIfHTML(wiModel(), deps);
  }
  function openWhatIf({ backLabel = 'Your numbers', restore = null } = {}) {
    if (isContentWithheld()) return false;
    ensurePushedScreens();
    if (!restore) { beforePush(); wi.open = null; wi.table = false; wi.picker = null; }
    pushScreen({
      id: 'insight:what-if',
      title: 'What if',
      backLabel,
      restoreKey: 'yn:what-if',
      meta: { kind: 'what-if', ref: 'what-if' },
      instant: !!(restore && restore.instant), scrollTop: restore ? restore.scrollTop || 0 : 0,
      render: wiRender,
      onClick: (e, api) => onWhatIfClick(e, api),
    });
    if (!wire.isReady()) void ynLoad({ force: false });
    return true;
  }
  function onWhatIfClick(e, api) {
    const btn = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-ins-action]') : null;
    if (!btn) return;
    const act = btn.getAttribute('data-ins-action');
    const m = wiModel();                                               // re-derived NOW: the DOM is only a request
    if (!m || m.none || m.thin) return;
    if (act === 'wi-row') {
      const k = btn.getAttribute('data-ins-key');
      if (!m.rows.some((r) => r.key === k)) return;
      const open = toggleXp(btn);
      if (open === null) return;
      if (open) {                                                      // one row open at a time: the one before folds back
        const scope = btn.closest('.wi-group');
        for (const x of scope ? Array.from(scope.querySelectorAll('.wi-row')) : []) {
          if (x.getAttribute('data-xp') === k || x.getAttribute('data-open') !== 'true') continue;
          x.setAttribute('data-open', 'false');
          const t = x.querySelector('[data-ins-action="wi-row"]'); if (t) t.setAttribute('aria-expanded', 'false');
        }
      }
      wi.open = open ? k : null;
      hapticOf(btn);
      return;
    }
    if (act === 'wi-games') {                                          // "Show the games": the strategy's own insight detail (its games behind it), above this screen
      const row = m.rows.find((r) => r.key === btn.getAttribute('data-ins-key'));
      if (!row || !isInsightId(row.id)) return;
      hapticOf(btn);
      openDetail(row.id, { backLabel: 'What if' });
      return;
    }
    if (act === 'wi-picker') {
      const which = btn.getAttribute('data-ins-picker');
      if (!((which === 'copy' && m.copy.choices.length) || (which === 'team' && m.team.choices.length > 1))) return;
      const open = toggleXp(btn);
      if (open === null) return;
      wi.picker = open ? which : null;
      hapticOf(btn);
      return;
    }
    if (act === 'wi-copy') {
      const id = btn.getAttribute('data-ins-member');
      if (!m.copy.choices.some((c) => c.id === id)) return;           // only a member this screen lists right now (no haptic anywhere on this screen: DI-982)
      wi.copyId = id; wi.picker = null; wi.open = 'copy';
      api.repaint();
      return;
    }
    if (act === 'wi-team') {
      const key = btn.getAttribute('data-ins-team');
      if (!m.team.choices.some((c) => c.key === key)) return;
      wi.teamKey = key; wi.picker = null; wi.open = 'team';
      api.repaint();
      return;
    }
    if (act === 'wi-table') {
      if (!m.rows.some((r) => r.weeks && r.weeks.length)) return;
      wi.table = !wi.table;
      api.repaint();
    }
  }

  // =================================================================================================================
  // ASK SCRIBE (frame 3; W-129): the sheet, instant answers from the league record, the open path DARK
  // =================================================================================================================
  let ask = null;       // { id, ctx, turns[], limits, draft, changed, closing, onKey, opener, unbind, packetKey }
  let askLimits = emptyAskState();      // loaded from / saved to the device-local per-identity record (storage.js INSIGHT_STATE) through the injected loadAskLimits / saveAskLimits
  const loadLimits = () => { try { const s0 = isFn(d.loadAskLimits) ? d.loadAskLimits() : null; askLimits = s0 && typeof s0 === 'object' ? { dayKey: s0.dayKey, dayCount: s0.dayCount, byInsight: { ...s0.byInsight } } : emptyAskState(); } catch { askLimits = emptyAskState(); } };
  const saveLimits = () => { try { if (isFn(d.saveAskLimits)) d.saveAskLimits(askLimits); } catch { /* a counter is a courtesy */ } };

  const chipLabel = (cid) => { const c = CHIP_DEFS.find((x) => x.id === cid); return c ? c.label : cid; };
  const askOpen = () => { try { return isFn(d.isAskOpen) && d.isAskOpen() === true; } catch { return false; } };

  function askView() {
    const a = ask;
    const day = dayKey();
    const cap = !canAskModel(askLimits, a.id, day).ok ? canAskModel(askLimits, a.id, day).reason : null;
    const open = askOpen() && (isInsightId(a.id) || isGdFactId(a.id)) && a.off !== true;   // DI-1109: a Game Day fact is asked too; the server's switch off hides the composer
    return { turns: a.turns, chips: a.ctx.chips, scope: a.ctx.scope, wide: isWide(), modelEnabled: open, offline: !online(), changed: a.changed, capped: open ? cap : null, budget: a.budget === true, gone: a.gone === true, shareOffered: a.ctx.shareOffered === true && !!shareOf(a.id), draft: a.draft };
  }

  function paintAsk(focusSel = null) {
    const body = typeof document !== 'undefined' ? document.getElementById('ask-sheet-body') : null;
    if (!body || !ask) return;
    const input = body.querySelector('#ask-input');
    if (input) ask.draft = String(input.value || '');
    body.innerHTML = askBodyHTML(askView(), deps);
    for (const t of ask.turns) t.fresh = false;                       // DI-970: only the answer that has just arrived fades in; a repaint never replays it
    if (focusSel) { try { body.querySelector(focusSel)?.focus?.({ preventScroll: true }); } catch { /* focus is a courtesy */ } }
    // DI-970: the transcript scrolls so the TOP of the newest answer is in view (its question just above it), never to the bottom; nothing moves when there is no conversation yet
    try {
      const mine = ask.turns.length ? body.querySelectorAll('.ask-turn--me') : [];
      const anchor = mine.length ? mine[mine.length - 1] : null;
      if (anchor && isFn(anchor.getBoundingClientRect) && isFn(body.getBoundingClientRect)) {
        const top = anchor.getBoundingClientRect().top - body.getBoundingClientRect().top + (Number(body.scrollTop) || 0) - 8;
        body.scrollTop = Math.max(0, Math.round(top));
      }
    } catch { /* scroll is a courtesy */ }
  }

  function openAsk(id) {
    if (isContentWithheld() || !isOpenableId(id)) return false;
    const ctx = wire.askContext(id);
    if (!ctx) { toast(ASK_COPY.unavailable, 'warning'); return false; }
    closeAsk({ immediate: true });
    loadLimits();                       // the counters come from the device's record for THIS identity (a reload keeps them)
    let opener = null;
    try { opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null; } catch { opener = null; }
    const a = { id, ctx, turns: [], draft: '', changed: false, closing: false, onKey: null, opener, unbind: null, packetKey: ctx.sealed ? ctx.sealed.key : '', budget: false, gone: false, seq: 0 };
    ask = a;
    const { wrap, unbind } = mountSheetShell({
      wrapId: ASK_WRAP_ID,
      sheetId: ASK_SHEET_ID,
      sheetAttrs: ' role="dialog" aria-modal="true" aria-labelledby="ask-sheet-title"',
      headerInnerHTML: `<div class="ask-head-text"><div class="chat-sheet-title" id="ask-sheet-title" tabindex="-1">${escHtml(ASK_COPY.title)}</div></div><button type="button" class="chat-sheet-close" id="ask-sheet-close" aria-label="Close">${icon('close')}</button>`,
      bodyId: 'ask-sheet-body',
      closeId: 'ask-sheet-close',
      onBackdrop: () => closeAsk(),
      renderBody: () => paintAsk(),
      drag: {
        getBlocked: () => dismissBlocked({ ownSheet: true }),
        onProgress: (w, sheetEl, progress) => { sheetEl.setAttribute('data-dragging', 'true'); w.setAttribute('data-dragging', 'true'); w.style.setProperty('--ask-drag-y', String(progress)); },
        onSettle: (w, sheetEl, { dismissed, reducedMotion } = {}) => {
          sheetEl.removeAttribute('data-dragging'); w.removeAttribute('data-dragging');
          if (!dismissed) { w.style.setProperty('--ask-drag-y', '0'); return; }
          if (isFn(d.finishSlide)) d.finishSlide({ listenEl: sheetEl, apply: () => w.style.setProperty('--ask-drag-y', '1'), reducedMotion: !!reducedMotion, done: () => closeAsk({ immediate: true }) });
          else closeAsk({ immediate: true });
        },
      },
    });
    a.unbind = unbind;
    wrap.addEventListener('click', onAskClick);
    wrap.addEventListener('keydown', onAskKeydown);
    wrap.addEventListener('input', onAskInput);
    // the platform setting is re-read when the sheet opens (cached five minutes); a change repaints the chips and the composer, nothing else moves
    if (isFn(d.refreshAskOpen)) {
      Promise.resolve().then(() => d.refreshAskOpen()).then((changed) => {
        if (changed !== true || ask !== a || a.closing) return;
        const fresh = wire.askContext(a.id);
        if (fresh) a.ctx = fresh;
        paintAsk();
      }, () => {});
    }
    a.onKey = (e) => { if (e && e.key === 'Escape' && ask === a) closeAsk(); };
    document.addEventListener('keydown', a.onKey);
    try { wrap.querySelector('#ask-sheet-title')?.focus?.({ preventScroll: true }); } catch { /* focus is a courtesy */ }
    return true;
  }

  function closeAsk({ immediate = false } = {}) {
    const a = ask;
    const wrap = typeof document !== 'undefined' ? document.getElementById(ASK_WRAP_ID) : null;
    if (a) {
      if (a.closing && !immediate) return;
      a.closing = true;
      try { a.unbind?.(); } catch { /* the drag teardown is a courtesy */ }
      a.unbind = null;
      if (a.onKey) { try { document.removeEventListener('keydown', a.onKey); } catch { /* courtesy */ } a.onKey = null; }
    }
    const finish = () => {
      try { if (wrap && document.getElementById(ASK_WRAP_ID) === wrap) wrap.remove(); } catch { /* already gone */ }
      if (ask === a) ask = null;
      try { if (a && a.opener && a.opener.isConnected && typeof a.opener.focus === 'function' && !document.getElementById(ASK_WRAP_ID)) a.opener.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ }
    };
    if (!wrap || immediate) { finish(); return; }
    playSheetExit(wrap, finish, { sheetId: ASK_SHEET_ID, dragVar: '--ask-drag-y' });
  }

  /** DI-1110: the chat composer's rule (chat-ui.js): on a WIDE viewport Return sends and Shift+Return adds a line; on a phone the Return key adds a line and Send sends. */
  const isWide = () => { try { return isFn(d.isWide) ? d.isWide() === true : (typeof matchMedia === 'function' && matchMedia('(min-width: 700px)').matches === true); } catch { return false; } };
  function onAskKeydown(e) {
    if (!ask || !e || e.key !== 'Enter' || !e.target || e.target.id !== 'ask-input') return;
    if (e.isComposing) return;                                         // an IME composition is still choosing a character
    if (e.shiftKey || !isWide()) return;                               // a new line: Shift+Return anywhere, Return on a phone
    e.preventDefault();
    sendQuestion();
  }

  /** DI-970: the counter appears from 250 characters; typing never repaints the sheet (the field keeps its caret and the keyboard stays up) */
  function onAskInput(e) {
    const a = ask;
    if (!a || !e || !e.target || e.target.id !== 'ask-input') return;
    a.draft = String(e.target.value || '');
    // DI-1110: the field grows with its lines to three rows (the sheet keeps its height; the height change is the CSS's 120 ms, none under Reduce Motion)
    try { const rows = composerRows(a.draft); e.target.setAttribute('rows', String(rows)); if (e.target.style && typeof e.target.style.setProperty === 'function') e.target.style.setProperty('--ask-rows', String(rows)); } catch { /* growth is a courtesy */ }
    const c = typeof document !== 'undefined' ? document.querySelector('#ask-sheet-body [data-ask-count]') : null;
    if (!c) return;
    const n = a.draft.length;
    c.textContent = `${n}/${ASK_LIMITS.questionMax}`;
    if (n >= ASK_LIMITS.counterFrom) c.classList.remove('ask-count--hide'); else c.classList.add('ask-count--hide');
  }

  function onAskClick(e) {
    const btn = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-ask-action]') : null;
    const a = ask;
    if (!btn || !a || a.closing || btn.disabled) return;
    const act = btn.getAttribute('data-ask-action');
    if (act === 'chip') {
      const cid = btn.getAttribute('data-ask-chip');
      if (!a.ctx.chips.some((c) => c.id === cid)) return;           // only a chip this insight offers
      hapticOf(btn);
      answerChip(cid);
      return;
    }
    if (act === 'send') { sendQuestion(); return; }                  // DI-970: sending is silent (no haptic)
    if (act === 'what-if') {                                          // "Open What if" under a model answer: only for a strategy insight whose answer is on screen NOW
      if (!(a.ctx.whatIf === true && a.turns.some((t) => t.state === 'model' && t.link === 'what-if'))) return;
      hapticOf(btn);
      closeAsk({ immediate: true });
      openWhatIf({ backLabel: 'Insight' });
      return;
    }
    if (act === 'refresh') {
      hapticOf(btn);
      const fresh = wire.askContext(a.id);
      if (!fresh) { closeAsk({ immediate: true }); toast(ASK_COPY.unavailable, 'warning'); return; }
      a.ctx = fresh; a.packetKey = fresh.sealed ? fresh.sealed.key : ''; a.changed = false;
      paintAsk();
      return;
    }
    if (act === 'share') {                                            // only when this insight is shareable NOW (re-derived; a forged button on an unshareable insight does nothing)
      if (!(a.ctx.shareOffered === true && shareOf(a.id))) return;
      hapticOf(btn);
      openShare(a.id);
    }
  }

  function answerChip(cid) {
    const a = ask;
    const q = chipLabel(cid);
    const chip = a.ctx.chips.find((c) => c.id === cid);
    if (chip && chip.model) { sendQuestion({ chip: cid, label: q }); return; }   // "Why is this unusual?" goes to the server (the analysis route)
    const ans = a.ctx.answer(cid);
    a.turns.push(ans ? { q, a: ans, state: 'instant', fresh: true } : { q, a: null, state: 'failed', fresh: true });
    paintAsk();
  }

  /** The games behind the insight, as the instant answer the failure sentence promises (DI-970: never an invented answer, never a technical word). */
  const gamesFallback = (a) => { try { return a.ctx.answer('games'); } catch { return null; } };

  function sendQuestion(forced = null) {
    const a = ask;
    if (!a || !askOpen() || !(isInsightId(a.id) || isGdFactId(a.id)) || a.budget || a.gone || a.off) return;
    const input = typeof document !== 'undefined' ? document.getElementById('ask-input') : null;
    const chip = forced && typeof forced === 'object' && forced.chip === 'why' ? forced : null;
    const text = chip ? chip.label : (input ? String(input.value || '') : a.draft);
    const day = dayKey();
    const can = canAskModel(askLimits, a.id, day);
    if (!can.ok) { paintAsk(); return; }
    if (!online()) { paintAsk(); return; }
    const prior = a.turns.filter((t) => t.state === 'model' && t.a).map((t) => ({ q: t.q, a: t.a.text }));
    // a structural check before anything is counted or drawn: the hash is filled in below, so a placeholder of the right shape stands in
    if (!buildAskRequest({ insightId: a.id, question: chip ? { chip: 'why' } : text, packetSha: '0'.repeat(64), leagueId: a.ctx.leagueId, turns: prior })) return;
    askLimits = noteModelAsk(askLimits, a.id, day);
    saveLimits();
    a.draft = '';
    if (input) input.value = '';
    const turn = { q: chip ? chip.label : String(text).replace(/\s+/g, ' ').trim(), a: null, state: 'loading' };
    a.turns.push(turn);
    paintAsk();
    const seq = ++a.seq;
    const fail = () => { if (ask !== a) return; turn.state = 'failed'; turn.a = gamesFallback(a); turn.fresh = true; paintAsk(); };
    if (!isFn(d.askModel) || !isFn(wire.askShaFor)) { fail(); return; }
    Promise.resolve().then(() => wire.askShaFor(a.id)).then((sha) => {
      const request = buildAskRequest({ insightId: a.id, question: chip ? { chip: 'why' } : text, packetSha: sha, leagueId: a.ctx.leagueId, turns: prior, requestId: `ask${Date.now().toString(36)}${seq}` });
      if (!request) return { kind: 'failed' };
      return d.askModel(request);
    }).then((res) => {
      if (ask !== a) return;
      const kind = res && typeof res.kind === 'string' ? res.kind : 'failed';
      if (res && res.refreshed === true) a.changed = true;            // the server's numbers moved: "These numbers were updated." with Refresh
      turn.fresh = true;
      if (kind === 'answer' && typeof res.text === 'string' && res.text) {
        turn.a = { text: res.text, source: ASK_COPY.fromScribe }; turn.state = 'model';
        if (res.asOf && isFn(d.formatTime)) { try { turn.asOfText = d.formatTime(Date.parse(res.asOf)); } catch { turn.asOfText = ''; } }
        if (a.ctx.whatIf === true) turn.link = 'what-if';
      } else if (kind === 'day' || kind === 'insight') {
        a.turns.splice(a.turns.indexOf(turn), 1);                      // the server's count wins: the sheet shows the cap sentence, the question is not answered
        askLimits = kind === 'day' ? { ...askLimits, dayKey: day, dayCount: ASK_LIMITS.perDay } : { ...askLimits, byInsight: { ...askLimits.byInsight, [a.id]: ASK_LIMITS.perInsight } };
        saveLimits();
      } else if (kind === 'budget') {
        a.turns.splice(a.turns.indexOf(turn), 1); a.budget = true;
      } else if (kind === 'disabled') {
        turn.state = 'failed'; turn.a = gamesFallback(a); a.off = true;      // switched off on the server since the sheet opened: the games, and no composer
      } else if (kind === 'unavailable') {
        a.turns.splice(a.turns.indexOf(turn), 1); a.gone = true;
      } else { turn.state = 'failed'; turn.a = gamesFallback(a); }
      paintAsk();
    }, fail);
  }

  /** the wire rebuilt: an open Ask sheet whose insight changed offers a Refresh; an open sheet whose insight is gone says so */
  function notifyDataChanged() {
    const a = ask;
    if (!a || a.closing) return;
    const fresh = wire.askContext(a.id);
    if (!fresh) { a.changed = true; paintAsk(); return; }
    const key = fresh.sealed ? fresh.sealed.key : '';
    if (key !== a.packetKey) { a.changed = true; paintAsk(); }
  }

  // =================================================================================================================
  // GAME DAY: the Game insights sheet (frame 6; DI-977, DI-1087; PF-523)
  // =================================================================================================================
  let gdi = null;      // { gameId, open, more, closing, unbind, onKey, opener, lastRank, painted: [fid] }
  const gdiModel = (g) => { const s0 = wire.gameDaySheet(g.gameId, { formatTime: isFn(d.formatTime) ? d.formatTime : null }); return s0 ? { ...s0, open: s0.facts.some((f) => f.fid === g.open) ? g.open : null, more: g.more } : null; };
  const rankKey = (m) => { const c = m ? m.facts.find((f) => f.kind === 'gd.consequence') : null; return c ? `${c.toRank}|${c.tied}` : ''; };

  /** Opens the sheet for a game that HAS facts right now (a row tapped on a stale screen opens nothing). The Game view stays beneath it. */
  function openGameInsights(gameId, { opener = null } = {}) {
    if (isContentWithheld() || typeof gameId !== 'string' || !gameId || !isFn(wire.gameDaySheet)) return false;
    const first = wire.gameDaySheet(gameId, { formatTime: isFn(d.formatTime) ? d.formatTime : null });
    if (!first) return false;
    closeGameInsights({ immediate: true });
    const g = { gameId, open: null, more: false, closing: false, unbind: null, onKey: null, opener: opener || (typeof document !== 'undefined' ? document.activeElement : null), lastRank: rankKey(first), painted: [] };
    gdi = g;
    const { wrap, unbind } = mountSheetShell({
      wrapId: GDI_WRAP_ID,
      sheetId: GDI_SHEET_ID,
      sheetAttrs: ' role="dialog" aria-modal="true" aria-labelledby="gdi-sheet-title"',
      headerInnerHTML: `<div class="ask-head-text"><div class="chat-sheet-title" id="gdi-sheet-title" tabindex="-1">${escHtml(GDI_COPY.title)}</div><p class="gdi-sub" data-gdi-sub>${escHtml(first.subtitle)}</p></div><button type="button" class="chat-sheet-close" id="gdi-sheet-close" aria-label="Close">${icon('close')}</button>`,
      bodyId: 'gdi-sheet-body',
      closeId: 'gdi-sheet-close',
      onBackdrop: () => closeGameInsights(),
      renderBody: () => paintGdi(),
      drag: {
        getBlocked: () => (isFn(d.gdiDismissBlocked) ? d.gdiDismissBlocked() : dismissBlocked({ ownSheet: true })),
        onProgress: (w, sheetEl, progress) => { sheetEl.setAttribute('data-dragging', 'true'); w.setAttribute('data-dragging', 'true'); w.style.setProperty('--gdi-drag-y', String(progress)); },
        onSettle: (w, sheetEl, { dismissed, reducedMotion } = {}) => {
          sheetEl.removeAttribute('data-dragging'); w.removeAttribute('data-dragging');
          if (!dismissed) { w.style.setProperty('--gdi-drag-y', '0'); return; }
          if (isFn(d.finishSlide)) d.finishSlide({ listenEl: sheetEl, apply: () => w.style.setProperty('--gdi-drag-y', '1'), reducedMotion: !!reducedMotion, done: () => closeGameInsights({ immediate: true }) });
          else closeGameInsights({ immediate: true });
        },
      },
    });
    g.unbind = unbind;
    wrap.addEventListener('click', onGdiClick);
    g.onKey = (e) => { if (e && e.key === 'Escape' && gdi === g) closeGameInsights(); };
    document.addEventListener('keydown', g.onKey);
    try { wrap.querySelector('#gdi-sheet-title')?.focus?.({ preventScroll: true }); } catch { /* focus is a courtesy */ }
    return true;
  }

  function paintGdi() {
    const body = typeof document !== 'undefined' ? document.getElementById('gdi-sheet-body') : null;
    if (!body || !gdi) return;
    const m = gdiModel(gdi);
    body.innerHTML = gameInsightsBodyHTML(m, deps);
    gdi.painted = m ? m.facts.map((f) => f.fid) : [];
  }

  /**
   * The facts moved under an open sheet (a score tick). The same facts: each changed sentence CROSS-FADES in place (150 ms; Reduce Motion swaps it) and nothing else moves; a different set of
   * facts redraws the list (the open row and "Show more" are kept). The live region speaks only when YOUR place in the consequence changed (DI-977), never on every tick.
   */
  function notifyGameDayChanged() {
    const g = gdi;
    if (!g || g.closing || typeof document === 'undefined') return;
    const body = document.getElementById('gdi-sheet-body');
    if (!body) return;
    const m = gdiModel(g);
    const sub = document.querySelector('#gdi-sheet [data-gdi-sub]');
    if (m && sub && sub.textContent !== m.subtitle) swapText(sub, m.subtitle);
    const same = !!m && m.facts.length === g.painted.length && m.facts.every((f, i) => f.fid === g.painted[i]);
    if (!same) { paintGdi(); }
    else {
      for (const f of m.facts) {
        const row = Array.from(body.querySelectorAll('.gdi-fact')).find((x) => x.getAttribute('data-xp') === f.fid);
        const line = row ? row.querySelector('.gdi-line') : null;
        if (line && line.textContent !== f.line) swapText(line, f.line);
        const figs = row ? row.querySelector('.ins-figs') : null;
        if (figs) { const fresh = gameInsightsBodyHTML({ ...m, facts: [f], visibleN: 1, open: null, more: false }, deps); const box = document.createElement('div'); box.innerHTML = fresh; const nf = box.querySelector('.ins-figs'); if (nf && nf.innerHTML !== figs.innerHTML) figs.innerHTML = nf.innerHTML; }
      }
    }
    const rk = rankKey(m);
    if (rk && g.lastRank && rk !== g.lastRank) {
      const live = body.querySelector('[data-gdi-live]');
      const c = m.facts.find((f) => f.kind === 'gd.consequence');
      if (live && c) live.textContent = c.line;
    }
    g.lastRank = rk || g.lastRank;
  }
  function swapText(el, text) {
    const apply = () => { el.innerHTML = `<span>${escHtml(text)}</span>`; };
    if (isFn(d.crossFade)) { try { d.crossFade(el, apply); return; } catch { /* a fade is decoration */ } }
    apply();
  }

  function closeGameInsights({ immediate = false } = {}) {
    const g = gdi;
    const wrap = typeof document !== 'undefined' ? document.getElementById(GDI_WRAP_ID) : null;
    if (g) {
      if (g.closing && !immediate) return;
      g.closing = true;
      try { g.unbind?.(); } catch { /* the drag teardown is a courtesy */ }
      g.unbind = null;
      if (g.onKey) { try { document.removeEventListener('keydown', g.onKey); } catch { /* courtesy */ } g.onKey = null; }
    }
    const finish = () => {
      try { if (wrap && document.getElementById(GDI_WRAP_ID) === wrap) wrap.remove(); } catch { /* already gone */ }
      if (gdi === g) gdi = null;
      try { if (g && g.opener && g.opener.isConnected && typeof g.opener.focus === 'function' && !document.getElementById(GDI_WRAP_ID) && !document.getElementById(ASK_WRAP_ID)) g.opener.focus({ preventScroll: true }); } catch { /* focus is a courtesy */ }
    };
    if (!wrap || immediate) { finish(); return; }
    playSheetExit(wrap, finish, { sheetId: GDI_SHEET_ID, dragVar: '--gdi-drag-y' });
  }

  function onGdiClick(e) {
    const btn = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-gdi-action]') : null;
    const g = gdi;
    if (!btn || !g || g.closing) return;
    const act = btn.getAttribute('data-gdi-action');
    const m = gdiModel(g);                                             // re-derived NOW: the DOM is only a request
    if (!m) return;
    if (act === 'more') {                                              // the rest of the facts (at most six), opened in place
      if (m.facts.length <= m.visibleN) return;
      const list = btn.parentNode && isFn(btn.parentNode.querySelector) ? btn.parentNode.querySelector('.gdi-list') : null;
      if (!list) return;
      g.more = !g.more;
      list.setAttribute('data-expanded', g.more ? 'true' : 'false');
      btn.setAttribute('aria-expanded', g.more ? 'true' : 'false');
      btn.textContent = g.more ? GDI_COPY.fewer : GDI_COPY.more(m.facts.length - m.visibleN);
      hapticOf(btn);
      return;
    }
    const fid = btn.getAttribute('data-gdi-fact');
    if (!m.facts.some((f) => f.fid === fid)) return;                  // only a fact on this sheet right now
    if (act === 'fact') {
      const open = toggleXp(btn);
      if (open === null) return;
      if (open) for (const x of Array.from(btn.closest('.gdi-list') ? btn.closest('.gdi-list').querySelectorAll('.gdi-fact') : [])) {
        if (x.getAttribute('data-xp') === fid || x.getAttribute('data-open') !== 'true') continue;
        x.setAttribute('data-open', 'false');
        const t = x.querySelector('[data-gdi-action="fact"]'); if (t) t.setAttribute('aria-expanded', 'false');
      }
      g.open = open ? fid : null;
      hapticOf(btn);
      return;
    }
    const id = wire.gameDayFactId(g.gameId, fid);
    if (act === 'ask') { hapticOf(btn); closeGameInsights({ immediate: true }); openAsk(id); return; }                 // the Ask sheet REPLACES this one (DI-977)
    if (act === 'details') { hapticOf(btn); closeGameInsights({ immediate: true }); openDetail(id, { backLabel: 'Game' }); }   // the detail pushes above the game; Back returns to it
  }

  /** an identity or league change, or a hold: everything this module holds is the departed account's */
  function reset() {
    yn.sport = null; yn.season = null; yn.failed = false; yn.loading = false; yn.open = { rank: false, seasons: false };
    wi.open = null; wi.table = false; wi.picker = null; wi.copyId = null; wi.teamKey = null;
    try { unbindPull?.(); } catch { /* gone */ } unbindPull = null;
    askLimits = emptyAskState();        // memory only: the stored record belongs to its identity and is read back under that identity
    reads.clear();                      // DI-1107: SCRIBE's reads are the departed identity's
    if (ask) closeAsk({ immediate: true });
    if (gdi) closeGameInsights({ immediate: true });
  }

  return {
    openDetail, openYourNumbers, openWhatIf, openAsk, closeAsk, notifyDataChanged, reset, isInsightId, openGameInsights, closeGameInsights, notifyGameDayChanged,
    _gdiStateForTest: () => (gdi ? { gameId: gdi.gameId, open: gdi.open, more: gdi.more, lastRank: gdi.lastRank } : null),
    _askStateForTest: () => (ask ? { id: ask.id, turns: ask.turns.map((t) => ({ q: t.q, state: t.state })), changed: ask.changed } : null),
    _ynStateForTest: () => ({ ...yn, open: { ...yn.open } }),
    _wiStateForTest: () => ({ ...wi }),
  };
}
