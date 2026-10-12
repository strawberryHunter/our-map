import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { usePhotoUrl } from '../lib/data';
import { useSync } from '../sync/useSync';
import { colors, font } from './theme';

export function Button({ title, onPress, kind = 'primary', disabled, busy, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'ghost'; disabled?: boolean; busy?: boolean; style?: ViewStyle;
}) {
  const primary = kind === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        s.btn,
        primary ? s.btnPrimary : s.btnGhost,
        (disabled || busy) && { opacity: 0.5 },
        pressed && { opacity: 0.8 },
        style,
      ]}
    >
      {busy ? <ActivityIndicator color={primary ? '#fff' : colors.ink} /> :
        <Text style={[s.btnText, { color: primary ? '#fff' : colors.ink }]}>{title}</Text>}
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function StoredPhoto({ path, style }: { path: string | null | undefined; style: object }) {
  const url = usePhotoUrl(path);
  return <Image source={url ? { uri: url } : null} style={[{ backgroundColor: colors.line }, style]} contentFit="cover" transition={150} />;
}

/** Thin banner that shows what the background sync is doing. */
export function SyncBanner() {
  const { running, progress, lastResult, error } = useSync();
  const text = running
    ? `${progress?.stage ?? '동기화 중'}${progress?.total ? ` ${progress.done}/${progress.total}` : ''}`
    : error ?? lastResult;
  if (!text) return null;
  return (
    <View style={[s.banner, error ? { backgroundColor: '#FDECEA' } : null]}>
      {running && <ActivityIndicator size="small" color={colors.route} />}
      <Text style={[font.small, { color: error ? colors.pin : colors.ink, flex: 1 }]} numberOfLines={2}>{text}</Text>
    </View>
  );
}

export function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

const s = StyleSheet.create({
  btn: { minHeight: 48, borderRadius: 12, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: colors.ink },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.line },
  btnText: { fontSize: 16, fontWeight: '600' },
  card: { backgroundColor: colors.card, borderRadius: 16, padding: 16, gap: 10 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#E8F2F2' },
});
