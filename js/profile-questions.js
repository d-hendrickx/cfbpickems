/**
 * js/profile-questions.js — the About you question catalog (D2 lane 1, UN-507A / PF-507A; DI-1001..1007, DI-1031..1040; Drew's M-73 ruling of 2026-10-19). PURE: imports nothing, no DOM, no storage.
 * ============================================================================================================================================================
 * THE QUESTION LIST IS DATA. The onboarding sheet, the Profile pane's About you, the server validator (migration 0066's account_context_profile_ok, a twin proven equal by fixtures that run through
 * BOTH) and the tips all read this one frozen catalog; no question's copy lives in app.js. Which questions are ASKED is one reviewed constant, ONBOARDING_ENABLED_IDS (Drew's M-73 set: exactly
 * seven ids), and RD01_APPROVED_QUESTION_IDS is the same seven spelled again as the list the privacy policy (RD-01 v5.0.0) describes: profilequestionstest asserts the two are EQUAL (a subset
 * and a superset both fail), so a question can never ship that the policy does not describe, and the policy can never describe one the app does not ask. A question that was answered and is later
 * switched off stays visible and removable in About you (DI-1001: `answeredQuestions()`), it is just no longer asked.
 *
 * TWO STORES. `store: 'player'` answers (the home team per sport, the alma mater) live on the player record exactly as today (preferences.homeTeams, league_members.alma_mater and the
 * college football designation, js/cfb-teams.js): league-visible, the same exposure alma mater has always had. `store: 'account'` answers live ONLY in the owner-only account_context.profile
 * (migration 0066): never profiles.extra, never league_members.preferences, never scribe_memory (DI-1035).
 *
 * FREE TEXT (DI-1032): `career_text` (80 characters, one line) and `anything_else_text` (280, three lines) are plain text: normalized on save (NFC, trimmed, runs of spaces collapsed, control and
 * bidirectional-override characters removed) and REFUSED, with the entered text kept, when they hold a link, an e-mail address or a phone-number-like run of seven or more digits. They are untrusted
 * text everywhere they go: output only through the escaper, and into a model prompt only inside a delimited data block (DI-1034).
 *
 * NOT OFFERED, by ruling: high schools, age, gender, location, off-limits topics, favourite players (needs a roster list that does not exist). Adding any needs regulatory and Drew.
 */

export const PROFILE_QUESTIONS_VERSION = 1;

/** Free-text rules: the cap is in CHARACTERS (code points), `lines` the most lines the field holds. */
export const TEXT_RULES = Object.freeze({
  career_text: Object.freeze({ cap: 80, lines: 1 }),
  anything_else_text: Object.freeze({ cap: 280, lines: 3 }),
});
export const NAME_CAP = 80;                 // a team or school name
export const SPORTS_FOLLOWED_MAX = 8;
export const OTHER_TEAMS_MAX = 3;           // per sport
export const SCHOOLS_ATTENDED_MAX = 4;
export const PROFILE_BYTES_MAX = 4096;

export const WORK_CATEGORIES = Object.freeze([
  ['education', 'Education'], ['healthcare', 'Healthcare'], ['trades', 'Trades'], ['technology', 'Technology'], ['business', 'Business'],
  ['government_military', 'Government or military'], ['student', 'Student'], ['retired', 'Retired'], ['other', 'Other'],
]);
export const WATCH_STYLES = Object.freeze([['home', 'At home'], ['bar', 'At a bar'], ['stadium', 'In the stadium'], ['phone', 'On my phone'], ['highlights', 'Mostly highlights']]);
export const YEARS_BUCKETS = Object.freeze([['lt2', 'Under 2 years'], ['2to5', '2 to 5 years'], ['5to10', '5 to 10 years'], ['gt10', 'Over 10 years']]);
export const ROAST_LEVELS = Object.freeze([['gentle', 'Gentle'], ['medium', 'Medium'], ['spicy', 'Spicy']]);

