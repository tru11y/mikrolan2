import { useState } from 'react';
import { ScrollView, View, Text, Alert, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { api } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  Button,
  ErrorState,
  FadeIn,
  Press,
  radius,
  Row,
  space,
  Skeleton,
  Subtitle,
  theme,
  Title,
  type,
  useToast,
} from '@/src/components/ui';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

type PaymentMethod = 'WAVE' | 'ORANGE_MONEY';

function MethodCard({
  method,
  number,
  selected,
  onPress,
}: {
  method: PaymentMethod;
  number: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const isWave = method === 'WAVE';
  const color = isWave ? '#1DC3F7' : '#FF6600';
  const label = isWave ? 'Wave' : 'Orange Money';
  const icon = isWave ? 'wallet-outline' : 'phone-portrait-outline';

  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={t('payment.payWith', { method: label })}
      onPress={onPress}
      scaleTo={0.97}
      style={{
        borderRadius: radius.lg,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? color : theme.border,
        backgroundColor: theme.surface,
        padding: space.xl,
      }}
    >
      <Row style={{ justifyContent: 'space-between' }}>
        <Row style={{ gap: space.md }}>
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: radius.md,
              backgroundColor: color + '22',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name={icon as any} size={22} color={color} />
          </View>
          <View>
            <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}>
              {label}
            </Text>
            {number ? (
              <Text
                selectable
                style={{ color: theme.gold, fontSize: type.h2, fontWeight: '800', marginTop: 4 }}
              >
                {number}
              </Text>
            ) : (
              <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                {t('common.notConfigured')}
              </Text>
            )}
          </View>
        </Row>
        {selected ? (
          <Ionicons name="checkmark-circle" size={24} color={color} />
        ) : null}
      </Row>
    </Press>
  );
}

export default function PaymentScreen() {
  const { t } = useTranslation();
  const { invoiceId } = useLocalSearchParams<{ invoiceId: string }>();
  const navHeight = useBottomNavHeight();
  const toast = useToast();

  const paymentInfoQuery = useQuery({
    queryKey: ['payment-info'],
    queryFn: () => api.subscriptions.paymentInfo(),
  });

  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sent, setSent] = useState(false);

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.7,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function takePhoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('payment.permissionRequired'), t('payment.cameraPermission'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
    }
  }

  async function submit() {
    if (!method || !imageUri || !invoiceId) return;
    setUploading(true);
    try {
      const res = await api.subscriptions.uploadProof(invoiceId, method, imageUri);
      setSent(true);
      toast.success(res.message);
    } catch (e) {
      toast.error(describeError(e).message);
    } finally {
      setUploading(false);
    }
  }

  const info = paymentInfoQuery.data;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('payment.title')} back />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          padding: space.lg,
          gap: space.xl,
          paddingBottom: navHeight,
        }}
      >
        {sent ? (
          <FadeIn>
            <View
              style={{
                alignItems: 'center',
                gap: space.lg,
                padding: space.xxl,
              }}
            >
              <View
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: 36,
                  backgroundColor: theme.success + '22',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Ionicons name="checkmark-circle" size={40} color={theme.success} />
              </View>
              <Title>{t('payment.proofSent')}</Title>
              <Subtitle>
                {t('payment.proofSentDetail')}
              </Subtitle>
              <Button
                title={t('payment.backToHome')}
                variant="primary"
                onPress={() => router.replace('/(tabs)')}
              />
            </View>
          </FadeIn>
        ) : (
          <>
            <FadeIn>
              <View style={{ alignItems: 'center', gap: 6 }}>
                <Title>{t('payment.chooseMethod')}</Title>
                <Subtitle>
                  {t('payment.sendAmountThen')}
                </Subtitle>
              </View>
            </FadeIn>

            {paymentInfoQuery.isLoading ? (
              <View style={{ gap: space.lg }}>
                <Skeleton height={100} radius={radius.lg} />
                <Skeleton height={100} radius={radius.lg} />
              </View>
            ) : paymentInfoQuery.isError ? (
              <ErrorState
                message={describeError(paymentInfoQuery.error).message}
                onRetry={() => paymentInfoQuery.refetch()}
                retrying={paymentInfoQuery.isFetching}
              />
            ) : (
              <FadeIn delay={60}>
                <View style={{ gap: space.md }}>
                  <MethodCard
                    method="WAVE"
                    number={info?.wave ?? null}
                    selected={method === 'WAVE'}
                    onPress={() => setMethod('WAVE')}
                  />
                  <MethodCard
                    method="ORANGE_MONEY"
                    number={info?.orangeMoney ?? null}
                    selected={method === 'ORANGE_MONEY'}
                    onPress={() => setMethod('ORANGE_MONEY')}
                  />
                </View>
              </FadeIn>
            )}

            {info?.instructions ? (
              <FadeIn delay={120}>
                <View
                  style={{
                    borderWidth: 1,
                    borderColor: theme.border,
                    borderRadius: radius.md,
                    backgroundColor: theme.surface,
                    padding: space.lg,
                  }}
                >
                  <Row style={{ gap: space.sm, marginBottom: space.sm }}>
                    <Ionicons name="information-circle" size={18} color={theme.primary} />
                    <Text style={{ color: theme.text, fontWeight: '700', fontSize: type.body }}>
                      {t('payment.instructions')}
                    </Text>
                  </Row>
                  <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                    {info.instructions}
                  </Text>
                </View>
              </FadeIn>
            ) : null}

            {method ? (
              <FadeIn delay={180}>
                <View style={{ gap: space.md }}>
                  <Text style={{ color: theme.text, fontWeight: '700', fontSize: type.bodyLg }}>
                    {t('payment.screenshot')}
                  </Text>

                  {imageUri ? (
                    <View style={{ gap: space.md }}>
                      <Image
                        source={{ uri: imageUri }}
                        style={{
                          width: '100%',
                          height: 260,
                          borderRadius: radius.md,
                          resizeMode: 'contain',
                          backgroundColor: theme.surface,
                        }}
                      />
                      <Row style={{ gap: space.md }}>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={t('payment.change')}
                            variant="ghost"
                            onPress={pickImage}
                          />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Button
                            title={t('common.send')}
                            variant="gold"
                            onPress={submit}
                            loading={uploading}
                          />
                        </View>
                      </Row>
                    </View>
                  ) : (
                    <Row style={{ gap: space.md }}>
                      <Press
                        accessibilityLabel={t('payment.takePhoto')}
                        onPress={takePhoto}
                        style={{
                          flex: 1,
                          alignItems: 'center',
                          gap: space.sm,
                          padding: space.xl,
                          borderWidth: 1,
                          borderColor: theme.border,
                          borderRadius: radius.lg,
                          borderStyle: 'dashed',
                        }}
                      >
                        <Ionicons name="camera-outline" size={32} color={theme.primary} />
                        <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                          {t('payment.photo')}
                        </Text>
                      </Press>
                      <Press
                        accessibilityLabel={t('payment.chooseFromGallery')}
                        onPress={pickImage}
                        style={{
                          flex: 1,
                          alignItems: 'center',
                          gap: space.sm,
                          padding: space.xl,
                          borderWidth: 1,
                          borderColor: theme.border,
                          borderRadius: radius.lg,
                          borderStyle: 'dashed',
                        }}
                      >
                        <Ionicons name="images-outline" size={32} color={theme.primary} />
                        <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
                          {t('payment.gallery')}
                        </Text>
                      </Press>
                    </Row>
                  )}
                </View>
              </FadeIn>
            ) : null}
          </>
        )}
      </ScrollView>
      <BottomNav />
    </View>
  );
}
