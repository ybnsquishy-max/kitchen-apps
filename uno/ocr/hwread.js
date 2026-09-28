// Handwritten score reader for Last Card. Runs on the phone: no network, no account.
// Finds pen ink (ignoring blue grid paper), splits it into digits, and reads each
// digit with a small network trained on handwritten numbers.
(function (root) {
  'use strict';

  // ---------- Ink ----------
  // Ink is dark in the red and green channels; blue grid lines are not. Compare each
  // pixel with the local paper brightness so shadows across the page don't matter.
  function inkMask(rgba, W, H) {
    const v = new Float32Array(W * H);
    for (let i = 0, p = 0; p < W * H; i += 4, p++) v[p] = Math.min(rgba[i], rgba[i + 1]);
    const r = Math.max(8, Math.round(Math.min(W, H) / 12));
    const bg = boxBlur(v, W, H, r);
    const bg2 = boxBlur(bg, W, H, r);
    const m = new Uint8Array(W * H);
    for (let p = 0, i = 0; p < W * H; p++, i += 4) {
      const b = Math.max(bg2[p], bg[p]);
      const blue = rgba[i + 2] - v[p];            // grid paper is printed blue; pen is grey/black
      m[p] = v[p] < b * 0.62 && v[p] < b - 40 && blue < 28 + v[p] * 0.12 ? 1 : 0;
    }
    return eraseLines(m, W, H);
  }
  // Grid lines (and ruled lines) are long and nearly straight; digits are short.
  // Find long lines near horizontal/vertical with a Hough vote and erase them.
  function eraseLines(m, W, H) {
    const out = m.slice(), D = Math.ceil(Math.hypot(W, H));
    const angles = [];
    for (let a = -14; a <= 14; a += 0.5) { angles.push(a * Math.PI / 180); angles.push((90 + a) * Math.PI / 180); }
    const cos = angles.map(Math.cos), sin = angles.map(Math.sin), A = angles.length;
    const acc = new Int32Array(A * 2 * D);
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      if (!m[y * W + x]) continue;
      for (let k = 0; k < A; k++) acc[k * 2 * D + Math.round(x * cos[k] + y * sin[k]) + D]++;
    }
    const lines = [];
    for (let k = 0; k < A; k++) {
      const horiz = k % 2 === 0, need = (horiz ? W : H) * 0.22;
      for (let r = 0; r < 2 * D; r++) {
        const v = acc[k * 2 * D + r];
        if (v < need) continue;
        let peak = true;
        for (let dk = -2; dk <= 2 && peak; dk++) for (let dr = -4; dr <= 4; dr++) {
          const kk = k + dk * 2; if (kk < 0 || kk >= A || (!dk && !dr)) continue;
          const rr = r + dr; if (rr < 0 || rr >= 2 * D) continue;
          if (acc[kk * 2 * D + rr] > v || (acc[kk * 2 * D + rr] === v && (dk < 0 || (dk === 0 && dr < 0)))) { peak = false; break; }
        }
        if (peak) lines.push({ c: cos[k], s: sin[k], rho: r - D });
      }
    }
    const band = Math.max(2, Math.round(Math.max(W, H) / 600));
    for (const L of lines) {
      // walk along the line and clear a thin band around it
      const px = L.c * L.rho, py = L.s * L.rho, dx = -L.s, dy = L.c;
      for (let t = -D; t <= D; t++) {
        const cx = px + dx * t, cy = py + dy * t;
        if (cx < -band || cy < -band || cx > W + band || cy > H + band) continue;
        // A pen stroke crossing the line carries on past it: leave those spots.
        const inkAt = o => { for (let s = -3; s <= 3; s++) { const x = Math.round(cx + L.c * o + dx * s), y = Math.round(cy + L.s * o + dy * s); if (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x]) return true; } return false; };
        if (inkAt(band + 1) && inkAt(band + 2) || inkAt(-band - 1) && inkAt(-band - 2)) continue;
        for (let o = -band; o <= band; o++) {
          const x = Math.round(cx + L.c * o), y = Math.round(cy + L.s * o);
          if (x >= 0 && y >= 0 && x < W && y < H) out[y * W + x] = 0;
        }
      }
    }
    return out;
  }
  function boxBlur(src, W, H, r) {
    const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      let s = 0; const row = y * W;
      for (let x = -r; x <= r; x++) s += src[row + clamp(x, 0, W - 1)];
      for (let x = 0; x < W; x++) {
        tmp[row + x] = s / (2 * r + 1);
        s += src[row + clamp(x + r + 1, 0, W - 1)] - src[row + clamp(x - r, 0, W - 1)];
      }
    }
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let y = -r; y <= r; y++) s += tmp[clamp(y, 0, H - 1) * W + x];
      for (let y = 0; y < H; y++) {
        out[y * W + x] = s / (2 * r + 1);
        s += tmp[clamp(y + r + 1, 0, H - 1) * W + x] - tmp[clamp(y - r, 0, H - 1) * W + x];
      }
    }
    return out;
  }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ---------- Connected pieces of ink ----------
  function components(mask, W, H) {
    const label = new Int32Array(W * H), comps = [], stack = [];
    let n = 0;
    for (let p = 0; p < W * H; p++) {
      if (!mask[p] || label[p]) continue;
      n++;
      const c = { id: n, x0: W, y0: H, x1: 0, y1: 0, area: 0, sx: 0, sy: 0 };
      label[p] = n; stack.push(p);
      while (stack.length) {
        const q = stack.pop(), x = q % W, y = (q / W) | 0;
        c.area++; c.sx += x; c.sy += y;
        if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx;
          if (mask[k] && !label[k]) { label[k] = n; stack.push(k); }
        }
      }
      c.w = c.x1 - c.x0 + 1; c.h = c.y1 - c.y0 + 1; c.cx = c.sx / c.area; c.cy = c.sy / c.area;
      comps.push(c);
    }
    return { label, comps };
  }

  // Join pieces that belong to one digit (a 5's flag, a 4 drawn in two strokes).
  function groupDigits(comps) {
    const groups = comps.map(c => ({ ids: [c.id], x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1, area: c.area }));
    let merged = true;
    while (merged) {
      merged = false;
      for (let i = 0; i < groups.length && !merged; i++) for (let j = i + 1; j < groups.length && !merged; j++) {
        const a = groups[i], b = groups[j];
        const ov = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
        const narrow = Math.min(a.x1 - a.x0, b.x1 - b.x0) + 1;
        const sa = a.area < b.area ? a : b, big = sa === a ? b : a;
        const small = sa.area < 0.25 * big.area && (sa.y1 - sa.y0) < 0.6 * (big.y1 - big.y0);
        if (ov > 0.5 * narrow || (small && ov > -0.15 * narrow && Math.abs((a.y0 + a.y1) - (b.y0 + b.y1)) < (a.y1 - a.y0 + b.y1 - b.y0))) {
          groups[i] = { ids: a.ids.concat(b.ids), x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1), area: a.area + b.area };
          groups.splice(j, 1); merged = true;
        }
      }
    }
    return groups.sort((a, b) => a.x0 - b.x0);
  }

  function splitWide(label, W, groups, lineH) {
    const out = [];
    for (const g of groups) {
      const w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1;
      const n = Math.min(4, Math.round(w / (h * 0.85)));
      if (w < h * 1.5 || n < 2) { out.push(g); continue; }
      const ids = new Set(g.ids), col = new Array(w).fill(0);
      for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) if (ids.has(label[y * W + x])) col[x - g.x0]++;
      const cuts = [];
      for (let k = 1; k < n; k++) {
        const c = Math.round(k * w / n), r = Math.round(w / n * 0.35);
        let best = c; for (let x = Math.max(1, c - r); x <= Math.min(w - 2, c + r); x++) if (col[x] < col[best]) best = x;
        cuts.push(best);
      }
      const edges = [0, ...cuts, w];
      for (let k = 0; k < edges.length - 1; k++) {
        const x0 = g.x0 + edges[k], x1 = g.x0 + edges[k + 1] - 1;
        let y0 = g.y1, y1 = g.y0, area = 0;
        for (let y = g.y0; y <= g.y1; y++) for (let x = x0; x <= x1; x++) if (ids.has(label[y * W + x])) { area++; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        if (y1 - y0 + 1 < h * 0.45) continue;      // just a bit of ruled line
        out.push({ ...g, x0, x1, y0, y1, area, cut: true });
      }
    }
    return out;
  }
  // ---------- One digit -> 28x28 like the training images ----------
  function digitImage(label, W, g) {
    const ids = new Set(g.ids);
    if (g.cut) { let y0 = g.y1, y1 = g.y0; for (let y = g.y0; y <= g.y1; y++) for (let x = g.x0; x <= g.x1; x++) if (ids.has(label[y * W + x])) { if (y < y0) y0 = y; if (y > y1) y1 = y; } if (y1 >= y0) g = { ...g, y0, y1 }; }
    const w = g.x1 - g.x0 + 1, h = g.y1 - g.y0 + 1;
    let bin = new Uint8Array(w * h), area = 0, edge = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ids.has(label[(g.y0 + y) * W + g.x0 + x])) { bin[y * w + x] = 1; area++; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bin[y * w + x]) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !bin[y * w + x - 1] || !bin[y * w + x + 1] || !bin[(y - 1) * w + x] || !bin[(y + 1) * w + x]) edge++;
    }
    // Match the stroke thickness of the training digits (about 1/7 of the height).
    const stroke = area / Math.max(1, edge / 2), want = Math.max(w, h) * 0.14;
    const grow = Math.min(6, Math.round((want - stroke) / 2));
    if (grow > 0) bin = dilate(bin, w, h, grow);
    // Scale the longest side to 20px, keep the shape, centre by mass in 28x28.
    const s = 20 / Math.max(w, h), tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
    const small = new Float32Array(tw * th);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bin[y * w + x]) {
      const tx = Math.min(tw - 1, Math.floor(x * s)), ty = Math.min(th - 1, Math.floor(y * s));
      small[ty * tw + tx] += s * s;
    }
    let mx = 0, my = 0, tot = 0;
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) { const v = Math.min(1, small[y * tw + x]); small[y * tw + x] = v; mx += x * v; my += y * v; tot += v; }
    mx /= tot || 1; my /= tot || 1;
    const out = new Float32Array(784), ox = Math.round(14 - mx), oy = Math.round(14 - my);
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
      const X = x + ox, Y = y + oy;
      if (X >= 0 && Y >= 0 && X < 28 && Y < 28) out[Y * 28 + X] = small[y * tw + x];
    }
    return blur28(out);
  }
  function dilate(bin, w, h, r) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (bin[y * w + x]) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < w && Y < h) out[Y * w + X] = 1;
      }
    }
    return out;
  }
  function blur28(a) {
    const out = new Float32Array(784), k = [0.25, 0.5, 0.25];
    const t = new Float32Array(784);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { let s = 0; for (let i = -1; i <= 1; i++) s += k[i + 1] * (a[y * 28 + clamp(x + i, 0, 27)]); t[y * 28 + x] = s; }
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { let s = 0; for (let i = -1; i <= 1; i++) s += k[i + 1] * (t[clamp(y + i, 0, 27) * 28 + x]); out[y * 28 + x] = Math.min(1, s * 1.35); }
    return out;
  }

  // ---------- The network (weights from hwdigits.json) ----------
  let NETS = [];
  function setModel(json) {
    const dec = (b64) => { const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Float32Array(u.buffer); };
    const one = m => m.layers.map(l => l.w ? { ...l, w: dec(l.w), b: dec(l.b) } : { ...l });
    NETS = (json.models || [json]).map(one);
  }
  // Several small networks vote; averaging them makes misreads rarer.
  function predict(img) {
    const acc = new Array(10).fill(0);
    for (const net of NETS) { const p = predictOne(net, img); for (let k = 0; k < 10; k++) acc[k] += p[k] / NETS.length; }
    return acc;
  }
  function predictOne(NET, img) {
    let x = img, H = 28, W = 28, C = 1;
    for (const l of NET) {
      if (l.type === 'conv') {           // 3x3, same padding, relu; w is [3][3][C][F]
        const F = l.filters, out = new Float32Array(H * W * F);
        for (let y = 0; y < H; y++) for (let xx = 0; xx < W; xx++) for (let f = 0; f < F; f++) {
          let s = l.b[f];
          for (let ky = 0; ky < 3; ky++) { const yy = y + ky - 1; if (yy < 0 || yy >= H) continue;
            for (let kx = 0; kx < 3; kx++) { const x2 = xx + kx - 1; if (x2 < 0 || x2 >= W) continue;
              const base = (yy * W + x2) * C, wb = ((ky * 3 + kx) * C) * F + f;
              for (let c = 0; c < C; c++) s += x[base + c] * l.w[wb + c * F];
            } }
          out[(y * W + xx) * F + f] = s > 0 ? s : 0;
        }
        x = out; C = F;
      } else if (l.type === 'pool') {    // 2x2 max
        const h2 = H >> 1, w2 = W >> 1, out = new Float32Array(h2 * w2 * C);
        for (let y = 0; y < h2; y++) for (let xx = 0; xx < w2; xx++) for (let c = 0; c < C; c++) {
          let m = -Infinity;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) m = Math.max(m, x[((2 * y + dy) * W + 2 * xx + dx) * C + c]);
          out[(y * w2 + xx) * C + c] = m;
        }
        x = out; H = h2; W = w2;
      } else if (l.type === 'dense') {   // w is [in][out]
        const n = l.units, inN = x.length, out = new Float32Array(n);
        for (let j = 0; j < n; j++) { let s = l.b[j]; for (let i = 0; i < inN; i++) s += x[i] * l.w[i * n + j]; out[j] = l.act === 'relu' ? Math.max(0, s) : s; }
        x = out;
      }
    }
    const m = Math.max(...x), e = Array.from(x, v => Math.exp(v - m)), z = e.reduce((a, b) => a + b, 0);
    return e.map(v => v / z);
  }
  // Read each digit a few times, nudged by a pixel, and average: steadier answers.
  function shift(img, dx, dy) {
    const out = new Float32Array(784);
    for (let y = 0; y < 28; y++) for (let x = 0; x < 28; x++) { const X = x - dx, Y = y - dy; if (X >= 0 && Y >= 0 && X < 28 && Y < 28) out[y * 28 + x] = img[Y * 28 + X]; }
    return out;
  }
  function predictSteady(img) {
    const acc = new Array(10).fill(0);
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) { const p = predict(dx || dy ? shift(img, dx, dy) : img); for (let k = 0; k < 10; k++) acc[k] += p[k] / 5; }
    return acc;
  }
  function readGroups(label, W, groups) {
    const digits = groups.map(g => { const p = predictSteady(digitImage(label, W, g)); const d = p.indexOf(Math.max(...p)); return { d, p: p[d] }; });
    return { value: digits.length ? parseInt(digits.map(x => x.d).join(''), 10) : null, digits, conf: digits.length ? Math.min(...digits.map(x => x.p)) : 0 };
  }

  // Keep pieces that look like writing: not specks, not ruled lines.
  function strokes(comps, W, H) {
    if (!comps.length) return [];
    const big = comps.filter(c => c.area >= Math.max(10, W * H * 0.000018) && c.x0 > W * 0.02 && c.y0 > 1 && c.x1 < W * 0.98 && c.y1 < H - 2);
    const hs = big.map(c => c.h).sort((a, b) => a - b), medH = hs[Math.floor(hs.length / 2)] || 1;
    // Typical digit height, judged from the bigger marks so leftover specks don't drag it down.
    const areas = big.filter(c => c.h < H * 0.2).map(c => c.area).sort((a, b) => a - b), aMed = areas[Math.floor(areas.length * 0.5)] || 0;
    const hs2 = big.filter(c => c.h < H * 0.2 && c.area >= aMed).map(c => c.h).sort((a, b) => a - b), typH = hs2[Math.floor(hs2.length * 0.5)] || medH;
    strokes.typH = typH;
    return big.filter(c => c.h < Math.max(medH * 3, H * 0.2) && c.w < W * 0.6 && !(c.h > medH * 0.3 && c.area > c.w * c.h * 0.85 && c.w > c.h * 4) && (c.h > typH * 0.45 || c.w > typH * 0.45) && !(c.area < c.w * c.h * 0.07 && Math.max(c.w, c.h) > typH * 1.4) && !(c.h < typH * 0.35 && c.w > typH * 0.8));
  }

  // ---------- A photo of one number (or one player's column) ----------
  // Returns the last (lowest) number found, plus the others above it.
  function readNumber(rgba, W, H) {
    const mask = inkMask(rgba, W, H), { label, comps } = components(mask, W, H);
    const reads = readLines(label, W, toLines(strokes(comps, W, H)));
    const last = reads.length ? reads[reads.length - 1] : null;
    return { last, lines: reads };
  }
  // A crossed-out number is one long piece much wider than tall.
  // A single digit is taller than it is wide; one piece much wider than tall is
  // digits joined by a line through them.
  function isCrossed(line) { return line.comps.some(c => c.w > c.h * 1.2 && c.w > line.h * 0.9 && c.area > 0.3 * line.comps.reduce((s, d) => s + d.area, 0)); }
  function toLines(comps) {
    const hs = comps.map(c => c.h).sort((a, b) => a - b), typH = hs[Math.floor(hs.length / 2)] || 1;
    const sorted = comps.slice().sort((a, b) => a.cy - b.cy), lines = [];
    for (const c of sorted) {
      const L = lines.find(l => Math.abs(c.cy - l.cy) < typH * 0.55);
      if (L) { L.comps.push(c); L.cy = L.comps.reduce((s, d) => s + d.cy * d.area, 0) / L.comps.reduce((s, d) => s + d.area, 0); }
      else lines.push({ comps: [c], cy: c.cy });
    }
    lines.forEach(l => { l.y0 = Math.min(...l.comps.map(c => c.y0)); l.y1 = Math.max(...l.comps.map(c => c.y1)); l.h = l.y1 - l.y0; l.y = l.cy; });
    return lines.sort((a, b) => a.y - b.y);
  }


  // ---------- A photo of the whole score sheet ----------
  // Columns are split by the hand-drawn lines between names (or by gaps). Returns
  // each column's numbers top to bottom; the last clean one is the running total.
  // Read lines of writing, dropping grid specks: a real number is about as tall
  // as the other numbers and has a fair amount of ink.
  function readLines(label, W, lines) {
    const good = lines.filter(l => l.comps.length);
    const hs = good.map(l => l.h).sort((a, b) => a - b), medH = hs[Math.floor(hs.length * 0.6)] || 1;
    const ink = l => l.comps.reduce((s, c) => s + c.area, 0);
    const inks = good.map(ink).sort((a, b) => a - b), medInk = inks[Math.floor(inks.length * 0.6)] || 1;
    // Digits in a line are about as tall as the tallest solid piece in it; specks aren't.
    const digitsOf = l => {
      const main = l.comps.filter(c => c.area >= 0.2 * Math.max(...l.comps.map(d => d.area)));
      const tall = Math.max(...main.map(c => c.h)), floor = (strokes.typH || tall) * 0.6;
      const gs = groupDigits(l.comps).filter(g => (g.y1 - g.y0 + 1) >= Math.max(tall * 0.55, floor));
      if (gs.length < 2) return gs;
      // Split at wide gaps and keep the cluster with the most ink.
      const unit = strokes.typH || tall, clusters = [[gs[0]]];
      for (let i = 1; i < gs.length; i++) { if (gs[i].x0 - gs[i - 1].x1 > unit * 1.1) clusters.push([]); clusters[clusters.length - 1].push(gs[i]); }
      return clusters.sort((a, b) => b.reduce((s, g) => s + g.area, 0) - a.reduce((s, g) => s + g.area, 0))[0];
    };
    const kept = good.filter(l => l.h > medH * 0.6 && l.h < medH * 2.2 && ink(l) > medInk * 0.3)
      // one thin upright stroke on its own is a leftover grid line, not a score
      .filter(l => { const g = digitsOf(l); return g.length && !(g.length === 1 && (g[0].x1 - g[0].x0 + 1) < (g[0].y1 - g[0].y0 + 1) * 0.3); });
    // Stop at a big gap: anything far below the list is not part of it.
    return kept.map(line => {
      const groups = splitWide(label, W, digitsOf(line), line.h);
      return { y: line.y, crossed: isCrossed(line), ...readGroups(label, W, groups), groups };
    });
  }
  function readSheet(rgba, W, H, wantCols) {
    const mask = inkMask(rgba, W, H), { label, comps } = components(mask, W, H);
    const seps = comps.filter(c => c.h > H * 0.3 && c.w < c.h * 0.25).map(c => sepLine(label, W, c)).sort((a, b) => a.xAt(H / 2) - b.xAt(H / 2));
    const marks = strokes(comps.filter(c => !(c.h > H * 0.3 && c.w < c.h * 0.25)), W, H);
    let cols;
    if (seps.length) {
      cols = Array.from({ length: seps.length + 1 }, () => []);
      marks.forEach(c => { let k = 0; while (k < seps.length && c.cx > seps[k].xAt(c.cy)) k++; cols[k].push(c); });
    } else {
      // Columns are separated by wide empty gaps; keep the ones with the most writing.
      // Thin upright slivers (bits of a drawn divider) would bridge the gaps: leave them
      // out while finding columns, then add each to the nearest column.
      const thin = c => c.w < c.h * 0.25;
      const xs = marks.filter(c => !thin(c)).sort((a, b) => a.cx - b.cx), unit = strokes.typH || 20;
      const groups = [[xs[0]]];
      let right = xs.length ? xs[0].x1 : 0;
      for (let i = 1; i < xs.length; i++) { if (xs[i].x0 - right > unit * 2.2) groups.push([]); groups[groups.length - 1].push(xs[i]); right = Math.max(right, xs[i].x1); }
      const ink = g => g.reduce((s, c) => s + c.area, 0);
      cols = groups.filter(g => g[0]).sort((a, b) => ink(b) - ink(a)).slice(0, wantCols || 3).sort((a, b) => a[0].cx - b[0].cx);
      const span = cols.map(g => [Math.min(...g.map(c => c.x0)), Math.max(...g.map(c => c.x1))]);
      marks.filter(thin).forEach(c => { const k = span.findIndex(([a, b]) => c.cx >= a - unit * 0.5 && c.cx <= b + unit * 0.5); if (k >= 0) cols[k].push(c); });
    }
    return cols.filter(c => c.length).map(cc => {
      const reads = readLines(label, W, toLines(cc));
      return { x: cc.reduce((s, c) => s + c.cx, 0) / cc.length, lines: reads, last: reads.length ? reads[reads.length - 1] : null };
    });
  }
  function sepLine(label, W, c) {
    let tx = 0, tn = 0, bx = 0, bn = 0;
    const band = Math.max(3, Math.round(c.h * 0.1));
    for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (label[y * W + x] === c.id) {
      if (y < c.y0 + band) { tx += x; tn++; } else if (y > c.y1 - band) { bx += x; bn++; }
    }
    const xt = tn ? tx / tn : c.cx, xb = bn ? bx / bn : c.cx, yt = c.y0, yb = c.y1;
    return { xAt: y => xt + (xb - xt) * (y - yt) / Math.max(1, yb - yt) };
  }

  // Read the same photo at a few sizes and let the reads vote, column by column.
  // One unlucky resize can't produce a wrong number, and disagreement is flagged.
  function readSheetVote(images, wantCols) {
    const runs = images.map(im => readSheet(im.rgba, im.W, im.H, wantCols).map(c => ({ ...c, nx: c.x / im.W })));
    const ref = runs.slice().sort((a, b) => b.length - a.length)[0] || [];
    return ref.map(rc => {
      const votes = {};
      let best = null;
      runs.forEach(run => {
        const c = run.slice().sort((a, b) => Math.abs(a.nx - rc.nx) - Math.abs(b.nx - rc.nx))[0];
        if (!c || Math.abs(c.nx - rc.nx) > 0.12 || !c.last || c.last.value == null) return;
        const k = c.last.value, v = votes[k] || (votes[k] = { n: 0, conf: 0, col: c });
        v.n++; v.conf += c.last.conf;
      });
      Object.values(votes).forEach(v => { if (!best || v.n > best.n || (v.n === best.n && v.conf > best.conf)) best = v; });
      if (!best) return { ...rc, agree: 0 };
      const agree = best.n / runs.length;
      return { ...best.col, last: { ...best.col.last, conf: Math.min(best.col.last.conf, agree) }, agree };
    });
  }

  root.HandwrittenScores = { readSheetVote, setModel, readNumber, readSheet, _digitImage: digitImage, _components: components, _inkMask: inkMask, _groupDigits: groupDigits, _strokes: strokes, _toLines: toLines, predict: (a) => predict(a) };
})(typeof window !== 'undefined' ? window : globalThis);
