-- Exam-specific Passage presentation. Passage content and learning records stay untouched.

alter table public.ready_exam_passages
  add column if not exists group_key text,
  add column if not exists group_label text;

alter table public.ready_exam_passages
  drop constraint if exists ready_exam_passages_group_pair_check,
  add constraint ready_exam_passages_group_pair_check check (
    (group_key is null and group_label is null)
    or (
      char_length(trim(group_key)) between 1 and 80
      and char_length(trim(group_label)) between 1 and 120
    )
  );

create or replace function public.ready_set_scope_layout(p_exam_id uuid, p_layout jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_exam_id uuid;
  v_link_count integer;
  v_layout_count integer;
  v_offset integer;
begin
  select id into v_exam_id from public.ready_exams where id = p_exam_id for update;
  if v_exam_id is null then
    raise exception '시험범위를 찾지 못했습니다.';
  end if;
  if p_layout is null or jsonb_typeof(p_layout) <> 'array' then
    raise exception '시험범위 layout은 배열이어야 합니다.';
  end if;

  drop table if exists pg_temp.ready_scope_layout_input;
  create temporary table ready_scope_layout_input (
    passage_id uuid,
    position integer not null,
    group_key text,
    group_label text
  ) on commit drop;

  insert into ready_scope_layout_input(passage_id, position, group_key, group_label)
  select
    nullif(item.value ->> 'passageId', '')::uuid,
    (item.ordinality - 1)::integer,
    nullif(trim(item.value ->> 'groupKey'), ''),
    nullif(trim(item.value ->> 'groupLabel'), '')
  from jsonb_array_elements(p_layout) with ordinality as item(value, ordinality);

  if exists (
    select 1 from ready_scope_layout_input
    where passage_id is null or (group_key is null) <> (group_label is null)
  ) then
    raise exception 'groupKey와 groupLabel은 함께 지정하거나 함께 비워야 합니다.';
  end if;
  if exists (
    select passage_id from ready_scope_layout_input group by passage_id having count(*) <> 1
  ) then
    raise exception '중복된 Passage가 포함되어 있습니다.';
  end if;
  if exists (
    select group_key from ready_scope_layout_input
    where group_key is not null
    group by group_key having count(distinct group_label) <> 1
  ) then
    raise exception '같은 groupKey에 서로 다른 이름을 사용할 수 없습니다.';
  end if;
  if exists (
    select group_key from ready_scope_layout_input
    where group_key is not null
    group by group_key
    having max(position) - min(position) + 1 <> count(*)
  ) then
    raise exception '같은 묶음의 Passage는 연속되어야 합니다.';
  end if;

  perform 1 from public.ready_exam_passages where exam_id = p_exam_id for update;
  select count(*) into v_link_count
  from public.ready_exam_passages
  where exam_id = p_exam_id;
  select count(*) into v_layout_count from ready_scope_layout_input;

  if v_layout_count <> v_link_count
    or exists (
      select 1 from ready_scope_layout_input input
      left join public.ready_exam_passages link
        on link.exam_id = p_exam_id and link.passage_id = input.passage_id
      where link.passage_id is null
    )
    or exists (
      select 1 from public.ready_exam_passages link
      left join ready_scope_layout_input input on input.passage_id = link.passage_id
      where link.exam_id = p_exam_id and input.passage_id is null
    )
  then
    raise exception '현재 시험범위의 모든 Passage를 정확히 한 번 포함해야 합니다.';
  end if;

  select coalesce(max(position) - min(position), 0) + v_link_count + 1 into v_offset
  from public.ready_exam_passages where exam_id = p_exam_id;

  update public.ready_exam_passages
  set position = position + v_offset
  where exam_id = p_exam_id;

  update public.ready_exam_passages as link
  set position = input.position,
      group_key = input.group_key,
      group_label = input.group_label
  from ready_scope_layout_input as input
  where link.exam_id = p_exam_id and link.passage_id = input.passage_id;

  update public.ready_exams set updated_at = now() where id = p_exam_id;
end;
$$;

revoke all on function public.ready_set_scope_layout(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ready_set_scope_layout(uuid, jsonb) to service_role;

-- The Admin editor can also change membership. Membership and layout commit together,
-- while ready_set_scope_layout remains the strict reorder-only contract.
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
begin
  select grade into v_grade from public.ready_exams where id = p_exam_id for update;
  if v_grade is null then raise exception '시험범위를 찾지 못했습니다.'; end if;
  if p_layout is null or jsonb_typeof(p_layout) <> 'array' then
    raise exception '시험범위 layout은 배열이어야 합니다.';
  end if;

  drop table if exists pg_temp.ready_scope_definition_input;
  create temporary table ready_scope_definition_input (
    passage_id uuid,
    ordinal integer not null
  ) on commit drop;
  insert into ready_scope_definition_input(passage_id, ordinal)
  select nullif(item.value ->> 'passageId', '')::uuid, (item.ordinality - 1)::integer
  from jsonb_array_elements(p_layout) with ordinality as item(value, ordinality);

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

  perform public.ready_set_scope_layout(p_exam_id, p_layout);
end;
$$;

revoke all on function public.ready_set_scope_definition(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.ready_set_scope_definition(uuid, jsonb) to service_role;

-- Membership changes preserve every existing row's layout. New links are appended ungrouped.
create or replace function public.ready_set_current_scope_passages(
  p_school text,
  p_grade text,
  p_passage_ids uuid[],
  p_replace boolean default true
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_scope_id uuid;
  v_ids uuid[] := coalesce(p_passage_ids, '{}'::uuid[]);
  v_count integer;
  v_next_position integer;
begin
  if trim(coalesce(p_school, '')) not in ('중앙고', '동고', '신흥고', '한빛고', 'test', 'test2') then
    raise exception '학교를 확인해 주세요.';
  end if;
  if trim(coalesce(p_grade, '')) not in ('1학년', '2학년') then
    raise exception '학년을 확인해 주세요.';
  end if;
  if (trim(p_school) = 'test' and trim(p_grade) <> '1학년')
    or (trim(p_school) = 'test2' and trim(p_grade) <> '2학년') then
    raise exception 'QA 시험범위의 학교와 학년 조합을 확인해 주세요.';
  end if;
  if cardinality(v_ids) <> (select count(distinct id) from unnest(v_ids) as selected(id)) then
    raise exception '중복된 지문이 포함되어 있습니다.';
  end if;
  select count(*) into v_count
  from public.ready_passages
  where id = any(v_ids) and grade = trim(p_grade);
  if v_count <> cardinality(v_ids) then
    raise exception '존재하지 않거나 시험범위 학년과 다른 지문이 포함되어 있습니다.';
  end if;

  select id into v_scope_id
  from public.ready_exams
  where school = trim(p_school) and grade = trim(p_grade) and is_current
  for update;

  if v_scope_id is null then
    insert into public.ready_exams(school, grade, title, description, is_current)
    values (trim(p_school), trim(p_grade), trim(p_school) || ' ' || trim(p_grade), 'QA 전용 시험범위', true)
    returning id into v_scope_id;
  end if;

  if p_replace then
    delete from public.ready_exam_passages
    where exam_id = v_scope_id and not (passage_id = any(v_ids));
  end if;

  select coalesce(max(position), -1) + 1 into v_next_position
  from public.ready_exam_passages where exam_id = v_scope_id;

  insert into public.ready_exam_passages(exam_id, passage_id, position, group_key, group_label)
  select v_scope_id, selected.passage_id,
    v_next_position + row_number() over (order by selected.ordinality)::integer - 1,
    null, null
  from unnest(v_ids) with ordinality as selected(passage_id, ordinality)
  where not exists (
    select 1 from public.ready_exam_passages link
    where link.exam_id = v_scope_id and link.passage_id = selected.passage_id
  )
  order by selected.ordinality;

  update public.ready_exams set updated_at = now() where id = v_scope_id;
  return v_scope_id;
end;
$$;

revoke all on function public.ready_set_current_scope_passages(text, text, uuid[], boolean) from public, anon, authenticated;
grant execute on function public.ready_set_current_scope_passages(text, text, uuid[], boolean) to service_role;

-- Isolated QA scopes. Existing Passage rows are linked, never copied.
insert into public.ready_exams(school, grade, title, description, is_current)
select seed.school, seed.grade, seed.title, 'QA 전용 · 실제 학생 자동 배정 없음', true
from (values
  ('test', '1학년', 'test 1학년'),
  ('test2', '2학년', 'test2 2학년')
) as seed(school, grade, title)
where not exists (
  select 1 from public.ready_exams exam
  where exam.school = seed.school and exam.grade = seed.grade and exam.is_current
);

with qa_scopes as (
  select id, grade from public.ready_exams
  where is_current and (school, grade) in (('test', '1학년'), ('test2', '2학년'))
), candidates as (
  select scope.id as exam_id, passage.id as passage_id,
    row_number() over (
      partition by scope.id order by passage.display_order, passage.created_at, passage.id
    )::integer as ordinal
  from qa_scopes scope
  join public.ready_passages passage on passage.grade = scope.grade
  where not exists (
    select 1 from public.ready_exam_passages existing where existing.exam_id = scope.id
  )
)
insert into public.ready_exam_passages(exam_id, passage_id, position, group_key, group_label)
select exam_id, passage_id, ordinal - 1,
  case when ordinal <= 3 then 'mock' else 'supplement' end,
  case when ordinal <= 3 then '모의고사' else '부교재' end
from candidates
where ordinal <= 5
on conflict (exam_id, passage_id) do nothing;
