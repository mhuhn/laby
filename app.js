/* Laby – Kugellabyrinth aus Holz, gesteuert durch Neigen des iPads */
'use strict';
(() => {

// ============================================================ Konstanten
const LEVEL_COUNT = 20;
const H = 860;                                   // Brett-Höhe in Welt-Einheiten; Breite folgt dem Bildschirm
const BALL_R = 14, HOLE_R = 20, GOAL_R = 23, WALL_T = 12;
const G_BASE = 7200;                             // Beschleunigung bei 90° Neigung
const SENS = [0.62, 1, 1.5];
const ROLL_RES = 70;                             // Rollwiderstand (Einheiten/s²)
const RESTITUTION = 0.32;
const FALL_T = 0.16;                             // Dauer des Verschwindens im Loch (s)
const MAX_TILT = Math.sin(28 * Math.PI / 180);
const STORE_KEY = 'laby.v1';

const $ = (s) => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ============================================================ Speicher
const DEFAULTS = { unlocked: 1, best: {}, settings: { sens: 1, sound: true, checkpoints: true, rot: 90 } };
function loadStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s) return { unlocked: s.unlocked || 1, best: s.best || {}, settings: { ...DEFAULTS.settings, ...(s.settings || {}) } };
  } catch (e) { /* ignorieren */ }
  return JSON.parse(JSON.stringify(DEFAULTS));
}
let store = loadStore();
function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch (e) { /* voll/privat */ } }

// ============================================================ Zufall (deterministisch pro Level)
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}

// ============================================================ Levelgenerator
// [Spalten, Zeilen, Löcher auf dem Weg]
const TABLE = [[4, 3, 1], [5, 3, 2], [5, 4, 4], [6, 4, 6], [7, 5, 8], [8, 5, 10], [8, 6, 13], [9, 6, 16], [10, 7, 19]];
function levelConfig(n) { return n <= TABLE.length ? TABLE[n - 1] : [10, 7, 19 + (n - TABLE.length) * 2]; }

const N = 1, E = 2, S = 4, Wd = 8;
const DIRS = [ // dc, dr, Bit, Gegenbit
  [0, -1, N, S], [1, 0, E, Wd], [0, 1, S, N], [-1, 0, Wd, E],
];

