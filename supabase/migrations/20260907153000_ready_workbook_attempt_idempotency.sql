alter table public.ready_workbook_attempts
  add column if not exists client_attempt_id uuid;

create unique index if not exists ready_workbook_attempts_student_client_attempt_uidx
  on public.ready_workbook_attempts (student_id, client_attempt_id)
  where client_attempt_id is not null;

comment on column public.ready_workbook_attempts.client_attempt_id is
  'Client generated idempotency key for retry-safe background Workbook attempt persistence.';
