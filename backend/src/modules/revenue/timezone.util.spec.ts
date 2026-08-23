import {
  isValidIanaTimezone,
  resolveTenantTimezone,
  startOfLocalDayUtc,
  startOfLocalWeekUtc,
  startOfLocalMonthUtc,
} from './timezone.util';

describe('timezone.util', () => {
  describe('isValidIanaTimezone / resolveTenantTimezone', () => {
    it('accepte un identifiant IANA valide', () => {
      expect(isValidIanaTimezone('Africa/Abidjan')).toBe(true);
      expect(isValidIanaTimezone('Europe/Paris')).toBe(true);
    });

    it('rejette un identifiant invalide', () => {
      expect(isValidIanaTimezone('Not/AZone')).toBe(false);
    });

    it("retombe sur Africa/Abidjan si null/undefined/invalide", () => {
      expect(resolveTenantTimezone(null)).toBe('Africa/Abidjan');
      expect(resolveTenantTimezone(undefined)).toBe('Africa/Abidjan');
      expect(resolveTenantTimezone('Bogus/Zone')).toBe('Africa/Abidjan');
    });

    it('respecte une timezone valide fournie', () => {
      expect(resolveTenantTimezone('Europe/Paris')).toBe('Europe/Paris');
    });
  });

  describe('startOfLocalDayUtc — Africa/Abidjan (UTC+0, cas simple)', () => {
    it('minuit UTC = minuit local (aucun décalage)', () => {
      const instant = new Date('2026-08-15T14:30:00Z');
      const start = startOfLocalDayUtc(instant, 'Africa/Abidjan');
      expect(start.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    });
  });

  describe('startOfLocalDayUtc — timezone différente avec décalage', () => {
    it('Asia/Tokyo (UTC+9) : minuit local le 16 correspond à 15T15:00 UTC', () => {
      const instant = new Date('2026-08-15T20:00:00Z'); // 2026-08-16 05:00 à Tokyo
      const start = startOfLocalDayUtc(instant, 'Asia/Tokyo');
      expect(start.toISOString()).toBe('2026-08-15T15:00:00.000Z');
    });
  });

  describe('borne de journée UTC correcte autour de minuit', () => {
    it("un instant juste avant minuit local reste dans le jour précédent", () => {
      // 23:59 UTC à Abidjan (UTC+0) = encore le 15 août.
      const instant = new Date('2026-08-15T23:59:00Z');
      const start = startOfLocalDayUtc(instant, 'Africa/Abidjan');
      expect(start.toISOString()).toBe('2026-08-15T00:00:00.000Z');
    });
  });

  describe('DST — Europe/Paris (fuseau avec heure d\'été/hiver)', () => {
    it('minuit local en été (CEST, UTC+2)', () => {
      const instant = new Date('2026-07-15T10:00:00Z');
      const start = startOfLocalDayUtc(instant, 'Europe/Paris');
      expect(start.toISOString()).toBe('2026-07-14T22:00:00.000Z');
    });

    it('minuit local en hiver (CET, UTC+1) — l\'offset change bien avec la saison', () => {
      const instant = new Date('2026-01-15T10:00:00Z');
      const start = startOfLocalDayUtc(instant, 'Europe/Paris');
      expect(start.toISOString()).toBe('2026-01-14T23:00:00.000Z');
    });
  });

  describe('startOfLocalWeekUtc — lundi comme début de semaine', () => {
    it('un jeudi retombe sur le lundi de la même semaine', () => {
      // 2026-08-20 est un jeudi.
      const instant = new Date('2026-08-20T12:00:00Z');
      const start = startOfLocalWeekUtc(instant, 'Africa/Abidjan');
      expect(start.toISOString()).toBe('2026-08-17T00:00:00.000Z'); // lundi 17 août
    });

    it('un lundi retombe sur lui-même', () => {
      const instant = new Date('2026-08-17T12:00:00Z');
      const start = startOfLocalWeekUtc(instant, 'Africa/Abidjan');
      expect(start.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    });

    it('un dimanche retombe sur le lundi précédent (pas le suivant)', () => {
      const instant = new Date('2026-08-23T12:00:00Z'); // dimanche
      const start = startOfLocalWeekUtc(instant, 'Africa/Abidjan');
      expect(start.toISOString()).toBe('2026-08-17T00:00:00.000Z');
    });
  });

  describe('startOfLocalMonthUtc', () => {
    it('premier jour du mois calendaire local', () => {
      const instant = new Date('2026-08-20T12:00:00Z');
      const start = startOfLocalMonthUtc(instant, 'Africa/Abidjan');
      expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    });

    it('fonctionne avec un fuseau décalé (Asia/Tokyo)', () => {
      const instant = new Date('2026-07-31T20:00:00Z'); // déjà le 1er août à Tokyo
      const start = startOfLocalMonthUtc(instant, 'Asia/Tokyo');
      expect(start.toISOString()).toBe('2026-07-31T15:00:00.000Z'); // 1er août 00:00 Tokyo = 31 juil 15:00 UTC
    });
  });
});
