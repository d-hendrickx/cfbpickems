/**
 * CFB Pickems - js/analytics/copy.js (D2 lane 4; DI-947, 982, 985, 998-shared strings; 2026-10-19)
 * ===================================================================================================
 * THE ONLY PLACE ANALYTICS PROSE LIVES. A metric holds numbers, never prose (DI-944); a candidate's `headline` (at most 80
 * characters) and `line` (at most 140) are built here from FIXED TEMPLATES with the numbers and names slotted in. A model never
 * writes a number: SCRIBE narrates facts, it does not calculate them. Every dynamic string crosses `escHtml` and every number
 * `numHtml` at RENDER time (the card renderer's job); nothing here returns markup.
 *
 * Observation, never interpretation: no string explains why a member did anything, and no string is a claim about a person's
 * character. `lintCopy` enforces the vocabulary (DI-982's money words, DI-985's trait and cause words); analyticstest lints every
 * template and every rendered candidate, and a planted violation must be caught.
 *
 * RPF-D2: the product never shows bet, wager, stake, parlay, odds, bookmaker, sportsbook, payout, profit, ROI, juice, vig or
 * guarantee, and while the money switch is off never a currency symbol. The what-if wording is "would have", never "should".
 *
 * Imports nothing.
 */

export const HEADLINE_MAX = 80;
export const LINE_MAX = 140;

/** DI-982: the words the product never shows (an explicit constant, so a change is a visible diff). */
export const MONEY_WORDS = Object.freeze(['bet', 'bets', 'betting', 'bettor', 'wager', 'wagers', 'stake', 'stakes', 'parlay', 'parlays', 'odds', 'bookmaker', 'sportsbook', 'payout', 'payouts', 'profit', 'profits', 'roi', 'juice', 'vig', 'guarantee', 'guaranteed']);
/** DI-985: trait and psychology words. A label is a name for a pattern, never a claim about the person. */
export const TRAIT_WORDS = Object.freeze(['always', 'never', 'scared', 'afraid', 'nervous', 'lazy', 'dumb', 'stupid', 'coward', 'choke', 'tilt', 'desperate', 'emotional', 'gambler', 'addict', 'personality']);
export const TRAIT_PHRASES = Object.freeze(['type of person']);
/** the shipped cause lint (callback-evidence.mjs CAUSE): observation, not explanation */
export const CAUSE_WORDS = Object.freeze(['because', 'due to', 'must have', 'remember', 'remembers', 'remembered', 'wanted', 'tried to', 'clearly', 'obviously', 'should', 'will']);
const CURRENCY = /[$€£¥]/;

