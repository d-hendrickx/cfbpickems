/**
 * js/tips.js — first-use tips and the Getting started checklist, as DATA (D2 lane 1, UN-507 / PF-507, DI-733..745; the first-picks step DI-800 and DI-1008..1010). PURE: imports nothing, no DOM, no storage.
 * ==========================================================================================================================================
 * Education is attached to the place and moment it applies, never one sequence (DI-734): a one-time TIP CARD at the top of a surface, a GETTING STARTED card on Home, and a re-entry in Control Center > Tips &
 * Help. No overlay, spotlight or coach mark (DI-739). This module is the catalog and every decision about it; app.js owns the cards, the account store and the taps. No copy lives anywhere else.
 *
 *   - `TIPS`            the frozen catalog `{ id, surface, role, whenState, copy, topic, v }` (DI-733). The copy is DI-734's, word for word.
 *   - `eligibleTip()`   a pure function of (surface, role, week class, seen set, master switch, store available): at most ONE tip per screen (DI-737), never a commissioner tip for a player, nothing at all
 *                       while the account store has not loaded (silence, never an error: DI-741).
 *   - `gettingStarted()` the card's rows and their completion, DERIVED FROM FACTS the app read (a membership, a saved profile, a submitted pick, push enabled; members, a week, games, an open week), never
 *                       self-reported, so the card cannot claim a step that did not happen (DI-735). The pick row has a muted "Waiting for your commissioner" state (DI-1009).
 *   - `firstPicks()`    the first-picks step's four states (DI-1008) from the league's week statuses; never a blocker, never anyone's picks (blind rule).
 *
 * BLIND RULE (DI-740): no tip names a team picked, a tiebreaker or a count of who has submitted; tipstest pins the copy against those shapes.
 */

export const TIPS_VERSION = 1;

/** The week classes a surface reasons about: none (no week), draft, open, live (Locked or Live), final. */
export const WEEK_CLASSES = Object.freeze(['none', 'draft', 'open', 'live', 'final']);

const t = (o) => Object.freeze({ v: 1, link: null, ...o });
export const TIPS = Object.freeze([
  t({ id: 'picks_how', surface: 'picks', role: 'any', whenState: 'open', topic: 'How picks work',
      copy: 'Pick the winner against the spread. Tap a team to pick it. You can change picks until the week locks.' }),
  t({ id: 'hidden_picks', surface: 'dashboard', role: 'any', whenState: 'open', topic: 'Why picks are hidden',
      copy: 'Picks stay hidden until the week locks. Until then you will see ••• for everyone else.' }),
  t({ id: 'live_colours', surface: 'dashboard', role: 'any', whenState: 'live', topic: 'What the colours mean',
      copy: "Soft colours mean a game is still going. Solid ✓ and ✗ mean it's final." }),
  t({ id: 'standings_total', surface: 'standings', role: 'any', whenState: 'final', topic: 'How standings work',
      copy: 'Standings add up each finished week. Tap a player to see their weeks.' }),
  t({ id: 'locker_room', surface: 'chat', role: 'any', whenState: 'any', topic: 'The Locker Room and SCRIBE',
      copy: "This is your league's group chat. SCRIBE, the league's AI member, chimes in now and then. Say @SCRIBE to ask it something." }),
  t({ id: 'comm_rhythm', surface: 'commissioner', role: 'commissioner', whenState: 'any', topic: 'Your commissioner checklist',
      copy: 'You run the weekly rhythm. Each week: set it up, pick the games, open it for picks, then finalize after the games.' }),
]);

export const TIP_SURFACES = Object.freeze(['picks', 'dashboard', 'standings', 'chat', 'commissioner']);
const BY_ID = new Map(TIPS.map((x) => [x.id, x]));
export const tipById = (id) => BY_ID.get(String(id)) || null;

/** The week class of a league from its weeks' EFFECTIVE statuses ('draft' | 'open' | 'locked' | 'live' | 'final' ...). Open wins, then live (locked or live), then draft, then final; no weeks is 'none'. */
export function weekClassOf(statuses) {
  const list = (Array.isArray(statuses) ? statuses : []).map((x) => String(x || '').toLowerCase());
  if (!list.length) return 'none';
  if (list.includes('open')) return 'open';
  if (list.includes('live') || list.includes('locked')) return 'live';
  if (list.includes('draft')) return 'draft';
  return 'final';
}

