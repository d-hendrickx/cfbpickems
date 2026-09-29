/**
 * CFB Pickems — controlcentertest.mjs
 * ====================================
 * UX Revamp, group A1, Build Wave 1 (T-13/T-14) — js/control-center.js.
 * Fix round 1 (reviewer BLOCK) folded in — every section below that changed
 * is marked "FIX ROUND 1" at its own header.
 *
 * jsdom-free. Sections [0]-[9] test PURE functions directly, no DOM at all.
 * Sections [10]-[12] need a DOM realistic enough to prove the fix-round-1
 * requirements honestly (root-node stability, real setTimeout fallback,
 * attribute-vs-content-repaint separation) — a hand-rolled MINIMAL DOM
 * (`FakeElement` + a small HTML-subset parser + a small selector engine,
 * below) stands in for jsdom, which this repo does not depend on. It
 * supports exactly the operations `js/control-center.js` actually performs
 * (id/class/attribute/dataset get-set, `innerHTML` parse-and-replace,
 * `querySelector(All)`/`closest` over `#id`/`.class`/`tag`/`[attr]`/
 * `[attr="value"]`/comma-lists, `addEventListener`/a manual `_dispatch`,
 * `style.setProperty`, `focus()`) — nothing more.
 *
 * Run: node controlcentertest.mjs
 *
 * SECTIONS
 *   [0]  Zero top-level side effects at import.
 *   [1]  Constants — DRAWER_EDGE_ZONE_PX RETIRED by DI-419 (2026-09-28,
 *        isInDrawerOpenZone() replaces its role); DRAWER_MOTION_MS now 260ms,
 *        matching the shared --motion-nav token (fix round 1 checklist note).
 *   [2]  Drawer phase state machine.
 *   [3]  Profile push/back.
 *   [4]  Accordion single-open-per-group — NOW one unified 'toggle-row'
 *        event keyed by `group` ('settings' | 'feedback'), replacing fix
 *        round 0's separate 'toggle-settings-row'/'toggle-history' events.
 *   [5]  isDrawerVisuallyOpen() / the data-open hook.
 *   [6]  _resolveDrawerSettle().
 *   [7]  isInDrawerOpenZone() (js/nav-gestures.js) — DI-419 (2026-09-28),
 *        RETIRED _isWithinEdgeZone()'s replacement.
 *   [8]  starredPanels() — FIX ROUND 1 finding 6: each entry now carries a
 *        `group` ('admin'|'commissioner'), Super Admin grouped under 'admin'.
 *   [9]  renderControlCenter() — data-open contract, body embedding, XSS,
 *        coming-soon copy. FIX ROUND 1 finding 4/5: Feedback is now an
 *        ACCORDION embedding `bodies.feedbackCardHTML` (was a deep link).
 *        FIX ROUND 1 finding 6: renderStarredPanels() produces TWO labeled
 *        groups. FIX ROUND 1 finding 5: "View League As" is gone. FIX ROUND
 *        1 finding 7: Profile back affordance uses icon('chevronLeft').
 *   [10] bindControlCenterEdgeSwipe() — FIX ROUND 1 finding 3: must NOT
 *        bail when the (future-amended) shared gesturesSuspended() would say
 *        true because THIS drawer is open — tested with a fake `document`
 *        that returns a node for `#control-center[data-open="true"]`.
 *   [11] mountControlCenter() — FIX ROUND 1 finding 1: the ROOT NODE is
 *        stable across dispatches (proven via the realistic fake DOM, no
 *        hand-dispatched `transitionend`), and phase completes via the REAL
 *        `setTimeout` fallback when no transitionend ever arrives. FIX ROUND
 *        1 finding 2: `onAfterPaint`/`update()`. FIX ROUND 1 finding 8: no
 *        content repaint on drag-move (only `--cc-drag-progress` + attrs),
 *        focus only on closed->open, `haptic('light')` on `api.open()`.
 *        FIX ROUND 1 finding 9: field-preserve wraps content repaints.
 */

let pass = 0, fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log('  ✅', label); }
  else { fail++; console.error('  ❌', label); }
}

console.log('\n[control-center] UX Revamp group A1, Build Wave 1 — DI-301…306 (fix round 1)\n');

// ═════════════════════════════════════════════════════════════════════════
console.log('[0] Zero top-level side effects at import…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedDocument = globalThis.document;
  const savedWindow = globalThis.window;
  const savedLocalStorage = globalThis.localStorage;
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.localStorage;

  let threw = null;
  let CC;
  try { CC = await import('./js/control-center.js'); } catch (e) { threw = e; }
  assert(!threw, `0a: importing js/control-center.js with no document/window/localStorage at all never throws (${threw && threw.message})`);
  assert(typeof CC?.renderControlCenter === 'function', '0b: the module still exposes its exports with nothing global defined');

  globalThis.document = savedDocument;
  globalThis.window = savedWindow;
  globalThis.localStorage = savedLocalStorage;
}

const CC = await import('./js/control-center.js');
const {
  DRAWER_WIDTH_VW, DRAWER_MAX_WIDTH_PX, DRAWER_MOTION_MS,
  DRAWER_OPEN_SETTLE_RATIO, DRAWER_FLICK_VELOCITY_PX_MS,
  initialControlCenterState, _controlCenterStateMachine, _toggleAccordionRow,
  isDrawerVisuallyOpen, _resolveDrawerSettle,
  starredPanels, renderControlCenter, renderIdentityHeader, renderProfileScreen,
  renderStarredPanels, renderSettingsAccordion, renderFeedbackRulesGroup, renderHelpFooter,
  bindControlCenterEdgeSwipe, mountControlCenter,
} = CC;

const NG = await import('./js/nav-gestures.js');

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function icon(name) {
  const known = {
    bell: '<svg data-icon="bell"></svg>',
    chevronRight: '<svg data-icon="chevronRight"></svg>',
    chevronLeft: '<svg data-icon="chevronLeft"></svg>',
    almaMater: '<svg data-icon="almaMater"></svg>',
  };
  return known[name] || '';
}

