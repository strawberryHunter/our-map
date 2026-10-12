// Movie camera (src/video/camera.ts): lands on each place, keeps it above the photo cards,
// zooms out between far places, and frames the whole route at the end.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FPS, PIN_PAD, PLACE_ZOOM, VIEW, END_PAD, cameraFrames, project } from '../../src/video/camera';
import { planMovie, type MovieStop } from '../../src/video/timeline';

const st = (lat: number | null, lng: number | null): MovieStop => ({ lat, lng, date: 'd', stamp: 's', title: 't', place: 'p', photos: ['a', 'b'] });
const SEOUL = st(37.5445, 127.056), JAMSIL = st(37.5113, 127.098), JEJU = st(33.4596, 126.3106), NOGPS = st(null, null);
const stops = [SEOUL, NOGPS, JAMSIL, JEJU];
const plan = planMovie(stops);
const frames = cameraFrames(stops, plan.shots, plan.total);
const frameAt = (ms: number) => frames[Math.min(frames.length - 1, Math.round((ms * FPS) / 1000))];

test('one camera frame per video frame', () => {
  assert.equal(frames.length, Math.round((plan.total * FPS) / 1000));
});

test('after each flight the place sits at the pin spot, above the photo card', () => {
  for (const s of plan.shots) {
    if (s.kind !== 'photo' || stops[s.stop].lat == null) continue;
    const f = frameAt(s.start + s.dur / 2);
    const p = project(f, stops[s.stop].lng!, stops[s.stop].lat!);
    assert.ok(Math.abs(p.x - VIEW.w / 2) < 1 && Math.abs(p.y - (VIEW.h - PIN_PAD.bottom) / 2) < 1, `stop ${s.stop} at ${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    assert.equal(f[2], PLACE_ZOOM);
  }
});

test('a stop without GPS keeps the camera on the last known place', () => {
  const s = plan.shots.find(x => x.kind === 'photo' && x.stop === 1)!;
  const f = frameAt(s.start + 100);
  const p = project(f, SEOUL.lng!, SEOUL.lat!);
  assert.ok(Math.abs(p.y - 225) < 1);
});

test('flying Seoul -> Jeju zooms out on the way, short hops stay close', () => {
  const toJeju = plan.shots.find(x => x.kind === 'fly' && x.stop === 3)!;
  const mid = frameAt(toJeju.start + toJeju.dur * 0.45);
  assert.ok(mid[2] < 9, `zoom mid-flight ${mid[2].toFixed(2)}`);
  const toJamsil = plan.shots.find(x => x.kind === 'fly' && x.stop === 2)!;
  assert.ok(frameAt(toJamsil.start + toJamsil.dur * 0.45)[2] > 11);
});

test('camera moves smoothly: no jumps between frames', () => {
  for (let k = 1; k < frames.length; k++) {
    const [a, b] = [frames[k - 1], frames[k]];
    assert.ok(Math.abs(b[2] - a[2]) < 0.6, `zoom jump at frame ${k}: ${a[2]} -> ${b[2]}`);
  }
});

test('route grows one place at a time and is complete at the end', () => {
  let prev = 0;
  for (const f of frames) { assert.ok(f[5] >= prev && f[5] - prev <= 1); prev = f[5]; }
  assert.equal(frames.at(-1)![5], 3);
});

test('ending frames every place inside the box under the title', () => {
  const f = frames.at(-1)!;
  for (const s of [SEOUL, JAMSIL, JEJU]) {
    const p = project(f, s.lng!, s.lat!);
    assert.ok(p.x >= END_PAD.side - 1 && p.x <= VIEW.w - END_PAD.side + 1, `x ${p.x}`);
    assert.ok(p.y >= END_PAD.top - 1 && p.y <= VIEW.h - END_PAD.bottom + 1, `y ${p.y}`);
  }
});

test('a movie with no GPS at all still has a still map behind it', () => {
  const p2 = planMovie([NOGPS, NOGPS]);
  const fr = cameraFrames([NOGPS, NOGPS], p2.shots, p2.total);
  assert.ok(fr.every(f => f[2] === 6 && f[5] === 0));
});
