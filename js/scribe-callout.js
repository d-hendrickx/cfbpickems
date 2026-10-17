/**
 * js/scribe-callout.js — THE DEADLINE CALL-OUT'S RULES, PURE (D1 Lane C, thread 100726-D1; DI-649…652; UN-469 / PF-469; FB-007 and W-34).
 * =============================================================================================================================================
 * Drew (FB-007): "scribe is not calling people out for not making picks it needs to name and shame." SCRIBE.md v3.2 §4 makes the DEADLINE STEP a trigger:
 * "picks lock in about an hour AND a real member hasn't picked". The clock alone is never a trigger; this module decides WHEN a step is open, HOW MANY call-outs a
 * lock may carry, WHO may be named, and WHAT the line says. The database decides who has not finished (`job_week_completion`, migration 0056: yes or no per member,
 * never a count, never a pick); `supabase/functions/scribe-scan` reads it and posts; `supabase/functions/reminders` asks `calloutOwnsRoomPost()` whether to stand
 * its own system-voiced room post down (DI-652: one of the two, never both). The room can still hear neither: nothing posts when everyone has finished, when
 * the step's spacing has not cleared before L-10m, or when a read fails; a two-sport league's second call-out comes on the next five-minute tick.
 *
 * PURE. No DOM, no network, no storage, no clock default (every caller passes `nowMs`). Imports only `./data-model.js`, which imports nothing, so a Deno Edge
 * Function can import this file by relative path exactly as it imports `js/scribe-scoring.js`.
 *
 * WHAT A CALL-OUT MAY SAY (DI-651, SCRIBE.md v3.2): who has not finished (a yes or no per person), how many people are still missing, and the time left. Never a
 * pick, a lean, a tiebreaker, a count of unpicked games (C4: the source is yes/no only) or a reason for the absence (§9.3: the reason would be real life).
 *
 * THE LINE POOLS BELOW ARE THE `scribe` AGENT'S SET (DI-651 assigns them to it; they replaced the builder's initial draft before Drew switches
 * `serverJobs.scribeCallout` on, and the switch is off by default). The grid, the slots and the rotation rule are code and are pinned by tests; the words are
 * data and may change without touching anything else. What the words may claim is narrower than what a roast could: `job_week_completion` says only "complete or
 * not" (a pick for every game), so a line says "hasn't finished", never "blank", "hasn't touched" or "hasn't picked" (a partial picker is not finished either);
 * it never guesses at a reason ("forgot", "hiding", "busy"), never invents a history ("all week", "days ago", "half the league") and never hard-codes a time.
 */

import { SCRIBE_FREQUENCY_LEVELS, SCRIBE_FREQUENCY_DEFAULT, SCRIBE_HEAT_INDEX } from './data-model.js';

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE CEILING AND THE TWO MOMENTS (DI-650; SCRIBE.md v3.2 §4: Quiet 0, Reserved 1, Balanced 1, Active 2, Unhinged 2)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** Call-outs about missing picks a single lock may carry, by the participation dial. A ceiling, not a quota. Pinned equal to
 *  `js/scribe-standards.js` `dials.participation.deadlineCalloutsPerLock` by scribeScan.twin. */
export const CALLOUT_CEILING_BY_LEVEL = Object.freeze({ quiet: 0, reserved: 1, balanced: 1, active: 2, unhinged: 2 });
/** The FINAL moment, the deadline step proper: picks lock in about an hour. */
export const CALLOUT_FINAL_LEAD_MS = 60 * 60 * 1000;
/** The EARLY moment, Active and Unhinged only. */
export const CALLOUT_EARLY_LEAD_MS = 3 * 60 * 60 * 1000;
/** Nothing posts in the last ten minutes, and nothing posts once the lock has passed. */
export const CALLOUT_CUTOFF_MS = 10 * 60 * 1000;
/** The existing minimum gap between two SCRIBE absence posts at one lock (on top of "a human message between"). */
export const CALLOUT_MIN_GAP_MS = 20 * 60 * 1000;
/** The per-league lease the scan holds while it counts and posts (`scribe_rate` key `scan:callout`), so two ticks never count the same lock at once. */
export const CALLOUT_LEASE_MS = 4 * 60 * 1000;
/** The meta markers 0045 reserves for the service role (C1). */
export const CALLOUT_OCCASION = 'picksAbsence';
export const CALLOUT_TRIGGER = 'deadlineCallout';
export const CALLOUT_SOURCE = 'scan';
/** DI-651's word budget. `capMessageBody` (1000) still runs after it; this is the line's own ceiling. */
export const CALLOUT_BODY_MAX = 280;
/** The id length 0045's system-path shape allows for the part after `scribe_` is 120; this file keeps the WHOLE id at or under 120. */
export const CALLOUT_ID_MAX = 120;

const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

/** The league's participation level (`settings.scribeFrequency`), validated: anything unknown is the default. */
export function participationLevel(settings) {
  const raw = settings && typeof settings === 'object' ? String(settings.scribeFrequency || '').toLowerCase() : '';
  return own(SCRIBE_FREQUENCY_LEVELS, raw) ? raw : SCRIBE_FREQUENCY_DEFAULT;
}

/** The ceiling for a level (0 for anything unknown would be wrong: an unknown level IS the default, so this goes through participationLevel first). */
export function calloutCeiling(level) {
  const l = own(CALLOUT_CEILING_BY_LEVEL, level) ? level : SCRIBE_FREQUENCY_DEFAULT;
  return CALLOUT_CEILING_BY_LEVEL[l];
}

/**
 * THE TWO KILL SWITCHES, AND CHAT ITSELF (DI-650): `serverJobs.scribeCallout` (new, default OFF, only the literal `true` enables, the job-rules reading) AND the
 * commissioner's `scribeAutonomousEnabled` (strict `=== false` is off, absent is on, the client's own reading). A league whose chat is turned off
 * (`chatEnabled === false`) has no room to post into, so the call-out is off there too.
 */