function baseCtx(overrides = {}) {
  return {
    session: { player: { id: 'p1', displayName: 'Drew', initials: 'DH', almaMater: 'Texas A&M' }, isAdmin: true },
    memberships: [],
    league: { id: 'l1', name: "IRB Pick'Ems", pilot: false },
    escHtml, icon,
    isNativeShell: () => false,
    flags: { isCommissioner: false, isPlatformAdmin: false, isSuperAdmin: false, isPilotLeague: false },
    version: { APP_VERSION: '0.26.0', APP_VERSION_DATE: '2026-09-25' },
    bodies: {
      notifSettingsHTML: '<div data-body="notif">NOTIF BODY</div>',
      chatPrefsHTML: '<div data-body="chat">CHAT BODY</div>',
      scribeFileHTML: '<div data-body="scribe">SCRIBE BODY</div>',
      feedbackCardHTML: '<div data-body="feedback">FEEDBACK BODY</div>',
      gameRequestHTML: '<div data-body="gamereq">GAME REQUEST BODY</div>',
      releaseNotesHTML: '<div data-body="history">RELEASE NOTES BODY</div>',
    },
    currentTimeZone: 'PT',
    currentTheme: 'neutral',
    logoView: false,
    callbacks: {},
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[1] CONSTANTS…');
// ═════════════════════════════════════════════════════════════════════════
{
  // DI-419 (2026-09-28) — DRAWER_EDGE_ZONE_PX is RETIRED; the drawer's own
  // arm check now calls js/nav-gestures.js's isInDrawerOpenZone() directly
  // (see [10], below, for the behavioral coverage this constant's removal
  // leaves in its place).
  assert(CC.DRAWER_EDGE_ZONE_PX === undefined, '1a: DRAWER_EDGE_ZONE_PX no longer exists as an export — isInDrawerOpenZone() (js/nav-gestures.js) replaced its role');
  assert(typeof NG.isInDrawerOpenZone === 'function' && typeof NG.DRAWER_ZONE_FRACTION === 'number',
    '1b: …and js/control-center.js imports the ONE shared predicate/constant that replaced it, from js/nav-gestures.js');
  assert(DRAWER_WIDTH_VW === 85 && DRAWER_MAX_WIDTH_PX === 340, '1c: drawer width — 85vw, capped at 340px (DI-301)');
  assert(DRAWER_OPEN_SETTLE_RATIO === 0.4, '1d: 40%-of-width settle threshold (DI-301)');
  assert(DRAWER_FLICK_VELOCITY_PX_MS === 0.3, '1e: flick-velocity override threshold');
  assert(DRAWER_MOTION_MS === 260, '1f: FIX ROUND 1 checklist note — DRAWER_MOTION_MS now matches the shared --motion-nav token (260ms, css/styles.css:92), not the fix-round-0 literal 280ms');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[2] Drawer phase state machine…');
// ═════════════════════════════════════════════════════════════════════════
{
  const a = _controlCenterStateMachine([{ type: 'open', reducedMotion: false }]);
  assert(a[0].phase === 'opening', '2a: open (motion) -> transient "opening" phase');
  const b = _controlCenterStateMachine([{ type: 'open', reducedMotion: false }, { type: 'transition-end' }]);
  assert(b[1].phase === 'open', '2b: transition-end completes opening -> open');
  const c = _controlCenterStateMachine([{ type: 'open', reducedMotion: true }]);
  assert(c[0].phase === 'open', '2c: prefers-reduced-motion -> "open" directly, no transient');
  const d2 = _controlCenterStateMachine([
    { type: 'open', reducedMotion: true }, { type: 'close', reducedMotion: false }, { type: 'transition-end' },
  ]);
  assert(d2[2].phase === 'closed', '2d: close (motion) -> "closing" -> transition-end -> "closed"');
  const e = _controlCenterStateMachine([{ type: 'open', reducedMotion: true }, { type: 'close', reducedMotion: true }]);
  assert(e[1].phase === 'closed', '2e: reduced-motion close -> "closed" directly');
  const f = _controlCenterStateMachine([{ type: 'open', reducedMotion: false }, { type: 'open', reducedMotion: false }]);
  assert(f[0].phase === 'opening' && f[1].phase === 'opening', '2f-1: a second "open" while opening is a no-op');
  const f2 = _controlCenterStateMachine([{ type: 'close', reducedMotion: false }]);
  assert(f2[0].phase === 'closed', '2f-2: "close" from initial closed state is a no-op');
  const s1 = initialControlCenterState(); const s2 = initialControlCenterState();
  s1.phase = 'open';
  assert(s2.phase === 'closed', '2g: initialControlCenterState() returns a fresh object each call');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[3] Profile push/back…');
// ═════════════════════════════════════════════════════════════════════════
{
  const a = _controlCenterStateMachine([{ type: 'open', reducedMotion: false }, { type: 'push-profile' }]);
  assert(a[1].pane === 'main', '3a: push-profile while still "opening" is a no-op');
  const b = _controlCenterStateMachine([{ type: 'open', reducedMotion: true }, { type: 'push-profile' }]);
  assert(b[1].pane === 'profile', '3b: push-profile once fully "open" -> pane becomes "profile"');
  const c = _controlCenterStateMachine([{ type: 'open', reducedMotion: true }, { type: 'push-profile' }, { type: 'pop-profile' }]);
  assert(c[2].pane === 'main', '3c: pop-profile -> pane returns to "main"');
  const d = _controlCenterStateMachine([{ type: 'open', reducedMotion: true }, { type: 'push-profile' }, { type: 'close', reducedMotion: true }]);
  assert(d[2].phase === 'closed' && d[2].pane === 'main', '3d: closing from the Profile pane resets pane to "main"');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[4] Accordion single-open-per-group — unified toggle-row event…');
// ═════════════════════════════════════════════════════════════════════════
{
  assert(_toggleAccordionRow(null, 'timezone') === 'timezone', '4a: opening a row from closed sets it as the open row');
  assert(_toggleAccordionRow('timezone', 'notifications') === 'notifications', '4b: opening a different row replaces the open one');
  assert(_toggleAccordionRow('timezone', 'timezone') === null, '4c: re-tapping the open row closes it');

  const steps = _controlCenterStateMachine([
    { type: 'toggle-row', group: 'settings', rowId: 'timezone' },
    { type: 'toggle-row', group: 'feedback', rowId: 'version-history' },
    { type: 'toggle-row', group: 'settings', rowId: 'notifications' },
  ]);
  assert(steps[0].settingsOpenRow === 'timezone' && steps[0].feedbackGroupOpenRow === null, '4d-1: settings group opens independently of the feedback group');
  assert(steps[1].settingsOpenRow === 'timezone' && steps[1].feedbackGroupOpenRow === 'version-history', '4d-2: opening the feedback group does not close the settings group\'s open row');
  assert(steps[2].settingsOpenRow === 'notifications' && steps[2].feedbackGroupOpenRow === 'version-history', '4d-3: switching the settings row does not touch the feedback group\'s state');

  // FIX ROUND 1, finding 4/5: Feedback now lives in the SAME single-open
  // group as Version history (they used to be independent — Feedback was a
  // deep link with no open state at all).
  const fb = _controlCenterStateMachine([
    { type: 'toggle-row', group: 'feedback', rowId: 'feedback' },
    { type: 'toggle-row', group: 'feedback', rowId: 'version-history' },
  ]);
  assert(fb[0].feedbackGroupOpenRow === 'feedback', '4e-1: opening Feedback sets it as the feedback group\'s open row');
  assert(fb[1].feedbackGroupOpenRow === 'version-history', '4e-2: opening Version history in the SAME group closes Feedback (single-open-per-group, now spanning both rows)');

  assert(_controlCenterStateMachine([{ type: 'toggle-row', group: 'nonsense', rowId: 'x' }])[0].settingsOpenRow === null,
    '4f: an unrecognized group is a no-op, never throws, never opens anything (deny-by-default)');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[5] isDrawerVisuallyOpen()…');
// ═════════════════════════════════════════════════════════════════════════
{
  assert(isDrawerVisuallyOpen(initialControlCenterState()) === false, '5a: closed -> not visually open');
  assert(isDrawerVisuallyOpen({ phase: 'opening', dragging: false, dragProgress: 0 }) === true, '5b: "opening" -> visually open');
  assert(isDrawerVisuallyOpen({ phase: 'open', dragging: false, dragProgress: 0 }) === true, '5c: "open" -> visually open');
  assert(isDrawerVisuallyOpen({ phase: 'closing', dragging: false, dragProgress: 0 }) === true, '5d: "closing" -> still visually open (mid-animation)');
  assert(isDrawerVisuallyOpen({ phase: 'closed', dragging: false, dragProgress: 0 }) === false, '5e: settled "closed" -> not visually open');
  assert(isDrawerVisuallyOpen({ phase: 'closed', dragging: true, dragProgress: 0.1 }) === true, '5f: mid-drag with progress, even while phase is still "closed" -> visually open');
  assert(isDrawerVisuallyOpen({ phase: 'closed', dragging: true, dragProgress: 0 }) === false, '5g: a drag that has moved 0px is NOT yet visually open');
  assert(isDrawerVisuallyOpen(null) === false, '5h: a null state is safely "not open", never throws');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[6] _resolveDrawerSettle()…');
// ═════════════════════════════════════════════════════════════════════════
{
  assert(_resolveDrawerSettle({ progress: 0.5, velocityPxPerMs: 0 }) === true, '6a: past 40% with no velocity -> settles open');
  assert(_resolveDrawerSettle({ progress: 0.39, velocityPxPerMs: 0 }) === false, '6b: under 40% with no velocity -> settles closed');
  assert(_resolveDrawerSettle({ progress: 0.4, velocityPxPerMs: 0 }) === true, '6c: exactly 40% (>=) -> settles open');
  assert(_resolveDrawerSettle({ progress: 0.1, velocityPxPerMs: 0.5 }) === true, '6d: a rightward flick opens even at low distance progress');
  assert(_resolveDrawerSettle({ progress: 0.9, velocityPxPerMs: -0.5 }) === false, '6e: a leftward flick closes even at high distance progress');
  assert(_resolveDrawerSettle({ progress: 0.9 }) === true, '6f: velocityPxPerMs defaults to 0 when omitted');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[7] isInDrawerOpenZone() (js/nav-gestures.js) — RETIRED _isWithinEdgeZone()\'s replacement, exercised at THIS module\'s own call site…');
// ═════════════════════════════════════════════════════════════════════════
{
  const { isInDrawerOpenZone, DRAWER_ZONE_FRACTION } = NG;
  // Same shape of coverage _isWithinEdgeZone() used to carry, on a 400px
  // viewport (100px = the 25% boundary) — the fixture width [10], below,
  // also uses.
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: 0, viewportWidthPx: 400 }) === true, '7a: Picks, x=0 — within the zone');
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: 99, viewportWidthPx: 400 }) === true, '7b: Picks, x=99 (< 25% of 400) — within the zone');
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: 100, viewportWidthPx: 400 }) === false, '7c: Picks, x=100 (the 25% boundary itself) — NOT within the zone (strict <)');
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: 300, viewportWidthPx: 400 }) === false, '7d: well inside the content, never within the zone');
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: -1, viewportWidthPx: 400 }) === false, '7e: negative x rejected');
  assert(isInDrawerOpenZone({ tab: 'picks', clientX: undefined, viewportWidthPx: 400 }) === false, '7f: non-numeric x rejected');
  assert(isInDrawerOpenZone({ tab: 'commissioner', clientX: 399, viewportWidthPx: 400 }) === true, '7g: [DI-419] on any tab OTHER than Picks/Dashboard, "anywhere" opens the drawer — the widened zone this DI added');
  assert(DRAWER_ZONE_FRACTION === 0.25, '7h: DRAWER_ZONE_FRACTION is 25% — a fraction of the viewport, not the retired 28px pixel constant');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[8] starredPanels() — FIX ROUND 1 finding 6: grouping…');
