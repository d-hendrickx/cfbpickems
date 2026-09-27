/**
 * js/haptics.js — DI-326's native-only haptics wrapper (UX Revamp, group A2).
 *
 * ONE function, `haptic(kind)`. A no-op unless BOTH `isNativeShell()` is true
 * AND `window.Capacitor.Plugins.Haptics` exists (the plugin is installed in
 * the iOS shell's package manifest (the haptics plugin, 8.0.2) — but this
 * module never assumes a plugin object it hasn't feature-detected). NEVER throws —
 * a haptics failure must never break the interaction it is decorating
 * (Design Philosophy §Haptics: haptics reinforce, they never gate). NEVER
 * called on web — every call site in this codebase gates its own call
 * through `isNativeShell()` already via this module's own internal check,
 * so a caller does not have to remember to gate it a second time.
 *
 * ZERO dependencies beyond `isNativeShell()` from js/platform.js. ZERO
 * top-level side effects — same discipline as platform.js itself. Does
 * nothing on import; only exposes a function to call later.
 *
 * kinds:
 *   'medium'    — Haptics.impact({ style: 'Medium' }).      Primary actions /
 *                 "opening a matchup" per Design Philosophy §Haptics.
 *   'light'     — Haptics.impact({ style: 'Light' }).        Secondary/lighter
 *                 confirmations — swipe commits, pull-to-refresh completion.
 *   'selection' — Haptics.selectionChanged() if the plugin exposes it, else
 *                 a second Light impact (documented fallback, DI-326 item 1).
 *   'success'   — Haptics.notification({ type: 'SUCCESS' }) if the plugin
 *                 exposes it, else a Light impact fallback.
 *
 * An unknown kind is a silent no-op (never throws, never guesses).
 */
import { isNativeShell } from './platform.js';

export function haptic(kind) {
  try {
    if (!isNativeShell()) return;
    const Haptics = typeof window !== 'undefined' ? window.Capacitor?.Plugins?.Haptics : null;
    if (!Haptics) return;
    switch (kind) {
      // Style/type strings are UPPER-CASE: the iOS plugin compares them
      // case-sensitively against 'MEDIUM'/'LIGHT'/'HEAVY' and falls back to
      // .heavy on anything else — 'Medium'/'Light' fired HEAVY on every call
      // (iOS shell parity check, 2026-09-26).
      case 'medium':
        Haptics.impact?.({ style: 'MEDIUM' });
        break;
      case 'light':
        Haptics.impact?.({ style: 'LIGHT' });
        break;
      case 'selection':
        // selectionChanged() only fires if a generator exists from a prior
        // selectionStart(); run the documented start → changed → end sequence.
        if (typeof Haptics.selectionChanged === 'function') {
          Haptics.selectionStart?.();
          Haptics.selectionChanged();
          Haptics.selectionEnd?.();
        } else {
          Haptics.impact?.({ style: 'LIGHT' });
        }
        break;
      case 'success':
        if (typeof Haptics.notification === 'function') Haptics.notification({ type: 'SUCCESS' });
        else Haptics.impact?.({ style: 'LIGHT' });
        break;
      default:
        break;
    }
  } catch {
    // Never throws — see header comment. A dropped haptic is invisible; a
    // thrown error inside a gesture handler is not.
  }
}