function buildLevel(n, aspect = 1.43) {
  const W = Math.round(H * clamp(aspect, 1.2, 2.1));
  const [cols, rows, holeTarget] = levelConfig(n);
  const rng = mulberry32(n * 7919 + 1301);
  // Die äußere Holzleiste liegt direkt am Bildschirmrand; Felder dürfen leicht rechteckig sein
  const ox = WALL_T / 2, oy = WALL_T / 2;
  const mw = W - WALL_T, mh = H - WALL_T;
  const cw = mw / cols, ch = mh / rows, cell = Math.min(cw, ch);
  const total = cols * rows;
  const open = new Uint8Array(total);
  const id = (c, r) => r * cols + c;
  const cr = (i) => [i % cols, Math.floor(i / cols)];

  // --- Irrgarten (Backtracker)
  const seen = new Uint8Array(total);
  const stack = [Math.floor(rng() * total)];
  seen[stack[0]] = 1;
  while (stack.length) {
    const cur = stack[stack.length - 1];
    const [c, r] = cr(cur);
    const opts = [];
    for (const d of DIRS) {
      const nc = c + d[0], nr = r + d[1];
      if (nc >= 0 && nr >= 0 && nc < cols && nr < rows && !seen[id(nc, nr)]) opts.push(d);
    }
    if (!opts.length) { stack.pop(); continue; }
    const d = opts[Math.floor(rng() * opts.length)];
    const nxt = id(c + d[0], r + d[1]);
    open[cur] |= d[2]; open[nxt] |= d[3];
    seen[nxt] = 1; stack.push(nxt);
  }

  // --- längster Weg (zweimal Breitensuche)
  function bfs(from) {
    const dist = new Int32Array(total).fill(-1), prev = new Int32Array(total).fill(-1);
    const q = [from]; dist[from] = 0; let far = from;
    for (let qi = 0; qi < q.length; qi++) {
      const cur = q[qi]; const [c, r] = cr(cur);
      if (dist[cur] > dist[far]) far = cur;
      for (const d of DIRS) {
        if (!(open[cur] & d[2])) continue;
        const nx = id(c + d[0], r + d[1]);
        if (dist[nx] < 0) { dist[nx] = dist[cur] + 1; prev[nx] = cur; q.push(nx); }
      }
    }
    return { far, prev };
  }
  const a = bfs(0).far;
  const { far: b, prev } = bfs(a);
  const path = [];
  for (let cur = b; cur !== -1; cur = prev[cur]) path.push(cur);
  path.reverse(); // Start a … Ziel b
  if (rng() < 0.5) path.reverse();

  const pathIndex = new Int32Array(total).fill(-1);
  path.forEach((c, k) => { pathIndex[c] = k; });

  const cellX = (i) => ox + (i % cols) * cw;
  const cellY = (i) => oy + Math.floor(i / cols) * ch;
  const dirBetween = (p, q) => { const [pc, pr] = cr(p), [qc, qr] = cr(q); return [qc - pc, qr - pr]; };

  // --- Löcher auf dem Weg
  const difficulty = 0.25 + 0.75 * (n - 1) / (LEVEL_COUNT - 1);
  const holes = [];
  const waypoints = path.map((c) => ({ x: cellX(c) + cw / 2, y: cellY(c) + ch / 2 }));
  const minOff = WALL_T / 2 + HOLE_R + 4;
  const candidates = shuffle(path.slice(2, -2).map((c) => pathIndex[c]), rng);
  const chosen = new Set(candidates.slice(0, holeTarget));

  for (let k = 1; k < path.length - 1; k++) {
    const c = path[k], x0 = cellX(c), y0 = cellY(c);
    const [ix, iy] = dirBetween(path[k - 1], c); // Richtung hinein
    const [ex, ey] = dirBetween(c, path[k + 1]); // Richtung hinaus
    const straight = ix === ex && iy === ey;
    if (straight) {
      if (!chosen.has(k)) continue;
      const side = rng() < 0.5 ? -1 : 1;
      const P = ix !== 0 ? ch : cw, A = ix !== 0 ? cw : ch; // quer / längs zum Gang
      const maxOff = Math.min(P - WALL_T / 2 - (2 * BALL_R + 16) - HOLE_R, P / 2);
      const off = minOff + rng() * difficulty * Math.max(0, maxOff - minOff);
      const along = (rng() - 0.5) * A * 0.25;
      const gapMid = (off + HOLE_R + P - WALL_T / 2) / 2; // Mitte der freien Gasse
      if (ix !== 0) { // waagerechter Gang
        const hy = side < 0 ? y0 + off : y0 + ch - off;
        holes.push({ x: x0 + cw / 2 + along, y: hy, r: HOLE_R });
        waypoints[k].y = side < 0 ? y0 + gapMid : y0 + ch - gapMid;
      } else {
        const hx = side < 0 ? x0 + off : x0 + cw - off;
        holes.push({ x: hx, y: y0 + ch / 2 + along, r: HOLE_R });
        waypoints[k].x = side < 0 ? x0 + gapMid : x0 + cw - gapMid;
      }
    } else {
      // Kurve: Innenecke = Seite, von der wir kamen, + Seite, in die es weitergeht
      const sx = ix !== 0 ? -ix : ex;   // waagerechte Öffnung
      const sy = iy !== 0 ? -iy : ey;   // senkrechte Öffnung
      waypoints[k].x += sx * cw * 0.12;
      waypoints[k].y += sy * ch * 0.12;
      if (!chosen.has(k)) continue;
      const off = minOff + rng() * difficulty * Math.min(18, cell * 0.12);
      // Loch in die Außenecke – dort, wo der Schwung hinträgt
      const hx = sx > 0 ? x0 + off : x0 + cw - off;
      const hy = sy > 0 ? y0 + off : y0 + ch - off;
      holes.push({ x: hx, y: hy, r: HOLE_R });
    }
  }

  // --- Fallen in Sackgassen
  if (n >= 3) {
    const deadEnds = [];
    for (let i = 0; i < total; i++) {
      if (pathIndex[i] >= 0) continue;
      let cnt = 0; for (const d of DIRS) if (open[i] & d[2]) cnt++;
      if (cnt === 1) deadEnds.push(i);
    }
    shuffle(deadEnds, rng).slice(0, Math.floor(holeTarget / 3)).forEach((i) => {
      holes.push({ x: cellX(i) + cw / 2, y: cellY(i) + ch / 2, r: HOLE_R });
    });
  }

  // --- Wände (zusammenhängende Stücke zusammengefasst)
  const walls = [];
  const T = WALL_T;
  for (let r = 0; r <= rows; r++) {
    let run = -1;
    for (let c = 0; c <= cols; c++) {
      const closed = c < cols && (r === 0 || r === rows || !(open[id(c, r)] & N));
      if (closed && run < 0) run = c;
      if (!closed && run >= 0) {
        walls.push({ x: ox + run * cw - T / 2, y: oy + r * ch - T / 2, w: (c - run) * cw + T, h: T });
        run = -1;
      }
    }
  }
  for (let c = 0; c <= cols; c++) {
    let run = -1;
    for (let r = 0; r <= rows; r++) {
      const closed = r < rows && (c === 0 || c === cols || !(open[id(c, r)] & Wd));
      if (closed && run < 0) run = r;
      if (!closed && run >= 0) {
        walls.push({ x: ox + c * cw - T / 2, y: oy + run * ch - T / 2, w: T, h: (r - run) * ch + T });
        run = -1;
      }
    }
  }

  // --- Zwischenziele
  const step = path.length <= 14 ? 6 : 8; // halb so viele Zwischenziele
  const checkpoints = [];
  for (let k = step; k < path.length - 1; k += step) {
    checkpoints.push({ k, x: waypoints[k].x, y: waypoints[k].y, label: checkpoints.length + 1 });
  }

  const startP = waypoints[0], goalP = waypoints[path.length - 1];
  return {
    n, cols, rows, cell, cw, ch, ox, oy, mw, mh, W, H, aspect,
    walls, holes, waypoints, checkpoints,
    start: { x: startP.x, y: startP.y },
    goal: { x: goalP.x, y: goalP.y, r: GOAL_R },
    pathIndex,
  };
}

function pathIndexAt(L, x, y) {
  const c = Math.floor((x - L.ox) / L.cw), r = Math.floor((y - L.oy) / L.ch);
  if (c < 0 || r < 0 || c >= L.cols || r >= L.rows) return -1;
  return L.pathIndex[r * L.cols + c];
}

