import type { ForecastConfidence } from './forecast.types';

export type InsightType =
  | 'HIGH_REVENUE_CONTRIBUTION'
  | 'HIGH_VOLUME_CONTRIBUTION'
  | 'GROWTH_OBSERVED'
  | 'DECLINE_OBSERVED'
  | 'MOST_ACTIVE_DAY'
  | 'MOST_ACTIVE_HOUR'
  | 'ROUTER_MAJOR_SHARE'
  | 'PLAN_HIGH_VOLUME_LOW_CONTRIBUTION'
  | 'PLAN_LOW_VOLUME_HIGH_CONTRIBUTION'
  | 'LOW_CONVERSION_RATE'
  | 'HIGH_CONVERSION_RATE'
  | 'HIGH_ARPU'
  | 'LOW_ARPU'
  | 'HIGH_DATA_USAGE'
  | 'INSUFFICIENT_DATA';

export interface Insight {
  type: InsightType;
  title: string;
  observation: string;
  evidence: string;
  period: { from: string; to: string };
  confidence: ForecastConfidence;
  recommendedAction: string | null;
  limitations: string;
}

const LIMITATIONS_STANDARD =
  "Basé uniquement sur l'historique observé ; ne prédit pas d'événement externe (météo, panne, promotion).";

/**
 * Règles déterministes, testables une à une — jamais de causalité inventée,
 * jamais de jugement "bon"/"mauvais", jamais de chiffre halluciné. Chaque
 * insight cite l'evidence exacte (pourcentage, comparaison) qui l'a produit.
 */

export function insightHighRevenueContribution(
  name: string,
  contributionPercent: number,
  period: { from: string; to: string },
): Insight | null {
  if (contributionPercent < 50) return null;
  return {
    type: 'HIGH_REVENUE_CONTRIBUTION',
    title: `${name} : forte contribution au chiffre d'affaires`,
    observation: `${name} représente ${contributionPercent.toFixed(0)} % du chiffre d'affaires de la période.`,
    evidence: `contributionPercent=${contributionPercent.toFixed(1)}`,
    period,
    confidence: 'HIGH',
    recommendedAction: null,
    limitations: LIMITATIONS_STANDARD,
  };
}

export function insightHighVolumeContribution(
  name: string,
  contributionPercent: number,
  period: { from: string; to: string },
): Insight | null {
  if (contributionPercent < 50) return null;
  return {
    type: 'HIGH_VOLUME_CONTRIBUTION',
    title: `${name} : forte contribution au volume de ventes`,
    observation: `${name} représente ${contributionPercent.toFixed(0)} % des ventes de la période.`,
    evidence: `contributionPercent=${contributionPercent.toFixed(1)}`,
    period,
    confidence: 'HIGH',
    recommendedAction: null,
    limitations: LIMITATIONS_STANDARD,
  };
}

export function insightTrend(
  name: string,
  changePercent: number,
  period: { from: string; to: string },
  confidence: ForecastConfidence,
): Insight | null {
  if (Math.abs(changePercent) < 10) return null;
  const growing = changePercent > 0;
  return {
    type: growing ? 'GROWTH_OBSERVED' : 'DECLINE_OBSERVED',
    title: growing ? `${name} : croissance observée` : `${name} : baisse observée`,
    observation: `${name} ${growing ? 'augmente' : 'baisse'} de ${Math.abs(changePercent).toFixed(0)} % entre la première et la seconde moitié de la période observée.`,
    evidence: `changePercent=${changePercent.toFixed(1)}`,
    period,
    confidence,
    recommendedAction: null,
    limitations: LIMITATIONS_STANDARD,
  };
}

export function insightMostActiveDay(
  dayLabel: string,
  count: number,
  period: { from: string; to: string },
  confidence: ForecastConfidence,
): Insight {
  return {
    type: 'MOST_ACTIVE_DAY',
    title: 'Jour historiquement le plus actif',
    observation: `${dayLabel} est le jour le plus actif sur la période observée (${count} au total).`,
    evidence: `count=${count}`,
    period,
    confidence,
    recommendedAction: null,
    limitations: LIMITATIONS_STANDARD,
  };
}

export function insightMostActiveHour(
  hour: number,
  count: number,
  period: { from: string; to: string },
  confidence: ForecastConfidence,
): Insight {
  return {
    type: 'MOST_ACTIVE_HOUR',
    title: 'Heure historiquement la plus active',
    observation: `${hour}h est l'heure la plus active sur la période observée (${count} au total).`,
    evidence: `count=${count}`,
    period,
    confidence,
    recommendedAction: null,
    limitations: LIMITATIONS_STANDARD,
  };
}

export function insightRouterMajorShare(
  routerName: string,
  contributionPercent: number,
  period: { from: string; to: string },
): Insight | null {
  if (contributionPercent < 60) return null;
  return {
    type: 'ROUTER_MAJOR_SHARE',
    title: `${routerName} représente une part importante du revenu`,
    observation: `${routerName} représente ${contributionPercent.toFixed(0)} % du chiffre d'affaires du tenant sur la période.`,
    evidence: `contributionPercent=${contributionPercent.toFixed(1)}`,
    period,
    confidence: 'HIGH',
    recommendedAction: null,
    limitations: LIMITATIONS_STANDARD,
  };
}

