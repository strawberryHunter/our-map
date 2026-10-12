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

const RECENT_FIXES = 15; // running center uses the median of the last few GPS fixes

export function clusterPhotos<P extends PhotoMeta>(input: P[], gapMs = GAP_MS, moveKm = MOVE_KM): Outing<P>[] {
  const photos = [...input].sort((a, b) => a.time - b.time);
  const out: Outing<P>[] = [];
  let cur: P[] = [];
  let recent: P[] = []; // last few geotagged photos of the current outing
  const flush = () => {
    if (!cur.length) return;
    out.push({ start: cur[0].time, end: cur[cur.length - 1].time, ...center(cur), photos: cur });
    cur = [];
    recent = [];
  };
  const far = (c: { lat: number | null; lng: number | null }, q: P) =>
    q.lat != null && q.lng != null && c.lat != null && c.lng != null && distanceKm(c.lat, c.lng, q.lat, q.lng) > moveKm;

  for (let i = 0; i < photos.length; i++) {
    const p = photos[i];
    if (cur.length) {
      const last = cur[cur.length - 1];
      let split = p.time - last.time > gapMs;
      if (!split) {
        const c = center(recent);
        if (far(c, p)) {
          // A single far fix followed by a fix back near the center is GPS noise, not a move.
          let next: P | undefined;
          for (let j = i + 1; j < photos.length && !next; j++) if (photos[j].lat != null && photos[j].lng != null) next = photos[j];
          const isOutlier = next != null && next.time - p.time <= gapMs && !far(c, next);
          split = !isOutlier;
        }
      }
      if (split) flush();
    }
    cur.push(p);
    if (p.lat != null && p.lng != null) {
      recent.push(p);
      if (recent.length > RECENT_FIXES) recent.shift();
    }
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
