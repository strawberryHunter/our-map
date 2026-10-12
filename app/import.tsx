import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useData } from '../src/lib/data';
import { importPicked, type Progress } from '../src/sync/sync';
import { Button, Card, formatDay } from '../src/ui/kit';
import { colors, font } from '../src/ui/theme';

export default function ImportScreen() {
  const { session, couple, people, memories, reload } = useData();
  const [progress, setProgress] = useState<Progress | null>(null);
  const [result, setResult] = useState<{ ids: string[]; photos: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    if (!session || !couple) return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 60, exif: true, orderedSelection: true });
    if (res.canceled) return;
    setError(null); setResult(null);
    try {
      const r = await importPicked({ userId: session.user.id, coupleId: couple.id, people, onProgress: setProgress }, res.assets);
      await reload();
      setResult({ ids: r.memoryIds, photos: r.photos, skipped: r.skippedNoDate });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  const made = result ? memories.filter(m => result.ids.includes(m.id)) : [];
  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} style={{ backgroundColor: colors.paper }}>
      <Text style={font.body}>여행이나 데이트 사진을 고르면 찍은 날짜와 위치로 하루 단위 추억을 만들어요. 위치 정보가 없는 사진은 장소를 자동으로 정하지 않고, 직접 고를 수 있게 남겨둬요.</Text>
      <Button title={progress ? `${progress.stage} ${progress.total ? `${progress.done}/${progress.total}` : ''}` : '사진 고르기 (최대 60장)'} onPress={pick} busy={!!progress} />
      {error && <Text style={[font.small, { color: colors.pin }]}>{error}</Text>}
      {result && (
        <Card>
          <Text style={font.h2}>추억 {made.length}개, 사진 {result.photos}장</Text>
          {result.skipped > 0 && <Text style={font.small}>찍은 날짜를 알 수 없는 사진 {result.skipped}장은 뺐어요.</Text>}
          {made.map(m => (
            <Pressable key={m.id} onPress={() => router.push(`/memory/${m.id}`)} style={{ paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.line }}>
              <Text style={font.small}>{formatDay(m.started_at)}</Text>
              <Text style={font.body}>{m.title ?? '이야기를 쓰는 중…'}</Text>
              {m.place_source == null
                ? <Text style={[font.small, { color: '#B26A00' }]}>장소 미확정 · 눌러서 정하기</Text>
                : m.place ? <Text style={[font.small, { color: colors.route }]}>{m.place}</Text> : null}
            </Pressable>
          ))}
        </Card>
      )}
      {!people.length && (
        <View><Text style={font.small}>얼굴을 등록해두면 사진마다 누가 나왔는지도 표시돼요 (설정 탭).</Text></View>
      )}
    </ScrollView>
  );
}
