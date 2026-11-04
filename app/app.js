import { scaleFor } from "./detector.js";

// ---------- Éléments ----------
const $ = (id) => document.getElementById(id);
const stage = $("stage"), canvas = $("view"), ctx = canvas.getContext("2d");
const els = {
  empty: $("empty"), toolbar: $("toolbar"), badge: $("countBadge"), count: $("countValue"),
  hint: $("hint"), busy: $("busy"), busyText: $("busyText"), toast: $("toast"),
  calibPanel: $("calibPanel"), diam: $("diam"), diamOut: $("diamOut"), sens: $("sens"), sensOut: $("sensOut"),
  zonePanel: $("zonePanel"), btnZone: $("btnZone"), btnZoneClear: $("btnZoneClear"), btnZoneDone: $("btnZoneDone"),
  btnNew: $("btnNew"), btnMode: $("btnMode"), btnUndo: $("btnUndo"), btnCount: $("btnCount"), btnAI: $("btnAI"),
  dlg: $("dlgSettings"), apiKey: $("apiKey"),
};

// ---------- État ----------
const MAX_IMAGE_SIDE = 3000;      // limite mémoire pour l'image affichée
const MAX_WORK_PIXELS = 4.5e6;    // limite pour l'image analysée
const COLORS = { auto: "#2fbf71", manual: "#3d9bff", ai: "#b57bff" };

let image = null;                 // canvas contenant la photo
let markers = [];                 // {x, y, r, src: 'auto'|'manual'|'ai'} en px image
let undoStack = [];
let mode = "calibrate";           // 'calibrate' | 'edit' | 'zone'
let modeBeforeZone = "calibrate";
let guide = null;                 // {x, y} centre du cercle-guide (px image)
let zone = null;                  // polygone [{x, y}] (px image) : seule zone comptée, ou null = toute la photo
let view = { scale: 1, tx: 0, ty: 0 };
let dpr = window.devicePixelRatio || 1;
let hasCounted = false;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
};
els.sens.value = store.get("sensitivity", "50");

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
    markers = [];
    undoStack = [];
    hasCounted = false;
    zone = null;
    const minSide = Math.min(c.width, c.height);
    els.diam.min = Math.max(6, Math.round(minSide * 0.01));
    els.diam.max = Math.round(minSide * 0.5);
    els.diam.value = Math.round(minSide * 0.08);
    guide = { x: c.width / 2, y: c.height / 2 };
    els.empty.hidden = true;
    els.toolbar.hidden = false;
    setMode("calibrate");
    resize();
    fitView();
    updateUI();
  } catch (err) {
    toast(err.message || String(err), true);
  } finally {
    hideBusy();
  }
}

function resetToEmpty() {
  image = null; markers = []; undoStack = []; guide = null; hasCounted = false; zone = null;
  els.empty.hidden = false;
  els.toolbar.hidden = true;
  els.badge.hidden = true;
  els.hint.hidden = true;
  draw();
}

// ---------- Modes ----------
els.btnMode.addEventListener("click", () => setMode(mode === "calibrate" ? "edit" : "calibrate"));

function setMode(m) {
  if (m === "zone" && mode !== "zone") modeBeforeZone = mode;
  mode = m;
  els.calibPanel.hidden = m !== "calibrate";
  els.zonePanel.hidden = m !== "zone";
  els.btnMode.textContent = m === "calibrate" ? "Corriger" : "Diamètre";
  els.btnMode.title = m === "calibrate" ? "Passer en correction manuelle" : "Régler le diamètre des tuyaux";
  els.btnZone.classList.toggle("active", m === "zone");
  setHint();
  updateUI();
  resize();
  draw();
}

// ---------- Zone à compter ----------
els.btnZone.addEventListener("click", () => setMode(mode === "zone" ? modeBeforeZone : "zone"));
els.btnZoneDone.addEventListener("click", () => setMode(modeBeforeZone));
els.btnZoneClear.addEventListener("click", () => {
  if (!zone) return;
  pushUndo();
  zone = null;
  updateUI();
  draw();
  if (hasCounted) toast("Zone effacée. Touchez « Compter » pour recompter toute la photo.");
});

