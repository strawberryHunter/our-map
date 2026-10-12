import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef } from '@maplibre/maplibre-react-native';
import { router } from 'expo-router';
import { useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../../src/lib/data';
import { supabase } from '../../src/lib/supabase';
import { StoredPhoto, SyncBanner } from '../../src/ui/kit';
import { TodayCard } from '../../src/ui/TodayCard';
import { MAP_STYLE } from '../../src/ui/map';
import { colors, font } from '../../src/ui/theme';
import { useEffect, useState } from 'react';


export default function MapScreen() {
  const { memories } = useData();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const placed = useMemo(() => memories.filter(m => m.lat != null && m.lng != null), [memories]);
  const covers = useCoverPaths(placed.map(m => m.cover_photo).filter(Boolean) as string[]);

  const route = useMemo(() => ({
    type: 'Feature' as const,
    properties: {},
    geometry: {
      type: 'LineString' as const,
      coordinates: [...placed].sort((a, b) => a.started_at.localeCompare(b.started_at)).map(m => [m.lng!, m.lat!]),
    },
  }), [placed]);

  const bounds = useMemo(() => {
    if (!placed.length) return null;
    const lngs = placed.map(m => m.lng!), lats = placed.map(m => m.lat!);
    const pad = 0.02;
    return [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad] as [number, number, number, number];
  }, [placed]);

  return (
    <View style={{ flex: 1 }}>
      <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} compass={false}>
        <Camera
          ref={camera}
          initialViewState={bounds ? { bounds, padding: { top: 120, bottom: 140, left: 40, right: 40 } } : { center: [126.978, 37.5665], zoom: 10 }}
        />
        {route.geometry.coordinates.length > 1 && (
          <GeoJSONSource id="route" data={route}>
            <Layer id="route-line" type="line" paint={{ 'line-color': colors.route, 'line-width': 2.5, 'line-dasharray': [1.5, 1.5], 'line-opacity': 0.8 }} layout={{ 'line-cap': 'round' }} />
          </GeoJSONSource>
        )}
        {placed.map(m => (
          <Marker key={m.id} id={m.id} lngLat={[m.lng!, m.lat!]} anchor="bottom" onPress={() => router.push(`/memory/${m.id}`)}>
            <View style={s.pin}>
              <StoredPhoto path={m.cover_photo ? covers[m.cover_photo] : null} style={s.pinPhoto} />
              <View style={s.pinTail} />
            </View>
          </Marker>
        ))}
      </Map>

      <View style={[s.top, { paddingTop: insets.top + 8 }]}>
        <Text style={font.title}>OURS</Text>
        <Text style={font.small}>{memories.length ? `추억 ${memories.length}개` : '사진을 정리하면 여기에 핀이 꽂혀요'}</Text>
      </View>
      <View style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 70, gap: 8 }}>
        <SyncBanner />
        <TodayCard />
      </View>

      {memories.length > 0 && (
        <Pressable style={[s.fab, { bottom: 24 }]} onPress={() => router.push('/video')}>
          <Text style={s.fabText}>▶ 추억 영화 만들기</Text>
        </Pressable>
      )}
    </View>
  );
}

/** Map photo id -> storage path for the cover photos on screen. */
function useCoverPaths(ids: string[]) {
  const [paths, setPaths] = useState<Record<string, string>>({});
  const key = ids.join(',');
  useEffect(() => {
    if (!ids.length) return;
    supabase.from('photos').select('id, storage_path').in('id', ids).then(({ data }) => {
      setPaths(Object.fromEntries((data ?? []).map(r => [r.id, r.storage_path])));
    });
  }, [key]);
  return paths;
}

const s = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: 'rgba(244,245,247,0.92)' },
  pin: { alignItems: 'center' },
  pinPhoto: { width: 46, height: 46, borderRadius: 23, borderWidth: 3, borderColor: '#fff' },
  pinTail: { width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: '#fff', marginTop: -1 },
  fab: { position: 'absolute', alignSelf: 'center', backgroundColor: colors.ink, borderRadius: 24, paddingHorizontal: 20, paddingVertical: 14 },
  fabText: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