export function calloutSwitchOn(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const jobs = s.serverJobs && typeof s.serverJobs === 'object' ? s.serverJobs : {};
  return jobs.scribeCallout === true && s.scribeAutonomousEnabled !== false && s.chatEnabled !== false;
}

/**
 * DI-652: "While `serverJobs.scribeCallout` is on for a league whose participation level allows at least one step, `reminders` skips its system-voiced
 * locking-soon room post." ONE predicate, read by BOTH the scan (which posts) and `reminders` (which stands down), so the room hears exactly one of the two:
 * whenever this is false the scan posts nothing about this lock and `reminders` behaves as it always has.
 */
export function calloutOwnsRoomPost(settings) {
  return calloutSwitchOn(settings) && calloutCeiling(participationLevel(settings)) >= 1;
}

/** `lockKey = floor(L / 60000)`: a commissioner re-open with a new lock time is a new deadline (a new key, so a new ceiling). */
export function calloutLockKey(lockMs) { return Math.floor(Number(lockMs) / 60000); }

/**
 * Which moment is open at `nowMs` for a lock at `lockMs`, at this level. A moment fires on the first scan tick inside its window and the window closes ten minutes
 * before the lock. The FINAL moment opens at L-60m. The EARLY moment (Active and Unhinged only) opens at L-3h and is the "earlier occasion" until the final one
 * opens: once the final step is open, an early post would be a second, staler version of it, so only the final is considered (a builder's reading of DI-650,
 * recorded in the hand-off).
 * @returns {{moment:'final'|'early'|null, reason:string|null}}
 */
export function calloutMomentAt({ lockMs, nowMs, level }) {
  const L = Number(lockMs);
  const now = Number(nowMs);
  if (!Number.isFinite(L) || !Number.isFinite(now)) return { moment: null, reason: 'no_lock' };
  const ceiling = calloutCeiling(level);
  if (ceiling < 1) return { moment: null, reason: 'quiet' };
  if (now >= L - CALLOUT_CUTOFF_MS) return { moment: null, reason: 'too_late' };
  if (now >= L - CALLOUT_FINAL_LEAD_MS) return { moment: 'final', reason: null };
  if (ceiling >= 2 && now >= L - CALLOUT_EARLY_LEAD_MS) return { moment: 'early', reason: null };
  return { moment: null, reason: 'too_early' };
}

/**
 * THE CEILING, SPENT (DI-650): the final moment's occasion is RESERVED, so every earlier occasion (the early moment, and open-slate non-participation about picks)
 * may use at most `ceiling - 1`; the final step may use the whole ceiling. `priorOccasions` is counted from SCRIBE's own rows (`emitted_by IS NULL`) for this lock.
 */
