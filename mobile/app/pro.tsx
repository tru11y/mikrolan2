import { useMemo, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router as navRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  billingPeriod,
  formatXof,
  loadTiers,
  monthlyPrice,
  periodPrice,
  type Tier,
} from '@/src/config/tiers';
import {
  Button,
  ErrorState,
  FadeIn,
  IconChip,
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
import { ProAdvisor } from '@/src/components/ProAdvisor';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

function BillingToggle({
  annual,
  discount,
  onChange,
}: {
  annual: boolean;
  /** Remise annoncée : elle vient de la grille, pas d'un littéral. */
  discount: number;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <Row style={{ alignSelf: 'center' }}>
      <View
        style={{
          flexDirection: 'row',
          gap: 4,
          backgroundColor: theme.surface,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.lg,
          padding: 6,
        }}
      >
        {[false, true].map((isAnnual) => {
          const active = annual === isAnnual;
          return (
            <Press
              key={String(isAnnual)}
              accessibilityRole="tab"
              accessibilityLabel={isAnnual ? t('pro.annualPayment') : t('pro.monthlyPayment')}
              onPress={() => onChange(isAnnual)}
              scaleTo={0.95}
              style={{
                borderRadius: radius.md,
                paddingHorizontal: 18,
                paddingVertical: 9,
                backgroundColor: active ? theme.primary : 'transparent',
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <Text
                style={{
                  color: active ? theme.primaryText : theme.textMuted,
                  fontWeight: '700',
                  fontSize: type.caption,
                }}
              >
                {isAnnual ? t('pro.annual') : t('pro.monthly')}
              </Text>
              {isAnnual ? (
                <View
                  style={{
                    backgroundColor: active ? '#00000022' : theme.gold + '22',
                    borderRadius: radius.pill,
                    paddingHorizontal: 6,
                    paddingVertical: 1,
                  }}
                >
                  <Text
                    style={{
                      color: active ? theme.primaryText : theme.gold,
                      fontSize: 9,
                      fontWeight: '800',
                    }}
                  >
                    -{discount}%
                  </Text>
                </View>
              ) : null}
            </Press>
          );
        })}
      </View>
    </Row>
  );
}

function TierCard({
  tier,
  annual,
  selected,
  recommended,
  onPress,
}: {
  tier: Tier;
  annual: boolean;
  selected: boolean;
  recommended: boolean;
  onPress: () => void;
}) {
  // Une seule chose peut être mise en avant à la fois : l'or dit « c'est la
  // formule retenue pour vous », le violet dit « c'est celle que vous
  // regardez ». Avant, les deux se disputaient la même carte.
  const { t } = useTranslation();
  const accent = recommended ? theme.gold : selected ? theme.primary : theme.border;

  return (
    <Press
      accessibilityRole="radio"
      accessibilityLabel={`Formule ${tier.name}, ${formatXof(monthlyPrice(tier, annual))} par mois`}
      onPress={onPress}
      scaleTo={0.985}
      style={{
        borderRadius: radius.lg,
        borderWidth: selected || recommended ? 2 : 1,
        borderColor: accent,
        backgroundColor: theme.surface,
        padding: space.xl,
        overflow: 'hidden',
      }}
    >
      {recommended ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            backgroundColor: theme.gold,
            borderBottomLeftRadius: radius.md,
            paddingHorizontal: space.md,
            paddingVertical: 4,
          }}
        >
          <Text
            style={{
              color: theme.goldText,
              fontSize: 10,
              fontWeight: '800',
              letterSpacing: 0.5,
            }}
          >
            {t('pro.recommendedForYou')}
          </Text>
        </View>
      ) : tier.badge ? (
        <View
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            backgroundColor: theme.surfaceAlt,
            borderBottomLeftRadius: radius.md,
            paddingHorizontal: space.md,
            paddingVertical: 4,
          }}
        >
          <Text
            style={{
              color: theme.textMuted,
              fontSize: 10,
              fontWeight: '800',
              letterSpacing: 0.5,
            }}
          >
            {tier.badge}
          </Text>
        </View>
      ) : null}

      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: space.md }}>
          <Row style={{ justifyContent: 'flex-start', gap: space.sm }}>
            <Text style={{ color: theme.text, fontSize: type.h2 - 2, fontWeight: '800' }}>
              {tier.name}
            </Text>
            {selected ? (
              <Ionicons name="checkmark-circle" size={18} color={theme.primary} />
            ) : null}
          </Row>
          <Text style={{ color: theme.textMuted, fontSize: type.caption, marginTop: 2 }}>
            {tier.tagline}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={{ color: theme.gold, fontSize: type.h2, fontWeight: '800' }}>
            {monthlyPrice(tier, annual).toLocaleString('fr-FR')} F
          </Text>
          <Text style={{ color: theme.textMuted, fontSize: 10 }}>{t('pro.perMonth')}</Text>
          {annual ? (
            <Text style={{ color: theme.textMuted, fontSize: 10, marginTop: 2 }}>
              {t('pro.perYear', { price: formatXof(periodPrice(tier, true)) })}
            </Text>
          ) : null}
        </View>
      </Row>

      <View
        style={{
          gap: space.sm,
          marginTop: space.lg,
          paddingTop: space.md,
          borderTopWidth: 1,
          borderTopColor: theme.border,
        }}
      >
        {tier.features.map((f) => (
          <Row key={f.label} style={{ justifyContent: 'flex-start', gap: space.sm }}>
            <Ionicons
              name={f.included ? 'checkmark' : 'close'}
              size={16}
              color={f.included ? theme.success : theme.textMuted}
            />
            <Text
              style={{
                color: f.included ? theme.text : theme.textMuted,
                fontSize: type.caption,
                flex: 1,
                opacity: f.included ? 1 : 0.55,
              }}
            >
              {f.label}
            </Text>
          </Row>
        ))}
      </View>
    </Press>
  );
}

