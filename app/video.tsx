import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';
import { useRef, useState } from 'react';
import { Pressable, Share, Text, View, useWindowDimensions } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { photoUrl, useData } from '../src/lib/data';
import { supabase } from '../src/lib/supabase';
import { Button, formatDay } from '../src/ui/kit';
import { colors, font } from '../src/ui/theme';
import { storyHtml, type StoryStop } from '../src/video/storyHtml';

const RANGES = [
  { label: '최근 3개월', days: 92 },
  { label: '올해', days: -1 },
  { label: '전체', days: 0 },
];
const MAX_STOPS = 24;

export default function VideoScreen() {
  const { memories } = useData();
  const { width } = useWindowDimensions();
  const [range, setRange] = useState(0);
  const [html, setHtml] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const file = useRef<File | null>(null);

  const pick = () => {
    const r = RANGES[range];
    const from = r.days > 0 ? Date.now() - r.days * 864e5 : r.days < 0 ? new Date(new Date().getFullYear(), 0, 1).getTime() : 0;
    return memories
      .filter(m => m.lat != null && Date.parse(m.started_at) >= from)
      .sort((a, b) => a.started_at.localeCompare(b.started_at))
      .slice(-MAX_STOPS);
  };

  const start = async () => {
    setSaved(null); setStatus('준비 중');
    const list = pick();
    const stops: StoryStop[] = [];
    for (const m of list) {
      const { data } = await supabase.from('photos').select('storage_path, people').eq('memory_id', m.id).order('taken_at');
      const rows = (data ?? []).sort((a, b) => b.people.length - a.people.length).slice(0, 3);
      const urls = (await Promise.all(rows.map(r => photoUrl(r.storage_path)))).filter(Boolean) as string[];
      stops.push({
        lat: m.lat!, lng: m.lng!, date: formatDay(m.started_at),
        title: m.title ?? m.place ?? '', place: m.place ?? '', summary: m.summary ?? '', photos: urls,
      });
    }
    const first = new Date(list[0].started_at), last = new Date(list[list.length - 1].started_at);
    const ym = (d: Date) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
    setHtml(storyHtml({ title: '우리 지도', subtitle: `${ym(first)} – ${ym(last)}`, stops }));
  };

  const onMessage = async (e: WebViewMessageEvent) => {
    const msg = JSON.parse(e.nativeEvent.data);
    if (msg.type === 'status') setStatus(msg.text);
    else if (msg.type === 'error') { setStatus(`문제가 생겼어요: ${msg.text}`); setHtml(null); }
    else if (msg.type === 'begin') {
      const f = new File(Paths.cache, `our-map-${Date.now()}.${msg.ext}`);
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

  const count = pick().length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      {html ? (
        <>
          <WebView
            source={{ html, baseUrl: 'https://localhost' }}
            originWhitelist={['*']}
            onMessage={onMessage}
            style={{ width, height: width * 1.25, flex: 0, backgroundColor: colors.ink }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            scrollEnabled={false}
          />
          <Text style={[font.small, { padding: 16 }]}>{status}  ·  녹화 중에는 화면을 켜두세요</Text>
        </>
      ) : (
        <View style={{ padding: 20, gap: 16 }}>
          <Text style={font.body}>지도를 따라 다녀온 곳을 순서대로 날아가며, 장소마다 사진과 한 줄 기록을 보여주는 영상을 만들어요. 세로 4:5 비율이라 인스타에 바로 올릴 수 있어요.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {RANGES.map((r, i) => (
              <Pressable key={r.label} onPress={() => setRange(i)}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: i === range ? colors.ink : colors.line, backgroundColor: i === range ? colors.ink : 'transparent' }}>
                <Text style={{ color: i === range ? '#fff' : colors.ink }}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={font.small}>{count ? `장소 ${count}곳 · 약 ${Math.round(count * 6.5 + 8)}초` : '이 기간에는 위치가 있는 추억이 없어요'}</Text>
          <Button title="영상 만들기" onPress={start} disabled={count < 1} />
          {status && <Text style={font.small}>{status}</Text>}
          {saved && (
            <>
              <Text style={[font.body, { color: colors.route }]}>{saved}</Text>
              {file.current && <Button title="공유하기" kind="ghost" onPress={() => Share.share({ url: file.current!.uri })} />}
            </>
          )}
        </View>
      )}
    </View>
  );
}
