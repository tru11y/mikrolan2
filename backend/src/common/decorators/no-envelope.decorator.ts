import { SetMetadata } from '@nestjs/common';

export const NO_ENVELOPE_KEY = 'noEnvelope';

/**
 * Exclut la route de l'enveloppe `{ success, data, message, error }`.
 *
 * Réservé aux flux : un handler SSE émet un `MessageEvent` par évènement, et
 * l'intercepteur global emballait chacun d'eux, ce qui produisait un flux que
 * le client ne pouvait pas lire.
 */
export const NoEnvelope = () => SetMetadata(NO_ENVELOPE_KEY, true);
