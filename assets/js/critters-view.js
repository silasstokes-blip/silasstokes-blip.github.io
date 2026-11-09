/*
  Renders a CrittersSim into a .viewport element.

  Expected markup (see index.html):
    <div class="viewport" data-critters data-speed="2">
      .vp-bar  with [data-act="pause"], [data-act="speed"], [data-act="reset"]
      .vp-stage with an <img> still as the at-rest frame
      .vp-legend li[data-sp="0..5"] .count
      canvas.vp-graph, [data-clock], [data-hunt]
*/
(function () {
  'use strict';
  var Sim = window.CrittersSim;
  if (!Sim) return;

  var GRASS = [77, 153, 76];
  var GRASS_ALPHA = [0, 65, 118, 189, 255];
  var COLORS = Sim.SPECIES.map(function (s) { return s.color; });
  var NAMES = ['Rabbits', 'Coyotes', 'Elk', 'Wolves', 'Mice', 'Ferrets'];
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function hexToRgb(h) { var n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  var RGB = COLORS.map(hexToRgb);
  function clock(frames) {
    var s = Math.max(0, Math.floor(frames / 60));
    return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2);
  }

  function mount(root) {
    var stage = root.querySelector('.vp-stage');
    var still = stage.querySelector('img');
    var canvas = document.createElement('canvas');
    canvas.setAttribute('role', 'img');
    var ctx = canvas.getContext('2d');
    var grassCanvas = document.createElement('canvas');
    var gctx, grassImg;
    var graph = root.querySelector('.vp-graph');
    var gr = graph ? graph.getContext('2d') : null;
    var counts = root.querySelectorAll('.vp-legend [data-sp]');
    var clockEl = root.querySelector('[data-clock]');
    var huntEl = root.querySelector('[data-hunt]');
    var toast = root.querySelector('.vp-toast');
    var pauseBtn = root.querySelector('[data-act="pause"]');
    var speedBtns = root.querySelectorAll('[data-act="speed"]');
    var resetBtn = root.querySelector('[data-act="reset"]');

    var particles = [];
    var sim = new Sim({
      preset: root.getAttribute('data-preset') || 'game',
      gameSpeed: parseInt(root.getAttribute('data-speed') || '2', 10),
      onEvent: function (type, x, y, sp) {
        var n = type === 'spear' ? 26 : type === 'eaten' ? 16 : 9;
        burst(x + 0.5, y + 0.5, sp, n, type === 'starved' ? 0.6 : 1);
      }
    });
    canvas.setAttribute('aria-label', 'Live simulation of grass, rabbits, mice, elk, ferrets, coyotes and wolves on a ' +
      sim.gridWidth + ' by ' + sim.gridHeight + ' grid. Hold the mouse button to spear critters.');
    var reach = sim.preset.spearReach;
    var pendingSpeed = null;
    var running = false, visible = true, userPaused = false, started = false;
    var acc = 0, last = 0, raf = 0;
    var W = 0, H = 0, cs = 1, dpr = 1;
    var strikeFx = null;
    var holding = false, holdX = 0, holdY = 0, holdKills = 0;
    var lastSamples = -1;
    var extinctAt = [null, null, null, null, null, null];
    var prevCounts = sim.counts();
    var toastTimer = 0;

    grassCanvas.width = sim.gridWidth;
    grassCanvas.height = sim.gridHeight;
    gctx = grassCanvas.getContext('2d');
    grassImg = gctx.createImageData(sim.gridWidth, sim.gridHeight);

    function burst(x, y, sp, n, power) {
      var c = RGB[sp];
      for (var i = 0; i < n; i++) {
        var a = Math.random() * Math.PI * 2;
        var v = (0.08 + Math.random() * 0.32) * power;
        var life = 5 + Math.random() * 22;
        particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life, max: life,
          r: (0.15 + Math.random() * 0.35) * (sp === 2 || sp === 3 ? 1.4 : 1), c: c, sq: false });
      }
    }
    function trail(x, y, sp) {
      var a = Math.random() * Math.PI * 2, v = 0.05 + Math.random() * 0.2, life = 20 + Math.random() * 40;
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: life, max: life, r: 0.12 + Math.random() * 0.2, c: RGB[sp], sq: true, a: 0.3 });
    }

    function resize() {
      var r = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = Math.max(1, Math.round(r.width * dpr));
      H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
      cs = W / sim.gridWidth;
      if (graph) {
        var g = graph.getBoundingClientRect();
        graph.width = Math.max(1, Math.round(g.width * dpr));
        graph.height = Math.max(1, Math.round(g.height * dpr));
        lastSamples = -1;
      }
      draw();
    }

    function drawGrass() {
      var d = grassImg.data, gw = sim.gridWidth, gh = sim.gridHeight, grid = sim.grid, i = 0;
      for (var y = 0; y < gh; y++) {
        for (var x = 0; x < gw; x++) {
          var a = GRASS_ALPHA[grid[x][y]] / 255;
          d[i] = GRASS[0] * a; d[i + 1] = GRASS[1] * a; d[i + 2] = GRASS[2] * a; d[i + 3] = 255;
          i += 4;
        }
      }
      gctx.putImageData(grassImg, 0, 0);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(grassCanvas, 0, 0, W, H);
    }

    function draw() {
      if (!W) return;
      drawGrass();
      var crea = sim.crea;
      for (var sp = 0; sp < 6; sp++) {
        ctx.fillStyle = COLORS[sp];
        for (var i = 0; i < crea.length; i++) {
          var c = crea[i];
          if (c.myType !== sp) continue;
          ctx.fillRect(c.myX * cs, c.myY * cs, cs, cs);
        }
      }
      // particles
      for (var p = 0; p < particles.length; p++) {
        var q = particles[p], t = q.life / q.max;
        ctx.globalAlpha = (q.a || 0.9) * t;
        ctx.fillStyle = 'rgb(' + q.c[0] + ',' + q.c[1] + ',' + q.c[2] + ')';
        var r = q.r * cs;
        if (q.sq) ctx.fillRect(q.x * cs - r, q.y * cs - r, r * 2, r * 2);
        else { ctx.beginPath(); ctx.arc(q.x * cs, q.y * cs, r, 0, 6.2832); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      if (holding) strikeFx = { x: holdX, y: holdY, t: 12, max: 12 };
      if (strikeFx) {
        var k = strikeFx.t / strikeFx.max;
        ctx.strokeStyle = 'rgba(255,255,255,' + (0.85 * k) + ')';
        ctx.lineWidth = Math.max(1, cs * 0.12);
        var side = reach * 2 + 1;
        var x0 = (strikeFx.x - reach) * cs, y0 = (strikeFx.y - reach) * cs;
        ctx.strokeRect(x0, y0, cs * side, cs * side);
        ctx.beginPath();
        ctx.moveTo((strikeFx.x + 0.5) * cs, y0 - cs); ctx.lineTo((strikeFx.x + 0.5) * cs, y0 + cs * (side + 1));
        ctx.moveTo(x0 - cs, (strikeFx.y + 0.5) * cs); ctx.lineTo(x0 + cs * (side + 1), (strikeFx.y + 0.5) * cs);
        ctx.stroke();
      }
    }

    function drawGraph() {
      if (!gr) return;
      var gw = graph.width, gh = graph.height, pad = 3 * dpr;
      gr.clearRect(0, 0, gw, gh);
      var n = Math.min(sim.samples, 240);
      if (n < 3) return;
      var domain = Math.max(n, 60);
      gr.lineWidth = Math.max(1, 1.25 * dpr);
      gr.lineJoin = 'round';
      function line(arr, max, color) {
        if (max <= 0) return;
        gr.strokeStyle = color;
        gr.beginPath();
        for (var f = 1; f < n; f++) {
          var x = pad + ((domain - f) / domain) * (gw - pad * 2);
          var y = gh - pad - (Math.max(arr[f], 0) / max) * (gh - pad * 2);
          if (f === 1) gr.moveTo(x, y); else gr.lineTo(x, y);
        }
        gr.stroke();
      }
      line(sim.grassCount, sim.grassMax, 'rgba(0,255,0,0.55)');
      for (var s = 0; s < 6; s++) line(sim.speciesCount[s], sim.creaMax[s], COLORS[s]);
    }

    function say(msg) {
      if (!toast) return;
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toast.classList.remove('show'); }, 4200);
    }

    function updateReadout() {
      var c = sim.counts();
      for (var i = 0; i < counts.length; i++) {
        var li = counts[i], sp = +li.getAttribute('data-sp');
        li.querySelector('.count').textContent = c[sp];
        if (c[sp] === 0 && prevCounts[sp] > 0 && extinctAt[sp] === null) {
          extinctAt[sp] = sim.gameTime;
          say(NAMES[sp] + ' went extinct at ' + clock(sim.gameTime) + '.');
        }
        li.classList.toggle('extinct', c[sp] === 0);
      }
      prevCounts = c;
      if (clockEl) clockEl.textContent = clock(sim.gameTime);
      if (huntEl) huntEl.textContent = sim.kills + (sim.kills === 1 ? ' kill' : ' kills') + ', $' + sim.plrProfit;
    }

    function tick() {
      if (pendingSpeed && (sim.gameTime + 1) % 4 === 0) { sim.gameSpeed = pendingSpeed; pendingSpeed = null; }
      if (holding) sim.strike(holdX, holdY, 2);
      sim.step();
      // predator trails, as in the original particle setup
      if (sim.gameTime % 2 === 0) {
        for (var i = 0; i < sim.crea.length; i++) {
          var c = sim.crea[i];
          if (c.myType === 1 || c.myType === 3) trail(c.myX + 0.5, c.myY + 0.5, c.myType);
        }
      }
      for (var p = particles.length - 1; p >= 0; p--) {
        var q = particles[p];
        q.x += q.vx; q.y += q.vy;
        var sp = Math.hypot(q.vx, q.vy), ns = Math.max(0, sp - 0.012);
        if (sp > 0) { q.vx *= ns / sp; q.vy *= ns / sp; }
        if (--q.life <= 0) particles.splice(p, 1);
      }
      if (particles.length > 1500) particles.splice(0, particles.length - 1500);
      if (strikeFx && --strikeFx.t <= 0) strikeFx = null;
    }

    function frame(now) {
      raf = 0;
      if (!running) return;
      if (!last) last = now;
      acc += Math.min(100, now - last);
      last = now;
      var steps = 0;
      while (acc >= 1000 / 60 && steps < 4) { tick(); acc -= 1000 / 60; steps++; }
      if (steps) {
        draw();
        if (sim.samples !== lastSamples) { lastSamples = sim.samples; drawGraph(); }
        if (sim.gameTime % 6 === 0 || steps > 1) updateReadout();
      }
      raf = requestAnimationFrame(frame);
    }

    function setRunning() {
      var should = started && visible && !userPaused && !document.hidden;
      if (should === running) return;
      running = should;
      root.classList.toggle('paused', !running);
      if (running) { last = 0; if (!raf) raf = requestAnimationFrame(frame); }
    }

    var warming = false;
    function start() {
      if (started || warming) return;
      // Let the ecosystem run for a while off-screen so the first frame looks lived-in
      var warm = parseInt(root.getAttribute('data-warmup') || '0', 10);
      if (warm > 0) {
        warming = true;
        var quiet = sim.onEvent; sim.onEvent = null;
        (function chunk() {
          var n = Math.min(240, warm);
          for (var i = 0; i < n; i++) sim.step();
          warm -= n;
          if (warm > 0) { requestAnimationFrame(chunk); return; }
          sim.onEvent = quiet; warming = false;
          root.setAttribute('data-warmup', '0');
          prevCounts = sim.counts();
          start();
        })();
        return;
      }
      started = true;
      if (still) still.remove();
      var btn = stage.querySelector('.vp-start');
      if (btn) btn.remove();
      stage.appendChild(canvas);
      resize();
      lastSamples = sim.samples; drawGraph();
      updateReadout();
      setRunning();
    }

    // Controls
    if (pauseBtn) pauseBtn.addEventListener('click', function () {
      if (!started) { start(); return; }
      userPaused = !userPaused;
      pauseBtn.setAttribute('aria-pressed', String(userPaused));
      pauseBtn.textContent = userPaused ? 'Play' : 'Pause';
      setRunning();
    });
    Array.prototype.forEach.call(speedBtns, function (b) {
      b.addEventListener('click', function () {
        var gs = parseInt(b.getAttribute('data-gs'), 10);
        Array.prototype.forEach.call(speedBtns, function (o) { o.setAttribute('aria-pressed', String(o === b)); });
        if (gs !== sim.gameSpeed) pendingSpeed = gs;
        if (!started) start();
      });
    });
    if (resetBtn) resetBtn.addEventListener('click', function () {
      sim.reset();
      particles.length = 0; strikeFx = null; lastSamples = -1;
      extinctAt = [null, null, null, null, null, null];
      prevCounts = sim.counts();
      if (gr) gr.clearRect(0, 0, graph.width, graph.height);
      if (!started) start();
      draw(); updateReadout();
      say('New ecosystem seeded: 50 rabbits, 40 mice, 7 elk, 4 coyotes, 4 ferrets, 1 wolf.');
    });

    // The spear is out for as long as the mouse button (or a finger) is held down, and follows the pointer
    function cellAt(e) {
      var r = stage.getBoundingClientRect();
      var cx = Math.floor((e.clientX - r.left) / r.width * sim.gridWidth);
      var cy = Math.floor((e.clientY - r.top) / r.height * sim.gridHeight);
      return [Math.max(0, Math.min(sim.gridWidth - 1, cx)), Math.max(0, Math.min(sim.gridHeight - 1, cy))];
    }
    stage.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (!started) { start(); return; }
      var c = cellAt(e);
      holding = true; holdX = c[0]; holdY = c[1]; holdKills = sim.kills;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      e.preventDefault();
    });
    stage.addEventListener('pointermove', function (e) {
      if (!holding) return;
      var c = cellAt(e);
      holdX = c[0]; holdY = c[1];
    });
    function release() {
      if (!holding) return;
      holding = false;
      var got = sim.kills - holdKills;
      if (got > 0) say('Speared ' + got + (got === 1 ? ' critter' : ' critters') + '. Running total $' + sim.plrProfit + '.');
      updateReadout();
    }
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);
    stage.addEventListener('lostpointercapture', release);

    if ('ResizeObserver' in window) new ResizeObserver(function () { if (started) resize(); }).observe(stage);
    else window.addEventListener('resize', function () { if (started) resize(); });
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        setRunning();
      }, { threshold: 0.05 }).observe(root);
    }
    document.addEventListener('visibilitychange', setRunning);

    if (reduceMotion) {
      var b = document.createElement('button');
      b.className = 'btn primary vp-start';
      b.type = 'button';
      b.textContent = 'Run the simulation';
      b.addEventListener('click', function (e) { e.stopPropagation(); start(); });
      stage.appendChild(b);
      if (pauseBtn) pauseBtn.textContent = 'Play';
    } else {
      start();
    }
  }

  function init() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-critters]'), mount);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
