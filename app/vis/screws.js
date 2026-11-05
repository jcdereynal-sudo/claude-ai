// Détection hors ligne de vis (ou autres petites pièces allongées) étalées sur un fond uni.
//
// Méthode :
//  1. fond estimé localement (flou large), en deux passes pour ne pas être biaisé
//     par les pièces elles-mêmes ;
//  2. un pixel appartient à une pièce si sa couleur s'écarte nettement du fond
//     (seuil robuste : médiane + k × écart absolu médian, k selon la sensibilité) ;
//  3. fermeture / ouverture morphologique, puis composantes connexes ;
//  4. chaque composante est mesurée (aire, centre, axe principal, longueur) ;
//  5. « unité » = aire d'une vis seule (médiane des composantes, ou étalon touché
//     par l'utilisateur). Une composante de n unités compte pour n vis : deux vis
//     qui se touchent comptent donc pour deux.
//
// Le module est pur (aucune dépendance au DOM) pour pouvoir être testé sous Node.

/** Côté le plus long (px) de l'image analysée. */
export const WORK_SIDE = 1400;

/**
 * @param {Uint8ClampedArray} rgba
 * @param {number} width
 * @param {number} height
 * @param {object} [opts]
 * @param {number} [opts.sensitivity=0.5]  0 (strict) … 1 (permissif)
 * @returns {{comps: Comp[], labels: Int32Array}}
 *
 * @typedef {{id:number, x:number, y:number, area:number, len:number, wid:number, ax:number, ay:number,
 *            x0:number, y0:number, x1:number, y1:number}} Comp
 */
export function detectPieces(rgba, width, height, opts = {}) {
  const sensitivity = clamp(opts.sensitivity ?? 0.5, 0, 1);
  const n = width * height;
  const R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) { R[i] = rgba[j]; G[i] = rgba[j + 1]; B[i] = rgba[j + 2]; }
  // léger lissage : atténue le grain du fond et le filetage
  const r0 = 1;
  const Rs = boxBlur(R, width, height, r0), Gs = boxBlur(G, width, height, r0), Bs = boxBlur(B, width, height, r0);

  // Fond : couleur dominante, puis surface quadratique par canal (dégradé d'éclairage),
  // ajustée uniquement sur les pixels reconnus comme fond.
  const step = Math.max(1, Math.round(Math.sqrt(n / 60000)));
  const sx = [], sy = [], sR = [], sG = [], sB = [];
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = y * width + x;
      sx.push(x / width - 0.5); sy.push(y / height - 0.5); sR.push(Rs[i]); sG.push(Gs[i]); sB.push(Bs[i]);
    }
  }
  const m = sx.length;
  const mode = dominantColor(sR, sG, sB);
  let cR = [mode[0], 0, 0, 0, 0, 0], cG = [mode[1], 0, 0, 0, 0, 0], cB = [mode[2], 0, 0, 0, 0, 0];
  const k = 6 - 3 * sensitivity; // 6 (strict) … 3 (permissif)
  const sd = new Float32Array(m);
  let T = 20;
  for (let it = 0; it < 4; it++) {
    for (let j = 0; j < m; j++) {
      sd[j] = colorDist(sR[j] - poly(cR, sx[j], sy[j]), sG[j] - poly(cG, sx[j], sy[j]), sB[j] - poly(cB, sx[j], sy[j]));
    }
    // dispersion du fond estimée sur les pixels les plus proches du modèle
    // (le fond occupe au moins ~30 % de la photo)
    const sigma = percentile(sd, 0.15) * 1.6 + 1.5;
    T = Math.max(12, k * sigma);
    const keep = [];
    for (let j = 0; j < m; j++) if (sd[j] < T * 0.7) keep.push(j);
    if (keep.length < 12) break;
    cR = fitQuad(keep, sx, sy, sR) || cR;
    cG = fitQuad(keep, sx, sy, sG) || cG;
    cB = fitQuad(keep, sx, sy, sB) || cB;
  }
  let mask = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const v = y / height - 0.5;
    for (let x = 0; x < width; x++) {
      const u = x / width - 0.5, i = y * width + x;
      const d = colorDist(Rs[i] - poly(cR, u, v), Gs[i] - poly(cG, u, v), Bs[i] - poly(cB, u, v));
      mask[i] = d > T ? 1 : 0;
    }
  }

  // nettoyage : bouche les petits trous (filetage, reflets), retire le bruit
  mask = erode(dilate(mask, width, height, 1), width, height, 1);
  mask = dilate(erode(mask, width, height, 1), width, height, 1);

  const { labels, count } = label(mask, width, height);
  const st = new Array(count + 1);
  for (let l = 1; l <= count; l++) st[l] = { a: 0, sx: 0, sy: 0, sxx: 0, syy: 0, sxy: 0, x0: width, y0: height, x1: 0, y1: 0, edge: false };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const l = labels[y * width + x];
      if (!l) continue;
      const s = st[l];
      s.a++; s.sx += x; s.sy += y; s.sxx += x * x; s.syy += y * y; s.sxy += x * y;
      if (x < s.x0) s.x0 = x; if (x > s.x1) s.x1 = x;
      if (y < s.y0) s.y0 = y; if (y > s.y1) s.y1 = y;
    }
  }
  const minArea = Math.max(12, n * 2e-5);
  const comps = [];
  for (let l = 1; l <= count; l++) {
    const s = st[l];
    if (s.a < minArea) continue;
    const mx = s.sx / s.a, my = s.sy / s.a;
    const cxx = s.sxx / s.a - mx * mx, cyy = s.syy / s.a - my * my, cxy = s.sxy / s.a - mx * my;
    const tr = cxx + cyy, det = cxx * cyy - cxy * cxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(0, tr / 2 - disc);
    let ax = cxy, ay = l1 - cxx;
    if (Math.abs(ax) + Math.abs(ay) < 1e-9) { ax = cxx >= cyy ? 1 : 0; ay = cxx >= cyy ? 0 : 1; }
    const nrm = Math.hypot(ax, ay);
    comps.push({
      id: l, x: mx, y: my, area: s.a,
      len: Math.sqrt(12 * l1), wid: Math.max(1, Math.sqrt(12 * l2)),
      ax: ax / nrm, ay: ay / nrm,
      x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1,
      border: s.x0 <= 1 || s.y0 <= 1 || s.x1 >= width - 2 || s.y1 >= height - 2,
    });
  }
  return { comps, labels };
}

