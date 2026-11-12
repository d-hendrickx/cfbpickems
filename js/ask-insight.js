/**
 * CFB Pickems - js/ask-insight.js (D2 lane 4 batch 2; DI-970 to 973, RPF-D4; W-129; mockup frame 3; 2026-10-21)
 * ================================================================================================================
 * "Ask SCRIBE" from an insight card: the PURE half. No DOM, no storage, no network, no clock (`now` is a parameter). The sheet (app.js) owns the DOM, the haptics and the one network call (`askModel`),
 * which is a callback; this file decides WHAT can be asked, answers the instant chips from the league record, builds the request that carries the card's packet, counts the caps, and draws the body.
 *
 *   INSTANT answers (free, offline, labelled "From the league record"): which games, who did I pick, which weeks, last year. They are built from the card's own supporting rows. No model is called.
 *   OPEN questions ("Why is this unusual?" and anything typed) go to the server's insight route on `scribe-ask` (batch 3, DI-971): the request NAMES the insight and carries the
 *   question, never a number. The server recomputes the card's packet from the league record, answers from it alone and returns the answer to the asker only. Six per insight and
 *   thirty a day (RPF-D4), counted here as a courtesy and enforced on the server. The path is on unless the platform setting `scribe_insight_ask_enabled` is exactly false
 *   (the admin's switch; `askOpenOn`). A failure is never an error with detail: "SCRIBE couldn't answer that one", then the games behind the insight (an instant answer).
 */
/** The platform setting that turns the open questions off (absent = on for this release; only the literal false is off). The server reads the same key. */
export const ASK_OPEN_KV_KEY = 'scribe_insight_ask_enabled';
export function askOpenOn(value) { return value !== false; }
export const ASK_LIMITS = Object.freeze({ perInsight: 6, perDay: 30, questionMax: 300, counterFrom: 250, turnsMax: 4 });
export const ASK_COPY = Object.freeze({
  title: 'Ask SCRIBE', placeholder: 'Ask about this...', fromRecord: 'From the league record', fromScribe: "SCRIBE's read", based: 'Based on the numbers above.',
  failed: "SCRIBE couldn't answer that one. Here are the games behind this.", offline: "You're offline. Open questions need a connection.", changed: 'These numbers were updated.', refresh: 'Refresh',
  capped: "That's six questions on this one. Send it to the Locker Room and let the humans take it from here.", dayCapped: "You've asked 30 questions today. The numbers are still here; try again tomorrow.",
  budget: 'SCRIBE is out of questions for this month. The numbers are still here.',
  send: 'Send this insight to the Locker Room', onlyYou: 'Only you see this chat. You can send the insight itself to the room.', unavailable: "This insight isn't available to you right now.",
  firstFive: 'First five shown', noPrior: "Last season's picks aren't in this league's record yet.", thinking: 'SCRIBE is reading the numbers', openWhatIf: 'Open What if',
});
export const CHIP_DEFS = Object.freeze([
  { id: 'games', label: 'Which games were those?', short: 'Which games?' },
  { id: 'picks', label: 'Who did I pick?', short: 'Who did I pick?' },
  { id: 'weeks', label: 'Show me the weeks', short: 'Which weeks?' },
  { id: 'last-year', label: 'Was this true last year?', short: 'Last year?' },
  { id: 'why', label: 'Why is this unusual?', short: 'Why unusual?', model: true },
]);
const CHIP_BY_ID = Object.freeze(Object.fromEntries(CHIP_DEFS.map((c) => [c.id, c])));

const plural = (n, one, many) => (n === 1 ? one : many);
const NUM_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const numWord = (n) => (n >= 0 && n <= 10 ? NUM_WORD[n] : String(n));

/**
 * The chips available for a candidate. ctx: { rows (the games behind it), hasPrior (last season's record exists), modelEnabled, offline }.
 * An insight with no supporting games (a team's figures) offers no games / picks / weeks chip: nothing is invented.
 */
export function chipsFor(c, ctx = {}) {
  if (!c) return [];
  const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
  const out = [];
  if (rows.length) out.push(CHIP_BY_ID.games);
  if (rows.some((r) => r.mark)) out.push(CHIP_BY_ID.picks);
  if (rows.length) out.push(CHIP_BY_ID.weeks);
  if (c.kind !== 'insight.team' && c.kind !== 'insight.history') out.push(CHIP_BY_ID['last-year']);
  if (ctx.modelEnabled === true) out.push(CHIP_BY_ID.why);      // DI-1108 (M-93): a team card is answered too, from that team's one public row
  return out;
}

