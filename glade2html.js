/* =====================================================================
 * Glade2HTML — moteur de rendu générique
 * Version 0.6.0 — signaux multiples par widget, onglets Glade corrects, états initiaux sérialisés
 * =====================================================================
 */
(function (global) {
  'use strict';

  /* ------------------------------------------------------------------
   * 1. UTILITAIRES XML
   * ------------------------------------------------------------------ */

  function prop(node, name, def) {
    if (def === undefined) def = null;
    const p = node.querySelector(':scope > property[name="' + name + '"]');
    return p ? p.textContent : def;
  }

  function signal(node, name) {
    const s = node.querySelector(':scope > signal[name="' + name + '"]');
    return s ? s.getAttribute('handler') : null;
  }

  function children(node) {
    const out = [];
    for (const c of node.children) {
      if (c.tagName !== 'child') continue;
      const o = c.querySelector(':scope > object');
      if (o) out.push({ object: o, child: c });
    }
    return out;
  }

  function packing(childEl) {
    return childEl.querySelector(':scope > packing');
  }

  function el(tag, cls) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  function bool(v) { return v === 'True' || v === 'true'; }
  function px(v) { return (v == null || v === '') ? '' : v + 'px'; }

  /* ------------------------------------------------------------------
   * 2. MAPPING SIGNAL GTK → ÉVÉNEMENT DOM
   * ------------------------------------------------------------------ */

  const GTK_EVENT_MAP = {
    clicked:              'click',
    toggled:              'change',
    changed:              'input',
    activate:             'click',
    value_changed:        'input',
    'state-set':          'change',
    button_press_event:   'mousedown',
    button_release_event: 'mouseup',
    key_press_event:      'keydown',
    focus_in_event:       'focus',
    focus_out_event:      'blur',
    enter_notify_event:   'mouseenter',
    leave_notify_event:   'mouseleave',
    delete_event:         'close',
    switch_page:          'click',
    row_activated:        'dblclick'
  };

  function extractValue(element, domEvent) {
    const tag = element.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (element.type === 'checkbox' || element.type === 'radio') return element.checked;
      return element.value;
    }
    if (domEvent === 'click') return true;
    return undefined;
  }

  /* ------------------------------------------------------------------
   * 3. HELPERS DE STYLE GTK
   * ------------------------------------------------------------------ */

  function applyBoxProps(box, node) {
    const sp = prop(node, 'spacing');
    if (sp) box.style.gap = px(sp);
    const m = ['margin-top', 'margin-end', 'margin-bottom', 'margin-start'];
    box.style.padding = m.map(function (k) { return (prop(node, k, '0') || '0') + 'px'; }).join(' ');
  }

  function applyWidgetSize(el_, node) {
    const h = prop(node, 'height-request');
    const w = prop(node, 'width-request');
    if (h) el_.style.minHeight = px(h);
    if (w) el_.style.minWidth = px(w);
    if (prop(node, 'sensitive') === 'False') {
      el_.disabled = true;
      el_.classList.add('disabled');
    }
    if (prop(node, 'visible') === 'False') el_.style.display = 'none';
  }

  function applyPacking(el_, packingEl) {
    if (!packingEl) return;
    const expand = prop(packingEl, 'expand');
    if (bool(expand)) el_.style.flex = '1 1 0';
    if (prop(packingEl, 'fill') === 'False') el_.style.alignSelf = 'flex-start';
    const pad = prop(packingEl, 'padding');
    if (pad) el_.style.margin = px(pad);
  }

  /* ------------------------------------------------------------------
   * 4. REGISTRE DE RENDERERS PAR CLASSE GTK
   * ------------------------------------------------------------------ */

  const RENDERERS = {

    GtkWindow: function (node, ctx) {
      const win = el('div', 'gtk-window');
      win.style.width  = px(prop(node, 'default-width', '400'));
      win.style.height = px(prop(node, 'default-height', '300'));
      if (prop(node, 'resizable') === 'False') win.classList.add('fixed-size');

      const title = prop(node, 'title');
      if (title) {
        const bar = el('div', 'gtk-titlebar');
        bar.textContent = title;
        win.appendChild(bar);
      }
      const body = el('div', 'gtk-window-body');
      win.appendChild(body);
      for (const c of children(node)) {
        body.appendChild(ctx.renderChild(c.object));
      }
      return win;
    },

    GtkBox: function (node, ctx) {
      const orientation = prop(node, 'orientation', 'horizontal');
      const box = el('div', 'gtk-box ' + orientation);
      applyBoxProps(box, node);

      const homogeneous = bool(prop(node, 'homogeneous'));
      for (const c of children(node)) {
        const childEl = ctx.renderChild(c.object);
        if (homogeneous) childEl.style.flex = '1 1 0';
        applyPacking(childEl, packing(c.child));
        box.appendChild(childEl);
      }
      return box;
    },

    GtkGrid: function (node, ctx) {
      const grid = el('div', 'gtk-grid');
      grid.style.display = 'grid';
      const colSp = prop(node, 'column-spacing');
      const rowSp = prop(node, 'row-spacing');
      if (colSp) grid.style.columnGap = px(colSp);
      if (rowSp) grid.style.rowGap = px(rowSp);
      applyBoxProps(grid, node);

      for (const c of children(node)) {
        const childEl = ctx.renderChild(c.object);
        const p = c.child.querySelector(':scope > packing');
        if (p) {
          const col = prop(p, 'left-attach');
          const row = prop(p, 'top-attach');
          const w = prop(p, 'width');
          const h = prop(p, 'height');
          if (col != null) childEl.style.gridColumn = (+col + 1) + (w ? ' / span ' + w : '');
          if (row != null) childEl.style.gridRow = (+row + 1) + (h ? ' / span ' + h : '');
        }
        grid.appendChild(childEl);
      }
      return grid;
    },

    GtkFrame: function (node, ctx) {
      const frame = el('fieldset', 'gtk-frame');
      const label = prop(node, 'label');
      if (label) {
        const legend = el('legend');
        legend.textContent = label;
        frame.appendChild(legend);
      }
      for (const c of children(node)) {
        frame.appendChild(ctx.renderChild(c.object));
      }
      return frame;
    },

    GtkScrolledWindow: function (node, ctx) {
      const sw = el('div', 'gtk-scrolled');
      const h = prop(node, 'height-request');
      if (h) sw.style.maxHeight = px(h);
      for (const c of children(node)) {
        sw.appendChild(ctx.renderChild(c.object));
      }
      return sw;
    },

    GtkNotebook: function (node, ctx) {
      const nb = el('div', 'gtk-notebook');
      const tabs = el('div', 'gtk-notebook-tabs');
      const panes = el('div', 'gtk-notebook-panes');
      nb.appendChild(tabs);
      nb.appendChild(panes);

      // Association onglet ↔ page.
      //  - vrai Glade : <child type="tab"> qui suit chaque page
      //  - fichiers générés : un GtkLabel (sans type) précède chaque page
      const kids = children(node);
      const pages = [];
      const hasTabType = kids.some(function (k) { return k.type === 'tab'; });
      if (hasTabType) {
        kids.forEach(function (k) {
          if (k.type === 'tab') { if (pages.length) pages[pages.length - 1].tab = k.object; }
          else pages.push({ tab: null, page: k.object });
        });
      } else if (kids.length >= 2 && kids.length % 2 === 0 &&
                 kids.every(function (k, i) { return i % 2 === 1 || k.object.getAttribute('class') === 'GtkLabel'; })) {
        for (let i = 0; i < kids.length; i += 2) pages.push({ tab: kids[i].object, page: kids[i + 1].object });
      } else {
        kids.forEach(function (k) { pages.push({ tab: null, page: k.object }); });
      }

      pages.forEach(function (p, i) {
        const tab = el('button', 'gtk-notebook-tab');
        tab.type = 'button';
        tab.setAttribute('data-page', String(i));
        tab.textContent = p.tab ? (prop(p.tab, 'label', 'Page ' + (i + 1))) : 'Page ' + (i + 1);
        if (p.tab && p.tab.getAttribute('id')) tab.setAttribute('data-glade-id', p.tab.getAttribute('id'));
        tabs.appendChild(tab);

        const pane = el('div', 'gtk-notebook-pane');
        pane.setAttribute('data-page', String(i));
        pane.appendChild(ctx.renderChild(p.page));
        panes.appendChild(pane);

        if (i === 0) { tab.classList.add('active'); pane.classList.add('active'); }
      });
      return nb;
    },

    GtkStack: function (node, ctx) {
      const stack = el('div', 'gtk-stack');
      for (const c of children(node)) {
        stack.appendChild(ctx.renderChild(c.object));
      }
      return stack;
    },

    GtkButton: function (node, ctx) {
      const btn = el('button', 'gtk-button');
      btn.textContent = prop(node, 'label', '');
      applyWidgetSize(btn, node);

      const kids = children(node);
      if (kids.length > 0) {
        btn.textContent = '';
        for (const c of kids) {
          btn.appendChild(ctx.renderChild(c.object));
        }
      }
      return btn;
    },

    GtkToggleButton: function (node, ctx) {
      const btn = el('button', 'gtk-button gtk-toggle');
      btn.textContent = prop(node, 'label', '');
      if (bool(prop(node, 'active'))) btn.classList.add('active');
      btn.addEventListener('click', function () { btn.classList.toggle('active'); });
      return btn;
    },

    GtkCheckButton: function (node, ctx) {
      const wrap = el('label', 'gtk-check');
      const cb = el('input');
      cb.type = 'checkbox';
      if (bool(prop(node, 'active'))) cb.setAttribute('checked', '');
      const txt = el('span');
      txt.textContent = prop(node, 'label', '');
      wrap.appendChild(cb);
      wrap.appendChild(txt);
      return wrap;
    },

    GtkRadioButton: function (node, ctx) {
      const wrap = el('label', 'gtk-radio');
      const r = el('input');
      r.type = 'radio';

      const id = node.getAttribute('id');
      const groupName = id && ctx.radioGroups ? ctx.radioGroups[id] : null;
      if (groupName) r.name = groupName;

      if (bool(prop(node, 'active'))) r.setAttribute('checked', '');

      const txt = el('span');
      txt.textContent = prop(node, 'label', '');
      wrap.appendChild(r);
      wrap.appendChild(txt);
      return wrap;
    },

    GtkSwitch: function (node, ctx) {
      const wrap = el('label', 'gtk-switch');
      const cb = el('input');
      cb.type = 'checkbox';
      if (bool(prop(node, 'active'))) cb.setAttribute('checked', '');
      wrap.appendChild(cb);
      return wrap;
    },

    GtkLabel: function (node) {
      const l = el('span', 'gtk-label');
      const label = prop(node, 'label', '');
      if (bool(prop(node, 'use-markup'))) l.innerHTML = label;
      else l.textContent = label;

      const align = prop(node, 'xalign');
      if (align != null) {
        l.style.textAlign = align === '0' ? 'left' : align === '1' ? 'right' : 'center';
        l.style.display = 'inline-block';
        l.style.width = '100%';
      }
      applyWidgetSize(l, node);

      const scale = node.querySelector('attributes > attribute[name="scale"]');
      if (scale) l.style.fontSize = (parseFloat(scale.getAttribute('value')) * 14) + 'px';
      const weight = node.querySelector('attributes > attribute[name="weight"]');
      if (weight && weight.getAttribute('value') === 'bold') l.style.fontWeight = 'bold';
      return l;
    },

    GtkEntry: function (node, ctx) {
      const input = el('input', 'gtk-entry');
      input.type = 'text';
      if (prop(node, 'editable') === 'False') input.readOnly = true;
      if (prop(node, 'placeholder-text')) input.placeholder = prop(node, 'placeholder-text');
      if (prop(node, 'text')) input.setAttribute('value', prop(node, 'text'));
      if (prop(node, 'visibility') === 'False') input.type = 'password';
      if (prop(node, 'xalign') === '0') input.style.textAlign = 'left';
      if (prop(node, 'xalign') === '1') input.style.textAlign = 'right';
      applyWidgetSize(input, node);
      return input;
    },

    GtkTextView: function (node) {
      const ta = el('textarea', 'gtk-textview');
      applyWidgetSize(ta, node);
      return ta;
    },

    GtkComboBoxText: function (node) {
      const sel = el('select', 'gtk-combo');

      // Cas 1 : <items><item>texte</item></items>
      const itemsEl = node.querySelector(':scope > items');
      if (itemsEl) {
        const itemEls = itemsEl.querySelectorAll(':scope > item');
        for (const itemEl of itemEls) {
          const opt = el('option');
          opt.textContent = itemEl.textContent.trim();
          sel.appendChild(opt);
        }
      }

      // Cas 2 : <child><object>...</object></child>
      for (const c of children(node)) {
        const cls = c.object.getAttribute('class');
        if (cls === 'GtkCellRendererText' || cls === 'GtkCellRendererPixbuf') continue;
        const opt = el('option');
        opt.textContent = prop(c.object, 'label', c.object.textContent.trim());
        sel.appendChild(opt);
      }

      const act = parseInt(prop(node, 'active', '0'), 10);
      const opts = sel.querySelectorAll('option');
      if (act >= 0 && opts[act]) opts[act].setAttribute('selected', '');
      applyWidgetSize(sel, node);
      return sel;
    },

    GtkComboBox: function (node, ctx) {
      return RENDERERS.GtkComboBoxText(node, ctx);
    },

    GtkMenuButton: function (node) {
      const b = el('button', 'gtk-button');
      b.textContent = prop(node, 'label', '▾');
      return b;
    },

    GtkProgressBar: function (node) {
      const wrap = el('div', 'gtk-progress');
      const inner = el('div', 'gtk-progress-fill');
      const frac = parseFloat(prop(node, 'fraction', '0')) || 0;
      inner.style.width = (frac * 100) + '%';
      wrap.appendChild(inner);
      return wrap;
    },

    GtkSeparator: function (node) {
      const sep = el('div', 'gtk-separator');
      const orient = prop(node, 'orientation', 'horizontal');
      sep.classList.add(orient);
      return sep;
    },

    GtkImage: function (node) {
      const img = el('img', 'gtk-image');
      const iconName = prop(node, 'icon-name');
      const fileName = prop(node, 'file');
      if (fileName) {
        img.src = 'file://' + fileName;
      } else if (iconName) {
        const ph = el('span', 'gtk-icon');
        ph.textContent = iconName;
        return ph;
      }
      return img;
    },

    GtkSpinner: function () { return el('div', 'gtk-spinner'); },

    GtkLinkButton: function (node) {
      const a = el('a', 'gtk-link');
      a.textContent = prop(node, 'label', prop(node, 'uri', ''));
      a.href = prop(node, 'uri', '#');
      return a;
    },

    GtkEventBox: function (node, ctx) {
      const d = el('div', 'gtk-eventbox');
      for (const c of children(node)) {
        d.appendChild(ctx.renderChild(c.object));
      }
      return d;
    },

    GtkExpander: function (node, ctx) {
      const det = el('details', 'gtk-expander');
      const sum = el('summary');
      sum.textContent = prop(node, 'label', '');
      det.appendChild(sum);
      for (const c of children(node)) {
        det.appendChild(ctx.renderChild(c.object));
      }
      if (bool(prop(node, 'expanded'))) det.open = true;
      return det;
    },

    GtkCellRendererText: function () { return null; },
    GtkCellRendererPixbuf: function () { return null; }
  };

  /* ------------------------------------------------------------------
   * 5. CONTEXTE DE RENDU
   * ------------------------------------------------------------------ */

  function createContext(rootDoc) {
    const ctx = {
      warnings: [],
      signals: [],
      radioGroups: {},

      registerSignal: function (element, domEvent, handlerName) {
        if (!element.__gladeSignals) element.__gladeSignals = [];
        element.__gladeSignals.push({ domEvent: domEvent, handlerName: handlerName });
      },

      renderChild: function (objectNode) {
        const rendered = renderObject(objectNode, ctx);
        if (!rendered) return document.createComment('ignored');
        const id = objectNode.getAttribute('id');
        if (id) rendered.dataset.gladeId = id;
        return rendered;
      }
    };

    // Pré-calcul des groupes radio
    if (rootDoc) {
      const radios = rootDoc.querySelectorAll('object[class="GtkRadioButton"]');

      // Passe 1 : roots (pas de <group>)
      for (const r of radios) {
        const id = r.getAttribute('id');
        if (!id) continue;
        const groupEl = r.querySelector(':scope > property[name="group"]');
        if (!groupEl) {
          ctx.radioGroups[id] = 'grp_' + id;
        }
      }

      // Passe 2 : propager
      let changed = true;
      let safety = 10;
      while (changed && safety-- > 0) {
        changed = false;
        for (const r of radios) {
          const id = r.getAttribute('id');
          if (!id) continue;
          if (ctx.radioGroups[id]) continue;
          const groupEl = r.querySelector(':scope > property[name="group"]');
          if (!groupEl) continue;
          const parentId = groupEl.textContent.trim();
          if (ctx.radioGroups[parentId]) {
            ctx.radioGroups[id] = ctx.radioGroups[parentId];
            changed = true;
          }
        }
      }
    }

    return ctx;
  }

  /* ------------------------------------------------------------------
   * 6. RENDU RÉCURSIF
   * ------------------------------------------------------------------ */

  /** Traduit un signal GTK en événement DOM selon la classe du widget. */
  function signalSpec(cls, name) {
    const n = String(name || '').replace(/_/g, '-');
    switch (n) {
      case 'clicked': case 'pressed': return { e: 'click' };
      case 'activate':
        if (/Entry|SpinButton/.test(cls)) return { e: 'keydown', k: 'Enter' };
        if (cls === 'GtkExpander') return { e: 'toggle' };
        return { e: 'click' };
      case 'toggled': case 'state-set': case 'notify::active':
        return { e: cls === 'GtkToggleButton' ? 'click' : 'change' };
      case 'changed':
        return { e: /^GtkComboBox/.test(cls) ? 'change' : 'input' };
      case 'value-changed': return { e: 'input' };
      case 'switch-page': return { e: 'g2h-switch-page' };
      case 'notify::expanded': return { e: 'toggle' };
      case 'button-press-event': return { e: 'mousedown' };
      case 'button-release-event': return { e: 'mouseup' };
      case 'key-press-event': return { e: 'keydown' };
      case 'key-release-event': return { e: 'keyup' };
      case 'focus-in-event': return { e: 'focus' };
      case 'focus-out-event': return { e: 'blur' };
      case 'enter-notify-event': return { e: 'mouseenter' };
      case 'leave-notify-event': return { e: 'mouseleave' };
      case 'row-activated': return { e: 'dblclick' };
    }
    return null;
  }

  function renderObject(node, ctx) {
    const cls = node.getAttribute('class');
    const renderer = RENDERERS[cls];
    let rendered;

    if (!renderer) {
      ctx.warnings.push('Widget non supporté : ' + cls);
      rendered = el('div', 'gtk-unsupported');
      rendered.textContent = '⚠ ' + cls;
      rendered.title = 'Widget GTK non pris en charge';
      for (const c of children(node)) {
        rendered.appendChild(ctx.renderChild(c.object));
      }
    } else {
      rendered = renderer(node, ctx);
      if (!rendered) return null;
      applyWidgetSize(rendered, node);
    }

    const id = node.getAttribute('id') || '';
    if (id) rendered.setAttribute('data-glade-id', id);

    // Tous les <signal> du widget, sérialisés dans UN attribut JSON.
    // (L'ancienne version n'en gardait qu'un par élément.)
    const specs = [];
    for (const s of node.querySelectorAll(':scope > signal')) {
      const h = s.getAttribute('handler');
      if (!h) continue;
      const gtkName = s.getAttribute('name');
      const sp = signalSpec(cls, gtkName);
      ctx.signals.push({
        handlerName: h,
        widgetId: id,
        widgetClass: cls,
        gtkSignal: gtkName,
        event: sp ? sp.e : null,
        key: sp && sp.k ? sp.k : null
      });
      if (sp) specs.push({ s: gtkName, h: h, e: sp.e, k: sp.k || undefined });
    }
    if (specs.length) {
      rendered.setAttribute('data-glade-signals', JSON.stringify(specs));
      rendered.setAttribute('data-glade-handler', specs[0].h);   // compat ancienne API
      rendered.setAttribute('data-glade-signal', specs[0].s);
    }
    return rendered;
  }

  /* ------------------------------------------------------------------
   * 7. FEUILLE DE STYLE GTK ADWAITA
   * ------------------------------------------------------------------ */

  const GTK_CSS = `
    *, *::before, *::after { box-sizing: border-box; }
    body {
      margin: 0; padding: 20px;
      display: flex; align-items: flex-start; justify-content: center;
      background: #2e3436;
      font-family: "Cantarell", "Segoe UI", system-ui, sans-serif;
      font-size: 14px;
      color: #2e3436;
    }

    /* ============================================================
     * Fenêtre GTK
     * ============================================================ */
    .gtk-window {
      background: #fff;
      border: 1px solid #d4d0c8;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,.25);
      display: inline-flex;
      flex-direction: column;
      max-width: 100%;
      overflow: hidden;
    }
    .gtk-titlebar {
      background: linear-gradient(#f8f7f6, #eae8e6);
      border-bottom: 1px solid #d4d0c8;
      padding: 8px 12px;
      text-align: center;
      font-weight: 600;
      flex: 0 0 auto;
    }
    .gtk-window-body {
      padding: 10px;
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
    }
    .gtk-window-body::-webkit-scrollbar { width: 8px; }
    .gtk-window-body::-webkit-scrollbar-thumb {
      background: #c8c4bf; border-radius: 4px;
    }
    .gtk-window-body::-webkit-scrollbar-track { background: transparent; }

    /* ============================================================
     * Layout
     * ============================================================ */
    .gtk-box { display: flex; }
    .gtk-box.vertical   { flex-direction: column; }
    .gtk-box.horizontal { flex-direction: row; }

    /* === Enfants de GtkBox : comportement flex approprié === */
    /* Les boutons, combos, checks, radios ne se compressent pas */
    .gtk-box > .gtk-button,
    .gtk-box > .gtk-combo,
    .gtk-box > .gtk-check,
    .gtk-box > .gtk-radio,
    .gtk-box > .gtk-switch {
      flex-shrink: 0;
    }
    /* Les entrées ont une largeur minimale garantie mais peuvent s'étendre */
    .gtk-box > .gtk-entry,
    .gtk-box > .gtk-textview {
      min-width: 100px;
      flex-grow: 1;
      flex-shrink: 1;
    }

    /* ============================================================
     * Boutons
     * ============================================================ */
    .gtk-button {
      background: linear-gradient(#fdfdfc, #f0eeec);
      border: 1px solid #cdc7c1;
      border-radius: 5px;
      padding: 4px 10px;
      font: inherit;
      cursor: pointer;
      min-height: 30px;
      color: inherit;
      transition: background .1s;
    }
    .gtk-button:hover  { background: linear-gradient(#fff, #f6f5f4); }
    .gtk-button:active { background: #dcd9d6; }
    .gtk-button.disabled { opacity: .5; pointer-events: none; }

    /* ============================================================
     * Labels
     * ============================================================ */
    .gtk-label { display: inline-block; }

    /* ============================================================
     * Entrées / TextArea
     * ============================================================ */
    .gtk-entry, .gtk-textview {
      background: #fff;
      border: 1px solid #c0bdb8;
      border-radius: 5px;
      padding: 6px 10px;
      font: inherit;
      outline: none;
      min-height: 30px;
      color: #2e3436;
      width: 100%;
      box-sizing: border-box;
    }
    .gtk-entry:focus, .gtk-textview:focus {
      border-color: #3584e4;
      box-shadow: 0 0 0 2px rgba(53,132,228,.25);
    }
    .gtk-entry[readonly] { background: #fafafa; }

    /* ============================================================
     * Combos
     * ============================================================ */
    .gtk-combo {
      -webkit-appearance: none;
      -moz-appearance: none;
      appearance: none;
      background-color: #fff;
      background-image:
        linear-gradient(45deg, transparent 50%, #666 50%),
        linear-gradient(135deg, #666 50%, transparent 50%),
        linear-gradient(to right, #d4d0c8, #d4d0c8);
      background-position:
        calc(100% - 14px) 50%,
        calc(100% - 9px)  50%,
        calc(100% - 28px) 50%;
      background-size:
        5px 5px,
        5px 5px,
        1px 60%;
      background-repeat: no-repeat;
      border: 1px solid #c0bdb8;
      border-radius: 5px;
      padding: 6px 32px 6px 10px;
      font: inherit;
      color: #2e3436;
      cursor: pointer;
      outline: none;
      min-height: 30px;
      min-width: 100px;
      width: auto;
    }
    .gtk-combo:hover  { background-color: #f8f8f8; }
    .gtk-combo:focus  {
      border-color: #3584e4;
      box-shadow: 0 0 0 2px rgba(53,132,228,.25);
    }
    .gtk-combo option {
      background: #fff;
      color: #2e3436;
      padding: 4px;
    }

    /* ============================================================
     * Check / Radio / Switch — reset + style custom
     * ============================================================ */
    .gtk-check input[type="checkbox"],
    .gtk-radio input[type="radio"],
    .gtk-switch input[type="checkbox"] {
      -webkit-appearance: none;
      appearance: none;
      width: 16px;
      height: 16px;
      margin: 0;
      padding: 0;
      border: 1px solid #b8b4ae;
      background: #fff;
      cursor: pointer;
      flex: 0 0 auto;
      position: relative;
      transition: background .1s, border-color .1s;
      vertical-align: middle;
    }
    .gtk-check input[type="checkbox"],
    .gtk-switch input[type="checkbox"] { border-radius: 3px; }
    .gtk-radio input[type="radio"]     { border-radius: 50%; }

    .gtk-check input[type="checkbox"]:hover,
    .gtk-radio input[type="radio"]:hover,
    .gtk-switch input[type="checkbox"]:hover {
      border-color: #8a8a8a;
      background: #fafafa;
    }

    .gtk-check input[type="checkbox"]:checked,
    .gtk-switch input[type="checkbox"]:checked {
      background: #3584e4;
      border-color: #3584e4;
    }
    .gtk-check input[type="checkbox"]:checked::after,
    .gtk-switch input[type="checkbox"]:checked::after {
      content: "";
      position: absolute;
      left: 4px;
      top: 1px;
      width: 5px;
      height: 9px;
      border: solid #fff;
      border-width: 0 2px 2px 0;
      transform: rotate(45deg);
    }

    .gtk-radio input[type="radio"]:checked {
      background: #3584e4;
      border-color: #3584e4;
    }
    .gtk-radio input[type="radio"]:checked::after {
      content: "";
      position: absolute;
      left: 4px;
      top: 4px;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #fff;
    }

    .gtk-check, .gtk-radio, .gtk-switch {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      padding: 3px 0;
      font-size: 13px;
      user-select: none;
    }
    .gtk-check span, .gtk-radio span { line-height: 1.2; }

    /* ============================================================
     * Frame
     * ============================================================ */
    .gtk-frame {
      border: 1px solid #cdc7c1;
      border-radius: 6px;
      padding: 12px 14px 14px;
      margin: 4px 0;
      min-width: 0;
    }
    .gtk-frame > legend {
      padding: 0 8px;
      font-weight: 600;
      font-size: 12px;
      color: #4a4a4a;
      margin-left: 4px;
    }

    /* ============================================================
     * Notebook
     * ============================================================ */
    .gtk-notebook-tabs {
      display: flex;
      border-bottom: 1px solid #cdc7c1;
      flex: 0 0 auto;
    }
    .gtk-notebook-tab {
      background: transparent;
      border: none;
      padding: 6px 14px;
      cursor: pointer;
      font: inherit;
      border-bottom: 2px solid transparent;
      color: #666;
    }
    .gtk-notebook-tab.active {
      border-color: #3584e4;
      color: #3584e4;
    }
    .gtk-notebook-panes { flex: 1 1 auto; overflow: auto; }
    .gtk-notebook-pane { display: none; padding: 10px; }
    .gtk-notebook-pane.active { display: block; }

    /* ============================================================
     * Séparateur
     * ============================================================ */
    .gtk-separator.horizontal { height: 1px; background: #d4d0c8; margin: 6px 0; }
    .gtk-separator.vertical   { width: 1px; background: #d4d0c8; margin: 0 6px; }

    /* ============================================================
     * Barre de progression
     * ============================================================ */
    .gtk-progress {
      background: #e0ddd8;
      border-radius: 4px;
      height: 8px;
      overflow: hidden;
      min-width: 100px;
    }
    .gtk-progress-fill {
      height: 100%;
      background: #3584e4;
      transition: width .2s;
    }

    /* ============================================================
     * Expander
     * ============================================================ */
    .gtk-expander > summary {
      cursor: pointer;
      padding: 4px 0;
      font-weight: 600;
      font-size: 12px;
      color: #555;
      list-style: none;
    }
    .gtk-expander > summary::-webkit-details-marker { display: none; }
    .gtk-expander > summary::before {
      content: "▸";
      display: inline-block;
      width: 14px;
      transition: transform .15s;
    }
    .gtk-expander[open] > summary::before { transform: rotate(90deg); }

    /* ============================================================
     * ScrolledWindow
     * ============================================================ */
    .gtk-scrolled {
      overflow: auto;
      max-height: 400px;
    }
    .gtk-scrolled > .gtk-box { min-height: 0; }

    /* ============================================================
     * Grid
     * ============================================================ */
    .gtk-grid { display: grid; }

    /* ============================================================
     * Widgets non supportés
     * ============================================================ */
    .gtk-unsupported {
      border: 1px dashed #d75a4a;
      color: #d75a4a;
      padding: 6px 8px;
      border-radius: 4px;
      font-size: 12px;
    }

    /* ============================================================
     * Icônes (fallback)
     * ============================================================ */
    .gtk-icon { font-style: italic; color: #7a7a7a; }
  `;

  /* ------------------------------------------------------------------
   * 8. FONCTION PRINCIPALE
   * ------------------------------------------------------------------ */

  /** Comportements purs-DOM que le HTML sérialisé ne peut pas porter. */
  function wireStatic(root) {
    if (!root || root.__g2hWired) return;
    root.__g2hWired = true;
    root.addEventListener('click', function (ev) {
      const tab = ev.target.closest && ev.target.closest('.gtk-notebook-tab');
      if (tab) {
        const nb = tab.closest('.gtk-notebook');
        const idx = tab.getAttribute('data-page');
        nb.querySelectorAll(':scope > .gtk-notebook-tabs > .gtk-notebook-tab, :scope > .gtk-notebook-panes > .gtk-notebook-pane')
          .forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-page') === idx); });
        nb.dispatchEvent(new CustomEvent('g2h-switch-page', { detail: { page: +idx } }));
      }
      const tg = ev.target.closest && ev.target.closest('.gtk-toggle');
      if (tg) tg.classList.toggle('active');
    }, true);
  }
  const WIRE_SCRIPT = '(' + function () {
    document.addEventListener('click', function (ev) {
      var tab = ev.target.closest && ev.target.closest('.gtk-notebook-tab');
      if (tab) {
        var nb = tab.closest('.gtk-notebook'), idx = tab.getAttribute('data-page');
        nb.querySelectorAll('.gtk-notebook-tab, .gtk-notebook-pane').forEach(function (n) {
          n.classList.toggle('active', n.getAttribute('data-page') === idx);
        });
      }
      var tg = ev.target.closest && ev.target.closest('.gtk-toggle');
      if (tg) tg.classList.toggle('active');
    }, true);
  } + ')();';

  function gladeToHtml(gladeXml) {
    if (typeof gladeXml !== 'string' || !gladeXml.trim()) {
      throw new Error("Entrée vide : fournissez le contenu d'un fichier .glade");
    }
    const xml = gladeXml.replace(/^\uFEFF/, '').trim();
    if (!/^<\?xml|^<interface\b/.test(xml)) {
      throw new Error("Ce n'est pas un fichier Glade (doit commencer par <interface> ou <?xml)");
    }

    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const err = doc.querySelector('parsererror');
    if (err) {
      throw new Error('XML invalide : ' + err.textContent.replace(/\s+/g, ' ').trim());
    }

    const rootObjects = [];
    const roots = doc.querySelectorAll('interface > object');
    for (const r of roots) rootObjects.push(r);
    if (!rootObjects.length) throw new Error('Aucun <object> racine trouvé');

    const staging = document.implementation.createHTMLDocument('glade-render');
    const ctx = createContext(doc);
    const rootIds = [];

    for (const rootObj of rootObjects) {
      const rendered = renderObject(rootObj, ctx);
      if (!rendered) continue;
      staging.body.appendChild(rendered);
      const id = rootObj.getAttribute('id');
      if (id) rootIds.push(id);
    }

    const fragment = staging.body.innerHTML;
    const html = '<!DOCTYPE html>\n' +
      '<html>\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<style>' + GTK_CSS + '</style>\n' +
      '</head>\n' +
      '<body>\n' +
      fragment + '\n' +
      '<scr' + 'ipt>' + WIRE_SCRIPT + '<\/scr' + 'ipt>\n' +
      '</body>\n' +
      '</html>';

    return {
      html: html,
      fragment: fragment,
      css: GTK_CSS,
      warnings: ctx.warnings,
      rootIds: rootIds,
      signals: ctx.signals
    };
  }

  /* ------------------------------------------------------------------
   * 9. EXPORT
   * ------------------------------------------------------------------ */

  const api = {
    gladeToHtml: gladeToHtml,
    wireStatic: wireStatic,
    RENDERERS: RENDERERS,
    registerRenderer: function (cls, fn) { RENDERERS[cls] = fn; },
    version: '0.6.0'
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Glade2HTML = api;

})(typeof window !== 'undefined' ? window : globalThis);