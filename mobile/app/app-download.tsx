export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useRef, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type AppRelease } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { reportSilent } from '@/src/lib/report';
import {
  fmtBytes,
  installedState,
  logFailureBlocksDownload,
  nextDownloadStep,
  parseVersionCode,
  type InstalledState,
} from '@/src/lib/releaseDownload';
import {
  Badge,
  Banner,
  Button,
  Card,
  ErrorState,
  FadeIn,
  radius,
  Row,
  Skeleton,
  space,
  type,
  useToast,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';

const STATE_TONE: Record<InstalledState, 'success' | 'warning' | 'danger'> = {
  upToDate: 'success',
  updateAvailable: 'warning',
  updateRequired: 'danger',
};

const STATE_KEY: Record<InstalledState, string> = {
  upToDate: 'appDownload.stateUpToDate',
  updateAvailable: 'appDownload.stateUpdateAvailable',
  updateRequired: 'appDownload.stateUpdateRequired',
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 4 }}>
      <Text style={{ color: theme.textMuted, fontSize: type.body }}>{label}</Text>
      <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>{value}</Text>
    </Row>
  );
}

function HistoryRow({ release }: { release: AppRelease }) {
  const theme = useTheme();
  const { t } = useTranslation();
  return (
    <Row style={{ justifyContent: 'space-between', paddingVertical: 6, gap: space.sm }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700' }}>
          v{release.versionName} ({release.versionCode})
        </Text>
        <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
          {fmtDate(release.publishedAt)} · {fmtBytes(release.fileSize)}
        </Text>
      </View>
      <Row style={{ gap: 6 }}>
        {release.isActive ? <Badge label={t('appDownload.active')} tone="success" /> : null}
        {release.isRequired ? <Badge label={t('appDownload.required')} tone="danger" /> : null}
      </Row>
    </Row>
  );
}

export default function AppDownloadScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [downloading, setDownloading] = useState(false);
  // Le state ne change qu'au rendu suivant : un ref bloque les taps du même frame.
  const lock = useRef(false);

  const latestQuery = useQuery({ queryKey: ['releases', 'latest'], queryFn: api.releases.latest });
  const historyQuery = useQuery({ queryKey: ['releases', 'history'], queryFn: api.releases.history });

  const installedCode = parseVersionCode(
    Constants.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode,
  );
  const installedName = Constants.expoConfig?.version ?? '—';
  const latest = latestQuery.data;
  const state = latest ? installedState(installedCode, latest) : null;

  async function download() {
    if (lock.current) return;
    lock.current = true;
    setDownloading(true);
    try {
      // URL signée de courte durée : toujours en redemander une fraîche (jamais celle du cache).
      const fresh = await api.releases.latest();
      qc.setQueryData(['releases', 'latest'], fresh);
      const step = nextDownloadStep(fresh);
      if (step.kind === 'fail') {
        toast.error(t('appDownload.noUrl'));
        return;
      }
      try {
        await api.releases.logDownload(fresh.id);
      } catch (e) {
        const described = describeError(e);
        reportSilent('app-download.log', e, { releaseId: fresh.id });
        if (logFailureBlocksDownload(described.status)) {
          toast.error(described.message);
          void qc.invalidateQueries({ queryKey: ['releases'] });
          return;
        }
      }
      try {
        await Linking.openURL(step.url);
      } catch (e) {
        reportSilent('app-download.open', e, { releaseId: fresh.id });
        toast.error(t('appDownload.openFailed'));
      }
    } catch (e) {
      reportSilent('app-download.fetch', e);
      toast.error(describeError(e).message);
      void qc.invalidateQueries({ queryKey: ['releases'] });
    } finally {
      lock.current = false;
      setDownloading(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('appDownload.title')} back />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        <Card>
          <InfoRow label={t('appDownload.installed')} value={`v${installedName} (${installedCode ?? '—'})`} />
        </Card>

        {latestQuery.isLoading ? (
          <Skeleton height={220} radius={radius.md} />
        ) : latestQuery.isError || !latest ? (
          <ErrorState
            message={describeError(latestQuery.error).message}
            onRetry={() => void latestQuery.refetch()}
            retrying={latestQuery.isFetching}
          />
        ) : (
          <FadeIn>
            <View style={{ gap: space.lg }}>
              {state ? <Banner tone={STATE_TONE[state]}>{t(STATE_KEY[state])}</Banner> : null}
              <Card>
                <InfoRow
                  label={t('appDownload.latest')}
                  value={`v${latest.versionName} (${latest.versionCode})`}
                />
                <InfoRow label={t('appDownload.minimum')} value={String(latest.minVersionCode)} />
                <InfoRow label={t('appDownload.published')} value={fmtDate(latest.publishedAt)} />
                <InfoRow label={t('appDownload.size')} value={fmtBytes(latest.fileSize)} />
                <Text
                  style={{ color: theme.text, fontSize: type.body, fontWeight: '700', marginTop: space.md }}
                >
                  {t('appDownload.notes')}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: type.body, marginTop: 4 }}>
                  {latest.releaseNotes}
                </Text>
              </Card>
              <Button
                title={t('appDownload.download')}
                onPress={() => void download()}
                loading={downloading}
                disabled={downloading}
              />
            </View>
          </FadeIn>
        )}

        {historyQuery.data?.length ? (
          <Card>
            <Text style={{ color: theme.text, fontSize: type.body, fontWeight: '700', marginBottom: 4 }}>
              {t('appDownload.history')}
            </Text>
            {historyQuery.data.map((r) => (
              <HistoryRow key={r.id} release={r} />
            ))}
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
