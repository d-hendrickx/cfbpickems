/**
 * js/spread-find-ui.js - W-71 (Deployment 1, batch D, 2026-10-14): THE WIRING OF "FIND SPREADS" (UN-W71 / PF-W71, DI-W71.2, DI-W71.5, DI-W71.8).
 * =================================================================================================================================================
 * js/spread-fallback.js decides; this file holds the little state a screen needs (is a check running, which cards are waiting, which were declined), paints the block into every host
 * that is on screen, and turns three taps (Find spreads, Include, No thanks) into calls. Every effect is a dependency handed to `createSpreadFindUI(deps)`, so js/app.js stays a thin
 * caller (four call sites) and each behavior is proven in oddsfallbacktest.mjs with a fake clock, a fake storage and a fake lookup.
 *
 * WHERE IT SHOWS: any element carrying `data-spread-host` (wizard Step 3, the Games tab). The block PATCHES into the host in place - no page repaint when a lookup answers, so nothing
 * jumps - and a write (a line included, an ESPN line found) asks the screen to repaint through `deps.repaintHost`, because the rows and the banner count changed.
 *
 * ONE RULE ABOVE ALL (DI-W71.7 #1): nothing but `include()` ever writes a non-ESPN line, and `include()` runs only from the commissioner's tap on that card's Include button.
 */
import * as SF from './spread-fallback.js';

const LEAVE_MS = 200;   // a card collapses over the motion system's large-layout range, not instantly

