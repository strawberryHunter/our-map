import { Redirect, Tabs } from 'expo-router';
import { useData } from '../../src/lib/data';
import { Text, type ColorValue } from 'react-native';
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
      <Tabs.Screen name="timeline" options={{ title: '타임라인', tabBarIcon: icon('≡') }} />
      <Tabs.Screen name="settings" options={{ title: '설정', tabBarIcon: icon('⚙︎') }} />
    </Tabs>
  );
}
