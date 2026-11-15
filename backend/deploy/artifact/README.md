# Déploiement par artefact (DEPLOY_MODE=artifact)

CI build → `artifact.tar.gz` (dist, prisma, node_modules prod + client Prisma généré, release.sh) → VPS : `release.sh`.
Aucun `git pull` / `npm ci` / `tsc` / `nest build` sur le VPS.

## Layout VPS (`/opt/mikrolan2`)
- `releases/<sha>/` immuable ; `current -> releases/<sha>`
- `shared/env/.env`, `shared/private-uploads`, `shared/uploads`, `shared/backups` (liés dans chaque release, jamais dans l'artefact)

## Pré-requis one-shot (manuel, hors CI)
1. Déplacer `.env`, `private-uploads/`, `uploads/` actuels vers `shared/`.
2. systemd `mikrolan-api` : `WorkingDirectory=/opt/mikrolan2/current`, `ExecStart=node dist/main.js`, `EnvironmentFile=` inchangé.
3. `sudo` sans mot de passe pour `bash /tmp/mikrolan-*/release.sh` ; `pg_dump` installé ; VPS linux-x64 (comme le runner).
4. Repo variable `DEPLOY_MODE=artifact` (sinon l'ancien job `deploy-legacy` reste actif). Rollback du mode = supprimer la variable.

## Garde-fous
- Refus si RAM dispo < 300 Mo, swap > 75 %, disque libre < 20 % (exit 10-12).
- `pg_dump -Fc` seulement si `prisma/migrations` diffère de la release courante.
- `prisma migrate deploy` depuis la nouvelle release ; échec ⇒ aucune bascule.
- Healthcheck 90 s sur `/api/health` (`"status":"ok"`) ; KO ⇒ `current` repointé + restart.
- Rollback = code seulement : migrations forward-only, rester rétro-compatibles (expand/contract).
- `concurrency: production-deploy`, sans annulation.