// ═════════════════════════════════════════════════════════════════════════
{
  assert(starredPanels({}).length === 0, '8a: no flags -> no panels');
  assert(starredPanels(undefined).length === 0, '8b: undefined flags never throws');

  const commOnly = starredPanels({ isCommissioner: true });
  assert(commOnly.length === 1 && commOnly[0].label === 'Commissioner Panel' && commOnly[0].group === 'commissioner',
    '8c: commissioner-only -> one panel, group="commissioner"');

  const adminOnly = starredPanels({ isPlatformAdmin: true });
  assert(adminOnly.length === 1 && adminOnly[0].label === 'Admin Panel' && adminOnly[0].group === 'admin',
    '8d: platform-admin-only -> one panel, group="admin"');

  const superOnly = starredPanels({ isSuperAdmin: true });
  assert(superOnly.length === 1 && superOnly[0].group === 'admin',
    '8e: FIX ROUND 1 finding 6 — Super Admin\'s group is "admin" (nested under the Admin group label), not its own group');

  const all3 = starredPanels({ isCommissioner: true, isPlatformAdmin: true, isSuperAdmin: true });
  assert(all3.length === 3 && all3[0].group === 'admin' && all3[1].group === 'admin' && all3[2].group === 'commissioner',
    '8f: all three -> Super Admin and Admin both group="admin" (in that order), Commissioner group="commissioner"');

  const truthy = starredPanels({ isCommissioner: 1, isPlatformAdmin: 'yes' });
  assert(truthy.length === 0, '8g: a truthy-but-not-===true flag value does NOT grant a panel');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[9] renderControlCenter() / renderStarredPanels() / renderFeedbackRulesGroup() / renderProfileScreen()…');
// ═════════════════════════════════════════════════════════════════════════
{
  const closedHTML = renderControlCenter(baseCtx(), initialControlCenterState());
  assert(closedHTML.includes('id="control-center"') && closedHTML.includes('data-open="false"'),
    '9a: closed phase -> #control-center carries data-open="false"');
  assert(closedHTML.includes('inert'), '9a-2: closed drawer carries `inert`');

  const openState = { ...initialControlCenterState(), phase: 'open' };
  const openHTML = renderControlCenter(baseCtx(), openState);
  assert(openHTML.includes('data-open="true"'), '9b: fully open phase -> data-open="true"');
  assert(!/id="control-center"[^>]*inert/.test(openHTML.split('data-pane="profile"')[0]), '9b-2: open drawer does not carry `inert`');

  const draggingState = { ...initialControlCenterState(), phase: 'closed', dragging: true, dragProgress: 0.2 };
  const draggingHTML = renderControlCenter(baseCtx(), draggingState);
  assert(draggingHTML.includes('data-open="true"') && draggingHTML.includes('data-dragging="true"') && draggingHTML.includes('--cc-drag-progress:0.2'),
    '9c: mid-drag — data-open="true", data-dragging="true", and the --cc-drag-progress custom property carries the live value (fix round 1 finding 8 hook)');

  const profileState = { ...initialControlCenterState(), phase: 'open', pane: 'profile' };
  const profileHTML = renderControlCenter(baseCtx(), profileState);
  assert(profileHTML.includes('data-pane="profile" data-active="true"'), '9d-1: profile pane active when state.pane is "profile"');
  assert(profileHTML.includes('data-pane="main" data-active="false"'), '9d-2: main pane correspondingly inactive');

  const collapsedAll = renderControlCenter(baseCtx(), { ...initialControlCenterState(), phase: 'open' });
  assert(!collapsedAll.includes('NOTIF BODY') && !collapsedAll.includes('CHAT BODY') && !collapsedAll.includes('SCRIBE BODY')
    && !collapsedAll.includes('GAME REQUEST BODY') && !collapsedAll.includes('RELEASE NOTES BODY') && !collapsedAll.includes('FEEDBACK BODY'),
    '9e-1: every accordion row collapsed -> NONE of the injected bodies appear at all');

  const notifOpen = { ...initialControlCenterState(), phase: 'open', settingsOpenRow: 'notifications' };
  const notifHTML = renderControlCenter(baseCtx(), notifOpen);
  assert((notifHTML.match(/NOTIF BODY/g) || []).length === 1, '9e-2: Notifications open -> its body appears exactly once');
  assert(!notifHTML.includes('CHAT BODY') && !notifHTML.includes('FEEDBACK BODY'), '9e-3: opening one row never renders a different row\'s body');

  // FIX ROUND 1, finding 4/5 — Feedback is NOW an accordion row embedding
  // feedbackCardHTML, per the DI VERDICT's own amendment (3).
  const feedbackOpen = { ...initialControlCenterState(), phase: 'open', feedbackGroupOpenRow: 'feedback' };
  const feedbackHTML = renderControlCenter(baseCtx(), feedbackOpen);
  assert((feedbackHTML.match(/FEEDBACK BODY/g) || []).length === 1, '9f-1: Feedback open -> ctx.bodies.feedbackCardHTML is embedded exactly once (was NEVER embedded in fix round 0 — this is the corrected behavior)');
  assert(feedbackHTML.includes('data-action="cc-toggle-row" data-group="feedback" data-row="feedback"'), '9f-2: Feedback is wired as an accordion toggle, not a deep-link action');
  assert(!feedbackHTML.includes('data-action="cc-feedback"'), '9f-3: the old deep-link action (cc-feedback) no longer exists anywhere in the output');
  assert(feedbackHTML.includes('data-action="cc-navigate" data-target="rules"'), '9f-4: Rules is still a plain nav row, unchanged');

  const historyOpenHTML = renderControlCenter(baseCtx(), { ...initialControlCenterState(), phase: 'open', feedbackGroupOpenRow: 'version-history' });
  assert((historyOpenHTML.match(/RELEASE NOTES BODY/g) || []).length === 1, '9f-5: Version history open -> its body appears exactly once, and (single-open-per-group) Feedback\'s body does not');
  assert(!historyOpenHTML.includes('FEEDBACK BODY'), '9f-6: …confirmed — Feedback body absent while Version history is the open row in the same group');

  // XSS sweep.
  const XSS = '<script>evil()</script>';
  const xssCtx = baseCtx({
    session: { player: { id: 'p1', displayName: XSS, initials: 'XX', almaMater: XSS } },
    league: { id: 'l1', name: XSS, pilot: false },
  });
  const xssHTML = renderControlCenter(xssCtx, { ...initialControlCenterState(), phase: 'open' });
  assert(!xssHTML.includes('<script>'), '9g-1: a <script> player displayName/league name is escaped in the identity header');
  const xssProfileHTML = renderProfileScreen(xssCtx);
  assert(!xssProfileHTML.includes('<script>'), '9g-2: a <script> displayName/almaMater is escaped in the pushed Profile screen');

  let threw = false;
  try { renderControlCenter({ ...baseCtx(), escHtml: undefined }, initialControlCenterState()); }
  catch (e) { threw = e instanceof TypeError; }
  assert(threw, '9h-1: renderControlCenter() throws a TypeError when escHtml is missing');
  threw = false;
  try { renderControlCenter({ ...baseCtx(), icon: undefined }, initialControlCenterState()); }
  catch (e) { threw = e instanceof TypeError; }
  assert(threw, '9h-2: …and the same when `icon` is missing');

  // DI-422 (2026-09-28) — Help Center MOVED from renderHelpFooter() into
  // renderFeedbackRulesGroup()'s "Help & Feedback" group (row 11 of the
  // DI's coverage matrix: "Help Center" pulled up from the footer group).
  const helpHTML = renderHelpFooter(baseCtx());
  const expectedCopy = "The Help Center isn't available yet — it's coming in a future update.";
  assert(!helpHTML.includes('data-action="coming-soon"') && !helpHTML.includes('Help Center'),
    '9i-1: DI-422 — renderHelpFooter() no longer renders the Help Center row at all (moved into "Help & Feedback")');
  assert(helpHTML.includes('href="privacy.html"'), '9i-3: the footer still links to privacy.html');
  const feedbackGroupHTML = renderFeedbackRulesGroup(baseCtx(), initialControlCenterState());
  assert(feedbackGroupHTML.includes('data-action="coming-soon"') && feedbackGroupHTML.includes('Help Center'),
    '9i-4: DI-422 — the Help Center row now lives inside renderFeedbackRulesGroup()\'s own "Help & Feedback" output');
  assert(feedbackGroupHTML.includes(`data-coming-soon-copy="${escHtml(expectedCopy)}"`),
    '9i-5: …carrying the exact shared-pattern copy string, escaped, at its new home');

  // Emoji sweep — ✕ (U+2715, close control) is an allowed plain symbol glyph
  // (existing `showAccountSheet()` precedent, file header note 7); ‹ is no
  // longer used anywhere (fix round 1 finding 7 replaced it with
  // icon('chevronLeft')), so nothing else needs allow-listing.
  const fullHTML = renderControlCenter(
    baseCtx({ flags: { isCommissioner: true, isPlatformAdmin: true, isSuperAdmin: true, isPilotLeague: true } }),
    { ...initialControlCenterState(), phase: 'open' },
  );
  const sweepTarget = fullHTML.replace(/✕/gu, '');
  const emojiPattern = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert(!emojiPattern.test(sweepTarget), '9j: no emoji code points anywhere in the rendered chrome, aside from the allowed ✕ glyph');
  assert(!fullHTML.includes('‹'), '9j-2: FIX ROUND 1 finding 7 — the literal ‹ character is gone entirely, replaced by icon(\'chevronLeft\')');

  assert(!fullHTML.includes('cc-view-league-as') && !fullHTML.includes('View League As') && !fullHTML.includes('View League as'),
    '9k: FIX ROUND 1 finding 5 — the "View League As" row is gone entirely, under every flag combination, with no residual callback hook');

  // FIX ROUND 1, finding 7 — the Profile back affordance.
  const profileScreenHTML = renderProfileScreen(baseCtx());
  assert(profileScreenHTML.includes('data-icon="chevronLeft"'), '9l: the Profile pane\'s back affordance renders icon(\'chevronLeft\') (the real Phase-1 icon), not a literal ‹');
  // STEP B(7) / N4 (third pass) — account rows only in Supabase auth mode,
  // Password row carries the drill-in chevron, label per DI-335.
  assert(!profileScreenHTML.includes('cc-open-password-change') && !profileScreenHTML.includes('cc-open-delete-account'),
    'N4-a: with no accountRows flag (any non-supabase mode) the Password and Delete Account rows are NOT rendered');
  const acctHTML = renderProfileScreen(baseCtx({ accountRows: true }));
  const pwRow = (acctHTML.match(/<button[^>]*data-action="cc-open-password-change"[\s\S]*?<\/button>/) || [''])[0];
  assert(!!pwRow && pwRow.includes('cc-row-chevron') && pwRow.includes('data-icon="chevronRight"') && acctHTML.includes('cc-open-delete-account'),
    'N4-b: accountRows:true renders both rows, and the Password row carries the chevronRight drill-in affordance');
  assert(/>Password</.test(pwRow), 'N4-c: unknown password identity -> neutral "Password" label');
  assert(/>Change Password</.test(renderProfileScreen(baseCtx({ accountRows: true, hasPasswordIdentity: true }))), 'N4-d: a password identity -> "Change Password"');
  assert(/>Set Password</.test(renderProfileScreen(baseCtx({ accountRows: true, hasPasswordIdentity: false }))), 'N4-e: Google-only -> "Set Password"');

  // FIX ROUND 1, finding 6 — renderStarredPanels() produces TWO labeled
  // groups, Super Admin nested inside "Admin", labels escaped through
  // ctx.escHtml (proven with a TRACKING escHtml, not the pass-through one).
  const trackingEsc = (s) => `[[${s}]]`;
  const starredCtx = baseCtx({
    escHtml: trackingEsc,
    flags: { isCommissioner: true, isPlatformAdmin: true, isSuperAdmin: true },
  });
  const starredHTML = renderStarredPanels(starredCtx);
  const groupBlocks = starredHTML.split('control-center-group--starred');
  assert(groupBlocks.length - 1 === 2, `9m-1: exactly TWO labeled starred groups render when all three flags are set (got ${groupBlocks.length - 1})`);
  assert(starredHTML.includes('[[Admin]]') && starredHTML.includes('[[Commissioner]]'), '9m-2: both group LABELS are routed through the injected escHtml (tracking wrapper proves the call, not just a pass-through)');
  assert(starredHTML.includes('[[Super Admin Panel]]') && starredHTML.includes('[[Admin Panel]]'), '9m-3: both admin-group ROW labels are also escaped');
  const adminGroupIdx = starredHTML.indexOf('[[Admin]]');
  const commGroupIdx = starredHTML.indexOf('[[Commissioner]]');
  const superRowIdx = starredHTML.indexOf('[[Super Admin Panel]]');
  const adminRowIdx = starredHTML.indexOf('[[Admin Panel]]');
  assert(adminGroupIdx < superRowIdx && superRowIdx < adminRowIdx && adminRowIdx < commGroupIdx,
    '9m-4: document order is Admin (group label) -> Super Admin Panel -> Admin Panel -> Commissioner (group label) — Super Admin sits INSIDE the Admin group, before the Commissioner group even starts');

  const commissionerOnlyHTML = renderStarredPanels(baseCtx({ flags: { isCommissioner: true } }));
  assert(!commissionerOnlyHTML.includes('Admin') , '9n: commissioner-only -> the "Admin" group is entirely absent (deny-by-default extends to whole groups, not just rows)');

  assert(renderStarredPanels(baseCtx()) === '', '9o: no flags at all -> renderStarredPanels() returns an empty string, no empty group shells');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[10] bindControlCenterEdgeSwipe() — FIX ROUND 1 finding 3: must not suspend itself…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;

  function makeFakeWindow() {
    const handlers = {};
    return {
      Capacitor: { isNativePlatform: () => true },
      // DI-419 (2026-09-28) — isInDrawerOpenZone() reads window.innerWidth
      // fresh on every touchstart; 400px matches [7]'s own fixture width
      // (100px = the 25% boundary), so every touch coordinate below keeps
      // its pre-DI-419 "inside/outside the zone" meaning.
      innerWidth: 400,
      addEventListener(type, fn) { handlers[type] = fn; },
      removeEventListener(type) { delete handlers[type]; },
      _fire(type, evt) { handlers[type]?.(evt); },
    };
  }
  // DI-419 — Picks/Dashboard is the realistic case for this section's own
  // zone-based (arm/no-arm) coverage; a caller with no getTab() (defaults to
  // `null`, "not Picks/Dashboard") gets "anywhere," per DI-419's own rule —
  // exercised separately, structurally, below.
  const GET_TAB_PICKS = { getTab: () => 'picks' };
  function touch(x, y) { return { touches: [{ clientX: x, clientY: y }] }; }
  function touchOn(x, y, target) { return { touches: [{ clientX: x, clientY: y }], target }; }

  // 10a: REVIEWER ROUND 2 (B3 BLOCK, coordinator ruling, 2026-09-28) —
  // bindControlCenterEdgeSwipe() is NO LONGER native-only. DI-301's own
  // "web gets tap-only, no edge-swipe" carve-out is AMENDED (dated, in
  // js/control-center.js's own file-header note directly above this
  // function): the drawer's edge-swipe now binds and arms IDENTICALLY on
  // web (no Capacitor bridge at all) as on native. The OLD version of this
  // test asserted the opposite (a fake window whose addEventListener threw
  // if the binder ever tried to attach off-native) — replaced, not merely
  // deleted, since "binds on web too" is exactly the behavior B3 requires
  // and a real regression here would otherwise go unnoticed.
  {
    const fakeWin = makeFakeWindow();
    delete fakeWin.Capacitor; // explicitly no native bridge — a genuine web browser
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300, ...GET_TAB_PICKS });
    fakeWin._fire('touchstart', touch(10, 300));
    fakeWin._fire('touchmove', touch(30, 300));
    assert(events.some(e => e.type === 'drag-start'),
      '10a: [B3] web (no Capacitor bridge) — the drawer edge-swipe arms just like native; DI-301\'s native-only carve-out is amended, not just untested');
    unbind();
  }
  // 10a2: the ONLY remaining early-return guard is the dispatch/getState
  // contract check — unrelated to platform, still enforced after B3.
  {
    const unbindBad = bindControlCenterEdgeSwipe(null, null);
    assert(typeof unbindBad === 'function', '10a2: still returns a callable no-op unbind when dispatch/getState are missing (a contract check, not a platform gate)');
  }

  globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: {} } };

  // 10b: closed drawer, outside the shared drawer zone (Picks, x>=100 of a
  // 400px viewport = 25%) -> never arms.
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), GET_TAB_PICKS);
    fakeWin._fire('touchstart', touch(100, 300));
    fakeWin._fire('touchmove', touch(160, 300));
    assert(events.length === 0, '10b: [DI-419] outside the 25%-of-viewport drawer zone on Picks (closed drawer), the gesture never arms');
    unbind();
  }

  // 10c: closed drawer, inside the shared drawer zone -> arms.
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300, ...GET_TAB_PICKS });
    fakeWin._fire('touchstart', touch(10, 300));
    fakeWin._fire('touchmove', touch(30, 300));
    assert(events.some(e => e.type === 'drag-start'), '10c: [DI-419] inside the drawer zone, past the axis dead-zone, arms a drag');
    unbind();
  }

  // 10c2: [DI-419] EVERY OTHER TAB — "anywhere" opens the drawer, even well
  // outside the old 28px/new 25% zone shape, per Drew's own ruling.
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300, getTab: () => 'chat' });
    fakeWin._fire('touchstart', touch(350, 300)); // 87.5% across — well outside Picks/Dashboard's own zone
    fakeWin._fire('touchmove', touch(300, 300));
    assert(events.some(e => e.type === 'drag-start'), '10c2: on a non-Picks/Dashboard tab, a touch starting far from the left edge still arms the drawer');
    unbind();
  }

  // 10c3: [DI-419] a caller that omits opts.getTab() entirely still gets
  // "anywhere" (defaults to `null`, read as "not Picks/Dashboard") — never
  // a silent full block. This fixture's `touch(x,y)` events also carry no
  // `target` at all, so isInDrawerOpenZone()'s B1/B2 `target` check (round
  // 2, below) safely defaults to "never yields" here — a NEW section covers
  // the yield-target behavior (a `.chat-msg`/scroller/text-field target)
  // directly, with a real `target`.
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300 });
    fakeWin._fire('touchstart', touch(350, 300));
    fakeWin._fire('touchmove', touch(300, 300));
    assert(events.some(e => e.type === 'drag-start'), '10c3: omitting opts.getTab() entirely still arms (defaults to null -> "not Picks/Dashboard" -> anywhere)');
    unbind();
  }

  // 10c4-c7: REVIEWER ROUND 2 (B1/B2 BLOCK, 2026-09-28) — the DRAWER's own
  // arm check refuses a touch starting on a yield-target, on the Chat tab
  // ("anywhere" would otherwise claim it) — direct coverage at THIS call
  // site; the combined drawer+bindMessageSwipe simulation lives at
  // chatscrolltest.mjs [8].
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300, getTab: () => 'chat' });
    const msgTarget = { closest: (sel) => (String(sel).includes('.chat-msg') ? msgTarget : null) };
    fakeWin._fire('touchstart', touchOn(350, 300, msgTarget)); // "anywhere" on Chat — would normally arm
    fakeWin._fire('touchmove', touchOn(300, 300, msgTarget));
    assert(events.length === 0, '10c4: [B1] a touch starting on a .chat-msg target never arms the drawer, even on Chat\'s own "anywhere" zone');
    unbind();
  }
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300, getTab: () => 'chat' });
    const fieldTarget = { closest: (sel) => (String(sel).includes('input') ? fieldTarget : null) };
    fakeWin._fire('touchstart', touchOn(350, 300, fieldTarget));
    fakeWin._fire('touchmove', touchOn(300, 300, fieldTarget));
    assert(events.length === 0, '10c5: [B2] a touch starting on an <input> target never arms the drawer either');
    unbind();
  }
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300, getTab: () => 'chat' });
    const scrollerTarget = { scrollLeft: 30, closest(sel) { return String(sel).includes('.comm-tabbar') ? this : null; } };
    fakeWin._fire('touchstart', touchOn(350, 300, scrollerTarget));
    fakeWin._fire('touchmove', touchOn(300, 300, scrollerTarget));
    assert(events.length === 0, '10c6: [B2] a touch starting on a .comm-tabbar with room to scroll back (scrollLeft>0) never arms the drawer');
    unbind();
  }
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300, getTab: () => 'chat' });
    const scrollerAtRest = { scrollLeft: 0, closest(sel) { return String(sel).includes('.comm-tabbar') ? this : null; } };
    fakeWin._fire('touchstart', touchOn(350, 300, scrollerAtRest));
    fakeWin._fire('touchmove', touchOn(300, 300, scrollerAtRest));
    assert(events.some(e => e.type === 'drag-start'), '10c7: [B2] …but a .comm-tabbar ALREADY at rest (scrollLeft 0) does NOT refuse — the drawer arms normally');
    unbind();
  }

  // 10d: open drawer, drag anywhere -> arms (not edge-gated).
  {
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const state = { ...initialControlCenterState(), phase: 'open' };
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => state, { getWidthPx: () => 300 });
    fakeWin._fire('touchstart', touch(250, 300));
    fakeWin._fire('touchmove', touch(200, 300));
    assert(events.some(e => e.type === 'drag-start'), '10d: drawer OPEN — a drag arms regardless of starting x');
    unbind();
  }

  // 10e — THE FIX ITSELF. A fake `document` that RETURNS A NODE for
  // `#control-center[data-open="true"]` — simulating nav-gestures.js's
  // FUTURE amended gesturesSuspended(), which per the wiring checklist will
  // say "suspended" whenever this drawer is open. The binder must NOT
  // consult that (or any equivalent self-referential check) — dragging the
  // open drawer must still work.
  {
    globalThis.document = {
      getElementById: () => null, // no site-gate-overlay, no chat-sheet-wrap
      querySelector: (sel) => {
        if (sel === '#control-center[data-open="true"]') return { id: 'control-center' }; // "the drawer is open"
        if (sel === '.modal-overlay') return null; // no OTHER modal is open
        return null;
      },
      body: { dataset: {} },
    };
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const state = { ...initialControlCenterState(), phase: 'open' };
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => state, { getWidthPx: () => 300 });
    fakeWin._fire('touchstart', touch(250, 300));
    fakeWin._fire('touchmove', touch(200, 300));
    assert(events.some(e => e.type === 'drag-start'),
      '10e: FIX ROUND 1 FINDING 3 — even when a document query for "#control-center[data-open=\\"true\\"]" (the drawer\'s OWN open-state, exactly what the amended shared gesturesSuspended() will check) returns a node, dragging the OPEN drawer left still arms and closes — this binder never treats its own openness as a suspension');
    unbind();
  }

  // 10f: a GENUINE other suspension (real gate) still blocks — the fix must
  // not have thrown out real suspension along with the self-reference.
  {
    globalThis.document = { getElementById: (id) => (id === 'site-gate-overlay' ? {} : null), querySelector: () => null, body: { dataset: {} } };
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState());
    fakeWin._fire('touchstart', touch(5, 300));
    fakeWin._fire('touchmove', touch(50, 300));
    assert(events.length === 0, '10f: a REAL other suspension (site-gate-overlay) still blocks the edge-swipe from arming at all');
    unbind();
  }

  // 10g: a real OTHER modal also still blocks.
  {
    globalThis.document = { getElementById: () => null, querySelector: (sel) => (sel === '.modal-overlay' ? {} : null), body: { dataset: {} } };
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState());
    fakeWin._fire('touchstart', touch(5, 300));
    fakeWin._fire('touchmove', touch(50, 300));
    assert(events.length === 0, '10g: a real OTHER modal (.modal-overlay) still blocks the edge-swipe');
    unbind();
  }

  // 10h/10i: reviewer B4 (3c fix window, third pass) — the League Page overlay
  // and the wizard sheet carry their OWN native drags; a touch at clientX 10
  // (inside the 28 px band) must not arm the drawer too. 10j: the control —
  // the same touch with neither present DOES arm it.
  for (const [label, id] of [['10h', 'league-page-overlay'], ['10i', 'week-wizard-sheet-wrap']]) {
    globalThis.document = { getElementById: (x) => (x === id ? {} : null), querySelector: () => null, body: { dataset: {} } };
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300 });
    fakeWin._fire('touchstart', touch(10, 300));
    fakeWin._fire('touchmove', touch(60, 300));
    fakeWin._fire('touchend', touch(60, 300));
    assert(events.length === 0, `${label}: with #${id} up, an edge touch at clientX 10 does NOT start a drawer drag (one gesture owner per touch)`);
    unbind();
  }
  {
    globalThis.document = { getElementById: () => null, querySelector: () => null, body: { dataset: {} } };
    const fakeWin = makeFakeWindow();
    globalThis.window = fakeWin;
    const events = [];
    const unbind = bindControlCenterEdgeSwipe(ev => events.push(ev), () => initialControlCenterState(), { getWidthPx: () => 300, ...GET_TAB_PICKS });
    fakeWin._fire('touchstart', touch(10, 300));
    fakeWin._fire('touchmove', touch(60, 300));
    assert(events.length > 0, '10j non-vacuity: with neither surface up, the SAME edge touch does start the drawer drag');
    unbind();
  }

  globalThis.window = savedWindow;
  globalThis.document = savedDocument;
}

