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

import { sendEvent } from './chat.js';
// Build 2, Group C (2026-09-10, UN-150…154) — the @scribe mention branch now
// calls the interactive (LLM-backed) runtime instead of posting a canned
// line unconditionally. One-directional import (scribeAgent.js never imports
// this module) so there is no cycle: scribeAgent.js is a thin backend relay
// + settings gate, this module owns the pool/fallback/dedup mechanics it
// already owned before this build.
import { isScribeInteractiveEnabled, scribeAskRemote } from './scribeAgent.js';

// UN-160 (E2) — a hand-bumped constant, analogous to APP_VERSION (js/app.js):
// bump it alongside a SCRIBE_POOLS content edit so a feedback record can tell
// WHICH voice pool generated the line it's rating, months later. Deliberately
// NOT tied to APP_VERSION itself — SCRIBE's voice can change independently of
// an app release. Carried on every SCRIBE post via scribeTrigger() below.
export const SCRIBE_VERSION = '2.1';

const LEDGER_KEY = 'cfbp_scribe_ledger';   // { lineHash: lastUsedMs }
const LAST_POST_KEY = 'cfbp_scribe_lastpost'; // { rateKey: lastMs } ('' = main room, gameId = per-game)
const REUSE_WINDOW_MS = 14 * 24 * 3600 * 1000;
const GENERAL_COOLDOWN = 10 * 60 * 1000;
const GAME_COOLDOWN = 60 * 60 * 1000;

// ── Line pools ────────────────────────────────────────────────────────────────
// {NAME} = display name of the subject player. {N} = a number when supplied.
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

export function scribeMentionDegraded({ gameTag = '', subject = '', vars = {}, triggerMessageId = null } = {}) {
  const line = pickLine('mention', vars) || LAST_RESORT_MENTION_LINE;
  const id = `scribe_llm_${triggerMessageId || subject || 'x'}`.replace(/[^a-zA-Z0-9_:-]/g, '');
  sendEvent({ type: 'message', gameTag, body: line + DEGRADED_SUFFIX, author: 'scribe', id,
              notify: true, replyTo: triggerMessageId || '',
              meta: { source: 'tier0', trigger: 'mention', scribeVersion: SCRIBE_VERSION,
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
