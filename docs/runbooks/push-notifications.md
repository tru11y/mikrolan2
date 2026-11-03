# Runbook — Push notifications non livrées

Incident du 2026-11-02, clos par la PR #92 et deux corrections de configuration (Firebase, Google Cloud).

## Symptôme

- `User.pushToken` à `NULL` pour tous les comptes.
- Les `Notification` étaient bien créées en base (in-app), mais aucun push n'arrivait sur les appareils.
- Aucune ligne dans `journalctl -u mikrolan-api` : `collectPushTokens` renvoyait `[]` et `createAndPush` retournait sans rien journaliser.

## Cause racine

Le SHA-1 du certificat de signature de l'APK installé n'était enregistré ni dans Firebase ni dans la restriction de la clé API Google Cloud. Sans cela, Firebase Installations refuse l'appareil, aucun token FCM n'est généré et l'app n'a rien à envoyer à `POST /auth/push-token`.

Erreur observée dans le logcat de l'appareil (tag `FirebaseMessaging`) :

```
FirebaseInstallationsException: Firebase Installations Service is unavailable
```

Deux endroits doivent contenir le SHA-1 de chaque clé de signature utilisée :

1. Firebase Console → Paramètres du projet → application Android `com.mikrolan.app` → Empreintes de certificat SHA.
2. Google Cloud Console → API et services → Identifiants → « Android key (auto created by Firebase) » → Restrictions Android (package `com.mikrolan.app` + SHA-1).

La propagation d'une restriction de clé API peut prendre jusqu'à 5 minutes.

## Diagnostic

1. Compter les tokens en base :
   ```sql
   select role, ("pushToken" is not null) as has_token, "updatedAt" from "User" order by "updatedAt" desc;
   ```
2. Lire le logcat de l'appareil au lancement de l'app (`adb logcat -d --pid=$(adb shell pidof com.mikrolan.app)`) et chercher `FirebaseMessaging` / `FirebaseInstallationsException`.
3. Lire le SHA-1 de l'APK installé :
   ```
   apksigner verify --print-certs <apk>
   ```
   (extraire l'APK avec `adb pull "$(adb shell pm path com.mikrolan.app)"`), puis le chercher dans les deux consoles.
4. Envoyer un push de test à un token réel via `https://exp.host/--/api/v2/push/send`, puis lire le reçu avec `.../push/getReceipts` : un reçu `ok` prouve la chaîne Expo → FCM.
5. Depuis la PR #92, chercher dans les logs du backend `No push token for tenant` et `Expo ticket error`.

## Correctif

1. Ajouter le SHA-1 dans Firebase.
2. Ajouter le SHA-1 dans les restrictions Android de la clé API Google Cloud.
3. Attendre la propagation (jusqu'à 5 min), relancer l'app sur l'appareil.
4. Vérifier que `User.pushToken` est renseigné, puis envoyer un push de test.

## Correctif logiciel (PR #92)

- Mobile : la dédup `registered` est remise à zéro au logout, donc un login suivant dans le même processus ré-enregistre le token (`push-notifications-provider.tsx`).
- Backend : warning quand aucun token n'est trouvé (`notifications.service.ts`) ; log des tickets Expo en erreur dans `notifications.service.ts` et `notification.processor.ts`.

## Prévention

Après chaque changement de keystore, nouvelle clé de signature ou build signé avec une autre clé :

- Enregistrer immédiatement le SHA-1 dans Firebase et dans la clé API Google Cloud.
- Installer l'APK sur un appareil réel et vérifier qu'un `User.pushToken` apparaît en base.
- Envoyer un push de test et confirmer la réception.