/** The instant answer for a chip: { text, source } built only from the supporting rows the card already shows. Null when the chip does not apply. */
export function instantAnswer(chipId, c, ctx = {}) {
  const rows = Array.isArray(ctx.rows) ? ctx.rows : [];
  const src = ASK_COPY.fromRecord;
  switch (chipId) {
    case 'games': {
      if (!rows.length) return null;
      const shown = rows.slice(0, 5).map((r) => r.primary);
      return { text: `${numWord(rows.length)} ${plural(rows.length, 'game', 'games')}: ${shown.join('; ')}.${rows.length > 5 ? ' ' + ASK_COPY.firstFive + '.' : ''}`, source: src };
    }
    case 'picks': {
      const marked = rows.filter((r) => r.mark);
      if (!marked.length) return null;
      const w = marked.filter((r) => r.tone === 'win').length, l = marked.filter((r) => r.tone === 'loss').length, who = ctx.subjectIsViewer === false && ctx.subjectName ? ctx.subjectName : 'You';
      return { text: `${who} went ${w}-${l} on ${marked.length === rows.length ? 'these picks' : 'the ' + marked.length + ' final picks here'}.`, source: src };
    }
    case 'weeks': {
      if (!rows.length) return null;
      const labels = [];
      for (const r of rows) { const l = r.weekLabel || ''; if (l && !labels.includes(l)) labels.push(l); }
      if (!labels.length) return null;
      return { text: `${labels.slice(0, 8).join(', ')}.`, source: src };
    }
    case 'last-year':
      return { text: typeof ctx.priorLine === 'string' && ctx.priorLine ? ctx.priorLine : ASK_COPY.noPrior, source: src };
    default: return null;
  }
}

/** The caps. `state` = { dayKey, dayCount, byInsight: { [id]: count } } (the caller keeps it; this returns a new one). */
export function emptyAskState() { return { dayKey: '', dayCount: 0, byInsight: {} }; }
export function canAskModel(state, insightId, dayKey) {
  const s = state || emptyAskState();
  const day = s.dayKey === dayKey ? s.dayCount : 0;
  if (day >= ASK_LIMITS.perDay) return { ok: false, reason: 'day' };
  if ((s.byInsight[insightId] || 0) >= ASK_LIMITS.perInsight) return { ok: false, reason: 'insight' };
  return { ok: true, reason: null, left: ASK_LIMITS.perInsight - (s.byInsight[insightId] || 0) };
}
export function noteModelAsk(state, insightId, dayKey) {
  const s = state || emptyAskState();
  const day = s.dayKey === dayKey ? s.dayCount : 0;
  return { dayKey, dayCount: day + 1, byInsight: { ...s.byInsight, [insightId]: (s.byInsight[insightId] || 0) + 1 } };
}

/**
 * The request an open question sends (DI-971's closed shape): the insight it NAMES, the question, the earlier open turns (conversation, never facts) and the hash of the packet
 * the sheet shows (the server compares it and says `refreshed` when the numbers moved). No number, no pick, no packet: the server recomputes the facts from the league record.
 * `question` is `{ chip: 'why' }` or a typed string. Null when the text is empty or too long, or the hash is missing.
 */
export function buildAskRequest({ insightId, question, packetSha, leagueId, turns = [], requestId = '' }) {
  const gdId = typeof insightId === 'string' && /^gdf1:[A-Za-z0-9_.-]{1,80}::[A-Za-z0-9_.:|-]{1,110}$/.test(insightId);   // DI-1109: a Game Day fact's own id
  if (typeof insightId !== 'string' || !(/^ins1:/.test(insightId) || gdId) || typeof leagueId !== 'string' || !leagueId || typeof packetSha !== 'string' || !/^[0-9a-f]{64}$/.test(packetSha)) return null;
  let q;
  if (question && typeof question === 'object' && question.chip === 'take' && gdId) return null;   // a Game Day fact has no SCRIBE's read
  if (question && typeof question === 'object' && (question.chip === 'why' || question.chip === 'take')) q = { kind: 'chip', id: question.chip };   // 'take' = SCRIBE's read on the detail (DI-1107)
  else {
    const t = String(question == null ? '' : question).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t || t.length > ASK_LIMITS.questionMax) return null;
    q = { kind: 'text', text: t };
  }
  const clean = (x, max) => String(x == null ? '' : x).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  const prior = (Array.isArray(turns) ? turns : []).filter((t) => t && typeof t.q === 'string' && t.q.trim()).slice(-ASK_LIMITS.turnsMax).map((t) => ({ q: clean(t.q, ASK_LIMITS.questionMax), a: clean(t.a, 600) }));
  const req = { mode: 'insight', leagueId, insightId, question: q, packetSha };
  if (prior.length) req.turns = prior;
  if (typeof requestId === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(requestId)) req.requestId = requestId;
  return req;
}

