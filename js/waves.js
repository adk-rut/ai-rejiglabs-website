/**
 * Wave Background — ported from 21st.dev/r/xubohuah/wave-background
 * Self-contained simplex noise + SVG wave animation for hero section
 */
(function () {
  // --- Inline 2D simplex noise ---
  var F2 = 0.5 * (Math.sqrt(3) - 1);
  var G2 = (3 - Math.sqrt(3)) / 6;
  var grad3 = [[1,1],[-1,1],[1,-1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

  function buildPermTable() {
    var p = new Uint8Array(256);
    for (var i = 0; i < 256; i++) p[i] = i;
    for (var i = 255; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    var perm = new Uint8Array(512);
    var permMod = new Uint8Array(512);
    for (var i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      permMod[i] = perm[i] % 8;
    }
    return { perm: perm, permMod: permMod };
  }

  function createNoise2D() {
    var t = buildPermTable();
    var perm = t.perm, permMod = t.permMod;

    return function noise2D(x, y) {
      var s = (x + y) * F2;
      var i = Math.floor(x + s);
      var j = Math.floor(y + s);
      var tt = (i + j) * G2;
      var X0 = i - tt, Y0 = j - tt;
      var x0 = x - X0, y0 = y - Y0;

      var i1, j1;
      if (x0 > y0) { i1 = 1; j1 = 0; }
      else { i1 = 0; j1 = 1; }

      var x1 = x0 - i1 + G2;
      var y1 = y0 - j1 + G2;
      var x2 = x0 - 1.0 + 2.0 * G2;
      var y2 = y0 - 1.0 + 2.0 * G2;

      var ii = i & 255, jj = j & 255;

      var n0 = 0, n1 = 0, n2 = 0;

      var t0 = 0.5 - x0 * x0 - y0 * y0;
      if (t0 >= 0) {
        var g = grad3[permMod[ii + perm[jj]]];
        t0 *= t0;
        n0 = t0 * t0 * (g[0] * x0 + g[1] * y0);
      }

      var t1 = 0.5 - x1 * x1 - y1 * y1;
      if (t1 >= 0) {
        var g = grad3[permMod[ii + i1 + perm[jj + j1]]];
        t1 *= t1;
        n1 = t1 * t1 * (g[0] * x1 + g[1] * y1);
      }

      var t2 = 0.5 - x2 * x2 - y2 * y2;
      if (t2 >= 0) {
        var g = grad3[permMod[ii + 1 + perm[jj + 1]]];
        t2 *= t2;
        n2 = t2 * t2 * (g[0] * x2 + g[1] * y2);
      }

      return 70.0 * (n0 + n1 + n2);
    };
  }

  // --- Wave animation ---
  var container = document.getElementById('hero');
  var svg = document.getElementById('wavesSvg');
  if (!container || !svg) return;

  var noise2D = createNoise2D();
  var paths = [];
  var lines = [];
  var bounding = null;

  var mouse = {
    x: -100, y: 0,
    lx: 0, ly: 0,
    sx: -100, sy: 0,
    v: 0, vs: 0, a: 0,
    set: false
  };

  function setSize() {
    bounding = container.getBoundingClientRect();
    svg.setAttribute('width', bounding.width);
    svg.setAttribute('height', bounding.height);
    svg.style.width = bounding.width + 'px';
    svg.style.height = bounding.height + 'px';
  }

  function setLines() {
    if (!bounding) return;
    var w = bounding.width;
    var h = bounding.height;

    paths.forEach(function (p) { p.remove(); });
    paths.length = 0;
    lines.length = 0;

    var xGap = 16;
    var yGap = 16;
    var oW = w + 200;
    var oH = h + 30;
    var totalLines = Math.ceil(oW / xGap);
    var totalPoints = Math.ceil(oH / yGap);
    var xStart = (w - xGap * totalLines) / 2;
    var yStart = (h - yGap * totalPoints) / 2;

    for (var i = 0; i < totalLines; i++) {
      var points = [];
      for (var j = 0; j < totalPoints; j++) {
        points.push({
          x: xStart + xGap * i,
          y: yStart + yGap * j,
          wave: { x: 0, y: 0 },
          cursor: { x: 0, y: 0, vx: 0, vy: 0 }
        });
      }

      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', '#3385ff');
      path.setAttribute('stroke-width', '1');
      svg.appendChild(path);
      paths.push(path);
      lines.push(points);
    }
  }

  function onResize() {
    setSize();
    setLines();
  }

  function updateMouse(x, y) {
    if (!bounding) return;
    mouse.x = x - bounding.left;
    mouse.y = y - bounding.top + window.scrollY;
    if (!mouse.set) {
      mouse.sx = mouse.x;
      mouse.sy = mouse.y;
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
      mouse.set = true;
    }
  }

  function movePoints(time) {
    for (var li = 0; li < lines.length; li++) {
      var pts = lines[li];
      for (var pi = 0; pi < pts.length; pi++) {
        var p = pts[pi];
        var move = noise2D(
          (p.x + time * 0.008) * 0.003,
          (p.y + time * 0.003) * 0.002
        ) * 8;

        p.wave.x = Math.cos(move) * 12;
        p.wave.y = Math.sin(move) * 6;

        var dx = p.x - mouse.sx;
        var dy = p.y - mouse.sy;
        var d = Math.hypot(dx, dy);
        var l = Math.max(175, mouse.vs);

        if (d < l) {
          var s = 1 - d / l;
          var f = Math.cos(d * 0.001) * s;
          p.cursor.vx += Math.cos(mouse.a) * f * l * mouse.vs * 0.00035;
          p.cursor.vy += Math.sin(mouse.a) * f * l * mouse.vs * 0.00035;
        }

        p.cursor.vx += (0 - p.cursor.x) * 0.01;
        p.cursor.vy += (0 - p.cursor.y) * 0.01;
        p.cursor.vx *= 0.95;
        p.cursor.vy *= 0.95;
        p.cursor.x += p.cursor.vx;
        p.cursor.y += p.cursor.vy;
        p.cursor.x = Math.min(50, Math.max(-50, p.cursor.x));
        p.cursor.y = Math.min(50, Math.max(-50, p.cursor.y));
      }
    }
  }

  function drawLines() {
    for (var li = 0; li < lines.length; li++) {
      var pts = lines[li];
      if (pts.length < 2 || !paths[li]) continue;

      var first = pts[0];
      var d = 'M ' + first.x + ' ' + first.y;

      for (var i = 1; i < pts.length; i++) {
        var p = pts[i];
        var mx = p.x + p.wave.x + p.cursor.x;
        var my = p.y + p.wave.y + p.cursor.y;
        d += 'L ' + mx + ' ' + my;
      }

      paths[li].setAttribute('d', d);
    }
  }

  var running = false;

  function tick(time) {
    if (!running) return;
    mouse.sx += (mouse.x - mouse.sx) * 0.1;
    mouse.sy += (mouse.y - mouse.sy) * 0.1;

    var dx = mouse.x - mouse.lx;
    var dy = mouse.y - mouse.ly;
    mouse.v = Math.hypot(dx, dy);
    mouse.vs += (mouse.v - mouse.vs) * 0.1;
    mouse.vs = Math.min(100, mouse.vs);
    mouse.lx = mouse.x;
    mouse.ly = mouse.y;
    mouse.a = Math.atan2(dy, dx);

    movePoints(time);
    drawLines();

    requestAnimationFrame(tick);
  }

  // Enable pointer events on waves for mouse interaction (desktop only)
  var isTouchDevice = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  var wavesDiv = document.getElementById('heroWaves');
  if (wavesDiv && !isTouchDevice) wavesDiv.style.pointerEvents = 'auto';

  setSize();
  setLines();

  window.addEventListener('resize', onResize);
  if (!isTouchDevice) {
    window.addEventListener('mousemove', function (e) { updateMouse(e.pageX, e.pageY); });
  }

  // Only animate while the hero is on screen — the rAF loop is the page's
  // heaviest cost, so pause it once the hero scrolls out of view.
  var heroObserver = new IntersectionObserver(function (entries) {
    if (entries[0].isIntersecting) {
      if (!running) { running = true; requestAnimationFrame(tick); }
    } else {
      running = false;
    }
  }, { threshold: 0 });
  heroObserver.observe(container);
})();
