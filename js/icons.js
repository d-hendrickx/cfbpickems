/**
 * js/icons.js — the Munera inline-SVG icon family (DI-329/DI-330, AD-93).
 *
 * ONE frozen map of named, hand-authored inline SVG strings plus ONE helper
 * that resolves accessibility attributes — the same pattern AD-20 already
 * enforces for team shorthand ("one shared source, never a second mapping"),
 * extended here from abbreviation strings to icon markup.
 *
 * Shape, exactly matching the shipped bottom-nav SVG convention (AD-21,
 * index.html:216-242): `viewBox="0 0 24 24" fill="none"
 * stroke="currentColor" stroke-width="2" stroke-linecap="round"
 * stroke-linejoin="round"`. No icon font. No library. No CDN. No build step —
 * every entry below is literal markup, typed by hand, the same nature as the
 * emoji spans it replaces (CONVENTIONS #16's own rationale, now the AD-93
 * chrome-wide rule instead of the nav-only exception).
 *
 * CHROME VS. TEXT (DI-329b): this map exists for chrome — page headers, nav,
 * buttons, badges, form labels, card titles, panel tabs, status pills,
 * drawer rows, empty-state glyphs. It is never used for chat messages,
 * SCRIBE's generated lines, Rules-tab prose, release-notes copy, or any
 * player-typed content — those stay emoji, permanently (AD-93).
 *
 * WIRING WINDOW (this pass, UX Revamp Group E, 2026-09-25): this file ships
 * the Phase 1 icon set (DI-330) and the `icon()` helper. It does NOT yet
 * replace any emoji in `js/app.js` or `index.html` — those files are
 * SHARED-SERIALIZED territory claimed by other groups this pass. See
 * `iconstest.mjs`'s header comment and this DI's own §5 for the exact
 * call-site list (js/app.js line numbers) a future wiring pass converts.
 *
 * Phase 2 (the ~112-emoji backlog) is not started here — DI-330's own table
 * is the reference when that work is scheduled.
 */

// ─── Phase 1 icon set (DI-330) ────────────────────────────────────────────

