import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** Downscale so the longer side is at most `maxSide`. Returns a local JPEG file. */
export async function downscale(uri: string, width: number, height: number, maxSide: number, opts: { base64?: boolean; compress?: number } = {}) {
  const ctx = ImageManipulator.manipulate(uri);
  if (Math.max(width, height) > maxSide) {
    ctx.resize(width >= height ? { width: maxSide } : { height: maxSide });
  }
  const ref = await ctx.renderAsync();
  return ref.saveAsync({ format: SaveFormat.JPEG, compress: opts.compress ?? 0.85, base64: opts.base64 });
}
