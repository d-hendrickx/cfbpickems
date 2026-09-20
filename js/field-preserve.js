/**
 * js/field-preserve.js — RG-176 (2026-09-19)
 * ==========================================
 * ONE generic answer to the hazard RG-174 fixed in one place.
 *
 * THE HAZARD, restated as a mechanism. Every page in this app is rendered by
 * assigning `innerHTML` to its section container. `innerHTML =` DESTROYS every
 * descendant node and builds new ones from the markup — so any text field the
 * player is part-way through editing is replaced by a fresh one carrying
 * whatever the markup says, with the caret at 0 and no focus. That was always
 * true and always harmless, because under the Sheets backend a repaint arrived
 * minutes apart. Under Supabase Realtime it arrives every few seconds during
 * live games (js/app.js `onRealtimeEvent -> _repaintForSupabaseData ->
 * navigateTo`), so the latent defect became a constant one. RG-174 fixed the
 * chat composer; the same repaint eats the chat ⚙ prefs fields, the Rules
 * feedback textarea and every text input on the commissioner panel.
 *
 * WHY A GENERIC MECHANISM AT THE REPAINT CHOKEPOINT rather than a fourth,
 * fifth and sixth hand-written capture/restore pair: the triggers live in two
 * modules and none of the surfaces can see them. A per-surface fix has to be
 * remembered by whoever adds the NEXT text field, and the failure is silent.
 *
 * ── THE FOUR RULES, AND WHY EACH ONE IS HERE ─────────────────────────────────
 *
 * 1. DIRTY ONLY. A field is carried across a repaint if and only if its live
 *    `value` differs from `defaultValue` — the DOM's own record of what the
 *    markup rendered. This is the whole of the ruling for `#pref-nick` and its
 *    neighbours: those values are DURABLE synced state, so a field the player
 *    has not touched must take the FRESH stored value, or a display-name change
 *    made on another device would be clobbered by a stale copy held in a node
 *    on this one. Only an unsaved in-progress edit outranks the server.
 *
 * 2. AN IDENTITY GUARD, NOT A BLANKET CLEAR. The caller passes an owner key and
 *    gets it checked again on restore. A session/player/league change made on
 *    ANOTHER page never re-renders this one, so the old nodes — with the
 *    previous player's text in them — are still in the DOM when the next player
 *    first opens it. Restoring across that boundary puts Player A's words into
 *    Player B's field, one tap from being saved under B's name. That is the
 *    reviewer BLOCK on RG-174's first fix (v0.22.5, 2026-09-19), generalised:
 *    every surface gets the guard, not just the composer.
 *
 * 3. FOCUS IS RESTORED, NEVER GRANTED. A field the player was not in stays
 *    unfocused. Re-focusing on every repaint would pop the on-screen keyboard
 *    open every few seconds on a phone — a different bug, in the same place,
 *    introduced by an over-eager fix.
 *
 * 4. NEVER A SECRET. Password/PIN inputs are refused by type AND by id, in both
 *    directions. The site PIN, player PINs and the commissioner password are
 *    the auth model (CLAUDE.md); a copy of one sitting in a module-level
 *    snapshot, surviving a repaint that was supposed to clear the screen, is
 *    not a preservation feature.
 *
 * WHY NOT "JUST SKIP THE REPAINT WHILE A FIELD IS FOCUSED". It was considered
 * and rejected: a deferred repaint has no bound. A phone left on the chat prefs
 * panel with a half-typed nickname would stop painting inbound messages, live
 * scores and week-status flips for as long as it sits there, and the paths that
 * raise the loud-fail banners reach the screen THROUGH the same repaint
 * (`_repaintForSupabaseData`), so a deferred repaint defers AD-06's red banner
 * too. Capture-and-restore keeps every repaint and loses nothing.
 *
 * This module touches the DOM and nothing else — no storage, no session, no
 * imports. The owner key arrives as an argument precisely so it cannot grow a
 * dependency on auth.js or storage.js and become a second identity authority.
 */

/**
 * The value types that HAVE an in-progress text edit worth carrying. An
 * allowlist rather than a denylist, deliberately: a future input type is
 * refused until somebody decides it belongs, which is the fail-closed
 * direction for rule 4.
 *
 * Deliberately absent: `password` (rule 4), `hidden`, `checkbox`, `radio`,
 * `file` (a FileList cannot be restored and must never look as though it was),
 * `range`, `color`, and the date/time family (a picker has no partial state a
 * repaint can destroy — the value is always committed).
 */
const CARRIED_TYPES = new Set(['textarea', 'text', 'search', 'url', 'tel', 'email', 'number', '']);

