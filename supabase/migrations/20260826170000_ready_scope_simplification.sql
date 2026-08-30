-- READY single-current-scope UX and administrator-owned atomic deletion.

alter table public.ready_exams
  add column if not exists is_current boolean not null default false;

with ranked as (
  select id, row_number() over (partition by school, grade order by updated_at desc, created_at desc, id desc) as row_number
  from public.ready_exams
)
update public.ready_exams as exam
set is_current = ranked.row_number = 1
from ranked
where ranked.id = exam.id;

create unique index if not exists ready_exams_one_current_scope_idx
  on public.ready_exams(school, grade)
  where is_current;

insert into public.ready_exams(school, grade, title, description, is_current)
select slot.school, slot.grade, slot.school || ' ' || slot.grade || ' 시험범위', '', true
from (values
  ('중앙고', '1학년'), ('중앙고', '2학년'),
  ('동고', '1학년'), ('동고', '2학년'),
  ('신흥고', '1학년'), ('신흥고', '2학년'),
  ('한빛고', '1학년'), ('한빛고', '2학년')
) as slot(school, grade)
where not exists (
  select 1 from public.ready_exams
  where ready_exams.school = slot.school and ready_exams.grade = slot.grade and ready_exams.is_current
);

create or replace function public.ready_attempts_are_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and current_setting('ready.allow_cascade_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'READY attempts are append-only';
end;
$$;

create or replace function public.ready_set_current_scope_passages(
  p_school text,
  p_grade text,
  p_passage_ids uuid[],
  p_replace boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope_id uuid;
  v_ids uuid[] := coalesce(p_passage_ids, '{}'::uuid[]);
  v_count integer;
begin
  if trim(coalesce(p_school, '')) not in ('중앙고', '동고', '신흥고', '한빛고') then
    raise exception '학교를 확인해 주세요.';
  end if;
  if trim(coalesce(p_grade, '')) not in ('1학년', '2학년') then
    raise exception '학년을 확인해 주세요.';
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
    values (trim(p_school), trim(p_grade), trim(p_school) || ' ' || trim(p_grade) || ' 시험범위', '', true)
    returning id into v_scope_id;
  end if;

  if not p_replace then
    select array_agg(distinct passage_id) into v_ids
    from (
      select passage_id from public.ready_exam_passages where exam_id = v_scope_id
      union all
      select unnest(v_ids)
    ) as merged;
    v_ids := coalesce(v_ids, '{}'::uuid[]);
  end if;

  delete from public.ready_exam_passages where exam_id = v_scope_id;
  insert into public.ready_exam_passages(exam_id, passage_id, position)
  select v_scope_id, passage.id, row_number() over (
    order by passage.display_order, passage.created_at, passage.id
  )::integer - 1
  from public.ready_passages as passage
  where passage.id = any(v_ids);

  update public.ready_exams set updated_at = now() where id = v_scope_id;
  return v_scope_id;
end;
$$;

create or replace function public.ready_delete_student_cascade(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ready_students where id = p_student_id) then
    raise exception '학생을 찾지 못했습니다.';
  end if;
  perform set_config('ready.allow_cascade_delete', 'on', true);
  delete from public.ready_attempts where student_id = p_student_id;
  delete from public.ready_saved_words where student_id = p_student_id;
  delete from public.ready_saved_sentences where student_id = p_student_id;
  delete from public.ready_word_lookup_events where student_id = p_student_id;
  delete from public.ready_sentence_translation_view_events where student_id = p_student_id;
  delete from public.ready_sessions where student_id = p_student_id;
  delete from public.ready_login_attempts where identifier = 'student:' || p_student_id::text;
  delete from public.ready_students where id = p_student_id;
end;
$$;

create or replace function public.ready_delete_passage_cascade(p_passage_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.ready_passages where id = p_passage_id) then
    raise exception '지문을 찾지 못했습니다.';
  end if;
  perform set_config('ready.allow_cascade_delete', 'on', true);
  delete from public.ready_attempts
  where question_id in (select id from public.ready_questions where passage_id = p_passage_id);
  delete from public.ready_saved_words where passage_id = p_passage_id;
  delete from public.ready_saved_sentences where passage_id = p_passage_id;
  delete from public.ready_word_lookup_events where passage_id = p_passage_id;
  delete from public.ready_sentence_translation_view_events where passage_id = p_passage_id;
  delete from public.ready_exam_passages where passage_id = p_passage_id;
  delete from public.ready_questions where passage_id = p_passage_id;
  delete from public.ready_passages where id = p_passage_id;
end;
$$;

drop function if exists public.ready_create_exam_with_passages(text, text, text, text, uuid[]);
drop function if exists public.ready_set_exam_passages(uuid, uuid[]);

revoke all on function public.ready_set_current_scope_passages(text, text, uuid[], boolean),
  public.ready_delete_student_cascade(uuid), public.ready_delete_passage_cascade(uuid)
  from public, anon, authenticated;
grant execute on function public.ready_set_current_scope_passages(text, text, uuid[], boolean),
  public.ready_delete_student_cascade(uuid), public.ready_delete_passage_cascade(uuid)
  to service_role;
