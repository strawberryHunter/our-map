export async function downscale(uri: string, width: number, height: number, maxSide: number, opts: { base64?: boolean } = {}) {
  const s = Math.min(1, maxSide / Math.max(width, height));
  return { uri: `${uri}@${maxSide}`, width: Math.round(width * s), height: Math.round(height * s), base64: opts.base64 ? 'BASE64' : undefined };
}
