export { ScreenErrorBoundary as ErrorBoundary } from '@/src/components/ScreenErrorBoundary';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type RouterItem, type VerifierItem } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import {
  buildCreateBody,
  displayName,
  routerLabel,
  validateNewVerifier,
  isReadyToVerify,
  validateNewPassword,
  type FormErrorKey,
} from '@/src/lib/verifierMgmt';
import {
  Banner,
  Button,
  Card,
  ErrorState,
  Field,
  Press,
  radius,
  Skeleton,
  space,
  type,
  useToast,
  weight,
} from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';
import { useAuth } from '@/src/providers/auth-provider';
import { AppHeader } from '@/src/components/AppHeader';
import { BottomNav, useBottomNavHeight } from '@/src/components/BottomNav';

const QUERY_KEY = ['ticket-verifiers'];

const FORM_ERROR_KEY: Record<FormErrorKey, string> = {
  invalidEmail: 'verifiers.errInvalidEmail',
  weakPassword: 'verifiers.errWeakPassword',
  nameTooLong: 'verifiers.errNameTooLong',
};

function RouterChips({
  routers,
  selected,
  onSelect,
  allowNone,
}: {
  routers: RouterItem[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  allowNone?: boolean;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const chip = (key: string, label: string, id: string | null) => {
    const active = selected === id;
    return (
      <Press
        key={key}
        onPress={() => onSelect(id)}
        accessibilityLabel={label}
        style={{
          paddingHorizontal: space.md,
          paddingVertical: space.sm,
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: active ? theme.primary : theme.border,
          backgroundColor: active ? theme.primary : 'transparent',
        }}
      >
        <Text style={{ color: active ? theme.primaryText : theme.text, fontSize: type.caption }}>
          {label}
        </Text>
      </Press>
    );
  };
  if (routers.length === 0) {
    return <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{t('verifiers.noRouter')}</Text>;
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
      {allowNone ? chip('none', t('verifiers.routerNone'), null) : null}
      {routers.map((r) => chip(r.id, r.alias?.trim() || r.identity, r.id))}
    </View>
  );
}

function AddForm({ routers, onDone }: { routers: RouterItem[]; onDone: () => void }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: '', password: '', name: '' });
  const [routerId, setRouterId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);

  const create = useMutation({
    mutationFn: () => api.ticketVerifiers.create(buildCreateBody(form, routerId)),
    onSuccess: () => {
      setForm({ email: '', password: '', name: '' });
      qc.invalidateQueries({ queryKey: QUERY_KEY });
      toast.success(t('verifiers.created'));
      onDone();
    },
    onError: (err) => {
      const d = describeError(err);
      setError(
        d.status === 409
          ? t('verifiers.errEmailTaken')
          : d.status === null
            ? t('verifiers.errNetwork')
            : t('verifiers.errGeneric'),
      );
    },
    onSettled: () => {
      lock.current = false;
    },
  });

  function submit() {
    if (lock.current || create.isPending) return;
    const invalid = validateNewVerifier(form);
    if (invalid) {
      setError(t(FORM_ERROR_KEY[invalid]));
      return;
    }
    setError(null);
    lock.current = true;
    create.mutate();
  }

  return (
    <Card>
      <View style={{ gap: space.md }}>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <Field
          label={t('verifiers.email')}
          value={form.email}
          onChangeText={(v) => setForm((f) => ({ ...f, email: v }))}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          editable={!create.isPending}
        />
        <Field
          label={t('verifiers.password')}
          value={form.password}
          onChangeText={(v) => setForm((f) => ({ ...f, password: v }))}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          editable={!create.isPending}
        />
        <Field
          label={t('verifiers.name')}
          value={form.name}
          onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
          editable={!create.isPending}
        />
        <View style={{ gap: space.sm }}>
          <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{t('verifiers.routerPick')}</Text>
          <RouterChips routers={routers} selected={routerId} onSelect={setRouterId} allowNone />
          {routerId === null ? <Banner tone="warning">{t('verifiers.noRouterWarning')}</Banner> : null}
        </View>
        <Button title={t('verifiers.create')} onPress={submit} loading={create.isPending} />
        <Button title={t('verifiers.cancel')} variant="ghost" onPress={onDone} disabled={create.isPending} />
      </View>
    </Card>
  );
}

