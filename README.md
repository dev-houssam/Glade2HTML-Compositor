# Glade2HTML-Compositor
Transformez vos fichiers Glade (GTK3) en applications web autonomes.


--- 
Documentation complète de CompoGlueML

# CompoGlueML

> Transformez vos fichiers **Glade** (GTK3) en applications web autonomes.

**CompoGlueML** est un outil qui convertit les fichiers `.glade` de GTK3 en HTML/CSS/JS. Il permet de :

- **Visualiser** n'importe quel fichier `.glade` directement dans un navigateur
- **Composer** plusieurs fenêtres Glade côte à côte dans un canevas
- **Écrire** des handlers JavaScript pour répondre aux signaux GTK (`clicked`, `changed`, `toggled`…)
- **Exporter** le tout en un seul fichier `.cgml.html` **autonome**, sans dépendance, prêt à déployer

---

## Table des matières

- [Démonstration](#démonstration)
- [Architecture](#architecture)
- [Installation](#installation)
- [Utilisation rapide](#utilisation-rapide)
- [Le compositeur en détail](#le-compositeur-en-détail)
- [Le format `.cgml.json`](#le-format-cgmljson)
- [Le format `.cgml.html`](#le-format-cgmlhtml)
- [API des handlers](#api-des-handlers)
- [Widgets GTK supportés](#widgets-gtk-supportés)
- [Structure du projet](#structure-du-projet)
- [Limitations connues](#limitations-connues)
- [Contribuer](#contribuer)
- Propriétaire - Utilisez et indiquez le nom de l'auteur (Houssam BACAR)

---

## Démonstration

### Trois usages

**1. L'outil de test** (`index.html`)
Chargez un `.glade`, voyez le rendu, inspectez les signaux détectés.

**2. Le compositeur** (`composer.html`)
Composez une application multi-fenêtres, écrivez les handlers, exportez.

**3. Le fichier exporté** (`*.cgml.html`)
Un HTML autonome qui reproduit l'application complète.

### Exemple — Pipeline de données

Deux fenêtres Glade :
- `acquisition.glade` — formulaire de saisie avec liste
- `traitement.glade` — sélection d'opération (somme, moyenne, min, max) et calcul

Une fois branchés, on peut :
1. Saisir `Ventes Q1 = 100`, `Ventes Q2 = 200`
2. Envoyer au traitement via un bouton
3. Calculer la somme `Σ = 300`, la moyenne `x̄ = 150`, etc.
4. Voir l'historique des opérations

Le tout fonctionne dans le compositeur ET dans le fichier exporté.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                     Fichier .glade (XML GTK3)                │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                       glade2html.js                          │
│  ─ Parse le XML                                              │
│  ─ Rend chaque widget GTK en HTML/CSS                        │
│  ─ Collecte les <signal> déclarés                            │
│  ─ Produit un document HTML autonome                         │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                      glade-viewer.js                         │
│  ─ mountInline(container, xml, options)                      │
│  ─ mountIframe(container, xml, options)                      │
│  ─ attach(container, handlers, options)                      │
└──────────────────────────┬───────────────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────────────┐
│                       composer.js                            │
│  ─ Canevas multi-fenêtres                                    │
│  ─ Inspecteur de signaux + éditeur CodeMirror                │
│  ─ Sauvegarde / chargement de projet (.cgml.json)            │
│  ─ Export (.cgml.html)                                       │
└──────────────────────────────────────────────────────────────┘
```

Trois couches indépendantes :
- **`glade2html.js`** — moteur pur, sans UI, réutilisable
- **`glade-viewer.js`** — glue pour intégrer dans une page
- **`composer.js`** — outil de composition basé sur les deux premiers

---

## Installation

Aucune dépendance à installer. C'est du HTML/CSS/JS pur.

### Récupérer le projet

```bash
git clone <votre-repo>
cd Glade2HTML
```

### Lancer un serveur local

Les navigateurs bloquent `fetch()` sur `file://`, il faut donc servir les fichiers.

```bash
# Python 3 (partout)
python3 -m http.server 8000

# ou Node.js
npx serve -l 8000

# ou PHP
php -S localhost:8000
```

Puis ouvrir :
- **Outil de test** : [http://localhost:8000/index.html](http://localhost:8000/index.html)
- **Compositeur** : [http://localhost:8000/composer.html](http://localhost:8000/composer.html)

### Dépendances externes

Le compositeur utilise **CodeMirror 5** chargé depuis un CDN :

```html
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.16/codemirror.min.js"></script>
```

Pour un usage **hors-ligne**, téléchargez ces fichiers et modifiez `composer.html`.

---

## Utilisation rapide

### 1. Convertir un `.glade` en HTML

```html
<script src="glade2html.js"></script>
<script>
  fetch('mon-interface.glade')
    .then(r => r.text())
    .then(xml => {
      const result = Glade2HTML.gladeToHtml(xml);
      console.log(result.signals);   // liste des signaux détectés
      document.getElementById('preview').innerHTML = result.html;
    });
</script>
```

### 2. Intégrer avec des handlers

```html
<script src="glade2html.js"></script>
<script src="glade-viewer.js"></script>
<script>
  const view = GladeViewer.mountInline(
    document.getElementById('host'),
    xml,
    {
      handlers: {
        on_save_clicked: () => alert('Sauvegardé !'),
        on_digit_7:      () => appendToDisplay('7')
      },
      onSignal: (name, payload) => console.log(name, payload)
    }
  );

  // Accès aux widgets
  view.getWidget('expr_entry').value = '42';
</script>
```

### 3. Composer plusieurs fenêtres

Ouvrez `composer.html` et suivez les étapes ci-dessous.

---

## Le compositeur en détail

### Interface

```
┌─────────────────────────────────────────────────────────────┐
│  Barre d'outils  [Ajouter] [Ouvrir] [Vider] [Tester] ...    │
├──────────────────────────────────────┬──────────────────────┤
│                                      │   Sidebar            │
│         CANEVAS (zone de pose)       │   ─ Projet           │
│                                      │   ─ Fenêtres         │
│   ┌─────────┐    ┌─────────┐         │                      │
│   │ Fenêtre │    │ Fenêtre │         │                      │
│   │   1     │    │   2     │         │                      │
│   └─────────┘    └─────────┘         │                      │
│                                      │                      │
├──────────────────────────────────────┴──────────────────────┤
│  INSPECTEUR                                                  │
│  ┌──────────┬────────────────────────────────────────────┐  │
│  │ Signaux  │  CodeMirror — édition du handler           │  │
│  │ ▸ sig1   │  function on_xxx(payload) {                │  │
│  │ ▸ sig2   │    // code                                 │  │
│  │ ▸ sig3   │  }                                         │  │
│  └──────────┴────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### Barre d'outils

| Bouton | Rôle |
|---|---|
| **➕ Ajouter un .glade** | Charge un ou plusieurs fichiers `.glade` |
| **📂 Ouvrir projet** | Charge un fichier `.cgml.json` (projet sauvegardé) |
| **🗑 Vider** | Efface toutes les fenêtres du canevas |
| **▶ Tester** | Active le mode prévisualisation (handlers branchés) |
| **💾 Projet** | Sauvegarde le projet complet en `.cgml.json` |
| **📤 Export HTML** | Génère un `.cgml.html` autonome |

### Manipulations sur le canevas

| Action | Comment |
|---|---|
| **Déplacer une fenêtre** | Glisser la barre de titre |
| **Redimensionner** | Tirer sur les bords ou les coins |
| **Sélectionner** | Cliquer sur la fenêtre |
| **Masquer la barre de titre** | Bouton 👁 sur la barre |
| **Afficher la barre** | Bouton 👁 flottant en haut à droite |
| **Fermer la fenêtre** | Bouton ✕ sur la barre |
| **Mettre au premier plan** | Cliquer sur la fenêtre |

### Inspecteur de signaux

Quand une fenêtre est sélectionnée, le panneau du bas affiche :

- **À gauche** : la liste des signaux déclarés dans le `.glade`
  - Nom du handler (ex: `on_save_clicked`)
  - Signal GTK (ex: `clicked`)
  - Widget source (ex: `#save_btn`)
  - Point orange ● si le handler a été modifié

- **À droite** : un éditeur CodeMirror avec le code du handler
  - **↺ Réinitialiser** : revient au squelette par défaut
  - **💾 Appliquer** : sauvegarde le code (ou `Ctrl+S`)

### Sidebar projet

Affiche en temps réel :

- **Nom**, Version, Auteur, Modifié
- **Fenêtres** (nombre), **Handlers** (nombre), **Signaux** (nombre)
- Bouton **✎ Modifier les infos** pour éditer les métadonnées

---

## Le format `.cgml.json`

Sauvegarde l'**état complet** du compositeur : fenêtres, positions, tailles, handlers, métadonnées.

```json
{
  "format": "CompoGlueML",
  "formatVersion": "1.0",
  "app": {
    "name": "Pipeline de données",
    "description": "Acquisition + traitement",
    "version": "0.1.0",
    "author": "Houssam",
    "createdAt": "2026-10-14T19:30:00.000Z",
    "updatedAt": "2026-10-14T19:35:00.000Z"
  },
  "stats": {
    "windowCount": 2,
    "handlerCount": 8,
    "signalCount": 12
  },
  "windows": [
    {
      "id": "w1",
      "name": "acquisition.glade",
      "x": 40,
      "y": 40,
      "z": 1,
      "width": 420,
      "height": 520,
      "titlebarVisible": true,
      "xml": "<?xml version=\"1.0\"?><interface>...</interface>",
      "handlers": {
        "on_acq_add_clicked": {
          "widgetId": "acq_add_btn",
          "gtkSignal": "clicked",
          "code": "function on_acq_add_clicked(payload) {\n  ...\n}",
          "modified": true
        }
      }
    }
  ]
}
```

### Champs

| Champ | Type | Description |
|---|---|---|
| `format` | string | Toujours `"CompoGlueML"` |
| `formatVersion` | string | Version du format (`"1.0"`) |
| `app.name` | string | Nom de l'application |
| `app.description` | string | Description longue |
| `app.version` | string | Version de l'app |
| `app.author` | string | Auteur |
| `app.createdAt` | ISO date | Date de création |
| `app.updatedAt` | ISO date | Dernière modification |
| `stats.*` | numbers | Statistiques calculées |
| `windows[]` | array | Liste des fenêtres |
| `windows[].xml` | string | XML source du `.glade` |
| `windows[].handlers` | object | Handlers indexés par nom |
| `windows[].titlebarVisible` | bool | Barre de titre affichée |
| `windows[].width/height` | number\|null | Taille personnalisée |

### Avantages

- **Diffable** (git-friendly)
- **Éditable à la main** si besoin
- **Extensible** (champs additionnels tolérés)
- **Portable** (indépendant du compositeur)

---

## Le format `.cgml.html`

Un fichier HTML **autonome** qui reproduit l'application complète.

### Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Nom de l'app</title>
  <style>
    /* CSS du canevas exporté (positions absolues) */
    /* CSS GTK Adwaita (rendu des widgets) */
  </style>
</head>
<body>
  <div id="cgml-stage">
    <div class="cgml-window" data-window-id="w1" data-glade-name="acquisition.glade"
         style="left:40px; top:40px; z-index:1; width:420px; height:520px">
      <!-- HTML rendu du .glade -->
    </div>
    <div class="cgml-window" ...>
      <!-- ... -->
    </div>
  </div>

  <script>
    /* 1. Helper de branchement */
    window.__cgmlAttach = function(root, handlers, options) { ... };

    /* 2. Handlers extraits du compositeur */
    var handlers = {
      on_acq_add_clicked: (function(){
        function on_acq_add_clicked(payload) { ... }
        return on_acq_add_clicked;
      })()
    };

    /* 3. Runtime : shim Composer + branchement */
    (function(){
      window.Composer = { /* API */ };
      document.querySelectorAll('.cgml-window').forEach(el => {
        window.__cgmlAttach(el, handlers, {});
      });
    })();
  </script>
</body>
</html>
```

### Utilisation

1. Généré par le bouton **📤 Export HTML** du compositeur
2. Téléchargeable et déployable partout
3. Ne dépend d'aucun fichier externe
4. Fonctionne en `file://` (double-clic)

### Déploiement

```bash
# Serveur statique
cp mon-app.cgml.html /var/www/html/

# GitHub Pages
git add mon-app.cgml.html && git commit -m "Release" && git push

# Electron / Tauri
# → utiliser comme point d'entrée de l'app
```

---

## API des handlers

Chaque handler reçoit un objet `payload` :

```javascript
function on_xxx(payload) {
  payload.widgetId;     // id Glade du widget source (ex: "save_btn")
  payload.gtkSignal;    // nom du signal GTK (ex: "clicked")
  payload.value;        // valeur (input value, checkbox checked…)
  payload.element;      // élément DOM source
  payload.nativeEvent;  // événement DOM natif
}
```

### Accéder aux widgets

Trois API disponibles, identiques en **mode compositeur** et en **mode exporté** :

```javascript
// 1. Chercher dans la fenêtre courante (celle du dernier clic)
Composer.widget('new_task_entry');

// 2. Chercher dans une fenêtre précise par nom de fichier
Composer.widgetIn('traitement.glade', 'trt_data_list');

// 3. Récupérer tous les widgets d'une fenêtre
const widgets = Composer.widgetsIn('traitement.glade');
widgets.trt_data_list;   // élément DOM
```

### Modifier le statut

```javascript
// Compositeur : met à jour la barre de statut
// Export : met à jour le titre de l'onglet
Composer.setStatus('Traitement en cours…');
```

### Exemples complets

**Ajouter un élément à une liste**

```javascript
function on_add_clicked(payload) {
  const input = Composer.widget('task_input');
  const list  = Composer.widget('task_list');
  if (!input || !list) return;

  const title = input.value.trim();
  if (!title) return;

  const row = document.createElement('div');
  row.textContent = title;
  list.appendChild(row);
  input.value = '';
}
```

**Communication entre fenêtres**

```javascript
function on_send_clicked(payload) {
  const sourceList = Composer.widget('source_list');
  const destList   = Composer.widgetIn('traitement.glade', 'dest_list');
  if (!sourceList || !destList) return;

  destList.innerHTML = '';
  Array.from(sourceList.children).forEach(row => {
    const copy = row.cloneNode(true);
    destList.appendChild(copy);
  });
}
```

**Lire un radio coché**

```javascript
function on_exec_clicked(payload) {
  let op = 'sum';
  ['op_sum', 'op_avg', 'op_min', 'op_max'].forEach(id => {
    const wrap = Composer.widget(id);
    if (!wrap) return;
    const input = wrap.querySelector('input[type="radio"]');
    if (input && input.checked) op = id.replace('op_', '');
  });
  console.log('Opération :', op);
}
```

---

## Widgets GTK supportés

| Classe GTK | Rendu HTML | Statut |
|---|---|---|
| `GtkWindow` | `<div class="gtk-window">` | ✅ |
| `GtkBox` | `<div class="gtk-box">` | ✅ |
| `GtkGrid` | `<div class="gtk-grid">` (CSS grid) | ✅ |
| `GtkFrame` | `<fieldset>` + `<legend>` | ✅ |
| `GtkScrolledWindow` | `<div class="gtk-scrolled">` | ✅ |
| `GtkNotebook` | Onglets + panneaux | ✅ |
| `GtkExpander` | `<details>` + `<summary>` | ✅ |
| `GtkEventBox` | `<div>` | ✅ |
| `GtkButton` | `<button>` | ✅ |
| `GtkToggleButton` | `<button class="gtk-toggle">` | ✅ |
| `GtkCheckButton` | `<input type="checkbox">` | ✅ |
| `GtkRadioButton` | `<input type="radio">` (groupé) | ✅ |
| `GtkSwitch` | `<input type="checkbox">` stylé | ✅ |
| `GtkLabel` | `<span class="gtk-label">` | ✅ |
| `GtkEntry` | `<input type="text">` | ✅ |
| `GtkTextView` | `<textarea>` | ✅ |
| `GtkComboBoxText` | `<select>` stylé | ✅ |
| `GtkComboBox` | `<select>` stylé | ✅ |
| `GtkProgressBar` | `<div class="gtk-progress">` | ✅ |
| `GtkSeparator` | `<div class="gtk-separator">` | ✅ |
| `GtkImage` | `<img>` ou texte | ✅ |
| `GtkLinkButton` | `<a>` | ✅ |
| `GtkMenuButton` | `<button>` | ✅ |
| `GtkSpinner` | `<div class="gtk-spinner">` | ✅ (statique) |

**Non supportés** : `GtkTreeView`, `GtkMenuBar`, `GtkToolbar`, `GtkPaned`, `GtkCalendar`, `GtkDrawingArea`, `GtkGLArea`. Le moteur affiche un **fallback** : `⚠ GtkXxx` + rendu des enfants.

### Ajouter un widget

```javascript
Glade2HTML.registerRenderer('GtkCalendar', function(node, ctx) {
  const div = document.createElement('div');
  div.className = 'gtk-calendar';
  // ... construire le HTML
  return div;
});
```

---

## Structure du projet

```
Glade2HTML/
├── README.md                    ← ce fichier
│
├── glade2html.js                ← moteur de rendu (indépendant)
├── glade-viewer.js              ← couche d'intégration
├── composer.js                  ← logique du compositeur
│
├── index.html                   ← outil de test simple
├── composer.html                ← interface du compositeur
│
├── composer.css                 ← styles du compositeur
│
├── app.js                       ← JS de index.html
│
├── demo-embed.html              ← démo d'intégration dans une page hôte
├── demo-todo.html               ← démo "gestionnaire de tâches"
├── demo-actions.html            ← démo "calculatrice"
│
├── examples/
│   ├── acquisition.glade        ← formulaire de saisie
│   ├── traitement.glade         ← sélection d'opérations
│   ├── todo.glade               ← gestionnaire de tâches
│   └── clavier_azerty.glade     ← clavier virtuel
│
└── exports/                     ← fichiers .cgml.html générés (gitignore)
```

### Rôle des fichiers

| Fichier | Rôle |
|---|---|
| `glade2html.js` | Cœur du moteur — transforme XML → HTML autonome |
| `glade-viewer.js` | Couche glue — monte le rendu dans une page |
| `composer.js` | Logique du compositeur — canevas, inspecteur, export |
| `composer.html` | Interface du compositeur |
| `composer.css` | Feuille de style du compositeur |
| `index.html` | Outil de test minimaliste |
| `demo-*.html` | Exemples d'intégration |

---

## Limitations connues

### Rendu

- **Widgets complexes non supportés** : `GtkTreeView`, `GtkMenuBar`, `GtkToolbar`, `GtkPaned`, `GtkCalendar` (fallback avec `⚠`).
- **Icônes Adwaita** : les `GtkImage` avec `icon-name` affichent le nom en texte, pas l'icône.
- **Attributs Pango** : seuls `scale` et `weight` sont interprétés.

### Interaction

- **Pas de drag & drop GTK** entre listes.
- **Pas de tooltips GTK** (`tooltip-text` ignoré).
- **Pas de mnemonics** (`_Fichier` → `Fichier`, sans la touche Alt).
- **Pas de focus tabulation** entre widgets.

### Export

- **Le fichier exporté n'est pas réimportable** dans le compositeur (utilisez `.cgml.json` pour ça).
- **Pas de compression** : les gros projets génèrent des `.cgml.html` volumineux.
- **CodeMirror n'est pas embarqué** dans l'export (pas nécessaire : pas d'édition).

### Sécurité

- **Les handlers sont exécutés en `eval`** dans le compositeur (via `new Function`).
- **N'exécutez que du code que vous avez écrit**. Ne chargez jamais un `.cgml.json` provenant d'une source non fiable.

---

## Contribuer

### Signaler un bug

Ouvrez une *issue* avec :
- Le fichier `.glade` en pièce jointe
- La capture d'écran du rendu attendu (Glade)
- La capture d'écran du rendu obtenu (CompoGlueML)
- La console du navigateur (F12)

### Ajouter un widget

1. Ajouter le renderer dans `RENDERERS` (`glade2html.js`)
2. Ajouter le CSS correspondant dans `GTK_CSS`
3. Ajouter le widget à la liste « Widgets GTK supportés » du `README.md`
4. Tester avec un `.glade` minimal

### Proposer une fonctionnalité

Ouvrez une *issue* décrivant :
- Le cas d'usage
- Le comportement attendu
- Éventuellement un mockup



