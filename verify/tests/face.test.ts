// Face pipeline (src/face/core.ts) with the real TFLite models the app ships.
// Models run through Python's LiteRT interpreter; the pre/post-processing is the app's own TypeScript.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import jpeg from 'jpeg-js';
import * as core from '../../src/face/core';

const ROOT = process.cwd(); // run from the repo root (npm run verify)
const MODELS = path.join(ROOT, 'assets/models');
const FIX = path.join(ROOT, 'verify/fixtures/faces');
const tmp = path.join(os.tmpdir(), `face-${process.pid}.bin`);

const hasLiteRT = (() => {
  try { execFileSync('python3', ['-c', 'import ai_edge_litert, numpy'], { stdio: 'ignore' }); return true; } catch { return false; }
})();
const real = { skip: hasLiteRT ? false : 'pip install ai-edge-litert numpy to run model tests' };

function run(model: string, tensor: Float32Array, shape: string) {
  fs.writeFileSync(tmp, Buffer.from(tensor.buffer));
  execFileSync('python3', [path.join(ROOT, 'verify/run_model.py'), path.join(MODELS, model), tmp, shape], { stdio: ['ignore', 'ignore', 'inherit'] });
  const outs: Float32Array[] = [];
  for (let k = 0; fs.existsSync(`${tmp}.out${k}`); k++) {
    const b = fs.readFileSync(`${tmp}.out${k}`); fs.unlinkSync(`${tmp}.out${k}`);
    outs.push(new Float32Array(b.buffer, b.byteOffset, b.length / 4));
  }
  return outs;
}

const cache = new Map<string, { boxes: core.Box[]; embs: number[][] }>();
function analyze(name: string) {
  if (cache.has(name)) return cache.get(name)!;
  const raw = jpeg.decode(fs.readFileSync(path.join(FIX, name)), { useTArray: true, formatAsRGBA: true });
  const img = { width: raw.width, height: raw.height, data: raw.data as Uint8Array };
  const d = core.detectorInput(img);
  const outs = run('blaze_face_short_range.tflite', d.tensor, '1,128,128,3');
  const boxes = core.decodeDetections(outs.find(o => o.length === 896 * 16)!, outs.find(o => o.length === 896)!, d);
  const embs = boxes.map(b => core.normalize(run('mobilefacenet.tflite', core.recognizerInput(img, b), '1,112,112,3')[0]));
  const r = { boxes, embs };
  cache.set(name, r);
  return r;
}

test('anchors: 896, all inside the unit square', () => {
  const a = core.anchors();
  assert.equal(a.length, 896 * 2);
  assert.ok(Array.from(a).every(v => v > 0 && v < 1));
});

test('similarity transform recovers a known rotation + scale + shift', () => {
  const ang = 0.3, sc = 2.5, tx = 40, ty = -12;
  const src = [10, 10, 50, 12, 30, 40, 31, 60];
  const dst: number[] = [];
  for (let i = 0; i < src.length; i += 2) {
    const [x, y] = [src[i], src[i + 1]];
    dst.push(sc * Math.cos(ang) * x - sc * Math.sin(ang) * y + tx, sc * Math.sin(ang) * x + sc * Math.cos(ang) * y + ty);
  }
  const [a, b, ox, oy] = core.similarity(src, dst);
  assert.ok(Math.abs(a - sc * Math.cos(ang)) < 1e-9 && Math.abs(b - sc * Math.sin(ang)) < 1e-9);
  assert.ok(Math.abs(ox - tx) < 1e-9 && Math.abs(oy - ty) < 1e-9);
});

test('matchPerson: picks the best person above threshold, null below', () => {
  const v = (x: number, y: number) => core.normalize([x, y]);
  const people = [{ id: 'a', name: 'A', embeddings: [v(1, 0)] }, { id: 'b', name: 'B', embeddings: [v(0, 1)] }];
  assert.equal(core.matchPerson(v(1, 0.2), people)?.person.id, 'a');
  assert.equal(core.matchPerson(v(1, 1.05), people)?.person.id, 'b');
  assert.equal(core.matchPerson(v(-1, -1), people), null);
});

test('detects exactly one face in single portraits', real, () => {
  for (const n of ['obama.jpg', 'obama2.jpg', 'biden.jpg', 'lena.jpg']) assert.equal(analyze(n).boxes.length, 1, n);
});

test('detects both people in a two-person photo', real, () => {
  assert.equal(analyze('group.jpg').boxes.length, 2);
});

test('same person in different photos matches (cosine > 0.6)', real, () => {
  const s = core.cosine(analyze('obama.jpg').embs[0], analyze('obama2.jpg').embs[0]);
  assert.ok(s > 0.6, `obama vs obama2 = ${s.toFixed(3)}`);
});

test('different people do not match (cosine < 0.3)', real, () => {
  for (const [a, b] of [['obama.jpg', 'biden.jpg'], ['obama.jpg', 'lena.jpg'], ['biden.jpg', 'lena.jpg']]) {
    const s = core.cosine(analyze(a).embs[0], analyze(b).embs[0]);
    assert.ok(s < 0.3, `${a} vs ${b} = ${s.toFixed(3)}`);
  }
});

test('registered couple is tagged correctly in a photo of both', real, () => {
  const people = [
    { id: 'o', name: 'Obama', embeddings: [analyze('obama.jpg').embs[0]] },
    { id: 'b', name: 'Biden', embeddings: [analyze('biden.jpg').embs[0]] },
  ];
  const { boxes, embs } = analyze('group.jpg');
  const tags = embs.map((e, i) => ({ x: boxes[i].x, who: core.matchPerson(e, people)?.person.id ?? '?' })).sort((p, q) => p.x - q.x);
  assert.deepEqual(tags.map(t => t.who), ['o', 'b']);
});

test('strangers are not tagged as either of us', real, () => {
  const people = [
    { id: 'o', name: 'Obama', embeddings: [analyze('obama.jpg').embs[0]] },
    { id: 'b', name: 'Biden', embeddings: [analyze('biden.jpg').embs[0]] },
  ];
  assert.equal(core.matchPerson(analyze('lena.jpg').embs[0], people), null);
});
