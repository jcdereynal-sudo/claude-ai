// Exécute la détection hors du fil principal pour garder l'interface fluide.
import { detectCircles } from "./detector.js";

self.onmessage = (e) => {
  const { id, buffer, width, height, radius, sensitivity } = e.data;
  try {
    const rgba = new Uint8ClampedArray(buffer);
    const circles = detectCircles(rgba, width, height, { radius, sensitivity });
    self.postMessage({ id, circles });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
