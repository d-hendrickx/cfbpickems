// headermetatest.mjs — Item 9: header feedback button label + stacked
// placement (DI-A1), and week date-range year collapse (DI-A2).
//
// Precedent: weekidentitytest.mjs / grouptest.mjs — a focused standalone
// suite beside loadtest.mjs, not folded into it. Run under BOTH timezones,
// same as the rest:
//   for tz in UTC America/Los_Angeles; do TZ=$tz node headermetatest.mjs; done

import { readFileSync } from 'node:fs';

// ── DOM / browser stubs (same approach as weekidentitytest.mjs) ────────────
// app.js runs top-level DOMContentLoaded wiring, so the browser globals must
// exist BEFORE it is imported. Static imports are hoisted, so app.js is
// loaded via dynamic import() below, after the stubs are in place.
globalThis.localStorage = { _s:{}, getItem(k){return k in this._s?this._s[k]:null;}, setItem(k,v){this._s[k]=String(v);}, removeItem(k){delete this._s[k];}, clear(){this._s={};} };

// Two distinct DOM nodes standing in for #header-meta (the flex host
// setupHeaderFeedbackButton() appends into) and #header-meta-week (the
// separate element refreshHeader() writes the week text/dates into) — kept
// as SEPARATE objects on purpose, so DI-A1's "own element below the
// week-range element" claim is actually checkable: if the button ever
// started getting written into the week element's innerHTML instead of
// appended as a sibling under the host, this test would catch it.
const headerMetaHost = { id:'header-meta', children:[], appendChild(el){ this.children.push(el); } };
const headerMetaWeek = { id:'header-meta-week', _html:'', set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; } };
const idMap = { 'header-meta': headerMetaHost, 'header-meta-week': headerMetaWeek };

globalThis.document = {
  addEventListener(){}, removeEventListener(){},
  getElementById(id){
    if (idMap[id]) return idMap[id];
    // setupHeaderFeedbackButton()'s idempotency guard looks up its OWN id
    // after appending — mirror that by searching the host's real children,
    // the same as the browser would.
    return headerMetaHost.children.find(el => el.id === id) || null;
  },
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  createElement(){
    return {
      attrs:{}, classList:{ add(){}, remove(){} }, style:{}, addEventListener(){},
      setAttribute(k,v){ this.attrs[k] = v; },
      _html:'', set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
    };
  },
  body:{ appendChild(){}, insertAdjacentHTML(){} },
};
globalThis.window = globalThis;
globalThis.requestAnimationFrame = fn => fn();
globalThis.matchMedia = () => ({ matches:false });
globalThis.confirm = () => true;
globalThis.alert = () => {};
if (!globalThis.crypto?.randomUUID) globalThis.crypto = { randomUUID: () => 'uuid_' + Math.random().toString(36).slice(2) };

const { setupHeaderFeedbackButton } = await import('./js/app.js');
// flex-shrink of the FIRST `flex:<grow> <shrink> <basis>` shorthand in a rule
// body, or NaN. Used by the 2026-09-28 re-derived pins, which assert the
// shrink PRIORITY between #league-pill and .header-meta rather than one literal.
const flexShrinkIn = (body) => { const m = /flex:\s*[\d.]+\s+([\d.]+)\s+auto/.exec(body || ''); return m ? Number(m[1]) : NaN; };
const { formatWeekLabelParts, formatWeekLabel } = await import('./js/data-model.js');

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log('  ✅ ' + msg); }
  else { fail++; console.log('  ❌ ' + msg); }
}

// ── (a) collapseYear:true collapses the leading year on a same-year range ──
console.log('\n[a] DI-A2 — collapseYear:true collapses the leading year, same-year range…');
{
  const week = { startDate:'2026-09-03', endDate:'2026-09-07', weekNumber:1 };
  const wl = formatWeekLabelParts(week, { collapseYear:true });
  assert(wl.dates === 'Sep 3 – Sep 7, 2026', 'got "' + wl.dates + '"');
}

// ── (b) HARD GATE — cross-year range must never collapse ───────────────────
console.log('\n[b] DI-A2 — collapseYear:true does NOT collapse a cross-year range (hard gate)…');
{
  const week = { startDate:'2026-12-30', endDate:'2027-01-02', weekNumber:17 };
  const wl = formatWeekLabelParts(week, { collapseYear:true });
  assert(wl.dates.includes('2026') && wl.dates.includes('2027'), 'both years present: "' + wl.dates + '"');
  assert(wl.dates === 'Dec 30, 2026–Jan 2, 2027', 'cross-year keeps the untouched two-full-dates format: "' + wl.dates + '"');
}

// ── (c) flag defaults OFF — the two OTHER callers stay byte-identical ──────
console.log('\n[c] DI-A2 — collapseYear defaults to OFF; other callers are byte-identical to before…');
{
  const week = { startDate:'2026-09-03', endDate:'2026-09-07', weekNumber:1 };
  const wl = formatWeekLabelParts(week); // no options — renderWeekBanner()/renderCommPage()'s exact call shape
  assert(wl.dates === 'Sep 3, 2026–Sep 7, 2026', 'unchanged default output: "' + wl.dates + '"');

  // formatWeekLabel() (the ~20-call-site single-line sibling) never took this
  // option and must be completely unaffected by its existence.
  const single = formatWeekLabel(week);
  assert(single.includes('Sep 3, 2026–Sep 7, 2026'), 'formatWeekLabel() unaffected: "' + single + '"');

  // demo weeks and dateless weeks: untouched regardless of the flag.
  const demoWeek = { dataSourceMode:'demo', weekNumber:0 };
  assert(
    formatWeekLabelParts(demoWeek).dates === '' && formatWeekLabelParts(demoWeek, { collapseYear:true }).dates === '',
    'demo week dates stay empty with the flag either way'
  );

  const singleDateWeek = { startDate:'2026-09-03', weekNumber:1 };
  assert(
    formatWeekLabelParts(singleDateWeek).dates === formatWeekLabelParts(singleDateWeek, { collapseYear:true }).dates,
    'a single-date week (no endDate) is identical with the flag either way'
  );
}

