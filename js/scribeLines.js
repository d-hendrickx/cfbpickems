/**
 * CFB Pickems — S.C.R.I.B.E. Tier 0 (deterministic) — v0.16.0
 * ============================================================
 * Spread Coverage Records & Ischemic Banter Engine.
 *
 * Canned-line engine governed by docs/SCRIBE.md (v2.1). No API calls.
 * Voice constraints enforced IN THE POOLS (do not drift):
 *   - deadpan, dry — the funniest friend in the group chat, with perfect recall
 *   - standings = "the standings" (not "the chart"), picks = "picks"
 *   - "SCRIBE NOTE:" as a reflex opener; "Filed.", "Noted.", "Documented.",
 *     "— SCRIBE" as reflex closers; and the mock-clinical SOAP-note template
 *     ("Assessment: / Plan: / Prognosis:") as a default line structure are all
 *     RETIRED as defaults (v2.1) — rare seasoning only, per docs/SCRIBE.md §6,
 *     never a majority of lines in a pool
 *   - flat-delivered casual hype ("LFG", "we're so back", "RIP", "pay up") is
 *     in-register when a moment earns it — distinct from "never hypes" (no
 *     "MASSIVE upset," no announcer voice); see docs/SCRIBE.md §6
 *   - profanity rare and surgical (max ONE instance per pool)
 *   - almost no ALL CAPS — restraint is the bit
 *   - savage about football, never about real life
 *
 * v0.17.1 vocabulary correction: "orders" is RETIRED. Picks are picks — the
 * medical-jargon substitution read as strained rather than natural SCRIBE voice.
 * The rest of the register stands.
 *
 * v2.1 (2026-09-10) voice refresh: pool lines rewritten to drop the reflex
 * opener/closer tics and the SOAP-note-as-default template Drew flagged as
 * "very cringey" in draft notification copy review (2026-09-10 ruling; see
 * docs/SCRIBE.md changelog). Mechanism — pool keys, pickLine() selection,
 * the ledger, rate limits, deterministic ids — is unchanged. Copy only.
 *
 * RATE LIMITS DEFINE THE CHARACTER:
 *   - max 1 SCRIBE message / 10 min in general
 *   - max 1 SCRIBE message / hour per game channel
 *   - no line reused within 14 days (used-line ledger, device-local)
 *   - a rate-limited trigger is DROPPED, never queued
 *
 * EXACTLY-ONCE ACROSS SIX CLIENTS: every SCRIBE message id is deterministic —
 * `scribe_<trigger>_<subject>_<timeBucket>` — so when all six devices detect the
 * same trigger simultaneously, the server's id-dedupe collapses them to one row.
 */

import { sendEvent, whenAppended, getMessages } from './chat.js';
// Build 2, Group C (2026-09-10, UN-150…154) — the @scribe mention branch now
// calls the interactive (LLM-backed) runtime instead of posting a canned
// line unconditionally. One-directional import (scribeAgent.js never imports
// this module) so there is no cycle: scribeAgent.js is a thin backend relay
// + settings gate, this module owns the pool/fallback/dedup mechanics it
// already owned before this build.
import {
  isScribeInteractiveEnabled, scribeAskRemote,
  // Build 3, Group D (2026-09-11) — the autonomous path's settings gate and
  // its two relays. Same one-directional import as Build 2: scribeAgent.js
  // never imports this module, so there is no cycle.
  getScribeFrequency, isScribeAutonomousReady, scribeAutonomousRemote, scribeClassifyRemote,
  // SCRIBE v3, Package D (2026-09-24, DI-283) — the reaction relay. Same
  // one-directional import, same gate shape: it is a no-op unless autonomy is
  // ready on this device, and the AUTHORITATIVE gate is the server's own
  // `scribeReact` job switch.
  scribeReactRemote,
  // SCRIBE v3, Package A (2026-09-23, DI-267) — the league's heat dial, read
  // for the META STAMP ONLY. These pools do not change with it (see the
  // single-register block above the pools); what the stamp records is the gap
  // between what the commissioner set and what a canned line can actually be.
  getScribeHeat,
} from './scribeAgent.js';

// UN-160 (E2) — a hand-bumped constant, analogous to APP_VERSION (js/app.js):
// bump it alongside a SCRIBE_POOLS content edit so a feedback record can tell
// WHICH voice pool generated the line it's rating, months later. Deliberately
// NOT tied to APP_VERSION itself — SCRIBE's voice can change independently of
// an app release. Carried on every SCRIBE post via scribeTrigger() below.
export const SCRIBE_VERSION = '3.0';

const LEDGER_KEY = 'cfbp_scribe_ledger';   // { lineHash: lastUsedMs }
const LAST_POST_KEY = 'cfbp_scribe_lastpost'; // { rateKey: lastMs } ('' = main room, gameId = per-game)
const REUSE_WINDOW_MS = 14 * 24 * 3600 * 1000;
const GENERAL_COOLDOWN = 10 * 60 * 1000;
const GAME_COOLDOWN = 60 * 60 * 1000;

// ── Line pools ────────────────────────────────────────────────────────────────
// {NAME} = display name of the subject player. {N} = a number when supplied.
//
// ── SCRIBE v3 (2026-09-23): THE POOLS STAY AT ONE REGISTER, AND THAT IS A
//    DECISION, NOT AN OVERSIGHT. ────────────────────────────────────────────
// v3 adds a five-level heat dial (docs/SCRIBE.md §4). These canned lines are
// NOT tagged by level and no hotter variants were written. DI-262 recommends
// this single-register route and the reasons are worth keeping next to the
// pools themselves:
//
//   THE LLM CARRIES THE HEAT. Every level above Dry is defined by judgement —
//   commit to one target, land a your-mom joke only if it is absurd enough to
//   assert nothing, stack profanity ONLY when the stack lands harder than one
//   clean word. A fixed string cannot make any of those calls; it can only be
//   hot, every time it fires, at whoever it happens to be about.
//
//   THESE LINES ARE THE DEGRADED PATH. Tier-0 fires when the model is
//   unreachable, throttled, over budget, or switched off. Writing a No Mercy
//   pool would mean the league's HARSHEST lines are the ones that ship when
//   the system is least able to judge whether they fit — and with no hard-line
//   check and no roast-tolerance cap in front of them, because neither of those
//   lives on this path.
//
//   FIVE POOLS × EVERY TRIGGER IS ALSO A CONTENT PROBLEM. The 14-day no-repeat
//   ledger already burns a pool down; splitting each one five ways either
//   multiplies the writing or makes each level's pool small enough to become a
//   tic — the exact failure §6 retired four catchphrases for.
//
// So: Dry, everywhere, at every dial position. `loadtest.mjs` §[4] enforces it
// mechanically (zero stacked profanity, no shouted caps), and `heattest.mjs`
// asserts the briefs that DO carry heat are the LLM's, not these.
export const SCRIBE_POOLS = {
  // ── v2.1 voice refresh (2026-09-10): reflex openers/closers ("SCRIBE NOTE:",
  // "Filed.", "Noted.", "Documented.", "— SCRIBE") and the SOAP-note-as-default
  // template are gone as DEFAULTS per docs/SCRIBE.md §6. Same jokes, fewer
  // costumes. "The chart" reverts to "the standings" throughout.
  coverageFlip: [
    'The number just flipped. Adjust your blood pressure accordingly.',
    'The cover just flipped. You should probably be watching this one.',
    'The spread and the scoreboard just swapped places.',
    'Big reversal. A few of you are in trouble now.',
    'The cover has changed hands. No further comment at this time.',
  ],
  upsetWatch: [
    'The underdog isn\'t cooperating with anyone\'s picks.',
    'Upset watch: this one\'s getting away from the favorite.',
    'The favorite is in trouble.',
    '{TEAM} clearly didn\'t see the spread.',
    'Rough day on the field. A lot of picks just died.',
  ],
  callout: [
    'Bold talk earlier. Result\'s in now.',
    'Somebody was pretty confident about this one. The scoreboard disagreed.',
    'Here\'s what was said before kickoff. Here\'s what happened.',
    'Before, and after. Let that sit.',
    'Someone\'s about to regret typing that.',
  ],
  anniversary: [
    'One year ago today, this happened. Still true.',
    'A year ago today, this happened.',
    'Happy anniversary to this specific disaster.',
    'A year later, still just as true.',
  ],
  silence: [
    'It\'s quiet in here. Weird.',
    'Nobody\'s said anything in a while.',
    'Everybody\'s suspiciously quiet.',
    'Quiet week. Standings haven\'t moved either, for what it\'s worth.',
  ],
  // v2.1: `mention` is the Tier-0 degraded fallback for a direct @scribe
  // mention — honest, in-register "not engaging with that right now," never
  // a mock-legal brush-off.
  // B3 remediation (2026-09-10, round 1) — widened 6 -> 10 lines so the pool
  // takes longer to fully burn within the 14-day reuse window, per the
  // reviewer's B3b finding: a fully-burned pool used to mean silence on a
  // direct @scribe mention (see scribeMentionDegraded()'s LAST_RESORT line,
  // below, for the hard floor beneath even this).
  mention: [
    'Not touching that one right now, {NAME}.',
    'Not getting into that one right now. Standings are public if you want the real answer.',
    'Can\'t help with that one, {NAME}. Try the standings page.',
    'Not the moment for that, {NAME}. Ask again later.',
    'I keep the receipts, {NAME}. I do not issue predictions.',
    'That one\'s not happening right now. Standings don\'t lie, though, if that helps.',
    'Ask the standings page, {NAME}. It answers faster than I will right now.',
    'Sitting this one out, {NAME}.',
    'Not right now. The record\'s public if you want to check it yourself.',
    'Give it a minute, {NAME}. Try again later.',
  ],
  backdoorBust: [
    'Rough ending. Backdoor cover, right at the gun.',
    '{NAME} got backdoored. That\'s it. That\'s the post.',
    '{NAME}\'s pick died in garbage time. Classic.',
    '{NAME} lost it in the final minute. Brutal.',
    'Busted at the buzzer. Tough one.',
    'Covered for 59 minutes and 58 seconds. So close.',
  ],
  lastPlaceTaunt: [
    'Bold talk for someone in last place, {NAME}.',
    'Big talk from the bottom of the standings.',
    'The standings don\'t back that tone, {NAME}.',
    '{NAME} is talking. So are the standings, and they disagree.',
    'Standing is earned, not announced, {NAME}.',
    'This is a learning opportunity, {NAME}.',
  ],
  buzzerPicks: [
    'Picks landed right at the buzzer.',
    '{NAME} got picks in with {N} minutes to spare. Living dangerously.',
    'Cutting it close. No style points for urgency.',
    'Under the wire. Barely.',
    'Got the timestamp, {NAME}. It\'s not a good look.',
    'Got \'em. Next time, maybe don\'t cut it this close.',
  ],
  verbosity: [
    'Somebody\'s typing a lot right now.',
    '{NAME} has sent {N} messages in two minutes. Take a breath.',
    'That\'s a lot of messages. Not all of them were necessary.',
    'Brevity is also a skill, {NAME}.',
    'Alright, {NAME}. Carry on.',
    '{NAME} is still typing. We can all see it.',
  ],
  drinkDebt: [
    'Still owed. Pay up.',
    'Somebody mentioned the tab. In-person payment only, per the rules.',
    'The ledger is current. The ledger is patient. The ledger forgets nothing.',
    'Balance\'s still there. Interest accrues in humiliation, not cash.',
    'Per the rules: debts get settled in person. Everyone\'s watching.',
    'The billing department (that\'s me) thanks you for your attention to this matter.',
  ],
  // v2.1: the "historical hit rate of unanimous picks: unfavorable" line is
  // REMOVED, not reworded — that claim was never backed by computed data.
  unanimous: [
    'Everyone agrees. Everyone\'s agreed before too.',
    'Six identical picks. I\'ll just leave the all-time record right here.',
    'Everyone\'s on the same side this week. Confidence is not a diagnosis, gentlemen.',
    'Full consensus this week. History has a long memory.',
  ],
  loneWolfWin: [
    '{NAME} was the only one on this side. Correctly.',
    'One dissenter, one cover. Credit to {NAME}.',
    'Went against everybody and covered anyway, {NAME}. Respect. Sort of.',
    'Bad week for five of you. Just another Tuesday for {NAME}.',
    'Solo cover. Everyone else should probably rethink their process.',
  ],
  chartLeadChange: [
    'New name at the top of the standings, gentlemen.',
    'We\'ve got a new leader. Season\'s still long.',
    'Lead change. Whoever was on top last week might want to reread their own texts.',
    'New name on top. Wild how fast that changes.',
    'Standings updated. The throne is drafty this time of year.',
  ],
  extraPointBust: [
    '{NAME} went over on the Extra Point. Outlook: thirsty.',
    '{NAME} busted the Extra Point. The rules were posted. Reading them was optional, apparently.',
    'Busted. The house thanks you for your donation, {NAME}.',
    'Over the number. Off the table.',
    '{NAME} busted the Extra Point. Restraint is also a strategy, gentlemen.',
  ],
  extraPointWin: [
    '{NAME} holds on the Extra Point. Discipline, apparently.',
    'Closest without going over: {NAME}. Rules respected.',
    'Extra Point\'s done. {NAME} read the table correctly.',
    'The Extra Point has a winner. It also has casualties. Both are noted.',
  ],
  // ── FEAT-5 (UN-202 / DI-202f, DI-202h) — wager memory. SCRIBE records a bet
  // and reads it back on the due week. SCRIBE NEVER SETTLES IT (DI-202i):
  // there is no data-derived slot in any line below — no score, no rank, no
  // record, no standing — so there is nothing for a line to fill an outcome
  // with. Adding one would be a visible change to the DI. {claim} is echoed
  // verbatim from the stored value and escaped at render (escHtml).
  //
  // THESE FOUR POOLS NEVER GO THROUGH pickLine()/scribeTrigger(). Selection is
  // wagerLine() below — a stable hash of the wagerId, so six devices build
  // byte-identical text before chatAppend's id-dedupe picks a winner (AD-11),
  // and a receipt is never silently dropped by the 14-day no-repeat ledger.
  wagerLogged: [
    'Logged. {proposer} against {counterparty}, due by {dueWeek}.',
    '{proposer} versus {counterparty}, settle by {dueWeek}. On the record now.',
    'On the record: {proposer} and {counterparty}, deadline {dueWeek}. I\'ll bring it back then.',
    'That one\'s in the file — {proposer} against {counterparty}, due {dueWeek}. No opinion from me either way.',
  ],
  wagerDueAccepted: [
    '{weekLabel}, as promised. {proposer} said "{claim}". {counterparty} took it. Settle it among yourselves.',
    'Due date. {proposer}: "{claim}". {counterparty} accepted at the time. The room can sort out the rest.',
    'Bringing this back for {weekLabel}. {proposer} claimed "{claim}", and {counterparty} said yes. Not my call.',
    'From the file: {proposer} — "{claim}". {counterparty} took the other side. {weekLabel} is here; you two work it out.',
  ],
  wagerDueDeclined: [
    '{weekLabel}. {proposer} said "{claim}". {counterparty} passed on it, so nothing is riding on this one.',
    'Due today: "{claim}", from {proposer}. {counterparty} declined at the time — no stakes, just the statement.',
    'For the record at {weekLabel}: {proposer} claimed "{claim}". {counterparty} took a pass, so there\'s nothing to collect either way.',
    '{proposer} put this out before {weekLabel}: "{claim}". {counterparty} didn\'t take it, so nothing is on the line.',
  ],
  wagerDueSilent: [
    '{weekLabel}. {proposer} said "{claim}". Nobody took the other side on the record, so what that\'s worth is up to you.',
    'Resurfacing this one for {weekLabel}: {proposer} — "{claim}". No one ever went on record against it. Make of that what you want.',
    '{proposer} claimed "{claim}" before {weekLabel}. The record shows nobody opposed it. Whether that still counts is the room\'s question, not mine.',
    'Deadline is here for {weekLabel}. {proposer}: "{claim}". Nothing was accepted and nothing was declined — I\'m only reporting the gap.',
  ],
};