export const ICONS = {
  // T-09a — replaces 🔔 (notification-settings bell). index.html:184.
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 3.5 1.2 5.2 2 6.2.4.5 0 1.3-.6 1.3H4.6c-.6 0-1-.8-.6-1.3.8-1 2-2.7 2-6.2Z"/><path d="M9.5 18a2.5 2.5 0 0 0 5 0"/></svg>',

  // T-09c — replaces ⭐ across all 9 Alma Mater Watch call sites (DI-330).
  // A laurel sprig: one stem, two mirrored pairs of curved leaf strokes,
  // reusing the branding profile's own "Palma"/laurel vocabulary. Every one
  // of the 9 sites converts together in the same future batch — this entry
  // is the single source all 9 will read.
  almaMater: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V5"/><path d="M12 15c2.5 0 4.5-1.8 4.5-4.5"/><path d="M12 9c2.2 0 4-1.6 4-4"/><path d="M12 15c-2.5 0-4.5-1.8-4.5-4.5"/><path d="M12 9c-2.2 0-4-1.6-4-4"/></svg>',

  // T-16 — supplied to group A's bottom-nav DI for the new Settings slot
  // (D-3). A three-row "sliders" glyph — deliberately NOT a gear/cog, so its
  // silhouette never collides with the existing Commissioner nav icon
  // (circle + radiating lines, index.html:233), which already reads as a
  // gear/sun shape. This group supplies the icon design only; T-16 owns
  // placement inside index.html's nav markup.
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="6" x2="20" y2="6"/><circle cx="9" cy="6" r="2"/><line x1="4" y1="12" x2="20" y2="12"/><circle cx="15" cy="12" r="2"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="11" cy="18" r="2"/></svg>',

  // ── Coordinator follow-up, 2026-09-25 (league-cards surface, not a DI-330
  // Phase 1 item) — same convention as everything above. ──────────────────

  // Replaces literal '›' on the new league cards.
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>',

  // Replaces literal '‹' on the new league cards.
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 6 9 12 15 18"/></svg>',

  // A football outline: an ellipse rotated ~45° with a short lace line (one
  // long diagonal stitch plus three short cross-ticks) — monochrome, stroke
  // only, no fill, same 24-box/2px-stroke spec as every other entry here.
  sportFootball: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="12" rx="9" ry="5" transform="rotate(45 12 12)"/><line x1="8" y1="16" x2="16" y2="8"/><line x1="9.5" y1="14.5" x2="10.5" y2="13.5"/><line x1="11.5" y1="12.5" x2="12.5" y2="11.5"/><line x1="13.5" y1="10.5" x2="14.5" y2="9.5"/></svg>',

  // ── Coordinator follow-up, 2026-09-25 (commissioner/admin panel tab
  // glyphs) — same convention as everything above. ─────────────────────────

  // A calendar body with a header divider and one highlighted week row
  // (drawn as an inset outline rectangle, not a fill — this family never
  // fills). Two ring stems on top, matching the familiar calendar glyph.
  calendarWeek: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="7" y1="2.5" x2="7" y2="6"/><line x1="17" y1="2.5" x2="17" y2="6"/><rect x="5.5" y="13" width="13" height="4" rx="1"/></svg>',

  // Two overlapping person outlines (head + shoulder arc each) — a
  // conventional "group of players" glyph, distinct in silhouette from
  // `almaMater` (laurel) and `settings` (sliders).
  playersGroup: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3"/><path d="M4 19c0-3 2-5 5-5s5 2 5 5"/><circle cx="16.5" cy="9" r="2.3"/><path d="M14.8 19c.3-2.3 1.9-4 3.9-4 2 0 3.5 1.5 3.8 3.7"/></svg>',

  // Reuses the exact shape the bottom-nav's own pre-D-3 Rules icon used
  // (clipboard/book + three text lines) — D-3 freed this slot when the nav's
  // Rules tab became Settings, so this is a Reuse call, not a new design:
  // the admin panel's "rulebook" tab is conceptually the same object.
  rulebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="4" width="14" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3" rx="1"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/></svg>',

  // A monochrome four-point sparkle/spark — SCRIBE's tab glyph. Deliberately
  // not a literal quill (too fine-detailed to read at nav/tab sizes, per
  // DI-329's own legibility note) and never an emoji (AD-93). One closed
  // stroke path, fill:none like every entry in this family.
  scribeSpark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5c.6 4 2.4 5.8 6.4 6.4-4 .6-5.8 2.4-6.4 6.4-.6-4-2.4-5.8-6.4-6.4 4-.6 5.8-2.4 6.4-6.4Z"/></svg>',

  // A cloud outline with a short base line beneath (sync/data-at-rest
  // reading) — for a "Data" admin tab (backend/export/sync surfaces).
  cloudData: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.5-7.96A5 5 0 0 1 16.2 8.1 4.5 4.5 0 0 1 17 17H7Z"/><line x1="9" y1="21" x2="15" y2="21"/></svg>',

  // A shield outline with an inset checkmark — for an "Admin"/permissions
  // tab. Distinct silhouette from `almaMater`'s laurel and from the existing
  // Commissioner nav icon (circle + radiating lines).
  shieldAdmin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3Z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/></svg>',

  // ── F8 (WIRING_CHECKLIST_B_092526.md) — icon inventory on rows/lists that
  // now mix families: `renderSourceBadge()`'s data-quality chips, the
  // Data Source Mode `<select>` options, and the game-filter chip labels.
  // Same convention as everything above. ────────────────────────────────

  // A clipboard outline (no fill, no checklist detail — keeps this
  // silhouette distinct from `rulebook`, which is a bound book). Replaces
  // 📋 (Demo data source / Demo Week badge).
  clipboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="12" height="17" rx="2"/><rect x="9" y="2.5" width="6" height="3" rx="1"/></svg>',

  // A map-pin outline. Replaces 📌 (Proposed data-quality badge).
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',

  // A pencil outline. Replaces ✏️ (Manual data source).
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-4.5L15.5 5 19 8.5 8.5 19 4 20Z"/><line x1="13.5" y1="6.5" x2="17.5" y2="10.5"/></svg>',

  // A television outline (screen + short stand). Replaces 📺 (National TV
  // badge/filter chip).
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="13" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="18" x2="12" y2="21"/></svg>',

  // REVIEWER BLOCK 4 (pass-2, 2026-09-25) — a triangle-exclamation outline,
  // added because `renderSourceBadge()`'s `partial` data-quality state had
  // no glyph in the F8 inventory above. Replaces ⚠️ (Partial data-quality
  // badge) — the one BLOCK 4 named explicitly as possibly needed.
  warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 21.5 20h-19L12 3.5Z"/><line x1="12" y1="9.5" x2="12" y2="13.5"/><line x1="12" y1="16.6" x2="12" y2="16.7"/></svg>',

  // ── STEP B(14) (3c fix window, third pass) — the week wizard's status
  // buttons (js/week-wizard.js FULL_STATUS_BUTTONS), D-1 phase 2. Same
  // convention as everything above. Replaces 📢 🔒 🔓 ▶️ ⏸ ✅ ↩ in that one
  // chrome surface. ──────────────────────────────────────────────────────
  // A megaphone (horn + handle + one sound arc). Replaces 📢 (Open for Picks).
  megaphone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10v4h3l9 5V5L7 10H4Z"/><line x1="7.5" y1="14.5" x2="9" y2="19.5"/><path d="M19.5 9.5a3.5 3.5 0 0 1 0 5"/></svg>',
  // A closed padlock. Replaces 🔒 (Lock Week).
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 8 0V11"/></svg>',
  // An open padlock (shackle swung up and off). Replaces 🔓 (Re-open Picks).
  unlock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7.5a4 4 0 0 1 7.6-1.8"/></svg>',
  // A play triangle. Replaces ▶️ (Go Live).
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 5.5v13l10.5-6.5L8 5.5Z"/></svg>',
  // Two bars. Replaces ⏸ (Pause / Re-lock).
  pause: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="9" y1="5.5" x2="9" y2="18.5"/><line x1="15" y1="5.5" x2="15" y2="18.5"/></svg>',
  // A check mark. Replaces ✅ (Finalize).
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="5 12.5 10 17.5 19 7"/></svg>',
  // A curved back arrow. Replaces ↩ (Back to Draft / Reopen).
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 14.5 4 9.5 9 4.5"/><path d="M4 9.5h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',

  // ── Reviewer round 3, item 5 (2026-09-26) — same convention as everything
  // above. Replaces 🔄 (Rotate Code, invite-card). ─────────────────────────
  // Two opposing arcs each with an arrowhead — the standard "cycle/refresh"
  // silhouette, chosen deliberately close to 🔄's own two-arrow shape so the
  // swap reads as the same idea, not a different one.
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0 1 14.5-4.5"/><polyline points="18.5 3 18.5 8 13.5 8"/><path d="M20 12a8 8 0 0 1-14.5 4.5"/><polyline points="5.5 21 5.5 16 10.5 16"/></svg>',

  // ── Full-app review, Step 6 (2026-09-26) — same convention. Replaces the
  // literal ✕ on the control-center drawer's close button (control-center.js
  // file header: "an owed glyph") and the backend-error banner's Dismiss. Two
  // strokes, the standard close silhouette.
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>',

  // Phase 2 entries added incrementally, same shape — see DI-330's backlog
  // table (design-matrix-pm's §6) for the ordered candidate list.
};

