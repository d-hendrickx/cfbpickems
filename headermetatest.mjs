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
  // NOTE (reviewer round 2, 2026-09-28): this split is NOT brace-matched —
  // each "block" runs from one `@media` token to the START of the next one,
  // so it overruns the real closing `}` and can pick up an unrelated later
  // rule's text (including a comment's own prose) as if it were still inside
  // an earlier min-width block. A literal ".header-meta" anywhere in that
  // span — even inside a comment describing an unrelated selector — trips
  // this check; see css/styles.css's `.league-pill-sport` comment (DI-417)
  // for a real instance this caught. Brace-matching would remove the
  // false-positive risk; left as a text-level check per this file's own
  // established convention, with this note so the next editor doesn't
  // re-diagnose it from scratch.
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
  // RE-DERIVED v0.27.1 merge (2026-09-28): the 60vw ceiling is GONE. With the
  // strict truncation order ([css4]) it was redundant as a backstop and, once
  // the trigger became icon-only (DI-405), actively wrong — at 430px a long
  // round name ellipsized while the pill still had room. The backstop is the
  // flex chain: pill shrinks → hidden <48px → only then may this zone shrink.
  assert(!!headerMetaMatch && !/max-width/.test(headerMetaMatch[1]) && /flex:\s*0\s+0\s+auto/.test(headerMetaMatch[1]),
    `.header-meta carries NO max-width ceiling and stays flex:0 0 auto at base — a ceiling would let the week name truncate ahead of a visible league pill (got "${headerMetaMatch?.[1]}")`);
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
  // RE-DERIVED 2026-09-28 (DI-393 amendment, league pill centred): a
  // LEADING spacer now sits between the trigger and the pill, the twin of
  // the trailing one, so the pill is centred in the free space between them.
  const triggerAt = html.indexOf('id="control-center-trigger"');
  const leadSpacerAt = html.indexOf('class="header-spacer header-spacer--lead"');
  const pillAt = html.indexOf('id="league-pill"');
  const spacerAt = html.indexOf('class="header-spacer"');
  const metaAt = html.indexOf('id="header-meta"');
  const syncAt = html.indexOf('id="sync-badge"');
  assert(triggerAt !== -1 && leadSpacerAt !== -1 && pillAt !== -1 && spacerAt !== -1 && metaAt !== -1 && syncAt !== -1
    && triggerAt < leadSpacerAt && leadSpacerAt < pillAt && pillAt < spacerAt && spacerAt < metaAt && metaAt < syncAt,
    '[hdr-d] the zones appear in DI-393 order (amended 2026-09-28): trigger, leading .header-spacer, #league-pill, .header-spacer, #header-meta, #sync-badge');
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

// ── [css5] 2026-09-28 — DI-393 amendment (Drew, v0.27.0 feedback: "the 'IRB
//    Pickems' pill in the top header is not centered in the space it's in").
//    The pill is centred by a SECOND, leading `.header-spacer` — two equal
//    zero-basis spacers split the free space around it. Source pins for the
//    mechanism; the pixel result (±1 px at 390/393/430, the strict order at
//    375/390) is engine-measured in shellrendertest.mjs [B].
console.log('\n[css5] header — the league pill is centred between two equal spacers, without touching the truncation order…');
{
  const css = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8');
  const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  const rowOf = (h) => (h.match(/<div class="app-header-inner">([\s\S]*?)<\/header>/) || [, ''])[1].replace(/<!--[\s\S]*?-->/g, '');
  // The row's direct zones, in order, by class/id token.
  const zonesOf = (h) => [...rowOf(h).matchAll(/<(?:button|span|div)\b([^>]*)>/g)]
    .map(m => m[1])
    .filter(a => /id="(control-center-trigger|league-pill|header-meta|sync-badge)"|class="header-spacer/.test(a))
    .map(a => (a.match(/id="([^"]+)"/) || [])[1] || (/header-spacer--lead/.test(a) ? 'spacer-lead' : 'spacer'));
  const zones = zonesOf(html);
  const pillIdx = zones.indexOf('league-pill');
  const centred = (z) => {
    const p = z.indexOf('league-pill');
    return p > 0 && z[p - 1] === 'spacer-lead' && z[p + 1] === 'spacer' && z.indexOf('header-meta') > p;
  };
  assert(centred(zones),
    `[css5-a] #league-pill sits BETWEEN two spacers — the leading one directly before it, the trailing one directly after it, and .header-meta after both (zones: ${zones.join(' | ')})`);
  assert(/<span class="header-spacer header-spacer--lead" aria-hidden="true"><\/span>/.test(html),
    '[css5-b] the leading spacer carries the SAME `header-spacer` class (so the one `.header-spacer{flex:1 1 0%}` rule governs both — equal growth is what centres) and is aria-hidden');
  const spacerRules = css.match(/(?:^|\n)\.header-spacer\{[^}]*\}/g) || [];
  assert(spacerRules.length === 1 && /flex:\s*1\s+1\s+0%/.test(spacerRules[0]),
    `[css5-c] exactly ONE base .header-spacer{flex:1 1 0%} rule — both spacers grow equally and neither has a basis to give up, so negative space still falls on #league-pill first (got ${JSON.stringify(spacerRules)})`);
  const leadRule = (css.match(/\.header-spacer--lead\{([^}]*)\}/) || [])[1] || '';
  const trigPad = (css.match(/\.control-center-trigger\{gap:2px;padding:0 (\d+)px\}/) || [])[1];
  assert(!!trigPad && new RegExp(`^\\s*margin-left:\\s*-${trigPad}px\\s*;?\\s*$`).test(leadRule),
    `[css5-d] the leading spacer's only declaration is margin-left:-<trigger inline padding> (-${trigPad}px) — the centring is measured from the trigger's TEXT, not its padded tap box (got "${leadRule}")`);
  assert(!/flex/.test(leadRule),
    '[css5-e] the leading spacer does NOT override the flex factors — a larger grow on either side would pull the pill off-centre');
  // The strict order is untouched: the pill still precedes .header-meta as a
  // SIBLING (the `#league-pill[hidden]~.header-meta` rule needs it), and no
  // new element was put between them other than the (basis-0) spacer.
  assert(pillIdx >= 0 && zones.indexOf('header-meta') > pillIdx && /#league-pill\[hidden\]~\.header-meta\{flex:0 1 auto\}/.test(css),
    '[css5-f] #league-pill is still a preceding sibling of .header-meta and `#league-pill[hidden]~.header-meta{flex:0 1 auto}` is intact — the pill still hides BEFORE the week name may shrink');
  // MUTANT: the v0.27.0 row (no leading spacer) must fail [css5-a].
  const mutantHtml = html.replace(/\s*<span class="header-spacer header-spacer--lead" aria-hidden="true"><\/span>/, '');
  assert(mutantHtml !== html && !centred(zonesOf(mutantHtml)),
    `[css5-mut] the v0.27.0 row (trigger | pill | spacer | meta | sync — pill hugging the trigger) goes RED against [css5-a] (zones: ${zonesOf(mutantHtml).join(' | ')})`);
  // MUTANT 2: a lead spacer that grows more than the trailing one must fail [css5-e].
  const mutantCss = css.replace(/\.header-spacer--lead\{[^}]*\}/, '.header-spacer--lead{margin-left:-10px;flex:2 1 0%}');
  assert(mutantCss !== css && /flex/.test((mutantCss.match(/\.header-spacer--lead\{([^}]*)\}/) || [])[1] || ''),
    '[css5-mut2] a lopsided grow on the leading spacer is caught by [css5-e]');
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

