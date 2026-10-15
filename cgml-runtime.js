/* =====================================================================
 * cgml-runtime.js — runtime CompoGlueML
 * Version 1.0.0
 * =====================================================================
 * UNE seule source de vérité, utilisée :
 *   - par l'aperçu « ▶ Tester » du compositeur
 *   - par les fichiers .cgml.html exportés (le code de CGML_FACTORY y est
 *     embarqué tel quel : ce qui marche dans l'aperçu marche à l'export)
 *
 * IMPORTANT : CGML_FACTORY doit rester autonome (aucune référence à une
 * variable extérieure), car il est sérialisé avec .toString().
 *
 * API exposée aux handlers
 * ------------------------
 *   function on_xxx(payload) { ... }          // payload :
 *     payload.value        valeur courante (case, champ, liste, onglet…)
 *     payload.widgetId     id Glade du widget source
 *     payload.element      élément DOM source
 *     payload.window       contexte de la fenêtre source (voir plus bas)
 *     payload.$('id')      raccourci : widget de la fenêtre source
 *   app                                       // disponible partout
 *     app.state            objet partagé entre tous les handlers
 *     app.window(réf)      contexte de fenêtre (id « w2 », nom de fichier, id Glade)
 *     app.widget(fen, id)  élément d'une autre fenêtre
 *     app.openWindow / closeWindow / toggleWindow (réf)
 *     app.api.<nom>.<méthode>()   APIs intégrées, locales, externes
 *     app.on / app.emit    bus d'événements entre fenêtres
 *     app.status(txt) app.toast(txt) app.log/warn/error(...) app.addStyle(css)
 *   Composer                                  // compat. anciens handlers
 *     Composer.widget(id) widgetIn(fen,id) widgetsIn(fen) openWindow(réf) …
 * ===================================================================== */