/** Rule 4's second half. An `id` that names a secret is refused whatever its
 *  `type` says — a PIN box rendered as `type="text"` with `inputmode="numeric"`
 *  is still a PIN box, and this app has shipped both spellings. */
const SECRET_ID = /pin|password|passcode|secret|token/i;

/** The brand. A snapshot is only ever consumed by the function that produced
 *  it; see assertOwnProduce() below for why that is asserted rather than
 *  assumed. */
const BRAND = 'field-preserve/v1';

// ── The IME guard ────────────────────────────────────────────────────────────
//
// Reviewer follow-up on RG-174 (non-blocking note, 2026-09-19): there was no
// composition guard anywhere in the repaint path.
//
// WHY IT MATTERS. Between `compositionstart` and `compositionend` the browser
// owns a preedit buffer that is NOT yet part of `value`, and an IME (Japanese,
// Chinese, Korean, and every phone keyboard doing predictive text) commits it
// on its own schedule. Writing `value` or calling `setSelectionRange()` in that
// window races the commit: the committed text lands on top of the text we just
// wrote, duplicating a syllable, or the caret jumps and the composition is
// cancelled mid-word. The repaint has already cost the player their node; a
// programmatic write on top of a live composition makes it worse, not better.
//
// So both directions stand down while a composition is in flight. The listener
// is installed once, on the document, in the CAPTURE phase — composition events
// bubble, so one pair of listeners sees every field in the app and no surface
// has to remember to wire its own.
let _composingEl = null;
let _watchInstalled = false;

function installCompositionWatch() {
  if (_watchInstalled) return;
  const doc = (typeof document !== 'undefined') ? document : null;
  if (!doc || typeof doc.addEventListener !== 'function') return;
  _watchInstalled = true;
  doc.addEventListener('compositionstart', (e) => { _composingEl = e?.target || null; }, true);
  doc.addEventListener('compositionend', () => { _composingEl = null; }, true);
}

/**
 * Is an IME composition in flight right now?
 *
 * SELF-CLEARING, and that is the part that needed thinking about: a repaint
 * DESTROYS the node the composition belongs to, and a destroyed node never
 * fires `compositionend`. A naive latch would therefore stick `true` for the
 * rest of the page's life the first time somebody was mid-composition during a
 * repaint — which would disable every capture and restore in this module
 * silently, i.e. hand the original bug back. A detached node cannot be
 * composing, so `isConnected === false` releases the latch.
 */
export function isComposing() {
  installCompositionWatch();
  if (!_composingEl) return false;
  if (_composingEl.isConnected === false) { _composingEl = null; return false; }
  return true;
}

/** Test-only seam (the `chat.js _resetForTest` convention). Production has no
 *  path that clears this by hand — the two listeners and `isConnected` do it. */
export function _resetCompositionForTest() { _composingEl = null; }
/** Test-only seam: drive the guard without synthesising composition events in
 *  a stub that would then be asserting against its own event plumbing. */
export function _setComposingForTest(el) { _composingEl = el || null; }

// ── Rule 2's machinery: WHO the markup on screen was rendered FOR ────────────
//
// THE SUBTLETY THAT MAKES A NAIVE IDENTITY CHECK USELESS, and it is the exact
// defect the reviewer blocked RG-174's first fix for. Checking "is the capture's
// owner the same as the restore's owner" proves nothing when both are read from
// the LIVE session a few microseconds apart — they always agree. The question
// that matters is a different one: is the text sitting in this node MINE?
//
// A session change made on ANOTHER page never re-renders this one. Player A
// types a nickname into the ⚙ panel, walks to Picks, taps Log Out; Player B
// signs in and opens Chat. The first render B sees is the FIRST time this
// module runs for B — and the node it reads still holds A's text. A live-session
// check says "owner B, restoring for B: fine" and hands A's words to B.
//
// So the owner is STAMPED at render time, on the root, by whoever rendered it,
// and capture compares the CALLER's identity to that stamp. A WeakMap rather
// than a data-attribute: an identity key is not markup, and nothing that walks
// the DOM (the XSS-escaping audit, the hold-gate teardown) should be able to
// see it or serialise it.
const _rootOwner = new WeakMap();

/**
 * Record whose data the markup now in `root` was rendered from. Call it at the
 * END of a render, after restoreDirtyFields() — the same place and the same
 * moment js/chat-ui.js sets `_composerOwner`.
 */
export function stampFieldOwner(root, ownerKey) {
  if (!root) return;
  if (ownerKey) _rootOwner.set(root, String(ownerKey));
  else _rootOwner.delete(root);          // signed out — nothing on screen has an owner
}

