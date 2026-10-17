/**
 * scribe-profile-view.js — the RENDERED half of the SCRIBE profile admin: pure string builders for the pane, its four segments, the Add / Standards / detail / player sheets
 * and the Comm-tab entry card. D1 Lane C, FB-006 / UN-468 / PF-468; DI-644 (the pane), DI-645 (add / correct), DI-646 (history), DI-647 (standards), DI-648 (entry card), DI-681
 * (the Replace button), DI-682 (league lore). Layout approved by Drew, D-43 (`docs/mockups/d1/scribe-profile-admin.html`); the lore section and the Replace button are the
 * small deltas the DIs describe.
 *
 * THE SAME RULES AS js/league-settings-view.js, WHICH IS THE PRECEDENT:
 *   • Pure. No DOM, no network, no storage, no `Date.now()` clock of its own that a test cannot pass in. app.js is the DOM and network wiring; this is the markup.
 *   • `escHtml` and `icon` are REQUIRED INJECTED DEPENDENCIES (CONVENTIONS #12). Every piece of data that reaches a template — a rule's text, a player's words, a name — is
 *     placed ONLY as a text node or inside a DOUBLE-quoted attribute (`escHtml` does not escape the single quote), never in an inline handler, a URL or a style attribute.
 *     A number that can be zero goes through `num()` (`escHtml(0)` is the empty string).
 *   • Copy lives in `SP_COPY`, once, so the pane, the toasts and the tests read one definition.
 *   • Every control is >= 44 pt (the `.sp-btn` / `.sp-nav-btn` / `.sp-seg-btn` classes carry the floor), groups use a container `gap` (8 pt in a group, 16 pt between groups),
 *     a row of buttons wraps instead of colliding, and nothing here is a swipe action: Approve / Reject / Turn off / Undo are buttons on both platforms (PD-C: accessibility
 *     and web parity).
 *
 * The rows it draws arrive DECORATED by app.js: each carries `ui` — `{ phase: 'saving' | 'failed' | null, approving: bool, action: 'review' | 'toggle' }` — which is the
 * batch O tracker's answer for that row (`scribeReviewState`). The view never decides whether a decision is in flight; it draws the state it is handed. A row that is
 * `saving` or `failed` is drawn as the status the SERVER still holds (the pane keeps `row.status` as the server reported it; the local optimistic write is never drawn).
 */

import { categoryLabel, INSTRUCTION_CATEGORIES, TEXT_MAX, KEY_MAX, RULE_CAP_MESSAGE, HOLD_BADGE_LABEL, HOLD_BADGE_REASON } from './scribe-profile-rules.js';

// ── copy ───────────────────────────────────────────────────────────────────────────────────────────
export const SP_COPY = Object.freeze({
  title: 'SCRIBE profile',
  back: 'SCRIBE',
  entryTitle: 'SCRIBE profile',
  entryCaption: 'What SCRIBE follows, what it has learned, and what it knows about each player.',
  trainerRow: 'Open SCRIBE profile',
  standardsRow: 'Standards',
  standardsRowCaption: (v) => `SCRIBE v${v} · voice, hard rules, heat · read-only`,
  segments: Object.freeze({ active: 'Active', pending: 'Pending', players: 'Players', history: 'History' }),
  sections: Object.freeze({ rules: 'Rules SCRIBE follows', examples: 'Examples it imitates', lore: 'League lore', turnedOff: 'Turned off' }),
  empty: Object.freeze({
    active: 'SCRIBE is running on its written standards alone. Approve a learning or add an instruction to shape it.',
    pending: 'Nothing waiting. New suggestions from the Trainer show up here.',
    players: 'No player notes yet.',
    history: 'No changes yet.',
    lore: 'No lore yet. Add the things that really happened in this league.',
  }),
  loadError: "Couldn't load the SCRIBE profile.",
  denied: 'Only the commissioner can open this.',
  paused: 'SCRIBE is paused while this league is paused.',
  retry: 'Retry',
  footActive: (n) => `${n} active in total. Turning a rule off keeps it in History. Nothing here can override SCRIBE's hard rules.`,
  footPending: 'Pending items do nothing until you approve them and the save is confirmed.',
  footPlayers: "Boundaries and roast limits are each player's own. You can see them; only the player can change them.",
  footLore: 'League lore is visible to the whole league: every member can read it. Only you can change it.',
  rowSaveFailed: "Couldn't save. This one is still waiting for review.",
  toggleSaveFailed: "Couldn't save. Nothing changed.",
  addSaveFailed: "Couldn't save. Nothing was added.",
  removeSaveFailed: "Couldn't remove it. Nothing changed.",
  // N2: the held-for-review words come from ONE producer (js/scribe-profile-rules.js), the same one the Trainer card's badge and the approve confirmation read.
  held: HOLD_BADGE_LABEL,
  heldWhy: `Held because it ${HOLD_BADGE_REASON}. Approving is still your call.`,
  capNote: RULE_CAP_MESSAGE,
  replaceGone: 'The rule this would replace is no longer active, so there is nothing left to replace. You can reject it.',
  // Round-3 reviewer note 1: the two row-level sentences for a decision the pane checked against a FRESH view right before sending (so the database is never asked to refuse it).
  // Reviewer ruling (D1 integration batch 3b, 2026-10-07): no "try again" — the rule was decided or changed elsewhere and the list is already current, so there is nothing to retry.
  ruleChanged: 'That rule changed somewhere else. The list is up to date.',
  checkFailed: "Couldn't check the latest rules. Nothing changed.",
  keepWhy: 'This rule was applied automatically. Keep it and it stays until you turn it off: it no longer fades, and the Trainer cannot replace it.',
  turnedOffHint: 'Rules you turned off. Turn one on to have SCRIBE follow it again.',
  toast: Object.freeze({
    approved: 'Approved. SCRIBE follows it from now on.',
    replaced: 'Replaced. SCRIBE follows the new one from now on.',
    rejected: 'Rejected. It stays in History.',
    off: 'Off. SCRIBE stops using this.',
    on: 'Back on. SCRIBE will use this again.',
    added: 'Added. SCRIBE will use it from its next post.',
    addedHeld: `Held for review. It ${HOLD_BADGE_REASON}. Approve it from Pending if you're sure.`,
    kept: 'Kept. SCRIBE follows it until you turn it off.',
    undo: 'Undo',
    fact: 'Added. SCRIBE will know it from its next post.',
    lore: 'Added. SCRIBE may refer to it from its next post.',
    corrected: 'Corrected. The old version stays in History.',
    removed: 'Removed. It stays in History.',
  }),
  errors: Object.freeze({
    held_for_review: `That ${HOLD_BADGE_REASON}. SCRIBE only uses football and league facts. Rephrase it and try again.`,
    rule_cap_reached: RULE_CAP_MESSAGE,
    not_keepable: "That rule isn't active any more. Close this and reopen it.",
    bad_text: 'Check the text: 1 to 200 characters, one line.',
    bad_key: 'Check the topic: 1 to 40 letters, numbers or punctuation.',
    bad_category: 'Pick one of the topics.',
    bad_player: 'Pick a player in this league.',
    bad_supersedes: 'That rule has already changed. Close this and reopen it.',
    not_commissioner: 'Only the commissioner can do this.',
    pilot_only: "SCRIBE's profile is only available to the pilot league.",
    not_found: 'That entry is already gone.',
    not_removable: "That one isn't yours to remove.",
    network: "Couldn't reach the server. Check your connection and try again.",
  }),
  add: Object.freeze({
    title: 'Add to SCRIBE',
    tabs: Object.freeze({ instruction: 'Instruction', fact: 'Player fact', lore: 'League lore' }),
    instructionHelp: "SCRIBE follows this the next time it speaks. It can't override SCRIBE's hard rules or any player's boundary.",
    factHelp: "Football and league facts only. SCRIBE doesn't use anything about real life.",
    loreHelp: 'League and football history only. Every member of the league can read lore.',
    cancel: 'Cancel',
    submit: 'Add',
    submitting: 'Adding…',
    correctSubmit: 'Save correction',
  }),
});