// ── (d) header markup — feedback button is its OWN element, separate from
//        the week-range element (structurally capable of rendering on its
//        own line beneath it, per DI-A1) ───────────────────────────────────
console.log('\n[d] DI-A1 — feedback button renders as its own element, separate from #header-meta-week…');
{
  setupHeaderFeedbackButton();
  assert(headerMetaHost.children.length === 1, 'exactly one button appended to #header-meta');
  const btn = headerMetaHost.children[0];
  assert(btn.id === 'header-feedback-btn', 'appended element is the feedback button');
  assert(btn !== headerMetaWeek, 'button element is NOT the #header-meta-week element (separate DOM node)');
  assert((btn.innerHTML || '').includes('Feedback'), 'button carries the visible "Feedback" text label: ' + btn.innerHTML);
  assert((btn.innerHTML || '').includes('header-feedback-icon'), 'button still carries the icon span');

  // Pre-existing idempotency contract must survive this change.
  setupHeaderFeedbackButton();
  assert(headerMetaHost.children.length === 1, 'second call is a no-op (idempotent) — still exactly one button');
}

// ── CSS: #header-meta is now a one-line ROW (DI-393 supersedes DI-A1/DI-361's
//        flex-COLUMN stacking — the header feedback shortcut this pin used to
//        guard against a third stacked line is retired from the header
//        entirely, per DI-307/2026-09-25, and the date line DI-361 stacked
//        under the name is gone too, per DI-393), and no min-width media
//        query anywhere in the file reintroduces column-stacking for it.
//        A text-level check on the shipped CSS, not a rendered-layout
//        assertion — the actual pixel result is a browser-verify, flagged
//        separately below.
console.log('\n[css] #header-meta is a one-line flex row (DI-393), with no min-width override reintroducing column-stacking…');
{
  const cssPath = new URL('./css/styles.css', import.meta.url);
  const css = readFileSync(cssPath, 'utf8');

  const ruleMatch = css.match(/\.header-meta\{([^}]*)\}/);
  assert(!!ruleMatch, 'found a base .header-meta{...} rule');
  assert(!!ruleMatch && !/flex-direction:\s*column/.test(ruleMatch[1]),
    `.header-meta base rule does NOT carry flex-direction:column any more — DI-A1's row->column switch (built to stack a since-retired header feedback button under the week text) is superseded by DI-393's true one-line row (got "${ruleMatch?.[1]}")`);
  assert(!!ruleMatch && /display:\s*flex/.test(ruleMatch[1]),
    '.header-meta is still display:flex (a plain inline row now, not a stacked column)');

  // Reconstruct each @media block and confirm no min-width block mentions
  // .header-meta at all (the only existing overrides are max-width font-size
  // tweaks, which are fine and untouched by this check since they're inside
  // max-width blocks).
  const mediaBlocks = css.split(/@media/).slice(1).map(s => '@media' + s);
  const minWidthBlocksWithHeaderMeta = mediaBlocks.filter(
    b => /^@media\s*\(min-width/.test(b) && b.includes('.header-meta')
  );
  assert(minWidthBlocksWithHeaderMeta.length === 0, 'no @media (min-width…) block references .header-meta');
}

