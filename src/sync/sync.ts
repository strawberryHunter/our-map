// Turns photos into memories. Two ways in:
//   runSync      - automatic: new gallery photos with one of us in them
//   importPicked - photos we picked ourselves; every one is kept, faces only tag who is in it
// Both group photos into outings (cluster.ts), upload them, and ask the server for the AI story.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { File } from 'expo-file-system';
import { Asset, AssetField, MediaType, Query, getPermissionsAsync, requestPermissionsAsync } from 'expo-media-library';
import { peopleInPhoto } from '../face/native';
import { downscale } from '../lib/image';
import { supabase } from '../lib/supabase';
import type { Memory, PersonRow } from '../lib/types';
import { GAP_MS, clusterPhotos, sameOuting, type Outing, type PhotoMeta } from './cluster';
import { readExif } from './exif';

const MAX_PER_SYNC = 400; // photos scanned per run; the next run continues from there
const MAX_PHOTOS_PER_MEMORY = 12;
const EXTRA_SCENERY = 3; // auto mode: photos without faces kept per outing (food, views)
const MAX_PICKED = 60;

export type Progress = { stage: string; done: number; total: number };
export type SyncResult = { memories: number; photos: number; memoryIds: string[]; skippedNoDate: number };

type Candidate = PhotoMeta & { uri: string; width: number; height: number; people: string[] };
type Ctx = { userId: string; coupleId: string; people: PersonRow[]; onProgress?: (p: Progress) => void };

const lastSyncKey = (userId: string) => `lastSync:${userId}`;
export const SYNC_START_KEY = 'syncStart';

export async function getSyncStart(): Promise<number> {
  const v = await AsyncStorage.getItem(SYNC_START_KEY);
  return v ? Number(v) : Date.now() - 30 * 24 * 3600 * 1000;
}

export async function ensureLibraryPermission() {
  const cur = await getPermissionsAsync(false, ['photo']);
  if (cur.granted) return true;
  const res = await requestPermissionsAsync(false, ['photo']);
  return res.granted;
}

/** Spread picks evenly across the outing so the memory tells the whole day. */
function pickEvenly<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const out: T[] = [];
  for (let i = 0; i < n; i++) out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]);
  return out;
}

const faceList = (people: PersonRow[]) => people.map(p => ({ id: p.id, name: p.name, embeddings: p.embeddings }));

/** Faces are only for tagging; a failure there must not lose a photo. */
async function tag(uri: string, w: number, h: number, people: PersonRow[]) {
  try { return await peopleInPhoto(uri, w, h, faceList(people)); } catch (e) { console.warn('face tagging failed', e); return []; }
}

// ---------- automatic ----------

export async function runSync(ctx: Ctx): Promise<SyncResult> {
  const { userId, people, onProgress } = ctx;
  if (!people.length) throw new Error('얼굴을 먼저 등록해주세요.');
  if (!(await ensureLibraryPermission())) throw new Error('사진 접근 권한이 필요해요.');

  const from = await getSince(userId);
  onProgress?.({ stage: '새 사진 찾는 중', done: 0, total: 0 });
  const assets = await new Query()
    .eq(AssetField.MEDIA_TYPE, MediaType.IMAGE)
    .gt(AssetField.CREATION_TIME, from)
    .orderBy({ key: AssetField.CREATION_TIME, ascending: true })
    .limit(MAX_PER_SYNC)
    .exe();
  if (!assets.length) {
    await retryMissingStories(userId);
    return { memories: 0, photos: 0, memoryIds: [], skippedNoDate: 0 };
  }

  const uploaded = await alreadyUploaded(userId, assets.map(a => a.id));

  // Read metadata and look for faces, one photo at a time to keep memory low.
  const candidates: Candidate[] = [];
  let newest = from;
  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    onProgress?.({ stage: '사진 속 얼굴 찾는 중', done: i, total: assets.length });
    try {
      const info = await a.getInfo();
      const time = info.creationTime ?? 0;
      newest = Math.max(newest, time);
      if (uploaded.has(a.id)) continue;
      const loc = await a.getLocation();
      const found = await peopleInPhoto(info.uri, info.width, info.height, faceList(people));
      candidates.push({
        id: a.id, uri: info.uri, width: info.width, height: info.height, time,
        lat: loc?.latitude ?? null, lng: loc?.longitude ?? null, people: found,
      });
    } catch (e) {
      console.warn('skip photo', a.id, e);
    }
  }

  // An outing that may still be going on (last photo less than 3h ago) waits for the next run.
  const outings = clusterPhotos(candidates);
  const finished = outings.filter(o => Date.now() - o.end > GAP_MS || assets.length === MAX_PER_SYNC);
  const held = outings.find(o => !finished.includes(o));
  const nextSince = held ? Math.min(newest, held.start - 1) : newest;

  // Auto mode keeps only outings with one of us in them, plus a few scenery shots.
  const ours = finished
    .filter(o => o.photos.some(p => p.people.length > 0))
    .map(o => ({
      ...o,
      photos: pickEvenly(
        [...o.photos.filter(p => p.people.length > 0), ...pickEvenly(o.photos.filter(p => p.people.length === 0), EXTRA_SCENERY)]
          .sort((a, b) => a.time - b.time),
        MAX_PHOTOS_PER_MEMORY,
      ),
    }));

  const result = await saveOutings(ctx, ours, 'auto');
  await AsyncStorage.setItem(lastSyncKey(userId), String(nextSince));
  await retryMissingStories(userId);
  return result;
}

