import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { embeddingForRegistration } from '../../src/face/native';
import { useData } from '../../src/lib/data';
import { supabase } from '../../src/lib/supabase';
import { SYNC_START_KEY, getSyncStart } from '../../src/sync/sync';
import { useSync } from '../../src/sync/useSync';
import { Button, Card } from '../../src/ui/kit';
import { input } from '../../src/ui/styles';
import { colors, font, personColors } from '../../src/ui/theme';

const RANGES = [
  { label: '최근 1개월', days: 30 },
  { label: '최근 6개월', days: 182 },
  { label: '최근 1년', days: 365 },
  { label: '최근 3년', days: 1095 },
];

export default function Settings() {
  const { session, couple, members, people, reload } = useData();
  const { sync, running } = useSync();
  const [newName, setNewName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [start, setStart] = useState<number | null>(null);

  useEffect(() => { getSyncStart().then(setStart); }, []);

  const addFaces = async (personId: string | null) => {
    const name = personId ? people.find(p => p.id === personId)?.name : newName.trim();
    if (!name || !couple) return;
    const pick = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5 });
    if (pick.canceled) return;
    setBusyId(personId ?? 'new'); setMsg(null);
    const found: number[][] = [];
    for (const a of pick.assets) {
      const e = await embeddingForRegistration(a.uri, a.width, a.height).catch(() => null);
      if (e) found.push(e);
    }
    if (!found.length) {
      setBusyId(null);
      setMsg('얼굴을 찾지 못했어요. 얼굴이 크게, 정면으로 나온 사진을 골라주세요.');
      return;
    }
    if (personId) {
      const cur = people.find(p => p.id === personId)!;
      await supabase.from('people').update({ embeddings: [...cur.embeddings, ...found].slice(-12) }).eq('id', personId);
    } else {
      await supabase.from('people').insert({ couple_id: couple.id, name, embeddings: found });
      setNewName('');
    }
    setBusyId(null);
    setMsg(`${name}: 사진 ${found.length}장에서 얼굴을 등록했어요.`);
    await reload();
  };

  const setRange = async (days: number) => {
    const t = Date.now() - days * 24 * 3600 * 1000;
    await AsyncStorage.setItem(SYNC_START_KEY, String(t));
    if (session) await AsyncStorage.removeItem(`lastSync:${session.user.id}`);
    setStart(t);
    setMsg('기간을 바꿨어요. 이 기간의 사진을 다시 훑어봐요 (이미 올린 사진은 건너뜀).');
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
      <Card>
        <Text style={font.h2}>얼굴 등록</Text>
        <Text style={font.small}>사람마다 얼굴이 잘 보이는 사진 3~5장을 고르면 정확도가 올라가요. 얼굴 정보는 숫자로만 저장되고, 사진 분석은 폰 안에서 해요.</Text>
        {people.map((p, i) => (
          <View key={p.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={{ color: personColors[i % 2], fontSize: 18 }}>●</Text>
            <Text style={[font.body, { flex: 1 }]}>{p.name} <Text style={font.small}>· 사진 {p.embeddings.length}장</Text></Text>
            <Button title="사진 추가" kind="ghost" style={{ minHeight: 36 }} busy={busyId === p.id} onPress={() => addFaces(p.id)} />
          </View>
        ))}
        {people.length < 2 && (
          <View style={{ gap: 8 }}>
            <TextInput style={input} placeholder={people.length ? '상대 이름' : '이름 (예: MJ)'} value={newName} onChangeText={setNewName} placeholderTextColor={colors.sub} />
            <Button title="사진 골라서 등록" busy={busyId === 'new'} disabled={!newName.trim()} onPress={() => addFaces(null)} />
          </View>
        )}
        {msg && <Text style={[font.small, { color: colors.route }]}>{msg}</Text>}
      </Card>

      <Card>
        <Text style={font.h2}>어디서부터 정리할까요</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {RANGES.map(r => {
            const on = start != null && Math.abs(Date.now() - r.days * 864e5 - start) < 2 * 864e5;
            return (
              <Pressable key={r.days} onPress={() => setRange(r.days)}
                style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: on ? colors.ink : colors.line, backgroundColor: on ? colors.ink : 'transparent' }}>
                <Text style={{ color: on ? '#fff' : colors.ink }}>{r.label}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={font.small}>앱을 열 때마다 이후에 찍은 사진을 자동으로 정리해요. 한 번에 400장씩 처리해요.</Text>
        <Button title="지금 정리하기" onPress={sync} busy={running} disabled={people.length === 0} />
      </Card>

      <Card>
        <Text style={font.h2}>우리</Text>
        {members.map(m => <Text key={m.user_id} style={font.body}>{m.display_name}{m.user_id === session?.user.id ? ' (나)' : ''}</Text>)}
        {members.length < 2 && couple && (
          <>
            <Text style={font.small}>상대가 앱에서 이 코드를 입력하면 연결돼요.</Text>
            <Pressable onPress={() => Share.share({ message: `우리 지도 초대 코드: ${couple.invite_code}` })}>
              <Text style={{ fontSize: 28, fontWeight: '800', letterSpacing: 4, color: colors.ink }} selectable>{couple.invite_code}</Text>
            </Pressable>
          </>
        )}
      </Card>

      <Button title="로그아웃" kind="ghost" onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