export function createSpreadFindUI(deps) {
  const states = new Map();
  const stateFor = (weekId) => {
    if (!states.has(weekId)) states.set(weekId, { phase: 'idle', cards: [], noLine: 0, note: '', noteKind: '', declined: new Set(), autoRan: false, busy: new Set() });
    return states.get(weekId);
  };

  /** Check runs only on a week that can still take a spread: not demo, and no later than open. */
  const canRun = (week) => !!week && week.dataSourceMode !== 'demo' && (week.status === 'draft' || week.status === 'open');

  function blockHTML(week, games) {
    if (!canRun(week)) return '';
    const missingCount = SF.findMissingSpreads(games).length;
    return SF.findBlockHTML({ missingCount, state: stateFor(week.weekId), games, escHtml: deps.escHtml, formatTime: deps.formatTime });
  }
  /** The host element a screen embeds: always present (empty when nothing is missing) so a later patch has somewhere to land. */
  function hostHTML(week, games) {
    if (!week) return '';
    return `<div data-spread-host data-week-id="${deps.escHtml(week.weekId)}">${blockHTML(week, games)}</div>`;
  }

  function hostsFor(weekId) {
    return [...deps.document.querySelectorAll('[data-spread-host]')].filter((h) => h.getAttribute('data-week-id') === weekId);
  }
  /** Patch the block into every host of this week that is on screen. In place: the host and its listener stay, only its contents change. */
  function paint(weekId) {
    const week = deps.getWeek(weekId);
    if (!week) return;
    const html = blockHTML(week, deps.getGames(weekId));
    // A host whose block is already exactly this is left alone (a patch of the Games list asks often; a focused button must not be rebuilt under the finger for nothing).
    for (const h of hostsFor(weekId)) { if (h._sfHtml === html) continue; h.innerHTML = html; h._sfHtml = html; }
  }

  /** Collapse this game's card in EVERY host that shows it (the wizard sheet and the Comm page beneath it can both be up: the one on screen must not be the one left standing). */
  function leave(weekId, gameId) {
    const els = hostsFor(weekId).flatMap((h) => [...h.querySelectorAll('[data-spread-card]')]).filter((c) => c.getAttribute('data-spread-card') === gameId);
    if (!els.length || deps.reducedMotion()) return Promise.resolve();
    for (const el of els) el.classList.add('is-leaving');
    return new Promise((res) => setTimeout(res, deps.leaveMs ?? LEAVE_MS));
  }

  async function find(weekId, { skipEspn = false, auto = false, onPhase = null } = {}) {
    const phaseHook = (ph) => { if (typeof onPhase === 'function') { try { onPhase(ph); } catch { /* a courtesy hook */ } } };
    const week = deps.getWeek(weekId);
    if (!canRun(week)) return null;
    const st = stateFor(weekId);
    if (st.phase !== 'idle') return null;                                   // a second tap while one is running does nothing
    st.cards = []; st.declined = new Set(); st.note = ''; st.noteKind = ''; st.noLine = 0;
    st.phase = skipEspn ? 'other' : 'espn';
    phaseHook(st.phase);
    paint(weekId);
    let out = null;
    try {
      out = await SF.runFindSpreads({
        week, skipEspn,
        deps: { getGames: deps.getGames, fetchEspn: deps.fetchEspn, saveGame: deps.saveGame, lookup: deps.lookup, now: deps.now, onStage: (s) => { st.phase = s; phaseHook(s); paint(weekId); } },
      });
    } catch { out = null; }
    st.phase = 'idle';
    // N-1 (review 2026-10-14): the AUTOMATIC check is quiet about every failure, as it already was about "not set up" - an error line with a Try again button the commissioner did not ask for
    // is noise on a screen they are in the middle of. Only a commissioner-tapped Find says anything went wrong.
    if (!out) { if (!auto) { st.note = SF.SPREAD_COPY.ERROR; st.noteKind = 'error'; } paint(weekId); return null; }
    if (out.stage1.error) { if (!auto) { st.note = SF.SPREAD_COPY.OFFLINE; st.noteKind = 'error'; } paint(weekId); return out; }
    if (out.stage1.ran && out.stage1.added > 0) deps.toast(out.stage1.all ? SF.SPREAD_COPY.ESPN_ALL : SF.espnAddedCopy(out.stage1.added), 'success');
    const o = out.other;
    if (o.status === 'cards') { st.cards = o.cards; if (o.noLine > 0) st.note = SF.noLineCopy(o.noLine); }
    else if (o.status === 'none') st.note = SF.noLineCopy(o.noLine);
    else if (o.status === 'not_configured' || o.status === 'unsupported') st.note = auto ? '' : SF.SPREAD_COPY.NOT_CONFIGURED;
    else if (o.status === 'paused') st.note = SF.SPREAD_COPY.PAUSED;
    // DI-W71.10: the league's daily limit is a calm line (muted, no Try again) after a tapped Find; the AUTOMATIC check says nothing about it.
    else if (o.status === 'daily_limit') st.note = auto ? '' : SF.SPREAD_COPY.DAILY_LIMIT;
    else if (o.status === 'error') { if (!auto) { st.note = SF.SPREAD_COPY.ERROR; st.noteKind = 'error'; } }
    st.noLine = o.noLine || 0;
    if (out.stage1.added > 0) deps.repaintHost(weekId); else paint(weekId);
    return out;
  }

  /** After Build slate or Fetch Games has just read ESPN: ask the other source ONCE, quietly. */
  function autoCheck(weekId) {
    const week = deps.getWeek(weekId);
    if (!canRun(week)) return null;
    const st = stateFor(weekId);
    if (st.autoRan || SF.findMissingSpreads(deps.getGames(weekId)).length === 0) return null;
    st.autoRan = true;
    return find(weekId, { skipEspn: true, auto: true });
  }

  async function include(weekId, gameId) {
    const st = stateFor(weekId);
    if (st.busy.has(gameId)) return false;
    const card = st.cards.find((c) => c.gameId === gameId);
    if (!card) return false;
    st.busy.add(gameId);
    try {
      const current = deps.getGames(weekId).find((g) => g.gameId === gameId);
      const patch = SF.includePatch(current, card);                          // null if the game has gained a spread since (a manual entry in between wins)
      await leave(weekId, gameId);
      st.cards = st.cards.filter((c) => c.gameId !== gameId);
      if (!patch) { deps.toast(SF.SPREAD_COPY.ALREADY, 'info'); paint(weekId); deps.repaintHost(weekId); return false; }      // said once, as a toast: the block itself is gone when nothing is missing
      deps.saveGame({ ...current, ...patch, updatedAt: deps.now() });
      deps.toast(SF.addedCopy(SF.lineText(card), card.provider), 'success');
      deps.haptic('light');
      st.note = ''; st.noteKind = '';
      paint(weekId);
      deps.repaintHost(weekId);
      return true;
    } finally { st.busy.delete(gameId); }
  }

  async function decline(weekId, gameId) {
    const st = stateFor(weekId);
    if (st.busy.has(gameId) || !st.cards.some((c) => c.gameId === gameId)) return false;
    st.busy.add(gameId);
    try {
      await leave(weekId, gameId);
      st.declined.add(gameId);                                               // not remembered past this page session: Find spreads brings it back
      paint(weekId);
      return true;
    } finally { st.busy.delete(gameId); }
  }

  function onClick(e) {
    const btn = e && e.target && typeof e.target.closest === 'function' ? e.target.closest('[data-spread-action]') : null;
    if (!btn || btn.disabled) return;
    const host = btn.closest('[data-spread-host]');
    const weekId = host && host.getAttribute('data-week-id');
    if (!weekId) return;
    const action = btn.getAttribute('data-spread-action');
    const gameId = btn.getAttribute('data-game-id');
    if (action === 'find') { find(weekId); }
    else if (action === 'include' && gameId) { include(weekId, gameId); }
    else if (action === 'decline' && gameId) { decline(weekId, gameId); }
  }

  /** Bind the hosts under `root` (fresh nodes each screen paint; the marker keeps a second call from stacking a second listener). */
  function bind(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    for (const h of root.querySelectorAll('[data-spread-host]')) {
      if (h.hasAttribute('data-spread-bound')) continue;
      h.setAttribute('data-spread-bound', '');
      h.addEventListener('click', onClick);
    }
  }

  return { stateFor, canRun, blockHTML, hostHTML, paint, bind, find, autoCheck, include, decline };
}
