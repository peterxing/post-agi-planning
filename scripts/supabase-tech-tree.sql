create table if not exists public.tech_tree_states (
  user_id text not null,
  node_id text not null,
  status text not null,
  effective_year integer,
  effective_month integer,
  updated_at timestamptz not null default now()
);

create unique index if not exists tech_tree_states_unique_idx
  on public.tech_tree_states (user_id, node_id, effective_year, effective_month);

alter table public.tech_tree_states enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tech_tree_states'
      and policyname = 'allow_select_tech_tree_states'
  ) then
    create policy allow_select_tech_tree_states
      on public.tech_tree_states
      for select
      using (auth.role() in ('anon', 'authenticated'));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tech_tree_states'
      and policyname = 'allow_insert_tech_tree_states'
  ) then
    create policy allow_insert_tech_tree_states
      on public.tech_tree_states
      for insert
      with check (auth.role() in ('anon', 'authenticated'));
  end if;

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'tech_tree_states'
      and policyname = 'allow_update_tech_tree_states'
  ) then
    create policy allow_update_tech_tree_states
      on public.tech_tree_states
      for update
      using (auth.role() in ('anon', 'authenticated'))
      with check (auth.role() in ('anon', 'authenticated'));
  end if;
end $$;