export default function ProScreen() {
  const { t } = useTranslation();
  const navHeight = useBottomNavHeight();
  const toast = useToast();

  // La grille vient du serveur : c'est le super admin qui fixe les prix, plus
  // une constante embarquée dans l'APK.
  const tiersQuery = useQuery({ queryKey: ['tiers'], queryFn: loadTiers });
  const tiers = useMemo(() => tiersQuery.data ?? [], [tiersQuery.data]);

  const [annual, setAnnual] = useState(true);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [advised, setAdvised] = useState<string | null>(null);
  const [advisorNote, setAdvisorNote] = useState<string | null>(null);
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);

  // Sélection par défaut : la formule mise en avant par la grille, sinon celle
  // du milieu. Rien n'est codé en dur sur une clé précise.
  const tier =
    tiers.find((t) => t.key === selectedKey) ??
    tiers.find((t) => t.badge) ??
    tiers[Math.floor(tiers.length / 2)] ??
    null;

  async function requestActivation() {
    if (!tier) return;
    setBusy(true);
    try {
      // Le serveur plafonne la note à 280 caractères (requestUpgradeSchema) :
      // au-delà la demande était rejetée en 400 sans que rien ne l'explique.
      const note = (advisorNote ?? `Choix direct depuis la grille`).slice(0, 280);
      const res = await api.subscriptions.requestUpgrade({
        note,
        tierKey: tier.key,
        billingPeriod: billingPeriod(annual),
      });
      setRequested(true);
      toast.success(res.instructions);
      navRouter.push({ pathname: '/payment', params: { invoiceId: res.invoice.id } });
    } catch (e) {
      toast.error(describeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppHeader title={t('pro.title')} back />
      <ScrollView
        style={{ flex: 1, backgroundColor: theme.bg }}
        contentContainerStyle={{
          padding: space.lg,
          gap: space.xl,
          paddingBottom: navHeight,
        }}
      >
        <FadeIn>
          <View style={{ alignItems: 'center', gap: 6 }}>
            <Row
              style={{
                gap: 6,
                backgroundColor: theme.gold + '22',
                borderWidth: 1,
                borderColor: theme.gold + '66',
                borderRadius: radius.pill,
                paddingHorizontal: space.md,
                paddingVertical: 5,
              }}
            >
              <Ionicons name="ribbon" size={16} color={theme.gold} />
              <Text
                style={{
                  color: theme.gold,
                  fontWeight: '800',
                  fontSize: type.micro,
                  letterSpacing: 0.5,
                  textTransform: 'uppercase',
                }}
              >
                {t('pro.prime')}
              </Text>
            </Row>
            <Title>{t('pro.levelUp')}</Title>
            <Subtitle>{t('pro.unlockFeatures')}</Subtitle>
          </View>
        </FadeIn>

        {/* Le point d'entrée du conseiller est mis avant les prix : c'est la
            question que se pose le client à cet instant précis. */}
        <FadeIn delay={60}>
          <Press
            accessibilityLabel={t('pro.openAdvisor')}
            onPress={() => setAdvisorOpen(true)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.md,
              backgroundColor: theme.primary + '14',
              borderWidth: 1,
              borderColor: theme.primary + '55',
              borderRadius: radius.lg,
              padding: space.lg,
            }}
          >
            <IconChip name="sparkles" color={theme.primary} size="lg" outlined />
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.text, fontSize: type.bodyLg, fontWeight: '700' }}>
                {t('pro.whichOne')}
              </Text>
              <Text style={{ color: theme.textMuted, fontSize: type.caption, marginTop: 2 }}>
                {t('pro.advisorSubtitle')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={theme.primary} />
          </Press>
        </FadeIn>

        <FadeIn delay={120}>
          <BillingToggle
            annual={annual}
            discount={tier?.annualDiscount ?? 20}
            onChange={setAnnual}
          />
        </FadeIn>

        {tiersQuery.isLoading ? (
          <View style={{ gap: space.lg }}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={230} radius={radius.lg} />
            ))}
          </View>
        ) : tiersQuery.isError ? (
          <ErrorState
            message={describeError(tiersQuery.error).message}
            onRetry={() => tiersQuery.refetch()}
            retrying={tiersQuery.isFetching}
          />
        ) : (
          <View style={{ gap: space.lg }}>
            {tiers.map((t, i) => (
              <FadeIn key={t.key} delay={160 + i * 60}>
                <TierCard
                  tier={t}
                  annual={annual}
                  selected={tier?.key === t.key}
                  recommended={t.key === advised}
                  onPress={() => setSelectedKey(t.key)}
                />
              </FadeIn>
            ))}
          </View>
        )}

        {requested ? (
          <FadeIn>
            <Row
              style={{
                gap: space.md,
                borderWidth: 1,
                borderColor: theme.success + '66',
                backgroundColor: theme.success + '14',
                borderRadius: radius.md,
                padding: space.lg,
              }}
            >
              <Ionicons name="checkmark-circle" size={22} color={theme.success} />
              <Text style={{ color: theme.text, fontSize: type.body, flex: 1 }}>
                {t('pro.requestSent')}
              </Text>
            </Row>
          </FadeIn>
        ) : tier ? (
          <Button
            title={t('pro.requestActivation', { name: tier.name, price: formatXof(periodPrice(tier, annual)) })}
            variant="gold"
            onPress={requestActivation}
            loading={busy}
          />
        ) : null}

        <Text
          style={{
            color: theme.textMuted,
            fontSize: type.caption,
            textAlign: 'center',
          }}
        >
          {t('pro.manualPayment')}
        </Text>
      </ScrollView>

      <ProAdvisor
        visible={advisorOpen}
        tiers={tiers}
        onClose={() => setAdvisorOpen(false)}
        onAccept={(key, note) => {
          setSelectedKey(key);
          setAdvised(key);
          setAdvisorNote(note);
          setAdvisorOpen(false);
          setRequested(false);
          toast.show(t('pro.formulaSelected', { name: tiers.find((ti) => ti.key === key)?.name }), 'info');
        }}
      />
      <BottomNav />
    </View>
  );
}
