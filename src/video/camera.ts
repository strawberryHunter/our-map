// Per-frame camera + route for the memory movie. Pure, tested in Node; the WebView only applies it.
// Map viewport is 540x960 CSS px (rendered at 2x into the 1080x1920 video).

import type { MovieStop, Shot } from './timeline';

export const FPS = 30;
export const VIEW = { w: 540, h: 960 };
export const PLACE_ZOOM = 13.2;
/** Padding that puts the current place at y=225 CSS (450 video px), above the photo cards. */
export const PIN_PAD = { top: 0, bottom: 510 };
/** Ending: whole route inside the box under the title panel. */
export const END_PAD = { top: 190, bottom: 70, side: 20 };

/** [lng, lat, zoom, padTop, padBottom, arrived, partialLng, partialLat] */
export type Frame = [number, number, number, number, number, number, number | null, number | null];

const TILE = 512;
const mx = (lng: number) => (lng + 180) / 360;
const my = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) / Math.PI) / 2;
const lngOf = (x: number) => x * 360 - 180;
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Zoom at which a mercator span fits in w x h CSS px. */
function fitZoom(dx: number, dy: number, w: number, h: number) {
  const zx = dx > 0 ? Math.log2(w / (dx * TILE)) : 22;
  const zy = dy > 0 ? Math.log2(h / (dy * TILE)) : 22;
  return Math.min(zx, zy);
}

/** Pixel position (CSS, in the 540x960 view) of a point for a camera. Used by tests. */
export function project(f: Frame, lng: number, lat: number) {
  const [clng, clat, z, pt, pb] = f;
  const scale = TILE * Math.pow(2, z);
  const cy = pt + (VIEW.h - pt - pb) / 2;
  return { x: VIEW.w / 2 + (mx(lng) - mx(clng)) * scale, y: cy + (my(lat) - my(clat)) * scale };
}

export function cameraFrames(stops: MovieStop[], shots: Shot[], total: number): Frame[] {
  const placed = stops.map((s, i) => ({ i, x: s.lng == null ? NaN : mx(s.lng), y: s.lat == null ? NaN : my(s.lat) })).filter(p => !Number.isNaN(p.x));
  const n = Math.round((total * FPS) / 1000);
  const frames: Frame[] = [];
  if (!placed.length) {
    // Nothing to fly to: keep a still view of Korea; the movie is photos only.
    for (let k = 0; k < n; k++) frames.push([127.8, 36.2, 6, PIN_PAD.top, PIN_PAD.bottom, 0, null, null]);
    return frames;
  }

  // Ending camera: fit every place in the box under the title.
  const xs = placed.map(p => p.x), ys = placed.map(p => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const endZoom = Math.min(PLACE_ZOOM, fitZoom(x1 - x0, y1 - y0, VIEW.w - 2 * END_PAD.side, VIEW.h - END_PAD.top - END_PAD.bottom) - 0.15);
  const endCam = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, z: endZoom };

  const order = new Map(placed.map((p, k) => [p.i, k])); // stop index -> position in route
  for (let k = 0; k < n; k++) {
    const t = (k * 1000) / FPS;
    const si = shots.findIndex(s => t >= s.start && t < s.start + s.dur);
    const shot = shots[si === -1 ? shots.length - 1 : si];
    const local = clamp01((t - shot.start) / shot.dur);

    // How far along the route we are: places reached before this shot.
    let arrived = 0;
    for (let j = 0; j < shots.length && shots[j].start + shots[j].dur <= t; j++) {
      const s = shots[j];
      if (s.kind === 'fly') arrived = order.get(s.stop)! + 1;
    }
    const at = placed[Math.max(0, arrived - 1)];

    if (shot.kind === 'fly') {
      const to = placed[order.get(shot.stop)!];
      const from = arrived > 0 ? placed[arrived - 1] : null;
      const e = easeInOut(clamp01(local / 0.9));
      if (!from) {
        // First place: zoom in from the region.
        frames.push([lngOf(to.x), latOf(to.y), lerp(9, PLACE_ZOOM, e), PIN_PAD.top, PIN_PAD.bottom, arrived, null, null]);
      } else {
        // Zoom out just enough to see both ends, then back in.
        const mid = Math.min(PLACE_ZOOM, fitZoom(Math.abs(to.x - from.x), Math.abs(to.y - from.y), VIEW.w * 0.8, (VIEW.h - PIN_PAD.bottom) * 0.8));
        const z = PLACE_ZOOM - (PLACE_ZOOM - mid) * Math.sin(Math.PI * e);
        const cx = lerp(from.x, to.x, e), cy = lerp(from.y, to.y, e);
        frames.push([lngOf(cx), latOf(cy), z, PIN_PAD.top, PIN_PAD.bottom, arrived, lngOf(cx), latOf(cy)]);
      }
    } else if (shot.kind === 'end') {
      const last = placed[placed.length - 1];
      const e = easeInOut(clamp01((t - shot.start) / 1600));
      frames.push([
        lngOf(lerp(last.x, endCam.x, e)), latOf(lerp(last.y, endCam.y, e)), lerp(PLACE_ZOOM, endCam.z, e),
        lerp(PIN_PAD.top, END_PAD.top, e), lerp(PIN_PAD.bottom, END_PAD.bottom, e), placed.length, null, null,
      ]);
    } else {
      // hook / photos: hold on the last place reached (or the first place, before any flight).
      const p = arrived > 0 ? at : placed[0];
      frames.push([lngOf(p.x), latOf(p.y), arrived > 0 ? PLACE_ZOOM : 9, PIN_PAD.top, PIN_PAD.bottom, arrived, null, null]);
    }
  }
  return frames;
}
