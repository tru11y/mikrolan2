# Runbook — Alertes WireGuard durables (épisodes)

Statut : PR #127 empilée sur #125. Rien de déployé, aucune sauvegarde réelle lancée.

## Vocabulaire
`PROVIDER_ACCEPTED` = SMTP a accepté l'e-mail **ou** Expo a accepté le ticket push. Ce n'est jamais une preuve de réception, d'affichage ni de lecture, **ni que le routeur est réparé**. Un épisode accepté reste un incident ouvert jusqu'au prochain handshake sain.

## Modèle
- `WgAlertEpisode` : une période d'injoignabilité d'un peer, de la détection au handshake sain. Statuts `OPEN`, `PROVIDER_ACCEPTED`, `EXHAUSTED`, `RESOLVED`. `emailStatus` / `pushStatus` sont des **enums Prisma** (`WgAlertEmailStatus`, `WgAlertPushStatus`) : PostgreSQL refuse toute valeur inconnue ; le code la rejette aussi avant écriture, et un `failureCode` hors `[A-Z0-9_]{1,40}` est neutralisé en `UNKNOWN_FAILURE`.
- `WgAlertDeliveryAttempt` : une ligne EMAIL et une ligne PUSH par passage. `kind` = `INITIAL` (tentative 1), `RETRY` (2 et 3) ou `REMINDER`. `attemptNumber` est la séquence de l'épisode (1 à 3, puis 3 + N pour le rappel N) ; `reminderNumber` (1 à 7) est NULL hors rappel. Uniques : (épisode, canal, attemptNumber) et (épisode, canal, reminderNumber).
- Index unique **partiel** `WgAlertEpisode_one_active_per_peer_type_key` (`WHERE status <> 'RESOLVED'`) : un seul épisode non résolu par peer et type, tranché par PostgreSQL. Prisma ne sait pas l'exprimer : ne pas le supprimer.
- Aucune donnée sensible : ni adresse, ni token, ni alias, ni IP, ni clé WireGuard, ni texte de message.

## Alerte initiale, retry, rappel
| | Quand | Statut de l'épisode | Tentatives |
|---|---|---|---|
| Initiale | détection T0 | `OPEN` | EMAIL + PUSH (kind `INITIAL`) |
| Retry | T0 + 1 h, puis +6 h après la 2e (≈ T0 + 7 h) | `OPEN` | EMAIL + PUSH (kind `RETRY`), seulement tant qu'aucun fournisseur n'a accepté |
| Épuisement | après la 3e sans acceptation | `EXHAUSTED` (RED), aucune boucle de rappel | — |
| Rappel | détection + 24 h puis toutes les 24 h tant que le peer reste stale, **max 7** | `PROVIDER_ACCEPTED` | un seul passage logique : 1 EMAIL + 1 PUSH (kind `REMINDER`), jamais de retry du rappel |

- Initiale acceptée : `nextReminderAt = detectedAt + 24 h`, `reminderCount = 0` (épisode legacy : acceptation + 24 h, pour ne pas renvoyer aussitôt).
- Un rappel est compté une seule fois, réussi ou non ; le prochain est dans 24 h. Après le 7e, `nextReminderAt = NULL` : l'épisode reste actif et visible, Ops Health RED, jusqu'au handshake sain.
- Handshake sain : `RESOLVED`, `resolvedAt`, `nextAttemptAt = nextReminderAt = NULL`, `staleAlertedAt` remis à NULL. Aucun rappel n'est envoyé. Un nouvel épisode repart de zéro.

## Concurrence et idempotence
Claim atomique court (`claimExpiresAt`, 5 min) → appel fournisseur hors transaction → écriture conditionnée (`attemptCount` ou `reminderCount` attendu). Deux crons ou deux processus ne produisent qu'une tentative ou qu'un rappel logique ; la contrainte (épisode, canal, `reminderNumber`) interdit un doublon même si un claim expire pendant l'envoi. Un claim expiré (processus mort) est repris. Limite assumée : un crash entre l'appel fournisseur et l'écriture peut renvoyer le même message une fois (livraison au moins une fois côté fournisseur), mais la base ne contiendra jamais deux acceptations pour le même numéro et canal.

