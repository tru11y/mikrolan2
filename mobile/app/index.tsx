import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/src/providers/auth-provider';
import { theme } from '@/src/components/ui';

export default function Index() {
  const { isReady, isAuthenticated } = useAuth();

  if (!isReady) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator color={theme.primary} size="large" />
      </View>
    );
  }

  return <Redirect href={isAuthenticated ? '/(tabs)' : '/login'} />;
}
