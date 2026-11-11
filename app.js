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
const MAX_FALLS = 2;                             // beim zweiten Loch ist das Level verloren
const G_FALL = 9000;                             // Fallbeschleunigung senkrecht zum Brett
const GONE_Z = BALL_R + 46;                      // so tief unter dem Brett ist die Kugel nicht mehr zu sehen
const TAU = Math.PI * 2;
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
// Die Bahnen werden schnell schmaler: ab Level 9 das engste Raster (Felder ca. 100 Einheiten)
const TABLE = [[5, 3, 1], [6, 4, 3], [7, 5, 6], [8, 5, 9], [9, 6, 12], [10, 7, 16], [11, 7, 20], [11, 8, 24], [12, 8, 27]];
function levelConfig(n) { return n <= TABLE.length ? TABLE[n - 1] : [12, 8, 27 + (n - TABLE.length) * 3]; }
const MIN_CELL = 100;

const N = 1, E = 2, S = 4, Wd = 8;
const DIRS = [ // dc, dr, Bit, Gegenbit
  [0, -1, N, S], [1, 0, E, Wd], [0, 1, S, N], [-1, 0, Wd, E],
];

function buildLevel(n, aspect = 1.43) {
  const W = Math.round(H * clamp(aspect, 1.2, 2.1));
  const cfg = levelConfig(n), holeTarget = cfg[2];
  const cols = Math.min(cfg[0], Math.floor((W - WALL_T) / MIN_CELL)), rows = Math.min(cfg[1], Math.floor((H - WALL_T) / MIN_CELL));
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
        walls.push({ x: ox + run * cw - T / 2, y: oy + r * ch - T / 2, w: (c - run) * cw + T, h: T, frame: r === 0 || r === rows });
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
        walls.push({ x: ox + c * cw - T / 2, y: oy + run * ch - T / 2, w: T, h: (r - run) * ch + T, frame: c === 0 || c === cols });
        run = -1;
      }
    }
  }

  // --- Zwischenziele
  const step = path.length <= 14 ? 10 : 13; // wenige Zwischenziele
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
// Physikalisch angelehnte Klänge:
//  - Rollen: ein raues "Oberflächenprofil" wird umso schneller abgetastet, je schneller die Kugel rollt,
//    und regt die festen Resonanzen des hohlen Holzkastens an.
//  - Stöße: kurze, stark gedämpfte Eigenschwingungen der Holzleiste (Stabmoden 1 : 2,76 : 5,4) + Kontaktklick.
//  - Loch: Ticken am Lochrand, dumpfer Aufschlag im Kasten, kleine Hüpfer, Ausrollen in der Rinne.
const Sound = (() => {
  let ctx = null, master, white, surf, rollSrc, rollGain, rollLP, lastHit = -1, lastRim = -1;
  const frac = (v) => v - Math.floor(v);

  function init(testCtx) {
    if (ctx && !testCtx) { if (ctx.state !== 'running') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC && !testCtx) return;
    ctx = testCtx || new AC(); lastHit = -1; lastRim = -1;
    master = ctx.createGain(); master.gain.value = store.settings.sound ? 1 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = 0.002; comp.release.value = 0.15;
    master.connect(comp); comp.connect(ctx.destination);

    const sr = ctx.sampleRate;
    white = ctx.createBuffer(1, sr, sr);
    const wd = white.getChannelData(0);
    for (let i = 0; i < wd.length; i++) wd[i] = Math.random() * 2 - 1;

    // Oberflächenprofil: geglättetes Rauschen (Holzfasern) + vereinzelte kleine Unebenheiten
    surf = ctx.createBuffer(1, sr * 3, sr);
    const sd = surf.getChannelData(0);
    let a = 0, b2 = 0;
    for (let i = 0; i < sd.length; i++) {
      const w = Math.random() * 2 - 1;
      a += 0.22 * (w - a);
      const bump = Math.random() < 0.0035 ? (Math.random() * 2 - 1) * 4 : 0;
      b2 += 0.45 * (w * 0.25 + bump - b2);
      sd[i] = a * 0.7 + b2 * 0.8;
    }
    const fade = 400;
    for (let i = 0; i < fade; i++) { const k = i / fade; sd[i] *= k; sd[sd.length - 1 - i] *= k; }

    rollSrc = ctx.createBufferSource(); rollSrc.buffer = surf; rollSrc.loop = true; rollSrc.playbackRate.value = 0.1;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 70;
    rollLP = ctx.createBiquadFilter(); rollLP.type = 'lowpass'; rollLP.frequency.value = 900; rollLP.Q.value = 0.4;
    rollGain = ctx.createGain(); rollGain.gain.value = 0;
    rollSrc.connect(hp);
    // Resonanzen von Brett und Kasten
    [[150, 2.5, 1.0], [310, 4, 0.8], [640, 5, 0.5], [1250, 4, 0.3], [2400, 3, 0.14]].forEach(([f, q, g]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const gg = ctx.createGain(); gg.gain.value = g;
      hp.connect(bp); bp.connect(gg); gg.connect(rollLP);
    });
    const direct = ctx.createGain(); direct.gain.value = 0.2; hp.connect(direct); direct.connect(rollLP);
    rollLP.connect(rollGain); rollGain.connect(master);
    rollSrc.start();
  }
  function setEnabled(on) { if (master) master.gain.value = on ? 1 : 0; }

  function roll(speed) {
    if (!ctx) return;
    const t = ctx.currentTime, v = Math.min(speed / 1500, 1);
    rollGain.gain.setTargetAtTime(speed < 6 ? 0 : 0.55 * Math.pow(v, 1.1), t, 0.03);
    rollSrc.playbackRate.setTargetAtTime(clamp(speed / 520, 0.06, 3.2), t, 0.04);
    rollLP.frequency.setTargetAtTime(700 + v * 3800, t, 0.05);
  }

  // eine gedämpfte Eigenschwingung
  function mode(t, f, g, tau, dest) {
    const o = ctx.createOscillator(); o.frequency.value = f;
    const e = ctx.createGain(); e.gain.setValueAtTime(g, t); e.gain.setTargetAtTime(0, t, tau);
    o.connect(e); e.connect(dest || master); o.start(t); o.stop(t + tau * 7 + 0.01);
  }
  function burst(t, dur, freq, q, gain, type = 'bandpass', dest) {
    const s = ctx.createBufferSource(); s.buffer = white;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || master); s.start(t, Math.random() * 0.9); s.stop(t + dur + 0.02);
  }
  function tone(t, freq, dur, gain, type = 'sine') {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }

  // Stahlkugel gegen Holzleiste; jede Leiste hat ihre eigene Tonhöhe, der Rahmen klingt tiefer
  function hit(impact, wallIdx = 0, frame = false) {
    if (!ctx || impact < 45) return;
    const now = ctx.currentTime;
    if (now - lastHit < 0.03) return; lastHit = now;
    const v = Math.min(impact / 1300, 1), amp = 0.8 * Math.pow(v, 0.8);
    const seed = frac(Math.sin((wallIdx + 1) * 12.9898) * 43758.5453);
    const f0 = (frame ? 290 + seed * 90 : 430 + seed * 330) * (0.985 + Math.random() * 0.03);
    const long = frame ? 1.4 : 1;
    mode(now, f0, amp, 0.022 * long);
    mode(now, f0 * 2.76, amp * 0.5 * (0.35 + v), 0.012 * long);
    mode(now, f0 * 5.4, amp * 0.3 * v, 0.006);
    mode(now, 170, amp * 0.6, 0.028);                               // Brett schwingt mit
    burst(now, 0.004 + 0.004 * v, 3000 + 2500 * v, 0.7, amp * 0.7, 'highpass'); // Kontakt
  }
  // Kugel tickt an Lochrand oder Lochwand
  function rim(impact) {
    if (!ctx || impact < 110) return;
    const now = ctx.currentTime;
    if (now - lastRim < 0.025) return; lastRim = now;
    const v = Math.min(impact / 900, 1), amp = 0.3 * Math.pow(v, 0.8), f = 560 + Math.random() * 160;
    mode(now, f, amp, 0.012); mode(now, f * 2.6, amp * 0.4, 0.006); mode(now, 170, amp * 0.5, 0.02);
    burst(now, 0.004, 3200, 0.7, amp * 0.5, 'highpass');
  }
  // Kugel schlägt im Kasten unter dem Brett auf, hüpft und rollt in der Rinne aus
  function land() {
    if (!ctx) return;
    const t = ctx.currentTime + 0.015;
    const box = ctx.createBiquadFilter(); box.type = 'lowpass'; box.frequency.value = 1400; box.connect(master);
    const thud = (at, g, k) => {
      mode(at, 104 * k, g, 0.05, box); mode(at, 212 * k, g * 0.7, 0.04, box);
      mode(at, 395 * k, g * 0.4, 0.022, box); mode(at, 930 * k, g * 0.15, 0.01, box);
      burst(at, 0.012, 1100, 0.8, g * 0.5, 'lowpass', box);
    };
    thud(t, 0.32, 1); thud(t + 0.105, 0.14, 1.04); thud(t + 0.165, 0.06, 1.07);
    // Ausrollen
    const src = ctx.createBufferSource(); src.buffer = surf; src.loop = true;
    src.playbackRate.setValueAtTime(0.45, t + 0.18); src.playbackRate.linearRampToValueAtTime(1.25, t + 0.8);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 230; bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t + 0.18); g.gain.linearRampToValueAtTime(0.5, t + 0.36); g.gain.linearRampToValueAtTime(0.0, t + 0.82);
    src.connect(bp); bp.connect(g); g.connect(box); src.start(t + 0.18); src.stop(t + 0.86);
    mode(t + 0.83, 470, 0.09, 0.016, box); mode(t + 0.83, 1290, 0.035, 0.008, box); // stößt am Ende an
  }
  function checkpoint() { if (!ctx) return; const t = ctx.currentTime; tone(t, 880, 0.12, 0.1); tone(t + 0.07, 1320, 0.14, 0.08); }
  function win() {
    if (!ctx) return; const t = ctx.currentTime + 0.35;
    // zwei leise, weiche Glockentöne statt Fanfare
    tone(t + 0.12, 659, 0.9, 0.045, 'sine'); tone(t + 0.12, 1318, 0.5, 0.012, 'sine');
    tone(t + 0.30, 880, 1.1, 0.04, 'sine'); tone(t + 0.30, 1760, 0.6, 0.01, 'sine');
  }
  function lost() { if (!ctx) return; const t = ctx.currentTime + 0.5; tone(t, 330, 0.5, 0.05); tone(t + 0.18, 247, 0.7, 0.045); }
  function tick(hi) { if (!ctx) return; tone(ctx.currentTime, hi ? 1046 : 660, 0.12, 0.13, 'triangle'); }
  return { init, setEnabled, roll, hit, rim, land, checkpoint, win, lost, tick };
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

