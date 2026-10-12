-- Our Map: shared memories for a couple.
-- Every row belongs to a couple; only the couple's two members can read or write it.

create extension if not exists pgcrypto;

create table public.couples (
  id uuid primary key default gen_random_uuid(),
  invite_code text unique not null default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 6)),
  created_at timestamptz not null default now()
);

create table public.members (
  couple_id uuid not null references public.couples(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null default '',
  primary key (couple_id, user_id),
  unique (user_id)
);

-- Registered faces. embeddings: array of 192-d unit vectors from MobileFaceNet.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  name text not null,
  embeddings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.memories (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  lat double precision,
  lng double precision,
  place text,
  title text,
  summary text,
  people uuid[] not null default '{}',
  cover_photo uuid,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index memories_couple_time on public.memories (couple_id, started_at);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  memory_id uuid not null references public.memories(id) on delete cascade,
  storage_path text not null,
  taken_at timestamptz not null,
  lat double precision,
  lng double precision,
  width int,
  height int,
  people uuid[] not null default '{}',
  -- device asset id + uploader, so a phone never uploads the same photo twice
  source_asset text not null,
  uploaded_by uuid not null references auth.users(id),
  unique (uploaded_by, source_asset)
);
create index photos_memory on public.photos (memory_id, taken_at);

-- Membership helper used by every policy.
create or replace function public.my_couple() returns uuid
language sql stable security definer set search_path = public as $$
  select couple_id from public.members where user_id = auth.uid()
$$;

alter table public.couples enable row level security;
alter table public.members enable row level security;
alter table public.people enable row level security;
alter table public.memories enable row level security;
alter table public.photos enable row level security;

create policy "own couple" on public.couples for select using (id = public.my_couple());
create policy "own couple members" on public.members for select using (couple_id = public.my_couple());
create policy "update own name" on public.members for update using (user_id = auth.uid());

create policy "couple rw" on public.people for all
  using (couple_id = public.my_couple()) with check (couple_id = public.my_couple());
create policy "couple rw" on public.memories for all
  using (couple_id = public.my_couple()) with check (couple_id = public.my_couple());
create policy "couple rw" on public.photos for all
  using (couple_id = public.my_couple()) with check (couple_id = public.my_couple());

-- Pairing: one person creates a couple and shares the code, the other joins with it.
create or replace function public.create_couple(name text) returns public.couples
language plpgsql security definer set search_path = public as $$
declare c public.couples;
begin
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'already in a couple';
  end if;
  insert into couples default values returning * into c;
  insert into members (couple_id, user_id, display_name) values (c.id, auth.uid(), name);
  return c;
end $$;

create or replace function public.join_couple(code text, name text) returns public.couples
language plpgsql security definer set search_path = public as $$
declare c public.couples;
begin
  if exists (select 1 from members where user_id = auth.uid()) then
    raise exception 'already in a couple';
  end if;
  select * into c from couples where invite_code = upper(trim(code));
  if c.id is null then raise exception 'invalid code'; end if;
  if (select count(*) from members where couple_id = c.id) >= 2 then
    raise exception 'couple is full';
  end if;
  insert into members (couple_id, user_id, display_name) values (c.id, auth.uid(), name);
  return c;
end $$;

grant execute on function public.create_couple(text), public.join_couple(text, text) to authenticated;

-- Photo storage: private bucket, files under <couple_id>/...
insert into storage.buckets (id, name, public) values ('photos', 'photos', false)
  on conflict (id) do nothing;

create policy "couple photos read" on storage.objects for select
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.my_couple()::text);
create policy "couple photos write" on storage.objects for insert
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = public.my_couple()::text);
create policy "couple photos delete" on storage.objects for delete
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.my_couple()::text);

-- Live updates so both phones see new memories right away.
alter publication supabase_realtime add table public.memories, public.photos, public.people;