const q = (o) => Object.freeze({ ...o });

/**
 * `{ id, section, store, input, label, purpose, enabledByDefault, tier, mentionable, regulatoryClass }`.
 *   section        'teams' | 'background' (the onboarding screen the question belongs to)
 *   input          sports_multi | team_one_per_sport | teams_up_to_3 | school_one | schools_up_to_4 | text_line | text_lines | category | fixed_list | team_one_per_sport_rival | years_bucket | roast_comfort
 *   tier           'league' (visible to league mates, as alma mater always was) | 'private' (the owner only)
 *   mentionable    true: the person may let SCRIBE mention this answer in league chat (the per-answer switch, DI-1003)
 *   regulatoryClass the class regulatory's audit gave it (R-F3)
 */
export const PROFILE_QUESTIONS = Object.freeze([
  q({ id: 'sports_followed', section: 'background', store: 'account', input: 'sports_multi', label: 'Sports you follow', tier: 'private', mentionable: false, regulatoryClass: 'interest', enabledByDefault: true,
      purpose: 'Home leans toward these sports. SCRIBE can use it only if you turn on Let SCRIBE use my profile.' }),
  q({ id: 'home_team', section: 'teams', store: 'player', input: 'team_one_per_sport', label: 'Home team', tier: 'league', mentionable: false, regulatoryClass: 'league-visible', enabledByDefault: true,
      purpose: 'Your Home leads with your team. SCRIBE uses it in Ask SCRIBE only if you turn on Let SCRIBE use my profile.' }),
  q({ id: 'other_teams', section: 'background', store: 'account', input: 'teams_up_to_3', label: 'Other teams you follow', tier: 'private', mentionable: false, regulatoryClass: 'interest', enabledByDefault: true,
      purpose: 'More of your teams on Home.' }),
  q({ id: 'alma_mater', section: 'teams', store: 'player', input: 'school_one', label: 'Alma mater', tier: 'league', mentionable: false, regulatoryClass: 'league-visible', enabledByDefault: true,
      purpose: "Used for your league's Alma Mater Watch and tiebreaker." }),
  q({ id: 'schools_attended', section: 'background', store: 'account', input: 'schools_up_to_4', label: 'Colleges you attended', tier: 'private', mentionable: true, regulatoryClass: 'education', enabledByDefault: true,
      purpose: 'Shows you history and stories for those schools. Colleges only.' }),
  q({ id: 'career_text', section: 'background', store: 'account', input: 'text_line', label: 'Your work', tier: 'private', mentionable: true, regulatoryClass: 'free-text', enabledByDefault: true,
      purpose: 'Saved with your profile. Home and SCRIBE do not use it. Plain text, no links.' }),
  q({ id: 'anything_else_text', section: 'background', store: 'account', input: 'text_lines', label: 'Anything else', tier: 'private', mentionable: true, regulatoryClass: 'free-text', enabledByDefault: true,
      purpose: 'Saved with your profile. Home and SCRIBE do not use it. Please leave out health, religion and private details about other people. Plain text, no links, no emails or phone numbers.' }),
  // ── in the catalog, OFF (Drew's M-73 set is the seven above). Kept so a later ruling is a one-constant change, and so an answer a person already gave stays visible and removable. ──
  q({ id: 'work_category', section: 'background', store: 'account', input: 'category', label: 'Work (a category)', tier: 'private', mentionable: true, regulatoryClass: 'occupation', enabledByDefault: false,
      supersededBy: 'career_text', purpose: 'Lets SCRIBE and Home pick jokes that fit your day.' }),
  q({ id: 'how_you_watch', section: 'background', store: 'account', input: 'fixed_list', label: 'How you watch', tier: 'private', mentionable: true, regulatoryClass: 'habit', enabledByDefault: false,
      purpose: 'Helps game day feel right for you.' }),
  q({ id: 'rivalry_team', section: 'background', store: 'account', input: 'team_one_per_sport_rival', label: 'Rivalry team', tier: 'private', mentionable: true, regulatoryClass: 'interest', enabledByDefault: false,
      purpose: "Home surfaces your rival's games." }),
  q({ id: 'years_following', section: 'background', store: 'account', input: 'years_bucket', label: 'Years following a sport', tier: 'private', mentionable: true, regulatoryClass: 'habit', enabledByDefault: false,
      purpose: 'Lets SCRIBE pitch the right level of detail.' }),
  q({ id: 'roast_comfort', section: 'background', store: 'account', input: 'roast_comfort', label: 'SCRIBE roast comfort', tier: 'private', mentionable: false, regulatoryClass: 'preference', enabledByDefault: false,
      purpose: 'How hard SCRIBE should rib you.' }),
]);

