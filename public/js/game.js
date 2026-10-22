// game.js – "MetroFlow Dash", a small canvas endless runner in the sub-footer
// ---------------------------------------------------------------------------
// Vanilla canvas + jQuery, no engine and no extra libraries. Everything lives
// inside the MetroFlowGame IIFE; the only global created is
// window.MetroFlowGame.
//
// The loop is delta-timed, so the bus travels at the same speed on a 60Hz and
// a 144Hz display. The game pauses itself when the tab is hidden or the strip
// scrolls out of view, and only resumes on a deliberate key press or tap.
// ---------------------------------------------------------------------------
(function (window, $) {
  'use strict';

  var STORE_BEST = 'mf-game-best';
  var STORE_SOUND = 'mf-game-sound';

  var reduceMotion = !!(window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  // Evaluated on demand, so it stays right if the pointer type changes
  // (hybrid laptops, device rotation). Only the canvas overlay needs it;
  // the HTML hint is switched in CSS.
  function isTouch() {
    return !!(window.matchMedia &&
      window.matchMedia('(hover: none) and (pointer: coarse)').matches);
  }

  /* ============================ small helpers =========================== */

  // localStorage can throw in private mode – never let that break the game.
  function readStore(key, fallback) {
    try {
      var value = window.localStorage.getItem(key);
      return value === null ? fallback : value;
    } catch (err) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      window.localStorage.setItem(key, String(value));
    } catch (err) {
      // Storage blocked or full: the session still plays, best just won't persist.
    }
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function mixHex(from, to, t) {
    var f = parseInt(from.slice(1), 16);
    var g = parseInt(to.slice(1), 16);
    var r = Math.round(lerp((f >> 16) & 255, (g >> 16) & 255, t));
    var gr = Math.round(lerp((f >> 8) & 255, (g >> 8) & 255, t));
    var b = Math.round(lerp(f & 255, g & 255, t));
    return 'rgb(' + r + ',' + gr + ',' + b + ')';
  }

  function roundRect(ctx, x, y, w, h, r) {
    var radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  /* ================================ audio =============================== */
  // Web Audio beeps only. The context is created on the first interaction,
  // never at load, so browsers do not block it.
  var audio = {
    ctx: null,
    on: readStore(STORE_SOUND, 'off') === 'on'
  };

  function beep(freq, duration, type, peak) {
    if (!audio.on) { return; }
    try {
      var Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { return; }
      if (!audio.ctx) { audio.ctx = new Ctor(); }
      if (audio.ctx.state === 'suspended') { audio.ctx.resume(); }

      var osc = audio.ctx.createOscillator();
      var gain = audio.ctx.createGain();
      var now = audio.ctx.currentTime;

      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(peak || 0.06, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      osc.connect(gain).connect(audio.ctx.destination);
      osc.start(now);
      osc.stop(now + duration + 0.02);
    } catch (err) {
      // Audio is a nicety – a failure here must never interrupt play.
    }
  }

  var sfx = {
    jump:    function () { beep(520, 0.12, 'square', 0.05); },
    collect: function () { beep(880, 0.10, 'triangle', 0.07); },
    life:    function () { beep(1180, 0.16, 'triangle', 0.07); },
    crash:   function () { beep(140, 0.26, 'sawtooth', 0.08); }
  };

  /* ============================== palettes ============================== */
  // Cycled every 500 points; the active colours ease toward the target.
  var PALETTES = [
    { // day
      skyTop: '#DCEBFB', skyBot: '#FFFFFF', sun: '#FFD36E',
      hillBack: '#C7DCF0', hillFront: '#A8C8E6',
      palm: '#3E8E6B', trunk: '#8A6A4F', cloud: '#FFFFFF', road: '#0F1B33'
    },
    { // dusk
      skyTop: '#FFD8C2', skyBot: '#FFF5F2', sun: '#FF7A4D',
      hillBack: '#F0BDB4', hillFront: '#D9918A',
      palm: '#2F6B55', trunk: '#6E523E', cloud: '#FFF1E9', road: '#0F1B33'
    }
  ];
  var PALETTE_KEYS = ['skyTop', 'skyBot', 'sun', 'hillBack', 'hillFront', 'palm', 'trunk', 'cloud', 'road'];

  var QUIPS = [
    'Out of seats? Book your next ride!',
    'Even the best drivers need a break.',
    'That pothole had your name on it.',
    'Colombo to Kandy is a far smoother trip.',
    'Nice run — the 06:30 is still waiting for you.'
  ];

  /* =============================== state ================================ */

  var canvas, ctx, stage;
  var $stage, $over, $score, $best, $lives, $hint, $startLabel, $live;

  var W = 0, H = 0, groundY = 0, dpr = 1;
  var state = 'idle';           // idle | running | paused | over
  var autoPaused = false;       // paused by the tab/viewport, not by the player
  var rafId = null, lastTime = 0;

  var score = 0, best = parseInt(readStore(STORE_BEST, '0'), 10) || 0;
  var lives = 3, speed = 0, distance = 0;
  var invulnUntil = 0, elapsed = 0;
  var paletteMix = PALETTES[0];
  var paletteIndex = 0;

  var bus = { x: 0, y: 0, w: 0, h: 0, vy: 0, grounded: true, duck: 0 };
  var obstacles = [], pickups = [], clouds = [], palms = [];
  var layer = { cloud: 0, hillBack: 0, hillFront: 0, palm: 0, road: 0 };
  var spawnIn = 0, pickupIn = 0;

  var GRAVITY = 2000, JUMP_V = -620;

  // The bus sprite; a flat fallback is drawn if it cannot be fetched.
  var busImg = new window.Image();
  var busImgReady = false;
  busImg.onload = function () { busImgReady = true; };
  busImg.onerror = function () { busImgReady = false; };
  busImg.src = 'images/metroflow-bus.svg';

  /* =============================== sizing =============================== */

  function resize() {
    if (!canvas || !stage) { return; }

    var cssW = Math.max(240, stage.clientWidth);
    var cssH = window.innerWidth < 576 ? 180 : 220;

    dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.height = cssH + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    W = cssW;
    H = cssH;
    groundY = Math.round(H * 0.84);

    bus.h = Math.round(H * 0.21);
    bus.w = Math.round(bus.h * 2.78);
    bus.x = Math.max(18, Math.round(W * 0.06));
    if (state !== 'running') { bus.y = groundY - bus.h; }
    bus.y = Math.min(bus.y, groundY - bus.h);

    buildScenery();
    draw();
  }

  // Cloud and palm positions are generated once per size, then scrolled.
  function buildScenery() {
    clouds = [];
    var cloudCount = Math.max(3, Math.round(W / 260));
    for (var i = 0; i < cloudCount; i++) {
      clouds.push({
        x: (i + Math.random()) * (W / cloudCount),
        y: 12 + Math.random() * (H * 0.3),
        s: 0.7 + Math.random() * 0.6
      });
    }

    palms = [];
    var palmCount = Math.max(2, Math.round(W / 300));
    for (var j = 0; j < palmCount; j++) {
      palms.push({
        x: (j + Math.random()) * (W / palmCount),
        s: 0.8 + Math.random() * 0.45
      });
    }
  }

  /* ============================== entities ============================== */

  var OBSTACLES = ['cone', 'pothole', 'tuktuk', 'cow'];

  function spawnObstacle() {
    var type = OBSTACLES[Math.floor(Math.random() * OBSTACLES.length)];
    var unit = H / 220;
    var sizes = {
      cone:    { w: 20 * unit, h: 28 * unit },
      pothole: { w: 50 * unit, h: 11 * unit },
      tuktuk:  { w: 48 * unit, h: 38 * unit },
      cow:     { w: 54 * unit, h: 36 * unit }
    };
    var size = sizes[type];
    obstacles.push({
      type: type,
      x: W + 20,
      y: groundY - size.h,
      w: size.w,
      h: size.h
    });
  }

  function spawnPickup() {
    // A seat (extra life) only appears when a life is actually missing.
    var wantSeat = lives < 3 && Math.random() < 0.3;
    var unit = H / 220;
    var size = 22 * unit;
    var x = W + 20;

    // Never drop a pickup on top of an obstacle.
    for (var i = 0; i < obstacles.length; i++) {
      if (Math.abs(obstacles[i].x - x) < size * 4) { return; }
    }

    pickups.push({
      type: wantSeat ? 'seat' : 'ticket',
      x: x,
      y: groundY - bus.h - size - 14 * unit,
      w: size,
      h: size,
      bob: Math.random() * Math.PI * 2
    });
  }

  // Forgiving hitboxes: the drawn sprite is bigger than the box we test.
  function busBox() {
    var h = bus.h * (bus.duck > 0 ? 0.68 : 1);
    return {
      x: bus.x + bus.w * 0.12,
      y: bus.y + (bus.h - h) + h * 0.16,
      w: bus.w * 0.76,
      h: h * 0.84
    };
  }

  function hits(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /* =============================== update =============================== */

  function update(dt) {
    elapsed += dt;
    speed = Math.min(520, 260 + elapsed * 6);
    distance += speed * dt;

    var previous = score;
    score = Math.floor(distance / 10) + scoreBonus;
    if (score !== previous) { updateHud(); }

    // Day/dusk cross-fade every 500 points.
    var wanted = Math.floor(score / 500) % PALETTES.length;
    if (wanted !== paletteIndex) { paletteIndex = wanted; }
    easePalette(dt);

    // Parallax offsets (static when the user asked for reduced motion).
    var shift = reduceMotion ? 0 : speed * dt;
    layer.cloud += shift * 0.15;
    layer.hillBack += shift * 0.25;
    layer.hillFront += shift * 0.45;
    layer.palm += shift * 0.7;
    layer.road += speed * dt;

    // Bus physics.
    bus.vy += GRAVITY * (bus.duck > 0 && !bus.grounded ? 1.8 : 1) * dt;
    bus.y += bus.vy * dt;
    if (bus.y >= groundY - bus.h) {
      bus.y = groundY - bus.h;
      bus.vy = 0;
      bus.grounded = true;
    }
    if (bus.duck > 0) { bus.duck -= dt; }

    // Spawning.
    spawnIn -= dt;
    if (spawnIn <= 0) {
      spawnObstacle();
      // Gap is time-based so the reaction window stays fair as speed climbs.
      spawnIn = Math.max(0.72, 1.15 - speed / 2400) + Math.random() * 0.6;
    }

    pickupIn -= dt;
    if (pickupIn <= 0) {
      spawnPickup();
      pickupIn = 2.2 + Math.random() * 2.6;
    }

    var box = busBox();
    var i;

    for (i = obstacles.length - 1; i >= 0; i--) {
      obstacles[i].x -= speed * dt;
      if (obstacles[i].x + obstacles[i].w < -30) {
        obstacles.splice(i, 1);
      } else if (elapsed > invulnUntil && hits(box, obstacles[i])) {
        obstacles.splice(i, 1);
        crash();
        if (state !== 'running') { return; }
      }
    }

    for (i = pickups.length - 1; i >= 0; i--) {
      pickups[i].x -= speed * dt;
      pickups[i].bob += dt * 4;
      if (pickups[i].x + pickups[i].w < -30) {
        pickups.splice(i, 1);
      } else if (hits(box, pickups[i])) {
        if (pickups[i].type === 'seat') {
          lives = Math.min(3, lives + 1);
          sfx.life();
        } else {
          scoreBonus += 10;
          sfx.collect();
        }
        pickups.splice(i, 1);
        updateHud();
      }
    }
  }

  var scoreBonus = 0;

  function easePalette(dt) {
    var target = PALETTES[paletteIndex];
    var t = Math.min(1, dt * 1.6);
    var next = {};
    for (var k = 0; k < PALETTE_KEYS.length; k++) {
      var key = PALETTE_KEYS[k];
      next[key] = mixToward(paletteMix[key], target[key], t);
    }
    paletteMix = next;
  }

  // Colours may already be 'rgb(...)' after a blend, so normalise first.
  function mixToward(current, target, t) {
    var from = current.charAt(0) === '#' ? hexToRgb(current) : parseRgb(current);
    var to = hexToRgb(target);
    return 'rgb(' +
      Math.round(lerp(from[0], to[0], t)) + ',' +
      Math.round(lerp(from[1], to[1], t)) + ',' +
      Math.round(lerp(from[2], to[2], t)) + ')';
  }

  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function parseRgb(value) {
    var m = /(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
    return m ? [+m[1], +m[2], +m[3]] : [0, 0, 0];
  }

  function crash() {
    lives -= 1;
    invulnUntil = elapsed + 1.5;
    sfx.crash();
    updateHud();
    if (lives <= 0) { gameOver(); }
  }

  /* ================================ draw ================================ */

  function draw() {
    if (!ctx) { return; }
    var p = paletteMix;

    // Sky.
    var sky = ctx.createLinearGradient(0, 0, 0, groundY);
    sky.addColorStop(0, p.skyTop);
    sky.addColorStop(1, p.skyBot);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Sun.
    ctx.fillStyle = p.sun;
    ctx.beginPath();
    ctx.arc(W * 0.78, H * 0.26, H * 0.1, 0, Math.PI * 2);
    ctx.fill();

    drawClouds(p);
    drawHills(p.hillBack, layer.hillBack, H * 0.26, 220, groundY + 2);
    drawHills(p.hillFront, layer.hillFront, H * 0.17, 150, groundY + 2);
    drawPalms(p);
    drawRoad(p);

    var i;
    for (i = 0; i < obstacles.length; i++) { drawObstacle(obstacles[i], p); }
    for (i = 0; i < pickups.length; i++) { drawPickup(pickups[i]); }

    drawBus();

    if (state === 'idle') {
      overlayText(reduceMotion ? 'Press Start to play' :
        (isTouch() ? 'Tap to start' : 'Press Space or tap to start'));
    } else if (state === 'paused') {
      overlayText(autoPaused ? 'Paused — tap or press a key to resume'
                             : 'Paused — press P to resume');
    }
  }

  function drawClouds(p) {
    ctx.fillStyle = p.cloud;
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var x = c.x - (layer.cloud % (W + 160));
      if (x < -120) { x += W + 160; }
      var r = 11 * c.s * (H / 220);
      ctx.beginPath();
      ctx.arc(x, c.y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.9, c.y + r * 0.15, r * 0.8, 0, Math.PI * 2);
      ctx.arc(x - r * 0.9, c.y + r * 0.2, r * 0.7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHills(color, offset, height, span, baseY) {
    ctx.fillStyle = color;
    var start = -(offset % span);
    ctx.beginPath();
    ctx.moveTo(start, baseY);
    for (var x = start; x < W + span; x += span) {
      ctx.quadraticCurveTo(x + span / 2, baseY - height, x + span, baseY);
    }
    ctx.lineTo(W + span, baseY);
    ctx.lineTo(start, baseY);
    ctx.closePath();
    ctx.fill();
  }

  function drawPalms(p) {
    var span = W / Math.max(1, palms.length);
    var unit = H / 220;
    for (var i = 0; i < palms.length; i++) {
      var tree = palms[i];
      var x = tree.x - (layer.palm % (W + span));
      if (x < -60) { x += W + span; }

      var trunkH = 46 * tree.s * unit;
      var topY = groundY - trunkH;

      ctx.strokeStyle = p.trunk;
      ctx.lineWidth = 3.5 * tree.s * unit;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, groundY);
      ctx.quadraticCurveTo(x - 4 * unit, groundY - trunkH * 0.6, x, topY);
      ctx.stroke();

      // Five fronds fanned out from the crown.
      ctx.strokeStyle = p.palm;
      ctx.lineWidth = 3 * tree.s * unit;
      for (var f = 0; f < 5; f++) {
        var angle = -Math.PI / 2 + (f - 2) * 0.55;
        var len = 17 * tree.s * unit;
        ctx.beginPath();
        ctx.moveTo(x, topY);
        ctx.quadraticCurveTo(
          x + Math.cos(angle) * len * 0.6, topY + Math.sin(angle) * len * 0.6 - 4 * unit,
          x + Math.cos(angle) * len, topY + Math.sin(angle) * len + 5 * unit
        );
        ctx.stroke();
      }
    }
  }

  function drawRoad(p) {
    ctx.fillStyle = p.road;
    ctx.fillRect(0, groundY, W, H - groundY);

    // Moving centre dashes.
    var dashW = 26, gap = 22, y = groundY + (H - groundY) / 2;
    ctx.strokeStyle = 'rgba(255,255,255,.55)';
    ctx.lineWidth = Math.max(2, (H - groundY) * 0.12);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (var x = -((layer.road) % (dashW + gap)); x < W; x += dashW + gap) {
      ctx.moveTo(x, y);
      ctx.lineTo(x + dashW, y);
    }
    ctx.stroke();
  }

  function drawBus() {
    // Blink while invulnerable after a crash.
    var blinking = elapsed < invulnUntil && Math.floor(elapsed * 12) % 2 === 0;
    if (blinking) { return; }

    var h = bus.h * (bus.duck > 0 ? 0.82 : 1);
    var y = bus.y + (bus.h - h);

    if (busImgReady) {
      ctx.drawImage(busImg, bus.x, y, bus.w, h);
      return;
    }

    // Fallback: flat red body with two wheels.
    ctx.fillStyle = '#D80F1E';
    roundRect(ctx, bus.x, y, bus.w, h * 0.78, 6);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, bus.x + bus.w * 0.08, y + h * 0.14, bus.w * 0.5, h * 0.3, 3);
    ctx.fill();
    ctx.fillStyle = '#0F1B33';
    var r = h * 0.15;
    ctx.beginPath();
    ctx.arc(bus.x + bus.w * 0.22, y + h * 0.82, r, 0, Math.PI * 2);
    ctx.arc(bus.x + bus.w * 0.78, y + h * 0.82, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawObstacle(o, p) {
    var unit = H / 220;

    if (o.type === 'cone') {
      ctx.fillStyle = '#F26522';
      ctx.beginPath();
      ctx.moveTo(o.x + o.w / 2, o.y);
      ctx.lineTo(o.x + o.w, o.y + o.h);
      ctx.lineTo(o.x, o.y + o.h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(o.x + o.w * 0.2, o.y + o.h * 0.48, o.w * 0.6, o.h * 0.16);
      return;
    }

    if (o.type === 'pothole') {
      // Drawn just below the road edge so it reads as a hole in the tarmac;
      // the hitbox above stays at road level so it is jumped, not driven over.
      var cy = groundY + o.h * 0.45;
      ctx.fillStyle = '#3A4256';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, cy, o.w / 2, o.h * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#060B16';
      ctx.beginPath();
      ctx.ellipse(o.x + o.w / 2, cy + o.h * 0.1, o.w * 0.42, o.h * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (o.type === 'tuktuk') {
      ctx.fillStyle = '#1F8A70';
      roundRect(ctx, o.x, o.y + o.h * 0.3, o.w, o.h * 0.45, 4 * unit);
      ctx.fill();
      // Canopy.
      ctx.beginPath();
      ctx.moveTo(o.x + o.w * 0.12, o.y + o.h * 0.32);
      ctx.quadraticCurveTo(o.x + o.w * 0.5, o.y - o.h * 0.1, o.x + o.w * 0.9, o.y + o.h * 0.32);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#0F1B33';
      var wr = o.h * 0.17;
      ctx.beginPath();
      ctx.arc(o.x + o.w * 0.22, o.y + o.h - wr, wr, 0, Math.PI * 2);
      ctx.arc(o.x + o.w * 0.8, o.y + o.h - wr, wr, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Cow, side on: legs, body, head on the body's eye line, dark patches.
    ctx.fillStyle = '#2B3346';
    ctx.fillRect(o.x + o.w * 0.18, o.y + o.h * 0.68, o.w * 0.08, o.h * 0.32);
    ctx.fillRect(o.x + o.w * 0.52, o.y + o.h * 0.68, o.w * 0.08, o.h * 0.32);

    // Tail.
    ctx.strokeStyle = '#2B3346';
    ctx.lineWidth = 2 * unit;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(o.x + o.w * 0.08, o.y + o.h * 0.38);
    ctx.quadraticCurveTo(o.x, o.y + o.h * 0.55, o.x + o.w * 0.05, o.y + o.h * 0.7);
    ctx.stroke();

    ctx.fillStyle = '#FFFFFF';
    roundRect(ctx, o.x + o.w * 0.08, o.y + o.h * 0.3, o.w * 0.62, o.h * 0.42, 7 * unit);
    ctx.fill();
    // Head, level with the body rather than floating above it.
    roundRect(ctx, o.x + o.w * 0.64, o.y + o.h * 0.36, o.w * 0.3, o.h * 0.3, 5 * unit);
    ctx.fill();

    // Ear and muzzle give the silhouette its read.
    ctx.beginPath();
    ctx.moveTo(o.x + o.w * 0.7, o.y + o.h * 0.36);
    ctx.lineTo(o.x + o.w * 0.66, o.y + o.h * 0.18);
    ctx.lineTo(o.x + o.w * 0.8, o.y + o.h * 0.32);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#E3B6B2';
    roundRect(ctx, o.x + o.w * 0.86, o.y + o.h * 0.46, o.w * 0.12, o.h * 0.16, 3 * unit);
    ctx.fill();

    // Patches, kept on the flank so they do not read as a face.
    ctx.fillStyle = '#2B3346';
    ctx.beginPath();
    ctx.ellipse(o.x + o.w * 0.24, o.y + o.h * 0.44, o.w * 0.09, o.h * 0.1, 0, 0, Math.PI * 2);
    ctx.ellipse(o.x + o.w * 0.46, o.y + o.h * 0.58, o.w * 0.07, o.h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPickup(item) {
    var y = item.y + Math.sin(item.bob) * 3;

    if (item.type === 'seat') {
      ctx.fillStyle = '#1F8A70';
      roundRect(ctx, item.x, y + item.h * 0.3, item.w, item.h * 0.7, 4);
      ctx.fill();
      roundRect(ctx, item.x + item.w * 0.62, y, item.w * 0.38, item.h * 0.75, 4);
      ctx.fill();
      return;
    }

    // Ticket: red stub with a white tear strip.
    ctx.fillStyle = '#D80F1E';
    roundRect(ctx, item.x, y + item.h * 0.18, item.w, item.h * 0.64, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.fillRect(item.x + item.w * 0.62, y + item.h * 0.18, item.w * 0.08, item.h * 0.64);
    ctx.beginPath();
    ctx.arc(item.x + item.w * 0.28, y + item.h * 0.5, item.w * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  function overlayText(text) {
    ctx.fillStyle = 'rgba(15,27,51,.55)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '700 ' + Math.max(13, Math.round(H * 0.075)) + 'px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, H / 2);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  /* ================================ loop ================================ */

  function frame(now) {
    rafId = window.requestAnimationFrame(frame);

    var dt = (now - lastTime) / 1000;
    lastTime = now;
    // Clamp so a background tab or a stall cannot tunnel the bus through things.
    if (!(dt > 0)) { dt = 0; }
    dt = Math.min(dt, 1 / 30);

    if (state === 'running') { update(dt); }
    draw();
  }

  function startLoop() {
    if (rafId !== null) { return; }
    lastTime = window.performance.now();
    rafId = window.requestAnimationFrame(frame);
  }

  function stopLoop() {
    if (rafId !== null) {
      window.cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  /* ============================ state changes =========================== */

  // jQuery Use #4 – .text() keeps the HUD in sync
  function updateHud() {
    $score.text(score);
    $best.text(Math.max(best, score));
    $lives.find('i').each(function (i) {
      $(this).toggleClass('is-spent', i >= lives);
    });
    $lives.attr('aria-label', 'Lives remaining: ' + lives);
  }

  function resetGame() {
    score = 0;
    scoreBonus = 0;
    lives = 3;
    speed = 260;
    distance = 0;
    elapsed = 0;
    invulnUntil = 0;
    obstacles = [];
    pickups = [];
    spawnIn = 1.1;
    pickupIn = 2.4;
    layer = { cloud: 0, hillBack: 0, hillFront: 0, palm: 0, road: 0 };
    paletteIndex = 0;
    paletteMix = PALETTES[0];
    bus.y = groundY - bus.h;
    bus.vy = 0;
    bus.grounded = true;
    bus.duck = 0;
    updateHud();
  }

  function startGame() {
    // jQuery Use #3 – .fadeOut() dismisses the Game Over panel
    $over.fadeOut(160);
    resetGame();
    state = 'running';
    autoPaused = false;
    $startLabel.text('Restart');
    stage.focus();
    startLoop();
  }

  function pauseGame(auto) {
    if (state !== 'running') { return; }
    state = 'paused';
    autoPaused = !!auto;
    draw();
  }

  function resumeGame() {
    if (state !== 'paused') { return; }
    state = 'running';
    autoPaused = false;
    lastTime = window.performance.now();
    startLoop();
  }

  function gameOver() {
    state = 'over';
    var isBest = score > best;
    if (isBest) {
      best = score;
      writeStore(STORE_BEST, best);
    }

    $('#mfGameFinal').text(score);
    $('#mfGameQuip').text(QUIPS[Math.floor(Math.random() * QUIPS.length)]);
    $startLabel.text('Start');
    updateHud();

    // Announced only here, so a screen reader is not read every point.
    $live.text('Game over. You scored ' + score + '. ' +
      (isBest ? 'That is a new best.' : 'Your best is ' + best + '.'));

    var $newBest = $('#mfGameNewBest');
    if (isBest) {
      $newBest.show();
      // jQuery Use #5 – .animate() pulses the new best score
      $best.stop(true, true)
        .animate({ fontSize: '26px' }, 220)
        .animate({ fontSize: '16px' }, 420);
    } else {
      $newBest.hide();
    }

    // jQuery Use #3 – .fadeIn() reveals the Game Over panel
    $over.stop(true, true).fadeIn(260, function () {
      $('#mfGameAgain').trigger('focus');
    });
  }

  function jump() {
    if (bus.grounded) {
      bus.vy = JUMP_V;
      bus.grounded = false;
      sfx.jump();
    }
  }

  // One entry point for "the player did something", wherever it came from.
  function primaryAction() {
    if (state === 'running') { jump(); return; }
    if (state === 'paused') { resumeGame(); return; }
    if (state === 'idle' && !reduceMotion) { startGame(); }
  }

  /* =============================== input ================================ */

  function isInteractive(el) {
    return !!el && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
  }

  // True only when the strip should own the key press.
  function engaged() {
    if (state === 'running' || state === 'paused') { return true; }
    return !!(stage && stage.contains(document.activeElement));
  }

  function bindInput() {
    // jQuery Use #2 – button, keyboard and pointer handlers
    $('#mfGameStart').on('click', function () {
      if (state === 'running' || state === 'paused') { resetGame(); state = 'running'; startLoop(); }
      else { startGame(); }
    });

    $('#mfGameAgain').on('click', startGame);

    $('#mfGameSound').on('click', function () {
      audio.on = !audio.on;
      writeStore(STORE_SOUND, audio.on ? 'on' : 'off');
      $(this).attr('aria-pressed', audio.on ? 'true' : 'false');
      $('#mfGameSoundIcon').attr('class', audio.on ? 'bi bi-volume-up' : 'bi bi-volume-mute');
      $('#mfGameSoundLabel').text(audio.on ? 'Sound on' : 'Sound off');
      if (audio.on) { sfx.collect(); }
    });

    // Tapping / clicking the stage jumps or starts.
    var tapEvent = window.PointerEvent ? 'pointerdown' : 'click';
    $stage.on(tapEvent, function (e) {
      if (isInteractive(e.target)) { return; }
      stage.focus();
      primaryAction();
    });

    $(document).on('keydown.mfgame', function (e) {
      var key = e.key;
      var ours = key === ' ' || key === 'Spacebar' || key === 'ArrowUp' ||
                 key === 'ArrowDown' || key === 'p' || key === 'P';
      if (!ours || !engaged()) { return; }

      // Never swallow the key for a focused control – Space must still
      // activate the Play again button.
      if (!isInteractive(document.activeElement)) { e.preventDefault(); }
      else if (key !== 'p' && key !== 'P') { return; }

      if (key === 'p' || key === 'P') {
        if (state === 'running') { pauseGame(false); }
        else if (state === 'paused') { resumeGame(); }
        return;
      }

      if (key === 'ArrowDown') {
        if (state === 'running') { bus.duck = 0.4; }
        return;
      }

      primaryAction();
    });
  }

  /* ====================== auto-pause (tab / viewport) =================== */

  function bindAutoPause() {
    $(document).on('visibilitychange.mfgame', function () {
      if (document.hidden) {
        pauseGame(true);
        stopLoop();
      }
    });

    if (window.IntersectionObserver) {
      new window.IntersectionObserver(function (entries) {
        var visible = entries[0].intersectionRatio > 0.3;
        if (!visible && state === 'running') {
          pauseGame(true);
          stopLoop();
        }
      }, { threshold: [0, 0.3, 1] }).observe(stage);
    }
  }

  /* ================================ boot ================================ */

  function init() {
    stage = document.getElementById('mfGameStage');
    canvas = document.getElementById('mfGameCanvas');
    if (!stage || !canvas) { return; }

    ctx = canvas.getContext('2d');
    $stage = $(stage);
    $over = $('#mfGameOver');
    $score = $('#mfGameScore');
    $best = $('#mfGameBest');
    $lives = $('#mfGameLives');
    $hint = $('#mfGameHint');
    $startLabel = $('#mfGameStartLabel');
    $live = $('#mfGameLive');

    // Touch vs keyboard wording is handled in CSS; only the reduced-motion
    // case (start is click-only) needs to be said here.
    if (reduceMotion) { $hint.text('Press Start, then Space to jump'); }

    $('#mfGameSound').attr('aria-pressed', audio.on ? 'true' : 'false');
    $('#mfGameSoundIcon').attr('class', audio.on ? 'bi bi-volume-up' : 'bi bi-volume-mute');
    $('#mfGameSoundLabel').text(audio.on ? 'Sound on' : 'Sound off');

    resize();
    resetGame();
    bindInput();
    bindAutoPause();

    var resizeTimer = null;
    $(window).on('resize.mfgame', function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(resize, 150);
    });

    // Draw the idle frame once; the loop only runs while playing.
    startLoop();
  }

  // jQuery Use #1 – .load() pulls in the strip markup, like navbar/footer
  function loadStrip() {
    var $slot = $('#mf-game-slot');
    if (!$slot.length || $.trim($slot.html()) !== '') { return; }

    $slot.load('partials/game.html', function (response, status) {
      if (status === 'error') {
        // Nothing to show – drop the empty slot rather than leave a gap.
        $slot.remove();
        return;
      }
      init();
    });
  }

  window.MetroFlowGame = {
    start: startGame,
    pause: function () { pauseGame(false); },
    resume: resumeGame,
    // Read-only snapshot, handy for debugging from the console.
    getState: function () {
      return { state: state, autoPaused: autoPaused, score: score, lives: lives, best: best };
    }
  };

  $(loadStrip);

}(window, jQuery));
