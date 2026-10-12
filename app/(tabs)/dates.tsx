import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useData } from '../../src/lib/data';
import { supabase } from '../../src/lib/supabase';
import type { DateCourse } from '../../src/lib/types';
import { Button, Card } from '../../src/ui/kit';
import { input } from '../../src/ui/styles';
import { colors, font } from '../../src/ui/theme';

const MOODS = ['조용한', '맛집 탐방', '전시·문화', '야경', '자연·산책', '액티브'];
const BUDGETS = ['5만원 이하', '5~10만원', '10만원 이상'];
const WHENS = ['평일 저녁', '주말 낮', '주말 하루'];

function Chips({ items, value, onChange }: { items: string[]; value: string | null; onChange: (v: string | null) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map(it => {
        const on = value === it;
        return (
          <Pressable key={it} onPress={() => onChange(on ? null : it)} style={[s.chip, on && s.chipOn]}>
            <Text style={{ color: on ? '#fff' : colors.ink }}>{it}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function Dates() {
  const { couple, memories } = useData();
  const [area, setArea] = useState('');
  const [mood, setMood] = useState<string | null>(null);
  const [budget, setBudget] = useState<string | null>(null);
  const [when, setWhen] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [courses, setCourses] = useState<DateCourse[]>([]);

  // Placeholder: the neighbourhood we go to most.
  const usual = useMemo(() => {
    const n = new Map<string, number>();
    memories.forEach(m => { if (m.place) { const a = m.place.split('·')[0].trim(); n.set(a, (n.get(a) ?? 0) + 1); } });
    return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '서울';
  }, [memories]);

  const load = useCallback(async () => {
    const { data } = await supabase.from('date_courses').select('*').order('saved', { ascending: false }).order('created_at', { ascending: false }).limit(20);
    setCourses((data ?? []) as DateCourse[]);
  }, []);
  useEffect(() => { if (couple) load(); }, [couple, load]);

  const ask = async () => {
    setBusy(true); setError(null);
    const { data, error } = await supabase.functions.invoke('recommend', {
      body: { area: area.trim() || undefined, mood: mood ?? undefined, budget: budget ?? undefined, when: when ?? undefined, note: note.trim() || undefined },
    });
    setBusy(false);
    if (error || !data?.id) {
      let msg = '추천을 받지 못했어요. 잠시 후 다시 시도해주세요.';
      try { const body = await (error as { context?: Response })?.context?.json(); if (body?.error && !String(body.error).startsWith('Error')) msg = body.error; } catch { /* keep default */ }
      setError(msg);
      return;
    }
    await load();
    router.push(`/course/${data.id}`);
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={font.h2}>다음 데이트 어디 갈까</Text>
        <Text style={font.small}>
          {memories.length ? `우리 추억 ${memories.length}개를 보고, 좋아했던 것과 비슷하지만 아직 안 가본 곳으로 코스를 짜요.` : '추억이 쌓일수록 우리 취향에 더 맞는 코스가 나와요.'} 실제로 영업 중인 곳을 검색해서 골라요.
        </Text>
        <TextInput style={input} value={area} onChangeText={setArea} placeholder={`지역 (비우면 ${usual})`} placeholderTextColor={colors.sub} />
        <Text style={s.label}>분위기</Text>
        <Chips items={MOODS} value={mood} onChange={setMood} />
        <Text style={s.label}>예산 (둘이 합쳐)</Text>
        <Chips items={BUDGETS} value={budget} onChange={setBudget} />
        <Text style={s.label}>언제</Text>
        <Chips items={WHENS} value={when} onChange={setWhen} />
        <TextInput style={input} value={note} onChangeText={setNote} placeholder="하고 싶은 것 (예: 비 와도 괜찮은 곳)" placeholderTextColor={colors.sub} />
        <Button title={busy ? '장소 찾는 중… (30초쯤 걸려요)' : '코스 추천받기'} onPress={ask} busy={busy} />
        {error && <Text style={[font.small, { color: colors.pin }]}>{error}</Text>}
      </Card>

      {courses.length > 0 && <Text style={[font.small, { marginTop: 4 }]}>지난 추천</Text>}
      {courses.map(c => (
        <Pressable key={c.id} onPress={() => router.push(`/course/${c.id}`)} style={s.row}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={font.h2} numberOfLines={1}>{c.saved ? '★ ' : ''}{c.course.title}</Text>
            <Text style={font.small} numberOfLines={1}>{c.course.stops.map(x => x.name).join(' → ')}</Text>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: '600', color: colors.sub, marginTop: 2 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18, borderWidth: 1, borderColor: colors.line },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  row: { backgroundColor: colors.card, borderRadius: 14, padding: 14 },
});
