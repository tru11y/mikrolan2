/**
 * Backfill du snapshot de prix (Voucher.priceXofAtActivation) pour les
 * vouchers déjà ACTIVE/USED avant la fondation du chiffre d'affaires
 * (audit/51, audit/52, audit/53, audit/55). Conçu, JAMAIS exécuté en
 * production dans cette phase — dry-run par défaut, écriture uniquement
 * sous --apply.
 *
 * Périmètre exact (audit/51 §12, audit/52 §12) : ACTIVE ou USED, usedAt non
 * nul, priceXofAtActivation encore nul, plan résolvable, priceXof > 0.
 * Toujours ESTIMATED_FROM_CURRENT_PLAN_PRICE — jamais EXACT pour l'historique
 * (aucune source de prix historique n'existe, audit/52 §8).
 *
 * Terminaison garantie (audit/54 §8.1, corrigé audit/55 étape 4) : la
 * progression d'un lot au suivant se fait par un curseur sur `id`
 * (`orderBy: id asc`, `cursor` = dernier id du lot précédent), **jamais** en
 * relisant les lignes encore `priceXofAtActivation IS NULL`. Une ligne
 * invalide (plan/prix non exploitable) est donc dépassée définitivement dès
 * qu'elle a été lue une fois, qu'elle ait été mise à jour ou non — le lot
 * suivant commence strictement après elle. La boucle termine dès qu'un lot
 * contient strictement moins de `batchSize` lignes (fin du jeu éligible
 * atteinte), quel que soit le nombre de lignes invalides rencontrées.
 *
 * Dry-run = même pagination complète que --apply (corrigé audit/56 §4) : le
 * dry-run parcourt TOUS les lots éligibles jusqu'à épuisement, seule
 * l'écriture Prisma (`updateMany`) est sautée. Les compteurs finaux
 * (`eligibleFound`, `updated`, `skippedInvalidPrice`, `batches`) portent donc
 * toujours sur l'intégralité du jeu de données, jamais sur un seul lot. Une
 * ligne insérée avec un `id` (UUID aléatoire) inférieur au curseur déjà
 * dépassé pendant l'exécution n'est pas garantie d'être vue par CETTE
 * exécution — limitation connue et acceptée (rattrapée par l'exécution
 * suivante, qui repart de `cursorId=null`), sans risque de boucle infinie ni
 * de double écriture.
 *
 * Usage :
 *   npx ts-node src/scripts/backfill-revenue-snapshot.ts             (dry-run)
 *   npx ts-node src/scripts/backfill-revenue-snapshot.ts --apply      (écrit)
 *   npx ts-node src/scripts/backfill-revenue-snapshot.ts --apply --batch-size 500
 */
import { PrismaClient, VoucherStatus } from '@prisma/client';

const DEFAULT_BATCH_SIZE = 500;
// Filet de sécurité indépendant du curseur : même si un bug futur cassait la
// progression du curseur, on ne boucle jamais indéfiniment.
const MAX_BATCHES = 100_000;

interface BackfillCounters {
  eligibleFound: number;
  updated: number;
  skippedInvalidPrice: number;
  batches: number;
}

function parseArgs(argv: string[]) {
  const apply = argv.includes('--apply');
  const batchIdx = argv.indexOf('--batch-size');
  const batchSize =
    batchIdx !== -1 && argv[batchIdx + 1] ? Number(argv[batchIdx + 1]) : DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error('--batch-size doit être un entier positif');
  }
  return { apply, batchSize };
}

/**
 * Un seul lot, paginé par curseur sur `id` — ordre stable garanti par
 * `orderBy: { id: 'asc' }`. Traite chaque ligne indépendamment (pas de
 * transaction globale, idempotent ligne par ligne).
 */
