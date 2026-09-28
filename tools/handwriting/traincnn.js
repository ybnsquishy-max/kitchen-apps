// Small CNN for handwritten digits, trained in plain JavaScript (no libraries).
// conv3x3(8) relu pool2 -> conv3x3(16) relu pool2 -> dense 64 relu -> dense 10.
// Exports weights in the layout hwread.js's predict() expects.
const fs = require('fs');
require('../../uno/ocr/hwread.js');
const HW = globalThis.HandwrittenScores;
const EPOCHS = +process.argv[2] || 20;

const all = [];
for (let d = 0; d <= 9; d++) {
  const a = require(`mnist/src/digits/${d}.json`).data;
  for (let i = 0; i + 784 <= a.length; i += 784) all.push({ d, px: a.slice(i, i + 784) });
}
let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
const nTest = Math.round(all.length * 0.1), test = all.slice(0, nTest), train = all.slice(nTest);

const S = 96;
function render(px, aug) {
  const bin = new Int32Array(S * S);
  const ang = aug ? (rnd() - 0.5) * 0.5 : 0, sc = aug ? 0.78 + rnd() * 0.44 : 1, sh = aug ? (rnd() - 0.5) * 0.6 : 0;
  const sx = aug ? 0.8 + rnd() * 0.45 : 1, ca = Math.cos(ang), sa = Math.sin(ang);
  const pen = aug ? Math.floor(rnd() * 3) - 1 : 0;
  // gentle elastic wobble
  const ex = aug ? (rnd() - 0.5) * 1.6 : 0, ey = aug ? (rnd() - 0.5) * 1.6 : 0, ef = 0.2 + rnd() * 0.3;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let u = (x - S / 2) / (S / 28), v = (y - S / 2) / (S / 28);
    u += ex * Math.sin(v * ef); v += ey * Math.sin(u * ef);
    let a = (ca * u + sa * v) / (sc * sx), b = (-sa * u + ca * v) / sc;
    a -= sh * b;
    const X = a + 14, Y = b + 14, xi = Math.floor(X), yi = Math.floor(Y);
    if (xi < 0 || yi < 0 || xi > 26 || yi > 26) continue;
    const fx = X - xi, fy = Y - yi;
    const val = px[yi * 28 + xi] * (1 - fx) * (1 - fy) + px[yi * 28 + xi + 1] * fx * (1 - fy) + px[(yi + 1) * 28 + xi] * (1 - fx) * fy + px[(yi + 1) * 28 + xi + 1] * fx * fy;
    if (val > (pen < 0 ? 0.65 : pen > 0 ? 0.2 : 0.4)) bin[y * S + x] = 1;
  }
  // sometimes nick the digit with a gap, like a grid line erased through it
  if (aug && rnd() < 0.3) { const yy = Math.floor(S * (0.25 + rnd() * 0.5)), t = 1 + Math.floor(rnd() * 3); for (let y = yy; y < yy + t; y++) for (let x = 0; x < S; x++) if (rnd() < 0.8) bin[y * S + x] = 0; }
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (bin[y * S + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return new Float32Array(784);
  return HW._digitImage(bin, S, { ids: [1], x0, x1, y0, y1 });
}

// ---- parameters ----
const F1 = 8, F2 = 16, HID = 64;
function he(n, fan) { const w = new Float32Array(n), sd = Math.sqrt(2 / fan); for (let i = 0; i < n; i++) { const u = rnd() || 1e-9, v = rnd(); w[i] = sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); } return w; }
const P = {
  w1: he(9 * 1 * F1, 9), b1: new Float32Array(F1),
  w2: he(9 * F1 * F2, 9 * F1), b2: new Float32Array(F2),
  w3: he(784 * HID, 784), b3: new Float32Array(HID),
  w4: he(HID * 10, HID), b4: new Float32Array(10),
};
const M = {}, V = {}; for (const k in P) { M[k] = new Float32Array(P[k].length); V[k] = new Float32Array(P[k].length); }