// ═════════════════════════════════════════════════════════════════════════
// A MINIMAL, REAL-ENOUGH FAKE DOM — see the file header. Supports exactly
// what js/control-center.js's mountControlCenter() actually calls.
// ═════════════════════════════════════════════════════════════════════════

const VOID_TAGS = new Set(['br', 'img', 'hr', 'meta', 'link']);

function toDataAttr(prop) {
  return 'data-' + String(prop).replace(/[A-Z]/g, m => '-' + m.toLowerCase());
}

class FakeElement {
  constructor(tagName) {
    this.tagName = String(tagName || 'div').toUpperCase();
    this._attrs = new Map();
    this.children = [];
    this.parentNode = null;
    this._listeners = {};
    this.style = {
      _props: {},
      setProperty(k, v) { this._props[k] = v; },
      getPropertyValue(k) { return this._props[k] || ''; },
    };
    this.disabled = false;
    this._value = '';
    const self = this;
    this.dataset = new Proxy({}, {
      get(_, prop) { return self._attrs.get(toDataAttr(prop)); },
      set(_, prop, value) { self._attrs.set(toDataAttr(prop), String(value)); return true; },
    });
  }
  get id() { return this._attrs.get('id') || ''; }
  set id(v) { this._attrs.set('id', v); }
  get className() { return this._attrs.get('class') || ''; }
  get value() { return this._value; }
  set value(v) { this._value = v; }
  get defaultValue() { return this._defaultValue ?? ''; }
  setAttribute(name, value) { this._attrs.set(name, value === undefined ? '' : String(value)); }
  getAttribute(name) { return this._attrs.has(name) ? this._attrs.get(name) : null; }
  removeAttribute(name) { this._attrs.delete(name); }
  hasAttribute(name) { return this._attrs.has(name); }
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter(f => f !== fn); }
  _dispatch(type, evt = {}) { (this._listeners[type] || []).slice().forEach(fn => fn({ target: this, ...evt })); }
  focus() { if (typeof document !== 'undefined') document.activeElement = this; }
  set innerHTML(html) {
    const kids = parseHTML(html);
    for (const k of kids) k.parentNode = this;
    this.children = kids;
  }
  get innerHTML() { return '[parsed]'; }
  querySelector(sel) { return findAll(this, sel)[0] || null; }
  querySelectorAll(sel) { return findAll(this, sel); }
  closest(sel) {
    let node = this;
    while (node) { if (elMatchesSelectorList(node, sel)) return node; node = node.parentNode; }
    return null;
  }
}

function parseAttrs(el, attrStr) {
  if (!attrStr) return;
  const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|[^\s>]+))?/g;
  let am;
  while ((am = attrRe.exec(attrStr))) {
    const name = am[1];
    if (!name) continue;
    const value = am[3] !== undefined ? am[3] : (am[4] !== undefined ? am[4] : (am[2] !== undefined ? am[2] : ''));
    el.setAttribute(name, value);
    // `value` and `defaultValue` are set TOGETHER at parse time — the same
    // real-DOM contract field-preserve.js's dirty check relies on: `value`
    // is the LIVE property (mutable afterward by test code / a real edit),
    // `defaultValue` is a snapshot of what the markup itself specified and
    // never changes again for this node.
    if (name === 'value') { el.value = value; el._defaultValue = value; }
  }
}

/** A small, well-formed-input-only HTML parser — see the file header for
 *  scope. Returns the TOP-LEVEL child element array. */
