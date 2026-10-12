import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Share, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { photoUrl, useData } from '../src/lib/data';
import { supabase } from '../src/lib/supabase';
import type { Memory } from '../src/lib/types';
import { Button, formatDay } from '../src/ui/kit';
import { colors, font } from '../src/ui/theme';
import { cameraFrames } from '../src/video/camera';
import { storyHtml } from '../src/video/storyHtml';
import { dayKey, filmStamp, movieStats, planMovie, type MovieStop } from '../src/video/timeline';

const MAX = 30;
const ym = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`; };

export default function MovieScreen() {
  const { ids } = useLocalSearchParams<{ ids?: string }>();
  const { memories } = useData();
  const { width } = useWindowDimensions();
  const sorted = useMemo(() => [...memories].sort((a, b) => b.started_at.localeCompare(a.started_at)), [memories]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(ids ? ids.split(',') : sorted.slice(0, 5).map(m => m.id)));
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [pct, setPct] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const file = useRef<File | null>(null);

  const toggle = (id: string) => setPicked(p => {
    const n = new Set(p);
    if (n.has(id)) n.delete(id); else if (n.size < MAX) n.add(id);
    return n;
  });
  const selectRange = (days: number | null) =>
    setPicked(new Set(sorted.filter(m => days == null || Date.parse(m.started_at) > Date.now() - days * 864e5).slice(0, MAX).map(m => m.id)));

  const start = async () => {
    setSaved(null); setPct(0); setStatus('사진 준비 중');
    const list: Memory[] = sorted.filter(m => picked.has(m.id)).reverse(); // oldest first
    const stops: MovieStop[] = [];
    const counts: number[] = [];
    let hero: string | null = null, heroScore = -1;
    for (const m of list) {
      const { data } = await supabase.from('photos').select('storage_path, people').eq('memory_id', m.id).order('taken_at');
      const rows = data ?? [];
      counts.push(rows.length);
      // Photos with both of us first.
      const best = [...rows].sort((a, b) => b.people.length - a.people.length).slice(0, 3);
      const urls = (await Promise.all(best.map(r => photoUrl(r.storage_path)))).filter(Boolean) as string[];
      if (best[0] && best[0].people.length > heroScore && urls[0]) { heroScore = best[0].people.length; hero = urls[0]; }
      stops.push({
        lat: m.lat, lng: m.lng, date: formatDay(m.started_at), stamp: filmStamp(m.started_at),
        title: m.title ?? m.place ?? '', place: m.place ?? '', photos: urls,
      });
    }
    const plan = planMovie(stops);
    const stats = movieStats(list.map((m, i) => ({ lat: m.lat, lng: m.lng, dayKey: dayKey(m.started_at), photoCount: counts[i] })));
    const range = ym(list[0].started_at) === ym(list.at(-1)!.started_at) ? ym(list[0].started_at) : `${ym(list[0].started_at)} – ${ym(list.at(-1)!.started_at)}`;
    setHtml(storyHtml({ range, hero, stats, stops, ...plan, frames: cameraFrames(stops, plan.shots, plan.total) }));
  };

  const onMessage = async (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data);
    if (msg.type === 'status') setStatus(msg.text);
    else if (msg.type === 'progress') setPct(Math.round((msg.done / msg.total) * 100));
    else if (msg.type === 'error') { setStatus(`영상을 만들지 못했어요: ${msg.text}`); setHtml(null); }
    else if (msg.type === 'begin') {
      const f = new File(Paths.cache, `ours-${Date.now()}.${msg.ext}`);
      f.create();
      file.current = f;
    } else if (msg.type === 'chunk') {
      file.current?.write(msg.data, { encoding: 'base64', append: true });
    } else if (msg.type === 'end' && file.current) {
      setHtml(null);
      const perm = await requestPermissionsAsync(true);
      if (perm.granted) {
        await Asset.create(file.current.uri);
        setSaved('갤러리에 저장했어요');
      } else setSaved('갤러리 권한이 없어서 공유로만 보낼 수 있어요');
      setStatus(null);
    }
  };

  if (html) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.paper }}>
        <WebView
          source={{ html, baseUrl: 'https://localhost' }}
          originWhitelist={['*']}
          onMessage={onMessage}
          style={{ width, height: width * (16 / 9) * 0.6, flex: 0, alignSelf: 'center', backgroundColor: colors.ink }}
          javaScriptEnabled
          scrollEnabled={false}
        />
        <View style={{ padding: 16, gap: 8 }}>
          <View style={s.bar}><View style={[s.barFill, { width: `${pct}%` }]} /></View>
          <Text style={font.small}>{status} {pct ? `${pct}%` : ''} · 만드는 동안 이 화면을 켜두세요</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ padding: 16, gap: 10 }}>
        <Text style={font.body}>영화에 넣을 추억을 고르세요. 다녀온 곳을 지도 위로 날아가며, 장소마다 사진을 필름 사진처럼 보여줘요. 세로 9:16이라 릴스·스토리에 바로 올릴 수 있어요.</Text>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          {[['최근 한 달', 31], ['최근 3개월', 92], ['올해', Math.ceil((Date.now() - new Date(new Date().getFullYear(), 0, 1).getTime()) / 864e5)], ['전체', null]].map(([label, days]) => (
            <Pressable key={String(label)} onPress={() => selectRange(days as number | null)} style={s.chip}><Text>{label as string}</Text></Pressable>
          ))}
          <Pressable onPress={() => setPicked(new Set())} style={s.chip}><Text>선택 해제</Text></Pressable>
        </View>
      </View>
      <FlatList
        data={sorted}
        keyExtractor={m => m.id}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 6, paddingBottom: 120 }}
        renderItem={({ item: m }) => {
          const on = picked.has(m.id);
          return (
            <Pressable onPress={() => toggle(m.id)} style={[s.row, on && s.rowOn]}>
              <View style={[s.check, on && s.checkOn]}>{on && <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text>}</View>
              <View style={{ flex: 1 }}>
                <Text style={font.small}>{formatDay(m.started_at)}</Text>
                <Text style={font.body} numberOfLines={1}>{m.title ?? m.place ?? '제목 없음'}</Text>
              </View>
              {m.lat == null && <Text style={[font.small, { color: '#B26A00' }]}>위치 없음</Text>}
            </Pressable>
          );
        }}
      />
      <View style={s.footer}>
        {saved && <Text style={[font.small, { color: colors.route }]}>{saved}</Text>}
        {status && <Text style={font.small}>{status}</Text>}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {saved && file.current && <Button title="공유" kind="ghost" onPress={() => Share.share({ url: file.current!.uri })} style={{ flex: 1 }} />}
          <Button title={`추억 ${picked.size}개로 영화 만들기`} onPress={start} disabled={picked.size === 0} style={{ flex: 2 }} />
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: colors.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'transparent' },
  rowOn: { borderColor: colors.ink },
  check: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: 28, gap: 8, backgroundColor: colors.paper, borderTopWidth: 1, borderTopColor: colors.line },
  bar: { height: 8, borderRadius: 4, backgroundColor: colors.line, overflow: 'hidden' },
  barFill: { height: 8, backgroundColor: colors.pin },
});
