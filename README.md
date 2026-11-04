# Compte-Tubes

Application mobile (web app installable / PWA) pour **compter des tuyaux sur une photo** des extrémités d'un fagot, prise sur le moment ou choisie dans la galerie.

## Fonctionnement

1. **Photo** : « Prendre une photo » (appareil photo arrière) ou « Choisir dans les photos ».
2. **Zone** (facultatif) : si la photo contient d'autres tuyaux ou objets à ne pas compter, touchez « Zone » et entourez au doigt, d'un seul trait, les tuyaux à compter. L'extérieur est assombri et ignoré (comptage, ajouts de l'IA). « Effacer la zone » revient à toute la photo ; « Annuler » défait aussi un tracé.
3. **Diamètre** : touchez un tuyau pour y placer le cercle jaune, puis ajustez le curseur *Diamètre* pour qu'il épouse l'extrémité du tuyau. La *Sensibilité* règle la tolérance (plus haut = plus de détections, plus de risques d'erreur).
4. **Compter** : détection hors ligne, sur le téléphone. Le total s'affiche en haut.
5. **Corriger** : touchez un tuyau oublié pour l'ajouter (repère bleu), ou un repère erroné pour le retirer. Pincez pour zoomer, glissez pour vous déplacer. « Annuler » revient en arrière.
6. **IA** (option, en ligne) : envoie la photo à Claude (Anthropic) pour les photos difficiles. Il faut une clé API Anthropic, à saisir dans ⚙ (stockée uniquement sur le téléphone). Chaque analyse est facturée sur le compte Anthropic. Les repères de l'IA sont violets et se corrigent de la même façon.

Couleurs des repères : vert = détection automatique, bleu = ajout manuel, violet = IA.

### Conseils de prise de vue
- Photographier **de face**, perpendiculairement aux extrémités, avec tout le fagot dans le cadre.
- Éclairage homogène ; éviter les reflets forts et le contre-jour.
- Des tuyaux de diamètres très différents sur une même photo : compter en deux fois (un diamètre à la fois), ou corriger à la main.

## Installation sur le téléphone

L'application est publiée par Netlify : **https://compte-tubes.netlify.app** (republiée à chaque push sur la branche de production ; réglages dans `netlify.toml`).

Ouvrir l'adresse sur le téléphone, puis **Ajouter à l'écran d'accueil** (Chrome Android : menu ⋮ ; iPhone/Safari : bouton Partager). Après la première ouverture, le comptage fonctionne sans réseau.

Le workflow `.github/workflows/tests.yml` lance les tests du détecteur à chaque push et pull request.

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
