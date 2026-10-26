/*
 * Procedurally drawn anime-style live wallpapers.
 *
 * Each scene paints its static backdrop once into an offscreen canvas and
 * only animates light-weight particles per frame, so it stays smooth on a
 * modest TV processor. All artwork is generated here: no copyrighted assets.
 */
(function () {
  'use strict';

  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function canvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  function vgrad(ctx, y0, y1, stops) {
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }

  function glow(ctx, x, y, r, color, alpha) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = 1;
  }

  // Smooth ridge line built from layered sine waves.
  function ridge(ctx, w, h, base, amp, seed, color, freq) {
    var r = rng(seed);
    var p1 = r() * 10, p2 = r() * 10, p3 = r() * 10;
    var f = freq || 1;
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (var x = 0; x <= w; x += 8) {
      var u = x / w;
      var y = base
        - Math.sin(u * 3.1 * f + p1) * amp * 0.5
        - Math.sin(u * 7.3 * f + p2) * amp * 0.3
        - Math.sin(u * 17.9 * f + p3) * amp * 0.12;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function pine(ctx, x, base, hgt, color, snow) {
    var wdt = hgt * 0.42;
    ctx.fillStyle = color;
    for (var i = 0; i < 3; i++) {
      var top = base - hgt + i * hgt * 0.22;
      var bot = base - hgt * 0.15 * (2 - i) ;
      var half = wdt * (0.55 + i * 0.25) / 2;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x - half, bot);
      ctx.lineTo(x + half, bot);
      ctx.closePath();
      ctx.fill();
      if (snow) {
        ctx.fillStyle = snow;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x - half * 0.45, top + (bot - top) * 0.45);
        ctx.lineTo(x + half * 0.2, top + (bot - top) * 0.35);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = color;
      }
    }
    ctx.fillRect(x - hgt * 0.025, base - hgt * 0.16, hgt * 0.05, hgt * 0.16);
  }

  /* ------------------------------------------------------------------ */
  /* Sakura Dusk: Mt Fuji at sunset, torii gate, falling cherry petals   */
  /* ------------------------------------------------------------------ */
  var sakura = {
    id: 'sakura', name: 'Sakura Dusk',
    init: function (w, h) {
      var bg = canvas(w, h), c = bg.getContext('2d'), r = rng(7);

      c.fillStyle = vgrad(c, 0, h * 0.72, [
        [0, '#241640'], [0.35, '#6b2f6e'], [0.62, '#d2627a'], [0.85, '#f79c7c'], [1, '#ffd2a1']
      ]);
      c.fillRect(0, 0, w, h);

      // Sun and its haze
      var sunX = w * 0.74, sunY = h * 0.6;
      glow(c, sunX, sunY, h * 0.55, 'rgba(255,190,150,0.55)');
      glow(c, sunX, sunY, h * 0.11, 'rgba(255,246,220,1)');
      c.fillStyle = '#fff3dc';
      c.beginPath(); c.arc(sunX, sunY, h * 0.065, 0, Math.PI * 2); c.fill();

      // Streaky clouds
      for (var i = 0; i < 9; i++) {
        var cy = h * (0.12 + r() * 0.38), cx = r() * w, cw = w * (0.15 + r() * 0.3);
        c.fillStyle = 'rgba(255,' + (150 + (r() * 60 | 0)) + ',170,' + (0.10 + r() * 0.12) + ')';
        c.beginPath(); c.ellipse(cx, cy, cw / 2, h * (0.006 + r() * 0.012), 0, 0, Math.PI * 2); c.fill();
      }

      // Mt Fuji
      var bx = w * 0.5, peak = h * 0.3, foot = h * 0.72;
      c.beginPath();
      c.moveTo(w * 0.08, foot);
      c.quadraticCurveTo(w * 0.36, h * 0.52, bx - w * 0.05, peak);
      c.lineTo(bx + w * 0.05, peak);
      c.quadraticCurveTo(w * 0.64, h * 0.52, w * 0.92, foot);
      c.closePath();
      c.fillStyle = vgrad(c, peak, foot, [[0, '#6c4a86'], [1, '#3e2a59']]);
      c.fill();
      c.save();
      c.clip();
      // Snow cap with a jagged edge
      c.beginPath();
      c.moveTo(bx - w * 0.05, peak);
      c.lineTo(bx + w * 0.05, peak);
      var sx = bx + w * 0.105, sy = h * 0.4;
      c.quadraticCurveTo(bx + w * 0.08, h * 0.36, sx, sy);
      for (var k = 0; k <= 10; k++) {
        var t = k / 10;
        c.lineTo(sx - t * w * 0.21, sy + (k % 2 ? -h * 0.025 : h * 0.012) + Math.sin(t * 9) * h * 0.01);
      }
      c.quadraticCurveTo(bx - w * 0.08, h * 0.36, bx - w * 0.05, peak);
      c.closePath();
      c.fillStyle = vgrad(c, peak, sy, [[0, '#fff4f6'], [1, '#e9c6dc']]);
      c.fill();
      c.restore();

      // Lake reflecting the sky
      c.fillStyle = vgrad(c, h * 0.72, h, [[0, '#e88f86'], [0.4, '#7c3c6e'], [1, '#2a1838']]);
      c.fillRect(0, h * 0.72, w, h * 0.28);
      c.globalAlpha = 0.35;
      c.fillStyle = '#fff1d6';
      for (var j = 0; j < 26; j++) {
        var ly = h * 0.735 + j * h * 0.009, lw = w * (0.12 - j * 0.0035) * (0.6 + r() * 0.6);
        c.fillRect(sunX - lw / 2 + (r() - 0.5) * w * 0.02, ly, lw, h * 0.0025);
      }
      c.globalAlpha = 1;

      // Hills
      ridge(c, w, h, h * 0.75, h * 0.05, 3, '#3a2148');
      ridge(c, w, h, h * 0.84, h * 0.07, 11, '#24142f', 1.4);

      // Torii gate on the right shore
      var tx = w * 0.2, tb = h * 0.88, th = h * 0.24, tw = w * 0.11;
      c.fillStyle = '#140a18';
      c.fillRect(tx - tw * 0.36, tb - th, tw * 0.07, th);
      c.fillRect(tx + tw * 0.29, tb - th, tw * 0.07, th);
      c.fillRect(tx - tw * 0.46, tb - th * 0.8, tw * 0.92, th * 0.06);
      c.beginPath();
      c.moveTo(tx - tw * 0.62, tb - th * 1.02);
      c.quadraticCurveTo(tx, tb - th * 0.94, tx + tw * 0.62, tb - th * 1.02);
      c.lineTo(tx + tw * 0.58, tb - th * 0.92);
      c.quadraticCurveTo(tx, tb - th * 0.86, tx - tw * 0.58, tb - th * 0.92);
      c.closePath(); c.fill();
      c.fillRect(tx - tw * 0.03, tb - th * 0.92, tw * 0.06, th * 0.13);

      // Cherry branch from the top-left corner
      var blossoms = [];
      function branch(x, y, ang, len, wdt, depth) {
        var x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
        c.strokeStyle = '#1c0f1c'; c.lineWidth = wdt; c.lineCap = 'round';
        c.beginPath(); c.moveTo(x, y);
        c.quadraticCurveTo((x + x2) / 2 + (r() - 0.5) * len * 0.3, (y + y2) / 2 + (r() - 0.5) * len * 0.3, x2, y2);
        c.stroke();
        if (depth > 0) {
          branch(x2, y2, ang + 0.25 + r() * 0.35, len * (0.62 + r() * 0.15), wdt * 0.62, depth - 1);
          branch(x2, y2, ang - 0.3 - r() * 0.35, len * (0.55 + r() * 0.15), wdt * 0.6, depth - 1);
        }
        if (depth < 3) blossoms.push([x2, y2, len]);
      }
      branch(-w * 0.02, h * 0.06, 0.35, w * 0.17, h * 0.022, 5);
      for (var b = 0; b < blossoms.length; b++) {
        var bl = blossoms[b], n = 10 + (r() * 10 | 0);
        for (var q = 0; q < n; q++) {
          var px = bl[0] + (r() - 0.5) * bl[2] * 0.9, py = bl[1] + (r() - 0.5) * bl[2] * 0.7;
          var pr = h * (0.006 + r() * 0.01);
          c.fillStyle = ['#ffd3e1', '#f6a9c3', '#ffe6ee', '#e98bb0'][r() * 4 | 0];
          c.globalAlpha = 0.85 + r() * 0.15;
          c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.fill();
        }
      }
      c.globalAlpha = 1;

      var petals = [], pr2 = rng(99);
      for (var p = 0; p < 70; p++) {
        petals.push({
          x: pr2() * w, y: pr2() * h, s: h * (0.005 + pr2() * 0.008),
          vx: w * (0.012 + pr2() * 0.02), vy: h * (0.03 + pr2() * 0.04),
          rot: pr2() * 6.28, vr: (pr2() - 0.5) * 2, ph: pr2() * 6.28
        });
      }
      return { bg: bg, petals: petals };
    },
    draw: function (ctx, st, w, h, t, dt) {
      for (var i = 0; i < st.petals.length; i++) {
        var p = st.petals[i];
        p.x += (p.vx + Math.sin(t * 0.8 + p.ph) * w * 0.01) * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y > h + 20 || p.x > w + 20) { p.y = -20; p.x = Math.random() * w * 0.9 - w * 0.1; }
        ctx.save();
        ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.scale(1, 0.55 + Math.sin(t * 2 + p.ph) * 0.35);
        ctx.fillStyle = '#ffc2d6';
        ctx.beginPath(); ctx.ellipse(0, 0, p.s, p.s * 0.62, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(232,120,160,0.6)';
        ctx.beginPath(); ctx.ellipse(p.s * 0.25, 0, p.s * 0.45, p.s * 0.3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Neon Rain: rainy Tokyo night from a rooftop, flickering signs       */
  /* ------------------------------------------------------------------ */
  var neon = {
    id: 'neon', name: 'Neon Rain',
    init: function (w, h) {
      var bg = canvas(w, h), c = bg.getContext('2d'), r = rng(21);
      c.fillStyle = vgrad(c, 0, h, [[0, '#05061a'], [0.45, '#170f3c'], [0.75, '#3a1d5c'], [1, '#12091f']]);
      c.fillRect(0, 0, w, h);
      glow(c, w * 0.5, h * 0.8, w * 0.6, 'rgba(255,60,160,0.18)');

      function skyline(base, minH, maxH, color, winP, seed) {
        var rr = rng(seed), x = -10;
        while (x < w) {
          var bw = w * (0.03 + rr() * 0.05), bh = h * (minH + rr() * (maxH - minH));
          c.fillStyle = color;
          c.fillRect(x, base - bh, bw, bh + h);
          if (rr() < 0.3) c.fillRect(x + bw * 0.45, base - bh - h * 0.04, bw * 0.06, h * 0.04);
          for (var wy = base - bh + h * 0.015; wy < base - h * 0.01; wy += h * 0.022) {
            for (var wx = x + bw * 0.12; wx < x + bw - bw * 0.15; wx += bw * 0.16) {
              if (rr() < winP) {
                c.fillStyle = ['rgba(255,210,130,0.85)', 'rgba(150,215,255,0.7)', 'rgba(255,170,220,0.6)'][rr() * 3 | 0];
                c.fillRect(wx, wy, bw * 0.08, h * 0.009);
              }
            }
          }
          x += bw + w * 0.004;
        }
      }
      skyline(h * 0.78, 0.15, 0.4, '#16153a', 0.12, 4);
      skyline(h * 0.86, 0.2, 0.55, '#0b0b22', 0.2, 9);

      // Rooftop ledge and a utility pole with sagging wires
      c.fillStyle = '#05050d';
      c.fillRect(0, h * 0.9, w, h * 0.1);
      c.fillRect(0, h * 0.875, w, h * 0.012);
      for (var px = 0; px < w; px += w * 0.04) c.fillRect(px, h * 0.835, w * 0.004, h * 0.05);
      c.fillRect(0, h * 0.832, w, h * 0.006);
      var pole = w * 0.1;
      c.fillRect(pole, h * 0.08, w * 0.012, h * 0.9);
      c.fillRect(pole - w * 0.04, h * 0.14, w * 0.092, h * 0.008);
      c.fillRect(pole - w * 0.03, h * 0.2, w * 0.072, h * 0.006);
      c.strokeStyle = 'rgba(0,0,0,0.85)'; c.lineWidth = Math.max(1.5, h * 0.0016);
      [[h * 0.145, 0.18], [h * 0.15, 0.24], [h * 0.205, 0.3]].forEach(function (wire) {
        c.beginPath(); c.moveTo(pole + w * 0.045, wire[0]);
        c.quadraticCurveTo(w * 0.6, wire[0] + h * wire[1], w * 1.05, wire[0] + h * 0.05);
        c.stroke();
      });

      // Wet-roof reflection
      c.fillStyle = vgrad(c, h * 0.9, h, [[0, 'rgba(255,60,160,0.12)'], [1, 'rgba(60,240,255,0.05)']]);
      c.fillRect(0, h * 0.9, w, h * 0.1);

      var signs = [];
      for (var s = 0; s < 7; s++) {
        signs.push({
          x: w * (0.06 + s * 0.12 + r() * 0.05), y: h * (0.42 + r() * 0.2),
          w: w * (0.012 + r() * 0.01), h: h * (0.09 + r() * 0.12),
          color: ['#ff3d9a', '#3df2ff', '#ffcf3d', '#9d6bff'][r() * 4 | 0],
          flick: r() < 0.35, ph: r() * 10, glyphs: []
        });
        var sg = signs[signs.length - 1], count = 2 + (r() * 3 | 0);
        for (var gi = 0; gi < count; gi++) {
          var strokes = [];
          strokes.push([0.15, 0.2, 0.85, 0.2]);
          var n = 2 + (r() * 3 | 0);
          for (var si = 0; si < n; si++) {
            if (r() < 0.5) { var yy = 0.3 + r() * 0.6; strokes.push([0.1 + r() * 0.2, yy, 0.7 + r() * 0.2, yy]); }
            else { var xx = 0.2 + r() * 0.6; strokes.push([xx, 0.15 + r() * 0.3, xx + (r() - 0.5) * 0.3, 0.6 + r() * 0.35]); }
          }
          sg.glyphs.push(strokes);
        }
      }
      var drops = [], dr = rng(5);
      for (var d = 0; d < 260; d++) drops.push({ x: dr() * w, y: dr() * h, l: h * (0.02 + dr() * 0.04), v: h * (1.2 + dr() * 0.8), a: 0.15 + dr() * 0.3 });
      var lights = [];
      for (var li = 0; li < 6; li++) lights.push({ x: r() * w * 0.8, y: h * (0.35 + r() * 0.25), ph: r() * 6 });
      return { bg: bg, signs: signs, drops: drops, lights: lights, flash: 0, nextFlash: 25 + Math.random() * 40 };
    },
    draw: function (ctx, st, w, h, t, dt) {
      for (var i = 0; i < st.signs.length; i++) {
        var s = st.signs[i];
        var on = !s.flick || Math.sin(t * 7 + s.ph) > -0.85 || Math.sin(t * 23 + s.ph) > 0.2;
        ctx.globalAlpha = on ? 1 : 0.25;
        ctx.shadowColor = s.color; ctx.shadowBlur = h * 0.02;
        ctx.strokeStyle = s.color; ctx.lineWidth = Math.max(2, h * 0.0028);
        ctx.strokeRect(s.x, s.y, s.w, s.h);
        var cell = s.h / s.glyphs.length;
        ctx.beginPath();
        for (var g = 0; g < s.glyphs.length; g++) {
          var gy = s.y + g * cell, pad = s.w * 0.18, gw = s.w - pad * 2, gh = Math.min(cell, s.w) - pad;
          var oy = gy + (cell - gh) / 2;
          for (var k = 0; k < s.glyphs[g].length; k++) {
            var st2 = s.glyphs[g][k];
            ctx.moveTo(s.x + pad + st2[0] * gw, oy + st2[1] * gh);
            ctx.lineTo(s.x + pad + st2[2] * gw, oy + st2[3] * gh);
          }
        }
        ctx.stroke();
      }
      ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      for (var l = 0; l < st.lights.length; l++) {
        var lt = st.lights[l];
        if (Math.sin(t * 2 + lt.ph) > 0.4) glow(ctx, lt.x, lt.y, h * 0.008, 'rgba(255,40,40,1)');
      }
      ctx.strokeStyle = 'rgba(180,210,255,1)';
      ctx.lineWidth = Math.max(1, h * 0.0012);
      ctx.beginPath();
      for (var d = 0; d < st.drops.length; d++) {
        var p = st.drops[d];
        p.y += p.v * dt; p.x -= p.v * 0.12 * dt;
        if (p.y > h) { p.y = -p.l; p.x = Math.random() * w * 1.1; }
        ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.l * 0.12, p.y + p.l);
      }
      ctx.globalAlpha = 0.28; ctx.stroke(); ctx.globalAlpha = 1;
      st.nextFlash -= dt;
      if (st.nextFlash < 0) { st.flash = 1; st.nextFlash = 30 + Math.random() * 60; }
      if (st.flash > 0) {
        ctx.fillStyle = 'rgba(200,210,255,' + (st.flash * 0.25) + ')';
        ctx.fillRect(0, 0, w, h);
        st.flash -= dt * 3;
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Firefly Shrine: summer night lake, milky way, fireflies             */
  /* ------------------------------------------------------------------ */
  var firefly = {
    id: 'firefly', name: 'Firefly Shrine',
    init: function (w, h) {
      var bg = canvas(w, h), c = bg.getContext('2d'), r = rng(42);
      c.fillStyle = vgrad(c, 0, h * 0.68, [[0, '#03061a'], [0.6, '#0b1c40'], [1, '#1d4468']]);
      c.fillRect(0, 0, w, h);

      // Milky way: soft band plus dense star dust
      c.save();
      c.translate(w * 0.5, h * 0.3); c.rotate(-0.5);
      var band = c.createLinearGradient(0, -h * 0.12, 0, h * 0.12);
      band.addColorStop(0, 'rgba(120,140,220,0)');
      band.addColorStop(0.5, 'rgba(170,180,255,0.16)');
      band.addColorStop(1, 'rgba(120,140,220,0)');
      c.fillStyle = band; c.fillRect(-w, -h * 0.12, w * 2, h * 0.24);
      for (var i = 0; i < 1400; i++) {
        var gx = (r() - 0.5) * w * 1.8, gy = (r() + r() + r() - 1.5) * h * 0.09;
        c.fillStyle = 'rgba(230,235,255,' + (0.15 + r() * 0.5) + ')';
        c.fillRect(gx, gy, 1.2, 1.2);
      }
      c.restore();
      for (var s = 0; s < 500; s++) {
        var sx = r() * w, sy = r() * h * 0.66, sr = r() < 0.06 ? 2.2 : 1.1;
        c.fillStyle = 'rgba(255,255,255,' + (0.3 + r() * 0.7) + ')';
        c.fillRect(sx, sy, sr, sr);
      }

      // Crescent moon
      var mx = w * 0.8, my = h * 0.17, mr = h * 0.045;
      glow(c, mx, my, mr * 6, 'rgba(255,240,200,0.18)');
      var mc = canvas(Math.ceil(mr * 3), Math.ceil(mr * 3)), m = mc.getContext('2d');
      m.fillStyle = '#fff4d6';
      m.beginPath(); m.arc(mr * 1.5, mr * 1.5, mr, 0, Math.PI * 2); m.fill();
      m.globalCompositeOperation = 'destination-out';
      m.beginPath(); m.arc(mr * 1.95, mr * 1.25, mr * 0.88, 0, Math.PI * 2); m.fill();
      c.drawImage(mc, mx - mr * 1.5, my - mr * 1.5);

      // Mountains and the lake (mirror of the sky)
      ridge(c, w, h, h * 0.62, h * 0.12, 8, '#0b1834', 0.8);
      ridge(c, w, h, h * 0.67, h * 0.06, 15, '#081228', 1.6);
      c.save();
      c.translate(0, h * 1.36); c.scale(1, -1);
      c.globalAlpha = 0.35;
      c.drawImage(bg, 0, 0, w, h * 0.68, 0, 0, w, h * 0.68);
      c.restore();
      c.globalAlpha = 1;
      c.fillStyle = vgrad(c, h * 0.68, h, [[0, 'rgba(8,20,45,0.55)'], [1, 'rgba(2,5,15,0.95)']]);
      c.fillRect(0, h * 0.68, w, h * 0.32);

      // Shoreline forests
      for (var tL = 0; tL < 22; tL++) pine(c, w * (tL * 0.016) + r() * 10, h * 0.7, h * (0.12 + r() * 0.12), '#030a17');
      for (var tR = 0; tR < 16; tR++) pine(c, w * (0.72 + tR * 0.018) + r() * 10, h * 0.69, h * (0.08 + r() * 0.1), '#030a17');

      // Small shrine across the lake with a warm window
      var shx = w * 0.6, shy = h * 0.685;
      c.fillStyle = '#040b18';
      c.fillRect(shx - w * 0.025, shy - h * 0.035, w * 0.05, h * 0.035);
      c.beginPath(); c.moveTo(shx - w * 0.035, shy - h * 0.033); c.lineTo(shx, shy - h * 0.06); c.lineTo(shx + w * 0.035, shy - h * 0.033); c.closePath(); c.fill();
      c.fillStyle = '#ffb35c'; c.fillRect(shx - w * 0.006, shy - h * 0.024, w * 0.012, h * 0.016);
      glow(c, shx, shy - h * 0.016, h * 0.05, 'rgba(255,170,80,0.35)');
      c.globalAlpha = 0.3; c.fillStyle = '#ffb35c';
      for (var rf = 0; rf < 14; rf++) c.fillRect(shx - w * 0.008 + (r() - 0.5) * 8, shy + h * 0.006 + rf * h * 0.008, w * 0.016 * (1 - rf / 16), h * 0.002);
      c.globalAlpha = 1;

      // Stone lantern in the foreground
      var lx = w * 0.12, lb = h * 0.97;
      c.fillStyle = '#02060f';
      c.fillRect(lx - w * 0.03, lb - h * 0.03, w * 0.06, h * 0.03);
      c.fillRect(lx - w * 0.008, lb - h * 0.17, w * 0.016, h * 0.14);
      c.fillRect(lx - w * 0.028, lb - h * 0.2, w * 0.056, h * 0.03);
      c.fillRect(lx - w * 0.02, lb - h * 0.27, w * 0.04, h * 0.07);
      c.beginPath(); c.moveTo(lx - w * 0.045, lb - h * 0.27); c.lineTo(lx, lb - h * 0.33); c.lineTo(lx + w * 0.045, lb - h * 0.27); c.closePath(); c.fill();
      c.fillStyle = '#ffcf7a'; c.fillRect(lx - w * 0.009, lb - h * 0.255, w * 0.018, h * 0.04);
      glow(c, lx, lb - h * 0.235, h * 0.09, 'rgba(255,200,110,0.3)');
      ridge(c, w, h, h * 0.985, h * 0.02, 33, '#010309', 3);

      var flies = [], fr = rng(77);
      for (var f = 0; f < 45; f++) flies.push({ x: fr() * w, y: h * (0.55 + fr() * 0.42), ph: fr() * 6.28, sp: 0.3 + fr() * 0.7, s: h * (0.003 + fr() * 0.004) });
      var tw = [], twr = rng(3);
      for (var k = 0; k < 40; k++) tw.push({ x: twr() * w, y: twr() * h * 0.6, ph: twr() * 6.28 });
      return { bg: bg, flies: flies, tw: tw, moonX: mx, star: null, nextStar: 8 + Math.random() * 15 };
    },
    draw: function (ctx, st, w, h, t, dt) {
      for (var k = 0; k < st.tw.length; k++) {
        var s = st.tw[k], a = 0.5 + 0.5 * Math.sin(t * 2.2 + s.ph);
        ctx.fillStyle = 'rgba(255,255,255,' + a + ')';
        ctx.fillRect(s.x, s.y, 2, 2);
      }
      ctx.fillStyle = 'rgba(255,240,200,0.35)';
      for (var m = 0; m < 10; m++) {
        var my = h * (0.71 + m * 0.02), wv = Math.sin(t * 1.5 + m) * w * 0.006;
        ctx.fillRect(st.moonX - w * 0.012 + wv, my, w * (0.024 - m * 0.0015), 2);
      }
      for (var i = 0; i < st.flies.length; i++) {
        var f = st.flies[i];
        f.x += Math.cos(t * f.sp + f.ph) * w * 0.01 * dt;
        f.y += Math.sin(t * f.sp * 1.3 + f.ph) * h * 0.012 * dt;
        var b = Math.max(0, Math.sin(t * (1 + f.sp) + f.ph * 3));
        if (b > 0.05) {
          glow(ctx, f.x, f.y, f.s * 6, 'rgba(210,255,110,0.9)', b * 0.6);
          ctx.fillStyle = 'rgba(245,255,190,' + b + ')';
          ctx.beginPath(); ctx.arc(f.x, f.y, f.s * 0.7, 0, Math.PI * 2); ctx.fill();
        }
      }
      st.nextStar -= dt;
      if (!st.star && st.nextStar < 0) {
        st.star = { x: w * (0.2 + Math.random() * 0.6), y: h * Math.random() * 0.25, life: 1 };
        st.nextStar = 15 + Math.random() * 25;
      }
      if (st.star) {
        var ss = st.star, len = w * 0.12;
        ss.x += w * 0.5 * dt; ss.y += h * 0.25 * dt; ss.life -= dt * 1.2;
        var g = ctx.createLinearGradient(ss.x, ss.y, ss.x - len, ss.y - len * 0.5);
        g.addColorStop(0, 'rgba(255,255,255,' + Math.max(0, ss.life) + ')');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = g; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(ss.x, ss.y); ctx.lineTo(ss.x - len, ss.y - len * 0.5); ctx.stroke();
        if (ss.life <= 0) st.star = null;
      }
    }
  };

  /* ------------------------------------------------------------------ */
  /* Snowy Village: winter night, warm windows, falling snow             */
  /* ------------------------------------------------------------------ */
  var snow = {
    id: 'snow', name: 'Snowy Village',
    init: function (w, h) {
      var bg = canvas(w, h), c = bg.getContext('2d'), r = rng(64);
      c.fillStyle = vgrad(c, 0, h * 0.7, [[0, '#0b1230'], [0.55, '#25386a'], [1, '#7d8cbc']]);
      c.fillRect(0, 0, w, h);
      glow(c, w * 0.25, h * 0.15, h * 0.35, 'rgba(200,215,255,0.15)');
      c.fillStyle = '#eef3ff';
      c.beginPath(); c.arc(w * 0.25, h * 0.15, h * 0.04, 0, Math.PI * 2); c.fill();

      // Snowy mountain range with shaded faces
      ridge(c, w, h, h * 0.55, h * 0.22, 19, '#c6d0ea', 0.9);
      ridge(c, w, h, h * 0.58, h * 0.16, 23, 'rgba(110,130,185,0.55)', 1.1);
      ridge(c, w, h, h * 0.66, h * 0.07, 29, '#93a3cf', 1.5);

      // Snow ground
      c.fillStyle = vgrad(c, h * 0.7, h, [[0, '#cfd9f2'], [1, '#8796c2']]);
      c.beginPath(); c.moveTo(0, h * 0.74);
      c.quadraticCurveTo(w * 0.5, h * 0.68, w, h * 0.76);
      c.lineTo(w, h); c.lineTo(0, h); c.closePath(); c.fill();

      for (var tr = 0; tr < 18; tr++) pine(c, w * (0.02 + tr * 0.055) + r() * 30, h * (0.72 + r() * 0.02), h * (0.07 + r() * 0.06), '#1e2a4d', '#e3ebff');

      var windows = [];
      function house(x, base, hw, hh) {
        c.fillStyle = '#2b2440';
        c.fillRect(x - hw / 2, base - hh, hw, hh);
        c.fillStyle = '#3a2f4f';
        c.beginPath(); c.moveTo(x - hw * 0.68, base - hh); c.lineTo(x, base - hh * 2); c.lineTo(x + hw * 0.68, base - hh); c.closePath(); c.fill();
        c.fillStyle = '#f2f6ff';
        c.beginPath(); c.moveTo(x - hw * 0.7, base - hh); c.lineTo(x, base - hh * 2.04); c.lineTo(x + hw * 0.7, base - hh);
        c.lineTo(x + hw * 0.6, base - hh * 1.08); c.lineTo(x, base - hh * 1.86); c.lineTo(x - hw * 0.6, base - hh * 1.08); c.closePath(); c.fill();
        var n = hw > w * 0.07 ? 2 : 1;
        for (var i = 0; i < n; i++) {
          var wx = x - hw * 0.3 + i * hw * 0.45, wy = base - hh * 0.7;
          windows.push({ x: wx + hw * 0.075, y: wy + hh * 0.17, r: hh * 0.9, ph: Math.random() * 6 });
          c.fillStyle = '#ffbd66'; c.fillRect(wx, wy, hw * 0.15, hh * 0.34);
          c.fillStyle = '#2b2440'; c.fillRect(wx + hw * 0.07, wy, hw * 0.012, hh * 0.34);
        }
      }
      house(w * 0.3, h * 0.79, w * 0.08, h * 0.07);
      house(w * 0.42, h * 0.77, w * 0.06, h * 0.055);
      house(w * 0.55, h * 0.785, w * 0.09, h * 0.075);
      house(w * 0.68, h * 0.8, w * 0.065, h * 0.06);
      for (var g = 0; g < windows.length; g++) glow(c, windows[g].x, windows[g].y, windows[g].r, 'rgba(255,180,90,0.35)');

      var flakes = [], fr = rng(12);
      for (var f = 0; f < 200; f++) {
        var z = fr();
        flakes.push({ x: fr() * w, y: fr() * h, z: z, s: 1 + z * h * 0.004, v: h * (0.03 + z * 0.08), ph: fr() * 6.28 });
      }
      return { bg: bg, flakes: flakes, windows: windows };
    },
    draw: function (ctx, st, w, h, t, dt) {
      for (var i = 0; i < st.windows.length; i++) {
        var wd = st.windows[i];
        glow(ctx, wd.x, wd.y, wd.r * 0.6, 'rgba(255,190,100,0.5)', 0.15 + 0.1 * Math.sin(t * 3 + wd.ph));
      }
      ctx.fillStyle = '#ffffff';
      for (var j = 0; j < st.flakes.length; j++) {
        var f = st.flakes[j];
        f.y += f.v * dt;
        f.x += Math.sin(t * 0.7 + f.ph) * w * 0.006 * dt * (1 + f.z);
        if (f.y > h + 5) { f.y = -5; f.x = Math.random() * w; }
        ctx.globalAlpha = 0.45 + f.z * 0.5;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.s, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  };

  window.AmbientScenes = [sakura, neon, firefly, snow];
})();