/**
 * The ONE tip a surface shows, or null. `seen` is the account store's `{ tipId: version }`; `off` the master switch ("Show tips" off); `available` false while the account store has not loaded (nothing is shown).
 * `hasFinalWeek` serves the Standings tip (the first visit with at least one Final week). A commissioner tip is never eligible for a player; a tip is shown again only when its version is newer than the one seen.
 */
export function eligibleTip({ surface, role = 'player', weekClass = 'none', hasFinalWeek = false, seen = {}, off = false, available = true } = {}) {
  if (!available || off) return null;
  const isComm = role === 'commissioner';
  const sn = seen && typeof seen === 'object' ? seen : {};
  for (const tip of TIPS) {
    if (tip.surface !== surface) continue;
    if (tip.role === 'commissioner' && !isComm) continue;
    if (Number(sn[tip.id]) >= tip.v) continue;
    if (tip.whenState === 'open' && weekClass !== 'open') continue;
    if (tip.whenState === 'live' && weekClass !== 'live') continue;
    if (tip.whenState === 'final' && !(hasFinalWeek || weekClass === 'final')) continue;
    return tip;
  }
  return null;
}

/** The tips a person can read again (Tips & Help): every tip for their role, with whether it has been seen. A commissioner-only tip is listed only for a commissioner (DI-738). */
export function rereadList({ role = 'player', seen = {} } = {}) {
  const isComm = role === 'commissioner';
  const sn = seen && typeof seen === 'object' ? seen : {};
  return TIPS.filter((x) => x.role !== 'commissioner' || isComm).map((x) => ({ id: x.id, topic: x.topic, copy: x.copy, seen: Number(sn[x.id]) >= x.v }));
}

// ═══ GETTING STARTED ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

export const GS_COPY = Object.freeze({
  memberTitle: (league) => `Getting started${league ? ` in ${league}` : ''}`,
  commissionerTitle: (league) => `Set up ${league || 'your league'}`,
  progress: (done, total) => `${done} of ${total}`,
  hide: 'Hide',
  show: 'Show',
  waiting: 'Waiting for your commissioner',
  member: Object.freeze({ join: (l) => `Join ${l || 'your league'}`, profile: 'Set up your profile', picks: 'Make your first picks', remind: 'Get a reminder before picks lock', remindSub: 'Turn on notifications', remindAct: 'Turn on' }),
  commissioner: Object.freeze({ create: 'Create your league', invite: 'Invite friends', inviteAct: 'Invite', joined: (n) => `${n} joined so far`, week: 'Set up your first week', weekSub: 'Pick a sport, then the games', weekAct: 'Start',
    open: 'Open picks for your friends', openSub: 'They get a reminder when it opens', openAct: 'Open' }),
});

/**
 * The Getting started rows from FACTS (never self-reported). `role` 'member' | 'commissioner'. For a member: `joined`, `profileSaved`, `pickSubmitted`, `weekClass` (of the league the card is for),
 * `pushOn`, `pickSub` (a finished line for the pick row: "Weekend Crew · CFB · locks Sat 11:00 AM"). For a commissioner: `memberCount` (people in the league, the commissioner included), `weekExists`,
 * `gamesOnSlate`, `weekOpen`. Returns `{ rows: [{ id, label, sub, done, waiting, action }], done, total, complete }`; at most four rows (DI-735).
 */
