import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useData } from '../lib/data';
import { supabase } from '../lib/supabase';
import { todaysMemories } from '../lib/today';
import { StoredPhoto } from './kit';
import { colors, font } from './theme';

/** "오늘의 추억" cards: 1년 전 오늘, 첫 추억/첫 여행 주년, D+100... Hidden when there is nothing. */
export function TodayCard() {
  const { memories } = useData();
  const items = useMemo(() => todaysMemories(memories, Date.now()), [memories]);
  const [covers, setCovers] = useState<Record<string, string>>({});

  useEffect(() => {
    const ids = items.flatMap(i => i.memoryIds.slice(0, 1)).map(id => memories.find(m => m.id === id)?.cover_photo).filter(Boolean) as string[];
    if (!ids.length) return;
    supabase.from('photos').select('id, storage_path').in('id', ids)
      .then(({ data }) => setCovers(Object.fromEntries((data ?? []).map(r => [r.id, r.storage_path]))));
  }, [items, memories]);

  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}>
      {items.map(it => {
        const m = memories.find(x => x.id === it.memoryIds[0]);
        if (!m) return null;
        return (
          <Pressable key={it.kind + it.label} style={s.card} onPress={() => router.push(`/memory/${m.id}`)}>
            <StoredPhoto path={m.cover_photo ? covers[m.cover_photo] : null} style={s.photo} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.label}>{it.label}</Text>
              <Text style={font.h2} numberOfLines={1}>{m.title ?? m.place ?? '그날의 우리'}</Text>
              {it.memoryIds.length > 1 && <Text style={font.small}>외 {it.memoryIds.length - 1}개</Text>}
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  card: { width: 300, flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: colors.card, borderRadius: 16, padding: 10, borderWidth: 1, borderColor: colors.line },
  photo: { width: 64, height: 64, borderRadius: 12 },
  label: { fontSize: 12, fontWeight: '700', color: colors.pin, letterSpacing: 0.3 },
});
