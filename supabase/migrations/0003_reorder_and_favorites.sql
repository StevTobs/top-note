-- Top Note: drag-to-reorder + Favorites for notes, categories, projects, and tasks.
-- Run once in Supabase → SQL Editor (or `supabase db push`), after 0001 and 0002.
-- No RLS changes needed: RLS is row-level and already covers these new columns on
-- tables that already have the "own rows" policy from earlier migrations.

alter table public.notes
  add column if not exists sort_order bigint not null default 0,
  add column if not exists is_favorite boolean not null default false;

alter table public.categories
  add column if not exists is_favorite boolean not null default false;

alter table public.projects
  add column if not exists is_favorite boolean not null default false;

alter table public.tasks
  add column if not exists is_favorite boolean not null default false;

-- Only used once a user opts into "custom order" note sorting; the default
-- "recently edited" sort keeps using notes_user_updated_idx.
create index if not exists notes_user_sort_idx on public.notes (user_id, sort_order);
