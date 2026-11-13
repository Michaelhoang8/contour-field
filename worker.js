import { processImage } from './core.js';
self.onmessage = ({ data }) => {
  try {
    const started = performance.now(),
      result = processImage(data);
    self.postMessage({ result, milliseconds: performance.now() - started });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
