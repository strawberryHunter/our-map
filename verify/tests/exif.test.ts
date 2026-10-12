// Reading time/GPS from picked photos (src/sync/exif.ts), iOS and Android shapes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCoord, readExif } from '../../src/sync/exif';

const KST = 9 * 60;
const near = (a: number | null, b: number) => assert.ok(a != null && Math.abs(a - b) < 1e-5, `${a} vs ${b}`);

test('iOS nested dict with offset', () => {
  const r = readExif({
    '{GPS}': { Latitude: 37.5445, LatitudeRef: 'N', Longitude: 127.056, LongitudeRef: 'E' },
    '{Exif}': { DateTimeOriginal: '2026:10:03 14:22:01', OffsetTimeOriginal: '+09:00' },
  }, 0);
  near(r.lat, 37.5445); near(r.lng, 127.056);
  assert.equal(r.time, Date.parse('2026-10-03T14:22:01+09:00'));
  assert.equal(r.timeEstimated, false);
});

test('Android flat dict with rational GPS', () => {
  const r = readExif({ GPSLatitude: '37/1,32/1,4002/100', GPSLatitudeRef: 'N', GPSLongitude: '127/1,3/1,2160/100', GPSLongitudeRef: 'E', DateTimeOriginal: '2026:10:03 14:22:01' }, KST);
  near(r.lat, 37 + 32 / 60 + 40.02 / 3600);
  near(r.lng, 127 + 3 / 60 + 21.6 / 3600);
  assert.equal(r.time, Date.parse('2026-10-03T14:22:01+09:00'), 'no offset tag: uses the phone offset');
  assert.equal(r.timeEstimated, true);
});

test('southern / western hemispheres', () => {
  const r = readExif({ GPSLatitude: 33.86, GPSLatitudeRef: 'S', GPSLongitude: 151.2, GPSLongitudeRef: 'W' }, 0);
  near(r.lat, -33.86); near(r.lng, -151.2);
});

test('a photo taken abroad keeps its own offset (Paris, +02:00)', () => {
  const r = readExif({ DateTimeOriginal: '2026:06:01 21:00:00', OffsetTimeOriginal: '+02:00' }, KST);
  assert.equal(r.time, Date.parse('2026-06-01T21:00:00+02:00'));
});

test('messenger photo: no GPS, no date', () => {
  assert.deepEqual(readExif({ PixelXDimension: 1080 }, KST), { time: null, lat: null, lng: null, timeEstimated: false });
});

test('0,0 and garbage coordinates are treated as no GPS', () => {
  assert.equal(readExif({ GPSLatitude: 0, GPSLongitude: 0 }, KST).lat, null);
  assert.equal(readExif({ GPSLatitude: 'abc', GPSLongitude: 1 }, KST).lat, null);
  assert.equal(readExif({ GPSLatitude: 95, GPSLongitude: 1 }, KST).lat, null);
});

test('zeroed camera date is ignored', () => {
  assert.equal(readExif({ DateTimeOriginal: '0000:00:00 00:00:00' }, KST).time, null);
});

test('parseCoord accepts the common encodings', () => {
  near(parseCoord('37.5'), 37.5);
  near(parseCoord('37,30,0'), 37.5);
  near(parseCoord([37, 30, 0]), 37.5);
  assert.equal(parseCoord(undefined), null);
});
