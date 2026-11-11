import { reconcileTierText, routerLimitLabel } from './tiers.service';

describe('reconcileTierText — les faits structurés l’emportent sur le texte libre', () => {
  const stale = [
    { label: 'Jusqu’à 3 routeurs MikroTik', included: true },
    { label: 'Génération de tickets illimitée', included: true },
    { label: 'Accès distant multi-sites', included: true },
  ];

  it('réécrit la ligne routeurs et l’accroche quand la limite réelle est 2', () => {
    const out = reconcileTierText({ routerLimit: 2, remoteAccess: false, tagline: 'Jusqu’à 3 routeurs' }, stale);
    expect(out.tagline).toBe('Jusqu’à 2 routeurs');
    expect(out.features[0]).toEqual({ label: 'Jusqu’à 2 routeurs MikroTik', included: true });
  });

  it('décoche « Accès distant » quand remoteAccess est faux', () => {
    const out = reconcileTierText({ routerLimit: 2, remoteAccess: false, tagline: null }, stale);
    expect(out.features[2]).toEqual({ label: 'Accès distant multi-sites', included: false });
  });

  it('laisse intacts les textes qui ne parlent ni de routeurs ni d’accès distant', () => {
    const out = reconcileTierText({ routerLimit: 2, remoteAccess: true, tagline: 'Le plus choisi' }, stale);
    expect(out.tagline).toBe('Le plus choisi');
    expect(out.features[1]).toEqual(stale[1]);
  });

  it('gère illimité et 1 routeur', () => {
    expect(routerLimitLabel(null)).toBe('Routeurs MikroTik illimités');
    expect(routerLimitLabel(1)).toBe('1 routeur MikroTik');
  });
});