// ── small helpers ──────────────────────────────────────────────────────────────────────────────────
function need(esc, who) {
  if (typeof esc !== 'function') throw new TypeError(`${who}() requires an escHtml function — a rule's text, a player's words and a name are user data and must never render unescaped`);
}
/** A number for markup: coerced, so it can carry no markup, and a ZERO survives (escHtml(0) is ''). */
const num = (n) => String(Number.isFinite(Number(n)) ? Number(n) : 0);
const when = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const whenFull = (iso) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return '';
  return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};
export const TOLERANCE_LABEL = Object.freeze({ light: 'Light', standard: 'Standard', no_limits: 'No limits' });
export function toleranceLabel(value) {
  const v = String(value || '');
  if (Object.prototype.hasOwnProperty.call(TOLERANCE_LABEL, v)) return TOLERANCE_LABEL[v];
  return v ? v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()) : 'Standard';
}
const PROVENANCE_LABEL = Object.freeze({
  computed: 'Kept current automatically',
  'commissioner-set': 'Added by you',
  'trainer-proposed': 'Proposed by the Trainer, you approved',
  'player-stated': 'Stated by the player',
});
export function provenanceLabel(p) { return PROVENANCE_LABEL[String(p || '')] || 'Added'; }
/** A fact the commissioner may remove from the player sheet (the function repeats this check): his own or an approved Trainer proposal. */
export function isRemovableFact(fact) { return ['commissioner-set', 'trainer-proposed'].includes(String(fact && fact.provenance)); }

/** The one word for who/what made a change, for a row's source line. */
export function sourceLine(row) {
  const day = when(row.approvedAt || row.createdAt);
  if (row.status === 'superseded') {
    const was = row.humanApproved ? (row.origin === 'human' ? 'you added it' : 'you approved it') : row.origin === 'instant' ? 'auto-applied (instant)' : row.origin === 'human' ? 'you added it' : 'auto-applied (Trainer)';
    return `Turned off · ${was} · ${day}`;
  }
  if (row.humanApproved) {
    return row.origin === 'human' ? `You added this · ${day}` : `You approved this · ${day}`;
  }
  if (row.status === 'approved') return row.origin === 'instant' ? `Auto-applied (instant) · ${day}` : `Auto-applied (Trainer) · ${day}`;
  if (row.origin === 'human') return `Added by you, held for review · ${day}`;
  const via = row.origin === 'instant' ? 'Proposed from a reaction' : 'Proposed by the Trainer';
  const c = Number(row.confidence);
  return `${via}${Number.isFinite(c) && c > 0 && c < 1 ? ` · confidence ${c.toFixed(2)}` : ''} · ${day}`;
}

/** History's sentence for one fixed-field entry: "You approved: …", "Trainer proposed: …", "Auto-applied (instant): …", "{Name} changed a boundary". */
export function historySentence(e) {
  const actor = e && e.actor;
  const name = actor && typeof actor === 'object' ? String(actor.name || 'A member') : '';
  const who = actor === 'you' ? 'You' : actor === 'instant' ? 'Auto-applied (instant)' : actor === 'trainer' ? 'Trainer' : name;
  const verb = String((e && e.verb) || '');
  const text = String((e && e.text) || '');
  if (e && (e.kind === 'hardline' || e.kind === 'roastTolerance')) {
    return `${who} ${verb} (details are private to ${who === 'You' ? 'you' : who} and you)`;
  }
  if (actor === 'instant') return text ? `Auto-applied (instant): ${text}` : 'Auto-applied (instant)';
  const subject = e && e.subject ? ` about ${e.subject}` : '';
  // N1 — a folded entry: one line for a correction or a Replace ("You corrected: …", "You replaced a rule with: …").
  const head = verb === 'replaced' ? `${who} replaced a rule with` : `${who} ${verb}${e && e.kind === 'lore' ? ' lore' : e && e.kind === 'fact' ? ` a fact${subject}` : ''}`;
  return text ? `${head}: ${text}` : head;
}