/** Drew's M-73 default, exactly (DI-1031): sports and teams, colleges attended, career as free text, and a free-text "anything else". */
export const ONBOARDING_ENABLED_IDS = Object.freeze(['sports_followed', 'home_team', 'other_teams', 'alma_mater', 'schools_attended', 'career_text', 'anything_else_text']);
/** The ids RD-01 v5.0.0 describes (DI-1037). Changes only with a new approved RD-01 version or a new Drew ruling. */
export const RD01_APPROVED_QUESTION_IDS = Object.freeze(['sports_followed', 'home_team', 'other_teams', 'alma_mater', 'schools_attended', 'career_text', 'anything_else_text']);

const BY_ID = new Map(PROFILE_QUESTIONS.map((x) => [x.id, x]));
export const questionById = (id) => BY_ID.get(String(id)) || null;
/** Every id whose answer lives in account_context.profile. */
export const ACCOUNT_IDS = Object.freeze(PROFILE_QUESTIONS.filter((x) => x.store === 'account').map((x) => x.id));
/** The ids that have a per-answer "mention in league chat" switch. */
export const MENTIONABLE_IDS = Object.freeze(PROFILE_QUESTIONS.filter((x) => x.mentionable).map((x) => x.id));

/** The questions being ASKED, in catalog order. `ids` defaults to the shipped constant. */
export function enabledQuestions(ids = ONBOARDING_ENABLED_IDS) {
  const on = new Set(Array.isArray(ids) ? ids : []);
  return PROFILE_QUESTIONS.filter((x) => on.has(x.id));
}
/** The questions the person has an answer for in `profile` that are no longer asked: still shown in About you and removable (DI-1001). `profile` is the account profile object. */
export function answeredQuestions(profile, ids = ONBOARDING_ENABLED_IDS) {
  const p = profile && typeof profile === 'object' ? profile : {};
  const on = new Set(Array.isArray(ids) ? ids : []);
  return PROFILE_QUESTIONS.filter((x) => x.store === 'account' && !on.has(x.id) && p[x.id] !== undefined);
}
/** What the screens show for a section: the enabled questions plus any answered-but-off ones, in catalog order. */
export function questionsForSection(section, profile, ids = ONBOARDING_ENABLED_IDS) {
  const on = new Set(ids);
  for (const x of answeredQuestions(profile, ids)) on.add(x.id);
  return PROFILE_QUESTIONS.filter((x) => x.section === section && on.has(x.id));
}

/** The policy guard (DI-1037): the enabled set must EQUAL the approved set. `{ ok, missing, extra }` (missing: approved but not asked; extra: asked but not approved). */
export function policyGuard(enabled = ONBOARDING_ENABLED_IDS, approved = RD01_APPROVED_QUESTION_IDS) {
  const e = new Set(enabled), a = new Set(approved);
  const missing = [...a].filter((x) => !e.has(x)).sort();
  const extra = [...e].filter((x) => !a.has(x)).sort();
  return { ok: !missing.length && !extra.length, missing, extra };
}

