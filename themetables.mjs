/**
 * CFB Pickems — themetables.mjs (SP-52 DI-456: the conformance data for themetest.mjs [T3])
 * ============================================================================
 * DESIGN_INPUTS_THEMES_093026.md Tables 1 to 4, as DATA — machine-extracted from the design input (so there is no hand-typing to get
 * wrong) and then amended exactly where the coordinator amended it. The test compares what the REAL cascade returns (themeresolve.mjs)
 * to these values, side by side, so a value changed in css/styles.css and not here (or the reverse) is RED.
 *
 * Columns, Tables 1-3:  'neutral:L' 'neutral:D'  (Munera)   'paper:L' 'paper:D' (Paper, PAGE context) 'paper:Dscope' (what the paper scope
 *                       re-declares on card-like containers)   'ink:L' 'ink:D'   'graphite:L' 'graphite:D'.   null = "—" = not declared on
 *                       that side (inherited, or read through a var() fallback — R2).
 * Tables 4L / 4D:       one column per school key.
 *
 * AMENDMENTS APPLIED ON TOP OF THE EXTRACTION (each dated, each from the coordinator):
 *   - Table 4L, 2026-10-01 (AA correction, SB-10 reviewer): --maroon-light-text for sooner / trojan / razorback = the school's own
 *     --maroon-mid (#9C1F20 / #B30000 / #B22842); the original --maroon-light values failed AA on the admin section-title hover.
 *   - A1.6 / A1.7 (SB-17): --pick-live-cover-text / --pick-live-trail-text (Light #2D6B1A / #8B1A1A; Dark #4ADE80 / #DD9292; Paper's scope
 *     takes the LIGHT pair; Graphite Dark's own values are the Dark pair — it measures >= 4.5 on every Graphite surface).
 *   - A1.8 (SB-18): --readiness-warn-text / --readiness-incomplete-text (Light #8A5A00 / #9A1C1C; Dark #BC9839 / #F87171; same per-look
 *     rule).
 *   - Coordinator review 2026-09-30, ADOPTED: Paper Dark's paper-scope --win is #16703A (#1A7A3F is 4.25:1 on the paper inset #E8E4DC).
 *   - A1.9 (SP-52 build review, coordinator 2026-10-01; inline AA amendment, governs where it differs):
 *       F1  every Dark accent-text value lifted one step (hue kept) until it clears 4.5:1 on the lifted inset #332C25 (advisory 1 WITHDRAWN):
 *           Munera/Ink/Paper-page #E86464/#E86467/#DE6E6F -> #EA7272/#EA7073/#E07879; Aggie+Trojan #DF6A6A -> #E27676; Oklahoma #DF6A6C -> #E27678;
 *           Notre Dame #5490DB -> #6199DE; Arkansas #DE697B -> #E17585 (Purdue #CEB888 already 7.09:1). --chrome-tab-icon-selected is a separate
 *           role (an icon at 3:1 on the tab bar) and is NOT lifted.
 *       F3a Notre Dame Dark declares --on-accent-gold #E8BE45 (.pts-label 4.26 -> 4.79);   F3b Paper Light --maroon-light-text #A6191C (4.05 -> 5.27);
 *       F3c Paper Dark scope --live-text #C81E1E;   F3d Paper Dark scope --nd-text #6E5F50 and --loss #A81717;
 *       F3e (.badge-draft reads --bg-card-alt; a CSS consumer change, no token).
 *   - A1.10 (SB-21, coordinator 2026-10-01): --chat-new-text, Chat's "NEW" unread divider (Light #B02A37, unchanged; Dark #DE747E — #B02A37's
 *     hue and saturation with only the lightness lifted — on Block A, Paper Dark's page block and Graphite Dark; Paper's light scope takes the
 *     LIGHT value, the A1.7 rule; never in the school pairs). Same amendment: .chat-surface joins the paper-scope root list (DI-450).
 *   - A1.11 (SP-57 x SP-52, coordinator 2026-10-01, v0.29.0 batch-5b integration): --shadow-lift, the section-drag lift shadow. Light is unchanged
 *     (:root's 0 14px 32px rgba(20,17,14,.28), inherited by every look); Dark is SP-57's 0 14px 32px rgba(0,0,0,.5) beside --shadow-btn in Block A,
 *     Paper Dark's page block and Graphite Dark (both triggers); never in the paper scope (null, [T10]); the schools inherit Munera's.
 */
