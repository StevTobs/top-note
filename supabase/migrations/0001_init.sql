-- Top Note: cloud schema. Run once in Supabase → SQL Editor (or `supabase db push`).
-- Every table is protected by row level security: a signed-in user can only touch rows
-- whose user_id is their own auth.uid(). The browser only ever holds the publishable key.

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.categories (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  parent_id   uuid references public.categories (id) on delete set null,
  name        text not null check (char_length(name) between 1 and 500),
  sort_order  bigint not null default 0,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists categories_user_idx on public.categories (user_id, sort_order);
create index if not exists categories_parent_idx on public.categories (parent_id);

create table if not exists public.notes (
  id           uuid primary key,
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  category_id  uuid references public.categories (id) on delete set null,
  title        text not null default '' check (char_length(title) <= 10000),
  document     jsonb not null,
  plain_text   text not null default '',
  asset_ids    uuid[] not null default '{}',
  revision     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
create index if not exists notes_category_idx on public.notes (category_id);

-- Metadata for images; the bytes live in the private "note-assets" Storage bucket
-- at <user_id>/<asset id>.
create table if not exists public.assets (
  id          uuid primary key,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  mime_type   text not null check (mime_type in ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
  byte_size   integer not null check (byte_size between 1 and 10485760),
  created_at  timestamptz not null default now()
);
create index if not exists assets_user_idx on public.assets (user_id);

-- One row per user. Holds theme / font size / AI base URL + model. Never the API key.
create table if not exists public.preferences (
  user_id     uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

-- ─── Row level security ─────────────────────────────────────────────────────

alter table public.categories  enable row level security;
alter table public.notes       enable row level security;
alter table public.assets      enable row level security;
alter table public.preferences enable row level security;

do $$
declare t text;
begin
  foreach t in array array['categories', 'notes', 'assets', 'preferences'] loop
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;

-- ─── Multi-row operations (atomic, run with the caller's RLS) ───────────────

create or replace function public.category_descendants(p_id uuid)
returns setof uuid
language sql stable security invoker set search_path = public as $$
  with recursive tree as (
    select id from public.categories where id = p_id
    union
    select c.id from public.categories c join tree t on c.parent_id = t.id
  )
  select id from tree;
$$;

create or replace function public.move_category(p_id uuid, p_parent_id uuid, p_name text)
returns void
language plpgsql security invoker set search_path = public as $$
begin
  if p_parent_id is not null then
    if p_parent_id in (select public.category_descendants(p_id)) then
      raise exception 'category_cycle';
    end if;
    if not exists (select 1 from public.categories where id = p_parent_id and deleted_at is null) then
      raise exception 'category_parent_missing';
    end if;
  end if;
  update public.categories set parent_id = p_parent_id, name = p_name where id = p_id;
end $$;

create or replace function public.delete_category(p_id uuid, p_trash_notes boolean)
returns void
language plpgsql security invoker set search_path = public as $$
declare ts timestamptz := now();
begin
  update public.categories set deleted_at = ts
    where id in (select public.category_descendants(p_id));
  update public.notes set
      category_id = case when p_trash_notes then category_id else null end,
      deleted_at  = case when p_trash_notes then ts else null end,
      revision    = revision + 1,
      updated_at  = ts
    where deleted_at is null
      and category_id in (select public.category_descendants(p_id));
end $$;

create or replace function public.restore_category(p_id uuid)
returns void
language plpgsql security invoker set search_path = public as $$
declare root_parent uuid;
begin
  if not exists (select 1 from public.categories where id = p_id) then
    return;
  end if;
  update public.categories set deleted_at = null
    where id in (select public.category_descendants(p_id));
  select parent_id into root_parent from public.categories where id = p_id;
  if root_parent is not null and not exists (
    select 1 from public.categories where id = root_parent and deleted_at is null
  ) then
    update public.categories set parent_id = null where id = p_id;
  end if;
  update public.notes set deleted_at = null, revision = revision + 1
    where deleted_at is not null
      and category_id in (select public.category_descendants(p_id));
end $$;

-- Deletes a trashed note and returns the image ids that no other note references any more,
-- after removing their metadata rows. The caller then removes the Storage objects.
create or replace function public.delete_note_permanently(p_id uuid)
returns uuid[]
language plpgsql security invoker set search_path = public as $$
declare
  v_assets  uuid[];
  v_orphans uuid[];
begin
  select asset_ids into v_assets from public.notes where id = p_id and deleted_at is not null;
  if not found then
    raise exception 'note_not_in_trash';
  end if;
  delete from public.notes where id = p_id;
  select coalesce(array_agg(a), '{}') into v_orphans
    from unnest(v_assets) as a
    where not exists (select 1 from public.notes n where a = any (n.asset_ids));
  delete from public.assets where id = any (v_orphans);
  return v_orphans;
end $$;

grant execute on function
  public.category_descendants(uuid),
  public.move_category(uuid, uuid, text),
  public.delete_category(uuid, boolean),
  public.restore_category(uuid),
  public.delete_note_permanently(uuid)
to authenticated;

-- ─── Storage: private bucket, one folder per user ───────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('note-assets', 'note-assets', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "note assets: read own"   on storage.objects;
drop policy if exists "note assets: upload own" on storage.objects;
drop policy if exists "note assets: delete own" on storage.objects;

create policy "note assets: read own" on storage.objects for select to authenticated
  using (bucket_id = 'note-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "note assets: upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'note-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "note assets: delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'note-assets' and (storage.foldername(name))[1] = (select auth.uid())::text);
