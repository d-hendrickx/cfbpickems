/**
 * CFB Pickems — Data Model v10
 * Changes (v10):
 *  - Team display: "School (Mascot)" everywhere via getTeamDisplay()
 *  - homeMascot/awayMascot fields on game; backfill on createGame
 *  - formatSpread() now derives favorite from spread sign + game when missing
 *  - DEMO_GAMES, HISTORICAL_DEMO_GAMES, REAL_WEEK_1_2026_KNOWN_GAMES include mascot
 *  - TEAM_MASCOT_LOOKUP fallback for legacy data without mascot fields
 * v9 carried over:
 *  - ALMA_MATER_EXACT_PATTERNS / ALMA_MATER_EXCLUDE_PATTERNS for precise matching
 *  - DEMO_PLAYERS: alma maters + 2-letter initials
 *  - SITE_PIN: site-level access control
 *  - showInHistory flag on weeks
 */

// CATALOG, not the roster. There is no separately-editable alma-mater list
// (Drew, 2026-09-04, correcting 8ae64f4/55f8908's two-list build — verbatim:
// "the roster of alma maters... should only be comprised of schools claimed
// as alma maters by a player. If a player changes their claimed alma mater,
// this should also change everything else related to alma maters"). The
// roster is derived: the distinct, non-empty set of ACTIVE players'
// `player.almaMater` values (app.js's `claimedAlmaMaters()`) — every
// consumer (Alma Mater Watch, Rankings, the ⭐ flag, the tiebreaker
// auto-calc, the slate builder's Tier 1, the Rules tab, ESPN parse-time
// flagging) reads THAT, never this constant directly.
//
// This constant is kept as a CATALOG for two purposes only: (1) precise
// exact-match/exclude-pattern data (below) for the six schools that have it,
// so a claimed school among these six can't false-positive against a
// same-prefix sibling program (Arkansas/Arkansas State, Miami/Miami (OH)),
// and (2) the OFFLINE FALLBACK options for the player-edit alma-mater
// dropdown (js/app.js's showEditPlayerModal()) when the live ESPN team
// catalog can't be fetched — see fetchEspnTeamsList() in data-provider.js
// and getAlmaMaterMatch()'s docstring below. (Before 2026-09-04 this backed
// a free-text `<datalist>`; Drew's ruling replaced free text with a
// canonical ESPN-sourced `<select>` — "One way to protect the correct
// school naming (eg washington vs Washington state)... Do the dropdown" —
// so purpose (2) is now specifically the degraded-network path, not the
// everyday one.) It is intentionally NOT trimmed when no active player
// currently claims one of these six, so a school re-claimed later still
// gets exact-match precision.
// A player may claim ANY school, catalog or not — see getAlmaMaterMatch()'s
// docstring below for what a non-catalog claim gets (word-boundary bare-name
// matching only, no exclude-pattern protection, EXCEPT when the claim is an
// exact match for the team name being tested — see "Exact equality first"
// below, which covers every claim made through the ESPN-sourced dropdown).
export const ALMA_MATERS = ['Oklahoma', 'Texas A&M', 'USC', 'Notre Dame', 'Purdue', 'Arkansas'];

// Precise matching patterns — prevents "Arkansas State" from matching "Arkansas" etc.
// These are the exact ESPN displayName substrings that identify each alma mater.
export const ALMA_MATER_EXACT_PATTERNS = {
  'Oklahoma':   ['Oklahoma Sooners', 'Oklahoma'],          // not Oklahoma State
  'Texas A&M':  ['Texas A&M Aggies', 'Texas A&M'],
  'USC':        ['USC Trojans', 'USC', 'Southern California'], // ESPN location is often just "USC"
  'Notre Dame': ['Notre Dame Fighting Irish', 'Notre Dame'],
  'Purdue':     ['Purdue Boilermakers', 'Purdue'],         // not Purdue Fort Wayne
  'Arkansas':   ['Arkansas Razorbacks', 'Arkansas'],       // not Arkansas State, Little Rock, etc.
};

// Negative-match patterns — these teams should never match even if substring is present
export const ALMA_MATER_EXCLUDE_PATTERNS = {
  'Oklahoma':  ['Oklahoma State', 'Central Oklahoma', 'Southeastern Oklahoma', 'Northwestern Oklahoma', 'Northeastern Oklahoma'],
  'Arkansas':  ['Arkansas State', 'Arkansas-Pine Bluff', 'Arkansas-Monticello', 'Arkansas Tech', 'Arkansas-Fort Smith', 'Little Rock', 'Central Arkansas', 'UA Little Rock'],
  'USC':       ['East Carolina', 'USC Upstate', 'South Carolina Upstate'],
  'Purdue':    ['Purdue Fort Wayne', 'Purdue Northwest'],
  // Not a catalog/ALMA_MATERS school today, but the roster (the CLAIMED set —
  // app.js `claimedAlmaMaters()`, fed into calculateAlmaMaterTotal's
  // `almaMaters` param) is player-editable free text (any player can type
  // any school into their own alma-mater field) — any school name can appear
  // in the list, not just the six above. Kept here (RG-02's exact fix shape)
  // rather than in the summing loop itself, since getAlmaMaterMatch() is the
  // ONE shared matcher every alma-mater consumer in the app now goes
  // through — without this, a claimed "Miami" (FL Hurricanes) would ALSO
  // match "Miami (OH)" (RedHawks), because "Miami" is a whole, boundary-clean
  // word at the start of "Miami (OH)".
  'Miami':     ['Miami (OH)', 'Miami (Ohio)', 'Miami OH', 'Miami Ohio'],
};

// Display format: School (Mascot)
export const ALMA_MATER_DISPLAY = {
  'Oklahoma':   'Oklahoma (Sooners)',
  'Texas A&M':  'Texas A&M (Aggies)',
  'USC':        'USC (Trojans)',
  'Notre Dame': 'Notre Dame (Fighting Irish)',
  'Purdue':     'Purdue (Boilermakers)',
  'Arkansas':   'Arkansas (Razorbacks)',
};

/**
 * Fallback mascot lookup — used when game data lacks an explicit homeMascot/awayMascot
 * (e.g. legacy data, manually-added games, ESPN data parsed before v10).
 * Keyed by school name (matching homeTeam/awayTeam strings).
 */
export const TEAM_MASCOT_LOOKUP = {
  // Alma maters
  'Oklahoma':'Sooners', 'Texas A&M':'Aggies', 'USC':'Trojans',
  'Notre Dame':'Fighting Irish', 'Purdue':'Boilermakers', 'Arkansas':'Razorbacks',
  // Demo / common opponents
  'Temple':'Owls', 'Utah':'Utes', 'Missouri':'Tigers', 'Indiana':'Hoosiers',
  'Georgia':'Bulldogs', 'Clemson':'Tigers', 'Ohio State':'Buckeyes',
  'Texas':'Longhorns', 'Michigan':'Wolverines', 'Alabama':'Crimson Tide',
  'Penn State':'Nittany Lions', 'West Virginia':'Mountaineers', 'LSU':'Tigers',
  'Florida State':'Seminoles', 'Houston':'Cougars', 'Florida':'Gators',
  'Utah State':'Aggies', 'Miami (OH)':'RedHawks', 'Indiana State':'Sycamores',
  'Louisiana Tech':'Bulldogs', 'Kentucky':'Wildcats', 'Western Michigan':'Broncos',
  'Bowling Green':'Falcons', 'Nicholls':'Colonels',
  'TCU':'Horned Frogs', 'North Carolina':'Tar Heels',
};

/**
 * Format school + mascot. Falls back to TEAM_MASCOT_LOOKUP if mascot blank.
 * Examples:
 *   formatTeamName('Texas A&M', 'Aggies') => 'Texas A&M (Aggies)'
 *   formatTeamName('Oklahoma')            => 'Oklahoma (Sooners)'  (via lookup)
 *   formatTeamName('Unknown School')      => 'Unknown School'
 */
export function formatTeamName(school, mascot) {
  if (!school) return '';
  const m = (mascot && mascot.trim()) || TEAM_MASCOT_LOOKUP[school] || '';
  return m ? `${school} (${m})` : school;
}

/**
 * Get formatted team display for one side of a game.
 * Uses explicit game.homeMascot / game.awayMascot when present, else lookup, else plain.
 */
export function getTeamDisplay(game, side='home') {
  if (!game) return '';
  const school = side === 'home' ? game.homeTeam : game.awayTeam;
  const mascot = side === 'home' ? game.homeMascot : game.awayMascot;
  return formatTeamName(school, mascot);
}

/**
 * Check whether a team name is an alma mater — precise matching.
 * Returns the matching alma mater key, or null.
 *
 * EXACT EQUALITY FIRST (Drew's ruling, 2026-09-04 — the ESPN-canonical alma-
 * mater dropdown replacing free text: "One way to protect the correct
 * school naming (eg washington vs Washington state)... Do the dropdown").
 * Before ANY pattern/substring logic runs, `teamName` is compared, trimmed
 * and case-insensitively, against every entry in `almaMaters` for a literal
 * match, and the first hit wins. `parseAndReport()` (data-provider.js)
 * stores `team.location` as `game.homeTeam`/`game.awayTeam`; the dropdown
 * stores that SAME field on the claim. Once both sides of a comparison are
 * ESPN's own `location` string, "Washington" === "Washington State" is
 * false — full stop, no substring, no exclude list to maintain. This is a
 * genuine correctness fix, not just a shortcut: the OLD code, given BOTH
 * "Washington" and "Washington State" simultaneously claimed by two
 * different players, would resolve `getAlmaMaterMatch('Washington State',
 * ['Washington','Washington State'])` to `'Washington'` — the WRONG
 * claimant — because the loop hit "Washington"'s word-boundary substring
 * pattern before ever reaching "Washington State"'s own entry. Exact-first
 * checks literal equality against the WHOLE list before any substring logic
 * runs at all, so the team that IS "Washington State" resolves to the
 * "Washington State" claim, not its same-prefix sibling. See almatest.mjs
 * §1 for this exact before/after proof.
 *
 * The pattern/substring logic below still runs as a FALLBACK — reached only
 * when no exact match exists anywhere in `almaMaters` for this `teamName` —
 * so legacy stored values (claims saved before the dropdown existed, e.g. a
 * free-text "Oklahoma Sooners" instead of the canonical "Oklahoma") still
 * resolve. Its own robustness rules (prevents the USC-class bug where an
 * alma mater's own key wasn't in its pattern list):
 *  1. The alma mater KEY itself is always treated as a valid pattern, even if
 *     it was omitted from ALMA_MATER_EXACT_PATTERNS.
 *  2. Exclusions are checked first (e.g. "Arkansas State" never matches "Arkansas").
 *  3. Matching is word-aware: a pattern matches if it appears as a whole word /
 *     phrase, not as a substring of a longer word. This stops "USC" from
 *     matching inside "USCUpstate"-type concatenations while still matching the
 *     bare "USC" that ESPN returns as team.location.
 *
 * `almaMaters` (optional) is the CLAIMED roster to match against — pass
 * `claimedAlmaMaters()` (app.js — the distinct, non-empty set of ACTIVE
 * players' `player.almaMater` values) from a caller that has the storage
 * seam available (data-model.js itself never imports storage.js, so it
 * can't default to that here). Omitting it falls back to the full
 * ALMA_MATERS catalog, which keeps every caller that hasn't been updated for
 * the derived-roster model working exactly as before.
 *
 * PRECISION TRADEOFF, residual after exact-first — a claimed school NOT in
 * the ALMA_MATERS catalog AND not itself an exact match for the `teamName`
 * being tested still falls into the substring fallback: rule 1 above (the
 * key itself is always a valid pattern) finds it via word-boundary matching
 * on the bare name — so a claim like "Clemson" matches its own team's ESPN
 * name correctly. But a non-catalog school gets NO entry in
 * ALMA_MATER_EXACT_PATTERNS and, more importantly, NO entry in
 * ALMA_MATER_EXCLUDE_PATTERNS — so a SOLO "Washington" claim (no
 * "Washington State" claim on record to out-compete it via exact-first)
 * still has no substring protection against a same-prefix sibling program
 * the way Arkansas/Miami/Oklahoma/Purdue/USC do. The six catalog schools
 * remain fully precise regardless of who claims them; only a genuinely new
 * claim outside the catalog inherits this looser fallback behavior, and
 * only when (a) it happens to share a word-prefix with another program's
 * name AND (b) that other program isn't itself claimed too (in which case
 * exact-first already disambiguates them, per the proof above).
 */
export function getAlmaMaterMatch(teamName, almaMaters = ALMA_MATERS) {
  if (!teamName) return null;
  const t = teamName.trim();
  const tLow = t.toLowerCase();

  for (const alma of almaMaters) {
    if (typeof alma === 'string' && alma.trim().toLowerCase() === tLow) return alma;
  }

  const wordAwareIncludes = (haystack, needle) => {
    const n = needle.toLowerCase();
    const idx = haystack.indexOf(n);
    if (idx === -1) return false;
    // Ensure the match is bounded by non-alphanumerics (or string ends),
    // so "usc" matches "usc" and "usc trojans" but not "uscupstate".
    const before = idx === 0 ? '' : haystack[idx - 1];
    const after  = idx + n.length >= haystack.length ? '' : haystack[idx + n.length];
    const isWordChar = c => /[a-z0-9]/.test(c);
    return (!before || !isWordChar(before)) && (!after || !isWordChar(after));
  };

  for (const alma of almaMaters) {
    // Exclusions first
    const excludes = ALMA_MATER_EXCLUDE_PATTERNS[alma] || [];
    if (excludes.some(ex => tLow.includes(ex.toLowerCase()))) continue;

    // Inclusion patterns = configured patterns + the key itself (guaranteed)
    const patterns = new Set([...(ALMA_MATER_EXACT_PATTERNS[alma] || []), alma]);
    if ([...patterns].some(p => wordAwareIncludes(tLow, p))) return alma;
  }
  return null;
}

