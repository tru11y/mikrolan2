'use client';

import { type ReactNode } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiGet, extractErrorMessage } from '@/lib/api';
import { ErrorBox, Loading } from '@/components/ui';
import { RouterMetaBadges, RouterTabs, type RouterItem } from '@/components/routeurs/shared';

export default function RouterDetailLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const router = useQuery({
    queryKey: ['router', id],
    queryFn: () => apiGet<RouterItem>(`/routers/${id}`),
    enabled: Boolean(id),
  });

  return (
    <div>
      <div className="mb-5">
        <Link href="/routeurs" className="text-sm text-muted hover:text-fg">
          ← Routeurs
        </Link>
      </div>

      {router.isLoading ? (
        <Loading />
      ) : router.error ? (
        <ErrorBox message={extractErrorMessage(router.error)} />
      ) : router.data ? (
        <>
          <div className="mb-5">
            <h1 className="text-2xl font-bold text-fg">
              {router.data.alias || router.data.identity}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <RouterMetaBadges router={router.data} />
              {router.data.model && <span className="text-sm text-muted">{router.data.model}</span>}
            </div>
          </div>
          <RouterTabs routerId={id} />
          {children}
        </>
      ) : null}
    </div>
  );
}
