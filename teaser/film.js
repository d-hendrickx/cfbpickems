/* teaser/film.js — PROMO-ONLY. "Enter the Arena": the full cut. One master timeline that plays the product scenes
   as segments (scene, local start, rate), drives the background, the phone's pose, the captions, the SCRIBE title
   card, the brand reveal and the cue sheet for the synthesized score. Everything is a function of film time.
   Second cut (2026-11-14, the owner's notes): slower throughout (about a minute), a fog-lit colonnade in place of the
   sparkle, and a trailer score in place of the notes. */
(function (T) {
  'use strict';
  var E = T.ease, sp = T.span, pulse = T.pulse, cue = T.cue;
  /* Third cut (2026-11-15): cut to the music. The track ("Intense Dark Trailer", ArctSound) hits every 7 s from 1.37 s,
     with accents every 1.75 s; every cut below sits on that grid. G is one accent, BAR is a product beat. */
  var G = 1.75, BAR = 3.5, CUT = 0.875, H1 = 1.37;
  /* The page plays ONE finished soundtrack, media/soundtrack.m4a (compliance finding T-5, 2026-11-15: the four licensed recordings are
     not served as separate files). That file is this cue sheet rendered offline by the same engine. The recordings live in media-src/,
     which the deploy never copies. To rebuild the soundtrack after changing a cue: serve cfb-pickems/ locally, open
     teaser/?scene=dubstep&raw=1&mute=1&still=1, run TEASER.audio.preload(scene.media.audio) then TEASER.audio.render(scene.cues(), scene.duration),
     save the buffer as 16-bit WAV and encode it: afconvert -f m4af -d aac -b 192000 -q 127 soundtrack.wav soundtrack.m4a
     raw=1 (query or #raw) plays the cue sheet live from media-src/ instead, and brings back the earlier score as ?scene=film. */
  var RAW = /[?&]raw=1\b/.test(location.search) || (location.hash || '').replace('#', '').split('.').indexOf('raw') >= 0;
  var MEDIA = { audio: { music: 'media-src/music.mp3', roar: 'media-src/crowd-roar.mp3', erupt: 'media-src/crowd-erupt.mp3' } };
  /* two versions of the same film: the approved score (id film), and the dubstep alternate (#dubstep or ?scene=dubstep).
     The dubstep cut has its own timeline (fourth pass, the owner: "There should be a pause and a transition between the dramatic music
     and the dubstep. Like dark screen, silence 'but' pause 'the arena changed' music starts 'we didn't'. There similarly needs to be
     a clean pause and break and lead up to the scribe reveal"): O = four bars of black before the stadium reveal, P = two more
     bars of pause before SCRIBE. The approved cut's timeline is unchanged. */
  function make(v) {
  var DUB = v.id === 'dubstep', O = DUB ? 4*G : 0, Q = O + (DUB ? 2*G : 0);
  var TL = { c2:4.87, c3:6.62, white:7.75, blk:8.37, stad:8.37 + O, didnt:DUB ? 8.37 + O : 11.87, phoneIn:13.6 + O, A:15.37 + O, B:18.87 + O, C:22.37 + O, D:25.87 + O, E:29.37 + O,
             S0:32.87 + O, S1:34.62 + Q, V:43.0 + Q, HIT:50.37 + Q, M:52.12 + Q, ONE:59.12 + Q, K:62.62 + Q, L:63.82 + Q, END:70.0 + Q };
  var BEATS = [TL.A, TL.B, TL.C, TL.D, TL.E];
  var HEART = [H1, TL.c2, TL.c3];                    /* the light answers the hits */

  /* ---------- segments: which scene the phone shows, from which local time, at what speed ---------- */
  var KS = T.scenes.scribe.K;
  var SEG = [
    { from:0,    scene:'picks',     at:0.3, rate:0 },
    { from:TL.A, scene:'picks',     at:0.3, rate:0.7 },
    { from:TL.B, scene:'friends',   at:0,   rate:0.6 },
    { from:TL.C, scene:'gameday',   at:0,   rate:0.62 },
    { from:TL.D, scene:'standings', at:0,   rate:0.58 },
    { from:TL.E, scene:'chat',      at:0,   rate:0.6 },
    { from:TL.V, scene:'scribe',    at:0,   rate:1 }
  ];
  /* Eight cuts, one every half bar, two per bar of the riff. Each line arrives on a bar's downbeat with its own screens
     (the owner, 2026-11-15: the lines "need to be in sync with the beats of the music/app rendering"):
     bar 1 "Your friends." chat, league activity | bar 2 "Your picks." picks, the last pick | bars 3-4 "Your game day." game day,
     SCRIBE, game day, chat. Standings is kept out of the montage: a centred line there sat on top of the names. */
  [[0,'chat',0.9,0.8], [1,'friends',0.05,1.0], [2,'picks',1.55,0.85], [3,'lock',0,0.85], [4,'gameday',0.3,0.85], [5,'scribe',KS.s1 - 0.2,1.2], [6,'gameday',1.15,0.85], [7,'chat',1.7,0.8]]
    .forEach(function (c) { SEG.push({ from: TL.M + c[0]*CUT, scene: c[1], at: c[2], rate: c[3] }); });
  SEG.push({ from: TL.ONE, scene:'standings', at:1.5, rate:0.25 });
  function segAt(t) { var s = SEG[0]; for (var i = 0; i < SEG.length; i++) if (SEG[i].from <= t) s = SEG[i]; return s; }

  /* ---------- the phone's pose ---------- */
  function pose(t) {
    if (t < TL.phoneIn || t >= TL.K) return { o:0, y:.42, s:.92 };
    var p = sp(t, TL.phoneIn, TL.phoneIn + 0.9, E.entrance);
    var o = p, y = (1 - p)*0.42, s = 0.92 + 0.08*p;
    var s0 = DUB ? TL.S0 : TL.S1;                    /* dubstep cut: the room recedes at the break, before the two lines that lead to SCRIBE */
    var d = sp(t, s0 - 0.1, s0 + 0.5, E.inOut) - sp(t, TL.V - 0.5, TL.V + 0.1, E.inOut);   /* SCRIBE title card: the room recedes */
    o *= 1 - (DUB ? 0.95 : 0.88)*d; s *= 1 - 0.05*d;
    if (t >= TL.M && t < TL.ONE) s *= 1 + 0.02*pulse(t, TL.M + Math.floor((t - TL.M)/CUT)*CUT, 0.45);
    var a = sp(t, TL.ONE, TL.ONE + 0.5, E.inOut); o *= 1 - 0.5*a; s *= 1 - 0.07*a;
    y += 0.16*a;                                     /* under "One arena." the phone drops so the standings names sit below the line, not behind it */
    o *= 1 - 0.42*(sp(t, TL.M, TL.M + 0.25) - a);   /* the montage sits back a little so the central lines read; it hands over to the "One arena." dim */
    return { o:o, y:y, s:s };
  }

  /* ---------- the background: three shots in the colonnade, then the stadium ---------- */
  function atmos(t) {
    var p = { dim: t >= TL.K ? 0 : sp(t, 0.2, H1 + 0.9, E.inOut) }, u, beat = 0, e3 = DUB ? TL.blk : TL.stad;
    if (DUB && t < TL.stad - 0.03) p.dim *= 1 - sp(t, TL.blk - 0.02, TL.blk + 0.1);   /* the last dark hit cuts to black; black until the drop */
    HEART.forEach(function (h) { beat = Math.max(beat, pulse(t, h, 0.9)); });
    if (t < TL.stad + 0.6) {
      p.pil = DUB ? (t < TL.blk + 0.15 ? 1 : 0) : 1 - sp(t, TL.stad, TL.stad + 0.5);
      if (t < TL.c2) {                               /* wide, low, a slow push; the light arrives on the first hit and swings round */
        u = sp(t, 0, TL.c2, E.inOut);
        p.cam = [-1.3 + 0.45*u, 1.0, -11.5 + 2.4*u]; p.look = [0.035 - 0.035*u, 0.13];
        p.lx = 0.62 - 0.36*sp(t, 0.3, TL.c2, E.inOut); p.gain = 0.04 + 0.96*sp(t, H1 - 0.1, H1 + 2.4, E.outCubic) + 0.25*beat;
      } else if (t < TL.c3) {                        /* on the axis of one column: light either side of it */
        u = sp(t, TL.c2, TL.c3);
        p.cam = [0.2*u - 0.1, 1.3, -6.4 + 0.8*u]; p.look = [0, 0.17];
        p.lx = 0.10 - 0.2*u; p.gain = 1.1 + 0.5*beat;
      } else {                                       /* low on the stone, looking up, the light turning to blood; then through */
        u = sp(t, TL.c3, e3, E.inCubic)*(DUB ? 0.5 : 1);
        p.cam = [-1.3, 0.42, -5.2 + 5.6*u]; p.look = [0, 0.36 - 0.22*sp(t, TL.c3 + 0.8, e3, E.inOut)];
        p.lx = 0.2; p.red = sp(t, TL.c3, TL.c3 + 0.3) - (DUB ? sp(t, TL.blk + 0.1, TL.blk + 0.15) : sp(t, TL.white, TL.stad - 0.1)); p.gain = 1.15 + 0.6*beat;
      }
    }
    p.white = (DUB ? sp(t, TL.stad - 0.05, TL.stad - 0.01) : sp(t, TL.white, TL.stad - 0.03, E.inCubic)) - sp(t, TL.stad + 0.05, TL.stad + (DUB ? 0.6 : 1.0), E.outCubic);   /* dubstep cut: the lamps strike out of black, on the drop; a shorter flash so "We didn't." reads at once */
    var st = 0;
    if (t >= TL.stad - 0.05 && t < TL.K) {
      st = 1 - 0.55*sp(t, TL.phoneIn, TL.phoneIn + 1.0, E.inOut);
      if (DUB) st -= 0.36*sp(t, TL.S0, TL.S0 + 0.6, E.inOut) - 0.09*sp(t, TL.S1, TL.S1 + 0.25) - 0.2*pulse(t, TL.S1, 1.2);   /* dark for the two lines; the lamps answer the hit under the title */
      else st -= 0.27*sp(t, TL.S0, TL.S1, E.inOut);
      st += 0.27*sp(t, TL.HIT, TL.HIT + 0.3) + 0.45*sp(t, TL.M, TL.ONE, E.inCubic) + 0.2*sp(t, TL.ONE, TL.ONE + 0.4);
      st += 0.25*pulse(t, TL.didnt, 0.9);
      if (DUB) st += 0.15*pulse(t, TL.stad + G, 0.9);   /* the lamps answer the Munera mark */
      st += 0.22*pulse(t, TL.ONE + G, 1.1);            /* the lamps answer the music's loudest bar */
      BEATS.forEach(function (b) { st += 0.1*pulse(t, b, 0.9); });
      if (t >= TL.M) st += 0.12*pulse(t, TL.M + Math.floor((t - TL.M)/CUT)*CUT, 0.5);
    }
    p.stad = st;
    return p;
  }

  /* ---------- captions (copy exactly as the brief gives it) ---------- */
  var CAPS = [
    { text:'For centuries, we’ve gathered for the games.', from:H1, to:4.65, pos:'cin' },
    { text:'Sides were chosen.',   from:TL.c2 + 0.1, to:6.45, pos:'cin' },
    { text:'Rivalries were born.', from:TL.c3 + 0.1, to:8.05, pos:'cin', out:0.2 }
  ].concat(DUB ? [
    /* sixth pass (the owner): "Since then" and "The arena changed." over the fading dark track; "But" in silence; the drop on "We didn't." */
    { text:'Since then',         from:TL.blk + 0.9, to:TL.blk + 2.35, pos:'mid', size:'lg' },
    { text:'The arena changed.', from:TL.blk + 2.75, to:TL.blk + 4.7, pos:'mid', size:'lg' },
    { text:'But',                from:TL.stad - 1.95, to:TL.stad - 0.02, pos:'mid', size:'lg', 'in':0.3, out:0.06 },
    { text:'We haven’t.',         from:TL.stad + 0.02, to:TL.stad + 1.65, pos:'mid', size:'lg', 'in':0.12, out:0.3 }   /* on the drop, straight from "The arena changed." */
  ] : [
    { text:'The arena changed.',   from:TL.stad + 0.35, to:11.0, pos:'mid', size:'lg' },
    { text:'We haven’t.',      from:TL.didnt, to:13.4, pos:'mid', size:'lg' }
  ], [
    { text:'Make your picks.',        from:TL.A + 0.3, to:TL.B - 0.15 },
    { text:'Challenge your friends.', from:TL.B + 0.2, to:TL.C - 0.15 },
    { text:'Watch it unfold.',        from:TL.C + 0.2, to:TL.D - 0.15 },
    { text:'Climb the ranks.',        from:TL.D + 0.2, to:TL.E - 0.15 },
    { text:'Talk your shit.',         from:TL.E + 0.2, to:TL.S0 - 0.1 }
  ], DUB ? [
    { text:'Through the years, every arena had its Scribe.', from:TL.S0 + 0.6, to:TL.S0 + 3.3, pos:'mid' },
    { text:'Now this one does too.',  from:TL.S1 - G + 0.05, to:TL.S1 - 0.04, pos:'mid', size:'lg', out:0.08 }
  ] : [
    { text:'Every arena has its Scribe.', from:TL.S0 + 0.2, to:TL.S1 - 0.1 }
  ], [
    /* the owner, 2026-11-15: these three "should be in the same format, central and bold" as "One arena." */
    { text:'Your friends.',  from:TL.M,       to:TL.M + G - 0.03,   pos:'mid', size:'lg', 'in':0.07, out:0.07 },   /* each on its bar's downbeat */
    { text:'Your picks.',    from:TL.M + G,   to:TL.M + 2*G - 0.03, pos:'mid', size:'lg', 'in':0.07, out:0.07 },
    { text:'Your game day.', from:TL.M + 2*G, to:TL.ONE - 0.03,     pos:'mid', size:'lg', 'in':0.07, out:0.07 },
    { text:'One arena.',     from:TL.ONE,     to:TL.K - 0.03,       pos:'mid', size:'lg', 'in':0.1, out:0.03 }
  ]);
  var LINES = [
    { text:'AI, built into your group chat.',   from:TL.S1 + 0.88, to:TL.S1 + 2.83 },
    { text:'It knows ball.',                    from:TL.S1 + 3.03, to:TL.S1 + 4.73 },
    { text:'Unfortunately, it also knows you.', from:TL.S1 + 5.03, to:TL.S1 + 7.58 }
  ];

  /* ---------- the score: a cue sheet, built once ---------- */
  var CUES = {};
  function valAt(pts, x) {
    if (x <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) if (x <= pts[i][0]) { var a = pts[i-1], b = pts[i]; return a[1] + (b[1] - a[1])*((x - a[0])/Math.max(b[0] - a[0], 1e-4)); }
    return pts[pts.length - 1][1];
  }
  /* the part of a film-time envelope between a and b, with optional fades at the ends (for one spliced piece of the music) */
  function slice(pts, a, b, fi, fo) {
    var out = fi ? [[a, 0], [a + fi, valAt(pts, a + fi)]] : [[a, valAt(pts, a)]];
    pts.forEach(function (q) { if (q[0] > a + (fi || 0) && q[0] < b - (fo || 0)) out.push(q); });
    if (fo) { out.push([b - fo, valAt(pts, b - fo)]); out.push([b, 0]); } else out.push([b, valAt(pts, b)]);
    return out;
  }
  function buildCues(kind) {
    var c = [], hit = cue.hit, sample = cue.sample, t, DUB = kind === 'dubstep';   /* the dubstep has its own kick and sub: less synthetic weight under it */
    var drum = function (at, peak, f, tail) { return hit(at, function (a, w) { a.drum(w, peak, f, tail); }); };
    var sub = function (at, f0, f1, peak, tail) { return hit(at, function (a, w) { a.sub(w, f0, f1, peak, tail); }); };
    var tick = function (at, peak, f, dur) { return hit(at, function (a, w) { a.tick(w, peak, f, dur); }); };
    var swell = function (t1, len, peak) { return cue.bed('white', [{ type:'lowpass', f:900 }], [[t1 - len, 0], [t1 - 0.02, peak], [t1, 0]], [[t1 - len, 300], [t1, 2400]], 0.4); };

    /* -- the music leads (fourth cut, the owner: "the music needs to tell a story"). One recording, re-edited at its own hits so its
          arc is the film's arc. Source map: 0-15 sparse dark hits | 15-29 the build (hits at 15.37 and 22.37, a riser from 27.6) |
          29-57 the drive | 57.37 hit, break, 59.12-69.6 the climax | 69.6-73 its loudest bars | 76.62 the final hit.
          Film: dark hits in the colonnade; the reveal lands on a hit and the riser lifts the phone; the drive carries the product;
          it thins to the sparse build under SCRIBE (present, never ducked away); hit, break, climax for the montage;
          the loudest bars under "One arena"; the final hit on the logo. -- */
    var X = 0.03, BD = 38.12;
    if (kind !== 'dubstep') {
      var mGain = [[0, 0.7], [TL.stad - 0.5, 0.75], [TL.stad, 0.9], [TL.A - 0.2, 0.9], [TL.A, 0.85], [TL.S0, 0.85], [TL.S0 + 1.6, 0.4], [BD, 0.4], [BD + 0.05, 0.5], [TL.V, 0.5], [47, 0.7],
                   [TL.HIT - 0.05, 0.85], [TL.HIT, 1], [TL.ONE - 0.05, 1], [TL.ONE, 1.12], [TL.K + 0.1, 1.12], [TL.K + 1.0, 0]];   /* quietest under SCRIBE, loudest under "One arena" */
      var mLP = [[0, 18000], [TL.S0, 18000], [TL.S0 + 1.6, 2500], [BD, 2500], [BD + 0.08, 5200], [TL.V, 5200], [TL.V + 3, 18000], [TL.END, 18000]];
      [[0, TL.stad, 0],                 /* the colonnade: sparse hits at 1.37 and 8.37 */
       [TL.stad, BD, 22.37],            /* the reveal on the 22.37 hit, the riser under the phone, the drive from A; thinning as SCRIBE is named */
       [BD, TL.HIT, 15.37],             /* under SCRIBE: the sparse build, hits at 38.12 and 45.12, opening up as SCRIBE answers */
       [TL.HIT, TL.ONE, 57.37],         /* the hit, the break, and the climax starting on the first montage cut */
       [TL.ONE, TL.K + 1.0, 69.62]      /* the track's loudest bars under "One arena", ringing out over black */
      ].forEach(function (m, i, all) {
        var a = m[0] - (i ? X : 0), b = m[1], last = i === all.length - 1;
        c.push(sample('music', a, { offset: m[2] - (i ? X : 0), dur: b - a, env: slice(mGain, a, b, i ? X : 0.01, last ? 0 : X), lp: slice(mLP, a, b), rev: 0.05 }));
      });
      c.push(sample('music', TL.L - 0.3, { offset: 76.62 - 0.3, dur: TL.END - TL.L + 0.3, env: [[TL.L - 0.3, 0], [TL.L - 0.26, 1], [TL.END - 1.6, 1], [TL.END, 0]], rev: 0.05 }));
    } else {
      /* -- dubstep alternate, second pass (the owner: the drop and the transition were fumbled). Cut on the track's own phrases, found by
            analysis: "Aggressive Dubstep Sport Trailer" (kornevmusic), exactly 140 BPM, bars of 1.71432 s from 0.036 s, played 2% slow
            so a bar is the film's 1.75 s. Bar 0 is the track's riser; 1-8 its opening groove; 9-24 the main groove; 25-40 and 65-80
            the big section (a four-bar riff); 41-48 the breakdown (a two-bar figure); 89 the final hit. Bars 24, 40, 48, 64, 72 and 80
            end on the track's own fill (a sub hit with everything else pulled out), which is how it leads into each new section.
            Film: the dark track alone in the colonnade, gone before the white; the dubstep's own riser through the red shot and the
            white, and its first bar exactly on the stadium reveal, as composed, no splice; the main groove from the first product beat;
            the fill, then a one-bar build on "Every arena has its Scribe" into the track's final hit on the SCRIBE title; the breakdown
            under SCRIBE, rising and opening up; its fill; the big riff from its first bar on the first montage cut; the riff's last
            two bars and fill under "One arena"; black; the dark track's final hit on the logo. Every splice is on a bar line that the track itself crosses the same way. -- */
      var RT = 1.71432/1.75, bar = function (n) { return 0.036 + n*1.71432; };
      /* act one ends on the dark track's own big hit at 8.37, which is the cut to black; the track then fades away over the black,
         darkening as it goes, all the way through "Since then" and "The arena changed."; then silence under "But" until the riser
         (fifth and sixth passes, the owner: "The fade out should continue all the way to 'the arena changed.'") */
      c.push(sample('music', 0, { offset: 0, dur: TL.blk + 4.7, env: [[0, 0], [0.01, 0.7], [TL.c3 + 0.3, 0.72], [TL.blk - 0.05, 0.8], [TL.blk + 0.3, 0.8], [TL.blk + 1.6, 0.55], [TL.blk + 3.2, 0.3], [TL.blk + 4.7, 0]],
        lp: [[0, 18000], [TL.blk + 0.3, 18000], [TL.blk + 4.7, 900]], rev: 0.2 }));
      var dGain = [[TL.stad - G, 0.95], [TL.stad - 0.02, 0.95], [TL.stad, 0.62], [TL.A, 0.62], [TL.A + 0.01, 0.64], [TL.S0, 0.64],
                   [TL.S1, 0], [TL.S1 + G, 0.3], [TL.V, 0.32], [TL.HIT - G, 0.42], [TL.HIT, 0.52], [TL.M - 0.02, 0.58], [TL.M, 0.72], [TL.ONE - 0.02, 0.72], [TL.ONE, 0.76], [TL.K, 0.76]];
      var dLP = [[TL.stad - G, 18000], [TL.S0, 18000], [TL.S1, 3200], [TL.V, 5200], [TL.HIT - G, 9000], [TL.HIT, 18000], [TL.END, 18000]];
      /* [film start, film end, first source bar, fade in, fade out, reverb] */
      [[TL.stad - G, TL.A, 0, 0.01, X, 0.05],         /* the riser out of silence under "The arena changed.", then bars 1-4 from the reveal */
       [TL.A, TL.S0 - G, 9, X, X, 0.05],              /* bars 9-17: the main groove under the product */
       [TL.S0 - G, TL.S0, 24, X, 0.05, 0.3],          /* bar 24: the fill; the groove lets go */
       [TL.S1, TL.S1 + 6*G, 41, X, X, 0.12],          /* bars 41-46 of the breakdown, rising out of the hit's tail over one bar */
       [TL.S1 + 6*G, TL.M, 45, X, X, 0.08],           /* bars 45-48: the figure again, and the fill into the drop */
       [TL.M, TL.ONE, 73, X, X, 0.05],                /* the big riff from its first bar */
       [TL.ONE, TL.K, 79, X, 0.04, 0.3]               /* its last two bars and the fill; black */
      ].forEach(function (m) {
        var pre = m[2] === 0 ? 0 : X, a = m[0] - pre, b = m[1];
        c.push(sample('dub', a, { offset: bar(m[2]) - pre*RT, rate: RT, dur: b - a, env: slice(dGain, a, b, m[3], m[4]), lp: slice(dLP, a, b), rev: m[5] }));
      });
      /* the SCRIBE reveal is a build and an arrival (third pass, the owner: "it just kind of goes quiet and scribe randomly pops up"):
         over the caption the track's own riser (bar 0, one bar long) climbs, with the tail of its final hit played backwards as a
         swell and a little air; the title lands on that final hit (bar 89), which rings while the breakdown rises under it.
         The hit starts 12 ms before the bar line (its click sits about 10 ms ahead of the kick) so nothing of bar 88 is heard. */
      var HT = G - 0.012;   /* fourth pass: the break before it is silent for two bars ("Through the years, every arena had its Scribe."); the build is the bar under "Now this one does too." */
      c.push(sample('dub', TL.S1 - G, { offset: bar(89) + 1.0, rate: RT, dur: HT, reverse: true, env: [[TL.S1 - G, 0], [TL.S1 - G + 0.5, 1.2], [TL.S1 - G + 1.0, 3.5], [TL.S1 - 0.47, 5], [TL.S1 - 0.4, 1.1], [TL.S1 - 0.03, 1.1], [TL.S1 - 0.012, 0]], rev: 0.3 }));   /* the quiet reverb tail lifted 14 dB, the held note at its own level */
      c.push(sample('dub', TL.S1 - G, { offset: bar(0), rate: RT, dur: G - 0.012, env: [[TL.S1 - G, 0], [TL.S1 - G + 0.02, 0.8], [TL.S1 - 0.03, 0.8], [TL.S1 - 0.012, 0]], rev: 0.15 }));
      c.push(swell(TL.S1, G, 0.09));   /* air */
      c.push(sample('dub', TL.S1 - 0.012, { offset: bar(89) - 0.012*RT, rate: RT, dur: 4.4, env: [[TL.S1 - 0.012, 0], [TL.S1 - 0.009, 0.8], [TL.S1 + 2.2, 0.8], [TL.S1 + 4.4, 0]], rev: 0.35 }));
      c.push(hit(TL.S1, function (a, w) { a.crash(w, 0.08, 2.4); }));
      /* the logo keeps the original ending (the owner: "I liked the original dramatic ending with the munera logo"): the dubstep stops on its
         fill at the black, and the dark track's final hit lands on the logo exactly as in the first version. The two tracks never sound together. */
      c.push(sample('music', TL.L - 0.3, { offset: 76.62 - 0.3, dur: TL.END - TL.L + 0.3, env: [[TL.L - 0.3, 0], [TL.L - 0.26, 1], [TL.END - 1.6, 1], [TL.END, 0]], rev: 0.05 }));
    }

    /* -- the crowd is punctuation, at least 9 dB under the music and absent under the product and SCRIBE:
          a far-off murmur in the colonnade (the real roar, slowed and muffled), a short eruption on the reveal,
          one on the first montage cut, a swell under "One arena", a trace after the logo -- */
    if (DUB) {   /* silence between the black and the drop: the murmur ends with the dark hit, the eruption starts with the drop */
      c.push(sample('roar', 0.4, { offset: 2.0, rate: 0.78, dur: TL.blk + 0.4 - 0.4, env: [[0.4, 0], [3.0, 0.03], [TL.c3, 0.06], [TL.blk - 0.05, 0.1], [TL.blk + 0.4, 0]], lp: [[0.4, 320], [TL.c3, 520], [TL.blk, 1100]], rev: 0.6 }));
      c.push(sample('erupt', TL.stad - 0.4, { offset: 2.7, dur: 3.6, env: [[TL.stad - 0.4, 0], [TL.stad - 0.1, 0.06], [TL.stad, 0.18], [TL.stad + 1.5, 0.11], [TL.stad + 3.2, 0]], rev: 0.25 }));
    } else {
    c.push(sample('roar', 0.4, { offset: 2.0, rate: 0.78, dur: TL.stad + 0.25 - 0.4, env: [[0.4, 0], [3.0, 0.03], [TL.c3, 0.06], [TL.white + 0.1, 0.14], [TL.stad + 0.25, 0]],
      lp: [[0.4, 320], [TL.c3, 520], [TL.white, 1300], [TL.stad + 0.1, 9000]], rev: 0.85 }));
    c.push(sample('erupt', TL.stad - 1.6, { offset: 1.5, dur: 4.8, env: [[TL.stad - 1.6, 0], [TL.stad - 0.9, 0.1], [TL.stad, 0.18], [TL.stad + 1.5, 0.11], [TL.stad + 3.2, 0]], rev: 0.25 }));
    }
    c.push(sample('roar', TL.stad - 0.4, { offset: 3.0, dur: TL.phoneIn + 0.8 - (TL.stad - 0.4), rev: 0.3,
      env: [[TL.stad - 0.4, 0], [TL.stad + 0.4, 0.09], [TL.didnt, 0.06], [TL.phoneIn + 0.8, 0]] }));
    c.push(sample('erupt', TL.M - 0.95, { offset: 2.45, dur: 3.6, env: [[TL.M - 0.95, 0], [TL.M - 0.5, 0.04], [TL.M, 0.11], [TL.M + 1.4, 0.07], [TL.M + 2.65, 0]], rev: 0.25 }));
    c.push(sample('roar', TL.ONE - 0.5, { offset: 9.0, dur: TL.K - TL.ONE + 0.5, rev: 0.3, env: [[TL.ONE - 0.5, 0], [TL.ONE + 0.5, 0.06], [TL.K - 0.04, 0.09], [TL.K, 0]] }));
    c.push(sample('erupt', TL.ONE - 0.95, { offset: 2.45, dur: TL.K - (TL.ONE - 0.95), env: [[TL.ONE - 0.95, 0], [TL.ONE - 0.4, 0.06], [TL.ONE, 0.11], [TL.K - 0.04, 0.11], [TL.K, 0]], rev: 0.25 }));
    c.push(sample('roar', TL.L + 0.3, { offset: 6.0, dur: TL.END - TL.L - 0.3, env: [[TL.L + 0.3, 0], [TL.L + 1.5, 0.07], [TL.END - 1.8, 0.04], [TL.END, 0]],
      lp: [[TL.L, 5200], [TL.END, 2400]], rev: 0.5 }));

    /* ── weight under the cuts: sub booms and a low drum where the music leaves room. No pulse, no braams, no noise crowd. ── */
    c.push(sub(H1, 52, 30, 0.4, 2.0));
    [[TL.c2, 0.5], [TL.c3, 0.62], DUB ? [TL.blk, 0.7] : [TL.didnt, 0.55]].forEach(function (m) { c.push(swell(m[0], 0.45, 0.07)); c.push(sub(m[0], 58, 31, m[1], 1.6)); c.push(drum(m[0], m[1], 48, 1.1)); });
    c.push(swell(TL.stad, 0.7, 0.1)); c.push(sub(TL.stad, 60, 26, DUB ? 0.5 : 0.9, DUB ? 1.1 : 3.0)); c.push(hit(TL.stad, function (a, w) { a.crash(w, 0.14, 2.2); }));
    if (!DUB) BEATS.forEach(function (b) { c.push(sub(b, 54, 30, 0.24, 1.3)); });                          /* the drive carries the product beats; only a little weight under each */
    c.push(tick(TL.A + (2.05 - 0.3)/0.7, 0.05, 2600));                                           /* the tap on Oregon */
    /* SCRIBE: the room goes quiet; a soft weight under the name and under each line */
    if (!DUB) c.push(sub(TL.S0, 50, 30, 0.3, 1.6));
    c.push(sub(TL.S1, 52, 30, DUB ? 0.2 : 0.38, DUB ? 1.4 : 2.2));
    LINES.forEach(function (l, n) { c.push(sub(l.from, 50, 31, n === 2 ? 0.22 : 0.14, 1.4)); });
    c.push(tick(TL.V + KS.ask, 0.045, 1800)); c.push(tick(TL.V + KS.s1, 0.045, 1500));
    for (t = TL.V + KS.typeOn + 0.15; t < TL.V + KS.s1 - 0.1; t += 0.17) c.push(tick(t, 0.01, 3400, 0.015));
    /* the montage and the end ride the music; a sub under the first cut, under "One arena", and under the logo */
    c.push(sub(TL.M, 56, 30, DUB ? 0.3 : 0.5, DUB ? 0.8 : 1.4)); c.push(sub(TL.ONE, 58, 29, DUB ? 0.3 : 0.6, DUB ? 0.8 : 1.6));
    c.push(sub(TL.L + 0.02, 60, 24, 1.0, 4.2)); c.push(hit(TL.L + 0.02, function (a, w) { a.crash(w, 0.14, 3.0); }));
    return c;
  }

  /* ---------- stage furniture: the SCRIBE title card and the brand reveal ---------- */
  var ident = null, brand = null, intro = null, cur = null;
  function mountStage(stage) {
    ident = document.createElement('div'); ident.id = 'tz-ident';
    ident.innerHTML = '<div class="tz-ident-title">Scribe</div><div class="tz-ident-rule"></div><div class="tz-ident-lines">'
      + LINES.map(function (l) { return '<div class="tz-ident-line">' + T.esc(l.text) + '</div>'; }).join('') + '</div>';
    brand = document.createElement('div'); brand.id = 'tz-brand';
    brand.innerHTML = '<div class="tz-brand-in"><svg viewBox="205 250 614 495" aria-hidden="true">'
      + '<path class="b-ped" d="M 212 393 L 499.25 262.78 Q 512 257 524.75 262.78 L 812 393 L 812 401 Q 812 417 796 417 L 228 417 Q 212 417 212 401 L 212 393 Z"/>'
      + '<rect class="b-col" x="296" y="445.57" width="78" height="154.29"/><rect class="b-col" x="473" y="445.57" width="78" height="154.29"/><rect class="b-col" x="650" y="445.57" width="78" height="154.29"/>'
      + '<rect class="b-base" x="260" y="599.86" width="504" height="51.43" rx="7.71"/><rect class="b-base" x="212" y="679.86" width="600" height="57.14" rx="22.86"/></svg>'
      + '<div class="tz-brand-word">Munera</div><div class="tz-brand-tag">Enter the arena.</div><div class="tz-brand-soon">The games begin soon.</div></div>'
      /* the way in (the owner, 2026-11-15: "a button at the end that allows them to route to the login screen and create an account").
         It opens the site's sign-in screen, which offers Google, email sign-in and "New here? Create an account". */
      /* 2026-11-15, the owner: "Yes, change it" (to "Sign in" with "New accounts are by invitation"): new sign-ups are switched off until
         the invite check ships, so the button must not promise an account. */
      + '<a class="tz-cta" href="https://irbfootball.com/">Sign in</a><div class="tz-cta-note">New accounts are by invitation.</div>';
    var cta = brand.querySelector('.tz-cta');
    if (!/(^|\.)irbfootball\.com$/.test(location.hostname)) { cta.target = '_blank'; cta.rel = 'noopener'; }   /* a preview copy opens the site in a new tab */
    cta.addEventListener('touchstart', function () {}, { passive: true });                                     /* lets iOS Safari show the pressed state */
    cta.addEventListener('click', function (e) { e.stopPropagation(); });                                      /* a tap on the button is not a tap to replay */
    var ref = stage.querySelector('#tz-hud');
    stage.insertBefore(ident, ref); stage.insertBefore(brand, ref);
    if (DUB) {   /* the Munera mark names the app between "We didn't." and the phone (the owner: "too much time of dead visuals ... Can show the munera logo") */
      intro = document.createElement('div'); intro.id = 'tz-intro';
      intro.innerHTML = '<div class="tz-intro-in">' + brand.querySelector('svg').outerHTML.replace(/ class="[^"]*"/g, '') + '<div class="tz-intro-word">Munera</div></div>';
      stage.insertBefore(intro, ref);
    }
  }
  function setO(el, o, y) { el.style.opacity = o.toFixed(3); if (y != null) el.style.transform = y ? 'translateY(' + y.toFixed(1) + 'px)' : 'none'; }
  function drawIdent(t) {
    var on = sp(t, TL.S1, TL.S1 + 0.6, E.inOut) - sp(t, TL.V - 0.25, TL.V + 0.05);
    ident.style.visibility = on > 0.001 ? 'visible' : 'hidden';
    setO(ident.children[0], on, null);
    ident.children[0].style.letterSpacing = (0.3 + 0.05*sp(t, TL.S1, TL.V)).toFixed(3) + 'em';
    ident.children[1].style.transform = 'scaleX(' + (sp(t, TL.S1 + 0.2, TL.S1 + 1.2, E.entrance)*on).toFixed(3) + ')';
    LINES.forEach(function (l, i) { setO(ident.children[2].children[i], sp(t, l.from, l.from + 0.4) - sp(t, l.to - 0.25, l.to), null); });
  }
  function drawIntro(t) {
    if (!intro) return;
    var t0 = TL.stad + G, on = sp(t, t0, t0 + 0.5, E.inOut) - sp(t, TL.phoneIn - 0.55, TL.phoneIn - 0.05);
    intro.style.visibility = on > 0.001 ? 'visible' : 'hidden';
    if (on <= 0.001) return;
    var box = intro.firstElementChild, w = box.lastElementChild;
    box.firstElementChild.style.opacity = on.toFixed(3);
    box.style.transform = 'scale(' + (1.06 - 0.06*sp(t, t0, TL.phoneIn, E.outCubic)).toFixed(4) + ')';
    w.style.opacity = (Math.min(on, sp(t, t0 + 0.3, t0 + 0.9))).toFixed(3);
    w.style.letterSpacing = (0.46 - 0.14*sp(t, t0 + 0.3, t0 + 1.5, E.entrance)).toFixed(3) + 'em';
  }
  function drawBrand(t) {
    var u = t - TL.L;
    brand.style.visibility = t >= TL.K ? 'visible' : 'hidden';
    if (t < TL.K) return;
    var cols = brand.querySelectorAll('.b-col'), ped = brand.querySelector('.b-ped'), bases = brand.querySelectorAll('.b-base');
    /* the three columns arrive first, as blades of light (the opening shot, answered); then the temple closes around them */
    Array.prototype.forEach.call(cols, function (c, i) {
      var p = sp(u, i*0.07, 0.8 + i*0.07, E.entrance);
      c.style.opacity = sp(u, i*0.07, 0.14 + i*0.07).toFixed(3);
      c.style.transform = 'scaleX(' + (0.06 + 0.94*p).toFixed(3) + ')';
      c.style.fill = p < 0.999 ? 'rgb(' + Math.round(241 - 40*p) + ',' + Math.round(223 - 61*p) + ',' + Math.round(166 - 91*p) + ')' : '';
    });
    var q = sp(u, 0.6, 1.4, E.entrance);
    ped.style.opacity = q.toFixed(3); ped.style.transform = 'translateY(' + ((1 - q)*-22).toFixed(1) + 'px)';
    Array.prototype.forEach.call(bases, function (b, i) { var r = sp(u, 0.66 + i*0.08, 1.46 + i*0.08, E.entrance); b.style.opacity = r.toFixed(3); b.style.transform = 'translateY(' + ((1 - r)*22).toFixed(1) + 'px)'; });
    var w = brand.querySelector('.tz-brand-word'), wp = sp(u, 1.2, 2.4, E.entrance);
    w.style.opacity = sp(u, 1.2, 1.9).toFixed(3); w.style.letterSpacing = (0.5 - 0.18*wp).toFixed(3) + 'em';
    setO(brand.querySelector('.tz-brand-tag'), sp(u, 2.0, 2.7), null);
    setO(brand.querySelector('.tz-brand-soon'), sp(u, 3.3, 4.1), null);
    var cta = brand.querySelector('.tz-cta'), cp = sp(u, 4.5, 5.2, E.entrance);
    cta.style.opacity = cp.toFixed(3); cta.style.pointerEvents = cp > 0.5 ? 'auto' : 'none';
    cta.style.transform = 'translateX(-50%) translateY(' + ((1 - cp)*12).toFixed(1) + 'px)';
    setO(brand.querySelector('.tz-cta-note'), sp(u, 4.9, 5.6), null);
    brand.firstElementChild.style.transform = 'scale(' + (1.05 - 0.05*sp(u, 0, 5.4, E.outCubic)).toFixed(4) + ')';
  }

  T.register({
    id: v.id, label: v.label, duration: TL.END, loop: false, TL: TL,
    captions: CAPS, atmos: atmos, mountStage: mountStage, media: v.media,
    cues: function () { return CUES[v.id] || (CUES[v.id] = v.mix ? [cue.sample('mix', 0, { dur: TL.END, direct: true, fadeIn: 0.005, fadeOut: 0.02 })] : buildCues(v.id)); },
    mount: function () {},
    reset: function (phone) { cur = null; phone.pageKey = null; },
    tick: function (t, phone) {
      var s = segAt(t), scene = T.scenes[s.scene];
      if (s !== cur) { cur = s; scene.reset(phone); }
      scene.tick(s.at + (t - s.from)*s.rate, phone);
      T.pose(phone, pose(t));
      drawIdent(t); drawIntro(t); drawBrand(t);
    }
  });
  }
  var VERSIONS = [{ id: 'dubstep', label: 'Enter the Arena', mix: !RAW,
    media: RAW ? { audio: { music: MEDIA.audio.music, roar: MEDIA.audio.roar, erupt: MEDIA.audio.erupt, dub: 'media-src/dubstep.mp3' } } : { audio: { mix: 'media/soundtrack.m4a' } } }];
  if (RAW) VERSIONS.push({ id: 'film', label: 'Enter the Arena (earlier score)', media: MEDIA });   /* needs the recordings, so only where media-src/ exists */
  VERSIONS.forEach(make);
})(window.TEASER);
