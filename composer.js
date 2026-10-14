/* =====================================================================
 * composer.js — logique du compositeur CompoGlueML
 * Version 0.6.0 — masquer barre de titre + redimensionnement
 * ===================================================================== */
(function () {
  'use strict';

  const FORMAT_NAME = 'CompoGlueML';
  const FORMAT_VERSION = '1.0';

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
      return;
    }

    // Boutons sur la barre de titre
    const titlebar = wrapper.querySelector('.gtk-titlebar');
    const win = {
      id: id,
      name: name,
      xml: xml,
      x: x, y: y,
      z: options.z != null ? options.z : state.nextZ++,
      titlebarVisible: options.titlebarVisible !== false,
      width: options.width || null,
      height: options.height || null,
      el: wrapper,
      view: view,
      signals: gladeResult.signals || [],
      handlers: {}
    };

    if (titlebar) {
      // Bouton fermer
      const closeBtn = document.createElement('button');
      closeBtn.className = 'comp-close';
      closeBtn.textContent = '✕';
      closeBtn.title = 'Supprimer';
      closeBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        removeWindow(id);
      });
      titlebar.appendChild(closeBtn);

      // Bouton masquer la barre
      const hideBtn = document.createElement('button');
      hideBtn.className = 'comp-hide-titlebar';
      hideBtn.textContent = '👁';
      hideBtn.title = 'Masquer la barre de titre';
      hideBtn.addEventListener('click', function (ev) {
        ev.stopPropagation();
        toggleTitlebar(win, false);
      });
      titlebar.appendChild(hideBtn);
    }

    if (options.z != null && options.z >= state.nextZ) state.nextZ = options.z + 1;

    // Handlers
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

    makeDraggable(win);
    makeSelectable(win);

    // Applique une taille personnalisée si fournie
    if (win.width || win.height) {
      applyCustomSize(win, win.width, win.height);
    }

    // Poignées de redimensionnement
    addResizeHandles(win);

    // Masque la barre si demandé
    if (win.titlebarVisible === false) {
      toggleTitlebar(win, false);
    }

    updateHintVisibility();
    updateExportButton();
    updateInfoPanel();
    renderList();
  }

  function buildSkeleton(sig) {
    return [
      '// Handler : ' + sig.handlerName,
      '// Widget  : #' + (sig.widgetId || '?'),
      '// Signal  : ' + sig.gtkSignal,
      'function ' + sig.handlerName + '(payload) {',
      '  // payload.widgetId — id Glade de la source',
      '  // payload.value    — valeur (checkbox, entry…)',
      '  // payload.element  — élément DOM source',
      '  // payload.nativeEvent — événement DOM brut',
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
    let sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;

    handle.addEventListener('mousedown', function (ev) {
      if (ev.target.classList.contains('comp-close')) return;
      if (ev.target.classList.contains('comp-hide-titlebar')) return;
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

      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = win.name;
      name.title = win.name;

      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = win.id;

      const sigCount = document.createElement('span');
      sigCount.className = 'signal-count';
      sigCount.textContent = win.signals.length;

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
      if (win.handlers[sig.handlerName] && win.handlers[sig.handlerName].modified) {
        item.classList.add('modified');
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
      activeEditor.toTextArea && activeEditor.toTextArea();
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

    const container = document.createElement('div');
    container.id = 'editor-container';

    const tb = document.createElement('div');
    tb.className = 'editor-toolbar';

    const info = document.createElement('div');
    info.className = 'widget-info';
    info.innerHTML = 'Édition de <strong>' + sig.handlerName + '</strong> &nbsp;|&nbsp; widget <strong>#' + sig.widgetId + '</strong> &nbsp;|&nbsp; signal <strong>' + sig.gtkSignal + '</strong>';

    const btnReset = document.createElement('button');
    btnReset.textContent = '↺ Réinitialiser';
    btnReset.title = 'Revenir au squelette par défaut';
    btnReset.addEventListener('click', function () {
      h.code = buildSkeleton(sig);
      h.modified = false;
      if (activeEditor) activeEditor.setValue(h.code);
      renderSignalsList(win);
      touchUpdated();
    });

    const btnApply = document.createElement('button');
    btnApply.textContent = '💾 Appliquer';
    btnApply.title = 'Sauvegarder le code dans l\'état du compositeur';
    btnApply.addEventListener('click', function () {
      if (activeEditor) h.code = activeEditor.getValue();
      h.modified = true;
      renderSignalsList(win);
      updateInfoPanel();
      touchUpdated();
      setStatus('Handler "' + sig.handlerName + '" sauvegardé.');
    });

    tb.appendChild(info);
    tb.appendChild(btnReset);
    tb.appendChild(btnApply);
    container.appendChild(tb);

    const ta = document.createElement('textarea');
    ta.value = h.code;
    container.appendChild(ta);

    document.getElementById('inspector-body').appendChild(container);

    activeEditor = CodeMirror.fromTextArea(ta, {
      mode: 'javascript',
      theme: 'dracula',
      lineNumbers: true,
      autoCloseBrackets: true,
      matchBrackets: true,
      indentUnit: 2,
      tabSize: 2,
      lineWrapping: true,
      extraKeys: {
        'Ctrl-S': function () { btnApply.click(); },
        'Cmd-S': function () { btnApply.click(); }
      }
    });

    activeEditor.on('change', function () {
      h.code = activeEditor.getValue();
      h.modified = true;
      const el = signalsListEl.querySelector('.signal-item.active');
      if (el) el.classList.add('modified');
    });
  }

  /* ==================================================================
   * Chargement de fichiers .glade
   * ================================================================== */
  async function loadFiles(files) {
    for (const file of files) {
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
    if (!confirm('Effacer toutes les fenêtres ?')) return;
    clearAll();
    touchUpdated();
    setStatus('Vide.');
  });

  btnPreview.addEventListener('click', function () {
    state.previewMode = !state.previewMode;
    document.body.classList.toggle('preview-mode', state.previewMode);
    btnPreview.classList.toggle('active', state.previewMode);
    setStatus(state.previewMode ? '▶ Mode test : les widgets réagissent aux clics.' : 'Mode édition.');

    if (state.previewMode) attachPreviewHandlers();
    else detachPreviewHandlers();
  });

  let previewAttach = null;

  function attachPreviewHandlers() {
    const allHandlers = {};
    for (const win of state.windows) {
      for (const name in win.handlers) {
        const code = win.handlers[name].code;
        if (!code || code.indexOf('function ' + name) === -1) continue;
        try {
          const fn = new Function(code + '; return ' + name + ';')();
          allHandlers[name] = fn;
        } catch (e) {
          console.error('Erreur dans le handler ' + name + ' :', e);
        }
      }
    }
    previewAttach = [];
    for (const win of state.windows) {
      const att = GladeViewer.attach(win.el, allHandlers, {
        strict: false,
        onSignal: function (handlerName, payload) {
          setStatus('▶ ' + handlerName + ' → #' + (payload.widgetId || '?'));
        }
      });
      previewAttach.push(att);
    }
    setStatus('▶ ' + Object.keys(allHandlers).length + ' handlers branchés.');
  }

  function detachPreviewHandlers() {
    if (!previewAttach) return;
    for (const a of previewAttach) {
      if (a && a.destroy) a.destroy();
    }
    previewAttach = null;
  }

  /* ==================================================================
   * PROJET — Save / Load / Métadonnées
   * ================================================================== */
  function serializeProject() {
    return {
      format: FORMAT_NAME,
      formatVersion: FORMAT_VERSION,
      app: Object.assign({}, state.app),
      stats: {
        windowCount: state.windows.length,
        handlerCount: countHandlers(),
        signalCount: state.windows.reduce(function (sum, w) { return sum + w.signals.length; }, 0)
      },
      windows: state.windows.map(function (win) {
        const handlers = {};
        for (const name in win.handlers) {
          const h = win.handlers[name];
          handlers[name] = {
            widgetId: h.widgetId,
            gtkSignal: h.gtkSignal,
            code: h.code,
            modified: !!h.modified
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

  projectInput.addEventListener('change', async function (e) {
    const f = e.target.files[0];
    if (!f) return;
    projectInput.value = '';
    try {
      const text = await f.text();
      const project = JSON.parse(text);
      loadProject(project);
    } catch (err) {
      console.error(err);
      alert('Erreur de chargement : ' + err.message);
      setStatus('❌ Fichier projet invalide');
    }
  });

  function loadProject(project) {
    if (!project || project.format !== FORMAT_NAME) {
      throw new Error('Ce fichier n\'est pas un projet ' + FORMAT_NAME);
    }
    if (!project.windows || !project.windows.length) {
      throw new Error('Le projet ne contient aucune fenêtre');
    }

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
        handlers: w.handlers
      });
    }

    updateInfoPanel();
    updateHintVisibility();
    updateExportButton();
    setStatus('📂 Projet chargé : ' + (state.app.name || '') + ' (' + state.windows.length + ' fenêtres)');
  }

  /* ==================================================================
   * Modale métadonnées
   * ================================================================== */
  function openModal() {
    metaName.value        = state.app.name || '';
    metaDescription.value = state.app.description || '';
    metaVersion.value     = state.app.version || '';
    metaAuthor.value      = state.app.author || '';
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
   * ================================================================== */
  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function windowToHtml(win) {
    const clone = win.el.cloneNode(true);
    clone.querySelectorAll('.comp-close').forEach(function (e) { e.remove(); });
    clone.querySelectorAll('.comp-hide-titlebar').forEach(function (e) { e.remove(); });
    clone.querySelectorAll('.comp-show-titlebar').forEach(function (e) { e.remove(); });
    clone.querySelectorAll('.comp-resize').forEach(function (e) { e.remove(); });
    const styleEl = clone.querySelector('style');
    if (styleEl) styleEl.remove();
    clone.classList.remove('selected', 'dragging');
    clone.style.zIndex = '';
    clone.style.left = '';
    clone.style.top = '';
    return clone.innerHTML;
  }

  function buildHandlersJs() {
    const names = [];
    const seen = {};
    for (const win of state.windows) {
      for (const name in win.handlers) {
        if (seen[name]) continue;
        seen[name] = true;
        names.push(name);
      }
    }
    if (!names.length) return 'var handlers = {};';

    const entries = names.map(function (name) {
      let code = '';
      for (const win of state.windows) {
        if (win.handlers[name]) { code = win.handlers[name].code || ''; break; }
      }
      return (
        '  ' + name + ': (function(){\n' +
        '    try {\n' +
        '      ' + code + '\n' +
        '      return ' + name + ';\n' +
        '    } catch (e) {\n' +
        '      console.error("Handler ' + name + ' :", e);\n' +
        '      return function(){};\n' +
        '    }\n' +
        '  })()'
      );
    });

    return 'var handlers = {\n' + entries.join(',\n') + '\n};';
  }

  function buildAttachHelper() {
    return [
      'window.__cgmlAttach = function (root, handlers, options) {',
      '  options = options || {};',
      '  var GTK_EVENT = { clicked:"click", toggled:"change", changed:"input",',
      '    activate:"click", "state-set":"change", value_changed:"input" };',
      '  function extractValue(el, evt) {',
      '    var t = el.tagName.toLowerCase();',
      '    if (t === "input" || t === "textarea" || t === "select") {',
      '      if (el.type === "checkbox" || el.type === "radio") return el.checked;',
      '      return el.value;',
      '    }',
      '    return evt === "click" ? true : undefined;',
      '  }',
      '  var widgets = {};',
      '  root.querySelectorAll("[data-glade-id]").forEach(function (el) {',
      '    widgets[el.dataset.gladeId] = el;',
      '  });',
      '  var bound = [];',
      '  root.querySelectorAll("[data-glade-handler]").forEach(function (el) {',
      '    var h = el.dataset.gladeHandler;',
      '    var gtkSig = el.dataset.gladeSignal || "click";',
      '    var domEvt = GTK_EVENT[gtkSig] || "click";',
      '    var listener = function (ev) {',
      '      var win = el.closest(".cgml-window");',
      '      if (win) window.__lastClickedWindow = win;',
      '      var payload = {',
      '        widgetId: el.dataset.gladeId || "",',
      '        gtkSignal: gtkSig,',
      '        value: extractValue(el, domEvt),',
      '        element: el,',
      '        nativeEvent: ev',
      '      };',
      '      var fn = handlers[h];',
      '      if (typeof fn === "function") {',
      '        try { fn(payload); } catch (e) { console.error("[cgml] " + h + " :", e); }',
      '      }',
      '      if (options.onSignal) options.onSignal(h, payload);',
      '    };',
      '    el.addEventListener(domEvt, listener);',
      '    bound.push({ el: el, evt: domEvt, fn: listener });',
      '  });',
      '  return {',
      '    widgets: widgets,',
      '    getWidget: function (id) { return widgets[id] || null; },',
      '    destroy: function () { bound.forEach(function(b){ b.el.removeEventListener(b.evt, b.fn); }); }',
      '  };',
      '};'
    ].join('\n');
  }

  function buildRuntimeJs() {
    return [
      '(function(){',
      '  var __views = [];',
      '  var __winsByName = {};',
      '  var __winsById = {};',
      '  document.querySelectorAll(".cgml-window").forEach(function(el){',
      '    __winsByName[el.dataset.gladeName] = el;',
      '    __winsById[el.dataset.windowId] = el;',
      '  });',
      '  window.__lastClickedWindow = null;',
      '  window.Composer = {',
      '    current: function(){',
      '      if (window.__lastClickedWindow) {',
      '        var wid = window.__lastClickedWindow.dataset.windowId;',
      '        if (wid && __winsById[wid]) return __winsById[wid];',
      '      }',
      '      var keys = Object.keys(__winsById);',
      '      return keys.length ? __winsById[keys[0]] : null;',
      '    },',
      '    widget: function(gladeId){',
      '      if (window.__lastClickedWindow) {',
      '        var el = window.__lastClickedWindow.querySelector(\'[data-glade-id="\' + gladeId + \'"]\');',
      '        if (el) return el;',
      '      }',
      '      var keys = Object.keys(__winsById);',
      '      for (var i = keys.length - 1; i >= 0; i--) {',
      '        var w = __winsById[keys[i]];',
      '        var el2 = w.querySelector(\'[data-glade-id="\' + gladeId + \'"]\');',
      '        if (el2) return el2;',
      '      }',
      '      return null;',
      '    },',
      '    widgetIn: function(gladeName, gladeId){',
      '      var w = __winsByName[gladeName];',
      '      if (!w) return null;',
      '      return w.querySelector(\'[data-glade-id="\' + gladeId + \'"]\');',
      '    },',
      '    widgetsIn: function(gladeName){',
      '      var w = __winsByName[gladeName];',
      '      if (!w) return {};',
      '      var out = {};',
      '      w.querySelectorAll("[data-glade-id]").forEach(function(el){',
      '        out[el.dataset.gladeId] = el;',
      '      });',
      '      return out;',
      '    },',
      '    setStatus: function(t){ document.title = "CompoGlueML — " + t; },',
      '    allWindows: function(){ return __winsById; }',
      '  };',
      '  document.querySelectorAll(".cgml-window").forEach(function(el){',
      '    var view = window.__cgmlAttach(el, handlers, {',
      '      onSignal: function(name, payload){',
      '        console.log("[cgml]", name, payload && payload.widgetId);',
      '      }',
      '    });',
      '    __views.push(view);',
      '  });',
      '  console.log("[cgml] " + __views.length + " fenêtre(s), " + Object.keys(handlers).length + " handler(s).");',
      '})();'
    ].join('\n');
  }

  function buildExportCss() {
    return [
      'html, body { margin: 0; padding: 0; min-height: 100vh; background: #2e3436;',
      '  font-family: system-ui, -apple-system, "Segoe UI", sans-serif; font-size: 13px; color: #e0e0e0; }',
      '#cgml-stage { position: relative; width: 100%; min-height: 100vh; padding: 20px; box-sizing: border-box; }',
      '.cgml-window { position: absolute; }',
      '.cgml-window .gtk-window { box-shadow: 0 8px 24px rgba(0,0,0,.35); }',
      '.cgml-window.titlebar-hidden .gtk-titlebar { display: none; }',
      '.cgml-window.titlebar-hidden .gtk-window {',
      '  border-top-left-radius: 0; border-top-right-radius: 0;',
      '}'
    ].join('\n');
  }

  function buildExportHtml() {
    if (state.windows.length === 0) {
      throw new Error('Rien à exporter : aucune fenêtre.');
    }

    const winEls = [];
    for (const win of state.windows) {
      const inner = windowToHtml(win);
      const hiddenClass = win.titlebarVisible === false ? ' titlebar-hidden' : '';

      let style = 'left:' + win.x + 'px; top:' + win.y + 'px; z-index:' + win.z + ';';
      if (win.width)  style += ' width:' + win.width + 'px;';
      if (win.height) style += ' height:' + win.height + 'px;';

      winEls.push(
        '    <div class="cgml-window' + hiddenClass + '"' +
        ' data-window-id="' + escapeAttr(win.id) + '"' +
        ' data-glade-name="' + escapeAttr(win.name) + '"' +
        ' style="' + style + '">\n' +
        '      ' + inner + '\n' +
        '    </div>'
      );
    }

    const firstRender = Glade2HTML.gladeToHtml(state.windows[0].xml);
    const m = firstRender.html.match(/<style>([\s\S]*?)<\/style>/);
    const gtkCss = m ? m[1] : '';

    const handlersJs = buildHandlersJs();
    const attachHelper = buildAttachHelper();
    const runtimeJs = buildRuntimeJs();
    const exportCss = buildExportCss();

    const html =
      '<!DOCTYPE html>\n' +
      '<html lang="fr">\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<title>' + escapeAttr(state.app.name || 'CompoGlueML Export') + '</title>\n' +
      '<style>\n' +
      '/* === Styles du canevas exporté === */\n' +
      exportCss + '\n\n' +
      '/* === Styles GTK Adwaita === */\n' +
      gtkCss + '\n' +
      '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      '<div id="cgml-stage">\n' +
      winEls.join('\n') + '\n' +
      '</div>\n\n' +
      '<script>\n' +
      '/* ==================================================================\n' +
      ' * ' + (state.app.name || 'CompoGlueML Export') + '\n' +
      ' * ' + (state.app.description || '') + '\n' +
      ' * Version : ' + (state.app.version || '0.1.0') + '\n' +
      ' * Auteur  : ' + (state.app.author || '—') + '\n' +
      ' * Exporté : ' + new Date().toISOString() + '\n' +
      ' * ' + state.windows.length + ' fenêtre(s), ' + countHandlers() + ' handler(s)\n' +
      ' * ================================================================== */\n' +
      attachHelper + '\n\n' +
      handlersJs + '\n\n' +
      runtimeJs + '\n' +
      '<\/script>\n' +
      '</body>\n' +
      '</html>\n';

    return html;
  }

  function exportToFile() {
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
    touchUpdated();
    updateInfoPanel();
  }

  btnExport.addEventListener('click', exportToFile);

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

})();