/**
 * js/source-labels.js — THE PUBLISHER NAME A SOURCE CHIP SHOWS, DERIVED FROM THE VALIDATED HOST (D1 Lane C, DI-641, security F-1 option).
 * ===========================================================================================================================================
 * A chip's label is NEVER taken from the `label` the model or a stored row supplied: it is computed here from the hostname of the address the chip will actually open. A known
 * publisher (the table below, matched on the registrable name and its own subdomains) reads its proper name; anything else reads its host without `www.`, so a chip can never say
 * "ESPN" over a page that is not on espn.com. PURE: no DOM, no network, no clock. Shared by the Edge Function that writes `meta.sources` and by the client that draws the chips,
 * so the two can never disagree about what a host is called.
 */

export const SOURCE_HOST_LABELS = Object.freeze({
  'espn.com': 'ESPN', 'cbssports.com': 'CBS Sports', 'nfl.com': 'NFL', 'ncaa.com': 'NCAA.com', 'si.com': 'Sports Illustrated', 'yahoo.com': 'Yahoo Sports',
  'nbcsports.com': 'NBC Sports', 'apnews.com': 'AP', 'foxsports.com': 'Fox Sports', 'theathletic.com': 'The Athletic', 'sports.yahoo.com': 'Yahoo Sports',
  'usatoday.com': 'USA Today', 'on3.com': 'On3', '247sports.com': '247Sports', 'rivals.com': 'Rivals', 'sbnation.com': 'SB Nation',
});
const MAX_HOST_LABEL = 40;

/**
 * The label for a hostname: a known publisher's name, else the host without `www.`. A host longer than 40 characters keeps its RIGHT-HAND end behind an ellipsis (`…` + the last 39):
 * the registrable domain is at the right, and a lookalike prefix (`espn.com.aaaa…evil.example`) must never be what a long host is cut down to. '' for anything that is not a usable host.
 */
export function sourceLabelForHost(hostname) {
  if (typeof hostname !== 'string') return '';
  const host = hostname.toLowerCase().replace(/^www\./, '');
  if (!host || !/^[a-z0-9.-]+$/.test(host)) return '';
  const parts = host.split('.');
  for (let i = 0; i < parts.length - 1; i += 1) {
    const h = parts.slice(i).join('.');
    if (Object.prototype.hasOwnProperty.call(SOURCE_HOST_LABELS, h)) return SOURCE_HOST_LABELS[h];
  }
  return host.length > MAX_HOST_LABEL ? `\u2026${host.slice(-(MAX_HOST_LABEL - 1))}` : host;
}

/** The label for an address: `sourceLabelForHost` of its hostname, '' when it does not parse. */
export function sourceLabelForUrl(url) {
  try { return sourceLabelForHost(new URL(String(url)).hostname); } catch { return ''; }
}
