/* teaser/teaser.js — PROMO-ONLY engine for the Munera teaser. Not production code; imports nothing from js/.
   Loads the app's real stylesheet, builds a phone frame carrying the app's real header and tab bar, and runs
   deterministic scenes on a pausable, seekable clock: a scene is reset() + tick(t), so any time is reachable. */
window.TEASER = window.TEASER || {};
(function (T) {
  'use strict';
  T.scenes = {};
  T.register = function (scene) { T.scenes[scene.id] = scene; };

  /* ---------- easing + timeline helpers (stateless) ---------- */
  T.clamp = function (x, a, b) { return Math.min(Math.max(x, a), b); };
  T.lerp = function (a, b, p) { return a + (b - a)*p; };
  function cubicBezier(x1, y1, x2, y2, x) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    var t = x;
    for (var i = 0; i < 6; i++) {
      var cx = 3*x1, bx = 3*(x2 - x1) - cx, ax = 1 - cx - bx;
      var xt = ((ax*t + bx)*t + cx)*t - x, dx = (3*ax*t + 2*bx)*t + cx;
      if (Math.abs(dx) < 1e-6) break;
      t -= xt/dx;
    }
    var cy = 3*y1, by = 3*(y2 - y1) - cy, ay = 1 - cy - by;
    return ((ay*t + by)*t + cy)*t;
  }
  T.ease = {
    lin:      function (x) { return x; },
    outCubic: function (x) { return 1 - Math.pow(1 - x, 3); },
    outQuint: function (x) { return 1 - Math.pow(1 - x, 5); },
    inCubic:  function (x) { return x*x*x; },
    inOut:    function (x) { return x < .5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3)/2; },
    native:   function (x) { return cubicBezier(.32, .72, 0, 1, x); },      /* the app's --ease-native */
    entrance: function (x) { return cubicBezier(.16, 1, .3, 1, x); }        /* the app's --ease-entrance */
  };
  /* progress of the window [t0,t1] at time t, eased */
  T.span = function (t, t0, t1, ease) { var p = T.clamp((t - t0)/(t1 - t0), 0, 1); return ease ? ease(p) : p; };
  /* a pulse that jumps to 1 at t0 and decays over d */
  T.pulse = function (t, t0, d) { return t < t0 ? 0 : Math.exp(-(t - t0)/d*3); };

  /* One-shot events: fire(t, …) runs every event with time <= t that has not fired since reset(). */
  T.Events = function () { this.list = []; this.fired = new Set(); };
  T.Events.prototype.at = function (time, fn) { this.list.push({ time: time, fn: fn }); this.list.sort(function (a, b) { return a.time - b.time; }); return this; };
  T.Events.prototype.reset = function () { this.fired.clear(); };
  T.Events.prototype.fire = function (t, a, b) {
    for (var i = 0; i < this.list.length; i++) { var e = this.list[i]; if (e.time <= t && !this.fired.has(e)) { this.fired.add(e); e.fn(a, b, t); } }
  };

  /* ---------- the app stylesheet: the real css/styles.css, wherever this page is served from ---------- */
  /* The phone is a phone at any window size. The app's stylesheet switches layouts on the WINDOW's width (its @media rules), so in a
     wide desktop window the mock phone was drawn with the app's wide-screen rules: the standings table kept its wide columns and the
     player names had no room at all (the owner, 2026-11-16: "ranks page is still not showing the names"). Every width or height media
     rule of the app sheet is settled once against the phone's own screen: a rule that applies to a phone loses its size condition, a
     rule that does not is removed. Other conditions (hover, reduced motion, colour scheme) are kept as written. Returns how many
     rules it settled. */
  T.pinPhoneCSS = function (w, h) {
    var done = 0;
    function settle(text) {            /* null = leave the rule alone; otherwise { on, rest } */
      if (!/(width|height)/.test(text) || text.indexOf(',') >= 0) return null;
      var parts = text.split(/\s+and\s+/i), rest = [], on = true;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim(), m = /^\(\s*(min|max)-(width|height)\s*:\s*([\d.]+)(px|em|rem)\s*\)$/i.exec(p);
        if (m) {
          var lim = parseFloat(m[3])*(m[4].toLowerCase() === 'px' ? 1 : 16), val = m[2].toLowerCase() === 'width' ? w : h;
          if (m[1].toLowerCase() === 'min' ? val < lim : val > lim) on = false;
        } else if (/(width|height)/.test(p)) return null;   /* a size condition written another way: leave the rule as it is */
        else rest.push(p);
      }
      return { on: on, rest: rest.join(' and ') };
    }
    function walk(group) {
      var rules; try { rules = group.cssRules; } catch (e) { return; }
      for (var i = 0; i < rules.length; ) {
        var r = rules[i];
        if (r.type === 4) {              /* a media rule */
          var s = settle(r.conditionText || (r.media && r.media.mediaText) || '');
          if (s) {
            var inner = Array.prototype.map.call(r.cssRules, function (c) { return c.cssText; });
            group.deleteRule(i); done++;
            if (s.on) {
              if (s.rest) { try { group.insertRule('@media ' + s.rest + ' {' + inner.join('\n') + '}', i); } catch (e) {} }
              else for (var k = inner.length - 1; k >= 0; k--) { try { group.insertRule(inner[k], i); } catch (e) {} }
            }
            continue;                    /* look at this index again: it holds what replaced the rule, or the next rule */
          }
        }
        if (r.cssRules && r.type !== 1) walk(r);
        i++;
      }
    }
    Array.prototype.forEach.call(document.styleSheets, function (sh) {
      var n = sh.ownerNode; if (!n) return;
      if (n.id === 'tz-appcss' || (n.tagName === 'LINK' && /styles\.css(\?|$)/.test(n.href || ''))) walk(sh);
    });
    return done;
  };
  T.loadAppCSS = function (candidates) {
    return new Promise(function (resolve, reject) {
      var i = 0;
      function tryNext() {
        if (i >= candidates.length) return reject(new Error('styles.css not found'));
        var href = candidates[i++];
        fetch(href, { method: 'GET', cache: 'force-cache' }).then(function (r) {
          var ct = (r.headers.get('content-type') || '');
          if (!r.ok || (ct && ct.indexOf('css') < 0 && ct.indexOf('text/plain') < 0)) return tryNext();
          var link = document.createElement('link'); link.rel = 'stylesheet'; link.href = href;
          link.onload = function () { resolve(href); }; link.onerror = tryNext;
          var first = document.querySelector('link[href$="teaser.css"]');   /* before teaser.css, so its overrides win */
          document.head.insertBefore(link, first || null);
        }).catch(tryNext);
      }
      tryNext();
    });
  };

  /* ---------- phone shell: the app's own header + tab bar markup (index.html), nothing reinvented ---------- */
  var NAV_ICONS = {
    picks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="3"/><polyline points="7.5 12.5 10.5 15.5 16.5 8.5"/></svg>',
    dashboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><line x1="5" y1="19" x2="5" y2="13"/><line x1="12" y1="19" x2="12" y2="7"/><line x1="19" y1="19" x2="19" y2="10"/></svg>',
    home: '<svg viewBox="205 250 614 495" fill="currentColor" aria-hidden="true" focusable="false"><path d="M 212 393 L 499.25 262.78 Q 512 257 524.75 262.78 L 812 393 L 812 401 Q 812 417 796 417 L 228 417 Q 212 417 212 401 L 212 393 Z"/><rect x="296" y="445.57" width="78" height="154.29"/><rect x="473" y="445.57" width="78" height="154.29"/><rect x="650" y="445.57" width="78" height="154.29"/><rect x="260" y="599.86" width="504" height="51.43" rx="7.71"/><rect x="212" y="679.86" width="600" height="57.14" rx="22.86"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M4 5.5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-4 3.5v-3.5H6a2 2 0 0 1-2-2v-9Z"/></svg>',
    leaderboard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M5 5H3v2a4 4 0 0 0 4 4.5"/><path d="M19 5h2v2a4 4 0 0 0-4 4.5"/><line x1="12" y1="14" x2="12" y2="18"/><line x1="8" y1="20.5" x2="16" y2="20.5"/><line x1="8" y1="20.5" x2="9" y2="18"/><line x1="16" y1="20.5" x2="15" y2="18"/></svg>'
  };
  var MENU_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
  var SYNC_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4 4 0 0 1-.5-7.96A5 5 0 0 1 16.2 9.1 4.5 4.5 0 0 1 17 18Z"/></svg>';
  var STATUS_RIGHT = '<svg viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx=".6"/><rect x="5" y="5.5" width="3" height="6.5" rx=".6"/><rect x="10" y="3" width="3" height="9" rx=".6"/><rect x="15" y="0" width="3" height="12" rx=".6"/></svg>'
    + '<svg viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M1.5 4.2a9.5 9.5 0 0 1 13 0"/><path d="M4 7a6 6 0 0 1 8 0"/><path d="M6.5 9.6a2.5 2.5 0 0 1 3 0"/></svg>'
    + '<svg viewBox="0 0 27 12" fill="none" stroke="currentColor" stroke-width="1"><rect x=".5" y=".5" width="23" height="11" rx="3"/><rect x="2" y="2" width="20" height="8" rx="1.8" fill="currentColor" stroke="none"/><path d="M25.5 4v4" stroke-linecap="round"/></svg>';
  T.MARK_SVG = NAV_ICONS.home;

  T.esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  T.buildPhone = function (host) {
    var tabs = ['picks', 'dashboard', 'home', 'chat', 'leaderboard'];
    var navHTML = tabs.map(function (k) {
      var label = { picks: 'Picks', dashboard: 'Dashboard', home: 'Home', chat: 'Chat', leaderboard: 'Standings' }[k];
      return '<button class="nav-item" data-tab="' + k + '" aria-label="' + label + '">'
        + '<span class="nav-icon' + (k === 'home' ? ' nav-home-disc' : '') + '" aria-hidden="true">' + NAV_ICONS[k] + '</span><span class="sr-only">' + label + '</span></button>';
    }).join('');
    host.innerHTML =
      '<div class="tz-pose"><div class="tz-phone"><div class="tz-screen">'
      + '<div class="tz-island"></div>'
      + '<div class="tz-status"><span>9:41</span><span class="tz-sr">' + STATUS_RIGHT + '</span></div>'
      + '<div class="tz-scroll">'
      +   '<header class="app-header"><div class="app-header-inner">'
      +     '<button type="button" id="control-center-trigger" class="control-center-trigger" aria-label="Menu" data-filled="web"><span class="control-center-trigger-mark">' + MENU_ICON + '</span></button>'
      +     '<span class="header-spacer header-spacer--lead" aria-hidden="true"></span>'
      +     '<span id="league-pill" class="league-pill">Munera</span>'
      +     '<span class="header-spacer" aria-hidden="true"></span>'
      +     '<div class="header-meta" id="header-meta"><span id="header-meta-week"><span class="week-heading week-heading-inline"><span class="week-heading-name"><strong>' + T.esc(T.week.label) + '</strong><span class="badge badge-' + T.week.phase + ' ml-sm" id="tz-week-badge">' + T.esc(T.week.badge) + '</span></span></span></span></div>'
      +     '<span id="sync-badge" class="header-sync-icon" data-sync="ok" aria-label="Synced">' + SYNC_ICON + '</span>'
      +   '</div></header>'
      +   '<main class="main-content"><section class="page-section active" id="tz-page"></section></main>'
      + '</div>'
      + '<nav class="bottom-nav" aria-label="Tabs">' + navHTML + '</nav>'
      + '<div class="tz-home"></div>'
      + '<div class="tz-tap"></div>'
      + '</div></div></div>';
    var phone = {
      pose: host.querySelector('.tz-pose'),
      el: host.querySelector('.tz-phone'),
      screen: host.querySelector('.tz-screen'),
      scroll: host.querySelector('.tz-scroll'),
      header: host.querySelector('.app-header'),
      page: host.querySelector('.page-section'),
      nav: host.querySelector('.bottom-nav'),
      badge: host.querySelector('#tz-week-badge'),
      tap: host.querySelector('.tz-tap'),
      tab: null, pageKey: null
    };
    return phone;
  };

  /* fit the 414x868 frame into the stage */
  T.fitPhone = function (stage, phone, scaleOf) {
    var r = stage.getBoundingClientRect();
    var k = Math.min(r.width*(scaleOf || .86)/414, r.height*.78/868);
    /* a little above centre, so the caption band below the phone stays clear */
    phone.el.style.transform = 'translateY(' + (-r.height*0.055).toFixed(1) + 'px) scale(' + k.toFixed(4) + ')';
    phone.k = k;
    return k;
  };

  /* phone pose, in stage units: o = opacity, y = fraction of stage height, s = scale */
  T.pose = function (phone, p) {
    var o = p.o == null ? 1 : p.o, y = p.y || 0, s = p.s == null ? 1 : p.s;
    phone.pose.style.opacity = o.toFixed(3);
    phone.pose.style.visibility = o <= 0.001 ? 'hidden' : 'visible';
    phone.pose.style.transform = 'translateY(' + (y*100).toFixed(2) + 'cqh) scale(' + s.toFixed(4) + ')';
  };

  /* tab bar + week badge + page id, the way the app sets them (body[data-tab], .nav-item.active) */
  T.setTab = function (phone, tab, badge) {
    if (phone.tab !== tab) {
      phone.tab = tab;
      document.body.dataset.tab = tab;
      phone.nav.querySelectorAll('.nav-item').forEach(function (b) {
        var on = b.dataset.tab === tab; b.classList.toggle('active', on);
        if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
      });
      phone.page.id = tab === 'chat' ? 'page-chat' : 'tz-page';
      phone.page.style.height = '';
    }
    var b = badge || { phase: T.week.phase, label: T.week.badge };
    phone.badge.className = 'badge badge-' + b.phase + ' ml-sm'; phone.badge.textContent = b.label;
  };
  /* mount a page: innerHTML + tab + a short entrance (the app's own nav timing) */
  T.setPage = function (phone, key, tab, html, opts) {
    opts = opts || {};
    T.setTab(phone, tab, opts.badge);
    phone.page.innerHTML = html;
    phone.pageKey = key;
    phone.scroll.scrollTop = 0;
    if (tab === 'chat') {            /* the app sizes the chat page to the viewport above the tab bar; here the frame is the viewport */
      var nav = phone.nav.getBoundingClientRect(), sc = phone.scroll.getBoundingClientRect();
      phone.page.style.height = Math.round((nav.top - sc.top)/phone.k - phone.header.offsetHeight) + 'px';
    }
    if (!opts.still) { phone.page.classList.remove('tz-page-in'); void phone.page.offsetWidth; phone.page.classList.add('tz-page-in'); }
  };

  /* a scripted tap: the app's press feedback on the element, a ring at its centre (phone-local coordinates) */
  T.tapOn = function (phone, el) {
    if (!el) return;
    var k = phone.k || 1;
    var a = el.getBoundingClientRect(), b = phone.screen.getBoundingClientRect();
    var x = (a.left + a.width/2 - b.left)/k, y = (a.top + a.height/2 - b.top)/k;
    phone.tap.style.left = x + 'px'; phone.tap.style.top = y + 'px';
    phone.tap.classList.remove('go'); void phone.tap.offsetWidth; phone.tap.classList.add('go');
    el.classList.add('is-pressed');
    setTimeout(function () { el.classList.remove('is-pressed'); }, 150);
  };
  /* swap text with the app-speed crossfade */
  T.tickText = function (el, text) {
    if (!el || el.textContent === text) return;
    el.textContent = text; el.classList.remove('tz-tick'); void el.offsetWidth; el.classList.add('tz-tick');
  };

  /* ---------- the player: clock, captions, hud, gate, audio ---------- */
  T.run = function (o) {
    var scene = o.scene, stage = o.stage, opt = o.opts || {};
    var phone = T.buildPhone(o.phoneHost);
    T.fitPhone(stage, phone, scene.phoneScale);
    window.addEventListener('resize', function () { T.fitPhone(stage, phone, scene.phoneScale); });
    var atmosOK = T.atmos && o.canvas && T.atmos.init(o.canvas, { dpr: opt.dpr || 0, lock: opt.q || 0 });
    if (scene.mountStage) scene.mountStage(stage, phone);
    stage.classList.toggle('tz-clean', !opt.review);
    stage.classList.toggle('tz-still', !!opt.still);

    var caps = (scene.captions || []).map(function (c) {
      var d = document.createElement('div');
      d.className = 'tz-cap tz-cap--' + (c.pos || 'low') + (c.size ? ' tz-cap--' + c.size : '');
      d.textContent = c.text; o.capHost.appendChild(d);
      return { el: d, c: c, track: c.size === 'lg' ? 0.16 : c.pos === 'cin' ? 0.24 : 0.2 };
    });
    /* The tracking opens over a caption's hold. A line that just fits at first would wrap to two lines part-way through
       ("Challenge your friends." did). So each caption's lines are settled once, at its widest tracking: a caption that fits one
       line at the start stays on one line, a touch smaller if it must. */
    function fitCaps() {
      caps.forEach(function (x) {
        var el = x.el; el.style.whiteSpace = ''; el.style.fontSize = '';
        el.style.letterSpacing = x.track + 'em'; var h0 = el.offsetHeight;
        el.style.letterSpacing = (x.track + 0.035) + 'em'; var h1 = el.offsetHeight;
        if (h1 <= h0 + 2) return;
        el.style.whiteSpace = 'nowrap';
        var over = el.scrollWidth/Math.max(el.clientWidth, 1);
        if (over > 1) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize)/over*0.985).toFixed(2) + 'px';
      });
    }
    fitCaps(); window.addEventListener('resize', fitCaps);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitCaps);

    var started = false, paused = false, ended = false, startMs = 0, holdMs = 0, lastT = -1;
    var useAudio = !!(scene.cues && T.audio) && !opt.mute;
    /* review bar: how the renderer is doing on this device (frames per second, scene resolution as a share of full) */
    function perf() { if (!atmosOK || !opt.review) return ''; var i = T.atmos.info(); return ' · ' + Math.round(1000/Math.max(i.ms, 1)) + ' FPS · ' + Math.round(i.scale*100) + '%' + (i.hdr ? '' : ' · 8-BIT'); }
    function now() { if (!started) return 0; return ((paused || ended ? holdMs : performance.now()) - startMs)/1000; }
    function reset() { scene.reset(phone); lastT = -1; }
    function draw(t) {
      if (t < lastT) reset();
      scene.tick(t, phone); lastT = t;
      if (atmosOK) T.atmos.render(scene.atmos ? scene.atmos(t) : { stad: .3, flash: .15 }, performance.now()/1000);
      caps.forEach(function (x) {       /* trailer lettering: fade up, hold, fade; the tracking opens a little over the hold */
        var c = x.c, a = T.span(t, c.from, c.from + (c['in'] || 0.5), T.ease.inOut) - T.span(t, c.to - (c.out || 0.35), c.to);
        x.el.style.opacity = a.toFixed(3); x.el.style.visibility = a > 0.001 ? 'visible' : 'hidden';
        if (a > 0.001) x.el.style.letterSpacing = (x.track + 0.035*T.span(t, c.from, c.to)).toFixed(4) + 'em';
      });
      if (o.scrim) o.scrim.classList.toggle('on', caps.some(function (x) { return x.c.scrim && t >= x.c.from && t < x.c.to; }));
      o.bar.firstElementChild.style.width = (t/scene.duration*100).toFixed(2) + '%';
      o.hud.textContent = scene.label.toUpperCase() + ' · ' + t.toFixed(1) + ' / ' + scene.duration.toFixed(1) + ' S' + (paused ? ' · PAUSED' : ended ? ' · TAP TO REPLAY' : '') + perf();
    }
    function step() {
      var t = now();
      if (started && !ended && t >= scene.duration) {
        if (scene.loop === false) { ended = true; holdMs = startMs + (scene.duration - 0.001)*1000; t = now(); }
        else { startMs += scene.duration*1000; t = now(); reset(); if (useAudio) T.audio.play(scene.cues(), t); }
      }
      draw(t);
    }
    function frame() { if (!paused || !started) step(); requestAnimationFrame(frame); }
    var plateEl = null, starting = false;
    function begin() {
      started = true; paused = false; ended = false; startMs = performance.now(); starting = false;
      if (o.gate) o.gate.classList.add('off');
      if (useAudio) T.audio.play(scene.cues(), 0);
    }
    function start() {
      if (starting) return; starting = true;
      if (plateEl) { var pr = plateEl.play(); if (pr && pr.catch) pr.catch(function () {}); }
      /* The tap unlocks the audio; the film then waits for the recordings to finish downloading AND decoding, so picture and
         sound start together. (Review B1, 2026-11-15: a tap made before the downloads finished used to start a silent film that
         no replay could fix, because nothing decoded the files that arrived later.) */
      if (useAudio && T.audio.init()) {
        T.audio.resume();
        var tap = o.gate && o.gate.querySelector('.tz-g-tap'); if (tap && o.gate.classList.contains('loading')) tap.textContent = 'LOADING';
        loading.then(function () { return T.audio.ready(); }).then(begin, begin);
      }
      else begin();
    }
    /* the scene's recordings and stadium plate: fetched now, so the tap only has to decode */
    var media = scene.media || {}, loading = Promise.resolve();
    if (useAudio && media.audio) loading = T.audio.preload(media.audio);
    if (media.plate && atmosOK) {
      plateEl = document.createElement('video');
      plateEl.muted = true; plateEl.loop = true; plateEl.playsInline = true; plateEl.setAttribute('playsinline', ''); plateEl.setAttribute('muted', ''); plateEl.preload = 'auto';
      plateEl.crossOrigin = 'anonymous'; plateEl.src = media.plate;
      plateEl.addEventListener('error', function () { console.error('[teaser] the stadium plate did not load; the drawn stadium is used instead'); });
      T.atmos.setPlate(plateEl);
    }
    function seek(t) {
      ended = false; reset();
      startMs = (paused ? holdMs : performance.now()) - t*1000;
      if (useAudio && started) { T.audio.play(scene.cues(), t); if (paused) T.audio.suspend(); }
      if (paused) draw(now());
    }
    reset();
    requestAnimationFrame(frame);
    if (useAudio) { if (o.gate) { o.gate.classList.remove('off'); o.gate.classList.add('loading'); loading.then(function () { o.gate.classList.remove('loading'); }); } }
    else start();

    stage.addEventListener('click', function (e) {
      if (e.target.closest('#tz-hud button, #tz-bar')) return;
      if (!started) return start();
      if (ended) { paused = false; seek(0); return; }
      if (!paused) { paused = true; holdMs = performance.now(); if (useAudio) T.audio.suspend(); draw(now()); }
      else { startMs += performance.now() - holdMs; paused = false; if (useAudio) T.audio.resume(); }
    });
    o.bar.addEventListener('click', function (e) {
      if (!started) return;
      var r = o.bar.getBoundingClientRect(); seek(T.clamp((e.clientX - r.left)/r.width, 0, .999)*scene.duration);
    });
    if (o.muteBtn) {
      o.muteBtn.hidden = !useAudio;
      o.muteBtn.addEventListener('click', function (e) {
        e.stopPropagation(); var m = !T.audio.muted(); T.audio.setMuted(m); o.muteBtn.textContent = m ? 'SOUND OFF' : 'SOUND ON';
      });
    }
    /* draw exactly film time t and hold there (checks, frame export) */
    function still(t) { if (plateEl && plateEl.paused) { var pp = plateEl.play(); if (pp && pp.catch) pp.catch(function () {}); } started = true; ended = false; paused = true; if (o.gate) o.gate.classList.add('off'); startMs = 0; holdMs = t*1000; reset(); draw(t); }
    return { seek: seek, phone: phone, start: start, still: still };
  };
})(window.TEASER);
