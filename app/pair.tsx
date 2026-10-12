import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, TextInput } from 'react-native';
import { useData } from '../src/lib/data';
import { supabase } from '../src/lib/supabase';
import { Button, Card } from '../src/ui/kit';
import { input } from '../src/ui/styles';
import { colors, font } from '../src/ui/theme';

export default function Pair() {
  const { reload } = useData();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const done = async () => { await reload(); router.replace('/'); };
  const create = async () => {
    setBusy('create'); setError(null);
    const { error } = await supabase.rpc('create_couple', { name: name.trim() });
    setBusy(null);
    if (error) setError(error.message); else done();
  };
  const join = async () => {
    setBusy('join'); setError(null);
    const { error } = await supabase.rpc('join_couple', { code: code.trim(), name: name.trim() });
    setBusy(null);
    if (error) setError(error.message.includes('invalid') ? '코드를 찾을 수 없어요.' : error.message); else done();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} style={{ backgroundColor: colors.paper }}>
      <Text style={font.title}>둘을 연결해요</Text>
      <TextInput style={input} placeholder="내 이름 (예: MJ)" value={name} onChangeText={setName} placeholderTextColor={colors.sub} />
      <Card>
        <Text style={font.h2}>처음이라면</Text>
        <Text style={font.small}>우리 공간을 만들고, 설정 화면의 초대 코드를 상대에게 보내주세요.</Text>
        <Button title="우리 공간 만들기" onPress={create} busy={busy === 'create'} disabled={!name.trim()} />
      </Card>
      <Card>
        <Text style={font.h2}>코드를 받았다면</Text>
        <TextInput style={input} placeholder="초대 코드 6자리" autoCapitalize="characters" value={code} onChangeText={setCode} placeholderTextColor={colors.sub} />
        <Button title="참여하기" kind="ghost" onPress={join} busy={busy === 'join'} disabled={!name.trim() || code.trim().length < 6} />
      </Card>
      {error && <Text style={[font.small, { color: colors.pin }]}>{error}</Text>}
    </ScrollView>
  );
}
