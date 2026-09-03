import { Pressable, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/src/providers/theme-provider';

// Physical-ticket look (white card) — matches the reference "TicketPreviewModal"
// format so a printed/screenshotted ticket reads correctly on paper.
export function TicketCard({
  code,
  planName,
  priceXof,
  durationLabel,
  ticketNumber,
  createdAt,
  wifiName,
  compact = false,
}: {
  code: string;
  planName: string;
  priceXof: number;
  durationLabel: string;
  ticketNumber?: number;
  createdAt?: Date;
  wifiName?: string;
  compact?: boolean;
}) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const qrSize = compact ? 84 : 130;

  async function copyCode() {
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#E2E8F0',
        overflow: 'hidden',
      }}
    >
      {/* Orange top band */}
      <View
        style={{
          backgroundColor: theme.warning,
          paddingVertical: 6,
          paddingHorizontal: 16,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 6,
        }}
      >
        <View
          style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#0F172A' }}
        />
        <Text
          style={{
            color: '#0F172A',
            fontSize: 11,
            fontWeight: '800',
            letterSpacing: 0.6,
          }}
        >
          {wifiName || 'PASS WIFI'}
        </Text>
      </View>

      <View style={{ padding: compact ? 14 : 20, gap: compact ? 10 : 16, alignItems: 'center' }}>
        {/* Brand */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="wifi" size={compact ? 16 : 20} color={theme.primary} />
          <Text
            style={{
              color: theme.primary,
              fontSize: compact ? 14 : 18,
              fontWeight: '800',
            }}
          >
            MikroLan2{ticketNumber ? ` #${ticketNumber}` : ''}
          </Text>
        </View>

        {/* Code box */}
        <View
          style={{
            backgroundColor: '#F8FAFC',
            borderWidth: 2,
            borderColor: '#0F172A',
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: compact ? 8 : 12,
            alignItems: 'center',
            gap: 2,
            width: '100%',
          }}
        >
          <Text
            style={{
              color: '#64748B',
              fontSize: 10,
              fontWeight: '700',
              letterSpacing: 1,
            }}
          >
            CODE ACCÈS TICKET
          </Text>
          <Pressable
            onPress={copyCode}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Text
              style={{
                color: '#0F172A',
                fontSize: compact ? 17 : 24,
                fontWeight: '900',
                fontFamily: theme.mono,
                letterSpacing: 1,
              }}
            >
              {code}
            </Text>
            <Ionicons
              name={copied ? 'checkmark' : 'copy-outline'}
              size={16}
              color={copied ? '#059669' : '#334155'}
            />
          </Pressable>
        </View>

        {/* Duration / Price grid */}
        <View
          style={{
            flexDirection: 'row',
            backgroundColor: '#F1F5F9',
            borderRadius: 12,
            padding: 10,
            width: '100%',
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: '#64748B', fontSize: 10 }}>DURÉE</Text>
            <Text style={{ color: '#0F172A', fontSize: 12, fontWeight: '700' }}>
              {durationLabel}
            </Text>
          </View>
          <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: '#CBD5E1', paddingLeft: 8 }}>
            <Text style={{ color: '#64748B', fontSize: 10 }}>PRIX</Text>
            <Text style={{ color: '#059669', fontSize: 12, fontWeight: '700' }}>
              {priceXof.toLocaleString('fr-FR')} FCFA
            </Text>
          </View>
        </View>

        {/* QR */}
        <View style={{ alignItems: 'center', gap: 6 }}>
          <QRCode value={code} size={qrSize} backgroundColor="#FFFFFF" color="#0F172A" />
          {!compact ? (
            <Text style={{ color: '#64748B', fontSize: 10 }}>
              Scannez le QR Code pour vous connecter
            </Text>
          ) : null}
        </View>

        {!compact ? (
          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: '#CBD5E1',
              borderStyle: 'dashed',
              paddingTop: 10,
              width: '100%',
              gap: 2,
            }}
          >
            {createdAt ? (
              <Text style={{ color: '#64748B', fontSize: 11 }}>
                Généré le : {createdAt.toLocaleString('fr-FR')}
              </Text>
            ) : null}
            <Text style={{ color: '#64748B', fontSize: 10, fontStyle: 'italic' }}>
              Rendez-vous sur la page de connexion WiFi pour saisir votre code.
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