/**
 * Resolve an icon by name to a ready-to-inject SVG string.
 *
 * Default: `aria-hidden="true" focusable="false"` — decorative, paired with
 * adjacent visible text (matches the shipped nav-SVG convention exactly,
 * index.html:216-242, every one of which already carries these two
 * attributes because visible text sits beside every nav icon today).
 *
 * `{ label }`: for the rare case an icon stands alone with no visible text
 * beside it — returns `role="img" aria-label="<label>"` instead.
 *
 * Unknown name: warns once via console.warn and returns '' rather than
 * throwing, so a typo'd call site degrades to "no icon" instead of a crash.
 */
// SECURITY N2 (pass-2 security-reviewer, 2026-09-25) — `label` used to be
// interpolated RAW into `aria-label="${label}"`, an unescaped attribute-value
// sink (a `"` in the label would break out of the attribute). This module
// deliberately imports nothing (see the header comment: "no icon font, no
// library, no CDN, no build step" — every entry is literal, hand-authored
// markup), so rather than pull in `escHtml()` from elsewhere and create an
// import edge this module has never had, a tiny LOCAL escaper covers the one
// attribute-value context this function ever writes into. Every current
// call site passes a hardcoded string literal (grep-verified — no caller
// passes user data today), but the fence belongs on the sink, not on trust
// in today's callers.
function _escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function icon(name, { label } = {}) {
  const svg = ICONS[name];
  if (!svg) {
    console.warn(`[icons] unknown icon "${name}"`);
    return '';
  }
  return label
    ? svg.replace('<svg ', `<svg role="img" aria-label="${_escAttr(label)}" `)
    : svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" ');
}
