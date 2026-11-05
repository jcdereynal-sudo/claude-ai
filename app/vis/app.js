import { WORK_SIDE, estimateUnit, buildMarkers, total } from "./screws.js";

// ---------- Éléments ----------
const $ = (id) => document.getElementById(id);
const stage = $("stage"), canvas = $("view"), ctx = canvas.getContext("2d");
const els = {
  empty: $("empty"), toolbar: $("toolbar"), badge: $("countBadge"), count: $("countValue"),
  hint: $("hint"), busy: $("busy"), busyText: $("busyText"), toast: $("toast"),
  tunePanel: $("tunePanel"), sens: $("sens"), sensOut: $("sensOut"), unitNote: $("unitNote"),
  zonePanel: $("zonePanel"), btnZone: $("btnZone"), btnZoneClear: $("btnZoneClear"), btnZoneDone: $("btnZoneDone"),
  btnNew: $("btnNew"), btnMode: $("btnMode"), btnUndo: $("btnUndo"), btnCount: $("btnCount"), btnAI: $("btnAI"),
  dlg: $("dlgSettings"), apiKey: $("apiKey"),
};

// ---------- État ----------
const MAX_IMAGE_SIDE = 3000;      // limite mémoire pour l'image affichée
const COLORS = { auto: "#2fbf71", manual: "#3d9bff", ai: "#b57bff", cluster: "#ff9f1c" };

let image = null;                 // canvas contenant la photo
let markers = [];                 // {x, y, r, src, weight, cluster?, comp?} en px image
let undoStack = [];
let mode = "edit";                // 'edit' | 'tune' (étalon + sensibilité) | 'zone'
let modeBeforeZone = "edit";
let zone = null;                  // polygone [{x, y}] (px image) ou null = toute la photo
let view = { scale: 1, tx: 0, ty: 0 };
let dpr = window.devicePixelRatio || 1;
let hasCounted = false;
// Résultat de la dernière détection (échelle de travail) : pour l'étalon sans recalcul.
let det = null;                   // {comps, labels, w, h, s}
let unit = 0;                     // aire d'une vis seule (px², échelle de travail)
let unitFromUser = false;         // étalon touché par l'utilisateur

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};
els.sens.value = store.get("vis.sensitivity", "50");

// ---------- Chargement de photo ----------
for (const input of [$("inCamera"), $("inGallery")]) {
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    input.value = "";
    if (file) await loadFile(file);
  });
}
els.btnNew.addEventListener("click", () => {
  if (markers.length && !confirm("Abandonner ce comptage et prendre une nouvelle photo ?")) return;
  resetToEmpty();
});

async function loadFile(file) {
  showBusy("Chargement de la photo…");
  try {
    let src;
    try {
      src = await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      src = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Format d'image non pris en charge."));
        img.src = URL.createObjectURL(file);
      });
    }
    const w0 = src.width, h0 = src.height;
    const k = Math.min(1, MAX_IMAGE_SIDE / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.round(w0 * k);
    c.height = Math.round(h0 * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    if (src.close) src.close();
    image = c;
    markers = []; undoStack = []; hasCounted = false; zone = null;
    det = null; unit = 0; unitFromUser = false;
    els.empty.hidden = true;
    els.toolbar.hidden = false;
    setMode("edit");
    resize();
    fitView();
    updateUI();
    // Le comptage démarre tout seul : il n'y a rien à régler avant.
    await countOffline();
  } catch (err) {
    toast(err.message || String(err), true);
  } finally {
    hideBusy();
  }
}

function resetToEmpty() {
  image = null; markers = []; undoStack = []; hasCounted = false; zone = null;
  det = null; unit = 0; unitFromUser = false;
  els.empty.hidden = false;
  els.toolbar.hidden = true;
  els.badge.hidden = true;
  els.hint.hidden = true;
  draw();
}

// ---------- Modes ----------
els.btnMode.addEventListener("click", () => setMode(mode === "tune" ? "edit" : "tune"));

