export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { Redirect } from 'expo-router';

export default function OAuthRedirect() {
  return <Redirect href="/login" />;
}
