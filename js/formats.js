/**
 * CFB Pickems - formats.js (D2 lane 2, DI-910 / DI-911 / DI-912 / DI-914 / DI-915 / DI-916; UN-515 / PF-515)
 * ============================================================================================================
 * Pick formats: HOW a sport's slate is graded, and the one place that says so. A PURE LEAF: it imports nothing, reads no storage and no clock, so the Week Wizard, the Picks page, the
 * Dashboard, the CSV and the Edge twin all read the same answers.
 *
 * A CLOSED SET OF TWO (DI-910):
 *   `ats`        against the spread. The graded market is the spread (the puck line, 1.5, in hockey). The stored `game.spread` is the signed home-perspective number (AD-03, unchanged).
 *   `moneyline`  pick the winner. There is NO line: `game.spread` is exactly 0 with `favorite` null and `spreadSource 'format'` (DI-912), written by `applyFormatToGame` and nothing else.
 * Over/Under as a PICK does not exist in this release (it would need a scoring edit and a new pick shape): there is no registry entry, and a static test fails if one appears. The total is
 * INFORMATION only (DI-918/920).
 *
 * WHICH SPORTS OFFER WHICH (RPF-C1, Drew D-113/D-114): college football `ats` only; NFL `ats` (default) and `moneyline`; NHL `moneyline` (default) and `ats` (the puck line). The list is
 * `profile.formats.offered`; this module never hard-codes a sport.
 *
 * EXISTING LEAGUES ARE UNTOUCHED (DI-910): a competition or week with no `format` resolves to `ats` for football, every football week that exists grades exactly as before.
 *
 * ── MONEYLINE GRADING (Drew, round 3, 2026-10-19: "Zero line, no scoring edit"; DI-913) ─────────────────────────────────────────────────────────────────────────────────────────────
 * A pick-the-winner game is stored with `spread` exactly 0 (`applyFormatToGame`) and graded straight up by the EXISTING grader, `calculateAtsWinner` in js/scoring.js, which is NOT edited
 * (formatgradetest pins the file's bytes to the base commit's through git). A tied final on a 0 line is No Decision (a push, 0 points), exactly as a football exact-spread tie: the rules table says so
 * ("Exact spread tie = No Decision"), and a hockey final cannot tie (a tie is a data error the write gate refuses, DI-925). Every printed "PK" routes through ONE formatter, `lineText`.
 */

/** The two formats, in the order a sheet lists them when a sport offers both. */
export const FORMAT_KEYS = Object.freeze(['ats', 'moneyline']);

const has = (o, k) => o != null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** True for a format value this registry knows. */
export function isFormat(v) {
  return typeof v === 'string' && FORMAT_KEYS.includes(v);
}

/** True when the format is "pick the winner" (no line exists). */
export function isPickTheWinner(format) {
  return format === 'moneyline';
}

/** The formats a profile offers, default first; a profile with no `formats` slot offers `ats` only (the pre-D2 behaviour). Never throws. */
export function offeredFormats(profile) {
  const o = profile && profile.formats && Array.isArray(profile.formats.offered) ? profile.formats.offered.filter(isFormat) : [];
  return o.length ? o : ['ats'];
}

/** The format a sport defaults to (its first offered, honouring `formats.default` when it is offered). */
export function defaultFormat(profile) {
  const d = profile && profile.formats && profile.formats.default;
  const offered = offeredFormats(profile);
  return isFormat(d) && offered.includes(d) ? d : offered[0];
}

/**
 * Resolve the format in force: the week's own stamp, then the competition's `settings.format`, then the profile default. A value that is not a known format, or is not OFFERED by the
 * profile, is ignored (a stray value never changes grading). Answers which tier spoke, the shipped four-source contract.
 * `week` and `competition` may be null.
 */
export function resolveFormat({ profile = null, competition = null, week = null } = {}) {
  const offered = offeredFormats(profile);
  if (has(week, 'format') && isFormat(week.format) && offered.includes(week.format)) return { format: week.format, source: 'week' };
  const cs = competition && competition.settings;
  if (has(cs, 'format') && isFormat(cs.format) && offered.includes(cs.format)) return { format: cs.format, source: 'competition' };
  return { format: defaultFormat(profile), source: 'default' };
}

/** The name a sheet or a tag shows for a sport's format: "Against the spread", "Pick the winner", or "Puck line" (hockey's spread). */
export function formatLabel(profile, format) {
  if (format === 'moneyline') return 'Pick the winner';
  if (profile && profile.key === 'nhl') return 'Puck line';
  return 'Against the spread';
}

/** The one-sentence description each sheet row carries (DI-914), per sport and format. */
export function formatSentence(profile, format) {
  const key = profile && profile.key;
  if (format === 'moneyline') {
    return key === 'nhl'
      ? 'Pick who wins each game. Overtime and shootout wins count. Prices shown are for information only.'
      : 'Pick who wins each game outright. Any lines shown are for information only.';
  }
  if (key === 'nhl') return 'Pick the team that covers 1.5 goals. A favorite must win by two; an underdog can lose by one. No pushes.';
  return 'Pick the team that covers the point spread. Landing exactly on the number is a push (no decision).';
}

/**
 * THE LINE A GAME IS GRADED ON, and the one function that writes it (DI-912). Returns a PATCH (never mutates `game`):
 *   moneyline  { spread: 0, favorite: null, spreadSource: 'format' }  (line 0, no favourite; the market numbers ESPN publishes live in `game.markets` and are never copied into `spread`)
 *   ats        {} unless the game carries a pick-the-winner stub (spreadSource 'format'), in which case the spread is read back from `game.markets.spread` (signed home-perspective line, the
 *              favourite derived from its sign), or null when the game has no usable line (the commissioner sees "Set spread" and Open is blocked). A manual or ESPN spread is NEVER overwritten.
 * `teams` for the favourite's NAME: { homeTeam, awayTeam } is read off the game itself.
 */
