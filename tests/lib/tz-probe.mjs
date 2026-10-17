/**
 * tests/lib/tz-probe.mjs — `testrun.mjs --check-tz`: record every call a suite's process makes to a Date/Intl API whose result depends
 * on the process time zone. Loaded through NODE_OPTIONS (`--import`), so every Node process a suite starts is covered too.
 *
 * Counted (zone-dependent): the local getters and setters (getHours, getDate, getDay, getMonth, getFullYear, setHours, setDate, …),
 * getTimezoneOffset, toString / toDateString / toTimeString, toLocaleString / toLocaleDateString / toLocaleTimeString,
 * Intl.DateTimeFormat WITHOUT a timeZone option, `new Date(y, m, …)` (local components) and `new Date(string)` for a date-time string
 * with no zone designator. NOT counted (zone-independent): Date.now, getTime, every getUTC… and setUTC… method, toISOString, Date.UTC, and
 * anything given an explicit timeZone. One JSON object per process is appended to $CFBP_TZPROBE_FILE at exit. Evidence only: it never
 * changes a result (the wrappers call the originals).
 *
 * This is how the `tz` set was chosen (W-11 add-on (b), 2026-10-07). It cannot see inside Chromium: a browser suite that renders dates
 * must pin the page's zone (Emulation.setTimezoneOverride, as wizardsheettest does) or be tagged by hand.
 */
import fs from 'node:fs';

const out = process.env.CFBP_TZPROBE_FILE;
if (out) {
  const counts = Object.create(null);
  const bump = k => { counts[k] = (counts[k] || 0) + 1; };
  const P = Date.prototype;
  const LOCAL = ['getHours', 'getMinutes', 'getDate', 'getDay', 'getMonth', 'getFullYear', 'getYear', 'setHours', 'setMinutes', 'setSeconds',
    'setDate', 'setMonth', 'setFullYear', 'getTimezoneOffset', 'toString', 'toDateString', 'toTimeString', 'toLocaleString',
    'toLocaleDateString', 'toLocaleTimeString'];
  for (const n of LOCAL) {
    const orig = P[n];
    if (typeof orig !== 'function') continue;
    Object.defineProperty(P, n, { value: { [n](...a) { bump(n); return orig.apply(this, a); } }[n], writable: true, configurable: true });
  }
  const DTF = Intl.DateTimeFormat;
  const Wrapped = function DateTimeFormat(loc, opts) {
    if (!opts || !opts.timeZone) bump('Intl.DateTimeFormat (no timeZone)');
    return new DTF(loc, opts);
  };
  Wrapped.prototype = DTF.prototype;
  Wrapped.supportedLocalesOf = DTF.supportedLocalesOf.bind(DTF);
  Intl.DateTimeFormat = Wrapped;
  globalThis.Date = new Proxy(Date, {
    construct(t, args, nt) {
      if (args.length >= 2) bump('new Date(y, m, …) local components');
      else if (args.length === 1 && typeof args[0] === 'string' && /\d/.test(args[0])) {
        const v = args[0].trim();
        if (!/(Z|[+-]\d\d:?\d\d)$/i.test(v) && !/^\d{4}-\d{2}-\d{2}$/.test(v)) bump('new Date(string with no zone)');
      }
      return Reflect.construct(t, args, nt);
    },
  });
  process.on('exit', () => {
    if (!Object.keys(counts).length) return;
    try { fs.appendFileSync(out, JSON.stringify({ pid: process.pid, script: process.argv[1] || '', counts }) + '\n'); } catch { /* evidence only */ }
  });
}
