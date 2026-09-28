// Mise: speech to text for Video → Method, off the main thread so the page
// stays responsive (and Stop works) while a video is being listened to.
import { pipeline, env } from './vendor/asr/transformers.min.js';

env.allowLocalModels = false;
env.backends.onnx.wasm.wasmPaths = new URL('./vendor/asr/', import.meta.url).href;
let pipe = null;

self.onmessage = async (e) => {
  const { id, type, model, audio } = e.data || {};
  try {
    if (type === 'load') {
      if (!pipe) pipe = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8', device: 'wasm',
        progress_callback: (p) => { if (p && p.status === 'progress') self.postMessage({ type: 'progress', file: p.file, loaded: p.loaded, total: p.total }); },
      });
      self.postMessage({ id, ok: true });
    } else if (type === 'run') {
      const r = await pipe(audio, { language: 'english', task: 'transcribe' });
      self.postMessage({ id, ok: true, text: String((r && r.text) || '') });
    }
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
