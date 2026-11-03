// Détection hors ligne des extrémités de tuyaux (cercles) dans une image.
//
// Méthode : transformée de Hough "gradient" à rayon connu.
//  1. niveaux de gris lissés, gradient de Sobel, contours amincis ;
//  2. chaque pixel de contour vote le long de son gradient (dans les deux
//     sens) pour un centre situé à une distance comprise dans [rMin, rMax] ;
//  3. les maxima locaux de l'accumulateur deviennent des candidats ;
//  4. chaque candidat est vérifié : on mesure la part du cercle (en secteurs
//     angulaires) réellement bordée par un contour radial, et on affine le rayon ;
//  5. suppression des doublons qui se chevauchent.
//
// Le module est pur (aucune dépendance au DOM) pour pouvoir être testé sous Node.

const SECTORS = 24;

/** Rayon de travail idéal (px) : l'image est redimensionnée pour s'en approcher. */
export const WORK_RADIUS = 16;

/** Facteur d'échelle à appliquer à l'image pour un rayon de tuyau donné (px). */
export function scaleFor(radius) {
  return clamp(WORK_RADIUS / radius, 0.05, 2.5);
}

/**
 * @param {Uint8ClampedArray} rgba   pixels RGBA
 * @param {number} width
 * @param {number} height
 * @param {object} opts
 * @param {number} opts.radius       rayon attendu des tuyaux, en pixels de cette image
 * @param {number} [opts.sensitivity=0.5]  0 (strict) … 1 (permissif)
 * @param {number} [opts.tolerance=0.25]   variation de rayon admise (±25 %)
 * @returns {{x:number,y:number,r:number,score:number}[]}
 */
