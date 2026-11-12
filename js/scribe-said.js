/**
 * scribe-said.js — THE "ALREADY SAID" LEDGER'S RULES, AS PURE FUNCTIONS (T-24f / M-79; DI-1061 to DI-1063; Drew, 2026-10-21: "it reiterates the same stats").
 * ================================================================================================================================================
 * `scribe_said` (migration 0073) remembers which facts SCRIBE has stated in a league's room. This module is every decision made about that memory, with no I/O and the clock as an
 * argument, so the server (the autonomous pipeline) and the tests read the same table:
 *   - which facts the room has heard and may not hear again (`isBlocked`, `partitionFacts`): a fact is NEVER restated inside its window unless it changed MATERIALLY, an identical value
 *     is never restated inside its window under any circumstances, and no fact with the same metric and subject is said twice in one competition week unless it changed materially;
 *   - the order the survivors are offered in (`noveltyOrder`: never said, then changed, within a tier by overlap with what the room is saying, then by interest);
 *   - the ALREADY SAID block the prompt carries (`renderAlreadySaid`, from structured fields only: ids and digits, never text);
 *   - the rows to record after a post lands (`recordableRows`: every supplied fact whose numbers appear in the posted text).
 *
 * THE FACT. `{ factKey, kind, metricId, subjectId, valueKey, numbers[], names[], factIndex, interestingness }`. `valueKey` is a tuple of numbers joined by ';', the LAST component the count of
 * FINAL games league-wide when the fact was computed ("87.5;7/8;11"; a ratio is "a/b"): the one thing the material rule needs that a ledger row can hold without free text. The engine
 * (lane D's `factsFor`) will supply typed facts; until it does, `structuredFactsFor` derives the same shape from the evidence layer's verified fact strings, so the ledger has a producer today.
 *
 * It imports nothing (it runs in Deno and Node alike). A row is DATA here: ids and digits the database's own CHECKs already constrained.
 */

/** DI-1062's closed list of window kinds: the same list migration 0073 CHECKs. */
export const SAID_KINDS = Object.freeze(['week-moment', 'rank', 'streak', 'rate', 'pair', 'milestone', 'callback', 'default']);

/**
 * DI-1062 — THE WINDOWS, ONE FROZEN TABLE so changing a number is a visible one-line diff and a test change.
 *   days   a fact is not restated inside this many days unless it changed materially
 *   once   never restated for the same fact key (a week-moment: the moment is the week's)
 *   marks  a streak is said once per run-length mark and again only when it crosses the next mark or breaks
 *   step   a milestone is said once per multiple of this value
 *   season a callback is said once per item per season (the season ledger: 366 days)
 */
export const SAID_WINDOWS = Object.freeze({
  'week-moment': Object.freeze({ once: true }),
  rank: Object.freeze({ days: 7 }),
  streak: Object.freeze({ marks: Object.freeze([3, 5, 8, 10]) }),
  rate: Object.freeze({ days: 14 }),
  pair: Object.freeze({ days: 14 }),
  milestone: Object.freeze({ step: 5 }),
  callback: Object.freeze({ seasonDays: 366 }),
  default: Object.freeze({ days: 14 }),
});
/** DI-1062's "changed materially" thresholds. */
export const SAID_MATERIAL = Object.freeze({ ratePoints: 10, plainDelta: 10 });
/** DI-1063 — the ALREADY SAID block: at most this many lines, from the last this many days. */
export const SAID_BLOCK = Object.freeze({ maxLines: 8, days: 14 });
const DAY_MS = 24 * 60 * 60 * 1000;

// ── the value tuple ────────────────────────────────────────────────────────────────────────────
/** `value_key` grammar, the database's CHECK: digits, an optional decimal, an optional "/denominator", components joined by ';', at most 40 characters. */
export const VALUE_KEY_RE = /^[0-9]+(\.[0-9]+)?(\/[0-9]+)?(;[0-9]+(\.[0-9]+)?(\/[0-9]+)?)*$/;
export const FACT_KEY_RE = /^[A-Za-z0-9_.:|+-]{1,160}$/;
export const METRIC_ID_RE = /^[A-Za-z0-9_.-]{1,60}$/;
export const SUBJECT_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;
export const POST_ID_RE = /^[A-Za-z0-9_:|.-]{1,120}$/;

