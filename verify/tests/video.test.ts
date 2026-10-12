// Runs the map-video page (src/video/storyHtml.ts) in headless Chromium the way the app's
// WebView does: fake ReactNativeWebView bridge, real maplibre + map tiles + MediaRecorder.
// Checks that a playable video comes back through the bridge and saves a frame to look at.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { storyHtml } from '../../src/video/storyHtml';

const OUT = path.join(process.cwd(), 'verify/out');
const FIX = path.join(process.cwd(), 'verify/fixtures/faces');
const dataUrl = (f: string) => `data:image/jpeg;base64,${fs.readFileSync(path.join(FIX, f)).toString('base64')}`;
const hasTool = (t: string) => { try { execFileSync(t, ['-version'], { stdio: 'ignore' }); return true; } catch { return false; } };

function findChromium() {
  for (const base of [process.env.PLAYWRIGHT_BROWSERS_PATH, '/opt/pw-browsers', path.join(process.env.HOME ?? '', '.cache/ms-playwright')]) {
    if (!base || !fs.existsSync(base)) continue;
    for (const d of fs.readdirSync(base).filter(d => d.startsWith('chromium_headless_shell')).sort().reverse()) {
      const exe = path.join(base, d, 'chrome-linux', 'headless_shell');
      if (fs.existsSync(exe)) return exe;
    }
  }
  return null;
}
const exe = findChromium();

test('map video: records, streams back through the bridge, and is playable', { skip: exe ? false : 'no headless Chromium (npx playwright-core install chromium-headless-shell)', timeout: 180_000 }, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const html = storyHtml({
    title: '우리 지도',
    subtitle: '2026.08 – 2026.10',
    stops: [
      { lat: 37.5445, lng: 127.056, date: '2026년 8월 15일 (토)', title: '성수동 카페 투어', place: '성수동 카페거리', summary: '빵이 맛있는 집을 세 군데 돌았다. 마지막 집 크루아상이 제일 나았다.', photos: [dataUrl('group.jpg'), dataUrl('obama.jpg')] },
      { lat: 37.5113, lng: 127.098, date: '2026년 9월 6일 (토)', title: '롯데월드 야간개장', place: '잠실 롯데월드', summary: '줄이 짧아서 자이로드롭을 두 번 탔다.', photos: [dataUrl('biden.jpg')] },
      { lat: 33.4596, lng: 126.3106, date: '2026년 10월 3일 (토)', title: '협재 바다', place: '제주 협재해변', summary: '바람이 세게 불었는데 물 색이 정말 예뻤다. 해 질 때까지 앉아 있었다.', photos: [] },
    ],
  });

  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe!, proxy: proxy ? { server: proxy } : undefined, args: ['--ignore-certificate-errors', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 488 }, ignoreHTTPSErrors: true });
    const msgs: any[] = [];
    const errors: string[] = [];
    let b64 = '';
    let frameShot: Buffer | null = null;
    let shots = 0;
    page.on('pageerror', e => errors.push(String(e)));
    await page.exposeFunction('__bridge', (s: string) => {
      const m = JSON.parse(s);
      if (m.type === 'chunk') b64 += m.data; else msgs.push(m);
    });
    // A string, not a function: tsx would inject helpers that do not exist in the page.
    await page.addInitScript('window.ReactNativeWebView = { postMessage: function (s) { window.__bridge(s); } };');
    // Same origin the app gives the WebView (source.baseUrl).
    await page.route('https://localhost/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://localhost/');

    const deadline = Date.now() + 170_000;
    while (!msgs.some(m => m.type === 'end' || m.type === 'error') && Date.now() < deadline) {
      const stop = msgs.filter(m => m.type === 'status' && /^\d+ \//.test(String(m.text))).length;
      if (stop > shots) {
        shots = stop;
        await page.waitForTimeout(4200); // fly in + card on screen
        frameShot = await page.locator('#out').screenshot();
        fs.writeFileSync(path.join(OUT, `video-stop${stop}.png`), frameShot);
      }
      await page.waitForTimeout(250);
    }
    const err = msgs.find(m => m.type === 'error');
    assert.equal(err, undefined, `page reported: ${err?.text}`);
    assert.deepEqual(errors, [], 'no uncaught page errors');
    const begin = msgs.find(m => m.type === 'begin');
    assert.ok(begin, `recording never finished; statuses: ${msgs.filter(m => m.type === 'status').map(m => m.text).join(' | ')}`);
    const bytes = Buffer.from(b64, 'base64');
    assert.equal(bytes.length, begin.size, 'all chunks arrived, nothing lost in the bridge');
    assert.ok(bytes.length > 50_000, `video is ${bytes.length} bytes`);
    const file = path.join(OUT, `video.${begin.ext}`);
    fs.writeFileSync(file, bytes);

    if (hasTool('ffprobe')) {
      // MediaRecorder webm has no duration header; count decoded frames instead.
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames,r_frame_rate', '-of', 'json', file]).toString());
      const s = probe.streams[0];
      assert.equal(`${s.width}x${s.height}`, '1080x1350', '4:5 portrait at 1080 wide');
      assert.ok(Number(s.nb_read_frames) > 300, `only ${s.nb_read_frames} frames decoded`);
      fs.writeFileSync(path.join(OUT, 'video-probe.json'), JSON.stringify(s, null, 2));
    }
  } finally {
    await browser.close();
  }
});