function parseHTML(html) {
  const root = { children: [] };
  const stack = [root];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\s*(\/?)>/g;
  let m;
  while ((m = tagRe.exec(html))) {
    const [, closing, tagName, attrStr, selfClose] = m;
    if (closing) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const el = new FakeElement(tagName);
    parseAttrs(el, attrStr || '');
    el.parentNode = stack[stack.length - 1] === root ? null : stack[stack.length - 1];
    stack[stack.length - 1].children.push(el);
    const isVoid = selfClose === '/' || VOID_TAGS.has(tagName.toLowerCase());
    if (!isVoid) stack.push(el);
  }
  return root.children;
}

function parseCompound(compound) {
  let s = compound.trim();
  const result = { tag: null, id: null, classes: [], attrs: [] };
  const re = /(#[-\w]+)|(\.[-\w]+)|(\[[^\]]+\])|([a-zA-Z][a-zA-Z0-9-]*)/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) result.id = m[1].slice(1);
    else if (m[2]) result.classes.push(m[2].slice(1));
    else if (m[3]) {
      const am = m[3].slice(1, -1).match(/^([-a-zA-Z0-9_:]+)(?:="([^"]*)")?$/);
      if (am) result.attrs.push({ name: am[1], value: am[2] });
    } else if (m[4]) result.tag = m[4].toUpperCase();
  }
  return result;
}

function elMatchesCompound(el, compound) {
  if (!el || !el.tagName) return false;
  if (compound.tag && el.tagName !== compound.tag) return false;
  if (compound.id && el.id !== compound.id) return false;
  for (const c of compound.classes) {
    if (!(el.className || '').split(/\s+/).includes(c)) return false;
  }
  for (const a of compound.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    if (a.value !== undefined && el.getAttribute(a.name) !== a.value) return false;
  }
  return true;
}

function elMatchesSelectorList(el, selector) {
  return selector.split(',').some(part => elMatchesCompound(el, parseCompound(part.trim())));
}

function findAll(root, selector) {
  const out = [];
  function walk(el) {
    for (const child of el.children || []) {
      if (elMatchesSelectorList(child, selector)) out.push(child);
      walk(child);
    }
  }
  walk(root);
  return out;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[11] mountControlCenter() — FIX ROUND 1 findings 1, 2, 8, 9…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} }; // no Capacitor -> edge-swipe binder no-ops
  globalThis.document = { addEventListener() {}, removeEventListener() {}, activeElement: null };

  // ── 11a-11d: root-node stability (finding 1), NO hand-dispatched transitionend anywhere in this block. ──
  {
    const root = new FakeElement('div');
    const ctx = baseCtx();
    const paintLog = [];
    const api = mountControlCenter(root, ctx, { onAfterPaint: (r, s) => paintLog.push(s.phase) });

    const drawer1 = root.querySelector('#control-center');
    const backdrop1 = root.querySelector('#control-center-backdrop');
    const mainContent1 = root.querySelector('[data-pane-content="main"]');
    assert(!!drawer1 && !!backdrop1 && !!mainContent1, '11a-0: fixture sanity — the initial mount produced a real #control-center/#control-center-backdrop/content tree');
    assert(paintLog.length === 1 && paintLog[0] === 'closed', '11a-1: onAfterPaint fires once after the initial mount');

    api.open(); // motion path (no reducedMotion stub -> prefersReducedMotion() reads false, no matchMedia global)
    const drawer2 = root.querySelector('#control-center');
    assert(drawer2 === drawer1, '11b: FIX ROUND 1 FINDING 1 — #control-center is the SAME node instance after api.open() (was a BRAND NEW node every dispatch before the fix)');
    assert(api.getState().phase === 'opening', '11b-2: phase is the transient "opening" (root never got the chance to be "born already open" — no transitionend has fired)');

    // A content-affecting dispatch (open a settings row) — even THIS must
    // not touch the DRAWER ROOT or BACKDROP, only the main pane's content
    // container.
    root._dispatch('click', {
      target: (() => {
        // Can't toggle a settings row until the drawer is fully 'open' in a
        // strict UX sense, but the reducer doesn't actually gate toggle-row
        // on phase — confirm the ROOT survives regardless.
        const btn = new FakeElement('button');
        btn.setAttribute('data-action', 'cc-toggle-row');
        btn.setAttribute('data-group', 'settings');
        btn.setAttribute('data-row', 'timezone');
        btn.parentNode = root;
        return btn;
      })(),
    });
    const drawer3 = root.querySelector('#control-center');
    const backdrop3 = root.querySelector('#control-center-backdrop');
    assert(drawer3 === drawer1 && backdrop3 === backdrop1, '11c: the root/backdrop nodes are STILL the same instances after a content-affecting dispatch (toggle-row)');
    assert(root.querySelector('[data-row="timezone"] .control-center-row-body') !== null || root.querySelector('#cc-body-timezone') !== null,
      '11c-2: …and the content repaint DID actually happen — the timezone row\'s body is now present');
    // F11 (pass-2 reviewer, 2026-09-25) — the inner clipping wrapper: a CSS
    // grid track cannot itself clip content during the 0fr->1fr transition
    // (the abrupt "pop" the Design Philosophy names), so `.control-center-row-body`
    // needs a CHILD with `overflow:hidden;min-height:0` to actually collapse.
    assert(root.querySelector('.control-center-row-body-inner') !== null,
      '11c-3: F11 — .control-center-row-body wraps its content in .control-center-row-body-inner (the actual clipping element)');

    api.destroy();
  }

  // ── 11e: phase completes via the REAL setTimeout fallback — no hand-dispatched transitionend anywhere in this test. ──
  {
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx());
    api.open();
    assert(api.getState().phase === 'opening', '11e-1: fixture check — opening (motion path)');
    // Real wait, bounded: DRAWER_MOTION_MS + 40 is the armed delay; give it
    // a comfortable margin without hand-firing transitionend.
    await new Promise(resolve => setTimeout(resolve, DRAWER_MOTION_MS + 120));
    assert(api.getState().phase === 'open', `11e-2: FIX ROUND 1 FINDING 1 — phase advanced to "open" via the REAL setTimeout fallback alone (no transitionend was ever dispatched in this test) — was permanently stuck under the old bug`);
    api.destroy();
  }

  // ── 11f: onAfterPaint + update() (finding 2). DI-422 — Team logos is now
  // an accordion row (accordionRow() shape, finding 12): the switch control
  // lives in the row's BODY, so the "logo-view" row must be expanded (a
  // 'cc-toggle-row' dispatch) before the switch exists in the DOM at all —
  // re-derived from the old always-visible-toggle fixture. ──
  {
    const root = new FakeElement('div');
    const ctx1 = baseCtx({ logoView: false });
    const paintLog = [];
    const api = mountControlCenter(root, ctx1, { onAfterPaint: () => paintLog.push(1) });
    const countAfterMount = paintLog.length;
    assert(countAfterMount >= 1, '11f-1: onAfterPaint fires at least once at mount');

    api.open();
    root._dispatch('click', { target: root.querySelector('[data-action="cc-toggle-row"][data-group="settings"][data-row="logo-view"]') });
    const toggleBtn = root.querySelector('[data-action="cc-toggle-logo-view"]');
    assert(!!toggleBtn, '11f-2: fixture sanity — the logo-view toggle row rendered once its accordion row is expanded (DI-422)');

    let savedValue = null;
    const ctx2 = baseCtx({ logoView: false, callbacks: { onSetLogoView: (v) => { savedValue = v; } } });
    // Re-mount with the real callback wired (baseCtx() above had none) —
    // simplest way to exercise the callback without reaching into closures.
    const root2 = new FakeElement('div');
    const api2 = mountControlCenter(root2, ctx2, {});
    api2.open();
    root2._dispatch('click', { target: root2.querySelector('[data-action="cc-toggle-row"][data-group="settings"][data-row="logo-view"]') });
    root2._dispatch('click', { target: root2.querySelector('[data-action="cc-toggle-logo-view"]') });
    assert(savedValue === true, '11f-3: tapping the Team-logos toggle calls onSetLogoView(true) via the SAME content the mount built');

    // update(): a fresh ctx reflecting the saved preference — content
    // reflects it, phase/pane/open-row (still "logo-view", untouched by
    // update()) are preserved.
    assert(api2.getState().settingsOpenRow === 'logo-view', '11f-4: fixture — the logo-view row is still the open row before update()');
    api2.update(baseCtx({ logoView: true }));
    const toggleAfterUpdate = root2.querySelector('[data-action="cc-toggle-logo-view"]');
    assert(toggleAfterUpdate?.getAttribute('aria-checked') === 'true', '11f-5: update(nextCtx) re-renders content against the NEW ctx (logoView:true now reflected)');
    assert(api2.getState().settingsOpenRow === 'logo-view', '11f-6: …while PRESERVING the open accordion row (state untouched by update())');
    assert(api2.getState().phase === 'opening' || api2.getState().phase === 'open', '11f-7: …and the drawer phase is also preserved (still open/opening, not reset to closed)');

    api.destroy(); api2.destroy();
  }

  // ── 11g: no content repaint on drag-move; --cc-drag-progress updates
  // directly; focus only on closed->open; light haptic on api.open(). Needs
  // a genuine native-shell mount so the real bindControlCenterEdgeSwipe()
  // (covered independently in [10]) is the thing driving the drag. ──
  {
    globalThis.window = {
      Capacitor: { isNativePlatform: () => true },
      _listeners: {},
      addEventListener(type, fn) { this._listeners[type] = fn; },
      removeEventListener(type) { delete this._listeners[type]; },
      _fire(type, evt) { this._listeners[type]?.(evt); },
    };
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx(), {});
    const mainContentEl = root.querySelector('[data-pane-content="main"]');
    const childrenRefBefore = mainContentEl.children;
    const drawerEl = root.querySelector('#control-center');

    globalThis.window._fire('touchstart', { touches: [{ clientX: 10, clientY: 300 }] });
    globalThis.window._fire('touchmove', { touches: [{ clientX: 50, clientY: 300 }] });
    const mainContentAfterDrag = root.querySelector('[data-pane-content="main"]');
    assert(mainContentAfterDrag.children === childrenRefBefore,
      '11h-1: FIX ROUND 1 FINDING 8 — a drag-move NEVER touches the main pane content (children array reference is untouched — no innerHTML reassignment happened)');
    assert(drawerEl.style._props['--cc-drag-progress'] !== undefined && Number(drawerEl.style._props['--cc-drag-progress']) > 0,
      '11h-2: …but the --cc-drag-progress custom property on the STABLE root DID update, live, during the drag (1:1 finger tracking hook)');

    globalThis.window._fire('touchend', {});
    api.destroy();
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
  }

  // ── 11i: focus only on closed->open, never on every subsequent paint. ──
  {
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx());
    const closeBtn = root.querySelector('[data-action="cc-close"]');
    api.open();
    assert(document.activeElement === closeBtn, '11i-1: opening from closed focuses the close control');
    // Simulate the player focusing something else inside the drawer, then
    // trigger an unrelated content-affecting dispatch — focus must NOT jump
    // back to the close button (fix round 0 refocused on every paint).
    const otherEl = root.querySelector('[data-action="cc-toggle-row"][data-group="settings"][data-row="timezone"]');
    document.activeElement = otherEl;
    root._dispatch('click', { target: otherEl });
    assert(document.activeElement === otherEl, '11i-2: FIX ROUND 1 FINDING 8 — a later content-affecting dispatch does NOT steal focus back to the close button');
    api.destroy();
  }

  // ── 11j: light haptic on api.open() (finding 8) — via js/haptics.js's real plugin-call fixture. ──
  {
    const haptics = await import('./js/haptics.js');
    const calls = [];
    globalThis.window = {
      Capacitor: { isNativePlatform: () => true, Plugins: { Haptics: { impact: (o) => calls.push(o) } } },
      addEventListener() {}, removeEventListener() {},
    };
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx());
    api.open();
    // iOS shell parity check (2026-09-26) — the installed @capacitor/haptics
    // iOS plugin compares style strings CASE-SENSITIVELY against
    // 'MEDIUM'/'LIGHT'/'HEAVY' (js/haptics.js); 'Light' fired HEAVY on every
    // call. Updated to the real UPPER-CASE value the fix now sends.
    assert(calls.length === 1 && calls[0].style === 'LIGHT', '11j: FIX ROUND 1 FINDING 8 — api.open() (the header-tap path) fires a LIGHT haptic, matching the swipe-settle-open path');
    api.destroy();
    globalThis.window = { addEventListener() {}, removeEventListener() {} };
    void haptics;
  }

  // ── 11k: field-preserve integration (finding 9) — a dirty Profile field survives a content repaint. ──
  {
    const root = new FakeElement('div');
    const ctx = baseCtx();
    const api = mountControlCenter(root, ctx);
    api.open();
    // Push to Profile and dirty the display-name field.
    root._dispatch('click', { target: root.querySelector('[data-action="cc-push-profile"]') });
    const nameField = root.querySelector('[data-field="display-name"]');
    nameField.value = 'Drew (editing)';
    // Force a content repaint via update() — field-preserve should carry
    // the dirty value across it, per RG-176.
    api.update(baseCtx());
    const nameFieldAfter = root.querySelector('[data-field="display-name"]');
    assert(nameFieldAfter.value === 'Drew (editing)',
      '11k: FIX ROUND 1 FINDING 9 — an in-progress edit in the Profile pane survives a content repaint (update()), via js/field-preserve.js capture/restore, matching RG-176\'s own rule for every other repainted surface');
    api.destroy();
  }

  // ── 11l: SECURITY GATE FINDING 3 (916bdb7 review, 2026-09-25) — the
  // identity header's league-name tap is its OWN target, separate from the
  // avatar/name tap (which stays Profile), and it calls onOpenLeaguePage(),
  // not onNavigate()/onSwitchLeague(). Before this fix League Page had no
  // reachable entry point from the drawer at all. ──────────────────────────
  {
    let openedLeaguePage = 0, pushedProfile = 0;
    const root = new FakeElement('div');
    const ctx = baseCtx({ callbacks: { onOpenLeaguePage: () => { openedLeaguePage++; }, onNavigate: () => { pushedProfile++; } } });
    const api = mountControlCenter(root, ctx);
    api.open();
    const leagueTap = root.querySelector('[data-action="cc-open-league-page"]');
    assert(!!leagueTap, '11l-1: the identity header renders a [data-action="cc-open-league-page"] tap target');
    assert(!!leagueTap && leagueTap.tagName === 'BUTTON',
      '11l-1b: …and it is a real <button>, not a non-interactive span (elements cannot nest buttons, which is why it had to move out)');
    const profileBtn = root.querySelector('[data-action="cc-push-profile"]');
    assert(!!profileBtn && profileBtn.querySelector('[data-action="cc-open-league-page"]') === null,
      '11l-2: the league-name tap target is NOT nested inside the profile-tap button — it is a sibling element, so the two tap targets can never collide (a button cannot contain another button at all)');
    root._dispatch('click', { target: leagueTap });
    assert(openedLeaguePage === 1 && pushedProfile === 0,
      `11l-3: tapping the league name calls onOpenLeaguePage() exactly once, and does NOT also fire onNavigate() (got openedLeaguePage=${openedLeaguePage}, pushedProfile=${pushedProfile})`);
    // 11l-4: the SAME tap ALSO closes the drawer (League Page is a
    // full-screen overlay; leaving the drawer open behind it stacks two
    // dismissable surfaces) — same `dispatch({type:'close'})` shape
    // `cc-navigate`/`cc-close` already use. Asserted as "no longer open/
    // opening" (closing OR closed) rather than a specific terminal phase —
    // the motion-vs-reduced-motion / transition-fallback-timer mechanics
    // are §2's own concern, not this finding's.
    const phaseAfter = root.querySelector('#control-center')?.getAttribute('data-phase');
    assert(phaseAfter === 'closing' || phaseAfter === 'closed',
      `11l-4: tapping the league name also closes the drawer — a close was dispatched (got data-phase="${phaseAfter}")`);
    api.destroy();
  }

  // ── 11m: S2-2 (full-app review, 2026-09-26), RE-DERIVED for DI-418/DI-421
  // (2026-09-28) — "Switch League" is retired; its replacement, "Your
  // Leagues", now lives in the Profile pane and dispatches
  // onOpenLeaguesHome(). Full coverage (fixture + close-before-callback +
  // negative "not in the main pane" + grouping/order) lives in section [15],
  // below — this section keeps only the ORIGINAL S2-2 shape check, re-pointed
  // at the new row/action so the historical regression this guards against
  // (a full-screen surface opening UNDER the still-open drawer) stays
  // covered at its original call site too. ──
  {
    let phaseAtCallback = null;
    const root = new FakeElement('div');
    const ctx = baseCtx({ accountRows: true, callbacks: { onOpenLeaguesHome: () => { phaseAtCallback = root.querySelector('#control-center')?.getAttribute('data-phase'); } } });
    const api = mountControlCenter(root, ctx);
    api.open();
    root._dispatch('click', { target: root.querySelector('[data-action="cc-push-profile"]') });
    const btn = root.querySelector('[data-action="cc-open-leagues-home"]');
    assert(!!btn, '11m fixture: the Profile pane renders a [data-action="cc-open-leagues-home"] ("Your Leagues") row');
    root._dispatch('click', { target: btn });
    assert(phaseAtCallback === 'closing' || phaseAtCallback === 'closed',
      `11m: S2-2 shape preserved — "Your Leagues" closes the drawer BEFORE onOpenLeaguesHome() opens the overlay (phase seen by the callback: "${phaseAtCallback}") — never a full-screen surface under an open drawer`);
    api.destroy();
  }

  // ── 11n: S2-3 (full-app review, 2026-09-26), RE-DERIVED for DI-421
  // (2026-09-28) — Sign Out now lives in the Profile pane. Used to leave the
  // drawer OPEN under the sign-in gate (not inert, back after the next
  // sign-in). It must be fully CLOSED — no slide, the gate paints over it —
  // by the time onSignOut() runs. ──
  {
    let phaseAtCallback = null;
    const root = new FakeElement('div');
    const ctx = baseCtx({ accountRows: true, callbacks: { onSignOut: () => { phaseAtCallback = root.querySelector('#control-center')?.getAttribute('data-phase'); } } });
    const api = mountControlCenter(root, ctx);
    api.open();
    root._dispatch('click', { target: root.querySelector('[data-action="cc-push-profile"]') });
    const signOutBtn = root.querySelector('[data-action="cc-signout"]');
    assert(!!signOutBtn, '11n fixture: the Profile pane renders a [data-action="cc-signout"] row (DI-421)');
    root._dispatch('click', { target: signOutBtn });
    assert(phaseAtCallback === 'closed',
      `11n: S2-3 — Sign Out closes the drawer INSTANTLY before onSignOut() runs (phase seen by the callback: "${phaseAtCallback}", want "closed")`);
    assert(api.getState().phase === 'closed', '11n-2: …and it stays closed afterwards (nothing to reappear after the next sign-in)');
    api.destroy();
  }

  // ── 11o: the api.close({ immediate: true }) teardown form app.js's hold
  // sweep and identity chokepoint call — closed at once, never "closing". ──
  {
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx());
    api.open();
    api.close({ immediate: true });
    assert(api.getState().phase === 'closed',
      `11o: api.close({ immediate: true }) lands on "closed" at once (got "${api.getState().phase}") — a teardown under a gate never waits on a transitionend`);
    api.close({ immediate: true });
    assert(api.getState().phase === 'closed', '11o-2: …and a second close on a closed drawer is a no-op');
    api.destroy();
  }

  globalThis.window = savedWindow;
  globalThis.document = savedDocument;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[12] Finding 6 (app-shell part 3A review, 2026-09-27) — accordionRow() `secondary`, and the Appearance row explained (not silently dead) under a school theme…');
