import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useData } from '../../src/lib/data';
import { supabase } from '../../src/lib/supabase';
import type { PhotoRow } from '../../src/lib/types';
import { writeStory } from '../../src/sync/sync';
import { Button, Card, StoredPhoto, formatDay } from '../../src/ui/kit';
import { input } from '../../src/ui/styles';
import { colors, font, personColors } from '../../src/ui/theme';

export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { memories, people, reload } = useData();
  const m = memories.find(x => x.id === id);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [memo, setMemo] = useState('');
  const [memoDirty, setMemoDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [story, setStory] = useState('');
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from('photos').select('*').eq('memory_id', id).order('taken_at').then(({ data }) => setPhotos((data ?? []) as PhotoRow[]));
  }, [id]);
  useEffect(() => { if (m && !memoDirty) setMemo(m.memo ?? ''); }, [m?.memo]);

  if (!m) return null;
  const w = Dimensions.get('window').width - 32;

  const saveMemo = async () => {
    await supabase.from('memories').update({ memo: memo.trim() || null }).eq('id', m.id);
    setMemoDirty(false);
  };
  const rewrite = async () => {
    setWriting(true); setError(null);
    try {
      if (memoDirty) await saveMemo();
      await writeStory(m.id);
      await reload();
    } catch (e) {
      setError('이야기를 쓰지 못했어요. 잠시 후 다시 해주세요.');
      console.warn('story', e);
    } finally {
      setWriting(false);
    }
  };
  const saveEdit = async () => {
    await supabase.from('memories').update({ title: title.trim() || null, summary: story.trim() || null }).eq('id', m.id);
    setEditing(false);
    await reload();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: formatDay(m.started_at) }} />

      {m.place_source == null && (
        <Pressable style={s.unplaced} onPress={() => router.push(`/memory/place?id=${m.id}`)}>
          <Text style={[font.body, { fontWeight: '700' }]}>장소가 아직 정해지지 않았어요</Text>
          <Text style={font.small}>사진에 위치 정보가 없어서 자동으로 정하지 않았어요. 눌러서 지도에서 골라주세요.</Text>
        </Pressable>
      )}

      {editing ? (
        <View style={{ gap: 10 }}>
          <TextInput style={input} value={title} onChangeText={setTitle} placeholder="제목" />
          <TextInput style={[input, { minHeight: 120, paddingTop: 12, textAlignVertical: 'top' }]} value={story} onChangeText={setStory} multiline placeholder="그날의 이야기" />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button title="저장" onPress={saveEdit} style={{ flex: 1 }} />
            <Button title="취소" kind="ghost" onPress={() => setEditing(false)} style={{ flex: 1 }} />
          </View>
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={font.title}>{m.title ?? (writing ? '이야기를 쓰는 중…' : '제목 없음')}</Text>
          {m.place ? (
            <Pressable onPress={() => router.push(`/memory/place?id=${m.id}`)}>
              <Text style={[font.small, { color: colors.route, fontWeight: '600' }]}>{m.place}{m.place_source === 'manual' ? ' · 직접 정함' : ''}</Text>
            </Pressable>
          ) : null}
          {m.summary && <Text style={font.body}>{m.summary}</Text>}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {people.map((p, i) => m.people.includes(p.id) ? (
              <Text key={p.id} style={{ color: personColors[i % 2], fontWeight: '600' }}>● {p.name}</Text>
            ) : null)}
          </View>
          <Pressable onPress={() => { setTitle(m.title ?? ''); setStory(m.summary ?? ''); setEditing(true); }}>
            <Text style={[font.small, { textDecorationLine: 'underline', marginTop: 4 }]}>직접 고치기</Text>
          </Pressable>
        </View>
      )}

      <Card>
        <Text style={font.h2}>우리의 메모</Text>
        <Text style={font.small}>그날 있었던 일, 먹은 것, 했던 말을 적어두면 AI가 이야기에 담아요.</Text>
        <TextInput
          style={[input, { minHeight: 90, paddingTop: 12, textAlignVertical: 'top' }]}
          value={memo} multiline placeholder="예: 처음으로 같이 크루아상 만들기 클래스를 들었다"
          onChangeText={t => { setMemo(t); setMemoDirty(true); }} placeholderTextColor={colors.sub}
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {memoDirty && <Button title="메모 저장" kind="ghost" onPress={saveMemo} style={{ flex: 1 }} />}
          <Button title={m.summary ? 'AI로 이야기 다시 쓰기' : 'AI로 이야기 쓰기'} onPress={rewrite} busy={writing} style={{ flex: 1 }} />
        </View>
        {error && <Text style={[font.small, { color: colors.pin }]}>{error}</Text>}
      </Card>

      <Button title="이 추억으로 영화 만들기" kind="ghost" onPress={() => router.push(`/video?ids=${m.id}`)} />

      {photos.map(p => (
        <View key={p.id} style={{ gap: 4 }}>
          <StoredPhoto path={p.storage_path} style={{ width: w, height: p.width && p.height ? (w * p.height) / p.width : w, borderRadius: 14 }} />
          <Text style={font.small}>{new Date(p.taken_at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  unplaced: { backgroundColor: '#FFF4E5', borderRadius: 14, padding: 14, gap: 4, borderWidth: 1, borderColor: '#F3D19C' },
});
