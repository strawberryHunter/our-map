import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Dimensions, ScrollView, Text, TextInput, View } from 'react-native';
import { useData } from '../../src/lib/data';
import { supabase } from '../../src/lib/supabase';
import type { PhotoRow } from '../../src/lib/types';
import { Button, StoredPhoto, formatDay } from '../../src/ui/kit';
import { input } from '../../src/ui/styles';
import { colors, font, personColors } from '../../src/ui/theme';

export default function MemoryScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { memories, people } = useData();
  const m = memories.find(x => x.id === id);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');

  useEffect(() => {
    supabase.from('photos').select('*').eq('memory_id', id).order('taken_at').then(({ data }) => setPhotos((data ?? []) as PhotoRow[]));
  }, [id]);

  if (!m) return null;
  const w = Dimensions.get('window').width - 32;
  const save = async () => {
    await supabase.from('memories').update({ title: title.trim() || null, summary: summary.trim() || null }).eq('id', m.id);
    setEditing(false);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Stack.Screen options={{ title: formatDay(m.started_at) }} />
      {editing ? (
        <View style={{ gap: 10 }}>
          <TextInput style={input} value={title} onChangeText={setTitle} placeholder="제목" />
          <TextInput style={[input, { minHeight: 90, paddingTop: 12 }]} value={summary} onChangeText={setSummary} multiline placeholder="무엇을 했는지" />
          <Button title="저장" onPress={save} />
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={font.title}>{m.title ?? '정리 중…'}</Text>
          {m.place && <Text style={[font.small, { color: colors.route, fontWeight: '600' }]}>{m.place}</Text>}
          {m.summary && <Text style={font.body}>{m.summary}</Text>}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
            {people.map((p, i) => m.people.includes(p.id) ? (
              <Text key={p.id} style={{ color: personColors[i % 2], fontWeight: '600' }}>● {p.name}</Text>
            ) : null)}
          </View>
          <Button title="글 고치기" kind="ghost" style={{ alignSelf: 'flex-start', minHeight: 36, marginTop: 6 }}
            onPress={() => { setTitle(m.title ?? ''); setSummary(m.summary ?? ''); setEditing(true); }} />
        </View>
      )}
      {photos.map(p => (
        <View key={p.id} style={{ gap: 4 }}>
          <StoredPhoto path={p.storage_path} style={{ width: w, height: p.width && p.height ? (w * p.height) / p.width : w, borderRadius: 14 }} />
          <Text style={font.small}>{new Date(p.taken_at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
