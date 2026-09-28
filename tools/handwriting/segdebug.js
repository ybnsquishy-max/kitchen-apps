// Usage: node segdebug.js photo.jpg out.png [size]  (draws what counts as ink, column lines and marks)
const sharp = require('sharp');
require('../../uno/ocr/hwread.js');
const HW = globalThis.HandwrittenScores;
(async () => {
  const f = process.argv[2], out = process.argv[3];
  const { data, info } = await sharp(f).rotate().resize(+(process.argv[4]||2000), +(process.argv[4]||2000), { fit: 'inside' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  const mask = HW._inkMask(data, W, H), { comps } = HW._components(mask, W, H);
  const seps = comps.filter(c => c.h > H * 0.3 && c.w < c.h * 0.25);
  const marks = HW._strokes(comps.filter(c => !(c.h > H * 0.3 && c.w < c.h * 0.25)), W, H);
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">`;
  seps.forEach(c => svg += `<rect x="${c.x0}" y="${c.y0}" width="${c.w}" height="${c.h}" fill="none" stroke="blue" stroke-width="3"/>`);
  marks.forEach(c => svg += `<rect x="${c.x0}" y="${c.y0}" width="${c.w}" height="${c.h}" fill="none" stroke="red" stroke-width="2"/>`);
  svg += '</svg>';
  const maskImg = Buffer.alloc(W * H * 3, 255); for (let p = 0; p < W * H; p++) if (mask[p]) maskImg[p * 3] = maskImg[p * 3 + 1] = maskImg[p * 3 + 2] = 0;
  await sharp(maskImg, { raw: { width: W, height: H, channels: 3 } }).composite([{ input: Buffer.from(svg) }]).png().toBuffer().then(b => sharp(b).resize(700).toFile(out));
  console.log('seps', seps.length, 'marks', marks.length, 'comps', comps.length);
})();
