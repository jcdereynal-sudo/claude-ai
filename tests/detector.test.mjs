// Teste le détecteur sur les images de tests/make_samples.py.
// Usage : node tests/detector.test.mjs <dossier_images>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { detectCircles, scaleFor } from "../app/detector.js";

const dir = process.argv[2];
let failed = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".png"))) {
  const meta = JSON.parse(readFileSync(join(dir, f.replace(".png", ".json")), "utf8"));
  // décodage PNG -> RGBA brut via Python/PIL (évite une dépendance npm)
  const raw = execFileSync("python3", ["-c",
    "import sys;from PIL import Image;im=Image.open(sys.argv[1]).convert('RGBA');s=float(sys.argv[2]);" +
    "im=im.resize((round(im.size[0]*s),round(im.size[1]*s)),Image.BILINEAR);" +
    "sys.stdout.buffer.write(im.size[0].to_bytes(4,'little')+im.size[1].to_bytes(4,'little')+im.tobytes())",
    join(dir, f), String(scaleFor(meta.radius))], { maxBuffer: 1 << 28 });
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
  const rgba = new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4);
  const t0 = performance.now();
  const found = detectCircles(rgba, w, h, { radius: meta.radius * scaleFor(meta.radius), sensitivity: 0.5 });
  const ms = Math.round(performance.now() - t0);
  const err = Math.abs(found.length - meta.expected) / meta.expected;
  const ok = err <= 0.03;
  if (!ok) failed++;
  console.log(`${ok ? "OK  " : "FAIL"} ${f.padEnd(24)} attendu ${String(meta.expected).padStart(4)}  trouvé ${String(found.length).padStart(4)}  (${w}x${h}, ${ms} ms)`);
}
process.exit(failed ? 1 : 0);
