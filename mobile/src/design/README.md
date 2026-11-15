# MikroLan Connect — Design foundations (D1, lot `foundation`)

Fondations tokens de la direction graphique **MikroLan Connect**. Document de référence : `D:\dev\mikrolan-prototypes\D0-charte-MikroLan-Connect.md`.

## Contenu de ce dossier

- `tokens/colors.ts` — palette Connect (23 tokens de base + 3 auxiliaires).
- `tokens/typography.ts` — échelle unique (plancher 12, cible 16).
- `tokens/spacing.ts` — base 4 pt.
- `tokens/radius.ts` — 4/8/12/16/20/pill.
- `tokens/sizes.ts` — cibles tactiles, CTA, lignes de liste.
- `tokens/elevation.ts` — `card`, `hero`, `none`.
- `tokens/motion.ts` — 140/220/360 ms, respect obligatoire de `useReduceMotion`.
- `tokens/icon.ts` — xs/sm/md/lg/xl/hero.
- `tokens/status.ts` — matrice officielle §H (24 statuts, icône + libellé + fond).
- `tokens/index.ts` — barrel.
- `compat.ts` — mapping typé legacy (`ui.tsx`) → Connect. Usage interne D1+.
- `__tests__/` — tests Node purs (tokens, contraste WCAG, matrice de statuts, dimensions, compat).

## Règles d'import

- Consommer les tokens depuis `@/src/design/tokens` (ou l'un des sous-fichiers).
- Les écrans **non migrés** continuent d'utiliser `@/src/components/ui` et `@/src/providers/theme-provider` comme avant. Aucun écran n'est converti en D1.
- `divider` est **strictement décoratif** (ratio 1,41:1). Jamais pour délimiter un champ ou un composant interactif.
- Montants FCFA et métriques : utiliser le prop `numeric` (chiffres tabulaires) dans les primitives à venir.

## Statut

- **D1.2 livré** : tokens + compat + tests.
- **D1.3 gated** : `Text`, adaptation de `Button` et `Card`. Requiert modification de `mobile/src/components/ui.tsx` — en attente d'autorisation explicite (le classifier anti-régression a refusé toute édition de `ui.tsx` par le flux auto).
- **D1.4 gated** : `StatusBadge`, `MetricCard`, `ListItem`. Primitives `.tsx` autonomes, également gated par le classifier.
- **Thème** : `theme-provider.tsx` non modifié. L'ajout d'un `useConnectTheme()` est également gated.

## Exécuter les tests

```sh
cd mobile
node --test --experimental-strip-types src/design/__tests__/tokens.test.ts \
                                       src/design/__tests__/contrast.test.ts \
                                       src/design/__tests__/status-matrix.test.ts \
                                       src/design/__tests__/sizes.test.ts \
                                       src/design/__tests__/compat.test.ts
```

Les tests ne touchent à aucun code React Native et peuvent tourner sur n'importe quel Node ≥ 22.
