-- Top Note: share notes and projects with other users who have already signed in, with full
-- edit rights. Run once in Supabase → SQL Editor (or `supabase db push`), after 0001-0003.
--
-- This migration touches the authorization model of the whole app: it replaces the single
-- "own rows" policy on notes/assets/projects/tasks/task_dependencies with per-command
-- policies (select/update extend to collaborators via note_shares/project_shares; insert and
-- delete on the top-level notes/projects rows stay owner-only), and rewrites the Storage
-- bucket's read policy so a collaborator can view images in a shared note.
--
-- This file was revised after a security review caught two real cross-account bugs before
-- this migration was ever run: (1) a collaborator could rewrite notes.user_id/projects.user_id
-- to themselves via a plain UPDATE, since RLS "with check" only re-validates the new row, not
-- that it matches the old owner — closed below via column-level REVOKE, since RLS alone cannot
-- compare OLD vs NEW; (2) note_shares/project_shares only checked that the caller passed their
-- own uid as owner_id, never that they actually own the note/project being shared — closed by
-- adding an ownership EXISTS check to that policy. See CHANGELOG for the manual two-account
-- verification steps this cannot be checked by the unit test suite, which mocks Supabase
-- entirely.

-- ─── Share tables ────────────────────────────────────────────────────────────

create table if not exists public.note_shares (
  id                    uuid primary key,
  note_id               uuid not null references public.notes (id) on delete cascade,
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email           text not null default '',
  shared_with_user_id   uuid not null references auth.users (id) on delete cascade,
  shared_with_email     text not null default '',
  created_at            timestamptz not null default now(),
  unique (note_id, shared_with_user_id),
  check (owner_id <> shared_with_user_id)
);
create index if not exists note_shares_shared_with_idx on public.note_shares (shared_with_user_id);
create index if not exists note_shares_note_idx on public.note_shares (note_id);

create table if not exists public.project_shares (
  id                    uuid primary key,
  project_id            uuid not null references public.projects (id) on delete cascade,
  owner_id              uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email           text not null default '',
  shared_with_user_id   uuid not null references auth.users (id) on delete cascade,
  shared_with_email     text not null default '',
  created_at            timestamptz not null default now(),
  unique (project_id, shared_with_user_id),
  check (owner_id <> shared_with_user_id)
);
create index if not exists project_shares_shared_with_idx on public.project_shares (shared_with_user_id);
create index if not exists project_shares_project_idx on public.project_shares (project_id);

alter table public.note_shares    enable row level security;
alter table public.project_shares enable row level security;

-- "owner manages" requires BOTH that the caller is the named owner AND that the caller
-- actually owns the note/project being shared — without the second half, anyone could grant
-- share access to a resource they don't own by just naming themselves as owner_id (that part
-- alone always passes, since owner_id = auth.uid() is trivially satisfiable by any caller).
create policy "note_shares: owner manages" on public.note_shares for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = owner_id)
  )
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.notes n where n.id = note_id and n.user_id = owner_id)
  );
create policy "note_shares: recipient reads" on public.note_shares for select to authenticated
  using (shared_with_user_id = (select auth.uid()));
create policy "note_shares: recipient leaves" on public.note_shares for delete to authenticated
  using (shared_with_user_id = (select auth.uid()));

create policy "project_shares: owner manages" on public.project_shares for all to authenticated
  using (
    owner_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = owner_id)
  )
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.projects p where p.id = project_id and p.user_id = owner_id)
  );
create policy "project_shares: recipient reads" on public.project_shares for select to authenticated
  using (shared_with_user_id = (select auth.uid()));
create policy "project_shares: recipient leaves" on public.project_shares for delete to authenticated
  using (shared_with_user_id = (select auth.uid()));

-- ─── User lookup (invite by email, existing users only) ─────────────────────

-- security definer: the only way to read auth.users at all from an authenticated client, since
-- it isn't reachable via RLS/PostgREST directly. Scoped to return only an id, nothing else.
create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = public, auth as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;
grant execute on function public.find_user_id_by_email(text) to authenticated;

-- Both share tables store owner_email/shared_with_email purely for display ("แชร์โดย …").
-- Trusting client-supplied strings for these would let a note owner impersonate an arbitrary
-- display name; this trigger always overwrites both from auth.users server-side instead.
create or replace function public.set_share_emails()
returns trigger
language plpgsql security definer set search_path = public, auth as $$
begin
  select email into new.owner_email from auth.users where id = new.owner_id;
  select email into new.shared_with_email from auth.users where id = new.shared_with_user_id;
  return new;
end;
$$;
create trigger note_shares_set_emails
  before insert or update on public.note_shares
  for each row execute function public.set_share_emails();
create trigger project_shares_set_emails
  before insert or update on public.project_shares
  for each row execute function public.set_share_emails();

-- ─── notes / assets: rewritten per-command RLS ───────────────────────────────

drop policy if exists "own rows" on public.notes;

create policy "notes: select own or shared" on public.notes for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.note_shares s
               where s.note_id = notes.id and s.shared_with_user_id = (select auth.uid()))
  );
create policy "notes: insert own" on public.notes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "notes: update own or shared" on public.notes for update to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.note_shares s
               where s.note_id = notes.id and s.shared_with_user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    or exists (select 1 from public.note_shares s
               where s.note_id = notes.id and s.shared_with_user_id = (select auth.uid()))
  );
create policy "notes: delete own" on public.notes for delete to authenticated
  using (user_id = (select auth.uid()));