// ── [pill-sport] DI-417 (UN-372, 2026-09-28) — the header league pill gains
//    the active sport, "<league> · <sport>", with graceful degradation
//    (full sport name -> short code -> league name alone -> hidden) driven
//    through the REAL renderLeaguePill()/_fitLeaguePill().
//
//    FIX (reviewer round 2, BLOCK 1) — `week.sport` NEVER survives the
//    Supabase projection round trip in live data (js/supabase-projection.js's
//    own WEEK_COLS comment; createWeek() never sets `.sport` at all, so
//    `toRows()` always records it absent and `fromRows()` always deletes
//    it). Round-trip EVERY week fixture below through the REAL
//    `toRows.cfbp_weeks`/`fromRows.cfbp_weeks` — never hand-author a week
//    object carrying `sport` directly — so this suite cannot certify a
//    shape live data never actually produces again. The active league's own
//    `sportDefault` (membership field) is the fallback source the fix
//    added; every case below drives it through THAT path, matching
//    production.
console.log('\n[pill-sport] DI-417 — the league pill\'s sport: full -> code -> league-only -> hidden, driven through the real functions…');
{
  const app = await import('./js/app.js');
  const auth = await import('./js/auth.js');
  const storage = await import('./js/storage.js');
  const proj = await import('./js/supabase-projection.js');

  // Round-trip a week fixture through the REAL projection, exactly as a
  // live week actually arrives after hydrate — the ONLY way this suite is
  // allowed to certify a "live" shape (reviewer round 2). `overrides` is
  // whatever createWeek() would produce PLUS test-specific fields; `sport`
  // is never in the input unless a case explicitly wants to prove the
  // (rare, forward-compatible) "week carries its own sport" path.
  const seedWeek = (overrides) => {
    const week = { weekId: 'w1', season: 2026, weekNumber: 1, status: 'open', ...overrides };
    const rows = proj.toRows.cfbp_weeks([week], { leagueId: 'A' });
    return proj.fromRows.cfbp_weeks(rows, { leagueId: 'A' })[0];
  };

  // A pill whose CONTENT-REQUIRED width (scrollWidth) is a deterministic
  // function of its own rendered text length, and whose AVAILABLE width
  // (clientWidth / getBoundingClientRect().width) is set directly by the
  // test — the same "measured width you control" shape as [pill]'s own
  // makePill(), extended with the scroll/client pair _pillOverflowing()
  // (js/app.js) actually reads. What matters for every assertion below is
  // only the ORDER full > code > league-only, true of any real glyph
  // metric, not the literal px-per-char constant.
  const makeSportPill = () => ({
    id: 'league-pill', hidden: true, attrs: {}, _l: {}, _rects: 1, _clientWidth: 400, _html: '',
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    get textContent() { return this._html.replace(/<[^>]*>/g, ''); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this._l[t] ||= []).push(fn); },
    removeEventListener(t, fn) { this._l[t] = (this._l[t] || []).filter(x => x !== fn); },
    getClientRects() { return new Array(this._rects).fill({}); },
    getBoundingClientRect() { return { width: this.hidden ? 0 : this._clientWidth }; },
    get clientWidth() { return this._clientWidth; },
    get scrollWidth() { return this.textContent.length * 7; },
  });
  const pill = makeSportPill();
  idMap['league-pill'] = pill;

  auth.configureAuth({ authMode: 'supabase', supabaseUrl: 'https://x.test', supabaseAnonKey: 'k' });
  auth._setStoredSessionForTest({ access_token: 't', expires_at: Math.floor(Date.now() / 1000) + 3600 });
  // `sportDefault: 'cfb'` — the league's own field (auth.js:2183), the SAME
  // fallback source the League Page overlay already reads.
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'IRB Pool', sportDefault: 'cfb' }]);
  auth.setActiveLeagueId('A');
  // SEC F1's write interlock (js/storage.js save()) refuses a write while
  // authMode:'supabase' has no data backend answering — this fixture never
  // wires a real adapter, so the test-only override stands in for "the
  // adapter is serving" the same way authtest's own fixtures do.
  auth._setHasSupabaseDataBackendForTest(true);
  // The week fixture carries NO `sport` field on input (createWeek()'s real
  // shape) — round-tripped through the real projection below, `.sport`
  // comes back absent, exactly as it does live. Every assertion in this
  // main sequence is therefore proof of the MEMBERSHIP FALLBACK path, not
  // the week field — the path that was broken before this fix.
  storage.saveWeek(seedWeek({ status: 'open' }));
  storage.setActiveWeekId('w1');

  // "IRB Pool · College Football" ~= 28 chars -> 196px; "IRB Pool · CFB" ~=
  // 14 chars -> 98px; "IRB Pool" alone ~= 8 chars -> 56px.
  pill._clientWidth = 400; app.renderLeaguePill();
  assert(!pill.hidden && /College Football/.test(pill.textContent),
    `[pill-sport-0] fixture: plenty of room (400px), week round-tripped with NO sport field, membership sportDefault:'cfb' -> the FULL sport name shows via the FALLBACK ("${pill.textContent}")`);
  assert(pill.getAttribute('aria-label') === 'Active league: IRB Pool, viewing: College Football',
    `[pill-sport-1] aria-label names both league and sport (got "${pill.getAttribute('aria-label')}")`);

  pill._clientWidth = 120; app.renderLeaguePill();
  assert(!pill.hidden && /\bCFB\b/.test(pill.textContent) && !/College Football/.test(pill.textContent),
    `[pill-sport-2] tight room (120px — full overflows, code fits) -> degrades to the SHORT CODE, not hidden ("${pill.textContent}")`);
  assert(pill.getAttribute('aria-label') === 'Active league: IRB Pool, viewing: College Football',
    `[pill-sport-3] aria-label is UNCHANGED by the visual degradation step — it still names the full sport, only the visible pill compresses (got "${pill.getAttribute('aria-label')}")`);

  pill._clientWidth = 70; app.renderLeaguePill();
  assert(!pill.hidden && !/CFB|College Football/.test(pill.textContent) && /IRB Pool/.test(pill.textContent),
    `[pill-sport-4] tighter still (70px — code overflows too) -> drops the sport entirely, league name alone, not hidden ("${pill.textContent}")`);

  pill._clientWidth = 30; app.renderLeaguePill();
  assert(pill.hidden === true,
    '[pill-sport-5] below 48px even AFTER dropping the sport -> HIDDEN (DI-417\'s own last step; LEAGUE_PILL_MIN_PX unchanged)');

  // Resize widening back (a rotation) re-tries from the top (full), not
  // only ever narrows — same "unhide before re-measuring" idea applied to
  // content, not just visibility.
  pill._clientWidth = 400; app._refitLeaguePillForTest();
  assert(!pill.hidden && /College Football/.test(pill.textContent),
    `[pill-sport-6] resize refit WIDENS the row back to 400px -> the full sport name returns, not stuck at a previously-degraded step ("${pill.textContent}")`);

  // ── reviewer round 2 amendment — NO current week at all + membership
  //    sportDefault -> sport is STILL shown. "The sport you're currently
  //    viewing" names the league's sport, not only a week-scoped one.
  storage.deleteWeek('w1');
  storage.setActiveWeekId(null);
  pill._clientWidth = 400; app.renderLeaguePill();
  assert(!pill.hidden && /College Football/.test(pill.textContent),
    `[pill-sport-7] NO current week at all (deleted; getCurrentWeek() -> null), membership sportDefault:'cfb' -> the sport STILL shows, from the league fallback alone (got "${pill.textContent}")`);
  assert(pill.getAttribute('aria-label') === 'Active league: IRB Pool, viewing: College Football',
    `[pill-sport-7b] …and the aria-label names it too (got "${pill.getAttribute('aria-label')}")`);

  // ── NEITHER source resolves -> league name alone. A week round-tripped
  //    with no sport field (real shape) AND a membership with no
  //    sportDefault (a pre-0026 league, or the pins-era default null,
  //    auth.js:2170) is the one case that legitimately degrades all the way
  //    to "league name alone", per DI-184c's "hold the slot empty rather
  //    than guess" rule.
  storage.saveWeek(seedWeek({ status: 'open' }));
  storage.setActiveWeekId('w1');
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'IRB Pool', sportDefault: null }]);
  pill._clientWidth = 400; app.renderLeaguePill();
  assert(!pill.hidden && /^IRB Pool$/.test(pill.textContent),
    `[pill-sport-8] neither the week NOR the membership resolves a sport -> league name alone even with plenty of room, no "·" separator (got "${pill.textContent}")`);
  assert(pill.getAttribute('aria-label') === 'Active league: IRB Pool',
    `[pill-sport-9] …and the aria-label drops the ", viewing:" clause entirely rather than naming an unknown sport (got "${pill.getAttribute('aria-label')}")`);

  // ── priority order — a week that DOES carry its own `sport` (an explicit,
  //    forward-compatible case; still round-tripped, and it survives because
  //    it is PRESENT on the input rather than absent) wins over a DIFFERENT
  //    membership sportDefault, proving the `||` reads week-first.
  auth._setMembershipsForTest([{ leagueId: 'A', memberId: 'm1', role: 'player', displayName: 'x', leagueName: 'IRB Pool', sportDefault: 'cfb' }]);
  storage.saveWeek(seedWeek({ status: 'open', sport: 'nfl' }));
  storage.setActiveWeekId('w1');
  pill._clientWidth = 400; app.renderLeaguePill();
  assert(!pill.hidden && /\bNFL\b/.test(pill.textContent) && !/College Football/.test(pill.textContent),
    `[pill-sport-10] the week's OWN sport ('nfl', round-tripped and present) wins over a conflicting membership sportDefault ('cfb') — got "${pill.textContent}"`);

  storage.deleteWeek('w1');
  storage.setActiveWeekId(null);
  delete idMap['league-pill'];
  auth.configureAuth({ authMode: 'pins' });

  // ── mutation-proof — the SOURCE shape that makes [pill-sport-2]/[pill-sport-4]
  //    discriminating, not incidental. Same technique as [css4-mut]/[css5-mut]
  //    above: a source-text PIN, and a hand-mutated copy of the exact same
  //    text proven to fail it. escHtml is inside every interpolation checked
  //    separately by xsstest.mjs, not re-proven here.
  const src = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const fnMatch = src.match(/function _fitLeaguePill\(el\) \{[\s\S]*?\n\}\n/);
  assert(!!fnMatch, '[pill-sport-mut-0] fixture: found the real _fitLeaguePill() source in js/app.js');
  const fn = fnMatch[0];

  const PIN1 = /if \(_pillOverflowing\(el\)\) \{\n\s*el\.innerHTML = variants\.code;/;
  const PIN2 = /if \(_pillOverflowing\(el\)\) el\.innerHTML = variants\.leagueOnly;\n\s*\}\n\s*\}\n\s*if \(el\.getBoundingClientRect\(\)\.width < LEAGUE_PILL_MIN_PX\) el\.hidden = true;/;
  assert(PIN1.test(fn), '[pill-sport-mut-1] PIN — on overflow, the immediate next statement swaps to the short code (not a hide)');
  assert(PIN2.test(fn), '[pill-sport-mut-2] PIN — the league-only fallback closes the variants-gated degrade block, immediately followed by the width/hide check with nothing in between');

  // MUTANT 1 — "hides before trying the code": on detecting overflow, hides
  // immediately instead of degrading first. A realistic bug: treating "the
  // pill is truncated" as "give up" rather than "try a shorter variant".
  const mutant1 = fn.replace(
    '    if (_pillOverflowing(el)) {\n      el.innerHTML = variants.code;',
    '    if (_pillOverflowing(el)) {\n      el.hidden = true;\n      el.innerHTML = variants.code;'
  );
  assert(mutant1 !== fn, '[pill-sport-mut-3] fixture: mutant 1 text actually differs from the real source');
  assert(!PIN1.test(mutant1), '[pill-sport-mut-4] mutant 1 ("hides before trying the code") goes RED against PIN 1');

  // MUTANT 2 — "truncates the league name while a sport is still showing":
  // deletes the whole degrade block, so an overflowing "<league> · <sport>"
  // string is left exactly as rendered for the CSS ellipsis to clip
  // wherever it lands — potentially into the league name itself, with the
  // sport text still ahead of it in the markup.
  const degradeBlock = '  const variants = el._pillSportVariants;\n  if (variants) {\n    el.innerHTML = variants.full;\n    if (_pillOverflowing(el)) {\n      el.innerHTML = variants.code;\n      if (_pillOverflowing(el)) el.innerHTML = variants.leagueOnly;\n    }\n  }\n';
  assert(fn.includes(degradeBlock), '[pill-sport-mut-5] fixture: the exact degrade block text was found in the real source (so the mutant below is a real subtraction, not a straw man)');
  const mutant2 = fn.replace(degradeBlock, '  const variants = el._pillSportVariants;\n');
  assert(mutant2 !== fn && !mutant2.includes('variants.leagueOnly'),
    '[pill-sport-mut-6] fixture: mutant 2 genuinely removes the whole degrade block (no more variants.leagueOnly anywhere in it)');
  assert(!PIN2.test(mutant2), '[pill-sport-mut-7] mutant 2 ("truncates the league name while a sport is still showing") goes RED against PIN 2');
}

