/**
 * js/onboarding-ui.js — the markup of onboarding, About you, the tip card, the Getting started card and the Tips & Help pane (D2 lane 1, UN-507 / UN-507A; DI-732..756, DI-800, DI-1001..1010, DI-1031..1040).
 * ==========================================================================================================================================
 * PURE: strings in, strings out. No DOM, no storage, no network. js/app.js owns the layer, the account store, the school picker and every tap; this module is what is TESTED without a browser
 * (onboardinguitest.mjs) and measured in a real one (onboardingbrowsertest.mjs).
 *
 *   - `tipCardHTML`            one inline `.card` with an info glyph, the tip, and a 44 pt "Got it" (DI-737).
 *   - `gettingStartedHTML`     the Home card: full (rows with ticks DERIVED from facts, a muted waiting state) or collapsed to one 52 pt row (DI-735, 1009).
 *   - `aboutFormHTML`          the Background fields (sports followed, other teams, colleges, work, anything else) and the SCRIBE switches; ONE markup for the onboarding sheet and the Profile pane (DI-750, 1036).
 *   - `sheetHTML`              the sheet chrome of the approved mockup (grab handle, nav bar, body, footer), the same shell the invite and join sheets use.
 *   - `firstPicksHTML`         the first-picks step in its three visible states (DI-800, 1008).
 *   - `tipsPaneHTML`           Control Center > Tips & Help (DI-738).
 * Every user-supplied string (a team, a school, the two free-text answers, a league name) passes the injected `escHtml`. Free text is untrusted text everywhere it goes (DI-1032, 1034).
 * Classes are the shipped vocabulary where one exists (`.card`, `.btn`, `.ls-row` / `.cc-row-switch` for switches, the invite sheet's `.ij-*` chrome); the few new ones live in one CSS block.
 */
import { icon as svgIcon } from './icons.js';
import { ABOUT_COPY, TEXT_RULES, TEXT_COPY, MENTION_SWITCHES_SHOWN, questionById } from './profile-questions.js';
import { GS_COPY, FIRST_PICKS_COPY, rereadList } from './tips.js';

const need = (escHtml, who) => { if (typeof escHtml !== 'function') throw new TypeError(`${who}() requires an injected escHtml function (CONVENTIONS #12)`); return escHtml; };
const icn = (name) => `<span class="ob-ic" aria-hidden="true">${svgIcon(name)}</span>`;
const len = (s) => Array.from(String(s == null ? '' : s)).length;

// ═══ THE TIP CARD (DI-737) ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * `tip` from tips.js. `role="note"`, the glyph decorative, the copy, and ONE "Got it" whose accessible name carries its topic ("Got it, how picks work": DI-743). Focus is never moved to a tip.
 */
export function tipCardHTML(tip, { escHtml } = {}) {
  need(escHtml, 'tipCardHTML');
  if (!tip || typeof tip !== 'object') return '';
  return `<section class="card tip-card" role="note" data-tip-id="${escHtml(tip.id)}" aria-label="Tip: ${escHtml(tip.topic)}">${icn('info')}<p class="tip-copy">${escHtml(tip.copy)}</p>`
    + `<button type="button" class="tip-got" data-onb-action="tip-got" data-tip-id="${escHtml(tip.id)}" data-haptic="light" aria-label="Got it, ${escHtml(String(tip.topic || '').toLowerCase())}">Got it</button></section>`;
}

// ═══ GETTING STARTED (DI-735, DI-1009) ═══════════════════════════════════════════════════════════════════════════════════════════════
/**
 * `model` from gettingStarted(), `state` from gettingStartedState() ('full' | 'collapsed'; anything else paints nothing), `title` the provenance title ("Getting started in {league}"). Each row is a real
 * button (44 pt+) whose name carries its state ("Make your first picks, not done" / "waiting for your commissioner" / "done"); a done row has no action.
 */
