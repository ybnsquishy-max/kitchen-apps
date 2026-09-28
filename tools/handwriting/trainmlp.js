// Trains the handwritten-digit network for Last Card and writes hwdigits.json.
const fs = require('fs');
require('../../uno/ocr/hwread.js');
const HW = globalThis.HandwrittenScores;

const EPOCHS = +process.argv[2] || 12;
const all = [];
for (let d = 0; d <= 9; d++) {
  const a = require(`mnist/src/digits/${d}.json`).data;
  for (let i = 0; i + 784 <= a.length; i += 784) all.push({ d, px: a.slice(i, i + 784) });
}
let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
for (let i = all.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [all[i], all[j]] = [all[j], all[i]]; }
const nTest = Math.round(all.length * 0.1), test = all.slice(0, nTest), train = all.slice(nTest);
console.log('samples', all.length, 'train', train.length, 'test', test.length);

// MNIST digit -> big binary image -> random warp and pen width -> the same
// clean-up the app does on photos (so training matches what the phone sees).
const S = 96;
function render(px, aug) {
  const bin = new Int32Array(S * S);
  const ang = aug ? (rnd() - 0.5) * 0.4 : 0, sc = aug ? 0.8 + rnd() * 0.4 : 1, sh = aug ? (rnd() - 0.5) * 0.5 : 0;
  const sx = aug ? 0.85 + rnd() * 0.3 : 1;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const pen = aug ? Math.floor(rnd() * 3) - 1 : 0;   // thinner, same, thicker
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let u = (x - S / 2) / (S / 28), v = (y - S / 2) / (S / 28);
    // inverse of scale/shear/rotate
    let a = (ca * u + sa * v) / (sc * sx), b = (-sa * u + ca * v) / sc;
    a -= sh * b;
    const X = a + 14, Y = b + 14;
    const xi = Math.floor(X), yi = Math.floor(Y);
    if (xi < 0 || yi < 0 || xi > 26 || yi > 26) continue;
    const fx = X - xi, fy = Y - yi;
    const val = px[yi * 28 + xi] * (1 - fx) * (1 - fy) + px[yi * 28 + xi + 1] * fx * (1 - fy) + px[(yi + 1) * 28 + xi] * (1 - fx) * fy + px[(yi + 1) * 28 + xi + 1] * fx * fy;
    const thr = pen < 0 ? 0.65 : pen > 0 ? 0.2 : 0.4;
    if (val > thr) bin[y * S + x] = 1;
  }
  let x0 = S, y0 = S, x1 = -1, y1 = -1;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (bin[y * S + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (x1 < 0) return new Float32Array(784);
  return HW._digitImage(bin, S, { ids: [1], x0, x1, y0, y1 });
}

// Plain-JS network: 784 -> 256 -> 96 -> 10, ReLU, softmax. SGD with momentum.
const SIZES = [784, 256, 96, 10];
const Wt = [], Bs = [], VW = [], VB = [];
for (let l = 0; l < 3; l++) {
  const n = SIZES[l], m = SIZES[l + 1], w = new Float32Array(n * m), sd = Math.sqrt(2 / n);
  for (let i = 0; i < w.length; i++) { const u = rnd() || 1e-9, v = rnd(); w[i] = sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  Wt.push(w); Bs.push(new Float32Array(m)); VW.push(new Float32Array(n * m)); VB.push(new Float32Array(m));
}
function forward(x, keep) {
  const acts = [x];
  for (let l = 0; l < 3; l++) {
    const n = SIZES[l], m = SIZES[l + 1], w = Wt[l], out = new Float32Array(m).fill(0);
    out.set(Bs[l]);
    const a = acts[l];
    for (let i = 0; i < n; i++) { const ai = a[i]; if (!ai) continue; const row = i * m; for (let j = 0; j < m; j++) out[j] += ai * w[row + j]; }
    if (l < 2) for (let j = 0; j < m; j++) { out[j] = out[j] > 0 ? out[j] : 0; if (keep && rnd() < 0.2) out[j] = 0; else if (keep) out[j] *= 1.25; }
    acts.push(out);
  }
  const z = acts[3], mx = Math.max(...z); let s = 0; const p = new Float32Array(10);
  for (let j = 0; j < 10; j++) { p[j] = Math.exp(z[j] - mx); s += p[j]; }
  for (let j = 0; j < 10; j++) p[j] /= s;
  return { acts, p };
}
function trainBatch(samples, lr) {
  const gW = Wt.map(w => new Float32Array(w.length)), gB = Bs.map(b => new Float32Array(b.length));
  for (const { x, d } of samples) {
    const { acts, p } = forward(x, true);
    let delta = Float32Array.from(p); delta[d] -= 1;
    for (let l = 2; l >= 0; l--) {
      const n = SIZES[l], m = SIZES[l + 1], a = acts[l], w = Wt[l], gw = gW[l];
      for (let j = 0; j < m; j++) gB[l][j] += delta[j];
      const prev = l > 0 ? new Float32Array(n) : null;
      for (let i = 0; i < n; i++) {
        const ai = a[i], row = i * m;
        if (ai) for (let j = 0; j < m; j++) gw[row + j] += ai * delta[j];
        if (prev && ai > 0) { let s = 0; for (let j = 0; j < m; j++) s += w[row + j] * delta[j]; prev[i] = s; }
      }
      delta = prev;
    }
  }
  const k = lr / samples.length;
  for (let l = 0; l < 3; l++) {
    const w = Wt[l], vw = VW[l], gw = gW[l];
    for (let i = 0; i < w.length; i++) { vw[i] = 0.9 * vw[i] - k * (gw[i] + 1e-4 * w[i]); w[i] += vw[i]; }
    for (let j = 0; j < Bs[l].length; j++) { VB[l][j] = 0.9 * VB[l][j] - k * gB[l][j]; Bs[l][j] += VB[l][j]; }
  }
}
const testX = test.map(s => ({ x: render(s.px, false), d: s.d }));
function accuracy() { let ok = 0; for (const s of testX) { const p = forward(s.x, false).p; if (p.indexOf(Math.max(...p)) === s.d) ok++; } return 100 * ok / testX.length; }
for (let e = 0; e < EPOCHS; e++) {
  const t0 = Date.now(), lr = e < EPOCHS * 0.6 ? 0.05 : e < EPOCHS * 0.85 ? 0.02 : 0.006;
  const order = train.map((_, i) => i).sort(() => rnd() - 0.5);
  for (let b = 0; b < order.length; b += 32) trainBatch(order.slice(b, b + 32).map(i => ({ x: render(train[i].px, true), d: train[i].d })), lr);
  console.log(`epoch ${e + 1}/${EPOCHS} test ${accuracy().toFixed(1)}% (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}
const b64 = a => Buffer.from(new Float32Array(a).buffer).toString('base64');
const out = { version: 1, layers: [0, 1, 2].map(l => ({ type: 'dense', units: SIZES[l + 1], act: l < 2 ? 'relu' : 'linear', w: b64(Wt[l]), b: b64(Bs[l]) })) };
fs.writeFileSync('hwdigits.json', JSON.stringify(out));
HW.setModel(out);
let same = 0; for (const s of testX.slice(0, 300)) { const a = HW.predict(s.x), b = forward(s.x, false).p; if (a.indexOf(Math.max(...a)) === b.indexOf(Math.max(...b))) same++; }
console.log('phone runner agrees on', same, '/ 300; size', fs.statSync('hwdigits.json').size, 'bytes');
