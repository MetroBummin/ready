-- READY Workbook milestone: append-only student practice progress.
-- Workbook content remains versioned code data; this table stores only attempts.

create table if not exists public.ready_workbook_attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.ready_students(id) on delete restrict,
  exam_id uuid not null references public.ready_exams(id) on delete restrict,
  passage_id uuid not null references public.ready_passages(id) on delete restrict,
  workbook_key text not null check (char_length(workbook_key) between 1 and 120),
  item_key text not null check (char_length(item_key) between 1 and 120),
  stage smallint not null check (stage between 1 and 20),
  response jsonb not null,
  correct boolean not null,
  created_at timestamptz not null default now()
);

create index if not exists ready_workbook_attempts_student_passage_idx
  on public.ready_workbook_attempts(student_id, passage_id, created_at desc);
create index if not exists ready_workbook_attempts_item_idx
  on public.ready_workbook_attempts(student_id, item_key, created_at desc);

create or replace function public.ready_workbook_attempts_are_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'READY workbook attempts are append-only';
end;
$$;

drop trigger if exists ready_workbook_attempts_no_update on public.ready_workbook_attempts;
create trigger ready_workbook_attempts_no_update
before update or delete on public.ready_workbook_attempts
for each row execute function public.ready_workbook_attempts_are_immutable();

alter table public.ready_workbook_attempts enable row level security;
revoke all on public.ready_workbook_attempts from anon, authenticated;
grant all on public.ready_workbook_attempts to service_role;