/** What the server answered -> the one outcome the sheet draws. `kind`: answer | failed | unavailable | day | insight | budget | disabled. Pure (the transport's mapping is tested through it). */
export function askOutcomeFrom(data) {
  if (!data || typeof data !== 'object') return { kind: 'failed', refreshed: false };
  const refreshed = data.refreshed === true;
  if (data.skipped === 'throttled') return { kind: data.limit === 'insight' ? 'insight' : data.limit === 'day' ? 'day' : 'failed', refreshed };
  if (data.skipped === 'budget') return { kind: 'budget', refreshed };
  if (data.skipped === 'disabled') return { kind: 'disabled', refreshed };
  if (data.skipped) return { kind: 'failed', refreshed };
  if (data.ok === true && data.unavailable === true) return { kind: 'unavailable', refreshed };
  if (data.ok === true && data.answer && typeof data.answer.text === 'string' && data.answer.text.trim()) return { kind: 'answer', text: data.answer.text.trim().slice(0, 600), refreshed, asOf: typeof data.asOf === 'string' && Number.isFinite(Date.parse(data.asOf)) ? data.asOf : null };
  return { kind: 'failed', refreshed };
}

/** DI-1110: the question box grows with its lines, from one to three rows, then scrolls inside itself (the sheet never changes height). Pure. */
export const COMPOSER_MAX_ROWS = 3;
export function composerRows(text) { const n = String(text == null ? '' : text).split('\n').length; return Math.max(1, Math.min(COMPOSER_MAX_ROWS, n)); }

// ---- the body ----------------------------------------------------------------------------------------------------
const requireEsc = (e, who) => { if (typeof e !== 'function') throw new TypeError(`${who}() requires an injected escHtml function (CONVENTIONS #12) - it is never defaulted`); return e; };
const glyph = (iconFn, name, cls) => (typeof iconFn === 'function' && name ? `<span class="${cls}" aria-hidden="true">${iconFn(name)}</span>` : '');

/**
 * The sheet body. `view` = { turns: [{ q, a: { text, source }|null, state: 'instant'|'model'|'failed'|'loading', link?: 'what-if' }], chips: [chipDef], scope, modelEnabled, offline,
 * changed, capped: 'insight'|'day'|null, budget, gone, shareOffered, draft }. Every question and answer crosses escHtml here; every button is allow-listed by `data-ask-action`.
 * A model answer ("SCRIBE's read") may carry ONE link: "Open What if" for a strategy insight (the screen that holds every strategy). Sending is silent (DI-970: no haptic).
 * The question box (DI-1110) is a textarea of one to three rows; `view.wide` picks the Return key's hint ("send" on a wide screen, "enter" on a phone, the chat composer's rule).
 * A turn marked `fresh` (the answer that has just arrived) fades in over 150 ms; the caller clears the mark after the paint, so a repaint never replays an old answer.
 */