// ═════════════════════════════════════════════════════════════════════════
{
  // 12a — accordionRow()'s new `secondary` param, via renderSettingsAccordion()
  // (no direct export of accordionRow() itself — same "test the real render
  // path" discipline this file already uses elsewhere). The row's BODY
  // (including the <select>) only paints while its own row is the open one
  // (accordionRow()'s `${open ? ... : ''}`, unchanged by this fix) — opened
  // here so 12a-2/12b-3 can see the control at all.
  const neutralHTML = renderSettingsAccordion(baseCtx({ currentTheme: 'neutral' }), { settingsOpenRow: 'appearance' });
  assert(!/cc-row-secondary/.test(neutralHTML),
    '12a: the Munera theme (\'neutral\') — no secondary explanation rendered, and the colorScheme <select> is NOT disabled');
  assert(!/data-field="colorScheme"[^>]*disabled/.test(neutralHTML),
    '12a-2: …the colorScheme <select> carries no disabled attribute under the Munera theme');

  // 12b — a school theme: FINDING 6 — explained, not hidden. The Appearance
  // row itself still renders (discoverable); its control is disabled and a
  // secondary line names why.
  const schoolHTML = renderSettingsAccordion(baseCtx({ currentTheme: 'aggie' }), { settingsOpenRow: 'appearance' });
  assert(/data-row="appearance"/.test(schoolHTML),
    '12b: the Appearance row STILL renders under a school theme — explained, not hidden (Ruling 6 offered either; this pass chose "explained")');
  assert(/cc-row-secondary">Night mode is available with the Munera theme</.test(schoolHTML),
    `12b-2: …with the exact secondary copy named in the finding (got: ${(schoolHTML.match(/cc-row-secondary">[^<]*/) || [''])[0]})`);
  assert(/data-field="colorScheme"[^>]*disabled/.test(schoolHTML),
    '12b-3: …and the colorScheme <select> IS disabled — a dead control (school themes carry no dark-mode CSS branch) never looks live');

  // 12c — every OTHER accordion row is unaffected (no secondary text leaked
  // onto Time zone/Notifications/etc. just because a school theme is active).
  const otherRowsSecondary = (schoolHTML.match(/data-row="(timezone|notifications|scribe|chat|game-settings|theme)"[\s\S]{0,400}?cc-row-secondary/g) || []);
  assert(otherRowsSecondary.length === 0,
    `12c: no OTHER settings row picked up a secondary line as a side effect (got: ${JSON.stringify(otherRowsSecondary)})`);

  // 12d — MUTATION GUARD: prove 12b/12b-2/12b-3 are not vacuous by checking
  // the school-theme markup actually DIFFERS from the neutral-theme markup at
  // the Appearance row (a copy-paste that rendered the same body for both
  // would still pass a same-string-shape test).
  const apptRe = /<div class="control-center-row-wrap" data-row="appearance">[\s\S]*?<\/div>\s*<\/div>/;
  const neutralAppearance = (neutralHTML.match(apptRe) || [''])[0];
  const schoolAppearance = (schoolHTML.match(apptRe) || [''])[0];
  assert(neutralAppearance.length > 0 && schoolAppearance.length > 0 && neutralAppearance !== schoolAppearance,
    '12d: the Appearance row\'s own markup genuinely differs between the Munera theme and a school theme (not a coincidental pass)');
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[13] RG-278 (live v0.27.0 web, Drew 2026-09-28) — "grays out the screen but no settings or control center pops up": a TAP open/close must SETTLE --cc-drag-progress…');
// ═════════════════════════════════════════════════════════════════════════
// css/styles.css positions #control-center ONLY through
//   transform:translateX(calc(-100% + (100% * var(--cc-drag-progress,0))))
// — the settled states are "fully open = progress 1, fully closed = progress
// 0" (that rule's own comment). The drag path honoured that (drag-end sets
// 1/0), but the TAP path (api.open() from #control-center-trigger, and every
// ✕/backdrop/row close) only changed `phase`, so a tap-open left the drawer
// at translateX(-100%) while the backdrop (keyed on data-open) faded in —
// the scrim with no panel. The pixel result is engine-measured in
// shellrendertest.mjs [A]; this section pins the state contract that
// produces it, through the REAL mountControlCenter() on the fake DOM.
{
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, activeElement: null };
  const progressOf = (root) => Number(root.querySelector('#control-center').style._props['--cc-drag-progress']);

  // 13a/13b — the reported path: tap the trigger (api.open(), motion path).
  {
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx());
    assert(progressOf(root) === 0 || Number.isNaN(progressOf(root)), '13a-0: fixture — a freshly mounted, closed drawer is at progress 0 (off-screen)');
    api.open();
    assert(api.getState().phase === 'opening' && root.querySelector('#control-center').getAttribute('data-open') === 'true',
      '13a-1: fixture — api.open() moved the phase to "opening" and data-open="true" (the backdrop\'s own key, so the scrim paints)');
    assert(api.getState().dragProgress === 1 && progressOf(root) === 1,
      `13a-2: THE BUG — a tap-open SETTLES the drawer at --cc-drag-progress 1 (fully on-screen), not 0 (got state ${api.getState().dragProgress}, style ${progressOf(root)}) — at 0 the panel stays at translateX(-100%) behind a visible scrim`);
    api.close();
    assert(api.getState().dragProgress === 0 && progressOf(root) === 0,
      `13b: a tap-close (✕ / backdrop / Esc / a navigating row) settles it back at progress 0 (got state ${api.getState().dragProgress}, style ${progressOf(root)})`);
    api.destroy();
  }
  // 13c — reduced motion takes the synchronous path (straight to "open") and must settle too.
  {
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx());
    globalThis.matchMedia = () => ({ matches: true });
    try { api.open(); } finally { delete globalThis.matchMedia; }
    assert(api.getState().phase === 'open' && progressOf(root) === 1,
      `13c: reduced motion — phase "open" AND progress 1 in one step (got ${api.getState().phase} / ${progressOf(root)})`);
    api.close({ immediate: true });
    assert(api.getState().phase === 'closed' && progressOf(root) === 0,
      `13c-2: an immediate close (sign-out, hold sweep) lands at "closed" AND progress 0 (got ${api.getState().phase} / ${progressOf(root)})`);
    api.destroy();
  }
  // 13d — the mirror image of the bug: swipe OPEN (drag-end settles 1), then
  // tap ✕. Before the fix progress stayed 1, so the panel stayed on screen,
  // inert, after the scrim had gone.
  {
    const s = _controlCenterStateMachine([
      { type: 'drag-start' }, { type: 'drag-move', progress: 0.8 },
      { type: 'drag-end', settleOpen: true }, { type: 'transition-end' },
      { type: 'close' }, { type: 'transition-end' },
    ]);
    assert(s[3].phase === 'open' && s[3].dragProgress === 1,
      `13d-0: fixture — a swipe that settles open is phase "open" at progress 1 (got ${s[3].phase} / ${s[3].dragProgress})`);
    assert(s[5].phase === 'closed' && s[5].dragProgress === 0,
      `13d: swipe-open then TAP-close ends "closed" at progress 0 — never an inert panel left on screen (got ${s[5].phase} / ${s[5].dragProgress})`);
  }
  // 13e — a no-op open/close (already open / already closed) changes nothing.
  {
    const s = _controlCenterStateMachine([{ type: 'close' }, { type: 'open', reducedMotion: true }, { type: 'open', reducedMotion: true }]);
    assert(s[0].phase === 'closed' && s[0].dragProgress === 0 && s[2].phase === 'open' && s[2].dragProgress === 1,
      '13e: close-while-closed stays closed at 0; open-while-open stays open at 1');
  }

  globalThis.window = savedWindow;
  globalThis.document = savedDocument;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[14] v0.27.1 round 2 (reviewer conditions/findings on 33243d1) — the scrim fades WITH the panel on close; an edge drag during "opening" never snaps the panel to 0…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, activeElement: null };

  // 14a/14b — Condition 1. The backdrop's data-open followed
  // isDrawerVisuallyOpen(), which is TRUE all through 'closing' (it has to be
  // for the drawer itself — gesturesSuspended() reads the drawer's data-open),
  // so the scrim sat fully dark for the whole 260 ms slide-out and only then
  // faded: Drew's RG-278 symptom played in reverse.
  {
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx());
    const drawer = root.querySelector('#control-center'), scrim = root.querySelector('#control-center-backdrop');
    api.open();
    assert(api.getState().phase === 'opening' && scrim.getAttribute('data-open') === 'true',
      `14a-0: opening — the scrim fades IN with the panel (scrim data-open ${scrim.getAttribute('data-open')})`);
    api.close();
    assert(api.getState().phase === 'closing', '14a-1: fixture — a motion close is in its transient "closing" phase');
    assert(scrim.getAttribute('data-open') === 'false' && scrim.getAttribute('aria-hidden') === 'true',
      `14a-2: CONDITION 1 — the scrim starts fading OUT the moment the close starts (scrim data-open ${scrim.getAttribute('data-open')}, aria-hidden ${scrim.getAttribute('aria-hidden')}) — not after the panel has already gone`);
    assert(drawer.getAttribute('data-open') === 'true',
      '14a-3: …while the DRAWER still reads data-open="true" through "closing" (the gesturesSuspended() hook is unchanged: no other gesture arms mid-slide)');
    api.destroy();
  }
  {
    const st = (o) => ({ ...initialControlCenterState(), ...o });
    const scrimOf = (html) => (html.match(/id="control-center-backdrop"[^>]*data-open="(true|false)"/) || [])[1];
    const ctx = baseCtx();
    assert(scrimOf(renderControlCenter(ctx, st({ phase: 'closing' }))) === 'false',
      '14b-1: rendered markup agrees — "closing" renders the scrim closed');
    assert(scrimOf(renderControlCenter(ctx, st({ phase: 'open' }))) === 'true' && scrimOf(renderControlCenter(ctx, st({ phase: 'opening' }))) === 'true',
      '14b-2: "open"/"opening" render the scrim open');
    assert(scrimOf(renderControlCenter(ctx, st({ phase: 'closed', dragging: true, dragProgress: 0.3 }))) === 'true'
      && scrimOf(renderControlCenter(ctx, st({ phase: 'closed', dragging: true, dragProgress: 0 }))) === 'false',
      '14b-3: mid-drag the scrim is up while the panel is showing at all, and not before it has moved');
  }

  // 14c — Finding 7. drag-start derived its progress from `phase === 'open'`,
  // so a drag that began during the 260 ms "opening" slide snapped the panel
  // to 0 (off-screen) for a frame. It keeps the settled value now.
  {
    const s = _controlCenterStateMachine([{ type: 'open', reducedMotion: false }, { type: 'drag-start' }]);
    assert(s[0].phase === 'opening' && s[1].dragProgress === 1,
      `14c-1: FINDING 7 — a drag that starts while the drawer is "opening" keeps progress 1, never snaps to 0 (got ${s[1].dragProgress})`);
    const c = _controlCenterStateMachine([{ type: 'drag-start' }]);
    const o = _controlCenterStateMachine([{ type: 'open', reducedMotion: true }, { type: 'drag-start' }]);
    assert(c[0].dragProgress === 0 && o[1].dragProgress === 1,
      `14c-2: the settled cases are unchanged — from "closed" 0, from "open" 1 (got ${c[0].dragProgress} / ${o[1].dragProgress})`);
  }
  // 14d — …and the first MOVE continues from there. Driven through the REAL
  // bindControlCenterEdgeSwipe() on a native window (the binder only exists
  // in the native shell), same shape as 11g.
  {
    globalThis.window = {
      Capacitor: { isNativePlatform: () => true }, _listeners: {},
      addEventListener(type, fn) { this._listeners[type] = fn; },
      removeEventListener(type) { delete this._listeners[type]; },
      _fire(type, evt) { this._listeners[type]?.(evt); },
    };
    const root = new FakeElement('div');
    const api = mountControlCenter(root, baseCtx(), {});
    api.open();                                           // motion: "opening"
    assert(api.getState().phase === 'opening', '14d-0: fixture — mid-"opening"');
    globalThis.window._fire('touchstart', { touches: [{ clientX: 10, clientY: 300 }] });
    globalThis.window._fire('touchmove', { touches: [{ clientX: 30, clientY: 300 }] });
    const p = Number(root.querySelector('#control-center').style._props['--cc-drag-progress']);
    assert(api.getState().dragging === true && p >= 0.99,
      `14d-1: an edge drag caught during "opening" tracks from where the panel IS (progress ${p}), not from 0 — no one-frame snap off-screen`);
    globalThis.window._fire('touchend', {});
    assert(api.getState().phase === 'opening' || api.getState().phase === 'open',
      `14d-2: …and settles open (phase ${api.getState().phase})`);
    api.destroy();
  }

  globalThis.window = savedWindow;
  globalThis.document = savedDocument;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[15] UX Revamp v0.27.2 — DI-418/DI-421/DI-422 (2026-09-28): "Your Leagues" relocated to Profile, drawer grouping…');