// ── the entry card (Comm -> SCRIBE tab) ─────────────────────────────────────────────────────────────
/** DI-648: the FIRST card on the SCRIBE tab. The whole card is one 44 pt+ tappable row with a chevron; a count pill shows when anything is pending. */
/** The count line of the entry card, shared by the card and by the in-place refresh after the pane closes (N3). Numbers only: `num()` coerces. */
export function entryLineHTML({ active = 0, pending = 0 } = {}) {
  return `<strong>${num(active)} active</strong> · <strong>${num(pending)} waiting for review</strong>`;
}
export function entryAriaLabel({ active = 0, pending = 0 } = {}) {
  return `${SP_COPY.entryTitle}. ${num(active)} active, ${num(pending)} waiting for review.`;
}
export function entryCardHTML({ active = 0, pending = 0, loading = false } = {}, { escHtml, icon }) {
  need(escHtml, 'entryCardHTML');
  const pill = pending > 0 ? `<span class="sp-pill sp-pill-count" aria-hidden="true">${num(pending)}</span>` : '';
  const line = loading ? 'Open to see what SCRIBE follows' : entryLineHTML({ active, pending });
  return `
    <div class="admin-section" data-comm-tab="scribe" data-comm-card="scribe-profile">
      <div class="admin-section-title">${icon('scribeSpark')} ${escHtml(SP_COPY.entryTitle)} ${pill}</div>
      <button type="button" class="card sp-entry" id="scribe-profile-open" aria-label="${escHtml(loading ? SP_COPY.entryTitle : entryAriaLabel({ active, pending }))}">
        <span class="sp-entry-main">
          <span class="sp-entry-line">${line}</span>
          <span class="text-muted text-xs">${escHtml(SP_COPY.entryCaption)}</span>
        </span>
        <span class="sp-chev">${icon('chevronRight')}</span>
      </button>
    </div>`;
}

// ── rows ─────────────────────────────────────────────────────────────────────────────────────────────
function pillsHTML(row, { escHtml }) {
  const cat = row.list === 'canon' ? (row.kind === 'anti_canon' ? 'Line to avoid' : 'Example')
    : row.kind === 'fact_candidate' ? `Player fact${row.playerName ? ` · ${row.playerName}` : ''}`
      : row.kind === 'experiment' ? 'Experiment' : categoryLabel(row.category);
  const held = row.flaggedHostile ? `<span class="sp-pill sp-pill-hold">${escHtml(SP_COPY.held)}</span>` : '';
  const notLive = row.status === 'approved' && row.live === false ? '<span class="sp-pill">Not in use yet</span>' : '';
  const prov = row.provisional ? '<span class="sp-pill">Provisional</span>' : '';
  return `<span class="sp-item-head"><span class="sp-pill">${escHtml(cat)}</span>${held}${notLive}${prov}</span>`;
}
function metaHTML(row, { escHtml }) {
  const quote = row.source && row.source.quote
    ? `<br>from: &ldquo;${escHtml(row.source.quote)}&rdquo;${row.source.authorName ? ` (${escHtml(row.source.authorName)})` : ''}` : '';
  const live = row.status === 'approved' && row.live === false && !row.humanApproved
    ? "<br>Auto-applied below SCRIBE's confidence floor, so it isn't in use. Open it and tap Keep to keep it for good." : '';
  return `<span class="sp-meta">${escHtml(sourceLine(row))}${quote}${live}</span>`;
}
/** The pane's own one-line message on a row (round 3): why a tapped decision was not sent. Empty when there is none. */
function rowMessageHTML(row, { escHtml }) {
  return row.rowMessage ? `<div class="sp-err" role="alert">${escHtml(String(row.rowMessage))}</div>` : '';
}
function rowAttr(row, escHtml) { return `data-sp-list="${row.list === 'canon' ? 'canon' : 'learnings'}" data-sp-id="${escHtml(String(row.id))}"`; }

/**
 * One PENDING row: Approve (Replace when it proposes to replace an approved learning) and Reject, both visible 44 pt buttons.
 * S2 — a proposal whose `replaces` target is no longer approved has NOTHING TO REPLACE (the database would refuse the approval), so it offers Reject only, with the sentence.
 * B3 — `capBlocked` (the pane sets it when approving would be the 16th rule) disables Approve and prints the cap sentence; a Replace is never cap-blocked (net zero).
 */
export function pendingRowHTML(row, { escHtml }) {
  need(escHtml, 'pendingRowHTML');
  const ui = row.ui || {};
  const saving = ui.phase === 'saving';
  const failed = ui.phase === 'failed';
  const onApprove = !!ui.approving;
  const replacing = !!row.replaces;
  const orphan = replacing && row.replacesActive === false;
  const approveWord = replacing ? 'Replace' : 'Approve';
  const approveLabel = saving && onApprove ? 'Saving…' : failed && onApprove ? SP_COPY.retry : approveWord;
  const rejectLabel = saving && !onApprove ? 'Saving…' : failed && !onApprove ? SP_COPY.retry : 'Reject';
  const replLine = replacing
    ? `<div class="sp-replaces">Proposed replacement for: ${row.replacesText ? escHtml(row.replacesText) : 'a rule that is no longer shown'}${row.replacesActive === false ? ' <span class="text-muted">(no longer active)</span>' : ''}</div>` : '';
  const heldWhy = row.flaggedHostile ? `<div class="text-muted text-xs">${escHtml(SP_COPY.heldWhy)}</div>` : '';
  const orphanLine = orphan ? `<div class="text-muted text-xs">${escHtml(SP_COPY.replaceGone)}</div>` : '';
  const blocked = !!row.capBlocked && !replacing && !orphan;
  // A row message (the pane's pre-send freshness check refused, or could not run) says it once, in its own alert line; the passive cap note never prints the same sentence twice.
  const capLine = blocked && row.rowMessage !== SP_COPY.capNote ? `<div class="text-muted text-xs" role="note">${escHtml(SP_COPY.capNote)}</div>` : '';
  const err = failed ? `<div class="sp-err" role="alert">${escHtml(SP_COPY.rowSaveFailed)}</div>` : rowMessageHTML(row, { escHtml });
  const approveBtn = orphan ? ''
    : `<button type="button" class="btn btn-primary sp-btn sp-approve" data-sp-act="approve"${saving || blocked ? ' disabled' : ''}${saving && onApprove ? ' aria-busy="true"' : ''}>${escHtml(approveLabel)}</button>`;
  return `<div class="sp-item" ${rowAttr(row, escHtml)}>
      ${pillsHTML(row, { escHtml })}
      ${replLine}
      <div class="sp-body">${escHtml(row.text)}</div>
      ${metaHTML(row, { escHtml })}
      ${heldWhy}
      ${orphanLine}
      ${capLine}
      ${err}
      <div class="sp-actions">
        ${approveBtn}
        <button type="button" class="btn btn-secondary sp-btn sp-reject" data-sp-act="reject"${saving ? ' disabled' : ''}${saving && !onApprove ? ' aria-busy="true"' : ''}>${escHtml(rejectLabel)}</button>
      </div>
    </div>`;
}