// ═══ FREE TEXT (DI-1032): normalize, then validate. The regular expressions are the SQL twin's (0066's account_context_text_ok), spelled for JavaScript. ═══════════════════════════════════

/** A link: a scheme, `www.`, or a bare domain with a common ending. */
export const LINK_RE = /(?:\:\/\/|www\.|[a-z0-9-]\.(?:com|net|org|edu|gov|io|co|us|app|dev|info|biz|ly|tv|gg|xyz)(?:$|[^a-z]))/i;
/** An e-mail address. */
export const EMAIL_RE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** A phone-number-like run: seven digits with at most two separators between neighbours. */
export const PHONE_RE = /(?:[0-9][ ().\-]{0,2}){7}/;
// security F-1: the invisible characters (soft hyphen, the Arabic letter mark, zero-width space / non-joiner / joiner, word joiner, BOM) are refused too, or a zero-width space inside "acme.com" slips past the link rule
const BAD_CHARS_RE = /[\u0001-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\u00AD\u061C\u200B-\u200D\u2060\uFEFF]/;
const BAD_CHARS_NO_LF_RE = /[\u0001-\u0009\u000B-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029\u00AD\u061C\u200B-\u200D\u2060\uFEFF]/;

export const TEXT_COPY = Object.freeze({
  link: "Links aren't allowed here. Take the link out and try again.",
  contact: "Email addresses and phone numbers aren't allowed here.",
  tooLong: (n) => `That's over ${n} characters. Shorten it and try again.`,
  tooManyLines: (n) => `Use ${n === 1 ? 'one line' : `at most ${n} lines`}.`,
  remainingLabel: (used, cap) => `${used} / ${cap}`,
  maxLabel: (cap) => `${cap} characters maximum`,
});

const len = (s) => Array.from(String(s)).length;
/** Normalizes entered text: NFC, control and bidirectional characters removed (tabs and carriage returns become spaces / line breaks), runs of spaces collapsed, each line trimmed, blank lines dropped; a one-line field joins its lines with a space. */
export function normalizeText(raw, { lines = 1 } = {}) {
  let s = String(raw == null ? '' : raw).normalize('NFC');
  s = s.replace(/\r\n?|\u2028|\u2029/g, '\n').replace(/\t/g, ' ');
  s = s.replace(/[\u0001-\u0009\u000B-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\u00AD\u061C\u200B-\u200D\u2060\uFEFF]/g, '');   // F-1: invisible characters go too, so a hidden link or number is SEEN (and refused)
  s = s.replace(/[^\S\n]+/g, ' ');
  const parts = s.split('\n').map((l) => l.replace(/^ +| +$/g, '')).filter((l) => l !== '');
  return lines <= 1 ? parts.join(' ') : parts.join('\n');
}

/**
 * `{ ok: true, value }` (value '' = nothing to store: remove the answer) or `{ ok: false, error: 'link' | 'contact' | 'too_long' | 'too_many_lines', message, value }` where `value` is the NORMALIZED text, so a
 * refusal keeps what the person typed. `id` is career_text or anything_else_text.
 */
export function validateText(id, raw) {
  const rule = TEXT_RULES[id];
  if (!rule) return { ok: false, error: 'unknown', message: '', value: '' };
  const value = normalizeText(raw, { lines: rule.lines });
  if (value === '') return { ok: true, value: '' };
  if (len(value) > rule.cap) return { ok: false, error: 'too_long', message: TEXT_COPY.tooLong(rule.cap), value };
  if (value.split('\n').length > rule.lines) return { ok: false, error: 'too_many_lines', message: TEXT_COPY.tooManyLines(rule.lines), value };
  if (LINK_RE.test(value)) return { ok: false, error: 'link', message: TEXT_COPY.link, value };
  if (EMAIL_RE.test(value) || PHONE_RE.test(value)) return { ok: false, error: 'contact', message: TEXT_COPY.contact, value };
  return { ok: true, value };
}

