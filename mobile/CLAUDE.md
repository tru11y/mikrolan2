# MikroLan Mobile — Claude Code Guide

## RÈGLES ABSOLUES — ANTI-RÉGRESSION

### 1. Suppression / régénération de code fonctionnel

**JAMAIS supprimer, écraser ou régénérer du code qui fonctionne sans :**
1. Avoir identifié ce que fait le code (lire d'abord)
2. Avoir expliqué à l'utilisateur pourquoi c'est supprimé
3. Avoir obtenu son consentement explicite

Ceci s'applique en particulier à :
- Modules natifs custom (`android/app/src/main/java/**/*.kt`)
- Configuration de sécurité réseau (`android/**/network_security_config.xml`)
- Permissions dans `AndroidManifest.xml`
- `MainApplication.kt`, `MainActivity.kt`
- Migrations Prisma déjà appliquées
- Toute config `.gradle` liée aux modules natifs

### 2. Commandes DESTRUCTIVES interdites sans consentement explicite

Ne JAMAIS exécuter sans validation utilisateur :
- `expo prebuild` (sans `--no-install` et sans review du diff)
- `expo prebuild --clean` (INTERDIT — supprime tout `android/` et `ios/`)
- `npx react-native upgrade`
- `git restore` / `git checkout --` / `git clean` sur des fichiers modifiés
- Suppression de fichiers Kotlin/Java natifs
- Suppression de `network_security_config.xml`
- Suppression de permissions Android

Si un outil ou une commande est susceptible de régénérer ces fichiers :
1. Prévenir l'utilisateur AVANT
2. Faire un `git status` et diff après exécution
3. Restaurer immédiatement si des fichiers protégés ont sauté

### 3. Fichiers PROTÉGÉS (hands-off sans demande explicite)

```
android/app/src/main/java/com/mikrolan/app/LanBinderModule.kt
android/app/src/main/java/com/mikrolan/app/LanBinderPackage.kt
android/app/src/main/java/com/mikrolan/app/MainApplication.kt
android/app/src/main/java/com/mikrolan/app/MainActivity.kt
android/app/src/main/AndroidManifest.xml
android/app/src/main/res/xml/network_security_config.xml
android/app/build.gradle (section defaultConfig, dependencies)
```

**Pourquoi** : ces fichiers permettent au téléphone de parler à un routeur MikroTik sur le LAN sans internet (permission Wi-Fi binding, cleartext HTTP local). Sans eux, TOUT onboarding routeur échoue avec "Routeur injoignable / indisponible".

### 4. Vérification post-modif obligatoire

Avant de dire "terminé" sur une tâche mobile qui touche le natif :
1. `git status` — signaler tout fichier supprimé/regen inattendu
2. `git diff android/app/src/main/AndroidManifest.xml` — vérifier que les permissions LAN sont intactes (`ACCESS_WIFI_STATE`, `ACCESS_NETWORK_STATE`, `CHANGE_NETWORK_STATE`)
3. Rebuild APK et test onboarding routeur si natif touché

### 5. Principe général

Une tâche "installer une lib" ne vaut PAS "régénérer le projet natif". Si une lib requiert un prebuild, PROPOSER à l'utilisateur, ne jamais l'exécuter sans OK explicite.

**Si le doute existe** : demander. Le coût d'une question est faible. Le coût d'un `expo prebuild` non consenti est plusieurs heures de debug.