/**
 * One ACTIVE rule (B1): a category pill, its text, who proposed it and when, and a tap target that opens the detail sheet. The ONLY control on the row is Undo, and only for a rule under 24 hours
 * old that was applied without a human (as the approved mockup shows). Turn off, Correct and Keep live in the detail sheet. A save in flight or a refusal started from the sheet still shows here.
 */
export function activeRowHTML(row, { escHtml }) {
  need(escHtml, 'activeRowHTML');
  const ui = row.ui || {};
  const saving = ui.phase === 'saving';
  const failed = ui.phase === 'failed';
  const undo = row.undoable && row.canToggle !== false
    ? `<div class="sp-actions sp-actions-start">
        <button type="button" class="btn btn-secondary sp-btn sp-toggle" data-sp-act="toggle"${saving ? ' disabled aria-busy="true"' : ''}>${escHtml(saving ? 'Saving…' : failed ? SP_COPY.retry : SP_COPY.toast.undo)}</button>
      </div>` : '';
  const stateLine = saving && !undo ? `<div class="sp-meta" role="status">Saving…</div>` : '';
  const err = failed ? `<div class="sp-err" role="alert">${escHtml(SP_COPY.toggleSaveFailed)}</div>` : '';
  return `<div class="sp-item" ${rowAttr(row, escHtml)}>
      <button type="button" class="sp-item-tap" data-sp-act="detail" aria-label="${escHtml(`Open details: ${row.text}`)}">
        ${pillsHTML(row, { escHtml })}
        <span class="sp-body">${escHtml(row.text)}</span>
        ${metaHTML(row, { escHtml })}
      </button>
      ${stateLine}
      ${err}
      ${undo}
    </div>`;
}

/** One TURNED-OFF rule (B1): its text and where it came from, and Turn on — which, tapped by the commissioner, makes it human-approved (the database stamps it). */
export function turnedOffRowHTML(row, { escHtml }) {
  need(escHtml, 'turnedOffRowHTML');
  const ui = row.ui || {};
  const saving = ui.phase === 'saving';
  const failed = ui.phase === 'failed';
  const blocked = !!row.capBlocked;
  const label = saving ? 'Saving…' : failed ? SP_COPY.retry : 'Turn on';
  const capLine = blocked && row.rowMessage !== SP_COPY.capNote ? `<div class="text-muted text-xs" role="note">${escHtml(SP_COPY.capNote)}</div>` : '';
  const err = failed ? `<div class="sp-err" role="alert">${escHtml(SP_COPY.toggleSaveFailed)}</div>` : rowMessageHTML(row, { escHtml });
  const btn = row.canToggle === false ? '' : `<div class="sp-actions sp-actions-start">
        <button type="button" class="btn btn-secondary sp-btn sp-turnon" data-sp-act="turn-on"${saving || blocked ? ' disabled' : ''}${saving ? ' aria-busy="true"' : ''}>${escHtml(label)}</button>
      </div>`;
  return `<div class="sp-item" ${rowAttr(row, escHtml)}>
      ${pillsHTML(row, { escHtml })}
      <div class="sp-body">${escHtml(row.text)}</div>
      <span class="sp-meta">${escHtml(sourceLine(row))}</span>
      ${capLine}
      ${err}
      ${btn}
    </div>`;
}

/** N6 — who added a lore entry, worded PER VIEWER: 'you' for the caller, a name for another commissioner, nothing guessed when the trail does not say. */
export function loreAddedByLine(entry) {
  const by = entry && entry.addedBy;
  if (by === 'you') return 'Added by you';
  if (by && typeof by === 'object' && by.name) return `Added by ${by.name}`;
  return 'Added';
}

function exampleRowHTML(row, { escHtml }) {
  return `<div class="sp-item" ${rowAttr(row, escHtml)}>
      ${pillsHTML(row, { escHtml })}
      <div class="sp-body">${escHtml(row.text)}</div>
      <div class="sp-meta">${escHtml(sourceLine(row))}</div>
    </div>`;
}
function loreRowHTML(entry, { escHtml }, canEdit) {
  return `<div class="sp-item" data-sp-lore="${escHtml(entry.key)}">
      <button type="button" class="sp-item-tap" ${canEdit ? 'data-sp-act="lore-detail"' : 'disabled'} aria-label="${escHtml(`${canEdit ? 'Open details: ' : ''}${entry.key}: ${entry.text}`)}">
        <span class="sp-item-head"><span class="sp-pill">${escHtml(entry.key)}</span></span>
        <span class="sp-body">${escHtml(entry.text)}</span>
        <span class="sp-meta">${escHtml(loreAddedByLine(entry))} · ${escHtml(when(entry.updatedAt))}</span>
      </button>
    </div>`;
}

// ── segments ─────────────────────────────────────────────────────────────────────────────────────────
function skeletonHTML() {
  return '<div class="sp-skel-list" aria-hidden="true"><div class="sp-skel"></div><div class="sp-skel"></div><div class="sp-skel"></div></div>';
}
function emptyHTML(text, { escHtml }) {
  return `<div class="sp-empty"><p>${escHtml(text)}</p></div>`;
}

/**
 * The Active segment: the rules SCRIBE follows, then (B1) a "Turned off" group — COLLAPSED by default, a disclosure row with the count — then the examples it imitates, then the league lore.
 * `opts.showOff` is the pane's own open/closed state for the group (it is UI state, not data).
 */
