-- READY Workbook Factory.  These tables add new catalog and audit data only;
-- existing code-backed workbooks and all student attempts remain untouched.

create table if not exists public.ready_workbook_factory_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('review_required', 'ready', 'failed')),
  source_kind text not null check (source_kind in ('text', 'pdf')),
  title text not null check (char_length(trim(title)) between 1 and 120),
  source_metadata jsonb not null default '{}'::jsonb,
  extracted_rows jsonb not null default '[]'::jsonb,
  extraction jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  failure_reason text not null default '',
  passage_id uuid references public.ready_passages(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ready_workbook_factory_jobs_status_idx
  on public.ready_workbook_factory_jobs(status, created_at desc);

create table if not exists public.ready_workbook_catalogs (
  passage_id uuid primary key references public.ready_passages(id) on delete cascade,
  workbook_key text not null unique check (char_length(workbook_key) between 1 and 120),
  catalog jsonb not null,
  provenance jsonb not null default '{}'::jsonb,
  metrics jsonb not null default '{}'::jsonb,
  factory_job_id uuid references public.ready_workbook_factory_jobs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ready_workbook_catalogs_key_idx
  on public.ready_workbook_catalogs(workbook_key);

alter table public.ready_workbook_factory_jobs enable row level security;
alter table public.ready_workbook_catalogs enable row level security;
revoke all on public.ready_workbook_factory_jobs, public.ready_workbook_catalogs from anon, authenticated;
grant all on public.ready_workbook_factory_jobs, public.ready_workbook_catalogs to service_role;