function finishZone(pts) {
  const poly = simplify(pts, 2 / view.scale);
  if (poly.length < 3 || Math.abs(polyArea(poly)) < (Number(els.diam.value) ** 2)) {
    toast("Zone trop petite : entourez les tuyaux à compter d'un trait continu.", true);
    draw();
    return;
  }
  pushUndo();
  zone = poly;
  // Les repères hors de la zone ne comptent plus.
  if (markers.length) markers = markers.filter((m) => inZone(m));
  // Place le cercle-guide dans la zone s'il n'y est pas.
  if (!guide || !inZone(guide)) {
    const b = bbox(zone);
    guide = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
  }
  setMode(modeBeforeZone);
  if (!hasCounted) toast("Zone enregistrée. Réglez le diamètre puis touchez « Compter ».");
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

/** Rectangle (px image, entiers) à analyser : la zone + une marge, ou toute la photo. */
function analysisRect(margin) {
  if (!zone) return { x: 0, y: 0, w: image.width, h: image.height };
  const b = bbox(zone);
  const x = Math.max(0, Math.floor(b.minX - margin)), y = Math.max(0, Math.floor(b.minY - margin));
  const x2 = Math.min(image.width, Math.ceil(b.maxX + margin)), y2 = Math.min(image.height, Math.ceil(b.maxY + margin));
  return { x, y, w: Math.max(1, x2 - x), h: Math.max(1, y2 - y) };
}

function tracePolygon(c, poly) {
  c.beginPath();
  poly.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y)));
  c.closePath();
}

function setHint() {
  if (!image) { els.hint.hidden = true; return; }
  els.hint.hidden = false;
  els.hint.textContent = mode === "zone"
    ? "Entourez au doigt les tuyaux à compter, d'un seul trait. Le reste de la photo sera ignoré. Deux doigts pour zoomer ou déplacer."
    : mode === "calibrate"
      ? "Touchez un tuyau pour y placer le cercle, ajustez le diamètre au tuyau, puis « Compter »."
      : "Touchez un tuyau oublié pour l'ajouter, ou un repère erroné pour le retirer. Pincez pour zoomer.";
}

// ---------- Curseurs ----------
els.diam.addEventListener("input", () => { updateUI(); draw(); });
els.sens.addEventListener("input", () => { store.set("sensitivity", els.sens.value); updateUI(); });

function updateUI() {
  els.diamOut.textContent = `${els.diam.value} px`;
  els.sensOut.textContent = `${els.sens.value} %`;
  els.count.textContent = String(markers.length);
  els.badge.hidden = !hasCounted && markers.length === 0;
  els.btnUndo.disabled = undoStack.length === 0;
  els.btnZone.classList.toggle("has-zone", !!zone);
  els.btnZoneClear.disabled = !zone;
}

// ---------- Comptage hors ligne ----------
const worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
let jobId = 0;
const pending = new Map();
worker.onmessage = (e) => {
  const p = pending.get(e.data.id);
  if (!p) return;
  pending.delete(e.data.id);
  e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.circles);
};
worker.onerror = (e) => {
  for (const p of pending.values()) p.reject(new Error(e.message || "Erreur du module de détection."));
  pending.clear();
};

els.btnCount.addEventListener("click", countOffline);