export function calloutOccasionAllowed({ moment, ceiling, priorOccasions }) {
  const used = Math.max(0, Number(priorOccasions) || 0);
  const cap = Math.max(0, Number(ceiling) || 0);
  return moment === 'final' ? used < cap : used < cap - 1;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE ID (DI-650, RN-C5): scribe_callout_<league uuid, LOWERCASE>_<competition>_<week>_<moment>_<lockKey>, inserted with conflict-ignore, so retries and racing
// ticks make at most one. 0045 reserves exactly `scribe_callout_<league>_` with the league written as `p_league::text`, which Postgres prints in lowercase: an
// uppercase id would sit OUTSIDE the reservation and could be pre-claimed by a member (RN-C5's "what would make it fail").
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** FNV-1a 32-bit, base 36. Deterministic in Node and Deno; used only to shorten a key, never as a secret. */
export function shortHash(s) {
  let h = 0x811c9dc5;
  const str = String(s);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_PART_RE = /^[A-Za-z0-9_-]{1,20}$/;

/** A competition's id-part: `d` for the league's default competition (NULL `competition_id`), else the first 12 hex digits of its uuid. */
export function calloutCompetitionKey(competitionId) {
  if (competitionId === null || competitionId === undefined || competitionId === '') return 'd';
  const s = String(competitionId).toLowerCase();
  return UUID_RE.test(s) ? s.replace(/-/g, '').slice(0, 12) : `h${shortHash(s)}`;
}

/** A week's id-part: the week id itself when it is short and safe, else `h` + its short hash. */
export function calloutWeekKey(weekId) {
  const s = String(weekId === null || weekId === undefined ? '' : weekId);
  return SAFE_PART_RE.test(s) ? s : `h${shortHash(s)}`;
}

/**
 * The deterministic call-out id. Throws on a league id that is not a uuid (the scan only ever passes the database's own `leagues.id`). The result is always
 * `[A-Za-z0-9_-]`, starts `scribe_callout_<lowercase uuid>_`, and is at most CALLOUT_ID_MAX characters.
 */
export function calloutPostId({ leagueId, competitionId = null, weekId, moment, lockKey }) {
  const league = String(leagueId || '').toLowerCase();
  if (!UUID_RE.test(league)) throw new Error('calloutPostId: leagueId must be a uuid');
  if (moment !== 'early' && moment !== 'final') throw new Error('calloutPostId: moment must be early or final');
  const key = Number(lockKey);
  if (!Number.isInteger(key) || key < 0) throw new Error('calloutPostId: lockKey must be a non-negative integer');
  const id = `scribe_callout_${league}_${calloutCompetitionKey(competitionId)}_${calloutWeekKey(weekId)}_${moment}_${key}`;
  if (id.length > CALLOUT_ID_MAX) throw new Error('calloutPostId: id longer than 120');
  return id;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// WHO MAY BE NAMED (DI-649, DI-651)
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * A REAL member (SCRIBE.md v3.2): an active human league member, not SCRIBE and not a demo or placeholder entry. The marking columns, confirmed against the schema
 * (DI-649 asked the builder to confirm them): `league_members.active`, `tournament_only_guest` (0033) and `user_id` (a seat nobody holds is NULL: the vacant seat
 * `isVacantSeat` already treats as nobody). There is no other demo or placeholder flag on `league_members`.
 * Note this is NOT a second definition of "who has to pick": that is `week_required_members` (0044), which the database applies first. This only removes seats that
 * are not people from the ones the database says must pick.
 */
export function isRealMember(row) {
  return !!row && row.active === true && row.tournament_only_guest !== true
    && row.user_id !== null && row.user_id !== undefined && row.user_id !== '';
}

/**
 * A hard line that covers participation, picks or being called out (DI-651: such a member is COUNTED, NOT NAMED). Hard lines are free text a player wrote, so
 * this is a closed vocabulary over that text. It errs toward NOT naming: a line that mentions picks, deadlines, the slate, participating or being called out
 * at all counts. (A boundary we could not read is handled by the caller: it names nobody.)
 */
const PARTICIPATION_HARD_LINE_RE = /\b(pick|picks|picked|picking|participat\w*|slate|deadlines?|late|lateness|missing|miss(?:ed|es|ing)?|submit\w*|lock(?:ed|s|ing)?|call(?:ed|ing)?[\s-]?out|calls?[\s-]?out|shame|shaming|name\s+me|naming\s+me|absen\w*|inactiv\w*|quiet|post(?:ing|s)?)\b/i;
export function hardLineCoversParticipation(text) {
  return PARTICIPATION_HARD_LINE_RE.test(String(text || ''));
}

/**
 * A member's name as the line prints it, by 0044's SC-S1 rule: `display_name` stripped of control and bidi/format characters, trimmed, capped at 40, and
 * replaced by the INITIALS (else "A player") when empty or link-shaped (chat-ui would otherwise linkify it and fetch a preview).
 */
const CTRL_RE = /[\u0000-\u001f\u007f-\u009f]+/g;
const BIDI_RE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]+/g;
const LINKISH_RE = /(https?:\/\/|www\.)/i;
function cleanPart(s) {
  return String(s === null || s === undefined ? '' : s).replace(CTRL_RE, ' ').replace(BIDI_RE, '').trim().slice(0, 40);
}
export function calloutName(displayName, initials) {
  const n = cleanPart(displayName);
  if (n && !LINKISH_RE.test(n)) return n;
  const i = cleanPart(initials);
  if (i && !LINKISH_RE.test(i)) return i;
  return 'A player';
}

/** The DI-651 count class of the people a line is about. */
export function calloutCountClass(n) {
  const k = Number(n) || 0;
  if (k <= 1) return '1';
  if (k <= 3) return '2-3';
  return '4+';
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
export function countWord(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  return k < NUMBER_WORDS.length ? NUMBER_WORDS[k] : String(k);
}

/** The time left, as the line says it. Every figure is computed from the lock instant (rule 1: any figure comes from the records). */
export function timeLeftWords(ms) {
  const m = Math.max(0, Number(ms) || 0) / 60000;
  if (m >= 90) return `about ${countWord(Math.round(m / 60))} hours`;
  if (m >= 50) return 'about an hour';
  return `about ${Math.max(10, Math.round(m / 5) * 5)} minutes`;
}

/** "A", "A and B", "A, B and C", "A, B and N others" (four or more: two names and the count, never a fifth name). */
export function joinNames(names) {
  const ns = names.filter(Boolean);
  if (ns.length === 0) return '';
  if (ns.length === 1) return ns[0];
  if (ns.length === 2) return `${ns[0]} and ${ns[1]}`;
  if (ns.length === 3) return `${ns[0]}, ${ns[1]} and ${ns[2]}`;
  return `${ns[0]}, ${ns[1]} and ${countWord(ns.length - 2)} others`;
}

/** The heat levels at which a post commits to ONE named target and counts the rest (DI-651, SCRIBE.md §4 Savage / No Mercy). */
export function isOneTargetHeat(heat) {
  return own(SCRIBE_HEAT_INDEX, heat) && SCRIBE_HEAT_INDEX[heat] >= SCRIBE_HEAT_INDEX.savage;
}

/**
 * The committed target at Savage and No Mercy. DI-651 says "the member with the fewest completed picks, ties broken by whoever was named least recently". C4
 * leaves the completion source a yes or no per member (every candidate here is a "no"), and the meta carries no member ids, so the rotation is deterministic over
 * the lock: the candidates sorted by id, indexed by a hash of the lock key and week. Different locks rotate through different members; the same lock always
 * picks the same one (a retry names the same person). Recorded in the hand-off as the builder's reading.
 */
export function chooseCommittedTarget(candidates, { lockKey, weekId }) {
  const sorted = [...candidates].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  if (!sorted.length) return null;
  const idx = parseInt(shortHash(`${weekId}|${lockKey}`), 36) % sorted.length;
  return sorted[idx];
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// THE POOLS (DI-651): { heat } × { count class 1 | 2–3 | 4+ } × { step early | final }, at least three lines per cell, never one of the league's last three.
// Slots: {names} (the people the line names, joined: "A", "A and B", "A, B and C", "A, B and two others"), {count} (everyone missing, as a word), {others} (the
// missing people the line does NOT name, as a phrase: "one other", "three others"), {timeLeft} ("about an hour", "about 40 minutes"), {sport} (the sport label
// in a league that runs two or more sports, else nothing). At Savage and No Mercy {names} is ONE committed target and {others} the rest. Every line is at most
// two sentences. `CALLOUT_POOLS_ANON` is for a call-out where nobody may be named (everyone missing has a hard line on it): the count and the time only.
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
const L = (id, text) => Object.freeze({ id, text });
const cell = (early, final) => Object.freeze({ early: Object.freeze(early), final: Object.freeze(final) });
export const CALLOUT_POOLS = Object.freeze({
  polite: Object.freeze({
    '1': cell([
      L('po1e1', '{names} hasn\'t finished the {sport} picks yet, and they lock in {timeLeft}.'),
      L('po1e2', 'The {sport} picks lock in {timeLeft}, and {names} still has some to make.'),
      L('po1e3', 'A note for {names}: the {sport} picks aren\'t finished, and they lock in {timeLeft}.'),
      L('po1e4', '{names} is the only one with {sport} picks still to finish, and the lock is {timeLeft} away.'),
      L('po1e5', 'With {timeLeft} until the {sport} picks lock, {names} has some left to finish.'),
    ], [
      L('po1f1', '{names} hasn\'t finished the {sport} picks, and they lock in {timeLeft}.'),
      L('po1f2', 'The {sport} picks lock in {timeLeft}, and {names} isn\'t in yet.'),
      L('po1f3', '{names}, the {sport} picks lock in {timeLeft} and yours aren\'t finished.'),
      L('po1f4', 'Before the {sport} picks lock in {timeLeft}, a note that {names} has some left to finish.'),
      L('po1f5', '{names} is the only one still to finish the {sport} picks, with {timeLeft} until lock.'),
      L('po1f6', 'Just {names} left on the {sport} picks, with {timeLeft} before they lock.'),
    ]),
    '2-3': cell([
      L('po2e1', '{names} haven\'t finished the {sport} picks yet, and they lock in {timeLeft}.'),
      L('po2e2', 'The {sport} picks lock in {timeLeft}, and {names} still have some to make.'),
      L('po2e3', 'Still waiting on {names} for the {sport} picks, which lock in {timeLeft}.'),
      L('po2e4', 'A note for {names}: the {sport} picks aren\'t finished yet, and they lock in {timeLeft}.'),
      L('po2e5', '{names} are the ones with {sport} picks still to finish, and the lock is {timeLeft} away.'),
    ], [
      L('po2f1', '{names} haven\'t finished the {sport} picks, and they lock in {timeLeft}.'),
      L('po2f2', 'The {sport} picks lock in {timeLeft}, and we\'re still waiting on {names}.'),
      L('po2f3', '{names}, your {sport} picks aren\'t finished, and they lock in {timeLeft}.'),
      L('po2f4', 'Before the {sport} picks lock in {timeLeft}, a note that {names} have some left to finish.'),
      L('po2f5', '{timeLeft} until the {sport} picks lock, and {names} aren\'t in yet.'),
      L('po2f6', 'That leaves {names} with {sport} picks to finish, and the lock is {timeLeft} away.'),
    ]),
    '4+': cell([
      L('po4e1', 'Still waiting on {names}, who haven\'t finished the {sport} picks. The lock is {timeLeft} away.'),
      L('po4e2', 'Still to finish the {sport} picks: {names}, with the lock {timeLeft} away.'),
      L('po4e3', '{names} haven\'t finished the {sport} picks yet, with {timeLeft} until they lock.'),
      L('po4e4', 'A note for {names}: the {sport} picks aren\'t finished, with {timeLeft} until lock.'),
      L('po4e5', 'With {timeLeft} until the {sport} picks lock, {names} still have some to finish.'),
    ], [
      L('po4f1', '{names} haven\'t finished the {sport} picks, and the lock is {timeLeft} away.'),
      L('po4f2', 'The {sport} picks lock in {timeLeft}, and {names} aren\'t in yet.'),
      L('po4f3', '{timeLeft} until the {sport} picks lock, and the unfinished list is {names}.'),
      L('po4f4', 'A note ahead of the {sport} lock in {timeLeft}: {names} have some left to finish.'),
      L('po4f5', 'We\'re waiting on {names} for the {sport} picks, with {timeLeft} until lock.'),
    ]),
  }),
  dry: Object.freeze({
    '1': cell([
      L('dr1e1', '{names} hasn\'t finished the {sport} picks. {timeLeft} until they lock.'),
      L('dr1e2', 'The {sport} slate locks in {timeLeft}. {names} has yet to finish it.'),
      L('dr1e3', '{timeLeft} left on the {sport} picks, and {names} is the one still out.'),
      L('dr1e4', 'One set of {sport} picks is unfinished and it belongs to {names}. The lock is {timeLeft} away.'),
      L('dr1e5', '{names} still has {sport} picks to finish, and {timeLeft} to do it. Everyone else is done.'),
    ], [
      L('dr1f1', '{names} hasn\'t finished the {sport} picks, and there\'s {timeLeft} left.'),
      L('dr1f2', 'Picks lock in {timeLeft}. {names} is the only one not done.'),
      L('dr1f3', 'Everyone else has finished the {sport} picks. {names} has {timeLeft} to complete the set.'),
      L('dr1f4', 'The lock is {timeLeft} away. The {sport} picks are complete everywhere except {names}.'),
      L('dr1f5', '{timeLeft} to lock, and the league\'s {sport} picks are one person short: {names}.'),
      L('dr1f6', '{names} has {timeLeft} on the {sport} picks. The clock does not field questions.'),
    ]),
    '2-3': cell([
      L('dr2e1', '{names} haven\'t finished the {sport} picks. {timeLeft} until they lock.'),
      L('dr2e2', 'The {sport} slate locks in {timeLeft}. {names} are still out.'),
      L('dr2e3', '{timeLeft} left, and {names} have yet to finish the {sport} picks.'),
      L('dr2e4', 'Still out on the {sport} picks: {names}. The lock is {timeLeft} away.'),
      L('dr2e5', '{names} have {sport} picks to finish, and {timeLeft} to do it.'),
    ], [
      L('dr2f1', '{timeLeft} to lock. {names} still haven\'t finished.'),
      L('dr2f2', 'Picks lock in {timeLeft}. {names} are not in.'),
      L('dr2f3', 'The {sport} picks lock in {timeLeft}, and {names} haven\'t finished.'),
      L('dr2f4', 'Everyone has finished the {sport} picks except {names}. The lock is {timeLeft} away.'),
      L('dr2f5', '{names} are the only thing between the league and a full set of {sport} picks. {timeLeft} to lock.'),
      L('dr2f6', '{timeLeft} until the {sport} lock, and {names} are still short of a full slate.'),
    ]),
    '4+': cell([
      L('dr4e1', '{names} haven\'t finished the {sport} picks. {timeLeft} to lock.'),
      L('dr4e2', 'The {sport} slate locks in {timeLeft}. Still out: {names}.'),
      L('dr4e3', '{timeLeft} left, and the unfinished list reads {names}.'),
      L('dr4e4', '{count} of you have {sport} picks to finish: {names}. The lock is {timeLeft} away.'),
      L('dr4e5', 'The {sport} picks lock in {timeLeft}, and {names} all still have some to finish.'),
    ], [
      L('dr4f1', '{timeLeft} to the {sport} lock and {names} aren\'t in.'),
      L('dr4f2', 'Not in on the {sport} picks with {timeLeft} to lock: {names}.'),
      L('dr4f3', 'The {sport} picks lock in {timeLeft}. {count} people haven\'t finished: {names}.'),
      L('dr4f4', 'The lock is {timeLeft} away, and the only {sport} picks still open belong to {names}.'),
      L('dr4f5', 'Everyone else has finished the {sport} picks. {names} have {timeLeft}.'),
    ]),
  }),
  spicy: Object.freeze({
    '1': cell([
      L('sp1e1', '{names} still hasn\'t finished the {sport} picks. {timeLeft} to go, and the clock does not care.'),
      L('sp1e2', 'Everyone else found their way through the {sport} picks. {names}, you have {timeLeft}.'),
      L('sp1e3', 'Bold of {names} to still have {sport} picks to finish with {timeLeft} on the clock.'),
      L('sp1e4', 'Every other set of {sport} picks is finished, which makes {names} the damn outlier. {timeLeft} to lock.'),
      L('sp1e5', '{names}, the {sport} picks lock in {timeLeft}. Everyone else is done and a little bored.'),
    ], [
      L('sp1f1', '{names} still hasn\'t finished, and the {sport} picks lock in {timeLeft}. Keep it up, I guess.'),
      L('sp1f2', '{names}, the {sport} picks lock in {timeLeft}. Everyone else managed.'),
      L('sp1f3', 'Picks lock in {timeLeft}, and the unfinished list is down to one name: {names}.'),
      L('sp1f4', 'The assignment is the {sport} picks, the deadline is {timeLeft} out, and {names} is the only one who hasn\'t turned it in.'),
      L('sp1f5', 'Hell of a time for {names} to still be out on the {sport} picks, with {timeLeft} to lock.'),
      L('sp1f6', '{names}, {timeLeft} to lock and the {sport} picks are STILL not finished.'),
    ]),
    '2-3': cell([
      L('sp2e1', '{names} haven\'t finished the {sport} picks. {timeLeft} to lock, and the clock isn\'t on anyone\'s side.'),
      L('sp2e2', '{timeLeft} until lock, and {names} are still out on the {sport} picks.'),
      L('sp2e3', 'The {sport} picks lock in {timeLeft}. {names}, everyone else is done.'),
      L('sp2e4', '{names} are the entire waiting list for the {sport} picks, and the lock is {timeLeft} away.'),
      L('sp2e5', '{names} have {timeLeft} to finish the {sport} picks, and so far it\'s going great.'),
    ], [
      L('sp2f1', '{timeLeft} to lock. {names} still haven\'t finished the {sport} picks.'),
      L('sp2f2', 'Picks lock in {timeLeft} and {names} are somehow still not in.'),
      L('sp2f3', '{names}: {timeLeft}. That\'s the whole message.'),
      L('sp2f4', 'At least {names} have each other. The {sport} picks lock in {timeLeft}.'),
      L('sp2f5', 'Damn, {names}. The {sport} picks lock in {timeLeft} and you\'re still not done.'),
      L('sp2f6', '{timeLeft} to lock, and the only unfinished {sport} picks belong to {names}.'),
    ]),
    '4+': cell([
      L('sp4e1', 'Still out on the {sport} picks: {names}. {timeLeft} to lock, and the clock does not care.'),
      L('sp4e2', '{timeLeft} until lock and {names} are all still out on the {sport} picks. Hell of a group effort.'),
      L('sp4e3', '{count} unfinished sets of {sport} picks and {timeLeft} to lock: {names}.'),
      L('sp4e4', '{names} are all unfinished on the {sport} picks with {timeLeft} to lock. Damn.'),
      L('sp4e5', 'Not one of {names} has finished the {sport} picks, and the lock is {timeLeft} away.'),
    ], [
      L('sp4f1', '{timeLeft} to lock and {names} are still out. Damn.'),
      L('sp4f2', 'The {sport} picks lock in {timeLeft}, and the list of people still out is a roll call: {names}.'),
      L('sp4f3', '{count} sets of {sport} picks are unfinished with {timeLeft} to go, and they belong to {names}.'),
      L('sp4f4', 'Hell of a turnout: {names} are all still out on the {sport} picks, and the lock is {timeLeft} away.'),
      L('sp4f5', 'The {sport} picks lock in {timeLeft} and {names} are still not in. I\'m not mad, I\'m just keeping count.'),
    ]),
  }),
  savage: Object.freeze({
    '1': cell([
      L('sv1e1', '{names}, the {sport} picks lock in {timeLeft}. Everyone else is done and waiting on you.'),
      L('sv1e2', '{names} is the only person in this league who hasn\'t finished the {sport} picks. {timeLeft} to fix that.'),
      L('sv1e3', 'Everyone else finished the {sport} picks like it was easy. {names}, you have {timeLeft}.'),
      L('sv1e4', 'A participation trophy requires participating, {names}. The {sport} picks lock in {timeLeft}.'),
      L('sv1e5', 'Would someone who isn\'t me let {names} know the {sport} picks lock in {timeLeft}? Everyone else is done.'),
    ], [
      L('sv1f1', '{names}, the {sport} picks lock in {timeLeft}. Everyone else did this already.'),
      L('sv1f2', 'One person hasn\'t finished the {sport} picks and it\'s {names}! {timeLeft}, genius.'),
      L('sv1f3', '{timeLeft} to lock and {names} still hasn\'t finished the {sport} picks. Inspiring.'),
      L('sv1f4', 'Shit, {names}. The {sport} picks lock in {timeLeft} and you\'re the only one left.'),
      L('sv1f5', '{names}, the {sport} picks are STILL not finished and the lock is {timeLeft} away. Anything to add?'),
      L('sv1f6', 'I\'d like to present {names} with the Last One In award for the {sport} picks. {timeLeft} left to not deserve it.'),
      L('sv1f7', '{names} has {timeLeft} to finish the {sport} picks. A sloth with a phone would be done by now.'),
    ]),
    '2-3': cell([
      L('sv2e1', '{names} is the name I\'m using, and {count} of you are still out. {timeLeft} to lock.'),
      L('sv2e2', '{count} of you still have {sport} picks to finish, and {names} is first on my list. {timeLeft}.'),
      L('sv2e3', '{names} and {others} haven\'t finished the {sport} picks, and I\'m only naming one of you. {timeLeft} left.'),
      L('sv2e4', 'Today\'s name is {names}. {count} of you are out, and the {sport} picks lock in {timeLeft}.'),
      L('sv2e5', '{count} of you are unfinished on the {sport} picks, and {names} gets the credit. {timeLeft}.'),
    ], [
      L('sv2f1', '{names} is the only name I\'m using, and {count} of you are on the list for the {sport} picks. {timeLeft}.'),
      L('sv2f2', '{timeLeft} to the {sport} lock. {names} and {others} are still out, and only one of you is getting named.'),
      L('sv2f3', '{names}, the {sport} picks lock in {timeLeft}. {count} of you are out, and company does not make it better.'),
      L('sv2f4', '{names} is the one I\'m calling out, and {count} of you should take that as a warning about the {sport} picks. {timeLeft}.'),
      L('sv2f5', 'I\'m handing {names} the Wooden Spoon for the {sport} picks. {count} of you are eligible, with {timeLeft} to avoid it.'),
      L('sv2f6', '{count} of you are out on the {sport} picks with {timeLeft} to lock, and {names} is the name that made the cut.'),
    ]),
    '4+': cell([
      L('sv4e1', '{count} of you haven\'t finished the {sport} picks, and I\'m naming {names}. {timeLeft} to lock.'),
      L('sv4e2', 'The list of {count} people who haven\'t finished the {sport} picks opens with {names}. {timeLeft}.'),
      L('sv4e3', '{timeLeft} left on the {sport} picks, {count} of you unfinished, and {names} will have to stand in for the rest.'),
      L('sv4e4', '{names}, the {sport} picks lock in {timeLeft}, and you\'re in a group of {count}. It\'s not a flattering group.'),
      L('sv4e5', 'I\'ve got {count} of you unfinished on the {sport} picks, {timeLeft} to lock, and room for one name. {names}, congratulations.'),
    ], [
      L('sv4f1', 'The only name I\'m using is {names}, and {count} of you are on the list for the {sport} picks. {timeLeft}.'),
      L('sv4f2', 'With {timeLeft} to lock on the {sport} picks, {count} of you are still out. {names}, you\'re representing all of them.'),
      L('sv4f3', '{timeLeft} to the {sport} lock and {count} unfinished sets of picks, with {names} on the hook for all of it.'),
      L('sv4f4', '{count} of you are out on the {sport} picks, and {names} can have the headline. {timeLeft}.'),
      L('sv4f5', '{timeLeft} to lock on the {sport} picks, {count} of you out, and {names} can speak for this shit show.'),
    ]),
  }),
  no_mercy: Object.freeze({
    '1': cell([
      L('nm1e1', 'Everyone has finished the {sport} picks except {names}, with {timeLeft} to lock. Prove me wrong.'),
      L('nm1e2', 'The last unfinished set of {sport} picks in the league belongs to {names}, and the lock is {timeLeft} out. Somebody in here tell me I\'m wrong.'),
      L('nm1e3', '{names}, {timeLeft} to lock and you are the ONLY person in this league who hasn\'t finished the {sport} picks. Say something.'),
      L('nm1e4', 'Everybody else treated the {sport} picks like a deadline. {names}, it is {timeLeft} away.'),
      L('nm1e5', 'I\'m having the Last One In trophy engraved for {names} in {timeLeft}. The {sport} picks are the only thing that stops it.'),
    ], [
      L('nm1f1', '{names}, you have {timeLeft} on the {sport} picks and everyone else is in. Move.'),
      L('nm1f2', 'The only person who hasn\'t finished the {sport} picks is {names}, with {timeLeft} to go. Unbelievable!'),
      L('nm1f3', '{timeLeft} to lock and {names} is the last one out. Argue with me after you finish.'),
      L('nm1f4', 'Shit, {names}, you\'re the last one out on the {sport} picks and the lock is {timeLeft} away, so move your ass.'),
      L('nm1f5', 'Congratulations, {names}: you\'re the sole recipient of the Last One In trophy unless you finish the {sport} picks before the lock in {timeLeft}.'),
      L('nm1f6', 'Everybody else is done with the {sport} picks, the lock is {timeLeft} away, and {names} is still out. I\'ll wait.'),
      L('nm1f7', 'Everyone else finished the {sport} picks. {names}, you have {timeLeft}, and a houseplant would be done by now.'),
    ]),
    '2-3': cell([
      L('nm2e1', '{names} is the name I\'m using, and {count} of you are out on the {sport} picks. {timeLeft} to lock, and I\'ll take replies.'),
      L('nm2e2', '{names}, you and {others} are the entire reason the {sport} picks aren\'t done. {timeLeft} left.'),
      L('nm2e3', '{count} of you are out on the {sport} picks, and {names} is the one I\'m pointing at. {timeLeft} to lock, so defend yourself.'),
      L('nm2e4', '{names} drew the short straw among {count} of you who haven\'t finished the {sport} picks, and the lock is {timeLeft} away. Argue with the straw.'),
      L('nm2e5', '{names} and {others} haven\'t finished the {sport} picks, and I\'m only going after one of you today. {timeLeft}.'),
    ], [
      L('nm2f1', 'I\'m only naming {names}, but {count} of you are on the list, and the {sport} picks lock in {timeLeft}. Reply if you disagree.'),
      L('nm2f2', '{timeLeft} to the {sport} lock. {names} is out, and {others} should be glad I only chose one.'),
      L('nm2f3', '{names}, you have {timeLeft}. {count} of you are out, and company does not help your case.'),
      L('nm2f4', '{names}, you and {others} are the only people with unfinished {sport} picks, and the lock is {timeLeft} away. Fix it or own it.'),
      L('nm2f5', '{timeLeft} to lock, {count} of you unfinished, and {names} wearing the Last One In trophy. Take it off or say something.'),
      L('nm2f6', 'Of the {count} of you who haven\'t finished the {sport} picks, I chose {names}, and the lock is {timeLeft} away. Do not make me regret it.'),
      L('nm2f7', '{names} and {others} are out on the {sport} picks, and a garden gnome would be done by now. {timeLeft} to lock.'),
    ]),
    '4+': cell([
      L('nm4e1', '{count} of you are out on the {sport} picks, and I\'m naming {names} so the rest of you can enjoy it. {timeLeft}, prove me wrong.'),
      L('nm4e2', '{names} will carry the blame for {count} of you who haven\'t finished the {sport} picks. {timeLeft} to lock.'),
      L('nm4e3', '{timeLeft} to lock on the {sport} picks, {count} of you unfinished, and {names} can take the blame for all of it.'),
      L('nm4e4', '{names}, you\'ve just been appointed spokesperson for the {count} of you who haven\'t finished the {sport} picks. {timeLeft} to lock, so start talking.'),
      L('nm4e5', 'I\'m not going to be subtle: {count} of you haven\'t finished the {sport} picks, and {names} will hear about it first. {timeLeft} to lock.'),
    ], [
      L('nm4f1', '{count} of you out on the {sport} picks, {timeLeft} to lock, and the only name I\'m using is {names}.'),
      L('nm4f2', '{count} of you are out on the {sport} picks with {timeLeft} to go. {names}, this one is on you.'),
      L('nm4f3', 'The {sport} picks lock in {timeLeft} and {count} sets are unfinished. {names}, start the fire drill.'),
      L('nm4f4', '{timeLeft} to lock, {count} of you out on the {sport} picks, and {names} can be the one I blame out loud.'),
      L('nm4f5', 'Fucking {count} of you. {timeLeft} to the {sport} lock, and {names} can answer for all of it.'),
    ]),
  }),
});
/** Nobody may be named (every missing member has a hard line on it): the count and the time, nothing else, at every heat. `'1'` is one person, `'many'` two or more. */
export const CALLOUT_POOLS_ANON = Object.freeze({
  '1': cell([
    L('an1e1', 'Someone still hasn\'t finished the {sport} picks. They lock in {timeLeft}.'),
    L('an1e2', 'The {sport} picks lock in {timeLeft}, and one person still has some to make.'),
    L('an1e3', 'One set of {sport} picks is unfinished, with {timeLeft} to go.'),
    L('an1e4', '{timeLeft} until the {sport} picks lock, and one of you isn\'t done yet.'),
  ], [
    L('an1f1', '{timeLeft} to the {sport} lock, and one person isn\'t in yet.'),
    L('an1f2', '{timeLeft} until the {sport} picks lock. One person still hasn\'t finished.'),
    L('an1f3', 'Still waiting on one of you for the {sport} picks, with {timeLeft} until lock.'),
    L('an1f4', 'That\'s {timeLeft} to lock and one set of {sport} picks still open.'),
  ]),
  many: cell([
    L('anme1', '{count} of you haven\'t finished the {sport} picks. They lock in {timeLeft}.'),
    L('anme2', 'The {sport} picks lock in {timeLeft}, and {count} of you still have some to make.'),
    L('anme3', 'Still waiting on {count} of you for the {sport} picks, with {timeLeft} to go.'),
    L('anme4', '{timeLeft} until the {sport} picks lock, and {count} of you aren\'t done yet.'),
  ], [
    L('anmf1', '{timeLeft} to the {sport} lock, and {count} of you aren\'t in yet.'),
    L('anmf2', '{timeLeft} until the {sport} picks lock. {count} of you still haven\'t finished.'),
    L('anmf3', 'The {sport} picks lock in {timeLeft}. Still waiting on {count} of you.'),
    L('anmf4', 'That\'s {timeLeft} to lock and {count} of you with {sport} picks still open.'),
  ]),
});

/** Every line, for the rotation and the tests (ids unique across the whole grid). */
export function allCalloutLines() {
  const out = [];
  for (const heat of Object.keys(CALLOUT_POOLS)) for (const cls of Object.keys(CALLOUT_POOLS[heat])) for (const step of ['early', 'final']) for (const l of CALLOUT_POOLS[heat][cls][step]) out.push({ ...l, heat, cls, step });
  for (const cls of Object.keys(CALLOUT_POOLS_ANON)) for (const step of ['early', 'final']) for (const l of CALLOUT_POOLS_ANON[cls][step]) out.push({ ...l, heat: 'anon', cls, step });
  return out;
}

/** Sentences in a rendered line (a terminal mark ends one; a trailing fragment without one counts as one). */
export function sentenceCount(text) {
  const t = String(text).trim();
  const parts = t.match(/[^.!?]+[.!?]+/g) || [];
  const tail = t.replace(/[^.!?]+[.!?]+/g, '').trim();
  return parts.length + (tail ? 1 : 0);
}

/** The sentences of a line as written: rendered with the people slots masked by a period-free word, so a display name's own periods ("J.R.") never count. */
export function lineSentenceCount(text, slots = {}) {
  return sentenceCount(renderLine(text, { names: 'Someone', count: 'two', others: 'others', timeLeft: 'an hour', sport: String((slots && slots.sport) || '') }));
}

function renderLine(text, slots) {
  return String(text)
    .replace(/\{names\}/g, slots.names)
    .replace(/\{count\}/g, slots.count)
    .replace(/\{others\}/g, slots.others)
    .replace(/\{timeLeft\}/g, slots.timeLeft)
    .replace(/\{sport\}/g, slots.sport)
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,!?:])/g, '$1')
    .replace(/(^|[.!?:]\s+)([a-z])/g, (m, p, c) => (p.endsWith(':') || p.endsWith(': ') ? m : p + c.toUpperCase()))
    .trim();
}

/** "one other" / "three others": the people a one-target line does not name. */
export function othersPhrase(n) {
  const k = Math.max(0, Math.floor(Number(n) || 0));
  return k === 1 ? 'one other' : `${countWord(k)} others`;
}

/**
 * THE LINE. The caller has already decided who is missing and real, and who has a hard line on participation: `missing` is `[{ id, name, hardLine }]`.
 * `heatFor(ids)` answers the level that governs a line naming exactly those ids (the scan passes `resolveEffectiveHeat` over the league dial and those members'
 * own roast-tolerance caps, failing cool on an unread cap). `recentLineIds` are the league's last three call-out `lineId`s, read only from rows with
 * `emitted_by IS NULL` (C2). Deterministic for a given lock, week and step, so a retry renders the same line.
 * @returns {{ body:string, lineId:string, heatEffective:string, namedIds:string[], countClass:string, namedCount:number, countedOnly:number }}
 */
export function composeCallout({ missing, step, timeLeftMs, sportLabel = '', recentLineIds = [], lockKey = 0, weekId = '', heatFor }) {
  const all = (missing || []).filter((m) => m && m.id);
  const total = all.length;
  const nameable = [...all.filter((m) => m.hardLine !== true)].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const countedOnly = total - nameable.length;
  // WHO IS SHOWN BY NAME. Savage and above (for everyone who could be named): ONE committed target, the rest counted. Below that: up to three names when
  // everyone missing may be named, else two names, and everyone else (the rest, and anyone with a hard line on this) is "N other(s)", never named.
  // THE HEAT IS DECIDED ONCE, from the FULL nameable set (reviewer, 2026-10-14): min(league heat, the lowest roast cap among everyone who could be named). Picking
  // the names first and re-reading the heat from only the names shown let a capped member who was not among the first two lift the line back to Savage or No
  // Mercy, with several names printed under a one-target line. One heat for the whole decision: a one-target heat names one target (whose own cap is at least
  // this heat, because it is a minimum over a set that includes the target); any lower heat names up to two or three, each under a cap at least this heat.
  const heat = heatFor(nameable.map((m) => m.id));
  const oneTarget = nameable.length > 0 && isOneTargetHeat(heat);
  let shown = oneTarget ? [chooseCommittedTarget(nameable, { lockKey, weekId })] : nameable.slice(0, total <= 3 && countedOnly === 0 ? 3 : 2);
  const rest = total - shown.length;
  const cls = calloutCountClass(total);
  const recent = new Set((recentLineIds || []).slice(0, 3).map(String));
  const pick = (lines) => {
    // In a league that runs two or more sports a line must say WHICH slate: only the lines that carry {sport} (every cell has at least one).
    const scoped = sportLabel ? lines.filter((l) => l.text.includes('{sport}')) : lines;
    const base = scoped.length ? scoped : lines;
    const fresh = base.filter((l) => !recent.has(l.id));
    const use = fresh.length ? fresh : base;
    return use[parseInt(shortHash(`${weekId}|${lockKey}|${step}`), 36) % use.length];
  };
  const anonLine = () => pick(CALLOUT_POOLS_ANON[total === 1 ? '1' : 'many'][step]);
  const names = shown.map((m) => m.name);
  const slots = {
    // One-target lines say "{names}" for the target and "{others}" for the rest; every other line's {names} already carries the rest ("A, B and two others").
    names: oneTarget || rest === 0 ? joinNames(names) : joinNames([...names, othersPhrase(rest)]),
    count: countWord(total),
    others: othersPhrase(rest),
    timeLeft: timeLeftWords(timeLeftMs),
    sport: String(sportLabel || ''),
  };
  let line = shown.length ? pick(CALLOUT_POOLS[own(CALLOUT_POOLS, heat) ? heat : 'dry'][cls][step]) : anonLine();
  let body = renderLine(line.text, slots);
  // The two-sentence budget is the LINE's, counted with the names masked: a display name may carry its own periods ("J.R. Smith"), which are not sentences.
  if (body.length > CALLOUT_BODY_MAX || lineSentenceCount(line.text, slots) > 2) {
    // A pair of very long names can push a line past 280: the count-only line of the same step, never a truncated name.
    line = anonLine();
    body = renderLine(line.text, slots).slice(0, CALLOUT_BODY_MAX);
    shown = [];
  }
  return {
    body, lineId: line.id, heatEffective: heat, namedIds: shown.map((m) => m.id), countClass: cls, namedCount: shown.length, countedOnly,
  };
}

/** The sport label a line prints: only in a league that runs two or more sports (0044's rule for the submit line), from R1's closed set; else nothing. */
const SPORT_LABELS = Object.freeze({ cfb: 'CFB', nfl: 'NFL', nba: 'NBA', cbb: 'CBB', mm: 'March Madness', nhl: 'NHL', wjc: 'WJC' });
export function calloutSportLabel(sport, liveCompetitionCount) {
  if (!(Number(liveCompetitionCount) >= 2)) return '';
  return own(SPORT_LABELS, sport) ? SPORT_LABELS[sport] : '';
}