// ── DI-393 (UN-353, 2026-09-27) — the ONE-LINE header. SUPERSEDES the old
//    [css2] block above (DI-361's three-zone/centred grid — retired in full,
//    not layered on top of). Source-level pins, same discipline as the [css]
//    block above: a text check on the shipped CSS, not a rendered-layout
//    assertion (the actual pixel result is a browser-verify, per this DI's
//    own "Verification (browser)" section).
console.log('\n[css2] DI-393 — header is a true one-line flex row; #league-pill truncates before #header-meta ever does…');
{
  const cssPath = new URL('./css/styles.css', import.meta.url);
  const css = readFileSync(cssPath, 'utf8');

  const headerInnerMatch = css.match(/\.app-header-inner\{([^}]*)\}/);
  assert(!!headerInnerMatch, 'found the base .app-header-inner{...} rule');
  assert(!!headerInnerMatch && /display:\s*flex/.test(headerInnerMatch[1]),
    '.app-header-inner is display:flex — DI-361\'s grid (a fixed column-count commitment) is gone, replaced by a one-line flex row');
  assert(!!headerInnerMatch && !/display:\s*grid/.test(headerInnerMatch[1]),
    '.app-header-inner no longer declares display:grid anywhere in its own rule body — DI-361 is retired, not layered under the new rule');

  // The flex-factor contract IS the "league label truncates first" behaviour
  // — every link asserted so a future edit that changes any ONE factor
  // (making the truncation priority silently reverse) goes red here instead
  // of only showing up as a live layout bug on a real phone.
  const triggerMatch = css.match(/\.control-center-trigger\{([^}]*)\}/);
  assert(!!triggerMatch && /flex:\s*0\s+0\s+auto/.test(triggerMatch[1]),
    `.control-center-trigger is flex:0 0 auto — the leading zone never grows or shrinks (got "${triggerMatch?.[1]}")`);

  // RE-DERIVED 2026-09-28 (web header overflow fix): the pill's shrink factor
  // went 1 -> 100 when .header-meta became shrinkable too; what this pin
  // guards is "grows never, shrinks FIRST", asserted as a relation in [css4].
  const leaguePillFlexMatch = css.match(/#league-pill\{([^}]*)\}/);
  assert(!!leaguePillFlexMatch && /flex:\s*0\s+[\d.]+\s+auto/.test(leaguePillFlexMatch[1]) && flexShrinkIn(leaguePillFlexMatch[1]) >= 1 && /min-width:\s*0/.test(leaguePillFlexMatch[1]),
    `#league-pill is flex:0 <shrink≥1> auto;min-width:0 — never grows, and shrinks below its own content width (got "${leaguePillFlexMatch?.[1]}")`);

  const spacerMatch = css.match(/\.header-spacer\{([^}]*)\}/);
  assert(!!spacerMatch && /flex:\s*1\s+1\s+0%/.test(spacerMatch[1]),
    `.header-spacer is flex:1 1 0% — a zero-basis flexible spacer that absorbs positive free space and contributes nothing to negative space (got "${spacerMatch?.[1]}")`);

  // RE-DERIVED 2026-09-28 (twice): flex:0 0 auto ("never shrinks") pushed the
  // sync icon off a 375px row on web; flex:0 1 auto (3e4f57a) let the week
  // zone shrink WHILE the pill was visible and clipped the status badge. Now
  // it is flex:0 0 auto by default and `#league-pill[hidden]~.header-meta`
  // makes it shrinkable only once the pill is gone — the full contract is
  // [css4]'s; this pin holds the base rule.
  const headerMetaMatch = css.match(/\.header-meta\{([^}]*)\}/);
  assert(!!headerMetaMatch && /flex:\s*0\s+0\s+auto/.test(headerMetaMatch[1]) && /min-width:\s*0/.test(headerMetaMatch[1]),
    `.header-meta (the week+status zone) is flex:0 0 auto;min-width:0 at base — it never grows, never shrinks while the league pill is on screen, and min-width:0 lets the [hidden]-sibling rule's shrink reach the name's ellipsis (got "${headerMetaMatch?.[1]}")`);
  // DI-393 explicitly drops the date line from the header — the old
  // DI-361 centering (align-items:center;text-align:center;gap:4px) is gone
  // along with it, since this zone is no longer a two-line stacked block.
  assert(!!headerMetaMatch && !/text-align:\s*center/.test(headerMetaMatch[1]),
    'the old DI-361 centered-column treatment (text-align:center) is gone from .header-meta — this is a one-line inline-flex row now, not a centered stack');

  const syncMatch = css.match(/#sync-badge\{([^}]*)\}/);
  assert(!!syncMatch && /flex:\s*0\s+0\s+auto/.test(syncMatch[1]),
    `#sync-badge is flex:0 0 auto — the trailing sync icon never grows or shrinks (got "${syncMatch?.[1]}")`);

  // No dates rule survives scoped to the header's inline variant — DI-393
  // moves the date range to DI-394's viewing-week card, never the header.
  assert(!/\.week-heading-inline \.week-heading-dates\{/.test(css),
    'the header-scoped .week-heading-inline .week-heading-dates rule is genuinely gone — DI-393 drops dates from the header entirely, not just visually');
  // The base (non-inline) .week-heading-dates rule MUST survive untouched —
  // renderWeekBanner()/the dashboard's own <h2 class="week-heading"> (both
  // OUTSIDE the header) still use it verbatim. Exactly one match expected:
  // the base rule only, now that the inline-scoped copy above is confirmed
  // gone.
  const datesRuleCount = (css.match(/\.week-heading-dates\{/g) || []).length;
  assert(datesRuleCount === 1,
    `exactly one .week-heading-dates{...} rule remains in the file (the base rule, used OUTSIDE the header) — got ${datesRuleCount}`);

  // RE-DERIVED fix-final-v0270 (2026-09-28, reviewer BLOCK round 2): the
  // truncation chain MOVED off .week-heading-name and onto the <strong> it
  // holds. The name box is a flex ROW now (badge = unshrinkable sibling item,
  // strong = the only ellipsizing item); an ellipsis on the whole box clipped
  // the BADGE first. It keeps white-space:nowrap (one line) and min-width:0
  // (so the squeeze reaches the strong), nothing else. [css4-d1..d4] pin the
  // full shape; this pin holds the base rule.
  const nameRuleMatch = css.match(/\.week-heading-inline \.week-heading-name\{([^}]*)\}/);
  assert(!!nameRuleMatch && /display:\s*flex/.test(nameRuleMatch[1]) && /white-space:\s*nowrap/.test(nameRuleMatch[1]) && /min-width:\s*0/.test(nameRuleMatch[1]) && !/text-overflow/.test(nameRuleMatch[1]),
    `.week-heading-inline .week-heading-name is the flex ROW (display:flex;min-width:0;white-space:nowrap) that carries NO ellipsis of its own — the chain lives on .header-meta strong (got "${nameRuleMatch?.[1]}")`);
  const strongRuleMatch = css.match(/\.header-meta strong\{([^}]*)\}/);
  assert(!!strongRuleMatch && /overflow:\s*hidden/.test(strongRuleMatch[1]) && /text-overflow:\s*ellipsis/.test(strongRuleMatch[1]) && /white-space:\s*nowrap/.test(strongRuleMatch[1]) && /max-width:\s*100%/.test(strongRuleMatch[1]),
    `.header-meta strong still carries its OWN overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100% (nested display:block child, the parent's ellipsis can't reach it) (got "${strongRuleMatch?.[1]}")`);

  // #league-pill's own truncation — the DI's explicit "bounded fraction of
  // the row (e.g. 35vw)" instruction, not the old fixed 120px (which
  // truncated at 120px regardless of how much room the row actually had).
  const leaguePillFullMatch = css.match(/\.league-pill\{([^}]*)\}/);
  assert(!!leaguePillFullMatch && /max-width:\s*35vw/.test(leaguePillFullMatch[1]),
    `.league-pill carries max-width:35vw (DI-393's own "bounded fraction of the row" instruction), not the old fixed 120px (got "${leaguePillFullMatch?.[1]}")`);
  assert(!!leaguePillFullMatch && /overflow:\s*hidden/.test(leaguePillFullMatch[1]) && /text-overflow:\s*ellipsis/.test(leaguePillFullMatch[1]) && /white-space:\s*nowrap/.test(leaguePillFullMatch[1]),
    `.league-pill still truncates with an ellipsis rather than wrapping or overflowing (got "${leaguePillFullMatch?.[1]}")`);
}

