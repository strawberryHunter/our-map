import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { DataProvider } from '../src/lib/data';
import { SyncProvider } from '../src/sync/useSync';
import { colors } from '../src/ui/theme';

export default function RootLayout() {
  return (
    <DataProvider>
      <SyncProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerShadowVisible: false,
            headerStyle: { backgroundColor: colors.paper },
            headerTintColor: colors.ink,
            contentStyle: { backgroundColor: colors.paper },
            headerBackButtonDisplayMode: 'minimal',
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ title: '', headerShown: false }} />
          <Stack.Screen name="pair" options={{ title: '' }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="memory/[id]" options={{ title: '' }} />
          <Stack.Screen name="memory/place" options={{ title: '장소 정하기' }} />
          <Stack.Screen name="import" options={{ title: '사진 골라서 추억 만들기', presentation: 'modal' }} />
          <Stack.Screen name="course/[id]" options={{ title: '데이트 코스' }} />
          <Stack.Screen name="video" options={{ title: '추억 영화' }} />
        </Stack>
      </SyncProvider>
    </DataProvider>
  );
}
