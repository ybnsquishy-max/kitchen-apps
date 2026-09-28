// Combines trained digit models into the file the app loads (their answers are averaged).
// Usage: node make-model.js hwdigits-cnn.json [more.json ...]
const fs = require('fs');
const models = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
if (!models.length) { console.error('Give at least one model file.'); process.exit(1); }
const out = '../../uno/ocr/hwdigits.json';
fs.writeFileSync(out, JSON.stringify({ version: 3, models: models.flatMap(m => m.models || [m]) }));
console.log('Wrote', out, fs.statSync(out).size, 'bytes from', models.length, 'model file(s)');