export function askBodyHTML(view, { escHtml, icon } = {}) {
  const esc = requireEsc(escHtml, 'askBodyHTML');
  const v = view || { turns: [], chips: [] };
  const turns = v.turns || [];
  const banner = v.changed ? `<div class="ask-banner" role="status"><span>${esc(ASK_COPY.changed)}</span><button type="button" class="ask-chip" data-ask-action="refresh">${esc(ASK_COPY.refresh)}</button></div>` : '';
  const scope = v.scope ? `<p class="ask-scope">${esc(v.scope)}</p>` : '';
  const conv = turns.map((t) => {
    const q = `<div class="ask-turn ask-turn--me"><div class="ask-bub ask-bub--me">${esc(t.q)}</div></div>`;
    if (t.state === 'loading') return `${q}<div class="ask-turn ask-turn--sc" role="status" aria-live="polite">${glyph(icon, 'scribeSpark', 'ask-av')}<div class="ask-bub ask-bub--sc ask-bub--load" aria-label="${esc(ASK_COPY.thinking)}"><span class="feed-skel-line feed-skel-line--wide"></span><span class="feed-skel-line feed-skel-line--narrow"></span></div></div>`;
    const a = t.a ? `<div class="ask-turn ask-turn--sc${t.fresh ? ' ask-turn--new' : ''}">${glyph(icon, 'scribeSpark', 'ask-av')}<div class="ask-col"><div class="ask-bub ask-bub--sc">${esc(t.a.text)}</div><span class="ask-src">${esc(t.a.source)}</span></div></div>` : '';
    const fail = t.state === 'failed' ? `<div class="ask-turn ask-turn--sc${t.fresh ? ' ask-turn--new' : ''}" role="status">${glyph(icon, 'scribeSpark', 'ask-av')}<div class="ask-bub ask-bub--sc">${esc(ASK_COPY.failed)}</div></div>` : '';
    const link = t.state === 'model' && t.link === 'what-if' ? `<button type="button" class="ask-link" data-ask-action="what-if">${esc(ASK_COPY.openWhatIf)}</button>` : '';
    const note = t.state === 'model' ? `<p class="ask-note">${esc(t.asOfText ? ASK_COPY.based + ' As of ' + t.asOfText + '.' : ASK_COPY.based)}</p>${link}` : '';   // DI-1109: a Game Day answer says when its numbers were read
    return `${q}${fail}${a}${note}`;
  }).join('');
  const chips = (v.chips || []).map((c) => `<button type="button" class="ask-chip" data-ask-action="chip" data-ask-chip="${esc(c.id)}" data-haptic="light"${(v.capped || v.budget || v.gone) && c.model ? ' disabled aria-disabled="true"' : ''}>${esc(turns.length ? c.short : c.label)}</button>`).join('');
  const chipRow = chips ? `<div class="ask-chips${turns.length ? ' ask-chips--row' : ''}" role="group" aria-label="Questions you can ask">${chips}</div>` : '';
  const open = v.modelEnabled && !v.budget && !v.gone;
  const offline = v.offline && open && !v.capped ? `<p class="ask-note" role="status">${esc(ASK_COPY.offline)}</p>` : '';
  const capText = v.gone ? ASK_COPY.unavailable : v.budget ? ASK_COPY.budget : v.capped === 'day' ? ASK_COPY.dayCapped : v.capped ? ASK_COPY.capped : '';
  const cap = capText ? `<p class="ask-note" role="status">${esc(capText)}</p>` : '';
  const len = String(v.draft || '').length;
  const count = `<span class="ask-count${len >= ASK_LIMITS.counterFrom ? '' : ' ask-count--hide'}" data-ask-count aria-live="polite">${esc(`${len}/${ASK_LIMITS.questionMax}`)}</span>`;
  const composer = open && !v.capped ? `<div class="ask-composer${v.offline ? ' ask-composer--off' : ''}"><label class="sr-only" for="ask-input">${esc(ASK_COPY.placeholder)}</label><textarea id="ask-input" class="ask-input" rows="${composerRows(v.draft)}" style="--ask-rows:${composerRows(v.draft)}" inputmode="text" enterkeyhint="${v.wide ? 'send' : 'enter'}" autocomplete="off" maxlength="${ASK_LIMITS.questionMax}" placeholder="${esc(ASK_COPY.placeholder)}"${v.offline ? ' disabled' : ''}>${esc(v.draft || '')}</textarea>${count}<button type="button" class="ask-send" data-ask-action="send" aria-label="Send"${v.offline ? ' disabled aria-disabled="true"' : ''}>${glyph(icon, 'chevronRight', 'ask-send-ic')}</button></div>` : '';
  const share = v.shareOffered && (turns.length || v.capped) ? `<button type="button" class="btn ${v.capped ? 'ask-share ask-share--pri' : 'ask-share'}" data-ask-action="share" data-haptic="light">${glyph(icon, 'share', 'cd-action-icon')}${esc(ASK_COPY.send)}</button>${v.capped ? '' : `<p class="ask-note">${esc(ASK_COPY.onlyYou)}</p>`}` : '';
  return `<div class="ask" data-ask>${banner}${scope}<div class="ask-conv" role="log" aria-live="polite" aria-label="Conversation">${conv}</div>${cap}${offline}${chipRow}${composer}${share}</div>`;
}
