import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { supabase } from '../src/lib/supabase';
import { Button } from '../src/ui/kit';
import { colors, font } from '../src/ui/theme';
import { input } from '../src/ui/styles';

export default function Login() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.signInWithOtp({ email: email.trim() });
    setBusy(false);
    if (error) setError(error.message); else setSent(true);
  };
  const verify = async () => {
    setBusy(true); setError(null);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    setBusy(false);
    if (error) setError('코드가 맞지 않아요. 메일의 6자리 숫자를 다시 확인해주세요.');
    else router.replace('/');
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 14 }}>
        <Text style={[font.title, { fontSize: 34, letterSpacing: 2 }]}>OURS</Text>
        <Text style={font.body}>둘이 함께한 날을 사진으로 찾아 모으고, 이야기와 영화로 남기는 둘만의 앱이에요.</Text>
        <TextInput
          style={input} placeholder="이메일" autoCapitalize="none" keyboardType="email-address"
          value={email} onChangeText={setEmail} editable={!sent} placeholderTextColor={colors.sub}
        />
        {sent && (
          <TextInput
            style={input} placeholder="메일로 받은 6자리 코드" keyboardType="number-pad"
            value={code} onChangeText={setCode} placeholderTextColor={colors.sub} autoFocus
          />
        )}
        {error && <Text style={[font.small, { color: colors.pin }]}>{error}</Text>}
        {sent
          ? <Button title="로그인" onPress={verify} busy={busy} disabled={code.trim().length < 6} />
          : <Button title="로그인 코드 받기" onPress={send} busy={busy} disabled={!email.includes('@')} />}
      </View>
    </KeyboardAvoidingView>
  );
}
