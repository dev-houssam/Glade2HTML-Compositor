# CompoGlueML v0.7 — ce qui change

Lancer comme avant : `python3 -m http.server 8000` puis http://localhost:8000/composer.html

## Corrigé
- **Plusieurs signaux sur un même widget** : seul le dernier était branché (ex. `activate` + `changed` d'un GtkEntry).
- **Entrée dans un champ** (`activate`) déclenche enfin le handler (touche Entrée).
- `Composer.openWindow(...)`, utilisé par tes exports, n'existait nulle part → ajouté (+ `closeWindow`, `toggleWindow`).
- **GtkNotebook** : onglets doublés ; onglets maintenant fonctionnels, y compris dans l'export.
- Radios exclusifs, états initiaux (case cochée, combo, texte) conservés à l'export (sérialisés par attribut).
- L'export reprenait le DOM vivant (donc ce que l'aperçu avait modifié) → il utilise le rendu d'origine.
- Taille redimensionnée appliquée à la fenêtre exportée.
- Un handler avec une erreur de syntaxe n'empêche plus les autres de fonctionner.

## Nouveau
- `cgml-runtime.js` : **un seul runtime** pour l'aperçu ▶ et l'export (ce qui marche en aperçu marche exporté).
- Objet `app` dans les handlers : `app.state`, `app.window()`, `app.widget()`, `app.openWindow()`, `app.on/emit`, `app.api.*`…
- `payload.$('id')` et `payload.window` : widget de la fenêtre qui a émis le signal (fini l'ambiguïté de `Composer.widget`).
- **📜 Script commun** (variables/fonctions partagées, `on_app_ready()`).
- **🔌 APIs** : intégrées (storage, ui, files, clipboard, util), HTTP local/externe (endpoints, auth, mock, test), fonctions JS.
- **🧾 Console** (handlers, appels API, erreurs), ↻ relance de l'aperçu, autocomplétion Ctrl+Espace.
- Fenêtres « masquées au démarrage » (🙈) + `app.openWindow('w2')`.
- Export **réouvrable** : le projet complet est embarqué dans le `.cgml.html` (📂 Ouvrir projet l'accepte).
- Brouillon automatique (localStorage) ; fenêtres déplaçables en option dans l'export.

Les anciens projets `.cgml.json` et les anciens handlers (`Composer.widget(...)`) restent compatibles.
Les anciens exports `.cgml.html` n'embarquent pas le projet : rouvre plutôt le `.cgml.json`.
