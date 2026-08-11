import { Component, type PropsWithChildren, type ErrorInfo } from 'react';
import { View, Text, Pressable } from 'react-native';
import { theme } from './ui';

type State = { error: Error | null };

export class ErrorBoundary extends Component<PropsWithChildren, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;

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
          {this.state.error.message}
        </Text>
        <Pressable
          onPress={this.reset}
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
}
