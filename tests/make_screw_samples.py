"""Génère des images synthétiques de vis étalées sur un fond bois pour tester le détecteur de vis.
Usage : python3 tests/make_screw_samples.py <dossier_sortie>
Chaque image produit <nom>.png et <nom>.json (nombre attendu)."""
import json, math, random, sys, os
from PIL import Image, ImageDraw, ImageFilter


def wood(W, H, base, grain, light):
    img = Image.new("RGB", (W, H), base)
    d = ImageDraw.Draw(img)
    for _ in range(int(H / 3)):
        y = random.uniform(0, H)
        c = tuple(max(0, min(255, b + random.randint(-grain, grain // 3))) for b in base)
        d.line([(0, y), (W, y + random.uniform(-40, 40))], fill=c, width=random.randint(1, 3))
    img = img.filter(ImageFilter.GaussianBlur(1.2))
    if light:
        px = img.load()
        for yy in range(H):
            for xx in range(W):
                f = 0.75 + 0.4 * (xx / W) * (0.5 + 0.5 * yy / H)
                p = px[xx, yy]
                px[xx, yy] = tuple(int(min(255, c * f)) for c in p)
    return img


def screw(d, sh, x, y, ang, L, Wd):
    """Vis : tige filetée + tête à collerette ; ombre portée sur le calque sh."""
    ux, uy = math.cos(ang), math.sin(ang)
    vx, vy = -uy, ux

    def poly(t0, t1, half, layer, fill, off=(0, 0)):
        pts = [(x + ux * t + vx * s + off[0], y + uy * t + vy * s + off[1]) for t, s in ((t0, -half), (t1, -half), (t1, half), (t0, half))]
        layer.polygon(pts, fill=fill)

    poly(-L / 2, L / 2, Wd / 2, sh, 0, off=(Wd * 0.4, Wd * 0.4))           # ombre
    g = random.randint(150, 205)
    body = (g - 10, g, g + 15)
    poly(-L / 2 + Wd, L / 2 - Wd * 1.5, Wd / 2, d, body)                     # tige
    tip = [(x + ux * (L / 2 - Wd * 1.5) + vx * Wd / 2, y + uy * (L / 2 - Wd * 1.5) + vy * Wd / 2),
           (x + ux * L / 2, y + uy * L / 2),
           (x + ux * (L / 2 - Wd * 1.5) - vx * Wd / 2, y + uy * (L / 2 - Wd * 1.5) - vy * Wd / 2)]
    d.polygon(tip, fill=body)                                                # pointe
    poly(-L / 2, -L / 2 + Wd, Wd * 0.75, d, (g + 20, g + 28, g + 40))        # tête / collerette
    # filetage : traits sombres réguliers
    t = -L / 2 + Wd * 1.3
    while t < L / 2 - Wd * 1.5:
        a = (x + ux * t + vx * Wd / 2, y + uy * t + vy * Wd / 2)
        b = (x + ux * (t + Wd * 0.25) - vx * Wd / 2, y + uy * (t + Wd * 0.25) - vy * Wd / 2)
        d.line([a, b], fill=(g - 70, g - 62, g - 50), width=max(1, int(Wd / 6)))
        t += Wd * 0.5
    # reflet
    d.line([(x - ux * L * 0.35 + vx * Wd * 0.15, y - uy * L * 0.35 + vy * Wd * 0.15),
            (x + ux * L * 0.3 + vx * Wd * 0.15, y + uy * L * 0.3 + vy * Wd * 0.15)], fill=(235, 240, 248), width=max(1, int(Wd / 5)))


def sample(name, out, n, W=1600, H=1200, L=150, Wd=14, touching=0, seed=0, base=(205, 172, 128), light=False, noise=10, varlen=0.0):
    random.seed(seed)
    img = wood(W, H, base, 26, light)
    shadow = Image.new("L", (W, H), 255)
    sh = ImageDraw.Draw(shadow)
    top = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(top)
    placed = []  # (x, y, rayon d'encombrement)
    count = 0
    tries = 0
    while count < n and tries < 20000:
        tries += 1
        LL = L * (1 + random.uniform(-varlen, varlen))
        x, y = random.uniform(LL / 2 + 10, W - LL / 2 - 10), random.uniform(LL / 2 + 10, H - LL / 2 - 10)
        pair = count < touching * 2 and count + 2 <= n
        rad = LL / 2 + Wd * (2.5 if pair else 1.2)
        if any(math.hypot(x - px, y - py) < rad + pr for px, py, pr in placed):
            continue
        ang = random.uniform(0, math.pi)
        if pair:
            # deux vis côte à côte, qui se touchent
            vx, vy = -math.sin(ang), math.cos(ang)
            screw(d, sh, x - vx * Wd * 0.48, y - vy * Wd * 0.48, ang, LL, Wd)
            screw(d, sh, x + vx * Wd * 0.48, y + vy * Wd * 0.48, ang + random.choice([0, math.pi]), LL, Wd)
            count += 2
        else:
            screw(d, sh, x, y, ang, LL, Wd)
            count += 1
        placed.append((x, y, rad))
    shadow = shadow.filter(ImageFilter.GaussianBlur(Wd * 0.4))
    dark = Image.new("RGB", (W, H), tuple(int(c * 0.72) for c in base))
    img = Image.composite(img, dark, shadow)
    img.paste(top, (0, 0), top)
    img = img.filter(ImageFilter.GaussianBlur(0.8))
    px = img.load()
    for yy in range(H):
        for xx in range(W):
            e = random.randint(-noise, noise)
            p = px[xx, yy]
            px[xx, yy] = tuple(max(0, min(255, c + e)) for c in p)
    img.save(os.path.join(out, name + ".png"))
    json.dump({"expected": count}, open(os.path.join(out, name + ".json"), "w"))


out = sys.argv[1]
os.makedirs(out, exist_ok=True)
sample("etalees_40", out, 40, seed=1)
sample("etalees_100", out, 100, L=110, Wd=11, seed=2, varlen=0.05)
sample("paires", out, 60, L=120, Wd=12, touching=10, seed=3)
sample("eclairage", out, 70, L=120, Wd=12, seed=4, light=True, noise=18)
sample("fond_clair", out, 50, seed=5, base=(225, 215, 195))
sample("petites", out, 150, W=1800, H=1300, L=70, Wd=9, seed=6)
print("ok")