// ---- Holztextur: Jahresringe, Fasern und Poren, pixelweise berechnet
function hash2(ix, iy, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + seed) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed), b = hash2(ix + 1, iy, seed), c = hash2(ix, iy + 1, seed), d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}
function makeWood(wpx, hpx, upp, o) {
  const cv = document.createElement('canvas'); cv.width = wpx; cv.height = hpx;
  const c = cv.getContext('2d'), img = c.createImageData(wpx, hpx), d = img.data;
  const [lr, lg, lb] = o.light, [dr, dg, db] = o.dark, s = o.seed;
  // langsame Verläufe nur an Stützstellen berechnen und dazwischen interpolieren
  const GS = 8, gw = Math.ceil(wpx / GS) + 2, gh = Math.ceil(hpx / GS) + 2;
  const warpG = new Float32Array(gw * gh), macroG = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const X = gx * GS * upp, Y = gy * GS * upp;
    warpG[gy * gw + gx] = (vnoise(X * 0.0016, Y * 0.006, s) - 0.5) * o.warp + (vnoise(X * 0.007, Y * 0.02, s + 1) - 0.5) * o.warp * 0.16;
    macroG[gy * gw + gx] = vnoise(X * 0.0012, Y * 0.0045, s + 4);
  }
  let p = 0;
  for (let py = 0; py < hpx; py++) {
    const Y = py * upp, gy = Math.floor(py / GS), ty = py / GS - gy;
    for (let px = 0; px < wpx; px++) {
      const X = px * upp, gx = Math.floor(px / GS), tx = px / GS - gx, gi = gy * gw + gx;
      const warp = (warpG[gi] * (1 - tx) + warpG[gi + 1] * tx) * (1 - ty) + (warpG[gi + gw] * (1 - tx) + warpG[gi + gw + 1] * tx) * ty;
      const macro = (macroG[gi] * (1 - tx) + macroG[gi + 1] * tx) * (1 - ty) + (macroG[gi + gw] * (1 - tx) + macroG[gi + gw + 1] * tx) * ty;
      const rc = (Y + warp) / o.ring, ri = Math.floor(rc), t = rc - ri;
      // Frühholz hell, Spätholz dunkel, dann scharfe Ringgrenze
      const ring = (t < 0.82 ? Math.pow(t / 0.82, 2.2) : 1 - (t - 0.82) / 0.18) * (0.45 + 0.55 * hash2(ri, 7, s));
      const fiber = vnoise(X * 0.011, Y * 1.15, s + 2);
      const fine = vnoise(X * 0.06, Y * 2.4, s + 3);
      let sh = o.ringAmt * ring + 0.2 * fiber + 0.1 * fine + 0.26 * macro;
      if (hash2(Math.floor(X / 9), Math.floor(Y * 1.3), s + 5) > 0.986) sh += 0.3; // Poren
      sh = sh < 0 ? 0 : sh > 1 ? 1 : sh;
      d[p++] = lr + (dr - lr) * sh; d[p++] = lg + (dg - lg) * sh; d[p++] = lb + (db - lb) * sh; d[p++] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}
const tex = { floor: null, floorKey: '', rail: null };
const RAIL_PX = 2; // Texturpixel pro Einheit bei den Leisten
function floorTex(L) {
  const key = L.W + 'x' + L.H;
  if (tex.floorKey !== key) {
    tex.floorKey = key;
    tex.floor = makeWood(Math.round(L.W * 1.25), Math.round(L.H * 1.25), 0.8,
      { light: [243, 222, 184], dark: [203, 166, 114], seed: 11, ring: 46, warp: 110, ringAmt: 0.42 });
  }
  return tex.floor;
}
function railTex() {
  if (!tex.rail) {
    tex.rail = makeWood(2700, WALL_T * RAIL_PX, 1 / RAIL_PX,
      { light: [226, 176, 118], dark: [156, 104, 58], seed: 29, ring: 5.5, warp: 9, ringAmt: 0.5 });
  }
  return tex.rail;
}

function drawHole(c, h, goal) {
  const R = h.r;
  if (goal) { // aufgedruckte rote Ringe
    c.save(); c.globalCompositeOperation = 'multiply';
    for (const [rr, lw] of [[R + 9, 5], [R + 17, 3]]) {
      c.beginPath(); c.arc(h.x, h.y, rr, 0, TAU); c.strokeStyle = 'rgba(176,36,28,.9)'; c.lineWidth = lw; c.stroke();
    }
    c.restore();
  }
  // leicht abgedunkelte Fase rund um die Bohrung
  let g = c.createRadialGradient(h.x, h.y, R, h.x, h.y, R + 4);
  g.addColorStop(0, 'rgba(60,32,10,.45)'); g.addColorStop(1, 'rgba(60,32,10,0)');
  c.fillStyle = g; c.beginPath(); c.arc(h.x, h.y, R + 4, 0, TAU); c.fill();

  c.save();
  c.beginPath(); c.arc(h.x, h.y, R, 0, TAU); c.clip();
  // Bohrungswand: unten rechts vom Licht getroffen, oben links im Schatten
  g = c.createLinearGradient(h.x - R * 0.7, h.y - R * 0.7, h.x + R * 0.7, h.y + R * 0.7);
  g.addColorStop(0, '#170d05'); g.addColorStop(0.5, '#3f2611'); g.addColorStop(0.85, '#8e6538'); g.addColorStop(1, '#b08350');
  c.fillStyle = g; c.fillRect(h.x - R, h.y - R, R * 2, R * 2);
  // Blick in den dunklen Kasten, zum Licht hin versetzt -> Sichel der Wand bleibt sichtbar
  const ox = -R * 0.11, oy = -R * 0.13;
  g = c.createRadialGradient(h.x + ox, h.y + oy, R * 0.55, h.x + ox, h.y + oy, R * 1.04);
  g.addColorStop(0, '#080503'); g.addColorStop(0.72, '#0b0704'); g.addColorStop(0.9, 'rgba(14,8,4,.82)'); g.addColorStop(1, 'rgba(20,11,5,0)');
  c.fillStyle = g; c.fillRect(h.x - R, h.y - R, R * 2, R * 2);
  c.restore();

  // Kante: helle Fase zum Licht, dunkle Kante im Schatten
  c.lineCap = 'round';
  c.beginPath(); c.arc(h.x, h.y, R + 0.5, -Math.PI * 0.2, Math.PI * 0.7);
  c.strokeStyle = 'rgba(255,240,212,.42)'; c.lineWidth = 1.1; c.stroke();
  c.beginPath(); c.arc(h.x, h.y, R + 0.4, Math.PI * 0.8, Math.PI * 1.7);
  c.strokeStyle = 'rgba(45,22,6,.6)'; c.lineWidth = 1.5; c.stroke();
}

function label(c, text, x, y, size, color) {
  c.font = `800 ${size}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(text, x, y);
}

function renderStatic() {
  const L = game.level; if (!L) return;
  staticCanvas.width = canvas.width; staticCanvas.height = canvas.height;
  const c = sctx, px = view.scale * view.dpr;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, staticCanvas.width, staticCanvas.height);
  c.setTransform(px, 0, 0, px, view.ox * view.dpr, view.oy * view.dpr);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';

  // Boden: lackiertes Birkenholz
  c.drawImage(floorTex(L), 0, 0, L.W, L.H);
  // Lichteinfall von oben links
  let g = c.createRadialGradient(L.W * 0.3, L.H * 0.22, 0, L.W * 0.3, L.H * 0.22, L.W * 0.85);
  g.addColorStop(0, 'rgba(255,250,236,.20)'); g.addColorStop(0.6, 'rgba(255,250,236,.03)'); g.addColorStop(1, 'rgba(60,32,10,.10)');
  c.fillStyle = g; c.fillRect(0, 0, L.W, L.H);

  // Aufdruck: Linie, Start, Nummern (die Maserung scheint durch)
  c.save(); c.globalCompositeOperation = 'multiply';
  const wp = L.waypoints;
  c.beginPath(); c.moveTo(wp[0].x, wp[0].y);
  for (let i = 1; i < wp.length - 1; i++) {
    c.quadraticCurveTo(wp[i].x, wp[i].y, (wp[i].x + wp[i + 1].x) / 2, (wp[i].y + wp[i + 1].y) / 2);
  }
  c.lineTo(wp[wp.length - 1].x, wp[wp.length - 1].y);
  c.strokeStyle = 'rgba(30,20,12,.86)'; c.lineWidth = 3.2; c.lineCap = 'round'; c.lineJoin = 'round'; c.stroke();
  c.beginPath(); c.arc(L.start.x, L.start.y, BALL_R + 7, 0, TAU);
  c.strokeStyle = 'rgba(30,20,12,.86)'; c.lineWidth = 3; c.stroke();
  if (L.cell >= 150) label(c, 'START', L.start.x, L.start.y + BALL_R + 22, 15, 'rgba(30,20,12,.85)');
  if (L.cell >= 150) label(c, 'ZIEL', L.goal.x, L.goal.y + GOAL_R + 30, 15, 'rgba(176,36,28,.95)');
  c.restore();

  // Löcher + Ziel
  L.holes.forEach((h) => drawHole(c, h, false));
  drawHole(c, L.goal, true);

  // Zwischenziele (Nummern)
  L.checkpoints.forEach((p) => {
    c.beginPath(); c.arc(p.x, p.y, 11, 0, TAU);
    c.fillStyle = 'rgba(250,242,226,.92)'; c.fill(); c.strokeStyle = 'rgba(30,20,12,.86)'; c.lineWidth = 2; c.stroke();
    label(c, String(p.label), p.x, p.y + 0.5, 12.5, '#1c120a');
  });

  // Leisten: erst Schatten (Kontaktschatten rundum + Schlagschatten nach unten rechts) ...
  c.save(); c.fillStyle = '#6e4420';
  c.shadowColor = 'rgba(40,20,6,.42)'; c.shadowBlur = 5 * px; c.shadowOffsetX = 0; c.shadowOffsetY = 0;
  L.walls.forEach((w) => c.fillRect(w.x, w.y, w.w, w.h));
  c.shadowColor = 'rgba(40,20,6,.5)'; c.shadowBlur = 7 * px; c.shadowOffsetX = 5.5 * px; c.shadowOffsetY = 7.5 * px;
  L.walls.forEach((w) => c.fillRect(w.x, w.y, w.w, w.h));
  c.restore();
  // ... dann die Leisten selbst mit Maserung in Längsrichtung und gerundeten Kanten
  const rail = railTex(), rng = mulberry32(L.n * 31 + 7);
  L.walls.forEach((w) => {
    const horiz = w.w >= w.h, len = horiz ? w.w : w.h, th = horiz ? w.h : w.w;
    const sx = Math.floor(rng() * Math.max(1, rail.width - len * RAIL_PX - 1));
    c.save();
    if (horiz) c.translate(w.x, w.y); else { c.translate(w.x + w.w, w.y); c.rotate(Math.PI / 2); }
    c.drawImage(rail, sx, 0, len * RAIL_PX, th * RAIL_PX, 0, 0, len, th);
    // Kantenrundung: bei senkrechten Leisten liegt die lichtzugewandte Kante nach der Drehung "unten"
    const eg = c.createLinearGradient(0, 0, 0, th);
    const hi = 'rgba(255,241,214,', lo = 'rgba(52,26,8,';
    if (horiz) {
      eg.addColorStop(0, hi + '.62)'); eg.addColorStop(0.2, hi + '.10)'); eg.addColorStop(0.62, lo + '0)'); eg.addColorStop(1, lo + '.46)');
    } else {
      eg.addColorStop(0, lo + '.46)'); eg.addColorStop(0.38, lo + '0)'); eg.addColorStop(0.8, hi + '.10)'); eg.addColorStop(1, hi + '.62)');
    }
    c.fillStyle = eg; c.fillRect(0, 0, len, th);
    // Stirnseiten leicht abdunkeln
    const cg = c.createLinearGradient(0, 0, len, 0), ef = Math.min(0.5, 2.5 / len);
    cg.addColorStop(0, hi + (horiz ? '.3)' : '.3)')); cg.addColorStop(ef, hi + '0)'); cg.addColorStop(1 - ef, lo + '0)'); cg.addColorStop(1, lo + '.35)');
    c.fillStyle = cg; c.fillRect(0, 0, len, th);
    c.restore();
  });

  // Randabdunklung
  g = c.createRadialGradient(L.W / 2, L.H / 2, L.H * 0.45, L.W / 2, L.H / 2, L.W * 0.75);
  g.addColorStop(0, 'rgba(40,20,6,0)'); g.addColorStop(1, 'rgba(40,20,6,.20)');
  c.fillStyle = g; c.fillRect(0, 0, L.W, L.H);
}

// polierte Stahlkugel: spiegelt oben das Licht, unten das Holzbrett
function drawBall(c, x, y, s, dark, shadow, lift = 0) {
  const r = BALL_R * s;
  const lx = clamp(-0.36 - tilt.x * 0.9, -0.62, -0.1), ly = clamp(-0.4 - tilt.y * 0.9, -0.64, -0.12);
  let g;
  if (shadow) {
    const sx = x + r * (0.36 + tilt.x * 0.9) + lift * 0.5, sy = y + r * (0.48 + tilt.y * 0.9) + lift * 0.65;
    g = c.createRadialGradient(sx, sy, r * 0.2, sx, sy, r * 1.3);
    g.addColorStop(0, 'rgba(35,18,6,.5)'); g.addColorStop(0.6, 'rgba(35,18,6,.2)'); g.addColorStop(1, 'rgba(35,18,6,0)');
    c.fillStyle = g; c.beginPath(); c.arc(sx, sy, r * 1.3, 0, TAU); c.fill();
    g = c.createRadialGradient(x + r * 0.08, y + r * 0.12, r * 0.55, x + r * 0.08, y + r * 0.12, r * 1.1);
    g.addColorStop(0, 'rgba(20,10,3,.6)'); g.addColorStop(1, 'rgba(20,10,3,0)');
    if (lift < 1) { c.fillStyle = g; c.beginPath(); c.arc(x + r * 0.08, y + r * 0.12, r * 1.1, 0, TAU); c.fill(); }
  }
  c.save();
  c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
  // Mitte: spiegelt den hellen Raum über dem Brett
  g = c.createRadialGradient(x + lx * r, y + ly * r, r * 0.02, x + lx * r * 0.25, y + ly * r * 0.25, r * 0.95);
  g.addColorStop(0, '#ffffff'); g.addColorStop(0.18, '#e9edf1'); g.addColorStop(0.5, '#bcc3cb');
  g.addColorStop(0.85, '#8a929c'); g.addColorStop(1, '#6f7781');
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  // Rand: von oben gesehen spiegelt der äußere Ring das Holzbrett (ab 45° Flächenneigung),
  // getrennt durch den dunklen Horizont; ganz außen liegt der eigene Schatten
  g = c.createRadialGradient(x, y, r * 0.62, x, y, r);
  g.addColorStop(0, 'rgba(60,54,50,0)'); g.addColorStop(0.3, 'rgba(48,42,38,.42)'); g.addColorStop(0.44, 'rgba(60,48,38,.6)');
  g.addColorStop(0.56, 'rgba(176,140,98,.72)'); g.addColorStop(0.78, 'rgba(126,92,58,.82)'); g.addColorStop(0.93, 'rgba(58,40,24,.92)');
  g.addColorStop(1, 'rgba(24,17,11,.97)');
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  // dem Licht abgewandte Seite etwas dunkler
  g = c.createLinearGradient(x - r * 0.7, y - r * 0.7, x + r * 0.7, y + r * 0.7);
  g.addColorStop(0, 'rgba(255,250,240,.16)'); g.addColorStop(0.5, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(14,8,4,.34)');
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  // Glanzlichter
  const hx = x + lx * r, hy = y + ly * r;
  g = c.createRadialGradient(hx, hy, 0, hx, hy, r * 0.44);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,.9)'); g.addColorStop(0.45, 'rgba(255,255,255,.2)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  const qx = x - lx * r * 1.25, qy = y - ly * r * 1.2;
  g = c.createRadialGradient(qx, qy, 0, qx, qy, r * 0.2);
  g.addColorStop(0, 'rgba(255,244,222,.5)'); g.addColorStop(1, 'rgba(255,244,222,0)');
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
  if (dark > 0) { c.fillStyle = `rgba(8,4,2,${dark})`; c.fillRect(x - r, y - r, r * 2, r * 2); }
  c.restore();
  // feine Lichtkante oben links
  c.beginPath(); c.arc(x, y, r - 0.45, Math.PI * 0.95, Math.PI * 1.6);
  c.strokeStyle = `rgba(255,255,255,${0.38 * (1 - dark)})`; c.lineWidth = Math.max(0.5, r * 0.06); c.stroke();
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

  // Lackglanz, der beim Neigen über das Brett wandert
  const gx = L.W * (0.4 - tilt.x * 1.2), gy = L.H * (0.32 - tilt.y * 1.2);
  const gl = ctx.createRadialGradient(gx, gy, 0, gx, gy, L.W * 0.55);
  gl.addColorStop(0, 'rgba(255,250,236,.11)'); gl.addColorStop(1, 'rgba(255,250,236,0)');
  ctx.fillStyle = gl; ctx.fillRect(0, 0, L.W, L.H);

  const b = game.ball;
  if (b.state === 'gone') return;
  const ho = b.state === 'falling' ? b.hole : b.over;
  if (ho && b.z > 0.2) {
    // Kugel sinkt ins Loch: sichtbar ist nur, was über dem Brett liegt oder durch die Bohrung zu sehen ist
    const s = 340 / (340 + b.z), hC = BALL_R - b.z;
    const rho = (hC >= 0 ? BALL_R : hC > -BALL_R ? Math.sqrt(BALL_R * BALL_R - hC * hC) : 0) * s;
    ctx.save();
    ctx.beginPath(); ctx.arc(ho.x, ho.y, ho.r, 0, TAU);
    if (rho > 0.5) { ctx.moveTo(b.x + rho, b.y); ctx.arc(b.x, b.y, rho, 0, TAU); }
    ctx.clip();
    drawBall(ctx, b.x, b.y, s, clamp((b.z - 3) / 42, 0, 0.93), b.z < 3);
    ctx.restore();
  } else if (b.state === 'held' && Math.floor(b.heldT * 8) % 2 === 1) {
    ctx.globalAlpha = 0.45; drawBall(ctx, b.x, b.y, 1, 0, true); ctx.globalAlpha = 1;
  } else if (b.z < -0.3) { // kurzer Hüpfer nach einem Stoß an der Lochkante
    drawBall(ctx, b.x, b.y, 340 / (340 + b.z), 0, true, -b.z);
  } else {
    drawBall(ctx, b.x, b.y, 1, 0, true);
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
  if (Math.abs(aspect - game.base.aspect) > 0.01 && (game.mode === 'menu' || game.mode === 'won' || game.mode === 'lost')) {
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
  ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, state: 'held', heldT: 0, toGoal: false, hole: null, over: null },
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
  b.x = p.x; b.y = p.y; b.z = 0; b.vx = 0; b.vy = 0; b.vz = 0; b.state = 'held'; b.heldT = 0; b.hole = null; b.over = null;
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

function lose() {
  game.mode = 'lost'; Sound.roll(0); Sound.lost(); releaseWake();
  setTimeout(() => { if (game.mode === 'lost') showScreen('#scrLost'); }, 450);
}

// Kontakt der Kugel mit Lochrand (Mittelpunkt noch über dem Brett) bzw. Lochwand (darunter).
// z = Tiefe des Kugelmittelpunkts unter der Ruhelage. Liefert die Aufprallgeschwindigkeit.
function holeContact(b, ho) {
  const dx = ho.x - b.x, dy = ho.y - b.y, d = Math.hypot(dx, dy);
  if (d < 1e-6) return 0;
  const ux = dx / d, uy = dy / d;              // waagerecht zur Lochmitte
  const e = ho.r - d, hC = BALL_R - b.z;       // Abstand zur Kante waagerecht / Höhe über der Brettoberfläche
  let nh, nu, pen;
  if (hC > 0) {
    const dist = Math.hypot(e, hC);
    if (dist >= BALL_R) return 0;
    nh = e / dist; nu = hC / dist; pen = BALL_R - dist;
  } else {
    if (e >= BALL_R) return 0;
    nh = 1; nu = 0; pen = BALL_R - e;
  }
  b.x += ux * nh * pen; b.y += uy * nh * pen; b.z -= nu * pen;
  const vn = (b.vx * ux + b.vy * uy) * nh - b.vz * nu;
  if (vn >= 0) return 0;
  const k = 1 + (hC > 0 ? 0.12 : 0.3);
  b.vx -= k * vn * nh * ux; b.vy -= k * vn * nh * uy; b.vz += k * vn * nu;
  return -vn;
}

function physics(dt) {
  const L = game.level, b = game.ball;
  const sens = SENS[store.settings.sens] ?? 1;
  const ax = G_BASE * sens * tilt.x, ay = G_BASE * sens * tilt.y;
  const sp0 = Math.hypot(b.vx, b.vy);
  let sub = clamp(Math.ceil((sp0 * dt) / (BALL_R * 0.35)), 1, 16);
  const reach = L.goal.r + BALL_R + sp0 * dt + 4;
  for (let i = -1; i < L.holes.length; i++) {
    const ho = i < 0 ? L.goal : L.holes[i];
    if (Math.abs(ho.x - b.x) < reach && Math.abs(ho.y - b.y) < reach) { sub = Math.max(sub, 8); break; }
  }
  const h = dt / sub;
  let impact = 0, impWall = 0, rimImpact = 0;
  for (let s = 0; s < sub; s++) {
    b.vx += ax * h; b.vy += ay * h; b.vz += G_FALL * h;
    if (b.z > -0.5) { // Rollwiderstand nur mit Bodenkontakt
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) { const dec = Math.min(sp, ROLL_RES * h); b.vx -= (b.vx / sp) * dec; b.vy -= (b.vy / sp) * dec; }
    }
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;

    // Liegt der Mittelpunkt über einer Bohrung, trägt nur noch die Lochkante
    let over = null;
    for (let i = -1; i < L.holes.length; i++) {
      const ho = i < 0 ? L.goal : L.holes[i];
      const dx = ho.x - b.x, dy = ho.y - b.y;
      if (dx * dx + dy * dy < ho.r * ho.r) { over = ho; break; }
    }
    b.over = over;
    if (over) {
      rimImpact = Math.max(rimImpact, holeContact(b, over));
      if (b.z > BALL_R * 0.9) { // Mittelpunkt unter der Brettoberfläche: kein Zurück mehr
        b.state = 'falling'; b.hole = over; b.toGoal = over === L.goal;
        Sound.roll(0); Sound.rim(rimImpact);
        return;
      }
    } else if (b.z >= 0) {
      if (b.vz > 260) rimImpact = Math.max(rimImpact, b.vz * 0.6); // kleiner Hüpfer landet wieder
      b.z = 0; b.vz = 0;
    }

    for (let wi = 0; wi < L.walls.length; wi++) {
      const w = L.walls[wi];
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
        if (-vn > impact) { impact = -vn; impWall = wi; }
        b.vx -= (1 + RESTITUTION) * vn * nx; b.vy -= (1 + RESTITUTION) * vn * ny;
        const tx = -ny, ty = nx, vt = b.vx * tx + b.vy * ty;
        b.vx -= vt * 0.03 * tx; b.vy -= vt * 0.03 * ty;
      }
    }
  }
  // Sicherheitsnetz: nie aus dem Labyrinth heraus
  b.x = clamp(b.x, L.ox + BALL_R, L.ox + L.mw - BALL_R);
  b.y = clamp(b.y, L.oy + BALL_R, L.oy + L.mh - BALL_R);
  Sound.hit(impact, impWall, L.walls[impWall] && L.walls[impWall].frame);
  Sound.rim(rimImpact);
  Sound.roll(b.z > -0.5 ? Math.hypot(b.vx, b.vy) : 0);

  if (store.settings.checkpoints) {
    const k = pathIndexAt(L, b.x, b.y);
    const next = L.checkpoints[game.cpReached];
    if (next && k >= next.k && Math.hypot(b.x - next.x, b.y - next.y) < L.cell * 0.45) {
      game.cpReached++; Sound.checkpoint();
    }
  }
}

// Freier Fall durch die Bohrung: die Kugel kann noch an der Lochwand anschlagen
function fallStep(dt) {
  const b = game.ball, sub = 8, h = dt / sub;
  let imp = 0;
  for (let s = 0; s < sub; s++) {
    b.vz += G_FALL * h;
    b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
    imp = Math.max(imp, holeContact(b, b.hole));
  }
  Sound.rim(imp);
  return b.z > GONE_Z;
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
      if (fallStep(dt)) {
        Sound.land();
        if (b.toGoal) { b.state = 'gone'; win(); }
        else {
          b.state = 'gone'; game.falls++; updateHud();
          if (game.falls >= MAX_FALLS) lose();
          else { toast('Noch ein Versuch!', 1600); setTimeout(() => { if (game.mode === 'play' || game.mode === 'paused') respawn(); }, 600); }
        }
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
  $('#statFalls').textContent = `${game.falls}/${MAX_FALLS}`;
}
let toastTimer = 0;
function toast(msg, ms = 3000) {
  const el = $('#toast'); el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

const SCREENS = ['#scrMenu', '#scrLevels', '#scrSettings', '#scrPause', '#scrWin', '#scrLost'];
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
document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => showScreen(backTarget === '#scrPause' && game.mode === 'paused' ? '#scrPause' : backTarget === '#scrWin' ? '#scrWin' : backTarget === '#scrLost' ? '#scrLost' : '#scrMenu')));
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
$('#btnLostAgain').addEventListener('click', () => { requestMotion(); startLevel(game.n); });
$('#btnLostLevels').addEventListener('click', () => openLevels('#scrLost'));

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
window.__laby = { game, buildLevel, tilt, sensor, keys, startLevel, view, Sound, makeWood };
})();