function setMode(m) {
  if (m === "zone" && mode !== "zone") modeBeforeZone = mode;
  mode = m;
  els.tunePanel.hidden = m !== "tune";
  els.zonePanel.hidden = m !== "zone";
  els.btnMode.textContent = m === "tune" ? "Corriger" : "Étalon";
  els.btnMode.title = m === "tune" ? "Revenir à la correction manuelle" : "Étalon et sensibilité";
  els.btnZone.classList.toggle("active", m === "zone");
  setHint();
  updateUI();
  resize();
  draw();
}

function setHint() {
  if (!image) { els.hint.hidden = true; return; }
  els.hint.hidden = false;
  els.hint.textContent = mode === "zone"
    ? "Entourez au doigt les vis à compter, d'un seul trait. Le reste de la photo sera ignoré. Deux doigts pour zoomer ou déplacer."
    : mode === "tune"
      ? "Touchez UNE vis bien isolée : elle sert d'étalon pour reconnaître les vis qui se touchent. Puis « Corriger »."
      : "Touchez une vis oubliée pour l'ajouter, ou un repère erroné pour le retirer. Touchez un amas orange pour saisir son nombre.";
}

// ---------- Zone à compter ----------
els.btnZone.addEventListener("click", () => setMode(mode === "zone" ? modeBeforeZone : "zone"));
els.btnZoneDone.addEventListener("click", () => setMode(modeBeforeZone));
els.btnZoneClear.addEventListener("click", () => {
  if (!zone) return;
  pushUndo();
  zone = null;
  if (det) rebuild();
  updateUI();
  draw();
});

function finishZone(pts) {
  const poly = simplify(pts, 2 / view.scale);
  const minSide = Math.min(image.width, image.height);
  if (poly.length < 3 || Math.abs(polyArea(poly)) < (minSide * 0.05) ** 2) {
    toast("Zone trop petite : entourez les vis à compter d'un trait continu.", true);
    draw();
    return;
  }
  pushUndo();
  zone = poly;
  if (det) rebuild(); else markers = markers.filter((m) => inZone(m));
  setMode(modeBeforeZone);
}

function inZone(p) {
  if (!zone) return true;
  let inside = false;
  for (let i = 0, j = zone.length - 1; i < zone.length; j = i++) {
    const a = zone[i], b = zone[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function bbox(poly) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
  return a / 2;
}

function simplify(pts, minDist) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) >= minDist) out.push(p);
  }
  return out;
}

function tracePolygon(c, poly) {
  c.beginPath();
  poly.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
}

// ---------- Curseur ----------
els.sens.addEventListener("input", () => { updateUI(); });
els.sens.addEventListener("change", () => {
  store.set("vis.sensitivity", els.sens.value);
  if (hasCounted) countOffline();
});

function updateUI() {
  els.sensOut.textContent = `${els.sens.value} %`;
  const n = total(markers);
  const approx = markers.some((m) => m.cluster);
  els.count.textContent = (approx ? "≈ " : "") + n;
  els.badge.classList.toggle("approx", approx);
  els.badge.hidden = !hasCounted && markers.length === 0;
  els.btnUndo.disabled = undoStack.length === 0;
  els.btnZone.classList.toggle("has-zone", !!zone);
  els.btnZoneClear.disabled = !zone;
  els.unitNote.textContent = !det
    ? "Touchez « Compter » d'abord."
    : unitFromUser
      ? "Étalon choisi : la vis que vous avez touchée."
      : "Étalon automatique (taille la plus fréquente). Touchez une vis isolée pour le fixer.";
}

// ---------- Comptage hors ligne ----------
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let jobId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data);
};
worker.onerror = (e) => {
  for (const p of pending.values()) p.reject(new Error(e.message || "Erreur du module de détection."));
  pending.clear();
};

els.btnCount.addEventListener("click", countOffline);

