/* =====================================================================
 * app.js — pilote l'UI de l'outil Glade2HTML (index.html)
 * ===================================================================== */
(function () {
  const fileInput  = document.getElementById('file-input');
  const btnRefresh = document.getElementById('btn-refresh');
  const btnDemo    = document.getElementById('btn-demo');
  const statusEl   = document.getElementById('status');
  const logEl      = document.getElementById('log');
  const frame      = document.getElementById('render-frame');

  let lastXml = null;

  function log(msg, kind) {
    kind = kind || 'info';
    const line = document.createElement('div');
    line.className = kind;
    line.textContent = '[' + new Date().toLocaleTimeString() + '] ' + msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setStatus(t) { statusEl.textContent = t; }

  function render(xml, sourceName) {
    logEl.innerHTML = '';
    log('Source : ' + sourceName, 'info');
    log('Taille : ' + xml.length + ' octets', 'info');

    let result;
    const t0 = performance.now();
    try {
      result = Glade2HTML.gladeToHtml(xml);
    } catch (e) {
      log('Erreur : ' + e.message, 'error');
      setStatus('❌ Échec');
      return;
    }
    const dt = (performance.now() - t0).toFixed(1);

    log('Rendu en ' + dt + ' ms', 'ok');
    log('Fenêtres détectées : ' + result.rootIds.length, 'ok');
    log('Signaux détectés : ' + result.signals.length, 'ok');
    if (result.warnings.length) {
      for (const w of result.warnings) log('⚠ ' + w, 'warn');
    }

    frame.srcdoc = result.html;
    lastXml = xml;
    btnRefresh.disabled = false;
    setStatus('✔ ' + result.rootIds.length + ' fenêtre(s), ' + result.signals.length + ' signaux');
  }

  fileInput.addEventListener('change', async function (e) {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    render(text, file.name);
  });

  const body = document.body;
  body.addEventListener('dragover', function (e) {
    e.preventDefault();
    body.classList.add('drop-target');
  });
  body.addEventListener('dragleave', function () { body.classList.remove('drop-target'); });
  body.addEventListener('drop', async function (e) {
    e.preventDefault();
    body.classList.remove('drop-target');
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const text = await file.text();
    render(text, file.name);
  });

  btnRefresh.addEventListener('click', function () {
    if (lastXml) render(lastXml, 'cache');
  });

  btnDemo.addEventListener('click', function () {
    const demo = '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<interface>\n' +
      '  <requires lib="gtk+" version="3.24"/>\n' +
      '  <object class="GtkWindow" id="demo_window">\n' +
      '    <property name="title">Démo Glade2HTML</property>\n' +
      '    <property name="default-width">420</property>\n' +
      '    <property name="default-height">280</property>\n' +
      '    <child>\n' +
      '      <object class="GtkBox">\n' +
      '        <property name="orientation">vertical</property>\n' +
      '        <property name="spacing">10</property>\n' +
      '        <property name="margin-start">14</property>\n' +
      '        <property name="margin-end">14</property>\n' +
      '        <property name="margin-top">14</property>\n' +
      '        <property name="margin-bottom">14</property>\n' +
      '        <child>\n' +
      '          <object class="GtkLabel" id="lbl">\n' +
      '            <property name="label">Bonjour depuis un .glade générique</property>\n' +
      '            <property name="xalign">0</property>\n' +
      '          </object>\n' +
      '        </child>\n' +
      '        <child>\n' +
      '          <object class="GtkEntry" id="entry">\n' +
      '            <property name="placeholder-text">Votre nom…</property>\n' +
      '          </object>\n' +
      '        </child>\n' +
      '        <child>\n' +
      '          <object class="GtkBox">\n' +
      '            <property name="spacing">6</property>\n' +
      '            <property name="homogeneous">True</property>\n' +
      '            <child>\n' +
      '              <object class="GtkButton" id="ok">\n' +
      '                <property name="label">OK</property>\n' +
      '                <signal name="clicked" handler="on_ok"/>\n' +
      '              </object>\n' +
      '            </child>\n' +
      '            <child>\n' +
      '              <object class="GtkButton" id="cancel">\n' +
      '                <property name="label">Annuler</property>\n' +
      '                <signal name="clicked" handler="on_cancel"/>\n' +
      '              </object>\n' +
      '            </child>\n' +
      '          </object>\n' +
      '        </child>\n' +
      '      </object>\n' +
      '    </child>\n' +
      '  </object>\n' +
      '</interface>';
    render(demo, 'exemple-interne');
  });

  log('Prêt. Ouvrez un fichier .glade ou glissez-le sur la page.', 'ok');
})();
