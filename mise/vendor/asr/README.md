# On-phone speech to text for Video → Method

Copied unchanged from npm so the app doesn't depend on another CDN:

- `transformers.min.js`, `ort-wasm-simd-threaded.jsep.mjs`, `ort-wasm-simd-threaded.jsep.wasm`
  from `@huggingface/transformers` 3.8.1 (`dist/`), Apache-2.0 (LICENSE-transformers.txt).
  The two `ort-wasm-*` files are ONNX Runtime Web 1.22.0-dev.20250409-89f8206ba4, MIT
  licence, © Microsoft Corporation.

The speech model itself (Xenova/whisper-tiny, about 40 MB, MIT) is downloaded from
huggingface.co the first time someone reads a video, then kept on the phone.
