/**
 * CFB Pickems — pick-groups.js (Deployment 1, Lane B, DI-612 / UN-PF-457 "Show picks", security C2, C3, C4, C5, C7, S1, S2, 2026-10-08)
 * ====================================================================================================================================
 * THE ONE RENDERER of "who picked what" for a single game, in two presentations of the same facts:
 *
 *   BY PERSON  every entrant's initials beside their pick (and its cover mark) — what the Dashboard has always shown;
 *   BY TEAM    the entrants' initials grouped UNDER the team they picked, the cover mark once on the team's label (Drew, D-63: "adds the initials to each team rather than each initial being
 *              associated with a team/logo in the dashboard").
 *
 * and three FORMS of each, which differ only in typography (one data path):   'dash'  the Dashboard compact row (boxed initials, non-interactive)
 *                                                                              'card'  Game Day's open-card row (plain text, the viewer's underlined)
 *                                                                              'panel' the Game view's League picks panel (boxed initials, and the only form that prints the split caption)
 *
 *   picksRowHTML({ game, week, entrants, viewerId, view, form, escHtml, numHtml })    -> markup (a string; '' = nothing to draw)
 *
 * GATE FIRST — AND STRUCTURALLY. NO CALLER PASSES PICKS IN, AND THIS MODULE IMPORTS NO RAW PICK READER (security S1). It asks `pickVisibilityFor` (js/pick-chips.js, the chip-helper module) ONCE per
 * game, for THAT game's own week (C2), and renders ONLY what that returns — exactly one of
 *   { state:'public', picks }                      grouped (By team) or listed (By person)
 *   { state:'hidden', own, submitted }             the BLIND form, whatever `view` says: the viewer's own pick and a "•••" for each entrant who submitted. The structure holds NO other
 *                                                  member's side, so a faulty renderer here could not print one, a cluster or a per-side count even if it tried.
 *   { state:'none' }                               '' — the viewer is not in that sport (C7), or has not submitted: the caller says why in its own words.
 * The grouping decision is made AFTER the gate and cannot run before it, because the data to group does not exist before it.
 *
 * ENTRANTS ONLY (C4 / A3): the members that appear in a cluster, in "No pick", in the blind form's "•••" set and in any figure come from `entrants` — the caller's
 * `playersForCompetition(the game's competition, { weekId })` — never the active roster.
 *
 * NO PER-SIDE FIGURE BEFORE THE GATE (S2): the "{a} on TEX · {b} on OU" caption exists only in the 'panel' form's PUBLIC branch. In every other state no caption, no per-side number and no
 * cluster is produced, in any of the three forms.
 *
 * ESCAPING (C5): the escaper and `numHtml` are REQUIRED parameters — a missing one THROWS (no `typeof escHtml` fallback). Every attribute is double-quoted; initials, team names, display names
 * and the sport word are escaped in text, `aria-label` and `title`; numbers cross through `numHtml`.
 *
 * `configurePickGroups({ orderPlayers, initialsOf, shortLabelFor, logoOk, logoSrcAttr, teamSchool, logoViewOn })` is called once by js/app.js with the app's own helpers; each is optional and
 * defaults to something safe (no logos, the member's own initials, the viewer first). Pure otherwise: no storage, no DOM, no clock.
 */
import { pickVisibilityFor, gamePickChipsHTML, livePickStatus } from './pick-chips.js';
import { evaluatePick } from './scoring.js';
import { buildAbbrMap, PICK_RESULT } from './data-model.js';

export const PICK_FORMS = Object.freeze(['dash', 'card', 'panel']);
export const PICK_VIEWS = Object.freeze(['person', 'team']);
export const BLIND_CAPTION = 'Picks stay hidden until kickoff.';

let env = {};
export function configurePickGroups(e = {}) {
  const d = (e && typeof e === 'object') ? e : {};
  env = {
    orderPlayers: typeof d.orderPlayers === 'function' ? d.orderPlayers : null,
    initialsOf: typeof d.initialsOf === 'function' ? d.initialsOf : null,
    shortLabelFor: typeof d.shortLabelFor === 'function' ? d.shortLabelFor : null,     // (game) -> (teamName) -> abbreviation: the WEEK's unique map
    logoOk: typeof d.logoOk === 'function' ? d.logoOk : null,
    logoSrcAttr: typeof d.logoSrcAttr === 'function' ? d.logoSrcAttr : null,
    teamSchool: typeof d.teamSchool === 'function' ? d.teamSchool : null,
    logoViewOn: typeof d.logoViewOn === 'function' ? d.logoViewOn : null,
  };
}
export function _resetPickGroupsForTest() { env = {}; }

const requireFn = (f, name) => { if (typeof f !== 'function') throw new TypeError(`picksRowHTML() requires an injected ${name} function (CONVENTIONS #12, security C5): there is no fallback`); return f; };
const isId = (v) => typeof v === 'string' && v !== '';

