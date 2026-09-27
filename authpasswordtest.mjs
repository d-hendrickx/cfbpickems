/**
 * CFB Pickems — authpasswordtest.mjs
 * ====================================
 * UX Revamp thread, Group F "Accounts" — DI-332…DI-340 (email/password
 * sign-in, reset, change, deletion). Precedent: authtest.mjs/authnativetest.mjs
 * — a focused standalone suite beside loadtest.mjs, spawned from it exactly
 * as those two already are.
 *
 * Run:  node authpasswordtest.mjs
 *
 * SCOPE. This file drives js/auth.js's own exported functions against a
 * scripted fake `window.supabase.createClient` — it does NOT touch app.js
 * (the coordinator's gate wiring, `showGoogleSignInGate()`'s markup and the
 * `signedIn`/gate-removal exclusion at app.js:21458/21482, are out of scope
 * for this build per the task brief) and it makes NO live network call (the
 * Edge Function `account-delete` itself is Drew's to write/deploy and is out
 * of this suite's reach, per CLAUDE.md's testing rules — `deleteOwnAccount()`
 * is asserted only against a MOCKED `client.functions.invoke()` response).
 *
 * NOT COVERED HERE, said plainly: a real GoTrue round trip, a real reset
 * email, a real reauthentication code — none of those can be exercised
 * outside a browser against a live Supabase project. Every assertion below
 * either (a) drives auth.js's own logic against a scripted fake client, or
 * (b) proves a STRUCTURAL property of the source (no password-update path
 * skips the nonce). Drew's own "Verification steps" in the DI are the
 * browser/device half this suite cannot reach.
 */

// ── Minimal environment (authtest.mjs's own precedent, trimmed to what this
//    file's assertions actually touch — no DOM registry, no app.js). ────────
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
  get length() { return store.size; },
  key: i => [...store.keys()][i] ?? null,
};
globalThis.window = globalThis;
globalThis.location = { origin: 'https://irbfootball.test' };
globalThis.fetch = async () => { throw new Error('network disabled in authpasswordtest'); };
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'u' + Math.random().toString(36).slice(2) };

let pass = 0, fail = 0;
const _realLog = console.log.bind(console);
const _realErr = console.error.bind(console);
function assert(cond, label) {
  if (cond) { pass++; _realLog('  ✅', label); }
  else { fail++; _realErr('  ❌', label); }
}

const auth = await import('./js/auth.js');

