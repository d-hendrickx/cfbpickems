/**
 * CFB Pickems — js/newsRules.js (Social Platform News, option A: ESPN headlines only; the SHARED PURE RULES, 2026-10-01)
 * =====================================================================================================================
 * ZERO IMPORTS, ZERO side effects, no DOM, no fetch, no storage. This is the first half of the shared rules file SP-58
 * (DESIGN_INPUTS_NEWS_SOURCES_093026.md, DI-480 6.1) names `js/newsRules.js`: the one place the text-hygiene rules live, so option B's
 * all-sources collector (an Edge function importing this file by relative path) and the client read the SAME rules. Option A builds only
 * what an ESPN-only CLIENT transport needs from that list: `stripControlAndBidi`. Everything else on SP-58's list (`parseArticleUrl(raw,
 * allowedHosts)`, the canonical-URL helpers, `dedupeKeyOf`, `SHARED_IMAGE_CDNS`) is B-only and is NOT built here.
 *
 * ── NO BETTING FILTER (Drew, 2026-10-01) ─────────────────────────────────────────────────────────────────────────────
 * SD-6 ("drop betting news") was a coordinator recommendation in the 2026-09-26 plan. Drew reversed it on 2026-10-01: "I want betting
 * news" / "ok to remove betting filter". The scored betting filter (`bettingVerdict`, `isBettingItem`, the HARD / MEDIUM / WEAK term lists)
 * was REMOVED with it, and betting headlines are kept and ranked like any other. newstest [BET-KEEP] pins that; re-adding a drop is a
 * deliberate, reviewed change, never a quiet one. When the app goes public, betting content may bear on the App Store age rating (the
 * regulatory "paused until public" list).
 *
 * iOS 15.0 safe (no Object.hasOwn, no .at(), no replaceAll).
 */

// ─── text hygiene ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Headline / description hygiene (SP-58 6.3, SC-N7): line breaks and tabs become one space, then C0 and C1 controls, DEL, the
 * zero-width and bidi-override characters (U+200B-200F, U+202A-202E, U+2066-2069), the line / paragraph separators and the BOM are
 * REMOVED, then whitespace is collapsed and trimmed. Output is plain text that is escaped again at render. Never throws.
 */
// Code-point ranges stripped from text (hex, so no invisible character ever has to be typed into this source): C0 controls, DEL + C1 controls, the
// zero-width and direction marks U+200B-U+200F, the bidi embeddings / overrides U+202A-U+202E, the bidi isolates U+2066-U+2069 and the BOM U+FEFF.
const STRIP_RANGES = [[0x00, 0x1F], [0x7F, 0x9F], [0x200B, 0x200F], [0x202A, 0x202E], [0x2066, 0x2069], [0xFEFF, 0xFEFF]];
const isStripped = (code) => { for (let i = 0; i < STRIP_RANGES.length; i++) { if (code >= STRIP_RANGES[i][0] && code <= STRIP_RANGES[i][1]) return true; } return false; };

export function stripControlAndBidi(s) {
  const input = String(s === null || s === undefined ? '' : s);
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    if (code === 0x09 || code === 0x0A || code === 0x0D || code === 0x2028 || code === 0x2029) { out += ' '; continue; }   // a line break or tab is a space, never a join
    if (isStripped(code)) continue;
    out += input.charAt(i);
  }
  return out.replace(/\s+/g, ' ').trim();
}
