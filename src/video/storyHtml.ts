// HTML that runs inside a WebView and renders the memory movie.
// It plays a plan made in TypeScript (timeline.ts = which shot when, camera.ts = map camera per
// frame) on a 1080x1920 canvas: map underneath, polaroid photos with film date stamps on top,
// grain over everything.
//
// Rendering is frame by frame: each frame waits until the map is fully drawn, then goes to the
// hardware encoder (WebCodecs) with an exact timestamp. Slow phones take longer to render but the
// video is never choppy and never shows half-loaded map tiles. Phones without WebCodecs fall back
// to real-time recording (MediaRecorder).

import type { Frame } from './camera';
import type { MovieStop, Shot, Stats } from './timeline';

export type MovieInput = {
  range: string; // "2026.08 – 2026.10"
  hero: string | null; // best photo of both of us
  stats: Stats;
  stops: MovieStop[];
  shots: Shot[];
  total: number;
  frames: Frame[];
};

export function storyHtml(input: MovieInput) {
  const data = JSON.stringify(input).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Nanum+Pen+Script&display=block">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script src="https://unpkg.com/mp4-muxer@5.2.2/build/mp4-muxer.js"></script>
<style>
  html,body{margin:0;background:#15171c;overflow:hidden}
  #map{position:absolute;left:0;top:0;width:540px;height:960px}
  #out{position:absolute;left:0;top:0;width:100vw;height:auto}
</style></head><body>
<div id="map"></div><canvas id="out" width="1080" height="1920"></canvas>
<script>
const D = ${data};
const W = 1080, H = 1920, FPS = 30;
const SANS = '"Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif';
const PEN = '"Nanum Pen Script",' + SANS;
const STAMP = '"Courier New",monospace';
const post = (o) => window.ReactNativeWebView.postMessage(JSON.stringify(o));
const out = document.getElementById('out'), ctx = out.getContext('2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const easeOut = (t) => 1 - Math.pow(1 - clamp(t), 3);

const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
  center: [127.5, 36.3], zoom: 6, interactive: false, attributionControl: false,
  preserveDrawingBuffer: true, pixelRatio: 2, fadeDuration: 0,
});
const loadImage = (url) => new Promise(res => {
  if (!url) return res(null);
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => res(im); im.onerror = () => res(null); im.src = url;
});

// ---- film look ----
const grain = document.createElement('canvas'); grain.width = grain.height = 256;
{ const g = grain.getContext('2d'), id = g.createImageData(256, 256);
  for (let i = 0; i < id.data.length; i += 4) { const v = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 22; }
  g.putImageData(id, 0, 0); }
const grainPattern = ctx.createPattern(grain, 'repeat');
function film(frame) {
  ctx.save();
  ctx.translate(-((frame * 37) % 256), -((frame * 59) % 256));
  ctx.fillStyle = grainPattern; ctx.fillRect(0, 0, W + 256, H + 256);
  ctx.restore();
  const v = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.35)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
}
function stamp(text, x, y, size) {
  ctx.save(); ctx.font = 'bold ' + size + 'px ' + STAMP; ctx.textAlign = 'right';
  ctx.shadowColor = 'rgba(255,120,30,.9)'; ctx.shadowBlur = size * 0.4;
  ctx.fillStyle = '#FF9A3C'; ctx.fillText(text, x, y); ctx.restore();
}
function cover(img, x, y, w, h, zoom) {
  // Crop toward the upper part of tall photos, where faces usually are.
  const s = Math.max(w / img.width, h / img.height) * (zoom || 1), sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * 0.15, sw, sh, x, y, w, h);
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function fit(text, maxW) {
  let s = text || '';
  while (s.length > 1 && ctx.measureText(s).width > maxW) s = s.slice(0, -1);
  return s.length < (text || '').length ? s.slice(0, -1) + '…' : s;
}

