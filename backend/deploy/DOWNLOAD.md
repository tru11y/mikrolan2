# Lien de téléchargement public : https://mikrolan.net

Page publique (version, taille, étapes d'installation) et fichier de la version **active**, sans
compte et sans exposer l'API. Le backend sert `GET /api/download` et `GET /api/download/apk` ;
`mikrolan.net` les présente à la racine (`/` et `/apk`), tout le reste y répond 404.

## Mise en service (actions manuelles, hors CI)

1. **DNS (Route 53, zone `mikrolan.net`)** : enregistrement `A` à la **racine** `mikrolan.net` → `3.234.142.9` (TTL 300).
   Ne touche pas aux autres enregistrements (`api`, MX éventuels).
   Vérifier : `nslookup mikrolan.net`.
2. **Caddy (VPS)** : ajouter le contenu de `Caddyfile.download` dans `/etc/caddy/Caddyfile`, puis
   ```bash
   sudo caddy validate --config /etc/caddy/Caddyfile
   sudo systemctl reload caddy
   ```
   Le certificat Let's Encrypt est obtenu automatiquement une fois le DNS propagé.
3. **Contrôle** (le backend doit déjà être déployé avec la PR du lien public) :
   ```bash
   curl -sI https://mikrolan.net/            # 200 text/html
   curl -sI https://mikrolan.net/apk         # 302 vers l'URL signée du stockage
   curl -s -o /dev/null -w '%{http_code}\n' https://mikrolan.net/api/health   # 404 (l'API n'est pas exposée)
   ```

## Notes
- Le lien du bouton est relatif (`download/apk`) : la page fonctionne aussi sous `/api/download`.
- L'URL signée du fichier est générée à chaque appel (5 min) et n'est jamais écrite dans la page.
- Limite de débit : 20 requêtes/minute/IP (côté backend).
- `https://api.mikrolan.net/api/download` reste joignable (même backend) ; ne communiquer que `mikrolan.net`.