// ── Rate limiting + no-repeat ledger ─────────────────────────────────────────
function ledger() { try { return JSON.parse(localStorage.getItem(LEDGER_KEY) || '{}'); } catch { return {}; } }
function saveLedger(l) { try { localStorage.setItem(LEDGER_KEY, JSON.stringify(l)); } catch {} }
function lastPosts() { try { return JSON.parse(localStorage.getItem(LAST_POST_KEY) || '{}'); } catch { return {}; } }
function saveLastPosts(l) { try { localStorage.setItem(LAST_POST_KEY, JSON.stringify(l)); } catch {} }

function hashLine(s) { let h = 0; for (let i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) | 0; } return 'h' + (h >>> 0).toString(36); }

/**
 * UN-112 (DI-112b) — chat epoch clear. Empties SCRIBE's device-local
 * "already said" memory (the 14-day no-repeat ledger and the per-room
 * rate-limit cooldowns) so a freshly-cleared room doesn't inherit a burned
 * line pool or a live cooldown from pre-launch testing. Called via
 * chat.js's notify('epochApplied', ...) — chat-ui.js is the subscriber.
 * Module layering: this module clears only the two keys IT owns; chat.js
 * clears its own (outbox, lastseen) directly, never through here.
 */
export function resetScribeMemory() {
  try { localStorage.removeItem(LEDGER_KEY); } catch {}
  try { localStorage.removeItem(LAST_POST_KEY); } catch {}
}

function rateLimited(gameTag) {
  const lp = lastPosts();
  const key = gameTag || 'main';
  const cooldown = gameTag ? GAME_COOLDOWN : GENERAL_COOLDOWN;
  return Date.now() - (lp[key] || 0) < cooldown;
}
function noteRate(gameTag) { const lp = lastPosts(); lp[gameTag || 'main'] = Date.now(); saveLastPosts(lp); }

function pickLine(poolKey, vars = {}) {
  const pool = SCRIBE_POOLS[poolKey] || [];
  const led = ledger();
  const now = Date.now();
  const fresh = pool.filter(l => (now - (led[hashLine(l)] || 0)) > REUSE_WINDOW_MS);
  if (!fresh.length) return null;   // whole pool burned within 14 days → stay silent
  // Deterministic-ish selection keyed to the day so simultaneous clients pick
  // the same line (their ids collide anyway; this keeps the *content* identical).
  const dayKey = Math.floor(now / 86400000);
  const line = fresh[dayKey % fresh.length];
  const led2 = ledger(); led2[hashLine(line)] = now; saveLedger(led2);
  return line.replace(/\{NAME\}/g, vars.name || 'gentlemen')
             .replace(/\{N\}/g, vars.n != null ? String(vars.n) : 'several');
}

/** Time bucket for deterministic ids (10-minute granularity). */
function bucket(ms = Date.now(), sizeMin = 10) { return Math.floor(ms / (sizeMin * 60000)); }

// ── FEAT-3 (UN-200 / DI-200e, amended A1.4) — the once-per-deployment release
// note SCRIBE posts to the main room. NOT part of SCRIBE_POOLS: this pool does
// not route through scribeTrigger(), pickLine(), the 14-day no-repeat ledger,
// or the rate limiter. Selection is deterministic by version string (see
// whatsNewPostLine below).
//
// (The approved copy doc numbers these DI-170e / UN-170; the register
// renumbered them to UN-200 / DI-200 at handoff. Same content, same rulings.)
//
// Slots: {version} {nAdded} {nFixed} {headline} — and {alsoVersion} in catchUp.
// Line 1 always names the version and both counts. Line 2 is always {headline}.
// Counts are worded count-agnostically on purpose: "3 new, 0 fixed" and
// "1 new, 1 fixed" are both grammatical, so NO pluralization helper is needed.
// Both sets are deliberately the same length (4) so ONE index derived from the
// version string is valid against either.
export const WHATS_NEW_POST_TEMPLATES = {
  // One release on the card.
  single: [
    '{version} is live. {nAdded} new, {nFixed} fixed.\nTop of the list: {headline}',
    '{version} just landed, {nAdded} new and {nFixed} fixed.\nFirst item: {headline}',
    'New build is up. {version}, {nAdded} new, {nFixed} fixed.\nLeading it off: {headline}',
    '{version} shipped. The count is {nAdded} new and {nFixed} fixed.\nStarting with: {headline}',
  ],
  // Two releases on the card — the newer one shipped today, {alsoVersion} did not.
  catchUp: [
    '{version} is live. {nAdded} new and {nFixed} fixed, and that count includes {alsoVersion}, which shipped earlier.\nToday\'s first item: {headline}',
    '{version} is in, and {alsoVersion} is finally getting its notes. {nAdded} new and {nFixed} fixed between them.\nNewest item: {headline}',
    'Two releases in one post. {version} today, {alsoVersion} from before, {nAdded} new and {nFixed} fixed combined.\nTop of the new list: {headline}',
    '{version} shipped today. {nAdded} new, {nFixed} fixed across it and {alsoVersion}, which is older and is only catching up here.\nFrom the new one: {headline}',
  ],
};

/**
 * Deterministic template pick — NEVER Math.random().
 *
 * Six devices each build this body optimistically before the server's id-dedupe
 * (AD-11, `sys_whatsnew_<version>`) picks a winner. A random pick means five of
 * them briefly render a sentence that is not the one that actually landed, and
 * then visibly change it when the real row arrives. Keyed to the version string
 * so the same release reads the same on every device, forever, including after
 * a reinstall.
 *
 * Reuses hashLine() — the module's existing string hash — rather than adding a
 * second one; `.slice(1)` drops its 'h' prefix and the rest is base-36 digits.
 */
function whatsNewStableIndex(version, len) {
  if (!len) return 0;
  const n = parseInt(hashLine(String(version || '')).slice(1), 36);
  return (Number.isFinite(n) ? n : 0) % len;
}

/**
 * The body of the release post. Slot fill only — no model call, no invention,
 * every word either a template above or a value computed from
 * WHATS_NEW_RELEASES by the caller (app.js). `{alsoVersion}` selects the set:
 * a non-empty one means the card is showing an older catch-up release too, and
 * there is deliberately no template that renders an empty {alsoVersion} into a
 * dangling clause.
 */
export function whatsNewPostLine({ version = '', nAdded = 0, nFixed = 0, headline = '', alsoVersion = '' } = {}) {
  const set = alsoVersion ? WHATS_NEW_POST_TEMPLATES.catchUp : WHATS_NEW_POST_TEMPLATES.single;
  const tpl = set[whatsNewStableIndex(version, set.length)] || set[0];
  return tpl
    .replace(/\{version\}/g, String(version))
    .replace(/\{alsoVersion\}/g, String(alsoVersion))
    .replace(/\{nAdded\}/g, String(nAdded))
    .replace(/\{nFixed\}/g, String(nFixed))
    .replace(/\{headline\}/g, String(headline));
}

// ── FEAT-5 (UN-202 / DI-202f, DI-202h, DI-202n item 5) — wager memory ───────
//
// THE ONE CLAIM TRUNCATION, used by the modal prefill, the stored `value`, and
// both post bodies. DI-202n names it explicitly so a sixth surface cannot grow
// a seventh truncation that drifts from this one.
//
// WHY 110 AND NOT 200: the stored `value` is a JSON envelope and
// backend/Code.gs hard-slices `value` at SCRIBE_MEMORY_VALUE_MAX_CHARS_ = 200.
// A slice landing mid-JSON produces an UNPARSEABLE row — silently, forever.
// Envelope arithmetic: {"c":"","o":"","w":"","b":""} = 29 chars, plus a
// playerId (≤20) + weekId (≤24) + playerId (≤20) = 93 worst case, leaving 107.
// 110 is the cap this function applies to the RAW claim text. It is NOT a cap
// "before JSON-escaping" — the DI's sentence said that and was wrong; the code
// is right and this comment was the thing out of date (corrected 2026-09-12,
// RG-120 item (xiii)). What actually guarantees the 200-char envelope is
// app.js's buildWagerValue(): it serialises, then SHORTENS THE CLAIM ONE
// CHARACTER AT A TIME until the serialised envelope itself fits, and returns
// null if it still cannot — so escaping (a quote costing two characters, an
// emoji costing more) is measured rather than estimated. 110 is the normal-case
// cap; the loop is the guarantee. Both halves are build requirements, not advice.
export const WAGER_CLAIM_MAX = 110;
export function wagerClaimTruncate(text, max = WAGER_CLAIM_MAX) {
  const raw = String(text === undefined || text === null ? '' : text).trim();
  const cap = Number.isFinite(Number(max)) && Number(max) > 0 ? Number(max) : WAGER_CLAIM_MAX;
  if (raw.length <= cap) return raw;
  return raw.slice(0, cap).trimEnd();
}