export const WEEK_STATUS   = { DRAFT:'draft', OPEN:'open', LOCKED:'locked', LIVE:'live', FINAL:'final' };
export const GAME_STATUS   = { SCHEDULED:'scheduled', LIVE:'live', FINAL:'final' };
export const PICK_RESULT   = { PENDING:'pending', LIVE:'live', WIN:'win', LOSS:'loss', NO_DECISION:'no_decision' };
export const TIME_WINDOW   = { MORNING:'morning', AFTERNOON:'afternoon', EVENING:'evening', LATE:'late' };
// v0.17.3 — PENDING added: a payer's own "Mark Paid" claim needs the creditor
// (or the commissioner) to confirm before it counts as settled (UN-89 debt
// approval). See obligationNextStatus() below for the transition rules.
export const OBLIGATION_STATUS = { UNPAID:'unpaid', PENDING:'pending', PAID:'paid', WAIVED:'waived' };
export const STORAGE_MODE  = { LOCAL:'local', GOOGLE_SHEETS:'googleSheets' };

export const DATA_QUALITY  = {
  CONFIRMED:'confirmed', PARTIAL:'partial', DEMO:'demo', MANUAL:'manual', UNAVAILABLE:'unavailable',
};

export const DATA_SOURCE_MODE = {
  DEMO:'demo', ESPN_LIVE:'espn_live', ESPN_HISTORICAL:'espn_historical', MANUAL:'manual',
};

export const TIEBREAKER_TYPE = {
  ALMA_MATER_TOTAL:'almaMaterTotal', MANUAL:'manual', CUSTOM:'custom',
};

export const TIEBREAKER_CALC_MODE = {
  SELECTED_SLATE_ONLY:'selectedSlateOnly', ALL_ALMA_MATER_GAMES:'allAlmaMaterGames', MANUAL:'manual',
};

export const TIME_ZONES = [
  { key:'PT', label:'Pacific',  iana:'America/Los_Angeles' },
  { key:'MT', label:'Mountain', iana:'America/Denver' },
  { key:'CT', label:'Central',  iana:'America/Chicago' },
  { key:'ET', label:'Eastern',  iana:'America/New_York' },
];
export const DEFAULT_TZ = 'PT';

/**
 * The ONE emoji palette for the entire app (AD-20 extended to emoji, batch 3+4
 * item G). Previously two independent literals drifted apart: `QUICK_EMOJI`
 * (6, chat-ui.js) and `REACTION_PALETTE` (15, app.js's dashboard game
 * reactions). Same lesson as `TEAM_ABBR`: a second literal for one concept is
 * the bug, not a feature. data-model.js imports nothing, so it's the only
 * module either app.js or chat-ui.js can both pull from without a cycle.
 *
 * Order historically mattered because chat's QUICK_EMOJI derived from the
 * FRONT of this list — retired in batch 2 (UN-103): the composer no longer
 * inserts emoji at all, and the message-level always-visible subset was
 * replaced by a single + that opens this full list per message. The front
 * entries are still the most-used ones, so the order is left as-is for
 * whoever next wants a curated subset. The dashboard's reaction picker shows
 * the whole list in a grid, where order is purely cosmetic.
 *
 * FROZEN as of XSS-HARDEN round 3 (F3-1, 2026-09-12), for the same reason
 * CHAT_ACCENTS is: it is now an ALLOW-LIST, checked at two write seams
 * (storage.js toggleReaction, chat.js's react fold). A list that can be
 * pushed to at runtime is not an allow-list.
 */
export const REACTION_PALETTE = Object.freeze([
  '👍', '👎', '🔥', '😂', '💀', '🍺',
  '😁', '😭', '😅', '😬', '🤡', '👀',
  '🫡', '🤘', '🤙', '☝️', '🚀', '🖕',
]);

/**
 * SCRIBE v3, Package B (DI-270, UN-247) — WHAT EACH REACTION MEANS WHEN IT
 * LANDS ON A SCRIBE POST.
 *
 * The league already reacts to SCRIBE's lines constantly and nothing has ever
 * read those taps. This map is the first thing that can: one valence per
 * palette entry, so a Trainer (Package C) can count agreement and objection
 * without re-deriving a meaning for 🖕 every time it runs.
 *
 * KEYED TO `REACTION_PALETTE` ABOVE, ENTRY FOR ENTRY. `reasonchiptest.mjs`
 * asserts both directions — every palette emoji is mapped, and nothing is
 * mapped that is not in the palette — because a half-covered map reads as
 * "neutral" for the missing half and quietly drags every count toward zero.
 *
 * 💀 😭 😅 🤡 👀 ☝️ ARE NEUTRAL ON PURPOSE, NOT BY OVERSIGHT. In casual group
 * chat 💀 and 😭 usually mean "that killed me," i.e. approval — but they are
 * also exactly what somebody types when a roast actually stung, and a roast is
 * the one situation where those two readings are impossible to tell apart
 * without more context. Scoring an ambiguous tap as approval is how a training
 * signal learns the wrong lesson from the line that hurt. Neutral costs us a
 * little signal; a wrong sign costs us the feature. Drew can override any
 * single emoji here — that is a one-line change and a test update.
 */
export const REACTION_VALENCE = Object.freeze({
  '👍': 'positive', '🔥': 'positive', '😂': 'positive', '🍺': 'positive',
  '😁': 'positive', '🫡': 'positive', '🤘': 'positive', '🤙': 'positive', '🚀': 'positive',
  '👎': 'negative', '😬': 'negative', '🖕': 'negative',
  '💀': 'neutral', '😭': 'neutral', '😅': 'neutral', '🤡': 'neutral', '👀': 'neutral', '☝️': 'neutral',
});

/**
 * Valence tally over an ALREADY-FOLDED message's `reactions` object — the
 * `{ [emoji]: [authorId, …] }` shape chat.js rebuilds on every react/unreact.
 *
 * Pure, no storage read, no new fold, no new event type: every reaction this
 * counts was already stored and already rendered. DI-270's whole delta is that
 * somebody can now ASK what they add up to.
 *
 * An UNKNOWN emoji counts as neutral rather than being dropped, so the three
 * buckets always sum to the real number of reactions on the post. A count that
 * silently omits rows is worse than one that parks them in the middle: the
 * first looks like agreement, the second looks like what it is.
 *
 * THE LOOKUP IS CHECKED AGAINST THE THREE BUCKET NAMES, not merely defaulted
 * with `||`. `REACTION_VALENCE['__proto__']` answers with `Object.prototype` —
 * truthy — and `out[Object.prototype] += n` would silently mint a fourth key
 * holding NaN instead of counting the row. chat.js's react fold already refuses
 * any emoji outside the palette, but this is an exported pure function a future
 * Trainer can point at raw rows, so the guard belongs here too (CONVENTIONS #7).
 */
const REACTION_VALENCE_BUCKETS = Object.freeze(['positive', 'negative', 'neutral']);
export function reactionValenceCounts(reactions) {
  const out = { positive: 0, negative: 0, neutral: 0 };
  Object.entries(reactions || {}).forEach(([emoji, authors]) => {
    const raw = REACTION_VALENCE[emoji];
    const v = REACTION_VALENCE_BUCKETS.includes(raw) ? raw : 'neutral';
    out[v] += Array.isArray(authors) ? authors.length : 0;
  });
  return out;
}

/**
 * The ONE chat-accent palette (XSS-HARDEN round 2, C2, 2026-09-12). Same
 * reasoning as REACTION_PALETTE above: it lived as a literal in chat-ui.js,
 * and storage.js's setAccent() now has to validate against it. storage.js is
 * a SEAM file and must not import chat-ui.js (chat-ui imports storage — that
 * is a cycle, and the seam stays a leaf). data-model.js imports nothing, so
 * it is the only place both can read from.
 *
 * Every entry is a plain 6-digit uppercase hex colour. That is load-bearing,
 * not cosmetic: the value is interpolated into a `style="background:…"`
 * attribute, so nothing in this list may contain a quote, a semicolon or a
 * url(). setAccent() accepts a value ONLY if it is one of these exact
 * strings — an allow-list, not a pattern.
 */
export const CHAT_ACCENTS = Object.freeze([
  '#B91C1C', '#C2410C', '#A16207', '#15803D', '#0E7490', '#1D4ED8', '#7C3AED', '#BE185D',
]);

// Site-level access PIN — DEFAULT only. Commissioner can override this via
// settings.sitePin (Commissioner → Security panel). verifySitePin() in storage.js
// checks settings first, then falls back to this constant.
export const SITE_PIN = '6969';
export const SITE_PIN_KEY = 'cfbp_site_unlocked';

/**
 * Per-player theme catalog.
 *  - Default theme is 'neutral' (school-agnostic slate) as of v0.17.0; school palettes are opt-in.
 *  - Each theme is applied by adding a class `theme-<key>` to <body>, which the
 *    stylesheet uses to override the root CSS variables for primary brand colors.
 *  - Fonts stay constant across themes (Oswald + Inter).
 *  - Selected theme is stored per-DEVICE in settings.theme.
 */
export const THEMES = [
  // key, label, classSuffix is the same as key
  { key: 'aggie',     label: 'A&M (Maroon)',    school: 'Texas A&M' },
  { key: 'sooner',    label: 'Oklahoma (Crimson & Cream)', school: 'Oklahoma' },
  { key: 'trojan',    label: 'USC (Cardinal & Gold)',      school: 'USC' },
  { key: 'irish',     label: 'Notre Dame (Navy & Gold)',   school: 'Notre Dame' },
  { key: 'boilermaker', label: 'Purdue (Old Gold & Black)',school: 'Purdue' },
  { key: 'razorback', label: 'Arkansas (Cardinal)',        school: 'Arkansas' },
  { key: 'neutral',   label: 'Neutral (Slate)',            school: null, desc: 'Default' },
];

// ─── DEFAULT RULES ────────────────────────────────────────────────────────────

// F3 (2026-09-04) — this array's "Alma mater games (OU, Texas A&M, USC,
// Notre Dame, Purdue, Arkansas)..." line used to hardcode the six-school
// catalog directly. That went stale the moment the roster became derived
// from player claims (claimedAlmaMaters(), app.js): Kevin's Purdue -> Notre
// Dame move updated the REAL roster everywhere except this one static
// string, so the Rules tab showed TWO disagreeing rosters a few sections
// apart — one hardcoded (still naming Purdue), one derived (correct). Fixed
// by not naming schools here at all — data-model.js never imports
// storage.js, so it has no way to read claimedAlmaMaters() and compute a
// roster string itself (same constraint documented on getAlmaMaterMatch()
// above). Instead this item points at the single derived list that already
// renders on the same page (renderRulesPage()'s "⭐ Alma Maters" section,
// js/app.js) — one source of truth, not two copies to keep in sync.
export const DEFAULT_RULES = [
  { id:'r1', section:'The Basics', items:[
    'Each week, the Commissioner selects 10 college football games for the slate.',
    'Alma mater games — the schools claimed by active players, listed under ⭐ Alma Maters below — are always prioritized.',
    'You pick which team you think will win against the spread.',
    'Picks are blind — you cannot see others\' picks until you submit your own.',
    'Games lock at kickoff. If the week is locked, no picks are accepted even for future games.',
  ]},
  { id:'r2', section:'Scoring', items:[
    'Correct ATS pick = 1 point.',
    'Incorrect ATS pick = 0 points.',
    'Exact spread tie = No Decision (0 points).',
    'Most correct picks wins the week.',
  ]},
  { id:'r3', section:'Tiebreaker', items:[
    'If players are tied on correct picks, the tiebreaker decides.',
    'Default: total combined points scored by all alma mater teams on the slate.',
    'Closest guess wins. If still tied, players share the rank.',
  ]},
  { id:'r4', section:'Prizes', items:[
    'Weekly prize: loser owes winner a consolation prize.',
    'Season prize: season loser owes season winner a grand prize.',
  ]},
];

