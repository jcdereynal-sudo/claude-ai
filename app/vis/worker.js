// Exécute la détection hors du fil principal pour garder l'interface fluide.
import { detectPieces } from "./screws.js";

self.onmessage = (e) => {
  const { id, buffer, width, height, sensitivity } = e.data;
  try {
    const rgba = new Uint8ClampedArray(buffer);
    const { comps, labels } = detectPieces(rgba, width, height, { sensitivity });
    self.postMessage({ id, comps, labels }, [labels.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