// ═════════════════════════════════════════════════════════════════════════
{
  const savedWindow = globalThis.window;
  const savedDocument = globalThis.document;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  globalThis.document = { addEventListener() {}, removeEventListener() {}, activeElement: null };

  // 15a — DI-421: the drawer's MAIN pane (identity header + everything else
  // except Profile) no longer carries Sign Out or a leagues-switch action at
  // all. Mutation guard: this checks every action string AND the retired
  // wrapper class, not just one.
  {
    const mainHTML = renderIdentityHeader(baseCtx()) + renderStarredPanels(baseCtx())
      + renderSettingsAccordion(baseCtx(), initialControlCenterState())
      + renderFeedbackRulesGroup(baseCtx(), initialControlCenterState());
    assert(!mainHTML.includes('cc-signout') && !mainHTML.includes('cc-switch-league') && !mainHTML.includes('cc-open-leagues-home'),
      '15a: DI-421 — none of the drawer\'s main-pane renderers emit Sign Out or a leagues-switch action anywhere');
    assert(!mainHTML.includes('control-center-identity-actions'),
      '15a-2: …and the retired identity-actions wrapper is gone from the main pane too');
  }

  // 15b — DI-421: the PROFILE pane renders "Your Leagues" and "Sign Out", in
  // that order, ONLY when ctx.accountRows === true — the SAME gate
  // accountRowsHTML()'s Password/Delete Account rows use, not a new flag.
  {
    const withRows = renderProfileScreen(baseCtx({ accountRows: true }));
    const yourLeaguesIdx = withRows.indexOf('cc-open-leagues-home');
    const signOutIdx = withRows.indexOf('cc-signout');
    assert(yourLeaguesIdx > -1 && signOutIdx > -1 && yourLeaguesIdx < signOutIdx,
      `15b: DI-421 — Profile renders "Your Leagues" ABOVE "Sign Out" when accountRows:true (yourLeagues@${yourLeaguesIdx}, signOut@${signOutIdx})`);
    assert(/Your Leagues/.test(withRows) && /Sign Out/.test(withRows), '15b-2: fixture — both labels are the exact expected text');

    const withoutRows = renderProfileScreen(baseCtx());
    assert(!withoutRows.includes('cc-open-leagues-home') && !withoutRows.includes('cc-signout'),
      '15b-3: DI-421 — with no accountRows flag (local-PIN mode), NEITHER row renders — no Supabase session to leave, no multi-league concept');
  }

  // 15c — DI-418: "Your Leagues" dispatches onOpenLeaguesHome(), closing the
  // drawer FIRST (same S2-2 shape as cc-navigate/cc-open-league-page),
  // reached through a real Profile push, not a raw HTML string check.
  {
    let opened = 0, phaseAtCallback = null;
    const root = new FakeElement('div');
    const ctx = baseCtx({ accountRows: true, callbacks: { onOpenLeaguesHome: () => { opened++; phaseAtCallback = root.querySelector('#control-center')?.getAttribute('data-phase'); } } });
    const api = mountControlCenter(root, ctx);
    api.open();
    root._dispatch('click', { target: root.querySelector('[data-action="cc-push-profile"]') });
    const btn = root.querySelector('[data-action="cc-open-leagues-home"]');
    assert(!!btn, '15c fixture: the Profile pane renders a [data-action="cc-open-leagues-home"] row');
    root._dispatch('click', { target: btn });
    assert(opened === 1, `15c: tapping "Your Leagues" calls onOpenLeaguesHome() exactly once (got ${opened})`);
    assert(phaseAtCallback === 'closing' || phaseAtCallback === 'closed',
      `15c-2: …and the drawer is already closing/closed by the time it runs (got "${phaseAtCallback}") — never a full-screen surface under an open drawer`);
    api.destroy();
  }

  // 15d — DI-422: "My Preferences" heads Time zone -> Notifications -> Chat
  // settings -> Team logos -> Theme -> Appearance, in that exact document
  // order (Drew's own list order); SCRIBE settings renders but sits OUTSIDE
  // that labeled group, in its own unlabeled one, directly after it.
  {
    const html = renderSettingsAccordion(baseCtx(), initialControlCenterState());
    assert(html.includes('control-center-group-label">My Preferences<'), '15d-1: the "My Preferences" group header renders');
    const order = ['timezone', 'notifications', 'chat', 'logo-view', 'theme', 'appearance', 'scribe']
      .map(rowId => html.indexOf(`data-row="${rowId}"`));
    assert(order.every((idx, i) => idx > -1 && (i === 0 || idx > order[i - 1])),
      `15d-2: Drew's exact row order — Time zone, Notifications, Chat settings, Team logos, Theme, Appearance, then SCRIBE settings (indices ${JSON.stringify(order)})`);
    // Mutation guard — proves SCRIBE is genuinely OUTSIDE the labeled group,
    // not merely rendered LAST inside it: immediately after "My Preferences"'s
    // own closing `</div>`, a SECOND, UNLABELED `.control-center-group` opens
    // whose first child is the scribe row (no group-label between them).
    assert(/<\/div>\s*<div class="control-center-group">\s*<div class="control-center-row-wrap" data-row="scribe">/.test(html),
      '15d-3: SCRIBE settings lives in its OWN unlabeled `.control-center-group`, immediately after "My Preferences" closes — not nested inside it and not preceded by a second label');
  }

  // 15e — DI-422 row 10: Notifications drops its bell icon — "no other
  // button has an icon" (Drew, verbatim).
  {
    const html = renderSettingsAccordion(baseCtx(), initialControlCenterState());
    const notifRow = (html.match(/<div class="control-center-row-wrap" data-row="notifications">[\s\S]*?<\/button>/) || [''])[0];
    assert(!!notifRow && !notifRow.includes('data-icon="bell"') && !notifRow.includes('cc-row-icon'),
      '15e: the Notifications row carries no icon at all (bell removed, DI-422 row 10)');
  }

  // 15f — DI-422 finding 12: Team logos' switch control and helper caption
  // are BOTH absent while the row is collapsed, and BOTH present only once
  // it is the open row — mutation-proven against the SAME ctx, collapsed vs
  // expanded, rather than asserting presence alone.
  {
    const collapsed = renderSettingsAccordion(baseCtx(), initialControlCenterState());
    assert(!collapsed.includes('cc-toggle-logo-view') && !collapsed.includes('Show team logos instead of names'),
      '15f-1: Team logos collapsed -> neither the switch nor the helper caption render at all');
    const expanded = renderSettingsAccordion(baseCtx(), { ...initialControlCenterState(), settingsOpenRow: 'logo-view' });
    assert(expanded.includes('cc-toggle-logo-view') && expanded.includes('Show team logos instead of names'),
      '15f-2: Team logos expanded -> BOTH the switch and the helper caption render, together, inside the body');
  }

  // 15g — DI-422 finding 12: Appearance's school-theme caption is likewise
  // absent while collapsed, even under a school theme — it used to be
  // ALWAYS visible on the collapsed row's own label line; it now lives only
  // in the expanded body.
  {
    const collapsedSchool = renderSettingsAccordion(baseCtx({ currentTheme: 'aggie' }), initialControlCenterState());
    assert(!collapsedSchool.includes('cc-row-secondary'),
      '15g: Appearance collapsed under a school theme -> the "Night mode is available…" caption does NOT render at all (moved into the body, DI-422 finding 12)');
  }

  // 15h — DI-422 rows 11/16: "Help & Feedback" heads Request a game (renamed
  // from "Game settings", same rowId/body) -> Feedback -> Rules -> Version
  // history -> Help Center, in that exact document order, all sharing ONE
  // single-open state (feedbackGroupOpenRow).
  {
    const html = renderFeedbackRulesGroup(baseCtx(), initialControlCenterState());
    assert(html.includes('control-center-group-label">Help &amp; Feedback<'), '15h-1: the "Help & Feedback" group header renders');
    assert(html.includes('>Request a game<') && !html.includes('>Game settings<'),
      '15h-2: the row reads "Request a game", never the old "Game settings" label');
    const idxGame = html.indexOf('data-row="game-settings"');
    const idxFeedback = html.indexOf('data-row="feedback"');
    const idxRules = html.indexOf('data-target="rules"');
    const idxHistory = html.indexOf('data-row="version-history"');
    const idxHelp = html.indexOf('>Help Center<');
    assert([idxGame, idxFeedback, idxRules, idxHistory, idxHelp].every(i => i > -1)
      && idxGame < idxFeedback && idxFeedback < idxRules && idxRules < idxHistory && idxHistory < idxHelp,
      `15h-3: document order is Request a game -> Feedback -> Rules -> Version history -> Help Center (indices ${JSON.stringify([idxGame, idxFeedback, idxRules, idxHistory, idxHelp])})`);
    // Single-open-state sharing — proven through the real state machine, not
    // the render alone: opening "game-settings" (group:'feedback') shares
    // feedbackGroupOpenRow with Feedback/Version history/Help Center's siblings.
    const steps = _controlCenterStateMachine([
      { type: 'toggle-row', group: 'feedback', rowId: 'game-settings' },
      { type: 'toggle-row', group: 'feedback', rowId: 'feedback' },
    ]);
    assert(steps[0].feedbackGroupOpenRow === 'game-settings' && steps[1].feedbackGroupOpenRow === 'feedback',
      '15h-4: "Request a game" shares the SAME single-open group as Feedback/Version history — opening one closes the other');
  }

  // 15i — renderHelpFooter() no longer renders Help Center (DI-422) but
  // still renders the Privacy Policy link.
  {
    const footer = renderHelpFooter(baseCtx());
    assert(!footer.includes('Help Center') && footer.includes('privacy.html'),
      '15i: renderHelpFooter() -> Privacy Policy only, Help Center gone (moved to renderFeedbackRulesGroup())');
  }

  globalThis.window = savedWindow;
  globalThis.document = savedDocument;
}