// ============================================================ Ton
// Rollgeräusch = leises, tiefes Grummeln des Holzbretts + feines Knistern der Maserung,
// beides an die Geschwindigkeit gekoppelt. Kein breitbandiges Rauschen (klingt nach Meer).
const Sound = (() => {
  let ctx = null, master, rumbleGain, rumbleLP, flutter, flutterDepth, white, lastHit = 0, grainAcc = 0;
  function init() {
    if (ctx) { if (ctx.state !== 'running') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = store.settings.sound ? 1 : 0; master.connect(ctx.destination);
    white = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = white.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Grummeln: Rauschen -> Tiefpass -> Holzresonanz -> Lautstärke (mit leichtem Flattern der Kugeldrehung)
    const src = ctx.createBufferSource(); src.buffer = white; src.loop = true;
    rumbleLP = ctx.createBiquadFilter(); rumbleLP.type = 'lowpass'; rumbleLP.frequency.value = 160; rumbleLP.Q.value = 0.5;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 420; lp2.Q.value = 0.5;
    const body = ctx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 190; body.Q.value = 4; body.gain.value = 9;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 60;
    rumbleGain = ctx.createGain(); rumbleGain.gain.value = 0;
    const flutterGain = ctx.createGain(); flutterGain.gain.value = 1;
    flutter = ctx.createOscillator(); flutter.frequency.value = 3;
    flutterDepth = ctx.createGain(); flutterDepth.gain.value = 0.25;
    flutter.connect(flutterDepth); flutterDepth.connect(flutterGain.gain); flutter.start();
    src.connect(rumbleLP); rumbleLP.connect(lp2); lp2.connect(body); body.connect(hp); hp.connect(flutterGain);
    flutterGain.connect(rumbleGain); rumbleGain.connect(master); src.start();
  }
  function setEnabled(on) { if (master) master.gain.value = on ? 1 : 0; }
  function roll(speed, dt = 0) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = Math.min(speed / 1600, 1);
    rumbleGain.gain.setTargetAtTime(speed < 8 ? 0 : 0.22 * Math.pow(v, 1.3), t, 0.04);
    rumbleLP.frequency.setTargetAtTime(110 + v * 260, t, 0.05);
    flutter.frequency.setTargetAtTime(Math.max(0.5, speed / (2 * Math.PI * BALL_R)), t, 0.1);
    // Knistern: ein winziges Klicken etwa alle 22 Einheiten Weg (Holzfasern)
    if (dt > 0 && speed > 15) {
      grainAcc += speed * dt / 22;
      let n = 0;
      while (grainAcc >= 1 && n < 6) {
        grainAcc -= 1; n++;
        const at = t + Math.random() * dt;
        burst(at, 0.006 + Math.random() * 0.006, 2200 + Math.random() * 2600, 2.5, (0.006 + 0.022 * v) * (0.4 + Math.random()), 'bandpass');
      }
    } else grainAcc = 0;
  }
  function burst(t, dur, freq, q, gain, type = 'bandpass') {
    const s = ctx.createBufferSource(); s.buffer = white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  }
  function tone(t, freq, dur, gain, type = 'sine') {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function hit(impact) {
    if (!ctx || impact < 60) return;
    const now = ctx.currentTime;
    if (now - lastHit < 0.035) return; lastHit = now;
    const v = Math.min(impact / 1100, 1);
    tone(now, 520 + Math.random() * 60, 0.05, 0.35 * v, 'triangle');   // Holzleiste
    burst(now, 0.025, 1500, 1.5, 0.3 * v);                                // Klack
    tone(now, 3300 + Math.random() * 400, 0.04, 0.05 * v, 'sine');        // Stahl
  }
  function drop() {
    if (!ctx) return; const t = ctx.currentTime;
    tone(t, 120, 0.18, 0.45); burst(t, 0.06, 700, 1, 0.3);
    [0.12, 0.2, 0.26, 0.3].forEach((dt, i) => {
      tone(t + dt, 480 - i * 30, 0.04, 0.22 / (i + 1), 'triangle');
      burst(t + dt, 0.02, 1500, 1.5, 0.15 / (i + 1));
    });
  }
  function checkpoint() { if (!ctx) return; const t = ctx.currentTime; tone(t, 880, 0.12, 0.1); tone(t + 0.07, 1320, 0.14, 0.08); }
  function win() {
    if (!ctx) return; const t = ctx.currentTime;
    // zwei leise, weiche Glockentöne statt Fanfare
    tone(t + 0.12, 659, 0.9, 0.045, 'sine'); tone(t + 0.12, 1318, 0.5, 0.012, 'sine');
    tone(t + 0.30, 880, 1.1, 0.04, 'sine'); tone(t + 0.30, 1760, 0.6, 0.01, 'sine');
  }
  function tick(hi) { if (!ctx) return; tone(ctx.currentTime, hi ? 1046 : 660, 0.12, 0.13, 'triangle'); }
  return { init, setEnabled, roll, hit, drop, checkpoint, win, tick };
})();

// ============================================================ Neigungssensor
const sensor = { ok: false, g: [0, 0, -1], samples: [] };
let basis = null; // Bezugssystem nach dem Ausrichten
const keys = { l: 0, r: 0, u: 0, d: 0 };

window.addEventListener('deviceorientation', (e) => {
  if (e.beta == null || e.gamma == null) return;
  sensor.ok = true;
  const b = e.beta * Math.PI / 180, g = e.gamma * Math.PI / 180;
  // Schwerkraftrichtung im Gerätesystem (x rechts, y oben, z aus dem Bildschirm)
  sensor.g = [Math.sin(g) * Math.cos(b), -Math.sin(b), -Math.cos(g) * Math.cos(b)];
  if (sensor.samples.length > 40) sensor.samples.shift();
  sensor.samples.push(sensor.g);
});

const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function makeBasis(g0) {
  const z = norm(g0);
  const X = [1, 0, 0], Y = [0, 1, 0];
  const px = dot(X, z); const ex = norm([X[0] - px * z[0], X[1] - px * z[1], X[2] - px * z[2]]);
  const py = dot(Y, z), qy = dot(Y, ex);
  const ey = norm([Y[0] - py * z[0] - qy * ex[0], Y[1] - py * z[1] - qy * ex[1], Y[2] - py * z[2] - qy * ex[2]]);
  return { ex, ey };
}
function calibrate() {
  const sm = sensor.samples.slice(-12);
  if (!sm.length) { basis = makeBasis([0, 0, -1]); return; }
  const avg = [0, 0, 0];
  sm.forEach((v) => { avg[0] += v[0]; avg[1] += v[1]; avg[2] += v[2]; });
  basis = makeBasis(avg);
}
function screenAngle() {
  if (typeof window.orientation === 'number') return window.orientation;
  if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
  return 0;
}
const tilt = { x: 0, y: 0 };
function readTilt() {
  let tx = 0, ty = 0;
  if (keys.l || keys.r || keys.u || keys.d) {
    tx = (keys.r - keys.l) * 0.16; ty = (keys.d - keys.u) * 0.16;
  } else if (sensor.ok) {
    const b = basis || makeBasis([0, 0, -1]);
    const dx = dot(sensor.g, b.ex);          // Gerät: nach rechts
    const dy = -dot(sensor.g, b.ey);         // Gerät: nach unten (Hochformat)
    const a = (screenAngle() + view.rot) * Math.PI / 180;
    const ca = Math.round(Math.cos(a)), sa = Math.round(Math.sin(a));
    tx = dx * ca + dy * sa;
    ty = -dx * sa + dy * ca;
  }
  const m = Math.hypot(tx, ty);
  if (m > MAX_TILT) { tx *= MAX_TILT / m; ty *= MAX_TILT / m; }
  tilt.x += (tx - tilt.x) * 0.45;
  tilt.y += (ty - tilt.y) * 0.45;
}

const KEYMAP = { ArrowLeft: 'l', ArrowRight: 'r', ArrowUp: 'u', ArrowDown: 'd', a: 'l', d: 'r', w: 'u', s: 'd' };
window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.key]; if (k) { keys[k] = 1; e.preventDefault(); }
  if (e.key === 'Escape' || e.key === 'p') { if (game.mode === 'play') pauseGame(); else if (game.mode === 'paused') resumeGame(); }
});
window.addEventListener('keyup', (e) => { const k = KEYMAP[e.key]; if (k) keys[k] = 0; });

