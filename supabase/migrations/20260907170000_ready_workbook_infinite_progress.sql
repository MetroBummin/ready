-- Cumulative Workbook clears are intentionally independent from the latest
-- per-item result. One correct attempt advances the stage by one clear, while
-- incorrect attempts remain append-only history without advancing progress.
create table if not exists public.ready_workbook_stage_progress (
  student_id uuid not null references public.ready_students(id) on delete cascade,
  exam_id uuid not null references public.ready_exams(id) on delete cascade,
  passage_id uuid not null references public.ready_passages(id) on delete cascade,
  workbook_key text not null check (char_length(workbook_key) between 1 and 120),
  stage_contract_version text not null,
  progress_key text not null check (char_length(progress_key) between 1 and 80),
  semantic_type text,
  stage smallint not null check (stage between 1 and 20),
  correct_clears bigint not null default 0 check (correct_clears >= 0),
  updated_at timestamptz not null default now(),
  primary key (student_id, exam_id, passage_id, workbook_key, stage_contract_version, progress_key)
);

create index if not exists ready_workbook_stage_progress_scope_idx
  on public.ready_workbook_stage_progress(student_id, exam_id, passage_id, workbook_key);

create or replace function public.ready_increment_workbook_stage_progress()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_progress_key text := coalesce(nullif(new.semantic_type, ''), 'stage:' || new.stage::text);
begin
  if new.correct is not true then return new; end if;
  insert into public.ready_workbook_stage_progress (
    student_id, exam_id, passage_id, workbook_key, stage_contract_version,
    progress_key, semantic_type, stage, correct_clears, updated_at
  ) values (
    new.student_id, new.exam_id, new.passage_id, new.workbook_key,
    coalesce(nullif(new.stage_contract_version, ''), 'legacy-v1'),
    v_progress_key, nullif(new.semantic_type, ''), new.stage, 1, new.created_at
  )
  on conflict (student_id, exam_id, passage_id, workbook_key, stage_contract_version, progress_key)
  do update set
    correct_clears = public.ready_workbook_stage_progress.correct_clears + 1,
    semantic_type = excluded.semantic_type,
    stage = excluded.stage,
    updated_at = excluded.updated_at;
  return new;
end;
$$;

drop trigger if exists ready_workbook_attempt_progress on public.ready_workbook_attempts;
create trigger ready_workbook_attempt_progress
after insert on public.ready_workbook_attempts
for each row execute function public.ready_increment_workbook_stage_progress();

insert into public.ready_workbook_stage_progress (
  student_id, exam_id, passage_id, workbook_key, stage_contract_version,
  progress_key, semantic_type, stage, correct_clears, updated_at
)
select
  student_id,
  exam_id,
  passage_id,
  workbook_key,
  coalesce(nullif(stage_contract_version, ''), 'legacy-v1'),
  coalesce(nullif(semantic_type, ''), 'stage:' || stage::text),
  nullif(semantic_type, ''),
  stage,
  count(*)::bigint,
  max(created_at)
from public.ready_workbook_attempts
where correct is true
group by student_id, exam_id, passage_id, workbook_key,
  coalesce(nullif(stage_contract_version, ''), 'legacy-v1'),
  coalesce(nullif(semantic_type, ''), 'stage:' || stage::text),
  nullif(semantic_type, ''), stage
on conflict (student_id, exam_id, passage_id, workbook_key, stage_contract_version, progress_key)
do update set
  correct_clears = excluded.correct_clears,
  semantic_type = excluded.semantic_type,
  stage = excluded.stage,
  updated_at = excluded.updated_at;

alter table public.ready_workbook_stage_progress enable row level security;
revoke all on public.ready_workbook_stage_progress from anon, authenticated;
grant all on public.ready_workbook_stage_progress to service_role;
revoke all on function public.ready_increment_workbook_stage_progress() from public, anon, authenticated;
grant execute on function public.ready_increment_workbook_stage_progress() to service_role;

comment on table public.ready_workbook_stage_progress is
  'Cumulative correct Workbook clears. Attempts remain the append-only historical source; this table is the unbounded stage progress counter.';