export function gettingStartedHTML({ model, state, title = '', leagueId = '' } = {}, { escHtml } = {}) {
  need(escHtml, 'gettingStartedHTML');
  if (!model || !Array.isArray(model.rows) || (state !== 'full' && state !== 'collapsed')) return '';
  const progress = GS_COPY.progress(model.done, model.total);
  const lid = leagueId ? ` data-gs-league="${escHtml(leagueId)}"` : '';
  if (state === 'collapsed') {
    return `<section class="card gs-card gs-card--collapsed" data-gs-state="collapsed"${lid} aria-label="${escHtml(title)}"><button type="button" class="gs-collapsed" data-onb-action="gs-show" aria-label="${escHtml(`${title}, ${progress}. ${GS_COPY.show}`)}">`
      + `<span class="gs-collapsed-t">${escHtml(title)}</span><span class="gs-collapsed-p">${escHtml(progress)}</span><span class="gs-chev" aria-hidden="true">${svgIcon('chevronRight')}</span></button></section>`;
  }
  const rows = model.rows.map((r) => {
    const stateWord = r.done ? 'done' : (r.waiting ? 'waiting for your commissioner' : 'not done');
    const tick = `<span class="gs-tick${r.done ? ' is-on' : ''}" aria-hidden="true">${r.done ? svgIcon('check') : ''}</span>`;
    const right = r.done ? '' : (r.waiting ? `<span class="gs-wait">${escHtml(GS_COPY.waiting)}</span>` : (r.action ? `<span class="gs-go">${escHtml(r.actionLabel || '')}</span>` : ''));
    const sub = r.sub ? `<span class="gs-sub">${escHtml(r.sub)}</span>` : '';
    const inert = r.done || !r.action;
    return `<button type="button" class="gs-row${r.done ? ' is-done' : ''}${r.waiting ? ' is-waiting' : ''}" data-onb-action="${inert ? 'gs-noop' : 'gs-row'}" data-gs-row="${escHtml(r.id)}" data-gs-act="${escHtml(r.action || '')}"${inert ? ' aria-disabled="true"' : ''}`
      + ` aria-label="${escHtml(`${r.label}, ${stateWord}`)}">${tick}<span class="gs-main"><span class="gs-label">${escHtml(r.label)}</span>${sub}</span>${right}</button>`;
  }).join('');
  return `<section class="card gs-card" data-gs-state="full"${lid} aria-label="${escHtml(title)}"><div class="gs-head"><h2 class="gs-title">${escHtml(title)}</h2><span class="gs-prog">${escHtml(progress)}</span>`
    + `<button type="button" class="gs-hide" data-onb-action="gs-hide">${escHtml(GS_COPY.hide)}</button></div>${rows}</section>`;
}

// ═══ THE SHEET CHROME (the approved mockup: a grab handle, a nav bar, a body, a footer) ══════════════════════════════════════════════
/** `left`/`right` are finished button fragments or ''. The title is the nav bar's centred heading (the dialog's label and first focus). */
export function sheetHTML({ title, titleId = 'ob-title', left = '', right = '', bodyHTML = '', footerHTML = '', phase = '' } = {}, { escHtml } = {}) {
  need(escHtml, 'sheetHTML');
  return `<div class="lc-scrim" data-ls-action="cancel"></div>
    <div class="lc-actionsheet ij-sheet ob-sheet" role="dialog" aria-modal="true" aria-labelledby="${escHtml(titleId)}" data-ob-phase="${escHtml(phase)}">`
    + innerHTML({ title, titleId, left, right, bodyHTML, footerHTML }, { escHtml }) + '</div>';
}
/** The sheet's inside (what app.js PATCHES in place when the screen changes, so the sheet never replays its entrance). */
export function innerHTML({ title, titleId = 'ob-title', left = '', right = '', bodyHTML = '', footerHTML = '' } = {}, { escHtml } = {}) {
  need(escHtml, 'innerHTML');
  return `<div class="ij-grab" aria-hidden="true"></div><div class="ij-nav"><span class="ij-nav-l">${left}</span><div class="ij-nav-t" id="${escHtml(titleId)}" tabindex="-1">${escHtml(title)}</div><span class="ij-nav-r">${right}</span></div>`
    + `<div class="ij-body ob-body">${bodyHTML}</div>${footerHTML ? `<div class="ij-footer">${footerHTML}</div>` : ''}`;
}
export const navButtonHTML = (label, action, { right = false, escHtml } = {}) => `<button type="button" class="ij-nav-btn${right ? ' ij-nav-btn--r' : ''}" data-onb-action="${escHtml(action)}">${escHtml(label)}</button>`;
export const textButtonHTML = (label, action, { escHtml } = {}) => `<button type="button" class="btn btn-ghost btn-block ij-text" data-onb-action="${escHtml(action)}">${escHtml(label)}</button>`;

