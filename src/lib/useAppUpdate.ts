// Checks for a new JS update once at launch and, if there is one, downloads it and restarts
// the app so fixes arrive without reinstalling the APK. Native changes still need a new APK
// (runtimeVersion "fingerprint" keeps a JS update off builds whose native code differs).
import * as Updates from 'expo-updates';
import { useEffect } from 'react';

export function useAppUpdate() {
  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;
    (async () => {
      try {
        const check = await Updates.checkForUpdateAsync();
        if (!check.isAvailable) return;
        const got = await Updates.fetchUpdateAsync();
        if (got.isNew) await Updates.reloadAsync();
      } catch (e) {
        // Offline or Expo unreachable: keep running the version we have.
        console.warn('update check failed', e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);
}