// ─── DEFAULT SETTINGS ─────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS = {
  // NOTE: `almaMaters` was removed from here 2026-09-04. It briefly existed
  // (8ae64f4) as a separately-editable roster; Drew's ruling the same week
  // rejected the two-list model — the roster is derived from player claims
  // (`claimedAlmaMaters()` in app.js), not stored settings. A stray
  // `almaMaters` field may still exist in an already-saved settings blob
  // from that window; nothing reads it, and getSettings()'s
  // `{...DEFAULT_SETTINGS, ...stored}` merge no longer reintroduces it for
  // any settings blob that doesn't already carry one.
  weeklyGameCount: 10,
  candidateGameCount: 25,
  weeklyPrize: 'Loser buys winner a consolation prize',
  seasonPrize: 'Season loser owes season winner a grand prize',
  adminPasswordHash: btoa('admin123'),
  storageMode: STORAGE_MODE.LOCAL,
  season: '2026',
  customRules: null,
  autoRefreshInterval: 60,
  timezone: DEFAULT_TZ,
  // v0.17.3 — chat retention (UN-88). 0/absent = OFF (default): the full
  // Locker Room history renders. A positive number is the render window in
  // days; older non-pinned messages stop RENDERING (nothing is deleted — see
  // chat.js isHiddenByRetention()). Default-when-missing story: old settings
  // blobs without this field spread in as 0 via DEFAULT_SETTINGS, same as
  // every other new field (CONVENTIONS #10).
  chatRetentionDays: 0,
  // UN-112 — chat epoch clear (LAUNCH BLOCKER). A watermark, not a delete:
  // messages at-or-below this seq stop rendering everywhere (chat.js
  // getMessages()/isUnreadFor(), unconditionally — see there), same
  // hide-not-destroy shape as chatRetentionDays above, chosen for the same
  // reason (a real backend purge needs a new Code.gs endpoint + redeploy —
  // RG-09's exact failure mechanism — Drew already declined that tradeoff
  // once for retention; same call). Default-when-missing: 0/absent = "hide
  // nothing" — old settings blobs written before this field existed must
  // read as a no-op, never as "hide everything" (CONVENTIONS #10).
  // chatEpochSetAt is display-only (the admin card's "cleared" copy);
  // clearing logic never reads it.
  chatEpochSeq: 0,
  chatEpochSetAt: null,
  // Batch 3+4 item A — commissioner chat on/off toggle. Default TRUE: chat is
  // on today, and a missing value (every pre-existing settings blob in the
  // Sheet) must not silently disable it (CONVENTIONS #10). Synced through the
  // storage seam so every player sees the same on/off state — this is NOT a
  // device-local key (contrast with the teaser dismissal seq in chat-ui.js,
  // which IS device-local under AD-12).
  chatEnabled: true,
  // UN-107 — commissioner control over the "Randomize My Picks" shortcut.
  // Default FALSE, deliberately: this is the inverse of chatEnabled above.
  // The button ships today as permanent/always-on; going forward it is
  // opt-IN, so a missing value (every pre-existing settings blob) must read
  // as OFF, not on (CONVENTIONS #10). Existing players lose the button until
  // the Commissioner explicitly turns it on — that is the intended behavior
  // change, not a bug.
  randomizePicksEnabled: false,
  // Build 1 (2026-09-10) — E1 feedback instrumentation master switch (UN-159).
  // Default TRUE for the six-player pilot (Drew's D5 ruling: commissioner
  // master switch, not per-player opt-in). A missing value must read as ON
  // (CONVENTIONS #10) — chat-ui.js reads `!== false` for exactly that reason.
  scribeFeedbackEnabled: true,
  // Build 1 (2026-09-10) — F4-interim inline image previews (UN-164). Default
  // FALSE (Drew's D7 ruling: built, off by default) because an inline external
  // <img> is a passive IP-disclosure vector; chat-ui.js reads `=== true`.
  chatImagePreviewEnabled: false,
  // Build 2, Group C (2026-09-10, UN-150…154) — CLIENT-VISIBLE convenience
  // gates for the interactive (LLM-backed) @SCRIBE runtime. These are NOT the
  // authoritative switch — that's the server-side `SCRIBE_INTERACTIVE_ENABLED`
  // / `SCRIBE_WEB_SEARCH_ENABLED` Script Properties in backend/Code.gs, which
  // default OFF (a brand-new paid-API capability must not silently start
  // spending money the moment this ships) and are checked FIRST on every
  // `scribeAsk` call regardless of what these settings say. These two exist
  // purely so a commissioner who has already turned SCRIBE off doesn't pay a
  // wasted network round trip on every `@scribe` mention (C1's own framing).
  // Default TRUE here (unlike the server props): once Drew actually sets the
  // Script Properties, the feature should work without ALSO needing a second
  // client-side flip — same reasoning as `scribeFeedbackEnabled`'s default.
  scribeInteractiveEnabled: true,
  scribeWebSearchEnabled: true,
  // Build 2b, E4 (2026-09-10, UN-162) — kill switch on approved-Trainer-
  // learnings/Canon reaching SCRIBE's live generation context. Default TRUE
  // (E-2 ruling): a missing value (every settings blob written before this
  // field existed) must read as "learnings active," not silently disabled —
  // same `!== false` pattern as scribeFeedbackEnabled/chatEnabled
  // (CONVENTIONS #10). When false, Code.gs's context assembly leaves BOTH
  // reserved slots (activeLearnings/canonExamples) empty regardless of what
  // is `approved` in KEYS.SCRIBE_LEARNINGS/SCRIBE_CANON — the fast "something
  // just made SCRIBE noticeably worse, stop it now" control, separate from
  // per-learning approve/reject granularity.
  scribeLearningsEnabled: true,
  // Build 3, Group D (2026-09-11, DI-D1) — the frequency dial. ONE numeric
  // threshold on a 0-100 scale, stored as its LEVEL NAME so the UI, the
  // client-side scorer (js/scribeLines.js FREQUENCY_LEVELS) and the server
  // (backend/Code.gs SCRIBE_FREQUENCY_THRESHOLDS_) all agree on what a level
  // means without shipping a bare number nobody can interpret later.
  // Drew's D-1 ruling: all five levels are exposed — Quiet 85 / Reserved 65 /
  // Balanced 45 / Active 25 / Unhinged 15.
  // Default-when-missing: 'balanced'. An absent or unrecognized value reads
  // as Balanced on BOTH sides (CONVENTIONS #10), never as 0 — a malformed
  // value must make SCRIBE quieter-or-equal, never turn the gate off.
  scribeFrequency: 'balanced',
  // Build 3, Group D — client-visible convenience gate for autonomous
  // participation, the exact mirror of scribeInteractiveEnabled above: it
  // saves a wasted network round trip when autonomy is known to be off. The
  // AUTHORITATIVE switch is the server-side SCRIBE_AUTONOMOUS_ENABLED Script
  // Property, which defaults OFF and is checked first on every call.
  // Default TRUE here for the same reason as its sibling: once Drew sets the
  // Script Property, the feature should work without ALSO needing a second
  // client-side flip.
  scribeAutonomousEnabled: true,
  // SCRIBE v3, Package A (2026-09-23, UN-239/DI-263) — the HEAT dial. The
  // league-wide CEILING on how hard a single SCRIBE line may land, stored as
  // its level name for the same reason `scribeFrequency` is: the UI, the
  // client and both Edge Functions all read one closed table
  // (SCRIBE_HEAT_ORDER below) rather than a bare number nobody can interpret.
  //
  // DEFAULT 'dry' IS DELIBERATE AND IS NOT DREW'S DAY-ONE SETTING.
  // Dry IS today's shipped v2.1 voice (docs/SCRIBE.md §4's ladder says so in
  // its own words), so a missing value reads as CURRENT BEHAVIOUR — exactly
  // what CONVENTIONS #10 requires of every new field. Drew's stated day-one
  // choice is No Mercy, and he sets it in Comm → Settings at deploy. A code
  // default that shipped the league's preference would mean an unset/garbage
  // value silently resolving to the hottest setting the app has, which is the
  // wrong direction for every failure mode: a malformed value must make
  // SCRIBE tamer-or-equal, never hotter (the same rule `scribeFrequency`
  // follows in the other direction).
  scribeHeat: 'dry',
  // SCRIBE v3, Package C (2026-09-23, UN-250/DI-274) — the LEARNING RATE dial.
  // How fast feedback becomes a live instruction: Fast / Normal / Locked.
  //
  // DEFAULT 'normal' IS DELIBERATE AND IS NOT DREW'S DAY-ONE SETTING, for the
  // same reason `scribeHeat` above defaults to 'dry'. Normal's row of
  // SCRIBE_LEARNING_RATE_TABLE (below) is BYTE-IDENTICAL to what the Trainer
  // already does today — weekly cadence, three rated responses minimum,
  // auto-apply only at confidence >= 0.9, no instant path, no heat exploration
  // — so a league that has never touched this setting behaves exactly as it did
  // before the field existed (CONVENTIONS #10). Drew's stated day-one choice is
  // Fast, and he sets it in Comm -> Settings at deploy. A code default of Fast
  // would mean an unset or malformed value silently switching on an unattended
  // path that writes rows and spends money, which is the wrong direction for
  // every failure mode.
  scribeLearningRate: 'normal',
};

// ─── SCRIBE FREQUENCY DIAL (Build 3, Group D, DI-D1) ──────────────────────────
//
// N-3 (reviewer, round 2) — the canonical level table lives HERE, not in
// js/scribeLines.js, because two modules need it and one of them
// (js/scribeAgent.js) cannot import the other without a cycle: scribeLines
// already imports scribeAgent. data-model.js imports nothing, so it is the
// one place in this codebase that can be imported from anywhere — the same
// reasoning AD-20 gives for putting TEAM_ABBR here.
//
// A THIRD copy exists in backend/Code.gs (SCRIBE_FREQUENCY_THRESHOLDS_),
// unavoidably: Apps Script is a separate runtime with no access to this
// file. scoringtest.mjs parses both sources and asserts they agree, so the
// two cannot drift silently.
//
// One numeric threshold on a 0-100 scale; a candidate speaks when its
// opportunity score is >= the threshold. Drew's D-1 ruling exposes all five.
export const SCRIBE_FREQUENCY_LEVELS = {
  quiet: 85, reserved: 65, balanced: 45, active: 25, unhinged: 15,
};
export const SCRIBE_FREQUENCY_DEFAULT = 'balanced';

// ─── SCRIBE HEAT DIAL (SCRIBE v3, Package A, DI-263) ─────────────────────────
//
// THE SECOND AXIS, AND IT IS NOT THE FIRST ONE. `scribeFrequency` above is HOW
// OFTEN SCRIBE speaks; this is HOW HARD a single line may land. They are
// independent by design and by written rule (docs/SCRIBE.md §4's "Heat and
// frequency are two different axes" and §8's annoying-vs-mean subsection) —
// raising heat must never raise frequency, and nothing in this file lets it.
//
// IT LIVES HERE FOR THE SAME REASON SCRIBE_FREQUENCY_LEVELS DOES (N-3): both
// `js/scribeAgent.js` and the Edge Functions need it, `data-model.js` imports
// nothing, and `supabase/functions/scribe-autonomous/index.js` already imports
// SCRIBE_FREQUENCY_LEVELS straight from this file — so heat is a shared
// constant with ONE home rather than a twin somebody has to keep in sync.
//
// ORDER IS SEMANTIC. `SCRIBE_HEAT_ORDER` is coolest-first, and
// `SCRIBE_HEAT_INDEX` is the comparable rank behind `effectiveScribeHeat()`'s
// min(). Two structures rather than one array lookup because the index is used
// in comparisons on both sides of the wire and `indexOf()` returning -1 for a
// garbage value would quietly read as "cooler than Polite".
export const SCRIBE_HEAT_ORDER = ['polite', 'dry', 'spicy', 'savage', 'no_mercy'];
export const SCRIBE_HEAT_INDEX = { polite: 1, dry: 2, spicy: 3, savage: 4, no_mercy: 5 };
export const SCRIBE_HEAT_DEFAULT = 'dry';

/**
 * A player's roast tolerance → the CEILING it puts on posts about that player.
 * DI-263, confirmed by Drew 2026-09-23 (open question 3).
 *
 * This is what finally gives the three already-shipped `ROAST_TOLERANCE_OPTIONS`
 * labels an operational meaning — until v3 nothing read the value at all. The
 * mapping only ever NARROWS: a personal cap can lower what SCRIBE says about
 * you, it can never raise it above what the commissioner set.
 */
export const ROAST_TOLERANCE_HEAT_CAP = { light: 'dry', standard: 'savage', no_limits: 'no_mercy' };