async function requestMotion() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      if (r !== 'granted') toast('Ohne Zugriff auf „Bewegung & Ausrichtung“ lässt sich die Kugel nicht steuern. Erlaube es in den Einstellungen für Safari bzw. beim nächsten Start.', 6000);
    }
  } catch (e) { /* kein Popup möglich */ }
}

// ============================================================ Darstellung
const canvas = $('#board');
const ctx = canvas.getContext('2d');
const staticCanvas = document.createElement('canvas');
const sctx = staticCanvas.getContext('2d');
const view = { scale: 1, ox: 0, oy: 0, dpr: 1, w: 0, h: 0, rot: 0 };

function woodGrain(c, rng, x, y, w, h, opts) {
  const { lines, alpha, dark, vertical } = opts;
  c.save();
  c.beginPath(); c.rect(x, y, w, h); c.clip();
  const len = vertical ? h : w, span = vertical ? w : h;
  for (let i = 0; i < lines; i++) {
    const base = rng() * span, amp = 2 + rng() * 9, f = 0.004 + rng() * 0.012, ph = rng() * 6.28;
    const amp2 = rng() * 3, f2 = 0.03 + rng() * 0.05;
    c.beginPath();
    for (let t = -10; t <= len + 10; t += 14) {
      const o = base + Math.sin(t * f + ph) * amp + Math.sin(t * f2 + ph * 2) * amp2;
      if (vertical) { if (t < 0) c.moveTo(x + o, y + t); else c.lineTo(x + o, y + t); }
      else { if (t < 0) c.moveTo(x + t, y + o); else c.lineTo(x + t, y + o); }
    }
    c.strokeStyle = `rgba(${dark},${(alpha * (0.4 + rng() * 0.9)).toFixed(3)})`;
    c.lineWidth = 0.6 + rng() * 2.2;
    c.stroke();
  }
  c.restore();
}

function drawHole(c, h, goal) {
  // dunkler Rand im Holz
  c.beginPath(); c.arc(h.x, h.y, h.r + 2.2, 0, Math.PI * 2);
  c.fillStyle = 'rgba(70,40,15,.55)'; c.fill();
  const g = c.createRadialGradient(h.x + h.r * 0.25, h.y + h.r * 0.3, h.r * 0.1, h.x, h.y, h.r);
  g.addColorStop(0, '#040201'); g.addColorStop(0.7, '#120a04'); g.addColorStop(1, '#3d2712');
  c.beginPath(); c.arc(h.x, h.y, h.r, 0, Math.PI * 2); c.fillStyle = g; c.fill();
  c.beginPath(); c.arc(h.x, h.y, h.r + 0.6, Math.PI * 0.05, Math.PI * 0.75);
  c.strokeStyle = 'rgba(255,236,200,.45)'; c.lineWidth = 1.6; c.stroke();
  if (goal) {
    for (const [rr, col, lw] of [[h.r + 9, '#b3261e', 5], [h.r + 17, '#b3261e', 3]]) {
      c.beginPath(); c.arc(h.x, h.y, rr, 0, Math.PI * 2); c.strokeStyle = col; c.lineWidth = lw; c.stroke();
    }
  }
}

