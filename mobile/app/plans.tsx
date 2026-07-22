import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, extractErrorMessage, type Plan } from '@/src/lib/api';
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Field,
  Label,
  Screen,
  Subtitle,
  Title,
  theme,
} from '@/src/components/ui';
import { Text } from 'react-native';

function fmtDuration(min: number): string {
  if (min % 1440 === 0) return `${min / 1440} j`;
  if (min % 60 === 0) return `${min / 60} h`;
  return `${min} min`;
}

export default function PlansScreen() {
  const qc = useQueryClient();
  const query = useQuery({ queryKey: ['plans'], queryFn: api.plans.list });

  const [name, setName] = useState('');
  const [duration, setDuration] = useState('');
  const [price, setPrice] = useState('');
  const [down, setDown] = useState('');
  const [up, setUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    const durationMinutes = Number.parseInt(duration, 10);
    const priceXof = Number.parseInt(price, 10);
    if (!name.trim() || !durationMinutes || Number.isNaN(priceXof)) {
      setError('Nom, durée (min) et prix sont requis.');
      return;
    }
    setBusy(true);
    try {
      await api.plans.create({
        name: name.trim(),
        durationMinutes,
        priceXof,
        downloadKbps: down ? Number.parseInt(down, 10) : null,
        uploadKbps: up ? Number.parseInt(up, 10) : null,
      });
      setName('');
      setDuration('');
      setPrice('');
      setDown('');
      setUp('');
      await qc.invalidateQueries({ queryKey: ['plans'] });
    } catch (e) {
      setError(extractErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await api.plans.remove(id);
      await qc.invalidateQueries({ queryKey: ['plans'] });
    } catch (e) {
      setError(extractErrorMessage(e));
    }
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ gap: 16 }}>
        <Title>Forfaits</Title>
        <Subtitle>
          Les forfaits définissent la durée, le prix et le débit vendus. Chacun
          devient un profil sur le routeur.
        </Subtitle>

        {error ? <Banner tone="danger">{error}</Banner> : null}

        <Card>
          <Label>Nouveau forfait</Label>
          <Field label="Nom" value={name} onChangeText={setName} placeholder="Ex. 1 heure" />
          <Field
            label="Durée (minutes)"
            value={duration}
            onChangeText={setDuration}
            keyboardType="number-pad"
            placeholder="60"
          />
          <Field
            label="Prix (FCFA)"
            value={price}
            onChangeText={setPrice}
            keyboardType="number-pad"
            placeholder="200"
          />
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Débit ↓ (kbps)"
                value={down}
                onChangeText={setDown}
                keyboardType="number-pad"
                placeholder="optionnel"
              />
            </View>
            <View style={{ flex: 1 }}>
              <Field
                label="Débit ↑ (kbps)"
                value={up}
                onChangeText={setUp}
                keyboardType="number-pad"
                placeholder="optionnel"
              />
            </View>
          </View>
          <Button title="Créer le forfait" onPress={create} loading={busy} />
        </Card>

        {query.isLoading ? (
          <Subtitle>Chargement…</Subtitle>
        ) : !query.data?.length ? (
          <Empty text="Aucun forfait. Créez-en un ci-dessus." />
        ) : (
          query.data.map((p: Plan) => (
            <Card key={p.id}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ color: theme.text, fontSize: 16, fontWeight: '700' }}>
                  {p.name}
                </Text>
                <Badge label={`${p.priceXof} F`} tone="gold" />
              </View>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Badge label={fmtDuration(p.durationMinutes)} />
                {p.downloadKbps ? (
                  <Badge label={`↓ ${p.downloadKbps} kbps`} tone="primary" />
                ) : null}
                {p.dataLimitMb ? (
                  <Badge label={`${p.dataLimitMb} Mo`} tone="primary" />
                ) : null}
              </View>
              <Button
                title="Supprimer"
                variant="danger"
                onPress={() => remove(p.id)}
              />
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
