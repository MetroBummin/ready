-- Reusable comprehension assets. Question formats (O/X, multiple choice, etc.)
-- remain renderers over this bank rather than owning duplicate fact data.
create table public.ready_content_facts (
  id uuid primary key default gen_random_uuid(),
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  fact_key text not null,
  fact_text text not null,
  evidence_sentence_ids uuid[] not null,
  evidence_snapshot jsonb not null default '[]'::jsonb,
  status text not null default 'draft' check (status in ('draft','confirmed','stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (passage_id, fact_key),
  check (char_length(trim(fact_key)) between 1 and 80),
  check (char_length(trim(fact_text)) between 1 and 4000),
  check (cardinality(evidence_sentence_ids) between 1 and 20),
  check (jsonb_typeof(evidence_snapshot) = 'array')
);

create table public.ready_content_claims (
  id uuid primary key default gen_random_uuid(),
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  fact_id uuid not null references public.ready_content_facts(id) on delete cascade,
  statement text not null,
  truth boolean not null,
  language text not null default 'en' check (language in ('en','ko')),
  difficulty smallint not null default 1 check (difficulty between 1 and 3),
  mutation_type text,
  mutation_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','confirmed','stale')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (char_length(trim(statement)) between 1 and 4000),
  check (mutation_type is null or char_length(trim(mutation_type)) between 1 and 80),
  check (jsonb_typeof(mutation_metadata) = 'object')
);

create index ready_content_facts_passage_idx
  on public.ready_content_facts(passage_id, status, created_at);
create index ready_content_claims_fact_idx
  on public.ready_content_claims(fact_id, status, created_at);
create index ready_content_claims_student_idx
  on public.ready_content_claims(passage_id, status, created_at)
  where status = 'confirmed';

alter table public.ready_content_facts enable row level security;
alter table public.ready_content_claims enable row level security;

-- READY's Edge Function authenticates its own admin/student sessions and uses
-- service_role. Do not expose Claim Bank rows directly to browser roles.
revoke all on public.ready_content_facts from public, anon, authenticated;
revoke all on public.ready_content_claims from public, anon, authenticated;
grant select, insert, update, delete on public.ready_content_facts to service_role;
grant select, insert, update, delete on public.ready_content_claims to service_role;

create or replace function public.ready_content_touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger ready_content_facts_touch_updated_at
before update on public.ready_content_facts
for each row execute function public.ready_content_touch_updated_at();

create trigger ready_content_claims_touch_updated_at
before update on public.ready_content_claims
for each row execute function public.ready_content_touch_updated_at();

create or replace function public.ready_content_touch_passage()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.ready_passages set updated_at = now()
  where id = case when tg_op = 'DELETE' then old.passage_id else new.passage_id end;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger ready_content_facts_touch_passage
after insert or update or delete on public.ready_content_facts
for each row execute function public.ready_content_touch_passage();

create trigger ready_content_claims_touch_passage
after insert or update or delete on public.ready_content_claims
for each row execute function public.ready_content_touch_passage();

revoke all on function public.ready_content_touch_updated_at() from public, anon, authenticated;
grant execute on function public.ready_content_touch_updated_at() to service_role;
revoke all on function public.ready_content_touch_passage() from public, anon, authenticated;
grant execute on function public.ready_content_touch_passage() to service_role;
