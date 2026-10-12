// Finds every place the code can send data off the phone and checks it is listed (with what it
// sends) in verify/privacy-allowlist.json. A new upload, API call or URL fails this test until
// someone writes down what it sends. Also writes verify/out/privacy.md as a readable table.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const ROOT = process.cwd();
const DIRS = ['app', 'src', 'supabase/functions'];
const SINK = /fetch\(|\.upload\(|functions\.invoke\(|\.insert\(|\.update\(|\.upsert\(|\.rpc\(|signInWithOtp|verifyOtp|signInWithPassword|signUp\(|checkForUpdateAsync|createSignedUrl|XMLHttpRequest|WebSocket\(|sendBeacon|https?:\/\/[a-zA-Z0-9.:_-]+(\/[a-zA-Z0-9._-]+)*/g;
// SDKs that phone home with device data. None are allowed.
const BANNED_IMPORTS = /from ['"](@sentry|sentry-|@bugsnag|bugsnag|firebase\/analytics|@react-native-firebase\/(analytics|crashlytics)|expo-analytics|amplitude|mixpanel|@segment|posthog|@datadog)/;

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : /\.(ts|tsx|js)$/.test(d.name) ? [p] : [];
  });
}

const files = DIRS.flatMap(d => walk(path.join(ROOT, d))).filter(f => !/\.test\.|\/out\//.test(f));
const allow: { file: string; sink: string; sends: string; to: string }[] = JSON.parse(fs.readFileSync(path.join(ROOT, 'verify/privacy-allowlist.json'), 'utf8')).entries;

test('every network sink in the code is listed with what it sends', () => {
  const found: { file: string; sink: string; line: number }[] = [];
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    fs.readFileSync(f, 'utf8').split('\n').forEach((text, i) => {
      if (/^\s*(\/\/|\*)/.test(text)) return; // comments
      for (const m of text.matchAll(SINK)) found.push({ file: rel, sink: m[0], line: i + 1 });
    });
  }
  const unlisted = found.filter(s => !allow.some(a => a.file === s.file && s.sink.startsWith(a.sink)));
  const stale = allow.filter(a => !found.some(s => a.file === s.file && s.sink.startsWith(a.sink)));

  fs.mkdirSync(path.join(ROOT, 'verify/out'), { recursive: true });
  const rows = allow.filter(a => a.to !== '-').map(a => `| ${a.sends} | ${a.to} | \`${a.file}\` |`);
  fs.writeFileSync(path.join(ROOT, 'verify/out/privacy.md'), ['# What leaves the phone', '', '| Data | Goes to | Code |', '|---|---|---|', ...rows, ''].join('\n'));

  assert.deepEqual(unlisted.map(s => `${s.file}:${s.line} ${s.sink}`), [], 'new network sink: add it to verify/privacy-allowlist.json with what it sends');
  assert.deepEqual(stale.map(a => `${a.file} ${a.sink}`), [], 'allowlist entry no longer in code: remove it');
});

test('no analytics or crash-reporting SDKs', () => {
  const hits = files.filter(f => BANNED_IMPORTS.test(fs.readFileSync(f, 'utf8'))).map(f => path.relative(ROOT, f));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies }).filter(d => /sentry|bugsnag|analytics|crashlytics|amplitude|mixpanel|segment|posthog|datadog/.test(d));
  assert.deepEqual([...hits, ...deps], []);
});

test('no console logging of photo locations or face data', () => {
  const bad: string[] = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((t, i) => {
      if (/console\.(log|info|warn|error)\(.*\b(lat|lng|latitude|longitude|embedding|embeddings|base64)\b/.test(t)) bad.push(`${path.relative(ROOT, f)}:${i + 1}`);
    });
  }
  assert.deepEqual(bad, []);
});
