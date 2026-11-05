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

## Compte-Vis (vis et petites pièces)

Même principe pour **compter des vis** : **https://compte-tubes.netlify.app/vis/** (lien « Compter des vis → » sur l'écran d'accueil de Compte-Tubes). Application distincte, installable de la même façon.

1. **Étaler les vis** sur une seule couche, sans chevauchement, sur un fond uni et contrasté (table, carton, feuille). Photographier d'au-dessus, toutes les vis dans le cadre.
2. **Photo** : le comptage se lance tout seul, hors ligne. Un point vert par vis.
3. **Vis qui se touchent** : la taille d'une vis seule sert d'étalon ; une tache de deux ou trois vis collées compte pour deux ou trois. Si l'étalon automatique se trompe, touchez « Étalon » puis **une vis bien isolée**. La *Sensibilité* se règle au même endroit.
4. **Amas** (plus de 6 vis emmêlées, en orange) : nombre **estimé par la surface** (badge « ≈ »). Touchez l'amas pour saisir le nombre exact, ou étalez ces vis et reprenez une photo, ou touchez **IA**.
5. **Corriger**, **Zone**, **Annuler**, **IA** : comme dans Compte-Tubes. La clé API saisie dans l'une des deux applications sert aux deux. La zone retient les taches dont le centre est dans le tracé.

Couleurs : vert = détection, bleu = ajout ou nombre saisi à la main, violet = IA, orange = amas estimé.

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
- `app/vis/` : Compte-Vis (`screws.js` = détection des vis, même organisation que Compte-Tubes).

```bash
python3 tests/make_screw_samples.py /tmp/vis && node tests/screws.test.mjs /tmp/vis
```
