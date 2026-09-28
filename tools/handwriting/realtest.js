// Reads the real score-sheet photos and compares with what is written on them.
const sharp = require('sharp');
require('../../uno/ocr/hwread.js');
const HW = globalThis.HandwrittenScores;
HW.setModel(JSON.parse(require('fs').readFileSync(process.env.MODEL || '../../uno/ocr/hwdigits.json', 'utf8')));
// Usage: node realtest.js sheets.json
// sheets.json: [{ "file": "/path/to/photo.jpg", "want": [319, 267, 298] }, ...]
// "want" is the newest (bottom) total in each column, left to right.
const SHEETS = JSON.parse(require('fs').readFileSync(process.argv[2] || 'sheets.json', 'utf8'));

async function load(path, maxSide) {
  let img = sharp(path).rotate();
  if (maxSide) img = img.resize(maxSide, maxSide, { fit: 'inside' });
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: data, W: info.width, H: info.height };
}
(async () => {
  let ok = 0, n = 0;
  for (const s of SHEETS) {
    const { rgba, W, H } = await load(s.file, 1400);
    const t0 = Date.now();
    const cols = HW.readSheet(rgba, W, H, 3);
    const got = cols.map(c => c.last && c.last.value);
    s.want.forEach((w, i) => { n++; if (got[i] === w) ok++; });
    console.log(s.file, 'want', s.want.join(' / '), '| got', got.join(' / '), `(${cols.length} cols, ${Date.now() - t0}ms)`);
    cols.forEach((c, i) => console.log('   col', i, c.lines.map(l => (l.crossed ? '~' : '') + l.value + '(' + l.conf.toFixed(2) + ')').join(' ')));
  }
  console.log(`RESULT ${ok}/${n} correct`);
})();
