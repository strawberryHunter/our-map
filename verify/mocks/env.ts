// Shared fake world for the sync test: a gallery per phone, one fake Supabase, a controllable clock.
export type FakeAsset = {
  id: string;
  time: number | null;
  lat: number | null;
  lng: number | null;
  faces: string[]; // person ids visible in the photo
  broken?: boolean; // getInfo() throws (e.g. iCloud-only original)
};

export const world = {
  gallery: [] as FakeAsset[],
  permission: true,
  storage: new Map<string, string>(), // AsyncStorage
  tables: { memories: [] as any[], photos: [] as any[] } as Record<string, any[]>,
  files: new Set<string>(), // storage object paths
  summarizeCalls: [] as any[],
  failUploadAfter: Infinity, // simulate network failure after N uploads
  uploads: 0,
  storyFails: false,
};

export function resetWorld() {
  world.gallery = [];
  world.permission = true;
  world.storage.clear();
  world.tables = { memories: [], photos: [] };
  world.files.clear();
  world.summarizeCalls = [];
  world.failUploadAfter = Infinity;
  world.uploads = 0;
  world.storyFails = false;
}
