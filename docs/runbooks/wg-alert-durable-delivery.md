# Runbook — Alertes WireGuard durables (épisodes)

Statut : PR empilée sur #125. Rien de déployé.

## Vocabulaire
`PROVIDER_ACCEPTED` = SMTP a accepté l'e-mail **ou** Expo a accepté le ticket push. Ce n'est jamais une preuve de réception, d'affichage ni de lecture.

## Modèle
- `WgAlertEpisode` : une période d'injoignabilité d'un peer, de la détection au handshake sain. Statuts `OPEN`, `PROVIDER_ACCEPTED`, `EXHAUSTED`, `RESOLVED`.
- `WgAlertDeliveryAttempt` : une ligne EMAIL et une ligne PUSH par tentative (unique sur épisode + canal + numéro).
- Index unique **partiel** `WgAlertEpisode_one_active_per_peer_type_key` (`WHERE status <> 'RESOLVED'`) : un seul épisode non résolu par peer et type, tranché par PostgreSQL. Prisma ne sait pas l'exprimer : ne pas le supprimer.
- Aucune donnée sensible : ni adresse, ni token, ni alias, ni IP, ni clé WireGuard, ni texte de message.

## Planning
Tentative 1 immédiate, tentative 2 à +1 h, tentative 3 à +6 h après la 2e (≈ T0 + 7 h), jamais de 4e. Si rien n'est accepté après la 3e : `EXHAUSTED`, un seul événement Sentry `WG_ALERT_DELIVERY_EXHAUSTED`, Ops Health RED jusqu'à résolution.
Compromis : T0 + 24 h pour la 3e tentative laisserait un incident sans canal 24 h ; ≈ T0 + 7 h garde la même charge (3 envois) avec une panne détectée le jour même.
Pas de rappel à 24 h tant qu'un épisode non résolu existe (comportement changé : un épisode = une alerte).

## Concurrence
Claim atomique court (`claimExpiresAt`, 5 min) → appel fournisseur hors transaction → écriture conditionnée à `attemptCount`. Deux crons ou deux processus ne déclenchent jamais deux fois la même tentative ; un claim expiré (processus mort) est repris.

## Reprise des données existantes (à valider avant merge)
Au premier passage du cron après déploiement, tout `RemotePeer` ACTIVE stale avec `staleAlertedAt` non nul et sans épisode reçoit un épisode **legacy** (`detectedAt = staleAlertedAt`, `failureCode = LEGACY_ACCEPTANCE_UNKNOWN`, jamais accepté). La première nouvelle tentative part immédiatement, une seule fois.
**Effet attendu en production : au plus 2 alertes réelles (2 peers concernés).** Si cette reprise est jugée trop risquée : ne pas merger tel quel ; le même résultat peut venir d'un script de backfill contrôlé qui crée ces 2 épisodes legacy avec un `nextAttemptAt` choisi, sans jamais les marquer acceptés.

## Ops Health (`GET /admin/system-health` → `wgAlerts`)
`persistence: DATABASE`, `resetOnRestart: false`, `deliveryProofDurable: true`. GREEN : aucun épisode OPEN/EXHAUSTED. ORANGE : au moins un épisode OPEN sans acceptation (immédiat) ou ancien `staleAlertedAt` sans épisode. RED : EXHAUSTED, OPEN depuis plus d'une heure, ou claim expiré non repris.

## Migration et retour arrière
`20261112150000_wg_alert_durable_delivery` : uniquement additive (4 enums, 2 tables, 2 FK `ON DELETE CASCADE` (épisode → `RemotePeer`, tentative → épisode), index). Mesurée sur base jetable : ≈ 160 ms (9 peers, aucune ligne existante modifiée).
Retour arrière applicatif : le code précédent (#125) ignore les nouvelles tables ; supprimer un peer reste possible (cascade). `RemotePeer.staleAlertedAt` est toujours maintenu (posé à l'ouverture, remis à NULL à la résolution).
Retour arrière complet (seulement si nécessaire) :
```sql
DROP TABLE "WgAlertDeliveryAttempt"; DROP TABLE "WgAlertEpisode";
DROP TYPE "WgAlertAttemptStatus"; DROP TYPE "WgAlertChannel"; DROP TYPE "WgAlertEpisodeStatus"; DROP TYPE "WgAlertType";
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261112150000_wg_alert_durable_delivery';
```

## Avant la mise en production
Nouvelle sauvegarde PostgreSQL, restauration jetable, migration sur la copie, vérification des 9 `RemotePeer` et des 2 incidents, puis merge de #125, rebase de cette PR sur `main`, CI, merge, validation.
