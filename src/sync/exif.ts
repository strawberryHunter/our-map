// Reads when/where a photo was taken from the EXIF dict expo-image-picker returns.
// iOS nests it ({GPS}, {Exif}); Android is flat and writes GPS as rationals ("37/1,32/1,4000/100").
// Pure so it can be tested in Node.

export type ExifInfo = { time: number | null; lat: number | null; lng: number | null; timeEstimated: boolean };

type Dict = Record<string, unknown>;

function pick(exif: Dict, ...keys: string[]): unknown {
  const pools: Dict[] = [exif, (exif['{GPS}'] as Dict) ?? {}, (exif['{Exif}'] as Dict) ?? {}, (exif['{TIFF}'] as Dict) ?? {}];
  for (const k of keys) for (const p of pools) if (p[k] != null && p[k] !== '') return p[k];
  return undefined;
}

function rational(v: string): number {
  const [n, d] = v.split('/').map(Number);
  return d ? n / d : n;
}

/** Degrees from a number, "37.5", "37/1,32/1,4000/100", "37,32,40.0" or [37, 32, 40]. */
export function parseCoord(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let parts: number[];
  if (Array.isArray(v)) parts = v.map(Number);
  else if (typeof v === 'string') parts = v.split(/[,\s]+/).filter(Boolean).map(rational);
  else return null;
  if (!parts.length || parts.some(x => !Number.isFinite(x))) return null;
  const [d, m = 0, s = 0] = parts;
  return d + m / 60 + s / 3600;
}

function signed(value: number | null, ref: unknown, negative: string) {
  if (value == null) return null;
  return typeof ref === 'string' && ref.trim().toUpperCase().startsWith(negative) ? -Math.abs(value) : value;
}

/** "+09:00" / "-0500" -> minutes east of UTC. */
function offsetMinutes(v: unknown): number | null {
  if (typeof v !== 'string') return null;
  const m = v.trim().match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!m) return null;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * @param fallbackOffsetMin offset to assume when the photo has no OffsetTimeOriginal
 *   (most messenger-forwarded and older photos). Usually the phone's current offset.
 */
export function readExif(exif: Dict | null | undefined, fallbackOffsetMin: number): ExifInfo {
  if (!exif) return { time: null, lat: null, lng: null, timeEstimated: false };

  let lat = signed(parseCoord(pick(exif, 'GPSLatitude', 'Latitude')), pick(exif, 'GPSLatitudeRef', 'LatitudeRef'), 'S');
  let lng = signed(parseCoord(pick(exif, 'GPSLongitude', 'Longitude')), pick(exif, 'GPSLongitudeRef', 'LongitudeRef'), 'W');
  // 0,0 is what some apps write when they have no fix.
  if (lat == null || lng == null || (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    lat = lng = null;
  }

  let time: number | null = null;
  let timeEstimated = false;
  const raw = pick(exif, 'DateTimeOriginal', 'DateTimeDigitized', 'DateTime');
  const m = typeof raw === 'string' ? raw.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})/) : null;
  if (m && m[1] !== '0000') {
    const local = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
    const off = offsetMinutes(pick(exif, 'OffsetTimeOriginal', 'OffsetTime'));
    timeEstimated = off == null;
    time = local - (off ?? fallbackOffsetMin) * 60_000;
  }
  return { time, lat, lng, timeEstimated };
}
