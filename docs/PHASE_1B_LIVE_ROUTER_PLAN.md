# PHASE 1B — Métriques routeur Live (CPU / RAM / uptime) — PLAN

Statut : **document uniquement, aucune implémentation.** Rédigé le 2026-10-09 après la Phase 1A (PR #53, #54) et le
correctif d'identité LAN (PR #55). Rien ici n'est activé ni codé.

## 1. Problème et cause racine

Depuis le rollout Phase 1A sur le RB951 (`32053c90`, 2026-10-05 11:58 UTC) :

| Constat | Preuve |
|---|---|
| CPU / RAM / uptime n'apparaissent plus (`—`, « Performances : En attente ») | Captures A56 du 2026-10-05 et 2026-10-09 |
| `statsUpdatedAt` n'est jamais renseigné | `publishSessions` ne remplit que les sessions ; aucune autre source n'écrit les stats |
| Le Gateway ne lit plus RouterOS pour ce routeur | `getLiveSnapshot` rend le snapshot tel quel quand `syncFeedEnabled` (mobile ⇒ 0 lecture) |
| Le collecteur proactif l'ignore volontairement | `eligible = … && !gateway.syncFeedEnabled(id)` (Phase 1A : pas de 2ᵉ login en parallèle de la synchro CA) |
| **Impact supplémentaire : l'historique Télémétrie est vide** | 404 lignes `RouterTelemetry` du RB951 depuis le rollout (toutes `cpuPercent = NULL`) contre 4 lignes avec CPU avant (relevé base du 2026-10-09 16:45 UTC) |

Cause : en Phase 1A, **plus personne** n'exécute `/system/resource/print` pour ce routeur. C'est un effet voulu de
l'isolation (une seule lecture RouterOS pour le CA et le Live), pas un bug de la collecte.

Conséquence à traiter dans la même phase : `TelemetryService` lit le même snapshot, donc il enregistrera des vraies valeurs
dès que les stats existent à nouveau. Les 404 lignes `NULL` existantes ne sont pas reconstructibles (aucun backfill prévu ;
les agrégats doivent ignorer `NULL`).

## 2. Contraintes (non négociables)

1. `syncActivations` / CA : aucune modification de la logique d'activation, de la cadence (≈25 s), du retry, de la transaction, ni de la commande `/ip/hotspot/active/print` (sauf Option B explicitement approuvée, §4).
2. Pas de file globale dans `RemoteRouterService.run` (décision du 2026-10-05).
3. Un routeur lent ne doit **jamais** recevoir plus de requêtes (règle absolue du cadrage Live).
4. Un timeout de l'API RouterOS n'est jamais un tunnel coupé (`routerOsState` ≠ tunnel).
5. Inconnu ≠ 0 (CPU, RAM, uptime inconnus restent `—`).
6. Flags OFF par défaut, rollout par routeur (allowlist), rollback par flag.

## 3. Mesures de référence (réelles, RB951)

| Mesure | Valeur | Source |
|---|---|---|
| Cycle sync calme (connect + login + `active/print`) | médiane 761 ms, p95 1 481 ms (n = 118) | journal VPS, 2026-10-05→09 |
| Cycle sync avant rollout (périodes Mikhmon) | médiane 1 937 ms, p95 32 013 ms, 14,8 % de timeouts (n = 189) | journal VPS |
| Pire cas bench RB951 | connect 187 ms ; login jusqu'à 34,5 s ; commandes 1,5 s à >60 s | bancs Live Phase 2 |
| Cadence sync actuelle | 1 connexion + 1 login + 1 commande toutes les ≈25–30 s ⇒ ≈120–144 connexions/h | `SYNC_BASE_MS = 25 000` |
| Timeouts API actuels | 12 s par commande (`REQUEST_TIMEOUT_MS`), garde de cycle sync 90 s | `remote-router.service.ts`, `sessions.service.ts` |
| Fraîcheur snapshot sessions | marqué « retardé » au-delà de 45 s | `SYNC_FEED_STALE_MS` |

Le CPU du RB951 est dominé par une dette legacy (12 schedulers Mikhmon, 7 580 users) : des pics jusqu'à 100 % indépendants de MikroLan.

## 4. Options d'architecture

### Option A — Sonde stats « post-sync » (recommandée en premier)

Le Gateway planifie **une lecture stats seule** peu après la fin d'un cycle sync réussi, avec sa propre connexion,
dans une fenêtre bornée qui ne peut pas chevaucher le cycle suivant.

- Lecture : 1 connexion TCP, 1 login, 1 commande `/system/resource/print` avec `=.proplist=cpu-load,total-memory,free-memory,uptime,version,board-name` (1 ligne de réponse).
- Aucun changement dans `syncRouter` au-delà de ce qui existe (le hook `publishSessions` sait déjà quand un cycle vient de réussir).
- Nouveau code limité au Gateway/collecteur (pas au CA) + un client RouterOS à connexion unique annulable (deadline totale).

### Option B — Même connexion que la synchro CA (zéro login supplémentaire)

Ajouter, dans le callback de `remote.run` du sync, une 2ᵉ commande `/system/resource/print` après `active/print`,
protégée par try/catch et par une condition « routeur calme et stats ≥ N s ».

- Gain : **0 connexion en plus** (le login est le poste le plus coûteux sur RB951).
- Coût : **modifie le chemin de lecture CA** ; une commande lente rallonge le cycle (borne 12 s + 90 s deadline existante).
- **Hors périmètre actuel. Requiert une approbation explicite CTO.** Décision à prendre après mesures de l'Option A.

**Recommandation : Option A d'abord**, avec mesures ; B seulement si l'Option A montre un coût login mesurable sur RB951.

## 5. Nombre exact de lectures RouterOS

Référence actuelle : sync seule = **1 connexion + 1 login + 1 commande par cycle (≈25–30 s) ≈ 120–144 connexions/h**.

| Scénario | Connexions/h ajoutées | Commandes/h ajoutées | Total connexions/h | Variation |
|---|---|---|---|---|
| Option A, cadence 60 s | 60 | 60 (+60 logins) | ≈180–204 | +42 % à +50 % |
| Option A, cadence 120 s (défaut proposé) | 30 | 30 (+30 logins) | ≈150–174 | +21 % à +25 % |
| Option A, routeur lent (> 10 s) ou chargé | 0 à 12 | 0 à 12 | ≈ inchangé | 0 à +10 % |
| Option B, stats toutes les ≥ 30 s | **0** | ≈ 72 (1 commande/ 2ᵉ cycle) | inchangé | 0 connexion |

Les 10 consommateurs mobiles, les SSE et la télémétrie lisent le snapshot : **0 lecture ajoutée par N téléphones** (déjà vérifié Phase 1A).

## 6. Impact CPU estimé (à valider, non mesuré)

Ordres de grandeur — **estimations**, pas des mesures :

- Une session API courte (connect + login + 1 commande de 1 ligne) sur RB951 en régime calme : durée mesurée ≈ 0,7 s de bout en bout (cycle sync), coût CPU routeur de l'ordre de 1–3 % pendant ces quelques centaines de ms.
- Option A à 120 s : charge moyenne ajoutée ≈ (0,5 s × ~2 %) / 120 s ≈ **0,01 %** ; à 60 s ≈ 0,02 %. Négligeable devant les pics Mikhmon (100 %).
- Le vrai risque n'est pas le CPU moyen mais **la latence du login quand le routeur est saturé** (jusqu'à 34 s) : c'est pourquoi la sonde est interdite dans cet état (§8).

