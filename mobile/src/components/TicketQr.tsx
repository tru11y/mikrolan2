import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';
import { Button, Mono, theme } from './ui';

// A voucher code shown with its scannable QR. Tap → full-screen enlarge so a
// customer can scan it (or the operator can print/screenshot). See
// project_mikrolan2_stitch_redesign (Créer Tickets).
export function TicketQr({
  code,
  size = 72,
}: {
  code: string;
  size?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Agrandir le QR du code ${code}`}
        onPress={() => setOpen(true)}
        style={{
          backgroundColor: '#FFFFFF',
          padding: 6,
          borderRadius: 8,
        }}
      >
        <QRCode value={code} size={size} backgroundColor="#FFFFFF" color="#0B0B12" />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.85)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 20,
          }}
        >
          <View
            style={{
              backgroundColor: '#FFFFFF',
              padding: 20,
              borderRadius: 16,
            }}
          >
            <QRCode value={code} size={240} backgroundColor="#FFFFFF" color="#0B0B12" />
          </View>
          <Mono style={{ color: theme.text, fontSize: 24, letterSpacing: 2 }}>
            {code}
          </Mono>
          <Text style={{ color: theme.textMuted, textAlign: 'center' }}>
            Scannez ce code pour vous connecter au WiFi.
          </Text>
          <View style={{ width: 220 }}>
            <Button title="Fermer" variant="ghost" onPress={() => setOpen(false)} />
          </View>
        </View>
      </Modal>
    </>
  );
}