/** `"87.5;7/8;11"` -> `{ values:[87.5, {a:7,b:8}], final:11 }`; null for anything that is not a tuple of the grammar. */
export function parseValueKey(vk) {
  const s = String(vk || '');
  if (!VALUE_KEY_RE.test(s) || s.length > 40) return null;
  const parts = s.split(';');
  const num = (x) => (x.includes('/') ? { a: Number(x.split('/')[0]), b: Number(x.split('/')[1]) } : Number(x));
  const finalPart = parts.length > 1 ? parts[parts.length - 1] : null;
  const final = finalPart !== null && !finalPart.includes('/') ? Number(finalPart) : null;
  const values = (final !== null ? parts.slice(0, -1) : parts).map(num);
  return { values, final };
}
const v1 = (p) => (p && p.values.length ? (typeof p.values[0] === 'object' ? p.values[0].a : p.values[0]) : null);
const ratioOf = (p) => { const r = p && p.values.find((x) => typeof x === 'object'); return r && r.b > 0 ? r : null; };
const side = (r) => Math.sign(r.a * 2 - r.b);       // above, at or below .500

/**
 * DI-1062 — has the fact changed MATERIALLY since it was said? ALL of: (1) at least one new final game entered since (the last component grew); (2) one of: a rate moved 10 points or more
 * (or crossed .500); a rank changed; a streak crossed a mark or broke; a count crossed a milestone step. Identical values are never material. Unparseable values are never material.
 */
export function isMaterialChange(kind, priorValueKey, nextValueKey) {
  if (priorValueKey === nextValueKey) return false;
  const p = parseValueKey(priorValueKey); const n = parseValueKey(nextValueKey);
  if (!p || !n || p.final === null || n.final === null || !(n.final > p.final)) return false;
  const a = v1(p); const b = v1(n);
  if (a === null || b === null) return false;
  if (kind === 'rank') return a !== b;
  if (kind === 'streak') return b < a || SAID_WINDOWS.streak.marks.some((m) => a < m && m <= b);
  if (kind === 'milestone') return Math.floor(b / SAID_WINDOWS.milestone.step) > Math.floor(a / SAID_WINDOWS.milestone.step);
  const rp = ratioOf(p); const rn = ratioOf(n);
  if (rp && rn) return Math.abs((100 * rn.a) / rn.b - (100 * rp.a) / rp.b) >= SAID_MATERIAL.ratePoints || side(rp) !== side(rn);
  return Math.abs(b - a) >= SAID_MATERIAL.plainDelta;
}

/** The competition-week segment of a fact key (`{metric}|{subject}|{scope}|{asOf}`). */
export const asOfOf = (factKey) => String(factKey || '').split('|')[3] || '';

/**
 * DI-1062 — is this fact blocked by what the room has already heard? `rows` are `scribe_said` rows (`fact_key, kind, metric_id, subject_id, value_key, said_at`), any order.
 * @returns {{blocked:boolean, why:string, prior:boolean}} `prior`: the room has heard this metric for this subject before (the novelty tier)
 */
export function isBlocked(fact, rows, nowMs) {
  const now = Number(nowMs);
  const prior = (Array.isArray(rows) ? rows : []).filter((r) => r && r.metric_id === fact.metricId && r.subject_id === fact.subjectId)
    .sort((a, b) => Date.parse(b.said_at) - Date.parse(a.said_at));
  if (!prior.length) return { blocked: false, why: '', prior: false };
  const w = SAID_WINDOWS[fact.kind] || SAID_WINDOWS.default;
  for (const p of prior) {
    const age = now - Date.parse(p.said_at);
    if (!Number.isFinite(age)) continue;
    const identical = p.value_key === fact.valueKey;
    const material = !identical && isMaterialChange(fact.kind, p.value_key, fact.valueKey);
    if (w.once) { if (p.fact_key === fact.factKey) return { blocked: true, why: 'once', prior: true }; continue; }
    if (w.step) { if (identical || !material) return { blocked: true, why: identical ? 'identical' : 'not_material', prior: true }; continue; }
    if (w.marks) { if (!material) return { blocked: true, why: identical ? 'identical' : 'no_mark', prior: true }; continue; }
    if (w.seasonDays) { if (age < w.seasonDays * DAY_MS && p.fact_key === fact.factKey) return { blocked: true, why: 'season', prior: true }; continue; }
    const inWindow = age < w.days * DAY_MS;
    if (inWindow && identical) return { blocked: true, why: 'identical', prior: true };
    if (inWindow && !material) return { blocked: true, why: 'window', prior: true };
    if (asOfOf(p.fact_key) === asOfOf(fact.factKey) && !material) return { blocked: true, why: 'same_week', prior: true };
  }
  return { blocked: false, why: '', prior: true };
}

