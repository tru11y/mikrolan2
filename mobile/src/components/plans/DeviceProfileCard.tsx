import { memo } from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { type RouterProfile } from '@/src/services/mikrotik-lan/hotspotLan';
import { Badge, Button, Card, FadeIn, Field, NumberField, Press, Row, withAlpha } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

export const DeviceProfileCard = memo(function DeviceProfileCard({
  profile,
  editing,
  users,
  rate,
  busy,
  onStartEdit,
  onCancelEdit,
  onChangeUsers,
  onChangeRate,
  onSave,
  onRemove,
}: {
  profile: RouterProfile;
  editing: boolean;
  users: string;
  rate: string;
  busy: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onChangeUsers: (v: string) => void;
  onChangeRate: (v: string) => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const p = profile;
  return (
    <Card style={{ gap: 8 }}>
      <Row style={{ alignItems: 'center' }}>
        <Row style={{ gap: 10, flex: 1, justifyContent: 'flex-start' }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: withAlpha(theme.primaryMuted, 0.13),
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="server-outline" size={18} color={theme.primaryMuted} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontWeight: '600', fontSize: 14 }}>
              {p.name}
            </Text>
            <Row style={{ justifyContent: 'flex-start', gap: 8, marginTop: 2 }}>
              <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                {p.sharedUsers} user{p.sharedUsers > 1 ? 's' : ''}
              </Text>
              {p.rateLimit ? (
                <Text style={{ color: theme.textMuted, fontSize: 11 }}>
                  {p.rateLimit}
                </Text>
              ) : null}
            </Row>
          </View>
        </Row>
        <Badge label={t('plans.routerBadge')} tone="secondary" />
      </Row>

      {editing ? (
        <FadeIn from={-6} style={{ gap: 10 }}>
          <Row style={{ gap: 12, alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <NumberField
                label={t('plans.usersMax')}
                value={users}
                onChangeValue={onChangeUsers}
                min={1}
                max={1000}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label={t('plans.rateLabel')}
                value={rate}
                onChangeText={onChangeRate}
                placeholder={t('plans.ratePlaceholder')}
                autoCapitalize="none"
              />
            </View>
          </Row>
          <Row style={{ gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title={t('common.cancel')} variant="ghost" onPress={onCancelEdit} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('common.save')} onPress={onSave} loading={busy} />
            </View>
          </Row>
        </FadeIn>
      ) : (
        <Row style={{ gap: 8, justifyContent: 'flex-end' }}>
          <Press
            accessibilityLabel={`${t('common.modify')} ${p.name}`}
            onPress={onStartEdit}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: withAlpha(theme.primary, 0.09),
            }}
          >
            <Ionicons name="create-outline" size={15} color={theme.primary} />
            <Text style={{ color: theme.primary, fontWeight: '600', fontSize: 12 }}>
              {t('common.modify')}
            </Text>
          </Press>
          <Press
            accessibilityLabel={`${t('common.delete')} ${p.name}`}
            onPress={onRemove}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: withAlpha(theme.danger, 0.09),
            }}
          >
            <Ionicons name="trash-outline" size={15} color={theme.danger} />
            <Text style={{ color: theme.danger, fontWeight: '600', fontSize: 12 }}>
              {t('common.delete')}
            </Text>
          </Press>
        </Row>
      )}
    </Card>
  );
});