// ── Fake Supabase client factory — same shape as authtest.mjs's own
//    makeFakeClient(), extended with the six calls this DI's functions make:
//    signUp, signInWithPassword, resetPasswordForEmail, verifyOtp, updateUser,
//    reauthenticate, plus `functions.invoke` for deleteOwnAccount(). ───────
function makeFakeClient(overrides = {}) {
  const listeners = [];
  return {
    auth: {
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: overrides.getSession || (async () => ({ data: { session: overrides.session || null } })),
      refreshSession: overrides.refreshSession || (async () => ({ data: { session: null }, error: null })),
      signOut: overrides.signOut || (async () => { listeners.slice().forEach(fn => fn('SIGNED_OUT', null)); return { error: null }; }),
      signUp: overrides.signUp || (async () => ({ data: {}, error: null })),
      signInWithPassword: overrides.signInWithPassword || (async () => ({ data: {}, error: null })),
      resetPasswordForEmail: overrides.resetPasswordForEmail || (async () => ({ data: {}, error: null })),
      verifyOtp: overrides.verifyOtp || (async () => ({ data: {}, error: null })),
      updateUser: overrides.updateUser || (async () => ({ data: {}, error: null })),
      reauthenticate: overrides.reauthenticate || (async () => ({ data: {}, error: null })),
    },
    functions: {
      invoke: overrides.invoke || (async () => ({ data: { ok: true }, error: null })),
    },
    // F-4 (fix round 1) — `.from()`/`.rpc()`, same shape as authtest.mjs's own
    // makeFakeClient(). WITHOUT THESE, refreshMembershipsAndSession()'s own
    // `.from('league_members').select(...)` call silently resolved against
    // `undefined.select is not a function` — no, worse: it resolved against
    // NOTHING, because the property did not exist at all, so any test that
    // meant to COUNT membership reads via `overrides.from` was instrumenting a
    // hook JavaScript never called. [4]'s own "R-2: NO membership refresh"
    // assertion could not have gone red under ANY widening of the
    // PASSWORD_RECOVERY arm, because the counter it read was wired to a
    // function nothing in this file could ever reach.
    from(table) {
      const b = {
        _table: table, _eq: [],
        select(cols) { b._select = cols; return b; },
        update(patch) { b._update = patch; return b; },
        eq(col, val) { b._eq.push([col, val]); return b; },
        then(resolve, reject) {
          const result = overrides.from ? overrides.from(table, b) : { data: [], error: null };
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return b;
    },
    rpc(name, params) {
      const fn = overrides.rpc || (() => ({ data: null, error: null }));
      return Promise.resolve(fn(name, params));
    },
    _fire: (event, session) => listeners.slice().forEach(fn => fn(event, session)),
  };
}
function installFakeSupabase(overrides) {
  globalThis.window.supabase = {
    createClient(url, key, opts) { return makeFakeClient(overrides); },
  };
}
function resetAll(overrides = {}) {
  auth._resetAuthForTest();
  // SECURITY F-3 — _resetAuthForTest() deliberately does NOT clear
  // RECOVERY_PENDING_KEY (see its own comment in js/auth.js): that
  // survival is the whole property under test. Every OTHER section in this
  // file wants a genuinely clean device, so this general-purpose reset
  // clears it explicitly — the one section that needs it to persist across
  // a reset (the F-3 persistence test, below) calls _resetAuthForTest()
  // directly instead of going through this helper.
  try { localStorage.removeItem(auth._RECOVERY_PENDING_KEY_FOR_TEST); } catch {}
  installFakeSupabase(overrides);
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  auth._setHasSupabaseDataBackendForTest(true);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[1] PASSWORD_RESET_REDIRECT_URL — a module constant, never window.location.origin (Finding 12)…');
{
  assert(auth.PASSWORD_RESET_REDIRECT_URL === 'https://irbfootball.com',
    `the literal is the live site's own origin (got ${JSON.stringify(auth.PASSWORD_RESET_REDIRECT_URL)})`);
  resetAll();
  let seenRedirect = null;
  installFakeSupabase({ resetPasswordForEmail: async (email, opts) => { seenRedirect = opts?.redirectTo; return { data: {}, error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  await auth.requestPasswordReset('nia@example.com');
  assert(seenRedirect === auth.PASSWORD_RESET_REDIRECT_URL,
    `requestPasswordReset() passes redirectTo:PASSWORD_RESET_REDIRECT_URL verbatim (got ${JSON.stringify(seenRedirect)}) — never globalThis.location.origin, which this fixture deliberately sets to a DIFFERENT value ('https://irbfootball.test') so a leak would be caught`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[2] signUpWithPassword() / signInWithPassword() — the plain success/failure shapes…');
{
  resetAll();
  let seen = null;
  installFakeSupabase({ signUp: async (args) => { seen = args; return { data: {}, error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  await auth.signUpWithPassword('nia@example.com', 'correct-horse-battery-staple');
  assert(seen && seen.email === 'nia@example.com' && seen.password === 'correct-horse-battery-staple',
    'signUpWithPassword() calls client.auth.signUp({email,password}) with exactly what it was given');

  resetAll({ signUp: async () => ({ data: {}, error: { message: 'boom', status: 400 } }) });
  let threw = null;
  try { await auth.signUpWithPassword('a@b.com', 'x'); } catch (e) { threw = e; }
  assert(threw && threw.message === 'boom', 'signUpWithPassword() THROWS the SDK error on rejection (loud-fail — AD-06), never swallows it');

  resetAll();
  let seenIn = null;
  installFakeSupabase({ signInWithPassword: async (args) => { seenIn = args; return { data: {}, error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  await auth.signInWithPassword('nia@example.com', 'pw');
  assert(seenIn && seenIn.email === 'nia@example.com' && seenIn.password === 'pw',
    'signInWithPassword() calls client.auth.signInWithPassword({email,password}) with exactly what it was given');

  // F-8 (fix round 1) — user_already_exists (422) is SWALLOWED at the
  // source, never thrown, so sign-up shows the SAME uniform outcome
  // whether the email is new, already password-registered, or already
  // Google-linked (DI-339 Finding 7's enumeration boundary, closed even
  // when "Confirm email" is OFF — Security Boundary #2).
  resetAll({ signUp: async () => ({ data: {}, error: { code: 'user_already_exists', status: 422, message: 'User already registered' } }) });
  let threwOnExisting = null;
  try { await auth.signUpWithPassword('already@example.com', 'x'); } catch (e) { threwOnExisting = e; }
  assert(threwOnExisting === null,
    `F-8: signUpWithPassword() does NOT throw on user_already_exists/422 (got ${threwOnExisting ? threwOnExisting.message : 'no throw'}) — the caller renders the identical "check your email" notice it would for a genuinely new signup`);

  // REVIEWER (b), fix round 2 — the codeless-422 fallback is narrowed to
  // GoTrue's OWN wording. A codeless 422 that SAYS "User already registered"
  // is still swallowed…
  resetAll({ signUp: async () => ({ data: {}, error: { status: 422, message: 'User already registered' } }) });
  let threwNoCode = null;
  try { await auth.signUpWithPassword('a@b.com', 'x'); } catch (e) { threwNoCode = e; }
  assert(threwNoCode === null,
    'reviewer (b): a codeless 422 carrying GoTrue\'s own "User already registered" wording IS still swallowed — the enumeration boundary holds for the case the fallback exists for');

  // …and any OTHER codeless 422 now THROWS. Before this fix it was swallowed
  // too, which meant a genuinely failed sign-up (a rejected email, a disabled
  // signup endpoint — both 422, both codeless on some GoTrue versions)
  // rendered the calm "check your email to verify your account" notice for an
  // email that was never going to arrive.
  resetAll({ signUp: async () => ({ data: {}, error: { status: 422, message: 'validation failed, no code at all' } }) });
  let threwOtherNoCode = null;
  try { await auth.signUpWithPassword('a@b.com', 'x'); } catch (e) { threwOtherNoCode = e; }
  assert(threwOtherNoCode && threwOtherNoCode.message === 'validation failed, no code at all',
    `reviewer (b): a codeless 422 with UNRELATED text THROWS (got ${threwOtherNoCode ? threwOtherNoCode.message : 'no throw'}) — "any codeless 422" was too wide; the swallow is now the known message only`);

  resetAll({ signUp: async () => ({ data: {}, error: { code: 'weak_password', status: 422, message: 'Password should be at least 12 characters' } }) });
  let threwWeak = null;
  try { await auth.signUpWithPassword('a@b.com', 'x'); } catch (e) { threwWeak = e; }
  assert(threwWeak && threwWeak.message.includes('at least 12'),
    `F-8 falsifiability: a 422 CARRYING an unrelated code (weak_password) still THROWS normally (got ${threwWeak ? threwWeak.message : 'no throw'}) — the swallow is scoped to user_already_exists, not every 422`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[3] DI-339 — classifyPasswordAuthError() is the ONE closed vocabulary, and the enumeration boundary lives here…');
{
  const R = auth.PASSWORD_AUTH_REASON;
  assert(auth.classifyPasswordAuthError(null) === R.UNKNOWN, 'no error at all -> UNKNOWN');
  assert(auth.classifyPasswordAuthError({ code: 'invalid_credentials', status: 400 }) === R.NO_MATCH,
    'GoTrue invalid_credentials (wrong password) -> NO_MATCH');
  assert(auth.classifyPasswordAuthError({ message: 'Invalid login credentials', status: 400 }) === R.NO_MATCH,
    '…and the same reason on the TEXT fallback (no machine code present) — this IS the enumeration boundary: wrong-password and no-such-account share this one path, never a distinguishing branch');
  assert(auth.classifyPasswordAuthError({ code: 'email_not_confirmed', status: 400 }) === R.EMAIL_NOT_CONFIRMED,
    'email_not_confirmed -> EMAIL_NOT_CONFIRMED (Finding 13 — Supabase\'s OWN designed distinction, not one this app adds)');
  assert(auth.classifyPasswordAuthError({ status: 429 }) === R.RATE_LIMITED, 'bare HTTP 429 -> RATE_LIMITED');
  assert(auth.classifyPasswordAuthError({ code: 'over_email_send_rate_limit' }) === R.RATE_LIMITED, 'over_email_send_rate_limit -> RATE_LIMITED');
  assert(auth.classifyPasswordAuthError({ code: 'weak_password' }) === R.WEAK_PASSWORD, 'weak_password -> WEAK_PASSWORD');
  assert(auth.classifyPasswordAuthError({ message: 'Password should be at least 12 characters' }) === R.WEAK_PASSWORD,
    'the text fallback catches a policy-rejection message with no machine code too');
  assert(auth.classifyPasswordAuthError({ code: 'same_password' }) === R.SAME_PASSWORD, 'same_password -> SAME_PASSWORD (DI-335: "That\'s already your password.")');
  assert(auth.classifyPasswordAuthError({ code: 'otp_expired' }) === R.CODE_INVALID, 'otp_expired -> CODE_INVALID (DI-334\'s expired-reset-link / DI-335\'s expired-code row)');
  assert(auth.classifyPasswordAuthError({ name: 'AuthRetryableFetchError' }) === R.NETWORK, 'AuthRetryableFetchError -> NETWORK');
  assert(auth.classifyPasswordAuthError({ message: 'Failed to fetch' }) === R.NETWORK, 'a bare "Failed to fetch" -> NETWORK');
  assert(auth.classifyPasswordAuthError({ code: 'some_unmapped_future_code', message: 'a new GoTrue thing' }) === R.UNKNOWN,
    'an unrecognised code/message -> UNKNOWN — the honest fallback, never a guessed reason dressed as a real one');
  // F-8 (fix round 1) — user_already_exists/422 maps to the uniform
  // sign-up notice, NOT UNKNOWN. This is the classifier's own second,
  // independent line of defense (signUpWithPassword() itself swallows the
  // error at the source in the normal path — tested in [2]).
  assert(auth.classifyPasswordAuthError({ code: 'user_already_exists', status: 422 }) === R.SIGNUP_NONCOMMITTAL,
    'F-8: user_already_exists -> SIGNUP_NONCOMMITTAL, never UNKNOWN');
  assert(auth.classifyPasswordAuthError({ status: 422, message: 'User already registered' }) === R.SIGNUP_NONCOMMITTAL,
    'reviewer (b): …and a codeless 422 carrying GoTrue\'s own "User already registered" wording also maps there (the narrowed fallback)');
  assert(auth.classifyPasswordAuthError({ status: 422, message: 'no code at all' }) === R.UNKNOWN,
    'reviewer (b) falsifiability: a codeless 422 with UNRELATED text is NOT swallowed into SIGNUP_NONCOMMITTAL — it falls through to the honest UNKNOWN, so a real sign-up failure can never render as "check your email"');
  assert(auth.classifyPasswordAuthError({ code: 'weak_password', status: 422 }) === R.WEAK_PASSWORD,
    'falsifiability: a 422 CARRYING a different code (weak_password) is NOT swallowed into SIGNUP_NONCOMMITTAL');
  // Non-vacuity: the closed set really is closed, and every member is reachable.
  const reasons = Object.values(R);
  assert(new Set(reasons).size === reasons.length, 'self-test: PASSWORD_AUTH_REASON has no duplicate values');
  assert(reasons.length === 9,
    `self-test: exactly the nine reasons this DI names (got ${reasons.length}) — eight from the original DI-339 table plus SIGNUP_NONCOMMITTAL (F-8, fix round 1). A tenth added silently here would be a tenth nobody wrote copy for`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[4] FINDING 1 — a PASSWORD_RECOVERY event does NOT reach refreshMembershipsAndSession(), and isRecoverySession() flips…');
{
  resetAll();
  let membershipReadCalls = 0;
  installFakeSupabase({
    from: () => { membershipReadCalls += 1; return { data: [], error: null }; },
    // ── REVIEWER (a), fix round 2 — PHASE 1 NEEDS A REAL RECOVERY SESSION,
    //    OR THIS SECTION'S OWN ASSERTION CANNOT GO RED. ───────────────────────
    // getMemberships() reads client.auth.getSession() FIRST and returns early
    // (`if (!uid) return null;`) before it ever reaches `.from()`. Without a
    // session on the fake, a PASSWORD_RECOVERY arm widened to call
    // refreshMembershipsAndSession() — the exact defect R-2 exists to forbid —
    // would still leave `membershipReadCalls` at 0, because the read would die
    // one step earlier for an unrelated reason. The F-4 positive control below
    // proved the COUNTER works; it did not prove THIS fixture could observe the
    // defect. Modelling the session a real PASSWORD_RECOVERY event carries
    // (verifyOtp() mints a full-privilege session — Finding 1's whole point)
    // is what makes the zero below a true negative. Mutation-proven: injecting
    // 'PASSWORD_RECOVERY' into the identity branch of _handleAuthStateChange
    // turns R-2 red with this line present, and left it GREEN without it.
    // IT HAS TO BE ON *THIS* FIXTURE, not only on the control's: ensureClient()
    // memoizes, so whichever phase first reaches the SDK is the phase whose
    // factory owns the client for the rest of this section — under the defect
    // that is phase 1, and a phase-1 fake with no session would send
    // getMemberships() down its early return before `.from()` either way.
    getSession: async () => ({ data: { session: { user: { id: 'u_nia' }, access_token: 't' } } }),
  });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  assert(auth.isRecoverySession() === false, 'freshly reset — no recovery session yet');
  auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u_nia', email: 'nia@example.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(auth.isRecoverySession() === true, 'PASSWORD_RECOVERY -> isRecoverySession() true (Finding 1)');
  // Give any stray async membership-refresh a tick to land, if the bug were present.
  await new Promise(r => setTimeout(r, 10));
  assert(membershipReadCalls === 0,
    `R-2: firing PASSWORD_RECOVERY triggers NO league_members read at all (got ${membershipReadCalls} call(s)) — refreshMembershipsAndSession() must never run off this event, or a recovery session would auto-link a league before a password exists`);
  // F-4 — THE POSITIVE CONTROL. The assertion above is only meaningful if
  // `membershipReadCalls` is capable of going non-zero AT ALL — before this
  // fix, `makeFakeClient()` had no `.from()` method, so a call to
  // `client.from('league_members')` would throw a TypeError before ever
  // reaching `overrides.from`, and the counter would read 0 whether or not
  // the widened bug this test exists to catch was present. Firing a REAL
  // membership-refresh-triggering event (SIGNED_IN) and proving the counter
  // moves is what makes the zero above a real negative rather than a
  // vacuous one. `getMemberships()` reads `client.auth.getSession()` FIRST
  // and returns early (`if (!uid) return null;`) before ever reaching
  // `.from()` — so this control ALSO needs a real session, not just the
  // `from` override, or it would (falsely) prove nothing for a different
  // reason than the one it exists to rule out.
  // B1 FIX (3c fix window, 2026-09-25) — the identity branch now ALSO skips
  // refreshMembershipsAndSession() while isRecoverySession() reads true (not
  // only off the PASSWORD_RECOVERY event itself, R-2 above, but off ANY
  // event that can carry the same session — the vendored SDK's own
  // visibility-change SIGNED_IN re-emit and hourly TOKEN_REFRESHED). This
  // fixture's PASSWORD_RECOVERY fire above left `_recoverySession` TRUE, so
  // the positive control needs a real exit from recovery first — signOut()
  // (auth.js's own `[auth] identity epoch -> 1 (signOut)` clears the flag,
  // proven at [6] above) — or this SIGNED_IN would ITSELF be correctly
  // suppressed by the same fix the zero above exists to prove, and the
  // control would (falsely) look like a broken counter again, for a new
  // reason this pass introduced.
  await auth.signOut().catch(() => {});
  installFakeSupabase({
    from: () => { membershipReadCalls += 1; return { data: [], error: null }; },
    getSession: async () => ({ data: { session: { user: { id: 'u_nia' }, access_token: 't2' } } }),
  });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  assert(auth.isRecoverySession() === false, 'F-4 fixture: the control fires SIGNED_IN OUTSIDE any recovery session, not mid-recovery');
  auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u_nia', email: 'nia@example.com' }, access_token: 't2', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  await new Promise(r => setTimeout(r, 10));
  assert(membershipReadCalls > 0,
    `F-4 non-vacuity: SIGNED_IN (which legitimately calls refreshMembershipsAndSession()) DOES move the counter (got ${membershipReadCalls}) — proving the instrumentation can observe a real membership read, so PASSWORD_RECOVERY's own zero above is not simply a broken counter reading zero for everything`);

  // B1 — THE NEW POSITIVE-CONTROL'S OWN NEGATIVE: prove the skip is real
  // by putting SIGNED_IN back INTO a recovery session and watching the SAME
  // counter stay flat, the exact "second door" scenario named in this fix.
  let membershipReadCalls2 = 0;
  installFakeSupabase({
    from: () => { membershipReadCalls2 += 1; return { data: [], error: null }; },
    getSession: async () => ({ data: { session: { user: { id: 'u_nia' }, access_token: 't3' } } }),
  });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u_nia', email: 'nia@example.com' }, access_token: 't3', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(auth.isRecoverySession() === true, 'B1 fixture: a recovery session is up again');
  auth._fireAuthEventForTest('SIGNED_IN', { user: { id: 'u_nia', email: 'nia@example.com' }, access_token: 't3', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  await new Promise(r => setTimeout(r, 10));
  assert(membershipReadCalls2 === 0,
    `B1: a SIGNED_IN event re-fired WHILE isRecoverySession() is true triggers NO league_members read (got ${membershipReadCalls2} call(s)) — the vendored SDK's visibility-change re-emit closing the "second door" R-2 alone did not cover`);
  auth._fireAuthEventForTest('TOKEN_REFRESHED', { user: { id: 'u_nia', email: 'nia@example.com' }, access_token: 't3', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  await new Promise(r => setTimeout(r, 10));
  assert(membershipReadCalls2 === 0,
    `B1: …and TOKEN_REFRESHED (the SDK's hourly autoRefresh) carrying the same recovery session is suppressed identically (got ${membershipReadCalls2} call(s))`);
}

console.log('\n[5] FINDING 9 — the identity tuple IS populated off a PASSWORD_RECOVERY event…');
{
  resetAll();
  assert(auth.getAccountEmail() === '' && auth.getAccountUserId() === '', 'fixture: signed out, nothing populated yet');
  auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u_nia', email: 'nia@example.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(auth.getAccountEmail() === 'nia@example.com', 'getAccountEmail() reads the recovery session\'s email (DI-334\'s landing screen needs one to show)');
  assert(auth.getAccountUserId() === 'u_nia', 'getAccountUserId() reads the recovery session\'s uid too');
}

console.log('\n[6] cancelRecovery() signs out and clears the flag; an involuntary SIGNED_OUT clears it too…');
{
  resetAll();
  let signOutCalls = 0;
  installFakeSupabase({ signOut: async () => { signOutCalls += 1; return { error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'e@x.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(auth.isRecoverySession() === true, 'fixture: a recovery session is up');
  await auth.cancelRecovery();
  assert(auth.isRecoverySession() === false, 'cancelRecovery() clears isRecoverySession()');
  assert(signOutCalls === 1, 'cancelRecovery() actually calls signOut() (Finding 1: "any exit before completion... calls signOut()")');

  resetAll();
  auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'e@x.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(auth.isRecoverySession() === true, 'fixture: a recovery session is up again');
  auth._fireAuthEventForTest('SIGNED_OUT', null);
  assert(auth.isRecoverySession() === false, 'an INVOLUNTARY SIGNED_OUT (dead refresh token, background sweep) also clears the flag — defence in depth, not only the deliberate exit path');
}

console.log('\n[7] #site-gate-overlay is app.js\'s concern, not this file\'s — recorded here so the gap is named, not silently assumed…');
{
  // FINDING 1's hard rule ("the new-password screen renders INSIDE the still-
  // present #site-gate-overlay... the gate is never reported as down for this
  // event") is implemented in js/app.js (the `signedIn` computation at
  // app.js:21458 gaining `event !== 'PASSWORD_RECOVERY'`), which is explicitly
  // READ-ONLY / out of scope for this build (the coordinator's wiring). This
  // suite proves the auth.js HALF of Finding 1 (isRecoverySession() flips,
  // refreshMembershipsAndSession() never fires) exhaustively above. The DOM
  // half — that the gate element itself survives — is NOT provable from this
  // file without an app.js DOM fixture this build does not construct; it is
  // named here, honestly, as an integration point the coordinator's own
  // wiring pass must verify once it lands (its own handoff should re-run
  // authtest.mjs's DOM-driven pattern against the new branch).
  assert(true, 'gap named, not silently assumed — see comment above');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[8] FINDING 5 — verifyPasswordRecovery() calls verifyOtp({type:\'recovery\', token_hash}), stateless…');
{
  resetAll();
  let seen = null;
  installFakeSupabase({ verifyOtp: async (args) => { seen = args; return { data: {}, error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  await auth.verifyPasswordRecovery('the-token-hash');
  assert(seen && seen.type === 'recovery' && seen.token_hash === 'the-token-hash',
    'verifyPasswordRecovery(tokenHash) calls verifyOtp({type:\'recovery\', token_hash:tokenHash}) — the token-hash path, not an implicit PKCE redirect');

  resetAll({ verifyOtp: async () => ({ data: {}, error: { code: 'otp_expired', message: 'Token has expired or is invalid' } }) });
  let threw = null;
  try { await auth.verifyPasswordRecovery('stale'); } catch (e) { threw = e; }
  assert(threw && auth.classifyPasswordAuthError(threw) === auth.PASSWORD_AUTH_REASON.CODE_INVALID,
    'a rejected verifyOtp() throws, and classifies as CODE_INVALID — the "expired or already used" row');
}

console.log('\n[9] updatePasswordForRecovery() — no nonce (the gated recovery session IS the proof), and it clears isRecoverySession()…');
{
  resetAll();
  let seen = null;
  const freshSession = { user: { id: 'u1', email: 'e@x.com' }, access_token: 't-fresh', expires_at: Math.floor(Date.now() / 1000) + 3600 };
  installFakeSupabase({
    updateUser: async (args) => { seen = args; return { data: {}, error: null }; },
    getSession: async () => ({ data: { session: freshSession } }),
  });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'e@x.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(auth.isRecoverySession() === true, 'fixture: recovery session up');
  // B1 FIX (3c fix window, 2026-09-25) — the coordinator's app.js comment at
  // the call site used to assume "nothing to remove by hand" because the
  // now-ordinary session would take the gate down the SAME way any other
  // genuine SIGNED_IN-equivalent state does. It cannot: the SDK's own
  // USER_UPDATED (fired INSIDE updateUser(), before the two flag-clear lines
  // below run) already reached the identity branch with isRecoverySession()
  // still TRUE, correctly holding the gate — but that means no LATER event
  // announces the moment the flags actually clear. A listener attached here
  // proves the fix: updatePasswordForRecovery() itself re-runs the real
  // SIGNED_IN handling once the flags are clear.
  const heard = [];
  const off = auth.onAuthEvent((ev, payload) => heard.push([ev, payload]));
  await auth.updatePasswordForRecovery('a-new-strong-password');
  off();
  assert(seen && seen.password === 'a-new-strong-password' && !('nonce' in seen),
    'updatePasswordForRecovery() calls updateUser({password}) with NO nonce key at all — the verified recovery session is the proof, per Finding 1');
  assert(auth.isRecoverySession() === false, 'success clears isRecoverySession() — the gate can come down the same way any other genuine sign-in does');
  const lastEvent = heard[heard.length - 1];
  assert(!!lastEvent && lastEvent[0] === 'SIGNED_IN',
    `B1: updatePasswordForRecovery() success emits its OWN 'SIGNED_IN' to listeners AFTER clearing the flags (got ${JSON.stringify(heard.map(h => h[0]))}) — the explicit re-sync this fix adds, since nothing else would fire once the flags are clear`);
  assert(!!lastEvent && lastEvent[1] && lastEvent[1].access_token === 't-fresh',
    `B1: …carrying the SDK's own freshly-read session (got access_token=${JSON.stringify(lastEvent && lastEvent[1] && lastEvent[1].access_token)}) — updateUser() already refreshed the session in place; this reads it back via getSession() rather than constructing one`);
}
{
  // REVIEWER BLOCK item 3 — updatePasswordForRecovery() REQUIRES an active
  // recovery session and must refuse OUTSIDE one, rather than silently
  // calling updateUser({password}) with no nonce for an ordinary signed-in
  // session — that would be exactly Finding 3's original defect (an
  // advisory-only password change with nothing server-side enforcing
  // "recently authenticated") reintroduced through this function's own back
  // door.
  resetAll();
  let updateUserCalls = 0;
  installFakeSupabase({ updateUser: async () => { updateUserCalls += 1; return { data: {}, error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  assert(auth.isRecoverySession() === false, 'fixture: no recovery session at all');
  let threw = null;
  try { await auth.updatePasswordForRecovery('a-new-strong-password'); } catch (e) { threw = e; }
  assert(threw instanceof Error && /recovery session/i.test(threw.message),
    `updatePasswordForRecovery() THROWS outside a recovery session (got ${threw ? threw.message : 'no throw'})`);
  assert(updateUserCalls === 0,
    'and the SDK is never even called — the refusal happens before any network reach, not after a rejected write');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[10] FINDING 3 — requestPasswordChangeCode() / updatePassword(newPassword, nonce): NO path skips the nonce…');
{
  resetAll();
  let reauthCalls = 0;
  installFakeSupabase({ reauthenticate: async () => { reauthCalls += 1; return { data: {}, error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  await auth.requestPasswordChangeCode();
  assert(reauthCalls === 1, 'requestPasswordChangeCode() calls client.auth.reauthenticate() with no arguments');

  resetAll();
  let seen = null;
  installFakeSupabase({ updateUser: async (args) => { seen = args; return { data: {}, error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  await auth.updatePassword('a-new-strong-password', '123456');
  assert(seen && seen.password === 'a-new-strong-password' && seen.nonce === '123456',
    'updatePassword(newPassword, nonce) calls updateUser({password, nonce}) — nonce IS present on the wire, the real reauthentication control (Finding 3), never merely advisory');

  // ── THE STRUCTURAL RULE: no code path in this module reaches
  //    client.auth.updateUser() for a PASSWORD change without a nonce, EXCEPT
  //    the one place the DI names explicitly (updatePasswordForRecovery(),
  //    proven separately at [9] — a fully-gated recovery session is its own
  //    proof, not a bypass). Asserted BOTH behaviourally (above — the exact
  //    outgoing arguments) and structurally, against the source, because a
  //    behavioural assertion alone could not tell "the shipped function" from
  //    "a function nobody calls any more".
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .split('\n').map(l => l.replace(/(^|\s)\/\/.*$/, (m, p1) => p1)).join('\n');
  // F-11 (fix round 1) — widened to `updateUser\s*\(`: the original pattern
  // required the opening paren immediately after the method name with no
  // whitespace, so a reformatted call (`updateUser ({...})`, or one split
  // across a line break by a future editor/linter) would silently drop out
  // of this scan and the "exactly TWO call sites" count below would read
  // wrong without any assertion going red to say so.
  const updateUserCalls = [...stripped.matchAll(/client\.auth\.updateUser\s*\(\{([^}]*)\}\)/g)].map(m => m[1]);
  // ── R-b (fix round 2) — THE OBJECT-LITERAL SCAN ONLY SEES OBJECT LITERALS.
  // Every assertion below reads `{…}` call sites. A call written in ANY other
  // form — `updateUser(payload)`, `updateUser(buildArgs())`, an object spread
  // across a variable — matches none of them, so a nonce-less password update
  // could be added in that shape and this whole block would keep passing while
  // counting two. Counting ALL reaches of the method and requiring the two
  // totals to agree is what closes that: a call site this scan cannot READ is
  // now a call site that makes it FAIL, which is the fail-closed direction.
  const allUpdateUserReaches = [...stripped.matchAll(/client\.auth\.updateUser\s*\(/g)].length;
  assert(allUpdateUserReaches === updateUserCalls.length,
    `R-b: every client.auth.updateUser( in the file is an object-literal call this scan can read (${allUpdateUserReaches} reach(es), ${updateUserCalls.length} readable) — a call in any other form (updateUser(payload), a spread, a built argument) would hide its nonce from every assertion below, so the mismatch itself is the failure`);
  assert(updateUserCalls.length === 2,
    `self-test: exactly TWO updateUser({...}) call sites in the file (got ${updateUserCalls.length}) — updatePasswordForRecovery()'s and updatePassword()'s. A third would need its own decision about whether it carries a nonce`);
  const withoutNonce = updateUserCalls.filter(args => !/\bnonce\b/.test(args));
  assert(withoutNonce.length === 1,
    `exactly ONE updateUser() call site omits \`nonce\` (got ${withoutNonce.length}) — updatePasswordForRecovery()'s, which is proven at [9] to be gated by a verified recovery session instead`);
  const withNonce = updateUserCalls.filter(args => /\bnonce\b/.test(args));
  assert(withNonce.length === 1 && withNonce[0].includes('password'),
    'the OTHER call site — updatePassword() — carries {password, nonce} together, never password alone');

  // Negative: updatePassword() refuses locally when handed no nonce at all,
  // rather than silently forwarding `nonce: undefined` to the SDK.
  resetAll();
  let calledWithNoNonce = false;
  installFakeSupabase({ updateUser: async () => { calledWithNoNonce = true; return { data: {}, error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  let threw = null;
  try { await auth.updatePassword('a-new-strong-password', ''); } catch (e) { threw = e; }
  assert(threw instanceof Error && !calledWithNoNonce,
    'updatePassword(newPassword, \'\') THROWS locally and never reaches the SDK — "no path skips it" holds even for a caller that tries to skip it');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[11] DI-336\'s gate — the client reads auth.users.email_confirmed_at off the session it already has, never infers it…');
{
  // This DI does not add a new auth.js EXPORT for the unverified-linking gate
  // (DI-336 reads it directly off the SDK's own user/session object, which
  // app.js's wiring already has in hand — see DI-336's "Detection" clause).
  // What belongs to THIS module is that requireUser()-shaped detection is
  // never invented client-side as a substitute: signInWithPassword() and
  // signUpWithPassword() above never inspect or branch on email_confirmed_at
  // themselves, they only ever throw/resolve on what the SDK itself decided.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('./js/auth.js', import.meta.url), 'utf8');
  assert(!/email_confirmed_at/.test(src),
    'js/auth.js never reads email_confirmed_at itself — DI-336 reads it off the session object the app.js wiring already has; this module does not duplicate that decision');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[12] deleteOwnAccount() — invokes the account-delete function with the caller\'s own session, then signs out locally…');
{
  resetAll();
  let invokeCalls = [];
  let signOutCalls = 0;
  installFakeSupabase({
    invoke: async (name, opts) => { invokeCalls.push({ name, opts }); return { data: { ok: true, runId: 'r1', what: 'deleted' }, error: null }; },
    signOut: async () => { signOutCalls += 1; return { error: null }; },
  });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  const result = await auth.deleteOwnAccount();
  assert(invokeCalls.length === 1 && invokeCalls[0].name === 'account-delete',
    'deleteOwnAccount() invokes exactly the \'account-delete\' function — supabase-js attaches the caller\'s own session Authorization header automatically, no id/body is constructed here');
  assert(signOutCalls === 1, 'on success, the existing signOut()/local-cleanup path runs');
  assert(result && result.ok === true && result.what === 'deleted', 'the function\'s response is returned to the caller (the coordinator\'s UI wiring reads it for the success toast)');

  resetAll();
  let signOutCalls2 = 0;
  installFakeSupabase({
    invoke: async () => ({ data: null, error: { message: 'internal_error' } }),
    signOut: async () => { signOutCalls2 += 1; return { error: null }; },
  });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  let threw = null;
  try { await auth.deleteOwnAccount(); } catch (e) { threw = e; }
  assert(threw !== null, 'a failed invocation THROWS — loud-fail, never a silent "worked" (DI-340: "a failed deletion must never silently claim to have worked")');
  assert(signOutCalls2 === 0, 'on failure, signOut() never runs — the player is not logged out of an account that was not actually deleted');
}
{
  // F-7 — a 200 response whose envelope is `{ok:true, skipped:…}` (the
  // Edge Function's own safe partial-failure shape) must be treated as a
  // FAILURE, not silently returned as if the account were actually deleted.
  resetAll();
  let signOutCalls = 0;
  installFakeSupabase({
    invoke: async () => ({ data: { ok: true, runId: 'r1', skipped: 'not_configured', what: 'SUPABASE_SERVICE_ROLE_KEY' }, error: null }),
    signOut: async () => { signOutCalls += 1; return { error: null }; },
  });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  let threw = null;
  try { await auth.deleteOwnAccount(); } catch (e) { threw = e; }
  assert(threw instanceof Error,
    `F-7: a 200 {ok:true, skipped:…} envelope THROWS — data.ok alone (true here) is NOT sufficient, envelopeSkipped() sets ok:true too (got ${threw ? 'threw' : 'did not throw'})`);
  assert(signOutCalls === 0, 'and signOut() never runs for a skipped, non-actually-deleted account');
}
{
  // F-6 — the Edge Function's own named 'last_commissioner' refusal (a
  // FunctionsHttpError whose response body is JSON) is read and re-thrown
  // as AccountDeleteRefusedError, so a caller gets a distinguishable reason
  // rather than the generic loud-fail string.
  resetAll();
  const fakeResponse = {
    json: async () => ({ ok: false, error: 'last_commissioner', runId: 'r1' }),
  };
  const httpError = new Error('Edge Function returned a non-2xx status code');
  httpError.name = 'FunctionsHttpError';
  httpError.context = fakeResponse;
  installFakeSupabase({ invoke: async () => ({ data: null, error: httpError }) });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  let threw = null;
  try { await auth.deleteOwnAccount(); } catch (e) { threw = e; }
  assert(threw instanceof auth.AccountDeleteRefusedError && threw.reason === 'last_commissioner',
    `F-6: a 'last_commissioner' FunctionsHttpError is re-thrown as AccountDeleteRefusedError{reason:'last_commissioner'} (got ${threw ? `${threw.name}/${threw.reason}` : 'no throw'})`);
  assert(/commissioner/i.test(threw.message), 'the error carries a rendering-ready message ("Hand your league to another commissioner first"-shaped), not just the bare code');
}
{
  // Non-vacuity — an UNRELATED FunctionsHttpError (a different body, or an
  // unparseable one) must NOT be misread as last_commissioner.
  resetAll();
  const unrelated = { json: async () => ({ ok: false, error: 'anonymize_failed', runId: 'r1' }) };
  const httpError = new Error('Edge Function returned a non-2xx status code');
  httpError.name = 'FunctionsHttpError';
  httpError.context = unrelated;
  installFakeSupabase({ invoke: async () => ({ data: null, error: httpError }) });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  let threw = null;
  try { await auth.deleteOwnAccount(); } catch (e) { threw = e; }
  assert(!(threw instanceof auth.AccountDeleteRefusedError),
    `non-vacuity: a DIFFERENT error body is NOT reclassified as AccountDeleteRefusedError (got ${threw ? threw.constructor.name : 'no throw'}) — the generic loud-fail path still applies`);
  assert(threw === httpError, 'and the original error is re-thrown unchanged');
}

console.log('\n[13] SECURITY F-3 — the device-local recovery marker SURVIVES an in-memory reset (models a reload)…');
{
  // Deliberately NOT using resetAll() for the FIRST reset below — that
  // helper clears RECOVERY_PENDING_KEY on purpose for every OTHER section.
  // This test's whole point is the marker surviving exactly that kind of
  // reset, so it drives auth._resetAuthForTest() directly.
  auth._resetAuthForTest();
  try { localStorage.removeItem(auth._RECOVERY_PENDING_KEY_FOR_TEST); } catch {}
  installFakeSupabase();
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  assert(auth.isRecoverySession() === false, 'fixture: clean device, no recovery pending');

  auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'e@x.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(auth.isRecoverySession() === true, 'fixture: recovery session up (in-memory flag + device marker both set)');
  assert(localStorage.getItem(auth._RECOVERY_PENDING_KEY_FOR_TEST) === '1', 'fixture: the device-local marker is actually on disk');

  // Simulate a reload: _resetAuthForTest() wipes every IN-MEMORY module
  // variable (this is the closest offline stand-in for a fresh module
  // instance) but — per its own comment — does NOT touch
  // RECOVERY_PENDING_KEY, exactly as a real browser reload would not touch
  // localStorage.
  let signOutCalls = 0;
  auth._resetAuthForTest();
  installFakeSupabase({ signOut: async () => { signOutCalls += 1; return { error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  assert(localStorage.getItem(auth._RECOVERY_PENDING_KEY_FOR_TEST) === '1',
    'the marker SURVIVED the in-memory reset — this is the property F-3 exists for');
  assert(auth.isRecoverySession() === true,
    'isRecoverySession() reads TRUE again immediately after the reset, from the marker alone (the in-memory flag was wiped by the reset, same as a real reload would wipe it)');

  // Now the actual boot path: an INITIAL_SESSION fires (a real reload's
  // rehydrate) with the marker still present.
  //
  // REVIEWER (c), fix round 2 — app.js must be TOLD, synchronously, and told
  // "no session". A listener is attached first so this asserts what the
  // listener actually received, not merely that signOut() was reached.
  const heard = [];
  const offRecovery = auth.onAuthEvent((ev, payload) => heard.push([ev, payload]));
  auth._fireAuthEventForTest('INITIAL_SESSION', { user: { id: 'u1', email: 'e@x.com' }, access_token: 't2', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(heard.length >= 1 && heard[0][0] === 'INITIAL_SESSION',
    `reviewer (c): the recovery-marker arm EMITS to its listeners synchronously, in the same tick as the event (got ${JSON.stringify(heard.map(h => h[0]))}) — app.js no longer waits on the async SIGNED_OUT round trip to learn anything happened`);
  assert(heard.length >= 1 && heard[0][1] === null,
    `reviewer (c): …and the payload is NULL, never the rehydrated session (got ${JSON.stringify(heard[0] && heard[0][1])}) — app.js's signedIn term is \`!!payload && hasValidSupabaseSession()\`, so handing over the real session here would take the gate DOWN for a device that is mid-recovery and already signing out (DI-334 Finding 1)`);
  await new Promise(r => setTimeout(r, 10));
  offRecovery();
  assert(signOutCalls === 1,
    `the boot path calls signOut() when INITIAL_SESSION lands with the marker present (got ${signOutCalls} call(s)) — DI-334 Finding 1's literal rule ("any exit before completion... reload... calls signOut()"), reachable this time because the marker survived what the in-memory flag alone could not`);
  assert(auth.isRecoverySession() === false,
    'and signOut() clears both the flag and the marker, so the device reads clean afterward — no infinite sign-out loop on the NEXT reload');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[14] R-f — a recovery session that cannot be made DURABLE is refused outright, not entered…');
{
  // WHY THIS IS THE FAIL-CLOSED ANSWER, in one sequence: the marker is what a
  // reload reads ([13]); the in-memory flag does not survive one. On a device
  // that cannot persist (iOS private browsing, a full quota, a partitioned
  // in-app browser) a recovery session would therefore paint the new-password
  // screen and then, on the very next reload, look like an ordinary
  // INITIAL_SESSION rehydrate — memberships refreshed, auto-link attempted,
  // gate down, before any password existed. So: no durable marker, no recovery
  // screen. The player starts again from the email link, which needs nothing
  // remembered on this device (the token-hash path, Finding 5).
  const realSetItem = globalThis.localStorage.setItem;

  // (i) storage THROWS (the classic iOS private-browsing quota exception).
  resetAll();
  let signOutCalls = 0;
  installFakeSupabase({ signOut: async () => { signOutCalls += 1; return { error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  const heardRefusal = [];
  const offRefusal = auth.onAuthEvent((ev, payload) => heardRefusal.push([ev, payload]));
  globalThis.localStorage.setItem = (k) => { throw new Error(`QuotaExceededError writing ${k}`); };
  try {
    auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'e@x.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  } finally { globalThis.localStorage.setItem = realSetItem; }
  assert(signOutCalls === 1,
    `R-f: a PASSWORD_RECOVERY whose device marker cannot be written calls signOut() immediately (got ${signOutCalls} call(s))`);
  assert(auth.isRecoverySession() === false,
    'R-f: …and isRecoverySession() stays FALSE — no new-password screen is entered on a device that cannot make the recovery survive a reload');
  assert(localStorage.getItem(auth._RECOVERY_PENDING_KEY_FOR_TEST) === null,
    'R-f: …and no half-written marker is left behind either');
  assert(heardRefusal.length >= 1 && heardRefusal[0][0] === 'PASSWORD_RECOVERY' && heardRefusal[0][1] === null,
    `reviewer (c), same rule on this arm: the refusal is announced synchronously with a NULL payload (got ${JSON.stringify(heardRefusal.map(h => [h[0], h[1] === null ? null : 'session']))}) — the event's own live session must not reach app.js's signedIn term and take the gate down while signOut() is still in flight`);
  offRefusal();

  // (ii) storage silently DROPS the write (no throw, nothing stored) — the
  // shape a `try { setItem } catch {}` guard cannot see at all, which is why
  // _setRecoveryPendingOnDevice() reads the value back instead of trusting
  // that setItem did not throw.
  resetAll();
  let signOutCalls2 = 0;
  installFakeSupabase({ signOut: async () => { signOutCalls2 += 1; return { error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  globalThis.localStorage.setItem = () => {};
  try {
    auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'e@x.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  } finally { globalThis.localStorage.setItem = realSetItem; }
  assert(signOutCalls2 === 1,
    `R-f: a SILENTLY DROPPED write (setItem returns normally, nothing stored) is refused identically (got ${signOutCalls2} call(s)) — the read-back is the check, not the absence of an exception`);
  assert(auth.isRecoverySession() === false, 'R-f: …and again no recovery session is entered');

  // (iii) THE POSITIVE CONTROL — with storage working, nothing about the
  // ordinary path changed: the recovery session IS entered and signOut() is
  // NOT called. Without this, every assertion above could be satisfied by a
  // build that simply refused every recovery session.
  resetAll();
  let signOutCalls3 = 0;
  installFakeSupabase({ signOut: async () => { signOutCalls3 += 1; return { error: null }; } });
  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'anon-key' });
  auth._fireAuthEventForTest('PASSWORD_RECOVERY', { user: { id: 'u1', email: 'e@x.com' }, access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  assert(signOutCalls3 === 0 && auth.isRecoverySession() === true,
    `R-f non-vacuity: with working storage the recovery session is entered normally and signOut() is NOT called (signOut calls ${signOutCalls3}, isRecoverySession ${auth.isRecoverySession()})`);
  assert(localStorage.getItem(auth._RECOVERY_PENDING_KEY_FOR_TEST) === '1',
    'R-f non-vacuity: …and the marker really is on the device in that case');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[15] SECURITY F1 (3c fix window, third pass) — the forgot-password screen renders');
console.log('     BYTE-IDENTICAL text for a real send and a RATE_LIMITED refusal, on web AND native…');
{
  // The REAL showForgotPasswordScreen() + forgotPasswordSentNotice() source is
  // extracted from js/app.js and run in a sandbox (loadtest [1d]'s technique —
  // this file deliberately does not import app.js), wired to the REAL
  // classifyPasswordAuthError/PASSWORD_AUTH_REASON (js/auth.js) and the REAL
  // isNativeShell() (js/platform.js, driven by window.Capacitor). The send
  // button is clicked and the RENDERED message text compared whole.
  const { readFileSync } = await import('node:fs');
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const a = appSrc.indexOf('function forgotPasswordScreenHTML(prefillEmail) {');
  const b = appSrc.indexOf('function showForgotPasswordScreen(prefillEmail) {');
  const c = appSrc.indexOf('\n}\n', b);
  assert(a > -1 && b > a && c > b && appSrc.slice(a, b).includes('function forgotPasswordSentNotice() {'), 'fixture: forgotPasswordScreenHTML(), forgotPasswordSentNotice() and showForgotPasswordScreen() were extracted from js/app.js');
  const authUrl = new URL('./js/auth.js', import.meta.url).href;
  const platUrl = new URL('./js/platform.js', import.meta.url).href;
  const sandbox = [
    `import { classifyPasswordAuthError, PASSWORD_AUTH_REASON } from '${authUrl}';`,
    `import { isNativeShell } from '${platUrl}';`,
    'let document = null; let requestPasswordReset = null;',
    'export function _set(d, r) { document = d; requestPasswordReset = r; }',
    "function escHtml(v) { return String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;'); }",
    'function showGoogleSignInGate() {}',
    'function playGateSwap() {}',
    "function passwordAuthErrorCopy() { return 'Too many attempts. Wait a few minutes and try again.'; }",
    appSrc.slice(a, c + 2),
    'export { showForgotPasswordScreen };',
  ].join('\n');
  const mod = await import('data:text/javascript,' + encodeURIComponent(sandbox));
  const makeDom = () => {
    const reg = new Map();
    const mk = (id) => ({ id, value: '', textContent: '', className: '', disabled: false, style: {}, _l: {},
      addEventListener(t, fn) { (this._l[t] = this._l[t] || []).push(fn); },
      click() { return Promise.all((this._l.click || []).map(fn => fn({ target: this }))); } });
    const inner = { set innerHTML(v) { const re = /\bid="([^"]+)"/g; let m; while ((m = re.exec(v))) reg.set(m[1], mk(m[1])); } };
    return { doc: { getElementById: (id) => reg.get(id) || null, querySelector: (sel) => (sel === '#site-gate-overlay .site-gate-inner' ? inner : null) }, reg };
  };
  const rateErr = Object.assign(new Error('email rate limit exceeded'), { code: 'over_email_send_rate_limit', status: 429 });
  const render = async (native, outcome) => {
    globalThis.window.Capacitor = native ? { isNativePlatform: () => true } : undefined;
    const { doc, reg } = makeDom();
    mod._set(doc, async () => { if (outcome === 'rate') throw rateErr; });
    mod.showForgotPasswordScreen('someone@example.com');
    reg.get('pwacct-reset-email').value = 'someone@example.com';
    await reg.get('pwacct-reset-send-btn').click();
    for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0));
    const msg = reg.get('pwacct-reset-message');
    return { text: msg.textContent, cls: msg.className, shown: msg.style.display };
  };
  try {
    assert(auth.classifyPasswordAuthError(rateErr) === auth.PASSWORD_AUTH_REASON.RATE_LIMITED, 'fixture: the refusal really classifies as RATE_LIMITED');
    const webOk = await render(false, 'ok'), webRate = await render(false, 'rate');
    const natOk = await render(true, 'ok'), natRate = await render(true, 'rate');
    assert(webOk.text.length > 0 && webOk.shown === 'block', 'fixture: the web success notice rendered');
    assert(webOk.text === webRate.text && webOk.cls === webRate.cls,
      `F1-1 web: success and RATE_LIMITED render byte-identical text and tone ("${webOk.text}" vs "${webRate.text}")`);
    assert(natOk.text === natRate.text && natOk.cls === natRate.cls,
      `F1-2 native: success and RATE_LIMITED render byte-identical text and tone ("${natOk.text}" vs "${natRate.text}")`);
    assert(natOk.text !== webOk.text && natOk.text.includes("Open the link on your phone or computer's browser to finish — it'll open irbfootball.com, not the app."),
      'F1-3 non-vacuity: the native notice really does carry the web-fallback sentence (so F1-2 compares the long string, not two short ones)');
  } finally { globalThis.window.Capacitor = undefined; }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
