import { SetMetadata } from '@nestjs/common';

export const ALWAYS_ALLOWED_KEY = 'alwaysAllowed';

/**
 * Reachable even when the tenant is locked out by the paywall. Reserved for the
 * account itself and the upgrade flow — a locked customer must still be able to
 * see who they are, and to pay.
 */
export const AlwaysAllowed = () => SetMetadata(ALWAYS_ALLOWED_KEY, true);
