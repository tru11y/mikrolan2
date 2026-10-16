// Coquille HTML du portail « Versions APK ». Aucun script ni style inline :
// la CSP de la route n'autorise que 'self' (+ l'origine S3 pour l'envoi).
export const PORTAL_HTML = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Versions APK — MikroLan</title>
<link rel="stylesheet" href="/api/admin-portal/releases.css">
<script src="/api/admin-portal/releases.js" defer></script>
</head>
<body>
<main>
  <header class="top">
    <h1>Versions APK</h1>
    <div id="session" class="session" hidden>
      <span id="who"></span>
      <button type="button" id="logout" class="btn ghost">Déconnexion</button>
    </div>
  </header>

  <div id="flash" role="status" aria-live="polite" class="flash" hidden></div>

  <section id="login" class="card" hidden>
    <h2>Connexion Super Admin</h2>
    <form id="login-form" autocomplete="on">
      <label for="email">E-mail</label>
      <input id="email" name="email" type="email" autocomplete="username" required>
      <label for="password">Mot de passe</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required>
      <button type="submit" class="btn primary">Se connecter</button>
    </form>
  </section>

  <div id="app" hidden>
    <section class="card" aria-labelledby="active-title">
      <h2 id="active-title">Version active</h2>
      <div id="active"></div>
    </section>

    <section class="card" aria-labelledby="new-title">
      <h2 id="new-title">Nouvelle version</h2>
      <form id="upload-form" novalidate>
        <div class="grid">
          <div>
            <label for="versionName">Version (nom)</label>
            <input id="versionName" inputmode="numeric" placeholder="1.2.0" required>
          </div>
          <div>
            <label for="versionCode">Version code (build)</label>
            <input id="versionCode" type="number" min="1" step="1" required>
          </div>
          <div>
            <label for="minVersionCode">Version code minimum</label>
            <input id="minVersionCode" type="number" min="1" step="1" value="1" required>
          </div>
        </div>
        <label for="releaseNotes">Notes de version</label>
        <textarea id="releaseNotes" rows="4" maxlength="5000" required></textarea>
        <label for="apk">Fichier APK</label>
        <input id="apk" type="file" accept=".apk,application/vnd.android.package-archive" required>
        <p id="file-info" class="hint"></p>
        <div id="progress-box" hidden>
          <progress id="progress" max="100" value="0" aria-label="Progression de l'envoi"></progress>
          <span id="progress-text"></span>
        </div>
        <div class="row">
          <button type="submit" id="submit" class="btn primary">Envoyer la version</button>
          <button type="button" id="cancel" class="btn ghost" hidden>Annuler l'envoi</button>
        </div>
      </form>
    </section>

    <section class="card" aria-labelledby="hist-title">
      <div class="row spread">
        <h2 id="hist-title">Historique</h2>
        <label class="inline"><input type="checkbox" id="show-archived"> Afficher les archivées</label>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">Version</th><th scope="col">Code</th><th scope="col">Min</th>
              <th scope="col">Taille</th><th scope="col">Date</th><th scope="col">Auteur</th>
              <th scope="col">Statut</th><th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <p id="empty" class="hint" hidden>Aucune version.</p>
      <button type="button" id="more" class="btn ghost" hidden>Charger plus</button>
    </section>
  </div>
</main>
</body>
</html>
`;
