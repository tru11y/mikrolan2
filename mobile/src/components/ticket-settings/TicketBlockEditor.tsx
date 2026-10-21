import { useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TicketBlock, TicketBlockId } from '@/src/lib/api';
import { BLOCK_FLAG, isBlockVisible, type ResolvedTicketTemplate } from '@/src/lib/ticketTemplate';
import { Button, Field } from '@/src/components/ui';
import { useTheme } from '@/src/providers/theme-provider';

export function Toggle({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
      }}
    >
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', flex: 1 }}>
        {label}
      </Text>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.border, true: theme.primary }}
        thumbColor={theme.onStrong}
      />
    </View>
  );
}

export function Divider() {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.border }} />;
}

function Chip({
  label,
  onPress,
  active,
  accessibilityLabel,
  disabled,
}: {
  label: string;
  onPress: () => void;
  active?: boolean;
  accessibilityLabel?: string;
  disabled?: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={{
        minWidth: 40,
        minHeight: 40,
        paddingHorizontal: 10,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 8,
        borderWidth: 1,
        borderColor: active ? theme.primary : theme.border,
        backgroundColor: active ? theme.primary : 'transparent',
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Text style={{ color: active ? theme.onStrong : theme.text, fontWeight: '700' }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const theme = useTheme();
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 10) / 10));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 8 }}>
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', flex: 1 }}>{label}</Text>
      <Chip label="−" accessibilityLabel={`${label} −`} onPress={() => onChange(clamp(value - step))} />
      <Text style={{ color: theme.text, minWidth: 36, textAlign: 'center' }}>{value}</Text>
      <Chip label="+" accessibilityLabel={`${label} +`} onPress={() => onChange(clamp(value + step))} />
    </View>
  );
}

export function Segment<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ paddingVertical: 8, gap: 6 }}>
      <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {options.map(([v, text]) => (
          <Chip key={v} label={text} active={v === value} onPress={() => onChange(v)} />
        ))}
      </View>
    </View>
  );
}

const ALIGN_LABEL: Record<TicketBlock['align'], string> = { left: 'G', center: 'C', right: 'D' };
const ALIGNS: TicketBlock['align'][] = ['left', 'center', 'right'];

type TextKey = 'header' | 'companyName' | 'wifiName' | 'note' | 'footer';
const TEXT_KEY: Partial<Record<TicketBlockId, TextKey>> = {
  header: 'header',
  companyName: 'companyName',
  contact: 'wifiName',
  note: 'note',
  footer: 'footer',
};

export function BlockEditor({
  block,
  tpl,
  first,
  last,
  onToggle,
  onChange,
  onMove,
  onText,
  onPickLogo,
}: {
  block: TicketBlock;
  tpl: ResolvedTicketTemplate;
  first: boolean;
  last: boolean;
  onToggle: (v: boolean) => void;
  onChange: (b: TicketBlock) => void;
  onMove: (delta: -1 | 1) => void;
  onText: (key: TextKey, v: string) => void;
  onPickLogo: () => void;
}) {
  const theme = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const visible = isBlockVisible(tpl, block.id);
  const textKey = TEXT_KEY[block.id];
  const label = t(`ticketSettings.blocks.${block.id}`);

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          accessibilityRole="button"
          accessibilityLabel={label}
          style={{ flex: 1, paddingVertical: 14 }}
        >
          <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }}>
            {open ? '▾ ' : '▸ '}
            {label}
          </Text>
        </Pressable>
        <Chip label="▲" accessibilityLabel={`${label} ↑`} disabled={first} onPress={() => onMove(-1)} />
        <Chip label="▼" accessibilityLabel={`${label} ↓`} disabled={last} onPress={() => onMove(1)} />
        {BLOCK_FLAG[block.id] ? (
          <Switch
            value={visible}
            onValueChange={onToggle}
            trackColor={{ false: theme.border, true: theme.primary }}
            thumbColor={theme.onStrong}
          />
        ) : null}
      </View>
      {open ? (
        <View style={{ paddingBottom: 12 }}>
          {textKey ? (
            <Field
              label={t('ticketSettings.text')}
              value={tpl[textKey] ?? ''}
              onChangeText={(v) => onText(textKey, v)}
            />
          ) : null}
          {block.id === 'logo' ? (
            <Button
              title={tpl.logoDataUri ? t('ticketSettings.changeLogo') : t('ticketSettings.selectLogo')}
              variant="ghost"
              onPress={onPickLogo}
            />
          ) : null}
          <Stepper
            label={t('ticketSettings.size')}
            value={block.size}
            min={3}
            max={40}
            step={0.5}
            onChange={(size) => onChange({ ...block, size })}
          />
          {block.id !== 'logo' && block.id !== 'qr' ? (
            <>
              <Toggle
                label={t('ticketSettings.bold')}
                value={block.bold}
                onValueChange={(bold) => onChange({ ...block, bold })}
              />
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {ALIGNS.map((a) => (
                  <Chip
                    key={a}
                    label={ALIGN_LABEL[a]}
                    accessibilityLabel={t(`ticketSettings.align.${a}`)}
                    active={block.align === a}
                    onPress={() => onChange({ ...block, align: a })}
                  />
                ))}
              </View>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
