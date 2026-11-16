/* teaser/scenes/home.js — Home: league activity (Beat B) and Game Day live (Beat C). PROMO-ONLY.
   Markup mirrors js/home.js cardHTML() and js/gameday.js gameDayCardHTML()/pillHTML(). Scores and copy are demo data. */
(function (T) {
  'use strict';
  var ui = T.ui;
  var FEED = [
    { key:'final', type:'game.final', icon:'trophy', reason:'Final', time:'4m', title:'Georgia 31, Oklahoma 17',
      body:'Georgia covered the 9.5.', chips:[['GH',1],['MB',1],['TC',1],['CR',0],['NP',1],['MT',0]] },
    { key:'rank', type:'rank.changed', icon:'rankUp', reason:'Standings', time:'12m', title:'Tyler moved up to 4th',
      body:'Passed Grant on the Georgia cover.' },
    { key:'scribe', type:'scribe.post', icon:'scribeSpark', reason:'SCRIBE', time:'20m', title:'',
      body:'Mason has taken the underdog in six straight weeks. The underdogs have not returned the favor.' },
    { key:'room', type:'lockerroom.top', icon:'chatBubble', reason:'Locker Room', time:'31m', title:'Cole',
      body:'“Tyler taking Texas again lmao”' },
    { key:'picks', type:'picks.submitted', icon:'calendarWeek', reason:'Week 8', time:'Opened 2d ago', title:'6 of 6 picks are in',
      body:'Everyone beat the lock.' }
  ];
  var PILLS = [
    { id:'g5', away:'TEX', as:21, home:'ORE', hs:17, clock:'4:12 3rd', cov:'trailing' },
    { id:'g8', away:'MICH', as:10, home:'IU', hs:13, clock:'9:40 2nd', cov:'covering' },
    { id:'g9', away:'CLEM', as:14, home:'MIA', hs:20, clock:'0:52 2nd', cov:'trailing' }
  ];
  function pageHTML() {
    return '<div class="home-feed">' + ui.gameDay({ tail:'3 live', me:'You: 1 of 3 covering', pills: PILLS }) + FEED.map(ui.feedCard).join('') + '</div>';
  }
  function setPill(phone, id, away, as, home, hs, clock, cov) {
    var p = phone.page.querySelector('.gdp[data-game-id="' + id + '"]'); if (!p) return;
    T.tickText(p.querySelector('[data-bind="score"]'), away + ' ' + as + ' – ' + home + ' ' + hs);
    p.querySelector('[data-bind="l2"]').innerHTML = T.esc(clock) + ' · <span class="gdp-cv gdp-cv--' + cov + '">' + (cov === 'covering' ? '▲ Covering' : '▽ Trailing') + '</span>';
    p.classList.remove('tz-flash'); void p.offsetWidth; p.classList.add('tz-flash');
  }
  function setMe(phone, text) { T.tickText(phone.page.querySelector('.gd-me'), text); }
  var badge = { phase:'live', label:'Live' };

  /* ── Beat B: the league's activity arrives, card by card ── */
  T.register({
    id: 'friends', label: 'League activity', tab: 'home', duration: 3.2,
    captions: [{ text: 'Challenge your friends.', from: 0.3, to: 2.9 }],
    mount: function (phone) { T.setPage(phone, 'home', 'home', pageHTML(), { badge: badge }); },
    reset: function (phone) { if (phone.pageKey !== 'home') this.mount(phone); else { phone.page.innerHTML = pageHTML(); T.setTab(phone, 'home', badge); } phone.scroll.scrollTop = 0; },
    tick: function (t, phone) {
      FEED.forEach(function (c, i) { ui.enter(phone.page.querySelector('[data-tz-card="' + c.key + '"]'), t, 0.12 + i*0.16, 18, .32); });
      phone.scroll.scrollTop = 150 * T.span(t, 0.9, 2.6, T.ease.inOut);
    }
  });

  /* ── Beat C: Game Day. Scores tick, a cover flips, the rail moves ── */
  var evG = new T.Events()
    .at(0.50, function (phone) { setPill(phone, 'g5', 'TEX', 21, 'ORE', 24, '2:47 3rd', 'covering'); setMe(phone, 'You: 2 of 3 covering'); })
    .at(1.35, function (phone) { setPill(phone, 'g8', 'MICH', 17, 'IU', 13, '7:15 2nd', 'trailing'); setMe(phone, 'You: 1 of 3 covering'); })
    .at(1.95, function (phone) { setPill(phone, 'g9', 'CLEM', 14, 'MIA', 27, 'Half', 'covering'); setMe(phone, 'You: 2 of 3 covering'); });
  T.register({
    id: 'gameday', label: 'Game Day', tab: 'home', duration: 3.4,
    captions: [{ text: 'Watch it unfold.', from: 0.3, to: 3.1 }],
    mount: function (phone) { T.setPage(phone, 'home', 'home', pageHTML(), { badge: badge }); },
    reset: function (phone) { if (phone.pageKey !== 'home') this.mount(phone); else { phone.page.innerHTML = pageHTML(); T.setTab(phone, 'home', badge); } evG.reset(); phone.scroll.scrollTop = 0; },
    tick: function (t, phone) {
      phone.scroll.scrollTop = 150*(1 - T.span(t, 0, 0.3, T.ease.native));   /* back up to Game Day */
      var rail = phone.page.querySelector('.gd-rail');
      if (rail) rail.scrollLeft = (rail.scrollWidth - rail.clientWidth) * (T.span(t, 0.85, 1.3, T.ease.native)*0.55 + T.span(t, 1.55, 1.95, T.ease.native)*0.45);
      evG.fire(t, phone);
    }
  });
})(window.TEASER);