async function countOffline() {
  if (!image) return;
  // Toujours toute la photo (le fond est estimé sur l'ensemble) ; la zone filtre ensuite.
  const s = Math.min(1, WORK_SIDE / Math.max(image.width, image.height));
  const w = Math.max(1, Math.round(image.width * s)), h = Math.max(1, Math.round(image.height * s));
  showBusy("Comptage en cours…");
  try {
    const work = document.createElement("canvas");
    work.width = w; work.height = h;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    wctx.imageSmoothingQuality = "high";
    wctx.drawImage(image, 0, 0, w, h);
    const data = wctx.getImageData(0, 0, w, h);
    const id = ++jobId;
    const res = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, buffer: data.data.buffer, width: w, height: h, sensitivity: Number(els.sens.value) / 100 }, [data.data.buffer]);
    });
    pushUndo();
    det = { comps: res.comps, labels: res.labels, w, h, s };
    if (!unitFromUser) unit = estimateUnit(det.comps);
    markers = [];
    rebuild();
    hasCounted = true;
    if (mode !== "zone") setMode("edit");
    updateUI();
    reportResult();
  } catch (err) {
    toast("Échec du comptage : " + (err.message || err), true);
  } finally {
    hideBusy();
  }
}

/** Recalcule les repères automatiques (étalon ou zone changés) ; garde les ajouts manuels. */
function rebuild() {
  const s = det.s;
  const kept = markers.filter((m) => m.src === "manual" && inZone(m));
  // un amas dont le nombre a été saisi à la main garde ce nombre
  const fixed = new Set(kept.filter((m) => m.counted).map((m) => m.comp));
  const auto = buildMarkers(det.comps, unit)
    .filter((m) => !fixed.has(m.comp))
    .map((m) => ({ ...m, x: m.x / s, y: m.y / s, r: m.r / s, src: m.cluster ? "cluster" : "auto" }))
    .filter((m) => inZone(m));
  markers = auto.concat(kept);
  updateUI();
  draw();
}

function reportResult() {
  const clusters = markers.filter((m) => m.cluster);
  if (!markers.length) {
    toast("Aucune vis trouvée. Vérifiez que le fond est uni et contrasté, ou augmentez la sensibilité (Étalon).", true);
  } else if (clusters.length) {
    const inClusters = total(clusters);
    toast(`${clusters.length > 1 ? clusters.length + " amas" : "Un amas"} (en orange) d'environ ${inClusters} vis : nombre estimé par la surface. ` +
      "Pour un compte exact, étalez ces vis et reprenez une photo, ou touchez « IA ».");
  }
}

// ---------- Étalon ----------
function pickComponent(ix, iy) {
  if (!det) return null;
  const { labels, w, h, s } = det;
  const x0 = Math.round(ix * s), y0 = Math.round(iy * s);
  // pixel touché, sinon le plus proche dans un petit rayon (doigt imprécis)
  const R = Math.max(3, Math.round(12 / (view.scale / s)));
  let best = 0, bestD = Infinity;
  for (let dy = -R; dy <= R; dy++) {
    const y = y0 + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const x = x0 + dx;
      if (x < 0 || x >= w) continue;
      const l = labels[y * w + x];
      if (!l) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = l; }
    }
  }
  return best ? det.comps.find((c) => c.id === best) || null : null;
}

function setUnitFrom(ix, iy) {
  const c = pickComponent(ix, iy);
  if (!c) { toast("Aucune vis à cet endroit. Touchez précisément une vis isolée.", true); return; }
  pushUndo();
  unit = c.area;
  unitFromUser = true;
  rebuild();
  toast(`Étalon enregistré. Total recalculé : ${total(markers)} vis.`);
}

// ---------- Comptage par IA ----------
els.btnAI.addEventListener("click", countWithAI);
$("btnSettings").addEventListener("click", openSettings);
$("btnSaveKey").addEventListener("click", () => store.set("anthropicKey", els.apiKey.value.trim()));

