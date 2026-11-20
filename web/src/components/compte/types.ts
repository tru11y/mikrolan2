// Types locaux au cluster Compte — miroir du contrat NestJS /auth/me et
// /remote-access. Ne pas éditer @/lib/types ; compléter ici (voir contrat).

import type { UserRole } from '@/lib/types';

export type MeDetail = {
  user: {
    id: string;
    email: string;
    name: string | null;
    country: string | null;
    role: UserRole;
    status: string;
    notificationsEnabled: boolean;
    hasPassword: boolean;
    termsVersion: string | null;
    privacyVersion: string | null;
  };
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    remoteAccessAcceptedAt: string | null;
    remoteAccessVersion: string | null;
  };
  subscription: {
    plan: 'FREE' | 'PRO';
    status: string;
    currentPeriodEnd: string | null;
  } | null;
  legal: {
    terms: string;
    privacy: string;
    remoteAccess: string;
  };
};

export type RemoteAccessAuthorization = {
  accepted: boolean;
  acceptedAt: string | null;
  acceptedVersion: string | null;
  currentVersion: string;
};