// ── [pill-sport-nav] DI-417 fix (reviewer round 2, BLOCK 2, 2026-09-28) —
//    the header is display:none on Chat (css/styles.css:1443). A render
//    that happens while chat is showing (a Realtime re-hydrate reaches
//    navigateTo() as a same-tab repaint, app.js:2066) leaves the pill's
//    content un-degraded, because _fitLeaguePill() bails out the instant it
//    sees zero client rects. navigateTo() now re-fits the pill exactly when
//    LEAVING chat (the one transition that flips the header back to
//    visible) — verified both structurally (the exact call exists, gated on
//    the right condition) and behaviorally (the bug reproduces, and the
//    SAME function navigateTo() now calls corrects it).
console.log('\n[pill-sport-fonts] DI-417 reviewer N1 — the pill refits once the web fonts settle (a fallback-font first fit drops the sport at phone widths)…');
{
  const appSrcF = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(/document\.fonts\?\.ready\?\.then\(\(\) => \{[^}]*_refitLeaguePill/.test(appSrcF),
    '[pill-sport-fonts-1] boot wiring: document.fonts.ready → requestAnimationFrame(_refitLeaguePill) — the first fit may have measured the fallback font');
  const mutantF = appSrcF.replace(/document\.fonts\?\.ready\?\.then\(\(\) => \{[^}]*\}\);/, '');
  assert(mutantF !== appSrcF && !/document\.fonts\?\.ready\?\.then\(\(\) => \{[^}]*_refitLeaguePill/.test(mutantF),
    '[pill-sport-fonts-mut] removing the font-ready refit goes RED against [pill-sport-fonts-1]');
}

console.log('\n[pill-sport-nav] DI-417 fix — navigateTo() re-fits the league pill on leaving chat, correcting stale content the hidden header could not lay out…');
{
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  assert(
    /if \(_priorTab === 'chat' && tab !== 'chat' && typeof requestAnimationFrame === 'function'\) \{\s*\n\s*requestAnimationFrame\(_refitLeaguePill\);\s*\n\s*\}/.test(appSrc),
    '[pill-sport-nav-0] STRUCTURAL — navigateTo() calls requestAnimationFrame(_refitLeaguePill) gated on `_priorTab === \'chat\' && tab !== \'chat\'` — exactly the leave-chat transition, not every navigation'
  );
  // Anti-vacuity: a version gated on "any tab change" (not specifically
  // leaving chat) would ALSO satisfy a looser pin — confirm the pin above
  // requires the leave-chat condition specifically by checking it does NOT
  // match a same-tab-repaint or a chat-to-chat shape.
  const genericMutant = appSrc.replace(
    "if (_priorTab === 'chat' && tab !== 'chat' && typeof requestAnimationFrame === 'function') {\n    requestAnimationFrame(_refitLeaguePill);\n  }",
    "if (typeof requestAnimationFrame === 'function') {\n    requestAnimationFrame(_refitLeaguePill);\n  }"
  );
  assert(genericMutant !== appSrc, '[pill-sport-nav-0b] fixture: the generic (any-navigation) mutant text actually differs from the real source');
  assert(!/if \(_priorTab === 'chat' && tab !== 'chat' && typeof requestAnimationFrame === 'function'\) \{\s*\n\s*requestAnimationFrame\(_refitLeaguePill\);\s*\n\s*\}/.test(genericMutant),
    '[pill-sport-nav-0c] the generic mutant (re-fits on EVERY navigation, not just leaving chat) goes RED against the pin above');

  const app = await import('./js/app.js');
  const pill = {
    id: 'league-pill', hidden: false, attrs: {}, _l: {}, _rects: 0, _clientWidth: 120,
    _html: 'IRB Pool <span class="league-pill-sport">· College Football</span>',
    // What renderLeaguePill() would have stashed for _fitLeaguePill()'s own
    // degrade steps — set directly here since this fixture reproduces the
    // POST-render state (a render already happened while chat's header was
    // display:none), not the render itself.
    _pillSportVariants: {
      full: 'IRB Pool <span class="league-pill-sport">· College Football</span>',
      code: 'IRB Pool <span class="league-pill-sport">· CFB</span>',
      leagueOnly: 'IRB Pool',
    },
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    get textContent() { return this._html.replace(/<[^>]*>/g, ''); },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener() {}, removeEventListener() {},
    getClientRects() { return new Array(this._rects).fill({}); },
    getBoundingClientRect() { return { width: this.hidden ? 0 : this._clientWidth }; },
    get clientWidth() { return this._clientWidth; },
    get scrollWidth() { return this.textContent.length * 7; },
  };
  idMap['league-pill'] = pill;

  // BEHAVIORAL — reproduce the exact bug: 0 client rects (the header is
  // display:none, as it is on Chat) means _fitLeaguePill() returns before
  // touching content OR the hidden flag — the stale FULL text (120px is far
  // too narrow for it) is left sitting there un-degraded, and NOT hidden
  // either (both would be wrong once the header is actually laid out again
  // at that width).
  app._fitLeaguePillForTest(pill);
  assert(pill.hidden === false && /College Football/.test(pill.textContent),
    `[pill-sport-nav-1] fixture: a fit attempt with 0 client rects (simulating chat's display:none header) changes NOTHING — the full, un-degraded text is left in place (got "${pill.textContent}", hidden=${pill.hidden})`);

  // …then "leaving chat": rects become available again (the header is laid
  // out), and _refitLeaguePill() — the EXACT function navigateTo() now
  // calls on that transition — corrects it.
  pill._rects = 1;
  app._refitLeaguePillForTest();
  assert(pill.hidden === false && /\bCFB\b/.test(pill.textContent) && !/College Football/.test(pill.textContent),
    `[pill-sport-nav-2] …leaving chat (rects restored) and re-fitting: at 120px the pill now correctly shows the SHORT CODE instead of the stale, un-degraded full text (got "${pill.textContent}")`);

  delete idMap['league-pill'];
}

// ── [sync] 2026-09-28 — updateSyncBadge() rendered a SECOND `.header-sync-icon`
//    inside #sync-badge; that inner span's base colour beat the state colour
//    it would inherit from #sync-badge[data-sync], so every state painted the
//    synced colour. Driven through the real function.
console.log('\n[sync] the header sync icon — ONE .header-sync-icon, and it is the one carrying data-sync…');
{
  const app = await import('./js/app.js');
  const listeners = {};
  const badge = { id: 'sync-badge', className: '', dataset: {}, attrs: {}, _html: '',
    set innerHTML(v) { this._html = v; }, get innerHTML() { return this._html; },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    // DI-399(a) (2026-09-28) — real enough to drive bindSyncBadgeTap()'s
    // click/keydown listeners, same `_fire` convention drafttest.mjs's DOM
    // stub already uses.
    addEventListener(t, fn) { (listeners[t] ||= []).push(fn); },
    _fire(t, ev = {}) { const e = { preventDefault() {}, ...ev }; (listeners[t] || []).forEach(fn => fn(e)); } };
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
  assert(!/aria-label/.test(badge.innerHTML),
    '[sync-glyph-decorative] the glyph itself carries no aria-label any more — #sync-badge (the interactive control) is the one accessible name, not two (icon() with no label renders aria-hidden, js/icons.js)');
  const css = readFileSync(new URL('./css/styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const glyphRules = [...css.matchAll(/([^{}]*\.header-sync-glyph[^{}]*)\{([^}]*)\}/g)];
  assert(glyphRules.length >= 1 && glyphRules.every(m => !/(^|[;\s])color\s*:/.test(m[2])),
    `[sync-css] no rule sets a colour on .header-sync-glyph, so the glyph inherits the state colour (rules: ${JSON.stringify(glyphRules.map(m => m[1].trim() + '{' + m[2] + '}'))})`);
  assert(glyphRules.some(m => /\.header-sync-glyph svg/.test(m[1]) && /width:\s*24px/.test(m[2]) && /height:\s*24px/.test(m[2])),
    '[sync-size] and the glyph svg keeps its 24x24 box');
  assert(/\.header-sync-icon\[data-sync="syncing"\]\{[^}]*color:var\(--gold-light\)/.test(css),
    '[sync-state] the per-state colours still key on `.header-sync-icon[data-sync="…"]` — the element that now carries both');

  // ── DI-399(a) (UN-359, 2026-09-28) — a real tappable control ─────────────
  console.log('   #sync-badge is now role="button" — attributes per state, tap target, keyboard, inert…');
  const TAP_LABEL = { synced: 'Sync now', syncing: 'Syncing…', error: 'Sync problem — tap to retry', refused: 'Sync problem — tap to retry', offline: 'Sync now' };
  for (const status of ['synced', 'syncing', 'error', 'refused', 'offline']) {
    app._updateSyncBadgeForTest(status);
    assert(badge.attrs.role === 'button' && badge.attrs.tabindex === '0',
      `[sync-role-${status}] role="button" tabindex="0" on every status (got role=${badge.attrs.role} tabindex=${badge.attrs.tabindex})`);
    assert(badge.attrs['aria-label'] === TAP_LABEL[status],
      `[sync-label-${status}] aria-label is the TAP label, not the plain status word — got ${JSON.stringify(badge.attrs['aria-label'])}, want ${JSON.stringify(TAP_LABEL[status])}`);
    if (status === 'syncing') assert(badge.attrs['aria-disabled'] === 'true', '[sync-inert-syncing] aria-disabled="true" while a sync is already running');
    else assert(!('aria-disabled' in badge.attrs), `[sync-active-${status}] aria-disabled is ABSENT for every other status (got ${JSON.stringify(badge.attrs['aria-disabled'])})`);
  }
  const cssTap = css;
  // Re-derived: width/height + negative margin measurably broke the header's
  // own trailing-edge geometry (shellrendertest.mjs [B], #sync-badge has
  // zero slack on its right — it is the header's last zone) and shifted the
  // glyph's visual centre (flex-centred within a box that grew
  // asymmetrically). An out-of-flow `::before` on a `position:relative`
  // host leaves `#sync-badge`'s OWN box — what every existing header
  // geometry assertion measures — untouched.
  assert(/\.header-sync-icon\{[^}]*position:relative/.test(cssTap),
    '[sync-hitbox-host] .header-sync-icon is a position:relative host for the enlarged hit area');
  assert(/\.header-sync-icon::before\{content:'';position:absolute;top:-8px;right:-8px;bottom:-8px;left:-8px\}/.test(cssTap),
    "[sync-hitbox] the tap target grows via an out-of-flow ::before (8px on every side, ~40px total) rather than the DI's own suggested width/margin trick — this file is global box-sizing:border-box (css/styles.css:530), and #sync-badge is the header's trailing-edge zone with zero slack on its right (measured, not assumed)");
  assert(/\.header-sync-icon\[role="button"\]:active:not\(\[aria-disabled="true"\]\):not\(\.sync-withheld\)\{transform:scale\(\.97\)\}/.test(cssTap),
    '[sync-touch] touch-down feedback reuses the app\'s ONE scale(.97) convention (Interaction Principles §Button Behavior), and is suppressed while aria-disabled OR content-withheld (reviewer round 2 — .sync-withheld, toggled fresh per press)');
  assert(/\.header-sync-icon\[role="button"\]:focus-visible\{outline:2px solid var\(--gold\);outline-offset:2px\}/.test(cssTap),
    '[sync-focus] a visible keyboard-focus ring, mirroring #league-pill[role="button"]:focus-visible (css:1760) — the same convention, not a bespoke one');

  // Keyboard: Enter/Space activate and prevent the browser's own default
  // (Space would otherwise scroll the page); every other key is inert and
  // does not call preventDefault (Tab must still move focus off it).
  // Driven with the badge left in the 'syncing' (inert, aria-disabled)
  // state on PURPOSE — onSyncBadgeActivate()'s own early-return on
  // aria-disabled (asserted structurally below) makes this a safe,
  // side-effect-free way to exercise the REAL bindSyncBadgeTap() listeners
  // through this file's minimal DOM (no getCurrentWeek()/renderDashboard()/
  // network path reached) while still proving the actual wiring: click and
  // keydown are attached exactly once each, and preventDefault's call
  // pattern (synchronous, BEFORE the async activate call in the real
  // handler) is real, not simulated.
  app._updateSyncBadgeForTest('syncing');
  assert(typeof app._bindSyncBadgeTapForTest === 'function', '[sync-bind-seam] bindSyncBadgeTap() is exported as a test seam, same "_xForTest" convention as the rest of this file');
  app._bindSyncBadgeTapForTest();
  assert((listeners.click || []).length === 1 && (listeners.keydown || []).length === 1,
    `[sync-bind] bindSyncBadgeTap() attaches exactly one click and one keydown listener (got click=${(listeners.click || []).length} keydown=${(listeners.keydown || []).length})`);
  const fireKey = (key) => { let pd = false; badge._fire('keydown', { key, preventDefault: () => { pd = true; } }); return pd; };
  assert(fireKey('Enter') === true, '[sync-key-enter] Enter prevents its own default (and, structurally below, fires the handler)');
  assert(fireKey(' ') === true, '[sync-key-space] Space prevents its own default (else it would scroll the page)');
  assert(fireKey('Tab') === false, '[sync-key-tab] any other key (Tab) is left alone — preventDefault is never called, so focus still moves');
  let clickThrew = false;
  try { badge._fire('click'); } catch { clickThrew = true; }
  assert(!clickThrew, '[sync-click] a click reaches the bound handler without throwing (inert while syncing, per the structural gate check below)');

  // Structural — the inert/gate checks name the SAME functions the DI
  // requires (no invented second gate condition), and runManualSync() is
  // the one function both the tap handler and the pull-to-refresh binder
  // call (CONVENTIONS #21).
  const appSrc = readFileSync(new URL('./js/app.js', import.meta.url), 'utf8');
  const activateBody = appSrc.slice(appSrc.indexOf('async function onSyncBadgeActivate'), appSrc.indexOf('function bindSyncBadgeTap'));
  assert(/getAttribute\('aria-disabled'\) === 'true'/.test(activateBody), "[sync-gate-syncing] onSyncBadgeActivate() checks the SAME aria-disabled attribute updateSyncBadge() sets — one source of truth, not a parallel flag");
  assert(/isContentWithheld\(\)/.test(activateBody), '[sync-gate-withheld] onSyncBadgeActivate() reuses isContentWithheld() — the SAME gate mountControlCenterDrawer()\'s own trigger click reuses, not a second, parallel condition');
  assert(/await runManualSync\('sync-tap'\)/.test(activateBody) && /haptic\('light'\)/.test(activateBody), "[sync-success] on success it calls runManualSync('sync-tap') then haptic('light') — the SAME completion haptic bindPullToRefresh() fires on the gesture path (js/nav-gestures.js:631), once per trigger; the reason label distinguishes the tap from the gesture's own 'pull-to-refresh' (reviewer round 2)");
  assert(/showSyncFailureBanner\(/.test(activateBody), '[sync-fail] a rejection still reaches showSyncFailureBanner() — the loud-fail contract (AD-06) is unchanged for the tap trigger; re-derived (reviewer round 3, note 3) from a bare showBackendErrorBanner() call to the SAME-suppressed-when-redundant wrapper every other manual-sync trigger uses');
  assert(/bindPullToRefresh\(getScrollEl, runManualSync,/.test(appSrc),
    '[sync-onepath] the per-tab pull-to-refresh binder now calls the SAME runManualSync() — one refresh path, not two (CONVENTIONS #21)');

  // ── Reviewer round 3, note 3 (2026-09-28, "do it") — one loud signal, not
  //    two: showSyncFailureBanner() suppresses the redundant banner when
  //    #supabase-offline-banner is already up; the rejection itself (and
  //    the haptic suppression it implies) is untouched.
  console.log('   showSyncFailureBanner() — suppressed when #supabase-offline-banner is already up (reviewer round 3, note 3)…');
  assert(typeof app._showSyncFailureBannerForTest === 'function', '[sync-3-seam] _showSyncFailureBannerForTest() is exported as a test seam');
  assert(/getElementById\('supabase-offline-banner'\)/.test(appSrc.slice(appSrc.indexOf('function showSyncFailureBanner'), appSrc.indexOf('function showSyncFailureBanner') + 400))
    && /showBackendErrorBanner\(message\)/.test(appSrc.slice(appSrc.indexOf('function showSyncFailureBanner'), appSrc.indexOf('function showSyncFailureBanner') + 400)),
    '[sync-3a] showSyncFailureBanner() checks #supabase-offline-banner before delegating to the REAL showBackendErrorBanner() — not a re-implementation');
  {
    // Behavioral, not just structural: showBackendErrorBanner() (unchanged,
    // real function) creates a #backend-error-banner element the FIRST
    // time it's called (document.getElementById returns null, so it falls
    // to document.createElement('div')) — spy on document.createElement
    // for the duration of each call and observe whether that path was
    // actually reached, the real signal the suppression is about.
    delete idMap['backend-error-banner'];
    delete idMap['supabase-offline-banner'];
    const realCreate = document.createElement;
    let createCalls = 0;
    document.createElement = (...args) => { createCalls++; return realCreate(...args); };
    app._showSyncFailureBannerForTest('offline banner absent');
    document.createElement = realCreate;
    assert(createCalls > 0, `[sync-3b] with #supabase-offline-banner ABSENT, showSyncFailureBanner() reaches the real showBackendErrorBanner() path (document.createElement called ${createCalls} time(s))`);
  }
  {
    idMap['supabase-offline-banner'] = { id: 'supabase-offline-banner' };
    delete idMap['backend-error-banner'];
    const realCreate = document.createElement;
    let createCalls = 0;
    document.createElement = (...args) => { createCalls++; return realCreate(...args); };
    app._showSyncFailureBannerForTest('offline banner present');
    document.createElement = realCreate;
    assert(createCalls === 0, `[sync-3c] with #supabase-offline-banner PRESENT, showSyncFailureBanner() does NOT reach showBackendErrorBanner() — suppressed, one loud signal not two (document.createElement called ${createCalls} time(s))`);
    delete idMap['supabase-offline-banner'];
  }

  // ── Reviewer round 2, finding 4 (2026-09-28) — runManualSync() rejects
  //    when the hydrate settled anywhere but ACTIVE, but ONLY when a
  //    hydrate was actually eligible to run. Driven through
  //    _makeRunManualSyncForTest() (js/app.js) — parametrized so this
  //    doesn't need a real Supabase client/league/session standing up just
  //    to pick a branch.
  console.log('   runManualSync() — reject on ACTIVE-STALE/OFFLINE-READONLY, stay quiet when merely deferred (reviewer round 2, finding 4)…');
  assert(typeof app._makeRunManualSyncForTest === 'function', '[sync-4-seam] _makeRunManualSyncForTest() is exported as a test seam, same "_xForTest" convention as the rest of this file');
  {
    const fn = app._makeRunManualSyncForTest(async () => {}, () => 'ACTIVE-STALE', () => true);
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    assert(threw instanceof Error && /ACTIVE-STALE/.test(threw.message),
      `[sync-4a] hydrate applicable, settled on ACTIVE-STALE — rejects (loud-fail), naming the state (got ${threw ? threw.message : 'no throw'})`);
  }
  {
    const fn = app._makeRunManualSyncForTest(async () => {}, () => 'OFFLINE-READONLY', () => true);
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    assert(threw instanceof Error && /OFFLINE-READONLY/.test(threw.message), `[sync-4b] …and OFFLINE-READONLY too (got ${threw ? threw.message : 'no throw'})`);
  }
  {
    const fn = app._makeRunManualSyncForTest(async () => {}, () => 'ACTIVE', () => true);
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    assert(threw === null, `[sync-4c] hydrate applicable, settled on ACTIVE — resolves, no throw (got ${threw && threw.message})`);
  }
  {
    // deferred identity (or PINS mode) — hydrateIsApplicable() answers
    // false, so the ACTIVE check is skipped entirely; getHydrateState()
    // would answer something non-ACTIVE if it were even asked, proving the
    // skip is real, not coincidentally passing.
    const fn = app._makeRunManualSyncForTest(async () => {}, () => 'HELD', () => false);
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    assert(threw === null, `[sync-4d] hydrate NOT applicable (deferred identity / PINS mode) — resolves quietly even though the hydrate state itself is not ACTIVE (got ${threw && threw.message})`);
  }
  {
    // Reviewer round 3, finding 2 (2026-09-28) — sync-4a..d all INJECT the
    // hydrateIsApplicable predicate, so none of them can catch a bug IN the
    // DEFAULT predicate itself (js/app.js's own `isSupabaseDataMode() &&
    // !!getActiveLeagueId() && !noIdentityEverProven()`, which used to omit
    // the league-id clause — ensureSupabaseDataHydrated()'s own
    // `!leagueId` early return, js/app.js:1959-1960 — so a device in
    // supabase mode with a proven identity but no active league selected
    // yet incorrectly counted as "applicable" and threw on whatever
    // sb.getState() happened to answer, a false loud-fail banner).
    // Only the third argument (hydrateIsApplicable) is left at its
    // default here — this drives the REAL predicate, not a stand-in.
    // isSupabaseDataMode()/getActiveLeagueId()/hasValidSupabaseSession()
    // are all synchronous, LOCAL localStorage/config reads (no network),
    // so this is safe to construct directly in this harness.
    const auth4e = await import('./js/auth.js'); // already-loaded module; re-import is a cache hit, not a re-run
    const savedAuthMode = auth4e.getAuthMode(), savedDataMode = auth4e.getDataMode();
    auth4e.configureAuth({ authMode: 'supabase', dataMode: 'supabase' }); // BOTH together — configureAuth() itself refuses a split (js/auth.js:281)
    localStorage.setItem('cfbp_supabase_session', JSON.stringify({ access_token: 'fake', expires_at: Math.floor(Date.now() / 1000) + 3600 })); // hasValidSupabaseSession() — identity IS proven
    localStorage.removeItem('cfbp_supabase_active_league'); // getActiveLeagueId() — but NO league selected
    const fn = app._makeRunManualSyncForTest(async () => {}, () => 'IDLE'); // hydrateIsApplicable NOT injected
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    assert(threw === null, `[sync-4e] the REAL default predicate — supabase mode, identity proven, but NO active league — resolves quietly even though getHydrateState() would answer IDLE (got ${threw && threw.message})`);
    localStorage.removeItem('cfbp_supabase_session');
    localStorage.removeItem('cfbp_supabase_active_league');
    auth4e.configureAuth({ authMode: savedAuthMode, dataMode: savedDataMode }); // restore BOTH — configureAuth() keeps a stale dataMode otherwise (js/auth.js:278-280), which would print a spurious split-config warning on the next call
  }

  // ── DI-399(b-ii) reviewer round 2, finding 2 (2026-09-28) — Chat's own
  //    refreshFn calls the chat transport; Picks/Dashboard's does not.
  console.log('   makeChatManualSync() — Chat\'s refreshFn reaches the chat transport; Picks/Dashboard\'s bare runManualSync() does not (reviewer round 2, finding 2)…');
  assert(typeof app._makeChatManualSyncForTest === 'function', '[sync-2-seam] _makeChatManualSyncForTest() is exported as a test seam');
  {
    const calls = [];
    const spySync = async () => { calls.push('sync'); };
    const spyChatRefresh = async () => { calls.push('chat'); };
    const fn = app._makeChatManualSyncForTest(spySync, spyChatRefresh);
    await fn();
    assert(calls.includes('sync') && calls.includes('chat'), `[sync-2a] Chat's composed refreshFn calls BOTH halves — got ${JSON.stringify(calls)}`);
  }
  {
    // A rejection from EITHER half is loud-fail — Promise.all propagates it.
    const spySync = async () => { throw new Error('hydrate down'); };
    const spyChatRefresh = async () => {};
    const fn = app._makeChatManualSyncForTest(spySync, spyChatRefresh);
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    assert(threw instanceof Error, '[sync-2b] a rejection from the league-sync half still rejects the composed function (loud-fail, not swallowed)');
  }
  {
    const spySync = async () => {};
    const spyChatRefresh = async () => { throw new Error('chat transport down'); };
    const fn = app._makeChatManualSyncForTest(spySync, spyChatRefresh);
    let threw = null;
    try { await fn(); } catch (e) { threw = e; }
    assert(threw instanceof Error, '[sync-2c] …and a rejection from the CHAT half does too — a message-fetch failure is not silently ignored just because the league sync itself succeeded');
  }
  assert(/\}\s*else\s*\{\s*bindPullToRefresh\(getScrollEl, runManualSync,/.test(appSrc.replace(/\/\/.*$/gm, '')),
    "[sync-2d] Picks/Dashboard's own else-branch passes bare runManualSync (never the chat-composed function) to bindPullToRefresh()");

  // RG-281 (reviewer round 2) — the STRONG fix for the accumulation bug is
  // the CALLER's own unbind-before-rebind discipline (js/nav-gestures.js's
  // guards are belt-and-suspenders on top of it). Structural, since driving
  // navigateTo() through real repeated DOM churn is what navgesturestest's
  // [4h]/[6c-11..13] already prove at the BINDER level — this checks the
  // WIRING: the unbind call sits BEFORE the tab branch, unconditionally,
  // on every navigateTo() (not only chat's own), same shape as
  // js/chat-ui.js's own _unbindChatThreadAnchor (RG-279).
  assert(/let _unbindChatBottomPullToRefresh = \(\) => \{\};/.test(appSrc),
    '[sync-1a] a module-level _unbindChatBottomPullToRefresh tracker exists, same "_unbindX" convention as js/chat-ui.js\'s _unbindChatThreadAnchor');
  // Reviewer round 4 condition 1 (2026-09-28) — the REAL call site's predicate,
  // not a fixture copy: deleting the option brings RG-285 back (haptic on
  // Chat history scrolls); an allowlist brings back the round-3 regression
  // (Standings/Comm/Rules/Admin lose pull-to-refresh).
  // The pin reads the bindPullToRefresh(getScrollEl, …) call's OWN argument
  // block (up to its closing `});`) — RG-289 gave the sibling bindBottomBounce
  // call the same denylist, so a loose cross-call regex would match that one.
  const WIN_PULL_BLOCK = /bindPullToRefresh\(getScrollEl,([\s\S]*?)\}\);/;
  const DENY_CHAT = /isActive:\s*\(\)\s*=>\s*document\.body\.dataset\.tab\s*!==\s*'chat'/;
  const winPullBlock = (appSrc.match(WIN_PULL_BLOCK) || [])[1] || '';
  assert(winPullBlock.length > 0 && DENY_CHAT.test(winPullBlock), '[sync-1c] the window pull-to-refresh bind in navigateTo() carries isActive: () => document.body.dataset.tab !== \'chat\' inside its OWN argument block — a DENYLIST of Chat only (DI-324: every page except the gate and sheets)');
  const winPullMutant = appSrc.replace(WIN_PULL_BLOCK, (m, inner) => 'bindPullToRefresh(getScrollEl,' + inner.replace(/isActive:\s*\(\)\s*=>\s*document\.body\.dataset\.tab\s*!==\s*'chat',?/, '') + '});');
  const mutantBlock = (winPullMutant.match(WIN_PULL_BLOCK) || [])[1] || '';
  assert(winPullMutant !== appSrc && !DENY_CHAT.test(mutantBlock),
    '[sync-1c-mut] deleting the option at the real call site goes RED against [sync-1c]');
  const gestureBlockStart = appSrc.indexOf('const getScrollEl = tab ===');
  const tabBranchAt = appSrc.indexOf("if (tab === 'chat') {", gestureBlockStart);
  const unbindCallAt = appSrc.indexOf('_unbindChatBottomPullToRefresh();', gestureBlockStart);
  assert(gestureBlockStart > 0 && tabBranchAt > gestureBlockStart && unbindCallAt > gestureBlockStart && unbindCallAt < tabBranchAt,
    '[sync-1b] the unbind call runs BEFORE the tab === "chat" branch on every navigateTo() call — unconditional, not nested inside either branch');

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
