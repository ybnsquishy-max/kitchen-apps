# Handwriting reader tools (Last Card)

Last Card reads handwritten score sheets on the phone with `uno/ocr/hwread.js`
and the digit model in `uno/ocr/hwdigits.json`. These scripts train and test them.

```
cd tools/handwriting
npm install
```

## Train a model

- `node traincnn.js 24` trains the small CNN the app uses (about 16 s per round
  on a laptop) and writes `hwdigits-cnn.json` after every round.
- `node trainmlp.js 25` trains the older, simpler network (for comparison).
- `node make-model.js hwdigits-cnn.json other.json` combines one or more trained
  models into `uno/ocr/hwdigits.json`; the app averages their answers. The model
  shipped now is two CNN checkpoints (round 9 and round 24) combined.

Training uses 10,000 digits from the MNIST set (via the `mnist` npm package,
LeCun, Cortes and Burges, CC BY-SA 3.0). Each training digit is warped, drawn
thicker or thinner and run through the same clean-up the app applies to a photo,
so training matches what the phone sees.

## Test on real photos

Make `sheets.json` listing photos and the newest total in each column, left to right:

```json
[{ "file": "/path/to/sheet.jpg", "want": [319, 267, 298] }]
```

Then `node realtest.js sheets.json`. `MODEL=path.json` tests a different model.
On the three sheets used so far it reads 8 of 9 totals; a photo of one player's
column reads right every time.

## See what the reader sees

- `node segdebug.js photo.jpg out.png` draws the ink it keeps after removing the
  grid, and the marks it treats as writing.
- `node dump.js photo.jpg out` draws a box round every number it reads and saves
  the 28x28 digit images the model saw.

After changing `hwread.js` or the model, bump the version in `uno/version.json`,
`uno/sw.js` and `uno/index.html` so phones update.