// ═════════════════════════════════════════════════════════════════════════
console.log('\n[16] REVIEWER ROUND 2 (RG-298, 2026-09-28) — D1 Profile order + chevron,');
console.log('     D2 title suppression is app.js\'s job (see below), minor Help Center chevron,');
console.log('     DI-418\'s membershipsResolved gate…');
// ═════════════════════════════════════════════════════════════════════════
{
  // 16a — D1: exact order Your Leagues -> Password -> Sign Out -> Delete
  // Account, Delete Account LAST inside the danger zone. Index-based, so a
  // reshuffle that keeps all four rows present but in the wrong order fails.
  {
    const html = renderProfileScreen(baseCtx({ accountRows: true, hasPasswordIdentity: true }));
    const idxLeagues = html.indexOf('cc-open-leagues-home');
    const idxPassword = html.indexOf('cc-open-password-change');
    const idxSignOut = html.indexOf('cc-signout');
    const idxDelete = html.indexOf('cc-open-delete-account');
    assert([idxLeagues, idxPassword, idxSignOut, idxDelete].every(i => i > -1)
      && idxLeagues < idxPassword && idxPassword < idxSignOut && idxSignOut < idxDelete,
      `16a: D1 order — Your Leagues -> Password -> Sign Out -> Delete Account (indices ${JSON.stringify([idxLeagues, idxPassword, idxSignOut, idxDelete])})`);
    // Delete Account is the LAST thing in the danger zone, and the danger
    // zone is the last thing in the pane — mutation guard against a row
    // slipped in AFTER Delete Account without moving its own index.
    const deleteZone = html.slice(html.indexOf('control-center-danger-zone'));
    assert(deleteZone.includes('cc-open-delete-account') && !deleteZone.slice(deleteZone.indexOf('cc-open-delete-account') + 1).includes('control-center-row--action'),
      '16a-2: no OTHER action row renders after Delete Account — it is genuinely the last thing in the pane');
  }

  // 16b — D1: "Your Leagues" now carries the SAME drill-in chevron
  // Password/Rules/Help Center carry (it pushes to a whole new screen).
  {
    const html = renderProfileScreen(baseCtx({ accountRows: true }));
    const leaguesRow = (html.match(/<button[^>]*data-action="cc-open-leagues-home"[\s\S]*?<\/button>/) || [''])[0];
    assert(!!leaguesRow && leaguesRow.includes('cc-row-chevron') && leaguesRow.includes('data-icon="chevronRight"'),
      '16b: "Your Leagues" carries the chevronRight drill-in affordance, same as Password');
  }

  // 16c — Minor: Help Center also gets the chevron now.
  {
    const html = renderFeedbackRulesGroup(baseCtx(), initialControlCenterState());
    const helpRow = (html.match(/<button[^>]*data-coming-soon-copy="[^"]*"[\s\S]*?<\/button>/) || [''])[0];
    assert(!!helpRow && helpRow.includes('Help Center') && helpRow.includes('cc-row-chevron') && helpRow.includes('data-icon="chevronRight"'),
      '16c: the Help Center row carries the chevronRight affordance too');
  }

  // 16d — DI-418 "hide Your Leagues while memberships unresolved"
  // (ctx.membershipsResolved). Explicitly `false` hides ONLY that row —
  // Password/Sign Out/Delete Account are unaffected (a DIFFERENT gate,
  // ctx.accountRows, governs those). Absent (undefined, every OTHER fixture
  // in this suite) still renders it — "hold empty only once we KNOW it's
  // unresolved," not "assume unresolved by default."
  {
    const unresolved = renderProfileScreen(baseCtx({ accountRows: true, membershipsResolved: false }));
    assert(!unresolved.includes('cc-open-leagues-home'),
      '16d-1: membershipsResolved:false hides "Your Leagues"');
    assert(unresolved.includes('cc-open-password-change') && unresolved.includes('cc-signout') && unresolved.includes('cc-open-delete-account'),
      '16d-2: …while Password/Sign Out/Delete Account still render (a DIFFERENT gate, unaffected)');
    const resolved = renderProfileScreen(baseCtx({ accountRows: true, membershipsResolved: true }));
    assert(resolved.includes('cc-open-leagues-home'), '16d-3: membershipsResolved:true shows it');
    const absent = renderProfileScreen(baseCtx({ accountRows: true }));
    assert(absent.includes('cc-open-leagues-home'), '16d-4: an ABSENT field (every pre-existing fixture in this file) still shows it — not a silent regression for callers that never set the new field');
  }
}

// ═════════════════════════════════════════════════════════════════════════
console.log(`\n[control-center] ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
