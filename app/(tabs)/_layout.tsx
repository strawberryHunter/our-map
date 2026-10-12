import { Redirect, Tabs, router } from 'expo-router';
import { useData } from '../../src/lib/data';
import { Pressable, Text, type ColorValue } from 'react-native';
import { colors } from '../../src/ui/theme';

const icon = (glyph: string) => ({ color }: { color: ColorValue }) => <Text style={{ color, fontSize: 18 }}>{glyph}</Text>;

export default function TabsLayout() {
  const { ready, session } = useData();
  if (ready && !session) return <Redirect href="/login" />;
  return (
    <Tabs
      screenOptions={{
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.paper },
        headerTitleStyle: { color: colors.ink, fontWeight: '700' },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.sub,
        sceneStyle: { backgroundColor: colors.paper },
      }}
    >
      <Tabs.Screen name="map" options={{ title: '지도', headerShown: false, tabBarIcon: icon('◉') }} />
      <Tabs.Screen name="timeline" options={{ title: '추억', tabBarIcon: icon('≡'), headerRight: () => (
        <Pressable onPress={() => router.push('/import')} style={{ paddingHorizontal: 16 }}>
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '600' }}>＋ 사진으로 만들기</Text>
        </Pressable>
      ) }} />
      <Tabs.Screen name="dates" options={{ title: '데이트', tabBarIcon: icon('♡') }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('⚙︎') }} />
    </Tabs>
  );
}
