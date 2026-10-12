-- OURS features: memo + story, place confirmation, date course recommendations.

-- Story: the couple's own memo feeds the AI story; both stay editable.
alter table public.memories add column memo text;

-- Place: only GPS or a person may confirm where a memory happened.
--   gps    = from photo GPS
--   manual = set by one of us
--   null   = not confirmed yet (photos had no GPS); app asks us to pick it
alter table public.memories add column place_source text
  check (place_source in ('gps', 'manual'));
update public.memories set place_source = 'gps' where lat is not null;

-- How the memory was found: automatic gallery scan or photos we picked.
alter table public.memories add column origin text not null default 'auto'
  check (origin in ('auto', 'picked'));

-- AI date course suggestions, kept so we can come back to them.
create table public.date_courses (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references public.couples(id) on delete cascade,
  request jsonb not null default '{}'::jsonb,   -- what we asked for (area, mood, budget, when)
  course jsonb not null,                         -- {title, stops: [{name, address, lat, lng, why, time}]}
  saved boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index date_courses_couple on public.date_courses (couple_id, created_at desc);

alter table public.date_courses enable row level security;
create policy "couple rw" on public.date_courses for all
  using (couple_id = public.my_couple()) with check (couple_id = public.my_couple());

alter publication supabase_realtime add table public.date_courses;
