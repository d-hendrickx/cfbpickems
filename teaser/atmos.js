/* teaser/atmos.js — PROMO-ONLY. The film's background, rendered live. No images unless a stadium plate is given.
   Third cut: a small multi-pass renderer, because the single low-resolution pass read as "8-bit".
     1. fog      half resolution: the fog is marched along each view ray (40 samples on a FIXED interleaved pattern,
                 so nothing crawls) and every sample asks whether a column stands between it and the light;
                 then an edge-aware two-pass blur. Fog is soft, so half resolution costs nothing visible.
     2. scene    the columns, floor and back light, four sub-pixel rays per pixel so every edge is smooth;
                 soft contact shadows; the fog composited; or the stadium (lamps, beams, bowl, optional video plate).
                 Written to a float target, so nothing clips and nothing bands.
     3. bloom    a blurred bright-pass, plus a wide horizontal pass: the lens streak off the hot core and the lamps.
     4. final    at the device's own resolution: scene + bloom, filmic tone curve, vignette, fine grain, and a dither
                 below one 8-bit step so dark gradients stay smooth.
   An adaptive scaler lowers only passes 1 to 3 when frames run long; the final pass, the grain and the type stay crisp. */
window.TEASER = window.TEASER || {};
(function (T) {
  'use strict';

  var VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';

  var COMMON = [
'precision highp float;',
'uniform vec2 u_res; uniform float u_time;',
'uniform float u_lx, u_gain, u_red;',
'uniform vec3 u_cam; uniform vec2 u_look;',
'const float S = 2.6; const float R = 0.55; const float H = 7.0;',
'#ifdef HDR8',                                                             /* no float targets: pack a wide range into 8 bits */
'vec3 enc(vec3 c){ return sqrt(c/(1.0 + c)); } vec3 dec(vec3 e){ vec3 s = e*e; return s/max(1.0 - s, 1e-3); }',
'#else',
'vec3 enc(vec3 c){ return c; } vec3 dec(vec3 e){ return e; }',
'#endif',
'float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }',
'float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);',
'  return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }',
'float fbm(vec2 p){ float v=0., a=.5; for(int i=0;i<3;i++){ v+=a*vnoise(p); p=p*2.03+17.1; a*=.5; } return v; }',
'float colDist(float x){ return abs(x - floor(x/S + 0.5)*S); }',
'vec3 lightDir(){ return normalize(vec3(u_lx, -0.16, -1.0)); }',         /* the direction the light travels */
'vec3 rayDir(vec2 uv){',
'  float cy = cos(u_look.x), sy = sin(u_look.x), cp = cos(u_look.y), sp = sin(u_look.y);',
'  vec3 rd = normalize(vec3(uv, 1.55));',
'  rd = vec3(rd.x, rd.y*cp + rd.z*sp, rd.z*cp - rd.y*sp);',
'  return vec3(rd.x*cy + rd.z*sy, rd.y, rd.z*cy - rd.x*sy);',
'}',
/* how much of the back light reaches p: blocked by a column or by the beam above, with a penumbra that widens with distance */
'float lightVis(vec3 p, vec3 L){',
'  if (p.z > 0.0) return 1.0;',
'  float s = p.z/L.z; vec3 q = p - L*s;',
'  float pen = 0.05 + 0.04*s;',
'  float v = smoothstep(R - pen, R + pen, colDist(q.x));',
'  return v*(1.0 - smoothstep(H - 0.3, H + 0.3 + 0.06*s, q.y));',
'}',
/* nearest surface: mat 0 open, 1 column, 2 floor, 3 beam */
'float intersect(vec3 ro, vec3 rd, out vec3 n, out float mat){',
'  float tHit = 1e5; n = vec3(0.0); mat = 0.0;',
'  if (rd.y < -1e-4){ float t = -ro.y/rd.y; if (t > 0.0){ tHit = t; n = vec3(0,1,0); mat = 2.0; } }',
'  if (rd.z > 1e-4){',
'    float t = (-0.8 - ro.z)/rd.z; if (t > 0.0 && t < tHit && ro.y + rd.y*t > H){ tHit = t; n = vec3(0,0,-1); mat = 3.0; }',
'    if (rd.y > 1e-4){ float t2 = (H - ro.y)/rd.y; float z2 = ro.z + rd.z*t2; if (t2 > 0.0 && t2 < tHit && abs(z2) < 0.8){ tHit = t2; n = vec3(0,-1,0); mat = 3.0; } }',
'  }',
'  float x0 = ro.x + rd.x*(-ro.z/max(rd.z, 1e-3));',
'  float k0 = floor(x0/S + 0.5);',
'  for (int i=-1;i<=1;i++){',
'    float cx = (k0 + float(i))*S;',
'    vec2 oc = ro.xz - vec2(cx, 0.0); float a = dot(rd.xz, rd.xz); float b = dot(oc, rd.xz);',
'    for (int j=0;j<2;j++){',                                              /* j=0 the shaft, j=1 the wider base and capital */
'      float rr = (j==0) ? R : R + 0.14;',
'      float disc = b*b - a*(dot(oc,oc) - rr*rr);',
'      if (disc > 0.0){ float t = (-b - sqrt(disc))/a; float y = ro.y + rd.y*t;',
'        bool ok = (j==0) ? (y > 0.0 && y < H) : ((y > 0.0 && y < 0.38) || (y > H - 0.5 && y < H));',
'        if (t > 0.0 && t < tHit && ok){ tHit = t; vec3 hp = ro + rd*t; n = normalize(vec3(hp.x - cx, 0.0, hp.z)); mat = 1.0; } }',
'    }',
'  }',
'  return tHit;',
'}'].join('\n');

  var FOG = [
'void main(){',
'  vec2 px = gl_FragCoord.xy;',
'  vec2 uv = (px/u_res*2.0 - 1.0)*vec2(u_res.x/u_res.y, 1.0);',
'  vec3 ro = u_cam, rd = rayDir(uv), L = lightDir(); vec3 n; float mat;',
'  float tHit = intersect(ro, rd, n, mat); if (mat < 0.5) tHit = 30.0;',
'  float tEnd = min(tHit, 26.0); float dt = tEnd/40.0;',
'  float t = dt*fract(52.9829189*fract(dot(px, vec2(0.06711056, 0.00583715))));',   /* interleaved gradient noise: fixed in time */
'  float trans = 1.0; float scat = 0.0;',
'  for (int i=0;i<40;i++){',
'    vec3 p = ro + rd*t;',
'    float dens = 0.034*(0.45 + 1.1*vnoise(vec2(p.x*0.33 + p.z*0.21 + u_time*0.05, p.y*0.5 + p.z*0.29 - u_time*0.025)))*exp(-max(p.y, 0.0)*0.09);',
'    scat += dens*lightVis(p, L)*trans*dt;',
'    trans *= exp(-dens*dt*0.85);',
'    t += dt;',
'  }',
'  float phase = 0.035 + 1.7*pow(max(dot(rd, -L), 0.0), 22.0);',
'  gl_FragColor = vec4(enc(vec3(scat*phase*2.0)), trans);',
'}'].join('\n');

  /* separable 9-tap blur; u_edge > 0 makes it stop at alpha edges (the fog must not leak across a column's outline) */
  var BLUR = [
'precision highp float;',
'uniform sampler2D u_tex; uniform vec2 u_dir; uniform vec2 u_res; uniform float u_edge;',
'void main(){',
'  vec2 uv = gl_FragCoord.xy/u_res;',
'  vec4 c = texture2D(u_tex, uv); vec4 acc = c*0.227; float wsum = 0.227;',
'  for (int i=1;i<=4;i++){',
'    float fi = float(i); float w = (i==1) ? 0.1946 : (i==2) ? 0.1216 : (i==3) ? 0.0541 : 0.0162;',
'    vec4 a = texture2D(u_tex, uv + u_dir*fi); vec4 b = texture2D(u_tex, uv - u_dir*fi);',
'    float wa = w*exp(-abs(a.a - c.a)*u_edge), wb = w*exp(-abs(b.a - c.a)*u_edge);',
'    acc += a*wa + b*wb; wsum += wa + wb;',
'  }',
'  gl_FragColor = acc/wsum;',
'}'].join('\n');

  var SCENE = [
'uniform sampler2D u_fog; uniform sampler2D u_plate;',
'uniform float u_pil, u_stad, u_beam, u_plateOn; uniform vec2 u_plateFit;',
'vec3 surface(vec3 ro, vec3 rd, vec3 L, vec3 warm, vec3 amb){',
'  vec3 n; float mat; float tHit = intersect(ro, rd, n, mat);',
'  if (mat < 0.5){',                                                        /* the light beyond the columns: a hot core, darkness around it */
'    float f = max(dot(rd, -L), 0.0);',
'    return warm*u_gain*(0.035 + 0.42*pow(f, 34.0) + 3.4*pow(f, 260.0))*(0.6 + 0.4*smoothstep(0.55, -0.05, rd.y));',
'  }',
'  vec3 hp = ro + rd*tHit;',
'  if (mat < 1.5){',
'    float ang = atan(n.z, n.x); float flute = 0.55 + 0.45*cos(ang*22.0);',
'    float lam = smoothstep(-0.45, 0.5, dot(n, -L));',
'    float rim = pow(1.0 - abs(dot(n, -rd)), 3.0);',
'    float stone = 0.75 + 0.25*fbm(vec2(ang*3.0, hp.y*1.3));',
'    float ao = 0.45 + 0.55*smoothstep(0.0, 1.1, hp.y);',                  /* darker where the column meets the floor */
'    float bounce = 0.05*exp(-hp.y*0.5);',
'    return (warm*u_gain*(lam*0.3 + rim*0.7 + bounce)*(0.45 + 0.55*flute)*stone + amb*(0.6 + 0.4*flute))*ao;',
'  }',
'  if (mat < 2.5){',
'    float vis = lightVis(hp + vec3(0,0.01,0), L);',
'    float seam = smoothstep(0.03, 0.0, abs(fract(hp.x/2.6 + 0.5) - 0.5)*2.6) + smoothstep(0.03, 0.0, abs(fract(hp.z/2.6) - 0.5)*2.6);',
'    float slab = 0.8 + 0.2*fbm(hp.xz*0.6) - 0.22*min(seam, 1.0);',
'    float contact = 0.35 + 0.65*smoothstep(R, R + 1.0, length(vec2(colDist(hp.x), hp.z)));',   /* soft shadow pooled round each base */
'    vec3 r = reflect(rd, vec3(0,1,0));',
'    float rs = (0.0 - hp.z)/max(r.z, 1e-3);',
'    float gap = smoothstep(R - 0.25, R + 0.35, colDist(hp.x + r.x*rs));',
'    float fres = 0.05 + 0.75*pow(1.0 - max(-rd.y, 0.0), 5.0);',
'    return warm*u_gain*(vis*0.34*slab*contact + gap*fres*0.4*step(hp.z, 0.0)*(1.0 - smoothstep(H*0.6, H, rs*r.y)))',
'         + amb*slab*contact + warm*u_gain*step(0.0, hp.z)*0.3*slab;',
'  }',
'  return amb*0.7 + warm*u_gain*0.02*max(-n.y, 0.0);',
'}',
'vec3 colonnade(vec2 px){',
'  vec3 L = lightDir();',
'  vec3 warm = mix(vec3(1.0,0.80,0.52), vec3(1.0,0.13,0.09), u_red);',
'  vec3 amb = vec3(0.004,0.005,0.008);',
'  vec3 acc = vec3(0.0);',
'  for (int i=0;i<4;i++){',                                                 /* four sub-pixel rays on a rotated grid: smooth outlines */
'    vec2 o = (i==0) ? vec2(-0.375,-0.125) : (i==1) ? vec2(0.125,-0.375) : (i==2) ? vec2(0.375,0.125) : vec2(-0.125,0.375);',
'    vec2 uv = ((px + o)/u_res*2.0 - 1.0)*vec2(u_res.x/u_res.y, 1.0);',
'    acc += surface(u_cam, rayDir(uv), L, warm, amb);',
'  }',
'  vec4 fog = texture2D(u_fog, px/u_res);',
'  return acc*0.25*fog.a + warm*u_gain*dec(fog.rgb).r;',
'}',
'vec3 stadium(vec2 uv, vec2 st){',
'  vec3 cool = vec3(0.80,0.87,1.0);',
'  vec3 col = mix(vec3(0.002,0.003,0.007), vec3(0.008,0.011,0.024), smoothstep(-1.0, 1.0, uv.y));',
'  if (u_plateOn > 0.5){',                                                  /* a real stadium, out of focus and graded down, under the beams */
'    vec2 pc = (st - 0.5)*u_plateFit + 0.5; vec3 p = vec3(0.0);',
'    for (int i=0;i<12;i++){ float a = float(i)*2.39996; float r = 0.006 + 0.0035*sqrt(float(i));',
'      p += texture2D(u_plate, clamp(pc + vec2(cos(a), sin(a))*r, 0.0, 1.0)).rgb; }',
'    p = p/12.0; p = p*p;',                                                 /* to linear */
'    float lum = dot(p, vec3(0.3,0.59,0.11));',
'    col += mix(vec3(lum), p, 0.7)*vec3(0.75,0.86,1.1)*0.55 + cool*pow(lum, 3.0)*2.2;',
'  }',
'  float smoke = fbm(vec2(uv.x*1.2 + u_time*0.035, uv.y*1.0 - u_time*0.02));',
'  float smoke2 = fbm(vec2(uv.x*2.6 - u_time*0.05, uv.y*2.2 + 9.0));',
'  float lit = 0.0;',
'  for (int i=0;i<3;i++){ float fi = float(i) - 1.0;',
'    vec2 P = vec2(fi*0.52, 0.90 + 0.10*(1.0 - abs(fi)));',
'    vec2 d = uv - P;',
'    vec2 lg = vec2(d.x*26.0, d.y*52.0); vec2 lf = fract(lg) - 0.5;',
'    float lamps = smoothstep(0.36, 0.10, length(lf))*smoothstep(0.158, 0.150, abs(d.x))*smoothstep(0.041, 0.037, abs(d.y));',
'    float halo = exp(-dot(d,d)*9.0);',
'    vec2 aim = normalize(vec2(-fi*0.42 + 0.05*sin(u_time*0.12 + fi*2.0), -1.0));',
'    float along = dot(d, aim); float across = length(d - aim*along);',
'    float cone = smoothstep(0.0, 0.2, along)*exp(-pow(across/(0.04 + 0.26*along), 2.0))/(1.0 + 1.9*along);',
'    float beam = cone*(0.45 + 1.0*smoke)*(0.7 + 0.5*smoke2);',
'    col += cool*(lamps*9.0 + halo*0.05 + beam*0.3*(1.0 - 0.5*u_plateOn))*u_beam;',   /* the lamps are far over white: the bloom makes their glow */
'    lit += beam + halo*0.3;',
'  }',
'  if (u_plateOn < 0.5){',
'    float rim = -0.36 - 0.5*uv.x*uv.x;',
'    float below = smoothstep(rim + 0.012, rim - 0.012, uv.y);',
'    float crowd = 0.5 + 0.5*fbm(vec2(uv.x*70.0, (uv.y + 0.5*uv.x*uv.x)*110.0));',
'    float rows = 0.6 + 0.4*sin((uv.y + 0.5*uv.x*uv.x)*150.0);',
'    col = mix(col, vec3(0.007,0.009,0.017)*(0.35 + crowd*rows)*(1.0 + 9.0*lit*u_beam), below*0.93);',
'    col += cool*0.07*u_beam*exp(-abs(uv.y - rim)*120.0);',
'  }',
'  return col;',
'}',
'void main(){',
'  vec2 px = gl_FragCoord.xy;',
'  vec2 uv = (px/u_res*2.0 - 1.0)*vec2(u_res.x/u_res.y, 1.0);',
'  vec3 col = vec3(0.0);',
'  if (u_pil > 0.002) col += colonnade(px)*u_pil;',
'  if (u_stad > 0.002) col += stadium(uv, px/u_res)*u_stad;',
'  gl_FragColor = vec4(enc(col), 1.0);',
'}'].join('\n');

  var BRIGHT = [
'uniform sampler2D u_tex;',
'void main(){',
'  vec3 c = dec(texture2D(u_tex, gl_FragCoord.xy/u_res).rgb);',
'  float l = max(c.r, max(c.g, c.b)); float k = max(l - 0.75, 0.0); k = k*k/(k + 0.6);',   /* a soft knee, so the bloom has no hard edge */
'  gl_FragColor = vec4(enc(c*(k/max(l, 1e-4))), 1.0);',
'}'].join('\n');

  var FINAL = [
'uniform sampler2D u_scene, u_bloom, u_streak;',
'uniform float u_white, u_dim, u_frame;',
'void main(){',
'  vec2 px = gl_FragCoord.xy; vec2 st = px/u_res;',
'  vec2 uv = (st*2.0 - 1.0)*vec2(u_res.x/u_res.y, 1.0);',
'  vec3 col = dec(texture2D(u_scene, st).rgb);',
'  vec3 bloom = dec(texture2D(u_bloom, st).rgb), streak = dec(texture2D(u_streak, st).rgb);',
'  col += bloom*0.6 + mix(streak, vec3(dot(streak, vec3(0.33)))*vec3(0.6,0.75,1.0), 0.35)*0.5;',
'  col = clamp((col*(2.51*col + 0.03))/(col*(2.43*col + 0.59) + 0.14), 0.0, 1.0);',        /* filmic tone curve */
'  col = mix(col, vec3(1.0,0.96,0.88), u_white);',
'  col *= u_dim;',
'  col *= clamp(1.0 - 0.42*dot(uv*vec2(1.0,0.72), uv*vec2(1.0,0.72)), 0.0, 1.0);',
'  col = pow(col, vec3(1.0/1.04));',
'  float lum = dot(col, vec3(0.3,0.59,0.11));',
'  float g = hash12(px*0.71 + u_frame*17.3) + hash12(px*0.37 + 41.0 + u_frame*9.1) - 1.0;',     /* fine grain at device resolution, triangular */
'  col += g*(0.012 + 0.02*(1.0 - lum))*step(0.004, u_dim);',
'  col += (hash12(px + 7.0) + hash12(px + 91.0) - 1.0)/255.0;',                                 /* dither: under one 8-bit step, kills banding */
'  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);',
'}'].join('\n');

  var gl = null, cv = null, isGL2 = false, fmt = null, P = {}, tg = {}, W = 0, H = 0, sW = 0, sH = 0;
  var scale = 1, lockScale = 0, dprOverride = 0, ema = 16.7, slow = 0, fast = 0, lastT = 0, plate = null, plateTex = null;

  function compile(type, src) {
    var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('[teaser atmos]', gl.getShaderInfoLog(s)); return null; }
    return s;
  }
  function program(frag) {
    var p = gl.createProgram(), v = compile(gl.VERTEX_SHADER, VERT), f = compile(gl.FRAGMENT_SHADER, frag);
    if (!v || !f) return null;
    gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { console.error('[teaser atmos] link', gl.getProgramInfoLog(p)); return null; }
    return { p: p, u: {} };
  }
  function U(pr, name) { return pr.u[name] !== undefined ? pr.u[name] : (pr.u[name] = gl.getUniformLocation(pr.p, name)); }
  function set(pr, o) {
    gl.useProgram(pr.p);
    for (var k in o) { var v = o[k], loc = U(pr, k); if (loc === null) continue;
      if (typeof v === 'number') gl.uniform1f(loc, v); else if (v.length === 2) gl.uniform2f(loc, v[0], v[1]); else if (v.length === 3) gl.uniform3f(loc, v[0], v[1], v[2]); }
  }
  function tex(pr, name, unit, texture) { gl.useProgram(pr.p); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, texture); gl.uniform1i(U(pr, name), unit); }
  function pickFormat() {
    if (isGL2) { if (gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float')) return { internal: gl.RGBA16F, type: gl.HALF_FLOAT, hdr: true }; }
    else { var hf = gl.getExtension('OES_texture_half_float'); if (hf && gl.getExtension('OES_texture_half_float_linear') && gl.getExtension('EXT_color_buffer_half_float')) return { internal: gl.RGBA, type: hf.HALF_FLOAT_OES, hdr: true }; }
    return { internal: gl.RGBA, type: gl.UNSIGNED_BYTE, hdr: false };
  }
  function target(w, h, f) {
    var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, f.internal, w, h, 0, gl.RGBA, f.type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    var fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex: t, fb: fb, w: w, h: h, ok: ok };
  }
  function drop(t) { if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); } }
  function build() {
    var defs = fmt.hdr ? '' : '#define HDR8\n';
    P.fog = program(defs + COMMON + '\n' + FOG); P.scene = program(defs + COMMON + '\n' + SCENE);
    P.bright = program(defs + COMMON + '\n' + BRIGHT); P.fin = program(defs + COMMON + '\n' + FINAL); P.blur = program(BLUR);
    return !!(P.fog && P.scene && P.bright && P.fin && P.blur);
  }
  function sizeTargets() {
    var w = Math.max(2, Math.round(W*scale)), h = Math.max(2, Math.round(H*scale));
    if (w === sW && h === sH && tg.scene) return;
    sW = w; sH = h;
    ['scene', 'fogA', 'fogB', 'bloomA', 'bloomB', 'streak'].forEach(function (k) { drop(tg[k]); });
    var hw = Math.max(2, w >> 1), hh = Math.max(2, h >> 1), qw = Math.max(2, w >> 2), qh = Math.max(2, h >> 2);
    tg.scene = target(w, h, fmt); tg.fogA = target(hw, hh, fmt); tg.fogB = target(hw, hh, fmt);
    tg.bloomA = target(qw, qh, fmt); tg.bloomB = target(qw, qh, fmt); tg.streak = target(qw, qh, fmt);
  }
  function resize() {
    var r = cv.getBoundingClientRect(), dpr = dprOverride || Math.min(window.devicePixelRatio || 1, 3);
    var w = Math.max(2, Math.round(Math.min(r.width*dpr, 1290))), h = Math.max(2, Math.round(w*r.height/Math.max(r.width, 1)));
    if (w === W && h === H) return;
    W = w; H = h; cv.width = w; cv.height = h;
    if (!lockScale) scale = Math.min(1, 900/w);          /* the scene never needs more than about 900 px across; the final pass is full size */
    sizeTargets();
  }
  function pass(pr, t) { gl.bindFramebuffer(gl.FRAMEBUFFER, t ? t.fb : null); gl.viewport(0, 0, t ? t.w : W, t ? t.h : H); gl.useProgram(pr.p); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
  function blur(src, tmp, radius, edge) {
    set(P.blur, { u_res: [tmp.w, tmp.h], u_dir: [radius/tmp.w, 0], u_edge: edge }); tex(P.blur, 'u_tex', 0, src.tex); pass(P.blur, tmp);
    set(P.blur, { u_res: [src.w, src.h], u_dir: [0, radius/src.h], u_edge: edge }); tex(P.blur, 'u_tex', 0, tmp.tex); pass(P.blur, src);
  }
  /* hold the frame rate: lower the scene's resolution when frames run long, raise it back when there is room */
  function adapt(now) {
    if (lockScale) { scale = lockScale; return; }
    var dt = lastT ? (now - lastT)*1000 : 16.7; lastT = now;
    if (dt > 250) return;                                  /* a pause or a hidden tab, not a slow frame */
    ema = ema*0.9 + dt*0.1;
    if (ema > 24) { slow++; fast = 0; } else if (ema < 18) { fast++; slow = 0; } else { slow = 0; fast = 0; }
    if (slow > 40 && scale > 0.45) { scale = Math.max(0.45, scale*0.85); slow = 0; sizeTargets(); }
    if (fast > 360 && scale < Math.min(1, 900/W)) { scale = Math.min(Math.min(1, 900/W), scale*1.12); fast = 0; sizeTargets(); }
  }

  T.atmos = {
    init: function (canvas, opts) {
      opts = opts || {};
      cv = canvas; dprOverride = opts.dpr || 0; lockScale = opts.lock || 0;
      var attrs = { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' };
      gl = cv.getContext('webgl2', attrs); isGL2 = !!gl;
      if (!gl) gl = cv.getContext('webgl', attrs) || cv.getContext('experimental-webgl', attrs);
      if (!gl) return false;
      fmt = pickFormat();
      if (fmt.hdr && !target(4, 4, fmt).ok) fmt = { internal: gl.RGBA, type: gl.UNSIGNED_BYTE, hdr: false };   /* promised but refused: pack into 8 bits instead */
      if (!build()) return false;
      var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      window.addEventListener('resize', resize); resize();
      return true;
    },
    /* a muted, inline, playing <video>: the stadium plate. Uploaded as a texture each frame while it has data. */
    setPlate: function (video) {
      plate = video; if (!gl || !video) return;
      plateTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, plateTex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    },
    lock: function (s) { lockScale = s || 0; if (lockScale && gl) { scale = lockScale; sizeTargets(); } },
    info: function () { return { scale: scale, ms: ema, w: W, h: H, hdr: !!(fmt && fmt.hdr), gl2: isGL2 }; },
    /* p: { pil, stad, white, dim, lx, gain, red, beam, cam:[x,y,z], look:[yaw,pitch] } */
    render: function (p, time) {
      if (!gl) return;
      resize(); adapt(time);
      var tm = time % 1000, cam = p.cam || [-1.3, 1.1, -10], look = p.look || [0, 0.1];
      var pil = p.pil || 0, stad = p.stad || 0;
      var common = { u_time: tm, u_lx: p.lx == null ? 0.3 : p.lx, u_gain: p.gain == null ? 1 : p.gain, u_red: p.red || 0, u_cam: cam, u_look: look };
      if (pil > 0.002) {
        common.u_res = [tg.fogA.w, tg.fogA.h]; set(P.fog, common); pass(P.fog, tg.fogA);
        blur(tg.fogA, tg.fogB, 1.3, 9.0);
      }
      var plateOn = 0, fit = [1, 1];
      if (stad > 0.002 && plate && plateTex && plate.readyState >= 2 && plate.videoWidth) {
        try {
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, plateTex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, plate); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          plateOn = 1;
          var va = plate.videoWidth/plate.videoHeight, sa = sW/sH;      /* cover: crop the plate to the stage */
          fit = va > sa ? [sa/va, 1] : [1, va/sa];
        } catch (e) { plateOn = 0; }
      }
      common.u_res = [sW, sH]; common.u_pil = pil; common.u_stad = stad; common.u_beam = p.beam == null ? 1 : p.beam; common.u_plateOn = plateOn; common.u_plateFit = fit;
      set(P.scene, common); tex(P.scene, 'u_fog', 0, tg.fogA.tex); if (plateTex) tex(P.scene, 'u_plate', 1, plateTex); pass(P.scene, tg.scene);
      set(P.bright, { u_res: [tg.bloomA.w, tg.bloomA.h] }); tex(P.bright, 'u_tex', 0, tg.scene.tex); pass(P.bright, tg.bloomA);
      blur(tg.bloomA, tg.bloomB, 1.6, 0); blur(tg.bloomA, tg.bloomB, 3.2, 0);
      /* the streak: the bloom smeared sideways only, twice, very wide */
      set(P.blur, { u_res: [tg.bloomB.w, tg.bloomB.h], u_dir: [7/tg.bloomB.w, 0], u_edge: 0 }); tex(P.blur, 'u_tex', 0, tg.bloomA.tex); pass(P.blur, tg.bloomB);
      set(P.blur, { u_res: [tg.streak.w, tg.streak.h], u_dir: [19/tg.streak.w, 0], u_edge: 0 }); tex(P.blur, 'u_tex', 0, tg.bloomB.tex); pass(P.blur, tg.streak);
      set(P.fin, { u_res: [W, H], u_time: tm, u_white: p.white || 0, u_dim: p.dim == null ? 1 : p.dim, u_frame: Math.floor(tm*24)%997 });
      tex(P.fin, 'u_scene', 0, tg.scene.tex); tex(P.fin, 'u_bloom', 1, tg.bloomA.tex); tex(P.fin, 'u_streak', 2, tg.streak.tex); pass(P.fin, null);
    }
  };
})(window.TEASER);