// ── MUTATION PROOF (per the reviewer's own instruction) — [css2]'s flex-
//    factor pins above are not just "present," they DISCRIMINATE: a
//    regression back to DI-361's grid (or a silently-reversed flex-shrink
//    priority) must actually turn one of them red, not just happen to still
//    match a loose pattern. Proven against a hand-mutated STRING copy, never
//    a git-restored file (CLAUDE.md's git-mutation-testing hazard) — no
//    working-tree file is read, written, or restored by this block. */
console.log('\n[css2-mutation] DI-393 flex-factor pins actually discriminate a regression…');
{
  const cssPath = new URL('./css/styles.css', import.meta.url);
  const realCss = readFileSync(cssPath, 'utf8');
  // Mutate: reverse #league-pill's own shrink priority back to "never
  // shrinks" (flex:0 0 auto) — the exact regression class that would put
  // the truncation priority back on .header-meta/the week text instead of
  // the league name, silently reopening UN-319/UN-353's own complaint.
  const mutated = realCss.replace('#league-pill{flex:0 1 auto;min-width:0}', '#league-pill{flex:0 0 auto;min-width:0}');
  assert(mutated !== realCss, 'sanity: the mutation actually changed the source text (the exact string being replaced still exists in styles.css)');
  const mutatedMatch = mutated.match(/#league-pill\{([^}]*)\}/);
  const stillPasses = !!mutatedMatch && flexShrinkIn(mutatedMatch[1]) >= 1 && /min-width:\s*0/.test(mutatedMatch[1]);
  assert(stillPasses === false,
    'the #league-pill flex-factor pin goes RED against the mutated (flex:0 0 auto) copy — it is not a pattern loose enough to pass a real regression');
}

// ── [css3] Reviewer BLOCK, round 2 (2026-09-27) — two more header fixes:
//    (1) .header-meta had NO width ceiling at all (flex:0 0 auto, no
//        max-width) — an extreme case could push content past the header's
//        own edge with no backstop; (2) .header-meta strong{display:block}
//        pushed the status badge onto a SECOND line every render, since a
//        block-level element always claims its container's full width and
//        starts a new line — this was a standing bug, not a hypothetical
//        one. Source-level pins, same discipline as [css2] — the actual
//        rendered one-line result (does the badge visually sit beside the
//        name, not below it) is a browser-verify this jsdom-free suite
//        cannot directly observe; these pins assert the DECLARATIONS that
//        make it possible are present and correctly valued.
console.log('\n[css3] Reviewer BLOCK round 2 — .header-meta gets a last-resort max-width; the status badge stays inline beside the week name…');
{
  const cssPath = new URL('./css/styles.css', import.meta.url);
  const css = readFileSync(cssPath, 'utf8');

  const headerMetaMatch = css.match(/\.header-meta\{([^}]*)\}/);
  assert(!!headerMetaMatch && /max-width:\s*60vw/.test(headerMetaMatch[1]),
    `.header-meta carries a last-resort max-width:60vw — previously NO ceiling at all (flex:0 0 auto alone), so an extreme week/round name had no backstop (got "${headerMetaMatch?.[1]}")`);
  // RE-DERIVED 2026-09-28 — .header-meta now shrinks, but still AFTER the pill.
  const pillBodyCss3 = (css.match(/#league-pill\{([^}]*)\}/) || [])[1];
  assert(!!headerMetaMatch && flexShrinkIn(headerMetaMatch[1]) < flexShrinkIn(pillBodyCss3),
    `and .header-meta is still NOT a higher-priority truncation zone ahead of #league-pill — its shrink factor (${flexShrinkIn(headerMetaMatch?.[1])}) is below the pill's (${flexShrinkIn(pillBodyCss3)})`);

  const weekBlockMatch = css.match(/\.header-meta #header-meta-week\{([^}]*)\}/);
  assert(!!weekBlockMatch && /min-width:\s*0/.test(weekBlockMatch[1]),
    `#header-meta-week carries min-width:0 — required for this flex item to actually shrink when .header-meta's new max-width ceiling is hit, transferring the constraint down to the ellipsis chain below it (got "${weekBlockMatch?.[1]}")`);

  const strongRuleMatch = css.match(/\.header-meta strong\{([^}]*)\}/);
  assert(!!strongRuleMatch && /display:\s*inline-block/.test(strongRuleMatch[1]),
    `.header-meta strong is display:inline-block, NOT display:block — a block-level element always starts a new line and claims its container's full width, which pushed the sibling status badge onto a second line every render; inline-block keeps the same independent-formatting-context property the ellipsis fix needs while also flowing inline with the badge (got "${strongRuleMatch?.[1]}")`);
  assert(!!strongRuleMatch && !/display:\s*block/.test(strongRuleMatch[1]),
    'the old display:block value is genuinely gone from this rule, not left as a second, later-winning declaration');
  // The ellipsis/truncation properties the original (2026-09-27, eed1d62
  // follow-up) fix needed must ALL survive this round's display-value swap
  // — inline-block must keep working as an independent formatting context
  // the same way block did, not silently lose the clip chain.
  assert(!!strongRuleMatch && /overflow:\s*hidden/.test(strongRuleMatch[1]) && /text-overflow:\s*ellipsis/.test(strongRuleMatch[1]) && /white-space:\s*nowrap/.test(strongRuleMatch[1]) && /max-width:\s*100%/.test(strongRuleMatch[1]),
    'the full ellipsis chain (overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%) survives unchanged alongside the display:inline-block swap');

  // The badge sibling itself must stay an INLINE-level box (unchanged by
  // this pass) — .header-meta strong going inline-block is only half the
  // fix if the badge it needs to sit beside were ever made block-level too.
  // RE-DERIVED 2026-09-28: the old `(?:^|[^a-zA-Z0-9_.#-])\.badge\{` also
  // matched the descendant rule `.header-meta .badge{flex-shrink:0}` (the
  // space before `.badge` satisfied the class), so the pin read the wrong
  // rule and went red. Anchored to a line start: the BASE `.badge{` rule only.
  const badgeMatch = css.match(/(?:^|\n)\.badge\{([^}]*)\}/);
  assert((css.match(/(?:^|\n)\.badge\{/g) || []).length === 1,
    'fixture check — exactly ONE base `.badge{` rule starts a line in styles.css, so the pin below reads that rule and no other');
  assert(!!badgeMatch && /display:\s*inline-flex/.test(badgeMatch[1]),
    `.badge (the status pill sitting beside the week name) is still display:inline-flex — an inline-level box, so it flows on the same line as .header-meta strong's own inline-block box rather than being pushed below it (got "${badgeMatch?.[1]}")`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\n[index.html] DI-393 (UN-353, 2026-09-27) — the header is a true ONE-LINE row:');
console.log('   trigger | #league-pill | .header-spacer | #header-meta | #sync-badge. #league-pill is');
console.log('   RE-ADDED (superseding REVIEWER F4/2026-09-25\'s removal — Drew\'s own live ruling once he');
console.log('   saw the declutter, per DI-393\'s own text); #header-identity stays ABSENT (not revived)…');
{
  const htmlPath = new URL('./index.html', import.meta.url);
  const html = readFileSync(htmlPath, 'utf8');
  // DI-393 supersedes REVIEWER F4's "#league-pill removed entirely" finding
  // for #league-pill specifically — Drew's own live ruling on the shipped
  // one-line header asks for the league name back, tappable when there is
  // more than one league to switch between. #header-identity (the avatar/
  // Sign-In chip) is NOT part of DI-393's five zones and stays absent —
  // its identity/profile job lives in the control-center drawer only
  // (DI-302), unchanged by this pass.
  assert(html.includes('id="league-pill"'),
    '[hdr-a] index.html carries id="league-pill" again — DI-393 re-adds it as the header\'s league zone (renderLeaguePill() was never touched by the 2026-09-25 removal; only its DOM anchor was)');
  assert(!html.includes('id="header-identity"'),
    '[hdr-b] index.html still carries NO id="header-identity" — DI-393\'s five zones do not include it; renderHeaderIdentity() still returns early with no anchor, unchanged');
  assert(html.includes('id="control-center-trigger"') && html.includes('id="header-meta"') && html.includes('id="sync-badge"'),
    '[hdr-c] the other three header elements are all still present — trigger, #header-meta, #sync-badge');
  assert(/<span id="league-pill" class="league-pill" hidden>/.test(html),
    '[hdr-c2] #league-pill starts `hidden` — DI-184c\'s "hold the slot empty rather than guess" rule: no flash of an empty pill before the first render resolves it');
  // Positional check: the five zones appear in DI-393's stated left-to-right
  // order — trigger, league pill, spacer, week+status, sync icon.
  const triggerAt = html.indexOf('id="control-center-trigger"');
  const pillAt = html.indexOf('id="league-pill"');
  const spacerAt = html.indexOf('class="header-spacer"');
  const metaAt = html.indexOf('id="header-meta"');
  const syncAt = html.indexOf('id="sync-badge"');
  assert(triggerAt !== -1 && pillAt !== -1 && spacerAt !== -1 && metaAt !== -1 && syncAt !== -1
    && triggerAt < pillAt && pillAt < spacerAt && spacerAt < metaAt && metaAt < syncAt,
    '[hdr-d] the five zones appear in DI-393 order: trigger, #league-pill, .header-spacer, #header-meta, #sync-badge');
  // DI-393's sync icon carries the new class + state attribute, not the old
  // emoji-text `.sync-badge` class the header used before this pass.
  assert(/<span id="sync-badge" class="header-sync-icon" data-sync="">/.test(html),
    '[hdr-e] #sync-badge starts as an empty `.header-sync-icon` with a `data-sync` attribute — filled by updateSyncBadge() at the first status event, never emoji text');
}


// ── [css4] 2026-09-28 — web header overflow at 375/390px. With a long round
//    label the week zone could not shrink (flex:0 0 auto, 60vw ceiling), so
//    the row overflowed its trailing edge and the SYNC ICON went off-screen.
//    Source pins for the flex contract that keeps every fixed zone on screen;
//    the rendered result at 375/390px is a browser check.
console.log('\n[css4] web header overflow — the week name ellipsizes, the pill gives way first, the sync icon never leaves the row…');
{
  const css = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
  const body = (re) => (css.match(re) || [])[1];
  const meta = body(/\.header-meta\{([^}]*)\}/);
  const pill = body(/#league-pill\{([^}]*)\}/);
  const sync = body(/#sync-badge\{([^}]*)\}/);
  const trig = body(/\.control-center-trigger\{([^}]*)\}/);
  const metaWhenPillHidden = body(/#league-pill\[hidden\]~\.header-meta\{([^}]*)\}/);
  assert(flexShrinkIn(metaWhenPillHidden) > 0 && /min-width:\s*0/.test(meta || ''),
    `[css4-a] .header-meta can shrink once the pill is hidden (#league-pill[hidden]~.header-meta shrink ${flexShrinkIn(metaWhenPillHidden)} > 0) AND has min-width:0 — without min-width:0 a flex item never shrinks below its text's min-content width, so the ellipsis would never engage and the overflow would still go out the trailing edge (got "${meta}")`);
  // Reviewer BLOCK round 2 (2026-09-28) — a RATIO is not an order. 100:1 still
  // let the week zone give up a fraction of a pixel while the pill was on
  // screen, and that fraction clipped the status badge (rendered at 375/390).
  // The contract is now STRICT: .header-meta's own shrink is 0, and only the
  // `#league-pill[hidden]` sibling rule turns it on.
  assert(flexShrinkIn(pill) > 0 && flexShrinkIn(meta) === 0 && flexShrinkIn(metaWhenPillHidden) > 0,
    `[css4-b] STRICT order (DI-393): while #league-pill is visible .header-meta cannot shrink AT ALL (meta shrink ${flexShrinkIn(meta)} must be 0; pill ${flexShrinkIn(pill)} > 0), and #league-pill[hidden]~.header-meta re-enables it (${flexShrinkIn(metaWhenPillHidden)}) — a shrink RATIO, however lopsided, still hands the week zone a fraction of the squeeze`);
  assert(flexShrinkIn(sync) === 0 && flexShrinkIn(trig) === 0,
    `[css4-c] the sync icon and the trigger NEVER shrink (flex:0 0 auto) — they are what the row protects (sync "${sync}", trigger "${trig}")`);
  // [css4-d] — the badge must be OUTSIDE the ellipsis box to survive. On
  // 3e4f57a `.week-heading-name` was display:block + text-overflow:ellipsis
  // with the badge INSIDE it, so `.header-meta .badge{flex-shrink:0}` was
  // inert (the badge was not a flex item of anything) and the ellipsis ate
  // "LOCKED" before it ate the name. Three things must all hold: the name
  // box is a flex row, it does NOT carry text-overflow itself, and the badge
  // and strong are its flex items with the badge unshrinkable and the strong
  // the only ellipsizing one.
  const nameBox = body(/\.week-heading-inline \.week-heading-name\{([^}]*)\}/) || '';
  const strongRule = body(/\.header-meta strong\{([^}]*)\}/) || '';
  assert(/display:\s*flex/.test(nameBox) && !/text-overflow/.test(nameBox) && /min-width:\s*0/.test(nameBox),
    `[css4-d1] .week-heading-name is a FLEX ROW with min-width:0 and no text-overflow of its own — the badge is a flex item, not text inside an ellipsis box (got "${nameBox}")`);
  assert(/flex-shrink:\s*0/.test(body(/\.header-meta \.badge\{([^}]*)\}/) || ''),
    '[css4-d2] the status badge never shrinks (.header-meta .badge{flex-shrink:0}) — and now that it IS a flex item of the name row, the declaration is live, not inert');
  assert(/text-overflow:\s*ellipsis/.test(strongRule) && /min-width:\s*0/.test(strongRule) && /overflow:\s*hidden/.test(strongRule),
    `[css4-d3] the <strong> week NAME is the one element that ellipsizes (overflow:hidden + text-overflow:ellipsis + min-width:0 so it can shrink as a flex item) — never "LOCKED" (got "${strongRule}")`);
  const appSrc4 = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/<span class="week-heading-name"><strong>\$\{escHtml\(wl\.name\)\}<\/strong><span class="badge badge-\$\{escHtml\(week\.status\)\} ml-sm">\$\{escHtml\(week\.status\.toUpperCase\(\)\)\}<\/span><\/span>/.test(appSrc4),
    '[css4-d4] the header markup is exactly strong + badge as SIBLINGS inside .week-heading-name (the flex items [css4-d1..d3] describe), with both status interpolations escaped');
  // MUTANT 1: the 3e4f57a shape (ratio, not order) must fail [css4-b].
  const mutant = css.replace(/\.header-meta\{display:flex;align-items:center;flex:0 0 auto;min-width:0;/, '.header-meta{display:flex;align-items:center;flex:0 1 auto;min-width:0;');
  assert(mutant !== css, '[css4-mut] sanity: the 3e4f57a .header-meta text was substituted into a string copy');
  const mMeta = (mutant.match(/\.header-meta\{([^}]*)\}/) || [])[1];
  assert(!(flexShrinkIn(mMeta) === 0),
    '[css4-mut] …and [css4-b] goes RED against it — the pin discriminates "week zone shrinks while the pill is visible"');
  // MUTANT 2: the 3e4f57a name-box shape (badge inside the ellipsis box) must fail [css4-d1].
  const mutant2 = css.replace(/\.week-heading-inline \.week-heading-name\{[^}]*\}/, '.week-heading-inline .week-heading-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}');
  const mBox = (mutant2.match(/\.week-heading-inline \.week-heading-name\{([^}]*)\}/) || [])[1] || '';
  assert(mutant2 !== css && !(/display:\s*flex/.test(mBox) && !/text-overflow/.test(mBox)),
    '[css4-mut2] the badge-inside-the-ellipsis-box shape goes RED against [css4-d1] — the pin discriminates the dropped-badge regression');
}