export function applyFormatToGame(game, format) {
  if (!game || typeof game !== 'object') return {};
  if (format === 'moneyline') {
    return { spread: 0, favorite: null, spreadSource: 'format' };
  }
  if (format === 'ats' && game.spreadSource === 'format') {
    const m = game.markets && game.markets.spread;
    const line = m && typeof m.line === 'number' && Number.isFinite(m.line) && m.line !== 0 ? m.line : null;
    if (line === null) return { spread: null, favorite: null, spreadSource: null };
    return { spread: line, favorite: line < 0 ? (game.homeTeam || null) : (game.awayTeam || null), spreadSource: 'espn' };
  }
  return {};
}

/**
 * A pick-the-winner game, told from the GAME ITSELF: `applyFormatToGame` stamps `spreadSource 'format'` on the games of a pick-the-winner week (and nothing else ever does), so a surface that holds only a
 * game (chat, Home, a card, the Dashboard) can route through `lineText` without a week lookup.
 */
export function isPickTheWinnerGame(game) {
  return !!game && typeof game === 'object' && game.spreadSource === 'format';
}

/**
 * `lineText(game, format, { formatSpread })` - the ONE function every surface that used to print a spread routes through (DI-915). '' for a pick-the-winner game (no badge, no "PK", no "0");
 * otherwise whatever `formatSpread(spread, favorite, game)` returns. `formatSpread` is INJECTED (js/data-model.js owns it and this leaf imports nothing); a caller that passes none gets '' for a
 * missing line and the bare signed number for a present one.
 */
export function lineText(game, format = undefined, { formatSpread = null } = {}) {
  if (isPickTheWinner(format === undefined ? (isPickTheWinnerGame(game) ? 'moneyline' : 'ats') : format)) return '';
  if (!game || typeof game !== 'object') return '';
  if (typeof formatSpread === 'function') return formatSpread(game.spread, game.favorite, game);
  const s = game.spread;
  return typeof s === 'number' && Number.isFinite(s) ? String(s) : '';
}

/** True when a game's graded line exists for its format (the Open-for-picks gate's "has a spread"): a pick-the-winner game needs none; a spread game needs a finite number. */
export function hasGradedLine(game, format) {
  if (isPickTheWinner(format)) return true;
  return !!game && typeof game.spread === 'number' && Number.isFinite(game.spread);
}

/** Live-mark words for a pick (DI-915): pick the winner says "leading / trailing / tied"; a spread says "covering / trailing / even". Never red for a trailing pick (the caller owns colour). */
export function liveMarkWords(format) {
  return isPickTheWinner(format)
    ? Object.freeze({ ahead: 'leading', behind: 'trailing', level: 'tied' })
    : Object.freeze({ ahead: 'covering', behind: 'trailing', level: 'even' });
}

/** The words for a finished game's result line: spread "ATS: X" / "No Decision"; pick the winner "Winner: X" / "Voided". */
export function resultLineText(format, { winner = null, noDecision = false } = {}) {
  if (isPickTheWinner(format)) return noDecision ? 'No decision' : (winner ? `Winner: ${winner}` : '');
  return noDecision ? 'No Decision' : (winner ? `ATS: ${winner}` : '');
}

// ── Lines shown on Picks (DI-918) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The markets the Picks page shows for a sport, in the profile's display order, drawn ONLY from `profile.markets.display` (a market the profile does not list can never show, an unknown value
 * is dropped on read). DEFAULTS FOLLOW THE FORMAT: `ats` shows `['spread']`, pick the winner shows `['moneyline']`. A stored `settings.markets` array replaces the default. ONE RULE KEEPS IT
 * HONEST: THE LINE A PICK IS GRADED ON ALWAYS SHOWS, so for `ats` the spread is forced in (the switch is locked on in the sheet); for pick the winner nothing is required (there is no line).
 */
export function marketsShown({ profile = null, format = 'ats', stored = undefined } = {}) {
  const display = profile && profile.markets && Array.isArray(profile.markets.display) ? profile.markets.display : ['spread'];
  const wanted = Array.isArray(stored) ? stored.filter((m) => typeof m === 'string' && display.includes(m)) : (format === 'moneyline' ? ['moneyline'] : ['spread']);
  const set = new Set(wanted);
  if (!isPickTheWinner(format)) set.add('spread');
  return display.filter((m) => set.has(m));
}

/** True when the market switch is locked ON (it is the graded line): the spread of an `ats` slate. */
export function marketLocked(format, market) {
  return market === 'spread' && !isPickTheWinner(format);
}

/** The value the "Lines shown on Picks" row prints: "Moneyline", "Spread, Total", or "None". */
export function marketsSummary(shown) {
  const names = { spread: 'Spread', total: 'Total', moneyline: 'Moneyline' };
  const out = (Array.isArray(shown) ? shown : []).map((m) => names[m]).filter(Boolean);
  return out.length ? out.join(', ') : 'None';
}

/** The sheet's three rows, fixed copy (DI-918). */
export const MARKET_ROWS = Object.freeze([
  Object.freeze({ key: 'spread', label: 'Spread', sentence: 'The point spread (or puck line). Required when picks are against the spread.' }),
  Object.freeze({ key: 'total', label: 'Total', sentence: 'The over/under total for the game. For information only.' }),
  Object.freeze({ key: 'moneyline', label: 'Moneyline', sentence: 'What each team pays to win. For information only.' }),
]);

/** The footnote under the lines sheet. `regulatory` confirms this sentence before the DI ships (DI-919/920). */
export const MARKETS_FOOTNOTE = "Lines are for information only. Munera doesn't take or track bets.";
