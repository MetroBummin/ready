-- Persist empty Admin groups, repair mixed-grade scope links, and prevent recurrence.

alter table public.ready_exams
  add column if not exists empty_passage_groups jsonb not null default '[]'::jsonb;

alter table public.ready_exams
  drop constraint if exists ready_exams_empty_passage_groups_array_check,
  add constraint ready_exams_empty_passage_groups_array_check
  check (jsonb_typeof(empty_passage_groups) = 'array');

-- The current Shinheung grade-2 scope was labeled only "중간고사" and contained
-- grade-1 links. Normalize its label and remove every invalid cross-grade link.
update public.ready_exams
set title = '신흥고 2학년 시험범위', updated_at = now()
where school = '신흥고' and grade = '2학년' and is_current;

delete from public.ready_exam_passages as link
using public.ready_exams as exam, public.ready_passages as passage
where link.exam_id = exam.id
  and link.passage_id = passage.id
  and exam.school = '신흥고'
  and exam.grade = '2학년'
  and exam.is_current
  and passage.grade <> exam.grade;

update public.ready_exam_passages as link
set position = -link.position - 1
from public.ready_exams as exam
where link.exam_id = exam.id
  and exam.school = '신흥고'
  and exam.grade = '2학년'
  and exam.is_current;

with ranked as (
  select link.exam_id, link.passage_id,
    row_number() over (partition by link.exam_id order by link.position desc)::integer - 1 as position
  from public.ready_exam_passages link
  join public.ready_exams exam on exam.id = link.exam_id
  where exam.school = '신흥고' and exam.grade = '2학년' and exam.is_current
)
update public.ready_exam_passages as link
set position = ranked.position
from ranked
where link.exam_id = ranked.exam_id and link.passage_id = ranked.passage_id;

create or replace function public.ready_exam_passage_grade_matches()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_exam_grade text;
  v_passage_grade text;
begin
  select grade into v_exam_grade from public.ready_exams where id = new.exam_id;
  select grade into v_passage_grade from public.ready_passages where id = new.passage_id;
  if v_exam_grade is null or v_passage_grade is null or v_exam_grade <> v_passage_grade then
    raise exception '시험범위와 Passage의 학년이 일치해야 합니다.';
  end if;
  return new;
end;
$$;

revoke all on function public.ready_exam_passage_grade_matches() from public, anon, authenticated;

drop trigger if exists ready_exam_passages_grade_match_trigger on public.ready_exam_passages;
create trigger ready_exam_passages_grade_match_trigger
before insert or update of exam_id, passage_id on public.ready_exam_passages
for each row execute function public.ready_exam_passage_grade_matches();

create or replace function public.ready_set_scope_definition(p_exam_id uuid, p_layout jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_grade text;
  v_count integer;
  v_next_position integer;
  v_items jsonb;
  v_empty_groups jsonb;
begin
  select grade into v_grade from public.ready_exams where id = p_exam_id for update;
  if v_grade is null then raise exception '시험범위를 찾지 못했습니다.'; end if;

  if jsonb_typeof(p_layout) = 'array' then
    v_items := p_layout;
    v_empty_groups := '[]'::jsonb;
  elsif jsonb_typeof(p_layout) = 'object'
    and jsonb_typeof(p_layout -> 'items') = 'array'
    and jsonb_typeof(coalesce(p_layout -> 'emptyGroups', '[]'::jsonb)) = 'array' then
    v_items := p_layout -> 'items';
    v_empty_groups := coalesce(p_layout -> 'emptyGroups', '[]'::jsonb);
  else
    raise exception '시험범위 definition 형식이 올바르지 않습니다.';
  end if;

  drop table if exists pg_temp.ready_scope_definition_input;
  create temporary table ready_scope_definition_input (
    passage_id uuid,
    ordinal integer not null,
    group_key text
  ) on commit drop;
  insert into ready_scope_definition_input(passage_id, ordinal, group_key)
  select nullif(item.value ->> 'passageId', '')::uuid,
    (item.ordinality - 1)::integer,
    nullif(trim(item.value ->> 'groupKey'), '')
  from jsonb_array_elements(v_items) with ordinality as item(value, ordinality);

  if exists (select passage_id from ready_scope_definition_input group by passage_id having passage_id is null or count(*) <> 1) then
    raise exception '중복되거나 올바르지 않은 Passage가 포함되어 있습니다.';
  end if;
  select count(*) into v_count
  from public.ready_passages passage
  join ready_scope_definition_input input on input.passage_id = passage.id
  where passage.grade = v_grade;
  if v_count <> (select count(*) from ready_scope_definition_input) then
    raise exception '존재하지 않거나 시험범위 학년과 다른 Passage가 포함되어 있습니다.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(v_empty_groups) as empty_group(value)
    where jsonb_typeof(empty_group.value) <> 'object'
      or char_length(trim(coalesce(empty_group.value ->> 'key', ''))) not between 1 and 80
      or char_length(trim(coalesce(empty_group.value ->> 'label', ''))) not between 1 and 120
      or (empty_group.value ->> 'index') is null
      or (empty_group.value ->> 'index') !~ '^[0-9]+$'
  ) then
    raise exception '빈 묶음 정보가 올바르지 않습니다.';
  end if;
  if exists (
    select trim(value ->> 'key')
    from jsonb_array_elements(v_empty_groups)
    group by trim(value ->> 'key') having count(*) <> 1
  ) then
    raise exception '중복된 빈 묶음 key가 포함되어 있습니다.';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_empty_groups) empty_group(value)
    join ready_scope_definition_input input on input.group_key = trim(empty_group.value ->> 'key')
  ) then
    raise exception 'Passage가 있는 묶음을 빈 묶음으로 저장할 수 없습니다.';
  end if;

  delete from public.ready_exam_passages link
  where link.exam_id = p_exam_id
    and not exists (select 1 from ready_scope_definition_input input where input.passage_id = link.passage_id);

  select coalesce(max(position), -1) + 1 into v_next_position
  from public.ready_exam_passages where exam_id = p_exam_id;
  insert into public.ready_exam_passages(exam_id, passage_id, position, group_key, group_label)
  select p_exam_id, input.passage_id,
    v_next_position + row_number() over (order by input.ordinal)::integer - 1,
    null, null
  from ready_scope_definition_input input
  where not exists (
    select 1 from public.ready_exam_passages link
    where link.exam_id = p_exam_id and link.passage_id = input.passage_id
  )
  order by input.ordinal;

  perform public.ready_set_scope_layout(p_exam_id, v_items);

  update public.ready_exams
  set empty_passage_groups = coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', trim(value ->> 'key'),
      'label', trim(value ->> 'label'),
      'index', (value ->> 'index')::integer
    ) order by (value ->> 'index')::integer)
    from jsonb_array_elements(v_empty_groups)
  ), '[]'::jsonb)
  where id = p_exam_id;
end;
$$;

revoke all on function public.ready_set_scope_definition(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ready_set_scope_definition(uuid, jsonb) to service_role;