// ═══ THE VALIDATOR TWIN (0066's account_context_profile_ok / _tips_ok / _text_ok / _name_ok) ═══════════════════════════════════════════════════════════════════════════════════════════

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const SPORT_RE = /^[a-z][a-z0-9_]{1,11}$/;
/** A team or school name as stored: 1..80 characters, NFC, no leading or trailing space, no control or bidirectional characters. */
export function nameOk(t) {
  return typeof t === 'string' && len(t) >= 1 && len(t) <= NAME_CAP && t === t.normalize('NFC') && t === t.replace(/^ +| +$/g, '') && !BAD_CHARS_RE.test(t);
}
/** Free text as STORED: the already-normalized form within the cap and lines, with no link, e-mail or phone-like run. */
export function textOk(t, cap, lines) {
  if (typeof t !== 'string') return false;
  const n = len(t);
  if (n < 1 || n > cap || t !== t.normalize('NFC') || t !== t.replace(/^[ \n]+|[ \n]+$/g, '')) return false;
  if (BAD_CHARS_NO_LF_RE.test(t) || /[ ]{2,}/.test(t) || /\n[ ]*\n/.test(t) || /[ ]\n|\n[ ]/.test(t)) return false;
  if (t.split('\n').length > lines) return false;
  return !LINK_RE.test(t) && !EMAIL_RE.test(t) && !PHONE_RE.test(t);
}
const distinctOk = (arr, itemOk, max) => Array.isArray(arr) && arr.length <= max && arr.every(itemOk) && new Set(arr).size === arr.length;
const inList = (list) => (v) => typeof v === 'string' && list.some(([k]) => k === v);
const SHARE_IDS = ['schools_attended', 'career_text', 'anything_else_text', 'work_category', 'how_you_watch', 'rivalry_team', 'years_following'];

/** The twin of account_context_profile_ok(): is this profile object one the server would accept? */
export function profileValid(p) {
  if (!isObj(p)) return false;
  if (new TextEncoder().encode(JSON.stringify(p)).length > PROFILE_BYTES_MAX) return false;
  for (const [k, v] of Object.entries(p)) {
    switch (k) {
      case 'scribeMaster': if (typeof v !== 'boolean') return false; break;
      case 'shareWithLeague':
        if (!isObj(v) || !Object.entries(v).every(([a, b]) => SHARE_IDS.includes(a) && typeof b === 'boolean')) return false; break;
      case 'sports_followed': if (!distinctOk(v, (s) => typeof s === 'string' && SPORT_RE.test(s), SPORTS_FOLLOWED_MAX)) return false; break;
      case 'other_teams':
        if (!isObj(v) || !Object.entries(v).every(([sp, a]) => SPORT_RE.test(sp) && distinctOk(a, nameOk, OTHER_TEAMS_MAX))) return false; break;
      case 'rivalry_team':
        if (!isObj(v) || !Object.entries(v).every(([sp, a]) => SPORT_RE.test(sp) && nameOk(a))) return false; break;
      case 'schools_attended': if (!distinctOk(v, nameOk, SCHOOLS_ATTENDED_MAX)) return false; break;
      case 'career_text': if (!textOk(v, TEXT_RULES.career_text.cap, TEXT_RULES.career_text.lines)) return false; break;
      case 'anything_else_text': if (!textOk(v, TEXT_RULES.anything_else_text.cap, TEXT_RULES.anything_else_text.lines)) return false; break;
      case 'work_category': if (!inList(WORK_CATEGORIES)(v)) return false; break;
      case 'how_you_watch': if (!inList(WATCH_STYLES)(v)) return false; break;
      case 'years_following': if (!inList(YEARS_BUCKETS)(v)) return false; break;
      case 'roast_comfort': if (!inList(ROAST_LEVELS)(v)) return false; break;
      default: return false;   // an id the catalog does not know
    }
  }
  return true;
}

