// Logique du portail « Versions APK » (JS navigateur, servi tel quel sous CSP 'self').
// Règles : aucun innerHTML (tout passe par textContent), jetons gardés en mémoire
// uniquement, le serveur reste l'autorité (SUPER_ADMIN + doublons + taille S3).
export const PORTAL_JS = String.raw`(function () {
  'use strict';

  var MAX_BYTES = 200 * 1024 * 1024;
  var VERSION_NAME = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
  var ERRORS = {
    RELEASE_VERSION_EXISTS: 'Ce version code existe déjà.',
    RELEASE_FILE_MISSING: 'Envoi incomplet : le fichier est introuvable dans le stockage. Réessayez.',
    RELEASE_FILE_SIZE_MISMATCH: 'Envoi incomplet : la taille stockée ne correspond pas au fichier. Réessayez.',
    RELEASE_STORAGE_UNAVAILABLE: 'Stockage S3 indisponible ou non configuré.',
    RELEASE_ARCHIVED: 'Cette version est archivée.',
    RELEASE_ACTIVE_CANNOT_ARCHIVE: 'Activez une autre version avant d’archiver celle-ci.',
    RELEASE_NOT_FOUND: 'Version introuvable.'
  };

  var state = { access: null, refresh: null, email: '', items: [], cursor: null, xhr: null, busy: false };

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function flash(kind, text) {
    var f = $('flash');
    f.className = 'flash ' + kind;
    f.textContent = text;
    f.hidden = !text;
  }

  function fmtSize(b) { return (b / (1024 * 1024)).toFixed(1) + ' Mo'; }
  function fmtDate(d) { return new Date(d).toLocaleString('fr-FR'); }

  function ApiError(status, code, message) {
    this.status = status; this.code = code; this.message = ERRORS[code] || message || 'Erreur ' + status;
  }

  function decodeRole(jwt) {
    try {
      var p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(p)).role;
    } catch (e) { return null; }
  }

  function show(loggedIn) {
    $('login').hidden = loggedIn;
    $('app').hidden = !loggedIn;
    $('session').hidden = !loggedIn;
    $('who').textContent = loggedIn ? state.email : '';
  }

  function logout(message) {
    var rt = state.refresh;
    state.access = null; state.refresh = null; state.items = []; state.cursor = null;
    if (rt) { fetch('/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: rt }) }).catch(function () {}); }
    show(false);
    flash(message ? 'err' : 'ok', message || '');
  }

  function raw(path, opts) {
    var headers = { 'Content-Type': 'application/json' };
    if (state.access) headers.Authorization = 'Bearer ' + state.access;
    return fetch('/api' + path, { method: opts.method || 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  }

  function refreshTokens() {
    if (!state.refresh) return Promise.resolve(false);
    return fetch('/api/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: state.refresh }) })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (!j || !j.data) return false;
        state.access = j.data.accessToken; state.refresh = j.data.refreshToken; return true;
      }).catch(function () { return false; });
  }

  function api(path, opts) {
    opts = opts || {};
    function parse(res) {
      return res.json().catch(function () { return {}; }).then(function (j) {
        if (!res.ok) throw new ApiError(res.status, j.errorCode, j.message);
        return j.data;
      });
    }
    return raw(path, opts).then(function (res) {
      if (res.status !== 401 || !state.access) return parse(res);
      return refreshTokens().then(function (ok) {
        if (!ok) { logout('Session expirée, reconnectez-vous.'); throw new ApiError(401, null, 'Session expirée'); }
        return raw(path, opts).then(parse);
      });
    });
  }

  function onError(e) {
    if (e instanceof ApiError && e.status === 401) return;
    flash('err', e && e.message ? e.message : 'Erreur réseau.');
  }

  // ── Version active ──
  function loadActive() {
    var box = $('active');
    return api('/admin/releases/latest').then(function (r) {
      box.textContent = '';
      var line = el('p', null, 'v' + r.versionName + ' — code ' + r.versionCode + ' — plancher ' + r.effectiveMinVersionCode + (r.isRequired ? ' (obligatoire)' : ''));
      line.style.fontWeight = '600';
      box.appendChild(line);
      box.appendChild(el('p', 'notes', r.releaseNotes));
      if (r.downloadUrl && /^https:\/\//.test(r.downloadUrl)) {
        var a = el('a', null, 'Télécharger l’APK actif (' + fmtSize(r.fileSize) + ')');
        a.href = r.downloadUrl; a.rel = 'noopener noreferrer';
        box.appendChild(a);
      }
    }).catch(function (e) {
      box.textContent = '';
      if (e instanceof ApiError && e.code === 'RELEASE_NOT_FOUND') { box.appendChild(el('p', 'hint', 'Aucune version active.')); return; }
      onError(e);
    });
  }

  // ── Historique ──
  function badge(cls, text) { return el('span', 'badge ' + cls, text); }

  function actionBtn(label, cls, handler, disabled) {
    var b = el('button', 'btn ' + cls, label);
    b.type = 'button'; b.disabled = !!disabled || state.busy;
    b.addEventListener('click', handler);
    return b;
  }

  function act(path, body, okMsg) {
    state.busy = true; render();
    return api(path, { method: 'PATCH', body: body || {} })
      .then(function () { flash('ok', okMsg); return Promise.all([loadList(true), loadActive()]); })
      .catch(onError)
      .then(function () { state.busy = false; render(); });
  }

  function renderRow(r) {
    var tr = document.createElement('tr');
    [['v' + r.versionName], [r.versionCode], [r.minVersionCode], [fmtSize(r.fileSize)], [fmtDate(r.createdAt)], [r.createdByEmail || '—']]
      .forEach(function (c) { tr.appendChild(el('td', null, c[0])); });

    var st = el('td');
    if (r.isActive) st.appendChild(badge('ok', 'Active'));
    if (r.isRequired) st.appendChild(badge('warn', 'Obligatoire'));
    if (r.archivedAt) st.appendChild(badge('mute', 'Archivée'));
    if (!st.firstChild) st.appendChild(badge('mute', 'Inactive'));
    tr.appendChild(st);

    var ac = el('td'); var box = el('div', 'actions');
    var archived = !!r.archivedAt;
    box.appendChild(actionBtn('Activer', 'primary', function () {
      if (confirm('Activer la version ' + r.versionName + ' (code ' + r.versionCode + ') ?')) act('/admin/releases/' + r.id + '/activate', null, 'Version ' + r.versionName + ' activée.');
    }, r.isActive || archived));
    box.appendChild(actionBtn(r.isRequired ? 'Retirer l’obligation' : 'Rendre obligatoire', '', function () {
      var msg = r.isRequired ? 'Retirer l’obligation de mise à jour ?' : 'Les clients sous le code ' + r.versionCode + ' devront mettre à jour. Continuer ?';
      if (confirm(msg)) act('/admin/releases/' + r.id + '/require', { required: !r.isRequired }, r.isRequired ? 'Obligation retirée.' : 'Version marquée obligatoire.');
    }, archived));
    box.appendChild(actionBtn('Archiver', 'danger', function () {
      if (confirm('Archiver la version ' + r.versionName + ' ?')) act('/admin/releases/' + r.id + '/archive', null, 'Version archivée.');
    }, r.isActive || archived));
    ac.appendChild(box); tr.appendChild(ac);
    return tr;
  }

  function render() {
    var body = $('rows'); body.textContent = '';
    state.items.forEach(function (r) { body.appendChild(renderRow(r)); });
    $('empty').hidden = state.items.length > 0;
    $('more').hidden = !state.cursor;
  }

  function loadList(reset) {
    var q = '?limit=25&includeArchived=' + ($('show-archived').checked ? 'true' : 'false');
    if (!reset && state.cursor) q += '&cursor=' + encodeURIComponent(state.cursor);
    return api('/admin/releases' + q).then(function (page) {
      state.items = reset ? page.items : state.items.concat(page.items);
      state.cursor = page.nextCursor;
      render();
    }).catch(onError);
  }

  // ── Envoi ──
  function readForm() {
    var f = $('apk').files[0];
    return {
      file: f,
      versionName: $('versionName').value.trim(),
      versionCode: Number($('versionCode').value),
      minVersionCode: Number($('minVersionCode').value),
      releaseNotes: $('releaseNotes').value.trim()
    };
  }

  function validate(v) {
    if (!VERSION_NAME.test(v.versionName)) return 'Version invalide (format 1.2.3).';
    if (!Number.isInteger(v.versionCode) || v.versionCode < 1) return 'Version code invalide.';
    if (!Number.isInteger(v.minVersionCode) || v.minVersionCode < 1) return 'Version code minimum invalide.';
    if (v.minVersionCode > v.versionCode) return 'Le minimum ne peut pas dépasser le version code.';
    if (!v.releaseNotes) return 'Notes de version requises.';
    if (!v.file) return 'Choisissez un fichier APK.';
    if (!/\.apk$/i.test(v.file.name)) return 'Le fichier doit avoir l’extension .apk.';
    if (v.file.size < 1) return 'Fichier vide.';
    if (v.file.size > MAX_BYTES) return 'Fichier trop volumineux (max 200 Mo).';
    if (state.items.some(function (r) { return r.versionCode === v.versionCode; })) return 'Ce version code existe déjà dans l’historique.';
    return null;
  }

  function setUploading(on) {
    state.busy = on;
    $('submit').disabled = on;
    $('cancel').hidden = !on;
    $('progress-box').hidden = !on;
    if (!on) { $('progress').value = 0; $('progress-text').textContent = ''; }
    render();
  }

  function putFile(target, file) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      state.xhr = xhr;
      xhr.open('PUT', target.uploadUrl);
      Object.keys(target.headers || {}).forEach(function (k) { xhr.setRequestHeader(k, target.headers[k]); });
      xhr.upload.onprogress = function (e) {
        if (!e.lengthComputable) return;
        var pct = Math.round((e.loaded / e.total) * 100);
        $('progress').value = pct;
        $('progress-text').textContent = pct + ' % (' + fmtSize(e.loaded) + ' / ' + fmtSize(e.total) + ')';
      };
      xhr.onload = function () { state.xhr = null; xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Envoi refusé par le stockage (HTTP ' + xhr.status + ').')); };
      xhr.onerror = function () { state.xhr = null; reject(new Error('Envoi interrompu (réseau ou CORS du bucket).')); };
      xhr.onabort = function () { state.xhr = null; reject(new Error('Envoi annulé.')); };
      xhr.send(file);
    });
  }

  function submitUpload(ev) {
    ev.preventDefault();
    if (state.busy) return;
    var v = readForm();
    var problem = validate(v);
    if (problem) { flash('err', problem); return; }
    flash('', '');
    setUploading(true);
    api('/admin/releases/upload-url', { method: 'POST', body: { versionCode: v.versionCode, fileSize: v.file.size } })
      .then(function (target) {
        return putFile(target, v.file).then(function () {
          return api('/admin/releases', { method: 'POST', body: {
            versionName: v.versionName, versionCode: v.versionCode, minVersionCode: v.minVersionCode,
            releaseNotes: v.releaseNotes, fileSize: v.file.size, storageKey: target.storageKey
          } });
        });
      })
      .then(function () {
        flash('ok', 'Version ' + v.versionName + ' enregistrée (inactive). Activez-la depuis l’historique.');
        $('upload-form').reset(); $('file-info').textContent = '';
        return loadList(true);
      })
      .catch(onError)
      .then(function () { setUploading(false); });
  }

  // ── Session ──
  function login(ev) {
    ev.preventDefault();
    fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: $('email').value.trim(), password: $('password').value }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { flash('err', 'Identifiants invalides.'); return; }
        if (decodeRole(res.j.data.accessToken) !== 'SUPER_ADMIN') { flash('err', 'Accès réservé au Super Admin.'); return; }
        state.access = res.j.data.accessToken; state.refresh = res.j.data.refreshToken; state.email = $('email').value.trim();
        $('password').value = ''; flash('', '');
        show(true);
        return Promise.all([loadList(true), loadActive()]);
      })
      .catch(function () { flash('err', 'Erreur réseau.'); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    show(false);
    $('login-form').addEventListener('submit', login);
    $('logout').addEventListener('click', function () { logout(''); });
    $('upload-form').addEventListener('submit', submitUpload);
    $('cancel').addEventListener('click', function () { if (state.xhr) state.xhr.abort(); });
    $('more').addEventListener('click', function () { loadList(false); });
    $('show-archived').addEventListener('change', function () { loadList(true); });
    $('apk').addEventListener('change', function () {
      var f = $('apk').files[0];
      $('file-info').textContent = f ? f.name + ' — ' + fmtSize(f.size) : '';
    });
    window.addEventListener('beforeunload', function (e) { if (state.busy && state.xhr) { e.preventDefault(); e.returnValue = ''; } });
  });
})();
`;
