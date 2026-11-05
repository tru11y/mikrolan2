import { expiryLevel } from './ops-health.service';

describe('expiryLevel', () => {
  it('GREEN when nothing pending', () => expect(expiryLevel(0, null)).toBe('GREEN'));
  it('ORANGE when pending under 30 min', () => expect(expiryLevel(3, 10)).toBe('ORANGE'));
  it('RED when oldest pending >= 30 min', () => expect(expiryLevel(108, 30)).toBe('RED'));
});