/**
 * Deterministic pool selection for the four wager pools — a stable hash of the
 * wagerId, NEVER Math.random(), and NEVER via pickLine().
 *
 * pickLine() is wrong here twice over (copy doc §5): it enforces the 14-day
 * no-repeat ledger and returns null when a pool is burned — a wager receipt
 * must never be silently dropped — and it applies the 10-minute/1-hour rate
 * limits. Six devices must build byte-identical text before chatAppend's
 * id-dedupe picks a winner (AD-11), which a device-local ledger cannot promise.
 *
 * SLOTS, and only these: {proposer} {counterparty} {dueWeek} {claim}
 * {weekLabel}. There is no data-derived slot in any line — no score, no rank,
 * no record, no standing — which is the STRUCTURAL guarantee that SCRIBE cannot
 * settle a bet (DI-202i #2). {dueWeek}/{weekLabel} must be
 * formatWeekLabelParts(week).name ("Week 7"), never formatWeekLabel(week),
 * which appends a date range and turns every line into a run-on.
 */
export function wagerLine(pool, { wagerId = '', proposer = '', counterparty = '', dueWeek = '', claim = '', weekLabel = '' } = {}) {
  const set = SCRIBE_POOLS[pool] || [];
  if (!set.length) return '';
  const n = parseInt(hashLine(String(wagerId || '')).slice(1), 36);
  const tpl = set[(Number.isFinite(n) ? n : 0) % set.length] || set[0];
  return tpl
    .replace(/\{proposer\}/g, String(proposer))
    .replace(/\{counterparty\}/g, String(counterparty))
    .replace(/\{dueWeek\}/g, String(dueWeek))
    .replace(/\{weekLabel\}/g, String(weekLabel))
    .replace(/\{claim\}/g, String(claim));
}

// ── Build 2, Group C (2026-09-10) — degraded-mode fallback for the
// interactive @scribe mention ────────────────────────────────────────────
// Drew's C-2 ruling: on throttle/budget-cap/outage, SCRIBE degrades to the
// existing static `mention` pool AND must VISIBLY tell players it's running
// on canned lines — a degraded reply must never read as an ordinary LLM
// answer. This reuses the SAME pool/ledger/no-repeat mechanics as
// `scribeTrigger('mention', …)` (via `pickLine`, not duplicated), always
// bypasses the rate limit (mirrors `scribeTrigger`'s own `direct` bypass —
// a direct question should never be silently dropped), and uses the SAME
// deterministic id the real LLM reply would use (`scribe_llm_<id>`) so a
// genuine race between "the real answer actually did land" and "the client
// gave up and degraded" collapses to one post at the server's id-dedupe,
// exactly the mechanism this file's header already documents for tier-0.
const DEGRADED_SUFFIX = ' (running on canned lines right now)';

// B3b remediation (2026-09-10, round 1) — a hard floor BENEATH the mention
// pool itself. `pickLine('mention', …)` returns null only when every line in
// the pool is within its 14-day reuse window — previously that meant
// `scribeMentionDegraded` returned `false` and posted NOTHING, which is
// exactly the "permanent orphan ack" failure mode this remediation round
// exists to close: a direct @scribe question must never go answered with
// total silence. This line deliberately bypasses `pickLine()`'s reuse
// ledger entirely (it isn't drawn from SCRIBE_POOLS.mention and is never
// marked used), so it can post on the coldest possible day without waiting
// out anyone else's cooldown.
const LAST_RESORT_MENTION_LINE = "Can't get to that one right now.";

// BUG-D — how long the mention branch waits for its OWN trigger message to be
// acknowledged by the server before giving up and degrading.
//
// 45s, not the 20s this shipped with in review draft 1. js/chat.js's own
// startFreshChat() comment (~:267) puts Apps Script cold starts at 10-20s,
// and the worst-case SUCCESS path stacks: 750ms coalescing window + a 20s
// cold `chatAppend` + backend.js's misroute retries (400ms + 1200ms, each
// followed by another full round trip) ≈ 26s. A 20s bound therefore expires
// on a perfectly healthy cold-start send — and because the degrade posts
// under the deterministic `scribe_llm_<triggerMessageId>` id, expiring early
// POISONS that trigger: the real answer, arriving seconds later under the
// same id, is deduped away forever. Timing out too early is strictly worse
// than waiting.
//
// Widening costs nothing in the failure cases that matter, because this bound
// only governs a HUNG request: a send that genuinely dies rejects fast via the
// FAILED queue (MAX_ATTEMPTS, ~6s of backoff), and a send that can't go out at
// all (chat off / backend unconfigured) rejects immediately.
export const SCRIBE_APPEND_WAIT_MS = 45000;
let appendWaitMs = SCRIBE_APPEND_WAIT_MS;
/** Test-only (same convention as chat.js's `_resetForTest`) — scribetest.mjs
 *  [26] cannot spend 20 real seconds proving the bound exists. */
export function _setAppendWaitMsForTest(ms) { appendWaitMs = (ms == null ? SCRIBE_APPEND_WAIT_MS : ms); }

/**
 * DI-267 — THE HEAT STAMP FOR A TIER-0 (CANNED) LINE.
 *
 * `heatLeague` is what the commissioner set. `heatEffective` is `SCRIBE_HEAT_DEFAULT`
 * — 'dry' — ALWAYS, and that is a statement of fact rather than a default:
 * these pools are written in one register and are not tagged by level (see the
 * SCRIBE v3 block above SCRIBE_POOLS for why), so a canned line IS a Dry line
 * whatever the dial says.
 *
 * THAT GAP IS THE POINT OF STAMPING IT. A Trainer report correlating feedback
 * against heat must be able to tell "the league was at No Mercy and this line
 * landed flat" from "the league was at Dry and this line landed flat" — and on
 * this path the second is what actually happened, every time, because the model
 * was unreachable, throttled, over budget or switched off. Without both fields
 * every degraded line would read as evidence about a heat level it never ran at.
 */
const tier0HeatMeta = () => ({ heatLeague: getScribeHeat(), heatEffective: SCRIBE_HEAT_DEFAULT });

export function scribeMentionDegraded({ gameTag = '', subject = '', vars = {}, triggerMessageId = null } = {}) {
  const line = pickLine('mention', vars) || LAST_RESORT_MENTION_LINE;
  const id = `scribe_llm_${triggerMessageId || subject || 'x'}`.replace(/[^a-zA-Z0-9_:-]/g, '');
  sendEvent({ type: 'message', gameTag, body: line + DEGRADED_SUFFIX, author: 'scribe', id,
              notify: true, replyTo: triggerMessageId || '',
              meta: { source: 'tier0', trigger: 'mention', scribeVersion: SCRIBE_VERSION,
                      ...tier0HeatMeta(),
                      degraded: true,
                      ...(triggerMessageId ? { triggerMessageId } : {}) } });
  return true;   // B3b — this function ALWAYS posts now; there is no silent-no-op path left
}

/**
 * Orchestrates one `@scribe` mention: gate → call the interactive runtime →
 * degrade on any non-answer outcome. Fire-and-forget from the caller's
 * perspective (`scribeInspectMessage` stays synchronous) — this is the one
 * async edge in an otherwise synchronous module, which is why it's a
 * dedicated function rather than folded into `scribeTrigger` itself.
 */
async function fireScribeMention({ gameTag, author, authorName, triggerMessageId }) {
  const vars = { name: authorName };
  if (!isScribeInteractiveEnabled()) {
    // Client-side convenience gate off. Mirrors the server kill-switch
    // contract (C1): a disabled trigger still answers via the pool today's
    // players are used to, not silence — the client-visible gate is an
    // OFF-ramp for cost, not a UX regression while it's flipped off.
    return scribeMentionDegraded({ gameTag, subject: author, vars, triggerMessageId });
  }
  // BUG-D (2026-09-11) — the ask MUST NOT overtake its own trigger message.
  // `scribeAsk` re-reads the triggering message out of CFBP_MESSAGES by id
  // (deliberately: never trust a client-supplied body, C1), so asking before
  // chat.js's debounced outbox has flushed guarantees 'Trigger message not
  // found' and a canned degrade — which is what every live @scribe mention
  // got. Waiting on the append is deterministic and free; the server's
  // not-found error stays as the backstop behind it.
  try {
    await whenAppended(triggerMessageId, { timeoutMs: appendWaitMs });
  } catch {
    // FAILED outbox item, or the bound elapsed. Either way the question never
    // reached the room, so a canned reply is the honest outcome — and it posts
    // under the SAME deterministic id as always, so the id-dedupe contract
    // documented in this file's header is unchanged.
    return scribeMentionDegraded({ gameTag, subject: author, vars, triggerMessageId });
  }
  try {
    const r = await scribeAskRemote({ triggerMessageId, playerId: author, gameTag });
    // F4/B3a remediation (2026-09-10, round 1) — a real message id is the
    // ONLY thing that counts as "answered," whether it's a fresh reply or a
    // dedup that landed after the fact. Everything else degrades, including:
    //   - r.disabled (F4)         — the SERVER kill switch off used to mean
    //     total silence ("matches today's behavior" was wrong: today's
    //     ACTUAL pre-Build-2 behavior was the canned pool always posting on
    //     @scribe — shipping with the Script Property off by default made
    //     the default deploy a silent regression).
    //   - deduped:true with NO responseMessageId (B3a) — either a
    //     still-in-flight answer or a reclaimed-and-still-failing one; the
    //     degrade fallback is SAFE to fire here even if the real answer is
    //     genuinely still coming, because both paths post under the exact
    //     same deterministic id (scribe_llm_<triggerMessageId>) — the
    //     server's own id-dedupe collapses a late real answer and an early
    //     degrade to a single row, never two posts.
    //   - throttled / budget-capped / outage / anything else ok:true-but-
    //     no-answer.
    if (r && r.ok && r.responseMessageId) return true;
    return scribeMentionDegraded({ gameTag, subject: author, vars, triggerMessageId });
  } catch {
    // Network/outage failure reaching scribeAsk at all → same degrade path
    // (C1: throttle, budget-cap and outage share ONE visible fallback).
    return scribeMentionDegraded({ gameTag, subject: author, vars, triggerMessageId });
  }
}

/**
 * Fire a SCRIBE trigger. Silently drops when rate-limited or the pool is spent.
 * `trigger`: key of SCRIBE_POOLS. `subject`: stable string identifying the event
 * (playerId, gameId…) — part of the deterministic id so six clients dedupe.
 */