Protocole de mesure (à exécuter en canari, §12) : relever le CPU WinBox (graphique) sur 30 min sonde OFF puis 30 min sonde ON, hors scheduler Mikhmon si possible ; comparer aussi taux d'échec et p95 sync.

## 7. Mécanisme anti-collision (Option A)

1. **Ancrage sur la fin du sync** : la sonde n'est planifiée que depuis `publishSessions` (cycle réussi). Pas d'horloge indépendante.
2. **Fenêtre** : départ à `END + max(3 s, 2 × durée du sync)` ; **deadline dure à `END + 12 s`** (la connexion est détruite, pas seulement abandonnée). La cadence mesurée du sync (≈25–30 s) laisse ≥ 10 s de marge avant le cycle suivant. *À vérifier dans `RouterSyncScheduler` (calcul exact de `nextDueAt`) avant implémentation.*
3. **Une seule sonde en vol par routeur**, et **pool global = 1** sonde à la fois sur toute la flotte (protège le VPS et le tunnel).
4. **Préconditions (toutes)** : dernier sync `ok` et durée < 3 s ; aucun échec sync sur les 3 derniers cycles ; `statsAge ≥ cadence` ; routeur non en mode « shed » ; tunnel non `DOWN` (heartbeat WG).
5. **Autres consommateurs RouterOS** (vouchers, hotspot, reboot) : non visibles du Gateway (pas de file globale). Réduction du risque par la deadline courte (≤ 12 s) et la rareté de ces opérations. Une opération utilisateur échouant à cause d'une collision doit être rejouée par l'utilisateur ; documenter.
6. **Nouveau composant nécessaire** : client RouterOS « une connexion, une commande, deadline totale annulable » (le `withRouterOsApi` actuel n'a que des timeouts par commande). Hors CA.

## 8. Fréquence et états dégradés

| État du routeur | Détection | Cadence stats | Comportement |
|---|---|---|---|
| **Calme** | sync < 3 s, 0 échec récent | **120 s** (30–60 s possible après mesures) | sonde post-sync |
| **Normal** | sync 3–5 s | 300 s | sonde espacée |
| **Lent** | sync > 5 s (`SYNC_SLOW_MS`) ou connect > 2 s / login > 5 s en sonde | **aucune sonde** | dernières stats conservées, âge affiché |
| **Chargé / saturé** | échec ou timeout sync sur les 3 derniers cycles, ou sonde en échec | **shed** : 0 sonde | reprise après 3 syncs calmes consécutifs |
| **Tunnel lent / instable** | handshake WG périmé (150 s) ou `tunnelDown` | **aucune sonde** | état tunnel séparé de l'état API |

Règles :

- Échec de sonde ⇒ backoff exponentiel 2 → 4 → 8 → 10 min (plafond), avec gigue ±20 %, **jamais de nouvelle tentative immédiate**.
- Une sonde en échec ne modifie ni `sessionCount`, ni `sessionsUpdatedAt`, ni le « Sessions : Actualisées » ; elle ne change pas non plus `routerOsState` des sessions. Un état `statsState` distinct (`FRESH | STALE | PENDING | SHED`) est exposé pour l'UI (« Performances : En attente / Anciennes / Suspendues »).
- Les dernières valeurs CPU/RAM/uptime sont **conservées** avec leur `statsAgeMs` ; elles ne sont jamais remises à 0.
- Un uptime ancien est affiché avec son âge ; il ne « continue pas à courir » côté serveur.

## 9. Contrat de données (existant, aucun changement de schéma)

- Snapshot : `statsUpdatedAt`, `statsAgeMs`, `cpuPercent`, `memoryUsedMb`, `memoryTotalMb`, `uptime`, `rosVersion`, `boardName` (déjà dans `RouterLiveSnapshot`).
- SSE : `ROUTER_STATS` avec les âges (déjà en place) ; mobile : `Gauge` déjà `—` si inconnu.
- Télémétrie : reprend automatiquement des valeurs réelles dès que le snapshot stats existe. Pas de migration. Pas de backfill des 404 lignes `NULL`.

## 10. KPIs à ajouter (observabilité)

Par routeur : `statsProbeCount`, `statsProbeSkipped{reason}`, `statsProbeDurationMs`, `statsProbeFailures`, `statsShedCount`, `statsAgeMs`, connexions physiques ajoutées, `collisionAborted` (deadline dure atteinte). Exposés via `GET /routers/:id/remote/live/kpis` (même mécanisme que Phase 1A).

## 11. Rollback

- Flags (tous OFF par défaut) : `ROUTER_LIVE_STATS_PROBE_ENABLED`, `ROUTER_LIVE_STATS_ROUTER_IDS` (allowlist, RB951 seul au départ). Option B, si un jour approuvée : flag séparé `ROUTER_LIVE_STATS_PIGGYBACK`.
- Rollback = flag à `false` + redémarrage contrôlé de `mikrolan-api` (même procédure que les flags Live existants). Comportement historique immédiat : snapshot sessions inchangé, stats figées/`—`.
- Aucune migration DB, aucun effet sur le CA tant que l'Option B n'est pas activée.
- Si besoin : `git revert` de la PR Phase 1B (changements limités au Gateway/collecteur et au client à connexion unique).
- **Critères d'arrêt immédiat** : taux d'échec sync du RB951 > 2× la référence après rollout sur une fenêtre de 30 min ; > 1 `collisionAborted` ; toute activation CA manquée ; `NRestarts > 0`.

## 12. Plan de validation (canari RB951)

1. Tests automatiques (avant déploiement) : préconditions et états (calme/lent/chargé/tunnel DOWN), deadline dure, backoff + gigue, pool global = 1, jamais 2 lectures simultanées par routeur, inconnu ≠ 0, aucune interaction avec `reconcileActive`.
2. Déploiement flags OFF ; vérifier santé, `NRestarts=0`, sync inchangée.
3. Canari : flags ON pour `32053c90` uniquement, 60 min. Mesurer : connexions/h ajoutées (attendu ≈ 30), `statsAgeMs` p95 ≤ 150 s, taux d'échec et p95 du sync vs référence, CPU WinBox.
4. Terrain A56 : ouvrir l'écran Routeur app fermée puis ouverte ⇒ CPU/RAM/uptime visibles depuis le snapshot avec leur âge ; aucune lecture RouterOS déclenchée par le mobile.
5. Vérifier la télémétrie : nouvelles lignes `RouterTelemetry` avec CPU non nul.
6. Décision Option B : seulement si l'étape 3 montre un coût de login mesurable.

## 13. Questions ouvertes pour décision

1. Option A seule (recommandé) ou A puis B ?
2. Cadence initiale : 120 s (recommandé) ou 60 s ?
3. Faut-il aussi alimenter les routeurs REMOTE hors allowlist ? (non, rollout par routeur)
4. Politique des 404 lignes `NULL` de télémétrie : ignorer dans les agrégats (proposé) ou purger ?
5. Interaction avec les opérations utilisateur concurrentes (vouchers, reboot) : acceptable avec la deadline de 12 s ?

---

## 14. Design final implémenté (Option A) — écarts par rapport au plan

Implémenté : uniquement l'Option A. Aucun changement mobile, dashboard, LAN Identity, CA (`sessions.service.ts`,
`RouterSyncScheduler`, `reconcileActive` : **0 ligne modifiée**).

