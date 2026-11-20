# Image Postgres MikroLan (+ pgBackRest)

`Dockerfile` étend `postgres:16-alpine` en y ajoutant le binaire `pgbackrest` et
ses répertoires runtime (`/var/log/pgbackrest`, `/var/spool/pgbackrest`), requis
pour le PITR.

Le service `postgres` de `../docker-compose.prod.yml` construit cette image au
lieu de tirer `postgres:16-alpine` directement. Nom de conteneur, volume de
données, réseau, ports et healthcheck sont inchangés.

**Cette image est inerte tant que le PITR n'est pas activé** : sans
`archive_mode=on` et sans stanza, `pgbackrest` n'est jamais invoqué. L'activation
(config Postgres, montage de `/etc/pgbackrest`, secrets S3, timers systemd) suit
la procédure de `../backup/pitr/README.md`, à réaliser par un humain en fenêtre
de maintenance.

> Déploiement : passer de `image:` à `build:` **recrée le conteneur**
> `mikrolan2-pg` (le volume de données `mikrolan2_pg` est conservé). À faire en
> fenêtre de maintenance.

Secrets (clés S3, passphrase de chiffrement) : jamais dans le repo. Ils sont
injectés via `env_file: ./secrets/pgbackrest.env` (gitignoré), cf. section
« secrets » du runbook PITR.
