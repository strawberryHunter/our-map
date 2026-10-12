// Pure face pipeline math (no React Native imports) so it can be tested in Node.
// Detection: MediaPipe BlazeFace short-range (128x128, 896 anchors).
// Recognition: MobileFaceNet (112x112 -> 192-d embedding), crops aligned to the ArcFace
// landmark template. Tested: same person ~0.8 cosine, different people ~0.

export type RGBAImage = { width: number; height: number; data: Uint8Array };
export type Box = { x: number; y: number; w: number; h: number; score: number; kps: number[] };

const DET = 128;
const REC = 112;

/** Bilinear sample of an RGBA image at (x, y) in pixel coords. Out of bounds reads black. */
function sample(img: RGBAImage, x: number, y: number, out: number[]) {
  const { width: w, height: h, data } = img;
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const fx = x - x0, fy = y - y0;
  out[0] = out[1] = out[2] = 0;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      const px = x0 + dx, py = y0 + dy;
      if (px < 0 || py < 0 || px >= w || py >= h) continue;
      const wgt = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      const i = (py * w + px) * 4;
      out[0] += data[i] * wgt;
      out[1] += data[i + 1] * wgt;
      out[2] += data[i + 2] * wgt;
    }
  }
}

/** Letterbox the image into a 128x128 square, values in [-1, 1]. Returns the tensor and the mapping back. */
export function detectorInput(img: RGBAImage) {
  const scale = Math.max(img.width, img.height) / DET;
  const padX = (DET * scale - img.width) / 2;
  const padY = (DET * scale - img.height) / 2;
  const t = new Float32Array(DET * DET * 3);
  const px = [0, 0, 0];
  for (let y = 0; y < DET; y++) {
    for (let x = 0; x < DET; x++) {
      sample(img, (x + 0.5) * scale - padX - 0.5, (y + 0.5) * scale - padY - 0.5, px);
      const o = (y * DET + x) * 3;
      t[o] = px[0] / 127.5 - 1;
      t[o + 1] = px[1] / 127.5 - 1;
      t[o + 2] = px[2] / 127.5 - 1;
    }
  }
  return { tensor: t, scale, padX, padY };
}

let anchorCache: Float32Array | null = null;
/** SSD anchors for BlazeFace short range: stride 8 (2/cell) + stride 16 (6/cell) = 896. */
export function anchors(): Float32Array {
  if (anchorCache) return anchorCache;
  const a: number[] = [];
  for (const [stride, per] of [[8, 2], [16, 6]] as const) {
    const n = DET / stride;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        for (let k = 0; k < per; k++) a.push((x + 0.5) / n, (y + 0.5) / n);
  }
  anchorCache = new Float32Array(a);
  return anchorCache;
}

function iou(a: Box, b: Box) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/** Decode raw BlazeFace outputs into boxes in original image pixels. */
export function decodeDetections(
  regressors: Float32Array, scores: Float32Array,
  map: { scale: number; padX: number; padY: number },
  minScore = 0.6,
): Box[] {
  const anc = anchors();
  const found: Box[] = [];
  for (let i = 0; i < 896; i++) {
    const s = 1 / (1 + Math.exp(-Math.max(-80, Math.min(80, scores[i]))));
    if (s < minScore) continue;
    const r = i * 16, ax = anc[i * 2] * DET, ay = anc[i * 2 + 1] * DET;
    const cx = ax + regressors[r], cy = ay + regressors[r + 1];
    const w = regressors[r + 2], h = regressors[r + 3];
    const toImg = (vx: number, vy: number) => [vx * map.scale - map.padX, vy * map.scale - map.padY];
    const [x0, y0] = toImg(cx - w / 2, cy - h / 2);
    const kps: number[] = [];
    for (let k = 0; k < 6; k++) kps.push(...toImg(ax + regressors[r + 4 + k * 2], ay + regressors[r + 5 + k * 2]));
    found.push({ x: x0, y: y0, w: w * map.scale, h: h * map.scale, score: s, kps });
  }
  found.sort((a, b) => b.score - a.score);
  const kept: Box[] = [];
  for (const b of found) if (kept.every(k => iou(k, b) < 0.3)) kept.push(b);
  return kept;
}

export function normalize(v: Float32Array | number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, x => x / n);
}

export function cosine(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

export type Person = { id: string; name: string; embeddings: number[][] };

/** Best matching person for an embedding, or null under the threshold. */
export function matchPerson(emb: number[], people: Person[], threshold = 0.5) {
  let best: { person: Person; score: number } | null = null;
  for (const p of people)
    for (const e of p.embeddings) {
      const s = cosine(emb, e);
      if (s >= threshold && (!best || s > best.score)) best = { person: p, score: s };
    }
  return best;
}

// ArcFace 112x112 template: image-left eye, image-right eye, nose tip, mouth center.
const TEMPLATE = [38.29, 51.7, 73.53, 51.5, 56.03, 71.74, 56.14, 92.28];

/** Least-squares similarity transform mapping template -> image points: [a, b, tx, ty] with x' = a x - b y + tx, y' = b x + a y + ty. */
export function similarity(src: number[], dst: number[]) {
  const n = src.length / 2;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[2 * i]; sy += src[2 * i + 1]; dx += dst[2 * i]; dy += dst[2 * i + 1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num1 = 0, num2 = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const x = src[2 * i] - sx, y = src[2 * i + 1] - sy, u = dst[2 * i] - dx, v = dst[2 * i + 1] - dy;
    num1 += x * u + y * v; num2 += x * v - y * u; den += x * x + y * y;
  }
  const a = num1 / den, b = num2 / den;
  return [a, b, dx - a * sx + b * sy, dy - b * sx - a * sy];
}

/** Landmark-aligned 112x112 crop for MobileFaceNet, values (v - 128) / 128. */
export function recognizerInput(img: RGBAImage, box: Box): Float32Array {
  const k = box.kps;
  const pts = [k[0], k[1], k[2], k[3], k[4], k[5], k[6], k[7]];
  const [a, b, tx, ty] = similarity(TEMPLATE, pts);
  const t = new Float32Array(REC * REC * 3);
  const px = [0, 0, 0];
  const mean = 128;
  for (let y = 0; y < REC; y++) {
    for (let x = 0; x < REC; x++) {
      const X = x + 0.5, Y = y + 0.5;
      sample(img, a * X - b * Y + tx - 0.5, b * X + a * Y + ty - 0.5, px);
      const o = (y * REC + x) * 3;
      t[o] = (px[0] - mean) / 128; t[o + 1] = (px[1] - mean) / 128; t[o + 2] = (px[2] - mean) / 128;
    }
  }
  return t;
}
