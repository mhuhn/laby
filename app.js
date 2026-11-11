/* Laby – Kugellabyrinth aus Holz, gesteuert durch Neigen des iPads */
'use strict';
(() => {

// ============================================================ Konstanten
const LEVEL_COUNT = 20;
const H = 860;                                   // Brett-Höhe in Welt-Einheiten; Breite folgt dem Bildschirm
const BALL_R = 14, HOLE_R = 20, WALL_T = 12;
const LINE_W = 9;                                // Strichstärke der aufgedruckten Linie (wie beim Holzlabyrinth)
const ARROW_L = 30, ARROW_W = 30;                // Pfeilspitze am Ziel
const FINISH_R = 26;                             // so nah muss die Kugel an die Pfeilspitze
const INK = 'rgba(48,40,34,.96)';                // Druckfarbe
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const CLASSIC_LEVEL = 7, CLASSIC_BAR = 26;       // nachgebautes klassisches Holzlabyrinth
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

// Klassisches Holzlabyrinth (vom Foto vermessen). Koordinaten als Anteil der Bodenfläche (0..1):
// vbars [x, oben, unten], hbars [links, rechts, y], Löcher [x, y], Nummern [Text, x, y], Linie ab Haken bis Pfeilfuß
const CLASSIC = {"vbars":[[0.2876,0.0,0.0981],[0.4088,0.1154,0.2692],[0.7058,0.0,0.5625],[0.1861,0.151,0.2471],[0.5993,0.2423,0.3365],[0.2876,0.224,0.3173],[0.5015,0.249,0.374],[0.081,0.251,0.3471],[0.908,0.1548,0.6106],[0.1956,0.3558,0.599],[0.2891,0.4231,0.5154],[0.3869,0.424,0.5154],[0.6015,0.426,0.55],[0.4993,0.449,0.8885],[0.4161,0.6221,0.7702],[0.592,0.6308,0.7817],[0.3015,0.6337,0.7817],[0.708,0.6683,0.8173],[0.1036,0.6779,0.824],[0.1942,0.6808,0.8269],[0.8066,0.7663,0.9183],[0.308,0.9279,1.0],[0.4088,0.875,1.0],[0.6051,0.8654,1.0]],"hbars":[[0.3905,0.7058,0.1346],[0.7058,0.7956,0.125],[0.7058,0.7956,0.4856],[0.0,0.0533,0.1856],[0.0,0.1058,0.4894],[0.8212,0.908,0.3221],[0.8212,1.0,0.625],[0.0985,0.1956,0.5798],[0.8066,0.9168,0.899],[0.0861,0.2044,0.9221]],"holes":[[0.7599,0.037],[0.942,0.0538],[0.023,0.1],[0.6391,0.2125],[0.8266,0.25],[0.3445,0.2668],[0.2201,0.2769],[0.1223,0.3019],[0.7551,0.401],[0.3321,0.4601],[0.438,0.4803],[0.5456,0.4962],[0.8485,0.5452],[0.2339,0.6962],[0.9405,0.6962],[0.6361,0.7163],[0.354,0.7399],[0.0369,0.749],[0.8602,0.8115],[0.2412,0.8356],[0.7376,0.8558],[0.4577,0.95],[0.5467,0.9481],[0.3445,0.9567]],"labels":[["1",0.3285,0.2106],["2",0.2241,0.2038],["3",0.0854,0.1058],["4",0.1241,0.2308],["5",0.1255,0.3788],["6",0.035,0.6712],["7",0.1759,0.649],["8",0.0336,0.824],["9",0.1781,0.8558],["10",0.2285,0.9221],["11",0.3445,0.9048],["12",0.346,0.8173],["13",0.4453,0.8846],["14",0.4438,0.5529],["15",0.3321,0.5327],["15",0.346,0.6663],["16",0.227,0.5856],["17",0.2131,0.3481],["18",0.3248,0.3404],["18",0.3255,0.3952],["19",0.4336,0.3981],["20",0.5526,0.2135],["21",0.5328,0.4202],["22",0.6401,0.2942],["23",0.6518,0.6279],["24",0.5328,0.5865],["25",0.5482,0.8808],["26",0.654,0.7779],["27",0.7489,0.9212],["28",0.973,0.7615],["29",0.8474,0.7279],["30",0.7445,0.7788],["31",0.8635,0.499],["32",0.7372,0.3317],["33",0.854,0.174],["34",0.8204,0.0779],["35",0.8832,0.051],["36",0.9526,0.5644]],"line":[[0.6275,0.0521],[0.6247,0.0594],[0.6205,0.0651],[0.6147,0.0684],[0.6066,0.0703],[0.4048,0.081],[0.3648,0.0884],[0.3528,0.0919],[0.3465,0.0952],[0.3419,0.0988],[0.3377,0.1035],[0.3342,0.109],[0.3295,0.1217],[0.3242,0.1535],[0.3202,0.1685],[0.3174,0.1743],[0.3137,0.179],[0.3103,0.1813],[0.3053,0.1829],[0.2876,0.1826],[0.2697,0.1859],[0.2598,0.1864],[0.2499,0.1853],[0.2422,0.182],[0.2358,0.1756],[0.2301,0.1655],[0.2261,0.1543],[0.2185,0.1277],[0.2137,0.117],[0.21,0.1118],[0.2056,0.1077],[0.1955,0.1028],[0.1845,0.1006],[0.1719,0.0998],[0.1578,0.1007],[0.1468,0.1028],[0.1375,0.1059],[0.1288,0.1106],[0.1218,0.1162],[0.1158,0.1236],[0.1118,0.131],[0.1092,0.1392],[0.1078,0.148],[0.1066,0.1704],[0.1045,0.1866],[0.1011,0.2001],[0.0946,0.2175],[0.0916,0.2228],[0.0875,0.2268],[0.0676,0.2364],[0.0476,0.2482],[0.0394,0.2546],[0.0333,0.2617],[0.0278,0.2717],[0.0239,0.285],[0.0217,0.303],[0.0215,0.3237],[0.0234,0.3457],[0.0262,0.3596],[0.0312,0.3722],[0.0386,0.3826],[0.0455,0.3881],[0.0544,0.3924],[0.0883,0.4007],[0.1026,0.4062],[0.1147,0.4142],[0.1241,0.425],[0.1301,0.437],[0.1339,0.4522],[0.1349,0.4708],[0.1333,0.491],[0.1305,0.503],[0.1265,0.5122],[0.1208,0.5199],[0.1138,0.5253],[0.1047,0.5286],[0.0909,0.5311],[0.0683,0.5302],[0.0599,0.5309],[0.0507,0.5342],[0.0438,0.5395],[0.0376,0.5488],[0.0342,0.5602],[0.0318,0.582],[0.0315,0.6023],[0.0332,0.6185],[0.0365,0.6301],[0.0423,0.6399],[0.049,0.6458],[0.0606,0.6507],[0.0743,0.6532],[0.0827,0.653],[0.0988,0.6492],[0.1128,0.6504],[0.1203,0.6536],[0.1284,0.6592],[0.1338,0.6645],[0.1373,0.6698],[0.1415,0.6808],[0.1436,0.697],[0.1445,0.7388],[0.1445,0.7868],[0.1438,0.8038],[0.142,0.8162],[0.1387,0.8259],[0.1336,0.8343],[0.1259,0.8418],[0.1199,0.8456],[0.1122,0.8491],[0.0749,0.8605],[0.0592,0.8664],[0.0481,0.8728],[0.0396,0.8814],[0.0363,0.887],[0.0333,0.8948],[0.0315,0.9033],[0.0309,0.9121],[0.0316,0.921],[0.0339,0.9312],[0.037,0.9391],[0.0412,0.9461],[0.0476,0.9524],[0.0566,0.9563],[0.1072,0.9667],[0.1393,0.97],[0.1612,0.9697],[0.1831,0.9673],[0.2036,0.9636],[0.2495,0.9532],[0.2595,0.948],[0.2686,0.9398],[0.2831,0.9217],[0.3013,0.8936],[0.3079,0.8871],[0.3286,0.8695],[0.3432,0.86],[0.362,0.8502],[0.4275,0.8217],[0.4382,0.8142],[0.445,0.8057],[0.4478,0.7998],[0.4503,0.7916],[0.4529,0.7719],[0.4533,0.6836],[0.4528,0.6589],[0.4509,0.6407],[0.4477,0.627],[0.4428,0.6143],[0.4323,0.5932],[0.4268,0.5856],[0.421,0.5814],[0.3964,0.5715],[0.383,0.5679],[0.3676,0.5659],[0.3535,0.5653],[0.295,0.569],[0.2733,0.5689],[0.2552,0.5659],[0.2487,0.5633],[0.2427,0.5594],[0.2375,0.5538],[0.2343,0.5481],[0.2321,0.5417],[0.2305,0.5329],[0.2299,0.5159],[0.2301,0.4194],[0.2309,0.4103],[0.2325,0.4017],[0.2352,0.3935],[0.2383,0.3876],[0.2421,0.3824],[0.2476,0.3771],[0.2588,0.371],[0.2683,0.3687],[0.2796,0.3675],[0.3932,0.3621],[0.4041,0.3597],[0.414,0.3543],[0.4222,0.3453],[0.4262,0.3382],[0.4294,0.3304],[0.4326,0.3187],[0.4402,0.2786],[0.4449,0.2619],[0.4492,0.2508],[0.4547,0.2406],[0.4605,0.233],[0.4671,0.2267],[0.4756,0.2213],[0.4963,0.2133],[0.5016,0.2128],[0.5069,0.2139],[0.5132,0.2172],[0.5176,0.2213],[0.5302,0.2402],[0.5362,0.2541],[0.5396,0.2696],[0.5407,0.2844],[0.5412,0.3264],[0.543,0.3427],[0.547,0.3559],[0.553,0.3656],[0.562,0.3736],[0.5759,0.3804],[0.588,0.3834],[0.6075,0.3848],[0.6177,0.3888],[0.6259,0.3946],[0.6324,0.401],[0.637,0.4076],[0.6408,0.4169],[0.6439,0.4325],[0.6452,0.4546],[0.6457,0.5313],[0.645,0.5459],[0.6433,0.5564],[0.6405,0.5645],[0.6366,0.5718],[0.6316,0.5781],[0.626,0.5833],[0.6163,0.5891],[0.5977,0.5925],[0.5885,0.5966],[0.5635,0.614],[0.5584,0.6198],[0.5543,0.6269],[0.5515,0.6368],[0.5505,0.6497],[0.5504,0.7496],[0.5511,0.7685],[0.5528,0.779],[0.5557,0.787],[0.5599,0.794],[0.5664,0.8005],[0.5736,0.8054],[0.5812,0.809],[0.6192,0.8229],[0.6301,0.83],[0.6377,0.8376],[0.644,0.8471],[0.649,0.8579],[0.6628,0.9022],[0.6697,0.9196],[0.6738,0.9269],[0.6787,0.9336],[0.6841,0.9393],[0.6901,0.9435],[0.6966,0.9461],[0.7035,0.9472],[0.7353,0.9481],[0.9124,0.9455],[0.9223,0.9448],[0.9305,0.9432],[0.9395,0.9392],[0.9478,0.9332],[0.9554,0.9252],[0.9609,0.917],[0.9669,0.9049],[0.9721,0.8904],[0.9759,0.8752],[0.9782,0.8611],[0.9788,0.8446],[0.9774,0.8303],[0.9736,0.817],[0.968,0.8067],[0.9585,0.7959],[0.9347,0.7787],[0.9179,0.7626],[0.9029,0.7451],[0.8769,0.7095],[0.8718,0.7036],[0.8672,0.7005],[0.8621,0.6994],[0.8369,0.7016],[0.8225,0.7018],[0.8069,0.7002],[0.7948,0.6968],[0.7836,0.6908],[0.7733,0.6817],[0.7647,0.6699],[0.7593,0.6575],[0.7561,0.6421],[0.7561,0.6259],[0.7601,0.6052],[0.7665,0.5856],[0.7723,0.5734],[0.7797,0.5623],[0.8116,0.5299],[0.822,0.5169],[0.8304,0.5041],[0.8388,0.4876],[0.8449,0.4716],[0.8486,0.4564],[0.8501,0.4399],[0.8497,0.425],[0.8471,0.411],[0.842,0.3965],[0.8347,0.3832],[0.8268,0.3724],[0.817,0.3619],[0.8078,0.354],[0.7854,0.337],[0.7742,0.3263],[0.7645,0.313],[0.7583,0.2991],[0.7557,0.289],[0.754,0.2765],[0.7537,0.2654],[0.7548,0.2527],[0.7572,0.2386],[0.7603,0.2268],[0.7645,0.2157],[0.7705,0.2036],[0.7768,0.1937],[0.7852,0.1837],[0.7953,0.174],[0.8151,0.1586],[0.8299,0.1394],[0.8374,0.1312],[0.8503,0.1209],[0.8641,0.1139],[0.8749,0.1111],[0.8876,0.11],[0.9071,0.1118],[0.9165,0.1136],[0.9214,0.1161],[0.9259,0.1199],[0.9397,0.1356],[0.9456,0.1436],[0.9488,0.1495],[0.9509,0.156],[0.9524,0.1706],[0.9526,0.2571],[0.9533,0.2932],[0.9534,0.4854]],"startIdx":3,"tip":[0.9533,0.5231],"startText":[0.5015,0.0577,0],"finishText":[0.9715,0.3712,90],"aspect":1.317};

function buildClassic(aspect) {
  const W = Math.round(H * clamp(aspect, 1.2, 2.1)), T = WALL_T;
  const X = (u) => T + u * (W - 2 * T), Y = (v) => T + v * (H - 2 * T);
  const C = CLASSIC, BT = CLASSIC_BAR;
  const walls = [
    { x: 0, y: 0, w: W, h: T, frame: true }, { x: 0, y: H - T, w: W, h: T, frame: true },
    { x: 0, y: 0, w: T, h: H, frame: true }, { x: W - T, y: 0, w: T, h: H, frame: true },
  ];
  C.vbars.forEach(([u, a, b]) => {
    const y0 = a <= 0.001 ? 0 : Y(a), y1 = b >= 0.999 ? H : Y(b);
    walls.push({ x: X(u) - BT / 2, y: y0, w: BT, h: y1 - y0 });
  });
  C.hbars.forEach(([a, b, v]) => {
    const x0 = a <= 0.001 ? 0 : X(a), x1 = b >= 0.999 ? W : X(b);
    walls.push({ x: x0, y: Y(v) - BT / 2, w: x1 - x0, h: BT });
  });
  const pathPts = C.line.map(([u, v]) => ({ x: X(u), y: Y(v) }));
  const st = pathPts[C.startIdx];
  return {
    n: CLASSIC_LEVEL, classic: true, W, H, aspect, cell: 120,
    ox: T / 2, oy: T / 2, mw: W - T, mh: H - T,
    walls, holes: C.holes.map(([u, v]) => ({ x: X(u), y: Y(v), r: HOLE_R })),
    pathPts, startIdx: C.startIdx, tip: { x: X(C.tip[0]), y: Y(C.tip[1]) },
    start: { x: st.x, y: st.y },
    labels: C.labels.map(([t, u, v]) => ({ text: t, x: X(u), y: Y(v), size: 22, weight: 600, angle: 0 })),
    startText: { text: 'START', x: X(C.startText[0]), y: Y(C.startText[1]), angle: 0 },
    finishText: { text: 'ZIEL', x: X(C.finishText[0]), y: Y(C.finishText[1]), angle: Math.PI / 2 },
  };
}

// ---- Linie mit runden Ecken (Kreisbögen wie beim Holzlabyrinth)
function filletPath(wp, R) {
  const out = [{ x: wp[0].x, y: wp[0].y }];
  for (let i = 1; i < wp.length - 1; i++) {
    const A = wp[i - 1], B = wp[i], C = wp[i + 1];
    let ax = A.x - B.x, ay = A.y - B.y, cx = C.x - B.x, cy = C.y - B.y;
    const la = Math.hypot(ax, ay), lc = Math.hypot(cx, cy);
    if (la < 1e-6 || lc < 1e-6) continue;
    ax /= la; ay /= la; cx /= lc; cy /= lc;
    const ang = Math.acos(clamp(ax * cx + ay * cy, -1, 1));
    if (Math.PI - ang < 0.03) { out.push({ x: B.x, y: B.y }); continue; }
    const th = Math.tan(ang / 2);
    const t = Math.min(R / th, la * 0.5, lc * 0.5), r = t * th;
    let bx = ax + cx, by = ay + cy; const bl = Math.hypot(bx, by); bx /= bl; by /= bl;
    const dC = r / Math.sin(ang / 2), ox = B.x + bx * dC, oy = B.y + by * dC;
    const a1 = Math.atan2(B.y + ay * t - oy, B.x + ax * t - ox), a2 = Math.atan2(B.y + cy * t - oy, B.x + cx * t - ox);
    let da = a2 - a1; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
    const steps = Math.max(2, Math.ceil(Math.abs(da) * r / 5));
    for (let s = 0; s <= steps; s++) { const a = a1 + da * s / steps; out.push({ x: ox + r * Math.cos(a), y: oy + r * Math.sin(a) }); }
  }
  out.push({ x: wp[wp.length - 1].x, y: wp[wp.length - 1].y });
  return out;
}
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.y - a.y);
    let s = step - carry;
    while (s <= l) { out.push({ x: a.x + (b.x - a.x) * s / l, y: a.y + (b.y - a.y) * s / l }); s += step; }
    carry = l - (s - step);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
const unit = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return { x: dx / l, y: dy / l }; };
// Text so drehen, dass er von links nach rechts bzw. von oben nach unten lesbar ist
function readable(a) { while (a > Math.PI / 2 + 1e-6) a -= Math.PI; while (a <= -Math.PI / 2 + 1e-6) a += Math.PI; return a; }