export function gettingStarted({ role = 'member', leagueName = '', facts = {} } = {}) {
  const f = facts && typeof facts === 'object' ? facts : {};
  const rows = [];
  if (role === 'commissioner') {
    const C = GS_COPY.commissioner;
    const others = Math.max(0, Math.floor(Number(f.memberCount) || 0) - 1);
    rows.push({ id: 'create', label: C.create, sub: '', done: true, waiting: false, action: '' });
    rows.push({ id: 'invite', label: C.invite, sub: others > 0 ? C.joined(others) : '', done: others >= 1, waiting: false, action: others >= 1 ? '' : 'ob-invite', actionLabel: C.inviteAct });
    rows.push({ id: 'week', label: C.week, sub: C.weekSub, done: f.weekExists === true && f.gamesOnSlate === true, waiting: false, action: f.weekExists === true && f.gamesOnSlate === true ? '' : 'ob-setup-week', actionLabel: C.weekAct });
    rows.push({ id: 'open', label: C.open, sub: C.openSub, done: f.weekOpen === true, waiting: false, action: f.weekOpen === true ? '' : 'ob-open-picks', actionLabel: C.openAct });
  } else {
    const M = GS_COPY.member;
    const open = f.weekClass === 'open';
    rows.push({ id: 'join', label: M.join(leagueName), sub: '', done: f.joined !== false, waiting: false, action: '' });
    rows.push({ id: 'profile', label: M.profile, sub: '', done: f.profileSaved === true, waiting: false, action: f.profileSaved === true ? '' : 'ob-about' });
    const pickDone = f.pickSubmitted === true;
    rows.push({ id: 'picks', label: M.picks, sub: pickDone ? '' : (open ? String(f.pickSub || '') : ''), done: pickDone, waiting: !pickDone && !open, action: pickDone || !open ? '' : 'ob-picks', actionLabel: 'Picks' });
    rows.push({ id: 'remind', label: M.remind, sub: M.remindSub, done: f.pushOn === true, waiting: false, action: f.pushOn === true ? '' : 'ob-push', actionLabel: M.remindAct });
  }
  const done = rows.filter((r) => r.done).length;
  return { rows, done, total: rows.length, complete: done === rows.length };
}

/**
 * Whether the card shows, and how: 'none' (a master switch off, the store unavailable, or complete), 'collapsed' (the person hid it: one 52 px row) or 'full'. The card removes itself once its OTHER rows
 * are done and the pick row is done or the person has hidden it (DI-1009): a league that never opens a week must not leave a card forever.
 */
export function gettingStartedState({ model, hidden = false, off = false, available = true } = {}) {
  if (!available || off || !model || !Array.isArray(model.rows)) return 'none';
  const others = model.rows.filter((r) => r.id !== 'picks');
  const pick = model.rows.find((r) => r.id === 'picks');
  if (others.every((r) => r.done) && (!pick || pick.done || hidden)) return 'none';
  return hidden ? 'collapsed' : 'full';
}

// ═══ FIRST PICKS (DI-800, DI-1008) ═════════════════════════════════════════════════════════════════════════════════════════════════════════

export const FIRST_PICKS_COPY = Object.freeze({
  title: 'Your first picks',
  noWeek: "Picks open when your commissioner opens the week. We'll tell you when it opens. You can finish setting up now.",
  remind: 'Remind me when picks open',
  open: (week, league) => `Week ${week} is open in ${league}.`,
  openSub: (sport, locks) => `${sport}${locks ? ` · locks ${locks}` : ''}`,
  locked: (week) => `Week ${week} has locked. You can make picks for the next week once your commissioner opens it.`,
  makePicks: 'Make My Picks',
  notNow: 'Not Now',
  done: 'Done',
});

/**
 * The first-picks step's state: `{ state: 'hidden' | 'no-week' | 'open' | 'locked', ... }` from the league the person just joined or created (or is viewing). `league` is the name or null (no league: the step is
 * not shown). `weeks` is `[{ number, status, sport, locksText }]` with EFFECTIVE statuses. An Open week (in any sport) is shown first; Locked or Live reads as locked; Draft and Final with nothing newer read
 * as "no open week" (DI-1008). Nothing here reads a pick: the copy carries no pick and no count (blind rule).
 */
export function firstPicks({ league = null, weeks = [] } = {}) {
  if (!league) return { state: 'hidden' };
  const list = (Array.isArray(weeks) ? weeks : []).filter((w) => w && typeof w === 'object');
  const open = list.find((w) => String(w.status).toLowerCase() === 'open');
  if (open) return { state: 'open', week: open.number, sport: open.sport || '', locksText: open.locksText || '', league };
  const locked = list.find((w) => ['locked', 'live'].includes(String(w.status).toLowerCase()));
  if (locked) return { state: 'locked', week: locked.number, league };
  return { state: 'no-week', league };
}
