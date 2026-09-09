create table if not exists public.ready_content_claim_variants (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.ready_content_claims(id) on delete cascade,
  variant_key text not null,
  statement text not null,
  language text not null default 'en',
  difficulty smallint not null default 1,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ready_content_claim_variants_claim_key_key unique (claim_id, variant_key),
  constraint ready_content_claim_variants_variant_key_check check (char_length(trim(variant_key)) between 1 and 80),
  constraint ready_content_claim_variants_statement_check check (char_length(trim(statement)) between 1 and 4000),
  constraint ready_content_claim_variants_language_check check (language in ('en','ko')),
  constraint ready_content_claim_variants_difficulty_check check (difficulty between 1 and 3),
  constraint ready_content_claim_variants_status_check check (status in ('draft','confirmed','stale'))
);

create index if not exists ready_content_claim_variants_claim_id_idx on public.ready_content_claim_variants(claim_id);
create index if not exists ready_content_claim_variants_pool_idx on public.ready_content_claim_variants(status, difficulty, language);

alter table public.ready_content_claim_variants enable row level security;
revoke all on table public.ready_content_claim_variants from anon, authenticated;
grant select, insert, update, delete on table public.ready_content_claim_variants to service_role;