// ---- Beschriftung so platzieren, dass sie weder Leisten, Löcher, Linie noch andere Schrift berührt
const measureCtx = document.createElement('canvas').getContext('2d');
function textSize(text, size, weight, spacing = 0) {
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return { w: measureCtx.measureText(text).width + spacing * (text.length - 1), h: size * 0.74 };
}
function boxPoints(cx, cy, w, h, a) {
  const c = Math.cos(a), s = Math.sin(a), pts = [];
  for (const fx of [-0.5, 0, 0.5]) for (const fy of [-0.5, 0, 0.5]) {
    const x = fx * w, y = fy * h; pts.push({ x: cx + x * c - y * s, y: cy + x * s + y * c });
  }
  return pts;
}
function clearance(L, pts, placed) {
  let m = Infinity;
  for (const p of pts) {
    if (p.x < WALL_T || p.y < WALL_T || p.x > L.W - WALL_T || p.y > L.H - WALL_T) return -99;
    for (const w of L.walls) {
      const dx = Math.max(w.x - p.x, 0, p.x - w.x - w.w), dy = Math.max(w.y - p.y, 0, p.y - w.y - w.h);
      m = Math.min(m, Math.hypot(dx, dy));
    }
    for (const h of L.holes) m = Math.min(m, Math.hypot(h.x - p.x, h.y - p.y) - h.r);
    for (const q of L.samples) m = Math.min(m, Math.hypot(q.x - p.x, q.y - p.y) - LINE_W / 2);
    for (const b of placed) for (const q of b.pts) m = Math.min(m, Math.hypot(q.x - p.x, q.y - p.y) - 3);
  }
  return m;
}

