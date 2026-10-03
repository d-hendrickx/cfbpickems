/**
 * CFB Pickems — leaguecreatetest.mjs
 * ===================================
 * N1 league creation, DI-430 (the New League flow), DI-433 (the release gate's client half), thread "091926-MULTISPORT", 2026-09-30.
 * A focused standalone suite beside loadtest.mjs (the grouptest.mjs / leagueshometest.mjs precedent): the PURE half of the flow — js/league-create.js, js/league-defaults.js,
 * js/pilot-only.js — proven here without booting the app. The half that needs app.js's DOM wiring (the landing's claim screen, the sheet driven through its real handlers)
 * is authtest.mjs [80], which owns the fake-DOM harness those need.
 *
 * Run:  node leaguecreatetest.mjs
 *
 * NOT covered here (say so plainly): gestures, haptics, scroll physics, the on-screen keyboard, the native share sheet and Reduce Motion are properties of a real device and are
 * outside every automated test. The Polish-pass list Drew walks on a phone is in the build report; this suite proves the copy, the state machine, the codes, the pending
 * invite (including the REAL first-sign-in sweep), the gate's default, the twin with migration 0034 and the source tripwires.
 */

import { readFileSync } from 'node:fs';

let pass = 0, fail = 0;
const assert = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label, extra ? `\n     ${extra}` : ''); }
};

// ── a real-enough Storage, for the pending invite and for auth.js's device sweep ───────────────────────────────────────────────────────────────
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: (i) => [...store.keys()][i] ?? null,
};
globalThis.window = globalThis;
globalThis.location = { href: 'https://irbfootball.com/', origin: 'https://irbfootball.com', pathname: '/', search: '', hash: '' };
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
  body: { classList: { add() {}, remove() {} }, appendChild() {}, dataset: {} }, hidden: false,
};