// ── [pill] 2026-09-28 — #league-pill: hidden below 48px of room, and the
//    multi-league control answers Enter/Space like the button it claims to be.
console.log('\n[pill] #league-pill — hides below 48px, and role="button" activates on Enter/Space…');
{
  const app = await import('./js/app.js');
  const auth = await import('./js/auth.js');
  // A pill element with real listener bookkeeping and a controllable layout box.
  const makePill = () => ({
    id: 'league-pill', hidden: true, _html: '', attrs: {}, _l: {}, _rects: 1, _width: 120,
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this._l[t] = (this._l[t] || []).filter(x => x !== fn); },
    count(t) { return (this._l[t] || []).length; },
    fire(t, ev) { (this._l[t] || []).forEach(fn => fn(ev)); },
    getClientRects() { return new Array(this._rects).fill({}); },
    getBoundingClientRect() { return { width: this.hidden ? 0 : this._width }; },
  });
  const pill = makePill();
  idMap['league-pill'] = pill;
  // showLeagueSelectorSheet() builds an overlay and appends it to <body>; the
  // sheet opening IS the observable outcome, so the spy records appends.
  const opened = [];
  const richEl = () => ({
    attrs: {}, classList: { add(){}, remove(){} }, style: {}, dataset: {},
    addEventListener(){}, setAttribute(k, v){ this.attrs[k] = v; }, remove(){},
    querySelector(){ return null; }, querySelectorAll(){ return []; },
    _html: '', set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; },
  });
  const realCreate = document.createElement;
  document.createElement = richEl;
  document.body.appendChild = (el) => { opened.push(el); };

  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
  auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  auth._setMembershipsForTest([
    { leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' },
    { leagueId: 'B', memberId: 'm2', role: 'commissioner', displayName: 'x', leagueName: 'League B' },
  ]);
  auth.setActiveLeagueId('A');

  app.renderLeaguePill();
  assert(pill.hidden === false && pill.getAttribute('role') === 'button' && pill.getAttribute('tabindex') === '0',
    `[pill-0] fixture: two memberships render the INTERACTIVE pill (hidden=${pill.hidden}, role=${pill.getAttribute('role')}, tabindex=${pill.getAttribute('tabindex')}) at 120px of room`);
  assert(pill.count('click') === 1 && pill.count('keydown') === 1,
    `[pill-1] exactly one click AND one keydown handler (click ${pill.count('click')}, keydown ${pill.count('keydown')})`);

  let prevented = 0;
  const key = (k) => ({ key: k, preventDefault() { prevented++; } });
  opened.length = 0; prevented = 0;
  pill.fire('keydown', key('Enter'));
  assert(opened.length === 1 && /Choose a League/.test(opened[0].innerHTML) && prevented === 1,
    `[pill-2] Enter opens the SAME league-selector sheet a tap opens (opened ${opened.length}, prevented ${prevented})`);
  opened.length = 0; prevented = 0;
  pill.fire('keydown', key(' '));
  assert(opened.length === 1 && prevented === 1,
    `[pill-3] Space opens it too, and its default (page scroll) is prevented (opened ${opened.length}, prevented ${prevented})`);
  opened.length = 0; prevented = 0;
  pill.fire('keydown', key('Tab')); pill.fire('keydown', key('a'));
  assert(opened.length === 0 && prevented === 0,
    '[pill-4] any other key does nothing and prevents nothing — Tab still moves focus');
  opened.length = 0;
  pill.fire('click', {});
  assert(opened.length === 1, '[pill-5] a tap still opens the sheet (the click path is unchanged)');

  app.renderLeaguePill(); app.renderLeaguePill();
  assert(pill.count('keydown') === 1, `[pill-6] re-rendering never stacks a second keydown handler (got ${pill.count('keydown')})`);

  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'League A' }]);
  auth.setActiveLeagueId('A');
  app.renderLeaguePill();
  assert(pill.count('keydown') === 0 && pill.count('click') === 0 && pill.getAttribute('role') === null,
    '[pill-7] a SINGLE-membership pill is a static label: no keydown, no click, no role (DI-184b)');

  // ── the 48px rule ──
  pill._width = 30; app.renderLeaguePill();
  assert(pill.hidden === true, `[pill-8] with 30px of room the pill is HIDDEN, not a bordered sliver (hidden=${pill.hidden})`);
  pill._width = 48; app.renderLeaguePill();
  assert(pill.hidden === false, '[pill-9] at exactly 48px it shows — and a later render with room brings a hidden pill back (renderLeaguePill unhides before it measures)');
  pill._width = 0; pill._rects = 0; app.renderLeaguePill();
  assert(pill.hidden === false,
    '[pill-10] a pill that is not laid out at all (no client rects — e.g. the header is display:none on the chat tab) is NOT hidden: 0px there means "not rendered", not "no room"');
  pill._rects = 1; pill._width = 47;
  app._fitLeaguePillForTest(pill);
  assert(pill.hidden === true, '[pill-11] _fitLeaguePill() alone: 47px -> hidden (the threshold is 48, exclusive)');

  // ── resize / rotation refit (reviewer finding 5, fix-final-v0270) ──
  // The fit is MEASURED, so a rotation has to re-measure: a hidden pill with
  // a label comes back when the row is wide again, goes away when it is not,
  // and a pill _clearLeaguePill() emptied stays hidden (nothing to show).
  Object.defineProperty(pill, 'textContent', { get() { return this._html.replace(/<[^>]*>/g, ''); }, configurable: true });
  pill.hidden = true; pill._width = 120;
  app._refitLeaguePillForTest();
  assert(pill.hidden === false && /League A/.test(pill.textContent),
    `[pill-12] resize refit: a hidden pill WITH a label is unhidden and re-measured — 120px of room brings it back without waiting for the next refreshHeader() (hidden=${pill.hidden})`);
  pill._width = 30;
  app._refitLeaguePillForTest();
  assert(pill.hidden === true, '[pill-13] resize refit the other way: rotated back to 30px of room it hides again');
  pill._width = 120; pill._html = ''; pill.hidden = true;
  app._refitLeaguePillForTest();
  assert(pill.hidden === true, '[pill-14] an EMPTIED pill (cleared by _clearLeaguePill — no membership, pins mode) is never unhidden by a resize: there is nothing to show');
  assert(/addEventListener\('resize', \(\) => \{\s*if \(typeof requestAnimationFrame === 'function'\) requestAnimationFrame\(_refitLeaguePill\);/.test(readFileSync(new URL('./js/app.js', import.meta.url), 'utf8')),
    '[pill-15] the refit is bound to window resize at boot (a rotation is a resize event) — the function above is not dead code');

  document.createElement = realCreate;
  delete idMap['league-pill'];
  auth.configureAuth({ authMode: 'pins' });
}

// ── [sync] 2026-09-28 — updateSyncBadge() rendered a SECOND `.header-sync-icon`
//    inside #sync-badge; that inner span's base colour beat the state colour
//    it would inherit from #sync-badge[data-sync], so every state painted the
//    synced colour. Driven through the real function.
console.log('\n[sync] the header sync icon — ONE .header-sync-icon, and it is the one carrying data-sync…');
{
  const app = await import('./js/app.js');
  const badge = { id: 'sync-badge', className: '', dataset: {}, attrs: {}, _html: '',
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { this.attrs[k] = v; } };
  idMap['sync-badge'] = badge;
  for (const status of ['synced', 'syncing', 'error', 'refused', 'offline']) {
    app._updateSyncBadgeForTest(status);
    const outer = badge.className.split(/\s+/).filter(c => c === 'header-sync-icon').length;
    const inner = (badge.innerHTML.match(/\bheader-sync-icon\b/g) || []).length;
    assert(outer + inner === 1 && outer === 1 && badge.dataset.sync === status,
      `[sync-${status}] exactly ONE .header-sync-icon (outer ${outer}, inner ${inner}) and it is #sync-badge itself, carrying data-sync="${badge.dataset.sync}"`);
  }
  assert(/<svg\b/.test(badge.innerHTML) && /class="header-sync-glyph"/.test(badge.innerHTML),
    '[sync-glyph] the glyph is still rendered, inside a `.header-sync-glyph` wrapper');
  const css = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const glyphRules = [...css.matchAll(/([^{}]*\.header-sync-glyph[^{}]*)\{([^}]*)\}/g)];
  assert(glyphRules.length >= 1 && glyphRules.every(m => !/(^|[;\s])color\s*:/.test(m[2])),
    `[sync-css] no rule sets a colour on .header-sync-glyph, so the glyph inherits the state colour (rules: ${JSON.stringify(glyphRules.map(m => m[1].trim() + '{' + m[2] + '}'))})`);
  assert(glyphRules.some(m => /\.header-sync-glyph svg/.test(m[1]) && /width:\s*24px/.test(m[2]) && /height:\s*24px/.test(m[2])),
    '[sync-size] and the glyph svg keeps its 24x24 box');
  assert(/\.header-sync-icon\[data-sync="syncing"\]\{[^}]*color:var\(--gold-light\)/.test(css),
    '[sync-state] the per-state colours still key on `.header-sync-icon[data-sync="…"]` — the element that now carries both');
  delete idMap['sync-badge'];
}