async function getSince(userId: string) {
  const last = await AsyncStorage.getItem(lastSyncKey(userId));
  return last ? Number(last) : await getSyncStart();
}

async function alreadyUploaded(userId: string, ids: string[]) {
  const uploaded = new Set<string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await supabase.from('photos').select('source_asset').eq('uploaded_by', userId).in('source_asset', ids.slice(i, i + 100));
    data?.forEach(r => uploaded.add(r.source_asset));
  }
  return uploaded;
}

// ---------- picked by us ----------

/** What expo-image-picker returns for each picked photo (only the fields we use). */
export type PickedPhoto = {
  assetId?: string | null;
  uri: string;
  width: number;
  height: number;
  fileName?: string | null;
  exif?: Record<string, unknown> | null;
};

/**
 * Groups photos we picked into outings by date and GPS. Every picked photo is kept.
 * Photos without a date cannot be placed in time and are left out (reported in skippedNoDate).
 * Outings without GPS are saved with no location; the app asks us to pick the place.
 */
export async function importPicked(ctx: Ctx, picked: PickedPhoto[]): Promise<SyncResult> {
  const { userId, people, onProgress } = ctx;
  if (picked.length > MAX_PICKED) throw new Error(`한 번에 ${MAX_PICKED}장까지 고를 수 있어요.`);
  const offset = -new Date().getTimezoneOffset();
  const ids = picked.map(p => p.assetId ?? `pick:${p.fileName ?? p.uri}`);
  const uploaded = await alreadyUploaded(userId, ids);

  const candidates: Candidate[] = [];
  let skippedNoDate = 0;
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    const id = ids[i];
    onProgress?.({ stage: '사진 날짜와 위치 확인 중', done: i, total: picked.length });
    if (uploaded.has(id)) continue;
    const ex = readExif(p.exif, offset);
    let { time, lat, lng } = ex;
    // The gallery knows more than the EXIF the picker hands over (e.g. iOS strips GPS from picker copies).
    if (p.assetId && (time == null || lat == null)) {
      try {
        const a = new Asset(p.assetId);
        if (time == null) time = (await a.getCreationTime()) ?? null;
        if (lat == null) { const loc = await a.getLocation(); lat = loc?.latitude ?? null; lng = loc?.longitude ?? null; }
      } catch (e) {
        console.warn('gallery lookup failed', p.assetId, e);
      }
    }
    if (time == null) { skippedNoDate++; continue; }
    const found = await tag(p.uri, p.width, p.height, people);
    candidates.push({ id, uri: p.uri, width: p.width, height: p.height, time, lat, lng, people: found });
  }

  const outings = clusterPhotos(candidates).map(o => ({ ...o, photos: pickEvenly(o.photos, MAX_PHOTOS_PER_MEMORY * 2) }));
  const result = await saveOutings(ctx, outings, 'picked');
  return { ...result, skippedNoDate };
}

// ---------- shared ----------

