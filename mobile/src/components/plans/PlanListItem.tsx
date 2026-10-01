import { memo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { type Plan } from '@/src/lib/api';
import { Badge, Card, FadeIn, Press, Row, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { PlansChip } from './PlansChip';
import { fmtDuration, speedLabel } from './shared';

export const PlanListItem = memo(function PlanListItem({
  plan,
  menuOpen,
  onToggleMenu,
  onEdit,
  onDelete,
}: {
  plan: Plan;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const p = plan;
  return (
    <Card style={{ gap: 12 }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <Row style={{ gap: 12, flex: 1, justifyContent: 'flex-start' }}>
          <View
            style={{
              width: 46,
              height: 46,
              borderRadius: 14,
              backgroundColor: withAlpha(theme.primary, 0.13),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="ticket-outline" size={22} color={theme.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Row style={{ justifyContent: 'flex-start', gap: 8 }}>
              <Text style={{ color: theme.text, fontWeight: '700', fontSize: 15 }}>
                {p.name}
              </Text>
              <Badge
                label={`${p.priceXof.toLocaleString('fr-FR')} FCFA`}
                tone="success"
              />
            </Row>
            <Row style={{ justifyContent: 'flex-start', gap: 6, marginTop: 3 }}>
              <Ionicons name="time-outline" size={13} color={theme.textMuted} />
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                {fmtDuration(p.durationMinutes)}
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>•</Text>
              <Text style={{ color: theme.textMuted, fontSize: 12 }}>
                {p.expirationMode === 'RADIO_PAUSE' ? t('plans.radioPause') : t('plans.elapsed')}
              </Text>
            </Row>
            {p.description ? (
              <Text
                style={{ color: theme.textMuted, fontSize: 11.5, marginTop: 2 }}
                numberOfLines={1}
              >
                {p.description}
              </Text>
            ) : null}
          </View>
        </Row>
        <Press
          accessibilityLabel={t('plans.planOptions')}
          onPress={onToggleMenu}
          hitSlop={8}
          scaleTo={0.85}
          style={{ padding: 4 }}
        >
          <Ionicons name="ellipsis-vertical" size={18} color={theme.textMuted} />
        </Press>
      </Row>

      {menuOpen ? (
        <FadeIn from={-6} style={{ gap: 8 }}>
          <Press
            accessibilityLabel={t('plans.editThisPlan')}
            onPress={onEdit}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: withAlpha(theme.primary, 0.09),
            }}
          >
            <Ionicons name="create-outline" size={16} color={theme.primary} />
            <Text style={{ color: theme.primary, fontWeight: '600', fontSize: 13 }}>
              {t('plans.editThisPlan')}
            </Text>
          </Press>
          <Press
            accessibilityLabel={t('plans.deleteThisPlan')}
            onPress={onDelete}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              backgroundColor: withAlpha(theme.danger, 0.09),
            }}
          >
            <Ionicons name="trash-outline" size={16} color={theme.danger} />
            <Text style={{ color: theme.danger, fontWeight: '600', fontSize: 13 }}>
              {t('plans.deleteThisPlan')}
            </Text>
          </Press>
        </FadeIn>
      ) : null}

      <Row
        style={{
          gap: 8,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: theme.border,
        }}
      >
        {/* Attributs techniques : gris. La couleur est réservée au
            prix (vert) et au statut — pas à la décoration. */}
        <PlansChip
          icon="flash-outline"
          color={theme.textMuted}
          label={speedLabel(p)}
        />
        <PlansChip
          icon="people-outline"
          color={theme.textMuted}
          label={`${p.sharedUsers} user${p.sharedUsers > 1 ? 's' : ''}`}
        />
        <PlansChip
          icon="key-outline"
          color={theme.textMuted}
          label={`${p.codeLength} car.`}
        />
      </Row>
    </Card>
  );
});
