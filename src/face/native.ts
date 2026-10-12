// On-device face detection + recognition with TFLite. Photos never leave the phone for this.
import { File } from 'expo-file-system';
import jpeg from 'jpeg-js';
import { loadTensorflowModel, type TensorflowModel } from 'react-native-fast-tflite';
import { downscale } from '../lib/image';
import { decodeDetections, detectorInput, matchPerson, normalize, recognizerInput, type Box, type Person, type RGBAImage } from './core';

let models: Promise<{ det: TensorflowModel; rec: TensorflowModel }> | null = null;

function loadModels() {
  models ??= Promise.all([
    loadTensorflowModel(require('../../assets/models/blaze_face_short_range.tflite'), []),
    loadTensorflowModel(require('../../assets/models/mobilefacenet.tflite'), []),
  ]).then(([det, rec]) => ({ det, rec }));
  return models;
}

/** Decode a photo into RGBA pixels at a working size (longer side 720px). */
export async function decodePhoto(uri: string, width: number, height: number): Promise<RGBAImage> {
  const small = await downscale(uri, width, height, 720, { compress: 0.92 });
  const buf = await new File(small.uri).arrayBuffer();
  const img = jpeg.decode(new Uint8Array(buf), { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 64 });
  return { width: img.width, height: img.height, data: img.data as Uint8Array };
}

export type FaceHit = { box: Box; embedding: number[] };

export async function findFaces(img: RGBAImage, minFaceRatio = 0.06): Promise<FaceHit[]> {
  const { det, rec } = await loadModels();
  const input = detectorInput(img);
  const outs = await det.run([input.tensor.buffer as ArrayBuffer]);
  const arrays = outs.map(b => new Float32Array(b));
  const reg = arrays.find(a => a.length === 896 * 16);
  const scores = arrays.find(a => a.length === 896);
  if (!reg || !scores) throw new Error('unexpected detector output');
  // Skip tiny background faces: they are rarely the two of us and match poorly.
  const minSide = Math.max(img.width, img.height) * minFaceRatio;
  const boxes = decodeDetections(reg, scores, input).filter(b => b.w >= minSide);
  const hits: FaceHit[] = [];
  for (const box of boxes.slice(0, 8)) {
    const [emb] = await rec.run([recognizerInput(img, box).buffer as ArrayBuffer]);
    hits.push({ box, embedding: normalize(new Float32Array(emb)) });
  }
  return hits;
}

/** Ids of registered people found in one photo. */
export async function peopleInPhoto(uri: string, width: number, height: number, people: Person[]) {
  if (!people.length) return [];
  const img = await decodePhoto(uri, width, height);
  const ids = new Set<string>();
  for (const f of await findFaces(img)) {
    const m = matchPerson(f.embedding, people);
    if (m) ids.add(m.person.id);
  }
  return [...ids];
}

/** Embedding of the single most prominent face, for registering a person. */
export async function embeddingForRegistration(uri: string, width: number, height: number) {
  const img = await decodePhoto(uri, width, height);
  const faces = await findFaces(img, 0.15);
  if (!faces.length) return null;
  faces.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h);
  return faces[0].embedding;
}