// ── [copy] 2026-09-28 — the Settings page is gone (app-shell part 3B);
//    Notifications lives in the menu (top left). Source scan of shipped js,
//    string content only (comments stripped), for copy that still points at
//    a Settings page.
console.log('\n[copy] no shipped copy sends a player to a "Settings" page that no longer exists…');
{
  const { readdirSync } = await import('node:fs');
  const dir = new URL('./js/', import.meta.url);
  // Reviewer (fix-final-v0270, 2026-09-28): the one entry this list held —
  // the reminders toast, "enable them in Settings" — was WRONG copy, not
  // Admin-panel copy: the toast fires from the Comm panel's Week wizard and
  // the reminders switch is the Background Jobs card on Admin → DATA
  // (js/admin-panel.js CARD_TAB 'background-jobs': 'data'), not a Settings
  // tab. It now reads "Admin panel → Data → Background Jobs" and is swept
  // like everything else. The list stays so a future exception is a
  // decision recorded here, not a hole.
  const ALLOWED = [];
  assert(/an admin can turn them on in the Admin panel → Data → Background Jobs/.test(readFileSync(new URL('./js/app.js', import.meta.url), 'utf8')),
    '[copy-0] the reminders toast names where the switch actually is (Admin panel → Data → Background Jobs)');
  const hits = [];
  for (const f of readdirSync(dir).filter(n => n.endsWith('.js'))) {
    let src = readFileSync(new URL(f, dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    src = src.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
    for (const a of ALLOWED) src = src.split(a).join('');
    for (const m of src.matchAll(/in Settings\b|Settings →/g)) {
      hits.push(`${f}:${src.slice(0, m.index).split('\n').length}: …${src.slice(Math.max(0, m.index - 40), m.index + 30).replace(/\s+/g, ' ')}…`);
    }
  }
  assert(hits.length === 0, `[copy-1] no "in Settings" / "Settings →" string remains in shipped js outside the named Admin allow-list (hits: ${JSON.stringify(hits)})`);
  const pst = readFileSync(new URL('./js/push-selftest.js', import.meta.url), 'utf8');
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert((pst.match(/the menu \(top left\) → Notifications/g) || []).length === 5 && /turn this off anytime in the menu \(top left\) → Notifications/.test(appSrc),
    '[copy-2] fixture check — the five push-selftest.js lines and the app.js opt-in line now name the menu (top left) → Notifications');
  // MUTANT: the old opt-in copy must trip [copy-1]'s matcher.
  assert(/in Settings\b|Settings →/.test('You can turn this off anytime in Settings.') && /in Settings\b|Settings →/.test('go to Settings → Notifications'),
    '[copy-mut] the matcher catches both old phrasings (a scan that cannot match them would pass vacuously)');
}

console.log(`\n${pass} passed, ${fail} failed`);
// REVIEWER F3 (seventh gate, 2026-09-17) — FLUSH BEFORE EXITING.
// `process.exit()` does not drain stdout/stderr, and both are ASYNCHRONOUS
// whenever they are a pipe — which is what they are under loadtest.mjs's
// spawnSync() and under every `| grep` a human runs. So the one summary line a
// parent suite parses can be dropped from a run that really did finish, and a
// FAILING run whose line never arrives reads as a harness problem instead. The
// nested empty writes' callbacks fire only once every earlier write on that
// stream has reached the OS; BOTH streams are drained because loadtest.mjs
// parses `stdout + stderr`. Same fix as authtest.mjs/boottest.mjs, applied
// without changing one character of what is printed.
process.stdout.write('', () => process.stderr.write('', () => process.exit(fail > 0 ? 1 : 0)));

// ── SECURITY F-6 (eighth gate, 2026-09-18) — THE FLUSH SHIM NEEDS ITS OWN
//    BACKSTOP ─────────────────────────────────────────────────────────────────
// The write-then-exit-in-the-callback shim above (reviewer F-3, seventh gate)
// fixed a dropped summary line by making the exit wait for the bytes. That trade
// bought correctness with a new failure mode: if the callback NEVER fires, the
// process never exits. It does not fire when the reader at the other end of the
// pipe has gone away mid-write, when stdout is a full pipe nobody is draining,
// or when an imported module has wedged the event loop — and loadtest.mjs runs
// every one of these suites through spawnSync(), which has no timeout and would
// simply hang the whole sweep with no output to say which suite did it.
//
// So the exit is armed twice. The callback is still the fast path and still the
// one that runs on every healthy run; this timer only ever fires if that path
// did not. .unref() is what keeps it honest — an unref'd timer does not hold the
// event loop open on its own account, so it cannot delay a natural exit by five
// seconds or resurrect a process that was ready to leave. It just makes "hang
// forever" impossible.
setTimeout(() => process.exit(fail === 0 ? 0 : 1), 5000).unref();
