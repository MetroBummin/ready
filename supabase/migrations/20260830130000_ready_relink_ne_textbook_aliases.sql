-- A school/grade scope may point at a textbook Passage imported earlier while
-- its Questions point at a newer Passage carrying the same book and lesson.
-- Titles are presentation; the learning identity here is publisher/author,
-- course, and lesson. Rewire every matching scope to the question-bearing
-- canonical Passage without duplicating Questions or student attempts.

create or replace function public.ready_relink_ne_minbyeongcheon_lessons()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  changed integer := 0;
  affected integer := 0;
begin
  drop table if exists pg_temp.ready_ne_aliases;
  drop table if exists pg_temp.ready_ne_scope_links;

  create temporary table ready_ne_aliases on commit drop as
  with identified as (
    select
      passage.id,
      passage.created_at,
      case
        when concat_ws(' ', passage.title, passage.source_label) ~* '(lesson\s*1([^0-9]|$)|(^|[^0-9])1\s*과)' then 1
        when concat_ws(' ', passage.title, passage.source_label) ~* '(lesson\s*2([^0-9]|$)|(^|[^0-9])2\s*과)' then 2
      end as lesson
    from public.ready_passages passage
    where passage.source_type = 'TEXTBOOK'
      and concat_ws(' ', passage.title, passage.source_label) like '%공통영어2%'
      and concat_ws(' ', passage.title, passage.source_label) like '%민병천%'
  ), counted as (
    select
      identified.*,
      count(question.id) filter (where question.status = 'available') as question_count
    from identified
    left join public.ready_questions question on question.passage_id = identified.id
    where identified.lesson is not null
    group by identified.id, identified.created_at, identified.lesson
  ), ranked as (
    select
      counted.*,
      first_value(counted.id) over (
        partition by counted.lesson
        order by counted.question_count desc, counted.created_at, counted.id
      ) as keeper_id
    from counted
  )
  select id as passage_id, lesson, keeper_id, question_count
  from ranked;

  if exists (
    select 1
    from ready_ne_aliases alias
    where alias.passage_id = alias.keeper_id and alias.question_count = 0
  ) then
    raise exception 'NE Min Byeongcheon canonical Passage has no available Questions.';
  end if;

  create temporary table ready_ne_scope_links on commit drop as
  select
    link.exam_id,
    alias.lesson,
    alias.keeper_id,
    first_value(link.passage_id) over (
      partition by link.exam_id, alias.lesson
      order by link.position, link.passage_id
    ) as surviving_passage_id
  from public.ready_exam_passages link
  join ready_ne_aliases alias on alias.passage_id = link.passage_id;

  delete from public.ready_exam_passages link
  using ready_ne_aliases alias, ready_ne_scope_links scope
  where link.passage_id = alias.passage_id
    and scope.exam_id = link.exam_id
    and scope.lesson = alias.lesson
    and link.passage_id <> scope.surviving_passage_id;
  get diagnostics affected = row_count;
  changed := changed + affected;

  update public.ready_exam_passages link
  set passage_id = scope.keeper_id
  from ready_ne_scope_links scope
  where link.exam_id = scope.exam_id
    and link.passage_id = scope.surviving_passage_id
    and link.passage_id <> scope.keeper_id;
  get diagnostics affected = row_count;
  changed := changed + affected;

  if exists (
    select 1
    from ready_ne_scope_links scope
    where not exists (
      select 1
      from public.ready_exam_passages link
      where link.exam_id = scope.exam_id and link.passage_id = scope.keeper_id
    )
  ) then
    raise exception 'NE Min Byeongcheon scope relink contract failed.';
  end if;

  return changed;
end;
$$;

revoke all on function public.ready_relink_ne_minbyeongcheon_lessons() from public, anon, authenticated;
grant execute on function public.ready_relink_ne_minbyeongcheon_lessons() to service_role;

select public.ready_relink_ne_minbyeongcheon_lessons();