type Panel = null | 'assign' | 'password' | 'suspend' | 'remove';

function VerifierCard({ item, routers }: { item: VerifierItem; routers: RouterItem[] }) {
  const { t } = useTranslation();
  const theme = useTheme();
  const toast = useToast();
  const qc = useQueryClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);

  const refresh = () => qc.invalidateQueries({ queryKey: QUERY_KEY });
  const fail = () => toast.error(t('verifiers.errGeneric'));

  const assign = useMutation({
    mutationFn: (routerId: string) => api.ticketVerifiers.assign(item.id, routerId),
    onSuccess: () => {
      refresh();
      setPanel(null);
      toast.success(t('verifiers.updated'));
    },
    onError: fail,
  });
  const setStatus = useMutation({
    mutationFn: (status: 'ACTIVE' | 'SUSPENDED') => api.ticketVerifiers.setStatus(item.id, status),
    onSuccess: () => {
      refresh();
      setPanel(null);
      toast.success(t('verifiers.updated'));
    },
    onError: fail,
  });
  const reset = useMutation({
    mutationFn: () => api.ticketVerifiers.resetPassword(item.id, newPassword),
    onSuccess: () => {
      setNewPassword('');
      setConfirmPassword('');
      setPanel(null);
      toast.success(t('verifiers.passwordReset'));
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: () => api.ticketVerifiers.remove(item.id),
    onSuccess: () => {
      refresh();
      toast.success(t('verifiers.removed'));
    },
    onError: fail,
  });

  const suspended = item.status === 'SUSPENDED';
  const router = routerLabel(item.assignment);
  const ready = isReadyToVerify(item);
  const name = displayName(item);
  const busy = assign.isPending || setStatus.isPending || reset.isPending || remove.isPending;
  // Changer de panneau efface toujours l'erreur et les secrets saisis : rien ne reste en mémoire.
  const toggle = (p: Exclude<Panel, null>) => {
    setPasswordError(null);
    setNewPassword('');
    setConfirmPassword('');
    setPanel((cur) => (cur === p ? null : p));
  };

  function submitPassword() {
    if (busy) return;
    const invalid = validateNewPassword(newPassword, confirmPassword);
    if (invalid) {
      setPasswordError(t(invalid === 'mismatch' ? 'verifiers.errPasswordMismatch' : 'verifiers.errWeakPassword'));
      return;
    }
    setPasswordError(null);
    reset.mutate();
  }

  return (
    <Card>
      <View style={{ gap: space.sm }}>
        <Text style={{ color: theme.text, fontSize: type.body, fontWeight: weight.bold }}>
          {displayName(item)}
        </Text>
        {item.name ? (
          <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{item.email}</Text>
        ) : null}
        <Text
          style={{
            color: suspended ? theme.warning : theme.success,
            fontSize: type.caption,
            fontWeight: weight.bold,
          }}
        >
          {suspended ? t('verifiers.statusSuspended') : t('verifiers.statusActive')}
        </Text>
        <Text style={{ color: router ? theme.text : theme.textMuted, fontSize: type.caption }}>
          {router ?? t('verifiers.routerNone')}
        </Text>
        {!ready && !suspended ? (
          <Text style={{ color: theme.warning, fontSize: type.caption }}>{t('verifiers.notReady')}</Text>
        ) : null}

        <View style={{ gap: space.sm, marginTop: space.sm }}>
          <Button title={t('verifiers.assign')} variant="ghost" onPress={() => toggle('assign')} disabled={busy} />
          {panel === 'assign' ? (
            <RouterChips
              routers={routers}
              selected={item.assignment?.routerId ?? null}
              onSelect={(id) => {
                if (id && !busy) assign.mutate(id);
              }}
            />
          ) : null}

          <Button
            title={suspended ? t('verifiers.reactivate') : t('verifiers.suspend')}
            variant="ghost"
            onPress={() => (suspended ? setStatus.mutate('ACTIVE') : toggle('suspend'))}
            loading={suspended && setStatus.isPending}
            disabled={busy}
          />
          {panel === 'suspend' ? (
            <View style={{ gap: space.sm }}>
              <Banner tone="warning">{t('verifiers.suspendWarning', { name })}</Banner>
              <Button
                title={t('verifiers.confirmSuspend')}
                variant="ghost"
                onPress={() => setStatus.mutate('SUSPENDED')}
                loading={setStatus.isPending}
                disabled={busy}
              />
            </View>
          ) : null}

          <Button title={t('verifiers.resetPassword')} variant="ghost" onPress={() => toggle('password')} disabled={busy} />
          {panel === 'password' ? (
            <View style={{ gap: space.sm }}>
              <Banner tone="warning">{t('verifiers.resetWarning')}</Banner>
              {passwordError ? <Banner tone="danger">{passwordError}</Banner> : null}
              <Field
                value={newPassword}
                onChangeText={(v) => {
                  setPasswordError(null);
                  setNewPassword(v);
                }}
                placeholder={t('verifiers.newPasswordPlaceholder')}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Field
                value={confirmPassword}
                onChangeText={(v) => {
                  setPasswordError(null);
                  setConfirmPassword(v);
                }}
                placeholder={t('verifiers.confirmPassword')}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button title={t('verifiers.saveNewPassword')} onPress={submitPassword} loading={reset.isPending} />
            </View>
          ) : null}

          <Button
            title={t('verifiers.remove')}
            variant="danger"
            onPress={() => toggle('remove')}
            disabled={busy}
          />
          {panel === 'remove' ? (
            <View style={{ gap: space.sm }}>
              <Banner tone="danger">{t('verifiers.removeWarning', { name })}</Banner>
              <Button
                title={t('verifiers.confirmRemove')}
                variant="danger"
                onPress={() => remove.mutate()}
                loading={remove.isPending}
                disabled={busy}
              />
            </View>
          ) : null}
        </View>
      </View>
    </Card>
  );
}

