-- READY Golden Path stabilization.
-- Exam membership mutations are atomic. Legacy Passage.exam_id may remain for
-- historical inspection, but it must never cascade-delete a library Passage.

create or replace function public.ready_set_exam_passages(p_exam_id uuid, p_passage_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_grade text;
  v_count integer;
begin
  if p_passage_ids is null or cardinality(p_passage_ids) < 1 then
    raise exception '시험범위에 지문을 하나 이상 선택해 주세요.';
  end if;
  if cardinality(p_passage_ids) <> (select count(distinct id) from unnest(p_passage_ids) as ids(id)) then
    raise exception '중복된 지문이 포함되어 있습니다.';
  end if;
  select grade into v_grade from public.ready_exams where id = p_exam_id;
  if v_grade is null then raise exception 'Exam을 찾지 못했습니다.'; end if;
  select count(*) into v_count from public.ready_passages where id = any(p_passage_ids) and grade = v_grade;
  if v_count <> cardinality(p_passage_ids) then
    raise exception '존재하지 않거나 Exam 학년과 다른 지문이 포함되어 있습니다.';
  end if;
  delete from public.ready_exam_passages where exam_id = p_exam_id;
  insert into public.ready_exam_passages(exam_id, passage_id, position)
  select p_exam_id, passage_id, (ordinal - 1)::integer
  from unnest(p_passage_ids) with ordinality as selected(passage_id, ordinal)
  order by ordinal;
end;
$$;

create or replace function public.ready_create_exam_with_passages(
  p_school text,
  p_grade text,
  p_title text,
  p_description text,
  p_passage_ids uuid[]
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_exam_id uuid;
  v_count integer;
begin
  if char_length(trim(coalesce(p_school, ''))) not between 1 and 80 then raise exception '학교를 확인해 주세요.'; end if;
  if char_length(trim(coalesce(p_grade, ''))) not between 1 and 40 then raise exception '학년을 확인해 주세요.'; end if;
  if char_length(trim(coalesce(p_title, ''))) not between 1 and 120 then raise exception '시험명을 확인해 주세요.'; end if;
  if p_passage_ids is null or cardinality(p_passage_ids) < 1 then raise exception '시험범위에 지문을 하나 이상 선택해 주세요.'; end if;
  if cardinality(p_passage_ids) <> (select count(distinct id) from unnest(p_passage_ids) as ids(id)) then raise exception '중복된 지문이 포함되어 있습니다.'; end if;
  select count(*) into v_count from public.ready_passages where id = any(p_passage_ids) and grade = trim(p_grade);
  if v_count <> cardinality(p_passage_ids) then raise exception '존재하지 않거나 Exam 학년과 다른 지문이 포함되어 있습니다.'; end if;

  insert into public.ready_exams(school, grade, title, description)
  values (trim(p_school), trim(p_grade), trim(p_title), trim(coalesce(p_description, '')))
  returning id into v_exam_id;

  insert into public.ready_exam_passages(exam_id, passage_id, position)
  select v_exam_id, passage_id, (ordinal - 1)::integer
  from unnest(p_passage_ids) with ordinality as selected(passage_id, ordinal)
  order by ordinal;
  return v_exam_id;
end;
$$;

revoke all on function public.ready_set_exam_passages(uuid, uuid[]), public.ready_create_exam_with_passages(text, text, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.ready_set_exam_passages(uuid, uuid[]), public.ready_create_exam_with_passages(text, text, text, text, uuid[]) to service_role;

-- This column only exists on projects migrated from the early single-Exam model.
do $$
declare
  constraint_row record;
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ready_passages' and column_name = 'exam_id'
  ) then
    for constraint_row in
      select conname from pg_constraint
      where conrelid = 'public.ready_passages'::regclass
        and contype = 'f'
        and pg_get_constraintdef(oid) like 'FOREIGN KEY (exam_id)%'
    loop
      execute format('alter table public.ready_passages drop constraint %I', constraint_row.conname);
    end loop;
    alter table public.ready_passages
      add constraint ready_passages_legacy_exam_id_fkey
      foreign key (exam_id) references public.ready_exams(id) on delete set null;
  end if;
end $$;

-- All current attempts already carry their verified Exam context.
alter table public.ready_attempts alter column exam_id set not null;
