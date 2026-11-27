export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as WebBrowser from 'expo-web-browser';
import { useLocalSearchParams } from 'expo-router';
import { useNetInfo } from '@react-native-community/netinfo';
import { Banner, Button, Press, SectionTitle, space, Subtitle, Title } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { AppHeader } from '@/src/components/AppHeader';
import { useTunnelSession } from '@/src/hooks/useTunnelSession';
import { minutesRemaining, type LocalEndpoint } from '@/src/services/remote-tunnel/tunnelSession';

const DEFAULT_DURATION_MIN = 15;

/**
 * Accès distant par tunnel WSS 443 (WiFi filtrant).
 * - Android : bascule auto TUNNEL (repli DIRECT manuel via l'écran classique si échec).
 * - WebFig → navigateur externe (expo-web-browser) sur l'URL loopback.
 * - SSH → adresse 127.0.0.1:2222 + copie (terminal in-app : TODO, aucune lib présente).
 */
export default function RemoteTunnelScreen() {
  const theme = useTheme();
  const { routerId } = useLocalSearchParams<{ routerId: string }>();
  const net = useNetInfo();
  const { state, open, close } = useTunnelSession(routerId);
  const [now, setNow] = useState(Date.now());

  const online = net.isConnected !== false;
  const autoTunnel = Platform.OS === 'android';

  useEffect(() => {
    if (!autoTunnel || !online) return;
    if (state.phase === 'idle') void open(DEFAULT_DURATION_MIN);
  }, [autoTunnel, online, state.phase, open]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = useMemo(() => minutesRemaining(state, now), [state, now]);

  const webfig = state.endpoints.find((e) => e.name === 'webfig');
  const ssh = state.endpoints.find((e) => e.name === 'ssh');
  const winbox = state.endpoints.find((e) => e.name === 'winbox');

  const openWebfig = useCallback((ep: LocalEndpoint) => {
    void WebBrowser.openBrowserAsync(ep.url);
  }, []);

  const copyAddress = useCallback((ep: LocalEndpoint) => {
    void Clipboard.setStringAsync(`${ep.host}:${ep.port}`);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title="Accès distant (tunnel 443)" back />
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg }}>
        {!online && <Banner tone="warning">Hors ligne — le tunnel nécessite une connexion.</Banner>}

        {state.phase === 'error' && (
          <Banner tone="danger">
            {`Tunnel indisponible${state.error ? ` (${state.error})` : ''}. `}
            Repli possible : ouvrez l&apos;accès direct depuis les réglages du routeur.
          </Banner>
        )}
        {state.phase === 'expired' && (
          <Banner tone="warning">Fenêtre expirée. Rouvrez l&apos;accès pour continuer.</Banner>
        )}

        <View style={{ gap: space.xs }}>
          <Title>État</Title>
          <Subtitle>{phaseLabel(state.phase)}</Subtitle>
          {remaining !== null && state.phase === 'ready' && (
            <Text style={{ color: theme.textMuted }}>
              {`Fenêtre : ${remaining} min restantes`}
            </Text>
          )}
        </View>

        {(state.phase === 'idle' || state.phase === 'error' || state.phase === 'expired') && (
          <Button title="Ouvrir l'accès distant" onPress={() => void open(DEFAULT_DURATION_MIN)} />
        )}

        {state.phase === 'ready' && (
          <>
            <SectionTitle>Services</SectionTitle>

            <ServiceCard
              title="WebFig"
              subtitle={webfig ? webfig.url : 'En cours de liaison…'}
              actionLabel="Ouvrir dans le navigateur"
              disabled={!webfig}
              onPress={() => webfig && openWebfig(webfig)}
            />

            <ServiceCard
              title="SSH"
              subtitle={ssh ? `${ssh.host}:${ssh.port}` : 'En cours de liaison…'}
              actionLabel="Copier l'adresse"
              disabled={!ssh}
              onPress={() => ssh && copyAddress(ssh)}
            />
            {/* TODO terminal in-app : aucune lib terminal présente dans le repo.
                En attendant, l'adresse loopback est copiable pour un client SSH tiers. */}

            {winbox && (
              <ServiceCard
                title="Winbox"
                subtitle={`${winbox.host}:${winbox.port}`}
                actionLabel="Copier l'adresse"
                instruction="Ouvre l'app Winbox et connecte-toi à cette adresse. Garde MikroLan ouvert ou utilise la notification « Tunnel actif » pour fermer."
                onPress={() => copyAddress(winbox)}
              />
            )}

            <Button title="Fermer l'accès" variant="danger" onPress={close} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

function ServiceCard({
  title,
  subtitle,
  actionLabel,
  onPress,
  disabled,
  instruction,
}: {
  title: string;
  subtitle: string;
  actionLabel: string;
  onPress: () => void;
  disabled?: boolean;
  instruction?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ backgroundColor: theme.surface, borderRadius: 16, padding: 16, gap: space.sm }}>
      <Text style={{ color: theme.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
      <Text style={{ color: theme.textMuted, fontFamily: 'monospace' }}>{subtitle}</Text>
      {instruction && (
        <Text style={{ color: theme.textMuted, fontSize: 13 }}>{instruction}</Text>
      )}
      <Press
        accessibilityLabel={actionLabel}
        onPress={onPress}
        disabled={disabled}
        style={{ opacity: disabled ? 0.5 : 1 }}
      >
        <Text style={{ color: theme.primary, fontWeight: '600' }}>{actionLabel}</Text>
      </Press>
    </View>
  );
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'requesting':
      return 'Ouverture de la fenêtre…';
    case 'granted':
      return 'Autorisation reçue…';
    case 'connecting':
      return 'Connexion au tunnel…';
    case 'ready':
      return 'Tunnel actif';
    case 'closing':
      return 'Fermeture…';
    case 'closed':
      return 'Fermé';
    case 'expired':
      return 'Expiré';
    case 'error':
      return 'Erreur';
    default:
      return 'Inactif';
  }
}
