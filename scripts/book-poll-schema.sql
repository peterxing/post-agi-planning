-- Optional durable survey backend for /book/.
-- Run in the Supabase SQL editor for the project used by the public app.

create table if not exists public.book_probability_responses (
  reader_id text primary key,
  rapid numeric not null check (rapid >= 0 and rapid <= 100),
  abundance numeric not null check (abundance >= 0 and abundance <= 100),
  gentle numeric not null check (gentle >= 0 and gentle <= 100),
  long_horizon numeric not null check (long_horizon >= 0 and long_horizon <= 100),
  xrisk numeric not null check (xrisk >= 0 and xrisk <= 100),
  income numeric check (income >= 0 and income <= 100),
  liquidity numeric check (liquidity >= 0 and liquidity <= 100),
  energy numeric check (energy >= 0 and energy <= 100),
  community numeric check (community >= 0 and community <= 100),
  ai_fluency numeric check (ai_fluency >= 0 and ai_fluency <= 100),
  severity numeric check (severity >= 0 and severity <= 100),
  horizon_months numeric check (horizon_months >= 6 and horizon_months <= 120),
  essentials numeric check (essentials >= 0 and essentials <= 100),
  mitigation numeric check (mitigation >= 0 and mitigation <= 100),
  user_agent_hash text,
  updated_at timestamptz not null default now()
);

alter table public.book_probability_responses
  add column if not exists severity numeric check (severity >= 0 and severity <= 100),
  add column if not exists horizon_months numeric check (horizon_months >= 6 and horizon_months <= 120),
  add column if not exists essentials numeric check (essentials >= 0 and essentials <= 100),
  add column if not exists mitigation numeric check (mitigation >= 0 and mitigation <= 100);

alter table public.book_probability_responses enable row level security;

drop policy if exists "book poll anonymous read" on public.book_probability_responses;
create policy "book poll anonymous read"
on public.book_probability_responses
for select
to anon
using (true);

drop policy if exists "book poll anonymous insert" on public.book_probability_responses;
create policy "book poll anonymous insert"
on public.book_probability_responses
for insert
to anon
with check (true);

drop policy if exists "book poll anonymous update" on public.book_probability_responses;
create policy "book poll anonymous update"
on public.book_probability_responses
for update
to anon
using (true)
with check (true);
