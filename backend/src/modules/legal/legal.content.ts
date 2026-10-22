const STYLE = `
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0B0B12; color: #E4E4E7; line-height: 1.7; padding: 24px; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 8px; color: #fff; }
  h2 { font-size: 1.15rem; margin-top: 28px; margin-bottom: 8px; color: #fff; }
  p, li { font-size: 0.95rem; margin-bottom: 10px; }
  ul { padding-left: 20px; }
  a { color: #6366F1; }
  .meta { font-size: 0.8rem; color: #71717A; margin-bottom: 24px; }
</style>
`;

export const TERMS_HTML = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CGU — MikroLan</title>${STYLE}</head><body>
<h1>Conditions Générales d'Utilisation</h1>
<p class="meta">Version du 22 octobre 2026</p>

<h2>1. Objet</h2>
<p>Les présentes Conditions Générales d'Utilisation (« CGU ») régissent l'utilisation de l'application mobile MikroLan (« l'Application ») éditée par Solqueflo Balley (« l'Éditeur »), accessible sur Android.</p>
<p>L'Application permet l'onboarding, la gestion et la supervision de routeurs MikroTik (hotspot / FAI), avec facturation manuelle par mobile money (Wave / Orange Money). Elle est destinée à un usage professionnel.</p>

<h2>2. Acceptation</h2>
<p>L'utilisation de l'Application suppose l'acceptation expresse des CGU et de la <a href="/api/legal/privacy">politique de confidentialité</a>, matérialisée par une case à cocher à l'inscription (ou un écran d'acceptation à la première connexion). La date et la version acceptées sont enregistrées. Si vous n'acceptez pas ces conditions, vous ne devez pas utiliser l'Application.</p>

<h2>3. Inscription et compte</h2>
<ul>
  <li>Vous devez être âgé d'au moins 18 ans pour utiliser l'Application.</li>
  <li>Vous êtes responsable de la confidentialité de vos identifiants de connexion et des actions réalisées avec votre compte.</li>
  <li>Les informations fournies lors de l'inscription doivent être exactes et à jour.</li>
  <li>L'Éditeur peut suspendre ou supprimer tout compte en cas de violation des CGU.</li>
</ul>

<h2>4. Services et abonnement</h2>
<ul>
  <li><strong>Essai gratuit :</strong> un essai de 15 jours est accordé à l'inscription, limité à la gestion locale des routeurs.</li>
  <li><strong>Abonnement PRO :</strong> donne accès à la gestion à distance (WireGuard), multi-routeurs, et aux rapports avancés.</li>
  <li>Le paiement s'effectue par mobile money (Wave ou Orange Money). Le client envoie une preuve de paiement qui est validée manuellement par l'administrateur.</li>
  <li>L'abonnement n'est pas renouvelé automatiquement. L'accès PRO expire à la fin de la période payée.</li>
</ul>

<h2>5. Gestion à distance des routeurs</h2>
<p>L'activation de la gestion à distance exige l'<a href="/api/legal/remote-access">autorisation d'accès distant</a>, que le propriétaire du compte accorde expressément et peut révoquer à tout moment depuis l'Application (Mon compte). La révocation coupe immédiatement les accès distants ; les identifiants des routeurs sont ensuite effacés sous 7 jours.</p>

<h2>6. Obligations de l'utilisateur</h2>
<ul>
  <li>Ne pas utiliser l'Application à des fins illégales ou non autorisées.</li>
  <li>Ne pas tenter d'accéder aux données d'autres utilisateurs ou tenants.</li>
  <li>Ne pas interférer avec le fonctionnement de l'Application ou de ses serveurs.</li>
  <li>Respecter les conditions d'utilisation de MikroTik pour les routeurs gérés.</li>
  <li>Être propriétaire des routeurs enregistrés ou habilité à les administrer.</li>
  <li>Respecter la réglementation applicable à son activité de fourniture d'accès Internet ou de hotspot (licences et déclarations auprès de l'ARTCI, identification des utilisateurs finaux, information de ces derniers). Vous êtes seul responsable de cette activité et des contenus qui transitent par votre réseau.</li>
</ul>

<h2>7. Propriété intellectuelle</h2>
<p>L'Application, son code source, son design et son contenu sont la propriété de l'Éditeur. Toute reproduction, modification ou distribution sans autorisation est interdite.</p>

<h2>8. Limitation de responsabilité</h2>
<ul>
  <li>L'Application est fournie « en l'état », avec une obligation de moyens. L'Éditeur ne garantit pas un fonctionnement ininterrompu ou exempt d'erreurs.</li>
  <li>L'Éditeur ne saurait être tenu responsable d'une perte de données, d'une interruption de service réseau, ou d'un dysfonctionnement des routeurs MikroTik gérés via l'Application.</li>
  <li>La responsabilité de l'Éditeur est limitée au montant de l'abonnement payé sur les 12 derniers mois, sauf faute lourde ou dolosive ou disposition légale impérative.</li>
</ul>

<h2>9. Résiliation et suppression du compte</h2>
<p>Vous pouvez supprimer votre compte à tout moment depuis l'Application (Mon compte &gt; Supprimer mon compte). L'accès est coupé immédiatement ; vos données personnelles sont ensuite supprimées ou anonymisées sous 30 jours, conformément à la <a href="/api/legal/privacy">politique de confidentialité</a>.</p>

<h2>10. Modifications des CGU</h2>
<p>L'Éditeur peut modifier les présentes CGU. Les utilisateurs sont informés dans l'Application et doivent accepter la nouvelle version pour continuer à l'utiliser.</p>

<h2>11. Droit applicable et litiges</h2>
<p>Les présentes CGU sont régies par le droit ivoirien. En cas de litige, les parties recherchent d'abord une solution amiable ; à défaut, les tribunaux compétents d'Abidjan sont seuls compétents.</p>

<h2>12. Contact</h2>
<p>Pour toute question relative aux CGU : <a href="mailto:solqueflo.balley@epitech.eu">solqueflo.balley@epitech.eu</a></p>
</body></html>`;

export const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Politique de confidentialité — MikroLan</title>${STYLE}</head><body>
<h1>Politique de confidentialité</h1>
<p class="meta">Version du 22 octobre 2026 — loi n° 2013-450 du 19 juin 2013 relative à la protection des données à caractère personnel</p>

<h2>1. Responsable du traitement et rôles</h2>
<p>Solqueflo Balley — <a href="mailto:solqueflo.balley@epitech.eu">solqueflo.balley@epitech.eu</a>.</p>
<ul>
  <li><strong>Responsable du traitement</strong> pour les données de votre compte MikroLan (§2).</li>
  <li><strong>Sous-traitant</strong> pour les données des utilisateurs finaux de vos hotspots (adresses MAC et IP, horaires et volumes de session, codes de tickets) : le responsable de ces données est le gestionnaire du hotspot (le client MikroLan), qui définit leur finalité et leur durée de conservation. Si vous utilisez un hotspot, adressez vos demandes à son gestionnaire.</li>
</ul>

<h2>2. Données de votre compte</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0">
<tr style="border-bottom:1px solid #27272A"><td style="padding:6px;color:#A1A1AA">Donnée</td><td style="padding:6px;color:#A1A1AA">Finalité</td><td style="padding:6px;color:#A1A1AA">Base légale</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">E-mail, nom, pays</td><td style="padding:6px">Création et gestion du compte, communication</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Mot de passe (haché argon2)</td><td style="padding:6px">Authentification</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Identifiant Google ou Apple</td><td style="padding:6px">Connexion via ces services</td><td style="padding:6px">Consentement</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Jeton de notification push</td><td style="padding:6px">Envoi de notifications</td><td style="padding:6px">Consentement</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Preuves de paiement (images)</td><td style="padding:6px">Validation des paiements mobile money</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Factures et abonnement</td><td style="padding:6px">Facturation, comptabilité</td><td style="padding:6px">Obligation légale</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Identifiants des routeurs (chiffrés AES-256-GCM) et télémétrie technique</td><td style="padding:6px">Gestion à distance des routeurs</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Journaux d'audit (action, horodatage, adresse IP)</td><td style="padding:6px">Sécurité, traçabilité, preuve</td><td style="padding:6px">Sécurité du service ; obligation légale</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Date et version des textes acceptés</td><td style="padding:6px">Preuve de votre consentement</td><td style="padding:6px">Obligation légale</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Rapports d'erreurs (Sentry)</td><td style="padding:6px">Stabilité de l'application</td><td style="padding:6px">Intérêt légitime</td></tr>
</table>
<p>Aucun traceur publicitaire. Aucune donnée n'est vendue. La biométrie (verrouillage de l'application) est traitée uniquement sur votre appareil et n'est jamais transmise.</p>

<h2>3. Sécurité</h2>
<ul>
  <li>Chiffrement TLS des communications ; mots de passe hachés (argon2).</li>
  <li>Identifiants des routeurs chiffrés en AES-256-GCM ; accès distant par tunnel WireGuard authentifié.</li>
  <li>Cloisonnement des données par client, contrôle d'accès par rôles, journalisation des opérations sensibles.</li>
  <li>Les preuves de paiement sont stockées dans un espace privé, accessible uniquement par le propriétaire du compte et l'administrateur.</li>
</ul>

<h2>4. Hébergement, sous-traitants et transferts</h2>
<p>Les données sont hébergées sur des serveurs Amazon Web Services (États-Unis) ; les sauvegardes sont chiffrées et stockées sur Amazon S3. Vos données ne sont jamais vendues. Elles peuvent être traitées par :</p>
<ul>
  <li><strong>Amazon Web Services</strong> — hébergement et sauvegardes.</li>
  <li><strong>Brevo</strong> — envoi d'e-mails transactionnels (bienvenue, réinitialisation de mot de passe).</li>
  <li><strong>Expo (Expo Push Service) et Google (Firebase Cloud Messaging)</strong> — acheminement des notifications push.</li>
  <li><strong>Google et Apple</strong> — connexion avec Google / Apple, si vous choisissez cette méthode.</li>
  <li><strong>Sentry</strong> — rapports d'erreurs techniques.</li>
</ul>
<p>Certains de ces prestataires sont situés hors de Côte d'Ivoire ; ces transferts sont encadrés par les garanties contractuelles et de sécurité de ces prestataires, dans le respect de la loi n° 2013-450.</p>

<h2>5. Durées de conservation</h2>
<ul>
  <li><strong>Compte actif :</strong> les données sont conservées tant que le compte existe.</li>
  <li><strong>Suppression du compte :</strong> l'accès est coupé immédiatement ; vos données personnelles (e-mail, nom, pays, identifiants Google/Apple, jeton push, sessions de connexion) sont supprimées ou anonymisées sous 30 jours, ainsi que les identifiants de vos routeurs.</li>
  <li><strong>Accès distant révoqué :</strong> tunnels coupés immédiatement, identifiants des routeurs effacés sous 7 jours.</li>
  <li><strong>Journaux d'audit :</strong> 12 mois.</li>
  <li><strong>Preuves de paiement :</strong> 24 mois ; les factures sont conservées conformément aux obligations comptables.</li>
  <li><strong>Télémétrie des routeurs :</strong> 30 jours.</li>
  <li><strong>Données des utilisateurs finaux de hotspots :</strong> traitées pour le compte du client ; leur durée de conservation est définie dans le contrat conclu avec lui.</li>
</ul>

<h2>6. Vos droits</h2>
<p>Vous disposez des droits d'accès, de rectification, de suppression, d'opposition, de limitation et de portabilité, et vous pouvez retirer votre consentement à tout moment (sans effet sur le passé).</p>
<ul>
  <li><strong>Rectification :</strong> depuis l'Application (Mon compte).</li>
  <li><strong>Suppression :</strong> Mon compte &gt; Supprimer mon compte.</li>
  <li><strong>Opposition aux notifications :</strong> Mon compte &gt; Notifications.</li>
  <li><strong>Autres demandes (accès, portabilité…) :</strong> <a href="mailto:solqueflo.balley@epitech.eu">solqueflo.balley@epitech.eu</a>. Nous pouvons vous demander un justificatif d'identité et répondons sous 30 jours.</li>
  <li><strong>Réclamation :</strong> vous pouvez saisir l'Autorité de Régulation des Télécommunications/TIC de Côte d'Ivoire (ARTCI).</li>
</ul>

<h2>7. Violation de données</h2>
<p>En cas de violation susceptible de porter atteinte à vos droits, nous en informons les personnes concernées et l'autorité compétente dans les meilleurs délais.</p>

<h2>8. Cookies et traceurs</h2>
<p>L'Application mobile n'utilise pas de cookies. Aucun traceur publicitaire n'est intégré.</p>

<h2>9. Mineurs</h2>
<p>Le service s'adresse à des professionnels majeurs (18 ans minimum).</p>

<h2>10. Modifications</h2>
<p>La date de version figure en haut de page. En cas de modification, vous êtes invité à accepter la nouvelle version dans l'Application.</p>

<h2>11. Contact</h2>
<p><a href="mailto:solqueflo.balley@epitech.eu">solqueflo.balley@epitech.eu</a></p>
</body></html>`;

export const REMOTE_ACCESS_HTML = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Autorisation d'accès distant — MikroLan</title>${STYLE}</head><body>
<h1>Autorisation d'accès distant aux routeurs</h1>
<p class="meta">Version du 18 octobre 2026 — Annexe aux Conditions Générales</p>

<h2>1. Autorisation expresse</h2>
<p>Le Client autorise expressément, de manière préalable, éclairée et révocable, l'Éditeur de MikroLan à accéder à distance aux routeurs MikroTik qu'il enregistre dans le service, aux seules fins et dans les limites décrites ci-dessous. Hors de ce cadre, tout accès est interdit.</p>
<p>Le Client déclare et garantit être propriétaire des routeurs ou titulaire des droits d'administration nécessaires, avoir obtenu les autorisations de tiers requises, et fournir des identifiants valides, dédiés au service et dont il a la maîtrise.</p>

<h2>2. Finalités autorisées</h2>
<ul>
  <li>Provisionner et maintenir le tunnel WireGuard entre le routeur et l'infrastructure MikroLan.</li>
  <li>Lire l'état et la télémétrie du routeur (CPU, mémoire, version RouterOS, uptime, état du hotspot, erreurs).</li>
  <li>Créer, modifier, synchroniser ou supprimer, à la demande du Client via le service, les profils, utilisateurs hotspot, tickets, liaisons IP et paramètres nécessaires aux fonctions choisies.</li>
  <li>Réaliser des opérations de diagnostic et de support à la demande du Client.</li>
  <li>Assurer la sécurité et l'intégrité du service.</li>
</ul>

<h2>3. Limites</h2>
<p>L'Éditeur s'interdit de modifier la configuration du routeur en dehors des finalités ci-dessus ou de la demande du Client, de capturer ou d'enregistrer le contenu des communications des utilisateurs finaux, de consulter des données sans lien avec le service, et de communiquer les identifiants à des tiers (hors sous-traitants soumis aux mêmes garanties).</p>

<h2>4. Sécurité et traçabilité</h2>
<ul>
  <li>Les identifiants sont chiffrés (AES-256-GCM) et jamais journalisés en clair.</li>
  <li>L'accès passe par un tunnel WireGuard authentifié.</li>
  <li>Les opérations d'administration sont horodatées et journalisées (journal d'audit conservé 12 mois).</li>
</ul>

<h2>5. Responsabilité du Client</h2>
<p>Le Client maintient ses routeurs à jour, conserve une sauvegarde de sa configuration avant toute opération majeure, et reste responsable de sa configuration réseau et de la sécurité de ses équipements.</p>

<h2>6. Durée, retrait et révocation</h2>
<p>L'autorisation dure tant que l'offre PRO est active. Le Client peut la révoquer à tout moment (Mon compte > Accès distant > Révoquer l'autorisation). L'Éditeur coupe alors immédiatement les tunnels WireGuard et efface les identifiants des routeurs sous 7 jours. L'autorisation prend fin automatiquement à la résiliation du contrat ou à la suppression du compte.</p>

<h2>7. Droit applicable</h2>
<p>Droit ivoirien.</p>
</body></html>`;
