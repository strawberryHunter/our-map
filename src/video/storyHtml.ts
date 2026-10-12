// HTML that runs inside a WebView: flies a map from memory to memory, draws photo cards
// on top, records the canvas with MediaRecorder and streams the file back to React Native.

export type StoryStop = {
  lat: number;
  lng: number;
  date: string; // already formatted, e.g. "2026년 10월 3일 (토)"
  title: string;
  place: string;
  summary: string;
  photos: string[]; // signed https URLs (CORS-enabled)
};

export type StoryInput = { title: string; subtitle: string; stops: StoryStop[] };

export function storyHtml(input: StoryInput) {
  const data = JSON.stringify(input).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css">
<script src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<style>
  html,body{margin:0;background:#1D2230;overflow:hidden}
  #map{position:absolute;left:0;top:0;width:540px;height:675px}
  #out{position:absolute;left:0;top:0;width:100vw;height:auto}
</style></head><body>
<div id="map"></div><canvas id="out" width="1080" height="1350"></canvas>
<script>
const DATA = ${data};
const W = 1080, H = 1350, FPS = 30;
const FONT = '"Apple SD Gothic Neo","Noto Sans KR","Noto Sans CJK KR",sans-serif';
const post = (o) => window.ReactNativeWebView.postMessage(JSON.stringify(o));
const out = document.getElementById('out'), ctx = out.getContext('2d');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const map = new maplibregl.Map({
  container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
  center: [127.5, 36.3], zoom: 6, interactive: false, attributionControl: false,
  preserveDrawingBuffer: true, pixelRatio: 2, fadeDuration: 0,
});

function loadImage(url) {
  return new Promise(res => {
    const im = new Image(); im.crossOrigin = 'anonymous';
    im.onload = () => res(im); im.onerror = () => res(null); im.src = url;
  });
}

// ----- overlay state, drawn every frame on top of the map -----
let overlay = null; // {kind:'title'|'stop'|'end', t0, ...}
let counter = '';

function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function wrap(text, maxW, maxLines) {
  const lines = []; let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxW) { lines.push(line); line = ch; if (lines.length === maxLines) break; }
    else line += ch;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && lines.join('').length < text.length) lines[maxLines - 1] = lines[maxLines - 1].slice(0, -1) + '…';
  return lines;
}
function cover(img, x, y, w, h) {
  // Crop toward the upper part of tall photos, where faces usually are.
  const s = Math.max(w / img.width, h / img.height), sw = w / s, sh = h / s;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) * 0.15, sw, sh, x, y, w, h);
}
const ease = (t) => t < 0 ? 0 : t > 1 ? 1 : 1 - Math.pow(1 - t, 3);

function drawFrame(now) {
  ctx.drawImage(map.getCanvas(), 0, 0, W, H);
  if (counter) {
    ctx.font = '600 30px ' + FONT; ctx.fillStyle = 'rgba(29,34,48,.75)';
    ctx.textAlign = 'right'; ctx.fillText(counter, W - 48, 76); ctx.textAlign = 'left';
  }
  if (!overlay) return;
  const t = (now - overlay.t0) / 1000;
  const fadeIn = ease(t / 0.5), fadeOut = overlay.until ? ease((overlay.until - now) / 500) : 1;
  const a = Math.min(fadeIn, fadeOut);
  ctx.save(); ctx.globalAlpha = a;
  if (overlay.kind === 'title' || overlay.kind === 'end') {
    ctx.fillStyle = 'rgba(29,34,48,.55)'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    ctx.font = '800 92px ' + FONT; ctx.fillText(overlay.title, W / 2, H / 2 - 10);
    ctx.font = '500 38px ' + FONT; ctx.fillText(overlay.sub, W / 2, H / 2 + 60);
    ctx.textAlign = 'left';
  } else if (overlay.kind === 'stop') {
    const s = overlay.stop, imgs = overlay.imgs;
    // Card sits in the lower part so the pin (upper third of the frame) stays visible.
    const cx = 60, cw = W - 120, ph = imgs.length ? 560 : 0, cy = H - 48 - (ph + 300) + (1 - fadeIn) * 60;
    ctx.shadowColor = 'rgba(0,0,0,.25)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
    roundRect(cx, cy, cw, ph + 300, 36); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.save(); roundRect(cx + 20, cy + 20, cw - 40, ph, 24); ctx.clip();
    if (imgs.length) {
      // Cross-fade through the photos, with a slow push-in.
      const per = overlay.dur / imgs.length, i = Math.min(imgs.length - 1, Math.floor(t * 1000 / per));
      const local = (t * 1000 - i * per) / per, z = 1 + local * 0.06;
      const zw = (cw - 40) * z, zh = ph * z;
      cover(imgs[i], cx + 20 - (zw - (cw - 40)) / 2, cy + 20 - (zh - ph) / 2, zw, zh);
      if (i > 0 && local < 0.15) { ctx.globalAlpha = a * (1 - local / 0.15); cover(imgs[i - 1], cx + 20, cy + 20, cw - 40, ph); ctx.globalAlpha = a; }
    }
    ctx.restore();
    let y = cy + ph + (ph ? 78 : 70);
    ctx.fillStyle = '#5E6676'; ctx.font = '500 30px ' + FONT; ctx.fillText(s.date, cx + 44, y);
    ctx.fillStyle = '#E2574C'; ctx.textAlign = 'right'; ctx.fillText(s.place, cx + cw - 44, y); ctx.textAlign = 'left';
    y += 64; ctx.fillStyle = '#1D2230'; ctx.font = '800 50px ' + FONT;
    ctx.fillText(wrap(s.title, cw - 88, 1)[0] || '', cx + 44, y);
    ctx.font = '400 32px ' + FONT; ctx.fillStyle = '#39404F';
    wrap(s.summary, cw - 88, 2).forEach((ln, k) => ctx.fillText(ln, cx + 44, y + 58 + k * 46));
  }
  ctx.restore();
}

