import {
  insightConversionRate,
  insightArpu,
  insightHighDataUsage,
  insightHighRevenueContribution,
  insightRouterMajorShare,
  insightPlanVolumeVsContributionMismatch,
} from './forecast.insights';

const period = { from: '2026-08-01T00:00:00Z', to: '2026-08-31T00:00:00Z' };

describe('forecast.insights', () => {
  describe('insightConversionRate', () => {
    it('returns null when fewer than 10 tickets generated', () => {
      expect(insightConversionRate(5, 3, period)).toBeNull();
    });

    it('flags low conversion when under 30%', () => {
      const result = insightConversionRate(100, 20, period);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('LOW_CONVERSION_RATE');
      expect(result!.recommendedAction).toBeTruthy();
    });

    it('flags high conversion when 80%+', () => {
      const result = insightConversionRate(100, 85, period);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('HIGH_CONVERSION_RATE');
    });

    it('returns null for normal conversion rate', () => {
      expect(insightConversionRate(100, 50, period)).toBeNull();
    });
  });

  describe('insightArpu', () => {
    it('returns null when fewer than 5 sales', () => {
      expect(insightArpu(10000, 3, 2000, period)).toBeNull();
    });

    it('flags ARPU increase of 20%+', () => {
      const result = insightArpu(15000, 10, 1000, period);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('HIGH_ARPU');
    });

    it('flags ARPU decrease of 20%+', () => {
      const result = insightArpu(5000, 10, 1000, period);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('LOW_ARPU');
      expect(result!.recommendedAction).toBeTruthy();
    });

    it('returns null when no previous ARPU', () => {
      expect(insightArpu(10000, 10, null, period)).toBeNull();
    });
  });

  describe('insightHighDataUsage', () => {
    it('returns null when fewer than 5 sessions', () => {
      expect(insightHighDataUsage('R1', BigInt(1024 * 1024 * 1000), 3, period)).toBeNull();
    });

    it('flags when avg >= 500MB per session', () => {
      const bytesTotal = BigInt(1024 * 1024 * 600) * BigInt(10);
      const result = insightHighDataUsage('R1', bytesTotal, 10, period);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('HIGH_DATA_USAGE');
    });

    it('returns null when avg is low', () => {
      const bytesTotal = BigInt(1024 * 1024 * 10) * BigInt(10);
      expect(insightHighDataUsage('R1', bytesTotal, 10, period)).toBeNull();
    });
  });

  describe('existing insight functions', () => {
    it('insightHighRevenueContribution triggers at 50%+', () => {
      expect(insightHighRevenueContribution('R1', 49, period)).toBeNull();
      expect(insightHighRevenueContribution('R1', 51, period)).not.toBeNull();
    });

    it('insightRouterMajorShare triggers at 60%+', () => {
      expect(insightRouterMajorShare('R1', 59, period)).toBeNull();
      expect(insightRouterMajorShare('R1', 61, period)).not.toBeNull();
    });

    it('insightPlanVolumeVsContributionMismatch triggers at 20+ gap', () => {
      const highVol = insightPlanVolumeVsContributionMismatch('P1', 60, 30, period);
      expect(highVol).not.toBeNull();
      expect(highVol!.type).toBe('PLAN_HIGH_VOLUME_LOW_CONTRIBUTION');

      const lowVol = insightPlanVolumeVsContributionMismatch('P1', 30, 60, period);
      expect(lowVol).not.toBeNull();
      expect(lowVol!.type).toBe('PLAN_LOW_VOLUME_HIGH_CONTRIBUTION');

      expect(insightPlanVolumeVsContributionMismatch('P1', 45, 40, period)).toBeNull();
    });
  });
});