/**
 * The level that actually governs a post: min(league dial, target's own cap).
 *
 * `targetRoastTolerance` FALSY MEANS NO PERSONAL CAP — a general post about
 * nobody in particular, or a player who has never opened My SCRIBE File. Drew's
 * ruling 2026-09-23 (open question 5): an unset tolerance defers to the league
 * level rather than defaulting silent players to `standard`. That is the answer
 * with no hidden behaviour in it — the dial the commissioner set is the dial,
 * and a player who wants less says so.
 *
 * GARBAGE FAILS COOL, IN BOTH ARGUMENTS (CONVENTIONS #7). An unrecognised
 * league level resolves to the DEFAULT ('dry', today's voice), never to the
 * caller's string; an unrecognised tolerance resolves to the same default as a
 * CAP, which can only lower the result. A malformed value must never be the
 * reason SCRIBE got hotter.
 *
 * A HARD LINE IS NOT MODELLED HERE, ON PURPOSE. Boundaries are checked
 * separately, before generation, and they beat every level including No Mercy
 * (docs/SCRIBE.md §4, §9.3). Folding them into a number would imply a heat
 * level exists at which a boundary stops applying, and none does.
 *
 * ── F-1 (security gate, 2026-09-23) — MEMBERSHIP, NOT TRUTHINESS ────────────
 * Both lookups used to be bare bracket probes (`SCRIBE_HEAT_INDEX[leagueHeat]`,
 * `ROAST_TOLERANCE_HEAT_CAP[tol] || DEFAULT`), which answer for EVERY KEY ON
 * `Object.prototype` as well as the five real ones. A tolerance of
 * `'constructor'` returned the `Object` function — truthy, so the `||` never
 * fired — and `SCRIBE_HEAT_INDEX[thatFunction]` is `undefined`, so
 * `undefined <= n` is false and the post ran at the FULL LEAGUE DIAL with the
 * cap silently skipped. A heat level of `'toString'` did the same thing one
 * table over. Both values are member-reachable: the tolerance comes off a
 * `scribe_memory` row a player writes about himself.
 *
 * `hasOwnProperty` is therefore the test at every one of these tables, here and
 * in the four sibling call sites (`scribePushIsContentFree` below,
 * `scribeHeatBlock()` in _shared/scribe-persona.mjs, `getScribeHeat()` /
 * `setScribeHeat()` in js/scribeAgent.js) — matching the frequency pair in
 * scribeAgent.js, which has always read this way. The tolerance ids ARE
 * `ROAST_TOLERANCE_HEAT_CAP`'s own key set (`light`/`standard`/`no_limits` —
 * the same three js/app.js's ROAST_TOLERANCE_OPTIONS renders), so validating
 * against this table IS validating against the option list, with no second copy
 * of it to drift.
 */
export function effectiveScribeHeat(leagueHeat, targetRoastTolerance) {
  const league = Object.prototype.hasOwnProperty.call(SCRIBE_HEAT_INDEX, leagueHeat)
    ? leagueHeat : SCRIBE_HEAT_DEFAULT;
  if (!targetRoastTolerance) return league;
  const cap = Object.prototype.hasOwnProperty.call(ROAST_TOLERANCE_HEAT_CAP, targetRoastTolerance)
    ? ROAST_TOLERANCE_HEAT_CAP[targetRoastTolerance] : SCRIBE_HEAT_DEFAULT;
  return SCRIBE_HEAT_INDEX[cap] <= SCRIBE_HEAT_INDEX[league] ? cap : league;
}

/**
 * DI-267 — CONTENT-FREE PUSH AT SAVAGE AND ABOVE, automatic, no toggle
 * (Drew's ruling 2026-09-23, open question 2).
 *
 * A push preview is the one SCRIBE surface that renders on a LOCKED PHONE, in
 * front of whoever is standing next to it, with none of the context that makes
 * a roast a roast. At Savage and No Mercy the line itself is the wrong thing to
 * put there, so the push carries a generic body and the line stays in the room.
 *
 * THIS IS NOT SUPPRESSION. The push still fires, to the same recipients, with
 * the same deep link — S6-D-7 (a) ("SCRIBE-authored rows push exactly like
 * today") is about WHETHER a SCRIBE row pushes, and that is unchanged. Only the
 * preview TEXT changes, and only above Spicy.
 *
 * Lives in `data-model.js` because BOTH push paths need the identical answer:
 * `supabase/functions/_shared/job-rules.mjs` (the live server fan-out) and
 * `js/notifications.js` (the client relay that resumes if `notifyFanout` is
 * ever switched off). Two copies of this predicate is how the rollback path
 * quietly keeps leaking the line nobody wanted on a lock screen.
 *
 * F-1 (2026-09-23) — `hasOwnProperty`, not a bracket probe, for the reason
 * `effectiveScribeHeat()` above states at length. Here the consequence ran the
 * other way and was worse for it: a dial of `'constructor'` made
 * `SCRIBE_HEAT_INDEX[level]` `undefined`, `undefined >= 4` false, and the push
 * carried the full line — i.e. the exact lock-screen leak this predicate
 * exists to stop, reachable from one malformed settings value.
 */
export const SCRIBE_PUSH_CONTENT_FREE_BODY = 'SCRIBE posted in the Locker Room';
export function scribePushIsContentFree(leagueHeat) {
  const level = Object.prototype.hasOwnProperty.call(SCRIBE_HEAT_INDEX, leagueHeat)
    ? leagueHeat : SCRIBE_HEAT_DEFAULT;
  return SCRIBE_HEAT_INDEX[level] >= SCRIBE_HEAT_INDEX.savage;
}

// ─── SCRIBE MODEL CHOICE (SCRIBE v3, DI-282) ─────────────────────────────────
//
// DREW, 2026-09-23: "i also want to be able to toggle if scribe is using sonnet
// or opus." The two ids the commissioner may choose between, in ONE place, for
// the same reason the heat ladder is here (N-3): the client card renders from
// this list and the Edge Functions price and send from
// `supabase/functions/_shared/scribe-rate.js`'s rate card — two files that must
// agree about what a legal model id is, and `data-model.js` is the one module
// in this codebase everything can import.
//
// ORDER IS SEMANTIC, exactly like SCRIBE_HEAT_ORDER: [0] IS THE DEFAULT, and it
// is `claude-sonnet-5` — the same string `_shared/anthropic.js`'s
// SCRIBE_MODEL_DEFAULT carries, which is what every path already falls back to
// today. A missing `settings.scribe.model` therefore reads as CURRENT
// BEHAVIOUR (CONVENTIONS #10) and the cheaper of the two, which is the safe
// direction for a value that multiplies a bill by 2.5. `heattest.mjs` §[11]
// asserts the two constants agree and that every choice here is priced on the
// rate card — an id the rate card does not know would be metered at the Sonnet
// fallback while being billed as Opus.
//
// FROZEN because it is an ALLOW-LIST, enforced at the write boundary
// (`setScribeModel()` in js/app.js) and again server-side in `rateSettings()`
// (F-3). A list that can be pushed to at runtime is not an allow-list.
export const SCRIBE_MODEL_CHOICES = Object.freeze(['claude-sonnet-5', 'claude-opus-5']);

// ─── SCRIBE LEARNING RATE (SCRIBE v3, Package C, DI-274) ─────────────────────
//
// THE THIRD DIAL, AND IT IS NOT EITHER OF THE OTHER TWO. `scribeFrequency` is
// HOW OFTEN SCRIBE speaks; `scribeHeat` is HOW HARD one line may land; this is
// HOW FAST FEEDBACK CHANGES EITHER OF THEM. Drew's words (2026-09-23): "it needs
// to really incorporate feedback quickly and change quickly… We can start to
// dial it in throughout the season."
//
// ONE TABLE, FIVE COLUMNS, EVERY CONSUMER READS THE SAME ROW. The five knobs the
// plan's own chart names live here together rather than as five settings,
// because five independent settings is five ways for the dial to half-apply —
// a league on "Locked" whose nightly cron somebody forgot to gate is not locked.
//
//   instantAgreeThreshold  how many AGREEING feedback signals (same target, same
//                          category family, DIFFERENT authors) the instant path
//                          needs before a learning may auto-apply. `null` = the
//                          instant path never runs at all.
//   trainerCadence         'nightly' | 'weekly' | 'manual'. Migration 0024 ships
//                          BOTH cron entries; the handler no-ops the nightly one
//                          unless this says 'nightly'.
//   minRated               the insufficient-data floor (MIN_RATED_RESPONSES's
//                          replacement as a PARAMETER — 3 stays the default for
//                          every existing call site).
//   autoApply              'all_tone_style' (Fast: any applies:true result may
//                          auto-apply, category permitting) | 'confidence_0_9'
//                          (today's behaviour) | 'none'.
//   heatExploration        whether `exploreHeat()` samples +/-1 within the
//                          league ceiling. Fast only.
//
// IT LIVES HERE for SCRIBE_HEAT_ORDER's reason (N-3): both Edge Functions and
// the client read it, and `data-model.js` imports nothing.
//
// 'all_tone_style' IS NOT A SAFETY BYPASS, and the distinction is load-bearing.
// It relaxes the CONFIDENCE gate only. `isHostileLearningInstruction()`
// (js/scribe-trainer-rules.js) runs at EVERY rate, before every insert, and a
// hit force-holds the row for a human regardless of what this table says.
export const SCRIBE_LEARNING_RATE_ORDER = Object.freeze(['locked', 'normal', 'fast']);
export const SCRIBE_LEARNING_RATE_DEFAULT = 'normal';
export const SCRIBE_LEARNING_RATE_TABLE = Object.freeze({
  fast: Object.freeze({ instantAgreeThreshold: 1, trainerCadence: 'nightly', minRated: 1, autoApply: 'all_tone_style', heatExploration: true }),
  normal: Object.freeze({ instantAgreeThreshold: 2, trainerCadence: 'weekly', minRated: 3, autoApply: 'confidence_0_9', heatExploration: false }),
  locked: Object.freeze({ instantAgreeThreshold: null, trainerCadence: 'manual', minRated: 3, autoApply: 'none', heatExploration: false }),
});

/**
 * The league's learning rate, VALIDATED — the one reader both runtimes share.
 *
 * `hasOwnProperty`, not a bracket probe, for the reason `effectiveScribeHeat()`
 * states at length (F-1): a stored `'constructor'` answers truthy on a bare
 * lookup and would come back out of a "validated" accessor unchanged.
 *
 * GARBAGE FAILS SLOW, which is this dial's safe direction: an unrecognised value
 * resolves to 'normal' (today's behaviour), never to 'fast'. A malformed setting
 * must never be the reason an unattended path started writing rows.
 */
export function effectiveScribeLearningRate(raw) {
  const level = String(raw || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SCRIBE_LEARNING_RATE_TABLE, level)
    ? level : SCRIBE_LEARNING_RATE_DEFAULT;
}

/** The whole row for a league's current rate. Always a real row — never
 *  undefined, never a partially-populated object a caller has to re-default. */
export function scribeLearningRateConfig(raw) {
  return SCRIBE_LEARNING_RATE_TABLE[effectiveScribeLearningRate(raw)];
}

// ─── SCRIBE v3, PACKAGE D — REACTIONS AND BEST-OF-N (DI-283/DI-286) ─────────
//
// IT LIVES HERE for the same reason the three dial tables above it do (N-3):
// both Edge Functions and the client need the same numbers, `js/data-model.js`
// imports nothing, and it is the only module a Deno function and a browser can
// both read without dragging the app in behind it. A twin constant is a twin
// that drifts.
//
// NONE OF THESE IS A NEW STORAGE KEY. They are the DEFAULTS behind three
// commissioner-editable fields in the existing `settings.scribe.*` bag — the
// same undeclared-nested-object pattern `autonomousHourlyLimit` and
// `monthlyBudgetUsd` already use, so `DEFAULT_SETTINGS` needs no edit and a
// league that has never seen them behaves exactly as this file says
// (CONVENTIONS #10).

/** `settings.scribe.reactionHourlyLimit` — LEAGUE-WIDE reactions per hour.
 *  `0` is the one explicit "unlimited"; absent or garbage resolves to this.
 *  Deliberately NOT the `autonomous:*` family's cap: a `react` row is
 *  structurally exempt from the consecutive-post guard (`js/chat.js`'s fold and
 *  the server's `consecutiveBlocked()` both skip every `type !== 'message'`
 *  row), so a reaction can neither trip nor consume a message floor — which is
 *  exactly why it needs a ceiling of its own rather than sharing one. */
export const SCRIBE_REACTION_HOURLY_DEFAULT = 8;

/** `settings.scribe.reactionPerAuthorHourlyLimit` — reactions to ONE player's
 *  messages per hour. Two, because the failure this bounds is not volume in
 *  aggregate, it is SCRIBE fixating on one person: eight reactions spread over
 *  six players reads as a member who is paying attention, and eight aimed at
 *  Kevin reads as a bot with a target. */
export const SCRIBE_REACTION_PER_AUTHOR_HOURLY_DEFAULT = 2;

/** `settings.scribe.classifyDailyCap`'s NEW default (DI-283, Drew's answer to
 *  §6 open question 5). The old 40/day was sized for claim-shaped messages
 *  only; the classify trigger is now every human message, and at a real
 *  league's ~150-250 messages a week 40 would exhaust itself inside two busy
 *  evenings and take reactions, comebacks and claims down with it. */
export const SCRIBE_CLASSIFY_DAILY_CAP_DEFAULT = 150;

/** `settings.scribe.bestOfN` — a CLOSED set of two. `1` is one generation and
 *  no judge (the pre-v3 behaviour, kept so the feature has an off switch that
 *  is a number rather than a second boolean); `3` is one generation call
 *  returning three candidates plus one Haiku judge call.
 *
 *  THE DEFAULT IS 3, ON (Drew's §6 decision). The whole brief is
 *  quality-per-post and the measured cost is $3-7/month; a wrong default in
 *  this direction costs a few dollars, and in the other it costs the feature. */
export const SCRIBE_BEST_OF_N_VALUES = Object.freeze([1, 3]);
export const SCRIBE_BEST_OF_N_DEFAULT = 3;

/** VALIDATED, and garbage resolves to the DEFAULT rather than to 1. Unlike the
 *  heat and learning-rate dials, whose safe direction is "cooler/slower", this
 *  one's safe direction is "the quality gate stays on": a malformed value must
 *  not be the reason SCRIBE started shipping first drafts again. The cost
 *  ceiling that bounds the other direction already exists and is shared — the
 *  $25 `budget:<YYYY-MM>` key every voice path checks before it spends. */