window.CGML_FACTORY = function (global) {
  'use strict';

  var doc = global.document;
  var VERSION = '1.0.0';
  var IDENT = /^[A-Za-z_$][\w$]*$/;

  /* ------------------------------------------------------------------
   * Utilitaires
   * ------------------------------------------------------------------ */
  function slug(s) {
    return String(s || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'app';
  }
  function fmt(args) {
    return Array.prototype.map.call(args, function (a) {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return a.name + ': ' + a.message;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' ');
  }
  function q(id) { return String(id).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }

  /* ------------------------------------------------------------------
   * Valeurs des widgets
   * ------------------------------------------------------------------ */
  function inputOf(el) {
    if (!el) return null;
    var t = el.tagName;
    if (t === 'INPUT' || t === 'SELECT' || t === 'TEXTAREA') return el;
    return el.querySelector('input,select,textarea');
  }
  function getValue(el) {
    if (!el) return undefined;
    if (el.classList.contains('gtk-notebook')) {
      var at = el.querySelector('.gtk-notebook-tab.active');
      return at ? +at.getAttribute('data-page') : 0;
    }
    if (el.classList.contains('gtk-toggle')) return el.classList.contains('active');
    if (el.classList.contains('gtk-progress')) {
      var f = el.querySelector('.gtk-progress-fill');
      return f ? parseFloat(f.style.width) / 100 || 0 : 0;
    }
    var inp = inputOf(el);
    if (inp) {
      if (inp.type === 'checkbox' || inp.type === 'radio') return inp.checked;
      if (inp.type === 'number' || inp.type === 'range') return inp.value === '' ? null : Number(inp.value);
      return inp.value;
    }
    return el.textContent;
  }
  function setValue(el, v) {
    if (!el) return;
    if (el.classList.contains('gtk-notebook')) {
      var idx = String(v);
      el.querySelectorAll(':scope > .gtk-notebook-tabs > .gtk-notebook-tab, :scope > .gtk-notebook-panes > .gtk-notebook-pane')
        .forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-page') === idx); });
      return;
    }
    if (el.classList.contains('gtk-toggle')) { el.classList.toggle('active', !!v); return; }
    if (el.classList.contains('gtk-progress')) {
      var f = el.querySelector('.gtk-progress-fill');
      if (f) f.style.width = Math.max(0, Math.min(1, Number(v) || 0)) * 100 + '%';
      return;
    }
    var inp = inputOf(el);
    if (inp) {
      if (inp.type === 'checkbox' || inp.type === 'radio') inp.checked = !!v;
      else inp.value = v == null ? '' : v;
      return;
    }
    el.textContent = v == null ? '' : v;
  }

  /* ------------------------------------------------------------------
   * Styles du runtime (injectés une fois)
   * ------------------------------------------------------------------ */
  var RUNTIME_CSS =
    '.cgml-hidden{display:none!important}' +
    '.cgml-toast-host{position:fixed;right:16px;bottom:16px;display:flex;flex-direction:column;gap:8px;z-index:2147483000;pointer-events:none}' +
    '.cgml-toast{background:#2b2b2b;color:#fff;font:13px system-ui,sans-serif;padding:9px 14px;border-radius:8px;' +
    'box-shadow:0 6px 20px rgba(0,0,0,.35);opacity:0;transform:translateY(6px);transition:opacity .15s,transform .15s;max-width:340px}' +
    '.cgml-toast.on{opacity:1;transform:none}';

  /* ------------------------------------------------------------------
   * APIs intégrées
   * ------------------------------------------------------------------ */
  var BUILTIN_DOC = {
    storage: ['get(key, défaut)', 'set(key, valeur)', 'remove(key)', 'keys()', 'clear()'],
    ui: ['toast(msg, ms)', 'alert(msg)', 'confirm(msg)', 'prompt(msg, défaut)'],
    files: ['download(nom, contenu, mime)', 'pick({accept, multiple, as})'],
    clipboard: ['write(texte)', 'read()'],
    util: ['sleep(ms)', 'uuid()', 'now()', 'format(date, options)', 'debounce(fn, ms)']
  };

  function makeBuiltins(app, meta) {
    var prefix = 'cgml:' + slug(meta && meta.name) + ':';
    var mem = {};
    function store() {
      try { var t = '__cgml_t'; global.localStorage.setItem(t, '1'); global.localStorage.removeItem(t); return global.localStorage; }
      catch (e) { return null; }
    }
    var ls = store();

    var storage = {
      get: function (k, def) {
        var raw = ls ? ls.getItem(prefix + k) : (k in mem ? mem[k] : null);
        if (raw == null) return def === undefined ? null : def;
        try { return JSON.parse(raw); } catch (e) { return raw; }
      },
      set: function (k, v) {
        var raw = JSON.stringify(v);
        if (ls) ls.setItem(prefix + k, raw); else mem[k] = raw;
        return v;
      },
      remove: function (k) { if (ls) ls.removeItem(prefix + k); else delete mem[k]; },
      keys: function () {
        if (!ls) return Object.keys(mem);
        var out = [];
        for (var i = 0; i < ls.length; i++) {
          var k = ls.key(i);
          if (k.indexOf(prefix) === 0) out.push(k.slice(prefix.length));
        }
        return out;
      },
      clear: function () { storage.keys().forEach(storage.remove); }
    };

    var toastHost = null;
    var ui = {
      toast: function (msg, ms) {
        if (!toastHost || !toastHost.parentNode) {
          toastHost = doc.createElement('div');
          toastHost.className = 'cgml-toast-host';
          doc.body.appendChild(toastHost);
        }
        var t = doc.createElement('div');
        t.className = 'cgml-toast';
        t.textContent = String(msg);
        toastHost.appendChild(t);
        global.setTimeout(function () { t.classList.add('on'); }, 10);
        global.setTimeout(function () {
          t.classList.remove('on');
          global.setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 200);
        }, ms || 2500);
      },
      alert: function (m) { return global.alert(m); },
      confirm: function (m) { return global.confirm(m); },
      prompt: function (m, d) { return global.prompt(m, d); }
    };

    var files = {
      download: function (name, content, mime) {
        var blob = new global.Blob([content], { type: (mime || 'text/plain') + ';charset=utf-8' });
        var url = global.URL.createObjectURL(blob);
        var a = doc.createElement('a');
        a.href = url; a.download = name || 'fichier.txt';
        doc.body.appendChild(a); a.click(); doc.body.removeChild(a);
        global.setTimeout(function () { global.URL.revokeObjectURL(url); }, 1000);
      },
      pick: function (opts) {
        opts = opts || {};
        return new Promise(function (resolve, reject) {
          var inp = doc.createElement('input');
          inp.type = 'file';
          if (opts.accept) inp.accept = opts.accept;
          if (opts.multiple) inp.multiple = true;
          inp.onchange = function () {
            var list = Array.prototype.slice.call(inp.files);
            var as = opts.as || 'text';
            Promise.all(list.map(function (f) {
              return new Promise(function (res, rej) {
                var r = new global.FileReader();
                r.onerror = function () { rej(r.error); };
                r.onload = function () {
                  var out = r.result;
                  if (as === 'json') { try { out = JSON.parse(out); } catch (e) { return rej(e); } }
                  res({ name: f.name, size: f.size, type: f.type, data: out });
                };
                if (as === 'dataurl') r.readAsDataURL(f); else r.readAsText(f);
              });
            })).then(function (arr) { resolve(opts.multiple ? arr : arr[0] || null); }, reject);
          };
          inp.click();
        });
      }
    };

    var clipboard = {
      write: function (text) {
        if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
          return global.navigator.clipboard.writeText(String(text));
        }
        return new Promise(function (resolve, reject) {
          var ta = doc.createElement('textarea');
          ta.value = String(text); doc.body.appendChild(ta); ta.select();
          var ok = false;
          try { ok = doc.execCommand('copy'); } catch (e) { /* ignoré */ }
          doc.body.removeChild(ta);
          ok ? resolve() : reject(new Error('Copie impossible'));
        });
      },
      read: function () {
        if (global.navigator.clipboard && global.navigator.clipboard.readText) return global.navigator.clipboard.readText();
        return Promise.reject(new Error('Lecture du presse-papiers non disponible'));
      }
    };

    var util = {
      sleep: function (ms) { return new Promise(function (r) { global.setTimeout(r, ms); }); },
      uuid: function () {
        if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
        });
      },
      now: function () { return new Date().toISOString(); },
      format: function (d, o) { return new Date(d || Date.now()).toLocaleString('fr-FR', o); },
      debounce: function (fn, ms) {
        var t; return function () { var a = arguments, s = this; global.clearTimeout(t); t = global.setTimeout(function () { fn.apply(s, a); }, ms || 200); };
      }
    };

    return { storage: storage, ui: ui, files: files, clipboard: clipboard, util: util };
  }

  /* ------------------------------------------------------------------
   * APIs HTTP (locales ou externes) et APIs JS
   * ------------------------------------------------------------------ */
  function authHeaders(auth) {
    if (!auth || !auth.type || auth.type === 'none') return {};
    if (auth.type === 'bearer' && auth.token) return { Authorization: 'Bearer ' + auth.token };
    if (auth.type === 'header' && auth.headerName) {
      var h = {}; h[auth.headerName] = auth.token || ''; return h;
    }
    return {};
  }

  function makeHttpApi(cfg, log) {
    var api = {};

    function buildUrl(path, args) {
      var used = {};
      var p = String(path || '').replace(/\{(\w+)\}/g, function (m, k) {
        used[k] = 1;
        return args[k] == null ? '' : encodeURIComponent(args[k]);
      });
      var url;
      if (/^https?:\/\//i.test(p)) url = p;
      else {
        var base = String(cfg.baseUrl || '').replace(/\/+$/, '');
        url = base + (p && p.charAt(0) !== '/' && p.charAt(0) !== '?' ? '/' : '') + p;
      }
      return { url: url, used: used };
    }

    function parseMock(ep) {
      if (ep && ep.mock) { try { return JSON.parse(ep.mock); } catch (e) { return ep.mock; } }
      return null;
    }

    async function request(method, path, args, opts, ep) {
      args = args || {}; opts = opts || {};
      method = String(method || 'GET').toUpperCase();

      if (cfg.mock) {
        log('api', '[mock] ' + cfg.name + ' ' + method + ' ' + path);
        await new Promise(function (r) { global.setTimeout(r, 150); });
        return parseMock(ep);
      }

      var b = buildUrl(path, args);
      var rest = {};
      Object.keys(args).forEach(function (k) {
        if (!b.used[k] && k !== 'body' && k !== 'headers') rest[k] = args[k];
      });
      var headers = Object.assign({ Accept: 'application/json' }, cfg.headers || {}, authHeaders(cfg.auth), args.headers || {}, opts.headers || {});
      var init = { method: method, headers: headers };
      var url = b.url;

      if (method === 'GET' || method === 'DELETE' || method === 'HEAD') {
        var qs = new global.URLSearchParams();
        Object.keys(rest).forEach(function (k) {
          if (rest[k] != null) qs.append(k, typeof rest[k] === 'object' ? JSON.stringify(rest[k]) : rest[k]);
        });
        var s = qs.toString();
        if (s) url += (url.indexOf('?') < 0 ? '?' : '&') + s;
      } else {
        var body = ('body' in args) ? args.body : (Object.keys(rest).length ? rest : undefined);
        if (body !== undefined) {
          if (typeof body === 'string' || (global.FormData && body instanceof global.FormData)) init.body = body;
          else {
            init.body = JSON.stringify(body);
            var hasCt = Object.keys(headers).some(function (k) { return k.toLowerCase() === 'content-type'; });
            if (!hasCt) headers['Content-Type'] = 'application/json';
          }
        }
      }

      var ctl = global.AbortController ? new global.AbortController() : null;
      var timer = null;
      if (ctl) { init.signal = ctl.signal; timer = global.setTimeout(function () { ctl.abort(); }, cfg.timeout || 15000); }
      var t0 = Date.now();
      log('api', '→ ' + method + ' ' + url);
      try {
        var res = await global.fetch(url, init);
        var ct = res.headers.get('content-type') || '';
        var data = ct.indexOf('json') >= 0 ? await res.json().catch(function () { return null; }) : await res.text();
        log('api', '← ' + res.status + ' (' + (Date.now() - t0) + ' ms) ' + url);
        if (!res.ok) {
          var err = new Error('HTTP ' + res.status + ' ' + res.statusText + ' — ' + method + ' ' + url);
          err.status = res.status; err.data = data;
          throw err;
        }
        return data;
      } catch (e) {
        if (e && e.name === 'AbortError') e = new Error('Délai dépassé (' + (cfg.timeout || 15000) + ' ms) — ' + url);
        else if (e instanceof TypeError) e = new Error('Réseau / CORS : ' + e.message + ' — ' + url);
        throw e;
      } finally {
        if (timer) global.clearTimeout(timer);
      }
    }

    api.request = function (method, path, args, opts) { return request(method, path, args, opts, null); };
    (cfg.endpoints || []).forEach(function (ep) {
      if (!ep.name || !IDENT.test(ep.name)) return;
      api[ep.name] = function (args, opts) { return request(ep.method, ep.path, args, opts, ep); };
    });
    return api;
  }

  function makeJsApi(cfg, app) {
    var fn = new Function('app', '"use strict"; return (' + (cfg.code || '{}') + '\n);');
    return fn(app) || {};
  }

  /** Construit app.api à partir de la liste des APIs du projet. */
  function buildApis(apis, app, meta) {
    var out = makeBuiltins(app, meta);
    var errors = [];
    (apis || []).forEach(function (cfg) {
      if (!cfg || !cfg.name) return;
      if (!IDENT.test(cfg.name)) { errors.push('API « ' + cfg.name + ' » : nom invalide'); return; }
      if (BUILTIN_DOC[cfg.name]) { errors.push('API « ' + cfg.name + ' » : nom réservé (API intégrée)'); return; }
      try {
        out[cfg.name] = cfg.kind === 'js'
          ? makeJsApi(cfg, app)
          : makeHttpApi(cfg, function (lvl, msg) { app.log(msg); });
      } catch (e) {
        errors.push('API « ' + cfg.name + ' » : ' + e.message);
      }
    });
    return { api: out, errors: errors };
  }

  /* ------------------------------------------------------------------
   * Compilation des handlers (script commun + handlers dans UN scope)
   * ------------------------------------------------------------------ */
  function compile(shared, handlers, wantedNames, app, composerCompat, report) {
    var names = Object.keys(handlers || {}).filter(function (n) { return IDENT.test(n); });
    var bad = {};

    // Isolation des erreurs de syntaxe : on exclut le handler fautif, pas tout le monde
    names.forEach(function (n) {
      try { new Function('app', 'Composer', handlers[n]); }
      catch (e) { bad[n] = e; report('error', 'Handler « ' + n + ' » : erreur de syntaxe — ' + e.message); }
    });
    try { new Function('app', 'Composer', (shared || '')); }
    catch (e) { report('error', 'Script commun : erreur de syntaxe — ' + e.message); return {}; }

    var good = names.filter(function (n) { return !bad[n]; });
    var all = {};
    good.concat(wantedNames || [], ['on_app_ready']).forEach(function (n) { if (IDENT.test(n)) all[n] = 1; });
    var ret = 'return {' + Object.keys(all).map(function (n) {
      return JSON.stringify(n) + ':(typeof ' + n + '==="function"?' + n + ':null)';
    }).join(',') + '};';
    var src = (shared || '') + '\n' +
      good.map(function (n) { return handlers[n]; }).join('\n\n') + '\n' + ret +
      '\n//# sourceURL=cgml-handlers.js';
    try {
      return new Function('app', 'Composer', src)(app, composerCompat) || {};
    } catch (e) {
      report('error', 'Exécution du script commun : ' + e.message);
      return {};
    }
  }

  /* ------------------------------------------------------------------
   * BOOT
   * ------------------------------------------------------------------
   * opts = {
   *   windows : [{ id, name, el, hidden }],  // el = conteneur de la fenêtre
   *   handlers: { nom: "function nom(payload){…}" },
   *   shared  : "code commun",
   *   apis    : [ {name, kind, …} ],
   *   meta    : { name, version, … },
   *   draggable: false, strict: false,
   *   onLog(level, texte), onStatus(texte), onSignal(handler, payload)
   * }
   * ------------------------------------------------------------------ */
  function boot(opts) {
    opts = opts || {};
    var listeners = [];
    var styles = [];
    var bus = {};
    var lastWin = null;
    var warned = {};
    var winList = [];
    var winById = {};
    var topZ = 1;

    function emitLog(level, text) {
      if (opts.onLog) { try { opts.onLog(level, text); } catch (e) { /* ignoré */ } }
      var c = global.console;
      if (c) (level === 'error' ? c.error : level === 'warn' ? c.warn : c.log).call(c, '[cgml] ' + text);
    }

    /* ---- Styles du runtime ---- */
    var rs = doc.createElement('style');
    rs.setAttribute('data-cgml', 'runtime');
    rs.textContent = RUNTIME_CSS;
    doc.head.appendChild(rs);
    styles.push(rs);

    /* ---- Contexte de fenêtre ---- */
    function makeWin(d) {
      var w = {
        id: d.id,
        key: d.id,
        name: d.name || d.id,
        el: d.el,
        get root() { return d.el.querySelector('.gtk-window'); },
        $: function (id) { return d.el.querySelector('[data-glade-id="' + q(id) + '"]'); },
        get: function (id) { return getValue(w.$(id)); },
        set: function (id, v) { setValue(w.$(id), v); return w; },
        text: function (id, t) {
          var e = w.$(id);
          if (t === undefined) return e ? e.textContent : '';
          if (e) e.textContent = t;
          return w;
        },
        enable: function (id, on) {
          var e = w.$(id); if (!e) return w;
          var off = on === false;
          e.classList.toggle('disabled', off);
          [e].concat(Array.prototype.slice.call(e.querySelectorAll('input,select,textarea,button'))).forEach(function (n) {
            if ('disabled' in n) n.disabled = off;
          });
          return w;
        },
        widgets: function () {
          var o = {};
          d.el.querySelectorAll('[data-glade-id]').forEach(function (n) { o[n.getAttribute('data-glade-id')] = n; });
          return o;
        },
        isVisible: function () { return !d.el.classList.contains('cgml-hidden'); },
        show: function () {
          d.el.classList.remove('cgml-hidden');
          d.el.style.zIndex = ++topZ;
          return w;
        },
        hide: function () { d.el.classList.add('cgml-hidden'); return w; },
        toggle: function () { return w.isVisible() ? w.hide() : w.show(); },
        front: function () { d.el.style.zIndex = ++topZ; return w; },
        moveTo: function (x, y) { d.el.style.left = x + 'px'; d.el.style.top = y + 'px'; return w; }
      };
      return w;
    }

    (opts.windows || []).forEach(function (d) {
      if (!d || !d.el) return;
      var w = makeWin(d);
      var z = parseInt(d.el.style.zIndex, 10);
      if (z > topZ) topZ = z;
      if (d.hidden) d.el.classList.add('cgml-hidden');
      winList.push(w);
      winById[w.id] = w;
    });

    function resolveWin(ref) {
      if (!ref) return lastWin || winList[0] || null;
      if (typeof ref === 'object') {
        if (ref.$ && ref.el) return ref;
        for (var i = 0; i < winList.length; i++) if (winList[i].el === ref) return winList[i];
        return null;
      }
      ref = String(ref);
      if (winById[ref]) return winById[ref];
      var i2, w;
      for (i2 = 0; i2 < winList.length; i2++) if (winList[i2].name === ref) return winList[i2];
      var bare = function (s) { return String(s).replace(/\.(glade|ui|xml)$/i, ''); };
      for (i2 = 0; i2 < winList.length; i2++) if (bare(winList[i2].name) === bare(ref)) return winList[i2];
      for (i2 = 0; i2 < winList.length; i2++) {
        w = winList[i2];
        var root = w.el.querySelector('.gtk-window');
        if (root && root.getAttribute('data-glade-id') === ref) return w;
      }
      return null;
    }

    /* ---- app ---- */
    var app = {
      version: VERSION,
      meta: opts.meta || {},
      state: {},
      windows: winById,
      api: {},
      window: function (ref) { return resolveWin(ref); },
      widget: function (ref, id) {
        if (id === undefined) { id = ref; ref = null; }
        var w = resolveWin(ref);
        return w ? w.$(id) : null;
      },
      openWindow: function (ref) { var w = resolveWin(ref); if (w) w.show(); else emitLog('warn', 'openWindow : fenêtre introuvable « ' + ref + ' »'); return w; },
      closeWindow: function (ref) { var w = resolveWin(ref); if (w) w.hide(); else emitLog('warn', 'closeWindow : fenêtre introuvable « ' + ref + ' »'); return w; },
      toggleWindow: function (ref) { var w = resolveWin(ref); if (w) w.toggle(); return w; },
      on: function (ev, fn) {
        (bus[ev] = bus[ev] || []).push(fn);
        return function () { var i = bus[ev].indexOf(fn); if (i >= 0) bus[ev].splice(i, 1); };
      },
      off: function (ev, fn) { var a = bus[ev]; if (a) { var i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } },
      emit: function (ev, data) {
        (bus[ev] || []).slice().forEach(function (fn) {
          try { fn(data); } catch (e) { emitLog('error', 'Écouteur « ' + ev + ' » : ' + e.message); }
        });
      },
      call: function (name, payload) {
        var fn = fns[name];
        if (!fn) throw new Error('Handler introuvable : ' + name);
        return fn(payload || {});
      },
      status: function (t) {
        if (opts.onStatus) opts.onStatus(String(t));
        else if (doc) doc.title = (app.meta.name || 'CompoGlueML') + ' — ' + t;
      },
      toast: function (m, ms) { return app.api.ui.toast(m, ms); },
      log: function () { emitLog('log', fmt(arguments)); },
      warn: function () { emitLog('warn', fmt(arguments)); },
      error: function () { emitLog('error', fmt(arguments)); },
      addStyle: function (css) {
        var s = doc.createElement('style');
        s.setAttribute('data-cgml', 'user');
        s.textContent = css;
        doc.head.appendChild(s);
        styles.push(s);
        return s;
      }
    };

    var built = buildApis(opts.apis, app, opts.meta);
    app.api = built.api;
    built.errors.forEach(function (m) { emitLog('error', m); });

    /* ---- Compat « Composer » (anciens handlers) ---- */
    var Composer = {
      app: app,
      current: function () { var w = lastWin || winList[0]; return w ? w.el : null; },
      widget: function (id) {
        if (lastWin) { var e = lastWin.$(id); if (e) return e; }
        for (var i = winList.length - 1; i >= 0; i--) { var e2 = winList[i].$(id); if (e2) return e2; }
        return null;
      },
      widgetIn: function (ref, id) { var w = resolveWin(ref); return w ? w.$(id) : null; },
      widgetsIn: function (ref) { var w = resolveWin(ref); return w ? w.widgets() : {}; },
      setStatus: function (t) { app.status(t); },
      allWindows: function () { var o = {}; winList.forEach(function (w) { o[w.id] = w.el; }); return o; },
      openWindow: function (ref) { return app.openWindow(ref); },
      closeWindow: function (ref) { return app.closeWindow(ref); },
      toggleWindow: function (ref) { return app.toggleWindow(ref); }
    };

    /* ---- Compilation ---- */
    var wanted = [];
    winList.forEach(function (w) {
      w.el.querySelectorAll('[data-glade-signals]').forEach(function (n) {
        try { JSON.parse(n.getAttribute('data-glade-signals')).forEach(function (s) { wanted.push(s.h); }); } catch (e) { /* ignoré */ }
      });
    });
    var fns = compile(opts.shared, opts.handlers, wanted, app, Composer, emitLog);

    /* ---- Dispatch d'un signal ---- */
    function report(name, e) {
      emitLog('error', 'Handler « ' + name + ' » : ' + (e && e.message ? e.message : e));
      if (opts.onError) opts.onError(name, e);
    }

    function dispatch(w, el, spec, ev) {
      lastWin = w;
      var payload = {
        handler: spec.h,
        widgetId: el.getAttribute('data-glade-id') || '',
        gtkSignal: spec.s,
        value: (ev && ev.detail && ev.detail.page !== undefined) ? ev.detail.page : getValue(el),
        element: el,
        nativeEvent: ev,
        window: w,
        app: app,
        $: function (id) { return w.$(id); }
      };
      var fn = fns[spec.h];
      if (typeof fn === 'function') {
        try {
          var r = fn(payload);
          if (r && typeof r.then === 'function') r.then(null, function (e) { report(spec.h, e); });
        } catch (e) { report(spec.h, e); }
      } else if (!warned[spec.h]) {
        warned[spec.h] = true;
        if (opts.strict !== false) emitLog('warn', 'Aucun code pour le handler « ' + spec.h + ' » (signal ' + spec.s + ' sur #' + payload.widgetId + ')');
      }
      if (opts.onSignal) { try { opts.onSignal(spec.h, payload); } catch (e) { /* ignoré */ } }
    }

    winList.forEach(function (w) {
      /* Comportements statiques : onglets, boutons à bascule (capture → état à jour avant les handlers) */
      var click = function (ev) {
        var tab = ev.target.closest && ev.target.closest('.gtk-notebook-tab');
        if (tab && w.el.contains(tab)) {
          var nb = tab.closest('.gtk-notebook');
          setValue(nb, tab.getAttribute('data-page'));
          nb.dispatchEvent(new global.CustomEvent('g2h-switch-page', { detail: { page: +tab.getAttribute('data-page') } }));
        }
        var tg = ev.target.closest && ev.target.closest('.gtk-toggle');
        if (tg && w.el.contains(tg)) tg.classList.toggle('active');
      };
      w.el.addEventListener('click', click, true);
      listeners.push([w.el, 'click', click, true]);

      /* Mise au premier plan + déplacement */
      var down = function (ev) {
        if (ev.button !== 0) return;
        w.front();
        if (!opts.draggable) return;
        var bar = ev.target.closest && ev.target.closest('.gtk-titlebar');
        if (!bar) return;
        ev.preventDefault();
        var sx = ev.clientX, sy = ev.clientY;
        var ox = parseFloat(w.el.style.left) || 0, oy = parseFloat(w.el.style.top) || 0;
        var move = function (e) { w.moveTo(Math.max(0, ox + e.clientX - sx), Math.max(0, oy + e.clientY - sy)); };
        var up = function () { doc.removeEventListener('mousemove', move); doc.removeEventListener('mouseup', up); };
        doc.addEventListener('mousemove', move);
        doc.addEventListener('mouseup', up);
      };
      w.el.addEventListener('mousedown', down);
      listeners.push([w.el, 'mousedown', down, false]);

      /* Signaux Glade → handlers */
      w.el.querySelectorAll('[data-glade-signals]').forEach(function (el) {
        var specs;
        try { specs = JSON.parse(el.getAttribute('data-glade-signals')); } catch (e) { return; }
        specs.forEach(function (spec) {
          var fn = function (ev) {
            if (spec.k && ev.key !== spec.k) return;
            dispatch(w, el, spec, ev);
          };
          el.addEventListener(spec.e, fn);
          listeners.push([el, spec.e, fn, false]);
        });
      });
    });

    emitLog('log', winList.length + ' fenêtre(s), ' + Object.keys(fns).filter(function (n) { return fns[n]; }).length + ' handler(s) actif(s).');

    /* ---- Démarrage utilisateur ---- */
    if (typeof fns.on_app_ready === 'function') {
      try {
        var rr = fns.on_app_ready({ app: app, window: winList[0] || null });
        if (rr && rr.then) rr.then(null, function (e) { report('on_app_ready', e); });
      } catch (e) { report('on_app_ready', e); }
    }

    return {
      app: app,
      Composer: Composer,
      handlers: fns,
      errors: built.errors,
      destroy: function () {
        listeners.forEach(function (l) { l[0].removeEventListener(l[1], l[2], l[3]); });
        listeners = [];
        styles.forEach(function (s) { if (s.parentNode) s.parentNode.removeChild(s); });
        styles = [];
        var th = doc.querySelector('.cgml-toast-host');
        if (th && th.parentNode) th.parentNode.removeChild(th);
        winList.forEach(function (w) { w.el.classList.remove('cgml-hidden'); });
      }
    };
  }

  return {
    version: VERSION,
    boot: boot,
    buildApis: buildApis,
    builtinDoc: BUILTIN_DOC,
    css: RUNTIME_CSS,
    getValue: getValue,
    setValue: setValue
  };
};

window.CGML = window.CGML_FACTORY(window);
