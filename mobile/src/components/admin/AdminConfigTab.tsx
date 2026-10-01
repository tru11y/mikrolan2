import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/src/lib/api';
import { describeError } from '@/src/lib/errors';
import { Button, ErrorState, Field, SectionTitle, SkeletonCard, space, useToast } from '@/src/components/ui';
import { View } from 'react-native';

export function AdminConfigTab() {
  const { t } = useTranslation();
  const toast = useToast();
  const qc = useQueryClient();
  const configQuery = useQuery({
    queryKey: ['admin-config'],
    queryFn: () => api.admin.getConfig(),
  });

  const [waveNumber, setWaveNumber] = useState('');
  const [omNumber, setOmNumber] = useState('');
  const [instructions, setInstructions] = useState('');
  const [loaded, setLoaded] = useState(false);

  if (configQuery.data && !loaded) {
    setWaveNumber(configQuery.data['wave_number'] ?? '');
    setOmNumber(configQuery.data['om_number'] ?? '');
    setInstructions(configQuery.data['payment_instructions'] ?? '');
    setLoaded(true);
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.admin.updateConfig({
        wave_number: waveNumber,
        om_number: omNumber,
        payment_instructions: instructions,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-config'] });
      toast.success('Configuration sauvegardée.');
    },
    onError: (e) => toast.error(describeError(e).message),
  });

  if (configQuery.isLoading) return <SkeletonCard />;
  if (configQuery.isError) return <ErrorState message={describeError(configQuery.error).message} onRetry={() => configQuery.refetch()} retrying={configQuery.isFetching} />;

  return (
    <View style={{ gap: space.lg }}>
      <SectionTitle>{t('admin.paymentNumbers')}</SectionTitle>
      <Field label={t('admin.waveNumber')} value={waveNumber} onChangeText={setWaveNumber} placeholder={t('admin.wavePlaceholder')} />
      <Field label={t('admin.omNumber')} value={omNumber} onChangeText={setOmNumber} placeholder={t('admin.omPlaceholder')} />
      <Field label={t('admin.paymentInstructions')} value={instructions} onChangeText={setInstructions} placeholder={t('admin.paymentInstructionsPlaceholder')} multiline />
      <Button title={t('admin.saveConfig')} variant="primary" onPress={() => saveMutation.mutate()} loading={saveMutation.isPending} />
    </View>
  );
}