export function effectiveScribeBestOfN(raw) {
  const n = Number(raw);
  return SCRIBE_BEST_OF_N_VALUES.includes(n) ? n : SCRIBE_BEST_OF_N_DEFAULT;
}

// ─── SCRIBE FEEDBACK REASON CHIPS (SCRIBE v3, Package B, DI-268) ─────────────
//
// WHY A CLOSED SET AND WHY THESE ELEVEN. A bare Hit/Mid/Too-much rating cannot
// tell "SCRIBE talks too much" apart from "SCRIBE was cruel," and Drew's
// ruling 7 says those two complaints take OPPOSITE corrections — the first
// lowers FREQUENCY, the second lowers HEAT. A single "bad" signal averaged over
// both is a signal that moves the wrong dial half the time. The two families
// below are that split, made structural: they are different chips, stored as
// different strings, and `SCRIBE_FEEDBACK_CHIP_FAMILY` fixes the membership
// here so Package C's Trainer reads it rather than re-deriving it from names.
//
// FROZEN, FOR THE SAME REASON `REACTION_PALETTE` IS: it is an ALLOW-LIST,
// enforced at the write boundary in `js/scribeFeedback.js`. A list that can be
// pushed to at runtime is not an allow-list.
//
// ORDER IS THE RENDER ORDER — annoying family, mean family, shared diagnostics,
// then the single positive chip (which renders alone, under Hit).
export const SCRIBE_FEEDBACK_REASON_CHIPS = Object.freeze([
  'annoying', 'too_often', 'tried_too_hard', 'too_long',
  'too_mean', 'crossed_a_line',
  'not_funny', 'wrong_target', 'wrong_facts', 'too_soft',
  'perfect_more_of_this',
]);

/**
 * Which correction a chip argues for. `annoying` → talk less; `mean` → hit
 * softer; `shared` → neither dial, this one is about the line itself (it
 * missed, it aimed at the wrong person, it got a fact wrong, it was limp);
 * `positive` → do more of that.
 *
 * Lives beside the list rather than inside the UI so the Trainer and the
 * popover agree by construction. `reasonchiptest.mjs` asserts every chip has a
 * family and every family name is one of the four.
 */
export const SCRIBE_FEEDBACK_CHIP_FAMILY = Object.freeze({
  annoying: 'annoying', too_often: 'annoying', tried_too_hard: 'annoying', too_long: 'annoying',
  too_mean: 'mean', crossed_a_line: 'mean',
  not_funny: 'shared', wrong_target: 'shared', wrong_facts: 'shared', too_soft: 'shared',
  perfect_more_of_this: 'positive',
});
export const SCRIBE_FEEDBACK_CHIP_FAMILIES = Object.freeze(['annoying', 'mean', 'shared', 'positive']);

// ─── DEMO PLAYERS — correct alma maters and 2-letter initials ─────────────────

