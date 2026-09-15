import { View, Text, Pressable } from 'react-native';
import { useTheme } from '@/src/providers/theme-provider';
import { Sentry } from '@/src/lib/sentry';
import { useEffect } from 'react';

interface Props {
  error: Error;
  retry: () => void;
}

export function ScreenErrorBoundary({ error, retry }: Props) {
  const theme = useTheme();

  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.bg,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
      }}
    >
      <Text
        style={{
          color: theme.text,
          fontSize: 18,
          fontWeight: '700',
          marginBottom: 12,
          textAlign: 'center',
        }}
      >
        Une erreur est survenue
      </Text>
      <Text
        style={{
          color: theme.textMuted,
          fontSize: 13,
          textAlign: 'center',
          marginBottom: 24,
          fontFamily: theme.mono,
        }}
      >
        {error.message}
      </Text>
      <Pressable
        onPress={retry}
        style={{
          backgroundColor: theme.primary,
          borderRadius: 12,
          paddingHorizontal: 24,
          paddingVertical: 12,
        }}
      >
        <Text style={{ color: '#fff', fontWeight: '600', fontSize: 15 }}>
          Réessayer
        </Text>
      </Pressable>
    </View>
  );
}
