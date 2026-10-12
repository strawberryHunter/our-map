import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { authErrorMessage, checkCredentials, MIN_PASSWORD, type AuthMode } from '../src/lib/auth';
import { supabase } from '../src/lib/supabase';
import { Button } from '../src/ui/kit';
import { colors, font } from '../src/ui/theme';
import { input } from '../src/ui/styles';

export default function Login() {
  const [mode, setMode] = useState<AuthMode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const bad = checkCredentials(email, password, mode, confirm);
    if (bad) { setError(bad); return; }
    setBusy(true); setError(null);
    const creds = { email: email.trim(), password };
    const { data, error } = mode === 'signup'
      ? await supabase.auth.signUp(creds)
      : await supabase.auth.signInWithPassword(creds);
    setBusy(false);
    if (error) { console.warn('auth failed', error.code ?? error.status); setError(authErrorMessage(error)); return; }
    if (!data.session) { setError('가입은 됐지만 로그인하지 못했어요. 로그인 탭에서 다시 시도해주세요.'); return; }
    router.replace('/');
  };

  const signup = mode === 'signup';
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.paper }}>
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 14 }}>
        <Text style={[font.title, { fontSize: 34, letterSpacing: 2 }]}>OURS</Text>
        <Text style={font.body}>둘이 함께한 날을 사진으로 찾아 모으고, 이야기와 영화로 남기는 둘만의 앱이에요.</Text>
        <TextInput
          style={input} placeholder="이메일" autoCapitalize="none" autoComplete="email" keyboardType="email-address"
          value={email} onChangeText={setEmail} placeholderTextColor={colors.sub}
        />
        <TextInput
          style={input} placeholder={signup ? `비밀번호 (${MIN_PASSWORD}자 이상)` : '비밀번호'} secureTextEntry autoCapitalize="none"
          autoComplete={signup ? 'new-password' : 'current-password'}
          value={password} onChangeText={setPassword} placeholderTextColor={colors.sub}
        />
        {signup && (
          <TextInput
            style={input} placeholder="비밀번호 확인" secureTextEntry autoCapitalize="none" autoComplete="new-password"
            value={confirm} onChangeText={setConfirm} placeholderTextColor={colors.sub}
          />
        )}
        {error && <Text style={[font.small, { color: colors.pin }]}>{error}</Text>}
        <Button title={signup ? '가입하고 시작하기' : '로그인'} onPress={submit} busy={busy} disabled={!email || !password} />
        <Pressable onPress={() => { setMode(signup ? 'signin' : 'signup'); setError(null); }} hitSlop={8}>
          <Text style={[font.small, { color: colors.sub, textAlign: 'center' }]}>
            {signup ? '이미 계정이 있어요 · 로그인' : '처음이에요 · 가입하기'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
