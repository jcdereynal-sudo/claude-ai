# Compte-Tubes

Application mobile (web app installable / PWA) pour **compter des tuyaux sur une photo** des extrémités d'un fagot, prise sur le moment ou choisie dans la galerie.

## Fonctionnement

1. **Photo** : « Prendre une photo » (appareil photo arrière) ou « Choisir dans les photos ».
2. **Diamètre** : touchez un tuyau pour y placer le cercle jaune, puis ajustez le curseur *Diamètre* pour qu'il épouse l'extrémité du tuyau. La *Sensibilité* règle la tolérance (plus haut = plus de détections, plus de risques d'erreur).
3. **Compter** : détection hors ligne, sur le téléphone. Le total s'affiche en haut.
4. **Corriger** : touchez un tuyau oublié pour l'ajouter (repère bleu), ou un repère erroné pour le retirer. Pincez pour zoomer, glissez pour vous déplacer. « Annuler » revient en arrière.
5. **IA** (option, en ligne) : envoie la photo à Claude (Anthropic) pour les photos difficiles. Il faut une clé API Anthropic, à saisir dans ⚙ (stockée uniquement sur le téléphone). Chaque analyse est facturée sur le compte Anthropic. Les repères de l'IA sont violets et se corrigent de la même façon.

Couleurs des repères : vert = détection automatique, bleu = ajout manuel, violet = IA.

### Conseils de prise de vue
- Photographier **de face**, perpendiculairement aux extrémités, avec tout le fagot dans le cadre.
- Éclairage homogène ; éviter les reflets forts et le contre-jour.
- Des tuyaux de diamètres très différents sur une même photo : compter en deux fois (un diamètre à la fois), ou corriger à la main.

## Installation sur le téléphone

L'application est servie par GitHub Pages (workflow `.github/workflows/pages.yml`) :
1. Dans le dépôt GitHub : **Settings → Pages → Source : GitHub Actions** (une seule fois).
2. Chaque push sur `main` lance les tests puis publie le dossier `app/`.
3. Ouvrir l'URL publiée sur le téléphone, puis **Ajouter à l'écran d'accueil** (Chrome Android : menu ⋮ ; iPhone/Safari : bouton Partager).

Après la première ouverture, le comptage fonctionne sans réseau.

## Développement

```bash
python3 -m http.server 8000 -d app       # puis http://localhost:8000
python3 tests/make_samples.py /tmp/samples && node tests/detector.test.mjs /tmp/samples
```

- `app/detector.js` : détection des cercles (transformée de Hough à rayon connu + vérification de la couverture angulaire), pur JavaScript, sans dépendance.
- `app/worker.js` : exécute la détection en arrière-plan.
- `app/app.js` : interface (photo, zoom, calibrage, corrections, annulation).
- `app/ai.js` : analyse IA via le SDK Anthropic, chargé à la demande.
- `app/sw.js` : cache hors ligne.
- `tests/` : images synthétiques de fagots et test de précision du détecteur.
