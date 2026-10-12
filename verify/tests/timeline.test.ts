// Movie plan (src/video/timeline.ts): hook first, beat-aligned cuts, sensible length.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BEAT, dayKey, filmStamp, movieStats, planMovie, type MovieStop } from '../../src/video/timeline';

const stop = (lat: number | null, photos = 3): MovieStop => ({ lat, lng: lat == null ? null : 127, date: 'd', stamp: "'26 10 03", title: 't', place: 'p', photos: Array.from({ length: photos }, (_, i) => `u${i}`) });

test('opens with the hook (numbers + best photo) and ends with the route', () => {
  const { shots } = planMovie([stop(37.5), stop(37.6)]);
  assert.equal(shots[0].kind, 'hook');
  assert.equal(shots[0].start, 0);
  assert.ok(shots[0].dur <= 2000, 'hook is short: the point is made in the first 2 s');
  assert.equal(shots.at(-1)!.kind, 'end');
});

test('every cut lands on a 120 BPM beat', () => {
  const { shots, total } = planMovie([stop(37.5), stop(null, 1), stop(37.6, 2), stop(33.4, 5)]);
  for (const s of shots) assert.equal(s.start % BEAT, 0, `${s.kind} starts at ${s.start}`);
  assert.equal(total % BEAT, 0);
});

test('shots are back to back with no gaps or overlaps', () => {
  const { shots, total } = planMovie([stop(37.5), stop(37.6)]);
  for (let i = 1; i < shots.length; i++) assert.equal(shots[i].start, shots[i - 1].start + shots[i - 1].dur);
  assert.equal(total, shots.at(-1)!.start + shots.at(-1)!.dur);
});

test('a stop without GPS gets photos but no flight', () => {
  const { shots } = planMovie([stop(37.5), stop(null)]);
  assert.ok(!shots.some(s => s.kind === 'fly' && s.stop === 1));
  assert.ok(shots.some(s => s.kind === 'photo' && s.stop === 1));
});

test('a stop whose photos failed to load still shows its title card', () => {
  const { shots } = planMovie([stop(37.5, 0)]);
  const p = shots.filter(s => s.kind === 'photo');
  assert.equal(p.length, 1);
  assert.equal(p[0].kind === 'photo' && p[0].photo, -1);
});

test('length stays watchable: 1 trip ~8-20 s, 10/30 memories under 60 s', () => {
  const one = planMovie([stop(37.5)]).total;
  assert.ok(one >= 8000 && one <= 20000, `${one} ms`);
  for (const n of [10, 15, 16, 30]) {
    const len = planMovie(Array.from({ length: n }, (_, i) => stop(37 + i * 0.01))).total;
    assert.ok(len <= 60000, `${n} memories: ${len} ms`);
  }
});

test('stats: places, distinct days (Korea time), photos, km along the route', () => {
  const s = movieStats([
    { lat: 37.5445, lng: 127.056, dayKey: dayKey('2026-10-03T14:00:00Z'), photoCount: 5 }, // 23:00 KST Oct 3
    { lat: null, lng: null, dayKey: dayKey('2026-10-03T16:00:00Z'), photoCount: 2 }, // 01:00 KST Oct 4
    { lat: 33.4596, lng: 126.3106, dayKey: dayKey('2026-10-05T03:00:00Z'), photoCount: 4 },
  ]);
  assert.equal(s.places, 3);
  assert.equal(s.days, 3);
  assert.equal(s.photos, 11);
  assert.ok(s.km > 440 && s.km < 470, `${s.km} km`);
});

test('film stamp uses Korea date', () => {
  assert.equal(filmStamp('2026-10-03T16:30:00Z'), "'26 10 04");
});