/**
 * DI-1062/1065 — split `facts` into those SCRIBE may be given and those it may not, and order the first by NOVELTY: (1) never said in this league, (2) said earlier but changed or out of
 * its window; within a tier a fact that overlaps what the room is saying (a name or a team in `exchangeText`) first, then by interestingness, then in the order given.
 * @returns {{allowed:object[], blocked:object[]}} each blocked entry carries `why`
 */
export function partitionFacts(facts, rows, nowMs, exchangeText = '') {
  const room = String(exchangeText || '').toLowerCase();
  const overlap = (f) => (f.names || []).filter((n) => n && room.includes(String(n).toLowerCase())).length;
  const allowed = []; const blocked = [];
  (Array.isArray(facts) ? facts : []).forEach((f, i) => {
    const r = isBlocked(f, rows, nowMs);
    if (r.blocked) blocked.push({ ...f, why: r.why }); else allowed.push({ ...f, tier: r.prior ? 2 : 1, _i: i });
  });
  allowed.sort((a, b) => a.tier - b.tier || overlap(b) - overlap(a) || (b.interestingness || 0) - (a.interestingness || 0) || a._i - b._i);
  return { allowed: allowed.map(({ _i, ...f }) => f), blocked };
}

const ageWords = (ms) => {
  const d = Math.floor(ms / DAY_MS);
  if (d >= 1) return `${d} day${d === 1 ? '' : 's'}`;
  const h = Math.floor(ms / (60 * 60 * 1000));
  return h >= 1 ? `${h} hour${h === 1 ? '' : 's'}` : 'under an hour';
};
/**
 * DI-1063 — the ALREADY SAID block, from STRUCTURED fields only (a metric id, a seat's cleaned display name, a number tuple, an age): at most 8 lines from the last 14 days, newest first,
 * one line per fact key and value. Empty string when there is nothing to list (no block at all).
 */
