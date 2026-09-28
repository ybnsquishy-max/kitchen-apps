// Usage: node dump.js photo.jpg out-prefix  (boxes for every number read, plus the digit images the model saw for the bottom line of each column)
const sharp = require('sharp');
require('../../uno/ocr/hwread.js');
const HW = globalThis.HandwrittenScores;
HW.setModel(require(process.env.MODEL || '../../uno/ocr/hwdigits.json'));
(async () => {
  const [f, out] = process.argv.slice(2);
  const { data, info } = await sharp(f).rotate().resize(1400, 1400, { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const mask = HW._inkMask(data, W, H), { label } = HW._components(mask, W, H);
  const cols = HW.readSheet(data, W, H, 3);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  const tiles = [];
  cols.forEach(c => c.lines.forEach((l, li) => {
    const last = li === c.lines.length - 1;
    l.groups.forEach((g, gi) => {
      svg += `<rect x="${g.x0}" y="${g.y0}" width="${g.x1 - g.x0 + 1}" height="${g.y1 - g.y0 + 1}" fill="none" stroke="${last ? 'red' : 'orange'}" stroke-width="2"/>`;
      if (last) {
        const img = HW._digitImage(label, W, g), buf = Buffer.alloc(784);
        for (let i = 0; i < 784; i++) buf[i] = 255 - Math.round(img[i] * 255);
        tiles.push({ buf, d: l.digits[gi] });
      }
    });
  }));
  svg += '</svg>';
  const maskImg = Buffer.alloc(W * H * 3, 255); for (let p = 0; p < W * H; p++) if (mask[p]) maskImg[p * 3] = maskImg[p * 3 + 1] = maskImg[p * 3 + 2] = 0;
  await sharp(maskImg, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer().then(b => sharp(b).extract({ left: 0, top: 0, width: W, height: Math.round(H * 0.5) }).resize(700).toFile(out + '-boxes.png'));
  const strip = await Promise.all(tiles.map(t => sharp(t.buf, { raw: { width: 28, height: 28, channels: 1 } }).resize(84, 84, { kernel: 'nearest' }).png().toBuffer()));
  if (strip.length) await sharp({ create: { width: 90 * strip.length, height: 84, channels: 3, background: '#f88' } }).composite(strip.map((b, i) => ({ input: b, left: i * 90, top: 0 }))).png().toFile(out + '-digits.png');
  console.log('bottom digits:', tiles.map(t => t.d.d + '(' + t.d.p.toFixed(2) + ')').join(' '));
})();
