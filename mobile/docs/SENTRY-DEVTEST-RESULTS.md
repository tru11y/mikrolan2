# Sentry mobile — résultats du test devtest (2026-11-12)

Projet Sentry **de test** `mikrolan-mobile-devtest`, APK `com.mikrolan.app.sentrydevtest` (signature debug, API locale jetable, environnement `devtest`, release `com.mikrolan.app.sentrydevtest@1.2.0-sentrydevtest+1`, dist `1`). Aucune donnée réelle, aucun événement envoyé au projet de production. Aucun DSN ni jeton dans ce dépôt.

## Constats corrigés pendant le test
1. **Texte libre** : un code de ticket, une référence SasPay et un mot de passe RouterOS écrits dans le message d'une exception passaient (seules les clés étaient filtrées). Corrigé : motifs de codes de ticket, mots-clés suivis d'une valeur, identifiants opaques entiers ; téléphone resserré (dates et numéros de build ne sont plus altérés). Tests `sentryScrub.freetext.test.ts`.
2. **Breadcrumbs `touch`** (noms de composants et libellés d'accessibilité, ex. un nom de routeur) présents dans un crash natif. Corrigé : supprimés à la source (`shouldDropBreadcrumb`). Tests `sentryBreadcrumb.test.ts`.
3. Marqueur de masquage mal formé (`[ticket`) corrigé.

## Résultat final (binaire final)
- Événement JS synthétique : message nettoyé, release/dist/environnement exacts, utilisateur vide, route réduite à `/api/routers/:id/vouchers/search`, breadcrumbs réseau en liste blanche, aucune des valeurs synthétiques hors lignes de code source affichées par la symbolisation.
- Crash natif : aucune capture d'écran, aucune hiérarchie de vues, aucune pièce jointe, aucun replay, IP nulle, 0 breadcrumb d'interaction après 6 taps.
- Sourcemaps : envoi par `sentry.gradle` vers la release et le dist du SDK ; pile JS symbolisée (fichier source, fonction, ligne, contexte). Jeton absent de l'APK et des journaux. Deux frames signalées `js_invalid_sourcemap_location` (mineur).

## Limites et risques résiduels
- **Contexte source** : une pile symbolisée affiche des lignes du code source. Ne jamais écrire de secret en dur dans le code.
- **Identifiants natifs** : un crash natif contient un identifiant d'installation anonyme (`user.id`) et `device.id` (non retirables côté JS pour les événements natifs).
- **Géolocalisation** : Sentry déduit pays/ville de l'IP à la réception, même avec `sendDefaultPii` à false et `ip_address` nul. Activer « Prevent Storing of IP Addresses » dans le projet Sentry de production.
- Clés natives système et réseau du manifeste : non prouvées (aucun événement système ou de connectivité n'est survenu pendant le test). L'absence d'interaction native n'est pas non plus prouvée par le manifeste seul : les `touch` venaient du JS.
- Région Sentry et durée de conservation à fixer ; texte de confidentialité à intégrer après la fusion des branches compliance (`legal.versions.ts`).
- Jeton d'envoi des sourcemaps : `org:ci` couvre toute l'organisation ; à restreindre et à garder uniquement en secret CI.
