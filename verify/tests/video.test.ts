// Renders the memory movie (src/video/storyHtml.ts) in headless Chromium the way the app's
// WebView does: fake ReactNativeWebView bridge, real maplibre + map tiles + WebCodecs encoder.
// Checks the file that comes back through the bridge and saves key frames to look at.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { chromium } from 'playwright-core';
import { FPS, cameraFrames } from '../../src/video/camera';
import { storyHtml } from '../../src/video/storyHtml';
import { planMovie, type MovieStop } from '../../src/video/timeline';

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

const stops: MovieStop[] = [
  { lat: 37.5445, lng: 127.056, date: '2026년 8월 15일 (토)', stamp: "'26 08 15", title: '성수동 빵지순례', place: '성수동 카페거리', photos: [dataUrl('group.jpg'), dataUrl('obama.jpg')] },
  { lat: null, lng: null, date: '2026년 8월 30일 (일)', stamp: "'26 08 30", title: '비 오는 날 영화', place: '', photos: [dataUrl('obama2.jpg')] }, // no GPS
  { lat: 37.5113, lng: 127.098, date: '2026년 9월 6일 (토)', stamp: "'26 09 06", title: '롯데월드 야간개장', place: '잠실 롯데월드', photos: [dataUrl('biden.jpg')] },
  { lat: 33.4596, lng: 126.3106, date: '2026년 10월 3일 (토)', stamp: "'26 10 03", title: '협재 바다', place: '제주 협재해변', photos: [] }, // photos failed to load
];

test('memory movie: renders frame by frame, comes back through the bridge, plays as planned', { skip: exe ? false : 'no headless Chromium (npx playwright-core install chromium-headless-shell)', timeout: 600_000 }, async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const plan = planMovie(stops);
  const frames = cameraFrames(stops, plan.shots, plan.total);
  const html = storyHtml({ range: '2026.08 – 2026.10', hero: dataUrl('group.jpg'), stats: { places: 4, days: 4, photos: 23, km: 452 }, stops, ...plan, frames });

  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  const browser = await chromium.launch({ executablePath: exe!, proxy: proxy ? { server: proxy } : undefined, args: ['--ignore-certificate-errors', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 360, height: 640 }, ignoreHTTPSErrors: true });
    const msgs: any[] = [];
    const errors: string[] = [];
    let b64 = '';
    page.on('pageerror', e => errors.push(String(e)));
    await page.exposeFunction('__bridge', (s: string) => {
      const m = JSON.parse(s);
      if (m.type === 'chunk') b64 += m.data; else msgs.push(m);
    });
    // A string, not a function: tsx would inject helpers that do not exist in the page.
    await page.addInitScript('window.ReactNativeWebView = { postMessage: function (s) { window.__bridge(s); } };');
    // Same origin the app gives the WebView (source.baseUrl); WebCodecs needs a secure origin.
    await page.route('https://localhost/', r => r.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://localhost/');

    const deadline = Date.now() + 580_000;
    while (!msgs.some(m => m.type === 'end' || m.type === 'error') && Date.now() < deadline) await page.waitForTimeout(250);

    const err = msgs.find(m => m.type === 'error');
    assert.equal(err, undefined, `page reported: ${err?.text}`);
    assert.deepEqual(errors, [], 'no uncaught page errors');
    const begin = msgs.find(m => m.type === 'begin');
    assert.ok(begin, `never finished; last status: ${msgs.filter(m => m.type === 'status').map(m => m.text).at(-1)}`);
    assert.match(begin.mode, /^offline-/, 'frame-by-frame encoder used (no dropped frames)');
    assert.deepEqual(msgs.filter(m => m.type === 'shot').map(m => m.index), plan.shots.map((_, i) => i), 'every planned shot played, in order');
    assert.ok(msgs.some(m => m.type === 'progress'), 'progress reported for the progress bar');

    const bytes = Buffer.from(b64, 'base64');
    assert.equal(bytes.length, begin.size, 'all chunks arrived, nothing lost in the bridge');
    const file = path.join(OUT, `video.${begin.ext}`);
    fs.writeFileSync(file, bytes);

    if (hasTool('ffprobe')) {
      const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames,codec_name', '-of', 'json', file]).toString());
      const s = probe.streams[0];
      fs.writeFileSync(path.join(OUT, 'video-probe.json'), JSON.stringify({ ...s, mode: begin.mode }, null, 2));
      assert.equal(`${s.width}x${s.height}`, '1080x1920', '9:16 for Reels/Shorts/Stories');
      assert.equal(Number(s.nb_read_frames), frames.length, `every frame encoded (${FPS} fps, ${plan.total / 1000} s)`);

      // Key frames to look at, cut from the actual video.
      const at = (k: string, stop: number | null, into: number) => {
        const sh = plan.shots.find(x => x.kind === k && (stop == null || ('stop' in x && x.stop === stop)))!;
        return (sh.start + into) / 1000;
      };
      const shots: [string, number][] = [
        ['hook', at('hook', null, 700)], ['fly-seoul', at('fly', 0, 800)], ['photo-1', at('photo', 0, 1200)],
        ['photo-no-gps', at('photo', 1, 800)], ['fly-jeju-mid', at('fly', 3, 1300)], ['photo-missing', at('photo', 3, 800)],
        ['end', plan.total / 1000 - 0.3],
      ];
      for (const [name, sec] of shots) {
        execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', sec.toFixed(3), '-i', file, '-frames:v', '1', '-vf', 'scale=360:-1', path.join(OUT, `movie-${name}.png`)]);
      }
      execFileSync('ffmpeg', ['-v', 'error', '-y', ...shots.flatMap(([n]) => ['-i', path.join(OUT, `movie-${n}.png`)]), '-filter_complex', `hstack=${shots.length}`, path.join(OUT, 'movie-contact-sheet.png')]);
    }
  } finally {
    await browser.close();
  }
});