// gemeinsame Aufbereitung: Linie, Haken, Pfeil, Nummern, START/ZIEL, Zwischenziele
function finishLevel(L) {
  if (!L.pathPts) {
    const wp = L.waypoints, d = unit(wp[1].x - wp[0].x, wp[1].y - wp[0].y);
    // Haken am Anfang wie beim Holzlabyrinth – zur freieren Seite
    const hook = [-1, 1].map((sg) => {
      const a = sg * 63 * Math.PI / 180, bx = -d.x, by = -d.y;
      return { x: wp[0].x + (bx * Math.cos(a) - by * Math.sin(a)) * 24, y: wp[0].y + (bx * Math.sin(a) + by * Math.cos(a)) * 24 };
    });
    L.samples = [];
    const hk = clearance(L, [hook[1]], []) > clearance(L, [hook[0]], []) ? hook[1] : hook[0];
    L.pathPts = [hk, ...filletPath(wp, Math.min(L.cell * 0.42, 70))];
    L.startIdx = 1;
    L.tip = { x: wp[wp.length - 1].x, y: wp[wp.length - 1].y };
  }
  const P = L.pathPts;
  // Linie endet am Pfeilfuß
  const pe = P[Math.max(0, P.length - 6)];
  const endDir = unit(L.tip.x - pe.x, L.tip.y - pe.y);
  L.arrowBase = { x: L.tip.x - endDir.x * ARROW_L, y: L.tip.y - endDir.y * ARROW_L };
  L.arrowDir = endDir;
  if (!L.classic) {
    let k = P.length - 1;
    while (k > L.startIdx + 1 && Math.hypot(P[k].x - L.tip.x, P[k].y - L.tip.y) < ARROW_L) k--;
    L.linePts = [...P.slice(0, k + 1), L.arrowBase];
  } else {
    L.linePts = P;
  }
  L.samples = resample(L.linePts, 8);
  L.finish = { x: L.tip.x, y: L.tip.y };
  if (!L.waypoints) L.waypoints = resample(P.slice(L.startIdx), 28).concat([{ x: L.tip.x, y: L.tip.y }]);

  const placed = [];
  const place = (cands, text, size, weight, spacing) => {
    const sz = textSize(text, size, weight, spacing);
    let best = null;
    for (const c of cands) {
      const pts = boxPoints(c.x, c.y, sz.w + 4, sz.h + 4, c.angle);
      const sc = clearance(L, pts, placed) + (c.bonus || 0);
      if (!best || sc > best.sc) best = { ...c, sc, pts };
    }
    placed.push(best);
    return { text, x: best.x, y: best.y, angle: best.angle, size, weight, spacing };
  };

  // START und ZIEL entlang der Linie
  if (!L.startText) {
    const s0 = P[L.startIdx], k1 = Math.min(P.length - 1, L.startIdx + 6);
    const d = unit(P[k1].x - s0.x, P[k1].y - s0.y), nrm = { x: -d.y, y: d.x }, a = readable(Math.atan2(d.y, d.x));
    const sz = textSize('START', 21, 600, 1.5), cands = [];
    for (const along of [0.7, 1.0, 1.4]) for (const side of [-1, 1]) {
      const off = sz.h / 2 + LINE_W / 2 + 9, s = sz.w * along;
      cands.push({ x: s0.x + d.x * s + nrm.x * off * side, y: s0.y + d.y * s + nrm.y * off * side, angle: a });
    }
    L.startText = place(cands, 'START', 21, 600, 1.5);
  } else {
    L.startText = { ...L.startText, size: 21, weight: 600, spacing: 1.5 };
  }
  if (!L.finishText) {
    const d = endDir, nrm = { x: -d.y, y: d.x }, a = readable(Math.atan2(d.y, d.x));
    const sz = textSize('ZIEL', 21, 600, 1.5), cands = [];
    for (const along of [0.6, 0.9, 1.3]) for (const side of [-1, 1]) {
      const off = sz.h / 2 + LINE_W / 2 + 9, s = ARROW_L + sz.w * along;
      cands.push({ x: L.tip.x - d.x * s + nrm.x * off * side, y: L.tip.y - d.y * s + nrm.y * off * side, angle: a });
    }
    L.finishText = place(cands, 'ZIEL', 21, 600, 1.5);
  } else {
    L.finishText = { ...L.finishText, size: 21, weight: 600, spacing: 1.5 };
  }

  // Lochnummern in Wegrichtung
  if (!L.labels) {
    const prog = (h) => { let bi = 0, bd = Infinity; L.samples.forEach((q, i) => { const dd = Math.hypot(q.x - h.x, q.y - h.y); if (dd < bd) { bd = dd; bi = i; } }); return bi; };
    const order = L.holes.map((h) => ({ h, k: prog(h) })).sort((a, b) => a.k - b.k);
    L.labels = order.map(({ h }, i) => {
      const text = String(i + 1), sz = textSize(text, 20, 600), cands = [];
      for (let j = 0; j < 8; j++) {
        const a = -Math.PI / 2 + j * Math.PI / 4, dist = h.r + 5 + (Math.abs(Math.cos(a)) * sz.w + Math.abs(Math.sin(a)) * sz.h) / 2;
        cands.push({ x: h.x + Math.cos(a) * dist, y: h.y + Math.sin(a) * dist, angle: 0, bonus: j === 0 ? 1.5 : j === 1 || j === 7 ? 0.8 : 0 });
      }
      return place(cands, text, 20, 600, 0);
    });
  }

  // Zwischenziele (beim Klassiker an festen Stellen der Strecke)
  if (!L.checkpoints) {
    const tot = L.samples.length;
    L.checkpoints = [0.28, 0.53, 0.77].map((f) => { const q = L.samples[Math.round(f * (tot - 1))]; return { x: q.x, y: q.y }; });
  }
  return L;
}