async function runBatch(
  prisma: PrismaClient,
  apply: boolean,
  batchSize: number,
  cursorId: string | null,
): Promise<{
  processed: number;
  updated: number;
  skippedInvalidPrice: number;
  nextCursorId: string | null;
}> {
  const eligible = await prisma.voucher.findMany({
    where: {
      status: { in: [VoucherStatus.ACTIVE, VoucherStatus.USED] },
      usedAt: { not: null },
      priceXofAtActivation: null,
      ...(cursorId ? { id: { gt: cursorId } } : {}),
    },
    orderBy: { id: 'asc' },
    select: { id: true, plan: { select: { priceXof: true, deletedAt: true } } },
    take: batchSize,
  });

  let updated = 0;
  let skippedInvalidPrice = 0;

  for (const v of eligible) {
    const price = v.plan?.priceXof;
    const priceValid = typeof price === 'number' && Number.isInteger(price) && price > 0;
    if (!priceValid) {
      skippedInvalidPrice += 1;
      // Ne jamais écrire un faux EXACT/ESTIMATED pour faire "sortir" cette
      // ligne du filtre — la terminaison ne dépend pas de cette écriture,
      // elle dépend uniquement du curseur `id` (ci-dessous), qui avance
      // même pour les lignes non mises à jour.
      continue;
    }

    if (apply) {
      // Condition anti-écrasement répétée ici (pas seulement dans le SELECT
      // amont) : entre la lecture et l'écriture, un autre process aurait pu
      // déjà backfiller cette ligne — updateMany conditionnel, idempotent.
      const res = await prisma.voucher.updateMany({
        where: { id: v.id, priceXofAtActivation: null },
        data: { priceXofAtActivation: price, priceSnapshotSource: 'ESTIMATED_FROM_CURRENT_PLAN_PRICE' },
      });
      if (res.count > 0) updated += 1;
    } else {
      updated += 1; // dry-run : compté comme "aurait été mis à jour"
    }
  }

  const nextCursorId = eligible.length > 0 ? eligible[eligible.length - 1].id : cursorId;
  return { processed: eligible.length, updated, skippedInvalidPrice, nextCursorId };
}

export async function backfillRevenueSnapshot(
  prisma: PrismaClient,
  opts: { apply: boolean; batchSize: number },
): Promise<BackfillCounters> {
  const counters: BackfillCounters = {
    eligibleFound: 0,
    updated: 0,
    skippedInvalidPrice: 0,
    batches: 0,
  };

  let cursorId: string | null = null;

  for (let i = 0; i < MAX_BATCHES; i += 1) {
    const { processed, updated, skippedInvalidPrice, nextCursorId } = await runBatch(
      prisma,
      opts.apply,
      opts.batchSize,
      cursorId,
    );
    counters.batches += 1;
    counters.eligibleFound += processed;
    counters.updated += updated;
    counters.skippedInvalidPrice += skippedInvalidPrice;

    if (processed === 0) break; // plus aucune ligne éligible après le curseur — fin garantie
    // Le dry-run parcourt désormais TOUT le jeu éligible, comme --apply —
    // seule l'écriture (runBatch) est conditionnée par opts.apply, jamais la
    // pagination (corrige audit/56 §4 : un dry-run limité à un seul lot
    // sous-estimait le volume réel au-delà de batchSize).
    cursorId = nextCursorId; // avance TOUJOURS, y compris si toutes les lignes du lot étaient invalides
    if (processed < opts.batchSize) break; // dernier lot partiel = fin du jeu éligible atteinte
  }

  return counters;
}

async function main() {
  const { apply, batchSize } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();
  const startedAt = Date.now();

  try {
    console.log(
      `[backfill-revenue-snapshot] mode=${apply ? 'APPLY' : 'DRY-RUN'} batchSize=${batchSize}`,
    );
    const counters = await backfillRevenueSnapshot(prisma, { apply, batchSize });
    const durationMs = Date.now() - startedAt;

    // Journalisation strictement agrégée — aucun identifiant de voucher,
    // tenant, routeur ou forfait, conformément au mandat.
    console.log(
      JSON.stringify({
        mode: apply ? 'APPLY' : 'DRY-RUN',
        eligibleFound: counters.eligibleFound,
        updated: counters.updated,
        skippedInvalidPrice: counters.skippedInvalidPrice,
        batches: counters.batches,
        durationMs,
      }),
    );

    if (!apply && counters.eligibleFound > 0) {
      console.log(
        `[backfill-revenue-snapshot] Dry-run : ${counters.updated} ligne(s) seraient mises à jour. Relancer avec --apply pour écrire.`,
      );
    }
  } catch (err) {
    console.error('[backfill-revenue-snapshot] ÉCHEC', (err as Error).message);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}