export function activeSegmentHTML(view, deps, opts = {}) {
  const { escHtml, icon } = deps;
  need(escHtml, 'activeSegmentHTML');
  const active = (view && view.active) || [];
  const turnedOff = (view && view.turnedOff) || [];
  const examples = (view && view.examples) || [];
  const lore = (view && view.lore) || [];
  const canEdit = !!(view && view.canEdit);
  const loreFoot = `<p class="sp-foot">${escHtml(SP_COPY.footLore)}</p>`;
  if (!active.length && !turnedOff.length && !examples.length && !lore.length) {
    return emptyHTML(SP_COPY.empty.active, deps) + (view && view.pilot ? `<h3 class="sp-section">${escHtml(SP_COPY.sections.lore)}</h3>${emptyHTML(SP_COPY.empty.lore, deps)}${loreFoot}` : '');
  }
  const rules = active.length
    ? `<div class="card sp-list">${active.map((r) => activeRowHTML(r, deps)).join('')}</div>`
    : emptyHTML(SP_COPY.empty.active, deps);
  const off = turnedOff.length ? offGroupHTML(turnedOff, !!opts.showOff, deps) : '';
  const exs = examples.length ? `<h3 class="sp-section">${escHtml(SP_COPY.sections.examples)}</h3><div class="card sp-list">${examples.map((r) => exampleRowHTML(r, deps)).join('')}</div>` : '';
  const loreHTML = view && view.pilot
    ? `<h3 class="sp-section">${escHtml(SP_COPY.sections.lore)}</h3>${lore.length ? `<div class="card sp-list">${lore.map((e) => loreRowHTML(e, deps, canEdit)).join('')}</div>` : emptyHTML(SP_COPY.empty.lore, deps)}${loreFoot}` : '';
  const total = Number(view && view.counts && view.counts.active) || 0;
  return `<h3 class="sp-section">${escHtml(SP_COPY.sections.rules)}</h3>${rules}${off}${exs}${loreHTML}<p class="sp-foot">${escHtml(SP_COPY.footActive(num(total)))}</p>`;
}

/** The "Turned off (n)" disclosure: one 44 pt row; closed it shows only the count, open it lists the rules with Turn on. */
function offGroupHTML(rows, open, { escHtml, icon }) {
  const head = `<button type="button" class="sp-group-toggle" data-sp-act="toggle-off-group" aria-expanded="${open ? 'true' : 'false'}" aria-controls="sp-off-list">
      <span class="sp-group-title">${escHtml(SP_COPY.sections.turnedOff)} (${num(rows.length)})</span>
      <span class="sp-chev sp-chev-turn" aria-hidden="true">${icon('chevronRight')}</span>
    </button>`;
  if (!open) return `${head}<div id="sp-off-list" hidden></div>`;          // aria-controls names a node that exists even while the group is closed
  return `${head}<div class="card sp-list" id="sp-off-list"><p class="sp-foot">${escHtml(SP_COPY.turnedOffHint)}</p>${rows.map((r) => turnedOffRowHTML(r, { escHtml })).join('')}</div>`;
}

export function pendingSegmentHTML(view, deps) {
  const { escHtml } = deps;
  need(escHtml, 'pendingSegmentHTML');
  const pending = (view && view.pending) || [];
  if (!pending.length) return emptyHTML(SP_COPY.empty.pending, deps);
  return `<div class="card sp-list">${pending.map((r) => pendingRowHTML(r, deps)).join('')}</div><p class="sp-foot">${escHtml(SP_COPY.footPending)}</p>`;
}

export function playersSegmentHTML(view, deps) {
  const { escHtml, icon } = deps;
  need(escHtml, 'playersSegmentHTML');
  const players = (view && view.players) || [];
  if (!players.length) return emptyHTML(SP_COPY.empty.players, deps);
  const rows = players.map((p) => {
    const initial = String(p.name || '?').trim().slice(0, 1).toUpperCase();
    return `<button type="button" class="sp-player" data-sp-act="player" data-sp-member="${escHtml(p.memberId)}">
        <span class="sp-avatar" aria-hidden="true">${escHtml(initial)}</span>
        <span class="sp-player-main"><span class="sp-body"><strong>${escHtml(p.name)}</strong></span>
          <span class="sp-meta">${num(p.factCount)} ${p.factCount === 1 ? 'note' : 'notes'} · ${num(p.boundaryCount)} ${p.boundaryCount === 1 ? 'boundary' : 'boundaries'} · Roast limit: ${escHtml(toleranceLabel(p.tolerance))}</span></span>
        <span class="sp-chev">${icon('chevronRight')}</span>
      </button>`;
  }).join('');
  return `<div class="card sp-list">${rows}</div><p class="sp-foot">${escHtml(SP_COPY.footPlayers)}</p>`;
}

export function historySegmentHTML(history, deps) {
  const { escHtml } = deps;
  need(escHtml, 'historySegmentHTML');
  const h = history || { status: 'idle', entries: [], more: false };
  if (h.status === 'loading' && !h.entries.length) return skeletonHTML();
  if (h.status === 'error' && !h.entries.length) {
    return `<div class="sp-empty"><p>${escHtml(SP_COPY.loadError)}</p><button type="button" class="btn btn-secondary sp-btn" data-sp-act="history-retry">${escHtml(SP_COPY.retry)}</button></div>`;
  }
  if (!h.entries.length) return emptyHTML(SP_COPY.empty.history, deps);
  const items = h.entries.map((e) => `<div class="sp-item">
        <div class="sp-body">${escHtml(historySentence(e))}</div>
        <div class="sp-meta">${escHtml(whenFull(e.at))}</div>
      </div>`).join('');
  const more = h.more
    ? `<div class="sp-actions"><button type="button" class="btn btn-secondary sp-btn" data-sp-act="history-more"${h.status === 'loading' ? ' disabled aria-busy="true"' : ''}>${h.status === 'loading' ? 'Loading…' : 'Load more'}</button></div>`
    : '';
  const err = h.status === 'error' ? `<div class="sp-err" role="alert">${escHtml(SP_COPY.loadError)}</div>` : '';
  return `<div class="card sp-list">${items}</div>${err}${more}`;
}