export function insightPlanVolumeVsContributionMismatch(
  planName: string,
  salesContributionPercent: number,
  revenueContributionPercent: number,
  period: { from: string; to: string },
): Insight | null {
  const gap = salesContributionPercent - revenueContributionPercent;
  if (gap >= 20) {
    return {
      type: 'PLAN_HIGH_VOLUME_LOW_CONTRIBUTION',
      title: `${planName} : fort volume, faible contribution au CA`,
      observation: `${planName} représente ${salesContributionPercent.toFixed(0)} % des ventes mais seulement ${revenueContributionPercent.toFixed(0)} % du chiffre d'affaires de la période.`,
      evidence: `salesContributionPercent=${salesContributionPercent.toFixed(1)},revenueContributionPercent=${revenueContributionPercent.toFixed(1)}`,
      period,
      confidence: 'HIGH',
      recommendedAction: null,
      limitations: LIMITATIONS_STANDARD,
    };
  }
  if (gap <= -20) {
    return {
      type: 'PLAN_LOW_VOLUME_HIGH_CONTRIBUTION',
      title: `${planName} : faible volume, forte contribution au CA`,
      observation: `${planName} représente ${revenueContributionPercent.toFixed(0)} % du chiffre d'affaires mais seulement ${salesContributionPercent.toFixed(0)} % des ventes de la période.`,
      evidence: `salesContributionPercent=${salesContributionPercent.toFixed(1)},revenueContributionPercent=${revenueContributionPercent.toFixed(1)}`,
      period,
      confidence: 'HIGH',
      recommendedAction: null,
      limitations: LIMITATIONS_STANDARD,
    };
  }
  return null;
}

export function insightConversionRate(
  generated: number,
  used: number,
  period: { from: string; to: string },
): Insight | null {
  if (generated < 10) return null;
  const rate = Math.round((used / generated) * 100);
  if (rate < 30) {
    return {
      type: 'LOW_CONVERSION_RATE',
      title: 'Taux de conversion faible',
      observation: `Seulement ${rate} % des tickets générés ont été utilisés (${used}/${generated}).`,
      evidence: `conversionRate=${rate}`,
      period,
      confidence: 'HIGH',
      recommendedAction: 'Réduire la quantité de tickets pré-imprimés pour limiter le gaspillage.',
      limitations: LIMITATIONS_STANDARD,
    };
  }
  if (rate >= 80) {
    return {
      type: 'HIGH_CONVERSION_RATE',
      title: 'Taux de conversion élevé',
      observation: `${rate} % des tickets générés ont été utilisés (${used}/${generated}).`,
      evidence: `conversionRate=${rate}`,
      period,
      confidence: 'HIGH',
      recommendedAction: null,
      limitations: LIMITATIONS_STANDARD,
    };
  }
  return null;
}

export function insightArpu(
  revenueXof: number,
  salesCount: number,
  previousArpu: number | null,
  period: { from: string; to: string },
): Insight | null {
  if (salesCount < 5) return null;
  const arpu = Math.round(revenueXof / salesCount);
  if (previousArpu !== null && previousArpu > 0) {
    const change = Math.round(((arpu - previousArpu) / previousArpu) * 100);
    if (change >= 20) {
      return {
        type: 'HIGH_ARPU',
        title: 'Panier moyen en hausse',
        observation: `Le panier moyen est de ${arpu} FCFA, en hausse de ${change} % par rapport à la période précédente.`,
        evidence: `arpu=${arpu},previousArpu=${previousArpu},change=${change}`,
        period,
        confidence: 'MEDIUM',
        recommendedAction: null,
        limitations: LIMITATIONS_STANDARD,
      };
    }
    if (change <= -20) {
      return {
        type: 'LOW_ARPU',
        title: 'Panier moyen en baisse',
        observation: `Le panier moyen est de ${arpu} FCFA, en baisse de ${Math.abs(change)} % par rapport à la période précédente.`,
        evidence: `arpu=${arpu},previousArpu=${previousArpu},change=${change}`,
        period,
        confidence: 'MEDIUM',
        recommendedAction: 'Vérifier si un forfait peu cher a capté une part inhabituelle des ventes.',
        limitations: LIMITATIONS_STANDARD,
      };
    }
  }
  return null;
}

export function insightHighDataUsage(
  routerName: string,
  bytesTotal: bigint,
  sessionCount: number,
  period: { from: string; to: string },
): Insight | null {
  if (sessionCount < 5) return null;
  const avgMb = Number(bytesTotal / BigInt(sessionCount)) / (1024 * 1024);
  if (avgMb >= 500) {
    return {
      type: 'HIGH_DATA_USAGE',
      title: `${routerName} : consommation de données élevée`,
      observation: `Moyenne de ${Math.round(avgMb)} Mo par session sur ${routerName} (${sessionCount} sessions).`,
      evidence: `avgMb=${Math.round(avgMb)},sessionCount=${sessionCount}`,
      period,
      confidence: 'MEDIUM',
      recommendedAction: 'Vérifier si les limites de données des forfaits sont adaptées.',
      limitations: LIMITATIONS_STANDARD,
    };
  }
  return null;
}

export function insightInsufficientData(subject: string, reason: string, period: { from: string; to: string }): Insight {
  return {
    type: 'INSUFFICIENT_DATA',
    title: `${subject} : données insuffisantes`,
    observation: reason,
    evidence: 'n/a',
    period,
    confidence: 'INSUFFICIENT_DATA',
    recommendedAction: null,
    limitations: LIMITATIONS_STANDARD,
  };
}
