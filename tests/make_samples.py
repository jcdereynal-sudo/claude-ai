"""Génère des images synthétiques de fagots de tuyaux (vue de face) pour tester le détecteur.
Usage : python3 tests/make_samples.py <dossier_sortie>
Chaque image produit <nom>.png et <nom>.json (nombre attendu, rayon)."""
import json, math, random, sys, os
from PIL import Image, ImageDraw, ImageFilter

def bundle(name, out, cols, rows, r, hollow=False, noise=12, jitter=0.0, seed=0, bg=(70, 80, 90), blur=1.0, drop=0, hard=False):
    random.seed(seed)
    gap = 2
    W = int(cols * (2 * r + gap) + 6 * r)
    H = int(rows * (2 * r + gap) * 0.87 + 6 * r)
    img = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(img)
    centers = []
    for j in range(rows):
        for i in range(cols):
            x = 3 * r + i * (2 * r + gap) + (r if j % 2 else 0)
            y = 3 * r + j * (2 * r + gap) * 0.87
            centers.append((x, y))
    random.shuffle(centers)
    centers = centers[drop:]
    for (x, y) in centers:
        rr = r * (1 + random.uniform(-jitter, jitter))
        shade = random.randint(150, 230)
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(shade, shade - 10, shade - 30), outline=(40, 40, 40), width=max(1, r // 8))
        if hollow:
            ri = rr * 0.72
            d.ellipse([x - ri, y - ri, x + ri, y + ri], fill=(25, 25, 30))
    if hard:
        # taches / rouille sur les tuyaux, lignes parasites, éclairage non uniforme
        for _ in range(len(centers) * 2):
            x, y = random.choice(centers)
            a = random.uniform(0, 6.28); dd = random.uniform(0, r * 0.8); s_ = random.uniform(1, r * 0.25)
            c = random.randint(60, 140)
            d.ellipse([x + dd * math.cos(a) - s_, y + dd * math.sin(a) - s_, x + dd * math.cos(a) + s_, y + dd * math.sin(a) + s_], fill=(c, c - 20, c - 40))
        for _ in range(25):
            d.line([random.randint(0, W), random.randint(0, H), random.randint(0, W), random.randint(0, H)], fill=(random.randint(0, 255),) * 3, width=random.randint(1, 3))
    img = img.filter(ImageFilter.GaussianBlur(blur))
    if hard:
        px = img.load()
        for yy in range(H):
            for xx in range(W):
                f = 0.45 + 0.75 * (xx / W) * (0.6 + 0.4 * yy / H)
                p = px[xx, yy]
                px[xx, yy] = tuple(int(min(255, c * f)) for c in p)
    px = img.load()
    for yy in range(H):
        for xx in range(W):
            n = random.randint(-noise, noise)
            p = px[xx, yy]
            px[xx, yy] = tuple(max(0, min(255, c + n)) for c in p)
    img.save(os.path.join(out, name + ".png"))
    json.dump({"expected": len(centers), "radius": r, "centers": centers}, open(os.path.join(out, name + ".json"), "w"))

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
bundle("plein_petit", out, 10, 8, 14, seed=1)
bundle("creux", out, 9, 7, 20, hollow=True, seed=2)
bundle("bruit_variation", out, 12, 10, 16, noise=30, jitter=0.08, seed=3, drop=7)
bundle("gros", out, 6, 5, 40, hollow=True, seed=4, blur=2)
bundle("dense", out, 20, 15, 10, seed=5, jitter=0.05)
bundle("difficile", out, 14, 11, 18, hollow=True, noise=25, jitter=0.1, seed=6, drop=12, hard=True)
bundle("difficile_plein", out, 12, 9, 22, noise=20, jitter=0.06, seed=7, drop=3, hard=True, blur=1.5)
print("ok")
