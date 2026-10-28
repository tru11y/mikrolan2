export interface PublicRelease {
  versionName: string;
  fileSize: number;
  publishedAt: Date | string;
}

export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const mb = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} Mo`;

const frDate = (d: Date | string): string =>
  new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

// Aucun script, aucune ressource externe : le logo est un SVG en ligne, la police celle du système.
const CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:#0b0b12;color:#ecedf5;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
a{color:#a99cff}.wrap{max-width:720px;margin:0 auto;padding:0 20px}
header{padding:20px 0}.brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:20px;letter-spacing:.2px}
.hero{padding:28px 0 8px}h1{font-size:clamp(28px,7vw,40px);line-height:1.15;margin:0 0 14px;font-weight:800}
.lead{color:#c3c7dc;font-size:18px;margin:0 0 26px}
.btn{display:block;text-align:center;background:#6c5ce7;color:#fff;text-decoration:none;font-weight:800;font-size:18px;
padding:18px 20px;border-radius:14px;box-shadow:0 8px 28px rgba(108,92,231,.35)}
.btn:focus-visible,a:focus-visible{outline:3px solid #fff;outline-offset:3px}
.meta{color:#9aa0b8;font-size:14px;text-align:center;margin:12px 0 0}
section{padding:34px 0 0}h2{font-size:22px;margin:0 0 14px}
.grid{display:grid;gap:12px;grid-template-columns:1fr}
@media(min-width:560px){.grid{grid-template-columns:1fr 1fr}}
.card{background:#14141f;border:1px solid #23233a;border-radius:14px;padding:16px}
.card h3{font-size:16px;margin:0 0 6px}.card p{margin:0;color:#b4b8cf;font-size:15px}
ol.steps{margin:0;padding:0;list-style:none;counter-reset:s}
ol.steps li{counter-increment:s;display:flex;gap:14px;margin:0 0 14px;color:#d3d6e8}
ol.steps li:before{content:counter(s);flex:none;width:30px;height:30px;border-radius:50%;background:#6c5ce7;color:#fff;
font-weight:800;display:flex;align-items:center;justify-content:center}
.note{background:#14141f;border-left:3px solid #6c5ce7;border-radius:8px;padding:12px 14px;color:#b4b8cf;font-size:14px}
footer{padding:36px 0 40px;color:#8b90a8;font-size:14px}footer nav{display:flex;flex-wrap:wrap;gap:6px 18px;margin-bottom:10px}`;

const LOGO = `<svg width="34" height="34" viewBox="0 0 34 34" role="img" aria-label="MikroLan" fill="none" stroke="#a99cff" stroke-width="3" stroke-linecap="round">
<path d="M5 14a17 17 0 0 1 24 0"/><path d="M10 19a10 10 0 0 1 14 0"/><circle cx="17" cy="25" r="2" fill="#a99cff" stroke="none"/></svg>`;

const FEATURES: Array<[string, string]> = [
  ['Tickets en quelques secondes', 'Générez, imprimez et partagez vos tickets Wi-Fi. Jusqu’à 50 tickets par page A4, avec ou sans QR code.'],
  ['Votre hotspot en direct', 'Sessions actives, charge du routeur et état de la connexion, sans ouvrir WinBox.'],
  ['Vos ventes sous les yeux', 'Revenu du jour, tickets vendus et rapport de ventes pour suivre votre activité.'],
  ['À distance, avec votre accord', 'La gestion à distance ne s’active qu’après votre autorisation expresse, et vous pouvez la retirer à tout moment.'],
];

export const unavailablePage = (): string =>
  shell(
    'MikroLan',
    `<div class="hero"><h1>MikroLan</h1><p class="lead">Le téléchargement est momentanément indisponible. Réessayez dans quelques minutes.</p></div>`,
  );

export const landingPage = (r: PublicRelease): string =>
  shell(
    'MikroLan — Gérez votre hotspot MikroTik depuis votre téléphone',
    `<div class="hero">
<h1>Gérez votre hotspot MikroTik depuis votre téléphone</h1>
<p class="lead">MikroLan simplifie la vente de tickets Wi-Fi et le suivi de votre routeur, où que vous soyez.</p>
<a class="btn" href="download/apk">Télécharger pour Android</a>
<p class="meta">Version ${esc(r.versionName)} · ${mb(r.fileSize)} · publiée le ${esc(frDate(r.publishedAt))}</p>
</div>
<section aria-labelledby="f"><h2 id="f">Ce que vous pouvez faire</h2>
<div class="grid">${FEATURES.map(([t, d]) => `<div class="card"><h3>${esc(t)}</h3><p>${esc(d)}</p></div>`).join('')}</div></section>
<section aria-labelledby="i"><h2 id="i">Installer en 5 étapes</h2>
<ol class="steps"><li><span>Touchez « Télécharger pour Android ». Si le navigateur affiche « Fichier potentiellement dangereux », touchez <strong>Télécharger quand même</strong> : c’est normal, MikroLan n’est pas (encore) sur le Play Store.</span></li>
<li><span>Une fois le téléchargement terminé, ouvrez le fichier <strong>.apk</strong> depuis la notification ou le dossier Téléchargements.</span></li>
<li><span>Si Android demande d’autoriser l’installation depuis cette source, acceptez (une seule fois).</span></li>
<li><span>Si Google Play Protect affiche « Analyse d’appli recommandée », touchez <strong>Analyser l’appli</strong> (et non « Ne pas installer »). Quand il indique « Cette appli semble sûre », touchez <strong>Installer</strong>.</span></li>
<li><span>Ouvrez MikroLan, créez votre compte et acceptez les conditions d’utilisation.</span></li></ol>
<p class="note">MikroLan est disponible sur Android pour le moment. Le fichier fait environ 87 Mo : sur une connexion lente, le téléchargement peut prendre plusieurs minutes. N’éteignez pas l’écran avant la fin.</p></section>`,
  );

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="description" content="MikroLan : vendez vos tickets Wi-Fi et suivez votre routeur MikroTik depuis votre téléphone.">
<meta name="theme-color" content="#0b0b12"><title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="wrap"><header><div class="brand">${LOGO}<span>MikroLan</span></div></header>${body}
<footer><nav aria-label="Informations légales"><a href="download/conditions">Conditions d’utilisation</a>
<a href="download/confidentialite">Politique de confidentialité</a><a href="download/acces-distant">Autorisation d’accès distant</a></nav>
<div>© MikroLan</div></footer></div></body></html>`;
}
