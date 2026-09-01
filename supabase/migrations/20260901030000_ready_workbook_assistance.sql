-- Minimal Stage 9 assistance metadata. Attempts remain append-only.
alter table public.ready_workbook_attempts
  add column if not exists hint_count smallint not null default 0 check (hint_count between 0 and 2),
  add column if not exists used_full_answer_hint boolean not null default false,
  add column if not exists completed_after_hint boolean not null default false;
