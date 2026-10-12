import { Redirect } from 'expo-router';
import { ActivityIndicator, Text, View } from 'react-native';
import { useData } from '../src/lib/data';
import { supabaseConfigured } from '../src/lib/supabase';
import { colors, font } from '../src/ui/theme';

export default function Index() {
  const { ready, session, couple } = useData();
  if (!supabaseConfigured) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.paper }}>
        <Text style={font.title}>설정이 필요해요</Text>
        <Text style={[font.body, { marginTop: 8 }]}>.env 파일에 EXPO_PUBLIC_SUPABASE_URL과 EXPO_PUBLIC_SUPABASE_ANON_KEY를 넣고 다시 실행해주세요.</Text>
      </View>
    );
  }
  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.paper }}><ActivityIndicator /></View>;
  if (!session) return <Redirect href="/login" />;
  if (!couple) return <Redirect href="/pair" />;
  return <Redirect href="/(tabs)/map" />;
}
