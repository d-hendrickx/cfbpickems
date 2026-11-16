/* teaser/audio.js — PROMO-ONLY. The film's sound engine (Web Audio): recordings from media/ (cue.sample) plus synthesized weight.
   Trailer vocabulary, not notes: sub booms, braams (detuned saw stacks through a moving filter and drive), big
   drums, a low filtered pulse, risers, a bowed-metal groan, crowd beds. Everything can be sent to a hall reverb
   (a generated impulse response), and the dry bus runs through soft saturation, a compressor and a limiter.
   A cue is a function (a, when, from): `when` is the context time of film time `from`, so the score rebuilds from
   any point and stays locked to the picture. The same cues render in an OfflineAudioContext (T.audio.render) so
   loudness can be measured without ears. */
window.TEASER = window.TEASER || {};
(function (T) {
  'use strict';
  function valueAt(pts, t) {
    if (t <= pts[0][0]) return pts[0][1];
    for (var i = 1; i < pts.length; i++) if (t <= pts[i][0]) { var a = pts[i-1], b = pts[i]; return a[1] + (b[1] - a[1])*((t - a[0])/Math.max(b[0] - a[0], 1e-4)); }
    return pts[pts.length - 1][1];
  }
  function applyEnv(param, pts, when, from, exp) {
    var floor = exp ? 1e-4 : 0;
    param.setValueAtTime(Math.max(valueAt(pts, from), floor), when);
    pts.forEach(function (p) { if (p[0] > from) { var at = when + (p[0] - from); if (exp) param.exponentialRampToValueAtTime(Math.max(p[1], 1e-4), at); else param.linearRampToValueAtTime(p[1], at); } });
  }

  /* one graph per AudioContext (live or offline) */
  function makeGraph(ctx) {
    var sr = ctx.sampleRate, i, ch;
    function noiseBuf(brownian) {
      var len = Math.floor(sr*2.5), b = ctx.createBuffer(1, len, sr), d = b.getChannelData(0), last = 0;
      for (i = 0; i < len; i++) { var w = Math.random()*2 - 1; if (brownian) { last = (last + 0.02*w)/1.02; d[i] = last*3.5; } else d[i] = w; }
      return b;
    }
    /* a hall: 3.4 s of decaying, darkening noise per channel, after a short pre-delay */
    var irLen = Math.floor(sr*3.4), ir = ctx.createBuffer(2, irLen, sr), pre = Math.floor(sr*0.022);
    for (ch = 0; ch < 2; ch++) { var d = ir.getChannelData(ch), y = 0;
      for (i = pre; i < irLen; i++) { var k = (i - pre)/(irLen - pre); var x = (Math.random()*2 - 1)*Math.pow(1 - k, 2.4); var damp = 0.35 + 0.5*k; y = y*damp + x*(1 - damp); d[i] = y*0.9; } }
    var curve = new Float32Array(1025); for (i = 0; i < 1025; i++) { var v = i/512 - 1; curve[i] = Math.tanh(v*1.8)/Math.tanh(1.8); }
    var shaper = ctx.createWaveShaper(); shaper.curve = curve; shaper.oversample = '2x';
    var comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.25;
    var lim = ctx.createDynamicsCompressor(); lim.threshold.value = -3; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.002; lim.release.value = 0.12;
    var master = ctx.createGain(); master.gain.value = 0.8;
    var direct = ctx.createGain(); direct.connect(ctx.destination);   /* a finished mix plays here, past the saturation, compressor and limiter it already went through */
    var conv = ctx.createConvolver(); conv.buffer = ir;
    var wetGain = ctx.createGain(); wetGain.gain.value = 0.5;
    shaper.connect(comp); conv.connect(wetGain); wetGain.connect(comp); comp.connect(lim); lim.connect(master); master.connect(ctx.destination);
    var G = { ctx: ctx, master: master, direct: direct, dryIn: shaper, wetIn: conv, dry: null, wet: null, live: [],
      white: noiseBuf(false), white2: noiseBuf(false), brown: noiseBuf(true), drive: curve, samples: {}, rev: {} };
    G.newBus = function () {
      G.live.forEach(function (n) { try { n.stop(); } catch (e) {} }); G.live = [];
      if (G.dry) { try { G.dry.disconnect(); G.wet.disconnect(); } catch (e) {} }
      G.dry = ctx.createGain(); G.dry.connect(G.dryIn); G.wet = ctx.createGain(); G.wet.connect(G.wetIn);
    };
    G.newBus();
    return G;
  }

  /* the instruments, bound to a graph */
  function instruments(G) {
    var ctx = G.ctx;
    function track(n) { G.live.push(n); return n; }
    function out(node, rev, pan) {
      var src = node;
      if (pan && ctx.createStereoPanner) { var p = ctx.createStereoPanner(); p.pan.value = pan; node.connect(p); src = p; }
      src.connect(G.dry);
      if (rev) { var g = ctx.createGain(); g.gain.value = rev; src.connect(g); g.connect(G.wet); }
    }
    function filt(type, f, q, gain) { var b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q == null ? 0.7 : q; if (gain != null) b.gain.value = gain; return b; }
    function noise(kind) { var s = ctx.createBufferSource(); s.buffer = kind === 'brown' ? G.brown : kind === 'white2' ? G.white2 : G.white; s.loop = true; return track(s); }
    function osc(type, f, cents) { var o = ctx.createOscillator(); o.type = type; o.frequency.value = f; if (cents) o.detune.value = cents; return track(o); }
    var a = {
      ctx: ctx, out: out, filt: filt, noise: noise, osc: osc, track: track,
      direct: function (node) { node.connect(G.direct); },
      /* a decoded recording; with rev = [from, seconds], only that stretch, backwards (a short copy, made once) */
      sample: function (name, rev) {
        var b = G.samples[name] || null; if (!b || !rev) return b;
        var k = name + ':rev:' + rev[0].toFixed(3) + ':' + rev[1].toFixed(3); if (G.rev[k]) return G.rev[k];
        var i0 = Math.max(0, Math.round(rev[0]*b.sampleRate)), n = Math.max(1, Math.min(b.length - i0, Math.round(rev[1]*b.sampleRate)));
        var r = ctx.createBuffer(b.numberOfChannels, n, b.sampleRate);
        for (var ch = 0; ch < b.numberOfChannels; ch++) { var d = r.getChannelData(ch); d.set(b.getChannelData(ch).subarray(i0, i0 + n)); Array.prototype.reverse.call(d); }
        return (G.rev[k] = r);
      },
      /* a sub boom: a sine falling in pitch with a long tail */
      sub: function (at, f0, f1, peak, tail) {
        var o = osc('sine', f0), g = ctx.createGain();
        o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + tail*0.6);
        g.gain.setValueAtTime(1e-4, at); g.gain.linearRampToValueAtTime(peak, at + 0.012); g.gain.exponentialRampToValueAtTime(1e-4, at + tail);
        o.connect(g); out(g, 0.12); o.start(at); o.stop(at + tail + 0.05);
      },
      /* a big drum: pitched body, a low thump of noise, a short attack */
      drum: function (at, peak, f, tail, rev) {
        f = f || 62; tail = tail || 0.6;
        var o = osc('sine', f*2.4), g = ctx.createGain();
        o.frequency.setValueAtTime(f*2.4, at); o.frequency.exponentialRampToValueAtTime(f, at + 0.07);
        g.gain.setValueAtTime(1e-4, at); g.gain.linearRampToValueAtTime(peak, at + 0.004); g.gain.exponentialRampToValueAtTime(1e-4, at + tail);
        o.connect(g); out(g, rev == null ? 0.3 : rev); o.start(at); o.stop(at + tail + 0.05);
        var n = noise(), lp = filt('lowpass', 700), g2 = ctx.createGain();
        g2.gain.setValueAtTime(peak*0.6, at); g2.gain.exponentialRampToValueAtTime(1e-4, at + 0.13);
        n.connect(lp); lp.connect(g2); out(g2, rev == null ? 0.3 : rev); n.start(at); n.stop(at + 0.18);
        var c = noise('white2'), hp = filt('highpass', 2500), g3 = ctx.createGain();
        g3.gain.setValueAtTime(peak*0.22, at); g3.gain.exponentialRampToValueAtTime(1e-4, at + 0.02);
        c.connect(hp); hp.connect(g3); out(g3, 0.1); c.start(at); c.stop(at + 0.05);
      },
      /* a braam: detuned saws in octaves through a filter that opens and closes, driven, into the hall */
      braam: function (at, f, peak, dur, bright, rev) {
        var lp = filt('lowpass', 140, 1.2), sh = ctx.createWaveShaper(), g = ctx.createGain();
        sh.curve = G.drive;
        [[1,0,1],[1,9,1],[1,-9,1],[2,5,0.7],[2,-6,0.7],[3,0,0.3],[0.5,0,1.1,'sine']].forEach(function (v) {
          var o = osc(v[3] || 'sawtooth', f*v[0], v[1]), og = ctx.createGain(); og.gain.value = 0.2*v[2];
          o.connect(og); og.connect(lp); o.start(at); o.stop(at + dur + 0.1);
        });
        lp.frequency.setValueAtTime(140, at); lp.frequency.exponentialRampToValueAtTime(bright || 1200, at + dur*0.3); lp.frequency.exponentialRampToValueAtTime(240, at + dur);
        g.gain.setValueAtTime(1e-4, at); g.gain.linearRampToValueAtTime(peak, at + 0.07); g.gain.setValueAtTime(peak, at + dur*0.4); g.gain.exponentialRampToValueAtTime(1e-4, at + dur);
        lp.connect(sh); sh.connect(g); out(g, rev == null ? 0.5 : rev);
      },
      /* one note of the pulse: a short, dark, filtered pluck with a sub under it */
      pulse: function (at, f, peak, cutoff) {
        var lp = filt('lowpass', cutoff*2.5, 2), g = ctx.createGain();
        [[1,0,'sawtooth',0.5],[1,7,'sawtooth',0.5],[0.5,0,'sine',0.8]].forEach(function (v) { var o = osc(v[2], f*v[0], v[1]), og = ctx.createGain(); og.gain.value = v[3]; o.connect(og); og.connect(lp); o.start(at); o.stop(at + 0.26); });
        lp.frequency.setValueAtTime(cutoff*2.5, at); lp.frequency.exponentialRampToValueAtTime(cutoff, at + 0.09);
        g.gain.setValueAtTime(1e-4, at); g.gain.linearRampToValueAtTime(peak, at + 0.005); g.gain.exponentialRampToValueAtTime(1e-4, at + 0.2);
        lp.connect(g); out(g, 0.16);
      },
      /* a small dry tick (interface sounds, shaker) */
      tick: function (at, peak, f, dur) {
        var n = noise('white2'), bp = filt(f > 5000 ? 'highpass' : 'bandpass', f || 3000, 2), g = ctx.createGain();
        g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(1e-4, at + (dur || 0.025));
        n.connect(bp); bp.connect(g); out(g, 0.05); n.start(at); n.stop(at + (dur || 0.025) + 0.03);
      },
      /* a crash: bright noise that darkens as it decays into the hall */
      crash: function (at, peak, dur) {
        var n = noise(), hp = filt('highpass', 250), lp = filt('lowpass', 9000), g = ctx.createGain();
        lp.frequency.setValueAtTime(9000, at); lp.frequency.exponentialRampToValueAtTime(900, at + dur);
        g.gain.setValueAtTime(peak, at); g.gain.exponentialRampToValueAtTime(1e-4, at + dur);
        n.connect(hp); hp.connect(lp); lp.connect(g); out(g, 0.5); n.start(at); n.stop(at + dur + 0.05);
      }
    };
    return a;
  }

  /* cue builders: each returns (a, when, from) */
  T.cue = {
    hit: function (t, fn) { return function (a, when, from) { if (t < from - 0.01) return; fn(a, when + (t - from)); }; },
    /* a recording from media/: starts at film time t, `offset` seconds into the file, for `dur` film seconds.
       env = gain envelope in film time (default: `gain` with fades); lp = low-pass envelope in film time;
       rate = playback speed (lower is deeper and slower); rev, pan as elsewhere. Honours `from`, so seek and replay stay locked.
       direct = a finished mix: straight to the output, not through the master chain a second time.
       reverse = play the stretch of the file from `offset` to `offset + dur*rate` backwards (needs `dur`): a tail turned into a swell. */
    sample: function (name, t, o) {
      o = o || {};
      var fn = function (a, when, from) {
        var rate = o.rate || 1, off = o.offset || 0;
        var buf = a.sample(name, o.reverse ? [off, o.dur*rate] : null); if (!buf) return;
        if (o.reverse) off = 0;
        var dur = o.dur != null ? o.dur : (buf.duration - off)/rate, end = t + dur;
        if (from >= end) return;
        var start = Math.max(from, t), at = when + (start - from);
        var gain = o.gain == null ? 1 : o.gain, fi = o.fadeIn == null ? 0.02 : o.fadeIn, fo = o.fadeOut == null ? 0.05 : o.fadeOut;
        var env = o.env || [[t, 0], [t + fi, gain], [Math.max(t + fi, end - fo), gain], [end, 0]];
        var s = a.ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate; s.loop = !!o.loop; a.track(s);
        if (o.loop && o.loopEnd) { s.loopStart = o.loopStart || 0; s.loopEnd = o.loopEnd; }
        var node = s;
        if (o.lp) { var f = a.filt('lowpass', o.lp[0][1], 0.7); applyEnv(f.frequency, o.lp, at, start, true); node.connect(f); node = f; }
        if (o.hp) { var h = a.filt('highpass', o.hp, 0.7); node.connect(h); node = h; }
        var g = a.ctx.createGain(); applyEnv(g.gain, env, at, start, false);
        node.connect(g); if (o.direct) a.direct(g); else a.out(g, o.rev || 0, o.pan || 0);
        var into = off + (start - t)*rate;
        if (s.loop) { var ls = o.loopEnd ? (o.loopStart || 0) : 0, le = o.loopEnd || buf.duration; s.start(at, into < le ? into : ls + (into - ls) % (le - ls)); }
        else s.start(at, Math.min(into, Math.max(buf.duration - 0.01, 0)));
        s.stop(when + (end - from) + 0.05);
      };
      fn.stem = o.stem || name;   /* lets the mix be measured one stem at a time */
      return fn;
    },
    /* a looping noise bed: filters, a gain envelope, an optional sweep of the first filter, reverb send, pan */
    bed: function (kind, filters, env, sweep, rev, pan) {
      return function (a, when, from) {
        var end = env[env.length - 1][0]; if (from >= end) return;
        var start = Math.max(from, env[0][0]), at = when + (start - from);
        var s = a.noise(kind), node = s, first = null;
        filters.forEach(function (f) { var b = a.filt(f.type, f.f, f.q, f.gain); node.connect(b); node = b; if (!first) first = b; });
        var g = a.ctx.createGain(); applyEnv(g.gain, env, at, start, false);
        if (sweep && first) applyEnv(first.frequency, sweep, at, start, true);
        node.connect(g); a.out(g, rev || 0, pan || 0); s.start(at); s.stop(when + (end - from) + 0.1);
      };
    },
    /* sustained detuned oscillators through a low-pass (a number, or an envelope) with a gain envelope */
    pad: function (freqs, type, lp, env, rev) {
      return function (a, when, from) {
        var end = env[env.length - 1][0]; if (from >= end) return;
        var start = Math.max(from, env[0][0]), at = when + (start - from);
        var f = a.filt('lowpass', typeof lp === 'number' ? lp : lp[0][1], 0.6), g = a.ctx.createGain();
        if (typeof lp !== 'number') applyEnv(f.frequency, lp, at, start, true);
        applyEnv(g.gain, env, at, start, false);
        freqs.forEach(function (fr, i) { [-7, 7].forEach(function (c) { var o = a.osc(type, fr, c + i*2), og = a.ctx.createGain(); og.gain.value = 0.5/freqs.length; o.connect(og); og.connect(f); o.start(at); o.stop(when + (end - from) + 0.1); }); });
        f.connect(g); a.out(g, rev == null ? 0.5 : rev);
      };
    },
    /* a bowed-metal groan: noise through a bank of narrow resonances, swelling and dying in the hall */
    groan: function (t0, dur, peak, tones) {
      return function (a, when, from) {
        if (from >= t0 + dur) return;
        var start = Math.max(from, t0), at = when + (start - from);
        var s = a.noise('white2'), g = a.ctx.createGain();
        applyEnv(g.gain, [[t0, 0], [t0 + dur*0.45, peak], [t0 + dur, 0]], at, start, false);
        (tones || [233, 311, 466, 628, 932]).forEach(function (f, i) { var b = a.filt('bandpass', f, 50), bg = a.ctx.createGain(); bg.gain.value = 7/(1 + i*0.5); s.connect(b); b.connect(bg); bg.connect(g); });
        a.out(g, 0.8); s.start(at); s.stop(when + (t0 + dur - from) + 0.1);
      };
    },
    /* a riser: noise and a saw stack climbing, cut dead at t1 */
    riser: function (t0, t1, peak) {
      return function (a, when, from) {
        if (from >= t1) return;
        var start = Math.max(from, t0), at = when + (start - from), end = when + (t1 - from);
        var n = a.noise(), bp = a.filt('bandpass', 300, 1.1), lp = a.filt('lowpass', 200, 1), g = a.ctx.createGain();
        applyEnv(bp.frequency, [[t0, 300], [t1, 6500]], at, start, true);
        applyEnv(lp.frequency, [[t0, 200], [t1, 3200]], at, start, true);
        applyEnv(g.gain, [[t0, 0], [t1 - 0.04, peak], [t1, 0]], at, start, false);
        n.connect(bp); bp.connect(g);
        [0, 9, -8].forEach(function (c) { var o = a.osc('sawtooth', 55, c), og = a.ctx.createGain(); og.gain.value = 0.25;
          applyEnv(o.frequency, [[t0, 55], [t1, 165]], at, start, true); o.connect(og); og.connect(lp); o.start(at); o.stop(end + 0.05); });
        lp.connect(g); a.out(g, 0.35); n.start(at); n.stop(end + 0.05);
      };
    }
  };

  var live = null, muted = false, raw = {};
  /* decode every fetched file for one graph (each context needs its own decode) */
  function decodeAll(G) {
    var names = Object.keys(raw).filter(function (n) { return !G.samples[n]; });
    return Promise.all(names.map(function (n) {
      return new Promise(function (res) {
        var done = function (b) { if (b) G.samples[n] = b; res(); };
        try { var p = G.ctx.decodeAudioData(raw[n].slice(0), done, function () { console.error('[teaser audio] cannot decode', n); res(); }); if (p && p.catch) p.catch(function () {}); }
        catch (e) { console.error('[teaser audio]', n, e); res(); }
      });
    }));
  }
  function schedule(G, cues, when, from) {
    G.newBus();
    var a = instruments(G);
    cues.forEach(function (c) { try { c(a, when, from); } catch (e) { console.error('[teaser audio]', e); } });
  }
  T.audio = {
    init: function () {
      if (live) return true;
      var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return false;
      live = makeGraph(new AC()); live.master.gain.value = muted ? 0 : 0.8; live.direct.gain.value = muted ? 0 : 1;
      /* where the browser offers it, play like a video does (an iPhone's silent switch does not mute a film the viewer tapped to start) */
      try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
      return true;
    },
    /* fetch the recordings (no gesture needed); { name: url }. Missing files are reported and skipped. */
    preload: function (map) {
      return Promise.all(Object.keys(map || {}).map(function (n) {
        return fetch(map[n]).then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
          .then(function (b) { raw[n] = b; }).catch(function (e) { console.error('[teaser audio] cannot load', n, map[n], e); });
      }));
    },
    /* decode for the live context; resolves when every loaded file is ready to play */
    ready: function () { return live ? decodeAll(live) : Promise.resolve(); },
    samples: function () { return live ? Object.keys(live.samples).map(function (n) { return { name: n, seconds: Math.round(live.samples[n].duration*10)/10 }; }) : []; },
    /* the decoded buffer of one recording */
    buffer: function (name) { return live && live.samples[name] || null; },
    /* the shape of a recording, for cutting picture to it: loudness every `win` seconds (dBFS) and the onsets
       (moments where the energy jumps by more than `jump` dB over the previous half second): the track's hits */
    analyze: function (name, win, jump) {
      var b = live && live.samples[name]; if (!b) return null;
      win = win || 0.1; jump = jump || 6;
      var sr = b.sampleRate, n = Math.floor(sr*win), chs = [], c, i, k, env = [], onsets = [];
      for (c = 0; c < b.numberOfChannels; c++) chs.push(b.getChannelData(c));
      for (k = 0; (k + 1)*n <= b.length; k++) { var sum = 0;
        for (c = 0; c < chs.length; c++) { var d = chs[c]; for (i = k*n; i < (k + 1)*n; i++) sum += d[i]*d[i]; }
        var r = Math.sqrt(sum/(n*chs.length)); env.push(r > 1e-6 ? Math.round(200*Math.log10(r))/10 : -99); }
      var back = Math.max(1, Math.round(0.5/win));
      for (k = back; k < env.length; k++) { var prev = -99; for (i = k - back; i < k; i++) prev = Math.max(prev, env[i]);
        if (env[k] - prev >= jump && env[k] > -30 && (!onsets.length || k*win - onsets[onsets.length - 1].t > 0.4)) onsets.push({ t: Math.round(k*win*100)/100, db: env[k], jump: Math.round((env[k] - prev)*10)/10 }); }
      return { seconds: Math.round(b.duration*100)/100, win: win, env: env, onsets: onsets };
    },
    play: function (cues, from) { if (live) schedule(live, cues, live.ctx.currentTime + 0.08, from); },
    suspend: function () { if (live && live.ctx.state === 'running') live.ctx.suspend(); },
    resume: function () { if (live && live.ctx.state !== 'running') live.ctx.resume(); },
    setMuted: function (m) { muted = m; if (live) { live.master.gain.value = m ? 0 : 0.8; live.direct.gain.value = m ? 0 : 1; } },
    muted: function () { return muted; },
    /* render the whole score offline and report loudness per second (dBFS): { peak, rms: [..] } */
    render: function (cues, dur) {
      var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext, sr = 44100;
      var ctx = new OC(2, Math.ceil(sr*dur), sr), G = makeGraph(ctx);
      return decodeAll(G).then(function () { schedule(G, cues, 0, 0); return ctx.startRendering(); }).then(function (buf) {
        var L = buf.getChannelData(0), R = buf.getChannelData(1), rms = [], peak = 0, db = function (x) { return x > 1e-7 ? Math.round(200*Math.log10(x))/10 : -99; };
        for (var s = 0; s < Math.ceil(dur); s++) { var sum = 0, n = 0;
          for (var i = s*sr; i < Math.min((s + 1)*sr, L.length); i++) { var l = L[i], r = R[i]; sum += l*l + r*r; n += 2; var m = Math.max(Math.abs(l), Math.abs(r)); if (m > peak) peak = m; }
          rms.push(db(Math.sqrt(sum/Math.max(n, 1)))); }
        return { peak: db(peak), rms: rms, buffer: buf };   /* the buffer lets a check look at what landed on which beat */
      });
    }
  };
})(window.TEASER);
