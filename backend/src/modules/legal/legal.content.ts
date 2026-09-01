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
<p class="meta">Dernière mise à jour : 1er septembre 2026</p>

<h2>1. Objet</h2>
<p>Les présentes Conditions Générales d'Utilisation (« CGU ») régissent l'utilisation de l'application mobile MikroLan (« l'Application ») éditée par Solqueflo Balley (« l'Éditeur »), accessible sur Android.</p>
<p>L'Application permet l'onboarding, la gestion et la supervision de routeurs MikroTik (hotspot / FAI), avec facturation manuelle par mobile money (Wave / Orange Money).</p>

<h2>2. Acceptation</h2>
<p>En créant un compte ou en utilisant l'Application, vous acceptez les présentes CGU dans leur intégralité. Si vous n'acceptez pas ces conditions, vous ne devez pas utiliser l'Application.</p>

<h2>3. Inscription et compte</h2>
<ul>
  <li>Vous devez être âgé d'au moins 18 ans pour utiliser l'Application.</li>
  <li>Vous êtes responsable de la confidentialité de vos identifiants de connexion.</li>
  <li>Les informations fournies lors de l'inscription doivent être exactes et à jour.</li>
  <li>L'Éditeur se réserve le droit de suspendre ou supprimer tout compte en cas de violation des CGU.</li>
</ul>

<h2>4. Services et abonnement</h2>
<ul>
  <li><strong>Essai gratuit :</strong> un essai de 15 jours est accordé à l'inscription, limité à la gestion locale des routeurs.</li>
  <li><strong>Abonnement PRO :</strong> donne accès à la gestion à distance (WireGuard), multi-routeurs, et aux rapports avancés.</li>
  <li>Le paiement s'effectue par mobile money (Wave ou Orange Money). Le client envoie une preuve de paiement qui est validée manuellement par l'administrateur.</li>
  <li>L'abonnement n'est pas renouvelé automatiquement. L'accès PRO expire à la fin de la période payée.</li>
</ul>

<h2>5. Obligations de l'utilisateur</h2>
<ul>
  <li>Ne pas utiliser l'Application à des fins illégales ou non autorisées.</li>
  <li>Ne pas tenter d'accéder aux données d'autres utilisateurs ou tenants.</li>
  <li>Ne pas interférer avec le fonctionnement de l'Application ou de ses serveurs.</li>
  <li>Respecter les conditions d'utilisation de MikroTik pour les routeurs gérés.</li>
</ul>

<h2>6. Propriété intellectuelle</h2>
<p>L'Application, son code source, son design et son contenu sont la propriété de l'Éditeur. Toute reproduction, modification ou distribution sans autorisation est interdite.</p>

<h2>7. Limitation de responsabilité</h2>
<ul>
  <li>L'Application est fournie « en l'état ». L'Éditeur ne garantit pas un fonctionnement ininterrompu ou exempt d'erreurs.</li>
  <li>L'Éditeur ne saurait être tenu responsable de toute perte de données, d'interruption de service réseau, ou de dysfonctionnement des routeurs MikroTik gérés via l'Application.</li>
  <li>La responsabilité de l'Éditeur est limitée au montant de l'abonnement payé sur les 12 derniers mois.</li>
</ul>

<h2>8. Résiliation</h2>
<p>Vous pouvez supprimer votre compte à tout moment depuis l'Application (Mon compte > Supprimer mon compte). La suppression entraîne l'effacement de vos données personnelles conformément à notre Politique de confidentialité.</p>

<h2>9. Modifications des CGU</h2>
<p>L'Éditeur se réserve le droit de modifier les présentes CGU. Les utilisateurs seront informés via l'Application. L'utilisation continue de l'Application après modification vaut acceptation des nouvelles CGU.</p>

<h2>10. Droit applicable</h2>
<p>Les présentes CGU sont régies par le droit applicable au lieu de résidence de l'utilisateur. En cas de litige, les parties s'engagent à rechercher une solution amiable avant toute action judiciaire.</p>

<h2>11. Contact</h2>
<p>Pour toute question relative aux CGU : <a href="mailto:solqueflo.balley@epitech.eu">solqueflo.balley@epitech.eu</a></p>
</body></html>`;

export const PRIVACY_HTML = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Politique de confidentialité — MikroLan</title>${STYLE}</head><body>
<h1>Politique de confidentialité</h1>
<p class="meta">Dernière mise à jour : 1er septembre 2026</p>

<h2>1. Responsable du traitement</h2>
<p>Solqueflo Balley — <a href="mailto:solqueflo.balley@epitech.eu">solqueflo.balley@epitech.eu</a></p>

<h2>2. Données collectées</h2>
<table style="width:100%;border-collapse:collapse;margin:12px 0">
<tr style="border-bottom:1px solid #27272A"><td style="padding:6px;color:#A1A1AA">Donnée</td><td style="padding:6px;color:#A1A1AA">Finalité</td><td style="padding:6px;color:#A1A1AA">Base légale</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">E-mail</td><td style="padding:6px">Authentification, communication</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Nom, pays</td><td style="padding:6px">Personnalisation du compte</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Mot de passe</td><td style="padding:6px">Authentification</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Identifiant Google (OAuth)</td><td style="padding:6px">Connexion via Google</td><td style="padding:6px">Consentement</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Preuves de paiement (images)</td><td style="padding:6px">Validation des paiements mobile money</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Identifiants routeurs MikroTik</td><td style="padding:6px">Gestion à distance des routeurs</td><td style="padding:6px">Exécution du contrat</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Token de notification push</td><td style="padding:6px">Envoi de notifications</td><td style="padding:6px">Consentement</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Logs d'audit</td><td style="padding:6px">Traçabilité des opérations</td><td style="padding:6px">Intérêt légitime</td></tr>
<tr style="border-bottom:1px solid #18181B"><td style="padding:6px">Données biométriques</td><td style="padding:6px">Verrouillage de l'application (local uniquement)</td><td style="padding:6px">Consentement</td></tr>
</table>

<h2>3. Sécurité des données</h2>
<ul>
  <li>Les mots de passe sont hachés (bcrypt) et ne sont jamais stockés en clair.</li>
  <li>Les identifiants des routeurs MikroTik sont chiffrés en AES-256-GCM côté serveur.</li>
  <li>Les communications sont chiffrées via HTTPS (TLS).</li>
  <li>L'authentification biométrique est traitée localement sur l'appareil — aucune donnée biométrique n'est transmise au serveur.</li>
  <li>Les preuves de paiement sont stockées dans un répertoire privé, accessibles uniquement par le propriétaire et l'administrateur.</li>
</ul>

<h2>4. Hébergement</h2>
<p>Les données sont hébergées sur des serveurs Amazon Web Services (AWS) situés aux États-Unis. L'Éditeur s'assure que l'hébergeur dispose de mesures de sécurité conformes aux standards de l'industrie.</p>

<h2>5. Partage des données</h2>
<p>Vos données personnelles ne sont jamais vendues à des tiers. Elles peuvent être partagées avec :</p>
<ul>
  <li><strong>Expo (Expo Push Service) :</strong> token de notification push, pour l'acheminement des notifications.</li>
  <li><strong>Google (Firebase Cloud Messaging) :</strong> identifiant d'installation, pour la livraison des notifications push.</li>
  <li><strong>Sentry :</strong> données techniques anonymisées en cas de crash (aucune donnée personnelle).</li>
</ul>

<h2>6. Durée de conservation</h2>
<ul>
  <li><strong>Compte actif :</strong> les données sont conservées tant que le compte existe.</li>
  <li><strong>Suppression du compte :</strong> les données personnelles sont supprimées dans un délai de 30 jours.</li>
  <li><strong>Logs d'audit :</strong> conservés 12 mois après la dernière activité.</li>
  <li><strong>Preuves de paiement :</strong> conservées 24 mois à des fins comptables.</li>
</ul>

<h2>7. Vos droits</h2>
<p>Conformément à la réglementation applicable, vous disposez des droits suivants :</p>
<ul>
  <li><strong>Accès :</strong> obtenir une copie de vos données personnelles.</li>
  <li><strong>Rectification :</strong> corriger vos données depuis l'Application (Mon compte).</li>
  <li><strong>Suppression :</strong> supprimer votre compte et vos données (Mon compte > Supprimer mon compte).</li>
  <li><strong>Opposition :</strong> désactiver les notifications (Mon compte > Notifications).</li>
  <li><strong>Portabilité :</strong> obtenir vos données dans un format structuré sur demande.</li>
</ul>
<p>Pour exercer ces droits : <a href="mailto:solqueflo.balley@epitech.eu">solqueflo.balley@epitech.eu</a></p>

<h2>8. Cookies et trackers</h2>
<p>L'Application mobile n'utilise pas de cookies. Aucun tracker publicitaire n'est intégré.</p>

<h2>9. Modifications</h2>
<p>Cette politique peut être mise à jour. La date de dernière mise à jour est indiquée en haut de page. L'utilisation continue de l'Application vaut acceptation.</p>

<h2>10. Contact</h2>
<p>Pour toute question : <a href="mailto:solqueflo.balley@epitech.eu">solqueflo.balley@epitech.eu</a></p>
</body></html>`;