function buildLevel(n, aspect = 1.43) {
  if (n === CLASSIC_LEVEL) return finishLevel(buildClassic(aspect));
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
    checkpoints.push({ x: waypoints[k].x, y: waypoints[k].y });
  }

  const startP = waypoints[0];
  return finishLevel({
    n, cols, rows, cell, cw, ch, ox, oy, mw, mh, W, H, aspect,
    walls, holes, waypoints, checkpoints,
    start: { x: startP.x, y: startP.y },
  });
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
    // langsam wie bisher, schnell deutlich gedeckelt (Sättigung statt weiter ansteigender Lautstärke)
    rollGain.gain.setTargetAtTime(speed < 6 ? 0 : 0.15 * Math.tanh(speed / 500), t, 0.03);
    rollSrc.playbackRate.setTargetAtTime(clamp(speed / 520, 0.06, 2.4), t, 0.04);
    rollLP.frequency.setTargetAtTime(700 + v * 2000, t, 0.05);
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
    // helles Birkensperrholz wie beim Holzlabyrinth: fast gleichmäßig, feine, breite Maserung
    tex.floor = makeWood(Math.round(L.W * 1.25), Math.round(L.H * 1.25), 0.8,
      { light: [236, 222, 188], dark: [214, 195, 156], seed: 11, ring: 120, warp: 260, ringAmt: 0.3 });
  }
  return tex.floor;
}
function railTex() {
  if (!tex.rail) {
    // Kiefernleisten: hell mit kräftigen orangebraunen Spätholzstreifen
    tex.rail = makeWood(2700, 30 * RAIL_PX, 1 / RAIL_PX,
      { light: [236, 199, 140], dark: [182, 114, 52], seed: 29, ring: 6.5, warp: 5, ringAmt: 0.72 });
  }
  return tex.rail;
}

