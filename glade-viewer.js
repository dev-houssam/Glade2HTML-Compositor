/* =====================================================================
 * glade-viewer.js — couche d'intégration
 * Version 0.5.0 — ajout de attach() pour brancher sur du HTML déjà rendu
 * =====================================================================
 * API publique :
 *   GladeViewer.mountInline(container, xml, options)
 *   GladeViewer.mountIframe(container, xml, options)
 *   GladeViewer.attach(container, handlers, options)
 * =====================================================================
 */
(function (global) {
  'use strict';

  /* ==================================================================
   * Bus de handlers
   * ================================================================== */
  function createBus(initialHandlers) {
    initialHandlers = initialHandlers || {};
    const listeners = {};

    function on(name, fn) {
      if (!listeners[name]) listeners[name] = [];
      listeners[name].push(fn);
      return function () { off(name, fn); };
    }
    function off(name, fn) {
      const arr = listeners[name];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
    function emit(name, payload) {
      let handled = false;
      if (typeof initialHandlers[name] === 'function') {
        initialHandlers[name](payload);
        handled = true;
      }
      const arr = listeners[name];
      if (arr && arr.length) {
        for (const fn of arr) fn(payload);
        handled = true;
      }
      return handled;
    }
    return { on: on, off: off, emit: emit };
  }

  /* ==================================================================
   * Helpers locaux
   * ================================================================== */
  const GTK_EVENT_MAP_LOCAL = {
    clicked: 'click',
    toggled: 'change',
    changed: 'input',
    activate: 'click',
    'state-set': 'change',
    value_changed: 'input',
    button_press_event: 'mousedown',
    button_release_event: 'mouseup',
    key_press_event: 'keydown',
    focus_in_event: 'focus',
    focus_out_event: 'blur'
  };

  function extractValueLocal(el, domEvent) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      if (el.type === 'checkbox' || el.type === 'radio') return el.checked;
      return el.value;
    }
    if (domEvent === 'click') return true;
    return undefined;
  }

  /**
   * Attache des listeners sur chaque élément [data-glade-handler]
   * dans le root donné. Retourne une fonction de nettoyage.
   */
  function bindHandlers(root, bus, options) {
    const elements = root.querySelectorAll('[data-glade-handler]');
    const bound = [];

    elements.forEach(function (el) {
      const handlerName = el.dataset.gladeHandler;
      if (!handlerName) return;

      const gtkSignal = el.dataset.gladeSignal || 'click';
      const domEvent = GTK_EVENT_MAP_LOCAL[gtkSignal] || 'click';
      const widgetId = el.dataset.gladeId || '';

      const listener = function (ev) {
        const payload = {
          widgetId: widgetId,
          gtkSignal: gtkSignal,
          value: extractValueLocal(el, domEvent),
          element: el,
          nativeEvent: ev
        };
        const handled = bus.emit(handlerName, payload);
        if (options && options.onSignal) options.onSignal(handlerName, payload);
        if (!handled && options && options.strict) {
          console.warn('[GladeViewer] Aucun handler pour "' + handlerName + '"');
        }
      };

      el.addEventListener(domEvent, listener);
      bound.push({ el: el, event: domEvent, listener: listener });
    });

    return function unbind() {
      for (const b of bound) {
        b.el.removeEventListener(b.event, b.listener);
      }
    };
  }

  /* ==================================================================
   * MODE 1 : INLINE
   * ================================================================== */
  function mountInline(container, xml, options) {
    options = options || {};
    if (!container) throw new Error('container requis');
    const result = global.Glade2HTML.gladeToHtml(xml);

    const doc = new DOMParser().parseFromString(result.html, 'text/html');
    const styleEl = doc.querySelector('style');
    const body = doc.body;

    container.innerHTML = '';
    container.classList.add('glade-host');
    const scope = 'g2h-' + Math.random().toString(36).slice(2, 8);
    container.classList.add(scope);

    if (styleEl) {
      const s = document.createElement('style');
      s.textContent = scopeCss(styleEl.textContent, '.' + scope);
      container.appendChild(s);
    }

    while (body.firstChild) container.appendChild(body.firstChild);

    const bus = createBus(options.handlers);

    const widgets = {};
    container.querySelectorAll('[data-glade-id]').forEach(function (el) {
      widgets[el.dataset.gladeId] = el;
    });

    const unbind = bindHandlers(container, bus, options);

    function addStyle(css) {
      const s = document.createElement('style');
      s.textContent = css;
      container.appendChild(s);
    }

    function destroy() {
      unbind();
      container.innerHTML = '';
      container.classList.remove('glade-host', scope);
    }

    return {
      mode: 'inline',
      container: container,
      rootIds: result.rootIds,
      warnings: result.warnings,
      signals: result.signals,
      widgets: widgets,
      on: bus.on,
      off: bus.off,
      emit: bus.emit,
      getWidget: function (id) { return widgets[id] || null; },
      addStyle: addStyle,
      destroy: destroy
    };
  }

  /* ==================================================================
   * MODE 2 : IFRAME
   * ================================================================== */
  function mountIframe(container, xml, options) {
    options = options || {};
    if (!container) throw new Error('container requis');
    const result = global.Glade2HTML.gladeToHtml(xml);

    let iframe = container.querySelector(':scope > iframe.glade-frame');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.className = 'glade-frame';
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
      iframe.style.border = 'none';
      iframe.style.width = '100%';
      iframe.style.height = options.height || '100%';
      iframe.style.background = 'transparent';
      container.innerHTML = '';
      container.appendChild(iframe);
    }

    const relayScript =
      '<scr' + 'ipt>\n' +
      '(function(){\n' +
      '  document.addEventListener("glade-signal", function(ev) {\n' +
      '    window.parent.postMessage({\n' +
      '      type: "glade-signal",\n' +
      '      detail: {\n' +
      '        handler: ev.detail.handler,\n' +
      '        widgetId: ev.detail.widgetId,\n' +
      '        gtkSignal: ev.detail.gtkSignal,\n' +
      '        value: ev.detail.value\n' +
      '      }\n' +
      '    }, "*");\n' +
      '  });\n' +
      '})();\n' +
      '</scr' + 'ipt>';

    const htmlWithRelay = result.html.replace('</body>', relayScript + '\n</body>');
    iframe.srcdoc = htmlWithRelay;

    const bus = createBus(options.handlers);

    const onMessage = function (e) {
      if (e.source !== iframe.contentWindow) return;
      if (!e.data || e.data.type !== 'glade-signal') return;
      const d = e.data.detail;
      const payload = {
        widgetId: d.widgetId,
        gtkSignal: d.gtkSignal,
        value: d.value,
        element: null,
        nativeEvent: null
      };
      const handled = bus.emit(d.handler, payload);
      if (options.onSignal) options.onSignal(d.handler, payload);
      if (!handled && options.strict) {
        console.warn('[GladeViewer] Aucun handler pour "' + d.handler + '"');
      }
    };
    window.addEventListener('message', onMessage);

    let widgets = {};
    iframe.addEventListener('load', function () {
      const doc = iframe.contentDocument;
      if (!doc) return;
      widgets = {};
      doc.querySelectorAll('[data-glade-id]').forEach(function (el) {
        widgets[el.dataset.gladeId] = el;
      });
      doc.addEventListener('click', function (ev) {
        const a = ev.target.closest('a');
        if (a) ev.preventDefault();
      });
    });

    function addStyle(css) {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const s = doc.createElement('style');
      s.textContent = css;
      doc.head.appendChild(s);
    }

    function destroy() {
      window.removeEventListener('message', onMessage);
      iframe.remove();
    }

    return {
      mode: 'iframe',
      container: container,
      iframe: iframe,
      rootIds: result.rootIds,
      warnings: result.warnings,
      signals: result.signals,
      get widgets() { return widgets; },
      on: bus.on,
      off: bus.off,
      emit: bus.emit,
      getWidget: function (id) { return widgets[id] || null; },
      addStyle: addStyle,
      destroy: destroy
    };
  }

  /* ==================================================================
   * Utilitaire CSS (scope)
   * ================================================================== */
  function scopeCss(css, prefix) {
    return css.replace(/(^|\})\s*([^{@]+)\{/g, function (m, brace, selector) {
      const scoped = selector.split(',').map(function (s) {
        s = s.trim();
        if (!s) return s;
        if (s.charAt(0) === '@') return s;
        if (s === 'body') return prefix;
        if (s === '*') return prefix + ' *';
        if (s === 'html') return prefix;
        return prefix + ' ' + s;
      }).join(', ');
      return brace + scoped + '{';
    });
  }

  /* ==================================================================
   * ATTACH — branchement sur du HTML déjà rendu
   * ==================================================================
   * Utilisé par le compositeur et par les fichiers .cgml.html exportés.
   * Le container doit contenir des éléments [data-glade-handler].
   * ==================================================================
   */
  function attach(container, handlers, options) {
    options = options || {};
    if (!container) throw new Error('container requis');
    const bus = createBus(handlers || {});

    // Index global de tous les widgets (id Glade → élément)
    const widgets = {};
    container.querySelectorAll('[data-glade-id]').forEach(function (el) {
      widgets[el.dataset.gladeId] = el;
    });

    // Branchement des handlers
    const unbind = bindHandlers(container, bus, options);

    return {
      container: container,
      widgets: widgets,
      getWidget: function (id) { return widgets[id] || null; },
      on: bus.on,
      off: bus.off,
      emit: bus.emit,
      destroy: function () {
        unbind();
      }
    };
  }

  /* ==================================================================
   * API publique
   * ================================================================== */
  global.GladeViewer = {
    mountInline: mountInline,
    mountIframe: mountIframe,
    attach: attach,
    version: '0.5.0'
  };

})(window);