const initialsOfDefault = (p) => (p && p.initials) || (p && p.displayName && String(p.displayName).charAt(0).toUpperCase()) || '?';
const orderDefault = (players, viewerId) => {
  const list = players.slice();
  const i = list.findIndex(p => p.playerId === viewerId);
  if (i > 0) list.unshift(list.splice(i, 1)[0]);
  return list;
};

/** The cover mark on a side's label: live ▲ covering / ▽ trailing (never red), final ✓ covered / ✗ did not cover; a pending game and an even live game carry no mark. */
function markFor(game, team) {
  const pick = { selectedTeam: team };
  const result = evaluatePick(pick, game);
  if (result === PICK_RESULT.LIVE) {
    const ls = livePickStatus(pick, game);
    if (ls === 'covering') return { cls: 'cov', glyph: ' ▲', word: 'covering' };
    if (ls === 'trailing') return { cls: 'trl', glyph: ' ▽', word: 'trailing' };
    return { cls: '', glyph: '', word: 'on the number' };
  }
  if (result === PICK_RESULT.WIN) return { cls: 'win', glyph: ' ✓', word: 'covered' };
  if (result === PICK_RESULT.LOSS) return { cls: 'los', glyph: ' ✗', word: 'did not cover' };
  if (result === PICK_RESULT.NO_DECISION) return { cls: 'nd', glyph: ' —', word: 'push' };
  return { cls: '', glyph: '', word: '' };
}

/** One member's chip text in the plain forms. */
const sr = (word, esc) => (word ? `<span class="sr-only"> ${esc(word)}</span>` : '');

/**
 * @returns {string} markup for the picks of ONE game, or '' when the gate says there is nothing to show this viewer.
 */
