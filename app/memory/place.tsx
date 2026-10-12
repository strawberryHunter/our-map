import { Camera, Map, type MapRef } from '@maplibre/maplibre-react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useData } from '../../src/lib/data';
import { supabase } from '../../src/lib/supabase';
import { Button } from '../../src/ui/kit';
import { input } from '../../src/ui/styles';
import { MAP_STYLE } from '../../src/ui/map';
import { colors, font } from '../../src/ui/theme';

/** Pick where a memory happened: move the map under the pin and name the place. */
export default function PlacePicker() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { memories, reload } = useData();
  const insets = useSafeAreaInsets();
  const m = memories.find(x => x.id === id);
  const map = useRef<MapRef>(null);
  const [name, setName] = useState(m?.place_source === 'manual' ? m.place ?? '' : '');
  const [saving, setSaving] = useState(false);

  // Start where this memory already is, or near the closest-in-time memory that has a place.
  const start = useMemo<[number, number]>(() => {
    if (m?.lat != null) return [m.lng!, m.lat];
    const t = m ? Date.parse(m.started_at) : Date.now();
    const placed = memories.filter(x => x.lat != null).sort((a, b) => Math.abs(Date.parse(a.started_at) - t) - Math.abs(Date.parse(b.started_at) - t));
    return placed[0] ? [placed[0].lng!, placed[0].lat!] : [126.978, 37.5665];
  }, [m, memories]);

  if (!m) return null;
  const save = async () => {
    setSaving(true);
    const [lng, lat] = (await map.current?.getCenter()) ?? start;
    await supabase.from('memories').update({ lat, lng, place: name.trim(), place_source: 'manual' }).eq('id', m.id);
    await reload();
    setSaving(false);
    router.back();
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: '장소 정하기' }} />
      <Map ref={map} style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} compass={false}>
        <Camera initialViewState={{ center: start, zoom: 13 }} />
      </Map>
      <View pointerEvents="none" style={s.crosshair}>
        <View style={s.pin} />
        <View style={s.pinTail} />
      </View>
      <View style={[s.panel, { paddingBottom: insets.bottom + 16 }]}>
        <Text style={font.small}>지도를 움직여 핀을 그날 간 곳에 맞춰주세요.</Text>
        <TextInput style={input} value={name} onChangeText={setName} placeholder="장소 이름 (예: 서울숲 피크닉)" placeholderTextColor={colors.sub} />
        <Button title="이 장소로 정하기" onPress={save} busy={saving} disabled={!name.trim()} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  crosshair: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', marginTop: -150 },
  pin: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.pin, borderWidth: 3, borderColor: '#fff' },
  pinTail: { width: 2, height: 14, backgroundColor: colors.pin },
  panel: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: colors.paper, padding: 16, gap: 10, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
});
