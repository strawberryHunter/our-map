// Runs supabase/migrations/*.sql on an in-process Postgres (PGlite) with small stand-ins for
// Supabase's auth/storage schemas, then checks the pairing functions and row-level security
// the way the app's two phones (and a stranger) would hit them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { before, describe, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pathToFileURL } from 'node:url';

// PGlite ships the pgcrypto bundle but no JS wrapper for it in this version.
const pgcrypto = {
  name: 'pgcrypto',
  setup: async () => ({ bundlePath: pathToFileURL(path.join(process.cwd(), 'node_modules/@electric-sql/pglite/dist/pgcrypto.tar.gz')) }),
};

const MIGRATIONS = path.join(process.cwd(), 'supabase/migrations');

// Minimal Supabase platform pieces the migration depends on.
const SUPABASE_STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean);
create table storage.objects (id bigserial primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
grant usage on sequence storage.objects_id_seq to authenticated;
create publication supabase_realtime;
`;
const A = '00000000-0000-0000-0000-00000000000a'; // me
const B = '00000000-0000-0000-0000-00000000000b'; // partner
const C = '00000000-0000-0000-0000-00000000000c'; // another couple
const D = '00000000-0000-0000-0000-00000000000d'; // someone trying to join a full couple

let db: PGlite;

/** Run SQL as a signed-in app user, the way PostgREST does. */
async function as<T = Record<string, unknown>>(user: string, sql: string, params: unknown[] = []) {
  return db.transaction(async tx => {
    await tx.exec(`set local role authenticated; select set_config('request.jwt.claim.sub', '${user}', true);`);
    return (await tx.query<T>(sql, params)).rows;
  });
}
async function rejects(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (e: Error) => { assert.match(e.message, pattern); return true; });
}

describe('database', () => {
  let coupleAB: { id: string; invite_code: string };
  let coupleC: { id: string; invite_code: string };

  before(async () => {
    db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(SUPABASE_STUB);
    for (const u of [A, B, C, D]) await db.query('insert into auth.users values ($1)', [u]);
    // Supabase's default privileges grant API roles access to every new table before migrations run.
    await db.exec(`alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;`);
    await db.exec(`grant usage on schema public to anon, authenticated;`);
    for (const f of fs.readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql')).sort()) {
      await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
    }
  });

  test('migration runs cleanly on a fresh database', async () => {
    const t = await db.query<{ n: string }>(`select count(*)::text n from pg_tables where schemaname='public'`);
    assert.equal(t.rows[0].n, '6');
  });

  test('create_couple returns a 6-char invite code', async () => {
    [coupleAB] = await as<{ id: string; invite_code: string }>(A, `select * from public.create_couple('MJ')`);
    assert.match(coupleAB.invite_code, /^[0-9A-F]{6}$/);
  });

  test('partner joins with the code (case and spaces ignored)', async () => {
    const [c] = await as<{ id: string }>(B, `select * from public.join_couple($1, 'NY')`, [`  ${coupleAB.invite_code.toLowerCase()} `]);
    assert.equal(c.id, coupleAB.id);
  });

  test('a third person cannot join a full couple', async () => {
    await rejects(as(D, `select public.join_couple($1, 'X')`, [coupleAB.invite_code]), /full/);
  });

  test('a wrong code is rejected', async () => {
    await rejects(as(D, `select public.join_couple('ZZZZZZ', 'X')`), /invalid code/);
  });

  test('you cannot be in two couples', async () => {
    [coupleC] = await as<{ id: string; invite_code: string }>(C, `select * from public.create_couple('C')`);
    await rejects(as(A, `select public.join_couple($1, 'MJ')`, [coupleC.invite_code]), /already/);
    await rejects(as(A, `select public.create_couple('MJ')`), /already/);
  });

  test('partner sees memories I create; the other couple does not', async () => {
    await as(A, `insert into public.memories (couple_id, started_at, ended_at, created_by) values ($1, now(), now(), $2)`, [coupleAB.id, A]);
    assert.equal((await as(B, `select id from public.memories`)).length, 1);
    assert.equal((await as(C, `select id from public.memories`)).length, 0);
  });

  test('the other couple cannot write into our couple', async () => {
    await rejects(
      as(C, `insert into public.memories (couple_id, started_at, ended_at) values ($1, now(), now())`, [coupleAB.id]),
      /row-level security/,
    );
    const changed = await as(C, `update public.memories set title = 'hacked' returning id`);
    assert.equal(changed.length, 0);
    const deleted = await as(C, `delete from public.memories returning id`);
    assert.equal(deleted.length, 0);
  });

  test('the other couple cannot read our face embeddings or members', async () => {
    await as(A, `insert into public.people (couple_id, name, embeddings) values ($1, 'MJ', '[[0.1]]')`, [coupleAB.id]);
    assert.equal((await as(C, `select * from public.people`)).length, 0);
    assert.equal((await as(C, `select * from public.members`)).length, 1, 'C sees only their own membership');
    assert.equal((await as(B, `select * from public.members`)).length, 2);
  });

  test('changing my display name cannot move me into another couple', async () => {
    await as(D, `select public.create_couple('D')`);
    const renamed = await as(D, `update public.members set display_name = 'Dee' where user_id = $1 returning display_name`, [D]);
    assert.equal(renamed.length, 1, 'renaming yourself still works');
    // Attempt to hijack: rewrite my own membership row to point at couple C.
    await rejects(as(D, `update public.members set couple_id = $1 where user_id = $2`, [coupleC.id, D]), /permission denied/);
    const seen = await as<{ id: string }>(D, `select id from public.couples`);
    assert.ok(!seen.some(r => r.id === coupleC.id), 'D must not end up in couple C');
    const [{ n }] = (await db.query<{ n: string }>(`select count(*)::text n from public.members where couple_id = $1`, [coupleC.id])).rows;
    assert.equal(n, '1');
  });

  test('invite codes of other couples are not readable', async () => {
    const rows = await as<{ id: string }>(C, `select id from public.couples`);
    assert.deepEqual(rows.map(r => r.id), [coupleC.id]);
  });

  test('same phone cannot upload the same gallery photo twice', async () => {
    const [m] = await as<{ id: string }>(A, `select id from public.memories limit 1`);
    const ins = `insert into public.photos (couple_id, memory_id, storage_path, taken_at, source_asset, uploaded_by) values ($1, $2, 'p', now(), 'asset-1', $3)`;
    await as(A, ins, [coupleAB.id, m.id, A]);
    await rejects(as(A, ins, [coupleAB.id, m.id, A]), /duplicate key/);
    // ...but the partner's phone can have its own asset with the same local id
    await as(B, ins, [coupleAB.id, m.id, B]);
  });

  test('photo storage: only our own couple folder', async () => {
    await as(A, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [`${coupleAB.id}/m/1.jpg`]);
    await rejects(as(C, `insert into storage.objects (bucket_id, name) values ('photos', $1)`, [`${coupleAB.id}/m/2.jpg`]), /row-level security/);
    assert.equal((await as(C, `select name from storage.objects`)).length, 0);
    assert.equal((await as(B, `select name from storage.objects`)).length, 1);
  });

  test('signed-out requests see nothing', async () => {
    const rows = await db.transaction(async tx => {
      await tx.exec(`set local role authenticated;`);
      return (await tx.query(`select * from public.memories`)).rows;
    });
    assert.equal(rows.length, 0);
  });

  test('date courses are private to the couple', async () => {
    await as(A, `insert into public.date_courses (couple_id, course, created_by) values ($1, '{"title":"t","stops":[]}', $2)`, [coupleAB.id, A]);
    assert.equal((await as(B, `select id from public.date_courses`)).length, 1);
    assert.equal((await as(C, `select id from public.date_courses`)).length, 0);
    await rejects(as(C, `insert into public.date_courses (couple_id, course) values ($1, '{}')`, [coupleAB.id]), /row-level security/);
  });

  test('place_source only accepts gps or manual', async () => {
    await rejects(as(A, `update public.memories set place_source = 'ai'`), /check constraint/);
    const ok = await as(A, `update public.memories set place_source = 'manual', memo = '처음 간 곳' returning id`);
    assert.equal(ok.length, 1);
  });

  test('tables are in the realtime publication', async () => {
    const r = await db.query<{ tablename: string }>(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' order by 1`);
    assert.deepEqual(r.rows.map(x => x.tablename), ['date_courses', 'memories', 'people', 'photos']);
  });
});
