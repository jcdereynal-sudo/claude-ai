// Teste le détecteur de vis sur les images de tests/make_screw_samples.py.
// Usage : node tests/screws.test.mjs <dossier_images>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { detectPieces, estimateUnit, buildMarkers, total, WORK_SIDE } from "../app/vis/screws.js";

const dir = process.argv[2];
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".png"))) {
  const meta = JSON.parse(readFileSync(join(dir, f.replace(".png", ".json")), "utf8"));
  // décodage + mise à l'échelle comme dans l'application, via Python/PIL
  const raw = execFileSync("python3", ["-c",
    "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');m=int(sys.argv[2]);" +
    "s=min(1,m/max(im.size));im=im.resize((round(im.size[0]*s),round(im.size[1]*s)),Image.BILINEAR);" +
    "sys.stdout.buffer.write(im.size[0].to_bytes(4,'little')+im.size[1].to_bytes(4,'little')+im.tobytes())",
    join(dir, f), String(WORK_SIDE)], { maxBuffer: 1 << 28 });
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
  const rgba = new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4);
  const t0 = performance.now();
  const { comps } = detectPieces(rgba, w, h, { sensitivity: 0.5 });
  const found = total(buildMarkers(comps, estimateUnit(comps)));
  const ms = Math.round(performance.now() - t0);
  const err = Math.abs(found - meta.expected) / meta.expected;
  const ok = err <= 0.03;
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${f.padEnd(20)} attendu ${String(meta.expected).padStart(4)}  trouvé ${String(found).padStart(4)}  (${w}x${h}, ${ms} ms)`);
}
process.exit(failed ? 1 : 0);
