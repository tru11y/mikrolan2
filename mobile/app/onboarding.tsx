import { useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, FadeIn, Press, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const ONBOARDING_KEY = 'mikrolan:onboarding_done';

interface Step {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  titleKey: string;
  descKey: string;
}

const STEPS: Step[] = [
  { icon: 'wifi-outline', color: '#3B82F6', titleKey: 'onboarding.step1Title', descKey: 'onboarding.step1Desc' },
  { icon: 'hardware-chip-outline', color: '#10B981', titleKey: 'onboarding.step2Title', descKey: 'onboarding.step2Desc' },
  { icon: 'ticket-outline', color: '#F59E0B', titleKey: 'onboarding.step3Title', descKey: 'onboarding.step3Desc' },
  { icon: 'analytics-outline', color: '#8B5CF6', titleKey: 'onboarding.step4Title', descKey: 'onboarding.step4Desc' },
];

export default function OnboardingScreen() {
  const theme = useTheme();
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    if (viewableItems.length > 0 && viewableItems[0].index != null) {
      setCurrentIndex(viewableItems[0].index);
    }
  }).current;

  async function finish() {
    await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    router.replace('/(tabs)');
  }

  function next() {
    if (currentIndex < STEPS.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1, animated: true });
    } else {
      finish();
    }
  }

  const isLast = currentIndex === STEPS.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      {/* Skip button */}
      <View style={{ alignItems: 'flex-end', paddingHorizontal: 20, paddingTop: 12 }}>
        <Press onPress={finish} style={{ paddingVertical: 8, paddingHorizontal: 16 }}>
          <Text style={{ color: theme.textMuted, fontSize: 14, fontWeight: '600' }}>
            {t('onboarding.skip')}
          </Text>
        </Press>
      </View>

      {/* Pages */}
      <FlatList
        ref={flatListRef}
        data={STEPS}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={{ viewAreaCoveragePercentThreshold: 50 }}
        keyExtractor={(_, i) => String(i)}
        renderItem={({ item }) => (
          <View style={{ width: SCREEN_WIDTH, flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 }}>
            <FadeIn>
              <View style={{ alignItems: 'center', gap: 24 }}>
                <View style={{
                  width: 100, height: 100, borderRadius: 32,
                  backgroundColor: withAlpha(item.color, 0.1),
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <Ionicons name={item.icon} size={44} color={item.color} />
                </View>
                <Text style={{
                  color: theme.text, fontSize: 24, fontWeight: '800',
                  textAlign: 'center', lineHeight: 32,
                }}>
                  {t(item.titleKey)}
                </Text>
                <Text style={{
                  color: theme.textMuted, fontSize: 15, textAlign: 'center',
                  lineHeight: 24, maxWidth: 300,
                }}>
                  {t(item.descKey)}
                </Text>
              </View>
            </FadeIn>
          </View>
        )}
      />

      {/* Dots + action */}
      <View style={{ paddingHorizontal: 32, paddingBottom: 24, gap: 24 }}>
        {/* Dots */}
        <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 8 }}>
          {STEPS.map((step, i) => (
            <View
              key={i}
              style={{
                width: i === currentIndex ? 24 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === currentIndex ? step.color : withAlpha(theme.textMuted, 0.2),
              }}
            />
          ))}
        </View>

        <Button
          title={isLast ? t('onboarding.getStarted') : t('onboarding.next')}
          onPress={next}
        />
      </View>
    </View>
  );
}