function drawHole(c, h) {
  const R = h.r;
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

function printText(c, t) {
  c.save();
  c.translate(t.x, t.y); c.rotate(t.angle || 0);
  c.font = `${t.weight || 500} ${t.size}px ${FONT}`;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = INK;
  if (t.spacing && 'letterSpacing' in c) c.letterSpacing = t.spacing + 'px';
  c.fillText(t.text, 0, 1);
  c.restore();
}
function drawCheckpoint(c, p, reached) {
  c.beginPath(); c.arc(p.x, p.y, 9.5, 0, TAU);
  c.fillStyle = reached ? '#3d8a40' : 'rgba(236,226,204,.95)'; c.fill();
  c.lineWidth = 3; c.strokeStyle = INK; c.stroke();
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
  g.addColorStop(0, 'rgba(255,250,236,.12)'); g.addColorStop(0.6, 'rgba(255,250,236,.02)'); g.addColorStop(1, 'rgba(60,32,10,.10)');
  c.fillStyle = g; c.fillRect(0, 0, L.W, L.H);

  // Aufdruck (die Maserung scheint durch): Linie mit Haken, Pfeil, START/ZIEL, Lochnummern
  c.save(); c.globalCompositeOperation = 'multiply';
  c.strokeStyle = INK; c.fillStyle = INK; c.lineWidth = LINE_W; c.lineCap = 'butt'; c.lineJoin = 'round';
  const lp = L.linePts;
  c.beginPath(); c.moveTo(lp[0].x, lp[0].y);
  for (let i = 1; i < lp.length; i++) c.lineTo(lp[i].x, lp[i].y);
  c.stroke();
  const ad = L.arrowDir, an = { x: -ad.y, y: ad.x }, ab = L.arrowBase;
  c.beginPath();
  c.moveTo(L.tip.x, L.tip.y);
  c.lineTo(ab.x + an.x * ARROW_W / 2 - ad.x * 2, ab.y + an.y * ARROW_W / 2 - ad.y * 2);
  c.lineTo(ab.x + ad.x * 6, ab.y + ad.y * 6);
  c.lineTo(ab.x - an.x * ARROW_W / 2 - ad.x * 2, ab.y - an.y * ARROW_W / 2 - ad.y * 2);
  c.closePath(); c.fill();
  [L.startText, L.finishText, ...L.labels].forEach((t) => printText(c, t));
  c.restore();

  // Löcher
  L.holes.forEach((h) => drawHole(c, h));

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
    const sx = Math.floor(rng() * Math.max(1, rail.width - len * RAIL_PX - 1)), sy = Math.floor(rng() * Math.max(1, rail.height - th * RAIL_PX));
    c.save();
    if (horiz) c.translate(w.x, w.y); else { c.translate(w.x + w.w, w.y); c.rotate(Math.PI / 2); }
    c.drawImage(rail, sx, sy, Math.min(len * RAIL_PX, rail.width - sx), th * RAIL_PX, 0, 0, len, th);
    // Kantenrundung: bei senkrechten Leisten liegt die lichtzugewandte Kante nach der Drehung "unten"
    const eg = c.createLinearGradient(0, 0, 0, th);
    const hi = 'rgba(255,241,214,', lo = 'rgba(52,26,8,';
    if (horiz) {
      eg.addColorStop(0, hi + '.38)'); eg.addColorStop(0.2, hi + '.06)'); eg.addColorStop(0.62, lo + '0)'); eg.addColorStop(1, lo + '.42)');
    } else {
      eg.addColorStop(0, lo + '.42)'); eg.addColorStop(0.38, lo + '0)'); eg.addColorStop(0.8, hi + '.06)'); eg.addColorStop(1, hi + '.38)');
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

  // Zwischenziele
  if (store.settings.checkpoints) L.checkpoints.forEach((p, i) => drawCheckpoint(ctx, p, i < game.cpReached));

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
  ball: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, state: 'held', heldT: 0, hole: null, over: null },
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
  const reach = HOLE_R + BALL_R + sp0 * dt + 4;
  for (let i = 0; i < L.holes.length; i++) {
    const ho = L.holes[i];
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
    for (let i = 0; i < L.holes.length; i++) {
      const ho = L.holes[i];
      const dx = ho.x - b.x, dy = ho.y - b.y;
      if (dx * dx + dy * dy < ho.r * ho.r) { over = ho; break; }
    }
    b.over = over;
    if (over) {
      rimImpact = Math.max(rimImpact, holeContact(b, over));
      if (b.z > BALL_R * 0.9) { // Mittelpunkt unter der Brettoberfläche: kein Zurück mehr
        b.state = 'falling'; b.hole = over;
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
    const next = L.checkpoints[game.cpReached];
    if (next && Math.hypot(b.x - next.x, b.y - next.y) < Math.max(30, L.cell * 0.4)) {
      game.cpReached++; Sound.checkpoint();
    }
  }
  // Ziel: Kugel erreicht die Pfeilspitze
  if (b.z <= 0.5 && Math.hypot(b.x - L.finish.x, b.y - L.finish.y) < FINISH_R) {
    b.state = 'done'; Sound.roll(0); win();
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
        b.state = 'gone'; game.falls++; updateHud();
        if (game.falls >= MAX_FALLS) lose();
        else { toast('Noch ein Versuch!', 1600); setTimeout(() => { if (game.mode === 'play' || game.mode === 'paused') respawn(); }, 600); }
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