export const DEMO_PLAYERS = [
  { playerId:'p1', displayName:'Drew',    initials:'DH', email:'', active:true, pinHash:btoa('1111'), almaMater:'Texas A&M',  createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z' },
  { playerId:'p2', displayName:'Brayden', initials:'BR', email:'', active:true, pinHash:btoa('2222'), almaMater:'Oklahoma',   createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z' },
  { playerId:'p3', displayName:'Kevin',   initials:'KC', email:'', active:true, pinHash:btoa('3333'), almaMater:'Notre Dame', createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z' },
  { playerId:'p4', displayName:'Koby',    initials:'KR', email:'', active:true, pinHash:btoa('4444'), almaMater:'USC',        createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z' },
  { playerId:'p5', displayName:'Jacob',   initials:'JP', email:'', active:true, pinHash:btoa('5555'), almaMater:'Arkansas',   createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z' },
  { playerId:'p6', displayName:'Kihoon',  initials:'KB', email:'', active:true, pinHash:btoa('6666'), almaMater:'Texas A&M',  createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z' },
];

// ─── REAL WEEK 1 2026 ─────────────────────────────────────────────────────────

export const REAL_WEEK_1_2026 = {
  weekId:'w2026_1', season:'2026', weekNumber:1,
  label:'Week 1', roundLabel:'', espnWeekNumber:'1',
  startDate:'2026-08-29', endDate:'2026-08-30',
  status: WEEK_STATUS.DRAFT,
  dataSourceMode: DATA_SOURCE_MODE.ESPN_LIVE,
  picksOpenAt:null, picksLockAt:null,
  showInHistory: true,
  blurb:'🏈 Week 1 — 2026 Season. Commissioner: fetch ESPN data for Aug 29–30 to populate the slate.',
  recap:'', emailSentAt:null,
  tiebreakerQuestion:'What is the total combined points scored by all alma mater teams on the slate this week?',
  tiebreakerType: TIEBREAKER_TYPE.ALMA_MATER_TOTAL,
  tiebreakerCalculationMode: TIEBREAKER_CALC_MODE.SELECTED_SLATE_ONLY,
  actualTiebreakerValue:null, tiebreakerFinalized:false,
  extraPointEnabled:true, extraPointActual:null, extraPointDetect:null,
  createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z',
  lockedAt:null, finalizedAt:null,
  lockedAlmaMaters: null,  // F4 (2026-09-04) — see createWeek()'s comment below; null until LOCKED
};

/**
 * Real Week 1 starts with NO games on the slate. The Commissioner pulls games
 * from ESPN (or adds manually) — nothing is auto-proposed.
 *
 * Previously this seeded a single TCU vs North Carolina game as a placeholder;
 * that was confusing because it showed up automatically every time someone
 * factory-reset. Now it's empty by design; if a user wants a starting slate,
 * they pull from ESPN's Available Games pool and pick from there.
 */
export const REAL_WEEK_1_2026_KNOWN_GAMES = [];

// ─── DEMO WEEK ────────────────────────────────────────────────────────────────

export const DEMO_WEEK = {
  weekId:'w_demo', season:'2026', weekNumber:0,
  label:'📋 Demo Week', roundLabel:'', espnWeekNumber:'',
  startDate:'2026-08-29', endDate:'2026-08-30',
  status: WEEK_STATUS.OPEN,
  dataSourceMode: DATA_SOURCE_MODE.DEMO,
  picksOpenAt:null, picksLockAt:null,
  showInHistory: false,   // hidden from standings Weekly History by default
  blurb:'📋 DEMO WEEK — Fictional games for testing the app. Not real matchups.',
  recap:'', emailSentAt:null,
  tiebreakerQuestion:'What is the total combined points scored by all alma mater teams on the slate this week?',
  tiebreakerType: TIEBREAKER_TYPE.ALMA_MATER_TOTAL,
  tiebreakerCalculationMode: TIEBREAKER_CALC_MODE.SELECTED_SLATE_ONLY,
  actualTiebreakerValue:null, tiebreakerFinalized:false,
  extraPointEnabled:true, extraPointActual:null, extraPointDetect:null,
  createdAt:'2026-01-01T00:00:00Z', updatedAt:'2026-01-01T00:00:00Z',
  lockedAt:null, finalizedAt:null,
  lockedAlmaMaters: null,
};

// Demo games. The `spread` field is SIGNED, home-perspective (AD-03): negative
// = home favored, positive = away favored. It is DISPLAYED as "FavoriteName
// -N" by formatSpread() in every case, so the stored sign is never visible on
// screen — which is exactly why it has to agree with `favorite` here. dg8
// (Alabama #3 at Michigan #6) is the one away-favored game on the slate and
// carried spread:-2.5 with favorite:'Alabama' until 2026-08-27: it rendered
// "Alabama -2.5" while scoring as Michigan -2.5. Corrected to +2.5; the
// rendered string is byte-identical either way. atstest.mjs §11 now asserts
// this agreement across every shipped fixture.
export const DEMO_GAMES = [
  { gameId:'dg1',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'Oklahoma',     awayTeam:'Temple',        homeConference:'SEC',     awayConference:'AAC',     homeRank:12, awayRank:null, kickoff:'2026-08-29T17:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-28.5, favorite:'Oklahoma',    lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg2',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'Texas A&M',    awayTeam:'Notre Dame',    homeConference:'SEC',     awayConference:'Ind',     homeRank:8,  awayRank:7,   kickoff:'2026-08-29T20:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'evening',   spread:-2.5,  favorite:'Texas A&M',   lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg3',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'USC',          awayTeam:'Utah',          homeConference:'Big Ten', awayConference:'Big 12',  homeRank:15, awayRank:20,  kickoff:'2026-08-29T23:30:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'late',      spread:-3.5,  favorite:'USC',         lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg4',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'Missouri',     awayTeam:'Arkansas',      homeConference:'SEC',     awayConference:'SEC',     homeRank:null,awayRank:null, kickoff:'2026-08-29T17:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-3.5,  favorite:'Missouri',    lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg5',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'Indiana',      awayTeam:'Purdue',        homeConference:'Big Ten', awayConference:'Big Ten', homeRank:null,awayRank:null, kickoff:'2026-08-29T12:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'morning',   spread:-7.0,  favorite:'Indiana',     lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg6',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'Georgia',      awayTeam:'Clemson',       homeConference:'SEC',     awayConference:'ACC',     homeRank:1,  awayRank:14,  kickoff:'2026-08-29T20:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'evening',   spread:-7.5,  favorite:'Georgia',     lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg7',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'Ohio State',   awayTeam:'Texas',         homeConference:'Big Ten', awayConference:'SEC',     homeRank:2,  awayRank:4,   kickoff:'2026-08-29T16:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-3.0,  favorite:'Ohio State',  lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg8',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'Michigan',     awayTeam:'Alabama',       homeConference:'Big Ten', awayConference:'SEC',     homeRank:6,  awayRank:3,   kickoff:'2026-08-29T20:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'evening',   spread:2.5,   favorite:'Alabama',     lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg9',  weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'Penn State',   awayTeam:'West Virginia', homeConference:'Big Ten', awayConference:'Big 12',  homeRank:10, awayRank:null, kickoff:'2026-08-29T14:30:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-17.5, favorite:'Penn State',  lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'dg10', weekId:'w_demo', espnEventId:null, dataQuality:'demo', dataSource:'demo', homeTeam:'LSU',          awayTeam:'Florida State', homeConference:'SEC',     awayConference:'ACC',     homeRank:9,  awayRank:18,  kickoff:'2026-08-29T23:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'late',      spread:-4.5,  favorite:'LSU',         lockedSpread:null, homeScore:null, awayScore:null, status:'scheduled', actualWinner:null, atsWinner:null, isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:null, venue:null, venueDisplay:null, neutralSite:false },
];

// ─── HISTORICAL DEMO WEEK ─────────────────────────────────────────────────────

export const HISTORICAL_DEMO_WEEK = {
  weekId:'hw1', season:'2025', weekNumber:2,
  label:'Historical Demo', roundLabel:'', espnWeekNumber:'2',
  startDate:'2025-09-13', endDate:'2025-09-14',
  status: WEEK_STATUS.OPEN,
  dataSourceMode: DATA_SOURCE_MODE.DEMO,
  picksOpenAt:null, picksLockAt:null,
  showInHistory: true,
  blurb:'📅 Historical Demo — Sept 13–14, 2025. Real final scores, pre-set spreads.',
  recap:'', emailSentAt:null,
  tiebreakerQuestion:'Total combined points scored by all alma mater teams on the slate?',
  tiebreakerType: TIEBREAKER_TYPE.ALMA_MATER_TOTAL,
  tiebreakerCalculationMode: TIEBREAKER_CALC_MODE.SELECTED_SLATE_ONLY,
  actualTiebreakerValue:201, tiebreakerFinalized:true,
  createdAt:'2025-09-01T00:00:00Z', updatedAt:'2025-09-01T00:00:00Z',
  lockedAt:'2025-09-13T11:00:00Z', finalizedAt:null,
  // Fixture predates F4 (2026-09-04) and never re-locked since — exercises
  // the "no snapshot on an already-locked week" fallback path on purpose
  // (almaMatersForAutoCalc() in app.js reads the live roster here, not this
  // null). Left null deliberately; do not backfill it.
  lockedAlmaMaters: null,
};

export const HISTORICAL_DEMO_GAMES = [
  { gameId:'hg1',  weekId:'hw1', espnEventId:'401628561', dataQuality:'demo', dataSource:'demo', homeTeam:'Oklahoma',     awayTeam:'Houston',        homeConference:'SEC',    awayConference:'Big 12',  homeRank:null,awayRank:null, kickoff:'2025-09-13T17:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-17.0, favorite:'Oklahoma',   lockedSpread:-17.0, homeScore:16, awayScore:12, status:'final', actualWinner:'Oklahoma',   atsWinner:'Houston',    isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T23:00:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg2',  weekId:'hw1', espnEventId:'401628562', dataQuality:'demo', dataSource:'demo', homeTeam:'Texas A&M',    awayTeam:'Florida',        homeConference:'SEC',    awayConference:'SEC',     homeRank:null,awayRank:null, kickoff:'2025-09-13T19:30:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'evening',   spread:-3.0,  favorite:'Texas A&M',  lockedSpread:-3.0,  homeScore:21, awayScore:8,  status:'final', actualWinner:'Texas A&M',  atsWinner:'Texas A&M', isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T23:30:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg3',  weekId:'hw1', espnEventId:'401628563', dataQuality:'demo', dataSource:'demo', homeTeam:'USC',          awayTeam:'Utah State',     homeConference:'Big Ten',awayConference:'Mtn West',homeRank:null,awayRank:null, kickoff:'2025-09-13T22:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'late',      spread:-21.0, favorite:'USC',        lockedSpread:-21.0, homeScore:42, awayScore:13, status:'final', actualWinner:'USC',        atsWinner:'USC',       isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-14T01:30:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg4',  weekId:'hw1', espnEventId:'401628564', dataQuality:'demo', dataSource:'demo', homeTeam:'Notre Dame',   awayTeam:'Miami (OH)',     homeConference:'Ind',    awayConference:'MAC',     homeRank:5,   awayRank:null, kickoff:'2025-09-13T17:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-28.0, favorite:'Notre Dame', lockedSpread:-28.0, homeScore:38, awayScore:7,  status:'final', actualWinner:'Notre Dame', atsWinner:'Notre Dame',isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T21:00:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg5',  weekId:'hw1', espnEventId:'401628565', dataQuality:'demo', dataSource:'demo', homeTeam:'Purdue',       awayTeam:'Indiana State',  homeConference:'Big Ten',awayConference:'FCS',     homeRank:null,awayRank:null, kickoff:'2025-09-13T19:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'evening',   spread:-24.0, favorite:'Purdue',     lockedSpread:-24.0, homeScore:49, awayScore:0,  status:'final', actualWinner:'Purdue',     atsWinner:'Purdue',    isAlmaMaterGame:true,  spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T22:30:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg6',  weekId:'hw1', espnEventId:'401628566', dataQuality:'demo', dataSource:'demo', homeTeam:'Arkansas',     awayTeam:'Louisiana Tech', homeConference:'SEC',    awayConference:'CUSA',    homeRank:null,awayRank:null, kickoff:'2025-09-13T17:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-14.0, favorite:'Arkansas',   lockedSpread:-14.0, homeScore:35, awayScore:14, status:'final', actualWinner:'Arkansas',   atsWinner:'Arkansas',   isAlmaMaterGame:true, spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T21:00:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg7',  weekId:'hw1', espnEventId:'401628567', dataQuality:'demo', dataSource:'demo', homeTeam:'Georgia',      awayTeam:'Kentucky',       homeConference:'SEC',    awayConference:'SEC',     homeRank:1,   awayRank:null, kickoff:'2025-09-13T20:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'evening',   spread:-10.5, favorite:'Georgia',    lockedSpread:-10.5, homeScore:13, awayScore:12, status:'final', actualWinner:'Georgia',    atsWinner:'Kentucky',  isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T23:30:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg8',  weekId:'hw1', espnEventId:'401628568', dataQuality:'demo', dataSource:'demo', homeTeam:'Ohio State',   awayTeam:'Western Michigan',homeConference:'Big Ten',awayConference:'MAC',    homeRank:3,   awayRank:null, kickoff:'2025-09-13T17:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-38.0, favorite:'Ohio State', lockedSpread:-38.0, homeScore:56, awayScore:0,  status:'final', actualWinner:'Ohio State', atsWinner:'Ohio State',isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T21:00:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg9',  weekId:'hw1', espnEventId:'401628569', dataQuality:'demo', dataSource:'demo', homeTeam:'Penn State',   awayTeam:'Bowling Green',  homeConference:'Big Ten',awayConference:'MAC',    homeRank:7,   awayRank:null, kickoff:'2025-09-13T16:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-35.0, favorite:'Penn State', lockedSpread:-35.0, homeScore:52, awayScore:0,  status:'final', actualWinner:'Penn State', atsWinner:'Penn State',isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T20:30:00Z', venue:null, venueDisplay:null, neutralSite:false },
  { gameId:'hg10', weekId:'hw1', espnEventId:'401628570', dataQuality:'demo', dataSource:'demo', homeTeam:'LSU',          awayTeam:'Nicholls',       homeConference:'SEC',    awayConference:'SLC',     homeRank:null,awayRank:null, kickoff:'2025-09-13T17:00:00Z', kickoffConfirmed:true, kickoffDateOnly:false, timeWindow:'afternoon', spread:-38.5, favorite:'LSU',        lockedSpread:-38.5, homeScore:44, awayScore:21, status:'final', actualWinner:'LSU',        atsWinner:'Nicholls',  isAlmaMaterGame:false, spreadSource:'manual', oddsProvider:null, lastUpdated:'2025-09-13T21:00:00Z', venue:null, venueDisplay:null, neutralSite:false },
];

export const HISTORICAL_DEMO_TIEBREAKER_VALUE = 201;
export const DEMO_PICKS = [];

// ─── FACTORY FUNCTIONS ────────────────────────────────────────────────────────

export function createPlayer(displayName, email='', pin='0000', almaMater='', initials='') {
  return {
    playerId:`p_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    displayName, initials, email, active:true, almaMater,
    pinHash:btoa(pin),
    // ── Notification fields (Phase III prep — SMS/email pick updates) ──
    // Populated later; safe defaults now so existing code and exports are stable.
    phone:'',                 // E.164 format, e.g. "+15125550123"
    phoneVerified:false,      // set true only after a verification flow (later)
    notifyPrefs:{             // per-channel, per-event opt-ins
      sms:   { enabled:false, picksOpen:false, picksReminder:false, gameFinal:false, weeklyRecap:false },
      email: { enabled:false, picksOpen:false, picksReminder:false, gameFinal:false, weeklyRecap:false },
    },
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
  };
}

export function createWeek(season, weekNumber, startDate='', endDate='') {
  // v0.16.0 — weeks carry Ischemic Extra Point fields (enabled/actual/detect)
  // v0.17.1 — weeks carry auto-transition config (auto-lock/auto-live/auto-final)
  // v0.17.7 (UN-118/UN-125) — weeks carry multi-part GROUP fields. A week
  // record is a scheduling unit (one lock time); `groupId` says which
  // COMPETITIVE week it belongs to when that competitive week can't share one
  // lock time (a split slate, bowls, CFP). null = this record IS its own
  // competitive week (the overwhelming common case). See
  // getEffectiveGroupId()/weeksInGroup() below — old records in the Sheet
  // lack these keys ENTIRELY (absent, not null); every reader here treats
  // absent and null identically via `||`/`!== true`.
  return {
    weekId:`w_${Date.now()}`,
    season, weekNumber,
    label:`Week ${weekNumber}`,
    roundLabel:'', espnWeekNumber:'',
    groupId: null,              // null | another week's weekId (the group's canonical id)
    isGroupTiebreaker: false,   // true on AT MOST one member — that member's tiebreaker breaks ties for the whole group
    startDate, endDate,
    status: WEEK_STATUS.DRAFT,
    dataSourceMode: DATA_SOURCE_MODE.MANUAL,
    picksOpenAt:null, picksLockAt:null,
    // Auto-transition config. Defaults preserve the previous behavior for
    // existing weeks (which lacked these fields) — a missing value is read as
    // the default in the accessor helpers below, so old data still works.
    // autoLockOffsetMinutes = minutes BEFORE first kickoff to auto-lock.
    // Commissioner can override picksLockAt to a specific time to bypass.
    autoLockOffsetMinutes: 30,
    autoLiveEnabled: true,        // auto-transition LOCKED → LIVE at first kickoff
    autoFinalizeEnabled: true,    // when all games final, mark ready for final confirm
    pendingFinalization: false,   // set true when auto-final trigger fires; commissioner confirms
    showInHistory: true,
    blurb:'', recap:'', emailSentAt:null,
    tiebreakerQuestion:'What is the total combined points scored by all alma mater teams on the slate this week?',
    tiebreakerType: TIEBREAKER_TYPE.ALMA_MATER_TOTAL,
    tiebreakerCalculationMode: TIEBREAKER_CALC_MODE.SELECTED_SLATE_ONLY,
    actualTiebreakerValue:null, tiebreakerFinalized:false,
    extraPointEnabled:true, extraPointActual:null, extraPointDetect:null,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    lockedAt:null, finalizedAt:null,
    // F4 (2026-09-04) — mirrors lockedSpread's shape exactly, one level up:
    // a snapshot of claimedAlmaMaters() taken the instant the week
    // transitions to LOCKED (applyWeekStatusChange() and the auto-lock leg
    // of tickAutoTransition() in app.js — the only two places a week
    // becomes LOCKED), so a claim edit or player deactivation AFTER lock
    // can never silently move the tiebreaker Auto-Calc's answer out from
    // under picks players already submitted against it. null until then.
    // Old Sheet rows locked before this field existed lack it entirely
    // (absent, not null) — almaMatersForAutoCalc() in app.js falls back to
    // the LIVE roster for those rather than throwing or reading an empty
    // list as "genuinely zero schools claimed."
    lockedAlmaMaters: null,
  };
}

// Read helpers for auto-transition config with safe defaults for pre-v0.17.1 weeks.
export function getAutoLockOffsetMinutes(week) {
  const v = week?.autoLockOffsetMinutes;
  return Number.isFinite(v) && v >= 0 ? v : 30;
}
export function getAutoLiveEnabled(week) {
  return week?.autoLiveEnabled !== false; // default true
}
export function getAutoFinalizeEnabled(week) {
  return week?.autoFinalizeEnabled !== false; // default true
}

// ─── MULTI-PART WEEK GROUPING (UN-118/UN-125, v0.17.7) ───────────────────────
// A week RECORD is a scheduling unit (one lock time, derived by
// computeEffectiveLockAt() in scoring.js). A competitive week is what players
// actually compete over and win a prize for. They diverge whenever one real
// week's games can't share a lock time. These four helpers are the ONLY
// place group membership is resolved — never re-derive it ad hoc (same
// discipline as AD-20's shared-mapping rule). Zero imports here, so
// scoring.js and app.js can both pull from this file safely.

/**
 * The canonical id of the COMPETITIVE week `week` belongs to. A week with no
 * `groupId` (including old records that never had the field at all) is its
 * own group, keyed by its own weekId — so every singleton week (still the
 * overwhelming common case) behaves identically whether or not grouping
 * exists in the app at all.
 */
export function getEffectiveGroupId(week) {
  return (week && week.groupId) || (week ? week.weekId : null);
}

/**
 * Every week record that shares `week`'s effective group id, `allWeeks`
 * included. A singleton week's own array always has length 1 (itself).
 */
export function weeksInGroup(allWeeks, week) {
  if (!week) return [];
  const gid = getEffectiveGroupId(week);
  return (allWeeks || []).filter(w => getEffectiveGroupId(w) === gid);
}

/**
 * The ONE member whose tiebreaker guess/actual answer counts for the whole
 * group. Drew's ruling: the commissioner ticks exactly one member
 * (`isGroupTiebreaker`); if none is ticked (or, defensively, more than one
 * is — the UI is meant to prevent that but this stays fail-safe either way),
 * fall back to the highest-`weekNumber` member. Always returns a week for a
 * non-empty input; the caller checks `isGroupTiebreakerAmbiguous()`
 * separately to decide whether to warn about the fallback.
 */
export function getGroupTiebreakerWeek(groupWeeks) {
  if (!groupWeeks || !groupWeeks.length) return null;
  const flagged = groupWeeks.filter(w => w.isGroupTiebreaker === true);
  if (flagged.length === 1) return flagged[0];
  return [...groupWeeks].sort((a, b) => (b.weekNumber ?? 0) - (a.weekNumber ?? 0))[0] || null;
}

/** True when the group has no single, unambiguous tiebreaker-of-record. */
export function isGroupTiebreakerAmbiguous(groupWeeks) {
  if (!groupWeeks || groupWeeks.length <= 1) return false;
  const flagged = groupWeeks.filter(w => w.isGroupTiebreaker === true);
  return flagged.length !== 1;
}

// ─── ESPN MULTI-SPORT ENDPOINTS ──────────────────────────────────────────────
// Base path map for ESPN's public scoreboard API. Same shape for every sport,
// so one polling routine can serve CFB + NFL (and easily extend).
// Doc reference: site.api.espn.com/apis/site/v2/sports/<sport>/<league>/scoreboard
export const ESPN_SPORT_ENDPOINTS = {
  'college-football': {
    label: 'College Football',
    path: 'football/college-football',
    // A CFB event ID is what the existing pipeline uses; nothing new to do here.
  },
  'nfl': {
    label: 'NFL',
    path: 'football/nfl',
  },
  // Extend by adding more entries as needed — the fetcher is generic.
};

/** Resolve the ESPN base path for a game's sport, defaulting to CFB. */
export function espnSportPath(sportKey) {
  const s = ESPN_SPORT_ENDPOINTS[sportKey || 'college-football'];
  return s ? s.path : ESPN_SPORT_ENDPOINTS['college-football'].path;
}

export function createGame(weekId, overrides={}) {
  return {
    gameId:`g_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    weekId, espnEventId:null,
    dataQuality: DATA_QUALITY.MANUAL,
    dataSource:  DATA_SOURCE_MODE.MANUAL,
    homeTeam:'', awayTeam:'',
    homeMascot:'', awayMascot:'',
    homeConference:'', awayConference:'',
    homeRank:null, awayRank:null,
    kickoff:null,
    kickoffConfirmed: false,
    kickoffDateOnly:  false,
    timeWindow:'afternoon',
    spread:null, favorite:null, spreadSource:'manual', oddsProvider:null,
    lockedSpread:null,
    homeScore:null, awayScore:null,
    status:'scheduled', actualWinner:null, atsWinner:null,
    isAlmaMaterGame:false,
    // DI-7 (Commissioner Slate Builder) — derived at ESPN parse time from
    // comp.broadcasts[] (see data-provider.js detectNationalTV()). Old/manual
    // records simply lack these fields; every read site treats undefined the
    // same as false/null, so no migration is required.
    nationalTV:false, broadcastNetwork:null,
    // Scoring-only signal (DI-2 "marquee event" bonus) — no render path, so
    // unlike nationalTV/broadcastNetwork it never needs to survive an
    // add-to-slate action; it only has to be present on the AVAILABLE GAMES
    // pool at parse time so computeScore() can see it while building the
    // suggested slate.
    marqueeEvent:false,
    venue:null, venueDisplay:null, neutralSite:false,
    // Scoring multiplier — default 1.0 keeps behavior identical to pre-multiplier
    // weeks. Commissioner sets 2 (or 1.5, 3, etc.) for marquee/rivalry/playoff
    // games. Wins AND losses scale equally by this factor so a 2x game gives
    // +2 or -2 in the standings math. Tiebreakers are NOT multiplied — they
    // remain a separate numeric guess used only for tiebreaks.
    multiplier: 1,
    // Manual / out-of-league game flag. When true the game is NOT part of the
    // normal ESPN CFB pipeline — it's an ad-hoc pick the commissioner added
    // (e.g. NFL Thanksgiving). Manual games still flow through the SAME
    // scoring pipeline as CFB games (multiplier, spread, results) — the flag
    // just controls UI cues (league chip, ESPN link visibility, refresh sport).
    isManual: false,
    leagueLabel: '',      // e.g. "NFL", "Special", "Thanksgiving" — shown as a small chip
    // Multi-sport ESPN linking for manual games. When espnEventId + espnSport
    // are both set on a manual game, the auto-refresh pipeline queries the
    // matching ESPN scoreboard so live scores update the same way they do for
    // CFB. Values are the string keys used by `ESPN_SPORT_ENDPOINTS` below.
    // Unset → the game stays fully manual (commissioner types scores).
    espnSport: null,      // 'nfl' | 'college-football' | null
    lastUpdated:null,
    createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    ...overrides,
  };
}

export function createPick(weekId, gameId, playerId, selectedTeam) {
  return {
    pickId:`pk_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,
    weekId, gameId, playerId, selectedTeam,
    selectedAt:new Date().toISOString(), updatedAt:new Date().toISOString(),
    locked:false, result:'pending',
  };
}

// ─── SPREAD DISPLAY ───────────────────────────────────────────────────────────

/**
 * Format spread for display: always "FavoredTeam -N.N"
 * Never shows plus sign. Always shows negative for the favorite.
 * If favorite is missing, derives it from spread sign + game.homeTeam/awayTeam.
 * Examples:
 *   formatSpread(-6.5, 'TCU')                              → "TCU -6.5"
 *   formatSpread(7.0, 'Indiana')                           → "Indiana -7.0"
 *   formatSpread(-6.5, null, {homeTeam:'TCU',awayTeam:'UNC'})→ "TCU -6.5"
 *   formatSpread(7.0,  null, {homeTeam:'IU',awayTeam:'PU'})  → "PU -7.0"
 *   formatSpread(0,    null, {homeTeam:'A',awayTeam:'B'})    → "PK"
 *   formatSpread(null)                                     → "TBD"
 */
export function formatSpread(spread, favorite, game = null) {
  if (spread === null || spread === undefined) return 'TBD';
  let fav = favorite || null;

  // If favorite not explicitly given, derive from spread sign + game teams
  if (!fav && game) {
    if (spread < 0)      fav = game.homeTeam;
    else if (spread > 0) fav = game.awayTeam;
    // spread === 0 stays Pick'em (no favorite)
  }

  const abs = Math.abs(spread);
  if (spread === 0) return fav ? `${fav} PK` : 'PK';
  if (!fav) return spread < 0 ? `-${abs}` : `+${abs}`;
  return `${fav} -${abs}`;
}

// ─── DATE / LABEL HELPERS ─────────────────────────────────────────────────────

/**
 * DI-135 — shared composition rule for the three label helpers below.
 * `espnWeekNumber` (when non-blank) overrides the DISPLAYED week number only
 * — it never touches `week.weekNumber` itself, which stays the ordering/
 * identity key everywhere else. `roundLabel` is a SUFFIX appended after the
 * display number ("Week 1, Part 2"), not a full replacement. The demo/
 * historical special-case label wins over both, unchanged from before.
 */
function resolveWeekDisplayNumber(week) {
  const overrideRaw = (week?.espnWeekNumber ?? '').toString().trim();
  return overrideRaw !== '' ? overrideRaw : week?.weekNumber;
}

function composeWeekNamePart(week) {
  if (week.label?.startsWith('📋') || week.label?.startsWith('Historical')) return week.label;
  const displayNumber = resolveWeekDisplayNumber(week);
  return week.roundLabel
    ? `Week ${displayNumber}, ${week.roundLabel}`
    : `Week ${displayNumber}`;
}

export function formatWeekLabel(week) {
  if (!week) return '';
  const weekPart = composeWeekNamePart(week);

  if (week.dataSourceMode === 'demo') return weekPart;
  if (week.startDate && week.endDate && week.startDate !== week.endDate) {
    return `${weekPart} — ${fmtDate(week.startDate)}–${fmtDate(week.endDate)}`;
  }
  if (week.startDate) return `${weekPart} — ${fmtDate(week.startDate)}`;
  return weekPart;
}

/**
 * UN-117 — the same label, split into its two meaningful parts.
 *
 * Drew: "I dont like how it has week, then on the same line half the date
 * range and a line below the other half. Would look cleaner to have the Week
 * Name and Number on one line and the date range on another line below it."
 *
 * The single-line `formatWeekLabel()` above is deliberately LEFT ALONE. It has
 * ~20 call sites — <option> text, CSV cells, confirm() dialogs, email subjects,
 * the obligations table — where a line break is either meaningless or actively
 * wrong. Changing it to satisfy two display surfaces would have broken all of
 * them. This returns the parts and lets the caller decide the layout.
 *
 * `name` is always present. `dates` is '' for demo weeks and for weeks with no
 * dates on file, so callers can render the second line conditionally rather
 * than emitting an empty element that still claims vertical space.
 *
 * DI-A2 (2026-09-09): `collapseYear` is an OPT-IN option, default false. When
 * true and startDate/endDate share a calendar year, the leading date drops its
 * year — "Sep 3, 2026–Sep 7, 2026" becomes "Sep 3 – Sep 7, 2026" — since
 * repeating the year twice in one line is noise once the header is the only
 * caller asking for it. A CROSS-YEAR range (Dec 30, 2026 – Jan 2, 2027) must
 * never lose either year, so the check falls straight through to the
 * unmodified two-full-dates format whenever the years differ, regardless of
 * the flag. Every other existing caller omits the option and gets the exact
 * same string as before this change — verified byte-identical in
 * headermetatest.mjs.
 */
export function formatWeekLabelParts(week, { collapseYear = false } = {}) {
  if (!week) return { name: '', dates: '' };
  const name = composeWeekNamePart(week);

  if (week.dataSourceMode === 'demo') return { name, dates: '' };
  if (week.startDate && week.endDate && week.startDate !== week.endDate) {
    if (collapseYear) {
      const startYear = new Date(week.startDate + 'T12:00:00').getFullYear();
      const endYear = new Date(week.endDate + 'T12:00:00').getFullYear();
      if (startYear === endYear) {
        return { name, dates: `${fmtDate(week.startDate, { omitYear: true })} – ${fmtDate(week.endDate)}` };
      }
    }
    return { name, dates: `${fmtDate(week.startDate)}–${fmtDate(week.endDate)}` };
  }
  if (week.startDate) return { name, dates: fmtDate(week.startDate) };
  return { name, dates: '' };
}

/**
 * UN-118/UN-125 — one label for a whole competitive-week GROUP, for surfaces
 * (Weekly History) that must show ONE row per group rather than one per
 * scheduling record. A singleton group (`memberWeeks.length <= 1`) returns
 * `formatWeekLabel()`'s OWN string, unchanged — every existing single-week
 * caller's output is untouched by this function existing at all.
 */
export function formatWeekGroupLabel(memberWeeks) {
  if (!memberWeeks || !memberWeeks.length) return '';
  if (memberWeeks.length === 1) return formatWeekLabel(memberWeeks[0]);
  const sorted = [...memberWeeks].sort((a, b) => (a.weekNumber ?? 0) - (b.weekNumber ?? 0));
  const labels = sorted.map(w => composeWeekNamePart(w));
  const unique = [...new Set(labels)];
  // Members sharing one plain label (e.g. two parts both left roundLabel
  // blank, same weekNumber) collapse to "Week N (2 parts)" rather than
  // repeating the identical string, which would read as a mistake, not a
  // grouping. Members with genuinely distinct labels (e.g. custom round
  // labels "1.1"/"1.2", or a bowl + a CFP round) are listed out.
  return unique.length === 1 ? `${unique[0]} (${sorted.length} parts)` : labels.join(' + ');
}

// DI-A2 (2026-09-09): `omitYear` is opt-in, default false, so every existing
// caller (there was only ever one signature before this) keeps its year and
// its exact prior string. formatWeekLabelParts() is the only caller that ever
// passes `omitYear: true`, and only for the leading date of a same-year range.
function fmtDate(ds, { omitYear = false } = {}) {
  if (!ds) return '';
  try {
    const opts = { month: 'short', day: 'numeric' };
    if (!omitYear) opts.year = 'numeric';
    return new Date(ds+'T12:00:00').toLocaleDateString('en-US', opts);
  }
  catch { return ds; }
}

export function sourceModeLabelOf(mode) {
  return { demo:'Demo', espn_live:'ESPN Live', espn_historical:'ESPN Historical', manual:'Manual', proposed:'Proposed' }[mode] || mode || '—';
}

/**
 * Format kickoff time with TBD awareness.
 */
export function formatGameTime(isoTime, tzKey='PT', game=null) {
  const confirmed = game?.kickoffConfirmed ?? true;
  const dateOnly  = game?.kickoffDateOnly  ?? false;
  if (!isoTime) return 'TBD';
  const tz = TIME_ZONES.find(z=>z.key===tzKey) || TIME_ZONES[0];
  try {
    const d    = new Date(isoTime);
    const day  = d.toLocaleDateString('en-US',{weekday:'short',timeZone:tz.iana});
    const date = d.toLocaleDateString('en-US',{month:'numeric',day:'numeric',timeZone:tz.iana});
    if (dateOnly || !confirmed) return `${day} ${date} · Time TBD`;
    const time = d.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:tz.iana});
    return `${day} ${date} ${time} ${tzKey}`;
  } catch { return 'TBD'; }
}

export function formatVenueDisplay(game) {
  if (!game) return null;
  if (game.venueDisplay) return game.venueDisplay;
  if (game.venue) return game.venue;
  return null;
}

/** Get player initials — use stored initials if set, else first letter of display name */
export function getPlayerInitials(player) {
  if (!player) return '?';
  return player.initials || player.displayName?.charAt(0)?.toUpperCase() || '?';
}

/**
 * Classify how "ready" a game's data is, for validation / warning UX.
 * Returns { ready:boolean, level:'ok'|'warn'|'incomplete', issues:[...] }.
 *
 *  - 'ok'         : has both teams, a confirmed kickoff time, and a spread
 *  - 'warn'       : usable but missing something soft (time TBD or spread TBD)
 *  - 'incomplete' : missing required data (no teams, or no date at all) — should
 *                   NOT be presented to players as a normal game
 *
 * This replaces ad-hoc "is the kickoff null" checks scattered across the UI and
 * gives the Commissioner panel a single source of truth for the pending state.
 */
export function gameDataReadiness(game) {
  const issues = [];
  if (!game) return { ready:false, level:'incomplete', issues:['No game'] };

  if (!game.homeTeam || !game.awayTeam) issues.push('Missing team name(s)');

  const hasDate = !!game.kickoff;
  if (!hasDate) {
    issues.push('No kickoff date set');
  } else if (game.kickoffDateOnly || game.kickoffConfirmed === false) {
    issues.push('Kickoff time not confirmed (date only)');
  }

  const sv = game.lockedSpread !== null && game.lockedSpread !== undefined ? game.lockedSpread : game.spread;
  if (sv === null || sv === undefined) {
    // A finalized game legitimately may have no spread; only warn pre-final.
    if (game.status !== GAME_STATUS.FINAL) issues.push('No spread set');
  }

  // Determine level
  let level;
  if (!game.homeTeam || !game.awayTeam || !hasDate) {
    level = 'incomplete';
  } else if (issues.length) {
    level = 'warn';
  } else {
    level = 'ok';
  }
  return { ready: level !== 'incomplete', level, issues };
}


// ── Team abbreviations (SHARED SOURCE) ───────────────────────────────────────
// Moved here from app.js in v0.17.2 so the compact dashboard, the picks page,
// and chat all render identical shorthand. data-model.js has no imports, so
// every other module can pull from it without a cycle.
// DO NOT create a second mapping anywhere. Import buildAbbrMap from here.

export const TEAM_ABBR = {
  // SEC
  'Alabama':'BAMA','Arkansas':'ARK','Auburn':'AUB','Florida':'FLA','Georgia':'UGA',
  'Kentucky':'UK','LSU':'LSU','Mississippi':'OLE','Ole Miss':'OLE','Mississippi State':'MSST',
  'Missouri':'MIZZ','Oklahoma':'OU','South Carolina':'SCAR','Tennessee':'TENN','Texas':'TEX',
  'Texas A&M':'TAMU','Vanderbilt':'VAN',
  // Big Ten
  'Illinois':'ILL','Indiana':'IND','Iowa':'IOWA','Maryland':'MD','Michigan':'MICH',
  'Michigan State':'MSU','Minnesota':'MINN','Nebraska':'NEB','Northwestern':'NW','Ohio State':'OSU',
  'Oregon':'ORE','Penn State':'PSU','Purdue':'PUR','Rutgers':'RUT','UCLA':'UCLA','USC':'USC',
  'Washington':'WASH','Wisconsin':'WISC',
  // Big 12
  'Arizona':'ARIZ','Arizona State':'ASU','Baylor':'BAY','BYU':'BYU','Cincinnati':'CIN',
  'Colorado':'COLO','Houston':'HOU','Iowa State':'ISU','Kansas':'KU','Kansas State':'KSU',
  'Oklahoma State':'OKST','TCU':'TCU','Texas Tech':'TTU','UCF':'UCF','Utah':'UTAH',
  'West Virginia':'WVU',
  // ACC
  'Boston College':'BC','California':'CAL','Clemson':'CLEM','Duke':'DUKE','Florida State':'FSU',
  'Georgia Tech':'GT','Louisville':'LOU','Miami':'MIA','NC State':'NCST','North Carolina':'UNC',
  'Notre Dame':'ND','Pittsburgh':'PITT','SMU':'SMU','Stanford':'STAN','Syracuse':'SYR',
  'Virginia':'UVA','Virginia Tech':'VT','Wake Forest':'WAKE',
  // AAC + selected G5
  'Army':'ARMY','Charlotte':'CHAR','East Carolina':'ECU','Florida Atlantic':'FAU','Memphis':'MEM',
  'Navy':'NAVY','North Texas':'UNT','Rice':'RICE','South Florida':'USF','Temple':'TEMP',
  'Tulane':'TULN','Tulsa':'TLSA','UAB':'UAB','UTSA':'UTSA',
  // Mountain West
  'Air Force':'AF','Boise State':'BOIS','Colorado State':'CSU','Fresno State':'FRES',
  'Hawaii':'HAW','Nevada':'NEV','New Mexico':'UNM','San Diego State':'SDSU','San Jose State':'SJSU',
  'UNLV':'UNLV','Utah State':'USU','Wyoming':'WYO',
  // Sun Belt
  'Appalachian State':'APP','Arkansas State':'ARST','Coastal Carolina':'CCAR','Georgia Southern':'GASO',
  'Georgia State':'GAST','James Madison':'JMU','Louisiana':'ULL','Louisiana Monroe':'ULM',
  'Marshall':'MARS','Old Dominion':'ODU','South Alabama':'USA','Southern Miss':'USM',
  'Texas State':'TXST','Troy':'TROY',
  // MAC
  'Akron':'AKR','Ball State':'BALL','Bowling Green':'BGSU','Buffalo':'BUFF','Central Michigan':'CMU',
  'Eastern Michigan':'EMU','Kent State':'KENT','Massachusetts':'UMASS','Miami (OH)':'M-OH',
  'Northern Illinois':'NIU','Ohio':'OHIO','Toledo':'TOL','Western Michigan':'WMU',
  // CUSA
  'FIU':'FIU','Jacksonville State':'JVST','Liberty':'LIB','Louisiana Tech':'LT','Middle Tennessee':'MTSU',
  'New Mexico State':'NMSU','Sam Houston':'SHSU','UTEP':'UTEP','Western Kentucky':'WKU',
  // Independents
  'Connecticut':'UCONN','UConn':'UCONN',

  // ── ESPN long-form / alternate location strings ────────────────────────────
  // homeTeam/awayTeam come from ESPN's `team.location` (data-provider.js ~L280),
  // which is NOT stable across schools or seasons — some return the marketing
  // initialism ("USC"), some the full school name ("Southern California").
  // A miss here silently degrades to the initials fallback, which is how
  // "Southern California" rendered as "SC" while the dashboard said "USC".
  // Every alias below resolves to a school ALREADY keyed above — these add no
  // new abbreviations, they only stop known schools falling through.
  'Southern California':'USC',        // corroborated: ALMA_MATER_EXACT_PATTERNS.USC, this file
  'Miami (FL)':'MIA',                 // disambiguated counterpart of 'Miami (OH)'
  'Louisiana State':'LSU',
  'Texas Christian':'TCU',
  'Brigham Young':'BYU',
  'Central Florida':'UCF',
  'Southern Methodist':'SMU',
  'North Carolina State':'NCST',
  'Florida International':'FIU',
  'Middle Tennessee State':'MTSU',
  'Southern Mississippi':'USM',
  'Sam Houston State':'SHSU',
  'Army West Point':'ARMY',
  'Pitt':'PITT',
  'UMass':'UMASS',
  // Hawaii ships with three different apostrophes depending on the feed:
  // ASCII ('), typographic (’), and the Hawaiian okina (ʻ). All are one school.
  "Hawai'i":'HAW','Hawai’i':'HAW','Hawaiʻi':'HAW',
  // San Jose State's ESPN location carries the accent.
  'San José State':'SJSU',
  // Louisiana's two branch campuses appear hyphenated and as "UL X".
  'Louisiana-Lafayette':'ULL','UL Lafayette':'ULL',
  'Louisiana-Monroe':'ULM','UL Monroe':'ULM',
};

/**
 * Build a Map<schoolName, uniqueAbbr> for all teams in a list of games.
 * Falls back to a smart-truncate for unknown schools, then runs a dedup pass
 * so no two teams in the same render share an abbreviation (appending the
 * first letter of the dropped word, e.g. "Sam Houston State" vs "Texas State"
 * → SHSU vs TXST already; "X State" vs "X State" gets X-1, X-2 as last resort).
 */
export function buildAbbrMap(games) {
  const map = new Map();
  const smartTrunc = (name) => {
    if (!name) return '';
    if (TEAM_ABBR[name]) return TEAM_ABBR[name];
    const words = name.split(/\s+/).filter(Boolean);
    // Single-word names: take first 4 chars uppercase.
    if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
    // Multi-word: take first letter of each word, max 5 chars (handles "A&M" specifically).
    const initials = words.map(w => w.replace(/[^A-Za-z&]/g,'').charAt(0)).join('').toUpperCase().slice(0,5);
    return initials || words[0].slice(0,4).toUpperCase();
  };

  const teams = new Set();
  for (const g of games) {
    if (g.homeTeam) teams.add(g.homeTeam);
    if (g.awayTeam) teams.add(g.awayTeam);
  }
  // First pass: assign best-known abbreviation
  for (const t of teams) map.set(t, smartTrunc(t));

  // Dedup pass: any two teams sharing an abbreviation get suffixed
  const byAbbr = new Map();
  for (const [team, abbr] of map) {
    if (!byAbbr.has(abbr)) byAbbr.set(abbr, []);
    byAbbr.get(abbr).push(team);
  }
  for (const [abbr, teamList] of byAbbr) {
    if (teamList.length === 1) continue;
    // Try to use a more distinctive abbreviation — take first 3 chars of the
    // first DIFFERENT word in each name. If still colliding, add a numeric suffix.
    teamList.forEach((team, i) => {
      const words = team.split(/\s+/).filter(Boolean);
      // Pick the first word that's distinctive (not "State", "University" etc.)
      const distinctive = words.find(w => !/^(state|university|college|the|of)$/i.test(w)) || words[0];
      const candidate = (distinctive.slice(0,3) + abbr.slice(-1)).toUpperCase();
      map.set(team, candidate);
    });
    // After replacement, do one final dedup check — append numeric suffix to any still-colliding
    const seen = new Map();
    for (const team of teamList) {
      const a = map.get(team);
      if (!seen.has(a)) { seen.set(a, 1); }
      else { const n = seen.get(a) + 1; seen.set(a, n); map.set(team, a.slice(0, 3) + n); }
    }
  }
  return map;
}

/**
 * Shorthand for one team, using the shared table with the same smart-truncate
 * fallback as buildAbbrMap. Use buildAbbrMap when you have a slate — it also
 * dedups across the render so two teams never share an abbreviation.
 */
export function teamAbbr(name) {
  if (!name) return '';
  if (TEAM_ABBR[name]) return TEAM_ABBR[name];
  const words = String(name).split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 4).toUpperCase();
  const initials = words.map(w => w.replace(/[^A-Za-z&]/g, '').charAt(0)).join('').toUpperCase().slice(0, 5);
  return initials || words[0].slice(0, 4).toUpperCase();
}

// ─── DEBT-PAYMENT APPROVAL (UN-89) ─────────────────────────────────────────
// One state machine, shared by BOTH the current-season obligation ledger
// (`cfbp_obligations`, full records) and the 2K25 carryover ledger
// (`settings.ob2025`, a status-map overlay on baked history — see
// history-2025.js `ob2025Status()`). Both shapes carry `payerPlayerId` /
// `recipientPlayerId`, so obligationRole()/obligationNextStatus() work
// unmodified against either one. Pure — no storage access — so every
// transition is unit-testable without a DOM.

/** Status → { label, badgeClass }. ONE table so Standings, the commissioner
 *  Players-tab card, and the 2K25 carryover card can never disagree about
 *  what a status is called or which (pre-existing) badge color it gets.
 *  Reuses existing badge classes only — no new CSS variable, no theme risk. */
export const OBLIGATION_STATUS_DISPLAY = {
  unpaid:  { label: 'Unpaid',  badgeClass: 'badge-locked' },
  pending: { label: 'Pending', badgeClass: 'badge-nd' },
  paid:    { label: 'Paid ✓',  badgeClass: 'badge-open' },
  waived:  { label: 'Waived',  badgeClass: 'badge-final' },
};
export function obligationStatusDisplay(status) {
  return OBLIGATION_STATUS_DISPLAY[status] || OBLIGATION_STATUS_DISPLAY.unpaid;
}

/**
 * UN-126 — one predicate so every surface (Weekly History, the Players-tab
 * ledger, storage.js's getActiveObligations(), the Data-tab Obligation
 * Corrections tool) agrees about what "voided" means, same discipline as
 * obligationStatusDisplay() above. `voided` is independent of `status` —
 * paid/unpaid/pending/waived describe the DEBT's payment state; voided
 * describes whether the RECORD itself still counts at all (it was a
 * bookkeeping duplicate, or got folded into another record by a merge).
 * Old rows lack the field entirely and read as active (CONVENTIONS #10).
 */
export function isObligationActive(ob) {
  return !!ob && ob.voided !== true;
}

/**
 * A viewer's relationship to one obligation. Priority: admin > creditor >
 * payer > bystander. An admin who ALSO happens to be the payer or the
 * creditor still gets commissioner-level authority — the spec's rule is that
 * the commissioner's own action always IS the verification, with no carve-out
 * for "unless it's their own debt." `sess` is `{isAdmin, playerId}` (the
 * shape `getSession()` already returns).
 */
export function obligationRole(sess, ob) {
  const isAdmin = !!sess?.isAdmin;
  const playerId = sess?.playerId;
  if (isAdmin) return 'admin';
  if (playerId && ob && playerId === ob.recipientPlayerId) return 'creditor';
  if (playerId && ob && playerId === ob.payerPlayerId) return 'payer';
  return 'bystander';
}

/**
 * Pure obligation state-machine transition. Returns the NEXT status string,
 * or `null` if this (status, role, action) combination is not a legal move —
 * callers must refuse the action (and re-check role server-side; the UI
 * hiding a button is not a permission boundary by itself).
 *
 *   unpaid  --payer "mark"-->             pending   (needs confirmation)
 *   unpaid  --creditor/admin "mark"-->    paid      (their action IS the verification)
 *   pending --creditor/admin "confirm"--> paid
 *   pending --creditor/admin "deny"-->    unpaid
 *   paid    --admin "undo"-->             unpaid    (pre-existing affordance, unchanged)
 *
 * Nothing here ever multiplies or scores anything (CONVENTIONS #22-23) —
 * obligations are drink debts, not pick results.
 */
export function obligationNextStatus(status, role, action) {
  if (status === 'unpaid' && action === 'mark') {
    if (role === 'payer') return 'pending';
    if (role === 'creditor' || role === 'admin') return 'paid';
    return null;
  }
  if (status === 'pending' && action === 'confirm' && (role === 'creditor' || role === 'admin')) return 'paid';
  if (status === 'pending' && action === 'deny' && (role === 'creditor' || role === 'admin')) return 'unpaid';
  if (status === 'paid' && action === 'undo' && role === 'admin') return 'unpaid';
  return null;
}