export function renderAlreadySaid(rows, nowMs, nameOf = (id) => String(id)) {
  const now = Number(nowMs);
  const seen = new Set();
  const lines = [];
  for (const r of (Array.isArray(rows) ? rows : []).slice().sort((a, b) => Date.parse(b.said_at) - Date.parse(a.said_at))) {
    const age = now - Date.parse(r.said_at);
    if (!Number.isFinite(age) || age < 0 || age > SAID_BLOCK.days * DAY_MS) continue;
    if (!METRIC_ID_RE.test(String(r.metric_id || '')) || !SUBJECT_ID_RE.test(String(r.subject_id || '')) || !VALUE_KEY_RE.test(String(r.value_key || ''))) continue;
    const key = `${r.fact_key}|${r.value_key}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(`- ${r.metric_id} for ${nameOf(r.subject_id)}: ${r.value_key} (${ageWords(age)} ago)`);
    if (lines.length >= SAID_BLOCK.maxLines) break;
  }
  return lines.length ? `ALREADY SAID IN THIS ROOM (do not restate any of these, even rephrased or in other words; the numbers are the facts the room has heard):\n${lines.join('\n')}` : '';
}

const numeralsIn = (text) => new Set((String(text || '').match(/\d+(?:\.\d+)?/g) || []));
/** A row as the database will accept it, or null: every field checked against the same grammar the CHECKs hold. */
export function validRow(r) {
  return r && SAID_KINDS.includes(r.kind) && FACT_KEY_RE.test(String(r.fact_key)) && METRIC_ID_RE.test(String(r.metric_id)) && SUBJECT_ID_RE.test(String(r.subject_id))
    && String(r.value_key).length <= 40 && VALUE_KEY_RE.test(String(r.value_key)) && POST_ID_RE.test(String(r.post_id)) ? r : null;
}
/**
 * DI-1061 — what to record once a post has landed: every SUPPLIED fact whose numbers all appear in the posted text. A fact supplied but not used records nothing; a fact with no number
 * records nothing (there is nothing to restate). Words are read as digits for the match ("seven of eight" is 7 and 8).
 */
export function recordableRows(facts, postedText, postId, digitize = (t) => t) {
  const have = numeralsIn(digitize(String(postedText || '')));
  const rows = [];
  const rawText = String(postedText || '').toLowerCase();
  for (const f of Array.isArray(facts) ? facts : []) {
    if (f && f.nameOnly) {                                                                                  // a rank fact with no digit: said when the post names the member and says they are on top
      if (!(f.names || []).some((n) => n && rawText.includes(String(n).toLowerCase())) || !RANK_CUE_RE.test(rawText)) continue;
    } else if (!f || !(f.numbers || []).length || !f.numbers.every((n) => have.has(String(n)))) continue;
    const row = validRow({ fact_key: f.factKey, kind: f.kind, metric_id: f.metricId, subject_id: f.subjectId, value_key: f.valueKey, post_id: postId });
    if (row) rows.push(row);
  }
  return rows;
}

// ── a producer today: the evidence layer's verified fact strings ────────────────────────────────
const KIND_OF_TRIGGER = Object.freeze({ chartLeadChange: 'rank', streak: 'streak', milestone: 'milestone', historyCallback: 'callback' });
/**
 * SECURITY F5 (2026-10-21) — NOTHING A MEMBER TYPED IS EVER A LEDGER FACT. A claim's verified fact is the member's message quoted verbatim, and a drink-debt or volume note is built from one;
 * a row built from them would persist a display-name slug and the numbers a member typed for 90 days, including after account deletion. So (1) the triggers whose event IS a member's message
 * produce NO ledger facts, (2) any fact string that carries a quotation produces none, and (3) `metric_id` comes from the trigger plus this CLOSED label table, matched on the fact's own
 * wording (which names no one: the table's patterns never contain a name), never from a slug of the text before the colon. A string the table does not recognise is not a ledger fact.
 */
export const MESSAGE_TRIGGERS = Object.freeze(['claim', 'drinkDebt', 'verbosity', 'roastOfScribe', 'heatedExchange']);
export const FACT_LABELS = Object.freeze([
  [/^new leader:/i, 'leader'],
  [/'s record:/i, 'record'],
  [/^displaced:.*\bnow rank\b/i, 'displaced_rank'],
  [/\bthe gap at the top:/i, 'gap_top'],
  [/\bthe gap to last:/i, 'gap_last'],
  [/^milestone crossed\b/i, 'milestone'],
  [/\bexact raw correct-pick total:/i, 'total'],
  [/^streak broken\b/i, 'run_break'],
  [/^streak: /i, 'run'],
  [/^final score:/i, 'score'],
  [/^vote count:/i, 'vote'],
  [/\bwas the only one on it\b/i, 'lone_pick'],
]);
export const LABEL_IDS = Object.freeze(FACT_LABELS.map(([, id]) => id));
/** Labels whose fact states NO number ("new leader: Drew"): the rank is the fact. They are recorded as rank 1, and "said" means the post names the member AND uses a rank cue (RANK_CUE_RE). */
export const NAME_ONLY_LABELS = Object.freeze(['leader']);
/** The words that say a member is on top. A name-only rank fact counts as said (and as restated) only when the text names the member and one of these appears. */
export const RANK_CUE_RE = /\b(first|1st|top|tops|lead|leads|leader|leading|ahead|front|number one|no\. ?1|#1|summit|crown|throne|ahead of everyone)\b/i;
const slug = (s, n) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n);
const TOKEN_RE = /(\d+(?:\.\d+)?)(?:\s*(?:\/|to|of|for|-)\s*(\d+(?:\.\d+)?))?/g;
/**
 * Until the analytics engine supplies typed facts (lane D's `factsFor`), the verified fact STRINGS of the evidence layer are the facts SCRIBE is given. This reads each string that
 * carries a number into the ledger's shape: the label before the colon is the metric, the subject is the trigger's member (or the league), the tuple is every number in order and the PRIMARY numbers (the first one, and its denominator) are what a post must state to count as having said it, and `finalGames`
 * (the count of FINAL games league-wide, computed by the caller) is the last component. A string with no number, a string the closed label table does not name, and anything built from a member's
 * message are not ledger facts and are left alone (security F5).
 * @param {{trigger:string, facts:string[], subjectId?:string, subjectName?:string, weekId?:string, finalGames:number}} a
 */
export function structuredFactsFor({ trigger, facts, subjectId = '', subjectName = '', weekId = '', finalGames = 0, gameTag = '', namedMembers = [] } = {}) {
  const subject = SUBJECT_ID_RE.test(String(subjectId)) ? String(subjectId) : '_league';
  const kind = KIND_OF_TRIGGER[trigger] || 'week-moment';
  const out = [];
  if (MESSAGE_TRIGGERS.includes(trigger)) return out;                                                    // F5 (1): the event IS a member's message
  (Array.isArray(facts) ? facts : []).forEach((text, factIndex) => {
    const s = String(text || '');
    if (/["\u201c\u201d]/.test(s)) return;                                                              // F5 (2): a quotation carries member text
    const hit = FACT_LABELS.find(([re]) => re.test(s));
    if (!hit) return;                                                                                    // F5 (3): not in the closed table, not a ledger fact
    const label = hit[1];
    const nameOnly = NAME_ONLY_LABELS.includes(label);
    // the member this fact is ABOUT: the trigger's subject, except the displaced leader, who is the second named member (never the new leader's id)
    let who = subject; let whoName = subjectName;
    if (label === 'displaced_rank') {
      const d = (Array.isArray(namedMembers) ? namedMembers : [])[1];
      if (!d || !SUBJECT_ID_RE.test(String(d.id)) || String(d.id) === subject) return;                   // cannot attribute it: record nothing rather than record it under the wrong member
      who = String(d.id); whoName = String(d.name || '');
    }
    const tokens = [];
    let numbers = [];
    for (const m of s.matchAll(TOKEN_RE)) {
      tokens.push(m[2] !== undefined ? `${m[1]}/${m[2]}` : m[1]);
      if (!numbers.length) { numbers = [m[1]]; if (m[2] !== undefined) numbers.push(m[2]); }       // the PRIMARY stat: the first number (and its denominator); a line states that one under the one-number cap
    }
    if (nameOnly) { if (!whoName) return; tokens.push('1'); }                                         // the leader is rank 1; the post must name them (RANK_CUE_RE) to count as said
    if (!tokens.length) return;
    let kept = tokens.slice(0, 4);
    let vk = `${kept.join(';')};${Math.max(0, Math.floor(Number(finalGames) || 0))}`;
    while (vk.length > 40 && kept.length > 1) { kept = kept.slice(0, -1); vk = `${kept.join(';')};${Math.max(0, Math.floor(Number(finalGames) || 0))}`; }
    if (!VALUE_KEY_RE.test(vk) || vk.length > 40) return;
    const metricId = `${slug(trigger, 24) || 'event'}.${label}`.slice(0, 60);
    const asOf = (slug(weekId, 40) || 'w') + (kind === 'week-moment' && gameTag ? `.g${slug(gameTag, 40)}` : '');   // a week-moment is a GAME's moment: the second game's final in the same week is a new moment
    const factKey = `${metricId}|member:${who}|league|${asOf}`.replace(/[^A-Za-z0-9_.:|+-]/g, '_').slice(0, 160);
    out.push({ factIndex, factKey, kind, metricId, subjectId: who, valueKey: vk, numbers: nameOnly ? [] : [...new Set(numbers)], names: whoName ? [whoName] : [label.split('_')[0]], interestingness: 0, ...(nameOnly ? { nameOnly: true } : {}) });
  });
  return out;
}

// ── DI-992: the game, the league and the analytics, only where they belong ──────────────────────
/** DI-1064 replaced DI-992's "at most 2 engine facts": ONE fact, and only in a `fact` post (a `react` is given none). */
export const COMPUTED_FACTS_CAP = 1;
/**
 * DI-992 — THE RELEVANCE GATE, run before any generation. An engine fact is given to the model only when (1) the post is a `fact` post (a react or an event post is given none: DI-1064),
 * (2) at least one entity of the fact overlaps the exchange (a name or a team it carries appears in the room text, or its subject is one of the members in the exchange), and (3) none of its
 * primary numbers is already stated in the exchange (a human who just said "7 for 8" does not need SCRIBE to say it back). The survivors keep the order they came in (the novelty order of
 * `partitionFacts`), cut to the cap. A fact with no `text` rendering is not an engine fact and is never offered here.
 * @param {object[]} facts typed facts: `{ text, names[], subjectId, numbers[] , ...ledger fields }`
 * @param {{ mode:string, exchangeText?:string, memberIdsInExchange?:string[], cap?:number }} o
 */
export function gateEngineFacts(facts, { mode = 'react', exchangeText = '', memberIdsInExchange = [], cap = COMPUTED_FACTS_CAP } = {}) {
  if (mode !== 'fact' || !(cap > 0)) return [];
  const room = String(exchangeText || '').toLowerCase();
  const said = numeralsIn(room);
  const inRoom = new Set((memberIdsInExchange || []).map(String));
  return (Array.isArray(facts) ? facts : []).filter((f) => f && typeof f.text === 'string' && f.text.trim()
    && ((f.names || []).some((n) => n && room.includes(String(n).toLowerCase())) || inRoom.has(String(f.subjectId)))
    && !(f.numbers || []).some((n) => said.has(String(n)))).slice(0, cap);
}
/** DI-992 — the labelled block the model is given. Empty string when there is no fact (no block at all). */
export function computedFactsBlock(facts) {
  const lines = (Array.isArray(facts) ? facts : []).filter((f) => f && typeof f.text === 'string' && f.text.trim()).map((f) => `- ${f.text.replace(/\s+/g, ' ').trim()}`);
  return lines.length ? `COMPUTED FACTS (use only these numbers):\n${lines.join('\n')}` : '';
}
/**
 * The whole fact packet, one pure function (DI-992 + DI-1061 to 1063 + DI-1064): the facts the evidence layer verified (as strings) and any typed engine facts, minus what the room has already
 * heard, ordered by novelty; the engine facts that clear the relevance gate; and the facts a post may be recorded as having said. An unreadable ledger offers no number at all.
 * @returns {{promptFacts:string[], computed:object[], supplied:object[], blocked:object[], offered:number}} `offered` = how many facts could have been offered (for the fact-to-react downgrade)
 */
export function buildFactPacket({ verifiedFacts = [], stringFacts = [], engineFacts = [], rows = [], nowMs, exchangeText = '', memberIdsInExchange = [], mode = 'react', cap = COMPUTED_FACTS_CAP, ledgerFailed = false } = {}) {
  const all = [...stringFacts, ...(Array.isArray(engineFacts) ? engineFacts : [])];
  const part = ledgerFailed ? { allowed: [], blocked: all } : partitionFacts(all, rows, nowMs, exchangeText);
  const drop = new Set(part.blocked.filter((f) => f.factIndex !== undefined).map((f) => f.factIndex));
  const promptFacts = (Array.isArray(verifiedFacts) ? verifiedFacts : []).filter((_, i) => !drop.has(i));
  const stringAllowed = part.allowed.filter((f) => f.factIndex !== undefined);
  const computed = ledgerFailed ? [] : gateEngineFacts(part.allowed.filter((f) => f.factIndex === undefined), { mode, exchangeText, memberIdsInExchange, cap });
  return { promptFacts, computed, supplied: [...stringAllowed, ...computed], blocked: part.blocked, offered: all.length - part.blocked.length };
}
