/* =====================================================================
 * composer.js — logique du compositeur CompoGlueML
 * Version 0.7.0 — runtime partagé, APIs, script commun, console, export réouvrable
 * ===================================================================== */
(function () {
  'use strict';

  const FORMAT_NAME = 'CompoGlueML';
  const FORMAT_VERSION = '1.1';

  /* ------------------------------------------------------------------
   * État
   * ------------------------------------------------------------------ */
  const state = {
    windows: [],
    nextId: 1,
    nextZ: 1,
    selectedId: null,
    selectedSignal: null,
    previewMode: false,
    app: {
      name: 'Sans titre',
      description: '',
      version: '0.1.0',
      author: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  };

  let activeEditor = null;

  /* ------------------------------------------------------------------
   * DOM
   * ------------------------------------------------------------------ */
  const fileInput       = document.getElementById('file-input');
  const projectInput    = document.getElementById('project-input');
  const stage           = document.getElementById('stage');
  const hintEl          = document.getElementById('stage-hint');
  const statusEl        = document.getElementById('status');
  const listEl          = document.getElementById('window-list');
  const btnClear        = document.getElementById('btn-clear');
  const btnExport       = document.getElementById('btn-export');
  const btnPreview      = document.getElementById('btn-preview');
  const btnSaveProject  = document.getElementById('btn-save-project');
  const btnEditInfo     = document.getElementById('btn-edit-info');
  const btnReload       = document.getElementById('btn-reload');

  const inspWinId       = document.getElementById('inspector-window-id');
  const inspWinName     = document.getElementById('inspector-window-name');
  const inspSignalCount = document.getElementById('inspector-signal-count');
  const inspClose       = document.getElementById('inspector-close');
  const signalsListEl   = document.getElementById('signals-list');
  const inspector       = document.getElementById('inspector');

  const infoName    = document.getElementById('info-name');
  const infoVersion = document.getElementById('info-version');
  const infoAuthor  = document.getElementById('info-author');
  const infoUpdated = document.getElementById('info-updated');
  const infoWC      = document.getElementById('info-wc');
  const infoHC      = document.getElementById('info-hc');
  const infoSC      = document.getElementById('info-sc');

  const modalOverlay   = document.getElementById('modal-overlay');
  const modalClose     = document.getElementById('modal-close');
  const modalCancel    = document.getElementById('modal-cancel');
  const modalSave      = document.getElementById('modal-save');
  const metaName       = document.getElementById('meta-name');
  const metaDescription= document.getElementById('meta-description');
  const metaVersion    = document.getElementById('meta-version');
  const metaAuthor     = document.getElementById('meta-author');
  const metaDraggable  = document.getElementById('meta-draggable');

  /* ------------------------------------------------------------------
   * Utilitaires
   * ------------------------------------------------------------------ */
  function setStatus(txt) { statusEl.textContent = txt; }
  function updateHintVisibility() {
    hintEl.style.display = state.windows.length === 0 ? 'block' : 'none';
  }
  function updateExportButton() {
    btnExport.disabled = state.windows.length === 0;
  }
  function touchUpdated() {
    state.app.updatedAt = new Date().toISOString();
    scheduleDraft();
  }

  function updateInfoPanel() {
    infoName.textContent    = state.app.name || '—';
    infoVersion.textContent = state.app.version || '—';
    infoAuthor.textContent  = state.app.author || '—';
    infoUpdated.textContent = state.app.updatedAt
      ? new Date(state.app.updatedAt).toLocaleString('fr-FR')
      : '—';

    infoWC.textContent = state.windows.length;

    const seen = {};
    let hCount = 0;
    let sCount = 0;
    for (const win of state.windows) {
      sCount += win.signals.length;
      for (const name in win.handlers) {
        if (seen[name]) continue;
        seen[name] = true;
        hCount++;
      }
    }
    infoHC.textContent = hCount;
    infoSC.textContent = sCount;
  }

  /* ------------------------------------------------------------------
   * Ajout d'une fenêtre
   * ------------------------------------------------------------------ */
  /* ------------------------------------------------------------------
   * Constantes du projet (script commun, APIs, brouillon)
   * ------------------------------------------------------------------ */
  const DRAFT_KEY = 'cgml-composer-draft-v1';
  const DEFAULT_SHARED = [
    '// Script commun — exécuté UNE fois au démarrage, avant le premier signal.',
    '// Déclarez ici les variables et fonctions partagées par tous les handlers.',
    '// `app` est disponible partout (app.state, app.api, app.window(…), app.openWindow(…)).',
    '',
    'function on_app_ready() {',
    '  // Appelée quand toutes les fenêtres sont montées.',
    '}'
  ].join('\n');

  state.shared = DEFAULT_SHARED;
  state.apis = [];
  state.settings = { draggable: false };

  /* ------------------------------------------------------------------
   * Console du compositeur
   * ------------------------------------------------------------------ */
  const consoleEl    = document.getElementById('console');
  const consoleBody  = document.getElementById('console-body');
  const btnConsole   = document.getElementById('btn-console');

  function openConsole()  { consoleEl.classList.remove('hidden'); btnConsole.classList.add('active'); }
  function closeConsole() { consoleEl.classList.add('hidden'); btnConsole.classList.remove('active'); }

  function clog(level, text) {
    const line = document.createElement('div');
    line.className = 'cl cl-' + level;
    const t = new Date().toLocaleTimeString('fr-FR');
    line.textContent = '[' + t + '] ' + text;
    consoleBody.appendChild(line);
    while (consoleBody.childNodes.length > 400) consoleBody.removeChild(consoleBody.firstChild);
    consoleBody.scrollTop = consoleBody.scrollHeight;
    if (level === 'error') openConsole();
  }

  btnConsole.addEventListener('click', function () {
    if (consoleEl.classList.contains('hidden')) openConsole(); else closeConsole();
  });
  document.getElementById('console-clear').addEventListener('click', function () { consoleBody.innerHTML = ''; });
  document.getElementById('console-close').addEventListener('click', closeConsole);

  /* ------------------------------------------------------------------
   * Brouillon automatique (localStorage)
   * ------------------------------------------------------------------ */
  let draftTimer = null;
  function scheduleDraft() {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(function () {
      try {
        if (!state.windows.length) return;
        localStorage.setItem(DRAFT_KEY, JSON.stringify(serializeProject()));
      } catch (e) { /* quota / mode privé : on ignore */ }
    }, 700);
  }

  /* ------------------------------------------------------------------
   * Éditeur de code (CodeMirror si disponible, sinon <textarea>)
   * ------------------------------------------------------------------ */
  function apiNames() {
    const names = Object.keys(CGML.builtinDoc);
    state.apis.forEach(function (a) { if (a.name && names.indexOf(a.name) < 0) names.push(a.name); });
    return names;
  }
  function apiMethods(name) {
    if (CGML.builtinDoc[name]) return CGML.builtinDoc[name].map(function (m) { return m.replace(/\(.*$/, '('); });
    const cfg = state.apis.find(function (a) { return a.name === name; });
    if (!cfg) return [];
    if (cfg.kind === 'js') {
      const out = [];
      String(cfg.code || '').replace(/(?:^|[\n,{])\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*(?:\(|:)/g, function (m, n) { out.push(n + '('); });
      return out;
    }
    return ['request('].concat((cfg.endpoints || []).filter(function (e) { return e.name; }).map(function (e) { return e.name + '('; }));
  }

  function codeHint(cm) {
    const cur = cm.getCursor();
    const before = cm.getLine(cur.line).slice(0, cur.ch);
    const m = /([\w$.]*)$/.exec(before);
    const chain = m ? m[1] : '';
    const parts = chain.split('.');
    const prefix = parts.pop();
    const path = parts.join('.');
    let list = [];
    if (path === 'app') {
      list = ['api', 'state', 'windows', 'window(', 'widget(', 'openWindow(', 'closeWindow(', 'toggleWindow(',
              'on(', 'off(', 'emit(', 'call(', 'status(', 'toast(', 'log(', 'warn(', 'error(', 'addStyle(', 'meta'];
    } else if (path === 'app.api') {
      list = apiNames();
    } else if (path.indexOf('app.api.') === 0) {
      list = apiMethods(path.slice(8));
    } else if (path === 'payload') {
      list = ['handler', 'widgetId', 'gtkSignal', 'value', 'element', 'nativeEvent', 'window', 'app', '$('];
    } else if (/(^|\.)window$/.test(path) || /^app\.window\(.*\)$/.test(path)) {
      list = ['id', 'name', 'el', 'root', '$(', 'get(', 'set(', 'text(', 'enable(', 'widgets(', 'show()', 'hide()', 'toggle()', 'front()', 'moveTo(', 'isVisible()'];
    }
    return {
      list: list.filter(function (s) { return s.indexOf(prefix) === 0; }),
      from: CodeMirror.Pos(cur.line, cur.ch - prefix.length),
      to: cur
    };
  }

  /**
   * Crée un éditeur dans `parent`. Retourne { getValue, setValue, refresh, focus, destroy }.
   */
  function makeEditor(parent, value, onChange, extra) {
    extra = extra || {};
    if (window.CodeMirror) {
      const cm = CodeMirror(parent, {
        value: value || '',
        mode: extra.mode || 'javascript',
        theme: 'dracula',
        lineNumbers: true,
        autoCloseBrackets: true,
        matchBrackets: true,
        indentUnit: 2,
        tabSize: 2,
        lineWrapping: true,
        extraKeys: Object.assign({
          'Ctrl-Space': function (c) { if (c.showHint) c.showHint({ hint: codeHint, completeSingle: false }); },
          'Tab': function (c) { c.execCommand('insertSoftTab'); }
        }, extra.keys || {})
      });
      cm.on('inputRead', function (c, ch) {
        if (ch.text && ch.text[0] === '.' && c.showHint) c.showHint({ hint: codeHint, completeSingle: false });
      });
      cm.on('change', function () { if (onChange) onChange(cm.getValue()); });
      return {
        getValue: function () { return cm.getValue(); },
        setValue: function (v) { cm.setValue(v); },
        refresh: function () { cm.refresh(); },
        focus: function () { cm.focus(); },
        destroy: function () { const w = cm.getWrapperElement(); if (w && w.parentNode) w.parentNode.removeChild(w); }
      };
    }
    const ta = document.createElement('textarea');
    ta.className = 'fallback-editor';
    ta.spellcheck = false;
    ta.value = value || '';
    ta.addEventListener('input', function () { if (onChange) onChange(ta.value); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = ta.selectionStart;
        ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(ta.selectionEnd);
        ta.selectionStart = ta.selectionEnd = s + 2;
        ta.dispatchEvent(new Event('input'));
      }
    });
    parent.appendChild(ta);
    return {
      getValue: function () { return ta.value; },
      setValue: function (v) { ta.value = v; ta.dispatchEvent(new Event('input')); },
      refresh: function () {},
      focus: function () { ta.focus(); },
      destroy: function () { if (ta.parentNode) ta.parentNode.removeChild(ta); }
    };
  }

  /** Vérifie la syntaxe + la présence de la fonction attendue. Retourne un message ou ''. */
  function lintHandler(code, name) {
    try { new Function('app', 'Composer', code); }
    catch (e) { return '⚠ Syntaxe : ' + e.message; }
    if (name) {
      const re = new RegExp('(function\\s*\\*?\\s+' + name.replace(/\$/g, '\\$') + '\\s*\\(|(const|let|var)\\s+' + name.replace(/\$/g, '\\$') + '\\s*=)');
      if (!re.test(code)) return '⚠ Le code doit définir une fonction nommée « ' + name + ' » (sinon elle ne sera pas appelée).';
    }
    return '';
  }

  /** Un handler est « implémenté » s'il diffère du squelette généré. */
  function isImplemented(win, name) {
    const h = win.handlers[name];
    if (!h || !h.code) return false;
    const sig = win.signals.find(function (s) { return s.handlerName === name; }) || { handlerName: name, widgetId: h.widgetId, gtkSignal: h.gtkSignal };
    if (h.code.trim() === buildSkeleton(sig).trim()) return false;
    const stripped = h.code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    return !/^\s*(async\s+)?function\s+[\w$]+\s*\([^)]*\)\s*\{\s*\}\s*$/.test(stripped);
  }

  /** Fusionne les handlers de toutes les fenêtres (la 1re fenêtre l'emporte en cas de doublon). */
  function collectHandlers() {
    const out = {};
    const conflicts = [];
    state.windows.forEach(function (win) {
      Object.keys(win.handlers).forEach(function (name) {
        if (!isImplemented(win, name)) return;
        const code = win.handlers[name].code;
        if (out[name] === undefined) out[name] = code;
        else if (out[name] !== code && conflicts.indexOf(name) < 0) conflicts.push(name);
      });
    });
    return { handlers: out, conflicts: conflicts };
  }

  function addWindow(name, xml, options) {
    options = options || {};
    const id = options.id || ('w' + state.nextId++);
    if (options.id) {
      const num = parseInt(id.replace('w', ''), 10);
      if (!isNaN(num) && num >= state.nextId) state.nextId = num + 1;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'comp-window';
    wrapper.dataset.windowId = id;
    wrapper.dataset.gladeName = name;

    const offset = (state.windows.length % 8) * 30;
    const x = options.x != null ? options.x : 40 + offset;
    const y = options.y != null ? options.y : 40 + offset;
    wrapper.style.left = x + 'px';
    wrapper.style.top  = y + 'px';

    stage.appendChild(wrapper);

    let view, gladeResult;
    try {
      gladeResult = Glade2HTML.gladeToHtml(xml);
      view = GladeViewer.mountInline(wrapper, xml);
    } catch (e) {
      wrapper.remove();
      console.error(e);
      setStatus('❌ ' + e.message);
      clog('error', 'Import de « ' + name + ' » impossible : ' + e.message);
      return;
    }

    const win = {
      id: id,
      name: name,
      xml: xml,
      html: gladeResult.fragment,          // rendu « d'origine », jamais modifié par l'aperçu
      x: x, y: y,
      z: options.z != null ? options.z : state.nextZ++,
      titlebarVisible: options.titlebarVisible !== false,
      hidden: !!options.hidden,
      width: options.width || null,
      height: options.height || null,
      el: wrapper,
      view: view,
      signals: gladeResult.signals || [],
      handlers: {}
    };

    if (options.z != null && options.z >= state.nextZ) state.nextZ = options.z + 1;

    if (options.handlers) {
      for (const hName in options.handlers) {
        const h = options.handlers[hName];
        win.handlers[hName] = {
          widgetId: h.widgetId || '',
          gtkSignal: h.gtkSignal || 'clicked',
          code: h.code || '',
          modified: !!h.modified
        };
      }
    }
    for (const sig of win.signals) {
      if (win.handlers[sig.handlerName]) continue;
      win.handlers[sig.handlerName] = {
        widgetId: sig.widgetId,
        gtkSignal: sig.gtkSignal,
        code: buildSkeleton(sig),
        modified: false
      };
    }

    wrapper.style.zIndex = win.z;
    state.windows.push(win);

    makeSelectable(win);
    decorateWindow(win);

    if (gladeResult.warnings && gladeResult.warnings.length) {
      gladeResult.warnings.forEach(function (w) { clog('warn', name + ' : ' + w); });
    }

    updateHintVisibility();
    updateExportButton();
    updateInfoPanel();
    renderList();
    scheduleDraft();
  }

  /**
   * Ajoute l'« habillage » du compositeur (boutons, poignées, taille, état)
   * Appelée à la création ET après chaque remontage du rendu d'origine.
   */
  function decorateWindow(win) {
    const wrapper = win.el;
    const titlebar = wrapper.querySelector('.gtk-titlebar');

    if (titlebar) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'comp-close';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Supprimer';
      closeBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        removeWindow(win.id);
      });
      titlebar.appendChild(closeBtn);

      const hideBtn = document.createElement('button');
      hideBtn.className = 'comp-hide-titlebar';
      hideBtn.textContent = '👁';
      hideBtn.title = 'Masquer la barre de titre';
      hideBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleTitlebar(win, false);
      });
      titlebar.appendChild(hideBtn);

      const ghostBtn = document.createElement('button');
      ghostBtn.className = 'comp-ghost-btn';
      ghostBtn.textContent = win.hidden ? '🙈' : '🪟';
      ghostBtn.title = 'Afficher / masquer au démarrage de l\'application';
      ghostBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        setWindowHidden(win, !win.hidden);
      });
      titlebar.appendChild(ghostBtn);
    }

    makeDraggable(win);
    if (win.width || win.height) applyCustomSize(win, win.width, win.height);
    addResizeHandles(win);
    if (win.titlebarVisible === false) toggleTitlebar(win, false);
    wrapper.classList.toggle('ghost', !!win.hidden);
  }

  /** Remet le rendu à l'état d'origine (efface tout ce qu'un aperçu a modifié). */
  function remountWindow(win) {
    if (win.view && win.view.destroy) win.view.destroy();
    win.el.querySelectorAll('.comp-show-titlebar').forEach(function (n) { n.remove(); });
    win.view = GladeViewer.mountInline(win.el, win.xml);
    win.el.classList.remove('cgml-hidden');
    decorateWindow(win);
  }

  function setWindowHidden(win, hidden) {
    win.hidden = !!hidden;
    win.el.classList.toggle('ghost', win.hidden);
    const b = win.el.querySelector('.comp-ghost-btn');
    if (b) b.textContent = win.hidden ? '🙈' : '🪟';
    touchUpdated();
    renderList();
    setStatus(win.hidden ? win.name + ' : masquée au démarrage' : win.name + ' : visible au démarrage');
  }

  function buildSkeleton(sig) {
    const cls = sig.widgetClass ? ' (' + sig.widgetClass + ')' : '';
    return [
      '// Handler : ' + sig.handlerName,
      '// Widget  : #' + (sig.widgetId || '?') + cls,
      '// Signal  : ' + sig.gtkSignal,
      'function ' + sig.handlerName + '(payload) {',
      '  // payload.value      — valeur courante (case, champ, liste, onglet…)',
      '  // payload.$(\'id\')    — un widget de CETTE fenêtre',
      '  // payload.window     — contexte de la fenêtre (get / set / show / hide …)',
      '  // app.api.<nom>.<méthode>()  — vos APIs ;  app.openWindow(\'w2\')  — autre fenêtre',
      '  ',
      '  // TODO : votre logique ici',
      '}'
    ].join('\n');
  }

  /* ------------------------------------------------------------------
   * Taille personnalisée
   * ------------------------------------------------------------------ */
  function applyCustomSize(win, w, h) {
    const gtkWin = win.el.querySelector('.gtk-window');
    if (!gtkWin) return;
    if (w != null) gtkWin.style.width = w + 'px';
    if (h != null) gtkWin.style.height = h + 'px';
  }

  /* ------------------------------------------------------------------
   * Masquer / afficher la barre de titre
   * ------------------------------------------------------------------ */
  function toggleTitlebar(win, visible) {
    win.titlebarVisible = visible;

    if (visible) {
      win.el.classList.remove('titlebar-hidden');
      const showBtn = win.el.querySelector('.comp-show-titlebar');
      if (showBtn) showBtn.remove();
    } else {
      win.el.classList.add('titlebar-hidden');
      if (!win.el.querySelector('.comp-show-titlebar')) {
        const showBtn = document.createElement('button');
        showBtn.className = 'comp-show-titlebar';
        showBtn.textContent = '👁';
        showBtn.title = 'Afficher la barre de titre';
        showBtn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          toggleTitlebar(win, true);
        });
        win.el.appendChild(showBtn);
      }
    }
    touchUpdated();
  }

  /* ------------------------------------------------------------------
   * Poignées de redimensionnement
   * ------------------------------------------------------------------ */
  function addResizeHandles(win) {
    const dirs = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
    for (const dir of dirs) {
      const h = document.createElement('div');
      h.className = 'comp-resize ' + dir;
      h.dataset.dir = dir;
      h.addEventListener('mousedown', function (ev) {
        ev.stopPropagation();
        ev.preventDefault();
        startResize(win, dir, ev);
      });
      win.el.appendChild(h);
    }
  }

  function startResize(win, dir, startEv) {
    const gtkWin = win.el.querySelector('.gtk-window');
    if (!gtkWin) return;

    const startW = gtkWin.offsetWidth;
    const startH = gtkWin.offsetHeight;
    const startX = win.x;
    const startY = win.y;
    const mouseX = startEv.clientX;
    const mouseY = startEv.clientY;

    const MIN_W = 100;
    const MIN_H = 60;

    function onMove(ev) {
      const dx = ev.clientX - mouseX;
      const dy = ev.clientY - mouseY;

      let newW = startW;
      let newH = startH;
      let newX = startX;
      let newY = startY;

      if (dir.indexOf('e') >= 0) newW = Math.max(MIN_W, startW + dx);
      if (dir.indexOf('w') >= 0) {
        newW = Math.max(MIN_W, startW - dx);
        newX = startX + (startW - newW);
      }
      if (dir.indexOf('s') >= 0) newH = Math.max(MIN_H, startH + dy);
      if (dir.indexOf('n') >= 0) {
        newH = Math.max(MIN_H, startH - dy);
        newY = startY + (startH - newH);
      }

      win.x = Math.max(0, newX);
      win.y = Math.max(0, newY);
      win.width = newW;
      win.height = newH;

      win.el.style.left = win.x + 'px';
      win.el.style.top  = win.y + 'px';
      gtkWin.style.width  = newW + 'px';
      gtkWin.style.height = newH + 'px';
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      touchUpdated();
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  /* ------------------------------------------------------------------
   * Drag / Sélection
   * ------------------------------------------------------------------ */
  function makeDraggable(win) {
    const handle = win.el.querySelector('.gtk-titlebar') || win.el;
    if (handle === win.el) { if (win.__dragBound) return; win.__dragBound = true; }
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    handle.addEventListener('mousedown', function (ev) {
      if (ev.target.classList.contains('comp-close')) return;
      if (ev.target.classList.contains('comp-hide-titlebar')) return;
      if (ev.target.classList.contains('comp-ghost-btn')) return;
      if (ev.button !== 0) return;
      if (state.previewMode) return;

      ev.preventDefault();
      dragging = true;
      sx = ev.clientX; sy = ev.clientY;
      ox = win.x;      oy = win.y;

      win.el.classList.add('dragging');
      selectWindow(win.id);

      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    function onMove(ev) {
      if (!dragging) return;
      win.x = Math.max(0, ox + (ev.clientX - sx));
      win.y = Math.max(0, oy + (ev.clientY - sy));
      win.el.style.left = win.x + 'px';
      win.el.style.top  = win.y + 'px';
    }
    function onUp() {
      dragging = false;
      win.el.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      touchUpdated();
    }
  }

  function makeSelectable(win) {
    win.el.addEventListener('mousedown', function () {
      selectWindow(win.id);
      bringToFront(win);
    });
  }

  function selectWindow(id) {
    if (state.selectedId && state.selectedId !== id) {
      const prev = state.windows.find(function (w) { return w.id === state.selectedId; });
      if (prev) prev.el.classList.remove('selected');
    }
    state.selectedId = id;
    const win = state.windows.find(function (w) { return w.id === id; });
    if (win) {
      win.el.classList.add('selected');
      openInspector(win);
    }
    renderList();
  }

  function bringToFront(win) {
    win.z = state.nextZ++;
    win.el.style.zIndex = win.z;
  }

  function removeWindow(id) {
    const idx = state.windows.findIndex(function (w) { return w.id === id; });
    if (idx < 0) return;
    const win = state.windows[idx];
    if (win.view && win.view.destroy) win.view.destroy();
    win.el.remove();
    state.windows.splice(idx, 1);

    if (state.selectedId === id) {
      state.selectedId = state.windows.length ? state.windows[state.windows.length - 1].id : null;
      if (state.selectedId) {
        const next = state.windows.find(function (w) { return w.id === state.selectedId; });
        if (next) {
          next.el.classList.add('selected');
          openInspector(next);
        }
      } else {
        closeInspector();
      }
    }

    updateHintVisibility();
    updateExportButton();
    updateInfoPanel();
    renderList();
    touchUpdated();
  }

  function clearAll() {
    for (const win of state.windows) {
      if (win.view && win.view.destroy) win.view.destroy();
      win.el.remove();
    }
    state.windows = [];
    state.selectedId = null;
    updateHintVisibility();
    updateExportButton();
    updateInfoPanel();
    renderList();
    closeInspector();
  }

  function renderList() {
    listEl.innerHTML = '';
    for (const win of state.windows) {
      const li = document.createElement('li');
      if (win.id === state.selectedId) li.classList.add('selected');
      if (win.hidden) li.classList.add('is-hidden');

      const vis = document.createElement('span');
      vis.className = 'vis';
      vis.textContent = win.hidden ? '🙈' : '🪟';
      vis.title = win.hidden ? 'Masquée au démarrage (cliquer pour afficher)' : 'Visible au démarrage (cliquer pour masquer)';
      vis.addEventListener('click', function (ev) {
        ev.stopPropagation();
        setWindowHidden(win, !win.hidden);
      });

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = win.name;
      name.title = win.name;

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = win.id;
      badge.title = 'Identifiant à utiliser dans app.openWindow(\'' + win.id + '\')';

      const sigCount = document.createElement('span');
      sigCount.className = 'signal-count';
      const done = Object.keys(win.handlers).filter(function (n) { return isImplemented(win, n); }).length;
      sigCount.textContent = done + '/' + Object.keys(win.handlers).length;
      sigCount.title = 'handlers implémentés / déclarés';

      li.appendChild(vis);
      li.appendChild(name);
      li.appendChild(sigCount);
      li.appendChild(badge);
      li.addEventListener('click', function () {
        selectWindow(win.id);
        bringToFront(win);
        win.el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
      listEl.appendChild(li);
    }
  }

  /* ==================================================================
   * INSPECTEUR
   * ================================================================== */
  function openInspector(win) {
    inspector.classList.remove('hidden');
    document.body.classList.add('inspector-open');
    inspector.classList.add('has-selection');

    inspWinId.textContent = win.id;
    inspWinName.textContent = win.name;
    inspSignalCount.textContent = win.signals.length + ' signal' + (win.signals.length > 1 ? 'aux' : '');

    if (!state.selectedSignal || !win.handlers[state.selectedSignal.handlerName]) {
      const firstSig = win.signals[0] || null;
      state.selectedSignal = firstSig ? {
        handlerName: firstSig.handlerName,
        widgetId: firstSig.widgetId,
        gtkSignal: firstSig.gtkSignal
      } : null;
    }

    renderSignalsList(win);
    renderEditor(win);
  }

  function closeInspector() {
    inspector.classList.add('hidden');
    inspector.classList.remove('has-selection');
    document.body.classList.remove('inspector-open');
    state.selectedSignal = null;
    destroyEditor();
    signalsListEl.innerHTML = '';
  }
  inspClose.addEventListener('click', closeInspector);

  function renderSignalsList(win) {
    signalsListEl.innerHTML = '';
    const uniqueHandlers = [];

    for (const sig of win.signals) {
      if (uniqueHandlers.find(function (h) { return h.handlerName === sig.handlerName; })) continue;
      uniqueHandlers.push(sig);
    }

    for (const sig of uniqueHandlers) {
      const item = document.createElement('div');
      item.className = 'signal-item';
      if (state.selectedSignal && state.selectedSignal.handlerName === sig.handlerName) {
        item.classList.add('active');
      }
      if (isImplemented(win, sig.handlerName)) item.classList.add('modified');
      if (sig.event === null) {
        item.classList.add('unsupported');
        item.title = 'Ce signal GTK n\'a pas d\'équivalent DOM : il ne sera jamais déclenché.';
      }

      const handler = document.createElement('div');
      handler.className = 'handler';
      handler.textContent = sig.handlerName;

      const meta = document.createElement('div');
      meta.className = 'meta';

      const gtkSig = document.createElement('span');
      gtkSig.className = 'gtk-sig';
      gtkSig.textContent = sig.gtkSignal;

      const wid = document.createElement('span');
      wid.textContent = '#' + sig.widgetId;

      meta.appendChild(gtkSig);
      meta.appendChild(wid);

      item.appendChild(handler);
      item.appendChild(meta);

      item.addEventListener('click', function () {
        state.selectedSignal = {
          handlerName: sig.handlerName,
          widgetId: sig.widgetId,
          gtkSignal: sig.gtkSignal
        };
        renderSignalsList(win);
        renderEditor(win);
      });

      signalsListEl.appendChild(item);
    }
  }

  function destroyEditor() {
    if (activeEditor) {
      activeEditor.destroy();
      activeEditor = null;
    }
    const container = document.getElementById('editor-container');
    if (container) container.remove();
  }

  function renderEditor(win) {
    destroyEditor();
    if (!state.selectedSignal) return;

    const sig = state.selectedSignal;
    const h = win.handlers[sig.handlerName];
    if (!h) return;
    const full = win.signals.find(function (s) { return s.handlerName === sig.handlerName; }) || sig;
    const uses = win.signals.filter(function (s) { return s.handlerName === sig.handlerName; });

    const container = document.createElement('div');
    container.id = 'editor-container';

    const tb = document.createElement('div');
    tb.className = 'editor-toolbar';

    const info = document.createElement('div');
    info.className = 'widget-info';
    info.innerHTML = 'Édition de <strong>' + escapeAttr(sig.handlerName) + '</strong> &nbsp;|&nbsp; widget <strong>#' +
      escapeAttr(sig.widgetId) + '</strong> &nbsp;|&nbsp; signal <strong>' + escapeAttr(sig.gtkSignal) + '</strong>' +
      (uses.length > 1 ? ' &nbsp;|&nbsp; partagé par <strong>' + uses.length + ' widgets</strong>' : '');

    const btnReset = document.createElement('button');
    btnReset.textContent = '↺ Squelette';
    btnReset.title = 'Revenir au squelette par défaut';
    btnReset.addEventListener('click', function () {
      if (activeEditor) activeEditor.setValue(buildSkeleton(full));
    });

    const btnApply = document.createElement('button');
    btnApply.textContent = '💾 Appliquer';
    btnApply.title = 'Enregistrer dans le projet (Ctrl+S) — relance l\'aperçu s\'il est actif';
    btnApply.addEventListener('click', function () {
      if (activeEditor) h.code = activeEditor.getValue();
      h.modified = isImplemented(win, sig.handlerName);
      renderSignalsList(win);
      updateInfoPanel();
      touchUpdated();
      scheduleDraft();
      setStatus('Handler « ' + sig.handlerName + ' » enregistré.');
      if (state.previewMode) reloadPreview();
    });

    tb.appendChild(info);
    tb.appendChild(btnReset);
    tb.appendChild(btnApply);
    container.appendChild(tb);

    const lint = document.createElement('div');
    lint.className = 'lint-line';
    container.appendChild(lint);

    const host = document.createElement('div');
    host.className = 'editor-host';
    container.appendChild(host);

    document.getElementById('inspector-body').appendChild(container);

    let lintTimer = null;
    function runLint() {
      const msg = lintHandler(h.code, sig.handlerName);
      lint.textContent = msg;
      lint.classList.toggle('on', !!msg);
    }

    activeEditor = makeEditor(host, h.code, function (code) {
      h.code = code;
      h.modified = isImplemented(win, sig.handlerName);
      const el = signalsListEl.querySelector('.signal-item.active');
      if (el) el.classList.toggle('modified', h.modified);
      clearTimeout(lintTimer);
      lintTimer = setTimeout(runLint, 300);
      scheduleDraft();
    }, {
      keys: {
        'Ctrl-S': function () { btnApply.click(); },
        'Cmd-S': function () { btnApply.click(); },
        'Ctrl-Enter': function () { btnApply.click(); }
      }
    });
    runLint();
    activeEditor.refresh();
  }

  /* ==================================================================
   * Chargement de fichiers .glade
   * ================================================================== */
  async function loadFiles(files) {
    for (const file of files) {
      if (/\.cgml\.(json|html?)$/i.test(file.name)) { await openProjectFile(file); continue; }
      if (!/\.(glade|xml)$/i.test(file.name)) continue;
      const xml = await file.text();
      addWindow(file.name, xml);
    }
    setStatus('✔ ' + state.windows.length + ' fenêtre(s)');
    touchUpdated();
  }

  fileInput.addEventListener('change', function (e) {
    loadFiles(Array.from(e.target.files));
    fileInput.value = '';
  });

  document.addEventListener('dragover', function (e) {
    e.preventDefault();
    document.body.classList.add('drop-target');
  });
  document.addEventListener('dragleave', function (e) {
    if (e.relatedTarget === null) document.body.classList.remove('drop-target');
  });
  document.addEventListener('drop', function (e) {
    e.preventDefault();
    document.body.classList.remove('drop-target');
    if (e.dataTransfer.files.length) {
      loadFiles(Array.from(e.dataTransfer.files));
    }
  });

  /* ==================================================================
   * Boutons
   * ================================================================== */
  btnClear.addEventListener('click', function () {
    if (state.windows.length === 0) return;
    if (!confirm('Effacer toutes les fenêtres (et le brouillon automatique) ?')) return;
    if (state.previewMode) btnPreview.click();
    clearAll();
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignoré */ }
    touchUpdated();
    setStatus('Vide.');
  });

  btnPreview.addEventListener('click', function () {
    state.previewMode = !state.previewMode;
    document.body.classList.toggle('preview-mode', state.previewMode);
    btnPreview.classList.toggle('active', state.previewMode);
    btnReload.classList.toggle('hidden', !state.previewMode);
    btnPreview.textContent = state.previewMode ? '■ Arrêter' : '▶ Tester';

    if (state.previewMode) {
      setStatus('▶ Mode test : l\'application tourne avec le runtime exporté.');
      startPreview();
    } else {
      stopPreview();
      setStatus('Mode édition.');
    }
  });

  btnReload.addEventListener('click', function () { reloadPreview(); });

  let previewRt = null;

  function startPreview() {
    const merged = collectHandlers();
    merged.conflicts.forEach(function (n) {
      clog('warn', 'Handler « ' + n + ' » défini avec un code différent dans plusieurs fenêtres : le code de la 1re fenêtre est utilisé.');
    });
    clog('log', '▶ Démarrage de l\'aperçu (' + Object.keys(merged.handlers).length + ' handler(s) implémenté(s)).');
    previewRt = CGML.boot({
      windows: state.windows.map(function (w) { return { id: w.id, name: w.name, el: w.el, hidden: w.hidden }; }),
      handlers: merged.handlers,
      shared: state.shared,
      apis: state.apis,
      meta: state.app,
      draggable: false,
      onLog: function (lvl, txt) { clog(lvl, txt); },
      onStatus: function (t) { setStatus('▶ ' + t); },
      onSignal: function (h, p) { setStatus('▶ ' + h + ' → #' + (p.widgetId || '?')); }
    });
  }

  function stopPreview() {
    if (previewRt) { previewRt.destroy(); previewRt = null; }
    state.windows.forEach(remountWindow);      // rendu d'origine : l'aperçu ne laisse aucune trace
  }

  function reloadPreview() {
    if (!state.previewMode) return;
    stopPreview();
    startPreview();
    clog('log', '↻ Aperçu relancé');
  }

  /* ==================================================================
   * PROJET — Save / Load / Métadonnées
   * ================================================================== */
  function serializeProject() {
    return {
      format: FORMAT_NAME,
      formatVersion: FORMAT_VERSION,
      app: Object.assign({}, state.app),
      settings: Object.assign({}, state.settings),
      shared: state.shared,
      apis: JSON.parse(JSON.stringify(state.apis)),
      stats: {
        windowCount: state.windows.length,
        handlerCount: countHandlers(),
        signalCount: state.windows.reduce(function (sum, w) { return sum + w.signals.length; }, 0),
        apiCount: state.apis.length
      },
      windows: state.windows.map(function (win) {
        const handlers = {};
        for (const name in win.handlers) {
          const h = win.handlers[name];
          handlers[name] = {
            widgetId: h.widgetId,
            gtkSignal: h.gtkSignal,
            code: h.code,
            modified: isImplemented(win, name)
          };
        }
        return {
          id: win.id,
          name: win.name,
          x: win.x,
          y: win.y,
          z: win.z,
          width: win.width || null,
          height: win.height || null,
          titlebarVisible: win.titlebarVisible !== false,
          hidden: !!win.hidden,
          xml: win.xml,
          handlers: handlers
        };
      })
    };
  }

  function countHandlers() {
    const seen = {};
    let n = 0;
    for (const win of state.windows) {
      for (const name in win.handlers) {
        if (seen[name]) continue;
        seen[name] = true;
        n++;
      }
    }
    return n;
  }

  function downloadBlob(content, mime, filename) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function saveProject() {
    if (state.windows.length === 0) {
      alert('Rien à sauvegarder : aucune fenêtre.');
      return;
    }
    touchUpdated();
    const project = serializeProject();
    const json = JSON.stringify(project, null, 2);
    const slug = (state.app.name || 'projet')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'projet';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = slug + '-' + ts + '.cgml.json';
    downloadBlob(json, 'application/json', filename);
    setStatus('💾 Projet sauvegardé : ' + filename);
    updateInfoPanel();
  }

  btnSaveProject.addEventListener('click', saveProject);

  /** Extrait le projet embarqué dans un fichier .cgml.html exporté. */
  function extractProjectFromHtml(text) {
    const m = /<script[^>]*id=["']cgml-project["'][^>]*>([\s\S]*?)<\/script>/i.exec(text);
    if (!m) {
      throw new Error('Cet export ne contient pas de projet intégré (fichier produit par une ancienne version). Rouvrez plutôt le .cgml.json correspondant.');
    }
    return JSON.parse(m[1]);
  }

  async function openProjectFile(f) {
    try {
      const text = await f.text();
      const project = /\.html?$/i.test(f.name) || /^\s*</.test(text)
        ? extractProjectFromHtml(text)
        : JSON.parse(text);
      loadProject(project);
    } catch (err) {
      console.error(err);
      alert('Erreur de chargement : ' + err.message);
      setStatus('❌ Fichier projet invalide');
      clog('error', 'Ouverture du projet : ' + err.message);
    }
  }

  projectInput.addEventListener('change', function (e) {
    const f = e.target.files[0];
    projectInput.value = '';
    if (f) openProjectFile(f);
  });

  function loadProject(project) {
    if (!project || project.format !== FORMAT_NAME) {
      throw new Error('Ce fichier n\'est pas un projet ' + FORMAT_NAME);
    }
    if (!project.windows || !project.windows.length) {
      throw new Error('Le projet ne contient aucune fenêtre');
    }

    if (state.previewMode) btnPreview.click();
    clearAll();
    closeInspector();

    state.app = Object.assign({
      name: 'Sans titre',
      description: '',
      version: '0.1.0',
      author: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }, project.app || {});

    state.shared   = typeof project.shared === 'string' ? project.shared : DEFAULT_SHARED;
    state.apis     = Array.isArray(project.apis) ? project.apis : [];
    state.settings = Object.assign({ draggable: false }, project.settings || {});

    state.nextId = 1;
    state.nextZ = 1;

    for (const w of project.windows) {
      addWindow(w.name, w.xml, {
        id: w.id,
        x: w.x,
        y: w.y,
        z: w.z,
        width: w.width || null,
        height: w.height || null,
        titlebarVisible: w.titlebarVisible,
        hidden: w.hidden,
        handlers: w.handlers
      });
    }

    updateInfoPanel();
    updateHintVisibility();
    updateExportButton();
    setStatus('📂 Projet chargé : ' + (state.app.name || '') + ' (' + state.windows.length + ' fenêtres, ' + state.apis.length + ' API)');
    clog('log', 'Projet « ' + (state.app.name || '') + ' » chargé.');
  }

  /* ==================================================================
   * Modale métadonnées
   * ================================================================== */
  function openModal() {
    metaName.value        = state.app.name || '';
    metaDescription.value = state.app.description || '';
    metaVersion.value     = state.app.version || '';
    metaAuthor.value      = state.app.author || '';
    metaDraggable.checked = !!state.settings.draggable;
    modalOverlay.classList.remove('hidden');
    metaName.focus();
  }
  function closeModal() {
    modalOverlay.classList.add('hidden');
  }

  btnEditInfo.addEventListener('click', openModal);
  modalClose.addEventListener('click', closeModal);
  modalCancel.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', function (e) {
    if (e.target === modalOverlay) closeModal();
  });

  modalSave.addEventListener('click', function () {
    state.app.name        = metaName.value.trim() || 'Sans titre';
    state.app.description = metaDescription.value.trim();
    state.app.version     = metaVersion.value.trim() || '0.1.0';
    state.app.author      = metaAuthor.value.trim();
    state.settings.draggable = metaDraggable.checked;
    touchUpdated();
    updateInfoPanel();
    closeModal();
    setStatus('Informations mises à jour');
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
      closeModal();
    }
  });

  /* ==================================================================
   * EXPORT .cgml.html
   * ==================================================================
   * Le fichier exporté contient :
   *   - le HTML figé de chaque fenêtre (rendu d'origine, positions, tailles)
   *   - le runtime CGML (le MÊME code que l'aperçu « ▶ Tester »)
   *   - le projet complet en JSON (handlers, script commun, APIs, sources .glade)
   *     → un .cgml.html peut être rouvert dans le compositeur
   * ================================================================== */
  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function windowToHtml(win) {
    const tmp = document.createElement('div');
    tmp.innerHTML = win.html;                         // rendu d'origine, pas le DOM vivant
    const gw = tmp.querySelector('.gtk-window');
    if (gw) {
      if (win.width)  gw.style.width  = win.width + 'px';
      if (win.height) gw.style.height = win.height + 'px';
    }
    return tmp.innerHTML;
  }

  function buildExportCss() {
    return [
      'html, body { margin: 0; padding: 0; min-height: 100vh; background: #2e3436; display: block;',
      '  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px; color: #e0e0e0; }',
      '#cgml-stage { position: relative; width: 100%; min-height: 100vh; padding: 20px; box-sizing: border-box; }',
      '.cgml-window { position: absolute; }',
      '.cgml-window .gtk-window { box-shadow: 0 8px 24px rgba(0,0,0,.35); }',
      '.cgml-window.titlebar-hidden .gtk-titlebar { display: none; }',
      '.cgml-window.titlebar-hidden .gtk-window { border-top-left-radius: 0; border-top-right-radius: 0; }',
      '.cgml-window.cgml-hidden { display: none !important; }'
    ].join('\n');
  }

  function validateBeforeExport() {
    const problems = [];
    const merged = collectHandlers();
    Object.keys(merged.handlers).forEach(function (n) {
      const msg = lintHandler(merged.handlers[n], n);
      if (msg) problems.push('Handler « ' + n + ' » : ' + msg.replace(/^⚠\s*/, ''));
    });
    const sharedMsg = lintHandler(state.shared, null);
    if (sharedMsg) problems.push('Script commun : ' + sharedMsg.replace(/^⚠\s*/, ''));
    merged.conflicts.forEach(function (n) {
      problems.push('Handler « ' + n + ' » défini avec des codes différents dans plusieurs fenêtres (le code de la 1re est exporté).');
    });
    state.apis.forEach(function (a) {
      if (a.auth && a.auth.token) problems.push('API « ' + a.name + ' » : le jeton d\'authentification sera écrit EN CLAIR dans le fichier exporté.');
    });
    return problems;
  }

  function buildExportHtml() {
    if (state.windows.length === 0) {
      throw new Error('Rien à exporter : aucune fenêtre.');
    }

    const winEls = [];
    for (const win of state.windows) {
      const hiddenClass = (win.titlebarVisible === false ? ' titlebar-hidden' : '') + (win.hidden ? ' cgml-hidden' : '');
      const style = 'left:' + win.x + 'px; top:' + win.y + 'px; z-index:' + win.z + ';';
      winEls.push(
        '    <div class="cgml-window' + hiddenClass + '"' +
        ' data-window-id="' + escapeAttr(win.id) + '"' +
        ' data-glade-name="' + escapeAttr(win.name) + '"' +
        ' style="' + style + '">\n' +
        '      ' + windowToHtml(win) + '\n' +
        '    </div>'
      );
    }

    const gtkCss = Glade2HTML.gladeToHtml(state.windows[0].xml).css;
    const merged = collectHandlers();

    const project = serializeProject();
    project.runtimeHandlers = merged.handlers;
    const json = JSON.stringify(project)
      .replace(/</g, '\\u003c')
      .replace(/\u2028/g, '\\u2028')
      .replace(/\u2029/g, '\\u2029');

    const runtimeSrc = (
      'window.CGML_FACTORY = ' + window.CGML_FACTORY.toString() + ';\n' +
      'window.CGML = window.CGML_FACTORY(window);'
    ).replace(/<\/script/gi, '<\\/script');

    const bootSrc = [
      '(function () {',
      '  var P = JSON.parse(document.getElementById("cgml-project").textContent);',
      '  var meta = {};',
      '  P.windows.forEach(function (w) { meta[w.id] = w; });',
      '  var wins = [];',
      '  document.querySelectorAll(".cgml-window").forEach(function (el) {',
      '    var id = el.getAttribute("data-window-id");',
      '    wins.push({ id: id, name: el.getAttribute("data-glade-name"), el: el, hidden: !!(meta[id] && meta[id].hidden) });',
      '  });',
      '  var rt = CGML.boot({',
      '    windows: wins,',
      '    handlers: P.runtimeHandlers || {},',
      '    shared: P.shared || "",',
      '    apis: P.apis || [],',
      '    meta: P.app || {},',
      '    draggable: !!(P.settings && P.settings.draggable)',
      '  });',
      '  window.cgml = rt; window.Composer = rt.Composer; window.app = rt.app;   // pratique dans la console du navigateur',
      '})();'
    ].join('\n');

    const header =
      '/* ==================================================================\n' +
      ' * ' + (state.app.name || 'CompoGlueML Export').replace(/\*\//g, '') + '\n' +
      ' * ' + (state.app.description || '').replace(/\*\//g, '').replace(/\n/g, ' ') + '\n' +
      ' * Version : ' + (state.app.version || '0.1.0') + '\n' +
      ' * Auteur  : ' + (state.app.author || '—') + '\n' +
      ' * Exporté : ' + new Date().toISOString() + '\n' +
      ' * ' + state.windows.length + ' fenêtre(s), ' + Object.keys(merged.handlers).length + ' handler(s), ' + state.apis.length + ' API\n' +
      ' * Projet complet embarqué : rouvrez ce fichier dans le compositeur.\n' +
      ' * ================================================================== */';

    return '<!DOCTYPE html>\n' +
      '<html lang="fr">\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + escapeAttr(state.app.name || 'CompoGlueML Export') + '</title>\n' +
      '<style>\n' +
      '/* === Styles GTK Adwaita === */\n' + gtkCss + '\n\n' +
      '/* === Styles du canevas exporté === */\n' + buildExportCss() + '\n' + CGML.css + '\n' +
      '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      '<div id="cgml-stage">\n' +
      winEls.join('\n') + '\n' +
      '</div>\n\n' +
      '<script type="application/json" id="cgml-project">' + json + '<\/script>\n' +
      '<script>\n' + header + '\n' + runtimeSrc + '\n<\/script>\n' +
      '<script>\n' + bootSrc + '\n<\/script>\n' +
      '</body>\n' +
      '</html>\n';
  }

  function exportToFile() {
    const problems = validateBeforeExport();
    if (problems.length) {
      problems.forEach(function (p) { clog('warn', p); });
      if (!confirm('Points d\'attention avant export :\n\n• ' + problems.join('\n• ') + '\n\nExporter quand même ?')) return;
    }

    let html;
    try {
      html = buildExportHtml();
    } catch (e) {
      alert('Erreur export : ' + e.message);
      return;
    }

    const slug = (state.app.name || 'export')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 40) || 'export';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = slug + '-' + ts + '.cgml.html';

    downloadBlob(html, 'text/html', filename);
    setStatus('📤 Exporté : ' + filename + ' (' + countHandlers() + ' handlers)');
    clog('log', '📤 Export : ' + filename + ' (' + Math.round(html.length / 1024) + ' Ko)');
    touchUpdated();
    updateInfoPanel();
  }

  btnExport.addEventListener('click', exportToFile);

  /* ==================================================================
   * DOCK : Script commun + APIs
   * ================================================================== */
  const dockOverlay = document.getElementById('dock-overlay');
  let dockTab = 'script';
  let dockEditors = [];

  function mk(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function destroyDockEditors() {
    dockEditors.forEach(function (ed) { ed.destroy(); });
    dockEditors = [];
  }
  function openDock(tab) {
    dockTab = tab || dockTab;
    renderDock();
    dockOverlay.classList.remove('hidden');
  }
  function closeDock() {
    destroyDockEditors();
    dockOverlay.classList.add('hidden');
    updateInfoPanel();
    if (state.previewMode) reloadPreview();
  }

  function renderDock() {
    destroyDockEditors();
    dockOverlay.innerHTML = '';
    const box = mk('div', 'dock');
    const head = mk('header', 'dock-head');
    [['script', '📜 Script commun'], ['apis', '🔌 APIs'], ['aide', '❓ Aide']].forEach(function (t) {
      const b = mk('button', 'dock-tab' + (dockTab === t[0] ? ' active' : ''), t[1]);
      b.addEventListener('click', function () { dockTab = t[0]; renderDock(); });
      head.appendChild(b);
    });
    head.appendChild(mk('div', 'spacer'));
    const x = mk('button', 'modal-close', '✕');
    x.addEventListener('click', closeDock);
    head.appendChild(x);
    box.appendChild(head);

    const body = mk('div', 'dock-body');
    box.appendChild(body);
    dockOverlay.appendChild(box);

    if (dockTab === 'script') renderScriptTab(body);
    else if (dockTab === 'apis') renderApisTab(body);
    else renderHelpTab(body);
  }

  dockOverlay.addEventListener('mousedown', function (e) { if (e.target === dockOverlay) closeDock(); });

  /* ---------------- Script commun ---------------- */
  function renderScriptTab(body) {
    body.appendChild(mk('p', 'dock-note',
      'Ce code est exécuté une seule fois au démarrage, dans le même scope que tous les handlers : ' +
      'variables, fonctions utilitaires et constantes déclarées ici sont visibles partout. ' +
      'Définissez on_app_ready() pour agir quand toutes les fenêtres sont prêtes.'));
    const lint = mk('div', 'lint-line');
    const host = mk('div', 'dock-editor');
    body.appendChild(host);
    body.appendChild(lint);
    let t = null;
    const ed = makeEditor(host, state.shared, function (code) {
      state.shared = code;
      clearTimeout(t);
      t = setTimeout(function () {
        const m = lintHandler(code, null);
        lint.textContent = m; lint.classList.toggle('on', !!m);
      }, 300);
      scheduleDraft();
    });
    dockEditors.push(ed);
    ed.refresh();
    const reset = mk('button', 'btn-small', '↺ Réinitialiser');
    reset.addEventListener('click', function () { ed.setValue(DEFAULT_SHARED); });
    body.appendChild(reset);
  }

  /* ---------------- APIs ---------------- */
  const API_PRESETS = {
    local: function () {
      return { name: 'local', kind: 'http', preset: 'local', baseUrl: 'http://localhost:3000', timeout: 10000,
        auth: { type: 'none' }, headers: {}, mock: false,
        endpoints: [
          { name: 'list', method: 'GET', path: '/items', mock: '[{"id":1,"title":"Exemple"}]' },
          { name: 'create', method: 'POST', path: '/items', mock: '{"id":2}' }
        ] };
    },
    external: function () {
      return { name: 'externe', kind: 'http', preset: 'external', baseUrl: 'https://api.example.com', timeout: 15000,
        auth: { type: 'bearer', token: '' }, headers: {}, mock: false,
        endpoints: [{ name: 'get', method: 'GET', path: '/v1/resource/{id}', mock: '{"id":1}' }] };
    },
    mock: function () {
      return { name: 'simule', kind: 'http', preset: 'mock', baseUrl: 'http://mock.invalid', timeout: 5000,
        auth: { type: 'none' }, headers: {}, mock: true,
        endpoints: [{ name: 'projets', method: 'GET', path: '/projets', mock: '[{"id":1,"nom":"Alpha"},{"id":2,"nom":"Beta"}]' }] };
    },
    js: function () {
      return { name: 'outils', kind: 'js', preset: 'js',
        code: '{\n  double(n) { return n * 2; },\n  async bonjour(nom) {\n    await app.api.util.sleep(200);\n    return \'Bonjour \' + nom;\n  }\n}' };
    }
  };

  function uniqueApiName(base) {
    let n = base, i = 2;
    while (state.apis.some(function (a) { return a.name === n; }) || CGML.builtinDoc[n]) n = base + i++;
    return n;
  }

  function apiNameError(cfg) {
    if (!/^[A-Za-z_$][\w$]*$/.test(cfg.name || '')) return 'Nom invalide (lettres, chiffres, _ ; pas d\'espace).';
    if (CGML.builtinDoc[cfg.name]) return 'Nom réservé par une API intégrée.';
    if (state.apis.some(function (a) { return a !== cfg && a.name === cfg.name; })) return 'Nom déjà utilisé.';
    return '';
  }

  function field(label, input) {
    const w = mk('label', 'dfield');
    w.appendChild(mk('span', null, label));
    w.appendChild(input);
    return w;
  }
  function textInput(value, onInput, placeholder) {
    const i = document.createElement('input');
    i.type = 'text'; i.value = value || ''; if (placeholder) i.placeholder = placeholder;
    i.addEventListener('input', function () { onInput(i.value); scheduleDraft(); });
    return i;
  }

  function renderApisTab(body) {
    const bar = mk('div', 'dock-bar');
    bar.appendChild(mk('span', 'dock-note', 'Ajouter une API :'));
    [['local', '＋ HTTP local (localhost)'], ['external', '＋ HTTP externe'], ['mock', '＋ API simulée'], ['js', '＋ Fonctions JS']].forEach(function (p) {
      const b = mk('button', 'btn-small', p[1]);
      b.addEventListener('click', function () {
        const cfg = API_PRESETS[p[0]]();
        cfg.name = uniqueApiName(cfg.name);
        state.apis.push(cfg);
        scheduleDraft();
        renderDock();
      });
      bar.appendChild(b);
    });
    body.appendChild(bar);

    const list = mk('div', 'api-list');
    body.appendChild(list);

    if (!state.apis.length) {
      list.appendChild(mk('p', 'dock-note', 'Aucune API personnalisée. Les APIs intégrées (storage, ui, files, clipboard, util) sont toujours disponibles dans app.api.'));
    }
    state.apis.forEach(function (cfg, idx) { list.appendChild(renderApiCard(cfg, idx)); });

    const bi = mk('div', 'api-builtin');
    bi.appendChild(mk('h4', null, 'APIs intégrées (toujours disponibles)'));
    Object.keys(CGML.builtinDoc).forEach(function (n) {
      const row = mk('div', 'bi-row');
      row.appendChild(mk('code', null, 'app.api.' + n));
      row.appendChild(mk('span', null, CGML.builtinDoc[n].join('  ·  ')));
      bi.appendChild(row);
    });
    body.appendChild(bi);
  }

  function renderApiCard(cfg, idx) {
    const card = mk('div', 'api-card');
    const top = mk('div', 'api-top');
    const err = mk('div', 'api-err');
    function checkName() { const m = apiNameError(cfg); err.textContent = m; err.classList.toggle('on', !!m); }

    const nameIn = textInput(cfg.name, function (v) { cfg.name = v.trim(); checkName(); }, 'nom');
    nameIn.className = 'api-name';
    top.appendChild(mk('code', null, 'app.api.'));
    top.appendChild(nameIn);
    top.appendChild(mk('span', 'api-kind', cfg.kind === 'js' ? 'JS intégré' :
      (cfg.mock ? 'HTTP simulé' : (/^https?:\/\/(localhost|127\.|\[::1\])/i.test(cfg.baseUrl || '') ? 'HTTP local' : 'HTTP externe'))));
    top.appendChild(mk('div', 'spacer'));
    const del = mk('button', 'btn-small danger', '🗑');
    del.title = 'Supprimer cette API';
    del.addEventListener('click', function () {
      state.apis.splice(idx, 1); scheduleDraft(); renderDock();
    });
    top.appendChild(del);
    card.appendChild(top);
    card.appendChild(err);
    checkName();

    if (cfg.kind === 'js') {
      card.appendChild(mk('p', 'dock-note', 'Une expression objet : chaque méthode devient app.api.' + (cfg.name || 'nom') + '.méthode(). `app` est accessible.'));
      const host = mk('div', 'dock-editor small');
      card.appendChild(host);
      const lint = mk('div', 'lint-line');
      card.appendChild(lint);
      let t = null;
      const ed = makeEditor(host, cfg.code, function (code) {
        cfg.code = code;
        clearTimeout(t);
        t = setTimeout(function () {
          let m = '';
          try { new Function('app', 'return (' + code + '\n);'); } catch (e) { m = '⚠ Syntaxe : ' + e.message; }
          lint.textContent = m; lint.classList.toggle('on', !!m);
        }, 300);
        scheduleDraft();
      });
      dockEditors.push(ed);
      ed.refresh();
      return card;
    }

    /* ----- HTTP ----- */
    const grid = mk('div', 'dgrid');
    grid.appendChild(field('URL de base', textInput(cfg.baseUrl, function (v) { cfg.baseUrl = v.trim(); }, 'https://…  ou  http://localhost:3000')));
    const to = textInput(String(cfg.timeout || 15000), function (v) { cfg.timeout = parseInt(v, 10) || 15000; });
    grid.appendChild(field('Délai max (ms)', to));

    cfg.auth = cfg.auth || { type: 'none' };
    const authSel = document.createElement('select');
    [['none', 'Aucune'], ['bearer', 'Bearer token'], ['header', 'En-tête personnalisé']].forEach(function (o) {
      const op = document.createElement('option'); op.value = o[0]; op.textContent = o[1];
      if (cfg.auth.type === o[0]) op.selected = true;
      authSel.appendChild(op);
    });
    const tokenIn = textInput(cfg.auth.token, function (v) { cfg.auth.token = v; }, 'jeton / valeur');
    const hdrIn = textInput(cfg.auth.headerName, function (v) { cfg.auth.headerName = v.trim(); }, 'X-Api-Key');
    function syncAuth() {
      cfg.auth.type = authSel.value;
      tokenIn.parentNode.style.display = authSel.value === 'none' ? 'none' : '';
      hdrIn.parentNode.style.display = authSel.value === 'header' ? '' : 'none';
    }
    authSel.addEventListener('change', function () { syncAuth(); scheduleDraft(); });
    grid.appendChild(field('Authentification', authSel));
    grid.appendChild(field('Nom de l\'en-tête', hdrIn));
    grid.appendChild(field('Jeton / valeur (écrit en clair dans l\'export)', tokenIn));
    syncAuth();

    const hdrArea = document.createElement('textarea');
    hdrArea.rows = 2; hdrArea.spellcheck = false;
    hdrArea.placeholder = '{"X-Custom": "valeur"}';
    hdrArea.value = cfg.headers && Object.keys(cfg.headers).length ? JSON.stringify(cfg.headers) : '';
    hdrArea.addEventListener('input', function () {
      try { cfg.headers = hdrArea.value.trim() ? JSON.parse(hdrArea.value) : {}; hdrArea.classList.remove('bad'); }
      catch (e) { hdrArea.classList.add('bad'); }
      scheduleDraft();
    });
    grid.appendChild(field('En-têtes JSON', hdrArea));

    const mockCb = document.createElement('input');
    mockCb.type = 'checkbox'; mockCb.checked = !!cfg.mock;
    mockCb.addEventListener('change', function () { cfg.mock = mockCb.checked; scheduleDraft(); });
    const mockW = mk('label', 'dfield inline');
    mockW.appendChild(mockCb);
    mockW.appendChild(mk('span', null, 'Mode simulé : renvoie les réponses « mock » ci-dessous sans appeler le réseau'));
    grid.appendChild(mockW);
    card.appendChild(grid);

    card.appendChild(mk('div', 'dock-note small',
      'Un serveur externe doit autoriser votre origine (CORS). Un serveur local peut être lancé avec les en-têtes Access-Control-Allow-Origin.'));

    /* Endpoints */
    cfg.endpoints = cfg.endpoints || [];
    const eps = mk('div', 'eps');
    eps.appendChild(mk('h4', null, 'Endpoints  →  app.api.' + (cfg.name || 'nom') + '.<nom>({ paramètres })'));
    cfg.endpoints.forEach(function (ep, ei) {
      const row = mk('div', 'ep-row');
      row.appendChild(textInput(ep.name, function (v) { ep.name = v.trim(); }, 'nom'));
      const m = document.createElement('select');
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach(function (x) {
        const o = document.createElement('option'); o.textContent = x; if (ep.method === x) o.selected = true; m.appendChild(o);
      });
      m.addEventListener('change', function () { ep.method = m.value; scheduleDraft(); });
      row.appendChild(m);
      row.appendChild(textInput(ep.path, function (v) { ep.path = v; }, '/chemin/{param}?x=1'));
      row.appendChild(textInput(ep.mock, function (v) { ep.mock = v; }, 'réponse mock (JSON)'));
      const argsIn = textInput('', function () {}, 'args {"id":1}');
      argsIn.className = 'ep-args';
      row.appendChild(argsIn);
      const test = mk('button', 'btn-small', '▶ Tester');
      test.addEventListener('click', function () { testEndpoint(cfg, ep, argsIn.value); });
      row.appendChild(test);
      const rm = mk('button', 'btn-small danger', '✕');
      rm.addEventListener('click', function () { cfg.endpoints.splice(ei, 1); scheduleDraft(); renderDock(); });
      row.appendChild(rm);
      eps.appendChild(row);
    });
    const add = mk('button', 'btn-small', '＋ Endpoint');
    add.addEventListener('click', function () {
      cfg.endpoints.push({ name: 'action' + (cfg.endpoints.length + 1), method: 'GET', path: '/', mock: '' });
      scheduleDraft(); renderDock();
    });
    eps.appendChild(add);
    card.appendChild(eps);
    return card;
  }

  async function testEndpoint(cfg, ep, argsText) {
    let args = {};
    try { if (argsText.trim()) args = JSON.parse(argsText); }
    catch (e) { clog('error', 'Arguments JSON invalides : ' + e.message); return; }
    const stub = {
      log: function () { clog('api', Array.prototype.join.call(arguments, ' ')); },
      warn: function () { clog('warn', Array.prototype.join.call(arguments, ' ')); },
      error: function () { clog('error', Array.prototype.join.call(arguments, ' ')); }
    };
    const built = CGML.buildApis([cfg], stub, state.app);
    built.errors.forEach(function (m) { clog('error', m); });
    const fn = built.api[cfg.name] && built.api[cfg.name][ep.name];
    if (!fn) { clog('error', 'Endpoint « ' + ep.name + ' » invalide.'); return; }
    openConsole();
    try {
      const res = await fn(args);
      clog('api', '✔ ' + cfg.name + '.' + ep.name + ' → ' + JSON.stringify(res).slice(0, 600));
    } catch (e) {
      clog('error', '✖ ' + cfg.name + '.' + ep.name + ' : ' + e.message);
    }
  }

  /* ---------------- Aide ---------------- */
  function renderHelpTab(body) {
    const pre = mk('pre', 'help');
    pre.textContent = [
      'HANDLERS',
      '  function on_xxx(payload) { … }',
      '    payload.value       valeur courante (case, champ, liste, index d\'onglet…)',
      '    payload.$(\'id\')     widget de la fenêtre qui a émis le signal',
      '    payload.window      contexte de fenêtre : get(id) set(id,v) text(id,t) enable(id,bool) show() hide()',
      '    payload.element     élément DOM source ; payload.nativeEvent l\'événement brut',
      '',
      'APP (disponible partout)',
      '  app.state                    objet partagé entre handlers',
      '  app.window(réf)              réf = id « w2 », nom de fichier, id Glade de la fenêtre',
      '  app.widget(réf, id)          widget d\'une autre fenêtre',
      '  app.openWindow(réf) / closeWindow(réf) / toggleWindow(réf)',
      '  app.on(evt, fn) / app.emit(evt, data)   événements entre fenêtres',
      '  app.call(\'on_autre\', payload)           appeler un autre handler',
      '  app.status(txt)  app.toast(txt)  app.log(…)  app.addStyle(css)',
      '',
      'APIs',
      '  app.api.storage.get/set/remove     persistance locale (localStorage, JSON)',
      '  app.api.ui.toast/alert/confirm/prompt',
      '  app.api.files.download(nom, contenu) / pick({accept, as:\'json\'})',
      '  app.api.clipboard.write(texte)',
      '  app.api.util.sleep/uuid/now/format/debounce',
      '  app.api.<votre_api>.<endpoint>({…})     HTTP local ou externe, ou fonctions JS',
      '',
      '  Les paramètres {x} du chemin sont remplacés ; les autres vont en query (GET/DELETE)',
      '  ou en corps JSON (POST/PUT/PATCH). args.body / args.headers sont prioritaires.',
      '',
      'COMPAT : Composer.widget(id), Composer.widgetIn(fenêtre, id), Composer.openWindow(\'w2\') … continuent de fonctionner.',
      '',
      'ASTUCE : Ctrl+Espace = autocomplétion (app., payload., app.api.…) ; Ctrl+S = enregistrer ; ▶ Tester puis ↻ pour relancer.'
    ].join('\n');
    body.appendChild(pre);
  }

  document.getElementById('btn-script').addEventListener('click', function () { openDock('script'); });
  document.getElementById('btn-apis').addEventListener('click', function () { openDock('apis'); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !dockOverlay.classList.contains('hidden')) closeDock();
  });

  /* ==================================================================
   * API globale
   * ================================================================== */
  window.Composer = {
    state: state,
    addWindow: addWindow,
    selectWindow: selectWindow,
    bringToFront: bringToFront,
    removeWindow: removeWindow,
    clearAll: clearAll,
    setStatus: setStatus,
    openInspector: openInspector,
    closeInspector: closeInspector,
    exportToFile: exportToFile,
    saveProject: saveProject,
    log: clog,
    openDock: openDock,
    collectHandlers: collectHandlers,
    buildExportHtml: buildExportHtml,
    startPreview: function () { if (!state.previewMode) btnPreview.click(); },
    loadProject: loadProject,
    serializeProject: serializeProject,

    current: function () {
      return state.windows.find(function (w) { return w.id === state.selectedId; }) || null;
    },
    widget: function (gladeId) {
      const w = this.current();
      if (!w) return null;
      return w.el.querySelector('[data-glade-id="' + gladeId + '"]');
    },
    widgetIn: function (gladeName, gladeId) {
      const w = state.windows.find(function (x) { return x.name === gladeName; });
      if (!w) return null;
      return w.el.querySelector('[data-glade-id="' + gladeId + '"]');
    },
    widgetsIn: function (gladeName) {
      const w = state.windows.find(function (x) { return x.name === gladeName; });
      if (!w) return {};
      const out = {};
      w.el.querySelectorAll('[data-glade-id]').forEach(function (el) {
        out[el.dataset.gladeId] = el;
      });
      return out;
    }
  };

  /* ==================================================================
   * Init
   * ================================================================== */
  updateHintVisibility();
  updateExportButton();
  updateInfoPanel();
  setStatus('Prêt. Ajoutez un .glade.');
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      loadProject(JSON.parse(raw));
      setStatus('♻ Brouillon restauré — « 🗑 Vider » pour repartir de zéro.');
    }
  } catch (e) {
    console.warn('Brouillon ignoré :', e);
  }

})();