/**
 * Aire d'une pièce seule, estimée sur les composantes : la plupart sont des pièces
 * isolées quand elles sont étalées, la médiane les représente.
 */
export function estimateUnit(comps) {
  let areas = comps.filter((c) => !c.border).map((c) => c.area).sort((a, b) => a - b);
  if (!areas.length) areas = comps.map((c) => c.area).sort((a, b) => a - b);
  if (!areas.length) return 0;
  if (areas.length > 3000) areas = areas.slice(-3000);
  // Taille « une pièce » = celle que partagent le plus de pixels : les petites taches
  // (grain, reflets) pèsent peu, un amas unique ne se ressemble qu'à lui-même.
  const need = Math.min(2, areas.length);
  let best = null, bestScore = -1;
  for (let i = 0, lo = 0, hi = 0, sum = 0; i < areas.length; i++) {
    const a = areas[i];
    while (hi < areas.length && areas[hi] < a * 1.43) sum += areas[hi++];
    while (lo < hi && areas[lo] <= a * 0.7) sum -= areas[lo++];
    if (hi - lo >= need && sum > bestScore) { bestScore = sum; best = [lo, hi]; }
  }
  if (!best) return areas[areas.length >> 1];
  return areas[(best[0] + best[1] - 1) >> 1];
}

/** Nombre de pièces représentées par une composante (0 = trop petite, ignorée). */
export function piecesIn(comp, unit) {
  if (!unit) return 1;
  const q = comp.area / unit;
  if (q < 0.4) return 0;
  // grande tache collée au bord : autre fond (bord de table, mur…), pas des pièces
  if (comp.border && q > 6) return 0;
  return Math.max(1, Math.round(q));
}

/** Au-delà de ce nombre de pièces collées, la composante est un « amas » : nombre estimé par la surface. */
export const MAX_GROUP = 6;

/**
 * Repères à afficher : un par pièce, répartis le long de l'axe de la composante ;
 * un seul repère « amas » (weight = nombre estimé) pour les gros amas.
 * @returns {{x:number,y:number,r:number,comp:number,n:number,weight:number,cluster?:boolean}[]}
 *          n = nb de pièces de la composante ; weight = nombre de pièces que compte le repère
 */
export function buildMarkers(comps, unit) {
  const out = [];
  for (const c of comps) {
    const k = piecesIn(c, unit);
    if (!k) continue;
    if (k > MAX_GROUP) {
      out.push({ x: c.x, y: c.y, r: Math.sqrt(c.area / Math.PI) * 0.5, comp: c.id, n: k, weight: k, cluster: true });
      continue;
    }
    // taille du repère d'après une pièce seule (pas d'après la tache, qui peut en contenir plusieurs)
    const r = unit ? Math.max(3, Math.sqrt(unit) * 0.3) : Math.max(3, Math.min(c.wid, c.len) * 0.9);
    for (let i = 0; i < k; i++) {
      const t = k === 1 ? 0 : ((i + 0.5) / k - 0.5) * c.len * 0.85;
      out.push({ x: c.x + c.ax * t, y: c.y + c.ay * t, r, comp: c.id, n: k, weight: 1 });
    }
  }
  return out;
}

/** Total compté par une liste de repères. */
export function total(markers) {
  let s = 0;
  for (const m of markers) s += m.weight ?? 1;
  return s;
}

// ---------- outils ----------

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