function openSettings() {
  els.apiKey.value = store.get("anthropicKey", "");
  els.dlg.showModal();
}

async function countWithAI() {
  if (!image) return;
  const key = store.get("anthropicKey", "");
  if (!key) { openSettings(); return; }
  if (!navigator.onLine) { toast("L'analyse IA nécessite une connexion Internet.", true); return; }
  showBusy("Analyse par IA… (jusqu'à une minute)");
  try {
    const { countWithClaude } = await import("./ai.js");
    const lenImg = typicalLength();
    const margin = lenImg ? lenImg * 0.6 : 0;
    const rect = zone ? (() => {
      const b = bbox(zone);
      const x = Math.max(0, Math.floor(b.minX - margin)), y = Math.max(0, Math.floor(b.minY - margin));
      const x2 = Math.min(image.width, Math.ceil(b.maxX + margin)), y2 = Math.min(image.height, Math.ceil(b.maxY + margin));
      return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
    })() : { x: 0, y: 0, w: image.width, h: image.height };
    const k = Math.min(1, 1568 / Math.max(rect.w, rect.h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(rect.w * k)); c.height = Math.max(1, Math.round(rect.h * k));
    const cctx = c.getContext("2d");
    cctx.fillStyle = "#808080";
    cctx.fillRect(0, 0, c.width, c.height);
    cctx.save();
    if (zone) {
      tracePolygon(cctx, zone.map((p) => ({ x: (p.x - rect.x) * k, y: (p.y - rect.y) * k })));
      cctx.clip();
    }
    cctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    cctx.restore();
    const b64 = c.toDataURL("image/jpeg", 0.9).split(",")[1];
    const res = await countWithClaude(key, b64, c.width, c.height, lenImg ? lenImg * k : null, !!zone);
    pushUndo();
    const r = markerRadius();
    markers = res.screws
      .map((p) => ({ x: rect.x + p.x / k, y: rect.y + p.y / k, r, src: "ai", weight: 1 }))
      .filter((m) => m.x >= 0 && m.y >= 0 && m.x <= image.width && m.y <= image.height && inZone(m));
    hasCounted = true;
    setMode("edit");
    updateUI();
    let msg = `IA : ${markers.length} vis repérées.`;
    if (res.count !== markers.length) msg += ` (L'IA annonce ${res.count} au total.)`;
    if (res.notes) msg += " " + res.notes;
    msg += " Vérifiez les repères violets et corrigez si besoin.";
    toast(msg);
  } catch (err) {
    toast(err.message || String(err), true);
  } finally {
    hideBusy();
  }
}

/** Longueur typique d'une vis (px image), d'après l'étalon ; null si inconnue. */
function typicalLength() {
  if (!det || !unit) return null;
  const singles = det.comps.filter((c) => c.area > unit * 0.7 && c.area < unit * 1.4).map((c) => c.len).sort((a, b) => a - b);
  return singles.length ? singles[singles.length >> 1] / det.s : null;
}

function markerRadius() {
  const single = markers.find((m) => m.src === "auto");
  if (single) return single.r;
  return Math.min(image.width, image.height) * 0.012;
}

// ---------- Annulation ----------
els.btnUndo.addEventListener("click", () => {
  const prev = undoStack.pop();
  if (!prev) return;
  markers = prev.markers;
  hasCounted = prev.hasCounted;
  zone = prev.zone;
  unit = prev.unit;
  unitFromUser = prev.unitFromUser;
  det = prev.det;
  updateUI();
  draw();
});

function pushUndo() {
  undoStack.push({ markers: markers.map((m) => ({ ...m })), hasCounted, zone, unit, unitFromUser, det });
  if (undoStack.length > 50) undoStack.shift();
}

// ---------- Interactions (toucher / souris) ----------
const pointers = new Map();
let gesture = null;

canvas.addEventListener("pointerdown", (e) => {
  if (!image) return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, pt(e));
  if (pointers.size === 1) {
    gesture = mode === "zone"
      ? { type: "draw", pts: [toImage(pt(e))] }
      : { type: "pan", start: pt(e), last: pt(e), moved: false, multi: false };
    if (gesture.type === "draw") draw();
  } else if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    gesture = { type: "pinch", dist: Math.hypot(a.x - b.x, a.y - b.y), mid: mid(a, b), view: { ...view }, multi: true };
  }
});

canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId) || !gesture) return;
  pointers.set(e.pointerId, pt(e));
  if (gesture.type === "draw" && pointers.size === 1) {
    gesture.pts.push(toImage(pt(e)));
    draw();
  } else if (gesture.type === "pan" && pointers.size === 1) {
    const p = pt(e);
    if (!gesture.moved && Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > 8) gesture.moved = true;
    if (gesture.moved) {
      view.tx += p.x - gesture.last.x;
      view.ty += p.y - gesture.last.y;
      gesture.last = p;
      draw();
    }
  } else if (gesture.type === "pinch" && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const m = mid(a, b);
    const s = clampScale(gesture.view.scale * (d / gesture.dist));
    const ix = (gesture.mid.x - gesture.view.tx) / gesture.view.scale;
    const iy = (gesture.mid.y - gesture.view.ty) / gesture.view.scale;
    view.scale = s;
    view.tx = m.x - ix * s;
    view.ty = m.y - iy * s;
    draw();
  }
});

const endPointer = (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.delete(e.pointerId);
  if (!gesture) return;
  if (pointers.size === 0) {
    const g = gesture;
    gesture = null;
    if (g.type === "draw") {
      if (e.type === "pointerup") finishZone(g.pts); else draw();
    } else if (g.type === "pan" && !g.moved && !g.multi && e.type === "pointerup") onTap(pt(e));
  } else if (pointers.size === 1) {
    const p = [...pointers.values()][0];
    gesture = { type: "pan", start: p, last: p, moved: true, multi: true };
  }
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener("wheel", (e) => {
  if (!image) return;
  e.preventDefault();
  const p = pt(e);
  const s = clampScale(view.scale * Math.exp(-e.deltaY * 0.0015));
  const ix = (p.x - view.tx) / view.scale, iy = (p.y - view.ty) / view.scale;
  view.scale = s;
  view.tx = p.x - ix * s;
  view.ty = p.y - iy * s;
  draw();
}, { passive: false });

function toImage(p) {
  return { x: (p.x - view.tx) / view.scale, y: (p.y - view.ty) / view.scale };
}

/** Rayon (px image) du point dessiné pour un repère : lisible quel que soit le zoom. */
function dotRadius(m) {
  return Math.max(5 / view.scale, Math.min(m.r * 0.6, 12 / view.scale));
}

function onTap(p) {
  if (mode === "zone") return;
  const { x: ix, y: iy } = toImage(p);
  if (ix < 0 || iy < 0 || ix > image.width || iy > image.height) return;
  if (mode === "tune") { setUnitFrom(ix, iy); return; }
  // repère touché ? (le plus proche, avec une marge pour le doigt)
  let best = -1, bestD = Infinity;
  markers.forEach((m, i) => {
    const d = Math.hypot(m.x - ix, m.y - iy);
    const reach = m.cluster ? Math.max(m.r, 24 / view.scale) : Math.max(dotRadius(m), 14 / view.scale);
    if (d < reach && d < bestD) { best = i; bestD = d; }
  });
  if (best >= 0 && markers[best].cluster) { editCluster(best); return; }
  pushUndo();
  if (best >= 0) markers.splice(best, 1);
  else markers.push({ x: ix, y: iy, r: markerRadius(), src: "manual", weight: 1 });
  hasCounted = true;
  updateUI();
  draw();
}

function editCluster(i) {
  const m = markers[i];
  const v = prompt("Nombre de vis dans cet amas (estimation actuelle : " + m.weight + ").\nMettez 0 pour l'ignorer.", String(m.weight));
  if (v === null) return;
  const n = Math.round(Number(v.replace(",", ".")));
  if (!Number.isFinite(n) || n < 0) { toast("Nombre invalide.", true); return; }
  pushUndo();
  if (n === 0) markers.splice(i, 1);
  else markers[i] = { ...m, weight: n, n, src: "manual", cluster: false, counted: true, clusterR: m.r };
  updateUI();
  draw();
}

function pt(e) {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}
function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }
function clampScale(s) {
  if (!image) return s;
  const fit = fitScale();
  return Math.min(Math.max(s, fit * 0.5), fit * 40);
}

