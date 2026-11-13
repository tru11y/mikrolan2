# Proposition de texte — Sentry (confidentialité)

**Statut : proposition, non appliquée.** `legal.content.ts` n'est pas modifié. La politique actuelle sur `main` cite déjà Sentry (« Rapports d'erreurs », intérêt légitime, sous-traitant « rapports d'erreurs techniques ») ; ce texte précise le traitement. À intégrer après la fusion des branches compliance qui touchent `legal.versions.ts` (`agent/compliance-fixes-v2`).

## Texte proposé (à insérer dans la section Sentry)
> **Rapports d'erreurs (Sentry).** Lorsque l'application plante ou rencontre une erreur technique, un rapport est envoyé à notre sous-traitant Sentry pour corriger le problème. Il contient uniquement : le type d'erreur et la pile technique, la version de l'application et de son environnement, le modèle et la version Android de l'appareil, et votre rôle dans l'application. Il ne contient ni enregistrement d'écran, ni capture d'écran, ni identifiant publicitaire, ni publicité. Avant l'envoi, les adresses e-mail, numéros de téléphone, adresses IP, adresses MAC, codes et mots de passe de tickets, identifiants RouterOS, jetons d'authentification et clés WireGuard sont masqués ; les adresses d'API sont réduites à un chemin sans paramètres. Les rapports sont conservés [90 jours — à confirmer et à régler dans Sentry]. Selon la région du projet Sentry [à préciser], ces données peuvent être traitées hors de Côte d'Ivoire. Pour exercer vos droits (accès, rectification, suppression) : [contact déjà indiqué dans la politique].

## Recommandation
Mise à jour **sans réacceptation obligatoire** : le prestataire et la base légale sont déjà déclarés, et le texte ne fait que restreindre et préciser. Réacceptation à prévoir seulement si la base légale change, si de nouvelles données sont collectées, ou si le transfert international n'était pas déjà mentionné. Risque résiduel faible : durée de conservation et région Sentry à fixer avant publication.

## Prérequis avant toute activation en production
1. Région Sentry et durée de conservation choisies et réglées dans Sentry.
2. Build de laboratoire avec un DSN de test (jamais le projet de production) : vérifier l'événement nettoyé, la release `com.mikrolan.app@<version>+<code>` et le contenu d'un crash natif.
3. Branche compliance fusionnée, puis texte intégré.