async function countOffline() {
  if (!image) return;
  const r = Number(els.diam.value) / 2;
  // Toujours toute la photo : les seuils de détection dépendent de l'image analysée,
  // et un recadrage donnerait des résultats différents. La zone filtre ensuite.
  const rect = { x: 0, y: 0, w: image.width, h: image.height };
  let s = scaleFor(r);
  if (rect.w * rect.h * s * s > MAX_WORK_PIXELS) s = Math.sqrt(MAX_WORK_PIXELS / (rect.w * rect.h));
  const w = Math.max(1, Math.round(rect.w * s)), h = Math.max(1, Math.round(rect.h * s));
  showBusy("Comptage en cours…");
  try {
    const work = document.createElement("canvas");
    work.width = w; work.height = h;
    const wctx = work.getContext("2d", { willReadFrequently: true });
    wctx.imageSmoothingQuality = "high";
    wctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, w, h);
    const data = wctx.getImageData(0, 0, w, h);
    const id = ++jobId;
    const circles = await new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ id, buffer: data.data.buffer, width: w, height: h, radius: r * s, sensitivity: Number(els.sens.value) / 100 }, [data.data.buffer]);
    });
    pushUndo();
    markers = circles
      .map((c) => ({ x: rect.x + c.x / s, y: rect.y + c.y / s, r: c.r / s, src: "auto" }))
      .filter((m) => inZone(m));
    hasCounted = true;
    setMode("edit");
    updateUI();
    if (!markers.length) toast("Aucun tuyau trouvé. Vérifiez le diamètre ou augmentez la sensibilité.", true);
  } catch (err) {
    toast("Échec du comptage : " + (err.message || err), true);
  } finally {
    hideBusy();
  }
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
    const diam = Number(els.diam.value);
    const rect = analysisRect(diam);
    const k = Math.min(1, 1568 / Math.max(rect.w, rect.h));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(rect.w * k)); c.height = Math.max(1, Math.round(rect.h * k));
    const cctx = c.getContext("2d");
    cctx.fillStyle = "#808080";
    cctx.fillRect(0, 0, c.width, c.height);
    cctx.save();
    if (zone) {
      // hors de la zone : gris uni, pour que l'IA n'y compte rien
      tracePolygon(cctx, zone.map((p) => ({ x: (p.x - rect.x) * k, y: (p.y - rect.y) * k })));
      cctx.clip();
    }
    cctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, c.width, c.height);
    cctx.restore();
    const b64 = c.toDataURL("image/jpeg", 0.9).split(",")[1];
    const res = await countWithClaude(key, b64, c.width, c.height, hasCounted || mode === "calibrate" ? diam * k : null, !!zone);
    pushUndo();
    const r = diam / 2;
    markers = res.pipes
      .map((p) => ({ x: rect.x + p.x / k, y: rect.y + p.y / k, r, src: "ai" }))
      .filter((m) => m.x >= 0 && m.y >= 0 && m.x <= image.width && m.y <= image.height && inZone(m));
    hasCounted = true;
    setMode("edit");
    updateUI();
    let msg = `IA : ${markers.length} tuyaux repérés.`;
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

// ---------- Annulation ----------
els.btnUndo.addEventListener("click", () => {
  const prev = undoStack.pop();
  if (!prev) return;
  markers = prev.markers;
  hasCounted = prev.hasCounted;
  zone = prev.zone;
  updateUI();
  draw();
});

function pushUndo() {
  undoStack.push({ markers: markers.map((m) => ({ ...m })), hasCounted, zone });
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
    // point image sous le milieu initial
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
    // fin du pincement : on continue en déplacement, sans déclencher de "tap"
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

function onTap(p) {
  if (mode === "zone") return;
  const ix = (p.x - view.tx) / view.scale, iy = (p.y - view.ty) / view.scale;
  if (ix < 0 || iy < 0 || ix > image.width || iy > image.height) return;
  if (mode === "calibrate") {
    guide = { x: ix, y: iy };
    draw();
    return;
  }
  // repère touché ? -> suppression (le plus proche)
  let best = -1, bestD = Infinity;
  markers.forEach((m, i) => {
    const d = Math.hypot(m.x - ix, m.y - iy);
    if (d < Math.max(m.r, 10 / view.scale) && d < bestD) { best = i; bestD = d; }
  });
  pushUndo();
  if (best >= 0) markers.splice(best, 1);
  else markers.push({ x: ix, y: iy, r: Number(els.diam.value) / 2, src: "manual" });
  hasCounted = true;
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
    // assombrit l'extérieur de la zone
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

  for (const m of markers) {
    const color = COLORS[m.src] || COLORS.auto;
    ctx.beginPath();
    ctx.arc(m.x, m.y, m.r * 0.92, 0, Math.PI * 2);
    ctx.lineWidth = 2.5 * px;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m.x, m.y, Math.max(3 * px, Math.min(m.r * 0.18, 7 * px)), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  if (mode === "calibrate" && guide) {
    const r = Number(els.diam.value) / 2;
    ctx.beginPath();
    ctx.arc(guide.x, guide.y, r, 0, Math.PI * 2);
    ctx.lineWidth = 3 * px;
    ctx.strokeStyle = "#ffd23f";
    ctx.setLineDash([8 * px, 6 * px]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(guide.x - 6 * px, guide.y); ctx.lineTo(guide.x + 6 * px, guide.y);
    ctx.moveTo(guide.x, guide.y - 6 * px); ctx.lineTo(guide.x, guide.y + 6 * px);
    ctx.lineWidth = 2 * px;
    ctx.stroke();
  }
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