function conv(x, H, W, C, w, b, F) {           // same padding, relu; w [ky][kx][C][F]
  const out = new Float32Array(H * W * F);
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const o = (y * W + xx) * F;
    for (let f = 0; f < F; f++) out[o + f] = b[f];
    for (let ky = 0; ky < 3; ky++) { const yy = y + ky - 1; if (yy < 0 || yy >= H) continue;
      for (let kx = 0; kx < 3; kx++) { const x2 = xx + kx - 1; if (x2 < 0 || x2 >= W) continue;
        const ib = (yy * W + x2) * C, wb = (ky * 3 + kx) * C * F;
        for (let c = 0; c < C; c++) { const v = x[ib + c]; if (!v) continue; const wr = wb + c * F; for (let f = 0; f < F; f++) out[o + f] += v * w[wr + f]; }
      } }
  }
  for (let i = 0; i < out.length; i++) if (out[i] < 0) out[i] = 0;
  return out;
}
function convBack(x, H, W, C, w, F, out, dOut, gw, gb, needDx) {
  const dx = needDx ? new Float32Array(H * W * C) : null;
  for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) {
    const o = (y * W + xx) * F;
    for (let f = 0; f < F; f++) { if (out[o + f] <= 0) dOut[o + f] = 0; gb[f] += dOut[o + f]; }
    for (let ky = 0; ky < 3; ky++) { const yy = y + ky - 1; if (yy < 0 || yy >= H) continue;
      for (let kx = 0; kx < 3; kx++) { const x2 = xx + kx - 1; if (x2 < 0 || x2 >= W) continue;
        const ib = (yy * W + x2) * C, wb = (ky * 3 + kx) * C * F;
        for (let c = 0; c < C; c++) {
          const v = x[ib + c], wr = wb + c * F; let s = 0;
          for (let f = 0; f < F; f++) { const d = dOut[o + f]; if (!d) continue; gw[wr + f] += v * d; if (needDx) s += w[wr + f] * d; }
          if (needDx) dx[ib + c] += s;
        }
      } }
  }
  return dx;
}
function pool(x, H, W, C) {
  const h = H >> 1, w = W >> 1, out = new Float32Array(h * w * C), arg = new Int32Array(h * w * C);
  for (let y = 0; y < h; y++) for (let xx = 0; xx < w; xx++) for (let c = 0; c < C; c++) {
    let m = -Infinity, mi = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) { const i = ((2 * y + dy) * W + 2 * xx + dx) * C + c; if (x[i] > m) { m = x[i]; mi = i; } }
    out[(y * w + xx) * C + c] = m; arg[(y * w + xx) * C + c] = mi;
  }
  return { out, arg };
}
function forward(img, train) {
  const a1 = conv(img, 28, 28, 1, P.w1, P.b1, F1), p1 = pool(a1, 28, 28, F1);
  const a2 = conv(p1.out, 14, 14, F1, P.w2, P.b2, F2), p2 = pool(a2, 14, 14, F2);
  const flat = p2.out, h = new Float32Array(HID), drop = new Uint8Array(HID);
  for (let j = 0; j < HID; j++) h[j] = P.b3[j];
  for (let i = 0; i < 784; i++) { const v = flat[i]; if (!v) continue; const r = i * HID; for (let j = 0; j < HID; j++) h[j] += v * P.w3[r + j]; }
  for (let j = 0; j < HID; j++) { if (h[j] < 0) h[j] = 0; if (train && rnd() < 0.3) { h[j] = 0; drop[j] = 1; } else if (train) h[j] /= 0.7; }
  const z = new Float32Array(10);
  for (let k = 0; k < 10; k++) z[k] = P.b4[k];
  for (let j = 0; j < HID; j++) { const v = h[j]; if (!v) continue; for (let k = 0; k < 10; k++) z[k] += v * P.w4[j * 10 + k]; }
  const mx = Math.max(...z); let s = 0; const p = new Float32Array(10);
  for (let k = 0; k < 10; k++) { p[k] = Math.exp(z[k] - mx); s += p[k]; }
  for (let k = 0; k < 10; k++) p[k] /= s;
  return { img, a1, p1, a2, p2, h, drop, p };
}
function backward(f, d, G) {
  const dz = Float32Array.from(f.p); dz[d] -= 1;
  for (let k = 0; k < 10; k++) G.b4[k] += dz[k];
  const dh = new Float32Array(HID);
  for (let j = 0; j < HID; j++) { let s = 0; for (let k = 0; k < 10; k++) { G.w4[j * 10 + k] += f.h[j] * dz[k]; s += P.w4[j * 10 + k] * dz[k]; } dh[j] = f.h[j] > 0 && !f.drop[j] ? s / 0.7 : 0; }
  const dflat = new Float32Array(784);
  for (let j = 0; j < HID; j++) G.b3[j] += dh[j];
  for (let i = 0; i < 784; i++) { const v = f.p2.out[i], r = i * HID; let s = 0; for (let j = 0; j < HID; j++) { const g = dh[j]; if (!g) continue; G.w3[r + j] += v * g; s += P.w3[r + j] * g; } dflat[i] = s; }
  const da2 = new Float32Array(14 * 14 * F2); for (let i = 0; i < 784; i++) da2[f.p2.arg[i]] += dflat[i];
  const dp1 = convBack(f.p1.out, 14, 14, F1, P.w2, F2, f.a2, da2, G.w2, G.b2, true);
  const da1 = new Float32Array(28 * 28 * F1); for (let i = 0; i < dp1.length; i++) da1[f.p1.arg[i]] += dp1[i];
  convBack(f.img, 28, 28, 1, P.w1, F1, f.a1, da1, G.w1, G.b1, false);
}
let step = 0;
function adam(G, n, lr) {
  step++;
  const b1 = 0.9, b2 = 0.999, c1 = 1 - Math.pow(b1, step), c2 = 1 - Math.pow(b2, step);
  for (const k in P) { const p = P[k], g = G[k], m = M[k], v = V[k];
    for (let i = 0; i < p.length; i++) { const gi = g[i] / n; m[i] = b1 * m[i] + (1 - b1) * gi; v[i] = b2 * v[i] + (1 - b2) * gi * gi; p[i] -= lr * (m[i] / c1) / (Math.sqrt(v[i] / c2) + 1e-8); } }
}
const testX = test.map(s => ({ x: render(s.px, false), d: s.d }));
const acc = () => { let ok = 0; for (const s of testX) { const p = forward(s.x, false).p; if (p.indexOf(Math.max(...p)) === s.d) ok++; } return 100 * ok / testX.length; };
function exportModel() {
  const b64 = a => Buffer.from(new Float32Array(a).buffer).toString('base64');
  return { version: 2, layers: [
    { type: 'conv', filters: F1, w: b64(P.w1), b: b64(P.b1) }, { type: 'pool' },
    { type: 'conv', filters: F2, w: b64(P.w2), b: b64(P.b2) }, { type: 'pool' },
    { type: 'dense', units: HID, act: 'relu', w: b64(P.w3), b: b64(P.b3) },
    { type: 'dense', units: 10, act: 'linear', w: b64(P.w4), b: b64(P.b4) },
  ] };
}
for (let e = 0; e < EPOCHS; e++) {
  const t0 = Date.now(), lr = e < EPOCHS * 0.6 ? 0.002 : e < EPOCHS * 0.85 ? 0.0008 : 0.0003;
  const order = train.map((_, i) => i).sort(() => rnd() - 0.5);
  for (let b = 0; b < order.length; b += 32) {
    const G = {}; for (const k in P) G[k] = new Float32Array(P[k].length);
    const idx = order.slice(b, b + 32);
    for (const i of idx) backward(forward(render(train[i].px, true), true), train[i].d, G);
    adam(G, idx.length, lr);
  }
  console.log(`epoch ${e + 1}/${EPOCHS} test ${acc().toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  fs.writeFileSync('hwdigits-cnn.json', JSON.stringify(exportModel()));
}
HW.setModel(exportModel());
let same = 0; for (const s of testX.slice(0, 300)) { const a = HW.predict(s.x), b = forward(s.x, false).p; if (a.indexOf(Math.max(...a)) === b.indexOf(Math.max(...b))) same++; }
console.log('phone runner agrees on', same, '/ 300');