function percentile(arr, p) {
  let max = 0;
  for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
  if (max === 0) return 0;
  const bins = 2048;
  const hist = new Uint32Array(bins);
  for (let i = 0; i < arr.length; i++) hist[Math.min(bins - 1, Math.floor((arr[i] / max) * bins))]++;
  const target = arr.length * p;
  let acc = 0;
  for (let b = 0; b < bins; b++) {
    acc += hist[b];
    if (acc >= target) return ((b + 0.5) / bins) * max;
  }
  return max;
}

/** Écart de couleur ; l'écart de teinte (fond souvent coloré, métal gris) compte double. */
function colorDist(dr, dg, db) {
  const lum = (dr + dg + db) / 3;
  const cr = dr - lum, cg = dg - lum, cb = db - lum;
  return Math.sqrt(lum * lum + 2 * (cr * cr + cg * cg + cb * cb));
}

function poly(c, u, v) { return c[0] + c[1] * u + c[2] * v + c[3] * u * u + c[4] * v * v + c[5] * u * v; }

/** Couleur la plus fréquente (histogramme 3D grossier), moyennée dans sa case. */
function dominantColor(R, G, B) {
  const q = (v) => Math.min(31, v >> 3);
  const hist = new Uint32Array(32 * 32 * 32);
  for (let j = 0; j < R.length; j++) hist[(q(R[j]) << 10) | (q(G[j]) << 5) | q(B[j])]++;
  // lissage : chaque case compte aussi ses voisines immédiates
  let best = 0, bestV = -1;
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    let s = 0;
    for (let dr = -1; dr <= 1; dr++) for (let dg = -1; dg <= 1; dg++) for (let db = -1; db <= 1; db++) {
      const rr = r + dr, gg = g + dg, bb = b + db;
      if (rr < 0 || gg < 0 || bb < 0 || rr > 31 || gg > 31 || bb > 31) continue;
      s += hist[(rr << 10) | (gg << 5) | bb];
    }
    if (s > bestV) { bestV = s; best = (r << 10) | (g << 5) | b; }
  }
  const br = best >> 10, bg = (best >> 5) & 31, bb = best & 31;
  let sr = 0, sg = 0, sb = 0, c = 0;
  for (let j = 0; j < R.length; j++) {
    if (Math.abs(q(R[j]) - br) <= 1 && Math.abs(q(G[j]) - bg) <= 1 && Math.abs(q(B[j]) - bb) <= 1) {
      sr += R[j]; sg += G[j]; sb += B[j]; c++;
    }
  }
  return c ? [sr / c, sg / c, sb / c] : [br * 8 + 4, bg * 8 + 4, bb * 8 + 4];
}

/** Moindres carrés : surface quadratique sur les échantillons idx. */
function fitQuad(idx, X, Y, V) {
  const A = Array.from({ length: 6 }, () => new Float64Array(7));
  for (const j of idx) {
    const u = X[j], v = Y[j];
    const f = [1, u, v, u * u, v * v, u * v];
    for (let a = 0; a < 6; a++) {
      for (let b = 0; b < 6; b++) A[a][b] += f[a] * f[b];
      A[a][6] += f[a] * V[j];
    }
  }
  for (let a = 0; a < 6; a++) A[a][a] += 1e-6;
  // élimination de Gauss avec pivot partiel
  for (let c = 0; c < 6; c++) {
    let p = c;
    for (let r = c + 1; r < 6; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < 6; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k < 7; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, i) => row[6] / row[i]);
}

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

function dilate(mask, w, h, r) {
  const s = boxSum(mask, w, h, r);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = s[i] > 0.5 ? 1 : 0;
  return out;
}

function erode(mask, w, h, r) {
  const s = boxSum(mask, w, h, r);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const ny = Math.min(h, y + r + 1) - Math.max(0, y - r);
    for (let x = 0; x < w; x++) {
      const nx = Math.min(w, x + r + 1) - Math.max(0, x - r);
      const i = y * w + x;
      out[i] = s[i] > nx * ny - 0.5 ? 1 : 0;
    }
  }
  return out;
}

/** Composantes connexes (8-connexité), deux passes avec union-find. */
function label(mask, w, h) {
  const labels = new Int32Array(w * h);
  const parent = [0];
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const union = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[Math.max(a, b)] = Math.min(a, b); };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      let l = 0;
      const nb = [];
      if (x > 0 && labels[i - 1]) nb.push(labels[i - 1]);
      if (y > 0) {
        if (labels[i - w]) nb.push(labels[i - w]);
        if (x > 0 && labels[i - w - 1]) nb.push(labels[i - w - 1]);
        if (x < w - 1 && labels[i - w + 1]) nb.push(labels[i - w + 1]);
      }
      if (!nb.length) { l = parent.length; parent.push(l); }
      else { l = nb[0]; for (let k = 1; k < nb.length; k++) union(l, nb[k]); }
      labels[i] = l;
    }
  }
  const remap = new Int32Array(parent.length);
  let count = 0;
  for (let l = 1; l < parent.length; l++) {
    const r = find(l);
    if (!remap[r]) remap[r] = ++count;
    remap[l] = remap[r];
  }
  for (let i = 0; i < labels.length; i++) if (labels[i]) labels[i] = remap[labels[i]];
  return { labels, count };
}