// ═══ ABOUT YOU: the form (DI-746..752, DI-1031..1039) ═════════════════════════════════════════════════════════════════════════════════
const switchRow = (escHtml, { action, on, label, disabled = false, sub = '', extra = '' }) =>
  `<button type="button" class="ls-row ls-row-switch ob-switch" role="switch" aria-checked="${on ? 'true' : 'false'}" data-onb-action="${escHtml(action)}"${extra}${disabled ? ' aria-disabled="true"' : ''}>`
  + `<span class="ls-row-label">${escHtml(label)}${sub ? `<span class="ob-switch-sub">${escHtml(sub)}</span>` : ''}</span><span class="cc-row-switch" data-on="${on ? 'true' : 'false'}" aria-hidden="true"></span></button>`;
const optTag = (escHtml) => `<span class="ob-opt">${escHtml(ABOUT_COPY.optional)}</span>`;
const qHead = (escHtml, label, extra = '') => `<div class="ob-q-h"><h3 class="ob-q-t">${escHtml(label)}</h3>${optTag(escHtml)}${extra}</div>`;
// D2 M-93 (DI-1103): ONE copy. Every purpose line is the catalog's (`questionById(id).purpose`); nothing below types one. The first letter is lowered after "Why we ask:" except for Home and SCRIBE, which are names.
const whyLine = (text) => `Why we ask: ${String(text).replace(/\.$/, '').replace(/^(?!Home\b|SCRIBE\b)([A-Z])/, (m) => m.toLowerCase())}.`;
const why = (escHtml, text) => `<p class="ob-why">${escHtml(whyLine(text))}</p>`;
const purposeOf = (qid) => { const q = questionById(qid); return q ? q.purpose : ''; };
const removeBtn = (escHtml, qid, show) => (show ? `<button type="button" class="ob-remove" data-onb-action="answer-remove" data-qid="${escHtml(qid)}">${escHtml(ABOUT_COPY.remove)}</button>` : '');

/** The counter and the refusal under a free-text field (patched in place as the person types). */
export function textMetaHTML({ id, value = '', cap, error = '' }, { escHtml } = {}) {
  need(escHtml, 'textMetaHTML');
  return `<span class="ob-count" id="ob-count-${escHtml(id)}" aria-hidden="true">${escHtml(TEXT_COPY.remainingLabel(len(value), cap))}</span>`
    + `<span class="ob-err" id="ob-err-${escHtml(id)}" role="alert" aria-live="assertive"${error ? '' : ' hidden'}>${error ? escHtml(error) : ''}</span>`;
}

/**
 * The Background form. `m`:
 *   sports      [{ key, label, on }]                                   the sports a person can follow (the league's sports plus the offered ones), `on` = followed
 *   other       [{ key, label, teams: [names], max }]                  per sport with a team list: the favourite teams (up to `max`)
 *   schools     [names]                                                colleges attended (up to 4)
 *   career, more                the two free-text values (as typed)
 *   errors      { career, more }                                       the refusal sentence under each field, '' when none
 *   master, share               the consent state: `master` boolean, `share` { career_text, anything_else_text, ... } booleans
 *   enabled     the set of enabled question ids (which sections render)
 *   answeredOff [{ id, label, summary }]                               answered questions that are no longer asked (DI-1001): shown with Remove only (pane)
 *   mode        'sheet' | 'pane'                                       the pane adds a per-answer Remove and Remove everything
 *   has         { sports_followed, other_teams, schools_attended, career_text, anything_else_text }   booleans: an answer exists (pane Remove)
 * Nothing here decides what is allowed: the form shows the catalog's caps and words; normalization and refusal are the catalog's (profile-questions.js) and the server twin's.
 */
