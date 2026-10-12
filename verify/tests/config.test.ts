// Native config the app will actually ship with (expo config --type introspect):
// every permission we use is declared with a Korean reason, and nothing we don't use is requested.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { before, test } from 'node:test';

let cfg: any;
let androidPerms: string[] = [];

before(() => {
  const out = execFileSync('npx', ['expo', 'config', '--type', 'introspect', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 300_000 });
  cfg = JSON.parse(out);
  const manifest = JSON.stringify(cfg._internal?.modResults?.android?.manifest ?? cfg.android);
  const blocked = new Set<string>(cfg.android.blockedPermissions ?? []);
  androidPerms = [...new Set(manifest.match(/android\.permission\.[A-Z_]+/g) ?? [])].filter(p => !blocked.has(p));
});

const hangul = /[가-힣]/;

test('iOS: photo read + save reasons are present and in Korean', () => {
  const p = cfg.ios.infoPlist;
  for (const k of ['NSPhotoLibraryUsageDescription', 'NSPhotoLibraryAddUsageDescription']) {
    assert.ok(hangul.test(p[k] ?? ''), `${k} = ${p[k]}`);
  }
});

test('iOS: no permissions the app does not use (camera, mic, Face ID, location)', () => {
  const unused = ['NSCameraUsageDescription', 'NSMicrophoneUsageDescription', 'NSFaceIDUsageDescription', 'NSLocationWhenInUseUsageDescription', 'NSLocationAlwaysAndWhenInUseUsageDescription'];
  const present = unused.filter(k => k in cfg.ios.infoPlist);
  assert.deepEqual(present, []);
});

test('Android: can read photos and their GPS location', () => {
  for (const p of ['android.permission.READ_MEDIA_IMAGES', 'android.permission.ACCESS_MEDIA_LOCATION']) assert.ok(androidPerms.includes(p), p);
});

test('Android: no microphone or overlay permission', () => {
  assert.deepEqual(androidPerms.filter(p => /RECORD_AUDIO|CAMERA|SYSTEM_ALERT_WINDOW|ACCESS_FINE_LOCATION/.test(p)), []);
});

test('bundle ids are set for both stores', () => {
  assert.match(cfg.ios.bundleIdentifier, /^[a-z0-9.]+$/);
  assert.equal(cfg.android.package, cfg.ios.bundleIdentifier);
});

test('OTA updates: on, tied to our Expo project, and only for builds with the same native code', () => {
  assert.equal(cfg.updates?.url, `https://u.expo.dev/${cfg.extra?.eas?.projectId}`);
  assert.ok(cfg.extra?.eas?.projectId, 'extra.eas.projectId');
  // fingerprint: a JS update never lands on an APK whose native modules differ (would crash)
  assert.deepEqual(cfg.runtimeVersion, { policy: 'fingerprint' });
});