async function saveOutings(ctx: Ctx, outings: Outing<Candidate>[], origin: 'auto' | 'picked'): Promise<SyncResult> {
  const { userId, coupleId, onProgress } = ctx;
  let photoCount = 0;
  const memoryIds: string[] = [];
  const needStory: string[] = [];

  for (let oi = 0; oi < outings.length; oi++) {
    const o = outings[oi];
    onProgress?.({ stage: '추억 저장 중', done: oi, total: outings.length });
    const memory = await findOrCreateMemory(coupleId, userId, o, origin);
    const peopleIds = new Set(memory.people);
    let cover = memory.cover_photo;
    let coverHasBoth = false;

    for (const p of o.photos) {
      const small = await downscale(p.uri, p.width, p.height, 1600, { compress: 0.82 });
      const path = `${coupleId}/${memory.id}/${p.time}-${Math.random().toString(36).slice(2, 8)}.jpg`;
      const bytes = await new File(small.uri).arrayBuffer();
      const up = await supabase.storage.from('photos').upload(path, bytes, { contentType: 'image/jpeg' });
      if (up.error) throw up.error;
      const { data: row, error } = await supabase.from('photos').insert({
        couple_id: coupleId, memory_id: memory.id, storage_path: path,
        taken_at: new Date(p.time).toISOString(), lat: p.lat, lng: p.lng,
        width: small.width, height: small.height, people: p.people,
        source_asset: p.id, uploaded_by: userId,
      }).select('id').single();
      if (error) throw error;
      p.people.forEach(id => peopleIds.add(id));
      // Prefer a photo with both of us as the cover.
      if (!cover || (p.people.length >= 2 && !coverHasBoth)) {
        cover = row.id;
        coverHasBoth = p.people.length >= 2;
      }
      photoCount++;
    }

    // A place set by one of us is never overwritten by GPS from a later upload.
    const gpsNow = memory.place_source !== 'manual' && memory.lat == null && o.lat != null;
    await supabase.from('memories').update({
      started_at: new Date(Math.min(Date.parse(memory.started_at), o.start)).toISOString(),
      ended_at: new Date(Math.max(Date.parse(memory.ended_at), o.end)).toISOString(),
      ...(gpsNow ? { lat: o.lat, lng: o.lng, place_source: 'gps' } : {}),
      people: [...peopleIds], cover_photo: cover,
    }).eq('id', memory.id);

    if (!memory.summary || gpsNow) needStory.push(memory.id);
    memoryIds.push(memory.id);
  }

  for (let i = 0; i < needStory.length; i++) {
    onProgress?.({ stage: 'AI가 그날의 이야기를 쓰는 중', done: i, total: needStory.length });
    await writeStory(needStory[i]).catch(e => console.warn('story failed', e));
  }
  return { memories: memoryIds.length, photos: photoCount, memoryIds, skippedNoDate: 0 };
}

async function findOrCreateMemory(coupleId: string, userId: string, o: { start: number; end: number; lat: number | null; lng: number | null }, origin: 'auto' | 'picked') {
  // The partner's phone (or an earlier import) may already have this memory.
  const lo = new Date(o.start - 12 * 3600 * 1000).toISOString();
  const hi = new Date(o.end + 12 * 3600 * 1000).toISOString();
  const { data: near } = await supabase.from('memories').select('*').gte('started_at', lo).lte('started_at', hi);
  const match = (near as Memory[] | null)?.find(m =>
    sameOuting({ start: Date.parse(m.started_at), end: Date.parse(m.ended_at), lat: m.lat, lng: m.lng }, o));
  if (match) return match;
  const { data, error } = await supabase.from('memories').insert({
    couple_id: coupleId, created_by: userId, origin,
    started_at: new Date(o.start).toISOString(), ended_at: new Date(o.end).toISOString(),
    lat: o.lat, lng: o.lng, place_source: o.lat != null ? 'gps' : null,
  }).select('*').single();
  if (error) throw error;
  return data as Memory;
}

/** Asks the server to (re)write the story. It reads the stored photos and our memo itself. */
export async function writeStory(memoryId: string) {
  const { data, error } = await supabase.functions.invoke('summarize', { body: { memoryId } });
  if (error) throw error;
  return data as { title: string | null; place: string | null; summary: string | null };
}

/** Memories this phone made whose story failed earlier (e.g. API down): try again, a few per run. */
async function retryMissingStories(userId: string) {
  const { data } = await supabase.from('memories').select('id').eq('created_by', userId).is('summary', null).limit(3);
  for (const m of data ?? []) await writeStory(m.id).catch(e => console.warn('story retry failed', e));
}