export function scribeTrigger(trigger, { gameTag = '', subject = '', vars = {}, bucketMin = 10, notify = false, quote = null, triggerMessageId = null } = {}) {
  if (!SCRIBE_POOLS[trigger]) return false;
  // Build 3, D1 — EVERY detector feeds the opportunity score here, at the one
  // choke point they all already pass through, so no detector call site
  // changes (chat-ui.js is untouched by this build). `considerAutonomous` is
  // free and synchronous; it returns false for all but a genuinely
  // high-value candidate, and on this deployment it returns false outright
  // until the transport is wired. When it DOES fire it reserves the SCRIBE
  // cooldown, so the `rateLimited()` check three lines below drops this
  // tier-0 line by the existing, unmodified mechanism — one event, one SCRIBE
  // message, the better line. See considerAutonomous's own note.
  considerAutonomous(trigger, { subject, gameTag });
  // Direct-mention replies bypass the rate limit (spec); everything else is
  // rationed — the restraint IS the character.
  const direct = trigger === 'mention';
  if (!direct && rateLimited(gameTag)) return false;   // dropped, not queued
  const line = pickLine(trigger, vars);
  if (!line) return false;
  const id = `scribe_${trigger}_${subject || 'x'}_${bucket(Date.now(), bucketMin)}`
    .replace(/[^a-zA-Z0-9_:-]/g, '');
  // UN-160 (E2) — "response id = the chat event id" is already true by
  // construction (this `id` IS the chat event's id, Drew's own ruling); the
  // two fields E2 adds are both on `meta`. `scribeVersion` rides EVERY SCRIBE
  // post uniformly (all six event-driven triggers below, plus every
  // message-driven one). `triggerMessageId` — the id of the HUMAN message
  // that caused this response — is only ever supplied by
  // scribeInspectMessage() (message-driven triggers: mention/drinkDebt/
  // verbosity/lastPlaceTaunt); event-driven triggers (callout, extraPoint*,
  // coverageFlip, upsetWatch, anniversary) correctly omit it — `callout`
  // already carries the equivalent pointer via `meta.quote.id`, and the rest
  // have no single triggering human message at all.
  // `meta.activeLearningSnapshot` is RESERVED for E3/E4 (later) — deliberately
  // left unset here, not fielded with a placeholder value.
  sendEvent({ type: 'message', gameTag, body: line, author: 'scribe', id,
              notify: direct || notify,
              meta: { source: 'tier0', trigger, scribeVersion: SCRIBE_VERSION,
                       ...tier0HeatMeta(),
                       ...(quote ? { quote } : {}),
                       ...(triggerMessageId ? { triggerMessageId } : {}) } });
  if (!direct) noteRate(gameTag);
  return true;
}

// ── Message-driven trigger detection ─────────────────────────────────────────
// Called by chat-ui after a HUMAN message is sent. Keeps detection cheap and
// entirely deterministic.

const recentByAuthor = new Map();  // author -> [timestamps]

