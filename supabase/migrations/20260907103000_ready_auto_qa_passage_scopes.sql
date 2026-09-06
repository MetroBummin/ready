-- Keep the two isolated QA scopes complete as Passage rows are created or regraded.
-- This only manages QA membership links; canonical Passage and learning history stay untouched.

insert into public.ready_exams(school, grade, title, description, is_current)
select seed.school, seed.grade, seed.title, 'QA 전용 · 해당 학년 모든 Passage 자동 배정', true
from (values
  ('test', '1학년', 'test 1학년'),
  ('test2', '2학년', 'test2 2학년')
) as seed(school, grade, title)
where not exists (
  select 1 from public.ready_exams exam
  where exam.school = seed.school and exam.grade = seed.grade and exam.is_current
);

-- Remove only invalid links inside the isolated QA scopes before the complete backfill.
delete from public.ready_exam_passages link
using public.ready_exams exam, public.ready_passages passage
where link.exam_id = exam.id
  and link.passage_id = passage.id
  and exam.is_current
  and exam.school in ('test', 'test2')
  and exam.grade <> passage.grade;

with qa_scopes as (
  select id, grade from public.ready_exams
  where is_current and (school, grade) in (('test', '1학년'), ('test2', '2학년'))
), missing as (
  select scope.id as exam_id, passage.id as passage_id,
    coalesce((select max(link.position) from public.ready_exam_passages link where link.exam_id = scope.id), -1)
      + row_number() over (partition by scope.id order by passage.display_order, passage.created_at, passage.id) as position
  from qa_scopes scope
  join public.ready_passages passage on passage.grade = scope.grade
  where not exists (
    select 1 from public.ready_exam_passages existing
    where existing.exam_id = scope.id and existing.passage_id = passage.id
  )
)
insert into public.ready_exam_passages(exam_id, passage_id, position, group_key, group_label)
select exam_id, passage_id, position::integer, null, null from missing
on conflict (exam_id, passage_id) do nothing;

create or replace function public.ready_sync_passage_to_qa_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam_id uuid;
  v_position integer;
begin
  -- A grade edit must not leave the Passage in the former QA scope.
  delete from public.ready_exam_passages link
  using public.ready_exams exam
  where link.exam_id = exam.id
    and link.passage_id = new.id
    and exam.is_current
    and exam.school in ('test', 'test2')
    and exam.grade <> new.grade;

  if new.grade not in ('1학년', '2학년') then
    return new;
  end if;

  select exam.id into v_exam_id
  from public.ready_exams exam
  where exam.is_current
    and exam.school = case new.grade when '1학년' then 'test' else 'test2' end
    and exam.grade = new.grade
  for update;

  if v_exam_id is null then
    raise exception 'QA 전용 시험범위를 찾지 못했습니다: %', new.grade;
  end if;

  if exists (
    select 1 from public.ready_exam_passages link
    where link.exam_id = v_exam_id and link.passage_id = new.id
  ) then
    return new;
  end if;

  select coalesce(max(position), -1) + 1 into v_position
  from public.ready_exam_passages where exam_id = v_exam_id;

  insert into public.ready_exam_passages(exam_id, passage_id, position, group_key, group_label)
  values (v_exam_id, new.id, v_position, null, null);
  update public.ready_exams set updated_at = now() where id = v_exam_id;
  return new;
end;
$$;

revoke all on function public.ready_sync_passage_to_qa_scope() from public, anon, authenticated;

drop trigger if exists ready_passages_sync_qa_scope_trigger on public.ready_passages;
create trigger ready_passages_sync_qa_scope_trigger
after insert or update of grade on public.ready_passages
for each row execute function public.ready_sync_passage_to_qa_scope();