let running = true;
(function loop(now) { drawFrame(now); if (running) requestAnimationFrame(loop); })(performance.now());

function flyTo(opts) {
  return new Promise(res => { map.once('moveend', () => res()); map.flyTo({ ...opts, essential: true }); });
}
async function idle() { await new Promise(r => { if (map.loaded() && !map.isMoving()) r(); else map.once('idle', r); }); }
async function show(o, ms) {
  o.t0 = performance.now(); o.dur = ms; overlay = o;
  await sleep(ms - 500); o.until = performance.now() + 500; await sleep(500); overlay = null;
}

async function run() {
  await new Promise(r => map.on('load', r));
  const stops = DATA.stops;
  post({ type: 'status', text: '사진 불러오는 중' });
  const imgs = await Promise.all(stops.map(s => Promise.all(s.photos.slice(0, 3).map(loadImage)).then(a => a.filter(Boolean))));

  // Route line that grows as we travel.
  map.addSource('route', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: [] } } });
  map.addLayer({ id: 'route', type: 'line', source: 'route', paint: { 'line-color': '#2F7A7E', 'line-width': 5, 'line-dasharray': [1.2, 1.2] }, layout: { 'line-cap': 'round' } });
  map.addSource('pins', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'pins', type: 'circle', source: 'pins', paint: { 'circle-radius': 9, 'circle-color': '#E2574C', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });

  const bounds = new maplibregl.LngLatBounds();
  stops.forEach(s => bounds.extend([s.lng, s.lat]));
  map.fitBounds(bounds, { padding: 80, duration: 0, maxZoom: 13 });
  await idle();

  const mime = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const rec = new MediaRecorder(out.captureStream(FPS), { mimeType: mime, videoBitsPerSecond: 6_000_000 });
  const chunks = []; rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  const stopped = new Promise(r => rec.onstop = r);
  rec.start(1000);

  await show({ kind: 'title', title: DATA.title, sub: DATA.subtitle }, 2600);
  const line = [];
  for (let i = 0; i < stops.length; i++) {
    const s = stops[i];
    post({ type: 'status', text: (i + 1) + ' / ' + stops.length + ' · ' + s.title });
    counter = (i + 1) + ' / ' + stops.length;
    const from = line.length ? line[line.length - 1] : null;
    const fly = flyTo({ center: [s.lng, s.lat], zoom: 13.2, duration: i === 0 ? 2200 : 2600, offset: [0, -180] });
    // Draw the route toward the next stop while flying.
    if (from) {
      const t0 = performance.now();
      await new Promise(done => {
        (function step() {
          const k = Math.min(1, (performance.now() - t0) / 2400);
          const pt = [from[0] + (s.lng - from[0]) * k, from[1] + (s.lat - from[1]) * k];
          map.getSource('route').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [...line, pt] } });
          k < 1 ? requestAnimationFrame(step) : done();
        })();
      });
    }
    await fly; await idle();
    line.push([s.lng, s.lat]);
    map.getSource('pins').setData({ type: 'FeatureCollection', features: line.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: c } })) });
    await new Promise(r => map.once('idle', r)); // pin is drawn before the card appears
    await show({ kind: 'stop', stop: s, imgs: imgs[i] }, 3400);
  }
  counter = '';
  await flyTo({ center: bounds.getCenter(), zoom: Math.min(map.cameraForBounds(bounds, { padding: 80 })?.zoom ?? 8, 13), duration: 2400 });
  await show({ kind: 'end', title: '추억 ' + stops.length + '개', sub: DATA.subtitle }, 3000);
  rec.stop(); await stopped; running = false;

  // Stream the file back as base64 in 4-char-aligned chunks.
  post({ type: 'status', text: '영상 저장 중' });
  const blob = new Blob(chunks, { type: mime || 'video/webm' });
  const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  const CH = 512 * 1024;
  post({ type: 'begin', ext: (mime || 'video/webm').includes('mp4') ? 'mp4' : 'webm', size: blob.size });
  for (let i = 0; i < b64.length; i += CH) { post({ type: 'chunk', data: b64.slice(i, i + CH) }); await sleep(10); }
  post({ type: 'end' });
}
run().catch(e => post({ type: 'error', text: String(e && e.message || e) }));
</script></body></html>`;
}