export function scribeInspectMessage({ author, authorName, body, gameTag = '', standings = null, triggerMessageId = null }) {
  const low = (body || '').toLowerCase();

  // 1. Direct @scribe mention with a question — Build 2, Group C: this used
  // to post a canned line synchronously and unconditionally. It now hands
  // off to the interactive (LLM-backed) runtime, fire-and-forget (this
  // function's own synchronous contract is unchanged — callers never awaited
  // its return value for anything consequential). `fireScribeMention` itself
  // decides between a real answer and the degraded canned-pool fallback.
  if (low.includes('@scribe')) {
    // Returns the PROMISE (not a bare `true`) so a caller that wants to
    // await the eventual post — a test, mainly — can; every REAL call site
    // today (chat-ui.js) ignores the return value entirely, so this is
    // fire-and-forget in production exactly as before, just now awaitable.
    return fireScribeMention({ gameTag, author, authorName, triggerMessageId });
  }
  // 1b. Build 3, D-2 (correction #6) — CHAT REACTIVITY. A non-@scribe human
  // message buys one capped `claude-haiku-4-5` classify call, whose verdict
  // feeds the same opportunity score every other signal goes through.
  // `considerClaim` is a no-op unless autonomy is ready on this device.
  // Fire-and-forget — this function's synchronous contract is unchanged.
  //
  // ── SCRIBE v3 PACKAGE D (DI-283, 2026-09-24) — THE TRIGGER IS WIDENED FROM
  //    `chatClaimPrefilter(body)` TO EVERY HUMAN MESSAGE, DELIBERATELY. ──────
  // The prefilter is a bold-claim keyword pass, and it is exactly right for
  // the question it was written for: "is this worth asking the classifier
  // about as a CLAIM?" It is the wrong question for the two things the same
  // call now also answers — `reactionEmoji` (most reactable messages are not
  // claims; "my dog died" and "I'm at the airport" carry no claim keyword and
  // are precisely where a human would react) and `roastOfScribe` (a roast of
  // SCRIBE almost never contains 'guarantee' or 'lock of the week').
  //
  // `chatClaimPrefilter` IS NOT DELETED and is still exported: it remains the
  // honest description of the CLAIM half, it is asserted by `scoringtest.mjs`,
  // and a future pass that wants to narrow this trigger again has the function
  // it would narrow to. What changed is which question decides whether the one
  // call happens.
  //
  // WHAT BOUNDS THE COST, since a keyword gate no longer does:
  //   - `classifyInFlight` — at most ONE in-flight classify per device, so a
  //     burst of typing cannot fan out into a burst of paid calls;
  //   - the SERVER's `settings.scribe.classifyDailyCap` — sized for
  //     claim-shaped volume at 40/day and raised to 150/day for this change
  //     (DI-283 §6 open question 5, Drew's number);
  //   - the 30-minute off-latch, which already gates the CALL and not just the
  //     post, so a league with the server switch off pays one wasted request
  //     per half hour rather than one per message.
  considerClaim({ triggerMessageId, gameTag, author });
  // 1c. SCRIBE v3 Package D (DI-287) — the heated-exchange detector, fired from
  // the SAME choke point every other message-driven trigger already uses, so no
  // call site in js/chat-ui.js changes. Free, local, synchronous and wrapped:
  // a fold read that throws must never take out the drink-debt and verbosity
  // triggers below it.
  //
  // THE HONEST RACE, NAMED: this reads the device's own OPTIMISTIC fold while
  // the server verifies against rows the outbox may not have flushed yet
  // (FLUSH_COALESCE_MS = 750ms). When they disagree the server answers
  // `unverified` — no reservation, no model call, no spend, no post — and the
  // next message in the same exchange tries again. The race costs a missed joke
  // and never a fabricated one, which is the only direction that is allowed to
  // be wrong here.
  try {
    considerHeatedExchange(getMessages({ tag: gameTag || '' }), { gameTag });
  } catch { /* a fold read is not worth a thrown inspect */ }
  // 2. Drink debt vocabulary
  if (/\bdrink|owes?\b|\bbalance|\bbeer|\bsapporo\b/.test(low)) {
    return scribeTrigger('drinkDebt', { gameTag, subject: 'debt', triggerMessageId });
  }
  // 3. Verbosity: >5 messages from one author in 2 minutes
  const now = Date.now();
  const arr = (recentByAuthor.get(author) || []).filter(t => now - t < 120000);
  arr.push(now); recentByAuthor.set(author, arr);
  if (arr.length > 5) {
    recentByAuthor.set(author, []);   // reset so it doesn't refire per message
    return scribeTrigger('verbosity', { gameTag, subject: author, vars: { name: authorName, n: arr.length }, triggerMessageId });
  }
  // 4. Last place taunting first place (needs standings context)
  if (standings && standings.lastPlaceId === author && standings.firstPlaceName &&
      low.includes(standings.firstPlaceName.toLowerCase())) {
    return scribeTrigger('lastPlaceTaunt', { gameTag, subject: author, vars: { name: authorName }, triggerMessageId });
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// ── Build 3, Group D (2026-09-11) — DI-D1: opportunity scoring + the
//    frequency dial. THE CHEAP HALF OF THE GATE.
// ═══════════════════════════════════════════════════════════════════════════
//
// Everything below is deterministic, free, and runs on the device. No model
// call, no network, no storage write. Its ONLY job is to answer "is this
// worth speaking about?" — the expensive "what should I say?" step lives
// entirely server-side (backend/Code.gs's `scribeAutonomous`), is reached
// only by a candidate that already cleared the threshold here, and re-checks
// this verdict against the league's own settings before it spends a cent.
//
// Tier 0 is untouched. The pools, the ledger, `pickLine()`, `scribeTrigger`'s
// body — all byte-identical to Build 2. D1 is a SECOND, PARALLEL evaluation
// layered on top (DI-D1: "additive").

/** The dial, re-exported from data-model.js (N-3: js/scribeAgent.js needs it
 *  too and cannot import this module — scribeLines imports scribeAgent, so
 *  that direction would be a cycle). One numeric threshold on a 0-100 scale;
 *  a candidate speaks when its score is >= the threshold (exact-threshold
 *  FIRES — DI-D1's own wording, and scoringtest.mjs asserts both sides).
 *
 *  MUST agree with SCRIBE_FREQUENCY_THRESHOLDS_ in backend/Code.gs. There is
 *  no import across THAT boundary (separate runtime), so scoringtest.mjs
 *  parses both sources and asserts the tables match — a one-sided edit fails
 *  a test instead of silently splitting client and server onto two different
 *  definitions of "Balanced." */
export const FREQUENCY_LEVELS = SCRIBE_FREQUENCY_LEVELS;
export const FREQUENCY_DEFAULT = SCRIBE_FREQUENCY_DEFAULT;

/** Drew's D-1 ruling: expose all five. Copy is FINAL, from
 *  `SCRIBE_COPY_GROUP_D_091126.md` §5 — product voice, one line per level.
 *  Exported here (rather than inlined in app.js) so pass 2's Comm -> Settings
 *  dial imports the approved strings instead of retyping them. Order is the
 *  order the dial renders: loudest-to-quietest is wrong for a control whose
 *  default sits in the middle, so it reads quiet -> unhinged. */
export const FREQUENCY_COPY = [
  { level: 'quiet',     label: 'Quiet',     description: 'Speaks only for the truly exceptional moments.' },
  { level: 'reserved',  label: 'Reserved',  description: 'Chimes in when something genuinely earns it.' },
  { level: 'balanced',  label: 'Balanced',  description: 'The default. Present, but never the main character.' },
  { level: 'active',    label: 'Active',    description: 'Talks like a real seventh member of the group chat.' },
  { level: 'unhinged',  label: 'Unhinged',  description: 'Maximum SCRIBE. You asked for this.' },
];

/** SCRIBE v3, Package A (2026-09-23, DI-263) — the HEAT dial's copy, the exact
 *  sibling of FREQUENCY_COPY above and exported for the same reason: the
 *  Comm → Settings card imports the approved strings instead of retyping them.
 *
 *  ORDER IS COOLEST-FIRST, matching `SCRIBE_HEAT_ORDER` in js/data-model.js —
 *  a dial whose two ends are "barely speaks" and "maximum" has to read in one
 *  direction, and heattest.mjs asserts these two orders agree so a level cannot
 *  be added to one and forgotten in the other.
 *
 *  ONE LINE PER LEVEL, product voice, describing what the player will NOTICE
 *  rather than restating the seven-field brief in docs/SCRIBE.md §4. The brief
 *  is the contract the model reads; this is the sentence a commissioner reads
 *  while deciding. Dry names itself as today's voice, because a commissioner
 *  moving off the default deserves to know what he is moving off. */
export const HEAT_COPY = [
  { level: 'polite',   label: 'Polite',    description: 'Notes the evidence and stops. No edge at all.' },
  { level: 'dry',      label: 'Dry',       description: "Today's voice. Deadpan, one clean observation, out." },
  { level: 'spicy',    label: 'Spicy',     description: 'Sharper, a little louder, mild language.' },
  { level: 'savage',   label: 'Savage',    description: 'Real profanity, picks one target and commits.' },
  { level: 'no_mercy', label: 'No Mercy',  description: 'The ceiling. Takes a side and dares you to reply.' },
];

/** SCRIBE v3, Package B (DI-268/DI-269) — the reason chips' PLAYER-FACING
 *  labels, and the two cluster headings above them.
 *
 *  PRODUCT VOICE, NOT SCRIBE'S. These are buttons in a popover; the app is
 *  talking, and SCRIBE.md's register deliberately does not govern the app's own
 *  copy (the same line MEMORY_COPY below draws). Every label is two words or
 *  fewer wherever it can be, because this row wraps inside a ~306px popover on
 *  a phone and a chip that wraps to three lines stops reading as a chip.
 *
 *  KEYED BY THE CHIP ID, and `reasonchiptest.mjs` asserts the table covers
 *  `SCRIBE_FEEDBACK_REASON_CHIPS` exactly — a chip added to the closed set with
 *  no label here would render as a blank button, which is the one failure a
 *  closed set is supposed to make impossible.
 *
 *  THE HEADINGS DELIBERATELY DO NOT REPEAT A CHIP'S OWN WORDS ("Annoying" is a
 *  chip; the cluster above it is "Too much SCRIBE"), so a player reading the
 *  row top to bottom never sees the same phrase twice at two different
 *  meanings. */
export const REASON_CHIP_COPY = {
  annoying: 'Annoying',
  too_often: 'Too often',
  tried_too_hard: 'Tried too hard',
  too_long: 'Too long',
  too_mean: 'Too mean',
  crossed_a_line: 'Crossed a line',
  not_funny: 'Not funny',
  wrong_target: 'Wrong target',
  wrong_facts: 'Wrong facts',
  too_soft: 'Too soft',
  perfect_more_of_this: 'More of this',
};

/** The labels AROUND the chips: the one-line prompt, the two family headings,
 *  the shared-tag heading, and the free-text field's placeholder (DI-269).
 *  Exported beside the chip labels so the whole popover's copy lives in one
 *  place and app.js/chat-ui.js never retype an approved string. */
export const REASON_CHIP_SECTION_COPY = {
  missPrompt: 'What kind of miss?',
  hitPrompt: 'What worked?',
  annoyingGroup: 'Too much SCRIBE',
  meanGroup: 'Too harsh',
  sharedGroup: 'Or the line itself',
  notePlaceholder: 'Say why (optional)',
  // Screen-reader label for the free-text field. Deliberately makes NO privacy
  // promise: feedback rides the same append-only chat log every event does, and
  // the "only you see your own rating" property is a UI-level scoping rule
  // (chat-ui.js's myFeedbackState), not a storage boundary. Copy that implied
  // otherwise would be a promise the data model does not keep.
  noteLabel: 'Why this rating — optional',
};

/** DI-D4 copy, final, same source document (§1, §2, §4). Exported for pass
 *  2's "My SCRIBE File" modal so the approved strings live in exactly one
 *  place. Product voice, not SCRIBE's — these are the app talking ABOUT
 *  SCRIBE, which SCRIBE.md's register deliberately does not govern. */
export const MEMORY_COPY = {
  sectionBody: 'What SCRIBE has recorded about you, in plain language. Delete anything you told it — no explanation needed. Facts it works out from the standings refresh on their own.',   // amended 2026-09-11 (coordinator, pass 2 review F3): computed rows are read-only, so the promise is scoped to what the player told SCRIBE
  emptyState: 'Nothing recorded yet — that builds as SCRIBE gets to know you.',
  unconfirmedTag: "SCRIBE thinks this but isn't sure — delete it if it's wrong.",
  // FEAT-5 / DI-202k (UN-202, 2026-09-12) — the one sentence the wager feature
  // adds to this surface, verbatim from the design input. A NEW KEY rather than
  // an edit to `sectionBody`: that string is approved copy amended once already
  // (2026-09-11) and rewriting it to carry a second subject would put two
  // different approvals in one string. Rendered as its own line directly under
  // the Section 1 body, where the wager rows themselves appear.
  wagerFootnote: "Wagers you've logged live here too. Delete one and SCRIBE forgets it.",
};

/** DI-D1's scoring table, verbatim. These are CALIBRATION TARGETS, not
 *  constants of nature: E3's Trainer replays `scoreOpportunity` against every
 *  👁 weigh-in-flagged message and proposes threshold changes as experiments,
 *  which stay pending until a human approves them (DI-D1's calibration loop).
 *
 *  `claim` is deliberately 0. Text-based signals score ONLY via the
 *  `claude-haiku-4-5` classifier's own returned points (correction #6) — a
 *  keyword prefilter match is a reason to ASK, never a reason to speak. */
export const SIGNAL_POINTS = {
  backdoorBust: 50,
  // SCRIBE v3 Package D (DI-284) — the comeback. 50, which clears `balanced`
  // on its own; see js/scribe-scoring.js's copy of this table for the whole of
  // the reasoning. `interacttest.mjs` asserts the two tables are identical, so
  // an edit to one side without the other goes red rather than quietly
  // splitting the client's detector from the server's scorer.
  roastOfScribe: 50,
  chartLeadChange: 45,
  milestone: 40,
  streak: 35,
  loneWolfWin: 30,
  unanimous: 25,
  // SCRIBE v3 Package D (DI-287) — two players going back and forth.
  heatedExchange: 20,
  drinkDebt: 15,
  verbosity: 10,
  claim: 0,
};

// ── FINDING 1 (reviewer, round 3; DI-D1 amendment #3) — THE COMBINER ───────
//
// The score used to be a flat sum of every entry handed in. Two defects in
// one line:
//   CARDINALITY. A realistic 10-game finalize emits one `unanimous`, one
//   `loneWolfWin` and three `streak` signals; summed, 160 — clearing Quiet
//   (85) twice over. Twenty `verbosity` entries summed to 200 and posted on
//   the quietest setting the dial has.
//   DISCRIMINATION. If any busy week clears every level, the dial is not a
//   dial: Quiet and Unhinged behave identically on exactly the weeks a
//   league would notice.
//
// Two changes, mirrored byte-for-byte in backend/Code.gs's
// `scribeCollapseSignals_`/`scribeCombineSignalPoints_` (scoringtest runs
// BOTH implementations over the same fixtures and asserts they agree):
//   1. COLLAPSE BY NAME — each distinct signal counts at most once, whatever
//      its instance count. Three streaks are "a streak week," not three
//      times as interesting. Capped at 8 distinct names.
//   2. DIMINISHING RETURNS — `top + 0.5 x (second + third)` over the three
//      highest DISTINCT signals; everything past the third contributes
//      nothing. A week is interesting because of its best moment and some
//      corroboration, not because a lot of small things happened.
//
// The gradient this produces (asserted in scoringtest, and the reason these
// numbers are not arbitrary):
//   ordinary week      35 + 30 + 25 -> 62.5   Balanced/Active/Unhinged only
//   lead-change week   45 + 35 + 30 -> 77.5   Reserved yes, Quiet no
//   big week           50 + 45 + 35 -> 90     even Quiet
//   lone contradiction 50           -> 50     Balanced
//   guarantee + noise  45 + 10      -> 50
//
// SIGNAL_POINTS and the threshold table are UNCHANGED: the defect was the
// combiner, and re-tuning points on top of a new combiner would make the
// calibration loop's replays incomparable across the change.
const MAX_DISTINCT_SIGNALS = 8;

/** One entry per signal NAME (the highest points wins between instances),
 *  sorted by points descending with the name as a stable tiebreak, capped at
 *  8. Pure. */
function collapseSignals(list) {
  const byName = new Map();
  for (const raw of list) {
    const s = (typeof raw === 'string') ? { signal: raw } : (raw || {});
    const name = String(s.signal || '');
    if (!name) continue;
    // F-A — the RG-07 null trap, and the server's guard is the correct one.
    // `Number(null)` is 0 and `Number.isFinite(0)` is true, so a
    // `points:null` entry used to read as an EXPLICIT zero and suppress the
    // table value — the two runtimes then scored the same signal list
    // differently (Code.gs checks `!== null` first and falls through to the
    // table). `points` is "a number the caller supplied"; null and undefined
    // are both "the caller supplied nothing."
    const explicit = Number(s.points);
    const hasExplicit = s.points !== undefined && s.points !== null && Number.isFinite(explicit);
    const pts = hasExplicit ? explicit
      : (Object.prototype.hasOwnProperty.call(SIGNAL_POINTS, name) ? SIGNAL_POINTS[name] : 0);
    const prev = byName.get(name);
    if (prev === undefined || pts > prev) byName.set(name, pts);
  }
  return [...byName.entries()]
    .map(([signal, points]) => ({ signal, points }))
    .sort((a, b) => (b.points - a.points) || String(a.signal).localeCompare(String(b.signal)))
    .slice(0, MAX_DISTINCT_SIGNALS);
}

/** `top + 0.5 x (second + third)` over an already-collapsed, descending
 *  list. Fractional scores are expected and fine — thresholds are integers
 *  and the comparison is `>=`. */
function combineSignalPoints(collapsed) {
  const a = collapsed[0] ? Number(collapsed[0].points) || 0 : 0;
  const b = collapsed[1] ? Number(collapsed[1].points) || 0 : 0;
  const c = collapsed[2] ? Number(collapsed[2].points) || 0 : 0;
  return a + 0.5 * (b + c);
}

/**
 * PURE. Same input, same output, every time — no clock, no storage, no
 * network. E3's Trainer replays this exact algorithm server-side against
 * flagged messages, so it must be safe to call with a fixture and nothing
 * else (DI-D1: "expose the pure scoring function for E3 to call").
 *
 * @param signals  array of `{ signal, points?, ts? }` (a bare string is
 *                 accepted as `{signal}`). An explicit finite `points`
 *                 overrides the table — that is how the classifier's verdict
 *                 enters the score.
 * @param level    a FREQUENCY_LEVELS key; anything unrecognized reads as
 *                 Balanced (never as 0 — a malformed value must make SCRIBE
 *                 quieter-or-equal, never open the gate).
 * @param now      optional. When supplied, only signals in the SAME 10-minute
 *                 bucket as `now` are considered (DI-D1's bucket rule, as
 *                 amended: same bucket means they COMBINE, not that they add). A
 *                 signal with no `ts` belongs to `now`'s bucket.
 * @returns { score, threshold, clears, level, counted } — `counted` is the
 *          COLLAPSED list, one entry per name, which is exactly what the
 *          prompt's "contributing signals" line is built from.
 */
export function scoreOpportunity(signals, { level = FREQUENCY_DEFAULT, now = null } = {}) {
  const lvl = String(level || '').toLowerCase();
  const threshold = Object.prototype.hasOwnProperty.call(FREQUENCY_LEVELS, lvl)
    ? FREQUENCY_LEVELS[lvl] : FREQUENCY_LEVELS[FREQUENCY_DEFAULT];
  const list = Array.isArray(signals) ? signals : (signals ? [signals] : []);
  const wantBucket = now == null ? null : bucket(now);
  const inBucket = list.filter(raw => {
    const s = (typeof raw === 'string') ? { signal: raw } : (raw || {});
    return !(wantBucket !== null && s.ts != null && bucket(s.ts) !== wantBucket);
  });
  const counted = collapseSignals(inBucket);
  const score = combineSignalPoints(counted);
  return { score, threshold, clears: score >= threshold, level: lvl || FREQUENCY_DEFAULT, counted };
}

/**
 * Stage one of the chat-reactive gate (correction #6) — FREE, local, and
 * deliberately loose. A match only buys the message a ~$0.001 classifier
 * call; a miss costs nothing and is the overwhelmingly common case, so
 * ordinary chat still costs exactly zero. Being slightly over-inclusive here
 * is the cheap error; being under-inclusive means the thesis case ("Koby says
 * something confident -> one sentence back") never fires at all.
 */
// Note 11 (reviewer) — WORD BOUNDARIES. A bare substring match on 'lock'
// fires on "picks lock at noon," "locked in," "unlock" — the most ordinary
// sentences in this chat, every one of them buying a paid classifier call.
// Each entry is matched as a whole word (or whole phrase), so "lock" hits
// and "locked"/"unlock"/"clock" do not. Being slightly over-inclusive is
// still the cheap error here; being over-inclusive on the single most common
// word in a pick'em chat is not.
const CLAIM_KEYWORDS = [
  // 'locks' is deliberately ABSENT while 'lock' is present: "it's a lock" is
  // the claim idiom, but "the week locks at noon" is scheduling, and that
  // sentence appears in this chat every single week.
  'guarantee', 'guaranteed', 'lock of the week', 'lock', 'no way', 'book it',
  "can't lose", 'cant lose', 'easy money', 'free money', 'mortal lock',
  'calling it now', 'trust me', 'i promise',
];
const CLAIM_KEYWORD_RES = CLAIM_KEYWORDS.map(kw =>
  new RegExp('(^|[^a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i'));
export function chatClaimPrefilter(body) {
  const low = String(body || '').toLowerCase();
  if (!low.trim()) return false;
  if (/(^|[^a-z0-9])100\s*%/.test(low)) return true;      // "100%"
  if (/(^|[^a-z0-9])\d{2,3}\s*%/.test(low)) return true;  // any number + % — a confident figure
  for (const re of CLAIM_KEYWORD_RES) { if (re.test(low)) return true; }
  return false;
}

// ── The autonomous candidate gate ──────────────────────────────────────────
//
// Module state, device-local and intentionally NOT persisted: a bucket of
// signals (so concurrent detectors in the same 10 minutes COMBINE — see
// scoreOpportunity for what "combine" means since amendment #3), the set of
// bucket ids this device has already fired (so a second detector in the same
// bucket cannot double-fire), and an "autonomy is off server-side" latch.
const signalBuckets = new Map();     // `${gameTag}|${bucket}` -> [{signal, points, ts}]
const firedBuckets = new Set();      // deterministic post ids already attempted
let autonomyOffUntil = 0;            // ms timestamp; see the latch note below
const AUTONOMY_OFF_LATCH_MS = 30 * 60 * 1000;
// BLOCK-2 — the league-wide autonomous floor. Stored in the SAME device-local
// map as the per-room cooldowns (one key, not a second storage concept) under
// a key no gameTag can collide with: `lastPosts()` keys are '' -> 'main' or a
// gameId, and a gameId cannot contain a colon-prefixed reserved word.
const AUTONOMOUS_ALL_KEY = ':autonomous_all';
const AUTONOMOUS_GLOBAL_COOLDOWN_MS = 10 * 60 * 1000;
// F-G (client half) — the stamp carries a sub-millisecond nonce so "is this
// stamp still MINE?" is answerable. Two candidates can reserve inside the
// same millisecond; with a bare `Date.now()` they are indistinguishable, and
// a rolled-back failure would then clear a cooldown that belongs to the
// other one. The fraction is far below the 10-minute window, so every
// comparison that treats this as a timestamp still behaves identically.
let autonomousStampSeq = 0;

/** Test seam, same convention as chat.js's `_resetForTest`. Note 14
 *  (reviewer) — `classifyInFlight` MUST be reset here too: it is set before
 *  an await and cleared in a `.finally`, so a test that does not await the
 *  round trip leaves it stuck true and every later test in the file silently
 *  skips the classifier, passing for the wrong reason. */
export function _resetAutonomousStateForTest() {
  signalBuckets.clear(); firedBuckets.clear(); autonomyOffUntil = 0; classifyInFlight = false;
}

/**
 * The consecutive-post guard (DI-D1), client side: no two AUTONOMOUS SCRIBE
 * messages back-to-back in the same `gameTag` without an intervening human
 * message. Checked against the already-hydrated fold — no new read, no
 * network. The server re-checks the identical rule against CFBP_MESSAGES
 * (authoritative: this fold can be a poll interval stale, and six devices can
 * each believe they are first).
 *
 * A tier-0 canned line or an @mention reply does NOT block: those are
 * different in kind (free, or directly asked for) and the 10-minute general
 * cooldown already rations them.
 */
function autonomousConsecutiveBlocked(gameTag) {
  let msgs;
  // BLOCK-2 — `null` means EVERY room, which is what the main chat actually
  // renders (`getMessages({tag:'all'})`). A string, including '' for the
  // main room, scopes the check to one thread.
  const tag = (gameTag === null || gameTag === undefined) ? 'all' : (gameTag || '');
  try { msgs = getMessages({ tag }); } catch { return false; }
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i];
    if (m.type !== 'message') continue;
    if (m.author === 'scribe') { if (m.meta && m.meta.autonomous) return true; continue; }
    if (m.author === 'system') continue;
    return false;                      // a human spoke most recently — clear to speak
  }
  return false;
}