export function aboutFormHTML(m = {}, { escHtml, mentionSwitches = MENTION_SWITCHES_SHOWN } = {}) {
  need(escHtml, 'aboutFormHTML');
  const on = (id) => !m.enabled || m.enabled.includes(id);
  const pane = m.mode === 'pane';
  const has = m.has || {};
  const parts = [];
  if (on('sports_followed') && Array.isArray(m.sports) && m.sports.length) {
    parts.push(`<section class="ob-q" data-ob-q="sports_followed">${qHead(escHtml, 'Sports you follow', removeBtn(escHtml, 'sports_followed', pane && has.sports_followed))}`
      + `<div class="ob-chips" id="ob-chips-sports" role="group" aria-label="Sports you follow">${m.sports.map((s) => `<button type="button" class="ob-chip${s.on ? ' is-on' : ''}" aria-pressed="${s.on ? 'true' : 'false'}" data-onb-action="chip-sport" data-sport="${escHtml(s.key)}">${s.on ? icn('check') : ''}<span>${escHtml(s.label)}</span></button>`).join('')}</div>`
      + `${why(escHtml, purposeOf('sports_followed'))}</section>`);
  }
  if (on('other_teams') && Array.isArray(m.other) && m.other.length) {
    parts.push(`<section class="ob-q" data-ob-q="other_teams">${qHead(escHtml, 'Other teams you follow', removeBtn(escHtml, 'other_teams', pane && has.other_teams))}<div id="ob-other-teams">`
      + m.other.map((o) => `<div class="ob-team-row" data-sport="${escHtml(o.key)}"><span class="ob-team-sport">${escHtml(o.label)}</span><div class="ob-chips">`
        + (o.teams || []).map((t) => `<span class="ob-chip is-on ob-chip--team"><span>${escHtml(t)}</span><button type="button" class="ob-chip-x" data-onb-action="team-remove" data-sport="${escHtml(o.key)}" data-team="${escHtml(t)}" aria-label="Remove ${escHtml(t)}">${svgIcon('close')}</button></span>`).join('')
        + ((o.teams || []).length < (o.max || 3) ? `<button type="button" class="ob-chip ob-chip--add" data-onb-action="team-add" data-sport="${escHtml(o.key)}">${icn('plus')}<span>${escHtml(ABOUT_COPY.addTeam)}</span></button>` : '')
        + '</div></div>').join('') + `</div>${why(escHtml, purposeOf('other_teams'))}</section>`);
  }
  if (on('schools_attended')) {
    const list = Array.isArray(m.schools) ? m.schools : [];
    parts.push(`<section class="ob-q" data-ob-q="schools_attended">${qHead(escHtml, 'Colleges you attended', removeBtn(escHtml, 'schools_attended', pane && has.schools_attended))}<div class="ob-chips" id="ob-colleges">`
      + list.map((t) => `<span class="ob-chip is-on ob-chip--team"><span>${escHtml(t)}</span><button type="button" class="ob-chip-x" data-onb-action="college-remove" data-team="${escHtml(t)}" aria-label="Remove ${escHtml(t)}">${svgIcon('close')}</button></span>`).join('')
      + (list.length < 4 ? `<button type="button" class="ob-chip ob-chip--add" data-onb-action="college-add">${icn('plus')}<span>${escHtml(ABOUT_COPY.addCollege)}</span></button>` : '')
      + `</div>${why(escHtml, purposeOf('schools_attended'))}</section>`);
  }
  const text = (id, qid, label, tag, rows) => {
    const cap = TEXT_RULES[qid].cap, v = String(m[id] || ''), err = (m.errors && m.errors[id]) || '';
    const purposeId = `ob-desc-${id}`;
    const field = rows > 1
      ? `<textarea class="form-input ob-text" id="ob-${id}" data-ob-field="${qid}" rows="${rows}" aria-describedby="${purposeId} ob-err-${id}" aria-label="${escHtml(label)}, ${escHtml(TEXT_COPY.maxLabel(cap))}" autocapitalize="sentences">${escHtml(v)}</textarea>`
      : `<input type="text" class="form-input ob-text" id="ob-${id}" data-ob-field="${qid}" value="${escHtml(v)}" enterkeyhint="next" aria-describedby="${purposeId} ob-err-${id}" aria-label="${escHtml(label)}, ${escHtml(TEXT_COPY.maxLabel(cap))}" autocapitalize="sentences" />`;
    return `<section class="ob-q" data-ob-q="${qid}">${qHead(escHtml, label, removeBtn(escHtml, qid, pane && has[qid]))}${field}<div class="ob-meta">${textMetaHTML({ id, value: v, cap, error: err }, { escHtml })}</div>`
      + `<p class="ob-why" id="${purposeId}">${escHtml(tag)}</p></section>`;
  };
  if (on('career_text')) parts.push(text('career', 'career_text', 'Your work', whyLine(purposeOf('career_text')), 1));
  if (on('anything_else_text')) parts.push(text('more', 'anything_else_text', 'Anything else', whyLine(purposeOf('anything_else_text')), 3));
  if (pane && Array.isArray(m.answeredOff) && m.answeredOff.length) {
    parts.push(`<section class="ob-q" data-ob-q="answered-off">${qHead(escHtml, 'Earlier answers')}`
      + m.answeredOff.map((a) => `<div class="ob-earlier"><span class="ob-earlier-l">${escHtml(a.label)}</span><span class="ob-earlier-v">${escHtml(a.summary || '')}</span>${removeBtn(escHtml, a.id, true)}</div>`).join('') + '</section>');
  }
  // the consent (DI-1033): the master, then the per-answer switches (disabled while the master is off, with the reason)
  const master = m.master === true, share = m.share || {};
  const mention = (qid, id, what) => (mentionSwitches === true && on(qid) ? switchRow(escHtml, { action: 'share-toggle', on: master && share[qid] === true, label: ABOUT_COPY.mentionLabel(what), disabled: !master, sub: master ? '' : ABOUT_COPY.mentionNeedsMaster, extra: ` data-qid="${escHtml(qid)}"` }) : '');
  parts.push(`<section class="ob-q ob-consent" data-ob-q="consent" id="ob-consent"><h3 class="ob-q-t">SCRIBE and you</h3>`
    + `<div class="ob-switches">${switchRow(escHtml, { action: 'master-toggle', on: master, label: ABOUT_COPY.masterLabel })}${mention('career_text', 'career', ABOUT_COPY.mentionWhat.career_text)}${mention('anything_else_text', 'more', ABOUT_COPY.mentionWhat.anything_else_text)}</div>`
    + `<p class="ob-why">${escHtml(ABOUT_COPY.masterHelp)}</p></section>`);
  return parts.join('');
}