export function segmentBodyHTML(state, deps) {
  if (state.status === 'loading' && !state.view) return skeletonHTML();
  if (state.status === 'error') {
    return `<div class="sp-empty"><p>${deps.escHtml(SP_COPY.loadError)}</p><button type="button" class="btn btn-secondary sp-btn" data-sp-act="retry">${deps.escHtml(SP_COPY.retry)}</button></div>`;
  }
  if (state.status === 'denied') return emptyHTML(SP_COPY.denied, deps);
  if (state.status === 'paused') return emptyHTML(SP_COPY.paused, deps);
  switch (state.seg) {
    case 'pending': return pendingSegmentHTML(state.view, deps);
    case 'players': return playersSegmentHTML(state.view, deps);
    case 'history': return historySegmentHTML(state.history, deps);
    default: return activeSegmentHTML(state.view, deps, { showOff: !!state.showOff });
  }
}

// ── the pane ──────────────────────────────────────────────────────────────────────────────────────────
/** The whole pane: nav bar (back chevron "SCRIBE", title, a 44 pt "+"), the Standards row, the four-segment control, and the active segment's body. */
export function paneHTML(state, deps) {
  const { escHtml, icon } = deps;
  need(escHtml, 'paneHTML');
  const view = state.view;
  const pendingN = view ? Number(view.counts && view.counts.pending) || 0 : Number(state.cached && state.cached.pending) || 0;
  const canEdit = !!(view && view.canEdit);
  const version = view && view.standards && view.standards.version ? view.standards.version : state.standardsVersion || '';
  const segs = ['active', 'pending', 'players', 'history'].map((k) => {
    const on = state.seg === k;
    const label = SP_COPY.segments[k] + (k === 'pending' && pendingN > 0 ? ` ${num(pendingN)}` : '');
    return `<button type="button" role="tab" id="sp-tab-${k}" aria-selected="${on ? 'true' : 'false'}" aria-controls="sp-panel" class="sp-seg-btn${on ? ' on' : ''}" data-sp-seg="${k}">${escHtml(label)}</button>`;
  }).join('');
  return `
    <header class="sp-nav">
      <button type="button" class="sp-nav-btn sp-back" data-sp-act="back" aria-label="Back to SCRIBE">${icon('chevronLeft')}<span>${escHtml(SP_COPY.back)}</span></button>
      <h1 class="sp-title" id="sp-title" tabindex="-1">${escHtml(SP_COPY.title)}</h1>
      ${canEdit ? `<button type="button" class="sp-nav-btn sp-add" data-sp-act="add" aria-label="Add to SCRIBE">${icon('plus')}</button>` : '<span class="sp-nav-spacer" aria-hidden="true"></span>'}
    </header>
    <div class="sp-scroll" id="sp-scroll">
      <button type="button" class="card sp-standards-row" data-sp-act="standards">
        <span class="sp-entry-main"><span class="sp-entry-line"><strong>${escHtml(SP_COPY.standardsRow)}</strong></span>
          <span class="text-muted text-xs">${escHtml(version ? SP_COPY.standardsRowCaption(version) : 'Voice, hard rules, heat · read-only')}</span></span>
        <span class="sp-chev">${icon('chevronRight')}</span>
      </button>
      <div class="sp-seg" role="tablist" aria-label="SCRIBE profile sections">${segs}</div>
      <div class="sp-panel" id="sp-panel" role="tabpanel" aria-labelledby="sp-tab-${escHtml(state.seg)}">${segmentBodyHTML(state, deps)}</div>
    </div>`;
}

// ── sheets ────────────────────────────────────────────────────────────────────────────────────────────
function counterHTML(id, max, len) { return `<span class="sp-count" id="${id}" aria-live="polite">${num(len)} / ${num(max)}</span>`; }

/**
 * The Add / Correct sheet BODY. `s` = { tab: 'instruction' | 'fact' | 'lore', category, text, playerId, key, value, loreKey, loreText, busy, error,
 * correcting: null | { kind: 'instruction' | 'lore', id?, key?, locked: true } }. Inputs are drawn with their current values so a repaint (a tab switch, an error) loses nothing typed.
 */
