// Bundles src/sync/sync.ts with native modules swapped for the fakes in this folder.
import { build } from 'esbuild';
import os from 'node:os';
import path from 'node:path';

const here = path.join(process.cwd(), 'verify/mocks');
const swaps: Record<string, string> = {
  '@react-native-async-storage/async-storage': 'async-storage.ts',
  'expo-file-system': 'file-system.ts',
  'expo-media-library': 'media-library.ts',
  '../face/native': 'face-native.ts',
  '../lib/image': 'image.ts',
  '../lib/supabase': 'supabase.ts',
};

export async function bundleSync() {
  const out = path.join(os.tmpdir(), `sync-bundle-${process.pid}.cjs`);
  await build({
    entryPoints: [path.join(here, 'entry.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: out, logLevel: 'error',
    plugins: [{
      name: 'swap-native',
      setup(b) {
        b.onResolve({ filter: /.*/ }, args => {
          const swap = swaps[args.path];
          if (swap) return { path: path.join(here, swap) };
          // Anything else that is a bare package must not reach the bundle: it would be native code.
          if (!args.path.startsWith('.') && !path.isAbsolute(args.path)) return { errors: [{ text: `unmocked import ${args.path} from ${args.importer}` }] };
          return undefined;
        });
      },
    }],
  });
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(out) as typeof import('./entry');
}