export function detectCircles(rgba, width, height, opts) {
  const radius = opts.radius;
  const sensitivity = clamp(opts.sensitivity ?? 0.5, 0, 1);
  const tolerance = opts.tolerance ?? 0.25;
  const rMin = Math.max(2, Math.floor(radius * (1 - tolerance)));
  const rMax = Math.max(rMin + 1, Math.ceil(radius * (1 + tolerance)));
  const n = width * height;

  // 1. Niveaux de gris + lissage
  let gray = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    gray[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  }
  // Normalisation locale du contraste (compense un éclairage non uniforme)
  gray = normalizeLocal(gray, width, height, Math.max(4, Math.round(radius * 2.5)));
  const blurR = Math.max(1, Math.round(radius / 10));
  gray = boxBlur(gray, width, height, blurR);
  gray = boxBlur(gray, width, height, blurR);

  // 2. Gradient de Sobel
  const gx = new Float32Array(n);
  const gy = new Float32Array(n);
  const mag = new Float32Array(n);
  let maxMag = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const a = gray[i - width - 1], b = gray[i - width], c = gray[i - width + 1];
      const d = gray[i - 1], f = gray[i + 1];
      const g = gray[i + width - 1], h = gray[i + width], k = gray[i + width + 1];
      const sx = c + 2 * f + k - a - 2 * d - g;
      const sy = g + 2 * h + k - a - 2 * b - c;
      gx[i] = sx;
      gy[i] = sy;
      const m = Math.hypot(sx, sy);
      mag[i] = m;
      if (m > maxMag) maxMag = m;
    }
  }
  if (maxMag === 0) return [];

  // Seuil de contour : percentile des magnitudes, borné par une fraction du max
  const edgeThreshold = Math.max(percentile(mag, 0.6), maxMag * 0.06, 8);

  // Amincissement (suppression des non-maxima le long du gradient)
  const edge = new Uint8Array(n);
  const edgeList = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const m = mag[i];
      if (m < edgeThreshold) continue;
      const ux = gx[i] / m, uy = gy[i] / m;
      const ox = Math.round(ux), oy = Math.round(uy);
      const m1 = mag[i + oy * width + ox];
      const m2 = mag[i - oy * width - ox];
      if (m >= m1 && m >= m2) {
        edge[i] = 1;
        edgeList.push(i);
      }
    }
  }

  // 3. Vote dans l'accumulateur des centres
  const acc = new Float32Array(n);
  for (const i of edgeList) {
    const x = i % width, y = (i / width) | 0;
    const m = mag[i];
    const ux = gx[i] / m, uy = gy[i] / m;
    for (let r = rMin; r <= rMax; r++) {
      let cx = Math.round(x + ux * r), cy = Math.round(y + uy * r);
      if (cx >= 0 && cy >= 0 && cx < width && cy < height) acc[cy * width + cx] += 1;
      cx = Math.round(x - ux * r); cy = Math.round(y - uy * r);
      if (cx >= 0 && cy >= 0 && cx < width && cy < height) acc[cy * width + cx] += 1;
    }
  }
  const accR = Math.max(1, Math.round(radius / 8));
  const accSum = boxSum(acc, width, height, accR);

  // Maxima locaux au-dessus d'un seuil bas
  const minVotes = 0.2 * 2 * Math.PI * radius;
  const win = Math.max(2, Math.round(radius * 0.3));
  let candidates = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = accSum[y * width + x];
      if (v < minVotes) continue;
      let isMax = true;
      for (let dy = -win; dy <= win && isMax; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -win; dx <= win; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width || (dx === 0 && dy === 0)) continue;
          const w = accSum[yy * width + xx];
          // départage des plateaux : on garde le premier pixel rencontré
          if (w > v || (w === v && (dy < 0 || (dy === 0 && dx < 0)))) { isMax = false; break; }
        }
      }
      if (isMax) candidates.push({ x, y, votes: v });
    }
  }
  candidates.sort((a, b) => b.votes - a.votes);
  if (candidates.length > 6000) candidates = candidates.slice(0, 6000);

  // 4. Vérification : couverture angulaire + rayon affiné
  const minCoverage = 0.85 - 0.5 * sensitivity; // 0.85 (strict) … 0.35 (permissif)
  const nR = rMax - rMin + 1;
  const hits = new Int32Array(nR);
  const scored = [];
  for (const c of candidates) {
    hits.fill(0);
    const reach = rMax + 2;
    const x0 = Math.max(1, c.x - reach), x1 = Math.min(width - 2, c.x + reach);
    const y0 = Math.max(1, c.y - reach), y1 = Math.min(height - 2, c.y + reach);
    for (let y = y0; y <= y1; y++) {
      const dy = y - c.y;
      for (let x = x0; x <= x1; x++) {
        const i = y * width + x;
        if (!edge[i]) continue;
        const dx = x - c.x;
        const d = Math.hypot(dx, dy);
        if (d < rMin - 1.5 || d > rMax + 1.5) continue;
        // le gradient doit être (à peu près) radial
        const radial = Math.abs(dx * gx[i] + dy * gy[i]) / (d * mag[i]);
        if (radial < 0.8) continue;
        let ang = Math.atan2(dy, dx);
        if (ang < 0) ang += 2 * Math.PI;
        const bit = 1 << Math.min(SECTORS - 1, Math.floor((ang / (2 * Math.PI)) * SECTORS));
        const lo = Math.max(0, Math.ceil(d - 1.5) - rMin);
        const hi = Math.min(nR - 1, Math.floor(d + 1.5) - rMin);
        for (let k = lo; k <= hi; k++) hits[k] |= bit;
      }
    }
    // Plusieurs anneaux possibles (tube creux : paroi intérieure + extérieure).
    // On retient le plus grand rayon dont la couverture est proche du meilleur.
    let best = 0;
    const counts = new Int32Array(nR);
    for (let k = 0; k < nR; k++) {
      counts[k] = popcount(hits[k]);
      if (counts[k] > best) best = counts[k];
    }
    const coverage = best / SECTORS;
    if (coverage < minCoverage) continue;
    let bestK = 0;
    for (let k = nR - 1; k >= 0; k--) {
      if (counts[k] >= best - 1) { bestK = k; break; }
    }
    scored.push({ x: c.x, y: c.y, r: rMin + bestK, score: coverage, votes: c.votes });
  }

  // 5. Suppression des chevauchements (les meilleurs d'abord)
  scored.sort((a, b) => b.score - a.score || b.votes - a.votes);
  const kept = [];
  const cell = rMax * 2;
  const grid = new Map();
  const key = (gx_, gy_) => gx_ * 100003 + gy_;
  for (const s of scored) {
    const gx0 = Math.floor(s.x / cell), gy0 = Math.floor(s.y / cell);
    let clash = false;
    for (let a = -1; a <= 1 && !clash; a++) {
      for (let b = -1; b <= 1 && !clash; b++) {
        const list = grid.get(key(gx0 + a, gy0 + b));
        if (!list) continue;
        for (const o of list) {
          if (Math.hypot(o.x - s.x, o.y - s.y) < 0.75 * (o.r + s.r)) { clash = true; break; }
        }
      }
    }
    if (clash) continue;
    kept.push(s);
    const k = key(gx0, gy0);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  return kept.map(({ x, y, r, score }) => ({ x, y, r, score }));
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function popcount(v) {
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function percentile(arr, p) {
  // histogramme (rapide) sur les valeurs non nulles
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (max === 0) return 0;
  const bins = 1024;
  const hist = new Uint32Array(bins);
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (v <= 0) continue;
    hist[Math.min(bins - 1, Math.floor((v / max) * bins))]++;
    total++;
  }
  const target = total * p;
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= target) return ((b + 1) / bins) * max;
  }
  return max;
}

// Somme sur une fenêtre carrée (2r+1)² via image intégrale
function boxSum(src, w, h, r) {
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ya = Math.max(0, y - r), yb = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const xa = Math.max(0, x - r), xb = Math.min(w, x + r + 1);
      out[y * w + x] = integral[yb * W + xb] - integral[ya * W + xb] - integral[yb * W + xa] + integral[ya * W + xa];
    }
  }
  return out;
}

function normalizeLocal(src, w, h, r) {
  const n = w * h;
  const sq = new Float32Array(n);
  for (let i = 0; i < n; i++) sq[i] = src[i] * src[i];
  const mean = boxBlur(src, w, h, r);
  const meanSq = boxBlur(sq, w, h, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const std = Math.sqrt(Math.max(0, meanSq[i] - mean[i] * mean[i]));
    out[i] = 128 + (60 * (src[i] - mean[i])) / (std + 12);
  }
  return out;
}

function boxBlur(src, w, h, r) {
  const sum = boxSum(src, w, h, r);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = Math.min(h, y + r + 1) - Math.max(0, y - r);
    for (let x = 0; x < w; x++) {
      const nx = Math.min(w, x + r + 1) - Math.max(0, x - r);
      out[y * w + x] = sum[y * w + x] / (nx * ny);
    }
  }
  return out;
}