| Point | Décision finale |
|---|---|
| Déclencheur | `RouterGatewayService.onSyncEvent` → `RouterStatsProbe.published/syncFailed` (abonné en lecture seule, erreurs isolées) |
| Commande | `/system/resource/print` avec proplist, `remote.run(..., { timeoutMs: 3000, retries: 0 })` : 1 connexion, 1 login, 1 commande ; **aucun** `/ip/hotspot/active/print` |
| Départ | 4 s après une synchro CA réussie ; jamais armée sans publication de synchro ; annulée si une synchro échoue |
| Durée bornée | 3 étapes × 3 s = 9 s max ; deadline dure 13 s (`collisionAborted` si atteinte) |
| Fenêtre vs synchro suivante | `RouterSyncScheduler` : prochaine synchro = `startedAt + max(25 s, 2 × durée)` ⇒ ≥ 17 s après la fin d'un sync calme (granularité du dispatcheur 5 s comprise) ; la sonde a fini ≤ 13 s après la fin du sync |
| « Durée du sync » | non modifiable côté CA : remplacée par l'intervalle entre deux publications (> 40 s ⇒ `SYNC_SLOW`, aucune sonde) |
| Cadence | `now − lastAttempt ≥ 120 s`; succès < 3 s ⇒ 120 s, 3–5 s ⇒ 300 s, > 5 s ⇒ 600 s (±10 % de gigue) |
| Échec | 1 tentative, jamais de retry ; backoff 2→4→8→10 min (±20 %) ; état SHED ; reprise après 3 synchros calmes **et** fin du backoff |
| Pool | global = 1 sonde (`POOL_BUSY` ⇒ réessai à la publication suivante, pas de file) |
| Flags | `ROUTER_LIVE_STATS_PROBE_ENABLED` (défaut absent/false) ET `ROUTER_LIVE_STATS_ROUTER_IDS` (liste explicite ; vide = aucun) ET `ROUTER_LIVE_SYNC_PUBLISH_ENABLED` pour ce routeur |
| Écriture | `applyStats` : champs stats uniquement ; ne touche ni sessions, ni `lastSuccessAt`, ni `routerOsState` ; inconnu ne remplace pas une valeur connue ; un vrai 0 reste 0 |
| KPIs | `statsProbeCount`, `statsProbeSkipped`, `statsProbeFailures`, `statsShedCount`, `statsProbeDurationMs`, `collisionAborted`, `statsState` (`PENDING/FRESH/STALE/SHED`) dans `/remote/live/kpis` |

Fichiers : `router-gateway.service.ts` (+ listeners, `applyStats`, KPIs), `router-stats-probe.ts` (nouveau),
`router-gateway.module.ts` (provider), tests `router-stats-probe.spec.ts` (14 unitaires) et
`test/live/stats-probe.e2e-spec.ts` (2 e2e avec faux RouterOS TCP + vrai PostgreSQL).

Rollback : retirer `ROUTER_LIVE_STATS_PROBE_ENABLED` (ou `false`) + redémarrage contrôlé ; ou `git revert` de la PR.