/** The twin of account_context_tips_ok(). */
export function tipsValid(p) {
  if (!isObj(p)) return false;
  if (new TextEncoder().encode(JSON.stringify(p)).length > 2048) return false;
  const nat = (v) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 999999;
  for (const [k, v] of Object.entries(p)) {
    if (k === 'off' || k === 'gsHidden') { if (typeof v !== 'boolean') return false; }
    else if (k === 'tv') { if (!nat(v)) return false; }
    else if (k === 'seen') {
      if (!isObj(v) || Object.keys(v).length > 40 || !Object.entries(v).every(([a, b]) => /^[a-z][a-z0-9_]{1,39}$/.test(a) && nat(b))) return false;
    } else return false;
  }
  return true;
}

// ═══ ANSWERS: normalize what a form gave into what is stored, or refuse it ═══════════════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * `normalizeAnswer(id, raw)` for an account question: `{ ok: true, value }` (value `undefined` = remove the answer) or `{ ok: false, error, message }`. Lists are de-duplicated and capped; team and school names
 * are trimmed single-spaced; free text goes through validateText.
 */
export function normalizeAnswer(id, raw) {
  const x = questionById(id);
  if (!x || x.store !== 'account') return { ok: false, error: 'unknown', message: '' };
  const name = (s) => String(s == null ? '' : s).normalize('NFC').replace(/[\u00AD\u061C\u200B-\u200D\u2060\uFEFF]/g, '').replace(/[\u0001-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069\u2028\u2029]/g, ' ').replace(/ {2,}/g, ' ').replace(/^ +| +$/g, '');
  const names = (arr, max) => { const out = []; for (const a of Array.isArray(arr) ? arr : []) { const n = name(a); if (n && nameOk(n) && !out.includes(n) && out.length < max) out.push(n); } return out; };
  switch (x.input) {
    case 'sports_multi': { const v = (Array.isArray(raw) ? raw : []).map(String).filter((s) => SPORT_RE.test(s)).filter((s, i, a) => a.indexOf(s) === i).slice(0, SPORTS_FOLLOWED_MAX); return { ok: true, value: v.length ? v : undefined }; }
    case 'teams_up_to_3': {
      const out = {};
      for (const [sp, arr] of Object.entries(isObj(raw) ? raw : {})) { const n = SPORT_RE.test(sp) ? names(arr, OTHER_TEAMS_MAX) : []; if (n.length) out[sp] = n; }
      return { ok: true, value: Object.keys(out).length ? out : undefined };
    }
    case 'team_one_per_sport_rival': {
      const out = {};
      for (const [sp, one] of Object.entries(isObj(raw) ? raw : {})) { const n = name(one); if (SPORT_RE.test(sp) && n && nameOk(n)) out[sp] = n; }
      return { ok: true, value: Object.keys(out).length ? out : undefined };
    }
    case 'schools_up_to_4': { const v = names(raw, SCHOOLS_ATTENDED_MAX); return { ok: true, value: v.length ? v : undefined }; }
    case 'text_line': case 'text_lines': { const r = validateText(id, raw); return r.ok ? { ok: true, value: r.value === '' ? undefined : r.value } : r; }
    case 'category': return raw === '' || raw == null ? { ok: true, value: undefined } : inList(WORK_CATEGORIES)(raw) ? { ok: true, value: raw } : { ok: false, error: 'list', message: '' };
    case 'fixed_list': return raw === '' || raw == null ? { ok: true, value: undefined } : inList(WATCH_STYLES)(raw) ? { ok: true, value: raw } : { ok: false, error: 'list', message: '' };
    case 'years_bucket': return raw === '' || raw == null ? { ok: true, value: undefined } : inList(YEARS_BUCKETS)(raw) ? { ok: true, value: raw } : { ok: false, error: 'list', message: '' };
    case 'roast_comfort': return raw === '' || raw == null ? { ok: true, value: undefined } : inList(ROAST_LEVELS)(raw) ? { ok: true, value: raw } : { ok: false, error: 'list', message: '' };
    default: return { ok: false, error: 'unknown', message: '' };
  }
}

