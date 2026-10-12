// OpenStreetMap Nominatim lookups (free; max 1 request/second; needs a User-Agent).
const UA = { "User-Agent": "ours-couple-app/1.0", "Accept-Language": "ko" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let last = 0;
async function politeFetch(url: string) {
  const wait = last + 1100 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  return fetch(url, { headers: UA });
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  try {
    const r = await politeFetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&lat=${lat}&lon=${lng}`);
    if (!r.ok) return null;
    const j = await r.json();
    const a = j.address ?? {};
    const area = [a.city ?? a.province ?? a.state, a.borough ?? a.city_district ?? a.suburb, a.quarter ?? a.neighbourhood]
      .filter(Boolean).join(" ");
    const name = j.name && j.name !== a.road ? j.name : "";
    return [area, name].filter(Boolean).join(" · ") || j.display_name || null;
  } catch {
    return null;
  }
}

/** Address or place name -> coordinates, limited to Korea. */
export async function geocode(query: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const r = await politeFetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=kr&q=${encodeURIComponent(query)}`);
    if (!r.ok) return null;
    const [hit] = await r.json();
    return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  } catch {
    return null;
  }
}