/**
 * D1's decision function. Called by `scribeTrigger` for every detector (so
 * every existing trigger feeds it without any call site changing) and
 * directly by signals that have no tier-0 pool at all (`milestone`,
 * `streak`, and the classifier-backed `claim`).
 *
 * GATE ORDER — cheapest first, and nothing here touches the network until
 * every free check has passed:
 *   1. never for `mention` (that is Group C's path, and it is never silent)
 *   2. autonomy READY on this device (client setting on AND transport wired)
 *      + the off-latch — see the reservation note below for why this must be
 *      checked BEFORE anything is reserved
 *   3. cooldown floor — the existing GENERAL_COOLDOWN (10 min) /
 *      GAME_COOLDOWN (60 min), unchanged, at EVERY frequency level. The dial
 *      moves the score threshold, never the cooldown (SCRIBE.md §14).
 *   4. consecutive-post guard
 *   5. the score, summed over the 10-minute bucket
 *   6. once per (trigger, subject, bucket) per device
 *
 * THE RESERVATION, AND WHY IT IS ROLLED BACK — the one genuinely non-obvious
 * decision in this file, flagged for review:
 *
 * DI-D1 AMENDMENT, inline (proposed AD-50 — coordinator-proposed,
 * reviewer-endorsed 2026-09-11; Drew has not ruled on it yet) —
 * the DI says D1 is "parallel, additive" and "does not touch the Tier-0
 * path." Taken literally that produces TWO SCRIBE messages for one event: a
 * canned line now and an LLM line fifteen seconds later, back to back, which
 * SCRIBE.md §14's rate limit exists to prevent. The amendment: the tier-0
 * CODE is untouched (not one line of `scribeTrigger`'s body changed), but an
 * autonomous candidate that clears reserves the shared cooldown, so tier-0's
 * OWN, pre-existing rate limiter drops the canned line — "dropped, not
 * queued," this file's original behaviour. Additive in mechanism, exclusive
 * in outcome.
 *
 * A single event must produce ONE SCRIBE message, not two. `scribeTrigger`
 * calls this BEFORE it picks a tier-0 line, and a candidate that clears calls
 * `noteRate(gameTag)` — which makes the tier-0 attempt immediately following
 * it hit the EXISTING, UNMODIFIED rate limiter and drop, exactly as a
 * rate-limited trigger has always dropped ("dropped, not queued", this file's
 * header). So the better line wins and tier-0's code is untouched.
 *
 * The hazard that creates: if the autonomous post then never happens (the
 * server property is off, the budget is spent, Anthropic is down), the event
 * produced NO post at all, and worse, a 10-minute cooldown that silences the
 * free lines too. Three things bound it:
 *   - gate 2 — a device that cannot post autonomously at all never reserves,
 *     so the transport being unwired (its state for all of pass 1) has
 *     precisely zero effect on tier-0;
 *   - the rollback — any non-post outcome restores the previous cooldown
 *     timestamp (only if nothing else has written it since);
 *   - the latch — a server that says "autonomy is disabled" stops this device
 *     from reserving for 30 minutes, so a deployment with the Script Property
 *     off cannot cost more than one canned line per half hour.
 *
 * Returns synchronously (`scribeTrigger` and `scribeInspectMessage` are
 * synchronous and stay that way): `{ fired, id?, score, threshold, promise? }`.
 * `promise` resolves once the server has answered — tests await it; nothing
 * in the app does.
 */
export function considerAutonomous(trigger, { subject = '', gameTag = '', weekId = '', playerId = '', signals = null, triggerMessageId = '', now = Date.now() } = {}) {
  if (!trigger || trigger === 'mention') return { fired: false, reason: 'not_a_candidate', score: 0, threshold: 0 };
  if (!isScribeAutonomousReady()) return { fired: false, reason: 'not_ready', score: 0, threshold: 0 };
  if (now < autonomyOffUntil) return { fired: false, reason: 'server_off_latch', score: 0, threshold: 0 };

  // BLOCK-2 (reviewer, round 2) — THE LEAGUE-WIDE FLOOR, checked before the
  // per-room one. Every bound in this file used to be partitioned by
  // gameTag, which reads as correct and is not: the main chat renders
  // `getMessages({tag:'all'})`, so three game threads finalizing at once
  // produced three autonomous posts in one reader's stream, each of them
  // individually inside its own room's 10-minute floor. SCRIBE.md §14's
  // rate limit is about the reader, not the room. The server enforces the
  // same bound authoritatively (six devices each think they are first); this
  // copy exists so a device refuses before paying a round trip.
  const globalLast = lastPosts()[AUTONOMOUS_ALL_KEY] || 0;
  const globalBlocked = (now - globalLast) < AUTONOMOUS_GLOBAL_COOLDOWN_MS;

  const bucketKey = `${gameTag || ''}|${bucket(now)}`;
  const list = signalBuckets.get(bucketKey) || [];
  const incoming = Array.isArray(signals) && signals.length
    ? signals.map(s => (typeof s === 'string' ? { signal: s, ts: now } : { ts: now, ...s }))
    : [{ signal: trigger, ts: now }];
  for (const s of incoming) list.push(s);
  signalBuckets.set(bucketKey, list);
  // Bounded: one entry per bucket key, and a bucket key is 10 minutes wide.
  // Drop anything older than two buckets so a long session cannot grow this
  // map without limit (RG-55's lesson applied to module state).
  for (const k of signalBuckets.keys()) {
    const b = Number(k.split('|')[1]);
    if (Number.isFinite(b) && b < bucket(now) - 1) signalBuckets.delete(k);
  }

  const level = getScribeFrequency();
  const scored = scoreOpportunity(list, { level, now });

  // Cooldown and the consecutive-post guard are checked AFTER the score is
  // computed but BEFORE anything is reserved, so a blocked candidate still
  // reports its real score — that is what E3's calibration loop reads.
  if (globalBlocked) return { fired: false, reason: 'global_cooldown', ...scored };
  if (rateLimited(gameTag)) return { fired: false, reason: 'cooldown', ...scored };
  if (autonomousConsecutiveBlocked(gameTag)) return { fired: false, reason: 'consecutive', ...scored };
  if (autonomousConsecutiveBlocked(null)) return { fired: false, reason: 'consecutive_all', ...scored };
  if (!scored.clears) return { fired: false, reason: 'below_threshold', ...scored };

  const id = `scribe_auto_${trigger}_${subject || 'x'}_${bucket(now)}`.replace(/[^a-zA-Z0-9_:-]/g, '');
  if (firedBuckets.has(id)) return { fired: false, reason: 'already_fired', ...scored };
  firedBuckets.add(id);

  // Reserve the cooldown (see the long note above), remembering the exact
  // prior value so the rollback can tell "nothing else wrote this" from
  // "someone else did."
  const roomKey = gameTag || 'main';
  const before = lastPosts()[roomKey] || 0;
  noteRate(gameTag);
  // BLOCK-2 — the league-wide stamp is reserved in the same breath as the
  // room one, and rolled back the same way.
  const globalStamp = now + (autonomousStampSeq++ % 997) / 1000;
  const lpReserve = lastPosts();
  lpReserve[AUTONOMOUS_ALL_KEY] = globalStamp;
  saveLastPosts(lpReserve);
  const reservedAt = lastPosts()[roomKey];
  const rollback = () => {
    const lp = lastPosts();
    if (lp[roomKey] === reservedAt) { lp[roomKey] = before; }
    if (lp[AUTONOMOUS_ALL_KEY] === globalStamp) { lp[AUTONOMOUS_ALL_KEY] = globalLast; }
    saveLastPosts(lp);
  };

  const promise = scribeAutonomousRemote({
    trigger, subject, playerId,
    evidence: { signal: trigger, points: scored.counted, score: scored.score, gameTag, weekId,
                ...(triggerMessageId ? { triggerMessageId } : {}) },
  }).then(r => {
    if (r && r.posted === true) return r;
    // F4 (reviewer, Build 3 pass 1) — A DEDUPE IS A POST. `deduped:true`
    // means ANOTHER DEVICE'S call already produced the autonomous message
    // (the deterministic id collapsed six clients to one). Rolling back on
    // it — which is what this did — released the cooldown on five of six
    // devices, and the very next detector on any of them could fire a tier-0
    // canned line seconds after the autonomous post: back-to-back SCRIBE
    // messages, which SCRIBE.md §14 forbids at every frequency level. The
    // reservation is KEPT here precisely because a message did land in the
    // room; this device simply was not the one that sent it.
    if (r && r.deduped === true) return r;
    const skipped = r && r.skipped;
    const reason = r && r.reason;
    // The 30-minute latch is for states that will still be true in a minute:
    // the Script Property is off, no API key is configured, or the month's
    // budget is gone. Re-asking on every detector for the rest of the season
    // would burn a canned line each time (see the rollback note above).
    // A THROTTLE is deliberately NOT latched — it clears on the hour, and
    // latching it would silence autonomy for 30 minutes over a 4-per-hour
    // cap that had simply filled up.
    if (skipped === 'disabled_autonomous' || skipped === 'disabled_interactive' || skipped === 'disabled_client' ||
        reason === 'not_configured' || reason === 'budget') {
      autonomyOffUntil = Date.now() + AUTONOMY_OFF_LATCH_MS;
    }
    rollback();
    return r;
  }).catch(err => { rollback(); return { ok: false, error: String(err && err.message ? err.message : err) }; });

  return { fired: true, id, ...scored, promise };
}

