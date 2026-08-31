-- Link every score-based Workbook translation attempt to its persisted AI audit row.

alter table public.ready_workbook_attempts
  add column if not exists ai_grading_request_id uuid
  references public.ready_workbook_ai_grading_requests(id) on delete restrict;

create unique index if not exists ready_workbook_attempts_ai_request_idx
  on public.ready_workbook_attempts(ai_grading_request_id)
  where ai_grading_request_id is not null;

create or replace function public.ready_workbook_attempts_are_immutable()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' and current_setting('ready.allow_cascade_delete', true) = 'on' then
    return old;
  end if;
  raise exception 'READY workbook attempts are append-only';
end;
$$;

create or replace function public.ready_delete_student_cascade(p_student_id uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
  if not exists(select 1 from ready_students where id=p_student_id) then raise exception '학생을 찾지 못했습니다.'; end if;
  perform set_config('ready.allow_cascade_delete','on',true);
  delete from ready_workbook_bookmarks where student_id=p_student_id;
  delete from ready_workbook_attempts where student_id=p_student_id;
  delete from ready_workbook_ai_grading_requests where student_id=p_student_id;
  delete from ready_question_bookmarks where student_id=p_student_id;
  delete from ready_ai_grading_requests where student_id=p_student_id;
  delete from ready_attempts where student_id=p_student_id;
  delete from ready_saved_words where student_id=p_student_id;
  delete from ready_word_states where student_id=p_student_id;
  delete from ready_saved_sentences where student_id=p_student_id;
  delete from ready_word_lookup_events where student_id=p_student_id;
  delete from ready_sentence_translation_view_events where student_id=p_student_id;
  delete from ready_sessions where student_id=p_student_id;
  delete from ready_login_attempts where identifier='student:'||p_student_id::text;
  delete from ready_students where id=p_student_id;
end $$;

create or replace function public.ready_delete_passage_cascade(p_passage_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_question_ids uuid[];
begin
  if not exists(select 1 from ready_passages where id=p_passage_id) then raise exception '지문을 찾지 못했습니다.'; end if;
  select coalesce(array_agg(id),'{}'::uuid[]) into v_question_ids from ready_questions where passage_id=p_passage_id;
  perform set_config('ready.allow_cascade_delete','on',true);
  delete from ready_workbook_bookmarks where passage_id=p_passage_id;
  delete from ready_workbook_attempts where passage_id=p_passage_id;
  delete from ready_workbook_ai_grading_requests where passage_id=p_passage_id;
  delete from ready_question_bookmarks where question_id=any(v_question_ids);
  delete from ready_ai_grading_requests where question_id=any(v_question_ids);
  delete from ready_attempts where question_id=any(v_question_ids);
  delete from ready_saved_words where passage_id=p_passage_id;
  delete from ready_word_states where passage_id=p_passage_id;
  delete from ready_saved_sentences where passage_id=p_passage_id;
  delete from ready_word_lookup_events where passage_id=p_passage_id;
  delete from ready_sentence_translation_view_events where passage_id=p_passage_id;
  delete from ready_exam_passages where passage_id=p_passage_id;
  if to_regclass('public.ready_publication_questions') is not null then
    execute 'delete from public.ready_publication_questions where question_id=any($1)' using v_question_ids;
  end if;
  delete from ready_questions where passage_id=p_passage_id;
  delete from ready_passages where id=p_passage_id;
end $$;

revoke all on function public.ready_delete_student_cascade(uuid), public.ready_delete_passage_cascade(uuid) from public,anon,authenticated;
grant execute on function public.ready_delete_student_cascade(uuid), public.ready_delete_passage_cascade(uuid) to service_role;
