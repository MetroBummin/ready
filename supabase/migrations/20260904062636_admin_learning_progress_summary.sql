-- Read-only Admin learning summary. Attempts remain append-only source data.
create index if not exists ready_workbook_attempts_student_created_idx
  on public.ready_workbook_attempts(student_id, created_at desc);

create or replace function public.ready_admin_learning_progress(
  p_since timestamptz,
  p_school text default null,
  p_grade text default null
)
returns table(
  student_id uuid,
  student_name text,
  school text,
  grade text,
  last_activity_at timestamptz,
  question_attempts bigint,
  question_correct bigint,
  question_wrong bigint,
  workbook_attempts bigint,
  workbook_correct bigint,
  workbook_wrong bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with selected_students as (
    select s.id, s.name, s.school, s.grade
    from public.ready_students s
    where s.active = true
      and (nullif(trim(p_school), '') is null or s.school = trim(p_school))
      and (nullif(trim(p_grade), '') is null or s.grade = trim(p_grade))
  ),
  question_period as (
    select a.student_id,
      count(*) as attempts,
      count(*) filter (where a.correct) as correct,
      count(*) filter (where not a.correct) as wrong
    from public.ready_attempts a
    join selected_students s on s.id = a.student_id
    where a.created_at >= p_since
    group by a.student_id
  ),
  workbook_period as (
    select a.student_id,
      count(*) as attempts,
      count(*) filter (where a.correct) as correct,
      count(*) filter (where not a.correct) as wrong
    from public.ready_workbook_attempts a
    join selected_students s on s.id = a.student_id
    where a.created_at >= p_since
    group by a.student_id
  ),
  last_activity as (
    select activity.student_id, max(activity.created_at) as created_at
    from (
      select a.student_id, a.created_at
      from public.ready_attempts a
      join selected_students s on s.id = a.student_id
      union all
      select a.student_id, a.created_at
      from public.ready_workbook_attempts a
      join selected_students s on s.id = a.student_id
    ) activity
    group by activity.student_id
  )
  select s.id, s.name, s.school, s.grade, last_activity.created_at,
    coalesce(question_period.attempts, 0),
    coalesce(question_period.correct, 0),
    coalesce(question_period.wrong, 0),
    coalesce(workbook_period.attempts, 0),
    coalesce(workbook_period.correct, 0),
    coalesce(workbook_period.wrong, 0)
  from selected_students s
  left join question_period on question_period.student_id = s.id
  left join workbook_period on workbook_period.student_id = s.id
  left join last_activity on last_activity.student_id = s.id
  order by last_activity.created_at asc nulls first, s.school, s.grade, s.name;
$$;

revoke all on function public.ready_admin_learning_progress(timestamptz, text, text) from public, anon, authenticated;
grant execute on function public.ready_admin_learning_progress(timestamptz, text, text) to service_role;