const wordRe = (list) => new RegExp('\\b(?:' + list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i');
const MONEY_RE = wordRe(MONEY_WORDS), TRAIT_RE = wordRe([...TRAIT_WORDS, ...TRAIT_PHRASES]), CAUSE_RE = wordRe(CAUSE_WORDS);
const TRAIT_RE_NO_ALWAYS = wordRe([...TRAIT_WORDS.filter((w) => w !== 'always' && w !== 'never'), ...TRAIT_PHRASES]);

/**
 * @param {string} text
 * @param {{family?: string}} [o]  the strategy family is a HYPOTHETICAL replay ("always taking the favorite would have gone 24-14", DI-982's own example), so
 *   "always" and "never" are allowed there; every other trait word, every money word and every cause word still fails.
 * @returns {string[]} the violations ([] = clean)
 */
export function lintCopy(text, { family = null } = {}) {
  const out = [];
  const s = String(text ?? '');
  if (MONEY_RE.test(s)) out.push('money:' + (s.match(MONEY_RE) || [''])[0].toLowerCase());
  if (CURRENCY.test(s)) out.push('currency');
  const trait = (family === 'strategy' ? TRAIT_RE_NO_ALWAYS : TRAIT_RE);
  if (trait.test(s)) out.push('trait:' + (s.match(trait) || [''])[0].toLowerCase());
  if (CAUSE_RE.test(s)) out.push('cause:' + (s.match(CAUSE_RE) || [''])[0].toLowerCase());
  return out;
}

/**
 * RPF-D2 over a WHOLE module that draws text a member reads (the surfaces' view and UI modules, not just copy.js's templates): every string, label, sentence and
 * attribute in it, comments removed. Returns the money violations only ([] = clean): a money word anywhere in the code, or a currency amount (a symbol before a digit;
 * a bare `$` is a template's `${`, so it is not one). The list of modules it runs over is an allow-list in counterfactualtest [V], each with a planted canary.
 */
const CURRENCY_AMOUNT = new RegExp('(?:' + CURRENCY.source + ')\\s?\\d');      // built from the lint's ONE currency pattern (copy.js holds no second symbol: analyticstest COPY 7)
export function lintModuleMoney(src) {
  const code = String(src ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').split('\n').map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, (m, keep) => keep)).join('\n');
  const out = [];
  const m = code.match(MONEY_RE);
  if (m) out.push('money:' + m[0].toLowerCase());
  if (CURRENCY_AMOUNT.test(code)) out.push('currency');
  return out;
}

// ---- fixed shared strings (DI section 18) ----------------------------------------------------------------------------
export const COPY = Object.freeze({
  sampleLine: 'Based on {n} picks, {sport} {season}, through Week {k} (final weeks only).',
  definition: 'Final weeks only. Pushes are not counted. Definition v{v}.',
  gone: "This insight isn't available right now.",
  notYours: "This item isn't available to you right now.",
  gap: "Last season's picks aren't in this league's record yet.",
  caption: "Looking back only. This replays your past picks and isn't a prediction or advice.",
  labelsHidden: 'Hidden from the league',
  labelsNone: 'Labels need about four weeks of picks.',
  live: 'Live · updates as the game goes',
});

const ordinal = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
export { ordinal };
/** round half away from zero, on a value already scaled to integers where it matters (no float artefact decides a displayed number) */
const roundHalfAway = (x) => (x < 0 ? -Math.round(-x) : Math.round(x));
const pct = (x) => roundHalfAway(Math.round(x * 10000) / 100);
const clip = (s, max) => (s.length <= max ? s : s.slice(0, max - 1).replace(/\s+\S*$/, '') + '…');
const plural = (n, one, many) => (n === 1 ? one : many);

/** Who a sentence is about: "You" with have/are, or the name with has/is. */
function who(ctx, id) {
  const you = id !== null && id !== undefined && id === ctx.viewerId;
  const name = you ? 'You' : ctx.nameOf(id);
  return { you, name, lower: you ? 'you' : name, has: you ? 'have' : 'has', is: you ? 'are' : 'is', poss: you ? 'your' : name + "'s", took: you ? 'took' : 'took' };
}

const BUCKET_WORDS = Object.freeze({
  both_ranked: 'games between ranked teams', picked_ranked: 'picks on a ranked team against an unranked one', picked_unranked_opponent_ranked: 'picks on an unranked team against a ranked one',
  national: 'nationally televised games', other: 'other games', neutral: 'neutral-site games', home_site: 'games at a home site', same_conference: 'conference games', non_conference: 'non-conference games',
  multiplier: 'big games', standard: 'standard games', postseason: 'postseason games', regular: 'regular-season games', rivalry: 'rivalry games',
});
const DAY_WORDS = Object.freeze({ mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' });
const PART_WORDS = Object.freeze({ before_noon: 'before noon', afternoon: 'in the afternoon', evening: 'in the evening' });
export function bucketWord(b) {
  if (BUCKET_WORDS[b]) return BUCKET_WORDS[b];
  const m = /^([a-z]{3}):(before_noon|afternoon|evening)$/.exec(b);
  return m ? DAY_WORDS[m[1]] + ' games ' + PART_WORDS[m[2]] : String(b);
}

const LABEL_EVIDENCE = Object.freeze({
  chalk_merchant: (e) => `${e.onFavorite} of ${e.picks} picks on the favorite`,
  underdog_whisperer: (e) => `${e.won} of ${e.underdogPicks} underdog picks covered`,
  chaos_agent: (e) => `${e.against} of ${e.games} picks against the majority`,
  captain_consensus: (e) => `${e.withMajority} of ${e.games} picks with the majority`,
  certified_hater: (e) => `${e.faded} picks against ${e.team}`,
  comeback_king: (e) => `up ${e.places} places since the low point`,
  bad_beat_magnet: (e) => `${e.nearMisses} losses by a point or less`,
  rivalry_expert: (e) => `${e.won} of ${e.rivalryPicks} rivalry picks covered`,
});

/**
 * The words for one available metric. Returns { headline, line } or null when the metric has no card copy (it exists for detail and Ask only).
 * `ctx` = { viewerId, nameOf(memberId), gameLabel(gameId) }.
 */
export function copyFor(m, ctx) {
  const v = m.value;
  const sub = m.subject || {};
  const S = sub.kind === 'member' || m.id === 'cf.copy_member' ? who(ctx, sub.id) : null;
  let h = null, l = null;
  switch (m.id) {
    case 'ident.team_most_backed':
      h = `${S.name} ${S.you ? 'back' : 'backs'} ${v.team} the most`;
      l = `${S.name} ${S.has} backed ${v.team} in ${v.count} of its ${v.appearances} games, ${v.w}-${v.l} on those picks.`; break;
    case 'ident.team_most_faded':
      h = `${S.name} ${S.you ? 'fade' : 'fades'} ${v.team} the most`;
      l = `${S.name} ${S.has} faded ${v.team} ${v.count} ${plural(v.count, 'time', 'times')}, ${v.w}-${v.l} on those picks.`; break;
    case 'ident.team_loyalty':
      h = `${S.name} ${S.you ? 'back' : 'backs'} ${v.team} a lot`;
      l = `${S.name} ${S.has} backed ${v.team} in ${v.backed} of its ${v.appearances} games.`; break;
    case 'ident.fav_dog': {
      const gap = m.comparison ? roundHalfAway((Math.round(v.share * 10000) - Math.round(m.comparison.value * 10000)) / 100) : null;
      h = `${S.name} ${S.you ? 'take' : 'takes'} the favorite ${pct(v.share)} percent of the time`;
      l = gap === null ? `${v.onFavorite.n} of ${m.n} picks were on the favorite side of the line.` : `That is ${Math.abs(gap)} points ${gap >= 0 ? 'above' : 'below'} the rest of the league.`; break;
    }
    case 'ident.home_away':
      h = `${S.name} ${S.you ? 'have' : 'has'} taken the home team ${pct(v.homeShare)} percent of the time`;
      l = `${S.poss} home picks are ${v.home.w}-${v.home.l} and away picks ${v.away.w}-${v.away.l}.`; break;
    case 'ident.alma_pick':
      h = `${S.name} ${S.you ? 'back' : 'backs'} ${S.you ? 'your' : 'their'} school ${pct(v.backedShare)} percent of the time`;
      l = `Backing the school is ${v.backed.w}-${v.backed.l} against the spread.`; break;
    case 'ident.alma_su':
      h = `${S.poss} school is ${v.w}-${v.l} straight up`;
      l = `Straight up, not against the spread. Based on ${m.n} games.`; break;
    case 'perf.streaks': {
      const c = v.current;
      if (!c || !c.active) return null;
      h = `${S.name} ${S.is} on a ${c.run}-game ${c.kind === 'covers' ? 'cover' : 'miss'} streak`;
      l = `${S.poss} longest cover streak this season is ${v.longestCovers}.`; break;
    }
    case 'perf.best_worst_week':
      h = `${S.poss} best week was Week ${v.best.weekNumber}`;
      l = `${v.best.wins}-${v.best.losses} in Week ${v.best.weekNumber}; the low was ${v.worst.wins}-${v.worst.losses} in Week ${v.worst.weekNumber}.`; break;
    case 'perf.rank_path':
      h = `${S.name} ${S.is} ${ordinal(v.current)} of ${v.entrants}`;
      l = `The high was ${ordinal(v.highest)} and the low ${ordinal(v.lowest)}; ${v.weeksAtFirst} ${plural(v.weeksAtFirst, 'week', 'weeks')} at first.`; break;
    case 'perf.rise_fall':
      if (!v.rise) return null;
      h = `${S.poss} biggest climb was ${v.rise.places} ${plural(v.rise.places, 'spot', 'spots')} in Week ${v.rise.weekNumber}`;
      l = `From ${ordinal(v.rise.from)} to ${ordinal(v.rise.to)}.`; break;
    case 'perf.weeks_won_lost':
      h = `${S.name} ${S.has} won ${v.won} ${plural(v.won, 'week', 'weeks')} and finished last in ${v.lost}`;
      l = `${S.poss} season so far, through the final weeks.`; break;
    case 'perf.vs_last_season':
      h = `${S.name} ${S.has} ${v.now} correct picks through Week ${v.throughWeek}, against ${v.then} last year`;
      l = `${v.delta >= 0 ? 'Up' : 'Down'} ${Math.abs(v.delta)} on the same point of 2025, by weekly totals.`; break;
    case 'cons.rate':
      h = `${S.name} ${S.you ? 'go' : 'goes'} with the majority ${pct(v.rate)} percent of the time`;
      l = `${v.with} of ${v.with + v.against} picks were on the side most of the league took.`; break;
    case 'cons.with_against':
      h = `${S.poss} record with and against the majority`;
      l = `With the majority ${v.with.w}-${v.with.l}; against it ${v.against.w}-${v.against.l}.`; break;
    case 'cons.unanimous':
      h = `${v.count} ${plural(v.count, 'game was', 'games were')} unanimous`;
      l = `The league agreed on ${v.count} and covered ${v.covered} of them.`; break;
    case 'cons.lone_correct':
      h = `Only ${ctx.nameOf(v.memberId)} had ${v.team}`;
      l = `${ctx.nameOf(v.memberId)} was the only one on ${v.team}, against ${v.against}, and it covered.`; break;
    case 'cons.league_miss':
      h = `The whole league missed ${ctx.gameLabel(sub.id)}`;
      l = `All ${v.n} picks lost.`; break;
    case 'cons.polarizing':
      h = `${ctx.gameLabel(v.gameId)} split the league ${v.split[0]}-${v.split[1]}`;
      l = `The most divided game of the season so far.`; break;
    case 'cons.accuracy':
      h = `The majority covered ${pct(v.accuracy)} percent of the time`;
      l = `Across ${m.n} games where the league had a majority.`; break;
    case 'cons.contrarian_leader':
      h = `${ctx.nameOf(v.memberId)} goes against the majority most`;
      l = `${pct(v.contrarianRate)} percent of picks against the side most of the league took.`; break;
    case 'pair.agreement': {
      const a = ctx.nameOf(sub.id), b = ctx.nameOf(sub.id2);
      h = `${a} and ${b} agree ${pct(v.rate)} percent of the time`;
      l = `The same side in ${v.agreed} of ${v.compared} games they both picked.`; break;
    }
    case 'pair.similar_opposite': {
      const x = v.similar || v.opposite;
      h = v.similar ? `${S.poss} closest match is ${ctx.nameOf(v.similar.memberId)}` : `${S.poss} biggest opposite is ${ctx.nameOf(v.opposite.memberId)}`;
      l = `Same side in ${x.agreed} of ${x.compared} games, ${pct(x.rate)} percent.`; break;
    }
    case 'pair.disagreement_record': {
      const a = ctx.nameOf(sub.id), b = ctx.nameOf(sub.id2);
      h = `${a} and ${b} split on ${v.disagreements} games`;
      l = `${a} was right ${v.aRight} times and ${b} ${v.bRight}.`; break;
    }
    case 'pair.weekly_h2h': {
      const a = ctx.nameOf(sub.id), b = ctx.nameOf(sub.id2);
      h = `${a} leads ${b} ${v.aAbove}-${v.bAbove} week by week`;
      l = `${v.run.holder === 'a' ? a : b} has finished ahead ${v.run.n} ${plural(v.run.n, 'week', 'weeks')} in a row.`; break;
    }
    case 'pair.split_team': {
      const a = ctx.nameOf(sub.id), b = ctx.nameOf(sub.id2), t = v.teams[0];
      h = `${a} and ${b} keep splitting on ${t.team}`;
      l = `${t.n} games, ${a} right ${t.aRight} and ${b} right ${t.bRight}.`; break;
    }
    case 'lg.closest_week':
      h = `Week ${v.weekNumber} was the closest of the season`;
      l = v.tiedAtTop ? 'Tied at the top.' : `${v.gap} ${plural(v.gap, 'win', 'wins')} between first and second.`; break;
    case 'lg.blowout_week':
      h = `Week ${v.weekNumber} had the widest gap of the season`;
      l = `${v.gap} wins from first to last.`; break;
    case 'lg.chaos_week':
      h = `Week ${v.weekNumber} split the league the most`;
      l = `Fewest picks on the majority side across ${v.games} games.`; break;
    case 'lg.team_trust_fade': {
      if (v.backed) { h = `The league backs ${v.backed.team} the most`; l = `${v.backed.n} picks on ${v.backed.team} this season.`; }
      else { h = `The league fades ${v.faded.team} the most`; l = `${v.faded.n} picks against ${v.faded.team} this season.`; }
      break;
    }
    case 'lg.collective_week':
      h = `Week ${v.best.weekNumber} was the league's best week`;
      l = `${v.best.correct} of ${v.best.graded} picks covered; the low was Week ${v.worst.weekNumber}.`; break;
    case 'beh.after_week':
      h = `After a down week ${S.name} ${S.you ? 'take' : 'takes'} the favorite ${pct(v.under.share)} percent of the time`;
      l = `After an up week ${pct(v.over.share)} percent.`; break;
    case 'beh.leading_trailing':
      h = `${S.name} ${S.you ? 'go' : 'goes'} with the majority ${pct(v.leading.rate)} percent when leading`;
      l = `When trailing, ${pct(v.trailing.rate)} percent.`; break;
    case 'beh.trust_run':
      h = `${S.name} ${S.has} ${v.role === 'backed' ? 'backed' : 'faded'} ${v.team} ${v.run} times in a row`;
      l = `The latest ${v.run} games with ${v.team}.`; break;
    case 'beh.burn_rebound':
      h = `After a loss backing a team, ${S.name} ${S.you ? 'switch' : 'switches'} ${pct(v.burns ? v.switched / v.burns : 0)} percent of the time`;
      l = `${v.switched} of ${v.burns} next picks were on the other side.`; break;
    case 'cf.always_favorite': case 'cf.always_underdog': case 'cf.follow_consensus': case 'cf.fade_consensus': case 'cf.copy_member': case 'cf.team_record': {
      const what = { 'cf.always_favorite': 'always taking the favorite', 'cf.always_underdog': 'always taking the underdog', 'cf.follow_consensus': 'following the majority', 'cf.fade_consensus': 'going against the majority', 'cf.copy_member': `copying ${ctx.nameOf(sub.id2)}`, 'cf.team_record': `backing ${v.team} every time` }[m.id];
      h = `On the same ${v.games} games, ${what} would have gone ${v.strategy.w}-${v.strategy.l}`;
      l = `${S.name} ${S.you ? 'went' : 'went'} ${v.actual.w}-${v.actual.l}. Looking back only.`; break;
    }
    case 'cf.perfect_card':
      h = `Perfect cards: ${v.perfect}. One miss away: ${v.oneMissAway}.`;
      l = `Across ${m.n} weeks with at least five graded picks.`; break;
    case 'cf.cumulative': return null;
    case 'cf.never_changed':
      h = `Keeping your first picks would have gone ${v.neverChanged.w}-${v.neverChanged.l}`;
      l = `You went ${v.actual.w}-${v.actual.l} on those ${v.games} games. Looking back only.`; break;
    case 'cb.same_week_last_year': {
      const top = v.rows[0];
      h = `This week last year: Week ${v.weekNumber}, 2025`;
      l = `${top.name} led with ${top.score} correct.`; break;
    }
    case 'cb.prior_standing':
      h = `At this point last year ${S.name} ${S.was || (S.you ? 'were' : 'was')} ${v.tied ? 'tied for ' : ''}${ordinal(v.rank)}`;
      l = v.finalRank ? `Finished ${ordinal(v.finalRank)}.` : 'By weekly scores.'; break;
    case 'cb.notable_moment': {
      const x = v.moments[0];
      h = x.kind === 'perfect_card' ? `${S.name} ${S.has} had a perfect card in Week ${x.weekNumber}` : x.kind === 'biggest_rise' ? `${S.poss} biggest climb was ${x.places} spots in Week ${x.weekNumber}` : `A drink changed hands in Week ${x.weekNumber}, ${x.season}`;
      l = 'From the league record.'; break;
    }
    case 'cb.team_history':
      h = `${S.name} ${S.has} history with ${v.team}`;
      l = `Backed ${v.backed.n} times, ${v.backed.w}-${v.backed.l}; faded ${v.faded.n}, ${v.faded.w}-${v.faded.l}.`; break;
    case 'cb.rematch':
      h = 'These two met before'; l = 'Here is what the league picked last time.'; break;
    case 'cb.changed_behavior':
      h = `${S.name} backed ${v.priorTeam} last time and ${v.priorResult === 'win' ? 'covered' : v.priorResult === 'loss' ? 'missed' : 'pushed'}`;
      l = `This time ${S.you ? 'you' : 'they'} took ${v.nowTeam}.`; break;
    case 'cb.blurb': case 'cb.joke': {
      const it = v.items[0];
      h = it.kind === 'blurb' ? `Commissioner's note, Week ${it.weekNumber}, ${it.season}` : `From the league memory, Week ${it.weekNumber}, ${it.season}`;
      l = it.text; break;                                                                          // VERBATIM, clipped only to the line cap
    }
    case 'team.record': {
      const rec = teamRec(v, m);
      h = `${v.team} is ${rec} this season`;
      l = v.home && v.away ? `${v.team} is ${teamRec(v.home, m)} at home and ${teamRec(v.away, m)} on the road.` : `${v.team} has played ${v.games} games this season.`; break;
    }
    case 'team.form': {
      const w = v.run.kind === 'W', run = v.run.n;
      h = v.run.streak ? `${v.team} has ${w ? 'won' : 'lost'} ${run} straight` : `${v.team} is ${lastRec(v.last, m.scope && m.scope.sport)} in its last ${v.k}`;
      l = `Last ${v.k}: ${v.last.join(' ')}.`; break;
    }
    case 'team.scoring':
      h = `${v.team} is scoring ${v.season.pf} a game`;
      l = `${v.team} is scoring ${v.last.pf} a game and allowing ${v.last.pa} over its last ${v.last.n}.`; break;
    case 'team.margins': {
      const w = v.win, x = v.loss;
      h = w ? `${v.team}'s biggest win: ${w.pf}-${w.pa} over ${w.opp}` : `${v.team}'s worst loss: ${x.pf}-${x.pa} to ${x.opp}`;
      l = w && x ? `Its worst loss was ${x.pf}-${x.pa} to ${x.opp}.` : w ? `${v.team} has no losses this season.` : `${v.team} has no wins this season.`; break;
    }
    case 'team.vs_ranked':
      h = `${v.team} is ${teamRec(v, m)} against ranked teams`;
      l = `${v.games} of its ${v.of} games were against a team ranked when played.`; break;
    case 'team.ats_in_league':
      h = `In ${ctx.leagueName || 'your league'}'s games, ${v.team} has covered ${v.covered} of ${v.games}`;
      l = `Your league's games only, not ${v.team}'s whole season.`; break;
    case 'team.leaders_recent': {
      const it = v.items[0];
      h = `${it.who} led ${v.team} against ${v.opp}`;
      l = v.items.map((x) => `${x.who}: ${x.line}`).join('. ') + '.'; break;
    }
    case 'team.coach':
      h = `${v.team}, coached by ${v.name}, is ${teamRec(v, m)}`;
      l = `${v.team} is ${teamRec(v, m)} this season.`; break;
    default:
      if (m.id.startsWith('sit.')) {
        const b = v.buckets.slice().sort((x, y) => (y.rate - x.rate) || (y.n - x.n))[0];
        h = `${S.name} ${S.is} ${b.w}-${b.l} on ${bucketWord(b.bucket)}`;
        l = `${pct(v.overall.rate)} percent overall this season.`; break;
      }
      if (m.id.startsWith('lbl.')) {
        const name = v.label;
        h = `This month's ${name}: ${ctx.nameOf(v.holderId)}`;
        l = `${LABEL_EVIDENCE[v.key](v.evidence)}, last ${v.window.weeks.length} weeks.`; break;
      }
      return null;
  }
  const up = (t) => (t && /^[a-z]/.test(t) ? t[0].toUpperCase() + t.slice(1) : t);           // a sentence starts with a capital ("your best week was Week 2" read lowercase before: found in the Your numbers screen)
  return { headline: clip(up(h), HEADLINE_MAX), line: clip(up(l), LINE_MAX) };
}

/** the short form record in the sport's own words (W-L-T in football, W-L-OTL in hockey): a tie is never a loss and an overtime loss is not folded into the losses */
function lastRec(last, sport) {
  const n = (r) => last.filter((x) => x === r).length;
  return sport === 'nhl' ? `${n('W')}-${n('L')}-${n('OTL')}` : n('T') ? `${n('W')}-${n('L')}-${n('T')}` : `${n('W')}-${n('L')}`;
}

/** the Game Day row of a followed team (DI-1087): "{Team} plays today: {w}-{l}, {form}." Numbers and closed words only; no prediction. */
export function gdFollowedLine(f) {
  const rec = f.sport === 'nhl' ? `${f.w}-${f.l}-${f.otl}` : f.t ? `${f.w}-${f.l}-${f.t}` : `${f.w}-${f.l}`;
  const form = f.streak ? `${f.runKind === 'W' ? 'won' : 'lost'} ${f.run} straight` : `${lastRec(f.last, f.sport)} in its last ${f.last.length}`;
  return `${f.team} plays today: ${rec}, ${form}.`;
}

/**
 * DI-976: the one sentence of a Game Day fact (the Insights sheet, its detail, the Ask scope), FIXED templates with the numbers slotted in. Live facts are tentative ("covering", "if the live
 * games hold"); settled words only for a FINAL game. No probability, no prediction, no signed number (a margin is a non-negative count). `ctx` = { viewerId, nameOf(memberId), gameOf(gameId) ->
 * { away, home } | null, weekNumberOf(weekId) -> number | null }. Returns '' for a kind it does not know (the caller drops it, never shows a blank row).
 */
export function gdFactLine(f, ctx) {
  if (!f || typeof f !== 'object') return '';
  const you = (id) => id !== null && id !== undefined && id === ctx.viewerId;
  const Name = (id) => (you(id) ? 'You' : String(ctx.nameOf(id)));
  const wk = () => { const n = ctx.weekNumberOf ? ctx.weekNumberOf(f.weekId) : null; return n ? `Week ${n}` : 'this week'; };
  const left = (n) => `You have ${n} ${plural(n, 'pick', 'picks')} left.`;
  switch (f.kind) {
    case 'gd.consequence': {
      const to = ordinal(f.toRank);
      if (f.tied) return `If the live games hold, you're tied for ${to}.`;
      return f.toRank < f.fromRank ? `If the live games hold, you move up to ${to}.` : `If the live games hold, you drop to ${to}.`;
    }
    case 'gd.swing': {
      const g = ctx.gameOf ? ctx.gameOf(f.gameId) : null;
      return g ? `The ${g.away} at ${g.home} game is worth ${f.places} ${plural(f.places, 'spot', 'spots')} to you.` : `This game is worth ${f.places} ${plural(f.places, 'spot', 'spots')} to you.`;
    }
    case 'gd.only_backer': {
      const w = Name(f.memberId);
      if (f.state === 'final_win') return `Only ${w} had ${f.team}. It covered.`;
      if (f.state === 'final_loss') return `Only ${w} had ${f.team}. It didn't cover.`;
      if (f.state === 'final_push') return `Only ${w} had ${f.team}. It landed on the number.`;
      const base = `Only ${w} ${you(f.memberId) ? 'have' : 'has'} ${f.team}.`;
      if (f.state === 'covering' && Number.isFinite(f.by)) return `${base} Covering by ${f.by}.`;
      if (f.state === 'trailing' && Number.isFinite(f.by)) return `${base} Trailing by ${f.by}.`;
      if (f.state === 'push') return `${base} Right on the number.`;
      return base;
    }
    case 'gd.disagreement': return `This one decides who's ahead: you or ${String(ctx.nameOf(f.memberId))}.`;
    case 'gd.path_to_win':
      if (f.state === 'clinched') return `You've clinched ${wk()}.`;
      if (f.state === 'out') return `You can't win ${wk()} anymore.`;
      if (f.state === 'leading') return `You lead ${wk()} by ${f.d}. ${left(f.rem)}`;
      if (f.state === 'level') return `You're level at the top of ${wk()}. ${left(f.rem)}`;
      return f.leaderId ? `${Name(f.leaderId)} ${you(f.leaderId) ? 'lead' : 'leads'} ${wk()} by ${f.d}. ${left(f.rem)}` : `You're ${f.d} behind the lead in ${wk()}. ${left(f.rem)}`;
    case 'gd.milestone': return `${Name(f.memberId)} just hit ${f.mark} correct picks.`;
    case 'gd.followed_team': return gdFollowedLine(f);
    default: return '';
  }
}

/** a team's record in the sport's own words: wins-losses, plus ties (football) or overtime losses (hockey) */
function teamRec(v, m) {
  const sport = m && m.scope ? m.scope.sport : null;
  return sport === 'nhl' ? `${v.w}-${v.l}-${v.otl}` : v.t ? `${v.w}-${v.l}-${v.t}` : `${v.w}-${v.l}`;
}

/** DI-1085's caption for a followed-team card: the source, the sample and the period: "ESPN · 7 games · 2026 season · through Oct 18". The league's own figure says whose games they are instead. */
export function teamCaption(m) {
  const last = m.asOf && /^\d{4}-\d{2}-\d{2}$/.test(m.asOf.weekId) ? m.asOf.weekId : null;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const thru = last ? ` · through ${MON[Number(last.slice(5, 7)) - 1]} ${Number(last.slice(8, 10))}` : '';
  const season = m.scope && m.scope.season ? ` · ${m.scope.season} season` : '';
  if (m.id === 'team.ats_in_league') return `Your league's games only · ${m.n} ${plural(m.n, 'game', 'games')}${season}${thru}`;
  const src = m.id === 'team.leaders_recent' ? 'ESPN box score' : m.id === 'team.coach' ? 'Coach as listed by ESPN' : 'ESPN';
  return `${src} · ${m.n} ${plural(m.n, 'game', 'games')}${season}${thru}`;
}

/** DI-946: below twice the minimum the sentence carries "so far" (a weak sample is never described as a durable tendency). Never exceeds the line cap. */
export function withSoFar(line, thin) {
  if (!thin) return line;
  const tag = ' So far this season.';
  return clip(line, LINE_MAX - tag.length) + tag;
}

/** "14 picks · CFB 2026" (DI-964's caption) */
export function sampleCaption(n, sportCode, season) { return `${n} ${plural(n, 'pick', 'picks')} · ${String(sportCode).toUpperCase()} ${season}`; }

/** the full sample sentence of every detail (DI section 18); `thin` adds "so far" (DI-946: below twice the minimum) */
export function sampleSentence({ n, sport, season, k, thin }) {
  const s = COPY.sampleLine.replace('{n}', String(n)).replace('{sport}', String(sport).toUpperCase()).replace('{season}', String(season)).replace('{k}', String(k));
  return thin ? s.replace('Based on', 'So far, based on') : s;
}
