import { useState } from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Tier } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { formatXof } from '@/src/config/tiers';
import {
  Badge,
  Button,
  Card,
  Empty,
  ErrorState,
  FadeIn,
  Field,
  NumberField,
  Row,
  SkeletonCard,
  space,
  type,
  useToast,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

function TierEditor({ tier, onDone }: { tier: Tier; onDone: () => void }) {
  const theme = useTheme();
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(tier.name);
  const [price, setPrice] = useState(String(tier.monthlyXof));
  const [discount, setDiscount] = useState(String(tier.annualDiscount));
  const [routers, setRouters] = useState(
    tier.routerLimit === null ? '' : String(tier.routerLimit),
  );

  const save = useMutation({
    mutationFn: () =>
      api.admin.updateTier(tier.id, {
        name: name.trim(),
        monthlyXof: Number.parseInt(price, 10),
        annualDiscount: Number.parseInt(discount, 10),
        routerLimit: routers === '' ? null : Number.parseInt(routers, 10),
      }),
    onSuccess: async () => {
      toast.success(t('admin.formulaUpdated'));
      // La grille client et la vue admin lisent deux routes différentes.
      await qc.invalidateQueries({ queryKey: ['admin', 'tiers'] });
      await qc.invalidateQueries({ queryKey: ['tiers'] });
      onDone();
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  const priceValid = /^\d+$/.test(price);
  const discountValid = /^\d+$/.test(discount) && Number.parseInt(discount, 10) <= 90;

  return (
    <View style={{ gap: space.md }}>
      <Field label={t('admin.commercialName')} value={name} onChangeText={setName} maxLength={60} />
      <Row style={{ gap: space.md, alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <NumberField
            label={t('admin.monthlyPriceFcfa')}
            value={price}
            onChangeValue={setPrice}
            min={0}
            max={10_000_000}
          />
        </View>
        <View style={{ flex: 1 }}>
          <NumberField
            label={t('admin.annualDiscount')}
            value={discount}
            onChangeValue={setDiscount}
            min={0}
            max={90}
          />
        </View>
      </Row>
      <NumberField
        label={t('admin.routersIncluded')}
        value={routers}
        onChangeValue={setRouters}
        min={1}
        max={10_000}
        optional
        placeholder={t('admin.unlimitedPlaceholder')}
        hint={t('admin.leaveEmptyForUnlimited')}
      />
      {priceValid && discountValid ? (
        <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
          {t('admin.annualPrice', {
            monthly: formatXof(
              Math.round(
                Number.parseInt(price, 10) * (1 - Number.parseInt(discount, 10) / 100),
              ),
            ),
            yearly: formatXof(
              Math.round(
                Number.parseInt(price, 10) * (1 - Number.parseInt(discount, 10) / 100),
              ) * 12,
            ),
          })}
        </Text>
      ) : null}
      <Row style={{ gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Button title={t('common.cancel')} variant="ghost" onPress={onDone} />
        </View>
        <View style={{ flex: 1 }}>
          <Button
            title={t('common.save')}
            onPress={() => save.mutate()}
            loading={save.isPending}
            disabled={!name.trim() || !priceValid || !discountValid}
          />
        </View>
      </Row>
    </View>
  );
}

export function AdminTiersTab() {
  const theme = useTheme();
  const { t } = useTranslation();
  const [editing, setEditing] = useState<string | null>(null);
  const query = useQuery({ queryKey: ['admin', 'tiers'], queryFn: api.admin.tiers });

  if (query.isLoading) return <SkeletonCard lines={3} />;
  if (query.isError) {
    return (
      <ErrorState
        message={describeError(query.error).message}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  }

  const tiers = query.data ?? [];
  if (!tiers.length) {
    return <Empty icon="pricetags-outline" text={t('admin.noFormulas')} />;
  }

  return (
    <View style={{ gap: space.md }}>
      <Text style={{ color: theme.textMuted, fontSize: type.caption }}>
        {t('admin.priceNote')}
      </Text>

      {tiers.map((tier, i) => (
        <FadeIn key={tier.id} delay={i * 50}>
          <Card>
            <Row style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, paddingRight: space.md }}>
                <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
                  <Text
                    style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}
                  >
                    {tier.name}
                  </Text>
                  {tier.active ? null : <Badge label={t('admin.archived')} tone="muted" />}
                </Row>
                <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                  {tier.routerLimit === null
                    ? t('admin.unlimitedRouters')
                    : t('admin.routerCount', { count: tier.routerLimit })}
                  {tier.remoteAccess ? ` · ${t('admin.remoteAccess')}` : ` · ${t('admin.localOnly')}`}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text
                  style={{ color: theme.gold, fontSize: type.bodyLg, fontWeight: '800' }}
                >
                  {formatXof(tier.monthlyXof)}
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: type.micro }}>
                  {t('admin.annualBilling')} : {formatXof(tier.annualMonthlyXof)} / {t('pro.perMonth')}
                </Text>
              </View>
            </Row>

            {editing === tier.id ? (
              <FadeIn from={-6}>
                <TierEditor tier={tier} onDone={() => setEditing(null)} />
              </FadeIn>
            ) : (
              <Button
                title={t('admin.modifyPrice')}
                variant="ghost"
                onPress={() => setEditing(tier.id)}
              />
            )}
          </Card>
        </FadeIn>
      ))}
    </View>
  );
}
