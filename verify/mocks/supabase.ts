// In-memory stand-in for the parts of supabase-js the sync code uses.
import { world } from './env';

let seq = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
type Filter = (r: any) => boolean;

class Builder {
  private filters: Filter[] = [];
  private mode: 'select' | 'insert' | 'update' = 'select';
  private payload: any;
  private wantSingle = false;
  private max = Infinity;
  constructor(private table: string) {}
  select(_cols?: string) { return this; }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this; }
  in(c: string, vs: unknown[]) { this.filters.push(r => vs.includes(r[c])); return this; }
  gte(c: string, v: string) { this.filters.push(r => r[c] >= v); return this; }
  lte(c: string, v: string) { this.filters.push(r => r[c] <= v); return this; }
  is(c: string, v: null) { this.filters.push(r => (r[c] ?? null) === v); return this; }
  limit(n: number) { this.max = n; return this; }
  order() { return this; }
  insert(row: any) { this.mode = 'insert'; this.payload = row; return this; }
  update(patch: any) { this.mode = 'update'; this.payload = patch; return this; }
  single() { this.wantSingle = true; return this; }
  private run(): { data: any; error: any } {
    const rows = (world.tables[this.table] ??= []);
    if (this.mode === 'insert') {
      const row = { id: uuid(), people: [], summary: null, title: null, place: null, cover_photo: null, ...this.payload };
      if (this.table === 'photos' && rows.some(r => r.uploaded_by === row.uploaded_by && r.source_asset === row.source_asset)) {
        return { data: null, error: { message: 'duplicate key value violates unique constraint' } };
      }
      rows.push(row);
      return { data: this.wantSingle ? { ...row } : [{ ...row }], error: null };
    }
    const hit = rows.filter(r => this.filters.every(f => f(r)));
    if (this.mode === 'update') { hit.forEach(r => Object.assign(r, this.payload)); return { data: null, error: null }; }
    return { data: hit.slice(0, this.max).map(r => ({ ...r })), error: null };
  }
  then(res: (v: any) => any, rej?: (e: any) => any) { return Promise.resolve(this.run()).then(res, rej); }
}

export const supabase = {
  from: (t: string) => new Builder(t),
  storage: {
    from: (_bucket: string) => ({
      upload: async (path: string) => {
        if (world.uploads >= world.failUploadAfter) return { error: new Error('network down') };
        world.uploads++;
        if (world.files.has(path)) return { error: new Error('exists') };
        world.files.add(path);
        return { error: null };
      },
    }),
  },
  functions: {
    invoke: async (name: string, { body }: { body: any }) => {
      world.summarizeCalls.push({ name, body });
      const m = world.tables.memories.find(r => r.id === body.memoryId);
      if (m) Object.assign(m, { title: 'T', summary: 'S', place: 'P' });
      return { error: null };
    },
  },
};
