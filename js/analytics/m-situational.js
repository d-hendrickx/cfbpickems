/**
 * CFB Pickems - js/analytics/m-situational.js (D2 lane 4; DI-957 "Situational"; UN/PF-519; 2026-10-19)
 * ======================================================================================================
 * Per bucket: picks, W-L, and the member's overall rate. Reveal class: final-week. The candidate generator (insight.js) decides
 * what is interesting; this file only counts.
 *
 * HONEST METADATA ONLY: a metric whose field is empty for most games reports its COVERAGE ("rank known for 23 of 38 games") and
 * never infers a missing rank. A game with NO rank on either team sits in no ranked bucket (a missing rank is never read as
 * "unranked"). Manual games are excluded from the ESPN-metadata buckets (ranked, national TV, conference, neutral). Day and time
 * buckets use the LEAGUE's reference zone, never the viewer's or the machine's (DI-945; the tz-tagged test runs under two zones).
 * `sit.rivalry` is the explicit gap: dark until Drew approves the list (DI-960).
 */
import { register, makeMetric, unavailable, minOf, ratio, REVEAL } from './registry.js';
import { graded, wins, losses, supportOfPicks } from './slice.js';

const FW = REVEAL.FINAL_WEEK;
const DOW = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function bucketRun({ def, slice, memberId, pool, classify, minKey, coverage = null }) {
  const subject = { kind: 'member', id: memberId };
  const all = graded(slice.picksByMember.get(memberId) || []);
  const groups = new Map();
  for (const p of pool(all)) { const k = classify(p, slice.gameById.get(p.gameId)); if (k === null || k === undefined) continue; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const min = minOf(minKey);
  const buckets = [];
  const used = [];
  for (const [bucket, ps] of Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ps.length < min) continue;
    buckets.push({ bucket, n: ps.length, w: wins(ps), l: losses(ps), rate: ratio(wins(ps), ps.length) });
    used.push(...ps);
  }
  if (!buckets.length) return unavailable({ def, slice, subject, reason: 'thin', n: Array.from(groups.values()).reduce((a, g) => Math.max(a, g.length), 0), min });
  const value = { buckets, overall: { n: all.length, w: wins(all), l: losses(all), rate: ratio(wins(all), all.length) } };
  if (coverage) value.coverage = coverage(all, slice);
  return makeMetric({ def, slice, subject, n: used.length, value, supportRows: supportOfPicks(used) });
}

const notManual = (ps) => ps.filter((p) => !p.isManual);

export const SIT_RANKED = register({
  id: 'sit.ranked', v: 1, family: 'situational', reveal: FW, level: 'member', minKey: 'bucket',
  run(slice, { memberId }) {
    return bucketRun({
      def: SIT_RANKED, slice, memberId, minKey: 'bucket', pool: notManual,
      classify: (p) => {
        const a = p.rankPicked !== null, b = p.rankOpponent !== null;
        if (!a && !b) return null;                         // no rank on either side: unknown, never "unranked"
        return a && b ? 'both_ranked' : a ? 'picked_ranked' : 'picked_unranked_opponent_ranked';
      },
      coverage: (all) => { const pool = notManual(all); return { known: pool.filter((p) => p.rankPicked !== null || p.rankOpponent !== null).length, of: pool.length, basis: 'rank_when_added' }; },
    });
  },
});

export const SIT_DAYPART = register({
  id: 'sit.daypart', v: 1, family: 'situational', reveal: FW, level: 'member', minKey: 'bucket',
  run(slice, { memberId }) {
    return bucketRun({
      def: SIT_DAYPART, slice, memberId, minKey: 'bucket',
      pool: (ps) => ps.filter((p) => { const g = slice.gameById.get(p.gameId); return g && g.kickoffTimed && g.dow !== null; }),
      classify: (p, g) => DOW[g.dow] + ':' + g.daypart,
    });
  },
});

const twoWay = (id, field, label, { manualOut = true, minKey = 'bucket' } = {}) => {
  const def = register({
    id, v: 1, family: 'situational', reveal: FW, level: 'member', minKey,
    run(slice, { memberId }) {
      return bucketRun({ def, slice, memberId, minKey, pool: manualOut ? notManual : (x) => x, classify: (p, g) => { const v = field(p, g); return v === null ? null : (v ? label[0] : label[1]); } });
    },
  });
  return def;
};
export const SIT_NATIONAL_TV = twoWay('sit.national_tv', (p) => p.nationalTV === true, ['national', 'other']);
export const SIT_NEUTRAL = twoWay('sit.neutral', (p) => p.neutral === true, ['neutral', 'home_site']);
export const SIT_CONFERENCE = twoWay('sit.conference', (p) => p.sameConference, ['same_conference', 'non_conference']);
export const SIT_BIG_GAME = twoWay('sit.big_game', (p) => p.multiplier > 1, ['multiplier', 'standard'], { manualOut: false, minKey: 'bigGameBucket' });
export const SIT_POSTSEASON = (() => {
  const def = register({
    id: 'sit.postseason', v: 1, family: 'situational', reveal: FW, level: 'member', minKey: 'bucket',
    run(slice, { memberId }) {
      const post = new Set(slice.weeks.filter((w) => w.postseason).map((w) => w.weekId));
      return bucketRun({ def, slice, memberId, minKey: 'bucket', pool: (x) => x, classify: (p) => (post.has(p.weekId) ? 'postseason' : 'regular') });
    },
  });
  return def;
})();

/** EXPLICIT GAP (DI-960): dark until the rivalry list has an approver. The game record's flag is false for every game while dark. */
export const SIT_RIVALRY = register({
  id: 'sit.rivalry', v: 1, family: 'situational', reveal: FW, level: 'member', minKey: 'bucket',
  run(slice, { memberId }) {
    if (!slice.input.rivalryOn) return unavailable({ def: SIT_RIVALRY, slice, subject: { kind: 'member', id: memberId }, reason: 'dark', n: 0, min: minOf('bucket') });
    return bucketRun({ def: SIT_RIVALRY, slice, memberId, minKey: 'bucket', pool: (x) => x, classify: (p, g) => (g && g.rivalry ? 'rivalry' : 'other') });
  },
});
