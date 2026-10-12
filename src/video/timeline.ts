// Plans the memory movie: which shot plays when. Pure, so it is tested in Node and the
// WebView page just plays the plan. Every cut lands on a 120 BPM beat (500 ms), so any
// trending song added later on Instagram/TikTok lines up with the cuts.

import { distanceKm } from '../sync/cluster';

export const BEAT = 500;

export type MovieStop = {
  lat: number | null;
  lng: number | null;
  date: string; // "2026년 10월 3일 (토)"
  stamp: string; // film date stamp "'26 10 03"
  title: string;
  place: string;
  photos: string[]; // image URLs
};

export type Shot =
  | { kind: 'hook'; start: number; dur: number }
  | { kind: 'fly'; start: number; dur: number; stop: number }
  | { kind: 'photo'; start: number; dur: number; stop: number; photo: number; first: boolean }
  | { kind: 'end'; start: number; dur: number };

/** A shot before its start time is known (Omit distributed over the union). */
type ShotInput = Shot extends infer S ? (S extends Shot ? Omit<S, 'start'> : never) : never;

export type Stats = { places: number; days: number; photos: number; km: number };

/** Pacing by number of stops, so a movie stays ~10-55 s however many memories are picked. */
export function pacing(stops: number) {
  if (stops <= 3) return { photos: 3, fly: 3, firstPhoto: 4, nextPhoto: 2 };
  if (stops <= 8) return { photos: 2, fly: 3, firstPhoto: 4, nextPhoto: 2 };
  if (stops <= 15) return { photos: 1, fly: 2, firstPhoto: 3, nextPhoto: 2 };
  return { photos: 1, fly: 1, firstPhoto: 2, nextPhoto: 2 };
}

export function planMovie(stops: MovieStop[]): { shots: Shot[]; total: number } {
  const shots: Shot[] = [];
  let t = 0;
  const add = (s: ShotInput) => { shots.push({ ...s, start: t } as Shot); t += s.dur; };

  add({ kind: 'hook', dur: 4 * BEAT }); // 2 s: best photo + the numbers, visible from frame 1
  const p = pacing(stops.length);
  let last: MovieStop | null = null;
  stops.forEach((s, i) => {
    const placed = s.lat != null && s.lng != null;
    // Fly only between places we know. A stop without GPS cuts straight to its photos.
    // Far flights get extra beats so zooming out and back in stays smooth (Seoul -> Jeju ~3 s).
    if (placed) {
      const km = last ? distanceKm(last.lat!, last.lng!, s.lat!, s.lng!) : 0;
      const extra = km > 150 ? 4 : km > 40 ? 2 : km > 10 ? 1 : 0;
      add({ kind: 'fly', stop: i, dur: ((last ? p.fly : Math.min(2, p.fly)) + extra) * BEAT });
      last = s;
    }
    const n = Math.max(1, Math.min(p.photos, s.photos.length));
    for (let k = 0; k < n; k++) add({ kind: 'photo', stop: i, photo: s.photos.length ? k : -1, first: k === 0, dur: (k === 0 ? p.firstPhoto : p.nextPhoto) * BEAT });
  });
  add({ kind: 'end', dur: 8 * BEAT }); // 4 s: the whole route = "the map we drew"
  return { shots, total: t };
}

export function movieStats(stops: { lat: number | null; lng: number | null; dayKey: string; photoCount: number }[]): Stats {
  const placed = stops.filter(s => s.lat != null && s.lng != null);
  let km = 0;
  for (let i = 1; i < placed.length; i++) km += distanceKm(placed[i - 1].lat!, placed[i - 1].lng!, placed[i].lat!, placed[i].lng!);
  return {
    places: stops.length,
    days: new Set(stops.map(s => s.dayKey)).size,
    photos: stops.reduce((a, s) => a + s.photoCount, 0),
    km: Math.round(km),
  };
}

/** "'26 10 03" in Korea time, like a disposable camera date stamp. */
export function filmStamp(iso: string) {
  const d = new Date(Date.parse(iso) + 9 * 3600e3);
  const p = (n: number) => String(n).padStart(2, '0');
  return `'${String(d.getUTCFullYear()).slice(2)} ${p(d.getUTCMonth() + 1)} ${p(d.getUTCDate())}`;
}

/** "2026-10-03" in Korea time, for counting distinct days. */
export function dayKey(iso: string) {
  return new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 10);
}