// ---------- Affichage ----------
function fitScale() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  return Math.min(w / image.width, h / image.height);
}
function fitView() {
  if (!image) return;
  const s = fitScale();
  view.scale = s;
  view.tx = (canvas.clientWidth - image.width * s) / 2;
  view.ty = (canvas.clientHeight - image.height * s) / 2;
  draw();
}

function resize() {
  dpr = window.devicePixelRatio || 1;
  const w = stage.clientWidth, h = stage.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  draw();
}
new ResizeObserver(() => { const had = image && view.scale; resize(); if (had) draw(); }).observe(stage);

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = "#0b0e11";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!image) return;
  ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, dpr * view.tx, dpr * view.ty);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0);
  const px = 1 / view.scale; // 1 pixel écran en unités image

  if (zone) {
    ctx.beginPath();
    ctx.rect(0, 0, image.width, image.height);
    zone.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.fillStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fill("evenodd");
    tracePolygon(ctx, zone);
    ctx.lineWidth = 2.5 * px;
    ctx.strokeStyle = "#ffd23f";
    ctx.setLineDash([10 * px, 6 * px]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (gesture && gesture.type === "draw" && gesture.pts.length > 1) {
    ctx.beginPath();
    gesture.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = "#ffd23f";
    ctx.stroke();
  }

  // amas (nombre estimé, ou saisi à la main) : cercle + étiquette
  for (const m of markers) {
    if (!m.cluster && !m.counted) continue;
    const color = m.cluster ? COLORS.cluster : COLORS.manual;
    const rr = m.cluster ? m.r : m.clusterR;
    ctx.beginPath();
    ctx.arc(m.x, m.y, rr, 0, Math.PI * 2);
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = color;
    ctx.setLineDash([10 * px, 7 * px]);
    ctx.stroke();
    ctx.setLineDash([]);
    label(m.x, m.y, (m.cluster ? "≈ " : "") + m.weight, color, px);
  }
  // une pièce = un point
  for (const m of markers) {
    if (m.cluster || m.counted) continue;
    const color = COLORS[m.src] || COLORS.auto;
    ctx.beginPath();
    ctx.arc(m.x, m.y, dotRadius(m), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5 * px;
    ctx.strokeStyle = "#0b0e11";
    ctx.stroke();
  }
}

function label(x, y, text, color, px) {
  ctx.font = `800 ${18 * px}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 16 * px, h = 28 * px;
  ctx.fillStyle = "rgba(10, 14, 18, .85)";
  ctx.beginPath();
  ctx.roundRect(x - w / 2, y - h / 2, w, h, 8 * px);
  ctx.fill();
  ctx.lineWidth = 2 * px;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 1 * px);
}

// ---------- Divers ----------
function showBusy(text) { els.busyText.textContent = text; els.busy.hidden = false; }
function hideBusy() { els.busy.hidden = true; }

let toastTimer = 0;
function toast(msg, isError = false) {
  els.toast.textContent = msg;
  els.toast.classList.toggle("error", isError);
  els.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { els.toast.hidden = true; }, Math.min(12000, 3000 + msg.length * 50));
}
els.toast.addEventListener("click", () => { els.toast.hidden = true; });

if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => { /* hors ligne non disponible */ });
}

updateUI();
draw();