/** Test-only seam — a suite has to be able to put a root back into its
 *  never-rendered state between sections. Production never unstamps. */
export function _clearFieldOwnerForTest(root) { if (root) _rootOwner.delete(root); }

/** One enumeration, shared by capture and restore, so the two can never
 *  disagree about which fields are in scope. Scoped to `root` — restore looks
 *  the field up INSIDE the page it is restoring into, never by a document-wide
 *  id lookup that could land on an identically-named field on another page. */
function carriedFields(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  let nodes = [];
  try { nodes = Array.from(root.querySelectorAll('input[id],textarea[id]') || []); }
  catch { return []; }
  return nodes.filter(el => {
    if (!el || !el.id) return false;
    if (SECRET_ID.test(el.id)) return false;                       // rule 4
    const tag = String(el.tagName || '').toLowerCase();
    const type = String(tag === 'textarea' ? 'textarea' : (el.type || '')).toLowerCase();
    if (type === 'password' || type === 'hidden') return false;    // rule 4
    return CARRIED_TYPES.has(type);
  });
}

/**
 * Read every DIRTY text field inside `root` immediately before the markup that
 * holds them is destroyed.
 *
 * @param {Element|null} root      the page section about to be re-rendered
 * @param {string}       ownerKey  identity this snapshot belongs to (rule 2)
 * @param {{skipIds?: string[]}=}  opts  ids another mechanism already owns —
 *        today `chat-input`, which js/chat-ui.js carries itself because a
 *        restored draft also needs its autosize height and character count
 *        (syncComposerChrome). Two owners for one field is how a restore ends
 *        up racing itself.
 * @returns {{__src:string, owner:string, fields:Array}|null}
 */
export function captureDirtyFields(root, ownerKey, { skipIds = [] } = {}) {
  if (isComposing()) return null;                                  // IME guard
  if (!ownerKey) return null;                                      // no identity, no carry (rule 2)
  // Rule 2. The text in these nodes belongs to whoever the markup was rendered
  // FOR, which is not necessarily whoever is signed in now — see _rootOwner.
  // On any mismatch the edits are DROPPED, never carried.
  if (_rootOwner.get(root) !== String(ownerKey)) return null;
  const skip = new Set(skipIds);
  const doc = (typeof document !== 'undefined') ? document : null;
  const fields = [];
  for (const el of carriedFields(root)) {
    if (skip.has(el.id)) continue;
    const value = el.value == null ? '' : String(el.value);
    const rendered = el.defaultValue == null ? '' : String(el.defaultValue);
    if (value === rendered) continue;                              // rule 1 — not dirty, the fresh value wins
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : value.length;
    fields.push({
      id: el.id,
      value,
      start: typeof el.selectionStart === 'number' ? el.selectionStart : end,
      end,
      focused: !!doc && doc.activeElement === el,                  // rule 3
    });
  }
  if (!fields.length) return null;
  return { __src: BRAND, owner: String(ownerKey), fields };
}

/**
 * Put the captured edits back onto the FRESH nodes.
 *
 * Call it AFTER whatever binds listeners to the new markup, so the restored
 * text lands on a node whose handlers are already live.
 *
 * @param snap      the return value of captureDirtyFields(), or null
 * @param root      the freshly rendered page section
 * @param ownerKey  the identity NOW — rule 2 is checked on both sides
 */
export function restoreDirtyFields(snap, root, ownerKey) {
  if (!snap) return;
  // The snapshot is only ever produced by the function above. A hand-built
  // object reaching this function means some caller invented its own producer,
  // which is precisely how rules 1 and 4 get bypassed — a producer that never
  // checked `defaultValue` or the secret list would restore whatever it liked.
  if (snap.__src !== BRAND) {
    console.error('[field-preserve] restoreDirtyFields() was handed a snapshot it did not produce — refusing', snap.__src);
    return;
  }
  if (isComposing()) return;                                       // IME guard
  if (!ownerKey || String(ownerKey) !== snap.owner) return;        // rule 2
  const byId = new Map(carriedFields(root).map(el => [el.id, el]));
  const doc = (typeof document !== 'undefined') ? document : null;
  for (const f of snap.fields) {
    const el = byId.get(f.id);
    if (!el) continue;                                             // the field is not in the fresh markup
    if (el.value !== f.value) el.value = f.value;
    try { el.setSelectionRange?.(f.start, f.end); } catch { /* a number input can throw here */ }
    // Rule 3 — only ever RESTORED. Never granted, and never taken away from a
    // field that legitimately has it now.
    if (f.focused && doc && doc.activeElement !== el) el.focus?.();
  }
}