/**
 * The chat-reactive path (correction #6). Called by `scribeInspectMessage`
 * for every non-@scribe human message that clears the free prefilter.
 * Fire-and-forget and bounded: at most ONE in-flight classify call per
 * device at a time, so a burst of confident typing cannot fan out into a
 * burst of paid calls (the server's own daily cap is the hard bound; this is
 * the polite one).
 */
let classifyInFlight = false;
function considerClaim({ triggerMessageId, gameTag, author }) {
  if (!triggerMessageId || classifyInFlight) return null;
  if (!isScribeAutonomousReady()) return null;
  if (Date.now() < autonomyOffUntil) return null;   // Note 11 — the latch gates the CALL, not just the post
  classifyInFlight = true;
  return scribeClassifyRemote({ messageId: triggerMessageId })
    .then(r => {
      // Note 11 (reviewer) — the classifier has its OWN way of learning that
      // the server is off, and without this it never used it: every message
      // clearing the prefilter paid a full round trip to be told "disabled"
      // again. The same 30-minute latch `considerAutonomous` uses is set
      // here, so a deployment with SCRIBE_AUTONOMOUS_ENABLED unset costs one
      // wasted request per half hour instead of one per confident sentence.
      const skipped = r && r.skipped;
      if (skipped === 'disabled_autonomous' || skipped === 'disabled_interactive' ||
          skipped === 'disabled_client' || skipped === 'not_configured') {
        autonomyOffUntil = Date.now() + AUTONOMY_OFF_LATCH_MS;
      }
      // ── SCRIBE v3 PACKAGE D (DI-283) — THE REACTION, FIRED FIRST AND
      //    INDEPENDENTLY OF THE SCORE.
      //
      // A reaction is NOT an autonomous post and must not be gated like one: it
      // does not go through `considerAutonomous`, it does not reserve the
      // shared cooldown, and it does not care whether the verdict scored any
      // points. Its own two caps (`react:hourly`, `react:author:<id>:hourly`)
      // live server-side, and `js/chat.js`'s consecutive-post guard is
      // structurally blind to a `react` row anyway (`if (ev.type !== 'message')
      // continue;`), so an emoji can neither trip nor consume a message floor.
      //
      // FIRE-AND-FORGET, AND SILENT ON EVERY FAILURE. The server decides
      // whether there is an emoji to place (it re-reads its own cached verdict
      // — this client never sees one and never sends one), so the honest client
      // contract is "tell the server a message was classified" and nothing
      // more. A refusal, a cap, a missing verdict and an outage are all the
      // same outcome here: no emoji appears, which is the common and correct
      // case by design (UN-266/DI-283's relevance bar).
      //
      // GATED ON THE CLASSIFY CALL HAVING PRODUCED A VERDICT AT ALL — a
      // `skipped` classify (disabled, throttled, over budget, not configured)
      // has written no verdict, so asking for a reaction would spend a react
      // ticket to be told the same thing.
      const classified = !!(r && r.ok && !r.skipped);
      if (classified) { scribeReactRemote({ messageId: triggerMessageId }).catch(() => {}); }

      // ── SCRIBE v3 PACKAGE D (DI-284) — THE COMEBACK.
      //
      // `roastOfScribe` rides the SAME verdict (no second model call). It is a
      // TRIGGER, not a points override: `roastOfScribe` is worth 50 in
      // SIGNAL_POINTS on both sides, the server re-reads its own cached verdict
      // to confirm the boolean, and the post then goes through the identical
      // gate order every other autonomous post obeys — the per-post ticket, the
      // 10-minute global cooldown, the hourly cap, the consecutive guard.
      // Consequence, stated rather than hidden: a roast thirty seconds after an
      // unrelated SCRIBE post gets silence, which is ruling 7(e)'s literal
      // reading and is correct.
      //
      // THE SUBJECT IS THE MESSAGE ID, matching `claim`'s own shape: the server
      // forces it there anyway (the verdict is bound to one message), and using
      // the author would mint a post id that could collide with a different
      // trigger about the same player in the same ten-minute bucket.
      const roast = r && r.roastOfScribe === true;
      if (roast) {
        return considerAutonomous('roastOfScribe', {
          subject: triggerMessageId, gameTag, playerId: author,
          signals: [{ signal: 'roastOfScribe' }], triggerMessageId,
        });
      }

      const points = Number(r && r.points) || 0;
      if (!points) return null;
      return considerAutonomous('claim', {
        subject: author || triggerMessageId, gameTag, playerId: author,
        signals: [{ signal: 'claim', points }], triggerMessageId,
      });
    })
    .catch(() => null)
    .finally(() => { classifyInFlight = false; });
}

// ═══════════════════════════════════════════════════════════════════════════
// ── F3 (reviewer, Build 3 pass 1) — THE MISSING PRODUCERS.
// ═══════════════════════════════════════════════════════════════════════════
//
// DI-D1's scoring table names eight signals. Six of them — backdoorBust,
// chartLeadChange, milestone, streak, loneWolfWin, unanimous — had NO
// producer anywhere in the app: `SCRIBE_POOLS` carries lines for four of
// them and nothing has ever called `scribeTrigger` with those keys, and
// `milestone`/`streak` did not exist at all. Only `drinkDebt` (15) and
// `verbosity` (10) actually fire today, so the highest score the gate could
// ever reach without the classifier was 25 — below Balanced's 45. The
// feature was unreachable by construction. That is a planning defect in the
// DI, not an execution defect, and the coordinator amended the DI to build
// the producers here.
//
// These are PURE. They take data and return signals; they do not read
// storage, call the network, or post anything. Pass 2 wires the call sites
// in app.js (week lock -> unanimous; week finalize -> the rest), which is
// why `considerWeekSignals` below is the only impure wrapper.
//
// DEFERRED, named rather than faked: `backdoorBust` (50 points, the single
// highest-value signal). A backdoor cover is a LIVE in-game event — a
// pick that was covering inside the final minutes and stopped covering on
// the last score — and nothing in this app retains in-game state: the
// 60-second poll overwrites `homeScore`/`awayScore` in place and keeps no
// history, so at finalize there is no way to know whether a cover flipped at
// the gun or in the first quarter. Detecting it honestly needs a stored
// snapshot of the score at, say, two minutes remaining. That is a data-model
// change, out of scope for this pass, and inventing it from final scores
// alone would be exactly the fabricated-stat failure SCRIBE.md §9 forbids.

import { calculateAtsWinner, evaluatePick } from './scoring.js';
import { SCRIBE_FREQUENCY_LEVELS, SCRIBE_FREQUENCY_DEFAULT, SCRIBE_HEAT_DEFAULT } from './data-model.js';
// SCRIBE v3 Package D (DI-287, 2026-09-24) — the heated-exchange predicate,
// imported rather than written a second time here. `js/scribe-scoring.js` is
// pure and imports nothing, so it is safe in both runtimes; the SERVER verifies
// this trigger by running the SAME function over its own `messages` rows, and
// "verified" can only mean that if there is one implementation rather than two.
import { heatedExchangeRun, HEATED_MIN_LEN, HEATED_WINDOW_MS } from './scribe-scoring.js';

/** Round-number career/season correct-pick counts worth noticing. RAW
 *  counts, never the weighted tally — a milestone is "you have been right
 *  100 times," which is a count of games, not a score (CONVENTIONS #22). */
export const MILESTONE_MARKS = [25, 50, 100, 150, 200, 250, 300];
const STREAK_MIN = 3;

/**
 * RAW correct count for a standings row, or `null` when the row does not
 * carry one.
 *
 * FINDING 5 (reviewer, round 3) — there is NO fallback to `totalCorrect`.
 * That field is the WEIGHTED tally (CONVENTIONS #22), so the fallback meant
 * a standings shape without raw counts silently announced "50 correct picks"
 * off a multiplied number — a milestone that never happened, stated as fact,
 * which is precisely what SCRIBE.md §9's no-fabrication rule forbids. A
 * missing raw count now means no milestone signal at all: absent beats
 * wrong. An ABSENT row (a player with no prior standings entry) is a
 * legitimate 0 — that is a new player, not missing data.
 */
function rawCorrect(row) {
  if (!row) return 0;
  const raw = Number(row.totalCorrectCount);
  return Number.isFinite(raw) ? raw : null;
}

/**
 * Every graded pick for one player, in true chronological order.
 *
 * The ordering rule is the same one backend/Code.gs's
 * `scribeOrderedGradedPicks_` uses, for the same reason (F2): a streak is an
 * ordered claim, and an unordered list produces a confidently wrong number.
 * Here the sort key is the game's own `kickoff` (games carry ISO kickoffs, so
 * week order falls out of it) with `gameId` as a stable final tiebreak.
 *
 * `complete:false` means at least one graded pick could not be placed —
 * missing game, missing or unparseable kickoff. The caller must then emit no
 * streak at all: a sequence with a hole is worse than no sequence.
 */
export function orderedGradedResults(playerId, games, picks, weeks = null) {
  const gameById = new Map();
  for (const g of games || []) { if (g && g.gameId) gameById.set(g.gameId, g); }
  // N-5 — the SAME comparator backend/Code.gs's scribeOrderedGradedPicks_
  // uses: (season, weekNumber) first, then kickoff, then gameId. Supplying
  // `weeks` is how the two runtimes agree exactly; with no week list the
  // ordering degrades to kickoff-only, which is identical whenever kickoffs
  // are correct and is why a pick whose week is UNKNOWN to a supplied list
  // marks the sequence incomplete rather than being silently ranked 0.
  const weekRank = new Map();
  if (Array.isArray(weeks)) {
    [...weeks].filter(Boolean).sort((a, b) =>
      String(a.season || '').localeCompare(String(b.season || '')) ||
      ((Number(a.weekNumber) || 0) - (Number(b.weekNumber) || 0))
    ).forEach((w, i) => weekRank.set(String(w.weekId), i));
  }
  const out = [];
  let complete = true;
  for (const p of picks || []) {
    if (!p || p.playerId !== playerId) continue;
    const game = gameById.get(p.gameId);
    if (!game) { complete = false; continue; }
    const result = evaluatePick(p, game);
    if (result !== 'win' && result !== 'loss') continue;          // graded only
    const ms = game.kickoff ? Date.parse(game.kickoff) : NaN;
    const rank = weekRank.size ? weekRank.get(String(p.weekId)) : 0;
    if (!Number.isFinite(ms) || rank === undefined) { complete = false; continue; }
    out.push({ weekId: p.weekId, gameId: p.gameId, result, ms, rank });
  }
  out.sort((a, b) => (a.rank - b.rank) || (a.ms - b.ms) || String(a.gameId).localeCompare(String(b.gameId)));
  return { results: out, complete };
}

function runLength(results) {
  if (!results.length) return { run: 0, result: null };
  const last = results[results.length - 1].result;
  let run = 0;
  for (let i = results.length - 1; i >= 0; i--) { if (results[i].result === last) run++; else break; }
  return { run, result: last };
}