## Reprise des données existantes (approuvée)
Au premier passage du cron après déploiement, tout `RemotePeer` ACTIVE stale avec `staleAlertedAt` non nul et sans épisode reçoit un épisode **legacy** (`detectedAt = staleAlertedAt`, `failureCode = LEGACY_ACCEPTANCE_UNKNOWN`, jamais accepté). La première nouvelle tentative réelle part immédiatement, une seule fois (claim). **Production : au plus 2 épisodes legacy attendus.** À confirmer sur une copie récente avant merge (procédure ci-dessous).

## Ops Health (`GET /admin/system-health` → `wgAlerts`)
`persistence: DATABASE`, `resetOnRestart: false`, `deliveryProofDurable: true`.
- GREEN : aucun épisode `OPEN`/`EXHAUSTED` (un épisode accepté < 24 h affiche « incident toujours ouvert », jamais « réglé »).
- ORANGE : épisode `OPEN` sans acceptation (immédiat), premier rappel ou rappel quotidien dû et non exécuté, ancien `staleAlertedAt` sans épisode.
- RED : `EXHAUSTED`, `OPEN` > 1 h, rappel dû depuis > 1 h (bloqué), claim expiré non repris, ou 7 rappels atteints avec incident actif.
- Métriques de rappel : `wgReminderDue`, `wgRemindersAttempted24h`, `wgRemindersProviderAccepted24h`, `wgReminderFailures24h`, `wgEpisodesReminderLimitReached`, `wgOldestUnresolvedAgeMs`.

## Migration et retour arrière
`20261112150000_wg_alert_durable_delivery` : uniquement additive (7 enums, 2 tables, 2 FK `ON DELETE CASCADE`, index). Mesurée sur base jetable : de l'ordre de 160 ms, aucune ligne existante modifiée.
Retour arrière applicatif : le code précédent (#125) ignore les nouvelles tables ; supprimer un peer reste possible (cascade). `RemotePeer.staleAlertedAt` reste maintenu (posé à l'ouverture, remis à NULL à la résolution).
Retour arrière complet (seulement si nécessaire) :
```sql
DROP TABLE "WgAlertDeliveryAttempt"; DROP TABLE "WgAlertEpisode";
DROP TYPE "WgAlertAttemptStatus"; DROP TYPE "WgAlertAttemptKind"; DROP TYPE "WgAlertPushStatus"; DROP TYPE "WgAlertEmailStatus";
DROP TYPE "WgAlertChannel"; DROP TYPE "WgAlertEpisodeStatus"; DROP TYPE "WgAlertType";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261112150000_wg_alert_durable_delivery';
```

## Procédure sur copie récente de production (À NE LANCER QU'APRÈS AUTORISATION)
Aucune de ces étapes n'a été exécutée. Rien n'est écrit en production ; seule la sauvegarde (lecture) touche la base réelle.
1. Sauvegarde : `pg_dump -Fc` de la base de production (via le mécanisme de sauvegarde existant), copie chiffrée hors du VPS.
2. Restauration jetable : conteneur `postgres:16-alpine` local, `pg_restore` dans une base vide, sur un port non standard.
3. Pré-contrôles : `SELECT count(*), count("staleAlertedAt") FROM "RemotePeer"` doit donner **9 et 2** ; noter les ids.
4. Migration : `DATABASE_URL=<copie> npx prisma migrate deploy`, chronométrer (ligne `_prisma_migrations`, `finished_at - started_at`).
5. Post-contrôles : toujours 9 peers et 2 `staleAlertedAt` ; 0 épisode ; l'index partiel existe (`pg_indexes`).
6. Simulation du backfill : démarrer l'application (build de la PR) sur la copie avec **fournisseurs simulés** (aucun SMTP, aucun Expo, `ALERT_EMAIL` vide, aucun token), forcer un passage du cron. Attendu : **au plus 2** épisodes `legacy`, `failureCode = LEGACY_ACCEPTANCE_UNKNOWN`, `providerAcceptedAt IS NULL`, `status = OPEN`, `attemptCount = 1` ; un second passage ne crée ni épisode ni tentative.
7. Retour arrière applicatif : lancer le code de #125 sur la copie migrée (lecture, mise à jour de `staleAlertedAt`, suppression d'un peer) ; puis le SQL de retour arrière complet.
8. Supprimer la copie (conteneur, dump chiffré selon la politique de rétention).

## Avant la mise en production
Merge de #125, rebase de cette PR sur `main`, CI verte, procédure ci-dessus validée, sauvegarde réelle autorisée séparément, puis merge et validation.
