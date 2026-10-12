// Groups photos into outings: a new outing starts after a long time gap or a big move.
// Pure functions so they can be tested in Node.

export type PhotoMeta = {
  id: string;
  time: number; // ms since epoch
  lat: number | null;
  lng: number | null;
};

export type Outing<P extends PhotoMeta = PhotoMeta> = {
  start: number;
  end: number;
  lat: number | null;
  lng: number | null;
  photos: P[];
};

export const GAP_MS = 3 * 60 * 60 * 1000; // 3 hours without photos ends an outing
export const MOVE_KM = 5; // moving farther than this from the outing's center starts a new one

export function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad, dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function center<P extends PhotoMeta>(photos: P[]) {
  const geo = photos.filter(p => p.lat != null && p.lng != null);
  if (!geo.length) return { lat: null, lng: null };
  // Median is robust to one stray GPS fix.
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  return { lat: med(geo.map(p => p.lat!)), lng: med(geo.map(p => p.lng!)) };
}

export function clusterPhotos<P extends PhotoMeta>(input: P[], gapMs = GAP_MS, moveKm = MOVE_KM): Outing<P>[] {
  const photos = [...input].sort((a, b) => a.time - b.time);
  const out: Outing<P>[] = [];
  let cur: P[] = [];
  const flush = () => {
    if (!cur.length) return;
    const c = center(cur);
    out.push({ start: cur[0].time, end: cur[cur.length - 1].time, ...c, photos: cur });
    cur = [];
  };
  for (const p of photos) {
    if (cur.length) {
      const last = cur[cur.length - 1];
      const c = center(cur);
      const moved = p.lat != null && p.lng != null && c.lat != null && c.lng != null &&
        distanceKm(c.lat, c.lng, p.lat, p.lng) > moveKm;
      if (p.time - last.time > gapMs || moved) flush();
    }
    cur.push(p);
  }
  flush();
  return out;
}

/** True when two outings are probably the same date (e.g. photos from both phones). */
export function sameOuting(
  a: { start: number; end: number; lat: number | null; lng: number | null },
  b: { start: number; end: number; lat: number | null; lng: number | null },
) {
  const overlap = a.start - GAP_MS / 2 <= b.end && b.start - GAP_MS / 2 <= a.end;
  if (!overlap) return false;
  if (a.lat == null || b.lat == null || a.lng == null || b.lng == null) return true;
  return distanceKm(a.lat, a.lng, b.lat, b.lng) <= MOVE_KM;
}
