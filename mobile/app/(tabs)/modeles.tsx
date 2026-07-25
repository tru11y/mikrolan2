import { View } from 'react-native';
import { Empty, Subtitle, theme, Title } from '@/src/components/ui';
import { BottomNav } from '@/src/components/BottomNav';

// Bibliothèque de modèles de portail captif (réf. MikroTicket TemplatesScreen).
// Pas encore backé (aucun template/portail personnalisé côté serveur) —
// placeholder cohérent avec le reste de l'app ("Bientôt disponible").
export default function ModelesScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <View style={{ padding: 16, gap: 16, flex: 1 }}>
        <View>
          <Title>Modèles de portail</Title>
          <Subtitle>Personnalisez la page de connexion de vos hotspots</Subtitle>
        </View>
        <Empty text="Bientôt disponible sur cette version." />
      </View>
      <BottomNav active="modeles" />
    </View>
  );
}
