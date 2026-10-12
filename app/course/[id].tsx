import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../src/lib/supabase';
import type { DateCourse } from '../../src/lib/types';
import { Button } from '../../src/ui/kit';
import { MAP_STYLE } from '../../src/ui/map';
import { colors, font } from '../../src/ui/theme';

export default function CourseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [c, setC] = useState<DateCourse | null>(null);

  useEffect(() => {
    supabase.from('date_courses').select('*').eq('id', id).single().then(({ data }) => setC(data as DateCourse));
  }, [id]);

  const placed = useMemo(() => (c?.course.stops ?? []).map((s, i) => ({ ...s, n: i + 1 })).filter(s => s.lat != null && s.lng != null), [c]);
  const bounds = useMemo(() => {
    if (!placed.length) return null;
    const lngs = placed.map(s => s.lng!), lats = placed.map(s => s.lat!);
    return [Math.min(...lngs) - 0.004, Math.min(...lats) - 0.004, Math.max(...lngs) + 0.004, Math.max(...lats) + 0.004] as [number, number, number, number];
  }, [placed]);

  if (!c) return null;
  const toggleSave = async () => {
    await supabase.from('date_courses').update({ saved: !c.saved }).eq('id', c.id);
    setC({ ...c, saved: !c.saved });
  };
  const remove = async () => {
    await supabase.from('date_courses').delete().eq('id', c.id);
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={{ gap: 14, paddingBottom: 40 }}>
      <Stack.Screen options={{ title: c.course.title }} />
      {bounds && (
        <View style={{ height: 260 }}>
          <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} compass={false}>
            <Camera initialViewState={{ bounds, padding: { top: 40, bottom: 40, left: 40, right: 40 } }} />
            {placed.length > 1 && (
              <GeoJSONSource id="course" data={{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: placed.map(s => [s.lng!, s.lat!]) } }}>
                <Layer id="course-line" type="line" paint={{ 'line-color': colors.route, 'line-width': 3, 'line-dasharray': [1.5, 1.5] }} />
              </GeoJSONSource>
            )}
            {placed.map(s => (
              <Marker key={s.n} id={`stop-${s.n}`} lngLat={[s.lng!, s.lat!]} anchor="center">
                <View style={s2.num}><Text style={{ color: '#fff', fontWeight: '800' }}>{s.n}</Text></View>
              </Marker>
            ))}
          </Map>
        </View>
      )}
      <View style={{ paddingHorizontal: 16, gap: 6 }}>
        <Text style={font.title}>{c.course.title}</Text>
        {c.course.summary ? <Text style={font.body}>{c.course.summary}</Text> : null}
      </View>
      {c.course.stops.map((s, i) => (
        <View key={i} style={s2.stop}>
          <View style={s2.num}><Text style={{ color: '#fff', fontWeight: '800' }}>{i + 1}</Text></View>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={font.small}>{[s.time, s.category].filter(Boolean).join(' · ')}</Text>
            <Text style={font.h2}>{s.name}</Text>
            {s.address && <Text style={font.small} selectable>{s.address}</Text>}
            <Text style={font.body}>{s.why}</Text>
            {s.url && (
              <Pressable onPress={() => Linking.openURL(s.url!)}>
                <Text style={[font.small, { color: colors.route, textDecorationLine: 'underline' }]}>장소 정보 보기</Text>
              </Pressable>
            )}
            {s.lat == null && <Text style={[font.small, { color: '#B26A00' }]}>지도에서 위치를 찾지 못했어요</Text>}
          </View>
        </View>
      ))}
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <Text style={font.small}>AI가 웹 검색으로 고른 곳이에요. 가기 전에 영업시간을 한 번 확인해주세요.</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button title={c.saved ? '저장 취소' : '이 코스 저장'} onPress={toggleSave} style={{ flex: 2 }} />
          <Button title="삭제" kind="ghost" onPress={remove} style={{ flex: 1 }} />
        </View>
      </View>
    </ScrollView>
  );
}

const s2 = StyleSheet.create({
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.pin, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  stop: { flexDirection: 'row', gap: 12, marginHorizontal: 16, backgroundColor: colors.card, borderRadius: 14, padding: 14 },
});