// ---- shots (canvas side) ----
let imgs = [], hero = null;
function drawHook(t) {
  const z = 1 + 0.05 * t / 2000;
  if (hero && hero.width / hero.height < 0.8) cover(hero, 0, 0, W, H, z);
  else if (hero) {
    // Landscape/square photo: cropping it to 9:16 would cut people off the sides.
    // Show all of it over a blurred, darkened copy of itself.
    ctx.save(); ctx.filter = 'blur(40px) brightness(0.6)'; cover(hero, -60, -60, W + 120, H + 120, 1); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.fillRect(0, 0, W, H);
    const h = (W * hero.height) / hero.width;
    ctx.save(); ctx.translate(W / 2, 640); ctx.scale(z, z); ctx.drawImage(hero, -W / 2, -h / 2, W, h); ctx.restore();
  } else { ctx.fillStyle = '#15171c'; ctx.fillRect(0, 0, W, H); }
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.78)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const s = D.stats; ctx.fillStyle = '#fff';
  ctx.font = '800 150px ' + SANS; ctx.fillText(s.places + '곳', 72, H - 420);
  ctx.font = '800 84px ' + SANS; ctx.fillText(s.days + '일 · 사진 ' + s.photos + '장', 72, H - 300);
  ctx.font = '500 44px ' + SANS; ctx.globalAlpha = .85;
  ctx.fillText(D.range + (s.km ? '  ·  ' + s.km.toLocaleString() + 'km' : ''), 72, H - 210); ctx.globalAlpha = 1;
  ctx.font = '700 36px ' + SANS; ctx.globalAlpha = .7; ctx.fillText('OURS', 72, 140); ctx.globalAlpha = 1;
}
function drawFly(sh, t) {
  const s = D.stops[sh.stop];
  ctx.save(); ctx.globalAlpha = easeOut(t / 300);
  ctx.fillStyle = 'rgba(21,23,28,.82)'; roundRect(56, 110, 600, 124, 26); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '700 46px ' + SANS; ctx.fillText(fit(s.place || s.title, 520), 92, 170);
  stamp(s.stamp, 626, 214, 34); ctx.restore();
}
function drawPhoto(sh, t, idx) {
  const s = D.stops[sh.stop], img = sh.photo >= 0 ? imgs[sh.stop][sh.photo] : null;
  ctx.fillStyle = 'rgba(21,23,28,.22)'; ctx.fillRect(0, 0, W, H);
  const pop = easeOut(t / 180);
  const fw = 820, ph = img ? 900 : 0, fh = ph + (sh.first ? 250 : 120) + 36;
  ctx.save();
  ctx.translate(W / 2, 1210); ctx.rotate((idx % 2 ? 1 : -1) * 0.04); ctx.scale(0.92 + 0.08 * pop, 0.92 + 0.08 * pop);
  ctx.globalAlpha = pop;
  ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#FBFAF7'; ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
  ctx.shadowColor = 'transparent';
  const top = -fh / 2 + 36;
  if (img) {
    ctx.save(); ctx.beginPath(); ctx.rect(-fw / 2 + 36, top, fw - 72, ph); ctx.clip();
    cover(img, -fw / 2 + 36, top, fw - 72, ph, 1 + 0.04 * t / sh.dur);
    ctx.restore();
    stamp(s.stamp, fw / 2 - 64, top + ph - 36, 46);
  }
  ctx.fillStyle = '#2A2A2A';
  if (sh.first) {
    ctx.font = '88px ' + PEN; ctx.fillText(fit(s.title || s.place, fw - 100), -fw / 2 + 50, top + ph + 105);
    ctx.font = '500 34px ' + SANS; ctx.fillStyle = '#7A7A7A';
    ctx.fillText(s.date + (s.place && s.title ? '  ·  ' + s.place : ''), -fw / 2 + 52, top + ph + 175);
  } else {
    ctx.font = '62px ' + PEN; ctx.fillText(fit(s.place || s.title, fw - 100), -fw / 2 + 50, top + ph + 74);
  }
  ctx.restore();
}
function drawEnd(t) {
  ctx.save(); ctx.globalAlpha = easeOut((t - 600) / 500);
  ctx.fillStyle = 'rgba(251,250,247,.92)'; roundRect(56, 100, W - 112, 260, 36); ctx.fill();
  ctx.fillStyle = '#1D2230'; ctx.font = '96px ' + PEN; ctx.fillText('우리가 그린 지도', 100, 222);
  ctx.font = '600 40px ' + SANS; ctx.fillStyle = '#5E6676';
  ctx.fillText(D.stats.places + '곳' + (D.stats.km ? ' · ' + D.stats.km.toLocaleString() + 'km' : '') + ' · ' + D.range, 104, 302);
  ctx.font = '800 40px ' + SANS; ctx.fillStyle = 'rgba(29,34,48,.75)'; ctx.textAlign = 'center'; ctx.fillText('OURS', W / 2, H - 110);
  ctx.restore();
}

// ---- map side: apply the precomputed camera/route for a frame ----
const placedCoords = D.stops.filter(x => x.lat != null).map(x => [x.lng, x.lat]);
let routeKey = '';
function applyFrame(f) {
  const [lng, lat, zoom, pt, pb, arrived, plng, plat] = f;
  map.jumpTo({ center: [lng, lat], zoom, padding: { top: pt, bottom: pb, left: 0, right: 0 } });
  const key = arrived + ':' + (plng == null ? '' : plng.toFixed(5) + ',' + plat.toFixed(5));
  if (key !== routeKey) {
    routeKey = key;
    const done = placedCoords.slice(0, arrived);
    map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: plng == null ? done : [...done, [plng, plat]] } });
    map.getSource('pins').setData({ type: 'FeatureCollection', features: done.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } })) });
  }
}
/** Resolves once the map has drawn everything for the current camera (or after 4 s if tiles stall). */
function settle() {
  return new Promise(r => { const to = setTimeout(r, 4000); map.once('idle', () => { clearTimeout(to); r(); }); map.triggerRepaint(); });
}
let shotIndex = -1, photoIdx = 0;
function drawAt(t) {
  let i = shotIndex; while (i + 1 < D.shots.length && D.shots[i + 1].start <= t) i++;
  if (i !== shotIndex) {
    shotIndex = i; const sh = D.shots[i];
    if (sh.kind === 'photo') photoIdx++;
    if (sh.kind === 'end') map.setPaintProperty('route', 'line-width', 9);
    post({ type: 'shot', index: i, kind: sh.kind, stop: sh.stop ?? null, at: Math.round(t) });
  }
  const sh = D.shots[shotIndex], local = t - sh.start;
  if (sh.kind === 'hook') drawHook(local);
  else {
    ctx.drawImage(map.getCanvas(), 0, 0, W, H);
    if (sh.kind === 'fly') drawFly(sh, local);
    else if (sh.kind === 'photo') drawPhoto(sh, local, photoIdx);
    else drawEnd(local);
  }
}