/** The Teams screen's body: the intro, then one block per sport with a team list (`teams: [{ key, label, html }]`, html finished by app.js: the college football control or a school field). */
export function teamsBodyHTML({ teams = [], leagueName = '' } = {}, { escHtml } = {}) {
  need(escHtml, 'teamsBodyHTML');
  return `<p class="ob-intro"><strong>${escHtml(ABOUT_COPY.optional)}.</strong> ${escHtml(ABOUT_COPY.intro)}</p>`
    + teams.map((t) => `<section class="ob-q ob-sport" data-ob-sport="${escHtml(t.key)}"><h3 class="ob-q-t">${escHtml(t.label)}</h3>${t.html || ''}</section>`).join('')
    + `<p class="ob-why">${escHtml(ABOUT_COPY.schoolsHint)}</p>`;
}

// ═══ FIRST PICKS (DI-800, DI-1008) ═════════════════════════════════════════════════════════════════════════════════════════════════
/** `fp` from firstPicks(); `remindOn` the reminder switch's state. Returns `{ bodyHTML, footerHTML }` for the sheet. The primary is never disabled (DI-800). */
export function firstPicksHTML(fp, { escHtml, remindOn = false } = {}) {
  need(escHtml, 'firstPicksHTML');
  const C = FIRST_PICKS_COPY;
  const hero = (title, sub = '') => `<div class="ij-hero"><div class="ij-seal ij-seal--gold" aria-hidden="true">${svgIcon('calendarWeek')}</div><h2 class="ij-hero-t" id="ob-fp-title" tabindex="-1">${escHtml(title)}</h2>${sub ? `<p class="ij-hero-s">${escHtml(sub)}</p>` : ''}</div>`;
  if (!fp || fp.state === 'hidden') return { bodyHTML: '', footerHTML: '' };
  if (fp.state === 'open') {
    return { bodyHTML: hero(C.open(fp.week, fp.league), C.openSub(fp.sport, fp.locksText)),
      footerHTML: `<button type="button" class="btn btn-primary btn-block" data-onb-action="fp-make">${escHtml(C.makePicks)}</button>${textButtonHTML(C.notNow, 'fp-done', { escHtml })}` };
  }
  if (fp.state === 'locked') {
    return { bodyHTML: hero(C.locked(fp.week)), footerHTML: `<button type="button" class="btn btn-primary btn-block" data-onb-action="fp-done">${escHtml(C.done)}</button>` };
  }
  return { bodyHTML: `${hero(C.noWeek)}<div class="ob-switches">${switchRow(escHtml, { action: 'remind-toggle', on: remindOn === true, label: C.remind })}</div>`,
    footerHTML: `<button type="button" class="btn btn-primary btn-block" data-onb-action="fp-done">${escHtml(C.done)}</button>` };
}