export function addSheetBodyHTML(s, { escHtml }, { players = [], pilot = true, atCap = false } = {}) {
  need(escHtml, 'addSheetBodyHTML');
  const corr = s.correcting || null;
  const tabs = ['instruction', 'fact'].concat(pilot ? ['lore'] : []);
  const tabBar = corr ? '' : `<div class="sp-seg sp-seg-sheet" role="tablist" aria-label="What to add">${tabs.map((t) => `<button type="button" role="tab" aria-selected="${s.tab === t ? 'true' : 'false'}" class="sp-seg-btn${s.tab === t ? ' on' : ''}" data-sp-tab="${t}">${escHtml(SP_COPY.add.tabs[t])}</button>`).join('')}</div>`;
  const busy = !!s.busy;
  let fields = '';
  let help = '';
  if (s.tab === 'instruction') {
    const opts = INSTRUCTION_CATEGORIES.map((c) => `<option value="${escHtml(c.value)}"${s.category === c.value ? ' selected' : ''}>${escHtml(c.label)}</option>`).join('');
    fields = `<div class="form-group"><label class="form-label" for="sp-f-category">Topic</label>
        <select class="form-select" id="sp-f-category" data-sp-field="category"${corr || busy ? ' disabled' : ''}>${opts}</select></div>
      <div class="form-group"><label class="form-label" for="sp-f-text">What SCRIBE should do</label>
        <textarea class="form-textarea sp-textarea" id="sp-f-text" data-sp-field="text" maxlength="${num(TEXT_MAX)}" placeholder="e.g. Keep game-day posts to one sentence."${busy ? ' disabled' : ''}>${escHtml(s.text || '')}</textarea>
        ${counterHTML('sp-c-text', TEXT_MAX, (s.text || '').length)}</div>`;
    help = SP_COPY.add.instructionHelp;
  } else if (s.tab === 'fact') {
    const popts = players.map((p) => `<option value="${escHtml(p.memberId)}"${s.playerId === p.memberId ? ' selected' : ''}>${escHtml(p.name)}</option>`).join('');
    fields = `<div class="form-group"><label class="form-label" for="sp-f-player">Player</label>
        <select class="form-select" id="sp-f-player" data-sp-field="playerId"${busy ? ' disabled' : ''}>${popts}</select></div>
      <div class="form-group"><label class="form-label" for="sp-f-key">Topic</label>
        <input class="form-input" id="sp-f-key" data-sp-field="key" maxlength="${num(KEY_MAX)}" placeholder="e.g. Pick style" value="${escHtml(s.key || '')}"${busy ? ' disabled' : ''}>
        ${counterHTML('sp-c-key', KEY_MAX, (s.key || '').length)}</div>
      <div class="form-group"><label class="form-label" for="sp-f-value">What SCRIBE should know</label>
        <textarea class="form-textarea sp-textarea" id="sp-f-value" data-sp-field="value" maxlength="${num(TEXT_MAX)}" placeholder="e.g. Takes home underdogs most weeks."${busy ? ' disabled' : ''}>${escHtml(s.value || '')}</textarea>
        ${counterHTML('sp-c-value', TEXT_MAX, (s.value || '').length)}</div>`;
    help = SP_COPY.add.factHelp;
  } else {
    fields = `<div class="form-group"><label class="form-label" for="sp-f-lkey">Topic</label>
        <input class="form-input" id="sp-f-lkey" data-sp-field="loreKey" maxlength="${num(KEY_MAX)}" placeholder="e.g. CFP 2K25"${corr || busy ? ' disabled' : ''} value="${escHtml(s.loreKey || '')}">
        ${counterHTML('sp-c-lkey', KEY_MAX, (s.loreKey || '').length)}</div>
      <div class="form-group"><label class="form-label" for="sp-f-ltext">What happened</label>
        <textarea class="form-textarea sp-textarea" id="sp-f-ltext" data-sp-field="loreText" maxlength="${num(TEXT_MAX)}" placeholder="e.g. Kihoon won CFP 2K25."${busy ? ' disabled' : ''}>${escHtml(s.loreText || '')}</textarea>
        ${counterHTML('sp-c-ltext', TEXT_MAX, (s.loreText || '').length)}</div>`;
    help = SP_COPY.add.loreHelp;
  }
  const err = s.error ? `<div class="sp-err" role="alert">${escHtml(s.error)}</div>` : '';
  // B3 — a NEW instruction at the cap would be the 16th rule: say so, and do not offer to send it. (A correction is net zero; facts and lore are not rules.)
  const capBlocked = !!atCap && s.tab === 'instruction' && !corr;
  const capLine = capBlocked ? `<div class="text-muted text-xs" role="note">${escHtml(SP_COPY.capNote)}</div>` : '';
  const submitLabel = busy ? SP_COPY.add.submitting : corr ? SP_COPY.add.correctSubmit : SP_COPY.add.submit;
  return `${tabBar}${fields}<p class="text-muted text-xs sp-help">${escHtml(help)}</p>${capLine}${err}
    <div class="sp-actions sp-actions-sheet">
      <button type="button" class="btn btn-secondary sp-btn" data-sp-act="sheet-cancel"${busy ? ' disabled' : ''}>${escHtml(SP_COPY.add.cancel)}</button>
      <button type="button" class="btn btn-primary sp-btn" data-sp-act="sheet-submit" id="sp-submit"${busy || s.invalid || capBlocked ? ' disabled' : ''}${busy ? ' aria-busy="true"' : ''}>${escHtml(submitLabel)}</button>
    </div>`;
}

/** Standards (DI-647): read-only. `dials` = { heat, participation, learning } labels from this league's settings. */
export function standardsSheetBodyHTML(standards, dials, { escHtml }) {
  need(escHtml, 'standardsSheetBodyHTML');
  const st = standards || {};
  const list = (items) => `<ul class="sp-ul">${(items || []).map((t) => `<li>${escHtml(t)}</li>`).join('')}</ul>`;
  const rules = (st.hardRules || []).map((r) => `<li><strong>${escHtml(r.headline)}</strong> ${escHtml(r.detail)}</li>`).join('');
  const d = st.dials || {};
  const co = d.participation && d.participation.deadlineCalloutsPerLock
    ? Object.entries(d.participation.deadlineCalloutsPerLock).map(([k, v]) => `${k.replace(/^./, (c) => c.toUpperCase())} ${num(v)}`).join(', ') : '';
  return `<p class="text-muted text-xs">Version ${escHtml(st.version || '')}. Read-only: these are how SCRIBE behaves, not league knowledge. Change them only through the written standards.</p>
    <h4 class="sp-h4">Voice</h4><p class="sp-body">${escHtml(st.voice || '')}</p>
    <h4 class="sp-h4">Hard rules (always)</h4><ol class="sp-ol">${rules}</ol>
    <h4 class="sp-h4">When SCRIBE may speak up</h4>${list(st.triggers)}
    <h4 class="sp-h4">Dials in this league</h4>
    <p class="sp-body">Heat: <strong>${escHtml(dials.heat || '')}</strong> · Participation: <strong>${escHtml(dials.participation || '')}</strong> · Learning: <strong>${escHtml(dials.learning || '')}</strong></p>
    <p class="text-muted text-xs">${escHtml((d.heat && d.heat.note) || '')} ${escHtml((d.participation && d.participation.note) || '')}${co ? ` Deadline call-outs per lock: ${escHtml(co)}.` : ''}</p>
    <h4 class="sp-h4">How SCRIBE remembers</h4>${list(st.memoryRules)}
    <h4 class="sp-h4">What learnings can and cannot do</h4>${list(st.trainerLimits)}
    <h4 class="sp-h4">What you can change</h4><p class="sp-body">${escHtml(st.changeable || '')}</p>
    <div class="sp-actions sp-actions-sheet"><button type="button" class="btn btn-primary sp-btn" data-sp-act="sheet-cancel">Done</button></div>`;
}

/**
 * The detail sheet for one ACTIVE rule (B1): full text, where it came from, its history, and the row's actions — Correct (only for a rule with a writable category, N4), Keep (only for a rule no
 * person has approved yet) and Turn off. `opts.keep` is the Keep request's own state (`{ phase: 'saving' | 'failed' }`), `row.ui` the Turn off's.
 */
