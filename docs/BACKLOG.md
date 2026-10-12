# Backlog produit / technique

## P0
- **TICKET GENERATION IDEMPOTENCY / SAFE RETRY** — `generateVouchers` n'a pas de clé d'idempotence : un retry après FAILED peut créer un lot en double. Le bouton « Réessayer » est retiré en attendant (FAILED → « Nouveau lot »).
- **Activation race 15-30 s** (nettoyage tickets P0-2B) — documenté, non traité.
- **RouterOS cleanup failure** (nettoyage tickets P0-2B) — documenté, non traité.

## P1
- **ENTITLEMENT SHOULD HONOR TIER CAPABILITIES** — `getEntitlement` décide via `plan === PRO && status === ACTIVE && currentPeriodEnd > now` et ignore `SubscriptionTier.remoteAccess`. Sans impact tant que essentiel/avance/entreprise ont `remoteAccess=true`.
- **Timezone du filtre Mois (Rapport)** — bornes envoyées en UTC ; vérifier le fuseau du tenant.

## Sécurité
- **JSON.parse fragment** — un `JSON.parse` sur des identifiants déchiffrés corrompus peut citer un fragment du secret dans le message d'erreur (donc dans Sentry). Marginal.
- **GET /routers/:id/credentials** — renvoie le mot de passe RouterOS en clair à un ADMIN+ (restauration LAN) ; à revoir si le LAN direct disparaît.
- **ROUTEROS ERROR LOGGING MUST USE STRICT SAFE-FIELD ALLOWLIST** — un `!trap` non-login peut renvoyer un `message` RouterOS contenant une donnée fournie par l'utilisateur ; auditer `message`/`category`/`reply` et ne garder que le nécessaire.

## CI
- **CI MOBILE JOB MUST RUN EXPO LINT** — le job « Mobile — Lint / Type-check » n'exécute que `tsc --noEmit`.
- **AdminAuditTab.tsx orphelin** — extrait tel quel de l'ancien `admin.tsx` (où `AuditTab` n'était déjà jamais rendu) ; non branché à l'onglet `audit`.

## P2
- **TICKET ACTION BUTTON RESPONSIVE LAYOUT** — sur l'écran Fichiers, « Révoquer » et « Supprimer » passent sur deux lignes (« Révoque/r », « Supprim/er ») dans la rangée d'actions d'un ticket. Non bloquant RC.
- **VOUCHER DURATION SNAPSHOT** — « Vérifier un ticket » calcule `expiresAt = usedAt + Plan.durationMinutes` avec la durée ACTUELLE du forfait. Un ticket généré avec un forfait de 24 h puis dont le forfait est édité à 48 h afficherait 48 h. Cible : snapshot de la durée sur le voucher à la génération.
- **CALENDAR EXPIRATION VS ROUTEROS LIMIT-UPTIME** — l'expiration affichée est calendaire (`usedAt + durée`) alors que `limit-uptime` RouterOS compte le temps de connexion cumulé. Décision produit connue pour cette version, non corrigée.
- **VERIFY TICKET KEYBOARD SUBMIT UX** — clavier ouvert après saisie du code : le premier tap sur « Vérifier » ne fait que fermer le clavier, il faut un second tap. Cible : un seul tap ferme le clavier ET lance la vérification ; la touche action/Entrée du clavier doit aussi soumettre le code.
- **SESSIONS ERROR STATE MUST NOT ALSO SHOW EMPTY STATE** — sur timeout RouterOS, l'écran Sessions ne doit pas afficher en même temps « Aucune session active ».
- **LEGACY HOTSPOT USER INVENTORY / CLEANUP** — RB951 : ~7 580 hotspot users dont ~4 726 jamais utilisés, parcourus par les schedulers Mikhmon (charge CPU). Aucune suppression sans : dry-run (comptage par profil et par âge), distinction stock commercial / périmé, confirmation de l'exploitant, sauvegarde préalable, plan de rollback.