/** The labels of a list question's options, for the screens. */
export const OPTIONS = Object.freeze({ work_category: WORK_CATEGORIES, how_you_watch: WATCH_STYLES, years_following: YEARS_BUCKETS, roast_comfort: ROAST_LEVELS });

/**
 * D2 M-93 (W-177, DI-1103; Drew 2026-10-22 "Integrate all three"): the two "Let SCRIBE mention my work / what I wrote above in league chat" switch rows do nothing today and would keep doing nothing:
 * SCRIBE's room posts use none of the free-text answers (DI-996 keeps them "saved only"). They come OFF the screen behind this one frozen constant. The saved `shareWithLeague` values are kept
 * and ignored, `mentionLabel`, `mentionNeedsMaster`, the validators and the dormant handler all stay, so a later ruling that gives them a real effect is a one-constant change.
 */
export const MENTION_SWITCHES_SHOWN = false;

/** The words (DI-747, DI-1033, DI-1039). Nothing here is user data. */
export const ABOUT_COPY = Object.freeze({
  title: 'About you',
  intro: 'These help your Home and SCRIBE feel like yours from day one. Skip anything. You can change or remove any answer later in Profile.',
  privatePage: 'Everything on this page is private to you. Only you can see your answers.',
  optional: 'Optional',
  skip: 'Skip',
  skipForNow: 'Skip for now',
  next: 'Next',
  back: 'Back',
  done: 'Done',
  remove: 'Remove',
  removeAll: 'Remove everything I told Munera',
  removeAllConfirmTitle: 'Remove everything you told Munera?',
  // reviewer note 10: the team answers live on the player's seat in THIS league, so the sentence names the league; while a college week is Locked or Live the college football teams cannot change (the wall)
  removeAllConfirmBody: ({ league = '', cfbLocked = false } = {}) => {
    const where = league ? ` in ${league}` : ' in this league';
    return cfbLocked
      ? `Your answers are deleted and your home teams${where} are cleared. Your college football home team and alma mater stay until the week finishes. Your name and photo stay. You can answer again any time.`
      : `Your answers are deleted and your home team and alma mater${where} are cleared. Your name and photo stay. You can answer again any time.`;
  },
  removedAll: 'Removed.',
  removedAllCfbKept: 'Removed. Your college football teams stay until the week finishes.',
  removeAllConfirm: 'Remove Everything',
  saveFailed: "Couldn't save. Your answers are still here. Try again.",
  progress: (n, of) => `${n} of ${of}`,
  masterLabel: 'Let SCRIBE use my profile',
  masterHelp: "With this on, when you type a question in Ask SCRIBE, your home teams, alma mater and the sports you follow go with it to Anthropic, SCRIBE's AI provider, so SCRIBE knows what you follow. Your work and Anything else are never used. Off until you turn it on. Remove any answer in Profile, About you.",
  mentionLabel: (what) => `Let SCRIBE mention ${what} in league chat`,
  mentionNeedsMaster: 'Turn on Let SCRIBE use my profile first',
  mentionWhat: Object.freeze({ career_text: 'my work', anything_else_text: 'what I wrote above', schools_attended: 'my colleges', work_category: 'my work', how_you_watch: 'how I watch', rivalry_team: 'my rival', years_following: 'how long I have followed' }),
  addTeam: 'Add team',
  addCollege: 'Add college',
  teamsHeading: 'Teams',
  homeTeam: 'Home team',
  almaMater: 'Alma mater',
  chooseNone: 'Choose…',
  schoolsHint: 'Shown for the sports your league plays now. Other sports can be added later in Profile.',
});