-- RLS "with check" only validates the resulting row, so it cannot compare NEW.user_id against
-- OLD.user_id — a collaborator (who legitimately passes the update policy above) could
-- otherwise UPDATE notes SET user_id = <themselves> and simply take over the note, locking the
-- real owner out. Postgres has no OLD/NEW comparison in a row policy, so the fix is a
-- column-level privilege: no authenticated user, owner included, may change this column via
-- the client (ownership never needs to change through normal app usage).
revoke update (user_id) on public.notes from authenticated;

drop policy if exists "own rows" on public.assets;

create policy "assets: select own or via shared note" on public.assets for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.notes n join public.note_shares s on s.note_id = n.id
               where s.shared_with_user_id = (select auth.uid()) and assets.id = any (n.asset_ids))
  );
create policy "assets: insert own" on public.assets for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "assets: delete own or via owned note" on public.assets for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.notes n
               where n.user_id = (select auth.uid()) and assets.id = any (n.asset_ids))
  );

-- ─── projects / tasks / task_dependencies: rewritten per-command RLS ────────

drop policy if exists "own rows" on public.projects;

create policy "projects: select own or shared" on public.projects for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.project_shares s
               where s.project_id = projects.id and s.shared_with_user_id = (select auth.uid()))
  );
create policy "projects: insert own" on public.projects for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "projects: update own or shared" on public.projects for update to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.project_shares s
               where s.project_id = projects.id and s.shared_with_user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    or exists (select 1 from public.project_shares s
               where s.project_id = projects.id and s.shared_with_user_id = (select auth.uid()))
  );
create policy "projects: delete own" on public.projects for delete to authenticated
  using (user_id = (select auth.uid()));

-- Same ownership-hijack hole as notes.user_id above, same fix.
revoke update (user_id) on public.projects from authenticated;

drop policy if exists "own rows" on public.tasks;

create policy "tasks: select own or shared" on public.tasks for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.project_shares s
               where s.project_id = tasks.project_id and s.shared_with_user_id = (select auth.uid()))
  );
create policy "tasks: insert own or shared" on public.tasks for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or exists (select 1 from public.project_shares s
               where s.project_id = tasks.project_id and s.shared_with_user_id = (select auth.uid()))
  );
create policy "tasks: update own or shared" on public.tasks for update to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.project_shares s
               where s.project_id = tasks.project_id and s.shared_with_user_id = (select auth.uid()))
  )
  with check (
    user_id = (select auth.uid())
    or exists (select 1 from public.project_shares s
               where s.project_id = tasks.project_id and s.shared_with_user_id = (select auth.uid()))
  );
create policy "tasks: delete own or shared" on public.tasks for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.project_shares s
               where s.project_id = tasks.project_id and s.shared_with_user_id = (select auth.uid()))
  );

-- tasks.project_id is likewise an authorization anchor (it's what project_shares is joined
-- against above) and must not be reassignable by a collaborator to move a task into a project
-- they don't otherwise have access to, or out of one they do.
revoke update (project_id) on public.tasks from authenticated;

drop policy if exists "own rows" on public.task_dependencies;

-- Both predecessor and successor must resolve to a project the caller can access — checking
-- only the predecessor (as an earlier draft of this migration did) would let a caller with
-- access to *any* task link it as a predecessor to an arbitrary successor_task_id in a
-- project they have no access to at all, creating an unauthorized cross-account linkage the
-- victim couldn't even see (their own select policy only checks predecessor_task_id too).
create policy "task_dependencies: select own or shared" on public.task_dependencies for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.tasks t join public.project_shares s on s.project_id = t.project_id
               where t.id in (task_dependencies.predecessor_task_id, task_dependencies.successor_task_id)
                 and s.shared_with_user_id = (select auth.uid()))
  );
create policy "task_dependencies: insert own or shared" on public.task_dependencies for insert to authenticated
  with check (
    user_id = (select auth.uid())
    or (
      exists (select 1 from public.tasks t join public.project_shares s on s.project_id = t.project_id
              where t.id = task_dependencies.predecessor_task_id and s.shared_with_user_id = (select auth.uid()))
      and exists (select 1 from public.tasks t join public.project_shares s on s.project_id = t.project_id
                  where t.id = task_dependencies.successor_task_id and s.shared_with_user_id = (select auth.uid()))
    )
  );
create policy "task_dependencies: delete own or shared" on public.task_dependencies for delete to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.tasks t join public.project_shares s on s.project_id = t.project_id
               where t.id in (task_dependencies.predecessor_task_id, task_dependencies.successor_task_id)
                 and s.shared_with_user_id = (select auth.uid()))
  );

-- ─── Storage: extend image read access to collaborators on a shared note ────

create or replace function public.can_access_asset(p_asset_id uuid)
returns boolean
language sql stable security invoker set search_path = public as $$
  select exists (select 1 from public.assets a
                  where a.id = p_asset_id and a.user_id = (select auth.uid()))
      or exists (select 1 from public.notes n
                  where n.user_id = (select auth.uid()) and p_asset_id = any (n.asset_ids))
      or exists (select 1 from public.notes n join public.note_shares s on s.note_id = n.id
                  where s.shared_with_user_id = (select auth.uid()) and p_asset_id = any (n.asset_ids));
$$;
grant execute on function public.can_access_asset(uuid) to authenticated;

drop policy if exists "note assets: read own" on storage.objects;
create policy "note assets: read own or shared" on storage.objects for select to authenticated
  using (
    bucket_id = 'note-assets'
    and public.can_access_asset((regexp_replace(name, '^[^/]+/', ''))::uuid)
  );
-- Upload/delete storage policies are untouched: new uploads always land in the uploader's own
-- folder (see src/assets.ts putAsset), so no collaborator ever needs write access to another
-- user's folder — only read access to images already shared into a note they collaborate on.