/**
 * The detectors. Returns `[{ signal, subject, gameTag, evidence }]` — never
 * posts, never scores, never decides anything. An input that is absent
 * simply means its detector contributes nothing, so the same function is
 * safe to call at lock (picks only) and at finalize (everything).
 *
 * @param weekId          the week being locked/finalized
 * @param games           games for that week (season-wide is fine and is what
 *                        `streak` wants — it filters by what it needs)
 * @param picks           picks, same latitude
 * @param players         active players, for the "everyone submitted" test
 * @param resultsBefore/After   weekly results, currently unused by any
 *                        detector; accepted so the call site (pass 2) has one
 *                        stable signature and a later detector needing them
 *                        is additive
 * @param standingsBefore/After season standings either side of the finalize
 */
export const UNANIMOUS_VISIBLE_STATUSES = ['locked', 'live', 'final'];

export function detectWeekSignals({
  weekId, weekStatus = null, games = [], picks = [], players = [], weeks = null,
  resultsBefore = null, resultsAfter = null,
  standingsBefore = null, standingsAfter = null,
} = {}) {
  const signals = [];
  const weekGames = (games || []).filter(g => g && (!weekId || g.weekId === weekId));
  const weekPicks = (picks || []).filter(p => p && (!weekId || p.weekId === weekId));
  const activeIds = new Set((players || []).filter(p => p && p.active !== false).map(p => p.playerId));

  // ── unanimous — at lock. Every player who submitted this week took the
  // same side of one game. Requires at least two submitters, and requires
  // that EVERY submitter picked this specific game: five of six agreeing
  // while the sixth abstained is not unanimity, it is a small sample.
  // N-4 (reviewer, round 2) — THE BLIND RULE, AT THE SIGNAL LEVEL. "All six
  // of you took the same side" is a statement about every player's pick. If
  // the week is still OPEN that is a straight violation — it tells a player
  // who has not submitted yet exactly where everyone else is. The signal is
  // therefore not merely unsuitable for posting while the week is open, it
  // must not be DETECTED: a detected signal is scored, recorded in the
  // evidence, and sent to the model. Gated on the week's status, and the
  // default when no status is supplied is NOT to detect it.
  const unanimousAllowed = UNANIMOUS_VISIBLE_STATUSES.includes(String(weekStatus || ''));
  const submitters = new Set(weekPicks.map(p => p.playerId).filter(id => !activeIds.size || activeIds.has(id)));
  if (unanimousAllowed && submitters.size >= 2) {
    for (const game of weekGames) {
      const gp = weekPicks.filter(p => p.gameId === game.gameId && submitters.has(p.playerId));
      if (gp.length !== submitters.size) continue;
      const team = gp[0].selectedTeam;
      if (!team || !gp.every(p => p.selectedTeam === team)) continue;
      signals.push({ signal: 'unanimous', subject: game.gameId, gameTag: game.gameId,
        evidence: { gameId: game.gameId, team, count: gp.length, weekId } });
    }
  }

  // ── loneWolfWin — at finalize. Exactly one player on the ATS-winning side,
  // everyone else on the other. Uses the SAME calculateAtsWinner the
  // standings use (CONVENTIONS #21), never a second reading of the spread.
  for (const game of weekGames) {
    if (game.status !== 'final') continue;
    const ats = (game.atsWinner !== undefined && game.atsWinner !== null) ? game.atsWinner : calculateAtsWinner(game);
    if (!ats || ats === 'no_decision') continue;
    const gp = weekPicks.filter(p => p.gameId === game.gameId);
    const winners = gp.filter(p => p.selectedTeam === ats);
    const losers = gp.filter(p => p.selectedTeam !== ats);
    if (winners.length === 1 && losers.length >= 2) {
      signals.push({ signal: 'loneWolfWin', subject: winners[0].playerId, gameTag: game.gameId,
        evidence: { gameId: game.gameId, playerId: winners[0].playerId, team: ats, against: losers.length, weekId } });
    }
  }

  // ── chartLeadChange — at finalize. A different name is on top than was.
  if (Array.isArray(standingsBefore) && Array.isArray(standingsAfter) && standingsBefore.length && standingsAfter.length) {
    const from = standingsBefore[0].playerId, to = standingsAfter[0].playerId;
    if (from && to && from !== to) {
      signals.push({ signal: 'chartLeadChange', subject: to, gameTag: '',
        evidence: { from, to, weekId } });
    }
  }

  // ── milestone — at finalize. A round-number RAW correct-pick count crossed
  // this week. `before < M <= after` so it fires once, on the crossing, and
  // never again for that mark.
  if (Array.isArray(standingsBefore) && Array.isArray(standingsAfter)) {
    const beforeById = new Map(standingsBefore.map(r => [r.playerId, r]));
    for (const after of standingsAfter) {
      const prev = rawCorrect(beforeById.get(after.playerId));
      const now = rawCorrect(after);
      // FINDING 5 — a milestone is a count of GAMES. Without a raw count on
      // either side there is nothing to count, and the weighted tally is not
      // a substitute for it.
      if (prev === null || now === null) continue;
      for (const mark of MILESTONE_MARKS) {
        if (prev < mark && now >= mark) {
          signals.push({ signal: 'milestone', subject: after.playerId, gameTag: '',
            evidence: { playerId: after.playerId, milestone: mark, total: now, weekId } });
        }
      }
    }
  }

  // ── streak — at finalize. Reached/extended to 3+, or broken at 3+.
  // Chronological by kickoff (see orderedGradedResults); a player whose
  // history cannot be fully ordered is SKIPPED rather than guessed at.
  const streakIds = new Set(weekPicks.map(p => p.playerId));
  for (const playerId of streakIds) {
    const { results, complete } = orderedGradedResults(playerId, games, picks, weeks);
    if (!complete || results.length < STREAK_MIN) continue;
    const current = runLength(results);
    const prior = runLength(results.filter(r => r.weekId !== weekId));
    if (current.run >= STREAK_MIN) {
      signals.push({ signal: 'streak', subject: playerId, gameTag: '',
        evidence: { playerId, run: current.run, kind: current.result === 'win' ? 'covers' : 'misses',
                    state: 'active', weekId } });
    } else if (prior.run >= STREAK_MIN && prior.result && current.result !== prior.result) {
      signals.push({ signal: 'streak', subject: playerId, gameTag: '',
        evidence: { playerId, run: prior.run, kind: prior.result === 'win' ? 'covers' : 'misses',
                    state: 'broken', weekId } });
    }
  }

  return signals;
}

// ═══════════════════════════════════════════════════════════════════════════
// SCRIBE v3 PACKAGE D — DI-287(a): TWO PLAYERS ARGUING.
// ═══════════════════════════════════════════════════════════════════════════
//
// THE FIRST NEW AUTONOMOUS TRIGGER SINCE BUILD 3, and it is deliberately the
// cheapest possible shape: a CODE-ONLY, NO-MODEL-CALL heuristic over the
// message stream every client already holds. No new tracked behaviour, no new
// storage key, no new poll — `detectWeekSignals` above is the same style and
// this sits beside it.
//
// PURE. It reads the list it is handed and returns signals; the impure half
// (offering the candidate to `considerAutonomous`) is `considerHeatedExchange`
// below, which is the only function here that touches the gate.
//
// WHERE IT CAN BE WRONG, NAMED RATHER THAN DISCOVERED: four alternating
// messages between two people inside five minutes is ALSO what enthusiastic
// agreement looks like. SCRIBE commenting on "an argument" that was two
// friends agreeing hard is a harmless miss — the post is still about a real,
// verifiable exchange, and the model is handed the messages rather than the
// word "argument". A model-scored version of this is a different, more
// expensive feature; this is the one DI-287 asked for.

/**
 * @param {Array<{type?:string, author?:string, ts?:number}>} recentMessages the
 *   room's own folded message list, OLDEST FIRST — `getMessages({tag})`'s order.
 * @returns {Array<{signal:string, subject:string, gameTag:string, evidence:object}>}
 *   Zero or one signal, in `detectWeekSignals`'s own return shape so the two
 *   detectors feed the same gate identically.
 */
export function detectHeatedExchange(recentMessages, {
  minLen = HEATED_MIN_LEN, windowMs = HEATED_WINDOW_MS, gameTag = '', now = Date.now(),
} = {}) {
  const list = Array.isArray(recentMessages) ? recentMessages : [];
  // HUMANS ONLY, AND CHAT ONLY. A SCRIBE line or a system row between two
  // players is not a turn in their argument — counting one would let SCRIBE's
  // own post manufacture the alternation that justifies its next one, which is
  // §9.5's "do not create conversation merely to keep SCRIBE talking" arriving
  // through arithmetic instead of through intent.
  const human = list.filter((m) => m && m.type === 'message' && !m.deleted
    && m.author !== 'scribe' && m.author !== 'system');
  const run = heatedExchangeRun(human.map((m) => ({ author: m.author, ts: m.ts })), { minLen, windowMs, now });
  if (!run.heated) return [];
  // The subject is the PAIR, joined in sorted order, so six devices watching
  // the same exchange mint the same deterministic post id.
  const subject = run.authors.join('+');
  return [{
    signal: 'heatedExchange', subject, gameTag: gameTag || '',
    evidence: { authors: run.authors, count: run.count, spanMs: run.spanMs, gameTag: gameTag || '' },
  }];
}

/**
 * The impure half — detect, then offer the candidate to the SAME
 * `considerAutonomous` gate every other signal uses. Called from the chat
 * render path after a human message lands.
 *
 * Returns `considerAutonomous`'s own outcome object, or `null` when nothing was
 * detected, so a caller can await the promise in a test and production can
 * ignore it exactly as `scribeInspectMessage` already does.
 */
export function considerHeatedExchange(recentMessages, { gameTag = '', now = Date.now() } = {}) {
  const detected = detectHeatedExchange(recentMessages, { gameTag, now });
  if (!detected.length) return null;
  const s = detected[0];
  return considerAutonomous('heatedExchange', {
    subject: s.subject, gameTag: s.gameTag,
    signals: [{ signal: 'heatedExchange' }], now,
  });
}

/**
 * The one impure wrapper: detect, then offer ONE candidate to the same
 * `considerAutonomous` gate every other signal uses. Pass 2 calls this from
 * app.js at week lock and week finalize.
 *
 * BLOCK-2c (reviewer, round 2) — ONE CANDIDATE PER INVOCATION, not one per
 * signal. This used to loop, and the loop was the defect: a three-game
 * finalize detected three lone-wolf wins in three different game threads,
 * and because every bound in this file was partitioned by gameTag, all three
 * cleared at Active and three paid posts landed in one reader's stream
 * simultaneously. The candidate is the HIGHEST-POINT signal — the most
 * interesting thing that happened — and it carries the FULL detected set in
 * its evidence, so the model still sees every fact that fired and can choose
 * which to name. Nothing is lost except the duplicate posts.
 *
 * All detected signals go into one bucket and are COMBINED there — which,
 * since DI-D1 amendment #3, is NOT a sum: distinct names are collapsed and
 * scored `top + 0.5 x (second + third)` (see scoreOpportunity). Three
 * `streak` signals from three players are one streak signal, and the fourth
 * distinct thing that happened contributes nothing. NOTE the honest scope:
 * buckets are per ROOM, so signals from two different game threads do not
 * combine with each other — the league-wide cooldown, not the bucket, is
 * what guarantees one post.
 */
export function considerWeekSignals(input) {
  const detected = detectWeekSignals(input);
  if (!detected.length) return { detected, outcomes: [], candidate: null };
  const pointsOf = s => (Object.prototype.hasOwnProperty.call(SIGNAL_POINTS, s.signal) ? SIGNAL_POINTS[s.signal] : 0);
  const candidate = detected.reduce((best, s) => (pointsOf(s) > pointsOf(best) ? s : best), detected[0]);
  const outcome = considerAutonomous(candidate.signal, {
    subject: candidate.subject, gameTag: candidate.gameTag || '', weekId: (input && input.weekId) || '',
    playerId: (candidate.evidence && candidate.evidence.playerId) || '',
    signals: detected.map(s => ({ signal: s.signal })),
  });
  return { detected, outcomes: [outcome], candidate };
}