// ═══ TIPS & HELP (DI-738) ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
/**
 * Control Center > Tips & Help (frame 11): the Show tips master, "Read a tip again" (each opens as a sheet), Show Getting started again, Reset all tips. `role` filters the commissioner tip;
 * `off` = tips are switched off.
 */
export function tipsPaneHTML({ role = 'player', seen = {}, off = false } = {}, { escHtml } = {}) {
  const backIcon = svgIcon('chevronLeft');   // the module's own glyph (the host `.cc-row-icon svg` sizes it)
  need(escHtml, 'tipsPaneHTML');
  const list = rereadList({ role, seen });
  return `<div class="control-center-profile cc-tips"><button type="button" class="control-center-back" data-action="cc-pop-tips"><span class="cc-row-icon" aria-hidden="true">${backIcon}</span> Control Center</button>`
    + `<div class="admin-section-title">Tips &amp; Help</div>`
    + `<div class="ob-switches">${switchRow(escHtml, { action: 'tips-toggle', on: off !== true, label: 'Show tips' })}</div>`
    + `<p class="ob-why">Off hides every tip card and the Getting started card. The checklist stays reachable below.</p>`
    + `<div class="form-label cc-tips-heading">Read a tip again</div><div class="card ls-card">`
    + list.map((t) => `<button type="button" class="ls-row cc-tips-row" data-onb-action="tip-reread" data-tip-id="${escHtml(t.id)}"><span class="ls-row-label">${escHtml(t.topic)}</span><span class="cc-row-chevron" aria-hidden="true">${svgIcon('chevronRight')}</span></button>`).join('')
    + `</div><div class="card ls-card"><button type="button" class="ls-row" data-onb-action="gs-again"><span class="ls-row-label">Show Getting started again</span></button>`
    + `<button type="button" class="ls-row" data-onb-action="tips-reset"><span class="ls-row-label">Reset all tips</span></button></div></div>`;
}
/** A tip opened to be read again, as a sheet (the same sheet chrome): the copy and one Done. */
export function tipSheetHTML(tip, { escHtml } = {}) {
  need(escHtml, 'tipSheetHTML');
  if (!tip) return '';
  return sheetHTML({ title: tip.topic, phase: 'tip', right: navButtonHTML('Done', 'sheet-close', { right: true, escHtml }), bodyHTML: `<p class="ob-tip-read" id="ob-tip-read">${escHtml(tip.copy)}</p>` }, { escHtml });
}

