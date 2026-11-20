'use client';

import { useQuery } from '@tanstack/react-query';
import { apiGet, extractErrorMessage } from '@/lib/api';
import { ErrorBox, Loading, PageHeader } from '@/components/ui';
import { ProfileSection } from '@/components/compte/ProfileSection';
import { PasswordSection } from '@/components/compte/PasswordSection';
import { NotificationsSection } from '@/components/compte/NotificationsSection';
import { SessionsSection } from '@/components/compte/SessionsSection';
import { RemoteAccessSection } from '@/components/compte/RemoteAccessSection';
import type { MeDetail } from '@/components/compte/types';

export default function ComptePage() {
  const me = useQuery({
    queryKey: ['auth', 'me-detail'],
    queryFn: () => apiGet<MeDetail>('/auth/me'),
  });

  return (
    <div>
      <PageHeader title="Mon compte" />
      {me.isLoading ? (
        <Loading />
      ) : me.error || !me.data ? (
        <ErrorBox message={me.error ? extractErrorMessage(me.error) : 'Compte introuvable.'} />
      ) : (
        <div className="space-y-4">
          <ProfileSection me={me.data} />
          {me.data.user.hasPassword && <PasswordSection />}
          <NotificationsSection enabled={me.data.user.notificationsEnabled} />
          <RemoteAccessSection />
          <SessionsSection />
        </div>
      )}
    </div>
  );
}