function label(c, text, x, y, size, color) {
  c.font = `800 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(text, x, y);
}

function renderStatic() {
  const L = game.level; if (!L) return;
  staticCanvas.width = canvas.width; staticCanvas.height = canvas.height;
  const c = sctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
  c.setTransform(view.scale * view.dpr, 0, 0, view.scale * view.dpr, view.ox * view.dpr, view.oy * view.dpr);
  const rng = mulberry32(L.n * 31 + 7);

  // Boden (Birke) über das ganze Brett
  const bg = c.createLinearGradient(0, 0, L.W, L.H);
  bg.addColorStop(0, '#ead0a2'); bg.addColorStop(1, '#dcbc8a');
  c.fillStyle = bg; c.fillRect(0, 0, L.W, L.H);
  woodGrain(c, rng, 0, 0, L.W, L.H, { lines: 120, alpha: 0.09, dark: '120,78,34', vertical: false });

  // Leitlinie
  const wp = L.waypoints;
  c.beginPath(); c.moveTo(wp[0].x, wp[0].y);
  for (let i = 1; i < wp.length - 1; i++) {
    c.quadraticCurveTo(wp[i].x, wp[i].y, (wp[i].x + wp[i + 1].x) / 2, (wp[i].y + wp[i + 1].y) / 2);
  }
  c.lineTo(wp[wp.length - 1].x, wp[wp.length - 1].y);
  c.strokeStyle = 'rgba(28,18,10,.82)'; c.lineWidth = 3.4; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();

  // Start
  c.beginPath(); c.arc(L.start.x, L.start.y, BALL_R + 7, 0, Math.PI * 2);
  c.strokeStyle = 'rgba(28,18,10,.82)'; c.lineWidth = 3; c.stroke();
  if (L.cell >= 150) label(c, 'START', L.start.x, L.start.y + BALL_R + 22, 15, 'rgba(28,18,10,.8)');

  // Löcher + Ziel
  L.holes.forEach((h) => drawHole(c, h, false));
  drawHole(c, L.goal, true);
  if (L.cell >= 150) label(c, 'ZIEL', L.goal.x, L.goal.y + GOAL_R + 30, 15, '#b3261e');

  // Zwischenziele (Nummern)
  L.checkpoints.forEach((p) => {
    c.beginPath(); c.arc(p.x, p.y, 11, 0, Math.PI * 2);
    c.fillStyle = '#fbf3e3'; c.fill(); c.strokeStyle = 'rgba(28,18,10,.85)'; c.lineWidth = 2; c.stroke();
    label(c, String(p.label), p.x, p.y + 0.5, 12.5, '#1c120a');
  });

  // Wandschatten
  c.save(); c.shadowColor = 'rgba(45,22,6,.5)'; c.shadowBlur = 9; c.shadowOffsetX = 5; c.shadowOffsetY = 7;
  c.fillStyle = '#7a4c26';
  L.walls.forEach((w) => c.fillRect(w.x, w.y, w.w, w.h));
  c.restore();
  // Wände
  L.walls.forEach((w) => {
    const horiz = w.w > w.h;
    const g = horiz ? c.createLinearGradient(0, w.y, 0, w.y + w.h) : c.createLinearGradient(w.x, 0, w.x + w.w, 0);
    g.addColorStop(0, '#d39d63'); g.addColorStop(0.5, '#c08850'); g.addColorStop(1, '#a8733f');
    c.fillStyle = g; c.fillRect(w.x, w.y, w.w, w.h);
    woodGrain(c, rng, w.x, w.y, w.w, w.h, { lines: Math.max(2, Math.round(Math.max(w.w, w.h) / 120)), alpha: 0.22, dark: '90,50,18', vertical: !horiz });
    c.strokeStyle = 'rgba(255,238,205,.55)'; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(w.x + 0.6, w.y + w.h - 0.6); c.lineTo(w.x + 0.6, w.y + 0.6); c.lineTo(w.x + w.w - 0.6, w.y + 0.6); c.stroke();
    c.strokeStyle = 'rgba(70,38,12,.5)';
    c.beginPath(); c.moveTo(w.x + w.w - 0.6, w.y + 0.6); c.lineTo(w.x + w.w - 0.6, w.y + w.h - 0.6); c.lineTo(w.x + 0.6, w.y + w.h - 0.6); c.stroke();
  });
}

function drawBall(c, x, y, s, dark) {
  const r = BALL_R * s;
  // Schatten
  if (s > 0.9) {
    const sg = c.createRadialGradient(x + 4, y + 6, r * 0.2, x + 4, y + 6, r * 1.25);
    sg.addColorStop(0, 'rgba(30,15,5,.5)'); sg.addColorStop(1, 'rgba(30,15,5,0)');
    c.fillStyle = sg; c.beginPath(); c.arc(x + 4, y + 6, r * 1.25, 0, Math.PI * 2); c.fill();
  }
  const g = c.createRadialGradient(x - r * 0.38, y - r * 0.42, r * 0.05, x, y, r);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, '#eef1f4'); g.addColorStop(0.5, '#a9b0b8');
  g.addColorStop(0.82, '#5d646d'); g.addColorStop(1, '#2c3036');
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fillStyle = g; c.fill();
  // Spiegelung des Holzbodens unten
  const rg = c.createLinearGradient(0, y + r * 0.2, 0, y + r);
  rg.addColorStop(0, 'rgba(214,170,110,0)'); rg.addColorStop(1, 'rgba(214,170,110,.45)');
  c.fillStyle = rg; c.beginPath(); c.arc(x, y, r * 0.96, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(x - r * 0.36, y - r * 0.4, r * 0.18, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,.95)'; c.fill();
  if (dark > 0) { c.beginPath(); c.arc(x, y, r + 0.5, 0, Math.PI * 2); c.fillStyle = `rgba(10,5,2,${dark})`; c.fill(); }
}

function render() {
  const L = game.level; if (!L) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(staticCanvas, 0, 0);
  ctx.setTransform(view.scale * view.dpr, 0, 0, view.scale * view.dpr, view.ox * view.dpr, view.oy * view.dpr);

  // erreichte Zwischenziele markieren
  if (store.settings.checkpoints) {
    for (let i = 0; i < game.cpReached && i < L.checkpoints.length; i++) {
      const p = L.checkpoints[i];
      ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fillStyle = '#3d8a40'; ctx.fill();
      ctx.strokeStyle = 'rgba(28,18,10,.85)'; ctx.lineWidth = 2; ctx.stroke();
      label(ctx, String(p.label), p.x, p.y + 0.5, 12.5, '#fff');
    }
  }

  const b = game.ball;
  if (b.state === 'gone') return;
  if (b.state === 'falling') {
    const t = clamp(b.fallT / FALL_T, 0, 1), e = t * (2 - t);
    drawBall(ctx, b.x + (b.fx - b.x) * e, b.y + (b.fy - b.y) * e, 1 - 0.5 * e, 0.95 * e);
  } else if (b.state === 'held' && Math.floor(b.heldT * 8) % 2 === 1) {
    ctx.globalAlpha = 0.45; drawBall(ctx, b.x, b.y, 1, 0); ctx.globalAlpha = 1;
  } else {
    drawBall(ctx, b.x, b.y, 1, 0);
  }
}

// Immer Querformat: steht der Bildschirm hochkant (z. B. Ausrichtungssperre), wird die ganze App um 90° gedreht
const appEl = $('#app');
function applyRotation() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const portrait = vh > vw;
  const rot = portrait ? (store.settings.rot === -90 ? -90 : 90) : 0;
  view.rot = rot;
  if (!rot) {
    appEl.style.width = '100%'; appEl.style.height = '100%'; appEl.style.transform = '';
  } else {
    appEl.style.width = vh + 'px'; appEl.style.height = vw + 'px';
    appEl.style.transform = rot === 90 ? `translateX(${vw}px) rotate(90deg)` : `translateY(${vh}px) rotate(-90deg)`;
  }
  $('#btnRotate').hidden = !rot || $('#scrMenu').hidden;
}
function setRotation(r) {
  if (store.settings.rot === r) return;
  store.settings.rot = r; save(); layout();
}
// im Menü automatisch die richtige Seite nach oben drehen (im Spiel nie, sonst kippt das Bild beim Neigen)
function autoRotate() {
  if (!view.rot || game.mode !== 'menu' || !sensor.ok) return;
  const a = screenAngle() * Math.PI / 180, ca = Math.round(Math.cos(a)), sa = Math.round(Math.sin(a));
  const gx = sensor.g[0], gyDown = -sensor.g[1];
  const sx = gx * ca + gyDown * sa; // Schwerkraft nach rechts auf dem (hochkanten) Bildschirm
  if (sx < -0.5) setRotation(90); else if (sx > 0.5) setRotation(-90);
}

function stageAspect() {
  const st = $('#stage');
  return st.offsetWidth / Math.max(1, st.offsetHeight);
}
function layout() {
  applyRotation();
  const stageEl = $('#stage');
  const rect = { width: stageEl.offsetWidth, height: stageEl.offsetHeight };
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  view.dpr = dpr; view.w = rect.width; view.h = rect.height;
  canvas.width = Math.round(rect.width * dpr); canvas.height = Math.round(rect.height * dpr);
  if (!game.base) return;
  // Brett an das Seitenverhältnis anpassen (außer mitten im Spiel)
  const aspect = rect.width / Math.max(1, rect.height);
  if (Math.abs(aspect - game.base.aspect) > 0.01 && (game.mode === 'menu' || game.mode === 'won')) {
    game.base = buildLevel(game.base.n, aspect);
    if (game.mode === 'menu') placeBall(game.base.start);
  }
  const L = game.level = game.base;
  view.scale = Math.min(rect.width / L.W, rect.height / L.H);
  view.ox = (rect.width - L.W * view.scale) / 2;
  view.oy = (rect.height - L.H * view.scale) / 2;
  renderStatic();
  render();
}

// ============================================================ Spiel
const game = {
  mode: 'menu', // menu | countdown | play | paused | won
  n: 1, base: null, level: null,
  ball: { x: 0, y: 0, vx: 0, vy: 0, fx: 0, fy: 0, state: 'held', fallT: 0, heldT: 0, toGoal: false },
  time: 0, falls: 0, cpReached: 0, cdT: 0, cdStep: 0, cdThen: 'play',
};

function startLevel(n) {
  Sound.init();
  game.n = n;
  game.base = buildLevel(n, stageAspect());
  game.level = game.base;
  game.time = 0; game.falls = 0; game.cpReached = 0;
  showScreen(null);
  $('#hud').hidden = false; $('#btnRotate').hidden = true;
  $('#barTitle').textContent = `Level ${n}`;
  layout();
  placeBall(game.level.start);
  updateHud();
  startCountdown();
  requestWake();
}

function placeBall(p) {
  const b = game.ball;
  b.x = p.x; b.y = p.y; b.vx = 0; b.vy = 0; b.state = 'held'; b.heldT = 0; b.fallT = 0;
}

function startCountdown() {
  game.mode = 'countdown'; game.cdT = 0; game.cdStep = 3;
  $('#countdown').hidden = false; setCd('3'); Sound.tick(false);
}
function setCd(t) {
  const el = $('#cdNum'); el.textContent = t;
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
}

function pauseGame() {
  if (game.mode !== 'play' && game.mode !== 'countdown') return;
  game.mode = 'paused'; $('#countdown').hidden = true; Sound.roll(0);
  showScreen('#scrPause');
}
function resumeGame() {
  showScreen(null); Sound.init();
  game.ball.state = game.ball.state === 'roll' ? 'held' : game.ball.state; game.ball.heldT = 0;
  startCountdown();
}

function respawn() {
  const L = game.level;
  let p = L.start;
  if (store.settings.checkpoints && game.cpReached > 0) p = L.checkpoints[game.cpReached - 1];
  placeBall(p);
}

function win() {
  game.mode = 'won'; Sound.roll(0); Sound.win(); releaseWake();
  const n = game.n, t = game.time;
  const prevBest = store.best[n];
  const record = !prevBest || t < prevBest;
  if (record) store.best[n] = t;
  if (n < LEVEL_COUNT) store.unlocked = Math.max(store.unlocked, n + 1);
  save();
  $('#winTitle').textContent = n === LEVEL_COUNT ? 'Alle Level geschafft!' : 'Geschafft!';
  $('#winTime').textContent = fmt(t);
  $('#winFalls').textContent = game.falls;
  $('#winBest').textContent = fmt(store.best[n]);
  $('#winRecord').hidden = !(record && prevBest);
  $('#btnNext').hidden = n >= LEVEL_COUNT;
  setTimeout(() => { if (game.mode === 'won') showScreen('#scrWin'); }, 450);
}

function physics(dt) {
  const L = game.level, b = game.ball;
  const sens = SENS[store.settings.sens] ?? 1;
  const ax = G_BASE * sens * tilt.x, ay = G_BASE * sens * tilt.y;
  const sp0 = Math.hypot(b.vx, b.vy);
  const sub = clamp(Math.ceil((sp0 * dt) / (BALL_R * 0.35)), 1, 16);
  const h = dt / sub;
  let impact = 0;
  for (let s = 0; s < sub; s++) {
    b.vx += ax * h; b.vy += ay * h;
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0) { const dec = Math.min(sp, ROLL_RES * h); b.vx -= (b.vx / sp) * dec; b.vy -= (b.vy / sp) * dec; }

    // Löcher: Sog am Rand, Fall ab der Mitte
    for (let i = -1; i < L.holes.length; i++) {
      const ho = i < 0 ? L.goal : L.holes[i];
      const dx = ho.x - b.x, dy = ho.y - b.y, d = Math.hypot(dx, dy);
      if (d < ho.r) {
        if (d < ho.r - BALL_R * 0.15) {
          b.state = 'falling'; b.fallT = 0; b.fx = ho.x; b.fy = ho.y; b.toGoal = i < 0;
          Sound.roll(0); if (i >= 0) Sound.drop(); return;
        }
        const pull = 6500 * (1 - d / ho.r) + 1600;
        b.vx += (dx / d) * pull * h; b.vy += (dy / d) * pull * h;
      }
    }

    b.x += b.vx * h; b.y += b.vy * h;

    for (const w of L.walls) {
      const cx = clamp(b.x, w.x, w.x + w.w), cy = clamp(b.y, w.y, w.y + w.h);
      let dx = b.x - cx, dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= BALL_R * BALL_R) continue;
      let nx, ny, pen;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2); nx = dx / d; ny = dy / d; pen = BALL_R - d;
      } else { // Mittelpunkt in der Wand: kürzester Weg hinaus
        const l = b.x - w.x, r = w.x + w.w - b.x, t = b.y - w.y, bo = w.y + w.h - b.y;
        const m = Math.min(l, r, t, bo);
        nx = m === l ? -1 : m === r ? 1 : 0; ny = m === t ? -1 : m === bo ? 1 : 0;
        if (nx && ny) ny = 0;
        pen = BALL_R + m;
      }
      b.x += nx * pen; b.y += ny * pen;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        b.vx -= (1 + RESTITUTION) * vn * nx; b.vy -= (1 + RESTITUTION) * vn * ny;
        const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty;
        b.vx -= vt * 0.03 * tx; b.vy -= vt * 0.03 * ty;
      }
    }
  }
  // Sicherheitsnetz: nie aus dem Labyrinth heraus
  b.x = clamp(b.x, L.ox + BALL_R, L.ox + L.mw - BALL_R);
  b.y = clamp(b.y, L.oy + BALL_R, L.oy + L.mh - BALL_R);
  Sound.hit(impact);
  Sound.roll(Math.hypot(b.vx, b.vy), dt);

  if (store.settings.checkpoints) {
    const k = pathIndexAt(L, b.x, b.y);
    const next = L.checkpoints[game.cpReached];
    if (next && k >= next.k && Math.hypot(b.x - next.x, b.y - next.y) < L.cell * 0.45) {
      game.cpReached++; Sound.checkpoint();
    }
  }
}

let lastT = 0, hudT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - (lastT || now)) / 1000, 1 / 30);
  lastT = now;
  autoRotate();
  if (!game.level) return;
  readTilt();
  const b = game.ball;

  if (game.mode === 'countdown') {
    game.cdT += dt;
    if (game.cdT >= 0.6) {
      game.cdT -= 0.6; game.cdStep--;
      if (game.cdStep > 0) { setCd(String(game.cdStep)); Sound.tick(false); }
      else if (game.cdStep === 0) { setCd('Los!'); Sound.tick(true); calibrate(); }
      else {
        $('#countdown').hidden = true; game.mode = 'play'; b.state = 'roll';
        if (!sensor.ok && !game.warnedSensor) {
          game.warnedSensor = true;
          toast('Keine Neigungssensoren gefunden – auf dem Computer steuerst du mit den Pfeiltasten.', 5000);
        }
      }
    }
  } else if (game.mode === 'play') {
    game.time += dt;
    if (b.state === 'roll') physics(dt);
    else if (b.state === 'falling') {
      b.fallT += dt;
      if (b.fallT > FALL_T) {
        if (b.toGoal) { b.state = 'gone'; win(); }
        else { b.state = 'gone'; b.fallT = 0; game.falls++; updateHud(); setTimeout(() => { if (game.mode === 'play' || game.mode === 'paused') respawn(); }, 250); }
      }
    } else if (b.state === 'held') {
      b.heldT += dt; if (b.heldT > 0.55) b.state = 'roll';
    }
    hudT += dt; if (hudT > 0.1) { hudT = 0; updateHud(); }
  }
  render();
}

// ============================================================ Oberfläche
function fmt(t) {
  if (t == null) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}
function updateHud() {
  $('#statTime').textContent = fmt(game.time);
  $('#statFalls').textContent = game.falls;
}
let toastTimer = 0;
function toast(msg, ms = 3000) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const SCREENS = ['#scrMenu', '#scrLevels', '#scrSettings', '#scrPause', '#scrWin'];
let backTarget = '#scrMenu';
function showScreen(sel) {
  SCREENS.forEach((s) => { $(s).hidden = s !== sel; });
}
function goMenu() {
  game.mode = 'menu'; Sound.roll(0); releaseWake();
  $('#hud').hidden = true;
  $('#btnRotate').hidden = !view.rot;
  $('#countdown').hidden = true;
  showScreen('#scrMenu');
}

function buildLevelGrid() {
  const grid = $('#levelGrid'); grid.innerHTML = '';
  for (let n = 1; n <= LEVEL_COUNT; n++) {
    const btn = document.createElement('button');
    const locked = n > store.unlocked;
    btn.className = 'lvl' + (locked ? ' locked' : store.best[n] != null ? ' done' : n === store.unlocked ? ' current' : '');
    btn.innerHTML = `${n}<small>${locked ? '🔒' : store.best[n] != null ? fmt(store.best[n]) : 'neu'}</small>`;
    btn.disabled = locked;
    btn.addEventListener('click', () => { requestMotion(); startLevel(n); });
    grid.appendChild(btn);
  }
}
function openLevels(from) { backTarget = from; buildLevelGrid(); showScreen('#scrLevels'); }

function bindSeg(sel, get, set) {
  const seg = $(sel);
  const refresh = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', String(get()) === b.dataset.v));
  seg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; set(b.dataset.v); save(); refresh(); });
  refresh();
  return refresh;
}
const refreshers = [
  bindSeg('#segSens', () => store.settings.sens, (v) => { store.settings.sens = +v; }),
  bindSeg('#segCp', () => (store.settings.checkpoints ? 1 : 0), (v) => { store.settings.checkpoints = v === '1'; }),
  bindSeg('#segSound', () => (store.settings.sound ? 1 : 0), (v) => { store.settings.sound = v === '1'; Sound.init(); Sound.setEnabled(store.settings.sound); }),
];

$('#btnRotate').addEventListener('click', () => setRotation(view.rot === 90 ? -90 : 90));
$('#btnPlay').addEventListener('click', () => { requestMotion(); startLevel(Math.min(store.unlocked, LEVEL_COUNT)); });
$('#btnLevels').addEventListener('click', () => openLevels('#scrMenu'));
$('#btnSettings').addEventListener('click', () => { refreshers.forEach((r) => r()); showScreen('#scrSettings'); });
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showScreen(backTarget === '#scrPause' && game.mode === 'paused' ? '#scrPause' : backTarget === '#scrWin' ? '#scrWin' : '#scrMenu')));
$('#btnReset').addEventListener('click', () => {
  if (!confirm('Alle Bestzeiten und freigeschalteten Level löschen?')) return;
  store.unlocked = 1; store.best = {}; save(); toast('Fortschritt gelöscht');
});
$('#btnPause').addEventListener('click', () => { if (game.mode === 'paused') resumeGame(); else pauseGame(); });
$('#btnResume').addEventListener('click', resumeGame);
$('#btnRestart').addEventListener('click', () => { requestMotion(); startLevel(game.n); });
$('#btnCalib').addEventListener('click', () => { requestMotion(); resumeGame(); });
$('#btnPauseLevels').addEventListener('click', () => openLevels('#scrPause'));
$('#btnPauseMenu').addEventListener('click', goMenu);
$('#btnNext').addEventListener('click', () => { requestMotion(); startLevel(game.n + 1); });
$('#btnAgain').addEventListener('click', () => { requestMotion(); startLevel(game.n); });
$('#btnWinLevels').addEventListener('click', () => openLevels('#scrWin'));

document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
window.addEventListener('resize', () => setTimeout(layout, 60));
window.addEventListener('orientationchange', () => setTimeout(layout, 250));
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => { if (!e.target.closest('.scroll')) e.preventDefault(); }, { passive: false });

// Bildschirm wach halten
let wakeLock = null;
async function requestWake() {
  try { if ('wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); } } catch (e) { /* egal */ }
}
function releaseWake() { try { if (wakeLock) wakeLock.release(); } catch (e) { /* egal */ } wakeLock = null; }

// Hintergrund im Menü: das nächste Level als Vorschau
applyRotation();
game.base = buildLevel(Math.min(store.unlocked, LEVEL_COUNT), stageAspect());
game.n = game.base.n;
game.level = game.base;
layout();
placeBall(game.level.start);
showScreen('#scrMenu');
requestAnimationFrame(frame);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}

// für Tests
window.__laby = { game, buildLevel, tilt, sensor, keys, startLevel, view };
})();