export function ruleDetailSheetBodyHTML(row, historyLines, { escHtml }, { canEdit = true, keep = null } = {}) {
  need(escHtml, 'ruleDetailSheetBodyHTML');
  const ui = row.ui || {};
  const saving = ui.phase === 'saving';
  const failed = ui.phase === 'failed';
  const keeping = !!keep && keep.phase === 'saving';
  const keepFailed = !!keep && keep.phase === 'failed';
  const label = saving ? 'Saving…' : failed ? SP_COPY.retry : 'Turn off';
  const keepBlocked = !!row.capBlocked;
  const hist = (historyLines || []).length
    ? `<h4 class="sp-h4">History</h4><ul class="sp-ul">${historyLines.map((l) => `<li>${escHtml(l.sentence)} <span class="text-muted">· ${escHtml(l.when)}</span></li>`).join('')}</ul>` : '';
  const err = failed ? `<div class="sp-err" role="alert">${escHtml(SP_COPY.toggleSaveFailed)}</div>` : '';
  const keepErr = keepFailed ? `<div class="sp-err" role="alert">${escHtml(keep.message || SP_COPY.toggleSaveFailed)}</div>` : '';
  const why = canEdit && row.keepable ? `<p class="text-muted text-xs">${escHtml(SP_COPY.keepWhy)}</p>` : '';
  const capLine = canEdit && row.keepable && keepBlocked ? `<p class="text-muted text-xs" role="note">${escHtml(SP_COPY.capNote)}</p>` : '';
  const correctBtn = row.correctable ? '<button type="button" class="btn btn-secondary sp-btn" data-sp-act="detail-correct">Correct</button>' : '';
  const keepBtn = row.keepable
    ? `<button type="button" class="btn btn-secondary sp-btn" data-sp-act="detail-keep"${keeping || saving || keepBlocked ? ' disabled' : ''}${keeping ? ' aria-busy="true"' : ''}>${escHtml(keeping ? 'Keeping…' : keepFailed ? SP_COPY.retry : 'Keep')}</button>` : '';
  return `${pillsHTML(row, { escHtml })}
    <p class="sp-body sp-body-lg">${escHtml(row.text)}</p>
    ${metaHTML(row, { escHtml })}
    ${why}${hist}${err}${keepErr}${capLine}
    ${canEdit ? `<div class="sp-actions sp-actions-sheet">
      ${correctBtn}${keepBtn}
      <button type="button" class="btn btn-primary sp-btn sp-toggle" data-sp-act="detail-toggle"${saving || keeping ? ' disabled' : ''}${saving ? ' aria-busy="true"' : ''}>${escHtml(label)}</button>
    </div>` : '<div class="sp-actions sp-actions-sheet"><button type="button" class="btn btn-primary sp-btn" data-sp-act="sheet-cancel">Done</button></div>'}`;
}

/** The detail sheet for one LORE entry: the text and Correct / Remove. */
export function loreDetailSheetBodyHTML(entry, { escHtml }, { busy = false, error = '', confirmRemove = false } = {}) {
  need(escHtml, 'loreDetailSheetBodyHTML');
  return `<div class="sp-item-head"><span class="sp-pill">${escHtml(entry.key)}</span></div>
    <p class="sp-body sp-body-lg">${escHtml(entry.text)}</p>
    <div class="sp-meta">${escHtml(loreAddedByLine(entry))} · ${escHtml(whenFull(entry.updatedAt))}</div>
    ${error ? `<div class="sp-err" role="alert">${escHtml(error)}</div>` : ''}
    ${confirmRemove
    ? `<p class="text-muted text-xs">Remove this entry? SCRIBE stops referring to it. It stays in History.</p>
       <div class="sp-actions sp-actions-sheet"><button type="button" class="btn btn-secondary sp-btn" data-sp-act="lore-remove-cancel"${busy ? ' disabled' : ''}>Keep it</button>
       <button type="button" class="btn btn-primary sp-btn" data-sp-act="lore-remove-confirm"${busy ? ' disabled aria-busy="true"' : ''}>${busy ? 'Removing…' : 'Remove'}</button></div>`
    : `<div class="sp-actions sp-actions-sheet"><button type="button" class="btn btn-secondary sp-btn" data-sp-act="lore-correct">Correct</button>
       <button type="button" class="btn btn-secondary sp-btn" data-sp-act="lore-remove">Remove</button></div>`}`;
}

/** The player sheet: the facts SCRIBE holds (each with where it came from and Remove where it may), the player's own limits (read-only), and Add a fact. */
export function playerSheetBodyHTML(player, { escHtml }, { canEdit = true, busyKey = '', error = '' } = {}) {
  need(escHtml, 'playerSheetBodyHTML');
  const facts = (player.facts || []).map((f) => `<div class="sp-item">
      <div class="sp-body"><strong>${escHtml(f.key)}</strong>: ${escHtml(f.text)}</div>
      <div class="sp-meta">${escHtml(provenanceLabel(f.provenance))}${f.at ? ` · ${escHtml(when(f.at))}` : ''}</div>
      ${canEdit && isRemovableFact(f) ? `<div class="sp-actions sp-actions-start"><button type="button" class="btn btn-secondary sp-btn" data-sp-act="fact-remove" data-sp-key="${escHtml(f.key)}"${busyKey === f.key ? ' disabled aria-busy="true"' : ''}>${busyKey === f.key ? 'Removing…' : 'Remove'}</button></div>` : ''}
    </div>`).join('');
  return `<h4 class="sp-h4">Facts SCRIBE holds</h4>
    ${facts ? `<div class="sp-list">${facts}</div>` : '<p class="text-muted text-xs">No facts yet.</p>'}
    ${error ? `<div class="sp-err" role="alert">${escHtml(error)}</div>` : ''}
    <h4 class="sp-h4">Their own limits (read-only)</h4>
    <p class="sp-body">Roast limit: ${escHtml(toleranceLabel(player.tolerance))} · ${num(player.boundaryCount)} ${player.boundaryCount === 1 ? 'boundary' : 'boundaries'}</p>
    <p class="text-muted text-xs">${escHtml(SP_COPY.footPlayers)}</p>
    <div class="sp-actions sp-actions-sheet">
      ${canEdit ? '<button type="button" class="btn btn-secondary sp-btn" data-sp-act="fact-add">Add a fact</button>' : ''}
      <button type="button" class="btn btn-primary sp-btn" data-sp-act="sheet-cancel">Done</button>
    </div>`;
}