export function picksRowHTML({ game, week, entrants, viewerId, view, form, escHtml, numHtml } = {}) {
  requireFn(escHtml, 'escHtml');
  requireFn(numHtml, 'numHtml');
  const f = PICK_FORMS.includes(form) ? form : 'dash';
  const v = PICK_VIEWS.includes(view) ? view : 'person';
  if (!game || !week) return '';
  const vis = pickVisibilityFor({ game, week, viewerId, entrants });        // THE gate — once, for this game's own week
  if (vis.state === 'none') return '';
  const roster = (Array.isArray(entrants) ? entrants : []).filter(p => p && isId(p.playerId));
  const byId = new Map(roster.map(p => [p.playerId, p]));
  const initialsOf = env.initialsOf || initialsOfDefault;
  const order = env.orderPlayers || orderDefault;
  const abbr = (() => {
    if (env.shortLabelFor) { try { const fn = env.shortLabelFor(game); if (typeof fn === 'function') return fn; } catch { /* fall through */ } }
    const m = buildAbbrMap([game]);
    return (name) => m.get(name) || String(name || '').slice(0, 4).toUpperCase();
  })();
  const team = (side) => (side === 'away' ? game.awayTeam : side === 'home' ? game.homeTeam : null);

  // ── the BLIND form: the same markup whatever `view` is ──────────────────────────────────────────────────────────────────────────
  if (vis.state === 'hidden') {
    const present = order(roster.filter(p => p.playerId === viewerId || vis.submitted.includes(p.playerId)), viewerId);
    if (f === 'card') {
      const items = present.map(p => {
        const ini = escHtml(initialsOf(p));
        if (p.playerId === viewerId) {
          const t = team(vis.own.side);
          return `<span class="pg-pp pg-pp--me"><b class="pg-who">${ini}</b> ${t ? escHtml(abbr(t)) : '—'}</span>`;
        }
        return `<span class="pg-pp pg-pp--blind" aria-label="${escHtml(p.displayName)} picked, hidden until kickoff"><b class="pg-who">${ini}</b> •••</span>`;
      }).join('');
      return `<span class="pg-row pg-row--card pg-row--blind" data-picks-view="blind"><span class="pg-cap">${escHtml(BLIND_CAPTION)}</span>${items}</span>`;
    }
    const chips = gamePickChipsHTML({
      game, players: present,
      lookup: (pid) => (pid === viewerId ? (team(vis.own.side) ? { selectedTeam: team(vis.own.side) } : null) : (vis.submitted.includes(pid) ? { hidden: true } : null)),
      viewerId, canSeeOthers: false, shortLabel: abbr, logoViewOn: env.logoViewOn ? !!env.logoViewOn() : false, draggable: f === 'dash',
      escHtml, initialsOf, logoOk: env.logoOk || (() => null), logoSrcAttr: env.logoSrcAttr || ((u) => `src="${escHtml(u)}"`), teamSchool: env.teamSchool || ((g, side) => (side === 'home' ? g.homeTeam : g.awayTeam) || ''),
    });
    if (f === 'dash') return chips;
    const inCount = vis.submitted.length + (vis.own ? 1 : 0);
    return `<div class="pg-row pg-row--panel pg-row--blind" data-picks-view="blind"><div class="dc-chips">${chips}</div><p class="pg-cap">${escHtml(BLIND_CAPTION)} ${numHtml(inCount)} of ${numHtml(roster.length)} are in.</p></div>`;
  }

  // ── PUBLIC: only here does anything group or list ───────────────────────────────────────────────────────────────────────────────
  const sideById = new Map(vis.picks.map(p => [p.playerId, p.side]));
  const ordered = order(roster, viewerId);

  if (v === 'person') {
    if (f === 'card') {
      const items = ordered.map(p => {
        const side = sideById.get(p.playerId) || 'none';
        const t = team(side);
        const m = t ? markFor(game, t) : { cls: '', glyph: '', word: '' };
        const me = p.playerId === viewerId;
        return `<span class="pg-pp${me ? ' pg-pp--me' : ''}${m.cls ? ` pg-pp--${m.cls}` : ''}"><b class="pg-who">${escHtml(initialsOf(p))}</b> ${t ? escHtml(abbr(t)) : '—'}${m.glyph}${sr(m.word, escHtml)}</span>`;
      }).join('');
      return `<span class="pg-row pg-row--card" data-picks-view="person">${items}</span>`;
    }
    const chips = gamePickChipsHTML({
      game, players: ordered,
      lookup: (pid) => { const s = sideById.get(pid); return team(s) ? { selectedTeam: team(s) } : null; },
      viewerId, canSeeOthers: true, shortLabel: abbr, logoViewOn: env.logoViewOn ? !!env.logoViewOn() : false, draggable: f === 'dash',
      escHtml, initialsOf, logoOk: env.logoOk || (() => null), logoSrcAttr: env.logoSrcAttr || ((u) => `src="${escHtml(u)}"`), teamSchool: env.teamSchool || ((g, side) => (side === 'home' ? g.homeTeam : g.awayTeam) || ''),
    });
    if (f === 'dash') return chips;
    return `<div class="pg-row pg-row--panel" data-picks-view="person"><div class="dc-chips">${chips}</div></div>${splitCaption(game, vis, byId, abbr, escHtml, numHtml, f)}`;
  }

  // BY TEAM — one cluster per side picked, away then home, then a muted "No pick" cluster; the cover mark lives on the side's label because every member on a side shares its result.
  const cluster = (side) => {
    const t = team(side);
    const members = ordered.filter(p => (sideById.get(p.playerId) || 'none') === side);
    if (!t || !members.length) return '';
    const m = markFor(game, t);
    const names = members.map(p => escHtml(p.displayName)).join(', ');
    const label = `${escHtml(t)}${m.word ? `, ${escHtml(m.word)}` : ''}: ${names}`;
    return `<span class="pg-cluster${m.cls ? ` pg-cluster--${m.cls}` : ''}" role="group" aria-label="${label}"><b class="pg-label" aria-hidden="true">${escHtml(abbr(t))}${m.glyph}</b>${members.map(p => `<span class="pg-ini${p.playerId === viewerId ? ' pg-ini--me' : ''}" aria-hidden="true">${escHtml(initialsOf(p))}</span>`).join('')}</span>`;
  };
  const nobody = ordered.filter(p => (sideById.get(p.playerId) || 'none') === 'none');
  const none = nobody.length
    ? `<span class="pg-cluster pg-cluster--none" role="group" aria-label="No pick: ${nobody.map(p => escHtml(p.displayName)).join(', ')}"><b class="pg-label" aria-hidden="true">No pick</b>${nobody.map(p => `<span class="pg-ini${p.playerId === viewerId ? ' pg-ini--me' : ''}" aria-hidden="true">${escHtml(initialsOf(p))}</span>`).join('')}</span>`
    : '';
  const body = `${cluster('away')}${cluster('home')}${none}`;
  const root = f === 'card' ? 'span' : 'div';   // the open card's row is a <button>: its content stays phrasing
  return `<${root} class="pg-row pg-row--${f}" data-picks-view="team">${body}</${root}>${f === 'panel' ? splitCaption(game, vis, byId, abbr, escHtml, numHtml, f) : ''}`;
}

/** S2: the Game view's "{a} on TEX · {b} on OU" — built ONLY from the gate's `public` return, in the 'panel' form, here and nowhere else. */
function splitCaption(game, vis, byId, abbr, escHtml, numHtml, form) {
  if (form !== 'panel' || vis.state !== 'public') return '';
  let a = 0, h = 0;
  for (const p of vis.picks) { if (!byId.has(p.playerId)) continue; if (p.side === 'away') a++; else if (p.side === 'home') h++; }
  return `<p class="pg-cap pg-split">${numHtml(a)} on ${escHtml(abbr(game.awayTeam))} · ${numHtml(h)} on ${escHtml(abbr(game.homeTeam))}</p>`;
}