export default function VendeursScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { me, isReady } = useAuth();
  const navHeight = useBottomNavHeight();
  const [adding, setAdding] = useState(false);
  const role = me?.user.role;
  const allowed = role === 'OWNER' || role === 'ADMIN';

  const list = useQuery({ queryKey: QUERY_KEY, queryFn: () => api.ticketVerifiers.list(), enabled: allowed });
  const routersQuery = useQuery({ queryKey: ['routers'], queryFn: () => api.routers.list(), enabled: allowed });
  const routers = routersQuery.data ?? [];

  if (isReady && !allowed) return <Redirect href="/(tabs)" />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <AppHeader title={t('verifiers.title')} back />
      <ScrollView
        contentContainerStyle={{ padding: space.lg, gap: space.md, paddingBottom: navHeight + space.lg }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: theme.textMuted, fontSize: type.caption }}>{t('verifiers.intro')}</Text>

        {adding ? (
          <AddForm routers={routers} onDone={() => setAdding(false)} />
        ) : (
          <Button title={t('verifiers.add')} onPress={() => setAdding(true)} />
        )}

        {list.isLoading ? (
          <Skeleton />
        ) : list.isError ? (
          <ErrorState message={t('verifiers.errGeneric')} onRetry={() => list.refetch()} retrying={list.isRefetching} />
        ) : (list.data?.items ?? []).length === 0 ? (
          <Text style={{ color: theme.textMuted, fontSize: type.body }}>{t('verifiers.empty')}</Text>
        ) : (
          (list.data?.items ?? []).map((v) => <VerifierCard key={v.id} item={v} routers={routers} />)
        )}
      </ScrollView>
      <BottomNav />
    </KeyboardAvoidingView>
  );
}
