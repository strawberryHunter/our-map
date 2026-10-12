import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { useData } from '../../src/lib/data';
import { supabase } from '../../src/lib/supabase';
import type { Memory } from '../../src/lib/types';
import { useSync } from '../../src/sync/useSync';
import { StoredPhoto, SyncBanner, formatDay } from '../../src/ui/kit';
import { colors, font, personColors } from '../../src/ui/theme';

export default function Timeline() {
  const { memories, people } = useData();
  const { running, sync } = useSync();
  const [covers, setCovers] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = memories.map(m => m.cover_photo).filter(Boolean) as string[];
    if (!ids.length) return;
    supabase.from('photos').select('id, storage_path').in('id', ids)
      .then(({ data }) => setCovers(Object.fromEntries((data ?? []).map(r => [r.id, r.storage_path]))));
  }, [memories]);

  const sections = useMemo(() => {
    const byMonth: Record<string, Memory[]> = {};
    for (const m of memories) {
      const d = new Date(m.started_at);
      const k = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
      (byMonth[k] ??= []).push(m);
    }
    return Object.entries(byMonth).map(([title, data]) => ({ title, data }));
  }, [memories]);

  return (
    <View style={{ flex: 1 }}>
      <SyncBanner />
      <SectionList
        sections={sections}
        keyExtractor={m => m.id}
        contentContainerStyle={{ padding: 16, gap: 12 }}
        refreshControl={<RefreshControl refreshing={running} onRefresh={sync} />}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <Text style={[font.small, s.month]}>{section.title}</Text>}
        ListEmptyComponent={
          <View style={{ paddingTop: 80, gap: 8 }}>
            <Text style={font.h2}>아직 추억이 없어요</Text>
            <Text style={font.body}>설정에서 두 사람 얼굴을 등록하면, 앱을 열 때마다 갤러리에서 둘이 나온 사진을 찾아 날짜와 장소별로 정리해요.</Text>
          </View>
        }
        renderItem={({ item: m }) => (
          <Pressable style={s.row} onPress={() => router.push(`/memory/${m.id}`)}>
            <StoredPhoto path={m.cover_photo ? covers[m.cover_photo] : null} style={s.thumb} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={font.small}>{formatDay(m.started_at)}</Text>
              <Text style={font.h2} numberOfLines={1}>{m.title ?? m.place ?? '정리 중…'}</Text>
              {m.place && m.title ? <Text style={font.small} numberOfLines={1}>{m.place}</Text> : null}
              <View style={{ flexDirection: 'row', gap: 4, marginTop: 2 }}>
                {people.map((p, i) => m.people.includes(p.id) ? (
                  <View key={p.id} style={[s.dot, { backgroundColor: personColors[i % 2] }]} />
                ) : null)}
              </View>
            </View>
          </Pressable>
        )}
      />
    </View>
  );
}

const s = StyleSheet.create({
  month: { marginTop: 8, marginBottom: 4, letterSpacing: 0.5 },
  row: { flexDirection: 'row', gap: 14, backgroundColor: colors.card, borderRadius: 16, padding: 10, alignItems: 'center' },
  thumb: { width: 76, height: 76, borderRadius: 12 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