async function pickEncoder() {
  if (typeof VideoEncoder === 'undefined' || typeof Mp4Muxer === 'undefined') return null;
  for (const [codec, mux] of [['avc1.640028', 'avc'], ['avc1.4d0028', 'avc'], ['vp09.00.40.08', 'vp9']]) {
    const config = { codec, width: W, height: H, bitrate: 8_000_000, framerate: FPS, latencyMode: 'quality' };
    if (mux === 'avc') config.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(config)).supported) return { config, mux }; } catch (e) {}
  }
  return null;
}

async function renderOffline(enc) {
  const muxer = new Mp4Muxer.Muxer({ target: new Mp4Muxer.ArrayBufferTarget(), video: { codec: enc.mux, width: W, height: H, frameRate: FPS }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let failed = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: e => { failed = e; } });
  encoder.configure(enc.config);
  const N = D.frames.length;
  for (let f = 0; f < N; f++) {
    if (failed) throw failed;
    const t = (f * 1000) / FPS;
    let i = shotIndex; while (i + 1 < D.shots.length && D.shots[i + 1].start <= t) i++;
    if (D.shots[i].kind !== 'hook') { applyFrame(D.frames[f]); await settle(); }
    drawAt(t);
    film(f);
    const vf = new VideoFrame(out, { timestamp: Math.round((f * 1e6) / FPS), duration: Math.round(1e6 / FPS) });
    encoder.encode(vf, { keyFrame: f % 60 === 0 });
    vf.close();
    while (encoder.encodeQueueSize > 4) await sleep(4);
    if (f % 15 === 0) post({ type: 'progress', done: f, total: N });
  }
  await encoder.flush();
  muxer.finalize();
  return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), ext: 'mp4', mode: 'offline-' + enc.mux };
}

async function renderRealtime() {
  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(out.captureStream(FPS), { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => rec.onstop = r);
  const t0 = performance.now(); let frame = 0;
  rec.start(1000);
  await new Promise(done => {
    (function loop() {
      const t = performance.now() - t0;
      if (t >= D.total) return done();
      const f = Math.min(D.frames.length - 1, Math.floor((t * FPS) / 1000));
      applyFrame(D.frames[f]);
      drawAt(t); film(frame++);
      if (frame % 15 === 0) post({ type: 'progress', done: f, total: D.frames.length });
      requestAnimationFrame(loop);
    })();
  });
  rec.stop(); await stopped;
  return { blob: new Blob(chunks, { type: mime || 'video/webm' }), ext: (mime || 'video/webm').includes('mp4') ? 'mp4' : 'webm', mode: 'realtime' };
}

async function run() {
  await new Promise(r => map.on('load', r));
  post({ type: 'status', text: '사진 불러오는 중' });
  [hero, imgs] = await Promise.all([loadImage(D.hero), Promise.all(D.stops.map(s => Promise.all(s.photos.map(loadImage))))]);
  imgs = imgs.map(list => list.filter(Boolean));
  try { await document.fonts.load('88px "Nanum Pen Script"'); } catch (e) {}

  map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#E2574C', 'line-width': 6 }, layout: { 'line-cap': 'round', 'line-join': 'round' } });
  map.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'pins', type: 'circle', source: 'pins', paint: { 'circle-radius': 11, 'circle-color': '#E2574C', 'circle-stroke-color': '#fff', 'circle-stroke-width': 4 } });
  applyFrame(D.frames[0]);
  await settle();

  const enc = await pickEncoder();
  post({ type: 'status', text: enc ? '영상 만드는 중' : '영상 녹화 중 (화면을 켜두세요)' });
  const result = enc ? await renderOffline(enc) : await renderRealtime();

  post({ type: 'status', text: '영상 저장 중' });
  const blob = result.blob;
  const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  const CH = 512 * 1024;
  post({ type: 'begin', ext: result.ext, size: blob.size, mode: result.mode });
  for (let i = 0; i < b64.length; i += CH) { post({ type: 'chunk', data: b64.slice(i, i + CH) }); await sleep(10); }
  post({ type: 'end' });
}
run().catch(e => post({ type: 'error', text: String(e && e.message || e) }));
</script></body></html>`;
}