export const TABLES = {
 t1: {
  "--chrome-bg": {"neutral:L":"#8C1515","neutral:D":"#8C1515","paper:L":"#8C1515","paper:D":"#8C1515","ink:L":"#14110E","ink:D":"#14110E","graphite:L":"#FFFFFF","graphite:D":"#1C1C1E"},
  "--chrome-fg": {"neutral:L":"#FFFFFF","neutral:D":"#FFFFFF","paper:L":"#FFFFFF","paper:D":"#FFFFFF","ink:L":"#FFFFFF","ink:D":"#FFFFFF","graphite:L":"#14110E","graphite:D":"#FFFFFF"},
  "--chrome-mark": {"neutral:L":"#FFFFFF","neutral:D":"#FFFFFF","paper:L":"#FFFFFF","paper:D":"#FFFFFF","ink:L":"#FFFFFF","ink:D":"#FFFFFF","graphite:L":"#14110E","graphite:D":"#D4A017"},
  "--chrome-fg-dim": {"neutral:L":"rgba(255,255,255,.75)","neutral:D":"rgba(255,255,255,.75)","paper:L":"rgba(255,255,255,.75)","paper:D":"rgba(255,255,255,.75)","ink:L":"rgba(255,255,255,.75)","ink:D":"rgba(255,255,255,.75)","graphite:L":"rgba(20,17,14,.75)","graphite:D":"rgba(255,255,255,.75)"},
  "--chrome-fg-faint": {"neutral:L":"rgba(255,255,255,.6)","neutral:D":"rgba(255,255,255,.6)","paper:L":"rgba(255,255,255,.6)","paper:D":"rgba(255,255,255,.6)","ink:L":"rgba(255,255,255,.6)","ink:D":"rgba(255,255,255,.6)","graphite:L":"rgba(20,17,14,.6)","graphite:D":"rgba(255,255,255,.6)"},
  "--chrome-pill-bg": {"neutral:L":"rgba(255,255,255,.15)","neutral:D":"rgba(255,255,255,.15)","paper:L":"rgba(255,255,255,.15)","paper:D":"rgba(255,255,255,.15)","ink:L":"rgba(255,255,255,.15)","ink:D":"rgba(255,255,255,.15)","graphite:L":"rgba(20,17,14,.06)","graphite:D":"rgba(255,255,255,.15)"},
  "--chrome-pill-border": {"neutral:L":"rgba(255,255,255,.4)","neutral:D":"rgba(255,255,255,.4)","paper:L":"rgba(255,255,255,.4)","paper:D":"rgba(255,255,255,.4)","ink:L":"rgba(255,255,255,.4)","ink:D":"rgba(255,255,255,.4)","graphite:L":"rgba(20,17,14,.25)","graphite:D":"rgba(255,255,255,.4)"},
  "--chrome-sync-busy": {"neutral:L":null,"neutral:D":null,"paper:L":null,"paper:D":null,"ink:L":null,"ink:D":null,"graphite:L":"#6E5419","graphite:D":null},
  "--chrome-rule": {"neutral:L":"#D4A017","neutral:D":"#D4A017","paper:L":"#D4A017","paper:D":"#D4A017","ink:L":"#D4A017","ink:D":"#D4A017","graphite:L":"#D1D1D6","graphite:D":"#38383A"},
  "--chrome-rule-w": {"neutral:L":"3px","neutral:D":"3px","paper:L":"3px","paper:D":"3px","ink:L":"3px","ink:D":"3px","graphite:L":"1px","graphite:D":"1px"},
  "--chrome-shadow": {"neutral:L":"0 2px 12px rgba(80,0,0,.25)","neutral:D":"0 2px 12px rgba(80,0,0,.25)","paper:L":"0 2px 12px rgba(80,0,0,.25)","paper:D":"0 2px 12px rgba(80,0,0,.25)","ink:L":"0 2px 12px rgba(0,0,0,.35)","ink:D":"0 2px 12px rgba(0,0,0,.35)","graphite:L":"none","graphite:D":"none"},
  "--chrome-tab-bg": {"neutral:L":"#FFFFFF","neutral:D":"#2B2520","paper:L":"#FFFFFF","paper:D":"#2B2520","ink:L":"#14110E","ink:D":"#2B2520","graphite:L":"#FFFFFF","graphite:D":"#1C1C1E"},
  "--nav-material": {"neutral:L":"rgba(255,255,255,.72)","neutral:D":"rgba(43,37,32,.72)","paper:L":"rgba(255,255,255,.72)","paper:D":"rgba(43,37,32,.92)","ink:L":"rgba(20,17,14,.88)","ink:D":"rgba(43,37,32,.72)","graphite:L":"rgba(255,255,255,.72)","graphite:D":"rgba(28,28,30,.72)"},
  "--chrome-tab-border": {"neutral:L":null,"neutral:D":"#463D33","paper:L":null,"paper:D":null,"ink:L":"#14110E","ink:D":"#463D33","graphite:L":null,"graphite:D":null},
  "--chrome-tab-icon": {"neutral:L":"#777573","neutral:D":"#A6A3A1","paper:L":"#777573","paper:D":"#A6A3A1","ink:L":"#9C9B9A","ink:D":"#A6A3A1","graphite:L":"#777573","graphite:D":"#A0A0A1"},
  "--chrome-tab-icon-selected": {"neutral:L":"#8C1515","neutral:D":"#E86464","paper:L":"#8C1515","paper:D":"#D4A017","ink:L":"#E8C96A","ink:D":"#E86464","graphite:L":"#1C1C1E","graphite:D":"#F2F2F7"},
 },
 t2: {
  "--bg": {"neutral:L":"#E8E4DC","neutral:D":"#14110E","paper:L":"#DDD7CA","paper:D":"#14110E","paper:Dscope":"#F2EFE9","ink:L":"#E8E4DC","ink:D":"#14110E","graphite:L":"#F2F2F7","graphite:D":"#000000"},
  "--bg-card": {"neutral:L":"#FFFFFF","neutral:D":"#25201B","paper:L":"#FFFFFF","paper:D":"#25201B","paper:Dscope":"#F2EFE9","ink:L":"#FFFFFF","ink:D":"#25201B","graphite:L":"#FFFFFF","graphite:D":"#1C1C1E"},
  "--bg-card-alt": {"neutral:L":"#F2EFE9","neutral:D":"#332C25","paper:L":"#F2EFE9","paper:D":"#332C25","paper:Dscope":"#E8E4DC","ink:L":"#F3F3F3","ink:D":"#332C25","graphite:L":"#F2F2F7","graphite:D":"#2C2C2E"},
  "--bg-input": {"neutral:L":"#F2EFE9","neutral:D":"#332C25","paper:L":"#F2EFE9","paper:D":"#332C25","paper:Dscope":"#E8E4DC","ink:L":"#F3F3F3","ink:D":"#332C25","graphite:L":"#F2F2F7","graphite:D":"#2C2C2E"},
  "--bg-game": {"neutral:L":"#FFFFFF","neutral:D":"#2B2520","paper:L":"#FFFFFF","paper:D":"#2B2520","paper:Dscope":"#F2EFE9","ink:L":"#FFFFFF","ink:D":"#2B2520","graphite:L":"#FFFFFF","graphite:D":"#2C2C2E"},
  "--game-edge": {"neutral:L":null,"neutral:D":"#D4A017","paper:L":null,"paper:D":null,"paper:Dscope":null,"ink:L":null,"ink:D":"#D4A017","graphite:L":null,"graphite:D":null},
  "--border": {"neutral:L":"#D3CBBB","neutral:D":"#463D33","paper:L":"#CFC6B4","paper:D":"#463D33","paper:Dscope":"#D3CBBB","ink:L":"#DEDEDD","ink:D":"#463D33","graphite:L":"#D1D1D6","graphite:D":"#38383A"},
  "--border-strong": {"neutral:L":"#C3BAA5","neutral:D":"#5A4F42","paper:L":"#B9AF99","paper:D":"#5A4F42","paper:Dscope":"#C3BAA5","ink:L":"#C9C9C7","ink:D":"#5A4F42","graphite:L":"#C7C7CC","graphite:D":"#48484A"},
  "--text-primary": {"neutral:L":"#14110E","neutral:D":"#EEE9E0","paper:L":"#14110E","paper:D":"#E8E4DC","paper:Dscope":"#14110E","ink:L":"#14110E","ink:D":"#EEE9E0","graphite:L":"#000000","graphite:D":"#FFFFFF"},
  "--text-secondary": {"neutral:L":"#4A3F35","neutral:D":"#CFC6B8","paper:L":"#4A3F35","paper:D":"#CFC6B8","paper:Dscope":"#4A3F35","ink:L":"#4A3F35","ink:D":"#CFC6B8","graphite:L":"#3C3C43","graphite:D":"#C7C7CC"},
  "--text-muted": {"neutral:L":"#6B5F53","neutral:D":"#A99E8C","paper:L":"#5A4F44","paper:D":"#A99E8C","paper:Dscope":"#6B5F53","ink:L":"#6B5F53","ink:D":"#A99E8C","graphite:L":"#6C6C70","graphite:D":"#98989F"},
  "--shadow-card": {"neutral:L":"0 1px 4px rgba(140,21,21,.05),0 4px 16px rgba(140,21,21,.07)","neutral:D":"0 1px 4px rgba(0,0,0,.35),0 4px 16px rgba(0,0,0,.45)","paper:L":"0 1px 4px rgba(20,17,14,.06),0 4px 16px rgba(20,17,14,.08)","paper:D":"0 1px 4px rgba(0,0,0,.35),0 4px 16px rgba(0,0,0,.45)","paper:Dscope":null,"ink:L":"0 1px 4px rgba(20,17,14,.05),0 4px 16px rgba(20,17,14,.07)","ink:D":"0 1px 4px rgba(0,0,0,.35),0 4px 16px rgba(0,0,0,.45)","graphite:L":"0 1px 4px rgba(0,0,0,.06),0 4px 16px rgba(0,0,0,.08)","graphite:D":"0 1px 4px rgba(0,0,0,.35),0 4px 16px rgba(0,0,0,.45)"},
  "--shadow-btn": {"neutral:L":"0 2px 8px rgba(140,21,21,.18)","neutral:D":"0 2px 8px rgba(0,0,0,.5)","paper:L":"0 2px 8px rgba(140,21,21,.18)","paper:D":"0 2px 8px rgba(0,0,0,.5)","paper:Dscope":null,"ink:L":"0 2px 8px rgba(20,17,14,.2)","ink:D":"0 2px 8px rgba(0,0,0,.5)","graphite:L":"0 2px 8px rgba(0,0,0,.18)","graphite:D":"0 2px 8px rgba(0,0,0,.5)"},
  "--shadow-lift": {"neutral:L":"0 14px 32px rgba(20,17,14,.28)","neutral:D":"0 14px 32px rgba(0,0,0,.5)","paper:L":"0 14px 32px rgba(20,17,14,.28)","paper:D":"0 14px 32px rgba(0,0,0,.5)","paper:Dscope":null,"ink:L":"0 14px 32px rgba(20,17,14,.28)","ink:D":"0 14px 32px rgba(0,0,0,.5)","graphite:L":"0 14px 32px rgba(20,17,14,.28)","graphite:D":"0 14px 32px rgba(0,0,0,.5)"},
  "color-scheme": {"neutral:L":"(light)","neutral:D":"dark","paper:L":"(light)","paper:D":"dark","paper:Dscope":"light","ink:L":"(light)","ink:D":"dark","graphite:L":"(light)","graphite:D":"dark"},
 },
 t3: {
  "--maroon": {"neutral:L":"#8C1515","neutral:D":"#8C1515","paper:L":"#8C1515","paper:D":"#8C1515","paper:Dscope":null,"ink:L":"#8C1515","ink:D":"#8C1515","graphite:L":"#1C1C1E","graphite:D":"#F2F2F7"},
  "--maroon-mid": {"neutral:L":"#A6191C","neutral:D":"#A6191C","paper:L":"#A6191C","paper:D":"#A6191C","paper:Dscope":null,"ink:L":"#A6191C","ink:D":"#A6191C","graphite:L":"#2C2C2E","graphite:D":"#E5E5EA"},
  "--maroon-light": {"neutral:L":"#BF2C2D","neutral:D":"#BF2C2D","paper:L":"#BF2C2D","paper:D":"#BF2C2D","paper:Dscope":null,"ink:L":"#BF2C2D","ink:D":"#BF2C2D","graphite:L":"#48484A","graphite:D":"#D1D1D6"},
  "--maroon-pale": {"neutral:L":"#FBF2F3","neutral:D":"#301216","paper:L":"#FBF2F3","paper:D":"#301216","paper:Dscope":"#FBF2F3","ink:L":"#FBF2F3","ink:D":"#301216","graphite:L":"#F7F7FA","graphite:D":"#2C2C2E"},
  "--maroon-tint": {"neutral:L":"#F5E2E2","neutral:D":"#3B1616","paper:L":"#F5E2E2","paper:D":"#3B1616","paper:Dscope":"#F5E2E2","ink:L":"#F5E2E2","ink:D":"#3B1616","graphite:L":"#EEEEF3","graphite:D":"#303032"},
  "--maroon-text": {"neutral:L":"#8C1515","neutral:D":"#EA7272","paper:L":"#8C1515","paper:D":"#EA7272","paper:Dscope":"#8C1515","ink:L":"#8C1515","ink:D":"#EA7272","graphite:L":"#1C1C1E","graphite:D":"#F2F2F7"},
  "--maroon-mid-text": {"neutral:L":"#A6191C","neutral:D":"#EA7073","paper:L":"#A6191C","paper:D":"#EA7073","paper:Dscope":"#A6191C","ink:L":"#A6191C","ink:D":"#EA7073","graphite:L":"#2C2C2E","graphite:D":"#E5E5EA"},
  "--maroon-light-text": {"neutral:L":"#BF2C2D","neutral:D":"#E07879","paper:L":"#A6191C","paper:D":"#E07879","paper:Dscope":"#BF2C2D","ink:L":"#BF2C2D","ink:D":"#E07879","graphite:L":"#48484A","graphite:D":"#D1D1D6"},
  "--on-accent": {"neutral:L":"#FFFFFF","neutral:D":"#FFFFFF","paper:L":"#FFFFFF","paper:D":"#FFFFFF","paper:Dscope":null,"ink:L":"#FFFFFF","ink:D":"#FFFFFF","graphite:L":"#FFFFFF","graphite:D":"#14110E"},
  "--gold": {"neutral:L":"#D4A017","neutral:D":"#D4A017","paper:L":"#D4A017","paper:D":"#D4A017","paper:Dscope":null,"ink:L":"#D4A017","ink:D":"#D4A017","graphite:L":"#D4A017","graphite:D":"#D4A017"},
  "--gold-light": {"neutral:L":"#E8C96A","neutral:D":"#E8C96A","paper:L":"#E8C96A","paper:D":"#E8C96A","paper:Dscope":null,"ink:L":"#E8C96A","ink:D":"#E8C96A","graphite:L":"#E8C96A","graphite:D":"#E8C96A"},
  "--gold-pale": {"neutral:L":"#FAF1DE","neutral:D":"#302612","paper:L":"#FAF1DE","paper:D":"#302612","paper:Dscope":"#FAF1DE","ink:L":"#FAF1DE","ink:D":"#302612","graphite:L":"#FAF1DE","graphite:D":"#302612"},
  "--gold-text": {"neutral:L":"#6E5419","neutral:D":"#E8C96A","paper:L":"#6E5419","paper:D":"#E8C96A","paper:Dscope":"#6E5419","ink:L":"#6E5419","ink:D":"#E8C96A","graphite:L":"#6E5419","graphite:D":"#E8C96A"},
  "--on-gold": {"neutral:L":"#14110E","neutral:D":"#14110E","paper:L":"#14110E","paper:D":"#14110E","paper:Dscope":null,"ink:L":"#14110E","ink:D":"#14110E","graphite:L":"#14110E","graphite:D":"#14110E"},
  "--on-accent-gold": {"neutral:L":null,"neutral:D":null,"paper:L":null,"paper:D":null,"paper:Dscope":null,"ink:L":null,"ink:D":null,"graphite:L":null,"graphite:D":"#6E5419"},
  "--win": {"neutral:L":"#1A7A3F","neutral:D":"#4ADE80","paper:L":"#1A7A3F","paper:D":"#4ADE80","paper:Dscope":"#16703A","ink:L":"#1A7A3F","ink:D":"#4ADE80","graphite:L":"#1A7A3F","graphite:D":"#4ADE80"},
  "--win-bg": {"neutral:L":"#EBF7F0","neutral:D":"#123821","paper:L":"#EBF7F0","paper:D":"#123821","paper:Dscope":"#EBF7F0","ink:L":"#EBF7F0","ink:D":"#123821","graphite:L":"#EBF7F0","graphite:D":"#123821"},
  "--loss": {"neutral:L":"#B91C1C","neutral:D":"#F87171","paper:L":"#B91C1C","paper:D":"#F87171","paper:Dscope":"#A81717","ink:L":"#B91C1C","ink:D":"#F87171","graphite:L":"#B91C1C","graphite:D":"#F87171"},
  "--loss-bg": {"neutral:L":"#FEF2F2","neutral:D":"#3B1414","paper:L":"#FEF2F2","paper:D":"#3B1414","paper:Dscope":"#FEF2F2","ink:L":"#FEF2F2","ink:D":"#3B1414","graphite:L":"#FEF2F2","graphite:D":"#3B1414"},
  "--live-trail-text": {"neutral:L":"#9A3030","neutral:D":"#D88383","paper:L":"#9A3030","paper:D":"#D88383","paper:Dscope":"#9A3030","ink:L":"#9A3030","ink:D":"#D88383","graphite:L":"#9A3030","graphite:D":"#D88383"},
  "--nd-bg": {"neutral:L":"#F5F0EA","neutral:D":"#302312","paper:L":"#F5F0EA","paper:D":"#302312","paper:Dscope":"#F5F0EA","ink:L":"#F5F0EA","ink:D":"#302312","graphite:L":"#F5F0EA","graphite:D":"#302312"},
  "--nd-text": {"neutral:L":"#7A6A5A","neutral:D":"#B68F68","paper:L":"#7A6A5A","paper:D":"#B68F68","paper:Dscope":"#6E5F50","ink:L":"#7A6A5A","ink:D":"#B68F68","graphite:L":"#7A6A5A","graphite:D":"#B68F68"},
  "--push-bg": {"neutral:L":"#FDF8EC","neutral:D":"#302712","paper:L":"#FDF8EC","paper:D":"#302712","paper:Dscope":"#FDF8EC","ink:L":"#FDF8EC","ink:D":"#302712","graphite:L":"#FDF8EC","graphite:D":"#302712"},
  "--push-text": {"neutral:L":"#C09B3A","neutral:D":"#BC9839","paper:L":"#C09B3A","paper:D":"#BC9839","paper:Dscope":"#C09B3A","ink:L":"#C09B3A","ink:D":"#BC9839","graphite:L":"#C09B3A","graphite:D":"#BC9839"},
  "--live-bg": {"neutral:L":"#FEF2F2","neutral:D":"#301212","paper:L":"#FEF2F2","paper:D":"#301212","paper:Dscope":"#FEF2F2","ink:L":"#FEF2F2","ink:D":"#301212","graphite:L":"#FEF2F2","graphite:D":"#301212"},
  "--live-text": {"neutral:L":"#DC2626","neutral:D":"#E66161","paper:L":"#DC2626","paper:D":"#E66161","paper:Dscope":"#C81E1E","ink:L":"#DC2626","ink:D":"#E66161","graphite:L":"#DC2626","graphite:D":"#E66161"},
  "--warning-text": {"neutral:L":"#7A6000","neutral:D":"#BC9839","paper:L":"#7A6000","paper:D":"#BC9839","paper:Dscope":"#7A6000","ink:L":"#7A6000","ink:D":"#BC9839","graphite:L":"#7A6000","graphite:D":"#BC9839"},
  "--pick-live-cover-text": {"neutral:L":"#2D6B1A","neutral:D":"#4ADE80","paper:L":"#2D6B1A","paper:D":"#4ADE80","paper:Dscope":"#2D6B1A","ink:L":"#2D6B1A","ink:D":"#4ADE80","graphite:L":"#2D6B1A","graphite:D":"#4ADE80"},
  "--pick-live-trail-text": {"neutral:L":"#8B1A1A","neutral:D":"#DD9292","paper:L":"#8B1A1A","paper:D":"#DD9292","paper:Dscope":"#8B1A1A","ink:L":"#8B1A1A","ink:D":"#DD9292","graphite:L":"#8B1A1A","graphite:D":"#DD9292"},
  "--readiness-warn-text": {"neutral:L":"#8A5A00","neutral:D":"#BC9839","paper:L":"#8A5A00","paper:D":"#BC9839","paper:Dscope":"#8A5A00","ink:L":"#8A5A00","ink:D":"#BC9839","graphite:L":"#8A5A00","graphite:D":"#BC9839"},
  "--readiness-incomplete-text": {"neutral:L":"#9A1C1C","neutral:D":"#F87171","paper:L":"#9A1C1C","paper:D":"#F87171","paper:Dscope":"#9A1C1C","ink:L":"#9A1C1C","ink:D":"#F87171","graphite:L":"#9A1C1C","graphite:D":"#F87171"},
  "--chat-new-text": {"neutral:L":"#B02A37","neutral:D":"#DE747E","paper:L":"#B02A37","paper:D":"#DE747E","paper:Dscope":"#B02A37","ink:L":"#B02A37","ink:D":"#DE747E","graphite:L":"#B02A37","graphite:D":"#DE747E"},
 },
 t4l: {
  "--maroon": {"aggie":"#500000","sooner":"#841617","trojan":"#990000","irish":"#0C2340","boilermaker":"#1C1410","razorback":"#9D2235"},
  "--maroon-mid": {"aggie":"#6B0000","sooner":"#9C1F20","trojan":"#B30000","irish":"#163255","boilermaker":"#2A1F18","razorback":"#B22842"},
  "--maroon-light": {"aggie":"#8C1515","sooner":"#B83A3B","trojan":"#D62828","irish":"#23477A","boilermaker":"#3F2F22","razorback":"#C84057"},
  "--maroon-pale": {"aggie":"#FAF0F0","sooner":"#FDF1F1","trojan":"#FDEFEF","irish":"#EEF2F8","boilermaker":"#F3EFEA","razorback":"#FDEFF1"},
  "--maroon-tint": {"aggie":"#F3E0E0","sooner":"#F5DCDC","trojan":"#F8D8D8","irish":"#D8E2F0","boilermaker":"#E0D6CB","razorback":"#F6D6DC"},
  "--maroon-text": {"aggie":"#500000","sooner":"#841617","trojan":"#990000","irish":"#0C2340","boilermaker":"#1C1410","razorback":"#9D2235"},
  "--maroon-mid-text": {"aggie":"#6B0000","sooner":"#9C1F20","trojan":"#B30000","irish":"#163255","boilermaker":"#2A1F18","razorback":"#B22842"},
  "--maroon-light-text": {"aggie":"#8C1515","sooner":"#9C1F20","trojan":"#B30000","irish":"#23477A","boilermaker":"#3F2F22","razorback":"#B22842"},
  "--gold": {"aggie":"#C09B3A","sooner":"#FDF9D8","trojan":"#FFCC00","irish":"#C99700","boilermaker":"#CEB888","razorback":"#FFFFFF"},
  "--gold-light": {"aggie":"#E8C96A","sooner":"#FFFCE6","trojan":"#FFDB4D","irish":"#E0B12E","boilermaker":"#E0CFA8","razorback":"#F5F5F5"},
  "--gold-pale": {"aggie":"#FDF8EC","sooner":"#FFFEF5","trojan":"#FFF7D6","irish":"#FBF3D8","boilermaker":"#F8F2E2","razorback":"#FAFAFA"},
  "--gold-text": {"aggie":"#896F29","sooner":"#837507","trojan":"#8A6E00","irish":"#8C6900","boilermaker":"#826A36","razorback":"#A85E5E"},
  "--chrome-bg": {"aggie":"#500000","sooner":"#841617","trojan":"#990000","irish":"#0C2340","boilermaker":"#1C1410","razorback":"#9D2235"},
  "--chrome-rule": {"aggie":"#C09B3A","sooner":"#FDF9D8","trojan":"#FFCC00","irish":"#C99700","boilermaker":"#CEB888","razorback":"#FFFFFF"},
  "--chrome-tab-icon-selected": {"aggie":"#500000","sooner":"#841617","trojan":"#990000","irish":"#0C2340","boilermaker":"#1C1410","razorback":"#9D2235"},
 },
 t4d: {
  "--maroon": {"aggie":"#830000","sooner":"#841617","trojan":"#990000","irish":"#153E71","boilermaker":"#3F2F22","razorback":"#9D2235"},
  "--maroon-mid": {"aggie":"#9B0000","sooner":"#9C1F20","trojan":"#B30000","irish":"#1B4D8C","boilermaker":"#4E3B2C","razorback":"#B22842"},
  "--maroon-light": {"aggie":"#B21F1F","sooner":"#B83A3B","trojan":"#D62828","irish":"#2460AA","boilermaker":"#5E4A39","razorback":"#C84057"},
  "--maroon-pale": {"aggie":"#300D0B","sooner":"#301210","trojan":"#350D0B","irish":"#141C27","boilermaker":"#2A251D","razorback":"#361518"},
  "--maroon-tint": {"aggie":"#390B09","sooner":"#391311","trojan":"#400B09","irish":"#14202F","boilermaker":"#352F24","razorback":"#41171B"},
  "--maroon-text": {"aggie":"#E27676","sooner":"#E27678","trojan":"#E27676","irish":"#6199DE","boilermaker":"#CEB888","razorback":"#E17585"},
  "--maroon-mid-text": {"aggie":"#E27676","sooner":"#E27678","trojan":"#E27676","irish":"#6199DE","boilermaker":"#CEB888","razorback":"#E17585"},
  "--maroon-light-text": {"aggie":"#E27676","sooner":"#E27678","trojan":"#E27676","irish":"#6199DE","boilermaker":"#CEB888","razorback":"#E17585"},
  "--on-accent-gold": {"aggie":null,"sooner":null,"trojan":null,"irish":"#E8BE45","boilermaker":null,"razorback":null},
  "--gold": {"aggie":"#C09B3A","sooner":"#FDF9D8","trojan":"#FFCC00","irish":"#C99700","boilermaker":"#CEB888","razorback":"#FFFFFF"},
  "--gold-light": {"aggie":"#E8C96A","sooner":"#FFFCE6","trojan":"#FFDB4D","irish":"#E0B12E","boilermaker":"#E0CFA8","razorback":"#F5F5F5"},
  "--gold-pale": {"aggie":"#2E2615","sooner":"#37342C","trojan":"#372D0C","irish":"#2F250C","boilermaker":"#302A20","razorback":"#373532"},
  "--gold-text": {"aggie":"#E8C96A","sooner":"#FFFCE6","trojan":"#FFDB4D","irish":"#E0B12E","boilermaker":"#E0CFA8","razorback":"#F5F5F5"},
  "--chrome-bg": {"aggie":"#500000","sooner":"#841617","trojan":"#990000","irish":"#0C2340","boilermaker":"#1C1410","razorback":"#9D2235"},
  "--chrome-rule": {"aggie":"#C09B3A","sooner":"#FDF9D8","trojan":"#FFCC00","irish":"#C99700","boilermaker":"#CEB888","razorback":"#FFFFFF"},
  "--chrome-tab-icon-selected": {"aggie":"#DF6A6A","sooner":"#DF6A6C","trojan":"#DF6A6A","irish":"#5490DB","boilermaker":"#CEB888","razorback":"#DE697B"},
 },
};
export const SCHOOLS = ['aggie', 'sooner', 'trojan', 'irish', 'boilermaker', 'razorback'];
export const LOOKS = ['neutral', 'paper', 'ink', 'graphite'];
export const ALL_THEME_KEYS = [...LOOKS, ...SCHOOLS];
export const ALL_TOKENS = { ...TABLES.t1, ...TABLES.t2, ...TABLES.t3 };
