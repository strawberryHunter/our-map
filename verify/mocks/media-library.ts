import { world, type FakeAsset } from './env';

export enum MediaType { IMAGE = 'image', VIDEO = 'video' }
export enum AssetField { CREATION_TIME = 'creationTime', MEDIA_TYPE = 'mediaType' }

export class Asset {
  private a: FakeAsset | undefined;
  constructor(public id: string, a?: FakeAsset) { this.a = a ?? world.gallery.find(g => g.id === id); }
  async getInfo() {
    if (!this.a) throw new Error('asset not in gallery');
    if (this.a.broken) throw new Error('asset unavailable');
    return { id: this.id, uri: `ph://${this.id}`, width: 4032, height: 3024, creationTime: this.a.time, mediaType: 'image' };
  }
  async getCreationTime() { if (!this.a) throw new Error('asset not in gallery'); return this.a.time; }
  async getLocation() { return this.a?.lat == null ? null : { latitude: this.a.lat, longitude: this.a.lng! }; }
}

export class Query {
  private gtTime = -Infinity;
  private max = Infinity;
  private asc = true;
  eq() { return this; }
  gt(field: string, v: number) { if (field === AssetField.CREATION_TIME) this.gtTime = v; return this; }
  orderBy(d: { ascending?: boolean }) { this.asc = d.ascending ?? true; return this; }
  limit(n: number) { this.max = n; return this; }
  async exe() {
    // Like the real query: photos without a creation time never match a time filter.
    return world.gallery
      .filter(a => a.time != null && a.time > this.gtTime)
      .sort((x, y) => (this.asc ? 1 : -1) * (x.time! - y.time!))
      .slice(0, this.max)
      .map(a => new Asset(a.id, a));
  }
}

export async function getPermissionsAsync() { return { granted: world.permission }; }
export async function requestPermissionsAsync() { return { granted: world.permission }; }