const LC = await import('./js/league-create.js');
const { NEW_LEAGUE_DEFAULTS, NEW_LEAGUE_ON_ROWS, NEW_LEAGUE_SPORT_KINDS, NEW_LEAGUE_NAME_MAX, NEW_LEAGUE_MAX_SPORTS, newLeagueOnRows } = await import('./js/league-defaults.js');
const PO = await import('./js/pilot-only.js');
const src = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');
const stripComments = (raw) => raw.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '$1')).join('\n');
// A faithful escHtml (the app's own shape): & < > " '
const escHtml = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const icon = (name) => `<svg data-icon="${name}"></svg>`;
const deps = { escHtml, icon };

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[1] The copy — DI-430\'s words, verbatim, in one frozen table…');
{
  const C = LC.LC_COPY;
  assert(Object.isFrozen(C), '[1a] LC_COPY is frozen — the mockup\'s words are asserted once, here, and cannot drift at a call site');
  const want = {
    title: 'New League', namePlaceholder: 'e.g. Saturday Crew', nameHelper: 'Your friends will see this name. You can change it later.',
    seasons: 'Seasons', tournaments: 'Tournaments',
    sportsHelper: 'Pick at least one season. Tournaments are optional. You can add more any time from your league page.',
    create: 'Create League', creating: 'Creating…', stillWorking: 'Still working…', tryAgain: 'Try Again',
    failed: "Couldn't create the league. Nothing was saved — check your connection and try again.",
    limit: "You've reached the limit for new leagues right now. Try again tomorrow.",
    paused: "New leagues aren't being created right now — check back soon.",
    invalidLink: 'That invite link has expired. Ask whoever invited you to send it again.',
    commissionerLine: "You're the commissioner.", onHeading: 'Already on for your league', onHelper: 'Change any of this later in Comm.',
    inviteFriends: 'Invite Friends', notNow: 'Not Now', copyCode: 'Copy Code', codeCopied: 'Code copied', shareInvite: 'Share Invite', linkCopied: 'Invite link copied',
    discardTitle: 'Discard new league?', discard: 'Discard', keepEditing: 'Keep Editing',
    landingClosed: "Creating leagues isn't available yet — it's coming in a future update.",
    segClaim: 'I have a claim code', segInvite: 'I have an invite code',
    inviteLinkNote: 'You opened an invite link. Check the code, then tap Join League.', claimInstead: 'I have a claim code instead',
  };
  for (const [k, v] of Object.entries(want)) assert(C[k] === v, `[1b] LC_COPY.${k} = ${JSON.stringify(v)}`);
  assert(LC.readyTitle('Weekend Crew') === 'Weekend Crew is ready', '[1c] "{name} is ready"');
  assert(LC.refreshFailedCopy('Weekend Crew') === "Weekend Crew was created, but this device couldn't load it.", '[1d] the frame-13 copy (R-F4: no "Pull down to refresh." — that gesture does nothing under the overlay; the banner carries a Try Again button instead)');
  assert(C.tryAgain === 'Try Again' && C.retrying === 'Trying…', '[1d2] R-F4: the banner button reads "Try Again" and its busy label "Trying…"');
  assert(!/Pull down/i.test(JSON.stringify(C)) && !/Pull down/i.test(stripComments(src('./js/league-create.js'))), '[1d3] R-F4: no "Pull down" instruction survives in the copy table or the renderers');
  {
    const withAction = LC.bannerHTML('err', 'x', { escHtml: (s) => String(s), icon: () => '', cta: { id: 'leagues-notice-retry', label: 'Try Again' } });
    const without = LC.bannerHTML('err', 'x', { escHtml: (s) => String(s), icon: () => '' });
    assert(/<button type="button" class="lc-banner-action" id="leagues-notice-retry">Try Again<\/button>/.test(withAction) && !/<button/.test(without), '[1d4] R-F4: a banner renders its action button only when one is given (every other banner is unchanged)');
  }
  // The paused copy is the shipped signups-closed line, ONE string (app.js's SIGNUPS_CLOSED_COPY) — pinned against the source so neither can drift alone.
  const appSrc = src('./js/app.js');
  const sc = (appSrc.match(/const SIGNUPS_CLOSED_COPY = "([^"]+)";/) || [])[1];
  assert(sc === C.paused, `[1e] LC_COPY.paused equals app.js's SIGNUPS_CLOSED_COPY ("${sc}") — frame 10 reuses the shipped line word for word`);
  assert(/createLeague: comingSoonCopy\('Creating additional leagues'\)/.test(src('./js/leagues-home.js')), '[1f] the gate-CLOSED stub copy source is untouched ("Creating additional leagues isn\'t available yet — …")');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[2] The invite code — one normalizer, one link, one message…');
{
  for (const raw of ['K7QX 9M2P', 'k7qx-9m2p', 'K7QX9M2P', '  k7qx  9m2p  ', 'K7QX-9M2P']) {
    assert(LC.normalizeInviteCode(raw) === 'K7QX9M2P', `[2a] ${JSON.stringify(raw)} normalizes to K7QX9M2P`);
  }
  for (const bad of ['', null, undefined, 'K7QX9M2', 'K7QX9M2PP', 'K7QX 9M21', 'K7QX 9M2O0', 'K7Q!9M2P', '<script>', 12345678]) {
    assert(LC.normalizeInviteCode(bad) === '', `[2b] ${JSON.stringify(bad)} is not a code ('' — the alphabet is A-Z and 2-9, exactly 8 characters)`);
  }
  assert(LC.formatInviteCode('K7QX9M2P') === 'K7QX 9M2P' && LC.formatInviteCode('k7qx-9m2p') === 'K7QX 9M2P', '[2c] shown 4+4');
  assert(LC.formatInviteCode('nope') === 'nope' && LC.formatInviteCode(null) === '', '[2d] a non-code is returned as given (never invented)');
  assert(LC.inviteLink('k7qx 9m2p') === 'https://irbfootball.com/?join=K7QX9M2P', '[2e] the link is https://irbfootball.com/?join=CODE (8 characters, no space)');
  assert(LC.inviteLink('nope') === '', '[2f] no link for a non-code');
  const msg = LC.inviteMessage({ leagueName: 'Weekend Crew', code: 'K7QX9M2P' });
  assert(msg.includes('Weekend Crew') && msg.includes('https://irbfootball.com/?join=K7QX9M2P') && msg.includes('K7QX 9M2P'), '[2g] the share message carries the league name, the link AND the code');
  assert(LC.inviteMessage({ leagueName: 'x', code: 'bad' }) === '', '[2h] no message for a bad code');
  assert(LC.JOIN_CODE_RE.source === '^[A-Z2-9]{8}$', '[2i] the code shape is the DI\'s /^[A-Z2-9]{8}$/');
  // The server alphabet, read from the migration: leagues.join_code CHECK.
  const m1 = src('./supabase/migrations/0001_schema.sql');
  assert(/join_code[^\n]*check[^\n]*\[A-Z2-9\]\{8\}/i.test(m1) || /\[A-Z2-9\]\{8\}/.test(m1), '[2j] fixture: the client alphabet is the leagues.join_code CHECK\'s own (0001)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[3] The step state machine…');
{
  const groups = { season: [{ key: 'cfb', label: 'College Football', glyphKey: 'sportFootball' }, { key: 'nfl', label: 'NFL', glyphKey: 'sportFootball' }, { key: 'nba', label: 'NBA', glyphKey: 'sportBasketball' }],
    tournament: [{ key: 'mm', label: 'March Madness', glyphKey: 'trophy' }] };
  let s = LC.createInitialState({ groups });
  assert(s.step === 'name' && s.phase === 'idle' && s.name === '' && s.ticked.length === 0, '[3a] starts on the name step, empty, idle');
  assert(!LC.canAdvance(s) && LC.reduce(s, { type: 'next' }) === s, '[3b] Next is inert with an empty name (frame 12: dimmed, no red text)');
  s = LC.reduce(s, { type: 'name', value: '     ' });
  assert(!LC.nameValid(s.name) && !LC.canAdvance(s), '[3c] a name of only spaces is NOT a name');
  s = LC.reduce(s, { type: 'name', value: 'x'.repeat(200) });
  assert(s.name.length === NEW_LEAGUE_NAME_MAX, `[3d] typing is capped at ${NEW_LEAGUE_NAME_MAX} (the server\'s own limit) — no length error is ever needed`);
  s = LC.reduce(s, { type: 'name', value: '  Weekend Crew ' });
  assert(LC.canAdvance(s), '[3e] a real name opens Next');
  s = LC.reduce(s, { type: 'next' });
  assert(s.step === 'sports', '[3f] Next → the sports step');
  assert(!LC.canCreate(s), '[3g] Create is DISABLED with nothing ticked');
  s = LC.reduce(s, { type: 'toggle', key: 'mm' });
  assert(LC.mainSport(s) === '' && !LC.canCreate(s), '[3h] a tournament alone is not enough — Create needs at least one SEASON (S-3), and a tournament is never Main');
  s = LC.reduce(s, { type: 'toggle', key: 'nfl' });
  s = LC.reduce(s, { type: 'toggle', key: 'cfb' });
  assert(LC.mainSport(s) === 'nfl' && LC.canCreate(s), '[3i] Main is the FIRST ticked season in tick order (nfl, ticked before cfb) — the server\'s rule');
  assert(JSON.stringify(LC.sportsPayload(s)) === JSON.stringify(['mm', 'nfl', 'cfb']), '[3j] the payload is the tick order, verbatim');
  s = LC.reduce(s, { type: 'toggle', key: 'nfl' });
  assert(LC.mainSport(s) === 'cfb', '[3k] unticking Main promotes the next ticked season');
  s = LC.reduce(s, { type: 'toggle', key: 'nfl' });
  let big = LC.reduce(LC.createInitialState({ groups }), { type: 'name', value: 'x' }); big = LC.reduce(big, { type: 'next' });
  const many = { ...big, seasonKeys: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] };
  let t = many; for (const k of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) t = LC.reduce(t, { type: 'toggle', key: k });
  assert(t.ticked.length === NEW_LEAGUE_MAX_SPORTS, `[3l] at most ${NEW_LEAGUE_MAX_SPORTS} sports (create_league's c_max_sports); the eighth tick is ignored`);
  // Creating: everything that could abandon or change the create is off.
  const creating = LC.reduce(s, { type: 'creating' });
  assert(LC.isBusy(creating) && !LC.canCreate(creating), '[3m] creating: busy, and Create cannot fire twice');
  assert(LC.reduce(creating, { type: 'back' }) === creating, '[3n] …Back is off while creating (frame 7)');
  assert(LC.reduce(creating, { type: 'toggle', key: 'nba' }) === creating, '[3o] …the rows stop taking taps');
  assert(LC.dismissMode(creating) === 'blocked' && LC.reduce(creating, { type: 'askDiscard' }) === creating, '[3p] …and swipe-down / Cancel / Esc / the backdrop cannot abandon a half-finished create');
  assert(LC.reduce(s, { type: 'slow' }) === s, '[3q] "Still working…" only applies while creating');
  const slow = LC.reduce(creating, { type: 'slow' });
  assert(slow.slow === true, '[3r] past 8 seconds the state says so');
  // Failure keeps the input.
  const failed = LC.reduce(slow, { type: 'failed' });
  assert(failed.phase === 'failed' && failed.name === s.name && JSON.stringify(failed.ticked) === JSON.stringify(s.ticked) && failed.slow === false, '[3s] failed: red banner state, the name and the ticks are KEPT (frame 8)');
  assert(LC.canCreate(failed), '[3t] …and Try Again is possible');
  // Limit.
  const limited = LC.reduce(creating, { type: 'limit' });
  assert(limited.phase === 'limit' && !LC.canCreate(limited), '[3u] limit: a refusal, the primary becomes Done (frame 9) — Create is off');
  // Paused: back to the name step.
  const paused = LC.reduce(creating, { type: 'paused' });
  assert(paused.step === 'name' && paused.phase === 'paused' && !LC.canAdvance(paused), '[3v] paused: the sheet returns to the name step, field and Next disabled (frame 10)');
  const pausedStart = LC.createInitialState({ signupsOpen: false, groups });
  assert(pausedStart.phase === 'paused' && !LC.canAdvance(LC.reduce(pausedStart, { type: 'name', value: 'x' })), '[3w] signups_open false opens the sheet already paused (client courtesy; the server is the authority)');
  // Created / invite / discard.
  const created = LC.reduce(creating, { type: 'created', created: { leagueId: 'L1', name: 'Weekend Crew', code: '' } });
  assert(created.step === 'created' && created.phase === 'idle' && created.created.leagueId === 'L1', '[3x] created → the Created screen (success is a screen, not a toast)');
  assert(LC.dismissMode(created) === 'close', '[3y] once the league exists every dismissal is a plain close — never a "discard" of a league that already exists');
  assert(LC.reduce(created, { type: 'invite' }).step === 'invite', '[3z] Invite Friends → the Invite step');
  const withCode = LC.reduce(created, { type: 'code', code: 'K7QX9M2P' });
  assert(withCode.created.code === 'K7QX9M2P', '[3aa] the code arrives into the created record');
  assert(LC.reduce(LC.createInitialState({ groups }), { type: 'invite' }).step === 'name', '[3ab] Invite is unreachable before a league exists');
  const typed = LC.reduce(LC.createInitialState({ groups }), { type: 'name', value: 'a' });
  assert(LC.dismissMode(LC.createInitialState({ groups })) === 'close', '[3ac] nothing entered → dismiss immediately');
  assert(LC.dismissMode(typed) === 'confirm', '[3ad] a typed name → the discard question');
  assert(LC.dismissMode(LC.reduce(LC.createInitialState({ groups }), { type: 'toggle', key: 'cfb' })) === 'close', '[3ae] (ticks are only reachable on the sports step, which needs a name first)');
  const asking = LC.reduce(typed, { type: 'askDiscard' });
  assert(asking.discardPrompt === true && LC.reduce(asking, { type: 'keepEditing' }).discardPrompt === false, '[3af] discard: ask, then Keep Editing puts the input back');
  assert(LC.reduce(LC.createInitialState({ groups }), { type: 'askDiscard' }).discardPrompt === false, '[3ag] with nothing entered there is nothing to ask about');
  assert(LC.reduce(s, { type: 'nonsense' }) === s && LC.reduce(s, null) === s, '[3ah] an unknown action changes nothing');
  const inv = LC.createInviteState({ leagueId: 'L9', name: 'Old League', code: '' });
  assert(inv.step === 'invite' && inv.created.leagueId === 'L9' && LC.dismissMode(inv) === 'close', '[3ai] the sheet can open straight on the Invite step for a league that already exists (frame 6)');
  // Pure: the reducer never mutates its input.
  const frozen = Object.freeze({ ...s, ticked: Object.freeze([...s.ticked]) });
  let threw = false; try { LC.reduce(frozen, { type: 'toggle', key: 'nba' }); } catch { threw = true; }
  assert(!threw, '[3aj] the reducer is pure (a frozen state does not throw)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[4] Error mapping, and the picker (registry ∩ offered)…');
{
  const k = LC.createErrorKind;
  assert(k(new Error('creation_closed')) === 'paused' && k(new Error('P0001: signups_closed')) === 'paused', '[4a] the gate / the emergency valve → the paused look (frame 10)');
  for (const m of ['league_limit', 'creation_rate', 'creation_paused', 'P0001: league_limit']) assert(k(new Error(m)) === 'limit', `[4b] ${m} → the ONE limit look (no cap disclosure)`);
  assert(k(Object.assign(new Error('x'), { name: 'LeagueCreatedNotLoadedError' })) === 'created_not_loaded', '[4c] a created-but-not-loaded league is its own outcome (frame 13), never a failure');
  for (const m of ['Failed to fetch', 'bad_sports', 'not_authenticated', 'something new']) assert(k(new TypeError(m)) === 'failed' && k(new Error(m)) === 'failed', `[4d] ${m} → failed (an unrecognised message is never something reassuring)`);
  assert(k(null) === 'failed' && k(undefined) === 'failed', '[4e] no error object → failed');
  // Picker
  const profiles = (await import('./js/sports/index.js')).listProfiles();
  const g = LC.pickerGroups({ profiles, offered: ['cfb', 'nfl'] });
  assert(JSON.stringify(g.season.map((r) => r.key)) === JSON.stringify(['cfb', 'nfl']) && g.tournament.length === 0, '[4f] today: College Football and NFL under Seasons, and NO Tournaments group at all');
  assert(g.season[0].label === 'College Football' && g.season[0].glyphKey === 'sportFootball', '[4g] the row carries the registry\'s own label and the family glyph');
  const g2 = LC.pickerGroups({ profiles, offered: ['cfb', 'nfl', 'nba', 'mm', 'wjc'] });
  assert(JSON.stringify(g2.season.map((r) => r.key)) === JSON.stringify(['cfb', 'nfl']) && g2.tournament.length === 0,
    '[4h] a sport offered by the platform but NOT registered in this build never appears (no "coming soon" rows): the picker is the INTERSECTION');
  assert(LC.pickerGroups({ profiles, offered: [] }).season.length === 0, '[4i] nothing offered → nothing shown');
  assert(LC.pickerGroups({ profiles: [], offered: ['cfb'] }).season.length === 0, '[4j] nothing registered → nothing shown');
  const fake = [{ key: 'nba', label: 'NBA' }, { key: 'mm', label: 'March Madness' }, { key: 'cfb', label: 'College Football' }, { key: 'nhl', label: 'NHL' }];
  const g3 = LC.pickerGroups({ profiles: fake, offered: ['mm', 'nba', 'cfb', 'nhl', 'zzz'] });
  assert(JSON.stringify(g3.season.map((r) => r.key)) === JSON.stringify(['cfb', 'nba', 'nhl']) && JSON.stringify(g3.tournament.map((r) => r.key)) === JSON.stringify(['mm']),
    '[4k] grouped by NEW_LEAGUE_SPORT_KINDS in that table\'s order (season: cfb, nfl, nba, cbb, nhl; tournament: mm, wjc); an unknown offered code is ignored');
  assert(g3.season.find((r) => r.key === 'nba').glyphKey === 'sportBasketball' && g3.season.find((r) => r.key === 'nhl').glyphKey === 'sportHockey' && g3.tournament[0].glyphKey === 'trophy',
    '[4l] basketball, hockey and cup glyphs come from the one icon family');
  const iconsSrc = src('./js/icons.js');
  for (const name of Object.values(LC.SPORT_GLYPH)) assert(new RegExp(`^  ${name}:`, 'm').test(iconsSrc), `[4m] the glyph "${name}" exists in js/icons.js`);
  assert(JSON.stringify(Object.keys(LC.SPORT_GLYPH).sort()) === JSON.stringify([...NEW_LEAGUE_SPORT_KINDS.season, ...NEW_LEAGUE_SPORT_KINDS.tournament].sort()), '[4n] every sport code the flow can offer has a glyph');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[5] The renderers — every frame, escaped, and refusing to run without escHtml…');
{
  const groups = { season: [{ key: 'cfb', label: 'College Football', glyphKey: 'sportFootball' }, { key: 'nfl', label: 'NFL', glyphKey: 'sportFootball' }], tournament: [] };
  const hostile = `<img src=x onerror="alert(1)">'&`;
  let s = LC.createInitialState({ groups });
  s = LC.reduce(s, { type: 'name', value: hostile });
  const nameHtml = LC.nameStepHTML(s, deps);
  assert(!/<img/.test(nameHtml) && nameHtml.includes('&lt;img'), '[5a] a hostile league name never reaches the field\'s value unescaped');
  assert(/id="league-create-name"[^>]*maxlength="80"/.test(nameHtml) && /enterkeyhint="next"/.test(nameHtml) && /placeholder="e\.g\. Saturday Crew"/.test(nameHtml), '[5b] the field: maxlength 80, Return reads Next, the neutral placeholder');
  assert(!/IRB/.test(nameHtml + LC.sportsStepHTML(s, groups, deps)), '[5c] no IRB string anywhere in the flow');
  assert(/data-lc-action="next"[^>]*disabled/.test(LC.nameStepHTML(LC.createInitialState({ groups }), deps)), '[5d] Next renders disabled on an empty name');
  let sp = LC.reduce(LC.reduce(LC.createInitialState({ groups }), { type: 'name', value: 'Crew' }), { type: 'next' });
  sp = LC.reduce(sp, { type: 'toggle', key: 'cfb' });
  const sportsHtml = LC.sportsStepHTML(sp, groups, deps);
  assert(/role="checkbox" aria-checked="true" aria-label="College Football, main, selected"/.test(sportsHtml), '[5e] VoiceOver: "College Football, main, selected"');
  assert(/aria-label="NFL, not selected"/.test(sportsHtml) && !/class="lc-sec">Tournaments</.test(sportsHtml) && /class="lc-sec">Seasons</.test(sportsHtml), '[5f] an unticked row reads "not selected", and there is no Tournaments SECTION when none is offered');
  assert(/class="lc-main-tag">Main</.test(sportsHtml) && (sportsHtml.match(/lc-main-tag/g) || []).length === 1, '[5g] exactly one Main tag, on the first ticked season');
  assert(/data-lc-action="create"/.test(sportsHtml) && !/data-lc-action="create"[^>]*disabled/.test(sportsHtml), '[5h] Create is live with a season ticked');
  assert(/data-lc-action="create"[^>]*disabled/.test(LC.sportsStepHTML(LC.reduce(LC.reduce(LC.createInitialState({ groups }), { type: 'name', value: 'Crew' }), { type: 'next' }), groups, deps)), '[5i] …and disabled with none');
  const busyHtml = LC.sportsStepHTML(LC.reduce(sp, { type: 'creating' }), groups, deps);
  assert(/lc-spin/.test(busyHtml) && busyHtml.includes('Creating…') && /aria-busy="true"/.test(busyHtml) && /lc-card-dim/.test(busyHtml) && !/data-lc-action="back"/.test(busyHtml), '[5j] frame 7: spinner in the button, rows dimmed, Back gone');
  assert(LC.sportsStepHTML(LC.reduce(LC.reduce(sp, { type: 'creating' }), { type: 'slow' }), groups, deps).includes('Still working…'), '[5k] "Still working…" at 8 seconds');
  const failedHtml = LC.sportsStepHTML(LC.reduce(sp, { type: 'failed' }), groups, deps);
  assert(/role="alert" data-lc-banner="err"/.test(failedHtml) && failedHtml.includes(escHtml(LC.LC_COPY.failed)) && failedHtml.includes('Try Again'), '[5l] frame 8: a red PERSISTENT alert banner with the DI\'s copy, and Try Again');
  const limitHtml = LC.sportsStepHTML(LC.reduce(sp, { type: 'limit' }), groups, deps);
  assert(/data-lc-banner="info"/.test(limitHtml) && limitHtml.includes(escHtml(LC.LC_COPY.limit)) && /data-lc-action="done-limit"/.test(limitHtml) && !/data-lc-action="create"/.test(limitHtml), '[5m] frame 9: a gold (not red) banner, and the primary is Done');
  const pausedHtml = LC.nameStepHTML(LC.createInitialState({ signupsOpen: false, groups }), deps);
  assert(pausedHtml.includes(escHtml(LC.LC_COPY.paused)) && /id="league-create-name"[^>]*disabled/.test(pausedHtml), '[5n] frame 10: the shipped signups copy, and the field disabled (not hidden)');
  const cs = LC.reduce(LC.reduce(sp, { type: 'creating' }), { type: 'created', created: { leagueId: 'L1', name: hostile, code: 'K7QX9M2P' } });
  const createdHtml = LC.createdStepHTML(cs, deps);
  assert(!/<img/.test(createdHtml) && createdHtml.includes('&lt;img') && createdHtml.includes('is ready') && createdHtml.includes("You&#39;re the commissioner."), '[5o] frame 4: the league name is escaped; "{name} is ready" / "You\'re the commissioner."');
  const rows = [...createdHtml.matchAll(/data-lc-on="([a-z]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify(rows) === JSON.stringify(['scores', 'reminders', 'push', 'scribe', 'golive']), '[5p] the five "already on" rows, in order');
  for (const t of ['Live scores update automatically', 'Reminders before picks lock', 'Push notifications for everyone', 'SCRIBE is on (Dry, Balanced)', 'Weeks go live at kickoff']) {
    assert(createdHtml.includes(escHtml(t)), `[5q] frame 4 row: ${t}`);
  }
  // A row for a switch the server did not seed must NOT render (never a claim the server did not make).
  const off = structuredClone(NEW_LEAGUE_DEFAULTS); off.serverJobs.reminders = false;
  assert(!LC.createdStepHTML(cs, { ...deps, defaults: off }).includes('Reminders before picks lock'), '[5r] a row renders only when the defaults it is drawn from turn its switch ON');
  assert(/Invite Friends/.test(createdHtml) && /Not Now/.test(createdHtml), '[5s] Invite Friends / Not Now');
  const inviteHtml = LC.inviteStepHTML(LC.reduce(cs, { type: 'invite' }), deps);
  assert(inviteHtml.includes('K7QX 9M2P') && /data-lc-action="copy-code"/.test(inviteHtml) && /data-lc-action="share"/.test(inviteHtml), '[5t] frame 5: the code shown 4+4, Copy Code, Share Invite');
  assert(inviteHtml.includes(escHtml(LC.LC_COPY.inviteHelper)), '[5u] frame 5 helper copy');
  assert(/data-lc-action="copy-code" disabled|data-lc-action="copy-code"[^>]*disabled/.test(LC.inviteStepHTML(LC.createInviteState({ leagueId: 'L', name: 'n' }), deps)) && /aria-busy="true"/.test(LC.inviteStepHTML(LC.createInviteState({ leagueId: 'L', name: 'n' }), deps)),
    '[5v] before the code has arrived the buttons are disabled and the code reads as busy (never an empty copy)');
  const discard = LC.discardSheetHTML({ escHtml });
  assert(/role="alertdialog"/.test(discard) && discard.includes('Discard new league?') && /lc-as-danger[^>]*>Discard</.test(discard) && /lc-as-bold[^>]*>Keep Editing</.test(discard), '[5w] frame 11: title, destructive Discard, bold Keep Editing');
  const nav = (st) => LC.navBarHTML(st, deps);
  assert(/data-lc-action="cancel"[^>]*>Cancel</.test(nav(LC.createInitialState({ groups }))) && /data-lc-action="next"/.test(nav(LC.createInitialState({ groups }))), '[5x] name step nav: Cancel / New League / Next');
  assert(/data-lc-action="back"/.test(nav(sp)) && /Name/.test(nav(sp)) && /data-icon="chevronLeft"/.test(nav(sp)), '[5y] sports step nav: a back chevron labelled Name');
  assert(/data-lc-action="back"[^>]*disabled/.test(nav(LC.reduce(sp, { type: 'creating' }))), '[5z] …disabled while creating');
  assert(/data-lc-action="done"/.test(nav(LC.reduce(cs, { type: 'invite' }))) && !/data-lc-action="cancel"/.test(nav(cs)), '[5aa] Created has NO nav buttons; Invite has Done');
  assert(!/lc-web-close/.test(nav(cs)) && /lc-web-close/.test(nav(LC.createInitialState({ groups }))), '[5ab] the web close appears only while nothing has been created');
  // Entry points
  const entry = LC.entryCardHTML({ escHtml, icon });
  assert(/data-action="create-league"/.test(entry) && /data-icon="plus"/.test(entry) && entry.includes('Create new league') && !/data-action="coming-soon"/.test(entry), '[5ac] the OPEN entry card: create-league action, the plus icon, "Create new league"');
  const closedLanding = LC.landingCreateCardHTML({ open: false, escHtml });
  assert(/id="league-create-open-btn"[^>]*disabled/.test(closedLanding) && closedLanding.includes(escHtml(LC.LC_COPY.landingClosed)) && !/data-action="create-league"/.test(closedLanding), '[5ad] the landing card with the gate CLOSED: disabled + "Creating leagues isn\'t available yet — …", no action');
  const openLanding = LC.landingCreateCardHTML({ open: true, escHtml });
  assert(/data-action="create-league"/.test(openLanding) && !/disabled/.test(openLanding), '[5ae] …open: an enabled entry button');
  assert(/disabled/.test(LC.landingCreateCardHTML({ open: true, signupsOpen: false, escHtml })), '[5af] …and disabled again when signups_open is false');
  const segs = LC.landingSegmentsHTML({ mode: 'claim', escHtml });
  assert(/role="tablist"/.test(segs) && segs.includes('I have a claim code') && segs.includes('I have an invite code') && /lc-seg-on" role="tab" aria-selected="true" data-lc-seg="claim"/.test(segs), '[5ag] S-9: two segments, the active one marked');
  const createEntry = LC.claimCreateEntryHTML({ escHtml });
  assert(/id="link-create-league-btn" data-action="create-league"/.test(createEntry) && createEntry.includes('>Create a league<') && !/disabled/.test(createEntry) && LC.LC_COPY.createChoice === 'Create a league',
    '[5ai] the zero-membership landing\'s THIRD choice: "Create a league", an enabled create-league entry (the caller renders it only while the gate is open — hidden, never disabled)');
  // Every renderer refuses to run without an injected escHtml (CONVENTIONS #12).
  const renderers = {
    navBarHTML: () => LC.navBarHTML(s, {}), bannerHTML: () => LC.bannerHTML('err', 'x', {}), phaseBannerHTML: () => LC.phaseBannerHTML(s, {}),
    nameStepHTML: () => LC.nameStepHTML(s, {}), sportsStepHTML: () => LC.sportsStepHTML(sp, groups, {}), createdStepHTML: () => LC.createdStepHTML(cs, {}),
    inviteStepHTML: () => LC.inviteStepHTML(cs, {}), discardSheetHTML: () => LC.discardSheetHTML({}), entryCardHTML: () => LC.entryCardHTML({}),
    landingCreateCardHTML: () => LC.landingCreateCardHTML({}), landingSegmentsHTML: () => LC.landingSegmentsHTML({}), inviteLinkNoteHTML: () => LC.inviteLinkNoteHTML({}),
    claimInsteadHTML: () => LC.claimInsteadHTML({}), claimCreateEntryHTML: () => LC.claimCreateEntryHTML({}),
  };
  for (const [name, fn] of Object.entries(renderers)) {
    let e = null; try { fn(); } catch (err) { e = err; }
    assert(e instanceof TypeError && /escHtml/.test(e.message), `[5ah] ${name}() throws without an injected escHtml`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[6] The twin with migration 0034, and the release gate\'s default…');
{
  const mig = src('./supabase/migrations/0034_league_creation.sql');
  const lit = (mig.match(/c_new_league_defaults constant jsonb := '([^']+)'::jsonb;/) || [])[1];
  assert(!!lit, '[6a] fixture: the migration\'s c_new_league_defaults literal was located');
  assert(JSON.stringify(sortKeys(JSON.parse(lit))) === JSON.stringify(sortKeys(NEW_LEAGUE_DEFAULTS)),
    '[6b] TWIN: js/league-defaults.js NEW_LEAGUE_DEFAULTS deep-equals the migration\'s literal (frame 4 can never claim a switch the server did not seed)');
  function sortKeys(o) { return Array.isArray(o) ? o.map(sortKeys) : (o && typeof o === 'object') ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o; }
  const seasons = (mig.match(/c_seasons\s+constant text\[\] := array\[([^\]]+)\]/) || [])[1]?.split(',').map((x) => x.trim().replace(/'/g, ''));
  assert(JSON.stringify(seasons) === JSON.stringify(NEW_LEAGUE_SPORT_KINDS.season), '[6c] TWIN: the season group equals create_league\'s c_seasons');
  assert(Number((mig.match(/c_max_sports\s+constant integer := (\d+)/) || [])[1]) === NEW_LEAGUE_MAX_SPORTS, '[6d] TWIN: the picker cap equals c_max_sports');
  assert(/length\(v_name\) > 80|between 1 and 80/.test(mig) || /char_length\(v_name\)/.test(mig) || /80/.test(mig), '[6e] fixture: the migration bounds the name at 80');
  assert(Object.isFrozen(NEW_LEAGUE_DEFAULTS) && Object.isFrozen(NEW_LEAGUE_DEFAULTS.serverJobs) && Object.isFrozen(NEW_LEAGUE_ON_ROWS), '[6f] the defaults are deep-frozen');
  assert(!('trainer' in NEW_LEAGUE_DEFAULTS.serverJobs) && !('scribeLearn' in NEW_LEAGUE_DEFAULTS.serverJobs) && !('pilot' in NEW_LEAGUE_DEFAULTS), '[6g] pilot-only switches are never seeded');
  assert(newLeagueOnRows(null).length === 1 && newLeagueOnRows({}).length === 1 && newLeagueOnRows({})[0].id === 'golive',
    '[6h] a malformed defaults object claims nothing a switch would have to back — only the by-construction "weeks go live" row can stand without one');
  // Frame 4's SCRIBE row states the CODE defaults in words.
  const dm = await import('./js/data-model.js');
  const scribeRow = NEW_LEAGUE_ON_ROWS.find((r) => r.id === 'scribe').text.toLowerCase();
  assert(scribeRow.includes(dm.SCRIBE_HEAT_DEFAULT) && scribeRow.includes(dm.SCRIBE_FREQUENCY_DEFAULT), `[6i] the SCRIBE row's words ("Dry, Balanced") equal the code defaults (${dm.SCRIBE_HEAT_DEFAULT}, ${dm.SCRIBE_FREQUENCY_DEFAULT})`);

  // The gate: DEFAULT-WHEN-MISSING is CLOSED, the opposite of signups_open.
  const auth = await import('./js/auth.js');
  auth._resetMaintenanceBannerCacheForTest();
  assert(auth.getCachedLeagueCreationOpen() === false && auth.getCachedSignupsOpen() === true, '[6j] before any read: creation is CLOSED (false), signups OPEN (true) — deliberately opposite defaults');
  assert(JSON.stringify(auth.getCachedOfferedSports()) === '[]', '[6k] …and nothing is offered');
  const offered = auth.getCachedOfferedSports(); offered.push('cfb');
  assert(auth.getCachedOfferedSports().length === 0, '[6l] the offered list is a COPY (a caller cannot mutate the cache)');
  const authSrc = stripComments(src('./js/auth.js'));
  assert(/leagueCreationOpen: creationRaw === true/.test(authSrc) && /signupsOpen: signupsRaw === false \? false : true/.test(authSrc), '[6m] getPlatformKv(): creation reads TRUE only when the row is exactly true; signups reads TRUE unless exactly false');
  // Gate-closed markup = today's stub, byte for byte.
  const LH = await import('./js/leagues-home.js');
  const golden = LH.renderComingSoonCard({ title: '+ Create new league', copy: LH.COMING_SOON_COPY.createLeague, escHtml, extraClass: 'create-league-card' });
  assert(LH.renderCreateLeagueStubCard({ escHtml }) === golden && LH.renderCreateLeagueStubCard({ escHtml, icon, open: false }) === golden && LH.renderCreateLeagueStubCard({ escHtml, open: 'yes' }) === golden,
    '[6n] GOLDEN: with the gate closed (the default, and any non-true value) the card is the pre-change coming-soon stub, byte for byte');
  assert(/data-action="coming-soon"/.test(golden) && golden.includes(escHtml("Creating additional leagues isn't available yet — it's coming in a future update.")), '[6o] …carrying the DI-313 toast copy');
  // The FROZEN literal — captured from the pre-change build (renderComingSoonCard was not touched by N1). [6n] compares two calls of today's code; THIS pins the bytes themselves.
  const FROZEN_STUB = "<button type=\"button\" class=\"card coming-soon-card create-league-card\" data-action=\"coming-soon\" data-coming-soon-copy=\"Creating additional leagues isn't available yet — it's coming in a future update.\">\n      <span class=\"coming-soon-card-title\">+ Create new league</span>\n      \n    </button>";
  assert(LH.renderCreateLeagueStubCard({ escHtml: (s) => (s ? String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;') : '') }) === FROZEN_STUB,
    '[6o2] the gate-closed markup equals the FROZEN pre-change golden byte for byte (with the app\'s own escHtml)');
  const home = LH.renderLeaguesHome({ memberships: [], escHtml, icon, roleBadgeHTML: () => '' });
  assert(home.includes(golden), '[6p] Leagues Home with no gate argument renders the golden stub');
  assert(LH.renderLeaguesHome({ memberships: [], escHtml, icon, roleBadgeHTML: () => '', createOpen: true }).includes('data-action="create-league"'), '[6q] …and the open gate swaps in the real card');
  assert(LH.renderLeaguesHome({ memberships: [], escHtml, icon, roleBadgeHTML: () => '', notice: '<div id="n">x</div>' }).includes('<div id="n">x</div>'), '[6r] frame 13\'s notice slot renders above the list');
  // League Page empty state
  const lp = (slateEmpty, isCommissioner) => LH.renderLeaguePage({ leagueId: 'L', leagueName: 'Crew' }, { isCommissioner, slateEmpty, sports: [{ key: 'college-football', label: 'College Football' }], escHtml, icon });
  assert(/league-setup-first-week/.test(lp('commissioner', true)) && /No picks to make yet/.test(lp('commissioner', true)) && /Set up your first week to open picks for your league\./.test(lp('commissioner', true)) && /league-invite-friends/.test(lp('commissioner', true)), '[6s] frame 6, commissioner: "No picks to make yet" / "Set up your first week…" + Set up first week + Invite Friends');
  assert(/Your commissioner hasn&#39;t opened a week yet\.|Your commissioner hasn't opened a week yet\./.test(lp('player', false)) && !/<button[^>]*league-setup-first-week/.test(lp('player', false)), '[6t] frame 6, player: one sentence and NO button');
  assert(lp(null, true) === lp(undefined, true) && !/league-page-empty/.test(lp(null, true)), '[6u] with a slate (null) League Page is today\'s markup');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[7] cfbp_pending_join — capture, scrub, expiry, forged values, consumed once…');
{
  const KEY = LC.PENDING_JOIN_KEY;
  assert(KEY === 'cfbp_pending_join' && LC.PENDING_JOIN_TTL_MS === 30 * 60 * 1000, '[7a] the key and the 30-minute TTL');
  const T0 = 1_800_000_000_000;
  let replaced = null;
  const cap = (href, now = T0) => { store.clear(); replaced = null; return LC.capturePendingJoin({ href, now, replaceState: (u) => { replaced = u; } }); };

  let r = cap('https://irbfootball.com/?join=k7qx9m2p');
  assert(r.state === 'stored' && r.code === 'K7QX9M2P', '[7b] ?join=k7qx9m2p is upper-cased, validated and stored');
  const rec = JSON.parse(store.get(KEY));
  assert(rec.code === 'K7QX9M2P' && rec.exp === T0 + 30 * 60 * 1000, '[7c] stored as {code, exp} with exp = now + 30 minutes');
  assert(replaced === '/', '[7d] the URL is scrubbed with replaceState: the join parameter is gone');
  r = cap('https://irbfootball.com/app?x=1&join=K7QX9M2P&y=2#frag');
  assert(replaced === '/app?x=1&y=2#frag', `[7e] ONLY the join parameter is removed — every other parameter and the hash survive (got ${JSON.stringify(replaced)})`);
  r = cap('https://irbfootball.com/?code=abc123&state=zzz');
  assert(r.state === 'none' && !store.has(KEY) && replaced === null, '[7f] a URL with no join parameter: nothing stored, nothing scrubbed (an OAuth return URL is left exactly alone)');
  for (const bad of ['?join=', '?join=SHORT', '?join=K7QX9M2P1', '?join=%3Cscript%3E', '?join=K7QX9M20', '?join=K7QX9M2!']) {
    r = cap(`https://irbfootball.com/${bad}`);
    assert(r.state === 'malformed' && r.code === '' && JSON.parse(store.get(KEY)).bad === true && replaced === '/', `[7g] ${bad} → stored as MALFORMED (loud later), scrubbed, never a usable code`);
  }
  for (const ok of ['?join=K7QX-9M2P', '?join=K7QX%209M2P', '?join=k7qx%209m2p%20']) {
    r = cap(`https://irbfootball.com/${ok}`);
    assert(r.state === 'stored' && r.code === 'K7QX9M2P', `[7g2] ${ok} is a valid code once normalized (a link that was wrapped or spaced in a message still works)`);
  }
  r = cap('https://irbfootball.com/?join=K7QX9M2P');
  assert(store.has(KEY) && replaced !== null, '[7h] the value is persisted before/with the scrub (a reload between the two cannot lose it)');

  // read/take
  store.clear(); store.set(KEY, JSON.stringify({ code: 'K7QX9M2P', exp: T0 + 1000 }));
  let g = LC.readPendingJoin({ now: T0 });
  assert(g.state === 'valid' && g.code === 'K7QX9M2P' && store.has(KEY), '[7i] read: valid, and NOT consumed by a read');
  g = LC.readPendingJoin({ now: T0 + 1000 });
  assert(g.state === 'expired' && !store.has(KEY), '[7j] at exactly exp it is expired and the key is REMOVED');
  store.set(KEY, JSON.stringify({ code: 'K7QX9M2P', exp: T0 + 30 * 60 * 1000 }));
  assert(LC.readPendingJoin({ now: T0 + 30 * 60 * 1000 - 1 }).state === 'valid' && LC.readPendingJoin({ now: T0 + 30 * 60 * 1000 }).state === 'expired', '[7k] the 30-minute boundary: valid at 29:59.999, expired at 30:00');
  for (const [label, raw] of [['not JSON', '{nope'], ['a bare string', '"K7QX9M2P"'], ['null', 'null'], ['no exp', JSON.stringify({ code: 'K7QX9M2P' })], ['NaN exp', JSON.stringify({ code: 'K7QX9M2P', exp: 'soon' })],
    ['lowercase code', JSON.stringify({ code: 'k7qx9m2p', exp: T0 + 9999 })], ['spaced code', JSON.stringify({ code: 'K7QX 9M2P', exp: T0 + 9999 })], ['wrong alphabet', JSON.stringify({ code: 'K7QX9M0P', exp: T0 + 9999 })],
    ['flagged bad', JSON.stringify({ bad: true, exp: T0 + 9999 })], ['an array', '[1,2]']]) {
    store.set(KEY, raw);
    const x = LC.readPendingJoin({ now: T0 });
    assert(x.state === 'malformed' && x.code === '' && !store.has(KEY), `[7l] a forged/garbled value (${label}) is MALFORMED, yields no code, and is removed`);
  }
  store.clear();
  assert(LC.readPendingJoin({ now: T0 }).state === 'none', '[7m] nothing stored → none');
  store.set(KEY, JSON.stringify({ code: 'K7QX9M2P', exp: T0 + 5000 }));
  const t1 = LC.takePendingJoin({ now: T0 }); const t2 = LC.takePendingJoin({ now: T0 });
  assert(t1.state === 'valid' && t1.code === 'K7QX9M2P' && t2.state === 'none' && !store.has(KEY), '[7n] take: handed over ONCE, then gone');
  store.set(KEY, JSON.stringify({ code: 'K7QX9M2P', exp: T0 + 5000 }));
  LC.clearPendingJoin();
  assert(!store.has(KEY), '[7o] clearPendingJoin() removes it');
  // storage that throws never throws out of the module
  const realLS = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  let threw = false;
  try { LC.capturePendingJoin({ href: 'https://irbfootball.com/?join=K7QX9M2P', replaceState() {} }); LC.readPendingJoin(); LC.takePendingJoin(); LC.clearPendingJoin(); } catch { threw = true; }
  globalThis.localStorage = realLS;
  assert(!threw, '[7p] a Storage that refuses reads and writes (private browsing) never throws out of the pending-join API');
  store.clear();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[8] The REAL first-sign-in sweep (auth.js reconcileDeviceDataOwner) keeps the pending invite, and clears everything else…');
{
  const auth = await import('./js/auth.js');
  const KEY = LC.PENDING_JOIN_KEY;
  // S-4 (security, 2026-09-30): the pending invite is a HANDOVER-ONLY keep — never on the always-keep list, so an explicit sign-out sweeps it (the per-mode pattern the SDK token uses).
  assert(!auth._CLEAR_KEEP_KEYS_FOR_TEST.includes(KEY), '[8a] cfbp_pending_join is NOT on auth.js\'s always-keep _CLEAR_KEEP_KEYS (S-4)');
  assert(auth._HANDOVER_ONLY_KEEP_KEYS_FOR_TEST.includes(KEY) && auth._HANDOVER_ONLY_KEEP_KEYS_FOR_TEST.length === 1, '[8a2] …it is the one entry on the handover-only keep list — and that literal equals league-create.js PENDING_JOIN_KEY (auth.js imports no other module, so the two are pinned here)');
  const T = Date.now();
  store.clear();
  store.set(KEY, JSON.stringify({ code: 'K7QX9M2P', exp: T + 60_000 }));
  store.set('cfbp_picks', 'someone-elses-picks');              // another cfbp_ key: MUST be cleared
  store.set('cfbp_comments', 'the-chat-log');
  auth._setAccountUserIdForTest('u-invitee');
  auth.setActiveLeagueId('L-invited');
  const noisy = console.info; console.info = () => {};
  let rec;
  try { rec = auth.reconcileDeviceDataOwner('leaguecreatetest-first-sign-in'); } finally { console.info = noisy; }
  assert(rec.action === 'cleared', `[8b] fixture: this IS the first-sign-in sweep — unrecorded data present, no owner marker → action 'cleared' (got '${rec.action}')`);
  assert(!store.has('cfbp_picks') && !store.has('cfbp_comments'), '[8c] …another player\'s picks and chat are GONE');
  assert(store.has(KEY), '[8d] …and the pending invite SURVIVED the very sweep that would have erased it mid-invite');
  const back = LC.readPendingJoin({ now: T });
  assert(back.state === 'valid' && back.code === 'K7QX9M2P', '[8e] …and it still reads as a valid invite afterwards');
  // S-4: an explicit SIGN-OUT does not keep it — "nothing about this session may survive".
  auth.clearDeviceLocalSessionData({ mode: 'signout' });
  assert(!store.has(KEY), '[8f] the SIGN-OUT sweep removes it (S-4: handover-only keep — the invite rides the first-sign-in sweep and nothing else)');
  // NON-VACUITY: a second HANDOVER sweep with the value re-seeded keeps it, while an ordinary cfbp_ key seeded beside it is removed by the same call.
  store.set(KEY, JSON.stringify({ code: 'K7QX9M2P', exp: T + 60_000 }));
  store.set('cfbp_not_on_the_keep_list', 'x');
  auth.clearDeviceLocalSessionData({ mode: 'handover' });
  assert(!store.has('cfbp_not_on_the_keep_list') && store.has(KEY), '[8g] non-vacuity: a HANDOVER sweep keeps the invite and removes an ordinary cfbp_ key in the same call, so [8d]/[8f] measure the mode and not a broken sweep');
  auth._setAccountUserIdForTest('');
  auth.setActiveLeagueId(null);
  store.clear();
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[9] Share Invite — native share is feature-detected, the web copies the link, navigator.share is never used…');
{
  const calls = [];
  const copies = [];
  const copyText = async (t) => { copies.push(t); return true; };
  let r = await LC.shareInvite({ leagueName: 'Crew', code: 'K7QX9M2P', isNative: true, plugins: { Share: { share: async (o) => { calls.push(o); } } }, copyText });
  assert(r.via === 'share' && r.ok && calls.length === 1 && calls[0].url === 'https://irbfootball.com/?join=K7QX9M2P' && /K7QX 9M2P/.test(calls[0].text) && /Crew/.test(calls[0].text) && copies.length === 0,
    '[9a] native shell WITH the Share plugin: the system share sheet, carrying the league name, the link and the code — and nothing is copied');
  r = await LC.shareInvite({ leagueName: 'Crew', code: 'K7QX9M2P', isNative: true, plugins: {}, copyText });
  assert(r.via === 'copy' && r.ok && copies[copies.length - 1] === 'https://irbfootball.com/?join=K7QX9M2P', '[9b] native shell WITHOUT the plugin (an unsynced or older shell): the LINK is copied — the share sheet arrives with the @capacitor/share build, never as a broken button');
  r = await LC.shareInvite({ leagueName: 'Crew', code: 'K7QX9M2P', isNative: false, plugins: { Share: { share: async () => { throw new Error('must not be used on web'); } } }, copyText });
  assert(r.via === 'copy' && r.ok, '[9c] web: the link is copied even if a Share plugin object happens to exist');
  Object.defineProperty(globalThis, 'navigator', { value: { share: async () => { throw new Error('navigator.share must never be called'); } }, configurable: true, writable: true });
  r = await LC.shareInvite({ leagueName: 'Crew', code: 'K7QX9M2P', isNative: false, plugins: null, copyText });
  assert(r.via === 'copy', '[9d] a browser that HAS navigator.share still gets copy-link (the Web Share API is never consulted)');
  delete globalThis.navigator;
  r = await LC.shareInvite({ leagueName: 'Crew', code: 'K7QX9M2P', isNative: true, plugins: { Share: { share: async () => { throw new Error('User cancelled'); } } }, copyText });
  assert(r.via === 'share' && r.ok === false && copies.length === 3, '[9e] a cancelled native share is not a failure and does NOT fall through to a silent clipboard write');
  r = await LC.shareInvite({ leagueName: 'Crew', code: 'K7QX9M2P', isNative: true, plugins: { Share: { share: async () => { throw new Error('plugin exploded'); } } }, copyText });
  assert(r.via === 'copy' && r.ok, '[9f] any other plugin failure falls back to copying the link');
  r = await LC.shareInvite({ leagueName: 'Crew', code: 'nope', isNative: false, copyText });
  assert(r.via === 'none' && r.ok === false, '[9g] no code → nothing to share');
  r = await LC.shareInvite({ leagueName: 'Crew', code: 'K7QX9M2P', isNative: false, copyText: async () => false });
  assert(r.via === 'copy' && r.ok === false, '[9h] a clipboard that refuses reports ok:false (the caller says so out loud)');
  for (const f of ['./js/league-create.js', './js/app.js']) {
    assert(!/navigator\.share\s*\(/.test(stripComments(src(f))) && !/navigator\.canShare/.test(stripComments(src(f))), `[9i] ${f}: no navigator.share / canShare call in the code (comment-stripped source tripwire)`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[10] Source tripwires — the wiring that no render test can see…');
{
  const app = stripComments(src('./js/app.js'));
  const authSrc = stripComments(src('./js/auth.js'));
  // The OAuth redirect is origin-only; the invite code is never in it.
  const signIn = (authSrc.match(/export async function signInWithGoogle\([\s\S]*?\n\}/) || [''])[0];
  assert(/redirectTo: \(typeof window !== 'undefined' \? window\.location\.origin : undefined\)/.test(signIn) && !/join|pending/i.test(signIn), '[10a] signInWithGoogle(): redirectTo is window.location.origin ONLY — the invite code is never in it');
  const lcSrc = stripComments(src('./js/league-create.js'));
  assert(!/redirectTo/.test(lcSrc), '[10b] js/league-create.js never mentions redirectTo');
  // Capture at boot: present, and NOT gated on any precondition (it is above every await in boot()).
  const boot = (app.match(/async function boot\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  const iCap = boot.indexOf('LC.capturePendingJoin()');
  assert(iCap > -1, '[10c] boot() captures ?join= (LC.capturePendingJoin())');
  const firstAwait = boot.indexOf('await ');
  assert(firstAwait > -1 && iCap < firstAwait, '[10d] BOOT ORDER: the capture sits ABOVE boot()\'s first await — it needs no SDK, no config, no session, so a link opened while signed out is stored before anything can go wrong');
  assert(boot.indexOf('LC.capturePendingJoin()') < boot.indexOf('wireAuthUIEvents()') || boot.indexOf('wireAuthUIEvents()') === -1, '[10e] …and above the auth listener wiring');
  assert(boot.indexOf('bindCreateLeagueDispatcher()') > -1 && boot.indexOf('bindCreateLeagueDispatcher()') < firstAwait, '[10f] the create-league dispatcher is bound in boot(), not at import (nativeguardtest [8c])');
  // The dispatcher and the join-consumption
  assert(/\[data-action="create-league"\]/.test(app), '[10g] app.js handles [data-action="create-league"]');
  // A join success clears the key (both branches of bindLeagueJoinForm).
  const bjf = (app.match(/function bindLeagueJoinForm\([\s\S]*?\n\}\n/) || [''])[0];
  assert((bjf.match(/consumePendingInvite\(\)/g) || []).length === 2, '[10i] bindLeagueJoinForm(): BOTH join paths (the landing\'s and the pill sheet\'s) consume the pending invite on success');
  assert(bjf.indexOf('joinLeague(code)') < bjf.indexOf('consumePendingInvite()'), '[10j] …after the join call, never before it (a failed join keeps the invite)');
  // joinLeague strips spaces and hyphens
  assert(/replace\(\/\[\\s-\]\+\/g, ''\)/.test(authSrc), '[10k] joinLeague() strips spaces and hyphens before the RPC');
  // The prompt for a player already in a league opens a PREFILLED join sheet and never joins by itself.
  const prompt = (app.match(/function maybePromptPendingInvite\([\s\S]*?\n\}\n/) || [''])[0];
  assert(/showJoinLeagueSheet\(\{ prefill: r\.code \}\)/.test(prompt) && !/joinLeague\(/.test(prompt), '[10l] a pending invite for a player already in a league opens the Join sheet PREFILLED — and this function never calls joinLeague()');
  assert(/getCachedMemberships\(\)\.length < 1/.test(prompt) && /event !== 'MEMBERSHIPS_REFRESHED'/.test(prompt), '[10m] …only once memberships have loaded and the player is in at least one league (zero memberships: the claim screen owns it)');
  // The claim screen: no auto-join.
  const claim = (app.match(/function claimScreenHTML\([\s\S]*?\n\}\n/) || [''])[0];
  assert(!/joinLeague\(/.test(claim) && /resolvePendingInviteView\(\)/.test(claim), '[10n] claimScreenHTML() reads the invite and renders; it never joins');
  assert(/const createChoice = _linkFlow\.state === 'unmatched' \? LC\.claimCreateEntryHTML\(\{ escHtml \}\) : '';/.test(claim) && /\$\{createChoice\}`;/.test(claim),
    '[10ae] claimScreenHTML() renders the third choice only after a CLEAN "found nothing" (R-F8: an auto-link ERROR never offers it), after the card, and (below) only past the gate');
  // R-F1 / S-9: the WHOLE invite surface (segments, invite card, loud invite notice, Create) is behind the release gate; closed → the pre-N1 claim card, and nothing above the gate line
  // reads or consumes the stored invite.
  {
    const gateLine = claim.indexOf('if (!getCachedLeagueCreationOpen()) return claimCodeScreenHTML();');
    assert(gateLine > -1 && gateLine < claim.indexOf('resolvePendingInviteView()') && gateLine < claim.indexOf('landingSegmentsHTML'),
      '[10af] R-F1: claimScreenHTML() returns the pre-N1 claim card BEFORE it reads the pending invite or renders the segments — with the door closed nothing on this screen is new (source-order scan; the byte-level golden is authtest [80a2])');
    assert(!/getCachedLeagueCreationOpen\(\)/.test(claim.slice(gateLine + 70)), '[10ag] …and there is exactly one gate check on the screen (no second predicate to drift)');
  }
  // The sheet: hold-teardown, the dismiss list, the gestures list
  const shell = (app.match(/function mountSheetShell\([\s\S]*?\n\}\n/) || [''])[0];
  assert(/setAttribute\('data-hold-teardown', ''\)/.test(shell), '[10o] the shared sheet shell stamps data-hold-teardown (a security hold sweeps the New League sheet too)');
  assert(/mountSheetShell\(\{[\s\S]*?wrapId: 'week-wizard-sheet-wrap'/.test(app) && /mountSheetShell\(\{[\s\S]*?wrapId: LC_WRAP_ID/.test(app), '[10p] the wizard and the New League sheet are BOTH callers of the one shell (generalized, never forked)');
  assert(/excludeCreate/.test(app) && /'league-create-sheet-wrap'/.test(app), '[10q] _dismissBlockingSurfaceUp() knows the New League sheet');
  assert(/getElementById\?\.\('league-create-sheet-wrap'\)/.test(stripComments(src('./js/nav-gestures.js'))), '[10r] gesturesSuspended() knows the New League sheet');
  // The one server call
  const submit = (app.match(/async function submitLeagueCreate\([\s\S]*?\n\}\n/) || [''])[0];
  assert((submit.match(/createLeague\(/g) || []).length === 1 && /createLeague\(name, LC\.sportsPayload\(st\), \{ activate: !hadLeague \}\)/.test(submit), '[10s] submitLeagueCreate(): exactly ONE createLeague(name, sports, { activate }) call — nothing is created client-side');
  assert(!/\.from\('leagues'\)|\.from\('league_members'\)|\.from\('league_kv'\)|\.insert\(/.test(submit), '[10t] …and no direct table write anywhere near it');
  assert(/created_not_loaded/.test(submit) && /haptic\('error'\)/.test(submit) && /haptic\('success'\)/.test(submit), '[10u] the partial failure (frame 13), the error haptic and the success haptic are all wired');
  assert(!/setTimeout\([^)]*submitLeagueCreate/.test(app) && !/retry/i.test(submit), '[10v] a create is never retried automatically (a second create would spend a second allowance)');
  // Super Admin toggle: two-tap confirm
  const sa = (app.match(/export function bindSuperAdminControls\(\) \{[\s\S]*?\n\}\n/) || [''])[0];
  assert(/super-creation-open-btn/.test(sa) && /confirmArmed/.test(sa) && /< 350\) return;/.test(sa) && /superSetPlatformKv\('league_creation_open', nextOpen\)/.test(sa), '[10w] Super Admin: the league_creation_open toggle is a two-tap confirm with the 350ms floor');
  const writers = (app.match(/superSetPlatformKv\('league_creation_open'/g) || []).length;
  assert(writers === 1, `[10y] exactly ONE client call site writes league_creation_open (got ${writers})`);
  // The picker is fed by the registry and the offered list, nothing hand-typed
  const open = (app.match(/function openLeagueCreateSheet\([\s\S]*?\n\}\n/) || [''])[0];
  assert(/LC\.pickerGroups\(\{ profiles: listProfiles\(\), offered: getCachedOfferedSports\(\) \}\)/.test(open), '[10z] the picker = listProfiles() ∩ getCachedOfferedSports()');
  assert(/getCachedLeagueCreationOpen\(\)/.test(open) && /showComingSoonToast\(LC\.LC_COPY\.landingClosed\)/.test(open), '[10aa] a stale button under a closed gate answers with the ordinary "isn\'t available yet" toast and opens nothing');
  // The prompt waits for a serving app, boundedly
  assert(/const PENDING_INVITE_MAX_TRIES = 20;/.test(app) && /attempt < PENDING_INVITE_MAX_TRIES/.test(prompt) && /isContentWithheld\(\)/.test(prompt), '[10ac] the pending-invite prompt WAITS while the app is withheld (hydrating, or a hold) and stops after a bounded number of tries');
  // The new modules are boot-critical: precached
  const sw = src('./service-worker.js');
  for (const f of ['league-create.js', 'league-defaults.js', 'pilot-only.js', 'sports/index.js', 'sports/cfb.js', 'sports/nfl.js']) {
    assert(sw.includes(`'./js/${f}'`), `[10ad] service-worker.js STATIC_ASSETS precaches ./js/${f} (a shell one module short serves a graph that cannot resolve — RG-03 through the cache)`);
  }
  // The identity sweep spares the sheet in exactly one case
  assert(/leagueCreateSheetSurvivesIdentityChange\(el\)/.test(app) && /lc\.accountId === getAccountUserId\(\)/.test(app), '[10ab] the identity chokepoint spares the New League sheet only for the SAME account, mid-create or just-created');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[11] CSS — token-only, motion tokens, ≥600px modal, Reduce Motion, one z-index tier…');
{
  const css = src('./css/styles.css');
  const i = css.indexOf('N1 — THE NEW LEAGUE SHEET');
  assert(i > -1, '[11a] fixture: the New League CSS block is present');
  // v0.29.0 integration (2026-10-01) — BOUNDED, not sliced to EOF (the accountexittest [12] fix, 1b9a9b6, and the layouttest A10k precedent). This slice used to run
  // to the literal end of styles.css, so [11] answered for every block appended after N1: the Delete Account sheet (token-only, so it never showed) and then SP-56's
  // append-only `.stand-*` block, whose one white-on-maroon `color:#fff` (the same declaration `.dashboard-table th` makes) failed [11b] as if the New League sheet had
  // regressed. N1 ends where the next top-level banner comment begins — either house style, the `/* ═══` box N1 itself opens with (the Delete Account block's) or the
  // `/* ── ` line an appended block opens with (SP-56's); N1 contains neither internally. Only when N1 is the last block does the slice run to the end of the file.
  const ends = ['\n/* ═══', '\n/* ── '].map((b) => css.indexOf(b, i + 1)).filter((k) => k > i);
  const block = css.slice(i, ends.length ? Math.min(...ends) : undefined);
  assert(block.length > 8000 && block.includes('#league-create-sheet-wrap{position:fixed;inset:0;z-index:8000}') && block.includes('#league-create-sheet-wrap ~ .modal-overlay{z-index:8100}')
    && (block.match(/\.lc-[a-z-]+\{/g) || []).length >= 40
    && /@media \(min-width:600px\) and \(prefers-reduced-motion:reduce\)\{\s*#league-create-sheet\{animation:none\}/.test(block),
    `[11a2] fixture: the bounded block is the WHOLE N1 block — the 8000 / 8100 tiers, its .lc-* rules, through to its last block (the ≥600px Reduce Motion media query) — so a bound cut short could never make [11b]/[11c]/[11i] vacuous (${block.length} chars)`);
  const noComments = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const hexes = noComments.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
  assert(hexes.length === 0, `[11b] no hardcoded hex colour in the block (found ${JSON.stringify(hexes)})`);
  const rgbas = noComments.match(/rgba?\([^)]*\)/g) || [];
  assert(rgbas.every((x) => x === 'rgba(0,0,0,.4)'), `[11c] the only literal colour is the scrim's black at .4 (found ${JSON.stringify(rgbas)})`);
  assert(/#league-create-sheet-wrap\{position:fixed;inset:0;z-index:8000\}/.test(noComments), '[11d] the wrap is a fixed full-screen shell at the sheet tier (8000)');
  assert(/#league-create-sheet-wrap ~ \.modal-overlay\{z-index:8100\}/.test(noComments) && /html:has\(#league-create-sheet-wrap\)\{overflow:hidden\}/.test(noComments), '[11e] a modal raised over it paints above (8100), and the page behind does not scroll');
  assert(/animation-duration:var\(--motion-modal\)/.test(noComments) && /transition:transform var\(--motion-modal\)/.test(noComments), '[11f] the sheet uses the modal motion token (300ms), not a literal');
  assert(/lc-step-in var\(--motion-nav\)/.test(noComments) && /lc-fade var\(--motion-fast\)/.test(noComments), '[11g] step push = the nav token, banner fade = the fast token');
  const presses = noComments.match(/:active[^{]*\{[^}]*\}/g) || [];
  assert(presses.length >= 8 && presses.filter((p) => /scale\(\.97\)/.test(p)).length >= 8 - 2, `[11h] the pressable controls compress to 97% (${presses.filter((p) => /scale\(\.97\)/.test(p)).length} of ${presses.length} :active rules)`);
  assert(!/transition:\s*all/.test(noComments), '[11i] no `transition: all` (one animation language, named properties only)');
  assert(/@media \(prefers-reduced-motion:reduce\)\{[\s\S]*?#league-create-sheet\{transition:none;animation:none\}/.test(noComments), '[11j] Reduce Motion turns the sheet\'s slide off');
  assert(/@media \(min-width:600px\)\{[\s\S]*?#league-create-sheet\{[^}]*width:480px/.test(noComments), '[11k] ≥600px: a 480px centred modal (PARITY-BY-DESIGN)');
  assert(/\.lc-btn\{[^}]*min-height:50px/.test(noComments) && /\.lc-nav-btn\{[^}]*min-height:44px/.test(noComments) && /\.lc-row\{[^}]*min-height:52px/.test(noComments), '[11l] targets: Create 50px, nav buttons 44px, rows 52px');
  assert(/\.lc-input-field\{[^}]*font-size:1\.06rem/.test(noComments), '[11m] the name field is ≥16px (iOS does not zoom the page on focus)');
  const ladderAt = css.indexOf('/* ═══ Z-INDEX LADDER');
  const ladder = css.slice(ladderAt, ladderAt + 2500);
  assert(/#league-create-sheet-wrap/.test(ladder), '[11n] the z-index ladder comment names the new sheet');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[12] The storage inventory names the new device-local key…');
{
  const st = src('./js/storage.js');
  assert(/'cfbp_pending_join'\s+js\/league-create\.js PENDING_JOIN_KEY/.test(st), '[12a] storage.js\'s inventory comment names cfbp_pending_join and its owner');
  const dl = (st.match(/const DEVICE_LOCAL_KEYS = new Set\(\[[\s\S]*?\]\);/) || [''])[0];
  assert(!/pending_join|PENDING_JOIN/.test(dl), '[12b] …and it is NOT in DEVICE_LOCAL_KEYS (it never goes through load()/save())');
  const lcSrc = stripComments(src('./js/league-create.js'));
  assert(!/from '\.\/storage\.js'/.test(lcSrc) && !/\bload\(|\bsave\(/.test(lcSrc), '[12c] league-create.js does not touch the storage seam');
  assert(/localStorage/.test(lcSrc), '[12d] …it owns its one device-local key directly (the cfbp_auth_mode_last_known precedent)');
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
console.log('\n[13] The pilot-only registry…');
{
  assert(JSON.stringify(PO.PILOT_ONLY_KEYS) === JSON.stringify(['trainer', 'scribeLearn', 'canonMemory', 'season2025Record', 'recap2025', 'lorePersona', 'sixSchoolAlmaMaters', 'irbCopy']),
    '[13a] the closed key list is exactly the DI\'s eight');
  assert(PO.isPilotOnlyAllowed('irbCopy', { pilot: true }) === true && PO.isPilotOnlyAllowed('irbCopy', { pilot: false }) === false, '[13b] delegates to isPilotLeague(): pilot === true only');
  for (const bad of [null, undefined, {}, { pilot: 'true' }, { pilot: 1 }]) assert(PO.isPilotOnlyAllowed('irbCopy', bad) === false, `[13c] ${JSON.stringify(bad)} is NOT the pilot (an unloaded or old record is never shown another league's content)`);
  let e = null; try { PO.isPilotOnlyAllowed('irbcopy', { pilot: true }); } catch (x) { e = x; }
  assert(e && /unknown pilot-only key/.test(e.message), '[13d] an unknown key THROWS (a typo is seen, never a silent "no" or "yes")');
  e = null; try { PO.isPilotOnlyAllowed('__proto__', { pilot: true }); } catch (x) { e = x; }
  assert(!!e, '[13e] "__proto__" is not a key either');
  PO.setPilotOnlyLeagueResolver(null);
  assert(PO.isPilotOnlyAllowed('recap2025') === false, '[13f] no league and no resolver → closed');
  PO.setPilotOnlyLeagueResolver(() => ({ pilot: true }));
  assert(PO.isPilotOnlyAllowed('recap2025') === true && PO.isPilotOnlyAllowed('recap2025', { pilot: false }) === false, '[13g] the resolver answers only when no league is passed; an explicit league always wins');
  PO.setPilotOnlyLeagueResolver(() => { throw new Error('boom'); });
  assert(PO.isPilotOnlyAllowed('recap2025') === false, '[13h] a resolver that throws reads as "no league" (closed)');
  PO.setPilotOnlyLeagueResolver(null);
  let te = null; try { PO.setPilotOnlyLeagueResolver('nope'); } catch (x) { te = x; }
  assert(te instanceof TypeError, '[13i] the resolver must be a function or null');
  assert(!/pilot\s*===/.test(stripComments(src('./js/pilot-only.js'))), '[13j] NO second predicate: pilot-only.js never reads `pilot` itself — it asks isPilotLeague()');
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
